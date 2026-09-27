// Proof of effort for check-ins that need it (study, reading): "What's one thing you learned?"
// Without AI: honest heuristics (enough real words, specific content, not "stuff and things", not a repeat, not just
// the course title). With AI: the AI rates the answer 0–3 and asks ONE follow-up about it; a reasonable answer to the
// follow-up earns the full amount. Scores: 0 = nothing real · 1 = thin (partial) · 2 = solid (full) · 3 = great (full + bonus).

const STOP = new Set(("a an the and or but if then so to of in on at by for with about as is are was were be been being i me my we our you your it its " +
  "this that these those there here what which who whom how why when where do did does done have has had can could would should will just really " +
  "very much many some any all not no yes also too like learned learn learnt today studied study read reading about how that thing things stuff " +
  "into from out up down over more most than then them they he she his her").split(/\s+/));
const GENERIC = /\b(stuff|things|a lot|lots of stuff|nothing much|idk|i don'?t know|dunno|not sure|whatever|n\/a|nothing|the usual|same as always|everything)\b/i;
const REFUSAL = /^(no|nope|nah|nothing|skip|pass|none|lol|lmao|haha+|jk|just kidding|asdf+|qwerty|test|testing|blah( blah)*|idk|i don'?t know|whatever)\W*$/i;

export const words = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9'\s-]+/g, " ").split(/\s+/).filter(Boolean);
export const contentWords = (t) => words(t).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
// a normalised fingerprint (duplicate answers earn nothing)
export const fingerprint = (t) => [...new Set(contentWords(t))].sort().join(" ");
const jaccard = (a, b) => { const A = new Set(a), B = new Set(b); if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n); };
// nonsense: too few vowels, keyboard mashing
export const gibberish = (t) => { const w = words(t).filter((x) => x.length > 3); if (!w.length) return false; const bad = w.filter((x) => !/[aeiouy]/.test(x) || /(.)\1\1/.test(x)).length; return bad / w.length > 0.4; };

export function isRefusal(text) { const t = String(text ?? "").trim(); return !t || REFUSAL.test(t); }
const NOBODY = /^(no ?one|nobody|noone|no body|none of them|not anyone|anyone|someone|somebody|people|a person)\W*$/i;

// The one check every proof answer goes through (what you did, which chore, who you called, what you learned):
// not a refusal, not keyboard mashing, and at least `min` real words (2 by default; a name is enough for "who").
// Returns { ok: true } or { ok: false, why }.
export function validEvidence(text, { min = 2, who = false } = {}) {
  const t = String(text ?? "").trim();
  if (isRefusal(t)) return { ok: false, why: "refusal" };
  if (who && NOBODY.test(t.replace(/^(i talked to|i called|i visited|i saw)\s+/i, ""))) return { ok: false, why: "nobody" };
  if (gibberish(t)) return { ok: false, why: "gibberish" };
  const n = who ? words(t).filter((w) => w.length > 1 && !STOP.has(w)).length : contentWords(t).length;
  if (n < min) return { ok: false, why: "too-short" };
  return { ok: true };
}

// score an answer without AI. past = earlier evidence texts; title = the block/course title (just repeating it isn't learning)
export function heuristic(text, { past = [], title = "" } = {}) {
  const t = String(text ?? "").trim();
  if (isRefusal(t) || gibberish(t)) return { score: 0, why: "no real answer" };
  const all = words(t), content = contentWords(t), uniq = new Set(content);
  const cw = contentWords(title);
  if (cw.length && [...uniq].every((w) => cw.includes(w))) return { score: 0, why: "just the title" };
  for (const p of past) if (jaccard(content, contentWords(p)) >= 0.8) return { score: 0, why: "same as a past answer", duplicate: true };
  const generic = GENERIC.test(t) && uniq.size < 6;
  if (generic) return { score: 0, why: "too general" };
  if (all.length >= 30 && uniq.size >= 12) return { score: 3, why: "detailed" };
  if (all.length >= 15 && uniq.size >= 6) return { score: 2, why: "specific" };
  if (uniq.size >= 3) return { score: 1, why: "a bit thin" };
  return { score: 0, why: "too short" };
}

// With AI: rate it and ask one follow-up. llm = { ready(), complete({system,prompt,maxTokens}) }. Falls back to the heuristic.
export async function rateWithAI(llm, text, { category = "study", title = "", past = [] } = {}) {
  const h = heuristic(text, { past, title });
  if (h.score === 0 && (h.duplicate || isRefusal(text))) return { ...h, followup: null, ai: false };
  if (!llm?.ready?.()) return { ...h, followup: null, ai: false };
  try {
    const system = "You check whether someone genuinely engaged with what they studied or read. Be fair and encouraging, never harsh. Reply with JSON only: {\"score\":0-3,\"followup\":\"one short, friendly question about the specific thing they said\"}. 0 = no real content, 1 = vague, 2 = specific and real, 3 = thoughtful and detailed.";
    const prompt = `Activity: ${category}${title ? ` (${title})` : ""}\nTheir answer to "what's one thing you learned?": ${String(text).slice(0, 800)}`;
    const raw = await llm.complete({ system, prompt, maxTokens: 150, timeoutMs: 15_000 });
    const j = JSON.parse(String(raw).match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    const score = Math.max(0, Math.min(3, Math.round(Number(j.score))));
    if (!Number.isFinite(score)) throw new Error("bad score");
    return { score, followup: typeof j.followup === "string" && j.followup.trim() ? j.followup.trim().slice(0, 200) : null, ai: true, why: "ai" };
  } catch { return { ...h, followup: null, ai: false }; }
}

// Was the answer to the follow-up reasonable? (AI when it can judge; otherwise: a real sentence, not a refusal)
export async function followupOk(llm, question, answer) {
  if (isRefusal(answer) || gibberish(answer)) return false;
  if (llm?.ready?.()) {
    try {
      const raw = await llm.complete({ system: "Reply with only yes or no: is this a genuine, on-topic attempt to answer the question (it doesn't have to be perfect)?", prompt: `Question: ${question}\nAnswer: ${String(answer).slice(0, 600)}`, maxTokens: 5, timeoutMs: 12_000 });
      return /^\s*yes/i.test(String(raw));
    } catch { /* fall through */ }
  }
  return contentWords(answer).length >= 4;
}
