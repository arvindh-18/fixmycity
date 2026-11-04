"""Application settings, read once from environment variables (and an optional .env file).

Keeping every tunable in one typed object means the rest of the code never calls os.getenv
directly, and tests can override values in one place.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _load_dotenv() -> None:
    """Minimal .env loader (KEY=VALUE lines) so we don't need an extra dependency."""
    for candidate in (Path.cwd() / ".env", Path(__file__).resolve().parents[2] / ".env"):
        if candidate.exists():
            for line in candidate.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
            break


_load_dotenv()


def _list(name: str, default: str) -> list[str]:
    return [v.strip() for v in os.getenv(name, default).split(",") if v.strip()]


@dataclass(frozen=True)
class Settings:
    app_name: str = "Commons"
    environment: str = os.getenv("ENVIRONMENT", "development")
    database_url: str = os.getenv(
        "DATABASE_URL", "postgresql+psycopg://openward:openward@localhost:5432/openward"
    )
    jwt_secret: str = os.getenv("JWT_SECRET", "dev-only-change-me-in-production-please-32b")
    jwt_expiry_hours: int = int(os.getenv("JWT_EXPIRY_HOURS", "12"))
    cors_origins: list[str] = field(
        default_factory=lambda: _list("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    )

    # Storage
    storage_backend: str = os.getenv("STORAGE_BACKEND", "local")  # local | supabase
    media_dir: str = os.getenv("MEDIA_DIR", str(Path(__file__).resolve().parents[2] / "media"))
    public_base_url: str = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000")
    frontend_url: str = os.getenv("FRONTEND_URL", "http://localhost:5173")
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_service_key: str = os.getenv("SUPABASE_SERVICE_KEY", "")
    supabase_bucket: str = os.getenv("SUPABASE_BUCKET", "openward")
    max_upload_mb: int = int(os.getenv("MAX_UPLOAD_MB", "8"))

    # AI
    ai_provider: str = os.getenv("AI_PROVIDER", "rules")  # rules | anthropic | openai
    ai_api_key: str = os.getenv("AI_API_KEY", "")
    ai_model: str = os.getenv("AI_MODEL", "")
    ai_base_url: str = os.getenv("AI_BASE_URL", "")
    ai_timeout_seconds: float = float(os.getenv("AI_TIMEOUT_SECONDS", "20"))

    # Email notifications: outbox (write .eml files) | smtp | none
    email_backend: str = os.getenv("EMAIL_BACKEND", "outbox")
    outbox_dir: str = os.getenv("OUTBOX_DIR", str(Path(__file__).resolve().parents[2] / "outbox"))
    smtp_host: str = os.getenv("SMTP_HOST", "")
    smtp_port: int = int(os.getenv("SMTP_PORT", "587"))
    smtp_user: str = os.getenv("SMTP_USER", "")
    smtp_password: str = os.getenv("SMTP_PASSWORD", "")
    smtp_from: str = os.getenv("SMTP_FROM", "Commons <no-reply@openward.local>")
    smtp_starttls: bool = os.getenv("SMTP_STARTTLS", "true").lower() == "true"
    email_sync: bool = os.getenv("EMAIL_SYNC", "false").lower() == "true"  # tests send inline

    # Background escalation loop
    escalation_interval_seconds: int = int(os.getenv("ESCALATION_INTERVAL_SECONDS", "60"))
    enable_background_jobs: bool = os.getenv("ENABLE_BACKGROUND_JOBS", "true").lower() == "true"

    # City defaults (map centre)
    city_name: str = os.getenv("CITY_NAME", "Bengaluru")
    city_lat: float = float(os.getenv("CITY_LAT", "12.9716"))
    city_lng: float = float(os.getenv("CITY_LNG", "77.5946"))


settings = Settings()
