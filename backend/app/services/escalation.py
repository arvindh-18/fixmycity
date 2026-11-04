"""SLA escalation job.

Runs every ESCALATION_INTERVAL_SECONDS inside the API process (started in main.py's lifespan).
For every open issue that HAS a resolution deadline:

  level 0 → 1  when the configured warning threshold of the SLA window has elapsed
               (e.g. 75%): administrators get an "approaching deadline" warning.
  level 1 → 2  when the deadline passes: the issue is flagged overdue, admins and the assigned
               worker are notified, and the event is written to the audit log.

The job never changes an issue's *status* — escalating to the "escalated" state is a human
decision made by an administrator. Issues without an SLA rule are skipped entirely.
Each step is idempotent (timestamps record that it happened), so restarts don't spam people.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.session import SessionLocal
from app.models import Issue, IssueAssignment, SLAConfiguration
from app.services import audit, notifications
from app.services.sla import CLOSED_STATUSES

log = logging.getLogger("openward.escalation")


def run_once(db: Session, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    warned = flagged = 0
    issues = db.scalars(select(Issue).where(Issue.resolution_due_at.is_not(None),
                                            Issue.status.not_in(CLOSED_STATUSES))).all()
    for issue in issues:
        rule = db.get(SLAConfiguration, issue.sla_config_id) if issue.sla_config_id else None
        threshold = rule.warning_threshold if rule else 0.75
        start = issue.verified_at or issue.created_at
        window = (issue.resolution_due_at - start).total_seconds()
        elapsed = (now - start).total_seconds()
        admins = notifications.admins_for(db, issue)
        worker = db.scalar(select(IssueAssignment.worker_id).where(
            IssueAssignment.issue_id == issue.id, IssueAssignment.is_active))

        if now > issue.resolution_due_at and issue.overdue_flagged_at is None:
            issue.overdue_flagged_at = now
            issue.escalation_level = 2
            audit.record(db, actor=None, action="sla.overdue_flagged", entity_type="issue", entity_id=issue.id,
                         issue_id=issue.id, new={"resolution_due_at": issue.resolution_due_at},
                         reason="Resolution deadline passed")
            notifications.notify(db, admins + ([worker] if worker else []), kind="escalation",
                                 title=f"{issue.tracking_id} is overdue",
                                 body=f"Deadline was {issue.resolution_due_at:%d %b %H:%M}. Review and escalate if needed.",
                                 issue=issue, link=f"/admin/issues/{issue.tracking_id}")
            flagged += 1
        elif (issue.sla_warning_sent_at is None and window > 0 and elapsed / window >= threshold
              and now <= issue.resolution_due_at):
            issue.sla_warning_sent_at = now
            issue.escalation_level = max(issue.escalation_level, 1)
            audit.record(db, actor=None, action="sla.warning_sent", entity_type="issue", entity_id=issue.id,
                         issue_id=issue.id, new={"elapsed_fraction": round(elapsed / window, 2)})
            notifications.notify(db, admins, kind="sla_warning",
                                 title=f"{issue.tracking_id} is nearing its deadline",
                                 body=f"Due {issue.resolution_due_at:%d %b %H:%M}.", issue=issue,
                                 link=f"/admin/issues/{issue.tracking_id}")
            warned += 1
    db.commit()
    return {"warned": warned, "flagged": flagged, "checked": len(issues)}


async def loop(interval: int) -> None:
    while True:
        try:
            result = await asyncio.to_thread(_run_with_session)
            if result["warned"] or result["flagged"]:
                log.info("escalation: %s", result)
        except Exception:
            log.exception("escalation job failed")
        await asyncio.sleep(interval)


def _run_with_session() -> dict:
    with SessionLocal() as db:
        return run_once(db)
