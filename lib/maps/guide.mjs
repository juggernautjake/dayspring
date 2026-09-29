// What the Maps panel is showing, and everything that changes it: a search and its numbered results, the start and
// the destination, the travel mode, the routes (the chosen one and its alternatives), the current step, guided mode and
// the auto-advancing demo. Voice, the AI's tools, the panel's buttons and the schedule all come through here, so they
// stay in step; every change is sent to the screen as the "maps" event (public/maps.js draws it).
//
// This computer has no GPS: a route starts from HOME (Settings → Where you are) unless a start is given ("from …" or
// the panel's From box). Live navigation needs a moving position: position() is the hook for that (a phone client of
// lib/remote could send one); until then steps move on when he says "next", or on a timer in the demo.
import * as settings from "./settings.mjs";
import { search as findPlaces, suggest as suggestPlaces, details, haversine } from "./search.mjs";
import { directions } from "./route.mjs";
import { spokenStep, spokenDistance, spokenDuration, shortDistance, shortDuration, clock, leaveBy as leaveByCalc, sayable } from "./words.mjs";
import { MapsError } from "./net.mjs";

let deps = {
  broadcast: () => {},
  announce: () => {},                                    // (item) → the floor decides when it's said (lib/announcer)
  home: () => null,                                      // → { place, lat, lon } from Settings → Where you are
  notify: async () => ({ sent: 0, reason: "no other devices" }),   // (msg) → lib/remote notify to his phone
  now: () => new Date(),
};
export function setDeps(d) { deps = { ...deps, ...d }; }

const blank = () => ({ open: false, q: "", nearMe: false, results: [], selected: null, from: null, to: null, mode: settings.get().mode, avoid: { ...settings.get().avoid },
  routes: [], alt: 0, step: 0, guided: false, auto: false, qr: false, error: "", busy: "", at: 0, lastSpoken: "", lastUsed: 0 });
let st = blank();
let autoTimer = null;
export const _reset = () => { stopAuto(); st = blank(); };
export const state = () => st;
const MODE_WORD = { driving: "by car", walking: "on foot", cycling: "by bike", transit: "by bus or train" };
export const MODE_LABEL = { driving: "Drive", walking: "Walk", cycling: "Bike", transit: "Transit" };

// ---- where "home" and "here" are ---------------------------------------------------------------------------------------
export function home() {
  const h = deps.home?.();
  const lat = Number(h?.lat), lon = Number(h?.lon);
  if (!h || !Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0) || h.lat == null) return null;
  return { id: "home", name: "Home", address: String(h.place ?? ""), lat, lon, source: "home" };
}
const NO_HOME = "I don't know where home is yet. Set it in Settings → Where you are (this computer has no GPS), or say where to start from.";

// ---- the screen -------------------------------------------------------------------------------------------------------
// Google Maps links (they open the same trip in the Google Maps app on a phone, or the website)
export function googleLink({ from = st.from, to = st.to, mode = st.mode, place = null } = {}) {
  const pt = (p) => (p ? (p.name && p.name !== "Home" && p.address ? `${p.name}, ${p.address}` : `${p.lat},${p.lon}`) : "");
  if (place || (!to && st.selected != null)) { const p = place ?? st.results[st.selected]; return p ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pt(p))}` : "https://www.google.com/maps"; }
  if (!to) return "https://www.google.com/maps";
  const u = new URLSearchParams({ api: "1", destination: pt(to), travelmode: { driving: "driving", walking: "walking", cycling: "bicycling", transit: "transit" }[mode] ?? "driving" });
  if (from && from.id !== "here") u.set("origin", pt(from));
  return `https://www.google.com/maps/dir/?${u}`;
}
// fewer points for the screen (a long drive can have tens of thousands)
function thin(pts, max = 1500) { if (!pts || pts.length <= max) return pts ?? []; const step = pts.length / max, out = []; for (let i = 0; i < max; i++) out.push(pts[Math.floor(i * step)]); out.push(pts[pts.length - 1]); return out; }
const units = () => settings.get().units;
function routeView(r, i) {
  return { i, distance: r.distance, duration: r.duration, distanceText: shortDistance(r.distance, units()), durationText: shortDuration(r.duration), summary: r.summary, provider: r.provider, traffic: r.traffic, note: r.note ?? "",
    geometry: thin(r.geometry), steps: i === st.alt ? r.steps.map((s, k) => ({ n: k + 1, text: s.text, distance: s.distance, distanceText: s.distance ? shortDistance(s.distance, units()) : "", at: s.at, kind: s.kind })) : undefined };
}
export function view() {
  const s = settings.get(), sv = settings.services(s);
  const h = home();
  return {
    open: st.open, q: st.q, nearMe: st.nearMe, provider: sv.active, services: sv, units: s.units, voice: s.voice, autoSeconds: s.autoSeconds,
    home: h ? { name: h.address || "Home", lat: h.lat, lon: h.lon } : null,
    results: st.results.map((p, i) => ({ n: i + 1, ...p, distanceText: p.distance != null ? shortDistance(p.distance, s.units) : "" })), selected: st.selected,
    from: st.from, to: st.to, mode: st.mode, avoid: st.avoid, alt: st.alt, step: st.step, guided: st.guided, auto: st.auto, qr: st.qr,
    routes: st.routes.map(routeView), stepText: st.routes.length ? spokenStep(cur().steps, st.step, s.units) : "",
    link: googleLink(), error: st.error, busy: st.busy, at: st.at,
    embed: sv.active === "google" ? embedParams() : null,
  };
}
// what the Google map on the panel shows (the key is added by /api/maps/embed, never sent to the screen)
function embedParams() {
  if (st.to && st.from) return { mode: "directions", origin: `${st.from.lat},${st.from.lon}`, destination: `${st.to.lat},${st.to.lon}`, travel: { driving: "driving", walking: "walking", cycling: "bicycling", transit: "transit" }[st.mode],
    ...(st.mode === "driving" ? Object.fromEntries(Object.entries(st.avoid).filter(([, v]) => v).map(([k]) => [`avoid_${k}`, "1"])) : {}) };
  const p = st.selected != null ? st.results[st.selected] : st.results[0];
  if (p) return { mode: "place", q: p.name && p.address ? `${p.name}, ${p.address}` : `${p.lat},${p.lon}` };
  if (st.q) return { mode: "search", q: st.q };
  const h = home();
  return { mode: "view", center: h ? `${h.lat},${h.lon}` : "39.8,-98.6", zoom: h ? 12 : 4 };
}
function push() { st.at = Date.now(); st.lastUsed = Date.now(); const v = view(); deps.broadcast("maps", v); return v; }
export const pushNow = push;
const cur = () => st.routes[st.alt] ?? st.routes[0];

// ---- opening and closing ---------------------------------------------------------------------------------------------
export function open() { st.open = true; st.error = ""; return push(); }
export function close() { stopAuto(); st.open = false; st.guided = false; st.qr = false; deps.broadcast("maps", { open: false, at: Date.now() }); return { open: false }; }
export const isOpen = () => st.open;
// used recently enough that "next step" and "how far is it" mean the map (not a recipe)
export const active = (ms = 30 * 60_000) => st.open && Date.now() - st.lastUsed < ms;

// ---- searching -----------------------------------------------------------------------------------------------------------
export async function search(q, { nearMe = false, near = null } = {}) {
  q = String(q ?? "").trim();
  const h = home();
  const point = near ?? (h ? { lat: h.lat, lon: h.lon } : null);
  if (nearMe && !h) throw new MapsError(NO_HOME, { code: "no-home" });
  st.open = true; st.q = q; st.nearMe = Boolean(nearMe); st.error = ""; st.busy = "search"; st.qr = false;
  try {
    st.results = await findPlaces(q, { near: point, nearOnly: Boolean(nearMe) });
    st.selected = st.results.length ? 0 : null;
  } catch (e) { st.error = e.message; st.results = []; st.selected = null; throw e; }
  finally { st.busy = ""; push(); }
  return st.results;
}
export async function suggest(q, seq) { const h = home(); return suggestPlaces(q, { near: h ? { lat: h.lat, lon: h.lon } : null, seq }); }
// a suggestion picked while typing: shown as the one result (Google's is looked up first: Place Details)
export async function showPlace(p) {
  if (!p || typeof p !== "object" || !p.name) throw new MapsError("That place can't be shown.");
  const x = await details({ id: String(p.id ?? ""), name: String(p.name).slice(0, 200), address: String(p.address ?? "").slice(0, 300), lat: p.lat == null ? null : Number(p.lat), lon: p.lon == null ? null : Number(p.lon), source: p.source === "google" ? "google" : "osm", needsDetails: Boolean(p.needsDetails) });
  if (!Number.isFinite(x.lat) || !Number.isFinite(x.lon)) throw new MapsError("That place has no location.");
  const h = home(); if (h) x.distance = Math.round(haversine(h, x));
  st.open = true; st.q = x.name; st.nearMe = false; st.results = [x]; st.selected = 0; st.error = ""; st.qr = false; push();
  return x;
}
export function select(n) {
  const i = Number(n) - 1;
  if (!(i >= 0 && i < st.results.length)) throw new MapsError(`There's no number ${n} on the map.`);
  st.selected = i; push(); return st.results[i];
}
// "Temple Mall", "home", "number 2", or a place the panel already has → a place with a location
export async function resolvePlace(what, { near = true } = {}) {
  if (what && typeof what === "object") return what.needsDetails ? details(what) : what;
  const t = String(what ?? "").trim().replace(/[.?!]+$/, "");
  if (!t) throw new MapsError("Where to?");
  if (/^(?:my )?(?:home|house|place)$|^(?:my )?home address$/i.test(t)) { const h = home(); if (!h) throw new MapsError(NO_HOME, { code: "no-home" }); return h; }
  const num = /^(?:number |result |#)?(\d{1,2})$/i.exec(t);
  if (num && st.results[Number(num[1]) - 1]) return st.results[Number(num[1]) - 1];
  const h = home(), point = near && h ? { lat: h.lat, lon: h.lon } : null;
  // "the park", "a gas station": the nearest one to home; a name or an address: the best match (nearer ones first)
  const generic = /^(?:the|a|an|some) /i.test(t) && point;
  let list = generic ? await findPlaces(t.replace(/^(?:the|a|an|some) /i, ""), { near: point, nearOnly: true, limit: 5 }).catch(() => []) : [];
  if (!list.length) list = await findPlaces(t, { near: point, nearOnly: false, limit: 5 });
  if (!list.length) throw new MapsError(`I couldn't find “${t}” on the map.`, { code: "not-found" });
  return list[0];
}

// ---- routes -----------------------------------------------------------------------------------------------------------------
export async function route({ to, from = null, mode = null, avoid = null } = {}) {
  st.open = true; st.error = ""; st.busy = "route"; st.qr = false; push();
  try {
    const dest = await resolvePlace(to ?? (st.selected != null ? st.results[st.selected] : null));
    let start;
    if (from) start = await resolvePlace(from);
    else { start = home(); if (!start) throw new MapsError(NO_HOME, { code: "no-home" }); }
    if (mode) st.mode = settings.MODES.includes(mode) ? mode : st.mode;
    if (avoid) st.avoid = { ...st.avoid, ...avoid };
    st.routes = await directions(start, dest, { mode: st.mode, avoid: st.avoid });
    st.from = { name: start.name, address: start.address ?? "", lat: start.lat, lon: start.lon, id: start.id };
    st.to = { name: dest.name, address: dest.address ?? "", lat: dest.lat, lon: dest.lon, id: dest.id };
    st.alt = 0; st.step = 0; st.guided = false; st.rid = Date.now(); stopAuto();
    return cur();
  } catch (e) { st.error = e.message; throw e; }
  finally { st.busy = ""; push(); }
}
const again = () => route({ to: st.to, from: st.from?.id === "home" ? null : st.from });
export async function setMode(mode) { if (!settings.MODES.includes(mode)) throw new MapsError("Driving, walking, cycling or transit?"); st.mode = mode; if (!st.to) { push(); return null; } return again(); }
export async function setAvoid(a) { st.avoid = { ...st.avoid, ...a }; if (!st.to) { push(); return null; } return again(); }
export function pickAlt(i) { i = Number(i); if (!(i >= 0 && i < st.routes.length)) throw new MapsError(`There's no route ${i + 1}.`); st.alt = i; st.step = 0; push(); return cur(); }

// "It's 12 miles, about 18 minutes by car, via I 35. Leave now and you'd get there around 3:42 p.m."
export function summary(r = cur(), { eta = true } = {}) {
  if (!r) return "";
  const u = units(), arrive = new Date(deps.now().getTime() + r.duration * 1000);
  const alts = st.routes.length > 1 ? ` There ${st.routes.length === 2 ? "is 1 other route" : `are ${st.routes.length - 1} other routes`} on the screen.` : "";
  return `To ${sayable(st.to?.name ?? "there")}: ${spokenDistance(r.distance, u)}, about ${spokenDuration(r.duration)} ${MODE_WORD[r.mode] ?? ""}${r.summary ? `, ${sayable(r.summary)}` : ""}.${eta ? ` Leave now and you'd get there around ${clock(arrive)}.` : ""}${r.traffic ? "" : r.mode === "driving" ? " (That's without live traffic.)" : ""}${alts}`.replace(/\.\./g, ".").replace(/\s+/g, " ").replace(/ \./g, ".");
}
export function eta() {
  const r = cur(); if (!r) return null;
  const left = r.steps.slice(st.step).reduce((a, s) => a + s.duration, 0) || r.duration;
  return { at: new Date(deps.now().getTime() + left * 1000), seconds: left };
}
export function remaining() {
  const r = cur(); if (!r) return null;
  const dist = st.step === 0 ? r.distance : r.steps.slice(st.step - 1).reduce((a, s) => a + s.distance, 0);
  return { distance: dist, text: spokenDistance(dist, units()) };
}

// ---- steps ------------------------------------------------------------------------------------------------------------
// step("next" | "previous" | "repeat" | "first" | "current" | "all") → { text, index, total, done }
export function step(action = "current") {
  const r = cur();
  if (!r) throw new MapsError("There's no route yet. Say “directions to” a place.", { code: "no-route" });
  const n = r.steps.length, u = units();
  if (action === "all") {
    const text = r.steps.map((_, i) => spokenStep(r.steps, i, u)).join(" ");
    return { text, index: st.step, total: n, done: false };
  }
  if (action === "next") { if (st.step >= n - 1) { st.lastSpoken = "That was the last step: you've arrived."; stopAuto(); push(); return { text: st.lastSpoken, index: st.step, total: n, done: true }; } st.step++; }
  else if (action === "previous") { if (st.step === 0) { const t = `That's the first step. ${spokenStep(r.steps, 0, u)}`; st.lastSpoken = t; push(); return { text: t, index: 0, total: n, done: false }; } st.step--; }
  else if (action === "first") st.step = 0;
  else if (action === "repeat" && st.lastSpoken) { push(); return { text: st.lastSpoken, index: st.step, total: n, done: false }; }
  const text = spokenStep(r.steps, st.step, u);
  st.lastSpoken = text;
  push();
  return { text, index: st.step, total: n, done: st.step >= n - 1 };
}
export function startGuided() { const r = cur(); if (!r) throw new MapsError("There's no route yet. Say “directions to” a place.", { code: "no-route" }); st.guided = true; st.step = 0; return step("current"); }
export function stopGuided() { st.guided = false; stopAuto(); push(); }
// the demo: each step said in turn on a timer, through the floor (it waits while he's talking)
export function startAuto(seconds = settings.get().autoSeconds) {
  const r = cur(); if (!r) throw new MapsError("There's no route yet.", { code: "no-route" });
  stopAuto(); st.guided = true; st.auto = true; st.step = 0;
  const first = step("current");
  autoTimer = setInterval(() => {
    const x = step("next");
    if (settings.get().voice) deps.announce({ kind: "navigation", text: x.text });
    if (x.done) stopAuto();
  }, Math.max(3, seconds) * 1000);
  autoTimer.unref?.();
  push();
  return first;
}
export function stopAuto() { if (autoTimer) clearInterval(autoTimer); autoTimer = null; if (st.auto) { st.auto = false; } }

// ---- his phone -----------------------------------------------------------------------------------------------------------
export async function sendToPhone() {
  const link = googleLink();
  const title = st.to ? `Directions to ${st.to.name}` : st.selected != null ? st.results[st.selected]?.name ?? "A place" : "Map";
  st.qr = true; push();
  let r = { sent: 0 };
  try { r = (await deps.notify({ title, body: `${title}: ${link}`, url: link })) ?? { sent: 0 }; } catch (e) { r = { sent: 0, reason: e.message }; }
  return { sent: Number(r.sent) || 0, reason: r.reason ?? "", link };
}
export function toggleQr(on = !st.qr) { st.qr = Boolean(on); push(); return st.qr; }

// ---- live position (the hook for a phone with GPS; nothing sends one yet) ---------------------------------------------
// position({ lat, lon }) → moves to the step being driven and, near the next turn, says it (once per step).
const announced = new Set();
export function position(pos = {}) {
  const r = cur();
  if (!r || !Number.isFinite(Number(pos.lat)) || !Number.isFinite(Number(pos.lon))) return { ok: false };
  const here = { lat: Number(pos.lat), lon: Number(pos.lon) };
  // the maneuver closest ahead: the first step whose point is nearer than the one before it
  let best = st.step, bestD = Infinity;
  for (let i = st.step; i < r.steps.length; i++) { const at = r.steps[i].at; if (!at) continue; const d = haversine(here, { lat: at[0], lon: at[1] }); if (d < bestD) { bestD = d; best = i; } }
  const warn = r.mode === "driving" ? 400 : 60;   // meters before a turn to say it
  let said = null;
  if (best > st.step && bestD < 25) st.step = best;          // passed the maneuver: the next one is current
  const next = Math.min(r.steps.length - 1, bestD < 25 ? best + 1 : best);
  const at = r.steps[next]?.at;
  const dn = at ? haversine(here, { lat: at[0], lon: at[1] }) : Infinity;
  if (dn < warn && !announced.has(`${st.rid}|${st.alt}|${next}`)) {
    announced.add(`${st.rid}|${st.alt}|${next}`);
    said = `In ${spokenDistance(dn, units())}, ${sayable(r.steps[next].text).replace(/^./, (c) => c.toLowerCase())}.`;
    if (settings.get().voice) deps.announce({ kind: "navigation", text: said, requested: true });
  }
  push();
  return { ok: true, step: st.step, said };
}

// ---- leaving on time -------------------------------------------------------------------------------------------------
// For a schedule item with a place: the drive from home, and when to leave. Nothing is shown on the Maps panel.
export async function leaveByFor({ where, date, start, title = "", mode = null } = {}) {
  const h = home(); if (!h) throw new MapsError(NO_HOME, { code: "no-home" });
  const dest = await resolvePlace(where);
  const m = mode ?? settings.get().mode;
  const [r] = await directions(h, dest, { mode: m === "transit" && settings.active() !== "google" ? "driving" : m, alternatives: false });
  const lb = leaveByCalc({ date, start, durationS: r.duration, bufferMin: settings.get().bufferMin, title, now: deps.now() });
  return { ...lb, place: { name: dest.name, address: dest.address, lat: dest.lat, lon: dest.lon }, distanceText: shortDistance(r.distance, units()), durationText: shortDuration(r.duration), mode: r.mode,
    link: googleLink({ from: h, to: dest, mode: r.mode }) };
}
