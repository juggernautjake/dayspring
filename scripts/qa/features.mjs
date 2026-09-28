// Release channels and feature maturity (lib/features.mjs), the compatibility lists (compat/) and the test checklist
// (testing/). It never touches your own Dayspring or its data:
//   A. modules, in this process, with every local file pointed at a temp folder: a dev feature is off in production
//      (routes, pages, tools, intents, Settings sections, jobs), a beta feature is on in production and can be switched
//      off, everything is on in development, a promotion override works (and can't lift a dev feature in production),
//      the release script's channel options, version ordering, the compat data against its schema, the checklist's
//      shape, results / progress / promote / export / promote-features
//   B. a throwaway copy (inside node_modules, its own empty data, ports 4730-4739) as PRODUCTION and as DEVELOPMENT:
//      the routes, pages, jobs and gate script over HTTP, then ONE headless Chrome (muted, its own temp profile): the
//      Settings list, Features, the Compatibility page (renders and filters), the Testing page (pass/fail, progress,
//      promote, export) and the Dayspring screen's gate
//   node scripts/qa/features.mjs [--module] [--keep]      --module: part A only
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const DESK = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2), flag = (f) => args.includes(f);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0, passed = 0;
const rec = (area, ok, note = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${area}${note ? " — " + String(note).slice(0, 240) : ""}`); };
const lib = (m) => import(pathToFileURL(join(DESK, "lib", m)).href);

// ---- A. modules ------------------------------------------------------------------------------------------------------
const TMP = mkdtempSync(join(tmpdir(), "ds-features-qa-"));
Object.assign(process.env, {
  DAYSPRING_FEATURE_SWITCHES: join(TMP, "feature-switches.json"), DAYSPRING_FEATURE_STAGES: join(TMP, "feature-stages.json"),
  DAYSPRING_TESTING_FILE: join(TMP, "testing.json"), DAYSPRING_COMPAT_VERIFIED: join(TMP, "compat-verified.json"),
  DAYSPRING_DEV_TOKEN: join(TMP, "no-dev-token.json"),      // no developer token here
  DAYSPRING_NO_ECO: "1", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1",
});
delete process.env.DAYSPRING_SOCIAL;
const F = await lib("features.mjs");
const setChannel = (c) => { process.env.DAYSPRING_CHANNEL = c; F._clear(); };
const reset = () => { for (const f of ["feature-switches.json", "feature-stages.json", "testing.json", "compat-verified.json"]) rmSync(join(TMP, f), { force: true }); F._clear(); };

// A1. production: a dev feature is off everywhere
setChannel("stable");
rec("A1 production: the channel is stable", F.channel() === "stable" && F.channelName() === "Production");
rec("A1 production: dev features are off", ["email", "gifs", "devices", "printers", "cameras", "remote", "social"].every((id) => F.on(id) === false));
rec("A1 production: stable and beta features are on", F.REGISTRY.filter((f) => f.stage !== "dev").every((f) => F.on(f.id)));
rec("A1 production: a dev feature's routes answer 404", F.routeBlocked("/gifs/search") === "gifs" && F.routeBlocked("/mail/list") === "email" && F.routeBlocked("/remote/status") === "remote");
rec("A1 production: its page is gone", F.pageBlocked("/gifs.html") === "gifs");
rec("A1 production: its tools aren't offered", !F.toolAllowed("gif_search") && !F.toolAllowed("email_send") && !F.toolAllowed("home_control") && !F.toolAllowed("remote_command") && F.toolAllowed("image_search") && F.toolAllowed("add_block"));
rec("A1 production: its intents are skipped", !F.intentAllowed("gifs.search") && !F.intentAllowed("mail.new") && F.intentAllowed("images.search") && F.intentAllowed("timer.start"));
rec("A1 production: its Settings sections are hidden (and Testing)", ["gifs", "email", "devices", "printers", "cameras", "testing"].every((s) => F.hiddenSections().includes(s)) && !F.hiddenSections().includes("photos"));
rec("A1 production: its screen elements are hidden", F.hiddenUi().selectors.includes("#gifsBtn") && F.hiddenUi().selectors.includes("#mailBtn") && !F.hiddenUi().selectors.includes("#dsImages"));
{ let ran = false; const started = F.startJob("email", "mail.background", () => { ran = true; });
  rec("A1 production: its background jobs aren't started", started === false && ran === false && F.jobs().some((j) => j.job === "mail.background" && j.started === false)); }
rec("A1 production: can't be switched on without the developer token", F.switchable("gifs") === false && (() => { try { F.setSwitch("gifs", true); return false; } catch { return true; } })() && F.on("gifs") === false);
rec("A1 production: editing data/ can't lift a dev feature", (() => { writeFileSync(join(TMP, "feature-stages.json"), JSON.stringify({ stages: { gifs: { stage: "stable" } } })); writeFileSync(join(TMP, "feature-switches.json"), JSON.stringify({ devOn: ["gifs"] })); F._clear(); const off = F.on("gifs") === false && F.stageOf("gifs") === "dev"; reset(); return off; })());
rec("A1 production: an unknown feature id is off", F.on("no-such-feature") === false);
// the longest prefix decides a shared path
rec("A1 shared paths: Meet invitations stay while email is off", F.routeBlocked("/mail/invite") === null && F.routeBlocked("/mail/invite/send") === null);
rec("A1 shared paths: /vision/settings open while either picture feature is on", (() => { F.setSwitch("faces", false); const a = F.routeBlocked("/vision/settings") === null && F.routeBlocked("/people") === "faces"; F.setSwitch("vision", false); const b = F.routeBlocked("/vision/settings") !== null && F.hiddenSections().includes("photos"); reset(); return a && b; })());
rec("A1 shared paths: Drive intents follow Drive, not the media library", (() => { F.setSwitch("medialib", false); const ok = F.intentAllowed("medialib.drive") && !F.intentAllowed("medialib.play"); reset(); return ok; })());

// A2. production: a beta feature is on, marked New, and can be switched off (and back)
rec("A2 beta: on in production and marked New", F.on("money") && F.describe("money").isNew && F.describe("money").switchable);
F.setSwitch("money", false);
rec("A2 beta: switched off → its routes, page and tools go", !F.on("money") && F.routeBlocked("/money/state") === "money" && F.pageBlocked("/money.html") === "money" && !F.toolAllowed("money_query") && F.describe("money").offByOwner);
{ let ran = false; F.setSwitch("medialib", false); F.startJob("medialib", "medialib.scan", () => { ran = true; }); rec("A2 beta: switched off → its jobs don't start", !ran); }
F.setSwitch("money", true); F.setSwitch("medialib", true);
rec("A2 beta: switched back on", F.on("money") && F.on("medialib") && F.routeBlocked("/money/state") === null);
rec("A2 stable features can't be switched here", F.switchable("schedule") === false && (() => { try { F.setSwitch("schedule", false); return false; } catch { return true; } })());
rec("A2 the floor gate: off means said straight away", await (async () => {
  const { createFloor } = await lib("floor.mjs");
  let fired = 0; const fl = createFloor({ enabled: () => false, displayCount: () => 1 }); fl.owner("voice", "tv");
  const r = fl.offer({ kind: "reminder", text: "Reminder: stretch." }, () => { fired++; });
  const fl2 = createFloor({ enabled: () => true, displayCount: () => 1 }); fl2.owner("voice", "tv"); let fired2 = 0;
  const r2 = fl2.offer({ kind: "reminder", text: "Reminder: stretch." }, () => { fired2++; });
  return r === "through" && fired === 1 && r2 === "held" && fired2 === 0;
})());
reset();

// A3. development: everything on
setChannel("dev");
rec("A3 development: every feature is on", F.REGISTRY.every((f) => F.on(f.id)), F.REGISTRY.filter((f) => !F.on(f.id)).map((f) => f.id).join(","));
rec("A3 development: nothing is hidden, Testing shows", F.hiddenSections().length === 0 && F.testingVisible() && F.hiddenUi().selectors.length === 0);
rec("A3 development: dev features can be switched off", (() => { F.setSwitch("gifs", false); const off = !F.on("gifs") && F.routeBlocked("/gifs/search") === "gifs"; F.setSwitch("gifs", true); return off && F.on("gifs"); })());
rec("A3 development: unknown ids are on", F.on("no-such-feature") === true);
{ let ran = false; F.startJob("email", "mail.background", () => { ran = true; }); rec("A3 development: jobs start", ran); }
// the social flag: the file switch needs the channel; the env switch is the developer's own
{ const flag = await lib("social/flag.mjs"); const dsf = join(TMP, "dev-settings.json"); process.env.DAYSPRING_DEV_SETTINGS = dsf; writeFileSync(dsf, JSON.stringify({ social: { enabled: true } }));
  const devOn = flag.enabled(); setChannel("stable"); const prodOff = flag.enabled() === false; process.env.DAYSPRING_SOCIAL = "1"; const envOn = flag.enabled(); delete process.env.DAYSPRING_SOCIAL; delete process.env.DAYSPRING_DEV_SETTINGS; setChannel("dev");
  rec("A3 social: file switch works in development, never in production; the developer's env switch still works", devOn && prodOff && envOn); }
reset();

// A4. promotion override
setChannel("stable");
const p1 = F.promote("money", { by: "owner" });
rec("A4 promote: a beta feature becomes stable locally, with who and when", p1.stage === "stable" && F.stageOf("money") === "stable" && F.describe("money").verifiedBy === "owner" && Boolean(F.describe("money").verifiedAt) && F.describe("money").promoted);
rec("A4 promote: a promoted feature can't be switched off here any more", F.switchable("money") === false && F.on("money"));
F.unpromote("money");
rec("A4 unpromote: back to beta", F.stageOf("money") === "beta");
setChannel("dev"); F.promote("gifs");
rec("A4 promote in development: a dev feature becomes stable", F.stageOf("gifs") === "stable");
setChannel("stable");
rec("A4 …but a production build still keeps it off (no token)", F.stageOf("gifs") === "dev" && !F.on("gifs"));
reset();

// A5. the gate script the pages load first
setChannel("stable");
{ const fr = await lib("feature-routes.mjs"); const code = fr.gateScript();
  const styles = []; const sandbox = { window: {}, document: { head: { appendChild: (s) => styles.push(s) }, documentElement: {}, createElement: () => ({}), querySelector: () => null, addEventListener: () => {} } };
  vm.runInNewContext(code, sandbox);
  const ds = sandbox.window.dsFeatures;
  rec("A5 gate.js: window.dsFeatures says what's on", ds && ds.channel === "stable" && ds.on("money") === true && ds.on("gifs") === false && ds.hiddenSections.includes("gifs"));
  rec("A5 gate.js: hides the off features' elements before drawing", styles.length === 1 && /#gifsBtn/.test(styles[0].textContent) && /display:none/.test(styles[0].textContent)); }

// A6. the AI's tools and the no-AI intents, as the assistant builds them
setChannel("stable");
{ const a = await lib("assistant.mjs"); const names = a.offeredToolNames();
  rec("A6 tools (production): no GIF, email, device, printer, camera or remote tools", !names.some((n) => /^(gif_|email_|home_|device_|printer_|camera_|remote_)/.test(n)), names.filter((n) => /^(gif_|email_|home_|device_|remote_)/.test(n)).join(","));
  rec("A6 tools (production): beta tools are there", names.includes("image_search") && names.some((n) => /^media_library_/.test(n)));
  F.setSwitch("images", false);
  rec("A6 tools: a switched-off beta feature's tools go", !a.offeredToolNames().includes("image_search"));
  reset(); setChannel("dev");
  rec("A6 tools (development): GIF tools are offered", a.offeredToolNames().some((n) => /^gif_/.test(n)));
  const intents = await lib("intents/index.mjs");
  const top = (t) => intents.plan(t).intent ?? "";
  const devTop = top("show me a gif of a dancing cat");
  setChannel("stable");
  const prodTop = top("show me a gif of a dancing cat");
  rec("A6 intents: the GIF intent answers in development, not in production", /^gifs\./.test(devTop) && !/^gifs\./.test(prodTop), `${devTop} / ${prodTop}`);
  F.setSwitch("images", false);
  rec("A6 intents: a switched-off beta feature's intents are skipped", !/^images\./.test(top("show me pictures of golden retrievers")));
  reset(); }

// A7. the release script's channel options and version order
{ const rc = await import(pathToFileURL(join(DESK, "scripts", "release-channel.mjs")).href);
  const o = (argv) => rc.options(argv, { pkgVersion: "1.6.1", defaultTarget: join(TMP, "dayspring-app") });
  const s = o([]), d = o(["--channel", "dev", "--tag", "v1.7.0-dev.1"]), bad = o(["--channel", "dev"]), bad2 = o(["--channel", "dev", "--tag", "v1.7.0"]), bad3 = o(["--channel", "beta"]);
  rec("A7 release: production is the default, Dayspring.zip, v<package version>", s.channel === "stable" && s.zipName === "Dayspring.zip" && s.tag === "v1.6.1" && !s.errors.length);
  rec("A7 release: development is Dayspring-dev.zip with its -dev tag, in its own export folder", d.channel === "dev" && d.zipName === "Dayspring-dev.zip" && d.version === "1.7.0-dev.1" && d.target.endsWith("dayspring-app-dev") && !d.errors.length);
  rec("A7 release: development needs a -dev tag", bad.errors.length === 1 && /v1\.7\.0-dev\.1/.test(bad.errors[0]) && bad2.errors.length === 1 && bad3.errors.length === 1);
  rec("A7 release: development is a pre-release, never Latest", /--prerelease/.test(rc.ghCommand(d, "x.zip")) && /--latest=false/.test(rc.ghCommand(d, "x.zip")) && !/--prerelease/.test(rc.ghCommand(s, "x.zip")));
  rec("A7 release: build-info.json says the channel", rc.buildInfo({ channel: "dev", version: "1.7.0-dev.1", commit: "abc" }).channel === "dev");
  const release = readFileSync(join(DESK, "scripts", "release.mjs"), "utf8");
  rec("A7 release: both channels run the export's privacy scan and the checks", /export\.mjs/.test(release) && /validateAll/.test(release) && !/if \(channel === "dev"\)[^\n]*export\.mjs/.test(release));
  const u = await lib("updater.mjs");
  rec("A7 versions: dev.10 is after dev.9; the release after its dev builds; dev builds after the last release", u.cmp("1.7.0-dev.10", "1.7.0-dev.9") > 0 && u.cmp("1.7.0", "1.7.0-dev.3") > 0 && u.cmp("1.7.0-dev.1", "1.6.1") > 0 && u.cmp("v1.6.1", "1.6.1") === 0 && u.cmp("1.3.0-beta.1", "1.3.0") < 0); }

// A8. the compatibility data
{ const c = await lib("compat.mjs");
  const probs = c.validateAll();
  rec("A8 compat: every file and entry matches the schema", probs.length === 0, probs.slice(0, 5).join(" | "));
  const d = c.load();
  rec("A8 compat: all twelve categories are there", c.CATEGORIES.every((k) => d.categories.some((x) => x.id === k)), c.CATEGORIES.filter((k) => !d.categories.some((x) => x.id === k)).join(","));
  rec("A8 compat: every not-supported entry says why", d.entries.filter((e) => e.status === "not-supported").every((e) => e.reason));
  rec("A8 compat: every status is used somewhere", c.STATUSES.every((s) => d.entries.some((e) => e.status === s)));
  const ck = JSON.parse(readFileSync(join(DESK, "testing", "checklist.json"), "utf8"));
  const ids = new Set(d.entries.map((e) => e.id)), refs = ck.items.flatMap((t) => t.compat ?? []);
  rec("A8 compat: every device a checklist test names exists", refs.every((r) => ids.has(r)), refs.filter((r) => !ids.has(r)).join(","));
  const v = c.verify("kasa-hs300", { test: "devices-02" });
  rec("A8 compat: a passed test can mark a device verified (and undo)", v?.status === "verified" && v.shippedStatus !== "verified" && c.unverify("kasa-hs300")?.status !== "verified");
  const doc = readFileSync(join(DESK, "docs", "compatibility.md"), "utf8");
  rec("A8 compat: docs/compatibility.md is generated from the same data", d.entries.every((e) => doc.includes(`${e.brand} ${e.model}`.replace(/\|/g, "\\|"))), d.entries.filter((e) => !doc.includes(`${e.brand} ${e.model}`)).map((e) => e.id).slice(0, 5).join(",")); }

// A9. the checklist
{ const ck = JSON.parse(readFileSync(join(DESK, "testing", "checklist.json"), "utf8")).items;
  const fids = new Set(F.ids());
  rec("A9 checklist: ids are unique and every item names a known feature", new Set(ck.map((t) => t.id)).size === ck.length && ck.every((t) => fids.has(t.feature)));
  rec("A9 checklist: every item has steps, an expected result, needs and a safety field", ck.every((t) => Array.isArray(t.steps) && t.steps.length && t.steps.every((s) => typeof s === "string" && s.trim()) && typeof t.expected === "string" && t.expected && Array.isArray(t.needs) && typeof t.safety === "string"));
  rec("A9 checklist: every beta and dev feature has a thorough list, every stable one a smoke test", F.REGISTRY.every((f) => { const n = ck.filter((t) => t.feature === f.id).length; return f.stage === "stable" ? n >= 1 : f.id === "social" ? n >= 3 : n >= 4; }));
  rec("A9 checklist: heat, motion and real email sending carry a safety note", ["printers-07", "email-13"].every((id) => /heat|motion|email/i.test(ck.find((t) => t.id === id)?.safety ?? "")) && ck.filter((t) => /start the print|"send it"/i.test(t.steps.join(" "))).every((t) => t.safety));
  rec("A9 checklist: home-control items follow the plan's stages (simple → complex)", (() => { const st = ck.filter((t) => t.feature === "devices" && t.stage).map((t) => t.stage); return st.every((s, i) => i === 0 || s >= st[i - 1] || s === 1 && st[i - 1] === 3 && i === st.length - 1); })());
  rec("A9 checklist: the registry lists each feature's test ids", F.get("email").checklist.length === ck.filter((t) => t.feature === "email").length && F.get("email").checklist[0] === "email-01");
  rec("A9 checklist: docs/testing-checklist.md is generated from it", (() => { const doc = readFileSync(join(DESK, "docs", "testing-checklist.md"), "utf8"); return ck.every((t) => doc.includes(`### ${t.id}:`)); })()); }

// A10. results, progress, promote, export, promote-features
setChannel("dev");
{ const T = await lib("testing.mjs");
  const mine = T.checklist().items.filter((t) => t.feature === "spotifyresolver");
  T.setResult(mine[0].id, { status: "pass", note: "played the right one" }); T.setResult(mine[1].id, { status: "fail", note: "typo not fixed" });
  let p = T.progress().find((x) => x.feature === "spotifyresolver");
  rec("A10 results: pass/fail recorded with notes and dates, progress counts them", p.pass === 1 && p.fail === 1 && p.total === mine.length && T.results()[mine[0].id].note === "played the right one" && Boolean(T.results()[mine[0].id].at));
  rec("A10 promote refuses until every test passed", (() => { try { T.promote("spotifyresolver"); return false; } catch (e) { return /passed/.test(e.message); } })() && !p.canPromote);
  for (const t of mine) T.setResult(t.id, { status: "pass" });
  p = T.progress().find((x) => x.feature === "spotifyresolver");
  rec("A10 all passed → can promote", p.canPromote && p.pass === p.total);
  const pr = T.promote("spotifyresolver");
  rec("A10 promote: the stage override is written with who and when", pr.stage === "stable" && JSON.parse(readFileSync(join(TMP, "feature-stages.json"), "utf8")).stages.spotifyresolver.verifiedBy === "owner");
  const md = T.exportMarkdown(), csv = T.exportCSV();
  const pm = T.parseExport(md).features, pc = T.parseExport(csv).features;
  rec("A10 export: Markdown and CSV, and both read back", /\| Spotify plays what you asked for \| spotifyresolver \| stable \| 4\/4 \|/.test(md) && /^test,feature,title,result/.test(csv) && pm.spotifyresolver?.pass === 4 && pm.spotifyresolver?.total === 4 && pc.spotifyresolver?.pass === 4 && pm.email?.pass === 0);
  const pf = await import(pathToFileURL(join(DESK, "scripts", "promote-features.mjs")).href);
  const src = readFileSync(join(DESK, "lib", "features.mjs"), "utf8");
  const plan = pf.plan(T.parseExport(md));
  const out = pf.promoteSource(src, "spotifyresolver", plan.promote.find((x) => x.id === "spotifyresolver"));
  const line = out.src.split("\n").find((l) => /\{ id: "spotifyresolver",/.test(l));
  rec("A10 promote-features: bakes the promotion into lib/features.mjs (only that line)", out.changed && /stage: "stable", verifiedBy: "owner", verifiedAt: "\d{4}-\d{2}-\d{2}"/.test(line) && out.src.split("\n").filter((l, i) => l !== src.split("\n")[i]).length === 1 && plan.promote.length === 1 && plan.notReady.some((x) => x.id === "email"));
  const csvPlan = pf.plan(T.parseExport(csv));
  rec("A10 promote-features: reads the CSV export too", csvPlan.promote.length === 1 && csvPlan.promote[0].id === "spotifyresolver");
  T.setResult(mine[0].id, { status: null });
  rec("A10 results: a result can be cleared", !T.results()[mine[0].id]); }
reset(); delete process.env.DAYSPRING_CHANNEL; F._clear();

// ---- B. a throwaway copy, over HTTP and in a headless browser -----------------------------------------------------------
let servers = [];
if (!flag("--module")) {
  const SCRATCH = join(DESK, "node_modules", ".dayspring-features-qa"), APP = join(SCRATCH, "app"), HOME = join(SCRATCH, "home");
  rmSync(SCRATCH, { recursive: true, force: true });
  const SKIP = new Set(["data", ".env", "node_modules", "backups", "dist", "dist-out", "bin", ".git", "qa-out", "logs", "updates", "vmswap.tmp.mjs"]);
  for (const e of readdirSync(DESK)) if (!SKIP.has(e)) cpSync(join(DESK, e), join(APP, e), { recursive: true, filter: (src) => !/\.log$/.test(src) && !/[\\/]badge-previews([\\/]|$)/.test(src) });
  for (const d of ["Documents", "Pictures", "Music", "AppData/Local", "AppData/Roaming"]) mkdirSync(join(HOME, d), { recursive: true });
  const freePort = async (from) => { for (let p = from; p <= 4739; p++) if (await new Promise((ok) => { const s = createServer().once("error", () => ok(false)).once("listening", () => s.close(() => ok(true))).listen(p, "127.0.0.1"); })) return p; throw new Error("ports 4730-4739 are all busy"); };
  async function start(label, channel, seed = {}) {
    const dataDir = join(APP, "data");
    rmSync(dataDir, { recursive: true, force: true }); mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "owner.json"), JSON.stringify({ name: "Sam", setupDone: true, display: "primary", features: { music: false, photos: false, phone: false } }));
    for (const [f, v] of Object.entries(seed)) writeFileSync(join(dataDir, f), JSON.stringify(v));
    const port = await freePort(4730 + servers.length), base = `http://127.0.0.1:${port}`;
    const env = { ...process.env, PORT: String(port), USERPROFILE: HOME, HOME, LOCALAPPDATA: join(HOME, "AppData", "Local"), APPDATA: join(HOME, "AppData", "Roaming"),
      DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_NO_ECO: "1", DAYSPRING_CHANNEL: channel, DAYSPRING_DEV_TOKEN: join(HOME, "no-dev-token.json"), DAYSPRING_UPDATE_REPO: "" };
    for (const k of ["DAYSPRING_FEATURE_SWITCHES", "DAYSPRING_FEATURE_STAGES", "DAYSPRING_TESTING_FILE", "DAYSPRING_COMPAT_VERIFIED", "DAYSPRING_SOCIAL", "DAYSPRING_DATA_DIR"]) delete env[k];
    for (const k of Object.keys(env)) if (/API_KEY|TOKEN$|SECRET|CLIENT_ID|ANTHROPIC|OPENAI|ELEVEN/i.test(k) && k !== "DAYSPRING_DEV_TOKEN") delete env[k];
    const out = openSync(join(SCRATCH, `server-${label}.log`), "a");
    const child = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", out, out], windowsHide: true });
    servers.push(child);
    let up = false;
    for (let i = 0; i < 90 && !up; i++) { await sleep(500); try { up = (await fetch(base + "/api/features")).ok; } catch { /* starting */ } }
    rec(`B ${label}: the throwaway copy starts (${base})`, up, up ? "" : readFileSync(join(SCRATCH, `server-${label}.log`), "utf8").slice(-400));
    return { base, child, up };
  }
  async function stop(s) { if (!s?.child) return; s.child.kill(); for (let i = 0; i < 20 && s.child.exitCode === null; i++) await sleep(250); }
  const code = async (base, path, init) => { try { return (await fetch(base + path, init)).status; } catch { return 0; } };
  const json = async (base, path, body) => { const r = await fetch(base + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

  let browser = null;
  try {
    // ---- production, with the media library switched off by the owner
    const prod = await start("production", "stable", { "feature-switches.json": { off: ["medialib"] } });
    if (prod.up) {
      await sleep(1500);
      const st = (await json(prod.base, "/api/features")).body;
      rec("B production: /api/features says production", st.channel === "stable" && st.features.find((f) => f.id === "gifs")?.on === false && st.features.find((f) => f.id === "money")?.on === true);
      const codes = await Promise.all(["/api/gifs/search?q=cat", "/api/gifs/state", "/api/mail/status", "/api/remote/status", "/api/testing", "/api/media/local/status"].map((p) => code(prod.base, p)));
      rec("B production: dev feature routes, Testing and the switched-off media library answer 404", codes.every((c) => c === 404), codes.join(" "));
      rec("B production: GIF page gone, Money page there", (await code(prod.base, "/gifs.html")) === 404 && (await code(prod.base, "/money.html")) === 200);
      rec("B production: a beta route answers", (await code(prod.base, "/api/money/state")) === 200);
      rec("B production: the switched-off feature's background job didn't start", st.jobs.some((j) => j.job === "medialib.sources" && j.started === false) && !st.jobs.some((j) => j.job === "medialib.sources" && j.started));
      const sw = await json(prod.base, "/api/features/switch", { id: "money", on: false });
      rec("B production: the owner switches a beta feature off → 404", sw.status === 200 && (await code(prod.base, "/api/money/state")) === 404);
      await json(prod.base, "/api/features/switch", { id: "money", on: true });
      rec("B production: …and back on", (await code(prod.base, "/api/money/state")) === 200);
      const devSw = await json(prod.base, "/api/features/switch", { id: "gifs", on: true });
      rec("B production: a dev feature can't be switched on", devSw.status === 400 && (await code(prod.base, "/api/gifs/state")) === 404);
      const gate = await (await fetch(prod.base + "/api/features/gate.js")).text();
      rec("B production: gate.js hides the GIF and Mail buttons", /#gifsBtn/.test(gate) && /#mailBtn/.test(gate) && /"channel":"stable"/.test(gate));
      rec("B production: the compatibility list is served", (await json(prod.base, "/api/compat")).body.entries?.length > 100);
      const chat = await json(prod.base, "/api/chat", { message: "show me a gif of a dancing cat", surface: "desk" });
      rec("B production: \"show me a GIF\" isn't handled as a GIF", chat.status === 200 && chat.body.intent !== "gifs", `${chat.body.intent ?? ""}: ${String(chat.body.reply ?? "").slice(0, 80)}`);
    }

    // ---- the headless browser: production Settings
    // playwright-core: this app's own copy, else the export checkout's (next to the dayspring project)
    const PW = [join(DESK, "node_modules", "playwright-core", "index.mjs"), join(DESK, "..", "..", "..", "dayspring-app", "node_modules", "playwright-core", "index.mjs")].find((p) => existsSync(p));
    if (!PW) throw new Error("playwright-core not found");
    const pw = await import(pathToFileURL(PW).href);
    const chromium = pw.chromium ?? pw.default?.chromium;
    browser = await chromium.launch({ executablePath: join(process.env.ProgramFiles || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"), headless: true, args: ["--mute-audio", "--no-first-run", "--no-default-browser-check"] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const pageErrors = []; page.on("pageerror", (e) => pageErrors.push(e.message));
    page.on("dialog", (d) => d.accept());
    if (prod.up) {
      await page.goto(prod.base + "/setup?s=featurelist", { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#fuList .fu-row", { timeout: 15000 });
      const nav = await page.$$eval("#nav button", (bs) => bs.map((b) => b.textContent.trim()));
      rec("B UI production: Settings has Features and Compatibility, no Testing, GIFs or Email", nav.some((t) => /Features$/.test(t)) && nav.some((t) => /Compatibility/.test(t)) && !nav.some((t) => /Testing|GIFs|Email/.test(t)), nav.join(" | "));
      const newCount = await page.$$eval(".fu-new", (x) => x.length);
      const devRows = await page.$$eval('.fu-row[data-id="gifs"] .fu-state', (x) => x.map((e) => e.textContent));
      rec("B UI production: New features are marked, in-progress ones say they aren't in this version", newCount >= 10 && devRows[0] === "Not in this version", `${newCount} New; ${devRows}`);
      await page.click('[data-sw="money"]'); await sleep(600);
      rec("B UI production: a beta switch works from the page", (await code(prod.base, "/api/money/state")) === 404);
      await page.click('[data-sw="money"]'); await sleep(600);
      // Compatibility: renders and filters
      await page.goto(prod.base + "/setup?s=compat", { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#cpList .fu-card", { timeout: 15000 });
      const all = await page.$$eval("#cpList .fu-card", (x) => x.length);
      await page.fill("#cpQ", "HS300"); await sleep(200);
      const hs = await page.$$eval("#cpList .fu-card header b", (x) => x.map((e) => e.textContent));
      await page.fill("#cpQ", ""); await page.selectOption("#cpCat", "printers"); await page.selectOption("#cpStatus", "not-supported"); await sleep(200);
      const cats = await page.$$eval("#cpList .fu-card .fu-meta", (x) => x.map((e) => e.textContent));
      const chips = await page.$$eval("#cpList .fu-card .fu-chip", (x) => x.map((e) => e.textContent));
      await page.selectOption("#cpStatus", ""); await page.selectOption("#cpCat", ""); await page.check("#cpOffline"); await sleep(200);
      const offlineCount = await page.$$eval("#cpList .fu-card", (x) => x.length), cloudShown = await page.$$eval("#cpList .fu-card .fu-meta", (x) => x.some((e) => /needs the internet/.test(e.textContent)));
      rec("B UI compat: renders every entry", all > 100, `${all} cards`);
      rec("B UI compat: search finds the HS300", hs.length >= 1 && hs.every((t) => /HS300/.test(t)), hs.join(", "));
      rec("B UI compat: category and status filters", cats.length >= 0 && cats.every((t) => /3D printers/i.test(t)) && chips.every((t) => /Not supported/.test(t)));
      rec("B UI compat: works-offline filter", offlineCount > 0 && offlineCount < all && !cloudShown, `${offlineCount}`);
      await page.uncheck("#cpOffline"); await page.fill("#cpQ", "HS300"); await sleep(200);
      await page.click("#cpList .fu-card details summary"); await sleep(150);
      rec("B UI compat: setup steps open per device", (await page.$$eval("#cpList .fu-card details[open] ol li", (x) => x.length)) >= 2);
      // the Dayspring screen's gate
      await page.goto(prod.base + "/display", { waitUntil: "domcontentloaded" }); await sleep(2500);
      const scr = await page.evaluate(() => ({ ds: Boolean(window.dsFeatures), gifs: window.dsFeatures?.on("gifs"), money: window.dsFeatures?.on("money"), gifsBtnVisible: (() => { const b = document.getElementById("gifsBtn"); return Boolean(b && b.offsetParent); })(), style: Boolean(document.getElementById("dsFeatureGate")) }));
      rec("B UI screen (production): the gate is loaded, the GIF button isn't shown", scr.ds && scr.gifs === false && scr.money === true && !scr.gifsBtnVisible && scr.style, JSON.stringify(scr));
    }
    await stop(prod);

    // ---- development
    const dev = await start("development", "dev");
    if (dev.up) {
      await sleep(1000);
      const st = (await json(dev.base, "/api/features")).body;
      rec("B development: every feature is on, nothing hidden", st.channel === "dev" && st.features.every((f) => f.on) && st.hiddenSections.length === 0);
      rec("B development: dev routes and Testing answer", (await code(dev.base, "/api/testing")) === 200 && (await code(dev.base, "/api/gifs/state")) !== 404);
      rec("B development: background jobs start", st.jobs.some((j) => j.job === "medialib.sources" && j.started));
      // the Testing page: pass/fail, progress, promote, export
      await page.goto(dev.base + "/setup?s=testing", { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#tsProg .fu-pg", { timeout: 15000 });
      const nav = await page.$$eval("#nav button", (bs) => bs.map((b) => b.textContent.trim()));
      rec("B UI development: Settings shows Testing", nav.some((t) => /Testing/.test(t)));
      await page.selectOption("#tsFeat", "devpreview"); await sleep(200);
      const tests = await page.$$eval("#tsList [data-t]", (x) => x.map((e) => e.dataset.t));
      await page.click(`[data-t="${tests[0]}"] [data-r="fail"]`); await sleep(400);
      const failTxt = await page.textContent('#tsProg .fu-pg[data-f="devpreview"]');
      rec("B UI testing: Fail is recorded and counted", /0\/4 passed/.test(failTxt) && /1 failed/.test(failTxt), failTxt.replace(/\s+/g, " ").slice(0, 120));
      rec("B UI testing: Promote stays off until every test passes", await page.$eval('[data-promote="devpreview"]', (b) => b.disabled));
      for (const id of tests) { await page.fill(`[data-t="${id}"] .fu-note`, `checked ${id}`); await page.click(`[data-t="${id}"] [data-r="pass"]`); await sleep(300); }
      const progTxt = await page.textContent('#tsProg .fu-pg[data-f="devpreview"]');
      rec("B UI testing: progress shows 4/4 passed", /4\/4 passed/.test(progTxt), progTxt.replace(/\s+/g, " ").slice(0, 120));
      const saved = (await json(dev.base, "/api/testing")).body.results;
      rec("B UI testing: results saved with notes and dates", tests.every((id) => saved[id]?.status === "pass" && saved[id].note === `checked ${id}` && saved[id].at));
      await page.click('[data-promote="devpreview"]'); await sleep(700);
      const after = (await json(dev.base, "/api/features")).body.features.find((f) => f.id === "devpreview");
      rec("B UI testing: Promote to stable updates the stage, with who and when", after.stage === "stable" && after.verifiedBy === "owner" && Boolean(after.verifiedAt));
      const exp = await fetch(dev.base + "/api/testing/export?format=md"); const md = await exp.text();
      const expCsv = await (await fetch(dev.base + "/api/testing/export?format=csv")).text();
      rec("B UI testing: export as Markdown and CSV", exp.headers.get("content-disposition")?.includes(".md") && /\| devpreview \| stable \| 4\/4 \|/.test(md) && /devpreview-01,devpreview,/.test(expCsv));
      const hrefs = await page.$$eval("#tsMd, #tsCsv", (x) => x.map((a) => a.getAttribute("href")));
      rec("B UI testing: the export buttons point at the export", hrefs.join(" ") === "/api/testing/export?format=md /api/testing/export?format=csv");
      // a passed test with a device can verify it on the compatibility list
      await page.selectOption("#tsFeat", "devices"); await sleep(200);
      await page.click('[data-t="devices-02"] [data-r="pass"]'); await sleep(400);
      await page.click('[data-t="devices-02"] [data-verify="kasa-hs300"]'); await sleep(500);
      const hs300 = (await json(dev.base, "/api/compat")).body.entries.find((e) => e.id === "kasa-hs300");
      rec("B UI testing: a passed test marks its device verified on the compatibility list", hs300?.status === "verified" && hs300.verifiedTest === "devices-02");
    }
    rec("B UI: no script errors on the pages", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
    await stop(dev);
  } catch (e) { rec("B: ran without an unexpected error", false, e.stack ?? e.message); }
  finally {
    try { await browser?.close(); } catch { /* gone */ }
    for (const s of servers) try { s.kill(); } catch { /* gone */ }
    await sleep(500);
    if (!flag("--keep")) try { rmSync(SCRATCH, { recursive: true, force: true }); } catch { console.log("(some test files are still in use: " + SCRATCH + ")"); }
  }
}
rmSync(TMP, { recursive: true, force: true });
console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
