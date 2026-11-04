"""Civic hotspot detection with PostGIS DBSCAN.

`ST_ClusterDBSCAN(geom, eps, minpoints)` groups points that have at least `minpoints` neighbours
within `eps` distance. We project to Web Mercator (metres) so eps can be given in metres.
Issues that end up in no cluster get NULL and are ignored.

For each cluster we compute: size, open vs resolved, the dominant category, the share of that
category, the locality, and how many reports came in the last 30 days. Insights are plain
sentences generated from those numbers — nothing is invented.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

SQL = text("""
WITH pts AS (
  SELECT i.id, i.category_id, i.status, i.created_at, i.locality_id,
         ST_Transform(i.location::geometry, 3857) AS g
  FROM issues i
  WHERE i.status <> 'rejected' AND i.created_at >= :since
), clustered AS (
  SELECT *, ST_ClusterDBSCAN(g, eps := :eps, minpoints := :minpts) OVER () AS cid FROM pts
)
SELECT c.cid,
       count(*)                                                       AS total,
       count(*) FILTER (WHERE c.status NOT IN ('resolved'))           AS open,
       count(*) FILTER (WHERE c.created_at >= :recent)                AS recent,
       ST_Y(ST_Transform(ST_Centroid(ST_Collect(c.g)), 4326))         AS lat,
       ST_X(ST_Transform(ST_Centroid(ST_Collect(c.g)), 4326))         AS lng,
       mode() WITHIN GROUP (ORDER BY c.category_id)                   AS top_category_id,
       mode() WITHIN GROUP (ORDER BY c.locality_id)                   AS locality_id
FROM clustered c
WHERE c.cid IS NOT NULL
GROUP BY c.cid
ORDER BY total DESC
LIMIT :lim
""")


def detect(db: Session, *, eps_m: int = 250, min_points: int = 3, days: int = 180, limit: int = 10) -> list[dict]:
    now = datetime.now(timezone.utc)
    rows = db.execute(SQL, {"since": now - timedelta(days=days), "recent": now - timedelta(days=30),
                            "eps": eps_m, "minpts": min_points, "lim": limit}).mappings().all()
    if not rows:
        return []
    cats = dict(db.execute(text("SELECT id, name FROM issue_categories")).all())
    locs = dict(db.execute(text("SELECT id, name FROM localities")).all())
    out = []
    for r in rows:
        top_cat = cats.get(r["top_category_id"], "Mixed")
        cat_count = db.execute(text("""
            WITH pts AS (SELECT i.id, i.category_id, ST_Transform(i.location::geometry,3857) g
                         FROM issues i WHERE i.status <> 'rejected' AND i.created_at >= :since)
            SELECT count(*) FROM pts
            WHERE category_id = :cat AND ST_DWithin(g, ST_Transform(ST_SetSRID(ST_MakePoint(:lng,:lat),4326),3857), :eps * 1.5)
        """), {"since": now - timedelta(days=days), "cat": r["top_category_id"], "lng": r["lng"],
               "lat": r["lat"], "eps": eps_m}).scalar() or 0
        locality = locs.get(r["locality_id"])
        place = f"near {locality}" if locality else f"around {r['lat']:.4f}, {r['lng']:.4f}"
        top_n = min(cat_count, r["total"])
        mix = (f"{top_cat.lower()} is the most common ({top_n} reports)" if top_n >= 2
               else "the reports cover several different categories")
        insight = (f"{r['total']} reports {place} in the last {days} days; {mix}. "
                   f"{r['open']} still open, {r['recent']} reported in the last 30 days.")
        recurring = cat_count >= 3
        out.append({
            "cluster_id": int(r["cid"]), "lat": float(r["lat"]), "lng": float(r["lng"]),
            "total": r["total"], "open": r["open"], "recent_30d": r["recent"],
            "top_category": top_cat, "top_category_count": min(cat_count, r["total"]),
            "locality": locality, "recurring": recurring, "insight": insight,
            "method": f"DBSCAN, radius {eps_m} m, at least {min_points} reports",
        })
    return out
