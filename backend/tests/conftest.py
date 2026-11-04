"""Test setup: a separate PostgreSQL+PostGIS database (TEST_DATABASE_URL), migrated fresh per session.

    TEST_DATABASE_URL=postgresql+psycopg://openward:openward@localhost:5432/openward_test pytest
"""
from __future__ import annotations

import io
import os
import sys
from pathlib import Path

TEST_DB = os.getenv("TEST_DATABASE_URL", "postgresql+psycopg://openward:openward@localhost:5432/openward_test")
os.environ["DATABASE_URL"] = TEST_DB
os.environ["ENABLE_BACKGROUND_JOBS"] = "false"
os.environ["AI_PROVIDER"] = "rules"
os.environ["EMAIL_BACKEND"] = "outbox"
os.environ["EMAIL_SYNC"] = "true"
os.environ["OUTBOX_DIR"] = str(Path(__file__).parent / ".outbox")
os.environ.setdefault("MEDIA_DIR", str(Path(__file__).parent / ".media"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core import rate_limit  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.database.session import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import (  # noqa: E402
    Department, IssueCategory, Locality, SLAConfiguration, User, WorkerProfile, CitizenProfile,
)

PW = "Test@12345"


@pytest.fixture(scope="session", autouse=True)
def database():
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))
    command.upgrade(cfg, "head")
    rate_limit.enabled = False
    _seed_minimum()
    yield


def _seed_minimum():
    db = SessionLocal()
    roads = Department(name="Roads", code="RDI")
    water = Department(name="Water", code="WSS")
    db.add_all([roads, water])
    db.flush()
    db.add_all([
        IssueCategory(name="Roads and potholes", slug="roads-potholes", keywords=["pothole", "road", "crater"], default_department_id=roads.id),
        IssueCategory(name="Water supply and leakage", slug="water-supply", keywords=["water", "leak", "pipe"], default_department_id=water.id),
        IssueCategory(name="Other civic issues", slug="other", keywords=["other"]),
    ])
    db.add_all([SLAConfiguration(priority=p, response_hours=r, resolution_hours=h)
                for p, r, h in [("critical", 2, 24), ("high", 8, 72), ("medium", 24, 168), ("low", 48, 336)]])
    db.add(Locality(name="Testpur", is_approximate=True,
                    boundary="SRID=4326;MULTIPOLYGON(((77.50 12.90, 77.70 12.90, 77.70 13.10, 77.50 13.10, 77.50 12.90)))"))
    pw = hash_password(PW)
    db.add(User(email="admin@t.demo", full_name="City Admin", role="admin", password_hash=pw))
    db.add(User(email="water.admin@t.demo", full_name="Water Admin", role="admin", password_hash=pw, department_id=water.id))
    for email, name in [("cit@t.demo", "Asha Citizen"), ("cit2@t.demo", "Ben Citizen")]:
        u = User(email=email, full_name=name, role="citizen", password_hash=pw)
        db.add(u)
        db.flush()
        db.add(CitizenProfile(user_id=u.id))
    for email, name, dept in [("w1@t.demo", "Worker One", roads), ("w2@t.demo", "Worker Two", roads), ("ww@t.demo", "Water Worker", water)]:
        u = User(email=email, full_name=name, role="worker", password_hash=pw, department_id=dept.id)
        db.add(u)
        db.flush()
        db.add(WorkerProfile(user_id=u.id, department_id=dept.id, employee_code=email.split("@")[0].upper()))
    db.commit()
    db.close()


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


def login(client, email):
    r = client.post("/api/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def h(client):
    return {k: login(client, f"{k}@t.demo") for k in ("admin", "cit", "cit2", "w1", "w2", "ww")} | {
        "water_admin": login(client, "water.admin@t.demo")}


@pytest.fixture(scope="session")
def meta(client):
    return client.get("/api/meta").json()


def jpeg(color=(120, 90, 60)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), color).save(buf, "JPEG")
    return buf.getvalue()


@pytest.fixture
def make_issue(client, h, meta):
    def _make(headers=None, title="Deep pothole near bus stop", desc="A deep pothole has formed and bikes keep falling into it.",
              slug="roads-potholes", lat=12.97, lng=77.60, photos=0):
        cat = next(c for c in meta["categories"] if c["slug"] == slug)
        files = [("photos", (f"p{i}.jpg", jpeg(), "image/jpeg")) for i in range(photos)]
        r = client.post("/api/issues", headers=headers if headers is not None else h["cit"],
                        data={"title": title, "description": desc, "category_id": cat["id"], "lat": lat, "lng": lng,
                              "address": "1st Main"}, files=files or None)
        assert r.status_code == 201, r.text
        return r.json()
    return _make
