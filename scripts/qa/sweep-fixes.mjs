// 1.4.0 sweep fixes, on a throwaway copy (port 4789; nothing is heard, no real microphone or device is touched):
//   • a damaged (truncated) data file is restored from its daily snapshot, or started fresh with the alarm still on,
//     and the owner is told once (never a silent "alarm off")
//   • two Dayspring screens: "I'm up" on one stops the alarm on the other; a snooze pressed on both at once, or sent
//     twice, is one snooze
//   • a timed silent mode ends on its own and the screens are told (the "settings" event), with nothing else calling
//   • Dayspring Off + a restart: Tune in doesn't come back until Dayspring is turned back on
//   • reminders missed while Dayspring was stopped come back once, marked late; the wake-up alarm missed by a few
//     minutes still rings, once, and not again after a restart
//   • the desktop helper comes back after it's killed
//   node scripts/qa/sweep-fixes.mjs [--keep]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { qaPort } from "./port.mjs";   // a free port (or QA_PORT), so parallel runs never collide
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = await qaPort(4789), BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), "ds-sweep-")), APP = join(TMP, "app"), DATA = join(APP, "data");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" ? "  (" + got + ")" : ""}`); };
const NOKEYS = { ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", ELEVENLABS_API_KEY: "", AI_PROVIDER: "", DAYSPRING_REMINDER_CHANNEL: "off", DAYSPRING_NO_ECO: "1", DAYSPRING_DEVICES_DRYRUN: "1" };
// run a snippet of module code inside the copy; it prints one JSON line
function run(code, extraEnv = {}) {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: APP, env: { ...process.env, ...NOKEYS, ...extraEnv }, encoding: "utf8", timeout: 60_000, windowsHide: true });
  const line = String(r.stdout).trim().split(/\r?\n/).filter((l) => l.startsWith("{")).at(-1);
  try { return JSON.parse(line); } catch { return { error: (r.stderr || r.stdout || "no output").slice(-400) }; }
}
const put = (f, v) => writeFileSync(join(DATA, f), typeof v === "string" ? v : JSON.stringify(v, null, 2));

spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(DATA, { recursive: true });
rmSync(join(APP, "bin", "whisper"), { recursive: true, force: true });      // no speech engine here: nothing can listen
put("owner.json", { name: "Tester", setupDone: true, display: "primary", keepScreenOpen: false });

let server = null, serverLog = "", browser = null;
try {
  // ---- #2 a damaged data file --------------------------------------------------------------------------------------
  put("settings.json", { alarm: true, mode: "voice", goals: true });
  const w = run(`const s = await import("./lib/settings.mjs"); s.set({ goals: false }); console.log(JSON.stringify({ ok: true }));`);
  check("settings saved (a daily snapshot is taken first)", w.ok === true, JSON.stringify(w));
  const good = readFileSync(join(DATA, "settings.json"), "utf8");
  put("settings.json", good.slice(0, Math.floor(good.length / 2)));        // a power cut halfway through a save
  let r = run(`const f = await import("./lib/firstrun.mjs"); const e = f.ensure(); const s = await import("./lib/settings.mjs");
    console.log(JSON.stringify({ e, alarm: s.get().alarm, notices: f.notices() }));`);
  check("truncated settings: set aside and restored from the snapshot", r.e?.restored?.includes("settings.json"), JSON.stringify(r.e ?? r));
  check("truncated settings: the alarm is still on", r.alarm === true, String(r.alarm));
  check("truncated settings: a notice tells the owner", (r.notices ?? []).some((n) => /settings file was damaged.*restored/i.test(n.text ?? n)), JSON.stringify(r.notices));
  rmSync(join(DATA, "backups"), { recursive: true, force: true }); rmSync(join(APP, "backups"), { recursive: true, force: true });
  put("settings.json", '{"alarm": true, "mo');
  r = run(`const f = await import("./lib/firstrun.mjs"); const e = f.ensure(); const s = await import("./lib/settings.mjs");
    console.log(JSON.stringify({ e, alarm: s.get().alarm, notices: f.notices() }));`);
  check("no backup at all: settings start fresh but the alarm stays on", r.alarm === true && r.e?.repaired?.includes("settings.json"), JSON.stringify({ alarm: r.alarm, e: r.e }));
  check("no backup at all: the owner is told", (r.notices ?? []).some((n) => /alarm is still on/i.test(n.text ?? n)), JSON.stringify(r.notices));

  // ---- #8 Off + a restart: no Tune in ------------------------------------------------------------------------------
  put("settings.json", { alarm: true, listenState: "off" });
  put("tunein.json", { on: true, device: null });
  r = run(`const t = await import("./lib/tunein.mjs"); const x = await t.resume(); console.log(JSON.stringify({ x, on: t.isOn() }));`);
  check("Off + restart: Tune in stays off", r.on === false && /off/i.test(r.x?.skipped ?? ""), JSON.stringify(r));
  check("Off + restart: the wish to have it on is kept for later", JSON.parse(readFileSync(join(DATA, "tunein.json"), "utf8")).on === true);
  put("settings.json", { alarm: true, listenState: "active" });
  r = run(`const t = await import("./lib/tunein.mjs"); const x = await t.resume(); console.log(JSON.stringify({ x }));`);
  check("back on: Tune in tries to come back (no speech engine in the copy, so it can't actually listen)", !r.x?.skipped && r.x !== null, JSON.stringify(r));
  rmSync(join(DATA, "tunein.json"), { force: true });

  // ---- #10 reminders missed while stopped ---------------------------------------------------------------------------
  put("settings.json", { alarm: true });
  r = run(`const rm = await import("./lib/reminders.mjs"); const st = await import("./lib/store.mjs");
    const at = (h) => { const d = new Date(Date.now() - h * 3600_000); return { date: st.todayISO(d), time: d.toTimeString().slice(0, 5) }; };
    rm.add({ ...at(2), text: "two hours ago" }); rm.add({ ...at(7), text: "seven hours ago" }); rm.add({ ...at(-1), text: "an hour from now" });
    const first = rm.dueUpTo(new Date()), second = rm.dueUpTo(new Date());
    console.log(JSON.stringify({ first: first.map((x) => ({ text: x.text, late: x.late ?? null })), second: second.length }));`);
  check("missed reminder (2 h ago) comes back once, marked late", r.first?.length === 1 && r.first[0].text === "two hours ago" && Boolean(r.first[0].late), JSON.stringify(r));
  check("too old (7 h) and future reminders aren't said", !r.first?.some((x) => x.text !== "two hours ago"));
  check("nothing fires twice", r.second === 0, String(r.second));
  // the wake-up alarm missed by a few minutes (the computer slept 07:50 → 08:10; the first block was at 08:00)
  const clock = (hm) => `const REAL = Date, [H, M] = "${hm}".split(":").map(Number), base = new REAL(); base.setHours(H, M, 5, 0); const off = base.getTime() - REAL.now();
    globalThis.Date = class extends REAL { constructor(...a) { if (a.length) super(...a); else super(REAL.now() + off); } static now() { return REAL.now() + off; } };`;
  const today = run(`${clock("08:10")} const st = await import("./lib/store.mjs"); console.log(JSON.stringify({ d: st.todayISO() }));`).d;
  run(`${clock("07:00")} const st = await import("./lib/store.mjs"); st.addBlock({ date: "${today}", start: "08:00", end: "09:00", title: "Morning walk", category: "body" }); console.log(JSON.stringify({ ok: 1 }));`);
  put("announcer-state.json", { date: today, lastMin: 7 * 60 + 50, rung: [] });
  const tickCode = `const a = await import("./lib/announcer.mjs"); await a.tick(); await new Promise((r) => setTimeout(r, 1500)); await a.tick(); await new Promise((r) => setTimeout(r, 1500));
    console.log(JSON.stringify({ items: a.recent().filter((i) => i.hm === "08:00").map((i) => ({ kind: i.kind, alarm: i.alarm })) }));`;
  r = run(`${clock("08:10")} ${tickCode}`);
  check("alarm missed by 10 minutes rings once when Dayspring wakes", r.items?.length === 1 && (r.items[0].alarm || r.items[0].kind === "morning"), JSON.stringify(r));
  r = run(`${clock("08:12")} ${tickCode}`);
  check("…and not again after a restart", r.items?.length === 0, JSON.stringify(r));
  put("announcer-state.json", { date: today, lastMin: 7 * 60 + 20, rung: [] });
  r = run(`${clock("08:45")} ${tickCode}`);
  check("more than 30 minutes late: the alarm isn't rung", r.items?.length === 0, JSON.stringify(r));
  rmSync(join(DATA, "store.json"), { force: true }); rmSync(join(DATA, "announcer-state.json"), { force: true });

  // ---- the server: #6, #11, #4/#5 --------------------------------------------------------------------------------
  put("settings.json", { alarm: true, mode: "voice" });
  const env = { ...process.env, ...NOKEYS, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DS_LAUNCH_LOG: join(TMP, "launch.log"), DS_PROFILE: "DayspringQA", DAYSPRING_OVERLAY: "1", DAYSPRING_OVERLAY_TEST: "1", DAYSPRING_TEST_HOOKS: "1" };
  server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
  const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
  const api = async (p, body) => { const x = await fetch(BASE + "/api" + p, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return x.json().catch(() => ({})); };
  const until = async (fn, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(250); } return v; };
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
  check("server started", await up());

  // #6 timed silent mode: 3 seconds, then only the server's own minute check may notice
  const events = [], ctl = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${BASE}/api/events?page=qa`, { signal: ctl.signal });
      const rd = res.body.getReader(), dec = new TextDecoder(); let buf = "";
      for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf("\n\n")) >= 0) { const blk = buf.slice(0, i); buf = buf.slice(i + 2); const ev = /^event: (.*)$/m.exec(blk)?.[1] ?? "message", data = /^data: (.*)$/m.exec(blk)?.[1]; try { events.push({ ev, data: JSON.parse(data) }); } catch { events.push({ ev, data }); } } }
    } catch { /* closed */ }
  })();
  await sleep(1000);
  const hello = events.find((e) => e.ev === "hello")?.data;
  check("the hello carries the mic owner, Off/Quiet and notices", hello && "micOwner" in hello && "listenState" in hello && Array.isArray(hello.notices), JSON.stringify(hello && Object.keys(hello)));
  await api("/settings", { mode: "silent", minutes: 0.05 });
  const ended = await until(async () => events.find((e) => e.ev === "settings" && e.data?.mode === "voice" && !e.data?.until), 75_000);
  check("a timed silent mode ends by itself and the screens are told", Boolean(ended), JSON.stringify(events.filter((e) => e.ev === "settings").map((e) => e.data?.mode)));
  ctl.abort();

  // #11 the desktop helper comes back after it's killed
  const first = await until(async () => { const o = await api("/overlay"); return o.running && o.ready && o.pid ? o : null; }, 120_000);
  check("the desktop helper built and started", Boolean(first), JSON.stringify(await api("/overlay")));
  if (first) {
    spawnSync("taskkill", ["/PID", String(first.pid), "/F"], { windowsHide: true });
    const back = await until(async () => { const o = await api("/overlay"); return o.running && o.ready && o.pid && o.pid !== first.pid ? o : null; }, 20_000);
    check("killed: the helper restarts by itself", Boolean(back), JSON.stringify(await api("/overlay")));
  }

  // #5 the same snooze sent twice (the screen and the desktop card): one snooze
  const s0 = (await api("/snooze")).list?.length ?? 0;
  const item = { kind: "alarm", alarm: true, at: new Date().toISOString(), text: "Double snooze test", hm: "07:00" };
  await Promise.all([api("/snooze", { item, minutes: 9 }), api("/snooze", { item, minutes: 9 })]);
  const s1 = (await api("/snooze")).list?.length ?? 0;
  check("the same alarm snoozed twice at once: one snooze", s1 === s0 + 1, `${s0} → ${s1}`);

  // #4/#5 two screens
  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright-core");
  const { playwrightChannel } = await import("../../lib/browsers.mjs");
  browser = await chromium.launch({ channel: playwrightChannel(), headless: true, args: ["--mute-audio"] });
  const mock = () => {
    const ss = window.speechSynthesis;
    if (ss) { ss.speak = (u) => { setTimeout(() => { u.onend?.(); }, 30); }; ss.cancel = () => {}; }
    HTMLMediaElement.prototype.play = function () { setTimeout(() => this.onended?.(), 30); return Promise.resolve(); };
    navigator.mediaDevices && (navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error("no microphone in tests")));
  };
  const page = async () => { const c = await browser.newContext(); await c.addInitScript(mock); const p = await c.newPage(); await p.goto(BASE + "/display"); await p.waitForTimeout(2500); if (await p.locator("#startBtn").isVisible().catch(() => false)) await p.click("#startBtn").catch(() => {}); return p; };
  const a = await page(), b = await page();
  await sleep(1500);
  const showing = (p) => p.evaluate(() => !document.querySelector("#alarm").hidden);
  await api("/test/announce", { kind: "alarm", alarm: true, hm: "07:00", text: "Two screen test alarm" });
  const both = await until(async () => (await showing(a)) && (await showing(b)), 8000);
  check("an alarm shows on both screens", Boolean(both));
  await a.click("#alarmOff");
  const bStopped = await until(async () => !(await showing(b)), 8000);
  check("\"I'm up\" on one screen stops the other", Boolean(bStopped));
  const t0 = (await api("/snooze")).list?.length ?? 0;
  await api("/test/announce", { kind: "alarm", alarm: true, hm: "07:05", text: "Snooze race alarm" });
  await until(async () => (await showing(a)) && (await showing(b)), 8000);
  await Promise.all([a.evaluate(() => document.querySelector("#alarmSnooze").click()), b.evaluate(() => document.querySelector("#alarmSnooze").click())]);
  await sleep(2500);
  const t1 = (await api("/snooze")).list?.length ?? 0;
  check("Snooze pressed on both screens at once: one snooze", t1 === t0 + 1, `${t0} → ${t1}`);
  check("…and both screens stop ringing", !(await showing(a)) && !(await showing(b)));
  // the speaker's pagehide beacon alone (its connection still open, as a frozen or slow-closing tab's is) hands the voice over
  const [spA, spB] = [await a.evaluate(() => window.dsIsSpeaker), await b.evaluate(() => window.dsIsSpeaker)];
  const spk = spA ? a : b, rest = spA ? b : a;
  const spkId = await spk.evaluate(() => window.dsPageId);
  await fetch(BASE + "/api/window/closed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: spkId }) });
  const took = await until(async () => (await rest.evaluate(() => window.dsIsSpeaker)) === true, 3000);
  check("the speaker's close beacon: the other screen takes over at once", spA !== spB && Boolean(spkId) && Boolean(took), `before ${spA}/${spB}, id ${spkId ? "yes" : "no"}`);
} catch (e) {
  check("the test ran to the end", false, e.stack ?? e.message);
} finally {
  try { await browser?.close(); } catch { /* gone */ }
  try { server?.kill(); } catch { /* gone */ }
  if (fail && serverLog) console.log(serverLog.split(/\r?\n/).filter((l) => /error|fail/i.test(l)).slice(-12).join("\n"));
  await sleep(800);
  if (!process.argv.includes("--keep")) { spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true }); rmSync(TMP, { recursive: true, force: true }); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
