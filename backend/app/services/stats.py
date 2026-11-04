"""Every number on every dashboard comes from here, computed with SQL over live rows.

Nothing is hard-coded. Each result carries `sample_size` and the date range it covers so the UI can
show context (e.g. "based on 14 resolved issues, Jan–Nov 2026") and avoid misleading rankings.
Rows created by the seed script have is_demo = true; results report how many demo rows are
included so the UI can label them.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import and_, case, extract, func, select
from sqlalchemy.orm import Session

from app.models import CitizenFeedback, Department, Issue, IssueCategory, Locality

PENDING = ("submitted", "pending_verification")
ACTIVE = ("verified", "assigned", "in_progress", "on_hold", "escalated", "reopened")
IN_PROGRESS = ("assigned", "in_progress", "on_hold", "escalated")
CLOSED = ("resolved", "rejected")
MIN_SAMPLE_FOR_RANKING = 5


def _hours(expr):
    return extract("epoch", expr) / 3600.0


def _filters(date_from=None, date_to=None, department_id=None, locality_id=None, category_id=None):
    conds = []
    if date_from:
        conds.append(Issue.created_at >= date_from)
    if date_to:
        conds.append(Issue.created_at <= date_to)
    if department_id:
        conds.append(Issue.department_id == department_id)
    if locality_id:
        conds.append(Issue.locality_id == locality_id)
    if category_id:
        conds.append(Issue.category_id == category_id)
    return conds


def overview(db: Session, **f) -> dict:
    now = datetime.now(timezone.utc)
    conds = _filters(**f)
    overdue_expr = and_(Issue.resolution_due_at.is_not(None), Issue.resolution_due_at < now,
                        Issue.status.not_in(CLOSED))
    row = db.execute(select(
        func.count(),
        func.count().filter(Issue.status.in_(PENDING)),
        func.count().filter(Issue.status == "verified"),
        func.count().filter(Issue.status.in_(IN_PROGRESS)),
        func.count().filter(Issue.status == "awaiting_verification"),
        func.count().filter(Issue.status == "resolved"),
        func.count().filter(Issue.status == "rejected"),
        func.count().filter(Issue.status == "reopened"),
        func.count().filter(overdue_expr),
        func.avg(case((Issue.status == "resolved", _hours(Issue.resolved_at - Issue.created_at)))),
        func.avg(_hours(Issue.first_response_at - Issue.created_at)),
        func.count().filter(Issue.first_response_at.is_not(None)),
        func.count().filter(Issue.is_demo),
        func.min(Issue.created_at), func.max(Issue.created_at),
    ).where(*conds)).one()
    (total, pending, verified, in_prog, awaiting, resolved, rejected, reopened, overdue,
     avg_res, avg_resp, resp_n, demo, first, last) = row
    actionable = total - rejected
    sat = db.execute(select(func.avg(CitizenFeedback.rating), func.count(),
                            func.count().filter(CitizenFeedback.was_fixed))
                     .join(Issue, Issue.id == CitizenFeedback.issue_id).where(*conds)).one()
    return {
        "total": total, "pending": pending, "verified": verified, "in_progress": in_prog,
        "awaiting_verification": awaiting, "resolved": resolved, "rejected": rejected,
        "reopened": reopened, "overdue": overdue,
        "resolution_rate": round(resolved / actionable, 3) if actionable else None,
        "avg_resolution_hours": round(float(avg_res), 1) if avg_res is not None else None,
        "resolved_sample": resolved,
        "avg_response_hours": round(float(avg_resp), 1) if avg_resp is not None else None,
        "response_sample": resp_n,
        "satisfaction_avg": round(float(sat[0]), 2) if sat[0] is not None else None,
        "satisfaction_sample": sat[1], "confirmed_fixed": sat[2],
        "demo_rows": demo, "date_range": {"from": first, "to": last},
        "generated_at": now,
    }


def monthly_trends(db: Session, months: int = 12, **f) -> list[dict]:
    conds = _filters(**f)
    month = func.date_trunc("month", Issue.created_at)
    reported = dict(db.execute(select(month, func.count()).where(*conds).group_by(month)).all())
    rmonth = func.date_trunc("month", Issue.resolved_at)
    resolved = dict(db.execute(select(rmonth, func.count()).where(Issue.resolved_at.is_not(None), *conds)
                               .group_by(rmonth)).all())
    avg = dict(db.execute(select(rmonth, func.avg(_hours(Issue.resolved_at - Issue.created_at)))
                          .where(Issue.resolved_at.is_not(None), *conds).group_by(rmonth)).all())
    keys = sorted(set(reported) | set(resolved))[-months:]
    return [{"month": k.strftime("%Y-%m"), "label": k.strftime("%b %Y"), "reported": reported.get(k, 0),
             "resolved": resolved.get(k, 0),
             "avg_resolution_hours": round(float(avg[k]), 1) if avg.get(k) is not None else None} for k in keys]


def by_category(db: Session, **f) -> list[dict]:
    conds = _filters(**f)
    rows = db.execute(select(
        IssueCategory.id, IssueCategory.name, IssueCategory.slug, IssueCategory.icon,
        func.count(Issue.id), func.count(Issue.id).filter(Issue.status == "resolved"),
        func.avg(case((Issue.status == "resolved", _hours(Issue.resolved_at - Issue.created_at)))),
    ).join(Issue, Issue.category_id == IssueCategory.id).where(*conds)
        .group_by(IssueCategory.id).order_by(func.count(Issue.id).desc())).all()
    return [{"id": str(r[0]), "name": r[1], "slug": r[2], "icon": r[3], "total": r[4], "resolved": r[5],
             "avg_resolution_hours": round(float(r[6]), 1) if r[6] is not None else None} for r in rows]


def by_priority(db: Session, **f) -> list[dict]:
    conds = _filters(**f)
    rows = db.execute(select(Issue.priority, func.count()).where(*conds).group_by(Issue.priority)).all()
    order = {"critical": 0, "high": 1, "medium": 2, "low": 3, None: 4}
    return sorted([{"priority": p or "unset", "total": n} for p, n in rows], key=lambda r: order.get(r["priority"], 5))


def department_scorecards(db: Session, **f) -> list[dict]:
    now = datetime.now(timezone.utc)
    conds = _filters(**{k: v for k, v in f.items() if k != "department_id"})
    rows = db.execute(select(
        Department.id, Department.name, Department.code,
        func.count(Issue.id),
        func.count(Issue.id).filter(Issue.status == "resolved"),
        func.count(Issue.id).filter(Issue.status == "rejected"),
        func.avg(_hours(Issue.first_response_at - Issue.created_at)),
        func.avg(case((Issue.status == "resolved", _hours(Issue.resolved_at - Issue.created_at)))),
        func.count(Issue.id).filter(and_(Issue.resolution_due_at < now, Issue.status.not_in(CLOSED))),
        func.count(Issue.id).filter(Issue.overdue_flagged_at.is_not(None)),
        func.min(Issue.created_at), func.max(Issue.created_at),
    ).outerjoin(Issue, and_(Issue.department_id == Department.id, *conds))
        .group_by(Department.id).order_by(Department.name)).all()
    sat = dict((d, (a, n)) for d, a, n in db.execute(
        select(Issue.department_id, func.avg(CitizenFeedback.rating), func.count())
        .join(CitizenFeedback, CitizenFeedback.issue_id == Issue.id).where(*conds).group_by(Issue.department_id)).all())
    out = []
    for r in rows:
        total, resolved, rejected = r[3], r[4], r[5]
        actionable = total - rejected
        s = sat.get(r[0], (None, 0))
        out.append({
            "id": str(r[0]), "name": r[1], "code": r[2], "assigned": total, "resolved": resolved,
            "resolution_rate": round(resolved / actionable, 3) if actionable else None,
            "avg_response_hours": round(float(r[6]), 1) if r[6] is not None else None,
            "avg_resolution_hours": round(float(r[7]), 1) if r[7] is not None else None,
            "overdue_now": r[8], "ever_overdue": r[9],
            "satisfaction_avg": round(float(s[0]), 2) if s[0] is not None else None,
            "satisfaction_sample": s[1],
            "sample_size": total, "date_range": {"from": r[10], "to": r[11]},
            "enough_data": total >= MIN_SAMPLE_FOR_RANKING,
        })
    return out


def locality_stats(db: Session, locality_id: uuid.UUID) -> dict | None:
    loc = db.get(Locality, locality_id)
    if not loc:
        return None
    ov = overview(db, locality_id=locality_id)
    cats = by_category(db, locality_id=locality_id)[:5]
    depts = [d for d in department_scorecards(db, locality_id=locality_id) if d["assigned"]]
    from app.integrations.ai import hotspots  # local import avoids a cycle
    recurring = [h for h in hotspots.detect(db, min_points=3) if h["locality"] == loc.name and h["recurring"]]
    return {
        "locality": {"id": str(loc.id), "name": loc.name, "is_approximate": loc.is_approximate,
                     "boundary_source": loc.boundary_source,
                     "population": loc.population if loc.population_source else None,
                     "population_source": loc.population_source},
        "overview": ov, "top_categories": cats, "departments": depts, "recurring_hotspots": recurring,
    }


def localities_summary(db: Session) -> list[dict]:
    rows = db.execute(select(
        Locality.id, Locality.name, Locality.is_approximate,
        func.count(Issue.id), func.count(Issue.id).filter(Issue.status == "resolved"),
        func.count(Issue.id).filter(Issue.status.not_in(CLOSED)),
    ).outerjoin(Issue, Issue.locality_id == Locality.id).group_by(Locality.id).order_by(Locality.name)).all()
    return [{"id": str(r[0]), "name": r[1], "is_approximate": r[2], "total": r[3], "resolved": r[4], "open": r[5]}
            for r in rows]
