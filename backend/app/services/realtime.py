"""In-process WebSocket hub.

Each signed-in browser tab opens one socket (/ws?token=...). The hub maps user_id -> set of
sockets. Services call `queue(db, user_ids, event)` while handling a request; the events are only
sent **after the database transaction commits** (via a SQLAlchemy `after_commit` hook), so clients
never hear about something that was rolled back.

Request handlers run in a worker thread, while sockets live on the asyncio event loop, so we hand
the send over with `asyncio.run_coroutine_threadsafe`.
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections import defaultdict
from typing import Any

from fastapi import WebSocket
from sqlalchemy import event
from sqlalchemy.orm import Session

log = logging.getLogger("openward.realtime")


class Hub:
    def __init__(self) -> None:
        self.connections: dict[str, set[WebSocket]] = defaultdict(set)
        self.loop: asyncio.AbstractEventLoop | None = None

    async def connect(self, user_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self.loop = asyncio.get_running_loop()
        self.connections[user_id].add(ws)

    def disconnect(self, user_id: str, ws: WebSocket) -> None:
        self.connections[user_id].discard(ws)
        if not self.connections[user_id]:
            self.connections.pop(user_id, None)

    def is_online(self, user_id: str) -> bool:
        return bool(self.connections.get(user_id))

    async def send(self, user_id: str, payload: dict[str, Any]) -> None:
        text = json.dumps(payload, default=str)
        for ws in list(self.connections.get(user_id, ())):
            try:
                await ws.send_text(text)
            except Exception:  # socket closed mid-send
                self.disconnect(user_id, ws)

    def dispatch(self, user_id: str, payload: dict[str, Any]) -> None:
        """Thread-safe fire-and-forget send."""
        if not self.loop or not self.connections.get(user_id):
            return
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is self.loop:
            self.loop.create_task(self.send(user_id, payload))
        else:
            asyncio.run_coroutine_threadsafe(self.send(user_id, payload), self.loop)


hub = Hub()


def queue(db: Session, user_ids: list[uuid.UUID | str], payload: dict[str, Any]) -> None:
    pending = db.info.setdefault("realtime_pending", [])
    for uid in {str(u) for u in user_ids if u}:
        pending.append((uid, payload))


@event.listens_for(Session, "after_commit")
def _flush_after_commit(session: Session) -> None:
    pending = session.info.pop("realtime_pending", [])
    for uid, payload in pending:
        try:
            hub.dispatch(uid, payload)
        except Exception:  # never break a request because a push failed
            log.exception("realtime dispatch failed")


@event.listens_for(Session, "after_rollback")
def _drop_after_rollback(session: Session) -> None:
    session.info.pop("realtime_pending", None)
