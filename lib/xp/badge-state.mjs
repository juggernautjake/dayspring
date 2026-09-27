// Earned badges, kept in data/xp-badges.json, plus the "next badge" progress, gentle nudges and the badge case.
// The ledger is the truth: sync() replays it (badges.replay) and compares with what's stored. A newly crossed tier
// gets a record (the clincher check-in, a human summary, the citation, the check-ins along the way) that is written
// ONCE and never regenerated. A tier that is no longer earned (an undo within the 10 minutes) loses its record, and
// crossing it again later makes a fresh one with the new clincher.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as B from "./badges.mjs";
import * as C from "./citation.mjs";

let ctx = null;            // { ledger(), deps(), settings(), emit(type,data), now() }
let cache = null;
export function init(c) { ctx = c; cache = null; }
export const _reset = () => { cache = null; };
const FILE = () => join(ctx.deps().dataDir, "xp-badges.json");
const EMPTY = () => ({ records: {}, pins: [], nudged: {}, seen: {} });
function load() {
  if (cache && cache.__dir === ctx.deps().dataDir) return cache;
  let s = EMPTY();
  try { if (existsSync(FILE())) s = { ...EMPTY(), ...JSON.parse(readFileSync(FILE(), "utf8")) }; } catch { /* damaged: start again from the ledger */ }
  Object.defineProperty(s, "__dir", { value: ctx.deps().dataDir, enumerable: false, writable: true });
  cache = s; return s;
}
function save() { const s = load(); mkdirSync(ctx.deps().dataDir, { recursive: true }); const tmp = FILE() + ".tmp"; writeFileSync(tmp, JSON.stringify(s, null, 2)); renameSync(tmp, FILE()); }
const key = (cat, tier) => `${cat}:${tier}`;
const dayOf = (ms) => new Date(ms).toLocaleDateString("en-CA");
const bset = () => ctx.settings().badges ?? {};
function names() { const d = ctx.deps(); return { name: (typeof d.ownerName === "function" ? d.ownerName() : d.ownerName) || "", nickname: (typeof d.ownerNick === "function" ? d.ownerNick() : d.ownerNick) || "" }; }

// ---- sync: the ledger → earned badges --------------------------------------------------------------------------------
// Returns { added: [record…] (in the order they were earned), removed: [key…] }
export function sync() {
  const s = load(), st = B.replay(ctx.ledger().awards());
  const want = new Map();
  for (const cat of B.BADGE_IDS) for (const e of st[cat].earned) want.set(key(cat, e.tier), { cat, ...e });
  const added = [], removed = [];
  for (const k of Object.keys(s.records)) {
    const w = want.get(k);
    if (!w || w.clincher.id !== s.records[k].clincherId) { delete s.records[k]; delete s.seen[k]; removed.push(k); s.pins = s.pins.filter((p) => p !== k); }
  }
  for (const [k, w] of want) if (!s.records[k]) { const r = makeRecord(w); s.records[k] = r; added.push(r); }
  if (added.length || removed.length) save();
  added.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.cat === b.cat ? a.tier - b.tier : 0));
  return { added, removed };
}
function makeRecord({ cat, tier, clincher: e, contributing }) {
  const bs = bset(), n = names();
  const cit = C.build(e, { cat, tier, mode: bs.nameMode ?? "name", ...n });
  const days = contributing.map((x) => x.day).sort();
  return {
    key: key(cat, tier), cat, tier, name: B.NAMES[cat][tier - 1],
    at: e.at, clincherId: e.id,
    clincher: { id: e.id, at: e.at, day: e.day, category: e.category, amount: e.amount, source: e.source ?? "self", summary: B.summary(e) },
    polished: null,                                  // an optional one-time AI polish of the summary (never regenerated)
    citation: cit.text, citationParts: cit.parts,
    along: { count: contributing.length, from: days[0] ?? e.day, to: days[days.length - 1] ?? e.day, noun: B.BADGE_CATEGORIES[cat].noun },
    earnedAt: new Date(ctx.now()).toISOString(),
  };
}
// once, right after an award: ask the AI (if there is one) for a tidier few-word summary. Never for prayer or worship.
export async function polish(record) {
  const llm = ctx.deps().llm, s = load(), r = s.records[record.key];
  if (!r || r.polished || B.privateCategory(r.cat) || !llm?.ready?.()) return null;
  try {
    const out = await llm.complete({ system: "Rewrite a short note about an activity someone did as a friendly 3–8 word summary, like '45-minute run this morning'. Keep every fact; add none. Reply with the summary only.", messages: [{ role: "user", content: r.clincher.summary }], maxTokens: 40 });
    const t = String(out?.text ?? out ?? "").replace(/^["'\s]+|["'\s.]+$/g, "");
    if (!t || t.length > 60) return null;
    const cur = load().records[record.key]; if (!cur || cur.polished) return null;
    cur.polished = t; save(); return t;
  } catch { return null; }
}

// ---- reading -----------------------------------------------------------------------------------------------------------
export const records = () => load().records;
export function earned() { return Object.values(load().records).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)); }
export const latest = () => earned()[0] ?? null;
// badge credit so far, per category
export function credits() { const st = B.replay(ctx.ledger().awards()); return Object.fromEntries(B.BADGE_IDS.map((c) => [c, st[c].credit])); }
// the next badge in a category: numbers, and (unless hidden) its name. Never the art.
export function next(cat, { st = null } = {}) {
  const s = st ?? B.replay(ctx.ledger().awards())[cat];
  const tier = s.earned.length + 1;
  if (tier > B.TIERS) return { cat, done: true, tier: B.TIERS, have: s.credit };
  const th = B.thresholds(cat), need = th[tier - 1], prevNeed = tier > 1 ? th[tier - 2] : 0;
  const have = s.credit, toGo = Math.max(0, need - have);
  const pct = Math.min(1, (have - prevNeed) / Math.max(1, need - prevNeed));
  // pace: badge credit over the last 21 days
  const cutoff = dayOf(ctx.now() - 21 * 86400_000);
  const recent = Object.entries(s.days).filter(([d]) => d > cutoff).reduce((a, [, v]) => a + v, 0);
  const perDay = recent / 21, days = perDay > 0 ? Math.ceil(toGo / perDay) : null;
  const session = Math.max(1, Math.round(B.BADGE_CATEGORIES[cat].u * 0.85));
  return { cat, label: B.BADGE_CATEGORIES[cat].label, tier, need, have, toGo, pct, prevNeed, sessions: Math.ceil(toGo / session),
    etaDays: days, eta: days == null ? null : etaText(days), name: bset().hideNextName === false ? B.NAMES[cat][tier - 1] : null };
}
export function etaText(days) {
  if (days <= 1) return "about a day at your recent pace";
  if (days < 14) return `about ${days} days at your recent pace`;
  if (days < 60) return `about ${Math.round(days / 7)} weeks at your recent pace`;
  if (days < 540) return `about ${Math.round(days / 30)} months at your recent pace`;
  return `over a year at your recent pace`;
}
export function nextAll() { const st = B.replay(ctx.ledger().awards()); return B.BADGE_IDS.map((c) => next(c, { st: st[c] })); }
// The closest next badge (for "how close am I to my next badge")
export function closest() { return nextAll().filter((n) => !n.done && n.have > 0).sort((a, b) => b.pct - a.pct || a.toGo - b.toGo)[0] ?? nextAll().filter((n) => !n.done).sort((a, b) => a.toGo - b.toGo)[0] ?? null; }

// ---- the gallery view (what the page gets) -------------------------------------------------------------------------------
export function view() {
  const st = B.replay(ctx.ledger().awards()), recs = load().records, s = load();
  const cats = B.BADGE_IDS.map((cat) => {
    const nx = next(cat, { st: st[cat] });
    const tiers = B.NAMES[cat].map((nm, i) => {
      const r = recs[key(cat, i + 1)], state = r ? "earned" : i + 1 === nx.tier && !nx.done ? "next" : "locked";
      return state === "earned" ? { tier: i + 1, state, name: nm, description: B.description(cat, i + 1), at: r.at, isNew: !s.seen[r.key], summary: r.polished ?? r.clincher.summary, citation: r.citation, along: r.along, clincher: r.clincher, key: r.key }
        : state === "next" ? { tier: i + 1, state, name: nx.name, need: nx.need }                  // the name only if the setting allows; never the art
        : { tier: i + 1, state };
    });
    return { cat, label: B.BADGE_CATEGORIES[cat].label, earned: st[cat].earned.length, credit: st[cat].credit, next: nx, tiers };
  });
  const all = earned();
  const rarest = all.slice().sort((a, b) => b.tier - a.tier || Date.parse(a.at) - Date.parse(b.at))[0] ?? null;
  return { categories: cats, total: all.length, of: B.BADGE_IDS.length * B.TIERS, latest: all[0] ?? null, rarest, pins: s.pins.filter((k) => recs[k]), settings: badgeSettings() };
}
export function markSeen(keys) { const s = load(); let n = 0; for (const k of keys) if (s.records[k] && !s.seen[k]) { s.seen[k] = true; n++; } if (n) save(); return n; }

// ---- the badge case: up to 3 pinned badges ------------------------------------------------------------------------------
export function pin(k) {
  const s = load(); if (!s.records[k]) return { ok: false, message: "You haven't earned that badge yet." };
  if (s.pins.includes(k)) return { ok: true, pins: s.pins };
  s.pins = [...s.pins, k].slice(-3); save(); return { ok: true, pins: s.pins };
}
export function unpin(k) { const s = load(); s.pins = s.pins.filter((p) => p !== k); save(); return { ok: true, pins: s.pins }; }

// ---- names on citations -----------------------------------------------------------------------------------------------
export const badgeSettings = () => ({ nameMode: "name", hideNextName: true, nudges: true, nudgeCats: {}, ...bset() });
// "update the names on my badges": re-render every citation with the current name setting (same activity and date)
export function renameAll() {
  const s = load(), n = names(), mode = badgeSettings().nameMode; let count = 0;
  for (const r of Object.values(s.records)) { const out = C.rename(r.citationParts, { mode, ...n }); if (out.text !== r.citation) { r.citation = out.text; r.citationParts = out.parts; count++; } }
  if (count) save(); return count;
}

// ---- nudges -------------------------------------------------------------------------------------------------------------
// moment: "checkin" (right after a check-in in that category), "morning" (the rundown), "block" (a matching block starts
// soon; pass block {title,start}). env: { listen: "active"|"quiet"|"off", mode: "voice"|"silent"|"chime", inCall, alarm }
// Returns null, or { cat, text, speak, visual, ack }. At most once a day per category; never guilt.
// A spoken nudge counts as sent straight away. A visual-only one (silent or chime mode) counts only once a screen has
// actually shown it (ack: true → the screen calls markNudged(cat) after its toast), so a nudge nobody saw comes again.
export const NEAR_PCT = 0.85, NEAR_SESSIONS = 2;
export function nudge(moment, { cat = null, block = null, env = {}, dry = false } = {}) {
  const bs = badgeSettings();
  if (!bs.nudges) return null;
  if (env.listen === "off" || env.listen === "quiet" || env.inCall || env.alarm) return null;
  const s = load(), today = dayOf(ctx.now());
  const candidates = (cat ? [next(cat)] : nextAll()).filter((n) => !n.done && n.have > 0 && bs.nudgeCats?.[n.cat] !== false && s.nudged[n.cat] !== today && near(n));
  if (!candidates.length) return null;
  const n = candidates.sort((a, b) => a.toGo - b.toGo)[0];
  const who = names().nickname || names().name;
  const text = nudgeText(n, { moment, block, who, comeback: comeback() });
  const visualOnly = env.mode === "silent" || env.mode === "chime" || env.listen !== "active";
  if (!dry && !visualOnly) { s.nudged[n.cat] = today; save(); }
  return { cat: n.cat, tier: n.tier, toGo: n.toGo, text, speak: !visualOnly, visual: true, ack: visualOnly, glow: n.pct >= 0.95 };
}
// a screen showed a visual-only nudge (its toast): now it counts as today's nudge for that category
export function markNudged(cat) {
  const s = load(), today = dayOf(ctx.now());
  if (!cat || s.nudged[cat] === today) return false;
  s.nudged[cat] = today; save(); return true;
}
export const near = (n) => !n.done && n.toGo > 0 && (n.pct >= NEAR_PCT || n.sessions <= NEAR_SESSIONS);
// after a streak break, only kind words (no "don't lose it", no "you missed")
function comeback() { const a = ctx.ledger().awards(); if (a.length < 2) return false; const last = a[a.length - 1], prev = a[a.length - 2]; return (Date.parse(last.at) - Date.parse(prev.at)) > 3 * 86400_000; }
const ACT = { workout: "workout", sports: "game", worship: "time of worship", prayer: "time in prayer", eating: "healthy meal", chore: "chore", study: "study session", reading: "reading session",
  practice: "practice session", call: "call or visit", writing: "writing session", outdoors: "time outside", sleep: "early night", cooking: "home-cooked meal", volunteer: "act of service",
  art: "creative session", mindfulness: "mindful moment", work: "focused work session" };
export function nudgeText(n, { moment = "checkin", block = null, who = "", comeback = false } = {}) {
  const hi = who ? `${who}, ` : "";
  const what = n.name ? `your ${n.name} badge` : `your next ${n.label} badge`;
  const sess = n.sessions <= 1 ? `one more ${ACT[n.cat]}` : `about ${n.sessions} more ${ACT[n.cat]}s`.replace(/ys$/, "ys").replace(/(meal|session|moment|workout|game|chore|visit|night)s$/, "$1s");
  const pts = `${n.toGo.toLocaleString("en-US")} XP`;
  if (comeback) return `Welcome back${who ? `, ${who}` : ""}! You're just ${pts} from ${what}. ${sess[0].toUpperCase() + sess.slice(1)} would do it.`;
  if (moment === "block" && block?.title) return `${hi}your ${block.title}${block.start ? ` at ${block.start}` : ""} could get you ${what}. Only ${pts} to go!`.replace(/^./, (c) => c.toUpperCase());
  if (moment === "morning") return `${hi}you're ${pts} from ${what}. ${sess[0].toUpperCase() + sess.slice(1)} today could do it.`.replace(/^./, (c) => c.toUpperCase());
  return `${hi}nice! You're only ${pts} away from ${what}. That's ${sess}.`.replace(/^./, (c) => c.toUpperCase());
}
