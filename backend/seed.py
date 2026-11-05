"""Add ~40 sample reports around Bengaluru so the map and stats aren't empty during a demo.

    python seed.py          # add sample data (skips if samples already exist)
    python seed.py --reset  # delete ALL reports, then add samples
"""
import random
import sys
from datetime import timedelta

from app.db import Issue, SessionLocal, StatusUpdate, Upvote, init_db, now

AREAS = [
    ("Indiranagar", "560038", 12.9719, 77.6412),
    ("Koramangala", "560034", 12.9352, 77.6245),
    ("HSR Layout", "560102", 12.9116, 77.6474),
    ("Jayanagar", "560041", 12.9250, 77.5938),
    ("Whitefield", "560066", 12.9698, 77.7500),
    ("Malleshwaram", "560003", 13.0035, 77.5710),
    ("BTM Layout", "560076", 12.9166, 77.6101),
    ("Basavanagudi", "560004", 12.9421, 77.5754),
    ("Hebbal", "560024", 13.0358, 77.5970),
    ("Marathahalli", "560037", 12.9591, 77.6974),
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
            address=f"{locality}, Bengaluru, Karnataka {pin}", locality=locality, pincode=pin,
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
