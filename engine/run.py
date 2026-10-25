"""Job Radar search run.

  fetch -> filter/score -> dedupe -> merge with history -> handle app requests -> tailor -> write data/

Usage:
  python engine/run.py                 # full run (what GitHub Actions does)
  python engine/run.py --fixtures F    # offline test using a JSON list of jobs
  python engine/run.py --no-claude     # skip the Anthropic API even if a key exists
  python engine/run.py --requests-only # only handle app requests (add job / interview prep), no board search
  python engine/run.py --root DIR --pool pool.json [--user-fetch]
                                       # hosted (Azure) mode: one person's folder, jobs from the shared bulk pool
"""
import argparse
import glob
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))

# Keys pasted into GitHub/Azure often carry stray newlines or spaces (even mid-token when a terminal wraps it); clean them once.
for _k in ("RAPIDAPI_KEY", "ADZUNA_APP_ID", "ADZUNA_APP_KEY", "JOOBLE_KEY", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"):
    if _k in os.environ:
        os.environ[_k] = "".join(os.environ[_k].split())  # keys never contain spaces; terminals wrap long tokens

import pagefetch  # noqa: E402
import render  # noqa: E402
import sources  # noqa: E402
from score import score  # noqa: E402
import importer  # noqa: E402
import related  # noqa: E402
import tailor as tailor_mod  # noqa: E402
from tailor import ai_available, all_skills, interview_prep, keyword_tailor, tailor  # noqa: E402
from util import classify_location, geocache, geocode, job_id, load_geocache, norm, now_iso, safe_url  # noqa: E402

ROOT = DATA = RES_DIR = PREP_DIR = REQ_DIR = ""


def set_root(root):
    """Everything for one person lives under one folder: profile/, user/, data/, requests/, uploads/."""
    global ROOT, DATA, RES_DIR, PREP_DIR, REQ_DIR
    ROOT = os.path.abspath(root)
    DATA = os.path.join(ROOT, "data")
    RES_DIR = os.path.join(DATA, "resumes")
    PREP_DIR = os.path.join(DATA, "prep")
    REQ_DIR = os.path.join(ROOT, "requests")


set_root(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TRACKED = {"saved", "applied", "interview", "offer", "rejected"}

LEGAL = r"\b(inc|ltd|llc|ulc|corp|corporation|co|company|limited|lp|gmbh|plc|canada|usa|us|com|ca)\b"


def load(path, default):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (FileNotFoundError, ValueError):
        return default


def save(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def canon_company(name):
    n = norm(name)
    if "amazon" in n.split():
        return "amazon"
    n = re.sub(LEGAL, " ", n)
    return re.sub(r"\s+", " ", n).strip() or norm(name)


def dedupe_key(j):
    title = re.sub(r"\s+", " ", norm(j["title"]))[:60]
    return f"{canon_company(j['company'])}|{title}"


def file_hash(path):
    try:
        return hashlib.sha1(open(path, "rb").read()).hexdigest()[:12]
    except FileNotFoundError:
        return ""


def merge_into(best, j):
    k = dedupe_key(j)
    cur = best.get(k)
    if cur is None:
        j.setdefault("also_on", [])
        best[k] = j
        return
    better = (sources.SOURCE_RANK.get(j["source"], 5), -len(j["description"])) < \
             (sources.SOURCE_RANK.get(cur["source"], 5), -len(cur["description"]))
    winner, loser = (j, cur) if better else (cur, j)
    winner["also_on"] = [s for s in dict.fromkeys(cur.get("also_on", []) + j.get("also_on", []) + [loser["source"]]) if s != winner["source"]]
    if not winner.get("salary") and loser.get("salary"):
        winner["salary"] = loser["salary"]
    if len(loser["description"]) > len(winner["description"]):
        winner["description"] = loser["description"]
    winner["score"] = max(winner["score"], loser["score"])
    best[k] = winner


def handle_add_requests(reqs, cfg):
    """Jobs the user shared into the app. Always kept, always tailored."""
    out = []
    for req in reqs:
        url = safe_url(req.get("url"))
        page = pagefetch.fetch(url) if url else {}
        j = {
            "title": req.get("title") or page.get("title") or "Job you added",
            "company": req.get("company") or page.get("company") or "",
            "location": req.get("location") or page.get("location") or "",
            "remote": page.get("remote", False), "url": url, "apply_url": url, "source": "added by you",
            "posted": page.get("posted", ""), "salary": page.get("salary", ""),
            "description": (req.get("description") or "").strip() or page.get("description", ""),
        }
        res = score(dict(j), cfg)
        country, remote = classify_location(j["location"], j["remote"], j["description"])
        j.update(country=country, remote=remote, manual=True, also_on=[],
                 score=res[0] if res else 50, reasons=(res[1] if res else ["Added by you"]),
                 matched=res[2] if res else [])
        if not j["description"]:
            j["reasons"] = j["reasons"] + ["Couldn't read the posting – paste the description in the app for a better resume"]
        out.append(j)
        print(f"added by request: {j['title']} @ {j['company']} ({len(j['description'])} chars)")
    return out


PID = re.compile(r"^[a-z0-9-]{1,24}$")


def profile_dir(pid):
    """Main profile: profile/. Extra profiles (another resume, a career switch): profiles/<id>/."""
    return os.path.join(ROOT, "profile") if pid in (None, "", "main") else os.path.join(ROOT, "profiles", pid)


def profile_index():
    idx = load(os.path.join(ROOT, "profiles", "index.json"), {}) or {}
    return [p for p in idx.get("profiles", []) if isinstance(p, dict) and PID.match(str(p.get("id", ""))) and p["id"] != "main"], idx.get("main_name") or ""


def base_name(pid):
    return "base" if pid in (None, "", "main") else f"base-{pid}"


def prepare_cfg(c, r):
    """Settings that adapt to any profile (filled in at search time, never saved)."""
    locs = c.setdefault("locations", {})
    if not locs.get("search_locations") and r.get("contact", {}).get("location"):
        locs["search_locations"] = [{"place": r["contact"]["location"], "radius_km": 50}]
    c["_ex_amazon"] = any("amazon" in (e.get("company") or "").lower() for e in r.get("experience", []))
    if not c.get("title_terms", {}).get("required") or not c.get("title_terms", {}).get("weighted"):
        words = sources.query_words(c, 12)
        c["_auto_required"] = list(dict.fromkeys(words + [w.replace("-", "") for w in words if "-" in w]))
    if not c.get("description_keywords"):
        c["description_keywords"] = {s.lower().split(" (")[0]: 2 for s in all_skills(r) if len(s) < 40}
        for k in (c.get("related_added") or {}).get("keywords", []):
            c["description_keywords"].setdefault(k, 1)
    c["_place_points"] = [(p, ll, sources.radius_km(c, p)) for p in sources.places(c) for ll in [geocode(p)] if ll]
    return c


def best_score(job, profs):
    """Score a posting against every profile; the best one wins. Returns (result, profile id) or (None, None)."""
    best, who = None, None
    for p in profs:
        res = score(dict(job), p["cfg"])
        if res and res[0] >= p["cfg"]["min_score_to_save"] and (best is None or res[0] > best[0]):
            best, who = res, p["id"]
    return best, who


def base_job(resume):
    """A neutral 'job' for the standard resume: the person's own headline and top skills."""
    title = (resume.get("headlines") or {}).get("main") or (resume.get("experience") or [{}])[0].get("title", "")
    return {"title": title, "company": "", "description": " ".join(all_skills(resume)[:25])}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures")
    ap.add_argument("--no-claude", action="store_true")
    ap.add_argument("--requests-only", action="store_true")
    ap.add_argument("--root", help="this person's folder (default: the repo)")
    ap.add_argument("--pool", help="shared bulk-fetched postings (JSON: {jobs, report}) used instead of searching")
    ap.add_argument("--user-fetch", action="store_true", help="with --pool: also run this person's own query searches")
    args = ap.parse_args(argv)
    if args.root:
        set_root(args.root)

    cfg = load(os.path.join(ROOT, "profile", "search.json"), None)
    limits = json.loads(os.environ.get("JR_LIMITS") or "{}")  # hosted plans cap these per person
    if cfg is None:  # brand-new person: start from the generic settings that ship with Job Radar
        cfg = load(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "profile", "search.json"), {})
        cfg.setdefault("_setup", True)
        save(os.path.join(ROOT, "profile", "search.json"), cfg)
    # a search phrase is a job title, not a sentence (older resume imports sometimes picked up a bullet)
    cfg["queries"] = [q for q in cfg.get("queries", []) if isinstance(q, str) and 0 < len(q.strip()) <= 60 and not q.rstrip().endswith(".")]
    req_files = sorted(glob.glob(os.path.join(REQ_DIR, "*.json")))
    reqs = [dict(load(f, {}), _file=f) for f in req_files]

    # ---- resume upload from the app: rebuild profile/resume.json (and first-time search settings)
    import_note = None
    for r in [r for r in reqs if r.get("type") == "import_resume"]:
        path = os.path.join(ROOT, r.get("path", ""))
        pid = r.get("profile") if PID.match(str(r.get("profile") or "")) else "main"
        pdir = profile_dir(pid)
        try:
            data = importer.import_resume(path, cfg)
            old = load(os.path.join(pdir, "resume.json"), {}) or load(os.path.join(ROOT, "profile", "resume.json"), {})
            if old.get("application_answers"):
                data["application_answers"] = {**data.get("application_answers", {}), **{k: v for k, v in old["application_answers"].items() if v}}
            os.makedirs(pdir, exist_ok=True)
            save(os.path.join(pdir, "resume.json"), data)
            if pid != "main":
                pcfg = load(os.path.join(pdir, "search.json"), None)
                if pcfg is None or r.get("reset_search"):  # a new profile starts from the main settings, aimed at this resume
                    pcfg = importer.setup_search(json.loads(json.dumps(cfg)), data)
                    save(os.path.join(pdir, "search.json"), pcfg)
            elif cfg.get("_setup") or r.get("reset_search"):
                cfg = importer.setup_search(cfg, data)
                save(os.path.join(ROOT, "profile", "search.json"), cfg)
            import_note = f"Imported {os.path.basename(path)} ({data['_imported']['method']})"
            print(import_note)
            args.requests_only = False  # a new resume means a new search, right away
        except Exception as e:
            import_note = f"Import failed: {e}"
            print(import_note)
        try:
            os.remove(path)  # the uploaded file isn't kept
        except OSError:
            pass

    resume = load(os.path.join(ROOT, "profile", "resume.json"), None)
    profile_hash = file_hash(os.path.join(ROOT, "profile", "resume.json"))
    if not resume or not resume.get("experience"):
        imp = (resume or {}).get("_imported") or {}
        if (import_note or "").startswith("Import failed"):
            note = import_note
        elif imp:
            note = (f"We read {imp.get('file') or 'your resume'} but couldn't find your work history in it (job titles with dates). "
                    "Try uploading the PDF version, and check that each job shows its title and dates, like 'Jan 2021 – Present'.")
        else:
            note = "Upload your resume in the app to start."
        save(os.path.join(DATA, "jobs.json"), {"updated": now_iso(), "count": 0, "new_this_run": 0, "setup_needed": True,
                                               "note": note, "jobs": []})
        for r in reqs:
            try:
                os.remove(r["_file"])
            except OSError:
                pass
        print("no resume yet – nothing to search")
        return

    if not cfg.get("_related_v"):  # once: add related job titles and keywords to an existing search
        related.widen(cfg, resume)
        save(os.path.join(ROOT, "profile", "search.json"), cfg)
        print(f"related titles added: {cfg['related_added']['titles']}")

    index, main_name = profile_index()
    profs = [{"id": "main", "name": main_name or "Main profile", "cfg": cfg, "resume": resume}]
    for e in index:
        pdir = profile_dir(e["id"])
        r = load(os.path.join(pdir, "resume.json"), None)
        if not r or not r.get("experience"):
            continue
        c = load(os.path.join(pdir, "search.json"), None)
        if c is None:
            c = importer.setup_search(json.loads(json.dumps(cfg)), r)
            save(os.path.join(pdir, "search.json"), c)
        elif not c.get("_related_v"):
            related.widen(c, None if c.get("queries") else r)  # a career switch widens around its chosen titles, not past jobs
            save(os.path.join(pdir, "search.json"), c)
        c["queries"] = [q for q in c.get("queries", []) if isinstance(q, str) and 0 < len(q.strip()) <= 60 and not q.rstrip().endswith(".")]
        profs.append({"id": e["id"], "name": str(e.get("name") or "Profile")[:40], "cfg": c, "resume": r})
    profs = profs[: max(1, int(limits.get("max_profiles", cfg.get("max_profiles", 5))))]
    for p in profs:
        for k, v in limits.items():
            p["cfg"][k] = min(p["cfg"].get(k, v), v)
        if os.environ.get("JR_MODEL"):
            p["cfg"]["claude_model"] = os.environ["JR_MODEL"]
        p["hash"] = file_hash(os.path.join(profile_dir(p["id"]), "resume.json"))
    by_pid = {p["id"]: p for p in profs}
    pof = lambda j: by_pid.get(j.get("profile") or "main") or by_pid["main"]  # noqa: E731
    if len(profs) > 1:
        print("profiles: " + ", ".join(f"{p['name']} ({len(p['cfg'].get('queries', []))} titles)" for p in profs))

    # ---- data brought over from a GitHub Job Radar (hosted mode): jobs list + tailored resumes, rendered here
    imp_dir = os.path.join(DATA, "imported")
    if any(r.get("type") == "import_github" for r in reqs) and os.path.isdir(imp_dir):
        n = 0
        os.makedirs(RES_DIR, exist_ok=True)
        for fn in sorted(os.listdir(imp_dir)):
            src = os.path.join(imp_dir, fn)
            if fn == "jobs.json":
                os.replace(src, os.path.join(DATA, "jobs.json"))
                continue
            t = load(src, None)
            os.remove(src)
            if not isinstance(t, dict):
                continue
            stem = os.path.join(RES_DIR, fn[:-5])
            try:
                render.to_pdf(t, resume, stem + ".pdf")
                render.to_docx(t, resume, stem + ".docx")
                save(stem + ".json", t)
                n += 1
            except Exception as e:
                print(f"  imported resume {fn} failed: {e!r}")
        print(f"brought over {n} tailored resumes from GitHub")

    # ---- settings that adapt to any profile
    load_geocache(load(os.path.join(DATA, "geocache.json"), {}))
    for p in profs:
        prepare_cfg(p["cfg"], p["resume"])
    cache = load(os.path.join(DATA, "ats_cache.json"), {})
    run_state = load(os.path.join(DATA, "run_state.json"), {})
    user_state = load(os.path.join(ROOT, "user", "state.json"), {}).get("statuses", {})
    status_of = {k: (v.get("status") if isinstance(v, dict) else v) for k, v in user_state.items()}
    prev = load(os.path.join(DATA, "jobs.json"), {"jobs": []})
    existing = {j["id"]: j for j in prev["jobs"]}
    started = now_iso()
    now = datetime.now(timezone.utc)

    # ---- requests from the app
    add_reqs = [r for r in reqs if r.get("type") == "add_job"]
    prep_reqs = [r for r in reqs if r.get("type") == "prep"]
    retailor_ids = {r.get("job_id") for r in reqs if r.get("type") == "retailor"}

    # ---- board search
    report = {}
    raw = []
    if args.fixtures:
        raw, report = load(args.fixtures, []), {"fixtures": "used"}
    elif args.pool and not args.requests_only:
        pool = load(args.pool, {"jobs": []})
        raw, report = [dict(j) for j in pool.get("jobs", [])], dict(pool.get("report", {}))
        if args.user_fetch:
            for p in profs:
                mine, my_report = sources.fetch_user(p["cfg"], run_state)
                raw += mine
                report.update(my_report)
    elif not args.requests_only:
        raw, report = sources.fetch_all(cfg, cache, run_state)
        for p in profs[1:]:  # the other profiles' own search phrases
            mine, _ = sources.fetch_user(p["cfg"], run_state)
            raw += mine
    print(f"fetched {len(raw)} raw postings")

    best = {}
    kept = 0
    for j in raw:
        res, pid = best_score(j, profs)
        if not res:
            continue
        country, remote = classify_location(j["location"], j.get("remote"), j["description"])
        j.update(country=country, remote=remote)
        kept += 1
        j.update(score=res[0], reasons=res[1], matched=res[2], profile=pid)
        merge_into(best, j)
    added_keys = set()
    for j in handle_add_requests(add_reqs, cfg):
        best[dedupe_key(j)] = j  # user's own pick wins
        added_keys.add(dedupe_key(j))
    print(f"{kept} passed filters, {len(best)} unique")

    # ---- merge with history
    by_key_old = {dedupe_key(o): o for o in existing.values()}
    merged = {}
    for k, j in best.items():
        old = by_key_old.get(k) or existing.get(job_id(j["company"], j["title"])) or {}
        jid = old.get("id") or job_id(canon_company(j["company"]), j["title"])
        rec = {
            "id": jid, "title": j["title"], "company": j["company"], "location": j["location"], "country": j.get("country", ""),
            "remote": j.get("remote", False), "url": j["url"], "apply_url": j.get("apply_url") or j["url"], "source": j["source"],
            "also_on": j.get("also_on", []), "posted": j.get("posted") or old.get("posted", ""),
            "first_seen": old.get("first_seen", started), "last_seen": started,
            "score": j["score"], "reasons": j["reasons"], "matched": j["matched"], "salary": j.get("salary", ""),
            "description": j["description"][:8000] or old.get("description", ""),
            "profile": j.get("profile") or old.get("profile") or "main",
        }
        if j.get("manual") or old.get("manual"):
            rec["manual"] = True
        for f in ("resume_pdf", "resume_docx", "headline", "summary", "cover_letter", "keywords_missing", "keywords_matched",
                  "tailor_method", "fit_notes", "profile_hash", "prep"):
            if f in old:
                rec[f] = old[f]
        merged[jid] = rec
        if k in added_keys:
            retailor_ids.add(jid)

    # jobs that stay listed for weeks are often evergreen or "ghost" postings
    stale_days = cfg.get("filters", {}).get("stale_days", 30)
    if stale_days:
        cut = now - timedelta(days=stale_days)
        for jid in [k for k, r in merged.items() if not r.get("manual") and status_of.get(k) not in TRACKED
                    and datetime.fromisoformat(r["first_seen"]) < cut]:
            del merged[jid]

    # keep jobs that dropped out of this run: tracked by the user, added by the user, or seen recently and still passing
    keep_cut = now - timedelta(days=cfg.get("keep_days", 45))
    seen_keys = set(best)
    for jid, old in sorted(existing.items(), key=lambda kv: (status_of.get(kv[0]) not in TRACKED, -kv[1].get("score", 0))):
        k_old = dedupe_key(old)
        if jid in merged or k_old in seen_keys:
            continue
        seen_keys.add(k_old)
        st = status_of.get(jid)
        if st in TRACKED or old.get("manual"):
            if datetime.fromisoformat(old["first_seen"]) > now - timedelta(days=150):
                merged[jid] = old
            continue
        if st == "hidden":
            continue
        try:
            last = datetime.fromisoformat(old.get("last_seen") or old["first_seen"])
        except (KeyError, ValueError):
            continue
        if args.requests_only or (last > now - timedelta(days=5) and datetime.fromisoformat(old["first_seen"]) > keep_cut):
            res, pid = best_score(old, profs)
            if old.get("manual") or res:
                if pid and not old.get("manual"):
                    old["profile"] = pid
                elif (old.get("profile") or "main") not in by_pid:
                    old["profile"] = "main"
                merged[jid] = old

    # ---- tailoring
    os.makedirs(RES_DIR, exist_ok=True)
    have_ai = ai_available() and not args.no_claude
    ai_day = now.date().isoformat()
    if run_state.get("ai_day") != ai_day:
        run_state["ai_day"], run_state["ai_used"] = ai_day, 0
    ai_budget = cfg.get("max_ai_per_day", 40) - run_state.get("ai_used", 0)

    def priority(j):
        st = status_of.get(j["id"])
        return (0 if j.get("manual") else 1 if st in TRACKED else 2, -j["score"])

    def wants(j):
        st = status_of.get(j["id"])
        if st == "hidden":
            return False
        if j.get("tailor_method") == "edited" and j["id"] not in retailor_ids:
            return False  # the person's own edits win
        important = j.get("manual") or st in TRACKED or j["id"] in retailor_ids
        if not important and j["score"] < cfg["min_score_to_tailor"]:
            return False
        if "resume_pdf" not in j or j["id"] in retailor_ids:
            return True
        if j.get("profile_hash") != pof(j)["hash"]:
            return True
        ai_worthy = important or j["score"] >= cfg.get("min_score_for_ai", 65)
        return have_ai and ai_worthy and j.get("tailor_method") != "claude"

    todo = sorted((j for j in merged.values() if wants(j)), key=priority)
    manual_todo = [j for j in todo if j.get("manual") or j["id"] in retailor_ids]
    todo = manual_todo + [j for j in todo if j not in manual_todo][: cfg["max_tailor_per_run"]]
    done = 0
    counts = {"ai_resumes": 0, "keyword_resumes": 0, "edits": 0, "prep_sheets": 0}
    for j in todo:
        st = status_of.get(j["id"])
        important = j.get("manual") or st in TRACKED or j["id"] in retailor_ids
        use_ai = have_ai and (important or j["score"] >= cfg.get("min_score_for_ai", 65)) and (ai_budget > 0 or important)
        print(f"tailoring {j['score']:>3} {'AI ' if use_ai else 'kw '} {j['title']} @ {j['company']}")
        P = pof(j)
        t = tailor(dict(j), P["resume"], P["cfg"], use_claude=use_ai)
        counts["ai_resumes" if t["method"] == "claude" else "keyword_resumes"] += 1
        if t["method"] == "claude":
            ai_budget -= 1
            run_state["ai_used"] = run_state.get("ai_used", 0) + 1
        stem = os.path.join(RES_DIR, j["id"])
        try:
            render.to_pdf(t, P["resume"], stem + ".pdf")
            render.to_docx(t, P["resume"], stem + ".docx")
        except Exception as e:
            print(f"  render failed: {e!r}")
            continue
        save(stem + ".json", t)
        j.update(resume_pdf=f"data/resumes/{j['id']}.pdf", resume_docx=f"data/resumes/{j['id']}.docx",
                 headline=t["headline"], summary=t["summary"], cover_letter=t["cover_letter"],
                 keywords_missing=t["keywords_missing"], keywords_matched=t["keywords_matched"],
                 tailor_method=t["method"], profile_hash=P["hash"])
        if t.get("fit_notes"):
            j["fit_notes"] = t["fit_notes"]
        done += 1

    # ---- resume / cover letter edits made in the app
    for r in [r for r in reqs if r.get("type") == "edit"]:
        j = merged.get(r.get("job_id"))
        t = r.get("tailored")
        if not j or not isinstance(t, dict):
            continue
        P = pof(j)
        base_t = load(os.path.join(RES_DIR, j["id"] + ".json"), {}) or keyword_tailor(dict(j), P["resume"], P["cfg"])
        t = {**base_t, **{k: v for k, v in t.items() if k in ("headline", "summary", "skills", "experience", "projects", "cover_letter")}}
        t["method"] = "edited"
        known = {e["id"] for e in P["resume"]["experience"]}
        t["experience"] = [e for e in t.get("experience", []) if isinstance(e, dict) and e.get("id") in known]
        stem = os.path.join(RES_DIR, j["id"])
        try:
            render.to_pdf(t, P["resume"], stem + ".pdf")
            render.to_docx(t, P["resume"], stem + ".docx")
        except Exception as e:
            print(f"  edit render failed: {e!r}")
            continue
        save(stem + ".json", t)
        j.update(resume_pdf=f"data/resumes/{j['id']}.pdf", resume_docx=f"data/resumes/{j['id']}.docx", headline=t.get("headline", ""),
                 summary=t.get("summary", ""), cover_letter=t.get("cover_letter", ""), tailor_method="edited", profile_hash=P["hash"])
        counts["edits"] += 1
        print(f"saved edits for {j['title']} @ {j['company']}")

    # ---- interview prep requests
    os.makedirs(PREP_DIR, exist_ok=True)
    prep_done = 0
    for r in prep_reqs:
        j = merged.get(r.get("job_id"))
        if not j:
            continue
        md = interview_prep(j, pof(j)["resume"], pof(j)["cfg"]) if have_ai else None
        if md is None:
            md = ("# Interview prep\n\nInterview prep needs AI. Add one secret to your Job Radar repo (Settings → Secrets and "
                  "variables → Actions): `CLAUDE_CODE_OAUTH_TOKEN` (uses your Claude Pro/Max plan – run `claude setup-token` once to get it) "
                  "or `ANTHROPIC_API_KEY` (pay-as-you-go). Then tap Prepare me again.")
        with open(os.path.join(PREP_DIR, j["id"] + ".md"), "w", encoding="utf-8") as fh:
            fh.write(md)
        j["prep"] = f"data/prep/{j['id']}.md"
        prep_done += 1
        if not md.startswith("# Interview prep\n\nInterview prep needs AI"):
            counts["prep_sheets"] += 1

    # ---- base resume (default selection) always available
    hashes = run_state.setdefault("base_hashes", {})
    if "base_hash" in run_state:
        hashes.setdefault("main", run_state.pop("base_hash"))
    for P in profs:
        name = base_name(P["id"])
        if P["hash"] != hashes.get(P["id"]) or not os.path.exists(os.path.join(RES_DIR, name + ".json")):
            base = keyword_tailor(base_job(P["resume"]), P["resume"], P["cfg"])
            save(os.path.join(RES_DIR, name + ".json"), base)
            try:
                render.to_pdf(base, P["resume"], os.path.join(RES_DIR, name + ".pdf"))
                render.to_docx(base, P["resume"], os.path.join(RES_DIR, name + ".docx"))
                hashes[P["id"]] = P["hash"]
            except Exception as e:
                print(f"base resume render failed ({P['name']}): {e!r}")

    # ---- prune files of jobs no longer listed
    live = set(merged)
    for d in (RES_DIR, PREP_DIR):
        for fn in os.listdir(d):
            stem = fn.split(".")[0]
            if stem not in live and stem not in {base_name(P["id"]) for P in profs}:
                os.remove(os.path.join(d, fn))

    # ---- processed requests are removed (the workflow commits the deletion)
    for r in reqs:
        try:
            os.remove(r["_file"])
        except OSError:
            pass

    jobs = sorted(merged.values(), key=lambda j: (-j["score"], j.get("posted") or ""))
    new_count = sum(1 for j in jobs if j["first_seen"] == started)
    save(os.path.join(DATA, "jobs.json"), {"updated": started, "count": len(jobs), "new_this_run": new_count,
                                           "profile_hash": profile_hash, "jobs": jobs,
                                           "profiles": [{"id": P["id"], "name": P["name"], "count": sum(1 for j in jobs if (j.get("profile") or "main") == P["id"])}
                                                        for P in profs]})
    save(os.path.join(DATA, "ats_cache.json"), cache)
    save(os.path.join(DATA, "run_state.json"), run_state)
    save(os.path.join(DATA, "geocache.json"), geocache())
    # ---- usage per month (admin usage page) and search history (coverage dashboard)
    usage = load(os.path.join(DATA, "usage.json"), {})
    m = usage.setdefault(started[:7], {})
    for k, v in list(counts.items()) + [(k, v) for k, v in tailor_mod.USAGE.items()]:
        m[k] = round(m.get(k, 0) + v, 4)
    m["cover_letters"] = m.get("ai_resumes", 0) + m.get("keyword_resumes", 0)
    if not args.requests_only:
        m["searches"] = m.get("searches", 0) + 1
    m["updated"] = started
    save(os.path.join(DATA, "usage.json"), dict(sorted(usage.items())[-12:]))
    if not args.requests_only:
        hist = load(os.path.join(DATA, "history.json"), [])
        by_src = {}
        for j in raw:
            by_src[j.get("source", "?")] = by_src.get(j.get("source", "?"), 0) + 1
        hist.append({"at": started, "scanned": len(raw), "passed": kept, "listed": len(jobs), "new": new_count,
                     "companies": len({canon_company(j.get("company", "")) for j in raw if j.get("company")}), "sources": by_src})
        save(os.path.join(DATA, "history.json"), hist[-120:])
        save(os.path.join(DATA, "report.json"), {"updated": started, "raw": len(raw), "passed": kept, "unique": len(best),
                                                 "new": new_count, "tailored_this_run": done, "ai_used_today": run_state.get("ai_used", 0),
                                                 "ai_enabled": have_ai, "ai_error": tailor_mod.AI_ERROR["msg"], "sources": report})
    print(f"done: {len(jobs)} jobs listed, {new_count} new, {done} tailored, {prep_done} prep, {len(reqs)} requests")


if __name__ == "__main__":
    main()
