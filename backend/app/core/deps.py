"""FastAPI dependencies for authentication and role-based access control.

Usage in a router:
    @router.get("/x")
    def handler(user: User = Depends(require_role("admin"))): ...

The JWT only identifies the user; the role is always re-read from the database so a deactivated
account or a role change takes effect on the next request.
"""
from __future__ import annotations

import uuid
from collections.abc import Callable

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.database.session import get_db
from app.models import Issue, User

bearer = HTTPBearer(auto_error=False)


def user_from_token(db: Session, token: str | None) -> User | None:
    if not token:
        return None
    payload = decode_access_token(token)
    if not payload:
        return None
    try:
        user = db.get(User, uuid.UUID(payload["sub"]))
    except (KeyError, ValueError):
        return None
    if not user or not user.is_active:
        return None
    return user


def optional_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)
) -> User | None:
    return user_from_token(db, creds.credentials if creds else None)


def get_current_user(user: User | None = Depends(optional_user)) -> User:
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue.")
    return user


def require_role(*roles: str) -> Callable[..., User]:
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role does not have access to this action.")
        return user
    return checker


def ensure_admin_scope(admin: User, issue: Issue) -> None:
    """Department admins manage their own department and the not-yet-routed queue.
    City-wide admins (department_id is NULL) manage everything."""
    if admin.department_id is None:
        return
    if issue.department_id is None or issue.department_id == admin.department_id:
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "This issue belongs to another department.")


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"
