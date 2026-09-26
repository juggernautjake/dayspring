// Settings → About (paths are after /api):
//   GET  /processes            Dayspring's running parts (name, PID, memory) — "Running parts"
//   POST /processes/stop       stop all of them (the same as Stop Dayspring)
//   GET  /uninstall/info       can this copy be uninstalled, what goes, where the data stays, the name to type
//   POST /uninstall { keepData, backup, confirm }   uninstall (after the typed-name check); Dayspring then stops
// Uninstall never runs on the source copy (the one releases are made from), and never by voice.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as owner from "./owner.mjs";
import * as procname from "./procname.mjs";
import { ROOT } from "./native.mjs";
import { isSource } from "./updater.mjs";

let quit = () => process.exit(0);
export function setQuit(fn) { if (typeof fn === "function") quit = fn; }

export function uninstallInfo() {
  const name = String(owner.get().name ?? "").trim();
  const pkgOk = (() => { try { return /dayspring/i.test(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).name ?? ""); } catch { return false; } })();
  const looksRight = existsSync(join(ROOT, "server.mjs")) && pkgOk;
  const source = isSource();
  const allowed = looksRight && !source && process.platform === "win32";
  return {
    allowed, installDir: ROOT, dataDir: join(ROOT, "data"),
    reason: source ? "This is the development copy of Dayspring (the one releases are made from), so it can't be uninstalled from here." : !looksRight ? "This folder doesn't look like a Dayspring install, so nothing will be removed." : process.platform !== "win32" ? "Uninstall is for Windows." : "",
    confirmWord: name || "Dayspring",
  };
}

const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
function backupData() {
  return new Promise((resolve) => {
    const docs = join(process.env.USERPROFILE ?? "", "Documents");
    const dir = existsSync(docs) ? docs : tmpdir();
    const file = join(dir, `Dayspring backup ${new Date().toISOString().slice(0, 10)}.zip`);
    const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    const done = (ok) => resolve(ok && existsSync(file) ? file : null);
    if (existsSync(tar)) execFile(tar, ["-a", "-c", "-f", file, "-C", ROOT, "data"], { windowsHide: true, timeout: 180_000 }, (e) => (e ? fallback() : done(true)));
    else fallback();
    function fallback() { execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Compress-Archive -LiteralPath '${join(ROOT, "data").replace(/'/g, "''")}' -DestinationPath '${file.replace(/'/g, "''")}' -Force`], { windowsHide: true, timeout: 300_000 }, (e) => done(!e)); }
  });
}

export async function handle(req, res, { m, p, send, readJSON }) {
  if (m === "GET" && p === "/processes") return send(res, 200, { processes: procname.list(), server: process.pid }), true;
  if (m === "POST" && p === "/processes/stop") {
    send(res, 200, { ok: true, text: "Stopping everything of Dayspring's." });
    setTimeout(() => { const l = spawn(process.execPath, [join(ROOT, "scripts", "launch.mjs"), "--stop"], { cwd: ROOT, detached: true, windowsHide: true, stdio: "ignore" }); l.unref(); }, 200);
    return true;
  }
  if (m === "GET" && p === "/uninstall/info") return send(res, 200, uninstallInfo()), true;
  if (m === "POST" && p === "/uninstall") {
    const b = await readJSON(req).catch(() => ({}));
    const info = uninstallInfo();
    if (!info.allowed) return send(res, 403, { error: info.reason }), true;
    if (norm(b.confirm) !== norm(info.confirmWord)) return send(res, 400, { error: `Type ${info.confirmWord} to confirm.` }), true;
    const keepData = b.keepData !== false;
    let backup = null;
    if (b.backup) { backup = await backupData(); if (!backup) return send(res, 500, { error: "The backup couldn't be made, so nothing was removed. Try again, or untick the backup." }), true; }
    // Lantern keeps working: only Dayspring's consent to the shared AI key goes
    try { (await import("./lantern.mjs")).useSharedKey(false); } catch { /* no shared key */ }
    const script = join(tmpdir(), `dayspring-uninstall-${Date.now()}.ps1`);
    mkdirSync(tmpdir(), { recursive: true });
    copyFileSync(join(ROOT, "scripts", "uninstall.ps1"), script);
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-InstallDir", ROOT, "-WaitPid", String(process.pid)];
    if (!keepData) args.push("-RemoveData");
    // tests: stand-in folders so nothing real is touched
    const T = process.env.DAYSPRING_UNINSTALL_TEST ? JSON.parse(process.env.DAYSPRING_UNINSTALL_TEST) : null;
    if (T) for (const [k, v] of Object.entries(T)) if (["StartMenu", "Desktop", "Startup", "LocalAppData", "RecycleTo"].includes(k)) args.push(`-${k}`, String(v));
    if (T) args.push("-NoFinalPage");
    // started through Start-Process so it outlives Dayspring: Node ends its direct children when it exits, and a
    // detached PowerShell (no console) quits before it runs anything
    const line = args.map((x) => (/[s"]/.test(x) ? `"${x.replace(/"/g, '\\"')}"` : x)).join(" ");
    const c = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Start-Process -WindowStyle Hidden -FilePath powershell.exe -ArgumentList '${line.replace(/'/g, "''")}'`], { cwd: tmpdir(), windowsHide: true, stdio: "ignore" });
    c.on("error", () => {});
    // quit once the helper is on its way (it waits for Dayspring to stop)
    await new Promise((r) => { c.on("exit", r); setTimeout(r, 10_000); });
    send(res, 200, { ok: true, keepData, backup, dataDir: info.dataDir, text: keepData ? `Uninstalling Dayspring. Your data stays in ${info.dataDir}.` : "Uninstalling Dayspring. Your data goes to the Recycle Bin." });
    setTimeout(() => quit(), 700);
    return true;
  }
  return false;
}
