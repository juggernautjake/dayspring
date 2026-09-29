// Expression packs: the kind of GIFs each personality reaches for (lib/looks/expression-packs.json, the one editable
// file; the owner's changes in data/expression-packs.json are merged over it and survive updates).
//   packFor(personaId)                 → { id, genre, subjects, match, queries, avoid }  (the default pack for anyone unknown)
//   queriesFor(personaId, emotion, n)  → search phrases: the hand-picked ones first, then subject × emotion words
//   genreMatch(personaId, text)        → true when the words (title, tags, page, OCR) are this pack's genre
//   emotionFit(emotion, text)          → { ok, clash, hits }  words that fit, and words that contradict the emotion
//   blocked(text, personaId)           → a reason when something must never be shown
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EMOTIONS } from "./emotion.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESK = join(HERE, "..", "..");
const OVERRIDE = () => process.env.DAYSPRING_EXPRESSION_PACKS || join(process.env.DAYSPRING_DATA_DIR || join(DESK, "data"), "expression-packs.json");
let cache = null, cacheAt = 0;
export function load() {
  if (cache && Date.now() - cacheAt < 30_000) return cache;
  const base = JSON.parse(readFileSync(join(HERE, "expression-packs.json"), "utf8"));
  let over = {};
  try { if (existsSync(OVERRIDE())) over = JSON.parse(readFileSync(OVERRIDE(), "utf8")); } catch (e) { console.log(`expression packs: data/expression-packs.json isn't valid JSON (${e.message}); using the built-in packs`); }
  const packs = structuredClone(base.packs);
  for (const [id, p] of Object.entries(over.packs ?? {})) {
    const b = packs[id] ?? { genre: id, subjects: [], match: [], queries: {}, avoid: [] };
    packs[id] = { ...b, ...p, queries: { ...(b.queries ?? {}), ...(p.queries ?? {}) } };
  }
  cache = { packs }; cacheAt = Date.now();
  return cache;
}
export const _reset = () => { cache = null; };
export const ids = () => Object.keys(load().packs);
export function packFor(personaId) {
  const P = load().packs;
  const id = P[personaId] ? personaId : "default";
  return { id, ...P[id], subjects: P[id].subjects ?? [], match: P[id].match ?? [], queries: P[id].queries ?? {}, avoid: P[id].avoid ?? [] };
}
export function queriesFor(personaId, emotion, n = 12) {
  const p = packFor(personaId), E = EMOTIONS[emotion];
  if (!E) return [];
  const out = [...(p.queries[emotion] ?? [])];
  const words = E.words.slice(0, 4);
  // subject × emotion word, interleaved so the first few are all different subjects
  for (let i = 0; i < words.length; i++) for (const s of p.subjects) out.push(`${s} ${words[i]}`);
  return [...new Set(out.map((q) => q.toLowerCase().replace(/\s+/g, " ").trim()))].slice(0, n);
}
const norm = (s) => ` ${String(s ?? "").toLowerCase().replace(/[_\-/.]+/g, " ").replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ")} `;
const has = (hay, w) => hay.includes(` ${w.toLowerCase()} `) || hay.includes(` ${w.toLowerCase()}s `);
export function genreMatch(personaId, text) {
  const p = packFor(personaId);
  if (!p.match.length) return true;                       // the default pack takes anything wholesome
  const hay = norm(text);
  return p.match.some((w) => has(hay, w));
}
export function emotionFit(emotion, text) {
  const E = EMOTIONS[emotion]; if (!E) return { ok: false, clash: [], hits: [] };
  const hay = norm(text);
  const clash = E.clash.filter((w) => has(hay, w));
  const hits = E.words.filter((w) => has(hay, w));
  return { ok: !clash.length, clash, hits };
}
// never on the screen, whatever the rating says
const NEVER = ["nsfw", "nude", "naked", "sexy", "sex", "porn", "xxx", "boobs", "butt", "twerk", "stripper", "gore", "blood", "bloody", "corpse", "dead body", "suicide", "kill", "killing", "murder", "gun", "guns", "shooting", "shoot", "rifle", "pistol", "weapon", "bomb", "terror", "nazi", "drunk", "beer", "wine", "vodka", "whiskey", "cocaine", "weed", "marijuana", "smoking", "cigarette", "vape", "fuck", "shit", "bitch", "damn", "hell", "wtf", "middle finger", "hate", "racist", "slur", "horror", "scary", "creepy", "jumpscare", "vomit", "puke", "injury", "injured"];
export function blocked(text, personaId = null) {
  const hay = norm(text);
  const bad = NEVER.find((w) => has(hay, w));
  if (bad) return `"${bad}"`;
  const av = personaId ? packFor(personaId).avoid.find((w) => has(hay, w)) : null;
  return av ? `"${av}" (kept out of this pack)` : null;
}
