// node --test lib/xp/test.mjs   (fake clock, a throwaway data folder; nothing real is touched)
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as xp from "./index.mjs";
import * as R from "./rules.mjs";
import * as ev from "./evidence.mjs";

let clock, dir;
const at = (s) => { clock = Date.parse(s); };
const hours = (h) => { clock += h * 3600_000; };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xp-test-"));
  at("2026-10-05T09:00:00");
  xp._reset();
  xp.setDeps({ now: () => clock, dataDir: dir, llm: null, persona: null, addPrayer: null });
});
const GOOD = "I learned that in Spanish the preterite is used for completed actions in the past, while the imperfect describes ongoing or habitual actions, like fui versus iba.";

test("full check-in from a block pays the base; self-report pays 70%", () => {
  assert.equal(xp.award("workout", { source: "block" }).amount, 20);
  hours(3);
  assert.equal(xp.award("chore", { source: "self" }).amount, Math.round(8 * 0.7));
});

test("partial credit is proportional, with a 25% floor; not done earns nothing", () => {
  assert.equal(xp.award("workout", { source: "block", fraction: 0.5 }).amount, 10);
  hours(3);
  assert.equal(xp.award("cooking", { source: "block", fraction: 0.1 }).amount, Math.round(10 * 0.25));
  hours(3);
  assert.equal(xp.award("practice", { source: "block", fraction: 0 }).ok, false);
});

test("per-category daily cap and the 2-hour gap", () => {
  assert.ok(xp.award("call", { source: "block" }).ok);
  hours(3);
  assert.equal(xp.award("call", { source: "block" }).reason, "category-cap");     // max 1 a day
  assert.ok(xp.award("chore", { source: "block" }).ok);
  hours(1);
  assert.equal(xp.award("chore", { source: "block" }).reason, "too-soon");
  hours(1.1);
  assert.ok(xp.award("chore", { source: "block" }).ok);
});

test("the daily cap is 80 XP, however much gets done", () => {
  let total = 0;
  for (const c of R.CATEGORY_IDS) { for (let i = 0; i < 3; i++) { const r = xp.award(c, { source: "block", score: 3, hours: 3, evidence: GOOD + c + i }); total += r.amount; hours(2.1); } }
  assert.equal(xp.balance(), total);
  const perDay = new Map(); for (const e of xp.history({ limit: 999 })) perDay.set(e.day, (perDay.get(e.day) ?? 0) + e.amount);
  for (const [, v] of perDay) assert.ok(v <= R.DAILY_CAP, `a day earned ${v}`);
});

test("no backfilling: only today or yesterday", () => {
  assert.equal(xp.award("workout", { source: "block", day: "2026-10-01" }).reason, "too-old");
  assert.ok(xp.award("workout", { source: "block", day: "2026-10-04" }).ok);
});

test("duplicate 'what I learned' answers earn nothing", () => {
  assert.ok(xp.award("study", { source: "block", score: 2, evidence: GOOD }).ok);
  hours(3);
  const r = xp.award("study", { source: "block", score: 2, evidence: GOOD });
  assert.equal(r.reason, "duplicate");
});

test("study engagement heuristic: real learning vs 'I learned stuff'", () => {
  assert.equal(ev.heuristic("I learned stuff").score, 0);
  assert.equal(ev.heuristic("things").score, 0);
  assert.equal(ev.heuristic("idk").score, 0);
  assert.equal(ev.heuristic("asdfgh qwrtzx bcdfghj").score, 0);
  assert.equal(ev.heuristic("Spanish verbs", { title: "Spanish verbs" }).score, 0);
  assert.ok(ev.heuristic(GOOD).score >= 2);
  assert.equal(ev.heuristic(GOOD, { past: [GOOD] }).score, 0);
});

test("typed check-in: 'I finished studying' → what did you learn → XP", async () => {
  const a = await xp.handle("I finished studying");
  assert.match(a.reply, /learned/i); assert.ok(a.awaiting);
  const b = await xp.handle("I learned stuff");
  assert.match(b.reply, /more/i);                                        // one retry
  const c = await xp.handle(GOOD);
  assert.match(c.reply, /\+\d+ XP/);
  assert.equal(xp.balance(), Math.round(25 * 0.7));
});

test("the AI path: a follow-up question; a real answer earns the full amount", async () => {
  const calls = [];
  const llm = { ready: () => true, complete: async ({ prompt }) => { calls.push(prompt); return calls.length === 1 ? '{"score":2,"followup":"Can you give an example sentence using the imperfect?"}' : "yes"; } };
  xp.setDeps({ llm });
  const r1 = xp.checkin.start("study", { source: "block", title: "Spanish" }, "t");
  assert.match(r1.prompt, /Did you finish/);
  assert.equal((await xp.checkin.answer("yes", "t")).prompt, R.CATEGORIES.study.ask);
  assert.match((await xp.checkin.answer(GOOD, "t")).prompt, /imperfect/);
  const done = await xp.checkin.answer("Cuando era nino, jugaba en el parque todos los dias.", "t");
  assert.equal(done.result.amount, 25);
});

test("a weak answer to the follow-up earns half", async () => {
  const llm = { ready: () => true, complete: async ({ system }) => (/JSON/.test(system) ? '{"score":2,"followup":"Why does that help?"}' : "no") };
  xp.setDeps({ llm });
  xp.checkin.start("study", { source: "block", done: true }, "t");
  await xp.checkin.answer(GOOD, "t");
  const r = await xp.checkin.answer("because", "t");
  assert.equal(r.result.amount, Math.round(25 * 0.5));
});

test("prayer: honour system, never quizzed; the gentle prayer-list question adds to the list", async () => {
  const added = [];
  xp.setDeps({ addPrayer: (t) => added.push(t) });
  const r = await xp.handle("I prayed this morning");
  assert.match(r.reply, /\+\d+ XP/); assert.match(r.reply, /prayer list/i);
  assert.doesNotMatch(r.reply, /learn|what did you|prove/i);
  const r2 = await xp.handle("Yes, pray for my aunt's surgery");
  assert.match(r2.reply, /added/); assert.equal(added.length, 1);
});

test("ledger: append-only, replays after a restart, survives a torn last line; undo within 10 minutes", () => {
  xp.award("workout", { source: "block" });
  hours(3); xp.award("chore", { source: "block" });
  appendFileSync(join(dir, "xp-ledger.jsonl"), '{"id":"x","type":"aw');          // a power cut mid-write
  xp._reset(); xp.setDeps({ now: () => clock, dataDir: dir });
  assert.equal(xp.balance(), 28);
  const u = xp.undoLast(); assert.ok(u.ok); assert.equal(xp.balance(), 20);
  hours(1); assert.ok(xp.award("reading", { source: "block", score: 2, evidence: GOOD }).ok);
  hours(0.5); assert.equal(xp.undoLast().ok, false);                             // too late
  const lines = readFileSync(join(dir, "xp-ledger.jsonl"), "utf8").trim().split("\n");
  assert.ok(lines.length >= 4);                                                  // nothing was ever rewritten
});

test("spend is refused when short, and records a spend when not", () => {
  assert.deepEqual(xp.spend(100, { reason: "test" }), { ok: false, short: 100, balance: 0 });
  xp.award("workout", { source: "block" });
  assert.equal(xp.spend(15, { reason: "test" }).ok, true);
  assert.equal(xp.balance(), 5);
});

test("pricing: 500, then +50 each; the first unlock can't happen in under 7 days, even with maximum effort", () => {
  assert.equal(xp.priceFor("character", "x", { nth: 1 }), 500);
  assert.equal(xp.priceFor("character", "x", { nth: 0 }), 500);
  assert.equal(xp.priceFor("character", "x", { nth: 4 }), 650);
  let day = 0;
  while (xp.balance() < 500) {
    at(`2026-10-${String(5 + day).padStart(2, "0")}T07:00:00`);
    for (const c of R.CATEGORY_IDS) { xp.award(c, { source: "block", score: 3, hours: 3, evidence: `${GOOD} day ${day} ${c}` }); hours(0.1); }
    at(`2026-10-${String(5 + day).padStart(2, "0")}T12:00:00`);
    for (const c of R.CATEGORY_IDS) { xp.award(c, { source: "block", score: 3, hours: 3, evidence: `${GOOD} noon ${day} ${c}` }); hours(0.1); }
    day++;
  }
  assert.ok(day >= 7, `unlocked after ${day} days`);
});

test("unlocking a found secret character goes through the persona, which prices and spends XP", async () => {
  // a stand-in for lib/persona's side: found for free, unlocked with XP (nth is 1 for the first)
  const unlocked = {};
  const persona = {
    secrets: { view: () => ({ list: [{ id: "caveman", discovered: true, unlocked: Boolean(unlocked.caveman), name: "The Caveman", cost: unlocked.caveman ? 0 : xp.priceFor("character", "caveman", { nth: Object.keys(unlocked).length + 1 }) }, { id: "sloth", discovered: false, unlocked: false, hint: "slow…" }] }) },
    unlockSecret: (id) => { const cost = xp.priceFor("character", id, { nth: Object.keys(unlocked).length + 1 }); const r = xp.spend(cost, { ref: `character:${id}` }); if (!r.ok) return { ok: false, short: r.short, message: `costs ${cost}` }; unlocked[id] = true; return { ok: true, id, cost, text: "🔓 Unlocked: The Caveman!" }; },
  };
  xp.setDeps({ persona });
  assert.equal((await xp.unlockCharacter("caveman")).ok, false);
  assert.match((await xp.unlockCharacter("sloth")).message, /Find that character first/);
  for (let d = 0; d < 10; d++) { at(`2026-10-${String(5 + d).padStart(2, "0")}T08:00:00`); for (const c of R.CATEGORY_IDS) { xp.award(c, { source: "block", score: 3, hours: 3, evidence: `${GOOD} ${d} ${c}` }); hours(0.1); } }
  const r = await xp.unlockCharacter(null);
  assert.ok(r.ok, r.message); assert.equal(r.cost, 500); assert.ok(unlocked.caveman);
  const u = await xp.handle("what can I unlock");
  assert.match(u.reply, /hidden/);
});

test("levels every 300 lifetime XP, with titles", () => {
  assert.deepEqual([R.levelFor(0).level, R.levelFor(299).level, R.levelFor(300).level, R.levelFor(300).title], [1, 1, 2, "Apprentice"]);
});

test("streaks count days with a real check-in; one missed day a month is saved; +10% from day 7", () => {
  for (let d = 0; d < 6; d++) { at(`2026-10-${String(1 + d).padStart(2, "0")}T08:00:00`); xp.award("workout", { source: "block" }); }
  at("2026-10-06T20:00:00"); assert.equal(xp.streak().days, 6);
  at("2026-10-07T08:00:00"); assert.equal(xp.award("workout", { source: "block" }).amount, 22);   // day 7: 20 × 1.1
  at("2026-10-09T08:00:00"); xp.award("workout", { source: "block" });                             // missed the 8th
  assert.equal(xp.streak().days, 8); assert.equal(xp.streak().saversUsed, 1);
  at("2026-10-11T08:00:00"); xp.award("workout", { source: "block" });                             // missed the 10th too
  assert.deepEqual([xp.streak().days, xp.streak().saversUsed], [2, 1]);                           // the saver bridges the newest gap; the 8th breaks it (one a month)
});

test("phrases: self-reports are recognised; plans and questions are not", () => {
  const cat = (t) => xp.detectSelfReport(t)?.category ?? null;
  assert.equal(cat("I just finished my workout"), "workout");
  assert.equal(cat("I studied for an hour"), "study");
  assert.equal(cat("I did the dishes"), "chore");
  assert.equal(cat("I read a chapter"), "reading");
  assert.equal(cat("I called mom"), "call");
  assert.equal(cat("I went for a walk"), "outdoors");
  assert.equal(cat("I need to do the dishes"), null);
  assert.equal(cat("remind me to work out"), null);
  assert.equal(cat("did I work out today?"), null);
  assert.equal(xp.parseHours("about an hour and a half"), 1.5);
  assert.equal(xp.parseHours("45 minutes"), 0.75);
  assert.equal(xp.parseFraction("about half"), 0.5);
  assert.equal(xp.parseFraction("75%"), 0.75);
});

test("block-end check-ins: asked once, never when Dayspring can't ask, and mapped from the schedule", () => {
  at("2026-10-05T17:32:00");
  const asks = [];
  const blocks = () => [{ id: "b1", title: "Walk", category: "body", start: "17:00", end: "17:30" }];
  assert.equal(xp.tickScheduler({ blocksToday: blocks, canAsk: () => false, ask: (a) => asks.push(a) }), null);
  assert.equal(asks.length, 0);                                                    // stopped listening / Off / Quiet
  xp.tickScheduler({ blocksToday: blocks, canAsk: () => true, ask: (a) => asks.push(a) });
  assert.equal(asks.length, 1); assert.match(asks[0].text, /Walk/); assert.equal(asks[0].category, "outdoors");
  xp.tickScheduler({ blocksToday: blocks, canAsk: () => true, ask: (a) => asks.push(a) });
  assert.equal(asks.length, 1);                                                    // only once
});

test("XP off: nothing is awarded", () => {
  xp.setSettings({ enabled: false });
  assert.equal(xp.award("workout", { source: "block" }).reason, "off");
});
