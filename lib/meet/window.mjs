// Where the meeting window goes: a small tile in the bottom-right corner (in front of other windows, clear of the
// taskbar, Dayspring's controls at the bottom of its screen and the notification cards at the top-right), or large.
import { execFile } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TILE = { width: 360, height: 220, margin: 24, bottom: 96 };   // bottom: above the Dayspring screen's talk bar
export const PAGE = { width: 1280, height: 800 };    // the page keeps this layout in the tile, just smaller
export const PROFILE_NAME = "DayspringMeet";
const quiet = () => process.platform !== "win32" || process.env.DS_LAUNCH_LOG || process.env.DAYSPRING_MEET_NO_WINDOW === "1";

function ps(args, env = {}) {
  return new Promise((resolve) => {
    if (quiet()) return resolve("");
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", ...args], { windowsHide: true, timeout: 15000, encoding: "utf8", env: { ...process.env, ...env } }, (err, out) => resolve(String(out ?? "")));
  });
}
// The main screen's work area (without the taskbar)
let waCache = null;
export async function workArea() {
  if (waCache && Date.now() - waCache.at < 60_000) return waCache.wa;
  let wa = { x: 0, y: 0, width: 1920, height: 1040 };
  const out = await ps(["-Command", "Add-Type -AssemblyName System.Windows.Forms; $w=[System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea; \"$($w.X),$($w.Y),$($w.Width),$($w.Height)\""]);
  const m = /(-?\d+),(-?\d+),(\d+),(\d+)/.exec(out);
  if (m) wa = { x: +m[1], y: +m[2], width: +m[3], height: +m[4] };
  waCache = { at: Date.now(), wa };
  return wa;
}
export function tileBounds(wa) {
  return { left: wa.x + wa.width - TILE.width - TILE.margin, top: wa.y + wa.height - TILE.height - TILE.bottom, width: TILE.width, height: TILE.height };
}
export function largeBounds(wa) {
  const width = Math.min(1280, wa.width - 80), height = Math.min(820, wa.height - 60);
  return { left: wa.x + Math.round((wa.width - width) / 2), top: wa.y + Math.round((wa.height - height) / 2), width, height };
}
// Keep the meeting window in front (only windows of the meeting's own browser profile are ever touched)
export async function topmost(on) {
  const out = await ps(["-File", join(ROOT, "scripts", "window.ps1"), "-Action", on ? "topmost" : "notopmost", "-Title", ".+"], { DS_PROFILE: PROFILE_NAME });
  try { return JSON.parse(out.trim().split(/\r?\n/).pop()); } catch { return { found: 0 }; }
}
