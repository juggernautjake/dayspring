// XP in a headless browser, on a throwaway copy (port 4794; nothing heard or opened on screen): the Progress page,
// a typed check-in ("I finished studying" → "What's one thing you learned?" → an answer → XP), the badge on the
// display updating, and the XP answers in the chat.
//   node scripts/qa/xp-ui.mjs [--keep]
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const PORT = 4794, BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), "ds-xp-")), APP = join(TMP, "app");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" ? "  (" + got + ")" : ""}`); };

spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(join(APP, "data"), { recursive: true });
writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Casey", setupDone: true, display: "primary" }));
const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_ECO: "1",
  ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", ELEVENLABS_API_KEY: "", AI_PROVIDER: "none" };
const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = ""; server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
const api = (p, body) => fetch(BASE + "/api" + p, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}).then((r) => r.json());
const LEARNED = "I learned that the preterite in Spanish is for actions that finished in the past, and the imperfect is for things that kept happening, like fui versus iba.";

const browser = await chromium.launch({ channel: (await import(pathToFileURL(join(DESK, "lib", "browsers.mjs")).href)).playwrightChannel(), headless: true, args: ["--mute-audio"] });
try {
  const v0 = await api("/xp");
  check("a new install starts at level 1 with 0 XP", v0.balance === 0 && v0.level?.level === 1, JSON.stringify({ b: v0.balance, l: v0.level?.level }));

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const disp = await ctx.newPage(); const derr = [];
  disp.on("pageerror", (e) => derr.push(e.message));
  await ctx.addInitScript(() => { window.__dsAllowAutomatedListen = false; if (window.speechSynthesis) window.speechSynthesis.speak = () => {}; });
  await disp.goto(`${BASE}/display`); await disp.waitForTimeout(3000);
  if (await disp.locator("#startBtn").isVisible().catch(() => false)) { await disp.click("#startBtn"); await disp.waitForTimeout(800); }
  const badge0 = await disp.evaluate(() => { const b = document.getElementById("xpBadge"); return b ? { shown: !b.hidden, text: b.textContent } : null; });
  check("the display shows the XP badge", badge0?.shown && /0 XP/.test(badge0.text), JSON.stringify(badge0));

  const p = await ctx.newPage(); const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${BASE}/progress`); await p.waitForTimeout(1500);
  const sections = await p.locator("#xpPage section").count();
  check("the Progress page renders (level, chart, check-in, unlocks, history, rules, settings)", sections >= 6, String(sections));
  await p.fill("#xpText", "I finished studying"); await p.click("#xpCheck button[type=submit]"); await p.waitForTimeout(700);
  const q1 = await p.textContent("#xpReply");
  check("'I finished studying' → it asks what you learned", /learned/i.test(q1), q1);
  await p.fill("#xpText", "stuff"); await p.click("#xpCheck button[type=submit]"); await p.waitForTimeout(700);
  const q2 = await p.textContent("#xpReply");
  check("'stuff' isn't enough: it asks for something specific", /more|specific/i.test(q2), q2);
  await p.fill("#xpText", LEARNED); await p.click("#xpCheck button[type=submit]"); await p.waitForTimeout(700);
  const q3 = await p.textContent("#xpReply");
  check("a real answer earns XP (self-report: 70% of 25)", /\+18 XP/.test(q3), q3);
  await p.waitForTimeout(1500);
  const v1 = await api("/xp");
  check("the balance and the recent list show it", v1.balance === 18 && v1.recent.some((e) => e.category === "study" && /preterite/.test(e.evidence)), `${v1.balance}`);
  await disp.waitForTimeout(1500);
  const badge1 = await disp.evaluate(() => document.getElementById("xpBadge")?.textContent ?? "");
  check("the badge on the display updated", /18 XP/.test(badge1), badge1);

  // the same thing by chat (typed on the desk surface)
  const c1 = await api("/chat", { message: "how much xp do I have", surface: "desk" });
  check("chat: 'how much xp do I have'", /18 XP/.test(c1.reply ?? ""), c1.reply);
  const c2 = await api("/chat", { message: "I went for a walk", surface: "desk" });
  const c3 = c2.reply && /outside/i.test(c2.reply) ? await api("/chat", { message: "walked around the park with the dog", surface: "desk" }) : c2;
  check("chat: 'I went for a walk' → what did you do outside → XP", /\+\d+ XP/.test(c3.reply ?? ""), `${c2.reply} | ${c3.reply}`);
  const c4 = await api("/chat", { message: "undo my last check-in", surface: "desk" });
  check("chat: undo my last check-in", /undone/i.test(c4.reply ?? ""), c4.reply);
  check("no page errors", errors.length === 0 && derr.length === 0, [...errors, ...derr].join(" | "));
} finally {
  await browser.close().catch(() => {});
  server.kill();
  await sleep(500);
  spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true });
  if (!process.argv.includes("--keep")) rmSync(TMP, { recursive: true, force: true });
}
if (fail) console.log(serverLog.split("\n").filter((l) => /error|xp/i.test(l)).slice(-15).join("\n"));
console.log(`\n${fail ? "FAILED" : "ALL PASSED"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
