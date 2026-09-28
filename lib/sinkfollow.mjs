// Music and videos on the Dayspring screen follow Dayspring's speaker choice, not the Windows default.
// YouTube (the embedded player) and Spotify (the Web Playback SDK) play inside frames from youtube.com and
// sdk.scdn.co, which the screen's own code can't reach, so they used to play wherever Windows was set. Now the screen's
// app window (Chrome, Edge, Brave, Vivaldi, Chromium) is started with a DevTools PIPE that only this server holds (no
// port: no other program or web page can drive it), and every frame from another site gets lib/sinkpick.mjs's small
// helper before its own scripts run. The helper enumerates the devices inside that frame (device ids differ per site),
// picks the device named in preferredOutputs (else the role heuristic) and moves every audio/video element and
// AudioContext there with setSinkId. When the owner changes the output, the new choice reaches every frame at once.
// Nothing here touches Windows' default device or its per-app settings.
// Limits: a normal browser tab (Settings → Screen → "a tab in my browser") and Firefox can't be steered this way, so
// media there plays on the Windows default (the Dayspring voice still follows the choice). The window closes when
// Dayspring stops (Chrome closes itself when its pipe closes); after a restart it opens again by itself.
// DS_NO_SINK_FOLLOW=1 starts the screen the old way.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cdp from "./cdp-pipe.mjs";
import * as settings from "./settings.mjs";
import { config, controllerSource, movesMedia } from "./sinkpick.mjs";
import { writeJSONAtomic } from "./atomic.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MARK = () => process.env.DS_FOLLOW_MARK || join(ROOT, "data", "display-follow.json");
// a fresh, unguessable name per server start for the helper inside each frame
const KEY = "__ds" + randomBytes(9).toString("hex");
export const enabled = () => process.env.DS_NO_SINK_FOLLOW !== "1";
let cur = null;                           // { child, c, sessions: Map(sessionId → { url, type, scriptId }), origin, mode, screen }
let lastCfg = "", watch = null, exitHooked = false;

export const active = () => Boolean(cur && !cur.c.closed);
export function status() { return { active: active(), frames: cur ? [...cur.sessions.values()].filter((s) => s.type === "iframe").length : 0, cfg: lastCfg ? JSON.parse(lastCfg) : null }; }

// The screen's launch arguments with the pipe (exported for the checks in scripts/qa/screen-launch.mjs)
export function pipeArgs(args) {
  // The mic stays allowed the way it always was (--use-fake-ui-for-media-stream: a Browser.grantPermissions over the pipe
  // isn't honoured for the app's page). --test-type hides Chrome's "unsupported command-line flag" bar that it shows for it.
  if (args.includes("--use-fake-ui-for-media-stream") && !args.includes("--test-type")) args = [...args, "--test-type"];
  // The pipe makes Chrome mark the page as automated (navigator.webdriver), and the screen treats an automated copy as a
  // test that must never listen or touch Spotify. This is the owner's real screen: keep that flag off.
  if (!args.some((a) => a.startsWith("--disable-blink-features="))) args = [...args, "--disable-blink-features=AutomationControlled"];
  return args;
}
// Start the screen's browser with the pipe. args: the usual launch arguments (lib/display.mjs launchArgs).
// origin: the Dayspring screen's own origin (it routes its own sound, so it's left alone).
export function launch(exe, args, { origin, mode = null, screen = null, prelude = null } = {}) {
  args = pipeArgs(args);
  const child = spawn(exe, ["--remote-debugging-pipe", ...args], { detached: true, stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], windowsHide: false });
  child.on("error", () => {});
  child.unref();
  return connect(child, { origin, mode, screen, prelude });
}
// (tests hand in a browser they started themselves; prelude: a script that runs first in every frame, e.g. mock devices)
export function connect(child, { origin, mode = null, screen = null, prelude = null } = {}) {
  const c = cdp.attach(child);
  c.unref();
  if (cur && !cur.c.closed) cur.c.close();          // a screen opened again: the old one's pipe goes
  const me = { child, c, sessions: new Map(), origin, mode, screen, prelude };
  cur = me;
  c.onClose(() => { if (cur === me) cur = null; });
  hookExit();
  me.ready = setup(me).catch(() => {});
  watch ??= setInterval(() => { if (!active()) return; if (JSON.stringify(config()) !== lastCfg) update().catch(() => {}); }, 30_000);   // e.g. the mixer started later
  watch.unref?.();
  return me;
}

// the screen's own page, whether it's reached as localhost or 127.0.0.1
const sameApp = (url, origin) => { try { const u = new URL(url), o = new URL(origin); return u.port === o.port && ["localhost", "127.0.0.1"].includes(u.hostname) && ["localhost", "127.0.0.1"].includes(o.hostname); } catch { return false; } };
const helper = (me, cfg) => controllerSource({ key: KEY, skipOrigin: me.origin, cfg });
// the screen's own page learns that its media follows (it tells the owner when it can't)
const flag = (origin) => `try { if (location.origin === ${JSON.stringify(origin)}) window.__dsMediaFollows = true; } catch {}`;

async function setup(me) {
  const { c } = me;
  c.on("Target.attachedToTarget", (p, parent) => { onAttached(me, p, parent).catch(() => {}); });
  c.on("Target.detachedFromTarget", (p) => { me.sessions.delete(p.sessionId); });
  lastCfg = JSON.stringify(config());
  // the mic (and choosing speakers) for the screen's own page only; each separately, since older browsers lack speakerSelection
  if (me.origin) {
    const origins = [me.origin, me.origin.replace("//localhost:", "//127.0.0.1:")].filter((o, i, a) => a.indexOf(o) === i);
    for (const origin of origins) for (const permissions of [["audioCapture"], ["speakerSelection"]]) {
      await c.send("Browser.grantPermissions", { origin, permissions }).catch(() => {});
    }
  }
  // pages and frames only (no workers), each paused until the helper is in place
  await c.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: "page" }, { type: "iframe" }] });
}
async function onAttached(me, { sessionId, targetInfo, waitingForDebugger }) {
  const { c } = me;
  const s = { url: targetInfo?.url ?? "", type: targetInfo?.type ?? "", scriptId: null };
  me.sessions.set(sessionId, s);
  try {
    await c.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: "iframe" }] }, sessionId);
    await c.send("Page.enable", {}, sessionId);        // without it, scripts added below don't run in the document that's starting
    if (me.prelude) await c.send("Page.addScriptToEvaluateOnNewDocument", { source: me.prelude, runImmediately: true }, sessionId).catch(() => {});
    if (s.type === "page") await c.send("Page.addScriptToEvaluateOnNewDocument", { source: flag(me.origin), runImmediately: true }, sessionId).catch(() => {});
    s.scriptId = (await c.send("Page.addScriptToEvaluateOnNewDocument", { source: helper(me, JSON.parse(lastCfg || "null") ?? config()), runImmediately: true }, sessionId)).identifier ?? null;
  } catch { /* a frame that went away while starting */ }
  if (waitingForDebugger) await c.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
}

// Send the current choice to every page and frame: what's playing moves now, and the next document starts with it.
// → [{ url, label }] for the frames that answered
export async function update() {
  if (!active()) return [];
  const me = cur, cfg = config();
  lastCfg = JSON.stringify(cfg);
  const src = helper(me, cfg), call = `(window[${JSON.stringify(KEY)}] ? window[${JSON.stringify(KEY)}](${lastCfg}).then((p) => p && p.label) : null)`;
  const out = await Promise.all([...me.sessions].map(async ([sid, s]) => {
    try {
      if (s.scriptId) await me.c.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: s.scriptId }, sid).catch(() => {});
      s.scriptId = (await me.c.send("Page.addScriptToEvaluateOnNewDocument", { source: src }, sid)).identifier ?? null;
      const r = await me.c.send("Runtime.evaluate", { expression: call, awaitPromise: true, returnByValue: true }, sid);
      return { url: s.url, label: r?.result?.value ?? null };
    } catch { return null; }
  }));
  return out.filter((x) => x && x.label !== null);
}

// The owner changed where Dayspring plays (or the mixer went on/off): media moves within a second
settings.onChange((s, patch) => {
  if (!movesMedia(patch) || !active()) return;
  update().catch(() => {});
  if (patch.mixer !== undefined) for (const ms of [2000, 6000]) setTimeout(() => update().catch(() => {}), ms).unref?.();   // the mixer starts in the background
});

// ---- after a restart --------------------------------------------------------------------------------------------------
// The window closes with the server (its pipe closes). When the server stops while the window is open, a note says how
// it was open; the next start (a restart, an update) opens it again the same way if that's within 90 seconds.
function hookExit() {
  if (exitHooked) return;
  exitHooked = true;
  process.on("exit", () => {
    if (!active() || process.env.DS_LAUNCH_LOG) return;
    try { writeJSONAtomic(MARK(), { mode: cur.mode, screen: cur.screen, at: new Date().toISOString() }, 0); } catch { /* not critical */ }
  });
}
export function takeResume({ within = 90_000 } = {}) {
  const f = MARK();
  if (!existsSync(f)) return null;
  let m = null;
  try { m = JSON.parse(readFileSync(f, "utf8")); } catch { /* unreadable */ }
  try { unlinkSync(f); } catch { /* gone */ }
  return m && Date.now() - Date.parse(m.at) < within ? m : null;
}
