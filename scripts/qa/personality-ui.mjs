// Settings → Personality in a headless browser, on a throwaway copy (port 4795; nothing heard or opened on screen):
// the character gallery, a slider drag nudging a linked slider, a pin stopping it, the preview updating, saving a
// template, and the 300-word counter blocking at 301.
//   node scripts/qa/personality-ui.mjs [--keep]
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const PORT = 4795, BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), "ds-persona-")), APP = join(TMP, "app");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" ? "  (" + got + ")" : ""}`); };

spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(join(APP, "data"), { recursive: true });
writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Casey", setupDone: true, display: "primary" }));
const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_ECO: "1", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", AI_PROVIDER: "none" };
const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = ""; server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);

const browser = await chromium.launch({ channel: (await import(pathToFileURL(join(DESK, "lib", "browsers.mjs")).href)).playwrightChannel(), headless: true, args: ["--mute-audio"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage(); const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${BASE}/setup?s=personality`); await p.waitForTimeout(2500);
  const cards = await p.locator("[data-preset]").count();
  check("gallery: every built-in character is a card", cards >= 21, String(cards));
  const setRange = (id, v) => p.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event("input", { bubbles: true })); }, [id, v]);
  const val = (id) => p.evaluate((id) => Number(document.getElementById(id).value), id);
  const bite0 = await val("ps-base-bite");
  await setRange("ps-base-warmth", 60); await p.waitForTimeout(900);
  const bite1 = await val("ps-base-bite"), praise1 = await val("ps-base-praise");
  check("dragging Warmth nudges Bite down and Praise up", bite1 < bite0 && praise1 > 0, `bite ${bite0}→${bite1}, praise ${praise1}`);
  await p.click('[data-pin="bite"]'); await p.waitForTimeout(600);
  const pinned = await p.evaluate(() => document.querySelector('[data-pin="bite"]').getAttribute("aria-pressed"));
  const biteBefore = await val("ps-base-bite");
  await setRange("ps-base-warmth", 100); await p.waitForTimeout(900);
  check("a pinned slider doesn't move", pinned === "true" && (await val("ps-base-bite")) === biteBefore, `pinned=${pinned}, bite ${biteBefore}→${await val("ps-base-bite")}`);
  const pv0 = await p.textContent("#ps-preview");
  await p.click('[data-preset="pirate"]'); await p.waitForTimeout(1200);
  const pv1 = await p.textContent("#ps-preview");
  check("picking a character updates the preview", pv1 !== pv0 && /ahoy|matey|aye|arr|ye|shipshape|be/i.test(pv1), pv1.slice(0, 120));
  const roles = await p.locator("#ps-role input[type=range]").count();
  check("the character's own sliders appear", roles >= 2, String(roles));
  await p.fill("#ps-custom", Array(301).fill("grumpy").join(" "));
  const over = await p.evaluate(() => ({ disabled: document.getElementById("ps-build").disabled, text: document.getElementById("ps-words").textContent }));
  await p.fill("#ps-custom", Array(300).fill("grumpy").join(" "));
  const ok300 = await p.evaluate(() => !document.getElementById("ps-build").disabled);
  check("the 300-word counter blocks at 301", over.disabled && /301 \/ 300/.test(over.text) && ok300, JSON.stringify(over));
  await p.fill("#ps-custom", "A grumpy lighthouse keeper who secretly loves people and speaks briefly.");
  await p.click("#ps-build"); await p.waitForTimeout(1500);
  const card = await p.evaluate(() => !document.getElementById("ps-card").hidden && /Review your persona/.test(document.getElementById("ps-card").textContent));
  check("Build persona (no AI): a card to review appears", card);
  await p.click("#ps-card-use"); await p.waitForTimeout(900);
  const st = await (await fetch(`${BASE}/api/persona`)).json();
  check("using the custom persona sets its sliders from the words", st.preset === "custom" && st.base.outlook < 0 && st.base.length < 0, JSON.stringify({ preset: st.preset, outlook: st.base.outlook, length: st.base.length }));
  await p.click("#ps-save"); await p.waitForTimeout(300);
  await p.fill(".ps-dialog input", "Lighthouse"); await p.click(".ps-dialog [data-ok]"); await p.waitForTimeout(900);
  check("Save as… adds a saved personality card", (await p.locator("[data-apply]").count()) === 1);
  const locked0 = await p.locator("#ps-secrets .ps-card.locked").count();
  check("secret characters show as locked ??? cards with a counter", locked0 >= 12 && /Secrets found: 0 of \d+/.test(await p.textContent("#ps-secret-count")), `${locked0} locked`);
  // a Dayspring screen open alongside: it should celebrate too (confetti + card, from the SSE event)
  const disp = await ctx.newPage();
  await disp.addInitScript(() => { window.speechSynthesis && (window.speechSynthesis.speak = () => {}); HTMLMediaElement.prototype.play = function () { return Promise.resolve(); }; });
  await disp.goto(`${BASE}/display`); await disp.waitForTimeout(2500);
  if (await disp.locator("#startBtn").isVisible().catch(() => false)) { await disp.click("#startBtn"); await disp.waitForTimeout(600); }
  await p.bringToFront();
  await p.click('[data-preset="bard"]'); await p.waitForTimeout(900);
  await setRange("ps-role-rhyme", 100); await p.waitForTimeout(700);
  await setRange("ps-role-comic", 100); await p.waitForTimeout(1200);
  const found = await p.evaluate(() => ({ card: Boolean(document.querySelector(".ps-found")), secret: Boolean(document.querySelector('#ps-secrets [data-preset="limerick"], #ps-secrets [data-unlock="limerick"]')), unlock: document.querySelector('#ps-secrets [data-unlock="limerick"]')?.textContent ?? null, count: document.getElementById("ps-secret-count").textContent }));
  check("a slider combination discovers a secret: celebration card, unlocked card, counter", found.card && found.secret && /Secrets found: 1 of/.test(found.count), JSON.stringify(found));
  // with the XP module present a found secret is locked behind XP: the card names its price and the counter the balance
  if (found.unlock) check("a found secret shows its XP price and your balance", /Unlock for [0-9]+ XP/.test(found.unlock) && /Your XP:/.test(found.count), JSON.stringify(found));
  const onScreen = await disp.evaluate(() => [...document.querySelectorAll("[role=status]")].some((e) => /Secret character discovered/.test(e.textContent)) || Boolean(document.querySelector("canvas[style*='2147483000']")));
  check("the Dayspring screen celebrates the discovery too", onScreen);
  await disp.close();
  await p.click("#ps-hints"); await p.waitForTimeout(700);
  check("Reveal all hints shows clues", (await p.locator("#ps-secrets .ps-clue").count()) >= 12);
  await p.click("#ps-reset-secrets"); await p.waitForTimeout(300); await p.click(".ps-dialog [data-ok]"); await p.waitForTimeout(900);
  check("Reset discoveries locks them again", (await p.locator("#ps-secrets .ps-card.locked").count()) === locked0);
  await p.click("#ps-normal"); await p.waitForTimeout(800);
  check("Back to normal", (await (await fetch(`${BASE}/api/persona`)).json()).preset === "default");
  check("no page errors", errors.length === 0, errors.join(" | "));
  await p.screenshot({ path: join(TMP, "personality.png"), fullPage: true });
  await ctx.close();
} finally {
  await browser.close();
  server.kill();
  await sleep(500);
  if (!process.argv.includes("--keep")) { spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true }); try { rmSync(TMP, { recursive: true, force: true }); } catch { /* in use */ } }
  else console.log("kept:", TMP);
}
console.log(`\n${fail ? "FAILED" : "ALL PASSED"}: ${pass} passed, ${fail} failed`);
if (fail) console.log(serverLog.split(/\r?\n/).slice(-15).join("\n"));
process.exit(fail ? 1 : 0);
