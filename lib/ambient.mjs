// What it's like outside right now, for the living sky on the Dayspring screen: where the sun is (sunrise, sunset and the
// twilights, computed for the owner's location), the weather (Open-Meteo, free, no key), the season and the moon.
// Cached for 12 minutes; with no internet the sun and moon are still computed (the weather reads as clear).
// The screen asks GET /api/ambient; when the weather changes in a way you'd see (rain starts, it clears up…), an
// "ambient" event goes out so the sky follows right away.
import * as owner from "./owner.mjs";
import { broadcast } from "./announcer.mjs";

const RAD = Math.PI / 180, DAY_MS = 86_400_000, J1970 = 2440588, J2000 = 2451545;
const coord = (env, v) => (process.env[env] ? Number(process.env[env]) : v === null || v === undefined || v === "" ? null : Number(v));
const LAT = () => coord("DAYSPRING_LAT", owner.get().location?.lat), LON = () => coord("DAYSPRING_LON", owner.get().location?.lon);

// ---- the sun (the standard NOAA / SunCalc formulas) ------------------------------------------------------------------
const toDays = (d) => d.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
const fromJulian = (j) => new Date((j + 0.5 - J1970) * DAY_MS);
const e = RAD * 23.4397;
const declination = (l) => Math.asin(Math.sin(e) * Math.sin(l));
const solarMeanAnomaly = (d) => RAD * (357.5291 + 0.98560028 * d);
const eclipticLongitude = (M) => M + RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + RAD * 102.9372 + Math.PI;
const rightAscension = (l) => Math.atan2(Math.sin(l) * Math.cos(e), Math.cos(l));
const siderealTime = (d, lw) => RAD * (280.16 + 360.9856235 * d) - lw;
// the sun's height above the horizon, in degrees
export function sunElevation(date, lat, lon) {
  const lw = RAD * -lon, phi = RAD * lat, d = toDays(date), M = solarMeanAnomaly(d), L = eclipticLongitude(M);
  const dec = declination(L), H = siderealTime(d, lw) - rightAscension(L);
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / RAD;
}
// when the sun crosses a given height today: { rise, set } (null when it never does, e.g. polar summer)
function sunTimes(date, lat, lon, h0 = -0.833) {
  const lw = RAD * -lon, phi = RAD * lat, d = toDays(date);
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI)), ds = 0.0009 + lw / (2 * Math.PI) + n;
  const M = solarMeanAnomaly(ds), L = eclipticLongitude(M), dec = declination(L);
  const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const cosw = (Math.sin(h0 * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosw < -1 || cosw > 1) return { rise: null, set: null, noon: fromJulian(Jnoon) };
  const w = Math.acos(cosw), a = 0.0009 + (w + lw) / (2 * Math.PI) + n;
  const Jset = J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  return { rise: fromJulian(Jnoon - (Jset - Jnoon)), set: fromJulian(Jset), noon: fromJulian(Jnoon) };
}
// the moon's phase: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter; illumination 0…1
export function moonPhase(date = new Date()) {
  const synodic = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14);
  const phase = (((date - ref) / DAY_MS / synodic) % 1 + 1) % 1;
  return { phase: Math.round(phase * 1000) / 1000, illumination: Math.round(((1 - Math.cos(2 * Math.PI * phase)) / 2) * 100) / 100,
    name: phase < 0.03 || phase > 0.97 ? "new moon" : phase < 0.22 ? "waxing crescent" : phase < 0.28 ? "first quarter" : phase < 0.47 ? "waxing gibbous" : phase < 0.53 ? "full moon" : phase < 0.72 ? "waning gibbous" : phase < 0.78 ? "last quarter" : "waning crescent" };
}
// the season, by the solstices and equinoxes, flipped south of the equator
export function season(date = new Date(), lat = 35) {
  const md = (date.getMonth() + 1) * 100 + date.getDate();
  const north = md >= 320 && md < 621 ? "spring" : md >= 621 && md < 923 ? "summer" : md >= 923 && md < 1221 ? "fall" : "winter";
  return lat < 0 ? { spring: "fall", summer: "winter", fall: "spring", winter: "summer" }[north] : north;
}

// ---- the weather ----------------------------------------------------------------------------------------------------
// WMO code → what the sky should show
export function kindOf(code) {
  if ([95, 96, 99].includes(code)) return { kind: "storm", intensity: code === 95 ? 0.7 : 1 };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { kind: "snow", intensity: { 71: 0.35, 73: 0.6, 75: 1, 77: 0.3, 85: 0.5, 86: 0.9 }[code] };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { kind: "rain", intensity: { 61: 0.4, 63: 0.65, 65: 1, 66: 0.5, 67: 0.9, 80: 0.45, 81: 0.7, 82: 1 }[code] };
  if ([51, 53, 55, 56, 57].includes(code)) return { kind: "drizzle", intensity: { 51: 0.2, 53: 0.3, 55: 0.4, 56: 0.25, 57: 0.4 }[code] };
  if ([45, 48].includes(code)) return { kind: "fog", intensity: code === 48 ? 1 : 0.75 };
  if (code === 3) return { kind: "overcast", intensity: 1 };
  if (code === 2) return { kind: "partly", intensity: 0.55 };
  if (code === 1) return { kind: "partly", intensity: 0.25 };
  return { kind: "clear", intensity: 0 };
}
let wx = { at: 0, data: null, key: "" };
async function weatherNow(lat, lon) {
  if (wx.data && Date.now() - wx.at < 12 * 60_000) return wx.data;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const p = new URLSearchParams({ latitude: lat, longitude: lon, current: "weather_code,cloud_cover,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day,temperature_2m",
    hourly: "precipitation_probability,precipitation,weather_code", forecast_hours: "3", temperature_unit: "fahrenheit", wind_speed_unit: "mph", timezone: "auto" });
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json(), c = j.current, h = j.hourly ?? {};
    const next = { chance: Math.max(0, ...(h.precipitation_probability ?? []).slice(0, 2).filter(Number.isFinite)), amount: (h.precipitation ?? []).slice(0, 2).reduce((a, b) => a + (b || 0), 0), code: h.weather_code?.[1] ?? null };
    const k = kindOf(c.weather_code);
    const data = { code: c.weather_code, ...k, cloud: c.cloud_cover, precipitation: c.precipitation, wind: Math.round(c.wind_speed_10m), windDir: Math.round(c.wind_direction_10m ?? 0), gusts: Math.round(c.wind_gusts_10m ?? c.wind_speed_10m), isDay: Boolean(c.is_day), temp: Math.round(c.temperature_2m), nextHour: { ...next, kind: next.code === null ? null : kindOf(next.code).kind } };
    const key = `${data.kind}|${Math.round((data.cloud ?? 0) / 30)}|${Math.round(data.intensity * 3)}`;
    const changed = wx.key && key !== wx.key;
    wx = { at: Date.now(), data, key };
    if (changed) broadcast("ambient", { reason: "weather", weather: data });
    return data;
  } catch { return wx.data; }         // offline: the last reading, or none (clear skies)
}

// Everything the sky needs.
export async function now(date = new Date()) {
  let lat = LAT(), lon = LON();
  const located = Number.isFinite(lat) && Number.isFinite(lon);
  // no location yet: a guess from the time zone (its standard-time offset; summer time would shift it an hour east)
  if (!located) { lat = 35; lon = -new Date(new Date().getFullYear(), 0, 1).getTimezoneOffset() / 4; }
  const sun = sunTimes(date, lat, lon), civil = sunTimes(date, lat, lon, -6), nautical = sunTimes(date, lat, lon, -12);
  const iso = (d) => (d ? d.toISOString() : null);
  const w = await weatherNow(located ? lat : NaN, located ? lon : NaN);
  return {
    located, lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100, place: owner.get().location?.place ?? "",
    sun: { elevation: Math.round(sunElevation(date, lat, lon) * 10) / 10, sunrise: iso(sun.rise), sunset: iso(sun.set), noon: iso(sun.noon), dawn: iso(civil.rise), dusk: iso(civil.set), nauticalDawn: iso(nautical.rise), nauticalDusk: iso(nautical.set) },
    weather: w ?? { kind: "clear", intensity: 0, cloud: 0, code: 0, wind: 4, windDir: 180, gusts: 6, live: false },
    season: season(date, lat),
    moon: moonPhase(date),
    at: date.toISOString(),
  };
}
// keeps the weather fresh (and the "ambient" event flowing) while the screen is on
let timer = null;
export function keepFresh() { if (!timer) { timer = setInterval(() => { now().catch(() => {}); }, 12 * 60_000); timer.unref?.(); } }
