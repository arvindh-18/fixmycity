"""Add ~40 sample reports around Chennai so the map and stats aren't empty during a demo.

    python seed.py          # add sample data (skips if samples already exist)
    python seed.py --reset  # delete ALL reports, then add samples
"""
import random
import sys
from datetime import timedelta

from app.db import Issue, SessionLocal, StatusUpdate, Upvote, init_db, now

AREAS = [
    ("T. Nagar", "600017", 13.0418, 80.2341),
    ("Adyar", "600020", 13.0012, 80.2565),
    ("Mylapore", "600004", 13.0368, 80.2676),
    ("Anna Nagar", "600040", 13.0850, 80.2101),
    ("Velachery", "600042", 12.9759, 80.2212),
    ("Nungambakkam", "600034", 13.0569, 80.2425),
    ("Besant Nagar", "600090", 13.0002, 80.2667),
    ("Guindy", "600032", 13.0067, 80.2025),
    ("Alwarpet", "600018", 13.0336, 80.2515),
    ("Thiruvanmiyur", "600041", 12.9830, 80.2594),
    ("Royapettah", "600014", 13.0524, 80.2612),
    ("Kodambakkam", "600024", 13.0529, 80.2238),
]

SAMPLES = [
    ("pothole", "high", "Deep pothole across the left lane",
     "Pothole roughly a metre wide and deep enough to bend a scooter rim. Two-wheelers swerve into traffic to avoid it."),
    ("pothole", "medium", "Road surface broken near bus stop",
     "Tarmac has crumbled over about 5 metres beside the bus stop. Water collects here after rain."),
    ("garbage", "medium", "Garbage dumped on empty plot",
     "Household waste piling up at the corner plot for over a week. Smell is strong and dogs are scattering it."),
    ("garbage", "low", "Overflowing bin outside park gate",
     "Public bin outside the park entrance is full and bags are lying on the footpath."),
    ("streetlight", "high", "Three streetlights out on main road",
     "A stretch of about 200 metres is completely dark at night. Pedestrians walk on the road here."),
    ("streetlight", "medium", "Streetlight flickering all night", "Light near the junction flickers on and off."),
    ("water", "high", "Drinking water pipe leaking onto road",
     "Clean water gushing from a joint in the supply line since morning. Road is flooded on one side."),
    ("drainage", "high", "Open manhole without cover",
     "Manhole cover missing on the footpath. Very dangerous at night and for children walking to school."),
    ("drainage", "medium", "Storm drain blocked with silt",
     "Drain is choked with plastic and silt. The road floods in light rain."),
    ("traffic", "medium", "Traffic signal stuck on red",
     "Signal at the junction has been showing red in all directions since yesterday evening."),
    ("tree", "high", "Large branch hanging over road",
     "A big branch has cracked and is hanging over the road after the storm. Could fall on vehicles."),
    ("footpath", "medium", "Footpath slabs broken and missing",
     "Several slabs are missing, leaving gaps over the drain. Hard for elderly people and prams."),
]

NOTES = {
    "in_progress": ["Crew assigned, work starts this week.", "Inspected on site. Material ordered."],
    "resolved": ["Fixed and inspected.", "Work completed. Thank you for reporting."],
}


def main(reset: bool) -> None:
    init_db()
    db = SessionLocal()
    if reset:
        db.query(Upvote).delete()
        db.query(StatusUpdate).delete()
        db.query(Issue).delete()
        db.commit()
    elif db.query(Issue).filter(Issue.reporter_uid == "seed").count():
        print("Sample data already present. Use --reset to start over.")
        return

    rng = random.Random(7)
    names = ["Priya S", "Arjun M", "Meera K", "Rahul D", "Fatima A", "Vikram R", "Lakshmi N"]
    for n in range(42):
        locality, pin, lat, lng = AREAS[n % len(AREAS)]
        cat, sev, title, desc = SAMPLES[(n * 5) % len(SAMPLES)]
        created = now() - timedelta(days=rng.uniform(0, 28), hours=rng.uniform(0, 23))
        status = rng.choices(["open", "in_progress", "resolved", "rejected"], [45, 25, 27, 3])[0]
        issue = Issue(
            title=title, description=desc, category=cat, severity=sev, status=status,
            lat=lat + rng.uniform(-0.008, 0.008), lng=lng + rng.uniform(-0.008, 0.008),
            address=f"{locality}, Chennai, Tamil Nadu {pin}", locality=locality, pincode=pin,
            reporter_uid="seed", reporter_name=rng.choice(names), upvotes=rng.randint(0, 34),
            created_at=created, updated_at=created,
        )
        issue.updates.append(StatusUpdate(status="open", note="Reported", by_name=issue.reporter_name, created_at=created))
        if status in ("in_progress", "resolved"):
            t = created + timedelta(days=rng.uniform(0.3, 2))
            issue.updates.append(StatusUpdate(status="in_progress", note=rng.choice(NOTES["in_progress"]), by_name="FixMyCity Operations", created_at=t))
            issue.updated_at = t
        if status == "resolved":
            t = issue.updated_at + timedelta(days=rng.uniform(0.5, 6))
            t = min(t, now())
            issue.updates.append(StatusUpdate(status="resolved", note=rng.choice(NOTES["resolved"]), by_name="FixMyCity Operations", created_at=t))
            issue.updated_at = issue.resolved_at = t
        if status == "rejected":
            issue.updates.append(StatusUpdate(status="rejected", note="Duplicate of an existing report.", by_name="FixMyCity Operations", created_at=created + timedelta(hours=5)))
        db.add(issue)
    db.commit()
    print("Added 42 sample reports.")


if __name__ == "__main__":
    main("--reset" in sys.argv)
