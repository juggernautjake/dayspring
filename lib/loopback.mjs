// Hear what a playback device is playing (WASAPI loopback, shared mode: the device is never taken over, so Discord,
// games and music keep working exactly as they are). bin/loopcap.exe is compiled from scripts/loopcap.cs the first
// time it's needed, with the C# compiler that ships with Windows.
//   devices()                 → [{ id, name, default }]
//   capture({ device, onPcm, onEnd }) → { stop(), device }    onPcm(Int16Array of 16 kHz mono)
import { existsSync, statSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "scripts", "loopcap.cs");
const EXE = join(ROOT, "bin", "loopcap.exe");
const CSC = [process.env.WINDIR || "C:\\Windows"].flatMap((w) => [join(w, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"), join(w, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe")]);

const run = (file, args, opts = {}) => new Promise((resolve, reject) =>
  execFile(file, args, { windowsHide: true, timeout: 60_000, maxBuffer: 4 << 20, ...opts }, (e, so, se) => (e ? reject(Object.assign(e, { stderr: se, stdout: so })) : resolve(so))));

let building = null;
export async function ensureBuilt() {
  if (existsSync(EXE) && statSync(EXE).mtimeMs >= statSync(SRC).mtimeMs) return EXE;
  if (building) return building;
  building = (async () => {
    const csc = CSC.find((p) => existsSync(p));
    if (!csc) throw new Error("Windows' C# compiler (.NET Framework 4) wasn't found, so Tune in can't hear the headset.");
    mkdirSync(dirname(EXE), { recursive: true });
    await run(csc, ["/nologo", "/target:exe", "/platform:x64", "/optimize+", `/out:${EXE}`, SRC]).catch((e) => { throw new Error("Couldn't build the listener: " + String(e.stdout || e.message).slice(0, 300)); });
    return EXE;
  })().finally(() => { building = null; });
  return building;
}

export async function devices() {
  const exe = await ensureBuilt();
  return JSON.parse((await run(exe, ["-list"])) || "[]");
}

export async function capture({ device = null, onPcm, onEnd = () => {} } = {}) {
  const exe = await ensureBuilt();
  const p = spawn(exe, device ? ["-device", device] : [], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  p.on("error", (e) => { err += `Tune in couldn't start its listener (${e.code ?? e.message}). If Windows Security blocked it, allow loopcap.exe, or turn Tune in off and on again.`; try { onEnd({ code: 1, error: err }); } catch { /* caller gone */ } });
  let name = "", err = "", odd = null;
  p.stderr.on("data", (d) => { const s = String(d); err += s; const m = /device: (.+)/.exec(s); if (m) name = m[1].trim(); });
  p.stdout.on("data", (d) => {
    // keep samples aligned to 2 bytes across chunks
    if (odd) { d = Buffer.concat([odd, d]); odd = null; }
    if (d.length % 2) { odd = d.subarray(d.length - 1); d = d.subarray(0, d.length - 1); }
    if (d.length) onPcm(new Int16Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.length)));
  });
  p.on("exit", (code) => onEnd({ code, error: code ? err.trim().split(/\r?\n/).pop() : "" }));
  // wait for it to report the device (or fail)
  for (let i = 0; i < 40 && !name && p.exitCode === null; i++) await new Promise((r) => setTimeout(r, 50));
  return {
    get device() { return name; },
    stop() { try { p.stdin.end(); } catch { /* gone */ } setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, 800); },
  };
}
