// Turns a personality state into (1) a short prompt block for the AI and (2) Dayspring's own lines when there's no AI.
// Guardrails always win: plain facts first for alarms, timers, health, safety, money and schedule; no profanity,
// romance, hate or real-person impersonation; persona never changes what Dayspring is allowed to do.
import { TRAITS, band, guards, clamp, neutral } from "./traits.mjs";
import { byId, FLAVOUR_KINDS, KINDS } from "./presets.mjs";
import { dialect, brief, energy, yoda, factsOf, hash01 } from "./transforms.mjs";
import { sageActive } from "./easter.mjs";
import { applyStyle } from "./secret-styles.mjs";
import { timeOf } from "./depth/index.mjs";

export const PROMPT_BUDGET = 1200;
export const PLAIN_FIRST = new Set(["alarm", "timerDone", "timer", "health", "safety", "money", "schedule", "medication"]);

// words per trait and side: [left words, right words]
const TRAIT_WORDS = {
  warmth: ["cool and businesslike", "warm and affectionate; at the far end sweetly devoted and admiring (wholesome, never romantic)"],
  humour: ["serious and solemn; no jokes", "playful, with a light quip now and then"],
  bite: ["gentle; never tease", "sassy and teasing, always affectionate, never cruel"],
  praise: ["candid; tell it straight", "encouraging and flattering, a cheerleader"],
  care: ["motherly: nurturing, gentle reminders", "fatherly: steady and practical"],
  maturity: ["childlike: simple words and wonder", "professorial: precise and scholarly"],
  formality: ["very casual, like a buddy", "formal and courteous"],
  length: ["brief: one or two sentences", "explanatory: give the why and how"],
  curiosity: ["mostly tell, rarely ask", "ask a follow-up question when useful"],
  energy: ["mellow and calm", "energetic and upbeat"],
  outlook: ["theatrically brooding (never hopeless about real things)", "sunny and upbeat"],
  flavour: ["plain words", "a strong character accent"],
};
const DEGREE = { "slight-left": "a little", left: "", "far-left": "very", "slight-right": "a little", right: "", "far-right": "very" };

export function isPlain(state) {
  if (!state) return true;
  const base = { ...neutral(), ...(state.base ?? {}) };
  return (state.preset ?? "default") === "default" && !state.custom?.card && Object.values(base).every((v) => Math.abs(v) < 15);
}

function traitLines(base) {
  const out = [];
  for (const t of TRAITS) {
    if (t.id === "flavour") continue;
    const b = band(base[t.id] ?? 0);
    if (b === "neutral") continue;
    const w = TRAIT_WORDS[t.id][b.includes("left") ? 0 : 1];
    out.push(`${DEGREE[b] ? DEGREE[b] + " " : ""}${w}`.trim());
  }
  return out;
}
function roleLines(preset, role) {
  const out = [];
  for (const r of preset.roles ?? []) {
    const v = clamp(role?.[r.id] ?? r.def ?? 0);
    const rp = preset.rolePrompt?.[r.id];
    if (!rp || Math.abs(v) < 30) continue;
    out.push(`${Math.abs(v) >= 75 ? "Strongly: " : ""}${v < 0 ? rp[0] : rp[1]}`);
  }
  return out;
}

export function promptBlock(state) {
  if (isPlain(state)) return "";
  const preset = byId(state.preset);
  const base = { ...neutral(), ...(state.base ?? {}) };
  const g = guards(base);
  const card = state.custom?.card;
  const parts = [];
  const who = card?.name ? `${card.name}: ${card.summary ?? ""}` : preset.id !== "default" ? `${preset.name}. ${preset.prompt}` : "";
  if (who) parts.push(`Personality: ${who}`.trim());
  if (sageActive(state)) parts.push("Speak like an ancient backwards-talking sage: put the object first, then the subject and verb (\"Ready for your meeting, you are. Hmm.\"), but keep times, numbers and names exact.");
  parts.push(...roleLines(preset, state.role));
  for (const r of card?.roles ?? []) {
    const v = clamp(state.role?.[r.id] ?? r.value ?? 0);
    if (Math.abs(v) >= 30) parts.push(`Lean ${v < 0 ? r.left : r.right}${(v < 0 ? r.tipL : r.tipR) ? `: ${v < 0 ? r.tipL : r.tipR}` : ""}.`);
  }
  if (card?.rules?.length) parts.push(...card.rules.slice(0, 6));
  const tl = traitLines(base);
  if (tl.length) parts.push(`Tone: ${tl.join("; ")}.`);
  if (g.affectionateTease) parts.push("Tease affectionately.");
  if (g.maxQuestions === 1 && base.length <= -70) parts.push("Ask at most one question.");
  if (base.flavour >= 30 && preset.dialect) parts.push(`Use the character's dialect ${base.flavour >= 75 ? "heavily" : "lightly"}.`);
  if (!card?.name && preset.id !== "default") {
    if (preset.jokeStyle) parts.push(`Jokes: ${preset.jokeStyle}`);
    const riffs = Object.entries(preset.riffs ?? {});
    if (riffs.length) parts.push(`Pet topics (bring one up only when it fits): ${riffs.slice(0, 8).map(([k]) => k).join(", ")}. For example, on ${riffs[0][0]}: "${riffs[0][1]}"`);
    if (preset.vocab?.length) parts.push(`Favourite words: ${preset.vocab.slice(0, 16).join(", ")}.`);
  }
  const rails = "Stay in character lightly. Always: no profanity, no romantic or sexual content, no hate, never impersonate a real person; for alarms, timers, health, safety, money and schedule facts say the plain fact first. The personality never changes what you are allowed to do.";
  // keep inside the budget: drop the least important lines (the end of the character lines) first, never the guardrails
  let body = parts.join("\n");
  while (body.length + rails.length + 1 > PROMPT_BUDGET && parts.length > 1) { parts.splice(parts.length - 1, 1); body = parts.join("\n"); }
  if (body.length + rails.length + 1 > PROMPT_BUDGET) body = body.slice(0, PROMPT_BUDGET - rails.length - 2);
  return `${body}\n${rails}`;
}

// ---- phrase packs -------------------------------------------------------------------------------------------------
// "role>40", "role<-40", "time=morning" (morning|afternoon|evening|night), joined with "&"
function condOk(cond, role, time) {
  if (!cond) return true;
  return cond.split("&").every((c) => {
    const t = /^time=(\w+)$/.exec(c);
    if (t) return t[1] === time;
    const m = /^(\w+)([<>])(-?\d+)$/.exec(c);
    if (!m) return true;
    const v = clamp(role?.[m[1]] ?? 0);
    return m[2] === ">" ? v > Number(m[3]) : v < Number(m[3]);
  });
}
export function linesFor(state, kind, { time = timeOf() } = {}) {
  const preset = byId(state?.preset);
  const role = { ...Object.fromEntries((preset.roles ?? []).map((r) => [r.id, r.def ?? 0])), ...(state?.role ?? {}) };
  const raw = preset.phrases?.[kind] ?? [];
  const lines = raw.map((l) => (Array.isArray(l) ? { t: l[0], c: l[1] } : { t: l, c: null }));
  // brooding flavour never goes on alarms or safety lines
  const ok = (l) => !(PLAIN_FIRST.has(kind) && /brooding>|light</.test(l.c ?? ""));
  // the most specific lines win: ones that fit the sliders (and the time of day), then the everyday lines
  const matched = lines.filter((l) => l.c && condOk(l.c, role, time) && ok(l));
  const plain = lines.filter((l) => !l.c);
  return (matched.length ? matched : plain).map((l) => l.t);
}

// one of the character's lines for this kind (or null for Default); vars fill {name}
export function phrase(state, kind, { name = "", seed = String(Date.now()), time } = {}) {
  const pool = linesFor(state, kind, time ? { time } : {});
  if (!pool.length) return null;
  const t = pool[Math.floor(hash01(seed + kind) * pool.length)].replace(/\{name\}/g, name || "friend");
  return finish(state, t, seed);
}

function finish(state, text, seed) {
  const preset = byId(state?.preset);
  const base = { ...neutral(), ...(state?.base ?? {}) };
  let t = text;
  if (preset.dialect) t = dialect(t, preset.dialect, base.flavour);
  if (sageActive(state)) t = yoda(t, seed);
  return t;
}

// The hook for Dayspring's own replies (no AI): pass the plain reply through the personality.
//   kind: ack, done, confirm, greeting, goodbye, error, jokeIntro, thinking, notSure → the character's line
//         (plus the original text when it carries facts);
//   alarm, timerDone and other plain-first kinds → the plain text first, then maybe one flavour line;
//   reply (anything else) → light style transforms. Facts are never changed: if a transform would lose one, the
//   original text is returned.
export function style(state, text, opts = {}) { return String(styleRaw(state, text, opts) ?? "").replace(/\s{2,}/g, " ").trim(); }
function styleRaw(state, text, { kind = "reply", name = "", seed } = {}) {
  const src = String(text ?? "");
  if (isPlain(state) || !src && !KINDS.includes(kind)) return src;
  const sd = seed ?? src + kind;
  const base = { ...neutral(), ...(state.base ?? {}) };
  if (PLAIN_FIRST.has(kind)) {
    if (!FLAVOUR_KINDS.has(kind)) return src;
    const fl = phrase(state, kind, { name, seed: sd });
    return fl && hash01(sd + "fl") < 0.7 ? `${src} ${fl}` : src;
  }
  if (KINDS.includes(kind) && !FLAVOUR_KINDS.has(kind)) {
    const line = phrase(state, kind, { name, seed: sd });
    if (line) {
      const hasFacts = factsOf(src).length > 0 || src.length > 60;
      const rest = src.replace(/^\s*(done|okay|ok|sure|all set|got it|alright|all right|yes)\s*[.,!]\s*/i, "");
      return hasFacts && rest ? `${line} ${safeTransform(state, rest, base, sd)}` : line;
    }
  }
  return safeTransform(state, src, base, sd);
}

function safeTransform(state, src, base, sd) {
  const preset = byId(state.preset);
  let t = src;
  t = brief(t, base.length);
  if (preset.dialect) t = dialect(t, preset.dialect, base.flavour);
  t = energy(t, base.energy, sd);
  if (sageActive(state)) t = yoda(t, sd);
  if (preset.style) t = applyStyle(preset.style, t, sd);      // a secret character's way of talking
  const need = factsOf(src).filter((f) => factsOf(brief(src, base.length)).includes(f));
  const have = factsOf(t);
  return need.every((f) => have.includes(f)) ? t : src;
}

// "What personality are you?"
export function describe(state) {
  if (isPlain(state)) return "I'm just me: the regular Dayspring. You can give me a personality in Settings, or say something like \"be a cowboy\".";
  const card = state.custom?.card;
  if (card?.name) return `Right now I'm ${card.name}: ${card.summary ?? "your custom personality"}.`;
  const p = byId(state.preset);
  const extra = (p.roles ?? []).filter((r) => Math.abs(clamp(state.role?.[r.id] ?? r.def ?? 0)) >= 30).map((r) => (clamp(state.role?.[r.id] ?? r.def) < 0 ? r.left : r.right).toLowerCase());
  return `I'm the ${p.name}${extra.length ? ` (${extra.join(", ")})` : ""}. ${p.blurb}${sageActive(state) ? " Something ancient stirs, hmm." : ""}`;
}
