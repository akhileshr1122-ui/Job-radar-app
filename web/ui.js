import { html, useState, useEffect } from "./vendor/preact-htm.js";

// ------------------------------------------------------------------ helpers

export const PIPE = ["applied", "interview", "offer", "rejected"];
export const LABEL = { saved: "Saved", applied: "Applied", interview: "Interview", offer: "Offer", rejected: "Rejected", hidden: "Not interested" };
export const scoreColor = (s) => (s >= 80 ? "var(--good)" : s >= 65 ? "var(--blue)" : s >= 50 ? "var(--warn)" : "var(--ink-3)");
export const clone = (o) => JSON.parse(JSON.stringify(o));
export const lines = (s) => (s || "").split("\n").map((x) => x.replace(/^\s*[•\-*]\s*/, "").trim()).filter(Boolean);
export const commas = (s) => (s || "").split(/,(?![^(]*\))|\n/).map((x) => x.trim()).filter(Boolean);

export function age(job) {
  const t = Date.parse(job.posted || job.first_seen || "");
  if (!t) return "";
  const h = (Date.now() - t) / 36e5;
  return h < 1 ? "now" : h < 24 ? `${Math.floor(h)}h` : `${Math.floor(h / 24)}d`;
}
export const ageHours = (job) => { const t = Date.parse(job.posted || ""); return t ? (Date.now() - t) / 36e5 : 1e9; };

export function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }
export function restore(key, d) { try { return JSON.parse(localStorage.getItem(key) || "null") ?? d; } catch { return d; } }

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export function Ring({ score, big }) {
  return html`<div class=${"ring" + (big ? " big" : "")} style=${`--p:${score};--c:${scoreColor(score)}`} aria-label=${`Match score ${score} of 100`}><span>${score}</span></div>`;
}

export const ago = (t) => (age({ posted: t }) === "now" ? "just now" : age({ posted: t }) + " ago");
export const firstName = (resume) => ((resume?.contact?.name || "").trim().split(/\s+/)[0] || "");
