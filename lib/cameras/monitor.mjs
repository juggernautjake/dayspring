// The "snapshot mechanic", shared by every camera (and by other features' cameras, like the 3D printers):
// a picture every N minutes (or a low-rate stream of motion checks), looked at (motion here, the AI when allowed, or the
// caller's own analyse), and then: an event (kept, maybe a clip, maybe an alert), a still kept for the timeline, or
// nothing kept at all ("delete if it's fine").
//
//   watch(cameraId, {
//     every: "10m" | ms,                 how often a picture is taken (push cameras: how often to look for new ones)
//     checkSec: 5,  mode: "every"|"motion",  motion mode: a low-rate stream (or snapshots) checked every checkSec
//     analyze(frame, history) → verdict  frame { camId, at, jpeg, reason: schedule|motion|incoming|manual, meta }
//                                         verdict { event, labels: [{label, confidence}], summary, keep: true|false|undefined,
//                                                   match, usedAI, motion }
//     onEvent(event, frame, verdict),    after the event is saved (the event has id, at, labels, file…)
//     onFrame(frame, verdict),           every picture (e.g. a printer's progress)
//     keepStills: false,                 keep non-event pictures (retention "all"); verdict.keep overrides either way
//     clip: { preSec, postSec } | null   record a clip for each event (needs a source with ffmpegInput)
//   }) → { stop(), runNow(reason), status() }
//
// A camera that fails is retried with a growing wait (up to 5 minutes); status() says why.
import * as events from "./events.mjs";
import * as recorder from "./recorder.mjs";

let deps = { source: () => null, now: () => Date.now() };
export function setDeps(d) { deps = { ...deps, ...d }; }

export function parseEvery(e, dflt = 10 * 60_000) {
  if (typeof e === "number" && e > 0) return e;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|sec|m|min|h|hr)?$/i.exec(String(e ?? "").trim());
  if (!m) return dflt;
  const n = Number(m[1]), u = (m[2] ?? "m").toLowerCase();
  return Math.max(1000, n * (u === "ms" ? 1 : /^s/.test(u) ? 1000 : /^h/.test(u) ? 3600_000 : 60_000));
}

const watchers = new Map();   // camId → handle (one watcher per camera id at a time)
export const watching = () => [...watchers.keys()];
export const handleOf = (id) => watchers.get(id) ?? null;

export function watch(camId, opts = {}) {
  watchers.get(camId)?.stop();
  const src = () => deps.source(camId);
  if (!src()) throw new Error(`There's no camera "${camId}".`);
  const everyMs = parseEvery(opts.every);
  const mode = opts.mode === "motion" ? "motion" : "every";
  const checkMs = Math.max(1000, (opts.checkSec ?? 5) * 1000);
  const history = [];
  const st = { camId, mode, everyMs, running: true, busy: false, lastAt: null, lastError: null, fails: 0, frames: 0, events: 0, nextAt: null, live: false };
  let timer = null, stream = null, lastStill = 0, lastScheduled = 0;

  async function process(frame) {
    st.frames++; st.lastAt = new Date(frame.at).toISOString();
    let v = {};
    try { v = (await opts.analyze?.(frame, history)) ?? {}; } catch (e) { v = { event: false, error: e.message }; }
    const summary = { at: st.lastAt, event: Boolean(v.event), labels: v.labels ?? [], summary: v.summary ?? "", motion: v.motion?.motion ?? false };
    history.push(summary); if (history.length > 30) history.shift();
    try { opts.onFrame?.(frame, v); } catch { /* the caller's problem */ }
    if (v.event) {
      const rec = events.save(camId, frame.jpeg, { at: frame.at, kind: "event", source: frame.reason, labels: v.labels ?? [], summary: v.summary ?? "", motion: v.motion ? { score: round(v.motion.score), box: v.motion.box ?? null, shape: v.motion.shape ?? null } : null, usedAI: v.usedAI, extra: { ...(frame.meta ?? {}), ...(v.match ? { match: true } : {}) } });
      st.events++;
      const s = src();
      if (opts.clip && (s?.ffmpegInput || s?.ffmpegInputAsync)) {
        (async () => {
          const input = s.ffmpegInput ? s.ffmpegInput() : await s.ffmpegInputAsync();
          if (!input) return;
          const out = events.clipPathFor(rec.id);
          const f = await recorder.clip(camId, input, { preSec: opts.clip.preSec ?? 5, postSec: opts.clip.postSec ?? 10, out, copy: s.recordCopy !== false, at: Date.parse(frame.at), audio: Boolean(opts.clip.audio) }).catch(() => null);
          if (f) { events.attachClip(rec.id); opts.onClip?.(rec, f); }
        })();
      }
      try { await opts.onEvent?.({ ...rec, match: Boolean(v.match) }, frame, v); } catch (e) { console.log(`cameras: onEvent failed (${e.message})`); }
      return rec;
    }
    const keep = v.keep ?? (opts.keepStills && Date.parse(frame.at) - lastStill >= everyMs - 1000);
    if (keep) { lastStill = Date.parse(frame.at); return events.save(camId, frame.jpeg, { at: frame.at, kind: "still", source: frame.reason, labels: v.labels ?? [], summary: v.summary ?? "", usedAI: v.usedAI }); }
    return null;
  }

  async function takeOne(reason = "schedule") {
    const s = src(); if (!s) throw new Error("That camera is gone.");
    if (s.push && s.poll) {
      const list = await s.poll();
      const out = [];
      for (const f of list) out.push(await process({ camId, at: f.at ?? new Date(deps.now()).toISOString(), jpeg: f.jpeg, reason: "incoming", meta: f.meta ?? null, pushed: true }));
      return out;
    }
    const jpeg = await s.snapshot();
    return [await process({ camId, at: new Date(deps.now()).toISOString(), jpeg, reason })];
  }
  function schedule(ms) { clearTimeout(timer); if (!st.running) return; st.nextAt = new Date(Date.now() + ms).toISOString(); timer = setTimeout(tick, ms); timer.unref?.(); }
  async function tick(reason) {
    if (!st.running || st.busy) return;
    st.busy = true;
    try {
      const r = reason ?? (mode === "motion" && !src()?.push ? "motion-check" : "schedule");
      if (r === "motion-check" && Date.now() - lastScheduled >= everyMs) { lastScheduled = Date.now(); await takeOne("schedule"); }
      else await takeOne(r === "motion-check" ? "motion" : r);
      st.fails = 0; st.lastError = null;
    } catch (e) { st.fails++; st.lastError = e.message; }
    finally { st.busy = false; }
    if (!st.running) return;
    const base = mode === "motion" && !src()?.push ? checkMs : everyMs;
    schedule(st.fails ? Math.min(5 * 60_000, base * 2 ** Math.min(st.fails, 6)) : base);
  }
  // motion mode with a real stream: one low-rate ffmpeg reading the camera, every frame checked
  function startStream() {
    const s = src();
    if (!s?.live || s.push || !opts.stream) return false;
    let pending = false;
    const begin = () => {
      if (!st.running) return;
      st.live = true;
      stream = s.live({ fps: Math.max(0.05, 1000 / checkMs), width: 640 }, (jpeg) => {
        if (pending || !st.running) return;         // one at a time: a slow AI look drops frames instead of piling up
        pending = true;
        const reason = Date.now() - lastScheduled >= everyMs ? (lastScheduled = Date.now(), "schedule") : "motion";
        process({ camId, at: new Date(deps.now()).toISOString(), jpeg, reason }).catch(() => {}).finally(() => { pending = false; });
        st.fails = 0; st.lastError = null;
      }, (why) => {
        st.live = false; stream = null;
        if (!st.running || why === "stopped") return;
        st.fails++; st.lastError = why;
        setTimeout(begin, Math.min(5 * 60_000, 5000 * 2 ** Math.min(st.fails, 6))).unref?.();
      });
    };
    begin();
    return true;
  }

  const handle = {
    camId,
    stop() { st.running = false; clearTimeout(timer); stream?.stop(); stream = null; st.live = false; if (watchers.get(camId) === handle) watchers.delete(camId); },
    async runNow(reason = "manual") { const was = st.busy; if (was) return null; st.busy = true; try { return await takeOne(reason); } finally { st.busy = false; } },
    status: () => ({ ...st }),
    history: () => history.slice(),
  };
  watchers.set(camId, handle);
  if (!(mode === "motion" && startStream())) schedule(opts.startDelayMs ?? 1500);
  return handle;
}
export function stopAll() { for (const h of [...watchers.values()]) h.stop(); }
const round = (n) => (typeof n === "number" ? Math.round(n * 1000) / 1000 : n);
