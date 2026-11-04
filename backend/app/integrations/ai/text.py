"""Tiny text-similarity toolkit (no external ML libraries).

TF-IDF cosine similarity, explained:
  * Split each text into lower-case word tokens, drop very common words ("the", "near"...).
  * TF  = how often a word appears in this text.
  * IDF = log(N / number of texts containing the word) — rare words count more.
  * Each text becomes a vector of TF*IDF weights; similarity is the cosine of the angle
    between two vectors (1 = same wording, 0 = nothing in common).
"""
from __future__ import annotations

import math
import re
from collections import Counter

STOPWORDS = set("""
a an the and or but of to in on at for from with near by is are was were be been this that it its
there here i we you they he she my our your their very please has have had not no yes as into over
under since about also just been being so than then them these those what which who will would can
could should road street area main cross layout near opposite behind
""".split())

# Very light stemming so "leaking"/"leaks"/"leak" match.
_SUFFIXES = ("ing", "ed", "es", "s")


def stem(word: str) -> str:
    for suf in _SUFFIXES:
        if word.endswith(suf) and len(word) - len(suf) >= 3:
            return word[: -len(suf)]
    return word


def tokens(text: str) -> list[str]:
    return [stem(w) for w in re.findall(r"[a-z]+", (text or "").lower()) if w not in STOPWORDS and len(w) > 2]


def tfidf_vectors(docs: list[str]) -> list[dict[str, float]]:
    toks = [tokens(d) for d in docs]
    n = len(docs)
    df = Counter(t for ts in toks for t in set(ts))
    vecs = []
    for ts in toks:
        tf = Counter(ts)
        vecs.append({t: (c / max(len(ts), 1)) * (math.log((n + 1) / (df[t] + 1)) + 1) for t, c in tf.items()})
    return vecs


def cosine(a: dict[str, float], b: dict[str, float]) -> float:
    if not a or not b:
        return 0.0
    dot = sum(v * b.get(k, 0.0) for k, v in a.items())
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0


def similarity_to_many(query: str, others: list[str]) -> list[float]:
    vecs = tfidf_vectors([query, *others])
    return [cosine(vecs[0], v) for v in vecs[1:]]
