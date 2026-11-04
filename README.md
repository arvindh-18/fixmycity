# Commons

A civic issue reporting and resolution platform built around one rule: **a complaint must never disappear into
an administrative black box.** Residents report problems, officials verify and route them, field workers fix them
with photo evidence, residents confirm the fix — and every step is on a public, append-only record.

- **Public**: live map, issue pages with an accountability trail, transparency dashboard, commitments, spending.
- **Citizens**: report (or report anonymously), support, follow, discuss, message officials, confirm or dispute fixes.
- **Administrators**: verification queue, routing, assignment, SLA deadlines and escalation, analytics, audit log.
- **Field workers**: mobile-first task app — acknowledge, start, post updates, submit before/after evidence.
- **AI layer** that works with no API key (rule-based demonstration mode) and can use Anthropic or any OpenAI-compatible model,
  including checking report photos.
- **Email notifications**, and an importer for real ward maps and school/hospital locations.

Design: the **Commons** design system (`design/commons-design-system/`, see [docs/design-system.md](docs/design-system.md)),
light and dark themes.

Stack: React + TypeScript + Vite + Tailwind + Framer Motion + Recharts + MapLibre · FastAPI + SQLAlchemy 2 + Alembic ·
PostgreSQL 16 + PostGIS · WebSockets.

---

## 1. Run it locally

### Prerequisites
- Python 3.11+
- Node.js 20+
- Docker (easiest way to get PostgreSQL + PostGIS) — or a local PostgreSQL 14+ with the PostGIS extension

### Database
```bash
docker compose up -d          # starts PostGIS on localhost:5432 (user/password/db: openward)
```
This also creates an `openward_test` database for the test suite.

<details><summary>Without Docker</summary>

Install PostgreSQL and PostGIS (e.g. `apt install postgresql-16-postgis-3`, or the PostGIS bundle in the Windows
StackBuilder / `brew install postgis`), then:
```sql
CREATE USER openward WITH PASSWORD 'openward';
CREATE DATABASE openward OWNER openward;
CREATE DATABASE openward_test OWNER openward;
\c openward      CREATE EXTENSION postgis;
\c openward_test CREATE EXTENSION postgis;
```
</details>

### Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                 # Windows: copy .env.example .env  — then set JWT_SECRET
alembic upgrade head                 # creates all tables, indexes and append-only triggers
python seed.py                       # demo departments, categories, SLAs, accounts and ~84 sample issues
uvicorn app.main:app --reload        # http://localhost:8000  (API docs at /docs)
```

### Frontend
```bash
cd frontend
npm install
npm run dev                          # http://localhost:5173
```
The dev server proxies `/api`, `/media` and `/ws` to the backend, so open **http://localhost:5173**.

### Demo accounts (password for all: `Demo@1234`)
| Role | Email | Notes |
|---|---|---|
| City-wide admin | `admin@commons.demo` | sees everything |
| Department admin | `roads.admin@commons.demo` | Roads & Infrastructure only |
| Field worker | `ravi@commons.demo` (Roads), `deepa@commons.demo` (Water) | |
| Citizen | `priya@commons.demo`, `arjun@commons.demo`, `meera@commons.demo` | |

The sign-in page has a "Fill in" button for each role. Seeded records are flagged `is_demo` and labelled
**Sample data** throughout the UI. `python seed.py --reset` wipes and reseeds.

### A five-minute demo script
1. Sign in as **meera** → *Report an issue* → describe a water leak (watch the category suggestion) → drop the pin → submit.
2. Sign in as **admin** (another browser/incognito) → *Issue queue → To verify* → open it → read the AI panel → *Verify & route* → *Assign worker* → Deepa K.
3. Sign in as **deepa** on a phone-sized window → *Acknowledge* → *Start work* → *Submit completion evidence* with an "after" photo.
4. Back in Meera's window the issue page updates live → *Yes, it's fixed* with a rating — or *No* to reopen it.
5. Open the issue's *Accountability trail*, download the PDF, then check *Admin → Audit log* for the same issue.

---

## 2. Tests
```bash
cd backend
# Uses TEST_DATABASE_URL (default postgresql+psycopg://openward:openward@localhost:5432/openward_test).
# WARNING: the test run drops and recreates the schema of that database.
pytest -q                            # 33 tests

cd ../frontend
npm test                             # 24 tests (Vitest + Testing Library, no browser or backend needed)
npm run build                        # strict TypeScript check + production build
```
**Backend** tests cover authentication, role permissions, department scope, the full lifecycle (verify → assign →
start → evidence → dispute → reassign → confirm), invalid transitions, audit immutability at database level,
public/private data separation, anonymous tracking, live statistics, SLA escalation, one-vote-per-account,
duplicate detection, comments and moderation, private messaging, notifications, WebSocket auth and delivery,
upload validation, map filters, the AI fallback, email delivery and opt-out, photo analysis (with a simulated
vision model and a simulated outage), and the map-data importer.

**Frontend** tests cover the formatting helpers, the API client (auth header, readable validation errors,
expired sessions, network failure), status/priority/deadline components (including "never overdue without a
deadline"), the accountability timeline (public vs staff view), and the whole report form: validation, the
category suggestion, similar-report warnings, the location-confirmation rule and anonymous submission.

---

## 3. Email notifications
Out of the box `EMAIL_BACKEND=outbox`: every email is written as a `.eml` file in `backend/outbox/` —
double-click one to open it in your mail app. This shows email working without a mail server.
To send real email, set in `backend/.env`:
```
EMAIL_BACKEND=smtp
SMTP_HOST=smtp.gmail.com          # or Mailtrap / SendGrid / your provider
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASSWORD=your-app-password   # for Gmail: an app password, not your normal password
SMTP_FROM=Commons <you@gmail.com>
```
Emails go out for status changes, official updates, assignments, deadline warnings, new messages and
announcements. Each user can switch them off under their name in the top-right menu.

Visitors without an account can use **Get updates on this report** on any report page. They get one
confirmation email; updates start only after they open its link, and every update has a one-click
unsubscribe link.

---

## 4. Replacing the demo map data with real data
The demo ships hand-drawn locality shapes and four sample schools/hospitals (both labelled in the app).
Replace them with real data — run from `backend/` with the virtual environment active:
```bash
# Ward boundaries: any GeoJSON with Polygon/MultiPolygon features (city open-data portals publish these).
python -m scripts.import_geo localities wards.geojson --name-field WARD_NAME \
    --source "City ward boundaries 2023" --replace-demo
# Schools, hospitals and clinics from OpenStreetMap (needs internet; also saves facilities-osm.geojson)
python -m scripts.import_geo facilities-osm --radius-km 15 --replace-demo
```
Open the GeoJSON in any text editor to find the property that holds the ward name, and pass it as
`--name-field`. Issues are re-linked to the new areas automatically, and the source text you give is shown
publicly. Check the licence and date of the data you import. `python -m scripts.import_geo --help` lists
all options (population figures, your own facility files).

---

## 5. Configuration
All backend settings are environment variables — see `backend/.env.example` (every variable is commented).
The important ones:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL + PostGIS connection |
| `JWT_SECRET` | signs login tokens — use a long random value |
| `AI_PROVIDER` / `AI_API_KEY` / `AI_MODEL` | `rules` (default), `anthropic` or `openai` (any compatible endpoint via `AI_BASE_URL`) |
| `STORAGE_BACKEND` | `local` (files in `backend/media`) or `supabase` |
| `EMAIL_BACKEND` / `SMTP_*` | `outbox` (default), `smtp` or `none` — see section 3 |
| `CITY_NAME` / `CITY_LAT` / `CITY_LNG` | map centre |

Frontend options (`frontend/.env.example`): `VITE_MAP_STYLE_URL` for a different MapLibre basemap.
Never commit `.env` files (they're git-ignored).

---

## 6. How it fits together
```
frontend (React)  ──REST + JWT──►  FastAPI modular monolith  ──►  PostgreSQL + PostGIS
        ▲                                │                         (append-only triggers)
        └────────── WebSocket ◄──────────┘──► media storage (local / Supabase)
```
```
backend/app/
  api/            routers: auth, public, issues (citizen), community, admin, worker, chat (+ws), ai
  core/           config, security (bcrypt, JWT), deps (RBAC), rate limiting
  models/         SQLAlchemy models (28 tables)
  schemas/        Pydantic inputs + public/private serializers
  services/       lifecycle (state machine), audit, sla, escalation, notifications, email, realtime, stats,
                  storage, pdf, geo_import
  integrations/ai provider, classifier, duplicates, priority, hotspots, assistant, summaries
frontend/src/
  components/     ui primitives, issue widgets (timeline, evidence slider, comments), charts, map
  layouts/        public, admin, worker shells
  pages/          one file per screen (admin/, worker/, citizen/)
  contexts/       auth, realtime (WebSocket)    services/ api client    utils/ status + formatting
```

Detailed documentation, written to be explained in a viva:

| Document | Contents |
|---|---|
| [docs/deployment.md](docs/deployment.md) | step-by-step production setup: Vercel, Render, Supabase, env vars, post-deploy checklist |
| [docs/scaling.md](docs/scaling.md) | current single-process boundaries and future upgrade roadmap |
| [docs/design-system.md](docs/design-system.md) | how the Commons design system is wired in and the mapping decisions |
| [docs/architecture.md](docs/architecture.md) | system shape, request flow, module map, decisions with alternatives and trade-offs |
| [docs/database-schema.md](docs/database-schema.md) | every table, relationships, indexes, immutability |
| [docs/api-design.md](docs/api-design.md) | conventions, status-change routes, WebSocket events, all 103 endpoints |
| [docs/security.md](docs/security.md) | auth, RBAC rules and where they're enforced, privacy, known limitations |
| [docs/features.md](docs/features.md) | what each screen does, AI modes, limitations |
| [docs/implementation-plan.md](docs/implementation-plan.md) | checklist with verified status and next steps |

### The three ideas worth explaining first
1. **The state machine** (`backend/app/services/lifecycle.py`). One table lists every allowed
   `(from, to)` status change and who may make it. Every route that changes status goes through
   `transition()`, which also writes the history and audit rows in the same transaction. A worker literally
   has no edge to `resolved`.
2. **Append-only history**. A PostgreSQL trigger raises an error on any `UPDATE`/`DELETE`/`TRUNCATE` of
   `audit_logs` and `issue_status_history` — so even a bug or an administrator with database API access can't
   rewrite the past. The test `test_audit_and_history_are_append_only` proves it.
3. **Honest numbers**. Every statistic is a SQL aggregate over live rows, returned with its sample size and
   date range. Issues with no SLA rule are never called overdue; spending is never shown as verified without a
   source document; sample data is labelled everywhere.

---

## 7. Deployment
- **[docs/deployment.md](docs/deployment.md)**: Production deployment instructions for **Vercel** (frontend), **Render** (single-worker Docker web service), and **Supabase** (Postgres with PostGIS + photo storage bucket), including full environment variable reference and post-deployment checklist.
- **[docs/scaling.md](docs/scaling.md)**: Honest appraisal of current concurrency limits (single-process WebSocket hub, in-memory rate limiter, in-process escalation loop) and the future roadmap (Redis pub/sub, distributed rate limiting, background worker, and CDN).

---

## 8. Known limitations
- Until you run the importer (section 4), localities are approximate shapes and facilities are samples — both labelled.
- Photo checks need a vision-capable AI model; in the default rule mode photos are stored but not analysed, and the app says so.
- The WebSocket hub and rate limiter live in one process — run a single API worker (as the commands above do).
- JWTs can't be revoked before they expire (12 h by default).
