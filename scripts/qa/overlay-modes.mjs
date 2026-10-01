// Every pop-up stays inside the screen's margins in EVERY way it can be shown (Settings → Screen, 📐 Fit to screen).
// overlay-fit.mjs opens each pop-up the usual way; this one puts the windows through their modes and checks the whole
// screen each time: big (the window manager's ▢), normal, small (❐), dragged hard into each corner with a real mouse,
// stretched from the resize handle, full screen (the viewer's ⛶, the video's full screen), the gallery's one-photo view,
// the video big / in the corner / full screen, the picture viewer. After each step EVERY visible fixed element on the
// screen (a backdrop's own box, for a dimmed backdrop) must lie inside the safe rectangle. Then, with the window still in
// that mode, the margins change (live) and the window shrinks, and everything must still be inside.
// On a throwaway copy, headless Chrome (muted, no microphone), at 1280×720 with uneven margins, 1920×1080 with 8% on
// every side, and /mini 380×560 (its safe area is the whole window).
//   node scripts/qa/overlay-modes.mjs [--keep]      (OVERLAY_ONLY=<regex on the scenario>, CONFIG_ONLY=<regex>)
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { qaPort } from "./port.mjs";   // a free port (or QA_PORT), never the owner's 4747
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// playwright-core: QA_PLAYWRIGHT, else the exported copy next to this project (…/dayspring-app), else this app's own
const PW = process.env.QA_PLAYWRIGHT ?? pathToFileURL([join(DESK, "..", "..", "..", "dayspring-app", "node_modules", "playwright-core", "index.mjs"), join(DESK, "node_modules", "playwright-core", "index.mjs")].find((p) => existsSync(p)) ?? "").href;
if (!PW) { console.log("FAIL  playwright-core not found"); process.exit(1); }
const { chromium } = await import(PW);
const CHROME = process.env.QA_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";

const PORT = await qaPort(4772), BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), "ds-overlaymodes-")), APP = join(TMP, "app");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && got !== "" ? "  (" + got + ")" : ""}`); };

// (QA_APP_FROM=<an exported Dayspring, e.g. a release>: that copy is tested instead of this one, copied without its .git,
// node_modules and data; how an older version is checked against the same scenarios)
if (process.env.QA_APP_FROM) spawnSync("robocopy", [process.env.QA_APP_FROM, APP, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/XD", ".git", "node_modules", "data"], { windowsHide: true });
else spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(join(APP, "data"), { recursive: true });
writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary" }));
const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_NO_ECO: "1", DS_PROFILE: "DayspringQA", DAYSPRING_CHANNEL: "dev" };
const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = ""; server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
let isUp = false;
for (let i = 0; i < 120 && !(isUp = await up()); i++) await sleep(500);
check("the throwaway server is up", isUp, serverLog.slice(-300));

// muted, no microphone (a fake one that never listens), autoplay allowed for the mocked video
const launch = () => chromium.launch({ ...(existsSync(CHROME) ? { executablePath: CHROME } : { channel: "chrome" }), headless: true,
  args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const mock = () => {
  window.__dsAllowAutomatedListen = true;
  const ss = window.speechSynthesis; if (ss) { ss.speak = (u) => setTimeout(() => u.onend?.(), 10); ss.cancel = () => {}; }
  HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  class FakeSR { start() {} abort() { setTimeout(() => this.onend?.(), 5); } stop() { this.abort(); } }
  window.SpeechRecognition = window.webkitSpeechRecognition = FakeSR;
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("no microphone in tests", "NotAllowedError"));
  // the browser's own full screen, as a video's ⛶ in its controls (or YouTube's in a frame) asks for it: not the page's code
  window.__qaNativeFS = Element.prototype.requestFullscreen;
};
const GAL = Array.from({ length: 40 }, (_, i) => ({ id: "0123456789abcd" + String(i).padStart(2, "0"), name: `Photo ${i + 1}.jpg`, kind: "image", t: Date.UTC(2026, 6, 1) - i * 86400000, size: 1000, m: 1 }));
const GAL_ITEM = { id: "0123456789abcd01", name: "A photo with a rather long name from the family trip.jpg", path: "D:\\Photos\\Pictures\\Family\\Summer trip\\A photo.jpg",
  where: "Pictures › Family › Summer trip", crumbs: [{ label: "Pictures", fid: "f00000000000001" }, { label: "Family", fid: "f00000000000002" }, { label: "Summer trip", fid: "f00000000000003", last: true }], sizeText: "2.1 MB", date: "2026-07-04T12:00:00Z" };
const BIGSVG = `<svg xmlns='http://www.w3.org/2000/svg' width='3000' height='4000'><rect width='100%' height='100%' fill='#468'/></svg>`;
const PNG1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const DEVICE_ROUTES = /\/api\/(sound|window|devices\/use|voicemeeter\/(install|setup)|keepawake|tunein|callbridge|open|app\/quit|update)/;
const MAPS_VIEW = { open: true, q: "library", provider: "osm", services: { active: "osm", map: "OpenStreetMap", search: "OpenStreetMap", route: "OSRM", transit: false }, units: "mi", home: { name: "Home", lat: 39.78, lon: -89.65 },
  results: [{ n: 1, id: "osm:n1", name: "Public Library", address: "1 Main Street", lat: 39.8, lon: -89.64, distanceText: "1.4 mi" }], selected: 0, mode: "driving", avoid: {}, alt: 0, step: 0, guided: false,
  from: null, to: null, routes: [], stepText: "", link: "", embed: null, error: "", busy: "", at: 1 };

// ---------------------------------------------------------------- in the page: everything on the screen, inside?
// Every visible fixed element is checked. A full-screen dimmed backdrop may cover the whole screen (it only dims it): its
// own boxes are checked instead. The decoration (the sky, the grain, the night veil), the invisible safe-area probe and
// the window bar (it slides in from above, inside the margin, only when asked for) are left out.
function sweep() {
  const SKIP = "#dsSafeArea, #bg, #sky, .grain, .vignette, .nightveil, #skyfx, #skydim, .wbar, .fitcal, #wmDock:empty";
  const BACKDROP = ".overlay, .detail, .wconfirm, .brev, .bdlg, .mlimg, .mailconfirm, .mailpick, .mailhelp, #dsxCount, .safe-cover, #dsStopped, .vw-ask";
  const S = window.dsSafeRect(), tol = 1.5;
  const opaque = (e) => { let o = 1; for (let a = e; a && a.nodeType === 1; a = a.parentElement) o *= Number(getComputedStyle(a).opacity); return o > 0.05; };
  const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none" && !e.closest("[hidden]") && opaque(e); };
  const inside = (r) => r.left >= S.left - tol && r.top >= S.top - tol && r.right <= S.right + tol && r.bottom <= S.bottom + tol;
  const name = (e) => (e.id ? "#" + e.id : e.tagName.toLowerCase() + (typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\s+/).slice(0, 3).join(".") : ""));
  const fmt = (r) => `${Math.round(r.left)},${Math.round(r.top)}→${Math.round(r.right)},${Math.round(r.bottom)}`;
  const bad = [];
  for (const e of document.body.querySelectorAll("*")) {
    if (getComputedStyle(e).position !== "fixed" || e.matches(SKIP) || e.closest(SKIP) || !vis(e)) continue;
    const boxes = e.matches(BACKDROP) ? [...e.children].filter((c) => getComputedStyle(c).position !== "fixed" && vis(c)) : [e];
    for (const b of boxes) { const r = b.getBoundingClientRect(); if (!inside(r)) bad.push(`${name(b)} ${fmt(r)}`); }
  }
  return { bad, safe: fmt(S), fs: Boolean(document.fullscreenElement) };
}
// a snapshot of where the fixed things are (to wait until the animations and transitions are over)
// (the fixed elements are found once per wait: looking at every element's style each time is slow)
const layoutKey = (fresh) => {
  // (not the ones that never stop moving: a pulsing light, the sky)
  const forever = (e) => e.getAnimations?.().some((a) => a.effect?.getComputedTiming?.().iterations === Infinity);
  if (fresh || !window.__qaFixed) window.__qaFixed = [...document.body.querySelectorAll("*")].filter((e) => getComputedStyle(e).position === "fixed" && !forever(e));
  // (and while a transition or a one-off animation is still running, it isn't done: a window gliding to its new place)
  const moving = document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getComputedTiming?.().iterations !== Infinity).length;
  return window.__qaFixed.map((e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)},${e.style.opacity}`; }).join("|") + (moving ? "~" + Math.random() : "");
};
// the screen checked until everything is inside, for up to 3.5 s (a window glides to its new place after a change)
async function sweepSettled(p) {
  let r;
  for (const end = Date.now() + 3500; ; await p.waitForTimeout(250)) { r = await p.evaluate(sweep); if (!r.bad.length || Date.now() > end) return r; }
}
// (a moment first: a window refits a frame or two after the screen changes, then glides for up to .6 s)
async function steady(p) {
  await p.waitForTimeout(300);
  let last = await p.evaluate(layoutKey, true), same = 0;
  for (let i = 0; i < 40 && same < 3; i++) { await p.waitForTimeout(110); const k = await p.evaluate(layoutKey, false); same = k === last ? same + 1 : 0; last = k; }
}

// ---------------------------------------------------------------- the ways each window can be shown
const wmMode = (id, m) => (p) => p.evaluate(([i, x]) => window.winman.setMode(i, x), [id, m]);
// a real mouse: press on the window's handle (its title bar, or the picture for the video), pull it hard into a corner
async function dragTo(p, handle, corner) {
  const h = await p.evaluate((s) => { const e = [...document.querySelectorAll(s)].find((x) => x.getBoundingClientRect().width > 4 && !x.closest("[hidden]")); if (!e) return null; const r = e.getBoundingClientRect();
    // a spot on the handle that isn't a button (the title, or empty space)
    for (const fx of [0.3, 0.45, 0.15, 0.6, 0.05]) { const x = r.left + r.width * fx, y = r.top + Math.min(r.height / 2, 14); const at = document.elementFromPoint(x, y); if (at && e.contains(at) && !at.closest("button, input, select, a, textarea")) return { x, y }; }
    return { x: r.left + 6, y: r.top + 6 }; }, handle);
  if (!h) return false;
  const { width: w, height: hh } = p.viewportSize();
  const to = corner === "br" ? { x: w - 2, y: hh - 2 } : corner === "tl" ? { x: 1, y: 1 } : corner === "tr" ? { x: w - 2, y: 1 } : { x: 1, y: hh - 2 };
  await p.mouse.move(h.x, h.y); await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(h.x + (to.x - h.x) * i / 8, h.y + (to.y - h.y) * i / 8);
  await p.mouse.up();
  return true;
}
// stretch a small window from its resize handle, as far as the screen goes
async function stretch(p, box) {
  const g = await p.evaluate((s) => { const e = document.querySelector(`${s} > .wm-resize`); if (!e || !e.offsetWidth) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, at: e.dataset.at }; }, box);
  if (!g) return false;
  const { width: w, height: h } = p.viewportSize();
  const to = { x: g.at.includes("r") ? w - 1 : 1, y: g.at.includes("b") ? h - 1 : 1 };
  await p.mouse.move(g.x, g.y); await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(g.x + (to.x - g.x) * i / 8, g.y + (to.y - g.y) * i / 8);
  await p.mouse.up();
  return true;
}
// the standard run through the window manager's modes, for a window registered as `id` whose title bar is `bar`
const wmSteps = (id, box, bar) => [
  ["normal", wmMode(id, "normal")],
  ["big (▢)", wmMode(id, "max")],
  ["small (❐)", wmMode(id, "small")],
  ["small, dragged into the bottom-right corner", (p) => dragTo(p, bar, "br")],
  ["small, dragged into the top-left corner", (p) => dragTo(p, bar, "tl")],
  ["small, stretched from its resize handle", (p) => stretch(p, box)],
  ["normal, pulled by its title bar into the bottom-right corner", async (p) => { await wmMode(id, "normal")(p); await steady(p); return dragTo(p, bar, "br"); }],
];
// a video that's "playing" (a local video: no network, no YouTube)
const fakeVideo = (p) => p.evaluate(() => {
  const H = window.dsPlayerHost, m = document.getElementById("media");
  Object.assign(H.P, { source: "file", hasVideo: true, title: "QA video", playing: true });
  m.hidden = false; window.__dsTestMedia = true;
  window.winman.setMode("video", "normal", { user: false });
});
const video = (a, v) => (p) => p.evaluate(([x, y]) => window.dayspring.playerCtl(x, y), [a, v]);

// the Shopping panel (public/shopping.js): made-up results and one made-up item (nothing is asked of Amazon from here)
const SHOP_RESULTS = { query: "waterproof work boot", filters: { minPrice: null, maxPrice: 120, brand: null, prime: false, minRating: null, sort: "relevance" }, filterText: "under $120", hasMore: true, brands: ["Stormtrek", "Ridgeline"],
  items: Array.from({ length: 12 }, (_, i) => ({ n: i + 1, asin: "B0TEST" + String(i).padStart(4, "0"), title: `A waterproof work boot with a fairly long product title, number ${i + 1}`, brand: "Stormtrek", price: 50 + i, listPrice: i % 3 ? null : 80, rating: 4.2, reviews: 1200 + i, prime: i % 2 === 0, delivery: "FREE delivery Fri, Oct 3", sponsored: i === 2, badge: i === 0 ? "Best Seller" : null, image: null })) };
const SHOP_ITEM = { asin: "B0TEST0001", n: 1, title: "Stormtrek Men's Waterproof Work Boot, Steel Toe, Slip Resistant, with a long name that wraps", brand: "Stormtrek", price: 109.99, listPrice: 139.99, savings: "-21%", deal: "Limited time deal", images: [], stock: "In Stock", delivery: "FREE delivery Fri, Oct 3", seller: "Stormtrek Direct", shipsFrom: "Amazon",
  variations: [{ key: "color", name: "Color", selected: "Walnut", options: ["Walnut", "Charcoal"].map((l, i) => ({ label: l, asin: "B0TESTC00" + i, available: true, selected: i === 0 })) }, { key: "size", name: "Size", selected: "10", options: ["8", "9", "10", "11", "12", "13"].map((l, i) => ({ label: l, asin: "B0TESTS00" + i, available: i !== 5, selected: l === "10" })) }],
  buyingOptions: ["One-time purchase: $109.99", "Subscribe & Save: $104.49"], bullets: ["WATERPROOF: sealed seams.", "PROTECTIVE TOE.", "GRIP."], specs: [{ name: "Item Weight", value: "4.2 pounds" }], rating: 4.6, reviews: 12345,
  histogram: [5, 4, 3, 2, 1].map((s) => ({ stars: s, pct: s * 4 })), topReviews: [{ title: "Dry feet", rating: 5, body: "Kept my feet dry.", author: "R. Example", date: "August 2, 2026" }], canAddToCart: true, subscribe: true };
const SCENARIOS = [
  { name: "file viewer (a picture)", open: (p) => p.evaluate(() => window.dsViewer.open({ item: { id: "0123456789abcdef", name: "A tall picture.svg", kind: "image", type: "Picture", sizeText: "12 KB", where: "Pictures" } })), box: "#dsViewer",
    steps: [["⛶ full screen", (p) => p.click('#dsViewer [data-a="full"]')], ["⛶ full screen off", (p) => p.click('#dsViewer [data-a="full"]')], ...wmSteps("viewer", "#dsViewer", "#dsViewer .vw-bar")],
    close: (p) => p.evaluate(() => { window.winman.setMode("viewer", "normal"); window.dsViewer.close(); }) },
  { name: "file viewer (a video)", open: (p) => p.evaluate(() => window.dsViewer.open({ item: { id: "0123456789abcdee", name: "A clip.mp4", kind: "video", type: "Video", sizeText: "2 MB", where: "Videos" } })), box: "#dsViewer",
    steps: [["the video's own ⛶", (p) => p.evaluate(() => document.querySelector('#dsViewer [data-t="vfull"]').click())],
      ["the video's own ⛶ again (back)", async (p) => { await p.evaluate(async () => { if (document.fullscreenElement) await document.exitFullscreen().catch(() => {}); }); await steady(p); await p.evaluate(() => document.querySelector('#dsViewer [data-t="vfull"]').click()); }],
      ["⛶ full screen", (p) => p.evaluate(() => { if (!document.querySelector("#dsViewer.full")) document.querySelector('#dsViewer [data-a="full"]').click(); })],
      ["the browser's own full screen on the video (its controls' ⛶)", (p) => p.evaluate(() => { document.querySelector('#dsViewer [data-a="full"]').click(); return window.__qaNativeFS.call(document.querySelector("#dsViewer video")); })],
      ["Esc", (p) => p.keyboard.press("Escape")]],
    close: (p) => p.evaluate(async () => { if (document.fullscreenElement) await document.exitFullscreen().catch(() => {}); window.dsViewer.close(); }) },
  // the details card (the photo card's picture, a video, the weather): its ⛶, and a video's own ⛶ inside it
  { name: "details card (a photo)", open: (p) => p.evaluate((s) => { document.getElementById("dTitle").textContent = "Family · July 2026"; const d = document.getElementById("detail"); d.classList.add("wide");
      document.getElementById("dBody").innerHTML = `<div class="dphoto"><img src="${s}" alt=""></div><p class="dcap">A caption for the photo, long enough to wrap onto a second line when the card is narrow.</p><div class="dnav"><button>Show another ›</button></div>`; d.hidden = false; },
    "data:image/svg+xml," + encodeURIComponent(BIGSVG)), box: "#detail .dbox",
    steps: [["shown", async () => true], ["⛶ full screen", (p) => p.click("#dFull")], ["⛶ again (back)", async (p) => { await p.evaluate(async () => { if (document.fullscreenElement) await document.exitFullscreen().catch(() => {}); }); await steady(p); await p.click("#dFull"); }],
      ["a video in it, the browser's own full screen", (p) => p.evaluate(() => { document.getElementById("dBody").insertAdjacentHTML("afterbegin", '<div class="dvideo"><video controls muted></video></div>'); return window.__qaNativeFS.call(document.querySelector("#dBody video")); })]],
    close: (p) => p.evaluate(async () => { if (document.fullscreenElement) await document.exitFullscreen().catch(() => {}); document.getElementById("dClose").click(); }) },
  { name: "photo gallery", open: (p) => p.evaluate(() => window.dsGallery.open({ view: "all" })), box: "#dsGallery", steps: wmSteps("gallery", "#dsGallery", "#dsGallery .g-bar"),
    close: (p) => p.evaluate(() => { window.winman.setMode("gallery", "normal"); window.dsGallery.close(); }) },
  { name: "photo gallery: one photo", open: (p) => p.evaluate(() => window.dsGallery.open({ view: "all", focus: "0123456789abcd01", single: true })), box: "#dsGallery", steps: [...wmSteps("gallery", "#dsGallery", "#dsGallery .g-bar").slice(0, 4),
    ["the slideshow", (p) => p.evaluate(() => { window.winman.setMode("gallery", "normal"); document.querySelector('#dsGallery [data-s="show"]')?.click(); })]],
    close: (p) => p.evaluate(() => { window.winman.setMode("gallery", "normal"); window.dsGallery.close(); }) },
  { name: "Shopping panel", open: (p) => p.evaluate((r) => window.dsShop.open({ tab: "search", results: r, focus: false }), SHOP_RESULTS), box: "#dsShop", steps: wmSteps("shopping", "#dsShop", "#dsShop .sh-bar"),
    close: (p) => p.evaluate(() => { window.winman.setMode("shopping", "normal"); window.dsShop.close(); }) },
  { name: "Shopping: one item", open: (p) => p.evaluate((d) => window.dsShop.open({ tab: "item", item: d, focus: false }), SHOP_ITEM), box: "#dsShop", steps: wmSteps("shopping", "#dsShop", "#dsShop .sh-bar").slice(0, 4),
    close: (p) => p.evaluate(() => { window.winman.setMode("shopping", "normal"); window.dsShop.close(); }) },
  { name: "Music & Video browser", open: (p) => p.evaluate(() => window.dsMB.open({ source: "local" })), box: "#dsMB", steps: wmSteps("mediabrowser", "#dsMB", "#dsMB .mb-bar"),
    close: (p) => p.evaluate(() => { window.winman.setMode("mediabrowser", "normal"); window.dsMB.close(); }) },
  { name: "Maps window", open: (p) => p.evaluate((v) => window.dispatchEvent(new CustomEvent("ds-test-maps", { detail: v })), MAPS_VIEW), box: "#dsMaps", steps: wmSteps("maps", "#dsMaps", "#dsMaps .mp-bar"),
    close: (p) => p.evaluate(() => { window.winman.setMode("maps", "normal"); window.dsMaps.close(); }) },
  { name: "GIF picker", open: (p) => p.evaluate(() => window.dsGifPicker.open({ tab: "favorites" })), box: "#dsGifs", steps: wmSteps("gifs", "#dsGifs", "#dsGifs .g-bar"),
    close: (p) => p.evaluate(() => { window.winman.setMode("gifs", "normal"); document.querySelector("#dsGifs .g-x")?.click(); }) },
  { name: "picture grid", open: (p) => p.evaluate((its) => window.dispatchEvent(new CustomEvent("ds-test-images", { detail: { open: true, query: "sunsets", filters: {}, more: true, items: its } })), Array.from({ length: 12 }, (_, i) => ({ n: i + 1, title: `Sunset ${i + 1}`, thumb: "", sourceDomain: "example.org" }))),
    box: "#dsImages", steps: wmSteps("images", "#dsImages", "#dsImages header"), close: (p) => p.evaluate(() => { window.winman.setMode("images", "normal"); window.dsImages.close(true); }) },
  { name: "page window (Help)", open: (p) => p.evaluate(() => window.dsOpenPage("/help?embed=1")), box: "#pagewrap",
    steps: [["normal", wmMode("page", "normal")], ["big (▢)", wmMode("page", "max")], ["small (❐)", wmMode("page", "small")], ["small, stretched from its resize handle", (p) => stretch(p, "#pagewrap")]],
    close: (p) => p.evaluate(() => { window.winman.setMode("page", "normal"); document.getElementById("pageClose").click(); }) },
  { name: "the video", open: fakeVideo, box: "#media",
    steps: [["big", video("view", "big")], ["full screen", video("view", "full")], ["back from full screen", video("view", "exitFull")], ["in the corner", video("view", "corner")],
      ["in the corner, dragged into the top-left corner", (p) => dragTo(p, "#media", "tl")], ["in the corner, dragged into the bottom-right corner", (p) => dragTo(p, "#media", "br")],
      ["in the corner, stretched from its resize handle", (p) => stretch(p, "#media")], ["moved to the top right", video("place", "tr")], ["made bigger (again and again)", async (p) => { for (let i = 0; i < 8; i++) await video("resize", "bigger")(p); }],
      ["full screen from the corner", video("view", "full")]],
    close: (p) => p.evaluate(() => { window.__dsTestMedia = false; window.dayspring.stopMedia?.(true); }) },
  { name: "picture viewer (media library)", open: (p) => p.evaluate((s) => window.dsMediaLib.showImage({ src: s, title: "A very large picture with a long, long name that goes on" }), "data:image/svg+xml," + encodeURIComponent(BIGSVG)), box: ".mlimg",
    steps: [["shown", async () => true]], close: (p) => p.evaluate(() => document.querySelector(".mlimg")?.click()) },
];

// ---------------------------------------------------------------- margins, screens
const expected = (w, h, m, mini) => (mini ? { l: 0, t: 0, r: w, b: h } : { l: w * m.l / 100, t: h * m.t / 100, r: w - w * m.r / 100, b: h - h * m.b / 100 });
const saveMargins = (m) => fetch(BASE + "/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ overscan: 0, marginTop: m.t, marginBottom: m.b, marginLeft: m.l, marginRight: m.r }) });
async function setMargins(p, m) {
  await saveMargins(m);
  const { width: w, height: h } = p.viewportSize();
  const ok = await p.waitForFunction(([e, e2]) => { const s = window.dsSafeRect?.(); if (!s) return false; const x = document.documentElement.classList.contains("mini") ? e2 : e;
    return Math.abs(s.left - x.l) < 1.5 && Math.abs(s.top - x.t) < 1.5 && Math.abs(s.right - x.r) < 1.5 && Math.abs(s.bottom - x.b) < 1.5; }, [expected(w, h, m, false), expected(w, h, m, true)], { timeout: 5000 }).then(() => true).catch(() => false);
  await steady(p);
  return ok;
}
const UNEVEN = { t: 3, b: 12, l: 10, r: 2 }, TV = { t: 6, b: 4, l: 9, r: 9 }, BIG = { t: 8, b: 8, l: 8, r: 8 }, OTHER = { t: 12, b: 2, l: 3, r: 11 };
const CONFIGS = [["/display", 1280, 720, UNEVEN], ["/display", 1920, 1080, TV], ["/display", 1600, 900, BIG], ["/mini", 380, 560, BIG]];
const pct = (m) => `${m.t}/${m.r}/${m.b}/${m.l}%`;
const ONLY = process.env.OVERLAY_ONLY ? new RegExp(process.env.OVERLAY_ONLY, "i") : null, CONLY = process.env.CONFIG_ONLY ? new RegExp(process.env.CONFIG_ONLY, "i") : null;
const show = (r) => `${r.bad.slice(0, 3).join(" | ")}${r.bad.length > 3 ? ` (+${r.bad.length - 3})` : ""}; safe ${r.safe}${r.fs ? "; the browser went full screen" : ""}`;

for (const [path, w, h, m] of CONFIGS) {
  const tag = `${path} ${w}×${h} margins ${pct(m)}`;
  if (CONLY && !CONLY.test(tag)) continue;
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(mock);
  await ctx.route("**/*", (rt) => {
    const u = rt.request().url();
    if (rt.request().method() === "POST" && DEVICE_ROUTES.test(u)) return rt.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    if (/\/api\/maps\/tile\//.test(u)) return rt.fulfill({ status: 200, contentType: "image/png", body: PNG1 });
    if (/\/api\/gallery\/list\?/.test(u)) { const q = new URL(u).searchParams, off = Number(q.get("offset")) || 0, lim = Number(q.get("limit")) || 120; return rt.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ total: GAL.length, offset: off, items: GAL.slice(off, off + lim), groups: [], focusIndex: GAL.findIndex((x) => x.id === q.get("focus")), title: "All photos" }) }); }
    if (/\/api\/gallery\/item\?/.test(u)) return rt.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GAL_ITEM) });
    if (/\/api\/gallery\/(thumb|file)\?/.test(u)) return rt.fulfill({ status: 200, contentType: "image/png", body: PNG1 });
    // (the viewer: a made-up picture and video, no file is read)
    if (/\/api\/viewer\/file\?id=0123456789abcdef/.test(u)) return rt.fulfill({ status: 200, contentType: "image/svg+xml", body: BIGSVG });
    if (/\/api\/viewer\/file\?/.test(u)) return rt.fulfill({ status: 404, body: "" });
    if (/\/api\/viewer\/siblings\?/.test(u)) return rt.fulfill({ status: 200, contentType: "application/json", body: '{"ids":[]}' });
    return rt.continue();
  });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e.stack || e.message).slice(0, 300)));
  let crashed = false; p.on("crash", () => { crashed = true; });
  await saveMargins(m);
  await p.goto(BASE + path); await p.waitForTimeout(2200);
  if (await p.locator("#startBtn").isVisible().catch(() => false)) { await p.click("#startBtn"); await p.waitForTimeout(600); }
  check(`${tag}: the safe area follows the margins`, await setMargins(p, m));
  const base = await p.evaluate(sweep);
  check(`${tag}: nothing is outside the margins before any pop-up opens`, !base.bad.length, show(base));

  for (const sc of SCENARIOS) {
    if (ONLY && !ONLY.test(sc.name)) continue;
    await sc.open(p);
    const shown = await p.waitForFunction((s) => [...document.querySelectorAll(s)].some((e) => e.getBoundingClientRect().width > 1 && !e.closest("[hidden]")), sc.box, { timeout: 5000 }).then(() => true).catch(() => false);
    if (!shown) { check(`${tag}: ${sc.name} opens`, false, "didn't appear"); await sc.close(p).catch(() => {}); continue; }
    await steady(p);
    for (const [step, act] of sc.steps) {
      const did = await act(p).then(() => true).catch((e) => String(e.message).slice(0, 120));
      await steady(p);
      const r = await sweepSettled(p);
      if (process.env.OVERLAY_SHOT) await p.screenshot({ path: join(process.env.OVERLAY_SHOT, `${sc.name}-${step}-${w}x${h}.png`.replace(/[^\w.-]+/g, "-")) });
      check(`${tag}: ${sc.name}: ${step}: everything is inside the margins`, did === true && !r.bad.length, did === true ? show(r) : did);
      // live, still in this mode: the margins change, then the window gets smaller; back after
      const moved = await setMargins(p, m === UNEVEN ? OTHER : UNEVEN);
      const r2 = await sweepSettled(p);
      check(`${tag}: ${sc.name}: ${step}: the margins change → still inside`, moved && !r2.bad.length, show(r2));
      await p.setViewportSize({ width: Math.round(w * 0.85), height: Math.round(h * 0.88) });   // (not so small that the screen turns into Dayspring mini) await steady(p);
      const r3 = await sweepSettled(p);
      check(`${tag}: ${sc.name}: ${step}: the window shrinks → still inside`, !r3.bad.length, show(r3));
      if (process.env.OVERLAY_TRACE && r3.bad.length) console.log("TRACE",JSON.stringify(await p.evaluate(() => ({ iw: innerWidth, ih: innerHeight, safe: window.winman?.safe(), wins: window.winman?.list().filter((x) => x.open),
        media: (() => { const m = document.getElementById("media"), c = getComputedStyle(m); return { style: m.getAttribute("style"), cls: m.className, left: c.left, width: c.width, transform: c.transform, anims: m.getAnimations().map((a) => `${a.constructor.name}:${a.transitionProperty ?? a.animationName}:${a.playState}`) }; })() }))));
      await p.setViewportSize({ width: w, height: h }); await setMargins(p, m);
    }
    await sc.close(p).catch(() => {});
    await p.keyboard.press("Escape").catch(() => {});
    await steady(p);
  }
  check(`${tag}: no page errors`, errs.length === 0, errs.slice(0, 2).join(" | "));
  check(`${tag}: the page never crashed`, !crashed);
  if (fail) await p.screenshot({ path: join(TMP, `last-${path.slice(1)}-${w}x${h}.png`) }).catch(() => {});
  await ctx.close(); await browser.close();
}

server.kill();
await sleep(500);
if (!process.argv.includes("--keep")) { spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true }); try { rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } }
else console.log("kept:", TMP);
console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nALL PASSED: ${pass} passed`);
process.exit(fail ? 1 : 0);
