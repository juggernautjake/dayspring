// Turning what someone said (or typed) into clean, comparable words, with no AI:
//   normalize()  "Hey Dayspring, could you please set a timer for ten minutes?" → "set a timer for 10 minutes"
//   canon()      the words each synonym group shares ("launch" → "open", "calendar" → "schedule")
//   phonetic()   a sound-alike key, so "set a time her" still lands on "set a timer"
//   near()       small typos ("remnd", "calender") are fixed against the words the catalogue knows
import { strip as wakeStrip } from "../wakeword.mjs";

const FILLER_LEAD = [
  "hey dayspring", "hi dayspring", "ok dayspring", "okay dayspring", "yo dayspring", "dayspring", "day spring",
  "hey there", "hey", "hi", "ok so", "okay so", "ok", "okay", "alright", "all right", "so", "um", "uh", "hmm", "well", "yo", "please",
  "can you please", "could you please", "would you please", "will you please", "can you", "could you", "would you", "will you",
  "i want you to", "i would like you to", "i'd like you to", "i need you to", "go ahead and", "i want to", "i would like to", "i'd like to",
  "i need to", "let me", "help me", "can i", "could i", "i wanna", "do me a favor and", "quick question", "real quick",
];
const FILLER_ANY = /\b(um+|uh+|erm|hmm+|please|pls|plz|kindly|real quick|right now please|for me|thanks|thank you)\b/g;
// a wake word at the start comes off (only there: "my computer is slow" keeps its "computer")
const stripWake = (s) => { try { const r = wakeStrip(s); return r && r !== s ? r.toLowerCase() : s; } catch { return s; } };

const CONTRACTIONS = [
  [/\bwhat'?s\b/g, "what is"], [/\bwhere'?s\b/g, "where is"], [/\bwhen'?s\b/g, "when is"], [/\bwho'?s\b/g, "who is"], [/\bhow'?s\b/g, "how is"],
  [/\bthat'?s\b/g, "that is"], [/\bthere'?s\b/g, "there is"], [/\bhere'?s\b/g, "here is"], [/\bit'?s\b/g, "it is"], [/\blet'?s\b/g, "let us"],
  [/\bi'?m\b/g, "i am"], [/\bi'?ve\b/g, "i have"], [/\bi'?ll\b/g, "i will"], [/\bi'?d\b/g, "i would"], [/\byou'?re\b/g, "you are"], [/\bwe'?re\b/g, "we are"],
  [/\bthey'?re\b/g, "they are"], [/\bcan'?t\b/g, "cannot"], [/\bwon'?t\b/g, "will not"], [/\bdon'?t\b/g, "do not"], [/\bdoesn'?t\b/g, "does not"],
  [/\bdidn'?t\b/g, "did not"], [/\bisn'?t\b/g, "is not"], [/\baren'?t\b/g, "are not"], [/\bwasn'?t\b/g, "was not"], [/\bshouldn'?t\b/g, "should not"],
  [/\bwanna\b/g, "want to"], [/\bgonna\b/g, "going to"], [/\bgotta\b/g, "got to"], [/\bgimme\b/g, "give me"], [/\blemme\b/g, "let me"], [/\bwhatcha\b/g, "what are you"],
  [/\bya\b/g, "you"], [/\bu\b/g, "you"], [/\br\b/g, "are"], [/\bpls\b/g, "please"], [/\btmrw\b|\btmr\b|\btomorow\b|\btommorow\b|\btommorrow\b/g, "tomorrow"], [/\btonite\b/g, "tonight"],
  [/\bmins?\b/g, "minutes"], [/\bhrs?\b/g, "hours"], [/\bsecs?\b/g, "seconds"], [/\bo'?clock\b/g, "oclock"],
];

const ONES = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
// "twenty five" → 25, "one hundred and twenty" → 120, "two thousand" → 2000 (words left alone when they aren't a number)
export function wordsToNumbers(s) {
  const toks = s.split(" "); const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!(t in ONES || t in TENS || t === "hundred" || t === "thousand")) { out.push(t); continue; }
    // "one" before a noun that isn't a quantity is usually "a": keep it a number anyway (timers, verses)
    let total = 0, cur = 0, j = i, used = false;
    while (j < toks.length) {
      const w = toks[j];
      if (w in ONES) { cur += ONES[w]; used = true; }
      else if (w in TENS) { cur += TENS[w]; used = true; }
      else if (w === "hundred" && used) cur *= 100;
      else if (w === "thousand" && used) { total += cur * 1000; cur = 0; }
      else if (w === "and" && used && (toks[j + 1] in ONES || toks[j + 1] in TENS) && toks[j - 1] === "hundred") { /* "one hundred and five" */ }
      else break;
      j++;
    }
    if (!used) { out.push(t); continue; }
    out.push(String(total + cur)); i = j - 1;
  }
  return out.join(" ");
}

// The spelling-free, filler-free, contraction-free lower-case form. Keeps digits, ":" in times, "." in decimals, "%".
export function normalize(text, { keepWhole = true } = {}) {
  let s = ` ${String(text ?? "").toLowerCase()} `
    .replace(/[‘’‛′]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, " - ")
    .replace(/(\d),(\d{3})\b/g, "$1$2")                               // 1,000 → 1000
    .replace(/(\d)\s*%/g, "$1 percent");
  for (const [re, to] of CONTRACTIONS) s = s.replace(re, to);
  s = s.replace(/'s\b/g, "s").replace(/[^a-z0-9:.\-+*/^ ]+/g, " ").replace(/(?<!\d)\.|\.(?!\d)/g, " ").replace(/(?<![\d])-|-(?![\d])/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = wordsToNumbers(s);
  s = s.replace(/\b(\d+) and a half\b/g, (_, n) => String(Number(n) + 0.5)).replace(/\ba half\b/g, "half").replace(/\bhalf an? hour\b/g, "30 minutes");
  // fillers at the start, repeatedly ("hey dayspring can you please …")
  const whole = s;          // "thank you", "hi", "hey there": all filler, but that IS what they said
  s = stripWake(s);         // the owner's own name and wake words too ("hey nova …", "computa …": lib/wakeword.mjs)
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of FILLER_LEAD) if (s === f || s.startsWith(f + " ")) { s = s.slice(f.length).trim(); changed = true; }
  }
  s = s.replace(FILLER_ANY, " ").replace(/\s+/g, " ").trim();
  return s || (keepWhole ? whole : "");
}

// Synonym groups: the first word is what the group becomes. Longer phrases are replaced before shorter ones.
export const SYNONYMS = [
  ["open", "launch", "start up", "fire up", "boot up", "load up", "bring up the app", "pull up the app"],
  ["show", "display", "pull up", "bring up", "let me see", "let me look at", "give me a look at", "view", "see"],
  ["delete", "remove", "erase", "get rid of", "scratch", "drop", "take off", "wipe"],
  ["cancel", "call off", "abort", "stop the"],
  ["add", "put", "schedule", "book", "pencil in", "set up", "plan", "slot in", "throw on", "stick"],
  ["move", "reschedule", "shift", "bump", "change the time of", "rearrange"],
  ["schedule", "calendar", "agenda", "planner", "itinerary", "lineup", "line up"],
  ["event", "appointment", "meeting", "block", "thing", "item", "activity", "engagement", "commitment"],
  ["timer", "countdown", "kitchen timer", "egg timer"],
  ["alarm", "wake up alarm", "wakeup alarm", "wake me up", "wake me"],
  ["reminder", "remind"],
  ["louder", "volume up", "raise the volume", "increase the volume", "up the volume"],
  ["quieter", "softer", "volume down", "lower the volume", "decrease the volume", "less loud", "too loud"],
  ["mute", "silence", "shush", "hush"],
  ["weather", "forecast", "temperature outside", "outside temperature", "temp outside", "conditions outside"],
  ["music", "songs", "song", "tunes", "track", "tracks", "jams"],
  ["next", "skip", "skip ahead", "next one"],
  ["previous", "go back a song", "last song", "back one"],
  ["pause", "hold on", "freeze"],
  ["resume", "unpause", "continue playing", "keep playing"],
  ["time", "the time", "current time", "time right now", "time now", "hour"],
  ["today", "this day"],
  ["tonight", "this evening", "later tonight"],
  ["shopping list", "grocery list", "groceries", "shopping", "grocery"],
  ["to do list", "todo list", "to do", "todo", "task list", "tasks", "chores list"],
  ["note", "memo", "jot", "jot down", "write down", "make a note"],
  ["bible", "scripture", "scriptures", "word of god"],
  ["verse", "passage", "verses"],
  ["read", "recite", "quote", "read me", "read out"],
  ["what is", "whats", "what", "tell me", "do you know", "say"],
  ["how much time", "how long", "how much longer", "how many minutes"],
  ["settings", "preferences", "options", "setup", "configuration", "config"],
  ["help", "guide", "manual", "instructions", "user guide"],
  ["quit", "exit", "close yourself", "shut down"],
  ["joke", "something funny", "a funny one", "make me laugh"],
  ["fact", "fun fact", "something interesting", "trivia"],
  ["flip a coin", "coin flip", "heads or tails", "toss a coin", "coin toss"],
  ["roll", "throw", "toss"],
  ["dice", "die", "a d6"],
  ["calculate", "compute", "work out", "figure out", "solve", "math"],
  ["convert", "translate"],
  ["spell", "spelling of", "how do you spell", "how is spelled"],
  ["stopwatch", "stop watch", "time me"],
  ["compact", "small", "smaller", "mini", "minimize to mini", "shrink"],
  ["full screen", "fullscreen", "bigger", "maximize", "expand", "big screen"],
];
const SYN_MAP = []; // [phrase, canon] longest first
for (const g of SYNONYMS) for (const w of g.slice(1)) SYN_MAP.push([w, g[0]]);
SYN_MAP.sort((a, b) => b[0].length - a[0].length);
const SYN_RE = SYN_MAP.map(([w, c]) => [new RegExp(`(^| )${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?= |$)`, "g"), `$1${c}`]);
export function canon(s) { let t = ` ${s} `; for (const [re, to] of SYN_RE) t = t.replace(re, to); return t.replace(/\s+/g, " ").trim(); }

export const STOP = new Set("a an the to of for my me i you your is are be it this that on in at and or with please can could would will just some".split(" "));
export const tokens = (s) => String(s).split(" ").filter(Boolean);

// A small sound-alike key: consonant skeleton with common sound merges ("timer"/"time her" → "TMR"; "phone"/"fone" → "FN")
export function phonetic(word) {
  let w = String(word).toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return "";
  if (/^\d/.test(word)) return word;
  w = w.replace(/^kn|^gn|^pn|^wr/, (m) => m[1]).replace(/ph/g, "f").replace(/ck/g, "k").replace(/q/g, "k").replace(/x/g, "ks").replace(/wh/g, "w")
    .replace(/sch/g, "sk").replace(/sh/g, "x").replace(/ch/g, "x").replace(/th/g, "0").replace(/dg/g, "j").replace(/c(?=[iey])/g, "s").replace(/c/g, "k")
    .replace(/z/g, "s").replace(/v/g, "f").replace(/gh(?![aeiou])/g, "").replace(/g(?=[iey])/g, "j").replace(/d$/g, "t").replace(/(.)\1+/g, "$1");
  const first = w[0];
  const rest = w.slice(1).replace(/[aeiouyhw]/g, "");
  return (/[aeiou]/.test(first) ? "A" : first.toUpperCase()) + rest.toUpperCase();
}

export function lev(a, b, max = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  // optimal string alignment: two letters swapped ("cancle" → "cancel") count as one slip
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[b.length];
}
