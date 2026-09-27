// XP: earned only by checking in on real tasks (and, for studying or reading, showing what you learned).
// For now XP unlocks the secret characters (lib/persona/secrets.mjs); it's built to grow into more later.
//   balance() · lifetime() · level() · streak() · award() · spend() · priceFor() · history() · undoLast()
//   checkin.start(category, context) · checkin.answer(text) · handle(text) (voice and typed phrases) · unlockCharacter()
// Everything is local and private: the ledger (data/xp-ledger.jsonl) and the settings (data/xp-settings.json).
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import * as R from "./rules.mjs";
import { createLedger } from "./ledger.mjs";
import * as ev from "./evidence.mjs";
import * as BS from "./badge-state.mjs";
import * as B from "./badges.mjs";
import * as C from "./citation.mjs";
import * as LR from "./learning.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let deps = {
  now: () => Date.now(),
  dataDir: join(HERE, "..", "..", "data"),
  llm: null,                          // { ready(), complete() } for the study/reading follow-ups (optional)
  persona: null,                      // lib/persona/index.mjs (for unlocking secret characters)
  addPrayer: null,                    // (text) => void, "anything to add to your prayer list?"
  ownerName: null, ownerNick: null,   // () => the owner's name / a nickname (for the citation line on badges)
  env: null,                          // () => { listen, mode, inCall, alarm } (when a badge nudge may speak)
  blocksToday: null,                  // () => today's blocks [{id,title,category,start,end}] (a "block" check-in is checked against it)
};
let ledger = null;
const listeners = new Set();
export function setDeps(d) { const dirChanged = d.dataDir && d.dataDir !== deps.dataDir; deps = { ...deps, ...d }; if (dirChanged) { ledger = null; settingsCache = null; BS._reset(); } }
export const onEvent = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
// with XP turned off nothing is announced, shown or pushed to Lantern (only the settings change itself)
const emit = (type, data) => { if (type !== "settings" && !enabled()) return; for (const fn of listeners) { try { fn(type, data); } catch { /* a listener's problem */ } } };
const L = () => (ledger ??= createLedger(join(deps.dataDir, "xp-ledger.jsonl")));
export const _reset = () => { ledger = null; settingsCache = null; clockCache = null; sessions.clear(); asked.clear(); timerIssued.clear(); pendingTimer = null; BS._reset(); LR._reset(); };
BS.init({ ledger: () => L(), deps: () => deps, settings: () => settings(), emit: (t, d) => emit(t, d), now: () => deps.now() });
export const badges = BS;
// Learning from Lantern (learning.mjs): each verified earning lands here like any award (events, level-ups, badges)
LR.init({ ledger: () => L(), deps: () => deps, now: () => deps.now(), emit: (t, d) => emit(t, d), tracking: () => tracking(), clock: () => clockCheck(), after: (res) => {
  const after = level(), before = R.levelFor(lifetime() - res.amount);
  Object.assign(res, { balance: balance(), level: after, levelUp: after.level > before.level });
  emit("award", { ...res, category: "study", label: "Learning", learning: true, evidence: res.title });
  if (res.levelUp) emit("levelup", after);
  res.badges = badgeSync();
} });
export const learning = LR;

// ---- settings (Settings → XP) ------------------------------------------------------------------------------------------
// badges: nameMode "name"|"nickname"|"none" (the citation line) · hideNextName (the mystery badge) · nudges (and per category)
// trackHidden: with XP turned off, Lantern's learning is still recorded quietly (no announcements), so nothing is
// missing when XP is turned back on. Off by default: turned off means off.
const SETTINGS_DEFAULT = { enabled: true, trackHidden: false, reminders: Object.fromEntries(R.CATEGORY_IDS.map((c) => [c, true])), checkinTimes: ["20:30"],
  badges: { nameMode: "name", hideNextName: true, nudges: true, nudgeCats: {} } };
let settingsCache = null;
const SFILE = () => join(deps.dataDir, "xp-settings.json");
export function settings() {
  if (settingsCache) return settingsCache;
  let s = {};
  try { if (existsSync(SFILE())) s = JSON.parse(readFileSync(SFILE(), "utf8")); } catch { /* damaged: defaults */ }
  settingsCache = { ...SETTINGS_DEFAULT, ...s, reminders: { ...SETTINGS_DEFAULT.reminders, ...(s.reminders ?? {}) }, badges: { ...SETTINGS_DEFAULT.badges, ...(s.badges ?? {}), nudgeCats: { ...(s.badges?.nudgeCats ?? {}) } } };
  return settingsCache;
}
export function setSettings(patch = {}) {
  const cur = settings(), pb = patch.badges ?? {};
  const next = { ...cur, ...patch, reminders: { ...cur.reminders, ...(patch.reminders ?? {}) }, badges: { ...cur.badges, ...pb, nudgeCats: { ...cur.badges.nudgeCats, ...(pb.nudgeCats ?? {}) } } };
  if (!["name", "nickname", "none"].includes(next.badges.nameMode)) next.badges.nameMode = "name";
  if (next.checkinTimes) next.checkinTimes = [...new Set(next.checkinTimes.filter((t) => /^\d{2}:\d{2}$/.test(t)))].slice(0, 4);
  mkdirSync(deps.dataDir, { recursive: true });
  const tmp = SFILE() + ".tmp"; writeFileSync(tmp, JSON.stringify(next, null, 2)); renameSync(tmp, SFILE());
  settingsCache = next; emit("settings", next); return next;
}
export const enabled = () => settings().enabled !== false;
// whether anything is recorded at all (XP on, or off with "keep tracking quietly while hidden")
const tracking = () => enabled() || settings().trackHidden === true;

// ---- time helpers --------------------------------------------------------------------------------------------------------
const dayOf = (ms) => new Date(ms).toLocaleDateString("en-CA");
const today = () => dayOf(deps.now());
const addDays = (day, n) => { const d = new Date(day + "T12:00:00"); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };

// ---- the clock guard ------------------------------------------------------------------------------------------------------
// Days and caps come from the computer's clock, so setting it back a day would reopen yesterday's caps. The latest day and
// time ever seen (the ledger's newest entry, and data/xp-clock.json) are remembered: if the clock is now before them, no
// XP is awarded until it's fixed. A jump forward of more than 36 hours is allowed (a laptop closed over the weekend) but
// the award is marked (clockJump). Caps are keyed off the latest day seen.
export const CLOCK_MESSAGE = "Your computer's clock changed; XP paused until it's fixed.";
const CLOCK_SLACK_MS = 10 * 60_000, CLOCK_JUMP_MS = 36 * 3600_000;
let clockCache = null;
const CFILE = () => join(deps.dataDir, "xp-clock.json");
function clockSeen() {
  if (clockCache) return clockCache;
  let c = {};
  try { if (existsSync(CFILE())) c = JSON.parse(readFileSync(CFILE(), "utf8")) ?? {}; } catch { /* damaged: the ledger still knows */ }
  const l = L().latest();
  clockCache = { day: [String(c.day ?? ""), l.day].sort().at(-1), at: Math.max(Number(c.at) || 0, Date.parse(l.at) || 0), savedAt: Number(c.at) || 0 };
  return clockCache;
}
export function clockCheck() {
  const now = deps.now(), day = dayOf(now), seen = clockSeen();
  if ((seen.day && day < seen.day) || (seen.at && now < seen.at - CLOCK_SLACK_MS)) return { ok: false, reason: "clock", message: CLOCK_MESSAGE, day: seen.day };
  const jump = seen.at > 0 && now - seen.at > CLOCK_JUMP_MS;
  seen.day = day > seen.day ? day : seen.day; seen.at = Math.max(now, seen.at);
  // written when it's been 10 minutes (the scheduler checks every minute) or after a jump
  if (seen.at - seen.savedAt > 10 * 60_000 || jump) {
    try { mkdirSync(deps.dataDir, { recursive: true }); const tmp = CFILE() + ".tmp"; writeFileSync(tmp, JSON.stringify({ day: seen.day, at: seen.at })); renameSync(tmp, CFILE()); seen.savedAt = seen.at; } catch { /* the ledger still remembers */ }
  }
  return { ok: true, jump, day: seen.day };
}

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
// XP per day for the last n days (the Progress chart): xp = everything earned (levels, badges); spend = what the
// balance got (at most DAILY_CAP), split into check-ins and learning
export function daily(n = 14) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = addDays(today(), -i), on = L().onDay(d);
    const sp = (learn) => on.filter((e) => L().isLearning(e) === learn).reduce((s, e) => s + L().spendOf(e), 0);
    const checkins = sp(false), learning = sp(true);
    out.push({ day: d, xp: L().dayTotal(d), spend: checkins + learning, checkins, learning, learningXp: L().learningDay(d) });
  }
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
  const clk = clockCheck();
  if (!clk.ok) return { amount: 0, reason: "clock", message: clk.message };
  const t = clk.day;
  if (day !== t && day !== addDays(t, -R.MAX_DAYS_BACK)) return { amount: 0, reason: "too-old", message: "I can only count today or yesterday." };
  const done = L().onDay(day, category).filter((e) => !L().isLearning(e));      // Lantern's verified learning has its own rules (learning.mjs)
  if (done.length >= c.max) return { amount: 0, reason: "category-cap", message: `You've already checked in ${c.label.toLowerCase()} ${c.max === 1 ? "today" : `${c.max} times today`}.` };
  const last = L().awards().filter((e) => e.category === category && !L().isLearning(e)).at(-1) ?? null;
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
  const room = Math.max(0, R.DAILY_CAP - L().generalDay(day));
  const capped = amount > room;
  amount = Math.min(amount, room);
  if (amount <= 0) return { amount: 0, reason: capped ? "daily-cap" : "zero", message: capped ? `You've reached today's ${R.DAILY_CAP} XP. Great work — it'll count again tomorrow.` : "That one didn't earn XP." };
  // what the balance gets: at most DAILY_CAP a day across everything (check-ins and learning), so a character always
  // takes a week; the rest still counts for levels, badges and the lifetime total
  const spendable = Math.min(amount, Math.max(0, R.DAILY_CAP - L().spendDay(day)));
  return { amount, spendable, capped, reason: "ok", streakBonus: streakDay >= R.STREAK_BONUS_FROM, clockJump: clk.jump };
}
// Record a check-in. Returns { ok, amount, balance, level, levelUp, message }.
// evidence is the answer to the proof question only (its fingerprint catches a repeat); followup is the answer to the
// AI's follow-up question, stored on its own so it can't make an old answer look new.
export function award(category, { fraction = 1, source = "self", hours = null, score = null, evidence = "", followup = "", day = today(), title = "", blockId = null, timerId = null } = {}) {
  const proof = R.CATEGORIES[category]?.proof;
  const fp = proof === "learned" && evidence ? ev.fingerprint(evidence) : null;
  // full credit only for a real block (once per block) or a Dayspring timer (once per timer); anything else is self-reported
  if (source === "block" && (!blockId || L().awards().some((e) => e.blockId === blockId && e.day === day))) source = "self";
  if (source === "timer" && (!timerId || !timerIssued.has(timerId))) source = "self";
  if (!["block", "timer"].includes(source)) source = "self";
  const q = quote(category, { fraction, source, hours: hours ?? 1, score, fp, day });
  if (!q.amount) return { ok: false, amount: 0, reason: q.reason, message: q.message, balance: balance() };
  const before = level();
  const e = L().append({ at: new Date(deps.now()).toISOString(), day, type: "award", amount: q.amount, category, source, evidence: String(evidence ?? "").slice(0, 600), fp, title: String(title ?? "").slice(0, 80), ...(hours > 0 ? { hours: Math.round(hours * 100) / 100 } : {}), ...(q.spendable < q.amount ? { spendable: q.spendable } : {}),
    ...(followup ? { followup: String(followup).slice(0, 300) } : {}), ...(source === "block" ? { blockId } : {}), ...(source === "timer" ? { timerId } : {}), ...(q.clockJump ? { clockJump: true } : {}) });
  if (source === "timer") timerIssued.delete(timerId);
  const after = level();
  const res = { ok: true, amount: q.amount, spendable: q.spendable, capped: q.capped, streakBonus: q.streakBonus, balance: balance(), level: after, levelUp: after.level > before.level, entry: e.id };
  emit("award", { ...res, category, label: R.CATEGORIES[category].label, evidence: e.evidence });
  if (res.levelUp) emit("levelup", after);
  res.badges = badgeSync();
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
// "undo my last check-in": your own most recent check-in, within 10 minutes (never Lantern's verified learning or
// catch-up), and never when it would leave the balance below zero (that XP was already spent on an unlock)
export function undoLast() {
  const a = L().awards().filter((e) => !L().isLearning(e) && !e.catchup); const last = a[a.length - 1];
  if (!last) return { ok: false, message: "There's no check-in to undo." };
  if (deps.now() - Date.parse(last.at) > R.UNDO_MINUTES * 60_000) return { ok: false, message: `I can only undo a check-in within ${R.UNDO_MINUTES} minutes.` };
  if (balance() - L().spendOf(last) < 0) return { ok: false, reason: "spent", message: `I can't undo that one: you've already spent that XP on an unlock, so taking back ${last.amount} XP would leave your balance below zero.` };
  L().append({ at: new Date(deps.now()).toISOString(), day: last.day, type: "reversal", amount: -last.amount, ...(typeof last.spendable === "number" ? { spendable: -last.spendable } : {}), reverses: last.id, category: last.category });
  emit("undo", { amount: last.amount, balance: balance() });
  const { removed } = BS.sync();
  for (const k of removed) emit("badge-revoked", { key: k });
  const lost = removed.map((k) => { const [c, t] = k.split(":"); return B.NAMES[c]?.[Number(t) - 1]; }).filter(Boolean);
  return { ok: true, amount: last.amount, balance: balance(), revoked: removed, message: `Undone. I took back ${last.amount} XP.${lost.length ? ` The ${lost.join(" and ")} badge${lost.length > 1 ? "s go" : " goes"} back too, until you earn ${lost.length > 1 ? "them" : "it"} again.` : ""}` };
}

// New badges after an award: one "badge" event per tier crossed, in order (the screen reveals them one after another)
function badgeSync() {
  if (!tracking()) return [];
  let added = [];
  try { added = BS.sync().added; } catch (e) { console.log(`xp badges: ${e.message}`); return []; }
  added.forEach((r, i) => { emit("badge", { ...r, seq: i, of: added.length }); BS.polish(r).then((t) => t && emit("badge-polished", { key: r.key, polished: t })).catch(() => {}); });
  return added;
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
const sessions = new Map();           // surface → session ("typed" = the Progress page's check-in box)
// A spoken check-in waits about 12 seconds after its last question (plus the time it takes to say it). An answer it
// doesn't understand never keeps it open: the "did you finish it?" question is asked again once, then it lets go. One
// typed on the Progress page has its own id and waits 3 minutes after the last thing typed.
export const VOICE_MS = 12_000, TYPED_MS = 3 * 60_000;
const sayMs = (p) => Math.min(15_000, String(p ?? "").split(/\s+/).filter(Boolean).length * 350);
const YES = /^(yes|yeah|yep|yup|sure|i did|did it|done|all done|finished|completed|all of it|the whole thing|absolutely|of course|mostly done)\b/;
const NO = /^(no|nope|nah|not yet|didn'?t|did not|i didn'?t|haven'?t|i haven'?t|not today|missed it|couldn'?t)\b/;
const SKIP = /^(skip|never ?mind|forget it|cancel|stop|not now|later)\b/;
// prayer: only an explicit addition goes on the list ("add my mom", "pray for Sam", "yes, for my mom")
const PRAY_ADD = /^(?:(?:yes|yeah|yep|sure|please|ok|okay)[,.!\s]+)*(?:please\s+)?(?:add|put|pray for|praying for|for)\s+(.+)$/i;
// a question or a command to Dayspring, not an answer ("what time is it", "set a timer", "play some music")
const NOT_ANSWER = /^(?:hey |ok |okay )?(?:dayspring )?(?:what|what's|whats|when|where|why|how|is it|are you|can you|could you|will you|would you|do you|tell me|set|start|stop|pause|play|turn|open|close|show|remind|call|text|send|cancel|add|remove|delete|search|look up|go to|switch|volume|louder|quieter|next|previous)\b/;
const norm = (t) => String(t ?? "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9%'\s.]/g, " ").replace(/\s+/g, " ").trim();
export function parseFraction(text) {
  const t = norm(text);
  const pct = /(\d{1,3})\s*(%|percent)/.exec(t); if (pct) return Math.min(1, Number(pct[1]) / 100);
  if (/\b(half|halfway|50 50)\b/.test(t)) return 0.5;
  if (/\b(most|mostly|almost|nearly|three quarters|pretty much)\b/.test(t)) return 0.75;
  if (/\b(a little|a bit|some of it|partly|partially|part of it|started|a quarter|not all|sort of|kind of|somewhat)\b/.test(t)) return 0.25;
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
// "2", "about 3", "1.5" as the answer to "About how long did you work?" (hours)
const bareHours = (t) => { const m = /^(?:about |around |roughly |maybe |like )?(\d{1,2}(?:\.\d+)?)$/.exec(norm(t)); return m && Number(m[1]) > 0 && Number(m[1]) <= 12 ? Number(m[1]) : null; };
const labelOf = (c, ctx) => (ctx?.title ? ctx.title : R.CATEGORIES[c].label.toLowerCase());
const fmt = (res, cat) => {
  const lv = res.level ?? level();
  return `+${res.amount} XP for ${R.CATEGORIES[cat].verb}.${res.streakBonus ? " Streak bonus!" : ""}${res.capped ? " That's today's limit." : ""}${res.spendable < res.amount ? ` (${res.spendable} to spend: today's spending limit is reached, but it all counts toward your level and badges.)` : ""} You have ${res.balance} XP · Level ${lv.level} ${lv.title}.${res.levelUp ? ` 🎉 Level up: you're now a ${lv.title}!` : ""}`;
};
const GIVE_UP = "No problem, you can tell me later.";
// a "block" check-in is only full credit for a real block of today's plan that has ended (and hasn't been credited);
// a "timer" one only for a Dayspring focus timer that just finished (timerFinished). Anything else is self-reported.
function verifiedSource(ctx) {
  if (ctx.source === "block") {
    const hm = new Date(deps.now()).toTimeString().slice(0, 5);
    let b = null; try { b = ctx.blockId ? (deps.blocksToday?.() ?? []).find((x) => x.id === ctx.blockId) : null; } catch { /* no plan */ }
    return b && b.end <= hm && !L().awards().some((e) => e.blockId === ctx.blockId && e.day === today()) ? "block" : "self";
  }
  if (ctx.source === "timer") return ctx.timerId && timerIssued.has(ctx.timerId) ? "timer" : "self";
  return "self";
}
export const checkin = {
  // context: { source: "block"|"timer"|"self", title, blockId, timerId, day, done: true, fraction, hours }
  // opts.typed: typed on the Progress page (its answers must carry the session id)
  start(category, context = {}, surface = "tv", { typed = false } = {}) {
    if (!R.CATEGORIES[category]) throw new Error("Unknown check-in category.");
    if (!enabled()) return { prompt: null, message: "XP check-ins are turned off in Settings." };
    const ctx = { day: today(), ...context }; ctx.source = verifiedSource(ctx);
    const s = { id: randomUUID().slice(0, 8), typed: Boolean(typed), category, ctx, stage: "completion", fraction: null, at: deps.now(), lastPromptAt: deps.now(), lastPrompt: "" };
    sessions.set(surface, s);
    if (context.done || context.fraction != null) { s.fraction = context.fraction ?? 1; return this._prompted(s, this._proof(s, surface)); }
    return this._prompted(s, { prompt: `Did you finish your ${labelOf(category, s.ctx)}? You can say yes, partly, or no.`, stage: "completion" });
  },
  // a new question restarts the wait (only questions do; answers that weren't understood don't)
  _prompted(s, r) { if (r?.prompt) { s.lastPromptAt = deps.now(); s.lastPrompt = r.prompt; r.session = s.id; } return r; },
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
    const res = award(s.category, { fraction: s.fraction ?? 1, source: s.ctx.source, day: s.ctx.day, title: s.ctx.title, blockId: s.ctx.blockId ?? null, timerId: s.ctx.timerId ?? null, ...extra });
    if (!keep) sessions.delete(surface);
    let message = res.ok ? fmt(res, s.category) : res.message;
    if (res.ok && res.badges?.length) message += " " + res.badges.map((b) => `🏅 New badge: ${b.name}! ${b.citation}`).join(" ");
    else if (res.ok) { const n = badgeNudge("checkin", { cat: s.category }); if (n) { res.nudge = n; if (n.speak) message += " " + n.text; } }
    return { done: true, result: res, message };
  },
  active(surface = "tv") {
    const s = sessions.get(surface); if (!s) return null;
    const wait = s.typed ? TYPED_MS : VOICE_MS + sayMs(s.lastPrompt);
    if (deps.now() - s.lastPromptAt > wait) { sessions.delete(surface); return null; }
    return s;
  },
  cancel(surface = "tv") { sessions.delete(surface); },
  // Does this plausibly answer the question that's waiting? (intents only hands the check-in words that do: yes/no/
  // partly, a duration, a number, the task's own words; for "what did you learn / which chore / who", anything that
  // isn't a question or a command to Dayspring; for the prayer list, only an explicit addition or a no.)
  plausible(text, surface = "tv") {
    const s = this.active(surface); if (!s) return false;
    const t = norm(text); if (!t) return false;
    if (SKIP.test(t)) return true;
    const c = R.CATEGORIES[s.category];
    if (s.stage === "completion") return parseFraction(t) !== null || R.categoryFor({ title: t }) === s.category;
    if (s.stage === "extra") return NO.test(t) || YES.test(t) || PRAY_ADD.test(t) || ev.isRefusal(t);
    if (s.stage === "proof" && c.proof === "hours") return parseHours(t) !== null || bareHours(t) !== null || /\b\d+(\.\d+)?\b/.test(t);
    return !NOT_ANSWER.test(t) && !/\?\s*$/.test(String(text).trim());
  },
  // opts.id: the session id (required for a typed session)
  async answer(text, surface = "tv", { id = null } = {}) {
    const s = this.active(surface); if (!s) return null;
    if (s.typed && id !== s.id) return null;
    if (s.typed) s.lastPromptAt = deps.now();            // typing keeps a typed check-in open
    const t = norm(text), c = R.CATEGORIES[s.category];
    if (SKIP.test(t) && s.stage !== "extra") { sessions.delete(surface); return { done: true, message: "Okay, no check-in for now." }; }
    if (s.stage === "completion") {
      const f = parseFraction(text);
      if (f === null) {
        if (s.reasked) { sessions.delete(surface); return { done: true, message: GIVE_UP }; }
        s.reasked = true;
        return this._prompted(s, { prompt: "Sorry, did you finish it? Yes, partly, or no?", stage: "completion" });
      }
      if (f === 0) { sessions.delete(surface); return { done: true, message: pick(["No worries. There's always next time.", "That's okay. Tomorrow's a new chance.", "No problem. You'll get it next time."]) }; }
      s.fraction = f;
      return this._prompted(s, this._proof(s, surface));
    }
    if (s.stage === "proof") {
      const retry = (prompt, giveUp) => {
        if (!s.retried) { s.retried = true; return this._prompted(s, { prompt, stage: "proof" }); }
        sessions.delete(surface); return { done: true, message: giveUp };
      };
      if (c.proof === "hours") {
        const h = parseHours(text) ?? bareHours(text);
        if (!(h > 0)) return retry("About how many hours? Something like “two hours” or “45 minutes”.", GIVE_UP);
        return this._finish(s, surface, { hours: h, evidence: String(text).slice(0, 200) });
      }
      if (c.proof === "who") {
        const v = ev.validEvidence(text, { min: 1, who: true });
        if (!v.ok) return retry("Who was it? Just their name is fine.", "Okay. I need to know who you talked to, so no XP this time.");
        return this._finish(s, surface, { evidence: String(text).slice(0, 200) });
      }
      if (c.proof === "activity" || c.proof === "which") {
        if (!ev.validEvidence(text).ok) return retry(c.proof === "activity" ? "Just a quick description helps it count, like 'a 30-minute run'." : `${c.ask} A few words is fine, like 'washed the dishes'.`, "Okay. I need a quick description to count it, so no XP this time.");
        const mins = parseHours(text);
        return this._finish(s, surface, { evidence: String(text).slice(0, 300), ...(mins ? { hours: mins } : {}) });
      }
      if (c.proof === "learned") {
        const past = L().evidenceTexts();
        const r = ev.validEvidence(text).ok ? await ev.rateWithAI(deps.llm, text, { category: s.category, title: s.ctx.title ?? "", past }) : { score: 0 };
        s.proofText = String(text).slice(0, 600); s.score = r.score;
        if (r.score === 0) {
          if (!s.retried && !r.duplicate) { s.retried = true; return this._prompted(s, { prompt: "Tell me a little more. What's one specific thing you learned? A sentence or two is perfect.", stage: "proof" }); }
          sessions.delete(surface);
          return { done: true, message: r.duplicate ? "That's the same as an earlier answer, so it can't count twice. Share something new next time!" : "I couldn't count that one. Next time, tell me one specific thing you learned and it'll count." };
        }
        if (r.followup) { s.stage = "followup"; s.question = r.followup; return this._prompted(s, { prompt: r.followup, stage: "followup" }); }
        return this._finish(s, surface, { score: r.score, evidence: s.proofText });
      }
    }
    if (s.stage === "followup") {
      const ok = await ev.followupOk(deps.llm, s.question, text);
      const score = ok ? Math.max(2, s.score) : 1;
      // the fingerprint (and the duplicate check) is the first answer alone; the follow-up is kept beside it
      const r = this._finish(s, surface, { score, evidence: s.proofText, followup: String(text).slice(0, 300) });
      return ok ? r : { ...r, message: `${r.message} (Half credit this time. A fuller answer to my question earns the rest next time.)` };
    }
    if (s.stage === "extra") {           // prayer: "Anything to add to your prayer list?" (no quiz, ever)
      sessions.delete(surface);
      const m = PRAY_ADD.exec(String(text).trim());
      const item = m ? m[1].replace(/\s+(?:to|on)\s+(?:my|the)\s+prayer\s+list\W*$/i, "").replace(/[.!]+$/, "").trim() : "";
      if (!item || !ev.validEvidence(item, { min: 1, who: true }).ok) return { done: true, message: "Okay." };
      try { await deps.addPrayer?.(item); return { done: true, message: "I added that to your prayer list." }; }
      catch { return { done: true, message: "Okay." }; }
    }
    return null;
  },
};
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

// ---- voice and typed phrases -----------------------------------------------------------------------------------------------
const SELF = [
  [/\b(?:went to (?:church|mass|(?:a |the )?(?:worship )?service|small group|sunday school)|attended (?:church|mass|(?:a |the )?service|worship)|worshipped)\b/, "worship"],
  [/\b(?:volunteered|did (?:some )?volunteer(?:ing| work)|served at|helped out at (?:the )?(?:food bank|shelter|church|school))\b/, "volunteer"],
  [/\b(?:meditated|did (?:a |some |my )?(?:meditation|breathing exercises?|mindfulness)|took a mindful (?:moment|minute|break)|practiced mindfulness)\b/, "mindfulness"],
  [/\b(?:played (?:some |a game of |in a |a )?(?:volleyball|soccer|basketball|football|baseball|softball|tennis|pickleball|golf|hockey|badminton|frisbee|ultimate|a game|a match|pickup)|went (?:bowling|golfing|skiing|skating)|had (?:a |my )?(?:game|match))\b/, "sports"],
  [/\b(?:painted|drew (?:a |some )|sketched|did (?:some )?(?:art|crafts?|painting|drawing|pottery)|made (?:some )?(?:art|a painting|a drawing|pottery|a craft)|knitted|crocheted)\b/, "art"],
  [/\b(?:ate (?:healthy|a (?:healthy|salad|good)|(?:some )?(?:vegetables|veggies|fruit|a salad))|had a (?:healthy (?:meal|lunch|dinner|breakfast)|salad)|ate a healthy)\b/, "eating"],
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
// returns a reply (string or { reply, show }), or null when it's not about XP.
// opts: typed (the Progress page's box: its check-ins are typed sessions) · id (the typed session being answered)
export async function handle(text, { surface = "tv", typed = false, id = null } = {}) {
  const raw = String(text ?? ""); const t = norm(raw);
  if (!t) return null;
  if (checkin.active(surface)) {
    const r = await checkin.answer(raw, surface, { id });
    if (r) return { reply: r.prompt ? (r.message ? `${r.message} ${r.prompt}` : r.prompt) : r.message, xp: r.result ?? null, awaiting: Boolean(r.prompt), session: r.session ?? null };
  }
  const br = badgeReply(t, raw); if (br) return br;
  // Lantern: "I finished lesson 3" (checked with Lantern first), "how much XP have I earned from Python", "what did I finish this week"
  if (LR.isClaim(t)) { const r = await LR.claim(t); if (r) return { reply: r.reply, xp: r.xp ?? null }; }
  { const r = await LR.voice(t).catch(() => null); if (r) return r; }
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
    const r = checkin.start(self.category, { source: "self", done: true, fraction: self.fraction, hours: R.CATEGORIES[self.category].proof === "hours" ? self.hours : undefined }, surface, { typed });
    const reply = r.prompt ? (r.message ? `${r.message} ${r.prompt}` : `Great job! ${r.prompt}`) : r.message;
    return { reply, xp: r.result ?? null, awaiting: Boolean(r.prompt), session: r.session ?? null };
  }
  return null;
}

// ---- badges by voice --------------------------------------------------------------------------------------------------------
const CAT_WORDS = { workout: "fitness|workout|exercise|gym", sports: "sports?|game", worship: "worship|church", prayer: "prayer|praying", eating: "healthy eating|eating|food|nutrition",
  chore: "chores?|home|cleaning", study: "study|studying|learning|school", reading: "reading|books?", practice: "music|practice|instrument", call: "relationships?|friends?|family|calls?",
  writing: "writing|journal(?:ing)?", outdoors: "outdoors?|nature|outside", sleep: "rest|sleep|bedtime", cooking: "cooking|kitchen", volunteer: "service|volunteering|serving",
  art: "creativity|art|creative|crafts?", mindfulness: "mindfulness|meditation|calm", work: "business|work|job" };
function catIn(t) { for (const [c, w] of Object.entries(CAT_WORDS)) if (new RegExp(`\\b(?:${w})\\b`).test(t)) return c; return null; }
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
// a visual-only nudge (ack: true) is marked as sent once a screen shows it (POST /xp/badges/nudged → badges.markNudged)
export function badgeNudge(moment, o = {}) { if (!enabled()) return null; const n = BS.nudge(moment, { ...o, env: o.env ?? deps.env?.() ?? { listen: "active" } }); if (n) { n.text = styleKeep(n.text, [String(n.toGo.toLocaleString("en-US"))]); emit("badge-nudge", n); } return n; }
// persona styling, but only if the facts survive word for word
function styleKeep(text, facts) { try { const st = deps.persona?.style?.(text, { kind: "badge" }); if (st && facts.every((f) => String(st).includes(f))) return String(st); } catch { /* plain */ } return text; }
function badgeReply(t, raw) {
  if (!/\bbadges?\b|\bgallery\b/.test(t)) return null;
  if (/\b(stop|no more|turn off|disable|mute) (?:the |my )?badge (?:reminders|nudges|tips)\b/.test(t)) { setSettings({ badges: { nudges: false } }); return { reply: "Okay, no more badge reminders. You can turn them back on in Progress → Badges." }; }
  if (/\b(start|turn on|enable) (?:the |my )?badge (?:reminders|nudges)\b/.test(t)) { setSettings({ badges: { nudges: true } }); return { reply: "Badge reminders are back on." }; }
  if (/\b(open|show)\b.*\bgallery\b|\bshow (?:me )?my badges\b|\bopen my badges\b/.test(t)) return { reply: "Here's your badge gallery.", show: "badges" };
  if (/\b(what did i do|how did i (?:get|earn)|what earned)\b/.test(t)) {
    const all = BS.earned(); if (!all.length) return { reply: "You haven't earned a badge yet. Check in on a task and the first one comes quickly!" };
    let r = all[0];
    const nm = /how did i (?:get|earn) (?:the |my )?(.+?)(?: badge)?$/.exec(t)?.[1];
    if (nm && !/^(my )?last( one)?$/.test(nm)) { const q = nm.trim(); const f = all.find((x) => x.name.toLowerCase() === q) ?? all.find((x) => x.name.toLowerCase().includes(q)); if (!f) return { reply: "I can't find that badge among the ones you've earned." }; r = f; }
    const along = r.along.count > 1 ? ` Along the way: ${r.along.count} ${r.along.noun}.` : "";
    return { reply: `${r.citation}${along}`, badge: r.key };
  }
  if (/\b(how close|how far|how many (?:more )?(?:points|xp)|how much (?:more )?xp)\b.*\bnext\b|\bnext\b.*\bbadge\b/.test(t)) {
    const c = catIn(t.replace(/\bbadges?\b/g, "")), n = c ? BS.next(c) : BS.closest();
    if (!n) return { reply: "Check in on a task to start earning badges!" };
    if (n.done) return { reply: `You've earned all 18 ${B.BADGE_CATEGORIES[n.cat].label} badges. Amazing!` };
    const what = n.name ? `${n.name}` : `your next ${n.label} badge`;
    const reply = `You're ${n.toGo.toLocaleString("en-US")} XP from ${what} (${n.have.toLocaleString("en-US")} of ${n.need.toLocaleString("en-US")}).${n.eta ? ` That's ${n.eta}.` : ""}`;
    return { reply, cat: n.cat };
  }
  if (/\bwhat badges\b|\bmy badges\b|\bhow many badges\b|\bbadges do i have\b/.test(t)) {
    const all = BS.earned();
    if (!all.length) return { reply: "No badges yet. Your first one comes after a few days of check-ins!" };
    const byCat = {}; for (const r of all) byCat[r.cat] = Math.max(byCat[r.cat] ?? 0, r.tier);
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, tier]) => `${B.NAMES[c][tier - 1]} in ${B.BADGE_CATEGORIES[c].label}`);
    return { reply: `You have ${plural(all.length, "badge")} of ${B.BADGE_IDS.length * B.TIERS}. Your highest: ${top.join(", ")}. The newest is ${all[0].name}.` };
  }
  return null;
}

// What Dayspring says when badges are earned (once, after the last of several crossed at once). The persona may style
// it, but only if the name, the activity and the date survive word for word.
export function speakBadges(records) {
  if (!records?.length) return "";
  const r = records[records.length - 1];
  const head = records.length > 1 ? `${records.length} new badges! The newest is ${r.name}.` : `New badge: ${r.name}!`;
  const plain = `${head} ${r.citation}`;
  try { const st = deps.persona?.style?.(plain, { kind: "badge" }); if (st && C.styledKeepsFacts(st, r.citationParts) && String(st).includes(r.name)) return String(st); } catch { /* plain */ }
  return plain;
}

// A line for the morning rundown: a gentle badge nudge when one is close (or nothing)
export function morningLine() { try { const n = badgeNudge("morning"); if (n?.ack) BS.markNudged(n.cat); /* the rundown shows it */ return [LR.nearUnitLine(), n?.text ?? ""].filter(Boolean).join(" "); } catch { return ""; } }

// ---- a Dayspring focus timer or pomodoro finished -----------------------------------------------------------------------
// lib/timers.mjs calls this (its "finished" hook) for every timer that ends. A focus timer ("focus", "work", "deep work",
// "pomodoro", 15 minutes or more) or the last focus round of a pomodoro starts a full-credit work check-in: "Did you
// finish your focus session?" → the hours come from the timer. Asked when Dayspring may ask (within 30 minutes).
const timerIssued = new Set();            // timer ids that may give full credit (once each)
let pendingTimer = null, sched = null;
const FOCUS = /\b(focus|work|working|deep work|pomodoro)\b/i;
export function timerFinished(t) {
  if (!enabled() || !t?.id || settings().reminders.work === false) return null;
  let ms;
  if (t.cycle) { if (t.cycle.phase !== "work" || t.cycle.round < t.cycle.rounds) return null; ms = t.cycle.work * t.cycle.rounds; }
  else { if (t.every || !FOCUS.test(String(t.label ?? "")) || !(t.ms >= 15 * 60_000)) return null; ms = t.ms; }
  timerIssued.add(t.id);
  pendingTimer = { id: t.id, hours: Math.round((ms / 3600_000) * 100) / 100, at: deps.now() };
  return askTimer();
}
function askTimer() {
  if (!pendingTimer) return null;
  if (deps.now() - pendingTimer.at > 30 * 60_000) { timerIssued.delete(pendingTimer.id); pendingTimer = null; return null; }
  if (!sched || !sched.canAsk()) return null;
  const p = pendingTimer; pendingTimer = null;
  const r = checkin.start("work", { source: "timer", timerId: p.id, title: "focus session", hours: p.hours }, "tv");
  if (r.prompt) sched.ask({ text: r.prompt, category: "work" });
  return r;
}

// ---- asking when a scheduled block ends -----------------------------------------------------------------------------------
// deps for the scheduler: blocksToday() → [{id,title,category,start,end}], canAsk() → bool, ask({text, category, blockId})
const asked = new Set();
let schedTimer = null;
export function tickScheduler(d) {
  const { blocksToday, canAsk, ask, nudge } = d;
  if (!enabled()) return null;
  sched = d; deps.blocksToday = blocksToday;       // what a "block" check-in is checked against
  clockCheck();                                    // the clock guard's heartbeat (notices a clock set back)
  if (pendingTimer) { const r = askTimer(); if (r) return r; }
  const now = new Date(deps.now()), hm = now.toTimeString().slice(0, 5), day = today();
  const minus = (m) => new Date(deps.now() - m * 60_000).toTimeString().slice(0, 5);
  // a badge nudge 15–30 minutes before a matching block ("your 6pm workout could get you your next Fitness badge")
  if (nudge) {
    const plus = (m) => new Date(deps.now() + m * 60_000).toTimeString().slice(0, 5);
    for (const b of (blocksToday() ?? []).filter((x) => x.start > plus(15) && x.start <= plus(30))) {
      const key = `nudge|${day}|${b.id ?? b.title}`, cat = R.categoryFor(b);
      if (asked.has(key) || !cat) continue;
      asked.add(key);
      const n = badgeNudge("block", { cat, block: { title: b.title, start: b.start } });
      if (n) { nudge(n); break; }
    }
  }
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
  sched = d; if (d.blocksToday) deps.blocksToday = d.blocksToday;
  if (schedTimer) return;
  schedTimer = setInterval(() => { try { tickScheduler(d); } catch (e) { console.log(`xp check-in: ${e.message}`); } }, 60_000);
  schedTimer.unref?.();
}
