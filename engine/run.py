"""Job Radar search run.

  fetch -> filter/score -> dedupe -> merge with history -> handle app requests -> tailor -> write data/

Usage:
  python engine/run.py                 # full run (what GitHub Actions does)
  python engine/run.py --fixtures F    # offline test using a JSON list of jobs
  python engine/run.py --no-claude     # skip the Anthropic API even if a key exists
  python engine/run.py --requests-only # only handle app requests (add job / interview prep), no board search
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

import pagefetch  # noqa: E402
import render  # noqa: E402
import sources  # noqa: E402
from score import score  # noqa: E402
import importer  # noqa: E402
from tailor import ai_available, all_skills, interview_prep, keyword_tailor, tailor  # noqa: E402
from util import classify_location, geocache, geocode, job_id, load_geocache, norm, now_iso  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
RES_DIR = os.path.join(DATA, "resumes")
PREP_DIR = os.path.join(DATA, "prep")
REQ_DIR = os.path.join(ROOT, "requests")
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
        url = (req.get("url") or "").strip()
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures")
    ap.add_argument("--no-claude", action="store_true")
    ap.add_argument("--requests-only", action="store_true")
    args = ap.parse_args()

    cfg = load(os.path.join(ROOT, "profile", "search.json"), None)
    req_files = sorted(glob.glob(os.path.join(REQ_DIR, "*.json")))
    reqs = [dict(load(f, {}), _file=f) for f in req_files]

    # ---- resume upload from the app: rebuild profile/resume.json (and first-time search settings)
    import_note = None
    for r in [r for r in reqs if r.get("type") == "import_resume"]:
        path = os.path.join(ROOT, r.get("path", ""))
        try:
            data = importer.import_resume(path, cfg)
            old = load(os.path.join(ROOT, "profile", "resume.json"), {})
            if old.get("application_answers"):
                data["application_answers"] = {**data.get("application_answers", {}), **{k: v for k, v in old["application_answers"].items() if v}}
            save(os.path.join(ROOT, "profile", "resume.json"), data)
            if cfg.get("_setup") or r.get("reset_search"):
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
        save(os.path.join(DATA, "jobs.json"), {"updated": now_iso(), "count": 0, "new_this_run": 0, "setup_needed": True,
                                               "note": import_note or "Upload your resume in the app to start.", "jobs": []})
        for r in reqs:
            try:
                os.remove(r["_file"])
            except OSError:
                pass
        print("no resume yet – nothing to search")
        return

    # ---- settings that adapt to any profile
    locs = cfg.setdefault("locations", {})
    if not locs.get("search_locations") and resume.get("contact", {}).get("location"):
        locs["search_locations"] = [{"place": resume["contact"]["location"], "radius_km": 50}]
    if not cfg.get("title_terms", {}).get("required"):
        words = sources.query_words(cfg, 12)
        cfg["_auto_required"] = list(dict.fromkeys(words + [w.replace("-", "") for w in words if "-" in w]))
    if not cfg.get("description_keywords"):
        cfg["description_keywords"] = {s.lower().split(" (")[0]: 2 for s in all_skills(resume) if len(s) < 40}
    load_geocache(load(os.path.join(DATA, "geocache.json"), {}))
    cfg["_place_points"] = [(p, ll, sources.radius_km(cfg, p)) for p in sources.places(cfg) for ll in [geocode(p)] if ll]
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
    elif not args.requests_only:
        raw, report = sources.fetch_all(cfg, cache, run_state)
    print(f"fetched {len(raw)} raw postings")

    best = {}
    kept = 0
    for j in raw:
        res = score(j, cfg)
        if not res or res[0] < cfg["min_score_to_save"]:
            continue
        kept += 1
        j.update(score=res[0], reasons=res[1], matched=res[2])
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
            res = score(dict(old), cfg)
            if old.get("manual") or (res and res[0] >= cfg["min_score_to_save"]):
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
        if j.get("profile_hash") != profile_hash:
            return True
        ai_worthy = important or j["score"] >= cfg.get("min_score_for_ai", 65)
        return have_ai and ai_worthy and j.get("tailor_method") != "claude"

    todo = sorted((j for j in merged.values() if wants(j)), key=priority)
    manual_todo = [j for j in todo if j.get("manual") or j["id"] in retailor_ids]
    todo = manual_todo + [j for j in todo if j not in manual_todo][: cfg["max_tailor_per_run"]]
    done = 0
    for j in todo:
        st = status_of.get(j["id"])
        important = j.get("manual") or st in TRACKED or j["id"] in retailor_ids
        use_ai = have_ai and (important or j["score"] >= cfg.get("min_score_for_ai", 65)) and (ai_budget > 0 or important)
        print(f"tailoring {j['score']:>3} {'AI ' if use_ai else 'kw '} {j['title']} @ {j['company']}")
        t = tailor(dict(j), resume, cfg, use_claude=use_ai)
        if t["method"] == "claude":
            ai_budget -= 1
            run_state["ai_used"] = run_state.get("ai_used", 0) + 1
        stem = os.path.join(RES_DIR, j["id"])
        try:
            render.to_pdf(t, resume, stem + ".pdf")
            render.to_docx(t, resume, stem + ".docx")
        except Exception as e:
            print(f"  render failed: {e!r}")
            continue
        save(stem + ".json", t)
        j.update(resume_pdf=f"data/resumes/{j['id']}.pdf", resume_docx=f"data/resumes/{j['id']}.docx",
                 headline=t["headline"], summary=t["summary"], cover_letter=t["cover_letter"],
                 keywords_missing=t["keywords_missing"], keywords_matched=t["keywords_matched"],
                 tailor_method=t["method"], profile_hash=profile_hash)
        if t.get("fit_notes"):
            j["fit_notes"] = t["fit_notes"]
        done += 1

    # ---- resume / cover letter edits made in the app
    for r in [r for r in reqs if r.get("type") == "edit"]:
        j = merged.get(r.get("job_id"))
        t = r.get("tailored")
        if not j or not isinstance(t, dict):
            continue
        base_t = load(os.path.join(RES_DIR, j["id"] + ".json"), {}) or keyword_tailor(dict(j), resume, cfg)
        t = {**base_t, **{k: v for k, v in t.items() if k in ("headline", "summary", "skills", "experience", "projects", "cover_letter")}}
        t["method"] = "edited"
        known = {e["id"] for e in resume["experience"]}
        t["experience"] = [e for e in t.get("experience", []) if isinstance(e, dict) and e.get("id") in known]
        stem = os.path.join(RES_DIR, j["id"])
        try:
            render.to_pdf(t, resume, stem + ".pdf")
            render.to_docx(t, resume, stem + ".docx")
        except Exception as e:
            print(f"  edit render failed: {e!r}")
            continue
        save(stem + ".json", t)
        j.update(resume_pdf=f"data/resumes/{j['id']}.pdf", resume_docx=f"data/resumes/{j['id']}.docx", headline=t.get("headline", ""),
                 summary=t.get("summary", ""), cover_letter=t.get("cover_letter", ""), tailor_method="edited", profile_hash=profile_hash)
        print(f"saved edits for {j['title']} @ {j['company']}")

    # ---- interview prep requests
    os.makedirs(PREP_DIR, exist_ok=True)
    prep_done = 0
    for r in prep_reqs:
        j = merged.get(r.get("job_id"))
        if not j:
            continue
        md = interview_prep(j, resume, cfg) if have_ai else None
        if md is None:
            md = ("# Interview prep\n\nInterview prep needs AI. Add one secret to your Job Radar repo (Settings → Secrets and "
                  "variables → Actions): `CLAUDE_CODE_OAUTH_TOKEN` (uses your Claude Pro/Max plan – run `claude setup-token` once to get it) "
                  "or `ANTHROPIC_API_KEY` (pay-as-you-go). Then tap Prepare me again.")
        with open(os.path.join(PREP_DIR, j["id"] + ".md"), "w", encoding="utf-8") as fh:
            fh.write(md)
        j["prep"] = f"data/prep/{j['id']}.md"
        prep_done += 1

    # ---- base resume (default selection) always available
    if profile_hash != run_state.get("base_hash") or not os.path.exists(os.path.join(RES_DIR, "base.json")):
        base = keyword_tailor({"title": "E-commerce Manager", "company": "",
                               "description": "amazon shopify marketplace ecommerce automation analytics finance accounting"}, resume, cfg)
        save(os.path.join(RES_DIR, "base.json"), base)
        try:
            render.to_pdf(base, resume, os.path.join(RES_DIR, "base.pdf"))
            render.to_docx(base, resume, os.path.join(RES_DIR, "base.docx"))
            run_state["base_hash"] = profile_hash
        except Exception as e:
            print(f"base resume render failed: {e!r}")

    # ---- prune files of jobs no longer listed
    live = set(merged)
    for d in (RES_DIR, PREP_DIR):
        for fn in os.listdir(d):
            stem = fn.split(".")[0]
            if stem != "base" and stem not in live:
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
                                           "profile_hash": profile_hash, "jobs": jobs})
    save(os.path.join(DATA, "ats_cache.json"), cache)
    save(os.path.join(DATA, "run_state.json"), run_state)
    save(os.path.join(DATA, "geocache.json"), geocache())
    if not args.requests_only:
        save(os.path.join(DATA, "report.json"), {"updated": started, "raw": len(raw), "passed": kept, "unique": len(best),
                                                 "new": new_count, "tailored_this_run": done, "ai_used_today": run_state.get("ai_used", 0),
                                                 "ai_enabled": have_ai, "sources": report})
    print(f"done: {len(jobs)} jobs listed, {new_count} new, {done} tailored, {prep_done} prep, {len(reqs)} requests")


if __name__ == "__main__":
    main()
