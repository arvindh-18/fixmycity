"""Swappable LLM provider.

AI_PROVIDER=rules      -> no network calls; every feature uses its rule-based implementation
AI_PROVIDER=anthropic  -> Anthropic Messages API (AI_API_KEY, optional AI_MODEL)
AI_PROVIDER=openai     -> any OpenAI-compatible /chat/completions endpoint (AI_BASE_URL, AI_API_KEY, AI_MODEL)

`complete()` returns None on ANY failure (missing key, timeout, HTTP error). Callers then fall back
to rules, and record mode="rules" so the UI can say it ran in demonstration mode.
"""
from __future__ import annotations

import base64
import json
import logging
import re

import httpx

from app.core.config import settings

log = logging.getLogger("openward.ai")


def llm_configured() -> bool:
    return settings.ai_provider in {"anthropic", "openai"} and bool(settings.ai_api_key)


def mode() -> str:
    return "llm" if llm_configured() else "rules"


def provider_name() -> str:
    return settings.ai_provider if llm_configured() else "rules"


def complete(system: str, user: str, max_tokens: int = 600, image: bytes | None = None) -> str | None:
    """Text completion. With `image` (JPEG bytes) the model also sees the photo (vision models only)."""
    if not llm_configured():
        return None
    b64 = base64.b64encode(image).decode() if image else None
    try:
        if settings.ai_provider == "anthropic":
            resp = httpx.post(
                (settings.ai_base_url or "https://api.anthropic.com") + "/v1/messages",
                headers={"x-api-key": settings.ai_api_key, "anthropic-version": "2023-06-01",
                         "content-type": "application/json"},
                json={"model": settings.ai_model or "claude-haiku-5-5", "max_tokens": max_tokens,
                      "system": system, "messages": [{"role": "user", "content": user if not b64 else [
                          {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}},
                          {"type": "text", "text": user}]}]},
                timeout=settings.ai_timeout_seconds,
            )
            resp.raise_for_status()
            return "".join(b.get("text", "") for b in resp.json().get("content", []))
        resp = httpx.post(
            (settings.ai_base_url or "https://api.openai.com/v1") + "/chat/completions",
            headers={"Authorization": f"Bearer {settings.ai_api_key}"},
            json={"model": settings.ai_model or "gpt-4o-mini", "max_tokens": max_tokens,
                  "messages": [{"role": "system", "content": system}, {"role": "user", "content": user if not b64 else [
                      {"type": "text", "text": user},
                      {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}]}]},
            timeout=settings.ai_timeout_seconds,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]
    except Exception as exc:  # network, auth, schema — all degrade to rules
        log.warning("LLM call failed, falling back to rules: %s", exc)
        return None


def complete_json(system: str, user: str, max_tokens: int = 600, image: bytes | None = None) -> dict | None:
    text = complete(system + "\nRespond with a single JSON object and nothing else.", user, max_tokens, image=image)
    if not text:
        return None
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
