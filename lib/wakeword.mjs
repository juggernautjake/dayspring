// The wake words, on the server: public/wakeword.js (the same matching the Dayspring screen uses) with the owner's own
// settings (data/owner.json: the name, how to say it, up to 3 wake words, "also accept" words, what training learned,
// how sensitive). Everything that listens for the name calls this, so they all hear it the same way:
//   the screen (/api/tv/config → wakeConfig()) · Tune in and calls (regexLike) · the Discord bot (wakeCommand) ·
//   meetings (meetNames, match) · the offline intents ("Hey Nova, set a timer" → strip) · the local speech engine (hint)
//
//   config()          → { name, say, sensitivity, followsName, words: [{ text, say, also, trained }], extra }
//   match(text, opts) → { index, end, wake, rest, before, score, how, phrase, atStart } | null
//   matchAny(alternatives) · strip(text) · wakeCommand(text) · regexLike() · hint() · meetNames() · clientConfig()
import "../public/wakeword.js";
import * as owner from "./owner.mjs";

export const core = globalThis.dsWake;
const W = core;

// "hey computa" said the way the name is said ("compootah"): the name's pronunciation goes into the wake words that use it
function sayFor(word, name, say) {
  if (!say) return "";
  const n = W.norm(name), w = W.norm(word);
  if (!n || !w.split(" ").join(" ").includes(n)) return "";
  return (" " + w + " ").replace(" " + n + " ", " " + W.norm(say) + " ").trim();
}
// DAYSPRING_WAKE_PHRASES in .env (older setups wrote it): extra phrases that also wake it, never instead of Settings
function envExtra(words) {
  const raw = process.env.DAYSPRING_WAKE_PHRASES; if (!raw) return [];
  const mine = new Set(words.flatMap((w) => [w, `hey ${w}`]));
  return raw.split(",").map((x) => W.norm(x)).filter((x) => x && !mine.has(x) && !W.lanternClash(x)).slice(0, 6);
}
export function config(o = owner.get()) {
  const name = String(o.assistantName || "Dayspring");
  const words = (o.wakeWords?.length ? o.wakeWords : [name.toLowerCase()]).slice(0, W.MAX_WAKE);
  return {
    name, say: o.assistantSay || "", sensitivity: ["strict", "normal", "relaxed"].includes(o.wakeSensitivity) ? o.wakeSensitivity : "normal",
    followsName: o.wakeFollowsName !== false,
    words: words.map((w) => ({ text: w, say: o.wakeSay?.[w] || sayFor(w, name, o.assistantSay), also: [...(o.wakeAlso?.[w] ?? [])], trained: [...(o.wakeTrained?.[w] ?? [])] })),
    extra: envExtra(words),
  };
}
// The matcher is rebuilt when the settings change (lib/naming.mjs calls invalidate()), and looked at again at most every
// 2 seconds otherwise (the offline intents ask on every sentence, so reading owner.json each time would be slow).
let cached = { key: "", m: null, at: 0 };
export function invalidate() { cached.at = 0; }
export function matcher() {
  if (cached.m && Date.now() - cached.at < 2000) return cached.m;
  const c = config(), key = JSON.stringify(c);
  if (cached.key !== key) cached = { key, m: W.createMatcher(c), at: Date.now() };
  else cached.at = Date.now();
  return cached.m;
}
export const match = (text, opts) => matcher().match(text, opts);
export const matchAny = (alts, opts) => matcher().matchAny(alts, opts);
// "Hey Nova, what's the weather" → "what's the weather" (only a wake word at the start comes off)
export const strip = (text) => matcher().strip(text);
// Discord and calls: → the request when what they said STARTS with a wake word, "" when it was only the wake word, null otherwise
export function wakeCommand(text) {
  const m = match(text);
  return m && m.atStart ? m.rest : null;
}
// test / exec / replace like a RegExp (Tune in's older code)
export const regexLike = (opts) => W.regexLike(matcher(), opts);
// what the wake words look like written down ("Hey Computa"): for the screen's hints, and whisper's spelling
const shown = (w) => W.cap(w);
export const display = () => config().words.map((w) => shown(w.text));
// A prompt for the local speech engine (whisper keeps a name it has just "seen" in a sentence: a bare word made it drop it)
export function hint() {
  const c = config(), ws = c.words.map((w) => shown(w.text.replace(/^(hey|ok|okay|hi) /, "")));
  const a = ws[0] || c.name, b = ws[1] || a;
  return `Hey ${a}, what's the weather? ${b}, tell us a joke.${ws[2] ? ` ${ws[2]}, what time is it?` : ""}`;
}
// For the meeting's address parser (it looks for these anywhere in a caption): the name and the wake words that aren't
// everyday words ("Nova", "Computa"), with their trained and "also accept" spellings. Everyday ones ("computer") are
// only heard at the start, through match().
export function meetNames() {
  const c = config(), out = new Set();
  const ok = (t) => { const st = W.strength(t); return t && !st.common && st.content.length && !W.lanternClash(t); };
  const base = (t) => W.norm(t).replace(/^(hey|ok|okay|hi) /, "");
  if (ok(base(c.name))) out.add(base(c.name));
  for (const w of c.words) for (const t of [w.text, w.say, ...w.also, ...w.trained]) { const b = base(t ?? ""); if (b && ok(b)) out.add(b); }
  return [...out].slice(0, 30);
}
// Everything the screen needs to hear the wake words itself (public/wakeword.js builds the same matcher from it)
export function clientConfig() {
  const c = config();
  return { ...c, display: display(), grammar: grammar(), lantern: "lantern" };
}
// JSGF for browsers that still read speech grammars (a hint only; Chrome mostly ignores it)
export function grammar() {
  const alts = [...new Set(config().words.flatMap((w) => [w.text, w.say].filter(Boolean)))].map((x) => W.norm(x)).filter(Boolean);
  return `#JSGF V1.0; grammar wake; public <wake> = ${alts.join(" | ")} ;`;
}
