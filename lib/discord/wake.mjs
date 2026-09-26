// Is someone talking to Dayspring? Speech-to-text hears the name many ways ("Day spring", "Dayspring's", "they spring").
// → the request when what they said STARTS with the name (after at most a filler like "hey", "okay", "um"), "" when they
// only said the name, null otherwise. A name mid-sentence ("did you see Dayspring yet?") is people talking about it, not to it.
import * as owner from "../owner.mjs";

const VARIANTS = ["dayspring", "day spring", "day-spring", "daysprings", "day springs", "they spring", "days spring", "dace spring", "hey spring"];

function names() {
  const a = String(owner.assistant?.() ?? "Dayspring").toLowerCase().trim();
  return [...new Set([a, ...(a === "dayspring" ? VARIANTS : [])])].filter(Boolean);
}
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function wakeCommand(text, extra = []) {
  const t = String(text ?? "").toLowerCase().replace(/[“”"]/g, "").trim();
  if (!t) return null;
  for (const n of [...names(), ...extra.map((x) => String(x).toLowerCase())]) {
    const m = new RegExp(`^(?:(?:hey|ok|okay|hi|yo|so|um|uh|and|alright)[,.]?\\s+)?${escape(n)}'?s?\\b[,.!?:]?\\s*(.*)$`, "i").exec(t);
    if (m) return m[1].replace(/^[,.!?\s]+/, "").trim();
  }
  return null;
}

// Whisper sometimes "hears" these in silence or noise; never treat them as a request.
const HALLUCINATIONS = /^(\[.*\]|\(.*\)|thank you\.?|thanks for watching\.?|you|bye\.?|\.+|music|silence)$/i;
export const isNoise = (text) => !String(text ?? "").trim() || HALLUCINATIONS.test(String(text).trim());
