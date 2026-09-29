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
import * as owner from "./owner.mjs";
import { broadcast, release as releaseSpeaker } from "./bus.mjs";
import { writeJSONAtomic } from "./atomic.mjs";
import { on as featureOn } from "./features.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "data", "display-window.json");
const ACTIONS = new Set(["state", "minimize", "maximize", "restore", "hide", "show", "close", "open", "topmost", "notopmost"]);
const readState = () => { try { return existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {}; } catch { return {}; } };
const writeState = (s) => { try { writeJSONAtomic(FILE, s, 0); } catch { /* not critical */ } };

// The watchdog asks this before reopening the screen. Closing the screen by ANY means (its ✕ or Exit, the browser's own
// ✕, Alt+F4) counts: the page sends /api/window/closed as it goes away. It stays closed (across restarts) until the owner
// opens Dayspring again (the shortcut, a notification's Open, or asking for it from another screen).
export const closedByOwner = () => Boolean(readState().closedByOwner);
export function markClosed(how = "window") { writeState({ ...readState(), closedByOwner: true, closedAt: new Date().toISOString(), how }); }
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
  // the Dayspring screen is going away (sendBeacon on pagehide): closed by the owner, unless Dayspring is switching it
  if (p === "/window/closed" && m === "POST") {
    const b = await readJSON(req).catch(() => ({}));
    if (b?.id) releaseSpeaker(String(b.id));          // another open screen takes over the voice right away
    if (!display.switching()) markClosed("page");
    return send(res, 200, { ok: true, closedByOwner: closedByOwner() }), true;
  }
  if (p === "/window" && m === "POST") {
    const b = await readJSON(req).catch(() => ({}));
    const r = await windowAction(String(b.action ?? ""));
    return send(res, r.error && !r.found ? 400 : 200, r), true;
  }
  // the page reports its layout and, in compact, where the window is (remembered for the next time)
  if (p === "/window/bounds" && m === "POST") {
    const b = await readJSON(req).catch(() => ({}));
    const n = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
    const box = { x: n(b.x), y: n(b.y), width: n(b.width), height: n(b.height) };
    if (Object.values(box).some((v) => v === null) || box.width < 200 || box.height < 250) return send(res, 400, { error: "x, y, width and height, please" }), true;
    const mode = b.mode === "full" ? "full" : "compact";
    // a big window is the full layout, whatever the page thinks: never keep it as the compact size
    if (mode === "compact" && (box.width > 900 || box.height > 1000)) return send(res, 200, { ok: true, mode: "full", ignored: true }), true;
    owner.set(mode === "compact" ? { miniBounds: box, lastWindow: "compact" } : { lastWindow: "full" });
    return send(res, 200, { ok: true, mode, miniBounds: owner.get().miniBounds }), true;
  }
  // ⤡ Compact: the same window, smaller (where it was last left, or near the top-right); from full screen or a browser tab
  // it reopens as a compact window instead. ⤢ Expand: the same window, maximized (or full screen, if that's the choice).
  if (p === "/window/compact" && m === "POST") {
    owner.set({ lastWindow: "compact" });
    const how = display.openedAs();
    if (how === "fullscreen" || how === "tab") return send(res, 200, await display.open({ openAs: "compact", switchTo: true })), true;
    const s = display.pick(await display.screens(), "primary") ?? { x: 0, y: 0, width: 1920, height: 1080 };
    const bx = display.miniBounds(s);
    const r = await display.windowCmd("move", ["-X", String(bx.x), "-Y", String(bx.y), "-W", String(bx.width), "-H", String(bx.height)]);
    if (!r.found) return send(res, 200, await display.open({ openAs: "compact", switchTo: true })), true;
    return send(res, 200, { ok: true, mode: "compact", bounds: bx }), true;
  }
  if (p === "/window/expand" && m === "POST") {
    owner.set({ lastWindow: "full" });
    if (display.wantOpenAs() === "fullscreen") return send(res, 200, await display.open({ openAs: "full", switchTo: true })), true;
    const r = await runPs("maximize");
    if (!r.found) return send(res, 200, await display.open({ openAs: "full", switchTo: true })), true;
    return send(res, 200, { ok: true, mode: "full" }), true;
  }
  if (p === "/window/ontop" && m === "POST") {
    const b = await readJSON(req).catch(() => ({}));
    const on = Boolean(b.on);
    if (!b.keep) settings.set({ miniOnTop: on });   // keep: only for now (the full layout isn't kept on top)
    const r = await runPs(on ? "topmost" : "notopmost");
    broadcast("settings", settings.get());
    return send(res, 200, { ok: true, on, found: r.found }), true;
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

// "Open Dayspring in my browser" / "in its own window" / "go full screen": opens that way now and remembers the choice.
const MOVED = { tab: "Opening Dayspring in a tab in your browser. If the browser asks about the microphone, choose Allow.", window: "Opening Dayspring in its own window.", fullscreen: "Going full screen.", compact: "Here's Dayspring mini. Drag it anywhere; press ⤢ to expand." };
export async function openAs(mode) {
  if (!["window", "compact", "fullscreen", "tab"].includes(mode)) return null;
  owner.set({ openAs: mode });
  clearClosed();
  const r = await display.open({ openAs: mode, switchTo: true }).catch((e) => ({ ok: false, error: e.message }));
  broadcast("owner", { openAs: mode });
  if (r.noScreen) return r.message;
  if (r.already) return mode === "tab" ? "Dayspring is already open in your browser." : "Here I am.";
  return r.ok === false ? `I couldn't open it that way: ${r.error ?? "no browser found"}.` : MOVED[mode];
}

// "Move Dayspring to the other screen" / "…to screen 2" / "…to the TV" / "…to my main screen": that screen from now on,
// and the open Dayspring screen moves there now (Settings → Screen does the same).
export function moveScreenIntent(text) {
  const t = String(text ?? "").toLowerCase().replace(/[.!?,]/g, "").replace(/^(hey )?dayspring /, "").trim();
  const m = /^(?:move|put|send|switch|show) (?:dayspring|yourself|the (?:dayspring )?(?:screen|display|app|window)|it) (?:to|onto|on) (?:the |my |this )?(.+?)$/.exec(t) || /^(?:use|switch to) (?:the |my )?(other|second|main|primary|tv|television|laptop) (?:screen|monitor|display)$/.exec(t);
  if (!m) return null;
  // "move it to 4" / "move it to Friday" is about the last thing on the schedule, not the screen: "it" needs a screen word
  if (/^(?:move|put|send|switch|show) it /.test(t) && !/\b(screen|monitor|display|tv|television|laptop)\b/.test(m[1])) return null;
  const w = m[1].replace(/ (?:screen|monitor|display)$/, "").trim();
  if (/^(?:other|second|2nd|external|tv|television|big)$/.test(w)) return "secondary";
  if (/^(?:main|primary|first|laptop|this|computer)$/.test(w)) return "primary";
  const n = /^(?:(?:screen|monitor|display) ?)?(?:number )?(\d{1,2}|one|two|three|four)$/.exec(m[1]);
  if (n) return String({ one: 1, two: 2, three: 3, four: 4 }[n[1]] ?? n[1]);
  return null;
}
export async function moveScreen(text) {
  const want = moveScreenIntent(text);
  if (!want || !featureOn("screenmove")) return null;   // "screenmove" switched off (lib/features.mjs): the choice waits until next time it opens
  const all = await display.screens();
  if (all.length < 2 && (want === "secondary" || Number(want) > 1)) return "I only see one screen right now. Plug the other one in and set Windows to Extend (Windows key + P).";
  owner.set({ display: want });
  clearClosed();
  const r = await display.moveToScreen(want).catch((e) => ({ ok: false, message: e.message }));
  broadcast("owner", { display: want });
  if (r.ok === false) return r.message || "I couldn't move it just now.";
  return r.note || (r.moved ? `Moving to screen ${r.screen}.` : `I'll use screen ${r.screen} from now on.`);
}

// "Use Brave for Dayspring" / "open Dayspring in Chrome": that browser from now on, and the screen reopens in it
export async function useBrowser(text) {
  const t = String(text ?? "").toLowerCase().replace(/[.!?,]/g, "").replace(/^(hey )?dayspring /, "").trim();
  const m = /^(?:use|switch to|change to|open (?:dayspring|yourself|the (?:screen|app)) in|put (?:dayspring|yourself) in|move (?:dayspring|yourself) to) ([a-z ]{3,24}?)(?: browser)?(?: for (?:dayspring|the (?:screen|app)|yourself))?$/.exec(t);
  if (!m) return null;
  const said = m[1].replace(/^(microsoft|google|mozilla) /, "").replace(/ browser$/, "").trim();
  const browsers = await import("./browsers.mjs");
  if (browsers.NOT_BROWSERS[said]) return `${browsers.NOT_BROWSERS[said]}, not a browser. Say “use Edge”, “use Chrome”, “use Brave” or “use Firefox”.`;
  const k = browsers.KNOWN.find((x) => x.id === said.replace(/\s+/g, "") || x.name.toLowerCase() === said || x.name.toLowerCase().endsWith(" " + said));
  if (!k) return null;
  const installed = (await browsers.list()).find((b) => b.id === k.id);
  if (!installed) return `${k.name} isn't installed on this computer. Install it first, or pick another browser in Settings → Screen.`;
  owner.set({ displayBrowser: k.id });
  clearClosed();
  const r = await display.open({ openAs: display.openedAs() ?? undefined, switchTo: true, reopen: true }).catch((e) => ({ ok: false, error: e.message }));
  broadcast("owner", { displayBrowser: k.id });
  const note = k.id === "brave" ? " In Brave I listen with the private speech recognition on this computer." : "";
  return r.ok === false ? `Dayspring will use ${k.name} from now on, but it couldn't reopen just now: ${r.error ?? r.message ?? ""}` : `Opening Dayspring in ${k.name}. The first time, allow the microphone and sign in to your apps again there.${note}`;
}

// Which way to open, from what was said: "open Dayspring in my browser" → tab, "open in its own window" → window,
// "go full screen" → fullscreen; anything else → null
export function openAsIntent(text) {
  const t = String(text ?? "").toLowerCase().replace(/[.!?,]/g, "").replace(/^(hey )?dayspring /, "").trim();
  const SUBJ = "(?:(?:open|show|put|move|switch)(?: dayspring| yourself| the (?:screen|display|app)| me)?)";
  if (new RegExp(`^(?:${SUBJ} )?(?:in|to|into) (?:my |the |a )?(?:(?:web )?browser|(?:browser|chrome|edge|firefox) tab|tab)$`).test(t) || /^use (?:my |the )?browser(?: for dayspring)?$/.test(t)) return "tab";
  if (new RegExp(`^(?:${SUBJ} )?(?:in|to|into) (?:its|your|it'?s|a|an|the) (?:own )?(?:app )?window$`).test(t) || /^(?:use|open) (?:the )?app window$/.test(t)) return "window";
  if (/^(?:go|switch to|open in|open|show) (?:dayspring )?full ?screen$|^full ?screen(?: mode)?$|^(?:make it|go) full screen$/.test(t)) return "fullscreen";
  if (/^(?:make (?:dayspring|yourself|it|the (?:screen|window)) (?:small|smaller|tiny|compact)|compact(?: mode| view)?|(?:go|switch to|open) (?:the )?(?:compact|mini)(?: mode| view| window)?|(?:open |show )?dayspring mini|mini ?mode|shrink(?: down)?)$/.test(t)) return "compact";
  if (/^(?:expand|make (?:dayspring|yourself|it) (?:big|bigger|large)|full size|expand (?:dayspring|yourself|the window))$/.test(t)) return "full";
  return null;
}

// Typed or said to Dayspring anywhere (the desk page too): "show the screen", "hide the screen", "minimize Dayspring"…
export async function command(text) {
  const t = String(text ?? "").toLowerCase().replace(/[.!?,]/g, "").replace(/^(hey )?dayspring /, "").trim();
  const ms = await moveScreen(text); if (ms) return ms;
  const ub = await useBrowser(text); if (ub) return ub;
  const how = openAsIntent(text);
  if (how === "full") { clearClosed(); const r = await display.open({ openAs: "full", switchTo: true }).catch((e) => ({ ok: false, error: e.message })); return r.noScreen ? r.message : "Expanding Dayspring."; }
  if (how) return openAs(how);
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
