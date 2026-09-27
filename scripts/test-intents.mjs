// Dayspring without AI: does it understand people? (no server, no network, nothing heard or said)
//   golden set: hand-written phrasings + everyday variations (≥1200) → top-1 ≥ 90%, top-7 ≥ 98%, per family
//   negatives (look-alikes that must not be confused), exact actions and details (dry run), the detail parsers,
//   speed (< 20 ms a request), and the conversations: picking from the list, "None of these", the help link after
//   repeated misses, learning a pick, confirmations, the timer's "What's it for?", knock-knock, counting, joke offers.
//   node scripts/test-intents.mjs [--verbose] [--family=timers]
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "ds-intents-"));
Object.assign(process.env, {
  DAYSPRING_TIMERS_FILE: join(TMP, "timers.json"), DAYSPRING_RECIPES_FILE: join(TMP, "recipes.json"), DAYSPRING_LISTS_FILE: join(TMP, "lists.json"),
  DAYSPRING_INTENT_LEARNED: join(TMP, "learned.json"), DAYSPRING_JOKES_TOLD: join(TMP, "jokes-told.json"), DAYSPRING_JOKE_OFFERS: join(TMP, "offers.json"),
  DAYSPRING_RECIPE_IMAGES: join(TMP, "img"), DAYSPRING_NO_BROWSER: "1", DAYSPRING_SETTINGS_FILE: join(TMP, "settings.json"),
});
const imp = (p) => import(pathToFileURL(join(DESK, p)).href);
const { GOLDEN_TEXT, NEGATIVES, ACTIONS } = await imp("scripts/qa/intents-golden.mjs");
// the personality lives in owner.json: here it lives in memory
const persona = await imp("lib/persona/index.mjs");
let personaState = null;
persona.setDeps({ save: (p) => { personaState = p; }, load: () => personaState });
const I = await imp("lib/intents/index.mjs");
const slots = await imp("lib/intents/slots.mjs");
const { INTENTS } = await imp("lib/intents/catalog.mjs");
const VERBOSE = process.argv.includes("--verbose");
const ONLY = (process.argv.find((a) => a.startsWith("--family=")) ?? "").slice(9);

let pass = 0, fail = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; if (!ok || VERBOSE) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" ? "  (" + got + ")" : ""}`); };

// ---------------- golden set ----------------
const STATE = { cooking: { cooking: true }, results: { recipeResults: true }, ringing: { ringing: true, timers: true }, timers: { timers: true } };
const base = [];
for (const line of GOLDEN_TEXT.split("\n").map((l) => l.trim()).filter(Boolean)) {
  const m = /^(?:\[(\w+)\]\s*)?([\w.]+):\s*(.+)$/.exec(line);
  if (!m) throw new Error("bad golden line: " + line);
  for (const p of m[3].split("|").map((x) => x.trim()).filter(Boolean)) base.push({ text: p, id: m[2], state: STATE[m[1]] ?? {} });
}
// everyday variations: a wake word or "can you" in front, "please" after, one small slip in the longest plain word
const SLOT_WORD = /\d|minute|second|hour|am$|pm$|day$|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|june|july|august|september|october|november|december|christmas|easter/;
function typo(text, k) {
  const words = text.split(" ");
  const i = words.map((w, j) => [w, j]).filter(([w]) => w.length >= 6 && /^[a-z]+$/.test(w) && !SLOT_WORD.test(w)).sort((a, b) => b[0].length - a[0].length)[0]?.[1];
  if (i == null) return null;
  const w = words[i], p = 1 + (k % (w.length - 3));
  words[i] = w.slice(0, p) + w[p + 1] + w[p] + w.slice(p + 2);        // two letters swapped
  return words.join(" ");
}
const PRE = ["hey dayspring ", "dayspring, ", "can you ", "could you please ", "ok dayspring "], POST = [" please", " for me", " thanks", "?", " now"];
const cases = [];
base.forEach((b, k) => {
  cases.push({ ...b, kind: "base" });
  const safePre = !/^(knock|hello|hi|hey|yo|howdy|good|thank|thanks|next|lap|undo|repeat|skip|pause|resume|continue|number|the |okay|ok )/.test(b.text);
  if (safePre) cases.push({ ...b, text: PRE[k % PRE.length] + b.text, kind: "prefix" });
  else cases.push({ ...b, text: b.text + "?", kind: "punct" });
  const t = typo(b.text, k);
  if (t) cases.push({ ...b, text: t, kind: "typo" });
  else cases.push({ ...b, text: b.text + POST[k % POST.length], kind: "suffix" });
});
const fam = new Map(INTENTS.map((i) => [i.id, i.cat]));
for (const c of cases) if (!fam.has(c.id)) throw new Error(`golden set names an unknown intent: ${c.id}`);
const byFam = new Map();
I.stats();                 // (the index is built once, at startup; not counted)
let top1 = 0, top7 = 0, n = 0, slow = 0, maxMs = 0; const times = [];
const misses = [];
for (const c of cases) {
  const f = fam.get(c.id);
  if (ONLY && f !== ONLY) continue;
  const t0 = performance.now();
  const p = I.plan(c.text, c.state);
  const ms = performance.now() - t0; maxMs = Math.max(maxMs, ms); if (ms > 20) slow++; times.push(ms);
  const ids = p.ranked.map((r) => r.id);
  const ok1 = ids[0] === c.id, ok7 = ids.includes(c.id);
  n++; top1 += ok1; top7 += ok7;
  const s = byFam.get(f) ?? { n: 0, t1: 0, t7: 0 }; s.n++; s.t1 += ok1; s.t7 += ok7; byFam.set(f, s);
  if (!ok1) misses.push(`${c.id.padEnd(18)} ${ok7 ? "(top7)" : "(MISS)"} "${c.text}" → ${ids.slice(0, 3).map((x, i) => `${x}:${p.ranked[i].score.toFixed(2)}`).join(", ")}`);
}
console.log(`\nGolden set: ${n} requests (${base.length} written by hand + variations), ${INTENTS.length} intents, ${I.stats().phrasings} phrasings`);
console.log(`  top-1 ${(100 * top1 / n).toFixed(1)}%   top-7 ${(100 * top7 / n).toFixed(1)}%   slowest ${maxMs.toFixed(1)} ms (${slow} over 20 ms)`);
for (const [f, s] of [...byFam].sort()) console.log(`  ${f.padEnd(10)} ${String(s.n).padStart(4)}   top-1 ${(100 * s.t1 / s.n).toFixed(1).padStart(5)}%   top-7 ${(100 * s.t7 / s.n).toFixed(1).padStart(5)}%`);
if (VERBOSE || misses.length < 80) for (const m of misses) console.log("   miss " + m);
if (!ONLY) {
  check("golden set has at least 1200 requests", n >= 1200, n);
  check("top-1 accuracy ≥ 90%", top1 / n >= 0.9, (100 * top1 / n).toFixed(1) + "%");
  check("top-7 accuracy ≥ 98%", top7 / n >= 0.98, (100 * top7 / n).toFixed(1) + "%");
  check("every family ≥ 80% top-1", [...byFam.values()].every((s) => s.t1 / s.n >= 0.8), [...byFam].filter(([, s]) => s.t1 / s.n < 0.8).map(([f]) => f).join(", "));
  times.sort((a, b) => a - b); const p50 = times[Math.floor(times.length / 2)], p99 = times[Math.floor(times.length * 0.99)];
  console.log(`  speed: median ${p50.toFixed(2)} ms, 99th percentile ${p99.toFixed(2)} ms, ${slow} over 20 ms (garbage collection pauses)`);
  check("99% of requests under 20 ms, median under 5 ms", p99 < 20 && p50 < 5, `p50 ${p50.toFixed(1)} p99 ${p99.toFixed(1)}`);
}
if (ONLY) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }

// ---------------- look-alikes ----------------
for (const [text, want, notWant, state] of NEGATIVES) {
  const p = I.plan(text, state);
  check(`"${text}" is ${want}, not ${notWant}`, p.intent === want, p.intent);
}
// ---------------- actions (dry run) ----------------
for (const [text, want, state] of ACTIONS) {
  const p = I.plan(text, state ?? {});
  const got = p.action ?? {};
  const ok = Object.entries(want).every(([k, v]) => JSON.stringify(got[k]) === JSON.stringify(v));
  check(`action: "${text}" → ${JSON.stringify(want)}`, ok, JSON.stringify(got));
}
// every intent plans something runnable for its own example (the personality's own commands are lib/persona's: it answers them first)
for (const it of INTENTS.filter((x) => x.cat !== "personality")) {
  const p = I.plan(it.ex, { cooking: it.cat === "cooking", recipeResults: it.id === "recipe.pick" || it.id === "recipe.more", timers: it.cat === "timers", ringing: it.id === "timer.dismiss" });
  check(`${it.id}: its own example "${it.ex}" plans an action`, p.intent === it.id && p.action?.do && p.action.do !== "error", `${p.intent} ${JSON.stringify(p.action)}`);
}

// ---------------- the detail parsers ----------------
const NOW = new Date(2026, 8, 26, 14, 30);      // Saturday 26 September 2026, 2:30 pm
const d = (q) => slots.duration(q)?.ms;
check("duration: 10 minutes", d("10 minutes") === 600000);
check("duration: 1.5 hours", d("1.5 hours") === 5400000);
check("duration: 1 hour 20 minutes", d("1 hour 20 minutes") === 4800000);
check("duration: 90 seconds", d("90 seconds") === 90000);
check("duration: 2 and a half minutes", d(I.prepare("two and a half minutes").q) === 150000, d(I.prepare("two and a half minutes").q));
check("duration: half an hour", d(I.prepare("half an hour").q) === 1800000);
const tm = (q) => slots.time(q)?.hm;
check("time: at 3 → 15:00", tm("at 3") === "15:00");
check("time: 7am", tm("7am") === "07:00");
check("time: 6:30 pm", tm("6:30 pm") === "18:30");
check("time: noon / midnight", tm("at noon") === "12:00" && tm("at midnight") === "00:00");
check("time: quarter past 4", tm("quarter past 4") === "16:15", tm("quarter past 4"));
check("time: half past 7 am", tm("half past 7 am") === "07:30", tm("half past 7 am"));
check("time: a bare number isn't a time", tm("add 3 eggs") == null);
const dt = (q) => slots.date(q, NOW)?.iso;
check("date: tomorrow", dt("tomorrow") === "2026-09-27");
check("date: friday (the next one)", dt("on friday") === "2026-10-02", dt("on friday"));
check("date: next week", Boolean(dt("next week")));
check("date: october 3rd", dt("october 3rd") === "2026-10-03");
check("date: 12/25", dt("12/25") === "2026-12-25");
check("date: in 3 days", dt("in 3 days") === "2026-09-29");
check("date: christmas", dt("christmas") === "2026-12-25", dt("christmas"));
check("date: thanksgiving 2026 is the 26th", dt("thanksgiving") === "2026-11-26", dt("thanksgiving"));
const sc = (q) => slots.scripture(q)?.ref;
check("scripture: john 3 16", sc("john 3 16") === "John 3:16", sc("john 3 16"));
check("scripture: first corinthians 13", /^1 Corinthians 13/.test(sc("1st corinthians 13") ?? ""), sc("1st corinthians 13"));
check("scripture: psalm 23", /^Psalms? 23$/.test(sc("psalm 23") ?? ""), sc("psalm 23"));
check("scripture: 'what is 12' isn't Isaiah", sc("what is 12 times 4") == null);
check("version: english standard version", slots.version("read it in the english standard version")?.id === "esv");
check("version: king james", slots.version("the king james")?.id === "kjv");
check("normalize: number words", I.prepare("set a timer for twenty five minutes").slots.duration?.ms === 1500000);

// ---------------- speed ----------------
{
  const texts = cases.slice(0, 400).map((c) => c.text);
  const t0 = performance.now(); for (const t of texts) I.plan(t); const avg = (performance.now() - t0) / texts.length;
  check("average under 5 ms a request", avg < 5, avg.toFixed(2) + " ms");
}

// ---------------- conversations ----------------
I._resetState();
const say = async (t, o = {}) => (await I.early(t, { surface: "t", ...o })) ?? (await I.fallback(t, { surface: "t", ...o }));
{
  const r = await say("florp my timers");
  check("unclear: a numbered list, 'Here's what I can do that sounds close:'", r.suggest?.prompt === "Here's what I can do that sounds close:" && r.suggest.options.length >= 1 && r.suggest.options.length <= 7 && r.suggest.none === "None of these", JSON.stringify(r.suggest?.options?.map((o) => o.label)));
  check("unclear: the voice reads at most three", (r.reply.match(/\d, /g) ?? []).length <= 3, r.reply);
  const want = r.suggest.options.findIndex((o) => o.id === "timer.list") + 1 || 1;
  const r2 = await say(want === 1 ? "the first one" : `number ${want}`);
  check("pick by number/ordinal runs it", Boolean(r2.intent) && !r2.suggest, JSON.stringify(r2).slice(0, 120));
  const r3 = await say("florp my timers");
  check("learned: the same words next time go straight there", !r3.suggest && r3.intent === r2.intent, r3.intent);
  I.forgetLearned();
  const r4 = await say("florp my timers");
  check("forget what you learned: back to the list", Boolean(r4.suggest));
  const r5 = await say("none of these");
  check("'None of these' → the limited-without-AI apology", /my responses are limited without an AI voice integration/.test(r5.reply), r5.reply);
}
{
  I._resetState();
  const a = await say("xqzv blorp");
  const b = await say("wibble wobble zork");
  const c = await say("qqq zzz vvv");
  check("misses: 1st and 2nd apologise", /limited without/i.test(a.reply) && /limited without|another way/i.test(b.reply), `${a.reply} / ${b.reply}`);
  check("misses: 3rd in a row points to adding AI, with a link", /hard time understanding/.test(c.reply) && /\/help/.test(c.link?.url ?? ""), `${c.reply} ${JSON.stringify(c.link)}`);
}
{
  I._resetState();
  const timers = await imp("lib/timers.mjs"); timers._reset();
  const a = await say("set a timer for 10 minutes");
  check("timer with no purpose: starts, then 'What's it for?'", /Got it, 10 minutes\. What's it for\?/.test(a.reply) && timers.list().length === 1, a.reply);
  const b = await say("it's for the pasta");
  check("the answer becomes its name (\"it's for the\" dropped)", timers.list()[0]?.label === "pasta", timers.list()[0]?.label);
  const c = await say("set a timer for 5 minutes");
  const e = await say("nothing");
  check("'nothing' → 'Timer 2'-style automatic name", /^Timer \d$/.test(timers.list().at(-1)?.label ?? ""), timers.list().at(-1)?.label);
  const f = await say("set a pasta timer for 3 minutes");
  check("a second pasta → 'pasta 2' and no question", timers.list().some((t) => t.label === "pasta 2") && !/What's it for/.test(f.reply), f.reply);
  const g = await say("what timers do i have");
  check("listing: 'You have three: pasta, … left; …'", /^You have 3: pasta, .+; .+; .+\.$/.test(g.reply), g.reply);
  for (let k = 0; k < 4; k++) await say(`set a timer for ${k + 1} minutes called t${k}`);
  const h = await say("set a timer for 9 minutes");
  check("the 8th timer: 'already have 7' and asks which to cancel", /already have 7 timers/.test(h.reply) && timers.list().length === 7, h.reply);
  timers._reset();
  void c; void b;
}
{
  I._resetState();
  const r = await say("delete my rice recipe");
  check("risky: asks first", /Just to check/.test(r.reply), r.reply);
  const r2 = await say("no");
  check("risky: 'no' leaves it alone", /left it alone/.test(r2.reply), r2.reply);
}
{
  I._resetState();
  const k1 = await say("knock knock");
  const k2 = await say("lettuce");
  const k3 = await say("lettuce who");
  check("their knock-knock: Who's there? → Lettuce who? → a laugh", k1.reply === "Who's there?" && /^Lettuce who\?$/.test(k2.reply) && /ha/i.test(k3.reply), `${k1.reply} / ${k2.reply} / ${k3.reply}`);
  const m1 = await say("tell me a knock knock joke");
  const m2 = await say("whose there");
  check("my knock-knock: Knock knock. → (fuzzy 'whose there') → the name", /Knock knock\.$/.test(m1.reply) && m2.joke?.stage === 2, `${m1.reply} / ${m2.reply}`);
  const m3 = await say(`${m2.reply.replace(/\.$/, "")} who`);
  check("… → the punchline", m3.reply === m1.joke.punchline, m3.reply);
  const t = await say("tell me a knock knock joke", { typed: true });
  check("typed: the whole knock-knock at once", /Knock knock\. Who's there\? .+ who\? /.test(t.reply), t.reply);
  const q = await say("tell me an animal joke");
  check("a joke about animals comes from lib/jokes", Boolean(q.joke), q.reply);
  const u = await say("tell me a joke about zorbles");
  check("unknown kind → a joke anyway, with a note", /I don't know any zorbles jokes, but here's one/.test(u.reply), u.reply);
  I._resetState();
}
{
  const c = await say("count to 12");
  check("count to 12: 1 … 12, with numbers for the screen", c.count?.numbers?.length === 12 && c.count.numbers[11] === 12, c.reply);
  const c2 = await say("count to 500");
  check("count above 100 → 'I can count up to 100. Want me to count to 100?'", c2.reply === "I can count up to 100. Want me to count to 100?", c2.reply);
  const c3 = await say("yes");
  check("… yes → counts to 100", c3.count?.numbers?.length === 100, c3.reply?.slice(0, 40));
  const c4 = await say("count backwards from 10");
  check("count backwards from 10 → 10 … 1", JSON.stringify(c4.count?.numbers) === JSON.stringify([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]), c4.reply);
  const c5 = await say("count by fives to 30");
  check("count by fives", JSON.stringify(c5.count?.numbers) === JSON.stringify([5, 10, 15, 20, 25, 30]) || JSON.stringify(c5.count?.numbers) === JSON.stringify([0, 5, 10, 15, 20, 25, 30]), c5.reply);
  const c6 = await say("count from five to eight");
  check("count from five to eight (words)", JSON.stringify(c6.count?.numbers) === JSON.stringify([5, 6, 7, 8]), c6.reply);
}
{
  // joke offers (Funny personality), with a fake clock
  const settings = await imp("lib/settings.mjs");
  const before = settings.get();
  const envOK = { lastActivity: Date.now() - 60_000, random: () => 0 };
  I.setDeps({ now: () => new Date(2026, 8, 26, 14, 0) });
  persona.normal();
  check("offers: never with the Normal personality", I.jokeOfferDue(envOK) === false);
  persona.setSlider("base", "humour", 75);
  settings.set({ jokeOffers: 3, jokeOffersOn: true });
  check("offers: Humour 75, someone around, mid-afternoon → yes", I.jokeOfferDue(envOK) === true);
  check("offers: not on a call / cooking / timer ringing / morning / meeting", [{ inCall: true }, { cooking: true }, { timerRinging: true }, { morning: true }, { meeting: true }, { muted: true }, { textOnly: true }].every((x) => I.jokeOfferDue({ ...envOK, ...x }) === false));
  check("offers: nobody around for 45 minutes → no", I.jokeOfferDue({ ...envOK, lastActivity: Date.now() - 46 * 60_000 }) === false);
  I.setDeps({ now: () => new Date(2026, 8, 26, 21, 0) });
  check("offers: not after 8:30 pm", I.jokeOfferDue(envOK) === false);
  I.setDeps({ now: () => new Date(2026, 8, 26, 14, 0) });
  const line = I.makeJokeOffer("t");
  check("offers: asked (and counted)", /joke/i.test(line) && I.offersToday() === 1, line);
  check("offers: at least 2 hours apart", I.jokeOfferDue(envOK) === false);
  const yes = await say("sure");
  check("offers: yes → a joke", Boolean(yes.joke), yes.reply);
  I.makeJokeOffer("t");
  const no = await say("no thanks");
  check("offers: no → 'Okay!'", no.reply === "Okay!", no.reply);
  const stop = await say("stop asking me about jokes");
  check("'stop asking me about jokes' → offers off, said once", settings.get().jokeOffersOn === false && /stop asking about jokes/.test(stop.reply), stop.reply);
  persona.normal();
  settings.set({ jokeOffers: before.jokeOffers ?? 3, jokeOffersOn: before.jokeOffersOn ?? true });
  I.setDeps({ now: () => new Date() });
}

rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
