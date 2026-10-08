const $ = (id) => document.getElementById(id);
const status = (msg, cls = "hint") => { $("status").textContent = msg; $("status").className = cls; };

chrome.storage.local.get("conn").then(({ conn }) => {
  if (conn) { $("owner").value = conn.owner || ""; $("repo").value = conn.repo || "job-radar"; $("token").value = conn.token || ""; }
  if (conn?.token) chrome.runtime.sendMessage({ type: "test" }).then((r) => r.ok ? status(`Connected as ${r.name || "you"}.`, "ok") : status(r.error, "err"));
  else status("Connect your Job Radar repo below to start.");
});

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({ conn: { owner: $("owner").value.trim(), repo: $("repo").value.trim(), token: $("token").value.trim() } });
  const r = await chrome.runtime.sendMessage({ type: "test" });
  r.ok ? status(`Connected as ${r.name || "you"}.`, "ok") : status(r.error, "err");
});

$("fill").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tab.id, { type: "fill-now" });
    window.close();
  } catch (e) {
    status("This page can't be filled (browser pages and the Chrome Web Store are off-limits).", "err");
  }
});
