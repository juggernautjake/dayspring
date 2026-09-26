// The Dayspring screen's own window, and the Sound panel's server side.
//   GET  /api/window                         → { found, windows: [{ visible, minimized, maximized }], closedByOwner }
//   POST /api/window { action }              → minimize | maximize | restore | hide | show | close | open
//   POST /api/sound/outputs { keys: [...] }  → Dayspring's voice and sounds play on these devices (several at once), or ["default"]
//   POST /api/sound/windows                  → opens Windows' Sound settings (the owner changes the default device there;
//                                              Dayspring never changes it)
// Only Dayspring's own display window is ever touched (scripts/window.ps1 matches its exact title AND its browser profile).
// "close" is remembered (data/display-window.json) so the server's screen watchdog doesn't reopen it; "show"/"open" (or
// Start Dayspring) clears that.
import { spawn } from "node:child_process";
import * as display from "./display.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as devices from "./devices.mjs";
import * as settings from "./settings.mjs";
import { broadcast } from "./bus.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "data", "display-window.json");
const ACTIONS = new Set(["state", "minimize", "maximize", "restore", "hide", "show", "close", "open"]);
const readState = () => { try { return existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {}; } catch { return {}; } };
const writeState = (s) => { try { writeFileSync(FILE, JSON.stringify(s)); } catch { /* not critical */ } };

// The watchdog asks this before reopening the screen.
export const closedByOwner = () => Boolean(readState().closedByOwner);
export function clearClosed() { const s = readState(); if (s.closedByOwner) { s.closedByOwner = false; writeState(s); } }

// window.ps1, hidden (display.mjs runs it)
const runPs = (action) => display.windowCmd(action);

export async function windowAction(action) {
  if (!ACTIONS.has(action)) return { ok: false, error: "unknown window action" };
  if (action === "open") {
    clearClosed();
    // the open one comes back; otherwise it opens on the chosen screen in the chosen browser (never a second one)
    const r = await display.open().catch((e) => ({ ok: false, error: e.message }));
    return { ok: r.ok !== false, action, found: r.already ? 1 : 0, opened: Boolean(r.opened), ...(r.noScreen ? { noScreen: true, message: r.message } : {}) };
  }
  const r = await runPs(action);
  if (action === "close" && r.found) writeState({ ...readState(), closedByOwner: true, closedAt: new Date().toISOString() });
  if (action === "show") clearClosed();
  broadcast("window", { action, found: r.found });
  return { ok: Boolean(r.found), ...r, closedByOwner: closedByOwner() };
}

export async function handle(req, res, { m, p, send, readJSON }) {
  if (p === "/window" && m === "GET") return send(res, 200, { ...(await runPs("state")), closedByOwner: closedByOwner() }), true;
  if (p === "/window" && m === "POST") {
    const b = await readJSON(req).catch(() => ({}));
    const r = await windowAction(String(b.action ?? ""));
    return send(res, r.error && !r.found ? 400 : 200, r), true;
  }
  if (p === "/sound/outputs" && m === "POST") {
    const b = await readJSON(req).catch(() => ({}));
    const keys = Array.isArray(b.keys) ? b.keys.map(String) : [];
    if (!keys.length || keys.includes("default")) { settings.set({ audioOutputs: ["default"] }); broadcast("settings", settings.get()); return send(res, 200, { ok: true, said: ["sound on the Windows default"] }), true; }
    const all = await devices.list();
    const groups = all.filter((g) => keys.includes(g.key) && g.outputs.length);
    if (!groups.length) return send(res, 404, { error: "none of those devices can play sound" }), true;
    const said = await devices.apply({ outputs: groups });
    broadcast("settings", settings.get());
    return send(res, 200, { ok: true, said, devices: await devices.list({ fresh: true }) }), true;
  }
  if (p === "/sound/windows" && m === "POST") {
    if (process.platform === "win32") spawn("explorer.exe", ["ms-settings:sound"], { detached: true, stdio: "ignore" }).unref();
    return send(res, 200, { ok: true }), true;
  }
  return false;
}

// Typed or said to Dayspring anywhere (the desk page too): "show the screen", "hide the screen", "minimize Dayspring"…
export async function command(text) {
  const t = String(text ?? "").toLowerCase().replace(/[.!?,]/g, "").replace(/^(hey )?dayspring /, "").trim();
  const W = "(?: (?:dayspring|yourself|the (?:screen|window|display|app)|your (?:screen|window)))?";
  if (new RegExp(`^(show|bring back|unhide|open)${W}$`).test(t) || /^(show|open) the (screen|display|window)$/.test(t) || /^(come back|show yourself)$/.test(t)) {
    const r = await windowAction("open"); return r.noScreen ? r.message : r.opened ? "Opening the Dayspring screen." : "Here I am.";
  }
  if (new RegExp(`^hide${W}$`).test(t)) { await windowAction("hide"); return "Okay, I'm hidden but still listening. Say “Dayspring, show yourself” to bring me back."; }
  if (new RegExp(`^minimi[sz]e${W}$`).test(t)) { await windowAction("minimize"); return "Minimized."; }
  if (new RegExp(`^maximi[sz]e${W}$`).test(t)) { await windowAction("maximize"); return "Maximized."; }
  if (/^restore( the)? (window|screen|size)$/.test(t)) { await windowAction("restore"); return "Done."; }
  if (/^(close|exit|quit)( the)? (screen|display|window)$|^close dayspring$/.test(t)) { await windowAction("close"); return "Closed the Dayspring screen. Alarms and reminders won't sound until you open it again: say “open the screen” or use Start Dayspring."; }
  return null;
}
