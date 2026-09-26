// The living sky by voice and through the assistant.
//   handle(text): the everyday phrases, no AI needed ("make it rain", "cozy mode", "use the forest scene", "less wind",
//                 "night sky", "brighter background", "back to the real world", "show me the sunrise look"…)
//   TOOLS / runTool: sky_set and sky_status, so any free-form request works ("a cozy autumn evening by a river").
// Everything goes through skyprefs (one source of truth); the screen and the Settings panel update live.
import * as sky from "./skyprefs.mjs";
import { previewLook } from "./ambient-routes.mjs";

const NUM = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
const PRESET_WORDS = { real: /\b(real world|realistic|normal|default)\b/, calm: /\bcalm\b/, cozy: /\b(cozy|cosy)\b/, vivid: /\bvivid\b/, minimal: /\bminimal(ist)?\b/, focus: /\bfocus\b/, nightowl: /\bnight ?owl\b/ };
const SCENE_WORDS = { forest: /\b(forest|woods|trees)\b/, fields: /\b(fields?|farm|crops?|meadow)\b/, river: /\b(river|stream|brook|creek)\b/, hills: /\b(hills?|hillside)\b/ };
const WEATHER_WORDS = [["storm", /\b(storm|stormy|thunder\w*|lightning)\b/], ["snow", /\b(snow|snowy|snowing)\b/], ["fog", /\b(fog|foggy|mist|misty)\b/], ["drizzle", /\b(drizzle|drizzly|sprinkl\w*)\b/], ["rain", /\b(rain|rainy|raining)\b/], ["overcast", /\b(overcast|gloomy|grey|gray)\b/], ["partly", /\b(partly cloudy|some clouds|cloudy)\b/], ["clear", /\b(clear|sunny|sunshine|blue sky)\b/]];
const PHASE_WORDS = [["sunrise", /\b(sunrise|dawn)\b/], ["sunset", /\bsunset\b/], ["golden", /\bgolden hour\b/], ["predawn", /\bpre-?dawn\b/], ["dusk", /\b(dusk|twilight)\b/], ["midday", /\b(midday|noon|daytime|day time)\b/], ["morning", /\bmorning\b/], ["afternoon", /\bafternoon\b/], ["night", /\b(night|nighttime|starry)\b/]];
const SEASON_WORDS = [["spring", /\bspring(time)?\b/], ["summer", /\bsummer\b/], ["fall", /\b(fall|autumn)\b/], ["winter", /\bwinter\b/]];
const firstOf = (list, q) => list.find(([, re]) => re.test(q))?.[0];

export function handle(text) {
  const q = String(text).toLowerCase().replace(/[.!?,]/g, " ").replace(/\s+/g, " ").trim();
  const skyish = /\b(sky|background|scenery|scene|backdrop|vibe|look|weather effects?|colors?|colours?)\b/;
  const cur = sky.get(), step = (v, d, lo, hi) => Math.max(lo, Math.min(hi, Math.round((v + d) * 100) / 100));
  const done = (reply, prefs) => { void prefs; return reply; };
  let m;

  // a quick look without changing anything: "show me the sunrise look", "preview rain", "preview the forest scene"
  if (/\bpreview\b/.test(q) || (/\b(show me|let me see|what does)\b/.test(q) && /\b(look|sky|scene|scenery)\b/.test(q))) {
    const look = { sky: firstOf(PHASE_WORDS, q), weather: firstOf(WEATHER_WORDS, q), season: firstOf(SEASON_WORDS, q), scene: Object.keys(SCENE_WORDS).find((k) => SCENE_WORDS[k].test(q)) };
    if (look.sky || look.weather || look.season || look.scene) { previewLook(look); return `Here's a preview. It'll go back to your sky in about 20 seconds.`; }
  }
  // back to the real world ("back to normal" alone belongs to the notification settings: it needs a sky word here)
  if ((/\b(back to (normal|the real (world|weather|sky|time))|real world|follow the real (world|weather|time|sky)|reset|default)\b/.test(q) && skyish.test(q)) || /\b(back to the real world|real world (mode|sky|vibe))\b/.test(q)) {
    if (/\breal weather\b/.test(q)) return done("Okay, back to the real weather.", sky.set({ weather: { follow: true } }, "voice"));
    return done("Done. Back to the real world: real time, weather and season.", sky.applyPreset("real", "voice"));
  }
  // (the screen itself suggests "back to the real weather", so the bare phrase counts too)
  if (/\b(go back to|back to|use|follow|show) the real weather\b|^(the )?real weather( again| please)?$/.test(q)) return done("Okay, back to the real weather.", sky.set({ weather: { follow: true } }, "voice"));
  // vibes: "cozy mode", "switch to calm", "make it vivid", "focus mode", "night owl"
  if ((m = Object.keys(PRESET_WORDS).find((k) => PRESET_WORDS[k].test(q))) && (/\b(mode|vibe|preset)\b/.test(q) || skyish.test(q)) && !/\b(voice|talk|speak|notifications?)\b/.test(q) && m !== "real") {
    return done(`Done. ${sky.PRESETS[m].label} it is.`, sky.applyPreset(m, "voice"));
  }
  // weather: "make it rain", "make it snow", "turn off the rain", "no more lightning"
  if ((m = /\bmake it (rain|snow|storm|stormy|foggy|sunny|cloudy|clear)\b/.exec(q)) || (skyish.test(q) && (m = /\b(add|bring|give me)( some| a)? (rain|snow|fog|storm|clouds|thunderstorm)\b/.exec(q)))) {
    const w = firstOf(WEATHER_WORDS, m[0]) ?? "rain";
    return done(`Done. It's ${w === "clear" ? "sunny" : w === "partly" ? "a little cloudy" : w === "storm" ? "stormy" : w === "fog" ? "foggy" : w === "snow" ? "snowing" : w === "drizzle" ? "drizzling" : w === "overcast" ? "overcast" : "raining"} on the screen now. Say "back to the real weather" any time.`, sky.set({ weather: { follow: false, choice: w, ...(w === "rain" || w === "drizzle" || w === "storm" ? { rain: Math.max(cur.weather.rain, 0.6) } : {}), ...(w === "snow" ? { snow: Math.max(cur.weather.snow, 0.6) } : {}) } }, "voice"));
  }
  if ((m = /\b(turn off|stop|no more|get rid of|remove|hide) (the )?(rain|raindrops|drops on the glass|droplets|snow|fog|lightning|clouds|sun ?rays|glimmer|leaves|petals|particles|stars|moon|grass|fireflies|lights|water shimmer)\b/.exec(q)) && (!/^(lights|grass|moon|stars|clouds|particles)$/.test(m[3]) || skyish.test(q))) {
    const what = m[3], P = {
      rain: { weather: { rain: 0 } }, raindrops: { weather: { droplets: 0 } }, "drops on the glass": { weather: { droplets: 0 } }, droplets: { weather: { droplets: 0 } },
      snow: { weather: { snow: 0 } }, fog: { weather: { fog: 0 } }, lightning: { weather: { lightning: false } }, clouds: { weather: { clouds: 0 } },
      leaves: { season: { particles: 0 } }, petals: { season: { particles: 0 } }, particles: { season: { particles: 0 } }, stars: { scenery: { stars: false } }, moon: { scenery: { stars: false } },
      grass: { scenery: { grass: false } }, fireflies: { scenery: { lights: false } }, lights: { scenery: { lights: false } }, "water shimmer": { scenery: { water: false } },
    }[what] ?? (/sun ?rays|glimmer/.test(what) ? { weather: { rays: 0 } } : null);
    if (P) return done(`Done. ${what.charAt(0).toUpperCase() + what.slice(1)} off.`, sky.set(P, "voice"));
  }
  if ((m = /\b(turn on|bring back|show) (the )?(rain|raindrops|droplets|snow|fog|lightning|clouds|sun ?rays|glimmer|leaves|petals|stars|moon|grass|fireflies|lights|water shimmer)\b/.exec(q)) && !/\bweather\b/.test(q) && (!/^(lights|grass|moon|stars|clouds|rain|snow|fog)$/.test(m[3]) || skyish.test(q))) {
    const what = m[3], P = { rain: { weather: { rain: 1 } }, raindrops: { weather: { droplets: 1 } }, droplets: { weather: { droplets: 1 } }, snow: { weather: { snow: 1 } }, fog: { weather: { fog: 1 } },
      lightning: { weather: { lightning: true } }, clouds: { weather: { clouds: 1 } }, leaves: { season: { particles: 1 } }, petals: { season: { particles: 1 } }, stars: { scenery: { stars: true } }, moon: { scenery: { stars: true } },
      grass: { scenery: { grass: true } }, fireflies: { scenery: { lights: true } }, lights: { scenery: { lights: true } }, "water shimmer": { scenery: { water: true } } }[what] ?? (/sun ?rays|glimmer/.test(what) ? { weather: { rays: 1 } } : null);
    if (P) return done(`Done. ${what.charAt(0).toUpperCase() + what.slice(1)} on.`, sky.set(P, "voice"));
  }
  // amounts: "less wind", "more leaves", "fewer particles", "more clouds", "calmer wind"
  if ((m = /\b(more|less|fewer|stronger|weaker|calmer) (wind|breeze|leaves|petals|particles|clouds|rain|snow|fog|sun ?rays)\b/.exec(q)) && (/^(leaves|petals|particles|sun ?rays)$/.test(m[2]) || skyish.test(q) || /^(less|more|stronger|weaker|calmer) (wind|breeze)$/.test(q))) {
    const d = /more|stronger/.test(m[1]) ? 0.4 : -0.4, w = m[2];
    const path = /wind|breeze/.test(w) ? ["weather", "wind"] : /leaves|petals|particles/.test(w) ? ["season", "particles"] : /sun ?rays/.test(w) ? ["weather", "rays"] : ["weather", w];
    const v = step(cur[path[0]][path[1]], d, 0, 2);
    return done(`Done. ${d > 0 ? "More" : "Less"} ${w} (${Math.round(v * 100)}%).`, sky.set({ [path[0]]: { [path[1]]: v } }, "voice"));
  }
  // scenery: "use the forest scene", "show me the river", "turn off the scenery", "rotate the scenery"
  if (/\b(turn off|hide|no|remove) (the )?scenery\b/.test(q)) return done("Done. No scenery, just the sky.", sky.set({ scenery: { scene: "none" } }, "voice"));
  if (/\b(turn on|bring back|rotate|change daily|mix up) (the )?scenery\b/.test(q)) return done("Done. The scenery will change each day.", sky.set({ scenery: { scene: "rotate" } }, "voice"));
  if ((m = Object.keys(SCENE_WORDS).find((k) => SCENE_WORDS[k].test(q))) && /\b(scene|scenery|background|backdrop|view)\b/.test(q) && !/\b(schedule|calendar|video|music|photo)\b/.test(q)) {
    return done(`Done. The ${m} scene is up.`, sky.set({ scenery: { scene: m } }, "voice"));
  }
  // time of day: "night sky", "make it sunset", "follow the sun"
  if (/\b(follow the sun|real time of day|real sky)\b/.test(q)) return done("Okay, the sky follows the sun again.", sky.set({ time: { follow: true } }, "voice"));
  if ((m = firstOf(PHASE_WORDS, q)) && (/\b(sky|make it|always|keep it|lock)\b/.test(q)) && !/\b(schedule|calendar|remind|alarm|weather like|forecast)\b/.test(q)) {
    return done(`Done. A ${m === "golden" ? "golden-hour" : m === "predawn" ? "pre-dawn" : m} sky it is. Say "follow the sun" to go back.`, sky.set({ time: { follow: false, phase: m } }, "voice"));
  }
  // seasons: "make it winter", "fall scenery"
  if ((m = firstOf(SEASON_WORDS, q)) && /\b(make it|scenery|season|sky|vibe|look)\b/.test(q) && !/\b(schedule|calendar)\b/.test(q)) {
    return done(`Done. It looks like ${m} now.`, sky.set({ season: { follow: false, choice: m } }, "voice"));
  }
  // colors: "brighter background", "dimmer background", "warmer colors", "cooler colors"
  if ((m = /\b(brighter|dimmer|darker|warmer|cooler|more colorful|less colorful|more saturated|less saturated)\b/.exec(q)) && skyish.test(q)) {
    const w = m[1], c = cur.colors;
    const patch = /brighter/.test(w) ? { brightness: step(c.brightness, 0.15, 0.6, 1.3) } : /dimmer|darker/.test(w) ? { brightness: step(c.brightness, -0.15, 0.6, 1.3) }
      : /warmer/.test(w) ? { warmth: step(c.warmth, 0.3, -1, 1) } : /cooler/.test(w) ? { warmth: step(c.warmth, -0.3, -1, 1) }
      : /more/.test(w) ? { saturation: step(c.saturation, 0.2, 0.5, 1.5) } : { saturation: step(c.saturation, -0.2, 0.5, 1.5) };
    return done(`Done. ${w.charAt(0).toUpperCase() + w.slice(1)}.`, sky.set({ colors: patch }, "voice"));
  }
  // motion
  if (/\b(stop|freeze|pause) the (sky|background|animation)\b|\bstill (sky|background)\b/.test(q)) return done("Done. The sky is still now.", sky.set({ motion: "still" }, "voice"));
  if (/\b(animate|start|unfreeze|move) the (sky|background)( again)?\b/.test(q)) return done("Done. The sky is moving again.", sky.set({ motion: "normal" }, "voice"));
  // the whole thing
  if (/\b(turn off|disable) the (living )?sky\b/.test(q)) return done("Done. The living sky is off.", sky.set({ on: false }, "voice"));
  if (/\b(turn on|enable) the (living )?sky\b/.test(q)) return done("Done. The living sky is on.", sky.set({ on: true }, "voice"));
  if (/\bwhat('s| is) the (sky|background|scenery) (set to|doing)\b/.test(q)) return sky.describe();
  return null;
}

// ---- for the assistant --------------------------------------------------------------------------------------------
const AMT = { type: "number", description: "0 (off) to 2 (double); 1 is normal" };
export const TOOLS = [
  {
    name: "sky_set",
    description: "Change the living sky and scenery behind the Dayspring screen: time of day, weather, season, scenery, colors, motion and vibe presets. " +
      "Send only what should change. To follow the real world again, send follow_time / follow_weather / follow_season true (or preset \"real\"). " +
      "Examples: 'a cozy autumn evening by a river' → preset cozy, phase golden or dusk, season fall, scene river; 'sunny spring meadow but calm' → preset calm, weather clear, season spring, scene fields; " +
      "'warmer colors and more leaves' → warmth +, particles +. Reply briefly in the past tense after it's applied.",
    input_schema: {
      type: "object",
      properties: {
        preset: { type: "string", enum: Object.keys(sky.PRESETS), description: "A vibe to start from (applied first; other fields then adjust it)" },
        reset: { type: "boolean", description: "Everything back to the defaults (the real world)" },
        on: { type: "boolean", description: "The living sky on or off" },
        follow_time: { type: "boolean" }, phase: { type: "string", enum: sky.PHASES, description: "Lock the sky to this time of day (implies follow_time false)" },
        sunrise_shift_minutes: { type: "number", description: "-60 … 60" },
        follow_weather: { type: "boolean" }, weather: { type: "string", enum: sky.WEATHERS, description: "Show this weather (implies follow_weather false)" },
        clouds: AMT, rain: AMT, droplets: { ...AMT, description: "Raindrops on the glass, 0–2" }, snow: AMT, fog: AMT, wind: { ...AMT, description: "Wind strength multiplier 0–2" }, sun_rays: AMT,
        lightning: { type: "boolean" },
        follow_season: { type: "boolean" }, season: { type: "string", enum: sky.SEASONS, description: "Show this season (implies follow_season false)" },
        particles: { ...AMT, description: "Seasonal leaves/petals/seeds, 0–2" },
        scene: { type: "string", enum: sky.SCENES, description: "rotate = a different scene each day; none = sky only" },
        grass: { type: "boolean" }, water_shimmer: { type: "boolean" }, night_lights: { type: "boolean", description: "Distant lights and fireflies at night" }, stars: { type: "boolean", description: "Stars and moon" },
        brightness: { type: "number", description: "0.6–1.3" }, saturation: { type: "number", description: "0.5–1.5" }, warmth: { type: "number", description: "-1 (cool) … 1 (warm)" }, dim: { type: "number", description: "Darkening behind the cards, 0–0.6" },
        accent_follows_sky: { type: "boolean" }, motion: { type: "string", enum: ["normal", "reduced", "still"] }, fps: { type: "integer", enum: [15, 30, 60] },
      },
    },
  },
  { name: "sky_status", description: "What the living sky is set to right now.", input_schema: { type: "object", properties: {} } },
];
export async function runTool(name, input = {}) {
  if (name === "sky_status") return { summary: sky.describe(), prefs: sky.get() };
  if (name !== "sky_set") return undefined;
  if (input.reset) sky.applyPreset("real", "assistant");
  if (input.preset) sky.applyPreset(input.preset, "assistant");
  const i = input, patch = {}, put = (g, k, v) => { if (v !== undefined) (patch[g] ??= {})[k] = v; };
  if (i.on !== undefined) patch.on = Boolean(i.on);
  put("time", "follow", i.follow_time ?? (i.phase ? false : undefined)); put("time", "phase", i.phase); put("time", "shift", NUM(i.sunrise_shift_minutes));
  put("weather", "follow", i.follow_weather ?? (i.weather ? false : undefined)); put("weather", "choice", i.weather);
  for (const [k, f] of [["clouds", "clouds"], ["rain", "rain"], ["droplets", "droplets"], ["snow", "snow"], ["fog", "fog"], ["wind", "wind"], ["sun_rays", "rays"]]) put("weather", f, NUM(i[k]));
  put("weather", "lightning", i.lightning);
  put("season", "follow", i.follow_season ?? (i.season ? false : undefined)); put("season", "choice", i.season); put("season", "particles", NUM(i.particles));
  put("scenery", "scene", i.scene); put("scenery", "grass", i.grass); put("scenery", "water", i.water_shimmer); put("scenery", "lights", i.night_lights); put("scenery", "stars", i.stars);
  put("colors", "brightness", NUM(i.brightness)); put("colors", "saturation", NUM(i.saturation)); put("colors", "warmth", NUM(i.warmth)); put("colors", "dim", NUM(i.dim)); put("colors", "accentFollows", i.accent_follows_sky);
  if (i.motion) patch.motion = i.motion; if (i.fps) patch.fps = i.fps;
  // made weather visible when it's chosen but its amount is off
  if (i.weather && ["rain", "drizzle", "storm"].includes(i.weather) && sky.get().weather.rain === 0 && i.rain === undefined) put("weather", "rain", 0.8);
  if (i.weather === "snow" && sky.get().weather.snow === 0 && i.snow === undefined) put("weather", "snow", 0.8);
  const keepPreset = input.preset && Object.keys(patch).length === 0;
  const prefs = Object.keys(patch).length ? sky.set(input.preset ? { ...patch, preset: "custom" } : patch, "assistant") : sky.get();
  void keepPreset;
  return { applied: true, summary: sky.describe(prefs) };
}
