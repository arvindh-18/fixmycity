"""Field-worker endpoints. Workers only ever touch issues where THEY hold the active assignment."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.deps import client_ip, require_role
from app.database.session import get_db
from app.integrations.ai import summaries
from app.models import CitizenFeedback, Issue, IssueAssignment, IssueEvidence, IssueImage, IssueUpdate, User
from app.schemas.inputs import PauseIn
from app.schemas.serializers import assignment_dict, counts_for, issue_card, issue_detail
from app.services import audit, issue_service, lifecycle, notifications, storage

router = APIRouter(prefix="/api/worker", tags=["worker"])
Worker = Depends(require_role("worker"))


def owned_assignment(db: Session, issue_id: uuid.UUID, worker: User) -> IssueAssignment:
    a = db.scalar(select(IssueAssignment).where(IssueAssignment.issue_id == issue_id, IssueAssignment.is_active,
                                                IssueAssignment.worker_id == worker.id))
    if not a:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This task is not assigned to you.")
    return a


@router.get("/tasks")
def tasks(db: Session = Depends(get_db), worker: User = Worker):
    rows = db.scalars(select(IssueAssignment).where(IssueAssignment.worker_id == worker.id)
                      .order_by(IssueAssignment.created_at.desc())).all()
    issues = {i.id: i for i in db.scalars(select(Issue).where(Issue.id.in_([a.issue_id for a in rows]))
                                          .options(selectinload(Issue.images))).all()} if rows else {}
    counts = counts_for(db, list(issues))
    out = []
    for a in rows:
        i = issues[a.issue_id]
        out.append({"assignment": assignment_dict(a), "issue": issue_card(i, counts[i.id])})
    return out


@router.get("/stats")
def worker_stats(db: Session = Depends(get_db), worker: User = Worker):
    """Personal, non-competitive numbers. No leaderboard: resolution speed depends on the job."""
    rows = db.scalars(select(IssueAssignment).where(IssueAssignment.worker_id == worker.id)).all()
    active = [a for a in rows if a.is_active]
    issues = {i.id: i for i in db.scalars(select(Issue).where(Issue.id.in_([a.issue_id for a in rows])))} if rows else {}
    now = datetime.now(timezone.utc)
    by_priority: dict[str, int] = {}
    for a in active:
        p = issues[a.issue_id].priority or "unset"
        by_priority[p] = by_priority.get(p, 0) + 1
    fb = db.execute(select(func.avg(CitizenFeedback.rating), func.count()).where(
        CitizenFeedback.issue_id.in_([a.issue_id for a in rows if a.completed_at]))).one() if rows else (None, 0)
    return {
        "new": sum(1 for a in active if not a.acknowledged_at),
        "in_progress": sum(1 for a in active if issues[a.issue_id].status == "in_progress"),
        "on_hold": sum(1 for a in active if issues[a.issue_id].status == "on_hold"),
        "awaiting_verification": sum(1 for a in active if issues[a.issue_id].status == "awaiting_verification"),
        "overdue": sum(1 for a in active if a.due_at and a.due_at < now and issues[a.issue_id].status not in ("awaiting_verification", "resolved")),
        "completed": sum(1 for a in rows if a.completed_at),
        "resolved": sum(1 for a in rows if issues[a.issue_id].status == "resolved" and a.completed_at),
        "by_priority": by_priority,
        "feedback_avg": round(float(fb[0]), 2) if fb[0] is not None else None, "feedback_count": fb[1],
    }


@router.get("/tasks/{issue_id}")
def task_detail(issue_id: uuid.UUID, db: Session = Depends(get_db), worker: User = Worker):
    a = db.scalar(select(IssueAssignment).where(IssueAssignment.issue_id == issue_id, IssueAssignment.worker_id == worker.id)
                  .order_by(IssueAssignment.created_at.desc()).limit(1))
    if not a:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This task is not assigned to you.")
    issue = issue_service.get_by_id(db, issue_id)
    data = issue_detail(db, issue, worker)
    data["assignment"] = assignment_dict(a)
    data["allowed_transitions"] = lifecycle.allowed_targets(issue.status, "worker") if a.is_active else []
    data["updates"] = [{"id": str(u.id), "kind": u.kind, "body": u.body, "summary_status": u.summary_status,
                        "public_summary": u.public_summary, "created_at": u.created_at}
                       for u in db.scalars(select(IssueUpdate).where(IssueUpdate.issue_id == issue.id,
                                                                     IssueUpdate.author_id == worker.id)
                                           .order_by(IssueUpdate.created_at.desc()))]
    data["evidence"] = issue_service.evidence_list(db, issue, include_internal=True)
    return data


@router.post("/tasks/{issue_id}/acknowledge")
def acknowledge(issue_id: uuid.UUID, db: Session = Depends(get_db), worker: User = Worker):
    a = owned_assignment(db, issue_id, worker)
    if not a.acknowledged_at:
        a.acknowledged_at = datetime.now(timezone.utc)
        issue = db.get(Issue, issue_id)
        audit.record(db, actor=worker, action="assignment.acknowledged", entity_type="assignment", entity_id=a.id, issue_id=issue_id)
        notifications.notify(db, notifications.admins_for(db, issue) + ([issue.reporter_id] if issue.reporter_id else []),
                             kind="acknowledged", title=f"{issue.tracking_id} acknowledged by the field team",
                             body=issue.title, issue=issue)
        notifications.broadcast_issue_changed(db, issue, notifications.stakeholders(db, issue))
        db.commit()
    return task_detail(issue_id, db, worker)


@router.post("/tasks/{issue_id}/start")
def start(issue_id: uuid.UUID, request: Request, db: Session = Depends(get_db), worker: User = Worker):
    a = owned_assignment(db, issue_id, worker)
    issue = db.get(Issue, issue_id)
    now = datetime.now(timezone.utc)
    a.acknowledged_at = a.acknowledged_at or now
    a.started_at = a.started_at or now
    lifecycle.transition(db, issue, "in_progress", actor=worker, actor_kind="worker",
                         reason="Work started on site" if issue.status == "assigned" else "Work resumed", ip=client_ip(request))
    db.commit()
    return task_detail(issue_id, db, worker)


@router.post("/tasks/{issue_id}/pause")
def pause(issue_id: uuid.UUID, body: PauseIn, request: Request, db: Session = Depends(get_db), worker: User = Worker):
    owned_assignment(db, issue_id, worker)
    issue = db.get(Issue, issue_id)
    lifecycle.transition(db, issue, "on_hold", actor=worker, actor_kind="worker", reason=body.reason, ip=client_ip(request))
    db.commit()
    return task_detail(issue_id, db, worker)


@router.post("/tasks/{issue_id}/updates", status_code=201)
def add_update(issue_id: uuid.UUID, kind: str = Form(..., pattern="^(progress|obstacle|resource_request|assistance_request)$"),
               body: str = Form(..., min_length=3, max_length=2000), photo: UploadFile | None = File(None),
               db: Session = Depends(get_db), worker: User = Worker):
    """Internal note → AI drafts a citizen-friendly summary → admin approves before it goes public."""
    owned_assignment(db, issue_id, worker)
    issue = db.get(Issue, issue_id)
    summary, source = summaries.summarize(kind, body)
    u = IssueUpdate(issue_id=issue.id, author_id=worker.id, kind=kind, body=body, is_public=False,
                    public_summary=summary, summary_status="pending", summary_source=source)
    db.add(u)
    if photo and photo.filename:
        db.add(IssueImage(issue_id=issue.id, uploader_id=worker.id, kind="progress", url=storage.save_image(photo, "progress"),
                          caption=body[:200]))
    db.flush()
    audit.record(db, actor=worker, action=f"worker.{kind}", entity_type="issue_update", entity_id=u.id, issue_id=issue.id,
                 new={"body": body})
    title = {"progress": "Progress note", "obstacle": "Obstacle reported", "resource_request": "Materials requested",
             "assistance_request": "Worker requests assistance"}[kind]
    notifications.notify(db, notifications.admins_for(db, issue), kind="worker_update",
                         title=f"{title} · {issue.tracking_id}", body=body[:200], issue=issue,
                         link=f"/admin/issues/{issue.tracking_id}")
    db.commit()
    return {"id": str(u.id), "public_summary": summary, "summary_source": source}


@router.post("/tasks/{issue_id}/complete")
def complete(issue_id: uuid.UUID, request: Request,
             description: str = Form(..., min_length=10, max_length=2000),
             work_notes: str | None = Form(None, max_length=4000),
             before: list[UploadFile] = File(default=[]), after: list[UploadFile] = File(default=[]),
             db: Session = Depends(get_db), worker: User = Worker):
    """Submit completion evidence. Status becomes 'awaiting verification' — NEVER 'resolved'.
    The reporter (or an admin) must verify the outcome."""
    a = owned_assignment(db, issue_id, worker)
    issue = db.get(Issue, issue_id)
    before = [f for f in before if f and f.filename][:4]
    after = [f for f in after if f and f.filename][:4]
    if not after:
        raise HTTPException(422, "Add at least one 'after' photo as proof of the work.")
    if issue.status != "in_progress":
        raise HTTPException(status.HTTP_409_CONFLICT, "Start the work before submitting completion.")
    now = datetime.now(timezone.utc)
    ev = IssueEvidence(issue_id=issue.id, assignment_id=a.id, submitted_by=worker.id, description=description,
                       work_notes=work_notes, submitted_at=now)
    db.add(ev)
    db.flush()
    for f in before:
        db.add(IssueImage(issue_id=issue.id, uploader_id=worker.id, evidence_id=ev.id, kind="before", url=storage.save_image(f, "evidence")))
    for f in after:
        db.add(IssueImage(issue_id=issue.id, uploader_id=worker.id, evidence_id=ev.id, kind="after", url=storage.save_image(f, "evidence")))
    a.completed_at = now
    audit.record(db, actor=worker, action="evidence.submitted", entity_type="evidence", entity_id=ev.id, issue_id=issue.id,
                 new={"description": description, "before": len(before), "after": len(after)})
    lifecycle.transition(db, issue, "awaiting_verification", actor=worker, actor_kind="worker",
                         reason="Completion evidence submitted — waiting for citizen/admin verification", ip=client_ip(request))
    db.commit()
    return task_detail(issue_id, db, worker)
