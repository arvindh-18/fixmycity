# Antigravity prompt: FixMyCity next features

Paste everything below the line into Antigravity. Run it on a fresh branch.

---

You are working on **FixMyCity**, a civic-issue reporting app. Residents report problems (potholes, garbage, streetlights…), field workers fix them, and city admins manage everything. Read the codebase before you change anything, and **extend the existing code. Don't rewrite it.**

## The codebase (read these first)

- **Backend:** FastAPI + SQLAlchemy 2 in `backend/app/`. SQLite locally, Postgres in production. Tables are created by `init_db()` (`Base.metadata.create_all`); there are no migrations, so new tables are fine, but **adding columns to existing tables needs a small startup step** (`ALTER TABLE … ADD COLUMN` if missing) that works on both SQLite and Postgres.
  - `app/auth.py`: Supabase token verification and the **three roles: `public`, `worker`, `admin`**. Use the dependencies `current_user`, `staff_user` (worker or admin) and `admin_user`. Dev tokens are `dev:<uid>:<name>:<0|w|1>`.
  - `app/db.py`: `Issue`, `StatusUpdate`, `Upvote`, `StaffMember`, `CATEGORIES`, `STATUSES`.
  - `app/routes/issues.py`: issue CRUD, `/nearby` (open issues within N metres, with a haversine `_distance_m`), and `/status` (workers may only set `in_progress`/`resolved`).
  - `app/routes/misc.py`: `/config`, `/me`, `/staff` (team management), `/ai/analyze`, `/ai/transcribe`, `/geo/*`, `/stats`.
  - `app/gemini.py`: plain-REST Gemini calls through `_call(parts, json_schema)` with structured JSON output. **Reuse `_call`.** Don't add an SDK.
  - `tests/test_api.py`: pytest with dev tokens and monkeypatched Gemini/geocode. **Every new endpoint needs a test here, and all tests must pass.**
- **Frontend:** React 19 + Vite + TypeScript + Tailwind v4 + react-leaflet (OpenStreetMap tiles) + lucide-react icons + `motion`.
  - Design tokens are in `src/index.css` (`--color-chalk`, `ink`, `civic`, `paint`, `st-open/progress/fixed/closed` + `-soft`), with utility classes `btn-ink`, `btn-ghost`, `btn-paint`, `btn-sm`, `chip`, `field`, `label`, and `rounded-[var(--radius-card)]`. Fonts: Bricolage Grotesque (display), Public Sans (body). **Use only these tokens and classes, so new pages look like the existing ones.**
  - `src/lib/api.ts`: the `api<T>()` helper (adds the auth token and throws readable errors). `src/lib/auth.tsx`: `useAuth()` returns `{ me, config }`, where `me.role` is `"public" | "worker" | "admin"`, plus `homeFor(role)`.
  - `src/components/IssueMap.tsx`: `IssueMap`, `PinPicker`, `statusIcon(status)`. `src/components/VoiceButton.tsx`: browser speech recognition with a Gemini fallback, plus `VOICE_LANGS`. `src/components/ui.tsx`: `StatusPill`, `CategoryIcon`, `Spinner`, `useToast`, `timeAgo`.
  - `src/pages/AdminHome.tsx` (`/admin`) and `src/pages/WorkerHome.tsx` (`/worker`) are **basic placeholders**. Grow them into the real landing pages (task 5).
  - Routes are in `src/main.tsx`, where `<RequireAuth roles={[...]}>` guards pages by role.

Keep the UI plain, friendly, and usable by a non-technical person on a phone (360 px wide). All new user-facing copy is short and simple.

## Tasks

Do them in this order. Commit after each one, with passing tests and a passing `npm run build`.

### 1. "Use my current location" + nearby issues map

- On the **Home** and **Browse** pages, add a **"Use my location"** button. It uses `navigator.geolocation` and handles permission denied, timeout and unsupported browsers with a clear message, falling back to the city centre from `config.city`.
- Show a distinct **"You are here" marker** (a pulsing blue dot with an accuracy circle) on the map.
- Load issues near that point with a new `GET /api/issues/near?lat&lng&radius=2000&status=` endpoint that returns issues sorted by distance (reuse `_distance_m` and the bounding-box filter from `/nearby`) and includes `distance_m`.
- Show them as markers coloured by status (`statusIcon`), plus a list underneath: *category icon · title · locality · "350 m away" · StatusPill*. Tapping a list item highlights its marker, and tapping a marker opens a popup linking to `/issues/:id`.
- Add a status filter (All / Reported / Being fixed / Fixed) and a radius filter (500 m / 1 km / 2 km / 5 km).

### 2. Resident ↔ worker chat (per issue)

- New table `Message(id, issue_id FK, sender_uid, sender_name, sender_role, body ≤ 1000 chars, created_at)`.
- `GET /api/issues/{id}/messages?after=<id>` and `POST /api/issues/{id}/messages`. Only the **issue's reporter**, **workers** and **admins** can read or post; everyone else gets 403.
- On `IssueDetail`, add a **"Messages"** panel (visible to those people only): chat bubbles (mine on the right), a role badge ("Worker", "Admin"), timestamps (`timeAgo`), and a text box with a send button. Poll every 5 s while the page is visible (`document.visibilityState`). Don't use WebSockets; keep it simple.
- Show an unread-count badge on the worker's job cards and on the resident's "My reports" list (store a `last_read_message_id` per user per issue in a small `MessageRead` table).

### 3. Gemini structures the report from voice or text (English, Tamil, Hindi)

- New endpoint `POST /api/ai/structure` with body `{ text, lang: "en"|"ta"|"hi" }`. It takes the resident's free text (typed, or transcribed by `VoiceButton`) in any of the three languages and returns:
  `{ is_civic_issue, category (one of CATEGORIES), title (English, < 70 chars), description (English, 2-3 factual sentences), severity, landmark (string, may be empty), original_language, translated_text }`.
  Use `gemini._call` with a JSON schema, like `analyze_photo`, and validate `category` and `severity` the same way.
- Make sure `VOICE_LANGS` includes `en-IN`, `ta-IN` and `hi-IN`.
- On the **Report** page, add a "Describe it in your words" box with the mic button and a language picker (English / தமிழ் / हिन्दी). A **"Fill the form for me"** button calls `/api/ai/structure` and fills category, title, description and severity, which the user can still edit. Keep the original text in a collapsible "What you said" section, and store it on the issue as a new `original_text` column.
- If both a photo and text exist, combine them: pass the structured text as the `note` to `/api/ai/analyze`.
- Test: monkeypatch `gemini._call` and assert that the category and severity are validated and the response has the right shape.

### 4. Duplicate detection + admin merge

- When a report is created, compute **duplicate candidates**: other open or in-progress issues **within 100 m**, with the **same category**, created **in the last 30 days**. Rank them by a simple score: `distance (closer = higher) + title/description word overlap (Jaccard on lowercased words, ignoring stop words)`. An issue is a **"likely duplicate"** when its score is above a threshold (start at 0.6 and keep it as a constant).
  - Add a `DuplicateFlag(id, issue_id, candidate_id, score, distance_m, status: pending|merged|dismissed)` table, and fill it when an issue is created.
  - Before submitting, the Report page already shows nearby issues. Keep that, and add the text "This looks like #123. +1 it instead?"
- Admin endpoints:
  - `GET /api/admin/duplicates` lists pending flags, with both issues summarised side by side.
  - `POST /api/admin/duplicates/{flag_id}/merge` with `{ keep_id }` merges the other issue into `keep_id`. It moves upvotes (without double-counting the same uid), moves messages, adds a `StatusUpdate` note "Merged #X into #Y" on both, sets the merged issue to `rejected` with a `merged_into` column pointing to the kept one, and marks the flag `merged`.
  - `POST /api/admin/duplicates/{flag_id}/dismiss`.
- `IssueDetail` of a merged issue shows a banner: "This report was merged into #Y" with a link.
- Tests: create two close, similar reports and assert a flag appears; merge them and assert the upvotes, statuses and `merged_into` are correct; assert a far-away or different-category report creates no flag.

### 5. Separate landing pages for admin and worker (same design language)

Admins and workers land on these pages after sign-in (already wired through `homeFor`). Reuse the look of `Stats.tsx` and `Browse.tsx`: the same tile grid, cards and spacing.

- **Admin (`/admin`)**
  - Top tiles: Waiting · Being fixed · Fixed this week · Avg days to fix.
  - **Needs attention** list: open issues sorted by upvotes and age, each with an **"Assign to worker"** dropdown. Add an `assigned_to_email` column on `Issue` and a `POST /api/issues/{id}/assign` endpoint (admin only). Assigning adds a `StatusUpdate` note.
  - **Possible duplicates** card: count plus a link to a `/admin/duplicates` review page with side-by-side cards and Merge / Not a duplicate buttons.
  - **Team** card: the existing worker management, plus a count of each worker's open jobs.
  - The simple **proof-of-work chart** from task 6.
- **Worker (`/worker`)**
  - Tabs: **My jobs** (assigned to me) · **Nearby** (uses the task 1 location and lists unassigned open issues near me) · **Done**.
  - Each job card has big buttons sized for a phone: **"Start work"** (sets `in_progress`) and **"Mark fixed"**. "Mark fixed" opens a sheet where the worker **must upload an "after" photo** and can add a note. Store it as `after_photo` on `Issue`, served at `GET /api/issues/{id}/after-photo`, and reuse `_process_photo`.
  - A small "My week" summary: jobs done this week, and average time to fix.
- `IssueDetail` shows a **Before / After** pair of photos once the issue is fixed.

### 6. Simple proof-of-work report chart

This is for ordinary residents. **No jargon, and no more than 2 charts.**

- On `/stats` (public) and the admin page, add a **"Proof of work"** section:
  1. **"Reported vs fixed, last 8 weeks"**: a weekly bar pair (reported in grey, fixed in green, the `--color-st-fixed` token). Add a `GET /api/stats/weekly?weeks=8` endpoint that returns `[{ week_start, reported, fixed }]`.
  2. **"Recently fixed"**: a strip of before/after photo pairs from the last 10 fixed issues, with locality and "Fixed in 3 days".
- Below the chart, a one-line plain-English summary such as "In the last 8 weeks, 124 problems were reported and 97 were fixed."
- Build the bars with plain SVG or CSS divs (as `Stats.tsx` does). **Don't add a chart library.** Print the values on the bars, keep it readable on a phone, and add an `aria-label` describing the data.

## Rules

- Enforce every permission on the **backend** (role and ownership checks). The frontend only hides buttons.
- Keep `npm run build` (from `frontend/`) and `pytest` (from `backend/`) green. Add tests for every new endpoint: roles, the 403 paths, the duplicate scoring and the merge.
- Don't commit secrets. Add any new env var to `.env.example` and `render.yaml`.
- Mobile first: check every new screen at 360 px wide.
- Error messages should tell the user what to do next (follow the style of the existing `HTTPException` messages).
- When you finish, update `README.md` with the new features and the role setup: `ADMIN_EMAILS`, `WORKER_EMAILS`, and the Admin → Team page.
