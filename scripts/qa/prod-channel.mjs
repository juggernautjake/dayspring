// Production-channel smoke check: a fresh export with build-info.json saying channel "stable" (what Dayspring.zip ships)
// starts, every development feature is gone (its API routes and pages 404, its Settings sections, buttons, AI tools, voice
// commands and background jobs are off), and the beta and stable features still work. On a throwaway copy (its own data,
// a spare port, no keys, nothing heard or opened); the owner's own Dayspring and data are never touched.
//   node scripts/qa/prod-channel.mjs [--keep]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const OLPORT = await freePort();   // a pretend Ollama (scripts/qa/ollama-mock.mjs), started part-way: live detection
const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_NO_ECO: "1",
  ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", ELEVENLABS_API_KEY: "", AI_PROVIDER: "", OLLAMA_URL: `http://127.0.0.1:${OLPORT}`, DAYSPRING_OLLAMA_EXE: join(TMP, "no-ollama.exe"), DAYSPRING_REMINDER_CHANNEL: "off", LOCALAPPDATA: join(TMP, "local"), APPDATA: join(TMP, "roaming") };
delete env.DAYSPRING_CHANNEL;   // the build's own channel decides, as it does for a real install
mkdirSync(env.LOCALAPPDATA, { recursive: true }); mkdirSync(env.APPDATA, { recursive: true });
let log = "";
const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
server.stdout.on("data", (d) => { log += d; }); server.stderr.on("data", (d) => { log += d; });
const get = async (p) => { try { const r = await fetch(BASE + p, { signal: AbortSignal.timeout(15000) }); return { status: r.status, text: await r.text() }; } catch (e) { return { status: 0, text: e.message }; } };
const json = async (p) => { const r = await get(p); try { return JSON.parse(r.text); } catch { return null; } };
const chatJ = async (text) => { try { const r = await fetch(BASE + "/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, message: text, typed: true, surface: "desk" }), signal: AbortSignal.timeout(30000) }); return await r.json(); } catch (e) { return { error: e.message }; } };
const chat = async (text) => { try { const r = await fetch(BASE + "/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, message: text, typed: true, surface: "desk" }), signal: AbortSignal.timeout(30000) }); const j = await r.json(); return String(j.reply ?? j.error ?? ""); } catch (e) { return "ERR " + e.message; } };

try {
  let up = false;
  for (let i = 0; i < 90 && !up; i++) { up = (await get("/api/build")).status === 200; if (!up) await sleep(500); }
  check("a production build starts", up, log.slice(-400));
  const st = await json("/api/features");
  check("it knows it's production (build-info.json: channel stable)", st?.channel === "stable" && st?.build?.from === "build-info" && st?.build?.version === version, JSON.stringify(st?.build));
  const DEV = ["email", "gifs", "devices", "printers", "cameras", "remote", "social", "commands", "maps"];
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
  const BETA = ["money", "images", "vision", "faces", "medialib", "drive", "meetnotes", "meetinvite", "screenmove", "popfit", "floor", "spotifyresolver", "devpreview", "fileviewer", "conversation", "naming"];
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
  // ---- 1.7.3: the fixes a production user asked for, even though the rest of "commands" is development-only ----
  const water = await chat("remind me to drink water at 11pm");
  const tm = (await json("/api/timers")) ?? {};
  check("1.7.3: \"remind me to drink water at 11pm\" is one reminder at 11 p.m., never an hourly one", /\b11\b/.test(water) && /p\.?\s?m/i.test(water) && !/every hour|every 1 hour|hourly/i.test(water)
    && !(tm.timers ?? []).some((x) => /water/i.test(x.label ?? "") && x.every), `${water} · timers ${JSON.stringify((tm.timers ?? []).map((x) => [x.label, x.every]))}`);
  const water2 = await chat("remind me to drink water every day at 7am");
  check("…and \"every day at 7am\" is a daily one at 7 (not hourly)", /\b7\b/.test(water2) && !/every hour|hourly/i.test(water2), water2);
  const bye = await chatJ("thanks, that's all");
  check("1.7.3: \"thanks, that's all\" ends the conversation at once (close, in production)", bye?.close === true && String(bye.reply ?? "").length < 60, JSON.stringify(bye));
  const q1 = await chatJ("add dentist tomorrow at 3pm");
  const nt = await chatJ("no thanks, that's all");
  check("1.7.3: \"no thanks, that's all\" to a follow-up question drops it and closes", nt?.close === true && !/\?$/.test(String(nt.reply ?? "")), `${q1?.reply} → ${JSON.stringify(nt)}`);
  const stopR = await fetch(BASE + "/api/commands/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ surface: "tv", said: "stop" }) }).then((r) => r.status).catch(() => 0);
  check("1.7.3: \"stop\" reaches the server in production (/api/commands/stop), the rest of /api/commands doesn't", stopR === 200 && (await get("/api/commands/state")).status === 404, `stop ${stopR}`);
  const key = await chat("check my Claude connection");
  check("1.7.3: \"check my Claude connection\" with no key: a plain answer that says where to add one", /no Claude key saved/i.test(key) && /Settings/.test(key), key);
  const keyBtn = await fetch(BASE + "/api/setup/ai/check", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.json()).catch(() => null);
  check("…and the Settings button (Check) answers the same way", keyBtn?.ok === false && keyBtn?.present === false && /no Claude key saved/i.test(keyBtn?.text ?? ""), JSON.stringify(keyBtn));
  const olBefore = (await json("/api/setup/ollama/status?fresh=1"))?.status;
  const { startMock } = await import(new URL("./ollama-mock.mjs", import.meta.url).href);
  const ol = await startMock({ port: OLPORT });
  const olAfter = (await json("/api/setup/ollama/status?fresh=1"))?.status;
  check("1.7.3: Ollama is detected live (not running → started → running, no restart)", olBefore && olBefore.running === false && olAfter?.running === true, `${JSON.stringify(olBefore?.state)} → ${JSON.stringify(olAfter?.state)}`);
  const sw = await json("/api/ai/switch?fresh=1");
  check("…and the quick switch offers Claude · Ollama · No AI, with Ollama available", ["anthropic", "ollama", "none"].every((id) => sw?.options?.some((o) => o.id === id)) && sw.options.find((o) => o.id === "ollama")?.available === true, JSON.stringify(sw?.options?.map((o) => [o.id, o.available])));
  const useOl = await chat("use ollama");
  const offAi = await chat("turn off the AI");
  const cur = (await json("/api/ai/switch"))?.current;
  check("1.7.3: \"use Ollama\" then \"turn off the AI\" (the No AI switch) work by voice", /ollama|local/i.test(useOl) && /no AI/i.test(offAi) && cur === "none", `${useOl} / ${offAi} / ${cur}`);
  await ol.close();
  // the stop phrase on the screen itself: production's gate lets it through (headless Chrome, muted, nothing heard)
  const PW = [join(DESK, "node_modules", "playwright-core", "index.mjs"), join(DESK, "..", "..", "..", "dayspring-app", "node_modules", "playwright-core", "index.mjs")].find((p) => existsSync(p));
  const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  if (PW && existsSync(CHROME)) {
    const { chromium } = await import(pathToFileURL(PW).href);
    const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      await ctx.addInitScript(() => { window.__dsAllowAutomatedListen = true; const ss = window.speechSynthesis; if (ss) { ss.speak = (u) => setTimeout(() => u.onend?.(), 10); ss.cancel = () => {}; } class FakeSR { start() {} abort() { setTimeout(() => this.onend?.(), 5); } stop() { this.abort(); } } window.SpeechRecognition = window.webkitSpeechRecognition = FakeSR; });
      await ctx.route("**/api/{sound,window,open,keepawake,tunein,callbridge}**", (rt) => rt.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
      const pg = await ctx.newPage();
      await pg.goto(BASE + "/display"); await pg.waitForTimeout(2500);
      const sp = await pg.evaluate(() => ({ conv: window.dsFeatures?.on("conversation"), cmds: window.dsFeatures?.on("commands"), stop: window.dsStopPhrase?.test("stop"), enough: window.dsStopPhrase?.test("that's enough"), shh: window.dsStopPhrase?.test("okay shh"), notStop: window.dsStopPhrase?.test("stop the timer") }));
      check("1.7.3: on the production screen, \"stop\", \"that's enough\" and \"okay shh\" are stop phrases (\"stop the timer\" isn't)", sp.conv === true && sp.cmds === false && sp.stop && sp.enough && sp.shh && !sp.notStop, JSON.stringify(sp));
      // barge-in while it's talking: cut off, and the listening stays on (never the stopped state)
      const cut = await pg.evaluate(async () => {
        const at0 = window.dsStopPhrase.at;
        window.speechSynthesis.speak = () => {};          // a reply that "keeps talking"
        window.dispatchEvent(new CustomEvent("ds-test-say", { detail: { text: "Here is a very long answer that goes on and on for quite a while." } }));
        await new Promise((r) => setTimeout(r, 400));
        window.dispatchEvent(new CustomEvent("ds-test-interim", { detail: "that's enough" }));
        await new Promise((r) => setTimeout(r, 400));
        let stopped = null; try { stopped = sessionStorage.getItem("ds-stopped-listening"); } catch { /* none */ }
        return { cut: window.dsStopPhrase.at > at0, mode: window.__dsTest?.mode?.(), stopped, listen: window.dsListenState };
      });
      check("…said over its voice, it cuts the speech off and doesn't stop listening", cut.cut && cut.stopped !== "1" && cut.listen !== "off" && cut.mode === "idle", JSON.stringify(cut));
    } finally { await browser.close(); }
  } else console.log("(skipped the screen's stop-phrase check: no Chrome or playwright-core)");
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
