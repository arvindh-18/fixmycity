"""Developer console for the demo build. Only mounted when DEMO_MODE is on (never in production)."""
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import demo
from ..auth import User, optional_user
from ..config import settings
from ..db import Base, get_db

router = APIRouter(prefix="/api/dev", tags=["developer (demo only)"])

ENDPOINTS = [
    ("GET", "/api/config", "Runtime config the app boots from"),
    ("GET", "/api/me", "Who the current token is (role, email)"),
    ("GET", "/api/issues?status=active&sort=top&limit=5", "Open reports, most +1s first"),
    ("GET", f"/api/issues/near?lat={settings.demo_lat}&lng={settings.demo_lng}&radius=1500", "Reports within 1.5 km of the college"),
    ("GET", "/api/issues/areas", "Localities and pincodes with reports"),
    ("GET", "/api/stats", "Headline numbers"),
    ("GET", "/api/stats/weekly?weeks=8", "Reported vs fixed per week (the proof-of-work chart)"),
    ("GET", "/api/stats/recent-fixes", "Latest fixes with before/after photos"),
    ("GET", "/api/admin/duplicates", "Pending duplicate suggestions (admin token)"),
    ("GET", "/api/staff", "Team list (admin token)"),
    ("GET", "/api/issues?worker=me&status=active", "My jobs (worker token)"),
    ("GET", "/api/issues?mine=1", "My reports (resident token)"),
]


@router.get("/overview")
def overview(db: Session = Depends(get_db), user: User | None = Depends(optional_user)):
    tables = {t.name: db.scalar(select(func.count()).select_from(t)) for t in Base.metadata.sorted_tables}
    return {
        "you": {"uid": user.uid, "name": user.name, "email": user.email, "role": user.role} if user else None,
        "database": settings.database_url.split("://")[0],
        "ai": "gemini" if settings.gemini_api_key else "offline demo model",
        "tables": tables,
        "personas": demo.PERSONAS,
        "endpoints": [{"method": m, "path": p, "what": w} for m, p, w in ENDPOINTS],
    }


@router.post("/reset")
def reset(db: Session = Depends(get_db)):
    """Wipe everything and regenerate the mock data (takes a few seconds)."""
    return demo.seed(db)
