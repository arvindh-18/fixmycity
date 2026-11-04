"""Command-line importer for real map data.  Run from the backend folder:

  # Ward boundaries from a GeoJSON file (Polygon or MultiPolygon features)
  python -m scripts.import_geo localities wards.geojson --name-field WARD_NAME \
      --source "BBMP ward boundaries 2023 (city open data portal)" --replace-demo
  # optional population: --population-field POP_2011 --population-source "Census 2011"

  # Schools / hospitals from OpenStreetMap (needs internet; saves facilities-osm.geojson first)
  python -m scripts.import_geo facilities-osm --radius-km 15 --kinds school,hospital,clinic --replace-demo

  # ...or from your own GeoJSON file
  python -m scripts.import_geo facilities hospitals.geojson --name-field name --kind hospital \
      --source "State health department facility list 2025"

Check the licence and date of any dataset you import; the source text is shown to the public.
"""
from __future__ import annotations

import argparse
import sys

from app.core.config import settings
from app.database.session import SessionLocal
from app.services import geo_import


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="import_geo", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    loc = sub.add_parser("localities", help="import ward/locality boundaries from GeoJSON")
    loc.add_argument("file")
    loc.add_argument("--name-field", required=True)
    loc.add_argument("--source", required=True, help="where the boundaries come from (shown publicly)")
    loc.add_argument("--population-field")
    loc.add_argument("--population-source")
    loc.add_argument("--replace-demo", action="store_true", help="delete the approximate demo localities first")

    fac = sub.add_parser("facilities", help="import schools/hospitals from GeoJSON")
    fac.add_argument("file")
    fac.add_argument("--name-field", default="name")
    fac.add_argument("--kind", choices=["school", "hospital", "clinic"], help="kind for every feature")
    fac.add_argument("--kind-field", help="property holding an OSM-style amenity value (default: amenity)")
    fac.add_argument("--source", required=True)
    fac.add_argument("--replace-demo", action="store_true", help="delete the sample facilities first")

    osm = sub.add_parser("facilities-osm", help="fetch schools/hospitals from OpenStreetMap and import them")
    osm.add_argument("--radius-km", type=float, default=15)
    osm.add_argument("--kinds", default="school,hospital,clinic")
    osm.add_argument("--lat", type=float, default=settings.city_lat)
    osm.add_argument("--lng", type=float, default=settings.city_lng)
    osm.add_argument("--save-to", default="facilities-osm.geojson")
    osm.add_argument("--replace-demo", action="store_true")

    args = ap.parse_args(argv)
    with SessionLocal() as db:
        if args.cmd == "localities":
            r = geo_import.import_localities(db, args.file, name_field=args.name_field, source=args.source,
                                             population_field=args.population_field,
                                             population_source=args.population_source, replace_demo=args.replace_demo)
            print(f"Localities: {r.created} created, {r.updated} updated, {r.skipped} skipped, "
                  f"{r.removed_demo} demo areas removed; {r.issues_relinked} issues re-linked.")
        elif args.cmd == "facilities":
            r = geo_import.import_facilities(db, args.file, name_field=args.name_field, source=args.source,
                                             kind=args.kind, kind_field=args.kind_field, replace_demo=args.replace_demo)
            print(f"Facilities: {r.created} imported, {r.skipped} skipped, {r.removed_demo} sample facilities removed.")
        else:
            kinds = [k.strip() for k in args.kinds.split(",") if k.strip()]
            print(f"Fetching {', '.join(kinds)} within {args.radius_km} km of {args.lat}, {args.lng} from OpenStreetMap…")
            path = geo_import.fetch_osm_facilities(args.lat, args.lng, int(args.radius_km * 1000), kinds, args.save_to)
            r = geo_import.import_facilities(db, path, name_field="name", source=geo_import.osm_source_label(),
                                             kind_field="amenity", replace_demo=args.replace_demo)
            print(f"Saved {path}. Facilities: {r.created} imported, {r.skipped} unnamed skipped, "
                  f"{r.removed_demo} sample facilities removed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
