// Public homepage for the hosted (invite-only) Job Radar: what it does, plans, request an invite, sign in.
import { html, useState } from "./vendor/preact-htm.js";
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
      <div class="chips">${PLANS.map((p) => html`<button type="button" class="chip" aria-pressed=${plan === p.id} onClick=${() => setPlan(p.id)}>${p.name}${p.price ? `, ${priceText(p)}/${p.period}` : ", free"}</button>`)}</div></div>
    <div class="field"><label for="rq-note">What kind of job are you looking for? (optional)</label><textarea id="rq-note" class="input" rows="3" value=${v.note} onInput=${set("note")}></textarea></div>
    <input class="hp" tabindex="-1" autocomplete="off" aria-hidden="true" value=${v.website} onInput=${set("website")} />
    <div class="row"><button class="btn primary big" disabled=${busy || !v.email.trim()}>${busy ? "Sending…" : "Request an invite"}</button></div>
  </form>`;
}

export function Landing({ api, me, say }) {
  backendSignIn = api.signIn;
  const [plan, setPlan] = useState("free");
  const [showSignIn, setShowSignIn] = useState(false);
  const notInvited = me?.signedIn && !me.allowed;
  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const choose = (id) => { setPlan(id); go("invite"); };

  return html`<div class="landing">
    <header class="hero">
      <nav class="topnav wrap" aria-label="Main">
        <a class="wordmark" href="/"><img src="icon.svg" alt="" width="30" height="30" /><span>Job Radar</span></a>
        <span class="spacer"></span>
        <button class="navlink" onClick=${() => go("how")}>How it works</button>
        <button class="navlink" onClick=${() => go("plans")}>Plans</button>
        ${me?.signedIn ? html`<button class="btn ghost small" onClick=${api.forget}>Sign out</button>`
          : html`<button class="btn light small" onClick=${() => setShowSignIn(!showSignIn)}>Sign in</button>`}
      </nav>
      ${showSignIn ? html`<div class="wrap"><div class="signin-pop"><${SignInChoices} /></div></div>` : null}
      ${notInvited ? html`<div class="wrap"><div class="notice">
        You're signed in as <b>${me.user}</b>, which isn't on the invite list yet. Send a request below, or ask the person who invited you to add exactly that address.</div></div>` : null}
      <div class="wrap herogrid">
        <div class="herocopy">
          <h1>Every job that fits your resume, with a resume written for each one.</h1>
          <p class="lede">Job Radar checks job boards and hundreds of company career pages every 4 hours, scores each posting against your experience, and tailors your resume and cover letter before you even open it.</p>
          <div class="row">
            <button class="btn amber big" onClick=${() => go("invite")}>Request an invite</button>
            ${!me?.signedIn ? html`<button class="btn ghost big" onClick=${() => setShowSignIn(true)}>Sign in</button>` : null}
          </div>
          <p class="fine">Invite-only. Canada and the US. Free to start.</p>
        </div>
        <${Radar} />
      </div>
    </header>

    <section id="how" class="wrap section">
      <h2>How it works</h2>
      <ol class="howsteps">
        <li><b>Upload your resume.</b> Job Radar reads it once and builds your profile and search: the titles you fit, your city, your skills. You can change any of it.</li>
        <li><b>It searches while you're busy.</b> Every 4 hours it reads job boards, remote job sites and hundreds of company career pages, then drops staffing-agency reposts and stale ads.</li>
        <li><b>Review, edit, apply.</b> Each match comes with its own resume and cover letter. See exactly what changed from your standard resume, edit anything, then apply in one tap and track it.</li>
      </ol>
    </section>

    <section class="wrap section split">
      <div>
        <h2>You always see why a job matched</h2>
        <p>Every posting gets a score out of 100 from the title, seniority, skills the posting asks for, location and freshness. The reasons are listed, and so are the skills it asks for that your profile doesn't mention.</p>
        <p>Your tailored resume never invents anything. Companies, titles, dates and numbers stay exactly as you wrote them; only the order, headline, summary and the bullets chosen change.</p>
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

    <section id="plans" class="wrap section">
      <h2>Plans</h2>
      <p class="hint">Start free. Upgrade any time from inside the app.</p>
      <div class="plans">
        ${PLANS.map((p) => html`<div class=${"plan" + (p.highlight ? " hl" : "")}>
          <h3>${p.name}</h3>
          <div class="price">${priceText(p)}<small>/${p.period}</small></div>
          <p class="hint">${p.blurb}</p>
          <ul>${p.features.map((f) => html`<li>${f}</li>`)}</ul>
          <button class=${"btn " + (p.highlight ? "primary" : "")} onClick=${() => choose(p.id)}>${p.price ? `Request ${p.name}` : "Request an invite"}</button>
        </div>`)}
      </div>
    </section>

    <section id="invite" class="wrap section invite">
      <div>
        <h2>Request an invite</h2>
        <p>Job Radar is run for a small group. Send a request and you'll be added; then sign in with the same email.</p>
        ${!me?.signedIn ? html`<p class="hint">Already invited?</p><${SignInChoices} compact />` : null}
      </div>
      <${RequestForm} api=${api} me=${me} plan=${plan} setPlan=${setPlan} say=${say} />
    </section>

    <footer class="wrap foot">
      <span>Job Radar</span><span class="spacer"></span>
      <span class="hint">Your resume and results are private to your account. Applications are always submitted by you.</span>
    </footer>
  </div>`;
}
