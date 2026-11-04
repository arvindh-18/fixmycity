"""A small in-memory sliding-window rate limiter.

Each key (e.g. "login:203.0.113.5") keeps the timestamps of recent hits. If the number of hits in
the window reaches the limit, the request is rejected with HTTP 429.

Trade-off: state lives in this process only. With several server processes you'd move this to
Redis; for a single-process project it is simple and easy to explain.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import HTTPException, status

_hits: dict[str, deque[float]] = defaultdict(deque)
_lock = Lock()
enabled = True


def check(key: str, limit: int, window_seconds: int) -> None:
    if not enabled:
        return
    now = time.monotonic()
    with _lock:
        q = _hits[key]
        while q and now - q[0] > window_seconds:
            q.popleft()
        if len(q) >= limit:
            retry = int(window_seconds - (now - q[0])) + 1
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                f"Too many requests. Try again in {retry} seconds.",
                headers={"Retry-After": str(retry)},
            )
        q.append(now)


def reset() -> None:
    with _lock:
        _hits.clear()
