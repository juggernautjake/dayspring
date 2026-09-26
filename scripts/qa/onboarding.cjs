// The guided setup (/welcome), walked end to end as a brand-new user ("Sam") in a headless browser.
// The guide's voice is replaced with a silent recorder; installs, sign-ins, device changes and key checks are mocked,
// so nothing is installed, signed in to, switched or paid for. Run it only against a throwaway copy (qa-fresh-install.mjs).
//   node scripts/qa/onboarding.cjs [none|claude] [1280x720|390x844]
//   env: QA_BASE (http://127.0.0.1:4731), QA_OUT (folder for screenshots + results), QA_APP (the copy's folder)
// Exit code: 0 when every check passed, 1 otherwise.
const path = require("path"), fs = require("fs");
const APP = process.env.QA_APP || path.join(__dirname, "..", "..");
const { chromium } = require(require.resolve("playwright-core", { paths: [APP] }));
const BASE = process.env.QA_BASE || "http://127.0.0.1:4731";
const route = process.argv[2] || "claude";                  // "claude" | "none"
const [W, H] = (process.argv[3] || "1280x720").split("x").map(Number);
const OUT = path.join(process.env.QA_OUT || path.join(APP, "qa-out"), `onboarding-${route}-${W}`) + path.sep;
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const rec = (area, ok, note = "") => { results.push({ area, ok: !!ok, note: String(note) }); console.log(`${ok ? "PASS" : "FAIL"}  [${route} ${W}] ${area}${note ? " — " + String(note).slice(0, 160) : ""}`); };
const launch = async () => { for (const channel of [process.env.QA_BROWSER || "chrome", "msedge"]) { try { return await chromium.launch({ channel, headless: true, args: ["--mute-audio"] }); } catch {} } throw new Error("Couldn't start Chrome or Edge for the browser checks."); };

(async () => {
  const b = await launch();
  const p = await (await b.newContext({ viewport: { width: W, height: H } })).newPage();
  const errors = [], calls = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/i.test(m.text())) errors.push("console: " + m.text().slice(0, 200)); });
  // silent guide: fire start/end like a real voice
  await p.addInitScript(() => {
    const fake = { speaking: false, paused: false, pending: false,
      getVoices: () => [{ name: "Microsoft Andrew Online (Natural) - English (United States)", lang: "en-US" }, { name: "Microsoft Aria Online (Natural) - English (United States)", lang: "en-US" }],
      speak(u) { setTimeout(() => { u.onstart?.(); setTimeout(() => u.onend?.(), 30); }, 5); }, cancel() {}, pause() {}, resume() {}, addEventListener() {} };
    Object.defineProperty(window, "speechSynthesis", { value: fake });
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  });
  const mock = (url, body) => p.route(url, (r) => { calls.push(new URL(r.request().url()).pathname); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(typeof body === "function" ? body(r) : body) }); });
  await mock("**/api/setup/ai/test", { ok: true, text: "ready", ms: 1200 });
  await mock("**/api/setup/ai", (r) => ({ ok: true, ai: { provider: JSON.parse(r.request().postData() || "{}").provider, ready: true, label: "Claude (Anthropic)" } }));
  await mock("**/api/cli/install", { id: "job1", state: "running", log: ["Downloading…"] });
  await mock("**/api/cli/job?*", { id: "job1", state: "done", log: ["Installed"] });
  await mock("**/api/cli/login", { ok: true, opened: true });
  await mock("**/api/voicemeeter/install", { id: "vm1", state: "running", log: ["Finding the official package…"] });
  await mock("**/api/voicemeeter/job?*", { id: "vm1", state: "done", log: ["Installed"] });
  await mock("**/api/devices/use", { ok: true, said: ["(mocked)"] });
  await mock("**/api/media/login", { ok: true });
  await mock("**/api/player/spotify/login", { url: "https://accounts.spotify.com/" });
  await mock("**/api/connect/*/start", { url: "https://example.invalid/oauth", opened: true });
  const shot = async (name) => { await p.waitForTimeout(350); await p.screenshot({ path: `${OUT}${name}.png` }); const ov = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (ov > 1) errors.push(`page is ${ov}px too wide on "${name}"`); };
  const step = async () => (await p.textContent("#stepname")).trim();
  const next = async () => { await p.click("#next"); await p.waitForTimeout(700); };
  const msg = async () => (await p.textContent("#m").catch(() => "")) || "";

  await p.goto(`${BASE}/welcome`, { waitUntil: "load" }); await p.waitForTimeout(1200);
  rec("welcome opens and the guide talks", (await p.textContent("#caption")).trim().length > 20, await step()); await shot("01-welcome");
  await p.click("#gMute"); const muted = await p.getAttribute("#gMute", "aria-pressed"); await p.click("#gMute");
  await p.click("#gRepeat"); rec("mute and repeat buttons", muted === "true" && (await p.textContent("#caption")).length > 20);
  await next();
  await next(); rec("a name is required", /name/i.test(await msg()), await msg());
  await p.fill("#name", "Sam"); await p.fill("#nickIn", "Sammy"); await p.click("#nickAdd"); await p.fill("#nickIn", "Champ"); await p.press("#nickIn", "Enter");
  const nicks = await p.$$eval("#nicks .chip", (c) => c.map((x) => x.dataset.n)); rec("nicknames (button and Enter)", nicks.length === 2, nicks.join(", ")); await shot("02-you");
  await next(); await shot("03-ai");
  if (route === "none") {
    await p.click('[data-ai="none"]'); await next(); await shot("04-scheduler"); await next();
  } else {
    await p.click('[data-ai="anthropic"]'); await next();
    const steps = await p.locator(".walk li").count(), links = await p.locator(".walk a").count();
    rec("AI key walkthrough", steps >= 3 && links >= 1, `${steps} steps, ${links} links`); await shot("04-aikey");
    await next(); rec("can't continue without a key", /paste/i.test(await msg()), await msg());
    await p.fill("#aiKey", "sk-ant-test-key-not-real"); await p.click("#aiTest"); await p.waitForTimeout(700);
    rec("key test shows a result", (await msg()).trim().length > 3, (await msg()).trim()); await shot("05-aikey-ok"); await next();
    await p.click('[data-vt="elevenlabs"]'); await p.waitForTimeout(300); rec("ElevenLabs walkthrough", (await p.locator("#vpane .walk li").count()) >= 3); await shot("06-voice-eleven");
    await p.click('[data-vt="browser"]'); await p.waitForTimeout(300); await p.locator("#vlist .voice").first().click(); await shot("06-voice-free"); await next();
  }
  await p.fill("#wake", "06:30"); await p.click("#workSw"); await p.fill("#place", "Denver"); await p.click("#find"); await p.waitForTimeout(2500);
  const pl = await p.locator("[data-p]").count(); if (pl) await p.locator("[data-p]").first().click();
  rec("week and place search", pl > 0, `${pl} places found (needs internet)`); await shot("07-week"); await next();
  await p.waitForTimeout(600);
  let picked = 0; for (const id of ["fitness", "reading", "music"]) { const c = p.locator(`#groups [data-i="${id}"]`); if (await c.count()) { await c.first().click(); picked++; } }
  if (await p.locator("#interestFree, #freeInterest, [data-free] input, input[name=interest]").count()) { const f = p.locator("#interestFree, #freeInterest, [data-free] input, input[name=interest]").first(); await f.fill("birdwatching"); await f.press("Enter"); }
  await p.waitForTimeout(700); const sugg = await p.locator("#sugg input").count(); if (sugg) await p.locator("#sugg input").first().check();
  rec("interests and suggested routines", picked === 3, `${picked} picked, ${sugg} routines suggested`); await shot("08-interests"); await next();
  await p.waitForTimeout(800);
  await p.click('[data-pm="custom"]'); await p.waitForTimeout(1200);
  const q = await p.locator("[data-qa]").count(); if (q) await p.locator("[data-qa]").first().click();
  await p.locator("#tree .node .nm").first().click().catch(() => {}); await p.waitForTimeout(1000);
  const nodes = await p.locator("#tree .node").count(); if (nodes) await p.locator("#tree .node input").first().check().catch(() => {});
  rec("permissions: pick folders", q > 0 && nodes > 0 && (await p.textContent("#psum")).trim().length > 10, `${q} quick picks, ${nodes} folders`);
  await shot("09-permissions"); await next();
  if (route !== "none") { await p.waitForTimeout(1500); if (await p.locator("#cliInstall").count()) { await p.click("#cliInstall"); await p.waitForTimeout(2500); } await shot("10-cli"); await next(); }
  await p.waitForTimeout(1500);
  const apps = await p.locator(".app").count(); await p.click('[data-conn="notion"]'); await p.waitForTimeout(400);
  rec("apps and a connection walkthrough", apps >= 4 && (await p.locator("#appDrawer .walk li").count()) >= 3, `${apps} apps`); await shot("11-apps"); await next();
  await p.waitForSelector("[data-out]", { timeout: 15000 }).catch(() => {});   // listing sound devices can take a few seconds
  rec("sound step lists devices", (await p.locator("[data-out]").count()) > 0, `${await p.locator("[data-out]").count()} outputs, ${await p.locator("[data-mic]").count()} mics`);
  await shot("12-sound"); await next();
  await p.waitForTimeout(1500); await shot("13-screen"); await next();
  const sum = (await p.textContent(".sumlist").catch(() => "")).replace(/\s+/g, " ");
  rec("summary shows the choices", /Sam/.test(sum), sum.slice(0, 160)); await shot("14-done");
  const st = await (await fetch(`${BASE}/api/welcome/state`)).json(); rec("progress is saved (resume)", st.step !== undefined && st.step !== null && Object.keys(st.done ?? {}).length > 3, `step ${st.step}`);
  // resume: reopening the page lands on the same step, not the start
  const here = await step(); await p.reload({ waitUntil: "load" }); await p.waitForTimeout(1200);
  rec("reopening resumes where you were", (await step()) === here, `${here} → ${await step()}`);
  await p.click("#next"); await p.waitForTimeout(1500);
  const done = (await (await fetch(`${BASE}/api/setup/state`)).json()).owner?.setupDone;
  rec("finish opens the Dayspring screen", /\/display/.test(p.url()) && done, p.url());
  rec("no page errors", !errors.length, errors.slice(0, 5).join(" | ") || "none");
  fs.writeFileSync(OUT + "results.json", JSON.stringify({ route, width: W, results, mocked: [...new Set(calls)] }, null, 2));
  await b.close();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(`FAIL  [${route} ${W}] the walk stopped: ${e.message.split("\n")[0]}`); process.exit(1); });
