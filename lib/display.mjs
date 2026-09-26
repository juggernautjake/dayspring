// Opening the Dayspring screen: which screen, which browser, and never a second copy.
//   open()        the Dayspring screen (/display) in its own window: full screen on a second screen, a normal app window
//                 on the main one. If it's already open (even hidden or minimized) that window comes back instead.
//   openSetup()   the first-run guided setup (/welcome) in the owner's own browser, once.
//   screens()     the connected screens, numbered left to right (the same numbers Settings → Screen shows).
// Everything here starts programs directly, hidden where they're console programs, so no black windows flash up.
// Overrides (tests and the TV launcher): DS_SCREEN, DS_PROFILE, DS_BROWSER, PORT.
import { execFile, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
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

// ---- the display window (window.ps1 finds only Dayspring's own window, by its title and its browser profile) ----------
export function windowCmd(action, extra = []) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve({ found: 0, error: "only on Windows" });
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
// Chrome and Edge share the original folder (as they always have); other browsers get their own next to it.
const profileFor = (b) => (["chrome", "edge"].includes(b.id) ? profileBase() : `${profileBase()}-${b.id}`);

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

// The command line that shows Dayspring on screen s with browser b
export function launchArgs(b, url, s) {
  const dir = join(LAD(), profileFor(b));
  if (b.family === "chromium") {
    const flags = [`--app=${url}`, `--user-data-dir=${dir}`, "--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--no-first-run", "--no-default-browser-check", "--disable-session-crashed-bubble", "--disable-features=Translate", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"];
    return s.primary ? [...flags, `--window-position=${s.x},${s.y}`, `--window-size=${s.width},${s.height}`, "--start-maximized"] : [...flags, "--kiosk", `--window-position=${s.x},${s.y}`];
  }
  if (b.family === "firefox") { firefoxProfile(dir); return ["-no-remote", "-profile", dir, ...(s.primary ? ["-new-window"] : ["--kiosk"]), url]; }
  return ["--new-window", url];
}

let opening = null, lastOpen = 0, lastSetup = 0;
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
export function open({ screen, force = false } = {}) {
  if (process.env.DAYSPRING_NO_BROWSER) return Promise.resolve({ ok: false, noBrowser: true });   // tests and headless runs
  if (opening) return opening;
  opening = (async () => {
    const shown = await windowCmd("show");
    if (shown.found) return { ok: true, already: true };
    if (!force && displayCount() > 0) return { ok: true, already: true, connected: true };   // a Dayspring screen is open (maybe in a tab)
    if (!force && Date.now() - lastOpen < 20_000) return { ok: true, pending: true };
    const s = pick(await screens(), screen ?? wantScreen());
    if (!s) return { ok: false, noScreen: true, message: "The screen chosen for Dayspring isn't connected. Plug it in and set Windows to Extend (Windows key + P), or pick another screen in Settings → Screen." };
    const url = `http://localhost:${PORT()}/display`;
    const b = await browsers.resolve(process.env.DS_BROWSER || owner.displayBrowser());
    lastOpen = Date.now();
    if (!b) { openUrl(url); return { ok: true, opened: true, browser: null, note: "No browser Dayspring can drive was found, so the screen opened in your usual browser." }; }
    start(b.exe, launchArgs(b, url, s));
    return { ok: true, opened: true, screen: s.number, primary: s.primary, browser: b.id };
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
