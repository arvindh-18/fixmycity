# Deployment Guide: Vercel, Render & Supabase

This guide details how to deploy FixMyCity (Commons) to production using:
- **Frontend**: [Vercel](https://vercel.com/) (React + Vite + TypeScript SPA)
- **Backend**: [Render](https://render.com/) (Docker web service, single always-on Starter instance)
- **Database & Storage**: [Supabase](https://supabase.com/) (Managed PostgreSQL 16 + PostGIS & S3-compatible Object Storage)

---

## Architecture & Production Constraints

```
┌────────────────────────────────┐
│      Vercel (Frontend)         │
│   React SPA + Vite static CDN  │
└───────────────┬────────────────┘
                │
                │ REST API & WebSocket (wss://)
                ▼
┌────────────────────────────────────────────────────────┐
│               Render (Backend Web Service)             │
│   Docker container running FastAPI                     │
│   • Single worker (uvicorn --workers 1)                │
│   • In-memory WebSocket hub & in-memory rate limiter   │
│   • In-process SLA escalation loop                     │
└───────────┬────────────────────────────────┬───────────┘
            │                                │
            │ Database queries (port 6543)   │ Uploads & public media
            ▼                                ▼
┌────────────────────────────────┐ ┌────────────────────────────────┐
│   Supabase Postgres + PostGIS  │ │    Supabase Storage Bucket     │
│   • Transaction pooler (API)   │ │    • Bucket: openward          │
│   • Direct connection (Alembic)│ │    • Public read access        │
└────────────────────────────────┘ └────────────────────────────────┘
```

> [!IMPORTANT]
> **Single Worker & Single Instance Requirement**: The backend must run as a **single instance with a single worker** (`--workers 1`). The WebSocket hub (`services/realtime.py`), rate limiter (`core/rate_limit.py`), and background SLA escalation loop (`main.py`) run in-process in memory. Running multiple workers or instances without a shared message broker would break WebSocket broadcasts and duplicate the escalation scheduler.

---

## 1. Supabase Setup (Database & Storage)

### Step 1.1: Create Project & Region
1. Log in to [Supabase](https://supabase.com/) and click **New project**.
2. Set a strong Database Password and choose a region geographically close to your Render deployment (e.g. `us-east-1` / `eu-central-1`).

### Step 1.2: Enable PostGIS Extension
1. In the Supabase Dashboard, navigate to **Database** → **Extensions**.
2. Search for `postgis` and toggle it **ON** (or open the **SQL Editor** and run:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   ```
3. Verify that the extension is active.

### Step 1.3: Retrieve Database Connection Strings
Go to **Project Settings** → **Database** → **Connection string**:

1. **Transaction Pooler Connection (for application runtime)**:
   - Select **Transaction** mode (Port `6543`).
   - Copy the URI string:
     ```
     postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
     ```
   - This will be set as `DATABASE_URL` on Render. The backend will automatically normalise this to `postgresql+psycopg://`.

2. **Direct Connection (for migrations)**:
   - Select **Session** mode or copy the direct URI (Port `5432`):
     ```
     postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
     ```
   - This will be set as `DIRECT_DATABASE_URL` on Render. Alembic migrations use this connection to bypass transaction pooler constraints.

### Step 1.4: Configure Storage Bucket
1. Go to **Storage** in the left menu.
2. Click **Create new bucket**.
3. Bucket name: `openward` (or a custom name matching `SUPABASE_BUCKET`).
4. Toggle **Public bucket** to **ON** (all uploaded photos for civic reports and completion evidence are publicly viewable).
5. Go to **Project Settings** → **API**:
   - Copy **Project URL** (`SUPABASE_URL`, e.g. `https://xyzcompany.supabase.co`).
   - Copy the `service_role` secret key (`SUPABASE_SERVICE_KEY`, under **Project API keys**). *Do NOT use the anon public key for the backend service.*

---

## 2. Render Setup (Backend Web Service)

### Step 2.1: Deploy via Blueprint or Docker Service
You can deploy using the `render.yaml` Blueprint or manually in the Render Dashboard:

#### Option A: Render Blueprint (Recommended)
1. Push this repository to GitHub.
2. In [Render](https://dashboard.render.com/), click **New** → **Blueprint**.
3. Connect your repository. Render reads `render.yaml` and sets up the `fixmycity-backend` Docker service.
4. Fill in the non-synced secret environment variables in the Render Dashboard.

#### Option B: Manual Web Service Setup
1. In Render, click **New** → **Web Service**.
2. Choose **Build and deploy from a Git repository**.
3. Configure the service settings:
   - **Name**: `fixmycity-backend`
   - **Root Directory**: `backend`
   - **Runtime**: `Docker`
   - **Instance Type / Plan**: `Starter` (avoid Free tier to keep the web service always-on; sleeping services drop active WebSockets and stop background SLA escalation).
   - **Health Check Path**: `/api/health`
   - **Num Instances**: `1`

### Step 2.2: Configure Environment Variables on Render
Set the following environment variables in the Render service settings:

| Variable | Value / Description | Secret? |
|---|---|---|
| `ENVIRONMENT` | `production` | No |
| `DATABASE_URL` | `postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:6543/postgres` | **Yes** |
| `DIRECT_DATABASE_URL` | `postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:5432/postgres` | **Yes** |
| `DB_USE_POOLER` | `true` | No |
| `JWT_SECRET` | Generate a 32+ byte string (`python -c "import secrets; print(secrets.token_urlsafe(48))"`) | **Yes** |
| `JWT_EXPIRY_HOURS` | `12` | No |
| `CORS_ORIGINS` | `https://your-app.vercel.app` (your Vercel frontend URL, no trailing slash) | No |
| `FRONTEND_URL` | `https://your-app.vercel.app` | No |
| `PUBLIC_BASE_URL` | `https://fixmycity-backend.onrender.com` (your Render URL) | No |
| `STORAGE_BACKEND` | `supabase` | No |
| `SUPABASE_URL` | `https://[project-ref].supabase.co` | No |
| `SUPABASE_SERVICE_KEY` | `eyJh...` (`service_role` secret key) | **Yes** |
| `SUPABASE_BUCKET` | `openward` | No |
| `AI_PROVIDER` | `rules` (or `anthropic` / `openai`) | No |
| `AI_API_KEY` | *(Optional, if using LLM)* | **Yes** |
| `AI_MODEL` | *(Optional)* | No |
| `EMAIL_BACKEND` | `smtp` (or `none`) | No |
| `SMTP_HOST` | e.g. `smtp.resend.com` / `smtp.sendgrid.net` | No |
| `SMTP_PORT` | `587` | No |
| `SMTP_USER` | e.g. `resend` / `apikey` | No |
| `SMTP_PASSWORD` | SMTP password or API token | **Yes** |
| `SMTP_FROM` | `FixMyCity <updates@yourdomain.com>` | No |
| `SMTP_STARTTLS` | `true` | No |
| `ENABLE_BACKGROUND_JOBS` | `true` | No |
| `ESCALATION_INTERVAL_SECONDS`| `60` | No |
| `CITY_NAME` | e.g. `Bengaluru` | No |
| `CITY_LAT` | e.g. `12.9716` | No |
| `CITY_LNG` | e.g. `77.5946` | No |

---

## 3. Database Migrations & Initial Seeding

### Migrations
Migrations run automatically on container boot via Docker `CMD`:
```bash
alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1
```
Because `DIRECT_DATABASE_URL` is set, Alembic executes DDL directly on port 5432, properly establishing all tables, spatial indexes, and PostgreSQL append-only triggers on `audit_logs` and `issue_status_history`.

### One-Off Seeding
To populate the production database with initial departments, categories, SLA rules, and demo accounts:

#### Option A: Via Render Shell
1. Navigate to the `fixmycity-backend` service in the Render Dashboard.
2. Click **Shell** in the left menu.
3. Run:
   ```bash
   python seed.py
   ```

#### Option B: From Your Local Terminal Against Supabase
With your local virtual environment active:
```bash
cd backend
DATABASE_URL="postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres" python seed.py
```

---

## 4. Vercel Setup (Frontend)

### Step 4.1: Import Project
1. Log in to [Vercel](https://vercel.com/) and click **Add New** → **Project**.
2. Select your GitHub repository.
3. Configure the project:
   - **Root Directory**: `frontend`
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm ci`

### Step 4.2: Environment Variables
Add the following variable in Vercel:
- `VITE_API_BASE_URL`: `https://fixmycity-backend.onrender.com` (your Render service URL, no trailing slash).
- *(Optional)* `VITE_MAP_STYLE_URL`: Custom MapLibre style URL (defaults to OpenFreeMap positron).

### Step 4.3: SPA Routing
Deep links (e.g. direct visits to `/issues`, `/track`, or `/admin`) are redirected to `/index.html` by `frontend/vercel.json`:
```json
{
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

---

## 5. Post-Deployment Verification Checklist

After deploying frontend and backend, perform this end-to-end verification:

- [ ] **Health Endpoint**:
  Visit `https://<backend-url>/api/health`. Confirm response:
  ```json
  {"status": "ok", "app": "Commons"}
  ```
- [ ] **SPA Deep Links**:
  Visit `https://<frontend-url>/issues` and press **Refresh**. Ensure the page reloads cleanly without a 404 error.
- [ ] **Authentication**:
  Log in using a seeded demo account (`admin@commons.demo` / `Demo@1234` or `priya@commons.demo`). Confirm the JWT is saved and the navigation bar shows the authenticated menu.
- [ ] **Issue Creation with Photo**:
  Submit a new issue with a photo attachment. Verify:
  - The photo uploads successfully.
  - The image URL is hosted under `https://<supabase-ref>.supabase.co/storage/v1/object/public/openward/...`.
  - The image displays properly on the newly created issue page.
- [ ] **Realtime WebSocket Delivery**:
  Open two browser windows (or an incognito window):
  - Window A: Citizen logged in.
  - Window B: Admin logged in.
  - In Window B, change the status of an issue or post a message.
  - In Window A, observe the realtime toast notification and immediate UI update without manually refreshing the browser.

