"""Supabase Authentication + roles.

The frontend signs in with Supabase and sends the access token as `Authorization: Bearer <token>`.
The backend verifies the token using PyJWT (via JWKS for asymmetric algorithms or Supabase Auth server fallback/HS256).

Roles: `public` (residents), `worker` (field servicemen) and `admin` (city staff).
A user's role comes from ADMIN_EMAILS / WORKER_EMAILS, or from the staff list admins manage in the app.

Without Supabase configured (local dev only) tokens look like `dev:<uid>:<name>:<role>` where role is
`0`/`public`, `w`/`worker` or `1`/`admin`.
"""
import hashlib
import logging
import time
from dataclasses import dataclass

import httpx
import jwt
from fastapi import Depends, Header, HTTPException
from sqlalchemy import select

from .config import settings
from .db import LegacyUid, SessionLocal, StaffMember, legacy_uid_for_email

logger = logging.getLogger("fixmycity.auth")

CLOCK_SKEW_SECONDS = 60

# Cache: sha256(token) -> (expiry_time, User)
_token_cache: dict[str, tuple[float, "User"]] = {}
_CACHE_MAX = 2000

_jwks_client: jwt.PyJWKClient | None = None
_warned_email_verified = False


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


def _get_jwks_client() -> jwt.PyJWKClient:
    global _jwks_client
    jwks_url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
    if _jwks_client is None or getattr(_jwks_client, "uri", None) != jwks_url:
        _jwks_client = jwt.PyJWKClient(jwks_url, cache_jwk_set=True, lifespan=3600)
    return _jwks_client


def _verify_with_auth_server(token: str) -> dict:
    url = f"{settings.supabase_url}/auth/v1/user"
    headers = {
        "apikey": settings.supabase_anon_key,
        "Authorization": f"Bearer {token}",
    }
    try:
        resp = httpx.get(url, headers=headers, timeout=10)
    except httpx.HTTPError:
        raise HTTPException(503, "Sign-in service is unreachable, try again.")

    if resp.status_code == 200:
        data = resp.json()
        try:
            unverified = jwt.decode(token, options={"verify_signature": False})
        except Exception:
            unverified = {}
        return {
            "sub": data.get("id"),
            "email": data.get("email"),
            "role": data.get("role", "authenticated"),
            "user_metadata": data.get("user_metadata") or {},
            "email_confirmed_at": data.get("email_confirmed_at"),
            "exp": unverified.get("exp", time.time() + 60),
            "_from_auth_server": True,
        }
    if resp.status_code in (400, 401, 403, 404):
        raise HTTPException(401, "Sign-in expired or invalid. Please sign in again.")
    raise HTTPException(503, "Sign-in service is unreachable, try again.")


def _build_user_from_claims(claims: dict) -> User:
    global _warned_email_verified

    if claims.get("role") != "authenticated":
        raise HTTPException(401, "Token role is not authenticated.")

    sub = claims.get("sub")
    if not sub:
        raise HTTPException(401, "Token is missing sub claim.")

    email = (claims.get("email") or "").strip().lower()
    user_metadata = claims.get("user_metadata") or {}

    # Email verification gate for staff roles and legacy uids:
    if claims.get("_from_auth_server"):
        email_verified = bool(claims.get("email_confirmed_at"))
    else:
        if "email_verified" in user_metadata:
            email_verified = bool(user_metadata["email_verified"])
        else:
            if not _warned_email_verified:
                _warned_email_verified = True
                logger.warning(
                    "email_verified claim absent in JWT user_metadata; treating as verified per Confirm Email setting."
                )
            email_verified = True

    if email_verified:
        role = role_for_email(email)
        uid = legacy_uid_for_email(email) or sub
    else:
        role = "public"
        uid = sub

    name = (
        user_metadata.get("full_name")
        or user_metadata.get("name")
        or (email.split("@")[0] if email else "")
        or "Resident"
    )

    return User(uid=str(uid), name=str(name), email=email, role=role)


def _verify_supabase(token: str) -> User:
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = time.time()

    if token_hash in _token_cache:
        exp_time, cached_user = _token_cache[token_hash]
        if now < exp_time:
            return cached_user
        _token_cache.pop(token_hash, None)

    try:
        header = jwt.get_unverified_header(token)
    except Exception as exc:
        raise HTTPException(401, f"Invalid token header: {exc}")

    alg = header.get("alg")
    if alg not in ("ES256", "RS256", "HS256"):
        raise HTTPException(401, f"Unsupported token algorithm: {alg}")

    if alg == "HS256":
        claims = _verify_with_auth_server(token)
    else:
        try:
            jwks_client = _get_jwks_client()
            signing_key = jwks_client.get_signing_key_from_jwt(token)
        except Exception:
            # Fall back to Auth server check
            claims = _verify_with_auth_server(token)
            signing_key = None

        if signing_key is not None:
            try:
                claims = jwt.decode(
                    token,
                    signing_key.key,
                    algorithms=[alg],
                    audience="authenticated",
                    issuer=f"{settings.supabase_url}/auth/v1",
                    options={"require": ["exp", "sub"]},
                    leeway=CLOCK_SKEW_SECONDS,
                )
            except jwt.InvalidTokenError as exc:
                raise HTTPException(401, f"Sign-in could not be verified: {exc}")

    user = _build_user_from_claims(claims)

    exp = float(claims.get("exp", now + 60))
    ttl = min(max(0.0, exp - now), 60.0)
    if ttl > 0:
        if len(_token_cache) >= _CACHE_MAX:
            expired = [k for k, (exp_t, _) in _token_cache.items() if exp_t <= now]
            for k in expired:
                _token_cache.pop(k, None)
            if len(_token_cache) >= _CACHE_MAX:
                _token_cache.pop(next(iter(_token_cache)))
        _token_cache[token_hash] = (now + ttl, user)

    return user


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
    if not settings.supabase_enabled:
        raise HTTPException(503, "Sign-in is not configured on this server (set SUPABASE_URL and SUPABASE_ANON_KEY).")
    return _verify_supabase(token)


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
