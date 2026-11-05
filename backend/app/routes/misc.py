from datetime import timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import gemini, geocode
from pydantic import BaseModel, Field

from ..auth import User, admin_user, current_user, optional_user, role_for_email
from ..config import settings
from ..db import CATEGORIES, Issue, StaffMember, get_db, now
from .issues import resolution_days

router = APIRouter(prefix="/api")


@router.get("/health")
def health():
    return {"ok": True}


@router.get("/config")
def public_config():
    """Everything the frontend needs at runtime, so one build works in every environment."""
    return {
        "auth_mode": "firebase" if settings.firebase_enabled else ("dev" if settings.dev_auth else "none"),
        "firebase": {
            "apiKey": settings.firebase_api_key,
            "authDomain": settings.firebase_auth_domain,
            "projectId": settings.firebase_project_id,
            "appId": settings.firebase_app_id,
        } if settings.firebase_enabled else None,
        "ai_enabled": settings.ai_enabled,
        "city": {"name": settings.city_name, "lat": settings.city_lat, "lng": settings.city_lng},
        "categories": [{"id": k, "label": v} for k, v in CATEGORIES.items()],
    }


@router.get("/me")
def me(user: User = Depends(current_user)):
    return {"uid": user.uid, "name": user.name, "email": user.email, "role": user.role, "is_admin": user.is_admin}


# ---- Staff (admins manage who is a worker / admin) --------------------------

class StaffIn(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    role: str = Field("worker", pattern="^(worker|admin)$")


def _staff_list(db: Session) -> list[dict]:
    rows = {m.email: {"email": m.email, "role": m.role, "source": "app", "added_by": m.added_by}
            for m in db.scalars(select(StaffMember).order_by(StaffMember.created_at))}
    for e in sorted(settings.worker_emails):
        rows.setdefault(e, {"email": e, "role": "worker", "source": "env", "added_by": ""})
    for e in sorted(settings.admin_emails):  # ADMIN_EMAILS always wins
        rows[e] = {"email": e, "role": "admin", "source": "env", "added_by": ""}
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

    counts = {s: 0 for s in ("open", "in_progress", "resolved", "rejected")}
    by_cat: dict[str, int] = {}
    by_area: dict[tuple[str, str], int] = {}
    week_ago = now() - timedelta(days=7)
    this_week = 0
    for i in issues:
        counts[i.status] = counts.get(i.status, 0) + 1
        created = i.created_at if i.created_at.tzinfo else i.created_at.replace(tzinfo=week_ago.tzinfo)
        this_week += created >= week_ago
        if i.status in ("open", "in_progress"):
            by_cat[i.category] = by_cat.get(i.category, 0) + 1
            key = (i.locality or "Unknown area", i.pincode)
            by_area[key] = by_area.get(key, 0) + 1

    decided = counts["resolved"] + counts["open"] + counts["in_progress"]
    return {
        "total": len(issues),
        "open": counts["open"],
        "in_progress": counts["in_progress"],
        "resolved": counts["resolved"],
        "resolved_pct": round(100 * counts["resolved"] / decided) if decided else 0,
        "avg_days_to_fix": resolution_days(issues),
        "this_week": this_week,
        "by_category": sorted(
            ({"category": c, "label": CATEGORIES.get(c, c), "count": n} for c, n in by_cat.items()),
            key=lambda r: -r["count"],
        ),
        "top_areas": [
            {"locality": loc, "pincode": pin, "count": n}
            for (loc, pin), n in sorted(by_area.items(), key=lambda kv: -kv[1])[:6]
        ],
    }
