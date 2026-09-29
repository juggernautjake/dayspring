// Expression mode (optional, off until the owner turns it on in Settings → Look & feel → Avatar): now and then the avatar
// shows a GIF or a meme that fits how Dayspring feels about what it's saying, in its personality's genre (the cowboy's
// are western, the robot's are tech), then goes back to the avatar.
//
// Where they come from: nothing is bundled. GIFs are found live through Dayspring's GIF sources (lib/gifs: GIPHY, KLIPY,
// Imgur with the owner's own keys, and the keyless web search), at a rating of PG unless the owner picks G or PG-13, and
// kept in data/expressions/ for this computer only (under a size cap). The owner's own pictures and GIFs can be added,
// tagged with a feeling and a personality. The only pictures that ship are Dayspring's own simple SVG stickers
// (public/expressions/*.svg), used for the default personality when nothing else is at hand.
//
// Checked before use: the title, tags and page must fit the personality's genre and not contradict the feeling, and must
// be clean (lib/looks/packs.mjs); the GIF's own loop length is read from its frames (lib/looks/gifmeta.mjs); and, when
// "Describe images with AI" is on, the picture itself is looked at (lib/vision describeWebImage) with the question "does
// this fit, is it family-friendly, does any text in it say otherwise?". Windows' text reading checks the words in it
// either way. Every verdict is cached, so nothing is asked twice.
//
// Variety: a growing library per feeling × personality; the last N used for that pair are never picked again, and the
// rest are weighted toward the fresh and the less used. "Build my expression library" fetches up to 30 per pair,
// slowly, within the GIF sources' limits, with progress.
//
//   pick({ text, event, persona, speechMs, hint }) → { show, item?, emotion, why }
//   build({ personas, perCombo }) · buildStatus() · cancelBuild()
//   library() · remove(id) · clear() · addOwn(buffer, { emotion, persona, title }) · mediaFile(id)
//   noteHint(mood, text)            the AI's hint for the reply it just gave (lib/assistant.mjs)
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJSONAtomic } from "../atomic.mjs";
import * as looks from "./index.mjs";
import * as packs from "./packs.mjs";
import { classify, EMOTIONS, EMOTION_IDS } from "./emotion.mjs";
import { mediaInfo, planDuration } from "./gifmeta.mjs";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = () => process.env.DAYSPRING_EXPRESSIONS_DIR || join(process.env.DAYSPRING_DATA_DIR || join(DESK, "data"), "expressions");
const INDEX = () => join(DIR(), "index.json");
const MEDIA = () => join(DIR(), "media");

// the GIF sources, the safe media fetcher, the picture check: all swappable (tests never reach the internet)
let deps = {
  now: () => Date.now(), random: () => Math.random(),
  search: async ({ q, rating }) => { const g = await import("../gifs/index.mjs"); const ses = await g.searchOnce({ mode: "search", q, rating, type: "gif" }); return { items: ses.items, attribution: Object.fromEntries(g.PROVIDERS.map((p) => [p.id, p.attribution])) }; },
  fetchMedia: async (url) => (await import("../gifs/media.mjs")).fetchMedia(url, { maxBytes: 8 * 1024 * 1024, timeoutMs: 15_000 }),
  // { usable, reason } : may pictures go to the AI? (the owner's "Describe images with AI" consent, and a provider that sees)
  aiUsable: async () => { try { const v = await import("../vision/settings.mjs"); const llm = await import("../llm.mjs"); return { usable: Boolean(v.get().aiDescribe && llm.supportsImages()), reason: !v.get().aiDescribe ? "Describe images with AI is off" : "the AI can't look at pictures" }; } catch (e) { return { usable: false, reason: e.message }; } },
  describe: async (opts) => (await import("../vision/describe.mjs")).describeWebImage(opts),
  webAllowed: async () => { try { return (await import("../permissions.mjs")).get().web !== false; } catch { return true; } },
  searchGapMs: 1500, hourlySearches: 80,
};
export function setDeps(d) { deps = { ...deps, ...d }; }

// ---- the library (data/expressions/index.json) ----
let lib = null;
function load() {
  if (lib) return lib;
  let raw = {};
  try { if (existsSync(INDEX())) raw = JSON.parse(readFileSync(INDEX(), "utf8")); } catch { raw = {}; }
  lib = { items: raw.items && typeof raw.items === "object" ? raw.items : {}, verdicts: raw.verdicts && typeof raw.verdicts === "object" ? raw.verdicts : {}, recent: Array.isArray(raw.recent) ? raw.recent.slice(-300) : [], cursors: raw.cursors ?? {}, searches: Array.isArray(raw.searches) ? raw.searches.slice(-200) : [], lastShown: raw.lastShown ?? 0 };
  return lib;
}
function persist() { try { mkdirSync(DIR(), { recursive: true }); writeJSONAtomic(INDEX(), lib, 0); } catch (e) { console.log(`expressions: couldn't save the library (${e.message})`); } }
export function _reload() { lib = null; }
const comboKey = (pack, emotion) => `${pack}/${emotion}`;
export function items({ pack = null, emotion = null } = {}) { return Object.values(load().items).filter((x) => (!pack || x.pack === pack || (x.own && x.pack === "any")) && (!emotion || x.emotion === emotion)); }
export function library() {
  const L = load(), counts = {};
  let bytes = 0;
  for (const x of Object.values(L.items)) { (counts[x.pack] ??= {})[x.emotion] = (counts[x.pack][x.emotion] ?? 0) + 1; bytes += x.bytes ?? 0; }
  return { total: Object.keys(L.items).length, bytes, counts, own: Object.values(L.items).filter((x) => x.own).length, verdicts: Object.keys(L.verdicts).length, maxMB: looks.settings().expression.maxMB };
}
export function list({ pack, emotion, limit = 60 } = {}) {
  return items({ pack, emotion }).sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)).slice(0, limit).map(publicItem);
}
const publicItem = (x) => ({ id: x.id, title: x.title, emotion: x.emotion, pack: x.pack, own: Boolean(x.own), source: x.source, type: x.type, loopMs: x.loopMs, frames: x.frames, width: x.width, height: x.height, uses: x.uses ?? 0,
  url: `/api/expressions/media/${encodeURIComponent(x.id)}`, attribution: x.attribution ?? null, page: x.page ?? null, verdict: x.verdict ?? null, rating: x.rating ?? null });
export function mediaFile(id) {
  const x = load().items[id];
  if (!x) return null;
  const p = resolve(MEDIA(), x.file);
  if (!p.startsWith(resolve(MEDIA())) || !existsSync(p)) return null;
  return { path: p, type: x.type || "image/gif" };
}
export function remove(id) {
  const L = load(), x = L.items[id];
  if (!x) return { removed: false };
  delete L.items[id];
  // a GIF kept out is remembered, so it isn't fetched again
  if (!x.own && x.key) L.verdicts[x.key] = { ok: false, by: "owner", reason: "removed by you", at: deps.now() };
  if (!Object.values(L.items).some((y) => y.file === x.file)) rmSync(join(MEDIA(), x.file), { force: true });
  persist();
  return { removed: true };
}
export function clear({ keepOwn = true } = {}) {
  const L = load(); let n = 0;
  for (const [id, x] of Object.entries(L.items)) if (!(keepOwn && x.own)) { delete L.items[id]; n++; }
  const keep = new Set(Object.values(L.items).map((x) => x.file));
  try { for (const f of readdirSync(MEDIA())) if (!keep.has(f)) rmSync(join(MEDIA(), f), { force: true }); } catch { /* none */ }
  L.recent = []; L.cursors = {};
  persist();
  return { removed: n };
}
// oldest-used first, until the library is under its cap (the owner's own pictures are never pruned)
export function prune(maxMB = looks.settings().expression.maxMB) {
  const L = load();
  let total = Object.values(L.items).reduce((a, x) => a + (x.bytes ?? 0), 0), removed = 0;
  const cand = Object.values(L.items).filter((x) => !x.own).sort((a, b) => (a.lastUsed ?? a.addedAt ?? 0) - (b.lastUsed ?? b.addedAt ?? 0));
  for (const x of cand) { if (total <= maxMB * 1024 * 1024) break; delete L.items[x.id]; total -= x.bytes ?? 0; removed++; if (!Object.values(L.items).some((y) => y.file === x.file)) rmSync(join(MEDIA(), x.file), { force: true }); }
  if (removed) persist();
  return removed;
}

// ---- the AI's hint for the reply it just gave ----
let hint = null;
export function noteHint(mood, text) { hint = mood ? { mood, text: String(text ?? "").slice(0, 200), at: deps.now() } : null; }
function hintFor(text) {
  if (!hint || deps.now() - hint.at > 120_000) return null;
  const a = String(text ?? "").slice(0, 60).toLowerCase(), b = hint.text.slice(0, 60).toLowerCase();
  return !a || !b || a.slice(0, 30) === b.slice(0, 30) || b.includes(a.slice(0, 30)) ? hint.mood : null;
}

// ---- the stickers that ship (original SVGs, drawn for Dayspring) ----
export const STICKERS = Object.fromEntries(EMOTION_IDS.map((e) => [e, { url: `/expressions/${e}.svg`, loopMs: ["sleepy", "sad", "thinking"].includes(e) ? 3000 : 2000 }]));

// ---- choosing one ----
const OFTEN = { always: { conf: 0.3, gap: 0 }, sometimes: { conf: 0.42, gap: 40_000 }, rarely: { conf: 0.6, gap: 180_000 }, events: { conf: 2, gap: 0 } };
export async function pick({ text = "", event = null, persona = null, speechMs = 0, hint: given = null, force = false, emotion: want = null } = {}) {
  const s = looks.settings().expression;
  if (!s.on && !force) return { show: false, why: "expression mode is off" };
  const who = persona ?? (await looks.personaNow()).preset;
  const c = want && EMOTIONS[want] ? { emotion: want, confidence: 1, why: ["asked"] } : classify(text, { hint: s.aiHint ? given ?? hintFor(text) : null, event: s.events || force ? event : null });
  if (!c.emotion) return { show: false, why: "no clear feeling", emotion: null };
  const rule = OFTEN[s.often] ?? OFTEN.sometimes, L = load();
  if (!force && !event && c.confidence < rule.conf) return { show: false, why: `not sure enough (${c.confidence})`, emotion: c.emotion, confidence: c.confidence };
  if (!force && !event && deps.now() - (L.lastShown ?? 0) < rule.gap) return { show: false, why: "shown one a moment ago", emotion: c.emotion };
  const pack = packs.packFor(who).id;
  let pool = candidates(pack, c.emotion);
  let from = pack;
  // nothing yet for this personality: the default pack's own stickers (only for the default personality)
  const chosen = choose(pool, pack, c.emotion, s.noRepeat);
  if (s.web) topUpSoon(pack, c.emotion, pool.length);
  if (!chosen) {
    if (pack === "default" && STICKERS[c.emotion]) {
      L.lastShown = deps.now(); persist();
      return { show: true, emotion: c.emotion, confidence: c.confidence, item: { id: `sticker:${c.emotion}`, url: STICKERS[c.emotion].url, type: "image/svg+xml", loopMs: STICKERS[c.emotion].loopMs, title: EMOTIONS[c.emotion].label, sticker: true, attribution: { text: "A Dayspring sticker" }, plan: planDuration(STICKERS[c.emotion].loopMs, speechMs) } };
    }
    return { show: false, why: `nothing in the ${pack} pack for ${c.emotion} yet`, emotion: c.emotion, pack };
  }
  chosen.uses = (chosen.uses ?? 0) + 1; chosen.lastUsed = deps.now();
  L.recent.push({ id: chosen.id, combo: comboKey(from, c.emotion), at: deps.now() }); L.recent = L.recent.slice(-300);
  L.lastShown = deps.now();
  persist();
  return { show: true, emotion: c.emotion, confidence: c.confidence, pack, item: { ...publicItem(chosen), plan: planDuration(chosen.loopMs, speechMs) } };
}
function candidates(pack, emotion) {
  const L = load(), own = looks.settings().expression.own;
  return Object.values(L.items).filter((x) => x.emotion === emotion && x.verdict?.ok !== false && (x.pack === pack || (x.own && own && (x.pack === "any" || x.pack === pack))) && (!x.own || own));
}
// never one of the last N shown for this pair; the rest weighted toward the fresh and the less used
export function choose(pool, pack, emotion, noRepeat = 12) {
  if (!pool.length) return null;
  const L = load(), combo = comboKey(pack, emotion);
  const recentIds = L.recent.filter((r) => r.combo === combo).map((r) => r.id);
  const window = Math.min(noRepeat, pool.length - 1);
  const avoid = new Set(recentIds.slice(-window));
  const fresh = window > 0 ? pool.filter((x) => !avoid.has(x.id)) : pool;
  const now = deps.now();
  const w = fresh.map((x) => { const hours = x.lastUsed ? (now - x.lastUsed) / 3600_000 : 96; return (1 / (1 + (x.uses ?? 0))) * (1 + Math.min(hours, 96) / 24) * (x.own ? 1.3 : 1) * (0.35 + deps.random()); });
  let r = w.reduce((a, b) => a + b, 0) * deps.random();
  for (let i = 0; i < fresh.length; i++) { r -= w[i]; if (r <= 0) return fresh[i]; }
  return fresh[fresh.length - 1];
}

// ---- fetching and checking ----
// each search waits its turn: at least searchGapMs apart, and at most hourlySearches in an hour (GIPHY's free key allows 100)
let lastSearch = 0;
async function searchTurn(signal) {
  const L = load();
  for (;;) {
    if (signal?.aborted) throw new Error("stopped");
    const now = deps.now(), hour = L.searches.filter((t) => now - t < 3600_000);
    L.searches = hour;
    const wait = Math.max(0, lastSearch + deps.searchGapMs - now, hour.length >= deps.hourlySearches ? hour[0] + 3600_000 - now : 0);
    if (!wait) break;
    await new Promise((r) => setTimeout(r, Math.min(wait, 5000)));
  }
  lastSearch = deps.now(); L.searches.push(lastSearch);
}
const keyOf = (it, pack, emotion) => `${pack}/${emotion}/${it.canonical ?? it.id}`;
const words = (it) => [it.title, ...(it.tags ?? []), it.page ? decodeURIComponent(String(it.page).replace(/^https?:\/\/[^/]+/, "")) : ""].join(" ");
// The AI's look at the picture: its verdict line, "FITS: yes|no" and "SAFE: yes|no"
export function parseVerdict(text) {
  const t = String(text ?? "");
  const fits = /FITS\s*:\s*(yes|no)/i.exec(t)?.[1]?.toLowerCase(), safe = /SAFE\s*:\s*(yes|no)/i.exec(t)?.[1]?.toLowerCase(), genre = /GENRE\s*:\s*(yes|no)/i.exec(t)?.[1]?.toLowerCase();
  if (!fits || !safe) return null;
  return { fits: fits === "yes", safe: safe === "yes", genre: genre ? genre === "yes" : null, reason: t.replace(/(FITS|SAFE|GENRE)\s*:\s*(yes|no)\.?/gi, "").replace(/\s+/g, " ").trim().slice(0, 200) };
}
// the verdict for one candidate: the words first (free, instant), then the picture (text in it, and the AI when allowed)
export async function verify(it, buf, { pack, emotion, ai }) {
  const text = words(it);
  const bad = packs.blocked(text, pack);
  if (bad) return { ok: false, by: "words", reason: `its title or tags say ${bad}` };
  const fit = packs.emotionFit(emotion, text);
  if (!fit.ok) return { ok: false, by: "words", reason: `its words (${fit.clash.join(", ")}) don't fit ${EMOTIONS[emotion].label.toLowerCase()}` };
  let genre = packs.genreMatch(pack, text);
  let looked = null;
  if (ai?.usable || (buf && deps.describe)) {
    const pk = packs.packFor(pack);
    const question = `This is one frame of a reaction GIF titled "${String(it.title).slice(0, 100)}". Dayspring, a family-friendly home assistant, wants to show it to express the feeling "${EMOTIONS[emotion].label}"${pk.match.length ? ` in a ${pk.genre} style` : ""}. Answer on the first lines exactly: "FITS: yes" or "FITS: no" (does the picture express that feeling?), "SAFE: yes" or "SAFE: no" (is it suitable for all ages, with no violence, weapons, nudity, alcohol, rude gestures or offensive text?)${pk.match.length ? `, "GENRE: yes" or "GENRE: no" (is it ${pk.genre}?)` : ""}. Say no if any text in the picture contradicts the feeling. Then one short reason.`;
    try {
      looked = await deps.describe({ buffer: buf, title: it.title, question, detail: "brief", ...(ai?.usable ? {} : { ai: false }) });
    } catch (e) { looked = { error: e.message }; }
    const ocr = String(looked?.ocr?.text ?? "").trim();
    if (ocr) {
      const b2 = packs.blocked(ocr, pack);
      if (b2) return { ok: false, by: "text in the picture", reason: `the text in it says ${b2}` };
      const f2 = packs.emotionFit(emotion, ocr);
      if (!f2.ok) return { ok: false, by: "text in the picture", reason: `the text in it (${f2.clash.join(", ")}) says something else` };
      if (!genre && packs.genreMatch(pack, ocr)) genre = true;
    }
    if (looked?.usedAI) {
      const v = parseVerdict(looked.text);
      if (v) {
        if (!v.safe) return { ok: false, by: "ai", reason: v.reason || "the picture check found it unsuitable" };
        if (!v.fits) return { ok: false, by: "ai", reason: v.reason || `it doesn't look ${EMOTIONS[emotion].label.toLowerCase()}` };
        if (v.genre === false && !genre) return { ok: false, by: "ai", reason: `it isn't ${packs.packFor(pack).genre}` };
        if (v.genre === true) genre = true;
        return genre ? { ok: true, by: "ai", reason: v.reason, fitWords: fit.hits } : { ok: false, by: "ai", reason: `nothing says it's ${packs.packFor(pack).genre}` };
      }
    }
  }
  if (!genre) return { ok: false, by: "words", reason: `nothing in its title or tags says it's ${packs.packFor(pack).genre}` };
  return { ok: true, by: "words", reason: fit.hits.length ? `its words fit (${fit.hits.join(", ")})` : "its words are clean and in genre", fitWords: fit.hits };
}
// one search for a pair: new, clean, in-genre GIFs are checked and kept, up to `want`
export async function fetchBatch(pack, emotion, { want = 8, signal = null, stats = null } = {}) {
  const L = load(), s = looks.settings().expression;
  if (!(await deps.webAllowed())) return { added: 0, why: "looking things up on the web is off (Settings → Permissions)" };
  const qs = packs.queriesFor(pack, emotion, 14);
  if (!qs.length) return { added: 0, why: "no searches for that" };
  const ck = comboKey(pack, emotion), ci = (L.cursors[ck] ?? 0) % qs.length;
  L.cursors[ck] = ci + 1;
  const q = qs[ci];
  await searchTurn(signal);
  let res;
  try { res = await deps.search({ q, rating: s.rating }); }
  catch (e) { return { added: 0, why: `the GIF search failed (${e.message})`, q }; }
  const ai = await deps.aiUsable().catch(() => ({ usable: false }));
  const have = new Set(Object.values(L.items).map((x) => x.key));
  let added = 0, rejected = 0, seen = 0;
  for (const it of res.items ?? []) {
    if (signal?.aborted || added >= want) break;
    // the rating filter: the item must be rated no higher than the expression rating (items without a rating are never used)
    const r = String(it.rating ?? "").toLowerCase(), order = ["g", "pg", "pg-13", "r"];
    if (!order.includes(r) || order.indexOf(r) > order.indexOf(s.rating)) { rejected++; continue; }
    const key = keyOf(it, pack, emotion);
    if (have.has(key)) continue;
    const prior = L.verdicts[key];
    if (prior && !prior.ok) { rejected++; continue; }
    seen++;
    // words first: nothing is downloaded for a GIF whose own title rules it out
    const pre = packs.blocked(words(it), pack) || (!packs.emotionFit(emotion, words(it)).ok && "clash");
    if (pre) { L.verdicts[key] = { ok: false, by: "words", reason: pre === "clash" ? "its words don't fit the feeling" : `its words say ${pre}`, at: deps.now() }; rejected++; continue; }
    const url = it.preview && /\.(gif|webp|mp4)(\?|$)/i.test(it.preview) ? it.preview : it.gif ?? it.webp ?? it.mp4 ?? it.preview;
    let m;
    try { m = await deps.fetchMedia(url); } catch (e) { stats && (stats.failed = (stats.failed ?? 0) + 1); continue; }
    const info = mediaInfo(m.buf, m.type);
    if (!info.type || !/^(image\/(gif|webp|png|jpeg)|video\/mp4)$/.test(info.type)) { rejected++; continue; }
    const v = await verify(it, m.buf, { pack, emotion, ai });
    L.verdicts[key] = { ...v, at: deps.now() };
    if (!v.ok) { rejected++; stats && (stats.reasons = [...(stats.reasons ?? []), v.reason].slice(-20)); continue; }
    const ext = { "image/gif": "gif", "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "video/mp4": "mp4" }[info.type];
    const file = `${createHash("sha1").update(String(url)).digest("hex").slice(0, 16)}.${ext}`;
    mkdirSync(MEDIA(), { recursive: true });
    if (!existsSync(join(MEDIA(), file))) writeFileSync(join(MEDIA(), file), m.buf);
    const id = `${pack}.${emotion}.${createHash("sha1").update(key).digest("hex").slice(0, 12)}`;
    L.items[id] = { id, key, pack, emotion, query: q, source: it.source, sourceId: it.sourceId, title: it.title, tags: (it.tags ?? []).slice(0, 12), rating: it.rating, page: it.page ?? null,
      attribution: res.attribution?.[it.source] ?? null, file, type: info.type, bytes: m.buf.length, width: info.width ?? it.width ?? null, height: info.height ?? it.height ?? null,
      loopMs: info.loopMs ?? 0, frames: info.frames ?? null, loops: info.loops ?? null, verdict: { ok: true, by: v.by, reason: v.reason }, addedAt: deps.now(), uses: 0, lastUsed: 0 };
    have.add(key); added++;
  }
  persist();
  prune();
  return { added, rejected, seen, q };
}
// a pair running low gets a few more, in the background, now and then (never two at once, never more than every 10 min)
const topping = new Map();
function topUpSoon(pack, emotion, have) {
  const s = looks.settings().expression, ck = comboKey(pack, emotion);
  if (have >= Math.max(3, Math.round(s.perCombo / 3)) || building) return;
  if (topping.has(ck) && deps.now() - topping.get(ck) < 10 * 60_000) return;
  topping.set(ck, deps.now());
  fetchBatch(pack, emotion, { want: 6 }).catch((e) => console.log(`expressions: ${e.message}`));
}

// ---- building the library ----
let building = null;
export function buildStatus() {
  if (!building) return { running: false, ...(lastBuild ?? {}) };
  return { running: true, ...building.status };
}
let lastBuild = null;
export function build({ personas = null, perCombo = null, emotions = null } = {}) {
  if (building) return buildStatus();
  const s = looks.settings().expression;
  const per = Math.max(3, Math.min(100, Number(perCombo) || s.perCombo));
  const packIds = [...new Set((personas?.length ? personas : ["default"]).map((p) => packs.packFor(p).id))];
  const ems = (emotions?.length ? emotions : EMOTION_IDS).filter((e) => EMOTIONS[e]);
  const combos = packIds.flatMap((p) => ems.map((e) => [p, e]));
  const ctl = new AbortController();
  const status = { id: randomUUID().slice(0, 8), startedAt: deps.now(), total: combos.length, done: 0, added: 0, rejected: 0, failed: 0, current: null, perCombo: per, packs: packIds, reasons: [], finishedAt: null, stopped: false, error: null };
  building = { ctl, status };
  (async () => {
    try {
      for (const [p, e] of combos) {
        if (ctl.signal.aborted) break;
        status.current = `${p} · ${EMOTIONS[e].label}`;
        let tries = 0;
        while (!ctl.signal.aborted && items({ pack: p, emotion: e }).filter((x) => !x.own).length < per && tries < 4) {
          tries++;
          const r = await fetchBatch(p, e, { want: per - items({ pack: p, emotion: e }).length, signal: ctl.signal, stats: status });
          status.added += r.added ?? 0; status.rejected += r.rejected ?? 0;
          if (r.why && !r.added) { status.lastWhy = r.why; if (/Permissions|failed/.test(r.why)) break; }
        }
        status.done++;
      }
    } catch (e) { status.error = e.message; }
    status.finishedAt = deps.now(); status.stopped = ctl.signal.aborted; status.current = null;
    lastBuild = { ...status, running: false };
    building = null;
  })();
  return buildStatus();
}
export function cancelBuild() { if (building) building.ctl.abort(); return buildStatus(); }

// ---- the owner's own pictures and GIFs ----
export function addOwn(buf, { emotion, persona = "any", title = "" } = {}) {
  if (!EMOTIONS[emotion]) throw Object.assign(new Error("Pick the feeling this picture shows."), { status: 400 });
  if (!buf?.length) throw Object.assign(new Error("That file is empty."), { status: 400 });
  if (buf.length > 15 * 1024 * 1024) throw Object.assign(new Error("That file is too big (15 MB at most)."), { status: 413 });
  const info = mediaInfo(buf);
  if (!info.type || !/^(image\/(gif|webp|png|jpeg)|video\/mp4)$/.test(info.type)) throw Object.assign(new Error("That isn't a GIF, picture or MP4 I can show."), { status: 415 });
  const pack = persona === "any" ? "any" : packs.packFor(persona).id;
  const L = load(), hash = createHash("sha1").update(buf).digest("hex").slice(0, 16);
  const ext = { "image/gif": "gif", "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "video/mp4": "mp4" }[info.type];
  mkdirSync(MEDIA(), { recursive: true });
  const file = `own-${hash}.${ext}`;
  writeFileSync(join(MEDIA(), file), buf);
  const id = `own.${pack}.${emotion}.${hash.slice(0, 10)}`;
  L.items[id] = { id, key: `own/${hash}/${pack}/${emotion}`, own: true, pack, emotion, title: String(title || EMOTIONS[emotion].label).slice(0, 80), source: "yours", file, type: info.type, bytes: buf.length,
    width: info.width ?? null, height: info.height ?? null, loopMs: info.loopMs ?? 0, frames: info.frames ?? null, verdict: { ok: true, by: "you", reason: "your own picture" }, addedAt: deps.now(), uses: 0, lastUsed: 0 };
  persist();
  return publicItem(L.items[id]);
}
export function usage() {
  let bytes = 0, files = 0;
  try { for (const f of readdirSync(MEDIA())) { bytes += statSync(join(MEDIA(), f)).size; files++; } } catch { /* none yet */ }
  return { bytes, files };
}
