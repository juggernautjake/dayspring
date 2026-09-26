// 1.2.1: alarms ring even when the Dayspring window is closed. On a throwaway copy (port 4795) with the real desktop
// helper (Dayspring Notifications.exe) in test mode: every sound is a silent file at volume 0, so nothing is heard, and
// window launches are written to a log instead of opening. Its cards do appear briefly at the top-right of the screen.
//   node scripts/qa/alarm-closed.mjs [--keep]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 4795, BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), "ds-alarm-")), APP = join(TMP, "app"), LOG = join(TMP, "launch.log");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" ? "  (" + got + ")" : ""}`); };

if (process.platform !== "win32") { console.log("SKIP  Windows only"); process.exit(0); }
spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(join(APP, "data"), { recursive: true });
writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary", keepScreenOpen: false }));
const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DS_LAUNCH_LOG: LOG, DS_PROFILE: "DayspringQA", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_ECO: "1", DAYSPRING_OVERLAY: "1", DAYSPRING_OVERLAY_TEST: "1", DAYSPRING_TEST_HOOKS: "1", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", ELEVENLABS_API_KEY: "" };
const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = ""; server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
const api = async (p, body) => { const r = await fetch(BASE + "/api" + p, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return r.json().catch(() => ({})); };
const launches = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split(/\r?\n/).filter(Boolean).length : 0);
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(200); } return v; };

try {
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
  check("server started", await up());
  const running = await until(async () => (await api("/overlay")).running, 90_000);   // first start builds the helper
  check("the desktop helper built and started", Boolean(running), JSON.stringify(await api("/overlay")));
  await sleep(800);
  const n0 = launches();

  // 1. an alarm with no Dayspring screen open: the big card and the ring (silent file, volume 0)
  await api("/test/announce", { kind: "alarm", alarm: true, text: "Test alarm: time to get up" });
  let h = await until(async () => { const x = await api("/overlay/helper"); return x.ringing ? x : null; });
  check("closed screen: the helper rings the alarm", h?.ringing === true, JSON.stringify(h));
  check("tests stay silent (volume 0)", h?.volume === 0, String(h?.volume));
  check("the server knows it's ringing", Boolean((await api("/overlay")).ringing));

  // 2. answered on a Dayspring screen (or by voice there): the helper stops
  await api("/alarm/dismissed", { from: "screen" });
  h = await until(async () => { const x = await api("/overlay/helper"); return x.ringing === false ? x : null; });
  check("dismissed elsewhere: the helper stops ringing", h?.ringing === false);

  // 3. Snooze on the card: snoozed for 9 minutes through the snooze list, and the ring stops
  const s0 = (await api("/snooze")).list?.length ?? 0;
  await api("/test/announce", { kind: "alarm", alarm: true, text: "Second test alarm" });
  await until(async () => (await api("/overlay/helper")).ringing);
  await api("/test/overlay", { type: "alarm-stop", why: "snoozed" });
  h = await until(async () => { const x = await api("/overlay/helper"); return x.ringing === false ? x : null; });
  const snoozes = await until(async () => { const l = (await api("/snooze")).list ?? []; return l.length > s0 ? l : null; }, 4000);
  check("Snooze on the card: the ring stops", h?.ringing === false);
  check("Snooze on the card: it comes back in about 9 minutes", Array.isArray(snoozes) && snoozes.length > s0 && Math.abs((typeof snoozes.at(-1).until === "number" ? snoozes.at(-1).until : Date.parse(snoozes.at(-1).until)) - Date.now() - 9 * 60_000) < 90_000, JSON.stringify(snoozes?.at?.(-1)?.until ?? null));

  // 4. Dismiss on the card
  await api("/test/announce", { kind: "alarm", alarm: true, text: "Third test alarm" });
  await until(async () => (await api("/overlay/helper")).ringing);
  await api("/test/overlay", { type: "alarm-stop", why: "dismissed" });
  h = await until(async () => { const x = await api("/overlay/helper"); return x.ringing === false ? x : null; });
  check("Dismiss on the card: the ring stops", h?.ringing === false);

  // 5. notifications with the screen closed: Chime chimes, Silent doesn't, Speak chimes unless "speak when closed" is on
  const played = async () => (await api("/overlay/helper")).played ?? 0;
  await api("/settings", { notify: { reminders: "chime" }, notifyAll: null, speakWhenClosed: false });
  let p0 = await played();
  await api("/test/announce", { kind: "reminder", text: "Chime test", reminder: { text: "Chime test" } });
  check("Chime: the helper chimes", Boolean(await until(async () => (await played()) > p0, 5000)));
  await api("/settings", { notify: { reminders: "silent" } });
  p0 = await played();
  await api("/test/announce", { kind: "reminder", text: "Silent test", reminder: { text: "Silent test" } });
  await sleep(1500);
  check("Silent: no sound", (await played()) === p0);
  await api("/settings", { notify: { reminders: "voice" }, speakWhenClosed: false });
  p0 = await played();
  await api("/test/announce", { kind: "reminder", text: "Speak test", reminder: { text: "Speak test" } });
  check("Speak with 'speak when closed' off: a chime instead", Boolean(await until(async () => (await played()) > p0, 5000)));
  await api("/settings", { speakWhenClosed: true });
  const sp0 = (await api("/overlay/helper")).spoken ?? 0;
  await api("/test/announce", { kind: "reminder", text: "Spoken test", reminder: { text: "Spoken test" } });
  check("Speak with 'speak when closed' on: Windows' voice (volume 0 here)", Boolean(await until(async () => ((await api("/overlay/helper")).spoken ?? 0) > sp0 || (await played()) > p0 + 1, 6000)));
  await api("/settings", { speakWhenClosed: false, notify: { reminders: "auto" } });

  // 6. Off with "Alarms still ring when Off" turned off: a card only, no ring
  await api("/listen", { state: "off" });
  await api("/settings", { alarmsWhenOff: false });
  await api("/test/announce", { kind: "alarm", alarm: true, text: "Muted test alarm" });
  await sleep(1500);
  check("Off with alarms muted: no ring", (await api("/overlay/helper")).ringing === false);
  await api("/settings", { alarmsWhenOff: true });
  await api("/listen", { state: "active" });

  // 7. a Dayspring screen is open: it plays the alarm itself, and the helper stays silent
  const sse = await new Promise((resolve) => { const req = http.get(`${BASE}/api/events?page=display&id=qa-screen`, (res) => resolve({ req, res })); req.on("error", () => resolve(null)); });
  await sleep(600);
  const pOpen = await played();
  await api("/test/announce", { kind: "alarm", alarm: true, text: "Screen-open test alarm" });
  await api("/settings", { notify: { reminders: "chime" } });
  await api("/test/announce", { kind: "reminder", text: "Screen-open chime", reminder: { text: "Screen-open chime" } });
  await sleep(1500);
  const hOpen = await api("/overlay/helper");
  check("screen open: the helper doesn't ring (no double alarm)", hOpen.ringing === false);
  check("screen open: the helper doesn't chime (no double sound)", (hOpen.played ?? 0) === pOpen);
  sse?.req.destroy();

  // 8. nothing opened a window, and closed stayed closed
  check("no window was opened for any alarm or notification", launches() === n0, `${launches() - n0} launches`);
  check("no server errors", !/Unhandled|TypeError|ReferenceError/.test(serverLog), (serverLog.match(/(Unhandled|TypeError|ReferenceError)[^\n]*/) ?? [""])[0]);
} catch (e) {
  fail++; console.log("FAIL  crashed: " + e.message);
} finally {
  try { server.kill(); } catch { /* gone */ }
  await sleep(800);
  spawnSync("taskkill", ["/f", "/t", "/fi", `WINDOWTITLE eq nonexistent`], { windowsHide: true });   // no-op; the helper exits with the server (its stdin closes)
  if (!process.argv.includes("--keep")) { try { spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true }); rmSync(TMP, { recursive: true, force: true }); } catch { /* temp */ } }
}
console.log(`\n${fail ? "FAILED" : "ALL PASSED"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
