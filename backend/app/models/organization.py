"""Departments, users, profiles, categories, localities, SLA rules and facilities."""
from __future__ import annotations

import uuid

from geoalchemy2 import Geography
from sqlalchemy import Boolean, CheckConstraint, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.session import Base
from app.models.base import Timestamps, UUIDPk

ROLES = ("citizen", "admin", "worker")
PRIORITIES = ("low", "medium", "high", "critical")


class Department(UUIDPk, Timestamps, Base):
    __tablename__ = "departments"
    name: Mapped[str] = mapped_column(String(120), unique=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    contact_email: Mapped[str | None] = mapped_column(String(255))


class User(UUIDPk, Timestamps, Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint(f"role IN {ROLES}", name="ck_users_role"),)

    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(30))
    role: Mapped[str] = mapped_column(String(20), index=True)
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("departments.id", ondelete="SET NULL")
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    email_notifications: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    department: Mapped[Department | None] = relationship(lazy="joined")
    worker_profile: Mapped["WorkerProfile | None"] = relationship(back_populates="user", uselist=False)
    citizen_profile: Mapped["CitizenProfile | None"] = relationship(back_populates="user", uselist=False)


class CitizenProfile(Timestamps, Base):
    __tablename__ = "citizen_profiles"
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    home_locality_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("localities.id", ondelete="SET NULL")
    )
    user: Mapped[User] = relationship(back_populates="citizen_profile")


class WorkerProfile(Timestamps, Base):
    __tablename__ = "worker_profiles"
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    department_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("departments.id"))
    employee_code: Mapped[str] = mapped_column(String(30), unique=True)
    skills: Mapped[str | None] = mapped_column(Text)
    user: Mapped[User] = relationship(back_populates="worker_profile")


class IssueCategory(UUIDPk, Timestamps, Base):
    __tablename__ = "issue_categories"
    name: Mapped[str] = mapped_column(String(80), unique=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    icon: Mapped[str] = mapped_column(String(40), default="circle-help")
    keywords: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    default_department_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("departments.id", ondelete="SET NULL")
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    default_department: Mapped[Department | None] = relationship(lazy="joined")


class Locality(UUIDPk, Timestamps, Base):
    __tablename__ = "localities"
    name: Mapped[str] = mapped_column(String(120), unique=True)
    # MultiPolygon so real ward maps with several parts (islands, enclaves) import without loss.
    boundary = mapped_column(Geography(geometry_type="MULTIPOLYGON", srid=4326, spatial_index=True))
    is_approximate: Mapped[bool] = mapped_column(Boolean, default=True)
    boundary_source: Mapped[str | None] = mapped_column(String(255))
    population: Mapped[int | None] = mapped_column(Integer)
    population_source: Mapped[str | None] = mapped_column(String(255))


class SLAConfiguration(UUIDPk, Timestamps, Base):
    __tablename__ = "sla_configurations"
    __table_args__ = (
        UniqueConstraint("category_id", "priority", name="uq_sla_category_priority"),
        CheckConstraint(f"priority IN {PRIORITIES}", name="ck_sla_priority"),
        CheckConstraint("response_hours > 0 AND resolution_hours >= response_hours", name="ck_sla_hours"),
        CheckConstraint("warning_threshold > 0 AND warning_threshold < 1", name="ck_sla_warning"),
    )
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("issue_categories.id", ondelete="CASCADE")
    )
    priority: Mapped[str] = mapped_column(String(20))
    response_hours: Mapped[int] = mapped_column(Integer)
    resolution_hours: Mapped[int] = mapped_column(Integer)
    warning_threshold: Mapped[float] = mapped_column(Float, default=0.75)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    category: Mapped[IssueCategory | None] = relationship(lazy="joined")


class Facility(UUIDPk, Timestamps, Base):
    """Schools, hospitals etc. Used for priority proximity only when the data is present."""
    __tablename__ = "facilities"
    name: Mapped[str] = mapped_column(String(160))
    kind: Mapped[str] = mapped_column(String(40))
    location = mapped_column(Geography(geometry_type="POINT", srid=4326, spatial_index=True))
    source: Mapped[str] = mapped_column(String(255))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
