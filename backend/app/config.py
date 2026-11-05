"""All configuration comes from environment variables (or a .env file). Nothing else to set up."""
import os
from pathlib import Path


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

    # Firebase Authentication (web config is public; it is served to the frontend at runtime).
    firebase_project_id = _env("FIREBASE_PROJECT_ID")
    firebase_api_key = _env("FIREBASE_API_KEY")
    firebase_auth_domain = _env("FIREBASE_AUTH_DOMAIN") or (
        f"{_env('FIREBASE_PROJECT_ID')}.firebaseapp.com" if _env("FIREBASE_PROJECT_ID") else ""
    )
    firebase_app_id = _env("FIREBASE_APP_ID")

    # Comma-separated emails that can change issue status.
    admin_emails = {e.strip().lower() for e in _env("ADMIN_EMAILS").split(",") if e.strip()}
    # Comma-separated emails of field workers (servicemen). Admins can also add workers from the app.
    worker_emails = {e.strip().lower() for e in _env("WORKER_EMAILS").split(",") if e.strip()}

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
    def firebase_enabled(self) -> bool:
        return bool(self.firebase_project_id and self.firebase_api_key)

    @property
    def dev_auth(self) -> bool:
        """Without Firebase keys (and outside production) the app offers one-click demo sign-in."""
        return not self.firebase_enabled and self.environment != "production"

    @property
    def ai_enabled(self) -> bool:
        return bool(self.gemini_api_key)


settings = Settings()
