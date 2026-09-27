// The conversation floor: the owner's requests come before anything Dayspring planned to say (lib/floor.mjs, public/floor.js).
// Part 1 runs the arbiter on a fake clock (no waiting, no server):
//   • a reminder / question due while he talks → held, then said after the reply plus the 4 s grace
//   • he talks during an item's lead-in chime → called back and put back in line (said once, later)
//   • a multi-turn clarification (a question, his answer, a pending confirmation) → held until it's resolved
//   • an alarm or timer during a reply rings right away (its words wait on the screen, part 2)
//   • stale items expire or are re-worded; several held items come out by priority, one at a time, and wait again
//     when he starts a new turn; "what were you going to say?"; one open question at a time; Discord / phone turns;
//     emergencies and things he asked for go straight through; nothing is dropped (a random soak)
// Part 2 runs a throwaway copy (port 4799; Chrome headless, --mute-audio, no microphone, voices mocked) and checks the
// screen's half: the lead-in call-back, an alarm ringing during a reply with its words after it, the "after this" sign
// and its tap, a desk-panel request holding things, Quiet and "stop listening" unchanged.
//   node scripts/qa/floor.mjs [--unit] [--keep]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as F from "../../lib/floor.mjs";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let fail = 0;
const check = (name, ok, got = "") => { if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" ? "  (" + got + ")" : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- part 1: the arbiter on a fake clock
function fakeClock(start) {
  let t = start; const timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const h = { at: t + ms, fn }; timers.push(h); return h; },
    clearTimer: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
    advance(ms) { const end = t + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const h = timers[0]; if (!h || h.at > end) break; timers.shift(); t = Math.max(t, h.at); h.fn(); } t = end; },
  };
}
const T0 = new Date(2026, 8, 27, 15, 5, 0).getTime();      // 3:05 p.m.
function rig({ displays = 1 } = {}) {
  const c = fakeClock(T0), said = [], states = [];
  const f = F.createFloor({ now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer, displayCount: () => displays, broadcast: (type, d) => { if (type === "floor") states.push(d); } });
  let n = 0;
  const offer = (item) => { const it = { ...item }; const r = f.offer(it, (x) => said.push({ fid: x.fid, text: x.text, kind: x.kind, at: c.now(), again: false }), { refire: (x) => said.push({ fid: x.fid, text: x.text, kind: x.kind, at: c.now(), again: true }) }); n++; return { r, it }; };
  // the screen presents what was just said and reports it done (spoken)
  const screenSays = (ms = 3000, { question = false } = {}) => { const last = said.at(-1); c.advance(ms); if (question) f.tv("busy"); f.done(last.fid, "spoken", question ? "busy" : "idle"); };
  return { c, f, said, states, offer, screenSays, count: () => n };
}
function unit() {
  console.log("-- the arbiter (fake clock) --");
  {   // 1. held while he talks, said after the reply + grace
    const { c, f, said, offer } = rig();
    f.owner("wake", "tv"); f.tv("busy");
    const { r } = offer({ kind: "reminder", text: "Take the trash out.", reminder: { id: "r1", text: "Take the trash out." } });
    check("a reminder due while he's talking is held, not said", r === "held" && said.length === 0, r);
    c.advance(6000);
    check("still held while his reply is being said", said.length === 0 && f.blockedBy() === "owner", f.blockedBy());
    f.tv("idle");                                         // reply said, answer window closed
    c.advance(F.GRACE_MS - 100);
    check("not yet, inside the grace period after his turn", said.length === 0 && f.blockedBy() === "grace", f.blockedBy());
    c.advance(200);
    check("said once the grace period passes", said.length === 1 && said[0].text === "Take the trash out.", JSON.stringify(said));
    const q = offer({ kind: "person", text: "How's Jordan doing lately?" });
    check("a question of Dayspring's own waits while the reminder is still being presented", q.r === "held");
  }
  {   // 2. lead-in call-back → re-queued, said once, later
    const { c, f, said, offer } = rig();
    offer({ kind: "checkin", text: "That's it for studying. How did it go?" });
    check("with the floor free an item goes right out", said.length === 1 && !said[0].again);
    c.advance(200);                                       // its chime is playing…
    f.owner("wake", "tv"); f.done(said[0].fid, "cancelled", "busy");
    check("he spoke during the lead-in: it's back in line", f.status().held.length === 1 && f.status().held[0].requeued === 1, JSON.stringify(f.status().held));
    c.advance(10_000); f.tv("idle"); c.advance(F.GRACE_MS + 50);
    check("said again after his turn, as a re-send (not fired twice)", said.length === 2 && said[1].again && said[1].fid === said[0].fid, JSON.stringify(said.map((x) => x.again)));
  }
  {   // 3. a multi-turn clarification
    const { c, f, said, offer } = rig();
    f.owner("wake", "tv"); f.tv("busy");
    offer({ kind: "reminder", text: "Call the pharmacy.", reminder: { id: "r2" } });
    c.advance(4000);                                      // Dayspring asks "which list?" and waits for the answer (still busy)
    f.owner("voice", "tv");                               // he answers
    c.advance(3000); f.tv("idle"); c.advance(1000);
    f.owner("voice", "tv"); f.tv("busy");                 // …and says one more thing inside the grace period
    c.advance(F.GRACE_MS + 500);
    check("held through a clarifying question, his answer and a follow-up", said.length === 0, f.blockedBy());
    let pending = true; f.addBusyCheck(() => pending);    // a file confirmation waiting for his yes
    f.tv("idle"); c.advance(F.GRACE_MS + 500);
    check("a pending confirmation keeps it held", said.length === 0 && f.blockedBy() === "pending", f.blockedBy());
    pending = false; c.advance(5100);
    check("resolved: said", said.length === 1, f.blockedBy());
  }
  {   // 4. alarm / timer / emergency / what he asked for go straight through
    const { f, said, offer } = rig();
    f.owner("wake", "tv"); f.tv("busy");
    const a = offer({ kind: "alarm", alarm: true, text: "It's time: leave for work." });
    const t = offer({ kind: "timer", text: "Your pasta timer is done.", timer: { labels: ["pasta"] } });
    const w = offer({ kind: "weather", severity: "Extreme", official: true, text: "Tornado warning for your area. Take shelter now." });
    const wn = offer({ kind: "weather", severity: "Extreme", official: false, text: "Heads-up: extreme heat is coming." });
    const q = offer({ kind: "start", requested: true, text: "Time for Study." });
    check("an alarm during his turn rings right away", a.r === "ring" && a.it.floor === "ring");
    check("a timer during his turn rings right away", t.r === "ring");
    check("an official Extreme weather alert interrupts", w.r === "emergency" && w.it.floor === "emergency");
    check("a forecast heads-up (not official) waits like everything else", wn.r === "held");
    check("what he asked for himself (What's now?) is never held", q.r === "requested");
    check("those four went out, the fifth waits", said.length === 4 && f.status().held.length === 1, said.map((x) => x.kind).join(","));
  }
  {   // 5. stale items
    const { c, f, said, offer } = rig();
    f.owner("wake", "tv"); f.tv("busy");
    offer({ kind: "jokeoffer", text: "Want to hear a joke?" });
    offer({ kind: "reminder", text: "Leave in 10 minutes.", reminder: { id: "r3" } });
    offer({ kind: "start", date: "2026-09-27", text: "Time for a walk.", started: { id: "b1", title: "Walk", start: "15:05", end: "15:30" } });
    for (let i = 0; i < 31 * 3; i++) { c.advance(20_000); f.tv("busy"); }   // a long exchange: the screen's heartbeat keeps it his
    check("a long exchange keeps everything held (the screen's heartbeat)", said.length === 0, f.blockedBy());
    f.tv("idle"); c.advance(F.GRACE_MS + 50);
    const st = f.status();
    check("a joke offer held over 30 minutes expires", !said.some((x) => x.kind === "jokeoffer") && st.expired.some((x) => x.kind === "jokeoffer"), JSON.stringify(st.expired));
    check("a block that's already over isn't announced", !said.some((x) => x.kind === "start") && st.expired.some((x) => x.kind === "start"));
    const rem = said.find((x) => x.kind === "reminder");
    check("a late relative reminder is re-worded, never dropped", rem && /^This was due at 3:05 p\.m\.: Leave at 3:15 p\.m\.$/.test(rem.text), rem?.text);
    const { c: c2, f: f2, said: s2, offer: o2 } = rig();
    f2.owner("wake", "tv"); f2.tv("busy");
    o2({ kind: "jokeoffer", text: "Want to hear a joke?" });
    for (let i = 0; i < 15; i++) { c2.advance(20_000); f2.tv("busy"); }
    f2.tv("idle"); c2.advance(F.GRACE_MS + 50);
    check("a joke offer held a few minutes is still offered, as it was", s2.length === 1 && s2[0].text === "Want to hear a joke?");
  }
  {   // 6. several held → priority order, one at a time, re-held when he talks again; duplicates merge
    const { c, f, said, offer, screenSays } = rig();
    f.owner("wake", "tv"); f.tv("busy");
    offer({ kind: "jokeoffer", text: "Want to hear a joke?" });
    offer({ kind: "person", text: "How's Jordan doing lately?", person: "Jordan" });
    offer({ kind: "text", from: "Alex", text: "Incoming text message from Alex. Do you want me to read it?" });
    offer({ kind: "reminder", text: "Stretch.", reminder: { id: "r4" } });
    offer({ kind: "text", from: "Alex", text: "Alex just texted you. Should I read it?" });   // same sender again
    check("four held (the second text from Alex merged into the first)", f.status().held.length === 4 && f.status().held.find((h) => h.label === "a text from Alex")?.merged === 1, JSON.stringify(f.status().held.map((h) => h.label)));
    f.tv("idle"); c.advance(F.GRACE_MS + 50);
    check("the most important comes first: the reminder", said.length === 1 && said[0].kind === "reminder", said.map((x) => x.kind).join(","));
    c.advance(5000);
    check("one at a time: nothing else until the screen is done with it", said.length === 1);
    screenSays(0);
    c.advance(F.GAP_MS + 50);
    check("then the text (newest wording), spaced out", said.length === 2 && said[1].kind === "text" && /just texted/.test(said[1].text), said.at(-1)?.text);
    screenSays(2000, { question: true });                // "want me to read it?" → the answer window is open
    f.owner("voice", "tv");                               // he starts something new
    c.advance(20_000);
    check("he talks again: the rest waits for his new turn", said.length === 2 && f.blockedBy() !== null, f.blockedBy());
    f.tv("idle"); c.advance(F.GRACE_MS + 50);
    check("after it: the question about Jordan", said.length === 3 && said[2].kind === "person", said.map((x) => x.kind).join(","));
    screenSays(3000); c.advance(F.GAP_MS + 50);
    check("and last, the joke", said.length === 4 && said[3].kind === "jokeoffer");
  }
  {   // 7. "what were you going to say?"
    const { c, f, said, offer } = rig();
    check("the phrase is understood", ["what were you going to say?", "Dayspring, what were you about to say", "what did you want to tell me", "you were going to say something", "what's waiting"].every(F.isRelease));
    check("…and isn't confused with repeat / yes", !["say that again", "go ahead", "what did you say", "yes", "what time is it"].some(F.isRelease));
    check("with nothing held it says so", /Nothing's waiting/.test(f.command("what were you going to say?")));
    f.owner("wake", "tv"); f.tv("busy");
    offer({ kind: "person", text: "How's Jordan doing lately?", person: "Jordan" });
    offer({ kind: "update", text: "There's a new version of Dayspring." });
    c.advance(3000);
    f.owner("voice", "tv");
    const reply = f.command("What were you going to say?");
    check("asked: it answers and lets them out", /holding 2 things/.test(reply ?? ""), reply);
    c.advance(1500); f.tv("idle");                        // its answer has been said
    c.advance(F.GAP_MS + 50);
    check("out right after that answer (no 4 s grace)", said.length === 1, `${said.length} said`);
  }
  {   // 8. remote surfaces (Discord, the phone, the desk panel)
    const { c, f, said, offer } = rig();
    f.owner("message", "Discord text chat");
    offer({ kind: "reminder", text: "Water the plants.", reminder: { id: "r5" } });
    c.advance(3000);
    f.replied("Discord text chat", { reply: "Which plants, the inside ones?", listen: true });
    c.advance(30_000);
    check("a Discord reply that asked him something holds things for his answer", said.length === 0, f.blockedBy());
    c.advance(F.REMOTE_ASK_MS);
    check("…then they come out", said.length === 1);
    const r2 = rig();
    r2.f.owner("message", "text message"); r2.offer({ kind: "reminder", text: "Stretch.", reminder: { id: "r6" } });
    r2.f.replied("text message", { reply: "Done." }); r2.c.advance(F.GRACE_MS + 50);
    check("a plain phone reply: out after the grace period", r2.said.length === 1);
    const r3 = rig({ displays: 0 });
    r3.f.owner("message", "tv"); r3.offer({ kind: "reminder", text: "Stretch.", reminder: { id: "r7" } });
    r3.f.replied("tv", { reply: "It's 3 p.m." }); r3.c.advance(F.GRACE_MS + 50);
    check("no screen open: a screen-surface request still resolves", r3.said.length === 1);
  }
  {   // 9. safety valves
    const { c, said, offer, f } = rig();
    f.owner("wake", "tv");                                // the page closes mid-turn: nothing more is ever heard from it
    offer({ kind: "reminder", text: "Stretch.", reminder: { id: "r8" } });
    c.advance(F.TURN_STALE_MS + F.GRACE_MS + 500);
    check("a turn nobody closes ends on its own (nothing stuck forever)", said.length === 1);
    offer({ kind: "reminder", text: "Drink water.", reminder: { id: "r9" } });
    c.advance(F.PRESENT_MAX_MS + 600);
    check("an item the screen never reports on counts as done after the limit", said.length === 2, f.blockedBy());
  }
  {   // 10. soak: no dropped items
    const { c, f, said, offer } = rig();
    let rnd = 7; const R = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
    const kinds = ["reminder", "checkin", "text", "person", "update", "coder", "hook", "lantern"];
    const offered = new Map();
    for (let i = 0; i < 300; i++) {
      const x = R();
      if (x < 0.1) { f.owner("voice", "tv"); f.tv("busy"); }
      else if (x < 0.2) f.tv("idle");
      else if (x < 0.25) f.owner("message", "Discord text chat");
      else if (x < 0.3) f.replied("Discord text chat", { reply: "ok" });
      else if (x < 0.5) { const k = kinds[Math.floor(R() * kinds.length)], id = `i${i}`; const { r, it } = offer({ kind: k, text: `Item ${id}.`, reminder: k === "reminder" ? { id } : undefined, from: k === "text" ? id : undefined, person: k === "person" ? id : undefined }); offered.set(it.fid, { k, r }); }
      else if (x < 0.65) { const p = f.status().presenting; if (p) f.done(p.fid, R() < 0.2 ? "cancelled" : "spoken", "idle"); }
      c.advance(Math.floor(R() * 4000));
    }
    f.tv("idle"); f.replied("Discord text chat", { reply: "ok" });
    for (let i = 0; i < 400 && (f.status().held.length || f.status().presenting); i++) { const p = f.status().presenting; if (p) f.done(p.fid, "spoken", "idle"); c.advance(3000); }
    const firsts = new Set(said.filter((x) => !x.again).map((x) => x.fid));
    const missing = [...offered.keys()].filter((fid) => !firsts.has(fid));
    const dupes = said.filter((x) => !x.again).length - firsts.size;
    check("soak: every item offered was delivered (none dropped, none lost in a call-back)", missing.length === 0 && f.status().expired.length === 0, `${offered.size} offered, ${missing.length} missing, ${f.status().expired.length} expired`);
    check("soak: none was fired twice (a call-back re-sends, it doesn't repeat the first delivery)", dupes === 0, `${dupes}`);
  }
}

// ---------------------------------------------------------------- part 2: the screen, on a throwaway copy
async function screen() {
  console.log("-- the Dayspring screen (headless Chrome, muted) --");
  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright-core");
  const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  const PORT = 4799, BASE = `http://127.0.0.1:${PORT}`;
  const TMP = mkdtempSync(join(tmpdir(), "ds-floor-")), APP = join(TMP, "app");
  spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
  spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
  mkdirSync(join(APP, "data"), { recursive: true });
  writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary" }));
  const env = { ...process.env, PORT: String(PORT), DAYSPRING_TEST_HOOKS: "1", DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", ELEVENLABS_API_KEY: "", AI_PROVIDER: "", DAYSPRING_REMINDER_CHANNEL: "off" };
  const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let serverLog = ""; server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
  const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
  const api = (path, body) => fetch(BASE + "/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  const announce = (item) => api("/test/announce", item);
  const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, headless: true, args: ["--mute-audio"] });
  // voices mocked: every spoken sentence is recorded with its time; window.__slow makes each one last that long
  const mock = () => {
    window.__spoken = []; window.__slow = 30;
    const ss = window.speechSynthesis;
    if (ss) { ss.speak = (u) => { window.__spoken.push({ t: u.text, at: Date.now(), mode: window.dsCore?.mode }); u.__t = setTimeout(() => u.onend?.(), window.__slow); window.__u = u; }; ss.cancel = () => { const u = window.__u; if (u) { clearTimeout(u.__t); window.__u = null; setTimeout(() => u.onerror?.({ error: "interrupted" }), 0); } }; }
    HTMLMediaElement.prototype.play = function () { setTimeout(() => this.onended?.(), 30); return Promise.resolve(); };
  };
  const spoken = (p) => p.evaluate(() => window.__spoken.map((x) => x.t));
  const waitFor = (p, fn, arg, ms = 20_000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
  try {
    const ctx = await browser.newContext(); await ctx.addInitScript(mock);
    const p = await ctx.newPage(); await p.goto(BASE + "/display"); await p.waitForTimeout(2500);
    if (await p.locator("#startBtn").isVisible().catch(() => false)) await p.click("#startBtn").catch(() => {});
    await waitFor(p, () => window.dsIsSpeaker === true && window.dsFloor && window.dsCore, null, 10_000);
    check("the screen has the floor add-on and is the speaker", await p.evaluate(() => Boolean(window.dsFloor && window.dsIsSpeaker)));
    const idleNow = () => waitFor(p, () => window.dsCore.mode === "idle" && !window.dsCore.speaking, null, 30_000);
    const serverFree = async (ms = 30_000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await api("/floor"); if (!s.held.length && !s.presenting && !s.blockedBy) return true; await sleep(300); } return false; };

    // ---- he talks during the lead-in chime: called back, said after his request ----
    await serverFree();
    await p.evaluate(() => { window.__spoken = []; });
    await announce({ kind: "reminder", text: "Floor test reminder one.", reminder: { id: "ft1", text: "Floor test reminder one." } });
    if (!await waitFor(p, () => window.dsFloor._state().log.some((x) => x.what === "present" && x.kind === "reminder"), null, 8000)) console.log("   debug: never presented", JSON.stringify(await api("/floor")), JSON.stringify(await p.evaluate(() => window.dsFloor._state())));
    await p.evaluate(() => window.dispatchEvent(new CustomEvent("ds-test-final", { detail: "Dayspring what time is it" })));
    const calledBack = await waitFor(p, () => window.dsFloor._state().log.some((x) => x.what === "callback"), null, 3000);
    check("he spoke during the chime: the reminder is called back", calledBack);
    await waitFor(p, () => window.__spoken.some((x) => /Floor test reminder one/.test(x.t)), null, 40_000);
    let s = await spoken(p);
    const iRem = s.findIndex((t) => /Floor test reminder one/.test(t)), iReply = s.findIndex((t) => /\d/.test(t) && !/Floor test/.test(t));
    check("his answer came first, then the reminder, said once", iReply >= 0 && iRem > iReply && s.filter((t) => /Floor test reminder one/.test(t)).length === 1, JSON.stringify(s));

    // ---- a reminder due while he's talking: held, the sign shows, then said after the reply + grace ----
    await idleNow(); await serverFree();
    await p.evaluate(() => { window.__spoken = []; window.__slow = 1800; });
    await p.evaluate(() => window.dispatchEvent(new CustomEvent("ds-test-final", { detail: "Dayspring what time is it" })));
    await waitFor(p, () => window.dsCore.mode === "thinking" || window.dsCore.mode === "replying", null, 10_000);
    await announce({ kind: "reminder", text: "Floor test reminder two.", reminder: { id: "ft2", text: "Floor test reminder two." } });
    await sleep(400);
    const held = await api("/floor");
    check("a reminder due while he's talking is held on the server", held.held.length === 1 && held.blockedBy === "owner", JSON.stringify({ held: held.held.map((h) => h.label), by: held.blockedBy }));
    const sign = await waitFor(p, () => { const b = document.querySelector("#dsFloorPill"); return b && !b.hidden && /1 thing to tell you after this/.test(b.textContent); }, null, 3000);
    check("the screen shows “1 thing to tell you after this”", sign);
    if (!await waitFor(p, () => window.__spoken.some((x) => /Floor test reminder two/.test(x.t)), null, 45_000)) console.log("   debug:", JSON.stringify(await api("/floor")), JSON.stringify(await p.evaluate(() => ({ st: window.dsFloor._state(), mode: window.dsCore.mode, speaking: window.dsCore.speaking, spoken: window.__spoken.map((x) => x.t) }))));
    const log2 = await p.evaluate(() => ({ spoken: window.__spoken, log: window.dsFloor._state().log }));
    const remAt = log2.spoken.find((x) => /Floor test reminder two/.test(x.t))?.at ?? 0;
    const lastReply = Math.max(...log2.spoken.filter((x) => !/Floor test/.test(x.t)).map((x) => x.at));
    const idleAt = Math.max(...log2.log.filter((x) => x.what === "tv" && x.state === "idle" && x.at < remAt).map((x) => x.at));
    check("said only after his reply finished", remAt > lastReply, `${remAt - lastReply} ms after`);
    check("…and after the grace period with no new words", remAt - idleAt >= F.GRACE_MS - 300, `${remAt - idleAt} ms after the screen went idle`);
    check("the sign goes away once it's said", await waitFor(p, () => document.querySelector("#dsFloorPill")?.hidden, null, 5000));

    // ---- an alarm during his reply: rings and shows now, its words after the reply ----
    await idleNow(); await serverFree();
    await p.evaluate(() => { window.__spoken = []; window.__slow = 2500; });
    await p.evaluate(() => window.dispatchEvent(new CustomEvent("ds-test-final", { detail: "Dayspring what time is it" })));
    await waitFor(p, () => window.dsCore.mode === "replying" && window.dsCore.speaking, null, 15_000);
    await announce({ kind: "alarm", alarm: true, hm: "07:00", text: "Floor alarm test." });
    const banner = await waitFor(p, () => !document.querySelector("#alarm").hidden, null, 3000);
    const stillReplying = await p.evaluate(() => window.dsCore.mode === "replying");
    check("the alarm's banner is up at once, during his reply", banner && stillReplying);
    await waitFor(p, () => window.__spoken.some((x) => /Floor alarm test/.test(x.t)), null, 30_000);
    const s3 = await p.evaluate(() => window.__spoken);
    const aAt = s3.find((x) => /Floor alarm test/.test(x.t)), replyParts = s3.filter((x) => !/Floor alarm test|Good morning/.test(x.t));
    check("its words come after the reply, which wasn't cut off", aAt && replyParts.length >= 1 && replyParts.every((x) => x.at < aAt.at), JSON.stringify(s3.map((x) => x.t)));
    const rw = await p.evaluate(() => window.dsFloor._state().log.find((x) => x.what === "ring-words"));
    check("the words waited less than the 20 s cap", rw && rw.waited <= F.RING_SPEECH_MAX_MS + 500 && !rw.capped, JSON.stringify(rw));
    await p.evaluate(() => document.querySelector("#alarmOff")?.click());
    await p.evaluate(() => { window.__slow = 30; });

    // ---- "what were you going to say?" (the sign's tap) ----
    await idleNow(); await serverFree();
    await p.evaluate(() => { window.__spoken = []; });
    await api("/chat", { message: "what time is it", surface: "desk" });           // a desk-panel request: his turn, then the grace period
    await announce({ kind: "person", text: "Floor test: how's Jordan doing?", person: "Jordan" });
    await sleep(300);
    const h4 = await api("/floor");
    check("a request from the desk panel holds things too", h4.held.length === 1, `${h4.held.length} held, ${h4.blockedBy}`);
    await waitFor(p, () => !document.querySelector("#dsFloorPill").hidden, null, 3000);
    const tapAt = Date.now();
    await p.click("#dsFloorPill");
    const out = await waitFor(p, () => window.__spoken.some((x) => /how's Jordan/.test(x.t)), null, 8000);
    const outAt = await p.evaluate(() => window.__spoken.find((x) => /how's Jordan/.test(x.t))?.at ?? 0);
    check("tapping the sign says it now", out && outAt - tapAt < F.GRACE_MS, `${outAt - tapAt} ms`);
    check("the question opens the answer window as before", await waitFor(p, () => window.dsCore.mode === "command", null, 3000));

    // ---- Quiet and "stop listening" unchanged ----
    await idleNow(); await serverFree();
    await api("/listen", { state: "quiet", from: "test" });
    await waitFor(p, () => document.documentElement.innerText && true, null, 500);
    await sleep(800);
    await p.evaluate(() => { window.__spoken = []; });
    await announce({ kind: "reminder", text: "Floor quiet reminder.", reminder: { id: "ft5", text: "Floor quiet reminder." } });
    const toastQ = await waitFor(p, () => [...document.querySelectorAll("#toasts .toast")].some((t) => /Floor quiet reminder/.test(t.textContent)), null, 5000);
    await sleep(1500);
    check("Quiet: shown, not said (unchanged)", toastQ && !(await spoken(p)).some((t) => /Floor quiet/.test(t)));
    await announce({ kind: "alarm", alarm: true, hm: "07:00", text: "Floor quiet alarm." });
    check("Quiet: an alarm still rings (unchanged)", await waitFor(p, () => !document.querySelector("#alarm").hidden, null, 3000));
    await p.evaluate(() => document.querySelector("#alarmOff")?.click());
    await api("/listen", { state: "active", from: "test" });
    await sleep(800); await idleNow(); await serverFree();
    await p.evaluate(() => { document.querySelector("#muteBtn")?.click(); window.__spoken = []; });
    await announce({ kind: "person", text: "Floor stopped question?", person: "Sam" });
    await waitFor(p, () => window.__spoken.some((x) => /Floor stopped question/.test(x.t)), null, 8000);
    await sleep(600);
    check("Stop listening: no answer window opens (unchanged)", await p.evaluate(() => window.dsCore.mode === "idle"));
    await p.evaluate(() => document.querySelector("#muteBtn")?.click());
    check("the server kept running, nothing unexpected", await up() && !/unexpected \(kept running\)/.test(serverLog), serverLog.match(/unexpected.*$/m)?.[0] ?? "");
  } finally {
    await browser.close().catch(() => {});
    server.kill();
    await sleep(1000);
    spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true });
    if (!process.argv.includes("--keep")) try { rmSync(TMP, { recursive: true, force: true }); } catch { /* in use */ }
  }
}

unit();
if (!process.argv.includes("--unit")) await screen().catch((e) => { fail++; console.log(`FAIL  the screen checks stopped: ${e.message}`); });
console.log(fail ? `\n${fail} failed.` : "\nThe owner's requests come first: all good.");
process.exit(fail ? 1 : 0);
