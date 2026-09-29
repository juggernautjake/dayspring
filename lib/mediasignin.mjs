// Signing in to YouTube and Spotify in Dayspring's media window: "sign in once, stay signed in".
//   start(service)   shows the media window (profile DayspringMedia, in %LOCALAPPDATA%: per user, protected by Windows) on
//                    the service's own sign-in page. The owner signs in himself, 2-step codes included: Dayspring never
//                    types, reads or keeps a password. It watches for the signed-in state (YouTube: the account's SAPISID
//                    cookie is there; Spotify: the web player's sp_dc cookie), then says "✓ Signed in as …" and minimises
//                    the window.
//   check(service)   is he still signed in? Only cookie NAMES are looked at (never values), in the media window's own
//                    profile, and only when that window is already open, or when asked (force). At most every few hours
//                    by itself (startHealth). A session that has ended is told ONCE (the floor: it waits while he talks),
//                    with a "Sign in again" button on the screen.
//   signOut(service) clears that site's cookies and storage in the DayspringMedia profile only (the other service stays
//                    signed in; his own Chrome is never touched).
// Kept in data/media-signin.json: signed in or not, the account's display name, when it was checked. Never a cookie, a
// token or a password. The Spotify Web API connection (lib/spotify-api.mjs, "Spotify connected") is separate from the web
// player's sign-in here ("Spotify web player signed in"); both are shown.
// Tests: DAYSPRING_YT_WEB / DAYSPRING_YT_SIGNIN / DAYSPRING_SPOTIFY_WEB / DAYSPRING_SPOTIFY_SIGNIN point at mock pages,
// DAYSPRING_MEDIA_SIGNIN_FILE moves the state file, DAYSPRING_MEDIA_HEADLESS=1 keeps the window off screen.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJSONAtomic } from "./atomic.mjs";
import { broadcast } from "./bus.mjs";

const FILE = () => process.env.DAYSPRING_MEDIA_SIGNIN_FILE || join(dirname(fileURLToPath(import.meta.url)), "..", "data", "media-signin.json");
export const HEALTH_MS = Number(process.env.DAYSPRING_SIGNIN_HEALTH_MS) || 4 * 3600_000;
const strip = (u) => String(u).replace(/\/$/, "");
export const SERVICES = {
  youtube: {
    name: "YouTube", web: () => strip(process.env.DAYSPRING_YT_WEB || "https://www.youtube.com"),
    signin: () => process.env.DAYSPRING_YT_SIGNIN || "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F",
    cookies: ["SAPISID", "__Secure-3PAPISID", "__Secure-1PAPISID"],
    hosts: ["youtube.com", "google.com", "accounts.google.com", "youtube-nocookie.com"],
  },
  spotify: {
    name: "Spotify", web: () => strip(process.env.DAYSPRING_SPOTIFY_WEB || "https://open.spotify.com"),
    signin: () => process.env.DAYSPRING_SPOTIFY_SIGNIN || "https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F",
    cookies: ["sp_dc"],
    hosts: ["spotify.com", "accounts.spotify.com", "open.spotify.com"],
  },
};
const svc = (s) => { const x = SERVICES[s]; if (!x) throw new Error("Which one: YouTube or Spotify?"); return x; };
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ""; } };
// every host whose cookies belong to the service (the real ones, and the mock pages' in tests)
export function hostsOf(service) {
  const s = svc(service);
  return [...new Set([...s.hosts, hostOf(s.web()), hostOf(s.signin())].filter(Boolean))];
}
const matchHost = (domain, hosts) => { const d = String(domain ?? "").replace(/^\./, "").toLowerCase(); return hosts.some((h) => d === h || d.endsWith("." + h)); };

// what reaches the browser (tests replace these)
let deps = {
  browser: () => import("./browser.mjs"),
  offer: async (item, fire) => { try { const f = await import("./floor.mjs"); f.offer(item, fire, { expectDone: false }); } catch { fire(item); } },
};
export function _setDeps(d) { deps = { ...deps, ...d }; }

// ---- the state file (names and times only) -------------------------------------------------------------------------------
let db = null;
function load() {
  if (db && db.file === FILE()) return db;
  let raw = {};
  try { raw = existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), "utf8")) : {}; } catch { raw = {}; }
  db = { file: FILE(), youtube: raw.youtube ?? {}, spotify: raw.spotify ?? {} };
  return db;
}
function save() { const d = load(); try { mkdirSync(dirname(d.file), { recursive: true }); writeJSONAtomic(d.file, { youtube: d.youtube, spotify: d.spotify }, 2); } catch (e) { console.log(`media sign-in: not saved (${e.message})`); } }
export function _reset() { db = null; watching.clear(); }
const view = (service) => { const s = load()[service]; return { service, name: SERVICES[service].name, signedIn: s.signedIn ?? null, account: s.account ?? null, checkedAt: s.checkedAt ?? null, expired: Boolean(s.expired), signingIn: watching.has(service) }; };
export const status = (service) => (service ? view(service) : { youtube: view("youtube"), spotify: view("spotify") });

// ---- looking (cookie names only) -------------------------------------------------------------------------------------------
async function cookieNames(service) {
  const b = await deps.browser();
  const ctx = await b.mediaContext();
  const hosts = hostsOf(service);
  return (await ctx.cookies()).filter((c) => matchHost(c.domain, hosts) && (!c.expires || c.expires < 0 || c.expires * 1000 > Date.now())).map((c) => c.name);
}
export async function signedIn(service) { const names = await cookieNames(service); return svc(service).cookies.some((n) => names.includes(n)); }
// the account's display name (best effort; never required)
async function accountName(service) {
  const b = await deps.browser();
  try {
    if (service === "youtube") {
      const j = await b.youtubeApi("account/account_menu", {});
      let name = null, email = null;
      const walk = (o) => { if (!o || typeof o !== "object") return; if (o.activeAccountHeaderRenderer) { const h = o.activeAccountHeaderRenderer; name = h.accountName?.simpleText ?? h.accountName?.runs?.map((r) => r.text).join("") ?? null; email = h.email?.simpleText ?? h.channelHandle?.simpleText ?? null; return; } for (const k in o) walk(o[k]); };
      walk(j);
      return name || email ? [name, email].filter(Boolean).join(" · ") : null;
    }
    const p = await b.page("spotify");
    if (!p.url().startsWith(SERVICES.spotify.web())) await p.goto(SERVICES.spotify.web(), { waitUntil: "domcontentloaded", timeout: 30000 });
    const label = await p.locator('[data-testid="user-widget-link"]').first().getAttribute("aria-label", { timeout: 8000 }).catch(() => null);
    return label ? label.replace(/^\s*(?:profile|account)\s*[:·-]?\s*/i, "").trim() || null : null;
  } catch { return null; }
}

// ---- signing in ------------------------------------------------------------------------------------------------------------
const watching = new Map();       // service → { timer, until }
export const POLL_MS = Number(process.env.DAYSPRING_SIGNIN_POLL_MS) || 2000;
export const WATCH_MS = 15 * 60_000;
export async function start(service) {
  const s = svc(service);
  const b = await deps.browser();
  const p = await b.page(service);
  await p.goto(s.signin(), { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.bringToFront().catch(() => {});
  await b.windowState(p, "normal");
  watch(service);
  return { shown: true, service, text: `The ${s.name} sign-in is open in Dayspring's media window. Sign in there yourself (2-step codes too). Dayspring never sees your password, and it notices by itself when you're done.` };
}
function watch(service) {
  stopWatch(service);
  const w = { until: Date.now() + WATCH_MS, busy: false };
  w.timer = setInterval(async () => {
    if (w.busy) return;
    if (Date.now() > w.until) { stopWatch(service); return; }
    w.busy = true;
    try { if (await signedIn(service)) { stopWatch(service); await finished(service); } } catch { /* the window was closed: keep looking until the time runs out */ } finally { w.busy = false; }
  }, POLL_MS);
  w.timer.unref?.();
  watching.set(service, w);
}
function stopWatch(service) { const w = watching.get(service); if (w) clearInterval(w.timer); watching.delete(service); }
async function finished(service) {
  const b = await deps.browser();
  // to the service's own start page (which shows who's signed in), then out of the way
  try { const p = await b.page(service); await p.goto(SERVICES[service].web() + "/", { waitUntil: "domcontentloaded", timeout: 30000 }); } catch { /* fine */ }
  const account = await accountName(service);
  const d = load();
  d[service] = { signedIn: true, account, checkedAt: Date.now(), expired: false, notified: false, since: Date.now() };
  save();
  await b.hide().catch(() => {});
  broadcast("mediasignin", { service, signedIn: true, account, text: `✓ Signed in to ${SERVICES[service].name}${account ? ` as ${account}` : ""}` });
  return view(service);
}

// ---- health ----------------------------------------------------------------------------------------------------------------
// check(service, { force }) → view. force: open the media window (minimised) to look; otherwise only when it's open already.
export async function check(service, { force = false } = {}) {
  svc(service);
  const b = await deps.browser();
  if (!force && !b.isOpen()) return view(service);
  let on;
  try { on = await signedIn(service); } catch { return view(service); }
  return record(service, on);
}
// a feature that needed the sign-in found it signed out (the history page said so): the same as a check
export function sawSignedOut(service) { return record(service, false); }
function record(service, on) {
  const d = load(), was = d[service].signedIn;
  d[service] = { ...d[service], signedIn: on, checkedAt: Date.now() };
  if (on) { d[service].expired = false; d[service].notified = false; }
  else if (was === true) d[service].expired = true;
  save();
  if (!on && d[service].expired && !d[service].notified) notifyExpired(service);
  if (on !== was) broadcast("mediasignin", { service, signedIn: on, account: d[service].account ?? null, expired: Boolean(d[service].expired) });
  return view(service);
}
function notifyExpired(service) {
  const d = load();
  d[service].notified = true; save();
  const name = SERVICES[service].name;
  const item = { at: new Date().toISOString(), kind: "signin", service, text: `Your ${name} sign-in in Dayspring has ended. Say "sign in to ${name}" or use the Sign in again button when you're ready.` };
  deps.offer(item, (it) => broadcast("mediasignin", { service, expired: true, signedIn: false, notice: it.text }));
}
let healthTimer = null;
export function startHealth() {
  if (healthTimer) return;
  healthTimer = setInterval(async () => { for (const s of Object.keys(SERVICES)) { try { await check(s); } catch { /* next time */ } } }, HEALTH_MS);
  healthTimer.unref?.();
}
export function stopHealth() { clearInterval(healthTimer); healthTimer = null; }
// for features that need it: throws "sign in to YouTube first" (with signIn: true) when it's known to be signed out
export function needs(service) {
  const v = view(service);
  if (v.signedIn === false) throw Object.assign(new Error(`Sign in to ${SERVICES[service].name} first: say "sign in to ${SERVICES[service].name}", or use the Sign in button.`), { signIn: service });
  return v;
}

// ---- signing out -----------------------------------------------------------------------------------------------------------
export async function signOut(service) {
  const s = svc(service);
  stopWatch(service);
  const b = await deps.browser();
  const ctx = await b.mediaContext();
  const hosts = hostsOf(service);
  const before = (await ctx.cookies()).filter((c) => matchHost(c.domain, hosts)).length;
  // this site's cookies only: every other site in the profile keeps its own
  await ctx.clearCookies({ domain: new RegExp(`(^|\\.)(${hosts.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`, "i") });
  // and its storage (local storage, IndexedDB, caches, service workers), origin by origin
  const origins = [...new Set([s.web(), s.signin(), ...s.hosts.map((h) => `https://${h}`)].map((u) => { try { return new URL(u).origin; } catch { return null; } }).filter(Boolean))];
  const p = await b.page(service);
  let cdp = null;
  try {
    cdp = await ctx.newCDPSession(p);
    for (const origin of origins) await cdp.send("Storage.clearDataForOrigin", { origin, storageTypes: "cookies,local_storage,indexeddb,cache_storage,service_workers,file_systems,websql" }).catch(() => {});
  } finally { await cdp?.detach().catch(() => {}); }
  await p.goto("about:blank").catch(() => {});
  const d = load();
  d[service] = { signedIn: false, account: null, checkedAt: Date.now(), expired: false, notified: false };
  save();
  broadcast("mediasignin", { service, signedIn: false, signedOut: true });
  return { ...view(service), cleared: before };
}

// ---- words ("sign in to YouTube", "sign out of Spotify", "am I signed in to YouTube?") ---------------------------------------
export async function command(text) {
  const t = String(text ?? "").toLowerCase().replace(/[!?.,]/g, "").replace(/\s+/g, " ").trim().replace(/^(?:hey |ok |okay )?(?:dayspring )?(?:please )?/, "");
  let m;
  if ((m = /^(?:sign|log) ?(?:me )?(?:back )?(?:in|into|on)(?: to)? (?:the )?(youtube|spotify)(?: web player)?(?: again)?(?: in the media (?:window|browser))?$/.exec(t))) { const r = await start(m[1]); return r.text; }
  if ((m = /^(?:sign|log) (?:me )?out (?:of|from) (youtube|spotify)(?: web player)?(?: in dayspring)?$/.exec(t))) { await signOut(m[1]); return `Signed out of ${SERVICES[m[1]].name} in Dayspring's media window. Nothing else changed.`; }
  if ((m = /^am i (?:still )?(?:signed|logged) in(?: to)? (youtube|spotify)$/.exec(t))) {
    const v = await check(m[1], { force: true });
    return v.signedIn ? `Yes, ${v.name} is signed in${v.account ? ` as ${v.account}` : ""}.` : `No, ${v.name} isn't signed in. Say "sign in to ${v.name}" when you're ready.`;
  }
  return null;
}
