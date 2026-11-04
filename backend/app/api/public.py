"""Public, no-account endpoints: issue browsing, map data, statistics, commitments, expenditure.

Everything here uses the PUBLIC serializers, which never contain reporter identity or internal notes.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from geoalchemy2.shape import to_shape
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core import rate_limit
from app.core.config import settings
from app.core.deps import client_ip, optional_user
from app.core.security import hash_token
from app.database.session import get_db
from app.integrations.ai import hotspots, provider
from app.models import (
    Announcement, Department, ExpenditureRecord, Issue, IssueCategory, IssueStatusHistory, Locality, PublicCommitment, User,
)
from app.schemas.serializers import counts_for, issue_card, issue_detail
from app.services import issue_service, pdf_export, stats
from app.services.lifecycle import STATUS_LABELS, TRANSITIONS

router = APIRouter(prefix="/api", tags=["public"])


def filtered_issues(
    status_: list[str] | None = None, category: list[uuid.UUID] | None = None,
    department: list[uuid.UUID] | None = None, locality: uuid.UUID | None = None,
    priority: list[str] | None = None, q: str | None = None,
    date_from: datetime | None = None, date_to: datetime | None = None,
    bbox: str | None = None,
):
    stmt = select(Issue)
    if status_:
        stmt = stmt.where(Issue.status.in_(status_))
    if category:
        stmt = stmt.where(Issue.category_id.in_(category))
    if department:
        stmt = stmt.where(Issue.department_id.in_(department))
    if locality:
        stmt = stmt.where(Issue.locality_id == locality)
    if priority:
        stmt = stmt.where(Issue.priority.in_(priority))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Issue.title.ilike(like), Issue.description.ilike(like),
                              Issue.tracking_id.ilike(like), Issue.address.ilike(like)))
    if date_from:
        stmt = stmt.where(Issue.created_at >= date_from)
    if date_to:
        stmt = stmt.where(Issue.created_at <= date_to)
    if bbox:
        try:
            w, s, e, n = (float(x) for x in bbox.split(","))
        except ValueError:
            raise HTTPException(422, "bbox must be west,south,east,north")
        stmt = stmt.where(func.ST_Intersects(Issue.location, func.Geography(func.ST_MakeEnvelope(w, s, e, n, 4326))))
    return stmt


SORTS = {
    "newest": Issue.created_at.desc(), "oldest": Issue.created_at.asc(),
    "updated": Issue.updated_at.desc(), "resolved": Issue.resolved_at.desc().nulls_last(),
}


@router.get("/meta")
def meta(db: Session = Depends(get_db)):
    cats = db.scalars(select(IssueCategory).where(IssueCategory.is_active).order_by(IssueCategory.name)).all()
    depts = db.scalars(select(Department).order_by(Department.name)).all()
    locs = db.scalars(select(Locality).order_by(Locality.name)).all()
    return {
        "city": {"name": settings.city_name, "lat": settings.city_lat, "lng": settings.city_lng},
        "categories": [{"id": str(c.id), "name": c.name, "slug": c.slug, "icon": c.icon, "description": c.description,
                        "default_department_id": str(c.default_department_id) if c.default_department_id else None}
                       for c in cats],
        "departments": [{"id": str(d.id), "name": d.name, "code": d.code} for d in depts],
        "localities": [{"id": str(l.id), "name": l.name, "is_approximate": l.is_approximate} for l in locs],
        "statuses": [{"value": k, "label": v} for k, v in STATUS_LABELS.items()],
        "transitions": [{"from": a, "to": b, "actors": sorted(r)} for (a, b), r in TRANSITIONS.items()],
        "ai": {"mode": provider.mode(), "provider": provider.provider_name()},
    }


@router.get("/issues")
def list_issues(
    status_: list[str] | None = Query(None, alias="status"), category: list[uuid.UUID] | None = Query(None),
    department: list[uuid.UUID] | None = Query(None), locality: uuid.UUID | None = None,
    priority: list[str] | None = Query(None), q: str | None = Query(None, max_length=100),
    date_from: datetime | None = None, date_to: datetime | None = None, bbox: str | None = None,
    sort: str = "newest", page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    base = filtered_issues(status_, category, department, locality, priority, q, date_from, date_to, bbox)
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    rows = db.scalars(base.options(selectinload(Issue.images)).order_by(SORTS.get(sort, SORTS["newest"]))
                      .offset((page - 1) * page_size).limit(page_size)).unique().all()
    counts = counts_for(db, [i.id for i in rows])
    return {"items": [issue_card(i, counts[i.id]) for i in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/issues/{tracking_id}")
def get_issue(tracking_id: str, db: Session = Depends(get_db), user: User | None = Depends(optional_user)):
    issue = issue_service.get_by_tracking(db, tracking_id)
    return issue_detail(db, issue, user)


@router.get("/issues/{tracking_id}/timeline")
def get_timeline(tracking_id: str, db: Session = Depends(get_db), user: User | None = Depends(optional_user)):
    issue = issue_service.get_by_tracking(db, tracking_id)
    internal = bool(user and user.role in ("admin", "worker"))
    return issue_service.timeline(db, issue, include_internal=internal)


@router.get("/issues/{tracking_id}/evidence")
def get_evidence(tracking_id: str, db: Session = Depends(get_db), user: User | None = Depends(optional_user)):
    issue = issue_service.get_by_tracking(db, tracking_id)
    return issue_service.evidence_list(db, issue, include_internal=bool(user and user.role in ("admin", "worker")))


@router.get("/issues/{tracking_id}/export.pdf")
def export_pdf(tracking_id: str, request: Request, db: Session = Depends(get_db)):
    rate_limit.check(f"pdf:{client_ip(request)}", 20, 60)
    issue = issue_service.get_by_tracking(db, tracking_id)
    data = issue_detail(db, issue, None)
    pdf = pdf_export.build(data, issue_service.timeline(db, issue, False), issue_service.evidence_list(db, issue, False))
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{issue.tracking_id}-history.pdf"'})


class TrackIn(BaseModel):
    tracking_id: str = Field(min_length=5, max_length=20)
    token: str = Field(min_length=10, max_length=100)


@router.post("/track")
def track_anonymous(body: TrackIn, request: Request, db: Session = Depends(get_db)):
    """Anonymous reporters prove ownership with the secret token shown at submission."""
    rate_limit.check(f"track:{client_ip(request)}", 20, 60)
    issue = issue_service.get_by_tracking(db, body.tracking_id)
    if not issue.anon_token_hash or issue.anon_token_hash != hash_token(body.token.strip()):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "That tracking ID and token don't match.")
    return {"issue": issue_detail(db, issue, None), "verified_reporter": True}


@router.get("/activity")
def activity(limit: int = Query(12, ge=1, le=50), db: Session = Depends(get_db)):
    """The city-wide public ledger: latest public status changes across all issues."""
    rows = db.execute(
        select(IssueStatusHistory, Issue.tracking_id, Issue.title, Issue.is_demo, IssueCategory.icon)
        .join(Issue, Issue.id == IssueStatusHistory.issue_id)
        .join(IssueCategory, IssueCategory.id == Issue.category_id)
        .where(IssueStatusHistory.is_public)
        .order_by(IssueStatusHistory.created_at.desc()).limit(limit)
    ).all()
    actor = {"admin": "An official", "worker": "The crew", "citizen": "The reporter", "anonymous": "The reporter", "system": "Commons"}
    return [{"id": str(h.id), "at": h.created_at, "tracking_id": tid, "title": title, "status": h.to_status,
             "status_label": STATUS_LABELS[h.to_status], "reason": h.reason, "actor": actor.get(h.actor_role, h.actor_role),
             "is_demo": demo, "icon": icon} for h, tid, title, demo, icon in rows]


# ---------------------------------------------------------------- map
@router.get("/map/issues")
def map_issues(
    status_: list[str] | None = Query(None, alias="status"), category: list[uuid.UUID] | None = Query(None),
    department: list[uuid.UUID] | None = Query(None), priority: list[str] | None = Query(None),
    date_from: datetime | None = None, date_to: datetime | None = None, locality: uuid.UUID | None = None,
    db: Session = Depends(get_db),
):
    """GeoJSON FeatureCollection for MapLibre (clustering and heatmap happen client-side)."""
    base = filtered_issues(status_, category, department, locality, priority, None, date_from, date_to)
    rows = db.scalars(base.limit(5000)).all()
    counts = counts_for(db, [i.id for i in rows])
    feats = []
    for i in rows:
        p = to_shape(i.location)
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [p.x, p.y]},
                      "properties": {"id": str(i.id), "tracking_id": i.tracking_id, "title": i.title, "status": i.status,
                                     "status_label": STATUS_LABELS[i.status], "priority": i.priority or "unset",
                                     "category": i.category.name, "category_slug": i.category.slug,
                                     "department": i.department.name if i.department else None,
                                     "support": counts[i.id]["support_count"],
                                     "created_at": i.created_at.isoformat(), "is_demo": i.is_demo}})
    return {"type": "FeatureCollection", "features": feats}


@router.get("/map/localities")
def map_localities(db: Session = Depends(get_db)):
    summary = {s["id"]: s for s in stats.localities_summary(db)}
    out = []
    for loc in db.scalars(select(Locality)).all():
        if loc.boundary is None:
            continue
        shape = to_shape(loc.boundary)
        c = shape.representative_point()  # always inside the area, unlike a centroid
        s = summary.get(str(loc.id), {})
        out.append({"type": "Feature", "geometry": shape.__geo_interface__,
                    "properties": {"id": str(loc.id), "name": loc.name, "is_approximate": loc.is_approximate,
                                   "boundary_source": loc.boundary_source, "center": [c.x, c.y],
                                   "total": s.get("total", 0), "open": s.get("open", 0), "resolved": s.get("resolved", 0)}})
    return {"type": "FeatureCollection", "features": out}


@router.get("/localities/{locality_id}/stats")
def locality_stats(locality_id: uuid.UUID, db: Session = Depends(get_db)):
    data = stats.locality_stats(db, locality_id)
    if not data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Locality not found.")
    return data


@router.get("/nearby")
def nearby(lat: float = Query(ge=-90, le=90), lng: float = Query(ge=-180, le=180),
           radius_m: int = Query(1000, ge=50, le=5000), db: Session = Depends(get_db)):
    pt = func.Geography(func.ST_SetSRID(func.ST_MakePoint(lng, lat), 4326))
    rows = db.execute(select(Issue, func.ST_Distance(Issue.location, pt).label("m"))
                      .where(func.ST_DWithin(Issue.location, pt, radius_m), Issue.status != "rejected")
                      .options(selectinload(Issue.images)).order_by("m").limit(30)).all()
    counts = counts_for(db, [i.id for i, _ in rows])
    return [{**issue_card(i, counts[i.id]), "distance_m": int(m)} for i, m in rows]


# ---------------------------------------------------------------- statistics
def _stat_filters(date_from, date_to, department, locality, category):
    return {"date_from": date_from, "date_to": date_to, "department_id": department,
            "locality_id": locality, "category_id": category}


@router.get("/stats/overview")
def stats_overview(date_from: datetime | None = None, date_to: datetime | None = None,
                   department: uuid.UUID | None = None, locality: uuid.UUID | None = None,
                   category: uuid.UUID | None = None, db: Session = Depends(get_db)):
    return stats.overview(db, **_stat_filters(date_from, date_to, department, locality, category))


@router.get("/stats/trends")
def stats_trends(months: int = Query(12, ge=1, le=36), department: uuid.UUID | None = None,
                 locality: uuid.UUID | None = None, category: uuid.UUID | None = None, db: Session = Depends(get_db)):
    return stats.monthly_trends(db, months, department_id=department, locality_id=locality, category_id=category)


@router.get("/stats/categories")
def stats_categories(date_from: datetime | None = None, date_to: datetime | None = None,
                     department: uuid.UUID | None = None, locality: uuid.UUID | None = None, db: Session = Depends(get_db)):
    return stats.by_category(db, **_stat_filters(date_from, date_to, department, locality, None))


@router.get("/stats/priorities")
def stats_priorities(department: uuid.UUID | None = None, db: Session = Depends(get_db)):
    return stats.by_priority(db, department_id=department)


@router.get("/stats/departments")
def stats_departments(date_from: datetime | None = None, date_to: datetime | None = None,
                      locality: uuid.UUID | None = None, category: uuid.UUID | None = None, db: Session = Depends(get_db)):
    return stats.department_scorecards(db, date_from=date_from, date_to=date_to, locality_id=locality, category_id=category)


@router.get("/stats/localities")
def stats_localities(db: Session = Depends(get_db)):
    return stats.localities_summary(db)


@router.get("/hotspots")
def get_hotspots(radius_m: int = Query(250, ge=50, le=2000), min_reports: int = Query(3, ge=2, le=50),
                 days: int = Query(180, ge=7, le=730), db: Session = Depends(get_db)):
    return hotspots.detect(db, eps_m=radius_m, min_points=min_reports, days=days)


# ---------------------------------------------------------------- transparency content
def commitment_dict(c: PublicCommitment) -> dict:
    return {"id": str(c.id), "title": c.title, "description": c.description,
            "department": {"id": str(c.department.id), "name": c.department.name},
            "locality": {"id": str(c.locality.id), "name": c.locality.name} if c.locality else None,
            "expected_completion": c.expected_completion, "progress_percent": c.progress_percent,
            "status": c.status, "evidence_url": c.evidence_url, "progress_note": c.progress_note,
            "is_demo": c.is_demo, "created_at": c.created_at, "updated_at": c.updated_at}


def expenditure_dict(e: ExpenditureRecord, db: Session) -> dict:
    issue = db.get(Issue, e.issue_id) if e.issue_id else None
    return {"id": str(e.id), "department": {"id": str(e.department.id), "name": e.department.name},
            "issue": {"tracking_id": issue.tracking_id, "title": issue.title} if issue else None,
            "commitment_id": str(e.commitment_id) if e.commitment_id else None,
            "work_description": e.work_description,
            "estimated_cost": float(e.estimated_cost), "actual_cost": float(e.actual_cost) if e.actual_cost is not None else None,
            "currency": e.currency, "verification_status": e.verification_status,
            "source_document_url": e.source_document_url, "is_demo": e.is_demo, "updated_at": e.updated_at}


def announcement_dict(a: Announcement) -> dict:
    return {"id": str(a.id), "title": a.title, "body": a.body, "is_pinned": a.is_pinned,
            "department": a.department.name if a.department else None,
            "locality": a.locality.name if a.locality else None, "created_at": a.created_at}


@router.get("/commitments")
def list_commitments(db: Session = Depends(get_db)):
    rows = db.scalars(select(PublicCommitment).order_by(PublicCommitment.expected_completion)).all()
    return [commitment_dict(c) for c in rows]


@router.get("/expenditures")
def list_expenditures(db: Session = Depends(get_db)):
    rows = db.scalars(select(ExpenditureRecord).order_by(ExpenditureRecord.updated_at.desc())).all()
    return [expenditure_dict(e, db) for e in rows]


@router.get("/announcements")
def list_announcements(db: Session = Depends(get_db)):
    rows = db.scalars(select(Announcement).order_by(Announcement.is_pinned.desc(), Announcement.created_at.desc()).limit(30)).all()
    return [announcement_dict(a) for a in rows]
