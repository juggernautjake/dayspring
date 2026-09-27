// Depth packs: the bulk of each character's voice, kept out of presets.mjs / secrets.mjs so those stay readable.
// Each pack maps a character id to:
//   phrases: { <kind>: [line | [line, cond]] }   extra lines for the 11 KINDS, plus goodNews and badNews
//              cond: "role>40", "role<-40", "time=morning|afternoon|evening|night", joined with "&" ("brooding>40&time=night")
//   riffs:   { <topic>: line }                    at least 8 topics (weather, food, work, sleep, music, sport, tech, weekend…)
//   vocab:   [word, …]                            30+ words the character reaches for
//   jokeStyle: "how it tells a joke"              one sentence, used in the AI prompt
// deepen() appends them onto the characters at load.
import heroes from "./heroes.mjs";
import classics from "./classics.mjs";
import mentors from "./mentors.mjs";
import secrets1 from "./secrets1.mjs";
import secrets2 from "./secrets2.mjs";

export const DEPTH = { ...heroes, ...classics, ...mentors, ...secrets1, ...secrets2 };
export const EXTRA_KINDS = ["goodNews", "badNews"];
export const TIMES = ["morning", "afternoon", "evening", "night"];

export function deepen(list) {
  for (const c of list) {
    const d = DEPTH[c.id];
    if (!d) continue;
    c.phrases = { ...(c.phrases ?? {}) };
    for (const [k, lines] of Object.entries(d.phrases ?? {})) c.phrases[k] = [...(c.phrases[k] ?? []), ...lines];
    if (d.riffs) c.riffs = d.riffs;
    if (d.vocab) c.vocab = d.vocab;
    if (d.jokeStyle) c.jokeStyle = d.jokeStyle;
  }
  return list;
}

// morning 5–11, afternoon 12–16, evening 17–21, night otherwise
export const timeOf = (d = new Date()) => { const h = d.getHours(); return h >= 5 && h < 12 ? "morning" : h < 17 && h >= 12 ? "afternoon" : h >= 17 && h < 22 ? "evening" : "night"; };
