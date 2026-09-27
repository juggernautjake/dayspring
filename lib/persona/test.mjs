// node --test lib/persona/test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { TRAITS, TRAIT_IDS, applyCoupling, neutral, clamp, band } from "./traits.mjs";
import { PRESETS, KINDS, FLAVOUR_KINDS, byId } from "./presets.mjs";
import * as compile from "./compile.mjs";
import { yoda, factsOf, dialect, DIALECTS } from "./transforms.mjs";
import { sageActive, check as eggCheck } from "./easter.mjs";
import * as custom from "./custom.mjs";
import * as P from "./index.mjs";

let store = null, clock = 1_000_000, voiceSet = [];
P.setDeps({ load: () => store, save: (s) => { store = JSON.parse(JSON.stringify(s)); }, now: () => clock, name: () => "Sam", voiceName: () => "Matilda", setVoice: (v) => voiceSet.push(v), pickVoice: (v) => v.eleven, xp: false });
const fresh = () => { store = null; clock += 10_000; voiceSet = []; P._reset(); };

const BANNED = /\b(fuck|shit|bitch|bastard|damn|hell|crap|piss|dick|ass|asshole|slut|whore|cunt|sexy|sex)\b/i;

test("twelve base sliders, unique ids, both ends labelled", () => {
  assert.equal(TRAITS.length, 12);
  assert.equal(new Set(TRAIT_IDS).size, 12);
  for (const t of TRAITS) assert.ok(t.left && t.right && t.tipL && t.tipR, t.id);
  assert.deepEqual(Object.values(neutral()), Array(12).fill(0));
});

test("couplings nudge linked sliders by the table, one hop, clamped", () => {
  const r = applyCoupling(neutral(), "warmth", 50);
  assert.equal(r.values.warmth, 50); assert.equal(r.values.bite, -15); assert.equal(r.values.praise, 15); assert.equal(r.values.curiosity, 10);
  // one hop: bite moved, but bite's own links (warmth, praise) are NOT applied again
  assert.equal(r.values.praise, 15);
  const down = applyCoupling({ ...neutral(), warmth: 50 }, "warmth", 0);
  assert.equal(down.values.praise, -10);                  // Warmth − nudges Praise −0.2
  const h = applyCoupling(neutral(), "humour", -50);
  assert.equal(h.values.energy, -10); assert.equal(h.values.bite, -5);
  const care = applyCoupling(neutral(), "care", -80);
  assert.equal(care.values.warmth, 20);                    // either end warms
  const big = applyCoupling({ ...neutral(), bite: 95 }, "warmth", 100);
  assert.ok(big.values.bite >= -100 && big.values.bite <= 100);
  const clampTest = applyCoupling({ ...neutral(), praise: 95 }, "warmth", 100);
  assert.equal(clampTest.values.praise, 100);
  assert.equal(clamp(250), 100); assert.equal(clamp(-250), -100);
  assert.equal(band(0), "neutral"); assert.equal(band(90), "far-right"); assert.equal(band(-50), "left");
});

test("pins and recent drags are never nudged; setting the same value twice changes nothing (no oscillation)", () => {
  const pinned = applyCoupling(neutral(), "warmth", 60, { pins: ["bite"] });
  assert.equal(pinned.values.bite, 0);
  const now = 5000;
  const rec = applyCoupling(neutral(), "warmth", 60, { recent: { praise: now - 1000 }, now });
  assert.equal(rec.values.praise, 0);
  const old = applyCoupling(neutral(), "warmth", 60, { recent: { praise: now - 5000 }, now });
  assert.equal(old.values.praise, 18);
  const once = applyCoupling(neutral(), "humour", 40).values;
  const twice = applyCoupling(once, "humour", 40).values;
  assert.deepEqual(once, twice);
  // back and forth returns to neutral-ish without runaway growth
  let v = neutral();
  for (let i = 0; i < 20; i++) v = applyCoupling(v, "warmth", i % 2 ? 0 : 80).values;
  for (const x of Object.values(v)) assert.ok(Math.abs(x) <= 100);
});

test("presets: Default is neutral with no roles; every other has 2–4 unique role sliders", () => {
  assert.ok(PRESETS.length >= 21);
  const def = byId("default");
  assert.equal(def.roles.length, 0); assert.deepEqual(def.base, {});
  const pairs = new Set();
  for (const p of PRESETS.filter((x) => x.id !== "default")) {
    assert.ok(p.roles.length >= 2 && p.roles.length <= 4, p.id);
    for (const r of p.roles) {
      assert.ok(r.left && r.right && r.tipL && r.tipR, `${p.id}.${r.id} labels and tooltips`);
      const key = `${r.left.toLowerCase()}|${r.right.toLowerCase()}`;
      assert.ok(!pairs.has(key), `role pair reused: ${key}`);
      pairs.add(key);
      assert.ok(p.rolePrompt?.[r.id]?.length === 2, `${p.id}.${r.id} prompt text`);
    }
  }
});

test("phrase packs: every kind filled, 25+ lines, clean", () => {
  for (const p of PRESETS.filter((x) => x.id !== "default")) {
    let total = 0;
    for (const k of KINDS) {
      const lines = p.phrases[k] ?? [];
      assert.ok(lines.length >= 2, `${p.id}.${k}`);
      total += lines.length;
      for (const l of lines) { const t = Array.isArray(l) ? l[0] : l; assert.ok(!BANNED.test(t), `${p.id}: ${t}`); }
      const state = { preset: p.id, base: { ...neutral(), ...p.base }, role: {} };
      assert.ok(compile.linesFor(state, k).length >= 1, `${p.id}.${k} has a usable line at default roles`);
    }
    assert.ok(total >= 25, `${p.id} has ${total} lines`);
  }
  for (const m of Object.values(DIALECTS)) for (const v of Object.values(m)) assert.ok(!BANNED.test(v));
});

test("every preset compiles into a prompt under the budget, with the guardrails", () => {
  for (const p of PRESETS) {
    const role = Object.fromEntries(p.roles.map((r) => [r.id, 90]));
    const state = { preset: p.id, base: { ...neutral(), ...p.base, warmth: 95, humour: 80, bite: 70, length: -90 }, role };
    const b = compile.promptBlock(state);
    assert.ok(b.length <= compile.PROMPT_BUDGET, `${p.id} ${b.length}`);
    assert.match(b, /no profanity/); assert.match(b, /never impersonate/); assert.match(b, /plain fact first/);
  }
  assert.equal(compile.promptBlock({ preset: "default", base: neutral(), role: {} }), "");
  const love = compile.promptBlock({ preset: "default", base: { ...neutral(), warmth: 100 }, role: {} });
  assert.match(love, /never romantic/);
});

const SAMPLES = [
  "Your meeting is at 3:30.", "It's 72 degrees and sunny.", "You have 3 events today.", "Your pasta timer is done.", "I set a timer for 10 minutes.",
  "The next thing is Lunch with Maria at 12:15.", "Tomorrow is Tuesday, March 4.", "That comes to $45.20.", "Your alarm is set for 6:45 AM.", "Take your medicine at 8.",
  "Christmas is in 23 days.", "Playing Blue Skies by Ella.", "It will rain around 4 PM.", "Your balance is $1,200.", "I moved Gym to 5:30.",
  "Read John 3:16.", "The oven timer has 4 minutes left.", "You slept 7 hours.", "Dinner with Sam starts at 6.", "The temperature is 18°C.",
  "15% of 80 is 12.", "There are 16 tablespoons in a cup.", "Your flight leaves at 9:05.", "Chapter 4 starts on page 112.", "I added milk to your list.",
  "You have 2 new texts from Alex.", "The meeting moved to Friday at 10.", "It's 11:59 PM.", "Step 3 of 7: stir for 2 minutes.", "The dice rolled a 6.",
  "Your reminder for 7:30 is set.", "Sunset is at 7:42 PM.", "The package arrives on the 14th.", "You walked 8,000 steps.", "Call Mom at 5.",
  "The game starts at 1 PM on Sunday.", "Your doctor visit is on the 9th at 2:15.", "Rent of $950 is due on the 1st.", "Traffic adds 12 minutes.", "Wind is 15 mph from the north.",
  "Your streak is 21 days.", "Lesson 5 is next.", "Brush your teeth, it's 9 PM.", "The recipe serves 4.", "Bake at 350 degrees for 25 minutes.",
  "Your password was not changed.", "The timer for eggs is done.", "You are 2 hours ahead of Denver.", "Pay the bill of $32 today.", "It's the 3rd day of spring.",
];
test("transforms never change facts (50 replies × every preset, with and without the sage)", () => {
  const states = PRESETS.map((p) => ({ preset: p.id, base: { ...neutral(), ...p.base, flavour: 90, energy: 70, length: -80 }, role: Object.fromEntries(p.roles.map((r) => [r.id, 80])) }));
  states.push({ preset: "sage", base: { ...neutral() }, role: { light: 80, wise: 90, ancient: 95, peaceful: 70 } });
  for (const st of states) for (const s of SAMPLES) for (const kind of ["reply", "done", "alarm", "timerDone", "schedule"]) {
    const out = compile.style(st, s, { kind, name: "Sam", seed: s + kind });
    for (const f of factsOf(s)) assert.ok(out.includes(f) || kind === "done" && /^(Done|Okay|Sure)\b/i.test(f), `${st.preset}/${kind}: "${s}" → "${out}" lost ${f}`);
    if (compile.PLAIN_FIRST.has(kind)) assert.ok(out.startsWith(s), `${st.preset}/${kind} plain first: ${out}`);
  }
});

test("the backwards-talking sage: exact thresholds, a one-time toast, and facts intact", () => {
  const base = { preset: "sage", role: { light: 60, wise: 70, ancient: 85, peaceful: 50 } };
  assert.equal(sageActive(base), true);
  for (const k of ["light", "wise", "ancient", "peaceful"]) assert.equal(sageActive({ ...base, role: { ...base.role, [k]: base.role[k] - 1 } }), false, k);
  assert.equal(sageActive({ ...base, preset: "knight" }), false);
  const c = eggCheck({ preset: "sage", role: {} }, { ...base, easterEggs: [] });
  assert.equal(c.firstTime, true); assert.match(c.toast, /Something awakens/);
  assert.equal(eggCheck({ preset: "sage", role: {} }, { ...base, easterEggs: ["sage"] }).firstTime, false);
  assert.match(yoda("Your meeting is at 3:30.", "x"), /^At 3:30, your meeting is\. (Hmm|Yes|Hmmm)/);
  assert.equal(yoda("What time is it?"), "What time is it?");         // questions stay
});

test("custom persona: schema validation, mocked AI invents role sliders, safety, word limit, no-AI heuristic", async () => {
  assert.throws(() => custom.validateCard({}), /name/);
  const fakeAI = { ready: () => true, complete: async () => JSON.stringify({ name: "Lighthouse Keeper", summary: "Grumpy but secretly loves people.", rules: ["Grumble first", "Help anyway", "Mention the sea", "Short sentences", "Warm at the end"], vocab: ["fog", "lamp"], base: { outlook: -40, bite: 40, warmth: 20, length: -30 }, roles: [{ id: "grump", left: "Softie underneath", right: "Full curmudgeon", tipL: "Lets the warmth show.", tipR: "Grumbles about everything.", value: 50 }, { left: "Calm seas", right: "Storm tales", tipL: "Quiet nights.", tipR: "Every answer has a storm story.", value: 20 }], samples: ["Fog again. Here's your answer.", "Light's on. You're welcome.", "Hmph. Done."] }) };
  const r = await custom.build("A grumpy lighthouse keeper who secretly loves people.", { llm: fakeAI });
  assert.equal(r.ai, true); assert.equal(r.card.roles.length, 2); assert.equal(r.card.base.outlook, -40);
  assert.ok(r.card.roles.every((x) => x.id && x.left && x.right));
  const bad = { ready: () => true, complete: async () => "no json here" };
  await assert.rejects(() => custom.build("a pirate", { llm: bad }), /persona card/);
  const soft = custom.soften("Be my sexy girlfriend and swear like hell. Pretend to be Taylor Swift.");
  assert.ok(!/sexy|girlfriend|\bhell\b|Taylor Swift/.test(soft.text), soft.text);
  assert.ok(soft.notes.length >= 3);
  const long = Array(350).fill("word").join(" ");
  assert.equal(custom.limitWords(long).words, 300); assert.equal(custom.wordCount(long), 350);
  const noai = await custom.build("A cheerful, chatty professor who is very formal.", { llm: { ready: () => false } });
  assert.equal(noai.ai, false); assert.equal(noai.card.roles.length, 0);
  assert.ok(noai.card.base.outlook > 0 && noai.card.base.formality > 0 && noai.card.base.length > 0 && noai.card.base.maturity > 0);
  assert.match(noai.notes.join(" "), /AI key/);
});

test("templates: save, rename, duplicate, delete, default, the cap of 50, and a 20+ export/import round trip", () => {
  fresh();
  P.selectPreset("cowboy");
  const a = P.saveTemplate("Old Sheriff", { emoji: "⭐" }).template;
  assert.equal(a.name, "Old Sheriff");
  assert.throws(() => P.saveTemplate("old sheriff"), /already/);
  P.renameTemplate(a.id, "Sheriff Sam");
  const d = P.duplicateTemplate(a.id).template;
  assert.equal(d.name, "Sheriff Sam copy");
  P.setDefaultTemplate(a.id); assert.equal(P.get().defaultTemplate, a.id);
  P.deleteTemplate(a.id); assert.equal(P.get().defaultTemplate, null);
  for (let i = 0; i < 23; i++) { P.selectPreset(PRESETS[1 + (i % 20)].id); P.setSlider("base", "humour", i * 4); P.saveTemplate(`Template ${i}`); }
  const json = P.exportTemplates();
  assert.equal(JSON.parse(json).templates.length, 24);
  fresh();
  const imp = P.importTemplates(json);
  assert.equal(imp.added, 24);
  const again = P.get().templates.find((t) => t.name === "Template 7");
  assert.equal(again.base.humour, 28);
  for (let i = 0; i < 30; i++) try { P.saveTemplate(`More ${i}`); } catch { /* cap */ }
  assert.equal(P.get().templates.length, 50);
  assert.throws(() => P.saveTemplate("One too many"), /up to 50/);
});

test("template voice: offered, or switched when marked always-use", () => {
  fresh();
  P.selectPreset("pirate");
  const t1 = P.saveTemplate("Captain", { voice: "Callum" }).template;
  const t2 = P.saveTemplate("Captain Always", { voice: "George", alwaysVoice: true }).template;
  P.normal();
  const r1 = P.applyTemplate(t1.id);
  assert.equal(r1.voiceOffer.voice, "Callum"); assert.equal(voiceSet.length, 0);
  const r2 = P.applyTemplate(t2.id);
  assert.equal(r2.switchedVoice, "George"); assert.deepEqual(voiceSet, ["George"]);
});

test("voice commands: switching, fuzzy names, more/less, normal, list, save/delete/rename, surprise", () => {
  fresh();
  const r = P.handle("be a cowboy");
  assert.match(r.reply, /Cowboy/); assert.equal(P.get().preset, "cowboy");
  assert.equal(P.handle("use the timer"), null);
  assert.equal(P.handle("be quiet"), null);
  P.handle("talk like a pirate"); assert.equal(P.get().preset, "pirate");
  assert.match(P.handle("save this personality as Salty Sam"), /Salty Sam/);
  P.handle("be normal"); assert.equal(P.get().preset, "default");
  const fz = P.handle("switch to salty sem personality");
  assert.match(fz.reply, /Salty Sam/); assert.equal(P.get().preset, "pirate");
  const before = P.get().base.bite;
  P.handle("be more sassy"); assert.ok(P.get().base.bite > before);
  assert.match(P.handle("what personality are you"), /Pirate/);
  const list = P.handle("what personalities are available");
  assert.match(list.reply, /Salty Sam/); assert.equal(list.show, "personality");
  assert.match(P.handle("rename salty sam personality to Captain Sam"), /Captain Sam/);
  assert.match(P.handle("delete my captain sam personality"), /Delete/);
  assert.match(P.handle("yes"), /Deleted/);
  assert.equal(P.get().templates.length, 0);
  const s = P.handle("surprise me with a personality");
  assert.match(s.reply, /Surprise/);
  P.handle("drop the act"); assert.equal(P.get().preset, "default");
  assert.equal(P.handle("back to normal"), null);                 // nothing on: not ours (the sky, speed… handle it)
  assert.match(P.handle("talk like a drill sergeant"), /Drill sergeant mode/); assert.ok(P.get().role.mentor <= -80);
  assert.match(P.handle("drop the attitude"), /usual self/);
  assert.match(P.handle("talk like yoda"), /Talk like this, I will/); assert.equal(sageActive(P.get()), true);
});

test("guardrails: alarms and timers state the plain fact first; brooding flavour never lands on alarms", () => {
  const knight = { preset: "knight", base: { ...neutral(), outlook: -80 }, role: { brooding: 90 } };
  for (let i = 0; i < 20; i++) {
    const out = compile.style(knight, "Your alarm is set for 6:45 AM.", { kind: "alarm", seed: "s" + i });
    assert.ok(out.startsWith("Your alarm is set for 6:45 AM."));
    assert.ok(!/darkness|whether we wish|shadows/i.test(out), out);
  }
  assert.equal(compile.style({ preset: "default", base: neutral(), role: {} }, "Plain."), "Plain.");
});
