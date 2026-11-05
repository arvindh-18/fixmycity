"""Gemini: look at a photo and draft the report; transcribe a voice note. Plain REST, no SDK."""
import base64
import json

import httpx
from fastapi import HTTPException

from .config import settings
from .db import CATEGORIES, SEVERITIES

API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

ANALYZE_PROMPT = f"""You help residents of {settings.city_name} report civic problems to the city.
Look at the photo and draft a short report.

Rules:
- category: one of {", ".join(CATEGORIES)}. Use "other" only if nothing fits.
- title: under 70 characters, plain and specific (e.g. "Deep pothole across left lane").
- description: 2-3 factual sentences a city worker can act on: what is wrong, how big, any hazard. No guessing about the street name.
- severity: "high" if it is a danger to people or vehicles now, "medium" if it needs fixing soon, else "low".
- is_civic_issue: false if the photo does not show a public civic problem (selfie, indoor, meme, blank).
{{hint}}"""

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "is_civic_issue": {"type": "BOOLEAN"},
        "category": {"type": "STRING", "enum": list(CATEGORIES)},
        "title": {"type": "STRING"},
        "description": {"type": "STRING"},
        "severity": {"type": "STRING", "enum": list(SEVERITIES)},
    },
    "required": ["is_civic_issue", "category", "title", "description", "severity"],
}


def _call(parts: list[dict], json_schema: dict | None = None) -> str:
    if not settings.ai_enabled:
        raise HTTPException(503, "AI is not configured (set GEMINI_API_KEY).")
    body: dict = {"contents": [{"role": "user", "parts": parts}], "generationConfig": {"temperature": 0.2}}
    if json_schema:
        body["generationConfig"].update(responseMimeType="application/json", responseSchema=json_schema)
    try:
        resp = httpx.post(
            API.format(model=settings.gemini_model),
            headers={"x-goog-api-key": settings.gemini_api_key},
            json=body,
            timeout=40,
        )
    except httpx.HTTPError:
        raise HTTPException(502, "Could not reach Gemini. Try again, or type the description yourself.")
    if resp.status_code != 200:
        msg = resp.json().get("error", {}).get("message", resp.text[:200]) if resp.content else resp.status_code
        raise HTTPException(502, f"Gemini error: {msg}")
    try:
        return "".join(p.get("text", "") for p in resp.json()["candidates"][0]["content"]["parts"]).strip()
    except (KeyError, IndexError):
        raise HTTPException(502, "Gemini returned no answer for this input.")


def analyze_photo(image: bytes, mime: str, note: str = "") -> dict:
    hint = f'The resident also said: "{note}"' if note.strip() else ""
    text = _call(
        [
            {"text": ANALYZE_PROMPT.replace("{hint}", hint)},
            {"inline_data": {"mime_type": mime, "data": base64.b64encode(image).decode()}},
        ],
        SCHEMA,
    )
    data = json.loads(text)
    if data.get("category") not in CATEGORIES:
        data["category"] = "other"
    if data.get("severity") not in SEVERITIES:
        data["severity"] = "medium"
    data["title"] = (data.get("title") or "")[:140]
    return data


def transcribe(audio: bytes, mime: str) -> str:
    return _call(
        [
            {"text": "Transcribe this voice note about a civic problem. Return only the spoken words, "
                     "in English. If it is in another language, translate it to English."},
            {"inline_data": {"mime_type": mime.split(";")[0], "data": base64.b64encode(audio).decode()}},
        ]
    )
