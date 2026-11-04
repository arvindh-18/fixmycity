"""FastAPI application entry point.

Run:  uvicorn app.main:app --reload
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api import admin, ai, auth, chat, community, issues, public, subscriptions, worker
from app.core.config import settings
from app.services import escalation

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("openward")


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = None
    if settings.enable_background_jobs:
        task = asyncio.create_task(escalation.loop(settings.escalation_interval_seconds))
    yield
    if task:
        task.cancel()


app = FastAPI(title="Commons API", version="1.0.0", lifespan=lifespan,
              description="Civic issue reporting, resolution and public accountability.")

app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    """Never leak stack traces to clients; log them server-side."""
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Something went wrong on our side. Please try again."})


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return response


for r in (auth.router, public.router, subscriptions.router, issues.router, community.router, admin.router, worker.router, chat.router, ai.router):
    app.include_router(r)

Path(settings.media_dir).mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=settings.media_dir), name="media")


@app.get("/api/health")
def health():
    return {"status": "ok", "app": settings.app_name}
