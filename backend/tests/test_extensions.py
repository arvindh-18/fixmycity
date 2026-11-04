"""Tests for email notifications, photo classification and the map-data importer."""
from __future__ import annotations

import email
import email.policy
import shutil
from pathlib import Path

from app.core.config import settings


def _outbox() -> Path:
    return Path(settings.outbox_dir)


def _mails_to(addr: str) -> list:
    if not _outbox().exists():
        return []
    msgs = [email.message_from_bytes(p.read_bytes(), policy=email.policy.default) for p in sorted(_outbox().glob("*.eml"))]
    return [m for m in msgs if m["To"] == addr]


def test_status_change_sends_email(client, h, make_issue):
    shutil.rmtree(_outbox(), ignore_errors=True)
    iid = make_issue()["id"]
    client.post(f"/api/admin/issues/{iid}/verify", headers=h["admin"], json={"priority": "medium"})
    mails = _mails_to("cit@t.demo")
    assert any("verified" in m["Subject"] for m in mails)
    body = next(m for m in mails if "verified" in m["Subject"]).get_body(("plain",)).get_content()
    assert "/issues/CM-" in body


def test_email_opt_out(client, h, make_issue):
    r = client.patch("/api/auth/me/preferences", headers=h["cit"], json={"email_notifications": False})
    assert r.json()["email_notifications"] is False
    shutil.rmtree(_outbox(), ignore_errors=True)
    iid = make_issue()["id"]
    client.post(f"/api/admin/issues/{iid}/verify", headers=h["admin"], json={"priority": "low"})
    assert _mails_to("cit@t.demo") == []
    # in-app notification still arrives
    assert any(n["kind"] == "status_changed" for n in client.get("/api/notifications", headers=h["cit"]).json()["items"])
    client.patch("/api/auth/me/preferences", headers=h["cit"], json={"email_notifications": True})


# ---------------------------------------------------------------- photo classification
def test_photo_not_analysed_in_rules_mode(client, h, make_issue):
    tid = make_issue(photos=1)["tracking_id"]
    cls = client.get(f"/api/admin/issues/{tid}", headers=h["admin"]).json()["ai"]["classification"]
    assert cls["output"]["image_analysis"]["status"] == "unavailable"
    assert cls["mode"] == "rules"


def test_photo_analysed_with_vision_provider(client, h, make_issue, monkeypatch):
    from app.integrations.ai import provider
    seen = {}

    def fake_complete(system, user, max_tokens=600, image=None):
        seen["image"] = image
        return ('{"category_slug": "roads-potholes", "confidence": 0.88, "summary": "Pothole near bus stop",'
                ' "detected_problem": "Pothole", "image_observation": "A deep pothole filled with water",'
                ' "image_matches_description": true, "image_problem_visible": true}')
    monkeypatch.setattr(provider, "llm_configured", lambda: True)
    monkeypatch.setattr(provider, "provider_name", lambda: "anthropic")
    monkeypatch.setattr(provider, "complete", fake_complete)

    tid = make_issue(photos=1)["tracking_id"]
    assert seen["image"][:2] == b"\xff\xd8"  # cleaned JPEG reached the model
    cls = client.get(f"/api/admin/issues/{tid}", headers=h["admin"]).json()["ai"]["classification"]
    ia = cls["output"]["image_analysis"]
    assert cls["mode"] == "llm" and ia["status"] == "analysed" and ia["matches_description"] is True
    assert "pothole" in ia["observation"].lower()


def test_photo_analysis_falls_back_when_provider_fails(client, make_issue, monkeypatch, h):
    from app.integrations.ai import provider
    monkeypatch.setattr(provider, "llm_configured", lambda: True)
    monkeypatch.setattr(provider, "complete", lambda *a, **k: None)  # simulated outage
    tid = make_issue(photos=1)["tracking_id"]
    cls = client.get(f"/api/admin/issues/{tid}", headers=h["admin"]).json()["ai"]["classification"]
    assert cls["mode"] == "rules" and cls["output"]["category_slug"] == "roads-potholes"
    assert cls["output"]["image_analysis"]["status"] == "unavailable"


# ---------------------------------------------------------------- real map data import
def test_import_ward_boundaries_relinks_issues(client, make_issue, tmp_path):
    import json
    from sqlalchemy import delete, select
    from app.database.session import SessionLocal
    from app.models import Locality
    from app.services import geo_import

    tid = make_issue(lat=12.955, lng=77.655)["tracking_id"]
    gj = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"WARD": "Ward 88 Test", "POP": "41250"},
         "geometry": {"type": "MultiPolygon", "coordinates": [[[[77.64, 12.94], [77.67, 12.94], [77.67, 12.97], [77.64, 12.97], [77.64, 12.94]]],
                                                             [[[77.60, 12.99], [77.61, 12.99], [77.61, 13.00], [77.60, 12.99]]]]}},
        {"type": "Feature", "properties": {"WARD": "Ward 89 Test"},
         "geometry": {"type": "Polygon", "coordinates": [[[77.51, 12.91], [77.52, 12.91], [77.52, 12.92], [77.51, 12.91]]]}},
        {"type": "Feature", "properties": {"WARD": ""}, "geometry": None},
    ]}
    path = tmp_path / "wards.geojson"
    path.write_text(json.dumps(gj))
    with SessionLocal() as db:
        r = geo_import.import_localities(db, path, name_field="WARD", source="Test ward map 2026",
                                         population_field="POP", population_source="Test census")
    assert (r.created, r.skipped) == (2, 1)

    issue = client.get(f"/api/issues/{tid}").json()
    assert issue["locality"]["name"] == "Ward 88 Test"  # smaller containing area wins over "Testpur"
    stats = client.get(f"/api/localities/{issue['locality']['id']}/stats").json()
    assert stats["locality"]["is_approximate"] is False
    assert stats["locality"]["boundary_source"] == "Test ward map 2026"
    assert stats["locality"]["population"] == 41250
    feats = {f["properties"]["name"]: f for f in client.get("/api/map/localities").json()["features"]}
    assert feats["Ward 88 Test"]["geometry"]["type"] == "MultiPolygon"

    with SessionLocal() as db:  # clean up so other tests see the original locality
        db.execute(delete(Locality).where(Locality.name.in_(["Ward 88 Test", "Ward 89 Test"])))
        geo_import.relink_issues(db)
        db.commit()
        assert db.scalar(select(Locality).where(Locality.name == "Testpur")) is not None


def test_import_facilities_feeds_priority(client, h, make_issue, tmp_path):
    import json
    from app.database.session import SessionLocal
    from app.services import geo_import

    overpass = {"elements": [
        {"type": "node", "id": 1, "lat": 12.9801, "lon": 77.6201, "tags": {"amenity": "school", "name": "Govt Primary School"}},
        {"type": "way", "id": 2, "center": {"lat": 12.99, "lon": 77.63}, "tags": {"amenity": "hospital", "name": "City Hospital"}},
        {"type": "node", "id": 3, "lat": 12.98, "lon": 77.62, "tags": {"amenity": "clinic"}},  # unnamed → skipped
    ]}
    gj = geo_import.overpass_to_geojson(overpass)
    assert [f["properties"]["name"] for f in gj["features"]] == ["Govt Primary School", "City Hospital"]
    assert 'amenity"~"^(' in geo_import.overpass_query(12.97, 77.6, 5000, ["school"])

    path = tmp_path / "fac.geojson"
    path.write_text(json.dumps(gj))
    with SessionLocal() as db:
        r = geo_import.import_facilities(db, path, name_field="name", kind_field="amenity", source="OSM test")
    assert r.created == 2

    iid = make_issue(lat=12.9803, lng=77.6203)["id"]  # ~30 m from the school
    detail = client.post(f"/api/admin/issues/{iid}/ai/refresh", headers=h["admin"]).json()
    reasons = {x["factor"]: x for x in detail["ai"]["priority"]["output"]["reasons"]}
    assert reasons["Vulnerable location"]["points"] == 15
    assert "Govt Primary School" in reasons["Vulnerable location"]["detail"]


def test_import_cli_help():
    import subprocess, sys
    from pathlib import Path
    out = subprocess.run([sys.executable, "-m", "scripts.import_geo", "--help"], capture_output=True, text=True,
                         cwd=Path(__file__).resolve().parents[1])
    assert out.returncode == 0 and "facilities-osm" in out.stdout


# ---------------------------------------------------------------- "Get updates on this report" (no account)
def test_email_subscription_double_opt_in(client, h, make_issue):
    import re
    shutil.rmtree(_outbox(), ignore_errors=True)
    iid = make_issue()["id"]
    assert client.post(f"/api/issues/{iid}/subscribe", json={"email": "Neighbour@Example.com", "consent": False}).status_code == 422
    r = client.post(f"/api/issues/{iid}/subscribe", json={"email": "Neighbour@Example.com", "consent": True})
    assert r.status_code == 202
    confirm_mail = _mails_to("neighbour@example.com")
    assert len(confirm_mail) == 1 and "Confirm updates" in confirm_mail[0]["Subject"]
    token = re.search(r"/updates/confirm/([\w-]+)", confirm_mail[0].get_body(("plain",)).get_content()).group(1)

    # not confirmed yet → no update emails
    client.post(f"/api/admin/issues/{iid}/transition", headers=h["admin"], json={"to_status": "pending_verification"})
    assert len(_mails_to("neighbour@example.com")) == 1

    assert client.post(f"/api/subscriptions/{token}/confirm").json()["ok"]
    client.post(f"/api/admin/issues/{iid}/verify", headers=h["admin"], json={"priority": "low"})
    mails = _mails_to("neighbour@example.com")
    update = next(m for m in mails if "verified" in m["Subject"])
    assert f"/updates/unsubscribe/{token}" in update.get_body(("plain",)).get_content()

    assert client.post(f"/api/subscriptions/{token}/unsubscribe").json()["ok"]
    assert client.post(f"/api/subscriptions/{token}/unsubscribe").status_code == 404
    n = len(_mails_to("neighbour@example.com"))
    client.post(f"/api/admin/issues/{iid}/official-update", headers=h["admin"], json={"body": "Crew booked for Friday."})
    assert len(_mails_to("neighbour@example.com")) == n
