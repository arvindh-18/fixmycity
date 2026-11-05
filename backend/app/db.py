from datetime import datetime, timezone

from sqlalchemy import (
    DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint, create_engine, inspect, select, text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from .config import settings


def _normalise(url: str) -> str:
    # Hosted Postgres providers hand out postgres:// or postgresql:// URLs; use the psycopg 3 driver.
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


DB_URL = _normalise(settings.database_url)
engine = create_engine(
    DB_URL,
    pool_pre_ping=True,
    connect_args={"check_same_thread": False} if DB_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


STATUSES = ("open", "in_progress", "resolved", "rejected")
SEVERITIES = ("low", "medium", "high")
CATEGORIES = {
    "pothole": "Pothole / road damage",
    "garbage": "Garbage / litter",
    "streetlight": "Streetlight not working",
    "water": "Water leak / supply",
    "drainage": "Drainage / sewage",
    "traffic": "Traffic signal / signage",
    "tree": "Fallen tree / branches",
    "footpath": "Broken footpath",
    "other": "Something else",
}


class Issue(Base):
    __tablename__ = "issues"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(140))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(32), index=True)
    severity: Mapped[str] = mapped_column(String(16), default="medium")
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)

    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    address: Mapped[str] = mapped_column(String(300), default="")
    locality: Mapped[str] = mapped_column(String(120), default="", index=True)
    pincode: Mapped[str] = mapped_column(String(12), default="", index=True)

    photo: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, deferred=True)
    has_photo: Mapped[int] = mapped_column(Integer, default=0)

    # What the resident originally typed or said (any language), before Gemini structured it.
    original_text: Mapped[str | None] = mapped_column(Text, nullable=True, default="")
    # Duplicate merged into another report.
    merged_into: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Field work
    assigned_to_email: Mapped[str | None] = mapped_column(String(254), nullable=True, index=True)
    fixed_by_email: Mapped[str | None] = mapped_column(String(254), nullable=True, index=True)
    # Public names (emails stay private to staff).
    assigned_to_name: Mapped[str | None] = mapped_column(String(120), nullable=True, default="")
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fixed_by_name: Mapped[str | None] = mapped_column(String(120), nullable=True, default="")
    after_photo: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, deferred=True)
    has_after_photo: Mapped[int | None] = mapped_column(Integer, nullable=True, default=0)

    reporter_uid: Mapped[str] = mapped_column(String(128), index=True)
    reporter_name: Mapped[str] = mapped_column(String(120), default="")
    upvotes: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    updates: Mapped[list["StatusUpdate"]] = relationship(
        back_populates="issue", order_by="StatusUpdate.created_at", cascade="all, delete-orphan"
    )


class StatusUpdate(Base):
    __tablename__ = "status_updates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("issues.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16))
    note: Mapped[str] = mapped_column(Text, default="")
    by_name: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    issue: Mapped[Issue] = relationship(back_populates="updates")


class Upvote(Base):
    __tablename__ = "upvotes"
    __table_args__ = (UniqueConstraint("issue_id", "uid"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("issues.id", ondelete="CASCADE"), index=True)
    uid: Mapped[str] = mapped_column(String(128))


class Message(Base):
    """Chat on a report between its reporter, field workers and admins."""
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("issues.id", ondelete="CASCADE"), index=True)
    sender_uid: Mapped[str] = mapped_column(String(128))
    sender_name: Mapped[str] = mapped_column(String(120), default="")
    sender_role: Mapped[str] = mapped_column(String(16), default="public")
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class MessageRead(Base):
    __tablename__ = "message_reads"
    __table_args__ = (UniqueConstraint("issue_id", "uid"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("issues.id", ondelete="CASCADE"), index=True)
    uid: Mapped[str] = mapped_column(String(128), index=True)
    last_read_message_id: Mapped[int] = mapped_column(Integer, default=0)


class DuplicateFlag(Base):
    """A new report that looks like an existing one; an admin merges or dismisses it."""
    __tablename__ = "duplicate_flags"
    __table_args__ = (UniqueConstraint("issue_id", "candidate_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("issues.id", ondelete="CASCADE"), index=True)  # the newer report
    candidate_id: Mapped[int] = mapped_column(ForeignKey("issues.id", ondelete="CASCADE"), index=True)  # existing one
    score: Mapped[float] = mapped_column(Float)
    distance_m: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)  # pending | merged | dismissed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


ROLES = ("public", "worker", "admin")


class StaffMember(Base):
    """Workers and admins added from the admin screen (on top of ADMIN_EMAILS / WORKER_EMAILS)."""
    __tablename__ = "staff"

    email: Mapped[str] = mapped_column(String(254), primary_key=True)
    role: Mapped[str] = mapped_column(String(16), default="worker")
    name: Mapped[str | None] = mapped_column(String(120), nullable=True, default="")
    added_by: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class LegacyUid(Base):
    """Legacy auth uid per email, so returning users keep their reports, upvotes and chats."""
    __tablename__ = "legacy_uids"
    email: Mapped[str] = mapped_column(String(254), primary_key=True)
    uid: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


def legacy_uid_for_email(email: str) -> str | None:
    if not email:
        return None
    with SessionLocal() as db:
        row = db.scalar(select(LegacyUid).where(LegacyUid.email == email.lower()))
        return row.uid if row else None


def _add_missing_columns() -> None:
    """create_all() never alters existing tables, so add any new columns (SQLite and Postgres)."""
    insp = inspect(engine)
    for table in Base.metadata.sorted_tables:
        if not insp.has_table(table.name):
            continue
        existing = {c["name"] for c in insp.get_columns(table.name)}
        for col in table.columns:
            if col.name in existing:
                continue
            ddl = f"ALTER TABLE {table.name} ADD COLUMN {col.name} {col.type.compile(dialect=engine.dialect)}"
            default = col.default.arg if col.default is not None and col.default.is_scalar else None
            if isinstance(default, bool):
                default = int(default)
            if isinstance(default, int):
                ddl += f" DEFAULT {default}"
            elif isinstance(default, str):
                ddl += " DEFAULT '" + default.replace("'", "''") + "'"
            with engine.begin() as conn:
                conn.execute(text(ddl))


def init_db() -> None:
    Base.metadata.create_all(engine)
    _add_missing_columns()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
