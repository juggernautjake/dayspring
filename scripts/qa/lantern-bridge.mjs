// Dayspring's side of the Dayspring ↔ Lantern link (lib/lantern.mjs), checked against a throwaway copy (port 4793)
// with its own ecosystem folder, a mock Lantern, a fake release server and (last) the real Lantern from its release zip
// against Lantern's fake hub. Nothing is heard, no device is touched, nothing opens on screen, nothing real is installed.
//   node scripts/qa/lantern-bridge.mjs [--keep] [--no-real]
//   (the real-Lantern part needs ..\..\..\lantern\dist-out\Lantern.zip and ..\..\..\lantern\server\test\fake-hub.mjs)
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { spawn, spawnSync } from "node:child_process";
import { createServer, request } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROJECTS = join(DESK, "..", "..", "..");
const PORT = 4793, BASE = `http://127.0.0.1:${PORT}`;
const KEEP = process.argv.includes("--keep"), REAL = !process.argv.includes("--no-real");
const TMP = mkdtempSync(join(tmpdir(), "ds-lantern-")), APP = join(TMP, "app"), ECO = join(TMP, "eco");
const LDATA = join(TMP, "lantern-data"), LDIR = join(TMP, "Programs", "Lantern");
mkdirSync(join(ECO, "apps"), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" && !ok ? "  (" + (typeof got === "string" ? got : JSON.stringify(got)).slice(0, 300) + ")" : ""}`); };
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch { /* keep trying */ } await sleep(150); } return null; };
const j = async (path, body) => { const r = await fetch(BASE + "/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const chat = async (text) => { const r = await j("/chat", { message: text, surface: "desk" }); return r.body.reply ?? r.body.error ?? ""; };
const raw = (path, { method = "GET", headers = {}, body = null } = {}) => new Promise((resolve) => {
  const rq = request({ host: "127.0.0.1", port: PORT, path, method, headers }, (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ status: res.statusCode, body: d })); });
  rq.on("error", () => resolve({ status: 0, body: "" })); if (body) rq.write(body); rq.end();
});

// ---- a mock Lantern: presence file + a tiny server that records what Dayspring sends and calls --------------------------
const mock = { events: [], calls: [], token: randomBytes(24).toString("hex"), port: 0, courses: [{ id: "py101", title: "Intro to Python 101", installed: true, percent: 12, measure: "13 of 109 steps · 7 of 54 lessons", next: { id: "u2l3", title: "Lists and Loops" }, minutesLeft: 2400 }] };
mock.people = [{ id: "u-sam", display_name: "Sam Carter", email: "sam@example.com" }];
const mockServer = createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  const url = new URL(req.url, "http://x"), b = body ? JSON.parse(body) : {};
  const send = (s, o) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  if (url.pathname === "/api/eco/hello") return send(200, { app: "lantern", version: "0.9.0", schema: 1 });
  if (url.pathname === "/api/eco/event") { mock.events.push(b); return send(200, { ok: true }); }
  mock.calls.push({ method: req.method, path: url.pathname, token: req.headers["x-eco-token"], body: b });
  if (url.pathname === "/api/local/status") return send(200, { app: "lantern", version: "0.9.0", name: "Riley", signedIn: true, owner: true, courses: mock.courses, offers: [] });
  if (url.pathname === "/api/local/people") return send(200, { people: mock.people });
  if (url.pathname === "/api/local/friends") return send(200, { friends: [{ id: "u-sam", display_name: "Sam Carter", online: true, current_course_title: "Intro to Python 101" }], received: [], sent: [] });
  return send(200, { ok: true, message: "Checked: that lesson is done." });
});
await new Promise((r) => mockServer.listen(0, "127.0.0.1", r));
mock.port = mockServer.address().port;
const mockPresence = () => writeFileSync(join(ECO, "apps", "lantern.json"), JSON.stringify({ app: "lantern", version: "0.9.0", port: mock.port, pid: process.pid, startedAt: Date.now(), token: mock.token, api: "/api/eco", schema: 1, dataDir: LDATA, handoff: join(LDATA, "handoff.json") }));
mockPresence();
const dsPresence = () => JSON.parse(readFileSync(join(ECO, "apps", "dayspring.json"), "utf8"));
const toDs = async (type, data, token = null) => {
  const ev = { v: 1, id: randomBytes(8).toString("hex"), type, source: "lantern", at: Date.now(), data };
  const r = await fetch(BASE + "/api/eco/event", { method: "POST", headers: { "content-type": "application/json", "x-eco-token": token ?? dsPresence().token }, body: JSON.stringify(ev) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

// ---- a throwaway Dayspring ----------------------------------------------------------------------------------------------
spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(join(APP, "data"), { recursive: true });
writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary" }));
const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", ELEVENLABS_API_KEY: "", AI_PROVIDER: "", DAYSPRING_REMINDER_CHANNEL: "off",
  ECOSYSTEM_DIR: ECO, LANTERN_DATA: LDATA, DAYSPRING_LANTERN_DIR: LDIR, DAYSPRING_LANTERN_LAUNCH_HIDDEN: "1", LANTERN_NO_BROWSER: "1", DAYSPRING_LANTERN_INSTALL_FLAGS: "--no-shortcuts --no-protocol" };
let server = null, serverLog = "";
const startDs = async (extra = {}) => {
  server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env: { ...env, ...extra }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
  await until(async () => (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(1500) })).ok, 30_000);
};
const stopDs = async () => { if (!server) return; server.kill(); await until(async () => { try { await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(500) }); return false; } catch { return true; } }, 8000); server = null; };
// the page stream: what the Dayspring screen would get
const sse = [];
async function listen() {
  const r = await fetch(BASE + "/api/events?page=test&id=t1");
  const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
  (async () => { try { for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf("\n\n")) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); const ev = /^event: (.+)$/m.exec(chunk)?.[1], data = /^data: (.+)$/m.exec(chunk)?.[1]; if (ev) { const d = data ? JSON.parse(data) : null; sse.push({ ev, data: d }); if (ev === "announce" && d?.fid) floorDone(d.fid); } } } } catch { /* closed */ } })();
}
// this test stands in for the Dayspring screen: it tells the conversation floor (lib/floor.mjs) each announcement was
// said, as public/floor.js does, so the next one isn't held waiting for a screen that isn't there
const floorDone = (fid) => fetch(BASE + "/api/floor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "done", fid, outcome: "spoken", tv: "idle" }) }).catch(() => {});
const seenSse = (ev, pred = () => true) => sse.find((x) => x.ev === ev && pred(x.data));

try {
  await startDs();
  await listen();

  // ---- presence and security ----------------------------------------------------------------------------------------------
  const pres = await until(() => existsSync(join(ECO, "apps", "dayspring.json")) && dsPresence());
  check("presence: dayspring.json is written with port and a 48-character token", pres && pres.port === PORT && /^[0-9a-f]{48}$/.test(pres.token), pres);
  check("hello answers { app: dayspring }", (await j("/eco/hello")).body.app === "dayspring");
  check("an event without the token is refused (401)", (await toDs("reminder.due", { text: "x" }, "wrong")).status === 401);
  check("a foreign Host is refused (421)", (await raw("/api/eco/hello", { headers: { host: "evil.example:4793" } })).status === 421);
  check("a foreign Origin is refused (403)", (await raw("/api/eco/hello", { headers: { origin: "https://evil.example" } })).status === 403);
  const bad = await toDs("course.offered", { course: "py101" });
  check("a bad event is refused with a list of problems (400)", bad.status === 400 && Array.isArray(bad.body.errors) && bad.body.errors.length > 0, bad);
  check("an unknown type is refused", (await toDs("nonsense.type", {})).status === 400);

  // ---- telling Lantern ------------------------------------------------------------------------------------------------------
  check("on start Dayspring tells Lantern it owns the mic (mic.owner dayspring)", await until(() => mock.events.some((e) => e.type === "mic.owner" && e.data.app === "dayspring"), 6000));
  check("the mock Lantern's events came with Dayspring as source", mock.events.every((e) => e.source === "dayspring"));
  await j("/tunein/speaking", { on: true, kind: "voice", ms: 3000 });
  check("Dayspring speaking → speaking.start", await until(() => mock.events.some((e) => e.type === "speaking.start" && e.data.app === "dayspring")));
  await j("/tunein/speaking", { on: false });
  check("… and speaking.stop after", await until(() => mock.events.some((e) => e.type === "speaking.stop")));
  const n0 = mock.events.filter((e) => e.type === "speaking.start").length;
  await j("/tunein/speaking", { on: true, kind: "voice" }); await j("/tunein/speaking", { on: true, kind: "voice" }); await sleep(600);
  check("repeated 'still speaking' reports send speaking.start once", mock.events.filter((e) => e.type === "speaking.start").length === n0 + 1);
  await j("/tunein/speaking", { on: false });
  await j("/lantern/mic", { app: "lantern" });
  check("handing the mic over → mic.owner lantern (and the screen hears it)", await until(() => mock.events.some((e) => e.type === "mic.owner" && e.data.app === "lantern")) && await until(() => seenSse("mic-owner", (d) => d.app === "lantern")));
  check("'take the mic back' by voice → mic.owner dayspring", /listening again/i.test(await chat("take the mic back")) && await until(() => mock.events.filter((e) => e.type === "mic.owner" && e.data.app === "dayspring").length >= 2));
  await j("/settings", { mode: "silent" });
  check("quiet time (silent mode) → dnd on", await until(() => mock.events.some((e) => e.type === "dnd" && e.data.on === true), 30_000));
  await j("/settings", { mode: "voice" });

  // ---- Lantern speaking → the screen waits --------------------------------------------------------------------------------
  await toDs("speaking.start", { app: "lantern" });
  check("Lantern speaking → the screen is told to wait (peer-speaking on)", await until(() => seenSse("peer-speaking", (d) => d.on === true)));
  check("… and /tunein/speaking reports it", (await j("/tunein/speaking", { on: false })).body.peerSpeaking === true);
  await toDs("speaking.stop", { app: "lantern" });
  check("… until speaking.stop", await until(() => seenSse("peer-speaking", (d) => d.on === false)));

  // ---- status, study cards, voice -----------------------------------------------------------------------------------------
  const st = (await j("/lantern/status")).body;
  check("Dayspring finds the running Lantern and its courses", st.running === true && st.status?.courses?.[0]?.measure === "13 of 109 steps · 7 of 54 lessons", st);
  // the Dayspring screen: Lantern's course next to the study rings (with the Lantern tag), and a card with its chip
  {
    const { createRequire } = await import("node:module");
    const { chromium } = createRequire(import.meta.url)("playwright-core");
    const { playwrightChannel } = await import(new URL("../../lib/browsers.mjs", import.meta.url).href);
    const browser = await chromium.launch({ channel: playwrightChannel(), headless: true, args: ["--mute-audio"] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript(() => { const ss = window.speechSynthesis; if (ss) { ss.speak = (u) => setTimeout(() => u.onend?.(), 20); ss.cancel = () => {}; } HTMLMediaElement.prototype.play = function () { setTimeout(() => this.onended?.(), 20); return Promise.resolve(); }; });
    await ctx.route("**/*", (r) => (r.request().method() === "POST" && /\/api\/(sound|window|devices\/use|voicemeeter\/(install|setup)|keepawake|tunein|callbridge)/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }) : r.continue()));
    const pg = await ctx.newPage(); const errs = []; pg.on("pageerror", (e) => errs.push(e.message));
    await pg.goto(BASE + "/display"); await pg.waitForTimeout(2500);
    const card = await pg.evaluate(() => { const c = document.querySelector("#courses .course.lnc"); return c ? c.textContent.replace(/\s+/g, " ") : null; });
    check("screen: Lantern's course shows among the study rings with its measure and next lesson", card && /Python/.test(card) && /13 of 109 steps · 7 of 54 lessons/.test(card) && /Lists and Loops/.test(card), card);
    const before = mock.calls.filter((c) => c.path === "/api/local/open").length;
    await pg.evaluate(() => document.querySelector("#courses .course.lnc").click());   // (the rings may be in the rotating panel)
    check("screen: clicking it opens Lantern at that lesson", await until(() => mock.calls.filter((c) => c.path === "/api/local/open").length === before + 1, 5000));
    await pg.evaluate(() => window.dispatchEvent(new CustomEvent("ds-test-lantern")));
    await pg.waitForTimeout(400);
    const lc = await pg.evaluate(() => { const c = document.querySelector(".lncard"); if (!c) return null; const r = c.getBoundingClientRect(); return { chip: c.querySelector(".lnchip")?.textContent, inView: r.right <= innerWidth && r.bottom <= innerHeight && r.left >= 0 }; });
    check("screen: a Lantern card wears the Lantern chip and fits on screen", lc?.chip === "Lantern" && lc.inView, lc);
    check("screen: no page errors", errs.length === 0, errs);
    await browser.close();
  }
  check("'what's my next lesson' answers from Lantern", /Lists and Loops/.test(await chat("what's my next lesson")));
  check("'how far am I in Python' uses the one measure", /13 of 109 steps · 7 of 54 lessons/.test(await chat("how far am I in Python")));
  const op = await chat("open Python");
  check("'open Python' opens Lantern at the next lesson (with the token)", /Opening Intro to Python/.test(op) && mock.calls.some((c) => c.path === "/api/local/open" && c.token === mock.token && c.body.course === "py101" && c.body.lesson === "u2l3"), op);
  check("'open my notes' isn't taken by Lantern", !mock.calls.some((c) => c.path === "/api/local/open" && c.body.course === "notes") && !/Lantern/.test(await chat("open my notes")));
  const rem = await chat("remind me to study Python at 7 pm");
  check("'remind me to study Python at 7 pm' adds a linked study block", /on your schedule at 7 p\.m\./.test(rem), rem);

  // ---- sending a course by voice ------------------------------------------------------------------------------------------
  const q1 = await chat("send the Python course to Sam");
  check("'send the Python course to Sam' asks to confirm with the full name", /Send Intro to Python 101 to Sam Carter\?/.test(q1), q1);
  const a1 = await chat("yes");
  check("… yes → sent through Lantern's local API with the token", /Sent Intro to Python/.test(a1) && mock.calls.some((c) => c.path === "/api/local/send" && c.body.to === "u-sam" && c.body.course === "py101" && c.token === mock.token), a1);
  mock.people.push({ id: "u-sam2", display_name: "Sam Lee" });
  const q2 = await chat("send the Python course to Sam");
  check("two people called Sam → it asks which one", /more than one Sam: .*Sam Carter.*Sam Lee/.test(q2), q2);
  const q3 = await chat("send the Python course to Jordan");
  check("someone not found → it asks for an email", /don't see jordan|What's their email/i.test(q3), q3);

  // ---- offers and friend requests from Lantern ----------------------------------------------------------------------------
  // the last reply asked the owner something ("What's their email?"), so the floor gives him a minute to answer before
  // anything planned is said; the test moves on at once, as "what were you going to say?" does
  await fetch(BASE + "/api/floor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "release" }) }).catch(() => {});
  await toDs("course.offered", { course: "py101", courseTitle: "Intro to Python 101", from: "Riley", message: "Have fun", offerId: "off-1" });
  check("course.offered → a Lantern card with the sender and the note", await until(() => seenSse("lantern", (d) => d.kind === "card" && d.card?.type === "offer" && /Riley/.test(d.card.text) && d.card.note === "Have fun")));
  check("… and it's said out loud (announce, kind lantern)", await until(() => seenSse("announce", (d) => d.kind === "lantern" && /Want to accept it\?/.test(d.text))), await fetch(BASE + "/api/floor").then((r) => r.json()).catch((e) => e.message));
  const acc = await chat("yes");
  check("… 'yes' accepts it through Lantern (with the token)", /downloading/i.test(acc) && mock.calls.some((c) => c.path === "/api/local/offers/off-1/accept" && c.token === mock.token), acc);
  await toDs("course.offered", { course: "py101", courseTitle: "Intro to Python 101", from: "Riley", offerId: "off-1" });
  await sleep(500);
  check("the same offer isn't announced twice", sse.filter((x) => x.ev === "lantern" && x.data?.card?.id === "offer-off-1").length === 1);
  await toDs("friend.request", { requestId: "fr-1", from: "Riley", message: "Hi!" });
  check("friend.request → a card with Accept / Decline / Ignore", await until(() => seenSse("lantern", (d) => d.card?.type === "friend" && d.card.buttons.map((b) => b.label).join() === "Accept,Decline,Ignore")));
  const fa = await chat("later");
  check("… 'later' ignores it (kept for later)", /later/i.test(fa) && mock.calls.some((c) => c.path === "/api/local/friend-requests/fr-1/ignore"), fa);
  await toDs("friend.request", { requestId: "fr-2", from: "Alex" });
  await until(() => seenSse("lantern", (d) => d.card?.id === "friend-fr-2"));
  const r2 = await j("/lantern/action", { action: "accept-friend", data: { requestId: "fr-2" } });
  check("the card's Accept button accepts through Lantern", r2.status === 200 && mock.calls.some((c) => c.path === "/api/local/friend-requests/fr-2/accept"), r2);
  // (the friend request just asked him something; the floor waits for that answer, the test doesn't)
  await fetch(BASE + "/api/floor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "release" }) }).catch(() => {});
  await toDs("friend.accepted", { name: "Sam", userId: "u-sam" });
  check("friend.accepted → 'Sam accepted … Want to send Sam a course?' (the owner)", await until(() => seenSse("announce", (d) => /Sam accepted your friend request/.test(d.text) && /send Sam a course/.test(d.text))));
  await chat("no");
  await toDs("unit.completed", { course: "py101", ref: "u2", title: "Unit 2", courseTitle: "Intro to Python 101" });
  check("unit.completed → a celebration", await until(() => seenSse("announce", (d) => /You finished Unit 2 of Intro to Python/.test(d.text))));
  await toDs("reminder.due", { text: "Time to study Python." });
  check("reminder.due → a Dayspring reminder (snoozable)", await until(() => seenSse("announce", (d) => d.kind === "reminder" && /study Python/.test(d.text))));
  await toDs("schedule.block.request", { title: "Study Python", course: "py101", time: "19:30", minutes: 45, days: [1, 2, 3, 4, 5] });
  const rts = await until(async () => { const r = await j("/routines"); return (r.body.routines ?? r.body ?? []).find?.((x) => x.title === "Study Python" && x.start === "19:30" && x.end === "20:15") ?? null; });
  check("schedule.block.request → a repeating study block on weekdays", rts && rts.days.join() === "mon,tue,wed,thu,fri", rts);

  // ---- when Lantern stops ------------------------------------------------------------------------------------------------
  rmSync(join(ECO, "apps", "lantern.json"), { force: true });
  await sleep(600);
  const st2 = (await j("/lantern/status")).body;
  check("with Lantern gone, nothing breaks: status says not running", st2.running === false && (await j("/build")).status === 200, st2);
  const nl = await chat("what's my next lesson");
  check("… and Lantern's commands step aside (no Lantern answer)", !/Arrays, Structs/.test(nl));
  mockServer.close();

  // ---- installing Lantern: a fake release with the installer's exit codes -------------------------------------------------
  const FAKE = join(TMP, "fakezip"); mkdirSync(join(FAKE, "scripts"), { recursive: true });
  // the fake installer: writes its status, exits with FAKE_EXIT unless --install-node was given (then 0)
  writeFileSync(join(FAKE, "scripts", "install.ps1"), [
    "$status = $null; $node = $false",
    "for ($i = 0; $i -lt $args.Count; $i++) { if ($args[$i] -eq '--status') { $status = $args[$i + 1]; $i++ } elseif ($args[$i] -eq '--install-node') { $node = $true } }",
    "Add-Content -Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'args.txt') -Value ($args -join ' ')",
    "[IO.File]::WriteAllText($status, '{\"step\":\"node\",\"progress\":10,\"ok\":true}')",
    "if ($node) { [IO.File]::WriteAllText($status, '{\"step\":\"done\",\"progress\":100,\"ok\":true,\"exitCode\":0}'); exit 0 }",
    "exit [int]$env:FAKE_EXIT",
  ].join("\r\n"));
  writeFileSync(join(FAKE, "scripts", "launch.mjs"), "process.exit(0)");
  const zipOf = (dir, out) => spawnSync(join(process.env.WINDIR || "C:\\Windows", "System32", "tar.exe"), ["-a", "-c", "-f", out, "-C", dir, "."], { windowsHide: true }).status === 0;
  const FAKEZIP = join(TMP, "fake-Lantern.zip"); zipOf(FAKE, FAKEZIP);
  let served = FAKEZIP;
  const rel = createServer((req, res) => { if (req.url.endsWith("/Lantern.zip")) { const b = readFileSync(served); res.writeHead(200, { "content-type": "application/zip", "content-length": b.length }); res.end(b); } else { res.writeHead(404); res.end(); } });
  await new Promise((r) => rel.listen(0, "127.0.0.1", r));
  const ZIPURL = `http://127.0.0.1:${rel.address().port}/Lantern.zip`;
  await stopDs(); sse.length = 0;
  await startDs({ DAYSPRING_LANTERN_ZIP: ZIPURL, FAKE_EXIT: "10" }); await listen();
  const i1 = await chat("install Lantern");
  check("'install Lantern' asks first and shows where it goes", /free learning app/.test(i1) && i1.includes(LDIR), i1);
  await chat("yes");
  const job10 = await until(async () => { const r = (await j("/lantern/install")).body.job; return r && r.step === "needs-node" ? r : null; }, 30_000);
  check("exit 10 → 'Lantern needs Node.js. Install it now?' (and the card shows progress first)", job10?.exitCode === 10 && seenSse("lantern", (d) => d.kind === "install" && d.job.step === "download"), job10 ?? (await j("/lantern/install")).body);
  check("… the program went into the folder (extracted, then moved into place)", existsSync(join(LDIR, "scripts", "launch.mjs")) && !readdirSafe(dirname(LDIR)).some((x) => /\.partial-/.test(x)));
  await chat("yes");
  const jobOk = await until(async () => { const r = (await j("/lantern/install")).body.job; return r && r.step === "done" ? r : null; }, 30_000);
  check("… yes → the installer runs again with --install-node, and finishes", jobOk && /--install-node/.test(readFileSync(join(LDIR, "args.txt"), "utf8")), (await j("/lantern/install")).body);
  check("the installer ran quietly with the status file (and no start)", /--quiet --no-start --status/.test(readFileSync(join(LDIR, "args.txt"), "utf8")));
  await stopDs();
  const LD11 = join(TMP, "P11", "Lantern");
  await startDs({ DAYSPRING_LANTERN_ZIP: ZIPURL, FAKE_EXIT: "11", DAYSPRING_LANTERN_DIR: LD11 });
  await j("/lantern/install", {});
  const job11 = await until(async () => { const r = (await j("/lantern/install")).body.job; return r && r.step === "no-winget" ? r : null; }, 30_000);
  check("exit 11 → send the person to nodejs.org", job11 && /nodejs\.org/.test(job11.url + job11.message), job11 ?? (await j("/lantern/install")).body);
  await stopDs();
  const LDF = join(TMP, "PF", "Lantern");
  await startDs({ DAYSPRING_LANTERN_ZIP: `http://127.0.0.1:${rel.address().port}/missing.zip`, DAYSPRING_LANTERN_DIR: LDF });
  await j("/lantern/install", {});
  const jobF = await until(async () => { const r = (await j("/lantern/install")).body.job; return r && r.step === "failed" ? r : null; }, 30_000);
  check("a failed download → a clear message, nothing half-installed", jobF && /couldn't download Lantern/.test(jobF.message) && !existsSync(LDF), jobF);

  // ---- the handoff: Dayspring's session goes to Lantern once, then Dayspring lets go --------------------------------------
  writeFileSync(join(APP, "data", "lantern-session.json"), JSON.stringify({ hub: { url: "https://hub.invalid", anonKey: "sb_publishable_x" }, email: "t@example.com", access_token: "a", refresh_token: "r-123", expires_at: Date.now() + 3600_000 }));
  await stopDs();
  await startDs({ DAYSPRING_LANTERN_ZIP: ZIPURL, FAKE_EXIT: "0", DAYSPRING_LANTERN_DIR: join(TMP, "PH", "Lantern") });
  await j("/lantern/install", {});
  await until(async () => (await j("/lantern/install")).body.job?.step === "done", 30_000);
  const ho = (() => { try { return JSON.parse(readFileSync(join(LDATA, "handoff.json"), "utf8")); } catch { return null; } })();
  check("after installing, the sign-in handoff is written for Lantern (v1, fresh, the hub, from dayspring)", ho && ho.v === 1 && ho.refresh_token === "r-123" && ho.hub.url === "https://hub.invalid" && Date.now() - ho.created_at < 5 * 60_000 && ho.from === "dayspring", ho);
  check("… and Dayspring's own session is gone", !existsSync(join(APP, "data", "lantern-session.json")));
  const hs = await j("/lantern/hub", { url: "https://x.supabase.co", anonKey: "sb_secret_abcdefghijklmnopqrstuvwxyz" });
  check("a secret key is refused for the hub", hs.status === 400 && /SECRET/.test(hs.body.error), hs);
  rel.close();
  await stopDs();

  const REALZIP = join(PROJECTS, "lantern", "dist-out", "Lantern.zip"), FAKEHUB = join(PROJECTS, "lantern", "server", "test", "fake-hub.mjs");
  // ---- no Lantern on this computer yet: "Connect to Lantern" (emailed sign-in link / password), then invitations come ----
  if (existsSync(FAKEHUB)) {
    const HP = 54378, ANON = "fake-anon-dayspring-test-key", H = `http://127.0.0.1:${HP}`;
    const hub = spawn(process.execPath, [FAKEHUB, String(HP)], { stdio: "ignore", windowsHide: true, env: { ...process.env, FAKE_ANON: ANON } });
    await until(async () => (await fetch(`${H}/__test/state`)).ok, 10_000);
    const hubPost = async (path, body, tok) => { const r = await fetch(H + path, { method: "POST", headers: { "content-type": "application/json", apikey: ANON, ...(tok ? { authorization: "Bearer " + tok } : {}) }, body: JSON.stringify(body) }); return r.json(); };
    // the owner: signs up, claims the hub, has a published course, and invites the learner's email (course + friend request)
    const ow = await hubPost("/auth/v1/signup", { email: "owner@example.com", password: "secret-pass", data: { display_name: "Riley" } });
    const claim = (await (await fetch(`${H}/__test/claim-code`)).json()).code;
    await hubPost("/rest/v1/rpc/lantern_claim_owner", { p_code: claim }, ow.access_token);
    await hubPost("/rest/v1/rpc/lantern_owner_save_course", { p_id: "py101", p_title: "Intro to Python 101", p_status: "published" }, ow.access_token);
    await hubPost("/rest/v1/rpc/lantern_send_offer", { p_to: "learner@example.com", p_course: "py101", p_message: "Have fun" }, ow.access_token);
    await hubPost("/rest/v1/rpc/lantern_send_friend_request", { p_to: "learner@example.com", p_message: "Hi from Riley" }, ow.access_token);
    await stopDs(); sse.length = 0;
    rmSync(join(APP, "data", "lantern.json"), { force: true });          // a computer where Lantern was never installed
    await startDs({ DAYSPRING_LANTERN_DIR: join(TMP, "PN", "Lantern") }); await listen();
    check("Settings → Lantern: the hub is saved (a local test hub is allowed)", (await j("/lantern/hub", { url: H, anonKey: ANON })).status === 200);
    const sentL = await j("/lantern/connect", { email: "learner@example.com", name: "Sam" });
    check("connect: 'email me a sign-in link' reaches the hub (no code on a hub without custom email)", sentL.body.sent === true && sentL.body.code === false, sentL.body);
    const link = (await (await fetch(`${H}/__test/link?email=learner@example.com`)).json()).link;
    check("connect: the emailed link comes back to Dayspring's /lantern/auth/callback page", typeof link === "string" && link.startsWith(`${BASE}/lantern/auth/callback#access_token=`), link);
    const cbPage = await fetch(`${BASE}/lantern/auth/callback`);
    check("connect: the callback page is served and reads the #fragment itself", cbPage.status === 200 && /api\/lantern\/link/.test(await cbPage.text()));
    check("connect: a made-up link token is refused kindly", (await j("/lantern/link", { refresh_token: "nope" })).status === 400);
    const v = await j("/lantern/link", { refresh_token: new URLSearchParams(link.split("#")[1]).get("refresh_token") });
    check("connect: the link signs Dayspring in (session kept in data/, not .env)", v.body.connected === true && existsSync(join(APP, "data", "lantern-session.json")) && !(existsSync(join(APP, ".env")) && readFileSync(join(APP, ".env"), "utf8").includes("refresh")), v.body);
    check("the waiting invitation comes to Dayspring: 'Riley wants to send you a course… install Lantern?'", await until(() => seenSse("announce", (d) => /Riley wants to send you a course on Lantern: Intro to Python 101/.test(d.text) && /install Lantern/.test(d.text)), 10_000));
    check("… its card offers Install Lantern / Show me the steps / Not now", Boolean(seenSse("lantern", (d) => d.card?.type === "offer" && d.card.buttons.map((b) => b.label).join() === "Install Lantern,Show me the steps,Not now")));
    check("the friend request comes too (Accept / Decline / Ignore)", await until(() => seenSse("lantern", (d) => d.card?.type === "friend" && /Riley/.test(d.card.text)), 10_000));
    const yes = await chat("yes");
    const st = await (await fetch(`${H}/__test/state`)).json();
    check("'yes' accepts the friend request on the hub, then offers to install Lantern", st.friendships.length === 1 && /friends now/.test(yes) && /install Lantern/.test(yes), { yes, f: st.friendships.length });
    const no = await chat("no");
    check("'no' to installing is fine", /whenever you're ready/.test(no), no);
    const acc = await j("/lantern/action", { action: "decline-offer", data: { offerId: st.offers[0].id } });
    const st2 = await (await fetch(`${H}/__test/state`)).json();
    check("the card's Decline answers the offer on the hub", acc.status === 200 && st2.offers[0].status === "declined", { acc: acc.body, s: st2.offers[0]?.status });
    await fetch(`${H}/__test/down?on=1`);
    const down = await j("/lantern/action", { action: "accept-friend", data: { requestId: "nope" } });
    check("hub down → a friendly error, Dayspring keeps running", down.status === 400 && (await j("/build")).status === 200, down.body);
    await fetch(`${H}/__test/down?on=0`);
    check("disconnect removes the session", (await j("/lantern/disconnect", {})).body.connected === false && !existsSync(join(APP, "data", "lantern-session.json")));
    // email + password (the simplest way on a free hub)
    const mk = await j("/lantern/password", { email: "pat@example.com", password: "a-long-pass", name: "Pat", create: true });
    check("connect: 'Create an account' with email + password signs Dayspring in", mk.body.connected === true, mk.body);
    const sessText = readFileSync(join(APP, "data", "lantern-session.json"), "utf8");
    check("… the password is never saved (only the session)", !sessText.includes("a-long-pass"));
    await j("/lantern/disconnect", {});
    const bad = await j("/lantern/password", { email: "pat@example.com", password: "wrong-pass" });
    check("connect: a wrong password gets a plain answer", bad.status === 400 && /don't match/.test(bad.body.error), bad.body);
    const si = await j("/lantern/password", { email: "pat@example.com", password: "a-long-pass" });
    check("connect: 'Sign in' with email + password works", si.body.connected === true, si.body);
    const nl = await j("/lantern/use-lantern", {});
    check("'I already have Lantern' with no Lantern says so kindly", nl.status === 400 && /isn't on this computer/.test(nl.body.error), nl.body);
    await j("/lantern/disconnect", {});
    hub.kill();
    await stopDs();
  }

  // ---- the real Lantern (from its release zip) against its fake hub --------------------------------------------------------
  if (REAL && existsSync(REALZIP) && existsSync(FAKEHUB)) {
    const HUBPORT = 54377, LPORT = 4394;
    const hub = spawn(process.execPath, [FAKEHUB, String(HUBPORT)], { stdio: "ignore", windowsHide: true, env: { ...process.env, FAKE_ANON: "anon-test-key-anon-test-key" } });
    await until(async () => (await fetch(`http://127.0.0.1:${HUBPORT}/__test/state`)).ok, 10_000);
    served = REALZIP;
    const rel2 = createServer((req, res) => { const b = readFileSync(REALZIP); res.writeHead(200, { "content-type": "application/zip", "content-length": b.length }); res.end(b); });
    await new Promise((r) => rel2.listen(0, "127.0.0.1", r));
    const LDR = join(TMP, "PR", "Lantern"); rmSync(LDATA, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    await startDs({ DAYSPRING_LANTERN_ZIP: `http://127.0.0.1:${rel2.address().port}/Lantern.zip`, DAYSPRING_LANTERN_PORT: String(LPORT), DAYSPRING_LANTERN_DIR: LDR, LANTERN_HUB_URL: `http://127.0.0.1:${HUBPORT}`, LANTERN_HUB_ANON_KEY: "anon-test-key-anon-test-key", LANTERN_NO_DEFAULT_HUB: "1", LANTERN_MODE: "app" });
    await j("/lantern/install", {});
    const done = await until(async () => { const r = (await j("/lantern/install")).body.job; return r && ["done", "failed", "needs-node", "no-winget"].includes(r.step) ? r : null; }, 240_000);
    check("the real Lantern.zip installs with the quiet installer", done?.step === "done", done);
    const found = await until(async () => { const s = (await j("/lantern/status")).body; return s.running ? s : null; }, 60_000);
    check("… Dayspring starts it (hidden) and finds it through its presence file", Boolean(found), found);
    if (found) {
      const lp = JSON.parse(readFileSync(join(ECO, "apps", "lantern.json"), "utf8"));
      check("… both presence files in the one ecosystem folder", lp.port === LPORT && existsSync(join(ECO, "apps", "dayspring.json")));
      check("… Lantern's status comes through (signed in or not, with its course list)", Array.isArray(found.status?.courses), found.status);
      await j("/lantern/mic", { app: "dayspring" });      // (with no screen open it would otherwise pass the mic to Lantern by itself)
      const mic = await until(async () => { const m = await fetch(`http://127.0.0.1:${LPORT}/api/assistant/mic`).then((r) => r.json()); return JSON.stringify(m).includes('"owner":"dayspring"') ? m : null; }, 6000);
      check("… the real Lantern hears who owns the mic (Dayspring)", mic && JSON.stringify(mic).includes("dayspring"), mic);
      await j("/lantern/mic", { app: "lantern" });
      const mic2 = await until(async () => { const m = await fetch(`http://127.0.0.1:${LPORT}/api/assistant/mic`).then((r) => r.json()); return JSON.stringify(m).includes('"owner":"lantern"') ? m : null; }, 6000);
      check("… handing the mic over reaches the real Lantern", Boolean(mic2), mic2);
      await j("/lantern/mic", { app: "dayspring" });
      const op2 = await j("/lantern/open", {});
      check("… 'open Lantern' reaches the real Lantern with the token", op2.status === 200, op2);
      // stop the real Lantern
      spawnSync(process.execPath, [join(LDR, "scripts", "launch.mjs"), "--stop"], { env: { ...process.env, ECOSYSTEM_DIR: ECO, LANTERN_DATA: LDATA }, windowsHide: true });
      await until(async () => { try { await fetch(`http://127.0.0.1:${LPORT}/api/eco/hello`, { signal: AbortSignal.timeout(500) }); return false; } catch { return true; } }, 15_000);
    }
    rel2.close(); hub.kill();
  } else console.log("SKIP  the real Lantern (no release zip or fake hub found)");
} catch (e) {
  fail++; console.log("FAIL  the test itself stopped: " + (e.stack ?? e.message));
} finally {
  await stopDs().catch(() => {});
  try { mockServer.close(); } catch { /* closed */ }
  if (fail) console.log("\n--- server log (last 40 lines) ---\n" + serverLog.split(/\r?\n/).slice(-40).join("\n"));
  if (!KEEP) { spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true }); try { rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch (e) { console.log("(couldn't remove every temp file yet: " + e.message + ")"); } }
  else console.log("kept " + TMP);
  console.log(`\n${fail ? "FAILED" : "ALL PASSED"}: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
function readdirSafe(d) { try { return readdirSync(d); } catch { return []; } }
import { readdirSync } from "node:fs";
