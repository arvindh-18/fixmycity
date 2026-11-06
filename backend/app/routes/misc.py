from datetime import timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import gemini, geocode
from pydantic import BaseModel, Field

from ..auth import User, admin_user, current_user, optional_user, role_for_email
from ..config import settings
from ..db import CATEGORIES, Issue, StaffMember, get_db, now
from .issues import resolution_days, serialize

router = APIRouter(prefix="/api")


@router.get("/health")
def health():
    return {"ok": True}


def _demo_config() -> dict:
    from .. import demo

    return {
        "location": {"lat": settings.demo_lat, "lng": settings.demo_lng, "label": settings.demo_label},
        "personas": [{k: p[k] for k in ("token", "name", "role", "blurb")} for p in demo.PERSONAS],
        "offline_ai": not settings.gemini_api_key,
    }


@router.get("/config")
def public_config():
    """Everything the frontend needs at runtime, so one build works in every environment."""
    return {
        "auth_mode": "supabase" if settings.supabase_enabled else ("dev" if settings.dev_auth else "none"),
        "supabase": {
            "url": settings.supabase_url,
            "anonKey": settings.supabase_anon_key,
        } if settings.supabase_enabled else None,
        "ai_enabled": settings.ai_enabled,
        "demo": _demo_config() if settings.demo_mode and settings.environment != "production" else None,
        "city": {"name": settings.city_name, "lat": settings.city_lat, "lng": settings.city_lng},
        "categories": [{"id": k, "label": v} for k, v in CATEGORIES.items()],
    }


@router.get("/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.is_staff and user.name:  # remember staff names so residents see "Ravi", not an email
        member = db.get(StaffMember, user.email)
        if member and member.name != user.name:
            member.name = user.name
            db.commit()
    return {"uid": user.uid, "name": user.name, "email": user.email, "role": user.role, "is_admin": user.is_admin}


# ---- Staff (admins manage who is a worker / admin) --------------------------

class StaffIn(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    role: str = Field("worker", pattern="^(worker|admin)$")
    name: str = Field("", max_length=120)


def _staff_list(db: Session) -> list[dict]:
    rows = {m.email: {"email": m.email, "name": m.name or "", "role": m.role, "source": "app", "added_by": m.added_by}
            for m in db.scalars(select(StaffMember).order_by(StaffMember.created_at))}
    for e in sorted(settings.worker_emails):
        rows.setdefault(e, {"email": e, "name": "", "role": "worker", "source": "env", "added_by": ""})
    for e in sorted(settings.admin_emails):  # ADMIN_EMAILS always wins
        rows[e] = {"email": e, "name": "", "role": "admin", "source": "env", "added_by": ""}
    jobs = dict(db.execute(select(Issue.assigned_to_email, func.count(Issue.id))
                           .where(Issue.status.in_(("open", "in_progress", "rechecking")), Issue.assigned_to_email.is_not(None))
                           .group_by(Issue.assigned_to_email)).all())
    for r in rows.values():
        r["open_jobs"] = jobs.get(r["email"], 0)
    return list(rows.values())


@router.get("/staff")
def list_staff(db: Session = Depends(get_db), user: User = Depends(admin_user)):
    return _staff_list(db)


@router.post("/staff", status_code=201)
def add_staff(body: StaffIn, db: Session = Depends(get_db), user: User = Depends(admin_user)):
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(422, "Enter a valid email address.")
    if email in settings.admin_emails:
        raise HTTPException(409, "That email is already an admin (set in ADMIN_EMAILS).")
    member = db.get(StaffMember, email) or StaffMember(email=email)
    member.role, member.added_by = body.role, user.name
    if body.name.strip():
        member.name = body.name.strip()
    db.add(member)
    db.commit()
    return _staff_list(db)


@router.delete("/staff/{email}")
def remove_staff(email: str, db: Session = Depends(get_db), user: User = Depends(admin_user)):
    email = email.strip().lower()
    if email == user.email:
        raise HTTPException(409, "You can't remove yourself.")
    member = db.get(StaffMember, email)
    if member:
        db.delete(member)
        db.commit()
    if role_for_email(email) != "public":
        raise HTTPException(409, "That role comes from ADMIN_EMAILS / WORKER_EMAILS on the server; remove it there.")
    return _staff_list(db)


# ---- AI -------------------------------------------------------------------

def _check_size(data: bytes):
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"File is larger than {settings.max_upload_mb} MB.")


@router.post("/ai/analyze")
async def analyze(photo: UploadFile = File(...), note: str = Form(""), user: User = Depends(current_user)):
    data = await photo.read()
    _check_size(data)
    return gemini.analyze_photo(data, photo.content_type or "image/jpeg", note)


class StructureIn(BaseModel):
    text: str = Field(..., min_length=3, max_length=3000)
    lang: str = Field("en", pattern="^(en|ta|hi)$")


@router.post("/ai/structure")
def structure(body: StructureIn, user: User = Depends(current_user)):
    """Free text / transcribed voice in English, Tamil or Hindi → a structured report draft (in English)."""
    return gemini.structure_text(body.text, body.lang)


@router.post("/ai/transcribe")
async def transcribe(audio: UploadFile = File(...), user: User = Depends(current_user)):
    data = await audio.read()
    _check_size(data)
    return {"text": gemini.transcribe(data, audio.content_type or "audio/webm")}


# ---- Geo (OpenStreetMap) ----------------------------------------------------

@router.get("/geo/reverse")
def reverse(lat: float, lng: float):
    return geocode.reverse(lat, lng)


@router.get("/geo/search")
def search(q: str = Query(..., min_length=2, max_length=120)):
    return geocode.search(q.strip())


# ---- Stats: the few numbers that matter -----------------------------------

@router.get("/stats")
def stats(pincode: str = "", locality: str = "", db: Session = Depends(get_db),
          user: User | None = Depends(optional_user)):
    stmt = select(Issue)
    if pincode:
        stmt = stmt.where(Issue.pincode == pincode.strip())
    if locality:
        stmt = stmt.where(func.lower(Issue.locality) == locality.strip().lower())
    issues = db.scalars(stmt).all()

    counts = {s: 0 for s in ("open", "in_progress", "rechecking", "resolved", "rejected")}
    by_cat: dict[str, int] = {}
    by_area: dict[tuple[str, str], int] = {}
    week_ago = now() - timedelta(days=7)
    this_week = 0
    fixed_this_week = 0
    for i in issues:
        counts[i.status] = counts.get(i.status, 0) + 1
        created = i.created_at if i.created_at.tzinfo else i.created_at.replace(tzinfo=week_ago.tzinfo)
        this_week += created >= week_ago
        if i.resolved_at:
            resolved = i.resolved_at if i.resolved_at.tzinfo else i.resolved_at.replace(tzinfo=week_ago.tzinfo)
            fixed_this_week += i.status == "resolved" and resolved >= week_ago
        if i.status in ("open", "in_progress", "rechecking"):
            by_cat[i.category] = by_cat.get(i.category, 0) + 1
            key = (i.locality or "Unknown area", i.pincode)
            by_area[key] = by_area.get(key, 0) + 1

    decided = counts["resolved"] + counts["open"] + counts["in_progress"] + counts["rechecking"]
    return {
        "total": len(issues),
        "open": counts["open"],
        "in_progress": counts["in_progress"],
        "rechecking": counts["rechecking"],
        "resolved": counts["resolved"],
        "resolved_pct": round(100 * counts["resolved"] / decided) if decided else 0,
        "avg_days_to_fix": resolution_days(issues),
        "this_week": this_week,
        "fixed_this_week": fixed_this_week,
        "by_category": sorted(
            ({"category": c, "label": CATEGORIES.get(c, c), "count": n} for c, n in by_cat.items()),
            key=lambda r: -r["count"],
        ),
        "top_areas": [
            {"locality": loc, "pincode": pin, "count": n}
            for (loc, pin), n in sorted(by_area.items(), key=lambda kv: -kv[1])[:6]
        ],
    }


# ---- Proof of work --------------------------------------------------------

def _aware(dt):
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=now().tzinfo)


@router.get("/stats/weekly")
def weekly(weeks: int = Query(8, ge=1, le=52), pincode: str = "", locality: str = "", db: Session = Depends(get_db)):
    """Reported vs fixed per week (weeks start on Monday), oldest first."""
    today = now().date()
    first = today - timedelta(days=today.weekday()) - timedelta(weeks=weeks - 1)
    stmt = select(Issue.created_at, Issue.resolved_at, Issue.status)
    if pincode:
        stmt = stmt.where(Issue.pincode == pincode.strip())
    if locality:
        stmt = stmt.where(func.lower(Issue.locality) == locality.strip().lower())
    buckets = [{"week_start": (first + timedelta(weeks=i)).isoformat(), "reported": 0, "fixed": 0} for i in range(weeks)]

    def slot(dt):
        if dt is None:
            return None
        i = (_aware(dt).date() - first).days // 7
        return i if 0 <= i < weeks else None

    for created, resolved, status in db.execute(stmt):
        if (i := slot(created)) is not None:
            buckets[i]["reported"] += 1
        if status == "resolved" and (i := slot(resolved)) is not None:
            buckets[i]["fixed"] += 1
    return buckets


@router.get("/stats/recent-fixes")
def recent_fixes(limit: int = Query(10, le=30), db: Session = Depends(get_db), user: User | None = Depends(optional_user)):
    """Latest fixed reports, with before/after photos first."""
    rows = db.scalars(select(Issue).where(Issue.status == "resolved", Issue.resolved_at.is_not(None))
                      .order_by(Issue.has_after_photo.desc(), Issue.resolved_at.desc()).limit(limit)).all()
    return [serialize(i, user) for i in rows]
