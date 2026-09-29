// Text to speech. The Dayspring screen asks /api/tts for audio and plays it. Three providers (TTS_PROVIDER in .env):
//   browser    free: the Dayspring screen speaks with the voices built into the browser (Microsoft Edge has natural-sounding
//              "Online (Natural)" voices for free). /api/tts answers 204 and the page speaks by itself.
//   elevenlabs natural, expressive voices (ELEVENLABS_API_KEY; free tier available)
//   openai     OpenAI's voices (OPENAI_API_KEY)
// Default: ElevenLabs when its key is set, otherwise the free browser voices.
// How it sounds follows the time of day — soothing and slower first thing, brighter by mid-morning, upbeat in the
// afternoon, warm in the evening, calm again at night — plus the user's own choices: faster/slower, and which voice.
import { createHash } from "node:crypto";
import * as settings from "./settings.mjs";
import { forSpeech } from "./selfname.mjs";

const KEY = () => process.env.ELEVENLABS_API_KEY ?? "";
const MODEL = () => process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5";
// Dayspring's default voice for a new install is a friendly, warm female voice: ElevenLabs' Matilda, OpenAI's "coral"
// (else "shimmer"), and for the free voices the list in public/voices.js. A voice the owner picked always wins.
const DEFAULT_VOICE = () => process.env.DAYSPRING_VOICE_ID || "XrExE9yKIg1WjnnlVkGX";   // Matilda

export function ttsProvider() {
  const p = String(process.env.TTS_PROVIDER ?? "").toLowerCase();
  if (["browser", "elevenlabs", "openai"].includes(p)) return p;
  return process.env.ELEVENLABS_API_KEY ? "elevenlabs" : "browser";
}
// OpenAI's voices (gpt-4o-mini-tts)
export const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"];
export const OPENAI_DEFAULT = OPENAI_VOICES.includes("coral") ? "coral" : "shimmer";
// the defaults for a new install (tests and Settings show them)
export const defaults = () => ({ eleven: "Matilda", elevenId: DEFAULT_VOICE(), guide: "Will", openai: OPENAI_DEFAULT });
export const OPENAI_DESCRIBE = { Alloy: "neutral and balanced", Ash: "clear and direct", Ballad: "soft and melodic", Coral: "warm and friendly", Echo: "calm and even", Fable: "expressive storyteller",
  Nova: "bright and upbeat", Onyx: "deep and steady", Sage: "calm and wise", Shimmer: "light and gentle", Verse: "lively and versatile" };
export const describeFor = (p) => (p === "openai" ? OPENAI_DESCRIBE : p === "elevenlabs" ? { ...DESCRIBE, ...Object.fromEntries(Object.entries(library.voices).map(([n, v]) => [n, v.describe])) } : {});
// ElevenLabs' built-in voices: any ElevenLabs key can speak with these (a key may not be allowed to list voices).
export const VOICES = {
  Brian: "nPczCjzI2devNBz1zQrb", George: "JBFqnCBsd6RMkjVDRZzb", Eric: "cjVigY5qzO86Huf0OWal", Chris: "iP95p4xoKVk53GoZ742B",
  Daniel: "onwK4e9ZLuTAKqWW03F9", Sarah: "EXAVITQu4vr4xnSDxMaL", Jessica: "cgSgspJ2msm6clMCkdW9", Matilda: "XrExE9yKIg1WjnnlVkGX",
  Liam: "TX3LPaxmHKxFdv7VOQHJ", Will: "bIHbv24MWmeRgasZH58o", Alice: "Xb7hH8MSUJpSbSDYk0k2", Lily: "pFZP5JQG7iQjIQuC4Bku",
  Rachel: "21m00Tcm4TlvDq8ikWAM", Roger: "CwhRBWXzGAHq8TQ4Fs17", Charlotte: "XB0fDUnXU5powFXDhCwa", Callum: "N2lVS1w4EtoT3dr4eOWO",
};
export const DESCRIBE = { Brian: "deep and calm", George: "warm and British", Eric: "smooth", Chris: "casual", Daniel: "British and steady", Sarah: "soft", Jessica: "bright and expressive", Matilda: "warm", Liam: "young and clear", Will: "friendly and relaxed", Alice: "confident and British", Lily: "gentle and British", Rachel: "calm and clear", Roger: "laid-back and easy", Charlotte: "soft and a little smoky", Callum: "husky and intense" };

// The user's own ElevenLabs voice library (custom, cloned, added from the Voice Library), when their key may list it.
let library = { at: 0, voices: {} };
export async function loadLibrary() {
  if (!KEY() || Date.now() - library.at < 3600_000) return library.voices;
  library.at = Date.now();
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": KEY() }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return library.voices;                      // some keys may only speak, not list
    const j = await r.json();
    library.voices = Object.fromEntries((j.voices ?? []).map((v) => [v.name.split(/[ -]/)[0], { id: v.voice_id, describe: [v.labels?.description, v.labels?.accent, v.labels?.gender].filter(Boolean).join(", ") || v.category }]));
  } catch { /* offline: the built-in list still works */ }
  syncNames();
  return library.voices;
}
const allEleven = () => ({ ...VOICES, ...Object.fromEntries(Object.entries(library.voices).map(([n, v]) => [n, v.id])) });
// Tell the voice commands every name the current provider has ("switch your voice to <library voice>")
const syncNames = () => { try { settings.knownVoices(voiceChoices()); } catch { /* settings not ready yet */ } };
function voiceId() { const s = settings.get(), all = allEleven(); return s.voiceId || (s.voice && all[s.voice]) || DEFAULT_VOICE(); }
// A voice picked by name only ("switch your voice to Adam"): remember its exact id too, so it's the one used after a restart.
settings.onChange((out, patch) => {
  if (patch.voice === undefined || patch.voiceId !== undefined || !out.voice) return;
  const id = allEleven()[out.voice];
  if (id) settings.set({ voiceId: id });
});
// Know the owner's library voices from the start (not only after the voice list is opened).
if (KEY()) setTimeout(() => loadLibrary().catch(() => {}), 2000);
export function voiceReady() {
  const p = ttsProvider(), id = voiceId();
  if (p === "browser") return { ready: true, provider: p, voiceName: settings.get().browserVoice || "the browser's default voice", tone: toneNow() };
  if (p === "openai") return { ready: Boolean(process.env.OPENAI_API_KEY), provider: p, voiceName: OPENAI_VOICES.includes(settings.get().openaiVoice) ? settings.get().openaiVoice : OPENAI_DEFAULT, tone: toneNow() };
  const all = allEleven();
  return { ready: Boolean(KEY()), provider: p, voiceId: id, voiceName: Object.keys(all).find((k) => all[k] === id) ?? settings.get().voice ?? "custom", model: MODEL(), tone: toneNow() };
}
// The voices the user can pick from right now (the browser's own list comes from the Dayspring screen itself)
export function voiceChoices() {
  const p = ttsProvider();
  if (p === "openai") return OPENAI_VOICES.map((n) => n.charAt(0).toUpperCase() + n.slice(1));
  if (p === "elevenlabs") return [...new Set([...Object.keys(library.voices), ...Object.keys(VOICES)])];
  return [];
}
// Before a voice command: make sure the names of the current provider's voices are known (the ElevenLabs library is
// fetched at most once an hour).
export async function refreshVoiceNames() {
  if (ttsProvider() === "elevenlabs") await loadLibrary().catch(() => {});
  syncNames();
}
export function setVoice(name) {
  const all = allEleven();
  const v = Object.keys(all).find((k) => k.toLowerCase() === String(name).toLowerCase() || all[k] === name);
  if (!v) throw new Error(`unknown voice ${name}`);
  settings.set({ voice: v, voiceId: all[v] });
  return voiceReady();
}
export function nextVoice() {
  const names = Object.keys(VOICES), cur = voiceReady().voiceName;
  return names[(names.indexOf(cur) + 1) % names.length];
}

// The tone for this hour. The Dayspring screen can also ask for one outright (the morning devotional asks for "soothing").
const TONES = {
  soothing: { speed: 0.88, stability: 0.72, style: 0.05 },
  bright: { speed: 1.0, stability: 0.52, style: 0.2 },
  chipper: { speed: 1.05, stability: 0.4, style: 0.35 },
  warm: { speed: 0.97, stability: 0.58, style: 0.18 },
};
export function toneNow(d = new Date()) {
  if (!settings.get().timeTone) return "bright";
  const h = d.getHours() + d.getMinutes() / 60;
  if (h < 8.5) return "soothing";
  if (h < 12) return "bright";
  if (h < 18) return "chipper";
  if (h < 21) return "warm";
  return "soothing";
}

// Small cache so repeated phrases cost nothing.
const cache = new Map();
const MAX_CACHE = 60;

function speakable(text) {
  return forSpeech(String(text))                         // the assistant's name as it's said ("Aoife" → "Ee-fa"; lib/naming.mjs)
    .replace(/\*\*|__|`|#+\s/g, "")
    .replace(/(\d{1,2}):00\s?(am|pm)/gi, "$1 $2")
    .replace(/\bFS\b/g, "F S")
    .replace(/\bCFML\b/g, "C F M L")
    .replace(/→/g, ", ")
    .slice(0, 2500);
}

export async function tts(text, opts = {}) {
  const p = ttsProvider();
  // free voices: the Dayspring screen speaks for itself
  if (p === "browser") throw Object.assign(new Error("browser voice"), { status: 204 });
  if (p === "openai") return openaiTts(text, opts);
  if (!KEY()) throw Object.assign(new Error("ELEVENLABS_API_KEY is not set"), { status: 503 });
  const s = settings.get();
  const tone = TONES[opts.tone] ?? TONES[toneNow()];
  const speed = Math.max(0.7, Math.min(1.2, (Number(opts.speed) || tone.speed) + (s.speedAdj ?? 0)));
  const vid = (opts.voice && allEleven()[opts.voice]) || voiceId();
  const say = speakable(text);
  const k = createHash("sha1").update([vid, speed.toFixed(2), tone.stability, tone.style, say].join("|")).digest("hex");
  if (cache.has(k)) return cache.get(k);
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": KEY(), "content-type": "application/json", accept: "audio/mpeg" },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ text: say, model_id: MODEL(), voice_settings: { stability: tone.stability, similarity_boost: 0.75, style: tone.style, use_speaker_boost: true, speed } }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw Object.assign(new Error(`ElevenLabs ${res.status}: ${detail.slice(0, 200)}`), { status: 502 });
  }
  const buf = Buffer.from(await res.arrayBuffer());
  cache.set(k, buf);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  return buf;
}

async function openaiTts(text, opts = {}) {
  if (!process.env.OPENAI_API_KEY) throw Object.assign(new Error("OPENAI_API_KEY is not set"), { status: 503 });
  const s = settings.get();
  const v = String(opts.voice || s.openaiVoice || OPENAI_DEFAULT).toLowerCase();
  const tone = TONES[opts.tone] ?? TONES[toneNow()];
  const speed = Math.max(0.7, Math.min(1.2, (Number(opts.speed) || tone.speed) + (s.speedAdj ?? 0)));
  const say = speakable(text);
  const k = createHash("sha1").update(["openai", v, speed.toFixed(2), say].join("|")).digest("hex");
  if (cache.has(k)) return cache.get(k);
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST", headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" }, signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts", voice: OPENAI_VOICES.includes(v) ? v : OPENAI_DEFAULT, input: say, speed, response_format: "mp3",
      instructions: { soothing: "Speak softly, slowly and warmly.", bright: "Speak clearly and brightly.", chipper: "Speak with upbeat energy.", warm: "Speak warmly and relaxed." }[opts.tone ?? toneNow()] }),
  });
  if (!res.ok) throw Object.assign(new Error(`OpenAI voice ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`), { status: 502 });
  const buf = Buffer.from(await res.arrayBuffer());
  cache.set(k, buf);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  return buf;
}

// How the assistant should write, for Claude: the tone of the hour, the detail they want, any attitude they asked for.
export function styleNote() {
  const s = settings.get(), tone = toneNow();
  const toneLine = { soothing: "It's early (or late): be soothing, gentle and unhurried.", bright: "It's morning: be bright and clear.", chipper: "It's the afternoon: be upbeat and energetic.", warm: "It's evening: be warm and relaxed." }[tone];
  const detail = { simple: "The owner wants SIMPLE answers: one or two short sentences, just the essentials.", normal: "", detailed: "The owner wants DETAILED answers: explain fully, with the reasoning and specifics (up to about eight spoken sentences)." }[s.detail ?? "normal"];
  const att = s.attitude ? `Take on this attitude when you talk to them: ${s.attitude}. Stay helpful and kind underneath it.` : "";
  const mode = { serious: "SERIOUS MODE: they asked for a serious conversation. No jokes or bits at all; listen and go deep.", spar: "SPAR MODE: they want you to push back hard on everything and not simply agree.", devil: "DEVIL'S ADVOCATE MODE: argue the other side of whatever he holds, as strongly as its best defenders would, until he ends it." }[s.convMode] ?? "";
  return [mode, toneLine, detail, att].filter(Boolean).join(" ");
}
