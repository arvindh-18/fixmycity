"""Find existing issues that might describe the same problem.

Algorithm (all steps explainable):
  1. PostGIS `ST_DWithin` finds non-rejected issues within RADIUS_M metres (uses the GiST index).
  2. For each candidate compute three signals in [0, 1]:
       distance  = 1 - metres / RADIUS_M        (closer = higher)
       category  = 1 if same category else 0
       text      = TF-IDF cosine similarity of title+description
  3. score = 0.45*distance + 0.25*category + 0.30*text, minus 0.15 if the candidate is already
     resolved (a resolved issue may still be relevant: the problem could have come back).
  4. Return candidates with score >= THRESHOLD, best first.

Nothing is ever merged automatically: citizens may choose to support an existing report, and only
an admin can mark a report as a duplicate.
"""
from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.integrations.ai.text import similarity_to_many
from app.models import Issue

RADIUS_M = 400
THRESHOLD = 0.35


def find(db: Session, *, lat: float, lng: float, title: str, description: str,
         category_id: uuid.UUID | None, exclude_id: uuid.UUID | None = None, limit: int = 5) -> list[dict]:
    here = func.ST_SetSRID(func.ST_MakePoint(lng, lat), 4326)
    here_geog = func.Geography(here)
    dist = func.ST_Distance(Issue.location, here_geog)
    q = (select(Issue, dist.label("meters"))
         .where(func.ST_DWithin(Issue.location, here_geog, RADIUS_M), Issue.status != "rejected")
         .order_by(dist).limit(40))
    if exclude_id:
        q = q.where(Issue.id != exclude_id)
    rows = db.execute(q).all()
    if not rows:
        return []
    sims = similarity_to_many(f"{title} {description}", [f"{i.title} {i.description}" for i, _ in rows])
    out = []
    for (issue, meters), text_sim in zip(rows, sims):
        d = max(0.0, 1 - float(meters) / RADIUS_M)
        c = 1.0 if category_id and issue.category_id == category_id else 0.0
        score = 0.45 * d + 0.25 * c + 0.30 * text_sim - (0.15 if issue.status == "resolved" else 0)
        if score >= THRESHOLD:
            out.append({
                "issue_id": str(issue.id), "tracking_id": issue.tracking_id, "title": issue.title,
                "status": issue.status, "category": issue.category.name if issue.category else None,
                "distance_m": round(float(meters)), "score": round(score, 2),
                "signals": {"distance": round(d, 2), "same_category": bool(c), "text_similarity": round(text_sim, 2)},
            })
    out.sort(key=lambda r: r["score"], reverse=True)
    return out[:limit]
