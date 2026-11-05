"""Demo build: the offline AI stand-in and the mock dataset obey the same rules as the real app."""
import os
import sys
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite:///./test.db")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select  # noqa: E402

from app import mock_ai  # noqa: E402
from app.db import Base, Issue, Message, SessionLocal, Upvote, engine  # noqa: E402


def test_offline_ai_understands_tamil_hindi_and_tanglish():
    ta = mock_ai.structure_text("தண்டலம் பஸ் ஸ்டாப் பக்கத்துல ஒரு வாரமா குப்பை", "ta")
    assert ta["category"] == "garbage" and ta["original_language"] == "ta" and ta["mock"]
    hi = mock_ai.structure_text("कॉलेज रोड पर बड़ा गड्ढा है, बाइक दुर्घटना हुई", "hi")
    assert hi["category"] == "pothole" and hi["severity"] == "high"
    en = mock_ai.structure_text("Streetlight not working near the hostel road, unsafe at night", "en")
    assert en["category"] == "streetlight" and en["landmark"] == "Hostel Road"


def test_demo_seed_follows_the_rules():
    from app.demo import seed

    with SessionLocal() as db:
        summary = seed(db)
        assert summary["issues"] > 200 and summary["pending_duplicates"] > 0
        self_votes = db.scalar(select(func.count()).select_from(Upvote).join(Issue, Issue.id == Upvote.issue_id)
                               .where(Upvote.uid == Issue.reporter_uid))
        assert self_votes == 0
        for m in db.scalars(select(Message)):
            issue = db.get(Issue, m.issue_id)
            worker_uid = "dev-" + (issue.assigned_to_email or "@").split("@")[0]
            assert m.sender_uid in (issue.reporter_uid, worker_uid)
        resolved = db.scalars(select(Issue).where(Issue.status == "resolved")).all()
        assert resolved and all(i.has_after_photo and i.fixed_by_name for i in resolved)
    Base.metadata.drop_all(engine)
