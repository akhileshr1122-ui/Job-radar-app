"""Related job titles and keywords: widen a search to the titles that hire the same people.

Data lives in related_titles.json (the app has an identical copy in web/related.json).
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
_FAMILIES = None
LEVEL = re.compile(r"\b(senior|sr|junior|jr|lead|principal|associate|assistant to|entry level|intern|ii|iii|iv|i)\b\.?", re.I)


def families():
    global _FAMILIES
    if _FAMILIES is None:
        try:
            with open(os.path.join(HERE, "related_titles.json"), encoding="utf-8") as fh:
                _FAMILIES = json.load(fh).get("families", [])
        except (OSError, ValueError):
            _FAMILIES = []
    return _FAMILIES


def norm(t):
    """'Sr. QA Engineer (Contract)' -> 'qa engineer'."""
    t = re.sub(r"\(.*?\)|\[.*?\]", " ", (t or "").lower())
    t = t.replace("e-commerce", "ecommerce").replace("&", " and ")
    t = LEVEL.sub(" ", t)
    t = re.sub(r"[^a-z0-9+/ ]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def _contains(big, small):
    return bool(small) and re.search(r"(?<![a-z0-9])" + re.escape(small) + r"(?![a-z0-9])", big) is not None


def _matches(title_n, fam_title_n):
    if not title_n or not fam_title_n:
        return False
    if title_n == fam_title_n:
        return True
    # a one-word family title ("Clerk", "Buyer") only counts as an exact match; longer ones may sit inside a longer title
    # ("Senior Project Coordinator, IT" is a Project Coordinator; but a Project Coordinator isn't a Construction Project Coordinator)
    return len(fam_title_n.split()) >= 2 and _contains(title_n, fam_title_n)


def families_for(titles):
    out = []
    for t in titles:
        tn = norm(t)
        for f in families():
            if f not in out and any(_matches(tn, norm(x)) for x in f["titles"]):
                out.append(f)
    return out


def related_titles(titles, n=6):
    """Titles from the same families that aren't already covered, spread across the families."""
    have = {norm(t) for t in titles}
    pools = [[x for x in f["titles"] if norm(x) not in have and not any(_matches(h, norm(x)) for h in have)] for f in families_for(titles)]
    out = []
    while len(out) < n and any(pools):
        for p in pools:
            if p and len(out) < n:
                x = p.pop(0)
                if x not in out:
                    out.append(x)
    return out


def related_keywords(titles, n=12):
    out = []
    for f in families_for(titles):
        for k in f.get("keywords", []):
            if k not in out:
                out.append(k)
    return out[:n]


def widen(cfg, resume=None, n=4):
    """Add related titles to the search phrases and related keywords to the description keywords (once).
    What was added is remembered in cfg['related_added'] so the app can show it and the person can remove it."""
    base = [q for q in cfg.get("queries", []) if q]
    if resume:
        base += [e.get("title", "") for e in resume.get("experience", [])[:3] if e.get("title")]
    extra = related_titles(base, n)
    if extra:
        cfg["queries"] = list(dict.fromkeys(cfg.get("queries", []) + extra))
    kws = related_keywords(base)
    dk = cfg.get("description_keywords")
    if kws and isinstance(dk, dict) and dk:  # only when keywords are already in use; empty means "from my skills"
        for k in kws:
            dk.setdefault(k, 1)
    cfg["related_added"] = {"titles": extra, "keywords": kws}  # keywords also join the skill-based ones at search time
    cfg["_related_v"] = 1
    return cfg
