"""Gemini: look at a photo and draft the report; transcribe a voice note. Plain REST, no SDK."""
import base64
import json

import httpx
from fastapi import HTTPException

from . import mock_ai
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


def _offline() -> bool:
    """Demo builds without a key answer from a small offline keyword model instead of Gemini."""
    return settings.demo_mode and not settings.gemini_api_key


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
    if _offline():
        return mock_ai.analyze_photo(note)
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
    if _offline():
        raise HTTPException(503, "Voice recording needs a Gemini key. In the demo, use Chrome or Edge: their built-in speech recognition works offline.")
    return _call(
        [
            {"text": "Transcribe this voice note about a civic problem. Return only the spoken words, "
                     "in English. If it is in another language, translate it to English."},
            {"inline_data": {"mime_type": mime.split(";")[0], "data": base64.b64encode(audio).decode()}},
        ]
    )


LANG_NAMES = {"en": "English", "ta": "Tamil", "hi": "Hindi"}

STRUCTURE_PROMPT = f"""You help residents of {settings.city_name} report civic problems to the city.
A resident described a problem in their own words, typed or spoken. It may be in English, Tamil, Hindi,
or a mix (e.g. Tanglish / Hinglish, or Tamil/Hindi written in English letters). Expected language: {{lang}}.

Turn it into a clear report for a city worker.
Rules:
- category: one of {", ".join(CATEGORIES)}. Use "other" only if nothing fits.
- title: in English, under 70 characters, plain and specific.
- description: in English, 2-3 factual sentences: what is wrong, how big, any hazard, how long. Don't invent facts.
- severity: "high" if it is a danger to people or vehicles now, "medium" if it needs fixing soon, else "low".
- landmark: a nearby place, shop, road or landmark the resident mentioned, in English; "" if none.
- original_language: "en", "ta", "hi" or "mixed".
- translated_text: a faithful English translation of what they said (same text if already English).
- is_civic_issue: false if this is not about a public civic problem.

Resident's words:
\"\"\"{{text}}\"\"\""""

STRUCTURE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "is_civic_issue": {"type": "BOOLEAN"},
        "category": {"type": "STRING", "enum": list(CATEGORIES)},
        "title": {"type": "STRING"},
        "description": {"type": "STRING"},
        "severity": {"type": "STRING", "enum": list(SEVERITIES)},
        "landmark": {"type": "STRING"},
        "original_language": {"type": "STRING"},
        "translated_text": {"type": "STRING"},
    },
    "required": ["is_civic_issue", "category", "title", "description", "severity", "landmark",
                 "original_language", "translated_text"],
}


def structure_text(text: str, lang: str = "en") -> dict:
    if _offline():
        return mock_ai.structure_text(text, lang)
    prompt = STRUCTURE_PROMPT.replace("{lang}", LANG_NAMES.get(lang, "English")).replace("{text}", text.strip()[:3000])
    try:
        data = json.loads(_call([{"text": prompt}], STRUCTURE_SCHEMA))
    except json.JSONDecodeError:
        raise HTTPException(502, "Gemini's answer couldn't be read. Try again, or fill the form yourself.")
    return {
        "is_civic_issue": bool(data.get("is_civic_issue", True)),
        "category": data.get("category") if data.get("category") in CATEGORIES else "other",
        "title": (data.get("title") or "").strip()[:140],
        "description": (data.get("description") or "").strip(),
        "severity": data.get("severity") if data.get("severity") in SEVERITIES else "medium",
        "landmark": (data.get("landmark") or "").strip()[:200],
        "original_language": data.get("original_language") if data.get("original_language") in ("en", "ta", "hi", "mixed") else lang,
        "translated_text": (data.get("translated_text") or text).strip(),
    }
