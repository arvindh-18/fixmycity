import io
import os
import sys
from pathlib import Path

os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "sqlite:///./test.db")
os.environ["FIREBASE_PROJECT_ID"] = ""
os.environ["FIREBASE_API_KEY"] = ""
os.environ["GEMINI_API_KEY"] = "test-key"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from app import gemini, geocode  # noqa: E402
from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402

CITIZEN = {"Authorization": "Bearer dev:meera:Meera:0"}
OTHER = {"Authorization": "Bearer dev:arjun:Arjun:0"}
ADMIN = {"Authorization": "Bearer dev:admin:FixMyCity Staff:1"}


@pytest.fixture(autouse=True)
def fresh_db(monkeypatch):
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(geocode, "_reverse", lambda lat, lng: {
        "address": "Pondy Bazaar, T. Nagar", "locality": "T. Nagar", "pincode": "600017", "city": "Chennai"})
    yield


client = TestClient(app)


def jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (2000, 1500), "gray").save(buf, "JPEG")
    return buf.getvalue()


def report(headers=CITIZEN, **extra):
    data = {"title": "Pothole on 100 Feet Road", "category": "pothole", "lat": 12.97, "lng": 77.64, **extra}
    return client.post("/api/issues", data=data, files={"photo": ("p.jpg", jpeg(), "image/jpeg")}, headers=headers)


def test_config_and_me():
    cfg = client.get("/api/config").json()
    assert cfg["auth_mode"] == "dev" and cfg["ai_enabled"]
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers=ADMIN).json()["is_admin"] is True


def test_report_fills_locality_from_pin_and_resizes_photo():
    r = report()
    assert r.status_code == 201, r.text
    issue = r.json()
    assert issue["locality"] == "Indiranagar" and issue["pincode"] == "560038"
    assert issue["is_mine"] and issue["updates"][0]["status"] == "open"
    img = Image.open(io.BytesIO(client.get(issue["photo_url"]).content))
    assert max(img.size) <= 1400


def test_report_requires_sign_in_and_valid_category():
    assert client.post("/api/issues", data={"title": "x" * 5, "category": "pothole", "lat": 1, "lng": 1}).status_code == 401
    assert report(category="spaceship").status_code == 422


def test_browse_by_pincode_and_locality():
    report()
    report(locality="Koramangala", pincode="560034")
    assert len(client.get("/api/issues", params={"pincode": "560038"}).json()) == 1
    assert len(client.get("/api/issues", params={"locality": "koramangala"}).json()) == 1
    assert len(client.get("/api/issues", params={"q": "5600"}).json()) == 2
    areas = client.get("/api/issues/areas").json()
    assert {a["pincode"] for a in areas} == {"560038", "560034"}


def test_upvote_toggles_once_per_person():
    iid = report().json()["id"]
    assert client.post(f"/api/issues/{iid}/upvote", headers=OTHER).json() == {"upvotes": 1, "upvoted": True}
    assert client.post(f"/api/issues/{iid}/upvote", headers=OTHER).json() == {"upvotes": 0, "upvoted": False}


def test_only_admin_changes_status_and_stats_follow():
    iid = report().json()["id"]
    assert client.post(f"/api/issues/{iid}/status", json={"status": "resolved"}, headers=CITIZEN).status_code == 403
    r = client.post(f"/api/issues/{iid}/status", json={"status": "resolved", "note": "Patched"}, headers=ADMIN)
    assert r.status_code == 200 and r.json()["resolved_at"]
    s = client.get("/api/stats", params={"pincode": "560038"}).json()
    assert s["total"] == 1 and s["resolved"] == 1 and s["resolved_pct"] == 100


def test_nearby_finds_open_reports_close_to_pin():
    report()
    near = client.get("/api/issues/nearby", params={"lat": 12.9701, "lng": 77.6401}).json()
    far = client.get("/api/issues/nearby", params={"lat": 12.99, "lng": 77.70}).json()
    assert len(near) == 1 and near[0]["distance_m"] < 150 and far == []


def test_ai_analyze_uses_gemini(monkeypatch):
    monkeypatch.setattr(gemini, "_call", lambda parts, schema=None:
                        '{"is_civic_issue": true, "category": "pothole", "title": "Pothole", '
                        '"description": "Big hole.", "severity": "bogus"}')
    r = client.post("/api/ai/analyze", files={"photo": ("p.jpg", jpeg(), "image/jpeg")}, headers=CITIZEN)
    assert r.status_code == 200
    assert r.json()["category"] == "pothole" and r.json()["severity"] == "medium"
