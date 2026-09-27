// Open the connections to the AI and the voice a moment before they're needed. A fresh secure connection costs
// ~250-400 ms, and Node closes idle ones after a few seconds, so between questions they're usually gone. A bare HEAD
// request (no words, nothing billed) re-opens them while the question is still being transcribed, and the real request
// then reuses the open connection.
//   warm()  → at most once every 2.5 s; returns right away
import * as llm from "../llm.mjs";
import * as voice from "../voice.mjs";

let last = 0;
const head = (url) => fetch(url, { method: "HEAD", signal: AbortSignal.timeout(4000) }).catch(() => null);
export function urls() {
  const out = [];
  const p = llm.provider();
  if (p === "anthropic") out.push("https://api.anthropic.com/v1/messages");
  else if (p !== "none" && p !== "ollama" && llm.PROVIDERS[p]?.base) out.push(llm.PROVIDERS[p].base);
  const t = voice.ttsProvider();
  if (t === "elevenlabs") out.push("https://api.elevenlabs.io/v1/models");
  else if (t === "openai") out.push("https://api.openai.com/v1/models");
  return out;
}
let fake = null;
export function _setFake(fn) { fake = fn; last = 0; }
export function warm({ now = Date.now() } = {}) {
  if (now - last < 2500) return false;
  last = now;
  for (const u of urls()) (fake ?? head)(u);
  return true;
}
