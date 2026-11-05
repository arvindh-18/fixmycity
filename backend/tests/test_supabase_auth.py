import base64
import hashlib
import hmac
import io
import json
import os
import sys
import time
from pathlib import Path

# Setup test environment before importing app
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "sqlite:///./test.db")
os.environ["SUPABASE_URL"] = "https://testproject.supabase.co"
os.environ["SUPABASE_ANON_KEY"] = "test-anon-key"
os.environ["GEMINI_API_KEY"] = "test-key"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
import jwt  # noqa: E402
import pytest  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402
from cryptography.hazmat.primitives import serialization  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from app import auth, geocode  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import Base, Issue, LegacyUid, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from scripts.import_legacy_uids import main as run_import  # noqa: E402

# Generate EC P-256 key pair for test token signing
_EC_PRIVATE_KEY = ec.generate_private_key(ec.SECP256R1())
_EC_PUBLIC_KEY = _EC_PRIVATE_KEY.public_key()
_PUBLIC_PEM = _EC_PUBLIC_KEY.public_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PublicFormat.SubjectPublicKeyInfo,
).decode("utf-8")


class DummySigningKey:
    def __init__(self, key):
        self.key = key


class MockJWKSClient:
    uri = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"

    def __init__(self, key=_EC_PUBLIC_KEY):
        self._key = key

    def get_signing_key_from_jwt(self, token: str):
        return DummySigningKey(self._key)


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def make_token(
    sub: str = "sub-test-123",
    email: str = "citizen@example.com",
    role: str = "authenticated",
    aud: str = "authenticated",
    iss: str | None = None,
    exp: int | None = None,
    alg: str = "ES256",
    key=None,
    user_metadata: dict | None = None,
    extra_headers: dict | None = None,
    extra_claims: dict | None = None,
) -> str:
    now = int(time.time())
    payload = {
        "sub": sub,
        "email": email,
        "role": role,
        "aud": aud,
        "iss": iss or f"{settings.supabase_url}/auth/v1",
        "exp": exp if exp is not None else (now + 3600),
    }
    if user_metadata is not None:
        payload["user_metadata"] = user_metadata
    if extra_claims:
        payload.update(extra_claims)

    headers = {"alg": alg, "kid": "test-kid"}
    if extra_headers:
        headers.update(extra_headers)

    if alg == "none":
        return f"{b64url(json.dumps(headers).encode())}.{b64url(json.dumps(payload).encode())}."
    return jwt.encode(payload, key or _EC_PRIVATE_KEY, algorithm=alg, headers=headers)


@pytest.fixture(autouse=True)
def fresh_db(monkeypatch):
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(
        geocode,
        "_reverse",
        lambda lat, lng: {
            "address": "Pondy Bazaar, T. Nagar",
            "locality": "T. Nagar",
            "pincode": "600017",
            "city": "Chennai",
        },
    )
    # Clear memory cache in auth module
    auth._token_cache.clear()
    auth._jwks_client = MockJWKSClient()
    monkeypatch.setattr(auth, "_get_jwks_client", lambda: MockJWKSClient())
    # Default settings attributes
    monkeypatch.setattr(settings, "supabase_url", "https://testproject.supabase.co")
    monkeypatch.setattr(settings, "supabase_anon_key", "test-anon-key")
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "admin_emails", {"admin@example.com"})
    monkeypatch.setattr(settings, "worker_emails", {"worker@example.com"})
    yield


client = TestClient(app)


def test_1_valid_es256_token(monkeypatch):
    """1. Valid ES256 token -> /api/me 200 with correct uid, name, email and role."""
    token = make_token(
        sub="supa-1234",
        email="resident@example.com",
        user_metadata={"full_name": "Radha Krishnan", "email_verified": True},
    )
    resp = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["uid"] == "supa-1234"
    assert data["name"] == "Radha Krishnan"
    assert data["email"] == "resident@example.com"
    assert data["role"] == "public"
    assert data["is_admin"] is False


def test_2_rejected_tokens(monkeypatch):
    """2. Rejected with 401: expired, wrong aud, wrong iss, tampered, alg: none,
    HS256 signed with public key text, anon-role token, missing sub."""
    now = int(time.time())

    # Expired token (outside 60s clock skew)
    exp_token = make_token(exp=now - 120)
    assert client.get("/api/me", headers={"Authorization": f"Bearer {exp_token}"}).status_code == 401

    # Wrong audience
    aud_token = make_token(aud="not-authenticated")
    assert client.get("/api/me", headers={"Authorization": f"Bearer {aud_token}"}).status_code == 401

    # Wrong issuer
    iss_token = make_token(iss="https://attacker.supabase.co/auth/v1")
    assert client.get("/api/me", headers={"Authorization": f"Bearer {iss_token}"}).status_code == 401

    # Tampered signature
    valid_token = make_token()
    tampered_token = valid_token[:-4] + "xxxx"
    assert client.get("/api/me", headers={"Authorization": f"Bearer {tampered_token}"}).status_code == 401

    # alg: none
    none_token = make_token(alg="none")
    assert client.get("/api/me", headers={"Authorization": f"Bearer {none_token}"}).status_code == 401

    # HS256 signed with public key text (algorithm-confusion attack): goes to Auth server check which rejects with 401
    hs_header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    hs_payload = b64url(
        json.dumps(
            {"sub": "hs-user", "email": "hs@example.com", "role": "authenticated", "aud": "authenticated"}
        ).encode()
    )
    hs_signing_input = f"{hs_header}.{hs_payload}".encode("utf-8")
    hs_sig = b64url(hmac.new(_PUBLIC_PEM.encode("utf-8"), hs_signing_input, hashlib.sha256).digest())
    hs_token = f"{hs_header}.{hs_payload}.{hs_sig}"

    # Mock httpx to simulate Auth server rejecting invalid HS256 signature
    def mock_httpx_reject(url, headers, timeout):
        req = httpx.Request("GET", url)
        return httpx.Response(401, json={"message": "Invalid JWT"}, request=req)

    monkeypatch.setattr(httpx, "get", mock_httpx_reject)
    assert client.get("/api/me", headers={"Authorization": f"Bearer {hs_token}"}).status_code == 401

    # Anon-role token (e.g. Supabase anon key used as bearer)
    anon_token = make_token(role="anon")
    assert client.get("/api/me", headers={"Authorization": f"Bearer {anon_token}"}).status_code == 401

    # Missing sub claim
    no_sub_payload = {
        "email": "nosub@example.com",
        "role": "authenticated",
        "aud": "authenticated",
        "iss": f"{settings.supabase_url}/auth/v1",
        "exp": now + 3600,
    }
    no_sub_token = jwt.encode(no_sub_payload, _EC_PRIVATE_KEY, algorithm="ES256", headers={"kid": "test-kid"})
    assert client.get("/api/me", headers={"Authorization": f"Bearer {no_sub_token}"}).status_code == 401


def test_3_hs256_auth_server_check(monkeypatch):
    """3. HS256 token -> accepted only when monkeypatched Auth-server says valid; 401 when invalid; 503 when errors."""
    hs_token = jwt.encode(
        {"sub": "hs-123", "email": "hs@example.com", "role": "authenticated", "aud": "authenticated"},
        "some-32-byte-secret-key-for-testing-hs256",
        algorithm="HS256",
    )

    # 1. Valid Auth server response (200)
    def mock_auth_ok(url, headers, timeout):
        req = httpx.Request("GET", url)
        return httpx.Response(
            200,
            json={
                "id": "hs-123",
                "email": "hs@example.com",
                "role": "authenticated",
                "email_confirmed_at": "2026-11-05T00:00:00Z",
                "user_metadata": {"full_name": "HS User"},
            },
            request=req,
        )

    monkeypatch.setattr(httpx, "get", mock_auth_ok)
    auth._token_cache.clear()
    resp = client.get("/api/me", headers={"Authorization": f"Bearer {hs_token}"})
    assert resp.status_code == 200
    assert resp.json()["uid"] == "hs-123"
    assert resp.json()["name"] == "HS User"

    # 2. Invalid Auth server response (401)
    def mock_auth_invalid(url, headers, timeout):
        req = httpx.Request("GET", url)
        return httpx.Response(401, json={"message": "invalid JWT"}, request=req)

    monkeypatch.setattr(httpx, "get", mock_auth_invalid)
    auth._token_cache.clear()
    resp = client.get("/api/me", headers={"Authorization": f"Bearer {hs_token}"})
    assert resp.status_code == 401

    # 3. Auth server errors (network error -> 503)
    def mock_auth_error(url, headers, timeout):
        raise httpx.ConnectError("Network down")

    monkeypatch.setattr(httpx, "get", mock_auth_error)
    auth._token_cache.clear()
    resp = client.get("/api/me", headers={"Authorization": f"Bearer {hs_token}"})
    assert resp.status_code == 503


def test_4_es256_jwks_unreachable_fallback(monkeypatch):
    """4. ES256 token with JWKS unreachable -> falls back to Auth-server check."""
    token = make_token(sub="fallback-user", email="fallback@example.com")

    # Make JWKS client raise error
    class BrokenJWKS:
        uri = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"

        def get_signing_key_from_jwt(self, token):
            raise jwt.PyJWKClientError("JWKS unreachable")

    monkeypatch.setattr(auth, "_get_jwks_client", lambda: BrokenJWKS())

    # Mock Auth server responding with 200
    def mock_auth_ok(url, headers, timeout):
        req = httpx.Request("GET", url)
        return httpx.Response(
            200,
            json={
                "id": "fallback-user",
                "email": "fallback@example.com",
                "role": "authenticated",
                "email_confirmed_at": "2026-11-05T00:00:00Z",
                "user_metadata": {"full_name": "Fallback User"},
            },
            request=req,
        )

    monkeypatch.setattr(httpx, "get", mock_auth_ok)
    auth._token_cache.clear()

    resp = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["uid"] == "fallback-user"
    assert resp.json()["name"] == "Fallback User"


def test_5_email_verification_gate_for_staff(monkeypatch):
    """5. Admin email with email_verified: false -> role public; with true -> admin."""
    # With email_verified: false
    token_unverified = make_token(
        sub="admin-sub",
        email="admin@example.com",
        user_metadata={"full_name": "Admin Person", "email_verified": False},
    )
    resp = client.get("/api/me", headers={"Authorization": f"Bearer {token_unverified}"})
    assert resp.status_code == 200
    assert resp.json()["role"] == "public"
    assert resp.json()["is_admin"] is False

    # With email_verified: true
    auth._token_cache.clear()
    token_verified = make_token(
        sub="admin-sub",
        email="admin@example.com",
        user_metadata={"full_name": "Admin Person", "email_verified": True},
    )
    resp2 = client.get("/api/me", headers={"Authorization": f"Bearer {token_verified}"})
    assert resp2.status_code == 200
    assert resp2.json()["role"] == "admin"
    assert resp2.json()["is_admin"] is True


def test_6_legacy_uid_mapping():
    """6. Legacy mapping: insert a LegacyUid row, create an issue whose reporter_uid is that old uid,
    then sign in with matching verified email -> /api/me returns old uid and /api/issues?mine=1 includes it.
    Without mapping Supabase sub is used. With unverified email mapping is NOT applied."""
    with SessionLocal() as db:
        db.add(LegacyUid(email="legacy@example.com", uid="legacy-old-123"))
        db.add(
            Issue(
                title="Pothole in T. Nagar",
                category="pothole",
                lat=13.08,
                lng=80.27,
                reporter_uid="legacy-old-123",
                reporter_name="Legacy User",
            )
        )
        db.commit()

    # 1. Verified email -> gets old uid and sees their issue in mine=1
    token_verified = make_token(
        sub="supa-new-456",
        email="legacy@example.com",
        user_metadata={"full_name": "Legacy User", "email_verified": True},
    )
    auth._token_cache.clear()
    resp = client.get("/api/me", headers={"Authorization": f"Bearer {token_verified}"})
    assert resp.status_code == 200
    assert resp.json()["uid"] == "legacy-old-123"

    mine_resp = client.get("/api/issues?mine=1", headers={"Authorization": f"Bearer {token_verified}"})
    assert mine_resp.status_code == 200
    assert len(mine_resp.json()) == 1
    assert mine_resp.json()[0]["title"] == "Pothole in T. Nagar"

    # 2. User without legacy mapping -> gets Supabase sub
    token_new_user = make_token(
        sub="supa-brand-new",
        email="fresh@example.com",
        user_metadata={"email_verified": True},
    )
    auth._token_cache.clear()
    resp_new = client.get("/api/me", headers={"Authorization": f"Bearer {token_new_user}"})
    assert resp_new.status_code == 200
    assert resp_new.json()["uid"] == "supa-brand-new"

    # 3. Unverified email matching legacy -> mapping is NOT applied
    token_unverified = make_token(
        sub="supa-attacker",
        email="legacy@example.com",
        user_metadata={"email_verified": False},
    )
    auth._token_cache.clear()
    resp_unver = client.get("/api/me", headers={"Authorization": f"Bearer {token_unverified}"})
    assert resp_unver.status_code == 200
    assert resp_unver.json()["uid"] == "supa-attacker"


def test_7_production_mode_and_dev_token_rejection(monkeypatch):
    """7. ENVIRONMENT=production without Supabase config: /api/config says none,
    protected routes return 503/401, and dev: tokens are rejected.
    With Supabase configured, dev: tokens are rejected."""
    # Part A: production without Supabase config
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "supabase_url", "")
    monkeypatch.setattr(settings, "supabase_anon_key", "")

    cfg = client.get("/api/config").json()
    assert cfg["auth_mode"] == "none"

    # Dev token rejected
    dev_header = {"Authorization": "Bearer dev:meera:Meera:0"}
    resp = client.get("/api/me", headers=dev_header)
    assert resp.status_code in (401, 503)

    # Part B: with Supabase configured, dev: tokens are rejected
    monkeypatch.setattr(settings, "supabase_url", "https://testproject.supabase.co")
    monkeypatch.setattr(settings, "supabase_anon_key", "test-anon-key")
    auth._token_cache.clear()

    resp_supa_configured = client.get("/api/me", headers=dev_header)
    # dev: tokens cannot be parsed as valid JWTs, so rejected with 401
    assert resp_supa_configured.status_code == 401


def test_8_import_legacy_uids_cli(tmp_path):
    """8. import_legacy_uids.py (call its main function): inserts, is idempotent on a second run, honours --dry-run."""
    users_data = {
        "users": [
            {"localId": "uid-101", "email": "user1@example.com"},
            {"localId": "uid-102", "email": "USER2@example.COM"},
            {"localId": "uid-skip", "email": ""},
            {"localId": "uid-103", "email": "user3@example.com"},
        ]
    }
    json_file = tmp_path / "users.json"
    json_file.write_text(json.dumps(users_data), encoding="utf-8")

    # 1. Test --dry-run: writes nothing
    ins, upd, skp = run_import([str(json_file), "--dry-run"])
    assert ins == 3
    assert skp == 1
    with SessionLocal() as db:
        assert db.get(LegacyUid, "user1@example.com") is None

    # 2. Test normal run: inserts 3 rows
    ins2, upd2, skp2 = run_import([str(json_file)])
    assert ins2 == 3
    assert skp2 == 1
    with SessionLocal() as db:
        u1 = db.get(LegacyUid, "user1@example.com")
        assert u1 is not None and u1.uid == "uid-101"
        u2 = db.get(LegacyUid, "user2@example.com")
        assert u2 is not None and u2.uid == "uid-102"

    # 3. Test idempotency: second run does not insert duplicates
    ins3, upd3, skp3 = run_import([str(json_file)])
    assert ins3 == 0
    assert upd3 == 0
    assert skp3 == 4
