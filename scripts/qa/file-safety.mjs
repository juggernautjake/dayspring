// File access, fail-safes and the activity log, on a throwaway copy (port 4792, its own data, a pretend home folder in the
// temp folder; the owner's own files and Dayspring are never touched; deleting goes to a test folder, not the Recycle Bin).
//   A. the setup and Settings in a headless browser: file access starts at none, the setup can't go on until an option is
//      picked (Next stays off, Enter does nothing, /setup/finish refuses), picking folders with Read & write, subfolders and
//      "Can delete files"; the one-time question for an older install; Settings → Activity log (entries, export, check)
//   B. the rules, straight through the modules: custom places, read only, delete as its own permission, every hard block
//      (Windows, Program Files, boot files, the registry, other profiles, Dayspring's own code, permissions and log, .git,
//      secrets), links and junctions that try to escape, path tricks, the important-file "Are you sure?" (refused without a
//      yes, a yes only works for that exact change, and it expires), bulk counts, a log line for every kind of operation,
//      redaction, the hash chain (verifies, and catches an edit or a removed line), keeping 120 days, and undo
//   node scripts/qa/file-safety.mjs [--keep] [--no-ui]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync, symlinkSync, lstatSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// playwright-core from the exported copy next to this project (…/dayspring-app), else this app's own; QA_PLAYWRIGHT overrides
const PW = process.env.QA_PLAYWRIGHT ?? pathToFileURL([join(DESK, "..", "..", "..", "dayspring-app", "node_modules", "playwright-core", "index.mjs"), join(DESK, "node_modules", "playwright-core", "index.mjs")].find((p) => existsSync(p)) ?? "").href;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 4792, BASE = `http://127.0.0.1:${PORT}`;
const args = process.argv.slice(2);
const TMP = mkdtempSync(join(tmpdir(), "ds-filesafety-")), APP = join(TMP, "app"), HOME = join(TMP, "home");
const DOCS = join(HOME, "Documents"), BIN = join(TMP, "recycle");
const USERS = dirname(homedir());           // the real C:\Users (read before the pretend home is set)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" && !ok ? "  (" + String(typeof got === "string" ? got : JSON.stringify(got)).slice(0, 260) + ")" : ""}`); };
const put = (p, s = "x") => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };
const junctions = [];
const junction = (link, target) => { const r = spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", link, target], { windowsHide: true, encoding: "utf8" }); if (r.status === 0) junctions.push(link); return r.status === 0; };

// ---- a throwaway copy of Dayspring and a pretend home -------------------------------------------------------------
console.log(`Test folder: ${TMP}`);
spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
if (!existsSync(join(APP, "server.mjs"))) { console.error("The export didn't work."); process.exit(2); }
junction(join(APP, "node_modules"), join(DESK, "node_modules"));
for (const d of ["Documents", "Desktop", "Downloads", "Pictures", "AppData/Local/Temp", "AppData/Roaming"]) mkdirSync(join(HOME, d), { recursive: true });
mkdirSync(join(APP, "data"), { recursive: true });
const ENV = { USERPROFILE: HOME, HOME, DAYSPRING_TEST_RECYCLE: BIN, DAYSPRING_NO_BROWSER: "1", DAYSPRING_NO_ECO: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_OVERLAY: "1",
  DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", ELEVENLABS_API_KEY: "", AI_PROVIDER: "none", DAYSPRING_REMINDER_CHANNEL: "off" };

let server = null, serverLog = "";
async function startServer() {
  server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env: { ...process.env, ...ENV, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
  for (let i = 0; i < 80; i++) { await sleep(500); try { if ((await fetch(`${BASE}/api/setup/state`, { signal: AbortSignal.timeout(2000) })).ok) return true; } catch { /* not yet */ } }
  return false;
}
async function stopServer() { if (!server) return; server.kill(); for (let i = 0; i < 20 && server.exitCode === null; i++) await sleep(200); server = null; }
const api = async (path, body) => { const r = await fetch(BASE + "/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); return { status: r.status, ...j }; };

try {
  // ================================================================ A. the setup, Settings, the older-install question
  if (!args.includes("--no-ui")) {
    writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester" }));
    check("server starts", await startServer(), serverLog.slice(-400));
    const p0 = await api("/setup/permissions");
    check("fresh install: file access is none", p0.files === "off" && p0.needsChoice === true && p0.choiceMade === false, p0);
    check("fresh install: deleting is off", p0.can?.delete === false, p0.can);
    const f0 = await api("/setup/finish", {});
    check("setup can't finish before file access is chosen", f0.status === 400 && f0.need === "files", f0);
    const bad = await api("/setup/permissions", { choice: true });
    check("a 'choice' without an option is refused", bad.status === 400, bad);

    const { chromium } = await import(PW);
    const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio", "--autoplay-policy=user-gesture-required"] });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      page.on("pageerror", (e) => console.log("  page error:", e.message));
      await page.addInitScript(() => { try { localStorage.setItem("ds-welcome-muted", "true"); } catch { /* fine */ } });
      await page.goto(`${BASE}/welcome?step=permissions`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".fa-card", { timeout: 15000 });
      await sleep(600);
      check("setup step: Next is off until an option is picked", await page.$eval("#next", (b) => b.disabled));
      check("setup step: nothing is picked for them", await page.$$eval(".fa-card input[type=radio]", (xs) => xs.every((x) => !x.checked)));
      check("setup step: 'No file access' is marked recommended", await page.$eval(".fa-card.fa-suggest", (c) => /No file access/.test(c.textContent) && /Recommended/.test(c.textContent)));
      check("setup step: no Skip button", await page.$eval("#skip", (b) => b.hidden));
      await page.keyboard.press("Enter"); await sleep(700);
      check("setup step: Enter doesn't move on without a choice", /Permissions/.test(await page.textContent("#stepname")), await page.textContent("#stepname"));
      await page.click(".fa-card:has-text('No file access')");
      await sleep(500);
      check("setup step: picking 'No file access' turns Next on", !(await page.$eval("#next", (b) => b.disabled)));
      await page.waitForFunction(() => /won't/.test(document.querySelector(".fa-summary")?.textContent ?? ""), null, { timeout: 5000 }).catch(() => {});
      check("setup step: summary says what it won't do", /Look at, open or search any of your files/.test(await page.textContent(".fa-summary")), await page.textContent(".fa-summary"));
      // only what I choose: a typed path, Read & write, not its subfolders, can delete
      await page.click(".fa-card:has-text('Only the folders and files I choose')");
      await page.fill(".fa-addrow input[type=text]", DOCS);
      await page.click(".fa-addrow .fa-primary");
      await page.waitForSelector(".fa-entry", { timeout: 5000 });
      await page.selectOption(".fa-entry select", "readwrite");
      await page.uncheck(".fa-entry input[type=checkbox]");
      await page.waitForSelector("[id$='-change']:not([hidden])", { timeout: 3000 });
      check("setup step: 'Ask me before every change' starts on", await page.isChecked("[id$='-ask']"));
      check("setup step: 'Can delete files' starts off", !(await page.isChecked("[id$='-del']")));
      await page.check("[id$='-del']");
      await page.waitForFunction(() => /Delete files, only to the Recycle Bin/.test(document.querySelector(".fa-summary")?.textContent ?? ""), null, { timeout: 5000 }).catch(() => {});
      check("setup step: summary follows the choices", /Read and change/.test(await page.textContent(".fa-summary")) && /Recycle Bin/.test(await page.textContent(".fa-summary")), await page.textContent(".fa-summary"));
      await page.click("#next");
      await page.waitForFunction(() => !/Permissions/.test(document.querySelector("#stepname")?.textContent ?? ""), null, { timeout: 8000 }).catch(() => {});
      const p1 = await api("/setup/permissions");
      const e1 = p1.entries?.[0] ?? {};
      check("setup step: the choice is saved as picked", p1.choiceMade === true && p1.files === "custom" && e1.access === "readwrite" && e1.subfolders === false && e1.kind === "folder" && p1.can?.delete === true && p1.writeConfirm === "ask", p1);
      const f1 = await api("/setup/finish", {});
      check("setup finishes once file access is chosen", f1.status === 200, f1);
      // a command is logged (no AI: the built-in answer)
      await api("/chat", { message: "what did you change today", surface: "tv", typed: true });
      const cmd = await api("/activity?kind=command");
      check("a typed command is in the activity log", (cmd.entries ?? []).some((e) => e.text === "what did you change today" && e.how === "typed"), cmd.entries?.[0]);
      check("the permission change is in the activity log", ((await api("/activity?kind=permissions")).entries ?? []).some((e) => e.confirmed === true));
      // Settings → Permissions shows the same chooser with what was saved; Settings → Activity log
      await page.goto(`${BASE}/setup?s=permissions`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".fa-card", { timeout: 15000 });
      check("Settings: the same chooser, showing the saved choice", await page.isChecked(".fa-card:has-text('Only the folders') input"));
      await page.goto(`${BASE}/setup?s=activity`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".act-row", { timeout: 15000 }).catch(() => {});
      check("Settings → Activity log lists entries", (await page.$$(".act-row")).length > 0);
      check("Settings → Activity log has a CSV export", /\/api\/activity\/export\.csv\?/.test(await page.getAttribute("#actCsv", "href") ?? ""));
      const csv = await fetch(`${BASE}/api/activity/export.csv`).then((r) => r.text());
      check("the CSV export has a header and rows", /^\ufeff?at,kind,via/.test(csv) && csv.split("\r\n").length > 2, csv.slice(0, 120));
      await page.click("#actVerify"); await sleep(800);
      check("Settings → Activity log: 'Check the log' says it checks out", /checks out/.test(await page.textContent("#m")), await page.textContent("#m"));
      await page.fill("#actDays", "30"); await page.click("#actDaysSave"); await sleep(500);
      check("Settings: the log can't be kept fewer than 120 days", (await api("/activity/settings")).days === 120 && /120/.test(await page.textContent("#m")));

      // an older install: its setting is kept as it was, and it's asked once
      await stopServer();
      writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary" }));
      writeFileSync(join(APP, "data", "permissions.json"), JSON.stringify({ files: "folders", folders: [DOCS], writeFiles: "ask", programs: "ask", browser: false, web: true }));
      check("server restarts", await startServer(), serverLog.slice(-300));
      const p2 = await api("/setup/permissions");
      check("older install: kept as it was (folder, read & write, asking)", p2.files === "custom" && p2.entries?.[0]?.access === "readwrite" && p2.writeConfirm === "ask", p2);
      check("older install: deleting stays off (never implied by read & write)", p2.can?.delete === false, p2.can);
      check("older install: asked once to confirm", p2.confirmPending === true, p2);
      await page.goto(`${BASE}/display`, { waitUntil: "domcontentloaded" }).catch(() => {});
      const card = await page.waitForSelector("#faCheck", { timeout: 15000 }).catch(() => null);
      check("older install: the Dayspring screen shows the one-time question", Boolean(card));
      await page.goto(`${BASE}/setup?s=permissions`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#faKeep", { timeout: 15000 }).catch(() => {});
      check("older install: Settings shows 'Keep this setting'", Boolean(await page.$("#faKeep")));
      await page.click("#faKeep"); await sleep(600);
      const p3 = await api("/setup/permissions");
      check("older install: 'Keep this setting' confirms it without changing it", p3.confirmPending === false && p3.choiceMade === true && p3.files === "custom" && p3.entries?.[0]?.access === "readwrite" && p3.can?.delete === false, p3);
    } finally { await browser.close(); }
    await stopServer();
  }

  // ================================================================ B. the rules, through the modules
  for (const f of readdirSync(join(APP, "data"))) rmSync(join(APP, "data", f), { recursive: true, force: true });
  writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester" }));
  Object.assign(process.env, ENV);
  const L = (m) => import(pathToFileURL(join(APP, "lib", m + ".mjs")).href);
  const permissions = await L("permissions"), abilities = await L("abilities"), activity = await L("activity"), confirm = await L("confirm");
  const activityskills = await L("activityskills"), system = await L("system");
  const run = (name, input, ctx) => abilities.run(name, input, ctx);
  const names = () => abilities.tools({ provider: "other" }).map((t) => t.name);
  const logOf = (kind) => activity.search({ kind, limit: 2000 }).entries;

  // defaults
  const d = permissions.get();
  check("defaults: no file access, delete off, not chosen yet", d.files === "off" && d.can.delete === false && d.choiceMade === false && d.writeConfirm === "ask", d);
  check("defaults: reading is refused", permissions.check("read", DOCS).ok === false);
  check("defaults: no file tools are offered (the log search is)", !names().includes("list_folder") && !names().includes("write_file") && names().includes("search_activity_log"), names());

  // custom places
  const PRIV = join(DOCS, "Private"), RO = join(DOCS, "ReadOnly"), FLAT = join(HOME, "Flat"), OTHER = join(HOME, "Other"), ONE = join(OTHER, "allowed.txt");
  put(join(DOCS, "a.txt"), "hello a"); put(join(PRIV, "s.txt"), "private"); put(join(RO, "r.txt"), "read me"); put(join(FLAT, "x.txt"), "flat"); put(join(FLAT, "sub", "y.txt"), "deep");
  put(ONE, "one file"); put(join(OTHER, "nope.txt"), "no");
  const ENTRIES = [{ path: DOCS, kind: "folder", access: "readwrite" }, { path: PRIV, kind: "folder", access: "none" }, { path: RO, kind: "folder", access: "read" },
    { path: FLAT, kind: "folder", access: "readwrite", subfolders: false }, { path: ONE, kind: "file", access: "readwrite" }];
  permissions.set({ files: "custom", choice: true, writeConfirm: "on", entries: ENTRIES });
  check("custom: an allowed folder can be read", (await run("read_file", { path: join(DOCS, "a.txt") }))?.text === "hello a");
  check("custom: a Blocked folder inside it can't", Boolean((await run("read_file", { path: join(PRIV, "s.txt") }))?.error));
  check("custom: a single allowed file can be read", (await run("read_file", { path: ONE }))?.text === "one file");
  check("custom: the file next to it can't", Boolean((await run("read_file", { path: join(OTHER, "nope.txt") }))?.error));
  check("custom: 'include subfolders' off keeps subfolders out", (await run("read_file", { path: join(FLAT, "x.txt") }))?.text === "flat" && Boolean((await run("read_file", { path: join(FLAT, "sub", "y.txt") }))?.error));
  check("custom: a Blocked folder is hidden from listings", !((await run("list_folder", { path: DOCS }))?.items ?? []).some((i) => i.name === "Private"));
  const w1 = await run("write_file", { path: join(DOCS, "new.txt"), content: "made" });
  check("custom: writing where it's Read & write works", w1?.written && readFileSync(join(DOCS, "new.txt"), "utf8") === "made", w1);
  const w2 = await run("write_file", { path: join(RO, "r.txt"), content: "changed" });
  check("custom: Read only blocks writes", w2?.denied && readFileSync(join(RO, "r.txt"), "utf8") === "read me", w2);
  // read only everywhere
  permissions.set({ files: "all", allAccess: "read", entries: [] });
  const w3 = await run("write_file", { path: join(DOCS, "z.txt"), content: "no" });
  check("everything, read only: writes are blocked", w3?.denied && !existsSync(join(DOCS, "z.txt")), w3);
  check("everything, read only: reading works", (await run("read_file", { path: join(DOCS, "a.txt") }))?.text === "hello a");
  // delete is its own permission
  permissions.set({ files: "custom", entries: ENTRIES });
  check("delete: not offered when it's off", !names().includes("delete_item") && names().includes("write_file"), names());
  const del0 = await run("delete_item", { path: join(DOCS, "new.txt") });
  check("delete: refused when it's off, even with read & write", del0?.denied && /delete/i.test(del0.text) && existsSync(join(DOCS, "new.txt")), del0);
  check("delete: an older config never gets it from read & write", permissions.normalize({ files: "folders", folders: [DOCS], writeFiles: "on" }).can.delete === false);
  check("delete: an older config keeps what it could do", permissions.normalize({ files: "folders", folders: [DOCS], writeFiles: "on" }).entries[0].access === "readwrite");
  permissions.set({ can: { delete: true } });
  const del1 = await run("delete_item", { path: join(DOCS, "new.txt") });
  check("delete: when on, it still always asks first (Recycle Bin, Are you sure?)", del1?.needsConfirm && /Recycle Bin/.test(del1.text) && /Are you sure\?/.test(del1.text) && existsSync(join(DOCS, "new.txt")), del1);
  permissions.set({ can: { create: false } });
  check("create: can be turned off on its own", (await run("write_file", { path: join(DOCS, "c.txt"), content: "x" }))?.denied && !existsSync(join(DOCS, "c.txt")));
  permissions.set({ can: { create: true, move: false } });
  check("move: can be turned off on its own", (await run("move_item", { from: join(DOCS, "a.txt"), to: join(DOCS, "a2.txt") }))?.denied && existsSync(join(DOCS, "a.txt")));
  permissions.set({ can: { move: true, edit: false } });
  check("edit: can be turned off on its own", (await run("edit_file", { path: join(DOCS, "a.txt"), find: "hello", replace: "bye" }))?.denied && readFileSync(join(DOCS, "a.txt"), "utf8") === "hello a");
  permissions.set({ can: { edit: true } });

  // ---- hard blocks, in the widest mode ----
  permissions.set({ files: "all", allAccess: "readwrite", writeConfirm: "on", entries: [{ path: PRIV, kind: "folder", access: "none" }], can: { create: true, edit: true, move: true, delete: true } });
  const pf = process.env.ProgramFiles || "C:\\Program Files", pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", win = process.env.SystemRoot || "C:\\Windows";
  const HARD = [
    ["System32", join(win, "System32", "evil.dll")], ["hosts file (in Windows)", join(win, "System32", "drivers", "etc", "hosts")], ["Windows", join(win, "win.ini")],
    ["Program Files", join(pf, "Something", "app.exe")], ["Program Files (x86)", join(pf86, "Something", "app.exe")], ["ProgramData\\Microsoft", "C:\\ProgramData\\Microsoft\\Windows\\x.txt"],
    ["boot manager", "C:\\bootmgr"], ["pagefile", "C:\\pagefile.sys"], ["hiberfil", "C:\\hiberfil.sys"], ["Boot folder", "C:\\Boot\\BCD"], ["Recovery", "C:\\Recovery\\x.txt"], ["EFI", "C:\\EFI\\Microsoft\\x"],
    ["a new file at C:\\", "C:\\dayspring-test-root-file.txt"], ["the Users folder", "C:\\Users"], ["a main C:\\ folder", "C:\\Users"],
    ["another person's profile", join(USERS, "SomeoneElse-QA", "Documents", "x.txt")], ["the Default profile", "C:\\Users\\Default\\x.txt"],
    ["a registry hive (NTUSER.DAT)", join(HOME, "NTUSER.DAT")], ["UsrClass.dat", join(HOME, "AppData", "Local", "Microsoft", "Windows", "UsrClass.dat")],
    ["Dayspring's code", join(APP, "lib", "abilities.mjs")], ["Dayspring's data", join(APP, "data", "owner.json")], ["the permissions file", permissions._file],
    ["the activity log", join(activity.DIR(), "x.jsonl")], ["file backups", join(APP, "data", "backups", "files", "x.txt")],
    [".git internals", join(DOCS, "proj", ".git", "config")], ["a secret (.env)", join(DOCS, ".env")], ["an SSH key", join(HOME, ".ssh", "id_ed25519")], ["a password file", join(DOCS, "passwords.txt")],
  ];
  put(join(DOCS, "proj", ".git", "config"), "[core]"); put(join(DOCS, ".env"), "KEY=1"); put(join(HOME, "NTUSER.DAT"), "hive");
  for (const [what, p] of HARD) {
    const r = ["edit", "create", "delete", "move"].map((k) => permissions.check(k, p, { kind: "file" }));
    check(`hard block: ${what}`, r.every((x) => !x.ok), r.map((x) => x.reason).join(","));
  }
  for (const [what, p] of HARD.filter(([, p]) => p.toLowerCase().startsWith(TMP.toLowerCase()))) {
    const before = existsSync(p) ? readFileSync(p, "utf8") : null;
    const r = await run("write_file", { path: p, content: "overwritten" });
    check(`hard block through the tool: ${what}`, (r?.denied || r?.error) && (existsSync(p) ? readFileSync(p, "utf8") : null) === before, r);
  }
  check("hard block: Dayspring's own code can't be deleted", (await run("delete_item", { path: join(APP, "lib", "abilities.mjs") }))?.denied && existsSync(join(APP, "lib", "abilities.mjs")));
  // links and junctions that try to lead somewhere protected
  if (junction(join(DOCS, "winlink"), win)) {
    const r = await run("write_file", { path: join(DOCS, "winlink", "dayspring-evil.txt"), content: "x" });
    check("junction escape: into Windows is blocked", r?.denied && !existsSync(join(win, "dayspring-evil.txt")), r);
  } else check("junction escape: into Windows is blocked", false, "couldn't make a junction");
  if (junction(join(DOCS, "datalink"), join(APP, "data"))) {
    const before = readFileSync(join(APP, "data", "owner.json"), "utf8");
    const r = await run("write_file", { path: join(DOCS, "datalink", "owner.json"), content: "{}" });
    check("junction escape: into Dayspring's data is blocked", r?.denied && readFileSync(join(APP, "data", "owner.json"), "utf8") === before, r);
  }
  if (junction(join(DOCS, "privlink"), PRIV)) check("junction escape: into a Blocked folder can't even be read", Boolean((await run("read_file", { path: join(DOCS, "privlink", "s.txt") }))?.error));
  let fileLink = false;
  try { symlinkSync(join(APP, "data", "owner.json"), join(DOCS, "ownerlink.json"), "file"); fileLink = true; } catch { /* needs Developer Mode */ }
  if (fileLink) { const r = await run("write_file", { path: join(DOCS, "ownerlink.json"), content: "{}" }); check("symlink escape: a file link to Dayspring's data is blocked", r?.denied, r); }
  else console.log("SKIP  symlink escape (file symlinks need Developer Mode here; junctions were tested)");
  // path tricks
  const TRICKS = [["..", "..\\escape.txt"], ["..", join(DOCS, "..", "escape.txt").replace(/\\escape/, "\\..\\escape")], ["UNC", "\\\\server\\share\\x.txt"], ["\\\\?\\", "\\\\?\\C:\\Windows\\x.txt"],
    ["\\\\.\\", "\\\\.\\C:\\x.txt"], ["8.3 short name", "C:\\PROGRA~1\\x.txt"], ["trailing dot", join(DOCS, "a.txt.")], ["trailing space", join(DOCS, "a.txt ")],
    ["alternate data stream", join(DOCS, "a.txt:hidden")], ["::$DATA stream", join(DOCS, "a.txt::$DATA")], ["device name", join(DOCS, "CON")], ["device name with an extension", join(DOCS, "nul.txt")]];
  for (const [what, p] of TRICKS) {
    const r = await run("write_file", { path: p, content: "x" });
    const rr = await run("read_file", { path: p });
    check(`path trick refused: ${what}`, (r?.error || r?.denied) && (rr?.error || rr?.denied) && permissions.check("read", p).ok === false, { r, rr });
  }
  check("path tricks: nothing escaped", !existsSync(join(HOME, "escape.txt")) && readFileSync(join(DOCS, "a.txt"), "utf8") === "hello a");

  // ---- the important-file warning and "Are you sure?" ----
  const PKG = join(DOCS, "proj", "package.json");
  put(PKG, '{ "name": "demo", "version": "1.0.0" }');
  confirm._reset();
  const i1 = await run("edit_file", { path: PKG, find: "1.0.0", replace: "2.0.0" });
  check("important file: asks even with 'ask me' off", i1?.needsConfirm && i1.important, i1);
  check("important file: says why (what could break)", /project/i.test(i1?.text ?? "") && /(install|run|start)/i.test(i1?.text ?? ""), i1?.text);
  check("important file: says a backup is made and asks 'Are you sure?'", /backup/i.test(i1?.text ?? "") && /Are you sure\?$/.test(i1?.text ?? ""), i1?.text);
  const i2 = await run("edit_file", { path: PKG, find: "1.0.0", replace: "2.0.0", confirm_token: i1.confirm_token });
  check("important file: the token alone (no yes from the owner) does nothing", i2?.needsConfirm && readFileSync(PKG, "utf8").includes("1.0.0"), i2);
  confirm.userSaid("what time is it");
  check("important file: something other than yes doesn't count", (await run("edit_file", { path: PKG, find: "1.0.0", replace: "2.0.0", confirm_token: i1.confirm_token }))?.needsConfirm && readFileSync(PKG, "utf8").includes("1.0.0"));
  check("important file: the model's own confirmed: true is ignored", (await run("edit_file", { path: PKG, find: "1.0.0", replace: "2.0.0", confirmed: true }))?.needsConfirm && readFileSync(PKG, "utf8").includes("1.0.0"));
  const i1b = await run("edit_file", { path: PKG, find: "1.0.0", replace: "2.0.0" });
  confirm.userSaid("yes");
  const i3 = await run("edit_file", { path: PKG, find: "1.0.0", replace: "9.9.9", confirm_token: i1b.confirm_token });
  check("important file: a yes only works for that exact change", (i3?.denied || i3?.needsConfirm) && readFileSync(PKG, "utf8").includes("1.0.0"), i3);
  const i4 = await run("edit_file", { path: PKG, find: "1.0.0", replace: "2.0.0" });
  check("call surfaces can't say yes", confirm.userSaid("yes", { surface: "call" }) === null);
  confirm.userSaid("Yes, I'm sure.");
  const i5 = await run("edit_file", { path: PKG, find: "1.0.0", replace: "2.0.0", confirm_token: i4.confirm_token });
  check("important file: after a yes, that exact change goes ahead, with a backup", i5?.edited && readFileSync(PKG, "utf8").includes("2.0.0") && i5.backup && existsSync(i5.backup) && readFileSync(i5.backup, "utf8").includes("1.0.0"), i5);
  const i6 = await run("edit_file", { path: PKG, find: "2.0.0", replace: "3.0.0", confirm_token: i4.confirm_token });
  check("important file: a token works once", i6?.needsConfirm && readFileSync(PKG, "utf8").includes("2.0.0"), i6);
  const t0 = Date.now();
  confirm._setNow(() => t0 + 3 * 60_000);
  confirm.userSaid("yes");
  const i7 = await run("edit_file", { path: PKG, find: "2.0.0", replace: "3.0.0", confirm_token: i6.confirm_token });
  confirm._setNow(null);
  check("important file: a question more than two minutes old expires", i7?.needsConfirm && readFileSync(PKG, "utf8").includes("2.0.0"), i7);
  const i8 = await run("write_file", { path: PKG, content: "{}" });
  confirm.userSaid("no, leave it");
  check("important file: a no cancels it", (await run("write_file", { path: PKG, content: "{}", confirm_token: i8.confirm_token }))?.needsConfirm && readFileSync(PKG, "utf8").includes("2.0.0"));
  check("important file: the owner can mark their own", (() => { permissions.set({ important: [join(DOCS, "a.txt")] }); return true; })() && (await run("edit_file", { path: join(DOCS, "a.txt"), find: "hello", replace: "bye" }))?.text?.includes("You marked it as important"));
  permissions.set({ important: [] });
  put(join(DOCS, "hosts"), "127.0.0.1 localhost");
  check("important file: a hosts file warns about websites", /websites/.test((await run("write_file", { path: join(DOCS, "hosts"), content: "x" }))?.text ?? ""));
  put(join(DOCS, ".bashrc"), "alias x=y");
  check("important file: a shell profile warns about the terminal", /terminal/.test((await run("write_file", { path: join(DOCS, ".bashrc"), content: "x" }))?.text ?? ""));
  put(join(HOME, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "go.cmd"), "echo");
  permissions.set({ entries: [{ path: PRIV, kind: "folder", access: "none" }] });
  check("important file: the Startup folder warns it runs at start-up", /Startup folder/.test((await run("write_file", { path: join(HOME, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "go.cmd"), content: "x" }))?.text ?? ""));
  put(join(DOCS, "app.db"), "db");
  check("important file: a database warns about its data", /database/i.test((await run("write_file", { path: join(DOCS, "app.db"), content: "x" }))?.text ?? ""));
  put(join(HOME, "Elsewhere", "thing.txt"), "x");
  check("important file: outside the usual folders warns", /outside your usual folders/.test((await run("write_file", { path: join(HOME, "Elsewhere", "thing.txt"), content: "y" }))?.text ?? ""));
  // no AI: the same rules (the owner already said yes to the request itself; important places still warn)
  const o1 = await run("create_folder", { path: join(DOCS, "Taxes") }, { via: "offline", userConfirmed: true });
  check("no AI: an ordinary change goes ahead once the owner said yes", o1?.created && existsSync(join(DOCS, "Taxes")), o1);
  const o2 = await run("write_file", { path: PKG, content: "{}" }, { via: "offline", userConfirmed: true });
  check("no AI: an important file still warns and asks", o2?.needsConfirm && /Are you sure\?/.test(o2.text), o2);
  permissions.set({ writeConfirm: "ask" });
  const o3 = await run("write_file", { path: join(DOCS, "plain.txt"), content: "x" });
  check("'Ask me before every change': even an ordinary file asks first", o3?.needsConfirm && !existsSync(join(DOCS, "plain.txt")), o3);
  permissions.set({ writeConfirm: "on" });

  // ---- bulk ----
  for (let i = 0; i < 30; i++) put(join(DOCS, "Big", `f${i}.txt`), String(i));
  for (let i = 0; i < 5; i++) put(join(DOCS, "Small", `f${i}.txt`), String(i));
  for (let i = 0; i < 3; i++) put(join(DOCS, "Gone", `f${i}.txt`), String(i));
  const b1 = await run("move_item", { from: join(DOCS, "Big"), to: join(DOCS, "Big2") });
  check("bulk: moving more than 25 files asks, with the count", b1?.needsConfirm && b1.count === 30 && /30 files/.test(b1.text) && existsSync(join(DOCS, "Big")), b1);
  const b2 = await run("move_item", { from: join(DOCS, "Small"), to: join(DOCS, "Small2") });
  check("bulk: a few files move without asking ('ask me' off)", b2?.moved && existsSync(join(DOCS, "Small2", "f0.txt")), b2);
  const b3 = await run("delete_item", { path: join(DOCS, "Gone") });
  check("bulk: deleting a folder always asks, with the count", b3?.needsConfirm && b3.count === 3 && /3 files/.test(b3.text), b3);
  confirm.userSaid("yes");
  const b4 = await run("delete_item", { path: join(DOCS, "Gone"), confirm_token: b3.confirm_token });
  check("bulk: after a yes, the folder goes to the Recycle Bin", b4?.recycled && !existsSync(join(DOCS, "Gone")) && readdirSync(BIN).some((n) => n.endsWith("Gone")), b4);
  permissions.set({ bulkLimit: 50 });
  const b5 = await run("move_item", { from: join(DOCS, "Big"), to: join(DOCS, "Big2") });
  check("bulk: the limit is a setting", b5?.moved, b5);

  // ---- a log line for every kind of operation ----
  await run("list_folder", { path: DOCS });
  await run("find_files", { query: "plain", under: DOCS });
  await run("search_text", { text: "hello", under: DOCS });
  await run("copy_item", { from: join(DOCS, "a.txt"), to: join(DOCS, "a-copy.txt") });
  const cw = await run("write_file", { path: join(DOCS, "log.txt"), content: "one" });
  const cw2 = await run("write_file", { path: join(DOCS, "log.txt"), content: "two two" });
  permissions.set({ programs: "off" });
  // (only called when the permission really is off, so a broken check can never open a window here)
  const term = permissions.check("programs").ok ? { opened: "not tried" } : system.openTerminal({ path: DOCS });
  check("running a terminal needs the programs permission", term?.denied, term);
  for (const k of ["file.list", "file.read", "file.find", "file.search", "file.create", "file.write", "file.edit", "file.move", "file.copy", "file.delete", "folder.create", "blocked", "permissions", "confirm.asked", "confirm.given", "confirm.refused", "confirm.expired"])
    check(`activity log has ${k}`, logOf(k).some((e) => e.kind === k));
  const wr = logOf("file.write").find((e) => e.path === join(DOCS, "log.txt"));
  check("a change's log line has size and sha256 before and after, and the backup", wr && wr.sizeBefore === 3 && wr.sizeAfter === 7 && /^[a-f0-9]{64}$/.test(wr.sha256Before) && /^[a-f0-9]{64}$/.test(wr.sha256After) && wr.backup && existsSync(wr.backup), wr);
  const rd = logOf("file.read")[0];
  check("a read's log line has the path only (no contents, no fingerprint)", rd && rd.path && rd.sha256Before === undefined && !JSON.stringify(rd).includes("hello a"), rd);
  check("blocked attempts are logged with the reason", logOf("blocked").some((e) => e.reason === "protected" && e.text) && logOf("blocked").some((e) => e.reason === "trick") && logOf("blocked").some((e) => e.reason === "programs"));

  // ---- redaction ----
  const KEY = "sk-ant-api03-" + "Q".repeat(30), PW_ = "hunter2-very-secret";
  activity.log("command", { text: `my key is ${KEY} and my password: ${PW_}`, apiKey: "zzz-should-hide", nested: { token: "tok-should-hide" } });
  await run("write_file", { path: join(DOCS, "config.txt"), content: `OPENAI=${KEY}\npassword=${PW_}` });
  const rawLog = readdirSync(activity.DIR()).filter((f) => f.endsWith(".jsonl")).map((f) => readFileSync(join(activity.DIR(), f), "utf8")).join("");
  check("redaction: keys never reach the log", !rawLog.includes(KEY) && !rawLog.includes("Q".repeat(30)));
  check("redaction: passwords never reach the log", !rawLog.includes(PW_));
  check("redaction: fields named like secrets are blanked", !rawLog.includes("zzz-should-hide") && !rawLog.includes("tok-should-hide"));
  check("redaction: file contents are a size and fingerprint only", /"content":\{"chars":\d+,"sha256":"[a-f0-9]{64}"\}/.test(JSON.stringify(activity.summarizeArgs({ content: "x" }))));

  // ---- the hash chain ----
  check("hash chain: the real log verifies", activity.verify().ok, activity.verify());
  const CH = join(TMP, "chain", "activity");
  process.env.DAYSPRING_ACTIVITY_DIR = CH;
  for (let i = 0; i < 5; i++) activity.log("test", { n: i, text: `line ${i}` });
  check("hash chain: a fresh log verifies", activity.verify().ok);
  const day = readdirSync(CH).find((f) => f.endsWith(".jsonl")), dayFile = join(CH, day), orig = readFileSync(dayFile, "utf8");
  const lines = orig.trimEnd().split("\n");
  writeFileSync(dayFile, lines.map((l, i) => (i === 2 ? l.replace("line 2", "line X") : l)).join("\n") + "\n");
  const v1 = activity.verify();
  check("hash chain: an edited line is caught", !v1.ok && v1.files[0].line === 3 && /changed/.test(v1.files[0].problem), v1);
  writeFileSync(dayFile, lines.filter((_, i) => i !== 1).join("\n") + "\n");
  const v2 = activity.verify();
  check("hash chain: a removed line is caught", !v2.ok && /chain|removed/.test(v2.files[0].problem), v2);
  writeFileSync(dayFile, orig.slice(0, -20));
  activity._setClock(null); activity.log("after-crash", { n: 1 });
  check("crash: an unfinished last line is set aside and the log carries on", activity.verify().ok && readdirSync(CH).some((f) => /\.unfinished-\d+\.txt$/.test(f)) && activity.search({ kind: "log.repaired" }).total === 1);

  // ---- keeping 120 days ----
  const RET = join(TMP, "ret", "activity");
  process.env.DAYSPRING_ACTIVITY_DIR = RET;
  mkdirSync(RET, { recursive: true });
  const ago = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString("en-CA");
  for (const n of [10, 119, 121, 200]) writeFileSync(join(RET, `${ago(n)}.jsonl`), JSON.stringify({ at: new Date().toISOString(), kind: "old", n }) + "\n");
  const BK = join(TMP, "ret", "backups");
  for (const n of [10, 200]) put(join(BK, `${ago(n)}T10-00-00-000Z`, "x.txt"));
  activity.addBackupDir(BK);
  const st = activity.setSettings({ days: 30 });
  check("retention: can't be set below 120 days", st.days === 120 && st.clamped === true, st);
  check("retention: the default is 180", (() => { rmSync(join(RET, "..", "activity-settings.json"), { force: true }); return activity.settings().days === 180; })());
  activity.setSettings({ days: 120 });
  activity.prune();
  const left = readdirSync(RET).filter((f) => f.endsWith(".jsonl")).map((f) => f.slice(0, 10));
  check("retention: 120 days are kept, older days are removed", left.includes(ago(10)) && left.includes(ago(119)) && !left.includes(ago(121)) && !left.includes(ago(200)), left);
  check("retention: backups follow the same schedule", existsSync(join(BK, `${ago(10)}T10-00-00-000Z`)) && !existsSync(join(BK, `${ago(200)}T10-00-00-000Z`)));
  delete process.env.DAYSPRING_ACTIVITY_DIR;

  // ---- undo ----
  confirm._reset();
  const U = join(DOCS, "undo.txt");
  await run("write_file", { path: U, content: "v1" });
  await run("write_file", { path: U, content: "v2" });
  const u1 = await run("undo_change", {});
  check("undo: always asks first", u1?.needsConfirm && /Are you sure\?/.test(u1.text) && readFileSync(U, "utf8") === "v2", u1);
  confirm.userSaid("yes");
  const u2 = await run("undo_change", { confirm_token: u1.confirm_token });
  check("undo: puts the file back from its backup", u2?.restored && readFileSync(U, "utf8") === "v1", u2);
  check("undo: the version it replaced is backed up too", u2?.backupOfCurrent && readFileSync(u2.backupOfCurrent, "utf8") === "v2");
  check("undo: logged, pointing at the change it undid", logOf("file.undo").some((e) => e.undoOf && e.path === U));
  await run("write_file", { path: U, content: "v3" });
  const s1 = await activityskills.handle("undo that last change");
  check("voice: 'undo that last change' asks 'Are you sure?'", /Are you sure\?/.test(s1?.reply ?? "") && readFileSync(U, "utf8") === "v3", s1);
  confirm.userSaid("yes");
  const s2 = await activityskills.handle("yes");
  check("voice: 'yes' puts it back", /^Done/.test(s2?.reply ?? "") && readFileSync(U, "utf8") === "v1", s2);
  const s3 = await activityskills.handle("what did you change today");
  check("voice: 'what did you change today' lists the files", /undo\.txt/.test(s3?.reply ?? "") && /Today I/.test(s3?.reply ?? ""), s3);
  check("voice: 'show the activity log' opens Settings → Activity log", (await activityskills.handle("show the activity log"))?.openPage === "/setup?s=activity");
  await run("write_file", { path: U, content: "v4, someone's later work" });
  const created = logOf("file.create").find((e) => e.path === U);
  const u3 = await run("undo_change", { id: created?.id });
  check("undo: won't remove a file it created once it has changed since", Boolean(u3?.error) && existsSync(U), u3);
  const fin = activity.verify();
  check("hash chain: the whole run's log still verifies", fin.ok, fin);
} catch (e) {
  fail++; console.log(`FAIL  crashed: ${e.stack}`);
} finally {
  await stopServer();
  for (const j of junctions) { try { if (lstatSync(j).isSymbolicLink()) rmdirSync(j); } catch { /* gone */ } }
  const stillLinked = junctions.filter((j) => { try { lstatSync(j); return true; } catch { return false; } });
  if (!args.includes("--keep") && !stillLinked.length) rmSync(TMP, { recursive: true, force: true });
  else console.log(`Left in place: ${TMP}${stillLinked.length ? ` (links not removed: ${stillLinked.join(", ")})` : ""}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
