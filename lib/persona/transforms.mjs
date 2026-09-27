// The no-AI style engine: dialect word swaps, brief trimming, energy interjections, and the backwards-talking sage.
// Facts are sacred: numbers, times, dates, money, and capitalised names inside a sentence are never changed, and
// nothing is swapped inside them.

// word → replacement, per dialect (lowercase keys; case is restored)
export const DIALECTS = {
  drawl: { hello: "howdy", hi: "howdy", yes: "yep", "you all": "y'all", friend: "partner", going: "goin'", nothing: "nothin'", something: "somethin'", about: "'bout", them: "'em", little: "li'l", "isn't": "ain't", tired: "plumb tuckered" },
  pirate: { hello: "ahoy", hi: "ahoy", yes: "aye", my: "me", you: "ye", your: "yer", friend: "matey", friends: "mateys", is: "be", are: "be", "isn't": "be not", stop: "avast", money: "doubloons", look: "lay eyes on", the: "th'", wow: "shiver me timbers" },
  courtly: { hello: "well met", hi: "hail", yes: "aye", okay: "very well", ok: "very well", friend: "good friend", "you're": "thou art", thanks: "my thanks", goodbye: "fare thee well", maybe: "perchance", soon: "anon" },
  archaic: { hello: "greetings", yes: "aye", okay: "very well", maybe: "perchance", soon: "anon", before: "ere", often: "oft" },
  groovy: { great: "groovy", cool: "far out", awesome: "outta sight", friend: "man", good: "groovy", yes: "right on", excellent: "dy-no-mite" },
  bro: { friend: "bro", great: "sick", awesome: "legendary", yes: "yeah bro", hello: "yo", hi: "yo", good: "solid", cool: "chill" },
  noir: { money: "dough", friend: "pal", car: "jalopy", woman: "dame", police: "the coppers", yes: "sure", "look at": "get a load of" },
  butler: { yes: "indeed", okay: "very good", ok: "very good", sure: "certainly", thanks: "thank you kindly" },
  folksy: { yes: "yes, dear", great: "just wonderful", okay: "alright, sweetie" },
  zen: {},
  robot: { yes: "affirmative", no: "negative", okay: "acknowledged", ok: "acknowledged", think: "compute", hello: "greetings" },
};

// A token that must never change: digits of any kind (3:30, 10, $5, 2026, 3rd), and capitalised words that aren't the
// first word of the sentence (names). The first word keeps its case and is only swapped if it's a plain dictionary word.
const isFact = (w, i) => /\d/.test(w) || (i > 0 && /^[A-Z][a-z]+/.test(w) && !/^(I|I'm|I'll|I've)$/.test(w));

function caseLike(src, rep) {
  if (src.toUpperCase() === src && src.length > 1) return rep.toUpperCase();
  if (src[0] === src[0].toUpperCase()) return rep.charAt(0).toUpperCase() + rep.slice(1);
  return rep;
}

// stable 0..1 from a string (so the same reply always styles the same way; tests are deterministic)
export function hash01(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; }

export function dialect(text, name, flavour = 60) {
  const map = DIALECTS[name];
  if (!map || flavour < 15) return text;
  const rate = Math.min(1, flavour / 80);
  // multi-word keys first
  let out = text;
  for (const [k, v] of Object.entries(map)) {
    if (!k.includes(" ")) continue;
    out = out.replace(new RegExp(`\\b${k}\\b`, "gi"), (m) => caseLike(m, v));
  }
  return out.replace(/[A-Za-z']+/g, (w, off) => {
    const i = off === 0 || /[.!?]\s*$/.test(out.slice(0, off)) ? 0 : 1;
    if (isFact(w, i)) return w;
    const rep = map[w.toLowerCase()];
    if (!rep || hash01(text + ":" + off) > rate) return w;
    return caseLike(w, rep);
  });
}

// sentences end at . ! ? followed by a space or the end ("$45.20", "3.5" and "a.m." stay whole)
export const sentences = (t) => String(t).split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).map((s) => s.trim()).filter(Boolean);

// Brief: keep the first sentence, plus any later sentence that carries a fact (a digit) so nothing important is lost.
export function brief(text, length) {
  if (length > -50) return text;
  const s = sentences(text);
  if (s.length <= 1) return text;
  return [s[0], ...s.slice(1).filter((x) => /\d/.test(x))].join(" ");
}

const HYPE = ["Awesome!", "Oh nice!", "Woohoo!", "Okay!"], MELLOW = ["Mm.", "Alright.", "Okay."];
export function energy(text, e, seed = text) {
  if (Math.abs(e) < 60) return text;
  const pool = e > 0 ? HYPE : MELLOW;
  const pick = pool[Math.floor(hash01(seed) * pool.length)];
  if (e > 0 && !/!$/.test(text) && hash01(seed + "!") < 0.6) text = text.replace(/\.$/, "!");
  return hash01(seed + "i") < 0.5 ? `${pick} ${text}` : text;
}

// ---- the backwards-talking sage (object–subject–verb) ------------------------------------------------------------
// words that start a sentence without being a name (they lose their capital when moved to the middle)
const COMMON = /^(your|my|the|a|an|it|this|that|these|those|there|you|we|they|he|she|today|tomorrow|tonight|everything|nothing|something|someone|everyone|all|some|our|their|his|her|its|each|every|one|no)$/i;
const AUX = ["will be", "is", "are", "am", "was", "were", "will", "can", "should", "must", "has", "have", "would", "could", "might"];
const TAILS = ["Hmm.", "Yes.", "Hmmm.", "Yes, hmm."];
function oneYoda(sentence, seed) {
  const m = /^(.*?)([.!]*)$/.exec(sentence.trim());
  const body = m[1], end = m[2] || ".";
  if (/[?]/.test(sentence) || !body) return sentence;
  const words = body.split(/\s+/);
  if (words.length < 3 || words.length > 14) return sentence;
  for (const aux of AUX) {
    const aw = aux.split(" ");
    for (let i = 1; i <= words.length - aw.length - 1; i++) {
      if (aw.every((a, j) => words[i + j].toLowerCase() === a)) {
        const subj = words.slice(0, i), rest = words.slice(i + aw.length);
        if (!rest.length || subj.length > 5) return sentence;
        const restText = rest.join(" ").replace(/,$/, "");
        const subjText = subj.map((w, k) => (k === 0 && COMMON.test(w) ? w.charAt(0).toLowerCase() + w.slice(1) : w)).join(" ");
        const tail = TAILS[Math.floor(hash01(seed + body) * TAILS.length)];
        return `${restText.charAt(0).toUpperCase() + restText.slice(1)}, ${subjText} ${aw.join(" ")}${end === "!" ? "!" : "."} ${tail}`;
      }
    }
  }
  return sentence;
}
export function yoda(text, seed = "") { return sentences(text).map((s) => oneYoda(s, seed)).join(" "); }

// facts that must survive any transform: numbers/times/dates and capitalised names after the first word
export function factsOf(text) {
  const out = [];
  String(text).replace(/[A-Za-z0-9$£€:.,'%-]+/g, (w, off) => { const clean = w.replace(/[.,]+$/, ""); const first = off === 0 || /[.!?]\s*$/.test(text.slice(0, off)); if (/\d/.test(clean) || (!first && /^[A-Z][a-z]+$/.test(clean) && clean !== "I")) out.push(clean); return w; });
  return out;
}
