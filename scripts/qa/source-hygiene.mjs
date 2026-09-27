// Source hygiene: no literal control characters in the code. A "\b" typed through a tool that unescapes it ends up
// as a real backspace (0x08) inside a regular expression, and /\bon spotify$/ silently never matches again. Checks
// every .mjs/.js/.cjs/.html/.css/.json/.md file (not node_modules, data, bin) for bytes 0x00–0x08, 0x0B, 0x0C and
// 0x0E–0x1F (tabs, line ends and the ESC in the code that prints colours are the only ones allowed).
//   node scripts/qa/source-hygiene.mjs        exit 0 = clean
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKIP = new Set(["node_modules", "data", "bin", "backups", "dist-out", ".git", "updates", "logs", "qa-out"]);
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => SKIP.has(e.name) ? [] : e.isDirectory() ? walk(join(d, e.name)) : /\.(mjs|js|cjs|html|css|json|md)$/.test(e.name) ? [join(d, e.name)] : []);
const BAD = /[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f]/;   // (0x1b, ESC, is allowed: terminal colours)
let n = 0, bad = 0;
for (const f of walk(DESK)) {
  n++;
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((l, i) => {
    const m = BAD.exec(l);
    if (m) { bad++; console.log(`FAIL  ${relative(DESK, f)}:${i + 1}: a literal control character 0x${m[0].charCodeAt(0).toString(16).padStart(2, "0")} (did "\\b" or "\\t" lose its backslash?)`); }
  });
}
console.log(bad ? `${bad} line(s) with control characters in ${n} files` : `PASS  ${n} files, no literal control characters`);
process.exit(bad ? 1 : 0);
