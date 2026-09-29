// Real timers, a stopwatch and time-of-day alarms. Up to 7 timers run at once, each with a name ("pasta", "Timer 2").
//   start({ ms, label })     starts right away; with no label it gets "Timer N" and asks once what it's for
//   pause/resume/cancel/addTime/rename(ref)   ref = an id, a name ("the pasta"), an ordinal ("the second one"), "all", or nothing (the newest)
//   When one ends it rings: the screen (or, with the window closed, the desktop card) says its name, plays the timer sound, and
//   repeats a gentle reminder every minute, 5 times at most, until it's dismissed. Timers that end together are said together.
// Saved in data/timers.json, so they survive a restart (one that ended while Dayspring was off rings as soon as it's back).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import * as recur from "./recur.mjs";

const FILE = () => process.env.DAYSPRING_TIMERS_FILE || join(dirname(fileURLToPath(import.meta.url)), "..", "data", "timers.json");
export const MAX = 7;
const REPEAT_MS = () => Number(process.env.DAYSPRING_TIMER_REPEAT_MS) || 60_000;
const REPEATS = 5;
let state = null;
let deps = { emit: () => {}, ring: () => {}, now: () => Date.now() };
export function setDeps(d) { deps = { ...deps, ...d }; }
const now = () => deps.now();

function load() {
  if (state) return state;
  try { state = existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), "utf8")) : null; } catch { state = null; }
  state = { timers: [], ringing: [], alarms: [], stopwatch: { running: false, startedAt: null, elapsed: 0, laps: [] }, ...(state ?? {}) };
  return state;
}
function save() {
  const f = FILE();
  try { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f + ".tmp", JSON.stringify(state, null, 1)); renameSync(f + ".tmp", f); } catch { /* not fatal */ }
  try { deps.emit("timers", snapshot()); } catch { /* no screen */ }
}
export function _reset() { state = { timers: [], ringing: [], alarms: [], stopwatch: { running: false, startedAt: null, elapsed: 0, laps: [] } }; save(); }
export function _reload() { state = null; return load(); }

const left = (t) => (t.paused ? t.remaining : Math.max(0, t.endsAt - now()));
export function snapshot() {
  const s = load();
  return {
    now: now(),
    timers: s.timers.map((t) => ({ id: t.id, label: t.label, auto: Boolean(t.auto), ms: t.ms, left: left(t), paused: Boolean(t.paused), endsAt: t.paused ? null : t.endsAt, step: t.step ?? null })),
    ringing: s.ringing.map((r) => ({ id: r.id, label: r.label, at: r.at, repeats: r.repeats })),
    stopwatch: { running: s.stopwatch.running, elapsed: stopwatchElapsed(), laps: s.stopwatch.laps },
    alarms: s.alarms.map((a) => ({ id: a.id, at: a.at, hm: a.hm, label: a.label, kind: a.kind ?? "alarm", repeat: a.repeat ?? null, off: Boolean(a.off), skip: a.skip ?? [],
      ...Object.fromEntries(["sound", "volume", "snooze", "gentle", "flash"].filter((k) => a[k] !== undefined).map((k) => [k, a[k]])) })),
  };
}
export const list = () => snapshot().timers;

// "pasta" stays "pasta"; a second pasta becomes "pasta 2"
export function cleanLabel(raw) {
  let l = String(raw ?? "").toLowerCase().replace(/[^a-z0-9' -]/g, " ").replace(/\s+/g, " ").trim(), before;
  // "it's for the pasta" → "pasta" (as many of these as there are)
  do { before = l; l = l.replace(/^(it is|it's|its|this is|that is|that's|this one is|for|the|my|a|an|to|just|um|uh|oh)\s+/, ""); } while (l !== before);
  l = l.replace(/\s+(timer|one)$/g, "").replace(/\s+/g, " ").trim();
  if (l.length > 40) l = l.slice(0, 40).replace(/\s+\S*$/, "");
  return l;
}
function uniqueLabel(label, s = load()) {
  const taken = new Set(s.timers.map((t) => t.label.toLowerCase()));
  if (!taken.has(label.toLowerCase())) return label;
  for (let n = 2; n < 50; n++) if (!taken.has(`${label} ${n}`.toLowerCase())) return `${label} ${n}`;
  return `${label} ${Date.now() % 100}`;
}
function autoLabel(s = load()) {
  const taken = new Set(s.timers.map((t) => t.label.toLowerCase()));
  for (let n = 1; n <= 50; n++) if (!taken.has(`timer ${n}`)) return `Timer ${n}`;
  return "Timer";
}
export function hasLabel(label) { const l = cleanLabel(label); return load().timers.some((t) => t.label.toLowerCase() === l); }

// start({ ms, label, step, replace }) → { timer, ask } | { full, timers } | { duplicate, existing }
// cycle: { work, rest, rounds } in ms/count — a focus session (25/5) that moves itself on to the break and back;
// every: ms — starts itself again when it ends (drink-water reminders), until cancelled
export function start({ ms, label = "", step = null, replace = false, allowDuplicate = true, cycle = null, every = null } = {}) {
  const s = load();
  ms = Math.round(Number(ms));
  if (!(ms >= 1000) || ms > 7 * 86_400_000) throw new Error("A timer needs a length between a second and a week.");
  let l = cleanLabel(label);
  if (l && replace) { const old = s.timers.find((t) => t.label.toLowerCase() === l); if (old) s.timers = s.timers.filter((t) => t !== old); }
  if (s.timers.length >= MAX) return { full: true, timers: list() };
  if (l && !allowDuplicate && s.timers.some((t) => t.label.toLowerCase() === l)) return { duplicate: true, existing: list().find((t) => t.label.toLowerCase() === l) };
  const auto = !l;
  l = auto ? autoLabel(s) : uniqueLabel(l, s);
  const t = { id: randomUUID().slice(0, 8), label: l, auto, ms, endsAt: now() + ms, paused: false, remaining: null, createdAt: new Date(now()).toISOString(), step,
    ...(cycle ? { cycle: { work: cycle.work, rest: cycle.rest, rounds: cycle.rounds ?? 4, round: cycle.round ?? 1, phase: cycle.phase ?? "work" } } : {}), ...(every ? { every } : {}) };
  s.timers.push(t);
  save();
  return { timer: { ...t, left: ms }, ask: auto && !step && !cycle && !every };
}
// ref: id | "all" | a name | an ordinal ("second", "2nd", "2", "last", "first") | "" (the newest)
const ORDINALS = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, fifth: 5, "5th": 5, sixth: 6, "6th": 6, seventh: 7, "7th": 7 };
export function find(ref, s = load()) {
  const r = String(ref ?? "").toLowerCase().replace(/\b(the|my|timer|timers|one|on|for|of)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!s.timers.length) return null;
  if (!r || /^(it|that|this|newest|latest|last one|current)$/.test(r)) return s.timers[s.timers.length - 1];
  if (/^last$/.test(r)) return s.timers[s.timers.length - 1];
  const byId = s.timers.find((t) => t.id === r); if (byId) return byId;
  const ord = ORDINALS[r] ?? (/^\d+$/.test(r) ? Number(r) : null);
  if (ord) { const byName = s.timers.find((t) => t.label.toLowerCase() === `timer ${ord}`); return byName ?? s.timers[ord - 1] ?? null; }
  const exact = s.timers.find((t) => t.label.toLowerCase() === r); if (exact) return exact;
  const words = r.split(" ").filter((w) => w.length > 2);
  return s.timers.find((t) => words.some((w) => t.label.toLowerCase().includes(w))) ?? s.timers.find((t) => t.label.toLowerCase().includes(r)) ?? null;
}
const many = (ref) => (/^(all|every|everything|all of them|all timers|all the timers|all my timers)$/.test(String(ref ?? "").trim()) ? load().timers.slice() : [find(ref)].filter(Boolean));
export function pause(ref) {
  const ts = many(ref).filter((t) => !t.paused);
  for (const t of ts) { t.remaining = left(t); t.paused = true; t.endsAt = null; }
  if (ts.length) save();
  return ts.map((t) => ({ label: t.label, left: t.remaining }));
}
export function resume(ref) {
  const ts = many(ref).filter((t) => t.paused);
  for (const t of ts) { t.endsAt = now() + t.remaining; t.paused = false; t.remaining = null; }
  if (ts.length) save();
  return ts.map((t) => ({ label: t.label, left: left(t) }));
}
export function cancel(ref) {
  const s = load(); const ts = many(ref);
  if (!ts.length) return [];
  s.timers = s.timers.filter((t) => !ts.includes(t));
  save();
  return ts.map((t) => ({ label: t.label }));
}
export function addTime(ref, ms) {
  const ts = many(ref);
  for (const t of ts) { if (t.paused) t.remaining += ms; else t.endsAt += ms; t.ms += ms; }
  if (ts.length) save();
  return ts.map((t) => ({ label: t.label, left: left(t) }));
}
export function rename(ref, label) {
  const t = find(ref);
  if (!t) return null;
  const l = cleanLabel(label);
  if (!l) return null;
  const before = t.label;
  t.label = uniqueLabel(l, { timers: load().timers.filter((x) => x !== t) }); t.auto = false;
  save();
  return { before, label: t.label };
}
// the answer to "What's it for?"
export function setPurpose(id, answer) {
  const t = load().timers.find((x) => x.id === id);
  if (!t) return null;
  const l = cleanLabel(answer);
  if (!l || /^(nothing|no|nope|none|skip|just a timer|a timer|never ?mind|nothing in particular|doesnt matter|does not matter|whatever)$/.test(l)) return { label: t.label, kept: true };
  t.label = uniqueLabel(l, { timers: load().timers.filter((x) => x !== t) }); t.auto = false;
  save();
  return { label: t.label };
}
export function timeLeft(ref) { const t = find(ref); return t ? { label: t.label, left: left(t), paused: Boolean(t.paused) } : null; }

// ---- ringing ----------------------------------------------------------------------------------------------------
function ringOnce(label, text) { try { deps.ring({ labels: [label], ids: [], repeat: 0, text, once: true }); } catch { /* the screen's problem */ } }
function ringNow(done, repeat = 0) { try { deps.ring({ labels: done.map((r) => r.label), ids: done.map((r) => r.id), repeat }); } catch { /* the screen's problem */ } }
export function tick() {
  const s = load(); const t = now();
  const due = s.timers.filter((x) => !x.paused && x.endsAt <= t);
  if (due.length) {
    s.timers = s.timers.filter((x) => !due.includes(x));
    // a focus session moves on by itself (focus → break → focus …); a repeating one starts again. Both just announce.
    const moving = due.filter((x) => x.cycle || x.every), plain = due.filter((x) => !x.cycle && !x.every);
    for (const x of moving) {
      if (x.every) { s.timers.push({ ...x, id: randomUUID().slice(0, 8), endsAt: t + x.every, ms: x.every }); ringOnce(x.label, `Time to ${x.label.replace(/^(a |the )/, "")}.`); continue; }
      const c = x.cycle;
      if (c.phase === "work" && c.round >= c.rounds) { ringOnce(x.label, `That's ${c.rounds} focus rounds done. Great work! Time for a longer break.`); continue; }
      const next = c.phase === "work" ? { phase: "rest", round: c.round, ms: c.rest, label: "break" } : { phase: "work", round: c.round + 1, ms: c.work, label: "focus" };
      s.timers.push({ ...x, id: randomUUID().slice(0, 8), label: uniqueLabel(next.label, s), ms: next.ms, endsAt: t + next.ms, cycle: { ...c, phase: next.phase, round: next.round } });
      ringOnce(x.label, next.phase === "rest" ? `Focus round ${c.round} done. Take a ${Math.round(c.rest / 60000)} minute break.` : `Break's over. Focus round ${next.round} of ${c.rounds}, ${Math.round(c.work / 60000)} minutes. Let's go.`);
    }
    const rings = plain.map((x) => ({ id: x.id, label: x.label, at: t, repeats: 0, nextAt: t + REPEAT_MS() }));
    s.ringing.push(...rings);
    save();
    if (rings.length) ringNow(rings, 0);
    // XP: a finished focus timer or pomodoro can start a work check-in (lib/xp timerFinished decides which count)
    for (const x of due) try { deps.finished?.(x); } catch { /* XP's own problem */ }
  }
  // gentle reminders, once a minute, until dismissed (5 at most)
  const again = s.ringing.filter((r) => r.nextAt <= t && r.repeats < REPEATS);
  if (again.length) {
    for (const r of again) { r.repeats++; r.nextAt = t + REPEAT_MS(); }
    s.ringing = s.ringing.filter((r) => r.repeats < REPEATS || r.nextAt > t);
    save();
    ringNow(again, again[0].repeats);
  }
  const stale = s.ringing.filter((r) => r.repeats >= REPEATS && r.nextAt <= t);
  if (stale.length) { s.ringing = s.ringing.filter((r) => !stale.includes(r)); save(); }
  // alarms
  const alarmsDue = s.alarms.filter((a) => Date.parse(a.at) <= t);
  if (alarmsDue.length) {
    s.alarms = s.alarms.filter((a) => !alarmsDue.includes(a));
    // a repeating one (every Tuesday night, every day at 8, the 1st of every month) books its next time
    for (const a of alarmsDue) if (a.repeat?.days?.length || a.repeat?.rule) { const nx = nextFor(a, Math.max(t, Date.parse(a.at)) + 60_000); if (nx) s.alarms.push({ ...a, at: nx.toISOString() }); }
    save();
    // one that's switched off, or skipped for that day, stays quiet (it still books its next time above)
    for (const a of alarmsDue) if (!a.off && !(a.skip ?? []).includes(isoDay(new Date(a.at)))) try { deps.alarm?.(a); } catch { /* the screen's problem */ }
  }
}
export function dismiss(ref) {
  const s = load();
  const r = String(ref ?? "").toLowerCase().trim();
  const hit = !r || /^all$/.test(r) ? s.ringing.slice() : s.ringing.filter((x) => x.id === r || x.label.toLowerCase().includes(r));
  if (!hit.length) return [];
  s.ringing = s.ringing.filter((x) => !hit.includes(x));
  save();
  return hit.map((x) => ({ label: x.label }));
}
// "+5 min" / snooze on a finished timer: it starts again for that long, same name
export function snooze(ref, ms = 5 * 60_000) {
  const d = dismiss(ref);
  return d.map((x) => { const s = load(); const t = { id: randomUUID().slice(0, 8), label: uniqueLabel(x.label, s), auto: false, ms, endsAt: now() + ms, paused: false, remaining: null, createdAt: new Date(now()).toISOString() }; s.timers.push(t); save(); return { label: t.label, left: ms }; });
}
export const ringing = () => load().ringing.map((r) => ({ id: r.id, label: r.label }));

// ---- stopwatch ----------------------------------------------------------------------------------------------------
function stopwatchElapsed() { const w = load().stopwatch; return w.elapsed + (w.running ? now() - w.startedAt : 0); }
export function stopwatch(action) {
  const w = load().stopwatch;
  if (action === "start") { if (!w.running) { w.running = true; w.startedAt = now(); } }
  else if (action === "stop" || action === "pause") { if (w.running) { w.elapsed += now() - w.startedAt; w.running = false; w.startedAt = null; } }
  else if (action === "reset") { w.running = false; w.startedAt = null; w.elapsed = 0; w.laps = []; }
  else if (action === "lap") { w.laps.push(stopwatchElapsed()); }
  if (action !== "read") save();
  return { running: w.running, elapsed: stopwatchElapsed(), laps: w.laps.slice() };
}

// ---- time-of-day alarms ---------------------------------------------------------------------------------------------
// An alarm: { id, at (the next time it goes off), hm, label, kind: "alarm" | "reminder",
//   repeat: { days: [0…6] } ("weekdays at 6:30") or { rule } (any repeat rule of lib/recur.mjs: "every other week",
//   "the 1st of every month", "every day until December"), off: true (kept, but silent: "turn off my weekend alarms"),
//   skip: ["YYYY-MM-DD"] (that day only: "skip tomorrow's alarm"), and how it rings: sound, volume (20–100), snooze
//   (minutes), gentle (starts soft and builds slowly), flash (the screen pulses) }
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// the next time a weekly pattern comes round (days: 0 = Sunday … 6), at hm, after `from`, skipping `skip` days
function nextOn(days, hm, from, skip = []) {
  const [h, m] = hm.split(":").map(Number);
  for (let k = 0; k < 60; k++) { const d = new Date(from); d.setDate(d.getDate() + k); d.setHours(h, m, 0, 0); if (days.includes(d.getDay()) && d.getTime() > from && !skip.includes(isoDay(d))) return d; }
  return null;
}
// the next day a repeat rule (lib/recur.mjs) happens, at hm, after `from` (looks up to 400 days ahead)
function nextByRule(rule, hm, from, skip = []) {
  const [h, m] = hm.split(":").map(Number);
  for (let k = 0; k < 400; k++) {
    const d = new Date(from); d.setDate(d.getDate() + k); d.setHours(h, m, 0, 0);
    if (d.getTime() <= from || skip.includes(isoDay(d))) continue;
    if (recurOccurs({ repeat: rule }, isoDay(d))) return d;
  }
  return null;
}
const recurOccurs = (r, iso) => recur.occursOn(r, iso);
export function nextFor(a, from = now()) {
  const skip = a.skip ?? [];
  if (a.repeat?.rule) return nextByRule(a.repeat.rule, a.hm, from, skip);
  if (a.repeat?.days?.length) return nextOn(a.repeat.days, a.hm, from, skip);
  return null;
}
const RING = ["sound", "volume", "snooze", "gentle", "flash"];
const ringOpts = (o = {}) => Object.fromEntries(RING.filter((k) => o[k] !== undefined && o[k] !== null).map((k) => [k, k === "volume" ? Math.max(20, Math.min(100, Math.round(Number(o[k])))) : k === "snooze" ? Math.max(1, Math.min(60, Math.round(Number(o[k])))) : k === "sound" ? String(o[k]).slice(0, 20) : Boolean(o[k])]));
// kind: "alarm" (rings) or "reminder" (said like a reminder); repeat: { days: [0…6] } for "every Tuesday night", or { rule }
export function setAlarm({ date, hm, label = "", kind = "alarm", repeat = null, text = null, ...opts }) {
  const [h, m] = hm.split(":").map(Number);
  const base = date ? new Date(`${date}T00:00:00`) : new Date(now());
  let at = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m, 0, 0);
  if (!date && at.getTime() <= now()) at.setDate(at.getDate() + 1);
  const a = { id: randomUUID().slice(0, 8), at: at.toISOString(), label: kind === "reminder" ? String(label).slice(0, 120) : cleanLabel(label) || "", hm, kind, ...(repeat ? { repeat } : {}), ...(text ? { text } : {}), ...ringOpts(opts) };
  if (repeat?.days?.length || repeat?.rule) { const from = date ? Math.max(now(), new Date(`${date}T00:00:00`).getTime() - 1) : now(); at = nextFor(a, from) ?? at; a.at = at.toISOString(); }
  load().alarms.push(a); save();
  return a;
}
export function alarms() { return load().alarms.slice().sort((a, b) => a.at.localeCompare(b.at)); }
export const alarmById = (id) => load().alarms.find((a) => a.id === id) ?? null;
export function cancelAlarm(ref) {
  const s = load(); const r = String(ref ?? "").toLowerCase().trim();
  const hit = !r || r === "all" ? s.alarms.slice() : s.alarms.filter((a) => a.id === r || (a.label && a.label.toLowerCase().includes(r)) || a.at.includes(r) || a.hm === r);
  s.alarms = s.alarms.filter((a) => !hit.includes(a)); save();
  return hit;
}
// change one: { off, label, hm, repeat, ringing options }; a new time or pattern books its next time again
export function updateAlarm(id, patch = {}) {
  const a = alarmById(id);
  if (!a) return null;
  if (typeof patch.off === "boolean") { if (patch.off) a.off = true; else delete a.off; }
  if (patch.label !== undefined) a.label = a.kind === "reminder" ? String(patch.label).slice(0, 120) : cleanLabel(patch.label);
  if (patch.hm) a.hm = patch.hm;
  if (patch.repeat !== undefined) { if (patch.repeat) a.repeat = patch.repeat; else delete a.repeat; }
  Object.assign(a, ringOpts(patch));
  for (const k of RING) if (patch[k] === null) delete a[k];
  if (patch.hm || patch.repeat !== undefined || patch.off === false) {
    const nx = nextFor(a, now());
    if (nx) a.at = nx.toISOString();
    else if (patch.hm) { const [h, m] = a.hm.split(":").map(Number), d = new Date(now()); d.setHours(h, m, 0, 0); if (d.getTime() <= now()) d.setDate(d.getDate() + 1); a.at = d.toISOString(); }
  }
  save();
  return { ...a };
}
// "skip tomorrow's alarm": that day only. A repeating one books its next time after it; a one-time one on that day is
// removed (it would have been its only time). → the alarms skipped
export function skipAlarms(date, kind = "alarm") {
  const s = load(); const out = [];
  const [y, mo, d] = date.split("-").map(Number), wd = new Date(y, mo - 1, d).getDay();
  for (const a of s.alarms.slice()) {
    if (a.off || (kind && (a.kind ?? "alarm") !== kind)) continue;
    const onThatDay = a.repeat?.days ? a.repeat.days.includes(wd) : a.repeat?.rule ? recurOccurs({ repeat: a.repeat.rule }, date) : isoDay(new Date(a.at)) === date;
    if (!onThatDay || (a.skip ?? []).includes(date)) continue;
    const when = new Date(y, mo - 1, d, ...a.hm.split(":").map(Number)).getTime();
    if (when <= now()) continue;                                   // (that day's time has already gone by)
    if (a.repeat) { a.skip = [...new Set([...(a.skip ?? []), date])].filter((x) => x >= isoDay(new Date(now()))).slice(-30); const nx = nextFor(a, now()); if (nx) a.at = nx.toISOString(); out.push({ ...a, skippedAt: new Date(when).toISOString() }); }
    else { s.alarms = s.alarms.filter((x) => x !== a); out.push({ ...a, removed: true, skippedAt: a.at }); }
  }
  if (out.length) save();
  return out;
}
export function unskip(id, date) { const a = alarmById(id); if (!a) return null; a.skip = (a.skip ?? []).filter((d) => d !== date); const nx = nextFor(a, now()); if (nx) a.at = nx.toISOString(); save(); return { ...a }; }
// put back an alarm exactly as it was ("undo")
export function restoreAlarm(a) { const s = load(); s.alarms = s.alarms.filter((x) => x.id !== a.id); s.alarms.push(structuredClone(a)); save(); return a; }

let ticker = null;
export function startTicking() { load(); if (!ticker) { ticker = setInterval(() => { try { tick(); } catch { /* keep ticking */ } }, 1000); ticker.unref?.(); } tick(); }
export function stopTicking() { clearInterval(ticker); ticker = null; }

// How it's said
export function spokenLeft(ms) {
  const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h} hour${h > 1 ? "s" : ""}${m ? ` ${m} minute${m > 1 ? "s" : ""}` : ""}`;
  if (m) return `${m} minute${m > 1 ? "s" : ""}${m < 5 && sec ? ` ${sec} second${sec > 1 ? "s" : ""}` : ""}`;
  return `${sec} second${sec === 1 ? "" : "s"}`;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const nameOf = (label) => (/^timer \d+$/i.test(label) ? cap(label.toLowerCase()) : label);
export function doneLine(labels, repeat = 0) {
  const named = labels.map(nameOf);
  if (named.length > 1) { const list = named.slice(0, -1).join(", ") + " and " + named.at(-1); return repeat ? `Reminder: your ${list} timers are done.` : `Your ${list} timers are done.`; }
  const l = named[0];
  const t = /^Timer \d+$/.test(l) ? l : `${/^(the|my) /i.test(l) ? l.replace(/^(the|my) /i, "") : l} timer`;
  if (repeat) return pick([`Just a reminder, your ${t} finished.`, `Your ${t} is still waiting for you.`, `Reminder: the ${t} is done.`], repeat);
  return pick([`Your ${t} is done.`, `The ${t} just finished.`, `Time's up on your ${t}.`, `${cap(t)} is done.`], l.length);
}
const pick = (arr, n) => arr[Math.abs(n) % arr.length];
