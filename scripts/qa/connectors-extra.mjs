// Tests for the extra connectors (calendar subscriptions, news feeds, Home Assistant, webhooks, Todoist, weather alerts)
// against a local stub server. Nothing real is called: every fetch to anything but 127.0.0.1 fails the test, and
// connector files go to a temporary folder. Run: node scripts/qa/connectors-extra.mjs
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const tmp = mkdtempSync(join(tmpdir(), "ds-connectors-"));
process.env.DAYSPRING_CONNECTORS_DIR = tmp;
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => { if (!/^http:\/\/127\.0\.0\.1:/.test(String(url))) throw new Error(`test tried to reach the internet: ${url}`); return realFetch(url, opts); };

// ---- the stub ----
const calls = [];
const today = new Date(), ymd = (d) => d.toLocaleDateString("en-CA").replace(/-/g, "");
const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) - 7);   // last week's Monday
const plus = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const ICS = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-CALNAME:Soccer",
  "BEGIN:VEVENT", "UID:practice", `DTSTART:${ymd(monday)}T180000`, `DTEND:${ymd(monday)}T193000`, "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=8",
  `EXDATE:${ymd(plus(monday, 9))}T180000`, "SUMMARY:Practice", "LOCATION:Field 3\\, North park", "END:VEVENT",
  "BEGIN:VEVENT", "UID:game", `DTSTART;VALUE=DATE:${ymd(plus(monday, 12))}`, "SUMMARY:Tournament day", "DESCRIPTION:Bring snacks\\nand water", "END:VEVENT",
  "END:VCALENDAR", ""].join("\r\n");
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Stub News</title>
<item><title>Rocket lands safely</title><link>https://example.com/a</link><pubDate>${new Date().toUTCString()}</pubDate><description><![CDATA[<p>It <b>landed</b>.</p>]]></description></item>
<item><title>Older story</title><link>https://example.com/b</link><pubDate>not a date</pubDate></item></channel></rss>`;
const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Stub Blog</title><entry><title>Hello Atom</title><link href="https://example.com/c"/><updated>2026-09-01T10:00:00Z</updated><summary>Hi</summary></entry></feed>`;
const STATES = [
  { entity_id: "light.kitchen", state: "on", attributes: { friendly_name: "Kitchen lights" } },
  { entity_id: "cover.garage_door", state: "closed", attributes: { friendly_name: "Garage door", device_class: "garage" } },
  { entity_id: "lock.front_door", state: "locked", attributes: { friendly_name: "Front door" } },
  { entity_id: "climate.thermostat", state: "heat", attributes: { friendly_name: "Thermostat", temperature: 68, current_temperature: 66 } },
  { entity_id: "sensor.nursery_temperature", state: "71", attributes: { friendly_name: "Nursery temperature", unit_of_measurement: "°F" } },
  { entity_id: "scene.movie_night", state: "scening", attributes: { friendly_name: "Movie night" } },
];
let todo = [{ id: "t1", content: "Call the dentist", project_id: "p1", priority: 1, due: { date: today.toLocaleDateString("en-CA"), string: "today" } },
  { id: "t2", content: "Buy stamps", project_id: "p1", priority: 2, due: null }];
let nwsMode = "us";
const server = createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  const u = new URL(req.url, "http://x"), p = u.pathname;
  calls.push({ m: req.method, p, body, auth: req.headers.authorization });
  const json = (s, o) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  if (p === "/cal.ics") { res.writeHead(200, { "content-type": "text/calendar" }); return res.end(ICS); }
  if (p === "/notcal") { res.writeHead(200); return res.end("<html>hi</html>"); }
  if (p === "/rss.xml") { res.writeHead(200); return res.end(RSS); }
  if (p === "/atom.xml") { res.writeHead(200); return res.end(ATOM); }
  if (p.startsWith("/ha/api")) {
    if (req.headers.authorization !== `Bearer ${"h".repeat(60)}`) return json(401, { message: "401: Unauthorized" });
    const hp = p.slice(7);
    if (hp === "/") return json(200, { message: "API running." });
    if (hp === "/config") return json(200, { location_name: "Test Home" });
    if (hp === "/states") return json(200, STATES);
    if (hp.startsWith("/services/")) return json(200, []);
  }
  if (p === "/hook") return json(200, { ok: true });
  if (p.startsWith("/todoist")) {
    if (req.headers.authorization !== `Bearer ${"a1".repeat(20)}`) return json(401, {});
    const tp = p.slice(8);
    if (tp === "/projects") return json(200, { results: [{ id: "p1", name: "Home" }], next_cursor: null });
    if (tp === "/tasks" && req.method === "GET") return json(200, { results: todo, next_cursor: null });
    if (tp === "/tasks" && req.method === "POST") { const b = JSON.parse(body); const t = { id: "t3", content: b.content, project_id: "p1", due: b.due_string ? { date: "2026-10-01", string: b.due_string } : null }; todo.push(t); return json(200, t); }
    const cm = /^\/tasks\/(\w+)\/close$/.exec(tp); if (cm) { todo = todo.filter((t) => t.id !== cm[1]); res.writeHead(204); return res.end(); }
  }
  if (p === "/nws/alerts/active") {
    if (nwsMode === "intl") return json(404, { title: "not found" });
    return json(200, { features: [
      { properties: { id: "a1", event: "Tornado Warning", severity: "Extreme", headline: "Tornado Warning until 6 PM", instruction: "Take shelter now. Go to a basement.", status: "Actual", messageType: "Alert" } },
      { properties: { id: "a2", event: "Test Message", severity: "Minor", headline: "test", status: "Test", messageType: "Alert" } },
      { properties: { id: "a3", event: "Wind Advisory", severity: "Minor", headline: "Wind Advisory", status: "Actual", messageType: "Alert" } }] });
  }
  if (p === "/meteo/forecast") {
    const t = Array.from({ length: 12 }, (_, i) => `2026-09-25T${String(i + 8).padStart(2, "0")}:00`);
    return json(200, { hourly: { time: t, weather_code: t.map((_, i) => (i === 3 ? 95 : 1)), wind_gusts_10m: t.map(() => 20), precipitation: t.map(() => 0), apparent_temperature: t.map(() => 20) } });
  }
  json(404, { error: "stub: no route " + p });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const B = `http://127.0.0.1:${server.address().port}`;
process.env.TODOIST_API_BASE = `${B}/todoist`;
process.env.NWS_API_BASE = `${B}/nws`;
process.env.OPEN_METEO_BASE = `${B}/meteo`;

const cx = await import("../../lib/connectors/index.mjs");
const { ics, feeds, homeassistant: ha, webhooks, todoist, weatheralerts } = cx;
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.log("  ✗", name, "\n   ", e.stack?.split("\n").slice(0, 3).join("\n    ")); process.exitCode = 1; } };
const iso = (d) => d.toLocaleDateString("en-CA");

console.log("calendar subscriptions");
await test("parse: unfolding, escapes, RRULE, EXDATE, all-day", async () => {
  const cal = ics.parse(ICS.replace("SUMMARY:Practice", "SUMMARY:Prac\r\n tice"));
  assert.equal(cal.name, "Soccer");
  assert.equal(cal.events.find((e) => e.uid === "practice").title, "Practice");
  assert.equal(cal.events.find((e) => e.uid === "game").notes, "Bring snacks\nand water");
});
await test("rejects a page that isn't a calendar", async () => { await assert.rejects(ics.connect({ url: `${B}/notcal` }), /didn't return a calendar/); });
await test("subscribe + events in range (weekly Mon/Wed, minus the EXDATE)", async () => {
  const s = await ics.connect({ url: `${B}/cal.ics` });
  assert.equal(s.calendars[0].name, "Soccer");
  const ev = await ics.events(iso(monday), iso(plus(monday, 13)));
  const practice = ev.filter((e) => e.title === "Practice").map((e) => e.date);
  assert.deepEqual(practice, [0, 2, 7].map((n) => iso(plus(monday, n))));   // Mon, Wed, Mon; Wed (day 9) is excluded
  const p0 = ev.find((e) => e.title === "Practice");
  assert.equal(p0.start, "18:00"); assert.equal(p0.end, "19:30"); assert.equal(p0.where, "Field 3, North park"); assert.equal(p0.source, "ics");
  const game = ev.find((e) => e.title === "Tournament day");
  assert.ok(game.allDay); assert.equal(game.date, iso(plus(monday, 12)));
});
await test("merged into externalEvents", async () => {
  cx.clearCache();
  const ev = await cx.externalEvents(iso(monday), iso(plus(monday, 13)));
  assert.ok(ev.some((e) => e.source === "ics" && e.title === "Tournament day"));
});
await test("remove by name", async () => { assert.equal(ics.remove({ id: "soccer" }).connected, false); });

console.log("news feeds");
await test("RSS + Atom parse, bad dates don't throw, HTML stripped", async () => {
  const r = feeds.parseFeed(RSS);
  assert.equal(r.title, "Stub News"); assert.equal(r.items.length, 2);
  assert.equal(r.items[1].published, null);
  assert.ok(!/<b>/.test(r.items[0].summary ?? ""));
  assert.equal(feeds.parseFeed(ATOM).items[0].link, "https://example.com/c");
});
await test("add by link, latest, 'read me the latest from stub'", async () => {
  await feeds.connect({ url: `${B}/rss.xml` });
  await feeds.connect({ url: `${B}/atom.xml`, name: "Stub Blog" });
  const items = await feeds.latest({ limit: 5 });
  assert.equal(items[0].title, "Rocket lands safely");
  const said = await cx.handle("Read me the latest from stub blog");
  assert.match(said, /Hello Atom/);
  assert.match(await cx.handle("what's the news?"), /Rocket lands safely/);
});
await test("topics map to starter feeds (no fetch)", async () => {
  const s = await feeds.connect({ topic: "technology" });
  assert.ok(s.feeds.some((f) => /arstechnica|verge|news\.google/.test(f.host) && f.topic === "tech"));
  feeds.disconnect();
});

console.log("Home Assistant");
const tok = "h".repeat(60);
await test("bad token and wrong address are friendly", async () => {
  await assert.rejects(ha.connect({ url: `${B}/ha`, token: "x".repeat(60) }), /didn't accept the token/);
  await assert.rejects(ha.connect({ url: `${B}/ha`, token: "short" }), /long-lived access token/);
});
await test("connect, find, state, describe", async () => {
  assert.equal((await ha.connect({ url: `${B}/ha/`, token: tok })).who, "Test Home");
  assert.equal((await ha.find("the kitchen lights")).entity_id, "light.kitchen");
  assert.equal((await ha.state("garage door")).text, "Garage door is closed");
  assert.match((await ha.state("thermostat")).text, /set to 68°, and it's 66° now/);
});
await test("voice: turn off the kitchen lights, is the garage door closed, thermostat, scene", async () => {
  calls.length = 0;
  assert.match(await cx.handle("Turn off the kitchen lights"), /Kitchen lights is off/);
  assert.ok(calls.some((c) => c.p === "/ha/api/services/light/turn_off" && JSON.parse(c.body).entity_id === "light.kitchen"));
  assert.match(await cx.handle("Is the garage door closed?"), /Garage door is closed/);
  assert.match(await cx.handle("set the thermostat to 70"), /set to 70/);
  assert.ok(calls.some((c) => c.p === "/ha/api/services/climate/set_temperature" && JSON.parse(c.body).temperature === 70));
  assert.match(await cx.handle("what's the temperature in the nursery"), /71 °F/);
  assert.match(await cx.handle("run the movie night scene"), /running/);
});
await test("unlock / garage open / disarm need a yes; nothing is sent without it", async () => {
  calls.length = 0;
  const a = await cx.runTool("home_control", { name: "front door", action: "unlock" });
  const b = await cx.runTool("home_control", { name: "garage door", action: "open" });
  assert.ok(a.needsConfirm && b.needsConfirm); assert.match(a.text, /Just to be sure: unlock Front door/);
  assert.equal(calls.filter((c) => c.p.includes("/services/")).length, 0);
  assert.equal(await cx.handle("turn on the garage door"), null);   // voice without AI never opens it (falls through)
  assert.equal(calls.filter((c) => c.p.includes("/services/")).length, 0);
  const c = await cx.runTool("home_control", { name: "front door", action: "unlock", confirmed: true });
  assert.equal(c.service, "unlock");
});
await test("unknown device falls through to the AI", async () => { assert.equal(await cx.handle("turn on the spaceship"), null); ha.disconnect(); });

console.log("webhooks");
await test("outgoing: add, exact phrase runs it, loose talk doesn't", async () => {
  assert.throws(() => webhooks.connect({ name: "x", url: "http://evil.example.com/h" }), /https/);
  webhooks.connect({ name: "Leaving home", phrase: "I'm leaving", url: `${B}/hook` });
  calls.length = 0;
  assert.match(await cx.handle("I'm leaving"), /Done: Leaving home/);
  const sent = JSON.parse(calls.find((c) => c.p === "/hook").body);
  assert.equal(sent.source, "Dayspring");
  assert.equal(webhooks.matchPhrase("I'm leaving the room in a bit"), null);
  assert.equal((await cx.runTool("webhook_run", { name: "leaving home", payload: { value1: "x" } })).ran, "Leaving home");
});
await test("incoming: wrong secret 404, say → announce, remind → reminder", async () => {
  const said = [], reminded = [];
  const deps = { announce: (x) => said.push(x), addReminder: (x) => (reminded.push(x), { id: "r1" }) };
  assert.equal((await webhooks.incoming("nope", { say: "hi" }, deps)).status, 404);
  const s = webhooks.secret();
  assert.equal((await webhooks.incoming(s, { say: "The laundry is done" }, deps)).status, 200);
  assert.deepEqual(said[0], { kind: "hook", title: "Message", text: "The laundry is done" });
  assert.equal((await webhooks.incoming(s, { remind: "Bread", minutes: 20 }, deps)).status, 200);
  assert.equal(reminded[0].text, "Bread"); assert.match(reminded[0].time, /^\d\d:\d\d$/);
  assert.equal((await webhooks.incoming(s, {}, deps)).status, 400);
  assert.ok(webhooks.incomingUrl().endsWith(s));
  webhooks.disconnect(); assert.equal(webhooks.secret(), s);   // the address survives disconnect
});

console.log("Todoist");
const ttok = "a1".repeat(20);
await test("token checks", async () => {
  await assert.rejects(todoist.connect({ token: "nope" }), /40 letters/);
  await assert.rejects(todoist.connect({ token: "b2".repeat(20) }), /didn't accept/);
  assert.equal((await todoist.connect({ token: ttok })).who, "1 project");
});
await test("list, add, complete (and by voice)", async () => {
  const t = await todoist.tasks();
  assert.equal(t.tasks[0].title, "Call the dentist"); assert.equal(t.tasks[0].project, "Home");
  assert.equal((await todoist.tasks({ dueToday: true })).tasks.length, 1);
  assert.match(await cx.handle("what's on my todoist"), /Call the dentist \(today\); Buy stamps/);
  assert.match(await cx.handle("add walk the dog to todoist for tomorrow 5pm"), /Added “walk the dog” to Todoist, tomorrow 5pm/);
  assert.equal(JSON.parse(calls.findLast((c) => c.p === "/todoist/tasks" && c.m === "POST").body).due_string, "tomorrow 5pm");
  assert.deepEqual(await todoist.complete({ match: "zzz" }), { error: "No open Todoist task matches “zzz”." });
  assert.equal((await cx.runTool("todoist_complete", { match: "dentist" })).completed, "Call the dentist");
  todoist.disconnect();
});

console.log("weather alerts");
await test("US: official alerts, tests filtered", async () => {
  weatheralerts._setTestLocation({ lat: 39.1, lon: -94.6, place: "Testville" });
  const r = await weatheralerts.current({ fresh: true });
  assert.equal(r.source, "National Weather Service");
  assert.deepEqual(r.alerts.map((a) => a.id), ["a1", "a3"]);
  assert.match(await cx.handle("any weather alerts?"), /For Testville: Tornado Warning until 6 PM/);
});
await test("elsewhere: forecast heads-up, labeled not official", async () => {
  nwsMode = "intl";
  weatheralerts._setTestLocation({ lat: 51.5, lon: -0.1, place: "Testford" });
  const r = await weatheralerts.current({ fresh: true });
  assert.equal(r.alerts[0].event, "Thunderstorms"); assert.equal(r.alerts[0].official, false);
  assert.match(await cx.handle("are there any weather warnings"), /not an official warning/);
});
await test("background: announces the extreme alert once", async () => {
  nwsMode = "us"; weatheralerts._setTestLocation({ lat: 39.1, lon: -94.6, place: "Testville" });
  const said = [];
  const realSetTimeout = globalThis.setTimeout;
  let first; globalThis.setTimeout = (fn) => { first = fn; return 0; };
  weatheralerts.startBackground((x) => said.push(x));
  globalThis.setTimeout = realSetTimeout;
  await first(); await first();
  weatheralerts.stopBackground();
  assert.equal(said.length, 1); assert.equal(said[0].kind, "weather"); assert.match(said[0].text, /Tornado Warning.*Take shelter now\./);
});
await test("off when disconnected; no town → a friendly note", async () => {
  weatheralerts.disconnect(); assert.equal(weatheralerts.connected(), false);
  weatheralerts._setTestLocation({ lat: 0, lon: 0 });
  assert.match((await weatheralerts.current({ fresh: true })).note, /Where you are/);
});

console.log("wiring");
await test("statuses, guides, tools, context", async () => {
  const s = cx.statuses();
  for (const k of ["ics", "feeds", "homeassistant", "webhooks", "todoist", "weatheralerts"]) { assert.equal(s[k].id, k); assert.ok(cx.list().some((a) => a.id === k), `guide for ${k}`); }
  for (const t of ["calendar_subscribe", "news_latest", "news_add_feed", "home_devices", "home_state", "home_control", "webhook_run", "todoist_tasks", "todoist_add", "todoist_complete", "weather_alerts"]) assert.ok(cx.TOOLS.some((x) => x.name === t), t);
  assert.equal(await cx.runTool("not_a_tool", {}), undefined);
});

server.close(); rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
process.exit(process.exitCode ?? 0);
