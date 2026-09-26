// JSON file store. Single user, single process. Good enough until Postgres.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import * as recur from "./recur.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(here, "..", "data");
const FILE = join(DATA_DIR, "store.json");

export const CATEGORIES = ["faith", "home", "body", "work", "study", "rest", "meal", "flex"];
export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// A plain starter week for a brand-new install (the setup wizard usually replaces it). Nothing religious or personal:
// faith routines come only from the owner's own choices. Edit freely in the Schedule app.
const SEED_ROUTINES = [
  { title: "Morning routine", category: "home", days: WEEKDAYS, start: "07:00", end: "07:30", description: "Get up and get ready." },
  { title: "Breakfast", category: "meal", days: WEEKDAYS, start: "07:30", end: "08:00", description: "" },
  { title: "Lunch", category: "meal", days: WEEKDAYS, start: "12:00", end: "12:30", description: "" },
  { title: "Walk", category: "body", days: WEEKDAYS, start: "17:00", end: "17:30", description: "Get outside for a bit." },
  { title: "Dinner", category: "meal", days: WEEKDAYS, start: "18:30", end: "19:00", description: "" },
  { title: "Wind down, then bed", category: "rest", days: WEEKDAYS, start: "21:45", end: "22:15", description: "Screens off, get ready for tomorrow." },
];

let db = null;
let loadedMtime = 0;

// The server and the CLI (ds.mjs) can both touch store.json. Re-read whenever the file
// changed on disk since we last loaded it, so neither side overwrites the other's edits.
function load() {
  mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(FILE)) {
    const mtime = statSync(FILE).mtimeMs;
    if (db && mtime === loadedMtime) return db;
    db = JSON.parse(readFileSync(FILE, "utf8"));
    loadedMtime = mtime;
  } else if (db) {
    return db;
  } else {
    db = {
      blocks: [],
      tasks: [],
      routines: SEED_ROUTINES.map((r) => ({ id: randomUUID(), active: true, ...r })),
      memories: [],
      activity: [],
    };
    save();
  }
  for (const k of ["blocks", "tasks", "routines", "memories", "activity"]) db[k] ??= [];
  return db;
}

function save() {
  writeFileSync(FILE, JSON.stringify(db, null, 2));
  loadedMtime = statSync(FILE).mtimeMs;
}

export function all() {
  return load();
}

// ---- helpers ---------------------------------------------------------------

export function todayISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return todayISO(dt);
}

export function weekdayOf(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

function assertBlock(b) {
  if (!dateRe.test(b.date)) throw new Error(`date must be YYYY-MM-DD, got ${b.date}`);
  if (!timeRe.test(b.start) || !timeRe.test(b.end)) throw new Error(`start/end must be HH:MM 24h, got ${b.start}-${b.end}`);
  if (b.start >= b.end) throw new Error(`end (${b.end}) must be after start (${b.start})`);
  if (!b.title?.trim()) throw new Error("title is required");
  if (!CATEGORIES.includes(b.category)) throw new Error(`category must be one of ${CATEGORIES.join(", ")}`);
}

function sortBlocks(list) {
  return list.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

function logActivity(kind, blockId, text) {
  load().activity.push({ id: randomUUID(), at: new Date().toISOString(), kind, blockId: blockId ?? null, text: text ?? "" });
}

// ---- blocks ------------------------------------------------------------------

export function blocksBetween(from, to) {
  return sortBlocks(load().blocks.filter((b) => b.date >= from && b.date <= to).map((b) => ({ ...b })));
}

export function conflictsFor(block, ignoreId) {
  return load().blocks.filter(
    (b) => b.id !== ignoreId && b.date === block.date && b.start < block.end && block.start < b.end,
  );
}

export function addBlock(input) {
  const b = {
    id: randomUUID(),
    date: input.date,
    start: input.start,
    end: input.end,
    title: input.title.trim(),
    description: (input.description ?? "").trim(),
    category: input.category ?? "flex",
    flexible: Boolean(input.flexible),
    done: false,
    doneAt: null,
    source: input.source ?? "manual",
    // how much it matters: 0 normal, 1 notable, 2 important (stands out in the week), 3 major (month and year too)
    importance: Math.max(0, Math.min(3, Number(input.importance) || 0)),
  };
  assertBlock(b);
  const clash = conflictsFor(b);
  load().blocks.push(b);
  save();
  return { block: b, conflicts: clash };
}

export function updateBlock(id, patch) {
  const b = load().blocks.find((x) => x.id === id);
  if (!b) throw new Error(`no block with id ${id}`);
  const next = { ...b };
  for (const k of ["date", "start", "end", "title", "description", "category", "flexible"]) {
    if (patch[k] !== undefined && patch[k] !== null) next[k] = patch[k];
  }
  if (patch.importance !== undefined && patch.importance !== null) next.importance = Math.max(0, Math.min(3, Number(patch.importance) || 0));
  // a routine's block that moved to another day or got renamed shouldn't be stamped back onto its old day
  if (b.source === "routine" && (next.date !== b.date || next.title !== b.title)) skipRoutineDay(b.date, b.title);
  assertBlock(next);
  Object.assign(b, next);
  save();
  return { block: b, conflicts: conflictsFor(b, b.id) };
}

export function setDone(id, done) {
  const b = load().blocks.find((x) => x.id === id);
  if (!b) throw new Error(`no block with id ${id}`);
  b.done = Boolean(done);
  b.doneAt = b.done ? new Date().toISOString() : null;
  logActivity(b.done ? "finished" : "reopened", b.id, b.title);
  save();
  return b;
}

export function removeBlock(id) {
  const d = load();
  const i = d.blocks.findIndex((x) => x.id === id);
  if (i < 0) throw new Error(`no block with id ${id}`);
  const [removed] = d.blocks.splice(i, 1);
  // removing a routine's block for one day: that day stays clear (the routine goes on every other day)
  if (removed.source === "routine") skipRoutineDay(removed.date, removed.title);
  logActivity("removed", removed.id, removed.title);
  save();
  return removed;
}

// ---- conflict handling -----------------------------------------------------------

const toMin = (hm) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
const toHM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

// Ids of every block on a date that overlaps at least one other block that day.
export function overlapsOn(date) {
  const list = load().blocks.filter((b) => b.date === date);
  const bad = new Set();
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.start < b.end && b.start < a.end) { bad.add(a.id); bad.add(b.id); }
  }
  return bad;
}

// Push every block that overlaps `anchor` to start when it ends, keeping each one's
// duration, and cascade down the day so nothing new overlaps. Anything that would run
// past 23:59 stops at 23:59 and is reported. Returns the moved blocks.
export function shiftOthers(anchorId) {
  const d = load();
  const anchor = d.blocks.find((b) => b.id === anchorId);
  if (!anchor) throw new Error(`no block with id ${anchorId}`);
  const day = d.blocks.filter((b) => b.date === anchor.date && b.id !== anchor.id).sort((a, b) => a.start.localeCompare(b.start));
  const moved = [];
  let cursorEnd = toMin(anchor.end);
  let cursorStart = toMin(anchor.start);
  for (const b of day) {
    const s = toMin(b.start), e = toMin(b.end);
    if (e <= cursorStart) continue;           // entirely before the anchor
    if (s >= cursorEnd) { cursorEnd = Math.max(cursorEnd, e); continue; } // no overlap with the moving frontier
    const dur = e - s;
    const ns = cursorEnd;
    const ne = Math.min(ns + dur, 23 * 60 + 59);
    if (ns >= 23 * 60 + 59) { moved.push({ ...b, note: "no room left today" }); continue; }
    b.start = toHM(ns); b.end = toHM(ne);
    moved.push({ ...b });
    cursorEnd = ne;
  }
  if (moved.length) { logActivity("shifted", anchor.id, `${moved.length} block(s) pushed later for ${anchor.title}`); save(); }
  return moved;
}

// A block got shorter, moved earlier, or was removed: pull that day's later blocks earlier by `minutes` so the day
// ends sooner. Keeps each block's length and the gaps between them; fixed commitments (isFixed) never move, and
// nothing is pulled into one. Routine blocks still only projected for that day are made real first. Returns the moved.
export function pullLater(date, fromHM, minutes, { isFixed = () => false, exceptId = null } = {}) {
  if (!(minutes > 0)) return [];
  applyRoutines(date);
  const d = load(), from = toMin(fromHM);
  const later = d.blocks.filter((b) => b.date === date && b.id !== exceptId && toMin(b.start) >= from).sort((a, b) => a.start.localeCompare(b.start));
  const walls = later.filter((b) => isFixed(b));
  const moved = [];
  let cursor = from - minutes;                       // where the shortened block now ends
  for (const b of later) {
    const s = toMin(b.start), e = toMin(b.end), dur = e - s;
    if (isFixed(b)) { cursor = Math.max(cursor, e); continue; }
    const ns = Math.max(s - minutes, cursor);
    if (ns >= s || walls.some((w) => ns < toMin(w.end) && ns + dur > toMin(w.start) && toMin(w.start) < s)) { cursor = Math.max(cursor, e); continue; }
    if (b.source === "routine") skipRoutineDay(b.date, b.title);
    b.start = toHM(ns); b.end = toHM(ns + dur);
    moved.push({ id: b.id, title: b.title, start: b.start, end: b.end });
    cursor = ns + dur;
  }
  if (moved.length) { logActivity("shifted", exceptId, `${moved.length} block(s) pulled earlier`); save(); }
  return moved;
}

// Gaps on a date at least `minutes` long, between earliest and latest (HH:MM).
export function freeSlots(date, minutes, earliest = "06:00", latest = "23:00") {
  const list = load().blocks.filter((b) => b.date === date).sort((a, b) => a.start.localeCompare(b.start));
  const slots = [];
  let cursor = toMin(earliest);
  const end = toMin(latest);
  for (const b of list) {
    const s = toMin(b.start), e = toMin(b.end);
    if (s - cursor >= minutes) slots.push({ start: toHM(cursor), end: toHM(s), minutes: s - cursor });
    cursor = Math.max(cursor, e);
  }
  if (end - cursor >= minutes) slots.push({ start: toHM(cursor), end: toHM(end), minutes: end - cursor });
  return slots;
}

export function findBlocks(query, from, to) {
  const q = query.toLowerCase();
  return blocksBetween(from, to).filter((b) => b.title.toLowerCase().includes(q));
}

// Resolve a full id, an id prefix, or a title fragment (optionally limited to a date) to one block.
export function resolveBlock(ref, date) {
  const list = load().blocks.filter((b) => !date || b.date === date);
  const r = ref.toLowerCase();
  let hits = list.filter((b) => b.id === ref);
  if (!hits.length) hits = list.filter((b) => b.id.startsWith(r));
  if (!hits.length) hits = list.filter((b) => b.title.toLowerCase().includes(r));
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new Error(`no block matches "${ref}"${date ? ` on ${date}` : ""}`);
  throw new Error(`"${ref}" matches ${hits.length} blocks: ${hits.map((b) => `${b.title} (${b.date} ${b.start}, #${b.id.slice(0, 8)})`).join("; ")}`);
}

// ---- routines ----------------------------------------------------------------

// A routine is anything that repeats: every day, every other day, weekdays, chosen days, every N weeks, monthly (a date
// or "the 2nd Tuesday"), yearly, with an optional start and end (see recur.mjs). `days` is kept for older code.
export function routines() {
  return load().routines.map((r) => ({ ...r, repeatText: recur.describe(r) }));
}
function withRepeat(r, repeat) {
  r.repeat = recur.normalize(repeat ?? { freq: "weekly", days: r.days }, r.days);
  r.days = r.repeat.freq === "weekly" ? [...r.repeat.days] : [...WEEKDAYS];
  return r;
}

export function addRoutine(input) {
  const r = {
    id: randomUUID(),
    title: String(input.title ?? "").trim(),
    category: input.category ?? "flex",
    days: (input.days ?? WEEKDAYS).map((d) => d.toLowerCase().slice(0, 3)).filter((d) => WEEKDAYS.includes(d)),
    start: input.start,
    end: input.end,
    description: (input.description ?? "").trim(),
    importance: Math.max(0, Math.min(3, Number(input.importance) || 0)),
    active: true,
  };
  if (!r.title) throw new Error("title is required");
  if (!timeRe.test(r.start) || !timeRe.test(r.end) || r.start >= r.end) throw new Error("routine needs valid HH:MM start before end");
  if (!CATEGORIES.includes(r.category)) throw new Error(`category must be one of ${CATEGORIES.join(", ")}`);
  if (!input.repeat && !r.days.length) throw new Error("routine needs at least one weekday");
  withRepeat(r, input.repeat);
  load().routines.push(r);
  save();
  return { ...r, repeatText: recur.describe(r) };
}

export function updateRoutine(id, patch) {
  const r = load().routines.find((x) => x.id === id);
  if (!r) throw new Error(`no routine with id ${id}`);
  const next = { ...r };
  for (const k of ["title", "category", "start", "end", "description", "active"]) if (patch[k] !== undefined) next[k] = patch[k];
  if (patch.importance !== undefined) next.importance = Math.max(0, Math.min(3, Number(patch.importance) || 0));
  if (!timeRe.test(next.start) || !timeRe.test(next.end) || next.start >= next.end) throw new Error("the end time needs to be after the start");
  if (!CATEGORIES.includes(next.category)) throw new Error(`category must be one of ${CATEGORIES.join(", ")}`);
  if (patch.repeat) withRepeat(next, patch.repeat);
  else if (Array.isArray(patch.days)) withRepeat(next, { ...(next.repeat ?? {}), freq: "weekly", days: patch.days });
  // stamped days of this series that nobody edited follow the change (from today on)
  const today = todayISO();
  for (const b of load().blocks) {
    if (b.date < today || b.done || !(b.routineId === id || (b.source === "routine" && b.title === r.title))) continue;
    if (b.start === r.start && b.end === r.end && b.title === r.title) { b.title = next.title; b.start = next.start; b.end = next.end; b.category = next.category; b.description = next.description; }
  }
  Object.assign(r, next);
  save();
  return { ...r, repeatText: recur.describe(r) };
}
// The series a block belongs to: a projected id ("r:<id>:<date>"), a stamped block's routineId, or a routine block's title.
export function routineOf(blockOrId) {
  const d = load();
  const m = /^r:([^:]+):/.exec(typeof blockOrId === "string" ? blockOrId : blockOrId?.id ?? "");
  if (m) return d.routines.find((r) => r.id === m[1]) ?? null;
  const b = typeof blockOrId === "string" ? d.blocks.find((x) => x.id === blockOrId) : blockOrId;
  if (!b) return null;
  return d.routines.find((r) => r.id === b.routineId) ?? (b.source === "routine" ? d.routines.find((r) => r.title === b.title) ?? null : null);
}
// Turn a one-time item into a repeating one, starting on its own date (the item itself becomes the first occurrence).
export function makeRecurring(blockId, repeat) {
  const b = load().blocks.find((x) => x.id === blockId);
  if (!b) throw new Error(`no block with id ${blockId}`);
  const r = addRoutine({ title: b.title, start: b.start, end: b.end, category: b.category, description: b.description, importance: b.importance, repeat: { ...repeat, start: repeat?.start ?? b.date } });
  b.source = "routine"; b.routineId = r.id;
  save();
  return r;
}

// End a series from a date on ("delete this one and every one after it"): it stops the day before, and its not-yet-done
// days from that date on come off the schedule. Ending it before it ever started removes it.
export function endRoutine(id, from) {
  const d = load(), r = d.routines.find((x) => x.id === id);
  if (!r) throw new Error(`no routine with id ${id}`);
  const rule = recur.ruleOf(r), until = addDays(from, -1);
  d.blocks = d.blocks.filter((b) => !(b.date >= from && !b.done && (b.routineId === id || (b.source === "routine" && b.title === r.title))));
  if (rule.start && until < rule.start) { d.routines = d.routines.filter((x) => x.id !== id); save(); return null; }
  r.repeat = { ...rule, until }; save();
  return { ...r, repeatText: recur.describe(r) };
}
// Stop a series. future: also take its not-yet-done days from today on off the schedule (past days stay as history).
export function removeRoutine(id, { future = false } = {}) {
  const d = load();
  const i = d.routines.findIndex((x) => x.id === id);
  if (i < 0) throw new Error(`no routine with id ${id}`);
  const [r] = d.routines.splice(i, 1);
  if (future) { const today = todayISO(); d.blocks = d.blocks.filter((b) => !(b.date >= today && !b.done && (b.routineId === id || (b.source === "routine" && b.title === r.title)))); }
  save();
}

// The plan for a range of days without changing anything: the blocks already on each day, plus the routines that
// would be stamped there (marked projected: true). Used by the week, month and year views.
export function planBetween(from, to) {
  const d = load(), out = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const have = d.blocks.filter((b) => b.date === day).map((b) => ({ ...b }));
    for (const r of d.routines) {
      if (!recur.occursOn(r, day) || have.some((b) => b.title === r.title) || isSkipped(day, r.title)) continue;
      have.push({ id: `r:${r.id}:${day}`, date: day, start: r.start, end: r.end, title: r.title, description: r.description ?? "", category: r.category, projected: true, done: false, importance: r.importance ?? 0, routineId: r.id, repeatText: recur.describe(r), repeat: recur.ruleOf(r) });
    }
    for (const b of have) if (!b.projected && (b.routineId || b.source === "routine")) { const r = b.routineId ? d.routines.find((x) => x.id === b.routineId) : d.routines.find((x) => x.title === b.title); if (r) { b.routineId = r.id; b.repeatText = recur.describe(r); b.repeat = recur.ruleOf(r); } }
    out.push(...sortBlocks(have));
  }
  return out;
}

// Routine days he edited or removed: "date|title" (kept for a year).
export function skipRoutineDay(date, title) {
  const d = load(); d.skips ??= [];
  const k = `${date}|${title}`;
  if (!d.skips.includes(k)) d.skips.push(k);
  const cutoff = addDays(todayISO(), -370); d.skips = d.skips.filter((x) => x.slice(0, 10) >= cutoff);
  save();
}
const isSkipped = (date, title) => (load().skips ?? []).includes(`${date}|${title}`);
// A projected routine day ("r:<routineId>:<date>") made real, so it can be edited like any block.
export function materialize(projectedId) {
  const m = /^r:([^:]+):(\d{4}-\d{2}-\d{2})$/.exec(String(projectedId));
  if (!m) return null;
  const r = load().routines.find((x) => x.id === m[1]);
  if (!r) throw new Error("that routine no longer exists");
  const same = load().blocks.find((b) => b.date === m[2] && b.title === r.title);
  if (same) return same;
  const nb = addBlock({ date: m[2], start: r.start, end: r.end, title: r.title, description: r.description, category: r.category, importance: r.importance, source: "routine" }).block;
  nb.routineId = r.id; save();
  return nb;
}

// Stamp active routines onto a date. Skips any routine that already has a block that day
// with the same title, so it's safe to run twice.
export function applyRoutines(date) {
  const d = load();
  const existing = d.blocks.filter((b) => b.date === date);
  const added = [];
  for (const r of d.routines) {
    if (!recur.occursOn(r, date)) continue;
    if (existing.some((b) => b.title === r.title) || isSkipped(date, r.title)) continue;
    const { block } = addBlock({ date, start: r.start, end: r.end, title: r.title, description: r.description, category: r.category, importance: r.importance, source: "routine" });
    block.routineId = r.id;
    added.push(block);
  }
  if (added.length) save();
  return added;
}

// ---- tasks -------------------------------------------------------------------

export function tasks(includeDone = false) {
  return load().tasks.filter((t) => includeDone || !t.done).map((t) => ({ ...t }));
}

export function addTask(input) {
  const t = {
    id: randomUUID(),
    title: input.title.trim(),
    category: CATEGORIES.includes(input.category) ? input.category : "flex",
    dueDate: input.dueDate && dateRe.test(input.dueDate) ? input.dueDate : null,
    estimateMinutes: Number(input.estimateMinutes) || null,
    notes: (input.notes ?? "").trim(),
    done: false,
    createdAt: new Date().toISOString(),
  };
  if (!t.title) throw new Error("task title is required");
  load().tasks.push(t);
  save();
  return t;
}

export function setTaskDone(id, done) {
  const t = load().tasks.find((x) => x.id === id);
  if (!t) throw new Error(`no task with id ${id}`);
  t.done = Boolean(done);
  save();
  return t;
}

export function removeTask(id) {
  const d = load();
  const i = d.tasks.findIndex((x) => x.id === id);
  if (i < 0) throw new Error(`no task with id ${id}`);
  d.tasks.splice(i, 1);
  save();
}

// ---- memory + activity ---------------------------------------------------------

export function memories() {
  return load().memories.map((m) => ({ ...m }));
}

export function remember(text) {
  const m = { id: randomUUID(), text: text.trim(), createdAt: new Date().toISOString() };
  if (!m.text) throw new Error("memory text is required");
  load().memories.push(m);
  save();
  return m;
}

export function forget(id) {
  const d = load();
  const i = d.memories.findIndex((x) => x.id === id);
  if (i < 0) throw new Error(`no memory with id ${id}`);
  d.memories.splice(i, 1);
  save();
}

export function note(text) {
  logActivity("note", null, text);
  save();
}

export function activitySince(iso) {
  return load().activity.filter((a) => a.at >= iso);
}
