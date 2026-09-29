// Getting what was said ready for the command grammar (no AI): the same clean-up the intent engine uses
// (lib/intents/text.mjs: filler, contractions, number words), plus what the command grammar needs on top:
//   ordinals said as words ("the fifteenth" → "the 15th", "twenty first" → "21st")
//   common speech-to-text slips ("set a time her" → "set a timer", "turn off the whether" → "weather")
//   filler anywhere ("um", "uh", a trailing "dayspring"), and "a hundred" → 100
//   prep(text) → { raw, q }   q is lower case, no punctuation except ":" in times, "." in decimals
import { normalize } from "../intents/text.mjs";

const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30 };
export const nth = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

// "twenty first" → "21st"; "the fifteenth" → "the 15th"; "on the first of the month" → "on the 1st of the month"
// ("the first monday", "the second timer" and "first thing" keep their words: they mean something else there)
export function ordinals(s) {
  s = s.replace(/\b(20|30|twenty|thirty) (first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)\b/g, (_, t, o) => nth((t === "20" || t === "twenty" ? 20 : 30) + ORD[o]));
  s = s.replace(/\b(fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth)\b(?! (one|timer|alarm|option|choice|step|time))/g, (w) => nth(ORD[w]));
  s = s.replace(/\bthe (first|second|third|fourth)(?= of\b|$| at\b| from\b| to\b| through\b| until\b| and\b)/g, (_, w) => `the ${nth(ORD[w])}`);
  return s;
}

// what speech recognition often writes instead (and a few typing slips)
const SLIPS = [
  [/\bset a time (her|or|are|er|a)\b/g, "set a timer"], [/\b(said|sat|sit|sets|setup) (a|an|the|my) (timer|alarm|reminder)\b/g, "set $2 $3"],
  [/\btime her\b/g, "timer"], [/\ba larm\b/g, "alarm"], [/\balarm clock\b/g, "alarm"], [/\b(remained|remand|remine|reminder) me\b/g, "remind me"], [/\bremind be\b/g, "remind me"],
  [/\bwhether(?! or)\b/g, "weather"], [/\b(reign|rein|rane)\b/g, "rain"], [/\bsun set\b/g, "sunset"], [/\bsun rise\b/g, "sunrise"], [/\bthunder storm/g, "thunderstorm"],
  [/\bfogy\b/g, "foggy"], [/\bsnowy\b/g, "snow"], [/\bcalender\b/g, "calendar"], [/\bschedual\b/g, "schedule"], [/\bvolumn\b/g, "volume"],
  [/\b(wait|weight|wake up) word\b/g, "wake word"], [/\bweak ?days\b/g, "weekdays"], [/\bweek days\b/g, "weekdays"], [/\bweek nights\b/g, "weeknights"],
  [/\bevery other weak\b/g, "every other week"], [/\b24 our\b/g, "24 hour"], [/\bmilitary time\b/g, "24 hour time"], [/\btwenty four hour\b/g, "24 hour"],
  [/\btwelve hour\b/g, "12 hour"], [/\b(a|one) hundred( percent)?\b/g, (_, _a, p) => `100${p ?? ""}`], [/\bday spring\b/g, "dayspring"], [/\bdaisy spring\b/g, "dayspring"],
  [/\bbible stud(y|ie)s?\b/g, "bible study"], [/\b(tomorrow|today|tonight|yesterday)s\b/g, "$1"], [/\bmy birthdays\b/g, "my birthday is"], [/\bo clock\b/g, "oclock"], [/\bnoon time\b/g, "noon"], [/\bmid night\b/g, "midnight"],
  // "at 7 45" (a pause in the middle of a time) → "at 7:45"
  [/\b(at|for|until|till|to|by) (\d{1,2}) ([0-5]\d)\b(?! (minutes?|seconds?|hours?|days?|percent))/g, "$1 $2:$3"],
  // "7:30 in the evening" etc. are fine; "7.30" → "7:30"
  [/\b(\d{1,2})\.([0-5]\d)\s*(am|pm|a m|p m)\b/g, "$1:$2 $3"],
];
const FILLER = /\b(um+|uh+|erm+|hmm+|like um|basically|actually|just|kindly)\b/g;

export function prep(text) {
  const raw = String(text ?? "").trim();
  // (the clean-up drops "thanks" everywhere as filler; here an ending was already taken off by lib/commands/closing.mjs,
  // so a "thank you" that's left is content: "remind me to say thank you at 5")
  let q = normalize(raw.replace(/\bthank you\b/gi, "thankyouqq").replace(/\bthanks\b/gi, "thanksqq")).replace(/\bthankyouqq\b/g, "thank you").replace(/\bthanksqq\b/g, "thanks");
  for (const [re, to] of SLIPS) q = q.replace(re, to);
  q = ordinals(q);
  q = q.replace(FILLER, " ").replace(/\s+(dayspring|please|for me|now please)$/g, "").replace(/^(dayspring|please|so|and|also|then|oh)\s+/, "").replace(/\s+/g, " ").trim();
  return { raw, q };
}

// the owner's own capitals for a piece of what they said ("bible study" → "Bible study" if they typed it that way)
export function keepCase(raw, words) {
  const w = String(words ?? "").trim();
  if (!w) return w;
  const i = String(raw).toLowerCase().indexOf(w.toLowerCase());
  const got = i >= 0 ? String(raw).substr(i, w.length) : w;
  return got.charAt(0).toUpperCase() + got.slice(1);
}
export const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : s);
export const listSay = (a) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a.at(-1)}`);
