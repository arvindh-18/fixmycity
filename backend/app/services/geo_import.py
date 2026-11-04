"""Import real geographic data, replacing the demo stand-ins.

1. Ward / locality boundaries from a GeoJSON file (e.g. a city's open-data ward map).
   Polygons and MultiPolygons are both accepted. Imported areas are marked `is_approximate = False`
   with the source you name, so the UI stops calling them approximate.
2. Schools / hospitals / clinics ("facilities") from a GeoJSON file, or fetched from OpenStreetMap
   with the Overpass API. These feed the "vulnerable location" factor of the priority engine.

After a locality import every issue is re-linked to the locality that contains it (the smallest one
if areas overlap), so statistics immediately reflect the new boundaries.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import httpx
from shapely.geometry import MultiPolygon, Point, Polygon, shape
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from app.models import Facility, Locality
from app.services import audit

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OSM_KIND = {"school": "school", "college": "school", "university": "school", "kindergarten": "school",
            "hospital": "hospital", "clinic": "clinic", "doctors": "clinic"}


@dataclass
class ImportResult:
    created: int = 0
    updated: int = 0
    skipped: int = 0
    removed_demo: int = 0
    issues_relinked: int = 0


def _features(path: str | Path) -> list[dict]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("type") == "FeatureCollection":
        return data["features"]
    if data.get("type") == "Feature":
        return [data]
    raise ValueError("Expected a GeoJSON Feature or FeatureCollection.")


def _as_multipolygon(geom: dict) -> MultiPolygon | None:
    g = shape(geom)
    if isinstance(g, Polygon):
        g = MultiPolygon([g])
    if not isinstance(g, MultiPolygon) or g.is_empty:
        return None
    if not g.is_valid:
        g = g.buffer(0)  # repairs self-intersections common in hand-digitised ward maps
        if isinstance(g, Polygon):
            g = MultiPolygon([g])
    return g


def import_localities(db: Session, path: str | Path, *, name_field: str, source: str,
                      population_field: str | None = None, population_source: str | None = None,
                      replace_demo: bool = False) -> ImportResult:
    res = ImportResult()
    if replace_demo:
        res.removed_demo = db.execute(delete(Locality).where(Locality.is_approximate.is_(True))).rowcount or 0
    for f in _features(path):
        props = f.get("properties") or {}
        name = str(props.get(name_field) or "").strip()
        geom = _as_multipolygon(f.get("geometry") or {}) if f.get("geometry") else None
        if not name or geom is None:
            res.skipped += 1
            continue
        pop = None
        if population_field and props.get(population_field) not in (None, ""):
            try:
                pop = int(float(props[population_field]))
            except (TypeError, ValueError):
                pop = None
        loc = db.scalar(select(Locality).where(Locality.name == name[:120]))
        wkt = f"SRID=4326;{geom.wkt}"
        if loc:
            loc.boundary, loc.is_approximate, loc.boundary_source = wkt, False, source
            res.updated += 1
        else:
            loc = Locality(name=name[:120], boundary=wkt, is_approximate=False, boundary_source=source)
            db.add(loc)
            res.created += 1
        if pop is not None:
            loc.population, loc.population_source = pop, population_source or source
    db.flush()
    res.issues_relinked = relink_issues(db)
    audit.record(db, actor=None, action="geo.localities_imported", entity_type="locality",
                 new={"file": Path(path).name, "source": source, "created": res.created, "updated": res.updated,
                      "removed_demo": res.removed_demo})
    db.commit()
    return res


def relink_issues(db: Session) -> int:
    """Point every issue at the smallest locality that contains it (NULL if none)."""
    result = db.execute(text("""
        UPDATE issues i SET locality_id = (
            SELECT l.id FROM localities l
            WHERE ST_Intersects(l.boundary, i.location)
            ORDER BY ST_Area(l.boundary) ASC LIMIT 1)
    """))
    return result.rowcount or 0


def import_facilities(db: Session, path: str | Path, *, name_field: str, source: str,
                      kind: str | None = None, kind_field: str | None = None, replace_demo: bool = False) -> ImportResult:
    res = ImportResult()
    if replace_demo:
        res.removed_demo = db.execute(delete(Facility).where(Facility.is_demo.is_(True))).rowcount or 0
    for f in _features(path):
        props = f.get("properties") or {}
        name = str(props.get(name_field) or "").strip()
        k = kind or OSM_KIND.get(str(props.get(kind_field or "amenity", "")).lower())
        if not name or not k or not f.get("geometry"):
            res.skipped += 1
            continue
        g = shape(f["geometry"])
        pt = g if isinstance(g, Point) else g.centroid  # buildings drawn as polygons → their centre
        db.add(Facility(name=name[:160], kind=k, location=f"SRID=4326;POINT({pt.x} {pt.y})", source=source, is_demo=False))
        res.created += 1
    audit.record(db, actor=None, action="geo.facilities_imported", entity_type="facility",
                 new={"file": Path(path).name, "source": source, "created": res.created, "removed_demo": res.removed_demo})
    db.commit()
    return res


def overpass_query(lat: float, lng: float, radius_m: int, kinds: list[str]) -> str:
    amenities = "|".join(sorted({a for a, k in OSM_KIND.items() if k in kinds}))
    return (f'[out:json][timeout:60];nwr["amenity"~"^({amenities})$"](around:{radius_m},{lat},{lng});'
            "out center tags;")


def overpass_to_geojson(data: dict) -> dict:
    """Convert an Overpass JSON response to GeoJSON points (ways/relations use their centre)."""
    feats = []
    for el in data.get("elements", []):
        if el.get("type") == "node":
            lat, lon = el.get("lat"), el.get("lon")
        else:
            c = el.get("center") or {}
            lat, lon = c.get("lat"), c.get("lon")
        tags = el.get("tags") or {}
        if lat is None or lon is None or not tags.get("name"):
            continue
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
                      "properties": {"name": tags["name"], "amenity": tags.get("amenity"), "osm_id": f"{el['type']}/{el['id']}"}})
    return {"type": "FeatureCollection", "features": feats}


def fetch_osm_facilities(lat: float, lng: float, radius_m: int, kinds: list[str], out_path: str | Path) -> Path:
    """Download facilities from OpenStreetMap (needs internet). Saves GeoJSON so the import is repeatable."""
    resp = httpx.post(OVERPASS_URL, data={"data": overpass_query(lat, lng, radius_m, kinds)}, timeout=120,
                      headers={"User-Agent": "Commons civic platform (facility import)"})
    resp.raise_for_status()
    out = Path(out_path)
    out.write_text(json.dumps(overpass_to_geojson(resp.json())), encoding="utf-8")
    return out


def osm_source_label() -> str:
    return f"OpenStreetMap contributors (ODbL), fetched {date.today().isoformat()}"
