// Streaming speech for calls: audio starts playing while the rest of the sentence is still being made.
//   ElevenLabs: the /stream endpoint with its low-latency model (eleven_flash_v2_5; if the key can't use it, the usual
//               model) and optimize_streaming_latency, at a small bitrate (mp3 22 kHz / 32 kbps: plenty for speech, faster).
//   OpenAI:     the speech endpoint streams its mp3 as it's made.
//   Browser voices: not available here (the screen speaks those itself) → { browser: true }.
// Short phrases that come up again and again ("Yes?", "Mm-hm.", "One sec.") are kept whole in memory and replayed.
//
//   const r = await openStream(text)  → { stream: ReadableStream<Uint8Array>, type: "audio/mpeg", model } | { browser: true }
//   warm()                            → opens the TLS connection early (called when a call starts)
import * as voice from "../voice.mjs";
import * as settings from "../settings.mjs";
import { forSpeech } from "../selfname.mjs";
import * as cfg from "./config.mjs";
import { defaultsFor } from "../../vendor/ecosystem-core/shared/voices-defaults.mjs";

// as: "lantern" speaks with Lantern's voice (its default chain: ElevenLabs Will, OpenAI ash) when Dayspring answers
// for Lantern in a meeting, so the two are never mistaken for each other.
const LANTERN = defaultsFor("lantern");

const FLASH = "eleven_flash_v2_5";
let flashRefused = false;
const phraseCache = new Map();   // "voice|text" → Uint8Array (short phrases only)
const MAX_PHRASES = 40;

const clean = (t) => forSpeech(String(t ?? "")).replace(/[*_#`>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 900);   // (the name as it's said: lib/naming.mjs)
function voiceKey(as = null) { const r = voice.voiceReady(); return as === "lantern" ? `${r.provider}|lantern` : `${r.provider}|${r.voiceId ?? settings.get().openaiVoice ?? ""}`; }

let fake = null;
export function _setFake(fn) { fake = fn; }
export function _reset() { phraseCache.clear(); flashRefused = false; }

export async function warm() {
  const p = voice.ttsProvider();
  const url = p === "elevenlabs" ? "https://api.elevenlabs.io/v1/models" : p === "openai" ? "https://api.openai.com/v1/models" : null;
  if (!url) return false;
  try { await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(4000) }); return true; } catch { return false; }
}

export async function openStream(text, { signal = null, as = null } = {}) {
  const say = clean(text);
  if (!say) throw new Error("nothing to say");
  if (fake) return fake(say, { as });
  const key = voiceKey(as) + "|" + say;
  if (phraseCache.has(key)) { const buf = phraseCache.get(key); return { stream: new ReadableStream({ start(c) { c.enqueue(buf); c.close(); } }), type: "audio/mpeg", cached: true }; }
  const p = voice.ttsProvider();
  let res, model = null;
  if (p === "elevenlabs") {
    const r = voice.voiceReady(), s = settings.get();
    const speed = Math.max(0.7, Math.min(1.2, 1 + (s.speedAdj ?? 0)));
    const want = cfg.get().ttsModel;
    const models = want && want !== "auto" ? [want] : flashRefused ? [process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5"] : [FLASH, process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5"];
    for (const m of models) {
      res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${as === "lantern" ? LANTERN.elevenId : r.voiceId}/stream?output_format=mp3_22050_32&optimize_streaming_latency=3`, {
        method: "POST", signal: signal ?? AbortSignal.timeout(20_000),
        headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "", "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text: say, model_id: m, voice_settings: { stability: 0.5, similarity_boost: 0.75, use_speaker_boost: true, speed } }),
      });
      if (res.ok) { model = m; break; }
      if (m === FLASH && res.status >= 400 && res.status < 500) { flashRefused = true; continue; }
      break;
    }
  } else if (p === "openai") {
    const s = settings.get();
    res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST", signal: signal ?? AbortSignal.timeout(20_000),
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`, "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts", voice: as === "lantern" ? LANTERN.openai : s.openaiVoice || voice.OPENAI_DEFAULT, input: say, response_format: "mp3" }),
    });
    model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
  } else return { browser: true };
  if (!res?.ok || !res.body) throw Object.assign(new Error(`voice ${res?.status ?? "failed"}`), { status: 502 });
  // keep short, repeatable phrases for next time
  if (say.length <= 40) {
    const [a, b] = res.body.tee();
    collect(b).then((buf) => { phraseCache.set(key, buf); if (phraseCache.size > MAX_PHRASES) phraseCache.delete(phraseCache.keys().next().value); }).catch(() => {});
    return { stream: a, type: "audio/mpeg", model };
  }
  return { stream: res.body, type: "audio/mpeg", model };
}

async function collect(stream) {
  const parts = []; let n = 0;
  for await (const c of stream) { parts.push(c); n += c.length; }
  const out = new Uint8Array(n); let o = 0; for (const c of parts) { out.set(c, o); o += c.length; }
  return out;
}

// Pre-make the acknowledgement phrases so they play instantly.
export async function prime(phrases = ["Yes?", "Mm-hm.", "One sec."]) {
  for (const t of phrases) { try { const r = await openStream(t); if (r.stream) await collect(r.stream); } catch { /* not critical */ } }
}
