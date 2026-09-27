// 1.2.0 checks: how Dayspring opens, Dayspring mini, Active/Quiet/Off, the hard stop, notification kinds, Brave and the
// private speech recognition, and the desktop-notification helper. On a throwaway copy (port 4797). Nothing is heard,
// nothing opens on screen (browser launches are written to a log instead), and no device is touched.
//   node scripts/qa/open-modes.mjs [--keep] [--no-overlay]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const PORT = 4797, BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), "ds-openmodes-")), APP = join(TMP, "app"), LOG = join(TMP, "launch.log");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" ? "  (" + got + ")" : ""}`); };

// ---------------- A. the pieces, in this process (no server) ----------------
process.env.DS_LAUNCH_LOG = LOG; process.env.DS_PROFILE = "DayspringQA";
const display = await import(pathToFileURL(join(DESK, "lib", "display.mjs")).href);
const chromeB = { id: "chrome", family: "chromium", exe: "chrome.exe" }, braveB = { id: "brave", family: "chromium", exe: "brave.exe" }, ffB = { id: "firefox", family: "firefox", exe: "firefox.exe" };
const main = { number: 1, primary: true, x: 0, y: 0, width: 1920, height: 1080 }, tv = { number: 2, primary: false, x: 1920, y: 0, width: 3840, height: 2160 };
const url = "http://localhost:4747/display";
const a1 = display.launchArgs(chromeB, url, main, "window");
check("app window: --app, its own profile, maximized, no kiosk", a1.includes(`--app=${url}`) && a1.some((x) => /user-data-dir=.*DayspringQA"?$/.test(x)) && a1.includes("--start-maximized") && !a1.includes("--kiosk"), a1.slice(-3).join(" "));
const a2 = display.launchArgs(chromeB, url, tv, "fullscreen");
check("full screen: --kiosk on the chosen screen", a2.includes("--kiosk") && a2.includes("--window-position=1920,0"));
const a3 = display.launchArgs(chromeB, url, main, "tab");
check("browser tab: just the address, the owner's own profile", a3.length === 1 && a3[0] === url, JSON.stringify(a3));
const a4 = display.launchArgs(ffB, url, main, "tab");
check("Firefox tab: -new-tab", a4[0] === "-new-tab");
const a5 = display.launchArgs(chromeB, "http://localhost:4747/mini", main, "compact");
check("compact: a small app window (380×560) at the top-right", a5.includes("--window-size=380,560") && a5.some((x) => /^--window-position=1516,48$/.test(x)) && !a5.includes("--kiosk"), a5.filter((x) => /window-/.test(x)).join(" "));
const a6 = display.launchArgs(braveB, url, tv, "fullscreen");
check("Brave: Chromium flags, its own profile folder", a6.includes("--kiosk") && a6.some((x) => /DayspringQA-brave/.test(x)) && a6.includes("--autoplay-policy=no-user-gesture-required"));
check("auto: window on the main screen, full screen on a second", display.modeFor("auto", main) === "window" && display.modeFor("auto", tv) === "fullscreen");
check("the mini remembers where it was", JSON.stringify(display.miniBounds(main, { x: 100, y: 200, width: 400, height: 600 })) === JSON.stringify({ x: 100, y: 200, width: 400, height: 600 }));
const wr = await import(pathToFileURL(join(DESK, "lib", "window-routes.mjs")).href);
const intents = { "open dayspring in my browser": "tab", "open in its own window": "window", "go full screen": "fullscreen", "make dayspring small": "compact", "compact mode": "compact", "expand": "full", "what's the weather": null };
check("voice: open-mode phrases", Object.entries(intents).every(([t, want]) => wr.openAsIntent(t) === want), Object.entries(intents).map(([t]) => wr.openAsIntent(t)).join(","));
const quiet = await import(pathToFileURL(join(DESK, "lib", "quiet.mjs")).href);
const base = { mode: "voice", listenState: "active", notify: { reminders: "chime" }, notifyAll: null };
check("notification kinds: per kind, else the usual mode", quiet.modeFor("reminders", base) === "chime" && quiet.modeFor("texts", base) === "voice");
check("notification kinds: the quick switch beats them all", quiet.modeFor("reminders", { ...base, notifyAll: "silent" }) === "silent");
check("Quiet and Off: everything silent", quiet.modeFor("texts", { ...base, listenState: "quiet" }) === "silent" && quiet.modeFor("texts", { ...base, listenState: "off" }) === "silent");
check("announcement kinds", quiet.kindOf({ kind: "reminder" }) === "reminders" && quiet.kindOf({ kind: "text" }) === "texts" && quiet.kindOf({ kind: "update" }) === "system" && quiet.kindOf({ kind: "start" }) === "schedule");
const ov = await import(pathToFileURL(join(DESK, "lib", "overlay.mjs")).href);
const sOn = { overlay: { on: true }, listenState: "active" };
check("desktop cards: a reminder gets Snooze", ov.cardFor({ kind: "reminder", reminder: { text: "Call Sam" } }, sOn)?.snooze === true);
check("desktop cards: none when Off and 'Show when Off' is off", ov.cardFor({ kind: "start", text: "x" }, { ...sOn, listenState: "off", overlayWhenOff: false }) === null);
check("desktop cards: silent still shows one", ov.cardFor({ kind: "start", text: "x" }, { ...sOn, notifyAll: "silent" }) !== null);
const br = await import(pathToFileURL(join(DESK, "lib", "browsers.mjs")).href);
check("Brave is recognised by its exe and its ProgId", br.browserForExe("C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe") === "brave" && br.idForProgId("BraveHTML") === "brave" && br.idForProgId("BraveBHTML") === "brave");
check("Brave's install places are known", br.KNOWN.find((k) => k.id === "brave").paths.some((p) => /AppData|Local/i.test(p) || /BraveSoftware\\Brave-Browser\\Application\\brave\.exe$/i.test(p)));
delete process.env.DS_LAUNCH_LOG; delete process.env.DS_PROFILE;

// ---------------- B. a throwaway server ----------------
spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(join(APP, "data"), { recursive: true });
writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary" }));
const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DS_LAUNCH_LOG: LOG, DS_PROFILE: "DayspringQA", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_NO_ECO: "1", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", ELEVENLABS_API_KEY: "", AI_PROVIDER: "", DAYSPRING_REMINDER_CHANNEL: "off" };
const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = ""; server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
const api = async (path, body, method = body === undefined ? "GET" : "POST") => { const r = await fetch(BASE + "/api" + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
const launches = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) : []);
const n0 = launches().length;
let r = await api("/app/open", { openAs: "tab" });
check("shortcut 'in browser': a tab opens", r.opened && r.mode === "tab" && launches().length === n0 + 1, JSON.stringify(r));
r = await api("/app/open", {});
check("starting again right away: no second window", !r.opened && (r.pending || r.already), JSON.stringify(r));
r = await api("/app/open", { openAs: "compact" });
const last = launches().at(-1);
check("⤡ compact: the mini opens (and claims the voice)", r.opened && r.mode === "compact" && last.args.some((x) => /\/mini\?claim=1$/.test(x)), last?.args?.[0]);
r = await api("/app/open", { openAs: "fullscreen" });
check("full screen: kiosk", r.opened && launches().at(-1).args.includes("--kiosk"));
r = await api("/window/bounds", { x: 10, y: 20, width: 400, height: 600 });
check("the mini's place is remembered", r.ok && JSON.parse(readFileSync(join(APP, "data", "owner.json"), "utf8")).miniBounds?.width === 400);
r = await api("/listen", { state: "off" });
check("Off: saved and announced", r.state === "off" && (await api("/listen")).state === "off");
await api("/listen", { state: "active" });
r = await api("/settings", { notify: { reminders: "chime" }, notifyAll: null });
check("notification kinds save", r.settings?.notify?.reminders === "chime");
r = await api("/setup/display", { displayBrowser: "default", openAs: "compact" });
check("Settings: 'How Dayspring opens' saves compact", r.openAs === "compact");
await api("/setup/display", { openAs: "auto" });
const sttR = await fetch(`${BASE}/api/stt?purpose=wake`, { method: "POST", body: new Uint8Array(100) });
check("private speech: tiny input is ignored", sttR.status === 200 && (await sttR.json()).text === "");

// B2. updates: an installed copy asks the REAL GitHub releases (read-only) and sees a newer version
{
  const pj = join(APP, "package.json"), p0 = readFileSync(pj, "utf8");
  writeFileSync(pj, p0.replace(/"version":\s*"[^"]+"/, '"version": "1.1.0"'));
  const u = await api("/update/check");
  check("updates: an installed 1.1.0 sees the newer release on GitHub", u.available === true && /^\d+\.\d+\.\d+/.test(u.latest ?? "") && Boolean(u.zip), JSON.stringify({ available: u.available, latest: u.latest, error: u.error }));
  writeFileSync(pj, p0);
  const u2 = await api("/update/check");
  check("updates: the newest version says it is up to date (or shows a readable error)", u2.available === false || Boolean(u2.error), JSON.stringify({ available: u2.available, latest: u2.latest, current: u2.current, error: u2.error }));
}

// ---------------- C. in a (headless) browser ----------------
const browser = await chromium.launch({ channel: (await import(pathToFileURL(join(DESK, "lib", "browsers.mjs")).href)).playwrightChannel(), headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
const mockBase = () => {
  window.__spoken = []; window.__srStarts = 0; window.__trackStops = 0;
  const ss = window.speechSynthesis;
  if (ss) { ss.speak = (u) => { window.__spoken.push(u.text); setTimeout(() => u.onend?.(), 20); }; ss.cancel = () => {}; }
  HTMLMediaElement.prototype.play = function () { (window.__sounds = window.__sounds ?? []).push(this.src || "audio"); setTimeout(() => this.onended?.(), 20); return Promise.resolve(); };
  window.__dsAllowAutomatedListen = true;
  // a microphone made of a silent oscillator; every track.stop() is counted
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext(), osc = ctx.createOscillator(), g = ctx.createGain(); g.gain.value = window.__micLoud ? 0.8 : 0.0001;
    const dest = ctx.createMediaStreamDestination(); osc.connect(g); g.connect(dest); osc.start(); (window.__micGains = window.__micGains ?? []).push(g);
    const st = dest.stream; st.getTracks().forEach((t) => { const s0 = t.stop.bind(t); t.stop = () => { window.__trackStops++; s0(); }; });
    return st;
  };
};
const mockSR = () => {
  class FakeSR { constructor() { this.onend = this.onresult = this.onerror = null; } start() { window.__srStarts++; window.__sr = this; } abort() { setTimeout(() => this.onend?.(), 10); } stop() { this.abort(); } }
  window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
};
const mockBrave = () => {
  Object.defineProperty(navigator, "brave", { value: { isBrave: async () => true }, configurable: true });
  delete window.SpeechRecognition; delete window.webkitSpeechRecognition;
  try { Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true }); } catch { /* fine */ }
  window.speechSynthesis.getVoices = () => [{ name: "Microsoft David - English (United States)", lang: "en-US", localService: true, voiceURI: "David" }, { name: "Microsoft Zira - English (United States)", lang: "en-US", localService: true, voiceURI: "Zira" }];
};
const DEVICE_ROUTES = /\/api\/(sound|window\/ontop|devices\/use|voicemeeter\/(install|setup)|keepawake|tunein|callbridge)/;
const tap = (p, sel) => p.evaluate((q) => document.querySelector(q)?.click(), sel);   // toasts may sit over a button; the checks press it directly
async function page(path, { width = 1280, height = 720, init = [], routes = [] } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  for (const fn of [mockBase, ...init]) await ctx.addInitScript(fn);
  await ctx.route("**/*", async (rt) => {
    const u = rt.request().url(), m = rt.request().method();
    for (const [re, body] of routes) if (re.test(u)) return rt.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(typeof body === "function" ? body(rt.request()) : body) });
    if (m === "POST" && DEVICE_ROUTES.test(u)) return rt.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    return rt.continue();
  });
  const p = await ctx.newPage(); p.__errors = [];
  p.on("pageerror", (e) => p.__errors.push(e.message));
  await p.goto(BASE + path); await p.waitForTimeout(2500);
  if (await p.locator("#startBtn").isVisible().catch(() => false)) { await p.click("#startBtn"); await p.waitForTimeout(800); }
  return p;
}

// C1. Dayspring mini at small sizes
for (const [w, h] of [[380, 560], [320, 480], [480, 700]]) {
  const p = await page("/mini", { width: w, height: h, init: [mockSR] });
  const m = await p.evaluate(() => ({ mini: document.documentElement.classList.contains("mini"), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, show: getComputedStyle(document.getElementById("show")).display, expand: getComputedStyle(document.getElementById("expandBtn")).display, compact: getComputedStyle(document.getElementById("compactBtn")).display, state: !!document.getElementById("stateBtn"), talk: document.getElementById("talkStatus") ? 1 : 0 }));
  check(`mini ${w}×${h}: compact layout, no sideways scroll`, m.mini && m.sw <= m.cw + 1 && m.show === "none" && m.expand !== "none" && m.compact === "none" && m.state, JSON.stringify(m));
  if (w === 380) {
    await tap(p, "#stateBtn"); await p.waitForTimeout(300);
    const menu = await p.evaluate(() => ({ open: !document.getElementById("stateMenu").hidden, items: document.querySelectorAll("#stateMenu [data-state]").length, ontop: !!document.querySelector("#stateMenu [data-ontop]") }));
    check("mini: the state menu opens, with Keep on top", menu.open && menu.items === 3 && menu.ontop, JSON.stringify(menu));
    await p.screenshot({ path: join(TMP, "mini-380.png") });
  }
  check(`mini ${w}×${h}: no page errors`, p.__errors.length === 0, p.__errors.join(" | "));
  await p.context().close();
}

// C1b. ONE page: the layout follows the window size; ⤡ / ⤢ resize the same window (the resize calls are checked, not made)
{
  const calls = [];
  const p = await page("/display", { width: 380, height: 560, init: [mockSR], routes: [[/\/api\/window\/(compact|expand)$/, (req) => { calls.push(req.url().split("/").pop()); return { ok: true }; }]] });
  const small = await p.evaluate(() => document.documentElement.classList.contains("mini"));
  await tap(p, "#expandBtn"); await p.waitForTimeout(300);
  await p.setViewportSize({ width: 1400, height: 860 }); await p.waitForTimeout(500);
  const big = await p.evaluate(() => ({ mini: document.documentElement.classList.contains("mini"), show: getComputedStyle(document.getElementById("show")).display, compact: getComputedStyle(document.getElementById("compactBtn")).display }));
  await tap(p, "#compactBtn"); await p.waitForTimeout(300);
  await p.setViewportSize({ width: 380, height: 560 }); await p.waitForTimeout(500);
  const smallAgain = await p.evaluate(() => document.documentElement.classList.contains("mini"));
  check("one page: small window → compact layout", small && smallAgain);
  check("one page: maximized → full layout", !big.mini && big.show !== "none" && big.compact !== "none", JSON.stringify(big));
  check("⤢ and ⤡ ask to resize the same window", calls.join(",") === "expand,compact", calls.join(","));
  check("one page: no page errors", p.__errors.length === 0, p.__errors.join(" | "));
  await p.context().close();
}

// C2. Off releases the microphone and never listens; back to Active listens again
{
  const p = await page("/display", { init: [mockSR] });
  await p.waitForTimeout(1500);
  const before = await p.evaluate(() => window.__srStarts);
  await tap(p, "#stateBtn"); await p.waitForTimeout(200);
  await tap(p, "#stateMenu [data-state=\"off\"]"); await p.waitForTimeout(1500);
  const s0 = await p.evaluate(() => ({ starts: window.__srStarts, stops: window.__trackStops, st: window.dsListenState, badge: document.getElementById("stateLbl").textContent }));
  await p.waitForTimeout(9000);   // two watchdog ticks
  const s1 = await p.evaluate(() => ({ starts: window.__srStarts }));
  check("Off: badge says Off, the mic's tracks are stopped", s0.st === "off" && s0.badge === "Off" && s0.stops >= 1, JSON.stringify(s0));
  check("Off: the watchdog never starts listening", s1.starts === s0.starts, `${s0.starts} → ${s1.starts}`);
  await p.evaluate(() => window.dayspring.speak("Just testing.", null, "alarm"));
  await tap(p, "#stateBtn"); await p.waitForTimeout(200);
  await tap(p, "#stateMenu [data-state=\"active\"]"); await p.waitForTimeout(1500);
  const s2 = await p.evaluate(() => window.__srStarts);
  check("back to Active: listening starts again", s2 > s1.starts, `${s1.starts} → ${s2} (before Off ${before})`);
  check("Off ⇄ Active: no page errors", p.__errors.length === 0, p.__errors.join(" | "));
  await p.context().close();
}

// C2r. After a question it waits at most 7 s for an answer, room noise can't hold it open for long, and with listening
// stopped it doesn't wait at all (1.2.2)
{
  const p = await page("/display", { init: [mockSR] });
  await p.waitForTimeout(1500);
  const say = (t, final) => p.evaluate(([t, final]) => { const r = [{ 0: { transcript: t }, length: 1, isFinal: final }]; window.__sr?.onresult?.({ resultIndex: 0, results: r }); }, [t, final]);
  const state = () => p.evaluate(() => ({ mode: window.__dsTest?.mode(), mic: document.getElementById("micText")?.textContent ?? "" }));
  await p.evaluate(() => window.__dsTest.openCommandWindow(45000));           // e.g. "ready to start the day?" used to wait 45 s
  const open = await state();
  await p.waitForTimeout(7600);
  const after = await state();
  check("a question waits for an answer (listening window opens)", open.mode === "command", JSON.stringify(open));
  check("…but gives up after 7 s and goes back to Ready", after.mode === "idle", JSON.stringify(after));
  await p.evaluate(() => window.__dsTest.openCommandWindow(10000));
  const t0 = Date.now(); let closedAt = 0;
  while (Date.now() - t0 < 30000) { await say("mumble mumble tv noise", false); await p.waitForTimeout(1500); if ((await state()).mode === "idle") { closedAt = Date.now() - t0; break; } }
  check("room noise can't hold the window open (closes within about 12 s)", closedAt > 0 && closedAt <= 13500, `closed after ${closedAt} ms`);
  await tap(p, "#muteBtn"); await p.waitForTimeout(500);
  await p.evaluate(() => window.__dsTest.openCommandWindow(45000));
  const stopped = await state();
  check("with listening stopped, a question doesn't wait at all", stopped.mode === "idle" && /Not listening/.test(stopped.mic), JSON.stringify(stopped));
  await tap(p, "#muteBtn"); await p.waitForTimeout(500);
  check("reply window: no page errors", p.__errors.length === 0, p.__errors.join(" | "));
  await p.context().close();
}

// C3. the hard stop (✋ / 🎤): nothing restarts it — not the watchdog, not the end of speech, not a reconnect
{
  const p = await page("/display", { init: [mockSR] });
  await p.waitForTimeout(1500);
  await tap(p, "#muteBtn"); await p.waitForTimeout(800);
  const a = await p.evaluate(() => ({ starts: window.__srStarts, stops: window.__trackStops, stopped: window.dsIsStopped(), label: document.getElementById("muteBtn").textContent }));
  await p.evaluate(() => window.dayspring.speak("Speech that ends.", null, "general"));
  await p.waitForTimeout(9000);
  await p.evaluate(() => { window.__sr?.onend?.(); });
  await p.waitForTimeout(1500);
  const b = await p.evaluate(() => window.__srStarts);
  check("stop listening: the mic is released and it says so", a.stopped && a.stops >= 1 && /Not listening/.test(a.label), JSON.stringify(a));
  check("stop listening: zero restarts (watchdog, speech ending, recognizer ending)", b === a.starts, `${a.starts} → ${b}`);
  await p.reload(); await p.waitForTimeout(3000);
  const c = await p.evaluate(() => ({ starts: window.__srStarts, stopped: window.dsIsStopped() }));
  check("stop listening: still stopped after a reload", c.stopped && c.starts === 0, JSON.stringify(c));
  await tap(p, "#muteBtn"); await p.waitForTimeout(1200);
  const d = await p.evaluate(() => ({ starts: window.__srStarts, stopped: window.dsIsStopped() }));
  check("tap 🎤: listens again, once", !d.stopped && d.starts === 1, JSON.stringify(d));
  // ✋ while nothing is being said = a hard stop too
  await tap(p, "#stopBtn"); await p.waitForTimeout(600);
  check("✋ with nothing being said: stops listening", await p.evaluate(() => window.dsIsStopped()));
  await tap(p, "#muteBtn"); await p.waitForTimeout(400);
  check("hard stop: no page errors", p.__errors.length === 0, p.__errors.join(" | "));
  await p.context().close();
}

// C4. notification kinds: speak / chime / silent reach the right place
{
  await api("/settings", { mode: "voice", notify: { reminders: "chime", texts: "silent", schedule: "voice" }, notifyAll: null });
  const p = await page("/display", { init: [mockSR] });
  const run = (kind) => p.evaluate(async (k) => { const s0 = window.__spoken.length; await window.dayspring.notify(`Test ${k}`, { kind: k, polite: false }); await new Promise((r) => setTimeout(r, 1200)); return { mode: window.__dsLastNotify?.mode, spoke: window.__spoken.length > s0, toasts: document.querySelectorAll("#toasts .toast, #toasts > *").length }; }, kind);
  const sch = await run("schedule"), rem = await run("reminders"), txt = await run("texts");
  check("schedule → spoken", sch.mode === "voice" && sch.spoke, JSON.stringify(sch));
  check("reminders → chime only (shown, not spoken)", rem.mode === "chime" && !rem.spoke && rem.toasts > 0, JSON.stringify(rem));
  check("texts → silent (shown only)", txt.mode === "silent" && !txt.spoke, JSON.stringify(txt));
  await api("/settings", { notifyAll: "silent" }); await p.waitForTimeout(800);
  const all = await run("schedule");
  check("the quick switch makes everything silent", all.mode === "silent" && !all.spoke, JSON.stringify(all));
  await api("/settings", { notifyAll: null, notify: { reminders: "auto", texts: "auto", schedule: "auto" } });
  check("notification kinds: no page errors", p.__errors.length === 0, p.__errors.join(" | "));
  await p.context().close();
}

// C5. Brave: no browser speech recognition → the private one on this computer (mocked /api/stt), SAPI voices
{
  const stt = [];
  const chats = [];
  const p = await page("/display", {
    init: [mockBrave, () => { window.__micLoud = true; }],
    routes: [[/\/api\/stt\b/, (req) => { stt.push(req.url()); return { text: "Dayspring what time is it" }; }], [/\/api\/chat$/, (req) => { chats.push(req.postDataJSON?.()?.message ?? ""); return { reply: "It's noon.", changes: [] }; }]],
  });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { for (const g of window.__micGains ?? []) g.gain.value = 0.0001; });   // silence after speaking: the phrase is sent
  await p.waitForTimeout(3000);
  const eng = await p.evaluate(() => ({ engine: window.dsSpeechEngine, brave: window.dsIsBrave, voice: window.dsVoicePrefs?.pick("assistant")?.name ?? null }));
  check("Brave: uses the private speech recognition", eng.brave && eng.engine === "local", JSON.stringify(eng));
  check("Brave: speech goes to /api/stt (after a loudness gate)", stt.length >= 1, `${stt.length} request(s)`);
  await p.waitForTimeout(4000);
  check("Brave: the wake word and the request work", chats.some((c) => /what time is it/i.test(c)), JSON.stringify(chats));
  check("Brave: the voice falls back to Windows' own (Zira)", /Zira/.test(eng.voice ?? ""), eng.voice);
  check("Brave: no page errors", p.__errors.length === 0, p.__errors.join(" | "));
  await p.context().close();
}
await browser.close();

// ---------------- E. closed stays closed (a second throwaway server, as the Dayspring screen, with a fast watchdog) ----------------
{
  const P2 = 4793, LOG2 = join(TMP, "launch2.log");
  writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "1", keepScreenOpen: false }));
  try { rmSync(join(APP, "data", "display-window.json"), { force: true }); } catch { /* none */ }
  const s2 = spawn(process.execPath, ["server.mjs"], { cwd: APP, env: { ...env, PORT: String(P2), DAYSPRING_DISPLAY: "1", DS_LAUNCH_LOG: LOG2, DAYSPRING_WATCHDOG_MS: "400", DAYSPRING_NO_KEEPAWAKE: "1" }, stdio: "ignore", windowsHide: true });
  const up2 = async () => { try { return (await fetch(`http://127.0.0.1:${P2}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
  for (let i = 0; i < 60 && !(await up2()); i++) await sleep(500);
  const n = () => (existsSync(LOG2) ? readFileSync(LOG2, "utf8").trim().split(/\r?\n/).filter(Boolean).length : 0);
  const call = (path, body) => fetch(`http://127.0.0.1:${P2}/api${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }).then((r) => r.json()).catch(() => ({}));
  await sleep(5000);
  check("keep-open OFF (the default): nothing opens the screen by itself", n() === 0, `${n()} launch(es)`);
  await call("/setup/display", { keepScreenOpen: true });
  await sleep(3000);
  const opened = n();
  check("keep-open ON: a closed screen opens again (TV / always-on display)", opened >= 1, `${opened} launch(es)`);
  await call("/window/closed", {});          // the page's beacon: closed with the browser's ✕ or Alt+F4
  await sleep(24000);                        // 60 watchdog ticks (the same as 30 minutes at the real pace)
  check("closed by the owner: stays closed, even with keep-open on", n() === opened, `${opened} → ${n()}`);
  s2.kill();
}

// ---------------- D. the desktop-notification helper (real, but only three test cards) ----------------
if (!process.argv.includes("--no-overlay") && process.platform === "win32") {
  const CSC = join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  const exe = join(TMP, "overlay.exe");
  const built = existsSync(CSC) && spawnSync(CSC, ["/nologo", "/target:winexe", "/optimize+", `/out:${exe}`, "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", "/r:System.Web.Extensions.dll", ...(existsSync(join(dirname(CSC), "WPF", "System.Speech.dll")) ? [`/r:${join(dirname(CSC), "WPF", "System.Speech.dll")}`] : ["/define:NOSPEECH"]), join(DESK, "scripts", "overlay.cs")], { windowsHide: true }).status === 0 && existsSync(exe);
  check("overlay helper compiles with Windows' C# compiler", built);
  if (built) {
    const fg = () => { try { return execFileSync("powershell.exe", ["-NoProfile", "-Command", "Add-Type -Name F -Namespace W -MemberDefinition '[DllImport(\"user32.dll\")] public static extern System.IntPtr GetForegroundWindow();'; [W.F]::GetForegroundWindow().ToInt64()"], { windowsHide: true, encoding: "utf8" }).trim(); } catch { return "?"; } };
    const fg0 = fg();
    const child = spawn(exe, [], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    const got = []; let buf = "";
    child.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) try { got.push(JSON.parse(l)); } catch { /* skip */ } } });
    for (let i = 0; i < 20 && !got.some((m) => m.type === "ready"); i++) await sleep(250);
    check("overlay helper starts hidden and says ready", got.some((m) => m.type === "ready"));
    for (const n of [1, 2, 3]) child.stdin.write(JSON.stringify({ type: "show", id: "t" + n, title: `Test ${n}`, text: "A test notification from the Dayspring checks.", kind: n === 1 ? "reminders" : "schedule", snooze: n === 1, seconds: 6 }) + "\n");
    await sleep(1500);
    const shownN = got.filter((m) => m.type === "shown" || m.type === "skipped").length;
    check("overlay: three cards answered (shown, or skipped while Dayspring is in front)", shownN === 3, JSON.stringify(got.slice(1)));
    child.stdin.write(JSON.stringify({ type: "dismiss", id: "t2" }) + "\n");
    await sleep(600);
    check("overlay: ✕ dismisses a card", got.some((m) => m.type === "dismissed" && m.id === "t2") || got.some((m) => m.id === "t2" && m.type === "skipped"));
    check("overlay: never takes the focus", fg() === fg0, `${fg0} → ${fg()}`);
    child.stdin.end();
    const exited = await new Promise((res) => { const t = setTimeout(() => res(false), 5000); child.on("exit", () => { clearTimeout(t); res(true); }); });
    check("overlay: exits when Dayspring does (stdin closes)", exited);
    if (!exited) try { child.kill(); } catch { /* gone */ }
  }
}

server.kill();
await sleep(500);
if (!process.argv.includes("--keep")) { try { spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true }); rmSync(TMP, { recursive: true, force: true }); } catch { /* temp */ } }
else console.log("kept:", TMP);
if (fail) console.log(serverLog.split(/\r?\n/).filter((l) => /error|Error/.test(l)).slice(-10).join("\n"));
console.log(`\n${fail ? "FAILED" : "ALL PASSED"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
