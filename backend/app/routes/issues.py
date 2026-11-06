import io
import math
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from PIL import Image, ImageOps
from pydantic import BaseModel
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session, undefer

from .. import duplicates, geocode
from ..auth import User, admin_user, current_user, optional_user, role_for_email, staff_user
from ..config import settings
from ..db import CATEGORIES, SEVERITIES, STATUSES, Issue, StaffMember, StatusUpdate, Upvote, get_db, now

router = APIRouter(prefix="/api/issues", tags=["issues"])

STATUS_LABELS = {
    "open": "Reported",
    "in_progress": "Being fixed",
    "rechecking": "Rechecking",
    "resolved": "Fixed",
    "rejected": "Closed",
}


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).isoformat()


def serialize(issue: Issue, user: User | None, voted: set[int] | None = None, detail: bool = False) -> dict:
    data = {
        "id": issue.id,
        "title": issue.title,
        "description": issue.description,
        "category": issue.category,
        "category_label": CATEGORIES.get(issue.category, issue.category),
        "severity": issue.severity,
        "status": issue.status,
        "lat": issue.lat,
        "lng": issue.lng,
        "address": issue.address,
        "locality": issue.locality,
        "pincode": issue.pincode,
        "photo_url": f"/api/issues/{issue.id}/photo" if issue.has_photo else None,
        "reporter_name": issue.reporter_name,
        "upvotes": issue.upvotes,
        "upvoted": bool(voted and issue.id in voted),
        "is_mine": bool(user and user.uid == issue.reporter_uid),
        "created_at": iso(issue.created_at),
        "updated_at": iso(issue.updated_at),
        "resolved_at": iso(issue.resolved_at),
        "original_text": issue.original_text or "",
        "merged_into": issue.merged_into,
        # Transparency: everyone sees who is on the job by name; only staff see the email.
        "assigned_to_email": (issue.assigned_to_email or "") if user and user.is_staff else "",
        "assigned_to_name": issue.assigned_to_name or "",
        "assigned_at": iso(issue.assigned_at),
        "fixed_by_name": issue.fixed_by_name or "",
        "is_assigned_to_me": bool(user and user.email and issue.assigned_to_email == user.email),
        "after_photo_url": f"/api/issues/{issue.id}/after-photo" if issue.has_after_photo else None,
    }
    if detail:
        data["updates"] = [
            {"status": u.status, "label": STATUS_LABELS.get(u.status, u.status), "note": u.note,
             "by_name": u.by_name, "created_at": iso(u.created_at)}
            for u in issue.updates
        ]
    return data


def _voted(db: Session, user: User | None, ids: list[int]) -> set[int]:
    if not user or not ids:
        return set()
    rows = db.scalars(select(Upvote.issue_id).where(Upvote.uid == user.uid, Upvote.issue_id.in_(ids)))
    return set(rows)


def _get(db: Session, issue_id: int) -> Issue:
    issue = db.get(Issue, issue_id)
    if not issue:
        raise HTTPException(404, "That report does not exist (it may have been removed).")
    return issue


@router.get("")
def list_issues(
    q: str = "",
    pincode: str = "",
    locality: str = "",
    status: str = Query("", description="open | in_progress | resolved | rejected | active"),
    category: str = "",
    mine: bool = False,
    worker: str = Query("", description="'me': jobs assigned to or fixed by the signed-in worker"),
    unassigned: bool = False,
    sort: str = Query("new", pattern="^(new|top|fixed)$"),
    limit: int = Query(300, le=1000),
    db: Session = Depends(get_db),
    user: User | None = Depends(optional_user),
):
    stmt = select(Issue)
    if pincode:
        stmt = stmt.where(Issue.pincode == pincode.strip())
    if locality:
        stmt = stmt.where(func.lower(Issue.locality) == locality.strip().lower())
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(Issue.title).like(like), func.lower(Issue.locality).like(like),
                              Issue.pincode.like(like), func.lower(Issue.address).like(like)))
    if status == "active":
        stmt = stmt.where(Issue.status.in_(("open", "in_progress", "rechecking")))
    elif status:
        stmt = stmt.where(Issue.status == status)
    if category:
        stmt = stmt.where(Issue.category == category)
    if mine:
        if not user:
            raise HTTPException(401, "Sign in to see your reports.")
        stmt = stmt.where(Issue.reporter_uid == user.uid)
    if worker == "me":
        if not user or not user.is_staff:
            raise HTTPException(403, "Only field workers have a job list.")
        stmt = stmt.where(or_(Issue.assigned_to_email == user.email, Issue.fixed_by_email == user.email))
    if unassigned:
        stmt = stmt.where(or_(Issue.assigned_to_email.is_(None), Issue.assigned_to_email == ""))
    order = {
        "top": (Issue.upvotes.desc(), Issue.created_at.desc()),
        "fixed": (Issue.resolved_at.desc(), Issue.created_at.desc()),
    }.get(sort, (Issue.created_at.desc(),))
    issues = db.scalars(stmt.order_by(*order).limit(limit)).all()
    voted = _voted(db, user, [i.id for i in issues])
    from .messages import unread_counts  # local import: messages imports this module
    unread = unread_counts(db, user, issues)
    return [{**serialize(i, user, voted), "unread": unread.get(i.id, 0)} for i in issues]


def _distance_m(lat1, lng1, lat2, lng2) -> float:
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


@router.get("/nearby")
def nearby(lat: float, lng: float, category: str = "", radius: int = Query(150, le=1000),
           db: Session = Depends(get_db), user: User | None = Depends(optional_user)):
    """Open reports close to a pin — shown before submitting so people upvote instead of duplicating."""
    d = radius / 111_000
    stmt = select(Issue).where(
        Issue.status.in_(("open", "in_progress", "rechecking")),
        Issue.lat.between(lat - d, lat + d), Issue.lng.between(lng - d * 1.2, lng + d * 1.2),
    )
    if category:
        stmt = stmt.where(Issue.category == category)
    rows = [(i, _distance_m(lat, lng, i.lat, i.lng)) for i in db.scalars(stmt)]
    rows = sorted((r for r in rows if r[1] <= radius), key=lambda r: r[1])[:5]
    voted = _voted(db, user, [i.id for i, _ in rows])
    return [{**serialize(i, user, voted), "distance_m": round(dist)} for i, dist in rows]


@router.get("/near")
def near(lat: float, lng: float, radius: int = Query(2000, ge=100, le=10000), status: str = "",
         unassigned: bool = False, limit: int = Query(200, le=500),
         db: Session = Depends(get_db), user: User | None = Depends(optional_user)):
    """Every report around a point (e.g. "my location"), closest first. `status` may also be `active`."""
    d = radius / 111_000
    dlng = d / max(0.2, math.cos(math.radians(lat)))
    stmt = select(Issue).where(Issue.lat.between(lat - d, lat + d), Issue.lng.between(lng - dlng, lng + dlng))
    if status == "active":
        stmt = stmt.where(Issue.status.in_(("open", "in_progress", "rechecking")))
    elif status:
        stmt = stmt.where(Issue.status == status)
    if unassigned:
        stmt = stmt.where(or_(Issue.assigned_to_email.is_(None), Issue.assigned_to_email == ""))
    rows = [(i, _distance_m(lat, lng, i.lat, i.lng)) for i in db.scalars(stmt)]
    rows = sorted((r for r in rows if r[1] <= radius), key=lambda r: r[1])[:limit]
    voted = _voted(db, user, [i.id for i, _ in rows])
    return [{**serialize(i, user, voted), "distance_m": round(dist)} for i, dist in rows]


@router.get("/areas")
def areas(db: Session = Depends(get_db)):
    """Every locality/pincode that has reports — powers the area search box."""
    rows = db.execute(
        select(Issue.locality, Issue.pincode, func.count(Issue.id),
               func.sum(case((Issue.status.in_(("open", "in_progress", "rechecking")), 1), else_=0)))
        .group_by(Issue.locality, Issue.pincode)
        .order_by(func.count(Issue.id).desc())
    ).all()
    return [{"locality": loc, "pincode": pin, "total": total, "active": int(active or 0)}
            for loc, pin, total, active in rows if loc or pin]


def _process_photo(raw: bytes) -> bytes:
    try:
        img = Image.open(io.BytesIO(raw))
        img = ImageOps.exif_transpose(img).convert("RGB")
    except Exception:
        raise HTTPException(400, "That file is not an image we can read. Use a JPG, PNG or WebP photo.")
    img.thumbnail((1400, 1400))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=80, optimize=True)
    return out.getvalue()


@router.post("", status_code=201)
async def create_issue(
    title: str = Form(..., min_length=3, max_length=140),
    category: str = Form(...),
    lat: float = Form(...),
    lng: float = Form(...),
    description: str = Form(""),
    severity: str = Form("medium"),
    address: str = Form(""),
    locality: str = Form(""),
    pincode: str = Form(""),
    original_text: str = Form("", max_length=3000),
    photo: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    if category not in CATEGORIES:
        raise HTTPException(422, f"Unknown category. Use one of: {', '.join(CATEGORIES)}.")
    if severity not in SEVERITIES:
        severity = "medium"
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(422, "Drop the pin on the map to set a location.")

    photo_bytes = None
    if photo is not None and photo.filename:
        raw = await photo.read()
        if len(raw) > settings.max_upload_mb * 1024 * 1024:
            raise HTTPException(413, f"Photo is larger than {settings.max_upload_mb} MB.")
        photo_bytes = _process_photo(raw)

    if not (locality and pincode):
        place = geocode.reverse(lat, lng)
        locality = locality or place["locality"]
        pincode = pincode or place["pincode"]
        address = address or place["address"]

    issue = Issue(
        title=title.strip(), description=description.strip(), category=category, severity=severity,
        lat=lat, lng=lng, address=address[:300], locality=locality.strip()[:120], pincode=pincode.strip()[:12],
        photo=photo_bytes, has_photo=1 if photo_bytes else 0, original_text=original_text.strip(),
        reporter_uid=user.uid, reporter_name=user.name,
    )
    issue.updates.append(StatusUpdate(status="open", note="Reported", by_name=user.name))
    db.add(issue)
    db.commit()
    flags = duplicates.flag(db, issue)
    return {**serialize(issue, user, detail=True), "likely_duplicate_of": [f.candidate_id for f in flags]}


@router.get("/{issue_id}")
def get_issue(issue_id: int, db: Session = Depends(get_db), user: User | None = Depends(optional_user)):
    issue = _get(db, issue_id)
    return serialize(issue, user, _voted(db, user, [issue.id]), detail=True)


@router.get("/{issue_id}/photo")
def get_photo(issue_id: int, db: Session = Depends(get_db)):
    issue = db.scalar(select(Issue).options(undefer(Issue.photo)).where(Issue.id == issue_id))
    if not issue or not issue.photo:
        raise HTTPException(404, "No photo")
    return Response(issue.photo, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})


@router.get("/{issue_id}/after-photo")
def get_after_photo(issue_id: int, db: Session = Depends(get_db)):
    issue = db.scalar(select(Issue).options(undefer(Issue.after_photo)).where(Issue.id == issue_id))
    if not issue or not issue.after_photo:
        raise HTTPException(404, "No after photo")
    return Response(issue.after_photo, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})


def mask_email(email: str) -> str:
    local, _, domain = (email or "").partition("@")
    return f"{local[:2]}•••@{domain}" if domain else "a field worker"


def staff_name(db: Session, email: str) -> str:
    """Public display name for a staff member: their name if we know it, else a masked email."""
    member = db.get(StaffMember, email) if email else None
    return (member.name if member and member.name else "") or mask_email(email)


def _assign_to(issue: Issue, email: str, name: str) -> None:
    issue.assigned_to_email, issue.assigned_to_name, issue.assigned_at = email, name, now()


def _check_worker_owns(issue: Issue, user: User) -> None:
    """A worker may act on unassigned jobs (picking them up) or their own, not a colleague's."""
    if user.is_worker and issue.assigned_to_email and issue.assigned_to_email != user.email:
        raise HTTPException(403, f"This job is assigned to {issue.assigned_to_name or 'another worker'}.")


@router.post("/{issue_id}/upvote")
def toggle_upvote(issue_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    issue = _get(db, issue_id)
    # +1 is a resident's "me too": staff don't vote, and a reporter's own report already counts them.
    if user.is_staff:
        raise HTTPException(403, "Only residents can +1 reports. Staff see every report anyway.")
    if user.uid == issue.reporter_uid:
        raise HTTPException(403, "You reported this, so you're already counted. +1 is for neighbours who've seen it too.")
    existing = db.scalar(select(Upvote).where(Upvote.issue_id == issue_id, Upvote.uid == user.uid))
    if existing:
        db.delete(existing)
        issue.upvotes = max(0, issue.upvotes - 1)
    else:
        db.add(Upvote(issue_id=issue_id, uid=user.uid))
        issue.upvotes += 1
    db.commit()
    return {"upvotes": issue.upvotes, "upvoted": not existing}


class StatusIn(BaseModel):
    status: str
    note: str = ""


WORKER_STATUSES = ("in_progress", "resolved")


@router.post("/{issue_id}/status")
def set_status(issue_id: int, body: StatusIn, db: Session = Depends(get_db), user: User = Depends(staff_user)):
    if body.status not in STATUSES:
        raise HTTPException(422, f"Status must be one of: {', '.join(STATUSES)}.")
    if user.is_worker and body.status not in WORKER_STATUSES:
        raise HTTPException(403, "Field workers can mark a report as 'Being fixed' or 'Fixed'. Ask an admin to close or reopen it.")
    issue = _get(db, issue_id)
    _check_worker_owns(issue, user)
    if user.is_worker and body.status == "resolved" and not issue.has_after_photo:
        raise HTTPException(422, "Add an 'after' photo to mark this fixed. Use the Mark fixed button.")
    if body.status == issue.status and not body.note.strip():
        raise HTTPException(409, "The report already has that status. Add a note to post an update.")
    issue.status = body.status
    issue.updated_at = now()
    issue.resolved_at = now() if body.status == "resolved" else None
    if user.is_worker and not issue.assigned_to_email:  # starting work picks the job up
        _assign_to(issue, user.email, user.name)
    if body.status == "resolved":
        issue.fixed_by_email, issue.fixed_by_name = user.email, user.name
    issue.updates.append(StatusUpdate(status=body.status, note=body.note.strip(), by_name=user.name))
    db.commit()
    return serialize(issue, user, _voted(db, user, [issue.id]), detail=True)


@router.post("/{issue_id}/fix")
async def mark_fixed(issue_id: int, photo: UploadFile = File(...), note: str = Form("", max_length=1000),
                     db: Session = Depends(get_db), user: User = Depends(staff_user)):
    """Field worker marks a job fixed with an 'after' photo as proof."""
    issue = _get(db, issue_id)
    if issue.status == "rejected":
        raise HTTPException(409, "This report was closed. Ask an admin to reopen it first.")
    _check_worker_owns(issue, user)
    raw = await photo.read()
    if len(raw) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"Photo is larger than {settings.max_upload_mb} MB.")
    issue.after_photo, issue.has_after_photo = _process_photo(raw), 1
    issue.status, issue.updated_at, issue.resolved_at = "resolved", now(), now()
    issue.fixed_by_email, issue.fixed_by_name = user.email, user.name
    if user.is_worker and not issue.assigned_to_email:
        _assign_to(issue, user.email, user.name)
    issue.updates.append(StatusUpdate(status="resolved", note=note.strip() or "Fixed. See the after photo.", by_name=user.name))
    db.commit()
    return serialize(issue, user, _voted(db, user, [issue.id]), detail=True)


class ReopenIn(BaseModel):
    note: str = ""


@router.post("/{issue_id}/reopen")
def reopen_issue(issue_id: int, body: ReopenIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Reopen a solved issue if the fix was inadequate or fake. Sets status to 'rechecking' for admin inspection."""
    issue = _get(db, issue_id)
    if issue.status != "resolved":
        raise HTTPException(422, "Only solved/fixed reports can be reopened for rechecking.")
    note = body.note.strip() or "Reopened for rechecking — reported that this issue was not properly fixed."
    issue.status = "rechecking"
    issue.resolved_at = None
    issue.updated_at = now()
    issue.updates.append(StatusUpdate(status="rechecking", note=note, by_name=user.name))
    db.commit()
    return serialize(issue, user, _voted(db, user, [issue.id]), detail=True)


class AssignIn(BaseModel):
    email: str = ""


@router.post("/{issue_id}/assign")
def assign(issue_id: int, body: AssignIn, db: Session = Depends(get_db), user: User = Depends(admin_user)):
    issue = _get(db, issue_id)
    email = body.email.strip().lower()
    if email and role_for_email(email) == "public":
        raise HTTPException(422, "That email isn't on the team. Add it under Admin → Team first.")
    if (issue.assigned_to_email or "") == email:
        return serialize(issue, user, _voted(db, user, [issue.id]), detail=True)
    if email:
        _assign_to(issue, email, staff_name(db, email))
    else:
        issue.assigned_to_email, issue.assigned_to_name, issue.assigned_at = None, "", None
    issue.updated_at = now()
    # The public timeline names the worker, never their email.
    note = f"Assigned to field worker {issue.assigned_to_name}." if email else "Unassigned."
    issue.updates.append(StatusUpdate(status=issue.status, note=note, by_name=user.name))
    db.commit()
    return serialize(issue, user, _voted(db, user, [issue.id]), detail=True)


@router.delete("/{issue_id}", status_code=204)
def delete_issue(issue_id: int, db: Session = Depends(get_db), user: User = Depends(admin_user)):
    db.delete(_get(db, issue_id))
    db.commit()
    return Response(status_code=204)


def resolution_days(issues: list[Issue]) -> float | None:
    spans = [(i.resolved_at - i.created_at) for i in issues if i.resolved_at]
    if not spans:
        return None
    return round(sum(spans, timedelta()).total_seconds() / 86400 / len(spans), 1)
