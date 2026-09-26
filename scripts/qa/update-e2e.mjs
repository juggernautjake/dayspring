// End-to-end test of updates, against a fake GitHub on this computer (it never talks to the real one).
//   node scripts/qa/update-e2e.mjs [--keep] [--old <folder with Dayspring 1.0.0>]
// Cases: install now (data kept, backups made, the new version confirms it started) · a failed download (nothing
// changes) · a new version that won't start (the launcher puts the old one back) · "next time I open Dayspring" ·
// "when I'm not using it" (idle) · and, with --old, Dayspring 1.0.0's own updater installing this version.
// Servers run hidden on spare ports; browser launches are written to a log instead of opening anything.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const KEEP = argv.includes("--keep");
const ONLY = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
const want = (name) => !ONLY || ONLY.split(",").includes(name);
const OLD = argv.includes("--old") ? argv[argv.indexOf("--old") + 1] : null;
const BASE = mkdtempSync(join(tmpdir(), "ds-update-e2e-"));
const TAR = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); };

// ---- the program to update: this Dayspring, exported (no personal data) --------------------------------------------------
const SRC = join(BASE, "src");
const ex = spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), SRC], { encoding: "utf8" });
if (ex.status !== 0) { console.error(ex.stdout, ex.stderr); process.exit(1); }
const NM = join(DESK, "node_modules");
function makeVersion(name, version, tweak) {
  const dir = join(BASE, "rel-" + name);
  cpSync(SRC, dir, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(p.slice(SRC.length)) });
  const pj = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")); pj.version = version; writeFileSync(join(dir, "package.json"), JSON.stringify(pj, null, 2));
  tweak?.(dir);
  return dir;
}
function zip(dir, out) {
  const entries = readdirSync(dir).filter((e) => !["data", "node_modules", ".env"].includes(e));
  const r = spawnSync(TAR, ["-a", "-c", "-f", out, "-C", dir, ...entries], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("zip: " + r.stderr);
  return out;
}
const A = makeVersion("A", "1.0.1");
const B = makeVersion("B", "1.0.2", (d) => writeFileSync(join(d, "NEW-MARKER.txt"), "1.0.2"));
const BAD = makeVersion("bad", "1.0.3", (d) => writeFileSync(join(d, "server.mjs"), 'throw new Error("this version is broken on purpose");\n'));
const ZIPS = { B: zip(B, join(BASE, "B.zip")), bad: zip(BAD, join(BASE, "bad.zip")), A: zip(A, join(BASE, "A.zip")) };

// ---- a fake GitHub -----------------------------------------------------------------------------------------------------
let latest = "B", failDownload = false;
const VERS = { A: "1.0.1", B: "1.0.2", bad: "1.0.3" };
const gh = createServer((req, res) => {
  const port = gh.address().port;
  if (req.url.startsWith("/repos/test/dayspring/releases/latest")) {
    const size = statSync(ZIPS[latest]).size;
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ tag_name: "v" + VERS[latest], name: `Dayspring ${VERS[latest]}`, body: `## What's new\n- Test release ${VERS[latest]}\n- **Bold** item`, html_url: "https://example.invalid/r", published_at: new Date().toISOString(), assets: [{ name: "Dayspring.zip", size, browser_download_url: `http://127.0.0.1:${port}/dl/${latest}.zip` }] }));
  }
  const m = /^\/dl\/(\w+)\.zip$/.exec(req.url);
  if (m && ZIPS[m[1]]) { if (failDownload) { res.writeHead(500); return res.end("nope"); } res.writeHead(200, { "content-type": "application/zip" }); return res.end(readFileSync(ZIPS[m[1]])); }
  res.writeHead(404); res.end();
});
await new Promise((r) => gh.listen(0, "127.0.0.1", r));
const API = `http://127.0.0.1:${gh.address().port}`;

// ---- helpers -----------------------------------------------------------------------------------------------------------
let portN = 4793;
function install(from, label, { seed = true } = {}) {
  const dir = join(BASE, "app-" + label);
  cpSync(from, dir, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(p.slice(from.length)) });
  spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(dir, "node_modules"), NM], { windowsHide: true });
  if (seed) {
    mkdirSync(join(dir, "data"), { recursive: true }); mkdirSync(join(dir, "bin"), { recursive: true });
    writeFileSync(join(dir, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary" }));
    writeFileSync(join(dir, "data", "keepme.json"), JSON.stringify({ precious: 42 }));
    writeFileSync(join(dir, ".env"), "TEST_SECRET_MARKER=keep\n");
    writeFileSync(join(dir, "bin", "helper.txt"), "downloaded helper");
  }
  return dir;
}
const envFor = (port, extra = {}) => ({ ...process.env, PORT: String(port), DAYSPRING_UPDATE_API: API, DAYSPRING_UPDATE_REPO: "test/dayspring", DS_PROFILE: "DayspringQA", DS_LAUNCH_LOG: join(BASE, `launch-${port}.log`), DAYSPRING_TV: "", ...extra });
const ver = (dir) => JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
const dataKept = (dir) => { try { return JSON.parse(readFileSync(join(dir, "data", "keepme.json"), "utf8")).precious === 42 && readFileSync(join(dir, ".env"), "utf8").includes("TEST_SECRET_MARKER=keep"); } catch { return false; } };
const hist = (dir) => { try { return JSON.parse(readFileSync(join(dir, "data", "updates.json"), "utf8")).history ?? []; } catch { return []; } };
async function up(port) { try { return (await fetch(`http://127.0.0.1:${port}/api/build`, { signal: AbortSignal.timeout(2500) })).ok; } catch { return false; } }
async function waitUp(port, ms) { const end = Date.now() + ms; while (Date.now() < end) { if (await up(port)) return true; await sleep(700); } return false; }
async function stop(dir, port) { await runAsync(["scripts/launch.mjs", "--stop"], { cwd: dir, env: envFor(port) }); }
// children run asynchronously: the fake GitHub lives in this process and must keep answering meanwhile
function runAsync(args, opts) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, args, { ...opts, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = ""; c.stdout.on("data", (d) => (stdout += d)); c.stderr.on("data", (d) => (stderr += d));
    const t = setTimeout(() => { try { c.kill(); } catch { /* gone */ } }, 180000);
    c.on("close", (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
  });
}
const runIn = (dir, code, env) => runAsync(["--input-type=module", "-e", code], { cwd: dir, env });
const launch = (dir, args, env) => runAsync(["scripts/launch.mjs", ...args], { cwd: dir, env });
const listBackups = (dir) => { try { return readdirSync(join(dir, "backups")); } catch { return []; } };

try {
  // 1. install now → the new version starts and confirms
  if (want("now")) { latest = "B"; failDownload = false; const port = portN++; const dir = install(A, "now");
    const r = await runIn(dir, `import * as u from "./lib/updater.mjs"; const x = await u.install({ how: "now" }); console.log(JSON.stringify(x));`, envFor(port));
    check("install now: files replaced", ver(dir) === "1.0.2" && existsSync(join(dir, "NEW-MARKER.txt")), r.stderr.trim().slice(0, 200));
    check("install now: data and .env kept", dataKept(dir));
    check("install now: helpers (bin) kept", existsSync(join(dir, "bin", "helper.txt")));
    check("install now: backups made", listBackups(dir).some((d) => d.startsWith("data-1.0.1")) && listBackups(dir).some((d) => d.startsWith("code-1.0.1")));
    const l = await launch(dir, ["--restart", "--verify"], envFor(port));
    check("install now: new version starts", await up(port), l.stdout?.trim().slice(-200));
    await sleep(1500);
    const h = hist(dir).at(-1);
    check("install now: history says it worked", h?.ok === true && h.to === "1.0.2", JSON.stringify(h ?? {}).slice(0, 160));
    const st = await (await fetch(`http://127.0.0.1:${port}/api/update/status`)).json().catch(() => ({}));
    check("install now: status shows 1.0.2 with history", st.version === "1.0.2" && (st.history ?? []).length >= 1);
    await stop(dir, port); }

  // 2. a failed download changes nothing
  if (want("faildl")) { latest = "B"; failDownload = true; const port = portN++; const dir = install(A, "faildl");
    const r = await runIn(dir, `import * as u from "./lib/updater.mjs"; try { await u.install({ how: "now" }); console.log("no error?"); } catch (e) { console.log("ERR " + e.message); }`, envFor(port));
    check("failed download: reported", /ERR/.test(r.stdout), r.stdout.trim().slice(0, 160));
    check("failed download: nothing changed", ver(dir) === "1.0.1" && !existsSync(join(dir, "NEW-MARKER.txt")) && dataKept(dir));
    failDownload = false; }

  // 3. a new version that doesn't start → the old one comes back
  if (want("rollback")) { latest = "bad"; const port = portN++; const dir = install(A, "rollback");
    await runIn(dir, `import * as u from "./lib/updater.mjs"; await u.install({ how: "now" });`, envFor(port));
    check("broken version: was installed", ver(dir) === "1.0.3");
    const t0 = Date.now(); const l = await launch(dir, ["--restart", "--verify"], envFor(port));
    check("broken version: rolled back to 1.0.1", ver(dir) === "1.0.1" && !existsSync(join(dir, "NEW-MARKER.txt")), `${Math.round((Date.now() - t0) / 1000)} s; exit ${l.status}`);
    check("broken version: old version running again", await waitUp(port, 30000));
    const h = hist(dir).at(-1);
    check("broken version: history says it didn't work", h?.ok === false, JSON.stringify(h ?? {}).slice(0, 160));
    check("broken version: data and .env kept", dataKept(dir));
    await stop(dir, port); }

  // 4. "next time I open Dayspring"
  if (want("launch")) { latest = "B"; const port = portN++; const dir = install(A, "launch");
    const r = await runIn(dir, `import * as u from "./lib/updater.mjs"; console.log(JSON.stringify(await u.choose("launch")));`, envFor(port));
    check("next launch: downloaded, not installed yet", ver(dir) === "1.0.1" && existsSync(join(dir, "updates", "1.0.2")), r.stdout.trim().slice(0, 160));
    const l = await launch(dir, [], envFor(port));
    check("next launch: installed when Dayspring started", ver(dir) === "1.0.2" && (await up(port)), l.stdout?.trim().slice(-160));
    await sleep(1500);
    check("next launch: history ok", hist(dir).at(-1)?.ok === true);
    check("next launch: data kept", dataKept(dir));
    await stop(dir, port); }

  // 5. "when I'm not using it" (idle): the server installs it itself and restarts
  if (want("idle")) { latest = "B"; const port = portN++; const dir = install(A, "idle");
    writeFileSync(join(dir, "data", "updates.json"), JSON.stringify({ when: "idle", history: [] }));
    const env = envFor(port, { DAYSPRING_UPDATE_FIRST_MS: "1500", DAYSPRING_UPDATE_IDLE_MIN: "0.05", DAYSPRING_UPDATE_IDLE_TICK_MS: "2500" });
    await launch(dir, [], env);
    let v = null; const end = Date.now() + 180000;
    while (Date.now() < end) { try { v = (await (await fetch(`http://127.0.0.1:${port}/api/update/status`, { signal: AbortSignal.timeout(2500) })).json()).version; } catch { /* restarting */ } if (v === "1.0.2") break; await sleep(1500); }
    const why = v === "1.0.2" ? "" : (() => { try { return readFileSync(join(dir, "data", "updates.json"), "utf8").slice(0, 300) + " | " + readFileSync(join(dir, "data", "logs", "server.log"), "utf8").split(/\r?\n/).slice(-6).join(" / "); } catch (e) { return e.message; } })();
    check("idle: installed and restarted on its own", v === "1.0.2" && ver(dir) === "1.0.2", why);
    await sleep(1500);
    { let h = null; for (let i = 0; i < 10; i++) { h = hist(dir).at(-1); if (h?.ok === true) break; await sleep(1000); } check("idle: history ok", h?.ok === true && h?.how === "idle", JSON.stringify(h ?? {}).slice(0, 200)); }
    check("idle: data kept", dataKept(dir));
    await stop(dir, port); }

  // 6. Dayspring 1.0.0's own updater ("Update Dayspring.cmd") installing this version
  if (OLD && want("old")) {
    latest = "A"; const port = portN++; const dir = install(OLD, "from-1.0.0");
    // 1.0.0 runs "tar" from PATH: on Windows that is System32's (a Git Bash PATH would put GNU tar first)
    const winEnv = { ...envFor(port), PATH: join(process.env.SystemRoot ?? "C:\\Windows", "System32") + ";" + (process.env.PATH ?? "") };
    const r = await runAsync(["scripts/update.mjs", "--yes"], { cwd: dir, env: winEnv });
    check("1.0.0 → 1.0.1 with the old updater", ver(dir) === "1.0.1", (r.stdout + r.stderr).trim().split(/\r?\n/).slice(-2).join(" | "));
    check("1.0.0 → 1.0.1: data and .env kept", dataKept(dir));
    const binGone = !existsSync(join(dir, "bin", "helper.txt"));
    const l = await launch(dir, [], envFor(port));
    check("1.0.0 → 1.0.1: new version starts", await up(port), l.stdout?.trim().slice(-160));
    check("1.0.0 → 1.0.1: downloaded helpers put back", existsSync(join(dir, "bin", "helper.txt")), binGone ? "the old updater had removed bin/" : "bin/ was never removed");
    check("1.0.0 → 1.0.1: the new launcher files arrived", existsSync(join(dir, "Start Dayspring.vbs")) && existsSync(join(dir, "scripts", "launch.mjs")));
    await stop(dir, port);
  }
} finally {
  gh.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? "; failed: " + failed.map((f) => f.name).join("; ") : ""}`);
  writeFileSync(join(BASE, "update-e2e.json"), JSON.stringify(results, null, 2));
  // the node_modules links point at the real ones: remove the links first (rmdir on a junction removes only the link)
  for (const d of readdirSync(BASE)) if (d.startsWith("app-") && existsSync(join(BASE, d, "node_modules"))) spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(BASE, d, "node_modules")], { windowsHide: true });
  if (!KEEP) try { rmSync(BASE, { recursive: true, force: true }); } catch { console.log("(some test files are still in use: " + BASE + ")"); }
  else console.log("Test files kept in " + BASE);
  process.exit(failed.length ? 1 : 0);
}
