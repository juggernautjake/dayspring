// Music and video on the TV. The server decides what to play (and whether now is an okay time);
// the TV page does the playing. YouTube is searched by reading youtube.com's results page (ytsearch.mjs: no browser
// window, no key needed) and played inside Dayspring; Spotify plays in the media browser's web player.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "./store.mjs";
import * as browser from "./browser.mjs";
import * as ytsearch from "./ytsearch.mjs";
import * as settings from "./settings.mjs";
import * as mixer from "./voicemeeter.mjs";
import { phrase } from "./phrases.mjs";
import * as spotifyApi from "./spotify-api.mjs";
import * as music from "./music/index.mjs";
import { broadcast, clientCount } from "./bus.mjs";
import { writeJSONAtomic } from "./atomic.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FILE = join(here, "..", "data", "media.json");
const SOUNDS = join(here, "..", "public", "sounds");
const YT_KEY = () => process.env.YOUTUBE_API_KEY ?? "";

let db = null;
function load() { if (!db) db = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { played: [], nowPlaying: null }; return db; }
function save() { writeJSONAtomic(FILE, db, 2); }

// ---- the study rule --------------------------------------------------------------------

// During a study block: music yes, videos no.
export function policyNow(date = new Date()) {
  const today = store.todayISO(date);
  const hm = date.toTimeString().slice(0, 5);
  const cur = store.blocksBetween(today, today).find((b) => b.start <= hm && hm < b.end);
  const studying = Boolean(cur && cur.category === "study");
  return { block: cur ? { title: cur.title, start: cur.start, end: cur.end, category: cur.category } : null, videosAllowed: !studying, musicAllowed: true, reason: studying ? `It's ${cur.title} until ${cur.end}.` : null };
}

// ---- YouTube ---------------------------------------------------------------------------

// Pull a video id or playlist id out of anything the owner might say or paste.
export function parseYouTube(s) {
  const t = String(s ?? "").trim();
  const list = /[?&]list=([A-Za-z0-9_-]{10,})/.exec(t)?.[1] ?? (/^(PL|UU|OL|RD|LL)[A-Za-z0-9_-]{10,}$/.test(t) ? t : null);
  const vid = /(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/.exec(t)?.[1] ?? (/^[A-Za-z0-9_-]{11}$/.test(t) ? t : null);
  return { videoId: vid, playlistId: list };
}

export function playedIds() { return new Set(load().played.map((p) => p.id)); }

export async function searchYouTube({ query, recentDays, popular = false, unseen = false, max = 8, kind = "video", newest = false }) {
  if (!YT_KEY()) {
    // the usual way: read youtube.com's results page (no window opens; a headless browser only if YouTube insists)
    const seen = unseen ? playedIds() : new Set();
    const found = await ytsearch.search(query, { recentDays, popular, kind, newest, max: 25 });
    return found.filter((x) => !seen.has(x.videoId ?? x.playlistId) && !(kind === "video" && x.live && !/live/i.test(query))).slice(0, max);
  }
  const p = new URLSearchParams({ part: "snippet", q: query, type: kind, maxResults: "25", key: YT_KEY(), safeSearch: "moderate", relevanceLanguage: "en" });
  if (popular) p.set("order", "viewCount");
  if (newest) p.set("order", "date");
  if (recentDays) p.set("publishedAfter", new Date(Date.now() - recentDays * 86400000).toISOString());
  if (kind === "video") p.set("videoEmbeddable", "true");
  const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${p}`, { signal: AbortSignal.timeout(15_000) });
  const j = await r.json();
  if (!r.ok) throw new Error(`YouTube search failed: ${j.error?.message ?? r.status}`);
  const seen = unseen ? playedIds() : new Set();
  return (j.items ?? [])
    .map((it) => ({ videoId: it.id.videoId ?? null, playlistId: it.id.playlistId ?? null, title: decode(it.snippet.title), channel: it.snippet.channelTitle, published: it.snippet.publishedAt?.slice(0, 10) }))
    .filter((x) => !seen.has(x.videoId ?? x.playlistId))
    .slice(0, max);
}
const decode = (s) => String(s).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

// Decide what to play and check it against the study rule. Returns the command for the TV.
export function playCommand({ videoId, playlistId, title, audioOnly = false, shuffle = false }) {
  const pol = policyNow();
  if (!audioOnly && !pol.videosAllowed) {
    const e = new Error(`${phrase("noVideoStudy")} ${pol.reason}`);
    e.policy = pol;
    throw e;
  }
  if (!videoId && !playlistId) throw new Error("Nothing to play: give a video or playlist link, or search first.");
  const cmd = { action: "play", provider: "youtube", videoId: videoId ?? null, playlistId: playlistId ?? null, title: title ?? null, audioOnly: Boolean(audioOnly), shuffle: Boolean(shuffle), at: new Date().toISOString() };
  load().nowPlaying = cmd;
  save();
  return cmd;
}

export function recordPlayed({ id, title }) {
  const d = load();
  if (!id) return;
  d.played.push({ id, title: title ?? "", at: new Date().toISOString() });
  if (d.played.length > 2000) d.played.splice(0, d.played.length - 2000);
  save();
}
export function stopCommand() { load().nowPlaying = null; save(); return { action: "stop" }; }
export function nowPlaying() { return load().nowPlaying; }
// his own files or Google Drive playing on the screen (lib/medialib/player.mjs): "what's playing" knows it too
export function noteNowPlaying({ provider = "local", title = "", artist = "" } = {}) { load().nowPlaying = { action: "play", provider, title, artist, at: new Date().toISOString() }; }   // (kept with the next save)
export function recentlyPlayed(n = 10) { return load().played.slice(-n).reverse(); }

// Search and play the best match in one step: "a recent popular cooking video I haven't seen".
export async function findAndPlay({ query, recentDays = 0, popular = false, unseen = true, kind = "video", audioOnly = false }) {
  const results = await searchYouTube({ query, recentDays, popular, unseen, kind, max: 5 });
  if (!results.length) throw new Error(`Nothing on YouTube matched "${query}"${unseen ? " that you haven't already seen" : ""}.`);
  const pick = results[0];
  const cmd = playCommand({ videoId: pick.videoId, playlistId: pick.playlistId, title: pick.title, audioOnly });
  cmd.channel = pick.channel ?? "";
  // the next-best matches travel with it, so "next video" on the screen has somewhere to go
  cmd.others = results.slice(1, 6).map((x) => ({ videoId: x.videoId ?? null, playlistId: x.playlistId ?? null, title: x.title, channel: x.channel ?? "" }));
  return { cmd, pick, others: results.slice(1, 4) };
}

// ---- the player on the Dayspring screen ---------------------------------------------------------------------------
// The screen plays YouTube (embedded) and, once the owner connects Spotify, Spotify itself (the Web Playback SDK makes the
// screen a Spotify device called "Dayspring"). It reports what's playing here; controls from the AI, the desk page or
// a phrase the server heard are sent to the screen, which applies them to whichever player is active.
let screenDevice = null, screenState = null;
export function setDevice(id) { screenDevice = id || null; }
export const device = () => screenDevice;
export function setState(s) { screenState = s && s.source ? { ...s, at: new Date().toISOString() } : null; }
export const playerState = () => screenState;
// Spotify inside Dayspring can be used right now: connected, and the screen has registered its player
export const spotifyInApp = () => spotifyApi.ready() && Boolean(screenDevice);

// action: pause | resume | toggle | next | previous | restart | seek (value s) | seekBy (value ±s) | volume (value 0–100) |
//         volumeBy (value ±) | shuffle (value bool) | repeat (value off|track|context) | speed (value rate) | speedBy (±1 step) |
//         video (value bool: show the video) | full | stop
export async function control(action, value) {
  if (screenState?.source && clientCount() > 0) { broadcast("player", { action, value }); return { sent: action, value: value ?? null, now: screenState }; }
  // nothing on the screen: the older hidden-window Spotify, if it's open
  if (["pause", "resume", "next", "previous"].includes(action)) return browser.spotifyControl(action);
  if (action === "toggle") { const n = await browser.spotifyNow(); return browser.spotifyControl(n.playing ? "pause" : "resume"); }
  if (action === "volume" || action === "volumeBy") {
    const s = settings.set(action === "volume" ? { musicVolume: Number(value) } : { musicVolumeDelta: Number(value) });
    await browser.spotifyVolume(s.musicVolume);
    return { volume: s.musicVolume };
  }
  if (action === "stop") return stopAll();
  throw new Error("Nothing is playing on the Dayspring screen right now.");
}

// Spotify is music, so it is always allowed, study blocks included.
// Inside Dayspring (the screen's own Spotify player) when it's connected; otherwise the older hidden media window.
export async function spotify(opts) {
  if (spotifyInApp()) {
    try {
      // lib/music: understand the request, pick and check the best match, play it, confirm it's what's playing
      const pick = await music.request(opts, music.apiPlayer(screenDevice));
      if (pick.clarify || pick.exhausted) return { ...pick, inApp: true };      // "Did you mean…?" / nothing left to try
      if (pick.source && pick.source !== "spotify") return pick;               // a registered source (his files, Drive) played it itself
      if (browser.isOpen()) browser.spotifyControl("pause").catch(() => {});    // never two Spotifys at once
      load().nowPlaying = { action: "play", provider: "spotify", title: pick.nowPlaying?.title || pick.title, artist: pick.nowPlaying?.artist || pick.artist, art: pick.art, query: opts.query ?? opts.request, type: opts.type, at: new Date().toISOString() };
      save();
      return { ...pick, title: pick.title ?? "", artist: pick.artist ?? "", art: pick.art ?? "", playing: true, inApp: true };
    } catch (e) {
      // the screen's player went away (screen closed or reloading): fall back to the media window. (Something Spotify
      // won't play there is not that: e.unplayable, and the next candidate was already tried.)
      if (e.unplayable || !(e.reason === "NO_ACTIVE_DEVICE" || e.status === 404)) throw e;
      screenDevice = null;
    }
  }
  // the media window: the same resolver, reading Spotify's web player search pages
  const picked = await music.request(opts, music.windowPlayer(browser.spotifyWindow()));
  if (picked.clarify || picked.exhausted) return picked;
  if (picked.source && picked.source !== "spotify") return picked;
  const r = picked.window ? { ...picked.window, ...picked, title: picked.window.title || picked.title, artist: picked.window.artist || picked.artist, art: picked.window.art || picked.art } : picked;
  delete r.window;
  if (clientCount() > 0) broadcast("player", { action: "pause", only: "spotify" });
  r.output = await browser.spotifySink(mixer.isActive() ? ["voicemeeter"] : settings.get().audioOutputs);   // the mixer sends Windows' default where the owner picked
  load().nowPlaying = { action: "play", provider: "spotify", title: r.title, artist: r.artist, art: r.art, query: opts.query, type: opts.type, at: new Date().toISOString() };
  save();
  return r;
}

// Stop everything: the TV's player, Spotify, and a video playing in the media browser.
export async function stopAll() {
  const out = { tv: true, spotify: false, watch: false };
  if (browser.isOpen()) {
    out.spotify = await browser.spotifyControl("pause").then(() => true).catch(() => false);
    out.watch = await browser.youtubeWatchStop().catch(() => false);
  }
  stopCommand();
  return out;
}

// ---- sound bites ------------------------------------------------------------------------

// Built into the TV page (synthesised), plus any .mp3/.wav dropped into public/sounds.
export const BUILTIN_SOUNDS = ["chime", "ding", "done", "levelup", "fanfare", "drumroll", "whoosh", "alarm", "oops", "applause"];
export function sounds() {
  let files = [];
  try { files = readdirSync(SOUNDS).filter((f) => /\.(mp3|wav|ogg)$/i.test(f)); } catch { /* no folder yet */ }
  return { builtin: BUILTIN_SOUNDS, files: files.map((f) => ({ name: f.replace(/\.[^.]+$/, ""), url: `/sounds/${encodeURIComponent(f)}` })) };
}

// ---- Spotify ----------------------------------------------------------------------------

export async function spotifyStatus() {
  const inApp = { ...spotifyApi.status(), screenPlayer: Boolean(screenDevice) };
  if (!browser.isOpen()) return { inApp, window: { signedIn: null, note: "media browser not started yet" } };
  return { inApp, window: { signedIn: await browser.spotifyLoggedIn().catch(() => null), now: await browser.spotifyNow() } };
}
