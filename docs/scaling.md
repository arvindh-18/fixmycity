# Scaling & Architecture Limits

This document explains the current single-instance concurrency boundaries of FixMyCity (Commons) and outlines the future architecture roadmap required to scale beyond a single web node.

> [!IMPORTANT]
> **No Premature Optimization**: The current system is deliberately designed as a **modular monolith** running as a **single Python process with a single worker** (`uvicorn --workers 1`). This eliminates message brokers, external caches, and distributed coordination overhead during the initial operational phase. The sections below document where the single-process limits lie and the recommended upgrade steps when traffic justifies them.

---

## Current Architecture Limits

### 1. In-Process WebSocket Hub (`app/services/realtime.py`)
- **Current Behavior**: Active WebSocket connections are maintained in an in-memory dictionary `_connections: dict[uuid.UUID, set[WebSocket]]` inside the single running Python process. When `realtime.publish_user(...)` or `publish_issue(...)` is called, it iterates across in-memory sockets in that process.
- **Limit**: If you start multiple Uvicorn workers (`--workers 4`) or run multiple container instances on Render, connected users will be randomly distributed across distinct memory spaces. An event triggered on Worker A cannot reach a WebSocket connected to Worker B. As a result, the backend **must run with 1 instance and 1 worker**.

### 2. In-Memory Sliding-Window Rate Limiter (`app/core/rate_limit.py`)
- **Current Behavior**: Request timestamps per client key are tracked in an in-process dictionary (`_buckets: dict[str, list[float]]`).
- **Limit**: Rate limits are bounded to the lifetime and memory of that single process. Multi-worker or multi-container deployments would fragment rate limit tracking, effectively multiplying allowed request thresholds by the number of nodes.

### 3. In-Process SLA Escalation Loop (`app/services/escalation.py` & `app/main.py`)
- **Current Behavior**: The background escalation check runs as an `asyncio.create_task` loop inside the FastAPI lifespan context, waking up every 60 seconds (`ESCALATION_INTERVAL_SECONDS`) to scan open issues and flag overdue ones.
- **Limit**: If multiple processes or containers were run, each process would execute its own redundant loop, creating duplicate database queries and potential race conditions when writing escalation events.

### 4. Database Connection Pool & Transaction Pooler
- **Current Behavior**: The API server connects to PostgreSQL through Supabase's transaction pooler (port 6543) with `connect_args={"prepare_threshold": None}`. Migrations use the direct connection on port 5432.
- **Limit**: While transaction pooling prevents connection starvation on the database, compute-heavy geospatial queries (such as clustering thousands of issues in `/api/map/issues` or large spatial joins in `/api/nearby`) are executed directly on the primary database instance.

---

## Future Scaling Roadmap

The following upgrades describe the path to multi-worker and multi-instance operation. None of these are currently implemented in the codebase today.

### Step 1: Redis Pub/Sub for WebSockets
- **Roadmap**: Introduce an external Redis (or Valkey / PostgreSQL `LISTEN`/`NOTIFY`) message broker.
- **Mechanism**:
  - Each web worker subscribes to relevant Redis channels (e.g. `user:<id>`, `issue:<id>`).
  - When an event occurs on any server node, it publishes a JSON payload to Redis.
  - Every worker receives the broadcast and relays it to any matching WebSocket connections held in its local process memory.
- **Outcome**: Allows horizontal scaling to unlimited web workers and multiple Render container instances without dropping realtime notifications.

### Step 2: Distributed Rate Limiting (Redis Token Bucket)
- **Roadmap**: Migrate `app/core/rate_limit.py` from an in-memory dictionary to Redis using atomic Lua scripts or sliding-window sorted sets (`ZADD`/`ZREMRANGEBYSCORE`).
- **Outcome**: Unified, persistent rate limiting enforced across all API workers and server restarts.

### Step 3: Dedicated Background Worker for Escalation & Async Tasks
- **Roadmap**: Decouple the background escalation loop and heavy asynchronous tasks (email dispatch, PDF report generation, AI classification) from the API process into a dedicated worker service (e.g. Celery, ARQ, or a Render Background Worker).
- **Outcome**:
  - The API web process handles only incoming HTTP and WebSocket traffic.
  - Scheduled jobs (SLA checks, daily digests) run exactly once via distributed locks (e.g. Redlock) or an external scheduler.

### Step 4: CDN Caching for Public Media Storage
- **Roadmap**: Place a global Content Delivery Network (Cloudflare or Fastly) in front of the Supabase Storage bucket (`/storage/v1/object/public/openward/*`).
- **Outcome**:
  - Eliminates origin bandwidth costs and latency for photo-heavy issue lists, map thumbnails, and before/after completion evidence.
  - Offloads image caching from the database and storage service.

### Step 5: Read Replicas for Geospatial & Analytics Traffic
- **Roadmap**: Configure Supabase read replicas for unauthenticated public traffic.
- **Mechanism**: Route heavy read-only endpoints (`GET /api/map/issues`, `GET /api/stats/*`, `GET /api/activity`) to a read replica pool using a secondary SQLAlchemy engine session.
- **Outcome**: Keeps the primary database instance dedicated to write-intensive workflows (issue creation, status state transitions, and append-only audit logging).

