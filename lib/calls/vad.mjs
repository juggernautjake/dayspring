// Voice activity detection for calls: cuts a stream of 16 kHz mono 16-bit PCM into utterances, fast.
//
// Energy plus zero-crossing rate, with a noise floor that follows the room: quiet stretches pull it down quickly,
// loud ones only slowly, so a steady hum or music bed doesn't count as speech. An utterance starts after a few frames
// of speech (with a short pre-roll so the first syllable isn't clipped) and ends after `hangMs` of quiet. That hangover
// is most of the wait between someone finishing a sentence and Dayspring starting to think, so it's short (450 ms by
// default; the old Tune in waited 700 ms). No words are kept here, only audio in memory until it's handed on.
//
//   const v = createVad({ hangMs, onUtterance(pcm, info), onSpeechStart(), onSpeechEnd() })
//   v.push(pcm)         feed any number of samples
//   v.speaking          true while someone is talking (used for barge-in)
//   v.reset()
export const RATE = 16000;
const FRAME = 320;                     // 20 ms

export function frameStats(f) {
  let sum = 0, zc = 0;
  for (let i = 0; i < f.length; i++) { sum += f[i] * f[i]; if (i && (f[i] >= 0) !== (f[i - 1] >= 0)) zc++; }
  return { rms: Math.sqrt(sum / f.length), zcr: zc / f.length };
}

export function createVad({
  hangMs = 450, preMs = 300, minMs = 450, maxMs = 12_000, startFrames = 3, minRms = 350, ratio = 3.2,
  onUtterance = () => {}, onSpeechStart = () => {}, onSpeechEnd = () => {}, now = () => Date.now(),
} = {}) {
  const END = Math.max(5, Math.round(hangMs / 20)), PRE = Math.round(preMs / 20), MIN = Math.round(minMs / 20), MAX = Math.round(maxMs / 20);
  let floor = 200, run = 0, quiet = 0, rec = null, pre = [], carry = new Int16Array(0), speechAt = 0;
  const v = {
    speaking: false,
    get floor() { return floor; },
    push(pcm) {
      const buf = carry.length ? cat([carry, pcm]) : pcm;
      let i = 0;
      for (; i + FRAME <= buf.length; i += FRAME) frame(buf.subarray(i, i + FRAME));
      carry = buf.slice(i);
    },
    reset() { rec = null; pre = []; run = 0; quiet = 0; carry = new Int16Array(0); if (v.speaking) { v.speaking = false; onSpeechEnd(); } },
    // for barge-in: how long the current speech has lasted (ms), 0 when quiet
    speechMs() { return v.speaking ? now() - speechAt : 0; },
  };
  function isSpeech(f) {
    const { rms, zcr } = frameStats(f);
    floor = rms < floor ? floor * 0.9 + rms * 0.1 : floor * 0.9995 + rms * 0.0005;
    // voiced speech: loud enough over the floor, and not pure hiss (very high zero-crossings) or a hum (almost none)
    return rms > Math.max(minRms, floor * ratio) && zcr > 0.01 && zcr < 0.45;
  }
  function frame(f) {
    const s = isSpeech(f);
    if (!rec) {
      pre.push(f); if (pre.length > PRE) pre.shift();
      run = s ? run + 1 : 0;
      if (run >= startFrames) { rec = [...pre]; pre = []; quiet = 0; v.speaking = true; speechAt = now() - run * 20; onSpeechStart(); }
      return;
    }
    rec.push(f);
    quiet = s ? 0 : quiet + 1;
    if (quiet >= END || rec.length >= MAX) {
      const frames = rec; rec = null; run = 0;
      v.speaking = false; onSpeechEnd();
      const voiced = frames.length - quiet;
      if (voiced >= MIN) onUtterance(cat(frames.slice(0, frames.length - Math.max(0, quiet - 5))), { seconds: frames.length * 0.02, endedAt: now(), hangMs: quiet * 20 });
    }
  }
  return v;
}

export function cat(parts) {
  const n = parts.reduce((a, p) => a + p.length, 0), out = new Int16Array(n);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// Test helpers: synthetic audio (voiced "speech" = a buzzy tone with some variation, silence = faint noise).
export function synthSpeech(ms, amp = 4000) {
  const n = Math.round(RATE * ms / 1000), out = new Int16Array(n);
  for (let i = 0; i < n; i++) { const t = i / RATE; out[i] = Math.round(amp * (0.6 * Math.sin(2 * Math.PI * 180 * t) + 0.3 * Math.sin(2 * Math.PI * 360 * t) + 0.1 * Math.sin(2 * Math.PI * 1100 * t)) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 4 * t))); }
  return out;
}
export function synthSilence(ms, amp = 40) {
  const n = Math.round(RATE * ms / 1000), out = new Int16Array(n);
  let s = 12345; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; out[i] = Math.round(((s / 0x7fffffff) - 0.5) * 2 * amp); }
  return out;
}
