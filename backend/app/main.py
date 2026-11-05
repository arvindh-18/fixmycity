"""FixMyCity API. Also serves the built frontend, so production is a single service."""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .db import init_db
from .routes import admin, issues, messages, misc



@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()  # creates tables on first run; no migrations to manage
    yield


app = FastAPI(title="FixMyCity API", version="2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(misc.router)
app.include_router(issues.router)
app.include_router(messages.router)
app.include_router(admin.router)


# ---- Frontend (only when it has been built into ./static or ../frontend/dist) ----
STATIC = next(
    (p for p in (Path(__file__).resolve().parents[1] / "static",
                 Path(__file__).resolve().parents[2] / "frontend" / "dist") if (p / "index.html").exists()),
    None,
)

if STATIC:
    app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        file = STATIC / path
        if path and file.is_file() and STATIC in file.resolve().parents:
            return FileResponse(file)
        return FileResponse(STATIC / "index.html")
