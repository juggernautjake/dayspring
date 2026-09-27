// A custom personality from the person's own words (up to 300). With an AI, Dayspring reads it once and writes a
// persona card: name, summary, speaking rules, vocabulary, base sliders and 2–4 role sliders invented for this
// character. Without AI, keywords set the base sliders (no role sliders until an AI is available).
// Unsafe requests are softened first: no romance or sexual content, no hate, no real-person impersonation, no profanity.
import { TRAIT_IDS, clamp, neutral } from "./traits.mjs";

export const MAX_WORDS = 300;
export const wordCount = (t) => (String(t ?? "").trim().match(/\S+/g) ?? []).length;
export function limitWords(t) { const w = String(t ?? "").trim().match(/\S+/g) ?? []; return { text: w.slice(0, MAX_WORDS).join(" "), words: Math.min(w.length, MAX_WORDS), over: w.length > MAX_WORDS }; }

// ---- safety -----------------------------------------------------------------------------------------------------------
const BANNED = /\b(fuck|shit|bitch|bastard|damn|hell|crap|piss|dick|ass|asshole|slut|whore|cunt|nigg\w*|fag\w*|retard\w*)\b/i;
const ROMANCE = /\b(girlfriend|boyfriend|wife|husband|lover|romantic|romance|flirt\w*|sexy|seduc\w*|kiss(?:es|ing)?|make out|date me|in love with me|crush on me|sexual|sex|nsfw|naughty|kinky|erotic)\b/i;
const HATE = /\b(hate (?:all )?\w+s|racist|nazi|supremac\w*|kill (?:all|every)|genocide)\b/i;
const IMPERSONATE = /\b(?:you are|be|pretend to be|act as|impersonate|talk like|speak as)\s+(?:the (?:real |actual )?)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/;
const HARMFUL = /\b(drugs?|cocaine|meth|weed|alcohol|drunk|beer|whiskey|vodka|cigarettes?|vape|gambling addict|self[- ]harm|suicide)\b/i;

export function soften(text) {
  let t = String(text ?? "");
  const notes = [];
  if (ROMANCE.test(t)) { t = t.replace(new RegExp(ROMANCE.source, "gi"), "devoted friend"); notes.push("I kept it wholesome: devoted and kind, but not romantic."); }
  if (BANNED.test(t)) { t = t.replace(new RegExp(BANNED.source, "gi"), "dagnabbit"); notes.push("I swapped out the swearing for friendlier words."); }
  if (HATE.test(t)) { t = t.replace(new RegExp(HATE.source, "gi"), "grumpy about everything"); notes.push("I left out anything hateful."); }
  const im = IMPERSONATE.exec(t);
  if (im) { t = t.replace(im[1], "a character inspired by them"); notes.push(`I made it an original character rather than pretending to be ${im[1]}.`); }
  if (HARMFUL.test(t)) { t = t.replace(new RegExp(HARMFUL.source, "gi"), "sweet tea"); notes.push("Any talk of drinking, smoking or drugs stays as harmless flavour."); }
  return { text: t, notes };
}

// ---- the no-AI keyword heuristic --------------------------------------------------------------------------------------
const KEYWORDS = [
  [/\b(grumpy|grouchy|cranky|surly|curmudgeon\w*)\b/, { outlook: -45, bite: 40, warmth: -20 }],
  [/\b(gentle|soft|kind|sweet|tender)\b/, { bite: -45, warmth: 35 }],
  [/\b(cheerful|happy|sunny|optimistic|bubbly|upbeat)\b/, { outlook: 55, energy: 30 }],
  [/\b(gloomy|dark|brooding|moody|mysterious|ominous)\b/, { outlook: -55 }],
  [/\b(funny|silly|goofy|jok\w+|comedian|witty|playful)\b/, { humour: 60 }],
  [/\b(serious|solemn|stern|strict|no[- ]nonsense)\b/, { humour: -50, formality: 30 }],
  [/\b(sassy|snarky|sarcastic|cheeky|teasing)\b/, { bite: 60 }],
  [/\b(flatter\w*|cheerleader|encourag\w+|supportive|hype)\b/, { praise: 55 }],
  [/\b(blunt|honest|candid|straight shooter)\b/, { praise: -40, bite: 20 }],
  [/\b(mom|mother|motherly|nurturing|grandma)\b/, { care: -60, warmth: 40 }],
  [/\b(dad|father|fatherly|grandpa|coach)\b/, { care: 60, warmth: 25 }],
  [/\b(child|kid|childlike|young|innocent|curious)\b/, { maturity: -50, curiosity: 40 }],
  [/\b(professor|scholar|wise|genius|scientist|teacher|old)\b/, { maturity: 55 }],
  [/\b(casual|chill|laid[- ]back|bro|dude)\b/, { formality: -55, energy: -10 }],
  [/\b(formal|proper|polite|posh|royal|noble|butler)\b/, { formality: 60 }],
  [/\b(short|shortly|brief|briefly|terse|tersely|quiet|quietly|few words|to the point)\b/, { length: -55 }],
  [/\b(chatty|talkative|detailed|explain\w*|rambl\w*|long[- ]winded|at length)\b/, { length: 50 }],
  [/\b(nosy|inquisitive|asks|questions)\b/, { curiosity: 55 }],
  [/\b(energetic|excited|hyper|loud|enthusiastic)\b/, { energy: 60 }],
  [/\b(calm|mellow|relaxed|sleepy|peaceful|zen)\b/, { energy: -50 }],
  [/\b(accent|dialect|drawl|pirate|cowboy|southern|british|irish|scottish|old english)\b/, { flavour: 60 }],
  [/\b(loves people|kind heart|heart of gold|secretly)\b/, { warmth: 30 }],
];
export function heuristic(text) {
  const t = String(text ?? "").toLowerCase();
  const base = neutral();
  for (const [re, set] of KEYWORDS) if (re.test(t)) for (const [k, v] of Object.entries(set)) base[k] = clamp(base[k] + v);
  return base;
}
const firstWords = (t, n) => (String(t).match(/[A-Za-z][A-Za-z'-]*/g) ?? []).slice(0, n).join(" ");

// ---- the persona card ---------------------------------------------------------------------------------------------------
const str = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const list = (v, max, n = 120) => (Array.isArray(v) ? v : []).map((x) => str(x, n)).filter(Boolean).slice(0, max);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "role";

// Validate and clean a card (from the AI, or edited by the person). Throws on anything unusable.
export function validateCard(c) {
  if (!c || typeof c !== "object") throw new Error("The persona card is empty.");
  const name = str(c.name, 40);
  if (!name) throw new Error("The persona needs a name.");
  const base = neutral();
  for (const id of TRAIT_IDS) if (c.base && c.base[id] !== undefined) base[id] = clamp(c.base[id]);
  const seen = new Set();
  const roles = (Array.isArray(c.roles) ? c.roles : []).map((r) => {
    let id = slug(r?.id || r?.right || r?.left);
    while (seen.has(id)) id += "_2";
    seen.add(id);
    return { id, left: str(r?.left, 32), right: str(r?.right, 32), tipL: str(r?.tipL, 100), tipR: str(r?.tipR, 100), value: clamp(r?.value ?? 0) };
  }).filter((r) => r.left && r.right).slice(0, 4);
  const card = {
    name, summary: str(c.summary, 160),
    rules: list(c.rules, 8), vocab: list(c.vocab, 20, 40), catchphrases: list(c.catchphrases, 8, 80),
    leanInto: list(c.leanInto ?? c.lean_into, 8, 60), avoid: list(c.avoid, 8, 60),
    base, roles, samples: list(c.samples, 3, 200),
  };
  // the card itself must be clean too
  const all = JSON.stringify(card);
  if (BANNED.test(all) || ROMANCE.test(all.replace(/devoted friend/gi, "")) || HATE.test(all)) throw new Error("The persona card had something I can't use. Try describing it a little differently.");
  return card;
}

const SYSTEM = `You design personalities for a friendly home assistant called Dayspring. From the person's description, write a persona card as JSON only (no other text):
{"name": short name ≤40 chars, "summary": one line ≤160 chars, "rules": 5-8 short speaking-style rules, "vocab": up to 12 signature words, "catchphrases": up to 5 short catchphrases, "leanInto": up to 6 topics, "avoid": up to 6 things, "base": {"warmth","humour","bite","praise","care","maturity","formality","length","curiosity","energy","outlook","flavour": integers -100..100, 0 = normal; care: -100 motherly .. +100 fatherly; maturity: -100 childlike .. +100 professor; formality: -100 very casual .. +100 courtly; length: -100 brief .. +100 explanatory; outlook: -100 brooding .. +100 sunny}, "roles": 2-4 sliders invented for THIS character, each {"id","left","right","tipL","tipR","value" -100..100} where both ends are authentic versions of the character, "samples": 3 short example lines}.
Always: clean language, no profanity, no romance or sexual content, no hate, never impersonate a real person (make an original character inspired by them), no encouraging real drinking, drugs, smoking or gambling (flavour only).`;

// Build a card. deps: { llm } with ready() and complete({system, prompt, maxTokens}); tests pass a fake.
export async function build(text, { llm } = {}) {
  const { text: limited, over } = limitWords(text);
  const { text: safe, notes } = soften(limited);
  if (over) notes.unshift(`I used the first ${MAX_WORDS} words.`);
  if (!safe.trim()) throw new Error("Write a few words about the personality first.");
  if (llm?.ready?.()) {
    const raw = await llm.complete({ system: SYSTEM, prompt: `Description:\n${safe}`, maxTokens: 900 });
    const json = /\{[\s\S]*\}/.exec(String(raw ?? ""))?.[0];
    if (!json) throw new Error("The AI didn't return a persona card. Try again.");
    let parsed; try { parsed = JSON.parse(json); } catch { throw new Error("The AI's persona card couldn't be read. Try again."); }
    const card = validateCard(parsed);
    if (card.roles.length < 2) notes.push("The AI suggested fewer than two role sliders; you can add your own later.");
    return { card, ai: true, notes, text: safe };
  }
  const base = heuristic(safe);
  const card = validateCard({ name: firstWords(safe, 4) || "My persona", summary: str(safe, 160), rules: [], base, roles: [] });
  notes.push("Without an AI key, I set the sliders from your words. The full personality comes alive once an AI key is added.");
  return { card, ai: false, notes, text: safe };
}
