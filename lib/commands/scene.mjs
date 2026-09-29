// The sky, the background and the screen itself by voice, no AI needed (the living sky's own words are in
// lib/skyskills.mjs; this adds the many other ways people say it, temporary changes, and the window).
//   weather     "make it rain", "let it snow", "thunderstorm", "clear skies", "foggy", "sunny", "make it rain for 10 minutes"
//   time of day "make it night / sunset / sunrise / noon", "show the real sky again", "follow the sun"
//   scenery     "change the scenery to mountains" (the closest there is: hills, fields, forest, river), "no scenery"
//   the sky     "turn on the stars", "no more clouds", "pause the animation", "make it winter", "cozy vibe", "plain background"
//   the window  "compact mode", "full screen", "move to the other screen", "minimize", "show yourself"
//   parse(q) → { intent, args } | null     plan(p) → { patch | preset | window, reply, minutes }
import * as sky from "../skyprefs.mjs";

const WEATHER = [["storm", /\b(thunder ?storms?|thunder|lightning( storm)?|storm|stormy)\b/], ["snow", /\b(snow(ing|y|fall)?|blizzard|flurr(y|ies)|let it snow)\b/], ["fog", /\b(fog|foggy|mist|misty|haze|hazy)\b/],
  ["drizzle", /\b(drizzle|drizzly|drizzling|sprinkl\w*|light rain)\b/], ["rain", /\b(rain|rainy|raining|showers|downpour|pouring)\b/], ["overcast", /\b(overcast|gloomy|grey|gray|cloudy)\b/],
  ["partly", /\b(partly cloudy|some clouds|a few clouds)\b/], ["clear", /\b(clear( skies| sky)?|sunny|sunshine|blue skies?|nice weather|nice day|sun is out)\b/]];
const PHASE = [["night", /\b(night( ?time)?|midnight|nighttime|starry|dark sky)\b/], ["predawn", /\bpre ?dawn\b/], ["sunrise", /\b(sunrise|dawn|daybreak|sun ?up)\b/], ["morning", /\bmorning\b/],
  ["midday", /\b(noon|midday|mid day|daytime|day ?time|middle of the day|full daylight)\b/], ["afternoon", /\bafternoon\b/], ["golden", /\bgolden hour\b/],
  ["sunset", /\b(sunset|sundown|sun ?down)\b/], ["dusk", /\b(dusk|twilight|evening)\b/]];
const SEASON = [["winter", /\b(winter|wintery|wintry|christmas|snowy season)\b/], ["spring", /\bspring( ?time)?\b/], ["summer", /\bsummer( ?time)?\b/], ["fall", /\b(fall|autumn)\b/]];
// what the scenery can be, and the closest one for everything else people ask for
const SCENE = [["hills", /\b(hills?|hillside|mountains?|peaks?|valley|rolling hills|alps|cliffs?)\b/], ["fields", /\b(fields?|meadows?|farm(land)?|countryside|prairie|plains?|crops?|desert|grassland|pasture)\b/],
  ["forest", /\b(forest|woods|woodland|trees|jungle|pines?|rain ?forest)\b/], ["river", /\b(river|stream|brook|creek|lake|beach|ocean|sea|seaside|coast|water(front)?|pond|waterfall)\b/]];
const EXACT_SCENE = /\b(hills?|fields?|forest|river)\b/;
const PRESETS = [["cozy", /\b(cozy|cosy|snug)\b/], ["calm", /\b(calm|peaceful|relaxing|chill)\b/], ["vivid", /\b(vivid|colou?rful|vibrant|bright and colou?rful)\b/], ["minimal", /\b(minimal(ist)?|simple|plain)\b/],
  ["focus", /\b(focus|study|concentrat\w*)\b/], ["nightowl", /\bnight ?owl\b/]];
const ELEMENTS = [["stars", { scenery: "stars" }, /\b(stars|the moon|moon|starlight)\b/], ["clouds", { weather: "clouds" }, /\bclouds\b/], ["lightning", { weather: "lightning" }, /\blightning\b/],
  ["raindrops", { weather: "droplets" }, /\b(raindrops|rain drops|drops on the (glass|screen)|droplets)\b/], ["leaves", { season: "particles" }, /\b(leaves|petals|falling leaves|particles|seeds)\b/],
  ["grass", { scenery: "grass" }, /\bgrass\b/], ["fireflies", { scenery: "lights" }, /\b(fireflies|night lights|distant lights|city lights|lights in the distance)\b/],
  ["water shimmer", { scenery: "water" }, /\b(water shimmer|shimmer|sparkle on the water)\b/], ["sun rays", { weather: "rays" }, /\b(sun ?rays|sunbeams|light rays|god rays|glimmer)\b/],
  ["wind", { weather: "wind" }, /\b(wind|breeze)\b/], ["fog", { weather: "fog" }, /\b(fog|mist)\b(?= (in|on) the (sky|background|screen))/]];
const firstOf = (list, q) => list.find(([, re]) => re.test(q))?.[0] ?? null;
const SKYISH = /\b(sky|skies|background|backdrop|scenery|scene|view|screen|outside|window|weather (on|in) the (screen|background|sky)|living sky|animation|vibe|look)\b/;
const QUESTION = /^(is|will|was|are|does|do|did|what|whats|how|when|should|would|could it|can it|any|tell me|check)\b|\b(forecast|outside right now|going to (rain|snow)|chance of)\b/;
const MAKE = /^(make it|let it|let s|have it|can you make it|make the (sky|background|screen|scene|weather)|turn (it|the sky|the background) (to|into)|change (it|the sky|the background|the weather|the scene|the time of day|the time) to|set (it|the sky|the background|the weather|the time of day) to|switch (it |the sky |the background )?to|show( me)?( a| an| some| the)?|give me( a| an| some)?|i want( a| an| some)?|put( on)?( a| an| some)?|bring( on| me)?( a| an| some)?|go to|how about( a| an| some)?)\b/;
const DURATION = /\b(?:for|during) (?:the next |another )?(\d+(?:\.\d+)?|an?|half an?|a couple of|a few)\s*(minutes?|hours?|seconds?)\b|\bfor (?:a (?:bit|while|little while))\b|\b(for (the rest of )?(today|the day|tonight))\b/;

export function durationIn(q) {
  const m = DURATION.exec(q);
  if (!m) return null;
  if (/\b(a bit|a little while)\b/.test(m[0])) return 15;
  if (/\bwhile\b/.test(m[0])) return 30;
  if (/\b(today|the day|tonight)\b/.test(m[0])) { const d = new Date(); const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59); return Math.max(1, Math.round((end - d) / 60000)); }
  const n = /^\d/.test(m[1]) ? Number(m[1]) : /half/.test(m[1]) ? 0.5 : /couple/.test(m[1]) ? 2 : /few/.test(m[1]) ? 3 : 1;
  if (/second/.test(m[2])) return Math.max(5, n) / 60;            // (seconds: a fraction of a minute, 5 seconds at least)
  return Math.max(1, Math.round(/hour/.test(m[2]) ? n * 60 : n));
}

export function parse(q) {
  q = String(q ?? "").trim();
  if (!q) return null;
  const minutes = durationIn(q);
  const base = q.replace(DURATION, " ").replace(/\s+/g, " ").trim();
  const question = QUESTION.test(base) && !/^(what if|how about)\b/.test(base);
  let m;
  // ---- the window: compact, full screen, the other screen ----
  if (/^(go |switch |change |turn )?(in ?to |to )?(compact|mini)( mode| view| window| size)?$|^(make (yourself|the window|the screen|it|dayspring) )(small|smaller|tiny|compact|mini)$|^(shrink|minimi[sz]e) (down )?to (mini|compact)( mode)?$/.test(base) && !/\blayout\b/.test(base)) return { intent: "ui.window", args: { canon: "compact mode" } };
  if (/^(go |switch |change |turn )?(in ?to |to )?full ?screen( mode)?$|^make (it|yourself|the (screen|window)|dayspring) full ?screen$|^(full ?screen|fill the (whole )?screen)( please)?$/.test(base)) return { intent: "ui.window", args: { canon: "full screen" } };
  if (/^(exit|leave|close|get out of|turn off) (the )?full ?screen( mode)?$/.test(base)) return { intent: "ui.window", args: { canon: "exit full screen", client: true } };
  if (/^(go |switch )?(back )?(to )?(the )?(big|full|large|normal) (size|window|view|screen|app)( window)?$|^(expand|make (it|yourself) (big|bigger|large))$/.test(base)) return { intent: "ui.window", args: { canon: "expand" } };
  if ((m = /^(?:move|go|switch|put|send|take|jump|throw) (?:(?:yourself|dayspring|the (?:screen|window|app|display)|it|you) )?(?:back )?(?:over )?(?:to|onto|on) (?:the |my |this )?(other|second|2nd|main|primary|first|laptop|tv|television|big|external|next)(?: (?:screen|monitor|display|tv))?$/.exec(base))) {
    const w = /other|second|2nd|tv|television|big|external|next/.test(m[1]) ? "other" : "main";
    return { intent: "ui.window", args: { canon: w === "other" ? "move dayspring to the other screen" : "move dayspring to the main screen" } };
  }
  if (/^(minimi[sz]e|hide)( yourself| dayspring| the (screen|window|app))?$/.test(base)) return { intent: "ui.window", args: { canon: base.startsWith("hide") ? "hide" : "minimize" } };
  if (/^(show|bring back|unhide|come back|open) (yourself|dayspring|the (screen|window|display))( again)?$|^come back$/.test(base)) return { intent: "ui.window", args: { canon: "show yourself" } };
  if (/^maximi[sz]e( yourself| dayspring| the (screen|window))?$/.test(base)) return { intent: "ui.window", args: { canon: "maximize" } };
  if (question && !/\b(set to|doing)\b/.test(base)) return null;
  // ---- status ----
  if (/\b(what|whats|how) (is )?(the )?(sky|background|scenery|scene)( is)? (set to|doing|showing|like)\b/.test(base)) return { intent: "sky.status", args: {} };
  // ---- the whole living sky ----
  if (/\b(turn off|disable|hide|no|remove|stop) (the )?(living sky|animated background|moving background|sky animation|background animation)\b|\bplain (dark )?background\b|\bjust a plain background\b/.test(base)) return { intent: "sky.on", args: { on: false } };
  if (/\b(turn on|enable|bring back|show) (the )?(living sky|animated background|moving background|sky animation|background animation)\b/.test(base)) return { intent: "sky.on", args: { on: true } };
  // ---- back to the real world ----
  if (/\b(real|actual|live|current) (sky|world|weather|time( of day)?|season)\b|\bfollow the (sun|real \w+|weather|time|season)\b|\bback to (the )?(normal|real|regular|default) (sky|background|scenery|look)\b|\breset the (sky|background|scenery)\b|\bnormal sky\b/.test(base) && !/\bweather (in|for) \w+/.test(base)) {
    const what = /\bweather\b/.test(base) ? "weather" : /\btime( of day)?\b|\bsun\b/.test(base) ? "time" : /\bseason\b/.test(base) ? "season" : "all";
    return { intent: "sky.real", args: { what } };
  }
  // ---- motion ----
  if (/\b(pause|freeze|stop|still|hold)( the)? (animations?|sky|background|scenery|motion|clouds moving)\b|\b(animations?|sky|background) (still|frozen|paused)\b|\bstop (the )?(sky|background) (from )?moving\b|\bstill (sky|background)\b/.test(base)) return { intent: "sky.motion", args: { motion: "still" } };
  if (/\b(resume|unpause|unfreeze|restart|start)( the)? (animations?|sky|background|motion)( again)?\b|\b(animate|move) the (sky|background)( again)?\b|\blet the (sky|background) move\b/.test(base)) return { intent: "sky.motion", args: { motion: "normal" } };
  if (/\b(slow|calm) (down (the )?|the )(sky|background)( animation| motion)?\b|\b(slower|gentler|calmer) (sky|background)\b|\b(slower|gentler|calmer) (animations?|motion) (in|on|of) the (sky|background)\b|\breduced? (sky |background )?motion (in|on) the (sky|background)\b/.test(base)) return { intent: "sky.motion", args: { motion: "reduced" } };
  // ---- a vibe ----
  if ((m = firstOf(PRESETS, base)) && /\b(mode|vibe|preset|look|sky|background|scene|feel|atmosphere)\b/.test(base) && !/\b(voice|talk|speak|notifications?|layout|spacing|motion|theme)\b/.test(base) && !(m === "focus" && /\b(session|timer|pomodoro|start)\b/.test(base)) && !(m === "minimal" && /\blayout\b/.test(base))) return { intent: "sky.preset", args: { preset: m } };
  // ---- elements on and off ----
  const el = ELEMENTS.find(([, , re]) => re.test(base));
  if (el && /\b(turn on|turn off|switch on|switch off|show|hide|no more|get rid of|remove|bring back|add|stop|start|enable|disable|more|less|fewer|without|with)\b/.test(base) && !/\b(turn|switch) (on|off) the lights\b|\blights (on|off)\b/.test(base)) {
    const off = /\b(turn off|switch off|hide|no more|get rid of|remove|stop|disable|without|no)\b/.test(base), more = /\bmore\b/.test(base) && !/\bno more\b/.test(base), less = /\b(less|fewer)\b/.test(base);
    if (more || less) return { intent: "sky.amount", args: { element: el[0], dir: more ? 1 : -1, minutes } };
    return { intent: "sky.element", args: { element: el[0], on: !off, minutes } };
  }
  // ---- scenery ----
  if ((m = firstOf(SCENE, base)) && (/\b(scene|scenery|background|backdrop|view|landscape|setting)\b/.test(base) || MAKE.test(base) || /^(the )?\w+( scene| view)?$/.test(base)) && !/\b(schedule|calendar|video|music|photo|picture|play|trip|vacation|go to the|drive|walk|hike|remind|timer|alarm)\b/.test(base)) {
    const said = (base.match(/\b(mountains?|peaks?|valley|beach|ocean|sea|seaside|coast|lake|pond|waterfall|desert|jungle|countryside|meadows?|prairie|woods|woodland|trees|farm|creek|stream|brook|cliffs?|alps)\b/) ?? [])[0] ?? null;
    return { intent: "sky.scene", args: { scene: m, asked: EXACT_SCENE.test(base) ? null : said } };
  }
  if (/\b(no|turn off|hide|remove|without|get rid of the) (the )?scenery\b|\bjust the sky\b/.test(base)) return { intent: "sky.scene", args: { scene: "none" } };
  if (/\b(rotate|change|mix up|surprise me with|different) (the )?scenery( (each|every) day| daily)?\b|\bscenery (that )?changes\b/.test(base)) return { intent: "sky.scene", args: { scene: "rotate" } };
  // ---- the weather on the screen ----
  const w = firstOf(WEATHER, base);
  // a few words that are just the weather: "thunderstorm", "light rain", "lightning storm", "sunny please"
  const wordOnly = /^(a |an |some )?(thunder ?storm|thunderstorms|storm|stormy|snow|snowy|snowing|rain|rainy|raining|foggy|misty|fog|sunny|sunshine|clear skies|clear sky|blue skies?|cloudy|overcast|drizzle|drizzly|partly cloudy)( please| now| again)?( (sky|skies|weather|day|background))?$/.test(base)
    || (base.split(" ").length <= 3 && !/^(no|not|stop|any|is|will|what|how|does|did)\b/.test(base) && /^(a |an |some )?(light|heavy|gentle|big|lightning|soft|pouring|steady) (rain|snow|storm|fog|drizzle|thunderstorm)$/.test(base));
  if (w && (wordOnly || MAKE.test(base) || /^add (some |a |an )?\w+( to the (sky|background|screen))?$/.test(base) || /^(stop|no more|turn off|end|get rid of|remove|enough)( with)?( the)? (rain|snow|fog|storm|thunder|thunderstorm|clouds|drizzle|lightning)( on the screen| in the sky)?$/.test(base) || /\b(sky|background|screen|scene|backdrop)\b/.test(base) || /\b(weather)\b.*\b(to|into)\b/.test(base)) && !/\b(forecast|umbrella|jacket|tomorrow|tonight|this week|outside)\b/.test(base) && !/\b(timer|alarm|remind|schedule|song|music|play|sounds of|playlist|video)\b/.test(base)) {
    if (/\b(stop|turn off|no more|end|get rid of|remove)\b/.test(base) && !MAKE.test(base)) return { intent: "sky.weatherOff", args: { weather: w, minutes } };
    return { intent: "sky.weather", args: { weather: w, minutes } };
  }
  // ---- time of day ----
  const ph = firstOf(PHASE, base);
  if (ph && (MAKE.test(base) || /\b(sky|background|scenery|screen)\b/.test(base) || /^(a |the )?(night|sunset|sunrise|sundown|dawn|daybreak|dusk|twilight|golden hour|noon|midday|daytime|evening|afternoon)( sky| time| please| now)?$/.test(base)) && !/\b(mode|alarm|timer|remind|schedule|calendar|at \d|tomorrow|good (morning|night|evening|afternoon)|routine|rundown|briefing|what|weather like)\b/.test(base)) {
    return { intent: "sky.phase", args: { phase: ph, minutes } };
  }
  // ---- the season ----
  const se = firstOf(SEASON, base);
  if (se && (MAKE.test(base) || /\b(scenery|season|sky|background|look|vibe|leaves)\b/.test(base)) && !/\b(schedule|calendar|clothes|remind|alarm|music|song|play)\b/.test(base) && !(se === "spring" && /\bdayspring\b/.test(base))) return { intent: "sky.season", args: { season: se, minutes } };
  // ---- colours of the sky ----
  if ((m = /\b(brighter|dimmer|darker|warmer|cooler|more colou?rful|less colou?rful|more saturated|less saturated|softer)\b/.exec(base)) && /\b(sky|background|backdrop|scenery|scene)\b/.test(base)) return { intent: "sky.colors", args: { how: m[1] } };
  return null;
}

// ---- what a parse does ----
const WORD = { storm: "stormy", snow: "snowing", fog: "foggy", drizzle: "drizzling", rain: "raining", overcast: "overcast", partly: "partly cloudy", clear: "clear and sunny" };
const PHASE_SAY = { night: "night", predawn: "just before dawn", sunrise: "sunrise", morning: "morning", midday: "midday", afternoon: "afternoon", golden: "golden hour", sunset: "sunset", dusk: "dusk" };
const forHow = (min) => (min ? ` for ${min < 1 ? `${Math.round(min * 60)} seconds` : min >= 60 && min % 60 === 0 ? `${min / 60} hour${min === 60 ? "" : "s"}` : `${min} minute${min === 1 ? "" : "s"}`}, then it goes back` : "");
const step = (v, d, lo, hi) => Math.max(lo, Math.min(hi, Math.round((v + d) * 100) / 100));
// → { patch?, preset?, window?, reply, minutes? }
export function plan(p) {
  const a = p.args, cur = sky.get();
  switch (p.intent) {
    case "ui.window": return { window: a.canon, client: a.client ?? false };
    case "sky.status": return { reply: sky.describe() };
    case "sky.on": return { patch: { on: a.on }, reply: a.on ? "The living sky is back on." : "Okay, a plain background now. Say “turn on the living sky” to bring it back." };
    case "sky.real": {
      if (a.what === "weather") return { patch: { weather: { follow: true } }, reply: "Okay, back to the real weather." };
      if (a.what === "time") return { patch: { time: { follow: true } }, reply: "Okay, the sky follows the sun again." };
      if (a.what === "season") return { patch: { season: { follow: true } }, reply: "Okay, back to the real season." };
      return { preset: "real", reply: "Done. The real sky again: the real time, weather and season." };
    }
    case "sky.motion": return { patch: { motion: a.motion }, reply: a.motion === "still" ? "Done. The sky is paused. Say “resume the animation” to start it again." : a.motion === "reduced" ? "Done. The sky moves more gently now." : "Done. The sky is moving again." };
    case "sky.preset": return { preset: a.preset, reply: `Done. ${sky.PRESETS[a.preset].label} it is: ${sky.PRESETS[a.preset].desc.replace(/\.$/, "").toLowerCase()}.` };
    case "sky.element": {
      const [name, where] = ELEMENTS.find((e) => e[0] === a.element) ?? [];
      const [g, k] = Object.entries(where)[0];
      const val = typeof cur[g][k] === "boolean" ? a.on : (a.on ? Math.max(1, cur[g][k] || 0) : 0);
      return { patch: { [g]: { [k]: val } }, reply: `Done. ${name.charAt(0).toUpperCase() + name.slice(1)} ${a.on ? "on" : "off"}${forHow(a.minutes)}.`, minutes: a.minutes };
    }
    case "sky.amount": {
      const [name, where] = ELEMENTS.find((e) => e[0] === a.element) ?? [];
      const [g, k] = Object.entries(where)[0];
      if (typeof cur[g][k] === "boolean") return { patch: { [g]: { [k]: a.dir > 0 } }, reply: `Done. ${name} ${a.dir > 0 ? "on" : "off"}.` };
      const v = step(cur[g][k], a.dir * 0.4, 0, 2);
      return { patch: { [g]: { [k]: v } }, reply: `Done. ${a.dir > 0 ? "More" : "Less"} ${name} (${Math.round(v * 100)}%).`, minutes: a.minutes };
    }
    case "sky.scene": {
      if (a.scene === "none") return { patch: { scenery: { scene: "none" } }, reply: "Done. No scenery, just the sky." };
      if (a.scene === "rotate") return { patch: { scenery: { scene: "rotate" } }, reply: "Done. The scenery will change each day." };
      const note = a.asked ? `I don't have ${a.asked.replace(/s$/, "")} scenery yet, so I picked the closest: the ${a.scene}. The scenes I have are hills, fields, forest and river.` : `Done. The ${a.scene} scene is up.`;
      return { patch: { scenery: { scene: a.scene } }, reply: note };
    }
    case "sky.weather": {
      const w = a.weather, patch = { weather: { follow: false, choice: w } };
      if (["rain", "drizzle", "storm"].includes(w)) patch.weather.rain = Math.max(cur.weather.rain, 0.8);
      if (w === "storm") patch.weather.lightning = true;
      if (w === "snow") patch.weather.snow = Math.max(cur.weather.snow, 0.8);
      if (w === "fog") patch.weather.fog = Math.max(cur.weather.fog, 0.8);
      if (["overcast", "partly"].includes(w)) patch.weather.clouds = Math.max(cur.weather.clouds, 1);
      return { patch, reply: `Done. It's ${WORD[w] ?? w} on the screen now${forHow(a.minutes)}.${a.minutes ? "" : " Say “back to the real weather” any time."}`, minutes: a.minutes };
    }
    case "sky.weatherOff": {
      const k = { rain: "rain", drizzle: "rain", storm: "lightning", snow: "snow", fog: "fog", overcast: "clouds", partly: "clouds" }[a.weather];
      if (!k) return { patch: { weather: { follow: true } }, reply: "Okay, back to the real weather." };
      return { patch: { weather: { follow: false, choice: "clear", [k]: k === "lightning" ? false : 0 } }, reply: `Done. No more ${a.weather === "storm" ? "storm" : a.weather} on the screen.` };
    }
    case "sky.phase": return { patch: { time: { follow: false, phase: a.phase } }, reply: `Done. It's ${PHASE_SAY[a.phase]} in the sky now${forHow(a.minutes)}.${a.minutes ? "" : " Say “show the real sky again” to go back."}`, minutes: a.minutes };
    case "sky.season": return { patch: { season: { follow: false, choice: a.season } }, reply: `Done. It looks like ${a.season} now${forHow(a.minutes)}.`, minutes: a.minutes };
    case "sky.colors": {
      const w = a.how, c = cur.colors;
      const patch = /brighter/.test(w) ? { brightness: step(c.brightness, 0.15, 0.6, 1.3) } : /dimmer|darker|softer/.test(w) ? { brightness: step(c.brightness, -0.15, 0.6, 1.3) }
        : /warmer/.test(w) ? { warmth: step(c.warmth, 0.3, -1, 1) } : /cooler/.test(w) ? { warmth: step(c.warmth, -0.3, -1, 1) }
        : /more/.test(w) ? { saturation: step(c.saturation, 0.2, 0.5, 1.5) } : { saturation: step(c.saturation, -0.2, 0.5, 1.5) };
      return { patch: { colors: patch }, reply: `Done. A ${w.replace(/^more /, "more ").replace(/^less /, "less ")} sky.` };
    }
  }
  return null;
}
// The values a patch will replace (to put back later, or for "undo"): only the paths it touches
export function before(patch, cur = sky.get()) {
  const out = {};
  for (const [g, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && !Array.isArray(v)) { out[g] = {}; for (const k of Object.keys(v)) out[g][k] = cur[g]?.[k]; }
    else out[g] = cur[g];
  }
  if (cur.preset) out.preset = cur.preset;
  return out;
}
export const EXAMPLES = ["make it rain", "let it snow", "thunderstorm", "clear skies", "make it foggy", "sunny", "make it rain for 10 minutes", "make it night", "make it sunset", "make it sunrise for an hour",
  "make it noon", "show the real sky again", "follow the sun", "turn on the stars", "no more clouds", "more leaves", "change the scenery to mountains", "use the forest scene", "no scenery",
  "pause the animation", "resume the animation", "make it winter", "cozy vibe", "a plain background", "make the background warmer", "what's the sky set to?", "compact mode", "full screen",
  "move to the other screen", "minimize", "show yourself"];
