// Everyday answers that need no AI and no internet: math, unit conversions (cooking too), spelling, coin, dice, random
// numbers, the time in another city, days until a date, holidays, jokes and fun facts.

// ---- math ---------------------------------------------------------------------------------------------------------
const WORD_OPS = [[/\bmultiplied by\b|\btimes\b|\bx\b(?=\s*[\d(])/g, "*"], [/\bdivided by\b|\bover\b(?=\s*[\d(])/g, "/"], [/\bplus\b|\badded to\b|\band\b(?=\s*[\d(])/g, "+"],
  [/\bminus\b|\bless\b(?=\s*[\d(])|\btake away\b/g, "-"], [/\bto the power of\b|\braised to\b/g, "^"], [/\bsquared\b/g, "^2"], [/\bcubed\b/g, "^3"]];
// "what is 15 percent of 80", "12 times 14", "square root of 144", "(3+4)*2" → { value, spoken } or null
export function calculate(text) {
  let s = String(text).toLowerCase().replace(/,/g, "").replace(/\b(what is|whats|calculate|compute|work out|figure out|solve|how much is|equals|equal|is|the answer to|math|question|please|tell me)\b/g, " ").replace(/[?=]/g, " ");
  let m;
  if ((m = /(\d+(?:\.\d+)?)\s*percent of\s*(\d+(?:\.\d+)?)/.exec(s))) { const v = (Number(m[1]) / 100) * Number(m[2]); return { value: v, spoken: `${m[1]} percent of ${m[2]} is ${fmt(v)}.` }; }
  if ((m = /(\d+(?:\.\d+)?)\s*is what percent of\s*(\d+(?:\.\d+)?)/.exec(s))) { const v = (Number(m[1]) / Number(m[2])) * 100; return { value: v, spoken: `${m[1]} is ${fmt(v)} percent of ${m[2]}.` }; }
  if ((m = /(?:tip|gratuity)\s*(?:of|at)?\s*(\d+(?:\.\d+)?)\s*percent\s*(?:on|for|of)\s*(\d+(?:\.\d+)?)/.exec(s))) { const v = (Number(m[1]) / 100) * Number(m[2]); return { value: v, spoken: `A ${m[1]} percent tip on ${m[2]} is ${fmt(v)}, for a total of ${fmt(v + Number(m[2]))}.` }; }
  s = s.replace(/square root of\s*(\d+(?:\.\d+)?)/g, "sqrt($1)").replace(/cube root of\s*(\d+(?:\.\d+)?)/g, "cbrt($1)");
  for (const [re, op] of WORD_OPS) s = s.replace(re, op);
  s = s.replace(/[^\d.+\-*/^()%a-z ]/g, " ").replace(/\b(?!sqrt|cbrt)[a-z]+\b/g, " ").replace(/\s+/g, "");
  if (!/\d/.test(s) || !/[+\-*/^%]|sqrt|cbrt/.test(s)) return null;
  try { const v = evalExpr(s); if (!Number.isFinite(v)) return null; return { value: v, spoken: `That's ${fmt(v)}.` }; } catch { return null; }
}
function evalExpr(src) {
  let i = 0;
  const peek = () => src[i], eat = (c) => (src[i] === c ? (i++, true) : false);
  const num = () => { if (src.startsWith("sqrt", i)) { i += 4; return Math.sqrt(atom()); } if (src.startsWith("cbrt", i)) { i += 4; return Math.cbrt(atom()); } const m = /^\d+(?:\.\d+)?/.exec(src.slice(i)); if (!m) throw new Error("number"); i += m[0].length; return Number(m[0]); };
  const atom = () => { if (eat("(")) { const v = expr(); if (!eat(")")) throw new Error(")"); return v; } if (eat("-")) return -atom(); return num(); };
  const power = () => { let b = atom(); while (eat("%")) b = b / 100; if (eat("^")) return b ** power(); return b; };
  const term = () => { let v = power(); for (;;) { if (eat("*")) v *= power(); else if (eat("/")) { const d = power(); if (d === 0) throw new Error("zero"); v /= d; } else return v; } };
  const expr = () => { let v = term(); for (;;) { if (eat("+")) v += term(); else if (eat("-")) v -= term(); else return v; } };
  const v = expr(); if (i < src.length) throw new Error("extra " + peek()); return v;
}
export function fmt(v) { if (Number.isInteger(v)) return v.toLocaleString("en-US"); const r = Math.round(v * 100) / 100; return Math.abs(r) >= 1000 ? r.toLocaleString("en-US") : String(r); }

// ---- conversions --------------------------------------------------------------------------------------------------
const U = {
  // length, in metres
  mm: ["length", 0.001, "millimeters"], cm: ["length", 0.01, "centimeters"], m: ["length", 1, "meters"], km: ["length", 1000, "kilometers"],
  in: ["length", 0.0254, "inches"], ft: ["length", 0.3048, "feet"], yd: ["length", 0.9144, "yards"], mi: ["length", 1609.344, "miles"],
  // weight, in grams
  mg: ["weight", 0.001, "milligrams"], g: ["weight", 1, "grams"], kg: ["weight", 1000, "kilograms"], oz: ["weight", 28.3495, "ounces"], lb: ["weight", 453.592, "pounds"], st: ["weight", 6350.29, "stone"],
  // volume, in millilitres (US)
  ml: ["volume", 1, "milliliters"], l: ["volume", 1000, "liters"], tsp: ["volume", 4.92892, "teaspoons"], tbsp: ["volume", 14.7868, "tablespoons"], floz: ["volume", 29.5735, "fluid ounces"],
  cup: ["volume", 236.588, "cups"], pt: ["volume", 473.176, "pints"], qt: ["volume", 946.353, "quarts"], gal: ["volume", 3785.41, "gallons"],
  // speed, in km/h
  mph: ["speed", 1.60934, "miles per hour"], kph: ["speed", 1, "kilometers per hour"],
  // time, in seconds
  sec: ["time", 1, "seconds"], min: ["time", 60, "minutes"], hr: ["time", 3600, "hours"], day: ["time", 86400, "days"], wk: ["time", 604800, "weeks"],
  // temperature is special
  f: ["temp", 0, "degrees Fahrenheit"], c: ["temp", 0, "degrees Celsius"], k: ["temp", 0, "kelvin"],
};
const UNIT_WORDS = [
  [/\b(millimeters?|millimetres?|mm)\b/, "mm"], [/\b(centimeters?|centimetres?|cm)\b/, "cm"], [/\b(kilometers?|kilometres?|km|kms|klicks?)\b/, "km"], [/\b(meters?|metres?)\b/, "m"],
  [/\b(inches|inch|in)\b(?=\s|$)/, "in"], [/\b(feet|foot|ft)\b/, "ft"], [/\b(yards?|yd)\b/, "yd"], [/\b(miles?|mi)\b/, "mi"],
  [/\b(milligrams?|mg)\b/, "mg"], [/\b(kilograms?|kilos?|kg|kgs)\b/, "kg"], [/\b(grams?|g)\b/, "g"], [/\b(fluid ounces?|fl oz|floz)\b/, "floz"], [/\b(ounces?|oz)\b/, "oz"], [/\b(pounds?|lbs?)\b/, "lb"], [/\bstone\b/, "st"],
  [/\b(milliliters?|millilitres?|ml)\b/, "ml"], [/\b(liters?|litres?|l)\b/, "l"], [/\b(teaspoons?|tsp|teaspoonfuls?)\b/, "tsp"], [/\b(tablespoons?|tbsp|tbs|tablespoonfuls?)\b/, "tbsp"],
  [/\b(cups?)\b/, "cup"], [/\b(pints?|pt)\b/, "pt"], [/\b(quarts?|qt)\b/, "qt"], [/\b(gallons?|gal)\b/, "gal"],
  [/\b(miles per hour|mph)\b/, "mph"], [/\b(kilometers per hour|kilometres per hour|kph|km h|kmh)\b/, "kph"],
  [/\b(fahrenheit|degrees f|deg f|f)\b/, "f"], [/\b(celsius|centigrade|degrees c|deg c|c)\b/, "c"], [/\b(kelvin|k)\b/, "k"],
  [/\b(seconds?|secs?)\b/, "sec"], [/\b(minutes?|mins?)\b/, "min"], [/\b(hours?|hrs?)\b/, "hr"], [/\b(days?)\b/, "day"], [/\b(weeks?)\b/, "wk"],
];
function unitAt(s) { let best = null; for (const [re, u] of UNIT_WORDS) { const m = re.exec(s); if (m && (!best || m.index < best.index)) best = { u, index: m.index, len: m[0].length }; } return best; }
// "convert 5 miles to kilometers", "how many tablespoons in a cup", "350 f in celsius", "what is 2 cups in ml"
export function convert(text) {
  const s = ` ${String(text).toLowerCase().replace(/°/g, " degrees ").replace(/degrees?\s+(fahrenheit|celsius|f|c)\b/g, "$1")} `;
  let amount, from, to;
  let m = /how many\s+(.+?)\s+(?:are )?(?:in|per|make|to)\s+(?:a|an|1|one)?\s*(.+?)\s*(?:\?|$)/.exec(s);
  if (m) { const a = unitAt(m[1]), b = unitAt(m[2]); if (a && b) { amount = Number(/(\d+(?:\.\d+)?)/.exec(m[2])?.[1] ?? 1); from = b.u; to = a.u; } }
  if (!from) {
    m = /(-?\d+(?:\.\d+)?)\s*(.+?)\s+(?:to|in|into|as)\s+(.+?)\s*$/.exec(s.trim());
    if (m) { const a = unitAt(` ${m[2]} `), b = unitAt(` ${m[3]} `); if (a && b) { amount = Number(m[1]); from = a.u; to = b.u; } }
  }
  if (!from || !to || !U[from] || !U[to] || U[from][0] !== U[to][0] || from === to) return null;
  let v;
  if (U[from][0] === "temp") {
    const c = from === "c" ? amount : from === "f" ? (amount - 32) * 5 / 9 : amount - 273.15;
    v = to === "c" ? c : to === "f" ? c * 9 / 5 + 32 : c + 273.15;
    return { value: v, spoken: `${fmt(amount)} ${U[from][2]} is ${fmt(Math.round(v * 10) / 10)} ${U[to][2]}.` };
  }
  v = (amount * U[from][1]) / U[to][1];
  const nice = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100;
  return { value: v, spoken: `${fmt(amount)} ${amount === 1 ? U[from][2].replace(/(s|es)$/, "").replace(/^fee$/, "foot").replace(/inche$/, "inch") : U[from][2]} is ${fmt(nice)} ${U[to][2]}.` };
}

// ---- spelling, chance, numbers --------------------------------------------------------------------------------------
export function spell(text) {
  const w = String(text).toLowerCase().replace(/\b(how do you spell|how do i spell|how to spell|spell|the word|spelling of|what is the|can you|please|for me)\b/g, " ").replace(/[^a-z' -]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!w.length || w.length > 3) return null;
  const word = w.join(" ");
  return { word, spoken: `${word}: ${word.toUpperCase().split("").map((c) => (c === " " ? "space" : c)).join(", ")}.` };
}
export const coin = (rand = Math.random) => (rand() < 0.5 ? "Heads." : "Tails.");
export function dice(text, rand = Math.random) {
  const m = /(\d+)?\s*d\s*(\d+)/.exec(String(text).toLowerCase().replace(/\bdie\b|\bdice\b/g, (w) => w)) ?? null;
  let count = 1, sides = 6;
  if (m) { count = Number(m[1] ?? 1); sides = Number(m[2]); }
  else { const n = /(\d+)\s*(?:dice|die)/.exec(text); if (n) count = Number(n[1]); const s = /(\d+)[\s-]*sided/.exec(text); if (s) sides = Number(s[1]); }
  count = Math.max(1, Math.min(count, 20)); sides = Math.max(2, Math.min(sides, 1000));
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(rand() * sides));
  return { rolls, total: rolls.reduce((a, b) => a + b, 0), spoken: count === 1 ? `You rolled a ${rolls[0]}.` : `You rolled ${rolls.join(", ")}, for a total of ${rolls.reduce((a, b) => a + b, 0)}.` };
}
export function randomNumber(text, rand = Math.random) {
  const nums = (String(text).match(/-?\d+/g) ?? []).map(Number);
  let lo = 1, hi = 10;
  if (nums.length >= 2) { lo = Math.min(nums[0], nums[1]); hi = Math.max(nums[0], nums[1]); } else if (nums.length === 1) hi = nums[0];
  const v = lo + Math.floor(rand() * (hi - lo + 1));
  return { value: v, spoken: `${v}.` };
}

// ---- time around the world -----------------------------------------------------------------------------------------
export const CITY_TZ = {
  "new york": "America/New_York", nyc: "America/New_York", boston: "America/New_York", miami: "America/New_York", atlanta: "America/New_York", washington: "America/New_York", "washington dc": "America/New_York", philadelphia: "America/New_York", detroit: "America/Detroit", toronto: "America/Toronto", montreal: "America/Toronto",
  chicago: "America/Chicago", dallas: "America/Chicago", houston: "America/Chicago", austin: "America/Chicago", "san antonio": "America/Chicago", minneapolis: "America/Chicago", "new orleans": "America/Chicago", nashville: "America/Chicago", "kansas city": "America/Chicago", "st louis": "America/Chicago", winnipeg: "America/Winnipeg", "mexico city": "America/Mexico_City",
  denver: "America/Denver", phoenix: "America/Phoenix", "salt lake city": "America/Denver", calgary: "America/Edmonton", edmonton: "America/Edmonton",
  "los angeles": "America/Los_Angeles", la: "America/Los_Angeles", "san francisco": "America/Los_Angeles", seattle: "America/Los_Angeles", portland: "America/Los_Angeles", "las vegas": "America/Los_Angeles", "san diego": "America/Los_Angeles", vancouver: "America/Vancouver",
  anchorage: "America/Anchorage", alaska: "America/Anchorage", honolulu: "Pacific/Honolulu", hawaii: "Pacific/Honolulu",
  london: "Europe/London", england: "Europe/London", uk: "Europe/London", dublin: "Europe/Dublin", ireland: "Europe/Dublin", lisbon: "Europe/Lisbon", paris: "Europe/Paris", france: "Europe/Paris", berlin: "Europe/Berlin", germany: "Europe/Berlin", madrid: "Europe/Madrid", spain: "Europe/Madrid", rome: "Europe/Rome", italy: "Europe/Rome", amsterdam: "Europe/Amsterdam", brussels: "Europe/Brussels", vienna: "Europe/Vienna", zurich: "Europe/Zurich", stockholm: "Europe/Stockholm", oslo: "Europe/Oslo", copenhagen: "Europe/Copenhagen", helsinki: "Europe/Helsinki", warsaw: "Europe/Warsaw", prague: "Europe/Prague", athens: "Europe/Athens", istanbul: "Europe/Istanbul", kyiv: "Europe/Kyiv", kiev: "Europe/Kyiv", moscow: "Europe/Moscow",
  cairo: "Africa/Cairo", nairobi: "Africa/Nairobi", lagos: "Africa/Lagos", johannesburg: "Africa/Johannesburg", "cape town": "Africa/Johannesburg",
  dubai: "Asia/Dubai", jerusalem: "Asia/Jerusalem", israel: "Asia/Jerusalem", "tel aviv": "Asia/Jerusalem", riyadh: "Asia/Riyadh", tehran: "Asia/Tehran", karachi: "Asia/Karachi", delhi: "Asia/Kolkata", "new delhi": "Asia/Kolkata", mumbai: "Asia/Kolkata", india: "Asia/Kolkata", bangalore: "Asia/Kolkata", dhaka: "Asia/Dhaka", bangkok: "Asia/Bangkok", jakarta: "Asia/Jakarta", singapore: "Asia/Singapore", "kuala lumpur": "Asia/Kuala_Lumpur", manila: "Asia/Manila", philippines: "Asia/Manila", "hong kong": "Asia/Hong_Kong", beijing: "Asia/Shanghai", shanghai: "Asia/Shanghai", china: "Asia/Shanghai", taipei: "Asia/Taipei", seoul: "Asia/Seoul", korea: "Asia/Seoul", tokyo: "Asia/Tokyo", japan: "Asia/Tokyo",
  sydney: "Australia/Sydney", melbourne: "Australia/Melbourne", brisbane: "Australia/Brisbane", perth: "Australia/Perth", adelaide: "Australia/Adelaide", australia: "Australia/Sydney", auckland: "Pacific/Auckland", "new zealand": "Pacific/Auckland",
  "sao paulo": "America/Sao_Paulo", brazil: "America/Sao_Paulo", "rio de janeiro": "America/Sao_Paulo", "buenos aires": "America/Argentina/Buenos_Aires", argentina: "America/Argentina/Buenos_Aires", lima: "America/Lima", bogota: "America/Bogota", santiago: "America/Santiago",
};
export function cityIn(text) {
  const t = ` ${String(text).toLowerCase().replace(/[^a-z ]/g, " ")} `;
  let best = null;
  for (const c of Object.keys(CITY_TZ)) if (t.includes(` ${c} `) && (!best || c.length > best.length)) best = c;
  return best;
}
export function timeIn(city, now = new Date()) {
  const tz = CITY_TZ[city];
  if (!tz) return null;
  const t = now.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const d = now.toLocaleDateString("en-US", { timeZone: tz, weekday: "long" }), here = now.toLocaleDateString("en-US", { weekday: "long" });
  const name = city.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bUk\b/, "the UK").replace(/\bLa\b/, "Los Angeles").replace(/\bNyc\b/, "New York");
  return `In ${name} it's ${t}${d !== here ? ` on ${d}` : ""}.`;
}

// ---- fun ---------------------------------------------------------------------------------------------------------
// (jokes live in lib/jokes)
export const FACTS = [
  "Honey never spoils. Archaeologists have found pots of honey in ancient Egyptian tombs that are still edible.",
  "Octopuses have three hearts and blue blood.",
  "A group of flamingos is called a flamboyance.",
  "Bananas are berries, but strawberries aren't.",
  "The Eiffel Tower can be about 15 centimeters taller in summer, because the metal expands in the heat.",
  "Sea otters hold hands while they sleep so they don't drift apart.",
  "A day on Venus is longer than a year on Venus.",
  "Wombat droppings are cube-shaped.",
  "The shortest war in history lasted about 38 minutes.",
  "Your nose can remember around 50,000 different scents.",
  "Cows have best friends and get stressed when they're separated.",
  "There are more possible games of chess than there are atoms in the observable universe.",
  "Butterflies taste with their feet.",
  "A bolt of lightning is about five times hotter than the surface of the sun.",
  "Snails can sleep for up to three years.",
  "Hot water can freeze faster than cold water under some conditions. It's called the Mpemba effect.",
  "The heart of a blue whale is about the size of a small car.",
  "Koalas sleep up to 22 hours a day.",
  "The first oranges weren't orange. They were green.",
  "An ostrich's eye is bigger than its brain.",
];
export const pickOf = (arr, rand = Math.random) => arr[Math.floor(rand() * arr.length)];
