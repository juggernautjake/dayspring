// Dayspring with a local model (Ollama): the same tools and rules as with Claude, fitted to a small model.
//   chat({ history, userText, surface, tools, runTool, extras, claude }) → { reply, history, changes, usage, local }
//     - checks Ollama is really there (lib/ollama/status.mjs); if not, fails fast so the fallback answers
//     - picks ~10 tools for this request (tools.mjs), writes the short instructions (prompt.mjs)
//     - runs ecosystem-core's tool loop (native tool calls, the text parser, argument repair, recovery)
//     - fixes dates and times in arguments (args.mjs) and never lets code talk through (speak.mjs)
//     - if Ollama fails or is too slow to start answering: Claude, when that's the chosen fallback and there's a key;
//       otherwise the error goes back and the assistant answers with the built-in commands
//   startWarm() · selfTest() · downNote(err) · _cacheClear()
import { chatWithToolsOllama } from "../../vendor/ecosystem-core/lib/llm-local.mjs";
import * as llm from "../llm.mjs";
import * as status from "./status.mjs";
import { selectFor } from "./tools.mjs";
import { systemPrompt, contextNote } from "./prompt.mjs";
import { normalizeFor } from "./args.mjs";
import { cleanReply } from "./speak.mjs";

// the same question again, soon, with nothing looked up or changed: the same answer, at once
const cache = new Map();
const CACHE_MS = 10 * 60_000;
const TIMELY = /\b(today|tomorrow|tonight|now|next|latest|news|weather|forecast|score|price|this|that|it|them|again|another|more|play|remind|add|set|move|cancel|delete|open|turn|start|stop)\b/i;
const cacheKey = (model, text, history) => `${model}|${String([...history].reverse().find((m) => m.role === "assistant" && typeof m.content === "string")?.content ?? "").slice(0, 120)}|${String(text).toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim()}`;
export const _cacheClear = () => cache.clear();

// the conversation a local model is shown: the last few turns, starting at one of his own messages, no pictures
function trimFor(history, n = 10) {
  let out = history.slice(-n);
  const his = (m) => m.role === "user" && (typeof m.content === "string" || (Array.isArray(m.content) && !m.content.some((b) => b.type === "tool_result")));
  while (out.length && !his(out[0])) out = out.slice(1);
  return out;
}
function keepTrim(msgs, n = 24) {
  for (const m of msgs) if (Array.isArray(m.content)) for (const b of m.content) if (b.type === "tool_result" && Array.isArray(b.content)) b.content = b.content.map((x) => (x.type === "image" ? { type: "text", text: "[a picture was shown here]" } : x));
  return trimFor(msgs, n);
}
let lastNote = 0;
// A short spoken note when the local model couldn't answer (at most every 10 minutes, so it doesn't nag)
export function downNote(err) {
  if (!err?.ollama || Date.now() - lastNote < 10 * 60_000) return "";
  lastNote = Date.now();
  if (err.code === "EFIRSTTOKEN" || err.code === "ETIMEDOUT") return "The local AI is slow right now, so here's what I can do without it. ";
  if (err.state === "not-installed") return "Ollama isn't installed on this computer anymore, so I'm using my built-in commands. You can pick another AI in Settings. ";
  return "The local AI (Ollama) isn't running, so I'm using my built-in commands. ";
}
const downError = (s) => Object.assign(new Error(status.describe(s) || "Ollama isn't answering"), { status: 503, code: "EOLLAMA_DOWN", ollama: true, state: s?.state });

export async function chat({ history = [], userText, surface = "tv", tools = [], runTool, extras = {}, claude = null, images = null }) {
  const o = llm.localOptions();
  const fallback = async (e) => {
    status.noteFailure(e);
    if (claude && llm.claudeFallback()) {
      const out = await claude(history, userText);
      const note = Date.now() - lastNote > 10 * 60_000 ? ((lastNote = Date.now()), e.code === "EFIRSTTOKEN" ? "The local AI was slow, so Claude answered this one. " : "The local AI isn't answering, so Claude is helping for now. ") : "";
      llm.recordSpeed({ kind: "chat", model: llm.claudeModel(), fellBack: "claude", totalMs: null });
      return { ...out, reply: note + out.reply, fellBack: "claude" };
    }
    throw e;
  };
  // after a failure it isn't asked again for a minute (answers come from the fallback at once; Settings checks sooner)
  if (!status.usable()) return fallback(downError(status.last()));
  // the same safety rules as with Claude, word for word (the assistant passes them; a direct caller gets them here)
  if (typeof extras !== "function" && !extras.untrusted) { try { extras = { ...extras, untrusted: (await import("../assistant.mjs")).UNTRUSTED_NOTE }; } catch { /* the rest still applies */ } }
  const key = cacheKey(o.model, userText, history);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS && !TIMELY.test(userText)) {
    llm.recordSpeed({ kind: "chat", model: o.model, ttftMs: 0, firstSentenceMs: 0, totalMs: 0, cached: true });
    return { reply: hit.reply, history: keepTrim([...history, { role: "user", content: userText }, { role: "assistant", content: hit.reply }]), changes: [], usage: null, local: { cached: true } };
  }
  const sel = await selectFor(userText, history, tools, { n: o.toolsN });
  const changes = [], failed = [];
  const byName = new Map(tools.map((t) => [t.name, t]));
  const system = systemPrompt(typeof extras === "function" ? extras() : extras);
  const note = contextNote({ surface, offered: sel.names });
  let r;
  try {
    r = await chatWithToolsOllama({
      ollama: llm.ollama, model: o.model, system, history: trimFor(history), userText, userImages: images, contextNote: note, tools, select: async () => sel.tools,
      numCtx: o.numCtx, maxCtx: o.maxCtx, keepAlive: o.keepAlive, firstTokenMs: o.firstTokenMs, maxRounds: 6, maxTokens: 600,
      normalize: (name, input, schema) => normalizeFor(name, input, schema ?? byName.get(name)?.input_schema),
      runTool: async (name, input) => {
        const out = await runTool(name, input, changes);
        if (out && typeof out === "object" && out.error) failed.push({ name, error: out.error });
        if (Array.isArray(out?.toolContent)) return out.toolContent.filter((b) => b.type === "text").map((b) => b.text).join("\n") || "(a picture; describe it with the picture tools)";
        return out;
      },
    });
  } catch (e) {
    if (e?.aborted) throw e;
    // a model that isn't pulled: say so plainly (never a stack of Ollama's words)
    if (/model .* not found|not found, try pulling/i.test(e.message)) e = Object.assign(new Error(`the model ${o.model} isn't on this computer`), { status: 503, code: "EMODEL", ollama: true });
    else e.ollama = true;
    if (!e.status || e.status >= 500 || e.code) e.status = e.status && e.status >= 500 ? e.status : 503;
    return fallback(e);
  }
  status.noteSuccess();
  const reply = cleanReply(r.reply, { toolNames: [...byName.keys()], failed });
  // the kept conversation says what was actually said
  const last = r.history.at(-1);
  if (last?.role === "assistant") last.content = [{ type: "text", text: reply }, ...(Array.isArray(last.content) ? last.content.filter((b) => b.type !== "text") : [])];
  llm.recordSpeed({ kind: "chat", model: o.model, ...r.metrics });
  if (!r.metrics.toolCalls.length && !TIMELY.test(userText) && reply.length > 2) { cache.set(key, { reply, at: Date.now() }); if (cache.size > 60) cache.delete(cache.keys().next().value); }
  return { reply, history: keepTrim(r.history), changes: [...new Set(changes)], usage: r.usage, local: { tools: sel.names, families: sel.families, metrics: r.metrics } };
}

// At start (and when the model changes): load it, keep it loaded, and read the instructions once. Never throws.
export async function startWarm() {
  if (llm.provider() !== "ollama") return { skipped: true };
  const s = await status.status({ force: true });
  if (!s.running) return { ok: false, state: s.state };
  let untrusted = "";
  try { untrusted = (await import("../assistant.mjs")).UNTRUSTED_NOTE; } catch { /* the rest still warms */ }
  return llm.warmLocal({ system: systemPrompt({ untrusted }) });
}

// Settings → AI brain → Ollama → "Test tool use": three requests that must come back as the right tool calls. Nothing
// is run (the tools here are stand-ins); it checks the model, the tool picking and the argument clean-up together.
export const SELF_TEST_TOOLS = [
  { name: "set_timer", description: "Start a countdown timer (cooking, laundry…). minutes can be a fraction.", input_schema: { type: "object", properties: { minutes: { type: "number", description: "How long, in minutes" }, label: { type: "string", description: "What it's for" } }, required: ["minutes"] } },
  { name: "set_reminder", description: "Remind the owner about something once, at a date and time (spoken then).", input_schema: { type: "object", properties: { text: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" }, time: { type: "string", description: "HH:MM, 24-hour" } }, required: ["text", "time"] } },
  { name: "get_agenda", description: "Read the schedule between two dates (inclusive).", input_schema: { type: "object", properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } }, required: ["from", "to"] } },
  { name: "play_spotify", description: "Play music on Spotify: songs, artists, albums, playlists. Pass the owner's words as request.", input_schema: { type: "object", properties: { request: { type: "string" } }, required: ["request"] } },
  { name: "web_search", description: "Search the web for anything recent or unknown.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "add_block", description: "Add an event to the schedule.", input_schema: { type: "object", properties: { title: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" }, start: { type: "string", description: "HH:MM" }, end: { type: "string", description: "HH:MM" } }, required: ["title", "date", "start", "end"] } },
];
export const SELF_TEST_CASES = [
  { say: "set a timer for 1 minute", tool: "set_timer", check: (i) => Math.abs(Number(i.minutes) - 1) < 0.01 },
  { say: "remind me to drink water at 11pm", tool: "set_reminder", check: (i) => i.time === "23:00" && /water/i.test(i.text ?? "") },
  { say: "what's on my schedule tomorrow?", tool: "get_agenda", check: (i, d) => i.from === d.tomorrow },
];
export async function selfTest({ model = null } = {}) {
  const s = await status.status({ force: true });
  if (!s.running) return { ok: false, state: s.state, error: status.describe(s) };
  const o = llm.localOptions(), m = model || o.model;
  const { contextNote: cn } = await import("./prompt.mjs");
  const now = new Date(), pad = (n) => String(n).padStart(2, "0"), t = new Date(now); t.setDate(t.getDate() + 1);
  const d = { tomorrow: `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}` };
  const results = [];
  for (const c of SELF_TEST_CASES) {
    const seen = [];
    const t0 = Date.now();
    try {
      const r = await chatWithToolsOllama({ ollama: llm.ollama, model: m, system: systemPrompt({}), userText: c.say, contextNote: cn({ offered: SELF_TEST_TOOLS.map((x) => x.name) }), tools: SELF_TEST_TOOLS, maxRounds: 2,
        numCtx: o.numCtx, keepAlive: o.keepAlive, firstTokenMs: Math.max(o.firstTokenMs, 60_000), timeoutMs: 180_000, maxTokens: 200,
        normalize: (name, input, schema) => normalizeFor(name, input, schema), runTool: async (name, input) => { seen.push({ name, input }); return { ok: true, note: "(test only: nothing was done)" }; } });
      const call = seen.find((x) => x.name === c.tool);
      results.push({ say: c.say, want: c.tool, got: seen.map((x) => x.name), args: call?.input ?? seen[0]?.input ?? null, ok: Boolean(call && c.check(call.input, d)), ms: Date.now() - t0, ttftMs: r.metrics.ttftMs, parsedFromText: r.metrics.parsedFromText > 0 });
    } catch (e) { results.push({ say: c.say, want: c.tool, got: seen.map((x) => x.name), ok: false, error: e.message, ms: Date.now() - t0 }); }
  }
  return { ok: results.every((r) => r.ok), model: m, results };
}
