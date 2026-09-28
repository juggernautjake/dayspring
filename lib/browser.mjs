// The media browser: a real Chrome window driven by Playwright. It plays Spotify (the web player, logged in once and
// remembered) and shows the Spotify / YouTube sign-in pages when asked. It sits minimised; signing in is the only time
// it needs to be seen. It is NEVER opened for searching or at start-up.
// Searching (YouTube, the web) uses a separate HEADLESS browser in its own profile (searchPage), and only when plain
// page fetches fail: nothing ever appears on screen for it.
import { createRequire } from "node:module";
import { playwrightChannel } from "./browsers.mjs";
import { join } from "node:path";
import * as settings from "./settings.mjs";
import * as sinkpick from "./sinkpick.mjs";
import * as webplayer from "./music/webplayer.mjs";
import * as musicResolve from "./music/resolve.mjs";
import { on as featureOn } from "./features.mjs";

const require = createRequire(import.meta.url);
const PROFILE = () => process.env.DAYSPRING_MEDIA_PROFILE || join(process.env.LOCALAPPDATA || ".", "DayspringMedia");
const SEARCH_PROFILE = () => process.env.DAYSPRING_SEARCH_PROFILE || join(process.env.LOCALAPPDATA || ".", "DayspringSearch");
// tests: DAYSPRING_BROWSER_LOG=<file> appends one line per launch ("media" = the visible window, "search" = headless)
function noteLaunch(kind) { if (process.env.DAYSPRING_BROWSER_LOG) { try { require("node:fs").appendFileSync(process.env.DAYSPRING_BROWSER_LOG, `${new Date().toISOString()} ${kind}\n`); } catch { /* test log only */ } } }

let ctx = null, launching = null;
const pages = {};                      // name → Page: "spotify", "youtube", "watch"

async function context() {
  if (ctx) return ctx;
  if (launching) return launching;
  launching = (async () => {
    const { chromium } = require("playwright-core");
    noteLaunch("media");
    // Real Chrome (not Playwright's Chromium): Spotify needs Chrome's DRM to play.
    const c = await chromium.launchPersistentContext(PROFILE(), {
      channel: playwrightChannel(), headless: false, viewport: null,
      args: ["--autoplay-policy=no-user-gesture-required", "--window-size=1280,860", "--window-position=60,60",
        "--disable-blink-features=AutomationControlled", "--no-first-run", "--disable-session-crashed-bubble"],
      // --disable-component-update would also block Widevine, which Spotify needs ("playback of protected content is not enabled")
      ignoreDefaultArgs: ["--enable-automation", "--mute-audio", "--disable-component-update"],
    });
    // Spotify plays through an audio element that is never put on the page, so remember every element that starts
    // playing (window.__dsMedia): fades, ducking and the output device then reach the music itself. The helper
    // (lib/sinkpick.mjs) also sends every element to the device setSink() chose, including ones that start later.
    await c.addInitScript({ content: sinkpick.controllerSource({ key: SINK_KEY, exposeMedia: true }) });
    c.on("close", () => { ctx = null; for (const k of Object.keys(pages)) delete pages[k]; });
    ctx = c;
    return c;
  })();
  try { return await launching; } finally { launching = null; }
}

export async function page(name) {
  const c = await context();
  if (pages[name] && !pages[name].isClosed()) return pages[name];
  const blank = c.pages().find((p) => p.url() === "about:blank" && !Object.values(pages).includes(p));
  pages[name] = blank ?? await c.newPage();
  return pages[name];
}
export const isOpen = () => Boolean(ctx);

// ---- the headless search browser (its own profile; never on screen) --------------------------------------------------
let sctx = null, slaunching = null;
const spages = {};
async function searchContext() {
  if (sctx) return sctx;
  if (slaunching) return slaunching;
  slaunching = (async () => {
    const { chromium } = require("playwright-core");
    noteLaunch("search");
    const c = await chromium.launchPersistentContext(SEARCH_PROFILE(), {
      channel: playwrightChannel(), headless: true, viewport: { width: 1280, height: 900 },
      args: ["--disable-blink-features=AutomationControlled", "--no-first-run", "--mute-audio"],
    });
    c.on("close", () => { sctx = null; for (const k of Object.keys(spages)) delete spages[k]; });
    sctx = c; return c;
  })();
  try { return await slaunching; } finally { slaunching = null; }
}
// it closes itself after 10 idle minutes (a headless Chrome otherwise sits in memory all day)
export const SEARCH_IDLE_MS = Number(process.env.DAYSPRING_SEARCH_IDLE_MS) || 10 * 60_000;
let sused = 0, sidle = null;
function touchSearch() {
  sused = Date.now();
  sidle ??= setInterval(() => { if (!sctx) { clearInterval(sidle); sidle = null; return; } if (Date.now() - sused >= SEARCH_IDLE_MS) { clearInterval(sidle); sidle = null; closeSearch().catch(() => {}); } }, Math.min(60_000, SEARCH_IDLE_MS / 2));
  sidle.unref?.();
}
export const searchOpen = () => Boolean(sctx);
export async function searchPage(name) {
  const c = await searchContext();
  touchSearch();
  if (spages[name] && !spages[name].isClosed()) return spages[name];
  spages[name] = c.pages().find((p) => p.url() === "about:blank" && !Object.values(spages).includes(p)) ?? await c.newPage();
  return spages[name];
}
export async function closeSearch() { if (sctx) await sctx.close().catch(() => {}); sctx = null; }

// Window state through the DevTools protocol: "minimized", "normal", "fullscreen".
export async function windowState(p, state) {
  // never let a busy window hold up the reply
  await Promise.race([windowStateInner(p, state), new Promise((r) => setTimeout(r, 5000))]);
}
async function windowStateInner(p, state) {
  let cdp = null;
  try {
    cdp = await p.context().newCDPSession(p);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    if (state !== "normal") await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: state } });
  } catch { /* the window is gone or busy: not fatal */ }
  finally { await cdp?.detach().catch(() => {}); }   // a session left attached (after an error or the 5 s give-up) keeps the page alive
}
export async function hide() { const p = Object.values(pages).find((x) => !x.isClosed()); if (p) await windowState(p, "minimized"); }

export async function close() { if (ctx) await ctx.close().catch(() => {}); ctx = null; await closeSearch(); }

// ---- YouTube ------------------------------------------------------------------------------

// YouTube search, the last resort (see ytsearch.mjs): youtube.com in the HEADLESS search browser, read with the same
// parser as the plain-fetch path. Only used when YouTube answers a plain fetch with a check page.
export async function youtubeSearchHeadless(query, opts = {}) {
  const { resultsUrl, parse } = await import("../vendor/ecosystem-core/lib/ytsearch.mjs");
  const p = await searchPage("youtube");
  await p.goto(resultsUrl(query, opts), { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForFunction(() => window.ytInitialData, null, { timeout: 15000 });
  const data = await p.evaluate(() => ({ contents: window.ytInitialData.contents }));
  return (parse(data, opts) ?? []).slice(0, opts.max ?? 20);
}
// Older name, same thing (nothing on screen)
export const youtubeSearch = (query, opts = {}) => youtubeSearchHeadless(query, opts);

// The owner's own playlists (needs them signed in to YouTube in the media browser).
export async function youtubeMyPlaylists() {
  // needs the owner's YouTube sign-in, so it's the media window (only ever on request); kept minimised the whole time
  const p = await page("youtube");
  await windowState(p, "minimized");
  await p.goto("https://www.youtube.com/feed/playlists", { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForFunction(() => window.ytInitialData, null, { timeout: 15000 }).catch(() => {});
  await hide();
  return p.evaluate(() => {
    const out = [];
    const walk = (o) => {
      if (!o || typeof o !== "object") return;
      const l = o.lockupViewModel;
      if (l && /PLAYLIST/.test(l.contentType ?? "")) { out.push({ playlistId: l.contentId, title: l.metadata?.lockupMetadataViewModel?.title?.content ?? "" }); return; }
      if (o.gridPlaylistRenderer) { const g = o.gridPlaylistRenderer; out.push({ playlistId: g.playlistId, title: g.title?.runs?.[0]?.text ?? g.title?.simpleText ?? "" }); return; }
      for (const k in o) walk(o[k]);
    };
    walk(window.ytInitialData?.contents);
    return out;
  });
}

// Playing on youtube.com in the media window. NOT used for YouTube any more (videos play inside Dayspring, and
// "Pop out" opens the person's own browser); kept for older callers.
export async function youtubeWatch({ videoId, playlistId, audioOnly = false, sink = null, screen = null }) {
  const p = await page("watch");
  const url = videoId ? `https://www.youtube.com/watch?v=${videoId}${playlistId ? `&list=${playlistId}` : ""}` : `https://www.youtube.com/playlist?list=${playlistId}`;
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  if (!videoId) await p.locator("a#play-button, ytd-button-renderer a[href*='watch']").first().click({ timeout: 8000 }).catch(() => {});
  await setSink(p, sink ?? sinkpick.rolesNow());   // always Dayspring's output, never just the Windows default
  if (audioOnly) await windowState(p, "minimized");
  else {
    // move the window onto the TV first, then full screen
    if (screen) { let cdp = null; try { cdp = await p.context().newCDPSession(p); const { windowId } = await cdp.send("Browser.getWindowForTarget"); await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } }); await cdp.send("Browser.setWindowBounds", { windowId, bounds: { left: screen.x + 40, top: screen.y + 40, width: 900, height: 500 } }); } catch { /* stays where it is */ } finally { await cdp?.detach().catch(() => {}); } }
    await p.bringToFront();
    await windowState(p, "fullscreen");
  }
  await p.waitForTimeout(1500);
  await p.evaluate(() => { const v = document.querySelector("video"); if (v) { v.muted = false; v.play().catch(() => {}); } });
  return { watching: url };
}
export async function youtubeWatchStop() {
  const p = pages.watch;
  if (!p || p.isClosed()) return false;
  await p.evaluate(() => document.querySelector("video")?.pause()).catch(() => {});
  await p.goto("about:blank").catch(() => {});
  await windowState(p, "minimized");
  return true;
}

// For troubleshooting: a picture of what a media page is showing right now (local only).
export async function snapshot(name = "spotify") {
  const p = pages[name];
  if (!p || p.isClosed()) return null;
  return { url: p.url(), png: await p.screenshot({ timeout: 10000 }).catch(() => null) };
}

// For troubleshooting: the state of each audio/video element on a media page (read only).
export async function mediaElements(name = "spotify") {
  const p = pages[name];
  if (!p || p.isClosed()) return null;
  return p.evaluate(() => [...[...new Set([...document.querySelectorAll("audio, video"), ...(window.__dsMedia ?? [])])]].map((e) => ({ tag: e.tagName, paused: e.paused, t: Math.round(e.currentTime * 10) / 10,
    volume: e.volume, muted: e.muted, ready: e.readyState, net: e.networkState, error: e.error?.message ?? e.error?.code ?? null, sink: e.sinkId ?? null, base: e.dataset.dsBase ?? null }))).catch((e) => ({ error: e.message }));
}

// ---- Spotify ------------------------------------------------------------------------------

const SPOTIFY = process.env.DAYSPRING_SPOTIFY_WEB || "https://open.spotify.com";   // tests: a mock web player page

export async function spotifyLoggedIn() {
  const p = await page("spotify");
  if (!p.url().startsWith(SPOTIFY)) await p.goto(SPOTIFY, { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForSelector('[data-testid="login-button"], [data-testid="user-widget-link"], button[data-testid="user-widget-link"]', { timeout: 15000 }).catch(() => {});
  return (await p.locator('[data-testid="login-button"]').count()) === 0;
}

// Shows the media browser on the Spotify (or YouTube) sign-in page. The owner signs in themselves, once.
export async function showLogin(service) {
  const p = await page(service === "youtube" ? "youtube" : "spotify");
  await p.goto(service === "youtube" ? "https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/" : "https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F", { waitUntil: "domcontentloaded" });
  await p.bringToFront();
  await windowState(p, "normal");
  return { shown: true, service };
}

async function spotifyReady() {
  if (!(await spotifyLoggedIn())) {
    const e = new Error("Spotify isn't signed in yet. Say \"sign in to Spotify\" and log in once in the window that opens.");
    e.needsLogin = true; throw e;
  }
  return pages.spotify;
}

// Find the BEST result of a type (scored like the Web API's results, lib/music/resolve.mjs; not just the first card
// on the page) and open its page. type: track | playlist | album | artist
async function spotifyOpenBest(p, query, type) {
  const found = await webplayer.scrapeSearch(p, SPOTIFY, query, type);
  // "spotifyresolver" switched off (lib/features.mjs): the first result, as before 1.6.0
  const best = featureOn("spotifyresolver") ? musicResolve.rankFound(found, query, type)[0] : (found ?? [])[0];
  if (!best) throw new Error(`Nothing on Spotify matched "${query}".`);
  await p.goto(best.url, { waitUntil: "domcontentloaded" });
  return best.url;
}
// The media window's Spotify for lib/music: the resolver reads its search pages, playlist pages and library
export function spotifyWindow() {
  return {
    find: async (q, type) => webplayer.scrapeSearch(await spotifyReady(), SPOTIFY, q, type),
    inspect: async (url) => webplayer.inspectEntity(await spotifyReady(), SPOTIFY, url),
    library: async () => webplayer.library(await spotifyReady(), SPOTIFY),
    now: () => spotifyNow(),
    play: (o) => spotifyPlay(o),
  };
}

// The top tracks for a search: [{ title, artists, url, duration }]. Used to pin exact recordings in playlists.
export async function spotifySearch(query, max = 5) {
  const p = await spotifyReady();
  await p.goto(`${SPOTIFY}/search/${encodeURIComponent(query)}/tracks`, { waitUntil: "domcontentloaded" });
  await p.locator('[data-testid="tracklist-row"]').first().waitFor({ timeout: 15000 }).catch(() => {});
  return p.evaluate((n) => [...document.querySelectorAll('[data-testid="tracklist-row"]')].slice(0, n).map((r) => {
    const a = r.querySelector('a[href*="/track/"]');
    return { title: a?.textContent?.trim() ?? "", artists: [...r.querySelectorAll('a[href*="/artist/"]')].map((x) => x.textContent.trim()).join(", "),
      url: a ? new URL(a.getAttribute("href"), location.origin).href.replace(/\?.*$/, "") : "", duration: r.querySelector('[data-testid="tracklist-row"] div[aria-colindex="5"], [aria-colindex="4"]')?.textContent?.trim() ?? "" };
  }).filter((t) => t.url), max);
}

export async function spotifyPlay({ query, type = "track", shuffle = false, url }) {
  const p = await spotifyReady();
  let opened;
  // an exact track, album or playlist link (from a curated list)
  if (url) { await p.goto(url.replace(/^https?:\/\/open\.spotify\.com/, SPOTIFY), { waitUntil: "domcontentloaded" }); opened = url; }
  else if (type === "liked") { await p.goto(`${SPOTIFY}/collection/tracks`, { waitUntil: "domcontentloaded" }); opened = "Liked Songs"; }
  else if (type === "myplaylist") {
    // one of his own playlists, from the library sidebar
    await p.goto(SPOTIFY, { waitUntil: "domcontentloaded" });
    const item = p.locator('[data-testid="rootlist-item"], [role="row"]').filter({ hasText: new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).first();
    await item.click({ timeout: 12000 });
    opened = query;
  } else opened = await spotifyOpenBest(p, query, type);
  const play = p.locator('[data-testid="action-bar-row"] [data-testid="play-button"], [data-testid="action-bar"] [data-testid="play-button"]').first();
  await play.waitFor({ timeout: 15000 });
  if (shuffle) await p.locator('[data-testid="action-bar-row"] [aria-label*="huffle"]').first().click({ timeout: 3000 }).catch(() => {});
  await play.click();
  await p.waitForTimeout(2500);
  await hide();
  return { opened, type, ...(await spotifyNow()) };
}

export async function spotifyControl(action) {
  const p = await spotifyReady();
  const ids = { pause: "control-button-playpause", resume: "control-button-playpause", next: "control-button-skip-forward", previous: "control-button-skip-back" };
  if (action === "pause" || action === "resume") {
    const now = await spotifyNow();
    if ((action === "pause") !== now.playing) return now;          // already in that state
  }
  if (!ids[action]) throw new Error(`unknown Spotify action ${action}`);
  await p.locator(`[data-testid="${ids[action]}"]`).first().click({ timeout: 8000 });
  await p.waitForTimeout(900);
  return spotifyNow();
}

// What Spotify is playing: title, artist, cover art, playing or paused.
export async function spotifyNow() {
  const p = pages.spotify;
  if (!p || p.isClosed() || !p.url().startsWith(SPOTIFY)) return { playing: false };
  return p.evaluate(() => {
    const w = document.querySelector('[data-testid="now-playing-widget"]');
    const btn = document.querySelector('[data-testid="control-button-playpause"]');
    const label = btn?.getAttribute("aria-label") ?? "";
    const title = w?.querySelector('[data-testid="context-item-link"], [data-testid="context-item-info-title"]')?.textContent?.trim() ?? "";
    const artist = [...(w?.querySelectorAll('[data-testid="context-item-info-artist"], a[href*="/artist/"]') ?? [])].map((a) => a.textContent.trim()).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ");
    const art = w?.querySelector("img")?.src ?? "";
    return { playing: /pause/i.test(label), title, artist, art: art.replace(/ab67616d00004851/, "ab67616d0000b273") };
  }).catch(() => ({ playing: false }));
}

// Send a page's audio to one output device (lib/sinkpick.mjs): exactly the device named in preferredOutputs for the
// first of the roles that has one plugged in (TV, then headphones, then speakers: copy-protected music such as Spotify can
// go to one device only), else a device whose name fits the role, else the Windows default. "voicemeeter" = the mixer's
// input, which sends the sound on to the TV and/or headset. roles: the owner's audioOutputs (sinkpick.rolesNow()).
// Elements that start later follow too, and every open media page moves again when the owner changes the output.
// → the chosen device's name, "default", or null when the page is gone
const SINK_KEY = "__dsSinkApply";
export async function setSink(p, roles = sinkpick.rolesNow()) {
  if (!p || p.isClosed()) return null;
  let origin = null; try { origin = new URL(p.url()).origin; } catch { /* no page yet */ }
  if (origin && origin !== "null") await p.context().grantPermissions(["microphone", "speaker-selection"], { origin }).catch(() => p.context().grantPermissions(["microphone"], { origin }).catch(() => {}));
  sinkPages.add(p);
  try {
    // a page from before the helper existed gets it now (evaluated through DevTools, so the site's CSP doesn't block it)
    if (!(await p.evaluate((k) => Boolean(window[k]), SINK_KEY))) await p.evaluate(sinkpick.controllerSource({ key: SINK_KEY, exposeMedia: true }));
    return await p.evaluate(async ([k, cfg]) => { const pick = await window[k](cfg); return pick ? pick.label : null; }, [SINK_KEY, { ...sinkpick.config(roles), unlockLabels: true }]);
  } catch { return null; }
}
const sinkPages = new Set();              // media pages that play (Spotify, a YouTube watch page)
// The owner changed Dayspring's output (or the mixer went on/off): whatever plays in the media window moves too
settings.onChange((s, patch) => {
  if (!sinkpick.movesMedia(patch) || !sinkPages.size) return;
  const again = () => { for (const p of sinkPages) { if (p.isClosed()) sinkPages.delete(p); else setSink(p, sinkpick.rolesNow()).catch(() => {}); } };
  again();
  if (patch.mixer !== undefined) for (const ms of [2000, 6000]) setTimeout(again, ms).unref?.();   // the mixer starts in the background
});
export async function spotifySink(roles) { return setSink(pages.spotify, roles); }

// Glide Spotify's volume to a share of its normal level over ms (level 1 = normal, 0 = silent).
// pause: once it's silent, pause and put the volume back, so the next song doesn't start muted.
export async function spotifyFade(level, ms = 2500, { pause = false } = {}) {
  const p = pages.spotify;
  if (!p || p.isClosed()) return 0;
  const n = await p.evaluate(async ({ level, ms }) => {
    const els = [...[...new Set([...document.querySelectorAll("audio, video"), ...(window.__dsMedia ?? [])])]].filter((e) => !e.muted);
    for (const e of els) if (e.dataset.dsBase === undefined) e.dataset.dsBase = String(e.dataset.dsVol ?? e.volume);
    const from = els.map((e) => e.volume), steps = Math.max(1, Math.round(ms / 50));
    for (let i = 1; i <= steps; i++) {
      els.forEach((e, k) => { const to = Number(e.dataset.dsBase) * level; e.volume = Math.max(0, Math.min(1, from[k] + (to - from[k]) * (i / steps))); });
      await new Promise((r) => setTimeout(r, 50));
    }
    for (const e of els) { delete e.dataset.dsVol; if (level >= 1) delete e.dataset.dsBase; }
    return els.length;
  }, { level, ms }).catch(() => 0);
  if (pause) {
    await spotifyControl("pause").catch(() => {});
    await p.evaluate(() => { for (const e of [...new Set([...document.querySelectorAll("audio, video"), ...(window.__dsMedia ?? [])])]) if (e.dataset.dsBase !== undefined) { e.volume = Number(e.dataset.dsBase); delete e.dataset.dsBase; } }).catch(() => {});
  }
  return n;
}

// Set Spotify's volume in the media window (0–100), for the older hidden-window Spotify.
export async function spotifyVolume(pct) {
  const p = pages.spotify;
  if (!p || p.isClosed()) return false;
  return p.evaluate((v) => {
    const els = [...new Set([...document.querySelectorAll("audio, video"), ...(window.__dsMedia ?? [])])].filter((e) => !e.muted);
    for (const e of els) { e.volume = v; delete e.dataset.dsVol; delete e.dataset.dsBase; }
    return els.length;
  }, Math.max(0, Math.min(1, pct / 100))).catch(() => false);
}

// Lower Spotify under the assistant's voice, then bring it back.
export async function spotifyDuck(on) {
  const p = pages.spotify;
  if (!p || p.isClosed()) return false;
  return p.evaluate((duck) => {
    const els = [...[...new Set([...document.querySelectorAll("audio, video"), ...(window.__dsMedia ?? [])])]].filter((e) => !e.muted);
    for (const e of els) { if (duck) { e.dataset.dsVol = e.dataset.dsVol ?? String(e.volume); e.volume = Math.max(0.08, Number(e.dataset.dsVol) * 0.18); } else if (e.dataset.dsVol) { e.volume = Number(e.dataset.dsVol); delete e.dataset.dsVol; } }
    return els.length;
  }, on).catch(() => false);
}
