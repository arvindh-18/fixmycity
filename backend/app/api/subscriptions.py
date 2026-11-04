"""'Get updates on this report' by email, for people without an account (Commons InlineSignup).

Double opt-in: subscribing sends one confirmation email; nothing else is sent until the link in it is
opened. Every update email carries a one-click unsubscribe link. Responses never reveal whether an
address was already subscribed.
"""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core import rate_limit
from app.core.deps import client_ip
from app.database.session import get_db
from app.models import IssueEmailSubscription
from app.services import audit, email, issue_service

router = APIRouter(prefix="/api", tags=["public"])


class SubscribeIn(BaseModel):
    email: EmailStr
    consent: bool


@router.post("/issues/{issue_id}/subscribe", status_code=202)
def subscribe(issue_id: uuid.UUID, body: SubscribeIn, request: Request, db: Session = Depends(get_db)):
    rate_limit.check(f"subscribe:{client_ip(request)}", 5, 3600)
    if not body.consent:
        raise HTTPException(422, "Tick the box to agree to receive these emails.")
    issue = issue_service.get_by_id(db, issue_id)
    addr = body.email.lower()
    sub = db.scalar(select(IssueEmailSubscription).where(IssueEmailSubscription.issue_id == issue.id,
                                                         IssueEmailSubscription.email == addr))
    if sub is None:
        sub = IssueEmailSubscription(issue_id=issue.id, email=addr, token=secrets.token_urlsafe(32))
        db.add(sub)
        db.flush()
    if sub.confirmed_at is None:
        db.info.setdefault("email_pending", []).append(email.build(
            addr, "", f"Confirm updates for {issue.tracking_id}",
            f"Someone (we hope you) asked for email updates on “{issue.title}”. Open the link to start them. "
            "If this wasn't you, ignore this email and nothing more will be sent.",
            f"/updates/confirm/{sub.token}", cta="Start updates"))
    audit.record(db, actor=None, action="subscription.requested", entity_type="issue", entity_id=issue.id, issue_id=issue.id)
    db.commit()
    return {"ok": True, "message": "Check your inbox for a link to confirm."}


def _by_token(db: Session, token: str) -> IssueEmailSubscription:
    sub = db.scalar(select(IssueEmailSubscription).where(IssueEmailSubscription.token == token))
    if not sub:
        raise HTTPException(404, "This link has expired or was already used to unsubscribe.")
    return sub


@router.post("/subscriptions/{token}/confirm")
def confirm(token: str, db: Session = Depends(get_db)):
    sub = _by_token(db, token)
    sub.confirmed_at = sub.confirmed_at or datetime.now(timezone.utc)
    issue = issue_service.get_by_id(db, sub.issue_id)
    db.commit()
    return {"ok": True, "tracking_id": issue.tracking_id, "title": issue.title}


@router.post("/subscriptions/{token}/unsubscribe")
def unsubscribe(token: str, db: Session = Depends(get_db)):
    sub = _by_token(db, token)
    issue = issue_service.get_by_id(db, sub.issue_id)
    db.execute(delete(IssueEmailSubscription).where(IssueEmailSubscription.id == sub.id))
    db.commit()
    return {"ok": True, "tracking_id": issue.tracking_id, "title": issue.title}
