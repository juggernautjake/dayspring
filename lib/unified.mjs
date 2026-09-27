// Every calendar in one place: Dayspring's own schedule, each Google calendar, Outlook, calendar subscriptions (ICS),
// and Microsoft To Do / Todoist items that have a due date, as one list of items with the same shape:
//   { id, key, source, sourceKey, sourceLabel, color, calendar, title, date, start, end, allDay, where, notes, link,
//     busy, readOnly, kind: "event"|"task", … Dayspring fields (category, importance, projected, routineId, anchored) }
// Each source is fetched on its own (one failing never hides the others) and cached for 5 minutes; sources() says how each
// one is doing and when it last refreshed. Which sources the owner hid, and which all-day items they marked busy, are
// kept in data/calsources.json. Events Dayspring copied onto Google/Outlook itself (calsync.mjs) are left out.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "./store.mjs";
import * as planner from "./planner.mjs";
import * as google from "./connectors/google.mjs";
import * as microsoft from "./connectors/microsoft.mjs";
import * as ics from "./connectors/ics.mjs";
import * as todoist from "./connectors/todoist.mjs";
import * as calsync from "./calsync.mjs";
import { writeJSONAtomic } from "./atomic.mjs";

const DIR = process.env.DAYSPRING_CALDATA_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const FILE = () => join(DIR, "calsources.json");
const DEFAULTS = { hidden: [], busyAllDay: [], travel: { on: false, minutes: 15 } };
export function config() { try { return { ...DEFAULTS, ...(existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), "utf8")) : {}) }; } catch { return { ...DEFAULTS }; } }
export function setConfig(patch) {
  const c = { ...config(), ...patch };
  c.hidden = [...new Set((c.hidden ?? []).map(String))].slice(0, 100);
  c.busyAllDay = [...new Set((c.busyAllDay ?? []).map(String))].slice(-300);
  c.travel = { on: Boolean(c.travel?.on), minutes: Math.max(5, Math.min(120, Number(c.travel?.minutes) || 15)) };
  mkdirSync(DIR, { recursive: true }); writeJSONAtomic(FILE(), c, 2);
  return c;
}
export const setHidden = (key, hidden) => { const c = config(); return setConfig({ hidden: hidden ? [...c.hidden, key] : c.hidden.filter((k) => k !== key) }); };
export const setBusyAllDay = (id, busy) => { const c = config(); clear(); return setConfig({ busyAllDay: busy ? [...c.busyAllDay, id] : c.busyAllDay.filter((k) => k !== id) }); };

// ---- colors and labels ----
const GOOGLE_COLORS = ["#4285f4", "#0b8043", "#8e24aa", "#f4511e", "#039be5", "#e67c73", "#33b679", "#f6bf26"];
const ICS_COLORS = ["#8d6e63", "#5c6bc0", "#26a69a", "#ec407a", "#7cb342", "#ffa726"];
const FIXED = { dayspring: { label: "Dayspring", color: "" }, microsoft: { label: "Outlook", color: "#0078d4" }, todo: { label: "Microsoft To Do", color: "#6264a7" }, todoist: { label: "Todoist", color: "#e44332" } };
const APP = { google: "Google Calendar", microsoft: "Outlook", ics: "the calendar's website", todo: "Microsoft To Do", todoist: "Todoist" };

// ---- per-source fetching, cached, with status ----
const cache = new Map();                    // `${key}|${from}|${to}` → { at, items }
const state = new Map();                    // source → { ok, error, at, count }
let googleCals = { at: 0, list: [] };
export function clear() { cache.clear(); googleCals.at = 0; try { ics.clearCache(); } catch { /* ignore */ } }
async function cached(src, from, to, force, fn) {
  const k = `${src}|${from}|${to}`, hit = cache.get(k);
  if (!force && hit && Date.now() - hit.at < 5 * 60_000) return hit.items;
  try {
    const items = await fn();
    cache.set(k, { at: Date.now(), items }); if (cache.size > 80) cache.delete(cache.keys().next().value);
    state.set(src, { ok: true, error: null, at: Date.now(), count: items.length });
    return items;
  } catch (e) {
    state.set(src, { ok: false, error: e.message, at: state.get(src)?.at ?? null, count: 0 });
    return hit?.items ?? [];
  }
}
const toMin = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
const toHM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const isFiller = (b) => /free time|your time|open afternoon|open evening|game time|\bbuffer\b/i.test(b.title ?? "");
// A Dayspring item's lasting key: a routine's day keeps the same key before and after it's edited (r:<routine>:<date>)
export const keyOf = (b) => (b.routineId ? `r:${b.routineId}:${b.date}` : b.id);

function dayspring(from, to) {
  return store.planBetween(from, to).map((b) => ({
    id: b.id, key: keyOf(b), source: "dayspring", sourceKey: "dayspring", sourceLabel: "Dayspring", color: "", calendar: "Dayspring",
    title: b.title, date: b.date, start: b.start, end: b.end, allDay: false, where: "", notes: b.description ?? "", link: null,
    busy: !isFiller(b), readOnly: false, kind: "event", category: b.category, importance: b.importance ?? 0, projected: Boolean(b.projected),
    routineId: b.routineId ?? null, repeatText: b.repeatText ?? null, done: Boolean(b.done), fixed: planner.isFixed(b), anchored: planner.isAnchored(b),
  }));
}
async function googleCalendars() {
  if (Date.now() - googleCals.at < 30 * 60_000 && googleCals.list.length) return googleCals.list;
  googleCals = { at: Date.now(), list: await google.calendars() };
  return googleCals.list;
}
async function googleItems(from, to, force) {
  const cals = await googleCalendars().catch(() => []);
  const own = calsync.ownIds();
  return cached("google", from, to, force, async () => (await google.events(from, to, { calendarIds: cals.length ? cals.filter((c) => c.selected).map((c) => c.id) : undefined }))
    .filter((e) => !e.dayspring && !e.declined && !own.has(e.id))
    .map((e) => { const i = Math.max(0, cals.findIndex((c) => c.id === e.calendar)), c = cals[i];
      return ext(e, `google:${e.calendar}`, c ? (c.primary ? "Google" : `Google · ${c.name}`) : "Google", GOOGLE_COLORS[i % GOOGLE_COLORS.length], c?.name ?? "Google Calendar"); }));
}
function ext(e, sourceKey, sourceLabel, color, calendar) {
  return { id: e.id, key: e.id, source: e.source, sourceKey, sourceLabel, color, calendar, title: e.title, date: e.date, start: e.start, end: e.end, allDay: Boolean(e.allDay),
    where: e.where ?? "", notes: e.notes ?? "", link: e.link ?? null, busy: e.busy !== false && !(e.allDay && e.busy === undefined), readOnly: e.source === "ics",
    kind: "event", invited: Boolean(e.invited), organizerSelf: e.organizerSelf !== false, calendarId: e.source === "google" ? e.calendar : null, tz: e.tz ?? null, openIn: APP[e.source] };
}
async function microsoftItems(from, to, force) {
  const own = calsync.ownIds();
  return cached("microsoft", from, to, force, async () => (await microsoft.events(from, to)).filter((e) => !e.dayspring && !e.declined && !own.has(e.id))
    .map((e) => ext(e, "microsoft", "Outlook", FIXED.microsoft.color, "Outlook")));
}
async function icsItems(from, to, force) {
  const cals = ics.status().calendars ?? [];
  return cached("ics", from, to, force, async () => (await ics.events(from, to)).map((e) => {
    const cid = String(e.id).split(":")[1], i = Math.max(0, cals.findIndex((c) => c.id === cid));
    return ext(e, `ics:${cid}`, e.calendar ?? "Subscription", ICS_COLORS[i % ICS_COLORS.length], e.calendar ?? "Subscription");
  }));
}
// tasks with a due date inside the range: all-day unless Todoist has a time on it; never "busy" (they don't clash)
const task = (sourceKey, t, date, start, end, allDay) => ({ id: `${sourceKey}:${t.id}`, key: `${sourceKey}:${t.id}`, source: sourceKey, sourceKey, sourceLabel: FIXED[sourceKey].label, color: FIXED[sourceKey].color,
  calendar: FIXED[sourceKey].label, title: t.title, date, start, end, allDay, where: "", notes: t.project ? `Project: ${t.project}` : t.list ? `List: ${t.list}` : "", link: t.url ?? null,
  busy: false, readOnly: true, kind: "task", openIn: APP[sourceKey] });
async function todoItems(from, to, force) {
  return cached("todo", from, to, force, async () => { const r = await microsoft.tasks(); return r.tasks.filter((t) => t.due && t.due >= from && t.due <= to).map((t) => task("todo", { ...t, list: r.list }, t.due, "00:00", "23:59", true)); });
}
async function todoistItems(from, to, force) {
  return cached("todoist", from, to, force, async () => (await todoist.tasks()).tasks.filter((t) => t.due && t.due.slice(0, 10) >= from && t.due.slice(0, 10) <= to).map((t) => {
    const timed = /T\d{2}:\d{2}/.test(t.due), s = timed ? t.due.slice(11, 16) : "00:00";
    return task("todoist", t, t.due.slice(0, 10), s, timed ? toHM(Math.min(toMin(s) + 30, 23 * 60 + 59)) : "23:59", !timed);
  }));
}
// Microsoft To Do is only read when the owner has used it (tasks need a separate Graph permission some accounts lack)
const todoOn = () => microsoft.connected() && config().todo !== false;

// Everything between two dates (YYYY-MM-DD). force = skip the 5-minute cache (the Sources panel's Refresh button).
export async function items(from, to, { force = false } = {}) {
  const c = config(), marked = new Set(c.busyAllDay);
  const jobs = [Promise.resolve(dayspring(from, to))];
  state.set("dayspring", { ok: true, error: null, at: Date.now(), count: 0 });
  if (google.connectedFor("calendar")) jobs.push(googleItems(from, to, force));
  if (microsoft.connected()) jobs.push(microsoftItems(from, to, force));
  if (ics.connected()) jobs.push(icsItems(from, to, force));
  if (todoOn()) jobs.push(todoItems(from, to, force));
  if (todoist.connected()) jobs.push(todoistItems(from, to, force));
  const all = (await Promise.all(jobs)).flat();
  state.get("dayspring").count = all.filter((x) => x.source === "dayspring").length;
  for (const x of all) { if (x.allDay && x.kind === "event" && marked.has(x.id)) x.busy = true; x.markedBusy = marked.has(x.id); x.hidden = c.hidden.includes(x.sourceKey) || c.hidden.includes(x.source); }
  return all.sort((a, b) => (a.date + (a.allDay ? "" : a.start)).localeCompare(b.date + (b.allDay ? "" : b.start)));
}

// The Sources panel: every connected source (each Google calendar and subscription on its own row), how it's doing,
// when it last refreshed, whether it's shown, and its color.
export async function sources() {
  const c = config(), out = [];
  const row = (key, label, color, src, extra = {}) => { const s = state.get(src) ?? {}; out.push({ key, label, color, source: src, hidden: c.hidden.includes(key), ok: s.ok ?? null, error: s.error ?? null, at: s.at ?? null, ...extra }); };
  row("dayspring", "Dayspring", "", "dayspring", { note: "Your own schedule" });
  if (google.connectedFor("calendar")) {
    const cals = await googleCalendars().catch((e) => { state.set("google", { ok: false, error: e.message, at: state.get("google")?.at ?? null }); return []; });
    if (!cals.length) row("google", "Google Calendar", GOOGLE_COLORS[0], "google");
    cals.forEach((cal, i) => { if (cal.selected) row(`google:${cal.id}`, cal.primary ? "Google" : `Google · ${cal.name}`, GOOGLE_COLORS[i % GOOGLE_COLORS.length], "google", { note: cal.primary ? cal.name : "" }); });
  }
  if (microsoft.connected()) row("microsoft", "Outlook", FIXED.microsoft.color, "microsoft");
  if (ics.connected()) (ics.status().calendars ?? []).forEach((cal, i) => row(`ics:${cal.id}`, cal.name, ICS_COLORS[i % ICS_COLORS.length], "ics", { note: cal.host }));
  if (todoOn()) row("todo", "Microsoft To Do", FIXED.todo.color, "todo", { note: "Tasks with a due date" });
  if (todoist.connected()) row("todoist", "Todoist", FIXED.todoist.color, "todoist", { note: "Tasks with a due date" });
  return { sources: out, travel: c.travel, sync: calsync.status() };
}
