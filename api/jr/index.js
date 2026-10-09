// Job Radar hosted API (Azure Static Web Apps managed function).
// Sign-in is done by Static Web Apps (Microsoft or GitHub). This checks the invite list, then lets each person
// read and write only their own folder: users/<id>/profile, user, data, requests, uploads.

const { BlobServiceClient } = require("@azure/storage-blob");
const { QueueClient } = require("@azure/storage-queue");

const CONN = process.env.STORAGE_CONNECTION;
const CONTAINER = process.env.STORAGE_CONTAINER || "jobradar";
const QUEUE = process.env.RUN_QUEUE || "jobradar-runs";
const MAX_BYTES = 6 * 1024 * 1024;

let _box, _queue;
const box = () => (_box ||= BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER));
const queue = () => (_queue ||= new QueueClient(CONN, QUEUE));

const norm = (s) => String(s || "").trim().toLowerCase();
const admins = () => (process.env.ADMIN_USERS || "").split(/[,;\s]+/).map(norm).filter(Boolean);

function principal(req) {
  const h = req.headers["x-ms-client-principal"];
  if (!h) return null;
  try {
    const p = JSON.parse(Buffer.from(h, "base64").toString("utf8"));
    return p && p.userId ? p : null;
  } catch { return null; }
}

const uidOf = (p) => `${p.identityProvider}-${p.userId}`.replace(/[^A-Za-z0-9_-]/g, "");

// ---------------------------------------------------------------- storage helpers

async function readText(name) {
  try { return (await box().getBlobClient(name).downloadToBuffer()).toString("utf8"); }
  catch (e) { if (e.statusCode === 404) return null; throw e; }
}
async function readJson(name, dflt) {
  const t = await readText(name);
  if (t == null) return dflt;
  try { return JSON.parse(t); } catch { return dflt; }
}
async function writeBuf(name, buf, type = "application/octet-stream") {
  await box().getBlockBlobClient(name).uploadData(buf, { blobHTTPHeaders: { blobContentType: type } });
}
const writeJson = (name, obj) => writeBuf(name, Buffer.from(JSON.stringify(obj, null, 1)), "application/json");

async function enqueue(uid, search = false) {
  await queue().sendMessage(JSON.stringify({ uid, search, at: Date.now() }));
  const cur = (await readJson(`users/${uid}/data/run_status.json`, {})) || {};
  if (cur.state !== "running") await writeJson(`users/${uid}/data/run_status.json`, { ...cur, state: "queued", queued: new Date().toISOString(), kind: search ? "search" : "quick" });
}

// Plans: what each tier allows. Prices and names shown on the site live in web/plans.js.
const PLANS = {
  free: { searchNowPerDay: 3 },
  plus: { searchNowPerDay: 10 },
  pro: { searchNowPerDay: 30 },
};
const planOf = (allow, who, isAdmin) => (isAdmin ? "pro" : (allow.people.find((x) => norm(x.id) === who)?.plan || "free"));

async function requestsList() {
  return (await readJson("config/requests.json", { items: [] })) || { items: [] };
}
async function addRequest(item) {
  const r = await requestsList();
  const key = `${item.kind}|${norm(item.email)}`;
  r.items = r.items.filter((x) => `${x.kind}|${norm(x.email)}` !== key);
  r.items.unshift({ ...item, at: new Date().toISOString() });
  r.items = r.items.slice(0, 200);
  await writeJson("config/requests.json", r);
}
const clean = (s, n) => String(s || "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, n);

async function allowList() {
  return (await readJson("config/allow.json", { people: [] })) || { people: [] };
}

// ---------------------------------------------------------------- paths a person may touch

const READ_OK = /^(profile\/(resume|search)\.json|user\/state\.json|data\/[A-Za-z0-9_.\/-]+)$/;
const WRITE_OK = /^(profile\/(resume|search)\.json|user\/state\.json|requests\/[A-Za-z0-9_.-]+\.json|uploads\/resume\.(pdf|docx|doc|txt)|data\/imported\/[A-Za-z0-9_-]+\.json)$/;
const safe = (p) => typeof p === "string" && !p.includes("..") && !p.includes("\\") && !p.startsWith("/");

const TYPES = { json: "application/json", pdf: "application/pdf", md: "text/markdown; charset=utf-8", log: "text/plain; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

// ---------------------------------------------------------------- handler

const reply = (status, body, headers = {}) => ({
  status, headers: { "Cache-Control": "no-store", ...(Buffer.isBuffer(body) ? {} : { "Content-Type": "application/json" }), ...headers },
  body: Buffer.isBuffer(body) ? body : JSON.stringify(body), isRaw: Buffer.isBuffer(body),
});

async function handle(req) {
  const rest = (req.params.rest || "").replace(/\/+$/, "");
  const method = req.method.toUpperCase();
  const p = principal(req);
  const who = p ? norm(p.userDetails) : "";
  const isAdmin = !!p && admins().includes(who);
  const allow = await allowList();
  const allowed = isAdmin || (!!p && allow.people.some((x) => norm(x.id) === who));

  if (rest === "request-access" && method === "POST") {
    const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const email = clean(b.email, 120);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && !/^[A-Za-z0-9-]{1,39}$/.test(email)) return reply(400, { error: "Enter the email (or GitHub username) you'll sign in with." });
    if (b.website) return reply(200, { ok: true }); // honeypot field: bots fill it, people don't see it
    await addRequest({ kind: "access", email, name: clean(b.name, 80), note: clean(b.note, 400), plan: PLANS[b.plan] ? b.plan : "free" });
    return reply(200, { ok: true });
  }

  if (rest === "me") {
    if (!p) return reply(200, { signedIn: false });
    const uid = uidOf(p);
    if (isAdmin && !allow.people.some((x) => norm(x.id) === who)) {
      // keep admins on the invite list too, so they never get locked out while app settings reload during a deploy
      allow.people.push({ id: who, note: "Admin", plan: "pro", added: new Date().toISOString() });
      await writeJson("config/allow.json", allow);
    }
    if (allowed) {
      const acct = await readJson(`users/${uid}/account.json`, null);
      const fresh = { name: p.userDetails, provider: p.identityProvider, first_seen: acct?.first_seen || new Date().toISOString(), last_seen: new Date().toISOString() };
      if (!acct || Date.now() - Date.parse(acct.last_seen || 0) > 3600e3) await writeJson(`users/${uid}/account.json`, fresh);
    }
    return reply(200, { signedIn: true, allowed, admin: isAdmin, user: p.userDetails, provider: p.identityProvider, uid: allowed ? uid : undefined,
      plan: allowed ? planOf(allow, who, isAdmin) : undefined });
  }
  if (!p) return reply(401, { error: "Please sign in." });
  if (!allowed) return reply(403, { error: `${p.userDetails} isn't on the invite list yet. Ask the person who runs this Job Radar to add you.` });
  const uid = uidOf(p);
  const home = `users/${uid}/`;
  const q = req.query || {};

  if (rest === "file") {
    const path = q.path;
    if (!safe(path)) return reply(400, { error: "Bad path." });
    if (method === "GET") {
      if (!READ_OK.test(path)) return reply(403, { error: "Not allowed." });
      try {
        const buf = await box().getBlobClient(home + path).downloadToBuffer();
        return reply(200, buf, { "Content-Type": TYPES[path.split(".").pop()] || "application/octet-stream" });
      } catch (e) {
        if (e.statusCode === 404) return reply(404, { error: "Not found yet." });
        throw e;
      }
    }
    if (method === "PUT" || method === "POST") {
      if (!WRITE_OK.test(path)) return reply(403, { error: "Not allowed." });
      const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const buf = b.base64 != null ? Buffer.from(b.base64, "base64") : Buffer.from(String(b.text ?? ""), "utf8");
      if (buf.length > MAX_BYTES) return reply(413, { error: "That file is too big (6 MB max)." });
      if (path.endsWith(".json")) {
        try { JSON.parse(buf.toString("utf8")); } catch { return reply(400, { error: "That isn't valid JSON." }); }
      }
      await writeBuf(home + path, buf, TYPES[path.split(".").pop()] || "application/octet-stream");
      if (path.startsWith("requests/") || path.startsWith("profile/")) await enqueue(uid, false);
      return reply(200, { ok: true });
    }
  }

  if (rest === "run") {
    if (method === "POST") {
      const plan = planOf(allow, who, isAdmin);
      const stats = (await readJson(home + "data/run_requests.json", {})) || {};
      const day = new Date().toISOString().slice(0, 10);
      const used = stats.day === day ? stats.count || 0 : 0;
      const max = PLANS[plan].searchNowPerDay;
      if (used >= max) return reply(429, { error: `You've used today's ${max} on-demand searches. Your next automatic search runs within 4 hours${plan === "free" ? ", or upgrade for more" : ""}.` });
      await writeJson(home + "data/run_requests.json", { day, count: used + 1 });
      await enqueue(uid, true);
      return reply(200, { ok: true, left: max - used - 1 });
    }
    return reply(200, (await readJson(home + "data/run_status.json", null)) || {});
  }

  if (rest === "secrets") {
    const name = home + "secrets.json";
    const cur = (await readJson(name, {})) || {};
    if (method === "POST" || method === "PUT") {
      const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      for (const k of ["claude_token", "anthropic_key"]) {
        if (b[k] === "") delete cur[k];
        else if (typeof b[k] === "string") cur[k] = b[k].trim();
      }
      await writeJson(name, cur);
    }
    return reply(200, { claude_token: !!cur.claude_token, anthropic_key: !!cur.anthropic_key });
  }

  if (rest === "plan" && method === "POST") {
    const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    if (!PLANS[b.plan]) return reply(400, { error: "Unknown plan." });
    await addRequest({ kind: "upgrade", email: p.userDetails, name: "", note: clean(b.note, 400), plan: b.plan });
    return reply(200, { ok: true });
  }

  if (rest.startsWith("admin/")) {
    if (!isAdmin) return reply(403, { error: "Only the admin can do that." });
    if (rest === "admin/allow" && method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const add = norm(b.add), remove = norm(b.remove), setPlan = norm(b.setPlan), dismiss = norm(b.dismiss);
      if (add && !allow.people.some((x) => norm(x.id) === add)) allow.people.push({ id: add, note: clean(b.note, 80), plan: PLANS[b.plan] ? b.plan : "free", added: new Date().toISOString() });
      if (setPlan && PLANS[b.plan]) allow.people = allow.people.map((x) => (norm(x.id) === setPlan ? { ...x, plan: b.plan } : x));
      if (remove) allow.people = allow.people.filter((x) => norm(x.id) !== remove);
      if (add || setPlan || remove) await writeJson("config/allow.json", allow);
      if (add || setPlan || dismiss) {
        const r = await requestsList();
        const gone = norm(add || setPlan || dismiss);
        r.items = r.items.filter((x) => norm(x.email) !== gone || (dismiss && b.kind && x.kind !== b.kind));
        await writeJson("config/requests.json", r);
      }
    }
    if (rest === "admin/allow" || rest === "admin/users") {
      const users = [];
      for await (const item of box().listBlobsByHierarchy("/", { prefix: "users/" })) {
        if (item.kind !== "prefix") continue;
        const id = item.name.split("/")[1];
        const acct = await readJson(`users/${id}/account.json`, {});
        const st = await readJson(`users/${id}/data/run_status.json`, {});
        const jobs = await readJson(`users/${id}/data/jobs.json`, null);
        users.push({ id, name: acct?.name || id, provider: acct?.provider || "", last_seen: acct?.last_seen || "", run: st || {}, jobs: jobs?.count ?? null });
      }
      const pool = await box().getBlobClient("shared/pool.json").getProperties().catch(() => null);
      return reply(200, { people: allow.people, admins: admins(), users, requests: (await requestsList()).items, pool_updated: pool?.lastModified || null });
    }
  }
  return reply(404, { error: "Unknown request." });
}

module.exports = async function (context, req) {
  try {
    context.res = await handle(req);
  } catch (e) {
    context.log.error(e);
    context.res = reply(500, { error: "Something went wrong on the server. Try again in a minute." });
  }
};
module.exports.handle = handle;
