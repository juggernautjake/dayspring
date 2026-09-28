// GIFs from several places at once, merged into one list (the GIF picker, public/gifs.js; the voice commands and the
// AI's tools, lib/gifs/routes.mjs).
//
// Providers are plug-in adapters (lib/gifs/providers/*.mjs, all with the same shape: id, label, needsKey, keyVar,
// supports, attribution, keyGuide, search(), trending(), categories?(), test()). Adding one = one file + one line in
// PROVIDERS below. Today: GIPHY, KLIPY and Imgur (each with its own free key) and the keyless web search, which always
// works. (Tenor's API closed on June 30, 2026, so it isn't here.)
//
// A search asks every usable provider at once. Each has its own time limit (4 s), retries (with a growing pause) when
// its service stumbles, and a circuit breaker: after 3 failures in a row it's skipped for 3 minutes; "too many
// searches" (429) skips it until it says to come back; a refused key skips it until the key changes. Results come out
// as they arrive (a session's events: status per provider, then items), so one slow provider never holds up the rest:
// the first batch goes out once every provider has answered or 0.6 s after the first one did, and a late provider's
// GIFs follow in the next batch. Each batch is fair (one from each provider per round, the best match to the words
// first), rated no higher than asked, and without duplicates (the same GIF on two sites: same GIPHY id or address,
// or the same title and shape). The screen also drops near-identical pictures by their look (public/gifs.js).
//
//   settings() / setSettings(patch)       data/gifs.json (with favourites, recents and an install id for KLIPY)
//   providerList()                        what each provider is, whether it has a key (never the key), its state
//   startSession({ mode, q, rating, type, providers }) → session: .events, .on(fn), .more(), .idle, .items
//   searchOnce(opts) → { items, statuses }  the first batch, for the AI and voice (no streaming)
//   categories() · testProvider(id) · item(id) · remember(item) · favorites / recents · save(id) · file(id)
import * as giphy from "./providers/giphy.mjs";
import * as klipy from "./providers/klipy.mjs";
import * as imgur from "./providers/imgur.mjs";
import * as web from "./providers/web.mjs";
import * as media from "./media.mjs";
import { RATINGS, cleanRating, ratingOk, canonicalKeys, ProviderError } from "./common.mjs";
import { randomUUID, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { writeJSONAtomic } from "../atomic.mjs";

export const PROVIDERS = [giphy, klipy, imgur, web];
const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));
export const providerIds = () => PROVIDERS.map((p) => p.id);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DATA_DIR = () => process.env.DAYSPRING_GIFS_DIR || join(ROOT, "data", "gifs");
const FILE = () => process.env.DAYSPRING_GIFS_FILE || join(ROOT, "data", "gifs.json");
const TRENDING_FILE = () => join(DATA_DIR(), "trending.json");
export const PICTURES_DIR = () => process.env.DAYSPRING_PICTURES_DIR || join(homedir(), "Pictures");
export const KEY_VARS = PROVIDERS.filter((p) => p.keyVar).map((p) => p.keyVar);

export const TIMEOUT_MS = 4000, WINDOW_MS = 600, PAGE = 24, FAILS_TO_OPEN = 3, OPEN_MS = 3 * 60_000, RATE_MS = 60_000, KEY_MS = 10 * 60_000;
const CACHE_MS = 10 * 60_000, TRENDING_MS = 30 * 60_000, TRENDING_STALE_MS = 24 * 3600_000;

let deps = { fetch: (...a) => fetch(...a), now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), base: {}, permissions: async () => import("../permissions.mjs"), timeoutMs: null, windowMs: null };
export function setDeps(d) { deps = { ...deps, ...d, base: { ...deps.base, ...(d?.base ?? {}) } }; }
const now = () => deps.now();
const timeoutMs = () => deps.timeoutMs ?? (Number(process.env.DAYSPRING_GIFS_TIMEOUT_MS) || TIMEOUT_MS);
const windowMs = () => deps.windowMs ?? WINDOW_MS;

// ---- settings, favourites, recents (data/gifs.json) ------------------------------------------------------------------
export const FORMATS = ["gif", "mp4", "webp"], AUTOPLAY = ["always", "hover", "never"], TYPES = ["gif", "sticker"];
const DEFAULTS = () => ({ providers: Object.fromEntries(PROVIDERS.map((p) => [p.id, { on: true }])), order: providerIds(), rating: "pg-13", format: "gif", autoplay: "always", dataSaver: false, saveDir: "", cacheMB: 200, sayTitle: true, type: "gif" });
let store = null;
function load() {
  if (store) return store;
  let raw = {};
  try { if (existsSync(FILE())) raw = JSON.parse(readFileSync(FILE(), "utf8")); } catch { raw = {}; }
  store = { settings: cleanSettings(raw.settings ?? {}), favorites: Array.isArray(raw.favorites) ? raw.favorites.filter((x) => x?.id).slice(0, 300) : [], recents: Array.isArray(raw.recents) ? raw.recents.filter((x) => x?.id).slice(0, 60) : [], customerId: typeof raw.customerId === "string" && /^[\w-]{8,64}$/.test(raw.customerId) ? raw.customerId : randomUUID() };
  for (const x of [...store.favorites, ...store.recents]) known.set(x.id, x);
  return store;
}
function persist() {
  const s = load();
  try { mkdirSync(dirname(FILE()), { recursive: true }); writeJSONAtomic(FILE(), { settings: s.settings, favorites: s.favorites, recents: s.recents, customerId: s.customerId }, 2); }
  catch (e) { console.log(`gifs: couldn't save settings (${e.message})`); }
}
export function _reload() { store = null; known.clear(); }
function cleanSettings(x = {}, base = DEFAULTS()) {
  const out = structuredClone(base);
  if (x.providers && typeof x.providers === "object") for (const id of providerIds()) if (x.providers[id] && typeof x.providers[id].on === "boolean") out.providers[id] = { on: x.providers[id].on };
  if (Array.isArray(x.order)) { const o = [...new Set(x.order.filter((id) => BY_ID.has(id)))]; out.order = [...o, ...providerIds().filter((id) => !o.includes(id))]; }
  if (x.rating !== undefined) out.rating = cleanRating(x.rating, out.rating);
  if (FORMATS.includes(x.format)) out.format = x.format;
  if (AUTOPLAY.includes(x.autoplay)) out.autoplay = x.autoplay;
  if (typeof x.dataSaver === "boolean") out.dataSaver = x.dataSaver;
  if (typeof x.sayTitle === "boolean") out.sayTitle = x.sayTitle;
  if (TYPES.includes(x.type)) out.type = x.type;
  if (x.cacheMB !== undefined) { const n = Math.round(Number(x.cacheMB)); if (Number.isFinite(n)) out.cacheMB = Math.max(20, Math.min(5000, n)); }
  if (typeof x.saveDir === "string") out.saveDir = x.saveDir.trim().slice(0, 400);
  return out;
}
export const settings = () => structuredClone(load().settings);
export function setSettings(patch = {}) {
  const s = load();
  if (patch.rating !== undefined && !cleanRating(patch.rating)) throw new Error("The rating must be G, PG, PG-13 or R.");
  if (patch.format !== undefined && !FORMATS.includes(patch.format)) throw new Error("The format must be GIF, MP4 or WebP.");
  if (patch.autoplay !== undefined && !AUTOPLAY.includes(patch.autoplay)) throw new Error("Autoplay must be always, on hover or never.");
  if (patch.saveDir && !/^[a-z]:[\\/]|^\\\\|^\//i.test(String(patch.saveDir).trim())) throw new Error("The save folder must be a full path, like C:\\Users\\you\\Pictures\\GIFs.");
  const merged = { ...s.settings, ...patch, providers: { ...s.settings.providers, ...(patch.providers ?? {}) } };
  s.settings = cleanSettings(merged, s.settings);
  persist();
  return settings();
}
export const customerId = () => load().customerId;

// ---- the providers' state: keys, the circuit breaker ------------------------------------------------------------------
const health = new Map();          // id → { fails, openUntil, kind, message, lastOkAt, lastMs, calls, retries }
const H = (id) => { if (!health.has(id)) health.set(id, { fails: 0, openUntil: 0, kind: "ok", message: "", lastOkAt: 0, lastMs: null, calls: 0, retries: 0 }); return health.get(id); };
export function _resetHealth() { health.clear(); }
export const hasKey = (p) => !p.needsKey || Boolean(process.env[p.keyVar]);
export function keyChanged(id) { const h = H(id); h.fails = 0; h.openUntil = 0; h.kind = "ok"; h.message = ""; clearCaches(); }
function breakerState(id) {
  const h = H(id);
  if (h.openUntil > now()) return { open: true, kind: h.kind, message: h.message, until: h.openUntil };
  return { open: false, kind: h.kind === "ok" ? "ok" : h.kind, message: h.message };
}
function recordOk(id, ms) { const h = H(id); h.fails = 0; h.openUntil = 0; h.kind = "ok"; h.message = ""; h.lastOkAt = now(); h.lastMs = ms; }
function recordFail(id, e) {
  const h = H(id), kind = e?.kind ?? "error";
  h.message = String(e?.message ?? "failed").slice(0, 120);
  if (kind === "rate-limited") { h.kind = kind; h.openUntil = now() + (e.retryAfterMs ?? RATE_MS); return; }
  if (kind === "invalid-key") { h.kind = kind; h.openUntil = now() + KEY_MS; return; }
  h.fails++;
  h.kind = kind === "timeout" ? "timeout" : "unavailable";
  if (h.fails >= FAILS_TO_OPEN) h.openUntil = now() + OPEN_MS;
}
// "why isn't this one in the results?" for the chips and Settings
export function providerState(id) {
  const p = BY_ID.get(id), s = settings();
  if (!p) return { state: "unknown" };
  if (!s.providers[id]?.on) return { state: "off" };
  if (!hasKey(p)) return { state: "needs-key" };
  const b = breakerState(id);
  if (b.open) return { state: b.kind === "rate-limited" ? "rate-limited" : b.kind === "invalid-key" ? "invalid-key" : "unavailable", message: b.message, until: b.until };
  return { state: b.kind === "ok" ? "ready" : b.kind, message: b.message };
}
export function providerList() {
  const s = settings();
  return s.order.map((id) => BY_ID.get(id)).map((p) => ({ id: p.id, label: p.label, needsKey: p.needsKey, keyVar: p.keyVar, keySet: hasKey(p) && p.needsKey, on: Boolean(s.providers[p.id]?.on), supports: p.supports, attribution: p.attribution, keyGuide: p.keyGuide, ...providerState(p.id), lastMs: H(p.id).lastMs }));
}

// ---- one call to one provider: its cache, time limit, retries, breaker ---------------------------------------------
const cache = new Map();           // key → { at, result }
export function clearCaches() { cache.clear(); }
const ctxFor = (p, signal) => ({ fetch: deps.fetch, key: p.keyVar ? process.env[p.keyVar] ?? "" : "", base: (id, def) => (deps.base[id] || process.env.DAYSPRING_GIFS_MOCK || def).replace(/\/$/, ""), signal, customerId: customerId(), noHeadless: Boolean(process.env.DAYSPRING_NO_HEADLESS_SEARCH) });
let trendingDisk = null;
function readTrending() { if (trendingDisk) return trendingDisk; try { trendingDisk = existsSync(TRENDING_FILE()) ? JSON.parse(readFileSync(TRENDING_FILE(), "utf8")) : {}; } catch { trendingDisk = {}; } return trendingDisk; }
function writeTrending(key, result) {
  const t = readTrending(); t[key] = { at: now(), result };
  const keys = Object.keys(t); if (keys.length > 60) for (const k of keys.sort((a, b) => t[a].at - t[b].at).slice(0, keys.length - 60)) delete t[k];
  try { mkdirSync(DATA_DIR(), { recursive: true }); writeJSONAtomic(TRENDING_FILE(), t, 0); } catch { /* the memory cache still works */ }
}
export async function callProvider(id, method, args) {
  const p = BY_ID.get(id);
  const key = JSON.stringify([id, method, args.q?.toLowerCase() ?? null, args.rating, args.type, args.cursor ?? null]);
  const c = cache.get(key);
  if (c && now() - c.at < (method === "trending" ? TRENDING_MS : CACHE_MS)) return { ...c.result, cached: true, ms: 0 };
  if (method === "trending" && !args.cursor) { const d = readTrending()[key]; if (d && now() - d.at < TRENDING_MS) { cache.set(key, { at: d.at, result: d.result }); return { ...d.result, cached: "disk", ms: 0 }; } }
  const b = breakerState(id);
  if (b.open) throw new ProviderError(b.kind === "rate-limited" || b.kind === "invalid-key" ? b.kind : "unavailable", b.message || "is resting after several failures", { skipped: true });
  const h = H(id); h.calls++;
  const t0 = now(), limit = timeoutMs();
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), limit);
  const timedOut = new Promise((_, rej) => ctl.signal.addEventListener("abort", () => rej(new ProviderError("timeout", "didn't answer in time")), { once: true }));
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await Promise.race([p[method](args, ctxFor(p, ctl.signal)), timedOut]);
        const result = { items: r.items ?? [], cursor: r.cursor ?? null };
        recordOk(id, now() - t0);
        cache.set(key, { at: now(), result }); while (cache.size > 300) cache.delete(cache.keys().next().value);
        if (method === "trending" && !args.cursor && result.items.length) writeTrending(key, result);
        return { ...result, ms: now() - t0, attempts: attempt + 1 };
      } catch (e) {
        const err = e instanceof ProviderError ? e : new ProviderError(e?.kind ?? "error", String(e?.message ?? e), { retry: true });
        const pause = 200 * 2 ** attempt + Math.floor(Math.random() * 100);
        const retryable = err.retry && err.kind !== "timeout" && attempt < 2 && !ctl.signal.aborted && now() - t0 + pause < limit - 300;
        if (!retryable) throw err;
        h.retries++;
        await Promise.race([deps.sleep(pause), timedOut]);
      }
    }
  } catch (e) {
    // a stale trending list is better than nothing
    if (method === "trending" && !args.cursor) { const d = readTrending()[key]; if (d && now() - d.at < TRENDING_STALE_MS) { recordFail(id, e); return { ...d.result, cached: "stale", ms: now() - t0 }; } }
    recordFail(id, e);
    throw e;
  } finally { clearTimeout(timer); }
}

// ---- merging --------------------------------------------------------------------------------------------------------
const words = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1 && !["gif", "gifs", "a", "an", "the", "of", "sticker", "stickers", "animated"].includes(w));
export function relevance(item, q) {
  const ws = words(q); if (!ws.length) return 0;
  const hay = ` ${words(item.title).join(" ")} ${item.tags.join(" ")} `;
  let hit = 0; for (const w of ws) if (hay.includes(` ${w}`)) hit++;
  return hit / ws.length + (hay.includes(` ${ws.join(" ")} `) ? 0.5 : 0);
}
// the same GIF with the same title and shape on two sites
function lookKey(item) {
  const t = words(item.title).filter((w) => !["giphy", "tenor", "klipy", "imgur", "reaction", "funny"].includes(w));
  if (t.length < 2 || !item.width || !item.height) return null;
  return `look:${t.join(" ")}|${Math.round((item.width / item.height) * 20) / 20}`;
}
// Takes up to n from the queues: rounds of one per provider (in the owner's order), each round's best match first.
export function interleave(queues, order, n, { q = "", rating = "pg-13", type = null, seen = new Set(), looks = new Map(), dropped = { rating: 0, dupes: 0 } } = {}) {
  const out = [];
  while (out.length < n) {
    const round = [];
    for (const id of order) { const qu = queues[id]; if (qu?.items.length) round.push({ it: qu.items.shift(), rank: order.indexOf(id) }); }
    if (!round.length) break;
    round.sort((a, b) => relevance(b.it, q) - relevance(a.it, q) || a.rank - b.rank);
    for (const { it } of round) {
      if (!ratingOk(it, rating)) { dropped.rating++; continue; }
      if (type && it.type !== type) { dropped.type = (dropped.type ?? 0) + 1; continue; }
      const keys = canonicalKeys(it), lk = lookKey(it);
      if (keys.some((k) => seen.has(k)) || (lk && looks.has(lk) && looks.get(lk) !== it.source)) { dropped.dupes++; continue; }
      keys.forEach((k) => seen.add(k)); if (lk && !looks.has(lk)) looks.set(lk, it.source);
      out.push(it);
      if (out.length >= n) { for (const r of round.slice(round.findIndex((x) => x.it === it) + 1)) queues[r.it.source]?.items.unshift(r.it); break; }
    }
  }
  return out;
}

// ---- the item registry (so the screen and tools only ever name GIFs Dayspring has already seen) -----------------------
const known = new Map();
export function remember(it) { if (!it?.id) return; known.delete(it.id); known.set(it.id, it); while (known.size > 4000) known.delete(known.keys().next().value); }
export const item = (id) => { load(); return known.get(String(id ?? "")) ?? null; };

// ---- sessions -------------------------------------------------------------------------------------------------------
const sessions = new Map();
export const session = (sid) => sessions.get(String(sid ?? "")) ?? null;
export function usableProviders({ providers, type, mode } = {}) {
  const s = settings();
  const want = Array.isArray(providers) && providers.length ? providers.filter((id) => BY_ID.has(id)) : null;
  const on = s.order.filter((id) => (want ? want.includes(id) : s.providers[id]?.on));
  const ok = on.filter((id) => { const p = BY_ID.get(id); return hasKey(p) && (mode !== "trending" || p.supports.trending) && (type !== "sticker" || p.supports.stickers); });
  return { on, ok };
}
export function startSession({ mode = "search", q = "", rating, type, providers } = {}) {
  const s = settings();
  const query = String(q ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (mode === "search" && !query) throw new Error("What kind of GIF should I look for?");
  const opts = { mode: mode === "trending" ? "trending" : "search", q: query, rating: cleanRating(rating, s.rating), type: TYPES.includes(type) ? type : s.type ?? "gif" };
  const { on, ok } = usableProviders({ providers, type: opts.type, mode: opts.mode });
  let order = ok;
  let fallback = false;
  // the keyless web search always answers when nothing else can (no keys yet, or every provider switched off)
  if (!order.length && !(Array.isArray(providers) && providers.length && !providers.includes("web"))) { order = ["web"]; fallback = true; }
  const sid = createHash("sha1").update(`${randomUUID()}`).digest("hex").slice(0, 12);
  const ses = {
    sid, ...opts, order, fallback, at: now(), events: [], listeners: new Set(), items: [], queues: {}, seen: new Set(), looks: new Map(), dropped: { rating: 0, dupes: 0 },
    busy: 0, statuses: {}, rescue: !(Array.isArray(providers) && providers.length && !providers.includes("web")),
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    get idle() { return this.busy === 0; },
  };
  const emit = (ev) => { ev.i = ses.events.length; ses.events.push(ev); for (const fn of ses.listeners) { try { fn(ev); } catch { /* a closed stream */ } } };
  ses.emit = emit;
  for (const id of order) ses.queues[id] = { items: [], cursor: undefined, done: false, pending: null };
  // no key for any keyed provider yet: the picker suggests getting a free one
  ses.noKeys = PROVIDERS.filter((p) => p.needsKey).every((p) => !hasKey(p));
  emit({ t: "start", sid, mode: opts.mode, q: opts.q, rating: opts.rating, type: opts.type, fallback, noKeys: ses.noKeys, providers: order.map((id) => ({ id, label: BY_ID.get(id).label, attribution: BY_ID.get(id).attribution })), off: on.filter((id) => !order.includes(id)).map((id) => ({ id, label: BY_ID.get(id).label, ...providerState(id) })) });
  sessions.set(sid, ses);
  while (sessions.size > 12) sessions.delete(sessions.keys().next().value);
  ses.more = () => phase(ses, false);
  ses.ready = phase(ses, true);
  return ses;
}
function out(ses, items) {
  for (const it of items) { remember(it); ses.items.push(it); }
  if (items.length) ses.emit({ t: "items", items: items.map((it, k) => ({ ...it, seq: ses.items.length - items.length + k + 1 })) });
}
const canMore = (ses) => Object.values(ses.queues).some((qu) => qu.items.length || (!qu.done && qu.cursor !== null));
// one batch: fetch what's needed from each provider at once, send the first batch when all have answered (or soon
// after the first), then whatever the late ones bring
function phase(ses, first) {
  ses.busy++;
  return new Promise((done) => {
    const need = first ? Object.keys(ses.queues).filter((id) => ses.queues[id].cursor === undefined && !ses.queues[id].done) : Object.keys(ses.queues).filter((id) => { const qu = ses.queues[id]; return !qu.done && qu.cursor !== null && !qu.pending && qu.items.length < PAGE; });
    const queued = () => Object.values(ses.queues).reduce((a, qu) => a + qu.items.length, 0);
    let sent = false, left = need.length, timer = null;
    const send = (n = PAGE) => { const items = interleave(ses.queues, ses.order, n, { q: ses.q, rating: ses.rating, type: ses.type, seen: ses.seen, looks: ses.looks, dropped: ses.dropped }); out(ses, items); return items.length; };
    const finish = () => {
      clearTimeout(timer);
      if (!sent) { sent = true; send(); }
      // nothing from anyone (no answers, or nothing found): the keyless web search steps in
      if (first && !ses.items.length && ses.rescue && !ses.queues.web) {
        ses.queues.web = { items: [], cursor: undefined, done: false, pending: null };
        ses.order.push("web"); ses.fallback = true;
        ses.emit({ t: "fallback", provider: "web", label: web.label, attribution: web.attribution });
        phase(ses, true).then(() => { ses.busy--; done(ses); });
        return;
      }
      ses.busy--;
      ses.emit({ t: "done", more: canMore(ses), total: ses.items.length, dropped: { ...ses.dropped }, statuses: { ...ses.statuses } });
      done(ses);
    };
    // enough already waiting: send them now; what's fetched now is for next time
    const prefetch = !first && queued() >= PAGE;
    if (prefetch) { sent = true; send(); }
    if (!left) return finish();
    for (const id of need) {
      const qu = ses.queues[id];
      const args = { q: ses.q, rating: ses.rating, type: ses.type, cursor: qu.cursor ?? undefined, limit: PAGE };
      const t0 = now();
      qu.pending = callProvider(id, ses.mode, args).then((r) => {
        qu.items.push(...r.items); qu.cursor = r.cursor ?? null; if (qu.cursor === null) qu.done = true;
        ses.statuses[id] = { state: "ok", count: r.items.length, ms: r.ms ?? now() - t0, cached: r.cached ?? false, attempts: r.attempts ?? 1 };
      }, (e) => {
        qu.done = true;
        ses.statuses[id] = { state: e.kind === "rate-limited" ? "rate-limited" : e.kind === "invalid-key" ? "invalid-key" : e.kind === "timeout" ? "timeout" : "unavailable", message: String(e.message ?? "").slice(0, 120), skipped: Boolean(e.skipped), ms: now() - t0 };
      }).then(() => {
        qu.pending = null; left--;
        ses.emit({ t: "status", provider: id, label: BY_ID.get(id).label, ...ses.statuses[id] });
        // a late answer: its GIFs go out now, mixed with what the others still have waiting
        if (sent && !prefetch && qu.items.length) send(Math.min(PAGE, queued()));
        if (left === 0) return finish();
        if (sent) return;
        // the first to answer starts the short wait for the others
        if (!timer && ses.statuses[id].state === "ok") timer = setTimeout(() => { if (!sent) { sent = true; send(); } }, windowMs());
      });
    }
  });
}
// the first batch (for the AI, voice replies and anything that doesn't stream)
export async function searchOnce(opts) {
  const ses = startSession(opts);
  await ses.ready;
  return ses;
}

// ---- categories and reactions --------------------------------------------------------------------------------------
export const REACTIONS = ["happy", "thumbs up", "facepalm", "lol", "applause", "wow", "sad", "love", "dance", "yes", "no", "thank you", "good morning", "celebrate", "mind blown", "eye roll", "shrug", "hugs", "excited", "sorry", "congratulations", "high five", "cat", "dog", "mondays", "coffee", "sleepy", "hello", "bye", "ok"];
let catCache = null;
export async function categories() {
  if (catCache && now() - catCache.at < 12 * 3600_000) return catCache.list;
  const s = settings(), list = REACTIONS.map((r) => ({ name: r, query: r, source: "reactions" }));
  const seen = new Set(REACTIONS);
  await Promise.all(s.order.map(async (id) => {
    const p = BY_ID.get(id);
    if (!s.providers[id]?.on || !p.supports.categories || !hasKey(p) || breakerState(id).open) return;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs());
      const cats = await p.categories(ctxFor(p, ctl.signal)).finally(() => clearTimeout(t));
      for (const c of cats.slice(0, 40)) { const k = c.name.toLowerCase(); if (!seen.has(k)) { seen.add(k); list.push({ name: c.name, query: c.query || c.name, source: id }); } }
    } catch { /* the reactions are enough */ }
  }));
  catCache = { at: now(), list };
  return list;
}
export function _clearCategories() { catCache = null; }

// ---- testing a key ----------------------------------------------------------------------------------------------------
export async function testProvider(id) {
  const p = BY_ID.get(id);
  if (!p) throw new Error("Unknown provider.");
  if (!hasKey(p)) return { state: "needs-key", text: `${p.label} needs a key first.` };
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs() + 2000);
  const t0 = now();
  try {
    await Promise.race([p.test(ctxFor(p, ctl.signal)), new Promise((_, rej) => ctl.signal.addEventListener("abort", () => rej(new ProviderError("timeout", "didn't answer in time")), { once: true }))]);
    recordOk(id, now() - t0);
    return { state: "ok", ms: now() - t0, text: `${p.label} works.` };
  } catch (e) {
    const kind = e?.kind ?? "error";
    const state = kind === "invalid-key" ? "invalid-key" : kind === "rate-limited" ? "rate-limited" : "unavailable";
    if (state !== "unavailable") recordFail(id, e);
    return { state, ms: now() - t0, text: state === "invalid-key" ? `${p.label} didn't accept that key. Check it was copied in full.` : state === "rate-limited" ? `${p.label} says too many searches for now. The key is fine; try again in a while.` : `${p.label} couldn't be reached just now (${String(e?.message ?? "no answer").slice(0, 80)}).` };
  } finally { clearTimeout(t); }
}

// ---- favourites and recents -----------------------------------------------------------------------------------------
const slim = (it) => { const { seq, ...rest } = it; return rest; };
export const favorites = () => load().favorites.map((x) => ({ ...x }));
export const recents = () => load().recents.map((x) => ({ ...x }));
export const isFavorite = (id) => load().favorites.some((x) => x.id === id);
export function setFavorite(id, on = true) {
  const it = item(id); const s = load();
  s.favorites = s.favorites.filter((x) => x.id !== id);
  if (on) { if (!it) throw new Error("I don't know that GIF any more. Search for it again."); s.favorites.unshift(slim(it)); s.favorites = s.favorites.slice(0, 300); }
  persist(); return { favorite: on, count: s.favorites.length };
}
export function addRecent(id) {
  const it = item(id); if (!it) return;
  const s = load(); s.recents = [slim(it), ...s.recents.filter((x) => x.id !== id)].slice(0, 60); persist();
}
export function clearList(which) { const s = load(); if (which === "favorites") s.favorites = []; else if (which === "recents") s.recents = []; else throw new Error("favorites or recents"); persist(); return { cleared: which }; }

// ---- files: download, save --------------------------------------------------------------------------------------------
export function urlFor(it, format = settings().format) {
  if (!it) return null;
  if (format === "mp4") return it.mp4 ?? it.gif ?? it.webp;
  if (format === "webp") return it.webp ?? it.gif ?? it.mp4;
  return it.gif ?? it.webp ?? it.mp4;
}
// a local copy (data/gifs/cache) for attaching to an email, copying as a file or saving
export async function file(id, { format = "gif" } = {}) {
  const it = item(id);
  if (!it) throw Object.assign(new Error("I don't know that GIF. Search for it first."), { status: 404 });
  const url = urlFor(it, format);
  const f = await media.cacheFile(url, { title: it.title, maxMB: settings().cacheMB });
  return { ...f, id: it.id, title: it.title, source: it.source, url };
}
// Pictures\Dayspring GIFs (or the folder chosen in Settings) when Dayspring may change files there; otherwise data\gifs
export async function whereToSave() {
  const s = settings();
  const want = s.saveDir || join(PICTURES_DIR(), "Dayspring GIFs");
  try {
    const perm = await deps.permissions();
    const c = perm.check("write", want);
    if (c.ok && !perm.isSystemPath?.(want)) return { folder: want, where: s.saveDir ? "custom" : "pictures" };
    return { folder: DATA_DIR(), where: "data", why: c.text ?? null };
  } catch { return { folder: DATA_DIR(), where: "data" }; }
}
export async function save(id, { format } = {}) {
  const it = item(id);
  if (!it) throw Object.assign(new Error("I don't know that GIF. Search for it first."), { status: 404 });
  const fmt = FORMATS.includes(format) ? format : "gif";
  const url = urlFor(it, fmt);
  const m = await media.fetchMedia(url);
  const dest = await whereToSave();
  mkdirSync(dest.folder, { recursive: true });
  const name = media.fileName(it.title, url, m.type);
  const path = resolve(dest.folder, name);
  if (!path.startsWith(resolve(dest.folder))) throw new Error("That file name isn't allowed.");
  writeFileSync(path, m.buf);
  const note = { title: it.title, source: it.source, sourcePage: it.page ?? null, mediaUrl: url, rating: it.rating, width: it.width, height: it.height, savedAt: new Date(now()).toISOString() };
  try { writeFileSync(path.replace(/\.[a-z0-9]+$/i, ".json"), JSON.stringify(note, null, 2)); } catch { /* the GIF is what matters */ }
  try { const activity = await import("../activity.mjs"); const f = activity.fingerprint(path); activity.log("file.create", { path, via: "gifs", tool: "gif_save", sizeBefore: null, sizeAfter: f?.size ?? m.buf.length, sha256Before: null, sha256After: f?.sha256 ?? null, source: url, result: "ok" }); } catch { /* logging never stops a save */ }
  addRecent(id);
  return { path, name, folder: dest.folder, where: dest.where, bytes: m.buf.length, type: m.type };
}
export { RATINGS };
