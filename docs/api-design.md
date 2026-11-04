# Commons — API Design

Base URL in development: `http://localhost:8000` (the Vite dev server proxies `/api`, `/media` and `/ws`).
Interactive documentation is generated automatically at **`/docs`** (Swagger UI) and `/redoc`.

## Conventions
- JSON in and out, except uploads (`multipart/form-data`: report photos, worker evidence, chat images, comment photos).
- Auth: `Authorization: Bearer <token>` from `/api/auth/login` or `/api/auth/register`.
- Errors: `{ "detail": "Human-readable message" }`, or a list of field errors for validation (HTTP 422).
  Status codes: 401 not signed in · 403 role/ownership denied · 404 not found · 409 invalid state change or duplicate · 413/415 upload rejected · 429 rate limited.
- Issues are addressed by **tracking ID** (`CM-2026-7KQ4MX`) in read routes and by **UUID** in write routes.
- Public routes return public-safe serializers only (no reporter identity, email, phone or internal notes).

## Status change routes (the only ways status can change)
| Who | Route | Edge(s) |
|---|---|---|
| Admin | `POST /api/admin/issues/{id}/verify` | submitted / pending_verification / reopened → verified |
| Admin | `POST /api/admin/issues/{id}/reject` | → rejected (reason required) |
| Admin | `POST /api/admin/issues/{id}/assign` | verified / reopened / escalated / on_hold → assigned (reassign keeps status) |
| Admin | `POST /api/admin/issues/{id}/transition` | pending_verification, on_hold, escalated, send back (awaiting → in_progress), resolved (requires evidence), reopened |
| Admin | `POST /api/admin/issues/{id}/mark-duplicate?of=CM-…` | → rejected with link to the original |
| Worker | `POST /api/worker/tasks/{id}/start` | assigned / on_hold / escalated → in_progress |
| Worker | `POST /api/worker/tasks/{id}/pause` | → on_hold (reason required) |
| Worker | `POST /api/worker/tasks/{id}/complete` | in_progress → awaiting_verification (≥1 "after" photo) |
| Reporter | `POST /api/issues/{id}/confirm` | awaiting_verification → resolved (+ rating) |
| Reporter | `POST /api/issues/{id}/dispute` | awaiting_verification / resolved → reopened |
| Reporter | `POST /api/issues/{id}/reopen` | resolved → reopened |

All of them call `services/lifecycle.transition()`, which checks the transition table and the actor's role.
`GET /api/meta` returns the full transition table so the frontend and documentation never drift.

## WebSocket
`GET /ws?token=<jwt>` — server → client events:
```json
{"type": "notification", "notification": {"id": "…", "kind": "status_changed", "title": "…", "link": "/issues/CM-…"}}
{"type": "message", "message": {"id": "…", "conversation_id": "…", "body": "…"}}
{"type": "read", "conversation_id": "…", "user_id": "…", "at": "…"}
{"type": "issue_updated", "issue_id": "…", "tracking_id": "CM-…"}
```
Client may send `ping`; the server replies `{"type":"pong"}`. Events are sent only after the database commit.

## Endpoints

### Auth — Public / signed-in

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Register |
| POST | `/api/auth/login` | Login |
| GET | `/api/auth/me` | Me |
| PATCH | `/api/auth/me/preferences` | Update Preferences |

### Public — Public (optional sign-in)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/meta` | Meta |
| GET | `/api/issues` | List Issues |
| GET | `/api/issues/{tracking_id}` | Get Issue |
| GET | `/api/issues/{tracking_id}/timeline` | Get Timeline |
| GET | `/api/issues/{tracking_id}/evidence` | Get Evidence |
| GET | `/api/issues/{tracking_id}/export.pdf` | Export Pdf |
| POST | `/api/track` | Track Anonymous |
| GET | `/api/activity` | Activity |
| GET | `/api/map/issues` | Map Issues |
| GET | `/api/map/localities` | Map Localities |
| GET | `/api/localities/{locality_id}/stats` | Locality Stats |
| GET | `/api/nearby` | Nearby |
| GET | `/api/stats/overview` | Stats Overview |
| GET | `/api/stats/trends` | Stats Trends |
| GET | `/api/stats/categories` | Stats Categories |
| GET | `/api/stats/priorities` | Stats Priorities |
| GET | `/api/stats/departments` | Stats Departments |
| GET | `/api/stats/localities` | Stats Localities |
| GET | `/api/hotspots` | Get Hotspots |
| GET | `/api/commitments` | List Commitments |
| GET | `/api/expenditures` | List Expenditures |
| GET | `/api/announcements` | List Announcements |
| POST | `/api/issues/{issue_id}/subscribe` | Subscribe |
| POST | `/api/subscriptions/{token}/confirm` | Confirm |
| POST | `/api/subscriptions/{token}/unsubscribe` | Unsubscribe |

### Citizen — Citizen (report: anyone)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/issues` | Report Issue |
| POST | `/api/issues/check-duplicates` | Check Duplicates |
| GET | `/api/me/issues` | My Issues |
| GET | `/api/me/following` | My Following |
| POST | `/api/issues/{issue_id}/support` | Support |
| DELETE | `/api/issues/{issue_id}/support` | Unsupport |
| POST | `/api/issues/{issue_id}/follow` | Follow |
| DELETE | `/api/issues/{issue_id}/follow` | Unfollow |
| POST | `/api/issues/{issue_id}/confirm` | Confirm Resolution |
| POST | `/api/issues/{issue_id}/dispute` | Dispute Resolution |
| POST | `/api/issues/{issue_id}/reopen` | Reopen |
| POST | `/api/issues/{issue_id}/feedback` | Feedback |
| GET | `/api/issues/{issue_id}/feedback` | Feedback Summary |

### Community — Read public, write signed-in

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/issues/{issue_id}/comments` | List Comments |
| POST | `/api/issues/{issue_id}/comments` | Add Comment |
| POST | `/api/comments/{comment_id}/report` | Report Comment |

### Communication — Signed-in participants

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/conversations` | List Conversations |
| POST | `/api/conversations` | Start Conversation |
| GET | `/api/conversations/unread` | Unread Total |
| GET | `/api/conversations/{conv_id}/messages` | Messages |
| POST | `/api/conversations/{conv_id}/messages` | Send Message |
| POST | `/api/conversations/{conv_id}/read` | Mark Read |
| GET | `/api/notifications` | List Notifications |
| POST | `/api/notifications/{nid}/read` | Read Notification |
| POST | `/api/notifications/read-all` | Read All |

### Admin — Admin only

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/issues` | Admin Issues |
| GET | `/api/admin/queues` | Queue Counts |
| GET | `/api/admin/issues/{tracking_id}` | Admin Issue Detail |
| POST | `/api/admin/issues/{issue_id}/verify` | Verify |
| POST | `/api/admin/issues/{issue_id}/reject` | Reject |
| POST | `/api/admin/issues/{issue_id}/transition` | Admin Transition |
| POST | `/api/admin/issues/{issue_id}/assign` | Assign |
| POST | `/api/admin/issues/{issue_id}/priority` | Set Priority |
| POST | `/api/admin/issues/{issue_id}/official-update` | Official Update |
| POST | `/api/admin/issues/{issue_id}/mark-duplicate` | Mark Duplicate |
| POST | `/api/admin/issues/{issue_id}/ai/refresh` | Refresh Ai |
| POST | `/api/admin/ai/{rec_id}/decision` | Ai Decision |
| GET | `/api/admin/summaries` | Pending Summaries |
| POST | `/api/admin/updates/{update_id}/summary` | Decide Summary |
| GET | `/api/admin/dashboard` | Dashboard |
| POST | `/api/admin/escalation/run` | Run Escalation |
| GET | `/api/admin/departments` | Departments |
| POST | `/api/admin/departments` | Create Department |
| PUT | `/api/admin/departments/{dept_id}` | Update Department |
| GET | `/api/admin/categories` | Categories |
| POST | `/api/admin/categories` | Create Category |
| PUT | `/api/admin/categories/{cat_id}` | Update Category |
| GET | `/api/admin/workers` | Workers |
| POST | `/api/admin/workers` | Create Worker |
| POST | `/api/admin/workers/{worker_id}/active` | Set Worker Active |
| GET | `/api/admin/sla` | Sla Rules |
| POST | `/api/admin/sla` | Upsert Sla |
| POST | `/api/admin/announcements` | Create Announcement |
| POST | `/api/admin/commitments` | Create Commitment |
| PUT | `/api/admin/commitments/{cid}` | Update Commitment |
| POST | `/api/admin/expenditures` | Create Expenditure |
| PUT | `/api/admin/expenditures/{eid}` | Update Expenditure |
| GET | `/api/admin/moderation` | Moderation Queue |
| POST | `/api/admin/comments/{comment_id}/moderate` | Moderate |
| GET | `/api/admin/audit` | Audit Log |
| GET | `/api/admin/users` | Users |

### Worker — Assigned worker only

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/worker/tasks` | Tasks |
| GET | `/api/worker/stats` | Worker Stats |
| GET | `/api/worker/tasks/{issue_id}` | Task Detail |
| POST | `/api/worker/tasks/{issue_id}/acknowledge` | Acknowledge |
| POST | `/api/worker/tasks/{issue_id}/start` | Start |
| POST | `/api/worker/tasks/{issue_id}/pause` | Pause |
| POST | `/api/worker/tasks/{issue_id}/updates` | Add Update |
| POST | `/api/worker/tasks/{issue_id}/complete` | Complete |

### Ai — Public (rate-limited)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/ai/status` | Status |
| POST | `/api/ai/classify` | Classify |
| POST | `/api/ai/assistant` | Ask |
| POST | `/api/ai/classify-photo` | Classify Photo |
