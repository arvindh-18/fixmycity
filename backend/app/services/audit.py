"""Append-only audit writer. Every privileged action calls record().

The function only ever INSERTs. Combined with the database trigger that rejects UPDATE/DELETE on
audit_logs, history cannot be silently rewritten.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog, User


def _jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, (uuid.UUID, datetime, date)):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    return value


def record(
    db: Session,
    *,
    actor: User | None,
    action: str,
    entity_type: str,
    entity_id: Any = None,
    issue_id: uuid.UUID | None = None,
    old: dict | None = None,
    new: dict | None = None,
    reason: str | None = None,
    ip: str | None = None,
) -> AuditLog:
    entry = AuditLog(
        actor_id=actor.id if actor else None,
        actor_role=actor.role if actor else "system",
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        issue_id=issue_id,
        old_values=_jsonable(old) if old else None,
        new_values=_jsonable(new) if new else None,
        reason=reason,
        ip_address=ip,
    )
    db.add(entry)
    return entry
