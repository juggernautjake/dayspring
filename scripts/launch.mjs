// Starts, restarts and stops Dayspring without any black command windows.
//   node scripts/launch.mjs              start Dayspring (if it isn't running) and open its screen, or the guided setup
//   node scripts/launch.mjs --stop       stop Dayspring
//   node scripts/launch.mjs --open-display   just open (or bring back) the Dayspring screen (DS_SCREEN / DS_PROFILE apply)
//   node scripts/launch.mjs --restart --wait-pid <pid> [--verify] [--close-console <pid>]
//        used by Dayspring itself: waits for the old server to stop, starts the new one; with --verify (after an update)
//        it puts the previous version back if the new one doesn't start within a minute.
// The server runs hidden and writes what it says to data/logs/server.log. "Start Dayspring" (the shortcut) runs this with
// wscript, so nothing shows at all; "Start Dayspring.cmd" runs it too (its window closes by itself in a second or two).
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 4747;
const LOGS = join(DESK, "data", "logs"), LOG = join(LOGS, "server.log"), PIDFILE = join(DESK, "data", "server.pid");
const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const has = (name) => argv.includes(name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const note = (msg) => { try { mkdirSync(LOGS, { recursive: true }); appendFileSync(join(LOGS, "launcher.log"), `${new Date().toISOString()} ${msg}\n`); } catch { /* not important */ } if (process.stdout.isTTY) console.log(msg); };

// Plain node:http with no keep-alive: the launcher then ends cleanly by itself (no open connections left behind)
function request(method, path, body, timeout) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: "127.0.0.1", port: PORT, path, method, agent: false, timeout, headers: { connection: "close", ...(data ? { "content-type": "application/json", "content-length": data.length } : {}) } }, (res) => {
      let raw = ""; res.setEncoding("utf8"); res.on("data", (c) => (raw += c)); res.on("end", () => { let json = null; try { json = JSON.parse(raw); } catch { /* not json */ } resolve({ ok: res.statusCode < 400, status: res.statusCode, json }); });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve({ ok: false, status: 0, json: null }));
    if (data) req.write(data);
    req.end();
  });
}
async function up() { return (await request("GET", "/api/build", undefined, 2500)).ok; }
async function waitUp(ms) { const end = Date.now() + ms; while (Date.now() < end) { if (await up()) return true; await sleep(700); } return false; }
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
async function post(path, body = {}) { const r = await request("POST", `/api${path}`, body, 20000); return r.ok ? r.json ?? {} : null; }

// The server, hidden, with its words going to data/logs/server.log (the old log is kept once, as server.old.log).
function startServer() {
  mkdirSync(LOGS, { recursive: true });
  try { if (existsSync(LOG) && statSync(LOG).size > 5 * 1024 * 1024) renameSync(LOG, join(LOGS, "server.old.log")); } catch { /* keep writing to it */ }
  const out = openSync(LOG, "a");
  const env = { ...process.env };
  if (env.DAYSPRING_TV !== "1") env.DAYSPRING_DISPLAY = "1";
  delete env.DAYSPRING_LEGACY_CONSOLE;
  const c = spawn(process.execPath, ["--env-file-if-exists=.env", "server.mjs"], { cwd: DESK, env, detached: true, windowsHide: true, stdio: ["ignore", out, out] });
  c.unref();
  note(`server started (pid ${c.pid})`);
  return c.pid;
}

// Command windows left behind by older versions of Dayspring ("Dayspring server" windows whose server has stopped)
function closeLeftoverConsoles(extraPid) {
  if (process.platform !== "win32") return;
  const script = `$ErrorActionPreference='SilentlyContinue'; $all = Get-CimInstance Win32_Process; foreach ($p in $all | Where-Object { $_.Name -eq 'cmd.exe' -and $_.CommandLine -match '/k node --env-file-if-exists=\\.env server\\.mjs' }) { $kids = $all | Where-Object { $_.ParentProcessId -eq $p.ProcessId -and $_.Name -eq 'node.exe' }; if (-not $kids) { Stop-Process -Id $p.ProcessId -Force } }`;
  spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 20000 });
  if (extraPid) spawnSync("taskkill", ["/pid", String(extraPid), "/f"], { windowsHide: true });
}

async function openScreen() {
  const r = await post("/app/open", { screen: process.env.DS_SCREEN || undefined });
  note(r ? `open: ${JSON.stringify(r)}` : "open: no answer");
  return r;
}

async function start() {
  if (await up()) { await openScreen(); return 0; }
  // a downloaded update the owner chose to install "next time Dayspring starts"
  try {
    const updater = await import("../lib/updater.mjs");
    if (updater.installAtLaunch()) {
      note("installing the downloaded update before starting");
      const r = await updater.install({ how: "launch" }).catch((e) => { note(`update at launch failed: ${e.message}`); return null; });
      if (r?.updated) { const pid = startServer(); return (await verify(pid)) ? (await openScreen(), 0) : 1; }
    }
  } catch (e) { note(`update check at launch skipped: ${e.message}`); }
  startServer();
  if (!(await waitUp(45_000))) { note("Dayspring didn't start; see data/logs/server.log"); showError("Dayspring didn't start. The reason is in data\\logs\\server.log inside the Dayspring folder (docs\\troubleshooting.md explains the usual ones)."); return 1; }
  closeLeftoverConsoles();
  await openScreen();
  return 0;
}

// After an update: the new version must answer within a minute, or the previous version goes back.
async function verify(pid) {
  if (await waitUp(60_000)) return true;
  note("the new version didn't start: putting the previous one back");
  try { if (pid && alive(pid)) spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true }); } catch { /* gone */ }
  try {
    const updater = await import(`../lib/updater.mjs?rollback=${Date.now()}`);
    const pv = JSON.parse(readFileSync(join(DESK, "data", "updates.json"), "utf8")).pendingVerify;
    updater.rollback(pv?.backup, { reason: "The new version didn't start, so the previous one was put back." });
  } catch (e) { note(`rollback failed: ${e.message}`); return false; }
  startServer();
  return waitUp(45_000);
}

async function restart() {
  const old = Number(arg("--wait-pid"));
  if (old) { const end = Date.now() + 20_000; while (alive(old) && Date.now() < end) await sleep(300); if (alive(old)) spawnSync("taskkill", ["/pid", String(old), "/t", "/f"], { windowsHide: true }); }
  const end = Date.now() + 10_000; while ((await up()) && Date.now() < end) await sleep(300);   // the port is free
  const pid = startServer();
  const ok = has("--verify") ? await verify(pid) : await waitUp(45_000);
  closeLeftoverConsoles(Number(arg("--close-console")) || null);
  return ok ? 0 : 1;
}

async function stop() {
  if (!(await up())) { console.log("Dayspring isn't running."); return 0; }
  await post("/app/quit");
  if (await (async () => { const end = Date.now() + 10_000; while (Date.now() < end) { if (!(await up())) return true; await sleep(400); } return false; })()) { console.log("Dayspring has stopped."); return 0; }
  try { const pid = Number(readFileSync(PIDFILE, "utf8")); if (pid) spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true }); } catch { /* no pid file */ }
  console.log("Dayspring has stopped."); try { unlinkSync(PIDFILE); } catch { /* gone */ }
  return 0;
}

// A message box when started from the shortcut (no window to print to)
function showError(text) {
  if (process.stdout.isTTY || process.platform !== "win32") return console.error(text);
  spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Add-Type -AssemblyName PresentationFramework; [void][System.Windows.MessageBox]::Show(${JSON.stringify(text).replace(/\$/g, "`$")}, 'Dayspring')`], { windowsHide: true, timeout: 300_000 });
}

const code = has("--stop") ? await stop()
  : has("--restart") ? await restart()
  : has("--open-display") ? ((await waitUp(30_000)) ? ((await openScreen())?.ok === false ? 1 : 0) : (console.error("Dayspring isn't running."), 1))
  : await start();
process.exitCode = code;   // ends by itself once nothing is left to do (the server was started detached)
