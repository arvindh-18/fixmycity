# FixMyCity

Report a street problem in under a minute. Snap a photo, Gemini drafts the report, you drop a pin on an
OpenStreetMap map, and everyone can follow it — by **pincode or locality** — until it's fixed.

**What's in it**

- **Report**: photo → Gemini fills category, title, description and urgency · speak the description
  (8 Indian languages) · draggable OSM pin, "use my location", place search · locality + pincode filled from the pin
  · warns about open reports within 150 m so people +1 instead of duplicating.
- **Browse**: search a pincode or locality, filter by status/type, list + map side by side.
- **Report page**: photo, map, progress timeline, "Me too +1", share link.
- **City staff** (emails in `ADMIN_EMAILS`): change status with a note, delete spam.
- **Insights**: open / fixed / average days to fix / new this week, open problems by type, worst areas.
- **Sign-in**: Firebase Authentication (Google + email/password).

**Stack**: React + Vite + Tailwind + Leaflet (OpenStreetMap tiles) + Motion · FastAPI + SQLAlchemy ·
SQLite locally, any Postgres in the cloud · Gemini REST API · Nominatim for geocoding.
One Docker image serves both the API and the app.

```
backend/
  app/
    main.py        FastAPI app, serves the built frontend too
    config.py      every setting, from env vars
    db.py          3 tables: issues, status_updates, upvotes (created on startup)
    auth.py        Firebase ID-token check (only needs the project ID)
    gemini.py      photo → draft report, voice → text
    geocode.py     pin → locality + pincode (OpenStreetMap Nominatim)
    routes/        issues.py (CRUD, +1, status, nearby, areas) · misc.py (config, AI, geo, stats)
  seed.py          ~40 sample reports around Bengaluru
  tests/           pytest, runs on SQLite
frontend/src/
  pages/           Home, Report, Browse, IssueDetail, Stats, SignIn
  components/      StreetScene (parallax hero), IssueMap, VoiceButton, AreaSearch, IssueCard
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
| Real sign-in | `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, `FIREBASE_APP_ID` |
| City staff | `ADMIN_EMAILS=you@gmail.com,teammate@gmail.com` |
| Photo auto-fill + voice fallback | `GEMINI_API_KEY` |
| Another city | `CITY_NAME`, `CITY_LAT`, `CITY_LNG`, `COUNTRY_CODES` |

Restart `uvicorn` after editing `.env`. The frontend reads its config from the API at runtime, so it never needs
rebuilding for config changes.

Tests: `cd backend && pytest -q`

---

## Set up Firebase (5 minutes)

1. [console.firebase.google.com](https://console.firebase.google.com) → **Add project** (Analytics not needed).
2. **Build → Authentication → Get started** → enable **Google** and **Email/Password**.
3. **Project settings → General → Your apps → Web (`</>`)** → register an app → copy `apiKey`, `projectId`,
   `appId` into `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`.
4. After deploying: **Authentication → Settings → Authorized domains** → add your app's domain
   (e.g. `fixmycity.onrender.com`). `localhost` is already there.

No service-account file is needed — the backend checks tokens against Google's public keys.

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
3. Fill in the Firebase, `ADMIN_EMAILS` and `GEMINI_API_KEY` values it asks for → **Apply**.
4. Add the `*.onrender.com` domain to Firebase's authorized domains.
5. Optional sample data: Render → your service → **Shell** → `python seed.py`.

### Option B — Google Cloud Run (same Google project as Firebase)

Cloud Run's disk is wiped on restart, so point `DATABASE_URL` at a hosted Postgres
(free: [Neon](https://neon.tech) or [Supabase](https://supabase.com) → copy the connection string).

```bash
gcloud run deploy fixmycity --source . --region asia-south1 --allow-unauthenticated \
  --set-env-vars "ENVIRONMENT=production,DATABASE_URL=postgresql://...,FIREBASE_PROJECT_ID=...,FIREBASE_API_KEY=...,FIREBASE_APP_ID=...,ADMIN_EMAILS=you@gmail.com,GEMINI_API_KEY=..."
```

Then add the `*.run.app` domain to Firebase's authorized domains.

### Anywhere else

`docker build -t fixmycity . && docker run -p 8000:8000 --env-file .env fixmycity` — Railway, Fly.io and
Koyeb all run the same image.

> With `ENVIRONMENT=production`, demo sign-in is switched off: Firebase must be configured.

---

## API at a glance

Interactive docs at `/docs`.

| Method | Path | |
|---|---|---|
| GET | `/api/config` | Firebase web config, city, categories, whether AI is on |
| GET | `/api/issues?pincode=&locality=&status=active&category=&sort=new\|top&mine=1` | list / filter |
| POST | `/api/issues` (multipart) | create; locality + pincode filled from the pin if blank |
| GET | `/api/issues/{id}` · `/api/issues/{id}/photo` | detail · image |
| POST | `/api/issues/{id}/upvote` | toggle +1 |
| POST | `/api/issues/{id}/status` | staff: `{status, note}` |
| GET | `/api/issues/nearby?lat=&lng=` · `/api/issues/areas` | duplicates check · area search |
| GET | `/api/stats?pincode=&locality=` | the numbers on Insights |
| POST | `/api/ai/analyze` · `/api/ai/transcribe` | Gemini |
| GET | `/api/geo/reverse` · `/api/geo/search` | Nominatim proxy (cached) |

## Ideas for later

Email/WhatsApp updates to the reporter · before/after photos when fixed · locality boundaries from open data ·
heatmap layer · auto-routing to departments · PWA offline drafts.

Map data © OpenStreetMap contributors. Please keep usage light on the public tile and Nominatim servers, or point
the tile URL and `NOMINATIM_URL` at your own/paid provider for real traffic.
