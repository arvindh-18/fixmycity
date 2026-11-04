import http from "k6/http";
import { check, sleep } from "k6";

// Smoke load test exercising the main public, read-only endpoints.
// Reads target host from BASE_URL environment variable.
const BASE_URL = (__ENV.BASE_URL || "http://localhost:8000").replace(/\/+$/, "");

export const options = {
  stages: [
    { duration: "10s", target: 5 },  // ramp-up to 5 concurrent users
    { duration: "30s", target: 10 }, // sustain 10 users
    { duration: "10s", target: 0 },  // ramp-down
  ],
  thresholds: {
    http_req_duration: ["p(95)<800"], // 95% of requests must complete below 800ms
    http_req_failed: ["rate<0.01"],   // Error rate must remain below 1%
  },
};

export default function () {
  const headers = { Accept: "application/json" };

  // 1. Health check
  const healthRes = http.get(`${BASE_URL}/api/health`, { headers });
  check(healthRes, {
    "health status is 200": (r) => r.status === 200,
    "health body ok": (r) => {
      try {
        return JSON.parse(r.body).status === "ok";
      } catch {
        return false;
      }
    },
  });

  // 2. City metadata (categories, departments, city center)
  const metaRes = http.get(`${BASE_URL}/api/meta`, { headers });
  check(metaRes, {
    "meta status is 200": (r) => r.status === 200,
    "meta has categories": (r) => {
      try {
        return Array.isArray(JSON.parse(r.body).categories);
      } catch {
        return false;
      }
    },
  });

  // 3. Paginated public issue feed
  const issuesRes = http.get(`${BASE_URL}/api/issues?page=1&page_size=20&sort=newest`, { headers });
  check(issuesRes, {
    "issues list status is 200": (r) => r.status === 200,
    "issues has items": (r) => {
      try {
        return Array.isArray(JSON.parse(r.body).items);
      } catch {
        return false;
      }
    },
  });

  // 4. Map GeoJSON issues endpoint
  const mapRes = http.get(`${BASE_URL}/api/map/issues`, { headers });
  check(mapRes, {
    "map issues status is 200": (r) => r.status === 200,
    "map is FeatureCollection": (r) => {
      try {
        return JSON.parse(r.body).type === "FeatureCollection";
      } catch {
        return false;
      }
    },
  });

  // 5. Nearby issues spatial query
  const nearbyRes = http.get(`${BASE_URL}/api/nearby?lat=12.9716&lng=77.5946&radius_m=2000`, { headers });
  check(nearbyRes, {
    "nearby status is 200": (r) => r.status === 200,
  });

  // 6. Public statistics overview
  const statsRes = http.get(`${BASE_URL}/api/stats/overview`, { headers });
  check(statsRes, {
    "stats overview status is 200": (r) => r.status === 200,
  });

  // 7. Recent public activity / ledger
  const activityRes = http.get(`${BASE_URL}/api/activity?limit=12`, { headers });
  check(activityRes, {
    "activity status is 200": (r) => r.status === 200,
  });

  sleep(1);
}

