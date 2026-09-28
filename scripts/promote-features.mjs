// Bake the owner's promotions into the next release: reads a results export from the Testing page (Markdown or CSV,
// Settings → This app → Testing → Export) and, for every feature whose tests ALL passed, sets its stage in
// lib/features.mjs to "stable" with verifiedBy / verifiedAt. Then regenerate the docs (scripts/gen-feature-docs.mjs).
//   node scripts/promote-features.mjs <results.md|results.csv> [--dry-run] [--only id,id]
// Nothing else in lib/features.mjs changes; a feature with any test not passed is left as it is and listed.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseExport } from "../lib/testing.mjs";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FEATURES_FILE = () => process.env.DAYSPRING_FEATURES_SOURCE || join(DESK, "lib", "features.mjs");

// the registry line of a feature: `{ id: "money", name: …, stage: "beta", …` → with the new stage and who/when
export function promoteSource(src, id, { by = "owner", at = new Date().toISOString().slice(0, 10) } = {}) {
  const lines = src.split("\n");
  const i = lines.findIndex((l) => new RegExp(`^\\s*\\{ id: "${id.replace(/[^a-z0-9-]/g, "")}",`).test(l));
  if (i < 0) return { src, changed: false, why: "not in the registry" };
  const was = /stage: "(stable|beta|dev)"/.exec(lines[i])?.[1];
  if (!was) return { src, changed: false, why: "no stage on its line" };
  if (was === "stable") return { src, changed: false, why: "already stable" };
  let line = lines[i].replace(/, verifiedBy: "[^"]*"/, "").replace(/, verifiedAt: "[^"]*"/, "");
  line = line.replace(`stage: "${was}"`, `stage: "stable", verifiedBy: ${JSON.stringify(String(by || "owner"))}, verifiedAt: ${JSON.stringify(String(at || ""))}`);
  lines[i] = line;
  return { src: lines.join("\n"), changed: true, from: was };
}

export function plan(results, only = null) {
  const out = { promote: [], notReady: [] };
  for (const [id, r] of Object.entries(results.features ?? {})) {
    if (only && !only.includes(id)) continue;
    if (r.total > 0 && r.pass === r.total) out.promote.push({ id, by: r.verifiedBy || "owner", at: (r.verifiedAt || new Date().toISOString()).slice(0, 10) });
    else out.notReady.push({ id, pass: r.pass, total: r.total });
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--only");
  if (!file) { console.error("Usage: node scripts/promote-features.mjs <results.md|results.csv> [--dry-run] [--only id,id]"); process.exit(2); }
  const dry = argv.includes("--dry-run");
  const only = argv.includes("--only") ? String(argv[argv.indexOf("--only") + 1] ?? "").split(",").filter(Boolean) : null;
  const p = plan(parseExport(readFileSync(file, "utf8")), only);
  let src = readFileSync(FEATURES_FILE(), "utf8"); const done = [];
  for (const x of p.promote) { const r = promoteSource(src, x.id, x); if (r.changed) { src = r.src; done.push(`${x.id} (${r.from} → stable, ${x.by}, ${x.at})`); } else console.log(`  ${x.id}: ${r.why}`); }
  if (!dry && done.length) writeFileSync(FEATURES_FILE(), src);
  console.log(done.length ? `${dry ? "Would promote" : "Promoted"}: ${done.join("; ")}` : "Nothing to promote.");
  if (p.notReady.length) console.log(`Not every test passed yet: ${p.notReady.map((x) => `${x.id} ${x.pass}/${x.total}`).join(", ")}`);
  if (!dry && done.length) console.log("Next: node scripts/gen-feature-docs.mjs (updates docs/features-status.md).");
}
