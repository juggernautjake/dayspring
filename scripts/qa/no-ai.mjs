// 1.3.0: a day with Dayspring and no AI brain, on a throwaway copy (port 4791, no keys; nothing is heard, no device is
// touched, nothing opens on screen; the web is never searched: recipe results are drawn from a made-up list).
//   A. 40 everyday requests through /api/chat, each checked (the "day in the life")
//   B. the Dayspring screen in a headless browser: the suggestion card (and picking from it), the timer stack, a finished
//      timer's card with its name, cooking mode, the 6 recipe cards, the Help link after repeated misses, the Settings
//      "Without AI" Try-it box, the Recipes page
//   C. Stop drops a reply that's still on its way (no late answer is shown or said)
//   node scripts/qa/no-ai.mjs [--keep]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { qaPort } from "./port.mjs";   // a free port (or QA_PORT), so parallel runs never collide
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const PORT = await qaPort(4791), BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), "ds-noai-")), APP = join(TMP, "app");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" && !ok ? "  (" + String(got).slice(0, 220) + ")" : ""}`); };

spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(join(APP, "data"), { recursive: true });
writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary" }));
const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_NO_ECO: "1",
  ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", ELEVENLABS_API_KEY: "", AI_PROVIDER: "", DAYSPRING_REMINDER_CHANNEL: "off", DAYSPRING_TIMER_REPEAT_MS: "4000" };
const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = ""; server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
const api = async (path, body, method = body === undefined ? "GET" : "POST") => { const r = await fetch(BASE + "/api" + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return r.json(); };
const chat = (message) => api("/chat", { message, surface: "tv", typed: true });

try {
  // ---------------- A. a day in the life, no AI ----------------
  const DAY = [
    ["good morning", /morning/i],
    ["what time is it", /^It's \d{1,2}(:\d\d)? [ap]\.m\.$/],
    ["what's today's date", /Today is \w+day/],
    ["what's the weather", /Where you are|weather|degrees/i],
    ["add dentist tomorrow at 3pm", /Dentist/],
    ["what's on tomorrow", /Dentist/],
    ["set a timer for 10 minutes", /What's it for\?/],
    ["pasta", /pasta/i],
    ["set a laundry timer for 30 minutes", /laundry timer for 30 minutes/],
    ["what timers do I have", /^You have 2: pasta, .*laundry/],
    ["how long left on the pasta", /Pasta timer: \d+ minutes? left/],
    ["add 2 minutes to the pasta timer", /Added 2 minutes/],
    ["cancel the laundry timer", /Cancelled the laundry timer/],
    ["what's 15% of 80", /12/],
    ["how many tablespoons in a cup", /16/],
    ["spell necessary", /n, e, c|N-E-C|n e c/i],
    ["flip a coin", /heads|tails/i],
    ["add milk and eggs to my shopping list", /milk and eggs/],
    ["what's on my shopping list", /milk and eggs/],
    ["take a note call the plumber", /Noted/],
    ["read john 3:16", /God so loved the world/],
    ["tell me a joke", /\S/],
    ["knock knock", /^Who's there\?$/],
    ["lettuce", /^Lettuce who\?$/],
    ["lettuce in it's cold out here", /ha|good one|great|love it/i],
    ["count to 5", /^1, 2, 3, 4, 5\.$/],
    ["what's the capital of france", /Paris/],
    ["is 2028 a leap year", /Yes, 2028 is a leap year/],
    ["let's play rock paper scissors", /Rock, paper, or scissors/],
    ["rock", /I picked (rock|paper|scissors)/],
    ["I'm stressed", /breath|one step|here/i],
    ["remind me to take out the trash every tuesday night", /every Tuesday at 8 p\.m\./],
    ["start a pomodoro", /Focus session started/],
    ["stop the pomodoro", /focus session over/i],
    ["what recipes do I have", /Simple pancakes|pancake/i],
    ["let's make pancakes", /Let's make/],
    ["next step", /Step 1 of/],
    ["stop cooking", /done cooking/],
    ["what can you do", /Even without AI|Without an AI brain/],
    ["good night", /night|dreams/i],
  ];
  for (const [said, want] of DAY) { const r = await chat(said); check(`day: "${said}"`, want.test(r.reply ?? ""), r.reply ?? r.error); }
  check("the day has 40 requests", DAY.length === 40);
  const bad = await chat("florp my timers");
  check("unclear → a numbered list (up to 7) and None of these", bad.suggest?.options?.length >= 1 && bad.suggest.options.length <= 7 && bad.suggest.none === "None of these", JSON.stringify(bad).slice(0, 200));
  const picked = await chat("1");
  check("… '1' runs the first choice", Boolean(picked.intent) && !picked.suggest, JSON.stringify(picked).slice(0, 160));
  const none1 = await chat("xqzv blorp"), none2 = await chat("wibble wobble zork"), none3 = await chat("qqq zzz vvv");
  check("three misses in a row → the link to adding AI", /hard time understanding/.test(none3.reply) && /help/.test(none3.link?.url ?? ""), `${none1.reply} / ${none2.reply} / ${none3.reply}`);
  const tr = await api("/intents/try", { text: "set a pasta timer for 8 minutes" });
  check("Try it: says what it would do, and does nothing", tr.intent === "timer.start" && tr.confident && !(await api("/timers")).timers.some((t) => /pasta 2|pasta/.test(t.label) && t.ms === 480000));
  const cat = await api("/intents");
  check("the catalogue is served for the Help list (150+ intents)", cat.intents?.length >= 150, cat.intents?.length);

  // questions about texts are answered and never change the "read texts aloud" setting; only an explicit request does
  const textsMode = async () => (await api("/settings")).settings?.notify?.texts ?? "(usual)";
  const m0 = await textsMode();
  for (const q of ["what did Sarah text me", "any new messages", "read my messages", "read my texts", "check my messages", "who texted me"]) {
    const r = await chat(q);
    check(`"${q}" is answered (not a setting change)`, /\btext/i.test(r.reply ?? "") && !/will be spoken|will be silent|a chime only/.test(r.reply ?? "") && (await textsMode()) === m0, `${r.reply} · texts: ${await textsMode()}`);
  }
  const loud = await chat("read my texts out loud");
  check("\"read my texts out loud\" changes it (texts spoken)", /will be spoken/.test(loud.reply) && (await textsMode()) === "voice", `${loud.reply} · ${await textsMode()}`);
  const hush = await chat("stop reading texts");
  check("\"stop reading texts\" changes it back (texts on screen only)", /will be silent/.test(hush.reply) && (await textsMode()) === "silent", `${hush.reply} · ${await textsMode()}`);
  // "show number 3" with nothing numbered up: said plainly, never the book of Numbers; "read Numbers 3" still is
  const n3 = await chat("show number 3");
  check("\"show number 3\" with nothing numbered on screen says so (not Numbers 3)", /nothing numbered on the screen/i.test(n3.reply) && !/Numbers 3/.test(n3.reply), n3.reply);
  const nb = await chat("read Numbers 3"), nc = await chat("Numbers chapter 3");
  check("\"read Numbers 3\" and \"Numbers chapter 3\" read the Bible", /^Numbers 3\b/.test(nb.reply) && /^Numbers 3\b/.test(nc.reply), `${nb.reply?.slice(0, 40)} / ${nc.reply?.slice(0, 40)}`);

  // ---------------- B. the screen ----------------
  const browser = await chromium.launch({ channel: (await import(pathToFileURL(join(DESK, "lib", "browsers.mjs")).href)).playwrightChannel(), headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/display"); await page.waitForTimeout(2500);
  const typeIt = async (t) => { await page.evaluate(() => { const f = document.querySelector("#typeForm"); f.hidden = false; }); await page.fill("#typeBox", t); await page.press("#typeBox", "Enter"); await page.waitForTimeout(900); };
  const st = () => page.evaluate(() => window.dsExtras?._state());
  check("tv-extras loaded", Boolean(await st()));
  await api("/intents/forget", {});          // (part A taught it a pick)
  // a phrase Dayspring isn't sure about right now (it depends on what's running), found with Try it
  let unsure = "florp my timers";
  for (const t of ["florp my timers", "florp the list thing", "blorp my recipe stuff", "zorp the music things", "florp my notes thing"]) { const tr2 = await api("/intents/try", { text: t }); if (!tr2.confident && tr2.options?.length) { unsure = t; break; } }
  await typeIt(unsure);
  let s = await st();
  check("the suggestion card shows numbered choices", s.suggest && s.options.length >= 1 && /^1/.test(s.options[0]), JSON.stringify(s.options) + " said: " + unsure + " → " + (await page.$$eval("#log .msg", (x) => x.slice(-1).map((m) => m.textContent).join(""))));
  if (s.suggest) await page.click("#dsxSuggest button[data-n='1']"); await page.waitForTimeout(900);
  check("clicking a choice closes the card and runs it", !(await st()).suggest);
  await typeIt("set a toast timer for 3 seconds");
  s = await st();
  check("the timer stack shows it", s.timers >= 1 && (await page.textContent("#dsxTimers")).includes("toast"), await page.textContent("#dsxTimers"));
  await page.waitForTimeout(5000);
  s = await st();
  check("a finished timer: the card with its name, Dismiss / +5 min / Snooze", s.ringing && /toast/.test(s.ringText) && /Dismiss/.test(s.ringText) && /\+5 min/.test(s.ringText), s.ringText);
  await page.click("#dsxRing button.main"); await page.waitForTimeout(800);
  check("Dismiss clears it everywhere", !(await st()).ringing && (await api("/timers")).ringing.length === 0);
  // (the reply and its "cooking" event can take longer than a fixed pause on a busy computer: each check waits for
  // its own result, up to 8 s, instead of reading the screen after 0.9 s)
  const until = async (fn, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await st(); if (fn(v)) return v; await page.waitForTimeout(150); } return st(); };
  await typeIt("let's make scrambled eggs");
  s = await until((x) => x.cooking && /eggs/i.test(x.cookText));
  check("cooking mode: the big-text view", s.cooking && /eggs/i.test(s.cookText), s.cookText.slice(0, 80));
  await typeIt("next step");
  check("… 'next step' moves on", /Step 1 of/.test((await until((x) => /Step 1 of/.test(x.cookText ?? ""))).cookText));
  await typeIt("stop cooking");
  check("… and 'stop cooking' closes it", !(await until((x) => !x.cooking)).cooking);
  await page.evaluate(() => window.dsExtras._show.results({ query: "pancakes", more: true, results: Array.from({ length: 6 }, (_, i) => ({ n: i + 1, tempId: "r" + (i + 1), title: `Test pancakes <b>${i + 1}</b>`, site: "example.com", time: 10 + i, servings: 4, rating: { value: 4.5, count: 10 }, ingredients: 6, image: null })) }));
  s = await st();
  check("recipe results: 6 cards, text shown as text (no HTML)", s.recipeCards === 6 && (await page.$$eval("#dsxRecipes b", (x) => x.length)) === 0, s.recipeCards);
  await page.evaluate(() => document.querySelector("#dsxRecipes .dsx-close")?.click());
  for (const t of ["xqzv blorp", "wibble wobble zork", "qqq zzz vvv"]) await typeIt(t);
  check("after three misses the Help link is shown and clickable", (await page.$$eval("#log .dsx-link", (x) => x.length)) >= 1);
  check("no script errors on the Dayspring screen", errors.length === 0, errors.join(" | "));

  // ---------------- C. Stop drops a late reply ----------------
  const before = await page.$$eval("#log .msg.ai", (x) => x.length);
  await page.evaluate(() => { window.__late = window.fetch; window.fetch = (u, o) => (String(u).includes("/api/chat") ? new Promise((res) => setTimeout(() => res(window.__late(u, o)), 1500)) : window.__late(u, o)); });
  await page.evaluate(() => { const f = document.querySelector("#typeForm"); f.hidden = false; });
  await page.fill("#typeBox", "what time is it"); await page.press("#typeBox", "Enter");
  await page.waitForTimeout(300);
  await page.click("#stopBtn");
  await page.waitForTimeout(2500);
  const after = await page.$$eval("#log .msg.ai", (x) => x.length);
  check("✋ Stop while it's thinking: the late answer is dropped", after === before, `${before} → ${after}: ${await page.$$eval("#log .msg.ai", (x) => x.slice(-2).map((m) => m.textContent).join(" / "))}`);
  await page.evaluate(() => { window.fetch = window.__late; });

  // Settings → AI brain → Without AI, and the Recipes page
  const sp = await ctx.newPage(); const spErr = [];
  sp.on("pageerror", (e) => spErr.push(e.message));
  await sp.goto(BASE + "/settings#ai"); await sp.waitForTimeout(2000);
  const onAi = await sp.$("#tryText");
  if (!onAi) { const nav = await sp.$("[data-s=ai], a[href*='#ai'], button:has-text('AI brain')"); if (nav) { await nav.click(); await sp.waitForTimeout(1200); } }
  if (await sp.$("#tryText")) {
    await sp.fill("#tryText", "set a pasta timer for 8 minutes"); await sp.click("#tryGo"); await sp.waitForTimeout(800);
    check("Settings: Try it shows what it would do", /Set a timer|timer/i.test(await sp.textContent("#tryOut")), await sp.textContent("#tryOut"));
  } else check("Settings: the Without AI section is there", false, "no #tryText");
  const rp = await ctx.newPage(); const rpErr = [];
  rp.on("pageerror", (e) => rpErr.push(e.message));
  await rp.goto(BASE + "/recipes"); await rp.waitForFunction(() => document.querySelectorAll("#list .card").length >= 5, null, { timeout: 10000 }).catch(() => {});
  check("Recipes page: the 5 examples are listed", (await rp.$$eval("#list .card", (x) => x.length)) >= 5);
  // wait for the recipe to actually render (a fixed pause flaked when the machine was busy running other suites)
  await rp.click("#list .card");
  const opened = await rp.waitForFunction(() => { const v = document.querySelector("#view"); return v && !v.hidden && v.querySelectorAll("li").length >= 3; }, null, { timeout: 10000 }).then(() => true, () => false);
  check("Recipes page: a recipe opens with its easy steps", opened);
  check("no script errors on Settings or Recipes", spErr.length === 0 && rpErr.length === 0, [...spErr, ...rpErr].join(" | "));
  await browser.close();
  check("the server logged no errors", !/TypeError|ReferenceError|Unhandled|intents: /.test(serverLog), serverLog.split("\n").filter((l) => /Error|intents:/.test(l)).slice(0, 3).join(" | "));
} finally {
  server.kill();
  await sleep(800);
  if (!process.argv.includes("--keep")) try { rmSync(TMP, { recursive: true, force: true }); } catch { /* files still held */ }
}
console.log(`\n${fail ? "FAILED" : "ALL PASSED"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
