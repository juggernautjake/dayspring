// Telling the assistant its name, and what to answer to, by voice or typing, with no AI:
//   "your name is Nova" · "your name is now Nova" · "I'm going to call you Nova" · "I'll call you Nova" · "call yourself Nova"
//   "from now on you're Nova" · "can I call you Nova?" · "change your name to Nova" · "rename yourself Nova" · "let's name you Nova"
//   "your new name is Computa, it's said compootah" (the pronunciation too)
//   "go back to Dayspring" · "you're not Nova anymore" · "what's your name?" · "what were you called before?"
//   "set your wake word to Computa" · "answer to Jarvis" · "add Computer as a wake word" · "remove Hey Nova"
//   "what are your wake words?" · "train my wake word" · "make the wake word less sensitive"
// Every change is read back first and only happens on a yes ("Okay, call me Nova from now on? Say yes."). "Call Nova" (a
// phone call), "call me Nova" (the owner's own name) and "my friend's name is Nova" are not about the assistant's name.
//   handle(text, { surface }) → a reply object, or null when it isn't one of these
//   parse(text) → { intent, args } | null      (dry run, for tests)
import * as naming from "../naming.mjs";
import * as wake from "../wakeword.mjs";
import { broadcast } from "../bus.mjs";
import { on as featureOn } from "../features.mjs";   // (feature "naming": beta, so in production too; off → none of this)

const W = wake.core;
const PENDING_MS = 60_000;
const pending = new Map();                 // surface → { at, yes(), no?(), ask }
export function _reset() { pending.clear(); }
export const isPending = (surface = "tv") => { const p = pending.get(surface); return Boolean(p && Date.now() - p.at < PENDING_MS); };

const YES = /^(?:yes|yeah|yep|yup|sure|ok|okay|correct|that'?s right|that is right|right|do it|go ahead|please|yes please|please do|absolutely|of course|sounds good|perfect|confirm(?:ed)?|i'?m sure|i am sure|affirmative|definitely|you bet)\b/;
const NO = /^(?:no|nope|nah|cancel|never ?mind|don'?t|do not|stop|not now|leave it|forget it|keep it|keep your name|wait)\b/;

// the words, lowercased, without the wake word, fillers and end punctuation; `raw` keeps the owner's capitals
function prep(text) {
  let raw = String(text ?? "").replace(/[‘’]/g, "'").replace(/[“”"]/g, "").replace(/\s+/g, " ").trim();
  raw = wake.strip(raw);
  raw = raw.replace(/^(?:(?:hey|hi|ok|okay|so|um|uh|well|alright|please|dayspring|actually)[,.!]?\s+)+/i, "").replace(/^(?:can you|could you|would you|will you|i want you to|i'd like you to|i would like you to)\s+(?=(?:change|set|rename|call|answer|respond|add|remove|train|stop|go|make|use|reset)\b)/i, "");
  raw = raw.replace(/[.!]+$/, "").trim();
  return { raw, q: raw.toLowerCase().replace(/\?+$/, "").trim(), question: /\?\s*$/.test(raw) };
}
// "nova right", "Nova from now on please" → "Nova"; lower-case speech ("big mike") → "Big Mike"
function cleanValue(v) {
  let s = String(v ?? "").replace(/^["'“]+|["'”.,!?]+$/g, "").trim();
  for (let i = 0; i < 3; i++) s = s.replace(/[,\s]+(?:please|from now on|starting now|now|instead|then|okay|ok|right|anymore|any more|thanks|thank you|going forward|for now|too|as well|ok\?)$/i, "").trim();
  s = s.replace(/^(?:the name |the word |just )/i, "").replace(/^["'“]+|["'”.,!?]+$/g, "").trim();
  if (s && s === s.toLowerCase()) s = W.cap(s);
  return s;
}
const PRON = /[,;.]?\s+(?:and\s+)?(?:(?:it'?s|it is|that'?s|that is|which is|you)\s+)?(?:said|pronounced|say it|sounds? like|spoken|say)\s+(?:like\s+|as\s+)?(.+)$/i;
function splitSay(v) { const m = PRON.exec(v); return m ? { value: v.slice(0, m.index), say: cleanValue(m[1]).replace(/^./, (c) => c.toUpperCase()) } : { value: v, say: null }; }
const NOT_A_NAME = /^(?:me|him|her|them|us|mom|dad|back|later|tomorrow|today|tonight|soon|again|a cab|a taxi|an uber|911|what|who|that|this|it|nothing|something|when|if|after|before|in|at|on|about|around|once|from|with|and|so|because|while|to|for|sometime|every|by|the|a|an|my|your|our|his|their|not|no|now)\b/i;
const WAKE_WORDS = "wake (?:words?|phrases?|names?)";
const listOf = (v) => String(v ?? "").split(/\s*(?:,|\bor\b|\band\b|\&)\s*/i).map(cleanValue).filter(Boolean).slice(0, 4);
const quote = (w) => `“${W.cap(w)}”`;
const andList = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");

export function parse(text) {
  const { raw, q, question } = prep(text);
  if (!q) return null;
  let m;
  // ---- questions ----
  if (/^(?:what'?s|what is|whats|tell me|say) your (?:name|first name)$|^what (?:are you called|do (?:i|we|people) call you|should (?:i|we) call you|do you call yourself|name do you go by|do you go by|is your name)$|^who am i talking to$/.test(q)) return { intent: "name.get", args: {} };
  if (/^what (?:were you|was your name|was your old name|was your original name|was your first name|did you use to be|did they call you) ?(?:called|named)? ?(?:before|originally|at first|first)?$|^what'?s your (?:original|old|real|first|previous|former|birth) name$|^what (?:was|is) your (?:original|old|real|previous|former) name$|^were you (?:always|ever) called|^did you (?:always|use to) have (?:a different|another) name/.test(q)) return { intent: "name.origin", args: {} };
  if (new RegExp(`^(?:what'?s|what is|what are|whats|tell me|list) (?:your|the|my) ${WAKE_WORDS}$|^what (?:do|should|can) (?:i|we) say to (?:wake you(?: up)?|get your attention|talk to you)$|^what do you (?:answer|respond|wake up) to$|^what wakes you(?: up)?$|^how do (?:i|we) wake you(?: up)?$`).test(q)) return { intent: "wake.get", args: {} };
  // ---- training and sensitivity ----
  if (new RegExp(`^(?:train|teach|practice|tune|calibrate)(?: you on)?(?: (?:my|your|the|a))? ${WAKE_WORDS}(?: for (.+))?$|^${WAKE_WORDS} training$|^(?:train|teach) (?:you )?(?:to hear|on) (?:my|your) (?:name|voice|wake word)$|^(?:learn|practice) my (?:voice|wake word)$|^help you (?:hear|recognize) (?:your name|my wake word|the wake word) better$`).test(q)) {
    m = /\bfor (.+)$/.exec(raw); return { intent: "wake.train", args: { word: m ? cleanValue(m[1]) : null } };
  }
  if ((m = new RegExp(`^make (?:the |your |my )?${WAKE_WORDS} (more|less) (sensitive|strict|picky|fussy|easy to trigger)$`).exec(q))) {
    const more = m[1] === "more", sensitiveWord = m[2] === "sensitive" || m[2] === "easy to trigger";
    return { intent: "wake.sensitivity", args: { dir: (more === sensitiveWord) ? "relaxed" : "strict" } };
  }
  if ((m = new RegExp(`^(?:set|change|make) (?:the |your )?(?:${WAKE_WORDS} )?sensitivity (?:to )?(strict|normal|relaxed|high|low|medium)$`).exec(q))) return { intent: "wake.sensitivity", args: { level: { high: "relaxed", low: "strict", medium: "normal" }[m[1]] ?? m[1] } };
  // ---- wake words ----
  const val = (re) => { const x = re.exec(raw); return x ? x[1] : null; };
  let v;
  if ((v = val(new RegExp(`^(?:change|set|make|switch|update) (?:your|the|my) ${WAKE_WORDS} (?:to|as|into) (.+)$`, "i")) ?? val(new RegExp(`^your (?:new )?${WAKE_WORDS} (?:is|are|should be|will be)(?: now)? (.+)$`, "i")) ?? val(/^(?:only answer to|answer only to|only respond to|respond only to|only wake (?:up )?(?:to|for|on)) (.+)$/i) ?? val(new RegExp(`^use (.+?) as (?:your|the|my) (?:only |new )?${WAKE_WORDS}$`, "i"))) !== null) {
    const words = listOf(v); if (words.length) return { intent: "wake.set", args: { words } };
  }
  if ((v = val(new RegExp(`^add (?:a |the |another |one more )?(?:new )?${WAKE_WORDS}(?: called| of|:)? (.+)$`, "i")) ?? val(new RegExp(`^add (.+?) (?:as|to) (?:a |an |your |the |my )?(?:new |another |extra )?${WAKE_WORDS}$`, "i")) ?? val(/^(?:also answer to|also respond to|also wake (?:up )?(?:to|for|on)|answer to|respond to|wake up (?:to|for|when i say)) (.+?)(?: too| as well| also)?$/i)) !== null) {
    const words = listOf(v);
    if (words.length && words.length <= 3 && !/^(?:the|a|an|my|this|that|it|me|him|her|them|your|our|his|their|these|those|what|who|any|all|every|some|email|emails|text|texts|message|messages|question)\b/i.test(words[0])
      && !words.some((w) => /'s\b|\b(?:texts?|emails?|messages?|calls?|questions?|letters?|notes?|posts?|comments?|reviews?)\b/i.test(w) || w.split(" ").length > 3)) return { intent: "wake.add", args: { words } };
  }
  if ((v = val(new RegExp(`^(?:remove|delete|drop|take off|get rid of|forget) (?:the |your |my )?${WAKE_WORDS}:? (.+)$`, "i")) ?? val(new RegExp(`^(?:remove|delete|drop|take off|get rid of) (.+?) (?:as|from) (?:a |an |your |the |my )?${WAKE_WORDS}$`, "i")) ?? val(/^(?:stop answering to|don'?t answer to|do not answer to|stop responding to|don'?t respond to|do not respond to|stop waking (?:up )?(?:to|for|on)) (.+?)(?: anymore| any more)?$/i)) !== null) {
    const w = cleanValue(v); if (w) return { intent: "wake.remove", args: { word: w, explicit: true } };
  }
  if ((m = /^(?:remove|delete|drop) (.+)$/i.exec(raw))) {
    const w = W.norm(m[1]);
    if ((wake.config().words ?? []).some((x) => x.text === w)) return { intent: "wake.remove", args: { word: cleanValue(m[1]), explicit: false } };
  }
  // ---- going back to Dayspring ----
  if (/^(?:go|change|switch|turn) back (?:to )?(?:being )?(?:dayspring|your (?:old|original|first|real|default|normal) name|the (?:old|original|default) name)$|^(?:change|set|reset|put) your name back(?: to (?:dayspring|normal|the default|the original|what it was))?$|^reset your name$|^use your (?:old|original|real|default) name(?: again)?$|^be dayspring again$|^(?:i want|let'?s go) back to dayspring$/.test(q)) return { intent: "name.reset", args: {} };
  if ((m = /^(?:you'?re|you are) (?:not|no longer) (.+?)(?: anymore| any more)?$/i.exec(raw)) || (m = /^(?:stop calling yourself|don'?t call yourself|do not call yourself) (.+?)(?: anymore| any more)?$/i.exec(raw))) {
    const who = cleanValue(m[1]);
    if (who && W.norm(who) === W.norm(naming.name())) return { intent: "name.reset", args: { from: who } };
    if (who && who.split(" ").length <= 3 && !/\b(?:sure|right|listening|helping|funny|working|making sense|a robot|real|alive|human)\b/i.test(who)) return { intent: "name.notme", args: { who } };
  }
  // ---- a new name ----
  const NAME_RES = [
    /^(?:change|set|switch|update) your name (?:to|as) (.+)$/i,
    /^rename (?:yourself|you)(?: to| as)? (.+)$/i,
    /^(?:let'?s|let us|i want to|i'd like to|i would like to|i'm going to|i am going to|i'm gonna|i'll|i will|can i|could i|may i|we'?re going to|we'll|we will|can we) (?:name|call|rename) you (.+)$/i,
    /^call yourself (.+)$/i,
    /^your (?:new )?name (?:is|will be|should be|is going to be|shall be|'s)(?: now)? (.+)$/i,
    /^your name is now (.+)$/i,
    /^(?:from now on|starting now|starting today|from today|henceforth|from here on(?: out)?)[,]? (?:you'?re|you are|your name is|you'?ll be|you will be|call yourself|i'?ll call you|i will call you|you go by|you'?re called|you are called|we'?ll call you) (.+)$/i,
    [/^(?:you'?re|you are) (?:now )?(?:called |named )?(.+?) (?:from now on|starting now|from today|now)$/i, "weak"],
    [/^(?:you'?re|you are) now (?:called |named )(.+)$/i],
    [/^(?:you'?re|you are) now (.+)$/i, "weak"],
    /^(?:go by|i want you to go by|you'?ll go by|you will go by|you can go by) (?:the name )?(.+)$/i,
    /^(?:you'?ll|you will|you shall) be (?:called|named|known as) (.+)$/i,
    /^(?:i name you|i'?m naming you|i am naming you|i dub you|i hereby name you) (.+)$/i,
  ];
  for (const entry of NAME_RES) {
    const [re, weak] = Array.isArray(entry) ? entry : [entry];
    const x = re.exec(raw); if (!x) continue;
    const { value, say } = splitSay(x[1]);
    const nm = cleanValue(value);
    if (!nm || NOT_A_NAME.test(nm) || nm.split(" ").length > 4) return null;
    // "you're now muted", "you are now in charge": the loose phrasings need something that looks like a name
    if (weak && (nm.split(" ").length > 2 || nm.split(" ").every((w) => W.COMMON.has(w.toLowerCase())) || /\b(?:in|on|off|at|muted|listening|done|ready|free|here|there|mine)\b/i.test(nm))) return null;
    // "can I call you Nova?" and "your name is Nova?" are asking, and still get read back before anything changes
    return { intent: "name.set", args: { name: nm, say, asked: question } };
  }
  return null;
}

// ---- doing it ----------------------------------------------------------------------------------------------------------------
const out = (reply, extra = {}) => ({ reply, intent: extra.intent ?? "naming", changes: [], ...extra });
function ask(surface, question, yes, extra = {}) {
  pending.set(surface, { at: Date.now(), yes, no: extra.no ?? null, ask: question });
  return out(question, { listen: true, intent: extra.intent ?? "naming.confirm", security: true });
}
// (the "assistant" event with the new wake words goes out from lib/naming-routes.mjs, on every change)
function announce() {
  try { broadcast("owner", {}); } catch { /* no screens */ }
}
const wakeShown = () => wake.display();
const firstSentence = (s) => String(s ?? "").split(/(?<=[.!?])\s/)[0];

export async function handle(text, { surface = "tv" } = {}) {
  if (surface === "call") return null;                      // a friend on a call never renames anything
  if (!featureOn("naming")) return null;
  const { q } = prep(text);
  const p = pending.get(surface);
  if (p) {
    pending.delete(surface);
    if (Date.now() - p.at < PENDING_MS) {
      if (YES.test(q)) return p.yes();
      if (NO.test(q)) return p.no ? p.no() : out("Okay, I left it alone.", { intent: "naming.no" });
    }
  }
  const cmd = parse(text);
  if (!cmd) return null;
  return exec(cmd, surface);
}

function exec({ intent, args: a }, surface) {
  const A = naming.name();
  switch (intent) {
    case "name.get": return out(naming.nameLine() + (naming.renamed() ? "" : ""), { intent });
    case "name.origin": return out(naming.originLine(), { intent });
    case "wake.get": return out(`${naming.wakeLine()} Say it first, like “${wakeShown()[0]}, what time is it?”`, { intent });
    case "name.notme": return out(`I'm not ${a.who}. I'm ${A}.`, { intent });
    case "name.reset": {
      if (!naming.renamed()) return out("I'm already Dayspring.", { intent });
      return ask(surface, `Okay, go back to being Dayspring? Say yes.`, () => rename("Dayspring", null), { intent: "name.reset" });
    }
    case "name.set": {
      const r = naming.checkName(a.name);
      if (!r.ok) return out(r.error, { intent });
      if (a.say) { const s = naming.checkSay(a.say); if (!s.ok) return out(s.error, { intent }); }
      if (r.value === A && !a.say) return out(`I'm already ${A}.`, { intent });
      const q = `Okay, call me ${r.value} from now on${a.say ? `, said “${a.say}”` : ""}? Say yes.`;
      return ask(surface, q, () => rename(r.value, a.say, surface), { intent: "name.set" });
    }
    case "wake.set": {
      const checks = a.words.map((w) => naming.checkWake(w));
      const bad = checks.find((c) => !c.ok); if (bad) return out(bad.error, { intent });
      const words = [...new Set(checks.map((c) => c.value))];
      if (words.length > naming.MAX.words) return out(`I can answer to up to ${naming.MAX.words} wake words. Pick the ones you'll really use.`, { intent });
      const warn = checks.flatMap((c) => c.warnings).map(firstSentence)[0];
      const q = `Okay, I'll answer to ${andList(words.map(quote))} instead of ${andList(wakeShown().map((w) => `“${w}”`))}?${warn ? ` ${warn}` : ""} Say yes.`;
      return ask(surface, q, () => { const res = naming.setWakeWords(words); if (!res.ok) return out(res.error, { intent }); announce(); return out(`Done. Say ${andList(words.map(quote))} when you need me.`, { intent, changes: ["owner"] }); }, { intent });
    }
    case "wake.add": {
      const checks = a.words.map((w) => naming.checkWake(w));
      const bad = checks.find((c) => !c.ok); if (bad) return out(bad.error, { intent });
      const cur = naming.view().wake.words.map((w) => w.text);
      const add = checks.map((c) => c.value).filter((w) => !cur.includes(w));
      if (!add.length) return out(`I already answer to ${andList(checks.map((c) => quote(c.value)))}.`, { intent });
      if (cur.length + add.length > naming.MAX.words) return out(`I can answer to up to ${naming.MAX.words} wake words, and I already have ${andList(cur.map(quote))}. Say “remove” and one of them first.`, { intent });
      const warn = checks.flatMap((c) => c.warnings).map(firstSentence)[0];
      const q = `Add ${andList(add.map(quote))} as a wake word, so I answer to ${andList([...cur, ...add].map(quote))}?${warn ? ` ${warn}` : ""} Say yes.`;
      return ask(surface, q, () => { const res = naming.setWakeWords([...cur, ...add]); if (!res.ok) return out(res.error, { intent }); announce(); return out(`Done. I answer to ${andList(res.wakeWords.map(quote))} now.`, { intent, changes: ["owner"] }); }, { intent });
    }
    case "wake.remove": {
      const cur = naming.view().wake.words.map((w) => w.text);
      const t = W.norm(a.word);
      const hit = cur.find((w) => w === t) ?? cur.find((w) => w.replace(/^(hey|ok|okay|hi) /, "") === t.replace(/^(hey|ok|okay|hi) /, ""));
      if (!hit) return out(`“${W.cap(a.word)}” isn't one of my wake words. I answer to ${andList(cur.map(quote))}.`, { intent });
      if (cur.length === 1) return out(`“${W.cap(hit)}” is my only wake word, so I'd never hear you. Add another one first, like “add Hey ${A} as a wake word”.`, { intent });
      const left = cur.filter((w) => w !== hit);
      return ask(surface, `Stop answering to ${quote(hit)}? I'll still answer to ${andList(left.map(quote))}. Say yes.`, () => { const res = naming.setWakeWords(left); if (!res.ok) return out(res.error, { intent }); announce(); return out(`Done. I answer to ${andList(res.wakeWords.map(quote))} now.`, { intent, changes: ["owner"] }); }, { intent });
    }
    case "wake.sensitivity": {
      const cur = naming.view().wake.sensitivity, order = ["strict", "normal", "relaxed"];
      const next = a.level ?? order[Math.max(0, Math.min(2, order.indexOf(cur) + (a.dir === "relaxed" ? 1 : -1)))];
      if (next === cur) return out(`The wake word is already ${cur}${cur === "relaxed" ? ", as easy to trigger as it goes" : cur === "strict" ? ", as strict as it goes" : ""}.`, { intent });
      naming.setSensitivity(next); announce();
      return out(next === "strict" ? "Okay, I'll be stricter: I'll only wake to the wake word itself and what training taught me." : next === "relaxed" ? "Okay, I'll be more relaxed: I'll wake to things that sound close to the wake word. Tell me if I wake up by accident." : "Okay, back to normal wake word sensitivity.", { intent, changes: ["owner"] });
    }
    case "wake.train": {
      if (!["tv", "desk", "typed", "display"].includes(surface)) return out("Wake word training runs on the Dayspring screen: say “train my wake word” there, or use Settings → Your assistant.", { intent });
      const r = naming.trainStart({ word: a.word ? W.norm(a.word) : null, from: "voice" });
      if (!r.ok) return out(r.error, { intent });
      try { broadcast("wake-train", r); } catch { /* no screens */ }
      return out(`Let's train ${quote(r.word)}. When the card says “now”, say ${quote(r.word)} on its own, ${r.want} times, with a short pause in between.`, { intent, wakeTrain: r.id });
    }
  }
  return null;
}

function rename(to, say, surface = "tv") {
  const before = naming.view();
  const r = naming.setName(to, say === undefined ? {} : { say: say ?? "" });
  if (!r.ok) return out(r.error, { intent: "name.set" });
  announce();
  const words = naming.view().wake.words.map((w) => w.text);
  if (to === "Dayspring") return out(`Okay, I'm Dayspring again!${r.wakeChanged ? ` Say “${W.cap(words[0])}” when you need me.` : ""}`, { intent: "name.set", changes: ["owner"] });
  if (r.followsName || r.wakeChanged) return out(`Great, I'm ${r.name} now! Say “${W.cap(words[0])}” when you need me.`, { intent: "name.set", changes: ["owner"] });
  // the owner picked their own wake words: they stay, and it asks about answering to the new name too
  const newWake = W.norm(r.name);
  if (words.includes(newWake) || words.length >= naming.MAX.words || !naming.checkWake(newWake).ok) return out(`Great, I'm ${r.name} now! I still answer to ${andList(words.map(quote))}.`, { intent: "name.set", changes: ["owner"] });
  void before;
  return ask(surface, `Great, I'm ${r.name} now! Want me to answer to “${r.name}” too? Right now I answer to ${andList(words.map(quote))}.`, () => {
    const res = naming.setWakeWords([...words, newWake]);
    if (!res.ok) return out(res.error, { intent: "wake.add" });
    announce();
    return out(`Done. I answer to ${andList(res.wakeWords.map(quote))} now.`, { intent: "wake.add", changes: ["owner"] });
  }, { intent: "name.set", no: () => out(`Okay. I'll keep answering to ${andList(words.map(quote))}.`, { intent: "wake.add" }) });
}
