// Lantern → Dayspring XP, end to end, with a MOCK Lantern (a throwaway ecosystem folder; the real Lantern and the owner's
// Dayspring are never touched): live xp.earned events, the SSE-triggered and 10-minute backfill, idempotency (redelivery,
// both paths, a completion synced from another computer), the verify-first spoken claim, catch-up limits, the summary
// endpoint's guards and the xp.summary push, Dayspring's side of the ecosystem contract (SSE, 421/403/401), and the
// Learning tab and the study-card XP chips in a headless browser.
//   node scripts/qa/lantern-xp.mjs [--keep] [--live]      (--live: also READ the real Lantern on :4321 — GET only)
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const PORT = 4798, BASE = `http://127.0.0.1:${PORT}`, MOCK = 4797;
const TMP = mkdtempSync(join(tmpdir(), "ds-lxp-")), APP = join(TMP, "app"), ECO = join(TMP, "eco");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, pass = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got !== "" ? "  (" + got + ")" : ""}`); };
const iso = (daysAgo, hh = 10) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(hh, 0, 0, 0); return d.toISOString(); };

// ---- the mock Lantern ------------------------------------------------------------------------------------------------
const TOKEN = "mock-" + Math.random().toString(36).slice(2);
const lesson = (id, title, status = "not-started", completedAt = null) => ({ id, title, minutes: 20, status, completedAt, exercises: [] });
const M = {
  received: [], reports: [], sse: new Set(), verified: new Set(),
  courses: {
    py: { id: "py", title: "Python Basics", percent: 4, finished: false, units: [
      { id: "u1", n: 1, title: "Your First Program", lessons: [lesson("u1l1", "What Python Actually Is", "done", iso(0, 8)), { ...lesson("u1l2", "Printing and f-strings"), exercises: [{ id: "u1l2e1", title: "Print a greeting", status: "not-started" }] }, lesson("u1l3", "Variables and Types")], projects: [], check: { id: "u1check", title: "Unit 1 check", status: "not-started" }, done: 1, count: 5 }] },
    sp: { id: "sp", title: "Spanish Basics", percent: 9, finished: false, units: [
      { id: "u1", n: 1, title: "Greetings and Basics", lessons: [lesson("m1-overview", "Module Overview", "done", iso(0, 9)), lesson("m1-concepts", "Key Concepts")], projects: [], check: { id: "check-1", title: "Greetings check", status: "not-started" }, done: 1, count: 3 },
      { id: "u2", n: 2, title: "Old unit (done months ago)", lessons: Array.from({ length: 24 }, (_, i) => lesson(`old${i}`, `Old lesson ${i}`, "done", iso(60 - i, 10))), projects: [], check: null, done: 24, count: 24 }] },
  },
};
const statusOf = () => ({ app: "lantern", courses: Object.values(M.courses).map((c) => ({ id: c.id, title: c.title, installed: true, percent: c.percent, measure: `${c.percent}%`, next: { id: "n", title: "Next thing", kind: "lesson" }, current: null, minutesLeft: 300 })), sync: { online: true } });
const body = (req) => new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch { ok({}); } }); });
const mock = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"), json = (s, o) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  const tokOk = req.headers["x-eco-token"] === TOKEN;
  if (u.pathname === "/api/eco/hello") return json(200, { app: "lantern", version: "9.9.9", schema: 1 });
  if (u.pathname === "/api/eco/event" && req.method === "POST") { if (!tokOk) return json(401, {}); M.received.push(await body(req)); return json(200, { ok: true }); }
  if (u.pathname === "/api/local/status") return json(200, statusOf());
  const cm = /^\/api\/local\/courses\/(.+)$/.exec(u.pathname); if (cm) return M.courses[cm[1]] ? json(200, M.courses[cm[1]]) : json(404, {});
  if (u.pathname === "/api/local/events") { res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" }); res.write(": hi\n\n"); M.sse.add(res); req.on("close", () => M.sse.delete(res)); return; }
  if (u.pathname === "/api/local/report" && req.method === "POST") { if (!tokOk) return json(401, {}); const b = await body(req); M.reports.push(b); const v = M.verified.has(`${b.course}:${b.lesson}`); return json(200, { verified: v, lesson: { status: v ? "done" : "not-started" }, message: v ? "Done" : "Not finished yet", next: { title: "Scope and Names" }, percent: 7 }); }
  json(404, {});
});
await new Promise((ok) => mock.listen(MOCK, "127.0.0.1", ok));
const sse = (type, data) => { for (const r of M.sse) r.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); };
mkdirSync(join(ECO, "apps"), { recursive: true });
writeFileSync(join(ECO, "apps", "lantern.json"), JSON.stringify({ app: "lantern", version: "9.9.9", port: MOCK, pid: process.pid, startedAt: Date.now(), token: TOKEN, api: "/api/eco", schema: 1 }));

// ---- Dayspring (a throwaway copy, its ecosystem folder = the mock's) ----------------------------------------------------
spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(join(APP, "data"), { recursive: true });
writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Casey", setupDone: true, display: "primary" }));
const env = { ...process.env, PORT: String(PORT), ECOSYSTEM_DIR: ECO, DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1",
  ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", ELEVENLABS_API_KEY: "", AI_PROVIDER: "none" };
delete env.DAYSPRING_NO_ECO;
const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = ""; server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
await sleep(1500);
const api = (p, b) => fetch(BASE + "/api" + p, b ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) } : {}).then((r) => r.json());
const dsToken = () => JSON.parse(readFileSync(join(ECO, "apps", "dayspring.json"), "utf8")).token;
const ecoPost = (ev, headers = {}) => fetch(`${BASE}/api/eco/event`, { method: "POST", headers: { "content-type": "application/json", "x-eco-token": dsToken(), ...headers }, body: JSON.stringify({ v: 1, id: "ev" + Math.random(), source: "lantern", at: Date.now(), ...ev }) });
// raw requests (fetch can't set Host)
const raw = (path, { method = "GET", headers = {} } = {}) => new Promise((ok) => { const r = request({ host: "127.0.0.1", port: PORT, path, method, headers }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => ok({ status: res.statusCode, headers: res.headers, body: b })); }); r.on("error", () => ok({ status: 0 })); r.end(); });

const browser = await chromium.launch({ channel: (await import(pathToFileURL(join(DESK, "lib", "browsers.mjs")).href)).playwrightChannel(), headless: true, args: ["--mute-audio"] });
try {
  // ---- Dayspring's side of the ecosystem contract
  const sseFirst = await new Promise((ok) => { const r = request({ host: "127.0.0.1", port: PORT, path: "/api/eco/events", headers: { host: `127.0.0.1:${PORT}` } }, (res) => { res.once("data", (c) => { ok({ type: res.headers["content-type"], first: String(c) }); res.destroy(); }); }); r.on("error", () => ok({})); setTimeout(() => ok({ timeout: true }), 1500); r.end(); });
  check("GET /api/eco/events really streams: event-stream headers and a hello straight away", /text\/event-stream/.test(sseFirst.type ?? "") && /event: hello/.test(sseFirst.first ?? ""), JSON.stringify(sseFirst).slice(0, 120));
  check("a foreign Host gets 421", (await raw("/api/eco/hello", { headers: { host: "evil.example" } })).status === 421);
  check("a foreign Origin gets 403", (await raw("/api/eco/hello", { headers: { host: `127.0.0.1:${PORT}`, origin: "https://evil.example" } })).status === 403);
  check("an eco event without the token gets 401", (await raw("/api/eco/event", { method: "POST", headers: { host: `127.0.0.1:${PORT}`, "content-type": "application/json" } })).status === 401);
  check("the summary without the token gets 401", (await raw("/api/xp/summary", { headers: { host: `127.0.0.1:${PORT}` } })).status === 401);
  check("the summary from another website gets 403", (await raw("/api/xp/summary", { headers: { host: `127.0.0.1:${PORT}`, origin: "https://evil.example", "x-eco-token": dsToken() } })).status === 403);

  // ---- live
  const x0 = await api("/xp");
  // verify-first: an event for something Lantern's own course detail doesn't show as done earns nothing (queued)
  await ecoPost({ type: "xp.earned", data: { key: "lantern:py:exercise:u1l2e1", kind: "exercise", course: "py", ref: "u1l2e1", verified: true } });
  await sleep(400);
  { const lt = (await api("/xp")).lifetime, w = (await api("/xp/learning")).waiting; check("verify-first: a live event Lantern doesn't show as done earns nothing yet", lt === x0.lifetime && w >= 1, `${x0.lifetime} → ${lt}, waiting ${w}`); }
  await ecoPost({ type: "xp.earned", data: { key: "lantern:py:course:py", kind: "exercise", course: "py", ref: "u1l2e1", verified: true } });
  await sleep(300);
  check("a live event whose key doesn't match what it says earns nothing", (await api("/xp")).lifetime === x0.lifetime);
  M.courses.py.units[0].lessons[1].exercises[0] = { ...M.courses.py.units[0].lessons[1].exercises[0], status: "passed", completedAt: new Date().toISOString() };   // Lantern verified it
  const r1 = await ecoPost({ type: "xp.earned", data: { key: "lantern:py:exercise:u1l2e1", kind: "exercise", course: "py", courseTitle: "Python Basics", ref: "u1l2e1", title: "Print a greeting", authoredXp: 50, at: new Date().toISOString(), verified: true } });
  await sleep(400);
  const x1 = await api("/xp");
  check("live: an xp.earned event awards XP", r1.ok && x1.lifetime - x0.lifetime === 5, `${x0.lifetime} → ${x1.lifetime}`);
  await ecoPost({ type: "xp.earned", data: { key: "lantern:py:exercise:u1l2e1", kind: "exercise", course: "py", ref: "u1l2e1", verified: true } });
  await sleep(300);
  check("redelivery doesn't count it twice", (await api("/xp")).lifetime === x1.lifetime);
  await sleep(2500);
  check("Lantern's hub gets an xp.summary push", M.received.some((e) => e.type === "xp.summary" && e.data?.perCourse?.py?.xpAwarded >= 5), `${M.received.length} events`);

  // ---- the backfill (and the live event path meeting it)
  await ecoPost({ type: "lesson.completed", data: { course: "py", ref: "u1l1" } });            // live first…
  await sleep(300);
  const s1 = await api("/xp/learning/sync", {});                                                 // …then the backfill
  const keysAfter = (await api("/xp/learning")).perCourse;
  check("backfill: finished things are awarded, the live one only once", s1.ok && keysAfter.py.itemsCompleted === 2 && keysAfter.sp.itemsCompleted >= 2, JSON.stringify({ awarded: s1.awarded, py: keysAfter.py?.itemsCompleted, fs: keysAfter.sp?.itemsCompleted }));
  const s2 = await api("/xp/learning/sync", {});
  check("a second backfill finds nothing new", s2.ok && s2.awarded === 0, JSON.stringify(s2).slice(0, 80));
  const catchupXp = (s1.results ?? []).filter((r) => r.catchup).reduce((s, r) => s + r.amount, 0);
  check("catch-up: old completions count (at most 200 a day) but add nothing to spend", s1.catchup >= 10 && catchupXp <= 200 && (s1.results ?? []).filter((r) => r.catchup).every((r) => r.spendable === 0) && (await api("/xp")).balance - x1.balance <= 30, `catch-up ${s1.catchup}, ${catchupXp} XP`);
  // a lesson finished on another computer arrives through Lantern's hub, and Lantern says so on its event stream
  M.courses.sp.units[0].lessons[1] = { ...M.courses.sp.units[0].lessons[1], status: "done", completedAt: new Date().toISOString() };
  const before = (await api("/xp/learning")).perCourse.sp.itemsCompleted;
  sse("progress", { course: "sp" });
  await sleep(3500);
  const after = (await api("/xp/learning")).perCourse.sp.itemsCompleted;
  check("Lantern's event stream triggers a backfill: another computer's lesson counts once", after === before + 1, `${before} → ${after}`);
  sse("progress", { course: "sp" }); await sleep(3000);
  check("…and only once", (await api("/xp/learning")).perCourse.sp.itemsCompleted === after);

  // ---- the verify-first spoken claim
  const c1 = await api("/chat", { message: "I finished lesson 3 in python", surface: "desk" });
  check("a claim Lantern can't verify earns nothing, kindly", /doesn't show “Variables and Types” as finished yet/.test(c1.reply ?? "") && /count automatically/.test(c1.reply ?? ""), c1.reply);
  M.verified.add("py:u1l3");
  const lt = (await api("/xp")).lifetime;
  const c2 = await api("/chat", { message: "I finished lesson 3 in python", surface: "desk" });
  check("a verified claim earns the lesson", /Lantern confirms it: “Variables and Types” is done\. \+12 XP/.test(c2.reply ?? "") && (await api("/xp")).lifetime === lt + 12, c2.reply);
  check("the claim was checked with Lantern (with its token)", M.reports.length === 2 && M.reports[0].course === "py");

  // ---- the summary endpoint for Lantern
  const sm = await fetch(`${BASE}/api/xp/summary`, { headers: { "x-eco-token": dsToken() } }).then((r) => r.json());
  check("GET /api/xp/summary (with the token): balance, level, streak, badges, per course", typeof sm.balance === "number" && sm.level >= 1 && sm.badges && sm.perCourse?.py?.itemsCompleted === 3, JSON.stringify(sm).slice(0, 160));
  // ---- voice
  const v1 = await api("/chat", { message: "how much xp have I earned from python", surface: "desk" });
  check("voice: 'how much XP have I earned from Python Basics'", /^You've earned \d+ XP from Python Basics: 3 things finished/.test(v1.reply ?? ""), v1.reply);
  const v2 = await api("/chat", { message: "what did I finish this week", surface: "desk" });
  check("voice: 'what did I finish this week'", /^This week you finished/.test(v2.reply ?? ""), v2.reply);
  // ---- badges from learning
  const b = await api("/xp/badges");
  check("learning moves the Study & Learning badges", b.categories.find((c) => c.cat === "study").credit > 0, String(b.categories.find((c) => c.cat === "study").credit));

  // ---- the UI
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { window.__dsAllowAutomatedListen = false; if (window.speechSynthesis) window.speechSynthesis.speak = () => {}; });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${BASE}/progress#learning`); await p.waitForSelector(".ln-course", { timeout: 8000 });
  const ui = await p.evaluate(() => ({ courses: [...document.querySelectorAll(".ln-course")].map((s) => ({ t: s.querySelector("h3")?.textContent, xp: s.querySelector(".ln-xp")?.textContent, bar: s.querySelector(".ln-bar i")?.style.width })), recent: document.querySelector(".ln-recent")?.innerText ?? "", week: document.querySelector(".ln-week")?.innerText ?? "" }));
  check("Learning tab: each course with its progress bar and XP", ui.courses.length === 2 && ui.courses.every((c) => /\d+ XP earned/.test(c.xp) && /%$/.test(c.bar)), JSON.stringify(ui.courses));
  check("Learning tab: recent completions ('Passed exercise “Print a greeting”')", /Passed exercise “Print a greeting”/.test(ui.recent) && /Finished lesson/.test(ui.recent), ui.recent.slice(0, 160));
  check("Learning tab: the week (lessons, practice minutes, XP, streak)", /lessons/.test(ui.week) && /learning XP/.test(ui.week), ui.week.replace(/\s+/g, " ").slice(0, 120));
  const disp = await ctx.newPage(); disp.on("pageerror", (e) => errors.push(e.message));
  await disp.goto(`${BASE}/display`); await disp.waitForTimeout(3500);
  if (await disp.locator("#startBtn").isVisible().catch(() => false)) { await disp.click("#startBtn"); await disp.waitForTimeout(1500); }
  await disp.waitForTimeout(2500);
  const chips = await disp.evaluate(() => [...document.querySelectorAll(".course.lnc .xpchip")].map((c) => c.textContent));
  check("the study cards on the display show XP chips", chips.length === 2 && chips.every((c) => /\d+ XP/.test(c)), JSON.stringify(chips));
  check("no page errors", !errors.length, errors.join(" | "));

  // ---- optional: the real Lantern, read-only
  if (process.argv.includes("--live")) {
    const { completions } = await import(pathToFileURL(join(DESK, "lib", "xp", "learning.mjs")).href);
    try {
      const st = await fetch("http://127.0.0.1:4321/api/local/status", { signal: AbortSignal.timeout(3000) }).then((r) => r.json());
      for (const c of st.courses ?? []) {
        const d = await fetch(`http://127.0.0.1:4321/api/local/courses/${c.id}`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json());
        console.log(`      live (read-only): ${c.id} "${c.title}": ${c.percent}%, ${(d.units ?? []).length} units, ${completions(d).length} completed item(s) Dayspring would count`);
      }
      check("live (read-only): the real Lantern's status and courses parse", (st.courses ?? []).length > 0);
    } catch (e) { console.log(`      live: the real Lantern isn't reachable (${e.message})`); }
  }
} finally {
  await browser.close().catch(() => {});
  server.kill(); mock.close(); for (const r of M.sse) r.destroy();
  await sleep(500);
  spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true });
  if (!process.argv.includes("--keep")) rmSync(TMP, { recursive: true, force: true });
}
if (fail) console.log(serverLog.split("\n").filter((l) => /error|xp|lantern|eco/i.test(l)).slice(-20).join("\n"));
console.log(`\n${fail ? "FAILED" : "ALL PASSED"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
