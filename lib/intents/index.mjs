// Understanding requests without AI, and the little conversations that go with them.
//   early(text, opts)    before anything else: answers to Dayspring's own questions (a pick from the list, "what's the timer
//                        for?", yes/no to a risky change, knock-knock, cooking steps, a recipe choice), and instant things
//                        (timers, math, the time) that never need AI
//   fallback(text, opts) when there's no AI (or it failed): the closest match runs, or the top 7 are offered with
//                        "None of these"; repeated misses point to the page about adding AI
//   plan(text, state)    dry run: which intent and which action (tests)
import { INTENTS } from "./catalog.mjs";
import { CRISIS_RE } from "./catalog-more.mjs";
import { rank, prepare, build, stats } from "./match.mjs";
import { sayDuration, sayTime, sayDate, HOLIDAYS, isoOf, duration as findDuration, time as findTime, date as findDate } from "./slots.mjs";
import { normalize, lev } from "./text.mjs";
import * as timers from "../timers.mjs";
import * as recipes from "../recipes.mjs";
import * as everyday from "../everyday.mjs";
import * as notes from "../notes.mjs";
import * as store from "../store.mjs";
import * as settings from "../settings.mjs";
import * as bible from "../bible.mjs";
import * as recur from "../recur.mjs";
import * as persona from "../persona/index.mjs";
import { phraseUnlock as secretPhrase } from "../persona/secrets.mjs";
import * as ref from "../reference.mjs";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LEARN_FILE = () => process.env.DAYSPRING_INTENT_LEARNED || join(ROOT, "data", "intent-learned.json");
const RUN = 0.70, MARGIN = 0.07, SUGGEST = 0.26;
// how clearly the best beats the next (on the uncapped scores, so two "perfect" matches can still be told apart)
const gap = (a, b) => (a?.raw ?? a?.score ?? 0) - (b?.raw ?? b?.score ?? 0);
// families that are wholly this engine's (1.3.0): they answer before the older offline replies
// …except what the older skills already answer (reminders, alarms, snooze, "no" / "nothing"), and a length on its own
// ("an hour before" is an answer to their question, not a timer)
const NOT_OWNED = new Set(["reminder.set", "reminder.list", "reminder.cancel", "snooze", "alarm.set", "alarm.list", "alarm.cancel", "meta.nevermind", "social.sorry"]);
const owned = (intent, ctx) => OWNED.has(intent.cat) && !NOT_OWNED.has(intent.id) && (intent.id !== "timer.start" || /\b(timers?|countdown|time me|remind me in|wake me (up )?in|remind me .* in \d)\b/.test(ctx.q));
const OWNED = new Set(["timers", "lists", "recipes", "cooking", "jokes", "everyday", "knowledge", "games", "focus", "health", "social", "meta", "home"]);
const HELP_AI = "/help?embed=1#ai-providers";

// Things other modules provide (so this file doesn't import the whole app): route(text) runs Dayspring's own commands
// with no AI; openUrl; weather; media; programs; abilities; helpskills; announce/broadcast.
let deps = { webSearch: null, route: async () => null, openUrl: async () => ({ opened: false }), weather: async () => null, spokenWeather: () => null, media: null, programs: null, abilities: null, help: null, broadcast: () => {}, jokes: null, now: () => new Date() };
export function setDeps(d) { deps = { ...deps, ...d }; }
const now = () => deps.now();

// ---- per-surface conversation state ---------------------------------------------------------------------------------
const S = new Map();
const st = (surface = "tv") => { if (!S.has(surface)) S.set(surface, { fails: 0, failAt: 0 }); return S.get(surface); };
const fresh = (x, ms) => x && Date.now() - x.at < ms;
export function _resetState() { S.clear(); }
// the screen finished a joke on its own (nobody answered): nothing is waiting for "who's there?" or a guess anymore
export function clearState(surface = "tv", what = ["knock", "jokeQA", "jokeOffer", "pick", "purpose", "follow", "confirm"]) { const s = st(surface); for (const k of what) s[k] = null; return { cleared: what }; }

// learned phrasings: what someone picked for what they said
let learned = null;
function learnedMap() { if (!learned) { try { learned = existsSync(LEARN_FILE()) ? JSON.parse(readFileSync(LEARN_FILE(), "utf8")) : {}; } catch { learned = {}; } } return learned; }
function learn(q, id) { const m = learnedMap(); m[q] = id; const keys = Object.keys(m); if (keys.length > 500) delete m[keys[0]]; try { mkdirSync(dirname(LEARN_FILE()), { recursive: true }); writeFileSync(LEARN_FILE() + ".tmp", JSON.stringify(m)); renameSync(LEARN_FILE() + ".tmp", LEARN_FILE()); } catch { /* not fatal */ } }
export function forgetLearned() { learned = {}; try { writeFileSync(LEARN_FILE(), "{}"); } catch { /* fine */ } return { forgotten: true }; }
export const learnedCount = () => Object.keys(learnedMap()).length;

const byId = new Map(INTENTS.map((i) => [i.id, i]));
function contextState() {
  const cook = recipes.cookingNow();
  return { cooking: Boolean(cook), recipeResults: Boolean(recipes.lastResults()), ringing: timers.ringing().length > 0, timers: timers.list().length > 0, media: true };
}

// ---- dry run ---------------------------------------------------------------------------------------------------------
export function plan(text, state = contextState()) {
  const { prepared, ranked } = rank(text, { state });
  const top = ranked[0];
  if (!top) return { intent: null, score: 0, action: null, ranked: [] };
  const action = planOf(top.intent, prepared);
  return { intent: top.intent.id, score: top.score, action, ranked: ranked.slice(0, 7).map((r) => ({ id: r.intent.id, score: Math.round(r.score * 1000) / 1000 })), prepared };
}
function planOf(intent, ctx) { try { return intent.plan(ctx); } catch (e) { return { do: "error", error: e.message }; } }
function labelOf(intent, ctx) { try { return intent.label ? (typeof intent.label === "function" ? intent.label(ctx) : intent.label) : intent.label; } catch { return null; } }
const labelText = (intent, ctx) => (typeof intent.label === "function" ? labelOf(intent, ctx) : null) ?? intentLabel(intent);
const intentLabel = (i) => (typeof i.label === "string" ? i.label : i.id);

// ---- the entry points --------------------------------------------------------------------------------------------------
// early: answers to Dayspring's questions, then instant intents (confident only). Returns a result or null.
// phase "states": only answers to Dayspring's own questions (runs before Dayspring's other skills);
// phase "instant": the instant intents too (runs after them, just before the AI, so every existing command keeps working)
export async function early(text, { surface = "tv", ai = false, typed = false, phase = "instant" } = {}) {
  const s = st(surface);
  s.typed = typed;
  const q = normalize(text);
  if (!q) return null;
  // what was heard (for "what did you hear?": the request before this one)
  s.heardBefore = s.heard ?? null; s.heard = String(text).trim();
  // 0. someone in crisis comes before everything else, always
  // a secret character's phrase ("meow", "take me to your leader") before any older skill can take the words
  try { if (secretPhrase(text)) { const pr = personaHandle(text); if (pr) return pr; } } catch { /* no secrets module */ }
  // an XP check-in waiting for its answer ("What's one thing you learned?") gets it first
  { const x = await xpLib(); try { if (x?.checkin?.active?.(surface)) { const r = await x.handle(text, { surface }); if (r?.reply) return out(r.reply, { listen: Boolean(r.awaiting), ...(r.show ? { show: r.show } : {}), intent: "xp" }); } } catch { /* XP's own problem */ } }
  // …and the answer to the personality's own yes/no question ("unlock the caveman?" → "yes")
  try { if ((typeof persona.hasPending === "function" && persona.hasPending()) || (typeof persona.pending === "function" && persona.pending())) { const pr = personaHandle(text); if (pr) return pr; } } catch { /* not waiting */ }
  if (CRISIS_RE.test(String(text).toLowerCase().replace(/['’]/g, "")) || CRISIS_RE.test(q)) return run(byId.get("social.crisis"), { ...prepare(text), raw: text }, { surface });
  // 1. an offer Dayspring made ("Want me to search the web?", "Want me to count to 100?")
  if (fresh(s.offer, 60_000)) {
    const yes = YES.test(q), no = NO.test(q);
    if (yes || no) { const o = s.offer; s.offer = null; if (no) return out(pickLine(["Okay.", "No problem.", "Alright."])); return o.yes(); }
    s.offer = null;
  }
  // games waiting on an answer: a trivia guess, rock paper scissors
  if (fresh(s.trivia, 90_000)) { const r = answerTrivia(s, q); if (r) return r; }
  if (fresh(s.rps, 45_000)) { const r = answerRps(s, q); if (r) return r; }
  // 1. yes/no to something risky
  if (fresh(s.confirm, 60_000)) {
    const yes = /^(yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|please do|confirm|correct|that is right|thats right|affirmative|absolutely|of course)\b/.test(q);
    const no = /^(no|nope|nah|cancel|never ?mind|do not|dont|stop|wait|hold on|not now)\b/.test(q);
    if (yes || no) { const c = s.confirm; s.confirm = null; if (no) return out("Okay, I left it alone."); return run(c.intent, c.ctx, { surface, confirmed: true }); }
    s.confirm = null;
  }
  // 2. a number from the suggestion list
  if (fresh(s.pick, 90_000)) { const r = await answerPick(s, q, surface); if (r) return r; }
  // 3. a follow-up question ("For how long?")
  if (fresh(s.follow, 45_000)) { const r = await answerFollow(s, q, text, surface); if (r) return r; }
  // 4. "What's it for?" after an unnamed timer
  if (fresh(s.purpose, 60_000)) { const r = answerPurpose(s, q, text); if (r) return r; }
  // 5. knock-knock and joke guesses
  if (fresh(s.knock, 45_000)) { const r = answerKnock(s, q, text); if (r) return r; }
  if (fresh(s.jokeQA, 30_000)) { const r = answerJokeQA(s, q); if (r) return r; }
  if (fresh(s.jokeOffer, 30_000)) { const r = await answerJokeOffer(s, q, surface); if (r) return r; }
  // 6. dictating a recipe
  if (recipes.dictating()) { const r = answerDictation(q, text); if (r) return r; }
  if (phase === "states") {
    // while cooking, or with recipes or a ringing timer on screen, those words are for them
    const st0 = contextState();
    if (!st0.cooking && !st0.recipeResults && !st0.ringing) return null;
    const { prepared: p0, ranked: r0 } = rank(text, { state: st0 }); p0.raw = text; const t0 = r0[0];
    if (t0 && st0.cooking && t0.intent.cat === "cooking" && t0.score >= 0.6) return run(t0.intent, p0, { surface });
    if (t0 && st0.recipeResults && ["recipe.pick", "recipe.more"].includes(t0.intent.id) && t0.score >= 0.65) return run(t0.intent, p0, { surface });
    if (t0 && st0.ringing && t0.intent.id === "timer.dismiss" && t0.score >= 0.6) return run(t0.intent, p0, { surface });
    return null;
  }
  // the personality's commands ("be a pirate", "be normal") and the yes/no to its own questions
  { const pr = personaHandle(text); if (pr) return pr; }
  // XP: "I finished my workout", "what level am I" (after every older skill, so theirs keep working)
  // (only its own questions here; "I practised guitar"-style reports wait for the fallback, so older skills answer first)
  if (/\b(xp|experience points|level|streak|unlock|check in on)\b/.test(q)) { const x = await xpLib(); try { const r = x ? await x.handle(text, { surface }) : null; if (r?.reply) return out(r.reply, { listen: Boolean(r.awaiting), ...(r.show ? { show: r.show } : {}), intent: "xp" }); } catch { /* XP's own problem */ } }
  const state = contextState();
  const { prepared, ranked } = rank(text, { state });
  prepared.raw = text;
  const top = ranked[0], second = ranked[1];
  // 7. a phrasing someone taught Dayspring by picking it
  const lid = learnedMap()[q];
  if (lid && byId.get(lid)) return run(byId.get(lid), prepared, { surface });
  if (!top) return null;
  const margin = gap(top, second);
  // 8. while cooking, a recipe choice showing, or a timer ringing: those come first
  if (state.cooking && top.intent.cat === "cooking" && top.score >= 0.5) return run(top.intent, prepared, { surface });
  if (state.recipeResults && ["recipe.pick", "recipe.more"].includes(top.intent.id) && top.score >= 0.55) return run(top.intent, prepared, { surface });
  if (state.ringing && top.intent.id === "timer.dismiss" && top.score >= 0.5) return run(top.intent, prepared, { surface });
  // without AI, only the families that are this engine's own go ahead of the older offline answers (the schedule,
  // what's next and the rest keep answering the way they always have)
  if (!ai && !owned(top.intent, prepared)) return null;
  const clear = top.score >= (ai ? 0.8 : RUN) && margin >= MARGIN;
  // 9. instant things: confident and clearly this one; recipes, timers and lists are Dayspring's own either way
  if (clear && !NOT_OWNED.has(top.intent.id) && !(top.intent.id === "timer.start" && !owned(top.intent, prepared)) && (top.intent.instant || owned(top.intent, prepared))) return run(top.intent, prepared, { surface });
  return null;
}

// is there one clear, confident match? (assistant.mjs asks before choosing between this and its older offline answers)
export function confident(text) {
  const { ranked } = rank(text, { state: contextState() });
  const top = ranked[0], second = ranked[1];
  return top && top.score >= RUN && gap(top, second) >= MARGIN ? { id: top.intent.id, score: top.score } : null;
}

// fallback: no AI, or the AI couldn't answer. Always returns something.
export async function fallback(text, { surface = "tv", why = null, typed = false } = {}) {
  const s = st(surface);
  s.typed = typed;
  // XP self-reports ("I did the dishes"), now that nothing older claimed them
  { const x = await xpLib(); try { const r = x ? await x.handle(text, { surface }) : null; if (r?.reply) return out(r.reply, { listen: Boolean(r.awaiting), ...(r.show ? { show: r.show } : {}), intent: "xp" }); } catch { /* XP's own problem */ } }
  const { prepared, ranked } = rank(text, { state: contextState() });
  prepared.raw = text;
  const top = ranked[0], second = ranked[1];
  if (top && top.score >= RUN && gap(top, second) >= MARGIN) return run(top.intent, prepared, { surface });
  // a bare "yes" or "okay" with nothing waiting on it
  if (/^(yes|yeah|yep|no|nope|nah|ok|okay|alright|all right|sure|fine|cool|great|good)$/.test(prepared.q)) return out("Okay.");
  // only choices that share real words with what was said (not just "the")
  const options = ranked.filter((r) => r.score >= SUGGEST && (r.cover ?? 1) >= 0.34).slice(0, 7);
  logMiss(prepared.q);          // (only the words, on this computer; Settings can turn it off)
  if (!options.length) return miss(s, why);
  return suggest(s, prepared, options);
}

function suggest(s, ctx, options) {
  const list = options.map((o, i) => ({ n: i + 1, id: o.intent.id, label: labelText(o.intent, ctx) }));
  s.pick = { at: Date.now(), ctx, options: options.map((o) => o.intent), list };
  const top3 = list.slice(0, 3).map((o) => `${o.n}, ${o.label}`).join(". ");
  const reply = `Did you mean one of these? ${top3}${list.length > 3 ? ", or one of the others on the screen" : ""}. Say the number, or "none of these".`;
  return out(reply, { suggest: { prompt: "Here's what I can do that sounds close:", options: list, none: "None of these" }, listen: true });
}

async function answerPick(s, q, surface) {
  const p = s.pick;
  if (/^(none|none of (these|those|them)|neither|nope|no|nah|nothing|not (those|these|any of (these|those|them))|wrong|none of the above|other)\b/.test(q)) { s.pick = null; return miss(s, null, true); }
  const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, last: p.list.length };
  let n = null, m;
  if ((m = /^(?:number |option |choice |the |pick |choose |i want |go with |do )?(\d)(?:st|nd|rd|th)?(?: one| please)?$/.exec(q))) n = Number(m[1]);
  else if ((m = /^(?:the |number |option )?(first|second|third|fourth|fifth|sixth|seventh|last)(?: one| option| choice)?$/.exec(q))) n = ORD[m[1]];
  if (!n) {
    // the option's own words ("set a timer")
    const words = new Set(q.split(" ").filter((w) => w.length > 2));
    let best = null, bestS = 0;
    for (const o of p.list) { const lw = normalize(o.label).split(" ").filter((w) => w.length > 2); const hit = lw.filter((w) => words.has(w)).length / Math.max(1, lw.length); if (hit > bestS) { bestS = hit; best = o; } }
    if (best && bestS >= 0.6) n = best.n;
  }
  if (!n || n < 1 || n > p.list.length) { s.pick = null; return null; }       // something new: handle it normally
  s.pick = null;
  const intent = p.options[n - 1];
  learn(p.ctx.q, intent.id);
  s.fails = 0;
  return run(intent, p.ctx, { surface });
}

function miss(s, why, saidNone = false) {
  s.fails = Date.now() - s.failAt < 5 * 60_000 ? s.fails + 1 : 1;
  s.failAt = Date.now();
  if (s.fails >= 3) {
    s.fails = 0;
    return out("I'm having a hard time understanding. Can you ask in a different way? If you want more information on how to add AI to Dayspring, you can find that here!", { link: { label: "here", url: HELP_AI }, miss: true });
  }
  const lines = ["I'm sorry, my responses are limited without an AI voice integration. You can try asking in a different way.", "Sorry, I didn't catch what you'd like. My answers are limited without AI. Could you say it another way?"];
  return out(saidNone ? lines[0] : lines[s.fails === 2 ? 1 : 0], { miss: true });
}

// ---- follow-up questions for a missing detail ------------------------------------------------------------------------
const ASK = { duration: "For how long?", time: "What time?", date: "Which day?", ref: "Which passage? For example, John 3:16.", version: "Which version? For example, the ESV or the King James.", name: "Which one?", title: "What should I call it?", dish: "What would you like to make?", text: "What should I remind you about?", query: "What should I look for?" };
async function answerFollow(s, q, raw, surface) {
  const f = s.follow; s.follow = null;
  if (/^(never ?mind|cancel|forget it|nothing|stop)$/.test(q)) return out("Okay.");
  const ctx = { ...f.ctx, slots: { ...f.ctx.slots } };
  if (f.need === "duration") { const d = findDuration(q) ?? (/^\d+(\.\d+)?$/.test(q) ? { ms: Number(q) * 60_000, text: q } : null); if (!d) return out("Sorry, how long? Say something like ten minutes."); ctx.slots.duration = d; }
  else if (f.need === "time") { const t = findTime(/^\d/.test(q) ? `at ${q}` : q); if (!t) return out("Sorry, what time? Say something like 3 p.m."); ctx.slots.time = t; }
  else if (f.need === "date") { const d = findDate(q); if (!d) return out("Sorry, which day? Say something like tomorrow or Friday."); ctx.slots.date = d; }
  else ctx.extra = { ...(ctx.extra ?? {}), [f.need]: String(raw).trim() };
  return run(f.intent, ctx, { surface });
}
function needFollow(s, intent, ctx, need) { s.follow = { at: Date.now(), intent, ctx, need }; return out(ASK[need] ?? "Can you tell me a bit more?", { listen: true }); }

// ---- running an intent -----------------------------------------------------------------------------------------------
// ("7:23 p.m.." → "7:23 p.m."; an ellipsis stays)
function out(reply, extra = {}) { return { reply: String(reply ?? "").replace(/(?<!\.)\.\.(?!\.)/g, "."), ...extra }; }
async function run(intent, ctx, { surface = "tv", confirmed = false } = {}) {
  const s = st(surface);
  let a = planOf(intent, ctx);
  if (ctx.extra) a = { ...a, ...Object.fromEntries(Object.entries(ctx.extra).map(([k, v]) => [k === "title" ? "title" : k, v])) };
  if (intent.risky && !confirmed) {
    const what = labelText(intent, ctx);
    s.confirm = { at: Date.now(), intent, ctx };
    return out(`Just to check: ${what.charAt(0).toLowerCase() + what.slice(1)}? Say yes to go ahead.`, { listen: true, intent: intent.id });
  }
  s.fails = 0;
  try {
    s.undo = null;
    const r = await exec(a, { intent, ctx, surface, s });
    if (s.undo) s.lastUndo = { fn: s.undo, at: Date.now(), what: labelText(intent, ctx) };
    return { ...r, reply: await styled(r.reply, intent), intent: intent.id, action: a.do };
  } catch (e) {
    return out(e.message && /^[A-Z]/.test(e.message) ? e.message : `I couldn't do that: ${e.message}`, { intent: intent.id, action: a.do, error: true });
  }
}

const say = (t) => sayTime(t);
const hmNow = () => { const d = now(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const todayIso = () => isoOf(now());
function findBlock(words, date) {
  const w = String(words ?? "").toLowerCase().replace(/\b(the|my|a|an)\b/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return null;
  const t = todayIso();
  const days = date ? [date] : Array.from({ length: 14 }, (_, i) => store.addDays(t, i));
  const nowHM = hmNow();
  for (const d of days) {
    const hits = store.blocksBetween(d, d).filter((b) => w.every((x) => b.title.toLowerCase().includes(x)) || (w.length > 1 && w.filter((x) => b.title.toLowerCase().includes(x)).length >= Math.ceil(w.length * 0.6)));
    if (hits.length) return hits.find((b) => d !== t || b.end > nowHM) ?? hits[0];
  }
  return null;
}
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const toHM = (m) => `${String(Math.floor(Math.max(0, m) / 60) % 24).padStart(2, "0")}:${String(Math.max(0, m) % 60).padStart(2, "0")}`;
function category(title) { const t = title.toLowerCase(); return /gym|workout|run|walk|exercise|practice|game|swim|yoga/.test(t) ? "body" : /study|exam|lesson|homework|class/.test(t) ? "study" : /church|bible|pray|worship/.test(t) ? "faith" : /breakfast|lunch|dinner|meal/.test(t) ? "meal" : /work|meeting|call|client/.test(t) ? "work" : /clean|laundry|dishes|errand|haircut|shop/.test(t) ? "home" : /movie|nap|rest|relax/.test(t) ? "rest" : "flex"; }
const cap = (x) => (x ? x.charAt(0).toUpperCase() + x.slice(1) : x);
const listSay = (arr) => (arr.length <= 1 ? arr.join("") : arr.slice(0, -1).join(", ") + " and " + arr.at(-1));

async function exec(a, { intent, ctx, surface, s }) {
  switch (a.do) {
    // ---- time
    case "say.time": return out(`It's ${say(hmNow())}.`);
    case "say.date": {
      const d = now();
      if (a.part === "weekday") return out(`It's ${d.toLocaleDateString("en-US", { weekday: "long" })}.`);
      if (a.part === "month") return out(`It's ${d.toLocaleDateString("en-US", { month: "long" })}.`);
      if (a.part === "year") return out(`It's ${d.getFullYear()}.`);
      return out(`Today is ${d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}.`);
    }
    case "days.until": {
      if (!a.date) return needFollow(s, intent, ctx, "date");
      const [y, m, d] = a.date.split("-").map(Number);
      const days = Math.round((new Date(y, m - 1, d) - new Date(now().getFullYear(), now().getMonth(), now().getDate())) / 86_400_000);
      const name = a.name && !/^\d/.test(a.name) ? cap(a.name.replace(/^(on|the) /, "")) : sayDate(a.date);
      if (days === 0) return out(`${name} is today!`);
      if (days === 1) return out(`${name} is tomorrow.`);
      return out(`${name} is ${days < 0 ? `${-days} days ago` : `in ${days} days`}, on ${new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}.`);
    }
    case "time.city": { if (!a.city) return out("Which city? I know the time zones of most big cities."); return out(everyday.timeIn(a.city, now()) ?? "I don't know that city's time zone yet."); }
    case "holiday.when": {
      if (a.name && a.date) { const [y, m, d] = a.date.split("-").map(Number); return out(`${cap(a.name)} is on ${new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}.`); }
      const t = now(); const y = t.getFullYear();
      const upcoming = Object.entries(HOLIDAYS).map(([n, f]) => { let dt = f(y); if (dt < new Date(y, t.getMonth(), t.getDate())) dt = f(y + 1); return { n, dt }; }).filter((x, i, arr) => arr.findIndex((z) => z.dt.getTime() === x.dt.getTime()) === i).sort((p, q) => p.dt - q.dt);
      const today = upcoming.find((x) => isoOf(x.dt) === isoOf(t));
      if (/today/.test(ctx.q) && !/next|coming/.test(ctx.q)) return out(today ? `Yes, today is ${cap(today.n)}!` : `No holiday today. The next one is ${cap(upcoming[0].n)}, ${sayDate(isoOf(upcoming[0].dt), t)}.`);
      return out(`The next holiday is ${cap(upcoming[0].n)}, ${sayDate(isoOf(upcoming[0].dt), t)}.`);
    }
    // ---- schedule
    case "sched.next": case "sched.now": {
      const t = todayIso(), nowHM = hmNow();
      const day = store.blocksBetween(t, t);
      const cur = day.find((b) => b.start <= nowHM && nowHM < b.end), next = day.find((b) => b.start > nowHM);
      if (a.do === "sched.now") return out(cur ? `Right now it's ${cur.title}, until ${say(cur.end)}.${next ? ` Then ${next.title} at ${say(next.start)}.` : ""}` : `Nothing is scheduled right now.${next ? ` Next is ${next.title} at ${say(next.start)}.` : ""}`);
      if (next) return out(`Next is ${next.title} at ${say(next.start)}.`);
      const tm = store.blocksBetween(store.addDays(t, 1), store.addDays(t, 1))[0];
      return out(`Nothing else is scheduled today.${tm ? ` Tomorrow starts with ${tm.title} at ${say(tm.start)}.` : ""}`);
    }
    case "sched.day": {
      const d = a.date ?? todayIso(); const nowHM = hmNow();
      const list = store.blocksBetween(d, d).filter((b) => d !== todayIso() || b.end > nowHM);
      const when = sayDate(d, now());
      if (!list.length) return out(`Nothing is scheduled ${when === "today" ? "for the rest of today" : when}.`, { clientShow: { view: "day", date: d } });
      return out(`${cap(when)}: ${list.slice(0, 7).map((b) => `${b.title} at ${say(b.start)}`).join(", ")}${list.length > 7 ? `, and ${list.length - 7} more` : ""}.`, { clientShow: { view: "day", date: d } });
    }
    case "client": return out(a.say ?? "", { clientRun: a.text });
    case "sched.add": {
      if (!a.time) return needFollow(s, intent, ctx, "time");
      const title = cap(a.title || ctx.extra?.title || "");
      if (!title) return needFollow(s, intent, ctx, "title");
      let date = a.date ?? todayIso();
      if (!a.date && a.time < hmNow()) date = store.addDays(todayIso(), 1);
      const mins = a.minutes ?? (/\b(appointment|meeting|dentist|doctor|lunch|dinner|class)\b/i.test(title) ? 60 : 30);
      const end = toHM(Math.min(toMin(a.time) + mins, 23 * 60 + 59));
      const r = store.addBlock({ date, start: a.time, end, title, category: category(title), source: "manual" });
      return out(`Added ${r.block.title}, ${sayDate(date, now())} at ${say(a.time)}.` + (r.conflicts?.length ? ` Heads up: it overlaps ${r.conflicts.map((c) => c.title).join(" and ")}.` : ""), { changes: ["update"] });
    }
    case "sched.move": {
      if (!a.what) return needFollow(s, intent, ctx, "name");
      const b = findBlock(a.what); if (!b) return out(`I couldn't find ${a.what} on the schedule.`);
      if (!a.date && !a.time) return needFollow(s, intent, ctx, "time");
      const dur = toMin(b.end) - toMin(b.start), start = a.time ?? b.start;
      const r = store.updateBlock(b.id, { date: a.date ?? b.date, start, end: toHM(Math.min(toMin(start) + dur, 23 * 60 + 59)) });
      return out(`Moved ${b.title} to ${sayDate(r.block.date, now())} at ${say(r.block.start)}.` + (r.conflicts?.length ? ` It now overlaps ${r.conflicts.map((c) => c.title).join(" and ")}.` : ""), { changes: ["update"] });
    }
    case "sched.push": {
      if (!a.ms) return needFollow(s, intent, ctx, "duration");
      const by = Math.round(a.ms / 60000);
      if (!a.what || a.what === "everything") {
        const t = todayIso(), nowHM = hmNow(); const left = store.blocksBetween(t, t).filter((b) => b.start >= nowHM);
        for (const b of left) store.updateBlock(b.id, { start: toHM(toMin(b.start) + by), end: toHM(Math.min(toMin(b.end) + by, 23 * 60 + 59)) });
        return out(left.length ? `Okay, I moved the rest of today ${Math.abs(by)} minutes ${by > 0 ? "later" : "earlier"}.` : "There's nothing left today to move.", { changes: ["update"] });
      }
      const b = findBlock(a.what); if (!b) return out(`I couldn't find ${a.what} on the schedule.`);
      const r = store.updateBlock(b.id, { start: toHM(toMin(b.start) + by), end: toHM(Math.min(toMin(b.end) + by, 23 * 60 + 59)) });
      return out(`${b.title} is now at ${say(r.block.start)}.`, { changes: ["update"] });
    }
    case "sched.rename": {
      const b = findBlock(a.what); if (!b) return out(`I couldn't find ${a.what || "that"} on the schedule.`);
      if (!a.to) return needFollow(s, intent, ctx, "title");
      store.updateBlock(b.id, { title: cap(a.to) }); return out(`Renamed ${b.title} to ${cap(a.to)}.`, { changes: ["update"] });
    }
    case "sched.delete": {
      const b = findBlock(a.what, a.date); if (!b) return out(`I couldn't find ${a.what || "that"} on the schedule.`);
      store.removeBlock(b.id); return out(`Removed ${b.title} from ${sayDate(b.date, now())}. Say "undo" to put it back.`, { changes: ["update"] });
    }
    case "sched.resize": {
      if (!a.ms) return needFollow(s, intent, ctx, "duration");
      const b = findBlock(a.what); if (!b) return out(`I couldn't find ${a.what || "that"} on the schedule.`);
      const mins = Math.round(a.ms / 60000);
      const end = a.absolute ? toMin(b.start) + Math.abs(mins) : toMin(b.end) + mins;
      if (end <= toMin(b.start)) return out(`That would leave ${b.title} with no time at all.`);
      store.updateBlock(b.id, { end: toHM(Math.min(end, 23 * 60 + 59)) });
      return out(`${b.title} now ends at ${say(toHM(Math.min(end, 23 * 60 + 59)))}.`, { changes: ["update"] });
    }
    case "sched.free": {
      const d = a.date ?? todayIso();
      if (a.time) { const busy = store.blocksBetween(d, d).find((b) => b.start <= a.time && a.time < b.end); return out(busy ? `No, ${busy.title} is on until ${say(busy.end)}.` : `Yes, ${say(a.time)} ${sayDate(d, now())} is free.`); }
      const slots = store.freeSlots(d, 30, d === todayIso() ? hmNow() : "07:00", "22:00");
      if (!slots.length) return out(`${cap(sayDate(d, now()))} is full.`);
      return out(`${cap(sayDate(d, now()))} you're free ${slots.slice(0, 4).map((x) => `${say(x.start)} to ${say(x.end)}`).join(", ")}.`);
    }
    case "sched.clear": {
      const d = a.date ?? todayIso();
      const hit = store.blocksBetween(d, d).filter((b) => b.start >= a.from && b.start < a.to);
      for (const b of hit) store.removeBlock(b.id);
      return out(hit.length ? `Cleared ${hit.length} ${hit.length === 1 ? "thing" : "things"}: ${listSay(hit.map((b) => b.title))}.` : "There was nothing to clear.", { changes: ["update"] });
    }
    case "sched.repeat": {
      const b = findBlock(a.what); if (!b) return out(`I couldn't find ${a.what || "that"} on the schedule.`);
      const rp = recur.parse(a.rule);
      if (!rp) return out("How often should it repeat? For example, every weekday, or every other day.");
      const r = store.makeRecurring(b.id, rp.repeat);
      return out(`${b.title} now repeats ${String(r.repeatText ?? recur.describe(r)).replace(/^./, (c) => c.toLowerCase())}.`, { changes: ["update"] });
    }
    case "route": {
      const r = await deps.route(a.text, { surface });
      if (r) return typeof r === "string" ? out(r) : r;
      return out(`I can't do that one without AI yet. Try saying it another way.`);
    }
    // ---- timers
    case "timer.start": {
      if (!a.ms) return needFollow(s, intent, ctx, "duration");
      const r = timers.start({ ms: a.ms, label: a.label });
      if (r.full) return out(`You already have ${timers.MAX} timers running, which is the most I can keep track of. Want me to cancel one? Say "cancel the" and its name.`);
      const len = sayDuration(a.ms);
      try { if (typeof persona.event === "function") persona.event("timers", { active: timers.list().length }); } catch { /* the personality's own business */ }
      if (r.ask) { s.purpose = { at: Date.now(), id: r.timer.id }; return out(`Got it, ${len}. What's it for?`, { listen: true, timers: timers.snapshot() }); }
      return out(`${pickLine(["Okay", "Got it", "You got it"])}, a ${r.timer.label} timer for ${len}.`, { timers: timers.snapshot() });
    }
    case "timer.list": {
      const t = timers.list();
      if (!t.length) return out("You don't have any timers running.");
      return out(`You have ${t.length === 1 ? "one" : t.length}: ${t.map((x) => `${x.label}, ${timers.spokenLeft(x.left)}${x.paused ? " (paused)" : " left"}`).join("; ")}.`);
    }
    case "timer.left": {
      const list = timers.list();
      if (!list.length) return out("You don't have any timers running.");
      const t = timers.timeLeft(a.ref);
      if (!t) return out(`I don't see a ${a.ref} timer. You have ${listSay(list.map((x) => x.label))}.`);
      if (!a.ref && list.length > 1) return out(`You have ${list.length}: ${list.map((x) => `${x.label}, ${timers.spokenLeft(x.left)}`).join("; ")}.`);
      return out(`${cap(t.label)}${/^timer/i.test(t.label) ? "" : " timer"}: ${timers.spokenLeft(t.left)} ${t.paused ? "left, and it's paused" : "left"}.`);
    }
    case "timer.cancel": { const r = timers.cancel(a.ref); return out(r.length ? `Cancelled ${r.length > 1 ? `${r.length} timers` : `the ${r[0].label} timer`.replace(/the (Timer \d) timer/, "$1")}.` : "There's no timer like that running.", { timers: timers.snapshot() }); }
    case "timer.pause": { const r = timers.pause(a.ref); return out(r.length ? `Paused ${r.length > 1 ? "all your timers" : `the ${r[0].label} timer, with ${timers.spokenLeft(r[0].left)} left`}.` : "There's no running timer like that.", { timers: timers.snapshot() }); }
    case "timer.resume": { const r = timers.resume(a.ref); return out(r.length ? `Resumed ${r.length > 1 ? "your timers" : `the ${r[0].label} timer`}.` : "There's no paused timer like that.", { timers: timers.snapshot() }); }
    case "timer.add": { if (!a.ms) return needFollow(s, intent, ctx, "duration"); const r = timers.addTime(a.ref, a.ms); return out(r.length ? `Added ${sayDuration(a.ms)}. The ${r[0].label} timer has ${timers.spokenLeft(r[0].left)} left.` : "There's no timer like that running.", { timers: timers.snapshot() }); }
    case "timer.rename": { if (!a.to) return needFollow(s, intent, ctx, "title"); const r = timers.rename(a.ref, a.to); return out(r ? `Okay, the ${r.before} timer is now the ${r.label} timer.` : "I couldn't find that timer.", { timers: timers.snapshot() }); }
    case "timer.dismiss": {
      const r = timers.dismiss(a.ref && a.ref !== "all" ? a.ref : "");
      return out(r.length ? pickLine(["Okay.", "Got it.", "Timer off."]) : "Nothing is ringing.", { timers: timers.snapshot(), dismissTimers: true });
    }
    case "stopwatch": {
      const w = timers.stopwatch(a.action);
      if (a.action === "start") return out("Stopwatch started.", { timers: timers.snapshot() });
      if (a.action === "reset") return out("Stopwatch reset.", { timers: timers.snapshot() });
      if (a.action === "lap") return out(`Lap: ${timers.spokenLeft(w.elapsed)}.`, { timers: timers.snapshot() });
      return out(`${a.action === "stop" ? "Stopped at" : "It's been"} ${timers.spokenLeft(w.elapsed)}.`, { timers: timers.snapshot() });
    }
    case "alarm.set": {
      if (!a.time) return needFollow(s, intent, ctx, "time");
      const al = timers.setAlarm({ date: a.date, hm: a.time, label: a.label });
      const d = new Date(al.at);
      return out(`Alarm set for ${say(a.time)} ${sayDate(isoOf(d), now())}.`, { timers: timers.snapshot() });
    }
    case "alarm.list": { const al = timers.alarms(); if (!al.length) return out("You don't have any alarms set with me."); return out(`You have ${al.length}: ${al.map((x) => { const d = new Date(x.at); return `${say(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`)} ${sayDate(isoOf(d), now())}${x.label ? ` for ${x.label}` : ""}`; }).join("; ")}.`); }
    case "alarm.cancel": { const r = timers.cancelAlarm(a.ref); return out(r.length ? `Cancelled ${r.length > 1 ? `${r.length} alarms` : "the alarm"}.` : "There's no alarm like that."); }
    case "reminder.set": {
      const text = a.text || ctx.extra?.text;
      if (!text) return needFollow(s, intent, ctx, "text");
      const reminders = await import("../reminders.mjs");
      const date = a.date ?? todayIso();
      const r = reminders.add({ date, time: a.time, text });
      return out(a.time ? `Okay, ${sayDate(date, now())} at ${say(a.time)} I'll remind you to ${text}.` : `Okay, I'll bring it up in ${sayDate(date, now()) === "today" ? "today's" : sayDate(date, now()) + "'s"} rundown: ${text}.`, { changes: ["update"], reminder: r?.id ?? null });
    }
    // ---- programs, files, web
    case "app.open": {
      const name = a.name || ctx.extra?.name; if (!name) return needFollow(s, intent, ctx, "name");
      if (!deps.programs) return out("Opening programs isn't available here.");
      const r = await deps.programs.open(name, { confirmed: Boolean(a.confirmed) });
      if (r.needsConfirm) { s.confirm = { at: Date.now(), intent, ctx: { ...ctx, extra: { ...(ctx.extra ?? {}), confirmed: true } } }; return out(r.text, { listen: true }); }
      return out(r.opened ? `Opening ${r.opened}.` : r.text ?? "I couldn't open that.");
    }
    case "app.close": { if (!deps.programs) return out("Closing programs isn't available here."); const r = await deps.programs.close(a.name, { confirmed: true }); return out(r.closed ? `Closed ${r.closed}.` : r.text ?? "I couldn't close that."); }
    case "web.open": { if (!a.url) return out("Which website?"); const r = await deps.openUrl(a.url); return out(r.opened || r.dryRun ? `Opening ${a.name ?? a.url}.` : "I couldn't open the browser."); }
    case "web.search": { const qy = a.query || ctx.extra?.query; if (!qy) return needFollow(s, intent, ctx, "query"); const r = await deps.openUrl(`https://www.google.com/search?q=${encodeURIComponent(qy)}`); return out(r.opened || r.dryRun ? `I opened a web search for ${qy} in your browser.` : "I couldn't open the browser."); }
    case "file.find": { if (!deps.abilities) return out("Searching files isn't available here."); const r = await deps.abilities.run("find_files", { query: a.query }); if (r?.denied) return out(r.text); const hits = r?.results ?? r?.files ?? []; return out(hits.length ? `I found ${hits.length === 1 ? "one" : hits.length}: ${hits.slice(0, 3).map((h) => h.name ?? String(h.path ?? h).split(/[\\/]/).pop()).join(", ")}.` : `I couldn't find a file like ${a.query}.`); }
    case "file.open": {
      if (!deps.abilities) return out("Opening files isn't available here.");
      const known = /\b(documents|downloads|desktop|pictures|music|videos)\b/.exec(a.query ?? "")?.[1];
      if (known) { const home = process.env.USERPROFILE ?? ""; const r = await deps.abilities.run("open_item", { path: join(home, cap(known)) }); return out(r?.error ? `I couldn't open your ${known} folder.` : `Opening your ${known} folder.`); }
      const f = await deps.abilities.run("document_find", { query: a.query });
      if (!f?.best) return out(`I couldn't find ${a.query}.`);
      await deps.abilities.run("open_item", { path: f.best.path ?? f.best });
      return out(`Opening ${String(f.best.name ?? f.best.path ?? f.best).split(/[\\/]/).pop()}.`);
    }
    case "folder.create": { if (!deps.abilities) return out("Making folders isn't available here."); if (!a.name) return needFollow(s, intent, ctx, "title"); const r = await deps.abilities.run("create_folder", { path: a.name, confirmed: true }); return out(r?.denied ? r.text : r?.error ? `I couldn't make it: ${r.error}` : `Made the ${a.name} folder.`); }
    // ---- Bible
    case "bible.read": {
      if (!a.ref) return needFollow(s, intent, ctx, "ref");
      const v = a.version && bible.VERSIONS[a.version] ? a.version : a.version ? "__unknown" : settings.get().bibleVersion || "kjv";
      if (v === "__unknown") return out(`I can't read the ${a.version.toUpperCase()}. ${versionsLine()}`);
      try { const p = await bible.passage(a.ref, v); s.lastRef = { ref: p.reference, version: v }; return out(bible.spoken(p), { speed: 0.92 }); }
      catch (e) { return out(e.message); }
    }
    case "bible.votd": {
      const d = now(); const day = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86_400_000);
      const ref = VOTD[day % VOTD.length];
      try { const p = await bible.passage(ref, a.version ?? settings.get().bibleVersion ?? "kjv"); s.lastRef = { ref: p.reference, version: p.version }; return out(`Today's verse: ${bible.spoken(p)}`, { speed: 0.92 }); } catch (e) { return out(e.message); }
    }
    case "bible.next": {
      const last = s.lastRef; if (!last) return out("Which passage should I start with? For example, John 3:16.");
      const r = bible.parseRef(last.ref); if (!r) return out("Which passage?");
      const nextRef = a.chapter || !r.from ? `${r.book} ${r.chapter + 1}` : `${r.book} ${r.chapter}:${(r.to ?? r.from) + 1}`;
      try { const p = await bible.passage(nextRef, last.version); s.lastRef = { ref: p.reference, version: last.version }; return out(bible.spoken(p), { speed: 0.92 }); }
      catch { try { const p = await bible.passage(`${r.book} ${r.chapter + 1}:1`, last.version); s.lastRef = { ref: p.reference, version: last.version }; return out(bible.spoken(p), { speed: 0.92 }); } catch (e) { return out(e.message); } }
    }
    case "bible.versions": { if (a.version) { const V = bible.VERSIONS[a.version]; return out(!V ? `I can't read the ${a.version.toUpperCase()}. ${versionsLine()}` : V.unavailable ? `The ${V.name} is copyrighted and has no free source, so I can't read it. ${versionsLine()}` : V.key && !process.env[V.key] ? `Yes, once its free key is added in Settings. ${versionsLine()}` : `Yes, I can read the ${V.name}.`); } return out(versionsLine()); }
    case "bible.search": { if (!a.topic) return needFollow(s, intent, ctx, "query"); try { const r = await bible.search(a.topic, 3); return out(r.results.length ? `Here's what I found in the King James: ${r.results.map((x) => `${x.reference}: ${x.text}`).join(" … ")}${r.total > 3 ? ` There are ${r.total - 3} more.` : ""}` : "I couldn't find a verse with those words. Try different words."); } catch (e) { return out(e.message); } }
    case "bible.setversion": { if (!a.version) return needFollow(s, intent, ctx, "version"); const V = bible.VERSIONS[a.version]; if (!V || V.unavailable) return out(`I can't read the ${a.version.toUpperCase()}. ${versionsLine()}`); settings.set({ bibleVersion: a.version }); return out(`Okay, I'll read from the ${V.name} by default.`, { changes: ["settings"] }); }
    // ---- weather
    case "weather": {
      const w = await deps.weather();
      if (!w) return out("I don't know where you are yet. Add your town in Settings → Where you are, and I'll keep an eye on the weather.");
      if (a.part === "week") return out(`This week: ${w.week.slice(0, 7).map((d) => { const [y, m, dd] = d.date.split("-").map(Number); return `${new Date(y, m - 1, dd).toLocaleDateString("en-US", { weekday: "long" })}, ${d.hi} and ${d.text.toLowerCase()}`; }).join("; ")}.`);
      if (a.part === "day" && a.date) { const d = w.week.find((x) => x.date === a.date); return out(d ? `${cap(sayDate(a.date, now()))}: a high of ${d.hi}, a low of ${d.lo}, ${d.text.toLowerCase()}${d.rain >= 20 ? `, with a ${d.rain}% chance of rain` : ""}.` : "I only have the forecast for the next week."); }
      if (a.part === "rain") { const d = a.date ? w.week.find((x) => x.date === a.date) : w.today; const pr = d?.rain ?? 0; return out(pr >= 50 ? `Yes, probably. There's a ${pr}% chance of rain${a.date ? " " + sayDate(a.date, now()) : " today"}.` : pr >= 20 ? `Maybe. There's a ${pr}% chance of rain.` : `Probably not. Only a ${pr}% chance of rain.`); }
      if (a.part === "jacket") { const t = w.now.feels ?? w.now.temp; return out(t < 50 ? `Yes, bring a warm coat. It feels like ${t} degrees.` : t < 65 ? `A light jacket would be good. It feels like ${t} degrees.` : `No jacket needed. It feels like ${t} degrees.${w.today.rain >= 40 ? " Maybe an umbrella, though." : ""}`); }
      if (a.part === "wind") return out(`The wind is about ${w.now.wind} miles per hour.`);
      return out(deps.spokenWeather(w));
    }
    // ---- media
    case "media.control": {
      if (!deps.media) return out("Music controls aren't available here.");
      try {
        const r = await deps.media.control(a.action, a.value);
        if (a.action === "volume" || a.action === "volumeBy") return out(`Music volume at ${r?.volume ?? a.value}.`);
        return out({ pause: "Paused.", resume: "Playing.", next: r?.title ? `Next up, ${r.title}.` : "Skipped.", previous: "Going back.", stop: "Stopped." }[a.action] ?? "Okay.");
      } catch { return out("Nothing is playing right now."); }
    }
    case "media.now": { const n = deps.media?.nowPlaying?.(); return out(n?.title ? `This is ${n.title}${n.artist ? ` by ${n.artist}` : ""}.` : "Nothing is playing right now."); }
    case "media.play": { const r = await deps.route(a.query ? `play ${a.query}` : "play some music", { surface }); return r ? (typeof r === "string" ? out(r) : r) : out("I couldn't find that to play."); }
    // ---- everyday
    case "calc": { const r = everyday.calculate(a.text); return out(r ? r.spoken : "I couldn't work that out. Try saying it like: 12 times 14."); }
    case "convert": { const r = everyday.convert(a.text); return out(r ? r.spoken : "I couldn't convert that. Try: convert 5 miles to kilometers."); }
    case "spell": { const r = everyday.spell(a.text); return out(r ? r.spoken : "Which word should I spell?"); }
    case "coin": return out(everyday.coin());
    case "dice": return out(everyday.dice(a.text).spoken);
    case "random": return out(everyday.randomNumber(a.text).spoken);
    case "fact": return out(everyday.pickOf(everyday.FACTS));
    case "joke": return tellJoke(s, a, ctx.q);
    case "knock.theirs": { s.knock = { at: Date.now(), dir: "theirs", stage: a.intro ? "wait-knock" : "who" }; return out(a.intro ? "Oh, I love a good joke. Go ahead!" : "Who's there?", { listen: true }); }
    case "chat": return out(chatLine(a.kind));
    case "count": return count(a, s);
    // ---- lists and notes
    case "list.add": { const item = a.item || ctx.extra?.name; if (!item) return needFollow(s, intent, ctx, "name"); const r = notes.add(a.list, item); return out(r.added.length ? `Added ${listSay(r.added)} to your ${r.list} list.` : `${cap(listSay(item.split(/,| and /).map((x) => x.trim())))} ${item.includes(",") ? "are" : "is"} already on your ${r.list} list.`); }
    case "list.read": { const it = notes.items(a.list); return out(it.length ? `Your ${notes.listName(a.list)} list has ${it.length === 1 ? "one thing" : `${it.length} things`}: ${listSay(it)}.` : `Your ${notes.listName(a.list)} list is empty.`); }
    case "list.remove": { const r = notes.removeItem(a.list, a.item); return out(r ? `Took ${r.removed} off your ${r.list} list.` : `I don't see ${a.item} on your ${notes.listName(a.list)} list.`); }
    case "list.clear": { const r = notes.clearList(a.list); return out(`Cleared your ${r.list} list.`); }
    case "note.add": { if (!a.text) return needFollow(s, intent, ctx, "text"); notes.addNote(a.text); return out(`Noted: ${a.text}.`); }
    case "note.read": { const n = notes.notes(5); return out(n.length ? `Your latest notes: ${n.map((x) => x.text).join("; ")}.` : "You don't have any notes yet. Say \"take a note\" and what to write."); }
    case "note.delete": { const r = notes.removeNote(a.ref); return out(r ? `Deleted the note: ${r.text}.` : "I couldn't find that note."); }
    case "todo.add": { if (!a.title) return needFollow(s, intent, ctx, "title"); const t = store.addTask({ title: cap(a.title) }); return out(`Added ${t.title} to your to-do list.`, { changes: ["update"] }); }
    case "todo.read": { const t = store.tasks(); return out(t.length ? `You have ${t.length} to-do${t.length === 1 ? "" : "s"}: ${listSay(t.slice(0, 8).map((x) => x.title))}${t.length > 8 ? ", and more" : ""}.` : "Your to-do list is empty."); }
    // ---- recipes and cooking
    case "recipe.find": {
      const dish = a.dish || ctx.extra?.dish; if (!dish) return needFollow(s, intent, ctx, "dish");
      try {
        const r = await recipes.findOnline(dish);
        if (!r.results.length) return out(`I couldn't find recipes I can read for ${dish}. Want me to open a web search instead?`, { offerSearch: dish });
        const quick = r.results.filter((x) => x.time).sort((p, q) => p.time - q.time)[0];
        return out(`I found ${r.results.length === 1 ? "one recipe" : `${r.results.length} recipes`} for ${dish}.${quick ? ` The quickest is ${quick.time} minutes from ${quick.site}.` : ""} Which one would you like? Say "the first one", or "save the second one".`, { recipes: r, listen: true });
      } catch (e) { return out(/search isn't available|ECONN|fetch failed|timeout/i.test(e.message) ? "I couldn't reach the internet to look for recipes just now." : e.message); }
    }
    case "recipe.more": { const last = recipes.lastResults(); if (!last) return out("Ask me to find some recipes first."); const r = await recipes.findOnline(last.query, { offset: last.offset + 6 }); return out(r.results.length ? `Here are ${r.results.length} more ${last.query} recipes.` : "That's all the recipes I found. Want me to search again another way?", { recipes: r, listen: true }); }
    case "recipe.pick": {
      const r = recipes.fromResults(a.ref);
      if (!r) return out(recipes.lastResults() ? "Which one? Say the number, like the second one." : "Ask me to find some recipes first.");
      if (a.then === "save") { const saved = await recipes.saveFound(r); return out(`Saved ${saved.title}${r.source?.site ? ` from ${r.source.site}` : ""}. It's in your recipes now.`); }
      if (a.then === "view") return out(`${r.title}${r.source?.site ? `, from ${r.source.site}` : ""}.`, { recipeView: { ...recipes.summary(r), ingredients: r.ingredients, easy: recipes.easySteps(r), source: r.source, remoteImage: r.remoteImage } });
      const c = recipes.startCooking(r);
      return out(`Let's make ${r.title}. ${ingredientsLine(c.ingredients)} Say "next step" when you're ready.`, { cooking: c });
    }
    case "recipe.cook": {
      const name = a.name || ctx.extra?.name;
      const r = name ? recipes.get(name) : null;
      if (!r) { const all = recipes.list(); return out(name ? `I don't have a saved recipe for ${name}. Want me to find one online? Say "find a recipe for ${name}".` : `Which recipe? You have ${listSay(all.slice(0, 6).map((x) => x.title))}.`); }
      const factor = a.scale?.factor ?? (a.scale?.people && r.servings ? a.scale.people / r.servings : 1);
      const c = recipes.startCooking(r, factor);
      return out(`Let's make ${r.title}${factor !== 1 ? `, scaled ${factor === 2 ? "double" : factor === 0.5 ? "by half" : `for ${a.scale?.people ?? ""}`}` : ""}. ${ingredientsLine(c.ingredients)} Say "next step" when you're ready.`, { cooking: c });
    }
    case "recipe.list": {
      const all = a.query ? recipes.searchSaved(a.query) : recipes.list();
      if (!all.length) return out(a.query ? `You don't have a saved recipe for ${a.query}. Want me to find one online?` : "You don't have any saved recipes yet.", { openPage: "/recipes" });
      return out(`You have ${all.length} recipe${all.length === 1 ? "" : "s"}: ${listSay(all.slice(0, 8).map((x) => x.title))}${all.length > 8 ? ", and more" : ""}.`, { openPage: "/recipes" });
    }
    case "recipe.new": { recipes.startDictation(a.title); return out(a.title ? `Okay, a new recipe called ${a.title}. Tell me the ingredients one at a time. Then say "steps" and read me each step. Say "done" to save it.` : "Okay, a new recipe. What's it called?", { listen: true, dictating: true }); }
    case "recipe.import": { if (!a.url) return out("Paste the web address in the Recipes page, or say the full address."); const r = await recipes.importUrl(/^https?:/.test(a.url) ? a.url : `https://${a.url}`); const saved = await recipes.saveFound(r); return out(`Saved ${saved.title}.`); }
    case "recipe.delete": { const r = recipes.get(a.name); if (!r) return out(`I don't have a recipe called ${a.name}.`); recipes.remove(r.id); return out(`Deleted the ${r.title} recipe.`); }
    case "cook.next": case "cook.prev": case "cook.repeat": case "cook.where": case "cook.goto": {
      if (!recipes.cookingNow()) return out("We're not cooking anything right now. Say \"let's make\" and a recipe.");
      const c = a.do === "cook.next" ? recipes.move(1) : a.do === "cook.prev" ? recipes.move(-1) : a.do === "cook.goto" ? recipes.goTo(a.n ?? 1) : recipes.cookingNow();
      if (a.do === "cook.where") return out(c.i < 0 ? `We haven't started yet. There are ${c.total} steps.` : `You're on step ${c.i + 1} of ${c.total}.`, { cooking: c });
      if (c.i >= c.total) { recipes.stopCooking(); return out(`That's the last step. Enjoy your ${c.title}!`, { cooking: null, cookingDone: true }); }
      if (c.i < 0) return out(ingredientsLine(c.ingredients), { cooking: c });
      return out(stepLine(c, s), { cooking: c, listen: Boolean(c.step?.timers?.length) });
    }
    case "cook.ingredients": { const c = recipes.cookingNow(); if (!c) return out("We're not cooking anything right now."); return out(ingredientsLine(c.ingredients), { cooking: c }); }
    case "cook.howmuch": { const c = recipes.cookingNow(); if (!c) return out("We're not cooking anything right now."); const r = recipes.howMuch({ ingredients: c.ingredients }, a.what); return out(r ? `You need ${listSay(r)}.` : `I don't see ${a.what} in this recipe.`); }
    case "cook.scale": { const c = recipes.cookingNow(); if (!c) return out("We're not cooking anything right now."); const r = recipes.get(c.id); const f = a.factor ?? (a.people && r?.servings ? a.people / r.servings : null); if (!f) return out("How many people are you cooking for?"); const n = recipes.setScale(f); return out(`Okay, scaled ${f === 2 ? "to double" : f === 0.5 ? "to half" : `by ${Math.round(f * 100) / 100}`}. ${ingredientsLine(n.ingredients)}`, { cooking: n }); }
    case "cook.stop": { const t = recipes.stopCooking(); return out(t ? `Okay, we're done cooking ${t}.` : "We weren't cooking anything.", { cooking: null }); }
    case "cook.timer": {
      const c = recipes.cookingNow(); const tm = c?.step?.timers?.[0];
      if (!tm) return out("This step doesn't mention a time. Say something like \"set a timer for 10 minutes\".");
      const r = timers.start({ ms: tm.ms, label: tm.label || `step ${c.i + 1}`, step: c.i + 1 });
      return r.full ? out(`You already have ${timers.MAX} timers running.`) : out(`Started a ${r.timer.label} timer for ${sayDuration(tm.ms)}.`, { timers: timers.snapshot() });
    }
    // ---- Dayspring
    case "capabilities": return out(`Even without AI, I can: tell you the time and date; read and change your schedule ("add dentist Friday at 3", "move gym to 7"); run up to 7 timers, a stopwatch and alarms; set reminders; read any Bible passage; the weather; play music and videos; math, conversions and spelling; lists and notes; recipes and cooking step by step; open programs and websites; jokes and fun facts. The Help page has the full list.`, { link: { label: "See everything I can do", url: "/help?embed=1#using-without-ai" } });
    case "help.topic": { const h = deps.help?.(a.text); return h ? (typeof h === "string" ? out(h) : h) : out("I don't have a guide page for that yet.", { clientRun: "open help" }); }
    case "needs.ai": return out(`I need an AI brain to ${a.what}. ${a.offer ?? ""}`.trim(), { link: { label: "How to add AI", url: HELP_AI } });
    case "persona": { const pr = personaHandle(a.text); return pr ?? out("You can pick a personality in Settings → Personality.", { show: "personality" }); }
    // ---- how someone's doing
    case "support": return support(a.kind, s);
    // ---- calendar trivia
    case "date.weekday": {
      if (!a.date) return needFollow(s, intent, ctx, "date");
      const [y, m, d] = a.date.split("-").map(Number); const dt = new Date(y, m - 1, d);
      const past = dt < new Date(now().getFullYear(), now().getMonth(), now().getDate());
      return out(`${dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} ${past ? "was" : "is"} a ${dt.toLocaleDateString("en-US", { weekday: "long" })}.`);
    }
    case "date.leap": return out(ref.leapAnswer(a.year, now()));
    case "date.what": { if (!a.date) return needFollow(s, intent, ctx, "date"); const [y, m, d] = a.date.split("-").map(Number); return out(`${cap(sayDate(a.date, now()))} is ${new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}.`); }
    // ---- home and daily life
    case "dinner.suggest": {
      const all = recipes.list();
      if (!all.length) return out(`You don't have any saved recipes yet. Want ideas? Say "find a recipe for" and something you like, like chicken or pasta.`);
      const favs = all.filter((r) => r.favourite), pool = favs.length ? favs : all;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      return out(`${pickLine(["How about", "Maybe", "What about"])} ${pick.title}${pick.time ? `? It takes about ${pick.time} minutes` : ""}. Say "let's make ${pick.title.toLowerCase()}" to start, or "find a recipe for" something else.`);
    }
    case "reminder.repeat": {
      const text = a.text || ctx.extra?.text;
      if (!text) return needFollow(s, intent, ctx, "text");
      if (!a.time) return needFollow(s, intent, ctx, "time");
      if (a.once) {       // "remind me to take my medicine at 8" (no "every"): once, today or tomorrow
        const r = timers.setAlarm({ hm: a.time, label: text, kind: "reminder" });
        s.undo = () => timers.cancelAlarm(r.id);
        return out(`Okay, at ${say(a.time)} I'll remind you to ${text.replace(/^take your/, "take your")}.`);
      }
      const days = a.days ?? [0, 1, 2, 3, 4, 5, 6];
      const r = timers.setAlarm({ hm: a.time, label: text, kind: "reminder", repeat: { days } });
      s.undo = () => timers.cancelAlarm(r.id);
      return out(`Okay, I'll remind you to ${text} ${daysSay(days)} at ${say(a.time)}.`);
    }
    // ---- health-ish (reminders and breaks only)
    case "health.water": {
      const r = timers.start({ ms: a.every, label: "drink water", every: a.every });
      if (r.full) return out(`You already have ${timers.MAX} timers running. Cancel one first, then ask again.`);
      s.undo = () => timers.cancel(r.timer.id);
      return out(`Okay, I'll remind you to drink water every ${sayDuration(a.every).replace(/^1 /, "")}. Say "stop the water reminders" when you're done.`, { timers: timers.snapshot() });
    }
    case "health.stretch": {
      const r = timers.start({ ms: a.ms, label: "stretch break" });
      if (!r.full) s.undo = () => timers.cancel(r.timer.id);
      return out(`${pickLine(["Good idea.", "Let's move a little.", "Stretch time."])} Stand up, roll your shoulders back a few times, reach up high, then gently turn side to side. Go easy, nothing should hurt. ${r.full ? "" : `I set a ${sayDuration(a.ms)} stretch break timer.`}`.trim(), { timers: timers.snapshot() });
    }
    case "health.breathe": return out("Let's do box breathing together. Breathe in for four, hold for four, out for four, and hold for four. We'll do four rounds.", { breathing: { rounds: 4, steps: [["Breathe in", 4], ["Hold", 4], ["Breathe out", 4], ["Hold", 4]] } });
    // ---- focus
    case "focus.start": {
      const r = timers.start({ ms: a.work, label: "focus", cycle: { work: a.work, rest: a.rest, rounds: a.rounds } });
      if (r.full) return out(`You already have ${timers.MAX} timers running. Cancel one first, then start the focus session.`);
      s.undo = () => timers.cancel(r.timer.id);
      return out(`Focus session started: ${sayDuration(a.work)} of focus, then a ${sayDuration(a.rest)} break, ${a.rounds} rounds. I'll tell you when to switch.`, { timers: timers.snapshot() });
    }
    case "focus.stop": {
      const ids = timers.list().filter((t) => /^(focus|break)( \d+)?$/i.test(t.label) || /^drink water/.test(t.label) && /water/.test(ctx.q)).map((t) => t.id);
      for (const id of ids) timers.cancel(id);
      return out(ids.length ? "Okay, focus session over. Nice work." : "There's no focus session running.", { timers: timers.snapshot() });
    }
    case "day.done": {
      const t = todayIso(), nowHM = hmNow();
      const done = store.blocksBetween(t, t).filter((b) => b.end <= nowHM || b.done);
      return out(done.length ? `So far today: ${listSay(done.map((b) => b.title))}.${done.some((b) => b.done) ? " Nice work." : ""}` : "Nothing on the schedule has finished yet today.");
    }
    case "day.left": {
      const t = todayIso(), nowHM = hmNow();
      const left = store.blocksBetween(t, t).filter((b) => b.end > nowHM && !b.done);
      return out(left.length ? `Still to come today: ${left.map((b) => `${b.title} at ${say(b.start)}`).join(", ")}.` : pickLine(["Nothing else on the schedule today.", "You're all done for today!"]));
    }
    // ---- Dayspring itself
    case "explain": return out({ brightness: "I can't change your screen's brightness myself. On most laptops the brightness keys are on the top row, or open Windows Settings, then System, then Display. On a TV, use its remote." }[a.topic] ?? "I can't do that one myself yet.");
    case "examples": {
      const pool = INTENTS.filter((i) => !["persona", "social", "meta"].includes(i.cat) && i.ex).map((i) => i.ex);
      const five = []; for (let k = 0; five.length < 5 && k < 50; k++) { const e = pool[Math.floor(Math.random() * pool.length)]; if (!five.includes(e)) five.push(e); }
      return out(`Here are a few things you can say: ${five.map((e) => `"${e}"`).join(", ")}. The Help page lists everything.`, { link: { label: "Everything you can say", url: "/help?embed=1#using-without-ai" } });
    }
    // ---- the small offline reference
    case "know.capital": { const r = ref.capitalAnswer(a.text); return r ? out(r) : offerSearch(s, ctx.q, "I don't know that one offline."); }
    case "know.planet": { const r = ref.planetAnswer(a.text); return r ? out(r) : offerSearch(s, ctx.q); }
    case "know.table": return a.n ? out(ref.timesTable(a.n)) : needFollow(s, intent, ctx, "name");
    case "know.question": {
      // a few questions have offline answers after all
      const cap1 = ref.capitalAnswer(ctx.q); if (cap1 && /\bcapital\b/.test(ctx.q)) return out(cap1);
      const pl = /\bplanets?\b|\b(mars|jupiter|saturn|venus|mercury|neptune|uranus|pluto)\b/.test(ctx.q) ? ref.planetAnswer(ctx.q) : null; if (pl) return out(pl);
      return offerSearch(s, a.query);
    }
    // ---- games
    case "game.trivia": {
      const used = s.triviaUsed ?? (s.triviaUsed = []);
      let i; for (let k = 0; k < 20; k++) { i = Math.floor(Math.random() * ref.TRIVIA.length); if (!used.includes(i)) break; }
      used.push(i); if (used.length > 30) used.shift();
      s.trivia = { at: Date.now(), i, tries: 0 };
      return out(ref.TRIVIA[i][0], { listen: true, trivia: true });
    }
    case "game.rps": {
      if (a.pick) { const r = ref.rpsPlay(a.pick); return out(r.line); }
      s.rps = { at: Date.now() };
      return out("Rock, paper, or scissors? Say your pick!", { listen: true });
    }
    case "game.8ball": return out(`${pickLine(["The magic 8-ball says:", "Shaking it… it says:", "Let's see… the 8-ball says:"])} ${ref.EIGHT_BALL[Math.floor(Math.random() * ref.EIGHT_BALL.length)]}`);
    case "game.wyr": return out(ref.WOULD_YOU_RATHER[Math.floor(Math.random() * ref.WOULD_YOU_RATHER.length)], { listen: true });
    // ---- the conversation itself
    case "meta.heard": return out(s.heardBefore ? `I heard: "${s.heardBefore}".` : "I haven't heard anything else yet.");
    case "meta.wrong": {
      const u = s.lastUndo && Date.now() - s.lastUndo.at < 10 * 60_000 ? s.lastUndo : null;
      s.lastUndo = null;
      if (u) { try { await u.fn(); } catch { /* already gone */ } return out(`Sorry about that. I undid it (${u.what.charAt(0).toLowerCase() + u.what.slice(1)}). What did you want?`, { listen: true, timers: timers.snapshot() }); }
      return out("Sorry about that. What did you want me to do? You can say it another way.", { listen: true });
    }
    case "meta.nevermind": { for (const k of ["pick", "follow", "purpose", "confirm", "offer", "trivia", "rps", "knock", "jokeQA"]) s[k] = null; return out(pickLine(["Okay.", "No problem.", "Alright."])); }
    case "jokes.offers": { settings.set({ jokeOffersOn: a.on }); return out(a.on ? "Okay, I'll offer a joke now and then." : "Okay, I'll stop asking about jokes. You can still ask me for one anytime."); }
    case "error": return out(`Something went wrong: ${a.error}`);
  }
  return out("I'm not sure how to do that yet.");
}

// ---- bits of wording ---------------------------------------------------------------------------------------------------
let lineN = 0;
const pickLine = (arr) => arr[(lineN++) % arr.length];
const VOTD = ["John 3:16", "Psalm 23:1", "Philippians 4:13", "Jeremiah 29:11", "Romans 8:28", "Proverbs 3:5-6", "Isaiah 40:31", "Joshua 1:9", "Matthew 11:28", "Psalm 46:1", "2 Corinthians 5:17", "Galatians 5:22-23", "Hebrews 11:1", "Romans 12:2", "Psalm 119:105", "1 Corinthians 13:4-5", "Matthew 6:33", "Lamentations 3:22-23", "Psalm 37:4", "Micah 6:8", "John 14:6", "Ephesians 2:8-9", "Psalm 121:1-2", "Isaiah 41:10", "1 John 4:19", "James 1:5", "Colossians 3:23", "Psalm 34:8", "Romans 15:13", "Zephaniah 3:17"];
function versionsLine() {
  const ok = Object.entries(bible.VERSIONS).filter(([, V]) => !V.unavailable && (!V.key || process.env[V.key])).map(([, V]) => V.name);
  const keyed = Object.entries(bible.VERSIONS).filter(([, V]) => V.key && !process.env[V.key]).map(([, V]) => V.name);
  return `I can read the ${listSay(ok)}${keyed.length ? `, and the ${listSay(keyed)} once a free key is added` : ""}.`;
}
function ingredientsLine(ing) { if (!ing?.length) return ""; return `You'll need: ${ing.slice(0, 14).join("; ")}${ing.length > 14 ? "; and a few more on the screen" : ""}.`; }
function stepLine(c, s) {
  const st = c.step;
  let line = `Step ${c.i + 1} of ${c.total}: ${st.text}`;
  const tm = st.timers?.[0];
  if (tm) { line += ` This step says ${sayDuration(tm.ms)}. Want me to start a ${tm.label || "step"} timer? Say "start the timer".`; }
  return line;
}
function chatLine(kind) {
  const h = now().getHours();
  const lines = {
    morning: ["Good morning! I hope you slept well.", "Good morning. Let's have a good day.", "Morning! Ready when you are."],
    night: ["Good night. Sleep well.", "Sweet dreams. I'll keep an eye on things.", "Good night! See you in the morning."],
    hello: [h < 12 ? "Good morning!" : h < 18 ? "Good afternoon!" : "Good evening!", "Hi there! What can I do for you?", "Hey! What do you need?", "Hello! Good to hear from you."],
    thanks: ["You're welcome!", "Anytime.", "Happy to help.", "Glad I could help."],
    how: ["I'm doing well, thanks for asking. How are you?", "All good here. How about you?", "Pretty great, thanks! How's your day going?"],
    whatsup: ["Not much, just keeping an eye on your day. What's up with you?", "Just here and ready to help. What can I do for you?", "All quiet on my end. What's going on with you?"],
    whoami: ["I'm Dayspring, your day planner and assistant. I keep your schedule, timers, reminders, recipes and more, and I can talk with you, with or without an AI brain."],
    love: ["Aw, that's sweet. I'm always happy to be here for you.", "That makes my day. I'm glad we're friends.", "You're pretty great yourself!"],
    compliment: ["Thank you! That's kind of you.", "Aw, thanks! Happy to help anytime.", "Thanks! You made my day."],
    insult: ["Sorry I let you down. Tell me what you need and I'll try again.", "Oof, fair enough. Let's try that again. What do you need?", "I'm still learning. Tell me another way and I'll do my best."],
    sorry: ["No worries at all.", "That's okay!", "No problem, it happens."],
  };
  return pickLine(lines[kind] ?? ["Okay."]);
}
const YES = /^(yes|yeah|yep|yup|sure|ok|okay|please|do it|go ahead|please do|yes please|sounds good|why not|absolutely|of course)\b/;
const NO = /^(no|nope|nah|not now|no thanks|never ?mind|do not|dont|cancel|stop)\b/;
function support(kind, s) {
  const L = {
    crisis: ["I'm really sorry you're feeling this way, and I'm glad you told me. You don't have to go through this alone. If you're in the US, you can call or text 988 to reach the Suicide and Crisis Lifeline, any time, day or night. If you're in danger right now, please call 911. It could also help to reach out to someone you trust and tell them how you're feeling. I care about you."],
    bored: ["Let's fix that. I could tell you a joke, ask you a trivia question, or play would you rather. Or I can put on some music. What sounds good?", "Bored, huh? Want a trivia question, a fun fact, or a round of rock paper scissors?", "How about a quick game? Say \"trivia\", \"would you rather\" or \"tell me a joke\"."],
    tired: ["Sounds like you've had a lot going on. If you can, take a short break, have some water, and rest your eyes for a few minutes. Want me to set a timer for a quick rest?", "Being tired is hard. Be gentle with yourself today. I can set a 20 minute timer for a power nap if you'd like.", "You've earned a rest. Want me to play something calm, or set a short break timer?"],
    stressed: ["That sounds like a lot. Let's take it one step at a time. Want to do a short breathing exercise with me? Just say \"breathing exercise\".", "I'm sorry it's so much right now. A few slow breaths can help. I can guide you, or put on some calm music. Would that help?", "When it all piles up, it can help to pick just one small thing to do next. I'm here. Want to try a breathing exercise together?"],
    sad: ["I'm sorry you're feeling down. That's really hard. Do you want to talk to someone you trust about it? I can also put on some calm music or read you an encouraging verse.", "I'm here with you. Some days are just heavy. Would a little music, or a kind word from a verse, help right now?", "That sounds tough, and it's okay to feel that way. Maybe reach out to a friend today. I'm here if you want some calm music or a gentle verse."],
    lonely: ["I'm here, and I'm glad you're talking to me. Is there a friend or family member you could call today? Even a short chat can help.", "You're not alone right now. I'm right here. Want to hear a joke, or maybe call someone you care about?", "I'm happy to keep you company. Want a fun fact, a game, or some music?"],
    happy: ["That's wonderful! I'm so happy for you.", "Yes! That's great news. Congratulations!", "Love to hear it! That's awesome."],
  };
  return out(pickLine(L[kind] ?? ["I'm here for you."]), { support: kind });
}
// the personality's own commands (lib/persona): "be a pirate", "be normal", and the yes/no to its questions
function personaHandle(text) {
  let pr = null;
  try { pr = persona.handle(text); } catch { return null; }
  if (!pr) return null;
  const show = typeof pr === "object" ? pr.show ?? null : null;
  return out(typeof pr === "string" ? pr : pr.reply, { ...(show ? { show } : {}), intent: "persona" });
}
// Dayspring's own words, in the chosen personality (facts, times and names never change; plain for timers and health)
const STYLE_KIND = { "timer.start": "done", "timer.cancel": "done", "alarm.set": "done", "reminder.set": "done", "reminder.repeat": "done", "list.add": "done", "note.add": "done", "todo.add": "done",
  "sched.add": "schedule", "sched.move": "schedule", "sched.day": "schedule", "sched.next": "schedule", "sched.now": "schedule", "health.medicine": "medication", "health.water": "health", "health.breathe": "health",
  "health.stretch": "health", "social.crisis": "safety", "greet.hello": "greeting", "greet.morning": "greeting", "greet.evening": "greeting", "greet.night": "goodbye", "meta.nevermind": "ack", "calc": "reply", "convert": "reply" };
async function styled(text, intent) {
  if (!text || intent.cat === "personality" || intent.id === "social.crisis") return text;
  try { return persona.style(text, { kind: STYLE_KIND[intent.id] ?? (["bible", "weather", "time"].includes(intent.cat) ? "reply" : "reply") }) || text; } catch { return text; }
}
// "every day" / "on weekdays" / "every Tuesday"
function daysSay(days) {
  const D = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  if (days.length === 7) return "every day";
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return "every weekday";
  if (days.length === 2 && days.includes(0) && days.includes(6)) return "every weekend";
  return "every " + listSay(days.map((d) => D[d]));
}
// "I'd need AI or the internet to answer that well. Want me to search the web?" → yes → the search, read out and shown
function offerSearch(s, query, lead = "") {
  const q = String(query ?? "").trim();
  s.offer = { at: Date.now(), yes: async () => webAnswer(q) };
  return out(`${lead ? lead + " " : ""}I'd need AI or the internet to answer that well. Want me to search the web?`, { listen: true, offer: "search" });
}
async function webAnswer(q) {
  if (deps.webSearch) {
    try {
      const r = await deps.webSearch(q, { max: 5 });
      const hits = (r.results ?? []).filter((x) => x.title && /^https?:/.test(x.url ?? "")).slice(0, 5);
      if (hits.length) {
        const site = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
        return out(`Here's what I found. ${hits.slice(0, 3).map((h, i) => `${i + 1}: ${h.title}, from ${site(h.url)}.`).join(" ")}${hits[0].snippet ? ` The first one says: ${String(hits[0].snippet).slice(0, 200)}` : ""}`, { webResults: { query: q, results: hits.map((h) => ({ title: String(h.title).slice(0, 140), url: h.url, site: site(h.url), snippet: String(h.snippet ?? "").slice(0, 240) })) } });
      }
    } catch { /* fall through to the browser */ }
  }
  const o = await deps.openUrl(`https://www.google.com/search?q=${encodeURIComponent(q)}`);
  return out(o.opened || o.dryRun ? `I opened a web search for that in your browser.` : "I couldn't reach the internet just now.");
}
// trivia: a guess, "I don't know", or "another one"
function answerTrivia(s, q) {
  const t = s.trivia, [question, answers, said] = ref.TRIVIA[t.i];
  if (/^(i (do not|dont) know|no idea|idk|tell me|what is it|i give up|pass|skip)\b/.test(q)) { s.trivia = null; return out(`The answer is ${said.replace(/\.$/, "")}. Want another? Say "another question".`); }
  const words = q.replace(/\b(is it|it is|i think|maybe|the answer is|um|uh|a|an|the)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!words || words.split(" ").length > 6) return null;          // a new request, not a guess
  const right = answers.some((a) => words.includes(a) || lev(words, a, 2) <= (a.length > 5 ? 2 : 0));
  if (right) { s.trivia = null; return out(`${pickLine(["That's right!", "Correct!", "Yes! Nice one.", "You got it!"])} ${said} Want another? Say "another question".`); }
  t.tries++;
  if (t.tries >= 2) { s.trivia = null; return out(`Not quite. The answer is ${said.replace(/\.$/, "")}. Want another?`); }
  return out(pickLine(["Not quite. Try once more!", "Close, but no. One more guess?", "Nope, try again!"]), { listen: true });
}
function answerRps(s, q) {
  const m = /\b(rock|paper|scissors)\b/.exec(q);
  if (!m) { if (q.split(" ").length <= 2) { s.rps = null; return out("Okay, maybe next time."); } return null; }
  s.rps = null;
  return out(ref.rpsPlay(m[1]).line + " Want to play again?");
}
// phrases that didn't match anything well: kept (words only, on this computer) so they can be taught in Settings
const MISS_FILE = () => process.env.DAYSPRING_INTENT_MISSES || join(ROOT, "data", "intent-misses.json");
let missDb = null;
function missLoad() { if (!missDb) { try { missDb = existsSync(MISS_FILE()) ? JSON.parse(readFileSync(MISS_FILE(), "utf8")) : { items: [] }; } catch { missDb = { items: [] }; } } return missDb; }
function missSave() { try { mkdirSync(dirname(MISS_FILE()), { recursive: true }); writeFileSync(MISS_FILE() + ".tmp", JSON.stringify(missDb)); renameSync(MISS_FILE() + ".tmp", MISS_FILE()); } catch { /* not fatal */ } }
export function logMiss(text) {
  if (settings.get().logMisses === false) return;
  const t = String(text ?? "").trim().slice(0, 160);
  if (!t || t.length < 3) return;
  const d = missLoad(); const hit = d.items.find((x) => x.text === t);
  if (hit) { hit.count++; hit.last = new Date().toISOString(); } else d.items.push({ text: t, count: 1, last: new Date().toISOString() });
  d.items.sort((a, b) => b.last.localeCompare(a.last)); d.items = d.items.slice(0, 200);
  missSave();
}
export const misses = () => missLoad().items.slice();
export function clearMisses() { missDb = { items: [] }; missSave(); return { cleared: true }; }
// "this means: set a timer" — taught in Settings, remembered like a pick from the list
export function teach(text, id) {
  if (!byId.get(id)) throw new Error("I don't know that action.");
  const q = normalize(text); if (!q) throw new Error("Type the phrase to teach.");
  learn(q, id);
  const d = missLoad(); d.items = d.items.filter((x) => x.text !== q && x.text !== String(text).trim()); missSave();
  return { taught: q, id };
}
// counting out loud, up to 100
function count(a, s) {
  let { from, to, step, down } = a;
  step = Math.max(1, Math.abs(step || 1));
  if (Math.max(from, to) > 100) { s.confirm = { at: Date.now(), intent: byId.get("count"), ctx: { q: "count to 100", slots: { numbers: [100] }, extra: {} } }; return out("I can count up to 100. Want me to count to 100?", { listen: true }); }
  const seq = [];
  if (down || from > to) { for (let n = Math.max(from, to); n >= Math.min(from, to) && seq.length < 101; n -= step) seq.push(n); }
  else for (let n = from; n <= to && seq.length < 101; n += step) seq.push(n);
  if (!seq.length) return out("Nothing to count there.");
  return out(seq.join(", ") + (down && seq.at(-1) <= 1 ? "!" : "."), { count: { numbers: seq } });
}

// ---- jokes: the jokes module when it's there, else the built-in few --------------------------------------------------------
// XP (lib/xp), when it's there
let xpMod = null;
async function xpLib() { if (xpMod !== null) return xpMod; try { xpMod = await import("../xp/index.mjs"); } catch { xpMod = false; } return xpMod; }
async function jokesLib() { if (deps.jokes !== null) return deps.jokes; try { deps.jokes = await import("../jokes/index.mjs"); } catch { deps.jokes = false; } return deps.jokes; }
// a style, not a subject: any joke will do ("tell me a dad joke", "something corny")
const ANY_STYLE = /^(dad|dads|corny|cheesy|bad|silly|clean|funny|good|punny|pun|puns|random|short|quick|dumb|lame|new|another|a|one|different)$/;
async function tellJoke(s, a, q = "") {
  const lib = await jokesLib();
  if (a.kind === "list") {
    const cats = lib?.categories ? lib.categories().map((c) => String(c.label ?? c.id).toLowerCase()) : [];
    return out(cats.length ? `I know jokes about ${listSay(cats.slice(0, 10))}, and more: ${cats.length} kinds in all, plus knock-knock jokes and kids' jokes. Just ask for one!` : "I know lots of silly jokes, and knock-knock jokes. Just ask!");
  }
  let j = null, note = "";
  if (lib?.pick) {
    let category = null, type = a.type ?? undefined, exclude;
    const w = String(a.category ?? "").toLowerCase().replace(/^(about|on|for) /, "").replace(/ jokes?$/, "").trim();
    if (w && /^(kids?|children|little ones)$/.test(w)) exclude = lib.JOKES.filter((x) => !(x.tags ?? []).includes("kids")).map((x) => x.id);
    else if (w && !ANY_STYLE.test(w)) {
      const f = lib.find(`${w} joke`);
      if (f?.category) category = f.category; if (f?.type) type = f.type;
      if (!f) note = `I don't know any ${w} jokes, but here's one. `;
    }
    // "a different kind": another type, and another subject, than the last one
    if (/\bdifferent\b/.test(q) && s.lastJoke) {
      const types = ["qa", "oneliner", "knock"].filter((t) => t !== s.lastJoke.type);
      type = types[Math.floor(Math.random() * types.length)];
      if (s.lastJoke.category) exclude = lib.JOKES.filter((x) => x.category === s.lastJoke.category).map((x) => x.id);
    }
    j = lib.pick({ category: category ?? undefined, type, exclude });
    if (j) { const sp = lib.speakable(j); j = { ...j, pauseMs: sp.pause_ms, lines: j.type === "knock" ? lib.knockLines(j) : null }; }
  }
  if (!j) return out("I'm all out of jokes just now. Ask me again in a bit!");
  s.lastJoke = j;
  try { if (typeof persona.event === "function") persona.event("joke"); } catch { /* the personality's own business */ }
  // typed (or read, not heard): the whole joke at once
  if (s.typed) {
    if (j.type === "knock") return out(`${note}Knock knock. Who's there? ${j.setup}. ${j.setup} who? ${j.punchline}`, { joke: { type: "knock", straight: true, setup: j.setup, punchline: j.punchline } });
    return out(`${note}${j.setup}${j.punchline ? " " + j.punchline : ""}`, { joke: { type: j.type, straight: true, setup: j.setup, punchline: j.punchline } });
  }
  if (j.type === "knock") { s.knock = { at: Date.now(), dir: "mine", joke: j, stage: "who-there" }; return out(`${note}Knock knock.`, { listen: true, joke: { type: "knock", stage: 1, setup: j.setup, punchline: j.punchline } }); }
  if (j.type === "qa") { s.jokeQA = { at: Date.now(), joke: j }; return out(`${note}${j.setup}`, { listen: true, joke: { type: "qa", setup: j.setup, punchline: j.punchline, pauseMs: j.pauseMs ?? 1200 } }); }
  return out(`${note}${j.setup}${j.punchline ? " " + j.punchline : ""}`, { joke: { type: "oneliner", setup: j.setup, punchline: j.punchline, pauseMs: j.punchline ? j.pauseMs ?? 900 : 0 } });
}
function answerJokeQA(s, q) {
  const j = s.jokeQA.joke; s.jokeQA = null;
  // a new request rather than a guess ("what time is it", "set a timer for 5 minutes"): the punchline waits for nobody
  if (/^knock knock\b/.test(q)) return null;
  if (!/^(is it|because|maybe|i think|i guess|a |an |the )/.test(q)) { const { ranked } = rank(q, { state: contextState() }); const top = ranked[0]; if (top && (top.score >= 0.92 || (top.score >= 0.8 && q.split(" ").length > 2))) return null; }
  if (/^(what|i do not know|idk|no idea|i give up|tell me|why|how|who|what is it|go on)\b/.test(q) || q.length < 3) return out(j.punchline, { joke: { type: "punch" } });
  const guess = q.split(" ").filter((w) => w.length > 3), punch = normalize(j.punchline);
  const right = guess.length && guess.filter((w) => punch.includes(w)).length >= Math.ceil(guess.length / 2);
  return out(`${right ? "Ha, you got it! " : pickLine(["Good guess! ", "Ooh, close! ", "Nice try! "])}${j.punchline}`, { joke: { type: "punch" } });
}
const WHO_THERE = /^(who is there|whos there|who s there|whose there|who is their|whos their|who there|who is it|who)\b/;
function answerKnock(s, q, raw) {
  const k = s.knock;
  if (k.dir === "mine") {
    if (k.stage === "who-there") { if (WHO_THERE.test(q) || /\bthere\b/.test(q)) { k.stage = "who"; k.at = Date.now(); return out(`${k.joke.setup}.`, { listen: true, joke: { type: "knock", stage: 2, setup: k.joke.setup, punchline: k.joke.punchline } }); } s.knock = null; return null; }
    if (k.stage === "who") { s.knock = null; return out(k.joke.punchline, { joke: { type: "knock", stage: 3 } }); }
  } else {
    if (k.stage === "wait-knock") { if (/^knock knock/.test(q)) { k.stage = "who"; k.at = Date.now(); return out("Who's there?", { listen: true }); } s.knock = null; return null; }
    if (k.stage === "who") { k.name = String(raw).replace(/[.!?]+$/, "").trim(); k.stage = "punch"; k.at = Date.now(); return out(`${cap(k.name)} who?`, { listen: true }); }
    if (k.stage === "punch") { s.knock = null; return out(pickLine(["Ha! That's a good one.", "Hahaha! I didn't see that coming.", "Oh, that's great. I'm stealing that one.", "Ha! Groan-worthy. I love it."]), { joke: { type: "laugh" } }); }
  }
  s.knock = null; return null;
}
async function answerJokeOffer(s, q, surface) {
  s.jokeOffer = null;
  if (/^(yes|yeah|sure|ok|okay|go ahead|why not|please|lets hear it|let us hear it|hit me|of course|absolutely|yep)\b/.test(q)) return tellJoke(s, { kind: "tell" });
  if (/^(no|nope|nah|not now|maybe later|later|not really|no thanks|i am good|im good)\b/.test(q)) { offers.skipNext = true; return out("Okay!"); }
  if (/\b(stop|do not|dont) (asking|offering)\b.*\bjokes?\b|\bno more joke\b/.test(q)) { settings.set({ jokeOffersOn: false }); return out("Okay, I'll stop asking about jokes. You can still ask me for one anytime."); }
  return null;
}
function answerPurpose(s, q, raw) {
  const p = s.purpose; s.purpose = null;
  // a new command, not an answer
  const { ranked } = rank(raw, { state: contextState() });
  if (ranked[0] && ranked[0].score >= 0.72 && q.split(" ").length > 2) return null;
  if (q.split(" ").length > 6) return null;
  const r = timers.setPurpose(p.id, q);
  if (!r) return null;
  return out(r.kept ? "Okay, just a timer." : pickLine([`Got it, the ${r.label} timer.`, `Okay, ${r.label}.`, `The ${r.label} timer, got it.`]), { timers: timers.snapshot() });
}
function answerDictation(q, raw) {
  const r = recipes.dictate(raw);
  if (!r) return null;
  if (r.saved) return out(`Saved your ${r.saved.title} recipe, with ${r.saved.ingredients.length} ingredients and ${recipes.flatSteps(r.saved).length} steps.`);
  if (r.cancelled) return out("Okay, I didn't save it.");
  if (r.stage === "ingredients" && !r.added) return out(`Okay. Now the ingredients, one at a time. Say "steps" when you're ready for the steps.`, { listen: true });
  if (r.stage === "steps" && !r.added) return out(`Okay, the steps. Read me step one.`, { listen: true });
  return out(r.stage === "steps" ? `Step ${r.count}, got it.` : `Got it.`, { listen: true });
}

// ---- joke offers (personality: funny) -----------------------------------------------------------------------------------
const OFFER_FILE = () => process.env.DAYSPRING_JOKE_OFFERS || join(ROOT, "data", "joke-offers.json");
export const offers = { skipNext: false };
function offerLog() { try { const d = JSON.parse(readFileSync(OFFER_FILE(), "utf8")); return d.date === todayIso() ? d : { date: todayIso(), offers: [] }; } catch { return { date: todayIso(), offers: [] }; } }
function saveOffers(d) { try { mkdirSync(dirname(OFFER_FILE()), { recursive: true }); writeFileSync(OFFER_FILE() + ".tmp", JSON.stringify(d)); renameSync(OFFER_FILE() + ".tmp", OFFER_FILE()); } catch { /* fine */ } }
// should Dayspring offer a joke now? (the caller supplies what it knows about the room)
export function jokeOfferDue(env = {}) {
  const s = settings.get();
  let playful = false; try { playful = persona.jokeOffersAllowed(); } catch { /* no personality module */ }
  if (!playful || s.jokeOffersOn === false || !(s.jokeOffers > 0)) return false;
  if (s.listenState !== "active" || env.stopped || env.muted || env.textOnly || env.inCall || env.alarm || env.timerRinging || env.cooking || env.morning || env.meeting || env.speaking) return false;
  if ((s.notifyAll && s.notifyAll !== "voice") || (s.mode && s.mode !== "voice")) return false;
  if (!env.lastActivity || Date.now() - env.lastActivity > 45 * 60_000) return false;
  const h = now().getHours() + now().getMinutes() / 60;
  if (h < 9 || h > 20.5) return false;
  const log = offerLog();
  if (log.offers.length >= s.jokeOffers) return false;
  const last = log.offers.at(-1);
  if (last && Date.now() - Date.parse(last.at) < 2 * 3600_000) return false;
  if (offers.skipNext) { offers.skipNext = false; log.offers.push({ at: new Date().toISOString(), skipped: true }); saveOffers(log); return false; }
  return (env.random ?? Math.random)() < (env.chance ?? 0.08);
}
export function makeJokeOffer(surface = "tv") {
  const log = offerLog(); log.offers.push({ at: new Date().toISOString() }); saveOffers(log);
  st(surface).jokeOffer = { at: Date.now() };
  return pickLine(["Want to hear a joke?", "I've got a good one. Want to hear it?", "Time for a joke break?", "Can I tell you a joke?"]);
}
export const offersToday = () => offerLog().offers.length;

export { stats, build, prepare, rank };
export const INTENT_LIST = () => INTENTS.map((i) => ({ id: i.id, cat: i.cat, label: typeof i.label === "string" ? i.label : i.id, example: i.ex }));
