"""Turn a worker's technical note into a short citizen-facing update.

Rule mode: replace common field jargon with plain words and frame the note as a sentence.
LLM mode: rewrite in plain language, with an explicit instruction not to add facts.
Either way the result is stored with summary_status="pending" and only appears on the public
timeline after an administrator approves (and optionally edits) it.
"""
from __future__ import annotations

import re

from app.integrations.ai import provider

JARGON = {
    r"\bPCC\b": "concrete", r"\bBT\b": "bitumen (tar)", r"\bWMM\b": "base layer",
    r"\bDWC\b": "drain pipe", r"\bHDPE\b": "plastic pipe", r"\bSWD\b": "storm-water drain",
    r"\bLT line\b": "low-voltage power line", r"\bHT line\b": "high-voltage power line",
    r"\bRMC\b": "ready-mix concrete", r"\bJCB\b": "excavator", r"\bm3\b": "cubic metres",
    r"\bmtr?s?\b": "metres", r"\bpls\b": "please", r"\bw/o\b": "without", r"\bw/\b": "with",
    r"\bETA\b": "expected time", r"\bdesilting\b": "clearing silt", r"\bPRV\b": "pressure valve",
}

KIND_LEAD = {
    "progress": "Work update",
    "obstacle": "Work is delayed",
    "resource_request": "Additional materials have been requested",
    "assistance_request": "The field team has asked for support",
}


def rule_summary(kind: str, body: str) -> str:
    text = body.strip()
    for pat, repl in JARGON.items():
        text = re.sub(pat, repl, text, flags=re.I)
    text = re.sub(r"\s+", " ", text)
    text = text[0].upper() + text[1:] if text else text
    if text and text[-1] not in ".!?":
        text += "."
    return f"{KIND_LEAD.get(kind, 'Update')}: {text}"


def summarize(kind: str, body: str) -> tuple[str, str]:
    """Returns (summary, source) where source is 'llm' or 'rules'."""
    if provider.llm_configured():
        out = provider.complete(
            "Rewrite a municipal field worker's note as a short, plain-language update for residents "
            "(max 40 words). Do not add any fact, date, cause or promise that is not in the note. "
            "Do not include names or phone numbers.",
            f"Note type: {kind}\nNote: {body}", max_tokens=200,
        )
        if out and out.strip():
            return out.strip()[:600], "llm"
    return rule_summary(kind, body), "rules"
