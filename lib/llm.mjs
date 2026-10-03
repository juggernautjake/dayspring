// The AI "brain", whichever one the user picked: Claude (Anthropic), ChatGPT (OpenAI), Grok (xAI), or a free local
// model through Ollama. Dayspring works without any of them (built-in skills and offline answers); with one, it can hold
// real conversations and use its tools (schedule, files, music, reminders…).
//
// Configured in .env (the setup wizard writes it):
//   AI_PROVIDER = anthropic | openai | xai | ollama | none
//   ANTHROPIC_API_KEY / OPENAI_API_KEY / XAI_API_KEY      OLLAMA_URL (default http://127.0.0.1:11434)
//   AI_MODEL (optional; each provider has a sensible default)
//   Local models (Settings → AI brain → Ollama; all optional): OLLAMA_CHAT_MODEL (a bigger model for plain conversation),
//   OLLAMA_VISION_MODEL, OLLAMA_EMBED_MODEL (auto | off | a name), OLLAMA_NUM_CTX (4096), OLLAMA_MAX_CTX (8192),
//   OLLAMA_TOOLS_N (10), OLLAMA_KEEP_ALIVE (30m | -1 = always while Dayspring runs), OLLAMA_FIRST_TOKEN_S (8),
//   OLLAMA_FALLBACK (offline | claude)
//
// Conversations are kept in one neutral shape (Anthropic-style blocks: text, tool_use, tool_result) so switching
// providers never breaks a conversation. OpenAI-compatible providers get translated on the way in and out; the local
// path (native Ollama API, tool selection, argument repair) is ecosystem-core's llm-local.mjs, glued in lib/ollama.
import Anthropic from "@anthropic-ai/sdk";
import { AsyncLocalStorage } from "node:async_hooks";
import { createOllama, normalizeOllamaUrl } from "../vendor/ecosystem-core/lib/llm-local.mjs";

export const PROVIDERS = {
  anthropic: { label: "Claude (Anthropic)", keyVar: "ANTHROPIC_API_KEY", defaultModel: "claude-sonnet-5", webSearch: true, keyUrl: "https://platform.claude.com/settings/keys" },
  openai: { label: "ChatGPT (OpenAI)", keyVar: "OPENAI_API_KEY", defaultModel: "gpt-5-mini", base: "https://api.openai.com/v1", keyUrl: "https://platform.openai.com/api-keys" },
  xai: { label: "Grok (xAI)", keyVar: "XAI_API_KEY", defaultModel: "grok-4", base: "https://api.x.ai/v1", keyUrl: "https://console.x.ai/team/default/api-keys" },
  ollama: { label: "Local model (Ollama, free)", keyVar: null, defaultModel: "llama3.1:8b", base: null, keyUrl: "https://ollama.com/download" },
};

// asProvider("anthropic", fn): run fn with another provider for just that work (the local model's fallback to Claude),
// without touching the settings or any other request that's in flight
const override = new AsyncLocalStorage();
export function asProvider(p, fn) { return override.run({ ...(override.getStore() ?? {}), provider: p, model: null }, fn); }
// withModel("claude-haiku-4-5-20251001", fn): this one job uses that model ("Pick for me": quick commands on the fast model)
export function withModel(model, fn) { return model ? override.run({ ...(override.getStore() ?? {}), model }, fn) : fn(); }
const configured = () => {
  const p = String(process.env.AI_PROVIDER ?? "").toLowerCase();
  if (PROVIDERS[p]) return p;
  // older installs: a Claude key alone means Claude
  if (!p && process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "none";
};
export function provider() {
  const o = override.getStore()?.provider;
  return o && PROVIDERS[o] ? o : configured();
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
  const forced = override.getStore()?.model;
  if (forced) return forced;
  // borrowed for one job (asProvider): that provider's own model, never the local model's name
  if (p !== configured()) return p === "anthropic" ? claudeModel() : PROVIDERS[p].defaultModel;
  return process.env.AI_MODEL || (p === "anthropic" ? process.env.DAYSPRING_MODEL : "") || PROVIDERS[p].defaultModel;
}
export const claudeModel = () => process.env.DAYSPRING_MODEL || (configured() === "anthropic" && process.env.AI_MODEL) || PROVIDERS.anthropic.defaultModel;
export const claudeAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY);

// ---- "Pick for me" (off unless AI_AUTO_MODEL=1; Settings → AI brain, or the ⋯ menu): quick commands go to the
// provider's fast model, everything else (conversation, writing, summaries) to the chosen one. Read at call time.
export const ANTHROPIC_MODELS = ["claude-sonnet-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"];
export const autoModelOn = () => /^(1|true|on)$/i.test(process.env.AI_AUTO_MODEL ?? "");
const sizeOf = (m) => { const x = /(\d+(?:\.\d+)?)b\b/i.exec(String(m)); return x ? Number(x[1]) : 99; };
export function fastModelFor(p = provider()) {
  if (p === "anthropic") return "claude-haiku-4-5-20251001";
  if (p === "openai") return "gpt-5-mini";
  if (p === "ollama") { const o = localOptions(); return [o.model, o.chatModel].filter(Boolean).sort((a, b) => sizeOf(a) - sizeOf(b))[0]; }
  return modelName();
}
// Voice turns want speed: short commands, schedule changes and quick questions go to the fast model. Writing, explaining,
// planning, coding, and anything deep (faith and Scripture, sparring, a serious talk, feelings) stays on the main one.
const QUICK_NOT = /\b(write|draft|compose|summari[sz]e|explain|plan|essay|letter|story|poem|organi[sz]e|compare|analy[sz]e|why|how come|what if|teach|help me (think|understand|decide|figure)|brainstorm|review|walk me through|go through|in detail|step by step|pros and cons|code|coding|program|programming|debug|bug|refactor|script|function|claude code|theolog\w*|doctrine|scripture|bible|gospel|verse|passage|jesus|christ|god|holy spirit|faith|pray|prayer|sin|salvation|church|apologetic\w*|argue|debate|spar|devil'?s advocate|convince me|meaning of|philosoph\w*|feel|feeling|struggling|anxious|worried|depressed|lonely|grief|serious)\b/i;
// a command or a quick question can run a little longer and still be quick ("move my 9 a.m. meeting with Rich and Jess to
// Thursday at 10 and remind me 15 minutes before")
const COMMANDISH = /^(?:(?:hey |ok(?:ay)? |so |and |please |can you |could you |would you )*)(add|move|schedule|reschedule|put|push|pull|cancel|delete|remove|remind|set|change|rename|mark|book|block|clear|swap|bump|play|pause|stop|skip|turn|open|close|show|find|search|look up|start|text|call|what|what's|whats|when|where|who|which|is|are|do|does|did|how many|how much|how long|how's|hows)\b/i;
// a passage of Scripture by name ("what does Romans 8 say…", "John 3:16") is a faith question: the main model
const BIBLE_BOOK = /\b(genesis|exodus|leviticus|numbers|deuteronomy|joshua|judges|ruth|samuel|kings|chronicles|ezra|nehemiah|esther|job|psalms?|proverbs|ecclesiastes|song of (songs|solomon)|isaiah|jeremiah|lamentations|ezekiel|daniel|hosea|joel|amos|obadiah|jonah|micah|nahum|habakkuk|zephaniah|haggai|zechariah|malachi|matthew|mark|luke|john|acts|romans|corinthians|galatians|ephesians|philippians|colossians|thessalonians|timothy|titus|philemon|hebrews|james|peter|jude|revelation)\s+\d+/i;
export const looksQuick = (text) => {
  const t = String(text ?? "").trim(); if (!t || QUICK_NOT.test(t) || BIBLE_BOOK.test(t)) return false;
  const n = t.split(/\s+/).length;
  return n <= 14 || (n <= 28 && COMMANDISH.test(t));
};
// the model for this request when "Pick for me" is on (null: the chosen one). deep: a serious/sparring conversation or a
// between-blocks talk is on, so every turn of it stays on the main model.
export function autoModel(text, { deep = false } = {}) { if (!autoModelOn() || provider() === "none" || deep) return null; if (!looksQuick(text)) return null; const f = fastModelFor(); return f && f !== modelName() ? f : null; }
export const label = () => (provider() === "none" ? "no AI (built-in skills only)" : `${PROVIDERS[provider()].label} · ${modelName()}`);
export const canSearchWeb = () => provider() === "anthropic";
export const isLocal = () => provider() === "ollama";
const baseUrl = (p) => (p === "ollama" ? `${ollamaUrl()}/v1` : PROVIDERS[p].base);

// ---- the local model (Ollama) ----
export const ollamaUrl = () => normalizeOllamaUrl(process.env.OLLAMA_URL);
export const ollama = createOllama({ url: () => ollamaUrl() });
const keepAliveOf = (v) => { const s = String(v ?? "").trim(); if (!s) return "30m"; if (/^-1$|^always$|^forever$/i.test(s)) return -1; if (/^\d+$/.test(s)) return Number(s); return s; };
export function localOptions() {
  const e = process.env, n = (v, d, lo, hi) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? Math.min(hi, Math.max(lo, x)) : d; };
  const numCtx = n(e.OLLAMA_NUM_CTX, 4096, 1024, 131072);
  return {
    url: ollamaUrl(), model: provider() === "ollama" ? modelName() : process.env.AI_MODEL || PROVIDERS.ollama.defaultModel,
    chatModel: String(e.OLLAMA_CHAT_MODEL ?? "").trim(), visionModel: String(e.OLLAMA_VISION_MODEL ?? "").trim(), embedModel: String(e.OLLAMA_EMBED_MODEL ?? "auto").trim() || "auto",
    numCtx, maxCtx: Math.max(numCtx, n(e.OLLAMA_MAX_CTX, 8192, 1024, 131072)), toolsN: Math.round(n(e.OLLAMA_TOOLS_N, 10, 3, 40)),
    keepAlive: keepAliveOf(e.OLLAMA_KEEP_ALIVE), firstTokenMs: Math.round(n(e.OLLAMA_FIRST_TOKEN_S, 8, 1, 120) * 1000),
    fallback: /^claude$/i.test(e.OLLAMA_FALLBACK ?? "") ? "claude" : "offline",
  };
}
// Ollama failed (not running, too slow): may Claude answer instead?
export const claudeFallback = () => provider() === "ollama" && localOptions().fallback === "claude" && claudeAvailable();

// How fast answers come (Settings → AI brain → Speed): the last few, per kind ("chat", "stream", "complete")
const speed = [];
export function recordSpeed(m) {
  if (!m || typeof m !== "object") return;
  speed.push({ at: Date.now(), provider: provider(), model: m.model ?? modelName(), kind: m.kind ?? "chat", ttftMs: m.ttftMs ?? null, firstSentenceMs: m.firstSentenceMs ?? null, totalMs: m.totalMs ?? null,
    tokensPerSec: m.tokensPerSec ?? null, tools: m.offered?.length ?? m.tools ?? null, rounds: m.rounds ?? null, fellBack: m.fellBack ?? null, cached: Boolean(m.cached) });
  if (speed.length > 40) speed.shift();
}
export function speedStats() {
  const recent = speed.slice(-20), avg = (k) => { const v = recent.map((x) => x[k]).filter((x) => typeof x === "number"); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  return { count: recent.length, ttftMs: avg("ttftMs"), firstSentenceMs: avg("firstSentenceMs"), totalMs: avg("totalMs"), tokensPerSec: avg("tokensPerSec"), last: recent.slice(-8).reverse() };
}
export const _resetSpeed = () => { speed.length = 0; };

// Load the local model now (and keep it loaded), so the first question doesn't wait for it. Also reads the system
// prompt once, so Ollama can reuse it. Never throws.
const warmState = { at: null, ms: null, error: null, model: null };
export async function warmLocal({ system = "" } = {}) {
  if (provider() !== "ollama") return { skipped: true };
  const o = localOptions();
  try {
    const r = await ollama.warm(o.model, { keepAlive: o.keepAlive, numCtx: o.numCtx, system });
    Object.assign(warmState, { at: new Date().toISOString(), ms: r.ms, error: null, model: o.model });
    if (o.chatModel && o.chatModel !== o.model) await ollama.warm(o.chatModel, { keepAlive: o.keepAlive, numCtx: o.numCtx }).catch(() => null);
    return { ok: true, ms: r.ms, model: o.model };
  } catch (e) { Object.assign(warmState, { at: new Date().toISOString(), ms: null, error: e.message, model: o.model }); return { ok: false, error: e.message }; }
}
export const warmInfo = () => ({ ...warmState });

// the model for plain words (no tools): the bigger chat model when one is chosen
const localTextModel = () => { const o = localOptions(); return o.chatModel || o.model; };
const estTok = (s) => Math.ceil(String(s ?? "").length / 3.6);
// One answer from the local model. A prompt too long for its context is read in parts (each part boiled down for the
// task, then one answer from the notes), since a local model's memory is much shorter than Claude's.
async function localComplete({ system = "", prompt, maxTokens = 400, timeoutMs = 60_000, model = null, images = null, onText = null, signal = null }) {
  const o = localOptions(), m = model || localTextModel();
  const need = estTok(system) + estTok(prompt) + maxTokens + 64;
  if (!images && need > o.maxCtx) return localLong({ system, prompt, maxTokens, timeoutMs, model: m });
  const r = await ollama.chat({ model: m, stream: Boolean(onText), onText, keepAlive: o.keepAlive, timeoutMs, signal, firstTokenMs: onText ? o.firstTokenMs * 2 : 0,
    messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt, ...(images ? { images } : {}) }],
    options: { num_ctx: need > o.numCtx ? o.maxCtx : o.numCtx, num_predict: maxTokens, temperature: 0.4 } });
  recordSpeed({ kind: onText ? "stream" : "complete", model: m, ...r.metrics });
  return r.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
async function localLong({ system, prompt, maxTokens, timeoutMs, model }) {
  const o = localOptions();
  const text = String(prompt);
  // the instructions are the first paragraph (or the first 600 characters); the rest is the material
  const cutAt = (() => { const i = text.indexOf("\n\n"); return i > 0 && i < 1500 ? i : Math.min(600, text.length); })();
  const task = text.slice(0, cutAt).trim(), body = text.slice(cutAt);
  const room = Math.max(2000, (o.maxCtx - estTok(system) - estTok(task) - 600) * 3.2);
  const parts = [];
  for (let i = 0; i < body.length && parts.length < 16; i += room) {
    let end = Math.min(body.length, i + room);
    const para = body.lastIndexOf("\n", end); if (para > i + room * 0.6 && end < body.length) end = para;
    parts.push(body.slice(i, end)); i = end - room;
  }
  const notes = [];
  for (const [k, p] of parts.entries()) notes.push(await localComplete({ system: "You boil long material down for a task. Keep every fact, name, number and date that could matter for the task. Plain sentences.", prompt: `The task: ${task.slice(0, 600)}\n\nPart ${k + 1} of ${parts.length}:\n${p}\n\nWrite the notes for this part.`, maxTokens: 350, timeoutMs, model }));
  return localComplete({ system, prompt: `${task}\n\n(The material was long, so here are notes from each part of it, in order.)\n\n${notes.map((n, k) => `Part ${k + 1}: ${n}`).join("\n\n")}`, maxTokens, timeoutMs, model });
}
// Streamed words from the local model (calls, meetings, Discord), for the speech to start at the first sentence
export async function* streamLocal({ system = "", prompt, maxTokens = 220, model = null, timeoutMs = 25_000, signal = null }) {
  const queue = []; let wake = null, done = false, failure = null;
  const t0 = Date.now(); let first = null, sentence = null, acc = "";
  const job = localComplete({ system, prompt, maxTokens, timeoutMs, model, signal, onText: (p) => { if (first == null) first = Date.now() - t0; acc += p; if (sentence == null && /[.!?](\s|$)/.test(acc)) sentence = Date.now() - t0; queue.push(p); wake?.(); } })
    .then(() => { done = true; wake?.(); }, (e) => { failure = e; done = true; wake?.(); });
  while (true) {
    if (queue.length) { yield queue.shift(); continue; }
    if (done) break;
    await new Promise((r) => { wake = r; }); wake = null;
  }
  await job;
  if (failure && !first) throw failure;
  if (speed.length) Object.assign(speed[speed.length - 1], { firstSentenceMs: sentence ?? speed[speed.length - 1].totalMs });
}

// ---- one-shot text (short compositions: announcements, rundowns, summaries) ----
export async function complete({ system = "", prompt, maxTokens = 400, timeoutMs = 45_000 }) {
  const p = provider();
  if (!ready()) throw Object.assign(new Error("no AI is set up"), { status: 401 });
  if (p === "ollama") {
    try { return await localComplete({ system, prompt, maxTokens, timeoutMs: Math.max(timeoutMs, 60_000) }); }
    catch (e) { if (claudeFallback()) return asProvider("anthropic", () => complete({ system, prompt, maxTokens, timeoutMs })); throw e; }
  }
  if (p === "anthropic") {
    const client = new Anthropic({ timeout: timeoutMs, maxRetries: 1 });
    const r = await client.messages.create({ model: modelName(), max_tokens: maxTokens, system: system || undefined, messages: [{ role: "user", content: prompt }] });
    return r.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  }
  const r = await openaiChat(p, { messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }], max_tokens: maxTokens }, timeoutMs);
  return String(r.choices?.[0]?.message?.content ?? "").trim();
}

// ---- a picture and a question (lib/vision/describe.mjs; only after the owner said yes to sending pictures) ----
// Claude, ChatGPT and Grok take pictures; a local model only through a vision model (llava, llama3.2-vision, qwen2.5vl…):
// the one chosen in Settings → AI brain → Ollama, or the main model if it can see.
const VISION_NAME = /llava|vision|bakllava|moondream|gemma3(?!n)|qwen2\.5-?vl|qwen-?vl|minicpm-v|granite3\.2-vision|llama4/i;
// (an installed vision model Ollama reported lately counts too, when none was chosen: noteVisionModels, from the live list)
let seenVision = { names: [], at: 0 };
export function noteVisionModels(names) { seenVision = { names: [...(names ?? [])], at: Date.now() }; }
export const localVisionModel = () => { const o = localOptions(); return o.visionModel || (VISION_NAME.test(o.model) ? o.model : VISION_NAME.test(o.chatModel) ? o.chatModel : "") || (Date.now() - seenVision.at < 10 * 60_000 ? seenVision.names[0] ?? "" : ""); };
export function supportsImages(p = provider()) {
  if (p === "anthropic" || p === "openai" || p === "xai") return ready();
  if (p === "ollama") return Boolean(localVisionModel()) || (claudeFallback() && Boolean(process.env.ANTHROPIC_API_KEY));
  return false;
}
export async function completeWithImage({ system = "", prompt, image, maxTokens = 700, timeoutMs = 60_000 }) {
  const p = provider();
  if (!supportsImages(p)) throw Object.assign(new Error("this AI can't look at pictures"), { status: 400 });
  const mediaType = image.mediaType || "image/jpeg";
  if (p === "ollama") {
    const vm = localVisionModel();
    if (!vm) return asProvider("anthropic", () => completeWithImage({ system, prompt, image, maxTokens, timeoutMs }));
    try { return await localComplete({ system, prompt, maxTokens, timeoutMs: Math.max(timeoutMs, 120_000), model: vm, images: [image.data] }); }
    catch (e) { if (claudeFallback()) return asProvider("anthropic", () => completeWithImage({ system, prompt, image, maxTokens, timeoutMs })); throw e; }
  }
  if (p === "anthropic") {
    const client = new Anthropic({ timeout: timeoutMs, maxRetries: 1 });
    const r = await client.messages.create({ model: modelName(), max_tokens: maxTokens, system: system || undefined, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: image.data } }, { type: "text", text: prompt }] }] });
    return r.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  }
  const r = await openaiChat(p, { messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: [{ type: "image_url", image_url: { url: `data:${mediaType};base64,${image.data}` } }, { type: "text", text: prompt }] }], max_tokens: maxTokens }, timeoutMs);
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

// ---- a conversation with tools, for OpenAI-compatible providers (the Anthropic path lives in assistant.mjs; the
// local path, with tool selection and argument repair, in lib/ollama) ----
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
    if (p === "ollama") {
      const pr = await ollama.probe();
      if (!pr.running) return { ok: false, error: pr.error, notRunning: true };
      const names = (await ollama.tags()).map((m) => m.name);
      const m = modelName();
      if (!names.some((n) => n === m || n === m + ":latest" || n.replace(/:latest$/, "") === m)) return { ok: false, error: `The model ${m} isn't on this computer yet. Pick an installed one, or pull it first.`, missingModel: m, installed: names };
      const r = await ollama.chat({ model: m, stream: false, keepAlive: localOptions().keepAlive, timeoutMs: 120_000, messages: [{ role: "user", content: "Reply with exactly: ready" }], options: { num_ctx: localOptions().numCtx, num_predict: 20 } });
      return { ok: true, text: r.content.trim(), ms: Date.now() - t0, model: m, loadMs: r.metrics.loadMs };
    }
    const text = await complete({ prompt: "Reply with exactly: ready", maxTokens: 20, timeoutMs: 30_000 });
    return { ok: true, text, ms: Date.now() - t0, model: modelName() };
  } catch (e) { return { ok: false, error: e.message }; }
  finally { process.env.AI_PROVIDER = saved.AI_PROVIDER ?? ""; process.env.AI_MODEL = saved.AI_MODEL ?? ""; if (keyVar) { if (savedKey != null) process.env[keyVar] = savedKey; else delete process.env[keyVar]; } }
}
// Models the user can pick from (for the wizard's dropdown)
export async function models(p = provider()) {
  try {
    if (p === "anthropic") return ["claude-sonnet-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"];
    if (p === "ollama") return (await ollama.tags()).map((m) => m.name);
    const r = await fetch(`${baseUrl(p)}/models`, { headers: { authorization: `Bearer ${process.env[PROVIDERS[p].keyVar]}` }, signal: AbortSignal.timeout(8000) });
    const j = await r.json(); return (j.data ?? []).map((m) => m.id).sort();
  } catch { return p === "ollama" ? [] : [PROVIDERS[p]?.defaultModel].filter(Boolean); }
}
