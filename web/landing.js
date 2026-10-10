// Public homepage for the hosted (invite-only) Job Radar: what it does, plans, request an invite, sign in.
import { html, useState, useEffect } from "./vendor/preact-htm.js";
import { PLANS, priceText } from "./plans.js";

const BLIPS = [
  // x, y on a 400×400 scope, score, title, delay (s)
  [300, 100, 92, "E-commerce Manager", 0.4],
  [92, 168, 84, "Marketplace Lead, Amazon", 1.1],
  [306, 246, 76, "Digital Channel Manager", 1.8],
  [140, 304, 68, "Operations Analyst", 2.5],
];

function Radar() {
  return html`<svg class="scope" viewBox="0 0 400 400" role="img" aria-label="A radar picking up matching jobs with their match scores">
    <defs>
      <radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#7FD3C3" stop-opacity=".16" /><stop offset="1" stop-color="#7FD3C3" stop-opacity="0" /></radialGradient>
      <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7FD3C3" stop-opacity="0" /><stop offset="1" stop-color="#7FD3C3" stop-opacity=".45" /></linearGradient>
    </defs>
    <circle cx="200" cy="200" r="190" fill="url(#glow)" />
    ${[60, 120, 180].map((r) => html`<circle cx="200" cy="200" r=${r} fill="none" stroke="#7FD3C3" stroke-opacity=".28" />`)}
    <path d="M200 20V380M20 200H380" stroke="#7FD3C3" stroke-opacity=".16" />
    <g class="sweep"><path d="M200 200 L200 20 A180 180 0 0 1 327.3 72.7 Z" fill="url(#beam)" /><path d="M200 200 L327.3 72.7" stroke="#7FD3C3" stroke-width="1.5" stroke-opacity=".8" /></g>
    ${BLIPS.map(([x, y, s, t, d]) => {
      const left = x > 200;
      const w = t.length * 7.2 + 44;
      const bx = left ? x - w - 12 : x + 12;
      return html`<g class="blip" style=${`animation-delay:${d}s`}>
        <circle cx=${x} cy=${y} r="11" fill="#E9A23B" fill-opacity=".22" /><circle cx=${x} cy=${y} r="4.5" fill="#E9A23B" />
        <rect x=${bx} y=${y - 14} width=${w} height="28" rx="14" fill="#0B3843" stroke="#7FD3C3" stroke-opacity=".35" />
        <text x=${bx + 12} y=${y + 5} fill="#E9A23B" font-weight="700" font-size="13">${s}</text>
        <text x=${bx + 36} y=${y + 5} fill="#E6F2EF" font-size="12.5">${t}</text>
      </g>`;
    })}
  </svg>`;
}

function SignInChoices({ compact }) {
  return html`<div class=${"signin" + (compact ? " compact" : "")}>
    <div class="row">
      <button class="btn primary" onClick=${() => backendSignIn("aad")}>Sign in with Microsoft</button>
      <button class="btn" onClick=${() => backendSignIn("github")}>Sign in with GitHub</button>
    </div>
    <p class="hint">Use the email your invite was sent to. Gmail or another email? Choose Microsoft, then "Create one!" to make a free Microsoft account with that same address.</p>
  </div>`;
}
let backendSignIn = () => {};

function RequestForm({ api, me, plan, setPlan, say }) {
  const [v, setV] = useState({ name: "", email: me?.signedIn ? me.user : "", note: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  async function send(e) {
    e.preventDefault();
    setBusy(true);
    try { await api.requestAccess({ ...v, plan }); setSent(true); } catch (err) { say(err.message); }
    setBusy(false);
  }
  if (sent) return html`<div class="sent"><h3>Request sent</h3>
    <p>Once you're added, come back here and sign in with <b>${v.email}</b>. Your first matches arrive about 10 minutes after you upload your resume.</p></div>`;
  return html`<form class="reqform" onSubmit=${send}>
    <div class="grid2">
      <div class="field"><label for="rq-name">Your name</label><input id="rq-name" class="input" autocomplete="name" value=${v.name} onInput=${set("name")} /></div>
      <div class="field"><label for="rq-email">Email you'll sign in with</label><input id="rq-email" class="input" required autocomplete="email" value=${v.email} onInput=${set("email")} placeholder="you@example.com or a GitHub username" /></div>
    </div>
    <div class="field"><label>Plan</label>
      <div class="chips">${PLANS.map((p) => html`<button type="button" class="chip" aria-pressed=${plan === p.id} onClick=${() => setPlan(p.id)}>${p.name}${p.price ? `, ${priceText(p)}/${p.period}` : ""}</button>`)}</div></div>
    <div class="field"><label for="rq-note">What kind of job are you looking for? (optional)</label><textarea id="rq-note" class="input" rows="3" value=${v.note} onInput=${set("note")}></textarea></div>
    <input class="hp" tabindex="-1" autocomplete="off" aria-hidden="true" value=${v.website} onInput=${set("website")} />
    <div class="row"><button class="btn primary big" disabled=${busy || !v.email.trim()}>${busy ? "Sending…" : "Request an invite"}</button></div>
  </form>`;
}

const PAGES = [["", "Overview"], ["product", "Product"], ["coverage", "Coverage"], ["privacy", "Privacy"], ["plans", "Plans"], ["faq", "FAQ"]];
const pageFromHash = () => { const h = location.hash.replace(/^#\/?/, ""); return PAGES.some(([k]) => k === h) ? h : ""; };
const n = (x) => (x == null ? "" : x >= 1000 ? x.toLocaleString() : String(x));

function useStats(api) {
  const [s, setS] = useState(null);
  useEffect(() => { api.publicStats?.().then(setS).catch(() => {}); }, []);
  return s;
}

function Pipeline() {
  const steps = [
    ["Collect", "Job boards, search engines, remote boards and hundreds of employers' own career pages, every 4 hours."],
    ["Clean", "Duplicates merged across sources. Staffing-agency reposts, LMIA ads and postings that never close are dropped."],
    ["Score", "Each posting is scored out of 100 against your titles, seniority, skills, location and how recent it is."],
    ["Tailor", "Your best matches get their own resume and cover letter, built only from your real experience."],
    ["Apply & track", "Review every change, edit, apply in one tap, and follow it from saved to offer."],
  ];
  return html`<ol class="pipeline">${steps.map(([t, d], i) => html`<li style=${`--i:${i}`}><span class="pl-dot"></span><b>${t}</b><p>${d}</p></li>`)}</ol>`;
}

function TopNav({ page, go, me, api, showSignIn, setShowSignIn, dark }) {
  const [open, setOpen] = useState(false);
  return html`<nav class=${"topnav wrap" + (dark ? "" : " on-light")} aria-label="Main">
    <a class="wordmark" href="#" onClick=${(e) => { e.preventDefault(); go(""); }}><img src="icon.svg" alt="" width="30" height="30" /><span>Job Radar</span></a>
    <span class="spacer"></span>
    <div class=${"navlinks" + (open ? " open" : "")}>
      ${PAGES.slice(1).map(([k, l]) => html`<button class="navlink" aria-current=${page === k ? "page" : null} onClick=${() => { setOpen(false); go(k); }}>${l}</button>`)}
    </div>
    ${me?.signedIn ? html`<button class="btn ghost small" onClick=${api.forget}>Sign out</button>`
      : html`<button class="btn light small" onClick=${() => setShowSignIn(!showSignIn)}>Sign in</button>`}
    <button class="menu-btn" aria-label="Menu" aria-expanded=${open} onClick=${() => setOpen(!open)}><span></span><span></span><span></span></button>
  </nav>`;
}

function PageHero({ title, lede }) {
  return html`<div class="wrap pagehero"><h1>${title}</h1>${lede ? html`<p class="lede">${lede}</p>` : null}</div>`;
}

function CTA({ go }) {
  return html`<section class="wrap"><div class="cta">
    <div><h2>Let the search run in the background.</h2><p>Upload your resume once. Job Radar keeps looking every 4 hours and has a tailored resume waiting for every good match.</p></div>
    <button class="btn amber big" onClick=${() => go("plans", "invite")}>Request an invite</button>
  </div></section>`;
}

function Overview({ go, stats }) {
  const hours = stats?.postings ? Math.round((stats.postings * 20) / 3600) : null;
  return html`
    <section class="wrap" aria-label="Last search"><div class="statband">
      <div><b>${stats?.postings ? n(stats.postings) : "6,000+"}</b><span>postings checked in the last search</span></div>
      <div><b>${stats?.sources || "14"}</b><span>sources, from job boards to employers' own career pages</span></div>
      <div><b>${stats?.companies ? n(stats.companies) : "1,000+"}</b><span>employers seen in one search</span></div>
      <div><b>4 h</b><span>between searches, day and night</span></div>
    </div></section>

    <section class="wrap section">
      <h2>The whole job search, end to end</h2>
      <p class="sublede">Most tools stop at a list of links. Job Radar carries every posting from the moment it appears to the moment you apply.</p>
      <${Pipeline} />
    </section>

    <section class="wrap section compare">
      <h2>What it takes off your plate</h2>
      <div class="cmp">
        <div class="cmp-h"><span></span><b>Doing it yourself</b><b class="jr">With Job Radar</b></div>
        ${[["Finding jobs", "Searching a dozen sites every day and still missing roles posted only on company career pages.", "Every source checked every 4 hours, including hundreds of employers' own career pages."],
          ["Reading postings", hours ? `Reading ${n(stats.postings)} postings at 20 seconds each is about ${hours} hours.` : "Hours of scrolling past roles that don't fit.", "Each posting scored in seconds, with the reasons it matched and the skills it asks for that you haven't listed."],
          ["Avoiding dead ends", "Agency reposts, the same job on five sites, ads that stay up for months.", "Duplicates merged; agency reposts, LMIA ads and stale listings filtered out."],
          ["Tailoring", "30 to 45 minutes per application to adjust a resume and write a cover letter.", "A tailored resume and cover letter ready for your best matches before you open them."],
          ["Keeping track", "A spreadsheet that falls behind after week two.", "A tracker from saved to offer, with follow-up reminders and reply rates."]]
          .map(([k, a, b]) => html`<div class="cmp-r"><span class="cmp-k">${k}</span><p>${a}</p><p class="jr">${b}</p></div>`)}
      </div>
    </section>

    <section class="wrap section split">
      <div>
        <h2>You always see why a job matched</h2>
        <p>Every posting gets a score out of 100 from the title, seniority, the skills the posting asks for, location and freshness. The reasons are listed, and so are the skills it wants that your profile doesn't mention yet.</p>
        <p>Your tailored resume never invents anything. Companies, titles, dates and numbers stay exactly as you wrote them; only the headline, summary, skill order and the bullets chosen change, and every change is highlighted before you apply.</p>
        <button class="link" onClick=${() => go("product")}>See everything it does</button>
      </div>
      <div class="sample" aria-label="Example of a matched job">
        <div class="sample-head"><div class="ring big" style="--p:87;--c:var(--good)"><span>87</span></div>
          <div><b>Senior E-commerce Manager</b><div class="hint">Northwind Outdoor, Toronto, ON, posted 6h ago</div></div></div>
        <ul class="reasons">
          <li>Title matches "e-commerce manager"</li>
          <li>Asks for Amazon Seller Central, Shopify, marketplace P&L</li>
          <li>18 km from you</li>
        </ul>
        <div class="sample-diff">
          <p><span class="added">Amazon Vendor and Seller Central</span>, Walmart Marketplace, Shopify Plus</p>
          <p>Led a marketplace automation that <span class="changed">cut purchase-order processing from days to minutes</span>.</p>
          <p class="dropped">Coordinated trade-show logistics for regional distributors.</p>
        </div>
        <div class="legend"><span><span class="added">green</span> added for this job</span><span><span class="changed">amber</span> reworded</span><span><span class="dropped">struck</span> left out</span></div>
      </div>
    </section>

    <section id="how" class="wrap section">
      <h2>Up and running in three steps</h2>
      <ol class="howsteps">
        <li><b>Upload your resume.</b> Job Radar reads it once and builds your profile and search: the titles you fit, your city, your skills. You can change any of it.</li>
        <li><b>It searches while you're busy.</b> Your first matches arrive about 10 minutes later, then every 4 hours without you lifting a finger.</li>
        <li><b>Review, edit, apply.</b> Open a match, check what changed in your resume, edit anything, then apply in one tap and track it.</li>
      </ol>
    </section>`;
}

function Product({ go }) {
  const blocks = [
    ["Matching you can read", "Each job is scored out of 100. The title carries the most weight, then the skills the posting asks for, seniority, how close it is to you and how recently it was posted. You set the must-have words, the titles to skip, the cities and the radius, and the minimum salary."],
    ["A resume for every good match", "For each strong match Job Radar picks the headline, summary, skill order and supporting bullets that fit that posting. Your core bullets, employers, titles, dates and education never change. With AI switched on, wording can mirror the posting's language, but every number must match your profile exactly or the change is thrown out."],
    ["Cover letters that sound like you", "Written for the specific company and role, using only facts from your profile. Edit it, copy it, or download it with the resume."],
    ["See every change before you apply", "A side-by-side view shows what was added, reworded or left out compared with your standard resume. Edit anything, then save; the PDF and Word versions update."],
    ["One-tap apply", "Apply now downloads the right resume, copies the cover letter and opens the application. The Chrome extension fills in the form from your profile; you check it and press submit yourself."],
    ["Interview prep", "Likely questions with answers drawn from your own experience, the gaps to prepare for, and questions to ask them."],
    ["A tracker that keeps up", "Saved, applied, interview, offer. Notes and dates are kept, applications with no reply after a week are flagged for follow-up, and Insights shows your reply rate and the skills employers keep asking for."],
    ["Works on your phone", "Add Job Radar to your home screen and it opens like an app. Everything stays in sync with your computer."],
  ];
  return html`<${PageHero} title="Built to do the slow parts of a job search for you" lede="Job Radar collects, filters, scores and tailors. You make the decisions and press submit." />
    <section class="wrap section"><div class="featurelist">${blocks.map(([t, d], i) => html`<article class=${i === 0 || i === 3 ? "wide" : i === blocks.length - 1 ? "full" : ""}><h3>${t}</h3><p>${d}</p></article>`)}</div></section>
    <section class="wrap section"><h2>How a posting becomes an application</h2><${Pipeline} /></section>
    <${CTA} go=${go} />`;
}

function Coverage({ go, stats }) {
  const groups = [
    ["Job boards and search engines", "Adzuna, Jooble and Google for Jobs listings, searched with your own job titles and city.", stats?.groups?.boards],
    ["Employers' own career pages", "Openings read straight from companies' hiring systems (Greenhouse, Lever, Ashby, Workable, SmartRecruiters and Workday), often before they reach job boards.", stats?.groups?.career],
    ["Big employers", "Amazon's own job search and large brands' Workday career sites.", stats?.groups?.brands],
    ["Remote job boards", "We Work Remotely, Remote OK, Himalayas, Jobicy, Remotive and Working Nomads, for roles you can do from home.", stats?.groups?.remote],
  ];
  return html`<${PageHero} title="Wide coverage, cleaned up for you" lede=${stats?.postings ? `The last search read ${n(stats.postings)} postings from ${stats.sources} sources and ${n(stats.companies)} employers${stats.updated ? `, ${new Date(stats.updated).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}.` : "Every 4 hours Job Radar reads job boards, search engines and employers' own career pages."} />
    <section class="wrap section covgrid">${groups.map(([t, d, c]) => html`<article><div class="cov-n">${c ? n(c) : ""}</div><h3>${t}</h3><p>${d}</p></article>`)}</section>
    <section class="wrap section split top">
      <div><h2>What gets filtered out</h2><p>The same job posted on five sites shows up once, from the best source. Staffing-agency reposts, ads asking for LMIA or temporary foreign workers, postings with no company, and listings that have stayed open for weeks are dropped before you see them. You can switch any of these filters off.</p></div>
      <div><h2>Canada and the US</h2><p>Searches follow your city and radius, or the whole country. US roles are included when they're remote and open to you; on-site US roles only if you ask for them.</p></div>
    </section>
    <p class="wrap fine-dark">Job Radar links to each original posting and never re-publishes full job ads. Applications are always submitted by you on the employer's or board's own site.</p>
    <${CTA} go=${go} />`;
}

function Privacy({ go }) {
  const items = [
    ["Your data stays yours", "Your resume, matches, tracker and tailored resumes are kept in your own private account space. Other members can't see them; only the person who runs this Job Radar manages the storage it lives in."],
    ["Nothing is ever invented", "Tailoring only re-orders and re-words what's already in your profile. Numbers that aren't in your profile are rejected automatically."],
    ["You press submit", "Job Radar never applies on your behalf. It prepares everything and opens the application; you review and send it."],
    ["Your AI, your choice", "AI rewriting is optional. Use your own Claude plan, or the AI included in a paid plan. Your token is stored on the server, used only for your resumes and never shown back to anyone."],
    ["Sign in without passwords", "Sign in with Microsoft or GitHub. Job Radar never sees or stores a password."],
    ["Leave any time", "Ask the person who runs this Job Radar to remove your account and your data. Your uploaded resume file itself is deleted as soon as it has been read."],
  ];
  return html`<${PageHero} title="Private by design" lede="A job search is personal. Here's exactly how Job Radar treats your information." />
    <section class="wrap section privgrid">${items.map(([t, d]) => html`<article><h3>${t}</h3><p>${d}</p></article>`)}</section>
    <${CTA} go=${go} />`;
}

function Faq({ go }) {
  const qa = [
    ["Is it free?", "Yes. The Free plan includes matches from every source, tailored resumes and the tracker. Paid plans add more resumes per search and AI writing without needing your own Claude account."],
    ["Does it apply to jobs for me?", "No. It prepares the resume and cover letter and opens the application. You review and submit, so nothing goes out in your name without you seeing it."],
    ["Where do the jobs come from?", "Job boards and search engines, remote job boards, and employers' own career pages. See the Coverage page for the full list."],
    ["Will it make things up on my resume?", "No. It only uses your real experience, and any change that adds a number not in your profile is rejected. You see every change highlighted before you apply."],
    ["Which countries does it cover?", "Canada and the US. You choose cities and a radius, or the whole country, and whether to include remote roles."],
    ["How do I get in?", "Job Radar is invite-only. Request an invite with the email you'll sign in with; you'll be able to sign in once you're added."],
    ["Can I use it on my phone?", "Yes. Open it in your phone's browser and add it to your home screen; it opens like an app."],
  ];
  return html`<${PageHero} title="Questions" />
    <section class="wrap section faq">${qa.map(([q, a]) => html`<details><summary>${q}</summary><p>${a}</p></details>`)}</section>
    <${CTA} go=${go} />`;
}

function PlansPage({ choose }) {
  return html`<${PageHero} title="Plans" lede="Start free. Upgrade any time from inside the app." />
    <section class="wrap section"><div class="plans">
      ${PLANS.map((p) => html`<div class=${"plan" + (p.highlight ? " hl" : "")}>
        <h3>${p.name}</h3>
        <div class="price">${priceText(p)}<small>/${p.period}</small></div>
        <p class="hint">${p.blurb}</p>
        <ul>${p.features.map((f) => html`<li>${f}</li>`)}</ul>
        <button class=${"btn " + (p.highlight ? "primary" : "")} onClick=${() => choose(p.id)}>${p.price ? `Request ${p.name}` : "Request an invite"}</button>
      </div>`)}
    </div></section>`;
}

export function Landing({ api, me, say }) {
  backendSignIn = api.signIn;
  const [plan, setPlan] = useState("free");
  const [page, setPage] = useState(pageFromHash());
  const [showSignIn, setShowSignIn] = useState(false);
  const stats = useStats(api);
  useEffect(() => { const on = () => setPage(pageFromHash()); addEventListener("hashchange", on); return () => removeEventListener("hashchange", on); }, []);
  const notInvited = me?.signedIn && !me.allowed;
  const go = (p, anchor) => {
    if (p !== page) { history.pushState(null, "", p ? "#" + p : location.pathname); setPage(p); }
    setTimeout(() => (anchor ? document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth" }) : scrollTo(0, 0)), 30);
  };
  const choose = (id) => { setPlan(id); setTimeout(() => document.getElementById("invite")?.scrollIntoView({ behavior: "smooth" }), 30); };
  const isHome = page === "";

  return html`<div class="landing">
    <header class=${"hero" + (isHome ? "" : " slim")}>
      <${TopNav} page=${page} go=${go} me=${me} api=${api} showSignIn=${showSignIn} setShowSignIn=${setShowSignIn} dark=${true} />
      ${showSignIn ? html`<div class="wrap"><div class="signin-pop"><${SignInChoices} /></div></div>` : null}
      ${notInvited ? html`<div class="wrap"><div class="notice">
        You're signed in as <b>${me.user}</b>, which isn't on the invite list yet. Send a request below, or ask the person who invited you to add exactly that address.</div></div>` : null}
      ${isHome ? html`<div class="wrap herogrid">
        <div class="herocopy">
          <h1>Every job that fits your resume, with a resume written for each one.</h1>
          <p class="lede">Job Radar reads job boards and hundreds of employers' career pages every 4 hours, scores every posting against your experience, and has a tailored resume and cover letter ready before you open it.</p>
          <div class="row">
            <button class="btn amber big" onClick=${() => go("", "invite")}>Request an invite</button>
            <button class="btn ghost big" onClick=${() => go("product")}>See how it works</button>
          </div>
          <p class="fine">Invite-only. Canada and the US. Free to start.</p>
        </div>
        <${Radar} />
      </div>` : null}
    </header>

    <main>
      ${page === "product" ? html`<${Product} go=${go} />`
        : page === "coverage" ? html`<${Coverage} go=${go} stats=${stats} />`
        : page === "privacy" ? html`<${Privacy} go=${go} />`
        : page === "faq" ? html`<${Faq} go=${go} />`
        : page === "plans" ? html`<${PlansPage} choose=${choose} />`
        : html`<${Overview} go=${go} stats=${stats} />
          <section id="plans" class="wrap section"><h2>Plans</h2><p class="sublede">Start free. Upgrade any time from inside the app.</p>
            <div class="plans">${PLANS.map((p) => html`<div class=${"plan" + (p.highlight ? " hl" : "")}>
              <h3>${p.name}</h3><div class="price">${priceText(p)}<small>/${p.period}</small></div><p class="hint">${p.blurb}</p>
              <ul>${p.features.map((f) => html`<li>${f}</li>`)}</ul>
              <button class=${"btn " + (p.highlight ? "primary" : "")} onClick=${() => choose(p.id)}>${p.price ? `Request ${p.name}` : "Request an invite"}</button></div>`)}</div></section>`}

      ${["", "plans"].includes(page) ? html`<section id="invite" class="wrap section invite">
        <div>
          <h2>Request an invite</h2>
          <p>Job Radar is run for a small group. Send a request and you'll be added; then sign in with the same email.</p>
          ${!me?.signedIn ? html`<p class="hint">Already invited?</p><${SignInChoices} compact />` : null}
        </div>
        <${RequestForm} api=${api} me=${me} plan=${plan} setPlan=${setPlan} say=${say} />
      </section>` : null}
    </main>

    <footer class="sitefoot">
      <div class="wrap footgrid">
        <div><a class="wordmark dark" href="#" onClick=${(e) => { e.preventDefault(); go(""); }}><img src="icon.svg" alt="" width="26" height="26" /><span>Job Radar</span></a>
          <p class="hint">Jobs that fit your resume, with a resume written for each one.</p></div>
        <nav aria-label="Footer">${PAGES.slice(1).map(([k, l]) => html`<button class="link" onClick=${() => go(k)}>${l}</button>`)}</nav>
        <p class="hint">Applications are always submitted by you. Job Radar links to original postings and doesn't re-publish them.</p>
      </div>
    </footer>
  </div>`;
}
