import io
import os
import sys
from pathlib import Path

os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "sqlite:///./test.db")
os.environ["SUPABASE_URL"] = ""
os.environ["SUPABASE_ANON_KEY"] = ""
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
WORKER = {"Authorization": "Bearer dev:ravi:Ravi:w"}


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
    assert client.get("/api/me", headers=ADMIN).json()["role"] == "admin"
    assert client.get("/api/me", headers=WORKER).json()["role"] == "worker"
    assert client.get("/api/me", headers=CITIZEN).json()["role"] == "public"


def test_worker_can_mark_fixed_but_not_close_or_delete():
    iid = report().json()["id"]
    assert client.post(f"/api/issues/{iid}/status", json={"status": "rejected"}, headers=WORKER).status_code == 403
    assert client.delete(f"/api/issues/{iid}", headers=WORKER).status_code == 403
    # Workers must prove the fix with an after photo.
    assert client.post(f"/api/issues/{iid}/status", json={"status": "resolved"}, headers=WORKER).status_code == 422
    assert client.post(f"/api/issues/{iid}/status", json={"status": "in_progress"}, headers=WORKER).status_code == 200
    r = client.post(f"/api/issues/{iid}/fix", data={"note": "Filled"}, files={"photo": ("a.jpg", jpeg(), "image/jpeg")},
                    headers=WORKER)
    assert r.status_code == 200 and r.json()["status"] == "resolved" and r.json()["after_photo_url"]
    assert client.get(r.json()["after_photo_url"]).status_code == 200
    assert client.post(f"/api/issues/{iid}/fix", files={"photo": ("a.jpg", jpeg(), "image/jpeg")}).status_code == 401


def test_admin_promotes_resident_to_worker():
    assert client.get("/api/staff", headers=WORKER).status_code == 403
    r = client.post("/api/staff", json={"email": "Meera@demo.local", "role": "worker"}, headers=ADMIN)
    assert r.status_code == 201 and any(m["email"] == "meera@demo.local" for m in r.json())
    assert client.get("/api/me", headers=CITIZEN).json()["role"] == "worker"
    client.delete("/api/staff/meera@demo.local", headers=ADMIN)
    assert client.get("/api/me", headers=CITIZEN).json()["role"] == "public"


def test_report_fills_locality_from_pin_and_resizes_photo():
    r = report()
    assert r.status_code == 201, r.text
    issue = r.json()
    assert issue["locality"] == "T. Nagar" and issue["pincode"] == "600017"
    assert issue["is_mine"] and issue["updates"][0]["status"] == "open"
    img = Image.open(io.BytesIO(client.get(issue["photo_url"]).content))
    assert max(img.size) <= 1400


def test_report_requires_sign_in_and_valid_category():
    assert client.post("/api/issues", data={"title": "x" * 5, "category": "pothole", "lat": 1, "lng": 1}).status_code == 401
    assert report(category="spaceship").status_code == 422


def test_browse_by_pincode_and_locality():
    report()
    report(locality="Koramangala", pincode="560034")
    assert len(client.get("/api/issues", params={"pincode": "600017"}).json()) == 1
    assert len(client.get("/api/issues", params={"locality": "koramangala"}).json()) == 1
    assert len(client.get("/api/issues", params={"q": "600017"}).json()) == 1
    areas = client.get("/api/issues/areas").json()
    assert {a["pincode"] for a in areas} == {"600017", "560034"}


def test_upvote_toggles_once_per_person():
    iid = report().json()["id"]
    assert client.post(f"/api/issues/{iid}/upvote", headers=OTHER).json() == {"upvotes": 1, "upvoted": True}
    assert client.post(f"/api/issues/{iid}/upvote", headers=OTHER).json() == {"upvotes": 0, "upvoted": False}


def test_only_admin_changes_status_and_stats_follow():
    iid = report().json()["id"]
    assert client.post(f"/api/issues/{iid}/status", json={"status": "resolved"}, headers=CITIZEN).status_code == 403
    r = client.post(f"/api/issues/{iid}/status", json={"status": "resolved", "note": "Patched"}, headers=ADMIN)
    assert r.status_code == 200 and r.json()["resolved_at"]
    s = client.get("/api/stats", params={"pincode": "600017"}).json()
    assert s["total"] == 1 and s["resolved"] == 1 and s["resolved_pct"] == 100

    # Reopening when resolved moves it to rechecking:
    reopen_resp = client.post(f"/api/issues/{iid}/reopen", json={"note": "Fake fix - pothole still here"}, headers=CITIZEN)
    assert reopen_resp.status_code == 200
    assert reopen_resp.json()["status"] == "rechecking"
    assert reopen_resp.json()["resolved_at"] is None
    s2 = client.get("/api/stats", params={"pincode": "600017"}).json()
    assert s2["resolved"] == 0 and s2["rechecking"] == 1
    # Cannot reopen a non-resolved issue:
    assert client.post(f"/api/issues/{iid}/reopen", json={"note": "again"}, headers=CITIZEN).status_code == 422


def test_nearby_finds_open_reports_close_to_pin():
    report()
    near = client.get("/api/issues/nearby", params={"lat": 12.9701, "lng": 77.6401}).json()
    far = client.get("/api/issues/nearby", params={"lat": 12.99, "lng": 77.70}).json()
    assert len(near) == 1 and near[0]["distance_m"] < 150 and far == []


def test_near_returns_issues_sorted_by_distance_with_filters():
    report(lat=13.0400, lng=80.2400)
    report(lat=13.0450, lng=80.2400)  # ~550 m north
    report(lat=13.2000, lng=80.2400)  # far away
    rows = client.get("/api/issues/near", params={"lat": 13.0401, "lng": 80.2400, "radius": 1000}).json()
    assert len(rows) == 2 and rows[0]["distance_m"] < rows[1]["distance_m"]
    iid = rows[0]["id"]
    client.post(f"/api/issues/{iid}/status", json={"status": "rejected", "note": "x"}, headers=ADMIN)
    active = client.get("/api/issues/near", params={"lat": 13.0401, "lng": 80.24, "radius": 1000, "status": "active"}).json()
    assert [r["id"] for r in active] == [rows[1]["id"]]


def test_chat_only_for_reporter_and_staff_with_unread_counts():
    iid = report().json()["id"]
    assert client.get(f"/api/issues/{iid}/messages", headers=OTHER).status_code == 403
    assert client.post(f"/api/issues/{iid}/messages", json={"body": "hi"}, headers=OTHER).status_code == 403
    r = client.post(f"/api/issues/{iid}/messages", json={"body": "Crew coming Thursday"}, headers=WORKER)
    assert r.status_code == 201 and r.json()["sender_role"] == "worker"
    mine = client.get("/api/issues", params={"mine": True}, headers=CITIZEN).json()
    assert mine[0]["unread"] == 1
    msgs = client.get(f"/api/issues/{iid}/messages", headers=CITIZEN).json()
    assert [m["body"] for m in msgs] == ["Crew coming Thursday"] and not msgs[0]["is_mine"]
    assert client.get("/api/issues", params={"mine": True}, headers=CITIZEN).json()[0]["unread"] == 0
    client.post(f"/api/issues/{iid}/messages", json={"body": "Thanks!"}, headers=CITIZEN)
    assert len(client.get(f"/api/issues/{iid}/messages", params={"after": msgs[0]["id"]}, headers=WORKER).json()) == 1
    # Admins are not part of the resident <-> worker chat.
    assert client.get(f"/api/issues/{iid}/messages", headers=ADMIN).status_code == 403
    assert client.post(f"/api/issues/{iid}/messages", json={"body": "x"}, headers=ADMIN).status_code == 403


def test_ai_analyze_uses_gemini(monkeypatch):
    monkeypatch.setattr(gemini, "_call", lambda parts, schema=None:
                        '{"is_civic_issue": true, "category": "pothole", "title": "Pothole", '
                        '"description": "Big hole.", "severity": "bogus"}')
    r = client.post("/api/ai/analyze", files={"photo": ("p.jpg", jpeg(), "image/jpeg")}, headers=CITIZEN)
    assert r.status_code == 200
    assert r.json()["category"] == "pothole" and r.json()["severity"] == "medium"


def test_ai_structure_validates_and_keeps_original_text(monkeypatch):
    seen = {}

    def fake(parts, schema=None):
        seen["prompt"] = parts[0]["text"]
        return ('{"is_civic_issue": true, "category": "spaceship", "title": "Garbage pile near school", '
                '"description": "Garbage not cleared for a week.", "severity": "extreme", "landmark": "Govt school", '
                '"original_language": "ta", "translated_text": "Garbage near the school for a week"}')

    monkeypatch.setattr(gemini, "_call", fake)
    text = "பள்ளி அருகே ஒரு வாரமாக குப்பை"
    r = client.post("/api/ai/structure", json={"text": text, "lang": "ta"}, headers=CITIZEN)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["category"] == "other" and d["severity"] == "medium" and d["landmark"] == "Govt school"
    assert d["original_language"] == "ta" and "Tamil" in seen["prompt"] and text in seen["prompt"]
    assert client.post("/api/ai/structure", json={"text": text, "lang": "fr"}, headers=CITIZEN).status_code == 422
    assert client.post("/api/ai/structure", json={"text": text}).status_code == 401
    issue = report(original_text=text).json()
    assert issue["original_text"] == text


def test_close_similar_report_is_flagged_and_admin_merges():
    a = report(title="Deep pothole outside bus stop").json()
    client.post(f"/api/issues/{a['id']}/upvote", headers=OTHER)
    b = report(headers=OTHER, title="Big pothole at the bus stop", lat=12.97005, lng=77.64002).json()
    assert b["likely_duplicate_of"] == [a["id"]]
    flags = client.get("/api/admin/duplicates", headers=ADMIN).json()
    assert len(flags) == 1 and flags[0]["candidate"]["id"] == a["id"] and flags[0]["distance_m"] < 10
    assert client.get("/api/admin/duplicates", headers=WORKER).status_code == 403
    fid = flags[0]["id"]
    assert client.post(f"/api/admin/duplicates/{fid}/merge", json={"keep_id": 999}, headers=ADMIN).status_code == 422
    client.post(f"/api/issues/{a['id']}/messages", json={"body": "on it"}, headers=WORKER)
    client.post(f"/api/issues/{b['id']}/messages", json={"body": "same here"}, headers=OTHER)
    r = client.post(f"/api/admin/duplicates/{fid}/merge", json={"keep_id": a["id"]}, headers=ADMIN)
    assert r.status_code == 200, r.text
    kept = client.get(f"/api/issues/{a['id']}").json()
    gone = client.get(f"/api/issues/{b['id']}").json()
    # OTHER already +1'd the kept report and also reported the duplicate: still counted once.
    assert kept["upvotes"] == 1
    assert gone["status"] == "rejected" and gone["merged_into"] == a["id"]
    assert any("Merged" in u["note"] for u in kept["updates"]) and any("Merged" in u["note"] for u in gone["updates"])
    assert len(client.get(f"/api/issues/{a['id']}/messages", headers=WORKER).json()) == 2
    assert client.get("/api/admin/duplicates", headers=ADMIN).json() == []
    assert client.post(f"/api/admin/duplicates/{fid}/dismiss", headers=ADMIN).status_code == 409


def test_far_or_different_category_is_not_flagged():
    report(title="Deep pothole outside bus stop")
    assert report(title="Deep pothole outside bus stop", lat=12.9720).json()["likely_duplicate_of"] == []  # ~220 m
    assert report(title="Deep pothole outside bus stop", category="garbage").json()["likely_duplicate_of"] == []
    assert client.get("/api/admin/duplicates", headers=ADMIN).json() == []


def test_duplicate_score_prefers_close_and_similar():
    from app import duplicates as d
    assert d.jaccard("Deep pothole near bus stop", "pothole at the bus stop") > 0.5
    assert d.jaccard("streetlight off", "garbage pile") == 0


def test_admin_assigns_job_and_worker_sees_it():
    iid = report().json()["id"]
    assert client.post(f"/api/issues/{iid}/assign", json={"email": "ravi@demo.local"}, headers=WORKER).status_code == 403
    assert client.post(f"/api/issues/{iid}/assign", json={"email": "meera@demo.local"}, headers=ADMIN).status_code == 422
    client.post("/api/staff", json={"email": "ravi@demo.local", "name": "Ravi"}, headers=ADMIN)
    r = client.post(f"/api/issues/{iid}/assign", json={"email": "ravi@demo.local"}, headers=ADMIN)
    assert r.status_code == 200 and r.json()["assigned_to_email"] == "ravi@demo.local"
    assert "Assigned to field worker Ravi." in [u["note"] for u in r.json()["updates"]]
    # Everyone sees who's on it by name; the email stays with staff.
    public = client.get(f"/api/issues/{iid}").json()
    assert public["assigned_to_name"] == "Ravi" and public["assigned_to_email"] == ""
    assert not any("@" in u["note"] for u in public["updates"])
    staff = client.get("/api/staff", headers=ADMIN).json()
    assert next(m for m in staff if m["email"] == "ravi@demo.local")["open_jobs"] == 1
    jobs = client.get("/api/issues", params={"worker": "me", "status": "active"}, headers=WORKER).json()
    assert [j["id"] for j in jobs] == [iid]
    assert client.get("/api/issues", params={"worker": "me"}, headers=CITIZEN).status_code == 403
    assert client.get("/api/issues", params={"unassigned": True}).json() == []
    client.post(f"/api/issues/{iid}/fix", files={"photo": ("a.jpg", jpeg(), "image/jpeg")}, headers=WORKER)
    done = client.get("/api/issues", params={"worker": "me", "status": "resolved", "sort": "fixed"}, headers=WORKER).json()
    assert [j["id"] for j in done] == [iid]
    assert client.get("/api/stats").json()["fixed_this_week"] == 1


def test_weekly_proof_of_work_and_recent_fixes():
    a = report().json()["id"]
    report()
    client.post(f"/api/issues/{a}/fix", files={"photo": ("a.jpg", jpeg(), "image/jpeg")}, headers=WORKER)
    weeks = client.get("/api/stats/weekly", params={"weeks": 8}).json()
    assert len(weeks) == 8 and weeks[-1]["reported"] == 2 and weeks[-1]["fixed"] == 1
    assert sum(w["reported"] for w in weeks[:-1]) == 0
    fixes = client.get("/api/stats/recent-fixes").json()
    assert [f["id"] for f in fixes] == [a] and fixes[0]["after_photo_url"]


def test_only_residents_other_than_the_reporter_can_upvote():
    iid = report().json()["id"]  # reported by CITIZEN
    r = client.post(f"/api/issues/{iid}/upvote", headers=CITIZEN)
    assert r.status_code == 403 and "reported this" in r.json()["detail"]
    assert client.post(f"/api/issues/{iid}/upvote", headers=WORKER).status_code == 403
    assert client.post(f"/api/issues/{iid}/upvote", headers=ADMIN).status_code == 403
    assert client.post(f"/api/issues/{iid}/upvote", headers=OTHER).json() == {"upvotes": 1, "upvoted": True}


def test_chat_is_reporter_and_the_assigned_worker_only():
    iid = report().json()["id"]
    selvi = {"Authorization": "Bearer dev:selvi:Selvi:w"}
    # Unassigned: any worker may reply (and starting work picks the job up).
    assert client.post(f"/api/issues/{iid}/messages", json={"body": "I can take this"}, headers=selvi).status_code == 201
    client.post(f"/api/issues/{iid}/status", json={"status": "in_progress"}, headers=WORKER)
    issue = client.get(f"/api/issues/{iid}", headers=ADMIN).json()
    assert issue["assigned_to_email"] == "ravi@demo.local" and issue["assigned_to_name"] == "Ravi"
    # Now only Ravi (and the reporter) can chat or act on it.
    assert client.get(f"/api/issues/{iid}/messages", headers=selvi).status_code == 403
    assert client.get(f"/api/issues/{iid}/messages", headers=WORKER).status_code == 200
    assert client.get(f"/api/issues/{iid}/messages", headers=CITIZEN).status_code == 200
    assert client.post(f"/api/issues/{iid}/fix", files={"photo": ("a.jpg", jpeg(), "image/jpeg")}, headers=selvi).status_code == 403
    r = client.post(f"/api/issues/{iid}/fix", files={"photo": ("a.jpg", jpeg(), "image/jpeg")}, headers=WORKER)
    assert r.status_code == 200 and r.json()["fixed_by_name"] == "Ravi"
