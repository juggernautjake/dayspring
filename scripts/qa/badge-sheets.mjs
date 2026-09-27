// Render badge contact sheets (PNG) with a headless browser, to look at the art.
//   node scripts/qa/badge-sheets.mjs [--out docs/dev/badge-previews] [--only all|cats|tiers|frames|main|small|backs|overview] [--cat workout]
// The review sheets go to docs/dev/badge-previews/ (dev only: scripts/export.mjs leaves it out of the release). "overview"
// writes the one small picture the Help guide shows (docs/xp.md): docs/images/badges-overview.jpg.
// Sheets: badges-contact-sheet.png (everything, 18×18) · badges-<category>.png (one category, 18 tiers, big) ·
// badges-tiers-<n>.png (one tier across the categories) · badges-frames-only.png (emblems hidden: can you tell the
// category from the frame alone?) · badges-48px.png (legibility at 48 px).
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as art from "../../lib/xp/badge-art.mjs";
import { BADGE_CATEGORIES, BADGE_IDS, NAMES } from "../../lib/xp/badges.mjs";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = resolve(DESK, arg("--out", "docs/dev/badge-previews")), ONLY = arg("--only", "all"), CAT = arg("--cat", null);
mkdirSync(OUT, { recursive: true });

const page = (body, w) => `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#0d1020;color:#e8ecf8;font:13px/1.3 system-ui,Segoe UI,sans-serif;width:${w}px}
h1{font-size:18px;margin:14px 18px 4px}.row{display:flex;align-items:center;gap:4px;padding:4px 12px}.lab{width:120px;font-weight:600;font-size:12px;opacity:.85}
.cell{display:flex;flex-direction:column;align-items:center}.cap{font-size:10px;opacity:.7;max-width:100%;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.grid{display:grid;gap:10px;padding:12px 18px}</style>${body}`;
const browser = await chromium.launch({ channel: (await import(pathToFileURL(join(DESK, "lib", "browsers.mjs")).href)).playwrightChannel(), headless: true });
async function shot(html, file, w, dir = OUT) {
  const p = await browser.newPage({ viewport: { width: w, height: 400 }, deviceScaleFactor: 1 });
  await p.emulateMedia({ reducedMotion: "reduce" });
  await p.setContent(page(html, w)); await p.waitForTimeout(200);
  await p.screenshot({ path: join(dir, file), fullPage: true, ...(file.endsWith(".jpg") ? { type: "jpeg", quality: dir === OUT ? 82 : 76 } : {}) }); await p.close();
  console.log("wrote", join(dir, file));
}
const s = (c, t, size, o = {}) => art.svg(c, t, { size, mode: "static", title: false, ...o });
const cats = CAT ? [CAT] : BADGE_IDS;

if (["all", "main"].includes(ONLY)) {
  const W = 120 + 18 * 70 + 40;
  const rows = BADGE_IDS.map((c) => `<div class="row"><div class="lab">${BADGE_CATEGORIES[c].label}</div>${Array.from({ length: 18 }, (_, i) => s(c, i + 1, 66)).join("")}</div>`).join("");
  await shot(`<h1>Dayspring badges · 18 categories × 18 tiers</h1>${rows}`, "badges-contact-sheet.png", W);
}
if (["all", "cats"].includes(ONLY)) for (const c of cats) {
  const cells = Array.from({ length: 18 }, (_, i) => `<div class="cell">${s(c, i + 1, 180)}<div class="cap">${i + 1} · ${NAMES[c][i]}</div></div>`).join("");
  await shot(`<h1>${BADGE_CATEGORIES[c].label}</h1><div class="grid" style="grid-template-columns:repeat(6,180px)">${cells}</div>`, `badges-${c}.jpg`, 6 * 190 + 36);
}
if (["all", "tiers"].includes(ONLY)) for (const t of [1, 4, 7, 10, 13, 16, 18]) {
  const cells = BADGE_IDS.map((c) => `<div class="cell">${s(c, t, 150)}<div class="cap">${BADGE_CATEGORIES[c].label}</div></div>`).join("");
  await shot(`<h1>Tier ${t} across the categories</h1><div class="grid" style="grid-template-columns:repeat(9,150px)">${cells}</div>`, `badges-tier-${t}.jpg`, 9 * 160 + 36);
}
if (["all", "frames"].includes(ONLY)) {
  const tiers = [2, 6, 9, 13, 17];
  const rows = BADGE_IDS.map((c) => `<div class="row"><div class="lab">${BADGE_CATEGORIES[c].label}</div>${tiers.map((t) => s(c, t, 120, { emblem: false })).join("")}</div>`).join("");
  await shot(`<h1>Frames only (emblems hidden): tiers ${tiers.join(", ")}</h1>${rows}`, "badges-frames-only.png", 120 + tiers.length * 124 + 60);
}
if (["all", "small"].includes(ONLY)) {
  const rows = BADGE_IDS.map((c) => `<div class="row"><div class="lab">${BADGE_CATEGORIES[c].label}</div>${[1, 5, 9, 13, 18].map((t) => s(c, t, 48)).join("")}</div>`).join("");
  await shot(`<h1>At 48 px</h1>${rows}`, "badges-48px.png", 480);
}
if (["backs"].includes(ONLY)) {
  const cells = BADGE_IDS.map((c) => `<div class="cell">${art.back(c, 9, { size: 130 })}<div class="cap">${BADGE_CATEGORIES[c].label}</div></div>`).join("");
  await shot(`<h1>Backs (tier 9)</h1><div class="grid" style="grid-template-columns:repeat(9,130px)">${cells}</div>`, "badges-backs.png", 9 * 140 + 36);
}
if (["all", "overview"].includes(ONLY)) {
  const W = 120 + 18 * 46 + 40;
  const rows = BADGE_IDS.map((c) => `<div class="row" style="padding:2px 12px"><div class="lab">${BADGE_CATEGORIES[c].label}</div>${Array.from({ length: 18 }, (_, i) => s(c, i + 1, 44)).join("")}</div>`).join("");
  await shot(`<h1>Dayspring badges · 18 categories × 18 tiers</h1>${rows}`, "badges-overview.jpg", W, resolve(DESK, "docs/images"));
}
await browser.close();
void writeFileSync;
