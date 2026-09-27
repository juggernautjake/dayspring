// Badge art checks in a headless browser (nothing on screen, no server):
//   • every one of the 324 badges (and its back, and the mystery card) is valid SVG
//   • each tier is grander than the one before (element count), in every category
//   • no two badges look nearly the same: a perceptual hash (dHash of the luminance + a coarse colour grid) of each
//     rendered badge is compared with every other one
//   • the mystery card never contains the art
//   • 100 animated badges on one page: the frame rate (and that the calm mode it falls back to is lighter)
//   node scripts/qa/badge-art.mjs
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as art from "../../lib/xp/badge-art.mjs";
import { gridCSS } from "../../lib/xp/badges/motion.mjs";
import { BADGE_IDS } from "../../lib/xp/badges.mjs";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" ? "  (" + got + ")" : ""}`); };

// complexity (no browser needed)
const bad = [];
for (const c of BADGE_IDS) { let prev = 0; for (let t = 1; t <= 18; t++) { const n = art.complexity(art.svg(c, t, { style: false })); if (n <= prev) bad.push(`${c} ${t}`); prev = n; } }
check("each tier is grander than the one before, in every category", !bad.length, bad.join(", "));
// the mystery card: no emblem, no name, no gradients from the real art
const leaks = BADGE_IDS.filter((c) => { const m = art.mystery(c, 5); return /linearGradient|radialGradient|class="emb"|<title|ribbon/.test(m) || m.length > 2500; });
check("the mystery card carries no art (just the outline and a '?')", !leaks.length, leaks.join(", "));

const browser = await chromium.launch({ channel: (await import(pathToFileURL(join(DESK, "lib", "browsers.mjs")).href)).playwrightChannel(), headless: true });
try {
  const p = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await p.setContent("<!doctype html><body style='margin:0;background:#0d1020'></body>");
  const all = [];
  for (const c of BADGE_IDS) for (let t = 1; t <= 18; t++) all.push({ key: `${c}:${t}`, svg: art.svg(c, t, { mode: "static", size: 64, title: false, style: false }), back: art.back(c, t, { size: 64 }), mystery: art.mystery(c, t) });
  // validity: the browser's XML parser
  const invalid = await p.evaluate((items) => items.filter((it) => [it.svg, it.back, it.mystery].some((s) => new DOMParser().parseFromString(s, "image/svg+xml").querySelector("parsererror"))).map((it) => it.key), all);
  check("all 324 badges, backs and mystery cards are valid SVG", !invalid.length, invalid.slice(0, 5).join(", "));
  // perceptual hashes
  const hashes = await p.evaluate(async (items) => {
    const load = (s) => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s); });
    const cv = document.createElement("canvas"); cv.width = cv.height = 64; const g = cv.getContext("2d", { willReadFrequently: true });
    const out = [];
    for (const it of items) {
      const im = await load(it.svg); g.clearRect(0, 0, 64, 64); g.fillStyle = "#0d1020"; g.fillRect(0, 0, 64, 64); g.drawImage(im, 0, 0, 64, 64);
      const d = g.getImageData(0, 0, 64, 64).data, px = (x, y) => { const i = (y * 64 + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
      // dHash on a 17×16 luminance grid (256 bits)
      const lum = []; for (let y = 0; y < 16; y++) for (let x = 0; x < 17; x++) { let s = 0; for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 3; xx++) { const [r, gg, b] = px(Math.min(63, Math.floor(x * 3.76) + xx), y * 4 + yy); s += 0.299 * r + 0.587 * gg + 0.114 * b; } lum.push(s / 12); }
      const bits = []; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) bits.push(lum[y * 17 + x] > lum[y * 17 + x + 1] ? 1 : 0);
      // an 8×8 colour grid
      const col = []; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { let r = 0, gg = 0, b = 0; for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 8; xx++) { const q = px(x * 8 + xx, y * 8 + yy); r += q[0]; gg += q[1]; b += q[2]; } col.push(r / 64, gg / 64, b / 64); }
      out.push({ key: it.key, bits, col });
    }
    return out;
  }, all);
  let closest = { d: Infinity }, dupes = [];
  for (let i = 0; i < hashes.length; i++) for (let j = i + 1; j < hashes.length; j++) {
    const a = hashes[i], b = hashes[j];
    let hd = 0; for (let k = 0; k < 256; k++) hd += a.bits[k] !== b.bits[k];
    let cd = 0; for (let k = 0; k < a.col.length; k++) cd += Math.abs(a.col[k] - b.col[k]); cd /= a.col.length;
    const score = hd + cd;                     // luminance structure + colour, both must be close to count as a near-duplicate
    if (score < closest.d) closest = { d: score, a: a.key, b: b.key, hd, cd: Math.round(cd * 10) / 10 };
    if (hd <= 6 && cd < 4) dupes.push(`${a.key}~${b.key}`);
  }
  check("no two of the 324 badges are near-identical (perceptual hash)", !dupes.length, dupes.length ? dupes.slice(0, 6).join(", ") : `closest pair ${closest.a} / ${closest.b}: ${closest.hd} bits apart, colour Δ ${closest.cd}`);

  // performance: 100 animated badges
  const perf = async (mode) => {
    const q = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const items = []; for (let i = 0; i < 100; i++) { const c = BADGE_IDS[i % 18], t = 1 + ((i * 7) % 18); const b = art.svg(c, t, { mode, size: 110, title: false, style: i === 0 }); items.push(mode === "grid" ? `<span class="bart"${t >= 4 ? " data-sheen" : ""} style="--d:-${(i * 0.37) % 7}s;--d2:${(i * 0.61) % 9}s">${b}</span>` : b); }
    await q.setContent(`<!doctype html><style>${gridCSS()}</style><body style="margin:0;background:#0d1020;display:flex;flex-wrap:wrap">${items.join("")}</body>`);
    await q.waitForTimeout(500);
    const r = await q.evaluate(() => new Promise((ok) => { const times = []; let last = performance.now(); const end = last + 3000; const f = (t) => { times.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else ok(times); }; requestAnimationFrame(f); }));
    await q.close();
    r.sort((a, b) => a - b);
    return { fps: Math.round(1000 / (r.reduce((a, b) => a + b, 0) / r.length)), p95: Math.round(r[Math.floor(r.length * 0.95)]) };
  };
  const full = await perf("full"), grid = await perf("grid");
  console.log(`      100 badges, full detail: ~${full.fps} fps (95th percentile frame ${full.p95} ms) · grid mode: ~${grid.fps} fps (${grid.p95} ms)`);
  check("100 animated badges in a grid keep a smooth frame rate (≥ 50 fps, headless)", grid.fps >= 50, `${grid.fps} fps`);
} finally { await browser.close(); }
console.log(`\n${fail ? "FAILED" : "ALL PASSED"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
