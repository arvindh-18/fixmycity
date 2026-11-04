"""Import every model so SQLAlchemy metadata (and Alembic) can see all tables."""
from app.models.organization import (  # noqa: F401
    CitizenProfile, Department, Facility, IssueCategory, Locality, SLAConfiguration, User, WorkerProfile,
    PRIORITIES, ROLES,
)
from app.models.issues import (  # noqa: F401
    AuditLog, CitizenFeedback, CommentReport, Issue, IssueAssignment, IssueComment, IssueEvidence,
    IssueFollower, IssueImage, IssueStatusHistory, IssueUpdate, IssueVote, STATUSES,
)
from app.models.communication import (  # noqa: F401
    AIRecommendation, Announcement, Conversation, ConversationParticipant, ExpenditureRecord, IssueEmailSubscription, Message,
    Notification, PublicCommitment,
)
