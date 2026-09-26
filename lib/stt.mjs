// Speech to text on this computer (whisper.cpp): nothing leaves the PC. Used by "Tune in" (listening to calls and
// whatever plays in the headset) and the Discord bot.
//
//   ready()                                   → { ok, why, model, fast }
//   transcribe(pcm, { prompt, speed })        → { text, ms }   pcm = 16 kHz mono 16-bit (Int16Array or Buffer)
//        speed: "accurate" (default: base.en) or "fast" (tiny.en: ~10% of real time here, for always-on listening)
//   install({ model })                        → runs scripts/install-whisper.ps1 (whisper.cpp + a model into bin/whisper)
//   stop()                                    → shuts the background whisper servers down
//
// Each model runs as a whisper-server that keeps it loaded (fast); whisper-cli is the fallback. Audio goes to the
// server in memory; the fallback writes one temporary .wav and deletes it straight away. Nothing is logged here.
// Measured on the dev laptop (Core Ultra 7, 7.3 s of speech): base.en 1.7 s, tiny.en 0.7 s, both word-perfect.
import { existsSync, readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFile } from "node:child_process";
import { tmpdir, cpus } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DIR = join(ROOT, "bin", "whisper");
const BASE_PORT = Number(process.env.WHISPER_PORT || 4781);
const THREADS = Math.max(2, Math.min(8, (cpus()?.length || 4) - 2));

function find(name, dir = DIR, depth = 0) {
  if (!existsSync(dir) || depth > 3) return null;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name) return p;
    if (e.isDirectory()) { const hit = find(name, p, depth + 1); if (hit) return hit; }
  }
  return null;
}
const have = (f) => { const p = join(DIR, "models", f); return existsSync(p) && statSync(p).size > 10_000_000 ? p : null; };
// accurate: WHISPER_MODEL, else base.en, small.en, tiny.en.  fast: tiny.en if present, else the accurate one.
function modelFor(speed = "accurate") {
  const accurate = [process.env.WHISPER_MODEL, "ggml-base.en.bin", "ggml-small.en.bin", "ggml-tiny.en.bin"].filter(Boolean).map(have).find(Boolean) ?? null;
  return speed === "fast" ? have("ggml-tiny.en.bin") ?? accurate : accurate;
}
const serverExe = () => find("whisper-server.exe");
const cliExe = () => find("whisper-cli.exe") ?? find("main.exe");

export function ready() {
  if (!serverExe() && !cliExe()) return { ok: false, why: "Speech-to-text isn't installed yet. Turn on Tune in and choose Install, or run scripts\\install-whisper.ps1." };
  const m = modelFor();
  if (!m) return { ok: false, why: "The speech-to-text model is missing. Run scripts\\install-whisper.ps1 again." };
  return { ok: true, why: "", model: m.split(/[\\/]/).pop(), fast: modelFor("fast").split(/[\\/]/).pop() };
}

// ---- background servers, one per model ---------------------------------------------------------------------------
const servers = new Map();   // model path → { proc, port, starting }
async function alive(port) {
  try { const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) }); return r.status < 500; } catch { return false; }
}
async function serverFor(m) {
  let s = servers.get(m);
  if (!s) { s = { proc: null, port: BASE_PORT + servers.size, starting: null }; servers.set(m, s); }
  if (s.proc && (await alive(s.port))) return s.port;
  if (s.starting) return s.starting;
  const exe = serverExe();
  if (!exe) return null;
  s.starting = (async () => {
    if (await alive(s.port)) return s.port;   // left over from an earlier run
    s.proc = spawn(exe, ["-m", m, "--host", "127.0.0.1", "--port", String(s.port), "-t", String(THREADS), "-l", "en", "-nt"], { windowsHide: true, stdio: "ignore" });
    s.proc.on("exit", () => { s.proc = null; });
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (await alive(s.port)) return s.port; }
    return null;
  })().finally(() => { s.starting = null; });
  return s.starting;
}
export function stop() { for (const s of servers.values()) { try { s.proc?.kill(); } catch { /* gone */ } s.proc = null; } }
process.on("exit", stop);

// ---- WAV ------------------------------------------------------------------------------------------------------
export function wav(pcm, rate = 16000) {
  const data = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// Whisper's filler for silence and music ("[BLANK_AUDIO]", "(music)", "♪") isn't speech.
export const clean = (t) => String(t ?? "").replace(/\[[^\]]*\]|\([^)]*\)|♪+|\*[^*]*\*/g, " ").replace(/\s+/g, " ").trim();

export async function transcribe(pcm, { prompt = "", speed = "accurate" } = {}) {
  const t0 = Date.now();
  const r = ready();
  if (!r.ok) throw Object.assign(new Error(r.why), { status: 503 });
  const m = modelFor(speed), audio = wav(pcm);
  const port = await serverFor(m);
  if (port) {
    const fd = new FormData();
    fd.append("file", new Blob([audio], { type: "audio/wav" }), "a.wav");
    fd.append("response_format", "json");
    fd.append("temperature", "0");
    if (prompt) fd.append("prompt", prompt);
    const res = await fetch(`http://127.0.0.1:${port}/inference`, { method: "POST", body: fd, signal: AbortSignal.timeout(30_000) });
    if (res.ok) { const j = await res.json(); return { text: clean(j.text), ms: Date.now() - t0 }; }
  }
  // fallback: one short-lived process for this chunk
  const exe = cliExe(); if (!exe) throw new Error("whisper isn't available");
  const f = join(tmpdir(), `ds-stt-${process.pid}-${Date.now()}.wav`);
  writeFileSync(f, audio);
  try {
    const out = await new Promise((resolve, reject) => execFile(exe, ["-m", m, "-f", f, "-nt", "-np", "-l", "en", "-t", String(THREADS), ...(prompt ? ["--prompt", prompt] : [])], { windowsHide: true, timeout: 60_000, maxBuffer: 4 << 20 }, (e, so) => (e ? reject(e) : resolve(so))));
    return { text: clean(out), ms: Date.now() - t0 };
  } finally { try { unlinkSync(f); } catch { /* already gone */ } }
}

// Download whisper.cpp and a model (the owner approves this from the Tune in button or Settings).
export function install({ model: m = "base.en" } = {}) {
  const run = (mm) => new Promise((resolve, reject) => {
    execFile("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "scripts", "install-whisper.ps1"), "-Model", mm], { windowsHide: true, timeout: 15 * 60_000, maxBuffer: 8 << 20 },
      (e, so, se) => (e ? reject(new Error((se || so || e.message).trim().split(/\r?\n/).pop())) : resolve(so)));
  });
  return run(m).then(() => run("tiny.en")).then(() => ready());
}
