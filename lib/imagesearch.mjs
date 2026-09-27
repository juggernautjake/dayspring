// Image search on the web, for the Dayspring screen ("show me pictures of golden retrievers").
//   search(query, { filters, page, perPage }) → { query, filters, results: [{ thumbUrl, fullUrl, width, height, title,
//                                                 sourcePage, sourceDomain }], total, more, source, tried }
//   fetchImage(url)          → { buf, type }  one image, fetched safely (the screen's proxy and "save" both use it)
//   save(item, { query })    → { path, folder, where }  the full picture (or its thumbnail) with a .json note of where it came from
//   prefs() / setPrefs()     SafeSearch: "strict" | "moderate" (the default) | "off"
//
// Where the pictures come from, in order (the next one is tried when one fails or finds nothing):
//   1. a search API, when its key is set in .env (optional): BRAVE_SEARCH_API_KEY, GOOGLE_CSE_KEY + GOOGLE_CSE_ID,
//      BING_IMAGE_SEARCH_KEY. Keys are read from the environment only and never logged or sent anywhere else.
//   2. DuckDuckGo images (its vqd token, then its JSON endpoint), no key
//   3. Bing images' plain page, no key
//   4. Bing images in the HEADLESS search browser (browser.searchPage), only if both plain fetches were refused
// Filters: size (small|medium|large|wallpaper), type (photo|clipart|gif|transparent|line), color (color|mono|red|…),
// layout (square|wide|tall), recent (day|week|month|year), site (a domain: "from wikipedia" → wikipedia.org).
// Every address is checked: http(s) only; the images themselves are only fetched after a DNS check that refuses this
// computer, the home network and other private addresses (and again after every redirect), at most 8 MB, image/* only.
// The name is looked up ONCE per hop and the connection goes to exactly the address that was checked (the name is kept
// for HTTPS and the Host header), then the socket's peer is checked again, so a site can't pass the check with a public
// address and then answer the real connection's lookup with a private one (DNS rebinding).
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { safeUrl } from "./web.mjs";
import { writeJSONAtomic } from "./atomic.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
export const MAX_BYTES = 8 * 1024 * 1024;
export const IMAGES_DIR = () => process.env.DAYSPRING_IMAGES_DIR || join(ROOT, "data", "images");
export const PICTURES_DIR = () => process.env.DAYSPRING_PICTURES_DIR || join(homedir(), "Pictures");
const PREFS_FILE = () => process.env.DAYSPRING_IMAGE_PREFS_FILE || join(ROOT, "data", "image-search.json");
export const SAFE = ["strict", "moderate", "off"];
export const KEY_VARS = ["BRAVE_SEARCH_API_KEY", "GOOGLE_CSE_KEY", "GOOGLE_CSE_ID", "BING_IMAGE_SEARCH_KEY"];

// tests swap these: fetch, DNS, the headless browser, and where each search lives (a local mock server)
let deps = {
  fetch: (...a) => fetch(...a),
  lookup: (h) => dnsLookup(h, { all: true }),
  searchPage: async (name) => (await import("./browser.mjs")).searchPage(name),
  permissions: async () => import("./permissions.mjs"),
  describe: undefined,
  connect: (...a) => pinnedFetch(...a),        // (href, { headers, signal }, pin) → a fetch Response, from pin.address only
  isPrivate: (ip) => privateIp(ip),
  base: {},            // { ddg, bing, brave, google, bingApi } → a replacement origin (tests only)
};
export function setDeps(d) { deps = { ...deps, ...d, base: { ...deps.base, ...(d?.base ?? {}) } }; }
const BASE = { ddg: "https://duckduckgo.com", bing: "https://www.bing.com", brave: "https://api.search.brave.com", google: "https://www.googleapis.com", bingApi: "https://api.bing.microsoft.com" };
const base = (k) => (deps.base[k] || (process.env.DAYSPRING_IMAGESEARCH_MOCK ? process.env.DAYSPRING_IMAGESEARCH_MOCK : "") || BASE[k]).replace(/\/$/, "");

// ---- settings ---------------------------------------------------------------------------------------------------------
let prefCache = null;
export function prefs() {
  if (prefCache) return { ...prefCache };
  let p = {};
  try { if (existsSync(PREFS_FILE())) p = JSON.parse(readFileSync(PREFS_FILE(), "utf8")); } catch { p = {}; }
  prefCache = { safeSearch: SAFE.includes(p.safeSearch) ? p.safeSearch : "moderate" };
  return { ...prefCache };
}
export function setPrefs(patch = {}) {
  const cur = prefs();
  if (patch.safeSearch !== undefined) { if (!SAFE.includes(patch.safeSearch)) throw new Error("SafeSearch must be strict, moderate or off."); cur.safeSearch = patch.safeSearch; }
  mkdirSync(dirname(PREFS_FILE()), { recursive: true });
  writeJSONAtomic(PREFS_FILE(), cur, 2);
  prefCache = cur; cache.clear();
  return { ...cur };
}
// which optional keys are set (never their values)
export const keysSet = () => ({ brave: Boolean(process.env.BRAVE_SEARCH_API_KEY), google: Boolean(process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_ID), bing: Boolean(process.env.BING_IMAGE_SEARCH_KEY) });

// ---- addresses --------------------------------------------------------------------------------------------------------
export function privateIp(ip) {
  const v = String(ip).replace(/^\[|\]$/g, "").toLowerCase();
  const m4 = /^(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (m4 && isIP(m4[1]) === 4) {
    const [a, b] = m4[1].split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0) || a >= 224;
  }
  if (isIP(v) !== 6) return true;                         // not an address at all: refuse
  if (v.startsWith("::ffff:")) return true;               // other mapped forms (hex): refuse rather than parse
  return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v) || v.startsWith("64:ff9b:") || v.startsWith("2001:db8:");
}
const LOCAL_NAME = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home|.*\.corp|.*\.intranet)$/i;
// quick check without DNS (for the addresses in search results)
function plainPublic(u) {
  try {
    const url = new URL(safeUrl(u));
    const h = url.hostname.replace(/^\[|\]$/g, "");
    if (!h || LOCAL_NAME.test(h) || !h.includes(".") && !isIP(h)) return null;
    if (isIP(h) && privateIp(h)) return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
// the full check before anything is fetched: http(s), a public name, and every address it points at is public.
// → { href, host, address, family }: the address to connect to (the first one, already checked)
export async function resolvePublic(u) {
  let href;
  try { href = safeUrl(u); } catch (e) { throw Object.assign(new Error(e.message), { status: 400 }); }
  const url = new URL(href);
  if (url.username || url.password) throw Object.assign(new Error("Addresses with a password in them aren't fetched."), { status: 400 });
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || LOCAL_NAME.test(host)) throw Object.assign(new Error("That address is on this computer or network, so I won't fetch it."), { status: 403 });
  const addrs = isIP(host) ? [{ address: host }] : await deps.lookup(host).catch(() => []);
  if (!addrs.length) throw Object.assign(new Error("I couldn't find that site."), { status: 502 });
  if (addrs.some((a) => deps.isPrivate(a.address))) throw Object.assign(new Error("That address is on this computer or network, so I won't fetch it."), { status: 403 });
  const address = String(addrs[0].address).replace(/^\[|\]$/g, "");
  return { href, host, address, family: isIP(address) || 4 };
}
export async function guard(u) { return (await resolvePublic(u)).href; }

// One GET to exactly pin.address (no second DNS lookup), with the site's name kept for TLS (SNI and the certificate
// check) and the Host header. The socket's peer is checked once connected and again on the answer; anything else is
// refused. Answers like fetch(): a Response whose body streams.
const bare = (ip) => String(ip ?? "").replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "").toLowerCase();
export function pinnedFetch(href, { headers = {}, signal } = {}, pin) {
  return new Promise((resolve, reject) => {
    const url = new URL(href);
    if (!pin?.address) return reject(Object.assign(new Error("No checked address to connect to."), { status: 500 }));
    const name = url.hostname.replace(/^\[|\]$/g, "");
    const lookup = (_h, opts, cb) => { if (typeof opts === "function") { cb = opts; opts = {}; } if (opts?.all) cb(null, [{ address: pin.address, family: pin.family }]); else cb(null, pin.address, pin.family); };
    const peerOk = (ra) => Boolean(ra) && !deps.isPrivate(ra) && bare(ra) === bare(pin.address);
    const refused = () => Object.assign(new Error("That address is on this computer or network, so I won't fetch it."), { status: 403 });
    const req = (url.protocol === "https:" ? https : http).request(url, {
      method: "GET", agent: false, lookup, signal,
      headers: { ...headers, host: url.host },
      ...(url.protocol === "https:" && !isIP(name) ? { servername: name } : {}),
    });
    req.on("socket", (sock) => {
      const check = () => { if (!peerOk(sock.remoteAddress)) req.destroy(refused()); };
      if (sock.connecting) sock.once("connect", check); else check();
    });
    req.on("response", (res) => {
      if (!peerOk(res.socket?.remoteAddress)) { res.destroy(); return reject(refused()); }
      const h = new Headers();
      for (const [k, v] of Object.entries(res.headers)) { if (Array.isArray(v)) for (const x of v) h.append(k, x); else if (v != null) h.set(k, String(v)); }
      const noBody = [204, 205, 304].includes(res.statusCode) || res.statusCode < 200;
      if (noBody) res.resume();
      try { resolve(new Response(noBody ? null : Readable.toWeb(res), { status: Math.max(200, res.statusCode), headers: h })); } catch (e) { res.destroy(); reject(e); }
    });
    req.on("error", reject);
    req.end();
  });
}
const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

// ---- filters ----------------------------------------------------------------------------------------------------------
const COLORS = ["color", "mono", "red", "orange", "yellow", "green", "blue", "purple", "pink", "brown", "black", "gray", "teal", "white"];
export function cleanFilters(f = {}) {
  const out = {};
  const one = (v, list) => { const s = String(v ?? "").toLowerCase().trim(); return list.includes(s) ? s : undefined; };
  out.size = one(f.size === "big" || f.size === "bigger" || f.size === "huge" ? "large" : f.size, ["small", "medium", "large", "wallpaper"]);
  out.type = one(f.type === "clip art" ? "clipart" : f.type === "animated" ? "gif" : f.type === "png" ? "transparent" : f.type === "drawing" ? "line" : f.type, ["photo", "clipart", "gif", "transparent", "line"]);
  out.color = one(f.color === "grey" ? "gray" : f.color === "black and white" || f.color === "bw" ? "mono" : f.color, COLORS);
  out.layout = one(f.layout === "landscape" ? "wide" : f.layout === "portrait" ? "tall" : f.layout, ["square", "wide", "tall"]);
  out.recent = one(f.recent === true ? "month" : f.recent === "today" ? "day" : f.recent, ["day", "week", "month", "year"]);
  const site = String(f.site ?? "").toLowerCase().trim().replace(/^site:/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(site)) out.site = site;
  else if (/^[a-z0-9-]{2,40}$/.test(site)) out.site = `${site}.${site === "wikipedia" || site === "wikimedia" ? "org" : "com"}`;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}
const withSite = (q, f) => (f.site ? `${q} site:${f.site}` : q);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ---- the sources ------------------------------------------------------------------------------------------------------
const decode = (s) => String(s ?? "").replace(/&(#\d+|#x[\da-f]+|amp|lt|gt|quot|apos|nbsp|#39);/gi, (m, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" })[e.toLowerCase()] ?? (/^#x/i.test(e) ? String.fromCodePoint(parseInt(e.slice(2), 16)) : /^#\d/.test(e) ? String.fromCodePoint(Number(e.slice(1))) : m));
const text = (s) => decode(String(s ?? "").replace(/<[^>]*>/g, " ")).replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
function item({ thumb, full, width, height, title, page }) {
  const thumbUrl = plainPublic(thumb), fullUrl = plainPublic(full);
  if (!thumbUrl && !fullUrl) return null;
  const sourcePage = plainPublic(page);
  return { thumbUrl: thumbUrl ?? fullUrl, fullUrl: fullUrl ?? thumbUrl, width: Number(width) || null, height: Number(height) || null, title: text(title) || "Untitled", sourcePage, sourceDomain: domainOf(sourcePage ?? fullUrl ?? thumbUrl) };
}
async function getJSON(url, headers = {}) {
  const r = await deps.fetch(url, { headers: { "user-agent": UA, accept: "application/json", ...headers }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`answered ${r.status}`);
  return r.json();
}

// DuckDuckGo: the search page carries a vqd token; i.js answers JSON with it
export function parseDdg(json) {
  return (json?.results ?? []).map((x) => item({ thumb: x.thumbnail, full: x.image, width: x.width, height: x.height, title: x.title, page: x.url })).filter(Boolean);
}
export function ddgFilterParam(f) {
  const map = { size: { small: "Small", medium: "Medium", large: "Large", wallpaper: "Wallpaper" }, layout: { square: "Square", wide: "Wide", tall: "Tall" }, recent: { day: "Day", week: "Week", month: "Month", year: "Year" } };
  const color = f.color ? (f.color === "mono" ? "Monochrome" : f.color === "color" ? "color" : cap(f.color)) : "";
  // six places: time, size, color, type, layout, license; an unused one stays empty (",,,,," = no filters)
  const put = (k, v) => (v ? `${k}:${v}` : "");
  return [put("time", map.recent[f.recent]), put("size", map.size[f.size]), put("color", color), put("type", f.type), put("layout", map.layout[f.layout]), ""].join(",");
}
async function ddg(q, f, { offset = 0, safe }) {
  const kp = { strict: "1", moderate: "-1", off: "-2" }[safe];
  const pageUrl = `${base("ddg")}/?q=${encodeURIComponent(q)}&iax=images&ia=images&kp=${kp}`;
  const r = await deps.fetch(pageUrl, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`answered ${r.status}`);
  const html = await r.text();
  const vqd = (/vqd\s*[=:]\s*\\?["']?(\d-[\w-]+)/.exec(html) ?? [])[1];
  if (!vqd) throw new Error(/anomaly|challenge/i.test(html) ? "asked for a check" : "no search token");
  const p = safe === "off" ? "-1" : "1";
  const json = await getJSON(`${base("ddg")}/i.js?l=us-en&o=json&q=${encodeURIComponent(q)}&vqd=${encodeURIComponent(vqd)}&f=${encodeURIComponent(ddgFilterParam(f))}&p=${p}${offset ? `&s=${offset}` : ""}`, { accept: "application/json, text/javascript, */*; q=0.01", "accept-language": "en-US,en;q=0.9", referer: pageUrl, "x-requested-with": "XMLHttpRequest", "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin" });
  return { results: parseDdg(json), next: json?.next ? offset + (json.results?.length || 100) : null };
}

// Bing images' plain page: each result is <a class="iusc" m="{…murl, turl, purl, t…}">
export function parseBingHtml(html) {
  const out = [];
  const re = /<a\b[^>]*\bclass="[^"]*\biusc\b[^"]*"[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const raw = (/\bm="([^"]+)"/.exec(tag) ?? /\bm='([^']+)'/.exec(tag) ?? [])[1];
    if (!raw) continue;
    let j; try { j = JSON.parse(decode(raw)); } catch { continue; }
    // the size is in the text that follows ("1920 x 1080 · jpeg"), when Bing shows it
    const after = html.slice(m.index + tag.length, m.index + tag.length + 3000).replace(/<a\b[^>]*\bclass="[^"]*\biusc\b[\s\S]*$/, "");   // up to the next result
    const dims = /(\d{2,5})\s*[x×]\s*(\d{2,5})/.exec(text(after));
    const it = item({ thumb: j.turl, full: j.murl, title: j.t ?? j.desc, page: j.purl, width: dims?.[1], height: dims?.[2] });
    if (it) out.push(it);
  }
  return out;
}
export function bingQft(f) {
  const q = [];
  if (f.size) q.push(`filterui:imagesize-${f.size}`);
  if (f.type) q.push({ photo: "filterui:photo-photo", clipart: "filterui:photo-clipart", gif: "filterui:photo-animatedgif", transparent: "filterui:photo-transparent", line: "filterui:photo-linedrawing" }[f.type]);
  if (f.color) q.push(f.color === "color" ? "filterui:color2-color" : f.color === "mono" ? "filterui:color2-bw" : `filterui:color2-FGcls_${f.color.toUpperCase()}`);
  if (f.layout) q.push(`filterui:aspect-${f.layout}`);
  if (f.recent) q.push(`filterui:age-lt${{ day: 1440, week: 10080, month: 43200, year: 525600 }[f.recent]}`);
  return q.map((x) => `+${x}`).join("");
}
const bingUrl = (q, f, offset, safe) => `${base("bing")}/images/search?q=${encodeURIComponent(q)}&form=HDRSC2&first=${offset + 1}&count=35&adlt=${safe}&setlang=en-US&cc=US${f && bingQft(f) ? `&qft=${encodeURIComponent(bingQft(f))}` : ""}`;
async function bingFetch(q, f, { offset = 0, safe }) {
  const r = await deps.fetch(bingUrl(q, f, offset, safe), { headers: { "user-agent": UA, accept: "text/html", "accept-language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`answered ${r.status}`);
  const results = parseBingHtml(await r.text());
  return { results, next: results.length ? offset + results.length : null };
}
async function bingHeadless(q, f, { offset = 0, safe }) {
  if (process.env.DAYSPRING_NO_HEADLESS_SEARCH || !deps.searchPage) throw new Error("the search browser is off");
  const p = await deps.searchPage("images");
  await p.goto(bingUrl(q, f, offset, safe), { waitUntil: "domcontentloaded", timeout: 20_000 });
  await p.waitForSelector("a.iusc", { timeout: 8_000 }).catch(() => {});
  const results = parseBingHtml(await p.content());
  return { results, next: results.length ? offset + results.length : null };
}

// the optional keyed APIs
export function parseBrave(json) {
  return (json?.results ?? []).map((x) => item({ thumb: x.thumbnail?.src, full: x.properties?.url ?? x.url, width: x.properties?.width, height: x.properties?.height, title: x.title, page: x.url })).filter(Boolean);
}
async function brave(q, f, { offset = 0, safe }) {
  const json = await getJSON(`${base("brave")}/res/v1/images/search?q=${encodeURIComponent(q)}&count=50&safesearch=${safe === "off" ? "off" : "strict"}`, { "x-subscription-token": process.env.BRAVE_SEARCH_API_KEY });
  const results = parseBrave(json).slice(offset);
  return { results, next: null };
}
export function parseGoogle(json) {
  return (json?.items ?? []).map((x) => item({ thumb: x.image?.thumbnailLink, full: x.link, width: x.image?.width, height: x.image?.height, title: x.title, page: x.image?.contextLink })).filter(Boolean);
}
async function google(q, f, { offset = 0, safe }) {
  const p = new URLSearchParams({ key: process.env.GOOGLE_CSE_KEY, cx: process.env.GOOGLE_CSE_ID, q, searchType: "image", num: "10", start: String(offset + 1), safe: safe === "off" ? "off" : "active" });
  if (f.size) p.set("imgSize", f.size === "wallpaper" ? "huge" : f.size);
  if (f.type) p.set("imgType", { photo: "photo", clipart: "clipart", gif: "animated", line: "lineart" }[f.type] ?? "");
  if (f.type === "transparent") p.set("imgColorType", "trans");
  else if (f.color === "mono") p.set("imgColorType", "gray");
  else if (f.color && f.color !== "color") p.set("imgDominantColor", f.color);
  if (f.recent) p.set("dateRestrict", { day: "d1", week: "w1", month: "m1", year: "y1" }[f.recent]);
  for (const [k, v] of [...p]) if (!v) p.delete(k);
  const json = await getJSON(`${base("google")}/customsearch/v1?${p}`);
  const results = parseGoogle(json);
  return { results, next: results.length && offset + 10 < 100 ? offset + 10 : null };
}
export function parseBingApi(json) {
  return (json?.value ?? []).map((x) => item({ thumb: x.thumbnailUrl, full: x.contentUrl, width: x.width, height: x.height, title: x.name, page: x.hostPageUrl })).filter(Boolean);
}
async function bingApi(q, f, { offset = 0, safe }) {
  const p = new URLSearchParams({ q, count: "50", offset: String(offset), safeSearch: cap(safe) });
  if (f.size) p.set("size", cap(f.size));
  if (f.type) p.set("imageType", { photo: "Photo", clipart: "Clipart", gif: "AnimatedGif", transparent: "Transparent", line: "Line" }[f.type]);
  if (f.color) p.set("color", f.color === "mono" ? "Monochrome" : f.color === "color" ? "ColorOnly" : cap(f.color));
  if (f.layout) p.set("aspect", cap(f.layout));
  if (f.recent) p.set("freshness", f.recent === "year" ? "Month" : cap(f.recent));
  const json = await getJSON(`${base("bingApi")}/v7.0/images/search?${p}`, { "ocp-apim-subscription-key": process.env.BING_IMAGE_SEARCH_KEY });
  const results = parseBingApi(json);
  return { results, next: results.length ? offset + results.length : null };
}

const ENGINES = { brave, google, bingApi, ddg, bing: bingFetch, bingHeadless };
export const _engines = ENGINES;   // diagnostics: one source on its own
// the order they're tried in: keyed APIs (only with their key), then the keyless ones, the headless browser last
export function order() {
  const k = keysSet();
  return [...(k.brave ? ["brave"] : []), ...(k.google ? ["google"] : []), ...(k.bing ? ["bingApi"] : []), "ddg", "bing", "bingHeadless"];
}

// ---- search, with a short cache ----------------------------------------------------------------------------------------
const TTL = 10 * 60_000;
const cache = new Map();         // key → { at, pool, source, next, tried }
export function _clearCache() { cache.clear(); }
export async function search(query, { filters = {}, page = 0, perPage = 12 } = {}) {
  const q = String(query ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!q) throw new Error("What should I look for pictures of?");
  const f = cleanFilters(filters), safe = prefs().safeSearch;
  const key = JSON.stringify([q.toLowerCase(), f, safe]);
  let e = cache.get(key);
  if (e && Date.now() - e.at > TTL) { cache.delete(key); e = null; }
  if (!e) {
    const tried = [];
    let got = null;
    for (const name of order()) {
      try {
        const r = await ENGINES[name](withSite(q, f), f, { offset: 0, safe });
        tried.push({ source: name, ok: true, count: r.results.length });
        if (r.results.length) { got = { ...r, source: name }; break; }
      } catch (err) { tried.push({ source: name, ok: false, error: String(err?.message ?? err).slice(0, 120) }); }
    }
    e = { at: Date.now(), pool: dedupe(got?.results ?? []), source: got?.source ?? "none", next: got?.next ?? null, tried };
    if (e.pool.length) { cache.set(key, e); while (cache.size > 40) cache.delete(cache.keys().next().value); }
  }
  // the next page beyond what the first answer held: ask the same source for more
  const want = (page + 1) * perPage;
  if (e.pool.length < want && e.next != null && e.source !== "none") {
    try { const r = await ENGINES[e.source](withSite(q, f), f, { offset: e.next, safe }); e.pool = dedupe([...e.pool, ...r.results]); e.next = r.results.length ? r.next : null; } catch { e.next = null; }
  }
  const start = page * perPage;
  return { query: q, filters: f, safeSearch: safe, results: e.pool.slice(start, start + perPage), offset: start, total: e.pool.length, more: e.pool.length > start + perPage || e.next != null, source: e.source, tried: e.tried };
}
function dedupe(list) { const seen = new Set(); return list.filter((x) => { const k = x.fullUrl; if (seen.has(k)) return false; seen.add(k); return true; }); }

// ---- fetching one image safely (the proxy and saving) ------------------------------------------------------------------
// the first bytes say what a file really is
export function sniff(buf) {
  const b = buf.subarray(0, 16), s = (i, str) => b.toString("latin1", i, i + str.length) === str;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (s(0, "\x89PNG")) return "image/png";
  if (s(0, "GIF8")) return "image/gif";
  if (s(0, "RIFF") && s(8, "WEBP")) return "image/webp";
  if (s(4, "ftypavif") || s(4, "ftypavis")) return "image/avif";
  if (s(0, "BM")) return "image/bmp";
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return "image/x-icon";
  return null;
}
const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp", "image/avif": ".avif", "image/bmp": ".bmp", "image/x-icon": ".ico" };
const err = (msg, status) => Object.assign(new Error(msg), { status });
const imgCache = new Map();      // url → { at, buf, type }  (the thumbnails on screen, for a few minutes)
let imgBytes = 0;
export async function fetchImage(u, { timeoutMs = 10_000, maxBytes = MAX_BYTES, maxRedirects = 4 } = {}) {
  const hit = imgCache.get(u);
  if (hit && Date.now() - hit.at < TTL) return hit;
  let url = u;
  const deadline = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; ; hop++) {
    const pin = await resolvePublic(url);                           // again after every redirect
    const href = pin.href;
    let r;
    try { r = await deps.connect(href, { headers: { "user-agent": UA, accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8" }, redirect: "manual", signal: deadline }, pin); }
    catch (e) { if (e?.status === 403) throw e; throw err(/abort|timeout/i.test(String(e?.name) + String(e?.message)) ? "The picture took too long to load." : "I couldn't reach that picture.", /abort|timeout/i.test(String(e?.name) + String(e?.message)) ? 504 : 502); }
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      try { await r.body?.cancel(); } catch { /* fine */ }
      if (!loc || hop >= maxRedirects) throw err("That picture's address kept moving.", 502);
      url = new URL(loc, href).href;
      continue;
    }
    if (!r.ok) { try { await r.body?.cancel(); } catch { /* fine */ } throw err(`The picture's site answered ${r.status}.`, 502); }
    const type = String(r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!/^image\//.test(type) || /svg/.test(type)) { try { await r.body?.cancel(); } catch { /* fine */ } throw err("That address isn't a picture.", 415); }
    const len = Number(r.headers.get("content-length"));
    if (len > maxBytes) { try { await r.body?.cancel(); } catch { /* fine */ } throw err("That picture is too big.", 413); }
    const chunks = []; let size = 0;
    const reader = r.body?.getReader?.();
    if (!reader) { const b = Buffer.from(await r.arrayBuffer()); if (b.length > maxBytes) throw err("That picture is too big.", 413); chunks.push(b); size = b.length; }
    else {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > maxBytes) { try { await reader.cancel(); } catch { /* fine */ } throw err("That picture is too big.", 413); }
          chunks.push(Buffer.from(value));
        }
      } catch (e) { if (e.status) throw e; throw err(/abort|timeout/i.test(String(e?.name) + String(e?.message)) ? "The picture took too long to load." : "The picture stopped loading.", 504); }
    }
    const buf = Buffer.concat(chunks, size);
    const real = sniff(buf);
    if (!real) throw err("That address isn't a picture I can show.", 415);
    const out = { at: Date.now(), buf, type: real };
    if (buf.length <= 600_000) {                                  // thumbnails: kept briefly, 30 MB at most
      imgCache.set(u, out); imgBytes += buf.length;
      for (const [k, v] of imgCache) { if (imgBytes <= 30 * 1024 * 1024 && Date.now() - v.at < TTL) break; imgCache.delete(k); imgBytes -= v.buf.length; }
    }
    return out;
  }
}

// ---- saving ------------------------------------------------------------------------------------------------------------
// The owner's Pictures folder (Pictures\Dayspring) when Dayspring may change files there (Settings → Permissions);
// otherwise Dayspring's own data\images. Asking to save is the owner's say-so, so no second "are you sure".
export async function whereToSave() {
  const pics = join(PICTURES_DIR(), "Dayspring");
  try {
    const perm = await deps.permissions();
    const c = perm.check("write", pics);
    if (c.ok && !perm.isSystemPath?.(pics)) return { folder: pics, where: "pictures" };
    return { folder: IMAGES_DIR(), where: "data", why: c.text ?? null };
  } catch { return { folder: IMAGES_DIR(), where: "data" }; }
}
const slug = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "image";
export async function save(it, { query = "" } = {}) {
  if (!it?.fullUrl && !it?.thumbUrl) throw new Error("There's no picture to save.");
  let img = null, used = null, firstErr = null;
  for (const u of [it.fullUrl, it.thumbUrl].filter(Boolean)) {
    try { img = await fetchImage(u, { timeoutMs: 15_000 }); used = u; break; } catch (e) { firstErr ??= e; }
  }
  if (!img) throw new Error(`I couldn't download that picture (${firstErr?.message ?? "no address"}).`);
  const dest = await whereToSave();
  mkdirSync(dest.folder, { recursive: true });
  const name = `${slug(it.title)}-${createHash("sha1").update(used).digest("hex").slice(0, 8)}${EXT[img.type] ?? ".jpg"}`;
  const path = resolve(dest.folder, name);
  if (!path.startsWith(resolve(dest.folder))) throw new Error("That file name isn't allowed.");
  writeFileSync(path, img.buf);
  const note = { title: it.title ?? null, sourcePage: it.sourcePage ?? null, imageUrl: used, sourceDomain: it.sourceDomain ?? null, query: query || null, width: it.width ?? null, height: it.height ?? null, savedAt: new Date().toISOString(), thumbnailOnly: used !== it.fullUrl };
  writeFileSync(path.replace(/\.[a-z]+$/, ".json"), JSON.stringify(note, null, 2));
  // every file Dayspring writes goes in the activity log (lib/activity.mjs)
  try { const activity = await import("./activity.mjs"); const f = activity.fingerprint(path); activity.log("file.create", { path, via: "images", tool: "image_save", sizeBefore: null, sizeAfter: f?.size ?? null, sha256Before: null, sha256After: f?.sha256 ?? null, source: used, result: "ok" }); } catch { /* logging never stops a save */ }
  return { path, name, folder: dest.folder, where: dest.where, bytes: img.buf.length, thumbnailOnly: note.thumbnailOnly };
}

// ---- looking at a picture (for the AI) ---------------------------------------------------------------------------------
// lib/vision/describe.mjs (OCR + AI vision), when it's there: describeWebImage describes a web picture and never says
// who anyone in it is. describer() → (buf, { detail, question, title }) → { text } | string, or null without it.
let found;              // undefined: not looked for yet · null: not there · a function
export async function describer() {
  if (deps.describe !== undefined) return deps.describe;
  if (found !== undefined) return found;
  try {
    const m = await import("./vision/describe.mjs");
    // ai: false = only what this computer can tell (text in the picture, colours), for a model that looks itself
    // always describeWebImage: a web picture is described, never identified
    found = typeof m.describeWebImage === "function"
      ? (buf, o = {}) => m.describeWebImage({ buffer: buf, title: o.title ?? "", detail: o.detail ?? "brief", question: o.question ?? "", ...(o.ai === false ? { ai: false } : {}) })
      : null;
  } catch { found = null; }
  return found;
}
// without waiting: is there a describer (as far as is known yet)?
export const hasDescriber = () => Boolean(deps.describe !== undefined ? deps.describe : found);
