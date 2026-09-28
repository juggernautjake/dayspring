// Cameras in Dayspring: webcams, security cameras, GoPros, Home Assistant cameras, trail cameras by email or folder, and
// cameras other features bring (the 3D printers). One interface for all of them:
//   source = { id, name, kind, room, role, snapshot() → JPEG Buffer, live?(opts, onFrame, onEnd) → { stop },
//              recordings?() → [...], fetchRecording?(ref), ffmpegInput?() → ffmpeg input args, push?, poll?() }
//
// For other features (the printers, the email feature, the multi-device feature):
//   register(source, { settings }) → unregister()     add a camera Dayspring doesn't save (e.g. a Bambu printer's camera)
//   watch(cameraId, { every, analyze, onEvent, … })  the shared snapshot mechanic (monitor.mjs)
//   onAlert(fn)                                       fn(card) for every alert (reach other devices)
//   ingestEmail(message)                              an arriving email; email cameras take the photos they match
//   snapshot(id) · lastFrame(id) · live(id, onFrame) → stop · status() · list()
//
// start() runs each saved camera's schedule, recording and alerts; nothing runs unless the owner added cameras, the
// build has the feature on (gate.mjs), and this is the owner's own Dayspring (port 4747) or DAYSPRING_CAMERAS=1 is set
// (test and audit copies never open cameras).
import * as config from "./config.mjs";
import * as events from "./events.mjs";
import * as monitor from "./monitor.mjs";
import * as recorder from "./recorder.mjs";
import * as alerts from "./alerts.mjs";
import * as analyze from "./analyze.mjs";
import * as state from "./state.mjs";
import * as gate from "./gate.mjs";
import { createDetector } from "./motion.mjs";
import { usb, rtsp, http, onvifSource } from "./sources/stream.mjs";
import { gopro } from "./sources/gopro.mjs";
import { homeassistant } from "./sources/homeassistant.mjs";
import { folder, email } from "./sources/inbox.mjs";

export { config, events, monitor, recorder, alerts, analyze, gate };
export const watch = (id, opts) => monitor.watch(id, opts);

// ---- sources ----
const BUILDERS = { usb, rtsp, http, onvif: onvifSource, gopro, homeassistant, folder, email };
const built = new Map();        // id → { key, src } (rebuilt when its settings change)
const registered = new Map();   // id → { src, settings }
export function build(cam) { const b = BUILDERS[cam.kind]; if (!b) throw new Error(`Unknown camera type "${cam.kind}".`); return b(cam); }
export function source(id) {
  if (registered.has(id)) return registered.get(id).src;
  const cam = config.get(id); if (!cam) return null;
  const key = JSON.stringify(cam);
  const b = built.get(id);
  if (b && b.key === key) return b.src;
  const src = build(cam); built.set(id, { key, src }); return src;
}
monitor.setDeps({ source });

export function register(src, { settings = {} } = {}) {
  if (!src?.id || !/^[\w-]{3,40}$/.test(src.id) || typeof src.snapshot !== "function") throw new Error("A camera source needs an id (3–40 letters, digits, - or _) and snapshot().");
  if (config.get(src.id)) throw new Error(`"${src.id}" is already a saved camera.`);
  const s = { ...config.defaultsFor(src.kind ?? "printer", src.role ?? "printer"), retention: { mode: "hook", days: 7 }, alerts: { ...config.defaultsFor("x", "printer").alerts, on: true, labels: ["failure", "match"] }, ...settings };
  registered.set(src.id, { src: { kind: "printer", role: "printer", room: "", ...src }, settings: s });
  changed();
  return () => { if (registered.get(src.id)?.src.id === src.id) { registered.delete(src.id); monitor.handleOf(src.id)?.stop(); changed(); } };
}
// a camera's settings: saved ones from Settings → Cameras, registered ones from whoever registered them
export function camera(id) {
  const r = registered.get(id);
  if (r) return { id, name: r.src.name ?? id, kind: r.src.kind, room: r.src.room ?? "", role: r.src.role ?? "printer", publicFacing: Boolean(r.src.publicFacing), registered: true, ...r.settings };
  return config.get(id);
}
export function list() {
  return [...config.all(), ...[...registered.keys()].map(camera)].map((c) => ({ ...config.publicCam(c), status: statusOf(c.id), caps: capsOf(c.id) }));
}
const capsOf = (id) => { try { const s = source(id); return { live: Boolean(s?.live), recordings: Boolean(s?.recordings), clip: Boolean(s?.ffmpegInput || s?.ffmpegInputAsync), push: Boolean(s?.push) }; } catch { return {}; } };

// ---- pictures ----
const last = new Map();   // id → { jpeg, at }
export const lastFrame = (id) => last.get(id) ?? null;
export async function snapshot(id, { fresh = true } = {}) {
  const l = last.get(id);
  if (!fresh && l) return l.jpeg;
  const s = source(id); if (!s) throw Object.assign(new Error("I can't find that camera."), { status: 404 });
  try { const jpeg = await s.snapshot(); last.set(id, { jpeg, at: new Date().toISOString() }); return jpeg; }
  catch (e) {
    // a push camera (email, folder): its last event picture
    const ev = events.list({ cam: id, limit: 1 })[0];
    if (ev) { const f = events.fileFor(ev.cam, ev.day, ev.file); if (f) { const jpeg = (await import("node:fs")).readFileSync(f); last.set(id, { jpeg, at: ev.at }); return jpeg; } }
    throw e;
  }
}
// shared live view: one reader per camera however many screens watch
const lives = new Map();  // id → { handle, subs: Set, fps }
export function live(id, onFrame, { fps = 2 } = {}) {
  const s = source(id);
  if (!s?.live) throw Object.assign(new Error("That camera has no live view (it sends pictures now and then)."), { status: 400 });
  let L = lives.get(id);
  if (!L) {
    L = { subs: new Set(), handle: null };
    lives.set(id, L);
    L.handle = s.live({ fps, width: 960 }, (jpeg) => { last.set(id, { jpeg, at: new Date().toISOString() }); for (const fn of L.subs) { try { fn(jpeg); } catch { /* a closed page */ } } },
      (why) => { if (lives.get(id) === L) lives.delete(id); for (const fn of L.subs) { try { fn(null, why); } catch { /* fine */ } } });
  }
  L.subs.add(onFrame);
  return () => { L.subs.delete(onFrame); if (!L.subs.size) { L.handle?.stop(); if (lives.get(id) === L) lives.delete(id); } };
}

// ---- the saved cameras' own monitors ----
const detectors = new Map();
function detectorFor(cam) {
  const key = JSON.stringify(cam.motion ?? {});
  const d = detectors.get(cam.id);
  if (d && d.key === key) return d.det;
  const det = createDetector(cam.motion ?? {}); detectors.set(cam.id, { key, det }); return det;
}
// The built-in look at a picture: motion first (free), then the AI only when this camera allows it and it's worth it.
export async function defaultAnalyze(cam, frame, history) {
  const pushed = Boolean(frame.pushed);
  const m = pushed ? { motion: true, score: 1, box: null, shape: null, pushed: true } : detectorFor(cam).check(frame.jpeg);
  const scheduled = frame.reason === "schedule" || frame.reason === "manual";
  const when = cam.ai?.when ?? "motion";
  const askAI = cam.ai?.enabled === true && (pushed || (m.motion && when !== "schedule") || (scheduled && when !== "motion"));
  let labels = m.motion && !pushed ? [{ label: "motion", confidence: Math.min(1, 0.5 + m.score * 4), shape: m.shape }] : [];
  let v = null;
  if (askAI) { try { v = await analyze.aiVerdict(frame.jpeg, cam, { motion: m, history, force: pushed || frame.reason === "manual" }); } catch (e) { v = { usedAI: false, error: e.message }; } }
  if (v?.usedAI) {
    // the AI looked: an event only if it saw something that matters (wind in the trees isn't one)
    const seen = v.labels ?? [];
    // (a trail camera's photo the AI found empty isn't an event, but it's kept: the owner may still want to look)
    return { event: seen.length > 0 || v.match, labels: seen, summary: v.summary, match: v.match, usedAI: true, motion: m, ...(pushed ? { keep: true } : {}) };
  }
  // no AI: motion is the event; a picture a trail camera sent is always one (the camera saw something)
  if (pushed) return { event: true, labels: [{ label: "motion", confidence: 1 }], summary: frame.meta?.subject ? String(frame.meta.subject).slice(0, 120) : "", usedAI: false, motion: m };
  return { event: m.motion, labels, summary: "", usedAI: false, motion: m };
}

let running = false, timers = [];
const wanted = () => process.env.DAYSPRING_CAMERAS === "1" || (process.env.DAYSPRING_CAMERAS !== "0" && (Number(process.env.PORT) || 4747) === 4747 && !process.env.DAYSPRING_AUDIT_COPY);
const changeFns = new Set();
export const onChange = (fn) => { changeFns.add(fn); return () => changeFns.delete(fn); };
function changed() { for (const fn of changeFns) { try { fn(); } catch { /* fine */ } } }

function startCamera(cam) {
  if (!cam.enabled) return;
  const s = source(cam.id);
  const recordInput = async () => (s.ffmpegInput ? s.ffmpegInput() : s.ffmpegInputAsync ? await s.ffmpegInputAsync() : null);
  if (cam.schedule.mode !== "off") {
    monitor.watch(cam.id, {
      mode: cam.schedule.mode === "motion" ? "motion" : "every", every: cam.schedule.everyMin * 60_000, checkSec: cam.schedule.checkSec, stream: true,
      keepStills: cam.retention.mode === "all",
      clip: cam.record.mode === "events" ? { preSec: cam.record.preSec, postSec: cam.record.postSec, audio: cam.audio } : null,
      analyze: (frame, history) => defaultAnalyze(config.get(cam.id) ?? cam, frame, history),
      onEvent: async (ev) => {
        const c = config.get(cam.id) ?? cam;
        const d = alerts.consider(ev, c);
        broadcast("cameras", { event: { id: ev.id, cam: ev.cam, at: ev.at, labels: ev.labels, summary: ev.summary, thumb: `/api/cameras/media/${ev.cam}/${ev.day}/${ev.file}` } });
        if (d.send) { events.update(ev.id, { alerted: true }); await alerts.deliver({ id: ev.id, text: d.text, labels: d.labels, at: ev.at, thumb: `/api/cameras/media/${ev.cam}/${ev.day}/${ev.file}` }, c); }
      },
    });
  }
  // the pre-event buffer (clips that start before the event) and continuous recording
  (async () => {
    if (!s.ffmpegInput && !s.ffmpegInputAsync) return;
    const input = await recordInput().catch(() => null); if (!input) return;
    if (cam.record.mode === "continuous") recorder.continuous(cam.id, input, { segmentMin: cam.record.segmentMin, copy: s.recordCopy !== false, audio: cam.audio });
    else if (cam.record.mode === "events" && cam.record.preSec > 0 && cam.schedule.mode === "motion") recorder.buffer(cam.id, input, { copy: s.recordCopy !== false, audio: cam.audio });
  })().catch((e) => console.log(`cameras: recording ${cam.name} didn't start (${e.message})`));
}
function stopCamera(id) { monitor.handleOf(id)?.stop(); recorder.stop(id); }
export async function start({ force = false } = {}) {
  await gate.ready;
  if (running || !gate.on() || (!force && !wanted())) return false;
  running = true;
  alerts.setDeps({ sinks: () => [...alertSinks] });
  for (const cam of config.all()) { try { startCamera(cam); } catch (e) { console.log(`cameras: ${cam.name}: ${e.message}`); } }
  recorder.onChange((a) => broadcast("cameras", { recording: a }));
  timers.push(setInterval(() => alerts.tick([...config.all(), ...[...registered.keys()].map(camera)]).catch(() => {}), 60_000));
  timers.push(setInterval(() => { try { events.sweep([...config.all(), ...[...registered.keys()].map(camera)]); } catch (e) { console.log(`cameras: cleanup failed (${e.message})`); } }, 60 * 60_000));
  setTimeout(() => { try { events.sweep([...config.all(), ...[...registered.keys()].map(camera)]); } catch { /* next hour */ } }, 60_000).unref?.();
  for (const t of timers) t.unref?.();
  const n = config.all().filter((c) => c.enabled).length;
  if (n) console.log(`Cameras: ${n} watched`);
  return true;
}
export function stop() { running = false; for (const t of timers.splice(0)) clearInterval(t); monitor.stopAll(); recorder.stopAll(); for (const [, L] of lives) L.handle?.stop(); lives.clear(); state.flush(); }
export const isRunning = () => running;
// Settings changed one camera: restart just that one
export function restart(id) { stopCamera(id); built.delete(id); detectors.delete(id); const cam = config.get(id); if (running && cam) startCamera(cam); changed(); }
export function forget(id) { stopCamera(id); built.delete(id); detectors.delete(id); last.delete(id); state.drop(id); changed(); }

export function statusOf(id) {
  const h = monitor.handleOf(id)?.status();
  const l = last.get(id);
  return { watching: Boolean(h), mode: h?.mode ?? null, lastAt: h?.lastAt ?? l?.at ?? null, error: h?.lastError ?? null, nextAt: h?.nextAt ?? null, events: h?.events ?? 0,
    recording: recorder.active().includes(id), live: lives.has(id) };
}
export function status() { return { running, on: gate.on(), recording: recorder.active(), watching: monitor.watching(), cameras: list().length }; }

// For a registered camera's own onEvent (the printers): the same alert rules and delivery as the saved cameras.
export async function alertEvent(ev) {
  const c = camera(ev.cam); if (!c) return { send: false, reason: "no camera" };
  const d = alerts.consider(ev, c);
  const thumb = ev.file ? `/api/cameras/media/${ev.cam}/${ev.day}/${ev.file}` : null;
  broadcast("cameras", { event: { id: ev.id, cam: ev.cam, at: ev.at, labels: ev.labels, summary: ev.summary, thumb } });
  if (d.send) { if (ev.id) events.update(ev.id, { alerted: true }); await alerts.deliver({ id: ev.id, text: d.text, labels: d.labels, at: ev.at, thumb }, c); }
  return d;
}

// ---- hooks for other features ----
const alertSinks = new Set();
export function onAlert(fn) { alertSinks.add(fn); return () => alertSinks.delete(fn); }
export async function ingestEmail(msg) {
  let took = 0;
  for (const cam of config.all().filter((c) => c.kind === "email" && c.enabled)) { const s = source(cam.id); if (s?.ingest?.(msg)) { took++; monitor.handleOf(cam.id)?.runNow("incoming").catch(() => {}); } }
  return took;
}
let bcast = null;
async function broadcast(type, data) { try { bcast ??= (await import("../bus.mjs")).broadcast; bcast(type, data); } catch { /* no screen */ } }
export function _reset() { stop(); built.clear(); registered.clear(); detectors.clear(); last.clear(); }
