// The assistant's name and wake words: changing them safely, and making sure it calls itself by its name everywhere.
//
// The choice made here: the name is who the assistant is ("Nova"); "Dayspring" stays the app's name (About, Help,
// Updates, file and process names, data folders, the window's hidden title marker). A personality (Settings →
// Personality) is only a style of speaking: a pirate Nova is still Nova, and says so.
//
//   view()                         the name, how it's said, the wake words (for Settings and the screen)
//   setName(name, { say })         1–19 letters, numbers, spaces, ' and -; never "Lantern" or a sound-alike
//   setWakeWords(list) · addWakeWord(w) · removeWakeWord(w) · setAlso(word, list) · setSensitivity(s)
//   forSpeech(text)                the name as it's said ("Aoife" → "Ee-fa") for the voice         } lib/selfname.mjs
//   fixReply(text)                 an answer that still calls itself "Dayspring" (any AI) calls   } (small, for the
//                                  itself by its name                                            } voice and prompts)
//   promptNote()                   the line every AI prompt gets (via the personality block)      }
//   train*()                       "Train my wake word": what the recognizer heard, kept as accepted variants
import * as owner from "./owner.mjs";
import * as wake from "./wakeword.mjs";
import { PRODUCT, name, renamed } from "./selfname.mjs";
export { PRODUCT, name, renamed, forSpeech, fixReply, promptNote } from "./selfname.mjs";

const W = wake.core;
export const MAX = { name: W.MAX_CHARS, wake: W.MAX_CHARS, words: W.MAX_WAKE, say: 40, also: 8, trained: 16 };
const lc = (s) => W.norm(s);
const listen = [];
export function onChange(fn) { listen.push(fn); }
const changed = (what) => { wake.invalidate(); for (const fn of listen) { try { fn(what); } catch { /* a screen that isn't there */ } } };

export function view() {
  const o = owner.get(), c = wake.config(o);
  return {
    name: o.assistantName || PRODUCT, say: o.assistantSay || "", product: PRODUCT, renamed: renamed(),
    wake: { words: c.words.map((w) => ({ text: w.text, shown: W.cap(w.text), say: o.wakeSay?.[w.text] || "", also: o.wakeAlso?.[w.text] ?? [], trained: o.wakeTrained?.[w.text] ?? [] })),
      followsName: c.followsName, sensitivity: c.sensitivity },
    limits: MAX, sensitivities: W.SENSITIVITIES,
  };
}

// ---- checking ------------------------------------------------------------------------------------------------------------
export const checkName = (text) => W.validateName(text);
export function checkSay(text) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return { ok: true, value: "" };
  if ([...s].length > MAX.say) return { ok: false, error: `Keep “how to say it” under ${MAX.say} characters.` };
  if (!/^[\p{L}\p{M}' -]+$/u.test(s)) return { ok: false, error: "Write how it sounds with letters, spaces and hyphens, like “Ee-fa”." };
  if (W.lanternClash(s)) return { ok: false, error: "That sounds like Lantern, the learning app's name. Pick a way of saying it that sounds different." };
  return { ok: true, value: s };
}
export function checkWake(text, { name: nm = name() } = {}) {
  const r = W.validateWake(text, { name: nm });
  return r;
}
// how many syllables and whether it's an everyday word, what it sounds like: for Settings' live hints
export function describeWake(text) {
  const r = checkWake(text);
  if (!r.ok) return r;
  return { ...r, neighbours: W.neighbours(r.value), shown: W.cap(r.value) };
}

// ---- changing ------------------------------------------------------------------------------------------------------------
export function setName(text, { say } = {}) {
  const r = checkName(text);
  if (!r.ok) return r;
  const s = say === undefined ? null : checkSay(say);
  if (s && !s.ok) return s;
  const before = owner.get();
  const patch = { assistantName: r.value };
  if (s) patch.assistantSay = s.value;
  else if (before.assistantName !== r.value) patch.assistantSay = "";        // a new name: the old pronunciation doesn't fit it
  const after = owner.set(patch);
  const wakeChanged = JSON.stringify(before.wakeWords) !== JSON.stringify(after.wakeWords);
  if (wakeChanged) clearEnvPhrases();
  changed("name");
  return { ok: true, name: after.assistantName, before: before.assistantName, say: after.assistantSay, wakeChanged, followsName: after.wakeFollowsName, wakeWords: after.wakeWords };
}
// list: ["hey nova", "computer"] (1–3). The name's own wake word follows the name again when the list is just the name.
export function setWakeWords(list, { say = null, also = null } = {}) {
  const items = (Array.isArray(list) ? list : String(list ?? "").split(",")).map((x) => String(x ?? "").trim()).filter(Boolean);
  if (!items.length) return { ok: false, error: "Keep at least one wake word, or I won't know when you're talking to me." };
  if (items.length > MAX.words) return { ok: false, error: `Up to ${MAX.words} wake words. Pick the ones you'll really use.` };
  const out = [], warnings = [];
  for (const it of items) {
    const r = checkWake(it);
    if (!r.ok) return { ok: false, error: r.error, word: it };
    if (!out.includes(r.value)) out.push(r.value);
    warnings.push(...r.warnings);
  }
  const patch = { wakeWords: out };
  if (say && typeof say === "object") { const m = {}; for (const [k, v] of Object.entries(say)) { const c = checkSay(v); if (!c.ok) return c; if (c.value) m[lc(k)] = c.value; } patch.wakeSay = m; }
  if (also && typeof also === "object") { const m = {}; for (const [k, v] of Object.entries(also)) m[lc(k)] = cleanList(v, MAX.also); patch.wakeAlso = m; }
  const after = owner.set(patch);
  clearEnvPhrases();
  changed("wake");
  return { ok: true, wakeWords: after.wakeWords, followsName: after.wakeFollowsName, warnings: [...new Set(warnings)] };
}
export function addWakeWord(text) {
  const cur = owner.get().wakeWords ?? [];
  const r = checkWake(text); if (!r.ok) return r;
  if (cur.includes(r.value)) return { ok: true, already: true, wakeWords: cur, warnings: [] };
  if (cur.length >= MAX.words) return { ok: false, error: `I can answer to up to ${MAX.words} wake words, and I already have ${cur.map((w) => `“${W.cap(w)}”`).join(", ")}. Remove one first.` };
  return setWakeWords([...cur, r.value]);
}
export function removeWakeWord(text) {
  const cur = owner.get().wakeWords ?? [], t = lc(text);
  const hit = cur.find((w) => w === t) ?? cur.find((w) => lc(w.replace(/^(hey|ok|okay|hi) /, "")) === t.replace(/^(hey|ok|okay|hi) /, ""));
  if (!hit) return { ok: false, error: `“${W.cap(text)}” isn't one of my wake words. I answer to ${cur.map((w) => `“${W.cap(w)}”`).join(" and ")}.` };
  if (cur.length === 1) return { ok: false, error: `“${W.cap(hit)}” is my only wake word, so I'd never hear you. Add another one first.` };
  return setWakeWords(cur.filter((w) => w !== hit));
}
export function setAlso(word, list) {
  const w = lc(word), o = owner.get();
  if (!o.wakeWords.includes(w)) return { ok: false, error: "That isn't one of the wake words." };
  const clean = cleanList(list, MAX.also).filter((x) => { const st = W.strength(x); return !W.lanternClash(x) && !st.veryCommon && st.content.length; });
  owner.set({ wakeAlso: { ...(o.wakeAlso ?? {}), [w]: clean }, wakeWords: o.wakeWords, wakeFollowsName: o.wakeFollowsName });
  changed("wake");
  return { ok: true, also: clean };
}
export function setSensitivity(s) {
  if (!W.SENSITIVITIES.includes(s)) return { ok: false, error: "Pick strict, normal or relaxed." };
  owner.set({ wakeSensitivity: s }); changed("wake");
  return { ok: true, sensitivity: s };
}
export function setFollows(on) {
  const o = owner.get();
  owner.set(on ? { wakeFollowsName: true } : { wakeFollowsName: false, wakeWords: o.wakeWords });
  changed("wake");
  return { ok: true, followsName: owner.get().wakeFollowsName, wakeWords: owner.get().wakeWords };
}
function cleanList(v, max) {
  return [...new Set((Array.isArray(v) ? v : String(v ?? "").split(",")).map((x) => lc(x)).filter((x) => x && [...x].length <= 30))].slice(0, max);
}
// something else saved the name or the wake words (the setup wizard's older route): tell the screens and the bot
export const touch = (what = "name") => changed(what);
// .env's DAYSPRING_WAKE_PHRASES (written by older setups) would keep waking to the old words: Settings owns them now
export function clearEnvPhrases() {
  if (!process.env.DAYSPRING_WAKE_PHRASES) return;
  import("./envfile.mjs").then((e) => e.setVars({ DAYSPRING_WAKE_PHRASES: "" })).catch(() => { delete process.env.DAYSPRING_WAKE_PHRASES; });
}

// ---- what it says about its name ----------------------------------------------------------------------------------------
// "What's your name?"
export const nameLine = () => `I'm ${name()}.`;
export const originLine = () => (renamed() ? `I started out as Dayspring. Now I go by ${name()}.` : "I've always been Dayspring. You can give me another name anytime: just say “your name is” and the name.");
export function wakeLine() {
  const ws = wake.display();
  return ws.length > 1 ? `I answer to ${ws.slice(0, -1).map((w) => `“${w}”`).join(", ")} and “${ws.at(-1)}”.` : `My wake word is “${ws[0]}”.`;
}

// ---- "Train my wake word" ----------------------------------------------------------------------------------------------------
// The screen that listens runs it: it shows "Say “Computa”" 3–5 times and sends what its recognizer heard each time
// (its best guess and the alternatives). Nothing else is kept: only the variants it learned, in owner.json.
let train = null;
const TRAIN_MS = 3 * 60_000;
export function trainStatus() {
  if (train && Date.now() - train.at > TRAIN_MS && !train.done) train = { ...train, done: true, cancelled: true, why: "It timed out." };
  return train ? { word: train.word, shown: W.cap(train.word), want: train.want, min: train.min, got: train.samples.length, heard: train.samples.map((s) => s[0] ?? ""), done: train.done, cancelled: Boolean(train.cancelled), report: train.report ?? null, id: train.id, from: train.from } : { active: false };
}
export function trainStart({ word = null, want = 5, from = "settings" } = {}) {
  const words = owner.get().wakeWords ?? [];
  const w = word ? lc(word) : words[0];
  if (!words.includes(w)) return { ok: false, error: `“${W.cap(word)}” isn't one of the wake words yet. Add it first, then train it.` };
  train = { id: Math.random().toString(36).slice(2, 10), word: w, want: Math.max(3, Math.min(5, Number(want) || 5)), min: 3, samples: [], at: Date.now(), done: false, from };
  return { ok: true, ...trainStatus() };
}
export function trainSample(alts, { id = null } = {}) {
  if (!train || train.done) return { ok: false, error: "Training isn't running. Start it again from Settings, or say “train my wake word”." };
  if (id && id !== train.id) return { ok: false, error: "That was for an older training session." };
  const list = (Array.isArray(alts) ? alts : [alts]).map((a) => String(typeof a === "string" ? a : a?.transcript ?? "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 5);
  train.samples.push(list); train.at = Date.now();
  if (train.samples.length >= train.want) return { ok: true, ...trainFinish() };
  return { ok: true, ...trainStatus() };
}
export function trainFinish({ apply = true } = {}) {
  if (!train) return { ok: false, error: "Training isn't running." };
  if (train.done) return { ok: true, ...trainStatus() };
  if (train.samples.length < train.min) { train.done = true; train.cancelled = true; train.why = `It needs at least ${train.min} tries.`; return { ok: true, ...trainStatus() }; }
  const report = W.trainReport(wake.config(), train.word, train.samples);
  if (apply && report.learned.length) {
    const o = owner.get();
    const had = o.wakeTrained?.[train.word] ?? [];
    owner.set({ wakeTrained: { ...(o.wakeTrained ?? {}), [train.word]: [...new Set([...had, ...report.learned])].slice(-MAX.trained) }, wakeWords: o.wakeWords, wakeFollowsName: o.wakeFollowsName });
    changed("wake");
  }
  train = { ...train, done: true, report };
  return { ok: true, ...trainStatus() };
}
export function trainCancel() { if (train && !train.done) train = { ...train, done: true, cancelled: true, why: "Cancelled." }; return { ok: true, ...trainStatus() }; }
export function forgetTrained(word, variant = null) {
  const o = owner.get(), w = lc(word);
  const left = variant ? (o.wakeTrained?.[w] ?? []).filter((x) => x !== lc(variant)) : [];
  owner.set({ wakeTrained: { ...(o.wakeTrained ?? {}), [w]: left }, wakeWords: o.wakeWords, wakeFollowsName: o.wakeFollowsName });
  changed("wake");
  return { ok: true, trained: left };
}
export function _resetTraining() { train = null; }
