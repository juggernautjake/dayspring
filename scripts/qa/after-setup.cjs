// After setup, as a new user in free mode (no AI): the Dayspring screen, every Settings section, every Help page,
// typed commands, and the features that need something set up first (they should explain, not break).
// Nothing is installed, played on a device, or signed in to. Run it only against a throwaway copy (qa-fresh-install.mjs).
//   node scripts/qa/after-setup.cjs
//   env: QA_BASE, QA_OUT, QA_APP (the copy's folder), QA_HOME (the test user's home: a sample document goes in Documents)
// Exit code: 0 when every check passed, 1 otherwise.
const path = require("path"), fs = require("fs");
const APP = process.env.QA_APP || path.join(__dirname, "..", "..");
const { chromium } = require(require.resolve("playwright-core", { paths: [APP] }));
const BASE = process.env.QA_BASE || "http://127.0.0.1:4731";
const OUT = path.join(process.env.QA_OUT || path.join(APP, "qa-out"), "after-setup") + path.sep;
fs.mkdirSync(OUT, { recursive: true });
const J = async (u, o) => { const r = await fetch(BASE + u, o); const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; } };
const chat = async (m) => String((await J("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: m, surface: "desk" }) })).body.reply ?? "(no reply)");
const results = [];
const rec = (area, ok, note = "") => { results.push({ area, ok: !!ok, note: String(note) }); console.log(`${ok ? "PASS" : "FAIL"}  ${area} — ${String(note).slice(0, 170)}`); };
// words a new user shouldn't see in a reply or on a settings page (product names like "API key" are fine there)
const JARGON = /\b(route|endpoint|SSE|stack trace|undefined|NaN|ECONN\w*|ENOENT|EACCES|TypeError|ReferenceError|status [45]\d\d|404|500|JSON|\/api\/\w+)\b/;
const launch = async () => { for (const channel of [process.env.QA_BROWSER || "chrome", "msedge"]) { try { return await chromium.launch({ channel, headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] }); } catch {} } throw new Error("Couldn't start Chrome or Edge for the browser checks."); };

(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  const watch = (p, tag) => { p.on("pageerror", (e) => errs.push(`${tag}: ${e.message}`)); p.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource|net::ERR/i.test(m.text())) errs.push(`${tag} console: ${m.text().slice(0, 160)}`); }); };
  // block anything that would change devices, install software, or sign in anywhere
  await ctx.route(/\/api\/(devices\/use|cli\/install|voicemeeter\/install|tunein\/install|media\/login|player\/spotify\/login|window)$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"mocked":true}' }));

  // 1. the Dayspring screen
  const d = await ctx.newPage(); watch(d, "screen");
  await d.goto(BASE + "/display", { waitUntil: "load" }); await d.waitForTimeout(3500);
  if (await d.locator("#startBtn").isVisible().catch(() => false)) { await d.click("#startBtn"); await d.waitForTimeout(1500); }
  const dispText = await d.evaluate(() => document.body.innerText);
  rec("Dayspring screen loads", !/undefined|NaN|\[object Object\]/.test(dispText) && d.url().endsWith("/display"), d.url());
  await d.screenshot({ path: OUT + "display.png" });
  const hid = await d.evaluate(() => ({ exam: getComputedStyle(document.querySelector("#examCard") ?? document.body).display === "none" || document.querySelector("#examCard")?.hidden, dots: [...document.querySelectorAll("#showDots i")].map((i) => i.dataset.jump).join(",") }));
  rec("new user sees no study or faith panels", hid.exam !== false && !/memory|prayer/.test(hid.dots), `slides: ${hid.dots}`);

  // 2. every Settings section
  const s = await ctx.newPage(); watch(s, "settings");
  await s.goto(BASE + "/setup", { waitUntil: "load" }); await s.waitForTimeout(2000);
  const secs = [...new Set(await s.$$eval("nav a, .nav a, [data-sec], #nav button, nav button", (a) => a.map((x) => x.dataset.sec || x.getAttribute("href") || x.textContent.trim()).filter(Boolean)))];
  const bad = [];
  for (const sec of secs.slice(0, 24)) {
    const link = s.locator(`nav a:has-text("${sec}"), [data-sec="${sec}"], nav button:has-text("${sec}")`).first();
    if (!(await link.count())) continue;
    await link.click().catch(() => {}); await s.waitForTimeout(700);
    const t = await s.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText);
    // (the Compatibility list names file types the viewer opens, "Text and code (TXT, LOG, JSON, …)": a file type, not jargon)
    const t2 = /Compatibility/.test(sec) ? t.replace(/\bJSON\b(?=[^()]*\))|JSON pretty-print/g, "") : t;
    if (t.trim().length < 40) bad.push(`${sec} (empty)`); else if (JARGON.test(t2)) bad.push(`${sec} (says "${t2.match(JARGON)[0]}")`);
  }
  rec("Settings sections render in plain words", secs.length > 5 && !bad.length, `${secs.length} sections${bad.length ? " · " + bad.join("; ") : ""}`);
  await s.screenshot({ path: OUT + "settings.png" });

  // 3. every Help page opens
  const list = (await J("/api/help/list")).body; const docs = list.docs ?? list.list ?? list;
  const openFails = [];
  for (const doc of docs) { const r = await J(`/api/help/doc/${doc.slug}`); if (r.status !== 200 || String(r.body.markdown ?? r.body.text ?? r.body.md ?? JSON.stringify(r.body)).length < 200) openFails.push(doc.slug); }
  rec("every Help page opens", docs.length >= 20 && !openFails.length, `${docs.length} pages${openFails.length ? " · failed: " + openFails.join(", ") : ""}`);
  const h = await ctx.newPage(); watch(h, "help"); await h.goto(BASE + "/help", { waitUntil: "load" }); await h.waitForTimeout(1500); await h.screenshot({ path: OUT + "help.png" });

  // 4. typed commands in free mode: each should do the thing, or say plainly what to set up
  const tries = [
    ["add dentist tomorrow at 3pm", /added|dentist/i], ["add water the plants every other day at 5pm", /every other day/i], ["what's on tomorrow", /tomorrow|dentist/i],
    ["remind me to call mom tomorrow at noon", /remind/i], ["snooze", /nothing to snooze|snoozed/i], ["what's snoozed?", /snoozed/i], ["what can you do", /schedule|remind|can/i],
    ["what's the weather", /°|degrees|weather/i], ["make it rain", /rain/i], ["back to the real weather", /real/i], ["make everything bigger", /bigger|size|%/i], ["reset the screen layout", /reset|layout/i],
    ["tune in", /install|listen|speech|whisper|tune/i], ["join my discord", /discord|set up|bot/i], ["what's on my google calendar today", /google|connect|set up/i],
    ["check my email", /connect|email|gmail|outlook|set up/i], ["search notion for recipes", /notion|connect|set up/i], ["open settings", /settings/i], ["check for updates", /update/i],
    ["read my last text", /text|phone/i], ["what's on the screen", /screen|panel|showing/i], ["play some music", /play|music|spotify|youtube/i],
  ];
  for (const [q, re] of tries) { const r = await chat(q); rec(`"${q}"`, re.test(r) && !JARGON.test(r) && !/^In\s+it's/.test(r), r); }

  // 5. finding a document the user hasn't given access to: it should say how to allow it
  try {
    const JSZip = require(require.resolve("jszip", { paths: [APP] }));
    const z = new JSZip();
    z.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    z.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    z.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Lease Agreement</w:t></w:r></w:p><w:p><w:r><w:t>Rent is due on the first of each month.</w:t></w:r></w:p></w:body></w:document>');
    if (process.env.QA_HOME) { fs.mkdirSync(path.join(process.env.QA_HOME, "Documents"), { recursive: true }); fs.writeFileSync(path.join(process.env.QA_HOME, "Documents", "Lease agreement.docx"), await z.generateAsync({ type: "nodebuffer" })); }
    const r = await chat("open the lease agreement");
    rec("a document outside the allowed folders", /permission|allowed|settings|lease/i.test(r) && !JARGON.test(r), r);
  } catch (e) { rec("a document outside the allowed folders", false, e.message); }

  // 6. panels on the screen open and close without errors
  for (const fn of [() => d.evaluate(() => document.querySelector('[data-w="sky"], #skyBtn')?.click()), () => d.evaluate(() => document.querySelector('[data-w="sound"]')?.click())]) {
    await fn().catch(() => {}); await d.waitForTimeout(900); await d.keyboard.press("Escape"); await d.waitForTimeout(400);
  }
  rec("no page errors", errs.length === 0, errs.slice(0, 8).join(" | ") || "none");
  fs.writeFileSync(OUT + "results.json", JSON.stringify(results, null, 2));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
  await b.close();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(`FAIL  the after-setup checks stopped: ${e.message.split("\n")[0]}`); process.exit(1); });
