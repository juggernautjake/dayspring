// Which output device Dayspring's MUSIC and VIDEOS play on, and the small in-page helper that sends them there.
// Dayspring's own voice and sounds are routed by the screen itself (public/tv.js routeAudio). Media plays in places the
// screen's code can't reach: YouTube and Spotify frames on the Dayspring screen (lib/sinkfollow.mjs puts this helper in
// them) and the media browser's pages (lib/browser.mjs). Both use the same choice:
//   - the mixer (Voicemeeter) on: "Voicemeeter Input", which the mixer sends where the owner picked
//   - "default" (or nothing): the Windows default
//   - otherwise the first of the owner's roles that has a device, in the order TV, headphones, speakers (copy-protected
//     music can only play on one device at a time); within a role, EXACTLY the device named in preferredOutputs first,
//     and only when that one isn't there, a device whose name says it's that kind (the role heuristic)
// Nothing here changes any Windows setting: it only chooses where an element of Dayspring's own plays (setSinkId).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as settings from "./settings.mjs";
import * as mixer from "./voicemeeter.mjs";

// Self-contained (no outside names): it is also sent into pages as source text.
// outs: [{ id, label }] from enumerateDevices · cfg: { roles, preferred: { tv, headphones, speakers }, typeHints }
// → { id, label, role, how: "preferred" | "role" | "mixer" | "default" }   (id "" = the Windows default)
export function pickOutput(outs, cfg) {
  const none = { id: "", label: "default", role: "default", how: "default" };
  const real = (outs || []).filter((d) => d && d.id && d.id !== "default" && d.id !== "communications" && d.label);
  const roles = (cfg && cfg.roles) || [];
  if (roles.includes("voicemeeter")) {
    const v = real.find((d) => /^voicemeeter input/i.test(d.label));
    return v ? { id: v.id, label: v.label, role: "voicemeeter", how: "mixer" } : none;
  }
  if (!roles.length || roles.includes("default")) return none;
  const hints = (cfg && cfg.typeHints) || {};
  const classify = (label) => {
    const l = String(label || "").toLowerCase();
    if (/voicemeeter|vb-audio/.test(l)) return "virtual";
    for (const part of Object.keys(hints)) if (part && l.includes(part.toLowerCase())) { const k = String(hints[part]); return /head|ear|bud/.test(k) ? "headphones" : k === "tv" || k === "display" ? "tv" : /speak/.test(k) ? "speakers" : "other"; }
    if (/headphone|headset|buds|airpods|earphone/.test(l)) return "headphones";
    if (/display audio|hdmi|\btv\b|television|monitor|nvidia high definition|amd high definition/.test(l)) return "tv";
    if (/realtek|speaker/.test(l)) return "speakers";
    return "other";
  };
  // the same device after Windows renumbers it ("2- " → "3- ") or a browser adds a USB id (" (046d:0ab5)")
  const norm = (s) => String(s || "").toLowerCase().replace(/\s+\([0-9a-f]{4}:[0-9a-f]{4}\)$/, "").replace(/\b\d+- /g, "").replace(/\s+/g, " ").trim();
  const preferred = (cfg && cfg.preferred) || {};
  for (const role of ["tv", "headphones", "speakers"].filter((r) => roles.includes(r))) {
    const want = preferred[role];
    if (want) {
      const d = real.find((x) => x.label === want) || real.find((x) => norm(x.label) === norm(want));
      if (d) return { id: d.id, label: d.label, role, how: "preferred" };
    }
    const h = real.find((x) => classify(x.label) === role);
    if (h) return { id: h.id, label: h.label, role, how: "role" };
  }
  return none;
}

// Self-contained too: runs inside a page or frame, before the page's own scripts. It remembers every audio/video element
// that starts playing (Spotify's are often never put on the page) and every AudioContext, and sends them all to the
// chosen device, now and whenever the choice or the plugged-in devices change. Installed once per document under
// opts.key, which is also the function the server calls with a new choice: window[opts.key](cfg) → the pick.
// opts: { key, skipOrigin (the Dayspring screen's own origin: it routes itself), cfg, exposeMedia, unlockLabels }
export function sinkController(opts, pickOutput) {
  try { if (window[opts.key]) return; if (opts.skipOrigin && location.origin === opts.skipOrigin) return; } catch { return; }
  const els = new Set(), ctxs = new Set();
  if (opts.exposeMedia) window.__dsMedia = els;           // the media browser's fades and ducking use it too
  let cfg = opts.cfg || null, sink = null, busy = null, again = false;
  const setEl = (el) => { if (sink === null || !el || !el.setSinkId || el.sinkId === sink) return; el.setSinkId(sink).catch(() => {}); };
  const setCtx = (c) => { if (sink === null || !c || !c.setSinkId || c.state === "closed") return; if ((typeof c.sinkId === "string" ? c.sinkId : "") === sink) return; c.setSinkId(sink).catch(() => {}); };
  async function decide() {
    if (!cfg) return null;
    if (busy) { again = true; return busy; }
    busy = (async () => {
      let devs = [];
      try { devs = await navigator.mediaDevices.enumerateDevices(); } catch { /* none */ }
      if (cfg.unlockLabels && devs.some((d) => d.kind === "audiooutput" && !d.label)) {
        // names are hidden until the page may use the microphone (the media browser has that permission)
        try { const s = await Promise.race([navigator.mediaDevices.getUserMedia({ audio: true }), new Promise((_, no) => setTimeout(() => no(new Error("timed out")), 4000))]); s.getTracks().forEach((t) => t.stop()); devs = await navigator.mediaDevices.enumerateDevices(); } catch { /* no permission */ }
      }
      const pick = pickOutput(devs.filter((d) => d.kind === "audiooutput").map((d) => ({ id: d.deviceId, label: d.label })), cfg);
      sink = pick.id;
      if (opts.exposeMedia) window.__dsSink = sink;
      for (const el of new Set([...document.querySelectorAll("audio, video"), ...els])) setEl(el);
      for (const c of ctxs) setCtx(c);
      // frames of the same origin inside this one share the choice (other origins get their own copy of this helper)
      for (let i = 0; i < window.frames.length; i++) { try { const f = window.frames[i][opts.key]; if (f) f(cfg); } catch { /* another origin */ } }
      return pick;
    })();
    try { return await busy; } finally { busy = null; if (again) { again = false; decide(); } }
  }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) { els.add(this); setEl(this); return play.apply(this, a); };
  document.addEventListener("play", (e) => { if (e.target instanceof HTMLMediaElement) { els.add(e.target); setEl(e.target); } }, true);
  try {
    const AC = window.AudioContext;
    if (AC && AC.prototype.setSinkId) {
      const Wrapped = class AudioContext extends AC { constructor(...a) { super(...a); ctxs.add(this); setCtx(this); } };
      window.AudioContext = Wrapped;
    }
  } catch { /* leave AudioContext alone */ }
  try { navigator.mediaDevices.addEventListener("devicechange", () => setTimeout(decide, 800)); } catch { /* no devices API */ }
  Object.defineProperty(window, opts.key, { value: (c) => { if (c) cfg = c; return decide(); }, enumerable: false, configurable: false, writable: false });
  if (cfg) decide();
}
export const controllerSource = (opts) => `(${sinkController.toString()})(${JSON.stringify(opts)}, ${pickOutput.toString()});`;

// The owner's type hints (data/devices.json "typeHints"), re-read at most once a minute
const DEVICES_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "devices.json");
let hints = { at: 0, map: {} };
function typeHints() {
  if (Date.now() - hints.at > 60_000) { try { hints = { at: Date.now(), map: existsSync(DEVICES_FILE) ? JSON.parse(readFileSync(DEVICES_FILE, "utf8")).typeHints ?? {} : {} }; } catch { hints = { at: Date.now(), map: {} }; } }
  return hints.map;
}
// The roles media follows right now: the mixer's input while the mixer runs, else the owner's choice
export const rolesNow = (s = settings.get()) => (mixer.isActive() ? ["voicemeeter"] : (s.audioOutputs ?? ["default"]));
export function config(roles = rolesNow()) {
  const s = settings.get();
  return { roles: Array.isArray(roles) ? roles : [], preferred: s.preferredOutputs ?? {}, typeHints: typeHints() };
}
// A settings change that should move playing media
export const movesMedia = (patch = {}) => Boolean(patch.audioOutputs || patch.preferredOutputs || patch.mixer !== undefined);
