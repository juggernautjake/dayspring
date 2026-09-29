// Maps (lib/maps, public/maps.js, feature "maps"), against a mock of every map service: no real service is ever asked.
//   A. in this process: each service's answer read correctly (Nominatim, Photon, Google Places and Autocomplete;
//      OSRM, OpenRouteService, Google Routes incl. transit) into places and steps; the spoken words (units, rounding,
//      street names); next / previous / repeat / first; ETA and distance left; "leave by"; which service answers
//      (automatic, forced free, forced Google without a key); the key test (good, wrong, an API not turned on); the
//      free route service's "couldn't avoid" fallback; the voice commands (and what they must leave alone); the AI's
//      tools; the live-position hook; the feature switch (off: no routes, tools or commands)
//   B. a throwaway copy (port 4777, its own data) and headless Chrome (muted): the window, suggestions as you type,
//      search near home, a route drawn with its steps, Next / a clicked step / Previous (said through the floor), the
//      QR code, the narrow layout, saving and testing a Google key over HTTP and in Settings → Maps (the key never comes
//      back), Google's map, voice through /api/chat, "leave by" and its reminder, the map pictures kept, Esc
//   node scripts/qa/maps.mjs [--module] [--keep]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { qaPort } from "./port.mjs";   // a free port (or QA_PORT), so parallel runs never collide
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const TMP = mkdtempSync(join(tmpdir(), "ds-maps-"));
const FX = JSON.parse(readFileSync(join(DESK, "scripts", "qa", "fixtures", "maps", "responses.json"), "utf8"));
let pass = 0, fail = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && got !== "" ? `  (${typeof got === "string" ? got : JSON.stringify(got)})`.slice(0, 500) : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch { /* again */ } await sleep(60); } return false; };
const imp = (p) => import(pathToFileURL(join(DESK, p)).href);

// ---- the mock map services --------------------------------------------------------------------------------------------
const GOOD = "test-google-key-good-0001", NOROUTES = "test-google-key-noroutes-02", ORS_GOOD = "good-ors-key-1234";
const PNG1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const log = [];
const mock = createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  const u = new URL(req.url, "http://x"), p = u.pathname, key = req.headers["x-goog-api-key"] ?? req.headers.authorization ?? "";
  log.push({ p, q: u.search, ua: req.headers["user-agent"] ?? "", key, mask: req.headers["x-goog-fieldmask"] ?? "", body });
  const json = (code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  if (p === "/nominatim/search") { const q = (u.searchParams.get("q") ?? "").toLowerCase(); return json(200, /cafe|coffee/.test(q) ? FX.nominatimCoffee : /library/.test(q) ? FX.nominatimLibrary : /springfield/.test(q) ? FX.nominatimTown : []); }
  if (p === "/photon/api/") return json(200, FX.photon);
  if (p.startsWith("/osrm/")) return u.searchParams.get("exclude") ? json(400, { code: "InvalidValue", message: "Exclude flag combination is not supported." }) : json(200, FX.osrm);
  if (p.startsWith("/ors/v2/directions/")) return key === ORS_GOOD ? json(200, FX.ors) : json(403, { error: "Access to this API has been disallowed" });
  if (p.startsWith("/google-")) {
    if (key !== GOOD && key !== NOROUTES) return json(400, FX.googleBadKey);
    if (p === "/google-places/v1/places:searchText") return json(200, FX.googlePlaces);
    if (p === "/google-places/v1/places:autocomplete") return json(200, FX.googleAutocomplete);
    if (p.startsWith("/google-places/v1/places/")) return json(200, FX.googleDetails);
    if (p === "/google-routes/directions/v2:computeRoutes") { if (key === NOROUTES) return json(403, FX.googleDisabled); return json(200, /"TRANSIT"/.test(body) ? FX.googleTransit : FX.googleRoutes); }
  }
  if (p.startsWith("/tiles/")) { res.writeHead(200, { "content-type": "image/png" }); return res.end(PNG1); }
  json(404, { error: "no such mock" });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const MOCK = `http://127.0.0.1:${mock.address().port}`;
const ORIGINAL_ENV = { ...process.env };
for (const k of ["GOOGLE_MAPS_API_KEY", "OPENROUTESERVICE_API_KEY"]) delete process.env[k];
Object.assign(process.env, { DAYSPRING_MAPS_MOCK: MOCK, DAYSPRING_MAPS_FILE: join(TMP, "maps.json"), DAYSPRING_MAPS_TILES_DIR: join(TMP, "tiles"), DAYSPRING_DATA_DIR: join(TMP, "data"),
  DAYSPRING_ENV_FILE: join(TMP, "a.env"), DAYSPRING_CHANNEL: "dev", DAYSPRING_NO_BROWSER: "1", DAYSPRING_SETTINGS_FILE: join(TMP, "settings.json") });
mkdirSync(join(TMP, "data"), { recursive: true });

// ======================================================================================================================= A
const W = await imp("lib/maps/words.mjs"), S = await imp("lib/maps/search.mjs"), R = await imp("lib/maps/route.mjs"), N = await imp("lib/maps/net.mjs");
const settings = await imp("lib/maps/settings.mjs"), guide = await imp("lib/maps/guide.mjs"), skills = await imp("lib/maps/skills.mjs"), routes = await imp("lib/maps/routes.mjs");
const HOME = { place: "Springfield, Illinois", lat: 39.7817, lon: -89.6501 };
const announced = [], notified = [], events = [];
let homeNow = HOME, notifyAnswer = { sent: 0, reason: "not signed in" };
const NOW = new Date(2030, 9, 1, 13, 0);
guide.setDeps({ broadcast: (t, d) => events.push([t, d]), announce: (x) => announced.push(x), home: () => homeNow, notify: async (m) => { notified.push(m); return notifyAnswer; }, now: () => NOW });

// A1. each service's answer
{
  const n = S.parseNominatim(FX.nominatimCoffee);
  check("Nominatim: name, street address, town, location, kind, hours", n.length === 2 && n[0].name === "Bean There Cafe" && n[0].address === "210 East Adams Street, Springfield, Illinois" && n[0].lat === 39.7902 && n[0].category === "cafe" && /Mo-Fr/.test(n[0].hours[0]) && n[0].source === "osm", n[0]);
  const t = S.parseNominatim(FX.nominatimTown)[0];
  check("Nominatim: a town", t.name === "Springfield" && t.category === "administrative" && /Illinois/.test(t.address), t);
  const ph = S.parsePhoton(FX.photon);
  check("Photon: suggestions with names, addresses and locations", ph.length === 2 && ph[1].name === "Public Library" && ph[1].address === "326 South 7th Street, Springfield, Illinois" && ph[1].lon === -89.64, ph);
  const g = S.parseGooglePlaces(FX.googlePlaces);
  check("Google Places: name, address, rating (count), open now, hours", g.length === 2 && g[0].name === "Harbor Bistro" && g[0].rating === 4.6 && g[0].ratingCount === 812 && g[0].openNow === true && g[0].hours.length === 2 && g[1].openNow === false && g[0].category === "Restaurant", g[0]);
  const ac = S.parseGoogleAutocomplete(FX.googleAutocomplete);
  check("Google Autocomplete: places only (queries skipped), looked up when picked", ac.length === 1 && ac[0].name === "Harbor Bistro" && ac[0].needsDetails && ac[0].lat == null, ac);
  const o = R.parseOsrm(FX.osrm, "driving");
  const txt = o[0].steps.map((s) => s.text);
  check("OSRM: two routes, distance, time, summary, drawn line", o.length === 2 && Math.round(o[0].distance) === 4251 && o[0].geometry.length === 5 && o[0].geometry[0][0] === 39.7817 && o[0].summary === "via North Main Street and East Adams Street", o[0].summary);
  check("OSRM: maneuvers become words (depart, turn with a route number, roundabout exit, end of road, arrive)", JSON.stringify(txt) === JSON.stringify(["Head north on North Main Street", "Turn left onto Oak Avenue (IL 29)", "At the roundabout, take the second exit onto Lincoln Parkway", "At the end of the road, turn right onto East Adams Street", "Arrive at your destination, on the left"]), txt);
  check("OSRM: each step has where it happens", o[0].steps[1].at[0] === 39.785 && o[0].steps[4].kind === "arrive");
  check("OSRM: a failed answer says so", (() => { try { R.parseOsrm({ code: "NoRoute" }); return false; } catch (e) { return /no route/i.test(e.message); } })());
  const ors = R.parseOrs(FX.ors, "walking");
  check("OpenRouteService: its instructions, kinds, distances and step locations", ors.length === 1 && ors[0].steps.length === 4 && ors[0].steps[2].text === "Keep right onto Park Trail" && ors[0].steps[2].kind === "fork" && ors[0].steps[3].kind === "arrive" && ors[0].steps[1].at[1] === -89.6501 && ors[0].steps[3].street === "" && ors[0].mode === "walking", ors[0].steps);
  const gr = R.parseGoogleRoutes(FX.googleRoutes, "driving");
  check("Google Routes: the polyline decoded (Google's own example)", JSON.stringify(gr[0].geometry) === JSON.stringify([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]), gr[0].geometry);
  check("Google Routes: distance, time, summary, alternatives, an arrival step added", gr.length === 2 && gr[0].distance === 12875 && gr[0].duration === 1080 && gr[0].summary === "via US-36 E" && gr[0].steps.length === 4 && gr[0].steps[3].kind === "arrive" && gr[0].steps[3].at[0] === 43.252, gr[0].steps);
  check("Google Routes: line breaks in an instruction become sentences", gr[0].steps[1].text === "Turn right onto US-36 E. Pass by the gas station (on the left in 5 mi)", gr[0].steps[1].text);
  const tr = R.parseGoogleRoutes(FX.googleTransit, "transit");
  check("Google transit: the bus step in words", tr[0].steps[1].text === "Take the bus 12 toward Northgate from Central Station, 6 stops, and get off at Market Square" && tr[0].steps[1].kind === "transit", tr[0].steps[1].text);
}

// A2. the words
{
  const d = (m, u) => W.spokenDistance(m, u);
  check("miles: feet, then quarter / half / three quarters, halves under 10, whole miles after", d(15) === "a few feet" && d(91) === "300 feet" && d(250) === "800 feet" && d(402) === "a quarter mile" && d(805) === "half a mile" && d(1207) === "three quarters of a mile" && d(1609) === "1 mile" && d(2414) === "a mile and a half" && d(3219) === "2 miles" && d(4023) === "2 and a half miles" && d(17000) === "11 miles",
    [d(15), d(91), d(250), d(402), d(805), d(1207), d(1609), d(2414), d(3219), d(4023), d(17000)].join("|"));
  check("kilometers: meters rounded, then halves, then whole", d(12, "km") === "a few meters" && d(83, "km") === "80 meters" && d(430, "km") === "450 meters" && d(1000, "km") === "1 kilometer" && d(2600, "km") === "2.5 kilometers" && d(23400, "km") === "23 kilometers",
    [d(12, "km"), d(83, "km"), d(430, "km"), d(1000, "km"), d(2600, "km"), d(23400, "km")].join("|"));
  check("short distances for the screen", W.shortDistance(100) === "330 ft" && W.shortDistance(4250) === "2.6 mi" && W.shortDistance(20000) === "12 mi" && W.shortDistance(400, "km") === "400 m" && W.shortDistance(4250, "km") === "4.3 km", [W.shortDistance(100), W.shortDistance(4250), W.shortDistance(20000), W.shortDistance(400, "km"), W.shortDistance(4250, "km")].join("|"));
  check("durations", W.spokenDuration(20) === "less than a minute" && W.spokenDuration(60) === "1 minute" && W.spokenDuration(1500) === "25 minutes" && W.spokenDuration(3600) === "1 hour" && W.spokenDuration(3900) === "1 hour 5 minutes" && W.shortDuration(3900) === "1 h 5 min" && W.shortDuration(486) === "8 min");
  const say = (t) => W.sayable(t);
  check("street names spelled out: N Grand Ave, St Clair St, US-36 E, I-35, (TX 317), 5 mi", say("Head north on N Grand Ave") === "Head north on North Grand Avenue" && say("Turn left onto St Clair St") === "Turn left onto Saint Clair Street"
    && say("Turn right onto US-36 E. Pass by the gas station (on the left in 5 mi)") === "Turn right onto U.S. 36 East. Pass by the gas station, on the left in 5 miles" && say("Merge onto I-35 S") === "Merge onto I 35 South" && say("Turn right onto North Main Street (TX 317)") === "Turn right onto North Main Street, Texas 317" && say("Keep left at the fork") === "Keep left at the fork",
    [say("Head north on N Grand Ave"), say("Turn left onto St Clair St"), say("Turn right onto US-36 E. Pass by the gas station (on the left in 5 mi)"), say("Merge onto I-35 S"), say("Turn right onto North Main Street (TX 317)")].join(" | "));
  const steps = [{ text: "Head east on Elm St", distance: 800 }, { text: "Turn left onto Main St", distance: 3219 }, { text: "Turn right onto Oak Ave", distance: 150 }, { text: "Arrive at your destination, on the right", distance: 0, kind: "arrive" }];
  check("the spoken step: \"In 2 miles, turn right onto Oak Avenue.\"", W.spokenStep(steps, 2) === "In 2 miles, turn right onto Oak Avenue.", W.spokenStep(steps, 2));
  check("the first step says how far to go on it; the arrival says how far before it", W.spokenStep(steps, 0) === "Head east on Elm Street for half a mile." && W.spokenStep(steps, 1) === "In half a mile, turn left onto Main Street." && W.spokenStep(steps, 3) === "In 500 feet, arrive at your destination, on the right.", [W.spokenStep(steps, 0), W.spokenStep(steps, 1), W.spokenStep(steps, 3)].join(" | "));
  check("the spoken step in kilometers", W.spokenStep(steps, 2, "km") === "In 3 kilometers, turn right onto Oak Avenue.", W.spokenStep(steps, 2, "km"));
  check("compass for the first step", W.compass(2) === "north" && W.compass(91) === "east" && W.compass(225) === "southwest");
}

// A3. "leave by"
{
  const lb = (o) => W.leaveBy({ date: "2030-10-01", start: "15:00", now: new Date(2030, 9, 1, 9), ...o });
  check("leave by: \"You need to leave by 2:35 to make your 3:00.\" (25 minutes, no cushion)", lb({ durationS: 1500, bufferMin: 0 }).text === "You need to leave by 2:35 to make your 3:00." && lb({ durationS: 1500, bufferMin: 0 }).leaveAt === "14:35", lb({ durationS: 1500, bufferMin: 0 }));
  check("leave by: the cushion is added and it rounds DOWN to 5 minutes", lb({ durationS: 1320, bufferMin: 5 }).leaveAt === "14:30" && lb({ durationS: 1320, bufferMin: 0 }).leaveAt === "14:35", [lb({ durationS: 1320, bufferMin: 5 }).leaveAt, lb({ durationS: 1320, bufferMin: 0 }).leaveAt]);
  check("leave by: with the item's name", lb({ durationS: 1500, bufferMin: 5, title: "the dentist" }).text === "You need to leave by 2:30 to make the dentist at 3:00.");
  check("leave by: across midnight (an 8:10 a.m. start, 40 minutes)", W.leaveBy({ date: "2030-10-02", start: "00:20", durationS: 2400, bufferMin: 0, now: new Date(2030, 9, 1, 20) }).leaveDate === "2030-10-01" && W.leaveBy({ date: "2030-10-02", start: "00:20", durationS: 2400, bufferMin: 0, now: new Date(2030, 9, 1, 20) }).leaveAt === "23:40");
  const late = lb({ durationS: 1500, bufferMin: 5, now: new Date(2030, 9, 1, 14, 50) });
  check("leave by: already too late says how late", late.late && /about 15 minutes late/.test(late.text), late.text);
  const soon = lb({ durationS: 1500, bufferMin: 5, now: new Date(2030, 9, 1, 14, 32) });
  check("leave by: past the leave time but still on time: leave now", soon.late && /leave now to make/.test(soon.text), soon.text);
}

// A4. which service answers
{
  settings._reset(); N._clearCache();
  check("no key, automatic: the free maps", settings.active() === "osm" && settings.services().route.includes("OSRM"));
  log.length = 0;
  await S.search("coffee", { near: HOME, nearOnly: true });
  const q = log.find((x) => x.p === "/nominatim/search");
  check("free search: Nominatim, the special word (coffee → cafe), a box around home, bounded, with Dayspring's name", q && /q=cafe/.test(q.q) && /viewbox=/.test(q.q) && /bounded=1/.test(q.q) && /^Dayspring\/\S+ \(personal voice assistant; https:\/\/github\.com\//.test(q.ua), q);
  const near = await S.search("coffee", { near: HOME, nearOnly: true });
  check("near home: nearest first, with the distance", near[0].name === "Corner Coffee" && near[0].distance < near[1].distance && near[0].distance > 100, near.map((x) => [x.name, x.distance]));
  check("the same search again is remembered (not asked twice)", log.filter((x) => x.p === "/nominatim/search").length === 1, log.length);
  log.length = 0;
  const sg = await S.suggest("Springf", { near: HOME });
  check("suggestions come from Photon (never Nominatim), biased to home", sg.length === 2 && log.some((x) => x.p === "/photon/api/" && /lat=39\.7817/.test(x.q)) && !log.some((x) => x.p.startsWith("/nominatim")), log.map((x) => x.p));
  check("suggestions: fewer than 3 letters asks nothing", (await S.suggest("Sp")).length === 0 && log.length === 1);
  process.env.GOOGLE_MAPS_API_KEY = GOOD;
  check("a Google key saved, automatic: Google", settings.active() === "google" && settings.services().transit === true);
  log.length = 0;
  const gp = await S.search("restaurant", { near: HOME, nearOnly: true });
  const gq = log.find((x) => x.p === "/google-places/v1/places:searchText");
  check("Google search: the key in its header, basic fields only (no ratings/hours unless turned on), a bias around home", gp[0].name === "Harbor Bistro" && gq?.key === GOOD && /places\.displayName/.test(gq.mask) && !/rating|OpeningHours/.test(gq.mask) && /"locationBias"/.test(gq.body), gq);
  settings.set({ richDetails: true }); N._clearCache(); log.length = 0;
  await S.search("restaurant", { near: HOME, nearOnly: true });
  check("ratings and hours turned on: asked for", /places\.rating/.test(log[0]?.mask) && /currentOpeningHours/.test(log[0]?.mask), log[0]?.mask);
  settings.set({ richDetails: false });
  const pick = await S.suggest("harbor", { near: HOME });
  log.length = 0;
  const det = await S.details(pick[0]);
  check("Google suggestion picked: looked up once with the same session token", det.lat === 39.795 && log.length === 1 && /sessionToken=/.test(log[0].q) && /places\/ChIJplaceA/.test(log[0].p), log[0]);
  settings.set({ provider: "osm" }); log.length = 0;
  await S.search("library", {});
  check("forced free maps: Nominatim even with a Google key", settings.active() === "osm" && log[0]?.p === "/nominatim/search", log[0]?.p);
  delete process.env.GOOGLE_MAPS_API_KEY; settings.set({ provider: "google" });
  check("forced Google without a key: the free maps, and Settings says why", settings.active() === "osm" && settings.services().wantedGoogleButNoKey === true);
  settings.set({ provider: "auto" });
  // routes: ORS with a key, else OSRM; transit only with Google; avoid falls back with a note
  const a = { lat: HOME.lat, lon: HOME.lon }, b = { lat: 39.7902, lon: -89.644 };
  log.length = 0; N._clearCache();
  let rr = await R.directions(a, b, { mode: "walking" });
  check("free routes: the FOSSGIS foot server for walking", rr[0].provider === "osrm" && log[0]?.p.startsWith("/osrm/routed-foot/route/v1/driving/-89.650100,39.781700;-89.644000,39.790200") && /steps=true/.test(log[0].q), log[0]);
  process.env.OPENROUTESERVICE_API_KEY = ORS_GOOD; log.length = 0;
  rr = await R.directions(a, b, { mode: "cycling" });
  check("an OpenRouteService key: ORS first (its key in the header), cycling profile", rr[0].provider === "ors" && log[0]?.p === "/ors/v2/directions/cycling-regular/geojson" && log[0].key === ORS_GOOD, log[0]);
  process.env.OPENROUTESERVICE_API_KEY = "wrong-ors-key-9"; log.length = 0; N._clearCache();
  rr = await R.directions(a, b, { mode: "driving" });
  check("ORS refusing: the free servers take over", rr[0].provider === "osrm" && log.some((x) => x.p.startsWith("/ors/")) && log.some((x) => x.p.startsWith("/osrm/")));
  delete process.env.OPENROUTESERVICE_API_KEY; log.length = 0; N._clearCache();
  rr = await R.directions(a, b, { mode: "driving", avoid: { highways: true } });
  check("avoid highways on the free servers: asked (exclude=motorway), and when refused, a plain note", log[0] && /exclude=motorway/.test(log[0].q) && log.length === 2 && /couldn't leave those roads out/.test(rr[0].note), [log.map((x) => x.q), rr[0].note]);
  let err = null; try { await R.directions(a, b, { mode: "transit" }); } catch (e) { err = e; }
  check("transit without Google: said plainly (Google needed)", err?.code === "no-transit" && /Google/.test(err.message), err?.message);
  process.env.GOOGLE_MAPS_API_KEY = GOOD; log.length = 0;
  rr = await R.directions(a, b, { mode: "transit" });
  check("transit with Google: TRANSIT, no traffic preference, the bus step", rr[0].steps[1].kind === "transit" && /"travelMode":"TRANSIT"/.test(log[0].body) && !/routingPreference/.test(log[0].body), log[0]?.body);
  log.length = 0;
  rr = await R.directions(a, b, { mode: "driving", avoid: { tolls: true } });
  check("Google driving: traffic-unaware (the cheaper tier), alternatives, avoid tolls, units", /"routingPreference":"TRAFFIC_UNAWARE"/.test(log[0].body) && /"computeAlternativeRoutes":true/.test(log[0].body) && /"avoidTolls":true/.test(log[0].body) && /"units":"IMPERIAL"/.test(log[0].body) && rr.length === 2, log[0]?.body);
  settings.set({ traffic: true }); log.length = 0; N._clearCache();
  rr = await R.directions(a, b, { mode: "driving" });
  check("live traffic turned on: TRAFFIC_AWARE", /"routingPreference":"TRAFFIC_AWARE"/.test(log[0].body) && rr[0].traffic === true);
  settings.set({ traffic: false });
  delete process.env.GOOGLE_MAPS_API_KEY; N._clearCache();
}

// A5. the key test
{
  check("test with no key: says there's none", !(await routes.testKey("google")).ok);
  process.env.GOOGLE_MAPS_API_KEY = GOOD;
  let t = await routes.testKey("google");
  check("test, a good key: search and directions work", t.ok && t.checks.filter((c) => c.ok === true).length === 2 && /works/.test(t.text), t);
  const cheap = log.filter((x) => x.p === "/google-places/v1/places:searchText").pop();
  check("the key test asks for IDs only (Google's cheapest search)", cheap?.mask === "places.id", cheap?.mask);
  process.env.GOOGLE_MAPS_API_KEY = "test-google-key-wrong-0003";
  t = await routes.testKey("google");
  check("test, a wrong key: \"isn't valid\"", !t.ok && /isn't valid/.test(t.checks[0].text) && t.checks[0].code === "bad-key", t.checks[0]);
  process.env.GOOGLE_MAPS_API_KEY = NOROUTES;
  t = await routes.testKey("google");
  check("test, Routes API not turned on: search works, directions say to enable it", !t.ok && t.checks[0].ok === true && t.checks[1].ok === false && t.checks[1].code === "api-off" && /isn't turned on/.test(t.checks[1].text), t.checks);
  check("no message ever contains the key", !JSON.stringify(t).includes(NOROUTES) && !JSON.stringify(t).includes(GOOD));
  delete process.env.GOOGLE_MAPS_API_KEY;
  process.env.OPENROUTESERVICE_API_KEY = ORS_GOOD;
  check("test, OpenRouteService key", (await routes.testKey("ors")).ok);
  process.env.OPENROUTESERVICE_API_KEY = "wrong-ors-key-9";
  check("test, a wrong OpenRouteService key", /didn't accept the key/.test((await routes.testKey("ors")).text));
  delete process.env.OPENROUTESERVICE_API_KEY; N._clearCache();
}

// A6. the panel's state: search, route, steps, ETA, the phone, the demo, live position
{
  guide._reset(); settings._reset();
  await guide.search("coffee", { nearMe: true });
  const v = guide.view();
  check("search near home: open, numbered, first selected, sent to the screen", v.open && v.results.length === 2 && v.results[0].n === 1 && v.selected === 0 && events.at(-1)?.[0] === "maps" && v.results[0].distanceText, v.results);
  const r = await guide.route({ to: "number 1" });
  check("directions to number 1: from home, 5 steps, the route and its alternative", r.steps.length === 5 && guide.state().from.id === "home" && guide.state().to.name === "Corner Coffee" && guide.view().routes.length === 2 && guide.view().routes[0].steps.length === 5 && !guide.view().routes[1].steps, guide.state().to);
  check("the summary: distance, time, arrival, alternatives", guide.summary() === "To Corner Coffee: 2 and a half miles, about 8 minutes by car, via North Main Street and East Adams Street. Leave now and you'd get there around 1:08 p.m. (That's without live traffic.) There is 1 other route on the screen.", guide.summary());
  const s1 = guide.startGuided();
  check("guided: the first step", s1.index === 0 && s1.text === "Head north on North Main Street for a quarter mile." && guide.state().guided, s1.text);
  const s2 = guide.step("next");
  check("next: \"In a quarter mile, turn left onto Oak Avenue, IL 29.\"", s2.index === 1 && s2.text === "In a quarter mile, turn left onto Oak Avenue, IL 29.", s2.text);
  const s3 = guide.step("next");
  check("next: \"In 2 miles, at the roundabout, take the second exit…\"", s3.text === "In 2 miles, at the roundabout, take the second exit onto Lincoln Parkway.", s3.text);
  check("repeat: the same words", guide.step("repeat").text === s3.text && guide.state().step === 2);
  check("previous: back one", guide.step("previous").index === 1);
  check("the screen highlights the current step", guide.view().step === 1 && /Oak Avenue/.test(guide.view().stepText));
  check("distance left from step 2 and the ETA", guide.remaining().text === "2 and a half miles" && Math.round(guide.eta().seconds) === 446, [guide.remaining().text, guide.eta().seconds]);
  guide.step("next"); guide.step("next"); guide.step("next");
  const end = guide.step("next");
  check("next at the last step: arrived", end.done && /arrived/.test(end.text) && guide.state().step === 4);
  check("start over", guide.step("first").index === 0);
  const all = guide.step("all").text;
  check("read all the directions: every step, in order", /^Head north.*Lincoln Parkway.*East Adams Street.*destination, on the left\.$/.test(all), all);
  check("Google Maps link: the trip, from home, driving", /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=Corner\+Coffee%2C\+12\+South\+2nd\+Street/.test(guide.googleLink()) && /origin=39\.7817%2C-89\.6501/.test(guide.googleLink()) && /travelmode=driving/.test(guide.googleLink()), guide.googleLink());
  let ph = await guide.sendToPhone();
  check("send to phone, not signed in to other devices: the QR code shows instead", ph.sent === 0 && guide.state().qr && notified[0]?.body.includes("https://www.google.com/maps/dir/") && /Directions to Corner Coffee/.test(notified[0].title));
  notifyAnswer = { sent: 1 };
  ph = await guide.sendToPhone();
  check("send to phone, signed in: sent", ph.sent === 1);
  const first = guide.startAuto(3);
  check("the demo: starts at step 1 and marks the view", first.index === 0 && guide.view().auto === true);
  await sleep(3300);
  check("the demo: the next step is said through the floor (an announcement that waits its turn, not a reply)", announced.length === 1 && announced[0].kind === "navigation" && !announced[0].requested && /Oak Avenue/.test(announced[0].text), announced);
  guide.stopGuided();
  check("stop: the demo ends", !guide.view().auto && !guide.view().guided);
  await sleep(3300);
  check("stopped: nothing more is said", announced.length === 1);
  guide.step("first");
  const pos = guide.position({ lat: 39.7847, lon: -89.6501 });
  check("live position (the phone hook): near the first turn, it's said once", pos.ok && /^In .*turn left onto Oak Avenue/.test(pos.said ?? "") && announced.at(-1)?.requested === true, pos);
  check("live position: not said twice", guide.position({ lat: 39.7847, lon: -89.6501 }).said === null);
  const moved = guide.position({ lat: 39.785, lon: -89.6501 });
  check("live position: passing the turn moves to it", moved.step === 1, moved);
  await guide.setMode("walking");
  check("switching to walking re-routes", guide.state().mode === "walking" && guide.state().step === 0 && log.at(-1).p.startsWith("/osrm/routed-foot/"));
  homeNow = null;
  let e2 = null; try { await guide.route({ to: "Public Library" }); } catch (e) { e2 = e; }
  check("no home set: says where to set it (no GPS)", e2?.code === "no-home" && /Where you are/.test(e2.message) && /no GPS/.test(e2.message));
  const typed = await guide.route({ to: "Public Library", from: "Springfield" });
  check("…but a typed start works", typed && guide.state().from.name === "Springfield");
  homeNow = HOME;
  const lbf = await guide.leaveByFor({ where: "Public Library", date: "2030-10-01", start: "15:00", title: "Book club" });
  check("leave by for a schedule item: the drive from home + the cushion", lbf.text === "You need to leave by 2:45 to make Book club at 3:00." && lbf.leaveAt === "14:45" && lbf.durationText === "8 min" && /google\.com\/maps\/dir/.test(lbf.link), lbf);
  guide.close();
  check("close: the screen is told", events.at(-1)?.[1]?.open === false && !guide.isOpen());
}

// A7. voice
{
  const P = (t) => skills.parse(t);
  const same = (t, want) => { const got = P(t); const ok = want === null ? got === null : got && Object.entries(want).every(([k, v]) => got[k] === v); check(`voice: "${t}"`, ok, got); };
  same("show me a map of Springfield", { kind: "search", q: "springfield", near: false });
  same("find coffee near me", { kind: "search", q: "coffee", near: true });
  same("where's the nearest Home Depot?", { kind: "search", q: "home depot", near: true, one: true });
  same("Dayspring, directions to Temple Mall", { kind: "directions", to: "temple mall" });
  same("how long to drive to Waco", { kind: "directions", to: "waco", mode: "driving", ask: "time" });
  same("walking directions to the park", { kind: "directions", to: "the park", mode: "walking" });
  same("directions to the museum from the train station", { kind: "directions", to: "the museum", from: "the train station" });
  same("how far is Waco", { kind: "directions", to: "waco", ask: "distance" });
  same("read the directions", { kind: "guide" });
  same("next step", { kind: "step", action: "next" });
  same("repeat that", { kind: "step", action: "repeat", weak: true });
  same("previous step", { kind: "step", action: "previous" });
  same("how far is it", { kind: "far" });
  same("what's my ETA", { kind: "eta" });
  same("avoid highways", { kind: "avoid", what: "highways", on: true });
  same("avoid tolls", { kind: "avoid", what: "tolls", on: true });
  same("close the map", { kind: "close" });
  same("send the directions to my phone", { kind: "phone" });
  same("switch to walking", { kind: "mode", mode: "walking" });
  same("show the other route", { kind: "alt" });
  same("demo the directions", { kind: "auto" });
  // what it must leave alone
  for (const t of ["how long to cook rice", "how far is the moon", "how long is left on my timer", "take me to youtube", "what's the weather", "set a timer for 10 minutes", "how far am i in my course", "play the next song", "find my phone", "open youtube"]) same(t, null);
  guide._reset();
  check("\"next step\" with no route: left for the rest of Dayspring (recipes, the AI)", (await skills.handle("next step")) === null);
  check("\"how far is it\" with no route: left alone", (await skills.handle("how far is it")) === null);
  const f = await skills.handle("find coffee near me");
  check("voice: find coffee near me → the two nearest, numbered, with distances", f.intent === "maps.search" && /^I found 2 near home\. The closest: 1, Corner Coffee, .* away\. 2, Bean There Cafe/.test(f.reply), f.reply);
  const nr = await skills.handle("where's the nearest coffee shop");
  check("voice: the nearest one, with how to get directions", /^The nearest coffee shop I found is Corner Coffee, on 12 South 2nd Street, .* away\. Say “directions to number 1”/.test(nr.reply), nr.reply);
  const dr = await skills.handle("directions to number 2");
  check("voice: directions → distance, time, arrival and how to go step by step", dr.intent === "maps.directions" && /^To Bean There Cafe: 2 and a half miles, about 8 minutes by car/.test(dr.reply) && /read the directions/.test(dr.reply), dr.reply);
  check("voice: \"next\" alone before guidance started: not taken", (await skills.handle("next")) === null);
  const rd = await skills.handle("read the directions");
  check("voice: read the directions → step 1 and listens for \"next\"", /^Head north on North Main Street/.test(rd.reply) && rd.listen === true, rd);
  const nx = await skills.handle("next");
  check("voice: \"next\" while guided → step 2", /^In a quarter mile, turn left onto Oak Avenue/.test(nx.reply), nx.reply);
  const rp = await skills.handle("repeat that", { lastReply: nx.reply });
  check("voice: \"repeat that\" → the same step", rp.reply === nx.reply);
  const pv = await skills.handle("previous step");
  check("voice: previous step", /^Head north/.test(pv.reply));
  check("voice: how far is it", /^It's 2 and a half miles to Bean There Cafe\.$/.test((await skills.handle("how far is it")).reply) || /left to Bean There Cafe/.test((await skills.handle("how far is it")).reply));
  check("voice: what's my ETA", /^About 8 minutes\. Leaving now, you'd get there around /.test((await skills.handle("what's my ETA")).reply));
  const av = await skills.handle("avoid highways");
  check("voice: avoid highways → re-routed, with the plain note when the free servers can't", /^Avoiding highways\./.test(av.reply) && /couldn't leave those roads out/.test(av.reply), av.reply);
  const tl = await skills.handle("how long to walk to the library");
  check("voice: how long to walk to … → minutes, walking", /^About \d+ minutes? walking to Public Library/.test(tl.reply), tl.reply);
  const ph = await skills.handle("send the directions to my phone");
  check("voice: send to my phone", /Sent to your phone|code on the screen/.test(ph.reply), ph.reply);
  check("voice: close the map", (await skills.handle("close the map")).reply === "Map closed." && !guide.isOpen());
  check("voice: \"repeat that\" after the map closed: left alone", (await skills.handle("repeat that", { lastReply: "Map closed." })) === null);
  const off = await skills.handle("find coffee near me", { surface: "call" });
  check("voice: not on a call (someone else is talking)", off === null);
  homeNow = null;
  const nh = await skills.handle("find coffee near me");
  check("voice: near me with no home → where to set it", /Where you are/.test(nh.reply) && /no GPS/.test(nh.reply), nh.reply);
  homeNow = HOME;
}

// A8. the AI's tools (Claude and Ollama get the same list)
{
  check("three tools, each a plain JSON schema a local model can read", skills.TOOLS.length === 3 && skills.TOOLS.every((t) => /^maps_/.test(t.name) && t.input_schema.type === "object" && t.input_schema.required?.length && t.description.length > 40) && skills.tools().length === 3);
  const s = await skills.runTool("maps_search", { query: "coffee", near_me: true });
  check("maps_search: numbered places with distances, shown on screen", s.shown_on_screen && s.count === 2 && s.places[0].n === 1 && s.places[0].name === "Corner Coffee" && /feet|mile/.test(s.places[0].distance ?? ""), s);
  const d = await skills.runTool("maps_directions", { to: "number 1", mode: "driving", avoid: ["tolls"] });
  check("maps_directions: distance, duration, arrival, first steps, link", d.shown_on_screen && d.to.startsWith("Corner Coffee") && d.distance && d.duration === "8 minutes" && d.first_steps.length === 4 && /google\.com\/maps\/dir/.test(d.google_maps_link) && d.alternatives === 1, d);
  const st = await skills.runTool("maps_step", { action: "start_guided" });
  const nx = await skills.runTool("maps_step", { action: "next" });
  check("maps_step: start and next → the words to say, step 2 of 5", /^Head north/.test(st.say) && nx.step === 2 && nx.of === 5 && /Oak Avenue/.test(nx.say), nx);
  check("maps_step: close", (await skills.runTool("maps_step", { action: "close" })).closed === true);
  check("maps tools: an error is a message, not a crash (no route after closing? the route stays; a bad place is an error)", typeof (await skills.runTool("maps_directions", { to: "nowhere-at-all-xyz" })).error === "string");
  check("not a maps tool: undefined (the next module answers)", (await skills.runTool("printer_status", {})) === undefined);
  check("context for the AI while the map shows a route", (await skills.runTool("maps_directions", { to: "Public Library" })) && /The Maps panel is open with driving directions/.test(skills.contextText()));
}

// A9. the feature switch
{
  const F = await imp("lib/features.mjs");
  process.env.DAYSPRING_CHANNEL = "stable"; F._clear();
  check("production (maps is \"dev\"): off", F.on("maps") === false);
  check("off: no voice commands", (await skills.handle("find coffee near me")) === null);
  check("off: no AI tools (and the assistant's filter drops them too)", skills.tools().length === 0 && F.filterTools(skills.TOOLS).length === 0);
  check("off: no routes (404), Settings → Maps hidden, screen parts hidden", F.routeBlocked("/maps/state") === "maps" && F.hiddenSections().includes("maps") && F.hiddenUi().selectors.includes("#dsMaps"));
  const res = { code: 0, body: null };
  await routes.handle({}, {}, { m: "GET", p: "/maps/state", q: new URLSearchParams(), send: (_r, c, b) => { res.code = c; res.body = b; }, readJSON: async () => ({}) });
  check("off: the routes themselves answer 404 too", res.code === 404);
  process.env.DAYSPRING_CHANNEL = "dev"; F._clear();
  check("development: on", F.on("maps"));
}

// ======================================================================================================================= B
if (!args.includes("--module")) await partB();
async function partB() {
  const PW = [join(DESK, "node_modules", "playwright-core", "index.mjs"), join(DESK, "..", "..", "..", "dayspring-app", "node_modules", "playwright-core", "index.mjs")].find((p) => existsSync(p));
  if (!PW) { check("playwright-core is there", false); return; }
  const { chromium } = await import(pathToFileURL(PW).href);
  const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  const PORT = await qaPort(4777), BASE = `http://127.0.0.1:${PORT}`, APP = join(TMP, "app");
  spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
  spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
  mkdirSync(join(APP, "data"), { recursive: true });
  writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary", location: { place: "Springfield, Illinois", lat: HOME.lat, lon: HOME.lon, timezone: "America/Chicago" } }));
  const env = { ...ORIGINAL_ENV, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_NO_ECO: "1", DS_PROFILE: "DayspringQA",
    DAYSPRING_CHANNEL: "dev", DAYSPRING_MAPS_MOCK: MOCK, DAYSPRING_ENV_FILE: join(TMP, "child.env") };
  for (const k of ["GOOGLE_MAPS_API_KEY", "OPENROUTESERVICE_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY", "DAYSPRING_DATA_DIR", "DAYSPRING_MAPS_FILE", "DAYSPRING_MAPS_TILES_DIR", "DAYSPRING_SETTINGS_FILE"]) delete env[k];
  env.AI_PROVIDER = "none";
  const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let serverLog = ""; server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
  const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
  let isUp = false; for (let i = 0; i < 120 && !(isUp = await up()); i++) await sleep(500);
  check("B: the throwaway server is up", isUp, serverLog.slice(-400));
  const J = async (path, body, method = body === undefined ? "GET" : "POST") => { const r = await fetch(BASE + "/api" + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, text: await r.clone().text(), body: await r.json().catch(() => null) }; };
  const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME, headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] } : { headless: true, args: ["--mute-audio"] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript(() => {
      const ss = window.speechSynthesis; if (ss) { ss.speak = (u) => setTimeout(() => u.onend?.(), 10); ss.cancel = () => {}; }
      HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
      class FakeSR { start() {} abort() { setTimeout(() => this.onend?.(), 5); } stop() { this.abort(); } }
      window.SpeechRecognition = window.webkitSpeechRecognition = FakeSR;
    });
    // nothing leaves this computer from the browser: anything not the throwaway server is answered empty
    const outside = [];
    await ctx.route("**/*", (rt) => { const u = rt.request().url(); if (u.startsWith(BASE) || u.startsWith("data:")) return rt.continue(); outside.push(u.slice(0, 80)); return rt.fulfill({ status: 204, body: "" }); });
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));
    await p.goto(BASE + "/display"); await p.waitForTimeout(2200);
    if (await p.locator("#startBtn").isVisible().catch(() => false)) { await p.click("#startBtn"); await p.waitForTimeout(500); }
    await p.evaluate(() => { window.__ann = []; window.dsEvents?.addEventListener("announce", (e) => { try { window.__ann.push(JSON.parse(e.data)); } catch { /* */ } }); });
    const S2 = () => p.evaluate(() => window.dsMaps._state());
    check("B: 🗺 Maps button by the clock", await p.locator("#mapsBtn").count() === 1);
    await p.evaluate(() => window.dsMaps.open());
    check("B: the window opens with its map (Leaflet from Dayspring itself)", await until(async () => (await S2()).open && (await S2()).map));
    check("B: the home pin and the © OpenStreetMap credit", await until(async () => (await S2()).markers >= 1) && /OpenStreetMap/.test(await p.locator("#dsMaps .leaflet-control-attribution").innerText()));
    check("B: the map pictures come through Dayspring (/api/maps/tile)", await until(() => log.some((x) => x.p.startsWith("/tiles/"))));
    check("B: \"no GPS\" is explained", /no GPS/.test(await p.locator("#dsMaps .mp-body").innerText()));
    await p.click("#dsMaps .mp-q"); await p.keyboard.type("Spring", { delay: 70 });
    check("B: suggestions as you type (after a pause)", await until(async () => (await S2()).suggestions === 2));
    await p.keyboard.press("ArrowDown"); await p.keyboard.press("ArrowDown"); await p.keyboard.press("Enter");
    check("B: picking a suggestion shows it", await until(async () => { const s = await S2(); return s.results.length === 1 && /Public Library/.test(await p.locator("#dsMaps .mp-res").innerText()); }));
    await p.fill("#dsMaps .mp-q", "coffee"); await p.check("#dsMaps .mp-nearbox"); await p.keyboard.press("Enter");
    check("B: search near home: two numbered results, nearest first, pins on the map", await until(async () => { const s = await S2(); return s.results.join() === "1,2" && s.markers >= 3; }) && /^1\s*Corner Coffee/.test((await p.locator("#dsMaps .mp-res li").first().innerText()).trim()));
    check("B: results show the distance and hours", /from home/.test(await p.locator("#dsMaps .mp-res").innerText()) && await p.locator("#dsMaps .mp-res details").count() === 1);
    await p.click('#dsMaps [data-dir="1"]');
    check("B: Directions: the route is drawn, with its steps and the first one highlighted", await until(async () => { const s = await S2(); return s.route && s.lines === 1 && s.curStep === 0; }) && await p.locator("#dsMaps .mp-steps li").count() === 5, await S2());
    check("B: two routes listed with times; transit greyed out without Google", await p.locator("#dsMaps .mp-alts button").count() === 2 && await p.locator('#dsMaps [data-mode="transit"]').isDisabled());
    await p.click('#dsMaps [data-step="next"]');
    check("B: Next ▶ highlights step 2 and shows its words", await until(async () => { const s = await S2(); return s.curStep === 1 && /^In a quarter mile, turn left onto Oak Avenue/.test(s.stepText); }), await S2());
    check("B: …and says it (an announcement through the floor)", await until(() => p.evaluate(() => window.__ann.some((a) => a.kind === "navigation" && /Oak Avenue/.test(a.text)))));
    await p.click('#dsMaps .mp-steps li[data-i="3"]');
    check("B: clicking a step jumps to it", await until(async () => (await S2()).curStep === 3));
    await p.click('#dsMaps [data-step="previous"]');
    check("B: ◀ Previous", await until(async () => (await S2()).curStep === 2));
    check("B: the current step's dot on the map", (await S2()).stepDot === 1);
    await p.click('#dsMaps [data-a="qr"]');
    check("B: the QR code for the phone", await until(async () => (await S2()).qr));
    if (process.env.MAPS_SHOT) await p.screenshot({ path: process.env.MAPS_SHOT });   // (a look at the window: MAPS_SHOT=<file.png>)
    await p.click('#dsMaps [data-mode="walking"]');
    check("B: Walk re-routes", await until(async () => /aria-pressed="true"[^>]*>🚶|🚶[^<]*<\/button>/.test(await p.locator("#dsMaps .mp-modes").innerHTML()) && (await S2()).curStep === 0) && log.some((x) => x.p.startsWith("/osrm/routed-foot/")));
    await p.setViewportSize({ width: 600, height: 720 });
    check("B: narrow: the map on top, the list below", await until(() => p.evaluate(() => { const r = document.getElementById("dsMaps"); const m = r.querySelector(".mp-mapwrap").getBoundingClientRect(), s = r.querySelector(".mp-side").getBoundingClientRect(); return r.classList.contains("narrow") && m.bottom <= s.top + 1; })));
    await p.setViewportSize({ width: 1280, height: 720 });

    // voice, through /api/chat like the screen does
    const say = async (t) => (await J("/chat", { message: t, surface: "desk", typed: true })).body?.reply ?? "";
    let r = await say("find coffee near me");
    check("B voice: \"find coffee near me\"", /^I found 2 near home/.test(r), r);
    r = await say("directions to number 2");
    check("B voice: \"directions to number 2\"", /^To Bean There Cafe/.test(r) && await until(async () => /Bean There/.test(await p.locator("#dsMaps .mp-to").innerText().catch(() => ""))), r);
    r = await say("read the directions"); const r2 = await say("next step"); const r3 = await say("repeat that"); const r4 = await say("previous step");
    check("B voice: read / next / repeat / previous", /^Head north/.test(r) && /^In a quarter mile/.test(r2) && r3 === r2 && /^Head north/.test(r4), [r, r2, r3, r4]);
    check("B voice: the screen follows", await until(async () => (await S2()).curStep === 0));
    r = await say("what's my ETA");
    check("B voice: ETA", /^About \d+ minutes?\. Leaving now/.test(r), r);

    // a Google key: saved (never shown back), tested, the switch to Google and Google's map
    let k = await J("/maps/key", { provider: "google", key: GOOD });
    check("B: Save key → set, last four only, the key never comes back", k.status === 200 && k.body.keys.google.set && k.body.keys.google.last4 === "0001" && !k.text.includes(GOOD) && k.body.services.active === "google", k.text.slice(0, 200));
    check("B: the key went to the .env file (the throwaway one)", readFileSync(join(TMP, "child.env"), "utf8").includes("GOOGLE_MAPS_API_KEY="));
    check("B: a key with spaces is refused", (await J("/maps/key", { provider: "google", key: "not a key" })).status === 400);
    let t = await J("/maps/test", { provider: "google" });
    check("B: Test → works", t.body?.ok === true && t.body.checks.length === 3, t.body);
    check("B: the window switches to Google's map by itself", await until(async () => (await S2()).gmap && (await S2()).provider === "google") && /^\/api\/maps\/embed\?mode=directions/.test(await p.locator("#dsMaps .mp-gmap").getAttribute("src")));
    const emb = await fetch(`${BASE}/api/maps/embed?mode=place&q=Harbor%20Bistro`, { redirect: "manual" });
    check("B: /api/maps/embed sends the page on to Google's embed map (the key only there)", emb.status === 302 && /^https:\/\/www\.google\.com\/maps\/embed\/v1\/place\?key=/.test(emb.headers.get("location") ?? ""));
    check("B: the key is in no \"maps\" event or state", !(await J("/maps/state")).text.includes(GOOD));
    log.length = 0;
    r = await say("find restaurants near me");
    check("B voice with Google: Google Places answers", /Harbor Bistro/.test(r) && log.some((x) => x.p === "/google-places/v1/places:searchText" && x.key === GOOD), r);
    check("B: transit is offered with Google", await until(async () => !(await p.locator('#dsMaps [data-mode="transit"]').isDisabled().catch(() => true))) || (await S2()).route === false);
    k = await J("/maps/key", { provider: "google", key: NOROUTES }); t = await J("/maps/test", { provider: "google" });
    check("B: Test with Routes API off → says which API to turn on", t.body?.ok === false && /Google Routes isn't turned on/.test(t.body.text), t.body?.text);
    await J("/maps/key", { provider: "google", key: "" });
    check("B: Remove key → back to the free maps", (await J("/maps/state")).body.provider === "osm");

    // Settings → Maps
    const sp = await ctx.newPage(); sp.on("pageerror", (e) => errs.push("settings: " + String(e.message).slice(0, 200)));
    await sp.goto(BASE + "/setup?s=maps");
    check("B Settings: Maps is under Apps & connections, says what's in use", await until(async () => /In use now: OpenStreetMap/.test(await sp.locator("#mps-status").innerText().catch(() => "")), 8000) && /Maps/.test(await sp.locator("#nav").innerText()));
    check("B Settings: the safe-key guide (3 APIs, restrict, quotas, budget)", await sp.locator("details.note").filter({ hasText: "Google Maps key safely" }).count() === 1 && /Maps Embed API.*Places API \(New\).*Routes API/s.test(await sp.locator("#card").textContent()) && /Quotas/.test(await sp.locator("#card").innerHTML()));
    await sp.fill("#mps-gkey", GOOD); await sp.click("#mps-gsave");
    check("B Settings: Save key → \"ending 0001\", the field emptied", await until(async () => /ending 0001/.test(await sp.locator("#mps-gstate").innerText())) && (await sp.inputValue("#mps-gkey")) === "");
    await sp.click("#mps-gtest");
    check("B Settings: Test → works", await until(async () => /works for search and directions/.test(await sp.locator("#mps-gtestout").innerText())));
    check("B Settings: the key is nowhere on the page", !(await sp.content()).includes(GOOD));
    await sp.click("#mps-gclear");
    check("B Settings: Remove key", await until(async () => /No key saved/.test(await sp.locator("#mps-gstate").innerText())));
    await sp.selectOption("#mps-units", "km");
    await sp.evaluate(() => window.DayspringMapsSettings.save());
    check("B Settings: units saved", (await J("/maps/settings")).body.settings.units === "km");
    await J("/maps/settings", { units: "mi" });
    await sp.close();

    // leave by, the reminder, the map pictures kept
    const tomorrow = (() => { const d = new Date(Date.now() + 86400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
    const lb = await J("/maps/leaveby", { where: "Public Library", date: tomorrow, start: "15:00", title: "Book club" });
    check("B: leave by for a schedule item", lb.body?.text === "You need to leave by 2:45 to make Book club at 3:00." && lb.body.leaveAt === "14:45", lb.body);
    const rm = await J("/maps/leaveby/remind", { date: tomorrow, time: "14:45", text: "leave for Book club" });
    check("B: ⏰ Remind me sets a reminder", rm.status === 200 && JSON.stringify(rm.body).includes("leave for Book club"), rm.text.slice(0, 200));
    log.length = 0;
    const t1 = await fetch(`${BASE}/api/maps/tile/3/1/2.png`), t2 = await fetch(`${BASE}/api/maps/tile/3/1/2.png`);
    check("B: a map picture is fetched once and kept", t1.ok && t2.ok && t1.headers.get("content-type") === "image/png" && log.filter((x) => x.p === "/tiles/3/1/2.png").length === 1);
    check("B: impossible tile numbers refused", (await fetch(`${BASE}/api/maps/tile/3/9/2.png`)).status === 404);
    check("B: every request to a map service carries Dayspring's name", log.length > 0 && log.every((x) => /^Dayspring\//.test(x.ua)));

    // Esc
    await p.bringToFront();
    await p.evaluate(() => window.dsMaps.isOpen() || window.dsMaps.open());
    await until(async () => (await S2()).open);
    await p.click("#dsMaps .mp-title"); await p.keyboard.press("Escape");
    check("B: Esc closes the window", await until(async () => !(await S2()).open) && (await J("/maps/state")).body.open === false);
    check("B: the maps window fetched nothing from outside (map services, tiles, libraries)", !outside.some((u) => /openstreetmap|komoot|googleapis|openrouteservice|leafletjs|unpkg|jsdelivr|cdnjs/.test(u)), outside.slice(0, 3).join(" "));
    check("B: no page errors", errs.length === 0, errs.slice(0, 3).join(" | "));
    await ctx.close();
  } finally {
    await browser.close().catch(() => {});
    server.kill(); await sleep(500);
    spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(APP, "node_modules")], { windowsHide: true });
  }
}

mock.close();
if (!args.includes("--keep")) { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } } else console.log("kept:", TMP);
console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nALL PASSED: ${pass} passed`);
process.exit(fail ? 1 : 0);
