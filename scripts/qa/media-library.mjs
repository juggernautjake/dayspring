// The owner's own music and videos (lib/medialib): indexing, search, voice phrases, the stream route and playback.
//   1. tiny audio and video files with real tags, made with Dayspring's own ffmpeg (ffmpeg-static) in a temp folder
//      (never the owner's files): MP3 (ID3), M4A (MP4 atoms), FLAC (Vorbis comments), Opus, WMA, MP4, WebM
//   2. indexing follows file access: off (nothing, and it says how to allow a folder), custom (only the chosen folders, a
//      "none" folder kept out), all + look-only, and a permission taken back later; private-looking folders are skipped
//   3. search: title, artist (with a typo), album, genre, file name, folder, year, newest
//   4. the stream route: Range requests (206, suffix ranges, 416), HEAD; ids not in the index, path tricks, a tampered
//      index pointing outside the allowed folders (and through a junction), and a permission taken back are refused
//   5. voice phrases, no AI: "play the song Holy Forever from my computer", "play my Johnny Cash mp3s", "find the video
//      from Sarah's wedding", "play the latest video in Downloads", "shuffle my music folder", "what audio files do I have
//      from 2019", "number 1", WMA → "open it in the default app?" → the Programs permission, and the activity log
//   6. playback in headless Chrome (--mute-audio, mocked output devices): the file plays through the stream route, on the
//      output Dayspring chose (setSinkId), moves when the choice changes, video goes full screen, next/stop work
//   node scripts/qa/media-library.mjs
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHROME = process.env.QA_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" && !ok ? "  (" + String(got).slice(0, 300) + ")" : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch { /* not yet */ } await sleep(60); } return v; }

const TMP = mkdtempSync(join(tmpdir(), "ds-medialib-"));
const HOME = join(TMP, "home"), MUSIC = join(HOME, "Music"), VIDEOS = join(HOME, "Videos"), DL = join(HOME, "Downloads"), OUT = join(TMP, "Outside");
Object.assign(process.env, {
  DAYSPRING_PERMISSIONS_FILE: join(TMP, "permissions.json"), DAYSPRING_ACTIVITY_DIR: join(TMP, "activity"), DAYSPRING_MEDIALIB_FILE: join(TMP, "media-library.json"),
  DAYSPRING_MEDIALIB_HOME: HOME, DAYSPRING_MEDIALIB_DELAY_MS: "0", DAYSPRING_SETTINGS_FILE: join(TMP, "settings.json"), DAYSPRING_CONNECTORS_DIR: join(TMP, "connectors"),
  DAYSPRING_NO_BROWSER: "1", DAYSPRING_NO_OPEN: "1", DS_FOLLOW_MARK: join(TMP, "follow.json"), DAYSPRING_INTENT_LEARNED: join(TMP, "learned.json"),
});
const NAMES = { tv: "Living Room TV (2- HD Audio Driver for Display Audio)", headset: "Speakers (Wireless Gaming Headset)", laptop: "Speaker (Realtek(R) Audio)" };
writeFileSync(join(TMP, "settings.json"), JSON.stringify({ audioOutputs: ["tv"], preferredOutputs: { tv: NAMES.tv, headphones: NAMES.headset, speakers: NAMES.laptop } }));

// ---- 1. the files -------------------------------------------------------------------------------------------------------
const FF = createRequire(join(DESK, "package.json"))("ffmpeg-static");
function make(file, { audio = "libmp3lame", video = null, secs = 4, tags = {}, ext = null } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  const meta = Object.entries(tags).flatMap(([k, v]) => ["-metadata", `${k}=${v}`]);
  const args = video
    ? ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc=size=64x48:rate=10:duration=${secs}`, "-f", "lavfi", "-i", `sine=frequency=330:duration=${secs}`, "-c:v", video, ...(video === "libx264" ? ["-pix_fmt", "yuv420p"] : []), "-c:a", audio, "-shortest", ...meta, file]
    : ["-v", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${secs}`, "-c:a", audio, ...(audio === "libmp3lame" ? ["-b:a", "64k"] : []), ...meta, file];
  const r = spawnSync(FF, args, { windowsHide: true, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg couldn't make ${file}: ${r.stderr}`);
  return file;
}
const F = {
  holy: make(join(MUSIC, "Chris Tomlin", "Holy Forever.mp3"), { tags: { title: "Holy Forever", artist: "Chris Tomlin", album: "Always", genre: "Worship", date: "2022", track: "1" } }),
  hurt: make(join(MUSIC, "Johnny Cash", "01 Hurt.mp3"), { tags: { title: "Hurt", artist: "Johnny Cash", album: "American IV", genre: "Country", date: "2002", track: "1" } }),
  ring: make(join(MUSIC, "Johnny Cash", "02 Ring of Fire.mp3"), { tags: { title: "Ring of Fire", artist: "Johnny Cash", album: "Ring of Fire", genre: "Country", date: "1963", track: "2" } }),
  hymn: make(join(MUSIC, "Hymns", "Be Thou My Vision.m4a"), { audio: "aac", tags: { title: "Be Thou My Vision", artist: "Church Choir", album: "Hymns 2019", genre: "Hymns", date: "2019" } }),
  river: make(join(MUSIC, "Folk", "River.flac"), { audio: "flac", tags: { title: "River Song", artist: "Hollow Pines", genre: "Folk", date: "2019" } }),
  morning: make(join(MUSIC, "Folk", "Morning.opus"), { audio: "libopus", tags: { title: "Morning Light", artist: "Hollow Pines", genre: "Folk" } }),
  noTags: make(join(MUSIC, "Loose", "Sam Smith - Stay With Me.mp3"), {}),
  legacy: make(join(DL, "Old Recording.wma"), { audio: "wmav2", secs: 3, tags: { title: "Old Recording", artist: "Grandpa" } }),
  wedding: make(join(VIDEOS, "Sarah's Wedding", "ceremony.mp4"), { video: "libx264", audio: "aac", secs: 4, tags: { title: "Sarah's Wedding Ceremony" } }),
  oldClip: make(join(DL, "old-clip.mp4"), { video: "libx264", audio: "aac", secs: 2 }),
  newClip: make(join(DL, "new-clip.webm"), { video: "libvpx", audio: "libopus", secs: 3 }),
  secret: make(join(MUSIC, "Private", "secret song.mp3"), { tags: { title: "Secret Song", artist: "Nobody" } }),
  taxes: make(join(MUSIC, "taxes 2019 call.mp3"), { tags: { title: "Tax Call", artist: "IRS" } }),
  blocked: make(join(MUSIC, "Blocked", "nope.mp3"), { tags: { title: "Blocked Song", artist: "Nope" } }),
  outside: make(join(OUT, "elsewhere.mp3"), { tags: { title: "Elsewhere", artist: "Outsider" } }),
};
writeFileSync(join(MUSIC, "notes.txt"), "not media");
const old = new Date("2020-01-01"); utimesSync(F.oldClip, old, old);
try { symlinkSync(OUT, join(MUSIC, "linked"), "junction"); } catch { /* junctions need NTFS: the tampered-index check still runs */ }
check("ffmpeg made the test files (MP3, M4A, FLAC, Opus, WMA, MP4, WebM)", Object.values(F).every(existsSync));

const imp = (p) => import(pathToFileURL(join(DESK, p)).href);
const permissions = await imp("lib/permissions.mjs");
const activity = await imp("lib/activity.mjs");
const settings = await imp("lib/settings.mjs");
const tags = await imp("lib/medialib/tags.mjs");
const library = await imp("lib/medialib/library.mjs");
const player = await imp("lib/medialib/player.mjs");
const skills = await imp("lib/medialib/skills.mjs");
const routes = await imp("lib/medialib/routes.mjs");
const bus = await imp("lib/bus.mjs");
const events = [];
bus.on((type, data) => events.push({ type, data }));
const lastMedia = () => [...events].reverse().find((e) => e.type === "media")?.data;
const lastList = () => [...events].reverse().find((e) => e.type === "medialib" && e.data.list)?.data.list;

// ---- tags --------------------------------------------------------------------------------------------------------------
{
  const t = await tags.readTags(F.holy);
  check("MP3 (ID3): title, artist, album, genre, year, track, duration", t.title === "Holy Forever" && t.artist === "Chris Tomlin" && t.album === "Always" && t.genre === "Worship" && t.year === 2022 && t.track === 1 && t.duration >= 3 && t.duration <= 5, JSON.stringify(t));
  const m = await tags.readTags(F.hymn);
  check("M4A (MP4 atoms): title, artist, year", m.title === "Be Thou My Vision" && m.artist === "Church Choir" && m.year === 2019, JSON.stringify(m));
  const f = await tags.readTags(F.river);
  check("FLAC (Vorbis comments): title, artist, genre", f.title === "River Song" && f.artist === "Hollow Pines" && f.genre === "Folk", JSON.stringify(f));
  const o = await tags.readTags(F.morning);
  check("Opus (Vorbis comments): title", o.title === "Morning Light", JSON.stringify(o));
  const w = await tags.readTags(F.legacy);
  check("WMA (ASF): title and artist", w.title === "Old Recording" && w.artist === "Grandpa", JSON.stringify(w));
  const v = await tags.readTags(F.wedding);
  check("MP4 video: duration and resolution (64×48)", v.duration >= 3 && v.width === 64 && v.height === 48, JSON.stringify(v));
  const n = await tags.readTags(F.noTags);
  check("no tags: artist and title from the file name", n.artist === "Sam Smith" && n.title === "Stay With Me", JSON.stringify(n));
}

// ---- 2. indexing follows file access ----------------------------------------------------------------------------------------
const paths = () => library.items().map((x) => x.path);
const has = (p) => paths().some((x) => x.toLowerCase() === p.toLowerCase());
{
  permissions.set({ files: "off", choice: true });
  library._reset();
  const r = await library.scanNow();
  const st = library.status();
  check("file access off: nothing is indexed", r.items === 0 && library.items().length === 0);
  check("file access off: it explains how to allow a folder", st.off && /Settings → Permissions/.test(st.how ?? ""), st.how);
  const said = await skills.command("play the song Holy Forever from my computer");
  check("…and a spoken request says so (no guessing)", /can't look at your files yet.*Settings → Permissions/.test(said?.reply ?? ""), said?.reply);

  permissions.set({ files: "custom", entries: [{ path: MUSIC, kind: "folder", access: "read" }, { path: join(MUSIC, "Blocked"), kind: "folder", access: "none" }], choice: true });
  library._reset();
  await library.scanNow();
  check("custom: the chosen Music folder is indexed", has(F.holy) && has(F.hurt) && has(F.hymn) && has(F.river) && has(F.morning));
  check("custom: Videos and Downloads (not chosen) are not", !has(F.wedding) && !has(F.newClip) && !has(F.legacy));
  check("custom: a folder set to “none” inside it is kept out", !has(F.blocked));
  check("private-looking folders and file names are skipped (Private\\, “taxes …”)", !has(F.secret) && !has(F.taxes));
  check("a junction to a folder outside isn't followed", !has(F.outside) && !paths().some((p) => /linked/i.test(p)));
  check("only audio and video files (no .txt)", !paths().some((p) => /\.txt$/.test(p)));

  permissions.set({ files: "all", allAccess: "read", entries: [], choice: true });
  library._reset();
  const before = Date.now();
  await library.scanNow();
  check("all + look only: Music, Videos and Downloads are indexed", has(F.holy) && has(F.wedding) && has(F.newClip) && has(F.legacy), paths().length);
  check("all: the folder outside the default places isn't (only Music, Videos, Downloads, or ones added)", !has(F.outside));
  check("the index is kept in data/media-library.json (paths and tags, no file contents)", existsSync(process.env.DAYSPRING_MEDIALIB_FILE) && !/RIFF|ID3/.test(readFileSync(process.env.DAYSPRING_MEDIALIB_FILE, "latin1")));
  // incremental: nothing changed → no tags read again
  const t0 = Date.now(); const again = await library.scanNow();
  check("a rescan only reads what changed (same size and time: tags kept)", again.parsed === 0 && again.items === library.items().length, JSON.stringify(again));
  make(join(MUSIC, "Chris Tomlin", "Holy Forever.mp3"), { secs: 5, tags: { title: "Holy Forever", artist: "Chris Tomlin", album: "Always (Deluxe)", genre: "Worship", date: "2022" } });
  const third = await library.scanNow();
  check("…and a changed file is read again", third.parsed === 1 && library.search("holy forever")[0]?.album === "Always (Deluxe)", JSON.stringify(third));
  void before; void t0;
}

// ---- 3. search -----------------------------------------------------------------------------------------------------------
{
  const top = (q, o) => library.search(q, o)[0];
  check("title: “holy forever”", top("holy forever")?.path === F.holy);
  check("artist with a typo: “jonny cash” finds Johnny Cash", library.search("jonny cash").every((x) => x.artist === "Johnny Cash") && library.search("jonny cash").length === 2);
  check("album: “american iv”", top("american iv")?.path === F.hurt);
  check("genre: “folk” (kind audio)", library.search("folk", { kind: "audio" }).every((x) => x.genre === "Folk") && library.search("folk", { kind: "audio" }).length === 2);
  check("file name without tags: “stay with me”", top("stay with me")?.path === F.noTags);
  check("folder: “sarahs wedding” (the video's folder)", top("sarahs wedding", { kind: "video" })?.path === F.wedding);
  check("year 2019 (tags)", library.search("", { kind: "audio", year: 2019 }).map((x) => x.title).sort().join("|") === "Be Thou My Vision|River Song");
  check("newest video in Downloads", library.search("", { kind: "video", folder: "downloads", latest: true })[0]?.path === F.newClip);
  check("nothing close: no results (no wild guesses)", library.search("quantum banana").length === 0);
}

// ---- 4. the stream route --------------------------------------------------------------------------------------------------
const readJSON = (req) => new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch { ok({}); } }); });
const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const PAGE = `<!doctype html><title>t</title><div class="media" id="media" hidden><div id="yt"></div></div><script>
  window.__P = { source: null }; window.__msgs = [];
  window.dsPlayerHost = { P: window.__P, render() {}, stopOthers() {}, musicVol: () => 80, ducked: () => false, clear() { window.__P.source = null; }, push(k, t) { window.__msgs.push(t); }, toast() {} };
  const es = new EventSource("/api/events"); window.dsEvents = es;
  es.addEventListener("media", (e) => { const c = JSON.parse(e.data); if (c.action === "play" && c.provider === "local") window.dsLocalPlayer.play(c); else if (c.action === "stop") window.dsLocalPlayer.stop(false); });
</script><script src="/medialib.js"></script>`;
const srv = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  try {
    if (url.pathname === "/api/events") return bus.addClient(res, { page: "display", id: "qa" });
    if (url.pathname === "/") { res.writeHead(200, { "content-type": "text/html" }); return res.end(PAGE); }
    if (url.pathname === "/medialib.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(readFileSync(join(DESK, "public", "medialib.js"))); }
    if (url.pathname.startsWith("/api/")) {
      if (await routes.handle(req, res, { m: req.method, p: url.pathname.slice(4), q: url.searchParams, send, readJSON })) return;
      return send(res, 404, { error: "no route" });
    }
    res.writeHead(404); res.end();
  } catch (e) { if (!res.headersSent) send(res, 500, { error: e.message }); }
}).listen(0, "127.0.0.1");
await new Promise((r) => srv.once("listening", r));
const BASE = `http://127.0.0.1:${srv.address().port}`;
const get = (path, headers = {}, method = "GET") => new Promise((ok, no) => { const r = http.request(BASE + path, { method, headers }, (res) => { const b = []; res.on("data", (c) => b.push(c)); res.on("end", () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(b) })); }); r.on("error", no); r.end(); });
{
  const holy = library.search("holy forever")[0], bytes = readFileSync(F.holy);
  let r = await get(`/api/media/local/stream?id=${holy.id}`);
  check("stream: the whole file (200, accept-ranges, audio/mpeg)", r.status === 200 && r.body.equals(bytes) && r.headers["accept-ranges"] === "bytes" && r.headers["content-type"] === "audio/mpeg", r.status);
  r = await get(`/api/media/local/stream?id=${holy.id}`, { range: "bytes=100-199" });
  check("Range bytes=100-199 → 206 with exactly those bytes", r.status === 206 && r.headers["content-range"] === `bytes 100-199/${bytes.length}` && r.body.equals(bytes.subarray(100, 200)), `${r.status} ${r.headers["content-range"]}`);
  r = await get(`/api/media/local/stream?id=${holy.id}`, { range: "bytes=-50" });
  check("Range bytes=-50 → the last 50 bytes", r.status === 206 && r.body.equals(bytes.subarray(bytes.length - 50)));
  r = await get(`/api/media/local/stream?id=${holy.id}`, { range: `bytes=${bytes.length + 10}-` });
  check("a range past the end → 416", r.status === 416 && r.headers["content-range"] === `bytes */${bytes.length}`);
  r = await get(`/api/media/local/stream?id=${holy.id}`, {}, "HEAD");
  check("HEAD: size, no body", r.status === 200 && Number(r.headers["content-length"]) === bytes.length && r.body.length === 0);
  r = await get(`/api/media/local/stream?id=0123456789abcdef`);
  check("an id that isn't in the index → 404", r.status === 404);
  for (const bad of ["../../Windows/win.ini", encodeURIComponent(F.outside), encodeURIComponent("C:\\Windows\\win.ini"), "%2e%2e%5c%2e%2e%5cfoo"]) {
    r = await get(`/api/media/local/stream?id=${bad}`);
    check(`a path instead of an id is refused (${decodeURIComponent(bad).slice(0, 28)})`, r.status === 404 && !r.body.includes(Buffer.from("[fonts]")));
  }
  r = await get(`/api/media/local/stream?path=${encodeURIComponent(F.outside)}&id=`);
  check("a path= parameter is ignored (only ids from the index)", r.status === 404);
  // a tampered index: an entry pointing outside the allowed folders, and one through the junction
  const d = JSON.parse(readFileSync(process.env.DAYSPRING_MEDIALIB_FILE, "utf8"));
  const fake = (p) => ({ ...d.items[0], id: library.idOf(p), path: p, name: "x.mp3" });
  d.items.push(fake(F.outside), fake(join(MUSIC, "linked", "elsewhere.mp3")), fake("C:\\Windows\\Media\\tada.wav"));
  writeFileSync(process.env.DAYSPRING_MEDIALIB_FILE, JSON.stringify(d)); library._reset();
  r = await get(`/api/media/local/stream?id=${library.idOf(F.outside)}`);
  check("a tampered index entry outside the allowed folders → 403, nothing served", r.status === 403 && !r.body.includes(Buffer.from("ID3")), r.status);
  r = await get(`/api/media/local/stream?id=${library.idOf(join(MUSIC, "linked", "elsewhere.mp3"))}`);
  check("…one that leads outside through a junction → 403", r.status === 403, r.status);
  r = await get(`/api/media/local/stream?id=${library.idOf("C:\\Windows\\Media\\tada.wav")}`);
  check("…one in Windows' own folders → 403", r.status === 403, r.status);
  // a permission taken back after indexing
  permissions.set({ files: "all", allAccess: "read", entries: [{ path: MUSIC, kind: "folder", access: "none" }], choice: true }); library._forgetRoots();
  r = await get(`/api/media/local/stream?id=${holy.id}`);
  check("Music taken back after indexing: the stream is refused (403) and logged", r.status === 403 && activity.search({ kind: "blocked", query: "media_stream" }).entries.length > 0, r.status);
  check("…and searches no longer show it", library.search("holy forever").length === 0);
  permissions.set({ files: "all", allAccess: "read", entries: [], choice: true }); library._forgetRoots();
  await library.scanNow();
}

// ---- 5. voice, no AI ---------------------------------------------------------------------------------------------------------
{
  events.length = 0;
  let r = await skills.command("play the song Holy Forever from my computer");
  let m = lastMedia();
  check("“play the song Holy Forever from my computer” plays it", /Playing Holy Forever by Chris Tomlin/.test(r?.reply ?? "") && m?.provider === "local" && m.queue.length === 1 && m.queue[0].title === "Holy Forever", r?.reply);
  check("…the screen gets an id-based same-origin address, never a path", /^\/api\/media\/local\/stream\?id=[a-f0-9]{16}$/.test(m?.queue[0].src ?? "") && !JSON.stringify(m).includes(MUSIC.replace(/\\/g, "\\\\")), m?.queue[0].src);
  const logged = activity.search({ kind: "media.play" }).entries[0];
  check("the play is in the activity log (the path only)", logged?.path?.toLowerCase() === F.holy.toLowerCase() && !("title" in logged), JSON.stringify(logged));
  r = await skills.command("play my Johnny Cash mp3s");
  m = lastMedia();
  check("“play my Johnny Cash mp3s” queues both", m?.queue.length === 2 && m.queue.every((q) => /Hurt|Ring of Fire/.test(q.title)) && /Playing 2 songs/.test(r?.reply ?? ""), r?.reply);
  r = await skills.command("find the video from Sarah's wedding");
  const l = lastList();
  check("“find the video from Sarah's wedding” shows a numbered list", /Sarah's Wedding Ceremony/.test(r?.reply ?? "") && l?.items?.[0]?.n === 1 && /Sarah's Wedding/.test(l.items[0].title), r?.reply);
  r = await skills.command("number 1");
  m = lastMedia();
  check("…“number 1” plays it (a video)", m?.queue?.[0]?.kind === "video" && /Sarah's Wedding/.test(m.queue[0].title), r?.reply);
  r = await skills.command("play the latest video in Downloads");
  m = lastMedia();
  check("“play the latest video in Downloads” picks the newest", /new-clip/.test(m?.queue?.[0]?.title ?? ""), r?.reply);
  r = await skills.command("shuffle my music folder");
  m = lastMedia();
  check("“shuffle my music folder” shuffles every song in Music", m?.shuffle === true && m.queue.length >= 6 && m.queue.every((q) => q.kind === "audio"), `${m?.queue?.length} ${r?.reply}`);
  r = await skills.command("what audio files do I have from 2019");
  const l2 = lastList();
  check("“what audio files do I have from 2019” lists them", /found 2 songs from 2019/i.test(r?.reply ?? "") && l2?.items.length === 2, r?.reply);
  check("not his files: “play some jazz” is left for Spotify / YouTube", (await skills.command("play some jazz")) === null);
  check("not his files: “find a recent popular video on cooking” is left for YouTube", (await skills.command("find a recent popular video on cooking")) === null);
  r = await skills.command("play holy forever");
  check("a plain “play Holy Forever” with a strong match in his files plays his file", /Holy Forever/.test(r?.reply ?? "") && lastMedia()?.provider === "local", r?.reply);
  r = await skills.command("play stairway to heaven from my computer");
  check("nothing matching on the computer: says so (and where it looked)", /couldn't find “stairway to heaven” on your computer/.test(r?.reply ?? ""), r?.reply);
  // a format the screen can't play
  player._setFfmpeg(null);
  r = await skills.command("play old recording from my computer");
  check("WMA without ffmpeg: says the screen can't play it and offers the default app", /WMA file.*can't play.*default player/i.test(r?.reply ?? ""), r?.reply);
  permissions.set({ programs: "off" });
  r = await skills.command("yes");
  check("…“yes” with the Programs permission off: refused, and why", /permission to open programs/i.test(r?.reply ?? "") && activity.search({ kind: "blocked", query: "programs" }).entries.length > 0, r?.reply);
  await skills.command("play old recording from my computer");
  permissions.set({ programs: "on" });
  r = await skills.command("yes");
  const prog = activity.search({ kind: "program" }).entries[0];
  check("…with Programs on: opened in the default app (dry run here) and logged", /Opening Old Recording/.test(r?.reply ?? "") && prog?.app === "default" && prog.path?.toLowerCase() === F.legacy.toLowerCase(), r?.reply);
  permissions.set({ programs: "ask" });
  const ai = await skills.runTool("media_library_play", { query: "holy forever", where: "pc" });
  check("the AI's “play it on this PC” with Programs = ask needs the owner's yes first", ai?.needsConfirm === true && Boolean(ai.confirm_token), JSON.stringify(ai));
  player._setFfmpeg(undefined);
  if (player.canConvert()) {
    r = await skills.command("play old recording from my computer");
    const q = lastMedia()?.queue?.[0];
    check("WMA with ffmpeg on this computer: converted as it plays", /converting it as it plays/.test(r?.reply ?? "") && /convert=1/.test(q?.src ?? ""), r?.reply);
    const c = await get(q.src);
    check("…the converted stream is audio/mpeg", c.status === 200 && c.headers["content-type"] === "audio/mpeg" && c.body.length > 1000, `${c.status} ${c.headers["content-type"]} ${c.body.length}`);
  }
  // the AI's tools
  const s = await skills.runTool("media_library_search", { query: "johnny cash", kind: "audio" });
  check("media_library_search (AI) finds and shows them", s.count === 2 && s.shownOnScreen && s.results.every((x) => x.id && x.artist === "Johnny Cash"), JSON.stringify(s).slice(0, 200));
  const p = await skills.runTool("media_library_play", { ids: s.results.map((x) => x.id), shuffle: true });
  check("media_library_play (AI) plays those ids", p.count === 2 && lastMedia()?.shuffle === true, JSON.stringify(p));
  check("Drive tools aren't offered without a Drive (only the media_library ones)", skills.tools().every((t) => t.name.startsWith("media_library_")));
}

// ---- 6. playback in headless Chrome, on the chosen output -----------------------------------------------------------------------
{
  const MOCK = `(() => {
    const names = ${JSON.stringify(Object.values(NAMES))};
    const h = (s) => { let x = 7; for (const ch of location.origin + "|" + s) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return "id" + x.toString(16); };
    window.__mockId = h;
    const list = [{ deviceId: "default", kind: "audiooutput", label: "Default - " + names[0], groupId: "" }].concat(names.map((n) => ({ deviceId: h(n), kind: "audiooutput", label: n, groupId: "" })));
    MediaDevices.prototype.enumerateDevices = async function () { return list.map((d) => ({ ...d })); };
    Object.defineProperty(HTMLMediaElement.prototype, "sinkId", { configurable: true, get() { return this.__sink ?? ""; } });
    HTMLMediaElement.prototype.setSinkId = function (id) { if (id && !list.some((d) => d.deviceId === id)) return Promise.reject(new DOMException("unknown device", "NotFoundError")); this.__sink = id; return Promise.resolve(); };
  })();`;
  let pw = null;
  for (const p of [process.env.QA_PLAYWRIGHT].filter(Boolean)) { try { pw = await import(pathToFileURL(p).href); break; } catch { /* next */ } }
  pw ??= createRequire(join(DESK, "package.json"))("playwright-core");
  const b = await pw.chromium.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
  try {
    const ctx = await b.newContext();
    await ctx.addInitScript({ content: MOCK });
    const page = await ctx.newPage();
    const ranges = [];
    page.on("request", (rq) => { if (rq.url().includes("/api/media/local/stream")) ranges.push(rq.headers().range ?? ""); });
    await page.goto(BASE + "/");
    await until(() => page.evaluate(() => Boolean(window.dsLocalPlayer) && window.dsEvents?.readyState === 1), 5000);
    events.length = 0;
    await skills.command("play the song Holy Forever from my computer");
    const ids = await page.evaluate((n) => ({ tv: __mockId(n.tv), headset: __mockId(n.headset) }), NAMES);
    let st = await until(async () => { const c = await page.evaluate(() => window.dsLocalPlayer.current()); return c && !c.paused && c.position > 0.3 ? c : null; }, 8000);
    check("Chrome plays the file from the stream route (time moves)", Boolean(st), JSON.stringify(await page.evaluate(() => [window.dsLocalPlayer.current(), window.__msgs])));
    check("…on the output Dayspring chose (the named TV, via setSinkId)", st?.sink === ids.tv, `${st?.sink} vs ${ids.tv}`);
    check("…and the music card knows (source “file”, the title)", await page.evaluate(() => window.__P.source === "file" && window.__P.title === "Holy Forever"));
    check("…Chrome asked for byte ranges (Range support used)", ranges.some((r) => /^bytes=\d+-/.test(r)), ranges.join(","));
    const t0 = Date.now();
    settings.set({ audioOutputs: ["headphones"] });
    const moved = await until(async () => (await page.evaluate(() => window.dsLocalPlayer.current()?.sink)) === ids.headset, 8000);
    check("changing Dayspring's output moves it (within a few seconds)", moved === true, `${Date.now() - t0} ms`);
    settings.set({ audioOutputs: ["tv"] });
    // a queue: next goes on, and the screen tells the server (the log)
    await skills.command("play my Johnny Cash mp3s");
    await until(async () => (await page.evaluate(() => window.__P.title)) === "Hurt", 6000);
    const before = activity.search({ kind: "media.play" }).total;
    await page.evaluate(() => window.dsLocalPlayer.ctl("next"));
    const nx = await until(async () => (await page.evaluate(() => window.__P.title)) === "Ring of Fire", 6000);
    check("next: the second song in the queue plays, and is logged", nx === true && (await until(() => activity.search({ kind: "media.play" }).total > before, 3000)) === true);
    // video: full screen in the media box
    await skills.command("play the video from sarah's wedding from my computer");
    const vid = await until(async () => page.evaluate(() => { const v = document.getElementById("lv"), box = document.getElementById("media"); return v && !box.hidden && box.classList.contains("full") && v.currentTime > 0.2 ? { sink: v.sinkId, w: v.videoWidth } : null; }), 8000);
    check("a video plays full screen on the Dayspring screen", Boolean(vid) && vid.w === 64, JSON.stringify(vid));
    check("…following the chosen output too", vid?.sink === ids.tv, vid?.sink);
    await page.evaluate(() => window.dsLocalPlayer.ctl("stop"));
    check("stop: the video is gone and the card cleared", await until(() => page.evaluate(() => !document.getElementById("lv") && document.getElementById("media").hidden && window.__P.source === null), 3000));
    // the list on the screen
    await skills.command("what audio files do I have from 2019");
    check("the list shows on the screen, numbered", await until(() => page.evaluate(() => document.querySelectorAll(".mlpanel li[data-n]").length === 2), 3000));
    await page.click(".mlpanel li[data-n='1']");
    check("clicking number 1 plays it", await until(async () => /Be Thou My Vision|River Song/.test(await page.evaluate(() => window.__P.title)), 6000));
  } finally { await b.close(); }
}

// ---- the screen's hooks in tv.js (a whole Dayspring screen isn't started here) -------------------------------------------------
{
  const tv = readFileSync(join(DESK, "public", "tv.js"), "utf8"), html = readFileSync(join(DESK, "public", "tv.html"), "utf8");
  check("tv.js hands “local” plays to the local player", /c\.provider === "local"\) window\.dsLocalPlayer\?\.play\(c\)/.test(tv));
  check("tv.js: ctl() goes to the local player while a file plays; stop, duck and volume reach it", /src === "file" && window\.dsLocalPlayer/.test(tv) && /dsLocalPlayer\?\.duck\(on\)/.test(tv) && /dsLocalPlayer\?\.volume\(\)/.test(tv) && /function stopMedia[^]*?dsLocalPlayer\?\.stop\(false\)/.test(tv));
  check("tv.html loads medialib.js", /<script src="\/medialib\.js"><\/script>/.test(html));
}

srv.close();
try { rmSync(TMP, { recursive: true, force: true }); } catch { /* temp */ }
console.log(`\n${fail ? "FAILED" : "ALL PASSED"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
