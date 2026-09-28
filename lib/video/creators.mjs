// Who's who on YouTube: "a video by oneyplays / david wood / mike winger / john macarthur" → the channel itself, never
// a video that merely mentions the name.
//   resolve(spoken)  → { channel: { channelId, name, handle }, person, via: "learned"|"list"|"search", confidence, options }
//                      (options: up to 3 channels when it isn't sure; channel null when nothing fits)
// A person can own a channel (Mike Winger → Mike Winger) or be known from someone else's (John MacArthur → Grace to You,
// "david wood" → Acts17Apologetics). The small list below says which; the owner can add to it ("when I say Pastor Bob I
// mean First Baptist Church") and his corrections are remembered ("not that channel" → the next one; a pick from the
// top 3 → kept for next time). Both live in data/video-creators.json (tests: DAYSPRING_VIDEO_CREATORS), which he can
// also edit by hand: { people: [{ name, aliases, channels: [{ name, handle, channelId }] }], rejected: { key: [ids] } }.
// Names said aloud are matched loosely: "oney plays", "one-y plays", "john mcarthur", "mike wingar".
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJSONAtomic } from "../atomic.mjs";
import { compact, nameSim, norm } from "./text.mjs";
import * as yt from "./youtube.mjs";

const FILE = () => process.env.DAYSPRING_VIDEO_CREATORS || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "video-creators.json");

// The built-in list: people known mostly from a ministry's or a show's channel, and channels people call by a nickname.
// handle: the channel's @handle when it's certain (then no search is needed); otherwise its name is looked up.
export const BUILT_IN = [
  { name: "Oney", aliases: ["oneyplays", "oney plays", "oney", "oney play", "only plays"], channels: [{ name: "OneyPlays", handle: "@OneyPlays" }] },
  { name: "Acts17Apologetics", aliases: ["david wood", "acts 17", "acts17", "acts seventeen", "acts 17 apologetics", "acts17apologetics"], channels: [{ name: "Acts17Apologetics", handle: "@Acts17Apologetics" }] },
  { name: "Mike Winger", aliases: ["mike winger", "michael winger", "mike wingar", "mike wing her"], channels: [{ name: "Mike Winger", handle: "@MikeWinger" }] },
  { name: "John MacArthur", aliases: ["john macarthur", "john mcarthur", "john mac arthur", "pastor john macarthur", "doctor john macarthur", "grace to you", "gty"], channels: [{ name: "Grace to You", handle: "@gracetoyou" }] },
  { name: "R. C. Sproul", aliases: ["rc sproul", "r c sproul", "are see sproul", "ligonier"], channels: [{ name: "Ligonier Ministries" }] },
  { name: "Alistair Begg", aliases: ["alistair begg", "alistair beg", "truth for life"], channels: [{ name: "Truth For Life" }] },
  { name: "Frank Turek", aliases: ["frank turek", "cross examined", "crossexamined"], channels: [{ name: "CrossExamined" }] },
  { name: "William Lane Craig", aliases: ["william lane craig", "bill craig", "reasonable faith"], channels: [{ name: "ReasonableFaithOrg" }] },
  { name: "Tim Keller", aliases: ["tim keller", "timothy keller", "gospel in life"], channels: [{ name: "Gospel in Life" }] },
  { name: "Charles Stanley", aliases: ["charles stanley", "doctor charles stanley", "in touch ministries"], channels: [{ name: "In Touch Ministries" }] },
  { name: "Cliffe Knechtle", aliases: ["cliffe knechtle", "cliff knechtle", "cliff connection", "give me an answer"], channels: [{ name: "Give Me An Answer" }] },
  { name: "Jeff Durbin", aliases: ["jeff durbin", "apologia", "apologia studios"], channels: [{ name: "Apologia Studios" }] },
  { name: "Gavin Ortlund", aliases: ["gavin ortlund", "truth unites"], channels: [{ name: "Truth Unites" }] },
  { name: "Michael Jones", aliases: ["inspiring philosophy", "inspiringphilosophy"], channels: [{ name: "InspiringPhilosophy" }] },
];

// ---- the owner's list -------------------------------------------------------------------------------------------------
let db = null, dbFile = null;
function load() {
  if (db && dbFile === FILE()) return db;
  dbFile = FILE();
  try { db = existsSync(dbFile) ? JSON.parse(readFileSync(dbFile, "utf8").replace(/^﻿/, "")) : null; } catch { db = null; }
  db ??= {};
  db.people = Array.isArray(db.people) ? db.people : [];
  db.rejected = db.rejected && typeof db.rejected === "object" ? db.rejected : {};
  return db;
}
function save() { try { mkdirSync(dirname(dbFile), { recursive: true }); writeJSONAtomic(dbFile, db, 2); } catch (e) { console.log(`video creators: not saved (${e.message})`); } }
export function reload() { db = null; dbFile = null; }
const cleanChannel = (c) => ({ name: String(c?.name ?? "").slice(0, 100), handle: /^@[\w.-]{2,}$/.test(c?.handle ?? "") ? c.handle : null, channelId: /^UC[\w-]{20,}$/.test(c?.channelId ?? "") ? c.channelId : null });
// everyone: his entries first (a name he set wins over the built-in one)
export function people() {
  const mine = load().people.map((p) => ({ ...p, mine: true }));
  const taken = new Set(mine.flatMap((p) => [p.name, ...(p.aliases ?? [])].map(compact)));
  return [...mine, ...BUILT_IN.filter((p) => ![p.name, ...p.aliases].some((a) => taken.has(compact(a))))];
}
export const listFile = () => FILE();

// "when I say Pastor Bob I mean First Baptist Church" (or a pick after "not that channel")
export function setAlias(name, channel, { learned = false } = {}) {
  const n = String(name ?? "").trim().slice(0, 80), c = cleanChannel(typeof channel === "string" ? { name: channel } : channel);
  if (!n || !c.name) throw new Error("Say who and which channel, like “when I say Pastor Bob I mean First Baptist Church”.");
  const d = load(), key = compact(n);
  d.people = d.people.filter((p) => ![p.name, ...(p.aliases ?? [])].some((a) => compact(a) === key));
  d.people.unshift({ name: n, aliases: [norm(n)], channels: [c], ...(learned ? { learned: true } : {}), at: new Date().toISOString() });
  if (d.rejected[key]) d.rejected[key] = d.rejected[key].map(asRej).filter((r) => !same(r, c));
  save();
  return { name: n, channel: c };
}
export function removeAlias(name) {
  const d = load(), key = compact(name), before = d.people.length;
  d.people = d.people.filter((p) => ![p.name, ...(p.aliases ?? [])].some((a) => compact(a) === key));
  save();
  return before !== d.people.length;
}
// "not that channel": this channel is wrong for these words (kept by its id, handle and name, so the list's entry,
// which may only have a handle, is recognised too)
const same = (r, c) => Boolean(c) && ((r.id && r.id === c.channelId) || (r.handle && c.handle && r.handle.toLowerCase() === c.handle.toLowerCase()) || (r.name && c.name && compact(r.name) === compact(c.name)));
const asRej = (x) => (typeof x === "string" ? (/^UC/.test(x) ? { id: x } : /^@/.test(x) ? { handle: x } : { name: x }) : x);
export function reject(spoken, channel) {
  const d = load(), key = compact(spoken);
  if (!key || !channel || !(channel.channelId || channel.handle || channel.name)) return;
  const r = { id: channel.channelId ?? null, handle: channel.handle ?? null, name: channel.name ?? null, at: new Date().toISOString() };
  d.rejected[key] = [...(d.rejected[key] ?? []).map(asRej).filter((x) => !same(x, { channelId: r.id, handle: r.handle, name: r.name })), r].slice(-20);
  // a learned alias that pointed there is dropped
  d.people = d.people.filter((p) => !(p.learned && [p.name, ...(p.aliases ?? [])].some((a) => compact(a) === key) && p.channels.some((c) => same(r, c))));
  save();
}
const isRejected = (key, c) => (load().rejected[key] ?? []).map(asRej).some((r) => same(r, c));

// ---- matching ---------------------------------------------------------------------------------------------------------
// the best entry of the list for what was said: { person, score }
export function matchPerson(spoken) {
  const full = norm(spoken), s = full.replace(/^(?:the |pastor |doctor |dr |brother )/, "");
  let best = null;
  for (const p of people()) {
    for (const a of [p.name, ...(p.aliases ?? []), ...(p.channels ?? []).map((c) => c.name)]) {
      const sc = Math.max(nameSim(s, a), nameSim(full, a));
      if (!best || sc > best.score) best = { person: p, score: sc };
    }
  }
  return best && best.score >= 0.8 ? best : null;
}
// how well a channel from a search fits the words: its name, its handle, verified, how many subscribers
export function scoreChannel(spoken, c) {
  const byName = Math.max(nameSim(spoken, c.name), c.handle ? nameSim(spoken, c.handle.slice(1)) : 0);
  const subs = c.subscribers ? Math.min(0.06, Math.log10(Math.max(1, c.subscribers)) / 100) : 0;
  return Math.min(1, byName + (c.verified ? 0.05 : 0) + subs);
}

// ---- resolve -----------------------------------------------------------------------------------------------------------
// opts.search: (query) → channels (tests; default: youtube.mjs channels()); opts.verify: look a listed channel up to
// confirm it and learn its id (default true; off when offline is fine)
export async function resolve(spoken, { search = yt.channels, verify = true } = {}) {
  const words = String(spoken ?? "").trim();
  if (!words) return { channel: null, confidence: 0, options: [] };
  const key = compact(words);
  const hit = matchPerson(words);
  if (hit) {
    const via = hit.person.mine ? (hit.person.learned ? "learned" : "yours") : "list";
    const listed = (hit.person.channels ?? []).map(cleanChannel).filter((c) => c.name && !isRejected(key, c));
    for (const c of listed) {
      let found = null;
      if (verify || (!c.handle && !c.channelId)) {
        const res = await search(c.name).catch(() => null);
        if (res) found = res.filter((x) => !isRejected(key, x)).map((x) => ({ x, s: (c.handle && x.handle && x.handle.toLowerCase() === c.handle.toLowerCase() ? 1.2 : 0) + (c.channelId && x.channelId === c.channelId ? 1.2 : 0) + scoreChannel(c.name, x) }))
          .sort((a, b) => b.s - a.s).find((y) => y.s >= 0.85)?.x ?? null;
      }
      if (found || c.handle || c.channelId) {
        const ch = found ? { channelId: found.channelId, name: found.name, handle: found.handle ?? c.handle } : c;
        return { channel: ch, person: hit.person.name, via, confidence: Math.min(1, hit.score), options: [], verified: Boolean(found) };
      }
    }
  }
  // not on the list: the channels YouTube finds for the name
  const res = (await search(words).catch((e) => { throw Object.assign(new Error(`I couldn't reach YouTube to look up ${words} (${e.message}).`), { offline: true }); })) ?? [];
  const ranked = res.filter((c) => !isRejected(key, c)).map((c) => ({ c, s: scoreChannel(words, c) })).sort((a, b) => b.s - a.s);
  const top = ranked[0];
  const options = ranked.slice(0, 3).filter((r) => r.s >= 0.45).map((r) => ({ channelId: r.c.channelId, name: r.c.name, handle: r.c.handle, subscribers: r.c.subscribersText || null, score: Math.round(r.s * 100) / 100 }));
  if (!top || top.s < 0.45) return { channel: null, confidence: top?.s ?? 0, options: [], person: null, via: "search" };
  const clear = top.s >= 0.82 && (!ranked[1] || top.s - ranked[1].s >= 0.08 || ranked[1].s < 0.82);
  return { channel: { channelId: top.c.channelId, name: top.c.name, handle: top.c.handle }, person: null, via: "search", confidence: top.s, options: clear ? [] : options, unsure: !clear };
}
