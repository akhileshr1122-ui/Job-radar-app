"""Print what the hosted Job Radar pulled: shared pool by source, and each person's matches. Used by the 'Azure status' workflow."""
import collections
import json
import os
import sys

from azure.storage.blob import BlobServiceClient

box = BlobServiceClient.from_connection_string(os.environ["STORAGE_CONNECTION"]).get_container_client("jobradar")


def get(name):
    try:
        return json.loads(box.download_blob(name).readall())
    except Exception:
        return None


def note(msg):
    print(f"::notice::{msg}")
    with open(os.environ.get("GITHUB_STEP_SUMMARY", os.devnull), "a") as fh:
        fh.write(msg + "\n\n")


pool = get("shared/pool.json") or {"jobs": [], "report": {}}
jobs = pool.get("jobs", [])
by_src = collections.Counter(j.get("source") for j in jobs)
countries = collections.Counter("Remote" if j.get("remote") else (j.get("location") or "?").split(",")[-1].strip()[:20] for j in jobs)
note(f"POOL updated {pool.get('updated')}: {len(jobs)} postings for {pool.get('report', {}).get('people', '?')} people")
note("POOL by source: " + ", ".join(f"{k} {v}" for k, v in by_src.most_common()))
rep = {k: v for k, v in pool.get("report", {}).items() if not isinstance(v, (list, dict))}
note("POOL source notes: " + "; ".join(f"{k}={v}" for k, v in rep.items())[:1500])
note("POOL top places: " + ", ".join(f"{k} {v}" for k, v in countries.most_common(10)))
titles = collections.Counter(j.get("title", "").lower()[:40] for j in jobs)
note("POOL sample titles: " + "; ".join(t for t, _ in titles.most_common(25)))

for item in box.walk_blobs(name_starts_with="users/", delimiter="/"):
    uid = item.name.split("/")[1]
    acct = get(f"users/{uid}/account.json") or {}
    jf = get(f"users/{uid}/data/jobs.json") or {}
    r = get(f"users/{uid}/data/report.json") or {}
    st = get(f"users/{uid}/data/run_status.json") or {}
    cfg = get(f"users/{uid}/profile/search.json") or {}
    note(f"USER {acct.get('name', uid)}: {jf.get('count', 0)} jobs listed, {jf.get('new_this_run', 0)} new; last run {st.get('state')} ok={st.get('ok')} {st.get('finished', '')} "
         f"{st.get('note', '')}; checked {r.get('raw')} passed {r.get('passed')} tailored {r.get('tailored_this_run')}; queries {cfg.get('queries', [])[:6]}; "
         f"companies {len(cfg.get('ats_companies', {}).get('candidates', []))}")
    try:
        log = box.download_blob(f"users/{uid}/data/last_run.log").readall().decode()[-600:].replace("\n", " | ")
        note(f"LOG {acct.get('name', uid)}: {log}")
    except Exception:
        pass
sys.exit(0)


# ---------------------------------------------------------------- why jobs are (not) kept, per person
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "engine"))
import sources as S  # noqa: E402
import score as SC  # noqa: E402
from tailor import all_skills  # noqa: E402
from util import classify_location, geocode, load_geocache  # noqa: E402

load_geocache(get("shared/geocache.json") or {})
for item in box.walk_blobs(name_starts_with="users/", delimiter="/"):
    uid = item.name.split("/")[1]
    cfg, resume = get(f"users/{uid}/profile/search.json"), get(f"users/{uid}/profile/resume.json")
    if not cfg or not resume or not resume.get("experience"):
        continue
    locs = cfg.setdefault("locations", {})
    if not locs.get("search_locations") and resume.get("contact", {}).get("location"):
        locs["search_locations"] = [{"place": resume["contact"]["location"], "radius_km": 50}]
    cfg["_ex_amazon"] = any("amazon" in (e.get("company") or "").lower() for e in resume.get("experience", []))
    if not cfg.get("title_terms", {}).get("required") or not cfg.get("title_terms", {}).get("weighted"):
        w = S.query_words(cfg, 12)
        cfg["_auto_required"] = list(dict.fromkeys(w + [x.replace("-", "") for x in w if "-" in x]))
    if not cfg.get("description_keywords"):
        cfg["description_keywords"] = {s.lower().split(" (")[0]: 2 for s in all_skills(resume) if len(s) < 40}
    cfg["_place_points"] = [(p, ll, S.radius_km(cfg, p)) for p in S.places(cfg) for ll in [geocode(p)] if ll]
    req = cfg["title_terms"].get("required") or cfg.get("_auto_required", [])
    tally = collections.Counter()
    near_miss = collections.Counter()
    kept_src = collections.Counter()
    for j in jobs:
        j = dict(j)
        t = (j.get("title") or "").lower()
        if any(SC._has(t, x) for x in cfg.get("exclude_title", [])):
            tally["title excluded"] += 1
            continue
        if req and not any(SC._has(t, x) for x in req):
            tally["title has none of the required words"] += 1
            continue
        res = SC.score(j, cfg)
        if not res:
            c, r = classify_location(j.get("location", ""), j.get("remote"), j.get("description", ""))
            tally[f"dropped after title match (country {c}, remote {r})"] += 1
            continue
        if res[0] < cfg["min_score_to_save"]:
            tally["scored below the keep score"] += 1
            near_miss[res[0] // 10 * 10] += 1
            continue
        tally["kept"] += 1
        kept_src[j.get("source")] += 1
    acct = get(f"users/{uid}/account.json") or {}
    note(f"WHY {acct.get('name', uid)}: required={req[:12]} places={[p for p, _, _ in cfg['_place_points']]} mode={locs.get('mode')} "
         f"country={locs.get('country')} min={cfg['min_score_to_save']} | " + "; ".join(f"{k}: {v}" for k, v in tally.most_common())
         + f" | low scores by band {dict(sorted(near_miss.items()))} | kept by source {dict(kept_src)}")
