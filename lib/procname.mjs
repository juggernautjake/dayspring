// Task Manager shows Dayspring as "Dayspring": bin\Dayspring.exe (Dayspring's name, version and icon; scripts/host.cs)
// starts the server as bin\Dayspring Server.exe (a copy of this computer's node.exe) and they end together. Helpers get clear names too ("Dayspring Speech.exe",
// "Dayspring Notifications.exe", "Dayspring Keep Awake.exe", "Dayspring Audio Capture.exe").
//   serverExe()        the exe to start the server with (bin\Dayspring.exe when it's ready, else node.exe)
//   ensureServerExe()  make or refresh bin\Dayspring.exe (a new Node version, or missing); never while it's running
//   list()             Dayspring's own processes: { name, pid, memoryMB, kind }
//   stopAll()          end every Dayspring process (by exe path, or a Dayspring browser profile), never anything else
import { execFile, execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BIN, ROOT, build } from "./native.mjs";

export const SERVER_EXE = join(BIN, "Dayspring.exe");            // "Dayspring" in Task Manager (scripts/host.cs)
export const SERVER_NODE = join(BIN, "Dayspring Server.exe");    // this computer's node.exe, copied under Dayspring's name
const MARK = join(BIN, "Dayspring Server.json");

export function serverExe() {
  if (process.platform !== "win32" || process.env.DAYSPRING_PLAIN_NODE) return process.execPath;
  try { const m = JSON.parse(readFileSync(MARK, "utf8")); if (existsSync(SERVER_EXE) && existsSync(SERVER_NODE) && m.node === process.version) return SERVER_EXE; } catch { /* not made yet */ }
  return process.execPath;
}

// Make (or refresh, after a new Node or a Dayspring update) bin\Dayspring.exe and bin\Dayspring Server.exe. Never while
// Dayspring runs. If building the named starter fails, plain node.exe is used and the reason is logged.
export async function ensureServerExe({ log = () => {} } = {}) {
  if (process.platform !== "win32" || process.env.DAYSPRING_PLAIN_NODE) return { exe: process.execPath, named: false };
  let mark = null; try { mark = JSON.parse(readFileSync(MARK, "utf8")); } catch { /* first time */ }
  const current = existsSync(SERVER_NODE) && existsSync(SERVER_EXE) && mark?.node === process.version;
  if (running().some((x) => x.kind === "server")) return { exe: current ? SERVER_EXE : process.execPath, named: current, busy: true };
  try {
    mkdirSync(BIN, { recursive: true });
    if (!current || !existsSync(SERVER_NODE)) {
      const tmp = SERVER_NODE + ".new";
      copyFileSync(process.execPath, tmp);
      if (existsSync(SERVER_NODE)) rmSync(SERVER_NODE, { force: true });
      renameSync(tmp, SERVER_NODE);
    }
    await build("host");                 // rebuilt when its source or Dayspring's version changes
    writeFileSync(MARK, JSON.stringify({ node: process.version, at: new Date().toISOString() }));
    return { exe: SERVER_EXE, named: true };
  } catch (e) { log(`Dayspring.exe couldn't be made, so the server runs as node.exe: ${e.message}`); return { exe: process.execPath, named: false, error: e.message }; }
}

// Dayspring's own processes: anything started from this Dayspring folder, plus browser windows using a Dayspring profile.
// (with DS_PROFILE, e.g. a test copy: only that profile's windows)
const PROFILE_RX = process.env.DS_PROFILE
  ? `user-data-dir="?[^"]*\\\\${String(process.env.DS_PROFILE).replace(/[^\w-]/g, "")}(-[a-z]+)?"?(\\s|$)`
  : 'user-data-dir="?[^"]*\\\\Dayspring(Display|TV|Media|Search)(-[a-z]+)?';
function psJson(script) {
  try { const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, encoding: "utf8", timeout: 20_000 }); const j = JSON.parse(out.trim() || "[]"); return Array.isArray(j) ? j : [j]; } catch { return []; }
}
function running() {
  if (process.platform !== "win32") return [];
  const root = ROOT.replace(/'/g, "''");
  const rows = psJson(`$root='${root}'; @(Get-CimInstance Win32_Process | Where-Object { ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) -or ($_.CommandLine -and $_.CommandLine -match '${PROFILE_RX}') -or ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'server\\.mjs' -and $_.CommandLine -notmatch 'next') } | ForEach-Object { [pscustomobject]@{ name = $_.Name; pid = $_.ProcessId; mem = [math]::Round($_.WorkingSetSize / 1MB, 1); path = $_.ExecutablePath; cmd = $_.CommandLine } }) | ConvertTo-Json -Compress -Depth 3`);
  const here = ROOT.toLowerCase();
  return rows.filter((r) => {
    // a node.exe server.mjs counts only when it's this Dayspring folder's (its pid file)
    if (r.name === "node.exe" && !(r.path ?? "").toLowerCase().startsWith(here)) { try { return Number(readFileSync(join(ROOT, "data", "server.pid"), "utf8")) === r.pid; } catch { return false; } }
    return true;
  }).map((r) => ({ name: r.name, pid: r.pid, memoryMB: r.mem, kind: /^Dayspring( Server)?\.exe$/i.test(r.name) || (r.name === "node.exe") ? "server" : /chrome|msedge|brave|firefox|vivaldi/i.test(r.name) ? "browser window" : "helper" }));
}
export const list = () => running();

// End every Dayspring process. Never touches other node.exe or browser windows (matched by path, pid file or profile).
export function stopAll({ except = [] } = {}) {
  const procs = running().filter((p) => !except.includes(p.pid));
  for (const p of procs) { try { execFileSync("taskkill", ["/pid", String(p.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" }); } catch { /* already gone */ } }
  return procs;
}
