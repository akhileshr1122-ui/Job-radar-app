// Talks to the person's own private Job Radar repo on GitHub. Nothing leaves their browser except calls to api.github.com.

export const TEMPLATE = { owner: "akhileshr1122-ui", repo: "Job-radar-app" };

const KEY = "jobradar.conn";
function loadConn() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}
export const conn = Object.assign({ owner: "", repo: "job-radar", token: "" }, loadConn() || {});
export function saveConn(c) {
  Object.assign(conn, c);
  try { localStorage.setItem(KEY, JSON.stringify(conn)); } catch { /* private mode: lives for this tab only */ }
}
export function forget() {
  try { localStorage.removeItem(KEY); } catch {}
  conn.token = "";
}
export const connected = () => !!(conn.owner && conn.repo && conn.token);

const API = "https://api.github.com";
const H = (extra = {}) => ({ Authorization: `Bearer ${conn.token}`, "X-GitHub-Api-Version": "2022-11-28", ...extra });

function explain(status, writing) {
  if (status === 401) return "Your GitHub token is invalid or expired. Paste a new one in Settings.";
  if (status === 403) return writing ? "Your token can't write to this repo. Give it Contents: Read and write." : "Your token can't read this repo.";
  if (status === 404) return writing ? "Your token can't write to this repo. Give it Contents: Read and write." : "Not found yet. The first search may still be running.";
  if (status === 409 || status === 422) return "That file changed at the same moment. Try again.";
  return `GitHub said ${status}.`;
}

async function call(url, opts = {}, writing = false) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const e = new Error(explain(r.status, writing));
    e.status = r.status;
    throw e;
  }
  return r;
}

const contents = (path) => `${API}/repos/${conn.owner}/${conn.repo}/contents/${path}`;

export async function text(path) {
  const r = await call(`${contents(path)}?ref=main&t=${Date.now()}`, { headers: H({ Accept: "application/vnd.github.raw+json" }), cache: "no-store" });
  return r.text();
}
export async function json(path) { return JSON.parse(await text(path)); }
export async function blob(path) {
  const r = await call(`${contents(path)}?ref=main&t=${Date.now()}`, { headers: H({ Accept: "application/vnd.github.raw+json" }), cache: "no-store" });
  return r.blob();
}

async function shaOf(path) {
  const r = await fetch(`${contents(path)}?ref=main&t=${Date.now()}`, { headers: H({ Accept: "application/vnd.github+json" }), cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(explain(r.status, true));
  return (await r.json()).sha;
}

export function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function putBase64(path, base64, message) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const sha = await shaOf(path);
    const body = { message, content: base64, branch: "main", ...(sha ? { sha } : {}) };
    const r = await fetch(contents(path), { method: "PUT", headers: H({ Accept: "application/vnd.github+json" }), body: JSON.stringify(body) });
    if (r.ok) return;
    if ((r.status === 409 || r.status === 422) && attempt === 0) continue;
    throw new Error(explain(r.status, true));
  }
}
export const putText = (path, str, message) => putBase64(path, b64(str), message);

/** Ask the engine to do something (add job, prep, edits, resume import). Picked up within a few minutes. */
export async function request(type, fields) {
  const name = `requests/${Date.now()}-${type}.json`;
  await putText(name, JSON.stringify({ type, ...fields }), `app: ${type}`);
}

export async function runSearch() {
  await call(`${API}/repos/${conn.owner}/${conn.repo}/actions/workflows/search.yml/dispatches`,
    { method: "POST", headers: H({ Accept: "application/vnd.github+json" }), body: JSON.stringify({ ref: "main" }) }, true);
}

export async function lastRun() {
  try {
    const r = await call(`${API}/repos/${conn.owner}/${conn.repo}/actions/workflows/search.yml/runs?per_page=1`, { headers: H() });
    return (await r.json()).workflow_runs?.[0] || null;
  } catch { return null; }
}

export async function whoAmI(token) {
  const r = await fetch(`${API}/user`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(explain(r.status));
  return r.json();
}

/** New user: make their own private copy of Job Radar from the public template. */
export async function createFromTemplate(token, owner, name) {
  const r = await fetch(`${API}/repos/${TEMPLATE.owner}/${TEMPLATE.repo}/generate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ owner, name, private: true, description: "My Job Radar: job search + tailored resumes" }),
  });
  if (r.status === 422) throw new Error(`You already have a repo called ${name}. Connect to it instead, or pick another name.`);
  if (!r.ok) throw new Error(r.status === 403 || r.status === 404
    ? "This token can't create repositories. Use a token with the 'repo' scope (classic) or Administration: Read and write (fine-grained, all repositories)."
    : `GitHub said ${r.status}.`);
  return r.json();
}

export async function fileToBase64(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Copy the latest engine (and search workflow) from the public Job Radar into this person's copy. */
export async function updateFromTemplate(onStep) {
  const T = TEMPLATE;
  const r = await fetch(`${API}/repos/${T.owner}/${T.repo}/contents/engine?ref=main`, { headers: H({ Accept: "application/vnd.github+json" }) });
  if (!r.ok) throw new Error(`Couldn't read the latest version (GitHub said ${r.status}).`);
  const files = (await r.json()).filter((f) => f.type === "file").map((f) => f.path);
  files.push(".github/workflows/search.yml");
  let skipped = [];
  for (const p of files) {
    const src = await fetch(`${API}/repos/${T.owner}/${T.repo}/contents/${p}?ref=main`, { headers: H({ Accept: "application/vnd.github.raw+json" }) });
    if (!src.ok) continue;
    try { await putText(p, await src.text(), "Update Job Radar engine"); onStep?.(p); }
    catch (e) { if (p.startsWith(".github")) skipped.push(p); else throw e; }
  }
  return skipped;
}
