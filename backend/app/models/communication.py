"""Chat, notifications, announcements, public commitments, expenditure and AI recommendations."""
from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean, CheckConstraint, Date, DateTime, Float, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.session import Base
from app.models.base import Timestamps, UUIDPk, utcnow
from app.models.organization import Department, Locality, User


class Conversation(UUIDPk, Timestamps, Base):
    __tablename__ = "conversations"
    __table_args__ = (CheckConstraint("kind IN ('citizen_admin','admin_worker')", name="ck_conversation_kind"),)
    kind: Mapped[str] = mapped_column(String(30))
    issue_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("issues.id"), index=True)
    subject: Mapped[str] = mapped_column(String(200))
    participants: Mapped[list["ConversationParticipant"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", lazy="selectin"
    )


class ConversationParticipant(Base):
    __tablename__ = "conversation_participants"
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    conversation: Mapped[Conversation] = relationship(back_populates="participants")
    user: Mapped[User] = relationship(lazy="joined")


class Message(UUIDPk, Base):
    __tablename__ = "messages"
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    sender_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text, default="")
    image_url: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    sender: Mapped[User] = relationship(lazy="joined")


class Notification(UUIDPk, Base):
    __tablename__ = "notifications"
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(Text)
    issue_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("issues.id", ondelete="CASCADE"))
    link: Mapped[str | None] = mapped_column(String(255))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Announcement(UUIDPk, Timestamps, Base):
    __tablename__ = "announcements"
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    department_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("departments.id"))
    locality_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("localities.id"))
    published_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    department: Mapped[Department | None] = relationship(lazy="joined")
    locality: Mapped[Locality | None] = relationship(lazy="joined")


class PublicCommitment(UUIDPk, Timestamps, Base):
    __tablename__ = "public_commitments"
    __table_args__ = (
        CheckConstraint("status IN ('planned','in_progress','completed','delayed')", name="ck_commitment_status"),
        CheckConstraint("progress_percent BETWEEN 0 AND 100", name="ck_commitment_progress"),
    )
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    department_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("departments.id"))
    locality_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("localities.id"))
    expected_completion: Mapped[date] = mapped_column(Date)
    progress_percent: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="planned")
    evidence_url: Mapped[str | None] = mapped_column(String(500))
    progress_note: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    department: Mapped[Department] = relationship(lazy="joined")
    locality: Mapped[Locality | None] = relationship(lazy="joined")


class ExpenditureRecord(UUIDPk, Timestamps, Base):
    __tablename__ = "expenditure_records"
    __table_args__ = (
        CheckConstraint("verification_status IN ('verified','unverified')", name="ck_expenditure_verification"),
        CheckConstraint("estimated_cost >= 0 AND (actual_cost IS NULL OR actual_cost >= 0)", name="ck_expenditure_costs"),
    )
    department_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("departments.id"))
    issue_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("issues.id"))
    commitment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("public_commitments.id"))
    work_description: Mapped[str] = mapped_column(Text)
    estimated_cost: Mapped[float] = mapped_column(Numeric(14, 2))
    actual_cost: Mapped[float | None] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    verification_status: Mapped[str] = mapped_column(String(20), default="unverified")
    source_document_url: Mapped[str | None] = mapped_column(String(500))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    department: Mapped[Department] = relationship(lazy="joined")


class AIRecommendation(UUIDPk, Base):
    __tablename__ = "ai_recommendations"
    __table_args__ = (
        CheckConstraint("kind IN ('classification','priority','duplicates','summary')", name="ck_ai_kind"),
        CheckConstraint("decision IS NULL OR decision IN ('accepted','overridden')", name="ck_ai_decision"),
    )
    issue_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("issues.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(30))
    mode: Mapped[str] = mapped_column(String(10))  # llm | rules
    provider: Mapped[str] = mapped_column(String(40))
    output = mapped_column(JSONB)
    confidence: Mapped[float | None] = mapped_column(Float)
    decision: Mapped[str | None] = mapped_column(String(20))
    decided_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class IssueEmailSubscription(UUIDPk, Base):
    """'Get updates on this report' for people without an account. Double opt-in: nothing is sent
    (except the confirmation email) until `confirmed_at` is set from the link in that email."""
    __tablename__ = "issue_email_subscriptions"
    __table_args__ = (UniqueConstraint("issue_id", "email", name="uq_issue_email_subscription"),)
    issue_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("issues.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(255))
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
