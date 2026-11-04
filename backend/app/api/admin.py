"""Administrator endpoints. Every route requires role=admin; issue routes also check department scope."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, selectinload

from app.core.deps import client_ip, ensure_admin_scope, require_role
from app.core.security import hash_password
from app.database.session import get_db
from app.integrations.ai import duplicates, priority as priority_engine
from app.models import (
    AIRecommendation, Announcement, AuditLog, Department, ExpenditureRecord, Issue, IssueAssignment,
    IssueCategory, IssueComment, IssueEvidence, IssueUpdate, PublicCommitment, SLAConfiguration, User, WorkerProfile,
)
from app.schemas.inputs import (
    AIDecisionIn, AnnouncementIn, AssignIn, CategoryIn, CommitmentIn, DepartmentIn, ExpenditureIn, ModerateIn,
    OfficialUpdateIn, PriorityIn, RejectIn, SLAIn, SummaryDecisionIn, TransitionIn, VerifyIn, WorkerIn,
)
from app.schemas.serializers import assignment_dict, counts_for, issue_card, issue_detail, user_dict
from app.services import audit, escalation, issue_service, lifecycle, notifications, sla, stats
from app.api.public import SORTS, announcement_dict, commitment_dict, expenditure_dict, filtered_issues

router = APIRouter(prefix="/api/admin", tags=["admin"])
Admin = Depends(require_role("admin"))


def _scoped(stmt, admin: User):
    if admin.department_id:
        stmt = stmt.where((Issue.department_id == admin.department_id) | (Issue.department_id.is_(None)))
    return stmt


def _issue(db: Session, issue_id: uuid.UUID, admin: User) -> Issue:
    issue = issue_service.get_by_id(db, issue_id)
    ensure_admin_scope(admin, issue)
    return issue


# ------------------------------------------------------------------ issues
@router.get("/issues")
def admin_issues(
    status_: list[str] | None = Query(None, alias="status"), category: list[uuid.UUID] | None = Query(None),
    department: list[uuid.UUID] | None = Query(None), locality: uuid.UUID | None = None,
    priority: list[str] | None = Query(None), q: str | None = Query(None, max_length=100),
    queue: str | None = None, overdue: bool = False, sort: str = "newest",
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db), admin: User = Admin,
):
    base = _scoped(filtered_issues(status_, category, department, locality, priority, q), admin)
    if queue == "verification":
        base = base.where(Issue.status.in_(["submitted", "pending_verification", "reopened"]))
    elif queue == "assignment":
        base = base.where(Issue.status.in_(["verified", "escalated"]))
    elif queue == "review":
        base = base.where(Issue.status == "awaiting_verification")
    if overdue:
        base = base.where(Issue.resolution_due_at < datetime.now(timezone.utc), Issue.status.not_in(["resolved", "rejected"]))
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    rows = db.scalars(base.options(selectinload(Issue.images)).order_by(SORTS.get(sort, SORTS["newest"]))
                      .offset((page - 1) * page_size).limit(page_size)).all()
    counts = counts_for(db, [i.id for i in rows])
    return {"items": [issue_card(i, counts[i.id]) for i in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/queues")
def queue_counts(db: Session = Depends(get_db), admin: User = Admin):
    def c(*statuses):
        return db.scalar(select(func.count()).select_from(_scoped(select(Issue).where(Issue.status.in_(statuses)), admin).subquery()))
    now = datetime.now(timezone.utc)
    overdue = db.scalar(select(func.count()).select_from(_scoped(select(Issue).where(
        Issue.resolution_due_at < now, Issue.status.not_in(["resolved", "rejected"])), admin).subquery()))
    pending_summaries = db.scalar(select(func.count()).select_from(IssueUpdate).where(IssueUpdate.summary_status == "pending"))
    flagged = db.scalar(select(func.count()).select_from(IssueComment).where(IssueComment.is_hidden, IssueComment.hidden_by.is_(None)))
    return {"verification": c("submitted", "pending_verification", "reopened"), "assignment": c("verified", "escalated"),
            "review": c("awaiting_verification"), "overdue": overdue, "summaries": pending_summaries,
            "moderation": flagged}


@router.get("/issues/{tracking_id}")
def admin_issue_detail(tracking_id: str, db: Session = Depends(get_db), admin: User = Admin):
    issue = issue_service.get_by_tracking(db, tracking_id)
    ensure_admin_scope(admin, issue)
    data = issue_detail(db, issue, admin)
    lat, lng = data["lat"], data["lng"]
    recs = db.scalars(select(AIRecommendation).where(AIRecommendation.issue_id == issue.id)
                      .order_by(AIRecommendation.created_at.desc())).all()
    latest: dict[str, dict] = {}
    for r in recs:
        latest.setdefault(r.kind, {"id": str(r.id), "kind": r.kind, "mode": r.mode, "provider": r.provider,
                                   "output": r.output, "confidence": r.confidence, "decision": r.decision,
                                   "created_at": r.created_at})
    reporter = issue.reporter
    data.update({
        "reporter": {"name": reporter.full_name, "email": reporter.email, "phone": reporter.phone} if reporter else None,
        "allowed_transitions": lifecycle.allowed_targets(issue.status, "admin"),
        "assignments": [assignment_dict(a) for a in issue.assignments],
        "ai": latest,
        "duplicates": duplicates.find(db, lat=lat, lng=lng, title=issue.title, description=issue.description,
                                      category_id=issue.category_id, exclude_id=issue.id),
        "updates": [{"id": str(u.id), "kind": u.kind, "body": u.body, "public_summary": u.public_summary,
                     "summary_status": u.summary_status, "summary_source": u.summary_source,
                     "author": u.author.full_name if u.author else None, "created_at": u.created_at}
                    for u in db.scalars(select(IssueUpdate).where(IssueUpdate.issue_id == issue.id).order_by(IssueUpdate.created_at.desc()))],
        "sla_rule": None,
    })
    if issue.sla_config_id:
        r = db.get(SLAConfiguration, issue.sla_config_id)
        data["sla_rule"] = {"response_hours": r.response_hours, "resolution_hours": r.resolution_hours,
                            "category": r.category.name if r.category else "All categories", "priority": r.priority}
    return data


@router.post("/issues/{issue_id}/verify")
def verify(issue_id: uuid.UUID, body: VerifyIn, request: Request, db: Session = Depends(get_db), admin: User = Admin):
    issue = _issue(db, issue_id, admin)
    old = {"priority": issue.priority, "category_id": issue.category_id, "department_id": issue.department_id}
    if body.category_id:
        if not db.get(IssueCategory, body.category_id):
            raise HTTPException(422, "Unknown category.")
        issue.category_id = body.category_id
    dept_id = body.department_id or (issue.category.default_department_id if issue.category else None)
    if admin.department_id and dept_id and dept_id != admin.department_id:
        raise HTTPException(403, "You can only route issues to your own department.")
    issue.department_id = dept_id
    issue.priority = body.priority
    db.flush()
    db.refresh(issue)
    dept = db.get(Department, dept_id) if dept_id else None
    reason = f"Verified · priority {body.priority}" + (f" · routed to {dept.name}" if dept else "")
    if body.note:
        reason += f" — {body.note}"
    lifecycle.transition(db, issue, "verified", actor=admin, actor_kind="admin", reason=reason, ip=client_ip(request))
    audit.record(db, actor=admin, action="issue.triaged", entity_type="issue", entity_id=issue.id, issue_id=issue.id,
                 old=old, new={"priority": issue.priority, "category_id": issue.category_id, "department_id": issue.department_id})
    db.commit()
    return admin_issue_detail(issue.tracking_id, db, admin)


@router.post("/issues/{issue_id}/reject")
def reject(issue_id: uuid.UUID, body: RejectIn, request: Request, db: Session = Depends(get_db), admin: User = Admin):
    issue = _issue(db, issue_id, admin)
    lifecycle.transition(db, issue, "rejected", actor=admin, actor_kind="admin", reason=body.reason, ip=client_ip(request))
    db.commit()
    return admin_issue_detail(issue.tracking_id, db, admin)


@router.post("/issues/{issue_id}/transition")
def admin_transition(issue_id: uuid.UUID, body: TransitionIn, request: Request, db: Session = Depends(get_db), admin: User = Admin):
    """Generic edge for on-hold, escalate, send back, resolve, reopen, start review."""
    issue = _issue(db, issue_id, admin)
    if body.to_status in ("verified", "assigned", "rejected"):
        raise HTTPException(422, "Use the verify, assign or reject actions for this change.")
    if body.to_status == "resolved":
        ev = db.scalar(select(IssueEvidence).where(IssueEvidence.issue_id == issue.id).order_by(IssueEvidence.submitted_at.desc()).limit(1))
        if not ev:
            raise HTTPException(422, "An issue can only be resolved after completion evidence is submitted.")
        ev.review_status = "accepted"
    if body.to_status == "in_progress" and issue.status == "awaiting_verification":
        ev = db.scalar(select(IssueEvidence).where(IssueEvidence.issue_id == issue.id).order_by(IssueEvidence.submitted_at.desc()).limit(1))
        if ev:
            ev.review_status = "rejected"
        db.execute(update(IssueAssignment).where(IssueAssignment.issue_id == issue.id, IssueAssignment.is_active)
                   .values(completed_at=None))
    if body.to_status == "escalated":
        issue.escalation_level = max(issue.escalation_level, 2)
    lifecycle.transition(db, issue, body.to_status, actor=admin, actor_kind="admin", reason=body.reason,
                         is_public=body.is_public, ip=client_ip(request))
    db.commit()
    return admin_issue_detail(issue.tracking_id, db, admin)


@router.post("/issues/{issue_id}/assign")
def assign(issue_id: uuid.UUID, body: AssignIn, request: Request, db: Session = Depends(get_db), admin: User = Admin):
    issue = _issue(db, issue_id, admin)
    worker = db.get(User, body.worker_id)
    if not worker or worker.role != "worker" or not worker.is_active:
        raise HTTPException(422, "Choose an active field worker.")
    dept_id = body.department_id or issue.department_id or worker.department_id
    if worker.department_id and dept_id and worker.department_id != dept_id:
        raise HTTPException(422, "That worker belongs to a different department.")
    if admin.department_id and dept_id != admin.department_id:
        raise HTTPException(403, "You can only assign within your own department.")
    if issue.status not in ("verified", "reopened", "escalated", "on_hold", "assigned", "in_progress"):
        raise HTTPException(409, "Verify the issue before assigning a worker.")
    previous = db.scalar(select(IssueAssignment).where(IssueAssignment.issue_id == issue.id, IssueAssignment.is_active))
    if previous:
        previous.is_active = False
        db.flush()
    issue.department_id = dept_id
    due = body.due_at or issue.resolution_due_at
    a = IssueAssignment(issue_id=issue.id, worker_id=worker.id, department_id=dept_id, assigned_by=admin.id,
                        instructions=body.instructions, due_at=due)
    db.add(a)
    db.flush()
    dept = db.get(Department, dept_id)
    reason = f"Assigned to {dept.name} field team"
    if previous:
        reason = f"Reassigned within {dept.name}"
    if issue.status != "assigned" and issue.status != "in_progress":
        lifecycle.transition(db, issue, "assigned", actor=admin, actor_kind="admin", reason=reason, ip=client_ip(request))
    audit.record(db, actor=admin, action="issue.assigned", entity_type="assignment", entity_id=a.id, issue_id=issue.id,
                 old={"worker_id": previous.worker_id} if previous else None,
                 new={"worker_id": worker.id, "department_id": dept_id, "due_at": due}, ip=client_ip(request))
    notifications.notify(db, [worker.id], kind="assignment", title=f"New task {issue.tracking_id}",
                         body=issue.title, issue=issue, link=f"/worker/tasks/{issue.id}")
    db.commit()
    return admin_issue_detail(issue.tracking_id, db, admin)


@router.post("/issues/{issue_id}/priority")
def set_priority(issue_id: uuid.UUID, body: PriorityIn, request: Request, db: Session = Depends(get_db), admin: User = Admin):
    issue = _issue(db, issue_id, admin)
    old = issue.priority
    issue.priority = body.priority
    if issue.verified_at and issue.status not in ("resolved", "rejected"):
        sla.apply(db, issue, start=issue.verified_at)
    audit.record(db, actor=admin, action="issue.priority_changed", entity_type="issue", entity_id=issue.id,
                 issue_id=issue.id, old={"priority": old}, new={"priority": body.priority}, reason=body.reason, ip=client_ip(request))
    db.commit()
    return admin_issue_detail(issue.tracking_id, db, admin)


@router.post("/issues/{issue_id}/official-update")
def official_update(issue_id: uuid.UUID, body: OfficialUpdateIn, db: Session = Depends(get_db), admin: User = Admin):
    """Official updates go on the PUBLIC timeline — separate from private chat."""
    issue = _issue(db, issue_id, admin)
    db.add(IssueUpdate(issue_id=issue.id, author_id=admin.id, kind="official", body=body.body, is_public=True))
    if issue.first_response_at is None:
        issue.first_response_at = datetime.now(timezone.utc)
    audit.record(db, actor=admin, action="issue.official_update", entity_type="issue", entity_id=issue.id,
                 issue_id=issue.id, new={"body": body.body})
    notifications.notify(db, notifications.stakeholders(db, issue), kind="official_update",
                         title=f"Official update on {issue.tracking_id}", body=body.body, issue=issue)
    notifications.broadcast_issue_changed(db, issue, notifications.stakeholders(db, issue))
    db.commit()
    return {"ok": True}


@router.post("/issues/{issue_id}/mark-duplicate")
def mark_duplicate(issue_id: uuid.UUID, request: Request, of: str = Query(..., min_length=5),
                   db: Session = Depends(get_db), admin: User = Admin):
    issue = _issue(db, issue_id, admin)
    original = issue_service.get_by_tracking(db, of)
    if original.id == issue.id:
        raise HTTPException(422, "An issue can't duplicate itself.")
    issue.duplicate_of_id = original.id
    lifecycle.transition(db, issue, "rejected", actor=admin, actor_kind="admin",
                         reason=f"Duplicate of {original.tracking_id} — follow that report for progress", ip=client_ip(request))
    if issue.reporter_id:
        from app.models import IssueFollower
        if not db.get(IssueFollower, (original.id, issue.reporter_id)):
            db.add(IssueFollower(issue_id=original.id, user_id=issue.reporter_id))
    db.commit()
    return admin_issue_detail(issue.tracking_id, db, admin)


@router.post("/issues/{issue_id}/ai/refresh")
def refresh_ai(issue_id: uuid.UUID, db: Session = Depends(get_db), admin: User = Admin):
    issue = _issue(db, issue_id, admin)
    pr = priority_engine.recommend(db, issue)
    db.add(AIRecommendation(issue_id=issue.id, kind="priority", mode=pr["mode"], provider=pr["provider"],
                            output=pr, confidence=pr["confidence"]))
    db.commit()
    return admin_issue_detail(issue.tracking_id, db, admin)


@router.post("/ai/{rec_id}/decision")
def ai_decision(rec_id: uuid.UUID, body: AIDecisionIn, db: Session = Depends(get_db), admin: User = Admin):
    rec = db.get(AIRecommendation, rec_id)
    if not rec:
        raise HTTPException(404, "Recommendation not found.")
    ensure_admin_scope(admin, db.get(Issue, rec.issue_id))
    rec.decision, rec.decided_by = body.decision, admin.id
    audit.record(db, actor=admin, action=f"ai.{body.decision}", entity_type="ai_recommendation", entity_id=rec.id,
                 issue_id=rec.issue_id, new={"kind": rec.kind, "output": rec.output})
    db.commit()
    return {"ok": True}


@router.get("/summaries")
def pending_summaries(db: Session = Depends(get_db), admin: User = Admin):
    rows = db.scalars(select(IssueUpdate).where(IssueUpdate.summary_status == "pending").order_by(IssueUpdate.created_at)).all()
    out = []
    for u in rows:
        issue = db.get(Issue, u.issue_id)
        out.append({"id": str(u.id), "kind": u.kind, "body": u.body, "public_summary": u.public_summary,
                    "summary_source": u.summary_source, "author": u.author.full_name if u.author else None,
                    "created_at": u.created_at, "issue": {"tracking_id": issue.tracking_id, "title": issue.title}})
    return out


@router.post("/updates/{update_id}/summary")
def decide_summary(update_id: uuid.UUID, body: SummaryDecisionIn, db: Session = Depends(get_db), admin: User = Admin):
    u = db.get(IssueUpdate, update_id)
    if not u:
        raise HTTPException(404, "Update not found.")
    issue = _issue(db, u.issue_id, admin)
    if body.edited_summary:
        u.public_summary = body.edited_summary.strip()
    u.summary_status = "approved" if body.approve else "rejected"
    u.is_public = body.approve
    audit.record(db, actor=admin, action="summary.approved" if body.approve else "summary.rejected",
                 entity_type="issue_update", entity_id=u.id, issue_id=issue.id, new={"public_summary": u.public_summary})
    if body.approve:
        notifications.notify(db, notifications.stakeholders(db, issue), kind="progress_update",
                             title=f"Progress on {issue.tracking_id}", body=u.public_summary, issue=issue)
        notifications.broadcast_issue_changed(db, issue, notifications.stakeholders(db, issue))
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ dashboard
@router.get("/dashboard")
def dashboard(date_from: datetime | None = None, date_to: datetime | None = None,
              db: Session = Depends(get_db), admin: User = Admin):
    dept = admin.department_id
    f = {"date_from": date_from, "date_to": date_to, "department_id": dept}
    return {
        "scope": admin.department.name if admin.department else "City-wide",
        "overview": stats.overview(db, **f),
        "trends": stats.monthly_trends(db, 12, department_id=dept),
        "categories": stats.by_category(db, **f),
        "priorities": stats.by_priority(db, department_id=dept),
        "departments": stats.department_scorecards(db, date_from=date_from, date_to=date_to),
        "localities": stats.localities_summary(db),
    }


@router.post("/escalation/run")
def run_escalation(db: Session = Depends(get_db), admin: User = Admin):
    """Run the SLA escalation job now (it also runs automatically every minute)."""
    return escalation.run_once(db)


# ------------------------------------------------------------------ departments & categories
@router.get("/departments")
def departments(db: Session = Depends(get_db), admin: User = Admin):
    rows = db.scalars(select(Department).order_by(Department.name)).all()
    wc = dict(db.execute(select(User.department_id, func.count()).where(User.role == "worker", User.is_active).group_by(User.department_id)).all())
    return [{"id": str(d.id), "name": d.name, "code": d.code, "description": d.description,
             "contact_email": d.contact_email, "workers": wc.get(d.id, 0)} for d in rows]


def _city_admin(admin: User):
    if admin.department_id:
        raise HTTPException(403, "Only city-wide administrators can change this.")


@router.post("/departments", status_code=201)
def create_department(body: DepartmentIn, db: Session = Depends(get_db), admin: User = Admin):
    _city_admin(admin)
    d = Department(**body.model_dump())
    db.add(d)
    db.flush()
    audit.record(db, actor=admin, action="department.created", entity_type="department", entity_id=d.id, new=body.model_dump())
    db.commit()
    return {"id": str(d.id)}


@router.put("/departments/{dept_id}")
def update_department(dept_id: uuid.UUID, body: DepartmentIn, db: Session = Depends(get_db), admin: User = Admin):
    _city_admin(admin)
    d = db.get(Department, dept_id) or _404()
    old = {"name": d.name, "code": d.code, "description": d.description, "contact_email": d.contact_email}
    for k, v in body.model_dump().items():
        setattr(d, k, v)
    audit.record(db, actor=admin, action="department.updated", entity_type="department", entity_id=d.id, old=old, new=body.model_dump())
    db.commit()
    return {"ok": True}


@router.get("/categories")
def categories(db: Session = Depends(get_db), admin: User = Admin):
    rows = db.scalars(select(IssueCategory).order_by(IssueCategory.name)).all()
    return [{"id": str(c.id), "name": c.name, "slug": c.slug, "icon": c.icon, "description": c.description,
             "keywords": c.keywords, "is_active": c.is_active,
             "default_department_id": str(c.default_department_id) if c.default_department_id else None} for c in rows]


def _slug(name: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:80]


@router.post("/categories", status_code=201)
def create_category(body: CategoryIn, db: Session = Depends(get_db), admin: User = Admin):
    _city_admin(admin)
    c = IssueCategory(slug=_slug(body.name), **body.model_dump())
    db.add(c)
    db.flush()
    audit.record(db, actor=admin, action="category.created", entity_type="category", entity_id=c.id, new=body.model_dump())
    db.commit()
    return {"id": str(c.id)}


@router.put("/categories/{cat_id}")
def update_category(cat_id: uuid.UUID, body: CategoryIn, db: Session = Depends(get_db), admin: User = Admin):
    _city_admin(admin)
    c = db.get(IssueCategory, cat_id) or _404()
    old = {"name": c.name, "keywords": c.keywords, "is_active": c.is_active, "default_department_id": c.default_department_id}
    for k, v in body.model_dump().items():
        setattr(c, k, v)
    audit.record(db, actor=admin, action="category.updated", entity_type="category", entity_id=c.id, old=old, new=body.model_dump())
    db.commit()
    return {"ok": True}


def _404():
    raise HTTPException(404, "Not found.")


# ------------------------------------------------------------------ workers
@router.get("/workers")
def workers(department: uuid.UUID | None = None, db: Session = Depends(get_db), admin: User = Admin):
    q = select(User).where(User.role == "worker").order_by(User.full_name)
    dept = admin.department_id or department
    if dept:
        q = q.where(User.department_id == dept)
    rows = db.scalars(q).all()
    active = dict(db.execute(select(IssueAssignment.worker_id, func.count()).where(IssueAssignment.is_active)
                             .group_by(IssueAssignment.worker_id)).all())
    done = dict(db.execute(select(IssueAssignment.worker_id, func.count()).where(IssueAssignment.completed_at.is_not(None))
                           .group_by(IssueAssignment.worker_id)).all())
    out = []
    for w in rows:
        d = user_dict(w)
        d.update({"employee_code": w.worker_profile.employee_code if w.worker_profile else None,
                  "skills": w.worker_profile.skills if w.worker_profile else None,
                  "active_tasks": active.get(w.id, 0), "completed_tasks": done.get(w.id, 0)})
        out.append(d)
    return out


@router.post("/workers", status_code=201)
def create_worker(body: WorkerIn, db: Session = Depends(get_db), admin: User = Admin):
    if admin.department_id and body.department_id != admin.department_id:
        raise HTTPException(403, "You can only add workers to your own department.")
    if db.scalar(select(User).where(User.email == body.email.lower())):
        raise HTTPException(409, "That email is already registered.")
    w = User(email=body.email.lower(), full_name=body.full_name, phone=body.phone, role="worker",
             department_id=body.department_id, password_hash=hash_password(body.password))
    db.add(w)
    db.flush()
    db.add(WorkerProfile(user_id=w.id, department_id=body.department_id, employee_code=body.employee_code, skills=body.skills))
    audit.record(db, actor=admin, action="worker.created", entity_type="user", entity_id=w.id,
                 new={"email": w.email, "department_id": body.department_id})
    db.commit()
    return {"id": str(w.id)}


@router.post("/workers/{worker_id}/active")
def set_worker_active(worker_id: uuid.UUID, active: bool, db: Session = Depends(get_db), admin: User = Admin):
    w = db.get(User, worker_id)
    if not w or w.role != "worker":
        _404()
    if admin.department_id and w.department_id != admin.department_id:
        raise HTTPException(403, "That worker is in another department.")
    w.is_active = active
    audit.record(db, actor=admin, action="worker.activated" if active else "worker.deactivated", entity_type="user", entity_id=w.id)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ SLA
@router.get("/sla")
def sla_rules(db: Session = Depends(get_db), admin: User = Admin):
    rows = db.scalars(select(SLAConfiguration).order_by(SLAConfiguration.category_id.nulls_first(), SLAConfiguration.priority)).all()
    return [{"id": str(r.id), "category_id": str(r.category_id) if r.category_id else None,
             "category": r.category.name if r.category else "All categories", "priority": r.priority,
             "response_hours": r.response_hours, "resolution_hours": r.resolution_hours,
             "warning_threshold": r.warning_threshold, "is_active": r.is_active} for r in rows]


@router.post("/sla", status_code=201)
def upsert_sla(body: SLAIn, db: Session = Depends(get_db), admin: User = Admin):
    _city_admin(admin)
    if body.resolution_hours < body.response_hours:
        raise HTTPException(422, "Resolution time must be at least the response time.")
    r = db.scalar(select(SLAConfiguration).where(SLAConfiguration.priority == body.priority,
                                                 SLAConfiguration.category_id.is_(None) if body.category_id is None
                                                 else SLAConfiguration.category_id == body.category_id))
    old = None
    if r:
        old = {"response_hours": r.response_hours, "resolution_hours": r.resolution_hours,
               "warning_threshold": r.warning_threshold, "is_active": r.is_active}
        for k, v in body.model_dump().items():
            setattr(r, k, v)
    else:
        r = SLAConfiguration(**body.model_dump())
        db.add(r)
    db.flush()
    audit.record(db, actor=admin, action="sla.updated" if old else "sla.created", entity_type="sla", entity_id=r.id,
                 old=old, new=body.model_dump())
    db.commit()
    return {"id": str(r.id), "note": "Applies to issues verified from now on."}


# ------------------------------------------------------------------ announcements, commitments, expenditure
@router.post("/announcements", status_code=201)
def create_announcement(body: AnnouncementIn, db: Session = Depends(get_db), admin: User = Admin):
    a = Announcement(published_by=admin.id, **body.model_dump())
    db.add(a)
    db.flush()
    audit.record(db, actor=admin, action="announcement.published", entity_type="announcement", entity_id=a.id, new=body.model_dump())
    citizens = list(db.scalars(select(User.id).where(User.role == "citizen", User.is_active)))
    notifications.notify(db, citizens, kind="announcement", title=body.title, body=body.body[:200], link="/transparency#announcements")
    db.commit()
    db.refresh(a)
    return announcement_dict(a)


@router.post("/commitments", status_code=201)
def create_commitment(body: CommitmentIn, db: Session = Depends(get_db), admin: User = Admin):
    c = PublicCommitment(created_by=admin.id, **body.model_dump())
    db.add(c)
    db.flush()
    audit.record(db, actor=admin, action="commitment.published", entity_type="commitment", entity_id=c.id, new=body.model_dump())
    db.commit()
    db.refresh(c)
    return commitment_dict(c)


@router.put("/commitments/{cid}")
def update_commitment(cid: uuid.UUID, body: CommitmentIn, db: Session = Depends(get_db), admin: User = Admin):
    c = db.get(PublicCommitment, cid) or _404()
    old = commitment_dict(c)
    for k, v in body.model_dump().items():
        setattr(c, k, v)
    audit.record(db, actor=admin, action="commitment.updated", entity_type="commitment", entity_id=c.id,
                 old={k: old[k] for k in ("progress_percent", "status", "expected_completion")}, new=body.model_dump())
    db.commit()
    db.refresh(c)
    return commitment_dict(c)


@router.post("/expenditures", status_code=201)
def create_expenditure(body: ExpenditureIn, db: Session = Depends(get_db), admin: User = Admin):
    e = ExpenditureRecord(created_by=admin.id, **body.model_dump())
    db.add(e)
    db.flush()
    audit.record(db, actor=admin, action="expenditure.recorded", entity_type="expenditure", entity_id=e.id,
                 issue_id=body.issue_id, new=body.model_dump())
    db.commit()
    db.refresh(e)
    return expenditure_dict(e, db)


@router.put("/expenditures/{eid}")
def update_expenditure(eid: uuid.UUID, body: ExpenditureIn, db: Session = Depends(get_db), admin: User = Admin):
    e = db.get(ExpenditureRecord, eid) or _404()
    old = expenditure_dict(e, db)
    for k, v in body.model_dump().items():
        setattr(e, k, v)
    audit.record(db, actor=admin, action="expenditure.updated", entity_type="expenditure", entity_id=e.id, issue_id=e.issue_id,
                 old={k: old[k] for k in ("estimated_cost", "actual_cost", "verification_status")}, new=body.model_dump())
    db.commit()
    db.refresh(e)
    return expenditure_dict(e, db)


# ------------------------------------------------------------------ moderation
@router.get("/moderation")
def moderation_queue(db: Session = Depends(get_db), admin: User = Admin):
    from app.models import CommentReport
    rows = db.execute(select(IssueComment, func.count(CommentReport.id)).join(CommentReport, CommentReport.comment_id == IssueComment.id)
                      .group_by(IssueComment.id).order_by(func.count(CommentReport.id).desc())).all()
    out = []
    for c, n in rows:
        issue = db.get(Issue, c.issue_id)
        reasons = list(db.scalars(select(CommentReport.reason).where(CommentReport.comment_id == c.id)))
        out.append({"id": str(c.id), "body": c.body, "author": c.author.full_name, "reports": n, "reasons": reasons,
                    "is_hidden": c.is_hidden, "reviewed": c.hidden_by is not None, "created_at": c.created_at,
                    "issue": {"tracking_id": issue.tracking_id, "title": issue.title}})
    return out


@router.post("/comments/{comment_id}/moderate")
def moderate(comment_id: uuid.UUID, body: ModerateIn, db: Session = Depends(get_db), admin: User = Admin):
    c = db.get(IssueComment, comment_id) or _404()
    old = {"is_hidden": c.is_hidden}
    c.is_hidden, c.hidden_reason, c.hidden_by = body.hide, body.reason, admin.id
    audit.record(db, actor=admin, action="comment.hidden" if body.hide else "comment.restored", entity_type="comment",
                 entity_id=c.id, issue_id=c.issue_id, old=old, new={"is_hidden": body.hide}, reason=body.reason)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ audit
@router.get("/audit")
def audit_log(issue: str | None = None, action: str | None = None, actor: uuid.UUID | None = None,
              page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
              db: Session = Depends(get_db), admin: User = Admin):
    q = select(AuditLog)
    if issue:
        target = issue_service.get_by_tracking(db, issue)
        ensure_admin_scope(admin, target)
        q = q.where(AuditLog.issue_id == target.id)
    if action:
        q = q.where(AuditLog.action.ilike(f"{action}%"))
    if actor:
        q = q.where(AuditLog.actor_id == actor)
    total = db.scalar(select(func.count()).select_from(q.subquery()))
    rows = db.scalars(q.order_by(AuditLog.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    tids = {r.issue_id for r in rows if r.issue_id}
    tmap = dict(db.execute(select(Issue.id, Issue.tracking_id).where(Issue.id.in_(tids))).all()) if tids else {}
    return {"total": total, "items": [{
        "id": r.id, "at": r.created_at, "actor": r.actor.full_name if r.actor else "System", "actor_role": r.actor_role,
        "action": r.action, "entity_type": r.entity_type, "entity_id": r.entity_id,
        "tracking_id": tmap.get(r.issue_id), "old": r.old_values, "new": r.new_values, "reason": r.reason,
        "ip": r.ip_address} for r in rows]}


@router.get("/users")
def users(role: str | None = None, db: Session = Depends(get_db), admin: User = Admin):
    q = select(User).order_by(User.created_at.desc()).limit(200)
    if role:
        q = q.where(User.role == role)
    return [user_dict(u) for u in db.scalars(q)]
