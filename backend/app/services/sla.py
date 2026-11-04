"""Service-level agreement rules.

When an issue is verified it gets a priority. We look up the most specific active rule
(category + priority, else any-category + priority) and store concrete due dates on the issue.
If no rule matches, the due dates stay NULL and the issue is never shown as overdue — we don't
invent deadlines.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Issue, SLAConfiguration

CLOSED_STATUSES = {"resolved", "rejected"}


def find_rule(db: Session, category_id, priority: str | None) -> SLAConfiguration | None:
    if not priority:
        return None
    base = select(SLAConfiguration).where(SLAConfiguration.priority == priority, SLAConfiguration.is_active)
    rule = db.scalar(base.where(SLAConfiguration.category_id == category_id))
    return rule or db.scalar(base.where(SLAConfiguration.category_id.is_(None)))


def apply(db: Session, issue: Issue, start: datetime | None = None) -> SLAConfiguration | None:
    rule = find_rule(db, issue.category_id, issue.priority)
    start = start or datetime.now(timezone.utc)
    issue.sla_config_id = rule.id if rule else None
    issue.response_due_at = start + timedelta(hours=rule.response_hours) if rule else None
    issue.resolution_due_at = start + timedelta(hours=rule.resolution_hours) if rule else None
    issue.sla_warning_sent_at = None
    issue.overdue_flagged_at = None
    issue.escalation_level = 0
    return rule


def sla_state(issue: Issue, now: datetime | None = None, threshold: float = 0.75) -> dict:
    """Derived values for the UI countdown. 'state' is one of:
    none (no rule), on_track, at_risk, overdue, met, missed."""
    now = now or datetime.now(timezone.utc)
    due = issue.resolution_due_at
    if due is None:
        return {"state": "none", "due_at": None, "seconds_remaining": None, "elapsed_seconds": None}
    start = issue.verified_at or issue.created_at
    if issue.status in CLOSED_STATUSES:
        end = issue.resolved_at or issue.updated_at
        state = "met" if issue.status == "resolved" and end <= due else ("missed" if issue.status == "resolved" else "none")
        return {"state": state, "due_at": due, "seconds_remaining": None,
                "elapsed_seconds": int((end - start).total_seconds())}
    remaining = (due - now).total_seconds()
    total = max((due - start).total_seconds(), 1)
    if remaining < 0:
        state = "overdue"
    elif (total - remaining) / total >= threshold:
        state = "at_risk"
    else:
        state = "on_track"
    return {"state": state, "due_at": due, "seconds_remaining": int(remaining),
            "elapsed_seconds": int((now - start).total_seconds())}
