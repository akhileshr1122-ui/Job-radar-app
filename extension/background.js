// Holds the GitHub token and does every GitHub call, so the token never touches job sites.

const API = "https://api.github.com";

async function conn() {
  const { conn } = await chrome.storage.local.get("conn");
  return conn || {};
}

async function gh(path, as = "json") {
  const c = await conn();
  if (!c.token) throw new Error("Open the Job Radar extension and connect your repo first.");
  const r = await fetch(`${API}/repos/${c.owner}/${c.repo}/contents/${path}?ref=main&t=${Date.now()}`, {
    headers: { Authorization: `Bearer ${c.token}`, Accept: "application/vnd.github.raw+json" }, cache: "no-store",
  });
  if (!r.ok) throw new Error(r.status === 401 ? "Your GitHub token expired. Paste a new one in the extension." : `GitHub ${r.status} for ${path}`);
  return as === "json" ? r.json() : as === "base64" ? toBase64(await r.arrayBuffer()) : r.text();
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Which saved job is this application page for? Match on the link first, then company + title words. */
function matchJob(jobs, pageUrl, pageText) {
  const u = new URL(pageUrl);
  const clean = (x) => { try { const v = new URL(x); return (v.host + v.pathname).replace(/\/(apply|application)\/?$/, "").replace(/\/$/, ""); } catch { return ""; } };
  const here = clean(pageUrl);
  let best = null, bestScore = 0;
  const text = norm(pageText).slice(0, 20000);
  for (const j of jobs) {
    let s = 0;
    for (const link of [j.apply_url, j.url]) {
      const c = clean(link);
      if (c && (here.startsWith(c) || c.startsWith(here))) s += 100;
      const id = (link || "").match(/(\d{6,}|[0-9a-f]{8}-[0-9a-f-]{27,})/i);
      if (id && pageUrl.includes(id[1])) s += 80;
    }
    if (j.company && text.includes(norm(j.company))) s += 15;
    if (j.title && text.includes(norm(j.title))) s += 25;
    if (s > bestScore) { best = j; bestScore = s; }
  }
  return bestScore >= 40 ? best : null;
}

async function kit(pageUrl, pageText) {
  const [resume, jobsFile] = await Promise.all([gh("profile/resume.json"), gh("data/jobs.json").catch(() => ({ jobs: [] }))]);
  const job = matchJob(jobsFile.jobs || [], pageUrl, pageText);
  const pdfPath = job?.resume_pdf || "data/resumes/base.pdf";
  const pdf = await gh(pdfPath, "base64").catch(() => gh("data/resumes/base.pdf", "base64"));
  const name = (resume.contact?.name || "Resume").replace(/[^A-Za-z0-9]+/g, "_");
  const co = (job?.company || "").replace(/[^A-Za-z0-9]+/g, "").slice(0, 24);
  return {
    job: job ? { title: job.title, company: job.company, tailored: !!job.resume_pdf } : null,
    contact: resume.contact || {},
    answers: resume.application_answers || {},
    current: (resume.experience || [])[0] || {},
    coverLetter: job?.cover_letter || "",
    pdf, fileName: `${name}_Resume${co ? "_" + co : ""}.pdf`,
  };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "kit") {
    kit(msg.url, msg.text).then((k) => reply({ ok: true, kit: k })).catch((e) => reply({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === "test") {
    gh("profile/resume.json").then((r) => reply({ ok: true, name: r.contact?.name })).catch((e) => reply({ ok: false, error: e.message }));
    return true;
  }
});
