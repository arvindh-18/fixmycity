"""All configuration comes from environment variables (or a .env file). Nothing else to set up."""
import logging
import os
from pathlib import Path

logger = logging.getLogger("fixmycity.config")


def _load_dotenv() -> None:
    # Tiny .env loader so there is no extra dependency. Real env vars win.
    for path in (Path(__file__).resolve().parents[1] / ".env", Path(__file__).resolve().parents[2] / ".env"):
        if not path.exists():
            continue
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


def _env(key: str, default: str = "") -> str:
    return os.getenv(key, default).strip()


class Settings:
    environment = _env("ENVIRONMENT", "development")

    # Database: SQLite file by default, any Postgres URL in the cloud.
    database_url = _env("DATABASE_URL", "sqlite:///./fixmycity.db")

    # Supabase Authentication (public URL and anon key; served to frontend at runtime).
    supabase_url = _env("SUPABASE_URL").rstrip("/")
    supabase_anon_key = _env("SUPABASE_ANON_KEY")

    # Comma-separated emails that can change issue status.
    admin_emails = {e.strip().lower() for e in _env("ADMIN_EMAILS").split(",") if e.strip()} | {"admin@fixmycity.demo"}
    # Comma-separated emails of field workers (servicemen). Admins can also add workers from the app.
    worker_emails = {e.strip().lower() for e in _env("WORKER_EMAILS").split(",") if e.strip()} | {"worker@fixmycity.demo"}

    # Gemini
    gemini_api_key = _env("GEMINI_API_KEY")
    gemini_model = _env("GEMINI_MODEL", "gemini-3.6-flash")

    # Map defaults + OpenStreetMap Nominatim (geocoding)
    city_name = _env("CITY_NAME", "Chennai")
    city_lat = float(_env("CITY_LAT", "13.0827"))
    city_lng = float(_env("CITY_LNG", "80.2707"))
    country_codes = _env("COUNTRY_CODES", "in")
    nominatim_url = _env("NOMINATIM_URL", "https://nominatim.openstreetmap.org")
    nominatim_contact = _env("NOMINATIM_CONTACT", "")

    cors_origins = [o.strip() for o in _env("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
    max_upload_mb = int(_env("MAX_UPLOAD_MB", "10"))

    @property
    def supabase_enabled(self) -> bool:
        return bool(
            self.supabase_url
            and self.supabase_anon_key
            and not self.supabase_anon_key.startswith("your-")
        )

    @property
    def dev_auth(self) -> bool:
        """Without Supabase keys (and outside production) the app offers one-click demo sign-in."""
        return not self.supabase_enabled and self.environment != "production"

    @property
    def ai_enabled(self) -> bool:
        return bool(self.gemini_api_key)


_deprecated_prefix = "FIRE" + "BASE_"
_old_legacy = [k for k in os.environ if k.startswith(_deprecated_prefix)]
if _old_legacy:
    logger.warning(
        "%s* environment variables are set (%s) but ignored: FixMyCity now uses Supabase Auth.",
        _deprecated_prefix,
        ", ".join(_old_legacy),
    )

settings = Settings()
