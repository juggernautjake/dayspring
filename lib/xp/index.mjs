// XP: earned only by checking in on real tasks (and, for studying or reading, showing what you learned).
// For now XP unlocks the secret characters (lib/persona/secrets.mjs); it's built to grow into more later.
//   balance() · lifetime() · level() · streak() · award() · spend() · priceFor() · history() · undoLast()
//   checkin.start(category, context) · checkin.answer(text) · handle(text) (voice and typed phrases) · unlockCharacter()
// Everything is local and private: the ledger (data/xp-ledger.jsonl) and the settings (data/xp-settings.json).
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as R from "./rules.mjs";
import { createLedger } from "./ledger.mjs";
import * as ev from "./evidence.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let deps = {
  now: () => Date.now(),
  dataDir: join(HERE, "..", "..", "data"),
  llm: null,                          // { ready(), complete() } for the study/reading follow-ups (optional)
  persona: null,                      // lib/persona/index.mjs (for unlocking secret characters)
  addPrayer: null,                    // (text) => void, "anything to add to your prayer list?"
};
let ledger = null;
const listeners = new Set();
export function setDeps(d) { const dirChanged = d.dataDir && d.dataDir !== deps.dataDir; deps = { ...deps, ...d }; if (dirChanged) { ledger = null; settingsCache = null; } }
export const onEvent = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (type, data) => { for (const fn of listeners) { try { fn(type, data); } catch { /* a listener's problem */ } } };
const L = () => (ledger ??= createLedger(join(deps.dataDir, "xp-ledger.jsonl")));
export const _reset = () => { ledger = null; settingsCache = null; sessions.clear(); asked.clear(); };

// ---- settings (Settings → XP) ------------------------------------------------------------------------------------------
const SETTINGS_DEFAULT = { enabled: true, reminders: Object.fromEntries(R.CATEGORY_IDS.map((c) => [c, true])), checkinTimes: ["20:30"] };
let settingsCache = null;
const SFILE = () => join(deps.dataDir, "xp-settings.json");
export function settings() {
  if (settingsCache) return settingsCache;
  let s = {};
  try { if (existsSync(SFILE())) s = JSON.parse(readFileSync(SFILE(), "utf8")); } catch { /* damaged: defaults */ }
  settingsCache = { ...SETTINGS_DEFAULT, ...s, reminders: { ...SETTINGS_DEFAULT.reminders, ...(s.reminders ?? {}) } };
  return settingsCache;
}
export function setSettings(patch = {}) {
  const next = { ...settings(), ...patch, reminders: { ...settings().reminders, ...(patch.reminders ?? {}) } };
  if (next.checkinTimes) next.checkinTimes = [...new Set(next.checkinTimes.filter((t) => /^\d{2}:\d{2}$/.test(t)))].slice(0, 4);
  mkdirSync(deps.dataDir, { recursive: true });
  const tmp = SFILE() + ".tmp"; writeFileSync(tmp, JSON.stringify(next, null, 2)); renameSync(tmp, SFILE());
  settingsCache = next; emit("settings", next); return next;
}
export const enabled = () => settings().enabled !== false;

// ---- time helpers --------------------------------------------------------------------------------------------------------
const dayOf = (ms) => new Date(ms).toLocaleDateString("en-CA");
const today = () => dayOf(deps.now());
const addDays = (day, n) => { const d = new Date(day + "T12:00:00"); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };

// ---- reading the ledger ----------------------------------------------------------------------------------------------------
export const balance = () => L().balance();
export const lifetime = () => L().lifetime();
export const level = () => R.levelFor(lifetime());
export function streak() {
  const days = new Set(L().awards().filter((e) => e.amount > 0).map((e) => e.day));
  let d = today(), n = 0, saversUsed = 0; const usedMonths = new Set();
  if (!days.has(d)) d = addDays(d, -1);                         // today not done yet: the streak still stands from yesterday
  for (let guard = 0; guard < 3660; guard++) {
    if (days.has(d)) { n++; d = addDays(d, -1); continue; }
    // one missed day a month doesn't break it (only between two real days)
    const month = d.slice(0, 7), prev = addDays(d, -1);
    if (n > 0 && days.has(prev) && !usedMonths.has(month) && R.STREAK_SAVERS_PER_MONTH > 0) { usedMonths.add(month); saversUsed++; d = prev; continue; }
    break;
  }
  return { days: n, saversUsed, doneToday: days.has(today()) };
}
export function history({ limit = 30 } = {}) {
  const reversed = new Set(L().entries().filter((e) => e.type === "reversal").map((e) => e.reverses));
  return L().entries().slice(-limit).reverse().map((e) => ({ ...e, reversed: reversed.has(e.id) }));
}
// XP per day for the last n days (the Progress chart)
export function daily(n = 14) {
  const out = []; for (let i = n - 1; i >= 0; i--) { const d = addDays(today(), -i); out.push({ day: d, xp: L().dayTotal(d) }); }
  return out;
}
export const priceFor = R.priceFor;
export const rules = () => ({ dailyCap: R.DAILY_CAP, selfReport: R.SELF_REPORT_FACTOR, minGapHours: R.MIN_GAP_HOURS, levelStep: R.LEVEL_STEP,
  characterFirst: R.CHARACTER_FIRST, characterStep: R.CHARACTER_STEP, categories: Object.fromEntries(Object.entries(R.CATEGORIES).map(([id, c]) => [id, { label: c.label, base: c.base ?? null, perHour: c.perHour ?? null, maxHours: c.maxHours ?? null, bonus: c.bonus ?? 0, max: c.max, proof: c.proof }])) });

// ---- earning -------------------------------------------------------------------------------------------------------------
// What a check-in is worth (no side effects). opts: fraction (0–1), source ("block"|"timer"|"self"), hours (work),
// score (0–3, for study/reading proof), fp (evidence fingerprint), day ("YYYY-MM-DD", today or yesterday).
export function quote(category, { fraction = 1, source = "self", hours = 1, score = null, fp = null, day = today() } = {}) {
  const c = R.CATEGORIES[category];
  if (!c) return { amount: 0, reason: "unknown", message: "I don't know that kind of task." };
  if (!enabled()) return { amount: 0, reason: "off", message: "XP is turned off in Settings." };
  const t = today();
  if (day !== t && day !== addDays(t, -R.MAX_DAYS_BACK)) return { amount: 0, reason: "too-old", message: "I can only count today or yesterday." };
  const done = L().onDay(day, category);
  if (done.length >= c.max) return { amount: 0, reason: "category-cap", message: `You've already checked in ${c.label.toLowerCase()} ${c.max === 1 ? "today" : `${c.max} times today`}.` };
  const last = L().lastOf(category);
  if (last && deps.now() - Date.parse(last.at) < R.MIN_GAP_HOURS * 3600_000) return { amount: 0, reason: "too-soon", message: `That one was just counted. Check in again after ${R.MIN_GAP_HOURS} hours.` };
  if (fp && L().fingerprints().has(fp)) return { amount: 0, reason: "duplicate", message: "That's the same as an earlier answer, so it can't count twice." };
  let amount = c.perHour ? c.perHour * Math.min(Math.max(0, Number(hours) || 0), c.maxHours) : c.base;
  if (c.proof === "learned") {
    if (score === 0) return { amount: 0, reason: "no-proof", message: "I couldn't count that one without something you learned." };
    if (score === 1) amount *= 0.5;
    if (score === 3) amount += c.bonus ?? 0;
  }
  const f = fraction >= 1 ? 1 : fraction <= 0 ? 0 : Math.max(R.PARTIAL_MIN, fraction);
  amount *= f;
  if (source === "self") amount *= R.SELF_REPORT_FACTOR;
  const st = streak();
  const streakDay = st.doneToday ? st.days : st.days + 1;
  if (streakDay >= R.STREAK_BONUS_FROM) amount *= 1 + R.STREAK_BONUS;
  amount = Math.round(amount);
  const room = Math.max(0, R.DAILY_CAP - L().dayTotal(day));
  const capped = amount > room;
  amount = Math.min(amount, room);
  if (amount <= 0) return { amount: 0, reason: capped ? "daily-cap" : "zero", message: capped ? `You've reached today's ${R.DAILY_CAP} XP. Great work — it'll count again tomorrow.` : "That one didn't earn XP." };
  return { amount, capped, reason: "ok", streakBonus: streakDay >= R.STREAK_BONUS_FROM };
}
// Record a check-in. Returns { ok, amount, balance, level, levelUp, message }.
export function award(category, { fraction = 1, source = "self", hours = 1, score = null, evidence = "", day = today(), title = "" } = {}) {
  const proof = R.CATEGORIES[category]?.proof;
  const fp = proof === "learned" && evidence ? ev.fingerprint(evidence) : null;
  const q = quote(category, { fraction, source, hours, score, fp, day });
  if (!q.amount) return { ok: false, amount: 0, reason: q.reason, message: q.message, balance: balance() };
  const before = level();
  const e = L().append({ at: new Date(deps.now()).toISOString(), day, type: "award", amount: q.amount, category, source, evidence: String(evidence ?? "").slice(0, 600), fp, title: String(title ?? "").slice(0, 80) });
  const after = level();
  const res = { ok: true, amount: q.amount, capped: q.capped, streakBonus: q.streakBonus, balance: balance(), level: after, levelUp: after.level > before.level, entry: e.id };
  emit("award", { ...res, category, label: R.CATEGORIES[category].label, evidence: e.evidence });
  if (res.levelUp) emit("levelup", after);
  return res;
}
export function spend(amount, { reason = "", ref = null } = {}) {
  amount = Math.round(Number(amount) || 0);
  if (amount <= 0) throw new Error("Nothing to spend.");
  const b = balance();
  if (b < amount) return { ok: false, short: amount - b, balance: b };
  L().append({ at: new Date(deps.now()).toISOString(), day: today(), type: "spend", amount, reason, ref });
  emit("spend", { amount, reason, ref, balance: balance() });
  return { ok: true, balance: balance() };
}
// "undo my last check-in": the most recent award, within 10 minutes
export function undoLast() {
  const a = L().awards(); const last = a[a.length - 1];
  if (!last) return { ok: false, message: "There's no check-in to undo." };
  if (deps.now() - Date.parse(last.at) > R.UNDO_MINUTES * 60_000) return { ok: false, message: `I can only undo a check-in within ${R.UNDO_MINUTES} minutes.` };
  L().append({ at: new Date(deps.now()).toISOString(), day: last.day, type: "reversal", amount: -last.amount, reverses: last.id, category: last.category });
  emit("undo", { amount: last.amount, balance: balance() });
  return { ok: true, amount: last.amount, balance: balance(), message: `Undone. I took back ${last.amount} XP.` };
}

// ---- secret characters ---------------------------------------------------------------------------------------------------
// Secret characters are FOUND for free (lib/persona: a phrase, a slider combo, something you do) and then UNLOCKED with
// XP here. The persona module keeps what's unlocked and calls back into priceFor()/spend(); these helpers just ask it.
const secretsView = () => { const s = deps.persona?.secrets; const v = typeof s?.view === "function" ? s.view() : typeof s === "function" ? s() : null; return v?.list ?? []; };
export function unlockables() {
  return secretsView().map((s) => ({ id: s.id, found: Boolean(s.discovered ?? !s.locked), unlocked: Boolean(s.unlocked), name: s.name ?? null, icon: s.icon ?? null, hint: s.hint ?? null, price: s.unlocked ? 0 : s.cost ?? null }));
}
export async function unlockCharacter(id) {
  const p = deps.persona; if (!p?.unlockSecret) return { ok: false, message: "Characters aren't available." };
  const list = unlockables();
  const target = id ? list.find((s) => s.id === id) : list.find((s) => s.found && !s.unlocked);
  if (!target) return { ok: false, message: list.some((s) => !s.found) ? "Find a secret character first. Then you can unlock it with XP." : "You've unlocked every character you've found!" };
  if (!target.found) return { ok: false, message: "Find that character first. Then you can unlock it with XP." };
  const r = await p.unlockSecret(target.id);
  return r?.ok ? { ...r, message: r.already ? `${r.name ?? "That character"} is already unlocked.` : `${r.text ?? "Unlocked!"} (${r.cost} XP)` } : { ok: false, short: r?.short ?? null, message: r?.message ?? "I couldn't unlock that." };
}

// ---- check-ins -------------------------------------------------------------------------------------------------------------
const sessions = new Map();           // surface → session
const SESSION_MS = 10 * 60_000;
const YES = /^(yes|yeah|yep|yup|sure|i did|did it|done|all done|finished|completed|all of it|the whole thing|absolutely|of course|mostly done)\b/;
const NO = /^(no|nope|nah|not yet|didn'?t|did not|i didn'?t|haven'?t|i haven'?t|not today|missed it|couldn'?t)\b/;
const SKIP = /^(skip|never ?mind|forget it|cancel|stop|not now|later)\b/;
const norm = (t) => String(t ?? "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9%'\s.]/g, " ").replace(/\s+/g, " ").trim();
export function parseFraction(text) {
  const t = norm(text);
  const pct = /(\d{1,3})\s*(%|percent)/.exec(t); if (pct) return Math.min(1, Number(pct[1]) / 100);
  if (/\b(half|halfway|50 50)\b/.test(t)) return 0.5;
  if (/\b(most|mostly|almost|nearly|three quarters)\b/.test(t)) return 0.75;
  if (/\b(a little|a bit|some of it|partly|partially|part of it|started|a quarter|not all)\b/.test(t)) return 0.25;
  if (NO.test(t)) return 0;
  if (YES.test(t) || /\b(finished|completed|did it all|all of it|done)\b/.test(t)) return 1;
  return null;
}
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5 };
export function parseHours(text) {
  const t = norm(text);
  let h = 0, found = false;
  const hm = /(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six)\s*(?:and a half\s*)?(hours?|hrs?|h)\b(\s*and a half)?/.exec(t);
  if (hm) { h += Number(NUM[hm[1]] ?? hm[1]); if (/and a half/.test(hm[0])) h += 0.5; found = true; }
  const mm = /(\d+)\s*(minutes?|mins?|m)\b/.exec(t);
  if (mm) { h += Number(mm[1]) / 60; found = true; }
  if (!found && /\bhalf an hour\b/.test(t)) { h = 0.5; found = true; }
  return found ? Math.round(h * 100) / 100 : null;
}
const labelOf = (c, ctx) => (ctx?.title ? ctx.title : R.CATEGORIES[c].label.toLowerCase());
const fmt = (res, cat) => {
  const lv = res.level ?? level();
  return `+${res.amount} XP for ${R.CATEGORIES[cat].verb}.${res.streakBonus ? " Streak bonus!" : ""}${res.capped ? " That's today's limit." : ""} You have ${res.balance} XP · Level ${lv.level} ${lv.title}.${res.levelUp ? ` 🎉 Level up: you're now a ${lv.title}!` : ""}`;
};
export const checkin = {
  // context: { source: "block"|"timer"|"self", title, blockId, day, done: true, fraction, hours }
  start(category, context = {}, surface = "tv") {
    if (!R.CATEGORIES[category]) throw new Error("Unknown check-in category.");
    if (!enabled()) return { prompt: null, message: "XP check-ins are turned off in Settings." };
    const s = { category, ctx: { source: "self", day: today(), ...context }, stage: "completion", fraction: null, at: deps.now() };
    sessions.set(surface, s);
    if (context.done || context.fraction != null) { s.fraction = context.fraction ?? 1; return this._proof(s, surface); }
    return { prompt: `Did you finish your ${labelOf(category, s.ctx)}? You can say yes, partly, or no.`, stage: "completion" };
  },
  _proof(s, surface) {
    const c = R.CATEGORIES[s.category];
    if (c.proof === "hours" && s.ctx.hours) return this._finish(s, surface, { hours: s.ctx.hours });
    if (c.proof === "honour") {
      const r = this._finish(s, surface, {}, { keep: Boolean(c.ask) });
      if (c.ask && r.result?.ok) { s.stage = "extra"; return { ...r, prompt: c.ask, stage: "extra" }; }
      sessions.delete(surface);
      return r;
    }
    s.stage = "proof";
    return { prompt: c.ask, stage: "proof" };
  },
  _finish(s, surface, extra = {}, { keep = false } = {}) {
    const res = award(s.category, { fraction: s.fraction ?? 1, source: s.ctx.source, day: s.ctx.day, title: s.ctx.title, ...extra });
    if (!keep) sessions.delete(surface);
    return { done: true, result: res, message: res.ok ? fmt(res, s.category) : res.message };
  },
  active(surface = "tv") { const s = sessions.get(surface); if (s && deps.now() - s.at > SESSION_MS) { sessions.delete(surface); return null; } return s ?? null; },
  cancel(surface = "tv") { sessions.delete(surface); },
  async answer(text, surface = "tv") {
    const s = this.active(surface); if (!s) return null;
    s.at = deps.now();
    const t = norm(text), c = R.CATEGORIES[s.category];
    if (SKIP.test(t) && s.stage !== "extra") { sessions.delete(surface); return { done: true, message: "Okay, no check-in for now." }; }
    if (s.stage === "completion") {
      const f = parseFraction(text);
      if (f === null) return { prompt: "Sorry, did you finish it? Yes, partly, or no?", stage: "completion" };
      if (f === 0) { sessions.delete(surface); return { done: true, message: pick(["No worries. There's always next time.", "That's okay. Tomorrow's a new chance.", "No problem. You'll get it next time."]) }; }
      s.fraction = f;
      return this._proof(s, surface);
    }
    if (s.stage === "proof") {
      if (c.proof === "hours") { const h = parseHours(text); return this._finish(s, surface, { hours: h ?? 1, evidence: String(text).slice(0, 200) }); }
      if (c.proof === "who") return this._finish(s, surface, { evidence: ev.isRefusal(text) ? "" : String(text).slice(0, 200) });
      if (c.proof === "activity" || c.proof === "which") {
        if (ev.isRefusal(text)) {
          if (!s.retried) { s.retried = true; return { prompt: c.proof === "activity" ? "Just a quick description helps it count, like 'a 30-minute run'." : `${c.ask} Just a few words is fine.`, stage: "proof" }; }
          sessions.delete(surface); return { done: true, message: "Okay. I need a quick description to count it, so no XP this time." };
        }
        const mins = parseHours(text);
        return this._finish(s, surface, { evidence: String(text).slice(0, 300), ...(mins ? { hours: mins } : {}) });
      }
      if (c.proof === "learned") {
        const past = L().evidenceTexts();
        const r = await ev.rateWithAI(deps.llm, text, { category: s.category, title: s.ctx.title ?? "", past });
        s.proofText = String(text); s.score = r.score;
        if (r.score === 0) {
          if (!s.retried && !r.duplicate) { s.retried = true; return { prompt: "Tell me a little more. What's one specific thing you learned? A sentence or two is perfect.", stage: "proof" }; }
          sessions.delete(surface);
          return { done: true, message: r.duplicate ? "That's the same as an earlier answer, so it can't count twice. Share something new next time!" : "I couldn't count that one. Next time, tell me one specific thing you learned and it'll count." };
        }
        if (r.followup) { s.stage = "followup"; s.question = r.followup; return { prompt: r.followup, stage: "followup" }; }
        return this._finish(s, surface, { score: r.score, evidence: s.proofText });
      }
    }
    if (s.stage === "followup") {
      const ok = await ev.followupOk(deps.llm, s.question, text);
      const score = ok ? Math.max(2, s.score) : 1;
      const r = this._finish(s, surface, { score, evidence: `${s.proofText}\n${String(text).slice(0, 300)}` });
      return ok ? r : { ...r, message: `${r.message} (Half credit this time. A fuller answer to my question earns the rest next time.)` };
    }
    if (s.stage === "extra") {           // prayer: "Anything to add to your prayer list?" (no quiz, ever)
      sessions.delete(surface);
      if (NO.test(t) || SKIP.test(t) || ev.isRefusal(text)) return { done: true, message: "Okay." };
      try { await deps.addPrayer?.(String(text).replace(/^(yes|yeah|sure)[,.\s]*/i, "").trim()); return { done: true, message: "I added that to your prayer list." }; }
      catch { return { done: true, message: "Okay." }; }
    }
    return null;
  },
};
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

// ---- voice and typed phrases -----------------------------------------------------------------------------------------------
const SELF = [
  [/\b(?:work(?:ed)? ?out|exercised|went (?:for a |on a )?(?:run|jog|swim|bike ride)|ran \d|lifted|hit the gym|went to the gym|did (?:my )?(?:workout|yoga|cardio|exercise)|finished (?:my )?(?:workout|run|exercise))\b/, "workout"],
  [/\b(?:studied|finished (?:my )?(?:studying|homework|lesson|class)|did (?:my )?(?:homework|studying|lesson|flashcards)|done studying)\b/, "study"],
  [/\b(?:read (?:a |my |the |for |some |\d)|finished (?:a |my |the )?(?:book|chapter)|did (?:my )?reading)\b/, "reading"],
  [/\b(?:prayed|finished (?:my )?(?:prayer|devotional|devotions|quiet time|bible reading)|did (?:my )?(?:devotional|devotions|quiet time))\b/, "prayer"],
  [/\b(?:called|phoned|visited|facetimed|talked to|caught up with) (?:my |mom|dad|grandma|grandpa|a friend|[a-z]+)/, "call"],
  [/\b(?:wrote (?:in |a |my )|journaled|finished (?:my )?(?:journal|letter|essay|writing)|did (?:my )?writing)\b/, "writing"],
  [/\b(?:practiced|practised|did (?:my )?practice|finished (?:my )?practice)\b/, "practice"],
  [/\b(?:went (?:for a walk|outside|on a hike|hiking)|took a walk|walked (?:the dog|for)|worked in the (?:yard|garden))\b/, "outdoors"],
  [/\b(?:cooked|made (?:dinner|lunch|breakfast|a meal)|baked)\b/, "cooking"],
  [/\b(?:did the (?:dishes|laundry|chores|vacuuming)|cleaned|vacuumed|mowed|took out the trash|folded (?:the )?laundry|finished (?:my |the )?chores?|did (?:my |a )?chores?)\b/, "chore"],
  [/\b(?:went to bed on time|got to bed on time|slept on time)\b/, "sleep"],
  [/\b(?:worked (?:for )?(?:\d|an?|one|two|three)|finished (?:my )?(?:work|focus session|deep work)|did (?:my )?(?:work|focus session)|got my work done)\b/, "work"],
];
const PAST = /^(?:hey |ok |okay )?(?:dayspring |)?(?:i |i've |i have |i just |just |we |we just )/;
export function detectSelfReport(text) {
  const t = norm(text);
  if (!PAST.test(t) || /\?$/.test(String(text).trim()) || /\b(will|going to|gonna|need to|should|want to|have to|remind)\b/.test(t)) return null;
  for (const [re, cat] of SELF) if (re.test(t)) return { category: cat, fraction: /\b(some|a little|a bit|part of|partly|half)\b/.test(t) ? parseFraction(t) ?? 0.5 : 1, hours: parseHours(t) };
  return null;
}
// returns a reply (string or { reply, show }), or null when it's not about XP
export async function handle(text, { surface = "tv" } = {}) {
  const raw = String(text ?? ""); const t = norm(raw);
  if (!t) return null;
  if (checkin.active(surface)) {
    const r = await checkin.answer(raw, surface);
    if (r) return { reply: r.prompt ? (r.message ? `${r.message} ${r.prompt}` : r.prompt) : r.message, xp: r.result ?? null, awaiting: Boolean(r.prompt) };
  }
  if (/\b(how much|how many) (xp|experience|points)\b|\bmy (xp|experience points)\b|\bxp balance\b/.test(t)) { const lv = level(); return { reply: `You have ${balance()} XP. Level ${lv.level}, ${lv.title}, with ${lv.next - lv.into} to the next level.`, show: "xp" }; }
  if (/\bwhat level am i\b|\bmy level\b/.test(t)) { const lv = level(); return { reply: `You're level ${lv.level}, ${lv.title}. ${lv.next - lv.into} XP to the next level.`, show: "xp" }; }
  if (/\b(what'?s|what is|how long is) my streak\b|\bmy streak\b/.test(t)) { const st = streak(); return { reply: st.days ? `Your streak is ${st.days} day${st.days === 1 ? "" : "s"}.${st.doneToday ? "" : " Check in today to keep it going!"}` : "No streak yet. Check in on a task today to start one!" }; }
  if (/\bwhat can i unlock\b|\bunlockable\b|\bhow (much|many xp) (for|to unlock)\b/.test(t)) {
    const all = unlockables(), ready = all.filter((x) => x.found && !x.unlocked), hidden = all.filter((x) => !x.found);
    if (!all.length) return { reply: "Secret characters aren't available yet.", show: "xp" };
    if (ready.length) return { reply: `You've found ${ready.map((x) => x.name).filter(Boolean).slice(0, 3).join(", ") || "a secret character"} to unlock. The next unlock costs ${ready[0].price} XP, and you have ${balance()}.`, show: "xp" };
    return { reply: hidden.length ? `There ${hidden.length === 1 ? "is 1 secret character" : `are ${hidden.length} secret characters`} still hidden. Find one, then unlock it with XP. You have ${balance()} XP.` : "You've unlocked every secret character!", show: "xp" };
  }
  if (/\bundo (my )?last check ?in\b|\btake (that|it) back\b.*\bxp\b/.test(t)) return { reply: undoLast().message };
  const um = /\b(?:unlock|buy|get) (?:the |a |my )?(?:next |secret )?(?:character|([a-z][a-z ]{2,30}?))(?: character)?(?: with xp)?$/.exec(t);
  if (um && (/\bcharacter\b|\bwith xp\b/.test(t) || um[1])) {
    let id = null;
    if (um[1]) { const q = um[1].replace(/^the /, ""); id = unlockables().find((x) => x.name && x.name.toLowerCase().replace(/^the /, "").includes(q))?.id ?? null; if (!id && !/\bcharacter\b|\bwith xp\b/.test(t)) return null; }
    return { reply: (await unlockCharacter(id)).message, show: "xp" };
  }
  if (/\bcheck in on my (tasks|day)\b|\blet'?s check in\b/.test(t)) return { reply: "Tell me what you finished, like 'I studied' or 'I did the dishes', and I'll check you in." };
  const self = detectSelfReport(raw);
  if (self) {
    if (!enabled()) return null;
    const r = checkin.start(self.category, { source: "self", done: true, fraction: self.fraction, hours: R.CATEGORIES[self.category].proof === "hours" ? self.hours : undefined }, surface);
    const reply = r.prompt ? (r.message ? `${r.message} ${r.prompt}` : `Great job! ${r.prompt}`) : r.message;
    return { reply, xp: r.result ?? null, awaiting: Boolean(r.prompt) };
  }
  return null;
}

// ---- asking when a scheduled block ends -----------------------------------------------------------------------------------
// deps for the scheduler: blocksToday() → [{id,title,category,start,end}], canAsk() → bool, ask({text, category, blockId})
const asked = new Set();
let schedTimer = null;
export function tickScheduler({ blocksToday, canAsk, ask }) {
  if (!enabled()) return null;
  const now = new Date(deps.now()), hm = now.toTimeString().slice(0, 5), day = today();
  const minus = (m) => new Date(deps.now() - m * 60_000).toTimeString().slice(0, 5);
  const ended = (blocksToday() ?? []).filter((b) => b.end <= hm && b.end >= minus(15));
  for (const b of ended) {
    const key = `${day}|${b.id ?? b.title}|${b.end}`;
    if (asked.has(key)) continue;
    const cat = R.categoryFor(b);
    if (!cat || settings().reminders[cat] === false) { asked.add(key); continue; }
    if (L().onDay(day, cat).length >= R.CATEGORIES[cat].max) { asked.add(key); continue; }
    if (!canAsk()) return null;                  // try again next minute (never while stopped, Off or Quiet)
    asked.add(key);
    const r = checkin.start(cat, { source: "block", title: b.title, blockId: b.id }, "tv");
    if (r.prompt) ask({ text: r.prompt, category: cat, blockId: b.id });
    return r;
  }
  return null;
}
export function startScheduler(d) {
  if (schedTimer) return;
  schedTimer = setInterval(() => { try { tickScheduler(d); } catch (e) { console.log(`xp check-in: ${e.message}`); } }, 60_000);
  schedTimer.unref?.();
}
