// Audio for your Discord bot.
//   in:  Discord sends each speaker as Opus packets (48 kHz stereo). decodeUtterance() collects one utterance and returns
//        16 kHz mono 16-bit PCM for speech-to-text (lib/stt.mjs).
//   out: speechResource(text) turns a reply into something @discordjs/voice can play: Dayspring's own voice (ElevenLabs
//        or OpenAI, lib/voice.mjs), or, with the free browser voices (which only exist on the Dayspring screen), the
//        voice built into Windows. ffmpeg (ffmpeg-static) converts it to Opus.
import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import prism from "prism-media";
import { createAudioResource, StreamType } from "@discordjs/voice";
import * as voice from "../voice.mjs";
import { forSpeech } from "../selfname.mjs";

// 48 kHz interleaved stereo s16le → 16 kHz mono s16le (average the two channels and each group of three samples,
// which is also a gentle low-pass before dropping to a third of the rate).
export function to16kMono(buf48stereo) {
  const src = new Int16Array(buf48stereo.buffer, buf48stereo.byteOffset, Math.floor(buf48stereo.byteLength / 2));
  const frames = Math.floor(src.length / 2), out = new Int16Array(Math.floor(frames / 3));
  for (let i = 0; i < out.length; i++) {
    const f = i * 3 * 2;
    out[i] = Math.round((src[f] + src[f + 1] + src[f + 2] + src[f + 3] + src[f + 4] + src[f + 5]) / 6);
  }
  return out;
}

// One utterance from a receiver subscription (an Opus packet stream that ends after a short silence).
// Resolves { pcm: Int16Array (16 kHz mono), seconds } — or null if it was too short to be words.
export function decodeUtterance(opusStream, { maxSeconds = 15, minSeconds = 0.45 } = {}) {
  return new Promise((resolve) => {
    const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
    const chunks = []; let bytes = 0, done = false;
    const max = maxSeconds * 48000 * 2 * 2;
    const finish = () => {
      if (done) return; done = true;
      try { opusStream.destroy(); } catch { /* already closed */ }
      const all = Buffer.concat(chunks), seconds = all.length / (48000 * 2 * 2);
      resolve(seconds < minSeconds ? null : { pcm: to16kMono(all), seconds });
    };
    decoder.on("data", (d) => { chunks.push(d); bytes += d.length; if (bytes >= max) finish(); });
    decoder.on("end", finish); decoder.on("error", finish);
    opusStream.on("error", finish);
    opusStream.pipe(decoder);
  });
}

// Quiet or noise only? (RMS of the whole utterance, 16-bit scale.) Skips sending coughs and keyboard clicks to Whisper.
export function loudEnough(pcm, floor = 350) {
  let sum = 0; for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / Math.max(1, pcm.length)) >= floor;
}

// Windows' own voice (free, offline) as a WAV file: used when Dayspring's voice is the browser's.
export async function windowsSpeech(text) {
  const file = join(tmpdir(), `dayspring-discord-${randomUUID()}.wav`);
  const script = "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; " +
    "try { $v = $s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'en-*' } | Select-Object -First 1; if ($v) { $s.SelectVoice($v.VoiceInfo.Name) } } catch {}; " +
    "$s.Rate = 1; $s.SetOutputToWaveFile($env:DS_WAV); $s.Speak([Console]::In.ReadToEnd()); $s.Dispose()";
  await new Promise((ok, bad) => {
    const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, DS_WAV: file }, windowsHide: true });
    let err = ""; p.stderr.on("data", (d) => (err += d));
    p.on("error", bad); p.on("close", (c) => (c === 0 ? ok() : bad(new Error("Windows speech failed: " + err.slice(0, 200)))));
    p.stdin.end(forSpeech(String(text)).slice(0, 1500));   // (the assistant's name as it's said: lib/naming.mjs)
  });
  try { return await readFile(file); } finally { rm(file, { force: true }).catch(() => {}); }
}

// Audio for a reply: Dayspring's chosen voice, or Windows' voice when that's the browser's (free) voice.
export async function speechAudio(text) {
  try { return { buf: await voice.tts(text, {}), kind: "mp3" }; }
  catch (e) {
    if (e.status === 204 || e.status === 503) return { buf: await windowsSpeech(text), kind: "wav" };
    throw e;
  }
}
// The quick way for calls: the voice streams in (lib/calls/tts-stream.mjs) and plays as it arrives, instead of waiting
// for the whole sentence to be made. The browser (free) voice falls back to Windows' voice as above.
export async function streamResource(text, { signal = null } = {}) {
  const { openStream } = await import("../calls/tts-stream.mjs");
  let r = null;
  try { r = await openStream(text, { signal }); } catch (e) { if (signal?.aborted) throw e; r = null; }
  if (!r || r.browser || !r.stream) return speechResource(text);
  return { resource: createAudioResource(Readable.fromWeb(r.stream), { inputType: StreamType.Arbitrary }), kind: "mp3-stream", model: r.model ?? null };
}
export async function speechResource(text) {
  const { buf, kind } = await speechAudio(text);
  // ffmpeg decodes mp3/wav and prism encodes Opus (StreamType.Arbitrary runs it through ffmpeg-static)
  return { resource: createAudioResource(Readable.from([buf]), { inputType: StreamType.Arbitrary }), kind, bytes: buf.length };
}
