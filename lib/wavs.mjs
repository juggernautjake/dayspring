// Dayspring's sounds as WAV files, for the desktop notifications helper (bin/Dayspring Notifications.exe) to play when no
// Dayspring screen is open: the screen makes its sounds live with Web Audio, the helper can only play files. They're made
// here from the same notes (soft bells over a warm chord), once, into bin/sounds/, so nothing is downloaded or shipped.
//
//   ensureWavs() → { alarm, chime, soft, silent } file paths
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BIN } from "./native.mjs";

const RATE = 22050;
const VERSION = 1;                       // bump when the sounds change, so old files are made again

function render(seconds, draw) {
  const n = Math.round(seconds * RATE), buf = new Float32Array(n);
  draw(buf);
  let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const k = peak > 0 ? 0.89 / peak : 0;          // normalize: the helper sets the loudness
  const pcm = Buffer.alloc(44 + n * 2);
  pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + n * 2, 4); pcm.write("WAVE", 8); pcm.write("fmt ", 12);
  pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(RATE, 24);
  pcm.writeUInt32LE(RATE * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write("data", 36); pcm.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(buf[i] * k * 32767))), 44 + i * 2);
  return pcm;
}
// a bell: a few inharmonic partials, a soft attack and an exponential decay
function bell(buf, f, t, { dur = 1.2, vol = 0.12 } = {}) {
  const start = Math.round(t * RATE), len = Math.round(dur * RATE);
  const parts = [[1, 1], [2.01, 0.35], [3.02, 0.15], [4.2, 0.06]];
  for (let i = 0; i < len && start + i < buf.length; i++) {
    const s = i / RATE, env = Math.min(1, s / 0.004) * Math.exp(-s * 3.2 / dur);
    let v = 0; for (const [m, a] of parts) v += a * Math.sin(2 * Math.PI * f * m * s);
    buf[start + i] += vol * env * v;
  }
}
function pad(buf, freqs, t, { dur = 3, vol = 0.03 } = {}) {
  const start = Math.round(t * RATE), len = Math.round(dur * RATE);
  for (let i = 0; i < len && start + i < buf.length; i++) {
    const s = i / RATE, env = Math.sin(Math.PI * Math.min(1, s / dur));
    let v = 0; for (const f of freqs) v += Math.sin(2 * Math.PI * f * s);
    buf[start + i] += vol * env * v / freqs.length;
  }
}
export const SOUNDS = {
  // the alarm's ring, as the screen plays it at full strength: E G B E' B G over an E-major pad, then a breath (it loops)
  alarm: () => render(5.2, (b) => { [659, 784, 988, 1319, 988, 784].forEach((f, i) => bell(b, f, i * 0.16, { dur: 1.2, vol: 0.3 })); pad(b, [329.6, 415.3, 493.9], 0, { dur: 3, vol: 0.06 }); }),
  chime: () => render(1.6, (b) => { bell(b, 784, 0, { vol: 0.15 }); bell(b, 1046.5, 0.13, { vol: 0.13 }); }),
  soft: () => render(1.8, (b) => { bell(b, 1046.5, 0, { dur: 1.2, vol: 0.07 }); bell(b, 1318.5, 0.12, { dur: 1.3, vol: 0.06 }); }),
  silent: () => render(1, () => {}),
};

export function ensureWavs(dir = join(BIN, "sounds")) {
  mkdirSync(dir, { recursive: true });
  const out = {};
  for (const [name, make] of Object.entries(SOUNDS)) {
    const f = join(dir, `${name}.v${VERSION}.wav`);
    if (!existsSync(f)) writeFileSync(f, make());
    out[name] = f;
  }
  return out;
}
