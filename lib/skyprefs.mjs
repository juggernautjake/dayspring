// How the living sky behind the Dayspring screen should look and move: one source of truth (data/sky.json) for the
// Settings panel, voice commands and the assistant's sky tools. Every change is broadcast ("sky") and applied live.
//
//   follow the real world (time, weather, season) or pick them · per-effect amounts · scenery · colors · motion ·
//   one-tap vibe presets · optional schedule-aware vibes (study → Focus…)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { broadcast } from "./bus.mjs";
import { writeJSONAtomic } from "./atomic.mjs";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "sky.json");
export const PHASES = ["night", "predawn", "sunrise", "morning", "midday", "afternoon", "golden", "sunset", "dusk"];
export const WEATHERS = ["clear", "partly", "overcast", "drizzle", "rain", "storm", "snow", "fog"];
export const SEASONS = ["spring", "summer", "fall", "winter"];
export const SCENES = ["rotate", "hills", "fields", "forest", "river", "none"];
export const CATEGORIES = ["faith", "body", "work", "study", "meal", "home", "rest", "flex"];

export const DEFAULTS = {
  on: true,
  time: { follow: true, phase: "midday", shift: 0 },                         // shift: minutes (±60) added to sunrise/sunset
  weather: { follow: true, choice: "clear", clouds: 1, rain: 1, droplets: 1, snow: 1, fog: 1, lightning: true, wind: 1, rays: 1 },
  season: { follow: true, choice: "fall", particles: 1 },
  scenery: { scene: "rotate", grass: true, water: true, lights: true, stars: true },
  colors: { brightness: 1, saturation: 1, warmth: 0, dim: 0, accentFollows: true },
  motion: "normal", fps: 30,
  preset: "real",
  schedule: { on: false, map: { study: "focus", faith: "calm", rest: "nightowl" } },
};
// One-tap vibes: a patch over the defaults (then tweakable).
export const PRESETS = {
  real: { label: "Real world", desc: "Follows the real time, weather and season.", patch: {} },
  calm: { label: "Calm", desc: "Fewer particles, slower, softer colors.", patch: { weather: { clouds: 0.8, rain: 0.6, droplets: 0.5, wind: 0.5, rays: 0.5, lightning: false }, season: { particles: 0.4 }, colors: { saturation: 0.85, brightness: 0.95 } } },
  cozy: { label: "Cozy", desc: "Warm tones, gentle rain, fireflies.", patch: { weather: { follow: false, choice: "drizzle", rain: 0.6, droplets: 0.8, wind: 0.6, lightning: false }, scenery: { lights: true }, colors: { warmth: 0.55, saturation: 1.05, brightness: 0.9 } } },
  vivid: { label: "Vivid", desc: "More color and more motion.", patch: { weather: { clouds: 1.2, wind: 1.3, rays: 1.4 }, season: { particles: 1.6 }, colors: { saturation: 1.3, brightness: 1.05 } } },
  minimal: { label: "Minimal", desc: "Just the sky's colors: no particles, no scenery.", patch: { weather: { clouds: 0, rain: 0, droplets: 0, snow: 0, fog: 0, lightning: false, rays: 0 }, season: { particles: 0 }, scenery: { scene: "none", grass: false, water: false, lights: false, stars: false } } },
  focus: { label: "Focus", desc: "Dim and still, for studying.", patch: { weather: { rain: 0, droplets: 0, snow: 0, lightning: false, rays: 0, wind: 0.3 }, season: { particles: 0 }, colors: { brightness: 0.7, saturation: 0.7, dim: 0.3 }, motion: "still" } },
  nightowl: { label: "Night owl", desc: "Always the night sky.", patch: { time: { follow: false, phase: "night" } } },
};

const clamp = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d);
const bool = (v, d) => (typeof v === "boolean" ? v : d);
const pick = (v, list, d) => (list.includes(String(v)) ? String(v) : d);
// a clean, complete set of prefs from current + patch (unknown keys dropped, numbers clamped)
export function merge(cur, patch = {}) {
  const c = structuredClone(cur ?? DEFAULTS), p = patch ?? {};
  const o = structuredClone(DEFAULTS);
  const t = { ...c.time, ...(p.time ?? {}) }, w = { ...c.weather, ...(p.weather ?? {}) }, s = { ...c.season, ...(p.season ?? {}) };
  const sc = { ...c.scenery, ...(p.scenery ?? {}) }, col = { ...c.colors, ...(p.colors ?? {}) }, sch = { ...c.schedule, ...(p.schedule ?? {}), map: { ...(c.schedule?.map ?? {}), ...(p.schedule?.map ?? {}) } };
  o.on = bool(p.on, bool(c.on, true));
  o.time = { follow: bool(t.follow, true), phase: pick(t.phase, PHASES, "midday"), shift: clamp(t.shift, -60, 60, 0) };
  o.weather = { follow: bool(w.follow, true), choice: pick(w.choice, WEATHERS, "clear"), clouds: clamp(w.clouds, 0, 2, 1), rain: clamp(w.rain, 0, 2, 1), droplets: clamp(w.droplets, 0, 2, 1),
    snow: clamp(w.snow, 0, 2, 1), fog: clamp(w.fog, 0, 2, 1), lightning: bool(w.lightning, true), wind: clamp(w.wind, 0, 2, 1), rays: clamp(w.rays, 0, 2, 1) };
  o.season = { follow: bool(s.follow, true), choice: pick(s.choice, SEASONS, "fall"), particles: clamp(s.particles, 0, 2, 1) };
  o.scenery = { scene: pick(sc.scene, SCENES, "rotate"), grass: bool(sc.grass, true), water: bool(sc.water, true), lights: bool(sc.lights, true), stars: bool(sc.stars, true) };
  o.colors = { brightness: clamp(col.brightness, 0.6, 1.3, 1), saturation: clamp(col.saturation, 0.5, 1.5, 1), warmth: clamp(col.warmth, -1, 1, 0), dim: clamp(col.dim, 0, 0.6, 0), accentFollows: bool(col.accentFollows, true) };
  o.motion = pick(p.motion ?? c.motion, ["normal", "reduced", "still"], "normal");
  o.fps = [15, 30, 60].includes(Number(p.fps ?? c.fps)) ? Number(p.fps ?? c.fps) : 30;
  o.preset = pick(p.preset ?? c.preset, [...Object.keys(PRESETS), "custom"], "real");
  o.schedule = { on: bool(sch.on, false), map: Object.fromEntries(Object.entries(sch.map).filter(([k, v]) => CATEGORIES.includes(k) && (v === "" || v in PRESETS))) };
  return o;
}
// what "mode" the settings amount to (for the panel and for "what's the sky set to?")
export const modeOf = (s) => (s.time.follow && s.weather.follow && s.season.follow ? "real" : !s.time.follow ? "fixed" : "mix");

let cache = null;
export function get() {
  if (!cache) { try { cache = merge(DEFAULTS, existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {}); } catch { cache = structuredClone(DEFAULTS); } }
  return structuredClone(cache);
}
function save(s, why) {
  cache = s;
  mkdirSync(dirname(FILE), { recursive: true });
  writeJSONAtomic(FILE, s, 2);
  broadcast("sky", { prefs: s, mode: modeOf(s), why: why ?? null });
  return get();
}
// a change from anywhere (panel, voice, assistant); a hand-tweak turns a preset into "custom"
export function set(patch = {}, why) {
  const next = merge(get(), patch);
  if (patch.preset === undefined && Object.keys(patch).some((k) => k !== "on")) next.preset = "custom";
  return save(next, why);
}
export function applyPreset(name, why) {
  if (!(name in PRESETS)) throw new Error(`no preset called ${name}`);
  const keepSchedule = get().schedule;
  return save(merge(merge(DEFAULTS, PRESETS[name].patch), { preset: name, schedule: keepSchedule }), why ?? `preset ${name}`);
}
export function reset(group, why) {
  if (!group) return save(merge(DEFAULTS, { schedule: get().schedule }), why ?? "reset");
  if (!(group in DEFAULTS)) throw new Error(`no settings group called ${group}`);
  return set({ [group]: structuredClone(DEFAULTS[group]) }, why ?? `reset ${group}`);
}
// A one-line summary: "Following the real world · Cozy · forest scenery · gentle motion"
export function describe(s = get()) {
  if (!s.on) return "The living sky is off (a plain dark background).";
  const m = modeOf(s), parts = [];
  parts.push(m === "real" ? "following the real time, weather and season" : [
    s.time.follow ? "the real time of day" : `a ${s.time.phase} sky`,
    s.weather.follow ? "the real weather" : `${s.weather.choice === "partly" ? "partly cloudy" : s.weather.choice} weather`,
    s.season.follow ? "this season" : s.season.choice,
  ].join(", "));
  if (s.preset !== "real" && s.preset !== "custom") parts.push(`the ${PRESETS[s.preset].label} vibe`);
  parts.push(s.scenery.scene === "none" ? "no scenery" : s.scenery.scene === "rotate" ? "scenery that changes daily" : `the ${s.scenery.scene} scene`);
  if (s.motion !== "normal") parts.push(s.motion === "still" ? "still (no motion)" : "reduced motion");
  return `The sky is set to ${parts.join("; ")}.`;
}
