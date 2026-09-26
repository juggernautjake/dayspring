// Music and video stats: "my most watched YouTube channels", "my top artists", "what have I been listening to",
// and "find more like this". Sources:
//   - Dayspring's own play log (data/playlog.json): every song or video that played through Dayspring, with its
//     channel/artist and time (from the screen's player reports).
//   - The owner's real YouTube watch history, read (never changed) from youtube.com/feed/history in Dayspring's signed-in
//     media browser; cached for 30 minutes.
//   - Spotify's own stats (top artists/tracks over ~4 weeks, ~6 months or years, recently played) once Spotify is connected.
// Spotify no longer lets new apps use its recommendations or related-artists endpoints (since Nov 2024), so "more like
// this" for music is built from search and genres instead.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as spotifyApi from "./spotify-api.mjs";
import * as media from "./media.mjs";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "playlog.json");
let log = null, lastKey = "", saveT = 0;
export const deps = { media };      // swappable for tests
const load = () => (log ??= existsSync(FILE) ? (() => { try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return []; } })() : []);
const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { writeFileSync(FILE, JSON.stringify(load().slice(-5000))); } catch { /* not critical */ } }, 2000); };

// Called with each player report from the screen ({ source, title, artist, playing, videoId, uri, video })
export function observe(s = {}) {
  if (!s?.source || !s.title || !s.playing) return;
  const key = `${s.source}|${s.title}|${s.artist ?? ""}`;
  if (key === lastKey) return;
  lastKey = key;
  const src = String(s.source).startsWith("spotify") ? "spotify" : "youtube";
  load().push({ at: new Date().toISOString(), source: src, title: String(s.title).slice(0, 200), by: String(s.artist ?? "").slice(0, 120), videoId: s.videoId ?? null, video: Boolean(s.video) });
  saveSoon();
}
const since = (period) => {
  const d = { day: 1, week: 7, month: 31, year: 366, all: 36600 }[period] ?? 31;
  return Date.now() - d * 86400_000;
};
function rank(list, keyOf, top = 10) {
  const m = new Map();
  for (const x of list) { const k = keyOf(x); if (!k) continue; const e = m.get(k) ?? { name: k, count: 0, sample: x }; e.count++; m.set(k, e); }
  return [...m.values()].sort((a, b) => b.count - a.count).slice(0, top);
}

// ---- YouTube watch history (read only) ----------------------------------------------------------------------------
let hist = { at: 0, items: [], signedIn: null };
export async function youtubeHistory({ fresh = false } = {}) {
  if (!fresh && Date.now() - hist.at < 30 * 60_000 && hist.items.length) return hist;
  let browser;
  try { browser = await import("./browser.mjs"); } catch { return { ...hist, error: "The media browser isn't available." }; }
  try {
    // needs the owner's YouTube sign-in, so the media window; only when they ask, and kept minimised throughout
    const p = await browser.page("ythistory");
    await browser.windowState(p, "minimized");
    await p.goto("https://www.youtube.com/feed/history", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await p.waitForTimeout(2500);
    if (/accounts\.google\.com|ServiceLogin/.test(p.url()) || await p.$('a[href*="ServiceLogin"], tp-yt-paper-button#button[aria-label*="Sign in"]')) { hist = { at: Date.now(), items: [], signedIn: false }; await browser.hide(); return hist; }
    for (let i = 0; i < 6; i++) { await p.evaluate(() => window.scrollBy(0, 4000)); await p.waitForTimeout(900); }
    const items = await p.evaluate(() => {
      const out = [], seen = new Set();
      for (const a of document.querySelectorAll('a[href*="/watch?v="]')) {
        const id = /[?&]v=([\w-]{11})/.exec(a.getAttribute("href") ?? "")?.[1];
        const title = (a.getAttribute("title") || a.textContent || "").replace(/\s+/g, " ").trim();
        if (!id || !title || seen.has(id)) continue;
        const box = a.closest("ytd-video-renderer, yt-lockup-view-model, ytd-rich-item-renderer, ytd-grid-video-renderer") ?? a.parentElement?.parentElement;
        const ch = box?.querySelector('ytd-channel-name a, a[href^="/@"], a[href^="/channel/"], .yt-content-metadata-view-model-wiz__metadata-text, [class*="metadata"] a')?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        seen.add(id); out.push({ videoId: id, title, channel: ch });
      }
      return out;
    });
    await browser.hide();
    hist = { at: Date.now(), items, signedIn: true };
    return hist;
  } catch (e) { return { ...hist, error: `I couldn't read your YouTube history (${e.message.slice(0, 80)}).` }; }
}

// tests: pretend this is the watch history (no browser)
export function _setHistory(items, signedIn = true) { hist = { at: Date.now(), items, signedIn }; }
export function _resetLog() { log = []; lastKey = ""; }
export async function youtubeInsights({ period = "month", top = "channels", limit = 10 } = {}) {
  const mine = load().filter((x) => x.source === "youtube" && Date.parse(x.at) >= since(period));
  const h = await youtubeHistory().catch(() => ({ items: [] }));
  const hItems = h.items ?? [];
  const pool = [...mine.map((x) => ({ channel: x.by, title: x.title, videoId: x.videoId })), ...hItems];
  const ranked = top === "videos" ? rank(pool, (x) => x.title, limit) : rank(pool, (x) => (x.channel && x.channel !== "YouTube" ? x.channel : null), limit);
  return {
    top, period, fromDayspring: mine.length, fromYouTubeHistory: hItems.length, youtubeSignedIn: h.signedIn,
    note: h.signedIn === false ? "YouTube isn't signed in inside Dayspring's media browser, so this only counts what played through Dayspring. Say \"sign in to YouTube\" to include your whole watch history." : undefined,
    items: ranked.map((r) => ({ title: r.name, detail: `${r.count} ${r.count === 1 ? "video" : "videos"}${top === "videos" && r.sample.channel ? " · " + r.sample.channel : ""}`, videoId: top === "videos" ? r.sample.videoId : null, count: r.count })),
  };
}

export async function musicInsights({ kind = "artists", range = "medium_term", limit = 10 } = {}) {
  const r = { short: "short_term", month: "short_term", medium: "medium_term", "6months": "medium_term", long: "long_term", year: "long_term", all: "long_term" }[range] ?? range;
  const st = spotifyApi.status();
  if (st.signedIn) {
    try {
      if (kind === "recent") return { source: "Spotify", kind, items: (await spotifyApi.recentlyPlayed(Math.min(50, limit))).map((t) => ({ title: t.name, detail: t.by, spotifyUri: t.uri, thumb: t.art })) };
      if (kind === "saved") return { source: "Spotify", kind, items: (await spotifyApi.likedTracks(Math.min(50, limit))).map((t) => ({ title: t.name, detail: t.by, spotifyUri: t.uri, thumb: t.art })) };
      if (!spotifyApi.hasScope("user-top-read")) throw Object.assign(new Error("scope"), { scope: true });
      const items = await spotifyApi.topItems(kind === "tracks" ? "tracks" : "artists", r, limit);
      return { source: "Spotify", kind, range: r, items: items.map((x) => kind === "tracks" ? { title: x.name, detail: x.by, spotifyUri: x.uri, thumb: x.art } : { title: x.name, detail: x.genres.slice(0, 3).join(", "), spotifyUri: x.uri, url: x.url, thumb: x.art }) };
    } catch (e) {
      if (e.scope || e.status === 403) return { ...fromLog(kind, limit), note: "Spotify needs one more permission for your top artists and songs. Say \"sign in to Spotify\" once more to allow it; until then this counts what played through Dayspring." };
      return { ...fromLog(kind, limit), note: e.message };
    }
  }
  return { ...fromLog(kind, limit), note: st.configured ? "Spotify isn't signed in yet (say \"sign in to Spotify\"); this counts what played through Dayspring." : "Spotify isn't connected, so this counts what played through Dayspring." };
}
function fromLog(kind, limit) {
  const all = load().filter((x) => x.source === "spotify" || !x.video);     // music: songs, not videos with the picture
  const ranked = kind === "tracks" || kind === "recent" || kind === "saved" ? rank(all, (x) => x.title, limit) : rank(all, (x) => x.by, limit);
  return { source: "Dayspring's play log", kind, items: ranked.map((r) => ({ title: r.name, detail: `${r.count} play${r.count === 1 ? "" : "s"}${kind !== "artists" && r.sample.by ? " · " + r.sample.by : ""}`, videoId: r.sample.videoId ?? null })) };
}

// "Find more like this": videos (same channel/topic, not already watched) or music (same genres/artists, via search)
export async function moreLike({ kind = "video", seed = "", limit = 8 } = {}) {
  if (kind === "music") {
    let genres = [], artist = seed;
    if (spotifyApi.status().signedIn) {
      try {
        if (!artist) artist = (await spotifyApi.topItems("artists", "short_term", 1))[0]?.name ?? "";
        const a = artist ? (await spotifyApi.search(artist, "artist", 1))[0] : null;
        if (a) { const full = await spotifyApi.api("GET", `/artists/${a.uri.split(":").pop()}`).catch(() => null); genres = full?.genres ?? []; }
        const qs = genres.length ? genres.slice(0, 2).map((g) => `genre:"${g}"`) : [artist];
        const seen = new Set(), items = [];
        for (const q of qs) for (const t of await spotifyApi.search(q, "track", 10).catch(() => [])) {
          if (items.length >= limit || seen.has(t.uri) || (artist && t.by.toLowerCase().includes(artist.toLowerCase()))) continue;
          seen.add(t.uri); items.push({ title: t.name, detail: t.by, spotifyUri: t.uri, thumb: t.art });
        }
        if (items.length) return { source: "Spotify", seed: artist, genres, items };
      } catch { /* fall back to YouTube */ }
    }
    const v = await deps.media.searchYouTube({ query: `${seed || "relaxing music"} similar artists mix`, max: limit }).catch(() => []);
    return { source: "YouTube", seed, items: v.filter((x) => x.videoId).slice(0, limit).map((x) => ({ title: x.title, detail: x.channel, videoId: x.videoId })) };
  }
  // videos
  let s = seed;
  if (!s) { const np = media.playerState(); s = np?.source === "youtube" ? [np.artist, np.title].filter(Boolean).join(" ") : load().filter((x) => x.source === "youtube").at(-1)?.by ?? ""; }
  if (!s) return { items: [], note: "Tell me what it should be like (a channel, a topic or a video)." };
  const watched = new Set([...media.playedIds(), ...(hist.items ?? []).map((x) => x.videoId), ...load().map((x) => x.videoId).filter(Boolean)]);
  const found = await deps.media.searchYouTube({ query: s, max: 25 }).catch(() => []);
  const items = found.filter((x) => x.videoId && !watched.has(x.videoId)).slice(0, limit).map((x) => ({ title: x.title, detail: [x.channel, x.length, x.views].filter(Boolean).join(" · "), videoId: x.videoId }));
  return { source: "YouTube", seed: s, items };
}

export const TOOLS = [
  { name: "youtube_insights", description: "The owner's most-watched YouTube channels or videos (from their YouTube watch history plus what played through Dayspring). Show the result with show_results.",
    input_schema: { type: "object", properties: { top: { type: "string", enum: ["channels", "videos"] }, period: { type: "string", enum: ["day", "week", "month", "year", "all"] }, limit: { type: "integer" } } } },
  { name: "music_insights", description: "The owner's music stats: top artists or top tracks from Spotify (range short = ~4 weeks, medium = ~6 months, long = years), recently played, or saved songs; falls back to what played through Dayspring. Show the result with show_results.",
    input_schema: { type: "object", properties: { kind: { type: "string", enum: ["artists", "tracks", "recent", "saved"] }, range: { type: "string", enum: ["short", "medium", "long"] }, limit: { type: "integer" } } } },
  { name: "more_like_this", description: "Find more music or videos like something (the one playing, an artist, a channel or a topic), skipping ones already watched. Show the result with show_results (items get ▶ play buttons).",
    input_schema: { type: "object", properties: { kind: { type: "string", enum: ["video", "music"] }, seed: { type: "string", description: "An artist, channel, song, video or topic; empty = what's playing / recent" }, limit: { type: "integer" } } } },
];
export async function runTool(name, input = {}) {
  if (name === "youtube_insights") return youtubeInsights(input);
  if (name === "music_insights") return musicInsights(input);
  if (name === "more_like_this") return moreLike(input);
  return undefined;
}
