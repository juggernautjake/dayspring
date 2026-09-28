// The signed-in YouTube account's playlists, including Liked videos and Watch later.
//   Through the YouTube Data API when a Google account with the YouTube scope is connected (Settings → Apps → Google);
//   otherwise through the media browser where he signed in to YouTube once (lib/browser.mjs, the DayspringMedia profile).
//   The list is kept for a while in data/video-account.json (tests: DAYSPRING_VIDEO_ACCOUNT) so "play my Worship
//   playlist" doesn't open the media window every time.
//   playlists({ fresh }) → [{ playlistId, title, count, special }] · find(name) → { playlist, score } · items(playlist)
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJSONAtomic } from "../atomic.mjs";
import * as yt from "./youtube.mjs";
import { sim, norm, nameSim } from "./text.mjs";

const FILE = () => process.env.DAYSPRING_VIDEO_ACCOUNT || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "video-account.json");
const FRESH_MS = 12 * 3600_000;
export const LIKED = { playlistId: "LL", title: "Liked videos", special: "liked" };
export const WATCH_LATER = { playlistId: "WL", title: "Watch later", special: "watchlater" };

// what reaches the account (tests replace these)
let deps = {
  // an authorised fetch for the Data API, when a Google account has the YouTube scope; else null
  auth: async () => {
    try {
      const g = await import("../connectors/google.mjs");
      const a = g.accounts().find((x) => x.token && (x.scopes ?? []).some((s) => /\/auth\/youtube(\.readonly|\.force-ssl)?$/.test(s)));
      return a ? { fetcher: (url) => g.authFetch(a, url), account: a.email ?? a.id } : null;
    } catch { return null; }
  },
  browser: () => import("../browser.mjs"),
};
export function _setDeps(d) { deps = { ...deps, ...d }; cache = null; }

let cache = null;
function load() {
  if (cache) return cache;
  try { cache = existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), "utf8")) : null; } catch { cache = null; }
  return cache;
}
function store(v) { cache = v; try { mkdirSync(dirname(FILE()), { recursive: true }); writeJSONAtomic(FILE(), v, 2); } catch { /* kept in memory */ } }
export const cached = () => load()?.playlists ?? [];
export function reload() { cache = null; }

export async function playlists({ fresh = false } = {}) {
  const c = load();
  if (!fresh && c?.playlists?.length && Date.now() - (c.at ?? 0) < FRESH_MS) return c.playlists;
  let list = null, via = null;
  const auth = await deps.auth();
  if (auth) {
    try { list = await yt.api.myPlaylists(auth); via = "api"; } catch (e) { console.log(`youtube playlists (Data API): ${e.message}; trying the media browser`); }
  }
  if (!list) {
    const b = await deps.browser();
    const got = await b.youtubeMyPlaylists();
    if (!Array.isArray(got)) throw new Error("I couldn't read your YouTube playlists.");
    list = got.map((x) => ({ playlistId: x.playlistId, title: x.title, count: x.count ?? null, via: "browser" }));
    via = "browser";
    if (!list.length) throw Object.assign(new Error("I didn't find any YouTube playlists. If you haven't yet, say “sign in to YouTube” once, and I'll remember it."), { signIn: true });
  }
  // Liked videos and Watch later are always there (the Data API gives the liked list's own id; Watch later only the browser can read)
  if (!list.some((x) => x.special === "liked" || x.playlistId === "LL")) list.unshift({ ...LIKED });
  if (!list.some((x) => x.playlistId === "WL")) list.splice(1, 0, { ...WATCH_LATER });
  list = list.filter((x, i, a) => x.playlistId && a.findIndex((y) => y.playlistId === x.playlistId) === i);
  store({ at: Date.now(), via, playlists: list });
  return list;
}
// "worship" → the Worship Songs playlist; "liked" → Liked videos
export function match(name, list) {
  const n = norm(name).replace(/\b(?:my|the|youtube|playlist|list|videos?)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return null;
  if (/^(?:liked|likes|like|thumbs up|favou?rites?)$/.test(n)) return { playlist: list.find((x) => x.special === "liked" || x.playlistId === "LL") ?? LIKED, score: 1 };
  if (/^(?:watch ?later|saved for later|later)$/.test(n)) return { playlist: list.find((x) => x.playlistId === "WL") ?? WATCH_LATER, score: 1 };
  const scored = list.map((p) => ({ playlist: p, score: Math.max(sim(n, p.title), nameSim(n, p.title), norm(p.title) === n ? 1 : 0, norm(p.title).startsWith(n + " ") || norm(p.title).endsWith(" " + n) ? 0.85 : 0) })).sort((a, b) => b.score - a.score);
  return scored[0] && scored[0].score >= 0.55 ? scored[0] : null;
}
export async function find(name, { fresh = false } = {}) {
  const list = await playlists({ fresh });
  let hit = match(name, list);
  if (!hit && !fresh && load()?.via) { hit = match(name, await playlists({ fresh: true })); }
  return hit;
}
// the videos in it: the Data API, else a plain page read (public playlists), else the signed-in media browser
export async function items(pl) {
  const id = pl.playlistId;
  const auth = await deps.auth();
  if (auth && id !== "WL") { try { const r = await yt.api.playlistItems(id, auth); if (r.length) return r; } catch (e) { console.log(`youtube playlist items (Data API): ${e.message}`); } }
  if (!["LL", "WL"].includes(id) && !pl.private) { try { const r = await yt.playlist(id); if (r.items.length) return r.items; } catch { /* private, or YouTube sent a check page */ } }
  const b = await deps.browser();
  const page = await b.youtubePlaylistPage(id);
  return yt.parsePlaylist(page).items;
}
