import { html, render, useState, useEffect, useMemo, useRef, useCallback } from "./vendor/preact-htm.js";
import * as gh from "./gh.js";
import { resumePdf, fileName } from "./pdf.js";
import { BOARD_GROUPS } from "./boards.js";

// ------------------------------------------------------------------ helpers

const PIPE = ["applied", "interview", "offer", "rejected"];
const LABEL = { saved: "Saved", applied: "Applied", interview: "Interview", offer: "Offer", rejected: "Rejected", hidden: "Not interested" };
const scoreColor = (s) => (s >= 80 ? "var(--good)" : s >= 65 ? "var(--blue)" : s >= 50 ? "var(--warn)" : "var(--ink-3)");
const clone = (o) => JSON.parse(JSON.stringify(o));
const lines = (s) => (s || "").split("\n").map((x) => x.replace(/^\s*[•\-*]\s*/, "").trim()).filter(Boolean);
const commas = (s) => (s || "").split(/,(?![^(]*\))|\n/).map((x) => x.trim()).filter(Boolean);

function age(job) {
  const t = Date.parse(job.posted || job.first_seen || "");
  if (!t) return "";
  const h = (Date.now() - t) / 36e5;
  return h < 1 ? "now" : h < 24 ? `${Math.floor(h)}h` : `${Math.floor(h / 24)}d`;
}
const ageHours = (job) => { const t = Date.parse(job.posted || ""); return t ? (Date.now() - t) / 36e5 : 1e9; };

function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }
function restore(key, d) { try { return JSON.parse(localStorage.getItem(key) || "null") ?? d; } catch { return d; } }

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function Ring({ score, big }) {
  return html`<div class=${"ring" + (big ? " big" : "")} style=${`--p:${score};--c:${scoreColor(score)}`} aria-label=${`Match score ${score} of 100`}><span>${score}</span></div>`;
}

// ------------------------------------------------------------------ app

function App() {
  const [ready, setReady] = useState(gh.connected());
  const [route, setRoute] = useState(restore("jr.route", "jobs"));
  const [file, setFile] = useState(restore("jr.jobs", null));
  const [resume, setResume] = useState(restore("jr.resume", null));
  const [search, setSearch] = useState(null);
  const [report, setReport] = useState(null);
  const [base, setBase] = useState(null);
  const [statuses, setStatuses] = useState(restore("jr.status", {}));
  const [sel, setSel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [adding, setAdding] = useState(false);
  const saveTimer = useRef(null);

  const say = useCallback((msg) => { setToast(msg); setTimeout(() => setToast((t) => (t === msg ? null : t)), 6000); }, []);
  useEffect(() => store("jr.route", route), [route]);

  const refresh = useCallback(async () => {
    if (!gh.connected()) return;
    setLoading(true);
    try {
      const [f, r] = await Promise.all([gh.json("data/jobs.json").catch((e) => { if (e.status === 404) return { jobs: [], setup_needed: true }; throw e; }),
        gh.json("profile/resume.json").catch(() => null)]);
      setFile(f); store("jr.jobs", f);
      setResume(r); store("jr.resume", r);
      gh.json("profile/search.json").then(setSearch).catch(() => {});
      gh.json("data/report.json").then(setReport).catch(() => {});
      gh.json("data/resumes/base.json").then(setBase).catch(() => {});
      gh.json("user/state.json").then((st) => {
        // merge: newest change per job wins, so phone and browser stay in step
        setStatuses((local) => {
          const out = { ...(st.statuses || {}) };
          for (const [k, v] of Object.entries(local)) if (!out[k] || (v.at || 0) > (out[k].at || 0)) out[k] = v;
          store("jr.status", out);
          return out;
        });
      }).catch(() => {});
    } catch (e) { say(e.message); }
    setLoading(false);
  }, [say]);
  useEffect(() => { if (ready) refresh(); }, [ready]);

  const setStatus = useCallback((id, status, note) => {
    setStatuses((prev) => {
      const old = prev[id];
      const next = { ...prev };
      if (status === null) delete next[id];
      else next[id] = {
        status, at: old?.status === status ? old.at : Date.now(), note: note ?? old?.note ?? "",
        history: [...(old?.history || []), `${new Date().toISOString().slice(0, 10)} ${LABEL[status] || status}`].slice(-12),
      };
      store("jr.status", next);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => gh.putText("user/state.json", JSON.stringify({ statuses: next }, null, 1), "Update application tracker").catch(() => {}), 3000);
      return next;
    });
  }, []);

  if (!ready) return html`<${Setup} onDone=${() => { setReady(true); setRoute("jobs"); }} say=${say} />`;

  const name = resume?.contact?.name;
  const title = name ? `${name}'s Job Radar` : "Job Radar";
  document.title = title;
  const needsResume = !resume || !(resume.experience || []).length;
  const jobs = file?.jobs || [];
  const job = sel && jobs.find((j) => j.id === sel);
  const ctx = { file, jobs, resume, search, report, base, statuses, setStatus, say, refresh, loading, setRoute, setSel, setResume, setSearch, title };

  const counts = {
    inbox: jobs.filter((j) => !statuses[j.id]).length,
    saved: jobs.filter((j) => statuses[j.id]?.status === "saved").length,
    applied: jobs.filter((j) => PIPE.includes(statuses[j.id]?.status)).length,
  };

  const nav = [["jobs", "Jobs", counts.inbox], ["boards", "Job boards"], ["profile", "My profile"], ["search", "Search preferences"], ["settings", "Settings"]];
  const go = (r) => { setRoute(r); if (r !== "jobs") setSel(null); };

  let main;
  if (needsResume && route !== "settings") main = html`<${Onboard} ...${ctx} />`;
  else if (route === "jobs") main = job ? html`<${Detail} key=${job.id} job=${job} ...${ctx} />` : html`<div class="page empty">Pick a job on the left to see why it matched, review your tailored resume and apply.</div>`;
  else if (route === "boards") main = html`<${Boards} ...${ctx} />`;
  else if (route === "profile") main = html`<${ProfileEditor} ...${ctx} />`;
  else if (route === "search") main = html`<${SearchEditor} ...${ctx} />`;
  else main = html`<${Settings} ...${ctx} onDisconnect=${() => { gh.forget(); setReady(false); }} />`;

  const showList = route === "jobs" && !needsResume;
  return html`
    <div class=${"shell" + (job && route === "jobs" ? " has-detail" : "")} style=${showList ? "" : "grid-template-columns: 232px 1fr"}>
      <nav class="rail" aria-label="Main">
        <div class="brand"><img src="icon.svg" alt="" /><div><b>${title}</b><small>${file?.updated ? "Searched " + age({ posted: file.updated }) + " ago" : "Your job search"}</small></div></div>
        ${nav.map(([r, label, n]) => html`<button class="nav" aria-current=${route === r ? "page" : null} onClick=${() => go(r)}>${label}${n != null ? html`<span class="count">${n}</span>` : null}</button>`)}
        <div class="sep"></div>
        <button class="nav" onClick=${() => setAdding(true)}>Add a job</button>
        <button class="nav" onClick=${refresh}>${loading ? "Refreshing…" : "Refresh"}</button>
        <div class="foot">${gh.conn.owner}/${gh.conn.repo}</div>
      </nav>
      ${showList ? html`<${JobList} ...${ctx} sel=${sel} counts=${counts} onAdd=${() => setAdding(true)} />` : null}
      <main class=${"mainpane" + (route === "jobs" ? " for-jobs" : "")}>${main}</main>
      <nav class="mobilebar" aria-label="Main">
        ${[["jobs", "Jobs"], ["boards", "Boards"], ["profile", "Profile"], ["settings", "Settings"]].map(([r, l]) =>
          html`<button aria-current=${route === r ? "page" : null} onClick=${() => go(r)}>${l}</button>`)}
      </nav>
      ${adding ? html`<${AddJob} say=${say} onClose=${() => setAdding(false)} />` : null}
      ${toast ? html`<div class="toast" role="status">${toast}</div>` : null}
    </div>`;
}

// ------------------------------------------------------------------ first run: connect or create

function Setup({ onDone, say }) {
  const [mode, setMode] = useState("new");
  const [token, setToken] = useState("");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("job-radar");
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    try {
      const me = await gh.whoAmI(token);
      gh.saveConn({ owner: owner || me.login, repo, token });
      await gh.text("profile/search.json");
      onDone();
    } catch (e) { say(e.message); }
    setBusy(false);
  }
  async function create() {
    setBusy(true);
    try {
      const me = await gh.whoAmI(token);
      await gh.createFromTemplate(token, me.login, repo);
      gh.saveConn({ owner: me.login, repo, token });
      say("Your Job Radar is ready. Next: upload your resume.");
      setTimeout(onDone, 2500); // GitHub needs a moment to copy the files
    } catch (e) { say(e.message); }
    setBusy(false);
  }

  return html`<div class="setup">
    <img src="icon.svg" width="52" height="52" alt="" />
    <h1>Job Radar finds jobs that fit your resume and writes a tailored version for each one.</h1>
    <p class="hint">It runs on your own free GitHub account: a private copy searches every 4 hours and keeps your data to yourself. No AI subscription needed; add your Claude plan later for AI-written resumes.</p>
    <div class="chips" role="tablist">
      <button class="chip" aria-pressed=${mode === "new"} onClick=${() => setMode("new")}>I'm new</button>
      <button class="chip" aria-pressed=${mode === "have"} onClick=${() => setMode("have")}>I already have a Job Radar repo</button>
    </div>
    <div class="card">
      ${mode === "new" ? html`
        <h3>Create your Job Radar</h3>
        <ol class="steps">
          <li>Sign in to <a href="https://github.com/signup" target="_blank" rel="noopener">GitHub</a> (free).</li>
          <li>Create a token at <a href="https://github.com/settings/tokens/new?scopes=repo,workflow&description=Job%20Radar" target="_blank" rel="noopener">github.com/settings/tokens/new</a> with the <code>repo</code> and <code>workflow</code> boxes ticked, then copy it.</li>
          <li>Paste it below. This creates a private repo called <code>${repo}</code> in your account.</li>
        </ol>` : html`
        <h3>Connect your Job Radar</h3>
        <p class="hint">Use a fine-grained token limited to your Job Radar repo with Contents: Read and write and Actions: Read and write.</p>
        <div class="field"><label for="own">GitHub account (blank = the token's account)</label><input id="own" class="input" value=${owner} onInput=${(e) => setOwner(e.target.value.trim())} /></div>`}
      <div class="field"><label for="rep">Repository name</label><input id="rep" class="input" value=${repo} onInput=${(e) => setRepo(e.target.value.trim())} /></div>
      <div class="field"><label for="tok">GitHub token</label><input id="tok" class="input" type="password" autocomplete="off" value=${token} onInput=${(e) => setToken(e.target.value.trim())} /></div>
      <div class="row"><button class="btn primary" disabled=${busy || !token} onClick=${mode === "new" ? create : connect}>${busy ? "Working…" : mode === "new" ? "Create my Job Radar" : "Connect"}</button>
      <span class="hint">Your token stays in this browser.</span></div>
    </div>
  </div>`;
}

function Onboard({ resume, say, refresh, file }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  async function upload(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/\.(pdf|docx|txt)$/i.test(f.name)) { say("Use a PDF, Word (.docx) or text file."); return; }
    setBusy(true);
    try {
      const ext = f.name.split(".").pop().toLowerCase();
      await gh.putBase64(`uploads/resume.${ext}`, await gh.fileToBase64(f), "app: upload resume");
      await gh.request("import_resume", { path: `uploads/resume.${ext}`, reset_search: true });
      setSent(true);
    } catch (err) { say(err.message); }
    setBusy(false);
  }
  return html`<div class="page form">
    <h2>Start with your resume</h2>
    <p class="hint">Job Radar reads it once to build your profile and your search: job titles to look for, your city, your skills. You can fix anything afterwards in My profile.</p>
    ${file?.note ? html`<p class="hint">${file.note}</p>` : null}
    <div class="card">
      ${sent ? html`<h3>Reading your resume</h3><p>This takes 2–4 minutes. Your first job search starts right after, and results arrive about 10 minutes later.</p>
        <button class="btn primary" onClick=${refresh}>Check now</button>` : html`
        <h3>Upload your resume</h3>
        <input type="file" accept=".pdf,.docx,.txt" onChange=${upload} disabled=${busy} />
        <p class="hint">${busy ? "Uploading…" : "PDF or Word. The file is deleted after it's read."}</p>`}
    </div>
  </div>`;
}

// ------------------------------------------------------------------ job list

function JobList({ jobs, statuses, sel, setSel, counts, onAdd, file, loading, refresh, search }) {
  const [tab, setTab] = useState(restore("jr.tab", "inbox"));
  const [q, setQ] = useState("");
  const [where, setWhere] = useState(restore("jr.where", ""));
  const [f, setF] = useState(restore("jr.filters", { remote: false, ready: false, newest: false, home: false }));
  useEffect(() => store("jr.tab", tab), [tab]);
  useEffect(() => store("jr.filters", f), [f]);
  useEffect(() => store("jr.where", where), [where]);
  const st = (j) => statuses[j.id]?.status;
  const home = (search?.locations?.country || "CA");

  let list = jobs.filter((j) => (tab === "inbox" ? !st(j) : tab === "saved" ? st(j) === "saved" : PIPE.includes(st(j))));
  if (f.remote) list = list.filter((j) => j.remote);
  if (f.home) list = list.filter((j) => j.country === home);
  if (f.ready) list = list.filter((j) => j.resume_pdf);
  if (where.trim()) { const w = where.trim().toLowerCase(); list = list.filter((j) => (j.location || "").toLowerCase().includes(w) || (w === "remote" && j.remote)); }
  if (q.trim()) { const s = q.trim().toLowerCase(); list = list.filter((j) => `${j.title} ${j.company}`.toLowerCase().includes(s)); }
  list = tab === "applied" ? list.sort((a, b) => (statuses[b.id]?.at || 0) - (statuses[a.id]?.at || 0))
    : f.newest ? list.sort((a, b) => ageHours(a) - ageHours(b)) : list.sort((a, b) => (b.manual - a.manual) || b.score - a.score);
  const toggle = (k) => setF({ ...f, [k]: !f[k] });
  const newIds = new Set(jobs.filter((j) => j.first_seen === file?.updated).map((j) => j.id));

  return html`<section class="listpane" aria-label="Jobs">
    <div class="listhead">
      <div class="row"><h1>Jobs</h1><span class="spacer"></span>
        <button class="btn small" onClick=${onAdd}>Add a job</button>
        <button class="btn small" onClick=${refresh}>${loading ? "…" : "Refresh"}</button></div>
      <div class="sub">${jobs.length} matches${file?.new_this_run ? `, ${file.new_this_run} new in the last search` : ""}</div>
      <div class="search">
        <input aria-label="Search title or company" placeholder="Title or company" value=${q} onInput=${(e) => setQ(e.target.value)} />
        <input aria-label="Location" placeholder="City, province or Remote" value=${where} onInput=${(e) => setWhere(e.target.value)} />
      </div>
      <div class="chips">
        <button class="chip" aria-pressed=${f.home} onClick=${() => toggle("home")}>${home === "US" ? "US" : "Canada"}</button>
        <button class="chip" aria-pressed=${f.remote} onClick=${() => toggle("remote")}>Remote</button>
        <button class="chip" aria-pressed=${f.ready} onClick=${() => toggle("ready")}>Resume ready</button>
        <button class="chip" aria-pressed=${f.newest} onClick=${() => toggle("newest")}>${f.newest ? "Newest first" : "Best match first"}</button>
      </div>
    </div>
    <div class="tabs" role="tablist">
      ${[["inbox", "Inbox", counts.inbox], ["saved", "Saved", counts.saved], ["applied", "Applied", counts.applied]].map(([k, l, n]) =>
        html`<button role="tab" aria-selected=${tab === k} onClick=${() => setTab(k)}>${l} (${n})</button>`)}
    </div>
    ${tab === "applied" ? html`<${Stats} statuses=${statuses} />` : null}
    <div class="joblist">
      ${list.length === 0 ? html`<div class="empty">${jobs.length === 0 ? "No jobs yet. The search runs every 4 hours; tap Refresh after it finishes." : tab === "applied" ? "Jobs you apply to show up here so you can track interviews and offers." : "Nothing matches these filters."}</div>` :
        list.map((j) => html`<button class="jobrow" aria-current=${sel === j.id ? "true" : null} onClick=${() => setSel(j.id)}>
          <${Ring} score=${j.score} />
          <div>
            <div class="t">${j.title}</div>
            <div class="m">${j.company}${j.location ? `, ${j.location}` : ""}</div>
            <div class="tags">
              ${PIPE.includes(st(j)) ? html`<span class=${"tag st-" + st(j)}>${LABEL[st(j)]}</span>` : null}
              ${newIds.has(j.id) ? html`<span class="tag new">New</span>` : null}
              ${j.manual ? html`<span class="tag">Added by you</span>` : null}
              ${j.resume_pdf ? html`<span class="tag ready">${j.tailor_method === "claude" ? "AI resume" : j.tailor_method === "edited" ? "Your edits" : "Resume ready"}</span>` : null}
              ${j.remote ? html`<span class="tag">Remote</span>` : null}
              ${j.salary ? html`<span class="tag">${j.salary}</span>` : null}
            </div>
          </div>
          <span class="age">${age(j)}</span>
        </button>`)}
    </div>
  </section>`;
}

function Stats({ statuses }) {
  const v = Object.values(statuses);
  const applied = v.filter((e) => PIPE.includes(e.status)).length;
  const week = v.filter((e) => PIPE.includes(e.status) && e.at > Date.now() - 7 * 864e5).length;
  const inter = v.filter((e) => e.status === "interview" || e.status === "offer").length;
  const offers = v.filter((e) => e.status === "offer").length;
  return html`<div class="hint" style="padding:10px 16px;border-bottom:1px solid var(--line)">
    <b>${applied}</b> applied, <b>${week}</b> this week, <b>${inter}</b> interviews (${applied ? Math.round(100 * inter / applied) : 0}%), <b>${offers}</b> offers</div>`;
}

// ------------------------------------------------------------------ job detail + review & edit

function Detail({ job, resume, base, statuses, setStatus, say, setSel }) {
  const entry = statuses[job.id];
  const [tailored, setTailored] = useState(null);
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(entry?.note || "");
  const [busy, setBusy] = useState(false);
  const [showDesc, setShowDesc] = useState(false);
  const [prep, setPrep] = useState(null);

  useEffect(() => {
    let live = true;
    const path = job.resume_pdf ? `data/resumes/${job.id}.json` : null;
    (path ? gh.json(path) : Promise.reject()).catch(() => base ? clone(base) : null).then((t) => {
      if (!live || !t) return;
      if (!job.resume_pdf && job.cover_letter) t.cover_letter = job.cover_letter;
      setTailored(t); setDraft(clone(t));
    });
    return () => { live = false; };
  }, [job.id, job.resume_pdf, base]);

  const dirty = draft && tailored && JSON.stringify(draft) !== JSON.stringify(tailored);

  async function saveEdits() {
    await gh.request("edit", { job_id: job.id, tailored: draft });
    setTailored(clone(draft));
  }
  function downloadPdf() {
    if (!draft || !resume) return;
    resumePdf(draft, resume).save(fileName(resume, job));
  }
  async function applyNow() {
    if (!draft || !resume) { window.open(job.apply_url || job.url, "_blank", "noopener"); return; }
    setBusy(true);
    try {
      downloadPdf();
      const copied = draft.cover_letter ? await copy(draft.cover_letter) : false;
      window.open(job.apply_url || job.url, "_blank", "noopener");
      setStatus(job.id, "applied");
      if (dirty) await saveEdits();
      say(`Resume downloaded${copied ? ", cover letter copied" : ""}. Attach it on the application page${dirty ? "; your edits are saved too" : ""}.`);
    } catch (e) { say(e.message); }
    setBusy(false);
  }
  async function request(type, extra, msg) {
    try { await gh.request(type, { job_id: job.id, ...extra }); say(msg); } catch (e) { say(e.message); }
  }
  async function openPrep() {
    try { setPrep(await gh.text(job.prep)); } catch (e) { say(e.message); }
  }

  const st = entry?.status;
  return html`<div class="page">
    <button class="back" onClick=${() => setSel(null)}>Back to jobs</button>
    <div class="dhead"><${Ring} score=${job.score} big />
      <div><h2>${job.title}</h2>
        <div class="co">${job.company}${job.location ? `, ${job.location}` : ""}</div>
        <div class="hint">${[job.salary, age(job) && `posted ${age(job)} ago`, `via ${job.source}${job.also_on?.length ? " and " + job.also_on.join(", ") : ""}`].filter(Boolean).join(", ")}</div>
      </div></div>

    <div class="actions">
      <button class="btn primary big" disabled=${busy} onClick=${applyNow}>${busy ? "Preparing…" : "Apply now"}</button>
      <button class="btn" onClick=${() => setEditing(!editing)}>${editing ? "Done editing" : "Edit resume and cover letter"}</button>
      <button class="btn" onClick=${downloadPdf}>Download PDF</button>
      <a class="btn" href=${job.url || job.apply_url} target="_blank" rel="noopener">Open posting</a>
    </div>
    <p class="hint">Apply now downloads this resume${dirty ? " with your edits" : ""}, copies the cover letter and opens the application. With the Chrome extension, the form fills itself; you check it and submit.</p>

    <div class="block"><h3>Status</h3>
      <div class="statusrow">${["saved", "applied", "interview", "offer", "rejected", "hidden"].map((s) =>
        html`<button class="chip" aria-pressed=${st === s} onClick=${() => setStatus(job.id, st === s ? null : s)}>${LABEL[s]}</button>`)}</div>
      ${entry?.history?.length ? html`<p class="hint">${entry.history.join(", then ")}</p>` : null}
      <textarea class="input" rows="2" placeholder="Notes: recruiter, salary, next step" value=${note} onInput=${(e) => setNote(e.target.value)}></textarea>
      ${note !== (entry?.note || "") ? html`<button class="btn small" onClick=${() => setStatus(job.id, st || "saved", note)}>Save note</button>` : null}
    </div>

    <div class="block"><h3>Your resume for this job</h3>
      ${!draft ? html`<p class="hint">Loading…</p>` : editing
        ? html`<${ReviewEdit} draft=${draft} setDraft=${setDraft} resume=${resume} />`
        : html`<${ReviewDiff} base=${base} t=${draft} resume=${resume} />`}
      <div class="row" style="margin-top:10px">
        ${dirty ? html`<button class="btn primary small" onClick=${() => saveEdits().then(() => say("Edits saved. Your phone and the Chrome extension get the same version in about a minute.")).catch((e) => say(e.message))}>Save edits</button>
          <button class="btn small" onClick=${() => setDraft(clone(tailored))}>Undo edits</button>` : null}
        <button class="btn small" onClick=${() => request("retailor", {}, "Re-writing this resume. It'll be ready in about 3 minutes.")}>${job.resume_pdf ? "Re-write from scratch" : "Tailor now"}</button>
        <span class="hint">${job.tailor_method === "claude" ? "Written by AI from your profile." : job.tailor_method === "edited" ? "Includes your edits." : "Picked by keyword match. Add your Claude plan in Settings for AI rewriting."}</span>
      </div>
    </div>

    <div class="block"><h3>Why it matched</h3>
      <ul class="reasons">${(job.reasons || []).map((r) => html`<li>${r}</li>`)}</ul>
      ${job.fit_notes ? html`<p>${job.fit_notes}</p>` : null}
      ${(job.keywords_matched?.length || job.keywords_missing?.length) ? html`<p>
        ${(job.keywords_matched || []).map((k) => html`<span class="kw">✓ ${k}</span>`)}
        ${(job.keywords_missing || []).map((k) => html`<span class="kw miss">✗ ${k}</span>`)}</p>
        ${job.keywords_missing?.length ? html`<p class="hint">✗ means the posting asks for it and your profile doesn't mention it. If you have it, add it in My profile.</p>` : null}` : null}
    </div>

    <div class="block"><h3>Interview prep</h3>
      ${prep ? html`<div class="md card" dangerouslySetInnerHTML=${{ __html: md(prep) }}></div>` : html`
        <p class="hint">Likely questions with answers from your real experience, gaps to prepare for and questions to ask them.</p>`}
      <div class="row">
        ${job.prep && !prep ? html`<button class="btn small" onClick=${openPrep}>Open prep sheet</button>` : null}
        <button class="btn small" onClick=${() => { request("prep", {}, "Writing your prep sheet. Ready in about 3 minutes."); if (!PIPE.includes(st)) setStatus(job.id, "interview"); }}>${job.prep ? "Write again" : "Prepare me"}</button>
      </div>
    </div>

    <div class="block"><h3>Job description</h3>
      <div class="desc">${showDesc || (job.description || "").length < 900 ? job.description || "This source didn't include a description. Open the posting to read it." : job.description.slice(0, 900) + "…"}</div>
      ${(job.description || "").length >= 900 ? html`<button class="btn small" onClick=${() => setShowDesc(!showDesc)}>${showDesc ? "Show less" : "Show all"}</button>` : null}
    </div>
  </div>`;
}

/** Standard resume vs. this job's version, with what changed highlighted. */
function ReviewDiff({ base, t, resume }) {
  if (!resume) return null;
  if (!base) return html`<div class="review" style="grid-template-columns:1fr"><div class="col tailored"><div class="colhead">For this job</div>
    <div class="rv-sec"><h4>Headline</h4><p>${t.headline}</p></div><div class="rv-sec"><h4>Summary</h4><p>${t.summary}</p></div>
    <div class="rv-sec"><h4>Skills</h4><p>${(t.skills || []).join(", ")}</p></div>
    ${(t.experience || []).map((e) => { const r = (resume.experience || []).find((x) => x.id === e.id); return r ? html`<div class="rv-sec"><div class="role-title">${r.title}, ${r.company}</div><ul class="bullets">${e.bullets.map((b) => html`<li>${b}</li>`)}</ul></div>` : null; })}
    <div class="rv-sec"><h4>Cover letter</h4><p style="white-space:pre-wrap">${t.cover_letter}</p></div>
    <p class="hint">The side-by-side comparison appears after the next search finishes.</p></div></div>`;
  const roles = Object.fromEntries((resume.experience || []).map((e) => [e.id, e]));
  const baseExp = Object.fromEntries((base?.experience || []).map((e) => [e.id, e.bullets]));
  const baseSkills = new Set(base?.skills || []);
  const tSkills = new Set(t.skills || []);
  const isOriginal = (role, b) => role && (role.core.includes(b) || role.flex.some((f) => f.text === b));
  return html`<div class="review">
    <div class="col"><div class="colhead">Your standard resume</div>
      <div class="rv-sec"><h4>Headline</h4><p>${base?.headline}</p></div>
      <div class="rv-sec"><h4>Summary</h4><p>${base?.summary}</p></div>
      <div class="rv-sec"><h4>Skills</h4><p>${(base?.skills || []).map((s, i) => html`${i ? ", " : ""}<span class=${tSkills.has(s) ? "" : "dropped"}>${s}</span>`)}</p></div>
      ${(t.experience || []).map((e) => html`<div class="rv-sec"><div class="role-title">${roles[e.id]?.title}, ${roles[e.id]?.company}</div>
        <ul class="bullets">${(baseExp[e.id] || []).map((b) => html`<li class=${e.bullets.includes(b) ? "" : "dropped"}>${b}</li>`)}</ul></div>`)}
    </div>
    <div class="col tailored"><div class="colhead">For this job</div>
      <div class="rv-sec"><h4>Headline</h4><p><span class=${t.headline !== base?.headline ? "changed" : ""}>${t.headline}</span></p></div>
      <div class="rv-sec"><h4>Summary</h4><p><span class=${t.summary !== base?.summary ? "changed" : ""}>${t.summary}</span></p></div>
      <div class="rv-sec"><h4>Skills</h4><p>${(t.skills || []).map((s, i) => html`${i ? ", " : ""}<span class=${baseSkills.has(s) ? "" : "added"}>${s}</span>`)}</p></div>
      ${(t.experience || []).map((e) => html`<div class="rv-sec"><div class="role-title">${roles[e.id]?.title}, ${roles[e.id]?.company}</div>
        <ul class="bullets">${e.bullets.map((b) => {
          const cls = !isOriginal(roles[e.id], b) ? "changed" : (baseExp[e.id] || []).includes(b) ? "" : "added";
          return html`<li><span class=${cls}>${b}</span></li>`;
        })}</ul></div>`)}
      <div class="rv-sec"><h4>Cover letter</h4><p style="white-space:pre-wrap">${t.cover_letter}</p></div>
    </div>
  </div>
  <div class="legend"><span><span class="added">green</span> added for this job</span><span><span class="changed">amber</span> reworded</span><span><span class="dropped">struck</span> left out this time</span></div>`;
}

function ReviewEdit({ draft, setDraft, resume }) {
  const roles = Object.fromEntries((resume?.experience || []).map((e) => [e.id, e]));
  const set = (k, v) => setDraft({ ...draft, [k]: v });
  const setBullets = (rid, bullets) => set("experience", draft.experience.map((e) => (e.id === rid ? { ...e, bullets } : e)));
  return html`<div class="card">
    <div class="field"><label>Headline</label><input class="input" value=${draft.headline} onInput=${(e) => set("headline", e.target.value)} /></div>
    <div class="field"><label>Summary</label><textarea class="input" rows="4" value=${draft.summary} onInput=${(e) => set("summary", e.target.value)}></textarea></div>
    <div class="field"><label>Skills (comma separated, most relevant first)</label><textarea class="input" rows="3" value=${(draft.skills || []).join(", ")} onInput=${(e) => set("skills", commas(e.target.value))}></textarea></div>
    ${(draft.experience || []).map((e) => {
      const r = roles[e.id]; if (!r) return null;
      const unused = r.flex.map((f) => f.text).filter((t) => !e.bullets.includes(t));
      return html`<div class="field"><label>${r.title}, ${r.company}</label>
        ${e.bullets.map((b, i) => html`<div class="edit-bullet">
          <textarea class="input" value=${b} onInput=${(ev) => { const n = [...e.bullets]; n[i] = ev.target.value; setBullets(e.id, n); }}></textarea>
          <button class="btn small" aria-label="Remove bullet" onClick=${() => setBullets(e.id, e.bullets.filter((_, k) => k !== i))}>Remove</button></div>`)}
        ${unused.length ? html`<select class="input" onChange=${(ev) => { if (ev.target.value) setBullets(e.id, [...e.bullets, ev.target.value]); ev.target.value = ""; }}>
          <option value="">Add another bullet from your profile…</option>${unused.map((t) => html`<option value=${t}>${t.slice(0, 110)}</option>`)}</select>` : null}
      </div>`;
    })}
    <div class="field"><label>Cover letter</label><textarea class="input" rows="12" value=${draft.cover_letter} onInput=${(e) => set("cover_letter", e.target.value)}></textarea></div>
  </div>`;
}

function md(src) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let out = "", inList = false;
  for (const raw of src.split("\n")) {
    const l = esc(raw.trimEnd()).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    const li = /^\s*[-*] (.*)/.exec(l);
    if (li) { if (!inList) { out += "<ul>"; inList = true; } out += `<li>${li[1]}</li>`; continue; }
    if (inList) { out += "</ul>"; inList = false; }
    if (l.startsWith("### ")) out += `<h3>${l.slice(4)}</h3>`;
    else if (l.startsWith("## ")) out += `<h2>${l.slice(3)}</h2>`;
    else if (l.startsWith("# ")) out += `<h1>${l.slice(2)}</h1>`;
    else if (l.trim()) out += `<p>${l}</p>`;
  }
  return out + (inList ? "</ul>" : "");
}

// ------------------------------------------------------------------ add a job

function AddJob({ say, onClose }) {
  const [v, setV] = useState({ url: "", title: "", company: "", description: "" });
  const [busy, setBusy] = useState(false);
  const ok = /^https?:\/\//.test(v.url) || v.description.length > 100;
  async function go() {
    setBusy(true);
    try { await gh.request("add_job", v); say("Added. Your tailored resume and cover letter will be ready in about 3–5 minutes."); onClose(); }
    catch (e) { say(e.message); }
    setBusy(false);
  }
  const f = (k, label, area) => html`<div class="field"><label for=${"aj-" + k}>${label}</label>${area
    ? html`<textarea id=${"aj-" + k} class="input" rows="5" value=${v[k]} onInput=${(e) => setV({ ...v, [k]: e.target.value })}></textarea>`
    : html`<input id=${"aj-" + k} class="input" value=${v[k]} onInput=${(e) => setV({ ...v, [k]: e.target.value })} />`}</div>`;
  return html`<div class="modal" role="dialog" aria-modal="true" aria-label="Add a job" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="card"><h3>Add a job</h3>
      <p class="hint">Found a job on LinkedIn, Indeed or a company site? Paste the link. Job Radar reads the posting, scores it and writes your tailored resume and cover letter.</p>
      ${f("url", "Job link")}${f("title", "Title (optional)")}${f("company", "Company (optional)")}${f("description", "Job description (paste for the best result; needed for LinkedIn and Indeed)", true)}
      <div class="row"><button class="btn primary" disabled=${!ok || busy} onClick=${go}>${busy ? "Adding…" : "Add and tailor"}</button><button class="btn" onClick=${onClose}>Cancel</button></div>
    </div></div>`;
}

// ------------------------------------------------------------------ boards

function Boards({ search, resume }) {
  const country = search?.locations?.country || "CA";
  const [q, setQ] = useState(search?.queries?.[0] || "");
  const [l, setL] = useState(search?.locations?.search_locations?.[0]?.place || resume?.contact?.location || "");
  return html`<div class="page">
    <h2>Job boards</h2>
    <p class="hint">Each link opens the site already searched. Found something good there? Use Add a job to get a tailored resume for it.</p>
    <div class="grid2"><div class="field"><label for="bq">Search for</label><input id="bq" class="input" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
      <div class="field"><label for="bl">Where</label><input id="bl" class="input" value=${l} onInput=${(e) => setL(e.target.value)} /></div></div>
    <div class="chips">${(search?.queries || []).slice(0, 8).map((x) => html`<button class="chip" aria-pressed=${q === x} onClick=${() => setQ(x)}>${x}</button>`)}</div>
    ${BOARD_GROUPS(country).map((g) => html`<div class="block"><h3>${g.title}</h3>${g.note ? html`<p class="hint">${g.note}</p>` : null}
      ${g.boards.map(([name, note, url]) => html`<a class="board" href=${url(q, l)} target="_blank" rel="noopener"><b>${name}</b>${note ? html`<small>${note}</small>` : null}</a>`)}</div>`)}
  </div>`;
}

// ------------------------------------------------------------------ profile editor

function ProfileEditor({ resume, setResume, say }) {
  const [d, setD] = useState(() => clone(resume || {}));
  const [busy, setBusy] = useState(false);
  const [up, setUp] = useState(false);
  useEffect(() => setD(clone(resume || {})), [resume]);
  if (!resume) return html`<div class="page">Loading your profile…</div>`;
  const set = (path, v) => { const n = clone(d); let o = n; for (const k of path.slice(0, -1)) o = o[k]; o[path[path.length - 1]] = v; setD(n); };
  const dirty = JSON.stringify(d) !== JSON.stringify(resume);

  async function save() {
    setBusy(true);
    try {
      const out = clone(d);
      out.experience = (out.experience || []).filter((e) => e.title || e.company).map((e, i) => ({
        ...e, id: e.id || ((e.company || "role").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16) + i),
        flex: (e.flex || []).map((f) => (typeof f === "string" ? { text: f, tags: [] } : f)),
      }));
      await gh.putText("profile/resume.json", JSON.stringify(out, null, 2) + "\n", "app: update profile");
      setResume(out); store("jr.resume", out);
      say("Profile saved. Every resume is being re-written with it (about 5 minutes).");
    } catch (e) { say(e.message); }
    setBusy(false);
  }
  async function reimport(e) {
    const f = e.target.files?.[0]; if (!f) return;
    setUp(true);
    try {
      const ext = f.name.split(".").pop().toLowerCase();
      await gh.putBase64(`uploads/resume.${ext}`, await gh.fileToBase64(f), "app: upload resume");
      await gh.request("import_resume", { path: `uploads/resume.${ext}`, reset_search: false });
      say("Reading your new resume. Refresh in about 3 minutes.");
    } catch (err) { say(err.message); }
    setUp(false);
  }
  const flexText = (e) => (e.flex || []).map((f) => (typeof f === "string" ? f : f.text)).join("\n");
  const fromFlexText = (e, txt) => {
    const old = Object.fromEntries((e.flex || []).map((f) => [f.text, f.tags || []]));
    return lines(txt).map((t) => ({ text: t, tags: old[t] || [] }));
  };

  return html`<div class="page form">
    <div class="row"><h2>My profile</h2><span class="spacer"></span>
      <button class="btn primary" disabled=${!dirty || busy} onClick=${save}>${busy ? "Saving…" : "Save profile"}</button></div>
    <p class="hint">This is the source for every resume. Companies, titles, dates, main bullets, education and certifications are never changed by tailoring. Only put numbers you can back up.</p>

    <div class="card"><h3>Replace from a resume file</h3>
      <input type="file" accept=".pdf,.docx,.txt" onChange=${reimport} disabled=${up} />
      <p class="hint">Re-reads a PDF or Word file and replaces this profile. Your saved jobs stay.</p></div>

    <div class="card"><h3>Contact</h3><div class="grid2">
      ${Object.keys(d.contact || {}).map((k) => html`<div class="field"><label>${k.replace(/_/g, " ")}</label>
        <input class="input" value=${d.contact[k]} onInput=${(e) => set(["contact", k], e.target.value)} /></div>`)}</div></div>

    <div class="card"><h3>Summary</h3>
      <div class="field"><label>Summary</label><textarea class="input" rows="5" value=${d.summary_base} onInput=${(e) => set(["summary_base"], e.target.value)}></textarea></div>
      <div class="field"><label>Your strongest facts, one per line (the cover letter and AI use these)</label>
        <textarea class="input" rows="6" value=${(d.summary_facts || []).join("\n")} onInput=${(e) => set(["summary_facts"], lines(e.target.value))}></textarea></div></div>

    <div class="card"><h3>Headlines</h3><p class="hint">One is picked per job, whichever fits the job title best.</p>
      ${Object.keys(d.headlines || {}).map((k) => html`<div class="field"><input class="input" value=${d.headlines[k]} onInput=${(e) => set(["headlines", k], e.target.value)} /></div>`)}
      <button class="btn small" onClick=${() => set(["headlines", "h" + Date.now()], "")}>Add a headline</button></div>

    <div class="card"><h3>Experience</h3>
      ${(d.experience || []).map((e, i) => html`<div class="card">
        <div class="row"><b>${e.company || "New role"}</b><span class="spacer"></span>
          ${i > 0 ? html`<button class="btn small" onClick=${() => { const x = clone(d.experience); [x[i - 1], x[i]] = [x[i], x[i - 1]]; set(["experience"], x); }}>Move up</button>` : null}
          <button class="btn small" onClick=${() => set(["experience"], d.experience.filter((_, k) => k !== i))}>Delete</button></div>
        <div class="grid2">
          ${["title", "company", "location", "start", "end"].map((k) => html`<div class="field"><label>${k}</label><input class="input" value=${e[k]} onInput=${(ev) => set(["experience", i, k], ev.target.value)} /></div>`)}
        </div>
        <div class="field"><label>Main bullets: always on every resume (one per line)</label>
          <textarea class="input" rows="4" value=${(e.core || []).join("\n")} onInput=${(ev) => set(["experience", i, "core"], lines(ev.target.value))}></textarea></div>
        <div class="field"><label>Optional bullets: the best ones are picked for each job (one per line)</label>
          <textarea class="input" rows="6" value=${flexText(e)} onInput=${(ev) => set(["experience", i, "flex"], fromFlexText(e, ev.target.value))}></textarea></div>
      </div>`)}
      <button class="btn small" onClick=${() => set(["experience"], [{ id: "", title: "", company: "", location: "", start: "", end: "Present", core: [], flex: [] }, ...(d.experience || [])])}>Add a role</button></div>

    <div class="card"><h3>Skills</h3><p class="hint">Comma separated, most important first.</p>
      ${Object.keys(d.skills || {}).map((g) => html`<div class="field"><label>${g}</label>
        <textarea class="input" rows="2" value=${(d.skills[g] || []).join(", ")} onInput=${(e) => set(["skills", g], commas(e.target.value))}></textarea></div>`)}
      <button class="btn small" onClick=${() => { const n = prompt("Name of the new skill group"); if (n) set(["skills", n], []); }}>Add a skill group</button></div>

    <div class="card"><h3>Projects</h3>
      ${(d.projects || []).map((p, i) => html`<div class="grid2">
        <div class="field"><label>Name</label><input class="input" value=${p.name} onInput=${(e) => set(["projects", i, "name"], e.target.value)} /></div>
        <div class="field"><label>Description</label><textarea class="input" rows="2" value=${p.text} onInput=${(e) => set(["projects", i, "text"], e.target.value)}></textarea></div></div>`)}
      <button class="btn small" onClick=${() => set(["projects"], [...(d.projects || []), { name: "", text: "", tags: [] }])}>Add a project</button></div>

    <div class="card"><h3>Certifications</h3>
      <textarea class="input" rows="5" value=${(d.certifications || []).join("\n")} onInput=${(e) => set(["certifications"], lines(e.target.value))}></textarea></div>

    <div class="card"><h3>Education</h3>
      ${(d.education || []).map((ed, i) => html`<div class="grid2">
        <div class="field"><label>Credential</label><input class="input" value=${ed.credential} onInput=${(e) => set(["education", i, "credential"], e.target.value)} /></div>
        <div class="field"><label>School and dates</label><input class="input" value=${[ed.school, ed.dates].filter(Boolean).join(" | ")}
          onInput=${(e) => { const [s, dt] = e.target.value.split("|").map((x) => x.trim()); set(["education", i], { ...ed, school: s || "", dates: dt || "" }); }} /></div></div>`)}
      <button class="btn small" onClick=${() => set(["education"], [...(d.education || []), { credential: "", school: "", dates: "" }])}>Add education</button></div>

    <div class="card"><h3>Application answers</h3><p class="hint">The Chrome extension uses these to fill forms.</p>
      <div class="grid2">${Object.keys(d.application_answers || {}).map((k) => html`<div class="field"><label>${k.replace(/_/g, " ")}</label>
        <input class="input" value=${d.application_answers[k]} onInput=${(e) => set(["application_answers", k], e.target.value)} /></div>`)}</div>
      <button class="btn small" onClick=${() => { const n = prompt("Question (e.g. notice_period)"); if (n) set(["application_answers", n.trim().replace(/\s+/g, "_").toLowerCase()], ""); }}>Add an answer</button></div>

    <div class="row"><button class="btn primary" disabled=${!dirty || busy} onClick=${save}>${busy ? "Saving…" : "Save profile"}</button></div>
  </div>`;
}

// ------------------------------------------------------------------ search preferences (incl. locations)

function withDefaults(search, resume) {
  const d = clone(search || {});
  d.locations = d.locations || {};
  if (!(d.locations.search_locations || []).length && resume?.contact?.location) d.locations.search_locations = [{ place: resume.contact.location, radius_km: 50 }];
  return d;
}

function SearchEditor({ search, setSearch, say, resume }) {
  const [d, setD] = useState(() => withDefaults(search, resume));
  const [busy, setBusy] = useState(false);
  useEffect(() => setD(withDefaults(search, resume)), [search]);
  if (!search) return html`<div class="page">Loading your search settings…</div>`;
  const L = d.locations || (d.locations = {});
  const set = (fn) => { const n = clone(d); fn(n); setD(n); };
  const dirty = JSON.stringify(d) !== JSON.stringify(withDefaults(search, resume)) || !(search.locations?.search_locations || []).length;
  const places = L.search_locations || [];

  async function save() {
    setBusy(true);
    try {
      await gh.putText("profile/search.json", JSON.stringify(d, null, 2) + "\n", "Search settings updated from app");
      setSearch(d);
      say("Saved. A new search is running; results in about 10–15 minutes.");
    } catch (e) { say(e.message); }
    setBusy(false);
  }
  const num = (k, label) => html`<div class="field"><label>${label}</label><input class="input" type="number" value=${d[k] ?? ""} onInput=${(e) => set((n) => { n[k] = +e.target.value || 0; })} /></div>`;

  return html`<div class="page form">
    <div class="row"><h2>Search preferences</h2><span class="spacer"></span>
      <button class="btn primary" disabled=${!dirty || busy} onClick=${save}>${busy ? "Saving…" : "Save and search"}</button></div>

    <div class="card"><h3>Where</h3>
      <div class="grid2">
        <div class="field"><label>Country you can work in</label>
          <select class="input" value=${L.country || "CA"} onChange=${(e) => set((n) => { n.locations.country = e.target.value; })}><option value="CA">Canada</option><option value="US">United States</option></select></div>
        <div class="field"><label>Which jobs</label>
          <select class="input" value=${L.mode || "country"} onChange=${(e) => set((n) => { n.locations.mode = e.target.value; })}>
            <option value="nearby">Only near my locations, plus remote</option><option value="country">Anywhere in the country (nearby ranks higher)</option></select></div>
      </div>
      <p class="hint">Locations to search around. Distance is measured from each place's centre.</p>
      ${places.map((p, i) => html`<div class="row" style="margin:6px 0">
        <input class="input" style="flex:2" aria-label="Place" value=${p.place} onInput=${(e) => set((n) => { n.locations.search_locations[i].place = e.target.value; })} />
        <input class="input" style="flex:1;max-width:120px" type="number" aria-label="Radius in km" value=${p.radius_km} onInput=${(e) => set((n) => { n.locations.search_locations[i].radius_km = +e.target.value || 25; })} /><span class="hint">km</span>
        <button class="btn small" onClick=${() => set((n) => { n.locations.search_locations.splice(i, 1); })}>Remove</button></div>`)}
      <button class="btn small" onClick=${() => set((n) => { n.locations.search_locations = [...(n.locations.search_locations || []), { place: "", radius_km: 50 }]; })}>Add a location</button>
      <div style="margin-top:12px">
        <label class="row"><input type="checkbox" checked=${(L.country || "CA") === "CA" ? L.include_us_remote !== false : L.include_ca_remote !== false}
          onChange=${(e) => set((n) => { if ((L.country || "CA") === "CA") n.locations.include_us_remote = e.target.checked; else n.locations.include_ca_remote = e.target.checked; })} />
          Include remote jobs from ${(L.country || "CA") === "CA" ? "the US" : "Canada"}</label>
        <label class="row"><input type="checkbox" checked=${!!L[(L.country || "CA") === "CA" ? "include_us_onsite" : "include_ca_onsite"]}
          onChange=${(e) => set((n) => { n.locations[(L.country || "CA") === "CA" ? "include_us_onsite" : "include_ca_onsite"] = e.target.checked; })} />
          Include on-site jobs there too (needs a work permit)</label>
      </div>
    </div>

    <div class="card"><h3>What</h3>
      <div class="field"><label>Job titles and phrases to search, one per line</label>
        <textarea class="input" rows="7" value=${(d.queries || []).join("\n")} onInput=${(e) => set((n) => { n.queries = lines(e.target.value); })}></textarea></div>
      <div class="field"><label>A job title must contain one of these words (blank = use the words from your search phrases)</label>
        <textarea class="input" rows="2" value=${(d.title_terms?.required || []).join(", ")} onInput=${(e) => set((n) => { n.title_terms = { ...(n.title_terms || {}), required: commas(e.target.value).map((x) => x.toLowerCase()) }; })}></textarea></div>
      <div class="field"><label>Skip titles containing</label>
        <textarea class="input" rows="2" value=${(d.exclude_title || []).join(", ")} onInput=${(e) => set((n) => { n.exclude_title = commas(e.target.value).map((x) => x.toLowerCase()); })}></textarea></div>
      <div class="field"><label>Skip these companies</label>
        <input class="input" value=${(d.exclude_company || []).join(", ")} onInput=${(e) => set((n) => { n.exclude_company = commas(e.target.value); })} /></div>
    </div>

    <div class="card"><h3>Filters</h3><div class="grid2">
      ${num("min_salary_cad", "Minimum salary (0 = any)")}${num("max_age_days", "Hide jobs older than (days)")}
      ${num("min_score_to_save", "Keep jobs scoring at least")}${num("min_score_to_tailor", "Tailor a resume when the score is at least")}
      ${num("min_score_for_ai", "Use AI when the score is at least")}${num("max_ai_per_day", "AI resumes per day at most")}
    </div></div>

    <div class="card"><h3>Companies to watch</h3>
      <p class="hint">One per line: the name in the company's careers link, e.g. jobs.lever.co/<b>name</b> or boards.greenhouse.io/<b>name</b>. Names that don't exist are skipped.</p>
      <textarea class="input" rows="7" value=${(d.ats_companies?.candidates || []).join("\n")} onInput=${(e) => set((n) => { n.ats_companies = { ...(n.ats_companies || {}), candidates: lines(e.target.value).map((x) => x.toLowerCase()) }; })}></textarea>
      <div class="field"><label>Workday career sites (full links, one per line)</label>
        <textarea class="input" rows="3" value=${(d.workday_sites?.urls || []).join("\n")} onInput=${(e) => set((n) => { n.workday_sites = { ...(n.workday_sites || {}), urls: lines(e.target.value) }; })}></textarea></div>
    </div>
    <div class="row"><button class="btn primary" disabled=${!dirty || busy} onClick=${save}>${busy ? "Saving…" : "Save and search"}</button></div>
  </div>`;
}

// ------------------------------------------------------------------ settings

function Settings({ report, say, onDisconnect, file }) {
  const [run, setRun] = useState(null);
  useEffect(() => { gh.lastRun().then(setRun); }, []);
  const repoUrl = `https://github.com/${gh.conn.owner}/${gh.conn.repo}`;
  async function searchNow() { try { await gh.runSearch(); say("Search started. New jobs arrive in about 10–15 minutes."); } catch (e) { say(e.message); } }
  const src = report?.sources || {};
  return html`<div class="page form">
    <h2>Settings</h2>
    <div class="card"><h3>Search</h3>
      <p>${run ? `Last run ${age({ posted: run.updated_at })} ago: ${run.conclusion || run.status}.` : ""} Runs every 4 hours by itself.</p>
      <div class="row"><button class="btn primary" onClick=${searchNow}>Run a search now</button>
        <a class="btn" href=${repoUrl + "/actions"} target="_blank" rel="noopener">See runs on GitHub</a></div></div>

    <div class="card"><h3>AI resumes and interview prep</h3>
      <p>${report?.ai_enabled ? "On." : "Off: resumes are tailored by keyword matching."} ${report?.ai_used_today != null ? `${report.ai_used_today} AI resumes today.` : ""}</p>
      <p><b>Use your Claude Pro or Max plan (no API bill):</b></p>
      <ol class="steps">
        <li>Install Claude Code on your computer: <a href="https://code.claude.com/docs/en/setup" target="_blank" rel="noopener">setup guide</a>.</li>
        <li>In a terminal run <code>claude setup-token</code> and approve in the browser. Copy the token it prints.</li>
        <li>Open <a href=${repoUrl + "/settings/secrets/actions/new"} target="_blank" rel="noopener">your repo's new secret page</a>, name it <code>CLAUDE_CODE_OAUTH_TOKEN</code> and paste the token.</li>
      </ol>
      <p class="hint">Or add <code>ANTHROPIC_API_KEY</code> instead to pay per use. The token is tied to your own plan, so each person uses their own.</p></div>

    <div class="card"><h3>More job sources (free keys)</h3>
      <ul class="reasons">
        <li><b>Adzuna</b>: sign up at <a href="https://developer.adzuna.com" target="_blank" rel="noopener">developer.adzuna.com</a>, add secrets <code>ADZUNA_APP_ID</code> and <code>ADZUNA_APP_KEY</code>.</li>
        <li><b>LinkedIn, Indeed, Glassdoor via Google for Jobs</b>: subscribe to JSearch's free plan on <a href="https://rapidapi.com" target="_blank" rel="noopener">rapidapi.com</a>, add secret <code>RAPIDAPI_KEY</code>.</li>
        <li><b>Jooble</b>: get a key at <a href="https://jooble.org/api/about" target="_blank" rel="noopener">jooble.org/api/about</a>, add secret <code>JOOBLE_KEY</code>.</li>
      </ul>
      <a class="btn small" href=${repoUrl + "/settings/secrets/actions"} target="_blank" rel="noopener">Open your repo secrets</a></div>

    ${report ? html`<div class="card"><h3>Last search</h3>
      <p>${report.raw} postings read, ${report.unique} kept, ${report.new} new, ${report.tailored_this_run} resumes written.</p>
      <div class="kv">${Object.entries(src).filter(([, v]) => typeof v !== "object").map(([k, v]) => html`<span>${k}</span><span class="hint">${String(v)}</span>`)}</div></div>` : null}

    <div class="card"><h3>Apps</h3>
      <ul class="reasons">
        <li><b>Chrome extension</b> (fills application forms): download <a href="https://github.com/akhileshr1122-ui/Job-radar-app/releases/latest/download/JobRadar-Chrome.zip">JobRadar-Chrome.zip</a>, unzip, open <code>chrome://extensions</code>, turn on Developer mode, click Load unpacked and pick the folder.</li>
        <li><b>Android app</b>: <a href="https://github.com/akhileshr1122-ui/Job-radar-app/releases/latest/download/JobRadar.apk">JobRadar.apk</a>.</li>
      </ul></div>

    <div class="card"><h3>Connection</h3><p>${gh.conn.owner}/${gh.conn.repo}</p>
      <div class="row"><button class="btn" onClick=${() => { const t = document.documentElement.dataset.theme; document.documentElement.dataset.theme = t === "dark" ? "light" : "dark"; }}>Switch light / dark</button>
      <button class="btn" onClick=${onDisconnect}>Disconnect this browser</button></div></div>
  </div>`;
}

const root = document.getElementById("app");
root.textContent = "";
render(html`<${App} />`, root);
