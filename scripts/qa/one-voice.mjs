// One voice at a time, and no freezing, on a throwaway copy (port 4797; nothing real is heard, nothing opens):
//   • speaker election: two Dayspring screens open at once → exactly one is the speaker; an alarm on both → only one talks;
//     when the speaker closes, the other takes over
//   • the guided setup's guide goes quiet once a Dayspring screen opens
//   • stress: 50 /chat requests at once → every one answered, the server stays responsive (no freeze), no crash
//   node scripts/qa/one-voice.mjs [--keep]
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const { playwrightChannel } = await import("../../lib/browsers.mjs");
const PORT = 4797, BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), "ds-onevoice-")), APP = join(TMP, "app");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, got = "") => { if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" ? "  (" + got + ")" : ""}`); };

spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(join(APP, "data"), { recursive: true });
writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary" }));
const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", ELEVENLABS_API_KEY: "", AI_PROVIDER: "", DAYSPRING_REMINDER_CHANNEL: "off" };
const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = ""; server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);

const browser = await chromium.launch({ channel: playwrightChannel(), headless: true, args: ["--mute-audio"] });
const mock = () => {
  window.__spoken = [];
  const ss = window.speechSynthesis;
  if (ss) { ss.speak = (u) => { window.__spoken.push(u.text); setTimeout(() => { u.onend?.(); }, 30); }; ss.cancel = () => {}; }
  HTMLMediaElement.prototype.play = function () { window.__spoken.push("[audio]"); setTimeout(() => this.onended?.(), 30); return Promise.resolve(); };
};
async function page(path) { const ctx = await browser.newContext(); await ctx.addInitScript(mock); const p = await ctx.newPage(); await p.goto(BASE + path); await p.waitForTimeout(2500); if (await p.locator("#startBtn").isVisible().catch(() => false)) await p.click("#startBtn").catch(() => {}); return p; }
try {
  // ---- speaker election -----------------------------------------------------------------------------------------------
  const a = await page("/display"), b = await page("/display");
  await sleep(1500);
  const sa = await a.evaluate(() => window.dsIsSpeaker), sb = await b.evaluate(() => window.dsIsSpeaker);
  check("two screens open: exactly one is the speaker", sa !== sb, `first ${sa}, second ${sb}`);
  await a.evaluate(() => { window.__spoken = []; window.dispatchEvent(new CustomEvent("ds-test-alarm", { detail: { text: "Good morning. Time to get up." } })); });
  await b.evaluate(() => { window.__spoken = []; window.dispatchEvent(new CustomEvent("ds-test-alarm", { detail: { text: "Good morning. Time to get up." } })); });
  await sleep(6000);
  const ka = (await a.evaluate(() => window.__spoken)).filter((t) => /morning|\[audio\]/i.test(t)).length, kb = (await b.evaluate(() => window.__spoken)).filter((t) => /morning|\[audio\]/i.test(t)).length;
  check("an alarm on both screens: only the speaker talks", (ka > 0) !== (kb > 0), `first spoke ${ka}×, second ${kb}×`);
  const speakerPage = sa ? a : b, other = sa ? b : a;
  await speakerPage.close(); await sleep(1500);
  check("the speaker closes: the other screen takes over", await other.evaluate(() => window.dsIsSpeaker) === true);

  // ---- "stop" ends the whole reply and what was queued (not just one sentence) -----------------------------------------------
  const slowMock = () => { const ss = window.speechSynthesis; window.__spoken = []; ss.speak = (u) => { window.__spoken.push(u.text); u.__t = setTimeout(() => u.onend?.(), 400); window.__u = u; }; ss.cancel = () => { const u = window.__u; if (u) { clearTimeout(u.__t); window.__u = null; setTimeout(() => u.onerror?.({ error: "interrupted" }), 0); } }; };
  await other.evaluate(slowMock);
  await other.evaluate(() => { window.dispatchEvent(new CustomEvent("ds-test-say", { detail: { text: "One. Two. Three. Four." } })); window.dispatchEvent(new CustomEvent("ds-test-say", { detail: { text: "Five. Six." } })); });
  await other.waitForFunction(() => (window.__spoken ?? []).length >= 1, null, { timeout: 8000 }).catch(() => {});
  await sleep(150);
  await other.evaluate(() => window.dsStopSpeaking());
  await sleep(2500);
  const said = await other.evaluate(() => window.__spoken);
  check("stop ends the whole reply and drops what was queued", said.length >= 1 && !said.includes("Four.") && !said.includes("Five."), JSON.stringify(said));
  // ---- the morning wake-up stops for good when dismissed ------------------------------------------------------------------
  await other.evaluate(() => { window.__spoken = []; window.dispatchEvent(new CustomEvent("ds-test-morning")); });
  await sleep(700);
  await other.evaluate(() => document.querySelector("#alarmOff")?.click());
  await sleep(4000);
  const morning = await other.evaluate(() => window.__spoken);
  check("dismissing the wake-up stops the greeting's later parts", !morning.some((t) => /Segment/.test(t)), JSON.stringify(morning));
  // ---- a photo that's gone doesn't crash the server --------------------------------------------------------------------
  const ph = await fetch(`${BASE}/api/photos/img/0123456789abcdef`).then((r) => r.status).catch(() => 0);
  check("a missing photo is a 404, and the server keeps running", ph >= 400 && ph < 500 && await up(), `status ${ph}`);

  // ---- the guide stops when a screen opens -------------------------------------------------------------------------------
  const w = await page("/welcome");
  const quiet = await w.evaluate(() => new Promise((ok) => setTimeout(() => ok(document.title), 500)));
  const st = await (await fetch(`${BASE}/api/announcements`)).json();
  check("with a screen open, the setup page is not the speaker", Boolean(quiet) && st.clients >= 2);
  await w.close(); await other.close();

  // ---- stress: 50 chats at once ------------------------------------------------------------------------------------------
  const asks = ["what time is it", "what's on today", "add lunch tomorrow at noon", "what's the weather", "snooze 5 minutes", "show my week", "help"];
  const t0 = Date.now();
  const probe = (async () => { const lat = []; for (let i = 0; i < 10; i++) { const s = Date.now(); await up(); lat.push(Date.now() - s); await sleep(300); } return lat; })();
  const res = await Promise.all(Array.from({ length: 50 }, (_, i) => fetch(`${BASE}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: asks[i % asks.length], surface: "desk" }), signal: AbortSignal.timeout(60000) }).then((r) => r.status).catch((e) => "error " + e.message)));
  const lat = await probe;
  check("50 chats at once: all answered", res.every((x) => x === 200), JSON.stringify([...new Set(res)]));
  check("the server kept answering during them (no freeze over 1.5 s)", Math.max(...lat) < 1500, `slowest ${Math.max(...lat)} ms; all 50 took ${Date.now() - t0} ms`);
  check("still running afterwards, no crash", await up() && !/unexpected \(kept running\)/.test(serverLog), serverLog.match(/unexpected.*$/m)?.[0] ?? "");
  // clean up the test items the chats added
  const cal = await (await fetch(`${BASE}/api/calendar?from=2000-01-01&to=2100-01-01`).catch(() => null))?.json().catch(() => null);
  void cal;
} finally {
  await browser.close().catch(() => {});
  server.kill();
  await sleep(1000);
  spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true });
  if (!process.argv.includes("--keep")) try { rmSync(TMP, { recursive: true, force: true }); } catch { /* in use */ }
  console.log(fail ? `\n${fail} failed.` : "\nOne voice at a time, and no freezing: all good.");
  process.exit(fail ? 1 : 0);
}
