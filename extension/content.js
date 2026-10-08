// Runs on application pages. Adds a "Fill with Job Radar" button; filling only happens when you click it,
// and it never presses Submit — you review everything first.
(() => {
  if (window.__jobRadar) return;
  window.__jobRadar = true;

  const looksLikeForm = () => document.querySelector('input[type="file"], input[type="email"], input[name*="name" i], [data-automation-id*="legalName"]');

  // ------------------------------------------------------------ setting values so React/Vue/Angular forms notice
  function setValue(el, value) {
    if (value == null || value === "") return false;
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
    el.style.outline = "2px solid #E9A23B";
    return true;
  }

  function labelOf(el) {
    const bits = [el.getAttribute("aria-label"), el.placeholder, el.name, el.id, el.getAttribute("data-automation-id"), el.getAttribute("autocomplete")];
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) bits.push(l.textContent); }
    const wrapLabel = el.closest("label"); if (wrapLabel) bits.push(wrapLabel.textContent);
    const by = el.getAttribute("aria-labelledby");
    if (by) by.split(/\s+/).forEach((id) => { const n = document.getElementById(id); if (n) bits.push(n.textContent); });
    // question text sitting just above the field (Lever, Ashby, Workday)
    const box = el.closest("li, .application-question, .field, [class*='question' i], [class*='field' i], [data-automation-id*='formField']");
    if (box) { const q = box.querySelector("label, legend, .text, [class*='label' i]"); if (q) bits.push(q.textContent); }
    return bits.filter(Boolean).join(" ").toLowerCase().replace(/\s+/g, " ").slice(0, 300);
  }

  function rules(k) {
    const c = k.contact, a = k.answers;
    const full = c.name || a.full_name || "";
    const [first, ...rest] = full.split(/\s+/);
    const last = rest.join(" ");
    const yes = (v) => /^y/i.test(String(v || ""));
    const authorized = a.work_authorization_canada || a.work_authorization || (c.work_authorization ? "Yes" : "");
    return [
      [/first.?name|given.?name|legalname.*first|fname/, first],
      [/last.?name|family.?name|surname|legalname.*last|lname/, last],
      [/preferred.?name/, first],
      [/^(?!.*(company|employer|school|reference|user|manager|recruiter)).*\b(full.?name|your name|name)\b/, full],
      [/e-?mail/, c.email || a.email],
      [/phone|mobile|cell/, c.phone || a.phone],
      [/linkedin/, c.linkedin || a.linkedin],
      [/website|portfolio|personal site|github/, a.website || a.portfolio || ""],
      [/\bcity\b|location|address.*city|where.*(live|based)/, a.city || c.location],
      [/current.?(company|employer)|most recent (company|employer)/, k.current.company],
      [/current.?(title|role|position)|job title/, k.current.title],
      [/salary|compensation|pay expectation/, a.salary_expectation_cad || a.salary_expectation || ""],
      [/notice period|start date|when can you start|availability/, a.notice_period || ""],
      [/years.*experience|experience.*years/, a.years_experience || ""],
      [/relocat/, a.willing_to_relocate || ""],
      [/sponsor/, a.requires_sponsorship_canada || a.requires_sponsorship || (authorized ? "No" : "")],
      [/authori[sz]ed|eligible to work|legally (able|entitled)|work permit|right to work/, yes(authorized) || /resident|citizen/i.test(authorized) ? "Yes" : authorized],
      [/cover.?letter/, k.coverLetter],
      ...Object.entries(a).map(([key, v]) => [new RegExp(key.replace(/_/g, ".?"), "i"), v]),
    ];
  }

  function pick(label, table) {
    for (const [rx, v] of table) if (v && rx.test(label)) return String(v);
    return null;
  }

  function chooseOption(select, want) {
    const w = want.toLowerCase();
    const opt = [...select.options].find((o) => o.text.toLowerCase().trim() === w) ||
      [...select.options].find((o) => o.text.toLowerCase().startsWith(w)) ||
      [...select.options].find((o) => w.length > 2 && o.text.toLowerCase().includes(w));
    return opt ? setValue(select, opt.value) : false;
  }

  function chooseRadio(group, want) {
    const w = want.toLowerCase();
    const r = group.find((x) => labelOf(x).split(" ").includes(w) || (x.value || "").toLowerCase() === w ||
      (x.closest("label")?.textContent || "").toLowerCase().trim().startsWith(w));
    if (r && !r.checked) { r.click(); return true; }
    return false;
  }

  function attach(input, k) {
    const bytes = Uint8Array.from(atob(k.pdf), (ch) => ch.charCodeAt(0));
    const file = new File([bytes], k.fileName, { type: "application/pdf" });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  async function fill(btn) {
    btn.textContent = "Filling…";
    const res = await chrome.runtime.sendMessage({ type: "kit", url: location.href, text: document.title + " " + document.body.innerText.slice(0, 5000) });
    if (!res?.ok) { btn.textContent = "Fill with Job Radar"; toast(res?.error || "Couldn't reach Job Radar."); return; }
    const k = res.kit, table = rules(k);
    let filled = 0, attached = false;

    for (const el of document.querySelectorAll("input, textarea, select")) {
      if (el.disabled || el.readOnly || el.offsetParent === null && el.type !== "file") continue;
      const type = (el.type || "").toLowerCase();
      const label = labelOf(el);
      if (type === "file") {
        if (!attached && /resume|cv|curriculum/.test(label) && !/cover/.test(label)) { attached = attach(el, k); }
        continue;
      }
      if (["hidden", "submit", "button", "checkbox", "radio", "password", "search"].includes(type)) continue;
      if (el.value && el.tagName !== "SELECT") continue; // never overwrite what's already there
      const v = pick(label, table);
      if (!v) continue;
      if (el.tagName === "SELECT") { if (chooseOption(el, v)) filled++; }
      else if (setValue(el, v)) filled++;
    }
    // yes/no radio questions
    const groups = {};
    document.querySelectorAll('input[type="radio"]').forEach((r) => { (groups[r.name] = groups[r.name] || []).push(r); });
    for (const g of Object.values(groups)) {
      if (g.some((r) => r.checked)) continue;
      const q = labelOf(g[0]);
      const v = pick(q, table);
      if (v && /^(yes|no)$/i.test(v) && chooseRadio(g, v.toLowerCase())) filled++;
    }
    // resume dropped on a page with a single unlabeled file input
    if (!attached) {
      const files = [...document.querySelectorAll('input[type="file"]')];
      if (files.length === 1) attached = attach(files[0], k);
    }

    btn.textContent = "Fill again";
    const which = k.job ? `your resume for ${k.job.company}` : "your standard resume (this job isn't in your Job Radar list)";
    toast(`Filled ${filled} field${filled === 1 ? "" : "s"}${attached ? ` and attached ${which}` : ""}. Fields filled are outlined in amber. Check every answer, then submit.`);
  }

  function toast(msg) {
    const t = document.createElement("div");
    t.textContent = msg;
    Object.assign(t.style, { position: "fixed", right: "20px", bottom: "84px", maxWidth: "380px", background: "#1C2B2F", color: "#fff",
      padding: "12px 14px", borderRadius: "8px", font: "14px/1.45 system-ui, sans-serif", zIndex: 2147483647, boxShadow: "0 6px 24px rgba(0,0,0,.25)" });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 9000);
  }

  function addButton() {
    if (document.getElementById("job-radar-fill") || window.top !== window && !looksLikeForm()) return;
    if (!looksLikeForm()) return;
    const b = document.createElement("button");
    b.id = "job-radar-fill";
    b.type = "button";
    b.textContent = "Fill with Job Radar";
    Object.assign(b.style, { position: "fixed", right: "20px", bottom: "20px", zIndex: 2147483647, background: "#0F4C5C", color: "#fff",
      border: "0", borderRadius: "10px", padding: "12px 18px", font: "600 15px system-ui, sans-serif", cursor: "pointer", boxShadow: "0 6px 20px rgba(15,76,92,.35)" });
    b.addEventListener("click", () => fill(b));
    document.body.appendChild(b);
  }

  chrome.runtime.onMessage.addListener((m) => { if (m.type === "fill-now") { addButton(); const b = document.getElementById("job-radar-fill"); if (b) fill(b); } });
  addButton();
  new MutationObserver(() => addButton()).observe(document.documentElement, { childList: true, subtree: true });
})();
