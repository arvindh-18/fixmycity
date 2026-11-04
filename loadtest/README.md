# Load Testing (k6 Smoke Test)

This directory contains a smoke and baseline read performance test using [k6](https://k6.io/). It exercises the primary unauthenticated, public read endpoints:
- `GET /api/health`
- `GET /api/meta`
- `GET /api/issues?page=1&page_size=20&sort=newest`
- `GET /api/map/issues`
- `GET /api/nearby?lat=...&lng=...&radius_m=2000`
- `GET /api/stats/overview`
- `GET /api/activity?limit=12`

## Prerequisites

Install k6:
- **macOS**: `brew install k6`
- **Windows**: `winget install k6` or `choco install k6`
- **Linux**: `sudo apt install k6` (via official Grafana repo)
- **Docker**: `docker run --rm -i grafana/k6 run - < k6-smoke.js`

## Running the Test

### 1. Local Development
Ensure the local backend is running (e.g. at `http://localhost:8000`):
```bash
k6 run -e BASE_URL=http://localhost:8000 loadtest/k6-smoke.js
```

### 2. Deployed Staging / Production (Render)
Run against your deployed Render web service:
```bash
k6 run -e BASE_URL=https://fixmycity-backend.onrender.com loadtest/k6-smoke.js
```

### Customising Duration and Concurrency
To override the default stages (10 VUs for 50s total):
```bash
k6 run -e BASE_URL=https://fixmycity-backend.onrender.com --vus 20 --duration 1m loadtest/k6-smoke.js
```

## Thresholds
- **P95 Latency**: `< 800ms`
- **Error Rate**: `< 1%` (`http_req_failed`)

---

## Test Results Log

<!--
Record real benchmark runs here after executing k6.
Do NOT enter fictitious numbers.
-->

| Run Date (UTC) | Target Environment | VUs | Duration | Total Requests | Throughput (req/s) | p50 Latency (ms) | p95 Latency (ms) | p99 Latency (ms) | Error Rate (%) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| _[YYYY-MM-DD]_ | _[e.g. Local / Render Starter]_ | _[e.g. 10]_ | _[e.g. 1m]_ | _[placeholder]_ | _[placeholder]_ | _[placeholder]_ | _[placeholder]_ | _[placeholder]_ | _[placeholder]_ | _[placeholder]_ |
| | | | | | | | | | | |
| | | | | | | | | | | |

