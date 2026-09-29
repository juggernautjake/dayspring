// Switching the AI brain and its model in one step: Claude · Ollama · No AI (and ChatGPT / Grok when their keys are
// saved), from the screen's ⋯ menu, by voice, or Settings. Takes effect on the very next request (no restart, the
// conversation carries on; each provider trims it to fit) and is saved in .env. Each provider keeps its own model
// (AI_MODEL_ANTHROPIC, AI_MODEL_OLLAMA…), so switching back is one click. "No AI" is really none: nothing calls any
// model (lib/llm.mjs: ready() is false, and the local model's fallback to Claude only applies to Ollama).
//   options({ fresh }) → { current, model, label, auto, options: [{ id, label, available, why, models, model }] }
//   switchTo(id, { model }) → { ok, current, model, label, message }       setAuto(on) → "Pick for me"
//   command(text) → a spoken reply, or null   "turn off the AI", "switch to Claude", "use Opus", "switch to qwen",
//                   "use the fastest model", "what model are you using?", "check my AI key"
import * as llm from "./llm.mjs";
import * as envfile from "./envfile.mjs";

const NAMES = { anthropic: "Claude", ollama: "Ollama (on this computer)", openai: "ChatGPT", xai: "Grok", none: "No AI" };
const SHORT = { anthropic: "Claude", ollama: "the local AI (Ollama)", openai: "ChatGPT", xai: "Grok", none: "no AI" };
const CLAUDE_NICE = { "claude-sonnet-5": "Sonnet 5", "claude-opus-5-5": "Opus 5.5", "claude-haiku-4-5-20251001": "Haiku 4.5" };
const nice = (m) => CLAUDE_NICE[m] ?? m;
const modelVar = (p) => `AI_MODEL_${p.toUpperCase()}`;
const savedModel = (p) => (llm.provider() === p ? llm.modelName() : process.env[modelVar(p)] || llm.PROVIDERS[p]?.defaultModel || "");
const sizeOf = (m) => { const x = /(\d+(?:\.\d+)?)b\b/i.exec(String(m)); return x ? Number(x[1]) : 50; };

async function ollamaModels() {
  const st = await import("./ollama/status.mjs").then((s) => s.status()).catch(() => null);
  if (!st?.running) return { st, models: [] };
  const tags = await llm.ollama.tags().catch(() => []);
  const out = [];
  for (const t of tags) { const c = await llm.ollama.capabilities(t.name).catch(() => []); if (!c.includes("embedding")) out.push({ id: t.name, label: t.name, tools: c.includes("tools"), vision: c.includes("vision") }); }
  llm.noteVisionModels(out.filter((x) => x.vision).map((x) => x.id));
  return { st, models: out };
}

export async function options({ fresh = false } = {}) {
  const cur = llm.provider();
  const S = await import("./ollama/status.mjs");
  const st = await S.status({ force: fresh }).catch(() => null);
  const ol = st?.running ? await ollamaModels() : { models: [] };
  const out = [
    { id: "anthropic", label: NAMES.anthropic, available: Boolean(process.env.ANTHROPIC_API_KEY), why: process.env.ANTHROPIC_API_KEY ? "" : "Add a Claude key in Settings → AI brain first.",
      models: llm.ANTHROPIC_MODELS.map((m) => ({ id: m, label: nice(m) })), model: savedModel("anthropic") },
    { id: "ollama", label: NAMES.ollama, available: Boolean(st && (st.running || st.installed)), state: st?.state ?? null, why: st ? S.describe(st) : "", models: ol.models, model: savedModel("ollama") },
    ...["openai", "xai"].filter((p) => process.env[llm.PROVIDERS[p].keyVar]).map((p) => ({ id: p, label: NAMES[p], available: true, why: "", models: [], model: savedModel(p) })),
    { id: "none", label: NAMES.none, available: true, why: "Built-in commands only: timers, the schedule, music, the weather and more.", models: [] },
  ];
  return { current: cur, model: cur === "none" ? null : llm.modelName(), label: llm.label(), auto: llm.autoModelOn(), options: out };
}

export async function switchTo(p, { model = "" } = {}) {
  p = String(p ?? "").toLowerCase();
  if (p === "claude") p = "anthropic";
  if (p === "local") p = "ollama";
  if (p === "offline" || p === "off") p = "none";
  if (p !== "none" && !llm.PROVIDERS[p]) throw Object.assign(new Error("Pick Claude, Ollama or No AI."), { status: 400 });
  const { options: opts } = await options({ fresh: p === "ollama" });
  const o = opts.find((x) => x.id === p);
  if (p !== "none" && !o?.available) throw Object.assign(new Error(o?.why || `${NAMES[p]} isn't set up yet.`), { status: 409 });
  model = String(model ?? "").trim();
  if (model && p === "ollama" && !o.models.some((x) => x.id === model || x.id === `${model}:latest`)) throw Object.assign(new Error(`${model} isn't installed in Ollama. Installed: ${o.models.map((x) => x.id).join(", ") || "none yet"}.`), { status: 409 });
  if (model && p === "anthropic" && !llm.ANTHROPIC_MODELS.includes(model)) throw Object.assign(new Error(`${model} isn't one of the Claude models Dayspring offers (${llm.ANTHROPIC_MODELS.map(nice).join(", ")}).`), { status: 409 });
  const cur = llm.provider();
  const vars = { AI_PROVIDER: p };
  if (cur !== "none" && llm.PROVIDERS[cur] && process.env.AI_MODEL) vars[modelVar(cur)] = process.env.AI_MODEL;
  const next = p === "none" ? "" : model || process.env[modelVar(p)] || (p === "ollama" ? (o.models.find((x) => x.tools)?.id ?? o.models[0]?.id ?? "") : "");
  vars.AI_MODEL = next;
  if (p !== "none") vars[modelVar(p)] = next;
  envfile.setVars(vars);
  try { (await import("./calls/stream-llm.mjs"))._resetFast(); } catch { /* not loaded */ }
  if (p === "ollama") import("./ollama/index.mjs").then((x) => x.startWarm()).catch(() => {});
  // Lantern reads the current choice from the shared file, if Dayspring shared its key
  if (p !== "none") import("./lantern.mjs").then((l) => l.refreshSharedKey?.()).catch(() => {});
  const message = p === "none" ? "Okay, no AI. I'll stick to my built-in commands."
    : cur === p && model ? `Okay, I'm using ${p === "anthropic" ? nice(llm.modelName()) : llm.modelName()} now.`
    : `Okay, I'm using ${SHORT[p]} now${p === "anthropic" ? `, ${nice(llm.modelName())}` : llm.modelName() && p !== "none" ? `, ${llm.modelName()}` : ""}.`;
  return { ok: true, current: llm.provider(), model: p === "none" ? null : llm.modelName(), label: llm.label(), message };
}
export function setAuto(on) { envfile.setVars({ AI_AUTO_MODEL: on ? "1" : "" }); return { ok: true, auto: llm.autoModelOn() }; }

// ---- spoken commands (they work with no AI at all) ----
const NONE = /\b(turn off|switch off|disable|stop using|shut off) (the |your )?(ai|a i|artificial intelligence|ai brain|brain)\b|\b(use|switch to|go to|change to) (no ai|no a i|offline mode|the built ?in commands|just the built ?in commands)\b|\bgo (into )?offline mode\b|\bno ai mode\b|\bwork without (the )?ai\b/;
const CLAUDE = /\b(switch|change|go|swap) (back )?(over )?to claude\b|\buse claude( (again|instead))?\b|\bturn (the |your )?ai (back )?on\b/;
const OLLAMA = /\b(switch|change|go|swap) (back )?(over )?to (ollama|the local (ai|model)|local ai)\b|\buse (ollama|the local (ai|model)|local ai)( (again|instead))?\b/;
const WHICH = /\b(which|what) (ai|a i|ai brain|brain|model|language model) (are you|am i|is this|is dayspring|do you)( (using|on|running|use|talking to))?\b|\bare you (using )?(claude|ollama|chatgpt|grok)\b|\bis the ai (on|off)\b/;
const MODELWORD = /^(?:(?:please |hey )?(?:use|switch to|change to|go to|swap to|try) (?:the )?)(.+?)(?: model)?(?: (?:instead|now|please|again))?$/;
const KEYCHECK = /\b(check|test) (my |the )?(ai|claude|anthropic) (key|connection)\b|\bis my (ai|claude) key (working|ok|okay)\b/;

export async function command(text) {
  const q = String(text ?? "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9.' ]+/g, " ").replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
  if (!q || q.split(" ").length > 12) return null;
  if (KEYCHECK.test(q)) { const r = await (await import("./claude-key.mjs")).checkSaved(); return r.text; }
  let want = NONE.test(q) ? "none" : OLLAMA.test(q) ? "ollama" : CLAUDE.test(q) ? (/\bturn (the |your )?ai (back )?on\b/.test(q) && !process.env.ANTHROPIC_API_KEY ? "ollama" : "anthropic") : null;
  if (!want && WHICH.test(q)) {
    const p = llm.provider();
    if (p === "none") return "I'm not using any AI right now, just my built-in commands. Say \"switch to Claude\" or \"use Ollama\" to turn one on.";
    if (p === "ollama") { const s = await import("./ollama/status.mjs").then((x) => x.status()).catch(() => null); return `I'm using the local AI, Ollama, with ${llm.modelName()}.${s && !s.running ? " It isn't answering right now, though, so I'm on my built-in commands." : ""}${llm.autoModelOn() ? " Pick for me is on." : ""}`; }
    return `I'm using ${SHORT[p]}, ${p === "anthropic" ? nice(llm.modelName()) : llm.modelName()}.${llm.autoModelOn() ? " Pick for me is on, so quick commands use the fast model." : ""}`;
  }
  if (want) {
    if (want === llm.provider()) return want === "none" ? "I'm already on my built-in commands, with no AI." : `I'm already using ${SHORT[want]}.`;
    try { return (await switchTo(want)).message; }
    catch (e) { return want === "anthropic" ? "I can't switch to Claude yet: there's no Claude key saved. You can add one in Settings, under AI brain." : want === "ollama" ? `I can't switch to Ollama: ${String(e.message).replace(/\.$/, "")}.` : e.message; }
  }
  // a model by name or by kind: "use Opus", "switch to Haiku", "switch to qwen", "use the fastest model"
  const m = MODELWORD.exec(q);
  if (!m) return null;
  const name = m[1].trim();
  if (/^(pick for me|automatic|auto)( mode)?$/.test(name)) { setAuto(true); return "Okay, I'll pick: quick commands use the fast model, and longer writing uses the main one."; }
  const CLAUDE_BY = { opus: "claude-opus-5-5", sonnet: "claude-sonnet-5", haiku: "claude-haiku-4-5-20251001" };
  const cm = /^(?:claude )?(opus|sonnet|haiku)\b/.exec(name);
  if (cm) {
    if (!process.env.ANTHROPIC_API_KEY) return `${cap(cm[1])} is a Claude model, and there's no Claude key saved. You can add one in Settings, under AI brain.`;
    try { await switchTo("anthropic", { model: CLAUDE_BY[cm[1]] }); return `Okay, I'm using Claude ${nice(CLAUDE_BY[cm[1]])} now.`; } catch (e) { return e.message; }
  }
  const kind = /^(smartest|best|biggest|most capable|strongest)( model| one)?$/.test(name) ? "smart" : /^(fastest|quickest|quick|fast|smallest|lightest)( model| one)?$/.test(name) ? "fast" : null;
  const p = llm.provider();
  if (kind) {
    if (p === "none") return "I'm not using any AI right now. Say \"switch to Claude\" or \"use Ollama\" first.";
    if (p === "anthropic") { const id = kind === "smart" ? CLAUDE_BY.opus : CLAUDE_BY.haiku; await switchTo("anthropic", { model: id }); return `Okay, I'm using Claude ${nice(id)} now${kind === "smart" ? ", the most capable one" : ", the quickest one"}.`; }
    if (p === "ollama") {
      const { models } = await ollamaModels(); const tools = models.filter((x) => x.tools); const list = (tools.length ? tools : models).sort((a, b) => sizeOf(a.id) - sizeOf(b.id));
      if (!list.length) return "I can't see any models in Ollama right now.";
      const pick = kind === "smart" ? list.at(-1) : list[0];
      if (pick.id === llm.modelName()) return `I'm already using ${pick.id}, the ${kind === "smart" ? "biggest" : "quickest"} one you have.`;
      await switchTo("ollama", { model: pick.id }); return `Okay, I'm using ${pick.id} now.`;
    }
    return "I can only pick between models for Claude and Ollama.";
  }
  // an installed Ollama model, loosely named ("qwen", "llama 3.2", "mistral")
  const { st, models } = await ollamaModels().catch(() => ({ models: [] }));
  const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const hits = models.filter((x) => squash(x.id).includes(squash(name)) || squash(name).includes(squash(x.id.split(":")[0])));
  if (hits.length) {
    const pick = hits.find((x) => x.tools) ?? hits[0];
    try { await switchTo("ollama", { model: pick.id }); return `Okay, I'm using ${pick.id} in Ollama now.`; } catch (e) { return e.message; }
  }
  // it sounded like a model, but there isn't one by that name
  if (/^(qwen|llama|mistral|gemma|phi|deepseek|llava|gpt|grok|claude)/.test(squash(name))) {
    const have = [...(process.env.ANTHROPIC_API_KEY ? llm.ANTHROPIC_MODELS.map(nice) : []), ...models.map((x) => x.id)];
    return `${cap(name)} isn't available${st?.running ? " in Ollama" : ""}.${have.length ? ` I can use ${have.slice(0, 6).join(", ")}.` : " There aren't any models set up yet."}`;
  }
  return null;
}
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
