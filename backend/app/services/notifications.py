"""In-app notifications. Rows are stored, then pushed live over WebSocket after commit."""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Issue, IssueAssignment, IssueFollower, Notification, User
from app.services import email, realtime


def notify(
    db: Session,
    user_ids: list[uuid.UUID],
    *,
    kind: str,
    title: str,
    body: str | None = None,
    issue: Issue | None = None,
    link: str | None = None,
    exclude: uuid.UUID | None = None,
) -> None:
    unique = {u for u in user_ids if u and u != exclude}
    issue_link = f"/issues/{issue.tracking_id}" if issue else None
    email.queue(db, list(unique), kind=kind, title=title, body=body, link=link or issue_link)
    if issue is not None:
        email.queue_subscribers(db, issue.id, kind=kind, title=title, body=body, link=issue_link)
    for uid in unique:
        n = Notification(
            user_id=uid, kind=kind, title=title, body=body,
            issue_id=issue.id if issue else None,
            link=link or (f"/issues/{issue.tracking_id}" if issue else None),
        )
        db.add(n)
        db.flush()
        realtime.queue(db, [uid], {
            "type": "notification",
            "notification": {
                "id": str(n.id), "kind": kind, "title": title, "body": body,
                "link": n.link, "issue_id": str(issue.id) if issue else None,
                "created_at": n.created_at.isoformat(), "read_at": None,
            },
        })


def admins_for(db: Session, issue: Issue | None) -> list[uuid.UUID]:
    """City-wide admins plus admins of the issue's department."""
    q = select(User.id, User.department_id).where(User.role == "admin", User.is_active.is_(True))
    out = []
    for uid, dept in db.execute(q).all():
        if dept is None or (issue is not None and issue.department_id == dept):
            out.append(uid)
    return out


def stakeholders(db: Session, issue: Issue) -> list[uuid.UUID]:
    """Reporter + followers + currently assigned worker."""
    ids: list[uuid.UUID] = []
    if issue.reporter_id:
        ids.append(issue.reporter_id)
    ids += list(db.scalars(select(IssueFollower.user_id).where(IssueFollower.issue_id == issue.id)))
    worker = db.scalar(
        select(IssueAssignment.worker_id).where(IssueAssignment.issue_id == issue.id, IssueAssignment.is_active)
    )
    if worker:
        ids.append(worker)
    return ids


def broadcast_issue_changed(db: Session, issue: Issue, user_ids: list[uuid.UUID]) -> None:
    """Lightweight 'refetch this issue' signal for any open screens."""
    realtime.queue(db, user_ids, {"type": "issue_updated", "issue_id": str(issue.id), "tracking_id": issue.tracking_id})
