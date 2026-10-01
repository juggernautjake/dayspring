// Amazon in Dayspring's media window (lib/browser.mjs: real Chrome, the "DayspringMedia" profile in %LOCALAPPDATA%, where
// the owner signs in to Amazon himself, once). Kept minimised while Dayspring reads pages; shown only when the owner must
// act: signing in, a "are you a robot?" check, the checkout review page, a settings page he asked to see.
// Gentle with Amazon:
//   - one page at a time (a queue), at a human pace: a few seconds between pages, with a random extra wait (jitter)
//   - what was read is kept for a few minutes (the same search twice is one visit)
//   - no crawling: only the pages the owner asked for, and the once-a-day subscription check he turned on
//   - a robot check (CAPTCHA) is NEVER solved or touched: the page is shown to him and everything pauses until he's done
// Reads pages only: open(path) → { html, url }. Nothing here presses, types or submits anything (clicker.mjs does the
// two things that may be pressed, after his yes).
// Tests: DAYSPRING_SHOPPING_TEST=1 + DAYSPRING_AMAZON_ORIGIN (a stand-in on this computer, site.mjs) and a throwaway
// DAYSPRING_MEDIA_PROFILE; in test mode the real amazon.com and the owner's own profile are refused outright.
import { broadcast as busBroadcast } from "../bus.mjs";
import { origin, url as siteUrl, isAmazonUrl, hosts, testMode, REAL_ORIGIN, PAGES } from "./site.mjs";
import { pageKind } from "./parse.mjs";

let deps = {
  browser: () => import("../browser.mjs"),
  broadcast: busBroadcast,
  log: () => {},
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  random: () => Math.random(),
};
export function _setDeps(d) { deps = { ...deps, ...d }; }

export const GAP_MS = () => Number(process.env.DAYSPRING_SHOPPING_GAP_MS ?? 2500);
export const JITTER_MS = () => Number(process.env.DAYSPRING_SHOPPING_JITTER_MS ?? 2000);
export const CACHE_MS = () => Number(process.env.DAYSPRING_SHOPPING_CACHE_MS ?? 5 * 60_000);
export const TIMEOUT_MS = () => Number(process.env.DAYSPRING_SHOPPING_TIMEOUT_MS ?? 30_000);
const PAGE = "amazon";

// ---- safety: where it may go ------------------------------------------------------------------------------------------------
function assertAllowed(u) {
  if (!isAmazonUrl(u)) throw Object.assign(new Error("Dayspring only opens amazon.com pages here."), { refused: true });
  if (testMode()) {
    if (origin() === REAL_ORIGIN || u.startsWith(REAL_ORIGIN)) throw Object.assign(new Error("Test mode never contacts the real amazon.com."), { refused: true });
    if (!process.env.DAYSPRING_MEDIA_PROFILE) throw Object.assign(new Error("Test mode needs its own throwaway browser profile (DAYSPRING_MEDIA_PROFILE)."), { refused: true });
  }
}

// ---- one at a time, at a human pace ---------------------------------------------------------------------------------------------
let chain = Promise.resolve(), lastNav = 0;
export function exclusive(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}
async function pace() {
  const wait = lastNav + GAP_MS() + Math.round(deps.random() * JITTER_MS()) - deps.now();
  if (wait > 0) await deps.sleep(wait);
  lastNav = deps.now();
}

// ---- a few minutes of memory ------------------------------------------------------------------------------------------------------
const cache = new Map();          // address → { at, html, url }
export function cached(u) { const c = cache.get(u); if (c && deps.now() - c.at < CACHE_MS()) return c; cache.delete(u); return null; }
export function forget(match = null) { for (const k of [...cache.keys()]) if (!match || match.test(k)) cache.delete(k); }
function remember(u, v) { cache.set(u, { ...v, at: deps.now() }); if (cache.size > 60) cache.delete(cache.keys().next().value); }

// ---- paused for the owner (a robot check) -----------------------------------------------------------------------------------
let paused = null;                 // { kind: "captcha", at, url }
export const pausedState = () => (paused ? { ...paused } : null);
export function _reset() { paused = null; cache.clear(); lastNav = 0; chain = Promise.resolve(); }
const pausedError = () => Object.assign(new Error("Amazon asked to check that you're a person. Dayspring never answers those: the page is open in Dayspring's browser window. Solve it there yourself, then press Continue (or say \"continue shopping\")."), { captcha: true });

async function amazonPage() {
  const b = await deps.browser();
  return { b, p: await b.page(PAGE) };
}
// show the window (the owner acts) or tuck it away (Dayspring only reads)
export async function show() { const { b, p } = await amazonPage(); await p.bringToFront().catch(() => {}); await b.windowState(p, "normal"); return true; }
export async function hide() { const { b, p } = await amazonPage(); await b.windowState(p, "minimized"); return true; }
export const currentUrl = async () => { try { const { p } = await amazonPage(); return p.url(); } catch { return ""; } };

// open(path or address, { show, fresh, wait }) → { html, url, kind, signedIn, greeting }
//   errors (plain English): signIn (e.signIn), the robot check (e.captcha), Amazon's error page (e.oops), too slow (e.timeout)
export function open(path, o = {}) {
  const target = /^https?:/i.test(path) ? path : siteUrl(path);
  assertAllowed(target);
  if (paused) return Promise.reject(pausedError());
  if (!o.fresh) { const c = cached(target); if (c) return Promise.resolve({ ...c, cached: true }); }
  return exclusive(() => openNow(target, o));
}
// the same, already inside exclusive() (a read followed by the one click, with nothing else in between)
export async function openNow(path, o = {}) {
  const target = /^https?:/i.test(path) ? path : siteUrl(path);
  assertAllowed(target);
  {
    if (paused) throw pausedError();
    await pace();
    const { b, p } = await amazonPage();
    if (!o.show) await b.windowState(p, "minimized");
    try {
      await p.goto(target, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS() });
      if (o.wait) await p.waitForSelector(o.wait, { timeout: 8000 }).catch(() => {});
      else await p.waitForTimeout(400);
    } catch (e) {
      if (/timeout/i.test(String(e?.message))) throw Object.assign(new Error(`Amazon took too long to answer (over ${Math.round(TIMEOUT_MS() / 1000)} seconds). Check the internet connection, then try again.`), { timeout: true });
      if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_NETWORK/i.test(String(e?.message))) throw Object.assign(new Error("Dayspring couldn't reach Amazon. Is the internet connected?"), { offline: true });
      throw Object.assign(new Error(`Amazon's page didn't open (${String(e?.message ?? e).split("\n")[0].slice(0, 120)}).`), { failed: true });
    }
    const html = await p.content();
    const at = p.url();
    if (!isAmazonUrl(at)) { await p.goto("about:blank").catch(() => {}); throw Object.assign(new Error("Amazon sent the page somewhere else, so Dayspring stopped."), { refused: true }); }
    const k = pageKind(html, at);
    deps.log("shopping.page", { page: new URL(at).pathname.slice(0, 80), kind: k.kind });
    if (k.kind === "captcha") {
      paused = { kind: "captcha", at: deps.now(), url: at };
      await p.bringToFront().catch(() => {}); await b.windowState(p, "normal");
      deps.broadcast("shopping", { do: "paused", kind: "captcha" });
      deps.log("shopping.captcha", { page: new URL(at).pathname.slice(0, 80), text: "A robot check was shown to the owner; Dayspring paused and didn't touch it." });
      watchPause();
      throw pausedError();
    }
    if (k.kind === "signin") {
      throw Object.assign(new Error("You're not signed in to Amazon in Dayspring yet. Press \"Sign in to Amazon\" (or say \"sign in to Amazon\") and sign in yourself, once."), { signIn: true });
    }
    if (k.kind === "oops") throw Object.assign(new Error("Amazon showed its \"Sorry, something went wrong\" page. That's on Amazon's side: try again in a minute."), { oops: true });
    const out = { html, url: at, kind: k.kind, signedIn: k.signedIn, greeting: k.greeting };
    if (!o.noCache) remember(target, out);
    if (!o.show && !o.keepShown) await b.windowState(p, "minimized");
    return out;
  }
}
// the page as it is now (after a click), read the same way (never cached): a robot check pauses, a sign-in is shown
export async function settle() {
  const { b, p } = await amazonPage();
  const html = await p.content(), at = p.url();
  const k = pageKind(html, at);
  if (k.kind === "captcha") {
    paused = { kind: "captcha", at: deps.now(), url: at };
    await p.bringToFront().catch(() => {}); await b.windowState(p, "normal");
    deps.broadcast("shopping", { do: "paused", kind: "captcha" });
    deps.log("shopping.captcha", { text: "A robot check was shown to the owner; Dayspring paused and didn't touch it." });
    watchPause();
    throw pausedError();
  }
  if (k.kind === "signin") { await p.bringToFront().catch(() => {}); await b.windowState(p, "normal"); throw Object.assign(new Error("Amazon wants you to sign in again. The sign-in is open in Dayspring's browser window: sign in there yourself."), { signIn: true }); }
  return { html, url: at, ...k };
}
// the raw Playwright page, for the click layer only (lib/shopping/clicker.mjs)
export async function pageForClick() { const { p } = await amazonPage(); assertAllowed(p.url()); if (paused) throw pausedError(); return p; }

// "Continue" after he solved the robot check: look at the page again
// look: load the page once more (only when he presses Continue; the background watch never reloads anything)
export async function resume({ look = true } = {}) {
  if (!paused) return { resumed: true };
  const { p } = await amazonPage();
  let html = await p.content().catch(() => ""), at = p.url();
  // still showing? Look once more by loading the same page again (never submitting anything: a check's own answer
  // address is never re-sent), in case he finished it in another tab or Amazon let him through
  if (look && pageKind(html, at).kind === "captcha" && isAmazonUrl(at) && !/validateCaptcha|field-keywords=/i.test(at)) {
    await p.reload({ waitUntil: "domcontentloaded", timeout: TIMEOUT_MS() }).catch(() => {});
    html = await p.content().catch(() => ""); at = p.url();
  }
  if (pageKind(html, at).kind === "captcha") return { resumed: false, text: "The check is still showing in Dayspring's browser window. Finish it there, then press Continue." };
  paused = null; stopWatch();
  forget();
  deps.broadcast("shopping", { do: "resumed" });
  deps.log("shopping.resumed", {});
  await hide().catch(() => {});
  return { resumed: true };
}
// while paused, look now and then (never touching the page) for the check to be gone
let watchT = null;
function watchPause() {
  stopWatch();
  const until = deps.now() + 15 * 60_000;
  watchT = setInterval(async () => {
    if (!paused || deps.now() > until) { stopWatch(); return; }
    try { const { p } = await amazonPage(); const html = await p.content(); if (pageKind(html, p.url()).kind !== "captcha") await resume({ look: false }); } catch { /* the window is busy or closed */ }
  }, Number(process.env.DAYSPRING_SHOPPING_PAUSE_POLL_MS ?? 4000));
  watchT.unref?.();
}
function stopWatch() { if (watchT) clearInterval(watchT); watchT = null; }

// A banner across the top of Amazon's checkout page, in the media window (only that page, only while it's showing)
export async function banner(textLine) {
  const { p } = await amazonPage();
  await p.evaluate((t) => {
    document.getElementById("dayspring-banner")?.remove();
    const d = document.createElement("div");
    d.id = "dayspring-banner"; d.setAttribute("role", "status");
    d.textContent = t;
    d.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:2147483647;padding:12px 16px;background:#1d2a6b;color:#fff;font:600 17px/1.35 system-ui,sans-serif;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,.35);pointer-events:none";
    document.documentElement.appendChild(d);
  }, String(textLine).slice(0, 300)).catch(() => {});
}

// ---- signed in? (cookie NAMES only, never their values) ----------------------------------------------------------------------
export const SIGNIN_COOKIES = ["at-main", "sess-at-main", "x-main"];
const matchHost = (domain, hs) => { const d = String(domain ?? "").replace(/^\./, "").toLowerCase(); return hs.some((h) => d === h || d.endsWith("." + h)); };
export async function cookieSignedIn() {
  const b = await deps.browser();
  const ctx = await b.mediaContext();
  const hs = hosts();
  const names = (await ctx.cookies()).filter((c) => matchHost(c.domain, hs) && (!c.expires || c.expires < 0 || c.expires * 1000 > Date.now())).map((c) => c.name);
  return SIGNIN_COOKIES.some((n) => names.includes(n));
}
// show the sign-in page (he types his own email, password and codes; Dayspring never sees them)
export async function showSignin() {
  const target = siteUrl(PAGES.signin());
  assertAllowed(target);
  return exclusive(async () => {
    const { b, p } = await amazonPage();
    await p.goto(target, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS() }).catch(() => {});
    await p.bringToFront().catch(() => {});
    await b.windowState(p, "normal");
    return { shown: true };
  });
}
// signing out: Amazon's cookies and storage in the DayspringMedia profile only (other sites and his own Chrome untouched)
export async function clearSignin() {
  const b = await deps.browser();
  const ctx = await b.mediaContext();
  const hs = hosts();
  const before = (await ctx.cookies()).filter((c) => matchHost(c.domain, hs)).length;
  await ctx.clearCookies({ domain: new RegExp(`(^|\\.)(${hs.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`, "i") });
  const p = await b.page(PAGE);
  let cdp = null;
  try {
    cdp = await ctx.newCDPSession(p);
    for (const o of [...new Set([origin(), REAL_ORIGIN])]) await cdp.send("Storage.clearDataForOrigin", { origin: o, storageTypes: "cookies,local_storage,indexeddb,cache_storage,service_workers" }).catch(() => {});
  } catch { /* fine */ } finally { await cdp?.detach().catch(() => {}); }
  await p.goto("about:blank").catch(() => {});
  forget();
  return { cleared: before };
}
