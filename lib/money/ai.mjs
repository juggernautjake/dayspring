// Money review and the AI: nothing financial goes to the AI provider without the owner's one-time consent.
//
//   CONSENT_TEXT                   the question, word for word
//   canSend()                      → { ok, reason }   consent given AND an AI is set up
//   payloadFor(transactions)       what would be sent: date, merchant, amount, in/out, category (numbers masked)
//   insights(report, { complete }) → text | null   (null without consent or AI: the report is then fully offline)
//   visionRows(page, { vision })   the screenshot fallback: only with the separate screenshot consent
// The consent is recorded only by the owner: the Money page's button, or their own "yes" to the question
// (money/index.mjs). The AI can't give it to itself.
import * as llm from "../llm.mjs";
import * as store from "./store.mjs";
import { mask, hasUnmasked } from "./normalize.mjs";
import * as activity from "./activity.mjs";

export const CONSENT_TEXT = "This sends your transaction list (merchant names and amounts, account numbers masked) to your AI provider to analyse it. OK?";
export const VISION_CONSENT_TEXT = "When a money page can't be read the normal way, Dayspring can send a picture of the visible page to your AI provider to read it. The picture may show more than the list (names, balances). OK?";

let aiReady = () => llm.ready();
export function _setReady(fn) { aiReady = fn; }            // tests
export const aiReadyNow = () => Boolean(aiReady());
let completeFn = (o) => llm.complete(o);
export function _setComplete(fn) { completeFn = fn ?? ((o) => llm.complete(o)); }   // tests

export function canSend() {
  if (!store.settings().aiConsent) return { ok: false, reason: "consent" };
  if (!aiReady()) return { ok: false, reason: "no-ai" };
  return { ok: true };
}

export function payloadFor(tx) {
  const lines = tx.map((t) => [t.date, mask(t.merchant), (t.direction === "out" ? "-" : "+") + t.amount.toFixed(2), t.category, t.status === "pending" ? "pending" : ""].join(" | ").trim());
  const text = lines.join("\n");
  if (hasUnmasked(text)) throw new Error("an unmasked number slipped through; not sending");
  return text;
}

const SYSTEM = "You help one person review their own spending. Be practical, warm and brief. Budgeting and saving suggestions are fine. " +
  "Never give investment, tax or legal advice: for those, say to see a qualified professional. Never tell them to move money or cancel anything on their behalf; explain how they can do it themselves.";

export async function insights(report, { complete = completeFn } = {}) {
  const ok = canSend();
  if (!ok.ok) return null;
  const summary = `Totals: in ${report.totals.in}, out ${report.totals.out}. Categories: ${report.categories.slice(0, 10).map((c) => `${c.category} ${c.total}`).join("; ")}. ` +
    `Repeating charges: ${report.recurring.slice(0, 20).map((r) => `${mask(r.merchant)} ${r.amount} ${r.every}`).join("; ")}.`;
  const prompt = `${summary}\n\nTransactions (date | merchant | amount | category | status):\n${payloadFor(report.transactions.slice(0, 600))}\n\n` +
    "In at most 8 short bullet points: what stands out, where they could save, and which repeating charges look worth reviewing and why. Plain text, no tables.";
  activity.log(`sent ${report.transactions.length} masked transactions to the AI for analysis (with consent)`);
  return String(await complete({ system: SYSTEM, prompt, maxTokens: 700, timeoutMs: 60_000 }) ?? "").trim() || null;
}

// A question the owner asked about their money, answered by the AI (with consent) from the kept transactions.
export async function answer(question, tx, { complete = completeFn } = {}) {
  const ok = canSend();
  if (!ok.ok) return null;
  activity.log(`sent ${tx.length} masked transactions to the AI to answer a question (with consent)`);
  return String(await complete({ system: SYSTEM, prompt: `Their transactions (date | merchant | amount | category | status):\n${payloadFor(tx.slice(0, 800))}\n\nTheir question: ${String(question).slice(0, 400)}\nAnswer in 1-4 short spoken sentences.`, maxTokens: 400 }) ?? "").trim() || null;
}

// The screenshot fallback. vision(png) → [{ date, description, amount, status }]; the default asks the AI provider.
export async function visionRows(page, { vision = defaultVision } = {}) {
  const s = store.settings();
  if (!s.aiConsent || !s.visionConsent || !aiReady()) return [];
  const png = await page.screenshot({ fullPage: false, timeout: 15_000 });
  activity.log("sent a picture of the money page to the AI to read it (with consent)");
  const rows = await vision(png);
  return (Array.isArray(rows) ? rows : []).slice(0, 200).map((r) => ({ id: "", text: `${r.date ?? ""} ${r.description ?? ""} ${r.amount ?? ""}`, cells: null, headers: null, time: "", date: String(r.date ?? ""),
    description: String(r.description ?? ""), amount: String(r.amount ?? ""), note: "", account: "", status: /pending/i.test(r.status ?? "") ? "pending" : "posted", cls: "", conf: 0.35, via: "vision" }));
}
async function defaultVision(png) {
  const prompt = "This is a picture of a bank or payment app's transaction list. List every transaction you can read as JSON: [{\"date\":\"...\",\"description\":\"...\",\"amount\":\"-$12.34 or +$5.00\",\"status\":\"pending|posted\"}]. Mask any account or card number to its last 4 digits. Reply with the JSON only.";
  const p = llm.provider();
  let text = "";
  if (p === "anthropic") {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const r = await new Anthropic({ timeout: 60_000, maxRetries: 1 }).messages.create({ model: llm.modelName(), max_tokens: 3000, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } }, { type: "text", text: prompt }] }] });
    text = r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  } else if (p === "openai" || p === "xai") {
    const base = llm.PROVIDERS[p].base, key = process.env[llm.PROVIDERS[p].keyVar];
    const res = await fetch(`${base}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ model: llm.modelName(), messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } }] }] }) });
    const j = await res.json().catch(() => ({})); text = j.choices?.[0]?.message?.content ?? "";
  } else if (p === "ollama" && llm.supportsImages()) {
    // a local vision model (Settings → AI brain → Ollama → Pictures), or Claude when that's the local model's fallback
    text = await llm.completeWithImage({ prompt, image: { data: png.toString("base64"), mediaType: "image/png" }, maxTokens: 3000, timeoutMs: 120_000 });
  } else return [];
  try { return JSON.parse(/\[[\s\S]*\]/.exec(text)?.[0] ?? "[]"); } catch { return []; }
}
