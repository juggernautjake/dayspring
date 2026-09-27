// The picture helper (bin/Dayspring Vision.exe, built from scripts/ocr.cs with the C# compiler that ships with Windows):
// Windows' own text recognition (Windows.Media.Ocr), face finder (Windows.Media.FaceAnalysis, where faces are, never who),
// picture decoding with the EXIF turn applied, the main colours, photo facts, face thumbnails, and DPAPI encryption for
// the people store. Everything runs on this computer. One helper process, started when needed, answers one JSON line per
// request and is closed after a minute with nothing to do.
//
//   ensureBuilt() · available() → { ok, ocr, faces, lang } · analyze(path, want, { max }) · thumb(path, box, size)
//   protect(buffer) / unprotect(buffer) · render(text, out) · resize(path, out, max) · stop()
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(ROOT, "scripts", "ocr.cs");
export const EXE = () => process.env.DAYSPRING_VISION_EXE || join(ROOT, "bin", "Dayspring Vision.exe");
const IDLE_MS = 60_000;

function compiler() {
  const w = process.env.WINDIR || process.env.SystemRoot || "C:\\Windows";
  return [join(w, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"), join(w, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe")].find((p) => existsSync(p)) ?? null;
}
// Windows' own API descriptions (the .winmd files every Windows 10/11 has) and the .NET bridges to them
function winrtRefs(csc) {
  const w = process.env.WINDIR || process.env.SystemRoot || "C:\\Windows";
  const md = join(w, "System32", "WinMetadata");
  const fw = dirname(csc);
  const winmd = ["Windows.Foundation", "Windows.Graphics", "Windows.Media", "Windows.Storage", "Windows.Globalization"].map((n) => join(md, `${n}.winmd`));
  const facades = ["System.Runtime.WindowsRuntime.dll", "System.Runtime.dll", "System.Threading.Tasks.dll", "System.Runtime.InteropServices.WindowsRuntime.dll"].map((n) => join(fw, n));
  const missing = [...winmd, ...facades].filter((p) => !existsSync(p));
  if (missing.length) throw new Error(`Windows' picture tools aren't all here (missing ${missing.map((p) => p.split(/[\\/]/).pop()).join(", ")}).`);
  return [...winmd, ...facades].map((p) => `/r:${p}`);
}

let building = null;
export function ensureBuilt() {
  if (building) return building;
  building = new Promise((resolve, reject) => {
    if (process.platform !== "win32") return reject(new Error("Reading pictures needs Windows."));
    const exe = EXE();
    // built on first need into bin (like the other helpers; never shipped in the zip), and again whenever scripts/ocr.cs
    // changes: "<exe>.version" holds the source's hash (an update's files can be older than the helper already built)
    const stamp = exe + ".version";
    const srcHash = () => createHash("sha256").update(readFileSync(SRC)).digest("hex").slice(0, 16);
    try { if (existsSync(exe) && (!existsSync(SRC) || process.env.DAYSPRING_VISION_EXE || readFileSync(stamp, "utf8").trim() === srcHash())) return resolve(exe); } catch { /* no stamp yet: rebuild */ }
    if (process.env.DAYSPRING_VISION_EXE) return reject(new Error("The picture helper isn't there."));
    const csc = compiler();
    if (!csc) return reject(new Error("Windows' C# compiler (.NET Framework 4) wasn't found, so Dayspring can't read pictures here. Turning on \".NET Framework 4.8\" in Windows Features fixes it."));
    let refs; try { refs = winrtRefs(csc); } catch (e) { return reject(e); }
    mkdirSync(dirname(exe), { recursive: true });
    execFile(csc, ["/nologo", "/target:exe", "/optimize+", `/out:${exe}`, "/r:System.Drawing.dll", "/r:System.Web.Extensions.dll", "/r:System.Security.dll", ...refs, SRC], { windowsHide: true, timeout: 180_000 }, (err, out) => {
      if (!err && existsSync(exe)) { try { writeFileSync(stamp, srcHash()); } catch { /* rebuilt next time */ } }
      if (err || !existsSync(exe)) return reject(new Error("Couldn't build the picture helper: " + String(out || err?.message).split(/\r?\n/).filter((l) => /error/i.test(l)).slice(0, 3).join(" ")));
      resolve(exe);
    });
  }).finally(() => { building = null; });
  return building;
}

// ---- the running helper ----
let child = null, buf = "", nextId = 1, idleTimer = null, lastPing = null;
const waiting = new Map();
async function start() {
  if (child) return child;
  const exe = await ensureBuilt();
  if (child) return child;
  const c = spawn(exe, [], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
  child = c;
  c.stdout.setEncoding("utf8");
  c.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      const w = waiting.get(m.id); if (!w) continue;
      waiting.delete(m.id); clearTimeout(w.timer);
      if (m.error) w.reject(new Error(m.error)); else w.resolve(m);
    }
  });
  const gone = () => { if (child === c) { child = null; buf = ""; } for (const [id, w] of waiting) { clearTimeout(w.timer); w.reject(new Error("The picture helper stopped.")); waiting.delete(id); } };
  c.on("exit", gone); c.on("error", gone);
  try { c.stdin.on("error", () => {}); } catch { /* fine */ }
  return c;
}
function idle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!waiting.size) stop(); }, IDLE_MS);
  idleTimer.unref?.();
}
export function stop() { clearTimeout(idleTimer); const c = child; child = null; buf = ""; try { c?.stdin.end(); } catch { /* gone */ } setTimeout(() => { try { c?.kill(); } catch { /* gone */ } }, 1500).unref?.(); }

export async function call(cmd, args = {}, { timeoutMs = 60_000 } = {}) {
  const c = await start();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error("The picture helper took too long.")); }, timeoutMs);
    waiting.set(id, { resolve, reject, timer });
    try { c.stdin.write(JSON.stringify({ id, cmd, ...args }) + "\n"); } catch (e) { waiting.delete(id); clearTimeout(timer); reject(e); }
    idle();
  });
}

// { ok, ocr, faces, lang } — or { ok: false, error } when the helper can't run here
export async function available({ fresh = false } = {}) {
  if (lastPing && !fresh) return lastPing;
  try { const r = await call("ping", {}, { timeoutMs: 30_000 }); lastPing = { ok: true, ocr: Boolean(r.ocr), faces: Boolean(r.faces), lang: r.lang ?? null }; }
  catch (e) { lastPing = { ok: false, error: e.message }; setTimeout(() => { lastPing = null; }, 10 * 60_000).unref?.(); }
  return lastPing;
}

export const analyze = (path, want = ["facts", "colors", "ocr", "faces"], { max = 1024 } = {}) => call("analyze", { path, want, max }, { timeoutMs: 90_000 });
export const thumb = async (path, box, size = 96) => Buffer.from((await call("thumb", { path, box, size })).jpeg, "base64");
export const render = (text, out, opts = {}) => call("render", { text, out, ...opts });
export const resize = (path, out, max = 480) => call("resize", { path, out, max });
// a JPEG copy for the AI: { data (base64), w, h }
export async function jpeg(path, max = 1568) { const r = await call("encode", { path, max }, { timeoutMs: 60_000 }); return { data: r.jpeg, w: r.w, h: r.h }; }

// ---- DPAPI (this Windows user only): the helper when it's there, else PowerShell (slower, same protection) ----
let ps = null;
async function fallback() { if (!ps) { const { dpapi } = await import("../../vendor/ecosystem-core/lib/credentials.mjs"); ps = dpapi({ entropy: "dayspring-people-v1" }); } return ps; }
export async function protect(buffer) {
  try { return Buffer.from((await call("protect", { b64: Buffer.from(buffer).toString("base64") })).b64, "base64"); }
  catch { return (await fallback()).protect(Buffer.from(buffer)); }
}
export async function unprotect(buffer) {
  try { return Buffer.from((await call("unprotect", { b64: Buffer.from(buffer).toString("base64") })).b64, "base64"); }
  catch (e) { if (/stopped|took too long|build|compiler|Windows/i.test(e.message)) return (await fallback()).unprotect(Buffer.from(buffer)); throw e; }
}
