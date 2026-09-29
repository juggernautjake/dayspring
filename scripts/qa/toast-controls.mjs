// Notifications must never cover the talk controls (✋ Stop, 🎤, ⌨ Type, 🎙 Talk, the Active/Quiet/Off badge).
// On a throwaway copy (port 4794): fills every kind of pop-up that sits on the screen at once (a stack of toasts incl. the
// long "Night mode" one, 7 timers, Lantern cards, the XP badge, the discovery toast, the speech card) and checks, on the
// full screen, Dayspring mini and a browser tab at several sizes, that no pop-up box overlaps a control and that every
// control is really clickable (elementFromPoint at its centre is the control itself).
//   node scripts/qa/toast-controls.mjs [--keep]
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
const { chromium } = require("playwright-core");
const PORT = await qaPort(4794), BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), "ds-toastctl-")), APP = join(TMP, "app");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" ? "  (" + got + ")" : ""}`); };

spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(join(APP, "data"), { recursive: true });
writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary" }));
const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_NO_ECO: "1", DS_PROFILE: "DayspringQA" };
const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = ""; server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
const post = (p, b) => fetch(BASE + "/api" + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json()).catch(() => ({}));
for (let i = 1; i <= 7; i++) await post("/timers", { action: "start", ms: (i * 7 + 3) * 60_000, label: ["pasta", "rice", "oven", "laundry", "garlic bread", "tea", "eggs"][i - 1] });

const browser = await chromium.launch({ channel: (await import(pathToFileURL(join(DESK, "lib", "browsers.mjs")).href)).playwrightChannel(), headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
const mock = () => {
  window.__dsAllowAutomatedListen = true;
  const ss = window.speechSynthesis; if (ss) { ss.speak = (u) => setTimeout(() => u.onend?.(), 10); ss.cancel = () => {}; }
  HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  class FakeSR { start() {} abort() { setTimeout(() => this.onend?.(), 5); } stop() { this.abort(); } }
  window.SpeechRecognition = window.webkitSpeechRecognition = FakeSR;
};
const DEVICE_ROUTES = /\/api\/(sound|window\/(ontop|compact|expand)|devices\/use|voicemeeter\/(install|setup)|keepawake|tunein|callbridge)/;

// every pop-up that can sit on screen, all at once
async function fill(p) {
  await p.evaluate(async () => {
    const t = window.dayspring?.toast;
    if (t) {
      t("Night mode", "After your day's last item the screen goes dark so it won't keep you up. Move the mouse, tap, or say my name to bring it back. Change it in Settings → Screen.", "", "bell");
      t("Reminder", "Take the trash out to the curb before the truck comes in the morning.", "wait", "bell", { snooze: { kind: "reminder", text: "trash" } });
      t("+25 XP: Studied", "You learned about closures and how scope works in JavaScript.", "", "bell");
      t("Update ready", "Dayspring 9.9.9 is ready to install.", "", "bell");
      t("Text from Sam", "Running a bit late, save me a seat!", "", "bell");
    }
    // the XP badge, the discovery toast, a Lantern card and the speech card, if their scripts are on this page
    const xb = document.getElementById("xpBadge"); if (xb) { xb.hidden = false; xb.textContent = "Lv 3 · 420 XP"; }
    window.dsSecretsFx?.toast?.({ name: "The Caveman", emoji: "🦴", line: "Ugg! New friend." });
    window.dsLanternCard?.({ id: "t1", title: "Course invitation", text: "Someone sent you a course: Python Basics. Accept it?" });
  });
  await p.waitForTimeout(900);
}

const CONTROLS = ["#stopBtn", "#muteBtn", "#typeBtn", "#pttBtn", "#stateBtn"];
const POPUPS = [".toasts .toast", ".toasts .clearall", "#dsxTimers .dsx-timer", ".lnstack .lncard", ".xp-badge", ".sttcard", "[data-secret-toast]", "#dsUpdate"];
async function measure(p) {
  return p.evaluate(([CONTROLS, POPUPS]) => {
    const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 2 && r.height > 2 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05 && !e.closest("[hidden]"); };
    const ctl = CONTROLS.flatMap((q) => [...document.querySelectorAll(q)]).filter(vis).map((e) => ({ id: "#" + e.id, r: e.getBoundingClientRect() }));
    // a pop-up inside a scrolling stack only counts where it's actually visible (clipped by its scroll container)
    const clip = (e) => { let r = e.getBoundingClientRect(); let box = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll|hidden|clip)/.test(s.overflowY + s.overflowX)) { const c = a.getBoundingClientRect(); box = { left: Math.max(box.left, c.left), right: Math.min(box.right, c.right), top: Math.max(box.top, c.top), bottom: Math.min(box.bottom, c.bottom) }; } }
      return box; };
    const pops = POPUPS.flatMap((q) => [...document.querySelectorAll(q)]).filter(vis).map((e) => ({ q: e.className || e.id, r: clip(e) })).filter((p) => p.r.right - p.r.left > 1 && p.r.bottom - p.r.top > 1);
    const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const overlaps = [];
    for (const c of ctl) for (const pp of pops) if (hit(c.r, pp.r)) overlaps.push(`${c.id}×${String(pp.q).slice(0, 24)}`);
    const blocked = ctl.filter((c) => { const x = c.r.left + c.r.width / 2, y = c.r.top + c.r.height / 2; const e = document.elementFromPoint(x, y); return !(e && (e.closest(c.id) || e.id === c.id.slice(1))); }).map((c) => c.id);
    return { controls: ctl.length, popups: pops.length, overlaps, blocked, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
  }, [CONTROLS, POPUPS]);
}

const layouts = [
  ["/display", 1920, 1080], ["/display", 1366, 768], ["/display", 1280, 720], ["/display", 1024, 700],
  ["/mini", 380, 560], ["/mini", 320, 480], ["/mini", 480, 700],
  ["/display", 390, 844], ["/display", 768, 1024],
];
for (const [path, w, h] of layouts) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(mock);
  await ctx.route("**/*", (rt) => (rt.request().method() === "POST" && DEVICE_ROUTES.test(rt.request().url()) ? rt.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }) : rt.continue()));
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE + path); await p.waitForTimeout(2500);
  if (await p.locator("#startBtn").isVisible().catch(() => false)) { await p.click("#startBtn"); await p.waitForTimeout(700); }
  await fill(p);
  const m = await measure(p);
  check(`${path} ${w}×${h}: no pop-up covers a control (${m.popups} pop-ups, ${m.controls} controls)`, m.overlaps.length === 0, m.overlaps.slice(0, 4).join(", "));
  check(`${path} ${w}×${h}: every control is clickable`, m.blocked.length === 0 && m.controls > 0, m.blocked.join(",") || `controls=${m.controls}`);
  check(`${path} ${w}×${h}: no page errors`, errs.length === 0, errs.slice(0, 2).join(" | "));
  if (m.overlaps.length || m.blocked.length) await p.screenshot({ path: join(TMP, `fail-${path.slice(1)}-${w}x${h}.png`) });
  await ctx.close();
}

await browser.close();
server.kill();
await sleep(500);
if (!process.argv.includes("--keep")) { spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true }); try { rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } }
else console.log("kept:", TMP);
console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nALL PASSED: ${pass} passed`);
process.exit(fail ? 1 : 0);
