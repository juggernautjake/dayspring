// The in-app player's routes: Spotify sign-in and tokens for the screen's Spotify player, what's playing, and controls.
// handle(): /api/player/*   handlePage(): /spotify/callback (the page Spotify sends the browser back to after sign-in)
import { spawn, execFile } from "node:child_process";
import * as spotifyApi from "./spotify-api.mjs";
import * as media from "./media.mjs";
import * as browser from "./browser.mjs";
import * as settings from "./settings.mjs";
import * as videolists from "./videolists.mjs";
import * as insights from "./insights.mjs";
import { broadcast } from "./announcer.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Is the Spotify desktop app installed? (it registers the spotify: link type)
function spotifyAppInstalled() {
  return new Promise((ok) => execFile("reg", ["query", "HKCU\\Software\\Classes\\spotify"], { windowsHide: true }, (e) => {
    if (!e) return ok(true);
    execFile("reg", ["query", "HKCR\\spotify"], { windowsHide: true }, (e2) => ok(!e2));
  }));
}

// Open the sign-in page in the owner's normal browser (where they're used to signing in), not the kiosk screen.
export function openSignIn() {
  const url = spotifyApi.loginUrl();
  spawn("explorer.exe", [url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  return url;
}

export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (!p.startsWith("/player/")) return false;
  const body = m === "POST" ? await readJSON(req).catch(() => ({})) : {};
  try {
    if (m === "GET" && p === "/player/status") return send(res, 200, { spotify: spotifyApi.status(), screenPlayer: Boolean(media.device()), state: media.playerState() }), true;
    // the screen's Spotify player asks for a fresh token whenever it needs one (this server only listens on 127.0.0.1)
    if (m === "GET" && p === "/player/spotify/token") return send(res, 200, { token: await spotifyApi.accessToken() }), true;
    if (m === "POST" && p === "/player/spotify/login") return send(res, 200, { url: body.open === false ? spotifyApi.loginUrl() : openSignIn() }), true;
    if (m === "POST" && p === "/player/spotify/logout") { spotifyApi.signOut(); media.setDevice(null); broadcast("spotify-auth", { signedIn: false }); return send(res, 200, { spotify: spotifyApi.status() }), true; }
    if (m === "POST" && p === "/player/device") { media.setDevice(body.deviceId ?? null); return send(res, 200, { ok: true }), true; }
    if (m === "POST" && p === "/player/state") { media.setState(body); insights.observe(body); return send(res, 200, { ok: true }), true; }   // + the play log for "my most watched / top artists"
    // the screen asks for things only the Web API can do: shuffle, repeat, play something new on its own player
    if (m === "POST" && p === "/player/spotify/api") {
      const dev = media.device();
      if (!dev) return send(res, 409, { error: "The screen's Spotify player isn't ready yet." }), true;
      if (body.action === "shuffle") await spotifyApi.shuffle(Boolean(body.value), dev);
      else if (body.action === "repeat") await spotifyApi.repeat(String(body.value ?? "off"), dev);
      else if (body.action === "transfer") await spotifyApi.transfer(dev, Boolean(body.value));
      else if (body.action === "play") return send(res, 200, await media.spotify({ query: String(body.query ?? ""), type: body.type ?? "track", url: body.uri ?? body.url, shuffle: body.shuffle })), true;
      else if (body.action === "queue") {
        const uri = spotifyApi.toUri(body.uri) ?? (await spotifyApi.search(String(body.query ?? ""), "track", 1))[0]?.uri;
        if (!uri) return send(res, 404, { error: `Nothing on Spotify matched "${body.query}".` }), true;
        await spotifyApi.addToQueue(uri, dev);
      }
      else if (body.action === "like") await spotifyApi.like(String(body.uri), body.value !== false);
      // "jump to" a song in Up Next: Spotify can't jump straight there, so skip forward that many songs
      else if (body.action === "skipTo") { const n = Math.max(1, Math.min(20, Number(body.count) || 1)); for (let i = 0; i < n; i++) { await spotifyApi.next(dev); await new Promise((r) => setTimeout(r, 250)); } }
      else if (body.action === "addToPlaylist") {
        const pl = await spotifyApi.findMyPlaylist(String(body.playlist ?? ""));
        if (!pl) return send(res, 404, { error: `I couldn't find a playlist of yours called "${body.playlist}".` }), true;
        await spotifyApi.addToPlaylist(pl.id, String(body.uri));
        return send(res, 200, { ok: true, playlist: pl.name }), true;
      }
      else return send(res, 400, { error: "unknown action" }), true;
      return send(res, 200, { ok: true }), true;
    }
    // controls from anywhere (the desk page, the AI): the screen applies them to whatever is playing
    if (m === "POST" && p === "/player/control") return send(res, 200, await media.control(String(body.action ?? ""), body.value)), true;
    // the older hidden-window Spotify, controlled by the screen's music card
    if (m === "POST" && p === "/player/window") {
      const a = String(body.action ?? "");
      if (a === "volume") { const s = settings.set({ musicVolume: Number(body.value) }); await browser.spotifyVolume(s.musicVolume); return send(res, 200, { volume: s.musicVolume }), true; }
      if (!["pause", "resume", "next", "previous"].includes(a)) return send(res, 400, { error: "unknown action" }), true;
      const r = await browser.spotifyControl(a);
      broadcast("nowplaying", { source: "spotify", ...r });
      return send(res, 200, r), true;
    }

    // ---- the Library: Spotify ----
    if (m === "GET" && p === "/player/spotify/library") {
      const [playlists, liked, recent] = await Promise.all([spotifyApi.myPlaylists().catch((e) => ({ error: e.message })), spotifyApi.likedTracks(30).catch(() => []), spotifyApi.recentlyPlayed(20).catch(() => [])]);
      if (playlists.error) return send(res, 400, { error: playlists.error }), true;
      return send(res, 200, { playlists, liked, recent }), true;
    }
    if (m === "GET" && p === "/player/spotify/search") {
      const type = ["track", "album", "artist", "playlist", "show", "episode"].includes(q.get("type")) ? q.get("type") : "track";
      return send(res, 200, { results: await spotifyApi.search(String(q.get("q") ?? "").slice(0, 200), type, 10) }), true;
    }
    if (m === "GET" && p === "/player/spotify/queue") return send(res, 200, await spotifyApi.queue()), true;
    // A Jam (a Spotify party) can only be started in Spotify's own app, so open it: the desktop app if it's installed
    // (its spotify: link), otherwise Spotify on the web.
    if (m === "POST" && p === "/player/spotify/app") {
      const app = await spotifyAppInstalled();
      spawn("explorer.exe", [app ? "spotify:" : "https://open.spotify.com/"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
      return send(res, 200, { opened: app ? "app" : "web" }), true;
    }

    // ---- the Library: videos ----
    if (m === "GET" && p === "/player/youtube/search") {
      const kind = q.get("kind") === "playlist" ? "playlist" : "video", sort = q.get("sort") ?? "relevance";
      const results = await media.searchYouTube({ query: String(q.get("q") ?? "").slice(0, 200), kind, popular: sort === "popular", newest: sort === "newest", max: 40 });
      return send(res, 200, { results }), true;
    }
    if (m === "GET" && p === "/player/youtube/mine") return send(res, 200, { playlists: await browser.youtubeMyPlaylists() }), true;
    if (m === "GET" && p === "/player/videolists") return send(res, 200, { lists: videolists.all() }), true;
    if (m === "POST" && p === "/player/videolists") {
      const a = String(body.action ?? ""), ref = body.list ?? body.id ?? body.name;
      const out = a === "create" ? videolists.create(body.name) : a === "rename" ? videolists.rename(ref, body.to) : a === "delete" ? videolists.remove(ref)
        : a === "add" ? videolists.add(ref, body.item ?? {}, { createIfMissing: Boolean(body.create) }) : a === "removeItem" ? videolists.removeItem(ref, body.index)
        : a === "move" ? videolists.move(ref, body.from, body.to) : null;
      if (!out) return send(res, 400, { error: "unknown action" }), true;
      return send(res, 200, { result: out, lists: videolists.all() }), true;
    }
  } catch (e) {
    return send(res, e.status === 401 || /isn't connected/.test(e.message) ? 401 : 400, { error: e.message }), true;
  }
  return false;
}

export async function handlePage(req, res, { m, pathname, q }) {
  if (m !== "GET" || pathname !== "/spotify/callback") return false;
  let ok = false, text;
  try {
    const st = await spotifyApi.finishLogin({ code: q.get("code"), state: q.get("state"), error: q.get("error") });
    ok = true;
    text = st.product && st.product !== "premium"
      ? `Connected${st.name ? " as " + st.name : ""}, but this account isn't Premium, and Spotify only plays inside apps for Premium accounts.`
      : `Spotify is connected${st.name ? " as " + st.name : ""}. Music will play right on the Dayspring screen.`;
    broadcast("spotify-auth", { signedIn: true });
  } catch (e) { text = e.message; }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><title>Spotify · Dayspring</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070916;color:#eef0ff;font:17px/1.5 system-ui,Segoe UI,sans-serif}
.b{max-width:30em;padding:2em;border-radius:1.2em;background:rgba(24,28,60,.85);border:1px solid rgba(160,170,255,.2);text-align:center}
h1{font-weight:500;font-size:1.4em;margin:.2em 0 .5em}.i{font-size:2.6em}p{color:#b9c0e8}</style>
<div class="b"><div class="i">${ok ? "🎵" : "⚠️"}</div><h1>${ok ? "All set" : "That didn't work"}</h1><p>${esc(text)}</p><p>You can close this tab.</p></div>`);
  return true;
}
