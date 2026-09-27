// 1.2.0: Dayspring shows as "Dayspring" in Task Manager, Stop Dayspring ends all of Dayspring and nothing else, and
// Uninstall (both ways) on a THROWAWAY copy with stand-in shortcut and profile folders. Never touches the real install,
// the real shortcuts or registry, or any other program (other node.exe servers, other browser windows).
//   node scripts/qa/processes-uninstall.mjs [--keep]
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" ? "  (" + got + ")" : ""}`); };
const ps = (cmd) => { try { return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], { windowsHide: true, encoding: "utf8", timeout: 30_000 }).trim(); } catch (e) { return String(e.stdout ?? ""); } };
const underDir = (dir) => { const out = ps(`$d='${dir.replace(/'/g, "''")}'; @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($d, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.Name + ':' + $_.ProcessId }) -join ','`); return out ? out.split(",").filter(Boolean) : []; };
const otherNodes = () => ps(`@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'next|4747|server\\.mjs' } | ForEach-Object { $_.ProcessId }) -join ','`).split(",").filter(Boolean);

function makeCopy(tag) {
  const TMP = mkdtempSync(join(tmpdir(), `ds-${tag}-`)), APP = join(TMP, "Dayspring");
  spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
  spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
  mkdirSync(join(APP, "data"), { recursive: true });
  writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Test Person", setupDone: true, display: "primary" }));
  writeFileSync(join(APP, "data", "notes.txt"), "keep me");
  return { TMP, APP };
}
const baseEnv = (port, extra = {}) => ({ ...process.env, PORT: String(port), DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DS_LAUNCH_LOG: join(tmpdir(), `ds-launch-${port}.log`), DS_PROFILE: "DayspringQA", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_NO_ECO: "1", DAYSPRING_NO_KEEPAWAKE: "1", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", ELEVENLABS_API_KEY: "", AI_PROVIDER: "", DAYSPRING_REMINDER_CHANNEL: "off", ...extra });
const up = async (port) => { try { return (await fetch(`http://127.0.0.1:${port}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
// the preferred port, or the next free one: another program on this computer may already be using it
const taken = (p) => new Promise((r) => { const c = connect(p, "127.0.0.1").once("connect", () => { c.destroy(); r(true); }).once("error", () => r(false)); c.setTimeout(1500, () => { c.destroy(); r(true); }); });
const freePort = async (want) => { for (let p = want; p < want + 50; p++) if (!(await taken(p))) return p; throw new Error("no free port near " + want); };
const others0 = otherNodes();

// ---------------- 1. "Dayspring" in Task Manager, and Stop Dayspring ----------------
{
  const { TMP, APP } = makeCopy("proc"), PORT = await freePort(4791);
  const r = spawnSync(process.execPath, [join(APP, "scripts", "launch.mjs")], { cwd: APP, env: baseEnv(PORT), windowsHide: true, encoding: "utf8", timeout: 240_000 });
  for (let i = 0; i < 60 && !(await up(PORT)); i++) await sleep(500);
  const exe = join(APP, "bin", "Dayspring.exe");
  const running = underDir(APP);
  check("the server runs as bin\\Dayspring.exe", existsSync(exe) && running.some((x) => /^Dayspring\.exe:/i.test(x)), `${running.join(" ")} ${r.stderr?.slice(0, 200) ?? ""}`);
  const desc = ps(`(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.FileDescription`);
  check("Task Manager's name for it (FileDescription) is Dayspring", desc === "Dayspring", desc);
  const ver = ps(`(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.ProductVersion`);
  const pkgVer = JSON.parse(readFileSync(join(APP, "package.json"), "utf8")).version;
  check("its version is Dayspring's", ver.startsWith(pkgVer), `${ver} vs ${pkgVer}`);
  check("the server itself runs as Dayspring Server.exe under it", running.some((x) => /^Dayspring Server.exe:/i.test(x)) && !running.some((x) => /^node.exe:/i.test(x)), running.join(" "));
  const listed = await fetch(`http://127.0.0.1:${PORT}/api/processes`).then((x) => x.json()).catch(() => ({}));
  check("Settings → About lists its running parts", (listed.processes ?? []).some((p) => p.kind === "server"), JSON.stringify(listed.processes ?? []).slice(0, 200));
  spawnSync(process.execPath, [join(APP, "scripts", "launch.mjs"), "--stop"], { cwd: APP, env: baseEnv(PORT), windowsHide: true, timeout: 60_000 });
  await sleep(1500);
  check("Stop Dayspring: nothing of this Dayspring is left", underDir(APP).length === 0 && !(await up(PORT)), underDir(APP).join(" "));
  const survivors = otherNodes();
  check("Stop Dayspring: other Node programs keep running", others0.every((pid) => survivors.includes(pid)), `${others0.length} before, ${others0.filter((p) => survivors.includes(p)).length} still running`);
  if (!process.argv.includes("--keep")) { spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true }); rmSync(TMP, { recursive: true, force: true }); }
}

// ---------------- 2. Uninstall, both ways, on throwaway copies ----------------
for (const way of ["keep", "remove"]) {
  const { TMP, APP } = makeCopy(`un-${way}`), PORT = await freePort(way === "keep" ? 4789 : 4788);
  const fake = { StartMenu: join(TMP, "StartMenu", "Dayspring"), Desktop: join(TMP, "Desktop"), Startup: join(TMP, "Startup"), LocalAppData: join(TMP, "LocalAppData"), RecycleTo: join(TMP, "Recycle") };
  for (const d of [fake.StartMenu, fake.Desktop, fake.Startup, join(fake.LocalAppData, "DayspringDisplay"), join(fake.LocalAppData, "Ecosystem", "apps"), join(fake.LocalAppData, "SomethingElse")]) mkdirSync(d, { recursive: true });
  writeFileSync(join(fake.LocalAppData, "Ecosystem", "apps", "dayspring.json"), "{}");
  writeFileSync(join(fake.LocalAppData, "Ecosystem", "apps", "lantern.json"), "{}");
  ps(`$w = New-Object -ComObject WScript.Shell; foreach ($p in @('${join(fake.StartMenu, "Dayspring.lnk")}', '${join(fake.Desktop, "Dayspring.lnk")}', '${join(fake.Startup, "Dayspring.lnk")}')) { $s = $w.CreateShortcut($p); $s.TargetPath = 'C:\\Windows\\System32\\wscript.exe'; $s.Arguments = '"${join(APP, "Start Dayspring.vbs")}"'; $s.WorkingDirectory = '${APP}'; $s.Save() }; $o = $w.CreateShortcut('${join(fake.Desktop, "Other app.lnk")}'); $o.TargetPath = 'C:\\Windows\\notepad.exe'; $o.Save()`);
  const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env: baseEnv(PORT, { DAYSPRING_UNINSTALL_TEST: JSON.stringify(fake) }), stdio: "ignore", windowsHide: true });
  for (let i = 0; i < 60 && !(await up(PORT)); i++) await sleep(500);
  const call = (path, body) => fetch(`http://127.0.0.1:${PORT}/api${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then(async (x) => ({ status: x.status, ...(await x.json().catch(() => ({}))) }));
  const info = await call("/uninstall/info");
  check(`uninstall (${way}): allowed on an installed copy, asks for the owner's name`, info.allowed && info.confirmWord === "Test Person", JSON.stringify(info));
  const wrong = await call("/uninstall", { keepData: way === "keep", confirm: "someone else" });
  check(`uninstall (${way}): the wrong name removes nothing`, wrong.status === 400 && existsSync(join(APP, "server.mjs")), `${wrong.status}`);
  const ok = await call("/uninstall", { keepData: way === "keep", confirm: "  test PERSON " });
  check(`uninstall (${way}): the right name (any case, spaces trimmed) starts it`, ok.ok === true, JSON.stringify(ok));
  for (let i = 0; i < 60 && existsSync(join(APP, "server.mjs")); i++) await sleep(500);
  await sleep(1500);
  check(`uninstall (${way}): the program files are gone`, !existsSync(join(APP, "server.mjs")) && !existsSync(join(APP, "lib")));
  if (way === "keep") check("uninstall (keep): the data stays where it said", existsSync(join(APP, "data", "notes.txt")));
  else check("uninstall (remove): the data went to the (stand-in) Recycle Bin", !existsSync(APP) && existsSync(join(fake.RecycleTo, "Dayspring", "data", "notes.txt")), (existsSync(fake.RecycleTo) ? readdirSync(fake.RecycleTo, { withFileTypes: true }) : []).map((d) => d.name).join(","));
  check(`uninstall (${way}): Dayspring's shortcuts are gone, others stay`, !existsSync(fake.StartMenu) && !existsSync(join(fake.Desktop, "Dayspring.lnk")) && !existsSync(join(fake.Startup, "Dayspring.lnk")) && existsSync(join(fake.Desktop, "Other app.lnk")));
  check(`uninstall (${way}): Dayspring's profile and Ecosystem entry are gone; Lantern's and others stay`, !existsSync(join(fake.LocalAppData, "DayspringDisplay")) && !existsSync(join(fake.LocalAppData, "Ecosystem", "apps", "dayspring.json")) && existsSync(join(fake.LocalAppData, "Ecosystem", "apps", "lantern.json")) && existsSync(join(fake.LocalAppData, "SomethingElse")));
  try { server.kill(); } catch { /* gone */ }
  if (!process.argv.includes("--keep")) { spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true }); rmSync(TMP, { recursive: true, force: true }); }
}

// ---------------- 3. the source copy refuses ----------------
{
  const u = await import(new URL("../../lib/about-routes.mjs", import.meta.url));
  const info = u.uninstallInfo();
  check("uninstall: refused on the development copy", info.allowed === false && /development copy/.test(info.reason), info.reason);
}
const survivors = otherNodes();
check("nothing else was touched: other Node programs still running", others0.every((pid) => survivors.includes(pid)));
console.log(`\n${fail ? "FAILED" : "ALL PASSED"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
