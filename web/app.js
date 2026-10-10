import { html, render, useState, useEffect, useMemo, useRef, useCallback } from "./vendor/preact-htm.js";
import gh from "./backend.js";
import { resumePdf, fileName } from "./pdf.js";
import { BOARD_GROUPS } from "./boards.js";
import { PIPE, LABEL, scoreColor, clone, lines, commas, age, ageHours, store, restore, copy, Ring, ago, nextRun, clock, RadarPulse } from "./ui.js";
import { Landing } from "./landing.js";
import { Home, Tracker, Documents, Insights, PlanPage, AdminPage } from "./pages.js";
import { Coverage, UsagePage } from "./dash.js";
import { planById } from "./plans.js";

// ------------------------------------------------------------------ app

function App() {
  const [ready, setReady] = useState(gh.connected());
  const [route, setRouteRaw] = useState(routeFromHash() || restore("jr.route", "home"));
  const [run, setRun] = useState(null);
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
  useEffect(() => {
    store("jr.route", route);
    if (location.hash.slice(1) !== route) history.replaceState(null, "", "#" + route);
  }, [route]);
  useEffect(() => {
    const on = () => { const r = routeFromHash(); if (r) { setRouteRaw(r); setSel(null); } };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  const setRoute = useCallback((r) => { setRouteRaw(r); if (r !== "jobs") setSel(null); scrollTo(0, 0); }, []);

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

  const searchNow = useCallback(async () => {
    try {
      const r = await gh.runSearch();
      say(`Search started. New jobs arrive in about ${gh.mode === "azure" ? "5–10" : "10–15"} minutes.${r?.left != null ? ` ${r.left} on-demand searches left today.` : ""}`);
      requested.current = Date.now();
      setRun({ state: "queued", status: "queued" });
    } catch (e) { say(e.message); }
  }, [say]);
  useEffect(() => { if (ready) gh.lastRun().then(setRun); }, [ready]);
  // while a search is queued or running: poll, show the radar, refresh the jobs when it finishes
  const isActive = (r) => !!r && (r.state === "queued" || r.state === "running" || r.status === "in_progress" || r.status === "queued");
  const active = isActive(run);
  const requested = useRef(0);
  useEffect(() => {
    if (!ready || !active) return;
    const t = setInterval(async () => {
      const r = await gh.lastRun();
      const fresh = r && Date.parse(r.created_at || r.queued || r.updated_at || 0) >= requested.current - 10000;
      if (isActive(r)) { setRun(r); return; }
      if (!fresh && Date.now() - requested.current < 180000) return; // the new run hasn't shown up yet
      setRun(r);
      refresh();
      say("Search finished. Your jobs are up to date.");
    }, 15000);
    return () => clearInterval(t);
  }, [ready, active]);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 60000); return () => clearInterval(t); }, []);

  if (!ready && gh.mode === "azure") return html`<${Landing} api=${gh} me=${gh.me} say=${say} />
    ${toast ? html`<div class="toast" role="status">${toast}</div>` : null}`;
  if (!ready) return html`<${Setup} onDone=${() => { setReady(true); setRoute("jobs"); }} say=${say} />
    ${toast ? html`<div class="toast" role="status">${toast}</div>` : null}`;

  const name = resume?.contact?.name;
  const title = name ? `${name}'s Job Radar` : "Job Radar";
  document.title = title;
  const needsResume = !resume || !(resume.experience || []).length;
  const jobs = file?.jobs || [];
  const job = sel && jobs.find((j) => j.id === sel);
  const openJob = (id) => { setSel(id); setRouteRaw("jobs"); scrollTo(0, 0); };
  const ctx = { file, jobs, resume, search, report, base, statuses, setStatus, say, refresh, loading, setRoute, setSel, setResume, setSearch, title, openJob, run,
    searchNow: gh.mode === "azure" ? searchNow : null };

  const counts = {
    inbox: jobs.filter((j) => !statuses[j.id]).length,
    saved: jobs.filter((j) => statuses[j.id]?.status === "saved").length,
    applied: jobs.filter((j) => PIPE.includes(statuses[j.id]?.status)).length,
  };
  const tabs = [["home", "Home"], ["jobs", "Jobs", counts.inbox], ["tracker", "Tracker"], ["resumes", "Resumes"], ["insights", "Insights"],
    ["coverage", "Coverage"], ["profile", "Profile"], ...(gh.mode === "azure" ? [["plan", "Plan"]] : []), ["settings", "Settings"],
    ...(gh.me?.admin ? [["usage", "Usage"], ["admin", "Admin"]] : [])];
  const current = route === "boards" ? "coverage" : tabs.some(([r]) => r === route) || route === "search" ? route : "home";

  let main;
  if (needsResume && !["settings", "plan", "admin"].includes(current)) main = html`<${Onboard} ...${ctx} />`;
  else if (current === "home") main = html`<${Home} ...${ctx} />`;
  else if (current === "jobs") main = html`<div class=${"jobsview" + (job ? " has-detail" : "")}>
      <${JobList} ...${ctx} sel=${sel} counts=${counts} onAdd=${() => setAdding(true)} />
      <div class="detailpane">${job ? html`<${Detail} key=${job.id} job=${job} ...${ctx} />`
        : html`<div class="page empty">Pick a job to see why it matched, review your tailored resume and apply.</div>`}</div>
    </div>`;
  else if (current === "tracker") main = html`<${Tracker} ...${ctx} />`;
  else if (current === "resumes") main = html`<${Documents} ...${ctx} />`;
  else if (current === "insights") main = html`<${Insights} ...${ctx} />`;
  else if (current === "coverage") main = html`<${Coverage} ...${ctx} showBoards=${gh.mode !== "azure" || !!gh.me?.admin} BoardsView=${Boards} />`;
  else if (current === "usage") main = html`<${UsagePage} say=${say} />`;
  else if (current === "profile" || current === "search") main = html`<${ProfileTabs} sub=${current} ...${ctx} />`;
  else if (current === "plan") main = html`<${PlanPage} say=${say} />`;
  else if (current === "admin") main = html`<${AdminPage} say=${say} />`;
  else if (gh.mode === "azure") main = html`<${HostedSettings} ...${ctx} appSearch=${searchNow} />`;
  else main = html`<${Settings} ...${ctx} appSearch=${searchNow} onDisconnect=${() => { gh.forget(); setReady(false); }} />`;

  const next = nextRun(gh.mode === "azure" ? 15 : 17);
  const searched = active ? "Searching now…" : `${file?.updated ? `Searched ${ago(file.updated)}, ` : ""}next ${clock(next)}`;
  return html`<div class="app">
    <header class="appbar">
      <div class="appbar-top">
        <button class="wordmark" onClick=${() => setRoute("home")} aria-label="Home"><img src="icon.svg" alt="" width="28" height="28" />
          <span><b class="long">${title}</b><b class="short">${name ? `${name.split(" ")[0]}'s Job Radar` : "Job Radar"}</b><small>${searched}</small></span></button>
        <span class="spacer"></span>
        <button class="btn light small hide-s" onClick=${() => setAdding(true)}>Add a job</button>
        ${gh.mode === "azure" ? html`<button class="btn amber small" onClick=${searchNow}>Search now</button>`
          : html`<button class="btn light small" onClick=${refresh}>${loading ? "Refreshing…" : "Refresh"}</button>`}
        <${AccountMenu} setRoute=${setRoute} refresh=${refresh} loading=${loading} onAdd=${() => setAdding(true)} onDisconnect=${() => { gh.forget(); setReady(false); }} />
      </div>
      ${active ? html`<div class="searching" role="status"><${RadarPulse} size=${30} />
        <span><b>${run.state === "queued" || run.status === "queued" ? "Search starting" : "Searching job boards and company career pages"}</b>
          <small>New matches and tailored resumes appear here as soon as it finishes, usually 5–10 minutes.</small></span></div>` : null}
      <nav class="tabbar" aria-label="Sections">
        ${tabs.map(([r, label, n]) => html`<button class="tab" aria-current=${current === r || (r === "profile" && current === "search") ? "page" : null}
          onClick=${() => setRoute(r)}>${label}${n ? html`<span class="count">${n}</span>` : null}</button>`)}
      </nav>
    </header>
    <main class=${"appmain" + (current === "jobs" ? " for-jobs" : "")}>${main}</main>
    ${adding ? html`<${AddJob} say=${say} onClose=${() => setAdding(false)} />` : null}
    ${toast ? html`<div class="toast" role="status">${toast}</div>` : null}
  </div>`;
}

const ROUTES = ["home", "jobs", "tracker", "resumes", "insights", "boards", "coverage", "profile", "search", "plan", "settings", "usage", "admin"];
function routeFromHash() { const r = location.hash.slice(1); return ROUTES.includes(r) ? r : null; }

function AccountMenu({ setRoute, refresh, loading, onAdd, onDisconnect }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!e.target.closest?.(".acct")) setOpen(false); };
    addEventListener("click", close);
    return () => removeEventListener("click", close);
  }, [open]);
  const who = gh.mode === "azure" ? gh.me?.user || "" : `${gh.conn.owner}/${gh.conn.repo}`;
  const item = (label, fn) => html`<button role="menuitem" onClick=${() => { setOpen(false); fn(); }}>${label}</button>`;
  return html`<div class="acct">
    <button class="avatar" aria-haspopup="menu" aria-expanded=${open} aria-label="Account" onClick=${() => setOpen(!open)}>${(who[0] || "?").toUpperCase()}</button>
    ${open ? html`<div class="menu" role="menu">
      <div class="menu-who">${who}${gh.me?.plan ? html`<small>${planById(gh.me.plan).name} plan</small>` : null}</div>
      ${item("Add a job", onAdd)}
      ${item(loading ? "Refreshing…" : "Refresh", refresh)}
      ${gh.mode === "azure" ? item("Plan", () => setRoute("plan")) : null}
      ${item("Settings", () => setRoute("settings"))}
      ${item("Switch light / dark", () => { const t = document.documentElement.dataset.theme; document.documentElement.dataset.theme = t === "dark" ? "light" : "dark"; })}
      ${gh.mode === "azure" ? item("Sign out", gh.forget) : item("Disconnect this browser", onDisconnect)}
    </div>` : null}
  </div>`;
}

function ProfileTabs({ sub, setRoute, ...ctx }) {
  return html`<div>
    <div class="subtabs wrapw">
      <button class="chip" aria-pressed=${sub === "profile"} onClick=${() => setRoute("profile")}>My details</button>
      <button class="chip" aria-pressed=${sub === "search"} onClick=${() => setRoute("search")}>Search preferences</button>
    </div>
    ${sub === "search" ? html`<${SearchEditor} ...${ctx} />` : html`<${ProfileEditor} ...${ctx} />`}
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
      const exists = await fetch(`https://api.github.com/repos/${me.login}/${repo}`, { headers: { Authorization: `Bearer ${token}` } });
      if (exists.ok) {
        gh.saveConn({ owner: me.login, repo, token });
        say(`You already have ${me.login}/${repo}. Connected to it.`);
        setTimeout(onDone, 1200);
        setBusy(false);
        return;
      }
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
    ${gh.mode === "azure" && !sent ? html`<${ImportGitHub} say=${say} onDone=${() => setSent(true)} />` : null}
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
        <button class="chip" aria-pressed=${f.home} onClick=${() => toggle("home")}>${{ US: "US", AU: "Australia", IN: "India" }[home] || "Canada"}</button>
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
      ${list.length === 0 ? html`<div class="empty">${jobs.length === 0 ? "No jobs yet. Your first search takes 10–15 minutes after your resume is read; tap Refresh then. You can also start one from Settings → Run a search now." : tab === "applied" ? "Jobs you apply to show up here so you can track interviews and offers." : "Nothing matches these filters."}</div>` :
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

const SOURCES = [["company_boards", "Company career pages"], ["adzuna", "Adzuna"], ["jsearch", "LinkedIn, Indeed, Glassdoor (JSearch)"], ["jooble", "Jooble"],
  ["jobbank", "Job Bank (Canada)"], ["eluta", "Eluta (Canada)"], ["amazon_jobs", "Amazon Jobs"], ["workday", "Big-brand Workday sites"],
  ["remotive", "Remotive"], ["remoteok", "Remote OK"], ["himalayas", "Himalayas"], ["jobicy", "Jobicy"], ["weworkremotely", "We Work Remotely"],
  ["workingnomads", "Working Nomads"], ["themuse", "The Muse"]];

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
          <select class="input" value=${L.country || "CA"} onChange=${(e) => set((n) => { n.locations.country = e.target.value; })}><option value="CA">Canada</option><option value="US">United States</option><option value="AU">Australia</option><option value="IN">India</option></select></div>
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
        ${["CA", "US"].includes(L.country || "CA") ? html`<label class="row"><input type="checkbox" checked=${(L.country || "CA") === "CA" ? L.include_us_remote !== false : L.include_ca_remote !== false}
          onChange=${(e) => set((n) => { if ((L.country || "CA") === "CA") n.locations.include_us_remote = e.target.checked; else n.locations.include_ca_remote = e.target.checked; })} />
          Include remote jobs from ${(L.country || "CA") === "CA" ? "the US" : "Canada"}</label>
        <label class="row"><input type="checkbox" checked=${!!L[(L.country || "CA") === "CA" ? "include_us_onsite" : "include_ca_onsite"]}
          onChange=${(e) => set((n) => { n.locations[(L.country || "CA") === "CA" ? "include_us_onsite" : "include_ca_onsite"] = e.target.checked; })} />
          Include on-site jobs there too (needs a work permit)</label>` : html`<p class="hint">Remote jobs open worldwide are included; ones limited to other countries are left out.</p>`}
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

    <div class="card"><h3>Where jobs come from</h3>
      <p class="hint">Untick a source to stop searching it.</p>
      <div class="grid2">${SOURCES.map(([k, label]) => html`<label class="row"><input type="checkbox" checked=${(d.sources || {})[k] !== false}
        onChange=${(e) => set((n) => { n.sources = { ...(n.sources || {}), [k]: e.target.checked }; })} />${label}</label>`)}</div></div>

    <div class="card"><h3>Skip low-quality postings</h3>
      ${[["hide_agencies", "Recruiting and staffing agencies"], ["hide_lmia", "Postings that mention LMIA or temporary foreign workers"], ["hide_no_company", "Postings with no company name"]].map(([k, label]) =>
        html`<label class="row"><input type="checkbox" checked=${(d.filters || {})[k] !== false} onChange=${(e) => set((n) => { n.filters = { ...(n.filters || {}), [k]: e.target.checked }; })} />${label}</label>`)}
      <div class="field" style="max-width:320px"><label>Drop jobs still listed after this many days (often never filled)</label>
        <input class="input" type="number" value=${(d.filters || {}).stale_days ?? 30} onInput=${(e) => set((n) => { n.filters = { ...(n.filters || {}), stale_days: +e.target.value || 0 }; })} /></div>
    </div>

    <div class="card"><h3>Companies to watch</h3>
      <p class="hint">One per line: the name in the company's careers link, e.g. jobs.lever.co/<b>name</b> or boards.greenhouse.io/<b>name</b>. Names that don't exist are skipped.</p>
      <textarea class="input" rows="7" value=${(d.ats_companies?.candidates || []).join("\n")} onInput=${(e) => set((n) => { n.ats_companies = { ...(n.ats_companies || {}), candidates: lines(e.target.value).map((x) => x.toLowerCase()) }; })}></textarea>
      <div class="field"><label>Workday career sites (full links, one per line)</label>
        <textarea class="input" rows="3" value=${(d.workday_sites?.urls || []).join("\n")} onInput=${(e) => set((n) => { n.workday_sites = { ...(n.workday_sites || {}), urls: lines(e.target.value) }; })}></textarea></div>
    </div>
    <div class="row"><button class="btn primary" disabled=${!dirty || busy} onClick=${save}>${busy ? "Saving…" : "Save and search"}</button></div>
  </div>`;
}


// ------------------------------------------------------------------ AI setup guide

const AI_OS = {
  win: {
    label: "Windows",
    open: "Click Start, type PowerShell and open Windows PowerShell. Use the normal one, not \u201cRun as administrator\u201d.",
    install: "irm https://claude.ai/install.ps1 | iex",
    installNote: "Nothing seems to happen for up to a minute. Wait until the PS C:\\Users\\\u2026> prompt comes back.",
    alt: [
      ["Not found after installing? Run it from its install folder", '& "$env:USERPROFILE\\.local\\bin\\claude.exe" setup-token'],
      ["Or install with WinGet, then open a new PowerShell", "winget install Anthropic.ClaudeCode"],
      ["Or from Command Prompt (cmd)", "curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd"],
    ],
  },
  mac: {
    label: "Mac",
    open: "Press Cmd + Space, type Terminal and press Enter.",
    install: "curl -fsSL https://claude.ai/install.sh | bash",
    installNote: "Wait until the prompt comes back.",
    alt: [
      ["Not found after installing? Run it from its install folder", "~/.local/bin/claude setup-token"],
      ["Or install with Homebrew", "brew install --cask claude-code"],
    ],
  },
  linux: {
    label: "Linux",
    open: "Open your terminal app.",
    install: "curl -fsSL https://claude.ai/install.sh | bash",
    installNote: "Wait until the prompt comes back.",
    alt: [["Not found after installing? Run it from its install folder", "~/.local/bin/claude setup-token"]],
  },
};

function guessOs() {
  const p = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || "").toLowerCase();
  return p.includes("win") ? "win" : p.includes("mac") ? "mac" : "linux";
}

function Cmd({ text, say }) {
  return html`<div class="cmd"><code>${text}</code>
    <button class="btn small" onClick=${async () => say(await copy(text) ? "Copied" : "Couldn't copy, select the text instead")}>Copy</button></div>`;
}

function AiSetup({ repoUrl, say, hosted }) {
  const [os, setOs] = useState(guessOs());
  const o = AI_OS[os];
  return html`<div class="aisetup">
    <p><b>Use your Claude Pro or Max plan (no API bill).</b> One-time setup, about 5 minutes, on any computer.</p>
    <div class="tabs" role="tablist">${Object.entries(AI_OS).map(([k, v]) => html`<button role="tab" aria-selected=${k === os} onClick=${() => setOs(k)}>${v.label}</button>`)}</div>
    <ol class="steps">
      <li><b>Open a terminal.</b> ${o.open}</li>
      <li><b>Install Claude Code.</b> Paste this and press Enter:<${Cmd} text=${o.install} say=${say} /><span class="hint">${o.installNote}</span></li>
      <li><b>Close the window and open a new one</b> so it finds the new command, then check it:<${Cmd} text="claude --version" say=${say} />
        <span class="hint">You should see a version number.</span></li>
      <li><b>Get your token.</b><${Cmd} text="claude setup-token" say=${say} />
        <span class="hint">A browser opens: sign in with your Claude Pro/Max account and approve. Back in the terminal, copy the whole token that starts with <code>sk-ant-oat</code>${os === "win" ? " (select it, then right-click to copy)" : ""}.</span></li>
      ${hosted ? html`<li><b>Paste it in the box below</b> and click <b>Save token</b>. It's stored on the server for your resumes only and never shown again.</li>
        <li><b>Done.</b> Your next resumes are written by AI. Click <b>Search now</b> above to start right away.</li>` : html`
      <li><b>Save it in your Job Radar.</b> Open <a href=${repoUrl + "/settings/secrets/actions/new"} target="_blank" rel="noopener">your repo's new secret page</a>, set the name to
        <${Cmd} text="CLAUDE_CODE_OAUTH_TOKEN" say=${say} /> paste the token as the secret and click <b>Add secret</b>.</li>
      <li><b>Turn it on.</b> Click <b>Run a search now</b> above. This page says "On" after the run finishes.</li>`}
    </ol>
    <details class="trouble"><summary>Didn't work? Try these</summary>
      <ul class="reasons">
        <li><b>"claude is not recognized" / "command not found":</b> the install worked but the terminal can't find it yet. Open a new window first. If it still fails:</li>
        ${o.alt.map(([t, c]) => html`<li>${t}:<${Cmd} text=${c} say=${say} /></li>`)}
        ${os === "win" ? html`<li><b>Prompt shows ${"C:\\WINDOWS\\system32"}:</b> that's an administrator window. Close it and open PowerShell normally.</li>
          <li><b>"running scripts is disabled":</b> run <${Cmd} text="Set-ExecutionPolicy -Scope CurrentUser RemoteSigned" say=${say} /> then try the install again.</li>` : null}
        <li><b>Browser didn't open:</b> the terminal shows a link. Copy it into your browser, approve, and paste the code back if it asks.</li>
        <li><b>Still "Off" after a search:</b> ${hosted ? "paste the token again, making sure you copied all of it" : html`check the secret name is exactly <code>CLAUDE_CODE_OAUTH_TOKEN</code> and the token has no spaces at the start or end`}. Tokens last about a year; run <code>claude setup-token</code> again for a new one.</li>
        <li>Full guide: <a href="https://code.claude.com/docs/en/setup" target="_blank" rel="noopener">Claude Code setup</a>.</li>
      </ul></details>
  </div>`;
}

// ------------------------------------------------------------------ settings

function Settings({ report, say, onDisconnect, file, appSearch }) {
  const [run, setRun] = useState(null);
  const [updating, setUpdating] = useState(false);
  async function update() {
    setUpdating(true);
    try {
      const skipped = await gh.updateFromTemplate();
      await gh.runSearch().catch(() => {});
      say(skipped.length ? "Engine updated (the schedule file needs a token with the workflow permission). A search is running; check back in 15 minutes."
        : "Job Radar updated. A search is running; check back in 15 minutes.");
    } catch (e) { say(e.message); }
    setUpdating(false);
  }
  useEffect(() => { gh.lastRun().then(setRun); }, []);
  const repoUrl = `https://github.com/${gh.conn.owner}/${gh.conn.repo}`;
  async function searchNow() { await appSearch(); }
  const src = report?.sources || {};
  return html`<div class="page form">
    <h2>Settings</h2>
    <div class="card"><h3>Search</h3>
      <p>${run ? `Last run ${age({ posted: run.updated_at }) === "now" ? "just now" : age({ posted: run.updated_at }) + " ago"}: ${run.status !== "completed" ? "still running" : run.conclusion === "success" ? "finished" : "failed – open the runs on GitHub to see why, or try Update below"}.` : "No search has run yet."} Runs every 4 hours by itself.</p>
      <div class="row"><button class="btn primary" onClick=${searchNow}>Run a search now</button>
        <button class="btn" disabled=${updating} onClick=${update}>${updating ? "Updating…" : "Update Job Radar"}</button>
        <a class="btn" href=${repoUrl + "/actions"} target="_blank" rel="noopener">See runs on GitHub</a></div></div>

    <div class="card"><h3>AI resumes and interview prep</h3>
      <p>${report?.ai_enabled ? "On." : "Off: resumes are tailored by keyword matching."} ${report?.ai_used_today != null ? `${report.ai_used_today} AI resumes today.` : ""}</p>
      <${AiSetup} repoUrl=${repoUrl} say=${say} />
      <p class="hint">Or add <code>ANTHROPIC_API_KEY</code> instead to pay per use. The token is tied to your own plan, so each person uses their own.</p></div>

    <div class="card"><h3>More job sources (free keys)</h3>
      <p>Each key below is free and adds more jobs to every search. Add one, some or all.</p>
      <p><b>How to add a key to Job Radar</b> (same for every key):</p>
      <ol class="steps">
        <li>Get the key from the site (steps below) and keep that tab open.</li>
        <li>Open <a href=${repoUrl + "/settings/secrets/actions/new"} target="_blank" rel="noopener">your repo's new secret page</a> (sign in to GitHub if asked).</li>
        <li>In <b>Name</b> paste the secret name shown below (tap Copy), in <b>Secret</b> paste the key, then click <b>Add secret</b>.</li>
        <li>Click <b>Run a search now</b> above. The new source shows under "Last search" when it finishes.</li>
      </ol>
      <details class="trouble"><summary>Adzuna: big Canada and US job board</summary>
        <ol class="steps">
          <li>Go to <a href="https://developer.adzuna.com/signup" target="_blank" rel="noopener">developer.adzuna.com</a> and create a free account.</li>
          <li>Open <b>Dashboard → API Access Details</b>. You'll see an Application ID and an Application Key.</li>
          <li>Add two secrets: the ID as <${Cmd} text="ADZUNA_APP_ID" say=${say} /> and the Key as <${Cmd} text="ADZUNA_APP_KEY" say=${say} /></li>
        </ol></details>
      <details class="trouble"><summary>LinkedIn, Indeed, Glassdoor (through Google for Jobs)</summary>
        <ol class="steps">
          <li>Create a free account at <a href="https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch" target="_blank" rel="noopener">rapidapi.com → JSearch</a>.</li>
          <li>Click <b>Subscribe to test</b> and choose the free <b>Basic</b> plan (no card needed).</li>
          <li>On the JSearch page, copy the value next to <b>X-RapidAPI-Key</b>.</li>
          <li>Add it as <${Cmd} text="RAPIDAPI_KEY" say=${say} /> <span class="hint">The free plan allows about 200 searches a month, so Job Radar uses it once a day.</span></li>
        </ol></details>
      <details class="trouble"><summary>Jooble: collects jobs from many sites</summary>
        <ol class="steps">
          <li>Go to <a href="https://jooble.org/api/about" target="_blank" rel="noopener">jooble.org/api/about</a> and fill in the short form. The key arrives by email.</li>
          <li>Add it as <${Cmd} text="JOOBLE_KEY" say=${say} /></li>
        </ol></details>
      <a class="btn small" href=${repoUrl + "/settings/secrets/actions"} target="_blank" rel="noopener">See the secrets you've added</a></div>

    ${report ? html`<div class="card"><h3>Last search</h3>
      <p>${report.raw} postings read, ${report.unique} kept, ${report.new} new, ${report.tailored_this_run} resumes written.</p>
      <div class="kv">${Object.entries(src).filter(([, v]) => typeof v !== "object").map(([k, v]) => html`<span>${k}</span><span class="hint">${String(v)}</span>`)}</div></div>` : null}

    <div class="card"><h3>Apps</h3>
      <p><b>Chrome extension</b> fills job application forms with your details and tailored resume. You check and click Submit yourself.</p>
      <ol class="steps">
        <li>Download <a href="https://github.com/akhileshr1122-ui/Job-radar-app/releases/latest/download/JobRadar-Chrome.zip">JobRadar-Chrome.zip</a> and unzip it (right-click → Extract All on Windows, double-click on Mac).</li>
        <li>In Chrome open <${Cmd} text="chrome://extensions" say=${say} /> (paste it into the address bar).</li>
        <li>Turn on <b>Developer mode</b> (top right), click <b>Load unpacked</b> and pick the unzipped folder.</li>
        <li>Click the puzzle icon in Chrome's toolbar and pin <b>Job Radar</b>. Open it and enter the same GitHub account, repo and token you use here.</li>
        <li>On a job application page, click <b>Fill with Job Radar</b>. Check the fields outlined in amber before you submit.</li>
      </ol>
      <p><b>Android app</b></p>
      <ol class="steps">
        <li>On your phone, download <a href="https://github.com/akhileshr1122-ui/Job-radar-app/releases/latest/download/JobRadar.apk">JobRadar.apk</a> and open it.</li>
        <li>If Android asks, allow your browser to <b>install unknown apps</b>, then tap Install.</li>
        <li>Open Job Radar → Settings and enter your GitHub account, repo name and token, then tap <b>Save & load jobs</b>.</li>
      </ol></div>

    <div class="card"><h3>Connection</h3><p>${gh.conn.owner}/${gh.conn.repo}</p>
      <div class="row"><button class="btn" onClick=${() => { const t = document.documentElement.dataset.theme; document.documentElement.dataset.theme = t === "dark" ? "light" : "dark"; }}>Switch light / dark</button>
      <button class="btn" onClick=${onDisconnect}>Disconnect this browser</button></div></div>
  </div>`;
}

// ------------------------------------------------------------------ hosted (Azure) mode: sign-in, settings, admin

function ImportGitHub({ say, onDone }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ owner: "", repo: "job-radar", token: "" });
  const [busy, setBusy] = useState("");
  async function go() {
    setBusy("Starting…");
    try {
      const r = await gh.importFromGitHub(v, setBusy);
      say(`Brought over your profile, tracker and ${r.jobs} jobs. Resumes appear in about 3–5 minutes.`);
      onDone?.();
    } catch (e) { say(e.message); }
    setBusy("");
  }
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value.trim() });
  return html`<div class="card"><h3>Already using Job Radar on GitHub?</h3>
    ${!open ? html`<p class="hint">Bring your profile, search settings, tracker and tailored resumes over instead of uploading again.</p>
      <button class="btn" onClick=${() => setOpen(true)}>Bring my data over</button>` : html`
      <ol class="steps">
        <li>Use the same GitHub token as your Job Radar app (it needs Contents: Read). Make a new one at <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens</a> if you don't have it.</li>
        <li>Fill in your GitHub account and repo name, then click <b>Copy my data</b>. The token is only used in this browser and isn't saved.</li>
      </ol>
      <div class="field"><label for="io">GitHub account</label><input id="io" class="input" value=${v.owner} onInput=${set("owner")} /></div>
      <div class="field"><label for="ir">Repository</label><input id="ir" class="input" value=${v.repo} onInput=${set("repo")} /></div>
      <div class="field"><label for="it">GitHub token</label><input id="it" class="input" type="password" autocomplete="off" value=${v.token} onInput=${set("token")} /></div>
      <div class="row"><button class="btn primary" disabled=${!!busy || !v.owner || !v.token} onClick=${go}>${busy || "Copy my data"}</button></div>`}
  </div>`;
}


function HostedSettings({ report, say, file, appSearch }) {
  const [run, setRun] = useState(null);
  const [sec, setSec] = useState(null);
  const [tok, setTok] = useState("");
  const [key, setKey] = useState("");
  useEffect(() => { gh.lastRun().then(setRun); gh.secrets().then(setSec).catch(() => {}); }, []);
  async function searchNow() { await appSearch(); setRun(await gh.lastRun()); }
  async function saveSecret(body, msg) {
    try { setSec(await gh.secrets(body)); setTok(""); setKey(""); say(msg); } catch (e) { say(e.message); }
  }
  const src = report?.sources || {};
  const runText = !run ? "No search has run for you yet." : run.state === "queued" ? "Waiting to start (usually under 2 minutes)."
    : run.state === "running" ? "Running now." : `Last run ${age({ posted: run.updated_at }) === "now" ? "just now" : age({ posted: run.updated_at }) + " ago"}${run.conclusion === "failure" ? ` – failed: ${run.note || "unknown error"}` : ""}.`;
  return html`<div class="page form">
    <h2>Settings</h2>
    <div class="card"><h3>Search</h3>
      <p>${runText} Everyone's jobs are pulled together every 4 hours, then matched to each person's resume.</p>
      <div class="row"><button class="btn primary" onClick=${searchNow}>Search now</button>
        <button class="btn" onClick=${async () => setRun(await gh.lastRun())}>Check status</button></div></div>

    <div class="card"><h3>AI resumes and interview prep</h3>
      <p>${sec?.claude_token ? "On, using your Claude plan." : sec?.anthropic_key ? "On, using your Anthropic API key." : "Off: resumes are tailored by keyword matching."}
        ${report?.ai_used_today != null ? ` ${report.ai_used_today} AI resumes today.` : ""}</p>
      <${AiSetup} say=${say} hosted=${true} />
      <div class="field"><label for="ct">Claude token (starts with sk-ant-oat)</label>
        <input id="ct" class="input" type="password" autocomplete="off" value=${tok} onInput=${(e) => setTok(e.target.value.trim())} /></div>
      <div class="row"><button class="btn primary" disabled=${!tok} onClick=${() => saveSecret({ claude_token: tok }, "Saved. Your next resumes are written by AI.")}>Save token</button>
        ${sec?.claude_token ? html`<button class="btn" onClick=${() => saveSecret({ claude_token: "" }, "Token removed.")}>Remove my token</button>` : null}</div>
      <details class="trouble"><summary>Use an Anthropic API key instead (pay per use)</summary>
        <div class="field"><label for="ak">Anthropic API key (starts with sk-ant-api)</label>
          <input id="ak" class="input" type="password" autocomplete="off" value=${key} onInput=${(e) => setKey(e.target.value.trim())} /></div>
        <div class="row"><button class="btn" disabled=${!key} onClick=${() => saveSecret({ anthropic_key: key }, "API key saved.")}>Save key</button>
          ${sec?.anthropic_key ? html`<button class="btn" onClick=${() => saveSecret({ anthropic_key: "" }, "API key removed.")}>Remove key</button>` : null}</div>
      </details>
      <p class="hint">Your token is only used for your own resumes and is never shown to anyone, including the admin's screens.</p></div>

    ${report ? html`<div class="card"><h3>Last search</h3>
      <p>${report.raw} postings checked, ${report.unique} matched you, ${report.new} new, ${report.tailored_this_run} resumes written.</p>
      ${gh.me?.admin ? html`<details class="trouble"><summary>Sources (only you see this)</summary><div class="kv">${Object.entries(src).filter(([, v]) => typeof v !== "object").map(([k, v]) => html`<span>${k}</span><span class="hint">${String(v)}</span>`)}</div></details>` : null}</div>` : null}

    ${gh.me?.admin ? html`<div class="card"><h3>Admin</h3><p>Invites, plans and requests are on the <a href="#admin">Admin</a> tab.</p></div>` : null}

    <${ImportGitHub} say=${say} />

    <div class="card"><h3>On your phone</h3>
      <ol class="steps">
        <li>Open this site on your phone and sign in.</li>
        <li><b>iPhone:</b> tap Share → <b>Add to Home Screen</b>. <b>Android:</b> tap ⋮ → <b>Add to Home screen</b> (or Install app).</li>
        <li>Job Radar now opens like an app.</li>
      </ol></div>

    <div class="card"><h3>Account</h3><p>Signed in as <b>${gh.me?.user}</b>${gh.me?.provider === "github" ? " (GitHub)" : " (Microsoft)"}.</p>
      <div class="row"><button class="btn" onClick=${() => { const t = document.documentElement.dataset.theme; document.documentElement.dataset.theme = t === "dark" ? "light" : "dark"; }}>Switch light / dark</button>
      <button class="btn" onClick=${gh.forget}>Sign out</button></div></div>
  </div>`;
}

const root = document.getElementById("app");
root.textContent = "";
render(html`<${App} />`, root);
