// Badges in a headless browser, on a throwaway copy (port 4795; nothing heard or opened on screen):
// the Gallery (shelves, mystery cards with no art in the page, the NEW coin flip once, the detail view with the
// clincher and the citation, the badge case), the "?" card flipping over when a badge is earned while it's showing,
// the reveal on the display, reduced motion, and no page errors.
//   node scripts/qa/badges-ui.mjs [--keep]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { qaPort } from "./port.mjs";   // a free port (or QA_PORT), so parallel runs never collide
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { thresholds } from "../../lib/xp/badges.mjs";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const PORT = await qaPort(4795), BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), "ds-badges-")), APP = join(TMP, "app");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" ? "  (" + got + ")" : ""}`); };

spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(join(APP, "data"), { recursive: true });
writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Casey", setupDone: true, display: "primary" }));
// a ledger with some history: workouts on 5 days (tier 1 and 2 of Fitness), one act of service (several Service tiers),
// and Fitness left just short of tier 3, so one more workout crosses it
const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString("en-CA"); };
const lines = []; let id = 0;
const add = (n, category, amount, evidence) => lines.push(JSON.stringify({ id: `seed${id++}`, at: `${day(n)}T07:30:00`, day: day(n), type: "award", amount, category, source: "block", evidence, fp: null, title: "" }));
const tw = thresholds("workout");
let credit = 0, n = 12;
while (credit + 22 < tw[2] - 5) { add(n, "workout", 22, "ran for 30 minutes"); credit += 22; n--; }
add(n - 1, "workout", Math.max(1, tw[2] - 5 - credit), "a 45-minute run"); credit = tw[2] - 5;
add(3, "volunteer", 22, "served at the food bank");
writeFileSync(join(APP, "data", "xp-ledger.jsonl"), lines.join("\n") + "\n");
const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_ECO: "1",
  ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", ELEVENLABS_API_KEY: "", AI_PROVIDER: "none" };
const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = ""; server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
await sleep(2500);                                             // the startup sync of badges
const api = (p, body) => fetch(BASE + "/api" + p, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}).then((r) => r.json());

const browser = await chromium.launch({ channel: (await import(pathToFileURL(join(DESK, "lib", "browsers.mjs")).href)).playwrightChannel(), headless: true, args: ["--mute-audio"] });
try {
  const v0 = await api("/xp/badges");
  const fit = v0.categories.find((c) => c.cat === "workout");
  check("the ledger's badges were recorded at startup", v0.total >= 4 && fit.earned === 2, `${v0.total} total, Fitness ${fit.earned}`);
  check("no art for a badge that isn't earned", (await fetch(`${BASE}/api/xp/badge.svg?cat=reading&tier=1`)).status === 404);
  check("L7: a mystery card only for the next tier (Fitness 3), never a later one", (await fetch(`${BASE}/api/xp/mystery.svg?cat=workout&tier=3`)).status === 200 && (await fetch(`${BASE}/api/xp/mystery.svg?cat=workout&tier=5`)).status === 404 && (await fetch(`${BASE}/api/xp/mystery.svg?cat=workout&tier=1`)).status === 404);

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { window.__dsAllowAutomatedListen = false; if (window.speechSynthesis) window.speechSynthesis.speak = () => {}; });
  const p = await ctx.newPage(); const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${BASE}/progress#badges`); await p.waitForSelector(".bshelf", { timeout: 8000 });
  await p.waitForTimeout(600);
  const g = await p.evaluate(() => ({
    shelves: document.querySelectorAll(".bshelf[data-cat]").length, earned: document.querySelectorAll(".bshelf .bcard.earned").length,
    next: document.querySelectorAll(".bcard.next").length, locked: document.querySelectorAll(".bcard.locked").length,
    artSrcs: [...document.querySelectorAll("img")].map((i) => i.getAttribute("src")).filter((s) => s?.includes("/badge.svg")),
    nextHTML: [...document.querySelectorAll(".bcard.next")].map((c) => c.outerHTML).join(""),
    summary: document.querySelector(".bsum")?.textContent ?? "", fitHead: document.querySelector('.bshelf[data-cat="workout"] .bhead')?.textContent ?? "",
  }));
  check("the Gallery: 18 shelves, earned badges, a mystery card per category, the rest locked", g.shelves === 18 && g.earned === v0.total && g.next === 18 && g.locked === 18 * 17 - v0.total + (18 - 18), JSON.stringify({ s: g.shelves, e: g.earned, n: g.next, l: g.locked }));
  const earnedKeys = new Set(v0.categories.flatMap((c) => c.tiers.filter((t) => t.state === "earned").map((t) => t.key)));
  const leaked = g.artSrcs.filter((s) => { const u = new URL(s, BASE); return !earnedKeys.has(`${u.searchParams.get("cat")}:${u.searchParams.get("tier")}`); });
  check("the page only loads art for earned badges (the next ones are '?' cards)", !leaked.length && !/badge\.svg|class="emb"|<title/.test(g.nextHTML), leaked.join(", "));
  check("the header: '2 of 18 · next in N XP'", /^2 of 18 · next in \d+ XP$/.test(g.fitHead.trim()), g.fitHead);
  check("the summary: totals, rarest, newest", /of 324 badges/.test(g.summary) && /Rarest/.test(g.summary) && /Newest/.test(g.summary), g.summary.slice(0, 120));
  // NEW: each flips in once
  await p.waitForTimeout(v0.total * 400 + 3200);
  const flips1 = await p.evaluate(() => window.__dsBadgeFlips ?? 0);
  check("new badges flip in (once each)", flips1 === v0.total, `${flips1} flips for ${v0.total} new`);
  await p.reload(); await p.waitForSelector(".bshelf"); await p.waitForTimeout(1500);
  check("…and not again next time", (await p.evaluate(() => window.__dsBadgeFlips ?? 0)) === 0 && (await p.locator(".bnew").count()) === 0);
  // the detail view
  await p.click('.bshelf[data-cat="workout"] .bcard.earned >> nth=1'); await p.waitForSelector(".bdet .bflip", { timeout: 5000 });
  await p.waitForTimeout(2800);
  const det = await p.evaluate(() => ({ text: document.querySelector(".bdet")?.innerText ?? "", svg: Boolean(document.querySelector(".bdet .bfront svg.b.full")), back: Boolean(document.querySelector(".bdet .bback svg.back")) }));
  check("detail: the citation, the activity that earned it, along the way", /Casey (achieved|earned|reached|unlocked) this (milestone|badge|honour) by running for (30|45) minutes on \w+ \d+(st|nd|rd|th), \d{4}!/.test(det.text) && /The activity that earned it/i.test(det.text) && /Along the way: \d+ workouts from/.test(det.text), det.text.slice(0, 200));
  check("detail: the full animated badge, with a real back face for the flip", det.svg && det.back);
  await p.click(".bpin"); await p.waitForTimeout(900);
  check("Pin to badge case", (await p.locator(".bcase .bcard.earned").count()) === 1);
  // the display shows the case and the reveal
  const disp = await ctx.newPage(); const derr = []; disp.on("pageerror", (e) => derr.push(e.message));
  await disp.goto(`${BASE}/display`); await disp.waitForTimeout(3000);
  if (await disp.locator("#startBtn").isVisible().catch(() => false)) { await disp.click("#startBtn"); await disp.waitForTimeout(800); }
  await disp.waitForSelector("#xpBadge .xpb-case img", { timeout: 15000 }).catch(() => {});      // the page can take a few seconds to paint
  check("the display's XP pill shows the badge case", (await disp.locator("#xpBadge .xpb-case img").count()) === 1);
  // earn Fitness tier 3 while the gallery shows its "?" card
  await p.bringToFront();
  const before = await p.evaluate(() => window.__dsBadgeFlips ?? 0);
  const a1 = await api("/xp/checkin", { category: "workout", done: true });            // a typed check-in (self-reported: a client can't claim a block)
  const a2 = await api("/xp/answer", { text: "ran for 30 minutes around the lake", id: a1.session });
  check("the check-in crossing tier 3 says so", /🏅 New badge: .+! Casey .+ by running around the lake for 30 minutes on /.test(a2.reply ?? ""), `${a1.reply} | ${a2.reply}`);
  await p.waitForTimeout(3500);
  const rv = await p.evaluate((b) => ({ flips: (window.__dsBadgeFlips ?? 0) - b }), before);
  check("the '?' card flipped over to reveal it", rv.flips >= 1, JSON.stringify(rv));
  await p.waitForTimeout(1500);
  check("…and the shelf now shows it", (await p.locator('.bshelf[data-cat="workout"] .bcard.earned').count()) === 3);
  const revealed = await disp.evaluate(() => ({ shown: Boolean(document.querySelector(".brev")), text: document.querySelector(".brev")?.innerText ?? "" }));
  check("the display shows the reveal: the badge, 'Earned with…', the citation", revealed.shown && /New badge/.test(revealed.text) && /Earned with/.test(revealed.text) && /Casey/.test(revealed.text), revealed.text.slice(0, 160));
  // reduced motion: no spin, a fade and one glint
  const rctx = await browser.newContext({ viewport: { width: 1000, height: 800 }, reducedMotion: "reduce" });
  const rp = await rctx.newPage(); rp.on("pageerror", (e) => errors.push(e.message));
  await rp.goto(`${BASE}/progress#badges`); await rp.waitForSelector(".bshelf");
  await rp.click('.bshelf[data-cat="workout"] .bcard.earned >> nth=0'); await rp.waitForSelector(".bdet .bflip"); await rp.waitForTimeout(900);
  const rm = await rp.evaluate(() => ({ reduced: document.querySelector(".bdet .bflip")?.dataset.reduced, spun: /rotateY\((?!0)/.test(document.querySelector(".bdet .bflip-coin")?.style.transform ?? "") }));
  check("reduced motion: a fade instead of the spin", rm.reduced === "1" && !rm.spun, JSON.stringify(rm));
  await rctx.close();
  // voice
  const c1 = await api("/chat", { message: "what did I do to earn my last badge?", surface: "desk" });
  check("voice: 'what did I do to earn my last badge?'", /^Casey .+ by running around the lake for 30 minutes on /.test(c1.reply ?? ""), c1.reply);
  const c2 = await api("/chat", { message: "open my badge gallery", surface: "desk" });
  check("voice: 'open my badge gallery'", /gallery/i.test(c2.reply ?? "") && c2.show === "badges", `${c2.reply} ${c2.show}`);
  check("no page errors", !errors.length && !derr.length, [...errors, ...derr].join(" | "));
} finally {
  await browser.close().catch(() => {});
  server.kill(); await sleep(500);
  spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true });
  if (!process.argv.includes("--keep")) rmSync(TMP, { recursive: true, force: true });
}
if (fail) console.log(serverLog.split("\n").filter((l) => /error|xp|badge/i.test(l)).slice(-15).join("\n"));
console.log(`\n${fail ? "FAILED" : "ALL PASSED"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
