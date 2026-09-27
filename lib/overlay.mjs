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
// With no Dayspring screen open (it was closed, and "Keep the Dayspring screen open" is off), the helper also makes the
// sounds: an alarm shows a larger card that stays until answered and rings on a loop, rising over 30 s to the alarm volume
// (Snooze 9 min, Dismiss, Open Dayspring; it stops when the alarm is answered anywhere, or after 30 minutes); a chime for
// notifications set to Chime (or to Speak: spoken with Windows' voice only if "Speak announcements even when the screen
// is closed" is on, else a chime); nothing for Silent. With a screen open, the screen plays everything and the helper is
// silent, so nothing sounds twice. The main window is never reopened for an alarm.
//
//   start({ onAction }) · stop() · show(card) · status() · ensureBuilt()
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as settings from "./settings.mjs";
import * as quiet from "./quiet.mjs";
import { on as onBus, displayCount } from "./bus.mjs";
import { ensureWavs } from "./wavs.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "scripts", "overlay.cs");
export const EXE = () => process.env.DAYSPRING_OVERLAY_EXE || join(ROOT, "bin", "Dayspring Notifications.exe");
const CSC = [process.env.WINDIR || "C:\\Windows"].flatMap((w) => [join(w, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"), join(w, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe")]);

let child = null, ready = false, lastError = null, offBus = null, onAction = () => {};
const pending = new Map();            // card id → the announcement (for Snooze and Open)
const shown = { count: 0, skipped: 0 };
let ringing = null;                   // { id, item } while the helper's alarm is ringing
const heard = { alarms: 0, played: 0, spoken: 0 };
let statusWait = null;
// tests: sounds are the silent file at volume 0 (the whole path still runs; nothing is heard)
const TEST = () => process.env.DAYSPRING_OVERLAY_TEST === "1";
let wavs = null;
function sound(name) { try { wavs ??= ensureWavs(); } catch { return null; } return TEST() ? wavs.silent : wavs[name] ?? null; }

export function status() { return { running: Boolean(child), ready, error: lastError, shown: shown.count, skipped: shown.skipped, exe: existsSync(EXE()), ringing: ringing?.id ?? null, alarms: heard.alarms, played: heard.played, spoken: heard.spoken }; }
// what the helper itself says it's doing (ringing, volume, sounds played), for Settings and tests
export function helperStatus() {
  if (!child || !ready) return Promise.resolve({ running: false });
  return new Promise((resolve) => {
    const t = setTimeout(() => { statusWait = null; resolve({ running: true, error: "no answer" }); }, 3000);
    statusWait = (m) => { clearTimeout(t); statusWait = null; resolve({ running: true, ...m }); };
    send({ type: "status" });
  });
}

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
    const speech = join(dirname(csc), "WPF", "System.Speech.dll");
    execFile(csc, ["/nologo", "/target:winexe", "/optimize+", `/out:${exe}`, "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", "/r:System.Web.Extensions.dll", ...(existsSync(speech) ? [`/r:${speech}`] : ["/define:NOSPEECH"]), SRC], { windowsHide: true, timeout: 120_000 }, (err, out) => {
      if (err || !existsSync(exe)) return reject(new Error("Couldn't build the desktop notifications: " + String(out || err?.message).split(/\r?\n/).filter((l) => /error/i.test(l)).slice(0, 3).join(" ")));
      resolve(exe);
    });
  });
}

function send(obj) { if (!child?.stdin?.writable) return false; try { child.stdin.write(JSON.stringify(obj) + "\n"); return true; } catch { return false; } }

export async function start(opts = {}) {
  if (opts.onAction) onAction = opts.onAction;
  if (child) return status();
  if (process.env.DAYSPRING_NO_OVERLAY || (process.env.DAYSPRING_NO_BROWSER && !TEST())) return { running: false, skipped: "tests" };
  // it runs even when the cards are off in Settings: with the screen closed, it's what rings the alarm
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
      else if (m.type === "status") statusWait?.(m);
      else if (m.type === "played") heard.played++;
      else if (m.type === "spoken") heard.spoken++;
      else if (m.type === "alarm-started") heard.alarms++;
      else if (m.type === "alarm-stopped") {
        const item = ringing && ringing.id === m.id ? ringing.item : null;
        if (ringing?.id === m.id) ringing = null;
        // answered on the card (or it timed out): the server snoozes or clears it everywhere
        if (["dismissed", "snoozed", "timeout"].includes(m.why)) { try { onAction({ type: "alarm-" + m.why, id: m.id, item }); } catch { /* the action's own problem */ } }
      }
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
    else if (type === "alarm-dismissed" && ringing && data?.from !== "overlay") stopAlarm();
  });
  return status();
}
export function stop() { offBus?.(); offBus = null; try { child?.stdin?.end(); } catch { /* gone */ } try { child?.kill(); } catch { /* gone */ } child = null; ready = false; }
process.on("exit", () => { try { child?.kill(); } catch { /* exiting */ } });

function configure() { const o = settings.get().overlay ?? {}; send({ type: "config", screen: String(o.screen ?? "primary"), seconds: Number(o.seconds) || 8 }); }

const TITLES = { discovery: "✨ Secret character found", reminder: "Reminder", text: "Text message", lantern: "Lantern", discover: "Something new for you", update: "Dayspring update", coder: "Claude Code", checkin: "Time's up", buffer: "A few free minutes", ready: "Ready for the day?", rundown: "Today" };
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
const hm12 = (hm) => { const [h, m] = String(hm ?? "").split(":").map(Number); if (!Number.isFinite(h)) return null; return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, "0")}`; };
export const isAlarm = (item = {}) => Boolean(item.alarm) || item.kind === "morning";
// Is a Dayspring screen open (full, mini or a tab)? Then it makes the sounds, and the helper stays quiet.
export const screenOpen = () => displayCount() > 0;
function notifyAnnouncement(item) {
  const open = screenOpen();
  if (item.kind === "jokeoffer") return;                 // only ever asked out loud on an open screen
  if (item.kind === "timer" && !open) { ringTimer(item); return; }
  if (item.kind === "timer") return;                    // the screen shows its own timer card
  if (isAlarm(item) && !open) { ringAlarm(item); return; }
  const card = cardFor(item);
  if (card) show(card, item);
  if (!open && !isAlarm(item)) soundFor(item);
}
// The alarm with the screen closed: the big card, and the ring (unless Dayspring is Off and "Alarms still ring when Off"
// is off, when it only shows)
export function ringAlarm(item, s = settings.get()) {
  if (!child || !ready) return false;
  if (s.listenState === "off" && s.alarmsWhenOff === false) return show({ title: "⏰ Alarm (Dayspring is off)", text: String(item.text ?? "").slice(0, 280), kind: "reminders", snooze: true }, item);
  const id = Math.random().toString(36).slice(2, 10);
  ringing = { id, item };
  const time = hm12(item.hm ?? item.started?.start) ?? hm12(new Date().toTimeString().slice(0, 5));
  return send({ type: "alarm", id, title: item.kind === "morning" ? "Good morning" : "Alarm", text: String(item.text ?? "").slice(0, 280), time, sound: sound("alarm"), volume: TEST() ? 0 : Math.max(20, Number(s.alarmVolume ?? 100)), rampSeconds: 30, timeoutMinutes: 30 });
}
// A timer finished with the screen closed: it rings like an alarm (Dismiss / +5 min), with its name on the card. When
// Dayspring is Quiet or Off it still rings if "Timers still ring when Dayspring is quiet or off" is on (the default);
// otherwise a silent card. The server repeats the reminder every minute until it's dismissed; one card at a time.
export function ringTimer(item, s = settings.get()) {
  if (!child || !ready) return false;
  const quietNow = s.listenState === "off" || s.listenState === "quiet";
  const text = String(item.text ?? "").slice(0, 280);
  if ((quietNow && s.timersWhenQuiet === false) || item.timer?.once) { const shown = show({ title: item.timer?.once ? "⏲ Timer" : "⏲ Timer done", text, kind: "reminders", snooze: false }, item); if (item.timer?.once && !quietNow) soundFor(item, s); return shown; }
  if (ringing?.item?.kind === "timer") { ringing.item = item; return true; }     // already ringing: the same card keeps going
  const id = Math.random().toString(36).slice(2, 10);
  ringing = { id, item };
  return send({ type: "alarm", id, title: "⏲ Timer", text, time: hm12(new Date().toTimeString().slice(0, 5)), sound: sound("alarm"), volume: TEST() ? 0 : Math.max(20, Number(s.alarmVolume ?? 100)), rampSeconds: 5, timeoutMinutes: 5, snoozeLabel: "+5 min" });
}
// tests: talk to the helper directly (e.g. press the alarm card's Snooze)
export const _send = (obj) => send(obj);
export const _ringing = () => ringing;
export function stopAlarm() { if (!ringing) return false; const id = ringing.id; ringing = null; return send({ type: "alarm-stop", id }); }
// A notification's sound with the screen closed: chime, Windows' voice (if allowed), or nothing
export function soundFor(item, s = settings.get()) {
  if (!child || !ready) return false;
  const mode = quiet.modeFor(quiet.kindOf(item), s);
  if (mode === "silent") return false;
  const text = String(item.text ?? "").slice(0, 400);
  if (mode === "voice" && s.speakWhenClosed === true && text) return send({ type: "speak", text, volume: TEST() ? 0 : Number(s.volume ?? 80) });
  return send({ type: "sound", name: "chime", path: sound("chime"), volume: TEST() ? 0 : Number(s.soundsVolume ?? s.volume ?? 70) });
}
export function show(card, item = null) {
  if (!child || !ready) return false;
  const id = Math.random().toString(36).slice(2, 10);
  if (item) { pending.set(id, item); if (pending.size > 30) pending.delete(pending.keys().next().value); }
  return send({ type: "show", id, ...card });
}
