"""Turn an uploaded resume (PDF / Word / text) into profile/resume.json.

With AI available (Claude API key or Claude Pro/Max token) the resume is read by Claude into the full structure.
Without AI a simple section parser fills what it can; the person finishes it in the app's profile editor.
"""
import json
import os
import re

from tailor import ai_available, call_claude

SCHEMA_HINT = """{
  "contact": {"name": "", "display_name": "NAME IN CAPS", "location": "City, Province/State, Country", "phone": "", "email": "",
              "linkedin": "", "work_authorization": ""},
  "headlines": {"main": "one-line professional headline", "alt1": "variant for a different kind of role", "alt2": "another variant"},
  "summary_base": "3-4 sentence summary",
  "summary_facts": ["each strongest, quantified achievement as a short fact"],
  "skills": {"group name": ["skill", "skill"]},
  "experience": [{"id": "shortid", "company": "", "location": "", "title": "", "start": "MM/YYYY", "end": "MM/YYYY or Present",
                  "core": ["2-3 most important bullets, always shown"],
                  "flex": [{"text": "other bullet", "tags": ["lowercase-topic", "tags"]}]}],
  "projects": [{"name": "", "text": "", "tags": []}],
  "certifications": [""],
  "education": [{"credential": "", "school": "", "dates": ""}],
  "application_answers": {"full_name": "", "email": "", "phone": "", "city": "", "linkedin": "", "years_experience": ""}
}"""

IMPORT_PROMPT = """Convert this resume into JSON with exactly this structure (newest job first):

{schema}

Rules: copy facts exactly, never invent anything; keep every number as written; put each role's 2-3 strongest bullets in "core" and the rest in "flex";
group skills into 3-6 sensible groups; leave fields empty when the resume doesn't say. Return ONLY the JSON.

RESUME TEXT:
{text}"""


W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
MC_FALLBACK = "{http://schemas.openxmlformats.org/markup-compatibility/2006}Fallback"


def _docx_text(path):
    """Every line of a Word file in reading order, including text boxes, tables, form fields, headers and footers
    (python-docx's paragraph list misses text boxes and content controls, which many resume templates use)."""
    import zipfile
    from xml.etree import ElementTree as ET
    out = []
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        parts = sorted(n for n in names if re.match(r"word/header\d*\.xml$", n)) + ["word/document.xml"] + \
            sorted(n for n in names if re.match(r"word/footer\d*\.xml$", n))
        for name in parts:
            if name not in names:
                continue
            root = ET.fromstring(z.read(name))
            parent = {c: p for p in root.iter() for c in p}

            def skip(el):  # text-box copies kept for old Word versions would repeat every line
                while el is not None:
                    if el.tag == MC_FALLBACK:
                        return True
                    el = parent.get(el)
                return False

            def own_p(el):
                el = parent.get(el)
                while el is not None and el.tag != W + "p":
                    el = parent.get(el)
                return el

            for p in root.iter(W + "p"):
                if skip(p):
                    continue
                buf = []
                for el in p.iter():
                    if el.tag in (W + "t", W + "tab", W + "br", W + "cr") and own_p(el) is p:
                        buf.append(el.text or "" if el.tag == W + "t" else ("\t" if el.tag == W + "tab" else "\n"))
                line = "".join(buf)
                if line.strip():
                    out.append(line)
    return "\n".join(out)


def extract_text(path):
    low = path.lower()
    if low.endswith(".pdf"):
        from pypdf import PdfReader
        pages = PdfReader(path).pages
        text = "\n".join((p.extract_text() or "") for p in pages)
        if len(text.strip()) < 200:  # some PDFs only read well in layout mode
            try:
                text = "\n".join((p.extract_text(extraction_mode="layout") or "") for p in pages) or text
            except TypeError:
                pass
        return text
    if low.endswith(".docx"):
        try:
            return _docx_text(path)
        except Exception:
            from docx import Document
            d = Document(path)
            parts = [p.text for p in d.paragraphs]
            for t in d.tables:
                for row in t.rows:
                    parts.append(" | ".join(c.text for c in row.cells))
            return "\n".join(parts)
    with open(path, encoding="utf-8", errors="ignore") as fh:
        return fh.read()


def ai_import(text, cfg):
    out = call_claude("You convert resumes into structured JSON. Output JSON only.",
                      IMPORT_PROMPT.format(schema=SCHEMA_HINT, text=text[:30000]), cfg, max_tokens=8000)
    if not out:
        return None
    m = re.search(r"\{.*\}", out, re.S)
    try:
        return json.loads(m.group(0)) if m else None
    except ValueError:
        return None


# Section headings and what they are. Longest first, so "work experience" wins over "experience".
SECTIONS = {
    "summary": ("summary", "profile", "personal profile", "professional summary", "career summary", "executive summary",
                "summary of qualifications", "about me", "objective", "career objective", "professional profile", "overview"),
    "experience": ("experience", "work experience", "professional experience", "relevant experience", "employment",
                   "employment history", "work history", "career history", "professional background", "career", "work",
                   "experience summary", "positions held", "internships", "internship"),
    "skills": ("skills", "technical skills", "core skills", "key skills", "tools", "tools worked on", "areas of expertise",
               "expertise", "core competencies", "competencies", "skills & tools", "skills and tools", "technologies",
               "technical proficiencies", "strengths", "key strengths", "skill set", "skillset"),
    "certifications": ("certification", "certifications", "licenses", "licenses & certifications", "courses", "training"),
    "education": ("education", "education & training", "education and training", "academic background", "academics",
                  "qualifications", "academic qualifications", "educational background", "educational qualifications",
                  "education details", "academic details"),
    "other": ("projects", "achievements", "awards", "languages", "references", "volunteer", "volunteering",
              "volunteer experience", "interests", "hobbies", "publications", "activities", "accomplishments"),
}
SECTION_WORDS = tuple(w for ws in SECTIONS.values() for w in ws)
KIND = {w: k for k, ws in SECTIONS.items() for w in ws}
SECTION_RX = re.compile(r"^\s*(" + "|".join(sorted(map(re.escape, SECTION_WORDS), key=len, reverse=True)) + r")\s*[:\-–|]?\s*$", re.I)


def _heading(line):
    """'C A R E E R   S U M M A R Y' → 'career summary'; 'WORK HISTORY:' → 'work history'."""
    t = line.strip()
    if re.fullmatch(r"(?:[A-Za-z&]\s){2,}[A-Za-z&](?:\s{2,}(?:[A-Za-z&]\s){1,}[A-Za-z&])*", t):
        t = " ".join(w.replace(" ", "") for w in re.split(r"\s{2,}", t))
    t = re.sub(r"\s+", " ", t.replace("&", " & ")).strip()
    return t


class _Sec:
    @staticmethod
    def match(line):
        return SECTION_RX.match(_heading(line)) if len(line.strip()) < 60 else None


SECTION = _Sec()
_MON = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s*(?:'\d{2}|\d{4})"
_ONE = r"(?:" + _MON + r"|(?:\d{1,2}[/.-])?\d{4}|(?:\d{1,2}/)?\d{2}(?=\s*[-–—]))"
DATES = re.compile(r"(" + _ONE + r")\s*(?:[-–—~]+|\bto\b|\btill\b|\buntil\b)\s*(" + _ONE + r"|(?:till\s+|to\s+)?(?:present|current|now|today|date)|ongoing)", re.I)
SINCE = re.compile(r"\b(?:since|from)\s+(" + _ONE + r")", re.I)
BULLET = re.compile(r"^\s*[•\-\*▪●◦·➢►✓✔o]\s+|^\s*[•▪●◦·➢►✓✔]\s*")


def _date(line):
    d = DATES.search(line)
    if d:
        return d.group(1), d.group(2).title(), d
    s = SINCE.search(line)
    return (s.group(1), "Present", s) if s else None


TITLE_WORDS = re.compile(r"\b(manager|coordinator|engineer|analyst|intern|lead|director|associate|specialist|developer|consultant|"
                         r"officer|assistant|executive|representative|supervisor|administrator|designer|accountant|clerk|"
                         r"technician|head|vp|vice president|president|partner|owner|founder|agent|advisor|adviser|nurse|teacher|"
                         r"scientist|architect|buyer|planner|operator|driver|worker|cashier|server|barista|sales|tester|qa|"
                         r"programmer|strategist|marketer|recruiter|trainer|instructor|tutor|chef|cook|pharmacist|therapist|"
                         r"researcher|editor|writer|auditor|controller|cfo|ceo|coo|cto|owner|merchandiser|handler|picker|"
                         r"associate|ambassador|leader|member|staff|apprentice|fellow|volunteer)s?\b", re.I)
COMPANY_HINTS = re.compile(r"\b(inc|ltd|llc|llp|corp|corporation|limited|company|co\.|group|technologies|solutions|services|bank|"
                           r"university|college|hospital|pvt|private|plc|gmbh|canada|india|usa)\b|—|\s-\s.*,", re.I)


def _looks_title(t):
    return bool(t) and bool(TITLE_WORDS.search(t)) and not COMPANY_HINTS.search(t)


def _roles(exp):
    roles, role = [], None
    for i, l in enumerate(exp):
        d = _date(l)
        nxt_has_date = i + 1 < len(exp) and _date(exp[i + 1])
        if d:
            start, end, m = d
            head = (l[:m.start()] + l[m.end():]).strip(" |,–-()\t")
            head = re.sub(r"\s*[|,–(-]\s*$", "", head).strip()
            prev = exp[i - 1] if i > 0 and not BULLET.match(exp[i - 1]) and not _date(exp[i - 1]) and len(exp[i - 1]) < 70 \
                and not exp[i - 1].rstrip().endswith(".") else ""  # a sentence is the last role's bullet, not a title
            if role and prev and role["bullets"] and role["bullets"][-1] == BULLET.sub("", prev).strip():
                role["bullets"].pop()  # that line was this role's title, not the last role's bullet
            if prev and head:
                title, company = prev, head
            elif head:
                parts = re.split(r"\s+(?:at|@|\||–|—)\s+", head, maxsplit=1)  # commas wait: the next line may be the company
                title, company = (parts[0], parts[1]) if len(parts) == 2 and (_looks_title(parts[0]) or _looks_title(parts[1])) else (head, "")
            else:
                title, company = prev, ""
            role = {"title": title.strip(), "company": company.strip(), "location": "", "start": start, "end": end, "bullets": [], "_fill": 2}
            roles.append(role)
        elif role and role["_fill"] and not role["bullets"] and len(l) < 80 and not BULLET.match(l) and not nxt_has_date \
                and (not role["title"] or not role["company"] or (not _looks_title(role["title"]) and _looks_title(l))):
            # lines right after the dates: the title and/or the company
            if not role["title"]:
                role["title"] = l.strip()
            elif not role["company"]:
                role["company"] = l.strip()
            else:
                role["company"] = role["title"] + (", " + role["company"] if role["company"] else "")
                role["title"] = l.strip()
            role["_fill"] -= 1
        elif role and len(l) > 25 and (not nxt_has_date or BULLET.match(l)):
            role["bullets"].append(BULLET.sub("", l).strip())
            role["_fill"] = 0
        elif role and not nxt_has_date and role["bullets"] and len(l) <= 25 and not BULLET.match(l):
            role["bullets"][-1] += " " + l
    out = []
    for r in roles:
        r.pop("_fill", None)
        if len(r["title"]) > 80 or (r["title"].rstrip().endswith(".") and len(r["title"].split()) > 6):
            if out and r["title"]:
                out[-1]["bullets"].append(r["title"])
            r["title"] = ""
        if not r["title"] and r["company"]:
            parts = re.split(r"\s+(?:at|@|\||–|—)\s+|,\s+", r["company"], maxsplit=1)
            if len(parts) == 2 and _looks_title(parts[0]):
                r["title"], r["company"] = parts
            elif _looks_title(r["company"]):
                r["title"], r["company"] = r["company"], ""
        if not r["company"]:
            parts = re.split(r"\s+(?:at|@|\||–|—)\s+|,\s+", r["title"], maxsplit=1)
            if len(parts) == 2 and _looks_title(parts[0]):
                r["title"], r["company"] = parts
        if _looks_title(r["company"]) and not _looks_title(r["title"]):
            r["title"], r["company"] = r["company"], r["title"]
        r["company"] = re.sub(r"\s*[—–]\s*((?i:remote)|[A-Z][A-Za-z .'-]+,\s*[A-Z]{2})$", "", r["company"]).strip()
        if r["title"] or r["company"]:
            out.append(r)
    return out


def heuristic_import(text):
    lines = [l.rstrip() for l in text.splitlines()]
    lines = [l for l in lines if l.strip()]
    email_m = re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", text)
    email = email_m.group(0) if email_m else ""
    phone_m = re.search(r"(\+?\d[\d\s().-]{8,}\d)", text)
    link_m = re.search(r"(https?://)?(www\.)?linkedin\.com/in/[\w-]+", text, re.I)
    name = lines[0].strip() if lines else ""
    sections, cur = {"_top": []}, "_top"
    for l in lines[1:]:
        inline = re.match(r"^\s*([A-Za-z &]{3,40}?)\s*:\s+(.{3,})$", l)
        if inline and SECTION.match(inline.group(1)):
            cur = KIND.get(SECTION.match(inline.group(1)).group(1).lower(), "other")
            sections.setdefault(cur, []).append(inline.group(2))
            continue
        m = SECTION.match(l)
        if m:
            cur = KIND.get(m.group(1).lower(), "other")
            sections.setdefault(cur, [])
            continue
        sections.setdefault(cur, []).append(l)

    def sec(kind):
        return sections.get(kind, [])

    summary = " ".join(BULLET.sub("", l) for l in sec("summary"))
    if not summary:  # no heading: the first long paragraph near the top is usually the summary
        summary = next((l for l in sections["_top"][:8] if len(l) > 120), "")
    skills = [BULLET.sub("", s).strip() for l in sec("skills") for s in re.split(r"[,|;•·]|\t", l)]
    skills = [s for s in skills if 1 < len(s) < 60]
    certs = [BULLET.sub("", l).strip() for l in sec("certifications")]

    roles = _roles([re.sub(r"\s+", " ", l).strip() for l in sec("experience")])
    if not roles:  # no recognisable heading: look for jobs (lines with date ranges) anywhere outside education
        rest = [re.sub(r"\s+", " ", l).strip() for k, v in sections.items() if k not in ("education", "certifications") for l in v]
        roles = _roles(rest)
    experience = []
    for n, r in enumerate(roles):
        r["company"] = re.sub(r"^company\s*[-:]\s*", "", r["company"], flags=re.I)
        rid = re.sub(r"[^a-z0-9]", "", (r["company"] or r["title"]).lower())[:16] or f"role{n}"
        experience.append({"id": rid, "company": r["company"], "location": "", "title": r["title"], "start": r["start"], "end": r["end"],
                           "core": r["bullets"][:2], "flex": [{"text": b, "tags": []} for b in r["bullets"][2:]]})
    first_title = experience[0]["title"] if experience else ""
    location = ""
    for l in lines[1:6]:
        m = re.search(r"([A-Z][A-Za-z .'-]+),\s*([A-Z]\d[A-Z]\s?\d[A-Z]\d)", l)  # Canadian postal code
        if m:
            location = f"{m.group(1).split(',')[-1].strip()}, Canada"
            break
        m = re.search(r"([A-Z][A-Za-z .'-]+),\s*(ON|QC|BC|AB|MB|SK|NS|NB|NL|PE|[A-Z]{2})\b", l)
        if m and not re.search(r"@|\d{3}[- ]\d{3}", m.group(0)):
            location = f"{m.group(1).strip()}, {m.group(2)}"
            break
    if not location:
        for l in lines[1:6]:
            for seg in re.split(r"\s*[|•·]\s*|\s{3,}", l):
                if re.fullmatch(r"[A-Z][A-Za-z .'-]{2,30},\s*[A-Z][A-Za-z .'-]{1,30}", seg.strip()) and not re.search(r"@|\d", seg):
                    location = seg.strip()
                    break
            if location:
                break
    education = []
    for l in [re.sub(r"\s+", " ", x).strip() for x in sec("education")]:
        d = DATES.search(l) or re.search(r"(\d{4})()", l)
        if d and education and not education[-1]["dates"]:
            education[-1]["school"] = (l[:d.start()] + l[d.end():]).strip(" |,–-()")
            education[-1]["dates"] = f"{d.group(1)} – {d.group(2).title()}" if d.group(2) else d.group(1)
        elif not re.match(r"(?i)relevant|courses|modules|gpa", l) and len(education) < 6:
            education.append({"credential": BULLET.sub("", l), "school": "", "dates": ""})
    return {
        "contact": {"name": name.title() if name.isupper() else name, "display_name": name.upper(), "location": location,
                    "phone": phone_m.group(1).strip() if phone_m else "", "email": email or "",
                    "linkedin": ("https://" + link_m.group(0).split("://")[-1]) if link_m else "", "work_authorization": ""},
        "headlines": {"main": first_title},
        "summary_base": summary[:900],
        "summary_facts": [],
        "skills": {"Skills": skills[:40]} if skills else {"Skills": []},
        "experience": experience,
        "projects": [],
        "certifications": certs,
        "education": education,
        "application_answers": {"full_name": name.title() if name.isupper() else name, "email": email or "",
                                "phone": phone_m.group(1).strip() if phone_m else ""},
    }


def normalize(r):
    """Fill defaults so the rest of the engine can rely on every key."""
    r.setdefault("contact", {})
    for k in ("name", "display_name", "location", "phone", "email", "linkedin", "work_authorization"):
        r["contact"].setdefault(k, "")
    if not r["contact"]["display_name"]:
        r["contact"]["display_name"] = r["contact"]["name"].upper()
    r.setdefault("headlines", {})
    if not any(r["headlines"].values()):
        r["headlines"] = {"main": (r.get("experience") or [{}])[0].get("title", "")}
    for k, d in (("summary_base", ""), ("summary_facts", []), ("skills", {}), ("experience", []), ("projects", []),
                 ("certifications", []), ("education", []), ("application_answers", {})):
        r.setdefault(k, d)
    seen = set()
    for i, e in enumerate(r["experience"]):
        rid = e.get("id") or re.sub(r"[^a-z0-9]", "", (e.get("company") or "role").lower())[:16] or f"role{i}"
        while rid in seen:
            rid += str(i)
        seen.add(rid)
        e["id"] = rid
        for k in ("company", "location", "title", "start", "end"):
            e.setdefault(k, "")
        e.setdefault("core", [])
        e["flex"] = [f if isinstance(f, dict) else {"text": f, "tags": []} for f in e.get("flex", [])]
        for f in e["flex"]:
            f.setdefault("tags", [])
    for p in r["projects"]:
        p.setdefault("tags", [])
    return r


def import_resume(path, cfg):
    text = extract_text(path)
    if len(text.strip()) < 100:
        raise ValueError("Couldn't read text from that file (is it a scanned image?)")
    data = ai_import(text, cfg) if ai_available() else None
    method = "ai" if data else "basic"
    data = normalize(data or heuristic_import(text))
    data["_readme"] = ("Master resume data. Core bullets, companies, titles, dates, education and certifications are never changed "
                       "by tailoring; only headlines, summary, skill order and optional (flex) bullets are chosen per job.")
    data["_imported"] = {"method": method, "file": os.path.basename(path)}
    return data


def setup_search(cfg, resume):
    """First-time search settings from a freshly imported resume."""
    clean = lambda t: re.sub(r"\s*\(.*?\)|/.*$", "", t).strip()
    looks_like_title = lambda t: 0 < len(t) <= 60 and len(t.split()) <= 8 and not t.rstrip().endswith(".")
    titles = list(dict.fromkeys(clean(e["title"]) for e in resume["experience"] if looks_like_title(clean(e.get("title") or ""))))[:4]
    if titles:
        cfg["queries"] = list(dict.fromkeys(titles + [clean(h) for h in resume.get("headlines", {}).values() if h and len(h) < 60][:2]))
    loc = resume.get("contact", {}).get("location", "")
    if loc:
        cfg.setdefault("locations", {})["search_locations"] = [{"place": loc, "radius_km": 50}]
        from util import classify_location
        where = classify_location(loc)[0]
        if where in ("AU", "IN"):
            cfg["locations"]["country"] = where
        elif re.search(r"\b(usa|united states|us)\b", loc, re.I) or re.search(r",\s*[A-Z]{2}\s*$", loc) and not re.search(
                r",\s*(ON|QC|BC|AB|MB|SK|NS|NB|NL|PE)\s*$", loc):
            cfg["locations"]["country"] = "US"
    cfg["title_terms"]["required"] = []
    cfg["description_keywords"] = {}
    cfg.pop("_setup", None)
    return cfg
