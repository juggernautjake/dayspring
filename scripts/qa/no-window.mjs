// Nothing pops up on screen, and videos stay inside Dayspring (a throwaway copy on port 4798; nothing real opens):
//   • with Discover on, interests set and NO YouTube key, the background search runs for a few minutes and never
//     launches the visible media browser (and doesn't create its profile)
//   • YouTube search works without a key (reads youtube.com's results page; needs the internet)
//   • the ↗ Pop out button pauses the video and asks for the person's browser at the right second
//   • a video that can't be embedded shows a "Pop it out?" card and opens nothing by itself
//   • "pop it out" by voice/typing does the same as the button
//   node scripts/qa/no-window.mjs [--quick] [--keep]      --quick: 60 s of background searching instead of 180 s
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const { playwrightChannel } = await import("../../lib/browsers.mjs");
const QUICK = process.argv.includes("--quick"), KEEP = process.argv.includes("--keep");
const PORT = 4798, BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), "ds-nowindow-")), APP = join(TMP, "app");
const LOG = join(TMP, "browser-launches.log"), MEDIA = join(TMP, "media-profile"), SEARCH = join(TMP, "search-profile");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, got = "") => { if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" ? "  (" + got + ")" : ""}`); };

spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(join(APP, "data"), { recursive: true });
writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary", interests: ["woodworking", "ocean animals"], features: { music: true } }));
writeFileSync(join(APP, ".env"), "");
const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_ECO: "1",
  YOUTUBE_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", ELEVENLABS_API_KEY: "", AI_PROVIDER: "", DAYSPRING_REMINDER_CHANNEL: "off",
  DAYSPRING_BROWSER_LOG: LOG, DAYSPRING_MEDIA_PROFILE: MEDIA, DAYSPRING_SEARCH_PROFILE: SEARCH,
  DAYSPRING_DISCOVER_FIRST_MS: "4000", DAYSPRING_DISCOVER_EVERY_MS: "20000", DAYSPRING_DISCOVER_ANYTIME: "1" };
const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = ""; server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
const api = (p, body) => fetch(BASE + "/api" + p, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const launches = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split(/\r?\n/).filter(Boolean) : []);

// a stand-in for YouTube's player (no network): reports 83 s in, and can raise the "can't embed" error on request
const fakeYT = () => {
  window.speechSynthesis && (window.speechSynthesis.speak = (u) => setTimeout(() => u.onend?.(), 20));
  window.YT = { PlayerState: { PLAYING: 1, ENDED: 0, PAUSED: 2 }, Player: function (id, o) {
    const self = { playVideo() { window.__ytPaused = false; }, pauseVideo() { window.__ytPaused = true; }, getCurrentTime: () => 83.4, getDuration: () => 300, getPlayerState: () => (window.__ytPaused ? 2 : 1),
      getVideoData: () => ({ video_id: o.videoId, title: "Test video", author: "Test channel" }), getPlaybackRate: () => 1, getAvailablePlaybackRates: () => [1], setVolume() {}, destroy() {}, stopVideo() {}, seekTo() {}, setShuffle() {}, setLoop() {}, setPlaybackRate() {} };
    window.__ytOpts = o; window.__ytSelf = self;
    setTimeout(() => o.events.onReady({ target: self }), 20);
    return self;
  } };
};

const browser = await chromium.launch({ channel: playwrightChannel(), headless: true, args: ["--mute-audio"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(fakeYT);
  await ctx.route("**/iframe_api*", (r) => r.fulfill({ contentType: "text/javascript", body: "setTimeout(() => window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(), 10);" }));
  const pops = [];
  await ctx.route("**/api/media/popout", async (r) => { pops.push(JSON.parse(r.request().postData() || "{}")); await r.fulfill({ contentType: "application/json", body: JSON.stringify({ opened: true }) }); });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/display"); await page.waitForTimeout(2500);
  if (await page.locator("#startBtn").isVisible().catch(() => false)) await page.click("#startBtn").catch(() => {});

  // ---- background searching opens nothing ---------------------------------------------------------------------------
  await api("/discover/settings", { on: true, frequency: "hourly" });
  await api("/discover/refresh", {}).catch(() => null);
  const t0 = Date.now(), span = QUICK ? 60_000 : 180_000;
  while (Date.now() - t0 < span) await sleep(5000);
  const feed = await api("/discover");
  const vids = (feed.feed ?? []).filter((x) => x.type === "video" || x.type === "short");
  check(`Discover ran for ${span / 1000} s with no YouTube key: the visible media browser never launched`, !launches().some((l) => / media$/.test(l)), launches().join("; ") || "no launches");
  check("…and its profile folder was never created", !existsSync(MEDIA));
  check("…and it found videos without a browser", vids.length > 0, `${vids.length} videos/shorts in the feed`);

  // ---- videos play inside Dayspring; Pop out on request ----------------------------------------------------------------
  await api("/media/play", { videoId: "aqz-KE-bpKQ", title: "Test video" });
  await page.waitForTimeout(1500);
  check("a video plays in the Dayspring player", await page.evaluate(() => !document.querySelector("#media").hidden && window.__ytOpts?.videoId === "aqz-KE-bpKQ"));
  await page.evaluate(() => document.querySelector("#vPop").click());
  await page.waitForTimeout(800);
  check("↗ Pop out asks for the browser at the right second", pops.length === 1 && pops[0].videoId === "aqz-KE-bpKQ" && pops[0].t === 83, JSON.stringify(pops[0] ?? {}));
  check("…and pauses the video in Dayspring", await page.evaluate(() => window.__ytPaused === true));

  // typed command
  await page.evaluate(() => window.__ytSelf.playVideo());
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("ds-test-say", { detail: "pop it out" })));
  await page.waitForTimeout(1500);
  check("saying \"pop it out\" does the same", pops.length === 2 && pops[1].t === 83, `${pops.length} requests`);

  // a video that can't be embedded
  const before = pops.length;
  await api("/media/play", { videoId: "BBBBBBBBBBB", title: "Blocked video" });
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__ytOpts.events.onError({ data: 150 }));
  await page.waitForTimeout(800);
  const card = await page.locator(".toast", { hasText: "can't play inside Dayspring" }).count();
  check("a video that can't be embedded shows a \"Pop it out?\" card", card === 1);
  check("…and nothing opens by itself", pops.length === before);
  await page.locator(".toast", { hasText: "can't play inside Dayspring" }).locator('button[data-a="pop"]').click();
  await page.waitForTimeout(800);
  check("…until Pop out ↗ is pressed", pops.length === before + 1 && pops.at(-1).videoId === "BBBBBBBBBBB");

  // the real route (dry run: DAYSPRING_NO_BROWSER) builds the right address
  const r = await api("/media/popout", { videoId: "aqz-KE-bpKQ", t: 83 });
  check("the pop-out route builds the watch address with the time", r.dryRun && r.url === "https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=83s", r.url);
  const bad = await fetch(BASE + "/api/media/popout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ videoId: "not a video" }) });
  check("…and refuses anything that isn't a video id", bad.status === 400);
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  check("still no visible media browser at the end", !launches().some((l) => / media$/.test(l)));
} finally {
  await browser.close().catch(() => {});
  server.kill();
  await sleep(800);
  spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true });
  if (!KEEP) rmSync(TMP, { recursive: true, force: true }); else console.log("kept:", TMP);
}
if (/Error|unhandled/i.test(serverLog) && fail) console.log(serverLog.slice(-1500));
console.log(fail ? `\n${fail} FAILED` : "\nALL PASSED");
process.exit(fail ? 1 : 0);
