"""Public issue discussions with replies, photo attachments, reporting and moderation.

Spam/harassment protection: rate limit (20 comments/min/user), link limit (max 2 URLs), a short
blocklist, and community reporting — 3 distinct reports auto-hide a comment until an admin reviews it.
"""
from __future__ import annotations

import re
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import rate_limit
from app.core.deps import optional_user, require_role
from app.database.session import get_db
from app.models import CommentReport, IssueComment, User
from app.schemas.inputs import ReportCommentIn
from app.schemas.serializers import public_name
from app.services import audit, issue_service, notifications, storage

router = APIRouter(prefix="/api", tags=["community"])

BLOCKLIST = {"idiot", "stupid", "bastard", "scam link", "kill you"}
AUTO_HIDE_REPORTS = 3


def _check_content(body: str) -> None:
    low = body.lower()
    if len(re.findall(r"https?://", low)) > 2:
        raise HTTPException(422, "Comments can include at most two links.")
    if any(w in low for w in BLOCKLIST):
        raise HTTPException(422, "Please keep the discussion respectful.")
    if re.search(r"(.)\1{9,}", body):
        raise HTTPException(422, "That comment looks like spam.")


def comment_dict(c: IssueComment, reports: int, viewer: User | None) -> dict:
    staff = c.author.role in ("admin", "worker")
    return {"id": str(c.id), "parent_id": str(c.parent_id) if c.parent_id else None,
            "author": c.author.full_name if staff else public_name(c.author),
            "author_role": c.author.role, "is_official": c.author.role == "admin",
            "body": None if c.is_hidden else c.body, "image_url": None if c.is_hidden else c.image_url,
            "is_hidden": c.is_hidden, "hidden_reason": c.hidden_reason if c.is_hidden else None,
            "reports": reports if viewer and viewer.role == "admin" else None,
            "is_mine": bool(viewer and viewer.id == c.author_id), "created_at": c.created_at}


@router.get("/issues/{issue_id}/comments")
def list_comments(issue_id: uuid.UUID, db: Session = Depends(get_db), viewer: User | None = Depends(optional_user)):
    rows = db.scalars(select(IssueComment).where(IssueComment.issue_id == issue_id).order_by(IssueComment.created_at)).all()
    rc = dict(db.execute(select(CommentReport.comment_id, func.count()).where(CommentReport.comment_id.in_([r.id for r in rows]))
                         .group_by(CommentReport.comment_id)).all()) if rows else {}
    top = [comment_dict(c, rc.get(c.id, 0), viewer) for c in rows if not c.parent_id]
    for t in top:
        t["replies"] = [comment_dict(c, rc.get(c.id, 0), viewer) for c in rows if c.parent_id and str(c.parent_id) == t["id"]]
    return top


@router.post("/issues/{issue_id}/comments", status_code=201)
def add_comment(issue_id: uuid.UUID, body: str = Form(..., min_length=1, max_length=2000),
                parent_id: uuid.UUID | None = Form(None), image: UploadFile | None = File(None),
                db: Session = Depends(get_db), user: User = Depends(require_role("citizen", "admin", "worker"))):
    rate_limit.check(f"comment:{user.id}", 20, 60)
    issue = issue_service.get_by_id(db, issue_id)
    _check_content(body)
    if parent_id:
        parent = db.get(IssueComment, parent_id)
        if not parent or parent.issue_id != issue.id:
            raise HTTPException(422, "You can only reply to comments on this issue.")
        if parent.parent_id:  # keep threads one level deep
            parent_id = parent.parent_id
    url = storage.save_image(image, "comments") if image and image.filename else None
    c = IssueComment(issue_id=issue.id, author_id=user.id, parent_id=parent_id, body=body.strip(), image_url=url)
    db.add(c)
    db.flush()
    db.refresh(c)
    people = notifications.stakeholders(db, issue)
    notifications.notify(db, people, kind="comment", title=f"New comment on {issue.tracking_id}",
                         body=body[:140], issue=issue, exclude=user.id)
    db.commit()
    return comment_dict(c, 0, user)


@router.post("/comments/{comment_id}/report")
def report_comment(comment_id: uuid.UUID, body: ReportCommentIn, db: Session = Depends(get_db),
                   user: User = Depends(require_role("citizen", "admin", "worker"))):
    c = db.get(IssueComment, comment_id)
    if not c:
        raise HTTPException(404, "Comment not found.")
    if c.author_id == user.id:
        raise HTTPException(422, "You can't report your own comment.")
    try:
        db.add(CommentReport(comment_id=c.id, reporter_id=user.id, reason=body.reason))
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "You already reported this comment.")
    n = db.scalar(select(func.count()).select_from(CommentReport).where(CommentReport.comment_id == c.id))
    if n >= AUTO_HIDE_REPORTS and not c.is_hidden and c.hidden_by is None:
        c.is_hidden, c.hidden_reason = True, "Hidden after community reports — awaiting moderator review"
        audit.record(db, actor=None, action="comment.auto_hidden", entity_type="comment", entity_id=c.id, issue_id=c.issue_id,
                     new={"reports": n})
    db.commit()
    return {"ok": True, "reports": n}
