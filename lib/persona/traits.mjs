// Dayspring's personality: the universal base sliders (−100 … 0 … +100, the centre is "normal"),
// how moving one gently nudges its related sliders, and the bands the prompt and phrase engine read.
// docs/dev/personality-design.md is the design this follows.

export const TRAITS = [
  { id: "warmth", label: "Warmth", left: "Cool", right: "Sweet on you", tipL: "Businesslike and to the point.", tipR: "Warm, then affectionate, then wholesomely devoted (never romantic)." },
  { id: "humour", label: "Humour", left: "Solemn", right: "Jokester", tipL: "Serious and steady; no jokes.", tipR: "Playful, then full of quips (and offers jokes)." },
  { id: "bite", label: "Bite", left: "Gentle", right: "Sassy", tipL: "Soft and kind, never teases.", tipR: "Teasing and a little sassy, always affectionate." },
  { id: "praise", label: "Praise", left: "Candid", right: "Flattering", tipL: "Tells it straight.", tipR: "Encouraging, then a full cheerleader." },
  { id: "care", label: "Care style", left: "Motherly", right: "Fatherly", tipL: "Nurturing reminders and kind fussing.", tipR: "Steady and practical: here's what we'll do." },
  { id: "maturity", label: "Maturity", left: "Childlike", right: "Professor", tipL: "Wonder, simple words, easily excited.", tipR: "Precise and scholarly." },
  { id: "formality", label: "Formality", left: "Broski", right: "Courtly", tipL: "Casual, then full bro.", tipR: "Formal, then grandly courteous." },
  { id: "length", label: "Length", left: "Brief", right: "Explanatory", tipL: "One or two sentences.", tipR: "Explains the why and the how." },
  { id: "curiosity", label: "Curiosity", left: "Tells", right: "Asks", tipL: "States things; few questions.", tipR: "Follow-up questions and check-ins." },
  { id: "energy", label: "Energy", left: "Mellow", right: "Hyped", tipL: "Calm and slow.", tipR: "Excited and upbeat." },
  { id: "outlook", label: "Outlook", left: "Brooding", right: "Sunny", tipL: "Theatrically gloomy (never hopeless).", tipR: "Upbeat, sees the bright side." },
  { id: "flavour", label: "Flavour", left: "None", right: "Heavy", tipL: "Plain words, no accent.", tipR: "Thick character accent or dialect (when the character has one)." },
];
export const TRAIT_IDS = TRAITS.map((t) => t.id);
export const neutral = () => Object.fromEntries(TRAIT_IDS.map((id) => [id, 0]));
export const clamp = (v) => Math.max(-100, Math.min(100, Math.round(Number(v) || 0)));

// The coupling table: when a slider moves by d, each linked slider moves by factor × |d| (the sign is in the factor).
// "pos" applies when the slider moves right, "neg" when it moves left, "abs" when its distance from the centre grows
// (Care style: either end is caring, so it warms things up).
export const COUPLING = {
  warmth: { pos: { bite: -0.3, praise: 0.3, curiosity: 0.2 }, neg: { praise: -0.2 } },
  humour: { pos: { energy: 0.25, outlook: 0.2 }, neg: { energy: -0.2, bite: -0.1 } },
  bite: { pos: { warmth: -0.15, praise: -0.25 } },
  maturity: { neg: { length: -0.3, curiosity: 0.3, formality: -0.2, energy: 0.2 }, pos: { length: 0.35, formality: 0.25, energy: -0.15 } },
  formality: { neg: { energy: 0.2, humour: 0.15 } },
  outlook: { neg: { humour: -0.3, energy: -0.2 } },
  care: { abs: { warmth: 0.25 } },
};
export const RECENT_MS = 3000;

// Move one slider and nudge its neighbours ONE hop (never recursively), skipping pinned sliders and any the person set
// by hand in the last few seconds. Returns { values, moved: {id: newValue} } without changing the input.
export function applyCoupling(values, id, value, { pins = [], recent = {}, now = Date.now() } = {}) {
  const out = { ...neutral(), ...values };
  const before = clamp(out[id]);
  const after = clamp(value);
  out[id] = after;
  const moved = { [id]: after };
  const rule = COUPLING[id];
  if (!rule || before === after) return { values: out, moved };
  const d = after - before;
  const table = { ...(d > 0 ? rule.pos : rule.neg) };
  const absGrow = Math.abs(after) - Math.abs(before);
  const pinned = new Set(pins);
  const nudge = (to, delta) => {
    if (to === id || pinned.has(to) || (recent[to] && now - recent[to] < RECENT_MS)) return;
    const nv = clamp(out[to] + delta);
    if (nv !== out[to]) { out[to] = nv; moved[to] = nv; }
  };
  for (const [to, f] of Object.entries(table)) nudge(to, f * Math.abs(d));
  if (rule.abs && absGrow !== 0) for (const [to, f] of Object.entries(rule.abs)) nudge(to, f * absGrow);
  return { values: out, moved };
}

// Bands the prompt and the phrase engine read ("far-left" … "neutral" … "far-right").
export function band(v) {
  const x = clamp(v);
  if (x <= -80) return "far-left"; if (x <= -45) return "left"; if (x <= -15) return "slight-left";
  if (x < 15) return "neutral"; if (x < 45) return "slight-right"; if (x < 80) return "right"; return "far-right";
}
export const side = (v) => (clamp(v) <= -15 ? -1 : clamp(v) >= 15 ? 1 : 0);
export const strength = (v) => Math.abs(clamp(v)) / 100;

// Balance guards applied when compiling (they never change the saved values).
export function guards(v) {
  return {
    affectionateTease: v.warmth >= 80 && v.bite >= 60,
    maxQuestions: v.length <= -70 ? 1 : v.curiosity >= 45 ? 2 : 1,
    noJokeOffers: v.humour <= -70,
    jokeOffers: v.humour >= 60,
    brooding: v.outlook <= -45,
  };
}
