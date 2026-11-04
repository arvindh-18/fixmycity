"""Issue creation, lookups and the public timeline."""
from __future__ import annotations

import secrets
import string
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.integrations.ai import classifier, priority as priority_engine
from app.models import (
    AIRecommendation, Issue, IssueAssignment, IssueCategory, IssueEvidence, IssueImage,
    IssueStatusHistory, IssueUpdate, Locality, User,
)
from app.schemas.serializers import public_name
from app.services import audit, notifications
from app.services.lifecycle import STATUS_LABELS

ALPHABET = string.ascii_uppercase.replace("O", "").replace("I", "") + "23456789"


def new_tracking_id(db: Session) -> str:
    year = datetime.now(timezone.utc).year
    while True:
        tid = f"CM-{year}-" + "".join(secrets.choice(ALPHABET) for _ in range(6))
        if not db.scalar(select(Issue.id).where(Issue.tracking_id == tid)):
            return tid


def locality_for(db: Session, lat: float, lng: float) -> Locality | None:
    pt = func.Geography(func.ST_SetSRID(func.ST_MakePoint(lng, lat), 4326))
    return db.scalar(select(Locality).where(func.ST_Intersects(Locality.boundary, pt)).limit(1))


def wkt_point(lat: float, lng: float) -> str:
    return f"SRID=4326;POINT({lng} {lat})"


def get_by_tracking(db: Session, tracking_id: str) -> Issue:
    issue = db.scalar(select(Issue).where(Issue.tracking_id == tracking_id.upper())
                      .options(selectinload(Issue.images), selectinload(Issue.assignments)))
    if not issue:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No issue with that tracking ID.")
    return issue


def get_by_id(db: Session, issue_id: uuid.UUID) -> Issue:
    issue = db.get(Issue, issue_id)
    if not issue:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Issue not found.")
    return issue


def category_payload(db: Session) -> list[dict]:
    return [{"id": c.id, "slug": c.slug, "name": c.name, "keywords": c.keywords or []}
            for c in db.scalars(select(IssueCategory).where(IssueCategory.is_active))]


def create_issue(db: Session, *, title: str, description: str, category_id: uuid.UUID, lat: float, lng: float,
                 address: str | None, additional_info: str | None, reporter: User | None,
                 anon_token_hash: str | None, image_urls: list[str], ip: str | None, is_demo: bool = False,
                 first_image: bytes | None = None) -> Issue:
    category = db.get(IssueCategory, category_id)
    if not category or not category.is_active:
        raise HTTPException(422, "Choose a valid category.")
    loc = locality_for(db, lat, lng)
    issue = Issue(
        tracking_id=new_tracking_id(db), title=title.strip(), description=description.strip(),
        category_id=category.id, department_id=None, locality_id=loc.id if loc else None,
        status="submitted", reporter_id=reporter.id if reporter else None,
        is_anonymous=reporter is None, anon_token_hash=anon_token_hash,
        location=wkt_point(lat, lng), address=(address or "").strip() or None,
        additional_info=(additional_info or "").strip() or None, is_demo=is_demo,
    )
    db.add(issue)
    db.flush()
    for url in image_urls:
        db.add(IssueImage(issue_id=issue.id, uploader_id=reporter.id if reporter else None, kind="report", url=url))
    db.add(IssueStatusHistory(issue_id=issue.id, from_status=None, to_status="submitted",
                              actor_id=reporter.id if reporter else None,
                              actor_role=reporter.role if reporter else "anonymous",
                              reason="Report received", is_public=True))
    audit.record(db, actor=reporter, action="issue.created", entity_type="issue", entity_id=issue.id,
                 issue_id=issue.id, new={"title": issue.title, "category": category.slug,
                                         "anonymous": issue.is_anonymous}, ip=ip)
    db.flush()
    db.refresh(issue)

    # AI suggestions are stored for the admin to review; they never change the issue itself.
    cls = classifier.classify(title, description, category_payload(db), image=first_image)
    db.add(AIRecommendation(issue_id=issue.id, kind="classification", mode=cls["mode"], provider=cls["provider"],
                            output=_jsonable(cls), confidence=cls["confidence"]))
    pr = priority_engine.recommend(db, issue)
    db.add(AIRecommendation(issue_id=issue.id, kind="priority", mode=pr["mode"], provider=pr["provider"],
                            output=pr, confidence=pr["confidence"]))

    notifications.notify(db, notifications.admins_for(db, issue), kind="new_issue",
                         title=f"New report {issue.tracking_id}", body=issue.title, issue=issue,
                         link=f"/admin/issues/{issue.tracking_id}")
    if reporter:
        notifications.notify(db, [reporter.id], kind="submitted", title=f"We received {issue.tracking_id}",
                             body="Track progress on the issue page.", issue=issue)
    return issue


def _jsonable(d: dict) -> dict:
    return {k: (str(v) if isinstance(v, uuid.UUID) else v) for k, v in d.items()}


ACTOR_LABEL = {"admin": "An official", "worker": "The crew", "citizen": "The reporter",
               "anonymous": "The reporter", "system": "Commons"}


def _update_actor(u: IssueUpdate, include_internal: bool) -> str:
    if include_internal and u.author:
        return u.author.full_name
    if u.kind == "dispute":
        return "Reporter"
    return ACTOR_LABEL.get(u.author.role if u.author else "system", "Commons")


def timeline(db: Session, issue: Issue, include_internal: bool) -> list[dict]:
    """Merge status changes, updates and evidence into one chronological accountability trail."""
    items: list[dict] = []
    for h in db.scalars(select(IssueStatusHistory).where(IssueStatusHistory.issue_id == issue.id)
                        .order_by(IssueStatusHistory.created_at)):
        if not h.is_public and not include_internal:
            continue
        actor = ACTOR_LABEL.get(h.actor_role, h.actor_role)
        if include_internal and h.actor:
            actor = f"{h.actor.full_name} ({h.actor_role})"
        items.append({"id": str(h.id), "type": "status", "at": h.created_at, "status": h.to_status,
                      "from_status": h.from_status, "title": STATUS_LABELS.get(h.to_status, h.to_status),
                      "body": h.reason, "actor": actor, "is_public": h.is_public})
    for u in db.scalars(select(IssueUpdate).where(IssueUpdate.issue_id == issue.id).order_by(IssueUpdate.created_at)):
        public_text = u.public_summary if u.summary_status == "approved" else (u.body if u.kind in ("official", "dispute") and u.is_public else None)
        if not include_internal and not public_text:
            continue
        items.append({
            "id": str(u.id), "type": "update", "kind": u.kind, "at": u.created_at,
            "title": {"progress": "Progress update", "official": "Update from the council", "obstacle": "Held up on site",
                      "resource_request": "Materials requested", "assistance_request": "Crew asked for help",
                      "dispute": "Reporter says it isn't fixed"}[u.kind],
            "body": u.body if include_internal else public_text,
            "public_summary": u.public_summary, "summary_status": u.summary_status,
            "summary_source": u.summary_source,
            "actor": _update_actor(u, include_internal),
            "is_public": bool(public_text),
        })
    for e in db.scalars(select(IssueEvidence).where(IssueEvidence.issue_id == issue.id)
                        .options(selectinload(IssueEvidence.images)).order_by(IssueEvidence.submitted_at)):
        items.append({
            "id": str(e.id), "type": "evidence", "at": e.submitted_at, "title": "Before-and-after photos sent",
            "body": e.description, "work_notes": e.work_notes if include_internal else None,
            "review_status": e.review_status,
            "images": [{"url": im.url, "kind": im.kind} for im in e.images],
            "actor": e.submitter.full_name if include_internal else "The crew", "is_public": True,
        })
    for a in db.scalars(select(IssueAssignment).where(IssueAssignment.issue_id == issue.id)):
        if a.acknowledged_at:
            items.append({"id": f"ack-{a.id}", "type": "ack", "at": a.acknowledged_at,
                          "title": "Crew acknowledged the job", "body": None,
                          "actor": a.worker.full_name, "is_public": True})
    items.sort(key=lambda i: i["at"])
    return items


def evidence_list(db: Session, issue: Issue, include_internal: bool) -> list[dict]:
    out = []
    for e in db.scalars(select(IssueEvidence).where(IssueEvidence.issue_id == issue.id)
                        .options(selectinload(IssueEvidence.images)).order_by(IssueEvidence.submitted_at.desc())):
        out.append({"id": str(e.id), "description": e.description,
                    "work_notes": e.work_notes if include_internal else None,
                    "submitted_at": e.submitted_at, "review_status": e.review_status,
                    "submitted_by": e.submitter.full_name,
                    "before": [im.url for im in e.images if im.kind == "before"],
                    "after": [im.url for im in e.images if im.kind == "after"]})
    return out


__all__ = ["create_issue", "timeline", "get_by_tracking", "public_name"]
