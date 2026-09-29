// Is someone talking to the assistant? Speech-to-text hears a name many ways ("Day spring", "compute a" for "Computa"),
// so this asks lib/wakeword.mjs, which every listener shares (the name, its pronunciation, the wake words, what
// training learned, sound-alikes).
// → the request when what they said STARTS with a wake word (after at most a filler like "hey", "okay", "um"), "" when
// they only said it, null otherwise. A name mid-sentence ("did you see Nova yet?") is people talking about it, not to it.
import * as wakeword from "../wakeword.mjs";

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function wakeCommand(text, extra = []) {
  const t = String(text ?? "").replace(/[“”"]/g, "").trim();
  if (!t) return null;
  const r = wakeword.wakeCommand(t);
  if (r !== null) return r.replace(/^[,.!?\s]+/, "").trim();
  for (const n of extra.map((x) => String(x).toLowerCase()).filter(Boolean)) {
    const m = new RegExp(`^(?:(?:hey|ok|okay|hi|yo|so|um|uh|and|alright)[,.]?\\s+)?${escape(n)}'?s?\\b[,.!?:]?\\s*(.*)$`, "i").exec(t.toLowerCase());
    if (m) return t.slice(t.length - m[1].length).replace(/^[,.!?\s]+/, "").trim();
  }
  return null;
}

// Whisper sometimes "hears" these in silence or noise; never treat them as a request.
const HALLUCINATIONS = /^(\[.*\]|\(.*\)|thank you\.?|thanks for watching\.?|you|bye\.?|\.+|music|silence)$/i;
export const isNoise = (text) => !String(text ?? "").trim() || HALLUCINATIONS.test(String(text).trim());
