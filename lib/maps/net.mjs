// Every request Maps makes to a map service goes through here, so the free services' rules are kept in one place:
//   - an identifying User-Agent (OpenStreetMap's Nominatim, tile and FOSSGIS routing policies ask for one)
//   - at most one request a second to each free service (Nominatim's and FOSSGIS's limit; Photon is asked the same)
//   - answers are cached (the same search twice asks once), with a timeout on everything
// Tests point every service at a mock server: DAYSPRING_MAPS_MOCK=http://127.0.0.1:<port> turns
// "https://nominatim.openstreetmap.org/search?…" into "<mock>/nominatim/search?…" (and so on for each service below),
// and no waiting between requests. Nothing here ever logs or returns a key.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let VERSION = "1";
try { VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version ?? "1"; } catch { /* fine */ }
export const USER_AGENT = `Dayspring/${VERSION} (personal voice assistant; https://github.com/juggernautjake/dayspring)`;

// service id → its real address, and the gap between two requests to it (ms)
export const SERVICES = {
  nominatim: { base: "https://nominatim.openstreetmap.org", gap: 1100 },
  photon: { base: "https://photon.komoot.io", gap: 1000 },
  osrm: { base: "https://routing.openstreetmap.de", gap: 1100 },
  ors: { base: "https://api.openrouteservice.org", gap: 1600 },         // free plan: 40 directions a minute
  tiles: { base: "https://tile.openstreetmap.org", gap: 0 },
  "google-places": { base: "https://places.googleapis.com", gap: 0 },
  "google-routes": { base: "https://routes.googleapis.com", gap: 0 },
};
const mock = () => String(process.env.DAYSPRING_MAPS_MOCK ?? "").replace(/\/$/, "");
export const base = (id) => (mock() ? `${mock()}/${id}` : SERVICES[id]?.base ?? "");
let fetchImpl = (...a) => fetch(...a);
export function setFetch(fn) { fetchImpl = typeof fn === "function" ? fn : (...a) => fetch(...a); }

// ---- one request a second per service --------------------------------------------------------------------------------
const lanes = new Map();   // id → { last, chain }
function slot(id) {
  const gap = mock() ? 0 : SERVICES[id]?.gap ?? 0;
  if (!gap) return Promise.resolve();
  const lane = lanes.get(id) ?? { last: 0, chain: Promise.resolve() };
  lanes.set(id, lane);
  const turn = lane.chain.then(async () => {
    const wait = lane.last + gap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lane.last = Date.now();
  });
  lane.chain = turn.catch(() => {});
  return turn;
}

// ---- the cache ---------------------------------------------------------------------------------------------------------
const cache = new Map();   // key → { at, v }
const CACHE_MS = 10 * 60_000, CACHE_MAX = 300;
function cached(key) { const c = cache.get(key); if (c && Date.now() - c.at < CACHE_MS) return c.v; if (c) cache.delete(key); return undefined; }
function remember(key, v) { cache.set(key, { at: Date.now(), v }); if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); }
export const _clearCache = () => cache.clear();

// A service error with a message fit to show and say (never the key, never the raw body)
export class MapsError extends Error { constructor(msg, { status = 0, code = "", service = "" } = {}) { super(msg); this.status = status; this.code = code; this.service = service; } }
const NAMES = { nominatim: "OpenStreetMap search", photon: "OpenStreetMap search", osrm: "the free route service", ors: "OpenRouteService", tiles: "the map pictures", "google-places": "Google Places", "google-routes": "Google Routes" };

// request(id, path, { method, headers, body, cacheKey, timeout, isStale }) → parsed JSON
export async function request(id, path, { method = "GET", headers = {}, body, cacheKey = null, timeout = 12000, isStale = null, raw = false } = {}) {
  if (cacheKey) { const c = cached(`${id}|${cacheKey}`); if (c !== undefined) return c; }
  await slot(id);
  if (isStale?.()) return null;   // a newer type-ahead request came in while this one waited
  let r;
  try {
    r = await fetchImpl(base(id) + path, { method, headers: { "user-agent": USER_AGENT, accept: raw ? "*/*" : "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    throw new MapsError(e?.name === "TimeoutError" ? `${NAMES[id] ?? id} didn't answer in time.` : `I couldn't reach ${NAMES[id] ?? id}. Is the internet on?`, { service: id, code: "offline" });
  }
  if (raw) { if (!r.ok) throw new MapsError(`${NAMES[id] ?? id} said no (${r.status}).`, { status: r.status, service: id }); const buf = Buffer.from(await r.arrayBuffer()); return { buf, type: r.headers.get("content-type") ?? "" }; }
  const text = await r.text();
  let j = null; try { j = text ? JSON.parse(text) : null; } catch { j = null; }
  if (!r.ok) throw explain(id, r.status, j);
  if (cacheKey) remember(`${id}|${cacheKey}`, j);
  return j;
}
// Google's and ORS's error bodies → a plain sentence (what to fix, in Settings → Maps)
export function explain(id, status, j) {
  const g = j?.error ?? {}, msg = String(g.message ?? j?.error?.message ?? j?.message ?? (typeof j?.error === "string" ? j.error : "") ?? "");
  const reason = JSON.stringify(g.details ?? []) + " " + String(g.status ?? "") + " " + msg;
  const who = NAMES[id] ?? id;
  if (id.startsWith("google")) {
    if (/API_KEY_INVALID|API key not valid/i.test(reason)) return new MapsError("Google says the Maps key isn't valid. Copy it again in Settings → Maps.", { status, code: "bad-key", service: id });
    if (/SERVICE_DISABLED|has not been used|is disabled|not been enabled/i.test(reason)) return new MapsError(`${who} isn't turned on for this key's Google Cloud project. Enable it in the Google Cloud console (Settings → Maps has the steps).`, { status, code: "api-off", service: id });
    if (/BILLING|billing/i.test(reason)) return new MapsError("Google needs billing turned on for this project before the Maps key works. Settings → Maps has the steps.", { status, code: "billing", service: id });
    if (/API_KEY_SERVICE_BLOCKED|blocked|referer|IP address/i.test(reason)) return new MapsError(`This Google key isn't allowed to use ${who}. Check the key's restrictions in the Google Cloud console.`, { status, code: "blocked", service: id });
    if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(reason)) return new MapsError(`${who} has reached its limit for now (the quota you set, or Google's). Try again later.`, { status, code: "quota", service: id });
  }
  if (id === "ors") {
    if (status === 401 || status === 403) return new MapsError("OpenRouteService didn't accept the key. Check it in Settings → Maps.", { status, code: "bad-key", service: id });
    if (status === 429) return new MapsError("OpenRouteService's free daily limit is used up. The free route service takes over.", { status, code: "quota", service: id });
  }
  if (status === 429) return new MapsError(`${who} is busy (too many requests). Try again in a minute.`, { status, code: "busy", service: id });
  if (status === 404 && /route|NoRoute|Could not find/i.test(msg)) return new MapsError("There's no route between those two places.", { status, code: "no-route", service: id });
  return new MapsError(`${who} couldn't do that (${status}${msg ? `: ${msg.slice(0, 120)}` : ""}).`, { status, code: "error", service: id });
}
