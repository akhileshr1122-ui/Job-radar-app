// Home, Tracker, Resumes, Insights, Plan and Admin tabs.
import { html, useState, useEffect, useMemo } from "./vendor/preact-htm.js";
import gh from "./backend.js";
import { PIPE, LABEL, Ring, age, ago, copy, firstName } from "./ui.js";
import { PLANS, planById, priceText } from "./plans.js";
import { resumePdf, fileName } from "./pdf.js";

const DAY = 864e5;
const daysSince = (t) => Math.floor((Date.now() - (t || 0)) / DAY);

async function download(path, name, say) {
  try {
    const b = await gh.blob(path);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  } catch (e) { say(e.message); }
}
const stem = (resume, job) => fileName(resume, job).replace(/\.pdf$/, "");

function Bar({ value, max, label, sub, onClick }) {
  const pct = max ? Math.max(4, Math.round((100 * value) / max)) : 0;
  const Tag = onClick ? "button" : "div";
  return html`<${Tag} class="bar" onClick=${onClick}>
    <span class="bar-label">${label}${sub ? html` <small>${sub}</small>` : null}</span>
    <span class="bar-track"><span class="bar-fill" style=${`width:${pct}%`}></span></span>
    <span class="bar-val">${value}</span>
  </${Tag}>`;
}

// ------------------------------------------------------------------ home

export function Home({ jobs, statuses, file, resume, setRoute, openJob, say, searchNow, run }) {
  const st = (j) => statuses[j.id]?.status;
  const newIds = new Set(jobs.filter((j) => j.first_seen === file?.updated).map((j) => j.id));
  const inbox = jobs.filter((j) => !st(j));
  const best = [...inbox].sort((a, b) => (newIds.has(b.id) - newIds.has(a.id)) || b.score - a.score).slice(0, 6);
  const entries = Object.entries(statuses);
  const week = entries.filter(([, e]) => PIPE.includes(e.status) && e.at > Date.now() - 7 * DAY).length;
  const interviews = entries.filter(([, e]) => e.status === "interview").length;
  const follow = entries.filter(([, e]) => e.status === "applied" && daysSince(e.at) >= 7)
    .map(([id, e]) => ({ e, j: jobs.find((x) => x.id === id) })).filter((x) => x.j).sort((a, b) => a.e.at - b.e.at).slice(0, 5);
  const counts = ["saved", "applied", "interview", "offer"].map((s) => [s, entries.filter(([, e]) => e.status === s).length]);
  const maxCount = Math.max(1, ...counts.map(([, n]) => n));
  const name = firstName(resume);

  return html`<div class="page wide">
    <div class="pagehead">
      <div><h1>${name ? `Hi ${name}` : "Your search"}</h1>
        <p class="hint">${file?.updated ? `Last search ${ago(file.updated)}. ` : ""}${run?.state === "running" ? "A search is running now." : run?.state === "queued" ? "A search starts in a moment." : "Searches run by themselves every 4 hours."}</p></div>
    </div>

    <div class="stats">
      <button class="stat" onClick=${() => setRoute("jobs")}><b>${newIds.size}</b><span>new in the last search</span></button>
      <button class="stat" onClick=${() => setRoute("jobs")}><b>${inbox.length}</b><span>waiting in your inbox</span></button>
      <button class="stat" onClick=${() => setRoute("tracker")}><b>${week}</b><span>applied this week</span></button>
      <button class="stat" onClick=${() => setRoute("tracker")}><b>${interviews}</b><span>interviews in progress</span></button>
    </div>

    <div class="cols">
      <section class="panel">
        <div class="panel-head"><h2>Best new matches</h2><span class="spacer"></span><button class="link" onClick=${() => setRoute("jobs")}>All jobs</button></div>
        ${best.length === 0 ? html`<p class="empty-s">No new matches right now. Your next search runs within 4 hours.</p>` :
          best.map((j) => html`<button class="mini" onClick=${() => openJob(j.id)}>
            <${Ring} score=${j.score} />
            <span><b>${j.title}</b><small>${j.company}${j.location ? `, ${j.location}` : ""}</small></span>
            ${newIds.has(j.id) ? html`<span class="tag new">New</span>` : html`<span class="age">${age(j)}</span>`}
          </button>`)}
      </section>

      <div class="stack">
        <section class="panel">
          <div class="panel-head"><h2>Follow up</h2></div>
          ${follow.length === 0 ? html`<p class="empty-s">Applications with no news after a week show up here, so you can nudge the recruiter.</p>` :
            follow.map(({ j, e }) => html`<button class="mini plain" onClick=${() => openJob(j.id)}>
              <span><b>${j.title}</b><small>${j.company}, applied ${daysSince(e.at)} days ago</small></span></button>`)}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Your pipeline</h2><span class="spacer"></span><button class="link" onClick=${() => setRoute("tracker")}>Open tracker</button></div>
          ${counts.map(([s, n]) => html`<${Bar} label=${LABEL[s]} value=${n} max=${maxCount} onClick=${() => setRoute("tracker")} />`)}
        </section>
      </div>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ tracker (board)

const COLUMNS = ["saved", "applied", "interview", "offer", "rejected"];

export function Tracker({ jobs, statuses, setStatus, openJob }) {
  const byId = Object.fromEntries(jobs.map((j) => [j.id, j]));
  const cols = COLUMNS.map((s) => [s, Object.entries(statuses).filter(([id, e]) => e.status === s && byId[id])
    .sort((a, b) => b[1].at - a[1].at).map(([id, e]) => ({ j: byId[id], e }))]);
  const total = cols.reduce((n, [, l]) => n + l.length, 0);
  return html`<div class="page wide">
    <div class="pagehead"><div><h1>Tracker</h1>
      <p class="hint">Every job you've saved or applied to. Move a card with its menu; notes and dates are kept.</p></div></div>
    ${total === 0 ? html`<div class="panel"><p class="empty-s">Nothing tracked yet. Open a job and tap Save or Apply now; it appears here.</p></div>` : null}
    <div class="board-cols">
      ${cols.map(([s, list]) => html`<section class=${"bcol st-" + s} aria-label=${LABEL[s]}>
        <h2>${LABEL[s]} <span>${list.length}</span></h2>
        ${list.map(({ j, e }) => html`<article class="bcard">
          <button class="bcard-main" onClick=${() => openJob(j.id)}>
            <b>${j.title}</b><small>${j.company}</small>
            ${e.note ? html`<span class="note">${e.note}</span>` : null}
            <span class="hint">${daysSince(e.at) === 0 ? "Today" : daysSince(e.at) === 1 ? "Yesterday" : `${daysSince(e.at)} days ago`}</span>
          </button>
          <select class="input slim" aria-label="Move to" value=${s} onChange=${(ev) => setStatus(j.id, ev.target.value || null)}>
            ${COLUMNS.map((c) => html`<option value=${c}>${LABEL[c]}</option>`)}<option value="">Remove from tracker</option>
          </select>
        </article>`)}
      </section>`)}
    </div>
  </div>`;
}

// ------------------------------------------------------------------ resumes & documents

export function Documents({ jobs, statuses, resume, base, say, openJob }) {
  const [filter, setFilter] = useState("tracked");
  const tracked = (j) => !!statuses[j.id] && statuses[j.id].status !== "hidden";
  const list = jobs.filter((j) => j.resume_pdf && (filter === "all" || tracked(j))).sort((a, b) => (tracked(b) - tracked(a)) || b.score - a.score);
  const preps = jobs.filter((j) => j.prep);
  async function copyLetter(j) {
    try { const t = await gh.json(`data/resumes/${j.id}.json`); say((await copy(t.cover_letter || "")) ? "Cover letter copied." : "Couldn't copy here; open the job instead."); }
    catch (e) { say(e.message); }
  }
  return html`<div class="page wide">
    <div class="pagehead"><div><h1>Resumes</h1><p class="hint">Your standard resume and every version written for a job.</p></div></div>

    <section class="panel">
      <div class="panel-head"><h2>Standard resume</h2></div>
      <p class="hint">Not tailored to any job. Good for job fairs and recruiters.</p>
      <div class="row">
        <button class="btn primary small" disabled=${!base || !resume} onClick=${() => resumePdf(base, resume).save(fileName(resume, null))}>Download PDF</button>
        <button class="btn small" onClick=${() => download("data/resumes/base.docx", stem(resume, null) + ".docx", say)}>Download Word</button>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Tailored resumes</h2><span class="spacer"></span>
        <div class="chips tight">
          <button class="chip" aria-pressed=${filter === "tracked"} onClick=${() => setFilter("tracked")}>Jobs I'm tracking</button>
          <button class="chip" aria-pressed=${filter === "all"} onClick=${() => setFilter("all")}>All</button>
        </div></div>
      ${list.length === 0 ? html`<p class="empty-s">${filter === "tracked" ? "Save or apply to a job and its resume shows up here." : "No tailored resumes yet. They're written right after each search."}</p>` :
        html`<div class="doclist">${list.map((j) => html`<div class="docrow">
          <button class="docname" onClick=${() => openJob(j.id)}><b>${j.title}</b><small>${j.company}, ${j.tailor_method === "claude" ? "written by AI" : j.tailor_method === "edited" ? "with your edits" : "keyword match"}</small></button>
          <div class="row">
            <button class="btn small" onClick=${() => download(`data/resumes/${j.id}.pdf`, stem(resume, j) + ".pdf", say)}>PDF</button>
            <button class="btn small" onClick=${() => download(`data/resumes/${j.id}.docx`, stem(resume, j) + ".docx", say)}>Word</button>
            <button class="btn small" onClick=${() => copyLetter(j)}>Copy cover letter</button>
          </div></div>`)}</div>`}
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Interview prep</h2></div>
      ${preps.length === 0 ? html`<p class="empty-s">Open a job and tap Prepare me to get likely questions with answers from your own experience.</p>` :
        preps.map((j) => html`<button class="mini plain" onClick=${() => openJob(j.id)}><span><b>${j.title}</b><small>${j.company}</small></span></button>`)}
    </section>
  </div>`;
}

// ------------------------------------------------------------------ insights

function salaryNumbers(s) {
  if (!s) return null;
  const nums = [...String(s).replace(/,/g, "").matchAll(/(\d+(?:\.\d+)?)\s*(k)?/gi)].map((m) => +m[1] * (m[2] ? 1000 : 1)).filter((n) => n >= 20000 && n <= 600000);
  return nums.length ? nums : null;
}
const top = (counter, n) => Object.entries(counter).sort((a, b) => b[1] - a[1]).slice(0, n);
const money = (n) => "$" + Math.round(n / 1000) + "k";

export function Insights({ jobs, statuses, setRoute }) {
  const data = useMemo(() => {
    const good = jobs.filter((j) => j.score >= 50);
    const missing = {}, matched = {}, places = {}, sources = {};
    for (const j of good) {
      for (const k of j.keywords_missing || []) missing[k] = (missing[k] || 0) + 1;
      for (const k of j.keywords_matched || []) matched[k] = (matched[k] || 0) + 1;
    }
    for (const j of jobs) {
      const p = j.remote ? "Remote" : (j.location || "").split(",")[0].trim() || "Unknown";
      places[p] = (places[p] || 0) + 1;
      sources[j.source] = (sources[j.source] || 0) + 1;
    }
    const sal = jobs.map((j) => salaryNumbers(j.salary)).filter(Boolean).map((n) => (n.length > 1 ? (Math.min(...n) + Math.max(...n)) / 2 : n[0])).sort((a, b) => a - b);
    const e = Object.values(statuses);
    const applied = e.filter((x) => PIPE.includes(x.status)).length;
    const replied = e.filter((x) => x.status === "interview" || x.status === "offer").length;
    return { good: good.length, missing: top(missing, 10), matched: top(matched, 8), places: top(places, 8), sources: top(sources, 8), sal, applied, replied };
  }, [jobs, statuses]);
  const m = (list) => Math.max(1, ...list.map(([, n]) => n));
  const q = (p) => data.sal[Math.min(data.sal.length - 1, Math.floor(p * data.sal.length))];

  return html`<div class="page wide">
    <div class="pagehead"><div><h1>Insights</h1><p class="hint">What your ${jobs.length} current matches have in common.</p></div></div>
    <div class="cols">
      <section class="panel">
        <div class="panel-head"><h2>Skills employers ask for that your profile doesn't mention</h2></div>
        ${data.missing.length ? html`${data.missing.map(([k, n]) => html`<${Bar} label=${k} value=${n} max=${m(data.missing)} />`)}
          <p class="hint">Counts are jobs scoring 50 or more. If you have one of these, add it in your <button class="link" onClick=${() => setRoute("profile")}>profile</button> and every resume is re-written.</p>`
          : html`<p class="empty-s">Nothing missing yet. This fills in as resumes are written.</p>`}
      </section>
      <div class="stack">
        <section class="panel">
          <div class="panel-head"><h2>Salary in your matches</h2></div>
          ${data.sal.length >= 3 ? html`<div class="salary"><div><b>${money(q(0.5))}</b><span>middle</span></div><div><b>${money(q(0.25))}–${money(q(0.75))}</b><span>most fall in this range</span></div></div>
            <p class="hint">From the ${data.sal.length} postings that list pay.</p>` : html`<p class="empty-s">Too few postings list pay to show a range yet.</p>`}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Replies to your applications</h2></div>
          <div class="salary"><div><b>${data.applied ? Math.round((100 * data.replied) / data.applied) : 0}%</b><span>got an interview or offer</span></div><div><b>${data.applied}</b><span>applications</span></div></div>
        </section>
      </div>
      <section class="panel">
        <div class="panel-head"><h2>Your strongest skills</h2></div>
        ${data.matched.length ? data.matched.map(([k, n]) => html`<${Bar} label=${k} value=${n} max=${m(data.matched)} />`) : html`<p class="empty-s">Shows up after your first resumes are written.</p>`}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Where the jobs are</h2></div>
        ${data.places.map(([k, n]) => html`<${Bar} label=${k} value=${n} max=${m(data.places)} />`)}
        <div class="panel-head" style="margin-top:14px"><h2>Where they came from</h2></div>
        ${data.sources.map(([k, n]) => html`<${Bar} label=${k} value=${n} max=${m(data.sources)} />`)}
      </section>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ plan

export function PlanPage({ say }) {
  const current = gh.me?.plan || "free";
  const [sent, setSent] = useState("");
  async function upgrade(p) {
    try {
      await gh.requestPlan(p.id, "");
      if (p.paymentLink) window.open(p.paymentLink, "_blank", "noopener");
      setSent(p.id);
      say(p.paymentLink ? `Opening payment for ${p.name}. You'll be moved to ${p.name} once it's confirmed.` : `Request for ${p.name} sent. You'll be moved over once it's approved.`);
    } catch (e) { say(e.message); }
  }
  return html`<div class="page wide">
    <div class="pagehead"><div><h1>Your plan</h1><p class="hint">You're on <b>${planById(current).name}</b>${gh.me?.admin ? " (admin, everything included)" : ""}.</p></div></div>
    <div class="plans">
      ${PLANS.map((p) => html`<div class=${"plan" + (p.id === current ? " current" : p.highlight ? " hl" : "")}>
        <h3>${p.name}</h3>
        <div class="price">${priceText(p)}<small>/${p.period}</small></div>
        <p class="hint">${p.blurb}</p>
        <ul>${p.features.map((f) => html`<li>${f}</li>`)}</ul>
        ${p.id === current ? html`<span class="tag ready">Your plan</span>` : gh.me?.admin ? null
          : sent === p.id ? html`<span class="tag">Requested</span>`
          : html`<button class=${"btn " + (p.highlight ? "primary" : "")} onClick=${() => upgrade(p)}>${PLANS.indexOf(p) > PLANS.findIndex((x) => x.id === current) ? `Upgrade to ${p.name}` : `Switch to ${p.name}`}</button>`}
      </div>`)}
    </div>
  </div>`;
}

// ------------------------------------------------------------------ admin

export function AdminPage({ say }) {
  const [d, setD] = useState(null);
  const [add, setAdd] = useState("");
  const [note, setNote] = useState("");
  const [plan, setPlan] = useState("free");
  const load = () => gh.admin().then(setD).catch((e) => say(e.message));
  useEffect(() => { load(); }, []);
  async function change(body, msg) {
    try { setD(await gh.admin(body)); if (msg) say(msg); } catch (e) { say(e.message); }
  }
  const people = d?.people || [];
  const planOf = (id) => people.find((p) => p.id.toLowerCase() === (id || "").toLowerCase())?.plan;
  const reqs = d?.requests || [];
  return html`<div class="page wide">
    <div class="pagehead"><div><h1>Admin</h1><p class="hint">Only you see this tab. Shared job pool updated ${d?.pool_updated ? ago(d.pool_updated) : "not yet"}.</p></div></div>

    <section class="panel">
      <div class="panel-head"><h2>Requests</h2><span class="count">${reqs.length}</span></div>
      ${reqs.length === 0 ? html`<p class="empty-s">New invite and upgrade requests show up here.</p>` : html`<div class="doclist">${reqs.map((r) => html`<div class="docrow">
        <div class="docname static"><b>${r.name ? `${r.name}, ` : ""}${r.email}</b>
          <small>${r.kind === "upgrade" ? `wants to move to ${planById(r.plan).name}` : `asked for an invite, ${planById(r.plan).name} plan`}, ${ago(r.at)}</small>
          ${r.note ? html`<span class="note">${r.note}</span>` : null}</div>
        <div class="row">
          ${r.kind === "upgrade"
            ? html`<button class="btn primary small" onClick=${() => change({ setPlan: r.email, plan: r.plan }, `${r.email} is on ${planById(r.plan).name} now.`)}>Move to ${planById(r.plan).name}</button>`
            : html`<button class="btn primary small" onClick=${() => change({ add: r.email, note: r.name, plan: r.plan }, `${r.email} can sign in now. Send them the link.`)}>Approve</button>`}
          <button class="btn small" onClick=${() => change({ dismiss: r.email, kind: r.kind })}>Dismiss</button>
        </div></div>`)}</div>`}
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Invite someone</h2></div>
      <div class="invite-row">
        <input class="input" placeholder="friend@example.com or GitHub username" value=${add} onInput=${(e) => setAdd(e.target.value)} />
        <input class="input" placeholder="Name (optional)" value=${note} onInput=${(e) => setNote(e.target.value)} />
        <select class="input" value=${plan} onChange=${(e) => setPlan(e.target.value)}>${PLANS.map((p) => html`<option value=${p.id}>${p.name}</option>`)}</select>
        <button class="btn primary" disabled=${!add.trim()} onClick=${() => { change({ add: add.trim(), note, plan }, `${add.trim()} can sign in now. Send them the link.`); setAdd(""); setNote(""); }}>Invite</button>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Invited</h2><span class="count">${people.length}</span></div>
      ${people.length === 0 ? html`<p class="empty-s">Nobody invited yet.</p>` : html`<div class="doclist">${people.map((p) => html`<div class="docrow">
        <div class="docname static"><b>${p.id}</b><small>${p.note || "Invited"} ${p.added ? ago(p.added) : ""}</small></div>
        <div class="row">
          <select class="input slim" aria-label=${`Plan for ${p.id}`} value=${p.plan || "free"} onChange=${(e) => change({ setPlan: p.id, plan: e.target.value }, `${p.id} moved to ${planById(e.target.value).name}.`)}>
            ${PLANS.map((x) => html`<option value=${x.id}>${x.name}</option>`)}</select>
          <button class="btn small" onClick=${() => { if (confirm(`Remove ${p.id}? They won't be able to sign in. Their data stays until you delete it in Azure.`)) change({ remove: p.id }); }}>Remove</button>
        </div></div>`)}</div>`}
    </section>

    <section class="panel">
      <div class="panel-head"><h2>People using it</h2></div>
      <div class="doclist">${(d?.users || []).map((u) => html`<div class="docrow">
        <div class="docname static"><b>${u.name}</b>
          <small>${u.jobs != null ? `${u.jobs} jobs` : "no resume yet"}${u.run?.state ? `, last run ${u.run.state === "finished" ? (u.run.ok === false ? "failed" : "finished") : u.run.state} ${u.run.finished ? ago(u.run.finished) : ""}` : ""}${u.last_seen ? `, seen ${ago(u.last_seen)}` : ""}</small>
          ${u.run?.ok === false && u.run.note ? html`<span class="note">${u.run.note}</span>` : null}</div>
        <span class="tag">${planById(planOf(u.name) || ((d?.admins || []).includes((u.name || "").toLowerCase()) ? "pro" : "free")).name}</span>
      </div>`)}</div>
    </section>
  </div>`;
}
