"""End-to-end workflow tests: the four user journeys from the brief plus the rules that protect them."""
from __future__ import annotations

from sqlalchemy import text

from app.database.session import engine
from app.services.lifecycle import TRANSITIONS
from tests.conftest import jpeg


def _workers(client, h):
    return {w["email"]: w["id"] for w in client.get("/api/admin/workers", headers=h["admin"]).json()}


# ---------------------------------------------------------------- authentication
def test_register_login_me(client):
    r = client.post("/api/auth/register", json={"email": "New@T.demo", "password": "abc12345", "full_name": "New Person"})
    assert r.status_code == 201
    assert r.json()["user"]["role"] == "citizen"
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"})
    assert me.json()["email"] == "new@t.demo"
    assert client.post("/api/auth/register", json={"email": "new@t.demo", "password": "abc12345", "full_name": "Dup"}).status_code == 409
    assert client.post("/api/auth/login", json={"email": "new@t.demo", "password": "wrong999"}).status_code == 401


def test_weak_password_rejected(client):
    r = client.post("/api/auth/register", json={"email": "w@t.demo", "password": "12345678", "full_name": "Weak"})
    assert r.status_code == 422


def test_bad_token_rejected(client):
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer nonsense"}).status_code == 401


# ---------------------------------------------------------------- role permissions
def test_citizen_cannot_use_admin_or_worker_api(client, h):
    assert client.get("/api/admin/issues", headers=h["cit"]).status_code == 403
    assert client.get("/api/worker/tasks", headers=h["cit"]).status_code == 403
    assert client.get("/api/admin/audit", headers=h["w1"]).status_code == 403
    assert client.get("/api/admin/issues").status_code == 401


def test_staff_cannot_file_citizen_reports(make_issue, h, client, meta):
    cat = meta["categories"][0]["id"]
    r = client.post("/api/issues", headers=h["w1"], data={"title": "Worker report", "description": "x" * 20,
                                                          "category_id": cat, "lat": 12.97, "lng": 77.6})
    assert r.status_code == 403


# ---------------------------------------------------------------- citizen + admin + worker journey
def test_full_lifecycle(client, h, make_issue):
    created = make_issue(photos=1)
    tid, iid = created["tracking_id"], created["id"]
    assert tid.startswith("CM-")
    assert created["issue"]["status"] == "submitted"
    assert created["issue"]["locality"]["name"] == "Testpur"
    assert len(created["issue"]["images"]) == 1

    # AI suggestions stored for the admin
    detail = client.get(f"/api/admin/issues/{tid}", headers=h["admin"]).json()
    assert detail["ai"]["classification"]["output"]["category_slug"] == "roads-potholes"
    assert "priority" in detail["ai"]
    assert "verified" in detail["allowed_transitions"]

    # verify → SLA deadline set, routed to the category's department
    r = client.post(f"/api/admin/issues/{iid}/verify", headers=h["admin"], json={"priority": "high"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "verified" and d["department"]["name"] == "Roads"
    assert d["sla"]["due_at"] is not None and d["sla"]["state"] == "on_track"

    workers = _workers(client, h)
    # cannot assign a worker from another department
    bad = client.post(f"/api/admin/issues/{iid}/assign", headers=h["admin"], json={"worker_id": workers["ww@t.demo"]})
    assert bad.status_code == 422
    r = client.post(f"/api/admin/issues/{iid}/assign", headers=h["admin"],
                    json={"worker_id": workers["w1@t.demo"], "instructions": "Barricade first"})
    assert r.json()["status"] == "assigned"

    # an unrelated worker can't see or act on it
    assert client.get(f"/api/worker/tasks/{iid}", headers=h["w2"]).status_code == 403
    assert client.post(f"/api/worker/tasks/{iid}/start", headers=h["w2"]).status_code == 403

    # assigned worker: acknowledge → start → update → complete
    assert client.post(f"/api/worker/tasks/{iid}/acknowledge", headers=h["w1"]).json()["assignment"]["acknowledged_at"]
    assert client.post(f"/api/worker/tasks/{iid}/start", headers=h["w1"]).json()["status"] == "in_progress"
    up = client.post(f"/api/worker/tasks/{iid}/updates", headers=h["w1"], data={"kind": "progress", "body": "BT mix arriving, area barricaded"})
    assert up.status_code == 201 and up.json()["public_summary"].startswith("Work update")
    # completion without an 'after' photo is refused
    no_photo = client.post(f"/api/worker/tasks/{iid}/complete", headers=h["w1"], data={"description": "Filled and compacted the pothole."})
    assert no_photo.status_code == 422
    done = client.post(f"/api/worker/tasks/{iid}/complete", headers=h["w1"],
                       data={"description": "Filled and compacted the pothole."},
                       files=[("before", ("b.jpg", jpeg(), "image/jpeg")), ("after", ("a.jpg", jpeg((60, 120, 90)), "image/jpeg"))])
    assert done.status_code == 200, done.text
    assert done.json()["status"] == "awaiting_verification"

    # the worker can never resolve
    assert TRANSITIONS.get(("awaiting_verification", "resolved")) == {"admin", "reporter"}

    # public timeline shows the trail but not the internal note until approved
    tl = client.get(f"/api/issues/{tid}/timeline").json()
    titles = [i["title"] for i in tl]
    assert "Verified and routed" in titles and "Before-and-after photos sent" in titles
    assert not any(i["type"] == "update" and i["kind"] == "progress" for i in tl)
    summaries = client.get("/api/admin/summaries", headers=h["admin"]).json()
    s = next(x for x in summaries if x["issue"]["tracking_id"] == tid)
    client.post(f"/api/admin/updates/{s['id']}/summary", headers=h["admin"], json={"approve": True})
    tl = client.get(f"/api/issues/{tid}/timeline").json()
    assert any(i["type"] == "update" and i["kind"] == "progress" for i in tl)

    # another citizen can't confirm someone else's report
    assert client.post(f"/api/issues/{iid}/confirm", headers=h["cit2"], json={"rating": 5}).status_code == 403
    # reporter disputes → reopened
    r = client.post(f"/api/issues/{iid}/dispute", headers=h["cit"], json={"reason": "Edges are already crumbling again."})
    assert r.json()["status"] == "reopened"
    # admin reassigns, worker redoes, reporter confirms
    client.post(f"/api/admin/issues/{iid}/assign", headers=h["admin"], json={"worker_id": workers["w1@t.demo"]})
    client.post(f"/api/worker/tasks/{iid}/start", headers=h["w1"])
    client.post(f"/api/worker/tasks/{iid}/complete", headers=h["w1"], data={"description": "Redone with proper edge sealing."},
                files=[("after", ("a.jpg", jpeg(), "image/jpeg"))])
    r = client.post(f"/api/issues/{iid}/confirm", headers=h["cit"], json={"rating": 4, "comment": "Fixed now"})
    assert r.json()["status"] == "resolved"

    # PDF export works and is labelled correctly
    pdf = client.get(f"/api/issues/{tid}/export.pdf")
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"

    # audit log captured the whole chain
    audit = client.get(f"/api/admin/audit?issue={tid}", headers=h["admin"]).json()
    actions = [a["action"] for a in audit["items"]]
    assert actions.count("issue.status_changed") >= 8
    assert "evidence.submitted" in actions and "issue.assigned" in actions


def test_invalid_transitions_rejected(client, h, make_issue):
    iid = make_issue()["id"]
    # can't jump straight to resolved, and the generic endpoint can't bypass verify/assign
    assert client.post(f"/api/admin/issues/{iid}/transition", headers=h["admin"], json={"to_status": "resolved"}).status_code in (409, 422)
    assert client.post(f"/api/admin/issues/{iid}/transition", headers=h["admin"], json={"to_status": "assigned"}).status_code == 422
    # reasons are mandatory for rejection
    assert client.post(f"/api/admin/issues/{iid}/reject", headers=h["admin"], json={"reason": ""}).status_code == 422
    r = client.post(f"/api/admin/issues/{iid}/reject", headers=h["admin"], json={"reason": "Outside city limits"})
    assert r.json()["status"] == "rejected"
    # worker can't start an issue they aren't assigned to
    assert client.post(f"/api/worker/tasks/{iid}/start", headers=h["w1"]).status_code == 403


def test_department_admin_scope(client, h, make_issue):
    iid = make_issue()["id"]
    client.post(f"/api/admin/issues/{iid}/verify", headers=h["admin"], json={"priority": "low"})  # → Roads
    r = client.post(f"/api/admin/issues/{iid}/transition", headers=h["water_admin"], json={"to_status": "on_hold", "reason": "x"})
    assert r.status_code == 403


# ---------------------------------------------------------------- transparency
def test_audit_and_history_are_append_only(client, make_issue):
    make_issue()
    for table in ("audit_logs", "issue_status_history"):
        for stmt in (f"UPDATE {table} SET reason = 'tampered'", f"DELETE FROM {table}"):
            try:
                with engine.begin() as conn:
                    conn.execute(text(stmt))
                raise AssertionError(f"{stmt} should have failed")
            except Exception as exc:  # noqa: BLE001
                assert "append-only" in str(exc)


def test_public_views_hide_private_data(client, h, make_issue):
    tid = make_issue()["tracking_id"]
    pub = client.get(f"/api/issues/{tid}").json()
    blob = str(pub)
    assert "cit@t.demo" not in blob and "reporter_id" not in blob
    assert pub["reporter_name"] == "Asha C."
    admin_view = client.get(f"/api/admin/issues/{tid}", headers=h["admin"]).json()
    assert admin_view["reporter"]["email"] == "cit@t.demo"


def test_anonymous_reporting_and_tracking(client, make_issue):
    res = make_issue(headers={})
    assert res["anonymous_token"] and res["issue"]["is_anonymous"]
    ok = client.post("/api/track", json={"tracking_id": res["tracking_id"], "token": res["anonymous_token"]})
    assert ok.status_code == 200
    bad = client.post("/api/track", json={"tracking_id": res["tracking_id"], "token": "x" * 20})
    assert bad.status_code == 403


def test_stats_are_live(client, make_issue):
    before = client.get("/api/stats/overview").json()["total"]
    make_issue()
    after = client.get("/api/stats/overview").json()
    assert after["total"] == before + 1
    assert after["demo_rows"] == 0
    assert isinstance(client.get("/api/stats/departments").json()[0]["sample_size"], int)


def test_sla_escalation_job(client, h, make_issue):
    from datetime import datetime, timedelta, timezone
    from app.database.session import SessionLocal
    from app.services import escalation
    iid = make_issue()["id"]
    client.post(f"/api/admin/issues/{iid}/verify", headers=h["admin"], json={"priority": "critical"})
    with SessionLocal() as db:
        res = escalation.run_once(db, now=datetime.now(timezone.utc) + timedelta(hours=30))
    assert res["flagged"] >= 1
    notes = client.get("/api/notifications", headers=h["admin"]).json()["items"]
    assert any(n["kind"] == "escalation" for n in notes)


def test_issue_without_sla_rule_is_never_overdue(client, make_issue):
    tid = make_issue()["tracking_id"]
    sla = client.get(f"/api/issues/{tid}").json()["sla"]
    assert sla["state"] == "none" and sla["due_at"] is None


# ---------------------------------------------------------------- community
def test_support_is_one_per_account(client, h, make_issue):
    iid = make_issue()["id"]
    assert client.post(f"/api/issues/{iid}/support", headers=h["cit2"]).json()["support_count"] == 1
    assert client.post(f"/api/issues/{iid}/support", headers=h["cit2"]).status_code == 409
    assert client.post(f"/api/issues/{iid}/support", headers=h["cit"]).status_code == 409  # reporter


def test_duplicate_detection(client, make_issue, meta):
    make_issue(title="Water pipe leaking at junction", desc="Clean water leaking from a burst pipe at the junction.",
               slug="water-supply", lat=12.9501, lng=77.6501)
    cat = next(c for c in meta["categories"] if c["slug"] == "water-supply")
    r = client.post("/api/issues/check-duplicates", json={"title": "Pipe leak", "description": "water pipe leaking near junction",
                                                          "category_id": cat["id"], "lat": 12.9502, "lng": 77.6502})
    top = r.json()[0]
    assert top["distance_m"] < 50 and top["signals"]["same_category"]
    far = client.post("/api/issues/check-duplicates", json={"title": "Pipe leak", "description": "water", "category_id": cat["id"],
                                                            "lat": 12.80, "lng": 77.40})
    assert far.json() == []


def test_comments_report_and_moderation(client, h, make_issue):
    iid = make_issue()["id"]
    c = client.post(f"/api/issues/{iid}/comments", headers=h["cit2"], data={"body": "Same here"}).json()
    reply = client.post(f"/api/issues/{iid}/comments", headers=h["cit"], data={"body": "Thanks", "parent_id": c["id"]})
    assert reply.status_code == 201
    assert client.post(f"/api/issues/{iid}/comments", headers=h["cit"], data={"body": "you idiot"}).status_code == 422
    assert client.get(f"/api/issues/{iid}/comments").json()[0]["replies"][0]["body"] == "Thanks"
    client.post(f"/api/comments/{c['id']}/report", headers=h["cit"], json={"reason": "spam"})
    assert client.post(f"/api/comments/{c['id']}/report", headers=h["cit"], json={"reason": "spam"}).status_code == 409
    r = client.post(f"/api/admin/comments/{c['id']}/moderate", headers=h["admin"], json={"hide": True, "reason": "Off-topic"})
    assert r.status_code == 200
    assert client.get(f"/api/issues/{iid}/comments").json()[0]["body"] is None


# ---------------------------------------------------------------- messaging + notifications
def test_private_messaging(client, h, make_issue):
    iid = make_issue()["id"]
    conv = client.post("/api/conversations", headers=h["cit"], json={"issue_id": iid, "kind": "citizen_admin",
                                                                     "first_message": "When will this be fixed?"})
    assert conv.status_code == 201, conv.text
    cid = conv.json()["id"]
    assert client.get(f"/api/conversations/{cid}/messages", headers=h["cit2"]).status_code == 403
    admin_list = client.get("/api/conversations", headers=h["admin"]).json()
    assert any(c["id"] == cid and c["unread"] == 1 for c in admin_list)
    client.post(f"/api/conversations/{cid}/messages", headers=h["admin"], data={"body": "This week."})
    msgs = client.get(f"/api/conversations/{cid}/messages", headers=h["cit"]).json()["messages"]
    assert [m["body"] for m in msgs] == ["When will this be fixed?", "This week."]
    # a citizen can't open a worker conversation
    assert client.post("/api/conversations", headers=h["cit"], json={"issue_id": iid, "kind": "admin_worker",
                                                                     "first_message": "hi"}).status_code == 403


def test_notifications_for_status_change(client, h, make_issue):
    iid = make_issue()["id"]
    client.post(f"/api/admin/issues/{iid}/verify", headers=h["admin"], json={"priority": "medium"})
    items = client.get("/api/notifications", headers=h["cit"]).json()["items"]
    assert any(n["kind"] == "status_changed" and "verified" in n["title"] for n in items)
    client.post("/api/notifications/read-all", headers=h["cit"])
    assert client.get("/api/notifications", headers=h["cit"]).json()["unread"] == 0


def test_websocket_requires_token(client):
    import pytest
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws?token=bad") as ws:
            ws.receive_json()


def test_websocket_receives_notification(client, h, make_issue):
    token = h["cit"]["Authorization"].split()[1]
    iid = make_issue()["id"]
    with client.websocket_connect(f"/ws?token={token}") as ws:
        assert ws.receive_json()["type"] == "hello"
        client.post(f"/api/admin/issues/{iid}/verify", headers=h["admin"], json={"priority": "low"})
        kinds = {ws.receive_json()["type"] for _ in range(2)}
        assert "notification" in kinds


# ---------------------------------------------------------------- uploads, map, AI
def test_upload_validation(client, h, meta):
    cat = meta["categories"][0]["id"]
    r = client.post("/api/issues", headers=h["cit"], data={"title": "Fake image test", "description": "x" * 20, "category_id": cat,
                                                         "lat": 12.97, "lng": 77.6},
                    files=[("photos", ("evil.jpg", b"<?php echo 1; ?>", "image/jpeg"))])
    assert r.status_code == 422
    r = client.post("/api/issues", headers=h["cit"], data={"title": "Wrong type test", "description": "x" * 20, "category_id": cat,
                                                         "lat": 12.97, "lng": 77.6},
                    files=[("photos", ("a.gif", b"GIF89a", "image/gif"))])
    assert r.status_code == 415


def test_map_filters(client, make_issue, meta):
    make_issue(slug="water-supply", title="Water leak test", desc="Leaking water pipe on the corner today.")
    water = next(c for c in meta["categories"] if c["slug"] == "water-supply")["id"]
    fc = client.get(f"/api/map/issues?category={water}").json()
    assert fc["type"] == "FeatureCollection" and fc["features"]
    assert all(f["properties"]["category_slug"] == "water-supply" for f in fc["features"])
    assert all(f["properties"]["status"] == "submitted" for f in client.get("/api/map/issues?status=submitted").json()["features"])
    assert client.get("/api/map/localities").json()["features"][0]["properties"]["name"] == "Testpur"


def test_ai_fallback_and_assistant(client, h):
    st = client.get("/api/ai/status").json()
    assert st["mode"] == "rules" and "Demonstration" in st["note"]
    c = client.post("/api/ai/classify", json={"title": "Pothole", "description": "Huge pothole on the main road"}).json()
    assert c["category_slug"] == "roads-potholes" and 0 < c["confidence"] <= 0.9
    a = client.post("/api/ai/assistant", json={"question": "Which department handles water leakage?"}).json()
    assert "Water" in a["answer"] and a["mode"] == "rules"
    mine = client.post("/api/ai/assistant", headers=h["cit"], json={"question": "Why is my complaint still pending?"}).json()
    assert mine["intent"] == "my_issues" and "CM-" in mine["answer"]
    anon = client.post("/api/ai/assistant", json={"question": "Why is my complaint still pending?"}).json()
    assert "Sign in" in anon["answer"]
