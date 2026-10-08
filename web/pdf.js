// Builds the resume PDF in the browser, so edits can be downloaded and used instantly.
// Layout mirrors the engine's PDF: single column, ATS-friendly.

export function resumePdf(t, resume) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = 612, M = 43, CW = W - 2 * M, BOTTOM = 792 - 40;
  const TEAL = [15, 76, 92];
  let y = 48;
  const c = resume.contact || {};

  const need = (h) => { if (y + h > BOTTOM) { doc.addPage(); y = 44; } };
  const para = (text, size = 9.3, style = "normal", color = [25, 25, 25], indent = 0, lead = 1.32) => {
    if (!text) return;
    doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(...color);
    const lines = doc.splitTextToSize(String(text), CW - indent);
    for (const ln of lines) { need(size * lead); doc.text(ln, M + indent, y); y += size * lead; }
  };
  const section = (title) => {
    y += 8; need(24);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...TEAL);
    doc.text(title.toUpperCase(), M, y); y += 4;
    doc.setDrawColor(...TEAL); doc.setLineWidth(0.6); doc.line(M, y, W - M, y); y += 12;
  };

  doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(17, 17, 17);
  doc.text(c.display_name || c.name || "", M, y); y += 18;
  if (t.headline) para(t.headline, 10.5, "bold", TEAL);
  para([c.location, c.phone, c.email, (c.linkedin || "").replace("https://www.", "")].filter(Boolean).join("  ·  "), 8.8, "normal", [68, 68, 68]);
  if (c.work_authorization) para(c.work_authorization, 8.8, "normal", [68, 68, 68]);

  if (t.summary) { section("Summary"); para(t.summary); }
  if (t.skills?.length) { section("Core skills"); para(t.skills.join("  •  ")); }

  const roles = Object.fromEntries((resume.experience || []).map((e) => [e.id, e]));
  if (t.experience?.length) section("Professional experience");
  for (const e of t.experience || []) {
    const r = roles[e.id]; if (!r) continue;
    need(30);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.8); doc.setTextColor(17, 17, 17);
    doc.text(r.title || "", M, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(68, 68, 68);
    const dates = [r.start, r.end].filter(Boolean).join(" – ");
    doc.text(dates, W - M - doc.getTextWidth(dates), y); y += 12;
    para([r.company, r.location].filter(Boolean).join(", "), 9.1, "italic", [51, 51, 51]);
    y += 2;
    for (const b of e.bullets || []) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(9.2);
      const lines = doc.splitTextToSize(b, CW - 12);
      need(12);
      doc.setTextColor(25, 25, 25); doc.text("•", M + 2, y);
      for (const ln of lines) { need(12.2); doc.text(ln, M + 12, y); y += 12.2; }
    }
    y += 3;
  }
  const projects = (resume.projects || []).filter((p) => (t.projects || []).includes(p.name));
  if (projects.length) {
    section("Selected projects");
    for (const p of projects) para(`${p.name} – ${p.text}`);
  }
  if (resume.certifications?.length) { section("Certifications"); para(resume.certifications.join("  •  ")); }
  if (resume.education?.length) {
    section("Education");
    for (const ed of resume.education) para([ed.credential, [ed.school, ed.dates].filter(Boolean).join(", ")].filter(Boolean).join(" – "));
  }
  return doc;
}

export function fileName(resume, job) {
  const name = (resume?.contact?.name || "Resume").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const co = (job?.company || "").replace(/[^A-Za-z0-9]+/g, "").slice(0, 24);
  return `${name}_Resume${co ? "_" + co : ""}.pdf`;
}
