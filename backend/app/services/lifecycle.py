"""The issue lifecycle state machine — the ONLY place an issue's status may change.

How it works
------------
`TRANSITIONS` maps (from_status, to_status) -> the set of actor kinds allowed to make that move.
Actor kinds:
    admin     an administrator (department scope is checked by the router)
    worker    the worker holding the issue's active assignment
    reporter  the citizen who filed the report
    system    automated jobs (none of the edges below are system-only; AI never transitions)

`transition()` refuses anything not in the table, demands a reason on sensitive edges, applies
side effects (timestamps, SLA, assignment deactivation), and writes BOTH an
issue_status_history row and an audit_logs row inside the caller's transaction.

Why a table instead of if/else chains? The whole policy is visible in one place, it can be
printed in documentation, and tests can iterate over it.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import Issue, IssueAssignment, IssueStatusHistory, User
from app.services import audit, notifications, sla

A, W, R = "admin", "worker", "reporter"

TRANSITIONS: dict[tuple[str, str], set[str]] = {
    ("submitted", "pending_verification"): {A},
    ("submitted", "verified"): {A},
    ("submitted", "rejected"): {A},
    ("pending_verification", "verified"): {A},
    ("pending_verification", "rejected"): {A},
    ("verified", "assigned"): {A},
    ("verified", "on_hold"): {A},
    ("verified", "escalated"): {A},
    ("verified", "rejected"): {A},
    ("assigned", "in_progress"): {W},
    ("assigned", "on_hold"): {A, W},
    ("assigned", "escalated"): {A},
    ("in_progress", "awaiting_verification"): {W},
    ("in_progress", "on_hold"): {A, W},
    ("in_progress", "escalated"): {A},
    ("on_hold", "in_progress"): {A, W},
    ("on_hold", "assigned"): {A},
    ("on_hold", "verified"): {A},
    ("escalated", "assigned"): {A},
    ("escalated", "in_progress"): {A, W},
    ("awaiting_verification", "resolved"): {A, R},
    ("awaiting_verification", "in_progress"): {A},   # admin sends work back
    ("awaiting_verification", "reopened"): {A, R},   # citizen disputes the fix
    ("resolved", "reopened"): {A, R},
    ("rejected", "reopened"): {A},                   # admin reverses a rejection on appeal
    ("reopened", "verified"): {A},
    ("reopened", "assigned"): {A},
    ("reopened", "rejected"): {A},
}

REASON_REQUIRED = {"rejected", "on_hold", "reopened", "escalated"}
REASON_REQUIRED_EDGES = {("awaiting_verification", "in_progress")}

# Wording follows the Commons voice: plain, says who has it and what happens next.
STATUS_LABELS = {
    "submitted": "Reported",
    "pending_verification": "Under review",
    "verified": "Verified and routed",
    "assigned": "Crew assigned",
    "in_progress": "Work started",
    "awaiting_verification": "Fixed, waiting for a check",
    "resolved": "Resolved",
    "rejected": "Closed",
    "reopened": "Reopened",
    "on_hold": "On hold",
    "escalated": "Escalated",
}


def allowed_targets(current: str, actor_kind: str) -> list[str]:
    return [to for (frm, to), kinds in TRANSITIONS.items() if frm == current and actor_kind in kinds]


def actor_kind_for(user: User, issue: Issue, db: Session) -> str:
    """Work out which hat a user is wearing for this issue."""
    if user.role == "admin":
        return A
    if user.role == "worker":
        active = db.scalar(select(IssueAssignment).where(
            IssueAssignment.issue_id == issue.id, IssueAssignment.is_active,
            IssueAssignment.worker_id == user.id))
        if not active:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not assigned to this issue.")
        return W
    if user.role == "citizen" and issue.reporter_id == user.id:
        return R
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the person who reported this issue can do that.")


def transition(
    db: Session,
    issue: Issue,
    to_status: str,
    *,
    actor: User | None,
    actor_kind: str,
    reason: str | None = None,
    is_public: bool = True,
    ip: str | None = None,
    notify: bool = True,
) -> IssueStatusHistory:
    frm = issue.status
    allowed = TRANSITIONS.get((frm, to_status))
    if allowed is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"An issue that is '{STATUS_LABELS.get(frm, frm)}' cannot move to '{STATUS_LABELS.get(to_status, to_status)}'.",
        )
    if actor_kind not in allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role cannot make this status change.")
    reason = (reason or "").strip() or None
    if (to_status in REASON_REQUIRED or (frm, to_status) in REASON_REQUIRED_EDGES) and not reason:
        raise HTTPException(422, "A reason is required for this change.")

    now = datetime.now(timezone.utc)

    # ---- side effects -------------------------------------------------------------------
    if actor_kind == A and issue.first_response_at is None:
        issue.first_response_at = now
    if to_status == "verified":
        issue.verified_at = issue.verified_at or now
        if issue.priority is None:
            issue.priority = "medium"
        sla.apply(db, issue, start=now)
    if to_status == "resolved":
        issue.resolved_at = now
    if to_status in {"reopened", "rejected", "resolved"}:
        # The worker's responsibility ends when the issue closes or is sent back for re-triage.
        if to_status != "resolved":
            issue.resolved_at = None
        db.execute(update(IssueAssignment).where(
            IssueAssignment.issue_id == issue.id, IssueAssignment.is_active).values(is_active=False))
    if to_status == "reopened":
        # a reopened issue gets a fresh SLA window once re-verified/assigned
        sla.apply(db, issue, start=now)

    issue.status = to_status
    issue.updated_at = now
    entry = IssueStatusHistory(
        issue_id=issue.id, from_status=frm, to_status=to_status,
        actor_id=actor.id if actor else None,
        actor_role=actor.role if actor else "system",
        reason=reason, is_public=is_public, created_at=now,
    )
    db.add(entry)
    audit.record(
        db, actor=actor, action="issue.status_changed", entity_type="issue", entity_id=issue.id,
        issue_id=issue.id, old={"status": frm}, new={"status": to_status}, reason=reason, ip=ip,
    )
    db.flush()

    if notify:
        label = STATUS_LABELS[to_status]
        people = notifications.stakeholders(db, issue)
        if to_status in {"awaiting_verification", "reopened", "escalated", "on_hold"}:
            people += notifications.admins_for(db, issue)
        notifications.notify(
            db, people, kind="status_changed",
            title=f"{issue.tracking_id} is now {label.lower()}",
            body=reason or issue.title, issue=issue, exclude=actor.id if actor else None,
        )
        notifications.broadcast_issue_changed(db, issue, people + ([actor.id] if actor else []))
    return entry
