// Learning progress: the owner's courses (and an exam, if they have one) as checklists, each item
// tied to the schedule block it is planned for. Marking that block done checks the item off;
// the assistant can also check items off when the owner says they finished something.
// All of it is the owner's, in data/learning.json:
//   exam:       { name, spoken?: "the X exam", date: "YYYY-MM-DD", time, place }  (optional)
//   courseDefs: { key: { title, titleStartsWith?: "…", titleEquals?: "…" } }    (which schedule blocks build each course)
//   courses, log                                                                (the checklists and the history)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "./store.mjs";
import { writeJSONAtomic } from "./atomic.mjs";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "learning.json");
// No exam unless the owner has one (the shape stays the same, so callers can always read exam.daysLeft).
export const EXAM = { name: "", date: null, time: null, place: null };
const saved = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {});
export const exam = () => ({ ...EXAM, ...(load().exam ?? {}) });
// Which schedule blocks build each course's checklist.
function courseDefs() {
  return Object.fromEntries(Object.entries(saved().courseDefs ?? {}).map(([key, c]) => [key, { title: c.title ?? key,
    match: (b) => (c.titleStartsWith ? b.title.startsWith(c.titleStartsWith) : false) || (c.titleEquals ? b.title === c.titleEquals : false) }]));
}

let db = null;
function load() {
  if (db) return db;
  db = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : seed();
  return db;
}
function save() { writeJSONAtomic(FILE, db, 2); }

// Build the checklists from the planned study blocks already on the schedule.
function seed() {
  const blocks = store.all().blocks.slice().sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const out = { ...saved(), courses: {}, log: [] };
  for (const [key, c] of Object.entries(courseDefs())) {
    const items = [];
    for (const b of blocks) {
      if (!c.match(b) || !b.description || /plan starts tomorrow/i.test(b.description)) continue;
      // one block can hold two lessons: "… \nThen: …"
      for (const part of b.description.split(/\nThen:\s*/)) {
        items.push({
          id: `${key}-${String(items.length + 1).padStart(2, "0")}`,
          title: summarize(part),
          detail: part.trim(),
          planned: { date: b.date, start: b.start, block: b.title },
          done: Boolean(b.done), doneAt: b.done ? b.doneAt : null, note: "",
        });
      }
    }
    out.courses[key] = { title: c.title, items };
  }
  db = out; save();
  return out;
}

// "Course site → Learn → Module 2: Measuring. Linear…" → "Module 2: Measuring — Linear…"
function summarize(text) {
  let t = text.replace(/^[^\n]*→\s*/, "");
  t = t.replace(/\. /, " — ");
  return t.length > 110 ? t.slice(0, 107) + "…" : t;
}

const today = () => store.todayISO();

export function progress() {
  const d = load();
  const ex = exam();
  const out = { today: today(), exam: { ...ex, daysLeft: ex.date ? daysBetween(today(), ex.date) : null }, courses: {} };
  for (const [key, c] of Object.entries(d.courses)) {
    const done = c.items.filter((i) => i.done).length;
    const behind = c.items.filter((i) => !i.done && i.planned.date < today());
    const next = c.items.find((i) => !i.done);
    out.courses[key] = {
      title: c.title, done, total: c.items.length, percent: c.items.length ? Math.round((done / c.items.length) * 100) : 0,
      behind: behind.length, behindItems: behind.slice(0, 5).map(brief),
      next: next ? brief(next) : null,
      finishPlanned: c.items.length ? c.items[c.items.length - 1].planned.date : null,
    };
  }
  out.recent = d.log.slice(-8).reverse();
  return out;
}
const brief = (i) => ({ id: i.id, title: i.title, detail: i.detail, planned: i.planned });

export function items(course) {
  const c = load().courses[course];
  if (!c) throw new Error(`course must be one of ${Object.keys(load().courses).join(", ")}`);
  return c.items.map((i) => ({ ...i }));
}

// Check items off (or back on). `ids` wins; otherwise the first unfinished item whose text matches `match`.
export function mark({ course, ids, match, done = true, note = "" }) {
  const d = load();
  const c = d.courses[course];
  if (!c) throw new Error(`course must be one of ${Object.keys(d.courses).join(", ")}`);
  let hits = [];
  if (ids?.length) hits = c.items.filter((i) => ids.includes(i.id));
  else if (match) {
    const words = String(match).toLowerCase().split(/\s+/).filter(Boolean);
    hits = c.items.filter((i) => words.every((w) => (i.title + " " + i.detail).toLowerCase().includes(w)));
    if (hits.length > 1) hits = [hits.find((i) => i.done !== done) ?? hits[0]];
  }
  if (!hits.length) throw new Error(`nothing in ${course} matches ${ids?.join(",") || match}`);
  for (const i of hits) { i.done = done; i.doneAt = done ? new Date().toISOString() : null; if (note) i.note = note; }
  d.log.push({ at: new Date().toISOString(), course, items: hits.map((i) => i.id), done, note });
  save();
  return { changed: hits.map(brief), progress: progress().courses[course] };
}

// A course the owner adds themselves ("add a course called Spanish at duolingo.com with 30 lessons"): a checklist of
// lessons (named, or "Lesson 1…N"), not tied to schedule blocks. Returns its key.
export function addCourse({ title, lessons = [], count = 0 }) {
  const d = load();
  const name = String(title ?? "").trim().slice(0, 80);
  if (!name) throw new Error("the course needs a name");
  let key = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "course";
  for (let n = 2; d.courses[key]; n++) key = key.replace(/-\d+$/, "") + "-" + n;
  const names = (Array.isArray(lessons) && lessons.length ? lessons : Array.from({ length: Math.max(1, Math.min(300, Number(count) || 10)) }, (_, i) => `Lesson ${i + 1}`)).map((t) => String(t).trim()).filter(Boolean).slice(0, 300);
  d.courses[key] = { title: name, items: names.map((t, i) => ({ id: `${key}-${String(i + 1).padStart(2, "0")}`, title: t.slice(0, 110), detail: t, planned: { date: null, start: null, block: null }, done: false, doneAt: null, note: "" })) };
  d.log.push({ at: new Date().toISOString(), course: key, items: [], done: null, note: `added the course "${name}"` });
  save();
  return key;
}
export function removeCourse(key) {
  const d = load();
  if (!d.courses[key]) throw new Error(`no course called ${key}`);
  delete d.courses[key]; save();
  return true;
}

// Free-form learning log: a quiz score, a weak topic, a question to come back to.
export function logNote(course, note) {
  const d = load();
  d.log.push({ at: new Date().toISOString(), course, items: [], done: null, note });
  save();
  return { logged: note };
}

// Called whenever a schedule block is marked done or not done.
export function onBlockDone(block) {
  const d = load();
  let changed = 0;
  for (const c of Object.values(d.courses)) {
    for (const i of c.items) {
      if (i.planned.date === block.date && i.planned.block === block.title && i.planned.start === block.start && i.done !== block.done) {
        i.done = block.done; i.doneAt = block.done ? new Date().toISOString() : null; changed++;
      }
    }
  }
  if (changed) save();
  return changed;
}

function daysBetween(a, b) {
  const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
