// The morning, start to finish:
//   1. The day's first block arrives → a wake song plays on the TV (sunrise on screen).
//   2. About 30 seconds in, the song dips and the assistant greets the owner by name, slowly. With faith turned on
//      (owner.feature("faith")) that's "…This is the day that the Lord has made!" and then time with God: today's reading,
//      the memory focus, who to pray for, and an offer of worship music for later — and "Do you want some softer, meditative
//      music while you read, or just quiet for now?"
//   3. When the quiet time block ends: "Hey <name>, are you ready to begin your day, or do you need a few more minutes?"
//   4. "Ready" → the rundown of the day, with every reminder and task for today. "A few more minutes" → it asks again later.
// The owner curates data/devotion.json (reading plan, memory passage, prayer list, wake songs); the assistant rotates through it.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "./store.mjs";
import * as llm from "./llm.mjs";
import * as owner from "./owner.mjs";
import * as reminders from "./reminders.mjs";
import * as learning from "./learning.mjs";
import * as voice from "./voice.mjs";
import { phrase } from "./phrases.mjs";
import * as profile from "./profile.mjs";
import { MORNING_PLAYLISTS } from "./morning-music.mjs";
import * as memorize from "./memorize.mjs";
import * as church from "./church.mjs";
import * as special from "./special.mjs";
import { writeJSONAtomic } from "./atomic.mjs";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "devotion.json");
const chapters = (book, n) => Array.from({ length: n }, (_, i) => `${book} ${i + 1}`);
// A fresh install's devotion file: a general plan and prayer list the owner makes their own.
const SEED = () => ({
  _about: "Edit freely. readingPlan.readings is read one per day starting at readingPlan.start. memory.verses rotate perDay at a time. prayer.list rotates perDay at a time. wakeSongs rotate by day (YouTube searches or links).",
  readingPlan: { name: "The Gospel of John, then Psalms", start: store.todayISO(), readings: [...chapters("John", 21), ...chapters("Psalm", 30)] },
  memory: {
    reference: "Lamentations 3:22-24", translation: "KJV", perDay: 2,
    verses: [
      { n: 22, text: "It is of the LORD's mercies that we are not consumed, because his compassions fail not." },
      { n: 23, text: "They are new every morning: great is thy faithfulness." },
      { n: 24, text: "The LORD is my portion, saith my soul; therefore will I hope in him." },
    ],
  },
  prayer: { perDay: 3, list: ["your family", "your church family", "your work", "your studies and goals", "friends who need encouragement"] },
  wakeSongs: owner.feature("faith") ? ["This Is The Day worship song", "Goodness of God Bethel Music", "Great Are You Lord All Sons and Daughters", "Build My Life Pat Barrett"] : [],
  meditative: owner.feature("faith") ? "soft instrumental worship piano for prayer" : "soft instrumental piano music",
  worship: "morning worship songs playlist",
  greeting: owner.feature("faith") ? `Good morning, ${owner.name()}! This is the day that the Lord has made! Rejoice and be glad in it!` : `Good morning, ${owner.name()}! It's a brand new day.`,
  // The curated morning music (Spotify, or a YouTube search when a track has no link). The wake song rotates hymn, ambient, ambient…; "soft music" plays from ambient.
  playlists: MORNING_PLAYLISTS,
  // Seconds: the song plays this long before the greeting, then this long at full volume after it.
  wakeTiming: { lead: 20, hold: 60 },
});

let data = null;
export function devotion() {
  if (data) return data;
  data = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : SEED();
  let changed = !existsSync(FILE);
  // a devotion.json from before the curated playlists gets them added (the owner's own edits are kept)
  if (!data.playlists) { data.playlists = MORNING_PLAYLISTS; changed = true; }
  if (!data.wakeTiming) { data.wakeTiming = SEED().wakeTiming; changed = true; }
  if (changed) save();
  return data;
}

// The wake songs in order: a hymn, then two ambient tracks, and so on, so every song comes around before any repeats.
export function wakeRotation(d = devotion()) {
  const a = d.playlists?.ambient?.tracks ?? [], h = owner.feature("faith") ? d.playlists?.hymns?.tracks ?? [] : [];
  const out = [];
  for (let ai = 0, hi = 0; ai < a.length || hi < h.length;) {
    if (hi < h.length) out.push(h[hi++]);
    for (let k = 0; k < 2 && ai < a.length; k++) out.push(a[ai++]);
  }
  return out;
}

// A track from one of the playlists, never the one that played last.
let lastPicked = null;
export function pickTrack(list = "ambient") {
  const tracks = devotion().playlists?.[list]?.tracks ?? [];
  if (!tracks.length) return null;
  const pool = tracks.length > 1 ? tracks.filter((t) => (t.url ?? t.title) !== lastPicked) : tracks;
  const t = pool[Math.floor(Math.random() * pool.length)];
  lastPicked = t.url ?? t.title;
  return t;
}
function save() { writeJSONAtomic(FILE, data, 2); }
export function update(patch) {
  const d = devotion();
  if (patch.readingPlan) d.readingPlan = { ...d.readingPlan, ...patch.readingPlan };
  if (patch.memory) d.memory = { ...d.memory, ...patch.memory };
  if (patch.prayerAdd) d.prayer.list.push(...[].concat(patch.prayerAdd));
  if (patch.prayerRemove) { const w = String(patch.prayerRemove).toLowerCase(); d.prayer.list = d.prayer.list.filter((p) => !p.toLowerCase().includes(w)); }
  if (patch.wakeSongs) d.wakeSongs = [].concat(patch.wakeSongs);
  if (patch.prayerItem) d.prayer.list.push(patch.prayerItem);
  for (const k of ["meditative", "worship", "greeting"]) if (patch[k]) d[k] = patch[k];
  save();
  return d;
}

const dayIndex = (date, from) => { const [y, m, dd] = date.split("-").map(Number), [y2, m2, d2] = from.split("-").map(Number); return Math.round((Date.UTC(y, m - 1, dd) - Date.UTC(y2, m2 - 1, d2)) / 86400000); };
const listJoin = (a) => (a.length <= 1 ? a.join("") : a.length === 2 ? a.join(" and ") : a.slice(0, -1).join(", ") + ", and " + a[a.length - 1]);

// What today holds: the reading, the memory verses, the prayer focus, the wake song.
export function today(date = store.todayISO()) {
  const d = devotion();
  const i = Math.max(0, dayIndex(date, d.readingPlan.start ?? date));
  const reading = d.readingPlan.readings.length ? d.readingPlan.readings[i % d.readingPlan.readings.length] : null;
  const vs = d.memory?.verses ?? [], per = Math.min(3, Math.max(1, d.memory?.perDay ?? 2));
  const startV = vs.length ? (i * per) % vs.length : 0;
  const memory = vs.length ? Array.from({ length: Math.min(per, vs.length) }, (_, k) => vs[(startV + k) % vs.length]) : [];
  const pl = d.prayer?.list ?? [], pp = Math.max(1, d.prayer?.perDay ?? 3);
  // the owner's own list: entries are { title, detail, people, private } (older lists were plain names)
  const items = pl.map((p) => (typeof p === "string" ? { title: p } : p));
  const prayerItems = items.length ? Array.from({ length: Math.min(pp, items.length) }, (_, k) => items[(i * pp + k) % items.length]) : [];
  const prayer = prayerItems.map((p) => p.title);
  // three from the church prayer list each day, rotating; the owner's own friends come around twice as often
  const cl = church.prayerList(), cw = [...cl, ...cl.filter((p) => p.friend)], cp = Math.min(3, cl.length);
  const prayerChurch = [];
  for (let k = 0; cw.length && prayerChurch.length < cp && k < cw.length; k++) { const p = cw[(i * cp + k) % cw.length]; if (!prayerChurch.includes(p)) prayerChurch.push(p); }
  // the memory verses come from the memorization plan (memorize.mjs), or the devotion file's passage when there's no plan
  const mem = memorize.today(date), noPlan = mem.kind === "off";
  // the wake song: a curated Spotify track ({ title, artist, url }), or an older plain search from wakeSongs
  const rot = wakeRotation(d);
  const song = rot.length ? rot[i % rot.length] : d.wakeSongs?.length ? d.wakeSongs[i % d.wakeSongs.length] : null;
  const book = (d.memory?.reference ?? "").replace(/\s*\d+:[\d\-–,\s]+$/, "").trim();
  const chapter = /(\d+):/.exec(d.memory?.reference ?? "")?.[1];
  return { reading, memory: noPlan ? memory : mem.verses ?? memory, memoryRef: mem.ref ?? null, memoryKind: mem.kind, memoryFocus: noPlan ? null : memorize.spokenFocus(date), book: mem.book ?? book, chapter: mem.ch ?? chapter,
    prayer, prayerItems, prayerChurch, song, special: special.spokenToday(date), churchLine: church.serviceLine(date), potluck: church.potluckLine(date) };
}

// The spoken morning, in parts, so each lands before the next begins.
export function wakeScript(date = store.todayISO()) {
  const d = devotion(), t = today(date);
  // faith, church and memory verses are the owner's choice (data/owner.json "features")
  const faith = owner.feature("faith"), churchOn = owner.feature("church"), verses = owner.feature("memoryVerses");
  const segments = faith ? ["First thing is time with God, always."] : [];
  if (faith && t.reading) segments.push(`Today you are reading ${t.reading.replace(/^Psalm /, "Psalm ")}.`);
  if (verses && t.memoryFocus) {
    segments.push(t.memoryFocus);
    // new verses are read out; review and put-it-together days just name the passage (the TV shows the text)
    if (t.memoryKind === "learn" || t.memoryKind === "reinforce") segments.push(t.memory.map((v) => v.text).join(" "));
  }
  if (faith && t.prayer.length) segments.push(`Today you are praying for ${listJoin(t.prayer)}.`);
  if (faith && churchOn && t.prayerChurch?.length) segments.push(`And from the church prayer list: ${listJoin(t.prayerChurch.map((p) => p.who))}.`);
  if (churchOn && t.churchLine) segments.push(t.churchLine);
  if (churchOn && t.potluck) segments.push(t.potluck);
  if (faith) {
    segments.push("I'll queue up some worship music for when you're ready, if you want. Just let me know!");
    segments.push("Do you want me to play some softer, meditative music while you read? Or do you just want to be quiet for now?");
  } else segments.push("Do you want some soft music while you wake up? Or do you just want it quiet for now?");
  const wish = phrase(faith ? "morningWishFaith" : "morningWish");
  return { greeting: d.greeting, wish: t.special ? `${t.special} ${wish}` : wish, segments, segmentTitle: faith ? "Time with God" : "Your morning", song: t.song, timing: { lead: 20, hold: 60, ...(d.wakeTiming ?? {}) }, today: t };
}

/* ---------------- the morning conversation ---------------- */
let st = null;   // { date, stage: "devotion" | "quiet" | "ready" | "done", asks, snoozeUntil }
export function begin(date) { st = { date, stage: "devotion", asks: 0, snoozeUntil: null }; return st; }
export function current() { if (st && st.date !== store.todayISO()) st = null; return st?.stage === "done" ? null : st; }
export function setStage(s) { if (st) st.stage = s; }
export function end() { if (st) st.stage = "done"; }

// The block of quiet time with God this morning (the first faith block of the day).
export function quietBlock(date = store.todayISO()) {
  const day = store.blocksBetween(date, date);
  const first = day[0];
  return first && first.category === "faith" ? first : day.find((b) => b.category === "faith" && b.start < "10:00") ?? null;
}
export const readyQ = () => phrase("readyQ");
export const READY_Q = `Hey ${owner.name()}, are you ready to begin your day, or do you need a few more minutes?`;

const SOFT = /\b(soft|softer|meditat\w*|instrumental|calm|some music|play (some )?music|yes|yeah|sure|please)\b/i;
const QUIET = /\b(quiet|silence|no music|nothing|no thanks|nah|just (be )?quiet|no)\b/i;
const WORSHIP = /\b(worship|praise|sing|songs?)\b/i;
const READY = /\b(ready|let'?s go|let'?s do (it|this)|i'?m up|begin|start (my|the) day|go ahead|yes|yeah|yep)\b/i;
const SNOOZE = /\b(few more|more minutes?|not yet|need (a )?(minute|few|more)|give me|hold on|wait|(\d+|five|ten|fifteen) (more )?minutes?)\b/i;

// Answers during the morning. Returns { reply, media?, open, speed, snooze? } or null if it isn't a morning answer.
export async function handle(text) {
  const c = current();
  if (!c) return null;
  const t = String(text);
  const d = devotion();
  if (c.stage === "devotion" || c.stage === "quiet") {
    // "play some hymns" → the a cappella hymns
    if (/\bhymns?\b/i.test(t)) { const h = pickTrack("hymns"); if (h) { c.stage = "quiet"; return { reply: "Here's a hymn to start with.", media: { spotify: h, query: `${h.title} ${h.artist}`, kind: "video", audioOnly: true }, open: false, speed: 0.92 }; } }
    if (WORSHIP.test(t) && !/meditat|soft/i.test(t)) { c.stage = "quiet"; return { reply: "Here's some worship music. Enjoy this time.", media: { query: d.worship, kind: /playlist/i.test(d.worship) ? "playlist" : "video", audioOnly: true }, open: false, speed: 0.92 }; }
    if (c.stage === "devotion" && QUIET.test(t) && !SOFT.test(t.replace(/\bno\b/i, ""))) { c.stage = "quiet"; return { reply: "Okay. Quiet it is. Take your time.", open: false, speed: 0.92, stopMedia: true }; }
    if (c.stage === "devotion" && SOFT.test(t)) {
      c.stage = "quiet";
      const a = pickTrack("ambient");   // from the Morning Ambient list; YouTube's meditative search if Spotify can't play
      return { reply: "Okay. Something soft while you read.", media: { spotify: a, query: a ? `${a.title} ${a.artist}` : d.meditative, kind: "video", audioOnly: true }, open: false, speed: 0.92 };
    }
  }
  if (c.stage === "ready" || c.stage === "quiet") {
    const mins = /(\d+)\s*(more )?minutes?/.exec(t)?.[1] ?? (/\bten\b/i.test(t) ? 10 : /\bfifteen\b/i.test(t) ? 15 : null);
    if (SNOOZE.test(t)) {
      const m = Number(mins ?? 5);
      c.stage = "ready"; c.snoozeUntil = Date.now() + m * 60_000;
      return { reply: phrase("snooze", { m }), open: false, speed: 0.92, snooze: m };
    }
    if (c.stage === "ready" && READY.test(t)) { end(); return { reply: await rundown(), open: false, speed: 0.95, rundown: true }; }
  }
  return null;
}

/* ---------------- the rundown ---------------- */
const toMin = (x) => { const [h, m] = x.split(":").map(Number); return h * 60 + m; };
const ROUTINE = /^(shower|breakfast|lunch|clean up|clean up & dinner|dinner|home & shower|drive home|head to|dinner & |dinner \(|morning prayer|nightly|morning reading|morning routine)/i;

export function rundownFacts(date = store.todayISO()) {
  const day = store.blocksBetween(date, date);
  const qb = quietBlock(date);
  const notable = day.filter((b) => b.id !== qb?.id && (!ROUTINE.test(b.title) || ["ai", "plan", "manual"].includes(b.source)));
  const rems = reminders.forDay(date).filter((r) => !r.fired);
  const tasks = store.tasks(false).filter((t) => t.dueDate && t.dueDate <= date);
  const p = learning.progress();
  return { date, notable, rems, tasks, examDays: p.exam.daysLeft, examName: p.exam.spoken || p.exam.name || "the exam" };
}
function templateRundown(f) {
  const s = (b) => { const d = (b.description || "").replace(/^.*→\s*/, "").split(/(?<=\.)\s/)[0].replace(/\s*\(\d+ min\)/, "").replace(/\.$/, ""); return b.category === "study" && d ? `${b.title.replace(/ — session \d/, "")}, ${d.replace(/:\s*/, ", ")}` : b.title.replace(/&/g, "and"); };
  const part = (from, to) => f.notable.filter((b) => toMin(b.start) >= from && toMin(b.start) < to);
  const say = reminders.say;
  const lines = [phrase("rundownOpen")];
  const morning = part(0, 12 * 60), afternoon = part(12 * 60, 17 * 60), evening = part(17 * 60, 24 * 60);
  if (morning.length) lines.push(`This morning: ${morning.map((b) => `${s(b)} at ${say(b.start)}`).join(", then ")}.`);
  if (afternoon.length) lines.push(`This afternoon: ${afternoon.map((b) => `${s(b)} at ${say(b.start)}`).join(", then ")}.`);
  if (evening.length) lines.push(`This evening: ${evening.map((b) => `${s(b)} at ${say(b.start)}`).join(", then ")}.`);
  if (f.rems.length) lines.push(`Reminders: ${f.rems.map((r) => (r.time ? `${r.text}, I'll remind you at ${say(r.time)}` : r.text)).join(". ")}.`);
  if (f.tasks.length) lines.push(`On your list: ${f.tasks.map((t) => t.title).join(", ")}.`);
  if (f.examDays > 0) lines.push(`${f.examDays} days until ${f.examName}.`);
  lines.push(phrase("rundownClose"));
  return lines.join(" ").replace(/\.{2,}/g, ".");
}
export async function rundown(date = store.todayISO()) {
  const f = rundownFacts(date);
  // a clash between calendars today (Dayspring, Google, Outlook…)
  const clash = await (await import("./conflicts.mjs")).briefingLine(date).catch(() => "");
  // XP: a gentle badge or learning line when one is close (lib/xp)
  const xpLine = await import("./xp/index.mjs").then((m) => m.morningLine()).catch(() => "");
  const fallback = templateRundown(f) + (clash ? " " + clash : "") + (xpLine ? " " + xpLine : "");
  if (!llm.ready()) return fallback;
  try {
    const facts = [
      ...f.notable.map((b) => `${b.start}-${b.end} ${b.title} (${b.category})${b.description ? ` — ${b.description}` : ""}`),
      f.rems.length ? "Reminders for today: " + f.rems.map((r) => `${r.time ?? "any time"} ${r.text}`).join("; ") : "",
      f.tasks.length ? "Tasks due: " + f.tasks.map((t) => t.title).join("; ") : "",
      f.examDays > 0 ? `Days until ${f.examName}: ${f.examDays}` : "",
      clash ? `Calendar clash: ${clash}` : "",
      xpLine ? `Encouragement to include word for word: ${xpLine}` : "",
    ].filter(Boolean).join("\n");
    const n = owner.name(), their = owner.their();
    const text = await llm.complete({ maxTokens: 400, timeoutMs: 20_000, prompt: facts,
      system: `You are ${owner.assistant()}, ${n}'s home assistant, speaking out loud to start ${their} day. Give a warm, clear rundown of today in 5 to 8 short spoken sentences: morning, afternoon, evening, with times said naturally. For study blocks say exactly what ${n} will cover. Then every reminder and task. End with a short, fresh encouragement in ${their} style. No lists, no markdown. Never invent anything. Style right now: ${voice.styleNote()}\nAbout ${n}:\n${owner.get().about ? owner.get().about + "\n" : ""}${profile.note()}` });
    return text.trim() || fallback;
  } catch { return fallback; }
}

// A new entry on the owner's own prayer list ("add Mike to my prayer list for his surgery"): { title, detail, people }
export function addPrayer(item) {
  const d = devotion();
  if ((d.prayer.list ?? []).some((p) => (typeof p === "string" ? p : p.title).toLowerCase() === item.title.toLowerCase())) return null;
  return update({ prayerItem: item });
}
