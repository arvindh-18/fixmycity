"""Demo build: personas and a realistic, fully mocked history around Saveetha Engineering College, Thandalam.

`seed(db)` wipes every table and creates ~12 weeks of reports with a believable life cycle:
reported → assigned → being fixed → fixed with an after photo, plus +1s, resident↔worker chats,
multilingual originals, pending duplicates and a few merges. Everything is fake and labelled as demo data.
"""
import random
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from . import demo_images, duplicates
from .db import (
    Base, CATEGORIES, DuplicateFlag, Issue, Message, MessageRead, StaffMember, StatusUpdate, Upvote, engine,
)

# ---- Personas (one click each in the demo box) -----------------------------------------------------
PERSONAS = [
    {"token": "dev:priya:Priya Raman:0", "uid": "dev-priya", "name": "Priya Raman", "role": "public",
     "blurb": "Resident in Thandalam. Has reports at every stage and unread replies from a worker."},
    {"token": "dev:karthik:Karthik S:0", "uid": "dev-karthik", "name": "Karthik S", "role": "public",
     "blurb": "Final-year student. Reports streetlights on the hostel road; good for trying +1."},
    {"token": "dev:aisha:Aisha Begum:0", "uid": "dev-aisha", "name": "Aisha Begum", "role": "public",
     "blurb": "Reports in Tamil and Hindi. Shows the multilingual originals."},
    {"token": "dev:ravi:Ravi Kumar:w", "uid": "dev-ravi", "name": "Ravi Kumar", "role": "worker",
     "blurb": "Roads crew (potholes, footpaths, signals). Has assigned jobs and chats."},
    {"token": "dev:selvi:Selvi M:w", "uid": "dev-selvi", "name": "Selvi M", "role": "worker",
     "blurb": "Sanitation crew (garbage, drains)."},
    {"token": "dev:murugan:Murugan P:w", "uid": "dev-murugan", "name": "Murugan P", "role": "worker",
     "blurb": "Electrical & water crew (streetlights, leaks)."},
    {"token": "dev:meena:Meena Iyer:1", "uid": "dev-meena", "name": "Meena Iyer", "role": "admin",
     "blurb": "Ward officer. Assigns jobs, merges duplicates, watches the numbers."},
]
ADMIN_NAME = "Meena Iyer"

# Crews: email (dev tokens map uid -> uid@demo.local), name, categories they handle.
WORKERS = [
    ("ravi@demo.local", "Ravi Kumar", {"pothole", "footpath", "traffic"}),
    ("dinesh@demo.local", "Dinesh R", {"pothole", "footpath", "traffic", "other"}),
    ("selvi@demo.local", "Selvi M", {"garbage", "drainage"}),
    ("kavitha@demo.local", "Kavitha J", {"garbage", "drainage", "tree"}),
    ("murugan@demo.local", "Murugan P", {"streetlight", "water"}),
    ("ganesh@demo.local", "Ganesh V", {"streetlight", "water", "tree", "other"}),
]

# ---- Places around Saveetha Engineering College (approximate, for a believable demo map) -------------
COLLEGE = (13.0287, 80.0168)
PLACES = [
    # name, pincode, lat, lng, weight, landmarks
    ("Thandalam", "602105", 13.0287, 80.0168, 34,
     ["the college main gate", "Thandalam bus stop", "the hostel road", "Thandalam junction", "the Amman temple",
      "the panchayat office", "the medical college road", "the canteen street"]),
    ("Mevalurkuppam", "602105", 13.0063, 79.9951, 8, ["Mevalurkuppam junction", "the government school", "the ration shop"]),
    ("Irungattukottai", "602117", 12.9879, 79.9853, 7, ["the SIPCOT gate", "the industrial estate road", "the bus depot"]),
    ("Sriperumbudur", "602105", 12.9675, 79.9419, 7, ["Sriperumbudur bus stand", "the temple car street", "the taluk office"]),
    ("Kuthambakkam", "600124", 13.0478, 80.0402, 6, ["Kuthambakkam bus stand", "the lake bund road", "the village market"]),
    ("Thirumazhisai", "600124", 13.0526, 80.0617, 6, ["Thirumazhisai market", "the satellite town road", "the bus terminus"]),
    ("Chembarambakkam", "600123", 13.0234, 80.0563, 7, ["the lake road", "the water treatment plant gate", "Chembarambakkam signal"]),
    ("Nazarethpettai", "600123", 13.0443, 80.0702, 6, ["Nazarethpettai signal", "the church street", "the highway flyover"]),
    ("Poonamallee", "600056", 13.0473, 80.0945, 8, ["Poonamallee bus depot", "the high road junction", "the bypass service road"]),
    ("Mangadu", "600122", 13.0230, 80.1100, 5, ["the Mangadu temple street", "the market road"]),
    ("Kundrathur", "600069", 12.9970, 80.0970, 4, ["Kundrathur main road", "the murugan temple hill road"]),
    ("Porur", "600116", 13.0382, 80.1565, 4, ["Porur junction", "the toll gate", "the lake view road"]),
]
ROADS = ["the Chennai–Bengaluru Highway service road", "the college approach road", "the hostel road",
         "the SIPCOT link road", "the old Sriperumbudur road", "the bypass service road", "the lake bund road"]

TITLES = {
    "pothole": ["Deep pothole near {lm}", "Road caved in at {lm}", "Series of potholes on {road}",
                "Broken road surface outside {lm}", "Pothole filled with rainwater near {lm}"],
    "garbage": ["Garbage dumped beside {lm}", "Overflowing bin near {lm}", "Waste being burnt on {road}",
                "Construction debris dumped at {lm}", "Garbage not collected for days near {lm}"],
    "streetlight": ["Streetlight not working near {lm}", "Whole stretch dark on {road}", "Flickering streetlight at {lm}",
                    "Three lights out near {lm}"],
    "drainage": ["Open drain overflowing near {lm}", "Sewage water on {road}", "Manhole cover missing at {lm}",
                 "Blocked drain causing smell near {lm}"],
    "water": ["Drinking water pipe leaking at {lm}", "Water logging after rain near {lm}", "Low water supply near {lm}",
              "Burst pipeline on {road}"],
    "footpath": ["Broken footpath slabs near {lm}", "Footpath blocked by shops at {lm}", "Missing footpath tiles on {road}"],
    "tree": ["Fallen tree branch blocking {road}", "Tree leaning dangerously near {lm}", "Branches touching power line near {lm}"],
    "traffic": ["Traffic signal not working at {lm}", "Unmarked speed breaker near {lm}", "Signboard knocked down at {lm}"],
    "other": ["Stray cattle on {road} at night", "Illegal hoarding blocking view at {lm}", "Abandoned vehicle near {lm}"],
}
DESCRIPTIONS = {
    "pothole": "About {n} feet wide and deep enough to damage two-wheelers. Bikes swerve into oncoming traffic to avoid it.",
    "garbage": "Plastic and food waste piling up for about {n} days. Stray dogs scatter it across the road and it smells badly.",
    "streetlight": "The light has been off for about {n} days. Students walking back after evening classes find the stretch unsafe.",
    "drainage": "Dirty water spilling onto the road for {n} days. Pedestrians have to walk through it and mosquitoes are increasing.",
    "water": "Clean water wasting onto the road for about {n} days. Low pressure in the houses nearby.",
    "footpath": "Slabs broken over roughly {n} metres. Elderly people and children are forced to walk on the road.",
    "tree": "Large branch about {n} metres long. Vehicles have to slow down and go around it.",
    "traffic": "Not working for about {n} days. Vehicles cross from all sides during peak hours.",
    "other": "Seen here for about {n} days. Needs the right department to take a look.",
}
CATEGORY_WEIGHTS = {"pothole": 22, "garbage": 20, "streetlight": 14, "drainage": 12, "water": 10,
                    "footpath": 8, "tree": 5, "traffic": 5, "other": 4}
SEVERITY_BIAS = {"pothole": 0.35, "drainage": 0.4, "tree": 0.45, "traffic": 0.5, "streetlight": 0.25,
                 "water": 0.2, "garbage": 0.15, "footpath": 0.2, "other": 0.1}

ORIGINALS = [  # what residents actually typed or said
    ("ta", "காலேஜ் மெயின் கேட் அருகே பெரிய குழி இருக்கு, பைக் எல்லாம் விழுந்துடுது. சீக்கிரம் சரி பண்ணுங்க."),
    ("ta", "தண்டலம் பஸ் ஸ்டாப் பக்கத்துல ஒரு வாரமா குப்பை எடுக்கல, ரொம்ப நாத்தம்."),
    ("ta", "ஹாஸ்டல் ரோட்டுல தெரு விளக்கு எரியல, இரவு நடக்க பயமா இருக்கு."),
    ("hi", "कॉलेज रोड पर बड़ा गड्ढा है, बारिश में पानी भर जाता है और बाइक फिसल जाती है।"),
    ("hi", "बस स्टॉप के पास कचरा जमा है, कई दिन से उठाया नहीं गया।"),
    ("mixed", "Bro hostel road la light illa for 4 days, ponnunga night la nadakka bayapadranga"),
    ("mixed", "Main gate kitta pothole romba deep ah irukku, yesterday oru bike accident aachu"),
    ("mixed", "Bhaiya yahan drainage overflow ho raha hai, smell bahut hai, please jaldi theek karo"),
]

RESIDENT_POOL = ["Arun Kumar", "Divya Lakshmi", "Mohammed Irfan", "Sneha Reddy", "Vignesh Babu", "Lakshmi Narayanan",
                 "Harini Prakash", "Joseph Antony", "Fathima Nasreen", "Surya Prakash", "Keerthana V", "Rahul Sharma",
                 "Gayathri Devi", "Naveen Kumar", "Anjali Menon", "Prakash Rao", "Deepika S", "Manoj Kumar",
                 "Revathi Ganesan", "Sathish Kumar", "Nandhini R", "Ajay Krishnan", "Bhavani Shankar", "Pooja Iyer",
                 "Ramesh Babu", "Swathi K", "Imran Khan", "Meera Krishnan", "Vijay Anand", "Kavya Sri",
                 "Balaji Venkat", "Shalini Joseph", "Hari Haran", "Nisha Patel", "Senthil Murugan", "Yamini Rao"]

CHAT = {
    "worker_open": ["Hi, I'm {w} from the {crew} crew. I'll be there {when} to check this.",
                    "Vanakkam, {w} here. Which side of {lm} exactly? Will reach {when}.",
                    "Got your report. Material is arranged, starting {when}."],
    "resident": ["Thank you! It's right opposite {lm}, you can't miss it.", "Thanks for the quick reply 🙏",
                 "Please hurry, it's dangerous at night.", "Ok sir, I'll keep watching it.",
                 "Romba thanks! Last time nobody came for weeks.", "It got worse after yesterday's rain."],
    "worker_progress": ["Work started. Should be done by evening.", "Team is on site now, road will be blocked for 2 hours.",
                        "Waiting for one more load of material, will finish tomorrow morning."],
    "worker_done": ["Done ✅ Uploaded the after photo. Please check and tell me if anything is left.",
                    "Fixed. Photo is on the report."],
    "resident_done": ["Checked it this morning, looks good. Thank you!", "Super, thanks a lot 👍",
                      "Wow, that was fast. Thank you so much."],
}
CREW = {"pothole": "roads", "footpath": "roads", "traffic": "roads", "garbage": "sanitation", "drainage": "sanitation",
        "streetlight": "electrical", "water": "water", "tree": "parks", "other": "ward"}

WEEKS = 12
# Reports per week, oldest → newest: adoption grows as word spreads around the campus.
WEEKLY = [9, 11, 13, 16, 18, 21, 23, 25, 27, 29, 31, 24]


def _pick_place(rng: random.Random):
    weights = [p[4] for p in PLACES]
    name, pin, lat, lng, _, lms = rng.choices(PLACES, weights=weights)[0]
    spread = 0.006 if name == "Thandalam" else 0.004
    return name, pin, lat + rng.gauss(0, spread), lng + rng.gauss(0, spread), rng.choice(lms)


def _worker_for(category: str, rng: random.Random):
    options = [w for w in WORKERS if category in w[2]]
    return rng.choice(options)


def _when_phrase(rng):
    return rng.choice(["today evening", "tomorrow morning", "in an hour", "by 4 pm"])


def seed(db: Session, rng_seed: int = 2026) -> dict:
    rng = random.Random(rng_seed)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)

    for email, name, _ in WORKERS:
        db.add(StaffMember(email=email, name=name, role="worker", added_by=ADMIN_NAME))
    db.add(StaffMember(email="meena@demo.local", name=ADMIN_NAME, role="admin", added_by="Setup"))

    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(weeks=WEEKS - 1)
    personas = [p for p in PERSONAS if p["role"] == "public"]
    pool = [(f"seed-{i}", n) for i, n in enumerate(RESIDENT_POOL)] + [(p["uid"], p["name"]) for p in personas]
    issues: list[Issue] = []
    photos = 0

    for week, count in enumerate(WEEKLY):
        for _ in range(count):
            created = start + timedelta(weeks=week, seconds=rng.uniform(0, 7 * 86400))
            if created > now - timedelta(minutes=30):
                created = now - timedelta(hours=rng.uniform(1, 30))
            category = rng.choices(list(CATEGORY_WEIGHTS), weights=list(CATEGORY_WEIGHTS.values()))[0]
            locality, pincode, lat, lng, landmark = _pick_place(rng)
            road = rng.choice(ROADS)
            title = rng.choice(TITLES[category]).format(lm=landmark, road=road)
            title = title[0].upper() + title[1:]
            severity = "high" if rng.random() < SEVERITY_BIAS[category] else rng.choice(["medium", "medium", "low"])
            # Personas report a good share so their "My reports" has something at every stage.
            if rng.random() < 0.22:
                reporter_uid, reporter_name = rng.choice([(p["uid"], p["name"]) for p in personas])
            else:
                reporter_uid, reporter_name = rng.choice(pool[:len(RESIDENT_POOL)])
            original = ""
            if reporter_uid == "dev-aisha" or rng.random() < 0.18:
                original = rng.choice(ORIGINALS)[1]

            issue = Issue(
                title=title[:140], description=DESCRIPTIONS[category].format(n=rng.randint(2, 9)),
                category=category, severity=severity, status="open",
                lat=round(lat, 6), lng=round(lng, 6), address=f"Near {landmark}, {locality}",
                locality=locality, pincode=pincode, reporter_uid=reporter_uid, reporter_name=reporter_name,
                original_text=original, created_at=created, updated_at=created,
            )
            if rng.random() < 0.88:
                issue.photo = demo_images.draw(category, False, rng.randint(0, 10**6), created)
                issue.has_photo = 1
                photos += 1
            issue.updates.append(StatusUpdate(status="open", note="Reported", by_name=reporter_name, created_at=created))

            # ---- life cycle --------------------------------------------------------------------------
            age_days = (now - created).total_seconds() / 86400
            fix_days = {"high": rng.uniform(0.6, 3.5), "medium": rng.uniform(1.5, 7), "low": rng.uniform(3, 12)}[severity]
            assign_after = rng.uniform(0.05, 0.9) if severity == "high" else rng.uniform(0.2, 2.2)
            roll = rng.random()
            email, wname, _ = _worker_for(category, rng)

            if age_days > assign_after and roll < 0.94:
                assigned = created + timedelta(days=assign_after)
                issue.assigned_to_email, issue.assigned_to_name, issue.assigned_at = email, wname, assigned
                issue.updates.append(StatusUpdate(status="open", note=f"Assigned to field worker {wname}.",
                                                  by_name=ADMIN_NAME, created_at=assigned))
                started = assigned + timedelta(hours=rng.uniform(2, 30))
                if started < now and roll < 0.9:
                    issue.status = "in_progress"
                    issue.updates.append(StatusUpdate(status="in_progress", note="Work started.", by_name=wname, created_at=started))
                    fixed = created + timedelta(days=max(fix_days, assign_after + 0.3))
                    if fixed < now and roll < 0.86:
                        issue.status, issue.resolved_at, issue.updated_at = "resolved", fixed, fixed
                        issue.fixed_by_email, issue.fixed_by_name = email, wname
                        issue.after_photo = demo_images.draw(category, True, rng.randint(0, 10**6), fixed)
                        issue.has_after_photo = 1
                        photos += 1
                        issue.updates.append(StatusUpdate(status="resolved", note=rng.choice([
                            "Fixed. See the after photo.", "Patched and levelled.", "Cleared and area cleaned.",
                            "Replaced and tested.", "Repaired; will check again after rain."]), by_name=wname, created_at=fixed))
                    else:
                        issue.updated_at = started
            if issue.status == "open" and age_days > 20 and rng.random() < 0.25:
                closed = created + timedelta(days=rng.uniform(1, 4))
                issue.status, issue.updated_at = "rejected", closed
                issue.updates.append(StatusUpdate(status="rejected", note=rng.choice([
                    "Private property; resident informed to contact the owner.",
                    "Handled by the highways department; forwarded to them."]), by_name=ADMIN_NAME, created_at=closed))
            db.add(issue)
            issues.append(issue)
    db.flush()

    # ---- +1s from neighbours (real rows, never the reporter) -----------------------------------------
    voter_ids = [uid for uid, _ in pool]
    for issue in issues:
        base = {"high": 9, "medium": 4, "low": 2}[issue.severity]
        n = min(len(voter_ids) - 1, max(0, int(rng.expovariate(1 / base))))
        voters = rng.sample([v for v in voter_ids if v != issue.reporter_uid], n)
        for uid in voters:
            db.add(Upvote(issue_id=issue.id, uid=uid))
        issue.upvotes = len(voters)

    # ---- resident <-> worker chats --------------------------------------------------------------------
    chats = 0
    for issue in issues:
        persona_report = issue.reporter_uid.startswith("dev-")
        if not issue.assigned_to_email or rng.random() > (0.75 if persona_report else 0.18):
            continue
        t = issue.assigned_at + timedelta(minutes=rng.randint(10, 120))
        lm = issue.address.replace("Near ", "").split(",")[0]
        wname, wuid = issue.assigned_to_name, "dev-" + issue.assigned_to_email.split("@")[0]
        thread = [(wuid, wname, "worker", rng.choice(CHAT["worker_open"]).format(
            w=wname.split()[0], crew=CREW[issue.category], when=_when_phrase(rng), lm=lm))]
        thread.append((issue.reporter_uid, issue.reporter_name, "public", rng.choice(CHAT["resident"]).format(lm=lm)))
        if issue.status in ("in_progress", "resolved"):
            thread.append((wuid, wname, "worker", rng.choice(CHAT["worker_progress"])))
        if issue.status == "resolved":
            thread.append((wuid, wname, "worker", rng.choice(CHAT["worker_done"])))
            if rng.random() < 0.7:
                thread.append((issue.reporter_uid, issue.reporter_name, "public", rng.choice(CHAT["resident_done"])))
        last_seen_by_reporter = 0
        for uid, name, role, body in thread:
            t = min(t + timedelta(minutes=rng.randint(5, 600)), (issue.resolved_at or now) + timedelta(hours=2), now)
            m = Message(issue_id=issue.id, sender_uid=uid, sender_name=name, sender_role=role, body=body, created_at=t)
            db.add(m)
            db.flush()
            if role == "public":
                last_seen_by_reporter = m.id
            chats += 1
        # Leave the latest worker message unread for persona residents so the badge shows.
        if last_seen_by_reporter:
            db.add(MessageRead(issue_id=issue.id, uid=issue.reporter_uid, last_read_message_id=last_seen_by_reporter))

    # ---- duplicates: a few fresh near-identical reports (pending) and a couple already merged ----------
    open_ones = [i for i in issues if i.status in ("open", "in_progress") and (now - i.created_at).days < 20]
    rng.shuffle(open_ones)
    flagged, merged = 0, 0
    for k, orig in enumerate(open_ones[:9]):
        created = min(now - timedelta(hours=rng.uniform(1, 40)), orig.created_at + timedelta(days=rng.uniform(0.2, 5)))
        d_lat, d_lng = rng.uniform(-0.00018, 0.00018), rng.uniform(-0.00018, 0.00018)
        uid, name = rng.choice([v for v in pool if v[0] != orig.reporter_uid])
        dup = Issue(title=orig.title, description=orig.description, category=orig.category, severity=orig.severity,
                    status="open", lat=orig.lat + d_lat, lng=orig.lng + d_lng, address=orig.address,
                    locality=orig.locality, pincode=orig.pincode, reporter_uid=uid, reporter_name=name,
                    original_text="", created_at=created, updated_at=created, upvotes=0)
        dup.photo, dup.has_photo = demo_images.draw(orig.category, False, rng.randint(0, 10**6), created), 1
        dup.updates.append(StatusUpdate(status="open", note="Reported", by_name=name, created_at=created))
        db.add(dup)
        db.flush()
        flags = duplicates.flag(db, dup)
        if k < 3 and flags:  # the admin already merged these
            duplicates.merge(db, orig, dup, ADMIN_NAME)
            merged += 1
        else:
            flagged += len(flags)

    db.commit()
    return {"issues": len(issues) + 9, "photos": photos, "messages": chats,
            "pending_duplicates": db.query(DuplicateFlag).filter(DuplicateFlag.status == "pending").count(),
            "merged": merged, "categories": len(CATEGORIES)}


def distance_from_college_m(lat: float, lng: float) -> float:
    return duplicates.distance_m(COLLEGE[0], COLLEGE[1], lat, lng)

