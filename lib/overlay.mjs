// Desktop notifications: small cards at the top-right of the screen, in front of every window (full-screen apps too),
// that never take the focus and have no taskbar button. bin/overlay.exe is built from scripts/overlay.cs the first time
// it's needed with the C# compiler that ships with Windows (.NET Framework 4), started hidden, and fed over its stdin; it
// exits when Dayspring does (its stdin closes). When the Dayspring window itself is in front, the card is skipped (the
// screen shows its own toast instead), so nothing appears twice.
//
// Which notifications: everything Dayspring announces, the way Settings → Notifications says (silent ones still show a
// card; Off shows cards only if "Show notifications when Off" is on). Its buttons: ✕ dismiss, 💤 Snooze (reminders and
// schedule items), and a click opens the Dayspring screen. Ctrl+Alt+Shift+D anywhere: Dayspring off / back on.
//
//   start({ onAction }) · stop() · show(card) · status() · ensureBuilt()
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as settings from "./settings.mjs";
import * as quiet from "./quiet.mjs";
import { on as onBus } from "./bus.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "scripts", "overlay.cs");
export const EXE = () => process.env.DAYSPRING_OVERLAY_EXE || join(ROOT, "bin", "Dayspring Notifications.exe");
const CSC = [process.env.WINDIR || "C:\\Windows"].flatMap((w) => [join(w, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"), join(w, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe")]);

let child = null, ready = false, lastError = null, offBus = null, onAction = () => {};
const pending = new Map();            // card id → the announcement (for Snooze and Open)
const shown = { count: 0, skipped: 0 };

export function status() { return { running: Boolean(child), ready, error: lastError, shown: shown.count, skipped: shown.skipped, exe: existsSync(EXE()) }; }

// Build bin/overlay.exe when it's missing or older than its source
export function ensureBuilt() {
  if (!process.env.DAYSPRING_OVERLAY_EXE) return import("./native.mjs").then((n) => n.build("overlay"));
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") return reject(new Error("Desktop notifications need Windows."));
    const exe = EXE();
    try { if (existsSync(exe) && (!existsSync(SRC) || statSync(exe).mtimeMs >= statSync(SRC).mtimeMs)) return resolve(exe); } catch { /* rebuild */ }
    const csc = CSC.find((p) => existsSync(p));
    if (!csc) return reject(new Error("Windows' C# compiler (.NET Framework 4) wasn't found, so desktop notifications fall back to the Dayspring screen's own."));
    mkdirSync(dirname(exe), { recursive: true });
    execFile(csc, ["/nologo", "/target:winexe", "/optimize+", `/out:${exe}`, "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", "/r:System.Web.Extensions.dll", SRC], { windowsHide: true, timeout: 120_000 }, (err, out) => {
      if (err || !existsSync(exe)) return reject(new Error("Couldn't build the desktop notifications: " + String(out || err?.message).split(/\r?\n/).filter((l) => /error/i.test(l)).slice(0, 3).join(" ")));
      resolve(exe);
    });
  });
}

function send(obj) { if (!child?.stdin?.writable) return false; try { child.stdin.write(JSON.stringify(obj) + "\n"); return true; } catch { return false; } }

export async function start(opts = {}) {
  if (opts.onAction) onAction = opts.onAction;
  if (child) return status();
  if (process.env.DAYSPRING_NO_OVERLAY || process.env.DAYSPRING_NO_BROWSER) return { running: false, skipped: "tests" };
  if (!settings.get().overlay?.on) return { running: false, skipped: "off in Settings" };
  let exe;
  try { exe = await ensureBuilt(); } catch (e) { lastError = e.message; return status(); }
  child = spawn(exe, [], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
  child.on("error", (e) => { lastError = e.message; child = null; ready = false; });
  child.on("exit", () => { child = null; ready = false; });
  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.type === "ready") { ready = true; configure(); }
      else if (m.type === "shown") shown.count++;
      else if (m.type === "skipped") shown.skipped++;
      else if (["click", "dismissed", "snooze", "hotkey"].includes(m.type)) {
        const item = m.id ? pending.get(m.id) : null;
        if (m.type !== "hotkey" && m.id) pending.delete(m.id);
        try { onAction({ ...m, item }); } catch { /* the action's own problem */ }
      }
    }
  });
  // everything Dayspring announces, and changes of state
  offBus?.(); offBus = onBus((type, data) => {
    if (type === "announce") notifyAnnouncement(data);
    else if (type === "listenstate" && data?.before !== data?.state) show({ title: `Dayspring is ${quiet.label(data.state).toLowerCase()}`, text: data.text ?? "", kind: "system" });
    else if (type === "settings") configure();
  });
  return status();
}
export function stop() { offBus?.(); offBus = null; try { child?.stdin?.end(); } catch { /* gone */ } try { child?.kill(); } catch { /* gone */ } child = null; ready = false; }
process.on("exit", () => { try { child?.kill(); } catch { /* exiting */ } });

function configure() { const o = settings.get().overlay ?? {}; send({ type: "config", screen: String(o.screen ?? "primary"), seconds: Number(o.seconds) || 8 }); }

const TITLES = { reminder: "Reminder", text: "Text message", lantern: "Lantern", discover: "Something new for you", update: "Dayspring update", coder: "Claude Code", checkin: "Time's up", buffer: "A few free minutes", ready: "Ready for the day?", rundown: "Today" };
// Should this announcement show a desktop card, and how?
export function cardFor(item = {}, s = settings.get()) {
  if (!s.overlay?.on) return null;
  if (s.listenState === "off" && s.overlayWhenOff === false) return null;
  const alarm = Boolean(item.alarm) || item.kind === "morning";
  if (alarm && s.listenState === "off" && s.alarmsWhenOff === false) return null;
  const kind = quiet.kindOf(item);
  const title = alarm ? "⏰ Alarm" : item.kind === "text" ? `Text from ${item.from ?? "someone"}` : item.kind === "reminder" ? (item.snoozed ? "Reminder (snoozed)" : "Reminder") : item.started?.title ?? item.title ?? TITLES[item.kind] ?? "Dayspring";
  const text = item.kind === "reminder" ? (item.reminder?.text ?? item.text) : item.kind === "text" ? "Say “Dayspring, read it” to hear it." : item.text;
  const snooze = ["reminder", "start", "checkin"].includes(item.kind) || alarm;
  return { title, text: String(text ?? "").slice(0, 280), kind, snooze };
}
function notifyAnnouncement(item) {
  const card = cardFor(item);
  if (card) show(card, item);
}
export function show(card, item = null) {
  if (!child || !ready) return false;
  const id = Math.random().toString(36).slice(2, 10);
  if (item) { pending.set(id, item); if (pending.size > 30) pending.delete(pending.keys().next().value); }
  return send({ type: "show", id, ...card });
}
