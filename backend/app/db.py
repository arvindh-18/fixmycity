from datetime import datetime, timezone

from sqlalchemy import (
    DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint, create_engine,
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


def init_db() -> None:
    Base.metadata.create_all(engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
