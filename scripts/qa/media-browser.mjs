// The Music & Video browser (lib/mediabrowser, public/mediabrowser.js) and signing in to YouTube / Spotify in the media
// window (lib/mediasignin.mjs). Mocks only: a pretend Spotify Web API and pretend YouTube pages and sign-in pages
// (fixtures/mediabrowser/mock.mjs), throwaway media files made with ffmpeg, a throwaway media-window profile (headless,
// muted Chrome), a throwaway copy of Dayspring for the screen. Never the owner's accounts, data folder, running
// Dayspring, DayspringMedia profile or Chrome; no sound is played.
//   1. Spotify: every section loads and pages (playlists, a playlist's songs, Liked Songs, albums, followed artists, top
//      artists and songs over three ranges, recently played and one day of it, the queue, now playing)
//   2. the scope upgrade: a sign-in without a permission asks for it ("Grant access…"), and the new sign-in asks for all
//   3. Development Mode: closed calls fall back (the web player; an artist's songs from a search) and say so
//   4. search: grouped, at most 10 per call, "Load more" pages, genres and moods; YouTube: Videos · Channels · Playlists,
//      filters (length, no Shorts)
//   5. play, play next, queue, like, save, follow, add to playlist; the study-time rule
//   6. voice: opening phrases, "what did I listen to yesterday", "my top songs this month", the offline intents, and
//      voice numbering ("play number 3", "queue number 2", "like number 4", "open number 1", "more") on whatever is showing
//   7. the media window (headless): signing in to YouTube and Spotify is noticed, the account shown; watch history pages
//      (continuations), remove from history, search in history, subscriptions and channels, his playlists, Liked videos,
//      Watch later; "what did I watch last night"; the expiry notice (once); signing out clears only that site
//   8. his own files: sections, albums and artists from tags, search, play and queue
//   9. the screen (headless Chrome at 1280×720, 1920×1080 and Dayspring mini): the window, live search (debounced,
//      grouped), infinite scroll, grid, multi-select, the Grant access card, the web player card, numbers for voice,
//      inside the screen's margins and every button clickable
//   node scripts/qa/media-browser.mjs [--verbose] [--no-screen]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startMock } from "./fixtures/mediabrowser/mock.mjs";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2), VERBOSE = args.includes("--verbose");
const CHROME = process.env.QA_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PW = [join(DESK, "node_modules", "playwright-core", "index.mjs"), join(DESK, "..", "..", "..", "dayspring-app", "node_modules", "playwright-core", "index.mjs")].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const rec = (area, ok, note = "") => { if (ok) passed++; else failed++; if (!ok || VERBOSE) console.log(`${ok ? "PASS" : "FAIL"}  ${area}${note !== "" ? " — " + String(note).slice(0, 300) : ""}`); };
const section = (s) => console.log(`\n== ${s}`);
const j = (x) => JSON.stringify(x);
async function until(fn, ms = 6000) { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch { /* not yet */ } await sleep(80); } return v; }

const TMP = mkdtempSync(join(tmpdir(), "ds-mbrowser-"));
const mock = await startMock();
const ALL = ["streaming", "user-read-email", "user-read-private", "user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing", "user-read-recently-played", "playlist-read-private", "playlist-read-collaborative", "playlist-modify-private", "playlist-modify-public", "user-library-read", "user-library-modify", "user-top-read", "user-follow-read", "user-follow-modify"];
mock.grant("qa-full", ALL);
mock.grant("qa-old", ALL.filter((s) => !/follow|user-top-read/.test(s)));
const HOME = join(TMP, "home"), MUSIC = join(HOME, "Music");
Object.assign(process.env, {
  SPOTIFY_CLIENT_ID: "qa-test-client", DAYSPRING_SPOTIFY_API: `${mock.url}/v1`, DAYSPRING_SPOTIFY_ACCOUNTS: `${mock.url}/accounts`, DAYSPRING_SPOTIFY_TOKEN_FILE: join(TMP, "spotify-token.json"),
  DAYSPRING_MB_FILE: join(TMP, "media-browser.json"), DAYSPRING_MEDIA_SIGNIN_FILE: join(TMP, "media-signin.json"), DAYSPRING_SIGNIN_POLL_MS: "250",
  DAYSPRING_VIDEO_QUEUE: join(TMP, "video-queue.json"), DAYSPRING_VIDEO_PREFS: join(TMP, "video-prefs.json"), DAYSPRING_VIDEO_CREATORS: join(TMP, "video-creators.json"), DAYSPRING_VIDEO_ACCOUNT: join(TMP, "video-account.json"),
  DAYSPRING_MEDIA_FILE: join(TMP, "media.json"), DAYSPRING_VIDEOLISTS_FILE: join(TMP, "video-playlists.json"), DAYSPRING_FEATURE_SWITCHES: join(TMP, "feature-switches.json"), DAYSPRING_FEATURE_STAGES: join(TMP, "feature-stages.json"), DAYSPRING_CHANNEL: "stable",
  DAYSPRING_YT_BASE: mock.yt, DAYSPRING_YT_WEB: mock.yt, DAYSPRING_YT_SIGNIN: `${mock.yt}/yt-signin`, DAYSPRING_YT_API: `${mock.yt}/youtube/v3`, DAYSPRING_SPOTIFY_WEB: mock.sp, DAYSPRING_SPOTIFY_SIGNIN: `${mock.sp}/sp-login`,
  DAYSPRING_MEDIA_PROFILE: join(TMP, "media-profile"), DAYSPRING_SEARCH_PROFILE: join(TMP, "search-profile"), DAYSPRING_MEDIA_HEADLESS: "1", DAYSPRING_MEDIA_CHROME: CHROME, DAYSPRING_NO_HEADLESS_SEARCH: "1", DAYSPRING_NO_BROWSER: "1", DAYSPRING_NO_OPEN: "1",
  DAYSPRING_PERMISSIONS_FILE: join(TMP, "permissions.json"), DAYSPRING_ACTIVITY_DIR: join(TMP, "activity"), DAYSPRING_MEDIALIB_FILE: join(TMP, "media-library.json"), DAYSPRING_MEDIALIB_HOME: HOME, DAYSPRING_MEDIALIB_DELAY_MS: "0",
  DAYSPRING_SETTINGS_FILE: join(TMP, "settings.json"), DAYSPRING_CONNECTORS_DIR: join(TMP, "connectors"), DAYSPRING_INTENT_LEARNED: join(TMP, "learned.json"), DAYSPRING_INTENT_MISSES: join(TMP, "misses.json"),
  DAYSPRING_TIMERS_FILE: join(TMP, "timers.json"), DAYSPRING_RECIPES_FILE: join(TMP, "recipes.json"), DAYSPRING_LISTS_FILE: join(TMP, "lists.json"), DS_FOLLOW_MARK: join(TMP, "follow.json"), DAYSPRING_DEVICES_DRYRUN: "1",
});
const token = (t, scope) => writeFileSync(process.env.DAYSPRING_SPOTIFY_TOKEN_FILE, j({ access_token: t, refresh_token: "qa-refresh", scope: scope.join(" "), expires_at: Date.now() + 3600_000, userId: "qa-owner" }));
token("qa-full", ALL);
writeFileSync(join(TMP, "settings.json"), j({ audioOutputs: ["default"] }));

const imp = (p) => import(pathToFileURL(join(DESK, p)).href);
const media = await imp("lib/media.mjs");
media._setPolicy({ videosAllowed: true });            // not the real schedule
const bus = await imp("lib/bus.mjs");
const events = [];
bus.on((type, data) => events.push({ type, data }));
const lastEv = (type, f = () => true) => [...events].reverse().find((e) => e.type === type && f(e.data))?.data;
const spotifyApi = await imp("lib/spotify-api.mjs");
const mb = await imp("lib/mediabrowser/index.mjs");
const S = mb.spotify, Y = mb.youtube, L = mb.local;
const signin = await imp("lib/mediasignin.mjs");
const video = await imp("lib/video/index.mjs");
const vqueue = await imp("lib/video/queue.mjs");
const features = await imp("lib/features.mjs");
media.setDevice("dev-screen");                         // the screen's Spotify player is there (in-app Spotify)
const reloadTok = async () => { const s = await import(pathToFileURL(join(DESK, "lib/spotify-api.mjs")).href + "?r=" + Math.random()); return s; };
void reloadTok;

try {
  if (args.includes("--only-screen")) throw Object.assign(new Error("skip"), { skip: true });
  rec("the feature is registered: mediabrowser, beta, on in production", features.get("mediabrowser")?.stage === "beta" && features.on("mediabrowser"));
  rec("the new sign-in asks for every permission the browser uses (user-follow-read, user-top-read, user-library-modify…)", ["user-follow-read", "user-top-read", "user-read-recently-played", "user-library-read", "user-library-modify", "playlist-read-private", "playlist-read-collaborative", "playlist-modify-private", "playlist-modify-public"].every((s) => spotifyApi.SCOPES.includes(s) && decodeURIComponent(spotifyApi.loginUrl()).includes(s)));

  // ------------------------------------------------------------------ 1. Spotify sections
  section("1. Spotify: every section loads and pages");
  {
    let r = await mb.section({ source: "spotify", section: "playlists" });
    rec("playlists: all 13 (his, followed, collaborative, Spotify's own)", r.items.length === 13 && r.next === null && r.total === 13, `${r.items.length} ${r.error ?? ""}`);
    const mine = await mb.section({ source: "spotify", section: "playlists", filter: "mine" }), fol = await mb.section({ source: "spotify", section: "playlists", filter: "followed" }), col = await mb.section({ source: "spotify", section: "playlists", filter: "collab" });
    rec("playlists: Yours 7 · Followed 4 · Collaborative 2", mine.items.length === 7 && fol.items.length === 4 && col.items.length === 2, `${mine.items.length}/${fol.items.length}/${col.items.length}`);
    rec("a playlist item has what the browser shows (title, owner and count, art, uri)", /by QA Owner · 30 songs/.test(r.items[0].sub) && r.items[0].uri.startsWith("spotify:playlist:") && r.items[0].art, r.items[0].sub);
    const big = r.items.find((x) => x.title === "My Mix 2");
    let p = await mb.page({ source: "spotify", kind: "playlist", id: big.id });
    rec("a playlist opens inside the browser: its songs, 50 then more", p.items.length === 50 && p.next === 50 && p.total === 52 && p.head?.title === "My Mix 2", `${p.items.length} next ${p.next}`);
    const p2 = await mb.page({ source: "spotify", kind: "playlist", id: big.id, cursor: p.next });
    rec("…Load more: the last 2, and the end", p2.items.length === 2 && p2.next === null);
    rec("…each song knows its playlist (so playing one plays on from there)", p.items[0].context === `spotify:playlist:${big.id}`);
    // Liked Songs: 130, in pages of 50
    const pages = []; let cur = null;
    do { r = await mb.section({ source: "spotify", section: "liked", cursor: cur }); pages.push(r.items.length); cur = r.next; } while (cur != null && pages.length < 6);
    rec("Liked Songs: all 130, in pages of 50 (50, 50, 30), then the end", j(pages) === "[50,50,30]" && r.total === 130, j(pages));
    rec("…marked liked", r.items.every((x) => x.liked));
    const al = await mb.section({ source: "spotify", section: "albums" }), al2 = await mb.section({ source: "spotify", section: "albums", cursor: al.next });
    rec("saved albums: 60 (50 + 10)", al.items.length === 50 && al2.items.length === 10 && al2.next === null && al.items[0].kind === "album");
    const ar = await mb.section({ source: "spotify", section: "artists" }), ar2 = await mb.section({ source: "spotify", section: "artists", cursor: ar.next });
    rec("followed artists: 75 with Spotify's own cursor (50 + 25)", ar.items.length === 50 && typeof ar.next === "string" && ar2.items.length === 25 && ar2.next === null && new Set([...ar.items, ...ar2.items].map((x) => x.id)).size === 75, `${ar.items.length}+${ar2.items.length} next ${ar.next}`);
    const t4 = await mb.section({ source: "spotify", section: "top", range: "short" }), t6 = await mb.section({ source: "spotify", section: "top", range: "medium" }), tall = await mb.section({ source: "spotify", section: "top", range: "long" });
    rec("top songs: 4 weeks / 6 months / all time are different lists", t4.items[0].title !== t6.items[0].title && t6.items[0].title !== tall.items[0].title && t4.rangeLabel === "Last 4 weeks" && tall.rangeLabel === "All time", `${t4.items[0].title} | ${t6.items[0].title} | ${tall.items[0].title}`);
    rec("…ranked, and 70 of them page (50 + 20)", t4.items[0].rank === 1 && t4.next === 50 && (await mb.section({ source: "spotify", section: "top", range: "short", cursor: 50 })).items.length === 20);
    const ta = await mb.section({ source: "spotify", section: "top", type: "artists", range: "medium" });
    rec("top artists", ta.items.length === 50 && ta.items[0].kind === "artist");
    const rp = []; cur = null;
    do { r = await mb.section({ source: "spotify", section: "recent", cursor: cur }); rp.push(...r.items); cur = r.next; } while (cur != null && rp.length < 500);
    rec("recently played: all 120, newest first, paged by Spotify's before-cursor", rp.length === 120 && rp.every((x, i) => i === 0 || Date.parse(rp[i - 1].playedAt) >= Date.parse(x.playedAt)), rp.length);
    const y = new Date(); y.setDate(y.getDate() - 1); const yd = y.toLocaleDateString("en-CA");
    r = await mb.section({ source: "spotify", section: "recent", day: yd });
    rec("recently played, one day (yesterday): its 40 plays only", r.items.length === 40 && r.items.every((x) => new Date(x.playedAt).toLocaleDateString("en-CA") === yd), r.items.length);
    const q = await mb.section({ source: "spotify", section: "queue" });
    rec("the queue: what's playing and what's up next", q.current?.title === mock.tracks[5].name && q.items.length === 8 && q.items[0].upNext === 1);
    const n = await mb.section({ source: "spotify", section: "now" });
    rec("now playing: the song, liked or not, a lyrics link", n.now?.item?.title === mock.tracks[5].name && n.now.item.liked === true && /lyrics/.test(n.now.lyrics), j(n.now?.item?.liked));
  }

  // ------------------------------------------------------------------ 2. scopes
  section("2. a sign-in from before: \"Grant access to your library and history\"");
  {
    token("qa-old", ALL.filter((s) => !/follow|user-top-read/.test(s)));
    const sp = await imp("lib/spotify-api.mjs"); void sp;
    // (spotify-api keeps the token in memory: sign out and read the file again)
    spotifyApi.signOut(); token("qa-old", ALL.filter((s) => !/follow|user-top-read/.test(s)));
    const r = await mb.section({ source: "spotify", section: "artists" });
    rec("followed artists without user-follow-read: asks for it (no call that would fail)", j(r.needsScopes) === j(["user-follow-read"]) && !mock.state.calls.some((c) => /following/.test(c) && /qa-old/.test(c)), j(r));
    const t = await mb.section({ source: "spotify", section: "top" });
    rec("top songs without user-top-read: asks for it", j(t.needsScopes) === j(["user-top-read"]));
    const st = await mb.status();
    rec("the status names what's missing (for the Grant access button)", st.sources.spotify.api.missing.includes("user-follow-read") && st.sources.spotify.api.missing.includes("user-top-read"), j(st.sources.spotify.api.missing));
    const lk = await mb.section({ source: "spotify", section: "liked" });
    rec("sections it CAN read still load", lk.items.length === 50);
    // a sign-in that recorded all its scopes, but Spotify still says "insufficient scope": the same card
    spotifyApi.signOut(); writeFileSync(process.env.DAYSPRING_SPOTIFY_TOKEN_FILE, j({ access_token: "qa-old", refresh_token: "qa-refresh", scope: ALL.join(" "), expires_at: Date.now() + 3600_000 }));
    const r2 = await mb.section({ source: "spotify", section: "artists" });
    rec("Spotify refusing with \"Insufficient client scope\": also the Grant access card", Array.isArray(r2.needsScopes) && r2.needsScopes.includes("user-follow-read"), j(r2));
    spotifyApi.signOut(); token("qa-full", ALL);
    rec("after the new sign-in: followed artists load", (await mb.section({ source: "spotify", section: "artists" })).items.length === 50);
  }

  // ------------------------------------------------------------------ 3. Development Mode
  section("3. Development Mode: closed calls fall back, and say so");
  {
    const own = mock.playlists.find((p) => p.closed);
    const p = await mb.page({ source: "spotify", kind: "playlist", id: own.id });
    rec("Spotify's own playlist (closed to Development Mode apps): the web player, with why", p.fallback === "webplayer" && p.url === `https://open.spotify.com/playlist/${own.id}` && /Development Mode/.test(p.note), j(p).slice(0, 200));
    const a = await mb.page({ source: "spotify", kind: "artist", id: mock.artists[0].id });
    rec("an artist's page: top-tracks is closed, so their songs come from a search (only theirs)", a.groups[0].items.length > 0 && a.groups[0].items.every((t) => t.artists.some((x) => x.id === mock.artists[0].id)) && a.groups[1].items.length > 0, `${a.groups[0].items.length} songs, ${a.groups[1].items.length} albums`);
    const al = await mb.page({ source: "spotify", kind: "album", id: mock.albums[0].id });
    rec("an album opens with its songs, and each plays on from there", al.head?.title === mock.albums[0].name && al.items.length > 0 && al.items[0].context === `spotify:album:${mock.albums[0].id}`, al.items.length);
    rec("no search asked Spotify for more than 10 at once", mock.state.searchLimitViolations === 0);
  }

  // ------------------------------------------------------------------ 4. search
  section("4. search: grouped, paged, genres and moods; YouTube");
  {
    mock.state.calls.length = 0;
    let r = await mb.search({ source: "spotify", q: "song", remember: false });
    const ids = r.groups.map((g) => g.id);
    rec("Spotify: Songs · Artists · Albums · Playlists", ["track", "artist", "album", "playlist"].every((x) => ids.includes(x)), j(ids));
    rec("…20 songs from two calls of 10 (Development Mode's limit), more available", r.groups.find((g) => g.id === "track").items.length === 20 && r.groups.find((g) => g.id === "track").next === 20 && mock.state.calls.filter((c) => c.startsWith("GET /search")).length === 2 && mock.state.searchLimitViolations === 0, mock.state.calls.filter((c) => c.startsWith("GET /search")).join(" | "));
    const more = await mb.search({ source: "spotify", q: "song", only: "track", from: 20 });
    rec("…Load more: the next 20 songs, none repeated", more.groups[0].items.length === 20 && !more.groups[0].items.some((x) => r.groups[0].items.some((y) => y.uri === x.uri)) && more.groups[0].next === 40);
    r = await mb.search({ source: "spotify", q: "christian fold" });
    const g = r.groups.find((x) => x.id === "genre");
    rec("genres and moods: \"christian fold\" → Christian Folk (typo forgiven)", g?.items.some((x) => x.title === "Christian Folk"), j(g?.items.map((x) => x.title)));
    r = await mb.search({ source: "spotify", q: "relax" });
    rec("…moods too: \"relax\" → Calm", r.groups.find((x) => x.id === "genre")?.items.some((x) => /calm/i.test(x.title)), j(r.groups.find((x) => x.id === "genre")?.items.map((x) => x.title)));
    rec("typing is remembered only on purpose (recent searches)", mb.recentSearches().some((x) => x.q === "christian fold") && !mb.recentSearches().some((x) => x.q === "song"), j(mb.recentSearches().map((x) => x.q)));
    const yt = await mb.search({ source: "youtube", q: "dovetail joint" });
    rec("YouTube: Videos · Channels · Playlists", j(yt.groups.map((x) => x.id)) === j(["video", "channel", "ytplaylist"]) && yt.groups[0].items.length === 22, j(yt.groups.map((x) => `${x.id}:${x.items.length}`)));
    const ns = await mb.search({ source: "youtube", q: "dovetail joint", filters: { noShorts: true } });
    rec("…No Shorts leaves out the under-a-minute ones", ns.groups[0].items.every((x) => !x.short) && ns.groups[0].items.length < 22, ns.groups[0].items.length);
    const lg = await mb.search({ source: "youtube", q: "dovetail joint", filters: { duration: "long" } });
    rec("…Over 20 minutes: only the long ones", lg.groups[0].items.length > 0 && lg.groups[0].items.every((x) => x.secs > 1200), lg.groups[0].items.map((x) => x.length).join(","));
    const ym = await mb.search({ source: "youtube", q: "dovetail joint", only: "video", from: 1, have: yt.groups[0].items.map((x) => x.videoId) });
    rec("…Load more for videos leaves out what's already shown", ym.groups[0].items.every((x) => !yt.groups[0].items.some((y) => y.videoId === x.videoId)));
    const ch = await mb.page({ source: "youtube", kind: "ytplaylist", playlistId: "PLqaworship0000000001", title: "Worship Songs" });
    rec("a YouTube playlist opens inside the browser", ch.items.length === 20 && ch.head?.title, ch.items.length);
  }

  // ------------------------------------------------------------------ 5. actions
  section("5. play, play next, queue, like, save, follow, add to playlist");
  {
    const tr = mock.tracks;
    let r = await mb.act({ action: "play", items: [{ source: "spotify", kind: "track", uri: tr[3].uri, title: tr[3].name }] });
    rec("▶ a song plays on the screen's Spotify player", r.ok && j(mock.state.lastPlay?.uris) === j([tr[3].uri]), j(r));
    r = await mb.act({ action: "play", items: [{ source: "spotify", kind: "track", uri: tr[4].uri, title: tr[4].name, context: `spotify:playlist:${mock.playlists[0].id}` }] });
    rec("▶ a song in a playlist: the playlist plays on from it", mock.state.lastPlay?.context_uri === `spotify:playlist:${mock.playlists[0].id}` && mock.state.lastPlay?.offset?.uri === tr[4].uri, j(mock.state.lastPlay));
    r = await mb.act({ action: "play", items: [0, 1, 2].map((i) => ({ source: "spotify", kind: "track", uri: tr[10 + i].uri, title: tr[10 + i].name })) });
    rec("▶ three picked songs play in that order", j(mock.state.lastPlay?.uris) === j([tr[10].uri, tr[11].uri, tr[12].uri]) && /3 songs/.test(r.reply), r.reply);
    r = await mb.act({ action: "play", items: [{ source: "spotify", kind: "album", uri: mock.albums[2].uri, title: "x" }] });
    rec("▶ an album plays as an album", mock.state.lastPlay?.context_uri === mock.albums[2].uri);
    mock.state.queue.length = 0;
    r = await mb.act({ action: "queue", items: [{ source: "spotify", kind: "track", uri: tr[20].uri, title: tr[20].name }, { source: "spotify", kind: "track", uri: tr[21].uri, title: tr[21].name }] });
    rec("＋ Queue: both songs go into Spotify's queue", j(mock.state.queue) === j([tr[20].uri, tr[21].uri]) && /2 songs/.test(r.reply), r.reply);
    r = await mb.act({ action: "next", items: [{ source: "spotify", kind: "track", uri: tr[22].uri, title: tr[22].name }] });
    rec("⤴ Play next", mock.state.queue.at(-1) === tr[22].uri && /Up next/.test(r.reply));
    const q = await mb.section({ source: "spotify", section: "queue" });
    rec("…and the Queue section shows them", q.items.slice(0, 3).map((x) => x.uri).join() === [tr[20].uri, tr[21].uri, tr[22].uri].join());
    const u = tr[300].uri;
    r = await mb.act({ action: "like", items: [{ source: "spotify", kind: "track", uri: u, title: "x" }] });
    rec("♥ like a song (Liked Songs)", r.ok && mock.state.liked.has(u));
    r = await mb.act({ action: "unlike", items: [{ source: "spotify", kind: "track", uri: u, title: "x" }] });
    rec("♡ and take it back", r.ok && !mock.state.liked.has(u));
    r = await mb.act({ action: "like", items: [{ source: "spotify", kind: "album", uri: mock.albums[7].uri, id: mock.albums[7].id, title: "x" }] });
    rec("♥ save an album", r.ok && mock.state.savedAlbums.has(mock.albums[7].uri));
    r = await mb.act({ action: "like", items: [{ source: "spotify", kind: "artist", uri: mock.artists[70].uri, id: mock.artists[70].id, title: "x" }] });
    rec("♥ follow an artist", r.ok && mock.state.following.has(mock.artists[70].id));
    const pls = await mb.act({ action: "playlists" });
    rec("the playlists he can add to: his own and collaborative (9), not followed ones", pls.playlists.length === 9, pls.playlists.length);
    r = await mb.act({ action: "addToPlaylist", playlistId: pls.playlists[0].id, playlistTitle: pls.playlists[0].title, items: [{ source: "spotify", kind: "track", uri: tr[30].uri, title: "a" }, { source: "spotify", kind: "track", uri: tr[31].uri, title: "b" }] });
    rec("☰ add two songs to a playlist", r.ok && mock.state.plAdds.at(-1)?.playlist === pls.playlists[0].id && mock.state.plAdds.at(-1).uris.length === 2 && /2 songs/.test(r.reply), r.reply);
    mock.state.calls.length = 0;
    r = await mb.act({ action: "play", items: [{ source: "spotify", kind: "genre", genre: "christian folk", request: "play christian folk music", title: "Christian Folk" }] });
    rec("▶ a genre goes through the music resolver (it searches Spotify for the genre)", mock.state.calls.some((c) => /GET \/search\?q=[^&]*christian/i.test(c)), r.error ?? r.reply);
    video._setDeps({ screens: () => 1 });              // (a screen is open: the video queue knows what's playing)
    // YouTube, through the video queue (lib/video)
    vqueue.reload(); rmSync(process.env.DAYSPRING_VIDEO_QUEUE, { force: true }); vqueue.reload(); events.length = 0;
    r = await mb.act({ action: "play", items: [{ source: "youtube", kind: "video", videoId: "hvid0000001", title: "A video" }] });
    rec("▶ a video plays on the screen (through the video queue)", r.ok && lastEv("media")?.videoId === "hvid0000001" && vqueue.get().current?.videoId === "hvid0000001", j(lastEv("media")));
    media.setState({ source: "youtube", videoId: "hvid0000001", title: "A video" });
    r = await mb.act({ action: "queue", items: [{ source: "youtube", kind: "video", videoId: "hvid0000002", title: "Second" }, { source: "youtube", kind: "video", videoId: "hvid0000003", title: "Third" }] });
    rec("＋ Queue two videos", r.ok && vqueue.get().items.map((x) => x.videoId).join() === "hvid0000001,hvid0000002,hvid0000003", j(vqueue.get().items.map((x) => x.videoId)));
    r = await mb.act({ action: "next", items: [{ source: "youtube", kind: "video", videoId: "hvid0000004", title: "Fourth" }] });
    rec("⤴ Play next goes right after the one playing", vqueue.get().items[1]?.videoId === "hvid0000004");
    const yq = await mb.section({ source: "youtube", section: "queue" });
    rec("the YouTube Queue section is the video queue", yq.items.length === 4 && yq.items[0].current === true);
    r = await mb.act({ action: "addToPlaylist", playlistTitle: "Woodworking", items: [{ source: "youtube", kind: "video", videoId: "hvid0000002", title: "Second" }] });
    rec("☰ a video into one of Dayspring's video playlists (made if new)", r.ok && (await mb.act({ action: "videolists" })).playlists.some((p) => p.title === "Woodworking" && p.total === 1));
    // the study-time rule
    media._setPolicy({ videosAllowed: false, reason: "It's study time until 9:00." });
    r = await mb.act({ action: "play", items: [{ source: "youtube", kind: "video", videoId: "hvid0000005", title: "No" }] });
    rec("study time: a video is refused, with why", r.ok === false && /study/i.test(r.error), r.error);
    r = await mb.act({ action: "play", items: [{ source: "spotify", kind: "track", uri: tr[40].uri, title: "x" }] });
    rec("…music still plays", r.ok && j(mock.state.lastPlay?.uris) === j([tr[40].uri]));
    rec("…and the status says so (for the banner)", (await mb.status()).policy.videosAllowed === false);
    media._setPolicy({ videosAllowed: true });
    r = await mb.act({ action: "like", items: [{ source: "youtube", kind: "video", videoId: "hvid0000005", title: "x" }] });
    rec("♥ on a video says where likes are made (not supported here)", r.ok === false && /YouTube itself/.test(r.error));
    r = await mb.act({ action: "play", items: [{ source: "spotify", kind: "track", uri: "javascript:alert(1)", title: "x" }] });
    rec("an item with a made-up uri is refused", r.ok === false);
  }

  // ------------------------------------------------------------------ 6. voice
  section("6. voice: opening, history, top songs, intents, numbers");
  {
    const say = async (t) => { events.length = 0; const r = await mb.command(t); return { r, open: lastEv("mbrowser") }; };
    let v = await say("show my liked songs");
    rec("\"show my liked songs\" opens Liked Songs", v.open?.do === "open" && v.open.source === "spotify" && v.open.section === "liked", j(v));
    v = await say("show my spotify playlists");
    rec("\"show my Spotify playlists\"", v.open?.section === "playlists" && v.open.source === "spotify");
    v = await say("my followed artists");
    rec("\"my followed artists\"", v.open?.section === "artists");
    v = await say("my top songs this month");
    rec("\"my top songs this month\": top songs, 4 weeks, said aloud", v.open?.section === "top" && v.open.range === "short" && v.r.reply.includes(mock.tracks[0].name), v.r.reply);
    v = await say("what did i listen to yesterday");
    const y = new Date(); y.setDate(y.getDate() - 1);
    rec("\"what did I listen to yesterday\": that day's history, and a summary", v.open?.section === "recent" && v.open.day === y.toLocaleDateString("en-CA") && /^Yesterday you listened to \d+ songs/.test(v.r.reply), v.r.reply);
    v = await say("search spotify for hillsong");
    rec("\"search Spotify for hillsong\" opens the browser with the results", v.open?.source === "spotify" && v.open.q === "hillsong");
    v = await say("search youtube for dovetail joints");
    rec("\"search YouTube for …\" too", v.open?.source === "youtube" && v.open.q === "dovetail joints");
    v = await say("show my youtube history");
    rec("\"show my YouTube history\"", v.open?.source === "youtube" && v.open.section === "history");
    v = await say("open my music");
    rec("\"open my music\"", v.open?.do === "open");
    v = await say("open spotify");
    rec("\"open spotify\" is still the Spotify app (not claimed)", v.r === null);
    v = await say("play my liked songs");
    rec("\"play my liked songs\" still plays them (not claimed)", v.r === null);
    // the offline intent catalogue
    const I = await imp("lib/intents/index.mjs");
    const plan = (t) => I.plan(t, {}).intent;
    const want = { "show my liked songs": "mediabrowser.liked", "show my spotify playlists": "mediabrowser.playlists", "my followed artists": "mediabrowser.artists", "my top songs this month": "mediabrowser.top",
      "what did i listen to yesterday": "mediabrowser.recent", "show my youtube history": "mediabrowser.history", "what did i watch last night": "mediabrowser.history", "search spotify for hillsong": "mediabrowser.search", "open my music": "mediabrowser.open" };
    const bad = Object.entries(want).filter(([t, id]) => plan(t) !== id).map(([t]) => `${t} → ${plan(t)}`);
    rec("offline intents: the owner's phrasings plan the browser", !bad.length, bad.join(" | "));
    rec("…and \"pull up videos about biking\" is still the video grid", plan("pull up videos about biking") === "video.browse");
    // numbers on whatever is showing
    const shown = (await mb.section({ source: "spotify", section: "liked" })).items.slice(0, 12).map((x, i) => ({ ...x, n: i + 1 }));
    mb.setView({ open: true, source: "spotify", section: "liked", items: shown, more: true });
    events.length = 0;
    let r = await mb.command("play number 3");
    rec("\"play number 3\" plays the third one showing", j(mock.state.lastPlay?.uris) === j([shown[2].uri]) && /Playing/.test(r.reply), r.reply);
    mock.state.queue.length = 0;
    r = await mb.command("queue number 2");
    rec("\"queue number 2\"", mock.state.queue[0] === shown[1].uri, r.reply);
    const l4 = shown[3].uri; mock.state.liked.delete(l4);
    r = await mb.command("like number 4");
    rec("\"like number 4\"", mock.state.liked.has(l4), r.reply);
    r = await mb.command("play number two next");
    rec("\"play number two next\"", mock.state.queue.at(-1) === shown[1].uri);
    events.length = 0; r = await mb.command("more");
    rec("\"more\" loads more on the screen", lastEv("mbrowser")?.do === "more");
    const plsV = (await mb.section({ source: "spotify", section: "playlists" })).items.map((x, i) => ({ ...x, n: i + 1 }));
    mb.setView({ open: true, source: "spotify", section: "playlists", items: plsV });
    events.length = 0; r = await mb.command("open number 1");
    rec("\"open number 1\" opens it inside the browser", lastEv("mbrowser")?.do === "openItem" && lastEv("mbrowser").n === 1);
    r = await mb.command("play number 40");
    rec("a number that isn't showing: says how many there are", /only 13/.test(r?.reply ?? ""), r?.reply);
    mb._setDeps({ othersAt: async () => Date.now() + 60_000 });
    r = await mb.command("play number 2");
    rec("a newer list on the screen (a video grid, pictures) gets the number instead", r === null);
    mb._setDeps({ othersAt: async () => 0 });
    mb.setView({ open: false });
    r = await mb.command("play number 2");
    rec("with the browser closed, numbers aren't claimed", r === null);
    const tr = await mb.runTool("music_video_browser", { action: "open", source: "spotify", section: "top", range: "long" });
    rec("the AI's tool opens a section", tr.opened && lastEv("mbrowser")?.section === "top" && lastEv("mbrowser").range === "long");
    const th = await mb.runTool("music_video_history", { kind: "spotify_top", range: "short" });
    rec("the AI's history tool reads top songs", th.items?.length === 50 && th.range === "Last 4 weeks");
  }

  // ------------------------------------------------------------------ 7. the media window: sign-in, YouTube history
  section("7. the media window (headless, a throwaway profile): sign-in, history, subscriptions, sign-out");
  const browser = await imp("lib/browser.mjs");
  if (!existsSync(CHROME)) rec("Chrome is here for the media-window tests", false, CHROME);
  else {
    signin._reset();
    let r = await mb.section({ source: "youtube", section: "history" });
    rec("history before signing in: \"Sign in to YouTube first\"", r.signIn === "youtube" && /Sign in to YouTube first/.test(r.error), j(r));
    rec("…and nothing was asked of YouTube's own calls without the sign-in", mock.state.ytAuthFails === 0);
    events.length = 0;
    const st = await signin.start("youtube");
    rec("Sign in to YouTube: the media window opens on the sign-in page", st.shown && (await browser.page("youtube")).url().startsWith(`${mock.yt}/yt-signin`) && /never sees your password/.test(st.text), st.text);
    await (await browser.page("youtube")).click("#signin");   // (the owner signing in himself)
    const done = await until(() => signin.status("youtube").signedIn === true, 10000);
    rec("…it notices when he's done, and says who's signed in", done && signin.status("youtube").account === "QA Owner · qa-owner@example.test" && /✓ Signed in to YouTube as QA Owner/.test(lastEv("mediasignin", (d) => d.signedIn)?.text ?? ""), j(signin.status("youtube")));
    const kept = JSON.parse(readFileSync(process.env.DAYSPRING_MEDIA_SIGNIN_FILE, "utf8"));
    rec("…what's kept: signed in and the name, never a cookie", kept.youtube.signedIn === true && !/qa-sapisid|SAPISID|qa-sid/.test(j(kept)), j(kept));
    const h1 = await mb.section({ source: "youtube", section: "history" });
    rec("watch history: grouped by day (Today, Yesterday), both of YouTube's layouts read", h1.items.length === 35 && j(h1.days) === j(["Today", "Yesterday"]) && h1.items[0].day === "Today" && h1.items[34].day === "Yesterday" && h1.items[25].title.startsWith("History Video"), `${h1.items.length} ${j(h1.days)} ${h1.error ?? ""}`);
    rec("…each with a thumbnail and remove-from-history", h1.items.every((x) => x.art && x.removeToken), h1.items.filter((x) => !x.removeToken).length);
    const h2 = await mb.section({ source: "youtube", section: "history", cursor: h1.next });
    rec("…infinite scroll: YouTube's own continuation, from inside the signed-in page", h2.items.length === 20 && h2.items[0].day === "Monday" && h2.next === "H3", `${h2.items.length} ${h2.next} ${h2.error ?? ""}`);
    const h3 = await mb.section({ source: "youtube", section: "history", cursor: h2.next });
    rec("…to the end", h3.items.length === 12 && h3.next === null && h3.items[0].day === "Sunday");
    const gone = h1.items[2];
    r = await mb.act({ action: "removeHistory", items: [gone] });
    rec("remove from history: YouTube's own \"Remove from watch history\"", r.ok && mock.state.feedback.includes(gone.removeToken), j(r));
    const again = await mb.section({ source: "youtube", section: "history" });
    rec("…and it's gone from the list", again.items.length === 34 && !again.items.some((x) => x.videoId === gone.videoId));
    const hs = await mb.section({ source: "youtube", section: "history", query: "dovetail" });
    rec("search within history", hs.items.length === 1 && /Dovetail/.test(hs.items[0].title), `${hs.items.length} ${hs.error ?? ""}`);
    const sv = await mb.section({ source: "youtube", section: "subscriptions" }), sv2 = await mb.section({ source: "youtube", section: "subscriptions", cursor: sv.next });
    rec("subscriptions: their latest videos, and more", sv.items.length === 12 && sv2.items.length === 15, `${sv.items.length}+${sv2.items.length}`);
    const sc = await mb.section({ source: "youtube", section: "subscriptions", type: "channels" }), sc2 = await mb.section({ source: "youtube", section: "subscriptions", type: "channels", cursor: sc.next });
    rec("subscriptions: the channel list, and more", sc.items.length === 10 && sc.items[0].kind === "channel" && sc2.items.length === 5);
    const pl = await mb.section({ source: "youtube", section: "playlists" });
    rec("his playlists (and Liked videos, Watch later)", ["Liked videos", "Watch later", "Worship Songs", "Biking"].every((t) => pl.items.some((x) => x.title === t)), j(pl.items.map((x) => x.title)));
    const lv = await mb.section({ source: "youtube", section: "liked" }), lv2 = await mb.section({ source: "youtube", section: "liked", cursor: lv.next });
    rec("Liked videos: 75 (50 + 25)", lv.items.length === 50 && lv2.items.length === 25 && lv2.next === null, `${lv.items.length} ${lv.error ?? ""}`);
    const wl = await mb.section({ source: "youtube", section: "watchlater" });
    rec("Watch later", wl.items.length === 8);
    const w = await mb.command("what did i watch last night");
    rec("\"what did I watch last night\": yesterday's videos, said", /^Last night you watched 15 videos/.test(w.reply), w.reply);
    // Spotify's web player sign-in (another site)
    await signin.start("spotify");
    await (await browser.page("spotify")).click("#login");
    rec("Sign in to Spotify (web player): noticed, with the name", Boolean(await until(() => signin.status("spotify").signedIn === true, 10000)) && signin.status("spotify").account === "QA Owner", j(signin.status("spotify")));
    // expiry: the session ends by itself (the cookie is gone) → one notice through the floor, with Sign in again
    const ctx = await browser.mediaContext();
    const offered = [];
    signin._setDeps({ offer: async (item, fire) => { offered.push(item); fire(item); } });
    await ctx.clearCookies({ name: "SAPISID" });
    events.length = 0;
    let c = await signin.check("youtube");
    rec("an ended YouTube session is noticed by the check", c.signedIn === false && c.expired === true, j(c));
    rec("…he's told once, through the floor, with a Sign in again notice", offered.length === 1 && /sign-in in Dayspring has ended/.test(offered[0].text) && lastEv("mediasignin", (d) => d.notice)?.expired === true);
    c = await signin.check("youtube");
    rec("…and only once", offered.length === 1);
    let needErr = null; try { signin.needs("youtube"); } catch (e) { needErr = e; }
    rec("features that need it say \"sign in to YouTube first\"", needErr?.signIn === "youtube" && /Sign in to YouTube first/.test(needErr.message));
    // sign in again, then sign out: only YouTube's cookies and storage go
    await signin.start("youtube"); await (await browser.page("youtube")).click("#signin");
    await until(() => signin.status("youtube").signedIn === true, 10000);
    const hostY = new URL(mock.yt).hostname, hostS = new URL(mock.sp).hostname;
    const before = await ctx.cookies();
    const out = await signin.signOut("youtube");
    const after = await ctx.cookies();
    const yp = await browser.page("youtube"); await yp.goto(`${mock.yt}/`); const ls = await yp.evaluate(() => localStorage.getItem("ytSession"));
    const sp2 = await browser.page("spotify"); await sp2.goto(`${mock.sp}/`); const spls = await sp2.evaluate(() => localStorage.getItem("spSession"));
    rec("Sign out of YouTube: its cookies are cleared", before.some((x) => x.domain.includes(hostY)) && !after.some((x) => x.domain.includes(hostY)) && out.cleared >= 2, `${out.cleared} cleared`);
    rec("…and its storage", ls === null);
    rec("…Spotify's sign-in (another site) is untouched", after.some((x) => x.domain.includes(hostS) && x.name === "sp_dc") && spls === "1" && (await signin.check("spotify")).signedIn === true);
    rec("…and YouTube shows signed out (no expiry notice for a sign-out)", signin.status("youtube").signedIn === false && !signin.status("youtube").expired && offered.length === 1);
    const words = await signin.command("am i signed in to spotify");
    rec("\"am I signed in to Spotify?\"", /Yes, Spotify is signed in as QA Owner/.test(words ?? ""), words);
    await browser.close();
  }

  // ------------------------------------------------------------------ 8. his own files
  section("8. his own files (throwaway, made with ffmpeg)");
  {
    const FF = createRequire(join(DESK, "package.json"))("ffmpeg-static");
    const make = (file, tags) => { mkdirSync(dirname(file), { recursive: true }); spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:a", "libmp3lame", "-b:a", "64k", ...Object.entries(tags).flatMap(([k, v]) => ["-metadata", `${k}=${v}`]), file], { windowsHide: true }); return file; };
    make(join(MUSIC, "a1.mp3"), { title: "Holy Forever", artist: "Chris Tomlin", album: "Always", track: "1" });
    make(join(MUSIC, "a2.mp3"), { title: "Good Good Father", artist: "Chris Tomlin", album: "Always", track: "2" });
    make(join(MUSIC, "b1.mp3"), { title: "Hurt", artist: "Johnny Cash", album: "American IV", track: "1" });
    make(join(MUSIC, "b2.mp3"), { title: "Ring of Fire", artist: "Johnny Cash", album: "Ring of Fire", track: "1" });
    const permissions = await imp("lib/permissions.mjs"), library = await imp("lib/medialib/library.mjs");
    permissions.set({ files: "custom", entries: [{ path: MUSIC, kind: "folder", access: "read" }], choice: true });
    library._reset(); await library.scanNow();
    const rs = await mb.section({ source: "local", section: "songs" });
    rec("songs: all 4, in album order", rs.items.length === 4 && rs.items[0].title === "Holy Forever", j(rs.items.map((x) => x.title)));
    const ab = await mb.section({ source: "local", section: "albums" }), at = await mb.section({ source: "local", section: "artists" });
    rec("albums and artists from the tags", ab.items.length === 3 && at.items.length === 2 && at.items.find((x) => x.title === "Chris Tomlin")?.count === 2, `${ab.items.length} albums, ${at.items.length} artists`);
    const pg = await mb.page({ source: "local", kind: "localalbum", album: "Always", artist: "Chris Tomlin" });
    rec("an album opens with its songs", pg.items.length === 2);
    const sr = await mb.search({ source: "local", q: "johny cash" });
    rec("search forgives a typo: \"johny cash\" → his songs and him", sr.groups.find((g) => g.id === "song")?.items.length === 2 && sr.groups.some((g) => g.id === "localartist"), j(sr.groups.map((g) => `${g.id}:${g.items.length}`)));
    events.length = 0;
    let r = await mb.act({ action: "play", items: [rs.items[2], rs.items[3]] });
    rec("▶ play two of his songs on the screen", r.ok && lastEv("media")?.provider === "local" && lastEv("media").queue.length === 2, r.error ?? r.reply);
    media.setState({ source: "file", title: "Hurt" });
    r = await mb.act({ action: "next", items: [rs.items[0]] });
    rec("⤴ play next while one of his files plays: added to the screen's list", r.ok && lastEv("medialib", (d) => d.enqueue)?.next === true && lastEv("medialib", (d) => d.enqueue).enqueue[0].src.includes(rs.items[0].fileId), r.error ?? r.reply);
    r = await mb.act({ action: "play", items: [{ source: "local", kind: "file", fileId: "0123456789abcdef", title: "made up" }] });
    rec("a file id that isn't in the index is refused", r.ok === false);
    media.setState(null);
  }

  // ------------------------------------------------------------------ 9. the screen
  } catch (e) {
  if (!e.skip) rec("the run finished without an exception", false, e.stack);
} finally {
  try { await (await imp("lib/browser.mjs")).close(); } catch { /* fine */ }
  signin.stopHealth?.();
}
if (!args.includes("--no-screen")) await screen();

async function screen() {
  section("9. on the screen (headless Chrome): the window, live search, scroll, grid, select, cards, voice numbers, fit");
  if (!PW || !existsSync(CHROME)) { rec("headless Chrome and playwright-core are here", false, PW ?? "no playwright-core"); return; }
  const { chromium } = await import(pathToFileURL(PW).href);
  const APP = join(TMP, "app"), PORT = 4768, BASE = `http://127.0.0.1:${PORT}`;
  const ex = spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
  // (the export's privacy scan is the release's gate, not this test's: a copy that was written is enough here)
  if (!existsSync(join(APP, "server.mjs")) || !existsSync(join(APP, "public", "mediabrowser.js"))) { rec("the throwaway copy exported", false, (ex.stdout + ex.stderr).slice(-400)); return; }
  spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
  mkdirSync(join(APP, "data"), { recursive: true });
  writeFileSync(join(APP, "data", "owner.json"), j({ name: "Tester", setupDone: true, display: "primary" }));
  // a sign-in from before (no follow / top permissions): the Grant access card
  mock.grant("qa-ui", ALL.filter((s) => !/follow|user-top-read/.test(s)));
  writeFileSync(join(APP, "data", "spotify-token.json"), j({ access_token: "qa-ui", refresh_token: "qa-refresh", scope: ALL.filter((s) => !/follow|user-top-read/.test(s)).join(" "), expires_at: Date.now() + 3600_000, userId: "qa-owner" }));
  const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_NO_ECO: "1", DS_PROFILE: "DayspringQA", DAYSPRING_CHANNEL: "stable", DS_NO_SINK_FOLLOW: "1", DAYSPRING_NO_MEDIA_BROWSER: "1" };
  for (const k of Object.keys(env)) if (/^DAYSPRING_(VIDEO_|MEDIA_FILE|VIDEOLISTS|FEATURE_|SETTINGS|INTENT_|TIMERS|RECIPES|LISTS|SPOTIFY_TOKEN|MB_FILE|MEDIA_SIGNIN|PERMISSIONS|ACTIVITY|MEDIALIB|CONNECTORS)/.test(k)) delete env[k];
  env.DAYSPRING_SPOTIFY_TOKEN_FILE = join(APP, "data", "spotify-token.json");
  const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let log = ""; server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
  let chrome = null;
  try {
    let up = false;
    for (let i = 0; i < 120 && !up; i++) { up = await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false); if (!up) await sleep(500); }
    rec("the throwaway Dayspring is up", up, log.slice(-300));
    if (!up) return;
    await fetch(`${BASE}/api/player/device`, { method: "POST", headers: { "content-type": "application/json" }, body: j({ deviceId: "dev-screen" }) });
    chrome = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
    const CONFIGS = [["/display", 1280, 720], ["/display", 1920, 1080], ["/mini", 380, 560]];
    for (const [path, w, h] of CONFIGS) {
      const tag = `${path} ${w}×${h}`;
      const ctx = await chrome.newContext({ viewport: { width: w, height: h } });
      await ctx.addInitScript(() => {
        window.__dsAllowAutomatedListen = true;
        const ss = window.speechSynthesis; if (ss) { ss.speak = (u) => setTimeout(() => u.onend?.(), 5); ss.cancel = () => {}; }
        HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
        class FakeSR { start() {} abort() { setTimeout(() => this.onend?.(), 5); } stop() { this.abort(); } }
        window.SpeechRecognition = window.webkitSpeechRecognition = FakeSR;
      });
      const searches = [];
      await ctx.route("**/*", (rt) => {
        const u = rt.request().url();
        if (/\/api\/mb\/search/.test(u)) searches.push(decodeURIComponent(new URL(u).searchParams.get("q") ?? ""));
        if (rt.request().method() === "POST" && /\/api\/(sound|window|devices\/use|voicemeeter|keepawake|tunein|callbridge|open|app\/quit|update|media\/popout|player\/spotify\/login)/.test(u)) return rt.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"url":"about:blank"}' });
        if (/^https?:\/\/(?!127\.0\.0\.1)/.test(u)) return rt.fulfill({ status: 204, body: "" });
        return rt.continue();
      });
      const p = await ctx.newPage();
      const errs = []; p.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));
      await p.goto(BASE + path); await sleep(2200);
      if (await p.locator("#startBtn").isVisible().catch(() => false)) { await p.click("#startBtn"); await sleep(500); }
      const S2 = () => p.evaluate(() => window.dsMB?._state());
      rec(`${tag}: the browser is on the screen (window.dsMB, the Music button)`, Boolean(await until(() => p.evaluate(() => Boolean(window.dsMB && (document.getElementById("musicBtn")?.dataset.mb || document.getElementById("mbBtn")))), 6000)));
      await p.evaluate(() => window.dsMB.open({ source: "spotify", section: "playlists" }));
      let s = await until(async () => { const x = await S2(); return x?.items?.length ? x : null; });
      rec(`${tag}: Spotify playlists load, numbered`, s?.items.length === 13 && s.items[0].n === 1, j(s?.items?.length));
      // fit: the window and every visible control inside the safe area and clickable (once its entrance animation is over)
      await p.evaluate(() => Promise.all(document.getElementById("dsMB").getAnimations().map((a) => a.finished))).catch(() => {});
      const fit = await p.evaluate(() => {
        const box = document.getElementById("dsMB"), S = window.dsSafeRect(), r = box.getBoundingClientRect(), tol = 1;
        const inside = (q) => q.left >= S.left - tol && q.top >= S.top - tol && q.right <= S.right + tol && q.bottom <= S.bottom + tol;
        const bad = [];
        for (const c of [...box.querySelectorAll(".mb-bar button, .mb-search button, .mb-search input, .mb-nav button, .mb-head button")].filter((e) => e.offsetWidth && !e.closest("[hidden]"))) {
          c.scrollIntoView({ block: "nearest", inline: "nearest" });
          const q = c.getBoundingClientRect(); const e = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
          if (!inside(q) || !(e && (e === c || c.contains(e)))) bad.push((c.textContent || c.className).trim().slice(0, 20));
        }
        return { inside: inside(r), bad, box: `${Math.round(r.left)},${Math.round(r.top)}→${Math.round(r.right)},${Math.round(r.bottom)}` };
      });
      rec(`${tag}: the window fits the screen's safe area, and its buttons are clickable`, fit.inside && !fit.bad.length, `${fit.box} ${fit.bad.slice(0, 4).join(" | ")}`);
      // live search: typed quickly → one search after the pause, grouped
      searches.length = 0;
      await p.click("#dsMB .mb-q"); await p.keyboard.type("song", { delay: 40 });
      s = await until(async () => { const x = await S2(); return x?.groups?.length >= 4 ? x : null; });
      await sleep(400);
      rec(`${tag}: live search as he types: one search after the pause (debounced), not one per letter`, searches.length === 1 && searches[0] === "song", j(searches));
      rec(`${tag}: results grouped Songs · Artists · Albums · Playlists`, j(s?.groups.slice(0, 4).map((g) => g.title)) === j(["Songs", "Artists", "Albums", "Playlists"]), j(s?.groups));
      if (args.includes("--keep")) await p.screenshot({ path: join(TMP, `search-${w}x${h}.png`) }).catch(() => {});
      const itemsBefore = s.items.length;
      await p.click('#dsMB [data-gmore="track"]');
      s = await until(async () => { const x = await S2(); return x?.items.length > itemsBefore ? x : null; });
      rec(`${tag}: Load more on Songs adds the next page`, s?.groups[0].n === 40, j(s?.groups[0]));
      // voice numbers reach the server
      await sleep(400);
      const chat = (message) => fetch(`${BASE}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: j({ message, surface: "tv" }) }).then((r) => r.json());
      mock.state.lastPlay = null;
      const said = await chat("play number 2");
      rec(`${tag}: "play number 2" plays the second result on the screen`, mock.state.lastPlay?.uris?.length === 1 && /Playing/.test(said.reply ?? ""), `${said.reply} ${j(mock.state.lastPlay)}`);
      // Liked Songs: infinite scroll
      await p.evaluate(() => window.dsMB.open({ source: "spotify", section: "liked" }));
      s = await until(async () => { const x = await S2(); return x?.section === "liked" && x.items.length === 50 ? x : null; });
      await p.evaluate(() => { const l = document.querySelector("#dsMB .mb-list"); l.scrollTop = l.scrollHeight; l.dispatchEvent(new Event("scroll")); });
      s = await until(async () => { const x = await S2(); return x?.items.length === 100 ? x : null; });
      rec(`${tag}: Liked Songs: scrolling to the bottom loads more (infinite scroll)`, s?.items.length === 100, s?.items.length);
      // grid and multi-select → queue
      await p.click("#dsMB .mb-viewbtn");
      if (args.includes("--keep")) await p.screenshot({ path: join(TMP, `grid-${w}x${h}.png`) }).catch(() => {});
      rec(`${tag}: grid view`, (await S2()).view === "grid" && await p.locator("#dsMB .mb-grid .mb-item").count() > 10);
      await p.click("#dsMB .mb-viewbtn");
      await p.click("#dsMB .mb-selbtn");
      await p.locator("#dsMB .mb-item").nth(0).click(); await p.locator("#dsMB .mb-item").nth(1).click();
      rec(`${tag}: multi-select: two picked, the bar shows`, (await S2()).sel === 2 && await p.locator("#dsMB .mb-selbar").isVisible());
      mock.state.queue.length = 0;
      await p.click('#dsMB .mb-selbar [data-s="queue"]');
      rec(`${tag}: …Add to queue sends both to Spotify's queue`, Boolean(await until(() => mock.state.queue.length === 2)), j(mock.state.queue));
      // the Grant access card (this sign-in has no follow permission)
      await p.evaluate(() => window.dsMB.open({ source: "spotify", section: "artists" }));
      s = await until(async () => { const x = await S2(); return x?.data?.needsScopes ? x : null; });
      rec(`${tag}: Followed artists without the permission: "Grant access to your library and history"`, Boolean(s) && await p.locator('#dsMB [data-do="grant"]').isVisible(), j(s?.data));
      // Development Mode: Spotify's own playlist → the web player card
      await p.evaluate(() => window.dsMB.open({ source: "spotify", section: "playlists" }));
      await until(async () => (await S2())?.items?.length === 13);
      const idx = await p.evaluate(() => window.dsMB._state().items.findIndex((x) => /Spotify's Own/.test(x.title)));
      await p.locator("#dsMB .mb-item").nth(idx).click();
      s = await until(async () => { const x = await S2(); return x?.data?.fallback ? x : null; });
      rec(`${tag}: a playlist closed to Development Mode: "Open it in the web player", and why`, s?.data.fallback === "webplayer" && await p.locator('#dsMB [data-do="webplayer"]').isVisible() && /Development Mode/.test(await p.locator("#dsMB .mb-card").innerText()), j({ idx, s: s ?? await S2() }));
      await p.keyboard.press("Backspace").catch(() => {});
      // YouTube: the media window is off here → a clear card, not a failure
      await p.evaluate(() => window.dsMB.open({ source: "youtube", section: "history" }));
      s = await until(async () => { const x = await S2(); return x?.data && (x.data.error || x.data.signIn) ? x : null; });
      rec(`${tag}: YouTube history without the media window: says why`, Boolean(s?.data?.error), j(s?.data));
      // keyboard: Esc closes
      await p.focus("#dsMB .mb-q");
      for (let k = 0; k < 3 && (await S2()).open; k++) { await p.keyboard.press("Escape"); await sleep(200); }
      rec(`${tag}: Esc closes it (a menu or the recent searches first, then the window)`, (await S2()).open === false);
      if (w === 1920) await p.screenshot({ path: join(TMP, "media-browser-1920.png") }).catch(() => {});
      rec(`${tag}: no page errors`, errs.length === 0, errs.slice(0, 3).join(" | "));
      await ctx.close();
    }
  } catch (e) { rec("the screen tests ran", false, e.stack); }
  finally {
    await chrome?.close().catch(() => {});
    server.kill(); await sleep(600);
    spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true });
  }
}

await mock.close();
if (args.includes("--keep")) console.log("kept:", TMP); else { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* a file still held open: left in temp */ } }
console.log(failed ? `\n${failed} failed, ${passed} passed` : `\nALL PASSED: ${passed} passed`);
process.exit(failed ? 1 : 0);
