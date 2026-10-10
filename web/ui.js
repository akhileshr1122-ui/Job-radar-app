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

/** Next automatic search: every 4 hours at the given minute past the hour (UTC hours 0,4,8,…). */
export function nextRun(minute) {
  const now = new Date();
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, minute, 0));
  while (t <= now) t.setUTCHours(t.getUTCHours() + 4);
  return t;
}
export const clock = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export function untilText(d) {
  const m = Math.max(0, Math.round((d - Date.now()) / 60000));
  return m < 60 ? `in ${m} min` : `in ${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Small radar with a turning sweep, used while a search runs. */
export function RadarPulse({ size = 44 }) {
  return html`<svg class="pulse" width=${size} height=${size} viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-opacity=".35" />
    <circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" stroke-opacity=".25" />
    <circle cx="50" cy="50" r="14" fill="none" stroke="currentColor" stroke-opacity=".2" />
    <g class="pulse-sweep"><path d="M50 50 L50 4 A46 46 0 0 1 82.5 17.5 Z" fill="currentColor" fill-opacity=".35" /></g>
    <circle class="pulse-blip" cx="68" cy="34" r="4" fill="var(--amber)" />
    <circle class="pulse-blip b2" cx="34" cy="64" r="3.5" fill="var(--amber)" />
  </svg>`;
}
