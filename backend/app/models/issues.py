"""Issues and everything that hangs off a single issue."""
from __future__ import annotations

import uuid
from datetime import datetime

from geoalchemy2 import Geography
from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.session import Base
from app.models.base import Timestamps, UUIDPk, utcnow
from app.models.organization import Department, IssueCategory, Locality, PRIORITIES, User

STATUSES = (
    "submitted", "pending_verification", "verified", "assigned", "in_progress",
    "awaiting_verification", "resolved", "rejected", "reopened", "on_hold", "escalated",
)


class Issue(UUIDPk, Timestamps, Base):
    __tablename__ = "issues"
    __table_args__ = (
        CheckConstraint(f"status IN {STATUSES}", name="ck_issues_status"),
        CheckConstraint(f"priority IS NULL OR priority IN {PRIORITIES}", name="ck_issues_priority"),
        Index("ix_issues_status_created", "status", "created_at"),
    )

    tracking_id: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(140))
    description: Mapped[str] = mapped_column(Text)
    category_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("issue_categories.id"), index=True)
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("departments.id", ondelete="SET NULL"), index=True
    )
    locality_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("localities.id", ondelete="SET NULL"), index=True
    )
    status: Mapped[str] = mapped_column(String(30), default="submitted")
    priority: Mapped[str | None] = mapped_column(String(20))

    reporter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    is_anonymous: Mapped[bool] = mapped_column(Boolean, default=False)
    anon_token_hash: Mapped[str | None] = mapped_column(String(64))

    location = mapped_column(Geography(geometry_type="POINT", srid=4326, spatial_index=True), nullable=False)
    address: Mapped[str | None] = mapped_column(String(255))
    additional_info: Mapped[str | None] = mapped_column(Text)

    sla_config_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sla_configurations.id", ondelete="SET NULL")
    )
    response_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolution_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sla_warning_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    overdue_flagged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    escalation_level: Mapped[int] = mapped_column(Integer, default=0)

    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    first_response_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duplicate_of_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("issues.id", ondelete="SET NULL")
    )
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)

    category: Mapped[IssueCategory] = relationship(lazy="joined")
    department: Mapped[Department | None] = relationship(lazy="joined")
    locality: Mapped[Locality | None] = relationship(lazy="joined")
    reporter: Mapped[User | None] = relationship(foreign_keys=[reporter_id])
    images: Mapped[list["IssueImage"]] = relationship(
        back_populates="issue", order_by="IssueImage.created_at", cascade="all, delete-orphan"
    )
    assignments: Mapped[list["IssueAssignment"]] = relationship(
        back_populates="issue", order_by="IssueAssignment.created_at"
    )


class IssueStatusHistory(UUIDPk, Base):
    """Append-only: a DB trigger rejects UPDATE and DELETE."""
    __tablename__ = "issue_status_history"
    issue_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("issues.id"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(30))
    to_status: Mapped[str] = mapped_column(String(30))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    actor_role: Mapped[str] = mapped_column(String(20))
    reason: Mapped[str | None] = mapped_column(Text)
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    actor: Mapped[User | None] = relationship(lazy="joined")


class IssueUpdate(UUIDPk, Timestamps, Base):
    __tablename__ = "issue_updates"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('progress','official','obstacle','resource_request','assistance_request','dispute')",
            name="ck_issue_updates_kind",
        ),
        CheckConstraint("summary_status IN ('none','pending','approved','rejected')", name="ck_summary_status"),
    )
    issue_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("issues.id"), index=True)
    author_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String(30))
    body: Mapped[str] = mapped_column(Text)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    public_summary: Mapped[str | None] = mapped_column(Text)
    summary_status: Mapped[str] = mapped_column(String(20), default="none")
    summary_source: Mapped[str | None] = mapped_column(String(20))
    author: Mapped[User | None] = relationship(lazy="joined")


class IssueAssignment(UUIDPk, Timestamps, Base):
    __tablename__ = "issue_assignments"
    __table_args__ = (
        Index("uq_one_active_assignment", "issue_id", unique=True, postgresql_where=text("is_active")),
    )
    issue_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("issues.id"), index=True)
    worker_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    department_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("departments.id"))
    assigned_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    instructions: Mapped[str | None] = mapped_column(Text)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    issue: Mapped[Issue] = relationship(back_populates="assignments")
    worker: Mapped[User] = relationship(foreign_keys=[worker_id], lazy="joined")


class IssueEvidence(UUIDPk, Timestamps, Base):
    __tablename__ = "issue_evidence"
    __table_args__ = (
        CheckConstraint("review_status IN ('pending','accepted','disputed','rejected')", name="ck_evidence_review"),
    )
    issue_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("issues.id"), index=True)
    assignment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("issue_assignments.id"))
    submitted_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    description: Mapped[str] = mapped_column(Text)
    work_notes: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    review_status: Mapped[str] = mapped_column(String(20), default="pending")
    submitter: Mapped[User] = relationship(lazy="joined")
    images: Mapped[list["IssueImage"]] = relationship(back_populates="evidence", order_by="IssueImage.created_at")


class IssueImage(UUIDPk, Timestamps, Base):
    __tablename__ = "issue_images"
    __table_args__ = (CheckConstraint("kind IN ('report','before','after','progress')", name="ck_image_kind"),)
    issue_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("issues.id"), index=True)
    uploader_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    evidence_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("issue_evidence.id"))
    kind: Mapped[str] = mapped_column(String(20), default="report")
    url: Mapped[str] = mapped_column(String(500))
    caption: Mapped[str | None] = mapped_column(String(255))
    issue: Mapped[Issue] = relationship(back_populates="images")
    evidence: Mapped[IssueEvidence | None] = relationship(back_populates="images")


class IssueVote(Base):
    __tablename__ = "issue_votes"
    issue_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("issues.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class IssueFollower(Base):
    __tablename__ = "issue_followers"
    issue_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("issues.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class IssueComment(UUIDPk, Timestamps, Base):
    __tablename__ = "issue_comments"
    issue_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("issues.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    parent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("issue_comments.id", ondelete="CASCADE"))
    body: Mapped[str] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(String(500))
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    hidden_reason: Mapped[str | None] = mapped_column(String(255))
    hidden_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    author: Mapped[User] = relationship(foreign_keys=[author_id], lazy="joined")


class CommentReport(UUIDPk, Base):
    __tablename__ = "comment_reports"
    __table_args__ = (Index("uq_comment_report", "comment_id", "reporter_id", unique=True),)
    comment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("issue_comments.id", ondelete="CASCADE"))
    reporter_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    reason: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CitizenFeedback(UUIDPk, Timestamps, Base):
    __tablename__ = "citizen_feedback"
    __table_args__ = (
        CheckConstraint("rating BETWEEN 1 AND 5", name="ck_feedback_rating"),
        Index("uq_feedback_issue_user", "issue_id", "user_id", unique=True),
    )
    issue_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("issues.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    rating: Mapped[int] = mapped_column(Integer)
    was_fixed: Mapped[bool] = mapped_column(Boolean)
    comment: Mapped[str | None] = mapped_column(Text)


class AuditLog(Base):
    """Append-only: a DB trigger rejects UPDATE and DELETE."""
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    actor_role: Mapped[str] = mapped_column(String(20))
    action: Mapped[str] = mapped_column(String(80), index=True)
    entity_type: Mapped[str] = mapped_column(String(50))
    entity_id: Mapped[str | None] = mapped_column(String(64))
    issue_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("issues.id"), index=True)
    old_values = mapped_column(JSONB)
    new_values = mapped_column(JSONB)
    reason: Mapped[str | None] = mapped_column(Text)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    actor: Mapped[User | None] = relationship(lazy="joined")
