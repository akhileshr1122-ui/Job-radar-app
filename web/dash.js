// Coverage dashboard (where jobs come from, how many, how fresh) and the admin Usage page.
import { html, useState, useEffect, useMemo } from "./vendor/preact-htm.js";
import gh from "./backend.js";
import { PIPE, ago, age } from "./ui.js";
import { planById } from "./plans.js";

const ATS = new Set(["greenhouse", "lever", "ashby", "workable", "smartrecruiters"]);
const NAMES = {
  adzuna: "Adzuna", jooble: "Jooble", jsearch: "Google for Jobs (LinkedIn, Indeed, Glassdoor)", "amazon.jobs": "Amazon Jobs", amazon_jobs: "Amazon Jobs",
  himalayas: "Himalayas", jobicy: "Jobicy", remotive: "Remotive", remoteok: "Remote OK", weworkremotely: "We Work Remotely",
  workingnomads: "Working Nomads", themuse: "The Muse", workday: "Big-brand career sites (Workday)", jobbank: "Job Bank", eluta: "Eluta",
  company: "Company career pages", greenhouse: "Greenhouse career pages", lever: "Lever career pages", ashby: "Ashby career pages",
  workable: "Workable career pages", smartrecruiters: "SmartRecruiters career pages", "added by you": "Added by you",
};
const nice = (k) => NAMES[k] || k.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const fmt = (n) => (n == null ? "–" : n >= 10000 ? Math.round(n / 1000) + "k" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(Math.round(n)));
const C = ["var(--deep)", "var(--amber)", "#2F7DBF", "#1B8A5A", "#8A5CB8", "#C0573E", "#5B8A94", "#B7A13A"];

function Tile({ title, children, span = 1, note }) {
  return html`<section class=${"tile s" + span}><header>${title}</header><div class="tile-body">${children}</div>${note ? html`<footer>${note}</footer>` : null}</section>`;
}
function Kpi({ value, label, sub, accent }) {
  return html`<div class=${"kpi" + (accent ? " accent" : "")}><b>${value}</b><span>${label}</span>${sub ? html`<small>${sub}</small>` : null}</div>`;
}
function HBars({ rows, color = "var(--deep)" }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return html`<div class="hbars">${rows.map(([k, v], i) => html`<div class="hbar"><span class="hb-l" title=${k}>${k}</span>
    <span class="hb-t"><span style=${`width:${Math.max(2, (100 * v) / max)}%;background:${Array.isArray(color) ? color[i % color.length] : color}`}></span></span>
    <span class="hb-v">${fmt(v)}</span></div>`)}</div>`;
}

/** Two series over time (bars = scanned, line = matches), drawn as SVG. */
function Trend({ points }) {
  if (points.length < 2) return html`<p class="empty-s">The trend appears after a few searches.</p>`;
  const W = 640, H = 200, P = { l: 40, r: 40, t: 12, b: 26 };
  const n = points.length, bw = (W - P.l - P.r) / n;
  const maxS = Math.max(1, ...points.map((p) => p.scanned)), maxL = Math.max(1, ...points.map((p) => p.listed));
  const x = (i) => P.l + bw * i + bw / 2;
  const yS = (v) => H - P.b - ((H - P.t - P.b) * v) / maxS;
  const yL = (v) => H - P.b - ((H - P.t - P.b) * v) / maxL;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${yL(p.listed).toFixed(1)}`).join(" ");
  const ticks = [0, Math.floor(n / 2), n - 1];
  return html`<svg class="trend" viewBox=${`0 0 ${W} ${H}`} role="img" aria-label="Postings scanned and your matches per search">
    ${[0, 0.5, 1].map((f) => html`<line x1=${P.l} x2=${W - P.r} y1=${H - P.b - (H - P.t - P.b) * f} y2=${H - P.b - (H - P.t - P.b) * f} class="grid" />`)}
    ${points.map((p, i) => html`<rect x=${x(i) - bw * 0.35} width=${bw * 0.7} y=${yS(p.scanned)} height=${H - P.b - yS(p.scanned)} rx="2" class="bar-s"><title>${new Date(p.at).toLocaleString()}: ${p.scanned} postings scanned, ${p.listed} matches</title></rect>`)}
    <path d=${line} class="line-l" />
    ${points.map((p, i) => html`<circle cx=${x(i)} cy=${yL(p.listed)} r="3" class="dot-l" />`)}
    <text x=${P.l - 6} y=${P.t + 8} class="ax" text-anchor="end">${fmt(maxS)}</text>
    <text x=${W - P.r + 6} y=${P.t + 8} class="ax amber">${maxL}</text>
    ${ticks.map((i) => html`<text x=${x(i)} y=${H - 6} class="ax" text-anchor="middle">${new Date(points[i].at).toLocaleDateString([], { month: "short", day: "numeric" })}</text>`)}
  </svg>
  <div class="legend2"><span><i class="sw s"></i>Postings scanned</span><span><i class="sw l"></i>Your matches</span></div>`;
}

function Donut({ parts }) {
  const total = parts.reduce((a, [, v]) => a + v, 0) || 1;
  let acc = 0;
  const R = 52, L = 2 * Math.PI * R;
  return html`<div class="donut"><svg viewBox="0 0 140 140" role="img" aria-label="Share of matches by kind of source">
    ${parts.map(([k, v], i) => { const len = (L * v) / total; const el = html`<circle cx="70" cy="70" r=${R} fill="none" stroke=${C[i % C.length]} stroke-width="20"
      stroke-dasharray=${`${len} ${L - len}`} stroke-dashoffset=${-acc} transform="rotate(-90 70 70)"><title>${k}: ${v}</title></circle>`; acc += len; return el; })}
    <text x="70" y="68" text-anchor="middle" class="d-n">${total}</text><text x="70" y="86" text-anchor="middle" class="d-l">matches</text></svg>
    <ul>${parts.map(([k, v], i) => html`<li><i style=${`background:${C[i % C.length]}`}></i>${k}<b>${Math.round((100 * v) / total)}%</b></li>`)}</ul></div>`;
}

function Funnel({ steps }) {
  const max = Math.max(1, steps[0][1]);
  return html`<div class="funnel">${steps.map(([k, v], i) => html`<div class="f-row"><span class="f-l">${k}</span>
    <span class="f-bar"><span style=${`width:${Math.max(1.5, (100 * Math.log10(v + 1)) / Math.log10(max + 1))}%;opacity:${1 - i * 0.12}`}></span></span><b>${fmt(v)}</b></div>`)}
    <small class="hint">Bars use a log scale so every step stays visible.</small></div>`;
}

export function Coverage({ jobs, statuses, report, file, search, resume, showBoards, BoardsView, ...rest }) {
  const [hist, setHist] = useState([]);
  const [range, setRange] = useState(30);
  useEffect(() => { gh.json("data/history.json").then((h) => setHist(Array.isArray(h) ? h : [])).catch(() => setHist([])); }, [file?.updated]);
  const src = report?.sources || {};
  const last = hist[hist.length - 1];
  const scanned = report?.raw ?? last?.scanned ?? 0;

  const data = useMemo(() => {
    const counts = last?.sources || Object.fromEntries(Object.entries(src).filter(([, v]) => typeof v === "number"));
    const grouped = {};
    let career = 0;
    for (const [k, v] of Object.entries(counts)) { if (ATS.has(k)) career += v; else grouped[nice(k)] = (grouped[nice(k)] || 0) + v; }
    if (career) grouped["Company career pages"] = career;
    const bySource = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
    const connected = new Set(Object.entries(counts).filter(([k, v]) => typeof v === "number" && v > 0 && !k.includes("_")).map(([k]) => (ATS.has(k) ? "company" : k)));
    const boardsFound = (src.ats_boards_found || []).length;
    const kind = {};
    for (const j of jobs) { const k = ATS.has(j.source) || j.source === "workday" ? "Company career pages" : j.source === "added by you" ? "Added by you" : ["himalayas", "jobicy", "remotive", "remoteok", "weworkremotely", "workingnomads"].includes(j.source) ? "Remote job boards" : "Job boards and search engines"; kind[k] = (kind[k] || 0) + 1; }
    const places = {};
    for (const j of jobs) { const p = j.remote ? "Remote" : (j.location || "").split(",")[0].trim() || "Not given"; places[p] = (places[p] || 0) + 1; }
    const ages = [["Today", 0, 1], ["1–3 days", 1, 3], ["4–7 days", 3, 7], ["1–2 weeks", 7, 14], ["Older", 14, 1e9]].map(([k, a, b]) => [k, jobs.filter((j) => { const d = (Date.now() - Date.parse(j.posted || j.first_seen || 0)) / 864e5; return d >= a && d < b; }).length]);
    const cos = {};
    for (const j of jobs) if (j.company) cos[j.company] = (cos[j.company] || 0) + 1;
    const st = Object.values(statuses || {});
    return { bySource, connected: connected.size, boardsFound, kind: Object.entries(kind).sort((a, b) => b[1] - a[1]), places: Object.entries(places).sort((a, b) => b[1] - a[1]).slice(0, 8), ages,
      companies: Object.entries(cos).sort((a, b) => b[1] - a[1]).slice(0, 8), ready: jobs.filter((j) => j.resume_pdf).length,
      applied: st.filter((e) => PIPE.includes(e.status)).length, avgScore: jobs.length ? Math.round(jobs.reduce((a, j) => a + j.score, 0) / jobs.length) : 0 };
  }, [jobs, statuses, report, hist]);

  const pts = hist.slice(-range);
  const monthSearches = hist.filter((h) => (h.at || "").slice(0, 7) === new Date().toISOString().slice(0, 7)).length;
  return html`<div class="page wide dash">
    <div class="pagehead"><div><h1>Coverage</h1><p class="hint">Where your jobs come from, how many postings are checked for you and how fresh they are.${file?.updated ? ` Last search ${ago(file.updated)}.` : ""}</p></div>
      <span class="spacer"></span>
      <div class="chips tight">${[[10, "Last 10 searches"], [30, "Last 30"], [120, "All"]].map(([n, l]) => html`<button class="chip" aria-pressed=${range === n} onClick=${() => setRange(n)}>${l}</button>`)}</div></div>

    <div class="kpis">
      <${Kpi} value=${fmt(scanned)} label="postings scanned" sub="in the last search" accent />
      <${Kpi} value=${data.connected} label="job sources" sub="boards, search engines and career sites" />
      <${Kpi} value=${fmt(last?.companies)} label="employers seen" sub="in the last search" />
      <${Kpi} value=${jobs.length} label="your matches" sub=${`average score ${data.avgScore}`} />
      <${Kpi} value=${data.ready} label="tailored resumes ready" sub="each with a cover letter" />
      <${Kpi} value=${monthSearches} label="searches this month" sub="every 4 hours, plus yours" />
    </div>

    <div class="tiles">
      <${Tile} title="Postings scanned and your matches, per search" span=${2}><${Trend} points=${pts} /></${Tile}>
      <${Tile} title="From postings to applications"><${Funnel} steps=${[["Scanned", scanned], ["Passed your filters", report?.passed ?? 0], ["In your list", jobs.length], ["Resume ready", data.ready], ["Applied", data.applied]]} /></${Tile}>
      <${Tile} title="Postings by source (last search)" span=${2} note="Company career pages are read directly from employers' own hiring systems.">
        <${HBars} rows=${data.bySource.slice(0, 12)} color=${C} /></${Tile}>
      <${Tile} title="Where your matches come from"><${Donut} parts=${data.kind} /></${Tile}>
      <${Tile} title="How fresh your matches are"><${HBars} rows=${data.ages} color="var(--amber)" /></${Tile}>
      <${Tile} title="Where the jobs are"><${HBars} rows=${data.places} /></${Tile}>
      <${Tile} title="Employers with the most matches"><${HBars} rows=${data.companies} color="#2F7DBF" /></${Tile}>
    </div>
    ${showBoards && BoardsView ? html`<details class="trouble boards-more"><summary>Search a job board yourself</summary><${BoardsView} search=${search} resume=${resume} /></details>` : null}
  </div>`;
}

// ------------------------------------------------------------------ admin: usage per person

const SONNET = { in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2.5 }; // USD per million tokens (Claude Sonnet 5.5 API)
const apiCost = (u) => ((u.input_tokens || 0) * SONNET.in + (u.output_tokens || 0) * SONNET.out + (u.cache_read_tokens || 0) * SONNET.cacheRead + (u.cache_write_tokens || 0) * SONNET.cacheWrite) / 1e6;
const tok = (u) => (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_tokens || 0) + (u.cache_write_tokens || 0);

export function UsagePage({ say }) {
  const [d, setD] = useState(null);
  const [period, setPeriod] = useState("month");
  useEffect(() => { gh.admin().then(setD).catch((e) => say(e.message)); }, []);
  if (!d) return html`<div class="page wide"><p class="hint">Loading usage…</p></div>`;
  const plans = Object.fromEntries((d.people || []).map((p) => [p.id.toLowerCase(), p.plan || "free"]));
  const admins = (d.admins || []).map((a) => a.toLowerCase());
  const rows = (d.users || []).filter((u) => u.jobs != null || u.last_seen).map((u) => ({ ...u, u: (period === "month" ? u.month : u.total) || {},
    plan: admins.includes((u.name || "").toLowerCase()) ? "pro" : plans[(u.name || "").toLowerCase()] || "free" }));
  const sum = (f) => rows.reduce((a, r) => a + (f(r) || 0), 0);
  const cell = (n) => (n ? fmt(n) : html`<span class="hint">0</span>`);
  return html`<div class="page wide dash">
    <div class="pagehead"><div><h1>Usage</h1><p class="hint">Only you see this. What each person's Job Radar did${period === "month" ? " this month" : " since they joined"}.</p></div>
      <span class="spacer"></span>
      <div class="chips tight"><button class="chip" aria-pressed=${period === "month"} onClick=${() => setPeriod("month")}>This month</button>
        <button class="chip" aria-pressed=${period === "total"} onClick=${() => setPeriod("total")}>All time</button></div></div>

    <div class="kpis">
      <${Kpi} value=${rows.length} label="people" sub=${`${rows.filter((r) => r.last_seen && Date.now() - Date.parse(r.last_seen) < 7 * 864e5).length} active this week`} accent />
      <${Kpi} value=${fmt(sum((r) => r.u.ai_resumes))} label="AI resumes" sub=${`${fmt(sum((r) => r.u.keyword_resumes))} keyword-matched`} />
      <${Kpi} value=${fmt(sum((r) => r.u.cover_letters))} label="cover letters" />
      <${Kpi} value=${fmt(sum((r) => r.u.prep_sheets))} label="interview prep sheets" />
      <${Kpi} value=${fmt(sum((r) => tok(r.u)))} label="AI tokens" sub=${`${fmt(sum((r) => r.u.ai_calls))} AI calls`} />
      <${Kpi} value=${"$" + sum((r) => apiCost(r.u)).toFixed(2)} label="if paid by API key" sub="Claude Sonnet 5.5 list price" />
    </div>

    <section class="tile s3 tablewrap"><header>Per person</header>
      <div class="scroll-x"><table class="utable">
        <thead><tr><th>Person</th><th>Plan</th><th>Jobs</th><th>Resumes ready</th><th>AI resumes</th><th>Cover letters</th><th>Prep</th><th>Applied</th><th>Interviews</th><th>Searches</th><th>AI tokens</th><th>API cost</th><th>Last run</th></tr></thead>
        <tbody>${rows.map((r) => html`<tr>
          <td><b>${r.name}</b><small>${r.last_seen ? `seen ${ago(r.last_seen)}` : "never signed in"}</small>${r.ai_error ? html`<small class="err">${r.ai_error}</small>` : null}</td>
          <td><span class="tag">${planById(r.plan).name}</span></td>
          <td>${cell(r.jobs)}</td><td>${cell(r.resumes_ready)}</td><td>${cell(r.u.ai_resumes)}</td><td>${cell(r.u.cover_letters)}</td><td>${cell(r.u.prep_sheets)}</td>
          <td>${cell(r.applied)}</td><td>${cell(r.interviews)}</td><td>${cell(r.u.searches)}</td><td>${cell(tok(r.u))}</td><td>${apiCost(r.u) ? "$" + apiCost(r.u).toFixed(2) : html`<span class="hint">$0</span>`}</td>
          <td>${r.run?.state ? html`${r.run.ok === false ? html`<span class="err">failed</span>` : r.run.state} <small>${r.run.finished ? ago(r.run.finished) : ""}</small>` : "–"}</td>
        </tr>`)}</tbody>
      </table></div>
      <footer>AI tokens are counted from this update on. People using their own Claude plan are billed to their plan, not to you; "API cost" shows what the same work would cost on an Anthropic API key (Sonnet 5.5: $2 in / $10 out per million tokens, $0.10 for cached resume text).</footer>
    </section>
  </div>`;
}
