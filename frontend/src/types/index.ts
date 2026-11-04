// Types mirror the JSON returned by the FastAPI backend (see backend/app/schemas/serializers.py).

export type Role = "citizen" | "admin" | "worker";
export type Status =
  | "submitted" | "pending_verification" | "verified" | "assigned" | "in_progress"
  | "awaiting_verification" | "resolved" | "rejected" | "reopened" | "on_hold" | "escalated";
export type Priority = "low" | "medium" | "high" | "critical";

export interface User {
  id: string; email: string; full_name: string; phone?: string | null; role: Role;
  department: { id: string; name: string } | null; is_active: boolean; created_at: string;
  home_locality_id?: string | null;
  email_notifications: boolean;
}

export interface Ref { id: string; name: string }
export interface CategoryRef extends Ref { slug: string; icon: string }

export interface SLAState {
  state: "none" | "on_track" | "at_risk" | "overdue" | "met" | "missed";
  due_at: string | null; seconds_remaining: number | null; elapsed_seconds: number | null;
}

export interface IssueCard {
  id: string; tracking_id: string; title: string; description: string;
  category: CategoryRef | null; status: Status; status_label: string; priority: Priority | null;
  department: Ref | null; locality: Ref | null; lat: number; lng: number; address: string | null;
  created_at: string; updated_at: string; verified_at: string | null; resolved_at: string | null;
  thumbnail: string | null; is_anonymous: boolean; is_demo: boolean; sla: SLAState;
  escalation_level: number; support_count: number; follower_count: number; distance_m?: number;
}

export interface IssueImage { id: string; url: string; kind: string; caption: string | null; created_at: string }

export interface IssueDetail extends IssueCard {
  additional_info: string | null;
  images: IssueImage[];
  reporter_name: string | null;
  assigned_worker: { name: string; assigned_at: string; acknowledged_at: string | null; due_at: string | null } | null;
  duplicate_of: { tracking_id: string; title: string } | null;
  viewer: { is_reporter: boolean; has_supported: boolean; is_following: boolean; is_assigned_worker: boolean; role: Role | null };
}

export interface TimelineItem {
  id: string; type: "status" | "update" | "evidence" | "ack"; at: string; title: string; body: string | null;
  actor: string; is_public: boolean; status?: Status; from_status?: Status | null; kind?: string;
  images?: { url: string; kind: string }[]; review_status?: string; work_notes?: string | null;
  summary_status?: string; public_summary?: string | null; summary_source?: string | null;
}

export interface Evidence {
  id: string; description: string; work_notes: string | null; submitted_at: string;
  review_status: "pending" | "accepted" | "disputed" | "rejected"; submitted_by: string; before: string[]; after: string[];
}

export interface Assignment {
  id: string; issue_id: string; worker_id: string; worker_name: string; department_id: string;
  instructions: string | null; due_at: string | null; acknowledged_at: string | null; started_at: string | null;
  completed_at: string | null; is_active: boolean; created_at: string;
}

export interface AIRec {
  id: string; kind: string; mode: "llm" | "rules"; provider: string; confidence: number | null;
  decision: "accepted" | "overridden" | null; created_at: string; output: any;
}

export interface DuplicateCandidate {
  issue_id: string; tracking_id: string; title: string; status: Status; category: string | null;
  distance_m: number; score: number; signals: { distance: number; same_category: boolean; text_similarity: number };
}

export interface AdminIssueDetail extends IssueDetail {
  reporter: { name: string; email: string; phone: string | null } | null;
  allowed_transitions: Status[];
  assignments: Assignment[];
  ai: Record<string, AIRec>;
  duplicates: DuplicateCandidate[];
  updates: { id: string; kind: string; body: string; public_summary: string | null; summary_status: string;
             summary_source: string | null; author: string | null; created_at: string }[];
  sla_rule: { response_hours: number; resolution_hours: number; category: string; priority: string } | null;
}

export interface Meta {
  city: { name: string; lat: number; lng: number };
  categories: (CategoryRef & { description: string | null; default_department_id: string | null })[];
  departments: (Ref & { code: string })[];
  localities: (Ref & { is_approximate: boolean })[];
  statuses: { value: Status; label: string }[];
  transitions: { from: Status; to: Status; actors: string[] }[];
  ai: { mode: "llm" | "rules"; provider: string };
}

export interface Overview {
  total: number; pending: number; verified: number; in_progress: number; awaiting_verification: number;
  resolved: number; rejected: number; reopened: number; overdue: number; resolution_rate: number | null;
  avg_resolution_hours: number | null; resolved_sample: number; avg_response_hours: number | null; response_sample: number;
  satisfaction_avg: number | null; satisfaction_sample: number; confirmed_fixed: number; demo_rows: number;
  date_range: { from: string | null; to: string | null }; generated_at: string;
}

export interface TrendPoint { month: string; label: string; reported: number; resolved: number; avg_resolution_hours: number | null }
export interface CategoryStat { id: string; name: string; slug: string; icon: string; total: number; resolved: number; avg_resolution_hours: number | null }
export interface DeptScore {
  id: string; name: string; code: string; assigned: number; resolved: number; resolution_rate: number | null;
  avg_response_hours: number | null; avg_resolution_hours: number | null; overdue_now: number; ever_overdue: number;
  satisfaction_avg: number | null; satisfaction_sample: number; sample_size: number;
  date_range: { from: string | null; to: string | null }; enough_data: boolean;
}

export interface Notification { id: string; kind: string; title: string; body: string | null; link: string | null; issue_id: string | null; read_at: string | null; created_at: string }

export interface Message { id: string; conversation_id: string; sender_id: string; sender_name: string; sender_role: Role; body: string; image_url: string | null; created_at: string }
export interface Conversation {
  id: string; kind: "citizen_admin" | "admin_worker"; subject: string;
  issue: { id: string; tracking_id: string; title: string; status: Status } | null;
  participants: { id: string; name: string; role: Role; last_read_at: string | null; online: boolean }[];
  with: string; last_message: Message | null; unread: number; updated_at: string;
}

export interface Comment {
  id: string; parent_id: string | null; author: string; author_role: Role; is_official: boolean;
  body: string | null; image_url: string | null; is_hidden: boolean; hidden_reason: string | null;
  reports: number | null; is_mine: boolean; created_at: string; replies?: Comment[];
}

export interface Hotspot {
  cluster_id: number; lat: number; lng: number; total: number; open: number; recent_30d: number;
  top_category: string; top_category_count: number; locality: string | null; recurring: boolean; insight: string; method: string;
}

export interface Commitment {
  id: string; title: string; description: string; department: Ref; locality: Ref | null; expected_completion: string;
  progress_percent: number; status: "planned" | "in_progress" | "completed" | "delayed"; evidence_url: string | null;
  progress_note: string | null; is_demo: boolean; created_at: string; updated_at: string;
}

export interface Expenditure {
  id: string; department: Ref; issue: { tracking_id: string; title: string } | null; commitment_id: string | null;
  work_description: string; estimated_cost: number; actual_cost: number | null; currency: string;
  verification_status: "verified" | "unverified"; source_document_url: string | null; is_demo: boolean; updated_at: string;
}

export interface Announcement { id: string; title: string; body: string; is_pinned: boolean; department: string | null; locality: string | null; created_at: string }

export interface Paged<T> { items: T[]; total: number; page: number; page_size: number }
