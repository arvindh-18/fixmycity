"""Firebase Authentication + roles.

The frontend signs in with Firebase and sends the ID token as `Authorization: Bearer <token>`.
We verify it against Google's public certificates, so the backend needs only FIREBASE_PROJECT_ID —
no service-account file.

Roles: `public` (residents), `worker` (field servicemen) and `admin` (city staff).
A user's role comes from ADMIN_EMAILS / WORKER_EMAILS, or from the staff list admins manage in the app.

Without Firebase configured (local dev only) tokens look like `dev:<uid>:<name>:<role>` where role is
`0`/`public`, `w`/`worker` or `1`/`admin`.
"""
import time
from dataclasses import dataclass

import httpx
from fastapi import Depends, Header, HTTPException
from google.auth import jwt as google_jwt
from sqlalchemy import select

from .config import settings
from .db import SessionLocal, StaffMember

CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
_certs: dict = {"keys": {}, "expires": 0.0}

# A fresh Firebase token is stamped with Google's clock. If this server's clock is even a second behind,
# google-auth (default skew 0) rejects it as "Token used too early" and sign-in silently fails.
CLOCK_SKEW_SECONDS = 60


@dataclass
class User:
    uid: str
    name: str
    email: str
    role: str = "public"

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @property
    def is_worker(self) -> bool:
        return self.role == "worker"

    @property
    def is_staff(self) -> bool:
        return self.role in ("worker", "admin")


def role_for_email(email: str) -> str:
    email = (email or "").lower()
    if not email:
        return "public"
    if email in settings.admin_emails:
        return "admin"
    with SessionLocal() as db:
        member = db.scalar(select(StaffMember).where(StaffMember.email == email))
    if member:
        return member.role
    if email in settings.worker_emails:
        return "worker"
    return "public"


def _google_certs() -> dict:
    if time.time() < _certs["expires"] and _certs["keys"]:
        return _certs["keys"]
    resp = httpx.get(CERTS_URL, timeout=10)
    resp.raise_for_status()
    max_age = 3600
    for part in resp.headers.get("cache-control", "").split(","):
        if part.strip().startswith("max-age="):
            max_age = int(part.split("=")[1])
    _certs.update(keys=resp.json(), expires=time.time() + max_age)
    return _certs["keys"]


def _verify_firebase(token: str) -> User:
    project = settings.firebase_project_id
    try:
        claims = google_jwt.decode(token, certs=_google_certs(), audience=project,
                                   clock_skew_in_seconds=CLOCK_SKEW_SECONDS)
    except Exception as exc:  # expired, wrong project, tampered...
        raise HTTPException(401, f"Sign-in could not be verified by the server: {exc}")
    if claims.get("iss") != f"https://securetoken.google.com/{project}" or not claims.get("sub"):
        raise HTTPException(401, "Token was not issued for this Firebase project. Check FIREBASE_PROJECT_ID.")
    email = (claims.get("email") or "").lower()
    return User(
        uid=claims["sub"],
        name=claims.get("name") or (email.split("@")[0] if email else "Resident"),
        email=email,
        role=role_for_email(email),
    )


_DEV_ROLES = {"0": "public", "public": "public", "w": "worker", "worker": "worker", "1": "admin", "admin": "admin"}


def _verify_dev(token: str) -> User:
    parts = token.split(":")
    if len(parts) != 4 or parts[0] != "dev" or parts[3] not in _DEV_ROLES:
        raise HTTPException(401, "Invalid demo token.")
    _, uid, name, role = parts
    email = f"{uid}@demo.local"
    role = _DEV_ROLES[role]
    if role == "public":  # demo residents can still be promoted from the admin screen
        role = role_for_email(email)
    return User(uid=f"dev-{uid}", name=name or "Demo user", email=email, role=role)


def _user_from_header(authorization: str | None) -> User | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    if settings.dev_auth:
        return _verify_dev(token)
    if not settings.firebase_enabled:
        raise HTTPException(503, "Sign-in is not configured on this server (set FIREBASE_* variables).")
    return _verify_firebase(token)


def optional_user(authorization: str | None = Header(default=None)) -> User | None:
    return _user_from_header(authorization)


def current_user(user: User | None = Depends(optional_user)) -> User:
    if user is None:
        raise HTTPException(401, "Please sign in first.")
    return user


def staff_user(user: User = Depends(current_user)) -> User:
    """Workers and admins."""
    if not user.is_staff:
        raise HTTPException(403, "Only field workers and city staff can do that.")
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(403, "Only city admins can do that.")
    return user
