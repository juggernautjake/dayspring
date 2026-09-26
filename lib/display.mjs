// Opening the Dayspring screen: which screen, which browser, and never a second copy.
//   open()        the Dayspring screen (/display), opened the way the owner chose (Settings → Screen, "How Dayspring opens"):
//                   window      its own clean app window (no browser bars; its own profile remembers the mic and sign-ins)
//                   compact     "Dayspring mini": a small window (380×560) you can put anywhere; remembers where
//                   fullscreen  full screen on the chosen screen (the TV view)
//                   tab         a normal tab in the owner's usual browser
//                   auto        a window on the main screen, full screen on a second one (the default)
//                 If it's already open (even hidden or minimized) that window comes back instead. { switchTo: true } (a
//                 shortcut, or "open Dayspring in my browser") moves it: the app window closes and it opens the new way.
//   openSetup()   the first-run guided setup (/welcome) in the owner's own browser, once.
//   screens()     the connected screens, numbered left to right (the same numbers Settings → Screen shows).
// Everything here starts programs directly, hidden where they're console programs, so no black windows flash up.
// Overrides (tests and the TV launcher): DS_SCREEN, DS_PROFILE, DS_BROWSER, PORT.
import { execFile, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as browsers from "./browsers.mjs";
import * as owner from "./owner.mjs";
import { displayCount } from "./bus.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = () => Number(process.env.PORT) || 4747;
const LAD = () => process.env.LOCALAPPDATA ?? "";

function ps(args, timeout = 15000) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve("");
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", ...args], { windowsHide: true, timeout, encoding: "utf8" }, (err, out) => resolve(err && !out ? "" : String(out ?? "")));
  });
}

// ---- screens ------------------------------------------------------------------------------------------------------------
export async function screens() {
  const cmd = "Add-Type -AssemblyName System.Windows.Forms; @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object { [pscustomobject]@{ name = $_.DeviceName; primary = $_.Primary; x = $_.Bounds.X; y = $_.Bounds.Y; width = $_.Bounds.Width; height = $_.Bounds.Height } }) | ConvertTo-Json -Compress";
  try {
    const j = JSON.parse((await ps(["-Command", cmd])).trim() || "[]");
    return (Array.isArray(j) ? j : [j]).sort((a, b) => a.x - b.x || a.y - b.y).map((s, i) => ({ number: i + 1, ...s, name: String(s.name).replace(/^\\\\\.\\/, "") }));
  } catch { return []; }
}
// auto = the biggest second screen if there is one, else the main screen · secondary = only a second screen · a number
export function pick(all, want = "auto") {
  const w = String(want ?? "auto").trim().toLowerCase();
  const main = all.find((s) => s.primary) ?? all[0] ?? null;
  const others = all.filter((s) => !s.primary).sort((a, b) => b.width * b.height - a.width * a.height);
  if (/^\d+$/.test(w)) return all[Number(w) - 1] ?? null;
  if (w === "primary") return main;
  if (w === "secondary") return others[0] ?? null;
  return others[0] ?? main;
}
export const wantScreen = () => process.env.DS_SCREEN || owner.display();
export const wantOpenAs = () => { const v = String(process.env.DS_OPEN_AS || owner.openAs()).toLowerCase(); return owner.OPEN_AS.includes(v) ? v : "auto"; };
// auto → a window on the main screen, full screen on a second one
export function modeFor(openAs, s) { const m = String(openAs ?? "auto").toLowerCase(); return ["window", "compact", "fullscreen", "tab"].includes(m) ? m : s && !s.primary ? "fullscreen" : "window"; }
// "Expand" from the mini: the owner's full way of opening (their choice, unless that's compact → auto)
export function fullMode(s) { const w = wantOpenAs(); return modeFor(w === "compact" ? "auto" : w, s); }
// Where the mini opens: where it was last left (if that's still on a screen), else the top-right of screen s
export const MINI_SIZE = { width: 380, height: 560 };
export function miniBounds(s, saved = owner.get().miniBounds) {
  const w = Math.max(300, Math.min(900, Number(saved?.width) || MINI_SIZE.width)), h = Math.max(360, Math.min(1400, Number(saved?.height) || MINI_SIZE.height));
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return { x: Math.round(saved.x), y: Math.round(saved.y), width: w, height: h };
  return { x: s.x + s.width - w - 24, y: s.y + 48, width: w, height: h };
}

// ---- the display window (window.ps1 finds only Dayspring's own window, by its title and its browser profile) ----------
export function windowCmd(action, extra = []) {
  if (process.env.DS_WINDOW_LOG) { try { appendFileSync(process.env.DS_WINDOW_LOG, JSON.stringify({ action, extra }) + "\n"); } catch { /* test only */ } }
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve({ found: 0, error: "only on Windows" });
    if (process.env.DS_LAUNCH_LOG) return resolve({ found: 0, test: true });   // tests never touch a real Dayspring window
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "scripts", "window.ps1"), "-Action", action, ...extra], { windowsHide: true, timeout: 15000 }, (err, out) => {
      try { resolve(JSON.parse(String(out).trim().split(/\r?\n/).pop())); } catch { resolve({ found: 0, error: err?.message ?? "no answer" }); }
    });
  });
}

// The browser profile folder: installs from before the rename keep theirs (their sign-ins live there).
export function profileBase() {
  if (process.env.DS_PROFILE) return process.env.DS_PROFILE;
  return existsSync(join(LAD(), "DayspringTV")) ? "DayspringTV" : "DayspringDisplay";
}
// Every browser keeps its own Dayspring profile folder (sign-ins, the microphone permission), so switching browsers never
// mixes them. The original folder (DayspringDisplay / DayspringTV) stays with the browser that used it first (Chrome or
// Edge, as before; remembered in data/display-profile.json), so nobody loses their sign-ins; every other browser gets
// "<folder>-<browser>" next to it.
const PROFILE_FILE = join(ROOT, "data", "display-profile.json");
export function profileFor(b) {
  if (process.env.DS_PROFILE) return b.id === "chrome" || b.id === "edge" ? process.env.DS_PROFILE : `${process.env.DS_PROFILE}-${b.id}`;
  let owner0 = null;
  try { owner0 = JSON.parse(readFileSync(PROFILE_FILE, "utf8")).base ?? null; } catch { /* first time */ }
  if (!owner0 && ["chrome", "edge"].includes(b.id)) {
    owner0 = b.id;
    if (!process.env.DS_LAUNCH_LOG) { try { writeFileSync(PROFILE_FILE, JSON.stringify({ base: owner0, at: new Date().toISOString() })); } catch { /* not critical */ } }
  }
  return b.id === owner0 ? profileBase() : `${profileBase()}-${b.id}`;
}

function firefoxProfile(dir) {
  mkdirSync(dir, { recursive: true });
  // no microphone prompt, sound without a click, no first-run pages or "restore session" bar
  const prefs = {
    "media.navigator.permission.disabled": true, "media.autoplay.default": 0, "media.autoplay.blocking_policy": 0,
    "browser.shell.checkDefaultBrowser": false, "browser.aboutwelcome.enabled": false, "startup.homepage_welcome_url": "",
    "datareporting.policy.dataSubmissionPolicyBypassNotification": true, "toolkit.telemetry.reportingpolicy.firstRun": false,
    "browser.sessionstore.resume_from_crash": false, "browser.startup.homepage_override.mstone": "ignore",
  };
  writeFileSync(join(dir, "user.js"), Object.entries(prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join("\n") + "\n");
}

// The command line that shows Dayspring on screen s with browser b, as mode (window | fullscreen | tab)
export function launchArgs(b, url, s, mode = modeFor("auto", s)) {
  // a normal tab in the owner's everyday browser and profile (their sign-ins; the browser may ask about the microphone)
  if (mode === "tab") return b.family === "firefox" ? ["-new-tab", url] : [url];
  const dir = join(LAD(), profileFor(b));
  const full = mode === "fullscreen";
  if (mode === "compact") {
    const m = miniBounds(s);
    if (b.family === "chromium") return [`--app=${url}`, `--user-data-dir=${dir}`, "--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--no-first-run", "--no-default-browser-check", "--disable-session-crashed-bubble", "--disable-features=Translate", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", `--window-position=${m.x},${m.y}`, `--window-size=${m.width},${m.height}`];
    if (b.family === "firefox") { firefoxProfile(dir); return ["-no-remote", "-profile", dir, "-new-window", url]; }
    return ["--new-window", url];
  }
  if (b.family === "chromium") {
    const flags = [`--app=${url}`, `--user-data-dir=${dir}`, "--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--no-first-run", "--no-default-browser-check", "--disable-session-crashed-bubble", "--disable-features=Translate", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"];
    return full ? [...flags, "--kiosk", `--window-position=${s.x},${s.y}`] : [...flags, `--window-position=${s.x},${s.y}`, `--window-size=${s.width},${s.height}`, "--start-maximized"];
  }
  if (b.family === "firefox") { firefoxProfile(dir); return ["-no-remote", "-profile", dir, ...(full ? ["--kiosk"] : ["-new-window"]), url]; }
  return ["--new-window", url];
}

let opening = null, lastOpen = 0, lastSetup = 0, lastMode = null, switchingUntil = 0;
// a window Dayspring itself closes while switching (mini ⇄ full, another browser) isn't "closed by the owner"
export const switching = () => Date.now() < switchingUntil;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const openedAs = () => lastMode;
function start(exe, args) {
  // tests: write down what would have opened instead of opening it
  if (process.env.DS_LAUNCH_LOG) { try { appendFileSync(process.env.DS_LAUNCH_LOG, JSON.stringify({ at: new Date().toISOString(), exe, args }) + "\n"); } catch { /* test only */ } return; }
  const c = spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: false });   // a windowed program: no console to hide
  c.on("error", () => {});
  c.unref();
}
export const openUrl = (url) => { if (process.platform === "win32") start("explorer.exe", [url]); };

// Opens (or brings back) the Dayspring screen. { already } when it was open, { opened, screen, browser } when it opened,
// { noScreen } when the chosen screen isn't connected. Two calls at once, or a second call while the first window is still
// loading, never open two windows.
// openAs overrides the saved choice for this once; switchTo moves an open screen to that way of opening (closing
// Dayspring's own app window first) instead of just bringing the open one back.
export function open({ screen, force = false, openAs, switchTo = false, reopen = false } = {}) {
  if (process.env.DAYSPRING_NO_BROWSER && !process.env.DS_LAUNCH_LOG) return Promise.resolve({ ok: false, noBrowser: true });   // tests and headless runs
  if (opening) return opening;
  opening = (async () => {
    const asked = openAs ? String(openAs).toLowerCase() : "";
    const want = owner.OPEN_AS.includes(asked) || asked === "full" ? asked : wantOpenAs();
    // "auto" opens the way it was last left (compact or full), like any app window
    const wantNow = want === "auto" && owner.get().lastWindow === "compact" && !openAs ? "compact" : want;
    const s = wantNow === "tab" ? null : pick(await screens(), screen ?? (wantNow === "compact" ? "primary" : wantScreen()));
    const mode = wantNow === "full" ? fullMode(s) : modeFor(wantNow, s);
    if (switchTo) {
      // already open this way: just bring it forward
      if (!reopen && mode !== "tab" && mode === lastMode && (await windowCmd("show")).found) return { ok: true, already: true, mode };
      switchingUntil = Date.now() + 8000;
      const closed = await windowCmd("close");                         // Dayspring's own app window, if one is open
      if (closed.found) await sleep(1500);
      else if (mode === "tab" && displayCount() > 0) return { ok: true, already: true, connected: true, mode };   // a tab is already open
    } else {
      const shown = await windowCmd("show");
      if (shown.found) return { ok: true, already: true, mode: lastMode ?? mode };
      if (!force && displayCount() > 0) return { ok: true, already: true, connected: true, mode: lastMode ?? mode };   // a Dayspring screen is open (maybe in a tab)
      if (!force && Date.now() - lastOpen < 20_000) return { ok: true, pending: true };
    }
    if (mode !== "tab" && !s) return { ok: false, noScreen: true, message: "The screen chosen for Dayspring isn't connected. Plug it in and set Windows to Extend (Windows key + P), or pick another screen in Settings → Screen." };
    // the mini lives at /mini; a window opened on purpose (switchTo) claims the voice so the one you're looking at speaks
    const url = `http://localhost:${PORT()}/${mode === "compact" ? "mini" : "display"}${switchTo ? "?claim=1" : ""}`;
    const b = await browsers.resolve(process.env.DS_BROWSER || owner.displayBrowser());
    lastOpen = Date.now(); lastMode = mode;
    if (!b) { if (process.env.DS_LAUNCH_LOG) start("explorer.exe", [url]); else openUrl(url); return { ok: true, opened: true, browser: null, mode, note: "No browser Dayspring can drive was found, so the screen opened in your usual browser." }; }
    start(b.exe, launchArgs(b, url, s, mode));
    return { ok: true, opened: true, screen: s?.number ?? null, primary: s?.primary ?? null, browser: b.id, mode };
  })().finally(() => { opening = null; });
  return opening;
}

// First run: the guided setup in the owner's own browser (their sign-ins are there, which the setup's links need).
// Only once: not again while a setup page is connected, or within a minute of the last time.
export async function openSetup({ connected = 0 } = {}) {
  if (process.env.DAYSPRING_NO_BROWSER) return { ok: false, noBrowser: true };
  if (connected > 0 || Date.now() - lastSetup < 60_000) return { ok: true, already: true };
  lastSetup = Date.now();
  const url = `http://localhost:${PORT()}/welcome`;
  const b = await browsers.resolve(process.env.DS_BROWSER || owner.get().displayBrowser || "default");
  if (!b) { openUrl(url); return { ok: true, opened: true }; }
  start(b.exe, b.family === "firefox" ? ["-new-window", url] : b.family === "chromium" ? ["--new-window", url] : [url]);
  return { ok: true, opened: true, browser: b.id };
}
