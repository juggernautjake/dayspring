// Settings → AI brain → Ollama, and the quick AI switch (the screen's ⋯ menu). Mounted in server.mjs's ROUTES.
//   GET  /api/setup/ollama/status[?fresh=1]  live: is it installed / running, its models (only what the server reports
//                                           now), what's loaded, this computer and the models recommended for it, the
//                                           options, and how fast the last answers were
//   POST /api/setup/ollama/start            start the installed Ollama (hidden; only on his click)
//   POST /api/setup/ollama/pull {name}      download a model (only on his click); GET …/pull → progress
//   POST /api/setup/ollama/selftest {model} three requests that must come back as the right tool calls
//   POST /api/setup/ollama/options {…}      context size, tools per request, keep loaded, first-word wait, fallback,
//                                           chat / vision / embedding models
//   POST /api/setup/ollama/warm             load the model now
//   GET  /api/ai/switch · POST /api/ai/switch {provider}   Claude · Ollama · No AI
import * as llm from "../llm.mjs";
import * as envfile from "../envfile.mjs";
import * as status from "./status.mjs";
import { detect } from "./hardware.mjs";
import { recommendModels } from "../../vendor/ecosystem-core/lib/llm-local.mjs";

let pull = null;   // { name, status, percent, completed, total, done, error, startedAt }
const str = (v, n = 120) => String(v ?? "").trim().slice(0, n);
const MODEL = /^[a-z0-9][a-z0-9._\/-]{0,100}(:[a-z0-9._-]{1,60})?$/i;

async function modelsNow() {
  const tags = await llm.ollama.tags();
  const loaded = await llm.ollama.ps();
  const out = [];
  for (const t of tags) {
    const caps = await llm.ollama.capabilities(t.name).catch(() => []);
    out.push({ ...t, sizeGB: Math.round(t.size / 1e8) / 10, tools: caps.includes("tools"), vision: caps.includes("vision"), embed: caps.includes("embedding"), thinking: caps.includes("thinking"), loaded: loaded.some((l) => l.name === t.name) });
  }
  llm.noteVisionModels(out.filter((x) => x.vision).map((x) => x.name));
  return { models: out, loaded };
}

export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (p === "/ai/switch") {
    const sw = await import("../ai-switch.mjs");
    if (m === "GET") return send(res, 200, await sw.options({ fresh: q.get("fresh") === "1" })), true;
    if (m === "POST") { const b = await readJSON(req).catch(() => ({})); try { if (typeof b.auto === "boolean") return send(res, 200, sw.setAuto(b.auto)), true; return send(res, 200, await sw.switchTo(str(b.provider, 20), { model: str(b.model, 120) })), true; } catch (e) { return send(res, e.status ?? 400, { error: e.message }), true; } }
    return false;
  }
  if (!p.startsWith("/setup/ollama")) return false;
  const body = m === "POST" ? await readJSON(req).catch(() => ({})) : {};

  if (m === "GET" && p === "/setup/ollama/status") {
    // the address being tried in the form (not saved yet) can be checked too
    const url = str(q.get("url"), 200);
    const saved = process.env.OLLAMA_URL;
    if (url) process.env.OLLAMA_URL = url;
    try {
      const st = await status.status({ force: q.get("fresh") === "1" || Boolean(url) });
      let models = [], loaded = [];
      if (st.running) { try { ({ models, loaded } = await modelsNow()); } catch { /* it just stopped */ } }
      const hw = await detect().catch(() => ({ ramGB: 8 }));
      const rec = recommendModels(hw, { installed: models.map((x) => x.name) });
      return send(res, 200, { status: { ...st, text: status.describe(st) }, models, loaded, hardware: hw, recommend: rec, options: llm.localOptions(), active: llm.provider() === "ollama", speed: llm.speedStats(), warm: llm.warmInfo(), pull, claudeKey: Boolean(process.env.ANTHROPIC_API_KEY) }), true;
    } finally { if (url) { if (saved === undefined) delete process.env.OLLAMA_URL; else process.env.OLLAMA_URL = saved; } }
  }
  if (m === "POST" && p === "/setup/ollama/start") return send(res, 200, await status.start()), true;
  if (p === "/setup/ollama/pull") {
    if (m === "GET") return send(res, 200, { pull }), true;
    if (m !== "POST") return false;
    const name = str(body.name, 120);
    if (!MODEL.test(name)) return send(res, 400, { error: "That isn't a model name (like qwen2.5:3b)." }), true;
    if (pull && !pull.done) return send(res, 409, { error: `Already downloading ${pull.name}.`, pull }), true;
    const st = await status.status({ force: true });
    if (!st.running) return send(res, 409, { error: status.describe(st) }), true;
    pull = { name, status: "starting", percent: 0, completed: 0, total: 0, done: false, error: null, startedAt: new Date().toISOString() };
    const mine = pull;
    llm.ollama.pull(name, { onProgress: (x) => Object.assign(mine, { status: x.status, completed: x.completed, total: x.total, percent: x.percent ?? mine.percent }) })
      .then(() => Object.assign(mine, { done: true, status: "done", percent: 100 }))
      .catch((e) => Object.assign(mine, { done: true, error: e.message, status: "failed" }));
    return send(res, 202, { pull }), true;
  }
  if (m === "POST" && p === "/setup/ollama/selftest") {
    const { selfTest } = await import("./index.mjs");
    const model = str(body.model, 120);
    return send(res, 200, await selfTest({ model: MODEL.test(model) ? model : null })), true;
  }
  if (m === "POST" && p === "/setup/ollama/warm") { const { startWarm } = await import("./index.mjs"); return send(res, 200, await startWarm()), true; }
  if (m === "POST" && p === "/setup/ollama/options") {
    const vars = {};
    const num = (k, v, lo, hi) => { if (v === undefined || v === null || v === "") return; const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw Object.assign(new Error(`${k} must be between ${lo} and ${hi}`), { status: 400 }); vars[k] = String(Math.round(n)); };
    try {
      num("OLLAMA_NUM_CTX", body.numCtx, 1024, 131072);
      num("OLLAMA_MAX_CTX", body.maxCtx, 1024, 131072);
      num("OLLAMA_TOOLS_N", body.toolsN, 3, 40);
      num("OLLAMA_FIRST_TOKEN_S", body.firstTokenS, 2, 120);
    } catch (e) { return send(res, 400, { error: e.message }), true; }
    if (body.keepAlive !== undefined) { const k = str(body.keepAlive, 10); if (!/^(-1|\d+[smh]?|always)$/.test(k)) return send(res, 400, { error: "keep loaded: 5m, 30m, 2h or always" }), true; vars.OLLAMA_KEEP_ALIVE = k === "always" ? "-1" : k; }
    if (body.fallback !== undefined) vars.OLLAMA_FALLBACK = body.fallback === "claude" ? "claude" : "offline";
    for (const [k, v] of [["chatModel", "OLLAMA_CHAT_MODEL"], ["visionModel", "OLLAMA_VISION_MODEL"], ["embedModel", "OLLAMA_EMBED_MODEL"]]) {
      if (body[k] === undefined) continue;
      const s = str(body[k], 120);
      if (s && !MODEL.test(s)) return send(res, 400, { error: `${s} isn't a model name` }), true;
      vars[v] = s;
    }
    if (body.url !== undefined) { const u = str(body.url, 200); if (u && !/^https?:\/\/[\w.:\[\]-]+(\/.*)?$/i.test(u)) return send(res, 400, { error: "The address should look like http://127.0.0.1:11434" }), true; vars.OLLAMA_URL = u; }
    if (body.model !== undefined) { const s = str(body.model, 120); if (s && !MODEL.test(s)) return send(res, 400, { error: `${s} isn't a model name` }), true; if (s) { vars.AI_MODEL_OLLAMA = s; if (llm.provider() === "ollama") vars.AI_MODEL = s; } }
    envfile.setVars(vars);
    status._reset();
    try { (await import("../calls/stream-llm.mjs"))._resetFast(); } catch { /* not loaded */ }
    if (llm.provider() === "ollama" && (vars.AI_MODEL || vars.OLLAMA_NUM_CTX || vars.OLLAMA_KEEP_ALIVE)) import("./index.mjs").then((x) => x.startWarm()).catch(() => {});
    return send(res, 200, { ok: true, options: llm.localOptions() }), true;
  }
  return false;
}
