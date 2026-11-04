"""Suggest a category for a new report.

Rule mode: every category has admin-editable keywords. We count keyword hits in the title
(weighted x2) and description, pick the best-scoring category, and turn the score margin into a
confidence between 0.2 and 0.9. Confidence is deliberately capped — it is a suggestion that a
human must confirm.

LLM mode: the model sees ONLY the category names and the report text (no personal data) and must
choose one of the given slugs; an invalid answer falls back to rules.
"""
from __future__ import annotations

from app.integrations.ai import provider
from app.integrations.ai.text import stem, tokens

SEVERE_WORDS = {"accident", "injur", "danger", "electrocut", "live wire", "sparking", "open manhole",
                "collapse", "flood", "sewage overflow", "fire", "child", "school", "hospital"}


def _rule_classify(title: str, description: str, categories: list[dict]) -> dict:
    title_t, body_t = tokens(title), tokens(description)
    scores = []
    for c in categories:
        kws = {stem(k.lower()) for kw in c.get("keywords", []) for k in kw.split()}
        score = 2 * sum(t in kws for t in title_t) + sum(t in kws for t in body_t)
        scores.append((score, c))
    scores.sort(key=lambda s: s[0], reverse=True)
    best_score, best = scores[0] if scores else (0, None)
    if not best or best_score == 0:
        other = next((c for c in categories if c["slug"] == "other"), categories[0] if categories else None)
        return {"category_slug": other["slug"] if other else None, "confidence": 0.2,
                "detected_problem": "No category keywords matched", "matched_keywords": []}
    second = scores[1][0] if len(scores) > 1 else 0
    margin = (best_score - second) / best_score
    confidence = round(min(0.9, 0.45 + 0.35 * margin + 0.03 * best_score), 2)
    kws = {stem(k.lower()) for kw in best.get("keywords", []) for k in kw.split()}
    matched = sorted({t for t in title_t + body_t if t in kws})
    return {"category_slug": best["slug"], "confidence": confidence,
            "detected_problem": f"{best['name']} — matched: {', '.join(matched[:5])}",
            "matched_keywords": matched}


def _summary(title: str, description: str) -> str:
    text = (description or title).strip().replace("\n", " ")
    first = text.split(". ")[0]
    return (first[:157] + "…") if len(first) > 160 else first


def classify(title: str, description: str, categories: list[dict], image: bytes | None = None) -> dict:
    """Suggest a category. When a photo is supplied and a vision-capable model is configured, the model
    also looks at the photo and says what it shows and whether it matches the written description.
    In rule mode photos are not analysed and the result says so (`image_analysis.status`)."""
    result = _rule_classify(title, description, categories)
    result["summary"] = _summary(title, description)
    low = f"{title} {description}".lower()
    result["safety_flags"] = sorted(w for w in SEVERE_WORDS if w in low)
    result["mode"], result["provider"] = "rules", "rules"
    result["image_analysis"] = (
        {"status": "not_provided"} if not image else
        {"status": "unavailable", "reason": "Demonstration mode: photos are analysed only when an AI provider is configured."}
    )

    if provider.llm_configured():
        slugs = [c["slug"] for c in categories]
        keys = "category_slug, confidence (0-1), summary (max 25 words), detected_problem (max 12 words)"
        if image:
            keys += (", image_observation (max 25 words, what the photo actually shows), "
                     "image_matches_description (true/false), image_problem_visible (true/false)")
        out = provider.complete_json(
            "You categorise civic complaints for a city council. Choose exactly one slug from the list. "
            "Describe only what is visible; do not guess locations or identify people. Return keys: " + keys + ".",
            "Categories: " + ", ".join("%s (%s)" % (c["slug"], c["name"]) for c in categories)
            + f"\n\nTitle: {title}\nReport: {description}" + ("\n\nA photo of the problem is attached." if image else ""),
            image=image,
        )
        if out and out.get("category_slug") in slugs:
            result.update({
                "category_slug": out["category_slug"],
                "confidence": round(min(max(float(out.get("confidence", 0.6)), 0.0), 0.95), 2),
                "summary": str(out.get("summary") or result["summary"])[:300],
                "detected_problem": str(out.get("detected_problem") or "")[:200],
                "mode": "llm", "provider": provider.provider_name(),
            })
            if image:
                result["image_analysis"] = {
                    "status": "analysed",
                    "observation": str(out.get("image_observation") or "")[:300],
                    "matches_description": bool(out.get("image_matches_description")),
                    "problem_visible": bool(out.get("image_problem_visible")),
                }
        elif image:
            result["image_analysis"] = {"status": "unavailable", "reason": "The AI provider did not return a usable answer."}
    return result
