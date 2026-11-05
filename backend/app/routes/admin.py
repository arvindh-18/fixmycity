"""Admin-only tools: duplicate review/merge."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import duplicates
from ..auth import User, admin_user
from ..db import DuplicateFlag, get_db
from .issues import _get, iso, serialize

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _flag_out(db: Session, f: DuplicateFlag, user: User) -> dict:
    return {"id": f.id, "score": f.score, "distance_m": round(f.distance_m), "status": f.status,
            "created_at": iso(f.created_at),
            "issue": serialize(_get(db, f.issue_id), user), "candidate": serialize(_get(db, f.candidate_id), user)}


@router.get("/duplicates")
def list_duplicates(db: Session = Depends(get_db), user: User = Depends(admin_user)):
    flags = db.scalars(select(DuplicateFlag).where(DuplicateFlag.status == "pending")
                       .order_by(DuplicateFlag.score.desc(), DuplicateFlag.created_at.desc())).all()
    return [_flag_out(db, f, user) for f in flags]


def _pending(db: Session, flag_id: int) -> DuplicateFlag:
    f = db.get(DuplicateFlag, flag_id)
    if not f:
        raise HTTPException(404, "That duplicate suggestion no longer exists.")
    if f.status != "pending":
        raise HTTPException(409, f"This suggestion was already {f.status}.")
    return f


class MergeIn(BaseModel):
    keep_id: int


@router.post("/duplicates/{flag_id}/merge")
def merge_duplicate(flag_id: int, body: MergeIn, db: Session = Depends(get_db), user: User = Depends(admin_user)):
    f = _pending(db, flag_id)
    if body.keep_id not in (f.issue_id, f.candidate_id):
        raise HTTPException(422, "Choose one of the two reports to keep.")
    gone_id = f.candidate_id if body.keep_id == f.issue_id else f.issue_id
    keep, gone = _get(db, body.keep_id), _get(db, gone_id)
    duplicates.merge(db, keep, gone, user.name)
    return {"kept": serialize(keep, user), "merged": serialize(gone, user)}


@router.post("/duplicates/{flag_id}/dismiss")
def dismiss_duplicate(flag_id: int, db: Session = Depends(get_db), user: User = Depends(admin_user)):
    f = _pending(db, flag_id)
    f.status = "dismissed"
    db.commit()
    return {"ok": True}
