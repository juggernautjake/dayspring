// The printers' cameras, as sources in Dayspring's camera system (lib/cameras): one place that switches between that
// system and a small built-in fallback (when lib/cameras isn't in this build or is turned off).
//   source = { id, name, kind: "printer", snapshot() → JPEG, live?({ fps, width }, onFrame, onEnd) → { stop } }
//   register(src) · unregister(id) · snapshot(id) · live(id, onFrame, { fps }) → stop() · watch(id, opts) → { stop, runNow }
//   borrowed(cameraId) → a source that reads another camera (a webcam pointed at an Ender, which has no camera)
// watch() uses lib/cameras' shared "every N minutes" monitor; the printers add their own analysis (bed-clear, failures)
// and keep their own files (data/prints), so the verdicts handed back never make camera events or alerts of their own.
let cams = null, tried = false;
async function camerasMod() {
  if (tried) return cams;
  tried = true;
  if (process.env.DAYSPRING_PRINTER_CAMERAS_LOCAL === "1") return (cams = null);
  try { const m = await import("../cameras/index.mjs"); cams = m.gate?.on?.() === false ? null : m; } catch { cams = null; }
  return cams;
}
export function _useLocal() { cams = null; tried = true; }
const local = new Map();          // id → src (always kept, so snapshot/live work either way)
const unregs = new Map();
export async function register(src) {
  local.set(src.id, src);
  const c = await camerasMod();
  if (c) {
    try { unregs.get(src.id)?.(); unregs.set(src.id, c.register(src, { settings: { alerts: { on: false, labels: [] }, retention: { mode: "hook", days: 1 } } })); }
    catch { /* a saved camera with that id: the printer uses its own copy */ }
  }
  return src.id;
}
export function unregister(id) { unregs.get(id)?.(); unregs.delete(id); local.delete(id); watchers.get(id)?.stop(); }
export const has = (id) => local.has(id);
export async function snapshot(id) {
  const s = local.get(id);
  if (s) return s.snapshot();
  const c = await camerasMod();
  if (c) return c.snapshot(id);
  throw new Error("That printer has no camera.");
}
export async function live(id, onFrame, { fps = 2 } = {}) {
  const c = await camerasMod();
  if (c && unregs.has(id)) return c.live(id, onFrame, { fps });
  const s = local.get(id);
  if (!s?.live) throw new Error("That camera has no live view; showing a picture every few seconds instead.");
  const h = s.live({ fps, width: 960 }, onFrame, () => {});
  return () => h.stop();
}
// a camera from lib/cameras (Settings → Cameras) lent to a printer without one
export function borrowed(printerId, cameraId, name) {
  return { id: `printer-${printerId}`, name, kind: "printer", role: "printer",
    snapshot: async () => { const c = await camerasMod(); if (!c) throw new Error("The camera system isn't on in this build."); return c.snapshot(cameraId); },
    live: (o, onFrame, onEnd) => { let stop = () => {}; camerasMod().then((c) => { if (!c) return onEnd?.("no cameras"); try { stop = c.live(cameraId, onFrame, { fps: o?.fps ?? 1 }); } catch (e) { onEnd?.(e.message); } }); return { stop: () => stop() }; } };
}
// a plain snapshot URL (an http JPEG) as a camera
export function fromUrl(printerId, url, name) {
  return { id: `printer-${printerId}`, name, kind: "printer", role: "printer",
    snapshot: async () => { const r = await fetch(url, { signal: AbortSignal.timeout(10_000) }); if (!r.ok) throw new Error(`The camera answered ${r.status}.`); return Buffer.from(await r.arrayBuffer()); } };
}

// ---- the every-N-minutes pictures ----
const watchers = new Map();
export async function watch(id, { everyMs, analyze, onFrame, startDelayMs = 3000 } = {}) {
  watchers.get(id)?.stop();
  const c = await camerasMod();
  if (c && unregs.has(id)) {
    const h = c.watch(id, { every: everyMs, startDelayMs, keepStills: false,
      analyze: async (frame) => { const v = await analyze(frame.jpeg, frame.reason); return { ...(v ?? {}), event: false, keep: false }; },
      onFrame: (frame, v) => onFrame?.(frame.jpeg, v) });
    const w = { stop: () => h.stop(), runNow: (r) => h.runNow(r), shared: true };
    watchers.set(id, w); return w;
  }
  // the fallback: a timer here
  let timer = null, busy = false, stopped = false;
  const once = async (reason = "schedule") => {
    if (busy || stopped) return null; busy = true;
    try { const jpeg = await snapshot(id); const v = await analyze(jpeg, reason); onFrame?.(jpeg, v); return v; }
    catch (e) { onFrame?.(null, { error: e.message }); return null; }
    finally { busy = false; }
  };
  const loop = () => { if (stopped) return; timer = setTimeout(async () => { await once(); loop(); }, everyMs); timer.unref?.(); };
  timer = setTimeout(async () => { await once(); loop(); }, startDelayMs); timer.unref?.();
  const w = { stop: () => { stopped = true; clearTimeout(timer); if (watchers.get(id) === w) watchers.delete(id); }, runNow: once, shared: false };
  watchers.set(id, w);
  return w;
}
export const watching = () => [...watchers.keys()];
