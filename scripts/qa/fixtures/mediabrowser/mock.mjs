// A pretend Spotify and a pretend YouTube for scripts/qa/media-browser.mjs, on this computer only (never the real ones,
// never the owner's accounts). Everything here is made up.
//   Spotify Web API (/v1/…): his playlists (his own, followed, collaborative), Liked Songs, saved albums, followed artists
//     (cursor paging), top artists and songs per range, recently played (before-cursor paging, three days), the queue, what's
//     playing, search (at most 10 a call, like a Development Mode app: a bigger limit is refused), saving, following, adding
//     to a playlist, queueing and playing. Every call checks the token's scopes (a missing one answers 403 "Insufficient
//     client scope"), and some calls are closed the way Spotify closes them to Development Mode apps (403).
//   YouTube pages (/feed/history, /feed/subscriptions, /feed/channels, /feed/playlists, /playlist, /results, /) with
//     ytInitialData and ytcfg (signed in = the SAPISID cookie), and YouTube's own calls (/youtubei/v1/browse for
//     continuations and history search, /feedback to remove from history, /account/account_menu), which insist on the
//     page's SAPISIDHASH signature.
//   Sign-in pages: /yt-signin (sets SAPISID for this host) and, on the second server (another host name, so the cookies are
//     another site's), /sp-login (sets sp_dc) and a web player page that shows who's signed in.
//   const m = await startMock(); m.spotify (http://127.0.0.1:P), m.yt (same), m.sp (http://localhost:P2); m.state; m.close()
import http from "node:http";
import { createHash } from "node:crypto";

const pad = (n, w = 4) => String(n).padStart(w, "0");
const id22 = (p, n) => (p + pad(n, 6) + "abcdefghijklmnopqrstuv").slice(0, 22);
// ---- the made-up Spotify world ------------------------------------------------------------------------------------------
const ARTISTS = Array.from({ length: 75 }, (_, i) => ({ id: id22("ar", i), uri: `spotify:artist:${id22("ar", i)}`, name: i === 0 ? "Hollow Pines" : i === 1 ? "Josh Garrels" : `Artist ${pad(i, 2)}`, type: "artist", genres: i % 3 === 0 ? ["christian folk", "indie folk"] : ["worship"], followers: { total: 1000 * (75 - i) }, popularity: 80 - (i % 40), images: [{ url: `https://i.scdn.co/image/ar${i}` }], external_urls: { spotify: `https://open.spotify.com/artist/${id22("ar", i)}` } }));
const ALBUMS = Array.from({ length: 60 }, (_, i) => ({ id: id22("al", i), uri: `spotify:album:${id22("al", i)}`, name: i === 0 ? "Gratitude Sessions" : `Album ${pad(i, 2)}`, type: "album", artists: [ARTISTS[i % 75]], images: [{ url: `https://i.scdn.co/image/al${i}` }], external_urls: { spotify: `https://open.spotify.com/album/${id22("al", i)}` } }));
const TRACKS = Array.from({ length: 400 }, (_, i) => ({ id: id22("tr", i), uri: `spotify:track:${id22("tr", i)}`, name: i === 0 ? "Gratitude" : i === 1 ? "Holy Forever" : `Song ${pad(i)}`, type: "track", duration_ms: 120000 + (i % 7) * 30000,
  artists: [{ id: ARTISTS[i % 75].id, uri: ARTISTS[i % 75].uri, name: ARTISTS[i % 75].name }], album: { id: ALBUMS[i % 60].id, name: ALBUMS[i % 60].name, images: ALBUMS[i % 60].images }, popularity: 90 - (i % 50), explicit: false, external_urls: { spotify: `https://open.spotify.com/track/${id22("tr", i)}` } }));
const ME = "qa-owner";
const PLAYLISTS = [
  ...Array.from({ length: 7 }, (_, i) => ({ id: id22("pm", i), name: i === 0 ? "Morning Worship" : `My Mix ${i}`, owner: { id: ME, display_name: "QA Owner" }, collaborative: false, n: 30 + i * 11 })),
  ...Array.from({ length: 3 }, (_, i) => ({ id: id22("pf", i), name: `Followed List ${i + 1}`, owner: { id: "someone", display_name: "Someone Else" }, collaborative: false, n: 25 })),
  ...Array.from({ length: 2 }, (_, i) => ({ id: id22("pc", i), name: `Road Trip ${i + 1} (collab)`, owner: { id: "friend", display_name: "A Friend" }, collaborative: true, n: 12 })),
  { id: "37i9dQZF1DXspotifyown", name: "Spotify's Own Mix", owner: { id: "spotify", display_name: "Spotify" }, collaborative: false, n: 50, closed: true },
].map((p) => ({ ...p, uri: `spotify:playlist:${p.id}`, type: "playlist", images: [{ url: `https://i.scdn.co/image/${p.id}` }], external_urls: { spotify: `https://open.spotify.com/playlist/${p.id}` }, description: "", tracks: { total: p.n } }));
const plTracks = (p) => Array.from({ length: p.n }, (_, k) => TRACKS[(PLAYLISTS.indexOf(p) * 17 + k) % TRACKS.length]);
const DAY = 86_400_000;
export function makeRecent(now = Date.now()) {
  // 120 plays: 40 today (from midnight on), 40 yesterday, 40 the day before, newest first
  const mid = new Date(now); mid.setHours(0, 0, 0, 0);
  const out = [];
  for (let d = 0; d < 3; d++) {
    const from = mid.getTime() - d * DAY, span = d === 0 ? Math.max(60_000, now - from - 1000) : DAY - 1000;
    for (let k = 0; k < 40; k++) out.push({ played_at: new Date(from + Math.floor(span * (1 - (k + 1) / 41))).toISOString(), track: TRACKS[((d * 40 + k) * 3) % 400], context: null });
  }
  return out.sort((a, b) => Date.parse(b.played_at) - Date.parse(a.played_at));
}
const NEEDS = [
  [/^GET \/me\/playlists/, "playlist-read-private"], [/^GET \/playlists\/[^/]+\/(items|tracks)/, "playlist-read-private"], [/^GET \/me\/tracks/, "user-library-read"], [/^GET \/me\/albums/, "user-library-read"],
  [/^GET \/me\/following/, "user-follow-read"], [/^GET \/me\/top\//, "user-top-read"], [/^GET \/me\/player\/recently-played/, "user-read-recently-played"], [/^GET \/me\/player\/queue/, "user-read-playback-state"],
  [/^(PUT|DELETE) \/me\/(library|tracks|albums)/, "user-library-modify"], [/^(PUT|DELETE) \/me\/following/, "user-follow-modify"], [/^POST \/playlists\/[^/]+\/(items|tracks)/, "playlist-modify-private"],
];

// ---- the made-up YouTube world --------------------------------------------------------------------------------------------
const vid = (p, n) => (p + String(n).padStart(11 - p.length, "0")).slice(0, 11);   // always 11 characters, like YouTube's
const v = (n, { day = "", lockup = false, short = false } = {}) => {
  const videoId = vid("h", n), title = n === 0 ? "How to Build a Dovetail Joint" : `History Video ${pad(n, 3)}`, channel = n % 2 ? "Woodworking Weekly" : "Trail Riders";
  const token = `rm-${videoId}`;
  if (lockup) return { lockupViewModel: { contentId: videoId, contentType: "LOCKUP_CONTENT_TYPE_VIDEO", contentImage: { thumbnailViewModel: { overlays: [{ thumbnailOverlayBadgeViewModel: { thumbnailBadges: [{ thumbnailBadgeViewModel: { text: "12:34" } }] } }] } },
    metadata: { lockupMetadataViewModel: { title: { content: title }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: channel } }] }, { metadataParts: [{ text: { content: "12K views" } }, { text: { content: "3 days ago" } }] }] } },
      menuButton: { buttonViewModel: { onTap: { innertubeCommand: { showSheetCommand: { panelLoadingStrategy: { inlineContent: { sheetViewModel: { content: { listViewModel: { listItems: [{ listItemViewModel: { title: { content: "Remove from watch history" }, rendererContext: { commandContext: { onTap: { innertubeCommand: { feedbackEndpoint: { feedbackToken: token } } } } } } }] } } } } } } } } } } } } } };
  if (short) return { reelItemRenderer: { videoId, headline: { simpleText: `A short ${n}` }, viewCountText: { simpleText: "1M views" } } };
  return { videoRenderer: { videoId, title: { runs: [{ text: title }] }, ownerText: { runs: [{ text: channel, navigationEndpoint: { browseEndpoint: { browseId: "UCwoodworkingweekly001" } } }] }, viewCountText: { simpleText: "48K views" }, publishedTimeText: { simpleText: "2 weeks ago" }, lengthText: { simpleText: n % 5 === 0 ? "0:45" : "18:20" },
    menu: { menuRenderer: { items: [{ menuServiceItemRenderer: { text: { runs: [{ text: "Remove from watch history" }] }, serviceEndpoint: { feedbackEndpoint: { feedbackToken: token } } } }] } } } };
};
const section = (title, items, cont = null) => ({ itemSectionRenderer: { header: { itemSectionHeaderRenderer: { title: { runs: [{ text: title }] } } }, contents: [...items, ...(cont ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: cont } } } }] : [])] } });
function historyPage(removed, query = "") {
  const keep = (x) => { const id = x.videoRenderer?.videoId ?? x.lockupViewModel?.contentId; return id && !removed.has(id) && (!query || JSON.stringify(x).toLowerCase().includes(query.toLowerCase())); };
  const today = Array.from({ length: 20 }, (_, i) => v(i)).filter(keep), yest = Array.from({ length: 15 }, (_, i) => v(20 + i, { lockup: true })).filter(keep);
  return [section("Today", today), section("Yesterday", yest, query ? null : "H2")];
}
const historyMore = (token, removed) => {
  const keep = (x) => !removed.has(x.videoRenderer?.videoId ?? x.lockupViewModel?.contentId);
  if (token === "H2") return [section("Monday", Array.from({ length: 20 }, (_, i) => v(40 + i)).filter(keep), "H3")];
  if (token === "H3") return [section("Sunday", Array.from({ length: 12 }, (_, i) => v(60 + i)).filter(keep))];
  if (token === "S2") return Array.from({ length: 15 }, (_, i) => ({ richItemRenderer: { content: v(200 + i) } }));
  if (token === "C2") return Array.from({ length: 5 }, (_, i) => ({ channelRenderer: { channelId: `UCsubscribedchannel${pad(10 + i, 3)}`, title: { simpleText: `Subscribed Channel ${10 + i}` }, videoCountText: { simpleText: "100K subscribers" } } }));
  return [];
};
const CHANNELS = Array.from({ length: 10 }, (_, i) => ({ channelRenderer: { channelId: `UCsubscribedchannel${pad(i, 3)}`, title: { simpleText: i === 0 ? "Woodworking Weekly" : `Subscribed Channel ${i}` }, videoCountText: { simpleText: `${i + 1}0K subscribers` }, navigationEndpoint: { browseEndpoint: { canonicalBaseUrl: `/@subchan${i}` } } } }));
const SEARCH_VIDEOS = (q) => Array.from({ length: 22 }, (_, i) => ({ videoRenderer: { videoId: vid("s" + (q.length % 9), i), title: { runs: [{ text: `${q} video ${i + 1}` }] }, ownerText: { runs: [{ text: i % 3 ? "Some Channel" : "Woodworking Weekly" }] }, viewCountText: { simpleText: `${(i + 1) * 1000} views` }, publishedTimeText: { simpleText: i < 5 ? "2 days ago" : "3 months ago" }, lengthText: { simpleText: i % 4 === 0 ? "0:50" : i % 4 === 1 ? "3:10" : i % 4 === 2 ? "12:00" : "45:00" } } }));
const page = (data, { loggedIn = false, extra = "" } = {}) => `<!doctype html><html><head><title>YouTube (mock)</title></head><body><div id="app">mock youtube</div>
<script>var ytcfg = { data_: { LOGGED_IN: ${loggedIn}, INNERTUBE_API_KEY: "qa-key", INNERTUBE_CLIENT_VERSION: "2.20260101.00.00", INNERTUBE_CONTEXT_CLIENT_NAME: 1, INNERTUBE_CONTEXT: { client: { clientName: "WEB", clientVersion: "2.20260101.00.00", hl: "en", gl: "US" } } }, get: function (k) { return this.data_[k]; } };</script>
<script>var ytInitialData = ${JSON.stringify(data)};</script>${extra}</body></html>`;
const cookieOf = (req, name) => (new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie ?? "") ?? [])[1] ?? null;

export async function startMock() {
  const state = { calls: [], scopes: new Map(), liked: new Set(TRACKS.slice(0, 130).map((t) => t.uri)), savedAlbums: new Set(), following: new Set(), plAdds: [], queue: [], lastPlay: null, removed: new Set(), feedback: [], ytAuthFails: 0, now: Date.now(), searchLimitViolations: 0, closedTopTracks: true };
  const likedList = () => TRACKS.filter((t) => state.liked.has(t.uri));
  const recent = () => makeRecent(state.now);
  const j = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(body === undefined ? "" : JSON.stringify(body)); };
  const pageOf = (list, url, map = (x) => x) => { const off = Number(url.searchParams.get("offset") ?? 0), lim = Number(url.searchParams.get("limit") ?? 20); const items = list.slice(off, off + lim).map(map); return { items, total: list.length, offset: off, limit: lim, next: off + lim < list.length ? `next?offset=${off + lim}` : null }; };

  async function spotifyApi(req, res, url, body) {
    const path = url.pathname.replace(/^\/v1/, ""), m = req.method;
    const tok = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const have = state.scopes.get(tok) ?? null;
    state.calls.push(`${m} ${path}${url.search}`);
    if (!have) return j(res, 401, { error: { status: 401, message: "The access token expired" } });
    for (const [re, sc] of NEEDS) if (re.test(`${m} ${path}`) && !have.includes(sc)) return j(res, 403, { error: { status: 403, message: "Insufficient client scope" } });
    if (m === "GET" && path === "/me") return j(res, 200, { id: ME, display_name: "QA Owner", product: "premium" });
    if (m === "GET" && path === "/me/playlists") return j(res, 200, pageOf(PLAYLISTS, url));
    let mm;
    if (m === "GET" && (mm = /^\/playlists\/([^/]+)$/.exec(path))) { const p = PLAYLISTS.find((x) => x.id === mm[1]); return p ? j(res, 200, p) : j(res, 404, { error: { status: 404, message: "Not found" } }); }
    if (m === "GET" && (mm = /^\/playlists\/([^/]+)\/(items|tracks)$/.exec(path))) {
      const p = PLAYLISTS.find((x) => x.id === mm[1]);
      if (!p) return j(res, 404, { error: { status: 404, message: "Not found" } });
      if (p.closed) return j(res, 403, { error: { status: 403, message: "Forbidden" } });   // (Spotify's own playlists: closed to Development Mode apps)
      return j(res, 200, pageOf(plTracks(p), url, (t) => ({ added_at: "2026-09-01T10:00:00Z", item: t })));
    }
    if (m === "GET" && path === "/me/tracks") return j(res, 200, pageOf(likedList(), url, (t) => ({ added_at: "2026-09-02T10:00:00Z", track: t })));
    if (m === "GET" && path === "/me/albums") return j(res, 200, pageOf(ALBUMS, url, (a) => ({ added_at: "2026-08-02T10:00:00Z", album: a })));
    if (m === "GET" && path === "/me/following") {
      const after = url.searchParams.get("after"), lim = Number(url.searchParams.get("limit") ?? 20);
      const start = after ? ARTISTS.findIndex((a) => a.id === after) + 1 : 0, items = ARTISTS.slice(start, start + lim), last = items.at(-1);
      const more = start + lim < ARTISTS.length;
      return j(res, 200, { artists: { items, total: ARTISTS.length, next: more ? "next" : null, cursors: { after: more ? last.id : null } } });
    }
    if (m === "GET" && (mm = /^\/me\/top\/(artists|tracks)$/.exec(path))) {
      const range = url.searchParams.get("time_range") ?? "medium_term", shift = { short_term: 0, medium_term: 5, long_term: 11 }[range] ?? 0;
      const list = mm[1] === "artists" ? [...ARTISTS.slice(shift), ...ARTISTS.slice(0, shift)].slice(0, 60) : [...TRACKS.slice(shift, shift + 70)];
      return j(res, 200, pageOf(list, url));
    }
    if (m === "GET" && path === "/me/player/recently-played") {
      const before = Number(url.searchParams.get("before") ?? 0) || Infinity, lim = Math.min(50, Number(url.searchParams.get("limit") ?? 20));
      const list = recent().filter((x) => Date.parse(x.played_at) < before).slice(0, lim);
      const oldest = list.at(-1);
      const more = oldest && recent().some((x) => Date.parse(x.played_at) < Date.parse(oldest.played_at));
      return j(res, 200, { items: list, next: more ? "next" : null, cursors: { before: more ? String(Date.parse(oldest.played_at)) : null } });
    }
    if (m === "GET" && path === "/me/player/queue") return j(res, 200, { currently_playing: TRACKS[5], queue: [...state.queue.map((u) => TRACKS.find((t) => t.uri === u)), ...TRACKS.slice(6, 14)].filter(Boolean) });
    if (m === "GET" && path === "/me/player") return j(res, 200, { is_playing: true, progress_ms: 42000, item: TRACKS[5], device: { id: "dev-screen", name: "Dayspring" }, shuffle_state: false, repeat_state: "off" });
    if (m === "GET" && (path === "/me/library/contains" || path === "/me/tracks/contains")) { const uris = (url.searchParams.get("uris") ?? "").split(",").filter(Boolean); const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean).map((i) => `spotify:track:${i}`); return j(res, 200, [...uris, ...ids].map((u) => state.liked.has(u) || state.savedAlbums.has(u))); }
    if ((m === "PUT" || m === "DELETE") && path === "/me/library") { for (const u of (url.searchParams.get("uris") ?? "").split(",").filter(Boolean)) { const set = u.includes(":album:") ? state.savedAlbums : state.liked; if (m === "PUT") set.add(u); else set.delete(u); } return j(res, 200, {}); }
    if ((m === "PUT" || m === "DELETE") && path === "/me/following") { for (const i of (url.searchParams.get("ids") ?? "").split(",")) { if (m === "PUT") state.following.add(i); else state.following.delete(i); } return j(res, 204); }
    if ((m === "PUT" || m === "DELETE") && (mm = /^\/playlists\/([^/]+)\/followers$/.exec(path))) return j(res, 200, {});
    if (m === "POST" && (mm = /^\/playlists\/([^/]+)\/(items|tracks)$/.exec(path))) { state.plAdds.push({ playlist: mm[1], uris: body?.uris ?? [] }); return j(res, 201, { snapshot_id: "s1" }); }
    if (m === "GET" && (mm = /^\/artists\/([^/]+)$/.exec(path))) { const a = ARTISTS.find((x) => x.id === mm[1]); return a ? j(res, 200, a) : j(res, 404, { error: { status: 404, message: "Not found" } }); }
    if (m === "GET" && (mm = /^\/artists\/([^/]+)\/top-tracks$/.exec(path))) return state.closedTopTracks ? j(res, 403, { error: { status: 403, message: "Forbidden" } }) : j(res, 200, { tracks: TRACKS.filter((t) => t.artists[0].id === mm[1]).slice(0, 10) });
    if (m === "GET" && (mm = /^\/artists\/([^/]+)\/albums$/.exec(path))) return j(res, 200, pageOf(ALBUMS.filter((a) => a.artists[0].id === mm[1]), url));
    if (m === "GET" && (mm = /^\/albums\/([^/]+)$/.exec(path))) { const a = ALBUMS.find((x) => x.id === mm[1]); return a ? j(res, 200, a) : j(res, 404, { error: { status: 404, message: "Not found" } }); }
    if (m === "GET" && (mm = /^\/albums\/([^/]+)\/tracks$/.exec(path))) { const a = ALBUMS.find((x) => x.id === mm[1]); return j(res, 200, pageOf(TRACKS.filter((t) => t.album.id === a?.id).map((t) => ({ ...t, album: undefined })), url)); }
    if (m === "GET" && path === "/search") {
      const lim = Number(url.searchParams.get("limit") ?? 20), off = Number(url.searchParams.get("offset") ?? 0);
      if (lim > 10) { state.searchLimitViolations++; return j(res, 400, { error: { status: 400, message: "Invalid limit" } }); }
      const q = (url.searchParams.get("q") ?? "").toLowerCase().replace(/^artist:"(.+)"$/, "$1"), types = (url.searchParams.get("type") ?? "track").split(",");
      const hit = (name) => q.split(/\s+/).some((w) => name.toLowerCase().includes(w)) || /song|artist|album|mix|list/.test(q);
      const out = {};
      const src = { track: TRACKS, artist: ARTISTS, album: ALBUMS, playlist: PLAYLISTS.filter((p) => !p.closed) };
      for (const t of types) { const all = (src[t] ?? []).filter((x) => hit(x.name) || x.artists?.some((a) => a.name.toLowerCase().includes(q))); const items = all.slice(off, off + lim); out[`${t}s`] = { items, total: all.length, next: off + lim < all.length ? "next" : null }; }
      return j(res, 200, out);
    }
    if (m === "POST" && path === "/me/player/queue") { state.queue.push(url.searchParams.get("uri")); return j(res, 204); }
    if (m === "PUT" && path === "/me/player/play") { state.lastPlay = body; return j(res, 204); }
    if (m === "PUT" && /^\/me\/player\/(shuffle|repeat|pause|seek|volume)$/.test(path)) return j(res, 204);
    if (m === "GET" && path === "/me/player/devices") return j(res, 200, { devices: [{ id: "dev-screen", name: "Dayspring" }] });
    return j(res, 404, { error: { status: 404, message: `mock: no ${m} ${path}` } });
  }

  // one server: Spotify's Web API and the YouTube pages (127.0.0.1)
  const serverA = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    let raw = ""; for await (const c of req) raw += c;
    let body = null; try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    if (url.pathname.startsWith("/v1/")) return spotifyApi(req, res, url, body);
    if (url.pathname === "/accounts/api/token") return j(res, 400, { error: "invalid_grant" });
    // ---- YouTube
    const signed = Boolean(cookieOf(req, "SAPISID"));
    const html = (s, code = 200) => { res.writeHead(code, { "content-type": "text/html; charset=utf-8" }); res.end(s); };
    state.calls.push(`YT ${req.method} ${url.pathname}${url.search}`);
    if (url.pathname === "/") return html(page({ contents: {} }, { loggedIn: signed }));
    if (url.pathname === "/yt-signin") return html(`<!doctype html><title>Sign in (mock)</title><p>Mock Google sign-in</p><button id="signin" onclick="fetch('/yt-signin/done').then(()=>{localStorage.setItem('ytSession','1');document.body.dataset.done='1'})">Sign in</button>`);
    if (url.pathname === "/yt-signin/done") { res.writeHead(200, { "set-cookie": ["SAPISID=qa-sapisid-value; Path=/", "SID=qa-sid; Path=/; HttpOnly"], "content-type": "text/plain" }); return res.end("ok"); }
    if (url.pathname === "/feed/history") return html(page({ contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: signed ? historyPage(state.removed) : [] } } } }] } } }, { loggedIn: signed }));
    if (url.pathname === "/feed/subscriptions") return html(page({ contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { richGridRenderer: { contents: signed ? [...Array.from({ length: 12 }, (_, i) => ({ richItemRenderer: { content: v(100 + i) } })), { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: "S2" } } } }] : [] } } } }] } } }, { loggedIn: signed }));
    if (url.pathname === "/feed/channels") return html(page({ contents: { sectionListRenderer: { contents: signed ? [...CHANNELS, { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: "C2" } } } }] : [] } } }, { loggedIn: signed }));
    if (url.pathname === "/feed/playlists") return html(page({ contents: { richGridRenderer: { contents: signed ? [{ lockupViewModel: { contentId: "PLqaworship0000000001", contentType: "LOCKUP_CONTENT_TYPE_PLAYLIST", metadata: { lockupMetadataViewModel: { title: { content: "Worship Songs" } } } } }, { lockupViewModel: { contentId: "PLqabiking00000000002", contentType: "LOCKUP_CONTENT_TYPE_PLAYLIST", metadata: { lockupMetadataViewModel: { title: { content: "Biking" } } } } }] : [] } } }, { loggedIn: signed }));
    if (url.pathname === "/playlist") {
      const list = url.searchParams.get("list") ?? "", n = list === "LL" ? 75 : list === "WL" ? 8 : 20;
      if ((list === "LL" || list === "WL") && !signed) return html(page({ contents: {} }, { loggedIn: false }));
      return html(page({ metadata: { playlistMetadataRenderer: { title: list === "LL" ? "Liked videos" : list === "WL" ? "Watch later" : "Worship Songs" } }, contents: { playlistVideoListRenderer: { contents: Array.from({ length: n }, (_, i) => ({ playlistVideoRenderer: { videoId: vid("p" + list.slice(0, 2), i), title: { runs: [{ text: `${list} item ${i + 1}` }] }, shortBylineText: { runs: [{ text: "A Channel" }] }, lengthText: { simpleText: "4:05" }, isPlayable: true } })) } } }, { loggedIn: signed }));
    }
    if (url.pathname === "/results") {
      const q = url.searchParams.get("search_query") ?? "", sp = url.searchParams.get("sp") ?? "";
      if (sp === "EgIQAg%3D%3D" || sp === "EgIQAg==") return html(page({ contents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [{ channelRenderer: { channelId: "UCwoodworkingweekly001", title: { simpleText: "Woodworking Weekly" }, subscriberCountText: { simpleText: "@woodworkingweekly" }, videoCountText: { simpleText: "210K subscribers" }, navigationEndpoint: { browseEndpoint: { canonicalBaseUrl: "/@woodworkingweekly" } } } }] } }] } } }));
      if (sp === "EgIQAw%3D%3D" || sp === "EgIQAw==") return html(page({ contents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: Array.from({ length: 4 }, (_, i) => ({ playlistRenderer: { playlistId: `PLsearch${i}000000000000`, title: { simpleText: `${q} playlist ${i + 1}` }, shortBylineText: { runs: [{ text: "Some Curator" }] }, videoCount: "12" } })) } }] } } }));
      return html(page({ contents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: SEARCH_VIDEOS(q) } }] } } }));
    }
    if (url.pathname.startsWith("/youtubei/v1/")) {
      const auth = req.headers.authorization ?? "";
      // YouTube's own check: SAPISIDHASH <ts>_<sha1(ts + " " + SAPISID + " " + origin)>
      const sid = cookieOf(req, "SAPISID"), m2 = /^SAPISIDHASH (\d+)_([0-9a-f]{40})$/.exec(auth);
      const origin = req.headers["x-origin"] ?? req.headers.origin ?? "";
      if (!sid || !m2 || createHash("sha1").update(`${m2[1]} ${sid} ${origin}`).digest("hex") !== m2[2]) { state.ytAuthFails++; return j(res, 401, { error: { code: 401, message: "not signed in" } }); }
      const ep = url.pathname.slice("/youtubei/v1/".length);
      if (ep === "browse" && body?.continuation) { const items = historyMore(body.continuation, state.removed); return j(res, 200, { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: items } }] }); }
      if (ep === "browse" && body?.browseId === "FEhistory") return j(res, 200, { contents: { sectionListRenderer: { contents: historyPage(state.removed, body.query ?? "") } } });
      if (ep === "feedback") { for (const t of body?.feedbackTokens ?? []) { state.feedback.push(t); state.removed.add(String(t).replace(/^rm-/, "")); } return j(res, 200, { feedbackResponses: [{ isProcessed: true }] }); }
      if (ep === "account/account_menu") return j(res, 200, { actions: [{ openPopupAction: { popup: { multiPageMenuRenderer: { header: { activeAccountHeaderRenderer: { accountName: { simpleText: "QA Owner" }, email: { simpleText: "qa-owner@example.test" } } } } } } }] });
      return j(res, 404, { error: "no such call" });
    }
    return html("not found", 404);
  });
  // another host name (localhost): Spotify's web player and its sign-in, so its cookies belong to another site
  const serverB = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const signed = Boolean(cookieOf(req, "sp_dc"));
    const html = (s) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(s); };
    if (url.pathname === "/sp-login") return html(`<!doctype html><title>Log in (mock)</title><button id="login" onclick="fetch('/sp-login/done').then(()=>{localStorage.setItem('spSession','1');document.body.dataset.done='1'})">Log in</button>`);
    if (url.pathname === "/sp-login/done") { res.writeHead(200, { "set-cookie": ["sp_dc=qa-spdc-value; Path=/", "sp_key=qa; Path=/"], "content-type": "text/plain" }); return res.end("ok"); }
    return html(`<!doctype html><title>Spotify (mock)</title>${signed ? `<button data-testid="user-widget-link" aria-label="QA Owner">QA</button>` : `<button data-testid="login-button">Log in</button>`}<main>web player ${esc(url.pathname)}</main>`);
  });
  const esc = (s) => String(s).replace(/[<>&"]/g, "");
  await new Promise((r) => serverA.listen(0, "127.0.0.1", r));
  await new Promise((r) => serverB.listen(0, "127.0.0.1", r));
  const a = `http://127.0.0.1:${serverA.address().port}`, b = `http://localhost:${serverB.address().port}`;
  return {
    url: a, spotify: a, yt: a, sp: b, state,
    grant: (token, scopes) => state.scopes.set(token, scopes),
    tracks: TRACKS, playlists: PLAYLISTS, albums: ALBUMS, artists: ARTISTS, recent,
    close: () => Promise.all([new Promise((r) => serverA.close(r)), new Promise((r) => serverB.close(r))]),
  };
}
