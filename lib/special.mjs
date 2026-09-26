// What makes a day special: US holidays (state days go in the owner's occasions), the church year, birthdays, and the owner's own occasions.
// Works fully offline. People and occasions live in data/people.json, which the owner fills by voice
// ("remember that Sarah's birthday is March 3rd") or by editing the file.
//   people:    [{ id, name, birthday: "MM-DD", year?, relation?, phone?, notes? }]
//   occasions: [{ id, title, date: "YYYY-MM-DD" (once) or "MM-DD" (every year), kind?, year? }]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import * as church from "./church.mjs";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "people.json");
const SEED = {
  _about: "Birthdays (MM-DD, add year to hear their age) and occasions (YYYY-MM-DD once, or MM-DD every year). Dayspring mentions them in the morning.",
  people: [],
  occasions: [],
};
let db = null;
function load() {
  if (!db) db = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : structuredClone(SEED);
  db.people ??= []; db.occasions ??= [];
  return db;
}
function save() { writeFileSync(FILE, JSON.stringify(load(), null, 2)); }

const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
// the nth weekday (0 = Sunday) of a month; n = -1 is the last one
function nthWeekday(y, m, wd, n) {
  if (n > 0) { const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); return iso(y, m, 1 + ((wd - first + 7) % 7) + (n - 1) * 7); }
  const last = new Date(Date.UTC(y, m, 0)); const d = last.getUTCDate() - ((last.getUTCDay() - wd + 7) % 7); return iso(y, m, d);
}
function easter(y) {   // Anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}
const shift = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// Every holiday in a year: { date, title, kind: "holiday" | "church" | "fun" | "season" | "civic", big? }
const cache = new Map();
export function holidays(y) {
  if (cache.has(y)) return cache.get(y);
  const E = easter(y);
  const christmas = iso(y, 12, 25), cwd = new Date(christmas + "T12:00:00Z").getUTCDay();
  const advent = shift(christmas, -(cwd === 0 ? 28 : cwd + 21));
  const list = [
    [iso(y, 1, 1), "New Year's Day", "holiday", true], [iso(y, 1, 6), "Epiphany", "church"], [nthWeekday(y, 1, 1, 3), "Martin Luther King Jr. Day", "holiday"],
    [iso(y, 2, 2), "Groundhog Day", "fun"], [iso(y, 2, 14), "Valentine's Day", "holiday", true], [nthWeekday(y, 2, 1, 3), "Presidents' Day", "holiday"],
    [nthWeekday(y, 3, 0, 2), "Daylight saving time starts (clocks go forward an hour)", "civic"],
    [iso(y, 3, 14), "Pi Day", "fun"], [iso(y, 3, 17), "St. Patrick's Day", "holiday"], [iso(y, 3, 20), "the first day of spring", "season"],
    [iso(y, 4, 1), "April Fools' Day", "fun"], [shift(E, -46), "Ash Wednesday, the start of Lent", "church"], [shift(E, -7), "Palm Sunday", "church", true],
    [shift(E, -3), "Maundy Thursday", "church"], [shift(E, -2), "Good Friday", "church", true], [E, "Easter Sunday. He is risen!", "church", true],
    [nthWeekday(y, 5, 4, 1), "the National Day of Prayer", "church"], [nthWeekday(y, 5, 0, 2), "Mother's Day", "holiday", true], [nthWeekday(y, 5, 1, -1), "Memorial Day", "holiday", true],
    [shift(E, 39), "Ascension Day", "church"], [shift(E, 49), "Pentecost Sunday", "church", true],
    [nthWeekday(y, 6, 0, 3), "Father's Day", "holiday", true], [iso(y, 6, 19), "Juneteenth", "holiday"], [iso(y, 6, 21), "the first day of summer", "season"],
    [iso(y, 7, 4), "Independence Day", "holiday", true], [nthWeekday(y, 9, 1, 1), "Labor Day", "holiday"], [iso(y, 9, 11), "Patriot Day", "civic"],
    [iso(y, 9, 22), "the first day of fall", "season"], [nthWeekday(y, 10, 1, 2), "Columbus Day", "holiday"],
    [iso(y, 10, 31), "Reformation Day, and Halloween", "church"], [nthWeekday(y, 11, 0, 1), "the end of daylight saving time (clocks go back an hour)", "civic"],
    [iso(y, 11, 11), "Veterans Day", "holiday"], [nthWeekday(y, 11, 4, 4), "Thanksgiving", "holiday", true], [advent, "the first Sunday of Advent", "church", true],
    [iso(y, 12, 21), "the first day of winter", "season"], [iso(y, 12, 24), "Christmas Eve", "holiday", true], [christmas, "Christmas Day", "holiday", true], [iso(y, 12, 31), "New Year's Eve", "holiday"],
  ];
  if (y % 2 === 0) { const firstMon = nthWeekday(y, 11, 1, 1); list.push([shift(firstMon, 1), "Election Day", "civic"]); }
  const out = list.map(([date, title, kind, big]) => ({ date, title, kind, big: Boolean(big) }));
  cache.set(y, out);
  return out;
}

// Everything special on a date: holidays, birthdays (with age when the year is known), occasions.
export function forDate(date) {
  const [y, m, d] = date.split("-").map(Number), md = `${pad(m)}-${pad(d)}`;
  const out = holidays(y).filter((h) => h.date === date).map((h) => ({ ...h }));
  // a monthly church meal, when the owner's church has one (data/church.json "potluck": { weekOfMonth, day, title })
  const pot = church.potluck();
  if (pot && nthWeekday(y, m, pot.dow, pot.weekOfMonth) === date) out.push({ date, kind: "occasion", big: true, title: pot.title });
  for (const p of load().people) {
    if (p.birthday !== md && !(p.birthday === "02-29" && md === "02-28" && !isLeap(y))) continue;
    const age = p.year ? y - p.year : null;
    out.push({ date, kind: "birthday", big: true, person: p.name, personId: p.id, age, title: `${p.name}'s ${age ? ordinal(age) + " " : ""}birthday` });
  }
  for (const o of load().occasions) {
    const hit = o.date.length === 10 ? o.date === date : o.date === md;
    if (!hit) continue;
    const years = o.date.length === 5 && o.year ? y - o.year : null;
    out.push({ date, kind: o.kind ?? "occasion", big: true, title: years ? `${o.title} (${years} years)` : o.title });
  }
  return out;
}
export function between(from, to) {
  const out = [];
  for (let d = from; d <= to; d = shift(d, 1)) out.push(...forDate(d));
  return out;
}
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export function ordinal(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

// "Today is Thanksgiving, and it's Sarah's birthday." — or null on an ordinary day.
export function spokenToday(date) {
  const items = forDate(date);
  if (!items.length) return null;
  const bits = items.map((i) => i.kind === "birthday" ? `it's ${i.title}` : i.kind === "milestone" ? `it's ${i.title}` : `it's ${i.title}`);
  const join = bits.length === 1 ? bits[0] : bits.slice(0, -1).join(", ") + ", and " + bits[bits.length - 1];
  return `Today is special: ${join}.`.replace(/: it's (Easter Sunday\. He is risen!)/, ": it's $1");
}
// Birthdays and big days coming up in the next n days (for the rundown and "what's coming up").
export function upcoming(from, days = 14) {
  return between(shift(from, 1), shift(from, days)).filter((i) => i.big || i.kind === "birthday");
}

// ---- people ----
export function people() { return load().people.map((p) => ({ ...p })); }
export function findPerson(name) {
  const n = String(name ?? "").toLowerCase().replace(/'s$/, "").trim();
  if (!n) return null;
  const exact = load().people.find((p) => p.name.toLowerCase() === n || p.aliases?.some((a) => a.toLowerCase() === n));
  if (exact) return exact;
  // a first name alone only counts when exactly one person has it ("Sam" could be Sam Lee or Jordan's Sam)
  const byFirst = load().people.filter((p) => p.name.toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0]);
  return byFirst.length === 1 && !n.includes(" ") ? byFirst[0] : null;
}
const findExact = (name) => { const n = String(name).toLowerCase().trim(); return load().people.find((p) => p.name.toLowerCase() === n || p.aliases?.some((a) => a.toLowerCase() === n)) ?? null; };
// Parse "March 3rd", "3/3", "03-03", "the 3rd of March", optionally with a year.
export function parseDay(text) {
  const t = String(text).toLowerCase();
  let m = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/.exec(t);
  if (m) return { md: `${pad(monthIndex(m[1]))}-${pad(m[2])}`, year: m[3] ? Number(m[3]) : null };
  m = /\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+of\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:,?\s+(\d{4}))?/.exec(t);
  if (m) return { md: `${pad(monthIndex(m[2]))}-${pad(m[1])}`, year: m[3] ? Number(m[3]) : null };
  m = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/.exec(t);
  if (m) { const yr = m[3] ? Number(m[3].length === 2 ? "19" + m[3] : m[3]) : null; return { md: `${pad(m[1])}-${pad(m[2])}`, year: yr }; }
  return null;
}
function monthIndex(w) { return MONTHS.findIndex((x) => x.startsWith(w.slice(0, 3))) + 1; }
export function addPerson({ name, birthday, year = null, relation = null, phone = null, notes = null }) {
  const clean = String(name).trim().replace(/\b\w/g, (c) => c.toUpperCase());
  const existing = findPerson(clean);
  if (existing) { Object.assign(existing, Object.fromEntries(Object.entries({ birthday, year, relation, phone, notes }).filter(([, v]) => v != null))); save(); return { person: { ...existing }, updated: true }; }
  const p = { id: randomUUID(), name: clean, birthday, year, relation, phone, notes };
  load().people.push(p); save();
  return { person: { ...p }, updated: false };
}
export function addOccasion({ title, date, kind = "occasion", year = null }) {
  const o = { id: randomUUID(), title: String(title).trim(), date, kind, year };
  load().occasions.push(o); save();
  return o;
}
export function removePerson(name) { const p = findPerson(name); if (!p) return null; load().people = load().people.filter((x) => x.id !== p.id); save(); return p; }
// ---- people profiles: everyone the owner prays for or talks about ----
// { id, name, aliases, relation, groups, birthday, year, notes: [{ at, text, source }], prayer: [text], unknown: [{ at, topic }],
//   mentions, lastMentioned, lastAsked, asked: { topic: date } }
function shape(p) {
  p.aliases ??= []; p.groups ??= []; p.notes ??= []; p.prayer ??= []; p.unknown ??= []; p.asked ??= {}; p.mentions ??= 0;
  return p;
}
export function ensurePerson(name, patch = {}) {
  const clean = String(name).trim().replace(/\s+/g, " ");
  if (!clean) return null;
  let p = findExact(clean);
  if (!p) { p = shape({ id: randomUUID(), name: clean, birthday: null, year: null, relation: null, created: new Date().toISOString() }); load().people.push(p); }
  shape(p);
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) continue;
    if (Array.isArray(p[k])) { for (const x of [].concat(v)) if (!p[k].includes(x)) p[k].push(x); } else if (k !== "notes") p[k] = v;
  }
  save();
  return p;
}
export function addNote(name, text, source = "told") {
  const p = ensurePerson(name);
  if (!p || !String(text).trim()) return p;
  p.notes.push({ at: new Date().toISOString(), text: String(text).trim(), source });
  save();
  return p;
}
export function recordUnknown(name, topic) { const p = ensurePerson(name); p.unknown.push({ at: new Date().toISOString(), topic }); save(); return p; }
export function profileOf(name) { const p = findPerson(name) ?? load().people.find((x) => x.aliases?.some((a) => a.toLowerCase() === String(name).toLowerCase())); return p ? structuredClone(shape(p)) : null; }
export function allProfiles() { return load().people.map((p) => structuredClone(shape(p))); }
// Names the owner said that Dayspring already knows (for "mentioned" notes and keeping people in mind).
export function mentionsIn(text) {
  const t = ` ${String(text).toLowerCase()} `;
  return load().people.filter((p) => [p.name, ...(p.aliases ?? [])].some((n) => n.length >= 3 && !/^the /i.test(n) && (t.includes(` ${n.toLowerCase()} `) || t.includes(` ${n.toLowerCase()}'s `) || t.includes(` ${n.toLowerCase()},`) || t.includes(` ${n.toLowerCase()}.`))));
}
// Who to ask about next: someone Dayspring knows little about, not asked recently; people on today's prayer list first.
export function pickToAsk(prefer = []) {
  const now = Date.now();
  const pool = load().people.map(shape).filter((p) => !/^the /i.test(p.name) && (!p.lastAsked || now - Date.parse(p.lastAsked) > 10 * 86400000));
  if (!pool.length) return null;
  const score = (p) => p.notes.length * 2 + (p.relation ? 1 : 0) + (p.birthday ? 1 : 0) - (prefer.some((n) => n.toLowerCase() === p.name.toLowerCase()) ? 5 : 0) + Math.random() * 1.5;
  return pool.sort((a, b) => score(a) - score(b))[0];
}
const ASK = {
  how: ["How's {n} doing lately?", "What's the latest with {n}?", "Have you heard from {n} recently? How are they doing?"],
  know: ["How do you know {n}?", "Remind me, who is {n} to you?"],
  birthday: ["Do you know when {n}'s birthday is?"],
  pray: ["Is there anything specific I should pray about for {n}?", "What's going on with {n} that we should be praying about?"],
  detail: ["Tell me something about {n}. What are they like?", "What's {n} up to these days: work, school, family?"],
};
// The next question about someone: what Dayspring doesn't know yet comes first.
export function questionFor(p) {
  const didnt = new Set(p.unknown.map((u) => u.topic));
  const topic = !p.relation && !didnt.has("know") ? "know" : !p.birthday && !didnt.has("birthday") && Math.random() < 0.5 ? "birthday" : p.notes.length < 2 ? (Math.random() < 0.5 ? "pray" : "how") : ["how", "pray", "detail"][Math.floor(Math.random() * 3)];
  const list = ASK[topic];
  return { topic, text: list[Math.floor(Math.random() * list.length)].replaceAll("{n}", p.name) };
}
let pendingAsk = null;
export function markAsking(p, topic) { const x = findPerson(p.name); if (x) { shape(x); x.lastAsked = new Date().toISOString(); x.asked[topic] = new Date().toLocaleDateString("en-CA"); save(); } pendingAsk = { name: p.name, topic, at: Date.now() }; }
export function pendingQuestion() { return pendingAsk && Date.now() - pendingAsk.at < 10 * 60_000 ? pendingAsk : null; }
export function clearQuestion() { pendingAsk = null; }
export const monthName = (md) => { const [m, d] = md.split("-").map(Number); return `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${ordinal(d)}`; };
