// Every pop-up on the Dayspring screen fits inside the screen's margins (Settings → Screen, 📐 Fit to screen): a TV
// crops its edges, and a card that runs past a margin can hide its own buttons or its ✕.
// On a throwaway copy (port 4771), headless Chrome, at 1280×720 and 1920×1080 (/display) and 380×560 (/mini), with no
// margins, 8% on every side and uneven margins, it opens each kind of pop-up and checks that its box, and every button
// and close control in it (scrolled into view when the box scrolls), lies inside the safe rectangle and is really
// clickable (elementFromPoint at its centre is the control). Then it changes the margins (and the window size) while
// pop-ups are open and checks they move to stay inside.
//   node scripts/qa/overlay-fit.mjs [--keep]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// playwright-core: this app's own copy, else the export checkout's (next to the dayspring project)
const PW = [join(DESK, "node_modules", "playwright-core", "index.mjs"), join(DESK, "..", "..", "..", "dayspring-app", "node_modules", "playwright-core", "index.mjs")].find((p) => existsSync(p));
if (!PW) { console.log("FAIL  playwright-core not found"); process.exit(1); }
const { chromium } = await import(pathToFileURL(PW).href);
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const PORT = 4771, BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), "ds-overlayfit-")), APP = join(TMP, "app");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" ? "  (" + got + ")" : ""}`); };

spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(join(APP, "data"), { recursive: true });
writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary" }));
const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_NO_ECO: "1", DS_PROFILE: "DayspringQA", DAYSPRING_CHANNEL: "dev" };   // (dev: features still in progress, like the GIF picker, are on)
const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = ""; server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
let isUp = false;
for (let i = 0; i < 120 && !(isUp = await up()); i++) await sleep(500);
check("the throwaway server is up", isUp, serverLog.slice(-300));

const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME, headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] }
  : { channel: (await import(pathToFileURL(join(DESK, "lib", "browsers.mjs")).href)).playwrightChannel(), headless: true, args: ["--mute-audio"] });
const mock = () => {
  window.__dsAllowAutomatedListen = true;
  const ss = window.speechSynthesis; if (ss) { ss.speak = (u) => setTimeout(() => u.onend?.(), 10); ss.cancel = () => {}; }
  HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  class FakeSR { start() {} abort() { setTimeout(() => this.onend?.(), 5); } stop() { this.abort(); } }
  window.SpeechRecognition = window.webkitSpeechRecognition = FakeSR;
};
// nothing reaches the devices, the window or the network from here
const DEVICE_ROUTES = /\/api\/(sound|window|devices\/use|voicemeeter\/(install|setup)|keepawake|tunein|callbridge|open|app\/quit|update)/;

// ---------------------------------------------------------------- in the page: is it inside, is it clickable?
function inspect([sel, ctlSel]) {
  const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05 && !e.closest("[hidden]"); };
  const box = [...document.querySelectorAll(sel)].find(vis);
  if (!box) return { found: false, boxInside: false, controls: 0, outside: [], blocked: [], rect: null };
  const S = window.dsSafeRect(), tol = 1;
  const inside = (r) => r.left >= S.left - tol && r.top >= S.top - tol && r.right <= S.right + tol && r.bottom <= S.bottom + tol;
  const fmt = (r) => `${Math.round(r.left)},${Math.round(r.top)}→${Math.round(r.right)},${Math.round(r.bottom)}`;
  const br = box.getBoundingClientRect();
  const out = { found: true, box: fmt(br), safe: fmt(S), boxInside: inside(br), controls: 0, outside: [], blocked: [], rect: { l: br.left, t: br.top, r: br.right, b: br.bottom } };
  const ctls = [...box.querySelectorAll(ctlSel || "button, a[href], select, input, [role=button]")].filter(vis);
  if (box.matches("button")) ctls.push(box);
  for (const c of ctls) {
    c.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = c.getBoundingClientRect(); out.controls++;
    const name = (c.getAttribute("aria-label") || c.textContent || c.className || c.tagName).trim().slice(0, 22);
    if (!inside(r)) { out.outside.push(`${name} ${fmt(r)}`); continue; }
    const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!(e && (e === c || c.contains(e)))) out.blocked.push(`${name}→${e ? (e.id || e.className || e.tagName) : "none"}`.slice(0, 50));
  }
  if (document.scrollingElement) { document.scrollingElement.scrollTop = 0; document.scrollingElement.scrollLeft = 0; }
  return out;
}

// ---------------------------------------------------------------- the pop-ups: how to open, what to check, how to close
const svg = (w, h) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><rect width='100%' height='100%' fill='#468'/></svg>`);
const items = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));
const LONG = "A longer note than usual, so the card has to wrap onto several lines and might have to scroll inside the screen's margins. ".repeat(3);
const ev = (p, name, data) => p.evaluate(([n, d]) => window.dsEvents?.dispatchEvent(new MessageEvent(n, { data: JSON.stringify(d) })), [name, data]);
const POPUPS = [
  { name: "file-access check card", box: "#faCheck", wait: 6000, close: '#faCheck [data-k="later"]' },
  { name: "notification stack (5 toasts)", live: true, box: "#toasts", open: (p) => p.evaluate((L) => { const t = window.dayspring.toast; for (let i = 1; i <= 5; i++) t(`Reminder ${i}`, i % 2 ? L : "Short one", i === 2 ? "wait" : "", "bell", i === 2 ? { snooze: { kind: "reminder", text: "trash" } } : {}); }, LONG), wait: 900, close: "#toastsClear", gone: "#toasts .toast:not(.out)" },
  { name: "close-the-screen confirm", box: ".wconfirm .wbox", open: (p) => p.evaluate(() => { for (const f of window.dsLocal ?? []) if (f("close the screen")) break; }), close: '.wconfirm [data-c="no"]' },
  { name: "Sound panel", live: true, box: "#soundPanel", open: (p) => p.evaluate(() => window.dsSound.open()), wait: 900, ctl: "header button, .x", close: "#soundPanel .x" },
  { name: "Active/Quiet/Off menu", box: "#stateMenu", open: (p) => p.evaluate(() => document.getElementById("stateBtn").click()), after: (p) => p.evaluate(() => { document.getElementById("stateMenu").hidden = true; }) },
  { name: "update prompt", live: true, box: "#dsUpdate", open: (p) => p.evaluate((L) => window.dsUpdates.show({ available: true, latest: "9.9.9", current: "1.6.1", notes: Array.from({ length: 14 }, (_, i) => `- Change number ${i + 1}: ${L.slice(0, 90)}`).join("\n") }), LONG), close: "#dsUpdate .x" },
  // (the Favorites tab: nothing is searched, so no GIF source is ever asked from here. Before the secret character card,
  // which sits on top of everything for up to 9 s)
  { name: "GIF picker", live: true, box: "#dsGifs", open: (p) => p.evaluate(() => window.dsGifPicker.open({ tab: "favorites" })), wait: 900, ctl: ".g-bar button, .g-search button, .g-filters button, .g-filters select", close: "#dsGifs .g-x" },
  { name: "badge reveal", box: ".brev-card", open: (p) => p.evaluate(() => { window.dsBadges?.reveal({ key: "study:qa", name: "Steady Learner", citation: "For showing up to study, again and again.", polished: "Studied five days in a row", tier: 1 }); }), wait: 1200, close: ".brev-ok" },
  { name: "secret character card", live: true, box: ".sfx-card", open: (p) => p.evaluate(() => window.dsSecretsFx.card({ icon: "🦴", name: "The Caveman", reveal: "Ugg! New friend.", found: 1, total: 6 })), close: ".sfx-card button" },
  { name: "Lantern card", live: true, box: ".lnstack .lncard", open: (p) => p.evaluate(() => window.dispatchEvent(new CustomEvent("ds-test-lantern", { detail: { id: "qa" + Date.now() } }))), wait: 700, close: ".lnstack .lncard .x" },
  { name: "media library list", box: ".mlpanel", open: (p) => p.evaluate(() => window.dsMediaLib.showList({ title: "Your music", items: Array.from({ length: 18 }, (_, i) => ({ n: i + 1, kind: "audio", title: `Song number ${i + 1}`, detail: "Artist", where: "Music" })) })), ctl: "header button" , after: (p) => p.evaluate(() => window.dsMediaLib.closeList()) },
  { name: "media picture viewer", box: ".mlimg img", open: (p, w) => p.evaluate((s) => window.dsMediaLib.showImage({ src: s, title: "A very large picture" }), svg(w * 2, w * 3)), wait: 700, ctl: "none", close: ".mlimg" },
  { name: "image search grid", box: "#dsImages", open: (p) => p.evaluate((its) => window.dispatchEvent(new CustomEvent("ds-test-images", { detail: { open: true, query: "sunsets", filters: {}, more: true, items: its } })), items(12, (n) => ({ n, title: `Sunset ${n}`, thumb: "", sourceDomain: "example.org" }))), ctl: "header button, footer button", after: (p) => p.evaluate(() => window.dsImages.close(true)) },
  { name: "video grid", live: true, box: "#dsVideos", open: (p) => p.evaluate((its) => window.dispatchEvent(new CustomEvent("ds-test-videos", { detail: { open: true, title: "Videos: biking", kind: "videos", filters: {}, more: true, items: its } })), items(24, (n) => ({ n, videoId: null, title: `Mountain biking trail ride number ${n} with a longer title`, channel: "Trail Riders", length: "14:05", age: "2 weeks ago", views: "12K views", thumb: "" }))),
    ctl: "header button, .dsv-chips button, .dsv-card .acts button", close: '#dsVideos [data-close]' },
  { name: "video queue", live: true, box: "#dsVQueue", open: (p) => p.evaluate((its) => window.dispatchEvent(new CustomEvent("ds-test-vqueue", { detail: { items: its, index: 2, total: its.length, repeat: "off", shuffle: false, source: { name: "Worship Songs" } } })), items(16, (n) => ({ n, id: "q" + n, videoId: null, title: `Queued video number ${n} with a longer title`, channel: "A channel", length: "5:02", current: n === 3 }))),
    ctl: "header button, li .ib", close: '#dsVQueue [data-qa="close"]' },
  // (his own files: nothing to reach on the network; the window itself, its tabs, search, sections and window buttons)
  { name: "Music & Video browser", live: true, box: "#dsMB", open: (p) => p.evaluate(() => window.dsMB.open({ source: "local" })), wait: 900, ctl: ".mb-bar button:not([hidden]), .mb-search button:not([hidden]), .mb-search input, .mb-nav button", close: "#dsMB .mb-x" },
  { name: "results card", live: true, box: ".rpanel", open: (p) => p.evaluate((its) => window.dispatchEvent(new CustomEvent("ds-test-results", { detail: { title: "Search results", summary: "Here's what I found.", items: its } })), items(14, (n) => ({ n, title: `Result number ${n}`, detail: "A detail line", url: "https://example.org/" + n }))), ctl: "header button", close: "#rsClose" },
  { name: "suggestion card", box: "#dsxSuggest", open: (p) => p.evaluate(() => window.dsExtras.before({ suggest: { prompt: "Which one did you mean?", options: Array.from({ length: 6 }, (_, i) => ({ n: i + 1, label: `Option number ${i + 1} with a longer label` })) } }, { typed: true })), after: (p) => p.evaluate(() => window.dsExtras.stop()) },
  // (✕ only closes a reader that has a document in it, so the empty one here is hidden again by hand)
  { name: "document reader", box: ".reader", open: (p) => p.evaluate(() => { document.querySelector(".reader").hidden = false; }), ctl: "header button", after: (p) => p.evaluate(() => { document.querySelector(".reader").hidden = true; }) },
  { name: "Help page overlay", box: "#pagewrap", open: (p) => p.evaluate(() => window.dsOpenPage("/help?embed=1")), wait: 900, ctl: ".pageclose", close: "#pagewrap .pageclose" },
  { name: "Meetings panel", box: ".meetpop", open: (p) => p.evaluate(() => document.getElementById("meetMore").click()), wait: 700, after: (p) => p.keyboard.press("Escape") },
  { name: "the alarm", box: "#alarm .box", open: (p) => p.evaluate((L) => window.dispatchEvent(new CustomEvent("ds-test-alarm", { detail: { text: "Good morning. " + L } })), LONG), wait: 900, close: "#alarmOff" },
  { name: "“1 thing to tell you” sign", box: "#dsFloorPill", open: (p) => ev(p, "floor", { held: 1, items: ["the weather"] }), wait: 400, after: (p) => ev(p, "floor", { held: 0, items: [] }) },
  { name: "📐 Fit to screen", box: ".fitcal .fcbox", open: (p) => p.evaluate(() => window.dsScreen.open()), wait: 500, close: '.fitcal [data-a="cancel"]' },
  // expression mode's GIF, shown in the avatar's place (public/avatar.js): inside the Dayspring panel, so inside the margins.
  // (Dayspring mini without an AI hides the whole panel, and the GIF with it.)
  { name: "expression GIF on the avatar", box: "#dsExpr.on", skip: (path) => path === "/mini", open: (p, w) => p.evaluate((s) => window.dsAvatar.express({ url: s, title: "A test GIF", plan: { ms: 12000 }, attribution: { text: "Dayspring QA" } }), svg(w, w)), wait: 700, ctl: "none", after: (p) => p.evaluate(() => window.dsAvatar.hideExpr()) },
];

// until its entrance animation is over (slow in headless Chrome at 1920×1080: blurred glass is drawn in software)
const settle = (p, sel) => p.waitForFunction((s) => [...document.querySelectorAll(s)].some((e) => { let o = 1; for (let a = e; a && a.nodeType === 1; a = a.parentElement) o *= Number(getComputedStyle(a).opacity); return o > 0.95 && e.getBoundingClientRect().width > 1 && !e.closest("[hidden]"); }), sel, { timeout: 6000 }).catch(() => {});
async function open(p, pp, w) {
  if (pp.open) await pp.open(p, w);
  const found = await p.waitForFunction((s) => [...document.querySelectorAll(s)].some((e) => e.getBoundingClientRect().width > 1 && !e.closest("[hidden]")), pp.box, { timeout: pp.wait && pp.wait > 2000 ? pp.wait : 4000 }).then(() => true).catch(() => false);
  await p.waitForTimeout(Math.min(pp.wait ?? 500, 1500));
  if (found) await settle(p, pp.box);
  return found;
}
async function close(p, pp) {
  if (pp.close) {
    const r = await p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, pp.close);
    if (r) await p.mouse.click(r.x, r.y);   // a real click: the close control works where it is
    await p.waitForTimeout(500);
    const gone = await p.evaluate((s) => ![...document.querySelectorAll(s)].some((e) => e.getBoundingClientRect().width > 1 && !e.closest("[hidden]") && getComputedStyle(e).opacity > 0.1), pp.gone ?? pp.box);
    return gone;
  }
  if (pp.after) await pp.after(p);
  await p.waitForTimeout(300);
  return true;
}

// what the safe rectangle must be (independently of the page): the margins, or the whole window in Dayspring mini
const expected = (w, h, m, mini) => (mini ? { l: 0, t: 0, r: w, b: h } : { l: w * m.l / 100, t: h * m.t / 100, r: w - w * m.r / 100, b: h - h * m.b / 100 });
// the margins change the way Settings → Screen changes them: saved on the server, which tells the screen (live)
const saveMargins = (m) => fetch(BASE + "/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ overscan: 0, marginTop: m.t, marginBottom: m.b, marginLeft: m.l, marginRight: m.r }) });
async function setMargins(p, m) {
  await saveMargins(m);
  const { width: w, height: h } = p.viewportSize();
  await p.waitForFunction(([e, e2]) => { const s = window.dsSafeRect?.(); if (!s) return false; const x = document.documentElement.classList.contains("mini") ? e2 : e;
    return Math.abs(s.left - x.l) < 1.5 && Math.abs(s.top - x.t) < 1.5 && Math.abs(s.right - x.r) < 1.5 && Math.abs(s.bottom - x.b) < 1.5; }, [expected(w, h, m, false), expected(w, h, m, true)], { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(250);
}
async function safeMatches(p, w, h, m, tag) {
  const got = await p.evaluate(() => { const s = window.dsSafeRect?.(); return s && { l: s.left, t: s.top, r: s.right, b: s.bottom, mini: document.documentElement.classList.contains("mini") }; });
  const e = expected(w, h, m, got?.mini);
  const ok = got && ["l", "t", "r", "b"].every((k) => Math.abs(got[k] - e[k]) <= 1.5);
  check(`${tag}: the safe area follows the margins${got?.mini ? " (mini: the whole window)" : ""}`, ok, got ? `got ${Math.round(got.l)},${Math.round(got.t)}→${Math.round(got.r)},${Math.round(got.b)}` : "no dsSafeRect");
}

const ZERO = { t: 0, b: 0, l: 0, r: 0 }, BIG = { t: 8, b: 8, l: 8, r: 8 }, UNEVEN = { t: 3, b: 12, l: 10, r: 2 };
const CONFIGS = [
  ["/display", 1280, 720, [ZERO, BIG, UNEVEN]],
  ["/display", 1920, 1080, [ZERO, BIG, UNEVEN]],
  ["/mini", 380, 560, [BIG, ZERO]],
];
const pct = (m) => `${m.t}/${m.r}/${m.b}/${m.l}%`;

// (debugging: OVERLAY_ONLY=<regex on the pop-up name>, CONFIG_ONLY=<regex on "/display 1280×720 margins 8/8/8/8%">)
const ONLY = process.env.OVERLAY_ONLY ? new RegExp(process.env.OVERLAY_ONLY, "i") : null, CONLY = process.env.CONFIG_ONLY ? new RegExp(process.env.CONFIG_ONLY, "i") : null;
for (const [path, w, h, margins] of CONFIGS) {
  for (const m of margins) {
    if (CONLY && !CONLY.test(`${path} ${w}×${h} margins ${pct(m)}`)) continue;
    const tag = `${path} ${w}×${h} margins ${pct(m)}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript(mock);
    await ctx.route("**/*", (rt) => {
      const u = rt.request().url();
      if (/\/api\/setup\/permissions$/.test(u) && rt.request().method() === "GET") return rt.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ confirmPending: true, summary: "Read your Documents; write with backups; no deleting. " + LONG }) });
      if (rt.request().method() === "POST" && DEVICE_ROUTES.test(u)) return rt.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
      return rt.continue();
    });
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e.stack || e.message).slice(0, 300)));
    await saveMargins(m);   // saved before the screen opens (it reads them as it starts)
    await p.goto(BASE + path); await p.waitForTimeout(2200);
    if (await p.locator("#startBtn").isVisible().catch(() => false)) { await p.click("#startBtn"); await p.waitForTimeout(600); }
    await setMargins(p, m);
    await safeMatches(p, w, h, m, tag);

    for (const pp of POPUPS) {
      if (ONLY && !ONLY.test(pp.name)) continue;
      if (pp.skip?.(path)) continue;
      const shown = await open(p, pp, w);
      if (!shown) { check(`${tag}: ${pp.name} opens`, false, "didn't appear"); await close(p, pp).catch(() => {}); continue; }
      if (process.env.OVERLAY_TRACE) console.log("TRACE", pp.name, JSON.stringify(await p.evaluate(async (s) => { const out = []; for (let i = 0; i < 12; i++) { const e = document.querySelector(s); out.push(e ? `${e.isConnected ? "" : "detached "}${e.closest("[hidden]") ? "hidden " : ""}op${getComputedStyle(e).opacity} w${Math.round(e.getBoundingClientRect().width)}` : "none"); await new Promise((r) => setTimeout(r, 150)); } return out; }, pp.box)));
      const r = await p.evaluate(inspect, [pp.box, pp.ctl === "none" ? "__none__" : pp.ctl]);
      if (process.env.OVERLAY_SHOT) await p.screenshot({ path: join(TMP, `${pp.name.replace(/\W+/g, "-")}-${w}x${h}-${m.t}-${m.l}.png`) });
      check(`${tag}: ${pp.name} is inside the margins`, r.boxInside, `box ${r.box}, safe ${r.safe}`);
      if (pp.ctl !== "none") check(`${tag}: ${pp.name}: its ${r.controls} buttons are inside and clickable`, r.controls > 0 && !r.outside.length && !r.blocked.length, [...r.outside, ...r.blocked].slice(0, 3).join(" | ") || `${r.controls} controls`);
      const gone = await close(p, pp);
      if (pp.close) check(`${tag}: ${pp.name} closes with its own control`, gone);
    }

    // live: a pop-up that's open while the margins change (and then the window is resized) moves to stay inside
    const LIVE = POPUPS.filter((x) => (!ONLY || ONLY.test(x.name)) && x.live && !x.skip?.(path));
    const m2 = m === UNEVEN ? { t: 12, b: 2, l: 3, r: 11 } : m === ZERO ? UNEVEN : { t: 2, b: 14, l: 12, r: 4 };
    const w2 = Math.round(w * 0.8), h2 = Math.round(h * 0.85);
    const detail = (r) => `box ${r.box}, safe ${r.safe}${[...r.outside, ...r.blocked].length ? " · " + [...r.outside, ...r.blocked].slice(0, 2).join(" | ") : ""}`;
    let safeChecked = false;
    for (const pp of LIVE) {
      if (!(await open(p, pp, w))) { check(`${tag} live: ${pp.name} opens`, false); continue; }
      const before = (await p.evaluate(inspect, [pp.box, "__none__"])).rect;
      await setMargins(p, m2); await settle(p, pp.box);
      if (process.env.OVERLAY_TRACE) console.log("TRACE live", pp.name, JSON.stringify(await p.evaluate((s) => [...document.querySelectorAll(s)].map((e) => `${e.closest("[hidden]") ? "hidden " : ""}op${getComputedStyle(e).opacity} w${Math.round(e.getBoundingClientRect().width)}`), pp.box)));
      if (!safeChecked) await safeMatches(p, w, h, m2, `${tag} → ${pct(m2)} live`);
      const mini = await p.evaluate(() => document.documentElement.classList.contains("mini"));
      let r = await p.evaluate(inspect, [pp.box, pp.ctl]);
      const moved = r.found && before && ["l", "t", "r", "b"].some((k) => Math.abs(r.rect[k] - before[k]) > 2);
      check(`${tag} → ${pct(m2)} live: ${pp.name} ${mini ? "stays" : "moved and is"} inside, buttons clickable`, r.found && r.boxInside && (mini || moved) && !r.outside.length && !r.blocked.length, r.found ? `${detail(r)}${moved ? "" : " · did not move from " + JSON.stringify(before)}` : "gone");
      await p.setViewportSize({ width: w2, height: h2 }); await p.waitForTimeout(700); await settle(p, pp.box);
      if (!safeChecked) await safeMatches(p, w2, h2, m2, `${tag} → ${pct(m2)} resized to ${w2}×${h2}`);
      r = await p.evaluate(inspect, [pp.box, pp.ctl]);
      check(`${tag} → ${pct(m2)} resized to ${w2}×${h2}: ${pp.name} inside, buttons clickable`, r.found && r.boxInside && !r.outside.length && !r.blocked.length, r.found ? detail(r) : "gone");
      safeChecked = true;
      await p.setViewportSize({ width: w, height: h }); await setMargins(p, m);
      await close(p, pp);
    }
    check(`${tag}: no page errors`, errs.length === 0, errs.slice(0, 2).join(" | "));
    if (fail) await p.screenshot({ path: join(TMP, `last-${path.slice(1)}-${w}x${h}-${m.t}-${m.b}-${m.l}-${m.r}.png`) }).catch(() => {});
    await ctx.close();
  }
}

await browser.close();
server.kill();
await sleep(500);
if (!process.argv.includes("--keep")) { spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true }); try { rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } }
else console.log("kept:", TMP);
console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nALL PASSED: ${pass} passed`);
process.exit(fail ? 1 : 0);
