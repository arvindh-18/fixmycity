"""Smart priority recommendation (a transparent points system, not a black box).

Each factor adds points and an English explanation. The total maps to a priority:
    >= 60 critical · >= 40 high · >= 20 medium · otherwise low

Factors
  * Safety language in the report (live wire, open manhole, flooding…)      up to 30
  * Citizens supporting the report (2 points each)                            up to 20
  * Days the report has been waiting (1.5 points per day)                     up to 15
  * School / hospital within 250 m — only if facility data has been loaded    15
  * Recurring problem: 3+ reports of the same category within 300 m / 90 d    10
  * Locality population recorded with a source, over 100,000                  5

The result is stored as an AI recommendation; an administrator always makes the final decision.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Facility, Issue, IssueVote

SAFETY_TERMS = {
    "live wire": 15, "electrocut": 15, "sparking": 12, "open manhole": 15, "manhole": 8,
    "accident": 12, "injur": 12, "collapse": 12, "flood": 10, "sewage overflow": 10,
    "contaminat": 10, "dark": 4, "child": 6, "elderly": 6, "fire": 12, "danger": 8, "fell": 8,
}


def _band(points: int) -> str:
    return "critical" if points >= 60 else "high" if points >= 40 else "medium" if points >= 20 else "low"


def recommend(db: Session, issue: Issue) -> dict:
    reasons: list[dict] = []
    total = 0
    # Read the stored geography from the DB (works even if the ORM object holds a WKT string).
    here = select(Issue.location).where(Issue.id == issue.id).scalar_subquery()
    text = f"{issue.title} {issue.description}".lower()

    safety = 0
    hits = []
    for term, pts in SAFETY_TERMS.items():
        if term in text:
            safety += pts
            hits.append(term)
    safety = min(30, safety)
    if safety:
        total += safety
        reasons.append({"factor": "Safety risk", "points": safety, "detail": f"Report mentions: {', '.join(hits)}"})

    supporters = db.scalar(select(func.count()).select_from(IssueVote).where(IssueVote.issue_id == issue.id)) or 0
    if supporters:
        pts = min(20, supporters * 2)
        total += pts
        reasons.append({"factor": "Community support", "points": pts, "detail": f"{supporters} citizens support this report"})

    days = (datetime.now(timezone.utc) - issue.created_at).total_seconds() / 86400
    if days >= 1:
        pts = int(min(15, days * 1.5))
        total += pts
        reasons.append({"factor": "Time waiting", "points": pts, "detail": f"Reported {int(days)} days ago"})

    facility_count = db.scalar(select(func.count()).select_from(Facility)) or 0
    if facility_count:
        near = db.execute(
            select(Facility.name, Facility.kind, func.ST_Distance(Facility.location, here).label("m"))
            .where(Facility.kind.in_(["school", "hospital", "clinic"]),
                   func.ST_DWithin(Facility.location, here, 250))
            .order_by("m").limit(1)
        ).first()
        if near:
            total += 15
            reasons.append({"factor": "Vulnerable location", "points": 15,
                            "detail": f"{near.kind.title()} '{near.name}' is {int(near.m)} m away"})
    else:
        reasons.append({"factor": "Vulnerable location", "points": 0,
                        "detail": "No school/hospital location data loaded — factor not scored"})

    since = datetime.now(timezone.utc) - timedelta(days=90)
    recurring = db.scalar(
        select(func.count()).select_from(Issue).where(
            Issue.id != issue.id, Issue.category_id == issue.category_id, Issue.created_at >= since,
            func.ST_DWithin(Issue.location, here, 300))
    ) or 0
    if recurring >= 2:
        total += 10
        reasons.append({"factor": "Recurring problem", "points": 10,
                        "detail": f"{recurring} other reports of this kind within 300 m in 90 days"})

    loc = issue.locality
    if loc and loc.population and loc.population_source and loc.population > 100_000:
        total += 5
        reasons.append({"factor": "Population", "points": 5,
                        "detail": f"{loc.name}: ~{loc.population:,} residents ({loc.population_source})"})

    priority = _band(total)
    scored = [r for r in reasons if r["points"]]
    confidence = round(min(0.9, 0.4 + 0.1 * len(scored)), 2)
    return {"priority": priority, "score": total, "reasons": reasons, "confidence": confidence,
            "mode": "rules", "provider": "rules"}
