"""OpenStreetMap Nominatim: pin -> locality + pincode, and address search. Results are cached in memory."""
from functools import lru_cache

import httpx

from .config import settings

HEADERS = {
    "User-Agent": "FixMyCity/1.0" + (f" ({settings.nominatim_contact})" if settings.nominatim_contact else ""),
    "Accept-Language": "en",
}


def _locality(addr: dict) -> str:
    for key in ("suburb", "neighbourhood", "quarter", "city_district", "residential", "village", "town"):
        if addr.get(key):
            return addr[key]
    return ""


@lru_cache(maxsize=2048)
def _reverse(lat: float, lng: float) -> dict:
    try:
        resp = httpx.get(
            f"{settings.nominatim_url}/reverse",
            params={"lat": lat, "lon": lng, "format": "jsonv2", "addressdetails": 1, "zoom": 18},
            headers=HEADERS,
            timeout=8,
        )
        data = resp.json() if resp.status_code == 200 else {}
    except (httpx.HTTPError, ValueError):
        data = {}
    addr = data.get("address", {})
    return {
        "address": data.get("display_name", ""),
        "locality": _locality(addr),
        "pincode": (addr.get("postcode") or "").replace(" ", ""),
        "city": addr.get("city") or addr.get("town") or addr.get("state_district") or "",
    }


def reverse(lat: float, lng: float) -> dict:
    # Round to ~10 m so nearby pins share the cache.
    return _reverse(round(lat, 4), round(lng, 4))


@lru_cache(maxsize=512)
def search(q: str) -> list[dict]:
    try:
        resp = httpx.get(
            f"{settings.nominatim_url}/search",
            params={
                "q": q, "format": "jsonv2", "limit": 5, "addressdetails": 1,
                "countrycodes": settings.country_codes,
                "viewbox": f"{settings.city_lng - 0.5},{settings.city_lat + 0.5},{settings.city_lng + 0.5},{settings.city_lat - 0.5}",
            },
            headers=HEADERS,
            timeout=8,
        )
        rows = resp.json() if resp.status_code == 200 else []
    except (httpx.HTTPError, ValueError):
        rows = []
    return [
        {"label": r.get("display_name", ""), "lat": float(r["lat"]), "lng": float(r["lon"])}
        for r in rows
        if "lat" in r
    ]
