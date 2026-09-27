// node --test lib/persona/depth.test.mjs: every character is fully built out (depth/*.mjs)
import { test } from "node:test";
import assert from "node:assert/strict";
import { KINDS, byId } from "./presets.mjs";
import * as compile from "./compile.mjs";
import { neutral } from "./traits.mjs";
import { factsOf } from "./transforms.mjs";
import { problems, ALL_IDS, MIN_LINES, BANNED } from "./depth/check.mjs";
import { EXTRA_KINDS, TIMES, timeOf } from "./depth/index.mjs";

const st = (id, role = {}) => { const c = byId(id); return { preset: id, base: { ...neutral(), ...(c.base ?? {}) }, role: { ...Object.fromEntries((c.roles ?? []).map((r) => [r.id, r.def ?? 0])), ...role } }; };

test(`all ${ALL_IDS.length} characters: ${MIN_LINES}+ lines, every kind, times of day, both ends of every role, riffs, vocabulary`, () => {
  assert.equal(ALL_IDS.length, 35);   // 20 built-ins + 15 secrets
  const bad = ALL_IDS.map((id) => [id, problems(id)]).filter(([, p]) => p.length);
  assert.deepEqual(bad, [], bad.map(([id, p]) => `${id}: ${p.join("; ")}`).join("\n"));
});

test("time of day picks a matching greeting and goodbye", () => {
  for (const id of ALL_IDS) for (const k of ["greeting", "goodbye"]) for (const t of TIMES) {
    const pool = compile.linesFor(st(id), k, { time: t });
    const own = byId(id).phrases[k].filter((l) => Array.isArray(l) && l[1] === `time=${t}`).map((l) => l[0]);
    assert.ok(own.some((l) => pool.includes(l)), `${id}.${k}@${t}`);
    for (const o of TIMES.filter((x) => x !== t)) {
      const other = byId(id).phrases[k].filter((l) => Array.isArray(l) && l[1] === `time=${o}`).map((l) => l[0]);
      assert.ok(!other.some((l) => pool.includes(l) && !own.includes(l)), `${id}.${k}: ${o} line leaked into ${t}`);
    }
  }
  assert.equal(timeOf(new Date(2026, 0, 1, 7)), "morning");
  assert.equal(timeOf(new Date(2026, 0, 1, 14)), "afternoon");
  assert.equal(timeOf(new Date(2026, 0, 1, 19)), "evening");
  assert.equal(timeOf(new Date(2026, 0, 1, 2)), "night");
});

test("the two ends of each role slider speak entirely differently", () => {
  for (const id of ALL_IDS) for (const r of byId(id).roles) {
    const lo = new Set(), hi = new Set(); let loOnly = 0, hiOnly = 0;
    for (const k of KINDS) {
      const a = compile.linesFor(st(id, { [r.id]: -90 }), k, { time: "none" });
      const b = compile.linesFor(st(id, { [r.id]: 90 }), k, { time: "none" });
      for (const l of a) lo.add(l); for (const l of b) hi.add(l);
    }
    for (const l of lo) if (!hi.has(l)) loOnly++;
    for (const l of hi) if (!lo.has(l)) hiOnly++;
    assert.ok(loOnly >= 6 && hiOnly >= 6, `${id}.${r.id}: ${loOnly} low-only, ${hiOnly} high-only`);
  }
  // the knight example from the brief: brooding and chipper share no lines outside the one plain fallback
  const kinds = ["greeting", "done", "error", "goodNews", "badNews"];
  for (const k of kinds) {
    const dark = compile.linesFor(st("knight", { brooding: 90, boast: 0, chivalry: 0 }), k, { time: "none" });
    const bright = compile.linesFor(st("knight", { brooding: -90, boast: 0, chivalry: 0 }), k, { time: "none" });
    assert.ok(dark.filter((l) => bright.includes(l)).length <= 1, `knight.${k}`);
  }
});

test("good news, bad news, jokes, timers and not-understood lines exist for every character", () => {
  for (const id of ALL_IDS) for (const k of [...EXTRA_KINDS, "jokeIntro", "timerDone", "notSure"]) {
    const t = compile.phrase(st(id), k, { name: "Sam", seed: "x", time: "morning" });
    assert.ok(t && t.trim().length > 1, `${id}.${k}`);
    assert.ok(!BANNED.test(t), `${id}.${k}: ${t}`);
  }
});

test("prompt block: riffs and favourite words fit inside the budget, guardrails always kept", () => {
  for (const id of ALL_IDS) {
    const c = byId(id);
    for (const v of [-100, 0, 100]) {
      const b = compile.promptBlock({ ...st(id, Object.fromEntries(c.roles.map((r) => [r.id, v]))), base: { ...neutral(), ...(c.base ?? {}), flavour: 100 } });
      assert.ok(b.length <= compile.PROMPT_BUDGET, `${id}@${v}: ${b.length}`);
      assert.match(b, /no profanity/); assert.match(b, /plain fact first/); assert.match(b, /never impersonate/);
    }
    const b = compile.promptBlock(st(id));
    assert.match(b, /Favourite words:|Pet topics|Jokes:/, `${id}: no riffs or words in the prompt`);
  }
});

test("facts survive every character's styling", () => {
  const replies = ["Your pasta timer is done.", "Your meeting is at 3:30 with the dentist.", "It's 72 degrees, and the total is $45.20.", "Take 2 pills at 8:00 PM."];
  for (const id of ALL_IDS) for (const s of replies) for (const kind of ["reply", "timerDone", "alarm"]) {
    const out = compile.style(st(id), s, { kind, seed: id + s });
    for (const f of factsOf(s)) assert.ok(out.includes(f), `${id}/${kind}: "${s}" → "${out}" lost ${f}`);
  }
});
