// The Music & Video browser: one window over Spotify, YouTube, his own files and Google Drive (public/mediabrowser.js).
//   status() · section(q) · search(q) · page(q) · act(body)                 what the window asks (routes.mjs)
//   setView(v) · shownAt()                                                  what the window shows, numbered, for voice
//   command(text) → { reply, listen? } | null                               the no-AI words ("show my liked songs",
//        "what did I listen to yesterday", "search YouTube for …", "play number 3" on whatever list is showing)
//   TOOLS / runTool(name, input)                                            the AI's tools
// Playing goes through what Dayspring already has, so the study-time rule (media.policyNow: no videos in a study block)
// and the chosen output device apply as everywhere: Spotify through media.spotify / the screen's player, YouTube through
// the video queue (lib/video), his files through lib/medialib/player.mjs.
// Gated by the "mediabrowser" feature (lib/features.mjs).
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as media from "../media.mjs";
import * as spotifyApi from "../spotify-api.mjs";
import { on as featureOn } from "../features.mjs";
import { broadcast as busBroadcast } from "../bus.mjs";
import { writeJSONAtomic } from "../atomic.mjs";
import * as S from "./spotify.mjs";
import * as Y from "./youtube.mjs";
import * as L from "./local.mjs";

export { S as spotify, Y as youtube, L as local };
export const FEATURE = "mediabrowser";
export const enabled = () => featureOn(FEATURE);

let deps = {
  broadcast: busBroadcast,
  video: () => import("../video/index.mjs"),
  player: () => import("../medialib/player.mjs"),
  signin: () => import("../mediasignin.mjs"),
  browser: () => import("../browser.mjs"),
  videolists: () => import("../videolists.mjs"),
  // when other numbered lists were last shown (the newest one on the screen gets "number 3")
  othersAt: async () => {
    let t = 0;
    try { const v = await import("../video/index.mjs"); const s = v.state(); if (s.grid && !s.grid.closed) t = Math.max(t, s.grid.at ?? 0); t = Math.max(t, s.queueShownAt ?? 0); } catch { /* none */ }
    try { const ir = await import("../image-routes.mjs"); const v = ir.current(); if (v && !v.closed) t = Math.max(t, v.at ?? 0); } catch { /* none */ }
    try { const g = await import("../gifs/routes.mjs"); const v = g.current(); if (v && !v.closed) t = Math.max(t, v.at ?? 0); } catch { /* none */ }
    try { const m = await import("../medialib/skills.mjs"); const v = m.lastShown(); if (v) t = Math.max(t, v.at ?? 0); } catch { /* none */ }
    return t;
  },
  now: () => new Date(),
};
export function _setDeps(d) { deps = { ...deps, ...d }; }
const broadcast = (...a) => deps.broadcast(...a);

// ---- sections --------------------------------------------------------------------------------------------------------------
export const SECTIONS = {
  spotify: [
    { id: "now", title: "Now playing", icon: "▶" }, { id: "playlists", title: "Playlists", icon: "☰" }, { id: "liked", title: "Liked Songs", icon: "♥" },
    { id: "albums", title: "Saved albums", icon: "◉" }, { id: "artists", title: "Followed artists", icon: "★" }, { id: "top", title: "Top artists & songs", icon: "▲" },
    { id: "recent", title: "Recently played", icon: "⟲" }, { id: "queue", title: "Queue", icon: "≡" },
  ],
  youtube: [
    { id: "history", title: "Watch history", icon: "⟲" }, { id: "playlists", title: "Your playlists", icon: "☰" }, { id: "liked", title: "Liked videos", icon: "♥" },
    { id: "watchlater", title: "Watch later", icon: "⏱" }, { id: "subscriptions", title: "Subscriptions", icon: "★" }, { id: "queue", title: "Queue", icon: "≡" },
  ],
  local: [{ id: "recent", title: "Recently added", icon: "⟲" }, { id: "songs", title: "Songs", icon: "♪" }, { id: "albums", title: "Albums", icon: "◉" }, { id: "artists", title: "Artists", icon: "★" }, { id: "videos", title: "Videos", icon: "▶" }],
  drive: [{ id: "recent", title: "Recent in Drive", icon: "⟲" }],
};
export const SOURCES = ["spotify", "youtube", "local", "drive"];
const SOURCE_NAME = { spotify: "Spotify", youtube: "YouTube", local: "My files", drive: "Drive" };
// an error → what the window shows instead of a list
function problem(e) {
  return { items: [], next: null, total: 0, error: e.message, ...(e.needsScopes ? { needsScopes: e.needsScopes } : {}), ...(e.signIn ? { signIn: e.signIn } : {}), ...(e.connect ? { connect: true } : {}), ...(e.unavailable ? { unavailable: true } : {}) };
}

export async function status() {
  let signin = { youtube: null, spotify: null };
  try { signin = (await deps.signin()).status(); } catch { /* fine */ }
  const sp = spotifyApi.status();
  const allNeeded = [...new Set(Object.values(spotifyApi.NEEDS).flat())];
  let local = null; try { local = L.status(); } catch { local = null; }
  return {
    sources: {
      spotify: { api: { ...sp, missing: sp.signedIn ? spotifyApi.missingScopes(allNeeded) : [] }, web: signin.spotify, inApp: media.spotifyInApp?.() ?? false },
      youtube: { web: signin.youtube },
      local, drive: { connected: Boolean(local?.drive) },
    },
    sections: SECTIONS, recent: recentSearches(), policy: (() => { const p = media.policyNow(); return { videosAllowed: p.videosAllowed, reason: p.reason }; })(),
  };
}

// q: { source, section, cursor, range, type, filter, day, query, id, title }
export async function section(q = {}) {
  const src = q.source, sec = q.section, cursor = q.cursor ?? null;
  try {
    if (src === "spotify") {
      switch (sec) {
        case "playlists": return await S.playlists({ cursor, filter: q.filter ?? "all" });
        case "liked": return await S.liked({ cursor });
        case "albums": return await S.albums({ cursor });
        case "artists": return await S.artists({ cursor });
        case "top": return await S.top({ type: q.type === "artists" ? "artists" : "tracks", range: q.range ?? "short", cursor });
        case "recent": return await S.recent({ cursor, day: q.day ?? null });
        case "queue": return await S.queue();
        case "now": { const n = await S.now(); return { items: n.item ? [n.item] : [], next: null, total: n.item ? 1 : 0, now: n }; }
      }
    } else if (src === "youtube") {
      switch (sec) {
        case "history": return await Y.history({ cursor, query: q.query ?? "" });
        case "playlists": return await Y.playlists();
        case "liked": return await Y.liked({ cursor });
        case "watchlater": return await Y.watchLater({ cursor });
        case "subscriptions": return await Y.subscriptions({ cursor, what: q.type === "channels" ? "channels" : "videos" });
        case "queue": return await Y.queue();
      }
    } else if (src === "local") return await L.section(sec, { cursor });
    else if (src === "drive") return await L.driveSection({ cursor });
    return problem(new Error("There's no such list."));
  } catch (e) { return problem(e); }
}

// { source, q, only, from, filters, have }
export async function search(q = {}) {
  const words = String(q.q ?? "").trim().slice(0, 200);
  if (!words) return { groups: [] };
  if (q.remember !== false && !q.from) remember(words, q.source);
  try {
    if (q.source === "spotify") return await S.search(words, { only: q.only ?? null, from: q.from ?? 0 });
    if (q.source === "youtube") return await Y.search(words, { only: q.only ?? null, from: q.from ?? 0, filters: q.filters ?? {}, have: q.have ?? [] });
    if (q.source === "local") return await L.search(words, { only: q.only ?? null });
    if (q.source === "drive") return await L.driveSearch(words);
    return { groups: [] };
  } catch (e) { return { groups: [], ...problem(e) }; }
}

// a page inside the browser: { source, kind, id, … } → { head, items | groups, next, url? }
export async function page(q = {}) {
  try {
    if (q.source === "spotify") {
      if (q.kind === "artist") return await S.artistPage(q.id);
      if (q.kind === "album") return await S.albumPage(q.id, { cursor: q.cursor });
      if (q.kind === "playlist") return await S.playlistPage(q.id, { cursor: q.cursor });
      if (q.kind === "genre") return { head: { key: `genre:${q.genre}`, source: "spotify", kind: "genre", title: q.title ?? q.genre, sub: "Playlists for this genre or mood", request: q.request }, ...(await S.search(String(q.genre ?? q.title ?? ""), { only: "playlist" })) };
    }
    if (q.source === "youtube") {
      if (q.kind === "channel") return await Y.channelPage({ channelId: q.channelId ?? q.id, handle: q.handle, title: q.title });
      if (q.kind === "ytplaylist") {
        const mine = ["LL", "WL"].includes(q.playlistId) || q.mine;
        const r = mine ? await Y.playlistItems(q.playlistId, { cursor: q.cursor, title: q.title }) : await Y.publicPlaylistPage(q.playlistId).catch(() => Y.playlistItems(q.playlistId, { cursor: q.cursor, title: q.title }));
        return { head: r.head ?? { key: `ytp:${q.playlistId}`, source: "youtube", kind: "ytplaylist", playlistId: q.playlistId, title: q.title ?? "Playlist", sub: `${r.total ?? r.items.length} videos` }, ...r };
      }
    }
    if (q.source === "local" && (q.kind === "localalbum" || q.kind === "localartist")) return L.groupPage(q);
    return problem(new Error("That can't be opened here."));
  } catch (e) { return problem(e); }
}

// ---- actions ---------------------------------------------------------------------------------------------------------------
const clip = (s, n = 60) => (String(s ?? "").length > n ? String(s).slice(0, n - 1).trimEnd() + "…" : String(s ?? ""));
const sp = (it) => it && it.source === "spotify";
// what the browser sends back, cleaned: only the fields each kind needs, only well-formed ids
function clean(it) {
  if (!it || typeof it !== "object") return null;
  const str = (v, n = 300) => (v == null ? undefined : String(v).slice(0, n));
  const o = { source: SOURCES.includes(it.source) ? it.source : null, kind: str(it.kind, 20), title: str(it.title), sub: str(it.sub), by: str(it.by) };
  if (/^spotify:(track|album|playlist|artist|episode|show):[A-Za-z0-9]+$/.test(it.uri ?? "")) o.uri = it.uri;
  if (/^[A-Za-z0-9]{6,40}$/.test(it.id ?? "")) o.id = it.id;
  if (/^spotify:(album|playlist|artist):[A-Za-z0-9]+$/.test(it.context ?? "")) o.context = it.context;
  if (/^[\w-]{11}$/.test(it.videoId ?? "")) o.videoId = it.videoId;
  if (/^[\w-]{2,64}$/.test(it.playlistId ?? "")) o.playlistId = it.playlistId;
  if (/^UC[\w-]{10,40}$/.test(it.channelId ?? "")) o.channelId = it.channelId;
  if (/^@[\w.-]{2,60}$/.test(it.handle ?? "")) o.handle = it.handle;
  if (/^[a-f0-9]{16}$/.test(it.fileId ?? "")) o.fileId = it.fileId;
  if (/^[\w:.-]{3,200}$/.test(it.ref ?? "")) o.ref = it.ref;
  if (typeof it.removeToken === "string" && it.removeToken.length < 2000 && /^[\w%=+/-]+$/.test(it.removeToken)) o.removeToken = it.removeToken;
  for (const k of ["genre", "request", "album", "artist", "media", "channel", "length"]) if (it[k] != null) o[k] = str(it[k], 200);
  if (Number.isFinite(Number(it.secs))) o.secs = Number(it.secs);
  if (it.fromPlaylist && /^[\w-]{2,64}$/.test(it.fromPlaylist)) o.fromPlaylist = it.fromPlaylist;
  return o.source ? o : null;
}
const videoOf = (x) => ({ videoId: x.videoId, title: x.title, channel: x.channel ?? String(x.sub ?? "").split(" · ")[0] ?? "", secs: x.secs ?? null, length: x.length ?? "" });

async function playSpotify(list) {
  const first = list[0];
  if (first.kind === "genre") { const r = await media.spotify({ request: first.request ?? `play ${first.genre ?? first.title} music` }); return { reply: r.say || `Playing ${first.title}.` }; }
  const tracks = list.filter((x) => x.kind === "track" || x.kind === "episode").map((x) => x.uri).filter(Boolean);
  if (media.spotifyInApp()) {
    const dev = media.device();
    if (tracks.length && list.length === tracks.length) {
      // one song from an album or playlist: that list plays on from it
      if (tracks.length === 1 && first.context) await spotifyApi.play(dev, { context_uri: first.context, offset: { uri: first.uri } });
      else await spotifyApi.play(dev, { uris: tracks.slice(0, 100) });
    } else if (first.uri) await spotifyApi.play(dev, first.kind === "track" || first.kind === "episode" ? { uris: [first.uri] } : { context_uri: first.uri });
    else throw new Error("That can't be played.");
    return { reply: list.length > 1 && tracks.length > 1 ? `Playing ${tracks.length} songs, starting with ${clip(first.title)}.` : `Playing ${clip(first.title)}${first.by ? ` by ${first.by}` : ""}.` };
  }
  // the media window's web player: the thing itself, by its link
  const r = await media.spotify({ url: first.uri, query: first.title, type: first.kind });
  return { reply: r.say || `Playing ${clip(first.title)}.` };
}
async function queueSpotify(list, next) {
  if (!media.spotifyInApp()) throw new Error("Queueing Spotify songs needs Spotify playing on the Dayspring screen (connect Spotify in Settings → Apps & connections).");
  const uris = list.filter((x) => x.kind === "track" || x.kind === "episode").map((x) => x.uri);
  if (!uris.length) throw new Error("Only songs can be queued on Spotify.");
  for (const u of uris.slice(0, 50)) await spotifyApi.addToQueue(u, media.device());
  // (Spotify's queue has no "play next" slot: queued songs play after what's playing, after anything queued before them)
  return { reply: `${next ? "Up next" : "Added to the queue"}: ${uris.length === 1 ? clip(list[0].title) : `${uris.length} songs`}.${next && uris.length ? "" : ""}` };
}
async function playYouTube(list) {
  const v = await deps.video();
  const first = list[0];
  if (first.kind === "ytplaylist") return v.playlistPlay({ playlistId: first.playlistId, title: first.title });
  if (first.kind === "channel") return v.play({ kind: "creator", creator: first.title, query: "", filters: {} });
  const vids = list.filter((x) => x.videoId);
  if (!vids.length) throw new Error("That can't be played.");
  v.startItem(videoOf(vids[0]));
  if (vids.length > 1) await v.addItems(vids.slice(1).map(videoOf), { next: true });
  return { reply: `Playing ${clip(vids[0].title)}${vids.length > 1 ? `, and ${vids.length - 1} more after it` : ""}.` };
}
async function playFiles(list, { queue = false, next = false } = {}) {
  const files = await L.resolveItems(list);
  if (!files.length) throw new Error("Those files aren't in your library anymore.");
  const p = await deps.player();
  const r = queue ? p.enqueue(files, { next, playing: media.playerState()?.source === "file" }) : p.play(files, { index: 0, via: "browser" });
  if (r.error) throw new Error(r.error);
  return { reply: r.reply ?? "" };
}

// { action: play|next|queue|like|unlike|addToPlaylist|removeHistory|webplayer|playlists, items: [...], playlistId, url }
export async function act(body = {}) {
  const a = String(body.action ?? "");
  const items = (Array.isArray(body.items) ? body.items : body.item ? [body.item] : []).map(clean).filter(Boolean).slice(0, 200);
  try {
    if (a === "webplayer") { const b = await deps.browser(); const r = await b.spotifyOpenInWindow(String(body.url ?? "")); return { ok: true, ...r, reply: "It's open in the Spotify web player in Dayspring's media window." }; }
    if (a === "playlists") return { ok: true, playlists: await S.writablePlaylists() };
    if (a === "videolists") return { ok: true, playlists: (await deps.videolists()).all().map((l) => ({ id: l.id, title: l.name, total: l.items.length })) };
    if (!items.length) throw new Error("Pick something first.");
    const src = items[0].source;
    if (items.some((x) => x.source !== src)) throw new Error("Pick things from one place at a time.");
    if (a === "play") {
      const r = src === "spotify" ? await playSpotify(items) : src === "youtube" ? await playYouTube(items) : await playFiles(items);
      return { ok: true, ...r };
    }
    if (a === "next" || a === "queue") {
      const next = a === "next";
      if (src === "spotify") return { ok: true, ...(await queueSpotify(items, next)) };
      if (src === "youtube") { const v = await deps.video(); const vids = items.filter((x) => x.videoId).map(videoOf); if (!vids.length) throw new Error("Only videos can be queued."); return { ok: true, ...(await v.addItems(vids, { next })) }; }
      return { ok: true, ...(await playFiles(items, { queue: true, next })) };
    }
    if (a === "like" || a === "unlike") {
      if (src !== "spotify") throw new Error(src === "youtube" ? "Likes on YouTube are made on YouTube itself." : "Your own files don't have likes.");
      for (const it of items.slice(0, 50)) await S.setSaved(it, a === "like");
      return { ok: true, liked: a === "like", reply: `${a === "like" ? "Saved" : "Removed"}: ${items.length === 1 ? clip(items[0].title) : `${items.length} items`}.` };
    }
    if (a === "addToPlaylist") {
      if (src === "spotify") {
        const uris = items.filter((x) => x.kind === "track" || x.kind === "episode").map((x) => x.uri);
        const r = await S.addToPlaylist(String(body.playlistId ?? ""), uris);
        return { ok: true, ...r, reply: `Added ${r.added === 1 ? clip(items[0].title) : `${r.added} songs`} to ${clip(body.playlistTitle ?? "the playlist")}.` };
      }
      if (src === "youtube") {
        const vl = await deps.videolists();
        const name = String(body.playlistTitle ?? body.playlistId ?? "").slice(0, 60);
        let n = 0; for (const it of items.filter((x) => x.videoId)) { vl.add(body.playlistId || name, videoOf(it), { createIfMissing: true }); n++; }
        return { ok: true, added: n, reply: `Added ${n === 1 ? clip(items[0].title) : `${n} videos`} to ${name}.` };
      }
      throw new Error("Your own files can't go into a playlist yet.");
    }
    if (a === "removeHistory") {
      if (src !== "youtube") throw new Error("Only YouTube history can be changed here.");
      let n = 0; for (const it of items) { await Y.removeFromHistory(it.removeToken); n++; }
      return { ok: true, removed: n, reply: `Removed ${n === 1 ? clip(items[0].title) : `${n} videos`} from your watch history.` };
    }
    throw new Error("unknown action");
  } catch (e) {
    return { ok: false, error: e.message, ...(e.needsScopes ? { needsScopes: e.needsScopes } : {}), ...(e.policy ? { policy: true } : {}) };
  }
}

// ---- recent searches ---------------------------------------------------------------------------------------------------------
const FILE = () => process.env.DAYSPRING_MB_FILE || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "media-browser.json");
let db = null;
function load() { if (db && db.file === FILE()) return db; let raw = {}; try { raw = existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), "utf8")) : {}; } catch { raw = {}; } db = { file: FILE(), recent: Array.isArray(raw.recent) ? raw.recent : [] }; return db; }
function save() { const d = load(); try { mkdirSync(dirname(d.file), { recursive: true }); writeJSONAtomic(d.file, { recent: d.recent }, 2); } catch (e) { console.log(`media browser: not saved (${e.message})`); } }
export function remember(q, source) {
  const d = load(), w = String(q).trim().slice(0, 100);
  if (w.length < 2) return;
  d.recent = [{ q: w, source: SOURCES.includes(source) ? source : null, at: Date.now() }, ...d.recent.filter((x) => x.q.toLowerCase() !== w.toLowerCase())].slice(0, 20);
  save();
}
export const recentSearches = () => load().recent;
export function clearRecent() { load().recent = []; save(); return { cleared: true }; }

// ---- what's on the screen, for voice ("play number 3") ------------------------------------------------------------------------
let view = { open: false, at: 0, items: [] };
export function setView(v = {}) {
  const items = (Array.isArray(v.items) ? v.items : []).slice(0, 400).map((x, i) => ({ ...clean(x), n: Number(x.n) || i + 1, removeToken: typeof x.removeToken === "string" ? clean(x)?.removeToken : undefined })).filter((x) => x.source);
  view = { open: Boolean(v.open), at: v.open ? Date.now() : 0, source: SOURCES.includes(v.source) ? v.source : null, section: String(v.section ?? "").slice(0, 40), title: String(v.title ?? "").slice(0, 120), items, more: Boolean(v.more) };
  return { ok: true, shown: items.length };
}
export const shownAt = () => (view.open ? view.at : 0);
export const currentView = () => view;
export function _reset() { view = { open: false, at: 0, items: [] }; db = null; }
const FRESH_MS = 20 * 60_000;

// ---- the no-AI words ---------------------------------------------------------------------------------------------------------
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const numOf = (w) => (/^\d+$/.test(w) ? Number(w) : NUM[w] ?? null);
const N = "(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)";
const localDay = (d) => d.toLocaleDateString("en-CA");
function open(o) { broadcast("mbrowser", { do: "open", ...o }); }
const tidy = (t) => String(t ?? "").toLowerCase().replace(/[!?,.]/g, "").replace(/\s+/g, " ").trim().replace(/^(?:hey |ok |okay )?(?:dayspring )?(?:please |can you |could you |would you )*/, "").replace(/ please$/, "").replace(/’/g, "'");

// → { reply, listen?, intent } | null
export async function command(text) {
  if (!enabled()) return null;
  const t = tidy(text);
  if (!t || t.length > 200) return null;
  let m;
  // 1. whatever list is showing: "play number 3", "queue number 2", "like number 4", "open number 1", "more", "close"
  if (view.open && Date.now() - view.at < FRESH_MS && view.at >= (await deps.othersAt())) {
    const r = await onScreen(t);
    if (r) return { ...r, intent: "mediabrowser.pick" };
  }
  // 2. opening it
  const say = (reply, extra = {}) => ({ reply, intent: "mediabrowser.open", ...extra });
  if (/^(?:open|show|pull up|bring up)(?: me)? (?:my |the )?(?:music|music and videos?|music & videos?|media|music browser|media browser|music and video browser|video browser|music library)$|^open my music$/.test(t)) { open({ source: null }); return say("Here's your music and videos."); }
  if (/^(?:(?:open|show|pull up)(?: me)? my|show(?: me)?) spotify$/.test(t)) { open({ source: "spotify", section: "playlists" }); return say("Here's your Spotify."); }
  if (/^(?:(?:open|show|pull up)(?: me)? my|show(?: me)?) youtube$/.test(t)) { open({ source: "youtube", section: "history" }); return say("Here's your YouTube."); }
  if (/^(?:(?:open|show|pull up|list|see) )?(?:me )?(?:all )?(?:of )?my (?:spotify )?playlists(?: on spotify)?$/.test(t) && /spotify/.test(t)) { open({ source: "spotify", section: "playlists" }); return say("Here are your Spotify playlists."); }
  if (/^(?:(?:open|show|pull up|list|see) )?(?:me )?(?:all )?(?:of )?my (?:liked|saved|favou?rite(?:d)?) songs(?: on spotify)?$/.test(t)) { open({ source: "spotify", section: "liked" }); return say("Here are your Liked Songs."); }
  if (/^(?:show |open |list |pull up |see )?(?:me )?(?:all )?(?:of )?my (?:followed|favou?rite(?:d)?) artists(?: on spotify)?$|^(?:show |list )?(?:me )?(?:the )?artists i follow$/.test(t)) { open({ source: "spotify", section: "artists" }); return say("Here are the artists you follow."); }
  if (/^(?:show |open |list )?(?:me )?my saved albums$/.test(t)) { open({ source: "spotify", section: "albums" }); return say("Here are your saved albums."); }
  if ((m = /^(?:show |open |list |what are )?(?:me )?my (?:top|most played|most listened to) (songs|tracks|artists)(?: on spotify)?(?: (this month|lately|recently|this year|in the last 6 months|of all time|all time|ever))?$/.exec(t))) {
    const type = m[1] === "artists" ? "artists" : "tracks", range = /year|6 months/.test(m[2] ?? "") ? "medium" : /all time|ever/.test(m[2] ?? "") ? "long" : "short";
    open({ source: "spotify", section: "top", type, range });
    const r = await S.top({ type, range }).catch((e) => ({ error: e }));
    if (r.error) return say(r.error.needsScopes ? "Here's where they'd be. Spotify needs your OK first: use the Grant access button." : r.error.message);
    const names = r.items.slice(0, 3).map((x) => type === "artists" ? x.title : `${x.title} by ${x.by}`);
    return say(names.length ? `Your top ${type === "artists" ? "artists" : "songs"} ${S.RANGE_LABEL[range].toLowerCase().replace(/^last/, "for the last")}: ${names.join(", ")}.` : "Spotify doesn't have enough listening yet to say.");
  }
  if ((m = /^what (?:did|have) i (?:listen(?:ed)? to|play(?:ed)?|hear(?:d)?)(?: on spotify)? ?(today|yesterday|last night|this morning|lately|recently)?$|^(?:show |open )?(?:me )?my (?:spotify )?(?:listening|song|music) history$|^(?:show |open )?(?:me )?(?:my )?recently played(?: songs)?$/.exec(t))) {
    const when = m[1] ?? "";
    const d = deps.now(); if (/yesterday|last night/.test(when)) d.setDate(d.getDate() - 1);
    const day = /today|yesterday|last night|this morning/.test(when) ? localDay(d) : null;
    open({ source: "spotify", section: "recent", day });
    if (!spotifyApi.ready()) return say("Spotify isn't connected to Dayspring yet, so I can't read your history. Settings → Apps & connections → Spotify.");
    const r = await S.recent({ day }).catch((e) => ({ error: e }));
    if (r.error) return say(r.error.needsScopes ? "Spotify needs your OK to read your history first: use the Grant access button in the browser." : r.error.message);
    const uniq = [...new Map(r.items.map((x) => [x.uri, x])).values()];
    if (!uniq.length) return say(day ? `I don't see anything on Spotify ${when}.` : "Nothing's been played lately.");
    return say(`${when ? when[0].toUpperCase() + when.slice(1) + " you" : "Lately you've"} listened to ${uniq.length} ${uniq.length === 1 ? "song" : "songs"}${uniq.length ? `, like ${uniq.slice(0, 3).map((x) => `${x.title} by ${x.by}`).join(", ")}` : ""}.`);
  }
  if ((m = /^what (?:did|have) i (?:watch(?:ed)?|see|seen)(?: on youtube)? ?(today|yesterday|last night|this morning|lately|recently)?$|^(?:show |open |pull up )?(?:me )?my (?:youtube |watch |viewing )?(?:watch )?history(?: on youtube)?$|^(?:show |open )?(?:me )?what i watched(?: on youtube)?(?: (today|yesterday|last night))?$/.exec(t))) {
    if (/history/.test(t) && !/youtube|watch/.test(t)) return null;
    const when = m[1] ?? m[2] ?? "";
    open({ source: "youtube", section: "history" });
    if (!when) return say("Here's your YouTube watch history.");
    const r = await Y.history({}).catch((e) => ({ error: e }));
    if (r.error) return say(r.error.signIn ? "Your YouTube history needs you signed in to YouTube in Dayspring's media window. Say \"sign in to YouTube\"." : r.error.message);
    const want = /yesterday|last night/.test(when) ? /^yesterday$/i : /^today$/i;
    const got = r.items.filter((x) => want.test(x.day ?? ""));
    return say(got.length ? `${when[0].toUpperCase() + when.slice(1)} you watched ${got.length} ${got.length === 1 ? "video" : "videos"}: ${got.slice(0, 3).map((x) => clip(x.title, 50)).join(", ")}${got.length > 3 ? ", and more" : ""}.` : `I don't see anything in your YouTube history for ${when}.`);
  }
  // (only "search …": "find X on YouTube" / "look up X on YouTube" play a video, lib/video; "find X on Spotify" plays too)
  if ((m = /^search(?: on)? (spotify|youtube) for (.+)$|^search for (.+?) on (spotify|youtube)$|^search (spotify|youtube) (.+)$/.exec(t))) {
    const source = m[1] ?? m[4] ?? m[5], q = (m[2] ?? m[3] ?? m[6]).trim();
    if (!q) return null;
    remember(q, source);
    open({ source, q });
    return say(`Here's what ${source === "spotify" ? "Spotify" : "YouTube"} has for ${q}.`);
  }
  if ((m = /^(?:search|look) (?:in )?my (?:files|music files|computer|drive) for (.+)$/.exec(t))) { const source = /drive/.test(t) ? "drive" : "local"; open({ source, q: m[1] }); remember(m[1], source); return say(`Here's what's in your ${source === "drive" ? "Drive" : "files"} for ${m[1]}.`); }
  if (/^(?:close|hide|exit)(?: the| my)? (?:music|media|music and videos?|music browser|media browser|browser)$/.test(t)) { broadcast("mbrowser", { do: "close" }); view.open = false; return { reply: "Okay.", intent: "mediabrowser.close" }; }
  return null;
}
async function onScreen(t) {
  let m;
  const pick = (n) => { const x = view.items.find((y) => y.n === n); if (!x) throw new Error(`There ${view.items.length === 1 ? "is only 1" : `are only ${view.items.length}`} on the screen.`); return x; };
  const run = async (action, n, extra = {}) => {
    const x = pick(n);
    if (action === "open") { broadcast("mbrowser", { do: "openItem", n }); return { reply: `Opening ${clip(x.title)}.` }; }
    const r = await act({ action, items: [x], ...extra });
    if (!r.ok) return { reply: r.error };
    broadcast("mbrowser", { do: "acted", action, n });
    return { reply: r.reply || "Okay." };
  };
  try {
    if ((m = new RegExp(`^(?:play|put on|start|watch)(?: the)?(?: number| #)? ${N}(?: one| video| song)?$|^(?:number|#) ${N}$|^the ${N} one$`).exec(t))) { const n = numOf(m[1] ?? m[2] ?? m[3]); return n ? await run("play", n) : null; }
    if ((m = new RegExp(`^(?:play )?(?:number )?${N} next$|^play (?:number )?${N} after this(?: one)?$`).exec(t))) { const n = numOf(m[1] ?? m[2]); return n ? await run("next", n) : null; }
    if ((m = new RegExp(`^(?:queue|add)(?: up)?(?: the)?(?: number)? ${N}(?: one)?(?: to (?:the |my )?queue)?$`).exec(t))) { const n = numOf(m[1]); return n ? await run("queue", n) : null; }
    if ((m = new RegExp(`^(?:like|save|heart|favou?rite)(?: the)?(?: number)? ${N}(?: one)?$`).exec(t))) { const n = numOf(m[1]); return n ? await run("like", n) : null; }
    if ((m = new RegExp(`^(?:open|show me|go to)(?: the)?(?: number)? ${N}(?: one)?$`).exec(t))) { const n = numOf(m[1]); return n ? await run("open", n) : null; }
    if ((m = new RegExp(`^(?:remove|delete)(?: the)?(?: number)? ${N} from (?:my )?(?:watch )?history$`).exec(t))) { const n = numOf(m[1]); return n ? await run("removeHistory", n) : null; }
    if (/^(?:more|show more|load more|next page|keep going)$/.test(t)) { broadcast("mbrowser", { do: "more" }); return { reply: view.more ? "Here are more." : "That's all there is." }; }
  } catch (e) { return { reply: e.message }; }
  return null;
}

// ---- the AI's tools ----------------------------------------------------------------------------------------------------------
export const TOOLS = [
  { name: "music_video_browser", description: "The Music & Video browser window on the Dayspring screen, over Spotify (playlists, Liked Songs, saved albums, followed artists, top artists/songs, recently played, queue), YouTube (watch history, playlists, Liked videos, Watch later, subscriptions, queue), the owner's own files and Google Drive. Open it on a section, or with search results for words he typed or said, or act on number N of what it's showing.",
    input_schema: { type: "object", properties: {
      action: { type: "string", enum: ["open", "search", "pick", "close"], description: "open = show a source/section; search = open with results; pick = act on number N of what's showing; close" },
      source: { type: "string", enum: ["spotify", "youtube", "local", "drive"] },
      section: { type: "string", description: "spotify: now, playlists, liked, albums, artists, top, recent, queue · youtube: history, playlists, liked, watchlater, subscriptions, queue · local: recent, songs, albums, artists, videos" },
      query: { type: "string" }, range: { type: "string", enum: ["short", "medium", "long"], description: "top: short ≈ 4 weeks, medium ≈ 6 months, long = all time" }, top_type: { type: "string", enum: ["tracks", "artists"] },
      day: { type: "string", description: "recent: only this day (YYYY-MM-DD)" }, number: { type: "number" }, what: { type: "string", enum: ["play", "next", "queue", "like", "open", "removeHistory"] },
    }, required: ["action"] } },
  { name: "music_video_history", description: "Read the owner's listening and watching history: Spotify recently played (optionally one day), Spotify top songs or artists over a range, or YouTube watch history (grouped by day). Returns the list (titles, artists/channels, when). Use for \"what did I listen to yesterday\", \"what did I watch last night\", \"my top songs this month\".",
    input_schema: { type: "object", properties: { kind: { type: "string", enum: ["spotify_recent", "spotify_top", "youtube_history"] }, day: { type: "string", description: "YYYY-MM-DD" }, range: { type: "string", enum: ["short", "medium", "long"] }, top_type: { type: "string", enum: ["tracks", "artists"] } }, required: ["kind"] } },
];
export const tools = () => (enabled() ? TOOLS : []);
export async function runTool(name, i = {}) {
  if (!TOOLS.some((t) => t.name === name)) return undefined;
  if (!enabled()) return { error: "The Music & Video browser isn't part of this version (or it's switched off in Settings → Features)." };
  try {
    if (name === "music_video_browser") {
      if (i.action === "close") { broadcast("mbrowser", { do: "close" }); view.open = false; return { closed: true }; }
      if (i.action === "pick") {
        if (!view.open) return { error: "The browser isn't showing anything to pick from." };
        const x = view.items.find((y) => y.n === Number(i.number));
        if (!x) return { error: `There are only ${view.items.length} on the screen.` };
        if ((i.what ?? "play") === "open") { broadcast("mbrowser", { do: "openItem", n: x.n }); return { opened: x.title }; }
        return act({ action: i.what ?? "play", items: [x] });
      }
      const source = SOURCES.includes(i.source) ? i.source : null;
      if (i.action === "search") { if (!i.query) return { error: "Search for what?" }; remember(i.query, source ?? "spotify"); open({ source: source ?? "spotify", q: String(i.query).slice(0, 200) }); return { opened: true, source: source ?? "spotify", query: i.query }; }
      open({ source, section: i.section ?? null, range: i.range ?? null, type: i.top_type ?? null, day: i.day ?? null });
      return { opened: true, source, section: i.section ?? null };
    }
    if (name === "music_video_history") {
      const list = (r) => r.items.slice(0, 50).map((x) => ({ title: x.title, by: x.by || x.channel || "", when: x.playedAt ?? x.day ?? null }));
      if (i.kind === "spotify_recent") return { items: list(await S.recent({ day: i.day ?? null })) };
      if (i.kind === "spotify_top") { const r = await S.top({ type: i.top_type === "artists" ? "artists" : "tracks", range: i.range ?? "short" }); return { range: r.rangeLabel, items: list(r) }; }
      if (i.kind === "youtube_history") return { items: list(await Y.history({})) };
      return { error: "unknown kind" };
    }
  } catch (e) { return { error: e.message, ...(e.needsScopes ? { needsScopes: e.needsScopes, how: "Ask him to press \"Grant access to your library and history\" in the Music & Video browser." } : {}), ...(e.signIn ? { signIn: e.signIn } : {}) }; }
  return undefined;
}
