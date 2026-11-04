# Commons — Database Schema

PostgreSQL 16 + PostGIS 3. All primary keys are UUIDs (except `audit_logs`, which uses a
`bigserial` so entries have a strict insertion order). Every mutable table has `created_at` and
`updated_at` (`timestamptz`). Migrations live in `backend/alembic/versions/` (`0001_initial`, `0002_email` user email preference,
`0003_real_geo` MultiPolygon boundaries + boundary source).

## Entity overview

```
users ─┬─< issues (reporter) ─┬─< issue_status_history      (every status change)
       │                      ├─< issue_updates             (progress / official / obstacle notes)
       │                      ├─< issue_images               (report, before, after, progress)
       │                      ├─< issue_evidence ─< issue_images (completion submissions)
       │                      ├─< issue_assignments >─ users (worker)
       │                      ├─< issue_comments ─< comment_reports
       │                      ├─< issue_votes, issue_followers (composite PK: issue_id, user_id)
       │                      ├─< citizen_feedback
       │                      ├─< ai_recommendations
       │                      └─< expenditure_records
       ├─ citizen_profiles (1:1)        departments ─< issue_categories (default department)
       ├─ worker_profiles (1:1)         localities (polygon) ─< issues
       ├─< notifications                sla_configurations (category × priority)
       └─< conversation_participants >─ conversations ─< messages
audit_logs (append-only)   public_commitments   announcements   facilities (schools/hospitals)
```

## Adjustments to the suggested entity list

| Suggested | Decision | Reason |
| --- | --- | --- |
| `IssueLocations` | Merged into `issues.location` (+ `address`, `locality_id`) | An issue has exactly one location; a 1:1 table adds a join with no benefit. |
| `IssueImages` + `IssueEvidence` | Both kept; images optionally link to an evidence row | Evidence is a *submission* (notes, timestamp, worker); images are files. |
| — | Added `issue_updates` | Progress notes, obstacles, resource requests and official updates with a public/internal flag and AI summary approval state. |
| — | Added `comment_reports` | Needed for moderation (one report per user per comment). |
| — | Added `facilities` | Reliable-location data for school/hospital proximity in priority scoring. |

## Tables (key columns)

### users
`id`, `email` (unique, lower-cased), `password_hash` (bcrypt), `full_name`, `phone`,
`role` (`citizen` | `admin` | `worker`), `department_id` → departments (admin scope / worker team,
nullable), `is_active`, `email_notifications` (user's email opt-in, default true).
An admin with `department_id = NULL` is a city-wide admin; with a department set, they only
manage that department's issues plus the unrouted verification queue.

### citizen_profiles / worker_profiles
1:1 with users. Citizen: `home_locality_id`. Worker: `employee_code`, `skills`, `department_id`.

### departments
`name`, `code` (unique), `description`, `contact_email`.

### issue_categories
`name`, `slug` (unique), `icon`, `keywords text[]` (used by the rule-based classifier),
`default_department_id`, `is_active`. Admin-configurable.

### localities
`name`, `boundary geography(MultiPolygon,4326)` (multi-part wards import without loss),
`is_approximate` (true for hand-drawn demo boundaries — shown in the UI), `boundary_source` (shown
publicly, e.g. "City ward map 2023"), `population` + `population_source` (both nullable; population
estimates are only shown when a source is recorded). Real boundaries are loaded with
`python -m scripts.import_geo localities …`, which then re-links every issue to the smallest containing area.

### issues
| column | notes |
| --- | --- |
| `tracking_id` | unique, human-readable `CM-2026-7KQ4MX` |
| `title`, `description` | validated length |
| `category_id`, `department_id`, `locality_id` | FKs |
| `status` | constrained to the lifecycle states (CHECK constraint) |
| `priority` | `low`/`medium`/`high`/`critical`, nullable until verified |
| `reporter_id` | nullable for anonymous reports |
| `is_anonymous`, `anon_token_hash` | anonymous tracking: the secret token is shown once, only its SHA-256 is stored |
| `location geography(Point,4326)` | GiST index |
| `address` | free text |
| `response_due_at`, `resolution_due_at`, `sla_config_id` | set at verification from SLA rules; NULL ⇒ never shown as overdue |
| `sla_warning_sent_at`, `overdue_flagged_at` | escalation loop bookkeeping |
| `escalation_level` | 0 normal, 1 warned, 2 overdue-flagged |
| `verified_at`, `resolved_at`, `first_response_at` | used for response/resolution time stats |
| `duplicate_of_id` | set only by an admin after review — never automatic |
| `is_demo` | seeded sample rows; dashboards show a "contains demo data" label |

Indexes: `status`, `category_id`, `department_id`, `locality_id`, `created_at`,
GiST on `location`.

### issue_status_history
`issue_id`, `from_status`, `to_status`, `actor_id`, `actor_role`, `reason`, `is_public`,
`created_at`. **Append-only** (trigger rejects UPDATE/DELETE).

### issue_updates
`issue_id`, `author_id`, `kind` (`progress`, `official`, `obstacle`, `resource_request`,
`assistance_request`, `dispute`), `body`, `is_public`, `public_summary`, `summary_status`
(`none`/`pending`/`approved`/`rejected`), `summary_source` (`llm`/`rules`).

### issue_assignments
`issue_id`, `worker_id`, `department_id`, `assigned_by`, `instructions`, `due_at`,
`acknowledged_at`, `started_at`, `completed_at`, `is_active`. Partial unique index: one active
assignment per issue.

### issue_images
`issue_id`, `uploader_id`, `evidence_id` (nullable), `kind` (`report`/`before`/`after`/`progress`),
`url`, `caption`.

### issue_evidence
`issue_id`, `assignment_id`, `submitted_by`, `description`, `work_notes`, `submitted_at`,
`review_status` (`pending`/`accepted`/`disputed`/`rejected`).

### issue_comments / comment_reports
Comments: `issue_id`, `author_id`, `parent_id` (one level of replies), `body`, `image_url`,
`is_hidden`, `hidden_reason`, `hidden_by`. Reports: unique `(comment_id, reporter_id)`.
A comment is auto-hidden for review after 3 distinct reports.

### issue_votes / issue_followers
Composite primary key `(issue_id, user_id)` — the database itself prevents double support.

### conversations / conversation_participants / messages
Conversation `kind`: `citizen_admin` or `admin_worker`, linked `issue_id`.
Participants hold `last_read_at` (drives unread counts and read receipts).

### notifications
`user_id`, `kind`, `title`, `body`, `issue_id`, `link`, `read_at`.

### audit_logs (append-only)
`id bigserial`, `actor_id`, `actor_role`, `action` (e.g. `issue.status_changed`,
`issue.assigned`, `sla.updated`), `entity_type`, `entity_id`, `issue_id`, `old_values jsonb`,
`new_values jsonb`, `reason`, `ip_address`, `created_at`.

Immutability: a PL/pgSQL trigger `forbid_mutation()` raises on `UPDATE` or `DELETE` for
`audit_logs` and `issue_status_history`. The application exposes no edit/delete endpoints for
them. (A database superuser could still drop the trigger; in production the app would connect
as a role without `TRIGGER`/ownership privileges — see security.md.)

### sla_configurations
`category_id` (nullable = applies to all categories), `priority`, `response_hours`,
`resolution_hours`, `warning_threshold` (fraction of window elapsed before warning, e.g. 0.75),
`is_active`. Lookup order: category+priority → any-category+priority.

### public_commitments
`title`, `description`, `department_id`, `locality_id`, `expected_completion`,
`progress_percent`, `status` (`planned`/`in_progress`/`completed`/`delayed`), `evidence_url`,
`created_by`.

### expenditure_records
`department_id`, `issue_id`/`commitment_id` (optional links), `work_description`,
`estimated_cost`, `actual_cost` (nullable), `currency`, `verification_status`
(`verified`/`unverified`), `source_document_url`, `is_demo`. Unverified and demo rows are always
labelled in the UI.

### citizen_feedback
`issue_id`, `user_id`, `rating` (1–5, CHECK), `was_fixed` (bool), `comment`. Unique per user/issue.

### ai_recommendations
`issue_id`, `kind` (`classification`/`priority`/`duplicates`/`summary`), `mode`
(`llm`/`rules`), `provider`, `output jsonb`, `confidence`, `decision` (`accepted`/`overridden`/NULL),
`decided_by`.

### announcements
`title`, `body`, `department_id`, `locality_id`, `published_by`, `is_pinned`.

### facilities
`name`, `kind` (`school`/`hospital`/`clinic`…), `location geography(Point)`, `source`, `is_demo`.
