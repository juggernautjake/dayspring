// Scheduling conflicts across every calendar (unified.mjs): Dayspring, Google, Outlook, subscriptions.
//   detect(items)        → overlaps (double-bookings), optional travel-time gaps, and busy all-day items that something else
//                          lands on. The same event on two calendars is merged (a duplicate, not a conflict). Tasks, free
//                          items, hidden sources, declined invitations, all-day items not marked busy, and a short item
//                          inside a long work/school/shift block are never conflicts.
//   options(conflict)    → ranked ways to fix it: Dayspring blocks can be shortened, moved to the next free slot, swapped or
//                          skipped this once (fixed commitments like work and church are not moved); Google/Outlook events
//                          can be moved (yours) or declined (invitations), only after the owner says yes; or keep both.
//   resolve(id, choice)  → applies one. Dayspring changes happen at once and the screens refresh; outside-calendar changes
//                          return a question until called again with confirmed: true.
// Kept in data/conflicts.json: conflicts the owner said are fine, and which ones they were already told about.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as unified from "./unified.mjs";
import * as store from "./store.mjs";
import * as google from "./connectors/google.mjs";
import * as microsoft from "./connectors/microsoft.mjs";
import { writeJSONAtomic } from "./atomic.mjs";

const DIR = process.env.DAYSPRING_CALDATA_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const FILE = () => join(DIR, "conflicts.json");
const load = () => { try { return { ignored: [], notified: {}, ...(existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), "utf8")) : {}) }; } catch { return { ignored: [], notified: {} }; } };
const save = (d) => { mkdirSync(DIR, { recursive: true }); writeJSONAtomic(FILE(), d, 2); };

const toMin = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
const toHM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const todayISO = () => new Date().toLocaleDateString("en-CA");
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const EARLIEST = 6 * 60, LATEST = 22 * 60;
const RANK = { dayspring: 0, google: 1, microsoft: 2, ics: 3 };
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\b(the|a|an|with|and|&|appt|appointment|mtg|meeting)\b/g, " ").replace(/\s+/g, " ").trim();
const words = (s) => new Set(norm(s).split(" ").filter(Boolean));
// same thing on two calendars: close enough title and the same time (within 15 minutes each end)
function sameThing(a, b) {
  if (a.allDay !== b.allDay || a.date !== b.date) return false;
  if (!a.allDay && (Math.abs(toMin(a.start) - toMin(b.start)) > 15 || Math.abs(toMin(a.end) - toMin(b.end)) > 15)) return false;
  const x = norm(a.title), y = norm(b.title);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const A = words(a.title), B = words(b.title), both = [...A].filter((w) => B.has(w)).length;
  return both / Math.max(1, Math.min(A.size, B.size)) >= 0.6;
}
// a short item inside a long work/school/shift block isn't a clash (lunch at work, a meeting during the workday)
const CONTAINER = /\b(work|shift|office|school|classes|conference|workday|on call|out of office)\b/i;
function nested(a, b) {
  const [big, small] = toMin(a.end) - toMin(a.start) >= toMin(b.end) - toMin(b.start) ? [a, b] : [b, a];
  return toMin(big.end) - toMin(big.start) >= 180 && toMin(big.start) <= toMin(small.start) && toMin(small.end) <= toMin(big.end) && (big.category === "work" || CONTAINER.test(big.title));
}
// a real place (not a video call or a blank) for travel-time checks
const place = (x) => { const w = String(x.where ?? "").trim(); return !w || /\b(zoom|teams|meet\.google|google meet|webex|skype|online|virtual|phone|call|https?:)/i.test(w) ? "" : norm(w); };
const idOf = (kind, a, b) => createHash("sha1").update([kind, ...[a.key ?? a.id, b.key ?? b.id].sort()].join("|")).digest("hex").slice(0, 10);
const brief = (x) => ({ id: x.id, key: x.key ?? x.id, title: x.title, source: x.source, sourceLabel: x.sourceLabel, date: x.date, start: x.start, end: x.end, allDay: Boolean(x.allDay), where: x.where ?? "",
  link: x.link ?? null, readOnly: Boolean(x.readOnly), anchored: Boolean(x.anchored), projected: Boolean(x.projected), invited: Boolean(x.invited) });

// ---- detection (pure: items in, conflicts out) ----
export function detect(items, { travel = { on: false, minutes: 15 }, ignored = [] } = {}) {
  const shown = items.filter((x) => !x.hidden && x.kind !== "task");
  const dupOf = {}, alsoOn = {};
  const byDate = new Map();
  for (const x of shown) { if (!byDate.has(x.date)) byDate.set(x.date, []); byDate.get(x.date).push(x); }
  for (const list of byDate.values()) {
    list.sort((a, b) => (RANK[a.source] ?? 9) - (RANK[b.source] ?? 9));
    for (let i = 0; i < list.length; i++) {
      if (dupOf[list[i].id]) continue;
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        // two items on one calendar are a real double-booking, never a duplicate
        if (dupOf[b.id] || a.sourceKey === b.sourceKey || !sameThing(a, b)) continue;
        dupOf[b.id] = a.id; (alsoOn[a.id] ??= []).push(b.sourceLabel);
      }
    }
  }
  const skip = new Set(ignored.map((x) => (typeof x === "string" ? x : x.id)));
  const busy = shown.filter((x) => !dupOf[x.id] && x.busy && !x.done);
  const out = [];
  const add = (kind, severity, a, b, extra = {}) => { const id = idOf(kind, a, b); if (!skip.has(id)) out.push({ id, kind, severity, date: a.date, items: [brief(a), brief(b)], ...extra }); };
  for (const [date, list0] of byDate) {
    const list = list0.filter((x) => busy.includes(x));
    const timed = list.filter((x) => !x.allDay).sort((a, b) => a.start.localeCompare(b.start)), allDay = list.filter((x) => x.allDay);
    for (let i = 0; i < timed.length; i++) for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i], b = timed[j];
      const s = Math.max(toMin(a.start), toMin(b.start)), e = Math.min(toMin(a.end), toMin(b.end));
      if (e > s) { if (!nested(a, b)) add("overlap", e - s >= 10 ? "hard" : "soft", a, b, { start: toHM(s), end: toHM(e), minutes: e - s }); continue; }
      if (!travel.on) continue;
      const gap = toMin(b.start) - toMin(a.end), pa = place(a), pb = place(b);
      if (gap >= 0 && gap < travel.minutes && pa && pb && pa !== pb) add("travel", "soft", a, b, { start: a.end, end: b.start, minutes: gap, need: travel.minutes });
    }
    for (const a of allDay) for (const b of timed) add("allday", "soft", a, b, { start: b.start, end: b.end });
    void date;
  }
  out.sort((x, y) => (x.date + (x.start ?? "")).localeCompare(y.date + (y.start ?? "")) || (x.severity === "hard" ? -1 : 1));
  return { conflicts: out, dupOf, alsoOn };
}

// ---- words ----
const say12 = (t) => { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h >= 12 ? "pm" : "am"}`; };
const span = (s, e) => { const a = say12(s), b = say12(e); return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`; };
export function dayWord(date, today = todayISO()) {
  if (date === today) return "today";
  if (date === addDays(today, 1)) return "tomorrow";
  const d = new Date(date + "T12:00:00"), diff = Math.round((d - new Date(today + "T12:00:00")) / 86_400_000);
  return diff > 0 && diff < 7 ? d.toLocaleDateString("en-US", { weekday: "long" }) : d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
const from = (x) => (x.source === "dayspring" ? "" : ` on ${x.sourceLabel}`);
export function describe(c, today = todayISO()) {
  const [a, b] = c.items, when = dayWord(c.date, today);
  if (c.kind === "travel") return `${when}, only ${c.minutes} minute${c.minutes === 1 ? "" : "s"} to get from ${a.title}${a.where ? ` (${a.where})` : ""} to ${b.title}${b.where ? ` (${b.where})` : ""}`;
  if (c.kind === "allday") return `${when}, ${b.title}${from(b)} at ${say12(b.start)} falls on ${a.title}${from(a)}, which is marked busy all day`;
  return `${when} at ${say12(c.start)}, ${a.title}${from(a)} ${a.start === b.start && a.end === b.end ? "is at the same time as" : "overlaps"} ${b.title}${from(b)}`;
}

// ---- free time and the ways to fix one ----
function busyOn(items, date, ignoreKeys) {
  return items.filter((x) => x.date === date && !x.hidden && x.busy && !x.done && x.kind !== "task" && !ignoreKeys.has(x.key ?? x.id));
}
const dayBlocked = (items, date, ignoreKeys) => busyOn(items, date, ignoreKeys).some((x) => x.allDay);
export function isFree(items, date, s, e, ignoreKeys = new Set()) {
  if (s < EARLIEST || e > LATEST) return false;
  if (date === todayISO() && s < nowMin()) return false;
  return !busyOn(items, date, ignoreKeys).some((x) => !x.allDay && toMin(x.start) < e && s < toMin(x.end));
}
// the nearest free slot of `minutes` for an item: the same day first (closest to where it was, after the clash if it can),
// then the next days (at the same time if it fits, else the closest)
export function findSlot(items, item, minutes, { after = null, days = 7, ignoreKeys = new Set([item.key ?? item.id]) } = {}) {
  const orig = toMin(item.start);
  for (let d = 0; d < days; d++) {
    const date = addDays(item.date, d);
    if (dayBlocked(items, date, ignoreKeys)) continue;
    const cands = [];
    for (let s = EARLIEST; s + minutes <= LATEST; s += 15) if (isFree(items, date, s, s + minutes, ignoreKeys)) cands.push(s);
    if (!cands.length) continue;
    const pref = d === 0 && after != null ? cands.filter((s) => s >= after) : [];
    const pick = (pref.length ? pref : cands).sort((x, y) => Math.abs(x - orig) - Math.abs(y - orig))[0];
    return { date, start: toHM(pick), end: toHM(pick + minutes), daysAway: d };
  }
  return null;
}
const long = (x) => toMin(x.end) - toMin(x.start);
export function options(c, items) {
  const full = (x) => items.find((i) => (i.key ?? i.id) === x.key) ?? x;
  const [A, B] = c.items.map(full), out = [];
  const minutesTravel = c.need ?? 0;
  [[A, B, "a"], [B, A, "b"]].forEach(([x, other, side]) => {
    const dur = long(x), imp = x.importance ?? 0, where = dayWord(x.date);
    if (x.source === "dayspring" && !x.done) {
      if (!x.anchored && c.kind !== "allday") {
        // shorten: give up the part that clashes (and the travel time)
        let s = toMin(x.start), e = toMin(x.end);
        if (toMin(x.start) < toMin(other.start)) e = Math.min(e, toMin(other.start) - (c.kind === "travel" ? minutesTravel : 0)); else s = Math.max(s, toMin(other.end) + (c.kind === "travel" ? minutesTravel : 0));
        const left = e - s;
        if (left >= 15 && left >= dur * 0.5 && left < dur && isFree(items, x.date, s, e, new Set([x.key, other.key]))) out.push({ id: `shorten:${side}`, action: "shorten", side, item: x.key, date: x.date, start: toHM(s), end: toHM(e), cost: 10 + Math.round((1 - left / dur) * 40) + imp * 8, label: `Shorten ${x.title} to ${span(toHM(s), toHM(e))}` });
      }
      if (!x.anchored) {
        const slot = findSlot(items, x, dur, { after: toMin(other.end) + minutesTravel });
        if (slot) out.push({ id: `move:${side}`, action: "move", side, item: x.key, ...slot, cost: 20 + slot.daysAway * 15 + imp * 10 + Math.round(Math.abs(toMin(slot.start) - toMin(x.start)) / 60), label: `Move ${x.title} to ${slot.daysAway ? dayWord(slot.date) + " " : ""}${span(slot.start, slot.end)}` });
        // swap: trade places with another movable Dayspring item that day, when both fit
        const others = items.filter((y) => y.source === "dayspring" && y.date === x.date && y.key !== x.key && y.key !== other.key && !y.anchored && !y.done && y.busy && !y.hidden);
        for (const y of others) {
          const ig = new Set([x.key, y.key]), ys = toMin(y.start), xs = toMin(x.start);
          if (isFree(items, x.date, ys, ys + dur, ig) && isFree(items, x.date, xs, xs + long(y), ig) && !(xs < toMin(other.end) && toMin(other.start) < xs + long(y))) {
            out.push({ id: `swap:${side}:${y.key}`, action: "swap", side, item: x.key, with: y.key, start: toHM(ys), end: toHM(ys + dur), withStart: toHM(xs), withEnd: toHM(xs + long(y)), cost: 35 + imp * 10, label: `Swap ${x.title} with ${y.title} (${x.title} at ${say12(toHM(ys))})` });
            break;
          }
        }
      }
      out.push({ id: `skip:${side}`, action: "skip", side, item: x.key, cost: (x.anchored ? 90 : 60) + imp * 15, label: `Skip ${x.title} ${where}` });
    } else if ((x.source === "google" || x.source === "microsoft") && !x.readOnly) {
      const app = x.source === "google" ? "Google" : "Outlook";
      if (x.invited) out.push({ id: `decline:${side}`, action: "decline", side, item: x.key, needsConfirm: true, cost: 85 + imp * 5, label: `Decline ${x.title} on ${app} (the organizer is told)` });
      else if (!x.allDay) {
        const slot = findSlot(items, x, dur, { after: toMin(other.end), days: 1 });
        if (slot) out.push({ id: `ext_move:${side}`, action: "ext_move", side, item: x.key, ...slot, needsConfirm: true, cost: 75, label: `Move ${x.title} on ${app} to ${span(slot.start, slot.end)}` });
      }
    }
  });
  out.push({ id: "ignore", action: "ignore", cost: 100, label: "Keep both (it's fine)" });
  return out.sort((x, y) => x.cost - y.cost);
}

// ---- scanning the real calendars ----
let last = { at: 0, from: null, to: null, conflicts: [], items: [] };
export async function scan(from = todayISO(), to = addDays(todayISO(), 6), { force = false } = {}) {
  const items = await unified.items(from, to, { force });
  const cfg = unified.config();
  const r = detect(items, { travel: cfg.travel, ignored: load().ignored });
  last = { at: Date.now(), from, to, conflicts: r.conflicts, items };
  return { ...r, items };
}
const upcoming = (c) => c.date > todayISO() || (c.date === todayISO() && toMin(c.end ?? "23:59") > nowMin());

// ---- applying a fix ----
async function refreshScreens(date) { try { const a = await import("./announcer.mjs"); a.broadcast("refresh", { reason: "ai-edit", date }); a.broadcast("conflicts", { at: Date.now() }); } catch { /* no screens in tests */ } }
function realBlock(x) {
  if (x.projected) { const nb = store.materialize(x.id); if (!nb) throw new Error(`I couldn't find ${x.title} on the schedule anymore.`); return nb; }
  return x;
}
const mod = (x) => (x.source === "google" ? google : microsoft);
export async function resolve(id, choice = "best", { confirmed = false } = {}) {
  let c = last.conflicts.find((x) => x.id === id);
  if (!c || Date.now() - last.at > 10 * 60_000) { await scan(todayISO(), addDays(todayISO(), 30)); c = last.conflicts.find((x) => x.id === id); }
  if (!c) return { error: "That conflict isn't there anymore (it may already be fixed)." };
  const items = await unified.items(c.date, addDays(c.date, 7));
  const opts = options(c, items);
  const want = String(choice ?? "best").toLowerCase();
  const o = want === "best" ? opts.find((x) => !x.needsConfirm) ?? opts[0] : opts.find((x) => x.id === want) ?? opts.find((x) => x.action === want) ?? opts.find((x) => want.startsWith(x.action) && want.includes(":"));
  if (!o) return { error: `That isn't one of the choices. The choices are: ${opts.map((x) => `${x.id} (${x.label})`).join("; ")}.` };
  const x = o.side ? items.find((i) => (i.key ?? i.id) === o.item) ?? c.items[o.side === "a" ? 0 : 1] : null;
  if (o.needsConfirm && !confirmed) return { needsConfirm: true, id: c.id, choice: o.id, question: `${o.label}? That changes your ${x.source === "google" ? "Google" : "Outlook"} calendar${o.action === "decline" ? " and lets the organizer know" : " and tells anyone invited"}. Should I go ahead?` };
  switch (o.action) {
    case "ignore": { const d = load(); d.ignored = [...d.ignored.filter((y) => y.id !== c.id), { id: c.id, at: Date.now(), date: c.date }].filter((y) => y.date >= addDays(todayISO(), -30)); save(d); break; }
    case "move": case "shorten": { const b = realBlock(x); store.updateBlock(b.id, { date: o.date ?? x.date, start: o.start, end: o.end }); break; }
    case "swap": { const y = items.find((i) => i.key === o.with); const bx = realBlock(x), by = realBlock(y); store.updateBlock(bx.id, { start: o.start, end: o.end }); store.updateBlock(by.id, { start: o.withStart, end: o.withEnd }); break; }
    case "skip": if (x.projected) store.skipRoutineDay(x.date, x.title); else store.removeBlock(x.id); break;
    case "ext_move": await mod(x).updateEvent({ id: x.id, calendarId: x.calendarId ?? "primary", date: o.date, start: o.start, end: o.end }); break;
    case "decline": await mod(x).declineEvent({ id: x.id, calendarId: x.calendarId ?? "primary" }); break;
  }
  unified.clear(); last.at = 0;
  await refreshScreens(o.date ?? c.date);
  return { done: true, id: c.id, choice: o.id, action: o.action, said: o.action === "ignore" ? "Okay, I'll leave those both as they are." : `Done: ${o.label.replace(/ \(.*\)$/, "")}.` };
}

// ---- for the Schedule app, the morning rundown and the assistant ----
export async function list(fromD = todayISO(), toD = addDays(todayISO(), 6), { force = false } = {}) {
  const r = await scan(fromD, toD, { force });
  const conflicts = r.conflicts.map((c) => ({ ...c, past: !upcoming(c), text: describe(c), options: options(c, r.items).map(({ id, label, action, needsConfirm }) => ({ id, label, action, needsConfirm: Boolean(needsConfirm) })) }));
  return { from: fromD, to: toD, conflicts, dupOf: r.dupOf, alsoOn: r.alsoOn, items: r.items };
}
export async function briefingLine(date = todayISO()) {
  try {
    const r = await scan(date, date);
    const cs = r.conflicts.filter(upcoming);
    if (!cs.length) return "";
    return cs.length === 1 ? `One clash to sort out: ${describe(cs[0]).replace(/^today,? /, "")}.` : `${cs.length} clashes today. The first: ${describe(cs[0]).replace(/^today,? /, "")}. Say "fix my conflicts" and I'll sort them out.`;
  } catch { return ""; }
}

// ---- telling the owner when a new one appears ----
let watch = null;
export function startWatcher({ announce, broadcast } = {}) {
  if (watch) return;
  const check = async () => {
    try {
      const r = await scan(todayISO(), addDays(todayISO(), 7));
      const d = load(), fresh = r.conflicts.filter((c) => upcoming(c) && !d.notified[c.id]);
      const first = !d.seeded;
      for (const c of r.conflicts) d.notified[c.id] ??= Date.now();
      const cutoff = Date.now() - 30 * 86_400_000; for (const [k, v] of Object.entries(d.notified)) if (v < cutoff) delete d.notified[k];
      d.seeded = true;
      const h = new Date().getHours() + new Date().getMinutes() / 60;
      const hard = fresh.filter((c) => c.severity === "hard");
      if (!first && hard.length && h >= 7 && h < 21.5 && Date.now() - (d.lastAnnounce ?? 0) > 30 * 60_000) {
        d.lastAnnounce = Date.now();
        announce?.({ kind: "conflict", text: `Heads up: ${describe(hard[0])}.${hard.length > 1 ? ` And ${hard.length - 1} more clash${hard.length > 2 ? "es" : ""}.` : ""} Open the schedule or say "fix my conflicts".` });
      }
      save(d);
      if (fresh.length) broadcast?.("conflicts", { at: Date.now(), count: r.conflicts.filter(upcoming).length });
    } catch { /* try again next time */ }
  };
  setTimeout(check, 60_000).unref?.();
  watch = setInterval(check, 10 * 60_000); watch.unref?.();
}

// ---- AI tools ----
export const TOOLS = [
  { name: "schedule_conflicts", description: "Scheduling conflicts across ALL the owner's calendars (Dayspring, Google, Outlook, subscriptions) between two dates: double-bookings, too little travel time, things on busy all-day days. Each comes with ranked fixes (option ids). Use it for 'do I have any conflicts', 'what's clashing with…'.", input_schema: { type: "object", properties: { from: { type: "string", description: "YYYY-MM-DD (default today)" }, to: { type: "string", description: "YYYY-MM-DD (default a week from today)" } } } },
  { name: "resolve_calendar_conflict", description: "Fix one conflict from schedule_conflicts with one of its option ids (or 'best', or an action word: move, shorten, swap, skip, decline, ext_move, ignore). Dayspring changes apply at once. Options marked needsConfirm change the owner's Google/Outlook calendar: this returns a question first; ask it, and only after the owner's clear yes call again with confirmed true.", input_schema: { type: "object", properties: { id: { type: "string" }, choice: { type: "string" }, confirmed: { type: "boolean" } }, required: ["id"] } },
];
export async function runTool(name, i = {}) {
  if (name === "schedule_conflicts") { try { const r = await list(i.from ?? todayISO(), i.to ?? addDays(i.from ?? todayISO(), 6)); return { conflicts: r.conflicts.filter((c) => !c.past).map(({ id, kind, severity, date, start, end, text, options: o, items: its }) => ({ id, kind, severity, date, start, end, text, items: its.map((x) => ({ title: x.title, calendar: x.sourceLabel, start: x.start, end: x.end })), options: o })) }; } catch (e) { return { error: e.message }; } }
  if (name === "resolve_calendar_conflict") { try { return await resolve(i.id, i.choice ?? "best", { confirmed: i.confirmed === true }); } catch (e) { return { error: e.message }; } }
  return undefined;
}
export function contextText() { return "Conflicts across all calendars: schedule_conflicts finds them, resolve_calendar_conflict fixes one (outside-calendar changes only after the owner says yes)."; }

// ---- spoken phrases (no AI needed) ----
let pending = null;   // an outside-calendar change waiting for the owner's yes: { id, choice, at }
const listWords = (cs) => cs.slice(0, 3).map((c) => describe(c)).join(". ");
export async function handle(text) {
  const q = String(text ?? "").toLowerCase().replace(/[?.!,]/g, "").replace(/\s+/g, " ").trim();
  if (pending && Date.now() - pending.at < 90_000) {
    if (/^(yes|yeah|yep|sure|do it|go ahead|ok(ay)?|please do|yes please)$/.test(q)) { const p = pending; pending = null; const r = await resolve(p.id, p.choice, { confirmed: true }).catch((e) => ({ error: e.message })); return r.error ? `That didn't work: ${r.error}` : r.said; }
    if (/^(no|nope|never ?mind|don'?t|leave it|no thanks)$/.test(q)) { pending = null; return "Okay, I'll leave it as it is."; }
  }
  if (!/\b(conflicts?|clash(es|ing)?|double[- ]?book(ed|ing)?|overlap(s|ping)?)\b|\baround my (meetings|appointments|calendar|events)\b/.test(q)) return null;
  const today = todayISO();
  const range = /\btomorrow\b/.test(q) ? [addDays(today, 1), addDays(today, 1)] : /\btoday\b/.test(q) ? [today, today] : /\bnext week\b/.test(q) ? [addDays(today, 7), addDays(today, 13)] : [today, addDays(today, 6)];
  const span2 = range[0] === range[1] ? (range[0] === today ? "today" : "tomorrow") : /\bnext week\b/.test(q) ? "next week" : "this week";
  // "move my study block around my meetings"
  let m = /\bmove (?:my |the )?(.+?)(?: block| time)? around (?:my |the )?(?:meetings|appointments|calendar|events|conflicts)\b/.exec(q);
  // "what's clashing with my dentist appointment" / "what conflicts with …"
  const w = /\b(?:clash(?:es|ing)?|conflicts?|overlaps?|overlapping) with (?:my |the )?(.+)$/.exec(q);
  const { conflicts } = await list(range[0], w || m ? addDays(today, 13) : range[1]);
  const open = conflicts.filter((c) => !c.past);
  if (m || w) {
    const name = norm((m ?? w)[1].replace(/\b(block|appointment|meeting|event)\b/g, ""));
    const mine = open.filter((c) => c.items.some((x) => norm(x.title).includes(name)));
    if (!mine.length) return `${(m ?? w)[1].replace(/^\w/, (s) => s.toUpperCase())} doesn't clash with anything in the next two weeks.`;
    if (w) return `${listWords(mine)}.${mine.length > 3 ? ` And ${mine.length - 3} more.` : ""} Want me to fix ${mine.length > 1 ? "them" : "it"}? Say "fix my conflicts".`;
    const done = [];
    for (const c of mine) {
      const side = c.items[0].title && norm(c.items[0].title).includes(name) ? "a" : "b";
      const o = c.options.find((x) => (x.action === "move" || x.action === "shorten" || x.action === "swap") && x.id.includes(`:${side}`));
      if (o) { const r = await resolve(c.id, o.id); if (r.done) done.push(o.label); }
    }
    return done.length ? `Okay. ${done.join(". ")}.` : `I couldn't find a free spot to move it to, and it's a fixed commitment or has no room. Open the schedule to decide.`;
  }
  if (/\b(fix|resolve|sort out|clean up|handle)\b/.test(q)) {
    if (!open.length) return `No conflicts ${span2}. You're all set.`;
    const done = [], ask = [], stuck = [];
    for (const c of open) {
      const o = c.options.find((x) => !x.needsConfirm && x.action !== "ignore" && x.action !== "skip");
      if (o) { const r = await resolve(c.id, o.id); if (r.done) done.push(o.label); continue; }
      const e = c.options.find((x) => x.needsConfirm); if (e) ask.push({ c, e }); else stuck.push(c);
    }
    let reply = done.length ? `Fixed ${done.length}: ${done.join(". ")}.` : "";
    if (ask.length) { pending = { id: ask[0].c.id, choice: ask[0].e.id, at: Date.now() }; reply += ` ${describe(ask[0].c)}, and I can't move anything in Dayspring for it. ${ask[0].e.label}? Say yes or no.`; }
    else if (!done.length) reply = `I couldn't fix those on my own: ${listWords(open)}. They involve fixed commitments. Open the schedule to decide.`;
    else if (stuck.length) reply += ` ${stuck.length} more need${stuck.length === 1 ? "s" : ""} you to decide: ${listWords(stuck)}.`;
    return reply.trim();
  }
  if (!open.length) return `No conflicts ${span2}. Everything lines up.`;
  return `${open.length} conflict${open.length > 1 ? "s" : ""} ${span2}. ${listWords(open)}.${open.length > 3 ? ` And ${open.length - 3} more.` : ""} Say "fix my conflicts" and I'll sort them out.`;
}
