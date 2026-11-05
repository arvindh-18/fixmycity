"""Offline stand-in for Gemini, used only by demo builds without a GEMINI_API_KEY.

A keyword model over English, Tamil, Hindi and Tanglish/Hinglish, so the "describe it in your words"
flow can be demonstrated with no internet and no key. Every answer is marked `mock: true`.
"""
import re

from .db import CATEGORIES

KEYWORDS = {
    "pothole": ["pothole", "pot hole", "road damage", "crater", "broken road", "road broken", "kuzhi", "gaddha",
                "குழி", "சாலை", "गड्ढा", "सड़क"],
    "garbage": ["garbage", "trash", "waste", "dump", "litter", "bin", "kuppai", "kachra", "குப்பை", "कचरा", "कूड़ा"],
    "streetlight": ["streetlight", "street light", "lamp", "light not", "dark", "vilakku", "batti", "விளக்கு",
                    "बत्ती", "लाइट"],
    "water": ["water", "leak", "pipe", "supply", "thanni", "paani", "தண்ணீர்", "குழாய்", "पानी", "पाइप"],
    "drainage": ["drain", "sewage", "manhole", "gutter", "overflow", "sakkadai", "naali", "சாக்கடை", "கழிவுநீர்",
                 "नाली", "सीवर"],
    "tree": ["tree", "branch", "fallen", "maram", "ped", "மரம்", "पेड़"],
    "footpath": ["footpath", "sidewalk", "pavement", "platform", "nadaipathai", "நடைபாதை", "फुटपाथ"],
    "traffic": ["signal", "traffic", "sign board", "signboard", "speed breaker", "சிக்னல்", "सिग्नल"],
}
DANGER = ["danger", "accident", "child", "children", "school", "deep", "open manhole", "fell", "injur", "night",
          "aabathu", "ஆபத்து", "விபத்து", "खतरा", "दुर्घटना"]
LANDMARK = re.compile(r"\b(?:near|opposite|in front of|beside|next to|at)\s+(?:the\s+)?([A-Za-z][\w .'-]{2,40}?)(?:[,.]|$| for| since| from)",
                      re.IGNORECASE)
TAMIL, HINDI = re.compile(r"[஀-௿]"), re.compile(r"[ऀ-ॿ]")


def _category(text: str) -> str:
    t = text.lower()
    scores = {c: sum(k in t for k in words) for c, words in KEYWORDS.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] else "other"


def structure_text(text: str, lang: str = "en") -> dict:
    t = text.strip()
    category = _category(t)
    severity = "high" if any(w in t.lower() for w in DANGER) else "medium"
    m = LANDMARK.search(t)
    landmark = m.group(1).strip().title() if m else ""
    language = "ta" if TAMIL.search(t) else "hi" if HINDI.search(t) else lang if lang in ("en", "ta", "hi") else "en"
    label = CATEGORIES[category].split(" /")[0]
    title = f"{label}{f' near {landmark}' if landmark else ''}"[:70]
    english = t if language == "en" else f"(Demo: offline mode can't translate) {t}"
    description = (f"Resident reports a {label.lower()} problem"
                   f"{f' near {landmark}' if landmark else ''}. "
                   + ("It is a safety risk and needs urgent attention." if severity == "high" else "It needs fixing soon."))
    return {"is_civic_issue": True, "category": category, "title": title, "description": description,
            "severity": severity, "landmark": landmark, "original_language": language, "translated_text": english,
            "mock": True}


def analyze_photo(note: str = "") -> dict:
    base = structure_text(note or "problem on the road", "en")
    base["title"] = base["title"] if note else "Problem spotted on the street"
    base["description"] = "Demo mode: offline photo reading. " + base["description"]
    return base
