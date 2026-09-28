// Production-channel smoke check: a fresh export with build-info.json saying channel "stable" (what Dayspring.zip ships)
// starts, every development feature is gone (its API routes and pages 404, its Settings sections, buttons, AI tools, voice
// commands and background jobs are off), and the beta and stable features still work. On a throwaway copy (its own data,
// a spare port, no keys, nothing heard or opened); the owner's own Dayspring and data are never touched.
//   node scripts/qa/prod-channel.mjs [--keep]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TMP = mkdtempSync(join(tmpdir(), "ds-prodchan-")), APP = join(TMP, "app");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && got !== "" ? "  (" + String(typeof got === "string" ? got : JSON.stringify(got)).slice(0, 300) + ")" : ""}`); };
const freePort = () => new Promise((r) => { const s = createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });

const ex = spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
check("the export (with its privacy scan) succeeds", ex.status === 0, (ex.stdout + ex.stderr).slice(-300));
const version = JSON.parse(readFileSync(join(APP, "package.json"), "utf8")).version;
writeFileSync(join(APP, "build-info.json"), JSON.stringify({ channel: "stable", version, commit: null, built: new Date().toISOString() }, null, 2));
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(join(APP, "data"), { recursive: true });
writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary" }));

const PORT = await freePort(), BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_NO_ECO: "1",
  ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", ELEVENLABS_API_KEY: "", AI_PROVIDER: "", DAYSPRING_REMINDER_CHANNEL: "off", LOCALAPPDATA: join(TMP, "local"), APPDATA: join(TMP, "roaming") };
delete env.DAYSPRING_CHANNEL;   // the build's own channel decides, as it does for a real install
mkdirSync(env.LOCALAPPDATA, { recursive: true }); mkdirSync(env.APPDATA, { recursive: true });
let log = "";
const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
server.stdout.on("data", (d) => { log += d; }); server.stderr.on("data", (d) => { log += d; });
const get = async (p) => { try { const r = await fetch(BASE + p, { signal: AbortSignal.timeout(15000) }); return { status: r.status, text: await r.text() }; } catch (e) { return { status: 0, text: e.message }; } };
const json = async (p) => { const r = await get(p); try { return JSON.parse(r.text); } catch { return null; } };
const chat = async (text) => { try { const r = await fetch(BASE + "/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, message: text, typed: true, surface: "desk" }), signal: AbortSignal.timeout(30000) }); const j = await r.json(); return String(j.reply ?? j.error ?? ""); } catch (e) { return "ERR " + e.message; } };

try {
  let up = false;
  for (let i = 0; i < 90 && !up; i++) { up = (await get("/api/build")).status === 200; if (!up) await sleep(500); }
  check("a production build starts", up, log.slice(-400));
  const st = await json("/api/features");
  check("it knows it's production (build-info.json: channel stable)", st?.channel === "stable" && st?.build?.from === "build-info" && st?.build?.version === version, JSON.stringify(st?.build));
  const DEV = ["email", "gifs", "devices", "printers", "cameras", "remote", "social"];
  const f = (id) => st?.features?.find((x) => x.id === id);
  check("every development feature is off", DEV.every((id) => f(id) && f(id).on === false && f(id).stage === "dev"), DEV.filter((id) => f(id)?.on !== false).join(", "));
  check("…and can't be switched on here (no developer token)", DEV.every((id) => f(id)?.switchable === false));
  // routes and pages
  const routes = ["/api/mail/list", "/api/mail/accounts", "/api/gifs/search?q=cat", "/api/gifs/state", "/api/smarthome", "/api/smarthome/status", "/api/printers", "/api/cameras", "/api/cameras/summary", "/api/remote/status", "/api/remote/devices"];
  const r404 = []; for (const p of routes) { const r = await get(p); if (r.status !== 404) r404.push(`${p} ${r.status}`); }
  check("their API routes all answer 404", r404.length === 0, r404.join(", "));
  const pages = ["/gifs.html", "/gifs", "/smarthome.html", "/printers.html", "/cameras.html", "/remote-view.html"];
  const p404 = []; for (const p of pages) { const r = await get(p); if (r.status !== 404) p404.push(`${p} ${r.status}`); }
  check("their pages all answer 404", p404.length === 0, p404.join(", "));
  const hid = st?.hiddenSections ?? [];
  check("their Settings sections are hidden (and Testing)", ["email", "gifs", "devices", "printers", "cameras", "remote", "testing"].every((s) => hid.includes(s)), hid.join(", "));
  const sel = st?.ui?.selectors ?? [];
  check("their buttons on the screen are hidden", ["#mailBtn", "#gifsBtn", "#devicesBtn", "#printersBtn", "#camerasBtn"].every((s) => sel.includes(s)), sel.join(" "));
  const gate = await get("/api/features/gate.js");
  check("the screen's gate script hides them too", gate.status === 200 && /#mailBtn/.test(gate.text) && /#camerasBtn/.test(gate.text));
  await sleep(2500);
  const jobs = (await json("/api/features"))?.jobs ?? [];
  const devJobs = jobs.filter((j) => DEV.includes(j.feature));
  check("none of their background jobs started", devJobs.length > 0 && devJobs.every((j) => j.started === false), JSON.stringify(devJobs.filter((j) => j.started)));
  check("the Testing page is hidden", (await get("/api/testing")).status === 404);
  // voice (no AI): nothing reaches a development feature
  const em = await chat("check my email");
  check("\"check my email\" says email isn't in this version", /isn't turned on in this version/i.test(em), em);
  const tv = await chat("is the tv on");
  check("\"is the tv on\" doesn't reach smart devices", !/device|outlet|Settings → Smart devices/i.test(tv) || /isn't turned on/i.test(tv), tv);
  const gif = await chat("show me a gif of a cat");
  check("\"show me a gif of a cat\" doesn't open the GIF feature (at most a picture search)", !/GIF picker|GIPHY|KLIPY|Imgur|favourite/i.test(gif), gif);
  // beta features: on, marked New, and their routes answer
  const BETA = ["money", "images", "vision", "faces", "medialib", "drive", "meetnotes", "meetinvite", "screenmove", "popfit", "floor", "spotifyresolver", "devpreview"];
  check("every beta feature is on and marked New", BETA.every((id) => f(id)?.on === true && f(id)?.isNew === true), BETA.filter((id) => !(f(id)?.on && f(id)?.isNew)).join(", "));
  const betaRoutes = ["/api/money/state", "/api/media/local/status"];
  const bad = []; for (const p of betaRoutes) { const r = await get(p); if (r.status === 404 || r.status >= 500 || r.status === 0) bad.push(`${p} ${r.status}`); }
  check("beta routes answer (money, your own media)", bad.length === 0, bad.join(", "));
  check("the money page is served", (await get("/money.html")).status === 200);
  const pics = await chat("show me pictures of golden retrievers");
  check("beta: \"show me pictures of …\" is understood (pictures from the web)", /picture|image|golden|show/i.test(pics) && !/didn't catch|Did you mean/i.test(pics), pics);
  // stable features
  check("stable: every stable feature is on", st.features.filter((x) => x.buildStage === "stable").every((x) => x.on === true));
  const t = await chat("what time is it");
  check("stable: \"what time is it\" answers", /\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)/i.test(t), t);
  const now = await chat("what's on right now?");
  check("stable: \"what's on right now?\" answers from the schedule", /Today|scheduled|Right now it's|Next is|nothing/i.test(now) && !/Devices on/i.test(now), now);
  const timer = await chat("set a timer for 5 minutes");
  check("stable: a timer can be set", /timer|5 minutes|five minutes/i.test(timer), timer);
  check("stable: Settings and the screen load", (await get("/setup.html")).status === 200 && (await get("/tv.html")).status === 200 && (await get("/api/settings")).status === 200);
  check("stable: the compatibility list is there (production too)", (await get("/api/compat")).status === 200);
  check("no server errors", !/TypeError|ReferenceError|Unhandled|uncaught/i.test(log), log.match(/.*(TypeError|ReferenceError|Unhandled|uncaught).*/i)?.[0]);
} catch (e) {
  check("the run finished without a crash", false, e?.stack ?? e);
} finally {
  try { server.kill(); } catch { /* gone */ }
  await sleep(800);
  if (!process.argv.includes("--keep")) { spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true }); try { rmSync(TMP, { recursive: true, force: true }); } catch { /* in use */ } }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
