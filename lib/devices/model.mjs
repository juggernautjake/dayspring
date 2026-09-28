// The device model: every device, whatever the brand, is described the same way. Voice, the Devices page and rules
// only talk to CAPABILITIES, never to brands (adapters translate; lib/devices/adapters).
//   capabilities: onoff · brightness · color (rgb/hs) · colortemp · effect (list + set) · scene · openclose (with state)
//                 · lock · temperature/target · timer/program · startstoppause · sensor · camera · power (watts)
//   safety classes: normal · heat (air fryer, coffee maker, heater, printer) · motion (garage door, blinds, gate)
//                   · security (lock). Heat, motion and security always need an exact match and the owner's yes, can't be
//                   switched on by "everything", and can't be controlled by anyone but the owner.
// Also the words: numbers and ordinals ("fan two", "second fan", "printer #3" → "fan 2", "printer 3"), and the names a
// device answers to.
export const CAPS = ["onoff", "brightness", "color", "colortemp", "effect", "scene", "openclose", "lock", "temperature", "timer", "startstoppause", "sensor", "camera", "power"];
export const SAFETY = ["normal", "heat", "motion", "security"];

// device types: what they're called, their icon, their usual safety class
export const TYPES = {
  computer: { label: "Computer", icon: "🖥️", safety: "normal", words: ["computer", "pc", "desktop", "tower", "gaming pc", "gaming computer", "workstation"] },
  laptop: { label: "Laptop", icon: "💻", safety: "normal", words: ["laptop"] },
  tv: { label: "TV", icon: "📺", safety: "normal", words: ["tv", "television", "telly"] },
  monitor: { label: "Monitor", icon: "🖵", safety: "normal", words: ["monitor", "screen", "display"] },
  fan: { label: "Fan", icon: "🌀", safety: "normal", words: ["fan", "box fan", "tower fan", "ceiling fan"] },
  light: { label: "Light", icon: "💡", safety: "normal", words: ["light", "lights", "lamp", "bulb", "led strip", "led strips", "leds", "light strip"] },
  printer: { label: "3D printer", icon: "🖨️", safety: "heat", words: ["3d printer", "printer"] },
  speaker: { label: "Speakers", icon: "🔊", safety: "normal", words: ["speaker", "speakers", "sound bar", "soundbar", "stereo", "amp", "amplifier"] },
  console: { label: "Game console", icon: "🎮", safety: "normal", words: ["console", "xbox", "playstation", "ps5", "switch"] },
  router: { label: "Router / modem", icon: "📶", safety: "normal", words: ["router", "modem", "wifi", "internet"] },
  fridge: { label: "Fridge / freezer", icon: "🧊", safety: "normal", words: ["fridge", "refrigerator", "freezer", "mini fridge"] },
  heater: { label: "Heater", icon: "🔥", safety: "heat", words: ["heater", "space heater", "radiator"] },
  coffee: { label: "Coffee maker", icon: "☕", safety: "heat", words: ["coffee maker", "coffee machine", "coffee pot", "coffee", "kettle"] },
  airfryer: { label: "Air fryer / oven", icon: "🍟", safety: "heat", words: ["air fryer", "oven", "toaster", "toaster oven", "slow cooker", "crock pot", "instant pot"] },
  iron: { label: "Iron / soldering", icon: "🪛", safety: "heat", words: ["iron", "soldering iron", "hot glue gun", "glue gun"] },
  garage: { label: "Garage door / gate", icon: "🚪", safety: "motion", words: ["garage door", "garage", "gate"] },
  blinds: { label: "Blinds / shades", icon: "🪟", safety: "motion", words: ["blinds", "shades", "curtains", "shutters"] },
  lock: { label: "Lock", icon: "🔒", safety: "security", words: ["lock", "door lock", "deadbolt"] },
  charger: { label: "Charger", icon: "🔌", safety: "normal", words: ["charger", "charging station"] },
  other: { label: "Something else", icon: "🔌", safety: "normal", words: [] },
};
export const safetyOf = (d) => (SAFETY.includes(d?.safety) ? d.safety : TYPES[d?.type]?.safety ?? "normal");
export const iconOf = (d) => d?.icon || TYPES[d?.type]?.icon || "🔌";
// a "strong" device: needs an exact match and a yes for anything but turning it off (heat) / anything at all (motion, security)
export const guarded = (d) => safetyOf(d) !== "normal";

// ---- words ---------------------------------------------------------------------------------------------------------
const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 };
// sounds-alike words speech recognition hands us for small numbers after a device word ("fan to", "printer for")
const HOMOPHONE = { to: 2, too: 2, for: 4, won: 1, tree: 3, free: 3, ate: 8 };
const NUM_WORD = new RegExp(`\\b(${Object.keys(ONES).join("|")})\\b`, "g");
const ORD_WORD = new RegExp(`\\b(${Object.keys(ORD).join("|")}|\\d{1,2}(?:st|nd|rd|th))\\b`);
const ordValue = (w) => ORD[w] ?? Number(String(w).replace(/\D/g, ""));

// "Turn on 3-D printer #3!" → "turn on 3d printer 3"
export function norm(text) {
  let s = String(text ?? "").toLowerCase().replace(/[’']/g, "'").replace(/[“”"]/g, " ");
  s = s.replace(/\b3\s*-?\s*d\b/g, "3d").replace(/\bthree\s*-?\s*d\b/g, "3d");
  s = s.replace(/\bnumber\s*#?\s*/g, "#").replace(/\bno\.\s*(?=\d)/g, "#").replace(/\bnum\s+(?=\d)/g, "#");
  s = s.replace(/[^a-z0-9#' ]+/g, " ").replace(/#\s*/g, "#");
  s = s.replace(NUM_WORD, (w) => String(ONES[w]));
  s = s.replace(/\b(\d+) (\d)\b/g, (m, a, b) => (Number(a) % 10 === 0 && Number(a) >= 20 ? String(Number(a) + Number(b)) : m));   // "twenty one"
  s = s.replace(/#(\d+)/g, " $1 ").replace(/#/g, " ");
  return s.replace(/\s+/g, " ").trim();
}
const STOP = new Set(["the", "my", "a", "an", "our", "that", "this", "please", "dayspring", "hey", "ok", "okay", "your"]);
// the words that name a thing, with ordinals moved behind the noun ("second fan" → "fan 2") and filler taken out
export function nameKey(text) {
  let s = norm(text);
  // "the second fan", "2nd fan" → "fan 2"
  const om = new RegExp(`\\b(?:the )?${ORD_WORD.source} ([a-z][a-z0-9 ]*?)$`).exec(s);
  if (om) s = s.slice(0, om.index) + `${om[2]} ${ordValue(om[1])}`;
  s = s.replace(ORD_WORD, (w) => String(ordValue(w)));
  // "fan to", "printer for": a device word then a number sound
  s = s.replace(/\b([a-z]+) (to|too|for|won|tree|free|ate)$/, (m, w, n) => (/(fan|printer|light|lamp|tv|computer|pc|monitor|strip|outlet|plug|heater|speaker|speakers)$/.test(w) ? `${w} ${HOMOPHONE[n]}` : m));
  return s.split(" ").filter((w) => w && !STOP.has(w)).join(" ").replace(/\b3d printer\b/, "3d printer").trim();
}
// a number said on its own after a noun: "fan 2" → { base: "fan", n: 2 }
export function splitNumber(key) {
  const m = /^(.*?)\s*(\d{1,3})$/.exec(key);
  return m && m[1] ? { base: m[1].trim(), n: Number(m[2]) } : null;
}
// every way to say this device's name: its name, aliases, "<type word> <n>", "<room> <type word>"
export function namesOf(d) {
  const out = new Set();
  const add = (x) => { const k = nameKey(x); if (k) out.add(k); };
  add(d.name); for (const a of d.aliases ?? []) add(a);
  const t = TYPES[d.type];
  const num = d.number ?? splitNumber(nameKey(d.name))?.n;
  if (t && num != null) for (const w of t.words) add(`${w} ${num}`);
  if (t && d.room) for (const w of t.words) add(`${d.room} ${w}`);
  if (d.type === "printer" && num != null) { add(`printer ${num}`); add(`3d printer ${num}`); }
  return [...out];
}
export const typeFromWords = (key) => {
  for (const [id, t] of Object.entries(TYPES)) for (const w of t.words) if (key === w || key === w + "s" || key.endsWith(" " + w) || key.endsWith(" " + w + "s")) return id;
  return null;
};

// Levenshtein, small and bounded (names are short)
export function lev(a, b, max = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); best = Math.min(best, cur[j]); }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// id from a name ("Fan 2" → "fan-2"), unique among `taken`
export function slug(name, taken = new Set()) {
  const base = String(name ?? "device").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "device";
  let id = base, i = 2; while (taken.has(id)) id = `${base}-${i++}`;
  return id;
}
