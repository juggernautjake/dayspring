// A pretend Spotify for scripts/qa/music.mjs: local fixtures only, no network, no real account.
//   /v1/…   the Web API calls Dayspring makes (search with field filters and paging capped at 10, artists and their
//           genres, playlist contents, the owner's playlists and likes, the player: play, shuffle, queue, state)
//   /web/…  a web-player look-alike (search pages, playlist pages, library sidebar, now-playing bar) with the
//           data-testids the media window reads
// Search ranks like a loose real search: any query word matches, most words first, then popularity. That's what
// made "christian fold music" come back as a pop playlist with the old first-result code.
import { createServer } from "node:http";

const A = (id, name, genres, popularity) => ({ id, name, genres, popularity, uri: `spotify:artist:${id}`, type: "artist", followers: { total: popularity * 10000 } });
export const ARTISTS = [
  A("grayhavens", "The Gray Havens", ["christian indie", "christian folk"], 48), A("garrels", "Josh Garrels", ["christian indie", "christian folk", "indie folk"], 55),
  A("gungor", "Gungor", ["christian indie", "christian folk"], 45), A("rend", "Rend Collective", ["ccm", "christian folk", "worship"], 62),
  A("assad", "Audrey Assad", ["ccm", "christian folk"], 44), A("pagecxvi", "Page CXVI", ["christian folk", "hymns"], 40),
  A("blake", "Hollow Pines", ["ccm", "worship"], 78), A("hillsong", "Hillsong Worship", ["worship", "ccm"], 75), A("elevation", "Elevation Worship", ["worship", "ccm"], 77),
  A("maverick", "Maverick City Music", ["worship", "gospel"], 74), A("leeland", "Leeland", ["worship", "ccm"], 60),
  A("cash", "Johnny Cash", ["country", "outlaw country", "rockabilly"], 80), A("cashtribute", "Jonny Cash Tribute Band", [], 12),
  A("willie", "Willie Nelson", ["country", "outlaw country"], 72), A("waylon", "Waylon Jennings", ["outlaw country", "country"], 66),
  A("taylor", "Taylor Swift", ["pop"], 99), A("dua", "Dua Lipa", ["pop", "dance pop"], 92), A("sabrina", "Sabrina Carpenter", ["pop"], 95),
  A("lofigirl", "Lofi Girl", ["lo fi", "chillhop"], 70), A("nujabes", "Nujabes", ["lo fi", "jazz hip hop"], 65),
  A("jackson", "Alan Jackson", ["country", "classic country"], 70), A("strait", "George Strait", ["country", "classic country"], 72), A("garth", "Garth Brooks", ["country"], 71),
  A("skaggs", "Ricky Skaggs", ["bluegrass", "bluegrass gospel"], 45), A("isaacs", "The Isaacs", ["bluegrass gospel", "southern gospel"], 40),
  A("gaither", "Gaither Vocal Band", ["southern gospel"], 50), A("peck", "Karen Peck & New River", ["southern gospel"], 35), A("hoppers", "The Hoppers", ["southern gospel"], 30),
  A("mumford", "Mumford & Sons", ["folk rock", "indie folk"], 76), A("lumineers", "The Lumineers", ["indie folk", "folk rock"], 75),
  A("chris", "Chris Tomlin", ["ccm", "worship"], 70), A("klugh", "Earl Klugh", ["smooth jazz"], 35), A("karaoke", "Karaoke Kings", [], 20),
];
const art = Object.fromEntries(ARTISTS.map((a) => [a.id, a]));
const T = (id, name, artistIds, popularity, album = "") => ({ id, name, popularity, uri: `spotify:track:${id}`, type: "track", duration_ms: 200000, artists: artistIds.map((x) => ({ id: x, name: art[x].name, uri: art[x].uri })), album: { name: album, images: [] } });
export const TRACKS = [
  T("gratitude", "Gratitude", ["blake"], 85, "House of Miracles"), T("gratitude2", "Gratitude", ["klugh"], 25, "Late Night"), T("gratitudek", "Gratitude (Karaoke Version)", ["karaoke"], 10),
  T("waymaker", "Way Maker", ["leeland"], 70, "Better Word"), T("ringoffire", "Ring of Fire", ["cash"], 82, "Ring of Fire"), T("hurt", "Hurt", ["cash"], 80, "American IV"),
  T("folsom", "Folsom Prison Blues", ["cash"], 75, "At Folsom Prison"), T("ringtribute", "Ring of Fire", ["cashtribute"], 8),
  T("gh1", "Far Kingdom", ["grayhavens"], 40), T("gh2", "Take Me Home", ["grayhavens"], 42), T("gh3", "Diamonds", ["grayhavens"], 38),
  T("jg1", "White Owl", ["garrels"], 50), T("jg2", "Morning Light", ["garrels"], 52), T("jg3", "Heaven's Knife", ["garrels"], 46),
  T("gu1", "Beautiful Things", ["gungor"], 60), T("gu2", "Dry Bones", ["gungor"], 40), T("rc1", "My Lighthouse", ["rend"], 65), T("rc2", "Build Your Kingdom Here", ["rend"], 60),
  T("aa1", "I Shall Not Want", ["assad"], 50), T("pc1", "Come Thou Fount", ["pagecxvi"], 45),
  T("hs1", "What A Beautiful Name", ["hillsong"], 80), T("el1", "Graves Into Gardens", ["elevation"], 79), T("mv1", "Promises", ["maverick"], 76), T("ct1", "Good Good Father", ["chris"], 70),
  T("wn1", "On the Road Again", ["willie"], 74), T("wj1", "Mammas Don't Let Your Babies", ["waylon", "willie"], 60),
  T("ts1", "Cruel Summer", ["taylor"], 97), T("dl1", "Levitating", ["dua"], 93), T("sc1", "Espresso", ["sabrina"], 96),
  T("lf1", "Snowman", ["lofigirl"], 60), T("nj1", "Feather", ["nujabes"], 66), T("aj1", "Chattahoochee", ["jackson"], 70), T("gs1", "Amarillo By Morning", ["strait"], 72),
  T("gb1", "Friends in Low Places", ["garth"], 78), T("rs1", "Somebody's Prayin'", ["skaggs"], 35), T("ri1", "Stand Still", ["isaacs"], 30), T("ri2", "I Want To Be Ready", ["isaacs"], 28),
  T("gv1", "Because He Lives", ["gaither"], 45), T("kp1", "Four Days Late", ["peck"], 30), T("hp1", "Jerusalem", ["hoppers"], 25),
  T("mf1", "I Will Wait", ["mumford"], 75), T("lu1", "Ho Hey", ["lumineers"], 74),
];
const tr = Object.fromEntries(TRACKS.map((t) => [t.id, t]));
const P = (id, name, description, owner, followers, trackIds, extra = {}) => ({ id, name, description, uri: `spotify:playlist:${id}`, type: "playlist", owner: { id: owner.toLowerCase().replace(/\W/g, ""), display_name: owner }, followers: { total: followers }, items: { total: trackIds.length }, trackIds, images: [], ...extra });
export const PLAYLISTS = [
  P("cpop", "Christian Pop Hits", "The biggest Christian radio hits right now", "Spotify", 900000, ["hs1", "el1", "mv1", "ct1", "gratitude"]),
  P("cfolk", "Christian Folk", "Acoustic faith folk from The Gray Havens, Josh Garrels, Gungor and more", "Folk Worship Co", 12000, ["gh1", "jg1", "gu1", "rc1", "aa1", "pc1", "gh2", "jg2"]),
  P("cfolk2", "Christian Folk & Americana", "Rootsy faith songs", "Porch Songs", 3000, ["jg3", "gh3", "gu2", "rc2", "pc1"]),
  P("cfoldr", "Christian Folk Radar", "Fresh faith folk", "Spotify", 50000, ["gh1", "jg1"], { restricted: true }),
  P("pophits", "Pop Music Hits 2026", "Today's top pop hits", "Spotify", 5000000, ["ts1", "dl1", "sc1"]),
  P("indiefolk", "Indie Folk Essentials", "Mumford, The Lumineers and more", "Folk Fans", 300000, ["mf1", "lu1"]),
  P("worshipnow", "Worship Now", "Top worship songs", "Worship Daily", 2000000, ["hs1", "el1", "gratitude", "mv1", "ct1"]),
  P("worshipnohs", "Worship Without Borders", "Worship songs from around the world", "Worship Daily", 50000, ["el1", "gratitude", "mv1", "ct1"]),
  P("country90", "90s Country", "The best country of the 90s", "Country Classics", 400000, ["aj1", "gs1", "gb1"]),
  P("lofibeats", "Lo-Fi Beats", "Lo-fi hip hop to relax and study to", "Lofi Girl", 1500000, ["lf1", "nj1"]),
  P("calmstudy", "Calm Study", "Calm instrumental focus music for studying", "Study Music", 200000, ["nj1", "lf1"]),
  P("workout", "Upbeat Workout", "High energy upbeat songs for the gym", "Fit Tunes", 800000, ["dl1", "sc1", "ts1"]),
  P("bggospel", "Bluegrass Gospel Classics", "Old-time bluegrass gospel", "Holler Records", 40000, ["rs1", "ri1", "ri2"]),
  P("thisiscash", "This Is Johnny Cash", "The essential Johnny Cash tracks", "Spotify", 1200000, ["ringoffire", "hurt", "folsom"]),
  P("roadtrip", "Road Trip", "", "Me", 0, ["wn1", "gb1", "ringoffire"], { mine: true }),
  P("sunday", "Sunday Morning", "", "Me", 0, ["hs1", "gratitude", "rc1"], { mine: true }),
  P("dw", "Discover Weekly", "Your weekly mixtape", "Spotify", 0, ["jg2", "gh2", "mf1"], { mine: true }),
];
const pl = Object.fromEntries(PLAYLISTS.map((p) => [p.id, p]));
export const ALBUMS = [
  { id: "folsomalb", name: "At Folsom Prison", uri: "spotify:album:folsomalb", type: "album", popularity: 70, artists: [{ id: "cash", name: "Johnny Cash" }], trackIds: ["folsom"] },
  { id: "homealb", name: "Home", uri: "spotify:album:homealb", type: "album", popularity: 40, artists: [{ id: "garrels", name: "Josh Garrels" }], trackIds: ["jg1", "jg2"] },
  { id: "homealb2", name: "Home", uri: "spotify:album:homealb2", type: "album", popularity: 45, artists: [{ id: "taylor", name: "Taylor Swift" }], trackIds: ["ts1"] },
  { id: "houseofm", name: "House of Miracles", uri: "spotify:album:houseofm", type: "album", popularity: 72, artists: [{ id: "blake", name: "Hollow Pines" }], trackIds: ["gratitude"] },
];
const al = Object.fromEntries(ALBUMS.map((a) => [a.id, a]));
const LIKED = ["jg1", "gh1", "ringoffire", "hs1"];

// ---- search ----
const norm = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
const wordIn = (w, text) => text.split(" ").some((t) => t === w || (w.length >= 5 && t.length >= 5 && lev(w, t) <= 1));
function parseQ(q) {
  const f = {}; let rest = String(q);
  rest = rest.replace(/\b(artist|track|album|genre):(?:"([^"]*)"|(\S+))/g, (_, k, a, b) => { f[k] = norm(a ?? b); return " "; });
  return { f, words: norm(rest).split(" ").filter(Boolean) };
}
const textFor = { track: (t) => `${t.name} ${t.artists.map((a) => a.name).join(" ")}`, artist: (a) => a.name, album: (a) => `${a.name} ${a.artists.map((x) => x.name).join(" ")}`, playlist: (p) => `${p.name} ${p.description}` };
const popOf = { track: (t) => t.popularity, artist: (a) => a.popularity, album: (a) => a.popularity, playlist: (p) => Math.min(100, Math.log10(p.followers.total + 1) * 15) };
export function searchAll(q, type) {
  const { f, words } = parseQ(q);
  const pool = { track: TRACKS, artist: ARTISTS, album: ALBUMS, playlist: PLAYLISTS.filter((p) => !p.mine || p.id === "dw") }[type] ?? [];
  const hits = [];
  for (const x of pool) {
    if (f.artist && !(type === "artist" ? norm(x.name) === f.artist : (x.artists ?? []).some((a) => norm(a.name) === f.artist))) continue;
    if (f.track && !(type === "track" && norm(x.name).includes(f.track))) continue;
    if (f.album && !(type === "album" && norm(x.name).includes(f.album))) continue;
    if (f.genre) { const gs = type === "artist" ? x.genres : type === "track" ? (x.artists ?? []).flatMap((a) => art[a.id]?.genres ?? []) : null; if (!gs || !gs.includes(f.genre)) continue; }
    const text = norm(textFor[type](x));
    const m = words.filter((w) => wordIn(w, text)).length;
    if (words.length && !m) continue;
    hits.push({ x, s: m * 1.0 + popOf[type](x) / 70 });
  }
  return hits.sort((a, b) => b.s - a.s).map((h) => h.x);
}
const out = {
  track: (t) => ({ id: t.id, name: t.name, uri: t.uri, type: "track", popularity: t.popularity, duration_ms: t.duration_ms, artists: t.artists, album: t.album, external_urls: { spotify: `https://open.spotify.com/track/${t.id}` } }),
  artist: (a) => ({ id: a.id, name: a.name, uri: a.uri, type: "artist", genres: a.genres, popularity: a.popularity, followers: a.followers, images: [] }),
  album: (a) => ({ id: a.id, name: a.name, uri: a.uri, type: "album", artists: a.artists, images: [] }),
  playlist: (p) => ({ id: p.id, name: p.name, uri: p.uri, type: "playlist", description: p.description, owner: p.owner, followers: p.followers, items: p.items, images: [] }),
};

// ---- the server ----
export async function startMock({ port = 0 } = {}) {
  SIDEBAR = SIDEBAR_OF();
  const state = { calls: [], player: { device: "dev-screen", item: null, context: null, playing: false }, liked: [], added: [], queued: [], shuffle: null,
    sabotage: false, unplayable: new Set(), closedSeveral: true, devices: ["dev-screen"] };
  const send = (res, code, body) => { res.writeHead(code, { "content-type": body == null ? "text/plain" : "application/json" }); res.end(body == null ? "" : JSON.stringify(body)); };
  const html = (res, body) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(`<!doctype html><html><body>${SIDEBAR}<main>${body}</main>${nowBar(state)}<script>${PAGE_JS}</script></body></html>`); };
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, "http://x"), p = decodeURIComponent(u.pathname), m = req.method;
    let body = ""; for await (const c of req) body += c;
    const json = body ? JSON.parse(body) : {};
    state.calls.push(`${m} ${p}${u.search}`);
    // ---------------- Web API
    if (p.startsWith("/v1/")) {
      const path = p.slice(3);
      if (m === "GET" && path === "/search") {
        const types = (u.searchParams.get("type") ?? "track").split(","), limit = Math.min(10, Number(u.searchParams.get("limit") ?? 5)), offset = Number(u.searchParams.get("offset") ?? 0);
        const r = {};
        for (const t of types) { const all = searchAll(u.searchParams.get("q") ?? "", t); const page = all.slice(offset, offset + limit).map(out[t]); if (t === "playlist" && page.length > 2) page.splice(2, 0, null); r[`${t}s`] = { items: page, total: all.length, next: offset + limit < all.length ? "more" : null, offset, limit }; }
        return send(res, 200, r);
      }
      if (m === "GET" && path === "/artists") { if (state.closedSeveral) return send(res, 403, { error: { status: 403, message: "Forbidden" } }); return send(res, 200, { artists: (u.searchParams.get("ids") ?? "").split(",").map((id) => art[id] ? out.artist(art[id]) : null) }); }
      let mm;
      if (m === "GET" && (mm = /^\/artists\/(\w+)\/top-tracks$/.exec(path))) return send(res, 403, { error: { status: 403, message: "Forbidden" } });
      if (m === "GET" && (mm = /^\/artists\/(\w+)$/.exec(path))) return art[mm[1]] ? send(res, 200, out.artist(art[mm[1]])) : send(res, 404, { error: { status: 404, message: "Not found" } });
      if (m === "GET" && (mm = /^\/playlists\/(\w+)\/(items|tracks)$/.exec(path))) { const x = pl[mm[1]]; if (!x || x.restricted) return send(res, 404, { error: { status: 404, message: "Resource not found" } }); return send(res, 200, { items: x.trackIds.map((id) => ({ item: out.track(tr[id]) })), total: x.trackIds.length }); }
      if (m === "GET" && (mm = /^\/albums\/(\w+)\/tracks$/.exec(path))) { const x = al[mm[1]]; return x ? send(res, 200, { items: x.trackIds.map((id) => out.track(tr[id])) }) : send(res, 404, {}); }
      if (m === "GET" && path === "/me/playlists") return send(res, 200, { items: PLAYLISTS.filter((x) => x.mine).map((x) => ({ ...out.playlist(x), owner: { id: x.id === "dw" ? "spotify" : "me", display_name: x.owner.display_name } })) });
      if (m === "GET" && path === "/me/tracks") return send(res, 200, { items: LIKED.map((id) => ({ track: out.track(tr[id]) })) });
      if (m === "PUT" && path === "/me/library") { state.liked.push(u.searchParams.get("uris")); return send(res, 200, null); }
      if (m === "POST" && (mm = /^\/playlists\/(\w+)\/items$/.exec(path))) { state.added.push({ playlist: mm[1], uris: json.uris }); return send(res, 201, { snapshot_id: "x" }); }
      if (m === "GET" && path === "/me/player/devices") return send(res, 200, { devices: state.devices.map((id) => ({ id, name: "Dayspring", is_active: true })) });
      if (m === "PUT" && path === "/me/player/shuffle") { state.shuffle = u.searchParams.get("state") === "true"; return send(res, 204, null); }
      if (m === "POST" && path === "/me/player/queue") { state.queued.push(u.searchParams.get("uri")); return send(res, 204, null); }
      if (m === "PUT" && path === "/me/player/play") {
        const dev = u.searchParams.get("device_id");
        if (!state.devices.includes(dev)) return send(res, 404, { error: { status: 404, message: "Device not found", reason: "NO_ACTIVE_DEVICE" } });
        const target = json.context_uri ?? json.uris?.[0];
        if (state.unplayable.has(target)) return send(res, 404, { error: { status: 404, message: "Not found" } });
        state.lastPlay = json;
        let item = null, context = null;
        if (json.context_uri) {
          const [, kind, id] = json.context_uri.split(":");
          const ids = kind === "playlist" ? pl[id]?.trackIds : kind === "album" ? al[id]?.trackIds : kind === "artist" ? TRACKS.filter((t) => t.artists.some((a) => a.id === id)).map((t) => t.id) : [];
          item = tr[ids?.[json.offset?.position ?? 0] ?? ids?.[0]]; context = json.context_uri;
        } else item = tr[json.uris[0].split(":")[2]];
        // sabotage: Spotify keeps playing some pop song instead (what a mismatch check has to catch)
        state.player = state.sabotage ? { device: dev, item: tr.sc1, context: "spotify:playlist:pophits", playing: true } : { device: dev, item, context, playing: true };
        return send(res, 204, null);
      }
      if (m === "GET" && (path === "/me/player" || path === "/me/player/currently-playing")) {
        const s = state.player;
        if (!s.item) return send(res, 204, null);
        return send(res, 200, { device: { id: s.device }, is_playing: s.playing, item: out.track(s.item), context: s.context ? { uri: s.context } : null });
      }
      return send(res, 404, { error: { status: 404, message: `mock has no ${m} ${path}` } });
    }
    // ---------------- the web player look-alike
    if (p === "/web" || p === "/web/") return html(res, "<h1>Home</h1>");
    let wm;
    if ((wm = /^\/web\/search\/([^/]+)(?:\/(tracks|artists|albums|playlists))?$/.exec(p))) {
      const q = wm[1], only = wm[2]?.replace(/s$/, "");
      const sec = (t, n) => searchAll(q, t).slice(0, n);
      let h = "";
      if (!only || only === "track") h += `<section><h2>Songs</h2>${sec("track", only ? 10 : 4).map((t) => `<div data-testid="tracklist-row" role="row"><a href="/track/${t.id}">${esc(t.name)}</a> ${t.artists.map((a) => `<a href="/artist/${a.id}">${esc(a.name)}</a>`).join(", ")}</div>`).join("")}</section>`;
      for (const t of ["artist", "album", "playlist"]) if (!only || only === t) h += `<section><h2>${t}s</h2>${sec(t, only ? 10 : 5).map((x) => `<div data-encore-id="card" role="group"><a href="/${t}/${x.id}" title="${esc(x.name)}"><span data-encore-id="cardTitle">${esc(x.name)}</span></a><div data-encore-id="cardSubtitle">${esc(t === "playlist" ? x.description || "By " + x.owner.display_name : t === "album" ? x.artists.map((a) => a.name).join(", ") : "Artist")}</div></div>`).join("")}</section>`;
      return html(res, h);
    }
    if ((wm = /^\/web\/(playlist|album)\/(\w+)$/.exec(p))) {
      const x = wm[1] === "playlist" ? pl[wm[2]] : al[wm[2]];
      if (!x) return html(res, "<h1>Not found</h1>");
      const rows = x.trackIds.map((id) => tr[id]);
      return html(res, `<h1>${esc(x.name)}</h1><div data-testid="description">${esc(x.description ?? "")}</div><div data-testid="action-bar-row"><button data-testid="play-button" data-first="${esc(rows[0].name)}" data-by="${esc(rows[0].artists.map((a) => a.name).join(", "))}" data-sabotage="${state.sabotage ? 1 : ""}">Play</button></div>${rows.map((t) => `<div data-testid="tracklist-row"><a href="/track/${t.id}">${esc(t.name)}</a> ${t.artists.map((a) => `<a href="/artist/${a.id}">${esc(a.name)}</a>`).join(", ")}</div>`).join("")}`);
    }
    if ((wm = /^\/web\/(artist|track)\/(\w+)$/.exec(p))) {
      const x = wm[1] === "artist" ? art[wm[2]] : tr[wm[2]];
      const first = wm[1] === "artist" ? TRACKS.find((t) => t.artists.some((a) => a.id === x.id)) : x;
      return html(res, `<h1>${esc(x.name)}</h1><div data-testid="action-bar-row"><button data-testid="play-button" data-first="${esc(first.name)}" data-by="${esc(first.artists.map((a) => a.name).join(", "))}" data-sabotage="${state.sabotage ? 1 : ""}">Play</button></div>`);
    }
    return send(res, 404, { error: "no such page" });
  });
  await new Promise((ok) => server.listen(port, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, state, close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }) };
}
const SIDEBAR_OF = () => `<nav>${PLAYLISTS.filter((x) => x.mine).map((x) => `<div data-testid="rootlist-item" aria-labelledby="listrow-title-spotify:playlist:${x.id}"><span data-encore-id="listRowTitle">${x.name}</span></div>`).join("")}</nav>`;
let SIDEBAR = "";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const nowBar = () => `<footer><div data-testid="now-playing-widget"><a data-testid="context-item-link"></a> <span data-testid="context-item-info-artist"></span></div><button data-testid="control-button-playpause" aria-label="Play"></button></footer>`;
// the play button fills the now-playing bar with the first song (or, sabotaged, a pop song)
const PAGE_JS = `document.addEventListener("click", (e) => { const b = e.target.closest('[data-testid="play-button"]'); if (!b) return;
  const sab = b.dataset.sabotage === "1";
  document.querySelector('[data-testid="context-item-link"]').textContent = sab ? "Espresso" : b.dataset.first;
  document.querySelector('[data-testid="context-item-info-artist"]').textContent = sab ? "Sabrina Carpenter" : b.dataset.by;
  document.querySelector('[data-testid="control-button-playpause"]').setAttribute("aria-label", "Pause"); });`;
