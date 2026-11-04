"""Turn ORM objects into JSON-safe dicts.

There are deliberately separate functions for PUBLIC and PRIVATE views. Public serializers never
include reporter identity, email, phone or internal notes — so a mistake in a router can't leak
them by accident.
"""
from __future__ import annotations

import uuid
from typing import Iterable

from geoalchemy2.shape import to_shape
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    Issue, IssueAssignment, IssueFollower, IssueVote, User,
)
from app.services import sla
from app.services.lifecycle import STATUS_LABELS


def point(geom) -> tuple[float | None, float | None]:
    if geom is None:
        return None, None
    p = to_shape(geom)
    return p.y, p.x


def public_name(user: User | None) -> str:
    """'Priya S.' — first name plus initial. Never the email."""
    if not user:
        return "Anonymous"
    parts = user.full_name.split()
    return parts[0] if len(parts) == 1 else f"{parts[0]} {parts[-1][0]}."


def staff_name(user: User | None) -> str | None:
    if not user:
        return None
    return user.full_name


def counts_for(db: Session, issue_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, dict]:
    ids = list(issue_ids)
    out = {i: {"support_count": 0, "follower_count": 0} for i in ids}
    if not ids:
        return out
    for iid, n in db.execute(select(IssueVote.issue_id, func.count()).where(IssueVote.issue_id.in_(ids)).group_by(IssueVote.issue_id)):
        out[iid]["support_count"] = n
    for iid, n in db.execute(select(IssueFollower.issue_id, func.count()).where(IssueFollower.issue_id.in_(ids)).group_by(IssueFollower.issue_id)):
        out[iid]["follower_count"] = n
    return out


def category_dict(c) -> dict | None:
    return {"id": str(c.id), "name": c.name, "slug": c.slug, "icon": c.icon} if c else None


def issue_card(issue: Issue, counts: dict | None = None) -> dict:
    """Public-safe summary used in lists, maps and cards."""
    lat, lng = point(issue.location)
    counts = counts or {"support_count": 0, "follower_count": 0}
    thumb = next((im.url for im in issue.images if im.kind == "report"), None)
    return {
        "id": str(issue.id),
        "tracking_id": issue.tracking_id,
        "title": issue.title,
        "description": issue.description,
        "category": category_dict(issue.category),
        "status": issue.status,
        "status_label": STATUS_LABELS.get(issue.status, issue.status),
        "priority": issue.priority,
        "department": {"id": str(issue.department.id), "name": issue.department.name} if issue.department else None,
        "locality": {"id": str(issue.locality.id), "name": issue.locality.name} if issue.locality else None,
        "lat": lat,
        "lng": lng,
        "address": issue.address,
        "created_at": issue.created_at,
        "updated_at": issue.updated_at,
        "verified_at": issue.verified_at,
        "resolved_at": issue.resolved_at,
        "thumbnail": thumb,
        "is_anonymous": issue.is_anonymous,
        "is_demo": issue.is_demo,
        "sla": sla.sla_state(issue),
        "escalation_level": issue.escalation_level,
        **counts,
    }


def issue_detail(db: Session, issue: Issue, viewer: User | None) -> dict:
    counts = counts_for(db, [issue.id])[issue.id]
    data = issue_card(issue, counts)
    active = next((a for a in issue.assignments if a.is_active), None)
    data.update({
        "additional_info": issue.additional_info,
        "images": [
            {"id": str(im.id), "url": im.url, "kind": im.kind, "caption": im.caption, "created_at": im.created_at}
            for im in issue.images if im.evidence_id is None
        ],
        "reporter_name": None if issue.is_anonymous else public_name(issue.reporter),
        # Worker name is shown publicly as accountability — staff act in an official capacity.
        "assigned_worker": {"name": staff_name(active.worker), "assigned_at": active.created_at,
                             "acknowledged_at": active.acknowledged_at, "due_at": active.due_at} if active else None,
        "duplicate_of": None,
        "viewer": {
            "is_reporter": bool(viewer and issue.reporter_id == viewer.id),
            "has_supported": bool(viewer and db.get(IssueVote, (issue.id, viewer.id))),
            "is_following": bool(viewer and db.get(IssueFollower, (issue.id, viewer.id))),
            "is_assigned_worker": bool(viewer and active and active.worker_id == viewer.id),
            "role": viewer.role if viewer else None,
        },
    })
    if issue.duplicate_of_id:
        dup = db.get(Issue, issue.duplicate_of_id)
        data["duplicate_of"] = {"tracking_id": dup.tracking_id, "title": dup.title} if dup else None
    return data


def assignment_dict(a: IssueAssignment) -> dict:
    return {
        "id": str(a.id), "issue_id": str(a.issue_id), "worker_id": str(a.worker_id),
        "worker_name": a.worker.full_name, "department_id": str(a.department_id),
        "instructions": a.instructions, "due_at": a.due_at, "acknowledged_at": a.acknowledged_at,
        "started_at": a.started_at, "completed_at": a.completed_at, "is_active": a.is_active,
        "created_at": a.created_at,
    }


def user_dict(u: User) -> dict:
    return {
        "id": str(u.id), "email": u.email, "full_name": u.full_name, "phone": u.phone, "role": u.role,
        "department": {"id": str(u.department.id), "name": u.department.name} if u.department else None,
        "is_active": u.is_active, "email_notifications": u.email_notifications, "created_at": u.created_at,
    }
