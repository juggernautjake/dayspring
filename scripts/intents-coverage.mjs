// How much Dayspring understands without AI: the catalogue by family, phrasings per intent, the golden set's accuracy
// per family, and the intents that need more ways of saying them (fewer than 15 phrasings).
//   node scripts/intents-coverage.mjs [--min=15]
import "./qa/guard-data.mjs";   // first: tests never write to the real data folder
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "ds-coverage-"));
Object.assign(process.env, { DAYSPRING_TIMERS_FILE: join(TMP, "t.json"), DAYSPRING_RECIPES_FILE: join(TMP, "r.json"), DAYSPRING_LISTS_FILE: join(TMP, "l.json"), DAYSPRING_INTENT_LEARNED: join(TMP, "il.json"), DAYSPRING_SETTINGS_FILE: join(TMP, "s.json") });
const imp = (p) => import(pathToFileURL(join(DESK, p)).href);
const MIN = Number((process.argv.find((a) => a.startsWith("--min=")) ?? "--min=15").slice(6));
const I = await imp("lib/intents/index.mjs");
const { INTENTS } = await imp("lib/intents/catalog.mjs");
const { build } = await imp("lib/intents/match.mjs");
const { GOLDEN_TEXT } = await imp("scripts/qa/intents-golden.mjs");

const ix = build();
const perIntent = new Map(INTENTS.map((i) => [i.id, 0]));
for (const p of ix.phrasings) perIntent.set(p.intent.id, perIntent.get(p.intent.id) + 1);
const st = I.stats();
console.log(`Catalogue: ${st.intents} intents, ${st.phrasings} phrasings (${st.distinct} distinct), ${st.vocabulary} words`);

// golden set accuracy per family (hand-written lines only; test-intents.mjs adds the variations)
const STATE = { cooking: { cooking: true }, results: { recipeResults: true }, ringing: { ringing: true, timers: true }, timers: { timers: true } };
const fam = new Map(INTENTS.map((i) => [i.id, i.cat]));
const acc = new Map();
let n = 0;
for (const line of GOLDEN_TEXT.split("\n").map((l) => l.trim()).filter(Boolean)) {
  const m = /^(?:\[(\w+)\]\s*)?([\w.]+):\s*(.+)$/.exec(line); if (!m) continue;
  for (const text of m[3].split("|").map((x) => x.trim()).filter(Boolean)) {
    const p = I.plan(text, STATE[m[1]] ?? {}); const f = fam.get(m[2]) ?? "?";
    const a = acc.get(f) ?? { n: 0, t1: 0, t7: 0, golden: new Set() }; a.n++; n++; a.t1 += p.intent === m[2]; a.t7 += p.ranked.some((r) => r.id === m[2]); a.golden.add(m[2]); acc.set(f, a);
  }
}
console.log(`Golden set (hand-written): ${n} requests\n`);
console.log("family        intents  phrasings  golden  top-1   top-7");
const fams = [...new Set(INTENTS.map((i) => i.cat))].sort();
for (const f of fams) {
  const ids = INTENTS.filter((i) => i.cat === f).map((i) => i.id);
  const ph = ids.reduce((s, id) => s + perIntent.get(id), 0), a = acc.get(f);
  console.log(`${f.padEnd(13)} ${String(ids.length).padStart(7)} ${String(ph).padStart(10)} ${String(a?.n ?? 0).padStart(7)}  ${a ? (100 * a.t1 / a.n).toFixed(0).padStart(4) + "%" : "   -"}  ${a ? (100 * a.t7 / a.n).toFixed(0).padStart(4) + "%" : "   -"}`);
}
const thin = INTENTS.filter((i) => perIntent.get(i.id) < MIN);
const untested = INTENTS.filter((i) => ![...acc.values()].some((a) => a.golden.has(i.id)));
console.log(`\nIntents with fewer than ${MIN} phrasings (${thin.length}):`);
for (const i of thin) console.log(`  ${i.id.padEnd(22)} ${perIntent.get(i.id)}  e.g. "${i.ex}"`);
console.log(`\nIntents with no golden-set lines (${untested.length}): ${untested.map((i) => i.id).join(", ") || "none"}`);
rmSync(TMP, { recursive: true, force: true });
