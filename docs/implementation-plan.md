# Commons — Implementation Plan & Checklist

Status legend: `[x]` done and verified · `[~]` working with documented limitation · `[ ]` not done

Verification used: 33 backend tests (`backend/tests`), 24 frontend tests (Vitest + Testing Library), TypeScript strict type-check + production build,
and a browser end-to-end run of the full citizen → admin → worker → citizen loop (including a live WebSocket update).

## Phase 1 — Core application
- [x] Project setup (FastAPI backend, React/Vite frontend, docker-compose PostGIS)
- [x] Design system: Commons (`design/commons-design-system`), tokens generated, components ported, light + dark themes
- [x] Authentication (register, login, JWT, bcrypt; role re-read from DB every request)
- [x] Three role dashboards (citizen `/me`, admin `/admin`, worker `/worker`)
- [x] Database models + Alembic migration with append-only triggers
- [x] Issue reporting (4-step form, photos, location confirmation, tracking ID)
- [x] Anonymous reporting with hashed secret token
- [x] Issue lifecycle state machine (11 states, role-checked edges, reasons required where it matters)
- [x] Department routing and worker assignment / reassignment
- [x] Public issue tracking page

## Phase 2 — Mapping and transparency
- [x] MapLibre map: clusters, heatmap, filters, popovers, list view, geolocate, place search
- [x] Locality statistics panel
- [x] Locality boundaries — real ward GeoJSON importer (`scripts/import_geo.py`); demo ships approximate areas, labelled
- [x] School/hospital data — OpenStreetMap or GeoJSON importer feeding the priority engine
- [x] Public accountability timeline (public/internal separation)
- [x] Append-only audit history (DB trigger) + admin audit viewer
- [x] Before/after evidence + citizen confirm / dispute / reopen + admin review
- [x] Citizen support (one per account, DB-enforced)
- [x] Public transparency dashboard (live data, sample sizes, date ranges, demo labelling)
- [x] Department scorecards (not ranked; minimum sample)
- [x] SLA rules, countdown, escalation job (warning + overdue flag + notifications)
- [x] Public commitments tracker
- [x] Expenditure transparency (verified requires source document)
- [x] RTI-ready PDF export (with "not an official RTI document" notice)

## Phase 3 — Communication and community
- [x] WebSocket hub (post-commit delivery, reconnect with backoff)
- [x] Citizen↔admin and admin↔worker chat (history, unread counts, read receipts, images, online state)
- [x] In-app notifications (live toasts + bell)
- [x] Issue discussions (one-level replies, photo attachments, reporting, auto-hide at 3 reports, moderation, spam rules)
- [x] Following
- [x] Citizen satisfaction (reporter and supporters; "not fixed" allowed)
- [x] Announcements
- [x] Email notifications (SMTP or local outbox, sent after commit, per-user opt-out)
- [x] "Get updates on this report" email signup for visitors (double opt-in, one-click unsubscribe)

## Phase 4 — AI
- [x] Provider abstraction (rules / Anthropic / OpenAI-compatible) + graceful fallback + demo-mode labels
- [x] Classification (text + photo with a vision model; photo marked unanalysed in rule mode)
- [x] Duplicate detection (distance + category + TF-IDF)
- [x] Priority recommendations with point-by-point explanations
- [x] Hotspot detection (PostGIS DBSCAN)
- [x] Civic assistant (role-scoped, data-grounded)
- [x] Progress summaries with admin approval

## Phase 5 — Refinement
- [x] Backend test suite (auth, RBAC, lifecycle, audit immutability, uploads, SLA, messaging, WebSocket, map, AI, email, photo analysis, geo import)
- [x] Frontend test suite (formatting, API client, status/SLA components, accountability timeline, report-form workflow)
- [x] Frontend strict type-check and production build
- [x] Browser end-to-end smoke test of the core loop
- [x] README, `.env.example` files, docs

## Next steps if you continue
1. Run the importer with your city's ward map and `facilities-osm` (needs the ward file and internet).
2. Set `AI_PROVIDER` + `AI_API_KEY` to switch on language-model answers and photo checks.
3. Set `EMAIL_BACKEND=smtp` with real SMTP credentials to send actual email.
4. For multi-server deployment: Redis for the WebSocket hub and rate limiter; object storage for media.
