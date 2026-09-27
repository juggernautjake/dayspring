// Depth rules for one character (used by depth.test.mjs; run `node lib/persona/depth/check.mjs knight cowboy` while writing).
import { KINDS, byId, PRESETS } from "../presets.mjs";
import { SECRETS } from "../secrets.mjs";
import { EXTRA_KINDS, TIMES } from "./index.mjs";

export const BANNED = /\b(fuck|shit|bitch|bastard|damn|hell|crap|piss|dick|ass|asshole|slut|whore|cunt|sexy|sex|kill|killed|blood|bloody|gore|die|dead|death|drunk|beer|wine|whiskey|kiss|darling|sweetheart|babe|hottie|stupid|idiot|dumb|hate)\b/i;
export const MIN_LINES = 60;
const text = (l) => (Array.isArray(l) ? l[0] : l);
const cond = (l) => (Array.isArray(l) ? l[1] : null);

export function problems(id) {
  const c = byId(id); const out = [];
  if (c.id !== id) return [`unknown character ${id}`];
  let n = 0;
  for (const k of [...KINDS, ...EXTRA_KINDS]) {
    const l = c.phrases?.[k] ?? [];
    if (l.length < (EXTRA_KINDS.includes(k) ? 4 : 3)) out.push(`${k}: only ${l.length} lines`);
    if (KINDS.includes(k)) n += l.length;
    for (const x of l) {
      if (typeof text(x) !== "string" || !text(x).trim()) out.push(`${k}: empty line`);
      else if (BANNED.test(text(x))) out.push(`${k}: banned word in "${text(x)}"`);
      const cd = cond(x);
      if (cd && !cd.split("&").every((p) => /^(\w+)([<>])(-?\d+)$/.test(p) || /^time=(morning|afternoon|evening|night)$/.test(p))) out.push(`${k}: bad condition "${cd}"`);
      if (cd) for (const p of cd.split("&")) { const m = /^(\w+)[<>]/.exec(p); if (m && !(c.roles ?? []).some((r) => r.id === m[1])) out.push(`${k}: unknown role "${m[1]}"`); }
      if (["alarm", "timerDone"].includes(k) && /[<>]/.test(cd ?? "") && /(brooding|light)/.test(cd ?? "")) { /* filtered at runtime; fine */ }
    }
  }
  if (n < MIN_LINES) out.push(`only ${n} lines across the 11 kinds (need ${MIN_LINES})`);
  for (const k of ["greeting", "goodbye"]) for (const t of TIMES) if (!(c.phrases?.[k] ?? []).some((x) => (cond(x) ?? "").includes(`time=${t}`))) out.push(`${k}: no ${t} line`);
  for (const r of c.roles ?? []) for (const dir of [">", "<"]) {
    const hits = KINDS.flatMap((k) => c.phrases?.[k] ?? []).filter((x) => (cond(x) ?? "").split("&").some((p) => p.startsWith(r.id + dir)));
    if (hits.length < 6) out.push(`role ${r.id}${dir}: only ${hits.length} lines (need 6)`);
  }
  const riffs = Object.entries(c.riffs ?? {});
  if (riffs.length < 8) out.push(`only ${riffs.length} riffs (need 8)`);
  for (const [t, l] of riffs) if (BANNED.test(l)) out.push(`riff ${t}: banned word`);
  const vocab = [...new Set(c.vocab ?? [])];
  if (vocab.length < 30) out.push(`only ${vocab.length} vocab words (need 30)`);
  for (const w of vocab) if (BANNED.test(w)) out.push(`vocab: banned "${w}"`);
  if (!c.jokeStyle) out.push("no jokeStyle");
  else if (BANNED.test(c.jokeStyle)) out.push("jokeStyle: banned word");
  return out;
}
export const ALL_IDS = [...PRESETS.filter((p) => p.id !== "default").map((p) => p.id), ...SECRETS.map((s) => s.id)];

if (process.argv[1] && /depth[\\/]check\.mjs$/.test(process.argv[1])) {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : ALL_IDS;
  let bad = 0;
  for (const id of ids) { const p = problems(id); if (p.length) { bad++; console.log(`✗ ${id}\n  - ${p.join("\n  - ")}`); } else console.log(`✓ ${id} (${KINDS.reduce((a, k) => a + (byId(id).phrases[k]?.length ?? 0), 0)} lines)`); }
  process.exitCode = bad ? 1 : 0;
}
