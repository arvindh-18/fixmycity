"""Spot reports that are probably the same problem, and merge them.

A pair is a *candidate* when both are open/in progress, the same category, within RADIUS_M and the
existing one is at most WINDOW_DAYS old. Its score mixes closeness and word overlap:

    score = DISTANCE_WEIGHT * (1 - distance / RADIUS_M) + TEXT_WEIGHT * jaccard(words)

and it is flagged as a *likely duplicate* when score >= THRESHOLD. Distance weighs more because two
people rarely describe the same pothole with the same words.
"""
import math
import re
from datetime import timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .db import DuplicateFlag, Issue, Message, StatusUpdate, Upvote, now

RADIUS_M = 100
WINDOW_DAYS = 30
DISTANCE_WEIGHT = 0.6
TEXT_WEIGHT = 0.4
THRESHOLD = 0.6

STOP_WORDS = {
    "a", "an", "the", "and", "or", "of", "on", "in", "at", "to", "for", "near", "is", "are", "was", "it", "this",
    "that", "there", "here", "with", "from", "by", "be", "been", "has", "have", "not", "no", "very", "since", "my",
    "our", "road", "street", "st", "rd", "main", "cross", "please", "fix",
}


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[^\W_]+", (text or "").lower()) if len(w) > 1 and w not in STOP_WORDS}


def jaccard(a: str, b: str) -> float:
    wa, wb = _words(a), _words(b)
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def distance_m(lat1, lng1, lat2, lng2) -> float:
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def score(a: Issue, b: Issue) -> tuple[float, float]:
    dist = distance_m(a.lat, a.lng, b.lat, b.lng)
    text = jaccard(f"{a.title} {a.description}", f"{b.title} {b.description}")
    return round(DISTANCE_WEIGHT * max(0.0, 1 - dist / RADIUS_M) + TEXT_WEIGHT * text, 3), round(dist, 1)


def candidates(db: Session, issue: Issue) -> list[tuple[Issue, float, float]]:
    """Existing reports that look like `issue`, best match first: [(other, score, distance_m)]."""
    d = RADIUS_M / 111_000
    dlng = d / max(0.2, math.cos(math.radians(issue.lat)))
    stmt = select(Issue).where(
        Issue.id != issue.id,
        Issue.category == issue.category,
        Issue.status.in_(("open", "in_progress")),
        Issue.created_at >= now() - timedelta(days=WINDOW_DAYS),
        Issue.lat.between(issue.lat - d, issue.lat + d),
        Issue.lng.between(issue.lng - dlng, issue.lng + dlng),
    )
    out = []
    for other in db.scalars(stmt):
        s, dist = score(issue, other)
        if dist <= RADIUS_M and s >= THRESHOLD:
            out.append((other, s, dist))
    return sorted(out, key=lambda r: -r[1])


def flag(db: Session, issue: Issue) -> list[DuplicateFlag]:
    flags = [DuplicateFlag(issue_id=issue.id, candidate_id=o.id, score=s, distance_m=dist)
             for o, s, dist in candidates(db, issue)]
    db.add_all(flags)
    db.commit()
    return flags


def merge(db: Session, keep: Issue, gone: Issue, by_name: str) -> None:
    """Fold `gone` into `keep`: upvotes (once per person), messages, and a note on both timelines."""
    keep_voters = set(db.scalars(select(Upvote.uid).where(Upvote.issue_id == keep.id)))
    for v in db.scalars(select(Upvote).where(Upvote.issue_id == gone.id)).all():
        if v.uid in keep_voters:
            db.delete(v)
        else:
            v.issue_id = keep.id
            keep_voters.add(v.uid)
    # The other reporter counts as a "me too" on the kept report.
    if gone.reporter_uid != keep.reporter_uid and gone.reporter_uid not in keep_voters:
        db.add(Upvote(issue_id=keep.id, uid=gone.reporter_uid))
        keep_voters.add(gone.reporter_uid)
    keep.upvotes = len(keep_voters)
    gone.upvotes = 0
    for m in db.scalars(select(Message).where(Message.issue_id == gone.id)).all():
        m.issue_id = keep.id

    gone.status, gone.merged_into, gone.updated_at = "rejected", keep.id, now()
    keep.updated_at = now()
    gone.updates.append(StatusUpdate(status="rejected", note=f"Merged #{gone.id} into #{keep.id} (same problem).", by_name=by_name))
    keep.updates.append(StatusUpdate(status=keep.status, note=f"Merged #{gone.id} into #{keep.id} (same problem).", by_name=by_name))

    # Any other open flag that involves the merged report is now moot.
    for f in db.scalars(select(DuplicateFlag).where(
            DuplicateFlag.status == "pending",
            or_(DuplicateFlag.issue_id == gone.id, DuplicateFlag.candidate_id == gone.id))).all():
        f.status = "merged" if {f.issue_id, f.candidate_id} == {keep.id, gone.id} else "dismissed"
    db.commit()
