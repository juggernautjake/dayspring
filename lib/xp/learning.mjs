// Learning XP from Lantern: every verified lesson, exercise, practice session, unit check, project milestone, unit and
// course becomes XP in Dayspring's ledger (the one source of truth), exactly once. The contract is docs/dev/lantern-xp.md.
//
//   • Lantern only reports VERIFIED work. A spoken "I finished lesson 3" is checked with Lantern first (POST
//     /api/local/report); only verified:true earns anything.
//   • Every earning has a natural key: "lantern:<course>:<kind>:<ref>" (a lesson counts once, ever) or
//     "lantern:<course>:practice:<sessionId>". Live events, the backfill, redelivery and another computer's progress
//     arriving through Lantern's hub all land on the same key, so nothing is ever counted twice.
//   • Two paths: live (Lantern's eco events and its /api/local/events stream) and a backfill every 10 minutes from
//     /api/local/courses/<id>, so nothing is missed while Dayspring was off. A live event is only a hint: it counts
//     once Lantern's own course detail shows that item done (verify-first); if Lantern can't confirm it within 2
//     seconds, the course is queued for a backfill, which awards it when Lantern does show it.
//   • The key is always worked out here from (course, kind, ref | sessionId); an event whose key doesn't match is refused.
//   • Dayspring's economy: fixed rates per kind (Lantern's authored numbers are kept for display), a learning cap of 120
//     a day (separate from the 80 for check-ins), and the one spending limit of 80 a day across everything, so a secret
//     character still takes at least a week. Anything dated more than 2 days ago, or in the future, is "catch-up"
//     (on every path): it counts for the lifetime total and badges only (nothing to spend, so spendable XP only comes
//     from days with real activity), never pushes a past day over its learning cap, and at most 200 catch-up XP are
//     recorded per calendar day (the rest waits for tomorrow's backfill; kept in the ledger, so a restart can't reset it).
import * as R from "./rules.mjs";

export const RATES = { lesson: 12, exercise: 5, practice: 8, check: 40, milestone: 25, unit: 60, course: 300 };
export const LEARNING_CAP = 120;              // learning XP a day (the lifetime total, levels and badges)
export const PRACTICE_MIN = 10;               // minutes for a practice session to count
export const PRACTICE_PER_DAY = 3;            // practice sessions a day, per course
export const CHECK_PASS = 0.7;                // a unit check counts from 70%
export const CATCHUP_DAYS = 2;                // completions older than this (or dated in the future) are catch-up
export const CATCHUP_PER_DAY = 200;           // catch-up XP recorded per calendar day (lifetime and badges; never spendable)
export const VERIFY_MS = 2000;                // how long a live event waits for Lantern to confirm it
export const STREAM_MAX_MS = 10 * 60_000;     // the longest wait between tries of Lantern's event stream
export const RECONCILE_MS = 10 * 60_000;
const DONE = new Set(["done", "complete", "completed", "passed", "finished", "mastered"]);
const LABEL = { lesson: "lesson", exercise: "exercise", practice: "practice", check: "unit check", milestone: "project milestone", unit: "unit", course: "course" };

let ctx = null;             // { ledger(), deps(), now(), emit(), after(res) } from index.mjs
let client = null;          // { call(path, opts) → {ok, status, data}, port() → number|null } — Lantern's local API
const detailCache = new Map();   // course → { at, data } (Lantern's course detail, for the UI, voice and the morning line)
let statusCache = null;
export function init(c) { ctx = c; }
export function setClient(c) { client = c; detailCache.clear(); statusCache = null; }
export const _reset = () => { detailCache.clear(); statusCache = null; lastRun = null; running = false; again = undefined; queued.clear(); streamGone = false; streamDelay = STREAM_MIN_MS; };

const dayOf = (ms) => new Date(ms).toLocaleDateString("en-CA");
const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00") - Date.parse(a + "T12:00:00")) / 86400_000);
export const keyOf = ({ course, kind, ref, sessionId = null }) => kind === "practice" ? `lantern:${course}:practice:${sessionId ?? ref}` : `lantern:${course}:${kind}:${ref}`;
const shortTitle = (t) => String(t ?? "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+\d{3}$/, "").trim();
const L = () => ctx.ledger();
const normScore = (s) => (s == null || s === "" ? null : Number(s) > 1 ? Number(s) / 100 : Number(s));

// ---- earning one thing ---------------------------------------------------------------------------------------------
// ev = { key?, kind, course, courseTitle?, ref, title?, authoredXp?, score?, minutes?, at?, verified, sessionId? }
// via: "live" | "backfill" | "claim" (live and claim only after Lantern confirmed it). firstImport: a course's first
// import (an unknown date is then catch-up).
const checkKey = (ev) => {
  const kind = String(ev.kind ?? ""), course = String(ev.course ?? "");
  if (!RATES[kind] || !course || (!ev.ref && !(kind === "practice" && ev.sessionId))) return { ok: false, reason: "unknown", message: "That isn't something Lantern reports." };
  const key = keyOf({ course, kind, ref: ev.ref, sessionId: ev.sessionId });
  if (ev.key != null && ev.key !== key) return { ok: false, reason: "bad-key", key, message: "That event's key doesn't match what it says was finished." };
  return { ok: true, key, kind, course };
};
export function earn(ev, { via = "live", firstImport = false } = {}) {
  const k = checkKey(ev); if (!k.ok) return k;
  const { key, kind, course } = k;
  if (ctx.tracking && !ctx.tracking()) return { ok: false, reason: "off", key, message: "XP is turned off in Settings." };
  if (ev.verified !== true) return { ok: false, reason: "unverified", message: "Only work Lantern has verified counts." };
  const courseTitle = ev.courseTitle ?? statusCache?.data?.courses?.find((c) => c.id === course)?.title ?? detailCache.get(course)?.data?.title ?? null;
  if (L().keys().has(key)) return { ok: false, reason: "duplicate", key, message: "Already counted." };
  const clk = ctx.clock?.() ?? { ok: true };
  if (!clk.ok) return { ok: false, reason: "clock", key, message: clk.message };
  const now = ctx.now(), today = dayOf(now);
  const atMs = ev.at ? (typeof ev.at === "number" ? ev.at : Date.parse(ev.at)) : NaN;
  const known = Number.isFinite(atMs), future = known && atMs > now + 60_000;
  const when = known && !future ? atMs : now, day = dayOf(when);
  // catch-up on every path: dated more than CATCHUP_DAYS ago, dated in the future, or undated on a first import
  const catchup = future || (known && daysBetween(day, today) > CATCHUP_DAYS) || (!known && firstImport);
  // what it's worth
  let amount = RATES[kind];
  if (kind === "practice") {
    if (!(Number(ev.minutes) >= PRACTICE_MIN)) return { ok: false, reason: "short", key, message: `Practice counts from ${PRACTICE_MIN} minutes.` };
    const today3 = L().awards().filter((e) => e.source === "lantern" && e.kind === "practice" && e.course === course && e.day === day).length;
    if (today3 >= PRACTICE_PER_DAY) return { ok: false, reason: "practice-cap", key, message: `That's ${PRACTICE_PER_DAY} practice sessions today for this course. Brilliant effort!` };
  }
  if (kind === "check") {
    const s = normScore(ev.score);
    if (s != null && s < CHECK_PASS) return { ok: false, reason: "check-low", key, message: `You got ${Math.round(s * 100)}% on the check. So close! It counts from ${Math.round(CHECK_PASS * 100)}%, and you can take it again whenever you're ready.` };
    if (s != null) amount = Math.round(RATES.check * Math.min(1, s));
  }
  // the learning cap for that day (catch-up with no real date isn't held to today's cap: it's old work)
  const learningRoom = catchup && (!known || future) ? amount : Math.max(0, LEARNING_CAP - L().learningDay(day));
  const counted = Math.min(amount, learningRoom);
  if (catchup && counted > 0) {
    // the per-day catch-up budget (what's over it isn't recorded; tomorrow's backfill finds it again)
    const used = L().awards().filter((e) => e.catchup && e.recordedDay === today).reduce((s, e) => s + e.amount, 0);
    if (used + counted > CATCHUP_PER_DAY) return { ok: false, reason: "catchup-budget", key, message: "That's today's catch-up. The rest counts tomorrow." };
  }
  // the spending limit for that day; catch-up adds nothing to spend
  const spendable = catchup ? 0 : Math.min(counted, Math.max(0, R.DAILY_CAP - L().spendDay(day)));
  const e = L().append({
    at: new Date(when).toISOString(), day, type: "award", amount: counted, ...(spendable < counted ? { spendable } : {}), category: "study", source: "lantern",
    key, kind, course, courseTitle: courseTitle ? String(courseTitle).slice(0, 80) : null, ref: ev.ref ?? ev.sessionId ?? null, title: String(ev.title ?? "").slice(0, 120),
    ...(ev.authoredXp != null ? { authoredXp: Number(ev.authoredXp) } : {}), ...(normScore(ev.score) != null ? { score: normScore(ev.score) } : {}), ...(ev.minutes ? { minutes: Number(ev.minutes), hours: Number(ev.minutes) / 60 } : {}),
    ...(catchup ? { catchup: true, recordedDay: today } : {}), ...(clk.jump ? { clockJump: true } : {}), via, evidence: "", fp: null,
  });
  const res = { ok: true, key, amount: counted, spendable, capped: counted < amount, catchup, entry: e.id, kind, course, title: e.title };
  ctx.after?.(res, e);
  return res;
}

// ---- Lantern's local API --------------------------------------------------------------------------------------------
async function call(path, opts) { if (!client) return { ok: false, status: 0, error: "Lantern isn't connected." }; try { return await client.call(path, opts); } catch (e) { return { ok: false, status: 0, error: e.message }; } }
export async function status({ fresh = false, timeoutMs = 3000 } = {}) {
  if (!fresh && statusCache && ctx.now() - statusCache.at < 15_000) return statusCache.data;
  const r = await call("/api/local/status", { timeoutMs });
  statusCache = { at: ctx.now(), data: r.ok ? r.data : null };
  return statusCache.data;
}
export async function detail(course, { fresh = false, timeoutMs = 4000, strict = false } = {}) {
  const c = detailCache.get(course);
  if (!fresh && c && ctx.now() - c.at < 60_000) return c.data;
  const r = await call(`/api/local/courses/${encodeURIComponent(course)}`, { timeoutMs });
  if (r.ok && r.data) detailCache.set(course, { at: ctx.now(), data: r.data });
  return r.ok ? r.data : strict ? null : c?.data ?? null;       // strict: only a fresh answer from Lantern (verify-first)
}
const isDone = (x) => DONE.has(String(x?.status ?? "").toLowerCase());
const doneAt = (x) => x?.completedAt ?? x?.doneAt ?? x?.passedAt ?? x?.finishedAt ?? x?.at ?? null;
const authored = (x) => x?.authoredXp ?? x?.xp_reward ?? x?.xp ?? null;
// every completed thing in a course detail, as earnings
export function completions(d) {
  const out = [], course = d.id, courseTitle = d.title;
  for (const u of d.units ?? []) {
    for (const l of u.lessons ?? []) {
      if (isDone(l)) out.push({ kind: "lesson", course, courseTitle, ref: l.id, title: l.title, at: doneAt(l), authoredXp: authored(l), verified: true });
      for (const x of l.exercises ?? []) if (isDone(x)) out.push({ kind: "exercise", course, courseTitle, ref: x.id, title: x.title, at: doneAt(x), authoredXp: authored(x), score: x.score ?? x.best ?? null, verified: true });
    }
    for (const p of u.projects ?? []) for (const m of p.milestones ?? []) if (isDone(m)) out.push({ kind: "milestone", course, courseTitle, ref: m.id, title: `${p.title}: ${m.title}`, at: doneAt(m), authoredXp: authored(m), verified: true });
    if (u.check && isDone(u.check)) out.push({ kind: "check", course, courseTitle, ref: u.check.id, title: u.check.title, at: doneAt(u.check), score: u.check.score ?? u.check.best ?? null, authoredXp: authored(u.check), verified: true });
    if ((u.count ?? 0) > 0 && (u.done ?? 0) >= u.count) out.push({ kind: "unit", course, courseTitle, ref: u.id, title: u.title, at: doneAt(u), authoredXp: authored(u), verified: true });
  }
  // practice sessions Lantern verified: [{ id, minutes, completedAt }] (the key is the session id)
  for (const p of Array.isArray(d.practice) ? d.practice : []) if (p?.id && isDone({ status: p.status ?? "done" })) out.push({ kind: "practice", course, courseTitle, ref: p.id, sessionId: p.id, title: p.title ?? "Practice", minutes: Number(p.minutes) || 0, at: doneAt(p), verified: true });
  if (d.finished === true || (d.percent ?? 0) >= 100) out.push({ kind: "course", course, courseTitle, ref: course, title: courseTitle, at: d.finishedAt ?? null, authoredXp: authored(d), verified: true });
  return out;
}

// ---- the backfill ----------------------------------------------------------------------------------------------------
// One run at a time. A request while one runs is queued (one follow-up run, for that course or, if several were
// asked for, all of them), so a live event's "check this course" is never dropped.
let lastRun = null, running = false, again;       // again: undefined = nothing queued · null = all courses · "id" = one
export async function reconcile({ course = null } = {}) {
  if (running) { again = again === undefined ? course : again === course ? course : null; return { skipped: true, queued: true }; }
  running = true;
  try {
    const st = await status({ fresh: true });
    if (!st) return { ok: false, reason: "offline" };
    const courses = (st.courses ?? []).filter((c) => c.installed !== false && (!course || c.id === course));
    const results = [];
    for (const c of courses) {
      const d = await detail(c.id, { fresh: true });
      if (!d) continue;
      const firstImport = ![...L().keys()].some((k) => k.startsWith(`lantern:${c.id}:`));
      const items = completions(d).sort((a, b) => (Date.parse(a.at ?? "") || 0) - (Date.parse(b.at ?? "") || 0));
      for (const it of items) { const r = earn(it, { via: "backfill", firstImport }); if (r.ok) results.push(r); }
    }
    lastRun = { at: ctx.now(), awarded: results.length, xp: results.reduce((s, r) => s + r.amount, 0), catchup: results.filter((r) => r.catchup).length };
    if (results.length) ctx.emit?.("learning", { kind: "backfill", ...lastRun });
    for (const k of [...queued.keys()]) if (L().keys().has(k)) queued.delete(k);
    return { ok: true, ...lastRun, results };
  } finally {
    running = false;
    if (again !== undefined) { const c = again; again = undefined; const t = setTimeout(() => reconcile(c ? { course: c } : {}).catch(() => {}), 0); t.unref?.(); }
  }
}
export const lastReconcile = () => lastRun;

// ---- live: eco events and Lantern's own event stream -------------------------------------------------------------------
// eco: { type, source, data } — only from Lantern (source "lantern"; the eco route has already checked the token).
// "xp.earned", and Lantern's older "lesson.completed"/"unit.completed", are checked with Lantern first (liveEarn).
// Returns a Promise of the result (or null for anything else).
export function onEco(ev) {
  const d = ev?.data ?? {};
  if (!["xp.earned", "lesson.completed", "unit.completed"].includes(ev?.type)) return null;
  if (ev.source !== "lantern") return Promise.resolve({ ok: false, reason: "not-lantern", message: "Only Lantern reports learning." });
  if (ev.type === "xp.earned") return liveEarn({ ...d, verified: d.verified === true });
  if (!d.course || !d.ref) return Promise.resolve(null);
  return liveEarn({ kind: ev.type === "lesson.completed" ? "lesson" : "unit", course: d.course, courseTitle: d.courseTitle, ref: d.ref, title: d.title ?? "", at: ev.at ?? d.at ?? null, verified: true });
}
// verify-first: a live event counts only when Lantern's course detail (fetched fresh, 2 s at most) shows that item
// done. Lantern's record wins (its date, score, minutes); the event only fills gaps. Not confirmed → queued for the backfill.
const queued = new Map();                 // key → { course, at } waiting for Lantern to confirm
export const queuedCount = () => queued.size;
export async function liveEarn(item) {
  const k = checkKey(item); if (!k.ok) return k;
  if (item.verified !== true) return { ok: false, reason: "unverified", key: k.key, message: "Only work Lantern has verified counts." };
  if (L().keys().has(k.key)) return { ok: false, reason: "duplicate", key: k.key, message: "Already counted." };
  const d = await detail(k.course, { fresh: true, timeoutMs: VERIFY_MS, strict: true }).catch(() => null);
  const found = d ? completions(d).find((x) => keyOf(x) === k.key) : null;
  if (!found) {
    if (queued.size < 500) queued.set(k.key, { course: k.course, at: ctx.now() });
    const t = setTimeout(() => reconcile({ course: k.course }).catch(() => {}), d ? 60_000 : 30_000); t.unref?.();
    return { ok: false, reason: "queued", key: k.key, message: "Waiting for Lantern to confirm it." };
  }
  queued.delete(k.key);
  const lantern = Object.fromEntries(Object.entries(found).filter(([, v]) => v != null && v !== ""));
  return earn({ ...item, ...lantern, key: undefined, verified: true }, { via: "live" });
}
// Lantern's /api/local/events (SSE): progress, lesson-completed, course-updated, sync → reconcile that course soon.
// A failed or refused connection waits longer each time (15 s, 30 s, 1 min … up to 10 min); a 404 means an older
// Lantern without the stream, so it stops trying and the 10-minute backfill does the work.
const STREAM_MIN_MS = 15_000;
let streamAbort = null, streamTimer = null, soon = new Map(), streamDelay = STREAM_MIN_MS, streamGone = false;
export const streamState = () => ({ gone: streamGone, nextDelayMs: streamDelay });
export function startStream({ port = () => client?.port?.() ?? null, fetch: f = globalThis.fetch } = {}) {
  stopStream(); streamGone = false; streamDelay = STREAM_MIN_MS;
  const later = () => { streamTimer = setTimeout(connect, streamDelay); streamTimer.unref?.(); streamDelay = Math.min(streamDelay * 2, STREAM_MAX_MS); };
  const connect = async () => {
    const p = await port();
    if (!p) { streamTimer = setTimeout(connect, 30_000); streamTimer.unref?.(); return; }
    const ac = new AbortController(); streamAbort = ac;
    let openedAt = 0;
    try {
      const r = await f(`http://127.0.0.1:${p}/api/local/events`, { headers: { accept: "text/event-stream" }, signal: ac.signal });
      if (r.status === 404) { streamGone = true; return; }
      if (!r.ok || !r.body) throw new Error(`stream ${r.status}`);
      openedAt = Date.now();
      const reader = r.body.getReader(), dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf("\n\n")) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); streamEvent(chunk); }
      }
    } catch { /* Lantern stopped or refused: try again, later each time */ }
    if (openedAt && Date.now() - openedAt > 60_000) streamDelay = STREAM_MIN_MS;      // it worked for a while: start over
    if (!ac.signal.aborted && !streamGone) later();
  };
  connect();
}
export function stopStream() { streamAbort?.abort(); streamAbort = null; clearTimeout(streamTimer); }
export function streamEvent(chunk) {
  let type = "message", data = "";
  for (const line of chunk.split("\n")) { if (line.startsWith("event:")) type = line.slice(6).trim(); else if (line.startsWith("data:")) data += line.slice(5).trim(); }
  let d = {}; try { d = data ? JSON.parse(data) : {}; } catch { /* not JSON */ }
  if (type === "xp.earned" || type === "xp") return liveEarn({ ...d, verified: d.verified === true });
  if (["progress", "lesson-completed", "course-updated", "sync", "milestone"].includes(type)) {
    const course = d.course ?? d.courseId ?? null;
    clearTimeout(soon.get(course)); const t = setTimeout(() => { soon.delete(course); reconcile(course ? { course } : {}).catch(() => {}); }, 2000); t.unref?.(); soon.set(course, t);
    return { scheduled: course ?? "all" };
  }
  return null;
}
let timer = null;
export function startSync() {
  if (timer) return;
  setTimeout(() => reconcile().catch(() => {}), 20_000).unref?.();
  timer = setInterval(() => reconcile().catch(() => {}), RECONCILE_MS); timer.unref?.();
  startStream();
}

// ---- a spoken claim: "I finished lesson 3" → Lantern checks first -------------------------------------------------------
const CLAIM = /\b(?:i\s+)?(?:just\s+)?(?:finished|completed|did|done with|passed)\s+(?:the\s+|my\s+)?(lesson|exercise|unit|module|check)\b(.*)$/;
export function isClaim(t) { return CLAIM.test(t); }
// Lantern is asked three times at most (status, the course, the report), 1 s each, so a reply never waits over 3 s
export async function claim(t) {
  const m = CLAIM.exec(t); if (!m) return null;
  const st = await status({ timeoutMs: 1000 });
  if (!st) return { reply: "I can't reach Lantern right now, so I can't check that. Once Lantern is open, finished lessons count on their own." };
  const rest = m[2].replace(/^\s*(number|no\.?)\s*/, "").trim();
  const courses = (st.courses ?? []).filter((c) => c.installed !== false);
  const named = courses.find((c) => rest.includes(c.id) || rest.includes(shortTitle(c.title).toLowerCase()) || rest.includes(c.title.toLowerCase().split(" ")[0]));
  const course = named ?? courses.find((c) => c.current) ?? courses.find((c) => (c.percent ?? 0) > 0 && (c.percent ?? 0) < 100) ?? courses[0];
  if (!course) return { reply: "Lantern doesn't have a course installed yet." };
  const d = await detail(course.id, { timeoutMs: 1000 });
  const lessons = (d?.units ?? []).flatMap((u) => u.lessons ?? []);
  const num = /\b(\d{1,3})\b/.exec(rest)?.[1];
  const q = rest.replace(new RegExp(`\\b(in|of|from)\\s+(${course.id}|${shortTitle(course.title).toLowerCase()})\\b.*$`), "").replace(/\b\d{1,3}\b/, "").trim();
  let lesson = null;
  if (q.length > 2) lesson = lessons.find((l) => l.title.toLowerCase().includes(q)) ?? null;
  if (!lesson && num) lesson = lessons[Number(num) - 1] ?? null;
  if (!lesson) lesson = course.current ?? (course.next?.kind === "lesson" ? lessons.find((l) => l.id === course.next.id) : null) ?? null;
  if (!lesson) return { reply: `Which lesson in ${shortTitle(course.title)}? Say its name or number.` };
  const r = await call("/api/local/report", { method: "POST", body: { course: course.id, lesson: lesson.id }, timeoutMs: 1000 });
  if (!r.ok) return { reply: "I couldn't check that with Lantern just now. Finished lessons count on their own once Lantern syncs." };
  const v = r.data ?? {};
  if (v.verified !== true) return { reply: `Lantern doesn't show “${lesson.title}” as finished yet${v.message ? ` (${String(v.message).replace(/\.$/, "")})` : ""}. Finish it in Lantern and it will count automatically. You've got this!` };
  detailCache.delete(course.id);
  const res = earn({ kind: "lesson", course: course.id, courseTitle: course.title, ref: lesson.id, title: lesson.title, verified: true, at: ctx.now() }, { via: "claim" });
  if (!res.ok) return { reply: res.reason === "duplicate" ? `“${lesson.title}” is finished, and it already counted. Nice work!` : res.message };
  return { reply: `Lantern confirms it: “${lesson.title}” is done. +${res.amount} XP.${v.next?.title ? ` Next up: ${v.next.title}.` : ""}`, xp: res };
}

// ---- what the UI, voice and Lantern's hub see ---------------------------------------------------------------------------
export function perCourse() {
  const out = {};
  for (const e of L().awards().filter((x) => x.source === "lantern")) {
    const c = (out[e.course] ??= { course: e.course, courseTitle: e.courseTitle ?? e.course, xpAwarded: 0, authoredXp: 0, itemsCompleted: 0, kinds: {} });
    c.xpAwarded += e.amount; c.authoredXp += Number(e.authoredXp ?? 0); c.itemsCompleted++; c.kinds[e.kind] = (c.kinds[e.kind] ?? 0) + 1;
    if (e.courseTitle) c.courseTitle = e.courseTitle;
  }
  for (const c of Object.values(out)) if (c.courseTitle === c.course) c.courseTitle = titleOf(c.course);
  return out;
}
export function recent(limit = 20) {
  return L().awards().filter((x) => x.source === "lantern").sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit)
    .map((e) => ({ at: e.at, day: e.day, kind: e.kind, course: e.course, courseTitle: e.courseTitle, title: e.title, amount: e.amount, spendable: e.spendable ?? e.amount, authoredXp: e.authoredXp ?? null, catchup: Boolean(e.catchup), line: line(e) }));
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function line(e) {
  const what = { lesson: `Finished lesson “${e.title}”`, exercise: `Passed exercise “${e.title}”`, practice: `Practised ${e.minutes ? `${Math.round(e.minutes)} minutes` : ""}`.trim(), check: `Passed ${e.title}${e.score != null ? ` (${Math.round(e.score * 100)}%)` : ""}`, milestone: `Reached “${e.title}”`, unit: `Finished ${e.title}`, course: `Finished the course!` }[e.kind] ?? "Learning";
  const d = new Date(e.at);
  return `${what} +${e.amount} XP, ${MON[d.getMonth()]} ${d.getDate()}`;
}
// a course's title: from any entry that has it, or Lantern's status (older events may not carry it)
const titleOf = (course) => L().awards().find((e) => e.course === course && e.courseTitle)?.courseTitle ?? statusCache?.data?.courses?.find((c) => c.id === course)?.title ?? course;
export function week() {
  const now = new Date(ctx.now()), start = new Date(now); start.setDate(now.getDate() - ((now.getDay() + 6) % 7)); start.setHours(0, 0, 0, 0);
  const from = start.toLocaleDateString("en-CA");
  const es = L().awards().filter((x) => x.source === "lantern" && x.day >= from);
  const count = (k) => es.filter((x) => x.kind === k).length;
  return { from, lessons: count("lesson"), exercises: count("exercise"), checks: count("check"), units: count("unit"), practiceMinutes: Math.round(es.filter((x) => x.kind === "practice").reduce((s, x) => s + (x.minutes ?? 0), 0)),
    xp: es.reduce((s, x) => s + x.amount, 0), courses: [...new Set(es.map((x) => titleOf(x.course)))] };
}
// "You're 2 lessons from finishing Unit 3 of Python" (from the last course detail seen), or ""
export function nearUnitLine() {
  for (const [, { data: d }] of detailCache) {
    for (const u of d?.units ?? []) {
      const left = (u.count ?? 0) - (u.done ?? 0);
      if ((u.done ?? 0) > 0 && left > 0 && left <= 2) return `You're ${left === 1 ? "1 step" : `${left} steps`} from finishing Unit ${u.n ?? ""} of ${shortTitle(d.title)}.`.replace("Unit  of", "a unit of");
    }
  }
  return "";
}
export async function view() {
  const st = await status();
  const pc = perCourse();
  const courses = (st?.courses ?? []).filter((c) => c.installed !== false).map((c) => {
    const d = detailCache.get(c.id)?.data;
    const units = d?.units ?? [];
    return { id: c.id, title: c.title, percent: c.percent ?? 0, measure: c.measure ?? null, next: c.next ?? null, minutesLeft: c.minutesLeft ?? null,
      units: { done: units.filter((u) => (u.count ?? 0) > 0 && (u.done ?? 0) >= u.count).length, total: units.length }, xp: pc[c.id]?.xpAwarded ?? 0, authoredXp: pc[c.id]?.authoredXp ?? 0, items: pc[c.id]?.itemsCompleted ?? 0 };
  });
  for (const c of courses) if (!detailCache.has(c.id)) detail(c.id).catch(() => {});
  return { connected: Boolean(st), courses, perCourse: pc, recent: recent(20), week: week(), rates: RATES, caps: { learning: LEARNING_CAP, spending: R.DAILY_CAP, practicePerDay: PRACTICE_PER_DAY, practiceMinutes: PRACTICE_MIN, checkPass: CHECK_PASS, catchupPerDay: CATCHUP_PER_DAY }, lastReconcile: lastRun, waiting: queued.size, stream: streamState() };
}
// voice: "how much XP have I earned from Python" · "how far am I in Spanish" · "what did I finish this week"
// (the words are checked first; Lantern is only asked when they match, and for 1 s at most)
const VOICE = [/\bhow much (xp|experience)\b.*\b(from|in|for|on)\b/, /\bxp (from|in)\b/, /\bhow far (am i|along)\b|\bmy progress in\b/, /\bwhat did i (finish|complete|do|learn|study)\b.*\bthis week\b|\bthis week'?s (learning|study)\b/];
export async function voice(t) {
  if (!VOICE.some((re) => re.test(t))) return null;
  const pc = perCourse(), st = await status({ timeoutMs: 1000 }).catch(() => null);
  const all = [...new Map([...(st?.courses ?? []).map((c) => [c.id, c.title]), ...Object.values(pc).map((c) => [c.course, c.courseTitle])])];
  // the course the words name best: its whole title, then its id, then the most of its words ("Spanish Basics" isn't "Python Basics")
  const find = (s) => all.map(([id, title]) => {
    const t = shortTitle(title).toLowerCase(), words = t.split(/\s+/).filter((w) => w.length > 3 && s.includes(w)).length;
    return { c: [id, title], score: s.includes(t) ? 100 : new RegExp(`\\b${id}\\b`).test(s) ? 50 : words };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score)[0]?.c ?? null;
  if (/\bhow much (xp|experience)\b.*\b(from|in|for|on)\b/.test(t) || /\bxp (from|in)\b/.test(t)) {
    const c = find(t); if (!c) return null;
    const x = pc[c[0]];
    return { reply: x ? `You've earned ${x.xpAwarded} XP from ${shortTitle(c[1])}: ${x.itemsCompleted} thing${x.itemsCompleted === 1 ? "" : "s"} finished${x.authoredXp ? ` (${x.authoredXp} of Lantern's course points)` : ""}.` : `No XP from ${shortTitle(c[1])} yet. Finish a lesson in Lantern and it counts here automatically.` };
  }
  if (/\bhow far (am i|along)\b|\bmy progress in\b/.test(t)) {
    const c = find(t); const sc = c ? (st?.courses ?? []).find((x) => x.id === c[0]) : null;
    if (!sc) return null;
    return { reply: `You're ${Math.round(sc.percent ?? 0)}% through ${shortTitle(sc.title)}${sc.measure ? ` (${sc.measure})` : ""}${sc.next?.title ? `. Next: ${sc.next.title}` : ""}. You've earned ${pc[sc.id]?.xpAwarded ?? 0} XP from it.` };
  }
  if (/\bwhat did i (finish|complete|do|learn|study)\b.*\bthis week\b|\bthis week'?s (learning|study)\b/.test(t)) {
    const w = week();
    if (!w.lessons && !w.exercises && !w.practiceMinutes && !w.checks) return { reply: "Nothing from Lantern yet this week. A short lesson today would get it going!" };
    const parts = [w.lessons && `${w.lessons} lesson${w.lessons === 1 ? "" : "s"}`, w.exercises && `${w.exercises} exercise${w.exercises === 1 ? "" : "s"}`, w.checks && `${w.checks} unit check${w.checks === 1 ? "" : "s"}`].filter(Boolean);
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
    return { reply: `This week you finished ${list || "some practice"}${w.courses.length ? ` in ${w.courses.map(shortTitle).join(" and ")}` : ""}${w.practiceMinutes ? `, practised ${w.practiceMinutes} minutes` : ""}, and earned ${w.xp} learning XP.` };
  }
  return null;
}
// Lantern's hub view of Dayspring's XP (GET /api/xp/summary and the xp.summary event)
export function summary({ balance, level, streak, badges }) {
  const pc = perCourse();
  return { balance, level: level.level, title: level.title, streak: streak.days, badges,
    perCourse: Object.fromEntries(Object.entries(pc).map(([k, v]) => [k, { xpAwarded: v.xpAwarded, authoredXp: v.authoredXp, itemsCompleted: v.itemsCompleted }])) };
}
void LABEL;
