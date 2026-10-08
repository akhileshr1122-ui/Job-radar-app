"""Relevance scoring: 0-100 plus human-readable reasons."""
import re

from util import age_days, classify_location, geocode, km_between


def nearest_place(location, cfg):
    """(place, km, radius) for the closest search location, or None when it can't be placed on a map."""
    pts = cfg.get("_place_points") or []
    if not pts or not location:
        return None
    here = geocode(location)
    if not here:
        return None
    return min(((p, km_between(here, ll), r) for p, ll, r in pts), key=lambda x: x[1])

AMAZON_INTERNAL_TITLE = re.compile(r"account manager|vendor manager|category manager|marketplace|seller|retail|advertis|business development|program manager", re.I)


def _has(text, term):
    return re.search(r"(?<![a-z0-9])" + re.escape(term) + r"(?![a-z0-9])", text) is not None


def score(job, cfg):
    """Return (score, reasons, matched_keywords) or None if the job is filtered out."""
    title = job["title"].lower()
    company = job["company"].lower()
    desc = job["description"].lower()
    tt = cfg["title_terms"]
    reasons = []

    if not title:
        return None
    for term in cfg["exclude_title"]:
        if _has(title, term):
            return None
    if any(c.lower() == company for c in cfg.get("exclude_company", [])):
        return None

    amazon_co = company.startswith("amazon")
    required = tt.get("required") or cfg.get("_auto_required", [])
    if required and not any(_has(title, t) for t in required):
        if not (amazon_co and cfg.get("sources", {}).get("amazon_jobs", True) and AMAZON_INTERNAL_TITLE.search(title)):
            return None

    # ---- location
    country, remote = classify_location(job["location"], job.get("remote"), job["description"])
    job["country"], job["remote"] = country, remote
    loc_l = job["location"].lower()
    locs = cfg["locations"]
    home = (locs.get("country") or "CA").upper()
    other = "US" if home == "CA" else "CA"
    nearby_only = locs.get("mode") == "nearby"
    home_name = {"CA": "Canada", "US": "the US"}[home]
    loc_pts = 0
    if country == home:
        if remote:
            loc_pts, why = 10, f"Remote in {home_name}"
        else:
            near = nearest_place(job["location"], cfg)
            home_terms = locs.get("home_city_terms") or []
            if near is not None:
                place, km, radius = near
                if km <= radius:
                    loc_pts, why = 10, f"{round(km)} km from {place.split(',')[0]}"
                elif nearby_only:
                    return None
                else:
                    loc_pts, why = 0, f"{round(km)} km from {place.split(',')[0]}"
            elif any(t in loc_l for t in home_terms):
                loc_pts, why = 10, "In your area"
            elif nearby_only and locs.get("search_locations"):
                return None
            else:
                loc_pts, why = 0, f"Elsewhere in {home_name}"
        reasons.append(why)
    elif country == "NA":
        loc_pts = 6
        reasons.append("Remote, North America / anywhere")
    elif country == other:
        flag = "include_us_remote" if other == "US" else "include_ca_remote"
        if remote and locs.get(flag, other == "US"):
            if home_name.replace("the ", "").lower() in desc:
                loc_pts = 4
                reasons.append(f"{other} remote, mentions {home_name}")
            else:
                loc_pts = -15
                reasons.append(f"{other} remote – may be for {other} residents only")
        elif locs.get(f"include_{other.lower()}_onsite"):
            loc_pts = -10
            reasons.append(f"{other} on-site – needs a work permit there")
        else:
            return None
    elif country == "UNKNOWN":
        loc_pts = -6
        reasons.append("Location unclear")
    else:
        return None

    # ---- freshness
    age = age_days(job.get("posted"))
    age_pts = 0
    if age is not None:
        if age > cfg.get("max_age_days", 30):
            return None
        if age <= 3:
            age_pts = 6
            reasons.append("Posted in the last 3 days")
        elif age <= 7:
            age_pts = 3

    # ---- title fit
    t_pts = sum(w for term, w in tt["weighted"].items() if _has(title, term))
    if amazon_co:
        t_pts += 10
        reasons.append("Amazon role (ex-Amazon)")
    t_pts = min(t_pts, 32)
    sen = [w for term, w in tt["seniority"].items() if _has(title, term)]
    pos = [w for w in sen if w > 0]
    s_pts = (max(pos) if pos else 0) + sum(w for w in sen if w < 0)
    if s_pts >= 8:
        reasons.append("Manager-level or above")

    # ---- description fit
    matched = [k for k in cfg["description_keywords"] if _has(desc, k)]
    d_pts = min(sum(cfg["description_keywords"][k] for k in matched), 36)
    if len(desc.strip()) < 600:
        d_pts = max(d_pts, 14)  # source only gave a snippet; don't punish the job for it
    if matched:
        reasons.append("Matches: " + ", ".join(matched[:6]))

    # ---- salary floor
    floor = cfg.get("min_salary_cad", 0)
    if floor and job.get("salary"):
        nums = [int(n.replace(",", "")) for n in re.findall(r"\d[\d,]{3,}", job["salary"])]
        if nums and max(nums) < floor:
            return None

    total = 12 + t_pts + s_pts + d_pts + loc_pts + age_pts
    return max(0, min(100, total)), reasons, matched
