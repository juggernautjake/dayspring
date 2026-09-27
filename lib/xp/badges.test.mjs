// node --test lib/xp/badges.test.mjs   (fake clock, a throwaway data folder; nothing real is touched)
// Badges: the numbers (thresholds and timing), awarding at the boundary, clinchers, citations, the mystery next badge,
// nudges and the voice answers.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as xp from "./index.mjs";
import * as R from "./rules.mjs";
import * as B from "./badges.mjs";
import * as C from "./citation.mjs";

let clock, dir, events;
let bid = 0; const blocks = []; const blk = () => { const id = "b" + (++bid); blocks.push({ id, title: "", end: "00:00" }); return { source: "block", blockId: id }; };
const at = (s) => { clock = Date.parse(s); };
const hours = (h) => { clock += h * 3600_000; };
const nextDay = (hh = 9) => { const d = new Date(clock); d.setDate(d.getDate() + 1); d.setHours(hh, 0, 0, 0); clock = d.getTime(); };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xp-badge-test-"));
  at("2026-10-05T09:00:00");
  xp._reset();
  xp.setDeps({ now: () => clock, dataDir: dir, blocksToday: () => blocks, llm: null, persona: null, addPrayer: null, ownerName: () => "Casey", ownerNick: () => "Case", env: () => ({ listen: "active", mode: "voice" }) });
  events = [];
});
xp.onEvent((type, data) => events?.push({ type, data }));

// ---- the numbers ------------------------------------------------------------------------------------------------------
test("every check-in category is exactly one badge category, with 18 unique names", () => {
  assert.deepEqual([...B.BADGE_IDS].sort(), [...R.CATEGORY_IDS].sort());
  assert.ok(B.BADGE_IDS.length >= 16 && B.BADGE_IDS.length <= 18);
  const all = new Set();
  for (const c of B.BADGE_IDS) {
    assert.equal(B.NAMES[c].length, 18, c);
    assert.equal(new Set(B.NAMES[c]).size, 18, `${c} names repeat`);
    for (const n of B.NAMES[c]) { assert.ok(!all.has(`${c}:${n}`)); all.add(`${c}:${n}`); assert.ok(B.description(c, 1).length > 20); }
  }
});
test("thresholds climb strictly within every category", () => {
  for (const c of B.BADGE_IDS) { const t = B.thresholds(c); for (let i = 1; i < 18; i++) assert.ok(t[i] > t[i - 1], `${c} ${i}`); }
});
// simulate the badge credit a pace earns (the same replay the app uses), day by day
function simulate(cat, pace, maxDays = 365 * 8) {
  const c = B.BADGE_CATEGORIES[cat], th = B.thresholds(cat), awards = []; let n = 0; const day0 = Date.parse("2027-01-04T12:00:00");
  let tierDays = [];
  for (let d = 0; d < maxDays; d++) {
    const day = new Date(day0 + d * 86400_000).toLocaleDateString("en-CA");
    for (const amount of pace(d, c)) awards.push({ id: `a${n++}`, at: `${day}T10:00:00`, day, category: cat, amount });
    if (d % 7 === 6 || d < 14) { const st = B.replay(awards)[cat]; tierDays = st.earned.map((e) => Math.round((Date.parse(e.clincher.day + "T12:00:00") - day0) / 86400_000) + 1); if (tierDays.length === 18) break; }
  }
  void th; return tierDays;
}
const realistic = (d, c) => { const sessions = Math.floor((d * c.s) / 7 + 1) - Math.floor(((d - 1) * c.s) / 7 + 1); /* the first on day 0 */ return Array(sessions).fill(Math.round(c.u * 0.85)); };
const fastest = (d, c) => Array(7 * c.dS).fill(Math.round(c.u * 1.1));   // more than the caps allow: they bite
test("tier 1 within a week, the full set in ~3–5 years realistically and ≥2 years at the fastest pace", () => {
  for (const c of B.BADGE_IDS) {
    const r = simulate(c, realistic), f = simulate(c, fastest);
    assert.ok(r[0] <= 7, `${c}: tier 1 on day ${r[0]}`);
    assert.equal(r.length, 18, `${c}: realistic never finished`);
    const ry = r[17] / 365, fy = f[17] / 365;
    assert.ok(ry >= 3 && ry <= 5.2, `${c}: realistic ${ry.toFixed(2)} years`);
    assert.ok(fy >= 2, `${c}: fastest ${fy.toFixed(2)} years`);
  }
});

// ---- awarding -----------------------------------------------------------------------------------------------------------
test("a badge is awarded exactly at the boundary, with the clincher and the check-ins along the way", () => {
  const t1 = B.thresholds("workout")[0];                     // 40
  assert.equal(xp.award("workout", { ...blk(), evidence: "ran for 30 minutes", hours: 0.5 }).badges.length, 0);
  nextDay(7);
  const r = xp.award("workout", { ...blk(), evidence: "a 45-minute run" });
  assert.equal(t1, 40);
  assert.equal(r.badges.length, 1);
  const b = r.badges[0];
  assert.equal(b.name, "First Sweat");
  assert.equal(b.clincherId, r.entry);
  assert.equal(b.along.count, 2);
  assert.deepEqual([b.along.from, b.along.to], ["2026-10-05", "2026-10-06"]);
  assert.equal(b.citation, "Casey achieved this milestone by running for 45 minutes on October 6th, 2026!");
  assert.ok(events.some((e) => e.type === "badge" && e.data.key === "workout:1"));
  // no double award
  nextDay(); xp.award("workout", { ...blk(), evidence: "lifted weights" });
  assert.equal(xp.badges.earned().filter((x) => x.key === "workout:1").length, 1);
  assert.equal(xp.badges.sync().added.length, 0);
});
test("several tiers crossed at once arrive in order", () => {
  const th = B.thresholds("volunteer");                      // 5, 10, 20…: one full session crosses a few
  const r = xp.award("volunteer", { ...blk(), evidence: "served at the food bank" });
  const expected = th.filter((x) => x <= r.amount).length;
  assert.ok(expected >= 2);
  assert.deepEqual(r.badges.map((b) => b.tier), Array.from({ length: expected }, (_, i) => i + 1));
  assert.deepEqual(events.filter((e) => e.type === "badge").map((e) => [e.data.seq, e.data.of]), r.badges.map((_, i) => [i, expected]));
});
test("undo within 10 minutes takes the badge back; crossing again makes a new clincher", () => {
  xp.award("workout", { ...blk(), evidence: "ran" }); nextDay();
  const r = xp.award("workout", { ...blk(), evidence: "swam 20 laps" });
  assert.equal(r.badges.length, 1);
  hours(0.1);
  const u = xp.undoLast();
  assert.deepEqual(u.revoked, ["workout:1"]);
  assert.match(u.message, /First Sweat badge goes back/);
  assert.equal(xp.badges.earned().length, 0);
  hours(3);
  const again = xp.award("workout", { ...blk(), evidence: "cycled for an hour" });
  assert.equal(again.badges.length, 1);
  assert.notEqual(again.badges[0].clincherId, r.entry);
  assert.match(again.badges[0].citation, /cycled|cycling/);
});
test("after 10 minutes a badge is permanent", () => {
  xp.award("workout", blk()); nextDay();
  xp.award("workout", blk()); hours(0.5);
  assert.equal(xp.undoLast().ok, false);
  assert.equal(xp.badges.earned().length, 1);
});
test("spending XP never takes a badge away", () => {
  xp.award("workout", blk()); nextDay(); xp.award("workout", blk());
  xp.spend(30, { reason: "test" });
  assert.equal(xp.badges.sync().removed.length, 0);
  assert.equal(xp.badges.earned().length, 1);
});

// ---- citations ---------------------------------------------------------------------------------------------------------
test("ordinals", () => {
  const want = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 11: "11th", 12: "12th", 13: "13th", 21: "21st", 22: "22nd", 23: "23rd", 31: "31st", 111: "111th" };
  for (const [n, s] of Object.entries(want)) assert.equal(C.ordinal(Number(n)), s);
  assert.equal(C.longDate(new Date(2027, 6, 2, 23, 30).toISOString()), "July 2nd, 2027");      // local time zone
});
test("verbs become -ing forms", () => {
  const want = { run: "running", swim: "swimming", study: "studying", read: "reading", clean: "cleaning", call: "calling", cook: "cooking", practise: "practising",
    take: "taking", did: "doing", ran: "running", jogged: "jogging", baked: "baking", tidied: "tidying", scrubbed: "scrubbing", tie: "tying", make: "making" };
  for (const [v, g] of Object.entries(want)) assert.equal(C.gerund(v), g, v);
  const at = new Date(2027, 6, 2, 8).toISOString();
  const phrase = (category, evidence) => C.activity({ category, evidence, at }).phrase;
  assert.equal(phrase("chore", "did the dishes"), "doing the dishes");
  assert.equal(phrase("outdoors", "take a walk"), "taking a walk");
  assert.equal(phrase("workout", "ran for 30 minutes"), "running for 30 minutes");
  assert.equal(phrase("workout", ""), "completing a workout");                                  // the fallback
});
test("the owner's example, and the name modes", () => {
  const e = { category: "workout", evidence: "ran for 30 minutes", at: new Date(2027, 6, 2, 7).toISOString() };
  assert.equal(C.build(e, { cat: "workout", tier: 1, name: "Jordan" }).text, "Jordan achieved this milestone by running for 30 minutes on July 2nd, 2027!");
  assert.match(C.build(e, { cat: "workout", tier: 1, mode: "nickname", name: "Jordan", nickname: "Jojo" }).text, /^Jojo /);
  assert.match(C.build(e, { cat: "workout", tier: 1, mode: "none", name: "Jordan" }).text, /^You achieved/);
  const w = C.build({ category: "writing", evidence: "wrote in my journal", at: e.at }, { cat: "writing", tier: 1, mode: "none" });
  assert.match(w.text, /in your journal/);
});
test("prayer and worship stay general and never quote a prayer", () => {
  const p = C.build({ category: "prayer", evidence: "please heal my aunt's back", at: new Date(2027, 2, 3, 6, 30).toISOString() }, { cat: "prayer", tier: 1, name: "Casey" });
  assert.match(p.text, /by spending time in morning prayer on March 3rd, 2027!$/);
  assert.doesNotMatch(p.text, /aunt|heal/);
  const w = C.build({ category: "worship", at: new Date(2027, 2, 7, 10).toISOString() }, { cat: "worship", tier: 2, name: "Casey" });   // a Sunday
  assert.match(w.text, /worshipping at Sunday service on March 7th, 2027!$/);
  assert.equal(B.summary({ category: "prayer", evidence: "please heal my aunt", at: new Date(2027, 2, 3, 6).toISOString() }), "Morning prayer");
});
test("a citation never changes: the wording is fixed per badge and stored at award time", () => {
  const e = { category: "reading", evidence: "x", title: "Narnia", at: new Date(2027, 0, 1, 20).toISOString() };
  const a = C.build(e, { cat: "reading", tier: 7, name: "Casey" }), b = C.build(e, { cat: "reading", tier: 7, name: "Casey" });
  assert.equal(a.text, b.text);
  const verbs = new Set(Array.from({ length: 18 }, (_, i) => C.variantFor("reading", i + 1)));
  assert.ok(verbs.size >= 3, "the wording varies across badges");
  xp.award("workout", { ...blk(), evidence: "ran for 30 minutes" }); nextDay(); xp.award("workout", { ...blk(), evidence: "ran for 30 minutes" });
  const stored = xp.badges.earned()[0].citation;
  xp.setDeps({ ownerName: () => "Morgan" });
  xp.badges.sync();
  assert.equal(xp.badges.earned()[0].citation, stored, "not regenerated by itself");
  xp.setSettings({ badges: { nameMode: "name" } });
  assert.equal(xp.badges.renameAll(), 1);                                           // "update the names on my badges"
  assert.equal(xp.badges.earned()[0].citation, stored.replace("Casey", "Morgan"));
});
test("persona styling keeps the name, the activity and the date, or is not used", () => {
  const parts = C.build({ category: "workout", evidence: "ran for 30 minutes", at: new Date(2027, 6, 2).toISOString() }, { cat: "workout", tier: 1, name: "Casey" }).parts;
  assert.ok(C.styledKeepsFacts("Arr! Casey achieved this milestone by running for 30 minutes on July 2nd, 2027! Yo ho!", parts));
  assert.ok(!C.styledKeepsFacts("Arr! The captain ran on a fine summer day!", parts));
  // a nudge through a persona that drops the numbers falls back to the plain text
  xp.setDeps({ persona: { style: () => "Keep going, matey!" } });
  xp.award("workout", blk()); nextDay(); xp.award("workout", blk()); nextDay(); xp.award("workout", blk());
  nextDay(); xp.award("workout", blk());
  const n = xp.badgeNudge("morning", { dry: true });
  if (n) assert.match(n.text, /\d+ XP/);
});

// ---- the mystery next badge -------------------------------------------------------------------------------------------
test("the next badge: numbers, no name by default, and never its art", () => {
  xp.award("workout", blk());
  const v = xp.badges.view(), w = v.categories.find((c) => c.cat === "workout");
  const nt = w.tiers.find((t) => t.state === "next");
  assert.equal(nt.tier, 1);
  assert.equal(nt.name, null);
  assert.deepEqual(Object.keys(nt).sort(), ["name", "need", "state", "tier"]);
  assert.ok(w.tiers.filter((t) => t.state === "locked").every((t) => Object.keys(t).length === 2));
  assert.equal(w.next.have, 20); assert.equal(w.next.need, 40); assert.equal(w.next.toGo, 20);
  xp.setSettings({ badges: { hideNextName: false } });
  assert.equal(xp.badges.next("workout").name, "First Sweat");
});
test("the time estimate follows the recent pace, and is hidden with no recent activity", () => {
  assert.equal(xp.badges.next("reading").eta, null);
  for (let i = 0; i < 6; i++) { xp.award("workout", blk()); nextDay(); }
  const n = xp.badges.next("workout");
  assert.ok(n.etaDays > 0 && /recent pace/.test(n.eta), JSON.stringify(n));
  at("2027-06-01T09:00:00");                                                          // months later, nothing recent
  assert.equal(xp.badges.next("workout").eta, null);
});

// ---- nudges -----------------------------------------------------------------------------------------------------------
function nearWorkout() {                              // tier 1 at 40: one 20 XP workout = 50% and one session to go
  xp.award("workout", blk());
}
test("a nudge comes when you're close, at most once a day per category", () => {
  nearWorkout();
  const n1 = xp.badgeNudge("morning");
  assert.ok(n1 && n1.cat === "workout" && n1.speak, JSON.stringify(n1));
  assert.match(n1.text, /20 XP/); assert.match(n1.text, /Case/);
  assert.equal(xp.badgeNudge("morning"), null, "once a day");
  nextDay(6);
  assert.ok(xp.badgeNudge("morning"), "again the next day");
});
test("not close → no nudge", () => {
  for (let i = 0; i < 2; i++) { xp.award("workout", blk()); nextDay(); }  // tier 1 earned; tier 2 is far
  const n = xp.badges.next("workout");
  assert.ok(!xp.badges.near(n), JSON.stringify(n));
  assert.equal(xp.badgeNudge("morning"), null);
});
test("modes: Off and Quiet never, Silent and Chime only visual, calls and alarms never", () => {
  nearWorkout();
  for (const env of [{ listen: "off" }, { listen: "quiet" }, { listen: "active", inCall: true }, { listen: "active", alarm: true }]) assert.equal(xp.badgeNudge("morning", { env, dry: true }), null, JSON.stringify(env));
  const s = xp.badgeNudge("morning", { env: { listen: "active", mode: "silent" }, dry: true });
  assert.equal(s.speak, false); assert.equal(s.visual, true);
});
test("opting out: everywhere, per category, and by voice", async () => {
  nearWorkout();
  xp.setSettings({ badges: { nudgeCats: { workout: false } } });
  assert.equal(xp.badgeNudge("morning", { dry: true }), null);
  xp.setSettings({ badges: { nudgeCats: { workout: true } } });
  assert.ok(xp.badgeNudge("morning", { dry: true }));
  const r = await xp.handle("stop badge reminders");
  assert.match(r.reply, /no more badge reminders/i);
  assert.equal(xp.badgeNudge("morning", { dry: true }), null);
});
test("the wording is kind, never guilt, and welcoming after a break", () => {
  nearWorkout();
  at("2026-10-20T09:00:00"); xp.award("workout", { ...blk(), fraction: 0.25 });   // back after two weeks
  const n = xp.badgeNudge("morning", { dry: true });
  assert.match(n.text, /^Welcome back, Case!/);
  const texts = [n.text, xp.badges.nudgeText({ ...xp.badges.next("workout"), label: "Fitness" }, { moment: "block", block: { title: "Gym", start: "18:00" }, who: "Case" })];
  for (const t of texts) assert.doesNotMatch(t, /\b(don't|lose|missed|failing|lazy|should have|behind)\b/i);
  assert.match(texts[1], /Gym at 18:00 could get you/);
});
test("after a check-in in that category, the nudge rides along with the reply", async () => {
  await xp.handle("I worked out");
  const r = await xp.handle("did a 30 minute run");
  assert.match(r.reply, /\+\d+ XP/);
  assert.match(r.reply, /XP away from your next Fitness badge/);
});

// ---- voice -------------------------------------------------------------------------------------------------------------
test("voice: what badges, how close, what did I do to earn it, how did I get X, open the gallery", async () => {
  assert.match((await xp.handle("what badges do I have")).reply, /No badges yet/);
  xp.award("workout", { ...blk(), evidence: "ran for 30 minutes" }); nextDay(7);
  xp.award("workout", { ...blk(), evidence: "a 45-minute run" }); hours(3);
  assert.match((await xp.handle("what badges do I have")).reply, /1 badge of 324.*First Sweat in Fitness/);
  assert.match((await xp.handle("how close am I to my next fitness badge")).reply, /XP from your next Fitness badge \(40 of \d+\)/);
  assert.match((await xp.handle("how many points until my next fitness badge")).reply, /XP from/);
  assert.match((await xp.handle("what did I do to earn my last badge?")).reply, /^Casey achieved this milestone by running for 45 minutes on October 6th, 2026! Along the way: 2 workouts\./);
  assert.match((await xp.handle("how did I get the First Sweat badge")).reply, /running for 45 minutes/);
  assert.match((await xp.handle("how did I get the Steady Mover badge")).reply, /can't find/);
  assert.equal((await xp.handle("open my badge gallery")).show, "badges");
  assert.equal((await xp.handle("show my badges")).show, "badges");
});
test("self-reports for the new categories", () => {
  const want = { "I went to church": "worship", "I volunteered at the food bank": "volunteer", "I meditated for 10 minutes": "mindfulness", "I played basketball": "sports",
    "I painted a sunset": "art", "I ate a salad for lunch": "eating", "I played piano": null };
  for (const [t, c] of Object.entries(want)) assert.equal(xp.detectSelfReport(t)?.category ?? null, c, t);
});
