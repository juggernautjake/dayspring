// How the assistant calls itself, and how its name is said: small, so the voice, the personality and every AI's prompt
// can use it without loading the wake word matcher (lib/naming.mjs re-exports all of it).
//   name() · renamed() · fixReply(text) · promptNote({ persona }) · forSpeech(text)
// The choice: the name is who the assistant is ("Nova"); "Dayspring" stays the app's name. A personality is only a style
// of speaking: a pirate Nova is still Nova.
import * as owner from "./owner.mjs";

export const PRODUCT = "Dayspring";
export const name = () => owner.assistant();
export const renamed = () => name() !== PRODUCT;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// for the voice: the name as it's said. "Aoife here" → "Ee-fa here"
export function forSpeech(text) {
  const o = owner.get(), s = String(text ?? "");
  let out = s;
  if (o.assistantSay && o.assistantName) out = out.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${esc(o.assistantName)}(?=$|[^\\p{L}\\p{N}])`, "giu"), (m, a) => a + o.assistantSay);
  for (const [w, say] of Object.entries(o.wakeSay ?? {})) if (say && w && !/\s/.test(w)) out = out.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w)}(?=$|[^\\p{L}\\p{N}])`, "giu"), (m, a) => a + say);
  return out;
}
// An answer (Claude, Ollama, the offline lines, a personality's phrase) that calls itself Dayspring: its own name instead.
// Only where it's talking about itself ("I'm Dayspring", "Dayspring here", "this is Dayspring"); "the Dayspring screen"
// and "Settings in Dayspring" are the app and stay.
export function fixReply(text) {
  const s = String(text ?? "");
  if (!renamed() || !/dayspring/i.test(s)) return s;
  const A = name();
  return s
    .replace(/\b(I'm|I am|I’m|this is|it's|it’s|it is|call me|my name is|my name's|name's|named|called|known as|me,)\s+Dayspring\b(?!\s+(?:screen|app|window|mini|settings|guide|update|notifications|speech))/gi, (m, a) => `${a} ${A}`)
    .replace(/\bDayspring here\b/gi, `${A} here`)
    .replace(/^Dayspring:\s*/i, "")
    .replace(/\bthe regular Dayspring\b/gi, `the regular ${A}`)
    .replace(/\b(Love|Cheers|Yours|Best|Warmly),\s*Dayspring\b/g, `$1, ${A}`)
    .replace(/(^|[.!?]\s+)Dayspring (thinks|says|signing off|at your service)\b/g, (m, a, v) => `${a}${A} ${v}`);
}
// the line for every AI prompt (Claude, Ollama, the call pipeline all include the personality block)
export function promptNote({ persona = false } = {}) {
  const A = name();
  if (!renamed()) return persona ? `Your name is ${A}. The personality is only a style: you're still ${A}.` : "";
  return `Your name is ${A}. Always call yourself ${A}; "Dayspring" is only the name of the app you run in, never your name.${persona ? ` The personality is only a style: you're still ${A}.` : ""}`;
}
