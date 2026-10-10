"""Job sources. Every fetcher returns a list of normalized job dicts:

  title, company, location, remote(bool), url, apply_url, source, source_id,
  posted(ISO), description(plain text), salary(str)

Fetchers never raise: failures are recorded in the per-source report.
"""
import json
import os
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

from util import get, post, strip_html, to_iso

# Lower number = preferred when the same job appears on several sources.
SOURCE_RANK = {
    "greenhouse": 0, "lever": 0, "ashby": 0, "workable": 0, "smartrecruiters": 0, "workday": 0, "amazon.jobs": 0,
    "jobbank": 1, "eluta": 1, "workingnomads": 2, "remotive": 2, "himalayas": 2, "jobicy": 2, "remoteok": 2, "weworkremotely": 2, "themuse": 2,
    "adzuna": 3, "jooble": 4,
}


def _job(**kw):
    base = {"title": "", "company": "", "location": "", "remote": False, "url": "", "apply_url": "", "source": "",
            "source_id": "", "posted": "", "description": "", "salary": ""}
    base.update({k: (v if v is not None else base.get(k, "")) for k, v in kw.items()})
    base["title"] = (base["title"] or "").strip()
    base["company"] = (base["company"] or "").strip()
    base["salary"] = str(base["salary"] or "")
    base["description"] = str(base["description"] or "")
    base["location"] = str(base["location"] or "")
    if not base["apply_url"]:
        base["apply_url"] = base["url"]
    return base


def _json(r):
    if r is None or r.status_code != 200:
        return None
    try:
        return r.json()
    except ValueError:
        return None


def _money(lo, hi, cur=""):
    try:
        lo = int(float(lo)) if lo not in (None, "", 0) else None
        hi = int(float(hi)) if hi not in (None, "", 0) else None
    except (TypeError, ValueError):
        return ""
    if lo and hi:
        return f"{cur}{lo:,} – {cur}{hi:,}"
    if lo or hi:
        return f"{cur}{(lo or hi):,}"
    return ""



# ---------------------------------------------------------------- search settings helpers (work for any profile)

COUNTRY_NAMES = {"ca": "Canada", "us": "USA"}


def places(cfg):
    """Places the user searches around, e.g. ["Toronto, ON", "Ottawa, ON"]."""
    locs = cfg.get("locations", {})
    out = [p.get("place") if isinstance(p, dict) else p for p in locs.get("search_locations", [])]
    return [p for p in out if p]


def radius_km(cfg, place):
    for p in cfg.get("locations", {}).get("search_locations", []):
        if isinstance(p, dict) and p.get("place") == place:
            return int(p.get("radius_km") or 50)
    return 50


def home_country(cfg):
    return (cfg.get("locations", {}).get("country") or "CA").lower()


def country_wide(cfg):
    return cfg.get("locations", {}).get("mode", "country") != "nearby"


def key_queries(cfg, n):
    """The n best search phrases: ones containing a must-have title word first (sources with call limits only use a few)."""
    qs = list(dict.fromkeys(q.strip() for q in cfg.get("queries", []) if q and q.strip()))
    req = [t.lower() for t in (cfg.get("title_terms", {}).get("required") or [])]
    if req:
        qs.sort(key=lambda q: not any(t in q.lower() for t in req))
    return qs[:n]


def query_words(cfg, n=8):
    stop = {"manager", "senior", "lead", "head", "of", "and", "the", "director", "specialist", "in", "for", "remote"}
    words = []
    for q in cfg.get("queries", []):
        for w in re.findall(r"[a-z][a-z-]{2,}", q.lower()):
            if w not in stop and w not in words:
                words.append(w)
    return words[:n]

# ---------------------------------------------------------------- ATS boards (no key)

def greenhouse(slug):
    d = _json(get(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs", params={"content": "true"}))
    if not d or "jobs" not in d:
        return None
    name = slug
    meta = _json(get(f"https://boards-api.greenhouse.io/v1/boards/{slug}"))
    if meta and meta.get("name"):
        name = meta["name"]
    out = []
    for j in d["jobs"]:
        out.append(_job(title=j.get("title"), company=name, location=(j.get("location") or {}).get("name", ""),
                        url=j.get("absolute_url"), source="greenhouse", source_id=str(j.get("id")),
                        posted=to_iso(j.get("first_published") or j.get("updated_at")),
                        description=strip_html(j.get("content", ""))))
    return out


def lever(slug):
    d = _json(get(f"https://api.lever.co/v0/postings/{slug}", params={"mode": "json"}))
    if not isinstance(d, list):
        return None
    out = []
    for j in d:
        cats = j.get("categories") or {}
        lists = "\n".join(f"{l.get('text', '')}\n{strip_html(l.get('content', ''))}" for l in j.get("lists") or [])
        desc = "\n".join(x for x in [j.get("descriptionPlain", ""), lists, j.get("additionalPlain", "")] if x)
        sal = j.get("salaryRange") or {}
        out.append(_job(title=j.get("text"), company=slug.replace("-", " ").title(),
                        location=cats.get("location", "") or ", ".join(cats.get("allLocations") or []),
                        remote=(j.get("workplaceType") == "remote"), url=j.get("hostedUrl"), apply_url=j.get("applyUrl"),
                        source="lever", source_id=j.get("id"), posted=to_iso(j.get("createdAt")), description=desc,
                        salary=_money(sal.get("min"), sal.get("max"), "$") if sal else ""))
    return out


def ashby(slug):
    d = _json(get(f"https://api.ashbyhq.com/posting-api/job-board/{slug}", params={"includeCompensation": "true"}))
    if not d or "jobs" not in d:
        return None
    out = []
    for j in d["jobs"]:
        if j.get("isListed") is False:
            continue
        locs = [j.get("location") or ""] + [(a or {}).get("location", "") for a in j.get("secondaryLocations") or []]
        comp = (j.get("compensation") or {}).get("compensationTierSummary", "")
        out.append(_job(title=j.get("title"), company=slug.replace("-", " ").title(), location=" / ".join(l for l in locs if l),
                        remote=bool(j.get("isRemote")) or j.get("workplaceType") == "Remote", url=j.get("jobUrl"),
                        apply_url=j.get("applyUrl"), source="ashby", source_id=j.get("id"), posted=to_iso(j.get("publishedAt")),
                        description=j.get("descriptionPlain") or strip_html(j.get("descriptionHtml", "")), salary=comp))
    return out


def smartrecruiters(slug):
    d = _json(get(f"https://api.smartrecruiters.com/v1/companies/{slug}/postings", params={"limit": 100}))
    if not d or not d.get("content"):
        return None
    out = []
    for j in d["content"]:
        loc = j.get("location") or {}
        out.append(_job(title=j.get("name"), company=(j.get("company") or {}).get("name", slug),
                        location=", ".join(x for x in [loc.get("city"), loc.get("region"), loc.get("country")] if x),
                        remote=bool(loc.get("remote")), url=f"https://jobs.smartrecruiters.com/{slug}/{j.get('id')}",
                        source="smartrecruiters", source_id=j.get("id"), posted=to_iso(j.get("releasedDate"))))
    return out


def workable(slug):
    r = post(f"https://apply.workable.com/api/v3/accounts/{slug}/jobs",
             json_body={"query": "", "location": [], "department": [], "worktype": [], "remote": []})
    d = _json(r)
    if not d or "results" not in d:
        return None
    out = []
    for j in d["results"]:
        loc = j.get("location") or {}
        out.append(_job(title=j.get("title"), company=slug.replace("-", " ").title(),
                        location=", ".join(x for x in [loc.get("city"), loc.get("region"), loc.get("country")] if x),
                        remote=bool(j.get("remote")), url=f"https://apply.workable.com/{slug}/j/{j.get('shortcode')}/",
                        source="workable", source_id=j.get("shortcode"), posted=to_iso(j.get("published"))))
    return out


ATS = {"greenhouse": greenhouse, "lever": lever, "ashby": ashby, "workable": workable, "smartrecruiters": smartrecruiters}


def ats_boards(cfg, cache, report):
    """Check every candidate company on every ATS; remember which exist so later runs are fast."""
    from concurrent.futures import ThreadPoolExecutor

    jobs = []
    today = datetime.now(timezone.utc)
    tasks = []
    for slug in dict.fromkeys(cfg["ats_companies"]["candidates"]):
        entry = cache.setdefault(slug, {})
        for ats in ATS:
            state = entry.get(ats)
            if state and state.get("ok") is False:
                checked = datetime.fromisoformat(state["checked"])
                if today - checked < timedelta(days=21):
                    continue
            tasks.append((slug, ats))

    def run(t):
        slug, ats = t
        try:
            return slug, ats, ATS[ats](slug)
        except Exception:
            return slug, ats, None

    with ThreadPoolExecutor(max_workers=12) as pool:
        for slug, ats, res in pool.map(run, tasks):
            cache[slug][ats] = {"ok": bool(res), "checked": today.isoformat()}
            if res:
                jobs.extend(res)
                report[ats] = report.get(ats, 0) + len(res)
    report["ats_boards_found"] = sorted(f"{a}:{s}" for s, e in cache.items() for a, v in e.items() if v.get("ok"))
    return jobs


def workday(cfg, report):
    """Big-brand career sites on Workday. Search each, then read details for postings whose title could fit."""
    req_terms = [t.lower() for t in cfg["title_terms"]["required"]]
    jobs, seen = [], set()
    for url in cfg.get("workday_sites", {}).get("urls", []):
        m = re.match(r"https?://([^.]+)\.(wd\d+)\.myworkdayjobs\.com/(?:[a-z]{2}-[A-Z]{2}/)?([^/?#]+)", url)
        if not m:
            continue
        tenant, wd, site = m.groups()
        base = f"https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}"
        for q in query_words(cfg, 6):
            d = _json(post(base + "/jobs", json_body={"appliedFacets": {}, "limit": 20, "offset": 0, "searchText": q}))
            for j in (d or {}).get("jobPostings", []):
                path = j.get("externalPath", "")
                title = (j.get("title") or "").lower()
                if path in seen or not any(t in title for t in req_terms):
                    continue
                seen.add(path)
                info = (_json(get(base + path)) or {}).get("jobPostingInfo", {})
                loc = info.get("location") or j.get("locationsText", "")
                country = (info.get("country") or {}).get("descriptor", "")
                if country and country.lower() not in loc.lower():
                    loc = f"{loc}, {country}"
                jobs.append(_job(title=j.get("title"), company=tenant.upper() if len(tenant) <= 3 else tenant.title(), location=loc,
                                 remote="remote" in (info.get("remoteType") or "").lower(),
                                 url=info.get("externalUrl") or f"https://{tenant}.{wd}.myworkdayjobs.com/{site}{path}",
                                 source="workday", source_id=path, posted=to_iso(info.get("startDate")),
                                 description=strip_html(info.get("jobDescription", ""))))
            time.sleep(0.4)
    report["workday"] = len(jobs)
    return jobs


# ---------------------------------------------------------------- Amazon (company career site JSON)

def amazon_jobs(cfg, report):
    jobs = []
    if not cfg.get("sources", {}).get("amazon_jobs", True):
        report["amazon.jobs"] = "off"
        return []
    queries = key_queries(cfg, 6) + query_words(cfg, 4)
    country = COUNTRY_NAMES.get(home_country(cfg), "Canada")
    for loc in ([country] if country_wide(cfg) or not places(cfg) else []) + places(cfg):
        for q in queries:
            d = _json(get("https://www.amazon.jobs/en/search.json",
                          params={"base_query": q, "loc_query": loc, "result_limit": 100, "sort": "recent"}))
            for j in (d or {}).get("jobs", []):
                desc = "\n\n".join(x for x in [j.get("description", ""), "Basic qualifications:\n" + (j.get("basic_qualifications") or ""),
                                               "Preferred qualifications:\n" + (j.get("preferred_qualifications") or "")] if x)
                path = j.get("job_path", "")
                jobs.append(_job(title=j.get("title"), company="Amazon" if not j.get("company_name") else j.get("company_name"),
                                 location=j.get("normalized_location") or j.get("location", ""),
                                 url=f"https://www.amazon.jobs{path}" if path else "", apply_url=j.get("url_next_step") or "",
                                 source="amazon.jobs", source_id=str(j.get("id_icims") or j.get("id")),
                                 posted=to_iso(_amazon_date(j.get("posted_date"))), description=strip_html(desc)))
            time.sleep(0.4)
    report["amazon.jobs"] = len(jobs)
    return jobs


def _amazon_date(s):
    try:
        return datetime.strptime(s, "%B %d, %Y").replace(tzinfo=timezone.utc).isoformat()
    except (TypeError, ValueError):
        return s


# ---------------------------------------------------------------- Remote boards (no key)

def remotive(cfg, report):
    jobs, seen = [], set()
    for q in cfg["queries"]:
        d = _json(get("https://remotive.com/api/remote-jobs", params={"search": q, "limit": 100}))
        for j in (d or {}).get("jobs", []):
            if j.get("id") in seen:
                continue
            seen.add(j.get("id"))
            jobs.append(_job(title=j.get("title"), company=j.get("company_name"),
                             location="Remote – " + (j.get("candidate_required_location") or "Anywhere"), remote=True,
                             url=j.get("url"), source="remotive", source_id=str(j.get("id")),
                             posted=to_iso(j.get("publication_date")), description=strip_html(j.get("description", "")),
                             salary=j.get("salary", "")))
        time.sleep(1)
    report["remotive"] = len(jobs)
    return jobs


def remoteok(cfg, report):
    d = _json(get("https://remoteok.com/api"))
    jobs = []
    for j in (d or [])[1:]:
        if not isinstance(j, dict):
            continue
        jobs.append(_job(title=j.get("position"), company=j.get("company"), location="Remote – " + (j.get("location") or "Anywhere"),
                         remote=True, url=j.get("url"), apply_url=j.get("apply_url") or j.get("url"), source="remoteok",
                         source_id=str(j.get("id")), posted=to_iso(j.get("epoch") or j.get("date")),
                         description=strip_html(j.get("description", "")),
                         salary=_money(j.get("salary_min"), j.get("salary_max"), "$")))
    report["remoteok"] = len(jobs)
    return jobs


def himalayas(cfg, report):
    jobs, seen = [], set()
    for q in cfg["queries"][:10]:
        d = _json(get("https://himalayas.app/jobs/api/search", params={"q": q, "limit": 50}))
        if d is None:
            d = _json(get("https://himalayas.app/jobs/api", params={"limit": 100}))
        for j in (d or {}).get("jobs", []):
            gid = j.get("guid") or j.get("applicationLink")
            if gid in seen:
                continue
            seen.add(gid)
            restr = j.get("locationRestrictions") or []
            restr = [r if isinstance(r, str) else (r or {}).get("name", "") for r in restr]
            jobs.append(_job(title=j.get("title"), company=j.get("companyName"),
                             location="Remote – " + (", ".join(restr) if restr else "Anywhere"), remote=True,
                             url=j.get("applicationLink") or gid, source="himalayas", source_id=str(gid),
                             posted=to_iso(j.get("pubDate")), description=strip_html(j.get("description") or j.get("excerpt", "")),
                             salary=_money(j.get("minSalary"), j.get("maxSalary"), "$")))
        time.sleep(1)
    report["himalayas"] = len(jobs)
    return jobs


def jobicy(cfg, report):
    jobs, seen = [], set()
    for tag in query_words(cfg, 7):
        d = _json(get("https://jobicy.com/api/v2/remote-jobs", params={"count": 50, "tag": tag}))
        for j in (d or {}).get("jobs", []):
            if j.get("id") in seen:
                continue
            seen.add(j.get("id"))
            jobs.append(_job(title=j.get("jobTitle"), company=j.get("companyName"), location="Remote – " + (j.get("jobGeo") or "Anywhere"),
                             remote=True, url=j.get("url"), source="jobicy", source_id=str(j.get("id")), posted=to_iso(j.get("pubDate")),
                             description=strip_html(j.get("jobDescription", "")),
                             salary=_money(j.get("annualSalaryMin"), j.get("annualSalaryMax"), "$")))
        time.sleep(1)
    report["jobicy"] = len(jobs)
    return jobs


def _rss_items(text):
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return []
    return root.iter("item")


def weworkremotely(cfg, report):
    jobs = []
    for cat in ["remote-sales-and-marketing-jobs", "remote-management-and-finance-jobs", "remote-customer-support-jobs", "all-other-remote-jobs"]:
        r = get(f"https://weworkremotely.com/categories/{cat}.rss")
        if r is None or r.status_code != 200:
            continue
        for it in _rss_items(r.content):
            raw = (it.findtext("title") or "")
            company, _, title = raw.partition(":")
            if not title:
                company, title = "", raw
            link = it.findtext("link") or ""
            jobs.append(_job(title=title.strip(), company=company.strip(), location="Remote – " + (it.findtext("region") or "Anywhere"),
                             remote=True, url=link, source="weworkremotely", source_id=link, posted=to_iso(it.findtext("pubDate")),
                             description=strip_html(it.findtext("description") or "")))
    report["weworkremotely"] = len(jobs)
    return jobs


def themuse(cfg, report):
    jobs = []
    cats = ["Account Management", "Sales", "Marketing", "Retail", "Business Operations", "Product Management", "Advertising and Marketing"]
    for loc in [p.split(",")[0] + ", " + COUNTRY_NAMES.get(home_country(cfg), "Canada") for p in places(cfg)[:1]] + ["Flexible / Remote"]:
        for page in range(0, 3):
            params = [("page", page), ("location", loc)] + [("category", c) for c in cats]
            d = _json(get("https://www.themuse.com/api/public/jobs", params=params))
            res = (d or {}).get("results", [])
            for j in res:
                locs = ", ".join(l.get("name", "") for l in j.get("locations") or [])
                jobs.append(_job(title=j.get("name"), company=(j.get("company") or {}).get("name", ""), location=locs,
                                 remote="remote" in locs.lower() or "flexible" in locs.lower(),
                                 url=(j.get("refs") or {}).get("landing_page", ""), source="themuse", source_id=str(j.get("id")),
                                 posted=to_iso(j.get("publication_date")), description=strip_html(j.get("contents", ""))))
            if not res:
                break
            time.sleep(0.5)
    report["themuse"] = len(jobs)
    return jobs


ATOM = "{http://www.w3.org/2005/Atom}"


def jobbank(cfg, report):
    """Canada Job Bank search feed (Atom)."""
    jobs, seen = [], set()
    if home_country(cfg) != "ca":
        report["jobbank"] = "Canada only"
        return []
    for q in key_queries(cfg, 6) + query_words(cfg, 4):
        for loc in places(cfg) + ([""] if country_wide(cfg) or not places(cfg) else []):
            params = {"searchstring": q, "sort": "D"}
            if loc:
                params["locationstring"] = loc
            r = get("https://www.jobbank.gc.ca/jobsearch/feed/jobSearchRSSfeed", params=params)
            if r is None or r.status_code != 200:
                continue
            try:
                root = ET.fromstring(r.content)
            except ET.ParseError:
                continue
            for e in root.iter(ATOM + "entry"):
                link_el = e.find(ATOM + "link")
                link = link_el.get("href") if link_el is not None else (e.findtext(ATOM + "id") or "")
                if link in seen:
                    continue
                seen.add(link)
                title = e.findtext(ATOM + "title") or ""
                body = strip_html(e.findtext(ATOM + "summary") or e.findtext(ATOM + "content") or "")
                company = ""
                m = re.search(r"(?i)employer:?\s*([^\n]+)", body)
                if m:
                    company = m.group(1).strip()
                lm = re.search(r"(?i)location:?\s*([^\n]+)", body)
                loc_txt = lm.group(1).strip() if lm else ""
                if loc_txt and "canada" not in loc_txt.lower():
                    loc_txt += ", Canada"
                jobs.append(_job(title=title, company=company, location=loc_txt or "Canada", url=link, source="jobbank",
                                 source_id=link, posted=to_iso(e.findtext(ATOM + "updated") or e.findtext(ATOM + "published")),
                                 description=body))
            time.sleep(0.5)
    report["jobbank"] = len(jobs)
    return jobs


def eluta(cfg, report):
    """Eluta.ca: jobs straight from Canadian employer websites (RSS)."""
    jobs, seen = [], set()
    if home_country(cfg) != "ca":
        report["eluta"] = "Canada only"
        return []
    for q in key_queries(cfg, 10):
        for loc in [p.split(",")[0] for p in places(cfg)] + (["Canada"] if country_wide(cfg) or not places(cfg) else []):
            r = get("https://www.eluta.ca/rss", params={"q": q, "l": loc})
            code = str(getattr(r, "status_code", "none"))
            report["eluta_http"] = report.get("eluta_http", "") + ("" if code in report.get("eluta_http", "") else code + " ")
            if r is None or r.status_code != 200:
                time.sleep(2)
                continue
            for it in _rss_items(r.content):
                gid = it.findtext("guid") or it.findtext("link")
                if gid in seen:
                    continue
                seen.add(gid)
                where = it.findtext("location") or loc
                if "canada" not in where.lower():
                    where += ", Canada"
                desc = strip_html(it.findtext("description") or "")
                desc = re.sub(r"^[^:]{0,120}\):\s*\.\.\.", "", desc)
                jobs.append(_job(title=it.findtext("title"), company=it.findtext("employer") or "", location=where,
                                 url=it.findtext("link"), source="eluta", source_id=gid, posted=to_iso(it.findtext("pubDate")),
                                 description=desc))
            time.sleep(1.2)
    report["eluta"] = len(jobs)
    return jobs


def workingnomads(cfg, report):
    d = _json(get("https://www.workingnomads.com/api/exposed_jobs/"))
    jobs = []
    for j in d or []:
        tags = j.get("tags") or ""
        jobs.append(_job(title=j.get("title"), company=j.get("company_name") or j.get("company") or "",
                         location="Remote – " + (j.get("location") or "Anywhere"), remote=True, url=j.get("url"),
                         source="workingnomads", source_id=j.get("url"), posted=to_iso(j.get("pub_date")),
                         description=strip_html(j.get("description", "")) + (f"\nTags: {tags}" if tags else "")))
    report["workingnomads"] = len(jobs)
    return jobs




def jsearch(cfg, report, state):
    """JSearch (RapidAPI) = Google for Jobs: LinkedIn, Indeed, Glassdoor, ZipRecruiter... Once a day to fit the free tier."""
    key = os.environ.get("RAPIDAPI_KEY")
    if not key:
        report["jsearch"] = "skipped (no RAPIDAPI_KEY secret)"
        return []
    today = datetime.now(timezone.utc).date().isoformat()
    if state.get("jsearch_day") == today:
        report["jsearch"] = "already ran today (free tier: once a day)"
        return []
    jobs = []
    country = home_country(cfg)
    where = places(cfg) or [COUNTRY_NAMES.get(country, "")]
    plan = [(f"{q} in {where[i % len(where)]}", country) for i, q in enumerate(key_queries(cfg, 5))] + \
           [(f"{key_queries(cfg, 1)[0] if key_queries(cfg, 1) else 'jobs'} remote", country)]
    for q, country in plan[: cfg.get("jsearch_per_day", 6)]:
        r = get("https://jsearch.p.rapidapi.com/search", params={"query": q, "page": 1, "num_pages": 1, "country": country, "date_posted": "3days"},
                headers={"X-RapidAPI-Key": key, "X-RapidAPI-Host": "jsearch.p.rapidapi.com"})
        d = _json(r)
        if d is None:
            report["jsearch_error"] = f"HTTP {getattr(r, 'status_code', '?')}"
            break
        for j in d.get("data") or []:
            ctry = (j.get("job_country") or "").upper()
            where = ", ".join(x for x in [j.get("job_city"), j.get("job_state"), {"CA": "Canada", "US": "USA"}.get(ctry, ctry)] if x)
            pub = (j.get("job_publisher") or "web").strip()
            jobs.append(_job(title=j.get("job_title"), company=j.get("employer_name"), location=where or ("Remote" if j.get("job_is_remote") else ""),
                             remote=bool(j.get("job_is_remote")), url=j.get("job_apply_link") or j.get("job_google_link"),
                             source=pub.lower().replace(" ", "")[:20], source_id=j.get("job_id"),
                             posted=to_iso(j.get("job_posted_at_datetime_utc")), description=j.get("job_description") or "",
                             salary=_money(j.get("job_min_salary"), j.get("job_max_salary"), "$")))
        time.sleep(1)
    state["jsearch_day"] = today
    report["jsearch"] = len(jobs)
    return jobs


# ---------------------------------------------------------------- Aggregators (free keys)



def adzuna(cfg, report):
    app_id, app_key = os.environ.get("ADZUNA_APP_ID"), os.environ.get("ADZUNA_APP_KEY")
    if not app_id or not app_key:
        report["adzuna"] = "skipped (no ADZUNA_APP_ID / ADZUNA_APP_KEY secret)"
        return []
    jobs = []
    home = home_country(cfg)
    plan = [(home, p, radius_km(cfg, p)) for p in places(cfg)]
    if country_wide(cfg) or not plan:
        plan.append((home, "", 0))
    if cfg["locations"].get("include_us_remote") and home == "ca":
        plan.append(("us", "remote", 0))
    for country, where, dist in plan:
        for q in key_queries(cfg, 6):
            params = {"app_id": app_id, "app_key": app_key, "what": q, "results_per_page": 50,
                      "max_days_old": cfg.get("max_age_days", 30), "sort_by": "date", "content-type": "application/json"}
            if where == "remote":
                params["what"] = q + " remote"
            elif where:
                params["where"] = where
                params["distance"] = dist
            d = _json(get(f"https://api.adzuna.com/v1/api/jobs/{country}/search/1", params=params))
            for j in (d or {}).get("results", []):
                loc = (j.get("location") or {}).get("display_name", "")
                cname = COUNTRY_NAMES.get(country, country.upper())
                if cname.lower() not in loc.lower() and not (country == "us" and re.search(r"\b(US|USA|United States)\b", loc)):
                    loc = f"{loc}, {cname}"
                jobs.append(_job(title=strip_html(j.get("title")), company=(j.get("company") or {}).get("display_name", ""),
                                 location=loc, remote="remote" in (j.get("title", "") + j.get("description", "")).lower(),
                                 url=j.get("redirect_url"), source="adzuna", source_id=str(j.get("id")),
                                 posted=to_iso(j.get("created")), description=strip_html(j.get("description", "")),
                                 salary=_money(j.get("salary_min"), j.get("salary_max"), "$")))
            time.sleep(2.6)
    report["adzuna"] = len(jobs)
    return jobs


def jooble(cfg, report):
    key = os.environ.get("JOOBLE_KEY")
    if not key:
        report["jooble"] = "skipped (no JOOBLE_KEY secret)"
        return []
    jobs = []
    for loc in places(cfg) + ["Remote"]:
        for q in key_queries(cfg, 5):
            d = _json(post(f"https://jooble.org/api/{key}", json_body={"keywords": q, "location": loc, "page": 1}))
            for j in (d or {}).get("jobs", []):
                l = j.get("location", "")
                if loc != "Remote" and "," not in l:
                    l = f"{l}, {COUNTRY_NAMES.get(home_country(cfg), '')}"
                jobs.append(_job(title=strip_html(j.get("title")), company=j.get("company"), location=l or loc,
                                 remote="remote" in (l + j.get("title", "")).lower(), url=j.get("link"), source="jooble",
                                 source_id=str(j.get("id")), posted=to_iso(j.get("updated")),
                                 description=strip_html(j.get("snippet", "")), salary=j.get("salary", "")))
            time.sleep(1)
    report["jooble"] = len(jobs)
    return jobs


BOARD_SOURCES = [amazon_jobs, jobbank, eluta, remotive, remoteok, himalayas, jobicy, weworkremotely, workingnomads, themuse, adzuna, jooble, workday]


def source_on(cfg, name):
    """Sources can be switched off in Search preferences (profile/search.json → "sources")."""
    return cfg.get("sources", {}).get(name, True) is not False


# Sources that don't depend on the person's search words. In hosted (bulk) mode they run once for everybody.
SHARED_SOURCES = [remoteok, weworkremotely, workingnomads, workday]


def _run_sources(fns, cfg, report, jobs):
    for fn in fns:
        if not source_on(cfg, fn.__name__):
            report[fn.__name__] = "off"
            continue
        try:
            jobs.extend(fn(cfg, report))
        except Exception as e:  # never let one source kill the run
            report[fn.__name__] = f"error: {e!r}"[:200]


def fetch_user(cfg, state):
    """Searches driven by one person's job titles and places."""
    report, jobs = {}, []
    try:
        if source_on(cfg, "jsearch"):
            jobs.extend(jsearch(cfg, report, state))
        else:
            report["jsearch"] = "off"
    except Exception as e:
        report["jsearch"] = f"error: {e!r}"[:200]
    _run_sources([f for f in BOARD_SOURCES if f not in SHARED_SOURCES], cfg, report, jobs)
    return jobs, report


def fetch_shared(cfg, cache):
    """Company career boards and whole-site feeds: the same for everybody."""
    report, jobs = {}, []
    _run_sources(SHARED_SOURCES, cfg, report, jobs)
    try:
        if source_on(cfg, "company_boards"):
            jobs.extend(ats_boards(cfg, cache, report))
        else:
            report["company_boards"] = "off"
    except Exception as e:
        report["ats"] = f"error: {e!r}"[:200]
    return jobs, report


def fetch_all(cfg, cache, state):
    jobs, report = fetch_user(cfg, state)
    more, r2 = fetch_shared(cfg, cache)
    report.update(r2)
    return jobs + more, report
