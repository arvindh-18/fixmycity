"""Per-report chat between the reporter, field workers and admins."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import Issue, Message, MessageRead, get_db
from .issues import _get, iso

router = APIRouter(prefix="/api/issues", tags=["messages"])


def can_chat(user: User | None, issue: Issue) -> bool:
    """Chat is between the resident who reported it and the field worker on the job.

    Admins aren't part of it. Before anyone is assigned, any worker may reply (and so pick the job up);
    after that only the assigned worker can.
    """
    if not user or user.is_admin:
        return False
    if user.uid == issue.reporter_uid:
        return True
    return user.is_worker and (not issue.assigned_to_email or issue.assigned_to_email == user.email)


def _check(user: User, issue: Issue) -> None:
    if not can_chat(user, issue):
        raise HTTPException(403, "This chat is only between the resident who reported it and the field worker on the job.")


def _out(m: Message, user: User) -> dict:
    return {"id": m.id, "body": m.body, "sender_name": m.sender_name, "sender_role": m.sender_role,
            "is_mine": m.sender_uid == user.uid, "created_at": iso(m.created_at)}


def _mark_read(db: Session, issue_id: int, uid: str, last_id: int) -> None:
    row = db.scalar(select(MessageRead).where(MessageRead.issue_id == issue_id, MessageRead.uid == uid))
    if row is None:
        db.add(MessageRead(issue_id=issue_id, uid=uid, last_read_message_id=last_id))
    elif last_id > row.last_read_message_id:
        row.last_read_message_id = last_id
    db.commit()


@router.get("/{issue_id}/messages")
def list_messages(issue_id: int, after: int = 0, db: Session = Depends(get_db), user: User = Depends(current_user)):
    issue = _get(db, issue_id)
    _check(user, issue)
    rows = db.scalars(select(Message).where(Message.issue_id == issue_id, Message.id > after).order_by(Message.id)).all()
    if rows:
        _mark_read(db, issue_id, user.uid, rows[-1].id)
    return [_out(m, user) for m in rows]


class MessageIn(BaseModel):
    body: str = Field(..., min_length=1, max_length=1000)


@router.post("/{issue_id}/messages", status_code=201)
def post_message(issue_id: int, data: MessageIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    issue = _get(db, issue_id)
    _check(user, issue)
    body = data.body.strip()
    if not body:
        raise HTTPException(422, "Type a message first.")
    m = Message(issue_id=issue_id, sender_uid=user.uid, sender_name=user.name, sender_role=user.role, body=body)
    db.add(m)
    db.commit()
    _mark_read(db, issue_id, user.uid, m.id)
    return _out(m, user)


def unread_counts(db: Session, user: User | None, issues: list[Issue]) -> dict[int, int]:
    """Messages from other people that this user hasn't seen, per report they can chat on."""
    ids = [i.id for i in issues if can_chat(user, i)]
    if not user or not ids:
        return {}
    last = dict(db.execute(select(MessageRead.issue_id, MessageRead.last_read_message_id)
                           .where(MessageRead.uid == user.uid, MessageRead.issue_id.in_(ids))).all())
    counts: dict[int, int] = {}
    for issue_id, mid in db.execute(select(Message.issue_id, Message.id)
                                    .where(Message.issue_id.in_(ids), Message.sender_uid != user.uid)):
        if mid > last.get(issue_id, 0):
            counts[issue_id] = counts.get(issue_id, 0) + 1
    return counts
