from datetime import timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import gemini, geocode
from ..auth import User, current_user, optional_user
from ..config import settings
from ..db import CATEGORIES, Issue, get_db, now
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
    return {"uid": user.uid, "name": user.name, "email": user.email, "is_admin": user.is_admin}


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
