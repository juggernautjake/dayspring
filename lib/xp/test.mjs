// node --test lib/xp/test.mjs   (fake clock, a throwaway data folder; nothing real is touched)
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, appendFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as xp from "./index.mjs";
import * as R from "./rules.mjs";
import * as ev from "./evidence.mjs";

let clock, dir;
// a real block that ended (full credit once per block id)
let bid = 0; const blocks = []; const blk = () => { const id = "b" + (++bid); blocks.push({ id, title: "", end: "00:00" }); return { source: "block", blockId: id }; };
const at = (s) => { clock = Date.parse(s); };
const hours = (h) => { clock += h * 3600_000; };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xp-test-"));
  at("2026-10-05T09:00:00");
  xp._reset();
  xp.setDeps({ now: () => clock, dataDir: dir, blocksToday: () => blocks, llm: null, persona: null, addPrayer: null });
});
const GOOD = "I learned that in Spanish the preterite is used for completed actions in the past, while the imperfect describes ongoing or habitual actions, like fui versus iba.";

test("full check-in from a block pays the base; self-report pays 70%", () => {
  assert.equal(xp.award("workout", blk()).amount, 20);
  hours(3);
  assert.equal(xp.award("chore", { source: "self" }).amount, Math.round(8 * 0.7));
});

test("partial credit is proportional, with a 25% floor; not done earns nothing", () => {
  assert.equal(xp.award("workout", { ...blk(), fraction: 0.5 }).amount, 10);
  hours(3);
  assert.equal(xp.award("cooking", { ...blk(), fraction: 0.1 }).amount, Math.round(10 * 0.25));
  hours(3);
  assert.equal(xp.award("practice", { ...blk(), fraction: 0 }).ok, false);
});

test("per-category daily cap and the 2-hour gap", () => {
  assert.ok(xp.award("call", blk()).ok);
  hours(3);
  assert.equal(xp.award("call", blk()).reason, "category-cap");     // max 1 a day
  assert.ok(xp.award("chore", blk()).ok);
  hours(1);
  assert.equal(xp.award("chore", blk()).reason, "too-soon");
  hours(1.1);
  assert.ok(xp.award("chore", blk()).ok);
});

test("the daily cap is 80 XP, however much gets done", () => {
  let total = 0;
  for (const c of R.CATEGORY_IDS) { for (let i = 0; i < 3; i++) { const r = xp.award(c, { ...blk(), score: 3, hours: 3, evidence: GOOD + c + i }); total += r.amount; hours(2.1); } }
  assert.equal(xp.balance(), total);
  const perDay = new Map(); for (const e of xp.history({ limit: 999 })) perDay.set(e.day, (perDay.get(e.day) ?? 0) + e.amount);
  for (const [, v] of perDay) assert.ok(v <= R.DAILY_CAP, `a day earned ${v}`);
});

test("no backfilling: only today or yesterday", () => {
  assert.equal(xp.award("workout", { ...blk(), day: "2026-10-01" }).reason, "too-old");
  assert.ok(xp.award("workout", { ...blk(), day: "2026-10-04" }).ok);
});

test("duplicate 'what I learned' answers earn nothing", () => {
  assert.ok(xp.award("study", { ...blk(), score: 2, evidence: GOOD }).ok);
  hours(3);
  const r = xp.award("study", { ...blk(), score: 2, evidence: GOOD });
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
  const r1 = xp.checkin.start("study", { ...blk(), title: "Spanish" }, "t");
  assert.match(r1.prompt, /Did you finish/);
  assert.equal((await xp.checkin.answer("yes", "t")).prompt, R.CATEGORIES.study.ask);
  assert.match((await xp.checkin.answer(GOOD, "t")).prompt, /imperfect/);
  const done = await xp.checkin.answer("Cuando era nino, jugaba en el parque todos los dias.", "t");
  assert.equal(done.result.amount, 25);
});

test("a weak answer to the follow-up earns half", async () => {
  const llm = { ready: () => true, complete: async ({ system }) => (/JSON/.test(system) ? '{"score":2,"followup":"Why does that help?"}' : "no") };
  xp.setDeps({ llm });
  xp.checkin.start("study", { ...blk(), done: true }, "t");
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
  xp.award("workout", blk());
  hours(3); xp.award("chore", blk());
  appendFileSync(join(dir, "xp-ledger.jsonl"), '{"id":"x","type":"aw');          // a power cut mid-write
  xp._reset(); xp.setDeps({ now: () => clock, dataDir: dir });
  assert.equal(xp.balance(), 28);
  const u = xp.undoLast(); assert.ok(u.ok); assert.equal(xp.balance(), 20);
  hours(1); assert.ok(xp.award("reading", { ...blk(), score: 2, evidence: GOOD }).ok);
  hours(0.5); assert.equal(xp.undoLast().ok, false);                             // too late
  const lines = readFileSync(join(dir, "xp-ledger.jsonl"), "utf8").trim().split("\n");
  assert.ok(lines.length >= 4);                                                  // nothing was ever rewritten
});

test("spend is refused when short, and records a spend when not", () => {
  assert.deepEqual(xp.spend(100, { reason: "test" }), { ok: false, short: 100, balance: 0 });
  xp.award("workout", blk());
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
    for (const c of R.CATEGORY_IDS) { xp.award(c, { ...blk(), score: 3, hours: 3, evidence: `${GOOD} day ${day} ${c}` }); hours(0.1); }
    at(`2026-10-${String(5 + day).padStart(2, "0")}T12:00:00`);
    for (const c of R.CATEGORY_IDS) { xp.award(c, { ...blk(), score: 3, hours: 3, evidence: `${GOOD} noon ${day} ${c}` }); hours(0.1); }
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
  for (let d = 0; d < 10; d++) { at(`2026-10-${String(5 + d).padStart(2, "0")}T08:00:00`); for (const c of R.CATEGORY_IDS) { xp.award(c, { ...blk(), score: 3, hours: 3, evidence: `${GOOD} ${d} ${c}` }); hours(0.1); } }
  const r = await xp.unlockCharacter(null);
  assert.ok(r.ok, r.message); assert.equal(r.cost, 500); assert.ok(unlocked.caveman);
  const u = await xp.handle("what can I unlock");
  assert.match(u.reply, /hidden/);
});

test("levels every 300 lifetime XP, with titles", () => {
  assert.deepEqual([R.levelFor(0).level, R.levelFor(299).level, R.levelFor(300).level, R.levelFor(300).title], [1, 1, 2, "Apprentice"]);
});

test("streaks count days with a real check-in; one missed day a month is saved; +10% from day 7", () => {
  for (let d = 0; d < 6; d++) { at(`2026-10-${String(1 + d).padStart(2, "0")}T08:00:00`); xp.award("workout", blk()); }
  at("2026-10-06T20:00:00"); assert.equal(xp.streak().days, 6);
  at("2026-10-07T08:00:00"); assert.equal(xp.award("workout", blk()).amount, 22);   // day 7: 20 × 1.1
  at("2026-10-09T08:00:00"); xp.award("workout", blk());                             // missed the 8th
  assert.equal(xp.streak().days, 8); assert.equal(xp.streak().saversUsed, 1);
  at("2026-10-11T08:00:00"); xp.award("workout", blk());                             // missed the 10th too
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
  assert.equal(xp.award("workout", blk()).reason, "off");
});

// ---- regression tests for the XP bug review (H1–H3, M1–M7, L1–L7) ----------------------------------------------------------
const sec = (s) => { clock += s * 1000; };

test("H1: a spoken check-in lets go ~12 s after its last question; an answer it doesn't understand doesn't keep it open", async () => {
  xp.checkin.start("workout", { source: "self" }, "tv");
  sec(xp.VOICE_MS / 1000 + 10);                                     // the question plus its speaking time, then more
  assert.equal(xp.checkin.active("tv"), null, "expired");
  xp.checkin.start("workout", { source: "self" }, "tv");
  const again = await xp.checkin.answer("the weather is nice", "tv");
  assert.match(again.prompt, /did you finish it/i);                 // asked once more
  const gone = await xp.checkin.answer("purple monkey dishwasher", "tv");
  assert.equal(gone.message, "No problem, you can tell me later.");
  assert.equal(xp.checkin.active("tv"), null);
  // an answer that isn't understood doesn't restart the wait
  xp.checkin.start("chore", { source: "self", done: true }, "tv");
  sec(8); await xp.checkin.answer("zzz", "tv");                     // (proof: asks once more → a new question)
  sec(8); assert.ok(xp.checkin.active("tv"), "the retry question restarted it");
  sec(20); assert.equal(xp.checkin.active("tv"), null);
});

test("H1: only words that plausibly answer go to the check-in; the prayer list only takes an explicit addition", async () => {
  xp.checkin.start("workout", { source: "self" }, "tv");
  assert.equal(xp.checkin.plausible("yes", "tv"), true);
  assert.equal(xp.checkin.plausible("mostly", "tv"), true);
  assert.equal(xp.checkin.plausible("what's the weather like", "tv"), false);
  assert.equal(xp.checkin.plausible("set a timer for ten minutes", "tv"), false);
  xp.checkin.start("work", { source: "self", done: true }, "tv");
  assert.equal(xp.checkin.plausible("about 2 hours", "tv"), true);
  assert.equal(xp.checkin.plausible("play some music", "tv"), false);
  xp.checkin.start("chore", { source: "self", done: true }, "tv");
  assert.equal(xp.checkin.plausible("washed the dishes", "tv"), true);
  assert.equal(xp.checkin.plausible("what time is it", "tv"), false);
  // prayer: "anything to add to your prayer list?"
  const added = []; xp.setDeps({ addPrayer: (t) => added.push(t) });
  let r = xp.checkin.start("prayer", { source: "self", done: true }, "tv"); assert.match(r.prompt, /prayer list/);
  assert.equal(xp.checkin.plausible("turn on the lights", "tv"), false);
  assert.equal((await xp.checkin.answer("that was nice", "tv")).message, "Okay."); assert.equal(added.length, 0, "not an addition");
  hours(3); r = xp.checkin.start("prayer", { source: "self", done: true }, "tv");
  assert.match((await xp.checkin.answer("yes, for my mom", "tv")).message, /added/); assert.deepEqual(added, ["my mom"]);
});

test("H1: a typed check-in has its own id and a 3-minute wait; answers without its id go nowhere", async () => {
  const r = await xp.handle("I studied", { surface: "typed", typed: true });
  assert.ok(r.session, "a session id");
  assert.equal(await xp.checkin.answer(GOOD, "typed", { id: "wrong" }), null);
  assert.equal(await xp.checkin.answer(GOOD, "typed"), null);
  sec(150); assert.ok(xp.checkin.active("typed"), "still waiting after 2.5 minutes");
  const done = await xp.checkin.answer(GOOD, "typed", { id: r.session });
  assert.equal(done.result.ok, true);
  await xp.handle("I did the dishes", { surface: "typed", typed: true });
  sec(181); assert.equal(xp.checkin.active("typed"), null, "3 minutes of nothing: gone");
});

test("H2: a torn last line is cut off (and kept aside); the next append starts on its own line and replay keeps everything", () => {
  xp.award("workout", blk());
  const f = join(dir, "xp-ledger.jsonl");
  appendFileSync(f, '{"id":"x","type":"aw');                         // a power cut mid-write
  appendFileSync(f, "");
  xp._reset(); xp.setDeps({ now: () => clock, dataDir: dir });
  hours(3); assert.ok(xp.award("chore", blk()).ok);                // the append after the torn line
  xp._reset(); xp.setDeps({ now: () => clock, dataDir: dir });
  assert.equal(xp.balance(), 28, "both awards replay");
  const text = readFileSync(f, "utf8");
  assert.ok(text.endsWith("\n")); assert.equal(text.trim().split("\n").length, 2);
  const torn = readdirSync(dir).filter((n) => /^xp-ledger\.torn-\d+\.txt$/.test(n));
  assert.equal(torn.length, 1); assert.equal(readFileSync(join(dir, torn[0]), "utf8"), '{"id":"x","type":"aw');
  // a bad line in the middle is skipped without losing the lines after it
  appendFileSync(f, "not json\n"); hours(3); xp._reset(); xp.setDeps({ now: () => clock, dataDir: dir });
  assert.ok(xp.award("cooking", blk()).ok); xp._reset(); xp.setDeps({ now: () => clock, dataDir: dir });
  assert.equal(xp.balance(), 38);
});

test("M1: 'block' credit only for a real block that ended today, once per block; a client can't claim it", () => {
  blocks.push({ id: "later", title: "Gym", end: "23:59" }, { id: "done1", title: "Gym", end: "08:00" });
  const r1 = xp.checkin.start("workout", { source: "block", blockId: "nope", done: true }, "a");       // not in today's plan
  assert.equal(xp.checkin.active("a").ctx.source, "self"); void r1;
  xp.checkin.start("workout", { source: "block", blockId: "later" }, "b");                          // hasn't ended
  assert.equal(xp.checkin.active("b").ctx.source, "self");
  xp.checkin.start("workout", { source: "block", blockId: "done1" }, "c");
  assert.equal(xp.checkin.active("c").ctx.source, "block");
  assert.equal(xp.award("workout", { source: "block", blockId: "done1" }).amount, 20);
  hours(3); assert.equal(xp.award("workout", { source: "block", blockId: "done1" }).amount, Math.round(20 * 0.7), "once per block");
  assert.equal(xp.award("chore", { source: "timer" }).amount, Math.round(8 * 0.7), "no timer id: self-reported");
});

test("M1: a finished focus timer or pomodoro starts a full-credit work check-in (server side only)", async () => {
  const asks = [];
  xp.startScheduler({ blocksToday: () => [], canAsk: () => true, ask: (a) => asks.push(a) });
  assert.equal(xp.timerFinished({ id: "t0", label: "pasta", ms: 30 * 60_000 }), null, "not a focus timer");
  assert.equal(xp.timerFinished({ id: "t1", label: "focus", cycle: { phase: "work", round: 2, rounds: 4, work: 25 * 60_000 } }), null, "not the last round");
  const r = xp.timerFinished({ id: "t2", label: "focus", ms: 25 * 60_000, cycle: { phase: "work", round: 4, rounds: 4, work: 25 * 60_000, rest: 5 * 60_000 } });
  assert.match(r.prompt, /focus session/); assert.equal(asks.length, 1);
  const done = await xp.checkin.answer("yes", "tv");
  assert.equal(done.result.ok, true); assert.equal(done.result.amount, Math.round(15 * (100 / 60)), "full credit for 100 minutes");
  assert.equal(xp.history({ limit: 1 })[0].source, "timer");
});

test("M2: every proof answer is checked the same way; work asks again for the hours; 'nobody' isn't a call", async () => {
  assert.equal(ev.validEvidence("asdf").ok, false);
  assert.equal(ev.validEvidence("xkcdqz wqrtpl zzzz").ok, false);
  assert.equal(ev.validEvidence("ran").ok, false, "two real words at least");
  assert.equal(ev.validEvidence("washed the dishes").ok, true);
  assert.equal(ev.validEvidence("nobody", { min: 1, who: true }).ok, false);
  assert.equal(ev.validEvidence("no one", { min: 1, who: true }).ok, false);
  assert.equal(ev.validEvidence("my mom", { min: 1, who: true }).ok, true);
  xp.checkin.start("work", { source: "self", done: true }, "w");
  const again = await xp.checkin.answer("it went well", "w");
  assert.match(again.prompt, /how many hours/i);
  assert.equal((await xp.checkin.answer("about 2", "w")).result.amount, Math.round(30 * 0.7));
  xp.checkin.start("call", { source: "self", done: true }, "c");
  assert.match((await xp.checkin.answer("nobody", "c")).prompt, /Who was it/);
  const no = await xp.checkin.answer("no one", "c");
  assert.equal(no.result, undefined); assert.match(no.message, /no XP/);
  xp.checkin.start("chore", { source: "self", done: true }, "d");
  assert.ok((await xp.checkin.answer("lol", "d")).prompt);
  assert.match((await xp.checkin.answer("ok", "d")).message, /no XP/);
});

test("M3: a study answer's fingerprint is the answer alone; the follow-up is stored beside it", async () => {
  const llm = { ready: () => true, complete: async ({ system }) => (/JSON/.test(system) ? '{"score":2,"followup":"Can you give an example?"}' : "yes") };
  xp.setDeps({ llm });
  xp.checkin.start("study", { source: "self", done: true }, "s");
  await xp.checkin.answer(GOOD, "s");
  const r = await xp.checkin.answer("Cuando era nino, jugaba en el parque todos los dias.", "s");
  assert.ok(r.result.ok);
  const e = xp.history({ limit: 1 })[0];
  assert.equal(e.evidence, GOOD); assert.match(e.followup, /jugaba/); assert.equal(e.fp, ev.fingerprint(GOOD));
  hours(3); xp.checkin.start("study", { source: "self", done: true }, "s");
  const dup = await xp.checkin.answer(GOOD, "s");
  assert.match(dup.message, /same as an earlier answer/, "the same answer with a new follow-up can't count twice");
});

test("M4: the clock set back pauses XP; a big jump forward is allowed but marked; caps key off the latest day seen", () => {
  assert.ok(xp.award("workout", blk()).ok);
  at("2026-10-04T20:00:00");                                        // set back a day
  const r = xp.award("chore", blk());
  assert.equal(r.reason, "clock"); assert.equal(r.message, "Your computer's clock changed; XP paused until it's fixed.");
  at("2026-10-05T08:00:00");                                        // an hour before the last award (past the 10-minute slack)
  assert.equal(xp.award("chore", blk()).reason, "clock");
  at("2026-10-05T12:00:00"); assert.ok(xp.award("chore", blk()).ok, "fixed: XP again");
  at("2026-10-08T12:00:00");
  assert.ok(xp.award("cooking", blk()).ok); assert.equal(xp.history({ limit: 1 })[0].clockJump, true);
  // a restart doesn't forget the latest day seen
  xp._reset(); xp.setDeps({ now: () => clock, dataDir: dir }); at("2026-10-07T12:00:00");
  assert.equal(xp.award("reading", { ...blk(), score: 2, evidence: GOOD }).reason, "clock");
});

test("M5/L1: undo only takes back your own check-in (not Lantern's learning), and never below zero; keys free up", () => {
  assert.ok(xp.award("workout", blk()).ok);
  hours(0.1); xp.learning.earn({ kind: "lesson", course: "py", ref: "u1", verified: true });
  const u = xp.undoLast();
  assert.equal(u.ok, true); assert.equal(u.amount, 20, "the workout, not the lesson");
  assert.equal(xp.balance(), 12);
  assert.equal(xp.undoLast().message, "There's no check-in to undo.");
  // spent XP can't be undone into a negative balance
  hours(3); xp.award("cooking", blk()); xp.spend(20, { reason: "test" });
  const neg = xp.undoLast();
  assert.equal(neg.ok, false); assert.match(neg.message, /below zero/); assert.equal(xp.balance(), 2);
});

test("M6: with XP off nothing is announced, badges aren't synced, and nudges stay quiet", () => {
  const seen = []; const off = xp.onEvent((k) => seen.push(k));
  xp.setSettings({ enabled: false });
  assert.equal(xp.badgeNudge("morning"), null);
  assert.equal(xp.award("workout", blk()).reason, "off");
  assert.deepEqual(seen, ["settings"]);
  off();
});

test("M7: a secret is never unlocked for free while XP is loading; only xp: false means free", async () => {
  const P = await import("../persona/index.mjs");
  assert.equal(typeof P.unlockSecret, "function");
  const src = readFileSync(new URL("../persona/index.mjs", import.meta.url), "utf8");
  assert.match(src, /m === null\) return recordUnlock\(id, 0\)/);
  assert.match(src, /XP is still starting, try again in a moment\./);
  assert.match(src, /xpMod\(\) !== null \? s\.unlocked/);
});

test("L4: a badge's date is the day it was earned for (a check-in for yesterday says yesterday)", async () => {
  const C = await import("./citation.mjs");
  assert.equal(C.longDate("2026-10-04"), "October 4th, 2026");
  xp.award("workout", { ...blk(), evidence: "ran for 30 minutes" });              // Oct 5, 09:00
  hours(3);                                                                       // then a check-in for yesterday's run
  assert.ok(xp.award("workout", { ...blk(), day: "2026-10-04", evidence: "a 45-minute run" }).ok);
  const rec = xp.badges.earned()[0];
  assert.ok(rec, "the first Fitness badge");
  assert.match(rec.citation, /October 4th, 2026/, rec.citation);
});

test("L5: the chart data: what went to the balance each day, check-ins and learning apart", () => {
  xp.award("workout", blk());
  xp.learning.earn({ kind: "lesson", course: "py", ref: "a", verified: true });
  const d = xp.daily(1)[0];
  assert.equal(d.checkins, 20); assert.equal(d.learning, 12); assert.equal(d.spend, 32); assert.equal(d.xp, 32);
});

test("L6: a visual-only badge nudge counts as sent only once a screen showed it", () => {
  xp.setDeps({ env: () => ({ listen: "active", mode: "silent" }) });
  xp.award("workout", blk()); at("2026-10-06T09:00:00");
  const n1 = xp.badgeNudge("morning");
  assert.ok(n1, "one workout from the first Fitness badge: a nudge");
  assert.equal(n1.speak, false); assert.equal(n1.ack, true);
  assert.ok(xp.badgeNudge("morning"), "not shown yet: offered again");
  assert.equal(xp.badges.markNudged(n1.cat), true);
  assert.equal(xp.badgeNudge("morning", { cat: n1.cat }), null, "shown: once a day");
});
