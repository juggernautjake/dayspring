// Faces in one picture: where they are, and (with the face models installed and face recognition on) a fingerprint
// for each. The models run in their own process (face-worker.mjs) at below-normal priority; it's closed after 90 seconds
// with nothing to do, and restarted if it ever grows past the memory limit. Without the models, Windows' own face
// finder still counts faces (no fingerprints, so nobody can be recognised).
//   find(path, { embed }) → { w, h, taken, engine: "models" | "windows" | "none", faces: [{ box, score?, kps?, emb? }] }
//   similarity(a, b) · decodeEmb(b64) · stopWorker() · workerStatus()
import { fork } from "node:child_process";
import { constants, setPriority } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as helper from "./helper.mjs";
import * as models from "./models.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const IDLE_MS = 90_000;
export const MEMORY_LIMIT = Number(process.env.DAYSPRING_FACE_MEMORY_MB || 320) * 1e6;

let worker = null, nextId = 1, idleTimer = null, lastRss = 0;
const waiting = new Map();
function startWorker() {
  if (worker) return worker;
  const w = fork(join(HERE, "face-worker.mjs"), [], { execArgv: ["--max-old-space-size=96"], serialization: "advanced", stdio: ["ignore", "ignore", "ignore", "ipc"], env: { ...process.env, DAYSPRING_FACE_PATHS: JSON.stringify(models.paths()) }, windowsHide: true });
  worker = w;
  try { setPriority(w.pid, constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not allowed: fine */ }
  w.on("message", (m) => { const p = waiting.get(m.id); if (!p) return; waiting.delete(m.id); clearTimeout(p.timer); if (m.error) p.reject(new Error(m.error)); else p.resolve(m); });
  const gone = () => { if (worker === w) worker = null; for (const [id, p] of waiting) { clearTimeout(p.timer); p.reject(new Error("The face engine stopped.")); waiting.delete(id); } };
  w.on("exit", gone); w.on("error", gone);
  return w;
}
function ask(msg, timeoutMs = 120_000) {
  const w = startWorker(), id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error("The face engine took too long.")); stopWorker(); }, timeoutMs);
    waiting.set(id, { resolve, reject, timer });
    w.send({ ...msg, id });
    clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (!waiting.size) stopWorker(); }, IDLE_MS); idleTimer.unref?.();
  });
}
export function stopWorker() { clearTimeout(idleTimer); const w = worker; worker = null; if (w) { try { w.send({ cmd: "bye" }); } catch { /* gone */ } setTimeout(() => { try { w.kill(); } catch { /* gone */ } }, 2000).unref?.(); } }
export const workerStatus = () => ({ running: Boolean(worker), rssMB: Math.round(lastRss / 1e6), limitMB: Math.round(MEMORY_LIMIT / 1e6) });

export async function find(path, { embed = true } = {}) {
  const useModels = embed && models.status().installed;
  const a = await helper.analyze(path, useModels ? ["pixels", "facts"] : ["faces", "facts"], { max: 1280 });
  const taken = a.facts?.taken ? a.facts.taken.slice(0, 10) : null;
  if (!useModels) return { w: a.width, h: a.height, taken, engine: a.faces ? "windows" : "none", faces: (a.faces ?? []).map((f) => ({ box: [f.x, f.y, f.w, f.h] })) };
  const px = a.pixels;
  const r = await ask({ cmd: "faces", w: px.w, h: px.h, rgb: Buffer.from(px.rgb, "base64") });
  // keep the engine's memory in check: restart it when it grows past the limit
  try { lastRss = (await ask({ cmd: "mem" }, 10_000)).rss; if (lastRss > MEMORY_LIMIT) stopWorker(); } catch { /* fine */ }
  return { w: a.width, h: a.height, taken, engine: "models", faces: r.faces };
}

export function decodeEmb(b64) { const b = Buffer.from(b64, "base64"); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
export function similarity(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
