// The developer preview (docs/dev-preview.md): dev tokens, the routes, the badge gallery's "Preview all", the Personality
// lab, and that none of it shows (or leaks) anywhere but the developer's own computer. On a throwaway copy of the app
// (port 4798; Chrome headless and muted; nothing heard or opened on screen):
//   1. tokens: valid · forged · copied to another computer · missing · revoked (and a wrong purpose)
//   2. the 10-minute try reverts by itself; a real choice ends it; "unlock all" and "reset unlocks" (in-process)
//   3. without a token: every dev route 404s, no unearned art, names or secret names anywhere, no switch or lab on screen
//   4. with a token (signed by this computer's developer key, when it has one): everything works, previewing changes
//      nothing (ledger, badge records, seen flags, personality), "unlock all" is logged and reversible, voice commands
//   5. no dev token or private key anywhere in the source or the export; the privacy scan catches both
//   node scripts/qa/dev-preview.mjs [--keep]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { spawn, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as S from "../../lib/dev/status.mjs";
import { DEV_PUBLIC_KEYS } from "../../lib/dev/public-key.mjs";
import { hasKey, keyFile, loadKey, publicB64, signToken } from "../dev/keystore.mjs";
import { SECRETS } from "../../lib/persona/secrets.mjs";
import { PRESETS } from "../../lib/persona/presets.mjs";
import { NAMES, BADGE_IDS, thresholds } from "../../lib/xp/badges.mjs";
import { scan } from "../privacy-scan.mjs";

const DESK = resolve(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 4798, BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), "ds-devpreview-")), APP = join(TMP, "app");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, pass = 0, skipped = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" ? "  (" + got + ")" : ""}`); };
const skip = (name, why) => { skipped++; console.log(`SKIP  ${name}  (${why})`); };

// ---- 1. tokens -----------------------------------------------------------------------------------------------------------
{
  const { privateKey } = generateKeyPairSync("ed25519"), pub = publicB64(privateKey);
  const other = generateKeyPairSync("ed25519").privateKey;
  const tok = signToken(privateKey, { machine: "machine-a" });
  const v = (t, o = {}) => S.verifyToken(t, { machine: "machine-a", keys: [pub], revoked: [], ...o });
  check("token: a valid one verifies", v(tok).ok === true, JSON.stringify(v(tok)));
  check("token: forged (the payload changed after signing) fails", v({ ...tok, payload: { ...tok.payload, issued: "2030-01-01T00:00:00Z" } }).reason === "signature");
  check("token: forged (signed by another key) fails", v(signToken(other, { machine: "machine-a" })).reason === "signature");
  check("token: forged (a made-up signature) fails", v({ ...tok, sig: Buffer.alloc(64, 7).toString("base64") }).reason === "signature");
  check("token: copied to another computer fails", v(tok, { machine: "machine-b" }).reason === "machine");
  check("token: missing fails", v(null).reason === "missing" && v(undefined).reason === "missing");
  check("token: revoked fails", v(tok, { revoked: [tok.payload.id] }).reason === "revoked");
  check("token: a different purpose fails", v(signToken(privateKey, { machine: "machine-a", purpose: "something-else" })).reason === "purpose");
  check("token: no public key in the code means nobody is a developer", v(tok, { keys: [] }).reason === "no-key");
  // the file on disk: missing, damaged, another computer's
  const before = process.env.DAYSPRING_DEV_TOKEN;
  process.env.DAYSPRING_DEV_TOKEN = join(TMP, "nothing-here.json"); S._clear();
  check("status: no token file → not a developer", S.status().dev === false && S.status().reason === "missing" && S.isDev() === false);
  writeFileSync(join(TMP, "damaged.json"), "{not json"); process.env.DAYSPRING_DEV_TOKEN = join(TMP, "damaged.json"); S._clear();
  check("status: a damaged token file → not a developer", S.isDev() === false);
  if (hasKey() && DEV_PUBLIC_KEYS.length) {
    const key = loadKey();
    check("the developer key on this computer matches the public key in the code", DEV_PUBLIC_KEYS.includes(publicB64(key)));
    writeFileSync(join(TMP, "mine.json"), JSON.stringify(signToken(key, { machine: S.machineId() }))); process.env.DAYSPRING_DEV_TOKEN = join(TMP, "mine.json"); S._clear();
    check("status: a token signed for this computer → developer", S.isDev() === true);
    writeFileSync(join(TMP, "theirs.json"), JSON.stringify(signToken(key, { machine: createHash("sha256").update("someone else's computer").digest("hex") }))); process.env.DAYSPRING_DEV_TOKEN = join(TMP, "theirs.json"); S._clear();
    check("status: the developer's token for ANOTHER computer, copied here → not a developer", S.isDev() === false && S.status().reason === "machine");
  } else skip("status with this computer's developer key", "no developer key on this computer (scripts/dev/make-dev-token.mjs)");
  if (before === undefined) delete process.env.DAYSPRING_DEV_TOKEN; else process.env.DAYSPRING_DEV_TOKEN = before; S._clear();
}

// ---- 2. the personality side, in-process (a fake clock and store) -------------------------------------------------------
{
  const P = await import("../../lib/persona/index.mjs");
  let store = null, clock = Date.parse("2026-09-27T15:00:00");
  P.setDeps({ load: () => store, save: (s) => { store = JSON.parse(JSON.stringify(s)); }, now: () => clock, name: () => "Sam", xp: false });
  P._reset();
  const snap = () => JSON.stringify(store);
  P.setSlider("base", "humour", 40); const s0 = snap();
  const st = P.stateFor("caveman"); P.phraseAs(st, "greeting", { seed: "x" }); P.styleAs(st, "Your pasta timer is done.", { kind: "timerDone" }); P.devCharacters();
  check("previewing a character (even an unfound secret) changes nothing", snap() === s0);
  const t = P.devTry("caveman");
  check("try: wears the character now, without finding or unlocking it", P.get().preset === "caveman" && !P.get().discovered.caveman && !P.get().unlocked.caveman && t.msLeft === 10 * 60_000, JSON.stringify(t));
  clock += 9 * 60_000; check("try: still on after 9 minutes", P.get().preset === "caveman");
  clock += 60_000 + 1; const back = P.get();
  check("try: after 10 minutes it goes back to exactly what was on", back.preset === "default" && back.base.humour === 40 && !back.devTrial && P.devTrial() === null, `${back.preset} humour ${back.base.humour}`);
  P.devTry("cowboy"); P.selectPreset("pirate"); clock += 11 * 60_000;
  check("try: a real choice during a try ends it and sticks", P.get().preset === "pirate" && !P.get().devTrial);
  P.devTry("viking"); P.devEndTrial();
  check("try: End now goes back at once", P.get().preset === "pirate" && !P.get().devTrial);
  // a real find and unlock stays through unlock-all and reset
  store = { ...store, discovered: { cat: { at: "2026-09-01T00:00:00Z", how: "phrase" } }, unlocked: { cat: { at: "2026-09-01T00:00:00Z", cost: 700 } } };
  const u = P.devUnlockAll();
  check("Dev: unlock all → every secret found and unlocked, marked as testing", u.added.length === SECRETS.length - 1 && SECRETS.every((x) => P.get().unlocked[x.id]) && P.get().unlocked.caveman.dev === true && !P.get().unlocked.cat.dev);
  P.selectPreset("caveman");
  const r = P.devResetUnlocks();
  const after = P.get();
  check("Dev: reset unlocks → takes back exactly the testing ones (the real one stays)", r.removed.length === SECRETS.length - 1 && after.unlocked.cat?.cost === 700 && after.discovered.cat && !after.unlocked.caveman && !after.discovered.caveman && after.preset === "default");
  P._reset();
}

// ---- 3 & 4. the app (a throwaway copy) ------------------------------------------------------------------------------------
spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(join(APP, "data"), { recursive: true });
writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Casey", setupDone: true, display: "primary" }));
const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString("en-CA"); };
const lines = []; let lid = 0, credit = 0;
for (let n = 12; credit < thresholds("workout")[1] + 5; n--) { lines.push(JSON.stringify({ id: `seed${lid++}`, at: `${day(n)}T07:30:00`, day: day(n), type: "award", amount: 22, category: "workout", source: "block", evidence: "ran for 30 minutes", fp: null, title: "" })); credit += 22; }
writeFileSync(join(APP, "data", "xp-ledger.jsonl"), lines.join("\n") + "\n");
const DATA = join(APP, "data");
const hashOf = (f) => { try { return createHash("sha256").update(readFileSync(join(DATA, f))).digest("hex"); } catch { return "none"; } };
const personaOf = () => { try { return JSON.stringify(JSON.parse(readFileSync(join(DATA, "owner.json"), "utf8")).persona ?? null); } catch { return "none"; } };
const state = () => ({ ledger: hashOf("xp-ledger.jsonl"), badges: hashOf("xp-badges.json"), settings: hashOf("xp-settings.json"), persona: personaOf() });

let server = null, serverLog = "";
async function start(tokenFile) {
  const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_ECO: "1",
    ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", ELEVENLABS_API_KEY: "", AI_PROVIDER: "none", TTS_PROVIDER: "browser", DAYSPRING_DEV_TOKEN: tokenFile };
  server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
  const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
  await sleep(2500);                                             // the startup sync of badges
}
async function stop() { if (!server) return; server.kill(); await new Promise((r) => { server.once("exit", r); setTimeout(r, 4000); }); server = null; await sleep(400); }
const get = (p) => fetch(BASE + "/api" + p);
const post = (p, body = {}) => fetch(BASE + "/api" + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const json = async (r) => r.json().catch(() => ({}));
const chat = async (message) => json(await post("/chat", { message, surface: "tv", typed: true }));
const SECRETS_NAMES = SECRETS.map((x) => x.name);
const undiscoveredNames = (text) => SECRETS.filter((x) => text.includes(`"${x.name}"`) || text.includes(x.name + ",") || text.includes(x.name + ".")).map((x) => x.name);

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
const page = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { window.__dsAllowAutomatedListen = false; if (window.speechSynthesis) window.speechSynthesis.speak = () => {}; });
  const p = await ctx.newPage(); p.errors = []; p.on("pageerror", (e) => p.errors.push(e.message)); return p;
};
try {
  // ---- 3. not a developer computer ----
  await start(join(TMP, "no-token-here.json"));
  for (const [m, path] of [["GET", "/dev/status"], ["GET", "/dev/persona/characters"], ["POST", "/dev/persona/unlock-all"], ["POST", "/dev/persona/reset-unlocks"], ["POST", "/dev/persona/try"]]) {
    const r = m === "GET" ? await get(path) : await post(path, { id: "caveman" });
    check(`no token: ${m} ${path} → 404`, r.status === 404, String(r.status));
  }
  check("no token: /xp/badges?dev=1 → 404", (await get("/xp/badges?dev=1")).status === 404);
  check("no token: unearned art refused, with or without dev=1", (await get("/xp/badge.svg?cat=reading&tier=18&dev=1")).status === 404 && (await get("/xp/badge.svg?cat=reading&tier=1")).status === 404);
  check("no token: earned art still served", (await get("/xp/badge.svg?cat=workout&tier=1")).status === 200);
  check("no token: /persona/preview {id} → 404 (the plain preview still works)", (await post("/persona/preview", { id: "caveman" })).status === 404 && (await post("/persona/preview", { id: "cowboy" })).status === 404 && Boolean((await json(await post("/persona/preview", {}))).reply));
  const pv = await (await get("/persona")).text();
  check("no token: /persona names no secret character that hasn't been found", !undiscoveredNames(pv).length, undiscoveredNames(pv).join(", "));
  const bv = await (await get("/xp/badges")).text(), bvj = JSON.parse(bv);
  const unearned = BADGE_IDS.flatMap((c) => NAMES[c].map((nm, i) => ({ c, i, nm }))).filter(({ c, i }) => !bvj.categories.find((x) => x.cat === c).tiers[i].key);
  const leakedNames = unearned.filter(({ nm }) => bv.includes(`"${nm}"`)).map((x) => x.nm);
  check("no token: /xp/badges names no badge that isn't earned", !leakedNames.length && unearned.length > 300, leakedNames.slice(0, 5).join(", "));
  const v1 = await chat("show me all the badges"), v2 = await chat("preview the running badges"), v3 = await chat("let me hear the cowboy voice"), v4 = await chat("preview the secret characters");
  check("no token: the dev voice commands do nothing special", ![v1, v2, v3, v4].some((r) => /preview|lab/.test(String(r.show ?? "")) || r.devVoice || r.intent === "dev"), JSON.stringify([v1.show, v2.show, v3.show, v4.show]));
  check("no token: no secret names in what's said", !undiscoveredNames(JSON.stringify([v1.reply, v2.reply, v3.reply, v4.reply])).length);
  {
    const p = await page();
    await p.goto(`${BASE}/progress?preview=1#badges`); await p.waitForSelector(".bshelf", { timeout: 10_000 }); await p.waitForTimeout(800);
    const g = await p.evaluate(() => ({ toggle: Boolean(document.getElementById("bPreview")), previews: document.querySelectorAll(".bcard.preview").length, dev: [...document.querySelectorAll("img")].some((i) => /dev=1/.test(i.src)), banner: Boolean(document.querySelector(".bdev-banner")) }));
    check("no token: the gallery has no Preview switch, preview cards or dev art (even with ?preview=1)", !g.toggle && !g.previews && !g.dev && !g.banner, JSON.stringify(g));
    await p.goto(`${BASE}/setup?s=personality&lab=secrets`); await p.waitForSelector("#ps-secrets", { timeout: 10_000 }); await p.waitForTimeout(1500);
    const lab = await p.evaluate(() => ({ lab: Boolean(document.getElementById("ps-lab")), text: document.body.innerText }));
    check("no token: Settings → Personality has no lab and names no unfound secret", !lab.lab && !SECRETS_NAMES.some((n) => lab.text.includes(n)), String(lab.lab));
    check("no token: no page errors", !p.errors.length, p.errors.join(" | "));
    await p.context().close();
  }
  await stop();

  // ---- 4. the developer's computer ----
  if (!(hasKey() && DEV_PUBLIC_KEYS.length)) skip("the developer's side (routes, UI, voice)", "no developer key on this computer");
  else {
    const tokFile = join(TMP, "dev-token-test.json");
    writeFileSync(tokFile, JSON.stringify(signToken(loadKey(), { machine: S.machineId() })));
    await start(tokFile);
    const st = await get("/dev/status");
    check("token: /dev/status answers", st.status === 200 && (await json(st)).dev === true);
    const s0 = state();
    const dv = await json(await get("/xp/badges?dev=1"));
    const tiers = dv.categories.flatMap((c) => c.tiers), prev = tiers.filter((t) => t.preview), earned = tiers.filter((t) => t.state === "earned");
    check("token: /xp/badges?dev=1 has every tier: earned as they are, the rest with name, description and a sample citation", tiers.length === 324 && earned.length >= 2 && prev.length === 324 - earned.length && prev.every((t) => t.name && t.description && /^Casey .+ on .+!$/.test(t.sampleCitation)), `${prev.length} previews; ${prev[0]?.sampleCitation}`);
    check("token: earned tiers are unchanged in the preview", earned.every((t) => t.citation && t.at && !t.preview));
    const svg = await get("/xp/badge.svg?cat=reading&tier=18&mode=full&size=200&dev=1");
    check("token: unearned art with dev=1 → the SVG", svg.status === 200 && /svg/.test(svg.headers.get("content-type") ?? "") && /<svg/.test(await svg.text()));
    check("token: …and still refused without dev=1", (await get("/xp/badge.svg?cat=reading&tier=18")).status === 404);
    check("token: the back of an unearned badge too", (await get("/xp/badge.svg?cat=reading&tier=18&face=back&dev=1")).status === 200);
    const ch = await json(await get("/dev/persona/characters"));
    check("token: the lab lists every character, every secret (found or not) and the easter egg", ch.characters.length === PRESETS.length + SECRETS.length + 1 && SECRETS.every((x) => ch.characters.some((c) => c.name === x.name)) && ch.characters.some((c) => c.kind === "easter"));
    const cv = await json(await post("/persona/preview", { id: "caveman" }));
    const egg = await json(await post("/persona/preview", { id: "sage", role: { light: 80, wise: 90, ancient: 95, peaceful: 70 } }));
    const sand = await json(await post("/persona/preview", { id: "cowboy", base: { humour: 100, energy: 100 } }));
    check("token: /persona/preview {id} → that character's lines (a secret, the easter egg, the sandbox)", cv.dev && cv.id === "caveman" && cv.greeting && egg.sage === true && sand.id === "cowboy" && sand.greeting, `${cv.greeting} | ${egg.greeting}`);
    check("token: /persona itself still names no unfound secret", !undiscoveredNames(await (await get("/persona")).text()).length);
    const s1 = state();
    check("token: previewing changed nothing (ledger, badge records and seen flags, XP settings, personality)", JSON.stringify(s0) === JSON.stringify(s1), JSON.stringify({ s0, s1 }).slice(0, 300));
    // voice
    const a1 = await chat("show me all the badges"), a2 = await chat("preview the running badges"), a3 = await chat("let me hear the cowboy voice"), a4 = await chat("preview the secret characters");
    check("voice: \"show me all the badges\" → the gallery in preview", a1.show === "badges:preview", String(a1.show));
    check("voice: \"preview the running badges\" → Fitness in preview", a2.show === "badges:preview:workout", String(a2.show));
    check("voice: \"let me hear the cowboy voice\" → the Cowboy's lines in its voice", a3.devVoice?.text && /Cowboy/.test(a3.reply) && a3.devVoice.edge === "Guy", JSON.stringify({ reply: a3.reply, dv: a3.devVoice }).slice(0, 300));
    check("voice: \"preview the secret characters\" → the lab, secrets first", a4.show === "personality:lab:secrets" && SECRETS.every((x) => a4.reply.includes(x.name)));
    check("voice: none of it changed the personality", (JSON.parse(readFileSync(join(DATA, "owner.json"), "utf8")).persona?.preset ?? "default") === "default");
    // the gallery, in a real (headless) browser
    const s2 = state();
    {
      const p = await page();
      await p.goto(`${BASE}/progress?preview=1#badges`); await p.waitForSelector(".bcard.preview", { timeout: 10_000 }); await p.waitForTimeout(1200);
      const g = await p.evaluate(() => ({ toggle: document.getElementById("bPreview")?.checked, previews: document.querySelectorAll(".bcard.preview").length, earned: document.querySelectorAll(".bshelf .bcard.earned").length,
        ribbon: document.querySelector(".bcard.preview .bribbon")?.textContent ?? "", ribbonOnArt: Boolean(document.querySelector(".bart .bribbon")), plays: document.querySelectorAll(".bcard.preview .bplay").length, banner: Boolean(document.querySelector(".bdev-banner")),
        img: (() => { const i = document.querySelector(".bcard.preview img"); return i ? { src: i.getAttribute("src"), w: i.naturalWidth } : null; })() }));
      check("UI: Preview all is on, every unearned badge is a preview card with a play button", g.toggle === true && g.previews === prev.length && g.plays === prev.length && g.banner, JSON.stringify({ t: g.toggle, n: g.previews, p: g.plays }));
      check("UI: marked \"Preview · not earned\" in the card's frame (not on the art)", /Preview · not earned/.test(g.ribbon) && !g.ribbonOnArt, g.ribbon);
      check("UI: the preview card shows the real art", g.img && /dev=1/.test(g.img.src) && g.img.w > 0, JSON.stringify(g.img));
      const flips0 = await p.evaluate(() => window.__dsBadgeFlips ?? 0);
      await p.click(".bcard.preview >> nth=0"); await p.waitForSelector(".bdlg.bpreview .bflip", { timeout: 6000 });
      const anim = await p.evaluate(() => ({ running: document.querySelector(".bdlg.bpreview .bflip-coin")?.getAnimations().length ?? 0, svg: Boolean(document.querySelector(".bdlg.bpreview .bfront svg")), text: document.querySelector(".bdlg.bpreview")?.innerText ?? "" }));
      check("UI: a preview up close: the coin-flip animation with the full art, name, description and a SAMPLE citation", anim.running > 0 && anim.svg && /Sample/i.test(anim.text) && /Casey/.test(anim.text) && /Preview · not earned/i.test(anim.text), JSON.stringify({ r: anim.running, s: anim.svg }));
      await p.waitForTimeout(2500);
      await p.click(".bdlg.bpreview .bplay-big"); await p.waitForSelector(".brev.preview", { timeout: 6000 }); await p.waitForTimeout(400);
      const rev = await p.evaluate(() => ({ text: document.querySelector(".brev.preview")?.innerText ?? "", svg: Boolean(document.querySelector(".brev.preview .bfront svg")), flips: window.__dsBadgeFlips ?? 0 }));
      check("UI: Play reveal animation → the award reveal, marked as a preview", rev.svg && /Dev preview/i.test(rev.text) && /Preview · not earned/i.test(rev.text) && rev.flips >= flips0 + 2, JSON.stringify({ flips: rev.flips, from: flips0 }));
      await p.click(".brev.preview .brev-ok"); await p.waitForTimeout(500);
      await p.keyboard.press("Escape"); await p.waitForTimeout(300);
      const s3 = state();
      check("previewing in the gallery changed nothing (ledger, badge records and seen flags)", s2.ledger === s3.ledger && s2.badges === s3.badges && s2.persona === s3.persona, JSON.stringify({ s2: s2.badges.slice(0, 8), s3: s3.badges.slice(0, 8) }));
      await p.uncheck("#bPreview"); await p.waitForTimeout(1200);             // (the normal gallery then marks new badges seen, as always)
      const off = await p.evaluate(() => ({ previews: document.querySelectorAll(".bcard.preview").length, locked: document.querySelectorAll(".bcard.locked").length, dev: [...document.querySelectorAll(".bshelf img")].some((i) => /dev=1/.test(i.src)) }));
      check("UI: turning Preview all off → the normal gallery (locked cards, no dev art)", off.previews === 0 && off.locked > 0 && !off.dev, JSON.stringify(off));
      check("UI (gallery): no page errors", !p.errors.length, p.errors.join(" | "));
      await p.context().close();
    }
    // the Personality lab
    {
      const p = await page();
      await p.goto(`${BASE}/setup?s=personality&lab=secrets`); await p.waitForSelector("#ps-lab .ps-card.lab", { timeout: 10_000 }); await p.waitForTimeout(600);
      const L = await p.evaluate(() => ({ cards: document.querySelectorAll("#ps-lab .ps-card.lab").length, text: document.getElementById("ps-lab").innerText, filter: document.getElementById("ps-lab-filter").value }));
      check("lab: shown to the developer, secrets first, every one by name, marked Dev preview", L.filter === "secret" && L.cards === SECRETS.length && SECRETS.every((x) => L.text.includes(x.name)) && /Dev preview/i.test(L.text), `${L.cards} cards`);
      const personaBefore = personaOf();
      await p.click('#ps-lab [data-lab-open="caveman"]'); await p.waitForFunction(() => (document.getElementById("ps-lab-lines")?.innerText ?? "").length > 20, null, { timeout: 6000 });
      await p.evaluate(() => { const el = document.querySelector('#ps-lab input[data-lab-kind="base"][data-lab-id="humour"]'); el.value = "100"; el.dispatchEvent(new Event("input", { bubbles: true })); });
      await p.waitForTimeout(900);
      const hear = await p.evaluate(async () => { const t0 = performance.now(); document.querySelector('#ps-lab [data-lab="hear"]').click(); await new Promise((r) => setTimeout(r, 800)); return performance.now() - t0; });
      check("lab: lines, the slider sandbox and Hear leave the personality alone", personaOf() === personaBefore && hear > 0);
      check("lab: no page errors", !p.errors.length, p.errors.join(" | "));
      await p.context().close();
    }
    // try, unlock all, reset (and the activity log)
    const tr = await json(await post("/dev/persona/try", { id: "caveman" }));
    const pv1 = await json(await get("/persona"));
    check("try: switches to it for 10 minutes without finding or unlocking it", tr.trial?.id === "caveman" && pv1.preset === "caveman" && pv1.secrets.found === 0 && pv1.secrets.unlockedCount === 0 && tr.trial.msLeft > 9 * 60_000);
    await post("/dev/persona/try/end", {});
    check("try: End now → back to what was on", (await json(await get("/persona"))).preset === "default");
    const ua = await json(await post("/dev/persona/unlock-all", {}));
    check("Dev: unlock all → every secret unlocked (no XP)", ua.view?.secrets?.unlockedCount === SECRETS.length && state().ledger === s0.ledger);
    const rs = await json(await post("/dev/persona/reset-unlocks", {}));
    check("Dev: reset unlocks → back to none", rs.view?.secrets?.unlockedCount === 0 && rs.view?.secrets?.found === 0);
    const logDir = join(DATA, "logs", "activity"), logText = existsSync(logDir) ? readdirSync(logDir).map((f) => readFileSync(join(logDir, f), "utf8")).join("\n") : "";
    const devLines = logText.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e?.kind === "dev");
    check("the activity log has unlock all, reset unlocks and the try", ["persona.unlock-all", "persona.reset-unlocks", "persona.try"].every((a) => devLines.some((e) => e.action === a)), devLines.map((e) => e.action).join(", "));
    await stop();
  }
} finally {
  await stop().catch(() => {});
  await browser.close().catch(() => {});
}

// ---- 5. no token or private key anywhere in the source or the export ---------------------------------------------------------
{
  const SKIP = new Set(["node_modules", ".git", "data", "backups", "dist-out"]);
  const walk = function* (dir) { for (const e of readdirSync(dir, { withFileTypes: true })) { if (SKIP.has(e.name) || e.isSymbolicLink()) continue; const f = join(dir, e.name); if (e.isDirectory()) yield* walk(f); else if (e.isFile()) yield f; } };
  const named = [], found = [];
  const needles = [/-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/, /MC4CAQAwBQYDK2VwBCIEI[A-Za-z0-9+/]{20,}/];
  let exact = [];
  if (hasKey()) { const k = loadKey(), der = k.export({ format: "der", type: "pkcs8" }); exact = [der.toString("base64"), der.subarray(16).toString("base64"), der.subarray(16).toString("hex"), der.subarray(16).toString("base64url")]; }
  for (const root of [DESK, APP]) for (const f of walk(root)) {
    if (/^dev-(token|key)(\.|$)/i.test(f.split(sep).pop())) named.push(relative(root, f));
    if (statSync(f).size > 8_000_000) continue;
    const t = readFileSync(f).toString("latin1");
    if (needles.some((r) => r.test(t)) || exact.some((x) => t.includes(x))) found.push(relative(root, f));
  }
  check("no dev token or dev key file in the source or the export", !named.length, named.join(", "));
  check(`no private key (any, or this computer's${exact.length ? "" : ": none here"}) in the source or the export`, !found.length, found.join(", "));
  check("the developer key is kept outside the app", !resolve(keyFile()).toLowerCase().startsWith(DESK.toLowerCase()) && !resolve(S.tokenPath()).toLowerCase().startsWith(DESK.toLowerCase()));
  // the privacy scan (run by every export and release) catches both
  const T = join(TMP, "scan"); mkdirSync(T, { recursive: true });
  writeFileSync(join(T, "dev-token.json"), "{}");
  const fake = generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  writeFileSync(join(T, "notes.txt"), `oops ${fake}\n`);
  const hits = scan(T, { dataDir: join(TMP, "nodata") });
  check("the privacy scan fails a dev token file and a private key", hits.some((h) => h.level === "fail" && /Developer token/.test(h.what)) && hits.some((h) => h.level === "fail" && /private key/i.test(h.what)), hits.map((h) => h.what).join(", "));
}

if (!process.argv.includes("--keep")) rmSync(TMP, { recursive: true, force: true }); else console.log(`kept ${TMP}`);
if (fail && serverLog) console.log(serverLog.slice(-2500));
console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ""}`);
process.exit(fail ? 1 : 0);
