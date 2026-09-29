// A Claude (Anthropic) key that works, and plain words when it doesn't.
//   cleanKey(pasted) → { key, error, warning }   strips spaces, line breaks, quotes and a pasted "ANTHROPIC_API_KEY=";
//                                                  catches an admin key and other providers' keys before any call
//   explain(err | { status, message }) → { code, text, temporary, saveable }   what went wrong, and what to do next
//   testKey(key, { model }) → { ok, model, ms, code, text, temporary, saveable, usedDefault }   one tiny request
//   checkSaved() → the "Check my Claude connection" report, with the saved key (never shown: the last 4 characters)
// The API address can be pointed elsewhere with ANTHROPIC_BASE_URL (the tests' pretend Anthropic).
import { PROVIDERS } from "./llm.mjs";

export const CONSOLE_KEYS = "https://platform.claude.com/settings/keys";
export const CONSOLE_BILLING = "https://platform.claude.com/settings/billing";
const DEFAULT = PROVIDERS.anthropic.defaultModel;
const base = () => String(process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "").replace(/\/v1$/, "");

export function cleanKey(pasted) {
  let k = String(pasted ?? "");
  k = k.replace(/^\s*(export\s+)?ANTHROPIC_API_KEY\s*[:=]\s*/i, "");
  k = k.replace(/[\s​‌‍﻿]+/g, "").replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "");
  if (!k) return { key: "", error: "Paste your Claude key first. It starts with sk-ant-." };
  if (/^sk-ant-admin/i.test(k)) return { key: k, error: "That's an Admin key (for managing an organization), not an API key. In the Anthropic Console, go to API Keys and create a regular key; it starts with sk-ant-api." };
  if (/^xai-/i.test(k)) return { key: k, error: "That looks like a Grok (xAI) key, not a Claude key. Pick Grok above to use it, or paste a Claude key (it starts with sk-ant-)." };
  if (/^sk-proj-|^sk-(?!ant-)/i.test(k)) return { key: k, error: "That looks like an OpenAI (ChatGPT) key, not a Claude key. Pick ChatGPT above to use it, or paste a Claude key (it starts with sk-ant-)." };
  if (!/^sk-ant-/i.test(k)) return { key: k, error: "That doesn't look like a Claude key. Claude keys start with sk-ant-. Copy the whole key from the Anthropic Console → API Keys." };
  if (k.length < 40) return { key: k, error: "That key looks cut off. Copy the whole thing from the Anthropic Console (it's long, and starts with sk-ant-)." };
  return { key: k, error: null };
}

export function explain(e) {
  const status = Number(e?.status ?? e?.statusCode ?? 0) || null;
  const m = String(e?.error?.error?.message ?? e?.error?.message ?? e?.message ?? e ?? "");
  const type = String(e?.error?.error?.type ?? e?.error?.type ?? e?.type ?? "");
  if (status === 401 || /authentication_error|invalid x-api-key|invalid api key/i.test(type + m))
    return { code: "invalid", temporary: false, saveable: false, text: "That key isn't valid. It may have been deleted or copied wrong. Make a new key at the Anthropic Console → API Keys and paste the whole thing, starting with sk-ant-." };
  if (/credit balance|billing|purchase credits|insufficient.*credit/i.test(m))
    return { code: "credit", temporary: false, saveable: true, text: `The key works, but the account has no credit. Add some under Settings → Billing in the Anthropic Console (${CONSOLE_BILLING}).` };
  if (status === 403 || /permission_error/i.test(type))
    return { code: "permission", temporary: false, saveable: false, text: "This key isn't allowed to use Claude models. Check the key's workspace in the Anthropic Console (Settings → Workspaces), or make a key in the default workspace." };
  if (status === 404 || /not_found_error|model.*not found|model:/i.test(type + m) && /model/i.test(m))
    return { code: "model", temporary: false, saveable: true, text: "That model isn't available with this key." };
  if (status === 429 || /rate_limit/i.test(type)) return { code: "busy", temporary: true, saveable: true, text: "Anthropic is busy (too many requests). Try again in a minute; the key itself is fine." };
  if (status === 529 || status === 503 || /overloaded/i.test(type + m)) return { code: "busy", temporary: true, saveable: true, text: "Anthropic is busy right now. Try again in a minute; the key itself is fine." };
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|network|timeout|socket/i.test(m + String(e?.cause?.code ?? "")))
    return { code: "network", temporary: true, saveable: true, text: "Can't reach Anthropic. Check the internet connection, then try again." };
  if (status && status >= 500) return { code: "busy", temporary: true, saveable: true, text: "Anthropic had a problem on its side. Try again in a minute." };
  return { code: "other", temporary: false, saveable: false, text: `Claude said: ${m.slice(0, 160) || "something went wrong"}.` };
}

async function ping(key, model, timeoutMs) {
  let r;
  try {
    r = await fetch(`${base()}/v1/messages`, { method: "POST", signal: AbortSignal.timeout(timeoutMs),
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 5, messages: [{ role: "user", content: "Reply with exactly: ready" }] }) });
  } catch (e) { return { ok: false, ...explain({ message: `${e?.name ?? ""} ${e?.message ?? ""} ${e?.cause?.code ?? ""}` }) }; }
  const j = await r.json().catch(() => ({}));
  if (r.ok) return { ok: true };
  return { ok: false, status: r.status, ...explain({ status: r.status, error: j }) };
}

// One tiny request with this key. A model that isn't there is tried again with the default model.
export async function testKey(pasted, { model = null, timeoutMs = 20_000 } = {}) {
  const c = cleanKey(pasted);
  if (c.error) return { ok: false, code: "format", text: c.error, temporary: false, saveable: false, key: c.key };
  const t0 = Date.now();
  const want = model || DEFAULT;
  let r = await ping(c.key, want, timeoutMs), used = want, usedDefault = false;
  if (!r.ok && r.code === "model" && want !== DEFAULT) { r = await ping(c.key, DEFAULT, timeoutMs); used = DEFAULT; usedDefault = true; }
  const out = { ...r, key: c.key, model: used, ms: Date.now() - t0, usedDefault };
  if (r.ok && usedDefault) out.text = `${want} isn't available with this key, so Dayspring will use ${DEFAULT}.`;
  return out;
}

// "Check my Claude connection" (Settings button, or "check my AI key"): the saved key, step by step
export async function checkSaved() {
  const key = process.env.ANTHROPIC_API_KEY || "";
  const steps = { present: Boolean(key), last4: key.length >= 12 ? key.slice(-4) : "", formatOk: false, reachable: false, creditOk: false, modelOk: false };
  if (!key) return { ok: false, ...steps, text: "There's no Claude key saved. Paste one in Settings → AI brain." };
  const c = cleanKey(key);
  steps.formatOk = !c.error;
  if (c.error) return { ok: false, ...steps, text: c.error };
  const model = process.env.AI_PROVIDER === "anthropic" && process.env.AI_MODEL ? process.env.AI_MODEL : process.env.DAYSPRING_MODEL || DEFAULT;
  const r = await testKey(key, { model });
  steps.reachable = r.ok || !["network"].includes(r.code);
  steps.creditOk = r.ok || !["credit", "invalid", "network"].includes(r.code) && r.code !== "format";
  steps.modelOk = r.ok && !r.usedDefault;
  return { ok: r.ok, ...steps, model: r.model, ms: r.ms, code: r.code ?? null, text: r.ok ? `Your Claude key (ending ${steps.last4}) works with ${r.model}. That took ${(r.ms / 1000).toFixed(1)} seconds.${r.usedDefault ? " " + r.text : ""}` : r.text };
}
