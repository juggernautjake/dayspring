// Finding a place by its name or zip code (Settings → Where you are, and "I live in Springfield, Illinois" by voice): the free
// Open-Meteo geocoder, no key. → [{ place: "Springfield, Illinois", lat, lon, timezone }] (best first), or throws when offline.
// Tests set DAYSPRING_GEOCODE_FILE to a JSON file { "springfield illinois": [results…] } instead of going online.
import { readFileSync } from "node:fs";

const key = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
export async function geocode(name, { count = 6 } = {}) {
  const q = String(name ?? "").trim().slice(0, 80);
  if (q.length < 2) return [];
  if (process.env.DAYSPRING_GEOCODE_FILE) {
    const all = JSON.parse(readFileSync(process.env.DAYSPRING_GEOCODE_FILE, "utf8"));
    return all[key(q)] ?? all[key(q).split(" ")[0]] ?? [];
  }
  // "Springfield, Illinois": the geocoder wants the town; the rest picks among the answers
  // ("Springfield Illinois" with no comma: a state name or its two letters at the end is the hint)
  let parts = q.split(/\s*,\s*/);
  if (parts.length === 1) { const lower = q.toLowerCase(), hit = [...Object.values(STATES), ...Object.keys(STATES)].sort((a, b) => b.length - a.length).find((n) => lower.endsWith(" " + n)); if (hit) parts = [q.slice(0, q.length - hit.length).trim(), hit]; }
  const [town, ...rest] = parts;
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=${count}&language=en&format=json&name=${encodeURIComponent(town || q)}`, { signal: AbortSignal.timeout(8000) });
  const j = await r.json();
  let res = (j.results ?? []).map((x) => ({ place: [x.name, x.admin1, x.country_code === "US" ? null : x.country].filter(Boolean).join(", "), lat: x.latitude, lon: x.longitude, timezone: x.timezone, region: x.admin1 ?? "", country: x.country ?? "" }));
  const hint = key(rest.join(" "));
  if (hint) { const better = res.filter((x) => key(`${x.region} ${x.country}`).includes(hint) || STATES[hint] && key(x.region) === STATES[hint]); if (better.length) res = better; }
  return res;
}
const STATES = { tx: "texas", ca: "california", ny: "new york", fl: "florida", ok: "oklahoma", la: "louisiana", az: "arizona", co: "colorado", ga: "georgia", il: "illinois", oh: "ohio", pa: "pennsylvania", wa: "washington", or: "oregon", tn: "tennessee", nc: "north carolina", sc: "south carolina", va: "virginia", mi: "michigan", mo: "missouri", ks: "kansas", nm: "new mexico", al: "alabama", ar: "arkansas", ky: "kentucky", in: "indiana", mn: "minnesota", wi: "wisconsin", ut: "utah", nv: "nevada", id: "idaho", mt: "montana", ne: "nebraska", ia: "iowa", ms: "mississippi" };
