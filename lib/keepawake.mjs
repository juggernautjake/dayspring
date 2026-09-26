// Keep the computer awake while Dayspring runs on it and it's plugged in (so it can wake you, remind you and hear you).
// scripts/keep-awake.ps1 holds Windows' "stay awake" request (no sleep, screen on, so no idle lock screen); nothing in
// the power settings changes, and it ends by itself when Dayspring stops. On battery it lets the PC sleep as usual.
// data/keepawake.json: { on: true|false } (default on for the Dayspring screen).
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "data", "keepawake.json");
let proc = null, awake = false;

export function wanted() { try { return existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")).on !== false : true; } catch { return true; } }
export function status() { return { on: wanted(), running: Boolean(proc), awakeNow: awake }; }

export function start() {
  if (proc || !wanted() || process.platform !== "win32") return status();
  proc = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "scripts", "keep-awake.ps1"), "-ParentPid", String(process.pid)], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  proc.stdout.on("data", (d) => { const m = /awake=(True|False)/i.exec(String(d)); if (m) awake = /true/i.test(m[1]); });
  proc.on("exit", () => { proc = null; awake = false; });
  return status();
}
export function stop() { try { proc?.kill(); } catch { /* gone */ } proc = null; awake = false; return status(); }
export function set(on) {
  writeFileSync(FILE, JSON.stringify({ on: Boolean(on) }));
  return on ? start() : stop();
}

// "keep the laptop awake" / "let the computer sleep" (answered right away, no AI needed)
export function handle(text) {
  const q = String(text).toLowerCase();
  if (!/\b(laptop|computer|pc|screen|display)\b/.test(q) || !/\b(awake|sleep|stay on|lock|turn off|go to sleep)\b/.test(q)) return null;
  if (/\b(let|allow)\b.*\b(sleep|lock|turn off)\b|\bstop keeping\b|\b(can|may) (sleep|lock)\b/.test(q)) { set(false); return "Okay. The computer can sleep and lock like normal again."; }
  if (/\b(keep|stay|don'?t let|do not let|never)\b/.test(q)) { set(true); return "Done. While it's plugged in and I'm running, the computer stays awake and the screen stays on."; }
  if (/\b(is|are)\b.*\bawake|\bwill\b.*\bsleep\b/.test(q)) return wanted() ? `Yes. I keep it awake while it's plugged in${awake ? ", and it's plugged in now" : ", but it's on battery right now, so it may sleep"}.` : "No, it sleeps and locks like normal. Say \"keep the laptop awake\" to change that.";
  return null;
}
