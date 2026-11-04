"""Civic assistant that answers ONLY from platform data the asker may see.

Pipeline
  1. Detect intent with simple patterns (nearby, my complaints, department lookup, locality
     top issues, resolved counts, overdue, tracking-ID lookup).
  2. Run a scoped database query for that intent. Citizens see public data plus their OWN
     complaints; workers see their own tasks; admins see aggregate stats.
  3. Build `facts` — a small JSON bundle of exactly what was retrieved.
  4. Rule mode: fill a sentence template from the facts.
     LLM mode: the model rephrases the facts and is told it must not add anything else. If the
     LLM fails, we return the template answer.

Personal data (emails, phone numbers, reporter names) is never put into facts.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.integrations.ai import provider
from app.integrations.ai.text import stem, tokens
from app.models import Issue, IssueAssignment, IssueCategory, Locality, User
from app.services import stats
from app.services.lifecycle import STATUS_LABELS

TRACKING_RE = re.compile(r"\bCM-\d{4}-[A-Z0-9]{6}\b", re.I)

WHY_PENDING = {
    "submitted": "it has been received and is waiting for an administrator to review it",
    "pending_verification": "an administrator is checking the details before routing it",
    "verified": "it has been verified and is waiting to be assigned to a field worker",
    "assigned": "a field worker has been assigned but has not started on site yet",
    "in_progress": "work is under way",
    "on_hold": "work is paused — see the timeline for the stated reason",
    "escalated": "it has been escalated for senior attention",
    "awaiting_verification": "the worker has submitted completion evidence and it needs your confirmation",
    "reopened": "it was reopened and is waiting to be re-assigned",
    "resolved": "it has been resolved",
    "rejected": "it was rejected — the reason is on the timeline",
}


def _period(q: str) -> tuple[datetime, str]:
    now = datetime.now(timezone.utc)
    if "week" in q:
        return now - timedelta(days=now.weekday()), "this week"
    if "year" in q:
        return now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0), "this year"
    if "today" in q:
        return now.replace(hour=0, minute=0, second=0, microsecond=0), "today"
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0), "this month"


def _nearest_locality(db: Session, lat: float, lng: float) -> Locality | None:
    pt = func.Geography(func.ST_SetSRID(func.ST_MakePoint(lng, lat), 4326))
    return db.scalar(select(Locality).order_by(func.ST_Distance(Locality.boundary, pt)).limit(1))


def _detect(q: str) -> str:
    if TRACKING_RE.search(q):
        return "tracking_lookup"
    if re.search(r"\b(my|mine)\b.*\b(complaint|report|issue)s?\b|\bwhy\b.*\b(pending|still|not)\b", q):
        return "my_issues"
    if re.search(r"\b(my|assigned)\b.*\btask", q):
        return "my_tasks"
    if re.search(r"\bwhich department\b|\bwho (handles|fixes|is responsible)\b|\bdepartment.*handle", q):
        return "department_lookup"
    if re.search(r"\boverdue\b|\blate\b|\bmissed\b", q):
        return "overdue"
    if re.search(r"\bhow many\b.*\bresolved\b|\bresolved\b.*\b(this|last)\b", q):
        return "resolved_count"
    if re.search(r"\b(most|frequent|common|top)\b", q):
        return "locality_top"
    if re.search(r"\bnear\b|\bnearby\b|\baround me\b|\bclose to me\b", q):
        return "nearby"
    return "help"


def answer(db: Session, question: str, user: User | None, lat: float | None, lng: float | None) -> dict:
    q = question.lower().strip()
    intent = _detect(q)
    facts: dict = {"intent": intent}
    links: list[dict] = []
    text_answer = ""

    if intent == "tracking_lookup":
        tid = TRACKING_RE.search(q).group(0).upper()
        issue = db.scalar(select(Issue).where(Issue.tracking_id == tid))
        if not issue:
            text_answer = f"I couldn't find a report with tracking ID {tid}."
        else:
            facts["issue"] = {"tracking_id": tid, "title": issue.title, "status": STATUS_LABELS[issue.status],
                              "department": issue.department.name if issue.department else None,
                              "updated": issue.updated_at.date().isoformat()}
            text_answer = (f"{tid} (“{issue.title}”) is {STATUS_LABELS[issue.status].lower()}"
                           + (f", handled by {issue.department.name}" if issue.department else "")
                           + f". Last updated {issue.updated_at:%d %b %Y}.")
            links.append({"label": tid, "href": f"/issues/{tid}"})

    elif intent == "my_issues":
        if not user or user.role != "citizen":
            text_answer = "Sign in as a citizen to ask about your own complaints."
        else:
            mine = db.scalars(select(Issue).where(Issue.reporter_id == user.id)
                              .order_by(Issue.updated_at.desc()).limit(5)).all()
            facts["my_issues"] = [{"tracking_id": i.tracking_id, "title": i.title,
                                   "status": STATUS_LABELS[i.status], "explanation": WHY_PENDING[i.status]} for i in mine]
            if not mine:
                text_answer = "You haven't reported any issues yet."
            else:
                parts = [f"{i.tracking_id} “{i.title}”: {STATUS_LABELS[i.status].lower()} — {WHY_PENDING[i.status]}."
                         for i in mine]
                text_answer = "Here's where your recent reports stand:\n" + "\n".join(f"• {p}" for p in parts)
                links += [{"label": i.tracking_id, "href": f"/issues/{i.tracking_id}"} for i in mine]

    elif intent == "my_tasks":
        if not user or user.role != "worker":
            text_answer = "Task questions are available to field workers when signed in."
        else:
            rows = db.scalars(select(IssueAssignment).where(IssueAssignment.worker_id == user.id,
                                                            IssueAssignment.is_active)).all()
            facts["tasks"] = [{"tracking_id": a.issue.tracking_id, "status": STATUS_LABELS[a.issue.status]} for a in rows]
            text_answer = (f"You have {len(rows)} active task{'s' if len(rows) != 1 else ''}."
                           + "".join(f"\n• {a.issue.tracking_id}: {STATUS_LABELS[a.issue.status].lower()}" for a in rows))

    elif intent == "department_lookup":
        cats = db.scalars(select(IssueCategory).where(IssueCategory.is_active)).all()
        qt = set(tokens(q))
        best, best_hits = None, 0
        for c in cats:
            kws = {stem(k.lower()) for kw in (c.keywords or []) for k in kw.split()} | set(tokens(c.name))
            hits = len(qt & kws)
            if hits > best_hits:
                best, best_hits = c, hits
        if best and best.default_department:
            facts["category"] = best.name
            facts["department"] = best.default_department.name
            text_answer = (f"{best.name} issues are routed to the {best.default_department.name}. "
                           "An administrator confirms the department when the report is verified.")
        else:
            text_answer = ("I couldn't match that to a category. Categories with a default department: "
                           + "; ".join(f"{c.name} → {c.default_department.name}" for c in cats if c.default_department) + ".")

    elif intent == "overdue":
        ov = stats.overview(db)
        facts["overdue"] = ov["overdue"]
        text_answer = (f"{ov['overdue']} open issue{'s are' if ov['overdue'] != 1 else ' is'} past the resolution "
                       "deadline set by the service-level rules. Issues without an SLA rule are never counted as overdue.")

    elif intent == "resolved_count":
        start, label = _period(q)
        n = db.scalar(select(func.count()).select_from(Issue).where(Issue.resolved_at >= start)) or 0
        reported = db.scalar(select(func.count()).select_from(Issue).where(Issue.created_at >= start)) or 0
        facts.update({"period": label, "resolved": n, "reported": reported})
        text_answer = f"{n} complaints were resolved {label}, and {reported} new ones were reported."

    elif intent == "locality_top":
        loc = None
        if user and user.citizen_profile and user.citizen_profile.home_locality_id:
            loc = db.get(Locality, user.citizen_profile.home_locality_id)
        if not loc and lat is not None and lng is not None:
            loc = _nearest_locality(db, lat, lng)
        for l in db.scalars(select(Locality)).all():
            if l.name.lower() in q:
                loc = l
        if not loc:
            text_answer = "Tell me which locality (for example “most common issues in Jayanagar”) or share your location."
        else:
            top = stats.by_category(db, locality_id=loc.id)[:3]
            facts.update({"locality": loc.name, "top_categories": [{"name": t["name"], "count": t["total"]} for t in top]})
            if not top:
                text_answer = f"No issues have been reported in {loc.name} yet."
            else:
                text_answer = f"Most reported in {loc.name}: " + ", ".join(f"{t['name']} ({t['total']})" for t in top) + "."

    elif intent == "nearby":
        if lat is None or lng is None:
            text_answer = "Share your location (the button next to the question box) and ask again."
        else:
            pt = func.Geography(func.ST_SetSRID(func.ST_MakePoint(lng, lat), 4326))
            rows = db.execute(select(Issue, func.ST_Distance(Issue.location, pt).label("m"))
                              .where(func.ST_DWithin(Issue.location, pt, 1500), Issue.status != "rejected")
                              .order_by("m").limit(6)).all()
            facts["nearby"] = [{"tracking_id": i.tracking_id, "title": i.title, "status": STATUS_LABELS[i.status],
                                "distance_m": int(m)} for i, m in rows]
            if not rows:
                text_answer = "No reported issues within 1.5 km of you."
            else:
                text_answer = f"{len(rows)} issues within 1.5 km:\n" + "\n".join(
                    f"• {i.title} — {STATUS_LABELS[i.status].lower()}, {int(m)} m away" for i, m in rows)
                links += [{"label": i.tracking_id, "href": f"/issues/{i.tracking_id}"} for i, _ in rows]

    else:
        text_answer = ("I answer questions using Commons's live data. Try:\n"
                       "• What problems are reported near me?\n• Why is my complaint still pending?\n"
                       "• Which department handles water leakage?\n• Most reported issues in my locality\n"
                       "• How many complaints were resolved this month?\n• Status of CM-2026-XXXXXX")

    mode = "rules"
    if provider.llm_configured() and intent != "help":
        llm = provider.complete(
            "You are Commons's civic assistant. Answer the resident's question using ONLY the JSON facts "
            "provided. If the facts don't answer it, say so. Never invent numbers, statuses, policies or "
            "announcements. Keep it under 90 words, plain language.",
            f"Question: {question}\nFacts: {json.dumps(facts, default=str)}\nDraft answer: {text_answer}",
            max_tokens=300,
        )
        if llm:
            text_answer, mode = llm.strip(), "llm"

    return {"answer": text_answer, "intent": intent, "facts": facts, "links": links,
            "mode": mode, "provider": provider.provider_name() if mode == "llm" else "rules"}
