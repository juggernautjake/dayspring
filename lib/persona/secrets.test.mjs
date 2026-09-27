// node --test lib/persona/secrets.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { SECRETS, phraseUnlock, comboUnlock } from "./secrets.mjs";
import { PRESETS, KINDS } from "./presets.mjs";
import { neutral } from "./traits.mjs";
import * as compile from "./compile.mjs";
import { factsOf } from "./transforms.mjs";
import { haiku, limerick, lineSyllables, syllables, rhymesA, applyStyle } from "./secret-styles.mjs";
import * as P from "./index.mjs";
import { GOLDEN_TEXT } from "../../scripts/qa/intents-golden.mjs";

let store = null, clock = Date.parse("2026-09-26T15:00:00"), found = [];
P.setDeps({ load: () => store, save: (s) => { store = JSON.parse(JSON.stringify(s)); }, now: () => clock, name: () => "Sam", xp: false });
P.onDiscover((d) => found.push(d));
const fresh = () => { store = null; found = []; P._reset(); };
const BANNED = /\b(fuck|shit|bitch|bastard|damn|hell|crap|piss|dick|ass|asshole|slut|whore|sexy|sex|kill|blood|gore)\b/i;

test("at least 12 secrets; unique ids; unique role pairs across ALL characters; hints and reveals", () => {
  assert.ok(SECRETS.length >= 12);
  const ids = new Set([...PRESETS.map((p) => p.id), ...SECRETS.map((s) => s.id)]);
  assert.equal(ids.size, PRESETS.length + SECRETS.length);
  const pairs = new Set(PRESETS.flatMap((p) => p.roles.map((r) => `${r.left}|${r.right}`.toLowerCase())));
  for (const s of SECRETS) {
    assert.ok(s.hint && s.reveal && s.icon && s.blurb && s.style, s.id);
    assert.ok(s.roles.length >= 2 && s.roles.length <= 4, s.id);
    for (const r of s.roles) { const k = `${r.left}|${r.right}`.toLowerCase(); assert.ok(!pairs.has(k), `role pair reused: ${k}`); pairs.add(k); assert.ok(r.tipL && r.tipR && s.rolePrompt[r.id]?.length === 2); }
    assert.ok(s.unlock.length >= 1 && s.unlock.length <= 3, s.id);
  }
});

test("phrase packs: 25+ lines, every kind, no banned words", () => {
  for (const s of SECRETS) {
    let n = 0;
    for (const k of KINDS) { const l = s.phrases[k] ?? []; assert.ok(l.length >= 2, `${s.id}.${k}`); n += l.length; for (const x of l) assert.ok(!BANNED.test(Array.isArray(x) ? x[0] : x), `${s.id}: ${x}`); }
    assert.ok(n >= 25, `${s.id} ${n}`);
    for (const t of [s.prompt, s.blurb, s.reveal, s.hint]) assert.ok(!BANNED.test(t), `${s.id}: ${t}`);
  }
});

test("every secret's phrase trigger unlocks it", () => {
  const says = { caveman: "talk like a caveman", haiku: "speak in haiku", narrator: "narrate my day", sportscaster: "give me the play by play", gangster: "hey wise guy", alien: "take me to your leader", soap: "don't be so dramatic", cat: "meow", dog: "who's a good boy", gps: "where am I going", radio: "we interrupt this program", viking: "by the hammer", madsci: "it's alive", sloth: "talk like a sloth", limerick: "speak in limericks" };
  for (const s of SECRETS) { assert.ok(says[s.id], `no test phrase for ${s.id}`); assert.equal(phraseUnlock(says[s.id]), s.id, says[s.id]); assert.equal(phraseUnlock("Hey Dayspring, " + says[s.id] + "!"), s.id); }
});

test("slider combinations unlock their secrets (and near-misses don't)", () => {
  const S = (preset, base = {}, role = {}) => ({ preset, base: { ...neutral(), ...base }, role });
  assert.equal(comboUnlock(S("default", { maturity: -95, formality: -95, length: -85 })), "caveman");
  assert.equal(comboUnlock(S("default", { maturity: -80, formality: -95, length: -85 })), null);
  assert.equal(comboUnlock(S("bard", { length: -100 }, { rhyme: 0, comic: 0 })), "haiku");
  assert.equal(comboUnlock(S("bard", {}, { rhyme: 100, comic: 100 })), "limerick");
  assert.equal(comboUnlock(S("robot", { maturity: 100 }, { feel: -100 })), "madsci");
  assert.equal(comboUnlock(S("groovy", { energy: -100 }, { farout: -100 })), "sloth");
  assert.equal(comboUnlock(S("knight", {}, { boast: 100, chivalry: -100 })), "viking");
  assert.equal(comboUnlock(S("detective", {}, { softie: -100, narrate: 100 })), "gangster");
  assert.equal(comboUnlock(S("monk", {}, { parables: 100, koan: -100 })), "narrator");
  assert.equal(comboUnlock(S("maiden", { outlook: -90 }, { adventure: -100 })), "soap");
  assert.equal(comboUnlock(S("default", { energy: -95, warmth: -90, bite: 70 })), "cat");
  assert.equal(comboUnlock(S("default", { energy: 100, warmth: 100, praise: 95 })), "dog");
  // every preset at its own defaults unlocks nothing
  for (const p of PRESETS) assert.equal(comboUnlock(S(p.id, p.base, Object.fromEntries(p.roles.map((r) => [r.id, r.def ?? 0])))), null, p.id);
});

test("event unlocks: 10 jokes in a sitting, 7 timers at once, 3 late nights", () => {
  fresh();
  for (let i = 0; i < 9; i++) assert.equal(P.event("joke"), null);
  assert.equal(P.event("joke").id, "sportscaster");
  assert.equal(P.event("timers", { active: 6 }), null);
  assert.equal(P.event("timers", { active: 7 }).id, "madsci");
  for (const d of ["2026-09-27T01:10:00", "2026-09-27T02:30:00", "2026-09-28T00:20:00"]) { clock = Date.parse(d); P.event("use"); }
  assert.equal(P.get().discovered.radio, undefined);
  clock = Date.parse("2026-09-29T03:05:00");
  assert.equal(P.event("use").id, "radio");
  clock = Date.parse("2026-09-26T15:00:00");
});

test("the golden phrases never trigger a secret", () => {
  const lines = GOLDEN_TEXT.split("\n").map((l) => l.replace(/^\[[a-z]+\]\s*/, "")).filter((l) => /^[\w.]+:/.test(l));
  let n = 0;
  for (const l of lines) {
    const id = l.slice(0, l.indexOf(":"));
    if (/^(personality|persona|joke)/.test(id)) continue;              // asking for a character on purpose is allowed to match
    for (const ph of l.slice(l.indexOf(":") + 1).split("|").map((x) => x.trim()).filter(Boolean)) { n++; assert.equal(phraseUnlock(ph), null, `"${ph}" (${id}) triggered a secret`); }
  }
  assert.ok(n > 500, `only ${n} golden phrases checked`);
});

test("discovery: announced once, gallery unlocks, usable afterwards, reset locks again", () => {
  fresh();
  assert.throws(() => P.selectPreset("cat"), /still a secret/);
  let v = P.view().secrets;
  assert.equal(v.found, 0); assert.ok(v.list.every((x) => x.locked && x.hint && !x.name));
  const r = P.handle("meow");
  assert.match(r.reply, /Secret character discovered: The Cat/); assert.equal(r.show, "discovered:cat");
  assert.equal(found.length, 1); assert.equal(P.get().preset, "cat");
  const again = P.handle("meow");
  assert.doesNotMatch(again.reply, /discovered/); assert.equal(found.length, 1);
  v = P.view().secrets;
  assert.equal(v.found, 1); assert.equal(v.list.find((x) => x.id === "cat").locked, false);
  P.normal(); P.selectPreset("cat"); assert.equal(P.get().preset, "cat");
  P.normal(); assert.match(P.handle("switch to the cat personality").reply, /Cat/);
  assert.match(P.handle("what secret characters have i found").reply, /1 of 15/);
  assert.ok(P.handle("give me a hint for a secret character").length > 10);
  P.setRevealHints(true); assert.ok(P.view().secrets.list.find((x) => x.locked).clue);
  P.resetDiscoveries(); assert.equal(P.view().secrets.found, 0); assert.equal(P.get().preset, "default");
  // slider-found secrets are announced through onDiscover, once
  found = [];
  P.selectPreset("bard"); P.setSlider("role", "rhyme", 100); const d = P.setSlider("role", "comic", 100);
  assert.equal(d.discovered.id, "limerick"); assert.equal(found.length, 1);
  P.setSlider("role", "comic", 99); P.setSlider("role", "comic", 100); assert.equal(found.length, 1);
});

const SAMPLES = ["Your meeting is at 3:30.", "It's 72 degrees and sunny.", "You have 3 events today.", "I set a timer for 10 minutes.", "The next thing is Lunch with Maria at 12:15.", "That comes to $45.20.", "Your alarm is set for 6:45 AM.", "Christmas is in 23 days.", "Read John 3:16.", "Bake at 350 degrees for 25 minutes.", "Dinner with Sam starts at 6.", "Step 3 of 7: stir for 2 minutes."];
test("every secret's style keeps the facts (and alarms stay plain first)", () => {
  for (const s of SECRETS) {
    const st = { preset: s.id, base: { ...neutral(), ...s.base }, role: Object.fromEntries(s.roles.map((r) => [r.id, 80])) };
    for (const t of SAMPLES) for (const kind of ["reply", "done", "alarm", "timerDone"]) {
      const out = compile.style(st, t, { kind, name: "Sam", seed: t + kind });
      for (const f of factsOf(t)) assert.ok(out.includes(f), `${s.id}/${kind}: "${t}" → "${out}" lost ${f}`);
      if (kind === "alarm" || kind === "timerDone") assert.ok(out.startsWith(t), `${s.id} ${kind}: ${out}`);
    }
  }
});

test("haiku: 5-7-5 when it fits, plain when it can't", () => {
  assert.equal(syllables("timer"), 2); assert.equal(syllables("the"), 1);
  for (const t of ["Your meeting is at 3:30.", "It is done.", "The timer for eggs is done.", "Good morning, Sam."]) {
    const h = haiku(t, "x");
    const lines = h.split(" / ");
    assert.equal(lines.length, 3, h);
    assert.deepEqual(lines.map(lineSyllables), [5, 7, 5], h);
    for (const f of factsOf(t)) assert.ok(h.includes(f));
  }
  const long = "Tomorrow you have a dentist appointment at 3 and then a long meeting with the whole team after that.";
  assert.equal(haiku(long), long);
});

test("limerick: five lines with rhyming A-lines when short, plain when long", () => {
  const l = limerick("Your pasta timer is done.", "y");
  assert.equal(l.split(" / ").length, 5); assert.ok(rhymesA(l), l); assert.ok(l.includes("pasta timer") && l.includes("is done."));
  const long = Array(30).fill("word").join(" ");
  assert.equal(limerick(long), long);
  assert.equal(applyStyle("nope", "x"), "x");
});

test("discoveries are their own notification kind; Off makes them visual only", async () => {
  const quiet = await import("../quiet.mjs");
  assert.equal(quiet.kindOf({ kind: "discovery" }), "discoveries");
  assert.equal(quiet.modeFor("discoveries", { mode: "voice", listenState: "off", notify: {} }), "silent");
  assert.equal(quiet.modeFor("discoveries", { mode: "voice", listenState: "active", notify: { discoveries: "chime" } }), "chime");
});

test("XP: found secrets cost XP to unlock; built-ins stay free; voice unlock asks first", () => {
  fresh();
  let bal = 1000; const spent = [];
  const fakeXp = { balance: () => bal, priceFor: (kind, id, { nth }) => (kind === "character" ? 600 + (nth - 1) * 100 : 0), spend: (amount, { reason, ref }) => { if (amount > bal) return { ok: false, short: amount - bal }; bal -= amount; spent.push({ amount, reason, ref }); return { ok: true, balance: bal }; } };
  P.setDeps({ xp: fakeXp });
  try {
    const r = P.handle("meow");
    assert.match(r.reply, /discovered: The Cat/); assert.match(r.reply, /600 XP/); assert.equal(P.get().preset, "default");
    assert.throws(() => P.selectPreset("cat"), /Unlock The Cat with XP first/);
    let row = P.secrets.list().find((x) => x.id === "cat");
    assert.deepEqual({ d: row.discovered, u: row.unlocked, c: row.cost }, { d: true, u: false, c: 600 });
    assert.equal(P.secrets.list().find((x) => x.id === "dog").discovered, false);
    assert.match(P.handle("unlock the cat"), /Unlock The Cat for 600 XP\? You have 1000/);
    const unlocks = []; const off = P.onUnlock((u) => unlocks.push(u));
    assert.match(P.handle("yes"), /Unlocked The Cat/);
    off();
    assert.equal(bal, 400); assert.equal(spent[0].ref, "character:cat"); assert.equal(unlocks.length, 1); assert.match(unlocks[0].text, /🔓 Unlocked: The Cat/);
    row = P.secrets.list().find((x) => x.id === "cat"); assert.equal(row.unlocked, true);
    P.selectPreset("cat"); assert.equal(P.get().preset, "cat");
    // the next one is pricier (nth), and too expensive now
    P.handle("who's a good boy");
    assert.equal(P.secrets.list().find((x) => x.id === "dog").cost, 700);
    assert.match(P.handle("unlock the dog"), /costs 700 XP, and you have 400/);
    const r2 = P.secrets.unlock("dog"); assert.equal(r2.ok, false); assert.equal(r2.short, 300);
    // built-ins stay free
    P.selectPreset("pirate"); assert.equal(P.get().preset, "pirate"); assert.equal(bal, 400);
    // reset keeps what was paid for
    P.resetDiscoveries(); assert.equal(P.get().unlocked.cat.cost, 600); assert.ok(P.secrets.list().find((x) => x.id === "cat").discovered, "a paid-for character stays found");
  } finally { P.setDeps({ xp: false }); }
});
