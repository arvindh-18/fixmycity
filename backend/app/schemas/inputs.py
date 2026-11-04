"""Pydantic request bodies. Length limits and enums here are the first line of input validation."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

Priority = Literal["low", "medium", "high", "critical"]


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)  # bcrypt uses at most 72 bytes
    full_name: str = Field(min_length=2, max_length=120)
    phone: str | None = Field(default=None, max_length=30)

    @field_validator("password")
    @classmethod
    def strong_enough(cls, v: str) -> str:
        if v.isdigit() or v.isalpha():
            raise ValueError("Use a mix of letters and numbers.")
        if len(v.encode()) > 72:
            raise ValueError("Password is too long.")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class TransitionIn(BaseModel):
    to_status: str
    reason: str | None = Field(default=None, max_length=1000)
    is_public: bool = True


class VerifyIn(BaseModel):
    priority: Priority
    category_id: uuid.UUID | None = None
    department_id: uuid.UUID | None = None
    note: str | None = Field(default=None, max_length=1000)


class RejectIn(BaseModel):
    reason: str = Field(min_length=5, max_length=1000)


class AssignIn(BaseModel):
    worker_id: uuid.UUID
    department_id: uuid.UUID | None = None
    instructions: str | None = Field(default=None, max_length=2000)
    due_at: datetime | None = None


class PriorityIn(BaseModel):
    priority: Priority
    reason: str | None = Field(default=None, max_length=500)


class CategoryIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    icon: str = Field(default="circle-help", max_length=40)
    keywords: list[str] = Field(default_factory=list, max_length=60)
    default_department_id: uuid.UUID | None = None
    is_active: bool = True


class DepartmentIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    code: str = Field(min_length=2, max_length=20, pattern=r"^[A-Z0-9_-]+$")
    description: str | None = Field(default=None, max_length=1000)
    contact_email: EmailStr | None = None


class WorkerIn(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    password: str = Field(min_length=8, max_length=72)
    department_id: uuid.UUID
    employee_code: str = Field(min_length=2, max_length=30)
    skills: str | None = Field(default=None, max_length=500)


class SLAIn(BaseModel):
    category_id: uuid.UUID | None = None
    priority: Priority
    response_hours: int = Field(gt=0, le=24 * 90)
    resolution_hours: int = Field(gt=0, le=24 * 365)
    warning_threshold: float = Field(default=0.75, gt=0, lt=1)
    is_active: bool = True


class UpdateIn(BaseModel):
    kind: Literal["progress", "obstacle", "resource_request", "assistance_request"]
    body: str = Field(min_length=3, max_length=2000)


class OfficialUpdateIn(BaseModel):
    body: str = Field(min_length=3, max_length=2000)


class SummaryDecisionIn(BaseModel):
    approve: bool
    edited_summary: str | None = Field(default=None, max_length=1000)


class PauseIn(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


class ConfirmIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=1000)


class DisputeIn(BaseModel):
    reason: str = Field(min_length=10, max_length=1000)
    rating: int | None = Field(default=None, ge=1, le=5)


class FeedbackIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    was_fixed: bool
    comment: str | None = Field(default=None, max_length=1000)


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    parent_id: uuid.UUID | None = None


class ReportCommentIn(BaseModel):
    reason: str = Field(min_length=3, max_length=255)


class ModerateIn(BaseModel):
    hide: bool
    reason: str | None = Field(default=None, max_length=255)


class MessageIn(BaseModel):
    body: str = Field(default="", max_length=4000)


class ConversationIn(BaseModel):
    issue_id: uuid.UUID
    kind: Literal["citizen_admin", "admin_worker"]
    with_user_id: uuid.UUID | None = None
    subject: str | None = Field(default=None, max_length=200)
    first_message: str = Field(min_length=1, max_length=4000)


class AnnouncementIn(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    body: str = Field(min_length=3, max_length=5000)
    department_id: uuid.UUID | None = None
    locality_id: uuid.UUID | None = None
    is_pinned: bool = False


class CommitmentIn(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=3, max_length=5000)
    department_id: uuid.UUID
    locality_id: uuid.UUID | None = None
    expected_completion: date
    progress_percent: int = Field(default=0, ge=0, le=100)
    status: Literal["planned", "in_progress", "completed", "delayed"] = "planned"
    evidence_url: str | None = Field(default=None, max_length=500)
    progress_note: str | None = Field(default=None, max_length=2000)


class ExpenditureIn(BaseModel):
    department_id: uuid.UUID
    issue_id: uuid.UUID | None = None
    commitment_id: uuid.UUID | None = None
    work_description: str = Field(min_length=3, max_length=2000)
    estimated_cost: float = Field(ge=0)
    actual_cost: float | None = Field(default=None, ge=0)
    verification_status: Literal["verified", "unverified"] = "unverified"
    source_document_url: str | None = Field(default=None, max_length=500)

    @field_validator("verification_status")
    @classmethod
    def verified_needs_source(cls, v, info):
        if v == "verified" and not info.data.get("source_document_url"):
            raise ValueError("Verified expenditure must link to a source document.")
        return v


class AssistantIn(BaseModel):
    question: str = Field(min_length=2, max_length=500)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)


class ClassifyIn(BaseModel):
    title: str = Field(default="", max_length=140)
    description: str = Field(min_length=5, max_length=5000)


class DuplicateCheckIn(BaseModel):
    title: str = Field(default="", max_length=140)
    description: str = Field(default="", max_length=5000)
    category_id: uuid.UUID | None = None
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class AIDecisionIn(BaseModel):
    decision: Literal["accepted", "overridden"]
