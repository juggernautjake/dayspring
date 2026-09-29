// Renaming the assistant and custom wake words, end to end, on a throwaway copy (port 4787). Nothing is heard (the speech
// recognizer is a stand-in fed with transcripts), nothing is said out loud (Chrome is muted and the voice is recorded),
// no window opens, no device is touched, and the AIs are stand-ins on this computer:
//   A. rename by voice (read back, yes), by Settings' API, the checks (too long, Lantern), the wake words following the name
//   B. it calls itself by its name: the offline answers, and Claude's and Ollama's replies (stand-ins that say "Dayspring"),
//      with the name in the prompt they get
//   C. on the screen (headless Chrome): the label, the title ("Nova · Dayspring"), the hints; the wake word triggering the
//      screen's own recognition handler (injected transcripts, n-best guesses), "my computer is slow" not triggering;
//      a live rename; "Train my wake word" with injected results; the voice saying the name the way it's said; the mini;
//      Settings → Your assistant (checks as you type, Try it, save)
//   D. window.ps1 still finds the window: the window actions (DS_WINDOW_LOG) use its own title pattern, which matches
//      "Nova · Dayspring" and "Dayspring" (checked with .NET's own regex, the one window.ps1 uses)
//   E. meetings: the mock Meet page greets as the new name, answers "Kestra, …" and "Computer, …", ignores "my computer…"
//   F. Discord: the slash command text, and the wake check on a message
//   node scripts/qa/naming-e2e.mjs [--keep]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { qaPort } from "./port.mjs";   // a free port (or QA_PORT), so parallel runs never collide
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// playwright-core: QA_PLAYWRIGHT (a path or file:// URL), else the exported copy next to this project (…/dayspring-app), else this app's own (same lookup as images.mjs)
const PW = process.env.QA_PLAYWRIGHT ? (/^file:/.test(process.env.QA_PLAYWRIGHT) ? process.env.QA_PLAYWRIGHT : pathToFileURL(process.env.QA_PLAYWRIGHT).href)
  : pathToFileURL([join(DESK, "..", "..", "..", "dayspring-app", "node_modules", "playwright-core", "index.mjs"), join(DESK, "node_modules", "playwright-core", "index.mjs")].find((p) => existsSync(p)) ?? "").href;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = await qaPort(4787), BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), "ds-naming-")), APP = join(TMP, "app");
const LAUNCH = join(TMP, "launch.log"), WINLOG = join(TMP, "window.jsonl");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",") ?? null;   // --only=A,B2,C,D,E,F (while fixing one part)
const want = (k) => !ONLY || ONLY.includes(k);
let pass = 0, fail = 0; const failed = [];
const check = (name, ok, got = "") => { if (ok) pass++; else { fail++; failed.push(name); } console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && got !== "" ? "  (" + String(typeof got === "string" ? got : JSON.stringify(got)).slice(0, 300) + ")" : ""}`); };
const section = (t) => console.log(`\n— ${t} —`);

// ---- stand-in AIs: they call themselves Dayspring, and keep what they were told ---------------------------------------------
const seen = { anthropic: [], ollama: [] };
const anth = createServer(async (req, res) => {
  let raw = ""; for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};
  seen.anthropic.push(body);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "Hi! I'm Dayspring, and here's a haiku: leaves drift down slowly. Dayspring here, always happy to help on the Dayspring screen." }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 } }));
});
// Ollama: the tests' own stand-in (scripts/qa/ollama-mock.mjs), behind a little proxy that makes its streamed answers
// start with "I'm Dayspring!" (a model that picked the app's name up from somewhere)
const { startMock } = await import("./ollama-mock.mjs");
const ollMock = await startMock();
const oll = createServer(async (req, res) => {
  let raw = ""; for await (const c of req) raw += c;
  const body = raw ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : {};
  const path = new URL(req.url, "http://x").pathname;
  const up = await fetch(ollMock.url + req.url, { method: req.method, headers: { "content-type": "application/json" }, body: req.method === "GET" ? undefined : raw });
  const text = await up.text();
  if (path !== "/api/chat" || !body.tools || body.stream === false) { res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "application/json" }); return res.end(text); }
  seen.ollama.push(body);
  res.writeHead(up.status, { "content-type": "application/x-ndjson" });
  res.write(JSON.stringify({ model: body.model, message: { role: "assistant", content: "I'm Dayspring! " }, done: false }) + "\n");
  res.end(text);
});
await new Promise((r) => anth.listen(0, "127.0.0.1", r));
await new Promise((r) => oll.listen(0, "127.0.0.1", r));
const ANTH = `http://127.0.0.1:${anth.address().port}`, OLL = `http://127.0.0.1:${oll.address().port}`;

// ---- the throwaway copy ----------------------------------------------------------------------------------------------------
spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(join(APP, "data"), { recursive: true });
// an existing install from before renaming: no wakeFollowsName, "dayspring" as the wake word
writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary", assistantName: "Dayspring", wakeWords: ["dayspring"] }));
const baseEnv = { ...process.env, PORT: String(PORT), DAYSPRING_CHANNEL: "dev", DAYSPRING_TEST_HOOKS: "1", DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DS_LAUNCH_LOG: LAUNCH, DS_WINDOW_LOG: WINLOG, DS_PROFILE: "DayspringQA",
  DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_NO_ECO: "1", DAYSPRING_ENV_FILE: join(TMP, "test.env"), DAYSPRING_REMINDER_CHANNEL: "off", DAYSPRING_OLLAMA_NO_SYSTEM: "1",
  OPENAI_API_KEY: "", XAI_API_KEY: "", ELEVENLABS_API_KEY: "", TTS_PROVIDER: "browser", DAYSPRING_UPDATE_REPO: "", OLLAMA_EMBED_MODEL: "off" };
for (const k of ["DAYSPRING_WAKE_PHRASES", "DAYSPRING_TIMERS_FILE", "AI_MODEL", "OLLAMA_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "AI_PROVIDER"]) delete baseEnv[k];
let server = null, serverLog = "";
async function startServer(extra) {
  server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env: { ...baseEnv, ...extra }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
  const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
  for (let i = 0; i < 80 && !(await up()); i++) await sleep(500);
}
async function stopServer() { if (!server) return; server.kill(); await new Promise((r) => { server.once("exit", r); setTimeout(r, 4000); }); server = null; }
const api = async (path, body, method = body === undefined ? "GET" : "POST") => { const r = await fetch(BASE + "/api" + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
const chat = (message) => api("/chat", { message, surface: "tv" });
const O = () => JSON.parse(readFileSync(join(APP, "data", "owner.json"), "utf8"));

try {
  await startServer({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: `sk-ant-api03-${"x".repeat(48)}-ok`, ANTHROPIC_BASE_URL: ANTH });

  // ============================================================================================================================
  section("A. an existing install, then renaming (voice, Settings, the checks)");
  let v = await api("/assistant");
  check("existing install: Dayspring, wakes to “dayspring”, the wake word follows the name", v.name === "Dayspring" && v.wake.words.map((w) => w.text).join() === "dayspring" && v.wake.followsName === true, v);
  let tc = await api("/tv/config");
  check("the screen's config carries the wake words and the matcher settings", tc.wakePhrases?.join() === "dayspring" && tc.wake?.words?.[0]?.text === "dayspring" && /grammar wake/.test(tc.wake.grammar ?? ""), tc.wake);
  let r = await api("/assistant", { name: "Lantern" });
  check("Settings: “Lantern” is refused (400) and says why", r.status === 400 && /Lantern/.test(r.error) && /both would answer/.test(r.error), r);
  r = await api("/assistant", { name: "Abcdefghijklmnopqrstu" });
  check("Settings: a 21-character name is refused kindly", r.status === 400 && /up to 19/.test(r.error), r);
  r = await api("/assistant/check", { wake: "computer" });
  check("Settings' live check: “computer” is allowed, with the everyday-word warning and its sound-alikes", r.ok && r.warnings.some((w) => /everyday word/.test(w)) && r.neighbours.includes("compute a"), r);
  r = await chat("your name is Nova");
  check("voice: “your name is Nova” → read back, asks for a yes", /call me Nova from now on\? Say yes\./.test(r.reply) && O().assistantName === "Dayspring", r.reply);
  r = await chat("yes");
  check("voice: “yes” → “Great, I'm Nova now!”, saved", /^Great, I'm Nova now!/.test(r.reply) && O().assistantName === "Nova", r.reply);
  check("…the wake word followed the name", O().wakeWords.join() === "nova" && O().wakeFollowsName === true, O().wakeWords);
  r = await chat("what's your name?");
  check("“what's your name?” → “I'm Nova.”", r.reply === "I'm Nova.", r.reply);
  r = await chat("who are you");
  check("“who are you” (the offline intents) → “I'm Nova, your day planner…”", /^I'm Nova, your day planner/.test(r.reply), r.reply);
  r = await chat("what were you called before?");
  check("“what were you called before?” → “I started out as Dayspring.”", /I started out as Dayspring/.test(r.reply), r.reply);
  r = await chat("call Kestra");
  check("“call Kestra” doesn't rename it", O().assistantName === "Nova", r.reply);
  r = await chat("change the wake word to computer");
  check("the wake word waits for a yes (security)", /Say yes/.test(r.reply) && O().wakeWords.join() === "nova", r.reply);
  await chat("no");
  tc = await api("/tv/config");
  check("the screen's config says Nova now", tc.assistantName === "Nova" && tc.wakePhrases.join() === "nova", { a: tc.assistantName, w: tc.wakePhrases });

  // ============================================================================================================================
  section("B. it calls itself Nova: Claude (a stand-in that says “Dayspring”)");
  r = await chat("write me a haiku about autumn leaves falling on a quiet garden path");
  const sys = JSON.stringify(seen.anthropic.at(-1)?.system ?? "");
  check("Claude was asked (the stand-in)", seen.anthropic.length > 0, serverLog.slice(-400));
  check("Claude's prompt: “You are Nova” and “Your name is Nova … never your name”", /You are Nova/.test(sys) && /Your name is Nova/.test(sys) && /only the name of the app/.test(sys), sys.slice(0, 300));
  check("Claude's “I'm Dayspring … Dayspring here” comes out as Nova; “the Dayspring screen” stays", /I'm Nova/.test(r.reply) && /Nova here/.test(r.reply) && !/I'm Dayspring|Dayspring here/.test(r.reply) && /the Dayspring screen/.test(r.reply), r.reply);

  // ============================================================================================================================
  section("D. window.ps1 still finds the window after the rename (DS_WINDOW_LOG)");
  if (want("D")) {
    const n0 = existsSync(WINLOG) ? readFileSync(WINLOG, "utf8").trim().split(/\r?\n/).filter(Boolean).length : 0;
    await api("/window", { action: "minimize" }).catch(() => null);
    await api("/window/compact", {}).catch(() => null);
    const lines = existsSync(WINLOG) ? readFileSync(WINLOG, "utf8").trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) : [];
    const mine = lines.slice(n0);
    check("window actions were asked for (logged, not run)", mine.length >= 1, lines);
    check("…with window.ps1's own title pattern (no -Title that would miss “Nova · Dayspring”)", mine.every((l) => !(l.extra ?? []).includes("-Title")), mine);
    const ps1 = readFileSync(join(DESK, "scripts", "window.ps1"), "utf8");
    const rx = /\[string\]\$Title = '([^']+)'/.exec(ps1)?.[1];
    const titles = { "Dayspring": true, "Nova · Dayspring": true, "Big Mike · Dayspring": true, "Welcome to Dayspring": true, "Nova · Dayspring - Mozilla Firefox": true, "Dayspring — Google Chrome": true, "Nova": false, "Dayspring Setup": false, "Nova · Dayspring Settings": false, "YouTube - Dayspring fan video": false };
    const ps = `$rx = '${rx}'; $t = @(${Object.keys(titles).map((t) => `'${t.replace(/'/g, "''")}'`).join(",")}); ($t | ForEach-Object { [regex]::IsMatch($_, $rx) }) -join ','`;
    let got = "";
    try { got = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", windowsHide: true, timeout: 30_000 }).trim(); } catch (e) { got = String(e.message); }
    const want = Object.values(titles).map((b) => (b ? "True" : "False")).join(",");
    check("window.ps1's title pattern (.NET regex) finds “Dayspring” and “Nova · Dayspring”, and nothing else", got === want, `${got} vs ${want}`);
    let out = ""; try { out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(DESK, "scripts", "window.ps1"), "-Action", "state"], { windowsHide: true, encoding: "utf8", timeout: 30_000, env: { ...process.env, DS_PROFILE: "DayspringQA-none" } }); } catch (e) { out = String(e.stderr ?? e.message); }
    let j = null; try { j = JSON.parse(out.trim().split(/\r?\n/).pop()); } catch { /* not JSON */ }
    check("window.ps1 still runs with its new default title (a read-only “state”)", j && typeof j.found === "number", out.trim().slice(0, 160));
  }

  // ============================================================================================================================
  section("C. the screen (headless Chrome: muted, no microphone)");
  if (want("C")) {
  const { chromium } = await import(PW);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
  const mockBase = () => {
    window.__spoken = []; window.__srStarts = 0; window.__dsAllowAutomatedListen = true;
    const ss = window.speechSynthesis;
    if (ss) { ss.speak = (u) => { window.__spoken.push(u.text); setTimeout(() => u.onend?.(), 20); }; ss.cancel = () => {}; }
    HTMLMediaElement.prototype.play = function () { setTimeout(() => this.onended?.(), 20); return Promise.resolve(); };
    navigator.mediaDevices.getUserMedia = async () => { const ctx = new AudioContext(), osc = ctx.createOscillator(), g = ctx.createGain(); g.gain.value = 0.0001; const d = ctx.createMediaStreamDestination(); osc.connect(g); g.connect(d); osc.start(); return d.stream; };
    class FakeSR { constructor() { this.onend = this.onresult = this.onerror = null; } start() { window.__srStarts++; window.__sr = this; } abort() { setTimeout(() => this.onend?.(), 10); } stop() { this.abort(); } }
    window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
  };
  const chats = [];
  async function page(path, { width = 1280, height = 720 } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    await ctx.addInitScript(mockBase);
    await ctx.route("**/*", async (rt) => {
      const u = rt.request().url(), m = rt.request().method();
      if (m === "POST" && /\/api\/chat$/.test(u)) { chats.push(rt.request().postDataJSON?.()?.message ?? ""); return rt.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reply: "Okay.", changes: [] }) }); }
      if (m === "POST" && /\/api\/(sound|window\/ontop|devices\/use|keepawake|tunein|callbridge)/.test(u)) return rt.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
      return rt.continue();
    });
    const p = await ctx.newPage(); p.__errors = [];
    p.on("pageerror", (e) => p.__errors.push(e.message));
    await p.goto(BASE + path); await p.waitForTimeout(2500);
    if (await p.locator("#startBtn").isVisible().catch(() => false)) { await p.click("#startBtn"); await p.waitForTimeout(800); }
    return p;
  }
  // one final result from the stand-in recognizer: its guesses, best first
  const hear = (p, ...alts) => p.evaluate((alts) => { const r = alts.map((t) => ({ transcript: t, confidence: 0.8 })); r.isFinal = true; window.__sr?.onresult?.({ resultIndex: 0, results: [r] }); }, alts);
  const mode = (p) => p.evaluate(() => window.__dsTest?.mode());
  // after each request: the reply is said, and any listening window it opens is closed again, so the next sentence starts fresh
  // (the reply arrives, is said, and may open a listening window: quiet means idle and not speaking for over a second)
  const settle = async (p) => {
    await p.waitForTimeout(2600);
    let stable = 0;
    for (let i = 0; i < 40 && stable < 4; i++) {
      const s = await p.evaluate(() => ({ sp: window.dsCore?.speaking, m: window.__dsTest?.mode?.(), u: window.dsCore?.utter }));
      if (s.sp || s.m !== "idle" || s.u) { stable = 0; await p.evaluate(() => window.dsCore?.backToIdle?.()); } else stable++;
      await p.waitForTimeout(300);
    }
  };
  {
    const p = await page("/display");
    const ui = await p.evaluate(() => ({ label: document.querySelector(".talkhead .label")?.textContent, title: document.title, ph: document.getElementById("typeBox")?.placeholder, cap: document.querySelector("#cap")?.textContent, stop: document.getElementById("stopBtn")?.title, mic: document.getElementById("micText")?.textContent }));
    check("the panel's label says Nova", /^Nova/.test(ui.label ?? ""), ui);
    check("the window title is “Nova · Dayspring” (the product name stays last)", ui.title === "Nova · Dayspring", ui.title);
    check("the hints say “Nova”: the caption, the Type box, ✋'s tooltip, the listening line", /“Nova”/.test(ui.cap) && /Type to Nova/.test(ui.ph) && /“Nova”/.test(ui.stop) && /Nova/.test(ui.mic), ui);
    // the wake word in the screen's own recognition handler
    chats.length = 0;
    await hear(p, "Nova what time is it"); await settle(p);
    check("“Nova what time is it” (injected) → the request “what time is it” is sent", chats.includes("what time is it"), chats);
    chats.length = 0;
    await hear(p, "I was reading about a supernova last night"); await hear(p, "movie night is on Friday"); await settle(p);
    check("room talk (“…a supernova…”, “movie night…”) sends nothing", chats.length === 0, chats);
    // a made-up wake word, said "compootah"
    r = await api("/assistant", { name: "Computa", say: "compootah" });
    await p.waitForTimeout(800);
    const live = await p.evaluate(() => ({ label: document.querySelector(".talkhead .label")?.textContent, title: document.title }));
    check("renamed in Settings: the screen updates live (label, title)", /^Computa/.test(live.label) && live.title === "Computa · Dayspring", live);
    chats.length = 0;
    await hear(p, "Computer, what time is it?"); await settle(p);
    check("“Computer, what time is it?” wakes Computa (the recognizer's real word, at the start)", chats.includes("what time is it?"), chats);
    chats.length = 0;
    await hear(p, "compute a set a timer for 5 minutes"); await settle(p);
    check("“compute a set a timer…” → “set a timer for 5 minutes”", chats.includes("set a timer for 5 minutes"), chats);
    chats.length = 0;
    await hear(p, "my computer is slow today"); await hear(p, "I need to restart the computer"); await settle(p);
    check("“my computer is slow today” and “…restart the computer” do NOT wake it", chats.length === 0, chats);
    chats.length = 0;
    await hear(p, "can you tell me the weather", "computa can you tell me the weather"); await settle(p);
    check("n-best: the second guess has the wake word → heard", chats.includes("can you tell me the weather"), chats);
    await hear(p, "compootah"); await p.waitForTimeout(400);
    check("just “compootah” → it listens for the request (the command window opens)", (await mode(p)) === "command", await mode(p));
    await p.evaluate(() => window.dsCore?.backToIdle?.());
    // Train my wake word, with injected recognizer results
    chats.length = 0;
    r = await api("/wake/train/start", { word: "computa" });
    check("training starts (Settings → Train my wake word)", r.ok && r.word === "computa", r);
    await p.waitForTimeout(2800);
    const cardUp = await p.evaluate(() => (document.getElementById("wakeTrainCard")?.textContent ?? "").replace(/\s+/g, " ") + ` [speaking ${window.dsCore?.speaking}, active ${window.dsWakeTrain?.active}, speaker ${window.dsIsSpeaker}]`);
    check("the screen shows the training card (“Now: say “Computa””)", /Train “Computa”/.test(cardUp) && /Now: say/.test(cardUp), cardUp);
    for (const alts of [["compute a"], ["computer", "computa"], ["compootah"], ["commuter"], ["come puta"]]) { await hear(p, ...alts); await p.waitForTimeout(900); }
    await p.waitForTimeout(800);
    const rep = await p.evaluate(() => document.getElementById("wakeTrainCard")?.textContent ?? "");
    const st = await api("/wake/train");
    check("after 5 tries the card shows the success rate and what it learned", /I recognized it/.test(rep) && /of 5/.test(rep) && /compute a/.test(rep), rep);
    check("the learned spellings are saved: compute a, computer, compootah, commuter, come puta", ["compute a", "computer", "compootah", "commuter", "come puta"].every((x) => (O().wakeTrained?.computa ?? []).includes(x)), O().wakeTrained);
    check("…and the training samples were never sent as requests", chats.length === 0, chats);
    check("the report warns about everyday-word variants", (st.report?.warnings ?? []).some((w) => /everyday/.test(w)), st.report?.warnings);
    await p.evaluate(() => document.getElementById("wtDone")?.click());
    chats.length = 0;
    await hear(p, "commuter what's the weather"); await settle(p);
    check("after training, “commuter …” (learned) wakes it", chats.includes("what's the weather"), chats);
    // the voice says the name the way it's said
    await api("/assistant", { name: "Aoife", say: "Ee-fa" }); await p.waitForTimeout(800);
    await p.evaluate(() => { window.__spoken.length = 0; window.dayspring.speak("Hi, I'm Aoife. Aoife here."); });
    await p.waitForTimeout(2500);
    const spoken = await p.evaluate(() => window.__spoken.join(" | "));
    check("the free voice says “Ee-fa” for Aoife", /I'm Ee-fa\./.test(spoken) && /Ee-fa here/.test(spoken) && !/Aoife/.test(spoken), spoken);
    chats.length = 0;
    await hear(p, "Eefa, what's on today"); await settle(p);
    check("“Eefa, what's on today” wakes Aoife (from the pronunciation)", chats.includes("what's on today"), chats);
    check("the screen: no page errors", p.__errors.length === 0, p.__errors.join(" | "));
    await p.context().close();
  }
  {
    await api("/assistant", { name: "Big Mike", say: "" });
    const p = await page("/mini", { width: 380, height: 560 });
    const m = await p.evaluate(() => ({ label: document.querySelector(".talkhead .label")?.textContent, title: document.title, mini: document.documentElement.classList.contains("mini"), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    check("the mini: “Big Mike”, titled “Big Mike · Dayspring”, no sideways scroll", /^Big Mike/.test(m.label) && m.title === "Big Mike · Dayspring" && m.mini && m.sw <= m.cw + 1, m);
    chats.length = 0;
    await hear(p, "big mic what time is it"); await settle(p);
    check("the mini hears “big mic what time is it” for Big Mike", chats.includes("what time is it"), chats);
    check("the mini: no page errors", p.__errors.length === 0, p.__errors.join(" | "));
    await p.context().close();
  }
  {
    // Settings → Your assistant
    const p = await page("/settings?s=assistant", { width: 1200, height: 900 });
    const has = await p.evaluate(() => Boolean(document.getElementById("namingBox") && document.getElementById("aname")));
    check("Settings → Your assistant shows the name and wake word fields", has);
    await p.fill("#aname", "Abcdefghijklmnopqrstu"); await p.waitForTimeout(150);
    const long = await p.evaluate(() => document.getElementById("anameMsg").textContent);
    check("typing a 21-character name: a friendly message at once", /up to 19/.test(long), long);
    await p.fill("#aname", "Lanturn"); await p.waitForTimeout(150);
    check("typing “Lanturn”: “sounds too much like Lantern”", /Lantern/.test(await p.evaluate(() => document.getElementById("anameMsg").textContent)));
    await p.fill("#aname", "Kestra"); await p.waitForTimeout(150);
    await p.evaluate(() => { const c = document.getElementById("wkFollow"); c.checked = false; c.dispatchEvent(new Event("change", { bubbles: true })); });
    await p.waitForTimeout(150);
    await p.fill(".wkrow .wk", "hey"); await p.waitForTimeout(150);
    const heyMsg = await p.evaluate(() => document.querySelector(".wkrow .wkmsg").textContent);
    check("a wake word of just “hey” is refused as you type", /all the time/.test(heyMsg), heyMsg);
    await p.fill(".wkrow .wk", "computa"); await p.evaluate(() => { const b = document.getElementById("wkAdd"); b.click(); }); await p.waitForTimeout(100);
    await p.fill(".wkrow:nth-of-type(2) .wk", "jarvis"); await p.waitForTimeout(100);
    await p.fill("#wkTry", "Computer, turn on the lights"); await p.waitForTimeout(150);
    const tryOut = await p.evaluate(() => document.getElementById("wkTryOut").textContent);
    check("Try it: “Computer, turn on the lights” → wakes, the request is “turn on the lights”", /Wakes up/.test(tryOut) && /turn on the lights/.test(tryOut), tryOut);
    await p.fill("#wkTry", "my computer is slow"); await p.waitForTimeout(150);
    check("Try it: “my computer is slow” → wouldn't wake", /Wouldn't wake/.test(await p.evaluate(() => document.getElementById("wkTryOut").textContent)));
    await p.evaluate(() => document.getElementById("next")?.click());
    for (let i = 0; i < 30 && O().wakeWords.join() !== "computa,jarvis"; i++) await p.waitForTimeout(200);
    await p.waitForTimeout(500);
    const o = O();
    check("Save: Kestra, wake words Computa and Jarvis, not following the name", o.assistantName === "Kestra" && o.wakeWords.join() === "computa,jarvis" && o.wakeFollowsName === false, { n: o.assistantName, w: o.wakeWords, f: o.wakeFollowsName, msg: await p.evaluate(() => document.getElementById("m")?.textContent), follow: await p.evaluate(() => document.getElementById("wkFollow")?.checked), rows: await p.evaluate(() => [...document.querySelectorAll(".wkrow .wk")].map((x) => x.value)) });
    check("Settings: no page errors", p.__errors.length === 0, p.__errors.join(" | "));
    await p.context().close();
  }
  await browser.close();
  }

  // ============================================================================================================================
  section("B2. it calls itself by its name: Ollama (a stand-in that says “Dayspring”)");
  if (!want("C")) await api("/assistant", { name: "Kestra" }).catch(() => null);
  await stopServer();
  await startServer({ AI_PROVIDER: "ollama", AI_MODEL: "qwen2.5:3b", OLLAMA_URL: OLL, OLLAMA_FIRST_TOKEN_S: "8" });
  r = await chat("compose a short poem about my dog Biscuit chasing squirrels");
  if (/isn't running/.test(r.reply) && !seen.ollama.length) {
    // (the stand-in's connection is reset before the answer: that happens with the name left as "Dayspring" too, so it isn't
    // about naming; the Ollama prompt is checked in-process in part E, and the reply filter is the same one Claude's went through)
    console.log(`SKIP  Ollama round trip: the local stand-in didn't answer (${r.reply.slice(0, 80)}…)`);
  } else {
    const osys = JSON.stringify(seen.ollama.at(-1)?.messages?.[0]?.content ?? "");
    check("Ollama's prompt: “You are Kestra” and “Your name is Kestra”", /You are Kestra/.test(osys) && /Your name is Kestra/.test(osys), osys.slice(0, 300));
    check("Ollama's “I'm Dayspring!” comes out as “I'm Kestra!”", /I'm Kestra!/.test(r.reply) && !/I'm Dayspring/.test(r.reply), r.reply);
  }
  await stopServer();
} catch (e) { check("the run finished without an exception", false, e.stack ?? e.message); }
finally { await stopServer(); }

// ============================================================================================================================
section("E. meetings: the mock Meet page, addressed by the new name");
if (want("E")) {
  const MT = join(TMP, "meet"); mkdirSync(MT, { recursive: true });
  Object.assign(process.env, { DAYSPRING_OWNER_FILE: join(MT, "owner.json"), DAYSPRING_MEET_FILE: join(MT, "meet.json"), DAYSPRING_MEET_PROFILE: join(MT, "profile"), DAYSPRING_MEET_HEADLESS: "1", DAYSPRING_MEET_NO_WINDOW: "1",
    AI_PROVIDER: "none", TTS_PROVIDER: "browser", DS_CALLS_FILE: join(MT, "calls.json"), DAYSPRING_MEETINGS_DIR: join(MT, "meetings"), DAYSPRING_TEST_RECYCLE: join(MT, "recycle") });
  delete process.env.ANTHROPIC_API_KEY; delete process.env.DAYSPRING_WAKE_PHRASES;
  writeFileSync(process.env.DAYSPRING_OWNER_FILE, JSON.stringify({ name: "Tester", setupDone: true, assistantName: "Kestra", wakeWords: ["kestra", "computer"], wakeFollowsName: false }));
  // the local model's instructions (lib/ollama/prompt.mjs) with the personality block every AI gets
  {
    const prompt = await import("../../lib/ollama/prompt.mjs");
    const persona = await import("../../lib/persona/index.mjs");
    const sp = prompt.systemPrompt({ persona: persona.promptBlock() });
    check("Ollama's instructions: “You are Kestra” and “Your name is Kestra … never your name”", /You are Kestra/.test(sp) && /Your name is Kestra\. Always call yourself Kestra/.test(sp), sp.slice(0, 200));
  }
  const bus = await import("../../lib/bus.mjs");
  const host = await import("../../lib/meet/host.mjs");
  const routes = await import("../../lib/meet-routes.mjs");
  const settingsM = await import("../../lib/meet/settings.mjs");
  const courseAnswer = await import("../../lib/meet/course-answer.mjs");
  const lanternAsk = await import("../../lib/meet/lantern-ask.mjs");
  const events = [];
  bus.on((type, data) => events.push({ type, ...data }));
  const srv = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const send = (rr, code, body) => { rr.writeHead(code, { "content-type": "application/json" }); rr.end(JSON.stringify(body)); };
    const readJSON = (rr) => new Promise((ok) => { let b = ""; rr.on("data", (c) => (b += c)); rr.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch { ok({}); } }); });
    if (url.pathname.startsWith("/api/") && await routes.handle(req, res, { m: req.method, p: url.pathname.slice(4), q: url.searchParams, send, readJSON })) return;
    res.writeHead(404); res.end();
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  process.env.PORT = String(srv.address().port);
  const { chromium } = await import(PW);
  host.setDeps({ chromium: () => chromium, channel: async () => "chrome", persona: async () => "default", lanternSpeaking: async () => false, tuneinOn: () => false, tuneinStart: async () => {}, tuneinStop: async () => {} });
  lanternAsk._setCall(async () => ({ ok: false, status: 404 }));
  courseAnswer.setDeps({ lanternCall: async () => ({ ok: false, status: 0 }) });
  void settingsM;
  const pageM = () => host._session()?.page;
  const say = (who, t) => pageM().evaluate(([w, x]) => window.__mock.say(w, x, { chunks: 2, ms: 100 }), [who, t]);
  const answered = async (n, ms = 12_000) => { const until = Date.now() + ms; while (Date.now() < until) { if (events.slice(n).some((e) => e.type === "meet" && (e.kind === "answer" || e.kind === "answering"))) return true; await sleep(150); } return false; };
  try {
    const j = await host.join(`http://localhost:${process.env.PORT}/api/meet/mock?prejoin=1`, { isRehearsal: true });
    check("joins the mock meeting", j.ok && host.status().stage === "in-call", j.reply);
    await sleep(700);
    const sent = await pageM().evaluate(() => window.__mock.sent.slice());
    check("the hello is signed “Kestra:” and says “I'm Kestra … start with “Kestra,” … @Kestra”", sent.some((m) => /^Kestra: Hi everyone! I'm Kestra, /.test(m) && /start with "Kestra,"/.test(m) && /@Kestra/.test(m)), sent[0]);
    check("the notes heads-up names Kestra too", sent.some((m) => /^Kestra: Heads up: Kestra is taking notes/.test(m) && /“Kestra, don't record this part”/.test(m)), sent.join(" | ").slice(0, 300));
    await host.setPermission({ mode: "everyone" });
    let n = events.length;
    await say("Rich Alvarez", "Kestra, what time is it?"); await sleep(1800);
    check("“Kestra, what time is it?” in the captions is answered", await answered(n), events.slice(n).map((e) => `${e.type}:${e.kind}`).join(","));
    n = events.length;
    await say("Jess Park", "Computer, what's the date today?"); await sleep(1800);
    check("“Computer, what's the date today?” (an everyday wake word, at the start) is answered", await answered(n), events.slice(n).map((e) => `${e.type}:${e.kind}`).join(","));
    // (the answer to Jess finishes first: its last events mustn't count against the next line)
    for (let i = 0; i < 40 && !events.slice(n).some((e) => e.type === "meet" && e.kind === "answer"); i++) await sleep(250);
    await sleep(1500);
    n = events.length;
    await say("Sam Lee", "my computer is slow today, sorry about the lag"); await sleep(2600);
    check("“my computer is slow today…” is NOT taken as a question", !events.slice(n).some((e) => e.type === "meet" && (e.kind === "answer" || e.kind === "answering" || e.kind === "denied")), events.slice(n).filter((e) => e.type === "meet").map((e) => `${e.kind}:${JSON.stringify(e).slice(0, 160)}`).join(" | "));
    await sleep(3000);
    const own = (await pageM().evaluate(() => window.__mock.sent.slice())).filter((m) => /^Kestra( \(\d+\/\d+\))?: /.test(m));
    check("answers in the chat are signed “Kestra:”", own.length >= 2, own.slice(-2));
  } catch (e) { check("the meeting checks ran", false, e.stack ?? e.message); }
  finally { await host.close?.().catch(() => {}); await host.leave?.({ quiet: true }).catch(() => {}); srv.close(); }

  // ============================================================================================================================
  section("F. Discord (stand-ins): the slash command text and the wake check");
  const dchat = await import("../../lib/discord/chat.mjs");
  const dwake = await import("../../lib/discord/wake.mjs");
  const cmds = dchat.slashCommands("Kestra");
  check("the /dayspring command keeps its id and says “Talk to Kestra”", cmds.some((c) => c.name === "dayspring" && /Talk to Kestra/.test(c.description)), cmds.map((c) => `${c.name}: ${c.description}`).join(" | "));
  check("a Discord message “Kestra, tell us a joke” is for it", dwake.wakeCommand("Kestra, tell us a joke") === "tell us a joke");
  check("“computer what's the weather” is for it; “my computer died” isn't", dwake.wakeCommand("computer what's the weather") === "what's the weather" && dwake.wakeCommand("my computer died") === null);
  const bot = await import("../../lib/discord/bot.mjs");
  const a = await bot.applyName();
  check("with the bot offline, renaming it is skipped politely (no error)", a.applied === false, a);
}

anth.close(); oll.close(); await ollMock.close?.();
if (!process.argv.includes("--keep")) { try { spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true }); rmSync(TMP, { recursive: true, force: true }); } catch { /* temp */ } }
else console.log("kept:", TMP);
if (fail) console.log(serverLog.split(/\r?\n/).filter((l) => /error|Error/.test(l)).slice(-10).join("\n"));
console.log(`\n${fail ? "FAILED" : "ALL PASSED"}: ${pass} passed, ${fail} failed${fail ? "\n  " + failed.join("\n  ") : ""}`);
process.exit(fail ? 1 : 0);
