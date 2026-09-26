// The living sky's data, settings and previews.
//   GET  /api/ambient                  → sun, weather, season, moon (see ambient.mjs)
//   GET  /api/sky                      → the sky settings + presets + choices (see skyprefs.mjs)
//   POST /api/sky {patch} | {preset} | {reset: true | "<group>"}   → saved, broadcast ("sky"), applied live
//   POST /api/ambient/preview {sky, weather, season, scene, seconds}  → the Dayspring screen shows that look for a while
import * as ambient from "./ambient.mjs";
import * as sky from "./skyprefs.mjs";
import { broadcast } from "./announcer.mjs";

export function previewLook(b = {}) {
  const pick = (v, list) => (list.includes(String(v)) ? String(v) : null);
  const look = { sky: pick(b.sky, sky.PHASES), weather: pick(b.weather, sky.WEATHERS), season: pick(b.season, sky.SEASONS), scene: pick(b.scene, sky.SCENES), seconds: Math.max(5, Math.min(120, Number(b.seconds) || 20)) };
  if (!look.sky && !look.weather && !look.season && !look.scene) return null;
  broadcast("ambient-preview", look);
  return look;
}

export async function handle(req, res, { m, p, send, readJSON }) {
  if (p === "/ambient" && m === "GET") { ambient.keepFresh(); return send(res, 200, await ambient.now()), true; }
  if (p === "/sky" && m === "GET") return send(res, 200, { prefs: sky.get(), mode: sky.modeOf(sky.get()), summary: sky.describe(), presets: sky.PRESETS, defaults: sky.DEFAULTS, choices: { phases: sky.PHASES, weathers: sky.WEATHERS, seasons: sky.SEASONS, scenes: sky.SCENES, categories: sky.CATEGORIES } }), true;
  if (p === "/sky" && m === "POST") {
    const b = await readJSON(req).catch(() => ({}));
    try {
      const prefs = b.reset ? sky.reset(b.reset === true ? null : String(b.reset), "settings") : b.preset ? sky.applyPreset(String(b.preset), "settings") : sky.set(b.patch ?? {}, "settings");
      return send(res, 200, { prefs, mode: sky.modeOf(prefs), summary: sky.describe(prefs) }), true;
    } catch (e) { return send(res, 400, { error: e.message }), true; }
  }
  if (p === "/ambient/preview" && m === "POST") {
    const look = previewLook(await readJSON(req).catch(() => ({})));
    return look ? (send(res, 200, { ok: true, ...look }), true) : (send(res, 400, { error: "pick a sky, a weather, a season or a scene" }), true);
  }
  return false;
}
