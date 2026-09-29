// Is Ollama really there? Checked live, never taken from saved settings: "AI_PROVIDER=ollama" in .env, a model list from
// last week or a warm-up that once worked prove nothing (Ollama may have been uninstalled since). Three answers:
//   "not-installed"   no ollama.exe anywhere and nothing answers at the address
//   "not-running"     ollama.exe is on this computer, but its server doesn't answer (offer "Start Ollama")
//   "running"         the server answered /api/version (a remote address, like a home server, only counts when it answers;
//                     when it doesn't: "unreachable")
// Results are kept for 10 seconds at most. Requests to the model ask usable() first: after a failure, Ollama isn't tried
// again for a minute (answers come from the fallback at once), unless Settings checks sooner.
//   status({ force }) → { state, running, installed, exe, version, url, remote, checkedAt, error }
//   usable() → true | false (fast)      noteFailure(err) / noteSuccess()      start() → launch the installed app, hidden
//   (tests: DAYSPRING_OLLAMA_EXE = a path that counts as ollama.exe; DAYSPRING_OLLAMA_NO_SYSTEM = 1 looks nowhere else)
import { existsSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import * as llm from "../llm.mjs";

const TTL = 10_000, BACKOFF = 60_000;
let cache = null, cacheAt = 0, downUntil = 0, inflight = null, lastSeen = null;
const isLocalUrl = (u) => { try { return /^(127\.\d+\.\d+\.\d+|localhost|\[?::1\]?|0\.0\.0\.0)$/i.test(new URL(u).hostname); } catch { return true; } };
const run = (cmd, args, ms = 2500) => new Promise((res) => execFile(cmd, args, { windowsHide: true, timeout: ms, encoding: "utf8" }, (e, out) => res(e ? "" : String(out ?? ""))));

// where ollama.exe is (or null): the test override, the standard places, the PATH, the uninstall entry
export async function findExe() {
  const forced = process.env.DAYSPRING_OLLAMA_EXE;
  if (forced) return existsSync(forced) ? forced : null;
  if (process.env.DAYSPRING_OLLAMA_NO_SYSTEM === "1" || process.platform !== "win32") return null;
  const L = process.env.LOCALAPPDATA ?? "", P = process.env.ProgramFiles ?? "C:\\Program Files";
  for (const p of [join(L, "Programs", "Ollama", "ollama.exe"), join(P, "Ollama", "ollama.exe")]) if (p && existsSync(p)) return p;
  const where = (await run("where.exe", ["ollama"])).split(/\r?\n/).map((s) => s.trim()).find((s) => /ollama(\.exe)?$/i.test(s) && existsSync(s));
  if (where) return where;
  // the uninstall entry (the installer's), and only if the folder it names still has the program
  for (const hive of ["HKCU", "HKLM"]) {
    const out = await run("reg.exe", ["query", `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall`, "/s", "/f", "Ollama", "/d"], 3000);
    const loc = /InstallLocation\s+REG_SZ\s+(.+)/i.exec(out)?.[1]?.trim();
    if (loc && existsSync(join(loc, "ollama.exe"))) return join(loc, "ollama.exe");
  }
  return null;
}

// GET /api/version, 1.5 s at most; a connection the server had already closed (ECONNRESET on a reused socket) is tried
// once more on a fresh one before it counts as "not answering"
async function probeVersion(url) {
  for (let i = 0; i < 2; i++) {
    try { const r = await fetch(url + "/api/version", { signal: AbortSignal.timeout(1500) }); if (!r.ok) return { ok: false, error: `answered ${r.status}` }; const j = await r.json().catch(() => ({})); return { ok: true, version: j.version ?? null }; }
    catch (e) { const code = e?.cause?.code ?? e?.name ?? e?.message; if (i === 0 && /ECONNRESET|UND_ERR_SOCKET|other side closed/i.test(String(code) + String(e?.cause?.message ?? ""))) continue; return { ok: false, error: code }; }
  }
  return { ok: false, error: "no answer" };
}
export async function status({ force = false } = {}) {
  if (!force && cache && Date.now() - cacheAt < TTL && cache.url === llm.ollamaUrl()) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const url = llm.ollamaUrl(), remote = !isLocalUrl(url);
    const [probe, exe] = await Promise.all([
      probeVersion(url),
      remote ? Promise.resolve(null) : findExe().catch(() => null),
    ]);
    const state = probe.ok ? "running" : remote ? "unreachable" : exe ? "not-running" : "not-installed";
    cache = { state, running: probe.ok, installed: Boolean(exe) || (probe.ok && !remote), exe: exe ?? null, version: probe.version ?? null, url, remote, checkedAt: new Date().toISOString(), error: probe.ok ? null : probe.error ?? null };
    cacheAt = Date.now(); lastSeen = cache;
    if (probe.ok) downUntil = 0; else downUntil = Date.now() + BACKOFF;
    return cache;
  })().finally(() => { inflight = null; });
  return inflight;
}
// Worth asking Ollama right now? (false for a minute after it failed; a fresh check then decides)
export function usable() { return Date.now() >= downUntil; }
export const last = () => lastSeen;   // the last live answer (for what to say while it isn't asked again)
export function noteFailure(err) { if (err?.code === "EOLLAMA_DOWN" || /isn't running|ECONNREFUSED|fetch failed/i.test(String(err?.message))) { downUntil = Date.now() + BACKOFF; cache = null; } }
export function noteSuccess() { downUntil = 0; }
export const _reset = () => { cache = null; cacheAt = 0; downUntil = 0; lastSeen = null; };

// The words for it (Settings and the spoken note)
export function describe(s) {
  if (!s) return "";
  if (s.state === "running") return `Ollama is running${s.version ? `, version ${s.version}` : ""}${s.remote ? ` at ${s.url}` : ""}.`;
  if (s.state === "not-running") return "Ollama is installed but not running.";
  if (s.state === "unreachable") return `The Ollama server at ${s.url} isn't answering.`;
  return "Ollama isn't installed on this computer.";
}

// Start the installed Ollama (only when he clicks "Start Ollama"): its tray app if it's there, else "ollama serve",
// hidden, on its own (it keeps running after Dayspring stops, as it would if he'd started it himself)
export async function start() {
  const exe = await findExe();
  if (!exe) return { ok: false, error: "Ollama isn't installed on this computer." };
  const app = join(dirname(exe), "ollama app.exe");
  const [cmd, args] = existsSync(app) ? [app, []] : [exe, ["serve"]];
  try { spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).unref(); } catch (e) { return { ok: false, error: e.message }; }
  const end = Date.now() + 15_000;
  while (Date.now() < end) { await new Promise((r) => setTimeout(r, 700)); const s = await status({ force: true }); if (s.running) return { ok: true, status: s }; }
  return { ok: false, error: "Ollama was started but isn't answering yet. Give it a few more seconds.", status: await status({ force: true }) };
}
