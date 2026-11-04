# Commons — Architecture

Commons is a civic issue reporting and resolution platform built around one rule:
**a complaint must never disappear into an administrative black box.** Every report gets a
public tracking ID, a public timeline, an append-only audit trail, and — when someone claims it
is fixed — evidence that a citizen can confirm or dispute.

## 1. Shape of the system

```
┌──────────────────────────── Browser (React + TypeScript, Vite) ───────────────────────────┐
│  Public portal   Citizen portal   Admin console   Worker app (mobile-first)   Public map  │
│        └──────────── shared design system, API client, auth context, WS client ─────────┘ │
└───────────────┬───────────────────────────────────────────────┬─────────────────────────┘
                │ REST (JSON, JWT bearer)                       │ WebSocket (/ws?token=…)
┌───────────────▼───────────────────────────────────────────────▼─────────────────────────┐
│                         FastAPI modular monolith (Python 3.11+)                          │
│  api/  routers per area: auth, issues, public, map, admin, worker, chat, notifications, │
│        community, ai, transparency                                                       │
│  core/ config, security (bcrypt + JWT), permissions (RBAC dependencies), rate limiting    │
│  services/ lifecycle (state machine), audit, sla, notifications, stats, storage, pdf,    │
│        escalation loop, realtime hub                                                     │
│  integrations/ai/ provider interface → RuleBasedProvider | LLMProvider (with fallback)   │
│  models/ SQLAlchemy 2.0 ORM (+ GeoAlchemy2 for PostGIS)     schemas/ Pydantic v2         │
└───────────────┬──────────────────────────────────────────────┬──────────────────────────┘
                │ SQLAlchemy / psycopg 3                       │ file bytes
┌───────────────▼──────────────────┐            ┌──────────────▼─────────────────────────┐
│ PostgreSQL 16 + PostGIS 3        │            │ Object storage: local ./media (default)│
│ geography(Point) + GiST indexes  │            │ or Supabase Storage (env-configured)   │
│ append-only triggers on audit    │            └────────────────────────────────────────┘
└──────────────────────────────────┘
```

**Why a modular monolith?** One deployable, one database, one process to debug — but code is
split by responsibility so each module can be explained (and replaced) on its own. Microservices,
queues and Kubernetes would add operational cost without benefit at this scale.

## 2. Request flow (example: worker submits completion)

1. `POST /api/worker/tasks/{id}/complete` with multipart photos + notes.
2. `require_role("worker")` dependency decodes the JWT and loads the user.
3. Router checks the worker owns an **active assignment** for that issue (ownership check).
4. `storage.save_image()` validates type/size, strips EXIF (removes embedded GPS), stores file.
5. `lifecycle.transition(issue, "awaiting_verification", actor, reason)`:
   - looks up `(current_status → target)` in the transition table,
   - checks the actor's role is allowed for that edge,
   - writes `issue_status_history` + `audit_logs` rows in the same DB transaction.
6. `notifications.notify_issue_event()` creates rows for the reporter, followers and admins,
   and pushes them through the WebSocket hub to anyone connected.
7. Response returns the updated issue; the frontend animates the status chip change.

## 3. Modules

| Module | Responsibility |
| --- | --- |
| `core/config.py` | Typed settings from environment (`.env`). |
| `core/security.py` | bcrypt hashing, JWT creation/verification. |
| `core/deps.py` | `get_current_user`, `optional_user`, `require_role(...)`. |
| `services/lifecycle.py` | The issue state machine — the single place status can change. |
| `services/audit.py` | Append-only audit writer. |
| `services/sla.py` | Picks SLA rule (category+priority), computes due dates, overdue state. |
| `services/escalation.py` | Background loop: warns near deadline, flags overdue, notifies. |
| `services/stats.py` | All dashboard numbers, computed in SQL from live rows. |
| `services/realtime.py` | In-process WebSocket connection hub. |
| `services/pdf_export.py` | Complaint history PDF (ReportLab). |
| `services/email.py` | Email notifications after commit (SMTP or `.eml` outbox), per-user opt-out. |
| `services/geo_import.py` | Imports real ward boundaries and schools/hospitals (GeoJSON or OpenStreetMap). |
| `integrations/ai/*` | Classification, duplicates, priority, hotspots, assistant, summaries. |

## 4. Frontend structure

```
src/
  components/  ui primitives (Button, Badge, Sheet, Skeleton, EmptyState…) + domain widgets
  layouts/     PublicLayout, CitizenLayout, AdminLayout, WorkerLayout
  pages/       one file per route
  features/    issues, map, chat, notifications, ai, transparency (hooks + components)
  services/    api client (fetch wrapper), websocket client
  contexts/    AuthContext, RealtimeContext
  types/       API types mirroring Pydantic schemas
  utils/       formatting, status metadata (colour, label, icon)
```

State: **TanStack Query** caches server data and invalidates on WebSocket events, so a status
change made by an admin appears on the citizen's open page without refresh.

## 5. Key decisions (what · why · alternatives · trade-offs)

| Decision | Why | Alternatives | Trade-off |
| --- | --- | --- | --- |
| PostGIS `geography(Point,4326)` | Metre-accurate `ST_DWithin` for nearby/duplicate search; GiST index | Store lat/lng floats + Haversine in Python | Requires PostGIS extension; queries are faster and simpler |
| Explicit transition table | Status can't be set arbitrarily; every edge is reviewable in one file | Free-form `status` updates | Adding a new state means editing the table (intentional) |
| Append-only audit via DB trigger | Even an admin with API access, or a buggy endpoint, can't rewrite history | App-only enforcement | A DB superuser can still drop the trigger — documented |
| JWT bearer tokens | Stateless, simple to explain, works for REST and WS | Server sessions + cookies | Tokens can't be revoked before expiry (short 12h lifetime) |
| In-process WebSocket hub | No Redis needed for a single server | Redis pub/sub, SSE | Only works with one backend process — fine for this project |
| Rule-based AI fallback | The app is fully usable without any API key | LLM-only | Rule answers are less fluent but deterministic and explainable |
| Email outbox by default | Email can be demonstrated with no mail server; one setting switches to SMTP | Always SMTP, third-party API | `.eml` files aren't delivered anywhere until SMTP is configured |
| Local media storage default | Zero setup; Supabase optional | S3/MinIO | Not suitable for multi-server deployment |
| Recharts + MapLibre | Declarative charts; open-source vector maps without vendor keys | Chart.js, Leaflet, Mapbox | MapLibre needs WebGL |
