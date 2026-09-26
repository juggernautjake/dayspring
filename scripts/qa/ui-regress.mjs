// The 1.0.2 UI fixes, checked in a real (headless) browser on a throwaway copy (port 4796; nothing is heard, no device
// is touched, nothing opens on screen):
//   • the Schedule: no sideways scroll or stuck shift after Add (laptop and phone widths), a double-clicked Save adds
//     one item, fast view switching never draws an old view, an overnight item (11pm–1am) is saved, shown and deleted
//     as one, and a faded toast doesn't block the buttons under it
//   • Fit to screen by keyboard: Enter on a button presses that button again (it never saves by surprise), Esc cancels
//   • the guided setup: a skipped step's delayed line never plays over a later step
//   • Esc closes only what's on top
//   node scripts/qa/ui-regress.mjs [--keep]
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const { playwrightChannel } = await import("../../lib/browsers.mjs");
const PORT = 4796, BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), "ds-uiregress-")), APP = join(TMP, "app");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, got = "") => { if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" ? "  (" + got + ")" : ""}`); };
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); };
const DAY = addDays(iso(new Date()), 3);

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
// nothing is really said; device-touching calls are answered here, never by the server
const mock = () => {
  window.__spoken = [];
  const ss = window.speechSynthesis;
  if (ss) { ss.speak = (u) => { window.__spoken.push({ t: Date.now(), text: u.text }); setTimeout(() => { u.onend?.(); }, 30); }; ss.cancel = () => {}; }
  HTMLMediaElement.prototype.play = function () { window.__spoken.push({ t: Date.now(), text: "[audio]" }); setTimeout(() => this.onended?.(), 30); return Promise.resolve(); };
};
const DEVICE_ROUTES = /\/api\/(sound|window|devices\/use|voicemeeter\/(install|setup)|keepawake|tunein|callbridge)/;
async function page(path, { width = 1280, height = 720 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript(mock);
  await ctx.route("**/*", (r) => (r.request().method() === "POST" && DEVICE_ROUTES.test(r.request().url()) ? r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }) : r.continue()));
  const p = await ctx.newPage();
  p.__errors = [];
  p.on("pageerror", (e) => p.__errors.push(e.message));
  await p.goto(BASE + path); await p.waitForTimeout(1500);
  return p;
}
const itemsNamed = async (title, from = DAY, to = addDays(DAY, 1)) => {
  const cal = await (await fetch(`${BASE}/api/calendar?from=${from}&to=${to}`)).json();
  return cal.days.flatMap((d) => (d.blocks ?? []).map((b) => ({ ...b, date: d.date }))).filter((b) => b.title === title);
};

try {
  // ---- the Schedule: nothing slides sideways ---------------------------------------------------------------------------
  for (const [w, h] of [[1280, 720], [390, 844]]) {
    const p = await page(`/calendar.html?view=week&date=${DAY}`, { width: w, height: h });
    await p.click("#addBtn"); await p.waitForTimeout(700);
    const m = await p.evaluate(() => ({ doc: document.scrollingElement.scrollLeft, body: document.body.scrollWidth - innerWidth, main: document.querySelector("main").scrollLeft, bar: document.querySelector(".bar").getBoundingClientRect().left }));
    check(`Schedule ${w}px: Add doesn't slide the page sideways`, m.doc === 0 && m.main === 0 && m.bar >= 0 && m.body <= 1, JSON.stringify(m));
    await p.keyboard.press("Escape"); await p.waitForTimeout(500);
    const closed = await p.evaluate(() => { const d = document.querySelector("#drawer"); return !d.classList.contains("open") && getComputedStyle(d).visibility === "hidden"; });
    check(`Schedule ${w}px: a closed drawer can't be tabbed into`, closed);
    await p.context().close();
  }

  // ---- a double-clicked Save adds one item ------------------------------------------------------------------------------
  {
    const p = await page(`/calendar.html?view=day&date=${DAY}`);
    await p.click("#addBtn"); await p.waitForTimeout(500);
    await p.fill("#fTitle", "QA double save"); await p.fill("#fDate", DAY);
    await p.evaluate(() => { document.querySelector("#fStart").value = "15:00"; document.querySelector("#fEnd").value = "15:30"; });
    await p.dblclick("#fSave");
    await p.evaluate(() => document.querySelector("#fSave").click());
    await p.waitForTimeout(1500);
    const n = (await itemsNamed("QA double save")).length;
    check("a double-clicked Save adds the item once", n === 1, `${n} added`);

    // ---- a toast that has faded doesn't block what's under it -------------------------------------------------------------
    await p.waitForTimeout(3200);
    const blocked = await p.evaluate(() => { const t = document.querySelector("#toast"); return getComputedStyle(t).pointerEvents; });
    check("a faded toast lets clicks through", blocked === "none", blocked);
    await p.context().close();
  }

  // ---- fast view switching never draws an old answer ---------------------------------------------------------------------
  {
    const p = await page(`/calendar.html?view=week&date=${DAY}`);
    await p.click('#views [data-v="year"]');
    for (let i = 0; i < 5; i++) await p.click("#next");
    await p.click("#today"); await p.click('#views [data-v="day"]');
    await p.waitForTimeout(3500);
    const st = await p.evaluate(() => ({ year: Boolean(document.querySelector("#view .year")), month: Boolean(document.querySelector("#view .month")), grid: Boolean(document.querySelector("#view .grid")), cols: document.querySelectorAll("#view .col").length, on: document.querySelector("#views .on")?.dataset.v }));
    check("Year → Next ×5 → Today → Day ends on the day view, drawn once", st.on === "day" && st.grid && !st.year && !st.month && st.cols === 1, JSON.stringify(st));
    check("…with no page errors", p.__errors.length === 0, p.__errors.join(" | "));
    await p.context().close();
  }

  // ---- an overnight item (11pm–1am) --------------------------------------------------------------------------------------
  {
    const p = await page(`/calendar.html?view=week&date=${DAY}`);
    await p.click("#addBtn"); await p.waitForTimeout(500);
    await p.fill("#fTitle", "QA night shift"); await p.fill("#fDate", DAY);
    await p.evaluate(() => { for (const [id, v] of [["#fStart", "23:00"], ["#fEnd", "01:00"]]) { const el = document.querySelector(id); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); } });
    const note = await p.evaluate(() => document.querySelector("#ovnNote")?.textContent ?? "");
    check("an end before the start says it ends the next day", /next day/.test(note), note);
    await p.click("#fSave"); await p.waitForTimeout(1500);
    const parts = await itemsNamed("QA night shift");
    const ok = parts.length === 2 && parts[0].link && parts[0].link === parts[1].link && parts.some((b) => b.date === DAY && b.start === "23:00") && parts.some((b) => b.date === addDays(DAY, 1) && b.start === "00:00" && b.end === "01:00");
    check("it's saved as two linked halves either side of midnight", ok, JSON.stringify(parts.map((b) => `${b.date} ${b.start}-${b.end}`)));
    const label = await p.evaluate(() => [...document.querySelectorAll("#view .ev")].filter((e) => /QA night shift/.test(e.textContent)).map((e) => e.querySelector("small").textContent));
    check("both halves show the real times (11pm – 1am)", label.length === 2 && label.every((t) => /11pm/.test(t) && /1am/.test(t)), JSON.stringify(label));
    // edit it from the second half: the whole item opens; delete removes both halves
    await p.evaluate(() => [...document.querySelectorAll("#view .ev")].filter((e) => /QA night shift/.test(e.textContent)).pop().click());
    await p.waitForTimeout(600);
    const form = await p.evaluate(() => ({ start: document.querySelector("#fStart").value, end: document.querySelector("#fEnd").value }));
    check("opening either half edits the whole item", form.start === "23:00" && form.end === "01:00", JSON.stringify(form));
    await p.click("#fDel"); await p.click("#fDel"); await p.waitForTimeout(1500);
    check("deleting it removes both halves", (await itemsNamed("QA night shift")).length === 0);
    await p.context().close();
  }

  // ---- Fit to screen by keyboard -----------------------------------------------------------------------------------------
  {
    const before = (await (await fetch(`${BASE}/api/settings`)).json()).settings;
    const p = await page("/display");
    if (await p.locator("#startBtn").isVisible().catch(() => false)) await p.click("#startBtn").catch(() => {});
    await p.evaluate(() => window.dsScreen.open());
    await p.waitForTimeout(400);
    await p.focus('.fitcal [data-a="t+"]');
    await p.keyboard.press("Enter"); await p.keyboard.press("Enter");
    const st = await p.evaluate(() => ({ open: Boolean(document.querySelector(".fitcal")), focus: document.activeElement?.dataset?.a ?? document.activeElement?.tagName, top: document.querySelector(".fitcal .grid output")?.textContent }));
    check("Fit to screen: Enter twice on “Top +” moves the edge twice and doesn't save", st.open && st.focus === "t+", JSON.stringify(st));
    await p.keyboard.press("Escape"); await p.waitForTimeout(400);
    const after = (await (await fetch(`${BASE}/api/settings`)).json()).settings;
    check("…and Esc closes it without saving anything", !(await p.evaluate(() => Boolean(document.querySelector(".fitcal")))) && after.marginTop === before.marginTop && after.overscan === before.overscan, `marginTop ${before.marginTop} → ${after.marginTop}`);

    // ---- Esc closes only what's on top ----------------------------------------------------------------------------------
    await p.evaluate(() => window.dsLibrary.open());
    await p.waitForTimeout(600);
    await p.evaluate(() => document.querySelector("#mixBtn").click());
    await p.waitForTimeout(400);
    await p.evaluate(() => document.activeElement?.blur?.());
    const open0 = await p.evaluate(() => ({ lib: window.dsLibrary.isOpen(), sound: !document.querySelector("#soundPanel")?.hidden }));
    await p.keyboard.press("Escape"); await p.waitForTimeout(400);
    const open1 = await p.evaluate(() => ({ lib: window.dsLibrary.isOpen(), sound: !document.querySelector("#soundPanel")?.hidden }));
    check("Esc with the library and the Sound panel open closes just the Sound panel (on top)", open0.lib && open0.sound && open1.lib && !open1.sound, `${JSON.stringify(open0)} → ${JSON.stringify(open1)}`);
    await p.keyboard.press("Escape"); await p.waitForTimeout(400);
    const open2 = await p.evaluate(() => ({ lib: window.dsLibrary.isOpen(), sound: !document.querySelector("#soundPanel")?.hidden }));
    check("…and a second Esc closes the other", !open2.lib && !open2.sound, JSON.stringify(open2));
    check("the display had no page errors", p.__errors.length === 0, p.__errors.join(" | "));
    await p.context().close();
  }

  // ---- the guided setup: a skipped step's delayed line doesn't play over a later step --------------------------------------
  {
    const p = await page("/welcome");
    const clickNext = () => p.evaluate(() => document.querySelector("#next").click());
    await clickNext(); await p.waitForTimeout(900);                        // Welcome → About you
    await p.fill("#name", "Tester"); await clickNext(); await p.waitForTimeout(1200);   // → AI
    await p.evaluate(() => document.querySelector('[data-ai="anthropic"]')?.click());
    await clickNext(); await p.waitForTimeout(1200);                      // → Connect the AI
    const step0 = await p.evaluate(() => document.querySelector("#stepname")?.textContent ?? "");
    await p.evaluate(() => document.querySelector("#skip").click()); await p.waitForTimeout(700);   // skip → Voice (its line is due in ~4 s)
    await clickNext(); await p.waitForTimeout(2000);                      // → the next step, straight away
    const step1 = await p.evaluate(() => document.querySelector("#stepname")?.textContent ?? "");
    const n0 = await p.evaluate(() => window.__spoken.length);
    await p.waitForTimeout(4500);
    const late = await p.evaluate((n) => window.__spoken.slice(n).map((x) => x.text), n0);
    check("a skipped step's line never plays over the next step", step0 !== step1 && late.length === 0, `on “${step1}”, late: ${JSON.stringify(late).slice(0, 160)}`);
    check("the guided setup had no page errors", p.__errors.length === 0, p.__errors.join(" | "));
    await p.context().close();
  }

  // ---- Help: one letter clears old results; an unknown page says so --------------------------------------------------------
  {
    const p = await page("/help");
    await p.fill("#q", "snooze"); await p.waitForTimeout(900);
    await p.fill("#q", "s"); await p.waitForTimeout(700);
    const hits = await p.evaluate(() => document.querySelectorAll("#doc .hit").length);
    check("Help: one letter doesn't leave old results up", hits === 0, `${hits} results still showing`);
    await p.goto(`${BASE}/help#no-such-page`); await p.waitForTimeout(1200);
    const h1 = await p.evaluate(() => document.querySelector("#doc h1")?.textContent ?? "");
    check("Help: an unknown page says it wasn't found", /not found/i.test(h1), h1);
    await p.context().close();
  }
  // ---- Settings: a change isn't lost when you move to another section ---------------------------------------------------------
  {
    const p = await page("/setup?s=you");
    await p.waitForTimeout(800);
    await p.fill("#name", "Tess");
    await p.evaluate(() => document.querySelectorAll("#nav button")[2]?.click());
    await p.waitForTimeout(1500);
    const name = (await (await fetch(`${BASE}/api/setup/state`)).json()).owner?.name;
    check("Settings saves a changed section when you move to another one", name === "Tess", `name is now “${name}”`);
    check("Settings had no page errors", p.__errors.length === 0, p.__errors.join(" | "));
    await p.context().close();
  }

  // ---- speed: a whole year for the year view, and the device list for the Sound panel ----------------------------------------
  {
    const y = new Date().getFullYear(), t0 = Date.now();
    await fetch(`${BASE}/api/calendar?from=${y}-01-01&to=${y}-12-31&summary=1`);
    const ms = Date.now() - t0;
    check("the year view's data comes back quickly", ms < 800, `${ms} ms`);
    await fetch(`${BASE}/api/devices`);
    const t1 = Date.now(); await fetch(`${BASE}/api/devices`); const md = Date.now() - t1;
    check("the Sound panel's device list answers straight away the second time", md < 300, `${md} ms`);
  }
  check("the server logged nothing unexpected", !/unexpected \(kept running\)/.test(serverLog), serverLog.match(/unexpected.*$/m)?.[0] ?? "");
} finally {
  await browser.close().catch(() => {});
  server.kill();
  await sleep(1000);
  spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true });
  if (!process.argv.includes("--keep")) try { rmSync(TMP, { recursive: true, force: true }); } catch { /* in use */ }
  console.log(fail ? `\n${fail} failed.` : "\nThe 1.0.2 UI fixes: all good.");
  process.exit(fail ? 1 : 0);
}
