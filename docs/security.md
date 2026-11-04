# Commons — Security & Privacy

## Authentication
- Passwords hashed with **bcrypt** (cost 12). Plain passwords are never logged or stored.
- Login returns a **JWT** (HS256, `JWT_SECRET` from env, 12 h lifetime) carrying `sub` (user id)
  and `role`. The role in the token is *not trusted on its own*: every request reloads the user
  from the database, so a deactivated user or changed role takes effect immediately.
- WebSocket connections authenticate with the same token (`/ws?token=…`) and are closed on failure.

## Authorization (RBAC + ownership)
Enforced on the backend by FastAPI dependencies — the frontend only hides buttons.

| Rule | Where enforced |
| --- | --- |
| Citizens cannot call admin endpoints | `require_role("admin")` on every `/api/admin/*` router |
| Workers only see/act on issues with their **active** assignment | `worker_service.get_owned_assignment()` |
| Department admins only manage their department (+ unrouted queue) | `permissions.ensure_admin_scope()` |
| Only the reporter (or admin) can confirm/dispute/reopen | `lifecycle` role rules + reporter check |
| Status can only move along allowed edges, by allowed roles | `lifecycle.TRANSITIONS` |
| Workers cannot mark resolved | No worker edge to `resolved` exists in the table |
| Private chat only visible to participants | participant check on every conversation route + WS fan-out |
| Public endpoints never return reporter identity, email, phone | dedicated `Public*` Pydantic schemas |
| Audit records cannot be edited | no endpoints + DB trigger |
| AI cannot reject/resolve | AI services only *write recommendations*; they never call `lifecycle` |

## Input validation
- All request bodies are Pydantic models with length limits and enums.
- SQLAlchemy parameterised queries everywhere — no string-built SQL. The few raw spatial queries
  use bound parameters.
- Image uploads: content-type allow-list (JPEG/PNG/WebP), 8 MB max, decoded with Pillow to prove
  they are real images, **re-encoded to strip EXIF metadata** (removes embedded GPS of the
  photographer), random UUID filenames (no user-controlled paths).

## Rate limiting
In-memory sliding-window limiter on sensitive endpoints: login (10/min per IP), registration
(5/min), issue creation (10/hour per user/IP), comments (20/min), AI assistant (20/min).
Single-process only — documented trade-off.

## Privacy
- **Anonymous reports**: no account, no name stored. A random 32-byte token is shown once; only
  its SHA-256 hash is stored. Tracking ID + token gives the reporter private access.
- Public issue views show issue location (it is public infrastructure) but never reporter details.
  Comments show display names only.
- AI assistant: answers are built from data the *requesting user* is authorised to see. Private
  fields (emails, phone numbers, reporter ids) are never placed in LLM prompts.

## Email
- Emails are queued during a request and sent only **after the transaction commits**, on a background
  thread — a slow or failing mail server never blocks or breaks a request, and nothing is emailed for a
  rolled-back change. Failures are logged, not raised.
- Emails contain the notification title, a short text and a link — never other people's personal data.
- Every user can opt out (`PATCH /api/auth/me/preferences`); in-app notifications continue.
- SMTP credentials live only in environment variables.

## Photo analysis
- Photos sent to an AI provider are the **cleaned** copies (EXIF and embedded GPS removed).
- The model is told to describe only what is visible and not to identify people or guess locations.
- In rule mode no photo leaves the server.

## Errors & secrets
- Generic error envelope `{ "detail": … }`; stack traces are never returned (global handler logs
  them server-side).
- Secrets come from environment variables; `.env` is git-ignored; `.env.example` has placeholders.
- CORS restricted to `CORS_ORIGINS` (default `http://localhost:5173`).

## Known limitations (honest list)
- JWTs cannot be revoked before expiry (use short lifetime; production could add a denylist).
- Rate limiter and WebSocket hub are per-process.
- A PostgreSQL superuser can disable the audit trigger. In production, run the app as a
  non-owner role: `GRANT INSERT, SELECT ON audit_logs TO app_user` only.
