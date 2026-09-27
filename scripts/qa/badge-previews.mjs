// Record the badge animation previews (WebM from the headless browser, GIF via ffmpeg if it's installed):
//   badges-loop      tiers 1, 9, 14 and 18 of Fitness, Prayer and Creativity, looping in the detail view's full motion
//   badges-entrance  the coin-flip entrance: tiers 3, 12 and 18
//   badges-vs-orb    a badge beside the idle Dayspring orb (a throwaway copy of the display), to compare the feel
//   node scripts/qa/badge-previews.mjs [--out docs/dev/badge-previews] [--only loop|entrance|orb]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as art from "../../lib/xp/badge-art.mjs";
import { MOTION } from "../../lib/xp/badges/motion.mjs";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = resolve(DESK, arg("--out", "docs/dev/badge-previews")), ONLY = arg("--only", "all");
mkdirSync(OUT, { recursive: true });
const TMP = mkdtempSync(join(tmpdir(), "ds-badge-rec-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ffmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0 ? "ffmpeg" : null;
const browser = await chromium.launch({ channel: (await import(pathToFileURL(join(DESK, "lib", "browsers.mjs")).href)).playwrightChannel(), headless: true, args: ["--mute-audio"] });

async function record(name, size, fn) {
  const dir = join(TMP, name); mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: size, recordVideo: { dir, size } });
  const p = await ctx.newPage();
  await fn(p);
  await ctx.close();
  const file = readdirSync(dir).find((f) => f.endsWith(".webm"));
  const webm = join(OUT, `${name}.webm`);
  if (existsSync(webm)) rmSync(webm);
  renameSync(join(dir, file), webm);
  console.log("wrote", webm);
  if (ffmpeg) {
    const gif = join(OUT, `${name}.gif`), trim = ["-ss", name === "badges-vs-orb" ? "4" : "0.6", "-t", "8"];
    spawnSync(ffmpeg, ["-y", ...trim, "-i", webm, "-vf", `fps=12,scale=${Math.min(size.width, 560)}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`, gif], { stdio: "ignore" });
    if (existsSync(gif)) console.log("wrote", gif);
  }
}
const page = (body) => `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:radial-gradient(ellipse at 50% 30%,#1a1f45,#060812);color:#eef0ff;font:600 14px/1.3 system-ui,Segoe UI,sans-serif;height:100vh;overflow:hidden}
.grid{display:grid;grid-template-columns:repeat(4,190px);gap:10px 14px;justify-content:center;padding:18px}.c{text-align:center}.c small{display:block;opacity:.7;font-weight:500}</style>${body}`;

if (["all", "loop"].includes(ONLY)) await record("badges-loop", { width: 820, height: 690 }, async (p) => {
  const cells = [];
  for (const c of ["workout", "prayer", "art"]) for (const t of [1, 9, 14, 18]) cells.push(`<div class="c">${art.svg(c, t, { size: 180, mode: "full", title: false })}<small>${c === "workout" ? "Fitness" : c === "prayer" ? "Prayer" : "Creativity"} · tier ${t}</small></div>`);
  await p.setContent(page(`<div class="grid">${cells.join("")}</div>`));
  await p.waitForTimeout(12_000);
});

if (["all", "entrance"].includes(ONLY)) await record("badges-entrance", { width: 820, height: 380 }, async (p) => {
  const css = readFileSync(join(DESK, "public", "badges.css"), "utf8"), js = readFileSync(join(DESK, "public", "badges.js"), "utf8");
  await p.setContent(page(`<style>${css}.row{display:flex;justify-content:center;gap:50px;padding:40px 20px}.h{width:220px;height:220px}.c small{margin-top:14px}</style>
    <div class="row">${[["workout", 3], ["study", 12], ["worship", 18]].map(([c, t], i) => `<div class="c"><div class="h" id="h${i}"></div><small>tier ${t}</small></div>`).join("")}</div>`));
  await p.addScriptTag({ content: js });
  await p.waitForTimeout(700);
  const faces = [["workout", 3], ["study", 12], ["worship", 18]].map(([c, t]) => ({ front: art.svg(c, t, { size: 220, mode: "full", title: false }), back: art.back(c, t, { size: 220 }), tier: t, palette: art.PALETTES[c] }));
  await p.evaluate(async (faces) => { const E = { turns: [], duration: [] }; void E; for (let round = 0; round < 2; round++) { await Promise.all(faces.map((f, i) => new Promise((ok) => setTimeout(() => window.dsBadges.flip(document.getElementById("h" + i), f).then(ok), i * 350)))); await new Promise((r) => setTimeout(r, 2600)); } }, faces);
  await p.waitForTimeout(500);
});

if (["all", "orb"].includes(ONLY)) {
  // a throwaway copy of the display, only to show the idle orb (nothing heard, nothing opened on screen)
  const APP = join(TMP, "app"), PORT = 4796, BASE = `http://127.0.0.1:${PORT}`;
  spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
  spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
  mkdirSync(join(APP, "data"), { recursive: true });
  writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Casey", setupDone: true, display: "primary" }));
  const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_ECO: "1", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", ELEVENLABS_API_KEY: "", AI_PROVIDER: "none" };
  const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: "ignore", windowsHide: true });
  const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
  try {
    await record("badges-vs-orb", { width: 1100, height: 520 }, async (p) => {
      await p.addInitScript(() => { window.__dsAllowAutomatedListen = false; if (window.speechSynthesis) window.speechSynthesis.speak = () => {}; });
      await p.goto(`${BASE}/display`); await p.waitForTimeout(2500);
      if (await p.locator("#startBtn").isVisible().catch(() => false)) { await p.click("#startBtn"); await p.waitForTimeout(800); }
      const badge = art.svg("outdoors", 14, { size: 340, mode: "full", title: false });
      // the live orb canvas (tv.js keeps drawing it) moved into a clean stage, beside the badge
      await p.evaluate((b) => {
        const st = document.createElement("div");
        st.style.cssText = "position:fixed;inset:0;z-index:2147483647;isolation:isolate;display:flex;align-items:center;justify-content:center;gap:90px;background:radial-gradient(ellipse at 50% 40%,#161a3e,#05060f);color:#c9cfee;font:600 14px system-ui";
        const left = document.createElement("div"), right = document.createElement("div");
        left.style.cssText = right.style.cssText = "text-align:center";
        const viz = document.getElementById("viz"); viz.style.cssText = "width:340px;height:340px;transform:scale(2.4);transform-origin:center";
        left.appendChild(viz); left.insertAdjacentHTML("beforeend", "<div style='margin-top:8px'>Dayspring's orb, idle</div>");
        right.innerHTML = b + "<div style='margin-top:8px'>A badge in the detail view (tier 14)</div>";
        st.append(left, right); document.documentElement.appendChild(st);
      }, badge);
      await p.waitForTimeout(3000);
      if (process.env.DEBUG_ORB) { console.log("stage:", await p.evaluate(() => [document.querySelectorAll('[style*="2147483647"]').length, location.href, getComputedStyle(document.getElementById("viz")).display])); await p.screenshot({ path: join(OUT, "orb-debug.png") }); }
      await p.waitForTimeout(12_000);
    });
  } finally {
    server.kill(); await sleep(500);
    spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true });
  }
}
await browser.close();
rmSync(TMP, { recursive: true, force: true });
void MOTION;
