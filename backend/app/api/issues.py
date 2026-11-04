"""Citizen actions on issues: report, support, follow, confirm/dispute, reopen, feedback."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core import rate_limit
from app.core.deps import client_ip, get_current_user, optional_user, require_role
from app.core.security import hash_token, new_anonymous_token
from app.database.session import get_db
from app.integrations.ai import duplicates
from app.models import (
    CitizenFeedback, Issue, IssueEvidence, IssueFollower, IssueUpdate, IssueVote, User,
)
from app.schemas.inputs import ConfirmIn, DisputeIn, DuplicateCheckIn, FeedbackIn, TransitionIn
from app.schemas.serializers import counts_for, issue_card, issue_detail
from app.services import audit, issue_service, lifecycle, notifications, storage

router = APIRouter(prefix="/api", tags=["citizen"])

MAX_PHOTOS = 4


@router.post("/issues", status_code=201)
def report_issue(
    request: Request,
    title: str = Form(..., min_length=5, max_length=140),
    description: str = Form(..., min_length=15, max_length=5000),
    category_id: uuid.UUID = Form(...),
    lat: float = Form(..., ge=-90, le=90),
    lng: float = Form(..., ge=-180, le=180),
    address: str | None = Form(None, max_length=255),
    additional_info: str | None = Form(None, max_length=2000),
    photos: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    user: User | None = Depends(optional_user),
):
    """Signed-in citizens report under their account. Anyone else reports anonymously and gets a
    one-time secret token for private tracking. Staff accounts can't file citizen reports."""
    if user and user.role != "citizen":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Staff accounts can't file citizen reports.")
    rate_limit.check(f"report:{user.id if user else client_ip(request)}", 10, 3600)
    photos = [p for p in photos if p and p.filename]
    if len(photos) > MAX_PHOTOS:
        raise HTTPException(422, f"Attach up to {MAX_PHOTOS} photos.")
    saved = [storage.save_image_with_bytes(p, "reports") for p in photos]
    urls = [u for u, _ in saved]
    token = None if user else new_anonymous_token()
    issue = issue_service.create_issue(
        db, title=title, description=description, category_id=category_id, lat=lat, lng=lng,
        address=address, additional_info=additional_info, reporter=user,
        anon_token_hash=hash_token(token) if token else None, image_urls=urls, ip=client_ip(request),
        first_image=saved[0][1] if saved else None,
    )
    if user:
        db.add(IssueFollower(issue_id=issue.id, user_id=user.id))
    db.commit()
    db.refresh(issue)
    return {"tracking_id": issue.tracking_id, "id": str(issue.id), "anonymous_token": token,
            "issue": issue_detail(db, issue, user)}


@router.post("/issues/check-duplicates")
def check_duplicates(body: DuplicateCheckIn, db: Session = Depends(get_db)):
    """Called while the citizen fills the form, before anything is saved."""
    return duplicates.find(db, lat=body.lat, lng=body.lng, title=body.title, description=body.description,
                           category_id=body.category_id)


@router.get("/me/issues")
def my_issues(db: Session = Depends(get_db), user: User = Depends(require_role("citizen"))):
    rows = db.scalars(select(Issue).where(Issue.reporter_id == user.id).options(selectinload(Issue.images))
                      .order_by(Issue.updated_at.desc())).all()
    counts = counts_for(db, [i.id for i in rows])
    return [issue_card(i, counts[i.id]) for i in rows]


@router.get("/me/following")
def my_following(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.scalars(select(Issue).join(IssueFollower, IssueFollower.issue_id == Issue.id)
                      .where(IssueFollower.user_id == user.id, Issue.reporter_id.is_distinct_from(user.id))
                      .options(selectinload(Issue.images)).order_by(Issue.updated_at.desc())).all()
    counts = counts_for(db, [i.id for i in rows])
    return [issue_card(i, counts[i.id]) for i in rows]


@router.post("/issues/{issue_id}/support")
def support(issue_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_role("citizen"))):
    issue = issue_service.get_by_id(db, issue_id)
    if issue.reporter_id == user.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "You reported this issue — your report already counts.")
    if issue.status in ("rejected",):
        raise HTTPException(status.HTTP_409_CONFLICT, "Rejected reports can't be supported.")
    try:
        db.add(IssueVote(issue_id=issue.id, user_id=user.id))
        if not db.get(IssueFollower, (issue.id, user.id)):
            db.add(IssueFollower(issue_id=issue.id, user_id=user.id))
        db.commit()
    except IntegrityError:  # composite primary key = database-enforced one vote per account
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "You already support this issue.")
    return counts_for(db, [issue.id])[issue.id]


@router.delete("/issues/{issue_id}/support")
def unsupport(issue_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require_role("citizen"))):
    vote = db.get(IssueVote, (issue_id, user.id))
    if vote:
        db.delete(vote)
        db.commit()
    return counts_for(db, [issue_id])[issue_id]


@router.post("/issues/{issue_id}/follow")
def follow(issue_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    issue_service.get_by_id(db, issue_id)
    if not db.get(IssueFollower, (issue_id, user.id)):
        db.add(IssueFollower(issue_id=issue_id, user_id=user.id))
        db.commit()
    return {"following": True}


@router.delete("/issues/{issue_id}/follow")
def unfollow(issue_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    f = db.get(IssueFollower, (issue_id, user.id))
    if f:
        db.delete(f)
        db.commit()
    return {"following": False}


def _latest_evidence(db: Session, issue: Issue) -> IssueEvidence | None:
    return db.scalar(select(IssueEvidence).where(IssueEvidence.issue_id == issue.id)
                     .order_by(IssueEvidence.submitted_at.desc()).limit(1))


@router.post("/issues/{issue_id}/confirm")
def confirm_resolution(issue_id: uuid.UUID, body: ConfirmIn, request: Request,
                       db: Session = Depends(get_db), user: User = Depends(require_role("citizen"))):
    """The reporter confirms the fix works → resolved, with a satisfaction rating."""
    issue = issue_service.get_by_id(db, issue_id)
    kind = lifecycle.actor_kind_for(user, issue, db)
    lifecycle.transition(db, issue, "resolved", actor=user, actor_kind=kind,
                         reason="Reporter confirmed the issue is fixed", ip=client_ip(request))
    ev = _latest_evidence(db, issue)
    if ev:
        ev.review_status = "accepted"
    _upsert_feedback(db, issue, user, body.rating, True, body.comment)
    db.commit()
    return issue_detail(db, issue, user)


@router.post("/issues/{issue_id}/dispute")
def dispute_resolution(issue_id: uuid.UUID, body: DisputeIn, request: Request,
                       db: Session = Depends(get_db), user: User = Depends(require_role("citizen"))):
    """The reporter says the work is incomplete → reopened, recorded publicly, admins notified."""
    issue = issue_service.get_by_id(db, issue_id)
    kind = lifecycle.actor_kind_for(user, issue, db)
    if issue.status not in ("awaiting_verification", "resolved"):
        raise HTTPException(status.HTTP_409_CONFLICT, "You can dispute once work has been marked complete.")
    lifecycle.transition(db, issue, "reopened", actor=user, actor_kind=kind, reason=body.reason, ip=client_ip(request))
    ev = _latest_evidence(db, issue)
    if ev:
        ev.review_status = "disputed"
    db.add(IssueUpdate(issue_id=issue.id, author_id=user.id, kind="dispute", body=body.reason, is_public=True))
    if body.rating:
        _upsert_feedback(db, issue, user, body.rating, False, body.reason)
    db.commit()
    return issue_detail(db, issue, user)


@router.post("/issues/{issue_id}/reopen")
def reopen(issue_id: uuid.UUID, body: TransitionIn, request: Request,
           db: Session = Depends(get_db), user: User = Depends(require_role("citizen"))):
    issue = issue_service.get_by_id(db, issue_id)
    kind = lifecycle.actor_kind_for(user, issue, db)
    lifecycle.transition(db, issue, "reopened", actor=user, actor_kind=kind, reason=body.reason, ip=client_ip(request))
    db.add(IssueUpdate(issue_id=issue.id, author_id=user.id, kind="dispute", body=body.reason or "", is_public=True))
    db.commit()
    return issue_detail(db, issue, user)


def _upsert_feedback(db: Session, issue: Issue, user: User, rating: int, fixed: bool, comment: str | None):
    fb = db.scalar(select(CitizenFeedback).where(CitizenFeedback.issue_id == issue.id, CitizenFeedback.user_id == user.id))
    if fb:
        fb.rating, fb.was_fixed, fb.comment = rating, fixed, comment
    else:
        db.add(CitizenFeedback(issue_id=issue.id, user_id=user.id, rating=rating, was_fixed=fixed, comment=comment))
    audit.record(db, actor=user, action="feedback.submitted", entity_type="issue", entity_id=issue.id,
                 issue_id=issue.id, new={"rating": rating, "was_fixed": fixed})


@router.post("/issues/{issue_id}/feedback")
def feedback(issue_id: uuid.UUID, body: FeedbackIn, db: Session = Depends(get_db),
             user: User = Depends(require_role("citizen"))):
    """Reporter or supporters can rate the outcome — including disagreeing with a 'resolved' status."""
    issue = issue_service.get_by_id(db, issue_id)
    if issue.status not in ("resolved", "awaiting_verification", "reopened"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Feedback opens once work has been marked complete.")
    if issue.reporter_id != user.id and not db.get(IssueVote, (issue.id, user.id)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the reporter and supporters can rate this resolution.")
    _upsert_feedback(db, issue, user, body.rating, body.was_fixed, body.comment)
    if not body.was_fixed and issue.status == "resolved":
        notifications.notify(db, notifications.admins_for(db, issue), kind="feedback_negative",
                             title=f"Citizen says {issue.tracking_id} is not fixed", body=body.comment, issue=issue,
                             link=f"/admin/issues/{issue.tracking_id}")
    db.commit()
    return {"ok": True}


@router.get("/issues/{issue_id}/feedback")
def feedback_summary(issue_id: uuid.UUID, db: Session = Depends(get_db), user: User | None = Depends(optional_user)):
    rows = db.scalars(select(CitizenFeedback).where(CitizenFeedback.issue_id == issue_id)).all()
    mine = next((f for f in rows if user and f.user_id == user.id), None)
    return {"count": len(rows), "avg_rating": round(sum(f.rating for f in rows) / len(rows), 2) if rows else None,
            "fixed": sum(f.was_fixed for f in rows), "not_fixed": sum(not f.was_fixed for f in rows),
            "mine": {"rating": mine.rating, "was_fixed": mine.was_fixed, "comment": mine.comment} if mine else None}
