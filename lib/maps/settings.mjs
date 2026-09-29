// Settings → Maps: which maps to use, units, the usual way of getting around, spoken guidance. Kept in data/maps.json
// (DAYSPRING_MAPS_FILE for tests). The keys are NOT here: they live in .env (lib/envfile.mjs), never shown back.
//   provider  "auto"  Google when a Google Maps key is saved, otherwise the free OpenStreetMap maps (the default)
//             "osm"   always the free maps          "google"  always Google (needs the key)
//   units "mi" | "km" · mode "driving" | "walking" | "cycling" | "transit" · voice (say each step) · autoSeconds (the demo)
//   richDetails: ratings and opening hours from Google (the Enterprise tier of Places Text Search: 1,000 free a month)
//   traffic: live-traffic times from Google (the Pro tier of Routes: 5,000 free a month)
//   bufferMin: the cushion in "leave by"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FILE = () => process.env.DAYSPRING_MAPS_FILE || join(process.env.DAYSPRING_DATA_DIR || join(ROOT, "data"), "maps.json");
export const KEY_VARS = { google: "GOOGLE_MAPS_API_KEY", ors: "OPENROUTESERVICE_API_KEY" };
export const MODES = ["driving", "walking", "cycling", "transit"];
export const DEFAULTS = { provider: "auto", units: "mi", mode: "driving", voice: true, autoSeconds: 8, richDetails: false, traffic: false, bufferMin: 5, avoid: { highways: false, tolls: false, ferries: false } };

let cache = null;
export function get() {
  if (cache) return structuredClone(cache);
  let saved = {};
  try { if (existsSync(FILE())) saved = JSON.parse(readFileSync(FILE(), "utf8").replace(/^﻿/, "")) ?? {}; } catch { saved = {}; }
  cache = clean({ ...DEFAULTS, ...saved, avoid: { ...DEFAULTS.avoid, ...(saved.avoid ?? {}) } });
  return structuredClone(cache);
}
function clean(s) {
  return {
    provider: ["auto", "osm", "google"].includes(s.provider) ? s.provider : "auto",
    units: s.units === "km" ? "km" : "mi",
    mode: MODES.includes(s.mode) ? s.mode : "driving",
    voice: s.voice !== false,
    autoSeconds: Math.min(60, Math.max(3, Math.round(Number(s.autoSeconds) || DEFAULTS.autoSeconds))),
    richDetails: s.richDetails === true,
    traffic: s.traffic === true,
    bufferMin: Math.min(60, Math.max(0, Math.round(Number(s.bufferMin ?? DEFAULTS.bufferMin)))),
    avoid: { highways: Boolean(s.avoid?.highways), tolls: Boolean(s.avoid?.tolls), ferries: Boolean(s.avoid?.ferries) },
  };
}
export function set(patch = {}) {
  const next = clean({ ...get(), ...patch, avoid: { ...get().avoid, ...(patch.avoid ?? {}) } });
  const f = FILE(); mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n"); renameSync(tmp, f);
  cache = next;
  return structuredClone(next);
}
export const _reset = () => { cache = null; };

export const googleKey = () => String(process.env[KEY_VARS.google] ?? "").trim();
export const orsKey = () => String(process.env[KEY_VARS.ors] ?? "").trim();
// the maps in use right now: "google" or "osm"
export function active(s = get()) {
  if (s.provider === "osm") return "osm";
  if (s.provider === "google") return googleKey() ? "google" : "osm";
  return googleKey() ? "google" : "osm";
}
// which service answers each job, for the screen and Settings
export function services(s = get()) {
  const g = active(s) === "google";
  return {
    active: g ? "google" : "osm",
    map: g ? "Google Maps (Maps Embed API)" : "OpenStreetMap",
    search: g ? "Google Places" : "OpenStreetMap (Nominatim; Photon as you type)",
    route: g ? "Google Routes" : orsKey() ? "OpenRouteService" : "OSRM (FOSSGIS routing servers)",
    transit: g,
    wantedGoogleButNoKey: s.provider === "google" && !googleKey(),
  };
}
