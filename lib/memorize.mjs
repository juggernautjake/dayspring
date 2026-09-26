// Scripture memory: the owner's chosen books, a few verses every couple of days.
//
// How it works:
//   - Each chapter is cut into chunks of 2–3 verses (1–2 when verses are long). A chunk gets two days: day 1 learn it,
//     day 2 say it together with what came before. "I've got it" moves on early; "I need more time" adds a day.
//   - When a chapter's chunks are done, two "put it together" days: the whole chapter, start to finish.
//   - Every 7th day is a review day: the current chapter so far, plus finished chapters that are due (spaced out:
//     1 week, 2 weeks, 1, 2, 4, 6 months, then yearly), so nothing fades.
//   - The order cycles through the owner's tracks, a chapter each (e.g. a gospel → a Psalm → a Proverb); see TRACKS below.
//   - The text is the KJV (offline). Quiz: the owner recites, and it checks word by word.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { BOOKS } from "./bible.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FILE = join(here, "..", "data", "memorize.json");
const KJV = join(here, "..", "data", "bibles", "kjv.json");
const BOOK_INDEX = Object.fromEntries(BOOKS.map((b, i) => [b, i]));
// "1 John" → "First John", "Psalms" → "Psalm" (for one chapter)
const spokenBook = (b) => (b === "Psalms" ? "Psalm" : String(b).replace(/^1 /, "First ").replace(/^2 /, "Second ").replace(/^3 /, "Third "));
const REVIEW_GAPS = [7, 14, 30, 60, 120, 180, 365];
export const START = new Date().toLocaleDateString("en-CA");   // a new plan starts the day it's first used

let bible = null;
function kjv() {
  if (!bible) bible = createRequire(import.meta.url)(KJV);
  return bible;
}
const clean = (t) => String(t).replace(/[{}]/g, "").replace(/\s+([,;:.?!])/g, "$1").replace(/\s+/g, " ").trim();
export function chapterText(book, ch) { return kjv()[BOOK_INDEX[book]].chapters[ch - 1].map((t, i) => ({ n: i + 1, text: clean(t) })); }
const chapterCount = (book) => kjv()[BOOK_INDEX[book]].chapters.length;

// 2–3 verses per chunk, fewer when the verses are long (so a chunk is about the same effort either way).
export function chunksOf(verses) {
  const out = [];
  let cur = [];
  const len = (a) => a.reduce((s, v) => s + v.text.length, 0);
  for (const v of verses) {
    // up to 3 verses, or 4 when they're short (Proverbs, many Psalms), and never much over ~330 letters
    if (cur.length && (cur.length >= 4 || (cur.length >= 3 && len(cur) > 190) || len(cur) + v.text.length > 330)) { out.push(cur); cur = []; }
    cur.push(v);
  }
  if (cur.length) {
    // a lone short last verse joins the chunk before it
    if (cur.length === 1 && out.length && len(out[out.length - 1]) + cur[0].text.length < 420) out[out.length - 1].push(...cur); else out.push(cur);
  }
  return out.map((c) => ({ from: c[0].n, to: c[c.length - 1].n, verses: c }));
}

// The order of every chapter: the tracks take turns, a chapter each (e.g. [["John", "Acts"], ["Psalms"], ["Proverbs"]] gives
// John 1, Psalm 1, Proverbs 1, then John 2…). When a track runs out it simply drops out of the turn; the first track
// carries on into its later books. The owner's tracks live in data/memorize.json "tracks"; none means no plan yet.
export const TRACKS = [];
let orderCache = null;
export function order() {
  if (orderCache) return orderCache;
  const tracks = (load().tracks ?? TRACKS).map((books) => books.filter((b) => b in BOOK_INDEX).flatMap((b) => Array.from({ length: chapterCount(b) }, (_, i) => ({ book: b, ch: i + 1 }))));
  const out = [];
  while (tracks.some((t) => t.length)) for (const t of tracks) if (t.length) out.push(t.shift());
  orderCache = out.map((c, i) => ({ ...c, i, ref: `${c.book === "Psalms" ? "Psalm" : c.book} ${c.ch}`, chunks: chunksOf(chapterText(c.book, c.ch)).length, verses: chapterText(c.book, c.ch).length }));
  return orderCache;
}

// ---- state ----
let db = null;
function load() {
  if (!db) db = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { start: START, pos: { c: 0, k: 0, stage: 1 }, lastDate: null, done: [], extraToday: 0, log: [] };
  return db;
}
function save() { writeFileSync(FILE, JSON.stringify(load(), null, 2)); }
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);
const isReviewDay = (date, start) => daysBetween(start, date) > 0 && daysBetween(start, date) % 7 === 6;

// Move a cursor one working day forward: learn → reinforce → next chunk … → put together (2 days) → next chapter.
function step(pos) {
  const ch = order()[pos.c];
  if (!ch) return pos;
  if (pos.k < ch.chunks) return pos.stage === 1 ? { ...pos, stage: 2 } : { c: pos.c, k: pos.k + 1, stage: 1 };
  // k === chunks means the "put it together" days
  return pos.stage === 1 ? { ...pos, stage: 2 } : { c: pos.c + 1, k: 0, stage: 1 };
}
// Bring the cursor up to today (one step per day that went by, review days don't move it).
function catchUp(date) {
  const d = load();
  if (!d.lastDate) { d.lastDate = date < d.start ? d.start : date; save(); return d; }
  let changed = false;
  while (d.lastDate < date) {
    const next = addDays(d.lastDate, 1);
    if (!isReviewDay(d.lastDate, d.start) && !d.holdOn?.includes(d.lastDate)) { const before = d.pos.c; d.pos = step(d.pos); if (d.pos.c !== before) finishChapter(d, before, next); }
    d.lastDate = next; changed = true;
  }
  if (changed) save();
  return d;
}
function finishChapter(d, idx, date) {
  const ch = order()[idx];
  if (!ch || d.done.some((x) => x.i === idx)) return;
  d.done.push({ i: idx, ref: ch.ref, doneAt: date, box: 0, next: addDays(date, REVIEW_GAPS[0]) });
}

// What today is for: { kind: learn | reinforce | together | review, ref, verses, chapter, progress, due }
export function today(date = new Date().toLocaleDateString("en-CA")) {
  const d = catchUp(date);
  const ch = order()[d.pos.c];
  if (!order().length) return { kind: "off", ref: null, verses: [], spoken: "There's no memory verse plan yet. Tell me which books you'd like to learn and I'll set one up." };
  if (!ch) return { kind: "complete", ref: null, verses: [], spoken: "You've memorized every chapter on the list. Glory to God!" };
  const chunks = chunksOf(chapterText(ch.book, ch.ch));
  const due = d.done.filter((x) => x.next <= date).slice(0, 2).map((x) => x.ref);
  const progress = { chapter: ch.ref, chunk: Math.min(d.pos.k + 1, chunks.length), chunks: chunks.length, chaptersDone: d.done.length, chaptersTotal: order().length,
    versesDone: order().slice(0, d.pos.c).reduce((s, c) => s + c.verses, 0) + chunks.slice(0, d.pos.k).reduce((s, c) => s + c.verses.length, 0), versesTotal: order().reduce((s, c) => s + c.verses, 0) };
  const soFar = chunks.slice(0, Math.max(1, d.pos.k)).flatMap((c) => c.verses);
  if (isReviewDay(date, d.start)) return { kind: "review", ref: `${ch.ref}:1–${soFar[soFar.length - 1].n}`, verses: soFar, chapter: ch, progress, due, book: ch.book, ch: ch.ch };
  if (d.pos.k >= chunks.length) { const all = chunks.flatMap((c) => c.verses); return { kind: "together", ref: `${ch.ref}`, verses: all, chapter: ch, progress, due, stage: d.pos.stage, book: ch.book, ch: ch.ch }; }
  const cur = chunks[d.pos.k];
  return { kind: d.pos.stage === 1 ? "learn" : "reinforce", ref: `${ch.ref}:${cur.from}${cur.to !== cur.from ? "–" + cur.to : ""}`, verses: cur.verses, from: cur.from, to: cur.to,
    chapter: ch, progress, due, previous: chunks.slice(0, d.pos.k).flatMap((c) => c.verses), book: ch.book, ch: ch.ch };
}
const spokenRef = (t) => {
  const b = spokenBook(t.book);
  if (t.from === undefined) return `${b} chapter ${t.ch}`;
  return `${b} chapter ${t.ch}, verse${t.to !== t.from ? "s " + t.from + " through " + t.to : " " + t.from}`;
};
// The line for the morning.
export function spokenFocus(date) {
  const t = today(date);
  if (t.kind === "complete" || t.kind === "off") return t.spoken;
  if (t.kind === "learn") return `Your new memory verses are ${spokenRef(t)}.`;
  if (t.kind === "reinforce") return `Today you're locking in ${spokenRef(t)}${t.previous?.length ? ", and saying it together with the verses before it" : ""}.`;
  if (t.kind === "together") return `Today's a put-it-together day: all of ${spokenRef({ book: t.book, ch: t.ch })}, start to finish.`;
  return `Today's a review day: ${spokenRef({ book: t.book, ch: t.ch })} so far${t.due?.length ? `, and a refresh of ${t.due.join(" and ")}` : ""}.`;
}

// "I've got it" → the next chunk now. "I need more time" → today repeats tomorrow.
export function gotIt(date = new Date().toLocaleDateString("en-CA")) {
  const d = catchUp(date), before = d.pos.c;
  const ch = order()[d.pos.c];
  if (!ch) return today(date);
  d.pos = d.pos.k < ch.chunks ? { c: d.pos.c, k: d.pos.k + 1, stage: 1 } : { c: d.pos.c + 1, k: 0, stage: 1 };
  if (d.pos.c !== before) finishChapter(d, before, date);
  d.log.push({ at: date, did: "got it" }); save();
  return today(date);
}
export function moreTime(date = new Date().toLocaleDateString("en-CA")) {
  const d = catchUp(date);
  d.holdOn = [...new Set([...(d.holdOn ?? []).filter((x) => x >= addDays(date, -30)), date])];
  d.log.push({ at: date, did: "more time" }); save();
  return today(date);
}
// A finished chapter recited well moves to a longer gap; a rough one comes back sooner.
export function reviewed(ref, good, date = new Date().toLocaleDateString("en-CA")) {
  const d = load(), x = d.done.find((c) => c.ref.toLowerCase() === String(ref).toLowerCase());
  if (!x) return null;
  x.box = good ? Math.min(REVIEW_GAPS.length - 1, x.box + 1) : Math.max(0, x.box - 1);
  x.next = addDays(date, REVIEW_GAPS[x.box]); save();
  return x;
}

// ---- quiz: the owner recites, it checks word by word ----
const norm = (s) => String(s).toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\bthee\b|\bthou\b/g, "you").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
export function check(said, verses) {
  const want = norm(verses.map((v) => v.text).join(" ")), got = norm(said);
  // longest common subsequence: how much of the passage came out, in order
  const m = want.length, n = got.length, L = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = want[i] === got[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const missed = []; let i = 0, j = 0;
  while (i < m && j < n) { if (want[i] === got[j]) { i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) { missed.push(want[i]); i++; } else j++; }
  while (i < m) missed.push(want[i++]);
  const score = m ? L[0][0] / m : 0;
  return { score: Math.round(score * 100), missed: missed.slice(0, 8), words: m };
}
export function quizPrompt(date) {
  const t = today(date);
  if (!t.verses?.length) return null;
  const first = t.verses[0].text.split(/\s+/).slice(0, 4).join(" ");
  return { ref: t.ref, spoken: `Let's hear ${t.kind === "learn" || t.kind === "reinforce" ? spokenRef(t) : spokenRef({ book: t.book, ch: t.ch })}. It starts: "${first}…" Go ahead.`, verses: t.verses };
}

// ---- the plan: when each chapter is expected, by day, month and year ----
export function projection(from = new Date().toLocaleDateString("en-CA")) {
  const d = catchUp(from);
  let pos = { ...d.pos }, date = from;
  const out = [];
  let startOf = from;
  for (let guard = 0; guard < 20000 && order()[pos.c]; guard++) {
    if (!isReviewDay(date, d.start)) { const before = pos.c; pos = step(pos); if (pos.c !== before) { out.push({ ...order()[before], start: startOf, done: date }); startOf = addDays(date, 1); } }
    date = addDays(date, 1);
  }
  return out;
}
export function status(date) {
  const t = today(date), p = projection(date);
  return { today: t, focus: spokenFocus(date), finishing: p.length ? p[p.length - 1].done : null, next: p.slice(0, 6).map((c) => ({ ref: c.ref, done: c.done })), done: load().done.map((x) => ({ ref: x.ref, doneAt: x.doneAt, next: x.next })) };
}
