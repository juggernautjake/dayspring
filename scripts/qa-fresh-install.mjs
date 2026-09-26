// Install-readiness check: does a brand-new copy of Dayspring install and work for someone who has never used it?
// It does what a new user's computer would do, in a throwaway folder, and never touches your own Dayspring:
//   1. exports the generic copy (privacy scan included) and checks it has no personal data folders
//   2. copies it to a temp folder, runs "npm install --omit=dev" and makes .env from .env.example
//   3. starts that copy on a spare port (4730-4739) with its own empty data, a pretend home folder, and devices in
//      dry-run mode (nothing is switched), then walks the guided setup in a headless browser (Claude and no-AI routes,
//      desktop and phone sizes), and checks the screen, Settings, Help and typed commands afterwards
//   4. checks every link (Help pages, walkthroughs, installers)
//   node scripts/qa-fresh-install.mjs [--from <exported folder>] [--quick] [--offline] [--keep]
//     --from     test an existing export instead of exporting again (a generic copy can test itself: --from .)
//     --quick    one onboarding walk (no-AI, desktop size) instead of four
//     --offline  skip the web-link check
//     --keep     leave the test copy and its server running afterwards (the address is printed)
// Needs Google Chrome or Microsoft Edge for the browser checks. Results: the table at the end, plus qa-report.json and
// screenshots in the test folder's qa-out\. Exit code 0 when everything passed.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, openSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const fromArg = args.includes("--from") ? resolve(args[args.indexOf("--from") + 1]) : null;
const rows = [];
const row = (area, ok, note = "") => { rows.push({ area, ok: ok === null ? null : !!ok, note: String(note) }); console.log(`${ok === null ? "SKIP" : ok ? "PASS" : "FAIL"}  ${area}${note ? " — " + String(note).split("\n")[0].slice(0, 150) : ""}`); };
const run = (cmd, argv, opts = {}) => spawnSync(cmd, argv, { encoding: "utf8", maxBuffer: 64e6, ...opts });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const QA = join(tmpdir(), `dayspring-qa-${Date.now().toString(36)}`), APP = join(QA, "app"), HOME = join(QA, "home"), OUT = join(QA, "qa-out");

// 1. Node
const [maj, min] = process.versions.node.split(".").map(Number);
row("Node.js 22.13 or newer", maj > 22 || (maj === 22 && min >= 13), process.versions.node);

// 2. export (runs the privacy scan; fails on anything personal)
let src = fromArg;
if (!src) {
  const { DEFAULT_TARGET } = await import("./privacy-scan.mjs");
  const r = run(process.execPath, [join(DESK, "scripts", "export.mjs")], { cwd: DESK });
  row("export + privacy scan", r.status === 0, (r.stdout + r.stderr).trim().split("\n").filter((l) => /privacy|FAIL|clean/i.test(l)).slice(-2).join(" · "));
  if (r.status !== 0) { console.log(r.stdout + r.stderr); await finish(1); }
  src = DEFAULT_TARGET;
}
if (!existsSync(join(src, "package.json"))) { console.error(`There's no Dayspring copy at ${src}.`); process.exit(2); }
const dataFiles = existsSync(join(src, "data")) ? readdirSync(join(src, "data")) : [];
const extra = ["backups", "dist-out", "bin", "logs", ".env", "node_modules"].filter((d) => existsSync(join(src, d)));
row("export has no personal data", fromArg ? null : dataFiles.every((f) => f === ".gitkeep") && !extra.filter((d) => d !== "node_modules").length, fromArg ? "skipped (testing an existing folder)" : `data/: ${dataFiles.join(", ") || "(empty)"}${extra.length ? " · also has: " + extra.join(", ") : ""}`);

// 3. fresh install in a temp folder
cpSync(src, APP, { recursive: true, filter: (p) => { const rel = p.slice(src.length).replace(/^[\\/]/, "").split(/[\\/]/); return !["node_modules", ".git", "backups", "dist-out", "bin", "qa-out", ".env"].includes(rel[0]) && !(rel[0] === "data" && rel[1] && rel[1] !== ".gitkeep"); } });
for (const d of ["Documents", "Downloads", "Desktop", "Pictures", "AppData/Local", "AppData/Roaming"]) mkdirSync(join(HOME, d), { recursive: true });
mkdirSync(OUT, { recursive: true });
console.log(`Test copy: ${APP}`);
const t0 = Date.now();
const npm = spawnSync("npm install --omit=dev --no-audit --no-fund", { cwd: APP, shell: true, encoding: "utf8", maxBuffer: 64e6 });   // npm is a .cmd on Windows: needs a shell
const npmWarn = (npm.stdout + npm.stderr).split("\n").filter((l) => /warn|error|not allowed|allowScripts/i.test(l) && !/deprecated/i.test(l));
row("npm install --omit=dev", npm.status === 0, `${Math.round((Date.now() - t0) / 1000)} s${npmWarn.length ? " · " + npmWarn.slice(0, 3).join(" | ") : ", no warnings"}`);
if (npm.status !== 0) { console.log(npm.stdout + npm.stderr); await finish(1); }
if (existsSync(join(APP, ".env.example"))) copyFileSync(join(APP, ".env.example"), join(APP, ".env"));
mkdirSync(join(APP, "data"), { recursive: true });
row(".env made from .env.example", existsSync(join(APP, ".env")));
// every dependency loads
const deps = Object.keys(JSON.parse(readFileSync(join(APP, "package.json"), "utf8")).dependencies ?? {});
const load = run(process.execPath, ["--input-type=module", "-e", `const bad=[];for (const d of ${JSON.stringify(deps)}) { try { await import(d); } catch (e) { bad.push(d + ": " + e.message.split("\\n")[0]); } } const ff=(await import("ffmpeg-static")).default; if (!ff || !(await import("node:fs")).existsSync(ff)) bad.push("ffmpeg-static: ffmpeg.exe missing"); console.log(JSON.stringify(bad));`], { cwd: APP });
let bad = []; try { bad = JSON.parse(load.stdout.trim().split("\n").pop()); } catch { bad = [load.stderr.trim().slice(0, 200)]; }
row("every dependency loads", !bad.length, bad.length ? bad.join(" | ") : `${deps.length} packages`);

// 4. start it, isolated
const port = await freePort();
const BASE = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), USERPROFILE: HOME, HOME, LOCALAPPDATA: join(HOME, "AppData", "Local"), APPDATA: join(HOME, "AppData", "Roaming"),
  DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_DISPLAY: "", DAYSPRING_NO_BROWSER: "1" };
let server = null;
async function start() {
  const log = openSync(join(QA, "server.log"), "a");
  server = spawn(process.execPath, ["--env-file-if-exists=.env", "server.mjs"], { cwd: APP, env, stdio: ["ignore", log, log], windowsHide: true });
  for (let i = 0; i < 60; i++) { await sleep(500); try { if ((await fetch(`${BASE}/api/setup/state`)).ok) return true; } catch {} if (server.exitCode !== null) break; }
  return false;
}
async function stop() { if (server && server.exitCode === null) { server.kill(); for (let i = 0; i < 20 && server.exitCode === null; i++) await sleep(250); } }
async function resetData() { await stop(); for (const f of readdirSync(join(APP, "data"))) if (f !== ".gitkeep") rmSync(join(APP, "data", f), { recursive: true, force: true }); return start(); }
const up = await start();
row(`server starts (port ${port})`, up, up ? BASE : readFileSync(join(QA, "server.log"), "utf8").slice(-400));
if (!up) await finish(1);
const first = await fetch(`${BASE}/`, { redirect: "manual" });
row("a new copy opens the guided setup", /welcome/.test(first.headers.get("location") ?? "") || /welcome/.test(await first.text().catch(() => "")), first.headers.get("location") ?? `status ${first.status}`);

// 5. browser checks
const qaEnv = { ...process.env, QA_BASE: BASE, QA_OUT: OUT, QA_APP: APP, QA_HOME: HOME };
const node = (script, argv = []) => run(process.execPath, [join(APP, "scripts", "qa", script), ...argv], { cwd: APP, env: qaEnv, stdio: ["ignore", "pipe", "pipe"] });
const summarize = (r) => { const out = (r.stdout + r.stderr).split("\n"); const fails = out.filter((l) => /^FAIL/.test(l)); return { ok: r.status === 0, note: fails.length ? fails.slice(0, 3).map((l) => l.replace(/^FAIL\s+/, "")).join(" | ") : `${out.filter((l) => /^PASS/.test(l)).length} checks passed` }; };
const walks = flag("--quick") ? [["none", "1280x720"]] : [["claude", "1280x720"], ["none", "1280x720"], ["claude", "390x844"], ["none", "390x844"]];
for (const [i, [route, size]] of walks.entries()) {
  if (i) await resetData();
  const s = summarize(node("onboarding.cjs", [route, size]));
  row(`guided setup: ${route === "none" ? "no AI" : "Claude"}, ${size}`, s.ok, s.note);
}
// after-setup checks run on the no-AI setup (the last walk, or redo it)
if (walks.at(-1)[0] !== "none") { await resetData(); node("onboarding.cjs", ["none", "1280x720"]); }
const after = node("after-setup.cjs"); const as = summarize(after);
row("after setup: screen, Settings, Help, commands", as.ok, as.note);
writeFileSync(join(OUT, "after-setup.txt"), after.stdout + after.stderr);
const srvErr = readFileSync(join(QA, "server.log"), "utf8").split("\n").filter((l) => /Error:|TypeError|ReferenceError|Unhandled|at .*\.mjs:\d+/.test(l));
row("no server errors", !srvErr.length, srvErr.slice(0, 3).join(" | ") || "none");

// 6. links
const links = node("links.mjs", [APP, ...(flag("--offline") ? ["--offline"] : [])]);
row(`links${flag("--offline") ? " (Help only)" : ""}`, links.status === 0, (links.stdout.split("\n").filter((l) => /BROKEN|checked/.test(l)).slice(0, 4).join(" · ")));

await finish(rows.some((r) => r.ok === false) ? 1 : 0);

async function finish(code) {
  const failed = rows.filter((r) => r.ok === false).length;
  console.log(`\n${"-".repeat(72)}\n${failed ? `${failed} FAILED` : "ALL PASSED"}: ${rows.filter((r) => r.ok).length} passed, ${failed} failed, ${rows.filter((r) => r.ok === null).length} skipped`);
  for (const r of rows) console.log(`  ${r.ok === null ? "SKIP" : r.ok ? "PASS" : "FAIL"}  ${r.area}`);
  if (existsSync(QA)) writeFileSync(join(QA, "qa-report.json"), JSON.stringify({ when: new Date().toISOString(), rows }, null, 2));
  if (flag("--keep")) { console.log(`\nKept: ${APP}\nRunning at ${BASE} (stop it with Ctrl+C here).`); if (server) await new Promise(() => {}); }
  await stop();
  if (existsSync(QA) && !code) rmSync(QA, { recursive: true, force: true });
  else if (existsSync(QA)) console.log(`\nDetails (screenshots, server.log, qa-report.json): ${QA}`);
  process.exit(code);
}
function freePort() {
  const tryPort = (p) => new Promise((ok) => { const s = createServer().once("error", () => ok(false)).once("listening", () => s.close(() => ok(true))).listen(p, "127.0.0.1"); });
  return (async () => { for (let p = 4730; p <= 4739; p++) if (await tryPort(p)) return p; throw new Error("Ports 4730-4739 are all busy."); })();
}
