// Speech styles for the secret characters (no AI). Every one keeps the facts: numbers, times and names are never
// changed; when a style can't be applied without losing something, the plain text comes back instead.
import { hash01, sentences } from "./transforms.mjs";

const pick = (arr, seed) => arr[Math.floor(hash01(seed) * arr.length)];
const COMMON = /^(your|my|the|a|an|it|this|that|these|those|there|you|we|they|today|tomorrow|tonight|everything|nothing|something|all|some|our|their|his|her|its|each|every|one|no|i)$/i;
const lowerFirst = (s) => { const w = s.split(" ")[0]; return COMMON.test(w) && w !== "I" ? s.charAt(0).toLowerCase() + s.slice(1) : s; };

// ---- syllables (a heuristic that's good enough for everyday English; digits are read out) --------------------------
const NUM_SYL = { 0: 2, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 2, 8: 1, 9: 1 };
export function syllables(word) {
  const w = String(word).toLowerCase();
  if (/\d/.test(w)) { const d = w.replace(/\D/g, ""); if (/^\d{1,2}:\d{2}/.test(w)) return 3; return Math.max(1, Math.min(4, [...d].reduce((a, c) => a + (NUM_SYL[c] ?? 1), 0))); }
  const x = w.replace(/[^a-z]/g, "");
  if (!x) return 0;
  if (x.length <= 3) return 1;
  let s = (x.replace(/(?:[^laeiouy]|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g) ?? []).length;
  if (/le$/.test(x) && !/[aeiouy]le$/.test(x)) s++;
  return Math.max(1, s);
}
export const lineSyllables = (line) => String(line).split(/\s+/).filter(Boolean).reduce((a, w) => a + syllables(w), 0);

// fillers by syllable count (each counted with the same heuristic, so the lines always add up)
const FILLERS = { 1: ["oh", "ah", "yes"], 2: ["softly", "gently", "slowly"], 3: ["like the wind", "in the hush", "quietly"], 4: ["as petals fall", "beneath the sky", "the pond is still"], 5: ["under the pale moon", "the leaves drift slowly", "the wind is calm now"] };
function filler(n, seed) {
  if (n <= 0) return "";
  const out = [];
  while (n > 0) { const k = Math.min(5, n); const opts = FILLERS[k].filter((f) => lineSyllables(f) === k); out.push(pick(opts.length ? opts : FILLERS[1], seed + n)); n -= k; }
  return out.join(" ");
}
// 5-7-5: split the words into three runs whose syllables fit, then top each line up with a filler. Too long → plain.
export function haiku(text, seed = "") {
  const words = String(text).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const syl = words.map(syllables);
  const total = syl.reduce((a, b) => a + b, 0);
  if (!words.length || total > 17) return text;
  const want = [5, 7, 5];
  // first choice: fill each line as full as it goes, in order (the words read naturally; fillers trail at the end)
  {
    const lines = [[], [], []], sums = [0, 0, 0];
    let k = 0, ok = true;
    for (let w = 0; w < words.length; w++) {
      while (k < 3 && sums[k] + syl[w] > want[k]) k++;
      if (k >= 3) { ok = false; break; }
      lines[k].push(words[w]); sums[k] += syl[w];
    }
    if (ok) {
      const out = lines.map((p, i) => [p.join(" "), filler(want[i] - sums[i], seed + i)].filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
      if (out.every((l, i) => lineSyllables(l) === want[i])) return out.join(" / ");
    }
  }
  // try every split point (i, j): words[0..i) | [i..j) | [j..n)
  for (let i = 0; i <= words.length; i++) for (let j = i; j <= words.length; j++) {
    const parts = [words.slice(0, i), words.slice(i, j), words.slice(j)];
    const sums = parts.map((p, k) => p.reduce((a, _, m) => a + syl[(k === 0 ? 0 : k === 1 ? i : j) + m], 0));
    if (sums.every((s, k) => s <= want[k])) {
      const lines = parts.map((p, k) => [p.join(" "), filler(want[k] - sums[k], seed + k)].filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
      if (lines.every((l, k) => lineSyllables(l) === want[k])) return lines.join(" / ");
    }
  }
  return text;
}

// A limerick: A-lines are fixed frames that rhyme; the facts ride in the two short B-lines. Long text → plain.
const A1 = ["A message for you, if I may:", "There's news that I'm happy to say:", "Here's word from me to you today:"];
const A2 = ["It's all set up just the right way.", "So that's how it stands for today.", "And that's the whole thing, by the way."];
const A3 = ["So there, hip-hip-hip-hooray!", "And now, have a wonderful day!", "That's all, and I'm on my way!"];
export function limerick(text, seed = "") {
  const t = String(text).replace(/\s+/g, " ").trim();
  const words = t.split(" ");
  if (!t || words.length > 22) return t;
  const mid = Math.ceil(words.length / 2);
  const b1 = words.slice(0, mid).join(" "), b2 = words.slice(mid).join(" ");
  const lines = [pick(A1, seed + "1"), pick(A2, seed + "2"), b1, b2 || "…and that's it!", pick(A3, seed + "3")];
  return lines.join(" / ");
}
export const rhymesA = (poem) => { const l = poem.split(" / "); const end = (s) => s.replace(/[^a-z ]/gi, "").trim().split(" ").pop().toLowerCase().slice(-2); return l.length === 5 && end(l[0]) === end(l[1]) && end(l[1]) === end(l[4]); };

// ---- the others: light, fact-safe decorations -------------------------------------------------------------------------
const CAVE_DROP = new Set(["the", "a", "an", "is", "are", "was", "were", "will", "be", "been", "that", "just", "really", "very", "going", "gonna", "so"]);
function caveman(t, seed) {
  const out = sentences(t).map((s) => s.split(" ").filter((w) => /\d/.test(w) || !CAVE_DROP.has(w.toLowerCase().replace(/[^a-z]/g, "")) || !w.replace(/[^a-z]/gi, "")).join(" ")).join(" ");
  return hash01(seed + "u") < 0.5 ? `Ugg. ${out}` : out;
}
const wrap = (pre, post) => (t, seed) => `${pre ? pick(pre, seed + "p") + " " : ""}${t}${post ? " " + pick(post, seed + "s") : ""}`;
function narrator(t, seed) {
  const s = t.replace(/\byou(?=\b)/g, "the human").replace(/\bYou\b(?=\s)/g, "The human").replace(/\byour\b/g, "the human's").replace(/\bYour\b/g, "The human's");
  return `${pick(["And here…", "Observe…", "Quietly now…", "Remarkable…"], seed + "n")} ${lowerFirst(s)}`;
}
const sportscaster = wrap(["AND…", "HERE WE GO!", "UNBELIEVABLE!"], ["WHAT A PLAY!", "AND THE CROWD GOES WILD!", "INCREDIBLE!"]);
const gangster = (t, seed) => `${t.replace(/\.$/, "")}, see?`.replace(/\?, see\?$/, "? See?");
const alien = wrap(["Greetings, Earthling.", "Earthling,", "Attention, Earthling:"], ["Fascinating custom.", "Logging this for the mothership.", ""]);
const soap = (t, seed) => `${pick(["*gasps*", "Oh…", "*dramatic pause*"], seed + "g")} ${t.replace(/\. (?=[A-Z])/g, "… ")} ${pick(["How could this be?!", "I can't believe it!", "…Everything has changed."], seed + "h")}`;
const cat = wrap(["Meow.", "*yawns*", ""], ["", "Purr.", "Now leave me alone."]);
const dog = (t, seed) => `${pick(["WOOF!", "Oh boy oh boy!", "Yes yes yes!"], seed + "d")} ${t.replace(/\.$/, "!")} ${pick(["Is that a squirrel?!", "Walk?!", "Good boy!"], seed + "e")}`;
const gps = (t, seed) => `${pick(["In 200 feet,", "Continue straight:", "Turn left, then:"], seed + "g")} ${lowerFirst(t)} ${pick(["Recalculating…", "You have arrived.", "Proceed to the route."], seed + "r")}`;
const radio = wrap(["Good evening, ladies and gentlemen!", "This just in:", "We interrupt this program:"], ["Stay tuned, folks!", "Back to you in the studio.", "Same time, same station!"]);
const viking = wrap(["By the hammer!", "SKOL!", "Hear me, shieldmate!"], ["To glory!", "Tonight, we feast!", ""]);
const madsci = wrap(["Excellent…", "Behold!", ""], ["Mwahaha!", "IT'S ALIVE!", "Science!"]);
const sloth = (t) => t.split(" ").filter(Boolean).map((w) => w.replace(/[.,!;]+$/, "")).join("… ") + "…";

export const STYLES = { caveman, haiku: (t, s) => haiku(t, s), limerick: (t, s) => limerick(t, s), narrator, sportscaster, gangster, alien, soap, cat, dog, gps, radio, viking, madsci, sloth };
export function applyStyle(name, text, seed = "") {
  const fn = STYLES[name];
  if (!fn) return text;
  return String(fn(String(text), seed)).replace(/\s{2,}/g, " ").trim();
}
