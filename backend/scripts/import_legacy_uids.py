"""Import legacy Firebase UIDs into FixMyCity database.

Usage:
    python scripts/import_legacy_uids.py users.json [--dry-run]
"""
import argparse
import json
import sys
from pathlib import Path

# Add backend directory to path so app modules can be imported
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import LegacyUid, SessionLocal, init_db  # noqa: E402


def import_legacy_uids(file_path: str, dry_run: bool = False) -> tuple[int, int, int]:
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    users = data.get("users", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])

    init_db()

    inserted = 0
    updated = 0
    skipped = 0

    with SessionLocal() as db:
        for item in users:
            if not isinstance(item, dict):
                skipped += 1
                continue
            email = (item.get("email") or "").strip().lower()
            uid = item.get("localId") or item.get("uid")
            if not email or not uid:
                skipped += 1
                continue

            existing = db.get(LegacyUid, email)
            if existing:
                if existing.uid != uid:
                    if not dry_run:
                        existing.uid = uid
                    updated += 1
                else:
                    skipped += 1
            else:
                if not dry_run:
                    db.add(LegacyUid(email=email, uid=uid))
                inserted += 1

        if not dry_run:
            db.commit()

    print(f"{inserted} inserted, {updated} updated, {skipped} skipped")
    return inserted, updated, skipped


def main(argv: list[str] | None = None) -> tuple[int, int, int]:
    parser = argparse.ArgumentParser(description="Import legacy Firebase UIDs into FixMyCity database")
    parser.add_argument("file", help="Path to users.json from firebase auth:export")
    parser.add_argument("--dry-run", action="store_true", help="Perform a dry run without modifying the database")
    args = parser.parse_args(argv)
    return import_legacy_uids(args.file, dry_run=args.dry_run)


if __name__ == "__main__":
    main()

