// node --test lib/xp/learning.test.mjs   (a fake Lantern, a fake clock, a throwaway data folder)
// Learning XP from Lantern: live and backfill awards, idempotency, verify-first claims, the caps, catch-up, badges,
// the one-week-per-character guarantee, and the voice answers.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as xp from "./index.mjs";
import * as R from "./rules.mjs";
import * as B from "./badges.mjs";

let clock, dir, lantern;
let bid = 0; const blocks = []; const blk = () => { const id = "b" + (++bid); blocks.push({ id, title: "", end: "00:00" }); return { source: "block", blockId: id }; };
const at = (s) => { clock = Date.parse(s); };
const nextDay = (hh = 9) => { const d = new Date(clock); d.setDate(d.getDate() + 1); d.setHours(hh, 0, 0, 0); clock = d.getTime(); };
const iso = (daysAgo, hh = 10) => { const d = new Date(clock); d.setDate(d.getDate() - daysAgo); d.setHours(hh, 0, 0, 0); return d.toISOString(); };
// a fake Lantern: courses with lessons/exercises/checks, and the report endpoint
function fakeLantern() {
  const course = (id, title, units) => ({ id, title, percent: 0, units });
  const lesson = (id, title, status = "not-started", completedAt = null) => ({ id, title, minutes: 20, status, completedAt, exercises: [] });
  const L = {
    reports: [], verified: new Set(),
    courses: {
      py: course("py", "Python Basics", [{ id: "u1", n: 1, title: "Unit 1", lessons: [lesson("u1l1", "What Python Actually Is"), lesson("u1l2", "Printing and f-strings"), lesson("u1l3", "Variables and Types")], projects: [], check: { id: "u1check", title: "Unit 1 check", status: "not-started" }, done: 0, count: 4 }]),
      sp: course("sp", "Spanish Basics", [{ id: "u1", n: 1, title: "Greetings and Basics", lessons: [lesson("m1-overview", "Module Overview"), lesson("m1-concepts", "Key Concepts")], projects: [], check: null, done: 0, count: 2 }]),
    },
    complete(courseId, ref, completedAt = new Date(clock).toISOString(), extra = {}) {
      const c = L.courses[courseId];
      for (const u of c.units) { for (const l of u.lessons) { if (l.id === ref) Object.assign(l, { status: "done", completedAt, ...extra }); for (const x of l.exercises) if (x.id === ref) Object.assign(x, { status: "passed", completedAt, ...extra }); } if (u.check?.id === ref) Object.assign(u.check, { status: "passed", completedAt, ...extra }); u.done = u.lessons.filter((l) => l.status === "done").length + (u.check?.status === "passed" ? 1 : 0); }
      L.verified.add(`${courseId}:${ref}`);
    },
    async call(path, opts = {}) {
      if (path === "/api/local/status") return { ok: true, data: { courses: Object.values(L.courses).map((c) => ({ id: c.id, title: c.title, installed: true, percent: c.percent, current: null, next: null })) } };
      const m = /^\/api\/local\/courses\/(.+)$/.exec(path); if (m) return { ok: true, data: structuredClone(L.courses[decodeURIComponent(m[1])]) };
      if (path === "/api/local/report") { L.reports.push(opts.body); const v = L.verified.has(`${opts.body.course}:${opts.body.lesson}`); return { ok: true, data: { verified: v, lesson: { status: v ? "done" : "not-started" } } }; }
      return { ok: false, status: 404 };
    },
    port: () => null,
  };
  return L;
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xp-learn-test-"));
  at("2026-10-05T09:00:00");
  xp._reset();
  xp.setDeps({ now: () => clock, dataDir: dir, blocksToday: () => blocks, llm: null, persona: null, addPrayer: null, ownerName: () => "Casey", ownerNick: () => "", env: () => ({ listen: "active", mode: "voice" }) });
  lantern = fakeLantern();
  xp.learning.setClient(lantern);
});
const ev = (data) => ({ v: 1, id: "e" + Math.random(), type: "xp.earned", source: "lantern", at: clock, data: { verified: true, ...data } });

test("live: xp.earned awards once by its key (after Lantern confirms it); redelivery and lesson.completed don't double it", async () => {
  lantern.complete("py", "u1l1");
  const r1 = await xp.learning.onEco(ev({ key: "lantern:py:lesson:u1l1", kind: "lesson", course: "py", courseTitle: "Python Basics", ref: "u1l1", title: "What Python Actually Is", authoredXp: 400 }));
  assert.equal(r1.ok, true); assert.equal(r1.amount, 12);
  assert.equal((await xp.learning.onEco(ev({ key: "lantern:py:lesson:u1l1", kind: "lesson", course: "py", ref: "u1l1" }))).reason, "duplicate");
  assert.equal((await xp.learning.onEco({ type: "lesson.completed", source: "lantern", data: { course: "py", ref: "u1l1" } })).reason, "duplicate");
  assert.equal(xp.balance(), 12);
  assert.equal(xp.learning.perCourse().py.authoredXp, 400);
});
test("unverified earnings never count", async () => {
  assert.equal(xp.learning.earn({ kind: "lesson", course: "sp", ref: "m1-overview", verified: false }).reason, "unverified");
  assert.equal((await xp.learning.onEco({ type: "xp.earned", source: "lantern", data: { kind: "lesson", course: "sp", ref: "x" } })).reason, "unverified");
  assert.equal(xp.balance(), 0);
});
test("H3: the key is always worked out from the event; a mismatched key, or an event not from Lantern, earns nothing", async () => {
  lantern.complete("py", "u1l1");
  assert.equal((await xp.learning.onEco(ev({ key: "lantern:py:course:py", kind: "lesson", course: "py", ref: "u1l1" }))).reason, "bad-key");
  assert.equal(xp.learning.earn({ key: "lantern:py:unit:zzz", kind: "lesson", course: "py", ref: "u1l1", verified: true }).reason, "bad-key");
  assert.equal((await xp.learning.onEco({ type: "xp.earned", source: "dayspring", data: { kind: "lesson", course: "py", ref: "u1l1", verified: true } })).reason, "not-lantern");
  assert.equal((await xp.learning.onEco({ type: "xp.earned", data: { kind: "lesson", course: "py", ref: "u1l1", verified: true } })).reason, "not-lantern");
  assert.equal(xp.lifetime(), 0);
  assert.equal((await xp.learning.onEco(ev({ kind: "lesson", course: "py", ref: "u1l1" }))).ok, true, "no key given: the computed one is used");
  assert.ok(xp.learning.detail && [...xp.history({ limit: 5 })].some((e) => e.key === "lantern:py:lesson:u1l1"));
});
test("H3: verify-first: a live event Lantern doesn't show as done is queued, and the backfill awards it once Lantern does", async () => {
  const r = await xp.learning.onEco(ev({ kind: "lesson", course: "py", ref: "u1l2", title: "Printing and f-strings" }));
  assert.equal(r.reason, "queued"); assert.equal(xp.lifetime(), 0);
  assert.equal((await xp.learning.view()).waiting, 1);
  lantern.complete("py", "u1l2");
  const back = await xp.learning.reconcile({ course: "py" });
  assert.equal(back.awarded, 1); assert.equal(xp.lifetime(), 12);
  assert.equal((await xp.learning.view()).waiting, 0);
  // Lantern offline: nothing is awarded on the event's word alone
  xp.learning.setClient({ call: async () => ({ ok: false, status: 0 }), port: () => null });
  assert.equal((await xp.learning.onEco(ev({ kind: "lesson", course: "py", ref: "u1l3" }))).reason, "queued");
  assert.equal(xp.lifetime(), 12);
});
test("H3: a date more than 2 days old, or in the future, is catch-up on every path (lifetime and badges only)", async () => {
  lantern.complete("py", "u1l1", iso(5)); lantern.complete("py", "u1l2", new Date(clock + 3 * 86400_000).toISOString());
  const old = await xp.learning.onEco(ev({ kind: "lesson", course: "py", ref: "u1l1" }));
  assert.equal(old.catchup, true); assert.equal(old.spendable, 0);
  const fut = await xp.learning.onEco(ev({ kind: "lesson", course: "py", ref: "u1l2" }));
  assert.equal(fut.catchup, true); assert.equal(fut.spendable, 0);
  const claimed = xp.learning.earn({ kind: "lesson", course: "sp", ref: "m1-overview", at: iso(9), verified: true }, { via: "claim" });
  assert.equal(claimed.catchup, true, "a claim with an old date is catch-up too");
  assert.equal(xp.lifetime(), 36); assert.equal(xp.balance(), 0);
  // the history entry keeps its own (old) date; the future one is dated today
  assert.equal(xp.history({ limit: 5 }).find((e) => e.ref === "u1l2").day, new Date(clock).toLocaleDateString("en-CA"));
});
test("backfill: completed things are awarded once; a second run, the live path and another computer's progress never double", async () => {
  lantern.complete("py", "u1l1", iso(0, 8)); lantern.complete("py", "u1l2", iso(0, 8));
  await xp.learning.onEco(ev({ kind: "lesson", course: "py", ref: "u1l2" }));            // the live event came first
  const r1 = await xp.learning.reconcile();
  assert.equal(r1.awarded, 1, "only the lesson the live path missed");
  assert.equal((await xp.learning.reconcile()).awarded, 0, "a second run finds nothing new");
  lantern.complete("sp", "m1-overview", iso(0, 9));                                         // finished on another computer, synced by Lantern's hub
  const r3 = await xp.learning.reconcile();
  assert.equal(r3.awarded, 1);
  assert.equal(xp.learning.perCourse().py.itemsCompleted, 2);
  assert.equal(xp.lifetime(), 36);
});
test("a spoken claim is checked with Lantern first", async () => {
  const no = await xp.handle("I finished lesson 3");
  assert.match(no.reply, /Lantern doesn't show “Variables and Types” as finished yet/);
  assert.match(no.reply, /count automatically/);
  assert.equal(xp.balance(), 0);
  assert.deepEqual(lantern.reports[0], { course: "py", lesson: "u1l3" });
  lantern.complete("py", "u1l3");
  const yes = await xp.handle("I finished lesson 3 in python");
  assert.match(yes.reply, /Lantern confirms it: “Variables and Types” is done\. \+12 XP/);
  assert.match((await xp.handle("I finished lesson 3")).reply, /already counted/);
  assert.equal(xp.balance(), 12);
});
test("caps: learning 120 a day for levels and badges; the balance gets at most 80 a day across everything", () => {
  for (let i = 0; i < 12; i++) xp.learning.earn({ kind: "lesson", course: "sp", ref: `l${i}`, verified: true });
  assert.equal(xp.lifetime(), R.DAILY_CAP + 40);                          // 120: ten lessons, then the learning cap
  assert.equal(xp.balance(), R.DAILY_CAP);                                // 80 to spend
  const w = xp.award("workout", blk());                     // check-ins still count for the level
  assert.equal(w.amount, 20); assert.equal(w.spendable, 0);
  assert.equal(xp.balance(), R.DAILY_CAP);
  nextDay();
  xp.learning.earn({ kind: "lesson", course: "sp", ref: "next-day", verified: true });
  assert.equal(xp.balance(), R.DAILY_CAP + 12);
});
test("verified learning isn't cut to 70% and doesn't use up the study check-in limit", () => {
  xp.learning.earn({ kind: "lesson", course: "sp", ref: "a", verified: true });
  xp.learning.earn({ kind: "lesson", course: "sp", ref: "b", verified: true });
  xp.learning.earn({ kind: "lesson", course: "sp", ref: "c", verified: true });
  assert.equal(xp.lifetime(), 36);
  assert.equal(xp.quote("study", { ...blk(), score: 2 }).reason, "ok");
});
test("practice: 10+ verified minutes, at most 3 a day per course", () => {
  assert.equal(xp.learning.earn({ kind: "practice", course: "py", sessionId: "s0", minutes: 6, verified: true }).reason, "short");
  for (let i = 1; i <= 3; i++) assert.equal(xp.learning.earn({ kind: "practice", course: "py", sessionId: `s${i}`, minutes: 15, verified: true }).amount, 8);
  assert.equal(xp.learning.earn({ kind: "practice", course: "py", sessionId: "s4", minutes: 15, verified: true }).reason, "practice-cap");
  assert.equal(xp.learning.earn({ kind: "practice", course: "sp", sessionId: "f1", minutes: 12, verified: true }).amount, 8, "another course has its own 3");
});
test("unit checks: from 70%, scaled by the score; below that, encouragement and a retake still counts later", () => {
  const low = xp.learning.earn({ kind: "check", course: "py", ref: "u1check", score: 55, verified: true });
  assert.equal(low.ok, false); assert.match(low.message, /55%.*So close!.*take it again/);
  const pass = xp.learning.earn({ kind: "check", course: "py", ref: "u1check", score: 0.9, verified: true });
  assert.equal(pass.amount, 36);
});
test("catch-up: old completions count for the lifetime total and badges only, at most 200 a day (kept across a restart)", async () => {
  const lessons = []; for (let i = 0; i < 30; i++) lessons.push({ id: `old${i}`, title: `Old lesson ${i}`, minutes: 5, status: "done", completedAt: iso(20 - Math.floor(i / 3), 8 + (i % 3)), exercises: [] });
  lantern.courses.sp.units = [{ id: "u9", n: 9, title: "Old unit", lessons, projects: [], check: null, done: 30, count: 30 }];
  const r = await xp.learning.reconcile({ course: "sp" });
  assert.ok(r.results.every((x) => x.catchup));
  assert.ok(xp.lifetime() <= 200 && xp.lifetime() >= 180, `today's catch-up budget is 200 (got ${xp.lifetime()})`);
  assert.equal(xp.balance(), 0, "catch-up adds nothing to spend");
  // a restart the same day doesn't reset the budget (it's worked out from the ledger)
  xp._reset(); xp.setDeps({ now: () => clock, dataDir: dir }); xp.learning.setClient(lantern);
  assert.equal((await xp.learning.reconcile({ course: "sp" })).awarded, 0);
  nextDay(); assert.ok((await xp.learning.reconcile({ course: "sp" })).awarded > 0, "more the next day");
  nextDay(); await xp.learning.reconcile({ course: "sp" });
  assert.equal(xp.lifetime(), 30 * 12 + 60, "in the end every lesson and the unit count");
  assert.equal(xp.balance(), 0);
  for (const d of new Set(xp.history({ limit: 200 }).map((e) => e.day))) { const spent = xp.history({ limit: 200 }).filter((e) => e.day === d && e.type === "award").reduce((s, e) => s + (e.spendable ?? e.amount), 0); assert.ok(spent <= R.DAILY_CAP, `${d}: ${spent}`); }
});
test("L3: a reconcile asked for while one runs is queued (one follow-up run), not dropped", async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const slow = { ...lantern, call: async (p, o) => { if (p === "/api/local/status") await gate; return lantern.call(p, o); } };
  xp.learning.setClient(slow);
  const first = xp.learning.reconcile();
  lantern.complete("py", "u1l1");
  const second = await xp.learning.reconcile({ course: "py" });
  assert.equal(second.skipped, true); assert.equal(second.queued, true);
  release(); await first;
  for (let i = 0; i < 20 && xp.lifetime() === 0; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(xp.lifetime(), 12, "the queued follow-up run found it");
});
test("L3: the event stream backs off on errors (up to 10 minutes) and stops on 404 (an older Lantern)", async () => {
  let calls = 0;
  xp.learning.startStream({ port: async () => 4321, fetch: async () => { calls++; return { ok: false, status: 404, body: null }; } });
  for (let i = 0; i < 20 && !xp.learning.streamState().gone; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(xp.learning.streamState().gone, true); assert.equal(calls, 1);
  xp.learning.stopStream();
  xp.learning.startStream({ port: async () => 4321, fetch: async () => ({ ok: false, status: 500, body: null }) });
  for (let i = 0; i < 20 && xp.learning.streamState().nextDelayMs === 15_000; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(xp.learning.streamState().nextDelayMs, 30_000, "the next try waits twice as long");
  assert.equal(xp.learning.streamState().gone, false);
  xp.learning.stopStream();
  assert.equal(xp.learning.STREAM_MAX_MS, 10 * 60_000);
});
test("L2: voice questions that aren't about learning never wait on Lantern; a claim asks it for 1 s at most each time", async () => {
  let calls = 0; const outs = [];
  xp.learning.setClient({ call: async (p, o) => { calls++; outs.push(o?.timeoutMs); return lantern.call(p, o); }, port: () => null });
  assert.equal(await xp.learning.voice("what time is it"), null);
  assert.equal(calls, 0);
  await xp.handle("I finished lesson 3");
  assert.ok(outs.every((t) => t <= 1000), outs.join(","));
  assert.ok(outs.reduce((s, t) => s + t, 0) <= 3000);
});
test("M6: XP turned off: learning isn't recorded or announced; 'keep tracking quietly' records it without a word", async () => {
  const seen = []; const off = xp.onEvent((k) => seen.push(k));
  xp.setSettings({ enabled: false });
  assert.equal(xp.learning.earn({ kind: "lesson", course: "sp", ref: "a", verified: true }).reason, "off");
  xp.setSettings({ trackHidden: true });
  assert.equal(xp.learning.earn({ kind: "lesson", course: "sp", ref: "b", verified: true }).ok, true);
  assert.equal(xp.lifetime(), 12);
  assert.deepEqual(seen.filter((k) => k !== "settings"), [], "nothing announced while hidden");
  off();
});
test("M4: learning is paused too when the clock went back", () => {
  xp.learning.earn({ kind: "lesson", course: "sp", ref: "a", verified: true });
  at("2026-10-04T09:00:00");
  const r = xp.learning.earn({ kind: "lesson", course: "sp", ref: "b", verified: true });
  assert.equal(r.reason, "clock"); assert.match(r.message, /clock changed; XP paused/);
});
test("learning moves the Study & Learning badge, with a citation about the lesson", () => {
  const need = B.thresholds("study")[0];
  let n = 0;
  while (xp.badges.earned().length === 0 && n < 20) { xp.learning.earn({ kind: "lesson", course: "py", courseTitle: "Python Basics", ref: `l${n}`, title: `Lesson ${n}`, verified: true }); if (n % 2) nextDay(); n++; }
  const b = xp.badges.earned()[0];
  assert.equal(b.cat, "study"); assert.ok(need > 0);
  assert.match(b.citation, /^Casey .+ by completing the lesson “Lesson \d+” in Python Basics on /);
  assert.match(b.clincher.summary, /^Lesson: Lesson \d+ \(Python Basics/);
});
test("a character still takes at least 7 days of real activity, even with the most learning, check-ins, catch-up and backfill", async () => {
  // a long history in Lantern (catch-up: never spendable) plus two recent days the backfill finds (real days)
  const lessons = []; for (let i = 0; i < 60; i++) lessons.push({ id: `old${i}`, title: `Old ${i}`, minutes: 5, status: "done", completedAt: iso(40 - Math.floor(i / 2)), exercises: [] });
  for (let i = 0; i < 20; i++) lessons.push({ id: `recent${i}`, title: `Recent ${i}`, minutes: 5, status: "done", completedAt: iso(1 + (i % 2), 8 + (i % 10)), exercises: [] });
  lantern.courses.sp.units = [{ id: "u9", n: 9, title: "History", lessons, projects: [], check: null, done: 80, count: 80 }];
  let day = 0, i = 0; const active = new Set();
  while (xp.balance() < R.priceFor("character", "x", { nth: 1 }) && day < 30) {
    day++;
    await xp.learning.reconcile();
    for (let k = 0; k < 12; k++) xp.learning.earn({ kind: "lesson", course: "py", ref: `d${day}l${k}`, verified: true });
    for (const c of ["workout", "study", "chore", "prayer", "reading"]) xp.award(c, { ...blk(), score: 3, evidence: `Evidence ${i++} about something learned in detail today with many unique content words`, fraction: 1 });
    nextDay();
  }
  for (const e of xp.history({ limit: 2000 })) if (e.type === "award" && (e.spendable ?? e.amount) > 0) active.add(e.day);
  assert.ok(active.size >= 7, `reached 500 with spendable XP from only ${active.size} days`);
  assert.ok(xp.history({ limit: 2000 }).filter((e) => e.catchup).every((e) => e.spendable === 0), "catch-up is never spendable");
});
test("voice: XP from a course, how far along, what I finished this week", async () => {
  lantern.complete("py", "u1l1"); lantern.complete("py", "u1l2");
  await xp.learning.reconcile();
  assert.match((await xp.handle("how much XP have I earned from Python Basics")).reply, /^You've earned 24 XP from Python Basics: 2 things finished/);
  assert.match((await xp.handle("what did I finish this week")).reply, /^This week you finished 2 lessons in Python Basics.*earned 24 learning XP\./);
  const far = await xp.handle("how far am I in spanish basics");
  assert.match(far.reply, /through Spanish Basics/);
});
test("the summary for Lantern's hub", () => {
  xp.learning.earn({ kind: "lesson", course: "sp", ref: "m1-overview", authoredXp: 100, verified: true });
  const s = xp.learning.summary({ balance: xp.balance(), level: xp.level(), streak: xp.streak(), badges: { total: 0 } });
  assert.deepEqual(s.perCourse, { sp: { xpAwarded: 12, authoredXp: 100, itemsCompleted: 1 } });
  assert.equal(s.level, 1); assert.equal(s.balance, 12);
});
