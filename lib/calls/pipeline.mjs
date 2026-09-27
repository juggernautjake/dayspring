// One quick answer for a call or a Discord chat, spoken sentence by sentence as it's written.
//
//   end of speech ─► words (stt) ─► the fast AI model, streamed ─► sentence splitter ─► each sentence to the voice at once
//
// The first sentence is usually ready ~0.4 s after the AI starts writing, so Dayspring starts talking while the rest of
// the answer is still being made. With no AI set up (or the AI can't be reached), a few things still work without it: the
// time, the date, a joke, simple math, the weather, and "how do I set up Zoom for you?".
//
//   const r = await reply({ text, history, who: "friend" | "owner", via, trace, onSentence(text, seq), signal })
//   → { reply, parts, offline, model, setup: appId|null }
//
// Read-only on purpose: nobody on a call can change the owner's schedule, settings, files or messages through here.
import * as llm from "../llm.mjs";
import * as owner from "../owner.mjs";
import * as cfg from "./config.mjs";
import * as apps from "./apps.mjs";
import { streamText, fastModel } from "./stream-llm.mjs";
import { createSplitter } from "./sentences.mjs";
import { warm } from "./warm.mjs";

const clean = (t) => String(t ?? "").replace(/[*_#`>|]/g, "").replace(/\s+/g, " ").trim();

// deps that live elsewhere (and can be swapped in tests)
let deps = {
  // the owner's personality, or (for Discord) a separate one chosen in Settings → Calls
  personaBlock: async (presetId = "") => {
    try {
      if (presetId) {
        const [{ promptBlock }, { byId }] = await Promise.all([import("../persona/compile.mjs"), import("../persona/presets.mjs")]);
        const p = byId(presetId); return promptBlock({ preset: p.id, base: { ...(p.base ?? {}) }, role: {}, custom: null, easterEggs: [] }) || "";
      }
      const p = await import("../persona/index.mjs"); return p.promptBlock() || "";
    } catch { return ""; }
  },
  weather: async () => { try { const s = await import("../showcase.mjs"); return s.spokenWeather(await s.weather()); } catch { return null; } },
  joke: async () => { try { const j = (await import("../jokes/index.mjs")).default; const k = j.pick({}); return k ? j.speakable(k).text : null; } catch { return null; } },
  devices: () => apps.devices(),
  listening: () => null,
};
export function setDeps(d) { deps = { ...deps, ...d }; }

// ---- the system prompt: short, because every word of it is read before the first word of the answer --------------------
export async function systemFor({ who = "friend", surface = "call", schedule = "", persona = "" } = {}) {
  const N = owner.name(), A = owner.assistant();
  const where = surface === "discord-text" ? `You're chatting in ${N}'s Discord.` : `You're in a voice call with ${N}${who === "owner" ? "" : " and friends"}; you hear it through ${N}'s computer.`;
  const out = [
    `You are ${A}, ${N}'s friendly assistant. ${where} ${who === "owner" ? `This is ${N}.` : `This may be one of ${N}'s friends.`}`,
    surface === "discord-text"
      ? "Answer in a few short, warm sentences: plain words, at most a short list, no headings."
      : "Answer out loud in one or two short, warm sentences: plain words, no lists, no markdown. Start with the answer itself.",
    "Be fun and helpful: trivia, quick facts, math, jokes, game and music questions are all great.",
    `You can't change anything from here (schedule, settings, files, messages, programs).${schedule ? "" : ` Keep ${N}'s private life private: don't share ${N}'s schedule, people, notes or plans; if asked, say ${N} can ask you directly.`}`,
    `Now: ${new Date().toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}.`,
  ];
  if (schedule) out.push(`${N}'s plan today (${N} chose to share it): ${schedule}`);
  const pb = await deps.personaBlock(persona).catch(() => "");
  if (pb) out.push(pb.slice(0, 900));
  return out.join("\n");
}

// ---- without AI ------------------------------------------------------------------------------------------------------------
const NUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100 };
const n = (w) => (w in NUM ? NUM[w] : Number(w));
export function mathAnswer(text) {
  const t = String(text).toLowerCase().replace(/,/g, "");
  const m = /(-?\d+(?:\.\d+)?|\b[a-z]+\b)\s*(plus|\+|minus|-|times|x|\*|multiplied by|divided by|over|\/)\s*(-?\d+(?:\.\d+)?|\b[a-z]+\b)/.exec(t);
  if (!m) return null;
  const a = n(m[1]), b = n(m[3]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const op = m[2];
  const v = /plus|\+/.test(op) ? a + b : /minus|-/.test(op) ? a - b : /times|x|\*|multiplied/.test(op) ? a * b : b === 0 ? null : a / b;
  if (v === null) return "You can't divide by zero. Believe me, I've tried.";
  return `${m[1]} ${op === "x" || op === "*" ? "times" : op === "/" ? "divided by" : op === "+" ? "plus" : op === "-" ? "minus" : op} ${m[3]} is ${Math.round(v * 1000) / 1000}.`;
}
export async function offlineAnswer(text) {
  const t = String(text ?? "").toLowerCase();
  if (/\bwhat(?:'s| is)? (?:the )?time\b|\bwhat time is it\b/.test(t)) return `It's ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`;
  if (/\b(what(?:'s| is)? (?:the |today'?s )?date|what day is (?:it|today))\b/.test(t)) return `It's ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}.`;
  if (/\bjoke\b|make (?:me|us) laugh/.test(t)) { const j = await deps.joke(); if (j) return j; }
  if (/\bweather\b|\btemperature\b|\bhot out|\bcold out|\braining\b/.test(t)) { const w = await deps.weather(); if (w) return w; }
  const m = mathAnswer(t); if (m) return m;
  if (/\b(hi|hello|hey|how are you)\b/.test(t)) return "Hi! I'm here.";
  return null;
}
export const LIMITED = "I'm limited without AI right now, but I can tell you the time, the date, the weather, a joke, or do quick math.";

// ---- the answer --------------------------------------------------------------------------------------------------------------
export async function reply({ text, history = [], who = "friend", via = "tunein", surface = "call", trace = null, onSentence = () => {}, signal = null, schedule = "", persona = "", maxTokens } = {}) {
  const q = clean(text);
  let seq = 0;
  const say = (s) => { const c = clean(s); if (!c) return; if (seq === 0) trace?.mark("firstSentence"); onSentence(c, seq++); };
  const parts = [];
  const sayAll = (full) => { for (const s of full.split(/(?<=[.!?])\s+/)) { parts.push(s); say(s); } };

  // "What mic should Zoom use?" / "How do I set up Google Meet for you?": the exact device names from this computer.
  // Only for the owner (or Tune in, which only runs on the owner's computer): friends on Discord have their own setup.
  if ((who === "owner" || via === "tunein") && apps.isSetupQuestion(q)) {
    const app = apps.appFromText(q.toLowerCase());
    let dev = null; try { dev = await deps.devices(); } catch { dev = null; }
    const full = apps.spokenAnswer(app, dev, deps.listening());
    trace?.mark("firstToken"); sayAll(full);
    return { reply: full, parts, offline: true, model: null, setup: app ?? "other" };
  }

  if (!llm.ready()) {
    const full = (await offlineAnswer(q)) ?? LIMITED;
    trace?.mark("firstToken"); sayAll(full);
    return { reply: full, parts, offline: true, model: null, setup: null };
  }

  warm();                                            // the voice's connection opens while the AI writes
  const model = await fastModel();
  const system = await systemFor({ who, surface, schedule, persona });
  const recent = history.slice(-8).map((m) => `${m.role === "user" ? (m.name ? `${m.name} said` : "Heard") : "You said"}: ${typeof m.content === "string" ? m.content : ""}`).join("\n");
  const prompt = (recent ? recent + "\n" : "") + `${surface === "discord-text" ? "Message" : "Heard"}: ${q}\nYour answer:`;
  const split = createSplitter({ onSentence: (s) => { parts.push(s); say(s); }, firstMin: surface === "discord-text" ? 400 : 40 });
  let full = "", first = true;
  try {
    for await (const piece of streamText({ system, prompt, model, signal, maxTokens: maxTokens ?? (surface === "discord-text" ? 500 : 220) })) {
      if (signal?.aborted) break;
      if (first) { trace?.mark("firstToken"); first = false; }
      full += piece; split.push(piece);
    }
  } catch (e) {
    if (!full && !signal?.aborted) {
      // the AI couldn't be reached: say what can be said without it
      const off = (await offlineAnswer(q)) ?? "Sorry, I couldn't get an answer just then.";
      trace?.mark("firstToken"); sayAll(off);
      return { reply: off, parts, offline: true, model: null, setup: null, error: e.message };
    }
  }
  if (!signal?.aborted) split.flush();
  full = clean(full) || "Hmm, I'm not sure.";
  if (!parts.length && !signal?.aborted) { parts.push(full); say(full); }
  return { reply: full, parts, offline: false, model, setup: null, stopped: Boolean(signal?.aborted) };
}

// The follow-up window (after "Dayspring?" alone) comes from calls.json.
export const followUpMs = () => cfg.get().followUpMs;
