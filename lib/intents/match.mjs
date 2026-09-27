// Matching what someone said to the closest things Dayspring knows how to do, with no AI and no network.
//   build()          expands every intent's phrasings (templates × synonyms) and indexes them once
//   rank(text, ctx)  → [{ intent, score, ctx }] best first (one entry per intent)
// Scoring blends: rare shared words count most (IDF-weighted overlap, both directions), small typos and sound-alike
// words are corrected against the catalogue's vocabulary, and details like {dur} or {ref} line up with phrasings that need them.
import { INTENTS } from "./catalog.mjs";
import { normalize, canon, tokens, phonetic, lev, STOP, SYNONYMS } from "./text.mjs";
import { extract } from "./slots.mjs";
import { CITY_TZ } from "../everyday.mjs";
import { US_CAPITALS, WORLD_CAPITALS } from "../reference.mjs";
import { BOOKS } from "../bible.mjs";
const BOOK_NAMES = BOOKS.flatMap((b) => b.toLowerCase().split(" ")).filter((w) => /^[a-z]{3,}$/.test(w));

// ---- the template language: (a|b) choose one, [a|b] optional, nesting allowed ---------------------------------------------
function parse(src) {
  let i = 0;
  function seq(end) {
    const parts = []; let lit = "";
    while (i < src.length && !end.includes(src[i])) {
      const ch = src[i];
      if (ch === "(" || ch === "[") { if (lit) { parts.push([lit]); lit = ""; } i++; const alts = group(ch === "(" ? ")" : "]"); parts.push(ch === "[" ? [...alts, ""] : alts); }
      else { lit += ch; i++; }
    }
    if (lit) parts.push([lit]);
    return parts;
  }
  function group(close) {
    const alts = [];
    for (;;) { const parts = seq(["|", close]); alts.push(...combine(parts, 60)); if (src[i] === "|") { i++; continue; } i++; break; }
    return alts;
  }
  return combine(seq([]), 400);
}
function combine(parts, cap) {
  let out = [""];
  for (const choices of parts) {
    const next = [];
    for (const a of out) for (const b of choices) { next.push(a + b); if (next.length > cap * 4) break; }
    out = next.length > cap ? spread(next, cap) : next;
  }
  return out;
}
const spread = (arr, n) => { if (arr.length <= n) return arr; const step = arr.length / n; return Array.from({ length: n }, (_, k) => arr[Math.floor(k * step)]); };

let INDEX = null;
export function build() {
  if (INDEX) return INDEX;
  const phrasings = [];               // { intent, toks:Set, free, weight }
  let expanded = 0;                   // every phrasing the templates spell out (before duplicates are merged)
  const df = new Map();
  // every word the catalogue uses as written (before synonyms and details): what typos get corrected towards
  const words = new Set([...SYN_WORDS, ...SLOT_WORDS]);
  const memo = new Map();
  for (const intent of INTENTS) {
    const seen = new Set();
    for (const tpl of intent.say) for (const raw of parse(tpl)) {
      const text = raw.replace(/\?/g, "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      expanded++;
      const free = /\{text\}/.test(text);
      // templates go through the same detail-finding as requests ("today" → {date}, "5 minutes" → {dur})
      const plain = text.replace(/\{text\}/g, " ");
      let c = memo.get(plain);
      if (c === undefined) {
        const n = normalizeTemplate(plain);
        for (const w of n.split(" ")) if (/^[a-z]{3,}$/.test(w)) words.add(w);
        c = canon(extract(n).masked); memo.set(plain, c);
      }
      const list = tokens(c), toks = new Set(list);
      if (!toks.size) continue;
      const first = /^\s*\{text\}/.test(text) ? null : firstWord(list);
      const key = [...toks].sort().join(" ") + (free ? "|f" : "") + "|" + first;
      if (seen.has(key)) continue; seen.add(key);
      phrasings.push({ intent, toks, free, first });
    }
  }
  for (const p of phrasings) for (const t of p.toks) df.set(t, (df.get(t) ?? 0) + 1);
  const N = phrasings.length;
  // little words ("the", "my", "to") count for a quarter: they help a little, they never decide
  const idf = new Map([...df].map(([t, n]) => [t, Math.log(1 + N / n) * (STOP.has(t) ? 0.25 : 1)]));
  const inverted = new Map();
  phrasings.forEach((p, k) => { p.w = [...p.toks].reduce((a, t) => a + idf.get(t), 0); for (const t of p.toks) { if (!inverted.has(t)) inverted.set(t, []); inverted.get(t).push(k); } });
  const vocab = [...df.keys()].filter((t) => !/^\{/.test(t));
  const phon = new Map(); for (const v of vocab) { const k = phonetic(v); if (k.length >= 2) { if (!phon.has(k)) phon.set(k, []); phon.get(k).push(v); } }
  const rawList = [...words].filter((w) => w.length >= 3);
  const rawByFirst = new Map(); for (const v of rawList) { if (!rawByFirst.has(v[0])) rawByFirst.set(v[0], []); rawByFirst.get(v[0]).push(v); }
  const rawPhon = new Map(); for (const v of rawList) { const k = phonetic(v); if (k.length >= 2) { if (!rawPhon.has(k)) rawPhon.set(k, []); rawPhon.get(k).push(v); } }
  INDEX = { expanded, phrasings, idf, inverted, vocab: new Set(vocab), vocabList: vocab, phon, N, intents: INTENTS.length, raw: new Set(rawList), rawList, rawByFirst, rawPhon };
  return INDEX;
}
// words the details are made of (months, days, units, holidays) and every synonym, so their typos get fixed too
const PLACE_WORDS = [...Object.keys(CITY_TZ), ...Object.keys(US_CAPITALS), ...Object.keys(WORLD_CAPITALS)].flatMap((p) => p.split(" "));
const SLOT_WORDS = [...PLACE_WORDS, ...BOOK_NAMES, ...("january february march april may june july august september october november december sunday monday tuesday wednesday thursday friday saturday " +
  "seconds minutes hours days weeks months years second minute hour week month year morning afternoon evening tonight tomorrow yesterday today noon midnight " +
  "christmas easter thanksgiving halloween valentines birthday mothers fathers memorial labor independence veterans hanukkah kwanzaa new years eve day").split(" ")];
const SLOT_SET = new Set(SLOT_WORDS.filter((w) => !PLACE_WORDS.includes(w)));
const BOOKISH = /^(genesis|exodus|leviticus|numbers|deuteronomy|joshua|judges|samuel|kings|chronicles|nehemiah|esther|psalms?|proverbs|ecclesiastes|isaiah|jeremiah|lamentations|ezekiel|daniel|hosea|obadiah|jonah|micah|nahum|habakkuk|zephaniah|haggai|zechariah|malachi|matthew|mark|luke|john|acts|romans|corinthians|galatians|ephesians|philippians|colossians|thessalonians|timothy|titus|philemon|hebrews|james|peter|jude|revelation)$/;
const SYN_WORDS = SYNONYMS.flat().flatMap((p) => p.split(" ")).filter((w) => /^[a-z]{3,}$/.test(w));
// typos in what was said, fixed against the catalogue's own words before anything else ("claendar" → "calendar",
// "tahnksgiving" → "thanksgiving"); numbers, short words and words it already knows are left alone
function correctWords(list, ix) {
  return list.map((t) => {
    if (t.length < 4 || ix.raw.has(t) || !/^[a-z]+$/.test(t) || STOP.has(t)) return t;
    let best = null, bestD = 9;
    for (const v of ix.rawByFirst.get(t[0]) ?? []) { if (Math.abs(v.length - t.length) > 2) continue; const d = lev(t, v, 2); if (d < bestD) { best = v; bestD = d; if (d === 1) break; } }
    if (best && bestD <= (t.length >= 7 ? 2 : 1)) return best;
    const ph = t.length >= 5 ? (ix.rawPhon.get(phonetic(t)) ?? []).find((v) => v[0] === t[0] && Math.abs(v.length - t.length) <= 1 && lev(t, v, 2) <= 2) : null;
    return ph ?? t;
  });
}
// templates are written in plain words; digits/placeholders pass through untouched
// (filler words drop out, as they do from what people say; a phrasing that is ALL filler, like "hi", keeps its words)
function normalizeTemplate(s) {
  const words = s.replace(/\{(\w+)\}/g, " {$1} ").replace(/\s+/g, " ").trim().split(" ");
  const one = (keepWhole) => words.map((w) => (/^\{/.test(w) ? w : normalize(w, { keepWhole }) || "")).filter(Boolean).join(" ");
  return one(false) || normalize(s);
}
// the first real word: commands usually start with their verb ("find my resume" is a search, not "resume")
const firstWord = (toks) => toks.find((t) => !STOP.has(t) && !/^\{/.test(t)) ?? null;

// small typos and sound-alikes → the catalogue's own words ("calender" → "calendar", "time her" → "timer")
function correct(toks, ix) {
  const out = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (ix.vocab.has(t) || /^\{/.test(t) || /^\d/.test(t)) { out.push(t); continue; }
    // two words that are one known word said apart ("time her" → "timer", "any more" → "anymore")
    const joined = t + (toks[k + 1] ?? "");
    if (toks[k + 1] && !ix.vocab.has(toks[k + 1]) && ix.vocab.has(joined)) { out.push(joined); k++; continue; }
    if (toks[k + 1] && t.length <= 5) { const pj = phonetic(joined); const hits = ix.phon.get(pj); if (hits && hits.length && hits[0].length >= 4 && !ix.vocab.has(toks[k + 1]) && lev(joined, hits[0], 2) <= 2) { out.push(hits[0]); k++; continue; } }
    let best = null, bestD = 9;
    if (t.length >= 4) for (const v of ix.vocabList) { if (Math.abs(v.length - t.length) > 2 || v[0] !== t[0] && t.length < 6) continue; const d = lev(t, v, 2); if (d < bestD || (d === bestD && best && ix.idf.get(v) < ix.idf.get(best))) { best = v; bestD = d; } }
    const allowed = t.length >= 7 ? 2 : t.length >= 4 ? 1 : 0;
    if (best && bestD <= allowed) { out.push(best); continue; }
    // a sound-alike: same first letter and about the same length ("wether" → "weather", never "zzkkq" → "sky")
    const ph = (ix.phon.get(phonetic(t)) ?? []).find((v) => v[0] === t[0] && Math.abs(v.length - t.length) <= 2);
    if (ph && t.length >= 4) { out.push(ph); continue; }
    out.push(t);
  }
  return out;
}

// what the matcher sees for a request
export function prepare(text, now = new Date()) {
  const ix = build();
  const said = normalize(text);
  const fixed = correctWords(said.split(" "), ix).join(" ");
  const { slots, masked } = extract(fixed, now);
  // plans read what was actually said (so "pasta" stays pasta); the corrected words are for matching and details
  const q = fixed.split(" ").length === said.split(" ").length ? said.split(" ").map((w, k) => (SLOT_SET.has(fixed.split(" ")[k]) || BOOKISH.test(fixed.split(" ")[k]) ? fixed.split(" ")[k] : w)).join(" ") : said;
  const toks = correct(tokens(canon(masked)), ix);
  return { raw: String(text ?? ""), q, masked, slots, toks, canonical: toks.join(" ") };
}

export function rank(text, ctxIn = {}) {
  const ix = build();
  const p = typeof text === "string" ? prepare(text, ctxIn.now) : text;
  const qset = [...new Set(p.toks)];
  const qW = qset.reduce((a, t) => a + (ix.idf.get(t) ?? 1.2), 0) || 1;
  // cover: how much of what was said (leaving out little words like "the") a phrasing shares — suggestions need some
  const content = qset.filter((t) => !STOP.has(t));
  const cW = content.reduce((a, t) => a + (ix.idf.get(t) ?? 1.2), 0);
  const qFirst = firstWord(p.toks);
  const cand = new Set();
  // candidates come from the real words (every phrasing has a "the" or a "my"; those alone never make a match)
  for (const t of content.length ? content : qset) for (const k of ix.inverted.get(t) ?? []) cand.add(k);
  const best = new Map();
  for (const k of cand) {
    const ph = ix.phrasings[k];
    let m = 0, unknownUnmatched = 0, knownUnmatched = 0;
    for (const t of qset) {
      if (ph.toks.has(t)) m += ix.idf.get(t) ?? 1.2;
      else if (ix.vocab.has(t) || /^\{/.test(t)) knownUnmatched += ix.idf.get(t) ?? 1.2;
      else unknownUnmatched += 1.2;
    }
    const recall = m / ph.w;
    const precision = ph.free ? m / Math.max(0.001, m + knownUnmatched * 0.55 + unknownUnmatched * 0.12) : m / qW;
    let s = ph.free ? 0.62 * recall + 0.38 * precision : 0.55 * recall + 0.45 * precision;
    if (qFirst && ph.first === qFirst) s *= 1.06;              // starts with the same verb
    // a phrasing with free words needs something left over to be those words
    if (ph.free && knownUnmatched + unknownUnmatched === 0 && recall < 1) s *= 0.9;
    const prev = best.get(ph.intent.id);
    const cm = cW ? content.reduce((a, t) => a + (ph.toks.has(t) ? ix.idf.get(t) ?? 1.2 : 0), 0) / cW : m / qW;
    if (!prev || s > prev.score) best.set(ph.intent.id, { intent: ph.intent, score: s, cover: cm });
  }
  const ctx = { ...p, state: ctxIn.state ?? {} };
  const out = [];
  for (const r of best.values()) {
    let s = r.score;
    const it = r.intent;
    if (it.needs && !it.needs.every((n) => (n === "duration" ? p.slots.duration : n === "date" ? p.slots.date : n === "time" ? p.slots.time : n === "ref" ? p.slots.ref : n === "version" ? p.slots.version : true))) s *= 0.8;
    if (it.check) { try { if (!it.check(ctx)) s *= 0.55; } catch { s *= 0.55; } }
    // catch-alls ("open …", "play …", "search …") give way to anything more specific; some words point one way
    if (it.prior) s *= it.prior;
    if (it.boost) { try { s *= it.boost(ctx) || 1; } catch { /* no boost */ } }
    // what's going on right now makes some things more likely
    const st = ctx.state;
    if (st.cooking && it.cat === "cooking") s *= 1.25;
    if (!st.cooking && it.cat === "cooking" && !["cook.stop"].includes(it.id)) s *= 0.8;
    if (st.recipeResults && ["recipe.pick", "recipe.more"].includes(it.id)) s *= 1.2;
    if (!st.recipeResults && it.id === "recipe.pick") s *= 0.75;
    if (st.ringing && it.id === "timer.dismiss") s *= 1.3;
    if (st.timers && it.cat === "timers" && it.id !== "timer.start") s *= 1.05;
    if (!st.media && ["media.pause", "media.next", "media.prev", "media.stop", "media.volume", "media.now", "media.resume"].includes(it.id)) s *= 0.95;
    // a detail that belongs to one family points there
    if (p.slots.ref && it.cat === "bible") s *= 1.15;
    if (p.slots.duration && ["timer.start", "timer.add"].includes(it.id)) s *= 1.08;
    out.push({ intent: it, raw: s, score: Math.min(1, s), cover: r.cover });
  }
  // (sorted on the uncapped score, so what's going on right now still breaks a tie between two perfect matches)
  out.sort((a, b) => b.raw - a.raw || a.intent.id.localeCompare(b.intent.id));
  return { prepared: ctx, ranked: out };
}
export const stats = () => { const ix = build(); return { intents: ix.intents, phrasings: ix.expanded, distinct: ix.N, vocabulary: ix.vocab.size }; };
