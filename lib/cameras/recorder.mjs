// Recording video with ffmpeg:
//   clips on events: with a pre-event buffer (a rolling set of 2-second pieces kept in the temp folder while the camera
//     is watched), a clip is the few seconds before the event plus postSec after it, joined without re-encoding;
//     without the buffer, it records postSec from the moment of the event.
//   continuous: segments of segmentMin minutes into <storage>/<camera>/continuous/, trimmed by the retention days and
//     the disk limit (events.sweep).
// Whatever is recording right now is listed by active() (the ● REC sign on the Dayspring screen and the Cameras page).
//   buffer(camId, input, { copy, segSec }) · stopBuffer(camId) · clip(camId, input, { preSec, postSec, out, copy })
//   continuous(camId, input, { segmentMin, copy }) · stop(camId) · stopAll() · active() · onChange(fn)
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import * as ff from "./ffmpeg.mjs";
import * as events from "./events.mjs";

const bufs = new Map();     // camId → { proc, dir, segSec, started }
const conts = new Map();    // camId → { proc }
const clips = new Map();    // camId → count of clips being made
const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => { const a = active(); for (const fn of listeners) { try { fn(a); } catch { /* fine */ } } };
// camera ids being written to disk now (the pre-event buffer is only temporary, but it still counts as recording)
export const active = () => [...new Set([...bufs.keys(), ...conts.keys(), ...[...clips].filter(([, n]) => n > 0).map(([k]) => k)])];

const enc = (copy) => (copy ? ["-c:v", "copy"] : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p", "-g", "20"]);
const audioArgs = (audio) => (audio ? ["-c:a", "aac", "-b:a", "64k"] : ["-an"]);

export function buffer(camId, input, { copy = true, segSec = 2, keep = 16, audio = false } = {}) {
  stopBuffer(camId);
  const dir = join(tmpdir(), "dayspring-camera-buffer", camId.replace(/[^\w-]/g, ""));
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const proc = ff.spawnFfmpeg(["-loglevel", "error", ...input, ...enc(copy), ...(copy ? [] : ["-force_key_frames", `expr:gte(t,n_forced*${segSec})`]), ...audioArgs(audio),
    "-f", "segment", "-segment_time", String(segSec), "-segment_wrap", String(keep), "-reset_timestamps", "1", "-segment_format", "mpegts", join(dir, "b%03d.ts")]);
  const b = { proc, dir, segSec, started: Date.now(), err: "" };
  proc.stderr.on("data", (d) => { if (b.err.length < 2000) b.err += d; });
  proc.stdout.on("data", () => {});
  proc.on("close", () => { if (bufs.get(camId) === b) { bufs.delete(camId); changed(); } });
  bufs.set(camId, b); changed();
  return b;
}
export function stopBuffer(camId) { const b = bufs.get(camId); if (!b) return; bufs.delete(camId); try { b.proc.kill("SIGKILL"); } catch { /* gone */ } setTimeout(() => rmSync(b.dir, { recursive: true, force: true }), 1500).unref?.(); changed(); }
export const hasBuffer = (camId) => bufs.has(camId);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// segments that finished between from and to (by their file times)
function segmentsBetween(dir, from, to) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^b\d{3}\.ts$/.test(f)).map((f) => { const s = statSync(join(dir, f)); return { f: join(dir, f), end: s.mtimeMs, size: s.size }; })
    .filter((x) => x.size > 0 && x.end >= from && x.end <= to + 500).sort((a, b) => a.end - b.end);
}

// A clip for an event at `at` (ms). Returns the file, or null.
export async function clip(camId, input, { preSec = 5, postSec = 10, out, copy = true, at = Date.now(), audio = false } = {}) {
  mkdirSync(dirname(out), { recursive: true });
  clips.set(camId, (clips.get(camId) ?? 0) + 1); changed();
  try {
    const b = bufs.get(camId);
    if (b && preSec > 0) {
      await sleep(postSec * 1000 + b.segSec * 1000 + 300);
      const segs = segmentsBetween(b.dir, at - preSec * 1000, at + postSec * 1000 + b.segSec * 1000);
      if (segs.length) {
        const list = join(b.dir, `list-${Date.now()}.txt`);
        writeFileSync(list, segs.map((s) => `file '${s.f.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"));
        const r = await ff.run(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", "-y", out], { timeoutMs: 60_000 });
        rmSync(list, { force: true });
        if (r.code === 0 && existsSync(out) && statSync(out).size > 0) return out;
      }
    }
    // no buffer (or it had nothing yet): record from now
    const r = await ff.run([...input, "-t", String(postSec), ...enc(copy), ...audioArgs(audio), "-movflags", "+faststart", "-y", out], { timeoutMs: (postSec + 30) * 1000 });
    return r.code === 0 && existsSync(out) && statSync(out).size > 0 ? out : null;
  } finally { clips.set(camId, (clips.get(camId) ?? 1) - 1); if (!clips.get(camId)) clips.delete(camId); changed(); }
}

export function continuous(camId, input, { segmentMin = 5, copy = true, audio = false } = {}) {
  stop(camId);
  const dir = events.continuousDir(camId);
  mkdirSync(dir, { recursive: true });
  const proc = ff.spawnFfmpeg(["-loglevel", "error", ...input, ...enc(copy), ...audioArgs(audio), "-f", "segment", "-segment_time", String(segmentMin * 60), "-reset_timestamps", "1",
    "-strftime", "1", "-segment_format", "mp4", "-segment_format_options", "movflags=+faststart", join(dir, "%Y-%m-%d_%H-%M-%S.mp4")], { interactive: true });
  const c = { proc, err: "" };
  proc.stderr.on("data", (d) => { if (c.err.length < 2000) c.err += d; });
  proc.stdout.on("data", () => {});
  proc.on("close", () => { if (conts.get(camId) === c) { conts.delete(camId); changed(); } });
  conts.set(camId, c); changed();
  return c;
}
export const isContinuous = (camId) => conts.has(camId);
export function stop(camId) { const c = conts.get(camId); if (c) { conts.delete(camId); try { c.proc.stdin.write("q"); c.proc.stdin.end(); } catch { /* gone */ } setTimeout(() => { try { c.proc.kill("SIGKILL"); } catch { /* gone */ } }, 4000).unref?.(); changed(); } stopBuffer(camId); }
export function stopAll() { for (const k of [...conts.keys(), ...bufs.keys()]) stop(k); }
