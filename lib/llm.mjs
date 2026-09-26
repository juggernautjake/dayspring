// The AI "brain", whichever one the user picked: Claude (Anthropic), ChatGPT (OpenAI), Grok (xAI), or a free local
// model through Ollama. Dayspring works without any of them (built-in skills and offline answers); with one, it can hold
// real conversations and use its tools (schedule, files, music, reminders…).
//
// Configured in .env (the setup wizard writes it):
//   AI_PROVIDER = anthropic | openai | xai | ollama | none
//   ANTHROPIC_API_KEY / OPENAI_API_KEY / XAI_API_KEY      OLLAMA_URL (default http://127.0.0.1:11434)
//   AI_MODEL (optional; each provider has a sensible default)
//
// Conversations are kept in one neutral shape (Anthropic-style blocks: text, tool_use, tool_result) so switching
// providers never breaks a conversation. OpenAI-compatible providers get translated on the way in and out.
import Anthropic from "@anthropic-ai/sdk";

export const PROVIDERS = {
  anthropic: { label: "Claude (Anthropic)", keyVar: "ANTHROPIC_API_KEY", defaultModel: "claude-sonnet-5", webSearch: true, keyUrl: "https://platform.claude.com/settings/keys" },
  openai: { label: "ChatGPT (OpenAI)", keyVar: "OPENAI_API_KEY", defaultModel: "gpt-5-mini", base: "https://api.openai.com/v1", keyUrl: "https://platform.openai.com/api-keys" },
  xai: { label: "Grok (xAI)", keyVar: "XAI_API_KEY", defaultModel: "grok-4", base: "https://api.x.ai/v1", keyUrl: "https://console.x.ai/team/default/api-keys" },
  ollama: { label: "Local model (Ollama, free)", keyVar: null, defaultModel: "llama3.1:8b", base: null, keyUrl: "https://ollama.com/download" },
};

export function provider() {
  const p = String(process.env.AI_PROVIDER ?? "").toLowerCase();
  if (PROVIDERS[p]) return p;
  // older installs: a Claude key alone means Claude
  if (!p && process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "none";
}
export function ready() {
  const p = provider();
  if (p === "none") return false;
  if (p === "ollama") return true;
  return Boolean(process.env[PROVIDERS[p].keyVar]);
}
export function modelName() {
  const p = provider();
  if (p === "none") return "none";
  return process.env.AI_MODEL || (p === "anthropic" ? process.env.DAYSPRING_MODEL : "") || PROVIDERS[p].defaultModel;
}
export const label = () => (provider() === "none" ? "no AI (built-in skills only)" : `${PROVIDERS[provider()].label} · ${modelName()}`);
export const canSearchWeb = () => provider() === "anthropic";
const baseUrl = (p) => (p === "ollama" ? `${(process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "")}/v1` : PROVIDERS[p].base);

// ---- one-shot text (short compositions: announcements, rundowns, summaries) ----
export async function complete({ system = "", prompt, maxTokens = 400, timeoutMs = 45_000 }) {
  const p = provider();
  if (!ready()) throw Object.assign(new Error("no AI is set up"), { status: 401 });
  if (p === "anthropic") {
    const client = new Anthropic({ timeout: timeoutMs, maxRetries: 1 });
    const r = await client.messages.create({ model: modelName(), max_tokens: maxTokens, system: system || undefined, messages: [{ role: "user", content: prompt }] });
    return r.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  }
  const r = await openaiChat(p, { messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }], max_tokens: maxTokens }, timeoutMs);
  return String(r.choices?.[0]?.message?.content ?? "").trim();
}

async function openaiChat(p, body, timeoutMs = 60_000) {
  const headers = { "content-type": "application/json" };
  if (p !== "ollama") headers.authorization = `Bearer ${process.env[PROVIDERS[p].keyVar]}`;
  const payload = { model: modelName(), ...body };
  // newer OpenAI models take max_completion_tokens instead of max_tokens
  if (p === "openai" && payload.max_tokens) { payload.max_completion_tokens = payload.max_tokens; delete payload.max_tokens; }
  const res = await fetch(`${baseUrl(p)}/chat/completions`, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.error?.message ?? `${PROVIDERS[p].label} answered ${res.status}`), { status: res.status });
  return j;
}

// ---- a conversation with tools, for OpenAI-compatible providers (the Anthropic path lives in assistant.mjs) ----
// history: neutral (Anthropic-style) messages. tools: [{ name, description, input_schema }]. runTool(name, input) → any.
export async function chatWithToolsOpenAI({ system, history, userText, tools, runTool, maxRounds = 8 }) {
  const p = provider();
  const neutral = [...history, { role: "user", content: userText }];
  const fnTools = tools.filter((t) => t.input_schema).map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.input_schema } }));
  let reply = "", usage = null;
  for (let round = 0; round < maxRounds; round++) {
    const r = await openaiChat(p, { messages: [{ role: "system", content: system }, ...toOpenAI(neutral)], tools: fnTools.length ? fnTools : undefined, max_tokens: 1200 });
    usage = r.usage ? { input_tokens: r.usage.prompt_tokens, output_tokens: r.usage.completion_tokens } : usage;
    const msg = r.choices?.[0]?.message ?? {};
    const calls = msg.tool_calls ?? [];
    const blocks = [];
    if (msg.content) blocks.push({ type: "text", text: String(msg.content) });
    for (const c of calls) { let input = {}; try { input = JSON.parse(c.function?.arguments || "{}"); } catch { /* bad JSON from the model */ } blocks.push({ type: "tool_use", id: c.id, name: c.function?.name, input }); }
    neutral.push({ role: "assistant", content: blocks.length ? blocks : [{ type: "text", text: "" }] });
    if (!calls.length) { reply = String(msg.content ?? "").trim(); break; }
    const results = [];
    for (const b of blocks.filter((x) => x.type === "tool_use")) {
      try { let out = JSON.stringify(await runTool(b.name, b.input)); if (out.length > 60_000) out = out.slice(0, 60_000) + "…(cut off)"; results.push({ type: "tool_result", tool_use_id: b.id, content: out }); }
      catch (err) { results.push({ type: "tool_result", tool_use_id: b.id, content: `Error: ${err.message}`, is_error: true }); }
    }
    neutral.push({ role: "user", content: results });
  }
  return { reply: reply || "Done.", history: neutral, usage };
}
// neutral → OpenAI chat messages
function toOpenAI(msgs) {
  const out = [];
  for (const m of msgs) {
    if (typeof m.content === "string") { out.push({ role: m.role, content: m.content }); continue; }
    const blocks = Array.isArray(m.content) ? m.content : [];
    if (m.role === "assistant") {
      const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
      const calls = blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      out.push({ role: "assistant", content: text || (calls.length ? null : ""), ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      const results = blocks.filter((b) => b.type === "tool_result");
      for (const r of results) out.push({ role: "tool", tool_call_id: r.tool_use_id, content: typeof r.content === "string" ? r.content : JSON.stringify(r.content) });
      const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
      if (text) out.push({ role: "user", content: text });
    }
  }
  return out;
}

// ---- the setup wizard's "Test" button ----
export async function test(p = provider(), key, model) {
  const saved = { AI_PROVIDER: process.env.AI_PROVIDER, AI_MODEL: process.env.AI_MODEL };
  const keyVar = PROVIDERS[p]?.keyVar;
  const savedKey = keyVar ? process.env[keyVar] : null;
  try {
    process.env.AI_PROVIDER = p; if (model) process.env.AI_MODEL = model; if (keyVar && key) process.env[keyVar] = key;
    const t0 = Date.now();
    const text = await complete({ prompt: "Reply with exactly: ready", maxTokens: 20, timeoutMs: 30_000 });
    return { ok: true, text, ms: Date.now() - t0, model: modelName() };
  } catch (e) { return { ok: false, error: e.message }; }
  finally { process.env.AI_PROVIDER = saved.AI_PROVIDER ?? ""; process.env.AI_MODEL = saved.AI_MODEL ?? ""; if (keyVar) { if (savedKey != null) process.env[keyVar] = savedKey; else delete process.env[keyVar]; } }
}
// Models the user can pick from (for the wizard's dropdown)
export async function models(p = provider()) {
  try {
    if (p === "anthropic") return ["claude-sonnet-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"];
    if (p === "ollama") { const r = await fetch(`${(process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(5000) }); const j = await r.json(); return (j.models ?? []).map((m) => m.name); }
    const r = await fetch(`${baseUrl(p)}/models`, { headers: { authorization: `Bearer ${process.env[PROVIDERS[p].keyVar]}` }, signal: AbortSignal.timeout(8000) });
    const j = await r.json(); return (j.data ?? []).map((m) => m.id).sort();
  } catch { return [PROVIDERS[p]?.defaultModel].filter(Boolean); }
}
