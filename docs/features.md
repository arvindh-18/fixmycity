# Commons — Features (as built)

Each section says what exists, where the code is, and any limitation. Nothing here is a mock-up:
every screen reads from and writes to the API.

## Public portal (no account)
- **Landing page** (`pages/Landing.tsx`): headline, report/map calls to action, **live public register** (latest
  status changes city-wide from `/api/activity`), live stats strip with date range and sample-data count,
  interactive map preview, recently reported / recently resolved, the 5-step process, department scorecard
  preview, community section with city notices.
- **Issue map** (`pages/MapPage.tsx`, `components/map/IssueMap.tsx`): MapLibre + OpenStreetMap tiles; status-coloured
  markers sized by priority and supporters; clustering; density heatmap; list view; filters for status, category,
  priority, department, date; search (issues, localities, then OpenStreetMap Nominatim places); geolocate;
  hover popovers; slide-over issue panel with the accountability trail; locality boundaries with a statistics
  panel; DBSCAN hotspot rings with plain-language insights.
- **Issue page** (`pages/IssuePage.tsx`): description, photos, deadline countdown, department and worker,
  before/after comparison slider, full accountability trail, PDF history export, discussion thread, support and follow.
- **Transparency dashboard** (`pages/Transparency.tsx`): headline figures with sample sizes, monthly trend,
  status mix, categories (drill-down), department scorecards (alphabetical, not ranked; hidden under 5 reports),
  public commitments tracker, expenditure (verified/unverified labels; nothing inferred), announcements.
- **Track a report** (`pages/TrackPage.tsx`): public lookup by ID, or private view for anonymous reporters with their code.
- **Civic assistant** (floating "Ask Commons"): answers from live data only.

## Citizen
- Register / sign in; four-step report form: describe (AI category suggestion with confidence), locate
  (draggable pin, GPS, place search, address), photos (validated client- and server-side; EXIF stripped),
  review with explicit location confirmation. Similar nearby reports are shown with "Support instead".
- Anonymous reporting with a one-time private tracking code.
- My reports / Following / Near me; "Your confirmation is needed" panel.
- Confirm a fix (with rating), dispute it (reopens publicly), reopen a resolved issue, rate outcomes as a supporter
  (including "not fixed").
- Private messages with officials; live notifications; **email updates** (switch on/off from the account menu).
- With an AI provider configured, a **photo check** in the report form says what the photo shows and warns if it
  doesn't seem to match the description.

## Administrator
- **Overview**: work-queue tiles, 12 KPIs with sample sizes, trend, status mix, priority distribution, categories
  (drill-down), hotspots, per-locality table, department performance, "Run SLA check now".
- **Issue queue**: to verify / to assign / to review / overdue / all, with search and filters.
- **Issue workbench**: verify & route (priority, category, department, note), reject with reason, generic
  transitions (start review, hold, escalate, send back, resolve, reopen) with public/internal flag, assign or
  reassign workers, official public updates, message reporter or worker, AI panel (classification, priority
  points breakdown, agree/disagree recorded), duplicate candidates with "mark as duplicate", internal history.
- **Review & moderation**: approve/edit AI-drafted public summaries of worker notes; reported comments.
- **Field workers**: create accounts, deactivate, workload (no ranking).
- **Departments & SLAs**: SLA rules (category × priority, warning threshold), categories with classifier
  keywords, departments. City-wide admins only; department admins see read-only.
- **Public content**: announcements (notify all citizens), commitments with progress, expenditure records.
- **Audit log**: filterable, expandable old/new values; append-only.
- Department-scoped admins (`roads.admin@commons.demo`) only see their department plus the unrouted queue.

## Field worker (mobile-first)
- Task list sorted by priority then deadline, status tiles, priority mix bar, "waiting for check" tab.
- Task screen with one primary action per state: acknowledge → start → submit evidence; post updates
  (progress, obstacle, materials, help) with photo; pause with reason; navigation link; admin chat.
- Map of active tasks; personal work history with citizen ratings (no leaderboard).

## Platform
- Lifecycle state machine, append-only audit + status history (DB triggers), SLA engine + escalation job,
  in-app notifications over WebSocket, email notifications (SMTP, or a local `.eml` outbox for demos), private chat with read receipts and image attachments, PDF export,
  rate limiting, security headers, EXIF stripping.

## AI layer (works without any API key)
| Feature | Rule mode (default) | LLM mode (`AI_PROVIDER=anthropic|openai`) |
|---|---|---|
| Classification | keyword scoring, capped confidence; photos not analysed (stated in the result) | model picks from the category list and looks at the first photo: what it shows, whether it matches the text |
| Duplicates | PostGIS distance + category + TF-IDF cosine | same (deterministic) |
| Priority | transparent points system with reasons | same (deterministic, explainable) |
| Hotspots | PostGIS `ST_ClusterDBSCAN` + generated sentences | same |
| Assistant | intent patterns → scoped SQL → template | model rephrases the retrieved facts only |
| Progress summaries | jargon replacement + framing | model rewrite; admin approval required either way |

AI never rejects, resolves or changes an issue; every suggestion is stored in `ai_recommendations`
with mode and confidence, and admin agreement/disagreement is audited.

## Known limitations
- Locality boundaries in the demo are approximate octagons (labelled in the UI). Load real ward polygons into `localities` for production.
- Facility (school/hospital) points in the demo are samples; the priority factor states when data is missing.
- Email notifications are not implemented (in-app + WebSocket only).
- WebSocket hub and rate limiter are per-process (single server).
- Image analysis for classification is not implemented; classification uses text.
