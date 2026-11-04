"""Load demo data: departments, categories, SLA rules, localities, accounts, and ~80 sample issues
with realistic histories.

    python seed.py            # seed an empty database
    python seed.py --reset    # wipe app tables first (bypasses the append-only triggers ONLY here)

Every sample issue, commitment, expenditure and facility is flagged is_demo = true and the UI labels
it as sample data. Locality boundaries are hand-drawn approximations (is_approximate = true).
Sample expenditure is always "unverified" — we never present invented spending as verified.
"""
from __future__ import annotations

import argparse
import io
import math
import random
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import select, text

from app.core.config import settings
from app.core.security import hash_password
from app.database.session import SessionLocal, engine
from app.models import (
    Announcement, AuditLog, CitizenFeedback, CitizenProfile, Conversation, ConversationParticipant, Department,
    ExpenditureRecord, Facility, Issue, IssueAssignment, IssueCategory, IssueComment, IssueEvidence, IssueFollower,
    IssueImage, IssueStatusHistory, IssueUpdate, IssueVote, Locality, Message, PublicCommitment, SLAConfiguration,
    User, WorkerProfile, AIRecommendation,
)
from app.services import sla as sla_service
from app.services.issue_service import new_tracking_id
from app.integrations.ai import classifier, priority as priority_engine
from app.services.issue_service import category_payload

rng = random.Random(42)
NOW = datetime.now(timezone.utc)
PASSWORD = "Demo@1234"

DEPARTMENTS = [
    ("Roads & Infrastructure", "RDI", "Road surfaces, footpaths, bridges and public structures."),
    ("Solid Waste Management", "SWM", "Garbage collection, black spots and debris clearance."),
    ("Water Supply & Sewerage", "WSS", "Water supply lines, leaks, sewage and drainage."),
    ("Electrical & Street Lighting", "ELE", "Streetlights and public electrical fixtures."),
    ("Parks & Public Spaces", "PRK", "Parks, playgrounds, trees and public open spaces."),
    ("Traffic Engineering", "TRF", "Signals, signage, road markings and traffic safety."),
    ("Health & Sanitation", "SAN", "Public toilets, sanitation and vector control."),
]

CATEGORIES = [
    ("Roads and potholes", "roads-potholes", "construction", "RDI",
     ["pothole", "road", "crater", "asphalt", "tar", "broken road", "crack", "footpath", "pavement", "speed breaker"]),
    ("Garbage and waste", "garbage-waste", "trash-2", "SWM",
     ["garbage", "waste", "trash", "dump", "litter", "bin", "rubbish", "debris", "smell", "burning"]),
    ("Drainage and sewage", "drainage-sewage", "waves", "WSS",
     ["drain", "drainage", "sewage", "sewer", "manhole", "overflow", "clog", "blocked", "stagnant", "flood"]),
    ("Water supply and leakage", "water-supply", "droplets", "WSS",
     ["water", "leak", "pipe", "supply", "tap", "burst", "contaminated", "pressure", "valve"]),
    ("Streetlights", "streetlights", "lamp", "ELE",
     ["streetlight", "light", "lamp", "dark", "bulb", "pole", "flicker", "wire", "sparking"]),
    ("Public infrastructure", "public-infrastructure", "landmark", "RDI",
     ["bus stop", "shelter", "bench", "railing", "bridge", "wall", "structure", "signboard", "collapse"]),
    ("Traffic-related problems", "traffic", "traffic-cone", "TRF",
     ["traffic", "signal", "zebra", "crossing", "junction", "parking", "marking", "congestion", "sign"]),
    ("Public sanitation", "sanitation", "spray-can", "SAN",
     ["toilet", "urinal", "sanitation", "mosquito", "hygiene", "stray", "dead animal", "public toilet"]),
    ("Parks and public spaces", "parks", "trees", "PRK",
     ["park", "playground", "tree", "garden", "swing", "grass", "branch", "fallen tree", "open space"]),
    ("Other civic issues", "other", "circle-help", None, ["other", "encroachment", "noise", "misc"]),
]

LOCALITIES = [  # (name, lat, lng, population, source) — population only where a source is named
    ("Indiranagar", 12.9784, 77.6408), ("Koramangala", 12.9352, 77.6245), ("Jayanagar", 12.9250, 77.5938),
    ("Malleshwaram", 13.0035, 77.5710), ("HSR Layout", 12.9116, 77.6474), ("Whitefield", 12.9698, 77.7500),
    ("Basavanagudi", 12.9422, 77.5736), ("Shivajinagar", 12.9857, 77.6057), ("BTM Layout", 12.9166, 77.6101),
    ("Hebbal", 13.0358, 77.5970),
]
RADIUS = 0.0085

SAMPLES = {
    "roads-potholes": [
        ("Deep pothole outside the bus stop", "A deep pothole has formed right where buses stop. Two-wheelers swerve to avoid it and one rider fell last evening."),
        ("Road surface broken after pipeline work", "The road was dug up for pipeline work three weeks ago and only loosely filled. The patch has sunk and loose gravel is everywhere."),
        ("Footpath slabs missing near school gate", "Several footpath slabs are missing near the school gate. Children have to walk on the road during drop-off."),
        ("Series of potholes on service road", "Around six potholes on a 100 m stretch of the service road. Water collects in them when it rains."),
    ],
    "garbage-waste": [
        ("Garbage not collected for a week", "The collection vehicle hasn't come to our lane for a week. Bags are piling up at the corner and dogs are tearing them open."),
        ("Construction debris dumped on roadside", "Someone has dumped a large pile of construction debris along the roadside, blocking half the lane."),
        ("Garbage being burnt in vacant plot", "Waste is being burnt every evening in the vacant plot. The smoke enters nearby homes."),
        ("Overflowing community bin", "The community bin near the market overflows by mid-morning every day."),
    ],
    "drainage-sewage": [
        ("Open manhole without cover", "A manhole on the main road has been left without a cover. It is very dangerous at night."),
        ("Sewage overflowing onto the road", "Sewage has been overflowing from the drain onto the road for three days. The smell is unbearable."),
        ("Storm drain blocked with silt", "The storm drain is blocked with silt and plastic. The road floods after even light rain."),
    ],
    "water-supply": [
        ("Water pipe leaking for days", "A water pipe at the junction has been leaking continuously. Clean water is running into the drain."),
        ("No water supply for three days", "Our street has had no municipal water supply for three days."),
        ("Contaminated water from taps", "Tap water has turned brown and smells. Many households are affected."),
    ],
    "streetlights": [
        ("Streetlights not working on entire stretch", "Five consecutive streetlights are not working. The stretch is completely dark after 7 pm and feels unsafe."),
        ("Sparking wire on streetlight pole", "A wire on the streetlight pole is hanging loose and sparks when it rains."),
        ("Streetlight flickering", "The streetlight in front of the park flickers all night."),
    ],
    "public-infrastructure": [
        ("Bus shelter roof damaged", "Part of the bus shelter roof has come off. Commuters get wet and the remaining sheet looks loose."),
        ("Broken railing on footbridge", "A section of the railing on the footbridge is broken and bent outward."),
    ],
    "traffic": [
        ("Traffic signal not working at junction", "The signal at the junction has been off since yesterday. Vehicles are crossing dangerously."),
        ("Zebra crossing markings faded", "The zebra crossing near the hospital has faded completely. Pedestrians are not visible to drivers."),
        ("Illegal parking blocking footpath", "Cars are parked on the footpath every day, forcing pedestrians onto the road."),
    ],
    "sanitation": [
        ("Public toilet locked and unusable", "The public toilet near the bus stand is locked most of the day and very dirty when open."),
        ("Mosquito breeding in stagnant water", "Stagnant water in the vacant lot is breeding mosquitoes. Several dengue cases in the area."),
    ],
    "parks": [
        ("Fallen tree branch in park", "A large branch fell during the storm and is lying across the walking path in the park."),
        ("Broken swings in children's playground", "Two swings in the playground have broken chains and the slide has a sharp edge."),
        ("Park lights not working", "None of the lights in the park work, so it is unusable after sunset."),
    ],
    "other": [
        ("Footpath encroached by shops", "Shops have extended onto the footpath, leaving no space for pedestrians."),
    ],
}

STREETS = ["100 Feet Road", "80 Feet Road", "1st Main", "2nd Cross", "5th Main", "11th Cross", "Service Road",
           "Temple Street", "Market Road", "Park Road", "Church Street", "Ring Road"]

WORKER_NOTES = {
    "roads-potholes": ("Area barricaded, old surface cut and cleaned. BT mix arriving tomorrow.", "Pothole filled with BT and compacted. Surface levelled with the road."),
    "garbage-waste": ("Vehicle deployed, 2 trips done.", "Area cleared fully, bin replaced and lime powder sprayed."),
    "drainage-sewage": ("JCB on site for desilting, 40% done.", "Drain desilted, blockage removed, flow restored. Manhole cover fixed."),
    "water-supply": ("Leak traced to joint near PRV, excavation started.", "Damaged joint replaced, pipeline pressure tested, road patch done."),
    "streetlights": ("LT line checked, faulty fittings identified.", "Replaced 5 fittings with LED, all poles working."),
    "public-infrastructure": ("Measurements taken, sheets ordered.", "Roof sheets replaced and bolted."),
    "traffic": ("Controller unit inspected.", "Signal controller replaced, timing reset."),
    "sanitation": ("Cleaning crew assigned.", "Toilet cleaned, lock removed, caretaker hours fixed."),
    "parks": ("Branch cut into sections.", "Branch removed, path cleared, swings repaired."),
    "other": ("Notice issued to shop owners.", "Encroachment removed."),
}

CITIZENS = [("Priya Sharma", "priya@commons.demo"), ("Arjun Rao", "arjun@commons.demo"),
            ("Meera Iyer", "meera@commons.demo"), ("Faisal Ahmed", "faisal@commons.demo"),
            ("Lakshmi Nair", "lakshmi@commons.demo"), ("Rohan Gupta", "rohan@commons.demo"),
            ("Anita D'Souza", "anita@commons.demo"), ("Kiran Kumar", "kiran@commons.demo")]

WORKERS = [("Ravi Kumar", "ravi@commons.demo", "RDI", "RDI-014"), ("Suresh Babu", "suresh@commons.demo", "RDI", "RDI-022"),
           ("Manjunath H", "manju@commons.demo", "SWM", "SWM-031"), ("Deepa K", "deepa@commons.demo", "WSS", "WSS-007"),
           ("Imran Pasha", "imran@commons.demo", "WSS", "WSS-019"), ("Venkatesh M", "venkat@commons.demo", "ELE", "ELE-003"),
           ("Shalini R", "shalini@commons.demo", "PRK", "PRK-011"), ("Naveen S", "naveen@commons.demo", "TRF", "TRF-005"),
           ("Gowri P", "gowri@commons.demo", "SAN", "SAN-002")]


def octagon(lat, lng, r):
    pts = [(lng + r * 1.03 * math.cos(math.radians(a)), lat + r * math.sin(math.radians(a))) for a in range(0, 360, 45)]
    pts.append(pts[0])
    return "SRID=4326;MULTIPOLYGON(((" + ", ".join(f"{x:.6f} {y:.6f}" for x, y in pts) + ")))"


def sample_image(label: str, hue: tuple[int, int, int], name: str) -> str:
    """A clearly-labelled placeholder 'photo' so the demo shows the evidence UI. Not a real photograph."""
    img = Image.new("RGB", (800, 560), hue)
    d = ImageDraw.Draw(img)
    for i in range(0, 800, 40):
        d.line([(i, 0), (i - 300, 560)], fill=tuple(min(255, c + 12) for c in hue), width=14)
    try:
        font = ImageFont.load_default(size=34)
        small = ImageFont.load_default(size=22)
    except TypeError:
        font = small = ImageFont.load_default()
    d.rectangle([(0, 440), (800, 560)], fill=(20, 30, 55))
    d.text((32, 462), label, fill=(255, 255, 255), font=font)
    d.text((32, 508), "Sample image · demo data", fill=(190, 200, 215), font=small)
    path = Path(settings.media_dir) / "demo" / f"{name}.jpg"
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "JPEG", quality=80)
    return f"/media/demo/{name}.jpg"


def reset(db):
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE audit_logs DISABLE TRIGGER USER"))
        conn.execute(text("ALTER TABLE issue_status_history DISABLE TRIGGER USER"))
        tables = ["messages", "conversation_participants", "conversations", "notifications", "comment_reports",
                  "issue_comments", "citizen_feedback", "issue_votes", "issue_followers", "issue_images", "issue_evidence",
                  "issue_updates", "issue_assignments", "ai_recommendations", "expenditure_records", "audit_logs",
                  "issue_status_history", "issues", "public_commitments", "announcements", "sla_configurations",
                  "facilities", "worker_profiles", "citizen_profiles", "users", "issue_categories", "localities", "departments"]
        conn.execute(text("TRUNCATE " + ", ".join(tables) + " CASCADE"))
        conn.execute(text("ALTER TABLE audit_logs ENABLE TRIGGER USER"))
        conn.execute(text("ALTER TABLE issue_status_history ENABLE TRIGGER USER"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true")
    args = ap.parse_args()
    db = SessionLocal()
    if args.reset:
        reset(db)
    elif db.scalar(select(User).limit(1)):
        print("Database already has data. Run `python seed.py --reset` to start over.")
        sys.exit(0)

    depts = {}
    for name, code, desc in DEPARTMENTS:
        d = Department(name=name, code=code, description=desc, contact_email=f"{code.lower()}@city.example")
        db.add(d)
        depts[code] = d
    db.flush()

    cats = {}
    for name, slug, icon, dcode, kws in CATEGORIES:
        c = IssueCategory(name=name, slug=slug, icon=icon, keywords=kws, description=None,
                          default_department_id=depts[dcode].id if dcode else None)
        db.add(c)
        cats[slug] = c
    db.flush()

    for prio, resp, res in [("critical", 4, 24), ("high", 12, 72), ("medium", 24, 168), ("low", 72, 336)]:
        db.add(SLAConfiguration(category_id=None, priority=prio, response_hours=resp, resolution_hours=res, warning_threshold=0.75))
    db.add(SLAConfiguration(category_id=cats["streetlights"].id, priority="high", response_hours=8, resolution_hours=48))
    db.add(SLAConfiguration(category_id=cats["drainage-sewage"].id, priority="critical", response_hours=2, resolution_hours=12))

    locs = []
    for name, lat, lng in LOCALITIES:
        l = Locality(name=name, boundary=octagon(lat, lng, RADIUS), is_approximate=True,
                     boundary_source="Hand-drawn approximation for the demo")
        db.add(l)
        locs.append((l, lat, lng))
    db.flush()

    for name, kind, lat, lng in [("Govt. Higher Primary School (sample)", "school", 12.9790, 77.6395),
                                 ("Community Health Centre (sample)", "hospital", 12.9255, 77.5950),
                                 ("Public School (sample)", "school", 12.9360, 77.6230),
                                 ("General Hospital (sample)", "hospital", 12.9860, 77.6050)]:
        db.add(Facility(name=name, kind=kind, location=f"SRID=4326;POINT({lng} {lat})",
                        source="Demo data — replace with an authoritative dataset", is_demo=True))

    pw = hash_password(PASSWORD)
    admin = User(email="admin@commons.demo", full_name="Anjali Menon", role="admin", password_hash=pw, phone="+91 80 0000 0001")
    roads_admin = User(email="roads.admin@commons.demo", full_name="Prakash Shetty", role="admin", password_hash=pw,
                       department_id=depts["RDI"].id)
    db.add_all([admin, roads_admin])
    citizens = []
    for i, (name, email) in enumerate(CITIZENS):
        u = User(email=email, full_name=name, role="citizen", password_hash=pw)
        db.add(u)
        db.flush()
        db.add(CitizenProfile(user_id=u.id, home_locality_id=locs[i % len(locs)][0].id))
        citizens.append(u)
    workers: dict[str, list[User]] = {}
    for name, email, dcode, code in WORKERS:
        u = User(email=email, full_name=name, role="worker", password_hash=pw, department_id=depts[dcode].id)
        db.add(u)
        db.flush()
        db.add(WorkerProfile(user_id=u.id, department_id=depts[dcode].id, employee_code=code))
        workers.setdefault(dcode, []).append(u)
    db.flush()

    hues = [(120, 110, 95), (95, 110, 125), (110, 120, 100), (130, 105, 90)]

    def hist(issue, frm, to, at, actor, reason):
        db.add(IssueStatusHistory(issue_id=issue.id, from_status=frm, to_status=to, actor_id=actor.id if actor else None,
                                  actor_role=actor.role if actor else "anonymous", reason=reason, is_public=True, created_at=at))
        db.add(AuditLog(actor_id=actor.id if actor else None, actor_role=actor.role if actor else "anonymous",
                        action="issue.status_changed" if frm else "issue.created", entity_type="issue",
                        entity_id=str(issue.id), issue_id=issue.id, old_values={"status": frm} if frm else None,
                        new_values={"status": to}, reason=reason, created_at=at))

    cat_list = [c for c in cats.values() if c.slug in SAMPLES]
    weights = {"roads-potholes": 5, "garbage-waste": 4, "drainage-sewage": 3, "water-supply": 3, "streetlights": 3,
               "public-infrastructure": 1, "traffic": 2, "sanitation": 1, "parks": 2, "other": 1}
    # Outcome mix: older issues are mostly resolved; recent ones are spread across the lifecycle.
    N = 84
    issues_made = []
    for n in range(N):
        # first 16 reports are recent so every queue has something in it
        age_days = rng.uniform(0.05, 12) if n < 16 else rng.betavariate(1.3, 2.4) * 300 + rng.random()
        created = NOW - timedelta(days=age_days, hours=rng.randint(0, 23))
        cat = rng.choices(cat_list, weights=[weights[c.slug] for c in cat_list])[0]
        title, desc = rng.choice(SAMPLES[cat.slug])
        # cluster some reports for hotspot detection
        loc, clat, clng = locs[0] if n % 7 == 0 else (locs[1] if n % 9 == 0 else rng.choice(locs))
        lat = clat + rng.uniform(-RADIUS * 0.7, RADIUS * 0.7)
        lng = clng + rng.uniform(-RADIUS * 0.7, RADIUS * 0.7)
        if n % 7 == 0:
            lat, lng = clat + rng.uniform(-0.0012, 0.0012), clng + rng.uniform(-0.0012, 0.0012)
        reporter = None if n % 11 == 0 else rng.choice(citizens)
        street = rng.choice(STREETS)
        issue = Issue(tracking_id=new_tracking_id(db), title=title, description=desc, category_id=cat.id,
                      locality_id=loc.id, status="submitted", reporter_id=reporter.id if reporter else None,
                      is_anonymous=reporter is None, location=f"SRID=4326;POINT({lng} {lat})",
                      address=f"{street}, {loc.name}", is_demo=True, created_at=created, updated_at=created)
        db.add(issue)
        db.flush()
        if n % 3 == 0:
            db.add(IssueImage(issue_id=issue.id, uploader_id=reporter.id if reporter else None, kind="report",
                              url=sample_image(title[:34], hues[n % 4], f"report-{n}"), created_at=created))
        hist(issue, None, "submitted", created, reporter, "Report submitted")
        if reporter:
            db.add(IssueFollower(issue_id=issue.id, user_id=reporter.id, created_at=created))
        for supporter in rng.sample(citizens, k=rng.choice([0, 0, 1, 2, 3, 5])):
            if supporter is not reporter:
                db.add(IssueVote(issue_id=issue.id, user_id=supporter.id, created_at=created + timedelta(hours=rng.randint(1, 72))))

        # decide how far along this issue gets
        if age_days > 60:
            target = rng.choices(["resolved", "rejected", "in_progress", "reopened_resolved"], [78, 8, 6, 8])[0]
        elif age_days > 14:
            target = rng.choices(["resolved", "awaiting", "in_progress", "assigned", "verified", "rejected", "on_hold"],
                                 [45, 12, 15, 8, 6, 6, 8])[0]
        elif age_days > 4:
            target = rng.choices(["pending", "verified", "assigned", "in_progress", "awaiting", "resolved"],
                                 [10, 12, 14, 20, 18, 16])[0]
        elif age_days > 1:
            target = rng.choices(["submitted", "pending", "verified", "assigned"], [30, 20, 25, 25])[0]
        else:
            target = "submitted"

        t = created
        a_dmin = roads_admin if cat.default_department_id == depts["RDI"].id and n % 2 else admin
        dept = db.get(Department, cat.default_department_id) if cat.default_department_id else depts["RDI"]

        def step(hours_lo, hours_hi):
            nonlocal t
            t = min(t + timedelta(hours=rng.uniform(hours_lo, hours_hi)), NOW - timedelta(minutes=5))
            return t

        if target == "submitted":
            issues_made.append(issue)
            continue
        if target == "pending":
            hist(issue, "submitted", "pending_verification", step(1, 20), a_dmin, "Checking details with field office")
            issue.status, issue.first_response_at, issue.updated_at = "pending_verification", t, t
            issues_made.append(issue)
            continue
        if target == "rejected":
            hist(issue, "submitted", "rejected", step(2, 30), a_dmin, rng.choice([
                "Location is private property — not under municipal jurisdiction.",
                "Insufficient detail to locate the problem; please resubmit with a landmark.",
                "Already being handled under an existing report in this area."]))
            issue.status, issue.first_response_at, issue.updated_at = "rejected", t, t
            issues_made.append(issue)
            continue

        pr = priority_engine.recommend(db, issue)
        priority = pr["priority"] if pr["priority"] != "low" or rng.random() < 0.5 else "medium"
        if "manhole" in title.lower() or "sparking" in title.lower():
            priority = "critical"
        issue.priority, issue.department_id = priority, dept.id
        hist(issue, "submitted", "verified", step(2, 36), a_dmin, f"Verified · priority {priority} · routed to {dept.name}")
        issue.first_response_at = issue.verified_at = t
        issue.status = "verified"
        sla_service.apply(db, issue, start=t)
        db.add(AIRecommendation(issue_id=issue.id, kind="priority", mode="rules", provider="rules", output=pr,
                                confidence=pr["confidence"], decision="accepted" if pr["priority"] == priority else "overridden",
                                decided_by=a_dmin.id, created_at=t))
        if target == "verified":
            issue.updated_at = t
            issues_made.append(issue)
            continue

        dcode = next(k for k, v in depts.items() if v.id == dept.id)
        worker = rng.choice(workers.get(dcode, workers["RDI"]))
        a = IssueAssignment(issue_id=issue.id, worker_id=worker.id, department_id=dept.id, assigned_by=a_dmin.id,
                            instructions="Inspect, barricade if unsafe, and fix. Upload before/after photos.",
                            due_at=issue.resolution_due_at, created_at=step(1, 30))
        db.add(a)
        hist(issue, "verified", "assigned", t, a_dmin, f"Assigned to {dept.name} field team")
        issue.status = "assigned"
        if target == "assigned":
            if rng.random() < 0.5:
                a.acknowledged_at = step(0.5, 6)
            issue.updated_at = t
            issues_made.append(issue)
            continue

        a.acknowledged_at = step(0.5, 8)
        a.started_at = step(1, 30)
        hist(issue, "assigned", "in_progress", t, worker, "Work started on site")
        issue.status = "in_progress"
        notes = WORKER_NOTES[cat.slug]
        from app.integrations.ai.summaries import rule_summary
        db.add(IssueUpdate(issue_id=issue.id, author_id=worker.id, kind="progress", body=notes[0], is_public=True,
                           public_summary=rule_summary("progress", notes[0]), summary_status="approved",
                           summary_source="rules", created_at=step(2, 24)))
        if target == "on_hold":
            hist(issue, "in_progress", "on_hold", step(2, 24), worker, "Waiting for materials from the depot")
            db.add(IssueUpdate(issue_id=issue.id, author_id=worker.id, kind="resource_request",
                               body="Need 2 tonnes of BT mix and a roller; depot stock is out.", is_public=False,
                               public_summary=rule_summary("resource_request", "Need 2 tonnes of BT mix and a roller; depot stock is out."),
                               summary_status="pending", summary_source="rules", created_at=t))
            issue.status, issue.updated_at = "on_hold", t
            issues_made.append(issue)
            continue
        if target == "in_progress":
            issue.updated_at = t
            issues_made.append(issue)
            continue

        ev = IssueEvidence(issue_id=issue.id, assignment_id=a.id, submitted_by=worker.id, description=notes[1],
                           work_notes="Materials used as per estimate.", submitted_at=step(4, 72), review_status="pending")
        db.add(ev)
        db.flush()
        db.add(IssueImage(issue_id=issue.id, uploader_id=worker.id, evidence_id=ev.id, kind="before",
                          url=sample_image("Before", (125, 95, 80), f"before-{n}"), created_at=t))
        db.add(IssueImage(issue_id=issue.id, uploader_id=worker.id, evidence_id=ev.id, kind="after",
                          url=sample_image("After", (70, 115, 95), f"after-{n}"), created_at=t))
        a.completed_at = t
        hist(issue, "in_progress", "awaiting_verification", t, worker,
             "Completion evidence submitted — waiting for citizen/admin verification")
        issue.status = "awaiting_verification"
        if target == "awaiting":
            issue.updated_at = t
            issues_made.append(issue)
            continue

        confirmer = reporter if reporter and rng.random() < 0.7 else a_dmin
        if target == "reopened_resolved" and reporter:
            hist(issue, "awaiting_verification", "reopened", step(6, 48), reporter,
                 "The patch has already started breaking up at the edges.")
            ev.review_status = "disputed"
            db.add(IssueUpdate(issue_id=issue.id, author_id=reporter.id, kind="dispute",
                               body="The patch has already started breaking up at the edges.", is_public=True, created_at=t))
            a.is_active = False
            hist(issue, "reopened", "assigned", step(4, 24), a_dmin, f"Reassigned within {dept.name}")
            a2 = IssueAssignment(issue_id=issue.id, worker_id=worker.id, department_id=dept.id, assigned_by=a_dmin.id,
                                 instructions="Redo the repair properly; citizen reports it failed.",
                                 acknowledged_at=step(1, 6), started_at=step(2, 24), created_at=t)
            db.add(a2)
            hist(issue, "assigned", "in_progress", t, worker, "Work started on site")
            ev2 = IssueEvidence(issue_id=issue.id, submitted_by=worker.id, description="Repair redone with proper edge sealing.",
                                submitted_at=step(6, 48), review_status="accepted")
            db.add(ev2)
            db.flush()
            db.add(IssueImage(issue_id=issue.id, uploader_id=worker.id, evidence_id=ev2.id, kind="after",
                              url=sample_image("After (redo)", (70, 115, 95), f"after2-{n}"), created_at=t))
            a2.completed_at = t
            hist(issue, "in_progress", "awaiting_verification", t, worker, "Completion evidence submitted")
            confirmer = reporter
        hist(issue, "awaiting_verification", "resolved", step(3, 60), confirmer,
             "Reporter confirmed the issue is fixed" if confirmer is reporter else "Verified on inspection by administrator")
        if ev.review_status == "pending":
            ev.review_status = "accepted"
        issue.status, issue.resolved_at, issue.updated_at = "resolved", t, t
        db.flush()
        for asg_row in db.scalars(select(IssueAssignment).where(IssueAssignment.issue_id == issue.id)):
            asg_row.is_active = False
        if reporter and rng.random() < 0.75:
            rating = rng.choices([5, 4, 3, 2, 1], [40, 30, 15, 10, 5])[0]
            db.add(CitizenFeedback(issue_id=issue.id, user_id=reporter.id, rating=rating, was_fixed=rating >= 3,
                                   comment=None if rating >= 4 else "Took longer than expected.", created_at=t))
        issues_made.append(issue)

    db.flush()
    # SLA bookkeeping for issues already past deadline (as the escalation job would have done)
    for issue in issues_made:
        if issue.resolution_due_at and issue.status not in ("resolved", "rejected") and issue.resolution_due_at < NOW:
            issue.overdue_flagged_at = issue.resolution_due_at + timedelta(minutes=1)
            issue.escalation_level = 2

    # AI classification records for a handful of fresh reports
    cp = category_payload(db)
    for issue in [i for i in issues_made if i.status == "submitted"][:12]:
        cls = classifier.classify(issue.title, issue.description, cp)
        db.add(AIRecommendation(issue_id=issue.id, kind="classification", mode="rules", provider="rules",
                                output={k: (str(v) if not isinstance(v, (int, float, list, str, type(None))) else v) for k, v in cls.items()},
                                confidence=cls["confidence"], created_at=issue.created_at))

    # Community discussion
    for issue in rng.sample(issues_made, 14):
        c1 = IssueComment(issue_id=issue.id, author_id=rng.choice(citizens).id, created_at=issue.created_at + timedelta(hours=5),
                          body=rng.choice(["Same problem near my house too.", "This has been like this for weeks.",
                                           "Thanks for reporting — I nearly tripped here yesterday.",
                                           "Is there any update on this?"]))
        db.add(c1)
        db.flush()
        if rng.random() < 0.5:
            db.add(IssueComment(issue_id=issue.id, author_id=admin.id, parent_id=c1.id,
                                created_at=issue.created_at + timedelta(hours=9),
                                body="Thank you. The team has been informed; updates will appear on the timeline."))

    # Conversations
    sample = next(i for i in issues_made if i.reporter_id and i.status in ("in_progress", "assigned"))
    conv = Conversation(kind="citizen_admin", issue_id=sample.id, subject=f"{sample.tracking_id} · {sample.title}")
    db.add(conv)
    db.flush()
    rep = db.get(User, sample.reporter_id)
    db.add_all([ConversationParticipant(conversation_id=conv.id, user_id=rep.id, last_read_at=NOW - timedelta(hours=2)),
                ConversationParticipant(conversation_id=conv.id, user_id=admin.id, last_read_at=NOW - timedelta(hours=3))])
    db.add_all([Message(conversation_id=conv.id, sender_id=rep.id, body="Hello, is there an expected date for this?", created_at=NOW - timedelta(hours=5)),
                Message(conversation_id=conv.id, sender_id=admin.id, body="Hi! The field team has started. We expect completion within the SLA window shown on the page.", created_at=NOW - timedelta(hours=4)),
                Message(conversation_id=conv.id, sender_id=rep.id, body="Thank you for the update.", created_at=NOW - timedelta(hours=2, minutes=30))])
    asg = db.scalar(select(IssueAssignment).where(IssueAssignment.issue_id == sample.id, IssueAssignment.is_active))
    if asg:
        conv2 = Conversation(kind="admin_worker", issue_id=sample.id, subject=f"{sample.tracking_id} · task")
        db.add(conv2)
        db.flush()
        db.add_all([ConversationParticipant(conversation_id=conv2.id, user_id=admin.id, last_read_at=NOW),
                    ConversationParticipant(conversation_id=conv2.id, user_id=asg.worker_id, last_read_at=NOW - timedelta(days=1))])
        db.add_all([Message(conversation_id=conv2.id, sender_id=admin.id, body="Please share a progress photo by evening.", created_at=NOW - timedelta(hours=6)),
                    Message(conversation_id=conv2.id, sender_id=asg.worker_id, body="Will do. Waiting for the roller to arrive.", created_at=NOW - timedelta(hours=5))])

    # Public commitments, expenditure (all unverified sample data), announcements
    c_list = [
        ("Resurface 100 Feet Road, Indiranagar", "Full resurfacing of the 1.8 km stretch including footpath repairs.", "RDI", 0, 60, 45, "in_progress"),
        ("Replace 400 sodium streetlights with LED", "Ward-wide replacement of ageing fittings with LED lamps.", "ELE", 6, 30, 70, "in_progress"),
        ("Desilt storm drains before monsoon", "Desilting of primary and secondary storm drains in flood-prone wards.", "WSS", 1, -20, 100, "completed"),
        ("New public toilet block near bus stand", "Construction of an accessible toilet block with caretaker.", "SAN", 7, -5, 35, "delayed"),
        ("Rejuvenate Jayanagar 4th Block park", "Walking track, lighting and play equipment.", "PRK", 2, 120, 0, "planned"),
    ]
    for title, d, dcode, li, days, prog, st in c_list:
        db.add(PublicCommitment(title=title, description=d, department_id=depts[dcode].id, locality_id=locs[li][0].id,
                                expected_completion=date.today() + timedelta(days=days), progress_percent=prog, status=st,
                                created_by=admin.id, is_demo=True,
                                progress_note="Sample commitment for demonstration."))
    resolved_road = next((i for i in issues_made if i.status == "resolved" and i.category_id == cats["roads-potholes"].id), None)
    db.add(ExpenditureRecord(department_id=depts["RDI"].id, issue_id=resolved_road.id if resolved_road else None,
                             work_description="Pothole patching (sample figure)", estimated_cost=18000, actual_cost=16500,
                             verification_status="unverified", is_demo=True, created_by=admin.id))
    db.add(ExpenditureRecord(department_id=depts["ELE"].id, work_description="LED fitting replacement — phase 1 (sample figure)",
                             estimated_cost=1250000, actual_cost=None, verification_status="unverified", is_demo=True, created_by=admin.id))
    db.add(Announcement(title="Monsoon preparedness: report blocked drains early",
                        body="Drain desilting crews are on standby across all wards. Report blocked drains with a photo so they can be prioritised.",
                        department_id=depts["WSS"].id, published_by=admin.id, is_pinned=True))
    db.add(Announcement(title="Water supply interruption — Malleshwaram, Saturday",
                        body="Supply will be interrupted from 10 am to 4 pm for valve replacement work.",
                        department_id=depts["WSS"].id, locality_id=locs[3][0].id, published_by=admin.id))
    db.commit()

    print(f"Seeded {len(issues_made)} demo issues.")
    print("\nDemo accounts (password for all: Demo@1234)")
    print("  City admin        admin@commons.demo")
    print("  Department admin  roads.admin@commons.demo   (Roads & Infrastructure only)")
    print("  Worker            ravi@commons.demo          (Roads)  · deepa@commons.demo (Water)")
    print("  Citizen           priya@commons.demo         · arjun@commons.demo")


if __name__ == "__main__":
    main()
