// The guide and Dayspring-as-helper checks. It never touches your own Dayspring or its data:
//   1. every page of the guide (docs/*.md and docs/dev/*.md) loads, and every link between pages, every #section,
//      every picture and every "Need help?" link in Settings and the guided setup points at something real
//   2. help_guide / "how do I …?" finds the right page for 20 everyday questions, and stays out of the way for others
//   3. in a headless browser, on a throwaway copy with demo data (the owner is "Sam"; port 4720-4729): every page
//      renders in /help, /help?q=… jumps to the right section, "how do I snooze the alarm?" on the Dayspring screen
//      opens that section and says the steps, and Settings and the setup show their guide links
//   node scripts/qa/docs-help.mjs [--module] [--shots] [--keep]
//     --module  only parts 1 and 2 (no server, no browser)
//     --shots   also retake the README screenshots into docs/images/ (demo data only, never yours)
//     --keep    leave the throwaway copy running afterwards (the address is printed)
//   env QA_BASE: test an already-running throwaway server instead of making one
// Exit code 0 when everything passed.
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, openSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const DESK = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOCS = join(DESK, "docs");
const SCRATCH = join(DESK, "node_modules", ".dayspring-docs-qa"), APP = join(SCRATCH, "app"), HOME = join(SCRATCH, "home");
const args = process.argv.slice(2), flag = (f) => args.includes(f);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0, passed = 0, server = null, BASE = process.env.QA_BASE ?? "";
const rec = (area, ok, note = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${area}${note ? " — " + String(note).slice(0, 220) : ""}`); };

const routes = await import(new URL("file:///" + join(DESK, "lib", "help-routes.mjs").replace(/\\/g, "/")).href);
const help = await import(new URL("file:///" + join(DESK, "lib", "helpskills.mjs").replace(/\\/g, "/")).href);

// ---- 1. pages, links, sections, pictures --------------------------------------------------------------------------
const pages = routes.list();
const heads = {}, heads23 = {};
for (const p of pages) {
  const d = routes.doc(p.slug);
  if (!d?.markdown || !d.title) { rec(`page ${p.slug} loads`, false, "empty"); continue; }
  let fence = false; heads[p.slug] = new Set(); heads23[p.slug] = [];
  for (const line of d.markdown.split("\n")) {
    if (/^\s*```/.test(line)) fence = !fence;
    const h = !fence && /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { heads[p.slug].add(help.anchor(h[2])); if (h[1].length === 2 || h[1].length === 3) heads23[p.slug].push(help.anchor(h[2])); }
  }
}
rec(`every page of the guide loads`, Object.keys(heads).length === pages.length, `${pages.length} pages (${pages.filter((p) => p.dev).length} for developers)`);
const fileOf = (slug) => { const top = join(DOCS, slug + ".md"); return existsSync(top) ? top : join(DOCS, "dev", slug.replace(/^dev-/, "") + ".md"); };
// the same rules as public/help.js: dev/x.md and bare names on a developer page are "dev-x"
const target = (href, from) => {
  const m = /^(?:(.*)\/)?([a-z0-9-]+)\.md(?:#([\w-]+))?$/i.exec(href); if (!m) return null;
  const dir = m[1] ?? "", dev = /(^|\/)dev$/i.test(dir) || (!dir && from.startsWith("dev-"));
  return { slug: (dev ? "dev-" : "") + m[2].toLowerCase(), anchor: m[3] ?? "" };
};
const bad = []; let links = 0, pics = 0;
for (const p of pages) {
  const md = routes.doc(p.slug).markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, ""), file = fileOf(p.slug);
  for (const m of md.matchAll(/(!?)\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const href = m[2];
    if (/^(https?:|mailto:|\/)/i.test(href)) continue;
    if (m[1]) {                                                        // a picture: must exist next to the page (GitHub) and in /help
      pics++;
      if (!existsSync(resolve(dirname(file), href))) bad.push(`${p.slug}: picture ${href} is missing`);
      else if (!/^(?:\.\.\/)*(?:docs\/)?images\/[a-z0-9-]+\.(png|jpe?g|gif|webp|svg)$/i.test(href)) bad.push(`${p.slug}: picture ${href} must be in docs/images/ with a lowercase name`);
      continue;
    }
    if (href.startsWith("#")) { links++; if (!heads[p.slug].has(href.slice(1))) bad.push(`${p.slug}: no section #${href.slice(1)}`); continue; }
    const t = target(href, p.slug);
    if (!t) { if (!existsSync(resolve(dirname(file), href.split("#")[0]))) bad.push(`${p.slug}: ${href} doesn't exist`); continue; }
    links++;
    if (!heads[t.slug]) bad.push(`${p.slug}: link to a missing page ${href}`);
    else if (t.anchor && !heads[t.slug].has(t.anchor)) bad.push(`${p.slug}: ${href} — "${t.slug}" has no section #${t.anchor}`);
    else if (!existsSync(resolve(dirname(file), href.split("#")[0]))) bad.push(`${p.slug}: ${href} works in /help but not on GitHub`);
  }
}
// the front page (docs/README.md becomes the repository's README.md; dist/ files land next to it)
{
  const md = readFileSync(join(DOCS, "README.md"), "utf8").replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  for (const m of md.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const href = m[1]; if (/^(https?:|mailto:|#)/i.test(href)) continue;
    links++;
    const [file, a] = href.split("#");
    if (!existsSync(join(DESK, file)) && !existsSync(join(DESK, "dist", file))) { bad.push(`README: ${href} doesn't exist`); continue; }
    const t = /^docs\/(?:(dev)\/)?([a-z0-9-]+)\.md$/.exec(file);
    if (t && a && !heads[(t[1] ? "dev-" : "") + t[2]]?.has(a)) bad.push(`README: ${href} has no such section`);
  }
}
// "Need help?" links in Settings and the guided setup, and /help#… links anywhere in the screens
for (const f of ["setup.js", "welcome.js", "tv.js", "app.js", "dock.js", "discover.js", "results.js", "reader.js", "study.js", "calendar.js", "library.js"].map((x) => join(DESK, "public", x)).filter(existsSync)) {
  const src = readFileSync(f, "utf8"), name = relative(DESK, f);
  const g = /const GUIDE = \{([\s\S]*?)\};/.exec(src)?.[1] ?? "";
  const refs = [...g.matchAll(/\["([a-z0-9-]+)(?:\/([\w-]+))?", "/g)].map((m) => [m[1], m[2]])
    .concat([...src.matchAll(/\/help(?:\?embed=1)?#([a-z0-9-]+)(?:\/([\w-]+))?/g)].filter((m) => m[1] !== "search").map((m) => [m[1], m[2]]));
  for (const [slug, a] of refs) { links++; if (!heads[slug]) bad.push(`${name}: /help#${slug} is not a page`); else if (a && !heads[slug].has(a)) bad.push(`${name}: /help#${slug}/${a} is not a section`); }
}
rec("every link between pages, section and picture resolves", !bad.length, bad.length ? bad.slice(0, 6).join(" | ") + (bad.length > 6 ? ` (+${bad.length - 6} more)` : "") : `${links} links, ${pics} pictures`);

// ---- 2. help_guide and "how do I …?" --------------------------------------------------------------------------------
const QUESTIONS = [
  ["how do I snooze the alarm", "schedule#snooze"], ["how do I connect spotify", "music"], ["how do I install dayspring", "install"],
  ["how do I update dayspring", "updating"], ["how do I change your voice", "voices"], ["how do I make something repeat every week", "schedule#repeating-items"],
  ["how do I fix the screen being cut off on my tv", "display-setup#the-picture-is-cut-off-at-the-edges-overscan"], ["how do I connect claude", "ai-providers#claude-anthropic"],
  ["how do I get my texts read to me", "phone"], ["how do I connect google calendar", "connections#google-calendar--gmail"], ["how do I let you read my files", "permissions#files-and-folders"], ["how do I open a file on the screen", "files-and-viewer"],
  ["how do I keep the computer awake", "display-setup#keeping-the-screen-awake"], ["how do I change the background", "display-setup#the-living-sky"],
  ["how do I hide the screen", "display-setup#the-window-bar-minimize-maximize-hide-close"], ["how do I set up the discord bot", "discord-bot"],
  ["how do I use ollama", "ai-providers#ollama-free-on-your-computer"], ["how do I pick which speakers you use", "audio-devices#choose-where-daysprings-voice-plays"],
  ["how do I uninstall dayspring", "install#uninstalling-dayspring"], ["how do I add an interest", "discover#your-interests"], ["how do I add a voice command to the code", "dev-extending"],
];
let right = 0; const wrong = [];
for (const [q, want] of QUESTIONS) {
  const a = help.answer(q), got = a ? `${a.hit.slug}#${a.hit.anchor}` : "nothing";
  const ok = a && want.split("|").some((w) => (w.includes("#") ? got === w : a.hit.slug === w)) && a.reply.length > 40 && a.url.startsWith("/help?embed=1#");
  if (ok) right++; else wrong.push(`"${q}" → ${got} (wanted ${want})`);
}
rec(`"how do I …" finds the right page (${right} of ${QUESTIONS.length})`, right === QUESTIONS.length, wrong.join(" | "));
const NOT = ["how do I make lasagna", "how do I get to walmart", "what time is it", "play some music", "how are you", "add dentist tuesday at 3"];
const stole = NOT.filter((q) => help.answer(q));
rec("it stays out of the way for other questions", !stole.length, stole.join(", ") || NOT.length + " checked");
const tool = await help.runTool("help_guide", { question: "screen is cut off on my tv", open: false });
rec("help_guide tool returns the section and its steps", tool?.found && tool.steps?.length && /overscan|cut off/i.test(tool.section + tool.text), tool?.section);
rec("help_guide is offered to the AI", help.TOOLS.some((t) => t.name === "help_guide" && t.input_schema?.required?.includes("question")));
const say = help.answer("how do I snooze the alarm")?.reply ?? "";
rec("the spoken steps have no emoji or arrows", say && !/[\p{Extended_Pictographic}→↗]/u.test(say), say.slice(0, 120));

if (flag("--module")) await finish();

// ---- 3. headless ---------------------------------------------------------------------------------------------------
// A throwaway copy inside node_modules (so it finds the packages; export and git skip node_modules), with its own
// empty data, a pretend home folder, devices in dry-run mode, and no browser windows.


async function freePort() {
  for (let p = 4720; p <= 4729; p++) if (await new Promise((ok) => { const s = createServer().once("error", () => ok(false)).once("listening", () => s.close(() => ok(true))).listen(p, "127.0.0.1"); })) return p;
  throw new Error("ports 4720-4729 are all busy");
}
const J = async (u, body) => { const r = await fetch(BASE + "/api" + u, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}); return r.json().catch(() => ({})); };
if (!BASE) {
  rmSync(SCRATCH, { recursive: true, force: true });
  const SKIP = new Set(["data", ".env", "node_modules", "backups", "dist-out", "bin", ".git", "qa-out"]);
  for (const e of readdirSync(DESK)) if (!SKIP.has(e)) cpSync(join(DESK, e), join(APP, e), { recursive: true, filter: (src) => !/\.log$/.test(src) });
  mkdirSync(join(APP, "data"), { recursive: true }); mkdirSync(join(HOME, "Documents"), { recursive: true }); mkdirSync(join(HOME, "Pictures"), { recursive: true });
  const port = await freePort(); BASE = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port), USERPROFILE: HOME, HOME, LOCALAPPDATA: join(HOME, "AppData", "Local"), APPDATA: join(HOME, "AppData", "Roaming"),
    DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_DISPLAY: "", DAYSPRING_NO_BROWSER: "1" };
  for (const k of Object.keys(env)) if (/API_KEY|TOKEN|SECRET|CLIENT_ID/i.test(k)) delete env[k];     // no keys: free mode
  server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", openSync(join(SCRATCH, "server.log"), "a"), openSync(join(SCRATCH, "server.log"), "a")], windowsHide: true });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(500); try { up = (await fetch(BASE + "/api/setup/state")).ok; } catch { /* starting */ } }
  rec(`throwaway copy starts (${BASE})`, up, up ? "" : readFileSync(join(SCRATCH, "server.log"), "utf8").slice(-300));
  if (!up) await finish();
  // demo data: a made-up owner and an ordinary week (never anyone's real schedule)
  await J("/setup/owner", { name: "Sam", assistantName: "Dayspring", about: "", interests: ["gardening", "woodworking", "pickleball"],
    location: { place: "Springfield, Illinois, United States", lat: 39.8, lon: -89.64, timezone: "America/Chicago" } });
  await J("/setup/schedule", { action: "template", replace: true, template: { wake: "06:30", bed: "22:30", workDays: ["mon", "tue", "wed", "thu", "fri"], workStart: "08:30", workEnd: "17:00", workTitle: "Work", meals: true,
    commitments: [{ title: "Pickleball", days: ["tue", "thu"], start: "18:30", end: "19:30", category: "flex" }, { title: "Garden club", days: ["sat"], start: "09:00", end: "10:30", category: "flex" }] } });
  const today = new Date().toLocaleDateString("en-CA");
  await J("/blocks", { date: today, start: "15:00", end: "15:45", title: "Dentist", category: "flex" });
  await J("/blocks", { date: today, start: "19:30", end: "20:30", title: "Call Mom", category: "flex" });
  await J("/setup/permissions", { files: "off", choice: true });   // the setup won't finish until file access is chosen
  await J("/setup/finish", {});
}

const require = createRequire(join(DESK, "package.json"));
const { chromium } = require("playwright-core");
let browser = null;
for (const channel of [process.env.QA_BROWSER || "chrome", "msedge"]) { try { browser = await chromium.launch({ channel, headless: true, args: ["--mute-audio"] }); break; } catch { /* next */ } }
if (!browser) { rec("a browser for the headless checks", false, "Chrome or Edge is needed"); await finish(); }
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
// nothing may change devices, install, sign in, move windows or play on a real speaker
await ctx.route(/\/api\/(devices\/use|cli\/install|voicemeeter\/install|tunein\/install|media\/login|player\/spotify\/login|window|keepawake|media\/play|media\/stop)$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"mocked":true}' }));
const errs = [];
const watch = (pg, tag) => { pg.on("pageerror", (e) => errs.push(`${tag}: ${e.message}`)); };

// every page renders
const hp = await ctx.newPage(); watch(hp, "help");
await hp.goto(BASE + "/help", { waitUntil: "load" }); await hp.waitForSelector("#toc a");
const notRendered = [];
for (const p of pages) {
  await hp.evaluate((s) => { location.hash = s; }, p.slug);
  const ok = await hp.waitForFunction((t) => document.querySelector("#doc h1")?.textContent.trim() === t, p.title, { timeout: 5000 }).then(() => true).catch(() => false);
  const ids = ok ? await hp.evaluate(() => [...document.querySelectorAll("#doc h2[id], #doc h3[id]")].map((h) => h.id)) : [];
  const missing = heads23[p.slug].filter((a) => !ids.includes(a));
  if (!ok) notRendered.push(`${p.slug} (no title)`); else if (missing.length) notRendered.push(`${p.slug} (section ids differ: ${missing.slice(0, 2).join(", ")})`);
}
rec("every page renders in /help", !notRendered.length, notRendered.join(" | ") || `${pages.length} pages`);
const toc = await hp.evaluate(() => [...document.querySelectorAll("#toc h2")].map((h) => h.textContent));
rec('the contents have a "For developers" group', toc.includes("For developers"), toc.join(" · "));
// a link from a developer page to another developer page, and to a picture
await hp.evaluate(() => { location.hash = "dev-architecture"; }); await hp.waitForTimeout(600);
const devLink = await hp.evaluate(() => [...document.querySelectorAll("#doc a")].map((a) => a.getAttribute("href")).find((h) => /^#dev-/.test(h ?? "")));
rec("developer pages link to each other inside /help", Boolean(devLink), devLink ?? "none");
// /help?q=… jumps straight to the section
await hp.goto(BASE + "/help?embed=1&q=" + encodeURIComponent("snooze the alarm"), { waitUntil: "load" });
const jumped = await hp.waitForFunction(() => /#schedule\/snooze$/.test(location.hash), null, { timeout: 6000 }).then(() => true).catch(() => false);
rec("/help?q=snooze jumps to the Snooze section", jumped, await hp.evaluate(() => location.hash));

// the Dayspring screen: "how do I snooze the alarm?" (typed, no AI) opens the section and says the steps
const d = await ctx.newPage(); watch(d, "screen");
await d.goto(BASE + "/display", { waitUntil: "load" }); await d.waitForTimeout(3000);
if (await d.locator("#startBtn").isVisible().catch(() => false)) { await d.click("#startBtn"); await d.waitForTimeout(800); }
for (const [q, want] of [["how do I snooze the alarm?", "#schedule/snooze"], ["Dayspring, how do I connect Spotify?", "#music/"]]) {
  await d.evaluate((t) => window.dispatchEvent(new CustomEvent("ds-test-ask", { detail: t })), q);
  const opened = await d.waitForFunction((w) => !document.querySelector("#pagewrap")?.hidden && (document.querySelector("#pageframe")?.getAttribute("src") ?? "").includes(w), want, { timeout: 8000 }).then(() => true).catch(() => false);
  const said = await d.evaluate(() => document.body.innerText);
  rec(`screen: "${q}" opens that part of the guide`, opened, await d.evaluate(() => document.querySelector("#pageframe")?.getAttribute("src")));
  rec(`screen: "${q}" answers with the steps`, /It's open on the screen/.test(said));
  if (flag("--shots") && want.includes("snooze")) { await d.waitForTimeout(1500); await d.screenshot({ path: join(DOCS, "images", "help-answer.png") }); }
  await d.evaluate(() => document.querySelector("#pageClose")?.click()); await d.waitForTimeout(400);
}
// a question that isn't about Dayspring goes on as usual (the guide doesn't open)
await d.evaluate(() => window.dispatchEvent(new CustomEvent("ds-test-ask", { detail: "how do I make lasagna?" })));
await d.waitForTimeout(2500);
rec("screen: other how-to questions don't open the guide", await d.evaluate(() => document.querySelector("#pagewrap")?.hidden !== false));

// Settings and the guided setup link to their guide pages
const s = await ctx.newPage(); watch(s, "settings");
await s.goto(BASE + "/setup?s=voice", { waitUntil: "load" }); await s.waitForSelector(".guide-link a", { timeout: 6000 }).catch(() => {});
rec("Settings → Voice links to its guide page", (await s.locator(".guide-link a").first().getAttribute("href").catch(() => "")) === "/help#voices");
await s.goto(BASE + "/setup?s=apps", { waitUntil: "load" }); await s.waitForSelector("#card h1", { timeout: 6000 }).catch(() => {}); await s.waitForTimeout(800);
rec("Settings → Apps & connections shows the connector cards and its guide link", (await s.locator("#card").innerText().catch(() => "")).length > 200 && (await s.locator(".guide-link a").first().getAttribute("href").catch(() => "")) === "/help#connections");
await s.goto(BASE + "/welcome?step=apps", { waitUntil: "load" }); await s.waitForTimeout(1500);
rec("/welcome?step=apps opens the Apps step with its guide link", /Apps/.test(await s.locator("#stepname").textContent().catch(() => "")) && (await s.locator(".guide-link a").getAttribute("href").catch(() => "")) === "/help#connections");

// ---- screenshots for the README (demo data only) -------------------------------------------------------------------
if (flag("--shots")) {
  mkdirSync(join(DOCS, "images"), { recursive: true });
  // the screen shots are taken at 10:20 in the morning (a fuller day on the screen), with the usual idle caption
  // instead of "Automated view: not listening" (headless pages never listen)
  const morning = new Date(`${new Date().toLocaleDateString("en-CA")}T10:20:00`);
  const shot = async (url, file, { w = 1600, h = 900, wait = 3500, at = null } = {}) => {
    const pg = await ctx.newPage(); await pg.setViewportSize({ width: w, height: h });
    if (at) await pg.clock.setFixedTime(at);
    await pg.goto(BASE + url, { waitUntil: "load" }); await pg.waitForTimeout(wait);
    if (await pg.locator("#startBtn").isVisible().catch(() => false)) { await pg.click("#startBtn"); await pg.waitForTimeout(1500); }
    await pg.evaluate(() => { const t = document.querySelector("#micText"); if (t && /Automated/.test(t.textContent)) t.textContent = "Say “Dayspring, …” to talk"; });
    await pg.screenshot({ path: join(DOCS, "images", file) }); await pg.close();
  };
  await shot("/display", "screen.png", { wait: 6000, at: morning });
  await shot("/calendar.html?view=week", "schedule-week.png", { w: 1400, h: 850, at: morning });
  await shot("/setup?s=screen", "settings-screen.png", { w: 1280, h: 850 });
  await shot("/setup?s=sky", "settings-sky.png", { w: 1280, h: 850 });
  await shot("/help#tutorials", "guide.png", { w: 1280, h: 850 });
  await shot("/welcome?step=welcome", "setup-welcome.png", { w: 1280, h: 850 });
  await shot("/welcome?step=apps", "setup-apps.png", { w: 1280, h: 850 });
  await shot("/display", "screen-phone.png", { w: 430, h: 900, wait: 5000, at: morning });
  rec("screenshots taken (demo data)", true, readdirSync(join(DOCS, "images")).join(", "));
}
rec("no script errors on the pages", !errs.length, errs.slice(0, 3).join(" | "));
await browser.close();
await finish();

async function finish() {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (server && flag("--keep")) { console.log(`The throwaway copy is still running at ${BASE} (folder ${APP}).`); process.exitCode = failed ? 1 : 0; return new Promise(() => {}); }
  if (server) { server.kill(); for (let i = 0; i < 20 && server.exitCode === null; i++) await sleep(250); await sleep(500); try { rmSync(SCRATCH, { recursive: true, force: true }); } catch { /* in use: removed next run */ } }
  process.exit(failed ? 1 : 0);
}
