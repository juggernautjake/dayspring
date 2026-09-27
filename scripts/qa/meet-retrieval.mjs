// Retrieval accuracy for meeting questions against the real installed course (read-only).
//   node scripts/qa/meet-retrieval.mjs [bank.json]      (default: scripts/qa/private/meet-bank.json; skipped if absent)
// Passes when the expected lesson is in the top 3 for at least 90% of the questions.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as ci from "../../lib/meet/course-index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bankFile = process.argv[2] || join(here, "private", "meet-bank.json");
if (!existsSync(bankFile)) { console.log("meet-retrieval: no question bank here (it's private); skipped"); process.exit(0); }
const bank = JSON.parse(readFileSync(bankFile, "utf8"));
const t0 = Date.now();
const ix = await ci.load(bank.course);
if (!ix) { console.log(`meet-retrieval: the course "${bank.course}" isn't installed; skipped`); process.exit(0); }
console.log(`index: ${ix.size} lessons (${ix.course.withText} with text), ${ix.vocab()} words, built in ${Date.now() - t0} ms`);
let top1 = 0, top3 = 0;
for (const { q, expect } of bank.questions) {
  const r = ix.search(q, 3);
  const ids = r.map((x) => x.id);
  const at = ids.findIndex((id) => expect.includes(id));
  if (at === 0) top1++;
  if (at >= 0) top3++;
  console.log(`${at === 0 ? "✓" : at > 0 ? "~" : "✗"} ${q}\n    → ${r.map((x) => `${x.id} (${x.score})`).join(", ")}   expected ${expect.join("/")}`);
}
const n = bank.questions.length;
console.log(`\ntop-1 ${top1}/${n} (${Math.round(100 * top1 / n)}%) · top-3 ${top3}/${n} (${Math.round(100 * top3 / n)}%)`);
process.exit(top3 / n >= 0.9 ? 0 : 1);
