"""Hosted Job Radar (Azure): one bulk search for everybody, then each person's matches, resumes and requests.

  python engine/azure_run.py bulk    # timer (every few hours): fetch all sources once, then run every person
  python engine/azure_run.py queue   # on demand: people who uploaded a resume, added a job, asked for prep, pressed Run…

Storage layout (one blob container):
  config/allow.json                     invite list (managed in the app by the admin)
  shared/pool.json                      every posting from the last bulk search
  shared/ats_cache.json, geocache.json  caches shared by everybody
  users/<id>/profile/…, user/…, data/…, requests/…, uploads/…   same layout as a GitHub Job Radar repo
  users/<id>/secrets.json               that person's own Claude token / API key (never sent to the browser)
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from azure.core.exceptions import HttpResponseError, ResourceExistsError, ResourceNotFoundError  # noqa: E402
from azure.storage.blob import BlobServiceClient  # noqa: E402
from azure.storage.queue import QueueClient  # noqa: E402

import sources  # noqa: E402
from util import geocache, load_geocache  # noqa: E402

CONN = os.environ["STORAGE_CONNECTION"]
CONTAINER = os.environ.get("STORAGE_CONTAINER", "jobradar")
QUEUE = os.environ.get("RUN_QUEUE", "jobradar-runs")
USER_TIMEOUT = int(os.environ.get("USER_TIMEOUT_S", "1800"))
SKIP_DOWN = (".pdf", ".docx")  # rendered files are only uploaded, never needed by the engine
PRIVATE = {"secrets.json", "account.json"}

blob_svc = BlobServiceClient.from_connection_string(CONN)
box = blob_svc.get_container_client(CONTAINER)


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def log(*a):
    print(f"[{datetime.now().strftime('%H:%M:%S')}]", *a, flush=True)


# ------------------------------------------------------------------ storage helpers

def get_json(name, default=None):
    try:
        return json.loads(box.download_blob(name).readall())
    except (ResourceNotFoundError, ValueError):
        return default


def put_json(name, obj):
    box.upload_blob(name, json.dumps(obj, ensure_ascii=False).encode(), overwrite=True)


def users():
    out = []
    for item in box.walk_blobs(name_starts_with="users/", delimiter="/"):
        uid = item.name.split("/")[1]
        if uid:
            out.append(uid)
    return out


def set_status(uid, **kw):
    cur = get_json(f"users/{uid}/data/run_status.json", {}) or {}
    cur.update(kw)
    put_json(f"users/{uid}/data/run_status.json", cur)


class Lock:
    """One run per person at a time (the bulk timer and an on-demand run could overlap)."""

    def __init__(self, uid):
        self.blob = box.get_blob_client(f"locks/{uid}")
        self.lease = None
        self.stop = threading.Event()

    def __enter__(self):
        try:
            self.blob.upload_blob(b"", overwrite=False)
        except ResourceExistsError:
            pass
        try:
            self.lease = self.blob.acquire_lease(lease_duration=60)
        except HttpResponseError:
            return None
        threading.Thread(target=self._renew, daemon=True).start()
        return self

    def _renew(self):
        while not self.stop.wait(40):
            try:
                self.lease.renew()
            except Exception:
                return

    def __exit__(self, *exc):
        self.stop.set()
        try:
            self.lease.release()
        except Exception:
            pass


# ------------------------------------------------------------------ one person's folder

def download_user(uid, root):
    prefix = f"users/{uid}/"
    names = []
    for b in box.list_blobs(name_starts_with=prefix):
        rel = b.name[len(prefix):]
        if not rel or rel in PRIVATE or (rel.startswith("data/") and rel.endswith(SKIP_DOWN)):
            continue
        dest = os.path.join(root, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as fh:
            fh.write(box.download_blob(b.name).readall())
        names.append(rel)
    return names


def upload_user(uid, root, downloaded, since):
    prefix = f"users/{uid}/"
    up = 0
    for dirpath, _, files in os.walk(root):
        for fn in files:
            path = os.path.join(dirpath, fn)
            rel = os.path.relpath(path, root).replace(os.sep, "/")
            if rel in PRIVATE or fn.endswith(".tmp") or rel in ("data/run_status.json", "data/geocache.json", "data/ats_cache.json"):
                continue
            if os.path.getmtime(path) >= since or rel not in downloaded:
                with open(path, "rb") as fh:
                    box.upload_blob(prefix + rel, fh, overwrite=True)
                up += 1
    gone = [rel for rel in downloaded if not os.path.exists(os.path.join(root, rel))]
    for rel in gone:  # handled requests, the uploaded resume file, resumes of jobs no longer listed
        try:
            box.delete_blob(prefix + rel)
        except ResourceNotFoundError:
            pass
    # PDFs / Word files of jobs that are no longer listed
    jobs = json.load(open(os.path.join(root, "data", "jobs.json"), encoding="utf-8")) if os.path.exists(os.path.join(root, "data", "jobs.json")) else {"jobs": []}
    live = {j["id"] for j in jobs.get("jobs", [])} | {"base"}
    for sub in ("data/resumes/", "data/prep/"):
        for b in box.list_blobs(name_starts_with=prefix + sub):
            stem = b.name.rsplit("/", 1)[-1].split(".")[0]
            if stem not in live:
                box.delete_blob(b.name)
    return up, len(gone)


# What each plan allows per person. Shown on the site in web/plans.js; keep the two in step.
PLAN_LIMITS = {
    "free": {"max_tailor_per_run": 10, "max_ai_per_day": 10, "shared_ai": False},
    "plus": {"max_tailor_per_run": 25, "max_ai_per_day": 15, "shared_ai": True},
    "pro": {"max_tailor_per_run": 40, "max_ai_per_day": 40, "shared_ai": True},
}


def plan_of(uid):
    acct = get_json(f"users/{uid}/account.json", {}) or {}
    who = (acct.get("name") or "").strip().lower()
    admins = [a.strip().lower() for a in os.environ.get("ADMIN_USERS", "").replace(";", ",").split(",") if a.strip()]
    if who and who in admins:
        return "pro"
    for x in (get_json("config/allow.json", {}) or {}).get("people", []):
        if (x.get("id") or "").strip().lower() == who:
            return x.get("plan") or "free"
    return "free"


def user_env(uid):
    sec = get_json(f"users/{uid}/secrets.json", {}) or {}
    env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "STORAGE_CONNECTION", "SHARED_ANTHROPIC_API_KEY")}
    plan = plan_of(uid)
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    env["JR_LIMITS"] = json.dumps({k: v for k, v in limits.items() if k.startswith("max_")})
    env["JR_PLAN"] = plan
    if sec.get("anthropic_key"):
        env["ANTHROPIC_API_KEY"] = sec["anthropic_key"]
    if sec.get("claude_token"):
        env["CLAUDE_CODE_OAUTH_TOKEN"] = sec["claude_token"]
        ensure_claude_cli(env)
    elif not sec.get("anthropic_key") and limits["shared_ai"] and os.environ.get("SHARED_ANTHROPIC_API_KEY"):
        env["ANTHROPIC_API_KEY"] = os.environ["SHARED_ANTHROPIC_API_KEY"]  # AI included in the plan
        env["JR_MODEL"] = os.environ.get("SHARED_AI_MODEL") or "claude-haiku-4-5-20251001"  # cheaper model on your key
    return env


_cli_lock = threading.Lock()


def ensure_claude_cli(env):
    """Claude Code (for people who use their Pro/Max plan). Installed once per container, only when needed."""
    local_bin = os.path.expanduser("~/.local/bin")
    env["PATH"] = local_bin + os.pathsep + env.get("PATH", "")
    with _cli_lock:
        if shutil.which("claude", path=env["PATH"]):
            return
        log("installing Claude Code")
        subprocess.run("curl -fsSL https://claude.ai/install.sh | bash", shell=True, check=False, timeout=600)


def run_user(uid, pool_path, kind, extra_args=()):
    """Download → run the engine for this person → upload. Returns True if it ran."""
    with Lock(uid) as lk:
        if lk is None:
            log(f"{uid}: busy, skipped")
            return False
        for attempt in range(3):  # pick up requests that arrived while running
            root = tempfile.mkdtemp(prefix="jr-")
            try:
                downloaded = download_user(uid, root)
                has_requests = any(n.startswith("requests/") for n in downloaded)
                if kind == "quick" and attempt > 0 and not has_requests:
                    break
                os.makedirs(os.path.join(root, "data"), exist_ok=True)
                with open(os.path.join(root, "data", "geocache.json"), "w", encoding="utf-8") as fh:
                    json.dump(geocache(), fh)
                set_status(uid, state="running", kind=kind, started=now())
                since = time.time()
                args = [sys.executable, os.path.join(HERE, "run.py"), "--root", root, "--pool", pool_path, *extra_args]
                p = subprocess.run(args, env=user_env(uid), capture_output=True, text=True, timeout=USER_TIMEOUT)
                out = (p.stdout or "") + (p.stderr or "")
                with open(os.path.join(root, "data", "last_run.log"), "w", encoding="utf-8") as fh:
                    fh.write(out[-20000:])
                load_geocache(json.load(open(os.path.join(root, "data", "geocache.json"), encoding="utf-8")))
                up, gone = upload_user(uid, root, set(downloaded), since)
                ok = p.returncode == 0
                set_status(uid, state="finished", ok=ok, finished=now(), kind=kind,
                           note="" if ok else (out.strip().splitlines() or ["failed"])[-1][:300])
                log(f"{uid}: {'ok' if ok else 'FAILED'} ({kind}), {up} files up, {gone} removed")
                if not ok:
                    log(out[-3000:])
            except subprocess.TimeoutExpired:
                set_status(uid, state="finished", ok=False, finished=now(), note="took too long")
                log(f"{uid}: timed out")
            finally:
                shutil.rmtree(root, ignore_errors=True)
            if kind != "quick":
                break
            if not any(b.name for b in box.list_blobs(name_starts_with=f"users/{uid}/requests/")):
                break
        return True


# ------------------------------------------------------------------ bulk search

def prepared_cfg(uid, template):
    """A person's search settings with the same automatic fill-ins run.py uses."""
    cfg = get_json(f"users/{uid}/profile/search.json") or json.loads(json.dumps(template))
    resume = get_json(f"users/{uid}/profile/resume.json") or {}
    if not resume.get("experience"):
        return None
    locs = cfg.setdefault("locations", {})
    if not locs.get("search_locations") and resume.get("contact", {}).get("location"):
        locs["search_locations"] = [{"place": resume["contact"]["location"], "radius_km": 50}]
    cfg["_ex_amazon"] = any("amazon" in (e.get("company") or "").lower() for e in resume.get("experience", []))
    cfg.setdefault("title_terms", {}).setdefault("required", [])
    if not cfg["title_terms"]["required"]:
        words = sources.query_words(cfg, 12)
        cfg["title_terms"]["required"] = list(dict.fromkeys(words + [w.replace("-", "") for w in words if "-" in w]))
    return cfg


def union_cfg(cfgs, template):
    """Settings for the shared sources: everybody's company boards, Workday sites and title words."""
    u = json.loads(json.dumps(template))
    u["queries"] = list(dict.fromkeys(q for c in cfgs for q in c.get("queries", [])))
    u["title_terms"]["required"] = list(dict.fromkeys(t for c in cfgs for t in c["title_terms"]["required"]))
    try:
        extra = json.load(open(os.path.join(HERE, "..", "profile", "companies_default.json"), encoding="utf-8"))
    except (OSError, ValueError):
        extra = {}
    u.setdefault("ats_companies", {})["candidates"] = list(dict.fromkeys(
        list(template.get("ats_companies", {}).get("candidates", [])) + extra.get("ats_candidates", []) +
        [s for c in cfgs for s in c.get("ats_companies", {}).get("candidates", [])]))
    u.setdefault("workday_sites", {})["urls"] = list(dict.fromkeys(
        extra.get("workday_urls", []) + [x for c in cfgs for x in c.get("workday_sites", {}).get("urls", [])]))
    u["sources"] = {name: any(sources.source_on(c, name) for c in cfgs)
                    for name in ["company_boards"] + [f.__name__ for f in sources.SHARED_SOURCES]}
    return u


def signature(cfg):
    keys = ("queries", "locations", "sources", "max_age_days")
    return json.dumps({k: cfg.get(k) for k in keys}, sort_keys=True)


def bulk():
    template = json.load(open(os.path.join(HERE, "..", "profile", "search.json"), encoding="utf-8"))
    people = {}
    for uid in users():
        cfg = prepared_cfg(uid, template)
        if cfg:
            people[uid] = cfg
    log(f"bulk search for {len(people)} people")
    load_geocache(get_json("shared/geocache.json", {}) or {})
    cache = get_json("shared/ats_cache.json", {}) or {}
    jstate = get_json("shared/jsearch_state.json", {}) or {}
    pool, report = [], {"people": len(people), "searched": now()}

    if people:
        shared, rep = sources.fetch_shared(union_cfg(list(people.values()), template), cache)
        pool += shared
        report.update(rep)
        log(f"shared sources: {len(shared)} postings")

        groups = {}
        for uid, cfg in people.items():
            groups.setdefault(signature(cfg), (uid, cfg))
        per_day = max(1, 6 // max(1, len(groups)))  # one free JSearch plan shared by everybody

        def one(item):
            uid, cfg = item
            cfg["jsearch_per_day"] = min(cfg.get("jsearch_per_day", 6), per_day)
            st = jstate.setdefault(uid, {})
            try:
                return sources.fetch_user(cfg, st)
            except Exception as e:
                return [], {"error": repr(e)[:200]}

        with ThreadPoolExecutor(max_workers=3) as ex:
            for jobs, rep in ex.map(one, groups.values()):
                pool += jobs
                for k, v in rep.items():
                    report[k] = report[k] + v if isinstance(v, int) and isinstance(report.get(k), int) else v
        log(f"after personal searches: {len(pool)} postings from {len(groups)} different searches")

    seen, uniq = set(), []
    for j in pool:
        k = (j.get("source"), j.get("source_id") or j.get("url"))
        if k not in seen:
            seen.add(k)
            uniq.append(j)
    payload = {"updated": now(), "report": report, "jobs": uniq}
    pool_path = os.path.join(tempfile.gettempdir(), "pool.json")
    with open(pool_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
    box.upload_blob("shared/pool.json", open(pool_path, "rb"), overwrite=True)
    # public numbers for the homepage (counts only, no postings)
    by = {}
    for j in uniq:
        by[j.get("source") or "?"] = by.get(j.get("source") or "?", 0) + 1
    remote = {"weworkremotely", "remoteok", "himalayas", "jobicy", "remotive", "workingnomads"}
    career = {"greenhouse", "lever", "ashby", "workable", "smartrecruiters"}
    brands = {"amazon.jobs", "workday"}
    groups = {"remote": sum(v for k, v in by.items() if k in remote), "career": sum(v for k, v in by.items() if k in career),
              "brands": sum(v for k, v in by.items() if k in brands)}
    groups["boards"] = len(uniq) - sum(groups.values())
    put_json("shared/stats.json", {"updated": now(), "postings": len(uniq), "sources": len([k for k, v in by.items() if v]),
                                   "companies": len({(j.get("company") or "").strip().lower() for j in uniq if j.get("company")}), "groups": groups})
    put_json("shared/ats_cache.json", cache)
    put_json("shared/jsearch_state.json", jstate)
    log(f"pool saved: {len(uniq)} postings")

    everyone = users()  # includes people who haven't uploaded a resume yet (they get the 'upload' note)
    for uid in everyone:
        run_user(uid, pool_path, "search")
    put_json("shared/geocache.json", geocache())
    log("bulk done")


# ------------------------------------------------------------------ on-demand runs

def latest_pool():
    path = os.path.join(tempfile.gettempdir(), "pool.json")
    try:
        with open(path, "wb") as fh:
            fh.write(box.download_blob("shared/pool.json").readall())
    except ResourceNotFoundError:
        with open(path, "w") as fh:
            json.dump({"jobs": [], "report": {"note": "first full search hasn't run yet"}}, fh)
    return path


def queue():
    q = QueueClient.from_connection_string(CONN, QUEUE)
    load_geocache(get_json("shared/geocache.json", {}) or {})
    pool_path = None
    idle = 0
    while idle < 2:
        msgs = list(q.receive_messages(messages_per_page=32, visibility_timeout=1800, max_messages=32))
        if not msgs:
            idle += 1
            time.sleep(10)
            continue
        idle = 0
        pool_path = pool_path or latest_pool()
        todo = {}
        for m in msgs:
            try:
                body = json.loads(m.content)
            except ValueError:
                body = {}
            uid = body.get("uid")
            if uid:
                t = todo.setdefault(uid, {"search": False, "msgs": []})
                t["search"] |= bool(body.get("search"))
                t["msgs"].append(m)
            else:
                q.delete_message(m)
        for uid, t in todo.items():
            args = ["--user-fetch"] + ([] if t["search"] else ["--requests-only"])
            log(f"{uid}: {'search' if t['search'] else 'quick'} run")
            ran = run_user(uid, pool_path, "search" if t["search"] else "quick", args)
            for m in t["msgs"]:
                if ran:
                    q.delete_message(m)
                else:
                    q.update_message(m, visibility_timeout=120)  # busy: try again in 2 minutes
    put_json("shared/geocache.json", geocache())
    log("queue empty")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "bulk"
    {"bulk": bulk, "queue": queue}[mode]()
