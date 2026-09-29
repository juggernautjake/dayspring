// How Maps says things: distances, times, turn instructions, the spoken step ("In 2 miles, turn left onto Main
// Street."), the arrival time and "leave by". Pure functions, no network, no files (scripts/qa/maps.mjs tests them).
//   spokenDistance(m, units) · shortDistance(m, units) · spokenDuration(s) · shortDuration(s) · clock(date)
//   osrmInstruction(step) · orsInstruction(step) · sayable(text) · spokenStep(steps, i, units) · leaveBy({ …})

const MI = 1609.344, FT = 0.3048;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const trimNum = (n) => String(Math.round(n * 10) / 10).replace(/\.0$/, "");

// ---- distances --------------------------------------------------------------------------------------------------------
// Spoken, rounded the way people say them: "300 feet", "a quarter mile", "half a mile", "a mile and a half", "12 miles";
// "300 meters", "1.5 kilometers".
export function spokenDistance(m, units = "mi") {
  m = Math.max(0, Number(m) || 0);
  if (units === "km") {
    if (m < 20) return "a few meters";
    if (m < 100) return `${Math.round(m / 10) * 10} meters`;
    if (m < 950) return `${Math.round(m / 50) * 50} meters`;
    const km = m / 1000;
    if (km < 10) { const r = Math.round(km * 2) / 2; return r === 1 ? "1 kilometer" : `${trimNum(r)} kilometers`; }
    return `${Math.round(km)} kilometers`;
  }
  const ft = m / FT, mi = m / MI;
  if (ft < 60) return "a few feet";
  if (ft < 500) return `${Math.round(ft / 50) * 50} feet`;
  if (ft < 1000) return `${Math.round(ft / 100) * 100} feet`;
  if (mi < 0.875) { const q = Math.max(0.25, Math.round(mi * 4) / 4); return q === 0.25 ? "a quarter mile" : q === 0.5 ? "half a mile" : "three quarters of a mile"; }
  if (mi < 10) {
    const r = Math.round(mi * 2) / 2;
    if (r === 1) return "1 mile";
    if (r === 1.5) return "a mile and a half";
    return r % 1 ? `${Math.floor(r)} and a half miles` : `${r} miles`;
  }
  return `${Math.round(mi)} miles`;
}
// For the screen: "500 ft", "0.3 mi", "12 mi", "300 m", "1.2 km".
export function shortDistance(m, units = "mi") {
  m = Math.max(0, Number(m) || 0);
  if (units === "km") return m < 950 ? `${Math.round(m / 10) * 10} m` : `${m < 10000 ? trimNum(m / 1000) : Math.round(m / 1000)} km`;
  const ft = m / FT, mi = m / MI;
  if (ft < 1000) return `${Math.max(10, Math.round(ft / 10) * 10)} ft`;
  return `${mi < 10 ? trimNum(mi) : Math.round(mi)} mi`;
}

// ---- times ------------------------------------------------------------------------------------------------------------
export function spokenDuration(s) {
  s = Math.max(0, Number(s) || 0);
  if (s < 45) return "less than a minute";
  const tot = Math.round(s / 60), h = Math.floor(tot / 60), mi = tot % 60;
  if (!h) return plural(Math.max(1, mi), "minute");
  return mi ? `${plural(h, "hour")} ${plural(mi, "minute")}` : plural(h, "hour");
}
export function shortDuration(s) {
  s = Math.max(0, Number(s) || 0);
  const tot = Math.max(1, Math.round(s / 60)), h = Math.floor(tot / 60), mi = tot % 60;
  return h ? `${h} h${mi ? ` ${mi} min` : ""}` : `${mi} min`;
}
// "3:42 p.m." (the way Dayspring says times everywhere)
export function clock(d) {
  const h = d.getHours(), m = d.getMinutes();
  return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h >= 12 ? "p.m." : "a.m."}`;
}
const hm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

// ---- turn instructions (OSRM gives maneuvers, not words) --------------------------------------------------------------
const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
export const compass = (deg) => COMPASS[Math.round((((Number(deg) || 0) % 360) + 360) % 360 / 45) % 8];
const ORD = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const ordinal = (n) => ORD[n] ?? `number ${n}`;
const lc = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const sideOf = (mod = "") => (/left/.test(mod) ? "left" : /right/.test(mod) ? "right" : "");
function turnWords(mod = "") {
  switch (mod) {
    case "uturn": return "Make a U-turn";
    case "sharp left": return "Turn sharp left";
    case "sharp right": return "Turn sharp right";
    case "slight left": return "Bear left";
    case "slight right": return "Bear right";
    case "left": return "Turn left";
    case "right": return "Turn right";
    default: return "Continue straight";
  }
}
// an OSRM step → "Turn left onto Main Street"
export function osrmInstruction(step = {}) {
  const man = step.maneuver ?? {}, mod = man.modifier ?? "", type = man.type ?? "turn";
  const name = [step.name, step.ref && step.ref !== step.name ? step.ref : ""].filter(Boolean).join(" (") + (step.name && step.ref && step.ref !== step.name ? ")" : "");
  const onto = name ? ` onto ${name}` : "";
  switch (type) {
    case "depart": return `Head ${compass(man.bearing_after)}${name ? ` on ${name}` : ""}`;
    case "arrive": { const s = sideOf(mod); return `Arrive at your destination${s ? `, on the ${s}` : mod === "straight" ? ", straight ahead" : ""}`; }
    case "new name": return name ? `Continue onto ${name}` : "Continue";
    case "continue": return !mod || mod === "straight" ? `Continue${name ? ` on ${name}` : ""}` : `${turnWords(mod)}${onto}`;
    case "end of road": return `At the end of the road, ${lc(turnWords(mod))}${onto}`;
    case "fork": { const s = sideOf(mod); return `Keep ${s || "straight"} at the fork${onto}`; }
    case "merge": { const s = sideOf(mod); return `Merge${s ? ` ${s}` : ""}${onto}`; }
    case "on ramp": { const s = sideOf(mod); return `Take the ramp${s ? ` on the ${s}` : ""}${onto}`; }
    case "off ramp": { const s = sideOf(mod); return `Take the exit${s ? ` on the ${s}` : ""}${onto}`; }
    case "roundabout": case "rotary": return man.exit ? `At the roundabout, take the ${ordinal(man.exit)} exit${onto}` : `Enter the roundabout${onto}`;
    case "exit roundabout": case "exit rotary": return `Exit the roundabout${onto}`;
    case "roundabout turn": return `At the roundabout, ${lc(turnWords(mod))}${onto}`;
    default: return mod && mod !== "straight" ? `${turnWords(mod)}${onto}` : `Continue${onto}`;
  }
}
// ORS gives words already; its type numbers say what kind of maneuver it is
export const ORS_KIND = { 0: "turn", 1: "turn", 2: "turn", 3: "turn", 4: "turn", 5: "turn", 6: "continue", 7: "roundabout", 8: "roundabout", 9: "uturn", 10: "arrive", 11: "depart", 12: "fork", 13: "fork" };
export const orsInstruction = (step = {}) => String(step.instruction ?? "").replace(/\s+/g, " ").trim() || "Continue";

// ---- saying it --------------------------------------------------------------------------------------------------------
// Street abbreviations spelled out for the voice ("N Main St" → "North Main Street"), line breaks made into sentences.
const ABBR = { st: "Street", ave: "Avenue", av: "Avenue", rd: "Road", dr: "Drive", blvd: "Boulevard", ln: "Lane", hwy: "Highway", pkwy: "Parkway", ct: "Court", pl: "Place", cir: "Circle",
  trl: "Trail", fwy: "Freeway", expy: "Expressway", sq: "Square", ter: "Terrace", cv: "Cove", xing: "Crossing", tpke: "Turnpike", frwy: "Freeway", rte: "Route", mt: "Mount", ft: "Fort", loop: "Loop" };
const DIRS = { n: "North", s: "South", e: "East", w: "West", ne: "Northeast", nw: "Northwest", se: "Southeast", sw: "Southwest" };
export function sayable(text) {
  let t = String(text ?? "").replace(/\r?\n+/g, ". ").replace(/\s*&\s*/g, " and ").replace(/\s+/g, " ").trim();
  t = t.replace(/\s*\(([^()]+)\)/g, ", $1,").replace(/,\s*([.,;]|$)/g, "$1");
  t = t.replace(/\bUS[- ](\d+)/g, "U.S. $1").replace(/\bI-(\d+)/g, "I $1").replace(/\bTX[- ](\d+)/g, "Texas $1").replace(/\bFM[- ](\d+)/g, "Farm to Market $1").replace(/\b(?:SR|SH)[- ](\d+)/g, "State Highway $1");
  t = t.replace(/\b(\d+(?:\.\d+)?) ?mi\b/g, (_, n) => `${n} ${n === "1" ? "mile" : "miles"}`).replace(/\b(\d+) ?ft\b/g, "$1 feet").replace(/\b(\d+(?:\.\d+)?) ?km\b/g, "$1 kilometers");
  const words = t.split(" ");
  const out = words.map((w, i) => {
    const m = /^([A-Za-z]+)(\.?)([,;:)/]*)$/.exec(w);
    if (!m) return w;
    const k = m[1].toLowerCase(), dot = m[2], rest = m[3], end = dot || rest;
    const next = words[i + 1] ?? "";
    // a direction letter before a street name: "N Main", or after one: "US-36 E" (capital letters only, so "a" and "s" stay words)
    if (DIRS[k] && m[1] === m[1].toUpperCase() && /^[A-Z0-9]/.test(next) && !end) return DIRS[k];
    if (DIRS[k] && m[1] === m[1].toUpperCase() && i > 0 && (end || !next || /^[a-z(]/.test(next))) return DIRS[k] + dot + rest;
    if (k === "st" && m[1][0] === "S" && /^[A-Z]/.test(next) && !end && !DIRS[next.toLowerCase().replace(/\W/g, "")]) return "Saint";
    if (ABBR[k] && /^[A-Z]/.test(m[1]) && i > 0) return ABBR[k] + dot + rest;
    return w;
  });
  t = out.join(" ").replace(/\.\s*\./g, ".");
  return t;
}
const endSentence = (s) => (/[.!?]$/.test(s) ? s : s + ".");
// The words for step i of a route: the first says where to head and for how far; the others say how far until this
// maneuver ("In half a mile, turn left onto Oak Avenue."). The distance to a maneuver is the length of the step before it.
export function spokenStep(steps, i, units = "mi") {
  const s = steps?.[i];
  if (!s) return "";
  const what = sayable(s.text);
  if (i === 0) {
    const nextIsArrive = steps[1]?.kind === "arrive";
    return endSentence(s.distance > 30 && !nextIsArrive ? `${what} for ${spokenDistance(s.distance, units)}` : what);
  }
  const before = steps[i - 1]?.distance ?? 0;
  const lead = before >= 15 ? `In ${spokenDistance(before, units)}, ` : "";
  return endSentence(lead ? lead + lc(what) : what);
}

// ---- leave by -----------------------------------------------------------------------------------------------------------
// When to leave to be there on time: the start minus the trip minus a small cushion, rounded DOWN to 5 minutes.
//   leaveBy({ date: "2026-10-01", start: "15:00", durationS: 1500, bufferMin: 5 }) →
//   { leaveAt: "14:30", leaveDate, minutes, text: "You need to leave by 2:30 to make your 3:00.", late, minutesLate }
export function leaveBy({ date, start, durationS, bufferMin = 5, title = "", now = new Date() } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? "")) || !/^\d{1,2}:\d{2}$/.test(String(start ?? ""))) throw new Error("leaveBy needs a date and a start time");
  const [y, mo, d] = date.split("-").map(Number), [h, mi] = start.split(":").map(Number);
  const at = new Date(y, mo - 1, d, h, mi, 0, 0);
  const tripMin = Math.max(1, Math.ceil((Number(durationS) || 0) / 60));
  const leave = new Date(at.getTime() - (tripMin + Math.max(0, Number(bufferMin) || 0)) * 60000);
  leave.setMinutes(Math.floor(leave.getMinutes() / 5) * 5, 0, 0);
  const short = (x) => `${x.getHours() % 12 || 12}:${String(x.getMinutes()).padStart(2, "0")}`;
  const late = now.getTime() > leave.getTime();
  const what = title ? `${title} at ${short(at)}` : `your ${short(at)}`;
  const text = late
    ? (now.getTime() > at.getTime() - tripMin * 60000 ? `You'd need to leave now, and you'd still be about ${plural(Math.max(1, Math.round((now.getTime() + tripMin * 60000 - at.getTime()) / 60000)), "minute")} late for ${what}.` : `You should leave now to make ${what}.`)
    : `You need to leave by ${short(leave)} to make ${what}.`;
  return { leaveAt: hm(leave), leaveDate: `${leave.getFullYear()}-${String(leave.getMonth() + 1).padStart(2, "0")}-${String(leave.getDate()).padStart(2, "0")}`, minutes: tripMin, text, late };
}
