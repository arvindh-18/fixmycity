"""Fill the database with the demo dataset around Saveetha Engineering College.

    DEMO_MODE=1 python demo_seed.py      # wipes ALL data, then creates ~12 weeks of mock reports
"""
from app.config import settings
from app.db import SessionLocal
from app.demo import seed

if __name__ == "__main__":
    if settings.environment == "production":
        raise SystemExit("Refusing to wipe a production database.")
    with SessionLocal() as db:
        print("Demo data ready:", seed(db))
