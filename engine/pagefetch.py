"""Read one job posting page the user shared (LinkedIn, Indeed, company site...).

Most job pages embed schema.org JobPosting JSON-LD (it's what Google for Jobs reads), so that is tried first;
otherwise the page title and visible text are used.
"""
import json
import re

import requests

from util import strip_html, to_iso

UA = ("Mozilla/5.0 (Linux; Android 14; SM-S928W) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0 Mobile Safari/537.36")


def _first(x):
    return x[0] if isinstance(x, list) and x else x


def _jobposting(obj):
    if isinstance(obj, list):
        for o in obj:
            r = _jobposting(o)
            if r:
                return r
    if isinstance(obj, dict):
        t = obj.get("@type")
        if t == "JobPosting" or (isinstance(t, list) and "JobPosting" in t):
            return obj
        if "@graph" in obj:
            return _jobposting(obj["@graph"])
    return None


def fetch(url):
    try:
        r = requests.get(url, headers={"User-Agent": UA, "Accept-Language": "en-CA,en;q=0.9"}, timeout=30, allow_redirects=True)
    except requests.RequestException as e:
        print(f"  fetch failed: {e!r}")
        return {}
    if r.status_code != 200:
        print(f"  fetch HTTP {r.status_code}")
        return {}
    html = r.text
    for block in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html, re.S | re.I):
        try:
            jp = _jobposting(json.loads(block.strip()))
        except ValueError:
            continue
        if not jp:
            continue
        org = _first(jp.get("hiringOrganization")) or {}
        loc = _first(jp.get("jobLocation")) or {}
        addr = (loc.get("address") if isinstance(loc, dict) else {}) or {}
        if isinstance(addr, str):
            where = addr
        else:
            where = ", ".join(x for x in [addr.get("addressLocality"), addr.get("addressRegion"),
                                          {"CA": "Canada", "US": "USA"}.get(str(addr.get("addressCountry", "")).upper(),
                                                                            addr.get("addressCountry") if isinstance(addr.get("addressCountry"), str) else "")] if x)
        remote = str(jp.get("jobLocationType", "")).upper() == "TELECOMMUTE"
        sal = ""
        bs = jp.get("baseSalary")
        if isinstance(bs, dict):
            v = bs.get("value") or {}
            if isinstance(v, dict) and (v.get("minValue") or v.get("maxValue")):
                sal = f"${v.get('minValue', '')} – ${v.get('maxValue', '')} {v.get('unitText', '')}".strip()
        return {
            "title": strip_html(jp.get("title", "")),
            "company": org.get("name", "") if isinstance(org, dict) else str(org),
            "location": where or ("Remote" if remote else ""),
            "remote": remote,
            "posted": to_iso(jp.get("datePosted")),
            "description": strip_html(jp.get("description", "")),
            "salary": sal,
        }
    # fallback: page title + visible text
    title = strip_html((re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I) or [None, ""])[1])
    body = re.sub(r"(?is)<(script|style|noscript|svg|header|footer|nav)[^>]*>.*?</\1>", " ", html)
    text = strip_html(body)
    return {"title": title.split("|")[0].split(" - ")[0].strip()[:120], "description": text[:8000] if len(text) > 400 else ""}
