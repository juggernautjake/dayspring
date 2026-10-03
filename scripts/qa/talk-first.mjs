// The conversation comes first (requirements F6–F8, 2026-10-02): while the owner is talking to Dayspring, notifications
// never speak over him and never stop the recognizer; they show silently at once and come out after the grace period.
// Part A runs the server's half (lib/floor.mjs) on a fake clock: Claude Code alerts held during a turn come out together
// after the grace period ("While we were talking, Claude finished 2 tasks…"), "show silently" shows them at once and
// never says them, "interrupt" says them at once, alarms ring through, a low-importance item that waited is only shown.
// Part B runs a throwaway copy (Chrome headless, --mute-audio, a fake recognizer, voices mocked; nothing is heard, no
// device or setting of the owner's is touched) and checks the screen:
//   (a) a Claude Code "finished" alert arriving mid-utterance is held (a silent card at once, nothing said), the
//       recognizer is never stopped, and it's said after the grace period, without stopping the recognizer either
//   (b) "show silently": a card, no sound, never said later
//   (c) the alarm still rings while he's talking
//   (d) after just "Dayspring" the window stays open while he talks (past the old 12 s cap); words that finish a sentence
//       just after a window closed are still taken; "change your avatar" right after Dayspring said it isn't an echo
//   (e) "Dayspring, …" said over a notification stops it, and it comes again later
//   (f) the voice commands and the setting ("hold notifications while we talk", "show them silently while we talk")
//   (g) a streamed answer: each sentence is said as it arrives, and nothing is said twice
//   (h) words said while Dayspring is thinking become his next turn (never merged into the request on its way);
//       "never mind" while it's thinking stops that request
//   (i) the mic's level alone (no recognized words) holds the window at most ~12 s and earns no "late" words
//   node scripts/qa/talk-first.mjs [--keep]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { qaPort } from "./port.mjs";   // a free port (or QA_PORT), so parallel runs never collide
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" ? "  (" + got + ")" : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- A. the server's half, on a fake clock
{
  console.log("-- A. the floor (fake clock) --");
  const F = await import(pathToFileURL(join(DESK, "lib", "floor.mjs")).href);
  const clock = (start) => { let t = start; const timers = []; return { now: () => t, setTimer: (fn, ms) => { const h = { at: t + ms, fn }; timers.push(h); return h; }, clearTimer: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
    advance(ms) { const end = t + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const h = timers[0]; if (!h || h.at > end) break; timers.shift(); t = Math.max(t, h.at); h.fn(); } t = end; } }; };
  const rig = (talk = "wait", grace = 8000) => {
    const c = clock(new Date(2026, 9, 2, 21, 9, 0).getTime()), said = [];
    const f = F.createFloor({ now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer, displayCount: () => 1, grace: () => grace, talkMode: () => talk });
    const offer = (item) => f.offer({ ...item }, (x) => said.push({ ...x, at: c.now() }));
    return { c, f, said, offer };
  };
  const claude = (project, event = "finished") => ({ kind: "claude", event, project, text: event === "finished" ? `Claude's all done with ${project}. It's ready for you to look over.` : `Claude's waiting on you in ${project}.`, summary: "done" });
  {
    const { c, f, said, offer } = rig("wait", 8000);
    f.owner("wake", "tv"); f.tv("busy");
    const r1 = offer(claude("Dayspring")); c.advance(3000); const r2 = offer(claude("Lantern")); c.advance(2000);
    check("wait: two Claude Code alerts during his turn are held, nothing said", r1 === "held" && r2 === "held" && said.length === 0, `${r1},${r2},${said.length}`);
    f.tv("idle"); c.advance(7900);
    check("wait: still held inside the 8 s grace period after his turn", said.length === 0, f.blockedBy());
    c.advance(200);
    check("wait: after the grace period they come out as ONE line", said.length === 1 && /^While we were talking, Claude finished 2 tasks, on Dayspring and Lantern\.$/.test(said[0]?.text), said.map((x) => x.text).join(" | "));
    check("wait: the queue is empty after the batch", f.status().held.length === 0);
  }
  {
    const { c, f, said, offer } = rig("wait", 8000);
    f.owner("wake", "tv"); f.tv("busy");
    offer(claude("Orchard")); c.advance(1000); f.tv("idle"); c.advance(8100);
    check("wait: a single held alert is said as \"While we were talking, …\"", said.length === 1 && /^While we were talking, Claude's all done with Orchard\./.test(said[0].text), said[0]?.text);
  }
  {
    const { c, f, said, offer } = rig("silent");
    f.owner("wake", "tv"); f.tv("busy");
    const r = offer(claude("Dayspring"));
    check("silent: shown at once (quietly), never held", r === "quietly" && said.length === 1 && said[0].quietly === true && f.status().held.length === 0, `${r} ${JSON.stringify(said.map((x) => x.quietly))}`);
    f.tv("idle"); c.advance(20_000);
    check("silent: nothing comes out again after the turn", said.length === 1);
  }
  {
    const { f, said, offer } = rig("interrupt");
    f.owner("wake", "tv"); f.tv("busy");
    const r = offer(claude("Dayspring"));
    check("interrupt: said straight away, as before", r === "through" && said.length === 1 && !said[0].quietly, r);
  }
  {
    const { f, said, offer } = rig("wait");
    f.owner("wake", "tv"); f.tv("busy");
    const r = offer({ kind: "alarm", alarm: true, text: "Time to get up." });
    check("an alarm during his turn rings right away", r === "ring" && said.length === 1, r);
    const e = offer({ kind: "weather", official: true, severity: "Extreme", text: "Tornado warning." });
    check("an emergency during his turn goes straight through", e === "emergency" && said.length === 2, e);
  }
  {
    const { c, f, said, offer } = rig("wait", 5000);
    f.owner("wake", "tv"); f.tv("busy");
    offer({ kind: "update", text: "Dayspring 9.9 is ready." }); c.advance(2000); f.tv("idle"); c.advance(5200);
    check("a low-importance note that had to wait is only shown afterwards", said.length === 1 && said[0].quietly === true, JSON.stringify(said.map((x) => [x.kind, x.quietly])));
  }
  {
    const { c, f, said, offer } = rig("wait", 8000);
    f.owner("wake", "tv"); f.tv("busy");
    offer(claude("Dayspring")); f.tv("idle"); c.advance(8100);
    const first = said.at(-1);
    f.owner("wake", "tv"); f.tv("busy"); f.done(first.fid, "cancelled", "busy");     // the screen put it back (he started talking)
    f.tv("idle"); c.advance(8100);
    check("put back by the screen: said again later, without a second \"While we were talking\"", said.length === 2 && (said[1].text.match(/While we were talking/g) ?? []).length === 1, said.at(-1)?.text);
  }
}

// ---------------------------------------------------------------- B. the screen, on a throwaway copy
console.log("-- B. the screen (throwaway copy, headless) --");
const { chromium } = require("playwright-core");
const PORT = await qaPort(4786), BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), "ds-talkfirst-")), APP = join(TMP, "app");
spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(join(APP, "data"), { recursive: true });
writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary" }));
const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DS_PROFILE: "DayspringQA", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_NO_ECO: "1", DAYSPRING_TEST_HOOKS: "1",
  ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", ELEVENLABS_API_KEY: "", AI_PROVIDER: "", TTS_PROVIDER: "browser", DAYSPRING_REMINDER_CHANNEL: "off" };
const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = ""; server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
const api = async (path, body) => { const r = await fetch(BASE + "/api" + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return r.json().catch(() => ({})); };
let sess = 0;
const claudeEvent = (project = "Lantern", hook = "Stop") => api("/claude-event", { hook_event_name: hook, session_id: `qa-${++sess}`, cwd: `D:\\work\\${project}` });

const browser = await chromium.launch({ channel: (await import(pathToFileURL(join(DESK, "lib", "browsers.mjs")).href)).playwrightChannel(), headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
const mock = () => {
  window.__dsAllowAutomatedListen = true;
  window.__spoken = []; window.__speakMs = 300; window.__srStarts = 0; window.__srAborts = 0;
  // the browser's voice: each sentence "takes" __speakMs; cancel ends the one being said (like the real thing)
  const ss = window.speechSynthesis;
  if (ss) {
    let cur = null, timer = 0;
    ss.speak = (u) => { window.__spoken.push(u.text); cur = u; timer = setTimeout(() => { cur = null; u.onend?.(); }, window.__speakMs); };
    ss.cancel = () => { clearTimeout(timer); const u = cur; cur = null; if (u) setTimeout(() => u.onend?.(), 0); };
  }
  HTMLMediaElement.prototype.play = function () { setTimeout(() => this.onended?.(), 20); return Promise.resolve(); };
  // a microphone made of a silent oscillator (the level meter hears silence)
  // (window.__micLoud(true) turns it into steady loud noise: the level meter "hears" someone, the recognizer hears no words)
  window.__micG = [];
  window.__micLoud = (on) => window.__micG.forEach((g) => { g.gain.value = on ? 0.8 : 0.0001; });
  navigator.mediaDevices.getUserMedia = async () => { const ctx = new AudioContext(), osc = ctx.createOscillator(), g = ctx.createGain(); g.gain.value = 0.0001; window.__micG.push(g); const dest = ctx.createMediaStreamDestination(); osc.connect(g); g.connect(dest); osc.start(); return dest.stream; };
  class FakeSR { constructor() { this.onend = this.onresult = this.onerror = null; } start() { window.__srStarts++; window.__sr = this; } abort() { window.__srAborts++; setTimeout(() => this.onend?.(), 10); } stop() { this.abort(); } }
  window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
};
const DEVICE_ROUTES = /\/api\/(sound|window\/(ontop|compact|expand)|devices\/use|voicemeeter\/(install|setup)|keepawake|tunein|callbridge|mic)/;
const chats = [], chatLog = [];
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
await ctx.addInitScript(mock);
await ctx.route("**/*", (rt) => {
  const rq = rt.request(), u = rq.url();
  if (rq.method() === "POST" && DEVICE_ROUTES.test(u)) return rt.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  if (rq.method() === "POST" && /\/api\/chat$/.test(u)) {
    let b = {}; try { b = JSON.parse(rq.postData() ?? "{}"); chats.push(b.message); } catch { /* fine */ }
    chatLog.push({ message: b.message, stream: b.stream, at: Date.now() });
    // (g) an AI answer, streamed the way the server sends one (the test server has no AI)
    if (/^stream test/.test(b.message ?? "")) return rt.fulfill({ status: 200, contentType: "application/x-ndjson", body: [
      { t: "say", text: "Let me look.", round: 0 },
      { t: "say", text: "First part here.", round: 1 }, { t: "say", text: "Second part.", round: 1 },
      { t: "done", round: 1, data: { reply: "First part here. Second part. And the last bit.", changes: [], usage: { input_tokens: 1 } } }].map((x) => JSON.stringify(x)).join("\n") + "\n" });
    // (h) a slow answer: Dayspring is "thinking" for 3 s
    if (/slowly/.test(b.message ?? "")) return new Promise((ok) => setTimeout(() => { rt.continue().catch(() => {}); ok(); }, 3000));
  }
  return rt.continue();
});
const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.goto(BASE + "/display"); await p.waitForTimeout(2500);
if (await p.locator("#startBtn").isVisible().catch(() => false)) { await p.click("#startBtn"); await p.waitForTimeout(800); }

const T = (fn, ...a) => p.evaluate(fn, ...a);
const hear = (text, final = true) => T(([t, f]) => { const r = [{ transcript: t, confidence: 0.9 }]; r.isFinal = f; window.__sr?.onresult?.({ resultIndex: 0, results: [r] }); }, [text, final]);
const st = () => T(() => ({ mode: window.__dsTest.mode(), engaged: window.__dsTest.engaged(), recLive: window.__dsTest.recLive(), paused: window.__dsTest.paused(), aborts: window.__srAborts, starts: window.__srStarts, spoken: window.__spoken.slice(), note: window.__dsTest.speakingNote(), held: window.__dsTest.heldHere() }));
const toasts = () => T(() => [...document.querySelectorAll("#toasts .toast")].map((t) => t.textContent.replace(/\s+/g, " ").trim()));
const spokeClaude = (s) => s.spoken.some((x) => /claude/i.test(x));
const waitFor = async (fn, ms = 20_000, step = 200) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(step); } return null; };
const idleAgain = () => waitFor(async () => !(await T(() => window.__dsTest.engaged())), 30_000);
const setS = (patch) => api("/settings", patch);

check("the test page is listening with the fake recognizer", (await st()).recLive === true, JSON.stringify(await st()));
await setS({ talkNotify: "wait", talkGraceSec: 4 });
await p.waitForTimeout(400);

// (a) a Claude Code alert mid-utterance
{
  await hear("Dayspring");                                   // the wake word on its own: the listening window opens
  await p.waitForTimeout(300);
  await hear("what's on my", false);                         // he's mid-sentence
  const before = await st();
  await claudeEvent("Lantern");
  await p.waitForTimeout(1500);
  await hear("can you tell me a joke about", false);
  const mid = await st(), cards = await toasts(), fl = await api("/floor");
  check("(a) he's engaged mid-utterance (the window is open)", mid.mode === "command" && Boolean(mid.engaged), JSON.stringify({ mode: mid.mode, engaged: mid.engaged }));
  check("(a) the Claude alert is NOT said while he's talking", !spokeClaude(mid), mid.spoken.join(" | "));
  check("(a) the recognizer was never stopped or restarted by it", mid.recLive && !mid.paused && mid.aborts === before.aborts && mid.starts === before.starts, JSON.stringify({ aborts: [before.aborts, mid.aborts], starts: [before.starts, mid.starts] }));
  check("(a) a silent card shows at once", cards.some((t) => /Claude finished · Lantern/.test(t)), cards.join(" || ").slice(0, 200));
  check("(a) it's waiting in line (the \"after this\" sign)", (fl.held?.length ?? 0) + mid.held >= 1 || (await T(() => !document.getElementById("dsFloorPill")?.hidden)), JSON.stringify({ server: fl.held?.length, here: mid.held, blockedBy: fl.blockedBy }));
  await hear("can you tell me a joke about surveyors");      // he finishes; the request goes to Dayspring
  const asked = await waitFor(() => chats.includes("can you tell me a joke about surveyors"), 8000, 50);
  check("(a) his request was sent", Boolean(asked), JSON.stringify(chats));
  await waitFor(async () => (await st()).spoken.length > mid.spoken.length, 15_000);
  const replied = await st();
  check("(a) Dayspring answers him first (the reply, not the alert)", !spokeClaude(replied), replied.spoken.slice(mid.spoken.length).join(" | ").slice(0, 160));
  // the window after the reply (7 s), then the 4 s grace, then the alert
  const tIdle = await waitFor(async () => ((await st()).mode === "idle" ? Date.now() : 0), 20_000);
  const aborts0 = (await st()).aborts;
  const said = await waitFor(async () => { const s = await st(); return spokeClaude(s) ? { s, at: Date.now() } : null; }, 25_000);
  check("(a) after the grace period it's said", Boolean(said), said ? said.s.spoken.filter((x) => /claude/i.test(x)).join(" | ") : JSON.stringify(await st()));
  check("(a) …not before the grace period was over (≥ 4 s after he was done)", said && tIdle && said.at - tIdle >= 3600, said && tIdle ? `${said.at - tIdle} ms` : "");
  check("(a) …as \"While we were talking, …\"", said && said.s.spoken.some((x) => /^While we were talking, Claude's all done with Lantern/.test(x)), said ? said.s.spoken.at(-1) : "");
  await p.waitForTimeout(800);
  const after = await st();
  // (counted from the moment the alert started: the reply before it pauses the recognizer, the alert must not)
  check("(a) saying it didn't stop the recognizer either", Boolean(said) && after.recLive && after.aborts === said.s.aborts, JSON.stringify({ aborts: [said?.s.aborts, after.aborts], idleAborts: aborts0, recLive: after.recLive }));
}

// (e) "Dayspring, …" over a notification being said: it stops, and comes again later
{
  await idleAgain();
  await T(() => { window.__speakMs = 4000; });
  const n0 = (await st()).spoken.length;
  await claudeEvent("Orchard");
  const talking = await waitFor(async () => { const s = await st(); return s.note && s.spoken.length > n0 ? s : null; }, 8000, 100);
  check("(e) a notification is being said, and the recognizer is still on", Boolean(talking) && talking.recLive && !talking.paused, JSON.stringify(talking ?? await st()));
  await hear("Dayspring what time", false);
  await p.waitForTimeout(500);
  const cut = await st(), fl = await api("/floor");
  check("(e) \"Dayspring\" over it stops it at once", !cut.note, JSON.stringify({ note: cut.note }));
  check("(e) and it goes back in line", (fl.held?.length ?? 0) >= 1 || Boolean(fl.presenting), JSON.stringify({ held: fl.held?.map((x) => x.kind), presenting: fl.presenting }));
  await T(() => { window.__speakMs = 300; });
  await hear("Dayspring what time is it");
  const again = await waitFor(async () => { const s = await st(); return s.spoken.filter((x) => /Orchard/.test(x)).length >= 2 ? s : null; }, 30_000);
  check("(e) it's said again after he's done", Boolean(again), (await st()).spoken.filter((x) => /Orchard/.test(x)).join(" | "));
}

// (b) show silently
{
  await idleAgain();
  await setS({ talkNotify: "silent" }); await p.waitForTimeout(400);
  await hear("Dayspring");
  await p.waitForTimeout(300);
  await hear("can you", false);
  const n0 = (await st()).spoken.length;
  await claudeEvent("Vista");
  await p.waitForTimeout(1500);
  const cards = await toasts(), s1 = await st();
  check("(b) silent: a card shows at once", cards.some((t) => /Claude finished · Vista/.test(t)), cards.join(" || ").slice(0, 200));
  check("(b) silent: nothing is said, and the recognizer keeps going", !s1.spoken.slice(n0).some((x) => /Vista/.test(x)) && s1.recLive && !s1.paused, s1.spoken.slice(n0).join(" | "));
  await hear("can you tell me a joke");
  await idleAgain(); await p.waitForTimeout(5000);
  const s2 = await st(), fl = await api("/floor");
  check("(b) silent: it isn't said later either", !s2.spoken.some((x) => /Vista/.test(x)) && !(fl.held ?? []).length, s2.spoken.slice(n0).join(" | ").slice(0, 200));
  await setS({ talkNotify: "wait" });
}

// (c) the alarm still rings while he's talking
{
  await hear("Dayspring");
  await p.waitForTimeout(300);
  await hear("remind me", false);
  await api("/test/announce", { kind: "alarm", alarm: true, text: "Test alarm: time to get up" });
  const rang = await waitFor(() => T(() => !document.getElementById("alarm")?.hidden), 4000, 100);
  check("(c) the alarm rings even while he's talking", Boolean(rang));
  await T(() => document.getElementById("alarmDismiss")?.click() ?? document.querySelector("#alarm button")?.click());
  await p.waitForTimeout(800);
  await T(() => window.dispatchEvent(new CustomEvent("ds-test-final", { detail: "stop" })));
  await idleAgain();
}

// (d) never cut off: a long request after "Dayspring", words just after a window closed, and the echo guard
{
  const c0 = chats.length;
  await hear("Dayspring");
  const t0 = Date.now();
  while (Date.now() - t0 < 15_000) { await hear("so I was thinking that maybe we could", false); await p.waitForTimeout(1000); }
  const s = await st();
  check("(d) after \"Dayspring\" the window stays open while he talks (15 s, past the old 12 s cap)", s.mode === "command", s.mode);
  await hear("so I was thinking that maybe we could look at tomorrow");
  check("(d) …and the long request is sent", Boolean(await waitFor(() => chats.length > c0 && /look at tomorrow/.test(chats.at(-1)), 8000)), chats.at(-1));
  await idleAgain();
  // a follow-up window (not the wake word) still closes after 12 s, but a sentence he was in the middle of still counts
  await T(() => window.__dsTest.openCommandWindow(10000));
  const t1 = Date.now(); let closed = 0;
  while (Date.now() - t1 < 16_000) { await hear("and then after that I want", false); await p.waitForTimeout(800); if ((await st()).mode === "idle") { closed = Date.now() - t1; break; } }
  check("(d) a follow-up window still closes by about 12 s (room noise can't hold it)", closed > 0 && closed <= 13_500, `${closed} ms`);
  const c1 = chats.length;
  await hear("and then after that I want to add a study block");
  check("(d) …but the sentence he was finishing is still taken", Boolean(await waitFor(() => chats.length > c1 && /study block/.test(chats.at(-1)), 8000)), chats.slice(c1).join(" | "));
  await idleAgain();
  // the echo guard: Dayspring says "say change your avatar again…", and 8 s later he says "change your avatar"
  await T(() => window.dispatchEvent(new CustomEvent("ds-test-say", { detail: { text: "Say change your avatar again for the next one." } })));
  await p.waitForTimeout(8000);
  const c2 = chats.length;
  await hear("Dayspring"); await p.waitForTimeout(400);
  await hear("change your avatar");
  check("(d) \"change your avatar\" after Dayspring said it is taken, not dropped as an echo", Boolean(await waitFor(() => chats.length > c2 && /change your avatar/i.test(chats.at(-1)), 8000)), chats.slice(c2).join(" | "));
  await idleAgain();
}

// (g) a streamed answer
{
  await idleAgain();
  const n0 = (await st()).spoken.length;
  await hear("Dayspring"); await p.waitForTimeout(300);
  await hear("stream test please");
  await waitFor(async () => (await st()).spoken.slice(n0).includes("And the last bit."), 12_000);
  const s = (await st()).spoken.slice(n0), cnt = (t) => s.filter((x) => x === t).length;
  check("(g) the answer was asked for as a stream", chatLog.at(-1)?.stream === true, JSON.stringify(chatLog.at(-1)));
  check("(g) each sentence is said once, as it arrives, in order", cnt("Let me look.") === 1 && cnt("First part here.") === 1 && cnt("Second part.") === 1 && cnt("And the last bit.") === 1 && s.indexOf("First part here.") < s.indexOf("And the last bit."), s.join(" | "));
  check("(g) nothing is said twice (not the whole answer again)", !s.some((x) => /First part here\. Second part/.test(x)), s.join(" | "));
  const logTxt = await T(() => [...document.querySelectorAll("#log .msg.ai")].map((x) => x.textContent).slice(-2));
  check("(g) the conversation shows the whole answer once", logTxt.filter((x) => /First part here\. Second part\. And the last bit\./.test(x)).length === 1, JSON.stringify(logTxt));
  await idleAgain();
}

// (h) words while Dayspring is thinking
{
  const c0 = chats.length;
  await hear("Dayspring"); await p.waitForTimeout(300);
  await hear("tell me a joke slowly");
  await waitFor(async () => (await st()).mode === "thinking", 6000, 100);
  await hear("and also what's the date today");
  await p.waitForTimeout(800);
  const mid = await st(), next = await T(() => window.__dsTest.pendingNext());
  check("(h) words while it's thinking aren't sent on top of the request on its way", chats.length === c0 + 1 && mid.mode === "thinking", JSON.stringify({ sent: chats.slice(c0), mode: mid.mode }));
  check("(h) …they're kept as his next turn", next === "and also what's the date today", String(next));
  const second = await waitFor(() => chats.length >= c0 + 2, 20_000);
  check("(h) after the answer, they're asked as their own turn (nothing merged)", Boolean(second) && chats[c0] === "tell me a joke slowly" && chats[c0 + 1] === "and also what's the date today", JSON.stringify(chats.slice(c0)));
  await idleAgain();
  // "never mind" while it's thinking stops that request
  const n1 = (await st()).spoken.length, c1 = chats.length;
  await hear("Dayspring"); await p.waitForTimeout(300);
  await hear("tell me a fun fact slowly");
  await waitFor(async () => (await st()).mode === "thinking", 6000, 100);
  await hear("never mind");
  await p.waitForTimeout(700);
  const after = await st();
  check("(h) \"never mind\" while it's thinking stops it", after.mode === "idle" && !(await T(() => window.__dsTest.pendingNext())), JSON.stringify({ mode: after.mode }));
  await p.waitForTimeout(3500);
  const late = (await st()).spoken.slice(n1);
  check("(h) …and its answer is never said", !late.some((x) => /fact/i.test(x)) && chats.length === c1 + 1, late.join(" | "));
  await idleAgain();
}

// (i) noise: the mic level alone holds the window at most ~12 s, and no stray sentence gets in afterwards
{
  const c0 = chats.length;
  await T(() => { window.__dsTest.setInterimAt(0); });
  await hear("Dayspring");
  const t0 = Date.now();
  await p.waitForTimeout(500);
  await T(() => window.__micLoud(true));
  let closed = 0;
  while (Date.now() - t0 < 25_000) { await p.waitForTimeout(400); if ((await st()).mode === "idle") { closed = Date.now() - t0; break; } }
  const late = await T(() => window.__dsTest.lateUntil());
  check("(i) noise alone (no words) holds the window at most about 12 s, not 45", closed > 0 && closed <= 13_500, `${closed} ms ${JSON.stringify(await T(() => window.__dsTest.lastWindow))}`);
  check("(i) …and doesn't earn the late words", late === 0, String(late));
  await hear("buy forty rolls of paper towels");
  await p.waitForTimeout(3000);
  check("(i) a stray sentence after that is ignored", chats.length === c0, JSON.stringify(chats.slice(c0)));
  await T(() => window.__micLoud(false));
  await p.waitForTimeout(500);
}

// (f) the voice commands and the setting
{
  const said = async (t) => { const r = await api("/chat", { message: t, surface: "desk", typed: true }); return r.reply ?? ""; };
  let r = await said("show notifications silently while we're talking");
  let s = (await api("/settings")).settings;
  check("(f) \"show notifications silently while we're talking\"", s.talkNotify === "silent" && s.notifyAll == null, `${s.talkNotify} / ${s.notifyAll} · ${r}`);
  r = await said("let notifications interrupt me");
  s = (await api("/settings")).settings;
  check("(f) \"let notifications interrupt me\"", s.talkNotify === "interrupt", `${s.talkNotify} · ${r}`);
  r = await said("hold notifications while we talk");
  s = (await api("/settings")).settings;
  check("(f) \"hold notifications while we talk\"", s.talkNotify === "wait", `${s.talkNotify} · ${r}`);
  r = await said("wait 15 seconds after we're done talking before notifications");
  s = (await api("/settings")).settings;
  check("(f) \"wait 15 seconds after we're done talking…\"", s.talkGraceSec === 15, `${s.talkGraceSec} · ${r}`);
  r = await said("make texts silent");
  s = (await api("/settings")).settings;
  check("(f) the per-kind commands still work (\"make texts silent\")", s.notify?.texts === "silent" && s.talkNotify === "wait", JSON.stringify(s.notify));
  const bad = await fetch(BASE + "/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ talkNotify: "loud" }) });
  check("(f) a wrong value is refused", !bad.ok || (await api("/settings")).settings.talkNotify === "wait");
  // Settings → Notifications has the choice
  const sp = await ctx.newPage();
  await sp.goto(BASE + "/setup?s=notifications"); await sp.waitForTimeout(2500);
  const ui = await sp.evaluate(() => ({ sel: document.getElementById("talkNotify")?.value, opts: [...(document.getElementById("talkNotify")?.options ?? [])].map((o) => o.value), grace: document.getElementById("talkGrace")?.value }));
  check("(f) Settings → Notifications shows \"While we're talking\" with its three choices and the grace period", ui.sel === "wait" && ui.opts.join() === "wait,silent,interrupt" && ui.grace === "15", JSON.stringify(ui));
  await sp.close();
}

check("no page errors", errs.length === 0, errs.slice(0, 3).join(" | "));
await browser.close();
server.kill();
await sleep(500);
if (fail) console.log(serverLog.split("\n").filter((l) => /error|unexpected/i.test(l)).slice(-10).join("\n"));
if (!process.argv.includes("--keep")) { spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true }); try { rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } }
else console.log("kept:", TMP);
console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nALL PASSED: ${pass} passed`);
process.exit(fail ? 1 : 0);
