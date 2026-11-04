"""Registration, login and the current user."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import rate_limit
from app.core.deps import client_ip, get_current_user
from app.core.security import create_access_token, hash_password, verify_password
from app.database.session import get_db
from app.models import CitizenProfile, User
from app.schemas.inputs import LoginIn, RegisterIn
from app.schemas.serializers import user_dict
from app.services import audit

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", status_code=201)
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    """Public sign-up creates CITIZEN accounts only. Admins create worker accounts; admin accounts
    are created by the seed script / an existing admin — nobody can self-register as staff."""
    rate_limit.check(f"register:{client_ip(request)}", 5, 60)
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists. Sign in instead.")
    user = User(email=email, password_hash=hash_password(body.password), full_name=body.full_name.strip(),
                phone=body.phone, role="citizen")
    db.add(user)
    db.flush()
    db.add(CitizenProfile(user_id=user.id))
    audit.record(db, actor=user, action="user.registered", entity_type="user", entity_id=user.id, ip=client_ip(request))
    db.commit()
    return {"access_token": create_access_token(str(user.id), user.role), "token_type": "bearer", "user": user_dict(user)}


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    rate_limit.check(f"login:{client_ip(request)}", 10, 60)
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email or password is incorrect.")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been deactivated.")
    return {"access_token": create_access_token(str(user.id), user.role), "token_type": "bearer", "user": user_dict(user)}


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    data = user_dict(user)
    if user.citizen_profile:
        data["home_locality_id"] = str(user.citizen_profile.home_locality_id) if user.citizen_profile.home_locality_id else None
    return data


class PreferencesIn(BaseModel):
    email_notifications: bool


@router.patch("/me/preferences")
def update_preferences(body: PreferencesIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    user.email_notifications = body.email_notifications
    audit.record(db, actor=user, action="user.preferences_updated", entity_type="user", entity_id=user.id,
                 new={"email_notifications": body.email_notifications})
    db.commit()
    return user_dict(user)
