"""Per-job resume tailoring.

Rules (enforced in code, not just in the prompt):
- companies, titles, dates, core bullets, education and certifications never change
- only flex bullets are chosen/reworded, and a reworded bullet must keep exactly the same numbers
- skills can only come from the master skill list (no claiming skills the person doesn't have)
- the summary and cover letter may only use numbers that appear in the master data
"""
import json
import os
import re

import requests

DEFAULT_FLEX = [4, 4, 3, 2, 2, 1]  # optional bullets shown per role, newest role first


def flex_count(resume, role_id):
    """How many optional bullets a role gets: the role's own 'flex_count', else by position."""
    for i, e in enumerate(resume["experience"]):
        if e["id"] == role_id:
            return int(e.get("flex_count") or DEFAULT_FLEX[min(i, len(DEFAULT_FLEX) - 1)])
    return 2


def person(resume):
    c = resume.get("contact", {})
    return c.get("name") or c.get("display_name") or "the candidate"

NUM = re.compile(r"\$?\d[\d,.]*\s?(?:[mk]\b|x\b|%|million)?", re.I)

def pick_headline(resume, title, jd_words):
    """Headline whose words best overlap the job title (then the description)."""
    heads = [h for h in (resume.get("headlines") or {}).values() if h] or [resume.get("contact", {}).get("headline", "")]
    tw = set(re.findall(r"[a-z]{3,}", title.lower()))

    def score(h):
        hw = set(re.findall(r"[a-z]{3,}", h.lower()))
        return 3 * len(hw & tw) + len(hw & jd_words)
    return max(heads, key=score) if heads else ""


def all_skills(resume):
    return [s for group in resume["skills"].values() for s in group]


def resume_text(resume):
    parts = [resume["summary_base"], " ".join(resume["summary_facts"]), " ".join(all_skills(resume))]
    for e in resume["experience"]:
        parts += e["core"] + [f["text"] for f in e["flex"]]
    parts += [p["text"] for p in resume["projects"]] + resume["certifications"]
    return " ".join(parts).lower()


def numbers(text):
    return sorted(n.strip().lower().rstrip(".,") for n in NUM.findall(text or "") if re.search(r"\d", n))


def allowed_numbers(resume):
    blob = resume_text(resume) + " " + " ".join(f"{e['start']} {e['end']}" for e in resume["experience"])
    return set(numbers(blob)) | {str(n) for n in range(0, 21)}


def keywords_report(job, resume, cfg):
    jd = job["description"].lower() + " " + job["title"].lower()
    rt = resume_text(resume)
    present = [k for k in cfg["description_keywords"] if re.search(r"(?<![a-z0-9])" + re.escape(k) + r"(?![a-z0-9])", jd)]
    matched = [k for k in present if k in rt]
    missing = [k for k in present if k not in rt]
    return matched, missing


def _overlap(text, tags, jd_words):
    words = set(re.findall(r"[a-z][a-z+\-.]{2,}", text.lower())) | set(tags)
    return len(words & jd_words) + 2 * len(set(tags) & jd_words)


def keyword_tailor(job, resume, cfg):
    """Deterministic fallback used when there is no API key or the API fails."""
    jd = (job["title"] + " " + job["description"]).lower()
    jd_words = set(re.findall(r"[a-z][a-z+\-.]{2,}", jd))
    # tag synonyms so 'ppc' tags fire on 'sponsored products', etc.
    syn = {"ppc": ["sponsored", "acos", "advertising"], "automation": ["automate", "automated", "workflow"],
           "analytics": ["analysis", "insights", "reporting", "dashboard"], "demand-planning": ["forecast", "forecasting"],
           "catalog": ["listings", "content", "catalogue"], "api": ["integration", "integrations"], "ai": ["llm", "genai"]}
    for tag, alts in syn.items():
        if any(a in jd for a in alts):
            jd_words.add(tag)

    exp = []
    for e in resume["experience"]:
        ranked = sorted(range(len(e["flex"])), key=lambda i: -_overlap(e["flex"][i]["text"], e["flex"][i]["tags"], jd_words))
        chosen = ranked[: flex_count(resume, e["id"])]
        exp.append({"id": e["id"], "bullets": e["core"] + [e["flex"][i]["text"] for i in chosen]})

    skills = all_skills(resume)
    in_jd = [s for s in skills if s.lower().split(" (")[0] in jd]
    # then the first skills of each group (the profile lists them most-important first)
    groups = list(resume["skills"].values())
    round_robin = [g[i] for i in range(6) for g in groups if i < len(g)]
    picked = list(dict.fromkeys(in_jd + round_robin))[:18]

    projects = sorted(resume.get("projects", []), key=lambda p: -_overlap(p["text"], p.get("tags", []), jd_words))[:2]

    return {
        "method": "keyword",
        "headline": pick_headline(resume, job["title"], jd_words),
        "summary": resume["summary_base"],
        "skills": picked,
        "experience": exp,
        "projects": [p["name"] for p in projects],
        "cover_letter": default_cover_letter(job, resume),
    }


def default_cover_letter(job, resume):
    """No-AI cover letter: the profile's own template if it has one, else built from its strongest facts."""
    company = job.get("company") or "your team"
    c = resume.get("contact", {})
    tpl = resume.get("cover_letter_template")
    if tpl:
        try:
            return tpl.format(company=company, title=job["title"], name=person(resume))
        except (KeyError, IndexError, ValueError):
            pass
    facts = [f.rstrip(".") for f in resume.get("summary_facts", [])][:4]
    current = resume["experience"][0] if resume.get("experience") else None
    lines = [f"Hello {company} hiring team,", "",
             f"I'm applying for the {job['title']} role. " + (resume.get("summary_base", "").split(". ")[0].rstrip(".") + ".")]
    if facts:
        lines += ["", "A few things I'd bring:"] + [f"• {f}." for f in facts]
    if current:
        lines += ["", f"I'm currently {current['title']} at {current['company']}, and I'd welcome a conversation about how I can help {company}."]
    if c.get("work_authorization"):
        lines += ["", f"{c.get('location', '').strip()}{' · ' if c.get('location') else ''}{c['work_authorization']}."]
    lines += ["", person(resume), " · ".join(x for x in [c.get("phone"), c.get("email")] if x)]
    return "\n".join(lines)


SYSTEM = """You tailor {name}'s resume to job postings. You must stay strictly truthful: use only facts in the master data below, never invent employers, numbers, tools or achievements.

MASTER RESUME DATA (JSON):
{resume}"""

TASK = """JOB POSTING
Title: {title}
Company: {company}
Location: {location}
Description:
{description}

Return ONLY a JSON object with these keys:
- "headline": one line (max 110 chars) positioning him for THIS role, built only from facts in the master data.
- "summary": 3-4 sentences (max 650 chars). Lead with what this employer cares about. Use only facts and numbers that appear in summary_facts or the experience bullets.
- "skills": 14-18 skills chosen ONLY from the master "skills" lists (copy the exact strings), most relevant first.
- "experience": object mapping each role id ({role_ids}) to a list of chosen FLEX bullets, most relevant first. Pick exactly this many per role: {counts}. Each item is {{"i": <index into that role's flex list>, "text": <the bullet, optionally reworded to mirror the posting's language>}}. A reworded bullet MUST keep every number exactly as written and must not add claims.
- "projects": names of the 0-2 most relevant projects (exact "name" strings), [] if none fit.
- "cover_letter": 150-220 words, plain text, first person, addressed to the {company} hiring team, specific to the posting, using only facts from the master data. Mention where they are based and their work authorization if the contact data has them. Sign off as "{name}".
- "fit_notes": 1-2 sentences on the strongest match and the biggest gap, for {name} only.

Do NOT include core bullets; they are added automatically and never change."""


def _slim(resume):
    out = {k: v for k, v in resume.items() if k not in ("_readme", "application_answers", "contact")}
    c = resume.get("contact", {})
    out["contact"] = {k: c[k] for k in ("name", "location", "work_authorization") if c.get(k)}
    return out


# Token use for this run (shown on the admin usage page) and a stop switch when the AI key/token is rejected.
USAGE = {"ai_calls": 0, "input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0, "cost_usd": 0.0}
AI_ERROR = {"msg": ""}


def _add_usage(u, cost=0.0):
    USAGE["ai_calls"] += 1
    USAGE["input_tokens"] += int(u.get("input_tokens") or 0)
    USAGE["output_tokens"] += int(u.get("output_tokens") or 0)
    USAGE["cache_read_tokens"] += int(u.get("cache_read_input_tokens") or 0)
    USAGE["cache_write_tokens"] += int(u.get("cache_creation_input_tokens") or 0)
    USAGE["cost_usd"] = round(USAGE["cost_usd"] + float(cost or 0), 4)


def ai_available():
    """AI tailoring works with either a Claude API key or a Claude subscription token (Pro/Max via Claude Code)."""
    return bool((os.environ.get("ANTHROPIC_API_KEY") or "").strip() or (os.environ.get("CLAUDE_CODE_OAUTH_TOKEN") or "").strip())


def _call_api(system, user, cfg, max_tokens):
    key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    try:
        r = requests.post("https://api.anthropic.com/v1/messages", timeout=180, headers={
            "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": cfg.get("claude_model", "claude-sonnet-5-5"), "max_tokens": max_tokens,
                  # the resume part is identical for every job in a run, so it is cached (cheaper, faster)
                  "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                  "messages": [{"role": "user", "content": user}]})
        if r.status_code != 200:
            print(f"  claude {r.status_code}: {r.text[:300]}")
            if r.status_code in (401, 403):
                AI_ERROR["msg"] = f"Anthropic API key rejected ({r.status_code})"
            return None
        body = r.json()
        _add_usage(body.get("usage") or {})
        return "".join(b.get("text", "") for b in body.get("content", []) if b.get("type") == "text")
    except (requests.RequestException, ValueError) as e:
        print(f"  claude error: {e!r}")
        return None


def _call_subscription(system, user, cfg):
    """Claude Code in headless mode, signed in with the user's own Pro/Max subscription token (CLAUDE_CODE_OAUTH_TOKEN)."""
    import shutil
    import subprocess
    exe = shutil.which("claude")
    if not exe:
        print("  claude CLI not installed")
        return None
    import tempfile
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
    with tempfile.TemporaryDirectory() as tmp:
        sp = os.path.join(tmp, "system.txt")
        with open(sp, "w", encoding="utf-8") as fh:
            fh.write(system)
        cmd = [exe, "-p", user, "--system-prompt-file", sp, "--tools", "", "--max-turns", "1",
               "--output-format", "json", "--no-session-persistence", "--model", cfg.get("claude_cli_model", "sonnet")]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=300, env=env, cwd=tmp)
        except (subprocess.TimeoutExpired, OSError) as e:
            print(f"  claude CLI error: {e!r}")
            return None
    out = r.stdout or ""
    try:
        body = json.loads(out)
    except ValueError:
        body = None
    if r.returncode != 0 or (isinstance(body, dict) and body.get("is_error")):
        msg = (body.get("result") if isinstance(body, dict) else "") or r.stderr or out
        print(f"  claude CLI exit {r.returncode}: {str(msg)[:300]}")
        if re.search(r"401|authenticat|invalid bearer|expired", str(msg), re.I):
            AI_ERROR["msg"] = "Claude token rejected: run claude setup-token again and paste the new token"
        return None
    if isinstance(body, dict):
        _add_usage(body.get("usage") or {}, body.get("total_cost_usd"))
        return body.get("result") or ""
    return out


def call_claude(system, user, cfg, max_tokens=3000):
    if AI_ERROR["msg"]:
        return None  # key/token already rejected this run: don't keep trying
    if (os.environ.get("ANTHROPIC_API_KEY") or "").strip():
        return _call_api(system, user, cfg, max_tokens)
    if (os.environ.get("CLAUDE_CODE_OAUTH_TOKEN") or "").strip():
        return _call_subscription(system, user, cfg)
    return None


def claude_tailor(job, resume, cfg):
    system = SYSTEM.format(name=person(resume), resume=json.dumps(_slim(resume), ensure_ascii=False))
    user = TASK.format(name=person(resume), title=job["title"], company=job["company"] or "the", location=job["location"],
                       description=job["description"][:9000] or "(no description available – use the title)",
                       role_ids=", ".join(e["id"] for e in resume["experience"]),
                       counts=json.dumps({e["id"]: min(flex_count(resume, e["id"]), len(e["flex"])) for e in resume["experience"]}))
    text = call_claude(system, user, cfg)
    if not text:
        return None
    m = re.search(r"\{.*\}", text, re.S)
    try:
        return json.loads(m.group(0)) if m else None
    except ValueError:
        return None


PREP_TASK = """Prepare {name} for an interview for this job.

Title: {title}
Company: {company}
Location: {location}
Description:
{description}

Write in Markdown, concise and practical:
## What they care about
3-5 bullets reading between the lines of the posting.
## Your best stories for this role
4-5 STAR stories built ONLY from their real experience in the master data (name the employer; keep numbers exactly as written).
## Likely questions and how to answer
8-10 questions (role-specific, behavioural and technical), each with a 2-4 sentence answer outline that uses their real experience.
## Gaps to prepare for
Where their background is thinner than the posting, and an honest way to address each.
## Questions to ask them
5 sharp questions.
## 30-second intro
A short spoken intro tailored to this role."""


def interview_prep(job, resume, cfg):
    system = SYSTEM.format(name=person(resume), resume=json.dumps(_slim(resume), ensure_ascii=False))
    text = call_claude(system, PREP_TASK.format(name=person(resume), title=job["title"], company=job["company"], location=job["location"],
                                                description=job["description"][:9000]), cfg, max_tokens=4000)
    if not text:
        return None
    return f"# Interview prep: {job['title']} – {job['company']}\n\n" + text.strip()


def validate(raw, job, resume):
    """Merge a model answer onto the keyword baseline, rejecting anything that breaks the rules."""
    base = keyword_tailor(job, resume, {})
    if not isinstance(raw, dict):
        return base
    ok_nums = allowed_numbers(resume)
    out = dict(base)
    out["method"] = "claude"

    h = raw.get("headline")
    if isinstance(h, str) and 10 < len(h) <= 130 and set(numbers(h)) <= ok_nums:
        out["headline"] = h.strip()

    s = raw.get("summary")
    if isinstance(s, str) and 80 < len(s) <= 900 and set(numbers(s)) <= ok_nums:
        out["summary"] = s.strip()

    master = {x.lower(): x for x in all_skills(resume)}
    sk = [master[x.lower()] for x in raw.get("skills", []) if isinstance(x, str) and x.lower() in master]
    if len(sk) >= 8:
        out["skills"] = list(dict.fromkeys(sk))[:18]

    roles = {e["id"]: e for e in resume["experience"]}
    exp_raw = raw.get("experience") or {}
    new_exp = []
    for e in base["experience"]:
        role = roles[e["id"]]
        picks = exp_raw.get(e["id"]) if isinstance(exp_raw, dict) else None
        chosen = []
        for p in picks or []:
            try:
                i = int(p.get("i"))
                orig = role["flex"][i]["text"]
            except (TypeError, ValueError, IndexError, AttributeError):
                continue
            text = p.get("text") if isinstance(p.get("text"), str) else orig
            if numbers(text) != numbers(orig) or len(text) > len(orig) * 1.6 + 20 or len(text) < 25:
                text = orig
            if text not in chosen:
                chosen.append(text)
        if chosen:
            new_exp.append({"id": e["id"], "bullets": role["core"] + chosen[: flex_count(resume, e["id"])]})
        else:
            new_exp.append(e)
    out["experience"] = new_exp

    names = {p["name"] for p in resume["projects"]}
    pr = [p for p in raw.get("projects", []) if p in names]
    if isinstance(raw.get("projects"), list):
        out["projects"] = pr[:2]

    cl = raw.get("cover_letter")
    if isinstance(cl, str) and 400 < len(cl) < 2400 and set(numbers(cl)) <= ok_nums | set(numbers(resume["contact"]["phone"])):
        out["cover_letter"] = cl.strip()
    if isinstance(raw.get("fit_notes"), str):
        out["fit_notes"] = raw["fit_notes"][:400]
    return out


def tailor(job, resume, cfg, use_claude=True):
    raw = claude_tailor(job, resume, cfg) if use_claude else None
    result = validate(raw, job, resume) if raw else keyword_tailor(job, resume, cfg)
    result["keywords_matched"], result["keywords_missing"] = keywords_report(job, resume, cfg)
    return result
