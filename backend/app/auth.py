"""Firebase Authentication.

The frontend signs in with Firebase and sends the ID token as `Authorization: Bearer <token>`.
We verify it against Google's public certificates, so the backend needs only FIREBASE_PROJECT_ID —
no service-account file.

Without Firebase configured (local dev only) tokens look like `dev:<uid>:<name>:<admin 0|1>`.
"""
import time
from dataclasses import dataclass

import httpx
from fastapi import Depends, Header, HTTPException
from google.auth import jwt as google_jwt

from .config import settings

CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
_certs: dict = {"keys": {}, "expires": 0.0}


@dataclass
class User:
    uid: str
    name: str
    email: str
    is_admin: bool


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
        claims = google_jwt.decode(token, certs=_google_certs(), audience=project)
    except Exception as exc:  # expired, wrong project, tampered...
        raise HTTPException(401, f"Sign-in expired or invalid. Please sign in again. ({exc.__class__.__name__})")
    if claims.get("iss") != f"https://securetoken.google.com/{project}" or not claims.get("sub"):
        raise HTTPException(401, "Token was not issued for this Firebase project.")
    email = (claims.get("email") or "").lower()
    return User(
        uid=claims["sub"],
        name=claims.get("name") or (email.split("@")[0] if email else "Resident"),
        email=email,
        is_admin=bool(email) and email in settings.admin_emails,
    )


def _verify_dev(token: str) -> User:
    parts = token.split(":")
    if len(parts) != 4 or parts[0] != "dev":
        raise HTTPException(401, "Invalid demo token.")
    _, uid, name, admin = parts
    return User(uid=f"dev-{uid}", name=name or "Demo user", email=f"{uid}@demo.local", is_admin=admin == "1")


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


def admin_user(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(403, "Only city staff can do that.")
    return user
