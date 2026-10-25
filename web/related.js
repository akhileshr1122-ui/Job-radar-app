// Related job titles (same data and rules as engine/related.py): suggestions for search preferences and new profiles.
let families = null;
export async function loadRelated() {
  if (families) return families;
  try { families = (await (await fetch("related.json", { cache: "force-cache" })).json()).families || []; } catch { families = []; }
  return families;
}

const LEVEL = /\b(senior|sr|junior|jr|lead|principal|associate|assistant to|entry level|intern|ii|iii|iv|i)\b\.?/gi;
export function norm(t) {
  let s = String(t || "").toLowerCase().replace(/\(.*?\)|\[.*?\]/g, " ").replace(/e-commerce/g, "ecommerce").replace(/&/g, " and ");
  s = s.replace(LEVEL, " ").replace(/[^a-z0-9+/ ]/g, " ");
  return s.replace(/\s+/g, " ").trim();
}
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const contains = (big, small) => !!small && new RegExp(`(?<![a-z0-9])${esc(small)}(?![a-z0-9])`).test(big);
function matches(tn, fn) {
  if (!tn || !fn) return false;
  if (tn === fn) return true;
  return fn.split(" ").length >= 2 && contains(tn, fn);
}

export function familiesFor(titles, fams = families || []) {
  const out = [];
  for (const t of titles) {
    const tn = norm(t);
    for (const f of fams) if (!out.includes(f) && f.titles.some((x) => matches(tn, norm(x)))) out.push(f);
  }
  return out;
}

/** Related titles not already covered by `titles`, spread across the matching families. */
export function relatedTitles(titles, n = 8, fams = families || []) {
  const have = titles.map(norm);
  const pools = familiesFor(titles, fams).map((f) => f.titles.filter((x) => { const xn = norm(x); return !have.includes(xn) && !have.some((h) => matches(h, xn)); }));
  const out = [];
  while (out.length < n && pools.some((p) => p.length)) for (const p of pools) if (p.length && out.length < n) { const x = p.shift(); if (!out.includes(x)) out.push(x); }
  return out;
}

export function relatedKeywords(titles, n = 12, fams = families || []) {
  const out = [];
  for (const f of familiesFor(titles, fams)) for (const k of f.keywords || []) if (!out.includes(k)) out.push(k);
  return out.slice(0, n);
}

/** Every family name with its first titles, for "pick a direction" in a career switch. */
export const directions = (fams = families || []) => fams.map((f) => ({ name: f.name, titles: f.titles.slice(0, 4) }));
