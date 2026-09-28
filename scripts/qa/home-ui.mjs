// The Devices page, the Printers page and their Settings sections, headless (Chrome, --mute-audio), against simulators.
// A small test server here serves public/ and only the two APIs (lib/devices/routes, lib/printers/routes) on a throwaway
// data folder; nothing touches the owner's Dayspring on :4747, his data, his devices or his own Chrome profile.
// Checks: tiles and strips render with live state, a toggle switches the simulated outlet, a risky switch shows the
// question (inside the screen at 1280×720 and at a phone-sized 380×560) and only happens after "Yes", scenes and
// schedules show, the printer card shows its camera, state, progress, temperatures and AMS, the bed check and the big
// camera fit the screen, the queue accepts a file; Settings → Smart devices and → 3D printers render and work (the
// permission choice, the recommended strips, the add forms, the bed-area drag); setup.js lists both sections in the
// "Apps & connections" group; and no page logs an error.
//   node scripts/qa/home-ui.mjs
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TMP = mkdtempSync(join(tmpdir(), "ds-homeui-"));
Object.assign(process.env, { DAYSPRING_DEVICES_FILE: join(TMP, "devices-home.json"), DAYSPRING_PERMISSIONS_FILE: join(TMP, "permissions.json"), DAYSPRING_ACTIVITY_DIR: join(TMP, "activity"),
  DAYSPRING_PRINTERS_FILE: join(TMP, "printers.json"), DAYSPRING_PRINTS_DIR: join(TMP, "prints"), DAYSPRING_TEST_CRYPTO: "fake", DAYSPRING_TOKEN_CRYPTO: "fake", DAYSPRING_NO_LAN_SCAN: "1",
  DAYSPRING_NO_BROWSER: "1", DAYSPRING_NO_KEEPAWAKE: "1", DAYSPRING_CAMERAS_FILE: join(TMP, "cameras.json"), DAYSPRING_CAMERAS_DIR: join(TMP, "cameras"), DAYSPRING_CAMERAS_STATE: join(TMP, "cameras-state.json"),
  DAYSPRING_SETTINGS_FILE: join(TMP, "settings.json") });
const imp = (p) => import(pathToFileURL(join(DESK, p)).href);
let pass = 0, fail = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && got !== "" ? `  (${typeof got === "string" ? got : JSON.stringify(got)})`.slice(0, 300) : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the simulated home and printer ----
const dsims = await imp("scripts/qa/fixtures/devices/sims.mjs");
const psims = await imp("scripts/qa/fixtures/printers/sims.mjs");
const synth = await imp("scripts/qa/fixtures/printers/synth.mjs");
const registry = await imp("lib/devices/registry.mjs");
const permissions = await imp("lib/permissions.mjs");
const pstore = await imp("lib/printers/store.mjs");
const printers = await imp("lib/printers/index.mjs");
const devRoutes = await imp("lib/devices/routes.mjs");
const prRoutes = await imp("lib/printers/routes.mjs");
const K = await dsims.kasaSim({ outlets: 6 });
const W = await dsims.wledSim();
permissions.set({ devices: "on" });
registry.saveStrip({ id: "A", name: "Strip A", adapter: "kasa", host: "127.0.0.1", port: K.port, outlets: 6, model: "HS300" });
registry.saveDevice({ name: "Fan 2", type: "fan", room: "bedroom", power: [{ via: "outlet", strip: "A", outlet: 2 }] });
registry.saveDevice({ name: "Router", type: "router", room: "office", power: [{ via: "outlet", strip: "A", outlet: 6 }] });
registry.saveDevice({ name: "Computer", type: "computer", room: "office", hostsDayspring: true, power: [{ via: "outlet", strip: "A", outlet: 3 }] });
registry.saveDevice({ name: "Desk LEDs", type: "light", room: "office", control: { via: "wled", host: `127.0.0.1:${W.port}` } });
registry.saveScene({ name: "Movie mode", steps: [{ device: "fan-2", action: "off" }] });
registry.load().schedules.push({ id: "s1", ids: ["fan-2"], label: "Fan 2", action: "off", at: new Date(Date.now() + 3600_000).toISOString(), whenLabel: "in an hour" }); registry.save();
K.children[5].state = 1; K.children[2].state = 1;
registry.setOptions({ minToggleSeconds: 0 });   // (the rate limit has its own test in devices.mjs)
const P = await psims.bambuSim({ serial: "01P00A999999999", accessCode: "7c3a9e11", model: "P1S" });
P.cam.setFrame(synth.fixtures.empty());
pstore.savePrinter({ id: "p1", name: "Printer 1", number: 1, brand: "bambu", model: "P1S", host: "127.0.0.1", serial: P.serial, accessCode: "7c3a9e11", mqttPort: P.mqttPort, ftpPort: P.ftpPort, cameraPort: P.camPort });
printers.setDeps({ announce: () => {}, broadcast: () => {} });
await printers.connection("p1");
await printers.captureReference("p1"); pstore.setBed("p1", { roi: synth.ROI });
P.advance({ gcode_state: "RUNNING", mc_percent: 42, layer_num: 50, total_layer_num: 120, mc_remaining_time: 65, subtask_name: "benchy", nozzle_temper: 220, nozzle_target_temper: 220 });
const qfile = join(TMP, "phone-stand.gcode.3mf"); writeFileSync(qfile, Buffer.alloc(100, 1));

// ---- the test server: public/ + the two APIs ----
const PUBLIC = join(DESK, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2", ".ico": "image/x-icon", ".svg": "image/svg+xml" };
const harness = (script, global, title) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/safe-area.css">
  <style>:root{--ink:#eef0ff;--muted:#a4abcc;--dim:#8d94b8;--edge2:rgba(170,180,255,.28);--panel:rgba(22,26,56,.78);--panel2:rgba(34,40,80,.6);--indigo:#7c8cff;--gold:#ffd27a;--rose:#ff8fa3;--mint:#7ee3b0;--r:.9em}body{background:#070916;color:var(--ink);font-family:system-ui;margin:0;padding:1em}.row{display:flex;gap:.5em;flex-wrap:wrap}.field{display:flex;flex-direction:column;gap:.3em;margin:.5em 0}.hint{color:var(--dim)}.note{border:1px solid var(--edge2);padding:.5em;margin:.5em 0}.choice.on{outline:2px solid var(--indigo)}.btn{padding:.3em .8em}.sw{width:3em;height:1.6em}.toggle{display:flex;gap:1em;align-items:center}</style></head>
  <body><div id="card"></div><script src="/${script}"></script><script>window.addEventListener("error",(e)=>console.error("page error "+e.message));const S=window.${global};document.getElementById("card").innerHTML=S.html();S.mount(document.getElementById("card"),{toast:()=>{},onLeave:()=>{}});</script></body></html>`;
const send = (res, status, body) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); };
const readJSON = async (req) => { let raw = ""; for await (const c of req) raw += c; return raw ? JSON.parse(raw) : {}; };
const srv = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/api/events") { res.writeHead(200, { "content-type": "text/event-stream" }); res.write(": ok\n\n"); return; }
    if (url.pathname.startsWith("/api/")) {
      const p = url.pathname.slice(4), ctx = { m: req.method, p, q: url.searchParams, send, readJSON };
      if (await devRoutes.handle(req, res, ctx)) return;
      if (await prRoutes.handle(req, res, ctx)) return;
      return send(res, 404, { error: "not here" });
    }
    // the Dayspring screen's add-on (home-tv.js) on a stand-in screen with 8% margins on every side
    if (url.pathname === "/tv-harness.html") { res.writeHead(200, { "content-type": MIME[".html"] }); return res.end(`<!doctype html><html style="--st:8vh;--sb:8vh;--sl:8vw;--sr:8vw"><head><meta charset="utf-8"><title>tv</title><link rel="stylesheet" href="/safe-area.css"></head><body style="margin:0;background:#000;color:#fff;font-family:system-ui"><div id="clock">12:00</div><div id="calBtns"><div class="util"><button id="setBtn">⚙</button></div></div><script>window.dsEvents=new EventTarget();</script><script src="/home-tv.js"></script></body></html>`); }
    if (url.pathname === "/devices-harness.html") { res.writeHead(200, { "content-type": MIME[".html"] }); return res.end(harness("devices-settings.js", "DayspringDeviceSettings", "Smart devices settings")); }
    if (url.pathname === "/printers-harness.html") { res.writeHead(200, { "content-type": MIME[".html"] }); return res.end(harness("printers-settings.js", "DayspringPrinterSettings", "Printer settings")); }
    const f = resolve(join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname));
    if (!f.startsWith(PUBLIC) || !existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" }); res.end(readFileSync(f));
  } catch (e) { if (!res.headersSent) send(res, 500, { error: e.message }); }
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${srv.address().port}`;

// ---- the browser ----
// playwright-core: QA_PLAYWRIGHT (a path or file:// URL), else the exported copy next to this project (…/dayspring-app), else this app's own (same lookup as images.mjs)
const PW = process.env.QA_PLAYWRIGHT ? (/^file:/.test(process.env.QA_PLAYWRIGHT) ? process.env.QA_PLAYWRIGHT : pathToFileURL(process.env.QA_PLAYWRIGHT).href)
  : pathToFileURL([join(DESK, "..", "..", "..", "dayspring-app", "node_modules", "playwright-core", "index.mjs"), join(DESK, "node_modules", "playwright-core", "index.mjs")].find((p) => existsSync(p)) ?? "").href;
const { chromium } = await import(PW);
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ ...(existsSync(CHROME) ? { executablePath: CHROME } : {}), headless: true, args: ["--mute-audio"] });
const errors = [];
async function page(path, vp = { width: 1280, height: 720 }) {
  const pg = await browser.newPage({ viewport: vp });
  pg.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon|EventSource/i.test(m.text())) errors.push(`${path}: ${m.text()}`); });
  pg.on("pageerror", (e) => errors.push(`${path}: ${e.message}`));
  await pg.goto(BASE + path, { waitUntil: "domcontentloaded" });
  return pg;
}
const inside = async (pg, sel) => pg.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; });

try {
  // ---- the Devices page ----
  let pg = await page("/smarthome.html?embed=1");
  await pg.waitForSelector(".tile", { timeout: 8000 });
  const rooms = await pg.$$eval("#rooms h2", (h) => h.map((x) => x.textContent));
  check("Devices page: rooms (bedroom, office) with tiles", rooms.includes("bedroom") && rooms.includes("office") && (await pg.$$(".tile")).length === 4, rooms);
  check("Devices page: the router tile says it's critical, the PC says \"this PC\"", /critical/.test(await pg.textContent(".tile[data-id=router]")) && /this PC/.test(await pg.textContent(".tile[data-id=computer]")));
  check("Devices page: WLED tile has brightness, colour and effects from its capabilities", Boolean(await pg.$(".tile[data-id=desk-leds] input[type=range]")) && Boolean(await pg.$(".tile[data-id=desk-leds] input[type=color]")) && (await pg.$$eval(".tile[data-id=desk-leds] select option", (o) => o.length)) > 3);
  check("Devices page: the strip shows its 6 outlets with the device names", (await pg.$$(".outlet")).length === 6 && /Fan 2/.test(await pg.textContent(".strip")));
  check("Devices page: scenes and schedules", /Movie mode/.test(await pg.textContent("#scenes")) && /in an hour/.test(await pg.textContent("#scheds")));
  await pg.click(".tile[data-id=fan-2] .sw");
  await pg.waitForFunction(() => /is on/.test(document.getElementById("msg").textContent), null, { timeout: 5000 }).catch(() => {});
  check("Devices page: a toggle switches the outlet (fan 2 on)", K.state()[1] === true, await pg.textContent("#msg"));
  await pg.click(".tile[data-id=router] .sw");
  await pg.waitForSelector("#dlg:not([hidden])", { timeout: 5000 });
  check("Devices page: a risky switch shows the question (why), nothing switched yet", /critical/.test(await pg.textContent("#dlgText")) && K.state()[5] === true);
  check("Devices page: the question fits the screen (1280×720)", await inside(pg, "#dlg .box"));
  await pg.click("#dlgYes"); await sleep(800);
  check("Devices page: after \"Yes, do it\" it's done", K.state()[5] === false, await pg.textContent("#msg"));
  await pg.fill("#sayIn", "turn fan 2 off"); await pg.click("#say button"); await sleep(800);
  check("Devices page: typed \"turn fan 2 off\" works", K.state()[1] === false, await pg.textContent("#msg"));
  await pg.close();
  pg = await page("/smarthome.html?embed=1", { width: 380, height: 560 });
  await pg.waitForSelector(".tile");
  await pg.click(".tile[data-id=computer] .sw"); await pg.waitForSelector("#dlg:not([hidden])");
  check("Devices page (phone size 380×560): the question fits, its buttons are visible", await inside(pg, "#dlg .box") && await inside(pg, "#dlgYes") && /running on/.test(await pg.textContent("#dlgText")));
  await pg.click("#dlgNo"); await pg.close();

  // ---- the Printers page ----
  pg = await page("/printers.html?embed=1");
  await pg.waitForSelector(".card", { timeout: 8000 });
  await pg.waitForFunction(() => /printing/.test(document.querySelector(".card .pill")?.textContent ?? ""), null, { timeout: 6000 }).catch(() => {});
  const card = await pg.textContent(".card");
  check("Printers page: the card shows state, job, progress, layer, time left, temperatures", /printing/.test(card) && /benchy/.test(card) && /42%/.test(card) && /layer 50\/120/.test(card) && /1 h 5 min/.test(card) && /220°/.test(card), card.replace(/\s+/g, " ").slice(0, 200));
  check("Printers page: AMS trays with colours", (await pg.$$(".tray")).length === 3);
  await pg.waitForFunction(() => { const i = document.querySelector("img[data-cam]"); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 }).catch(() => {});
  check("Printers page: the camera picture loads", await pg.$eval("img[data-cam]", (i) => i.naturalWidth > 0).catch(() => false));
  check("Printers page: Pause and Stop while printing", Boolean(await pg.$("[data-cmd=pause]")) && Boolean(await pg.$("[data-cmd=stop]")));
  await pg.click("[data-cmd=stop]"); await pg.waitForSelector("#dlg:not([hidden])");
  check("Printers page: Stop asks first (can't be resumed)", /can't be resumed/.test(await pg.textContent("#dlgText")) && !P.lastCommand("stop"));
  await pg.click("#dlgNo");
  await pg.click("[data-bed]"); await pg.waitForSelector("#dlg:not([hidden])", { timeout: 8000 });
  check("Printers page: \"Is the bed clear?\" answers with the picture, inside the screen", /bed/i.test(await pg.textContent("#dlgText")) && await inside(pg, "#dlg .box"));
  await pg.click("#dlgYes");
  await pg.click("[data-big]"); await pg.waitForSelector("#bigCam:not([hidden])");
  check("Printers page: the big live camera fits the screen with its Close", await inside(pg, "#bigCam .box") && await inside(pg, "#bigClose"));
  await pg.click("#bigClose");
  await pg.click("details summary").catch(() => {});
  await pg.fill("form[data-add] input", qfile); await pg.click("form[data-add] button"); await sleep(700);
  check("Printers page: a file is added to the queue", pstore.get("p1").queue.items.some((x) => x.file === qfile));
  await pg.close();
  pg = await page("/printers.html?embed=1&printer=p1&camera=1", { width: 380, height: 560 });
  await pg.waitForSelector("#bigCam:not([hidden])", { timeout: 8000 });
  check("Printers page (phone size): \"show me the camera\" opens the big view inside the screen", await inside(pg, "#bigCam .box") && await inside(pg, "#bigClose"));
  await pg.close();

  // ---- the Dayspring screen: the buttons and the failing-print card (inside 8% margins) ----
  for (const vp of [{ width: 1280, height: 720 }, { width: 380, height: 560 }]) {
    pg = await page("/tv-harness.html", vp);
    await pg.waitForSelector("#printersBtn", { timeout: 6000 }).catch(() => {});
    check(`screen ${vp.width}×${vp.height}: 🏠 Devices and 🖨 Printers buttons appear once things are set up`, Boolean(await pg.$("#devicesBtn")) && Boolean(await pg.$("#printersBtn")));
    await pg.evaluate(() => { const e = new Event("printer-alert"); e.data = JSON.stringify({ printer: "p1", name: "Printer 1", severity: "failure", verdict: "spaghetti", text: "Printer 1 looks like it's failing: spaghetti (loose strands everywhere). Want me to pause it?", image: "/api/printers/p1/snapshot.jpg" }); window.dsEvents.dispatchEvent(e); });
    await pg.waitForSelector(".printpanel", { timeout: 4000 });
    const fit = await pg.evaluate(() => { const r = document.querySelector(".printpanel").getBoundingClientRect(), cs = getComputedStyle(document.documentElement); const px = (v, d) => (parseFloat(v) / 100) * d; const L = px("8", innerWidth), T = px("8", innerHeight); return { ok: r.left >= L - 1 && r.right <= innerWidth - L + 1 && r.top >= T - 1 && r.bottom <= innerHeight - T + 1, r: [r.left, r.top, r.right, r.bottom] }; });
    check(`screen ${vp.width}×${vp.height}: the failing-print card stays inside the margins, with Pause it`, fit.ok && Boolean(await pg.$(".printpanel [data-pause]")), fit.r);
    P.commands.length = 0;
    await pg.click(".printpanel [data-pause]");
    await pg.waitForFunction(() => /paused/i.test(document.querySelector(".printpanel .t")?.textContent ?? ""), null, { timeout: 5000 }).catch(() => {});
    check(`screen ${vp.width}×${vp.height}: "Pause it" on the card pauses the printer`, Boolean(P.lastCommand("pause")));
    P.advance({ gcode_state: "RUNNING" });
    await pg.close();
  }

  // ---- Settings → Smart devices ----
  pg = await page("/devices-harness.html");
  await pg.waitForSelector("#dv-rec .note", { timeout: 8000 });
  check("Settings → Smart devices: the permission choice shows the current one (On)", await pg.$eval("[data-perm=on]", (b) => b.classList.contains("on")));
  check("Settings → Smart devices: five recommended strips with links and \"works offline\"", (await pg.$$("#dv-rec .note")).length === 5 && /works offline/.test(await pg.textContent("#dv-rec")) && /HS300/.test(await pg.textContent("#dv-rec")));
  await pg.click("[data-perm=ask]"); await sleep(400);
  check("Settings → Smart devices: choosing \"Ask me first\" saves the Devices permission", permissions.get().devices === "ask");
  permissions.set({ devices: "on" });
  await pg.click("#dv-addstrip"); await pg.waitForSelector("#sf-host");
  await pg.selectOption("#sf-ad", "tapo");
  check("Settings → Smart devices: a Tapo strip asks for the TP-Link email and password", await pg.$eval("[data-need=username]", (x) => !x.hidden) && await pg.$eval("[data-need=password]", (x) => !x.hidden));
  await pg.selectOption("#sf-ad", "custom");
  await pg.selectOption("#sf-tpl", "tasmota_http");
  check("Settings → Smart devices: a custom device fills in from a template", /cmnd=Power/.test(await pg.inputValue("#sf-json")));
  await pg.click("#sf-cancel");
  await pg.click("[data-test=A]"); await sleep(800);
  check("Settings → Smart devices: Test talks to the strip", /Connected/.test(await pg.textContent("[data-testres=A]")), await pg.textContent("[data-testres=A]"));
  await pg.click("[data-outlet='A:4']"); await pg.waitForSelector("#df-name");
  await pg.fill("#df-name", "Fan 1"); await pg.selectOption("#df-type", "fan"); await pg.fill("#df-room", "office"); await pg.fill("#df-al", "the office fan");
  await pg.click("#df-save"); await sleep(600);
  const f1 = registry.devices().find((d) => d.name === "Fan 1");
  check("Settings → Smart devices: naming outlet 4 makes \"Fan 1\" on it, with its words", f1 && f1.power[0].outlet === 4 && f1.aliases.includes("the office fan"), f1);
  await pg.close();

  // ---- Settings → 3D printers ----
  pg = await page("/printers-harness.html");
  await pg.waitForSelector("[data-p=p1]", { timeout: 8000 });
  check("Settings → 3D printers: the printer with Test, the empty bed and the switches", Boolean(await pg.$("[data-test=p1]")) && Boolean(await pg.$("[data-ref=p1]")) && (await pg.$$("[data-sw]")).length === 5);
  check("Settings → 3D printers: auto-pause and auto-start start off", await pg.$eval("[data-sw=autoPause]", (b) => b.getAttribute("aria-checked")) === "false" && await pg.$eval("[data-sw=autoStart]", (b) => b.getAttribute("aria-checked")) === "false");
  check("Settings → 3D printers: the Developer mode guide for each model", /Developer mode/.test(await pg.textContent("#pr-guide")) && /H2D/.test(await pg.textContent("#pr-guide")));
  const box = await pg.$eval("[data-roi=p1]", (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await pg.mouse.move(box.x + box.w * 0.2, box.y + box.h * 0.2); await pg.mouse.down(); await pg.mouse.move(box.x + box.w * 0.7, box.y + box.h * 0.8, { steps: 5 }); await pg.mouse.up(); await sleep(500);
  const roi = pstore.get("p1").bed.roi;
  check("Settings → 3D printers: dragging a box saves the bed area", roi && Math.abs(roi.x - 0.2) < 0.03 && Math.abs(roi.w - 0.5) < 0.03 && Math.abs(roi.h - 0.6) < 0.03, roi);
  await pg.fill("#sm-p1", "5"); await pg.dispatchEvent("#sm-p1", "change"); await sleep(400);
  check("Settings → 3D printers: the picture interval saves", pstore.get("p1").options.snapshotMinutes === 5);
  await pg.click("#pr-add"); await pg.waitForSelector("#pf-brand");
  await pg.selectOption("#pf-brand", "marlin");
  check("Settings → 3D printers: an Ender over USB shows the port and the honest note about OctoPrint/Klipper", await pg.$eval("#pf-port", (x) => !x.closest("[data-b]").hidden) && /OctoPrint or Klipper on a Raspberry Pi is more reliable/.test(await pg.textContent("#pr-form")));
  await pg.close();

  // ---- setup.js: both sections under "Apps & connections" ----
  const setup = readFileSync(join(DESK, "public", "setup.js"), "utf8");
  const order = ["features", "apps", "cameras", "devices", "printers", "permissions"].map((id) => setup.indexOf(`{ id: "${id}"`));
  check("setup.js: Smart devices and 3D printers are sections in the Apps & connections group (after Features, before Permissions)", order.every((x) => x > 0) && order[3] > order[0] && order[4] > order[3] && order[4] < order[5], order);
  check("setup.html loads both settings scripts", /devices-settings\.js/.test(readFileSync(join(DESK, "public", "setup.html"), "utf8")) && /printers-settings\.js/.test(readFileSync(join(DESK, "public", "setup.html"), "utf8")));
  check("no page logged an error", errors.length === 0, errors.slice(0, 4));
} finally {
  await browser.close();
  srv.close(); printers.stopAll(); P.close(); K.close(); W.close();
  await sleep(200);
  rmSync(TMP, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
