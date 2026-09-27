// Streaming answers for calls: the AI's words arrive as they're written, so the first sentence can be spoken before the
// rest exists. Claude streams through the Anthropic SDK; ChatGPT, Grok and Ollama through their OpenAI-style
// "stream: true" server-sent events. Any trouble falls back to one normal (non-streamed) answer.
//
//   for await (const piece of streamText({ system, prompt, maxTokens, model })) …
//   fastModel()  the quickest model this provider offers (for calls), unless calls.json names one
import Anthropic from "@anthropic-ai/sdk";
import * as llm from "../llm.mjs";
import * as cfg from "./config.mjs";

let fastCache = null;
export async function fastModel() {
  const want = cfg.get().fastModel;
  if (want && want !== "auto") return want;
  if (fastCache) return fastCache;
  const p = llm.provider();
  let list = [];
  try { list = await llm.models(p); } catch { list = []; }
  // the smallest, quickest model in the provider's own list: Claude's Haiku, GPT's mini/nano, Grok's mini/fast
  const pick = { anthropic: /haiku/i, openai: /(nano|mini)/i, xai: /(mini|fast)/i }[p];
  fastCache = (pick && list.find((m) => pick.test(m))) || llm.modelName();
  return fastCache;
}
export function _resetFast() { fastCache = null; }

// test hook: replace the network with a fake stream
let fake = null;
export function _setFake(fn) { fake = fn; }

export async function* streamText({ system = "", prompt, maxTokens = 220, model = null, timeoutMs = 25_000, signal = null } = {}) {
  if (fake) { yield* fake({ system, prompt, maxTokens, model }); return; }
  if (!llm.ready()) throw Object.assign(new Error("no AI is set up"), { status: 401 });
  const p = llm.provider(), m = model || llm.modelName();
  let gave = false;
  try {
    if (p === "anthropic") {
      const client = new Anthropic({ timeout: timeoutMs, maxRetries: 0 });
      const stream = await client.messages.create({ model: m, max_tokens: maxTokens, system: system || undefined, messages: [{ role: "user", content: prompt }], stream: true }, signal ? { signal } : undefined);
      for await (const ev of stream) if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") { gave = true; yield ev.delta.text; }
      return;
    }
    for await (const piece of openaiStream(p, m, system, prompt, maxTokens, timeoutMs, signal)) { gave = true; yield piece; }
  } catch (e) {
    if (signal?.aborted || gave) return;   // stopped on purpose, or part of the answer is already out
    // one normal answer instead (the model name may not exist on this key, or streaming is blocked)
    const text = await llm.complete({ system, prompt, maxTokens, timeoutMs });
    yield text;
  }
}

async function* openaiStream(p, model, system, prompt, maxTokens, timeoutMs, signal) {
  const base = p === "ollama" ? `${(process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "")}/v1` : llm.PROVIDERS[p].base;
  const headers = { "content-type": "application/json" };
  if (p !== "ollama") headers.authorization = `Bearer ${process.env[llm.PROVIDERS[p].keyVar]}`;
  const body = { model, stream: true, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }] };
  if (p === "openai") body.max_completion_tokens = maxTokens; else body.max_tokens = maxTokens;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  signal?.addEventListener?.("abort", () => ctl.abort(), { once: true });
  try {
    const res = await fetch(`${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal: ctl.signal });
    if (!res.ok || !res.body) throw new Error(`${llm.PROVIDERS[p].label} answered ${res.status}`);
    const dec = new TextDecoder(); let buf = "";
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try { const d = JSON.parse(data).choices?.[0]?.delta?.content; if (d) yield d; } catch { /* keep-alive or partial */ }
      }
    }
  } finally { clearTimeout(t); }
}
