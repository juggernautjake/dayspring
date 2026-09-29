// /api/maps/*: the Maps panel (public/maps.js), Settings → Maps (public/maps-settings.js) and the schedule's
// Directions button. Local pages only (server.mjs refuses anything else); the "maps" feature gates it all.
//   GET  /maps/state                          what the panel shows            GET /maps/suggest?q=&seq=   as-you-type
//   POST /maps/search { q, nearMe }            POST /maps/directions { to, from, mode, avoid }
//   POST /maps/act { action, … }               open, close, select, mode, avoid, alt, step, guide, auto, stop, qr, phone
//   GET  /maps/tile/z/x/y.png                  OpenStreetMap map pictures, fetched by Dayspring with its own name and
//                                              kept for a week (the tile policy asks for both), so the screen never
//                                              loads anything from other sites itself
//   GET  /maps/embed?…                         the Google map (redirects to Google's embed address with the key; the key
//                                              is never in the "maps" event or any JSON)
//   GET/POST /maps/settings · POST /maps/key { provider, key } · POST /maps/test { provider }
//   POST /maps/leaveby { where, date, start, title } · POST /maps/leaveby/remind { date, time, text }
//   POST /maps/position { lat, lon }           the live-position hook (a phone with GPS, later)
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { on as featureOn } from "../features.mjs";
import * as guide from "./guide.mjs";
import * as settings from "./settings.mjs";
import { request, MapsError } from "./net.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TILES = () => process.env.DAYSPRING_MAPS_TILES_DIR || join(process.env.DAYSPRING_DATA_DIR || join(ROOT, "data"), "maps-tiles");
const TILE_DAYS = 7;
let deps = { announce: () => {}, addReminder: null };
export function setDeps(d) { deps = { ...deps, ...d }; }

const speak = (text) => { if (text && settings.get().voice) deps.announce({ kind: "navigation", text, requested: true }); };

// ---- map pictures ------------------------------------------------------------------------------------------------------
let tilesBusy = 0; const tileWait = [];
const tileTurn = () => new Promise((r) => { if (tilesBusy < 2) { tilesBusy++; r(); } else tileWait.push(r); });
const tileDone = () => { const n = tileWait.shift(); if (n) n(); else tilesBusy--; };
async function tile(res, z, x, y) {
  const n = 2 ** z;
  if (!(z >= 0 && z <= 19 && x >= 0 && x < n && y >= 0 && y < n)) { res.writeHead(404); res.end(); return; }
  const f = join(TILES(), String(z), String(x), `${y}.png`);
  try { if (existsSync(f) && Date.now() - statSync(f).mtimeMs < TILE_DAYS * 86400_000) { const b = readFileSync(f); res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=86400", "content-length": b.length }); res.end(b); return; } } catch { /* fetch it */ }
  await tileTurn();
  try {
    const { buf, type } = await request("tiles", `/${z}/${x}/${y}.png`, { raw: true, timeout: 10000 });
    try { mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, buf); renameSync(tmp, f); } catch { /* shown, not kept */ }
    res.writeHead(200, { "content-type": /^image\//.test(type) ? type : "image/png", "cache-control": "max-age=86400", "content-length": buf.length }); res.end(buf);
  } catch { res.writeHead(502); res.end(); }
  finally { tileDone(); }
}

// ---- the Google map (Maps Embed API: free, unlimited) --------------------------------------------------------------------
const EMBED = "https://www.google.com/maps/embed/v1";
function embedUrl(q) {
  const key = settings.googleKey(); if (!key) return null;
  const mode = q.get("mode"), p = new URLSearchParams({ key });
  const txt = (k, max = 200) => String(q.get(k) ?? "").slice(0, max);
  if (mode === "directions") { p.set("origin", txt("origin")); p.set("destination", txt("destination")); p.set("mode", ["driving", "walking", "bicycling", "transit"].includes(q.get("travel")) ? q.get("travel") : "driving"); const avoid = ["tolls", "highways", "ferries"].filter((a) => q.get(`avoid_${a}`) === "1"); if (avoid.length) p.set("avoid", avoid.join("|")); return `${EMBED}/directions?${p}`; }
  if (mode === "place" || mode === "search") { p.set("q", txt("q") || "map"); return `${EMBED}/${mode}?${p}`; }
  p.set("center", /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(txt("center")) ? txt("center") : "39.8,-98.6"); p.set("zoom", String(Math.min(18, Math.max(1, Number(q.get("zoom")) || 12))));
  return `${EMBED}/view?${p}`;
}

// ---- testing a key --------------------------------------------------------------------------------------------------
// Google: one IDs-only Text Search (free) and one traffic-unaware route (Essentials) → what works and what to fix.
export async function testKey(provider) {
  if (provider === "google") {
    if (!settings.googleKey()) return { ok: false, text: "No Google Maps key is saved yet." };
    const out = { ok: true, checks: [] };
    const run = async (name, fn) => { try { await fn(); out.checks.push({ name, ok: true, text: "Works" }); } catch (e) { out.ok = false; out.checks.push({ name, ok: false, text: e.message, code: e.code ?? "" }); } };
    await run("Places API (New)", () => request("google-places", "/v1/places:searchText", { method: "POST", headers: { "X-Goog-Api-Key": settings.googleKey(), "X-Goog-FieldMask": "places.id" }, body: { textQuery: "library", maxResultCount: 1 } }));
    await run("Routes API", () => request("google-routes", "/directions/v2:computeRoutes", { method: "POST", headers: { "X-Goog-Api-Key": settings.googleKey(), "X-Goog-FieldMask": "routes.distanceMeters" },
      body: { origin: { location: { latLng: { latitude: 40.7484, longitude: -73.9857 } } }, destination: { location: { latLng: { latitude: 40.7527, longitude: -73.9772 } } }, travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE" } }));
    out.checks.push({ name: "Maps Embed API", ok: null, text: "Shown on the Maps panel itself: if the map there says the API isn't enabled, turn on Maps Embed API." });
    out.text = out.ok ? "Your Google Maps key works for search and directions." : out.checks.filter((c) => c.ok === false).map((c) => `${c.name}: ${c.text}`).join(" ");
    return out;
  }
  if (provider === "ors") {
    if (!settings.orsKey()) return { ok: false, text: "No OpenRouteService key is saved yet." };
    try { await request("ors", "/v2/directions/driving-car?start=8.681495,49.41461&end=8.687872,49.420318", { headers: { Authorization: settings.orsKey() } }); return { ok: true, text: "Your OpenRouteService key works." }; }
    catch (e) { return { ok: false, text: e.message }; }
  }
  if (provider === "osm") {
    try { await request("nominatim", "/search?format=jsonv2&limit=1&q=London", {}); return { ok: true, text: "OpenStreetMap search answered." }; } catch (e) { return { ok: false, text: e.message }; }
  }
  return { ok: false, text: "provider must be google, ors or osm" };
}
async function keyView() {
  const envfile = await import("../envfile.mjs");
  const k = envfile.status(Object.values(settings.KEY_VARS));
  return { google: { set: Boolean(k[settings.KEY_VARS.google]?.set), last4: k[settings.KEY_VARS.google]?.last4 ?? "" }, ors: { set: Boolean(k[settings.KEY_VARS.ors]?.set), last4: k[settings.KEY_VARS.ors]?.last4 ?? "" } };
}
const settingsView = async () => ({ settings: settings.get(), keys: await keyView(), services: settings.services() });

export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (!p.startsWith("/maps")) return false;
  if (p === "/maps/enabled") return send(res, 200, { enabled: featureOn("maps") }), true;
  if (!featureOn("maps")) { send(res, 404, { error: "Maps isn't turned on in this version of Dayspring." }); return true; }
  let mm;
  try {
    if (m === "GET") {
      if (p === "/maps/state") return send(res, 200, guide.view()), true;
      if (p === "/maps/suggest") return send(res, 200, { seq: Number(q.get("seq")) || 0, items: await guide.suggest(q.get("q") ?? "", Number(q.get("seq")) || undefined) }), true;
      if ((mm = p.match(/^\/maps\/tile\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.png$/))) { await tile(res, Number(mm[1]), Number(mm[2]), Number(mm[3])); return true; }
      if (p === "/maps/embed") { const u = embedUrl(q); if (!u) return send(res, 404, { error: "No Google Maps key." }), true; res.writeHead(302, { location: u, "cache-control": "no-store", "referrer-policy": "no-referrer-when-downgrade" }); res.end(); return true; }
      if (p === "/maps/settings") return send(res, 200, await settingsView()), true;
      return false;
    }
    if (m !== "POST") return false;
    const b = await readJSON(req).catch(() => ({})) ?? {};
    if (p === "/maps/search") { await guide.search(String(b.q ?? ""), { nearMe: Boolean(b.nearMe) }); return send(res, 200, guide.view()), true; }
    if (p === "/maps/directions") { await guide.route({ to: b.to ?? null, from: b.from || null, mode: b.mode || null, avoid: b.avoid || null }); return send(res, 200, { ...guide.view(), say: guide.summary() }), true; }
    if (p === "/maps/act") {
      const a = String(b.action ?? "");
      let say = "";
      if (a === "open") guide.open();
      else if (a === "close") guide.close();
      else if (a === "select") guide.select(b.n);
      else if (a === "place") await guide.showPlace(b.place);
      else if (a === "mode") await guide.setMode(String(b.mode ?? ""));
      else if (a === "avoid") await guide.setAvoid({ [String(b.what)]: Boolean(b.on) });
      else if (a === "alt") guide.pickAlt(Number(b.i));
      else if (a === "step") { const x = guide.step(["next", "previous", "repeat", "first", "current"].includes(b.step) ? b.step : "current"); say = x.text; }
      else if (a === "goto") { const st = guide.state(); const r = st.routes[st.alt]; const i = Number(b.i); if (!r || !(i >= 0 && i < r.steps.length)) throw new MapsError("There's no such step."); st.step = i; st.guided = true; say = guide.step("current").text; }
      else if (a === "guide") { say = guide.startGuided().text; }
      else if (a === "auto") { say = guide.startAuto().text; }
      else if (a === "stop") guide.stopGuided();
      else if (a === "qr") guide.toggleQr(b.on);
      else if (a === "phone") { const r = await guide.sendToPhone(); return send(res, 200, { ...guide.view(), sent: r.sent, reason: r.reason }), true; }
      else if (a === "units") { settings.set({ units: b.units === "km" ? "km" : "mi" }); guide.pushNow(); }
      else return send(res, 400, { error: "unknown action" }), true;
      if (say && b.speak !== false) speak(say);
      return send(res, 200, { ...(a === "close" ? { open: false } : guide.view()), say }), true;
    }
    if (p === "/maps/settings") { settings.set(b); guide.pushNow(); return send(res, 200, await settingsView()), true; }
    if (p === "/maps/key") {
      const prov = b.provider === "google" ? "google" : b.provider === "ors" ? "ors" : null;
      if (!prov) return send(res, 400, { error: "provider must be google or ors" }), true;
      const key = String(b.key ?? "").trim();
      if (key && !/^[\w.=-]{10,300}$/.test(key)) return send(res, 400, { error: "That doesn't look like a key. Copy it again, without spaces." }), true;
      (await import("../envfile.mjs")).setVars({ [settings.KEY_VARS[prov]]: key });
      if (guide.state().open) guide.pushNow();
      return send(res, 200, await settingsView()), true;
    }
    if (p === "/maps/test") return send(res, 200, await testKey(String(b.provider ?? ""))), true;
    if (p === "/maps/leaveby") return send(res, 200, await guide.leaveByFor({ where: b.where, date: b.date, start: b.start, title: b.title ?? "", mode: b.mode || null })), true;
    if (p === "/maps/leaveby/remind") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date)) || !/^\d{2}:\d{2}$/.test(String(b.time))) return send(res, 400, { error: "date and time are needed" }), true;
      const add = deps.addReminder ?? (await import("../reminders.mjs")).add;
      const r = add({ date: b.date, time: b.time, text: String(b.text ?? "leave").slice(0, 200), spoken: String(b.spoken ?? "").slice(0, 300) || null });
      return send(res, 200, { reminder: r }), true;
    }
    if (p === "/maps/position") return send(res, 200, guide.position(b)), true;
    return false;
  } catch (e) {
    return send(res, e instanceof MapsError ? 400 : 500, { error: e.message || "Maps couldn't do that just now.", code: e.code ?? "" }), true;
  }
}
