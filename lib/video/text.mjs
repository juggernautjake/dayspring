// Small text helpers for videos: the music resolver's typo-tolerant matching (lib/music/text.mjs), plus reading the
// numbers YouTube shows ("1.2M views", "3 years ago", "1:02:15") and speaking lengths and times.
export { norm, words, sim, covers, dl, sound, wordMatch, titleCase, listNames } from "../music/text.mjs";
import { norm, dl, sound } from "../music/text.mjs";

// "oney plays", "one-y plays", "OneyPlays" → "oneyplays" (names said aloud come out split in different places)
export const compact = (s) => norm(s).replace(/ /g, "");

// How alike two names are (0–1), for names said aloud: the letters without spaces, allowing a few typo steps, and the
// sound-alike key of each word ("mcarthur" / "macarthur", "winger" / "wingar").
export function nameSim(a, b) {
  const A = compact(a), B = compact(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const max = Math.max(A.length, B.length);
  const d = dl(A, B, Math.min(4, Math.ceil(max / 4)));
  const byLetters = d > 4 ? 0 : Math.max(0, 1 - d / Math.max(6, max) * 1.6);
  const sa = norm(a).split(" ").map(sound).join(""), sb = norm(b).split(" ").map(sound).join("");
  const bySound = sa && sa === sb ? 0.9 : 0;
  // one is the other with a word more ("john macarthur" / "pastor john macarthur", "oneyplays" / "oney plays official")
  const within = A.length >= 5 && B.length >= 5 && (A.includes(B) || B.includes(A)) ? 0.86 * Math.min(A.length, B.length) / max + 0.14 : 0;
  return Math.max(byLetters, bySound, within);
}

// "1:02:15" → 3735, "12:04" → 724, "" → null
export function secsOf(len) {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(String(len ?? "").trim());
  return m ? (Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) : null;
}
// "1.2M views", "12,345 views", "No views", "1.5K watching" → a number (null when unknown)
export function viewsOf(v) {
  const t = String(v ?? "").replace(/,/g, "").toLowerCase();
  if (/^no views/.test(t)) return 0;
  const m = /([\d.]+)\s*([kmb])?/.exec(t);
  if (!m) return null;
  return Math.round(Number(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2]] ?? 1));
}
// "3 years ago", "Streamed 2 days ago", "1 month ago", "2024-05-01" → days old (null when unknown)
export function ageDays(a, now = Date.now()) {
  const t = String(a ?? "").toLowerCase();
  const m = /(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/.exec(t);
  if (m) return Number(m[1]) * { second: 1 / 86400, minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 }[m[2]];
  const d = /^\d{4}-\d{2}-\d{2}/.test(t) ? Date.parse(t) : NaN;
  return Number.isFinite(d) ? Math.max(0, (now - d) / 86400000) : null;
}
// seconds → "12 minutes", "1 hour 5 minutes", "45 seconds"
export function spokenLength(s) {
  s = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const part = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (h) return m ? `${part(h, "hour")} ${part(m, "minute")}` : part(h, "hour");
  if (m) return sec && m < 5 ? `${part(m, "minute")} ${part(sec, "second")}` : part(m, "minute");
  return part(sec, "second");
}
export const mmss = (x) => { x = Math.max(0, Math.floor(Number(x) || 0)); const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), s = String(x % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`; };
export const thumbOf = (videoId) => (videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : "");

// numbers said as words: "two", "twenty five", "a" → 2, 25, 1
const NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90, first: 1, second: 2, third: 3,
  fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, couple: 2, few: 3 };
export const NUM_RE = "(\\d+(?:\\.\\d+)?|(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|ninety|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|couple|few)(?:[\\s-](?:one|two|three|four|five|six|seven|eight|nine))?)";
export function numOf(w) {
  w = String(w ?? "").trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(w)) return Number(w);
  let n = 0;
  for (const p of w.split(/[\s-]+/)) { if (NUMW[p] === undefined) return NaN; n += NUMW[p]; }
  return n;
}
// "30 seconds", "2 minutes", "1:30", "an hour and a half", "90" → seconds (NaN when there's no time in it)
export function secondsIn(x) {
  x = String(x ?? "").toLowerCase().replace(/\band\b/g, " ").replace(/\s+/g, " ").trim();
  let m;
  if ((m = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/.exec(x))) return m[3] ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
  if (/\bhalf (a|an) minute\b/.test(x)) return 30;
  if (/\bhalf an hour\b/.test(x)) return 1800;
  if (/\b(an|one|a) hour (a )?half\b|\bhour and a half\b/.test(x)) return 5400;
  if ((m = new RegExp(`${NUM_RE} ?(?:hours?|hrs?)\\b(?: ?${NUM_RE} ?(?:minutes?|mins?))?`).exec(x))) return numOf(m[1]) * 3600 + (m[2] ? numOf(m[2]) * 60 : 0);
  if ((m = new RegExp(`${NUM_RE} ?(?:minutes?|mins?)\\b(?: ?${NUM_RE}(?: ?(?:seconds?|secs?))?)?`).exec(x))) return numOf(m[1]) * 60 + (m[2] ? numOf(m[2]) : 0);
  if ((m = new RegExp(`${NUM_RE} ?(?:seconds?|secs?)\\b`).exec(x))) return numOf(m[1]);
  if ((m = /^(\d{1,5})$/.exec(x))) return Number(m[1]);
  return NaN;
}
