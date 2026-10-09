// Hosted mode (Azure Static Web Apps): sign in with Microsoft or GitHub, data lives on the Job Radar server.
// Same functions as gh.js so the app works the same in both modes.

export const mode = "azure";
export let me = null;
export const conn = { owner: "", repo: "" };

const API = "/api/jr";

export async function detect() {
  try {
    const r = await fetch(`${API}/me`, { cache: "no-store", credentials: "same-origin" });
    if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) return false;
    me = await r.json();
    conn.owner = me.user || "";
    return true;
  } catch { return false; }
}
export const connected = () => !!(me && me.signedIn && me.allowed);
export const signIn = (provider) => { location.href = `/.auth/login/${provider}?post_login_redirect_uri=${encodeURIComponent(location.pathname)}`; };
export function forget() { location.href = "/.auth/logout?post_logout_redirect_uri=/"; }
export const saveConn = () => {};

async function call(url, opts = {}) {
  const r = await fetch(url, { cache: "no-store", credentials: "same-origin", ...opts });
  if (!r.ok) {
    let msg = r.status === 404 ? "Not found yet. The first search may still be running." : `The server said ${r.status}.`;
    try { msg = (await r.clone().json()).error || msg; } catch {}
    if (r.status === 401) msg = "You've been signed out. Reload the page to sign in again.";
    const e = new Error(msg);
    e.status = r.status;
    throw e;
  }
  return r;
}

const fileUrl = (path) => `${API}/file?path=${encodeURIComponent(path)}&t=${Date.now()}`;
export async function text(path) { return (await call(fileUrl(path))).text(); }
export async function json(path) { return JSON.parse(await text(path)); }
export async function blob(path) { return (await call(fileUrl(path))).blob(); }

export function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export async function putBase64(path, base64) {
  await call(`${API}/file?path=${encodeURIComponent(path)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base64 }) });
}
export const putText = (path, str) => putBase64(path, b64(str));

export async function request(type, fields) {
  await putText(`requests/${Date.now()}-${type}.json`, JSON.stringify({ type, ...fields }));
}

export async function runSearch() { await call(`${API}/run`, { method: "POST" }); }

/** Shaped like a GitHub Actions run so the Settings page can show it either way. */
export async function lastRun() {
  try {
    const s = await (await call(`${API}/run`)).json();
    if (!s.state) return null;
    return { status: s.state === "finished" ? "completed" : s.state, conclusion: s.ok === false ? "failure" : "success",
      updated_at: s.finished || s.started || s.queued, state: s.state, note: s.note || "", kind: s.kind };
  } catch { return null; }
}

export async function secrets(update) {
  const opts = update ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(update) } : {};
  return (await call(`${API}/secrets`, opts)).json();
}

export async function admin(update) {
  const opts = update ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(update) } : {};
  return (await call(`${API}/admin/allow`, opts)).json();
}

export async function fileToBase64(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Copy someone's existing GitHub Job Radar (profile, tracker, jobs and tailored resumes) into this account. */
export async function importFromGitHub({ owner, repo, token }, onStep) {
  const H = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw+json" };
  const get = async (p) => {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${p}?ref=main`, { headers: H, cache: "no-store" });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(r.status === 401 ? "That GitHub token is invalid or expired." : `GitHub said ${r.status} for ${p}.`);
    return r.text();
  };
  const resume = await get("profile/resume.json");
  if (!resume) throw new Error(`Couldn't find profile/resume.json in ${owner}/${repo}.`);
  const files = [["profile/search.json", await get("profile/search.json")], ["user/state.json", await get("user/state.json")]];
  const jobsText = await get("data/jobs.json");
  const jobs = jobsText ? JSON.parse(jobsText).jobs || [] : [];
  // tailored resumes first, then the job list (so every listed resume exists), profile last
  const ids = ["base", ...jobs.filter((j) => j.resume_pdf).map((j) => j.id)];
  let done = 0;
  const work = ids.slice();
  async function worker() {
    while (work.length) {
      const id = work.shift();
      const t = await get(`data/resumes/${id}.json`).catch(() => null);
      if (t) await putText(`data/imported/${id}.json`, t).catch(() => {});
      onStep?.(`${++done} of ${ids.length} resumes`);
    }
  }
  await Promise.all([1, 2, 3, 4, 5].map(worker));
  for (const [p, t] of files) if (t) await putText(p, t);
  if (jobsText) await putText("data/imported/jobs.json", jobsText);
  await putText("profile/resume.json", resume);
  await request("import_github", { jobs: jobs.length });
  return { jobs: jobs.length, resumes: done };
}

export const createFromTemplate = async () => { throw new Error("Not used in hosted mode."); };
export const updateFromTemplate = async () => [];
export const whoAmI = async () => me;
