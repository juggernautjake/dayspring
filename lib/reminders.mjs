// Reminders: "remind me 30 minutes before the dentist", "remind me to call Tommy tomorrow at noon",
// "remind me tomorrow morning to take the trash out" (no time: it comes up in the morning rundown).
// Timed reminders are spoken on both the TV and the headphones at their minute, like any schedule notification.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import * as store from "./store.mjs";
import { phrase } from "./phrases.mjs";
import * as owner from "./owner.mjs";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "reminders.json");
let db = null;
function load() { if (!db) db = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { reminders: [] }; return db; }
function save() { writeFileSync(FILE, JSON.stringify(db, null, 2)); }

const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const toHM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const say = (t) => { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h >= 12 ? "p.m." : "a.m."}`; };
const ahead = (min) => (min >= 60 ? `${min % 60 ? (min / 60).toFixed(1) : min / 60} hour${min === 60 ? "" : "s"}` : `${min} minutes`);

export function add({ date, time = null, text, blockId = null, spoken = null }) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("a reminder needs a date (YYYY-MM-DD)");
  if (time && !/^\d{2}:\d{2}$/.test(time)) throw new Error("time must be HH:MM");
  if (!String(text ?? "").trim()) throw new Error("a reminder needs something to remind you about");
  const r = { id: randomUUID(), date, time, text: text.trim(), spoken: spoken ?? null, blockId, fired: false, createdAt: new Date().toISOString() };
  load().reminders.push(r); save();
  return r;
}

// A reminder some minutes before a block ("the night before" = 8 p.m. the day before).
export function beforeBlock(blockId, { minutes = 30, nightBefore = false } = {}) {
  const b = store.all().blocks.find((x) => x.id === blockId);
  if (!b) throw new Error("that event isn't on the schedule any more");
  if (nightBefore) {
    const [y, m, d] = b.date.split("-").map(Number);
    const weekday = new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long" });
    return add({ date: store.addDays(b.date, -1), time: "20:00", text: `${b.title} on ${weekday} at ${say(b.start)}`, blockId,
      spoken: `Hey ${owner.name()}, heads up for tomorrow: ${b.title} at ${say(b.start)}.` });
  }
  let at = toMin(b.start) - minutes, date = b.date;
  if (at < 0) { at += 24 * 60; date = store.addDays(b.date, -1); }
  return add({ date, time: toHM(at), text: `${b.title} at ${say(b.start)}`, blockId,
    spoken: `Hey ${owner.name()}, reminder: ${b.title} is at ${say(b.start)}, ${ahead(minutes)} from now.` });
}

// Due this minute (and not yet spoken).
export function dueAt(date, hm) {
  const out = load().reminders.filter((r) => !r.fired && r.date === date && r.time === hm);
  if (out.length) { out.forEach((r) => { r.fired = true; }); save(); }
  return out;
}
export function forDay(date) { return load().reminders.filter((r) => r.date === date).sort((a, b) => (a.time ?? "00:00").localeCompare(b.time ?? "00:00")); }
export function upcoming(n = 20) {
  const today = store.todayISO();
  return load().reminders.filter((r) => !r.fired && r.date >= today).sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? ""))).slice(0, n);
}
export function cancel(match) {
  const d = load();
  const w = String(match).toLowerCase();
  const i = d.reminders.findIndex((r) => r.id === match || (!r.fired && r.text.toLowerCase().includes(w)));
  if (i < 0) throw new Error(`no reminder matches "${match}"`);
  const [r] = d.reminders.splice(i, 1); save();
  return r;
}
export function spokenText(r) { return r.spoken ?? phrase("reminder", { text: r.text }); }
