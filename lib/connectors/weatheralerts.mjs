// Severe weather alerts for the owner's location (Settings → Where you are).
//   In the United States: the official National Weather Service alerts (api.weather.gov): tornado, severe
//   thunderstorm, flash flood, winter storm, heat, fire weather warnings and watches.
//   Elsewhere: a heads-up from the forecast (Open-Meteo) when thunderstorms, freezing rain, very strong gusts, very heavy
//   rain or extreme heat or cold are coming — clearly labeled as not an official warning.
// New alerts are announced once each (on the screen and out loud), at most one every 30 minutes unless it's extreme;
// minor ones are only listed. At night only severe and extreme ones speak. Nothing to set up: on unless turned off.
import * as store from "./store.mjs";
import * as owner from "../owner.mjs";

const NWS = () => process.env.NWS_API_BASE || "https://api.weather.gov";
const METEO = () => process.env.OPEN_METEO_BASE || "https://api.open-meteo.com/v1";
const cfg = () => ({ on: true, ...store.load("weatheralerts") });
let testWhere = null;   // tests only: a location without touching the owner's profile
export const _setTestLocation = (l) => { testWhere = l; last = { at: 0, alerts: [], source: null }; };
const where = () => { const l = testWhere ?? owner.get().location ?? {}; return Number.isFinite(l.lat) && Number.isFinite(l.lon) && !(l.lat === 0 && l.lon === 0) ? { lat: l.lat, lon: l.lon, place: l.place || "your area" } : null; };
export const connected = () => cfg().on && Boolean(where());
export function status() { const w = where(); return { id: "weatheralerts", connected: connected(), who: !cfg().on ? "off" : w ? w.place : "set your town first", active: last.alerts.length }; }
export function connect() { store.save("weatheralerts", { ...store.load("weatheralerts"), on: true }); if (!where()) throw new Error("Set your town in Settings → Where you are, then weather alerts start by themselves."); return status(); }
export function disconnect() { store.save("weatheralerts", { ...store.load("weatheralerts"), on: false }); return status(); }

let last = { at: 0, alerts: [], source: null };
const UA = { "user-agent": "(Dayspring personal assistant, weather alerts)", accept: "application/geo+json" };
async function nws(w) {
  const r = await fetch(`${NWS()}/alerts/active?point=${w.lat.toFixed(4)},${w.lon.toFixed(4)}`, { headers: UA, signal: AbortSignal.timeout(15_000) });
  if (r.status === 400 || r.status === 404) return null;   // not a U.S. point
  if (!r.ok) throw await store.fail(r, "The National Weather Service");
  const j = await r.json();
  return (j.features ?? []).map((f) => f.properties ?? {}).filter((p) => p.status !== "Test" && p.messageType !== "Cancel").map((p) => ({
    id: p.id, event: p.event, severity: p.severity ?? "Unknown", urgency: p.urgency ?? null, headline: p.headline ?? p.event, instruction: (p.instruction ?? "").replace(/\s+/g, " ").slice(0, 400),
    description: (p.description ?? "").replace(/\s+/g, " ").slice(0, 600), expires: p.ends ?? p.expires ?? null, official: true, source: "National Weather Service" }));
}
async function forecastHeadsUp(w) {
  const r = await fetch(`${METEO()}/forecast?latitude=${w.lat}&longitude=${w.lon}&hourly=weather_code,wind_gusts_10m,precipitation,apparent_temperature&forecast_hours=12&timezone=auto`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw await store.fail(r, "The forecast service");
  const h = (await r.json()).hourly ?? {}, out = [], t = h.time ?? [];
  const firstIdx = (pred) => t.findIndex((_, i) => pred(i));
  const at = (i) => new Date(t[i]).toLocaleTimeString("en-US", { hour: "numeric" });
  let i;
  if ((i = firstIdx((k) => [95, 96, 99].includes(h.weather_code?.[k]))) >= 0) out.push({ id: `om-storm-${t[i]}`, event: "Thunderstorms", severity: [96, 99].includes(h.weather_code[i]) ? "Severe" : "Moderate", headline: `Thunderstorms${[96, 99].includes(h.weather_code[i]) ? " with hail" : ""} expected around ${at(i)}` });
  if ((i = firstIdx((k) => [66, 67].includes(h.weather_code?.[k]))) >= 0) out.push({ id: `om-ice-${t[i]}`, event: "Freezing rain", severity: "Severe", headline: `Freezing rain expected around ${at(i)}: roads may be icy` });
  if ((i = firstIdx((k) => (h.wind_gusts_10m?.[k] ?? 0) >= 80)) >= 0) out.push({ id: `om-wind-${t[i]}`, event: "Strong wind", severity: (h.wind_gusts_10m[i] >= 100 ? "Severe" : "Moderate"), headline: `Gusts up to ${Math.round(h.wind_gusts_10m[i] * 0.621)} mph around ${at(i)}` });
  if ((i = firstIdx((k) => (h.precipitation?.[k] ?? 0) >= 10)) >= 0) out.push({ id: `om-rain-${t[i]}`, event: "Very heavy rain", severity: "Moderate", headline: `Very heavy rain around ${at(i)}: watch for flooding` });
  if ((i = firstIdx((k) => (h.apparent_temperature?.[k] ?? 0) >= 40)) >= 0) out.push({ id: `om-heat-${t[i]}`, event: "Extreme heat", severity: "Severe", headline: `It will feel like ${Math.round(h.apparent_temperature[i] * 9 / 5 + 32)}°F around ${at(i)}` });
  if ((i = firstIdx((k) => (h.apparent_temperature?.[k] ?? 99) <= -20)) >= 0) out.push({ id: `om-cold-${t[i]}`, event: "Extreme cold", severity: "Severe", headline: `It will feel like ${Math.round(h.apparent_temperature[i] * 9 / 5 + 32)}°F around ${at(i)}` });
  return out.map((a) => ({ ...a, official: false, source: "forecast (not an official warning)", instruction: "", description: "", expires: null }));
}
// The alerts now (cached 5 minutes)
export async function current({ fresh = false } = {}) {
  const w = where();
  if (!w) return { alerts: [], note: "Set your town in Settings → Where you are for weather alerts." };
  if (!fresh && Date.now() - last.at < 5 * 60_000) return { alerts: last.alerts, source: last.source, place: w.place };
  let alerts = await nws(w).catch(() => null), source = "National Weather Service";
  if (alerts === null) { alerts = await forecastHeadsUp(w).catch(() => []); source = "forecast"; }
  last = { at: Date.now(), alerts, source };
  return { alerts, source, place: w.place };
}

// The background check: every 10 minutes, announce what's new. announce(item) is the server's announcer.announce.
let timer = null;
const SEVERITY = { Extreme: 3, Severe: 2, Moderate: 1, Minor: 0, Unknown: 0 };
export function startBackground(announce) {
  if (timer) return;
  const check = async () => {
    if (!connected()) return;
    const s = store.load("weatheralerts"), seen = new Set(s.seen ?? []);
    let lastSpoke = s.lastSpoke ?? 0;
    const { alerts = [] } = await current({ fresh: true }).catch(() => ({}));
    const night = (() => { const h = new Date().getHours(); return h >= 22 || h < 7; })();
    for (const a of alerts.sort((x, y) => (SEVERITY[y.severity] ?? 0) - (SEVERITY[x.severity] ?? 0))) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      const sev = SEVERITY[a.severity] ?? 0;
      if (sev < 1 || (night && sev < 2) || (sev < 3 && Date.now() - lastSpoke < 30 * 60_000)) continue;
      lastSpoke = Date.now();
      announce({ kind: "weather", severity: a.severity ?? null, official: Boolean(a.official), title: a.official ? `⚠ ${a.event}` : `Weather heads-up: ${a.event}`,
        text: `${a.official ? "Weather alert" : "Weather heads-up"}: ${a.headline}.${a.instruction ? " " + a.instruction.split(/(?<=\.)\s/)[0] : ""}${a.official ? "" : " This isn't an official warning."}` });
    }
    store.save("weatheralerts", { ...store.load("weatheralerts"), seen: [...seen].slice(-200), lastSpoke });
  };
  timer = setInterval(check, 10 * 60_000);
  setTimeout(check, 30_000);
}
export function stopBackground() { clearInterval(timer); timer = null; }
