# FixMyCity

Report a street problem in under a minute. Snap a photo, Gemini drafts the report, you drop a pin on an
OpenStreetMap map, and everyone can follow it — by **pincode or locality** — until it's fixed.

**What's in it**

- **Report**: photo → Gemini fills category, title, description and urgency · speak the description
  (8 Indian languages) · draggable OSM pin, "use my location", place search · locality + pincode filled from the pin
  · warns about open reports within 150 m so people +1 instead of duplicating.
- **Browse**: search a pincode or locality, filter by status/type, list + map side by side.
- **Report page**: photo, map, progress timeline, "Me too +1", share link.
- **Describe it in your words**: speak or type in English, தமிழ் or हिन्दी and Gemini fills the form
  (category, title, English description, urgency, landmark). The original words are kept on the report.
- **Use my location**: a you-are-here map of every report around you, closest first, filter by status and distance.
- **Chat** on each report between the reporter, field workers and admins (with unread badges).
- **Duplicates**: a new report of the same type within 100 m that's described alike is flagged; admins merge it
  (+1s and messages move over) or dismiss it.
- **Three logins** (tabs on the sign-in page):
  - **Resident**: anyone. Report, +1, chat on your own reports.
  - **Field worker** (`/worker`): My jobs / Nearby / Done, "Start work", and "Mark fixed", which requires an *after*
    photo as proof.
  - **City admin** (`/admin`): needs-attention list with assign-to-worker, duplicate review, team management,
    close/reopen/delete.
- **Insights + proof of work**: open / fixed / average days to fix, a "reported vs fixed, last 8 weeks" chart,
  recent before/after photos, open problems by type, worst areas.
- **Sign-in**: Supabase Authentication (Google + email/password).

**Stack**: React + Vite + Tailwind + Leaflet (OpenStreetMap tiles) + Motion · FastAPI + SQLAlchemy ·
SQLite locally, any Postgres in the cloud · Gemini REST API · Nominatim for geocoding.
One Docker image serves both the API and the app.

```
backend/
  app/
    main.py        FastAPI app, serves the built frontend too
    config.py      every setting, from env vars
    db.py          tables (created on startup; new columns are added automatically)
    auth.py        Supabase access token check + public/worker/admin roles
    gemini.py      photo → draft report, voice → text, free text (en/ta/hi) → structured report
    duplicates.py  duplicate scoring + merge
    geocode.py     pin → locality + pincode (OpenStreetMap Nominatim)
    routes/        issues.py (CRUD, +1, status, assign, fix, near, areas) · messages.py (chat)
                   admin.py (duplicates) · misc.py (config, staff, AI, geo, stats)
  seed.py          ~40 sample reports around Chennai
  tests/           pytest, runs on SQLite
frontend/src/
  pages/           Home, Report, Browse, IssueDetail, Stats, SignIn, AdminHome, AdminDuplicates, WorkerHome
  components/      StreetScene (parallax hero), IssueMap, NearMe, Messages, FixSheet, ProofOfWork,
                   VoiceButton, AreaSearch, IssueCard
```

---

## Run it locally (2 terminals, ~3 minutes)

Needs Python 3.11+ and Node 20+.

```bash
# 1. API
cd backend
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python seed.py                                         # optional sample data
uvicorn app.main:app --reload                          # http://localhost:8000

# 2. App
cd frontend
npm install
npm run dev                                            # http://localhost:5173
```

With no `.env` at all you get **demo mode**: one-click sign-in as a resident or as city staff, SQLite database,
and the AI buttons hidden. Add keys to `.env` (copy `.env.example`, root or `backend/`) to switch things on:

| To enable | Set |
|---|---|
| Real sign-in | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| City staff | `ADMIN_EMAILS=you@gmail.com,teammate@gmail.com` |
| Photo auto-fill + voice fallback | `GEMINI_API_KEY` |
| Another city | `CITY_NAME`, `CITY_LAT`, `CITY_LNG`, `COUNTRY_CODES` |

Restart `uvicorn` after editing `.env`. The frontend reads its config from the API at runtime, so it never needs
rebuilding for config changes.

Tests: `cd backend && pytest -q`

---

## Set up Supabase (5 minutes)

1. [supabase.com](https://supabase.com) → **New project**.
2. **Authentication → Providers**:
   - Enable **Email** with **Confirm email** ON.
   - Enable **Google** (client ID and secret from Google Cloud; add `https://<project-ref>.supabase.co/auth/v1/callback` as redirect URI).
3. **Authentication → URL Configuration**:
   - Set **Site URL** to your app's URL.
   - Add redirect URLs: `http://localhost:5173/**` and `https://<your-render-domain>/**`.
4. **Project Settings → API Keys** → copy the Project URL and the anon/publishable key into `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

No service-role secret is needed — the backend checks access tokens against Supabase's public JWKS.

**Roles.** Put city admins' emails in `ADMIN_EMAILS` (comma-separated). Field workers can go in `WORKER_EMAILS`,
or an admin adds them from **Admin → Team**. Each person then creates a normal account with that email
and signs in on the matching tab. Without Supabase (local dev) the sign-in page offers one-click demo accounts for
all three roles.

**Sign-in does nothing / shows "could not be verified"?** Check that `SUPABASE_URL` and `SUPABASE_ANON_KEY` match your
project, and that the server's clock is roughly right (60 s of drift is tolerated).

## Get a Gemini key (1 minute)

[aistudio.google.com/apikey](https://aistudio.google.com/apikey) → **Create API key** → `GEMINI_API_KEY`.
The model defaults to `gemini-3.6-flash`; change it with `GEMINI_MODEL`.

---

## Deploy

Production is a single container: the Dockerfile builds the React app and FastAPI serves it, so there is one URL,
no CORS, and nothing to configure on the frontend.

### Option A — Render (easiest, free)

1. Push this repo to GitHub.
2. Render → **New → Blueprint** → pick the repo. `render.yaml` creates the web service **and** a free Postgres
   database, and connects them.
3. Fill in the Supabase, `ADMIN_EMAILS` and `GEMINI_API_KEY` values it asks for → **Apply**.
4. Add the `*.onrender.com` domain to Supabase's redirect URLs and authorized domains.
5. Optional sample data: Render → your service → **Shell** → `python seed.py`.

### Option B — Google Cloud Run

Cloud Run's disk is wiped on restart, so point `DATABASE_URL` at a hosted Postgres
(free: [Neon](https://neon.tech) or [Supabase](https://supabase.com) → copy the connection string).

```bash
gcloud run deploy fixmycity --source . --region asia-south1 --allow-unauthenticated \
  --set-env-vars "ENVIRONMENT=production,DATABASE_URL=postgresql://...,SUPABASE_URL=https://...,SUPABASE_ANON_KEY=...,ADMIN_EMAILS=you@gmail.com,GEMINI_API_KEY=..."
```

Then add the `*.run.app` domain to Supabase's redirect URLs.

### Anywhere else

`docker build -t fixmycity . && docker run -p 8000:8000 --env-file .env fixmycity` — Railway, Fly.io and
Koyeb all run the same image.

> With `ENVIRONMENT=production`, demo sign-in is switched off: Supabase must be configured.

---

## Demo build

`DEMO_MODE=1` turns this same code into a self-contained demo: mock data around Saveetha Engineering College
(`python backend/demo_seed.py`), a **Demo box** to switch between resident / field worker / admin personas, a guided
tour, a developer console at `/dev`, and an offline stand-in for Gemini. All of it is refused when
`ENVIRONMENT=production`.

## Who can do what

| | Visitor | Resident | Field worker | City admin |
|---|---|---|---|---|
| See every report, timeline, who's responsible, before/after, proof-of-work chart | ✓ | ✓ | ✓ | ✓ |
| Report a problem | | ✓ | | |
| +1 a report | | not their own | | |
| Chat | | their reports | their jobs (or unassigned) | |
| Start work / mark fixed (after photo required) | | | ✓ | any status |
| Assign, merge duplicates, close, delete, team | | | | ✓ |

## API at a glance

Interactive docs at `/docs`.

| Method | Path | |
|---|---|---|
| GET | `/api/config` | Supabase web config, city, categories, whether AI is on |
| GET | `/api/issues?pincode=&locality=&status=active&category=&sort=new\|top\|fixed&mine=1&worker=me&unassigned=1` | list / filter |
| POST | `/api/issues` (multipart) | create; locality + pincode filled from the pin if blank |
| GET | `/api/issues/{id}` · `/api/issues/{id}/photo` | detail · image |
| POST | `/api/issues/{id}/upvote` | toggle +1 |
| POST | `/api/issues/{id}/status` | worker: `in_progress`/`resolved` (needs after photo) · admin: any |
| POST | `/api/issues/{id}/fix` (multipart) · GET `/api/issues/{id}/after-photo` | worker marks fixed with proof photo |
| POST | `/api/issues/{id}/assign` | admin: `{email}` |
| GET/POST | `/api/issues/{id}/messages?after=` | chat (reporter, workers, admins) |
| GET | `/api/issues/near?lat=&lng=&radius=&status=` | "use my location", closest first |
| GET | `/api/issues/nearby?lat=&lng=` · `/api/issues/areas` | duplicates check · area search |
| GET | `/api/admin/duplicates` · POST `…/{id}/merge` `{keep_id}` · POST `…/{id}/dismiss` | admin duplicate review |
| GET/POST/DELETE | `/api/staff` | admin: team (workers / admins) |
| GET | `/api/stats?pincode=&locality=` · `/api/stats/weekly?weeks=8` · `/api/stats/recent-fixes` | Insights + proof of work |
| POST | `/api/ai/analyze` · `/api/ai/transcribe` · `/api/ai/structure` `{text, lang: en\|ta\|hi}` | Gemini |
| GET | `/api/geo/reverse` · `/api/geo/search` | Nominatim proxy (cached) |

## Ideas for later

Email/WhatsApp updates to the reporter · live chat over WebSockets · locality boundaries from open data ·
heatmap layer · auto-routing to departments · PWA offline drafts.

Map data © OpenStreetMap contributors. Please keep usage light on the public tile and Nominatim servers, or point
the tile URL and `NOMINATIM_URL` at your own/paid provider for real traffic.
