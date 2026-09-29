// Video view modes, the one mini player, and the window manager:
//   1. the words (no AI): "minimize the video", "audio only", "picture in picture", "make it big", "move it to the top
//      left", "make the video bigger" (lib/video/controls.mjs + public/view-words.js, the same list on the screen), and
//      the windows by name ("minimize the map", "hide everything"), lib/winman.mjs
//   2. the one "now playing" (lib/nowplaying.mjs): every source reports, the newest playing one is shown, one voice
//      (starting one pauses the other), the settings (videoStartMode, videoModeLast, nowPlayingIdle)
//   3. the output device follows a frame whatever its view mode (lib/sinkfollow.mjs, a DevTools pipe, mocked devices):
//      moving the frame with CSS keeps its sink and never reloads it; a frame that IS moved in the page (it reloads) gets
//      the choice again
//   4. on the screen (a throwaway Dayspring, headless Chrome, muted; a mocked YouTube player and a local HTML5 video):
//      Big → Corner → Audio only → Big keeps the position, speed, captions and volume and never makes a new player or
//      frame; audio only is invisible but plays, and a pause YouTube makes by itself is undone (then the corner); the
//      corner window drags anywhere (mouse and pen), snaps near an edge, resizes keeping 16:9, stays inside the margins
//      as they change, is remembered, moves with the arrow keys; stacking under dialogs; the card for YouTube, his own
//      audio and video, Spotify (mocked SDK) and Lantern (reported), switching between them, its controls; the voice;
//      "Remember last"; ducking under the voice in audio only; the mini layout; the window manager (dock, chips, keys)
//   node scripts/qa/video-modes.mjs [--verbose] [--no-browser] [--keep]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { qaPort } from "./port.mjs";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startMock, IFRAME_API } from "./fixtures/video/mock-youtube.mjs";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2), VERBOSE = args.includes("--verbose"), NO_BROWSER = args.includes("--no-browser");
const TMP = mkdtempSync(join(tmpdir(), "ds-vmodes-"));
const CHROME = process.env.QA_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PW = [join(DESK, "node_modules", "playwright-core", "index.mjs"), join(DESK, "..", "..", "..", "dayspring-app", "node_modules", "playwright-core", "index.mjs")].find((p) => existsSync(p));
const mock = await startMock();
Object.assign(process.env, {
  DAYSPRING_YT_BASE: mock.url, DAYSPRING_NO_HEADLESS_SEARCH: "1", DAYSPRING_NO_BROWSER: "1", DAYSPRING_MEDIA_FILE: join(TMP, "media.json"), DAYSPRING_SETTINGS_FILE: join(TMP, "settings.json"),
  DAYSPRING_VIDEO_QUEUE: join(TMP, "video-queue.json"), DAYSPRING_VIDEO_PREFS: join(TMP, "video-prefs.json"), DAYSPRING_VIDEO_CREATORS: join(TMP, "video-creators.json"), DAYSPRING_VIDEO_ACCOUNT: join(TMP, "video-account.json"),
  DAYSPRING_VIDEOLISTS_FILE: join(TMP, "video-playlists.json"), DAYSPRING_FEATURE_SWITCHES: join(TMP, "feature-switches.json"), DAYSPRING_FEATURE_STAGES: join(TMP, "feature-stages.json"), DAYSPRING_CHANNEL: "stable",
  DAYSPRING_INTENT_LEARNED: join(TMP, "learned.json"), DAYSPRING_INTENT_MISSES: join(TMP, "misses.json"), DS_FOLLOW_MARK: join(TMP, "display-follow.json"),
});
const imp = (p) => import(pathToFileURL(join(DESK, p)).href);
let passed = 0, failed = 0;
const rec = (area, ok, note = "") => { if (ok) passed++; else failed++; if (!ok || VERBOSE) console.log(`${ok ? "PASS" : "FAIL"}  ${area}${note !== "" && (!ok || VERBOSE) ? " — " + String(note).slice(0, 400) : ""}`); };
const section = (s) => console.log(`\n== ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = (x) => JSON.stringify(x);
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn().catch(() => null); if (v) return v; await sleep(80); } return v; };

// ------------------------------------------------------------------------------------------------ 1. the words
section("1. the words (no AI)");
const controls = await imp("lib/video/controls.mjs");
await imp("public/view-words.js");
const VIEW = [
  ["minimize the video", "view", "audio"], ["hide the video", "view", "audio"], ["audio only", "view", "audio"], ["just play the audio", "view", "audio"], ["minimize", "view", "audio"],
  ["play it in the background", "view", "audio"], ["music only", "view", "audio"], ["only the sound", "view", "audio"],
  ["picture in picture", "view", "corner"], ["put it in the corner", "view", "corner"], ["make it small", "view", "corner"], ["mini player", "view", "corner"], ["put the video in the corner", "view", "corner"], ["shrink the video", "view", "corner"],
  ["full screen", "view", "full"], ["fullscreen", "view", "full"], ["maximize the video", "view", "full"],
  ["make it big", "view", "big"], ["show the video", "view", "big"], ["show me the video again", "view", "big"], ["bring the video back", "view", "big"], ["theater mode", "view", "big"], ["make the video big", "view", "big"],
  ["exit full screen", "view", "exitFull"],
  ["move it to the top left", "place", "tl"], ["move the video to the bottom right", "place", "br"], ["move the video to the center", "place", "c"], ["put the video in the top right corner", "place", "tr"], ["move it to the left side", "place", "l"],
  ["make the video bigger", "resize", "bigger"], ["make the video smaller", "resize", "smaller"], ["make it a little bigger", "resize", "bigger"], ["smaller", "resize", "smaller"],
];
for (const [t, a, v] of VIEW) { const r = controls.parse(t); rec(`“${t}” → ${a} ${v}`, r?.action === a && r?.value === v, j(r)); }
for (const t of ["turn off the video", "close the video", "stop"]) rec(`“${t}” still stops`, controls.parse(t)?.action === "stop", j(controls.parse(t)));
for (const t of ["pause", "next", "volume 40", "skip ahead 2 minutes"]) rec(`“${t}” is still what it was`, controls.parse(t) && !["view", "place", "resize"].includes(controls.parse(t).action));
rec("the screen and the server use the same list (public/view-words.js)", typeof globalThis.dsViewWords === "function" && controls.viewWords("audio only").value === "audio");
{
  const wins = ["maps", "mail", "viewer", "mediabrowser", "images", "page", "schedule"].map((id) => ({ id, aliases: id === "page" ? ["cameras", "camera"] : [] }));
  const WW = [["minimize the map", "mode", "maps", "min"], ["shrink the email", "mode", "mail", "small"], ["put the viewer in the corner", "place", "viewer", "br"], ["maximize the browser", "mode", "mediabrowser", "max"],
    ["restore the map", "restore", "maps"], ["move the map to the right side", "place", "maps", "r"], ["close the viewer", "close", "viewer"], ["make the map bigger", "resize", "maps", "bigger"], ["minimize the cameras", "mode", "page", "min"],
    ["make the email normal size", "mode", "mail", "normal"], ["hide the schedule", "mode", "schedule", "min"]];
  for (const [t, op, id, v] of WW) { const r = globalThis.dsWindowWords(t, wins); rec(`window words: “${t}”`, r?.op === op && r?.id === id && (v === undefined || r.value === v), j(r)); }
  for (const t of ["hide everything", "minimize all", "minimize all the windows", "clear the screen"]) rec(`window words: “${t}” → all`, globalThis.dsWindowWords(t, wins)?.op === "minAll");
  for (const t of ["show everything again", "bring everything back", "restore all"]) rec(`window words: “${t}” → back`, globalThis.dsWindowWords(t, wins)?.op === "restoreAll");
  for (const t of ["minimize", "open my music", "what's on the map", "hide yourself"]) rec(`window words: “${t}” isn't a window's`, !globalThis.dsWindowWords(t, wins));
}
{
  const winman = await imp("lib/winman.mjs");
  const sent = [];
  winman._setDeps({ broadcast: (t, d) => sent.push([t, d]), screens: () => 1 });
  winman.setState("p1", [{ id: "maps", title: "Maps", mode: "normal", open: true, aliases: ["map"] }, { id: "viewer", title: "Viewer", mode: "closed", open: false }]);
  let r = winman.command("minimize the map");
  rec("lib/winman: “minimize the map” with the map open → the screens", r?.reply && sent.at(-1)?.[0] === "winman" && j(sent.at(-1)[1]) === j({ op: "mode", id: "maps", value: "min" }), j([r, sent.at(-1)]));
  r = winman.command("close the viewer"); rec("lib/winman: a window that isn't open is left to its own words", r === null);
  r = winman.command("show the map"); rec("lib/winman: “show the map” while it's already showing isn't taken", r === null);
  winman.setState("p1", [{ id: "maps", title: "Maps", mode: "min", open: true }]);
  r = winman.command("show everything again"); rec("lib/winman: “show everything again” with something minimised", r?.reply && sent.at(-1)[1].op === "restoreAll");
  r = winman.command("hide everything"); rec("lib/winman: “hide everything” when it's all tucked away says so", /already/.test(r?.reply ?? ""), j(r));
  winman.setState("p1", [{ id: "maps", title: "Maps", mode: "closed", open: false }]);
  r = winman.command("hide everything"); rec("lib/winman: “hide everything” with no window open isn't taken", r === null);
  winman._setDeps({ screens: () => 0 }); rec("lib/winman: no screen, nothing taken", winman.command("minimize the map") === null);
  winman._reset();
}

// ------------------------------------------------------------------------------------------------ 2. the one "now playing"
section("2. the one “now playing” (lib/nowplaying.mjs) and the settings");
{
  const np = await imp("lib/nowplaying.mjs");
  const out = []; let t = 1_000_000;
  np._setDeps({ broadcast: (type, d) => out.push([type, d]), now: () => t });
  np._reset();
  const paused = [];
  np.setPauser("screen", () => paused.push("screen")); np.setPauser("window-spotify", () => paused.push("window-spotify"));
  np.report("screen", { provider: "youtube", title: "Psalm 23", artist: "Readings", playing: true, position: 10, duration: 300, video: true, mode: "audio", videoId: "abcdefghijk", queueCount: 2 });
  np.flush();
  let c = np.current();
  rec("a report becomes the current one, with its icon, mode, queue count and what the card can do", c?.key === "screen" && c.icon === "youtube" && c.mode === "audio" && c.queueCount === 2 && c.can.seek && c.can.modes && c.controllable, j(c));
  rec("…and is broadcast to every screen", out.at(-1)?.[0] === "nowplaying-state" && out.at(-1)[1].current?.title === "Psalm 23");
  t += 10_000; rec("its position runs on while it plays", Math.round(np.current().position) === 20);
  t += 1000; np.report("lantern", { provider: "lantern", title: "Focus music", playing: true });
  rec("one voice: Lantern's study music starts → the screen's player is paused", paused.includes("screen") && np.current().key === "lantern", j(paused));
  rec("an app's report can't be controlled from the card (it's controlled in Lantern)", np.current().controllable === false && np.current().icon === "lantern");
  t += 1000; np.report("window-spotify", { provider: "spotify-window", title: "Gratitude", playing: true });
  rec("the newest one playing is the one shown", np.current().key === "window-spotify");
  np.report("window-spotify", null); np.report("lantern", { ended: true });
  rec("when the others end, the paused screen player is shown (paused)", np.current()?.key === "screen" && np.current().playing === false, j(np.current()));
  np.report("screen", null); np.flush();
  rec("nothing: current is null and that's broadcast", np.current() === null && out.at(-1)[1].current === null);
  t += 5000; np.report("screen", { provider: "file", title: "Home movie", sourceLabel: "Google Drive · Videos", playing: true, video: true });
  rec("a Google Drive video is shown with the Drive icon", np.current().icon === "drive" && np.current().can.modes);
  np._reset();
}
{
  const settings = await imp("lib/settings.mjs");
  const s0 = settings.get();
  rec("settings: videos start “Remember last”, the card hides when nothing plays", s0.videoStartMode === "remember" && s0.nowPlayingIdle === "hide" && j(s0.videoModeLast) === "{}");
  let s = settings.set({ videoStartMode: "corner", videoModeLast: { "youtube-music": "audio", nonsense: "big", youtube: "sideways" }, nowPlayingIdle: "show" });
  rec("settings: the start mode, the last mode per kind (only real kinds and modes), “Nothing playing”", s.videoStartMode === "corner" && j(s.videoModeLast) === j({ "youtube-music": "audio" }) && s.nowPlayingIdle === "show", j(s));
  let threw = false; try { settings.set({ videoStartMode: "tiny" }); } catch { threw = true; }
  rec("settings: a start mode that isn't one is refused", threw);
  settings.set({ videoStartMode: "remember", nowPlayingIdle: "hide" });
}

// ------------------------------------------------------------------------------------------------ 3. the output device and the frame
if (!NO_BROWSER && existsSync(CHROME)) await sinkTests().catch((e) => rec("the output-device checks ran to the end", false, e.stack));
async function sinkTests() {
  section("3. the output device follows the frame in every view mode (lib/sinkfollow.mjs)");
  const settings = await imp("lib/settings.mjs");
  const sinkfollow = await imp("lib/sinkfollow.mjs");
  const NAMES = { tv: "Living Room TV (2- HD Audio Driver for Display Audio)", headset: "Speakers (Wireless Gaming Headset)" };
  const MOCK = `(() => {
    const names = ${JSON.stringify(Object.values(NAMES))};
    const h = (s) => { let x = 7; for (const ch of location.origin + "|" + s) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return "id" + x.toString(16); };
    window.__mockId = h;
    const list = [{ deviceId: "default", kind: "audiooutput", label: "Default - " + names[0], groupId: "" }].concat(names.map((n) => ({ deviceId: h(n), kind: "audiooutput", label: n, groupId: "" })));
    MediaDevices.prototype.enumerateDevices = async function () { return list.map((d) => ({ ...d })); };
    Object.defineProperty(HTMLMediaElement.prototype, "sinkId", { configurable: true, get() { return this.__sink ?? ""; } });
    HTMLMediaElement.prototype.setSinkId = function (id) { this.__sink = id; return Promise.resolve(); };
  })();`;
  // a short silent WAV, so the frame's video really plays (the helper moves what plays)
  const WAV = "data:audio/wav;base64," + (() => { const n = 800, b = Buffer.alloc(44 + n); b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40); b.fill(128, 44); return b.toString("base64"); })();
  const serve = (route) => new Promise((ok) => { const s = http.createServer((q, res) => { const b = route(q.url); res.writeHead(b ? 200 : 404, { "content-type": "text/html" }); res.end(b ?? ""); }).listen(0, "127.0.0.1", () => ok(s)); });
  const frameSrv = await serve((u) => (u.startsWith("/frame") ? `<!doctype html><video id="v" loop muted></video><script>const v0 = document.getElementById("v"); v0.src = ${j(WAV)}; v0.play().catch(() => {}); window.loads = (window.loads || 0) + 1; window.state = () => ({ v: document.getElementById("v").sinkId, tv: __mockId(${j(NAMES.tv)}), hs: __mockId(${j(NAMES.headset)}) });</script>` : null));
  const FP = frameSrv.address().port;
  // the screen's #media box and its three looks, the same way tv.html styles them (classes and inline position only)
  const topSrv = await serve((u) => (u.startsWith("/top") ? `<!doctype html><title>Dayspring</title><style>#media{position:fixed;inset:20px}#media.minip{inset:auto}#media.audio{inset:auto;right:2px;bottom:2px;width:320px;height:180px;opacity:0;pointer-events:none}iframe{width:100%;height:100%;border:0}</style>
    <div id="media"><iframe id="yt" src="http://127.0.0.1:${FP}/frame?1"></iframe></div><div id="elsewhere"></div>
    <script>window.frameLoads = 0; document.getElementById("yt").addEventListener("load", () => window.frameLoads++);
      window.mode = (m) => { const b = document.getElementById("media"); b.className = m === "big" ? "" : m === "corner" ? "minip" : "audio"; if (m === "corner") Object.assign(b.style, { left: "900px", top: "400px", width: "320px", height: "180px" }); else b.removeAttribute("style"); };
      window.reparent = () => document.getElementById("elsewhere").appendChild(document.getElementById("yt"));</script>` : null));
  const TP = topSrv.address().port;
  settings.set({ audioOutputs: ["tv"], preferredOutputs: { tv: NAMES.tv, headphones: NAMES.headset } });
  const prof = mkdtempSync(join(tmpdir(), "ds-vmodes-chrome-"));
  const me = sinkfollow.launch(CHROME, ["--headless=new", "--mute-audio", `--user-data-dir=${prof}`, "--autoplay-policy=no-user-gesture-required", "--no-first-run", "about:blank"], { origin: `http://localhost:${TP}`, prelude: MOCK });
  try {
    await me.ready;
    const { targetId } = await me.c.send("Target.createTarget", { url: `http://localhost:${TP}/top` });
    const frameSid = async () => { for (const [sid, s] of me.sessions) { if (s.type !== "iframe") continue; const r = await me.c.send("Runtime.evaluate", { expression: "location.search", returnByValue: true }, sid).catch(() => null); if (r?.result?.value === "?1") return sid; } return null; };
    const fstate = async (sid) => (await me.c.send("Runtime.evaluate", { expression: "window.state && Object.assign(state(), { loads: window.loads })", returnByValue: true }, sid).catch(() => null))?.result?.value;
    const pageSid = [...me.sessions].find(([, s]) => s.type === "page" && s.url.includes(`localhost:${TP}`))?.[0];
    const top = async (e) => (await me.c.send("Runtime.evaluate", { expression: e, returnByValue: true }, pageSid ?? [...me.sessions].find(([, s]) => s.type === "page")[0])).result.value;
    let sid = await until(frameSid, 8000);
    let st = sid && await until(async () => { const s = await fstate(sid); return s?.v === s?.tv ? s : null; }, 4000);
    rec("the video frame plays on the chosen output (the TV)", Boolean(st), j(st));
    for (const m of ["corner", "audio", "big", "audio"]) {
      await top(`mode(${j(m)})`); await sleep(250);
      st = await fstate(sid);
      rec(`view mode ${m} (classes and position only): the same frame, not reloaded, still on the TV`, st?.v === st?.tv && st?.loads === 1 && (await top("window.frameLoads")) <= 1, j(st));
    }
    settings.set({ audioOutputs: ["headphones"] });
    st = await until(async () => { const s = await fstate(sid); return s?.v === s?.hs ? s : null; }, 3000);
    rec("in audio only, changing Dayspring's output still moves the hidden frame", Boolean(st), j(await fstate(sid)));
    // a frame moved to another place in the page reloads (a browser rule); the helper is in its new document at once
    await top("reparent()"); await sleep(600);
    sid = await until(frameSid, 6000);
    st = sid && await until(async () => { const s = await fstate(sid); return s?.v === s?.hs ? s : null; }, 4000);
    rec("a frame that IS moved in the page reloads, and its new document gets the chosen output again", Boolean(st), j(sid && await fstate(sid)));
    await me.c.send("Target.closeTarget", { targetId }).catch(() => {});
  } finally {
    await me.c.send("Browser.close").catch(() => {});
    try { process.kill(me.child.pid, 0); me.child.kill(); } catch { /* gone */ }
    frameSrv.close(); topSrv.close();
    await sleep(400); try { rmSync(prof, { recursive: true, force: true }); } catch { /* Chrome may hold a file */ }
    settings.set({ audioOutputs: ["default"] });
  }
}

// ------------------------------------------------------------------------------------------------ 4. on the screen
if (!NO_BROWSER) await screenTests().catch((e) => rec("screen tests ran to the end", false, e.stack));
async function screenTests() {
  section("4. on the screen");
  if (!PW || !existsSync(CHROME)) { rec("headless Chrome and playwright-core are here", false, PW ?? "no playwright-core"); return; }
  const { chromium } = await import(pathToFileURL(PW).href);
  const APP = join(TMP, "app"), PORT = await qaPort(4786), BASE = `http://127.0.0.1:${PORT}`;
  const ex = spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
  if (ex.status !== 0) { rec("the throwaway copy exported", false, (ex.stdout + ex.stderr).slice(-400)); return; }
  spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
  mkdirSync(join(APP, "data"), { recursive: true });
  writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary" }));
  const ff = (await import(pathToFileURL(join(DESK, "node_modules", "ffmpeg-static", "index.js")).href).catch(() => null))?.default;
  const clip = join(TMP, "clip.webm"), song = join(TMP, "song.webm");
  if (ff) {
    spawnSync(ff, ["-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=15", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "30", "-c:v", "libvpx", "-b:v", "150k", "-c:a", "libopus", "-shortest", clip], { windowsHide: true });
    spawnSync(ff, ["-y", "-f", "lavfi", "-i", "sine=frequency=330", "-t", "30", "-c:a", "libopus", song], { windowsHide: true });
  }
  mock.files.set("/clip.webm", { path: clip, type: "video/webm" }); mock.files.set("/song.webm", { path: song, type: "audio/webm" });
  rec("a short local test video and song were made", existsSync(clip) && existsSync(song));
  const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_NO_ECO: "1", DS_PROFILE: "DayspringQA", DAYSPRING_CHANNEL: "stable",
    DAYSPRING_YT_BASE: mock.url, DAYSPRING_NO_HEADLESS_SEARCH: "1", DS_NO_SINK_FOLLOW: "1", DAYSPRING_NO_MEDIA_BROWSER: "1" };
  for (const k of Object.keys(env)) if (/^DAYSPRING_(VIDEO|MEDIA_FILE|VIDEOLISTS|FEATURE|SETTINGS|INTENT|TIMERS|RECIPES|LISTS|SPOTIFY_TOKEN)/.test(k)) delete env[k];
  delete env.DS_FOLLOW_MARK;
  const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let log = ""; server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
  let browser = null;
  const api = (p, body) => fetch(BASE + "/api" + p, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}).then((r) => r.json());
  const chat = (message) => api("/chat", { message, surface: "desk" });
  try {
    let up = false;
    for (let i = 0; i < 120 && !up; i++) { up = await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false); if (!up) await sleep(500); }
    rec("the throwaway Dayspring is up", up, log.slice(-300));
    if (!up) return;
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
    const newCtx = async (viewport = { width: 1280, height: 720 }) => {
      const ctx = await browser.newContext({ viewport });
      await ctx.addInitScript(() => {
        window.__dsAllowAutomatedListen = true;
        // Dayspring's voice: a pretend one that takes 1.2 s (so the ducking under it can be seen)
        const ss = window.speechSynthesis; if (ss) { ss.speak = (u) => setTimeout(() => u.onend?.(), window.__speakMs ?? 5); ss.cancel = () => {}; }
        class FakeSR { start() {} abort() { setTimeout(() => this.onend?.(), 5); } stop() { this.abort(); } }
        window.SpeechRecognition = window.webkitSpeechRecognition = FakeSR;
        // every frame and every <video> the page ever makes, and every time one is taken out of the page
        window.__frames = { added: 0, removed: 0, videos: 0 };
        new MutationObserver((ms) => { for (const m of ms) { for (const n of m.addedNodes) { if (n.nodeName === "IFRAME") window.__frames.added++; if (n.nodeName === "VIDEO") window.__frames.videos++; } for (const n of m.removedNodes) if (n.nodeName === "IFRAME") window.__frames.removed++; } })
          .observe(document, { childList: true, subtree: true });
      });
      await ctx.route("**/*", (rt) => {
        const u = rt.request().url();
        if (/youtube\.com\/iframe_api/.test(u)) return rt.fulfill({ status: 200, contentType: "text/javascript", body: IFRAME_API });
        if (/i\.ytimg\.com|sdk\.scdn\.co|googlevideo|youtube\.com/.test(u)) return rt.fulfill({ status: 204, body: "" });
        if (rt.request().method() === "POST" && /\/api\/(sound|window|devices\/use|voicemeeter|keepawake|tunein|callbridge|open|app\/quit|update|media\/popout)/.test(u)) return rt.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
        if (/^https?:\/\/(?!127\.0\.0\.1)/.test(u)) return rt.fulfill({ status: 204, body: "" });
        return rt.continue();
      });
      return ctx;
    };
    const ctx = await newCtx();
    const page = await ctx.newPage();
    const errs = []; page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));
    await page.goto(`${BASE}/display`); await sleep(2200);
    if (await page.locator("#startBtn").isVisible().catch(() => false)) { await page.click("#startBtn"); await sleep(400); }
    rec("the screen is ready (the window manager and the mocked YouTube player API are there)", Boolean(await until(() => page.evaluate(() => Boolean(window.YT && window.dayspring && window.winman && window.dsViewWords)), 8000)));
    const ytm = () => page.evaluate(() => { const m = window.__ytMock; if (!m) return null; m._tick?.(); return { id: m.id, t: Math.round(m.t * 10) / 10, rate: m.rate, vol: m.vol, state: m.state, modules: [...m.modules], captions: m.captions, calls: m.calls.slice(-8), players: window.__ytAll.length }; });
    const V = () => page.evaluate(() => {
      const b = document.getElementById("media"), cs = getComputedStyle(b), r = b.getBoundingClientRect(), S = window.dsSafeRect(), f = b.querySelector("iframe");
      return { cls: b.className, hidden: b.hidden, opacity: cs.opacity, display: cs.display, pe: cs.pointerEvents, z: Number(cs.zIndex) || 0, r: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        S: { l: Math.round(S.left), t: Math.round(S.top), r: Math.round(S.right), b: Math.round(S.bottom) }, frames: { ...window.__frames }, sameFrame: f === window.__f0, mode: window.dayspring.player.mode, video: window.dayspring.player.video, wm: window.winman.get("video")?.mode, g: window.winman.get("video")?.g };
    });
    const card = () => page.evaluate(() => { const c = document.getElementById("np"); const q = (s) => c.querySelector(s); return { hidden: c.hidden, title: q("#npTitle").textContent, artist: q("#npArtist").textContent, src: q("#npSource").textContent, icon: q("#npIcon").className, art: q("#npArt").getAttribute("src") ?? "",
      modes: !q("#npModes").hidden, on: [...q("#npModes").children].find((b) => b.classList.contains("on"))?.dataset.v ?? null, like: !q("#npLike").hidden, queue: q("#npQueue").hidden ? 0 : q("#npQueue").textContent, playing: c.classList.contains("playing"), seek: !q("#npSeek").closest(".pbar").hidden, remote: c.classList.contains("remote"), idle: c.classList.contains("idle") }; });
    const ctlp = (a, v) => page.evaluate(([x, y]) => window.dayspring.playerCtl(x, y), [a, v]);
    const inSafe = (v, pad = 1) => v.r.x >= v.S.l - pad && v.r.y >= v.S.t - pad && v.r.x + v.r.w <= v.S.r + pad && v.r.y + v.r.h <= v.S.b + pad;
    const stateOnServer = () => api("/player/nowplaying");

    // --- 4a. Big → Corner → Audio → Big: nothing restarts -----------------------------------------------------------------------
    await api("/media/play", { videoId: "abcdefghij1", title: "How dovetails are cut" });
    rec("YouTube plays on the screen, big", Boolean(await until(async () => { const y = await ytm(); return y?.state === 1 && y; })) && (await V()).mode === "big");
    await page.evaluate(() => { window.__f0 = document.querySelector("#media iframe"); window.__loads = 0; window.__f0.addEventListener("load", () => window.__loads++); });
    await ctlp("speed", 1.5); await ctlp("captions", true); await ctlp("volume", 40); await sleep(1500);
    const y0 = await ytm(), f0 = (await V()).frames;
    for (const [a, v, want] of [["view", "corner", "corner"], ["view", "audio", "audio"], ["view", "big", "big"], ["view", "audio", "audio"], ["view", "corner", "corner"], ["view", "full", "big"], ["view", "big", "big"]]) {
      const before = await ytm();
      await ctlp(a, v); await sleep(700);
      const y = await ytm(), vv = await V();
      rec(`${want}${v === "full" ? " (full screen)" : ""}: the same player and frame, still playing on from ${before.t}s, speed, captions and volume kept`,
        vv.mode === want && y.players === y0.players && vv.sameFrame && vv.frames.added === f0.added && vv.frames.removed === f0.removed && y.state === 1 && y.t >= before.t && y.rate === 1.5 && y.modules.includes("captions") && y.vol === y0.vol && (await page.evaluate(() => window.__loads)) === 0,
        j({ y, vv: { mode: vv.mode, sameFrame: vv.sameFrame, frames: vv.frames }, y0 }));
    }
    rec("no stopVideo, destroy or seek was sent while switching", !(await ytm()).calls.some((c) => /stopVideo|destroy|seekTo/.test(c)), j((await ytm()).calls));
    // --- 4b. audio only: not seen, still playing; YouTube pausing it by itself ---------------------------------------------------
    await ctlp("view", "audio"); await sleep(600);
    { const v = await V(), t1 = (await ytm()).t; await sleep(1200); const y = await ytm();
      rec("audio only: the video isn't visible (opacity 0, no clicks) but isn't display:none", v.opacity === "0" && v.pe === "none" && v.display !== "none" && !v.hidden, j(v));
      rec("audio only: the player is still playing (its time runs on)", y.state === 1 && y.t > t1, j([t1, y.t]));
      rec("audio only: the frame is out of the way (inert, hidden from screen readers)", await page.evaluate(() => document.getElementById("media").inert && document.getElementById("media").getAttribute("aria-hidden") === "true"));
      const c = await card();
      const art = await page.evaluate(() => window.dayspring.player.art);
      rec("audio only: the card shows the thumbnail, title, channel, progress and the view switch on Audio", /dovetails|abcdefghij1/.test(c.title) && c.artist && /i\.ytimg\.com\/vi\/abcdefghij1/.test(art) && c.seek && c.modes && c.on === "audio" && /youtube/.test(c.icon) && /audio only/.test(c.src), j(c)); }
    await page.evaluate(() => window.__ytMock._set(2)); // YouTube pauses the hidden player on its own
    rec("audio only: a pause nobody asked for is undone", Boolean(await until(async () => (await ytm()).state === 1, 2500)), j(await ytm()));
    await page.evaluate(() => window.__ytMock._set(2)); await until(async () => (await ytm()).state === 1, 2500);
    await page.evaluate(() => window.__ytMock._set(2));
    rec("…and if YouTube keeps doing it, the video comes back small in the corner, playing, and he's told why", Boolean(await until(async () => { const v = await V(); const y = await ytm(); return v.mode === "corner" && y.state === 1; }, 3000)) && await page.evaluate(() => /corner instead/.test(document.getElementById("toasts").textContent)), j(await V()));
    await ctlp("pause"); await sleep(300); await ctlp("view", "audio"); await sleep(300);
    rec("audio only: a pause HE asks for stays paused", (await ytm()).state === 2 && (await sleep(1200), (await ytm()).state === 2));
    await ctlp("resume");
    // --- 4c. the card's controls in audio only ------------------------------------------------------------------------------------
    await page.click("#npPlay"); rec("card ⏯ pauses the hidden video", Boolean(await until(async () => (await ytm()).state === 2)));
    await page.click("#npPlay"); rec("card ⏯ plays it again", Boolean(await until(async () => (await ytm()).state === 1)));
    await page.evaluate(() => { const r = document.getElementById("npSeek"); r.value = 500; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); });
    rec("card seek bar jumps in the hidden video", Boolean(await until(async () => Math.abs((await ytm()).t - 300) < 3)), j(await ytm()));
    await page.click('#npModes [data-v="corner"]'); rec("card: switch to Corner", Boolean(await until(async () => (await V()).mode === "corner")));
    await page.click('#npModes [data-v="big"]'); rec("card: switch to Big", Boolean(await until(async () => (await V()).mode === "big")));
    await page.evaluate(() => document.querySelector('#npModes [data-v="audio"]').click()); rec("card: switch to Audio only (under the big video the card is reached by keyboard or remote)", Boolean(await until(async () => (await V()).mode === "audio")));
    await page.evaluate(() => document.querySelector('#np .pvol .vi').click()); rec("card: the volume shortcut mutes", Boolean(await until(async () => (await ytm()).vol === 0, 8000)), j(await ytm()));
    await page.evaluate(() => document.querySelector('#np .pvol .vi').click()); await until(async () => (await ytm()).vol > 0);
    // --- 4d. the corner window: drag anywhere, snap, resize, margins, remembered, keys, stacking -------------------------------------
    await ctlp("view", "corner"); await sleep(800);
    let v = await V();
    rec("corner: about a quarter of the width, 16:9, inside the safe area, above the dashboard", v.r.w >= 1280 * 0.2 && v.r.w <= 1280 * 0.35 && Math.abs(v.r.h - v.r.w * 9 / 16) <= 2 && inSafe(v) && v.z >= 14, j(v));
    const dragTo = async (dx, dy, { steps = 8, from = [0.5, 0.45] } = {}) => { const s = await V(); const x0 = s.r.x + s.r.w * from[0], y0 = s.r.y + s.r.h * from[1]; await page.mouse.move(x0, y0); await page.mouse.down(); for (let i = 1; i <= steps; i++) await page.mouse.move(x0 + dx * i / steps, y0 + dy * i / steps); await page.mouse.up(); await sleep(250); return s; };
    { const s = await dragTo(-500, -200); const e = await V(); const y = await ytm();
      rec("drag: the corner window goes exactly where it's dropped (away from the edges)", Math.abs(e.r.x - (s.r.x - 500)) <= 2 && Math.abs(e.r.y - (s.r.y - 200)) <= 2, j([s.r, e.r]));
      rec("drag: dragging isn't a click (it didn't pause)", y.state === 1); }
    { const s = await V(); await page.mouse.click(s.r.x + s.r.w / 2, s.r.y + s.r.h * 0.45); await sleep(400);
      rec("a click (no drag) still plays and pauses", Boolean(await until(async () => (await ytm()).state === 2, 1500))); await ctlp("resume"); }
    { const s = await V(); await dragTo(s.S.l + 12 - s.r.x + 15, 0); const e = await V();
      rec("snap: let go within 24 px of the left edge → it snaps to the edge", e.r.x === s.S.l + 12, j([s.r, e.r, s.S])); }
    { const s = await V(); await dragTo(-5000, -5000); const e = await V();
      rec("dragged far past the corner: it stays inside the safe area (and snaps into the top-left corner)", inSafe(e) && e.r.x === e.S.l + 12 && e.r.y === e.S.t + 12, j(e.r)); }
    { const s = await V(); await dragTo(3000, 3000); const e = await V(); rec("…and the bottom-right corner", inSafe(e) && e.r.x + e.r.w === e.S.r - 12 && e.r.y + e.r.h === e.S.b - 12, j(e)); }
    // pen: the same drag with pointer events from a pen
    { const s = await V();
      await page.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); const o = { bubbles: true, cancelable: true, pointerId: 7, pointerType: "pen", isPrimary: true, button: 0, buttons: 1 };
        el.dispatchEvent(new PointerEvent("pointerdown", { ...o, clientX: x, clientY: y })); for (let i = 1; i <= 6; i++) window.dispatchEvent(new PointerEvent("pointermove", { ...o, clientX: x - i * 40, clientY: y - i * 30 })); window.dispatchEvent(new PointerEvent("pointerup", { ...o, buttons: 0, clientX: x - 240, clientY: y - 180 })); }, { x: s.r.x + s.r.w / 2, y: s.r.y + s.r.h * 0.45 });
      await sleep(250); const e = await V();
      rec("a pen (or touch) drags it too", Math.abs(e.r.x - (s.r.x - 240)) <= 2 && Math.abs(e.r.y - (s.r.y - 180)) <= 2, j([s.r, e.r])); }
    // resize from the handle: 16:9 kept, min and max
    { await page.hover("#media"); const s = await V(); const hb = await page.evaluate(() => { const h = document.querySelector("#media > .wm-resize"); const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, at: h.dataset.at }; });
      const sx = hb.at.includes("r") ? 1 : -1;
      await page.mouse.move(hb.x, hb.y); await page.mouse.down(); await page.mouse.move(hb.x + sx * 120, hb.y + 20, { steps: 6 }); await page.mouse.up(); await sleep(250);
      const e = await V();
      rec("resize from the corner handle: bigger, 16:9 kept, the opposite corner stays put", e.r.w >= s.r.w + 100 && Math.abs(e.r.h - e.r.w * 9 / 16) <= 2 && (sx > 0 ? Math.abs(e.r.x - s.r.x) <= 1 : Math.abs(e.r.x + e.r.w - (s.r.x + s.r.w)) <= 1), j([hb, s.r, e.r]));
      const h2 = await page.evaluate(() => { const r = document.querySelector("#media > .wm-resize").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, at: document.querySelector("#media > .wm-resize").dataset.at }; });
      const s2 = h2.at.includes("r") ? 1 : -1;
      await page.mouse.move(h2.x, h2.y); await page.mouse.down(); await page.mouse.move(h2.x - s2 * 2000, h2.y, { steps: 6 }); await page.mouse.up(); await sleep(250);
      rec("…never smaller than its minimum (200 px wide)", (await V()).r.w >= 199, j((await V()).r));
      const h3 = await page.evaluate(() => { const r = document.querySelector("#media > .wm-resize").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, at: document.querySelector("#media > .wm-resize").dataset.at }; });
      const s3 = h3.at.includes("r") ? 1 : -1;
      await page.mouse.move(h3.x, h3.y); await page.mouse.down(); await page.mouse.move(h3.x + s3 * 5000, h3.y + 3000, { steps: 6 }); await page.mouse.up(); await sleep(250);
      const e3 = await V(); rec("…and never bigger than the safe area", inSafe(e3) && e3.r.h <= e3.S.b - e3.S.t, j(e3)); }
    // keys: focused, the arrows move it and Shift+arrows resize it
    await ctlp("view", "big"); await sleep(300); await ctlp("view", "corner"); await sleep(700);
    { await page.evaluate(() => window.winman.setMode("video", "small", { geom: { x: 500, y: 260, w: 320, h: 180 } })); await sleep(800);
      await page.evaluate(() => document.getElementById("media").focus()); const s = await V();
      await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowUp"); await sleep(800); const e = await V();
      rec("keys: ← and ↑ move the focused corner window 24 px", e.r.x === s.r.x - 24 && e.r.y === s.r.y - 24 && (await ytm()).state === 1, j([s.r, e.r]));
      await page.keyboard.press("Shift+ArrowRight"); await sleep(800); const e2 = await V();
      rec("keys: Shift+→ makes it bigger", e2.r.w > e.r.w, j([e.r, e2.r]));
      await page.keyboard.press("Shift+ArrowLeft"); await page.keyboard.press("Shift+ArrowLeft"); await sleep(800);
      rec("keys: Shift+← smaller", (await V()).r.w < e2.r.w); }
    // remembered for this screen size
    { await sleep(300); const g = (await V()).r; await ctlp("stop"); await sleep(500);
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(`ds-wm-rect-video-${innerWidth}x${innerHeight}`) ?? "null"));
      rec("the corner window's place and size are saved for this screen size", saved && Math.abs(saved.x - g.x) <= 1 && Math.abs(saved.w - g.w) <= 1, j([saved, g]));
      await page.reload(); await sleep(2200);
      // (the reloaded page is the speaker, with its player API loaded, before anything is played)
      await until(() => page.evaluate(() => Boolean(window.YT && window.dayspring && window.dsIsSpeaker !== false && window.winman)), 15000); await sleep(1500);
      await api("/settings", { videoStartMode: "corner" });
      await api("/media/play", { videoId: "abcdefghij2", title: "Sharpening a chisel" }); await until(async () => (await ytm())?.state === 1, 12000);
      await sleep(800); const e = await V();
      rec("after a reload, the next video in the corner is where he left it", e.mode === "corner" && Math.abs(e.r.x - g.x) <= 1 && Math.abs(e.r.y - g.y) <= 1 && Math.abs(e.r.w - g.w) <= 1, j([g, e.r]));
      await api("/settings", { videoStartMode: "remember" }); }
    // the margins change: it goes back inside
    for (const mg of [{ marginRight: 8, marginBottom: 10 }, { marginLeft: 12, marginTop: 6, marginRight: 3, marginBottom: 3 }, { overscan: 0 }]) {
      await dragTo(3000, 3000); await api("/settings", mg); await sleep(900);
      const e = await V();
      rec(`margins ${j(mg)}: the corner window is kept inside the safe area`, inSafe(e) && e.S.r <= 1280, j(e));
    }
    await api("/settings", { overscan: 0 });
    // the window gets smaller: it's pulled back inside (and put back where it was at the old size after)
    { await dragTo(3000, 3000); await sleep(300); const before = (await V()).r;
      await page.setViewportSize({ width: 900, height: 560 }); await sleep(900); const e = await V();
      rec("the screen gets smaller: the corner window is pulled back inside it", inSafe(e) && e.S.r <= 900, j(e));
      await page.setViewportSize({ width: 1280, height: 720 }); await sleep(900); const back = (await V()).r;
      rec("…and back at the old size it's where it was", Math.abs(back.x - before.x) <= 1 && Math.abs(back.y - before.y) <= 1, j([before, back])); }
    // stacking: above the dashboard, under dialogs
    { await page.evaluate(() => window.dsOpenPage("/setup?embed=1")); await sleep(600);
      const z = await page.evaluate(() => ({ media: Number(getComputedStyle(document.getElementById("media")).zIndex), page: Number(getComputedStyle(document.getElementById("pagewrap")).zIndex), overlay: Number(getComputedStyle(document.querySelector(".overlay")).zIndex), toasts: Number(getComputedStyle(document.getElementById("toasts")).zIndex), np: Number(getComputedStyle(document.getElementById("np")).zIndex) || 0 }));
      rec("stacking: the corner window is above the dashboard and under dialogs, pages and notifications", z.media >= 14 && z.media < z.page && z.media < z.overlay && z.media < z.toasts && z.media > z.np, j(z));
      await page.evaluate(() => document.getElementById("pageClose").click()); await sleep(300); }
    // --- 4e. the voice ------------------------------------------------------------------------------------------------------------
    const VOICE = [["minimize the video", "audio"], ["show the video", "big"], ["picture in picture", "corner"], ["make it big", "big"], ["hide the video", "audio"], ["put it in the corner", "corner"], ["full screen", "big"], ["audio only", "audio"],
      ["make it small", "corner"], ["just play the audio", "audio"], ["make it big", "big"]];
    for (const [w, want] of VOICE) { await sleep(1700); const r = await chat(w); const ok = await until(async () => (await V()).mode === want, 3000); rec(`voice: “${w}” → ${want}`, Boolean(ok) && (await ytm()).state === 1, `${r.reply} ${j((await V()).mode)}`); }
    await chat("put it in the corner"); await until(async () => (await V()).mode === "corner");
    { await sleep(1700); await chat("move it to the top left"); const e = await until(async () => { const v = await V(); return Math.round(v.g?.x) === v.S.l + 12 && Math.round(v.g?.y) === v.S.t + 12 && v; }, 4000); rec("voice: “move it to the top left”", Boolean(e), j((await V()).g)); await sleep(900); }
    { const s = await V(); await chat("make the video bigger"); await sleep(900); const e = await V(); rec("voice: “make the video bigger” (the corner window grows, pinned to its corner)", e.r.w > s.r.w && e.r.x === s.r.x && e.r.y === s.r.y, j([s.r, e.r])); }
    { await chat("move the video to the center"); await sleep(900); const e = await V(); rec("voice: “move the video to the center”", Math.abs(e.r.x + e.r.w / 2 - (e.S.l + e.S.r) / 2) <= 2 && Math.abs(e.r.y + e.r.h / 2 - (e.S.t + e.S.b) / 2) <= 2, j(e)); }
    { await chat("move the video to the bottom right"); await sleep(900); const e = await V(); rec("voice: “move the video to the bottom right”", e.r.x + e.r.w === e.S.r - 12 && e.r.y + e.r.h === e.S.b - 12, j(e)); }
    { const s = await V(); await chat("make the video smaller"); await sleep(900); rec("voice: “make the video smaller”", (await V()).r.w < s.r.w); }
    { const said = await page.evaluate(() => { const out = {}; for (const t of ["audio only", "make it big", "picture in picture", "move it to the top right", "minimize the video"]) { out[t] = window.dayspring.musicCommand(t) !== null; } return out; });
      await sleep(600); rec("said on the screen itself (no server): the same words work", Object.values(said).every(Boolean) && (await V()).mode === "audio", j(said)); }
    // keys: A, B, I, F
    await page.evaluate(() => document.activeElement?.blur?.());
    for (const [k, want] of [["b", "big"], ["i", "corner"], ["a", "audio"], ["a", "corner"], ["b", "big"], ["a", "audio"], ["f", "big"]]) { await page.keyboard.press(k); rec(`key ${k.toUpperCase()} → ${want}`, Boolean(await until(async () => (await V()).mode === want, 2000)), j((await V()).mode)); }
    rec("key F from audio only is full screen", (await V()).cls.includes("full")); await page.keyboard.press("f");
    // buttons on the player
    const btn = (sel) => page.evaluate((s) => { document.getElementById("media").classList.add("showctl"); document.querySelector(s)?.click(); }, sel);
    await btn("#vMin"); rec("button ▭ on the video: the corner", Boolean(await until(async () => (await V()).mode === "corner")));
    await btn("#vAudio"); rec("button ♪ on the video: audio only", Boolean(await until(async () => (await V()).mode === "audio")));
    await page.evaluate(() => document.querySelector('#npModes [data-v="big"]').click()); await btn("#vFull"); rec("button ⛶ on the video: full screen", Boolean(await until(async () => (await V()).cls.includes("full")))); await btn("#vFull");
    // ducking under Dayspring's voice, in audio only
    await ctlp("view", "audio"); await sleep(300);
    { const full = (await ytm()).vol; await page.evaluate(() => { window.__speakMs = 1500; window.dayspring.speak("Here is a thing to say while the music plays."); });
      const low = await until(async () => { const y = await ytm(); return y.vol < full * 0.5 ? y.vol : null; }, 1500);
      rec("in audio only, the video still ducks under Dayspring's voice…", low !== null && low !== undefined, j([full, low]));
      rec("…and comes back up after", Boolean(await until(async () => (await ytm()).vol === full, 4000))); await page.evaluate(() => { window.__speakMs = 5; }); }
    // what the server knows (one "now playing"), and the queue count
    { const s = await until(async () => { const x = await stateOnServer(); return x.current?.mode === "audio" && x.current; }, 4000);
      rec("the server's one “now playing” has it (YouTube, audio only, controllable)", s?.provider === "youtube" && s.controllable && s.can?.modes, j(s)); }
    // --- 4f. remember last mode --------------------------------------------------------------------------------------------------
    await ctlp("stop"); await sleep(4500);
    await api("/settings", { videoStartMode: "remember", videoModeLast: { "youtube-music": "big", youtube: "big" } });
    await api("/media/play", { videoId: "abcdefghij3", title: "Hollow Pines - River Song (Official Music Video)" }); await until(async () => (await ytm())?.state === 1);
    await sleep(500); rec("remember: a music video starts big (last time was big)", (await V()).mode === "big");
    await ctlp("view", "audio"); await sleep(900);
    rec("remember: choosing audio only for a music video is saved for music videos", Boolean(await until(async () => (await api("/settings")).settings.videoModeLast?.["youtube-music"] === "audio", 6000)), j((await api("/settings")).settings.videoModeLast));
    await ctlp("stop"); await sleep(4500);
    await api("/media/play", { videoId: "abcdefghij4", title: "Sunrise Choir - Morning Hymn (Lyrics)" }); await until(async () => (await ytm())?.state === 1); await sleep(500);
    rec("remember: the next music video starts audio only", (await V()).mode === "audio", j(await V()));
    await ctlp("stop"); await sleep(4500);
    await api("/media/play", { videoId: "abcdefghij5", title: "How to fix a squeaky door" }); await until(async () => (await ytm())?.state === 1); await sleep(500);
    rec("remember: an ordinary video still starts big (its own last time)", (await V()).mode === "big");
    await api("/settings", { videoStartMode: "audio" }); await ctlp("stop"); await sleep(4500);
    await api("/media/play", { videoId: "abcdefghij6", title: "Bread from scratch" }); await until(async () => (await ytm())?.state === 1); await sleep(500);
    rec("setting “Audio only”: every video starts audio only", (await V()).mode === "audio");
    await api("/settings", { videoStartMode: "remember" });
    // --- 4g. the card for each source, switching, one voice -----------------------------------------------------------------------
    { const c = await card(); rec("card: YouTube (icon, thumbnail, title, channel, the view switch, save)", /youtube/.test(c.icon) && /Bread from scratch|abcdefghij6/.test(c.title) && c.artist && c.modes && c.like && /ytimg/.test(await page.evaluate(() => window.dayspring.player.art)), j(c)); }
    await page.click("#npLike"); rec("card ♡ on a video saves it to “Saved videos”", Boolean(await until(async () => (await api("/player/videolists")).lists?.some((l) => /saved videos/i.test(l.name) && l.items.some((x) => x.videoId === "abcdefghij6")))));
    // his own song: YouTube stops, the card switches
    await page.evaluate((src) => window.dsLocalPlayer.play({ queue: [{ id: "s1", src, title: "River Song", artist: "Hollow Pines", kind: "audio", duration: 30 }, { id: "s2", src, title: "Second Song", artist: "Hollow Pines", kind: "audio", duration: 30 }], index: 0 }), `${mock.url}/song.webm`);
    await sleep(1200);
    { const c = await card(), y = await ytm(), box = await V();
      rec("his own song starts: YouTube stops (never two at once) and its frame goes", y.calls.some((x) => /stopVideo|destroy/.test(x)) && box.hidden, j([y.calls, box.hidden]));
      rec("card: his own song (file icon, title, artist, no view switch, the queue count)", /file/.test(c.icon) && c.title === "River Song" && c.artist === "Hollow Pines" && !c.modes && /1/.test(String(c.queue)), j(c)); }
    await page.click('#np [data-p="next"]'); rec("card ⏭ goes to his next song", Boolean(await until(async () => (await card()).title === "Second Song")));
    // his own video: modes too, and the same <video> element in every mode
    await page.evaluate((src) => window.dsLocalPlayer.play({ queue: [{ id: "v1", src, title: "QA clip", kind: "video", duration: 30 }], index: 0 }), `${mock.url}/clip.webm`);
    const lv = () => page.evaluate(() => { const e = document.getElementById("lv"); return e ? { t: e.currentTime, paused: e.paused, same: e === window.__lv0, rate: e.playbackRate } : null; });
    await until(async () => { const x = await lv(); return x && x.t > 0.5 && !x.paused; }, 8000);
    await page.evaluate(() => { window.__lv0 = document.getElementById("lv"); window.__lv0.playbackRate = 1.25; });
    { const c = await card(); rec("card: his own video (the view switch is there)", /file/.test(c.icon) && c.title === "QA clip" && c.modes, j(c)); }
    const vids0 = (await V()).frames.videos;
    for (const m of ["corner", "audio", "big", "corner"]) {
      const b = await lv(); await ctlp("view", m); await sleep(700); const a = await lv(), vv = await V();
      rec(`his own video → ${m}: the same <video>, still playing on, speed kept`, vv.mode === m && a.same && !a.paused && a.t >= b.t && a.rate === 1.25 && vv.frames.videos === vids0 && (m !== "audio" || (vv.opacity === "0" && vv.display !== "none")), j([b, a, vv.mode, vv.opacity]));
    }
    // YouTube again: his video stops
    await api("/media/play", { videoId: "abcdefghij7", title: "Planing a board" }); await until(async () => (await ytm())?.state === 1 && (await ytm()).id === "abcdefghij7");
    await sleep(600);
    rec("YouTube starts: his own video stops (one at a time)", !(await lv()), j(await lv()));
    // Lantern's study music reported: one voice pauses the screen's player, the card shows Lantern
    await sleep(1600);
    await api("/player/nowplaying/report", { source: "lantern", title: "Deep Focus", artist: "Lantern study music", playing: true, duration: 1800 });
    rec("Lantern starts its study music: the screen's YouTube is paused (one voice)", Boolean(await until(async () => (await ytm()).state === 2, 4000)), j(await ytm()));
    await ctlp("stop"); await sleep(800);
    { const c = await until(async () => { const x = await card(); return x.title === "Deep Focus" && x; }, 4000);
      rec("card: Lantern's music (reported), with its icon, and its buttons off (it's controlled in Lantern)", c && /lantern/.test(c.icon) && c.remote && await page.evaluate(() => document.getElementById("npPlay").disabled), j(c ?? await card())); }
    await api("/player/nowplaying/report", { source: "lantern", ended: true });
    rec("Lantern stops: the card hides (nothing playing)", Boolean(await until(async () => (await card()).hidden, 3000)), j(await card()));
    await api("/settings", { nowPlayingIdle: "show" });
    rec("setting “Nothing playing”: the card stays, saying so", Boolean(await until(async () => { const c = await card(); return !c.hidden && c.idle && c.title === "Nothing playing"; }, 3000)), j(await card()));
    await api("/settings", { nowPlayingIdle: "hide" });
    // Spotify (a mocked Web Playback SDK) on a second screen page
    { const sp = await ctx.newPage();
      await sp.route("**/api/player/status", (rt) => rt.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ spotify: { signedIn: true, configured: true }, screenPlayer: true }) }));
      await sp.route("**/api/player/spotify/token", (rt) => rt.fulfill({ status: 200, contentType: "application/json", body: '{"token":"qa"}' }));
      const spCalls = []; await sp.route("**/api/player/spotify/api", (rt) => { spCalls.push(JSON.parse(rt.request().postData() || "{}")); rt.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); });
      await sp.addInitScript(() => {
        class Player { constructor(o) { this.l = {}; this.calls = []; this.vol = 1; window.__sp = this; } addListener(e, f) { this.l[e] = f; } connect() { setTimeout(() => this.l.ready?.({ device_id: "qa-dev" }), 20); return Promise.resolve(true); }
          disconnect() {} pause() { this.calls.push("pause"); return Promise.resolve(); } resume() { this.calls.push("resume"); return Promise.resolve(); } seek(ms) { this.calls.push("seek:" + Math.round(ms / 1000)); return Promise.resolve(); }
          nextTrack() { this.calls.push("next"); return Promise.resolve(); } previousTrack() { this.calls.push("previous"); return Promise.resolve(); } setVolume(v) { this.vol = v; return Promise.resolve(); } getVolume() { return Promise.resolve(this.vol); }
          emit(paused = false) { this.l.player_state_changed?.({ paused, position: 30000, duration: 200000, shuffle: false, repeat_mode: 0, track_window: { current_track: { name: "Gratitude", uri: "spotify:track:qa", artists: [{ name: "Hollow Pines" }], album: { images: [{ url: "https://i.scdn.co/image/qa" }] } }, next_tracks: [{ name: "Next One", artists: [{ name: "X" }] }] } }); } }
        window.Spotify = { Player };
      });
      await sp.goto(`${BASE}/display`); await sleep(2000);
      await sp.evaluate(() => window.dayspring.initSpotify()); await until(() => sp.evaluate(() => Boolean(window.__sp?.l?.player_state_changed)), 5000);
      await sp.evaluate(() => window.__sp.emit(false)); await sleep(300);
      const c = await sp.evaluate(() => { const q = (s) => document.querySelector(s); return { title: q("#npTitle").textContent, icon: q("#npIcon").className, modes: !q("#npModes").hidden, like: !q("#npLike").hidden, queue: q("#npQueue").hidden ? 0 : q("#npQueue").textContent }; });
      rec("card: Spotify (icon, title, like, no view switch, the queue count)", /spotify/.test(c.icon) && c.title === "Gratitude" && c.like && !c.modes && /1/.test(String(c.queue)), j(c));
      await sp.click("#npPlay"); await sp.click("#np [data-p=next]"); await sp.click("#npLike"); await sleep(400);
      rec("card controls drive Spotify (pause, next, like)", ["pause", "next"].every((x) => (await0 => true)() && true) && (await sp.evaluate(() => window.__sp.calls)).includes("pause") && (await sp.evaluate(() => window.__sp.calls)).includes("next") && spCalls.some((x) => x.action === "like" && x.uri === "spotify:track:qa"), j([await sp.evaluate(() => window.__sp.calls), spCalls]));
      // YouTube starting on that page pauses Spotify
      await sp.evaluate(() => window.__sp.emit(false));
      await sp.evaluate(() => window.dayspring.playMedia({ action: "play", provider: "youtube", videoId: "abcdefghij8", title: "After Spotify" }));
      rec("YouTube starting pauses Spotify (never two at once), and the card switches to YouTube", Boolean(await until(async () => (await sp.evaluate(() => window.__sp.calls.filter((x) => x === "pause").length)) >= 2 && /youtube/.test(await sp.evaluate(() => document.getElementById("npIcon").className)), 4000)));
      await sp.evaluate(() => window.dayspring.stopMedia(false));
      await sp.close(); }
    // --- 4h. the window manager: the dock, chips, keys, voice -------------------------------------------------------------------
    await page.bringToFront();
    await api("/media/play", { videoId: "abcdefghij9", title: "Window test" }); await until(async () => (await ytm())?.state === 1 && (await ytm()).id === "abcdefghij9");
    await page.evaluate(() => window.dsOpenPage("/setup?embed=1")); await sleep(1200);
    const wm = () => page.evaluate(() => ({ list: window.winman.list().filter((w) => w.open).map((w) => [w.id, w.mode]), dock: [...document.querySelectorAll("#wmDock .wm-chip")].map((c) => c.dataset.id), dockHidden: document.getElementById("wmDock").hidden }));
    rec("window manager: the settings page is a window (normal) with – ❐ ▢ buttons", (await wm()).list.some(([id, m]) => id === "page" && m === "normal") && await page.evaluate(() => Boolean(document.querySelector("#pagewrap .wm-btns [data-wm=min]"))), j(await wm()));
    await page.click("#pagewrap .wm-btns [data-wm=small]"); await sleep(400);
    { const r = await page.evaluate(() => { const b = document.getElementById("pagewrap").getBoundingClientRect(), S = window.dsSafeRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, S: { l: S.left, t: S.top, r: S.right, b: S.bottom } }; });
      rec("❐ makes it a small window inside the safe area", r.w < 1280 * 0.7 && r.x >= r.S.l && r.x + r.w <= r.S.r + 1 && r.y + r.h <= r.S.b + 1, j(r)); }
    await page.click("#pagewrap .wm-btns [data-wm=max]"); await sleep(300);
    { const r = await page.evaluate(() => { const b = document.getElementById("pagewrap").getBoundingClientRect(), S = window.dsSafeRect(); return Math.abs(b.left - S.left - 12) < 2 && Math.abs(b.right - S.right + 12) < 2; }); rec("▢ maximises it to the safe area", r); }
    await page.click("#pagewrap .wm-btns [data-wm=min]"); await sleep(400);
    { const w = await wm(); const dock = await page.evaluate(() => { const d = document.getElementById("wmDock").getBoundingClientRect(), n = document.getElementById("np").getBoundingClientRect(), S = window.dsSafeRect(); return { d: { l: d.left, r: d.right, t: d.top, b: d.bottom }, n: { l: n.left, t: n.top, b: n.bottom, w: n.width }, S: { l: S.left, r: S.right, b: S.bottom } }; });
      rec("– minimises it to a chip in the dock", w.dock.includes("page") && !w.dockHidden && await page.evaluate(() => document.getElementById("pagewrap").hidden), j(w));
      rec("the dock is inside the safe area, along the bottom, and never over the mini player card", dock.d.l >= dock.S.l && dock.d.b <= dock.S.b + 1 && (dock.n.w === 0 || dock.d.r <= dock.n.l || dock.d.b <= dock.n.t || dock.d.t >= dock.n.b), j(dock)); }
    { const at = await page.evaluate(() => { const c = document.querySelector('#wmDock .wm-chip[data-id="page"]').getBoundingClientRect(); const e = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2); return { r: [c.left, c.top, c.width, c.height], top: e ? e.id || e.className || e.nodeName : null }; });
      if (!/wm-chip|^B$|^SPAN$/.test(String(at.top))) console.log("DEBUG chip", j(at)); }
    await page.click('#wmDock .wm-chip[data-id="page"]', { timeout: 5000 }).catch(async (e) => { rec("the chip can be clicked", false, e.message.slice(0, 200)); await page.evaluate(() => document.querySelector('#wmDock .wm-chip[data-id="page"]')?.click()); }); await sleep(400);
    rec("clicking the chip brings it back (big, the way it was)", (await wm()).list.some(([id, m]) => id === "page" && m === "max") && !(await wm()).dock.includes("page"), j(await wm()));
    // voice: the windows by name, and everything at once
    await sleep(600);
    { const r = await chat("minimize the settings"); rec("voice: “minimize the settings” (the page window) → the dock", Boolean(await until(async () => (await wm()).dock.includes("page"))), r.reply); }
    { const r = await chat("restore the settings"); rec("voice: “restore the settings”", Boolean(await until(async () => (await wm()).list.some(([id, m]) => id === "page" && m !== "min"))), r.reply); }
    await sleep(700);
    { const r = await chat("hide everything"); rec("voice: “hide everything”: every window to the dock, the video to audio only (still playing)", Boolean(await until(async () => { const w = await wm(); return w.dock.includes("page") && (await V()).mode === "audio"; })) && (await ytm()).state === 1, `${r.reply} ${j(await wm())}`); }
    await sleep(700);
    { const srv = await api("/winman/state"); const r = await chat("show everything again"); rec("voice: “show everything again”", Boolean(await until(async () => { const w = await wm(); return !w.dock.includes("page") && (await V()).mode !== "audio"; })), `${r.reply} ${j(await wm())} server: ${j(srv)}`); }
    { await chat("move the settings to the left side"); await sleep(700); const r = await page.evaluate(() => { const b = document.getElementById("pagewrap").getBoundingClientRect(), S = window.dsSafeRect(); return Math.abs(b.left - S.left - 12) < 2; }); rec("voice: “move the settings to the left side”", r); }
    // keys: Alt+↓ minimise, Alt+Shift+↑ everything back
    await page.evaluate(() => document.querySelector("#pagewrap .wm-btns button").focus());
    await page.keyboard.press("Alt+ArrowDown"); rec("keys: Alt+↓ minimises the focused window", Boolean(await until(async () => (await wm()).dock.includes("page"))));
    await page.keyboard.press("Alt+Shift+ArrowUp"); rec("keys: Alt+Shift+↑ brings everything back", Boolean(await until(async () => !(await wm()).dock.includes("page"))));
    { const r = await chat("close the settings"); rec("voice: “close the settings”", Boolean(await until(() => page.evaluate(() => document.getElementById("pagewrap").hidden))), r.reply); }
    await ctlp("stop");
    rec("no script errors on the screen", !errs.length, errs.slice(0, 3).join(" | "));
    // --- 4i. the mini window layout -------------------------------------------------------------------------------------------------
    { const mctx = await newCtx({ width: 520, height: 420 }); const mp = await mctx.newPage(); const merrs = []; mp.on("pageerror", (e) => merrs.push(String(e.message).slice(0, 200)));
      await mp.goto(`${BASE}/mini`); await sleep(2200);
      if (await mp.locator("#startBtn").isVisible().catch(() => false)) { await mp.click("#startBtn"); await sleep(300); }
      await page.close();
      await sleep(600);
      await mp.evaluate(() => window.dayspring.playMedia({ action: "play", provider: "youtube", videoId: "miniaaaaaaa", title: "Mini test" }));
      await until(() => mp.evaluate(() => window.__ytMock?.state === 1), 5000);
      await mp.evaluate(() => window.dayspring.playerCtl("view", "audio")); await sleep(600);
      const m = await mp.evaluate(() => { const c = document.getElementById("np"), r = c.getBoundingClientRect(), b = getComputedStyle(document.getElementById("media")); return { mini: document.documentElement.classList.contains("mini"), card: !c.hidden && r.width > 0 && r.left >= 0 && r.right <= innerWidth + 1, modes: !document.getElementById("npModes").hidden, opacity: b.opacity, playing: window.__ytMock.state }; });
      rec("mini window: audio only, with the compact player card showing (and the view switch)", m.mini && m.card && m.modes && m.opacity === "0" && m.playing === 1, j(m));
      await mp.evaluate(() => window.dayspring.playerCtl("view", "corner")); await sleep(700);
      const c = await mp.evaluate(() => { const r = document.getElementById("media").getBoundingClientRect(), S = window.dsSafeRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, S: { l: S.left, t: S.top, r: S.right, b: S.bottom } }; });
      rec("mini window: the corner window fits inside it", c.x >= c.S.l && c.y >= c.S.t && c.r <= c.S.r + 1 && c.b <= c.S.b + 1, j(c));
      rec("mini window: no script errors", !merrs.length, merrs.join(" | "));
      await mctx.close(); }
  } finally {
    await browser?.close().catch(() => {});
    server.kill();
    await sleep(500);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
await mock.close();
if (!args.includes("--keep")) { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* a file still in use */ } }
process.exit(failed ? 1 : 0);
