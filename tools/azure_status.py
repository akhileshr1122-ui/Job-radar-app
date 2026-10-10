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
