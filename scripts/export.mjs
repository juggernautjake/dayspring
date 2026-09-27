// Builds the generic, shareable Dayspring from this install: the code only, never the owner's data or keys.
//   node scripts/export.mjs [target folder]      (default: a "dayspring-app" folder next to this project)
// Layout of the export (a flat repo): the app at the root, the launchers and repo files from dist/, docs/README.md as
// README.md, an empty data/ (.gitkeep). Then the privacy scan runs on the result and the export FAILS (exit 1, files
// left in place for you to look at) if anything personal is found. The target's .git, node_modules, data and .env
// are kept, so the export can be re-run inside a git checkout.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_TARGET, report, scan } from "./privacy-scan.mjs";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(process.argv[2] ?? DEFAULT_TARGET);
if (target === resolve(DESK) || target.startsWith(resolve(DESK) + "\\")) { console.error("The export can't go inside the app itself."); process.exit(2); }

// top-level entries never exported (personal, generated, or local tools)
const SKIP_TOP = new Set(["data", ".env", "node_modules", "backups", "dist", "dist-out", "bin", "updates", "logs", "README.md", ".gitignore", ".env.example", ".git"]);
// anywhere: temp files, the audit (it tests against the owner's own data), Twilio-only docs
const SKIP_ANY = [/\.tmp\./i, /^vmswap/i, /twilio.*\.(md|html)$/i, /^audit\.mjs$/i, /\.damaged-/i, /\.log$/i];
// kept in the target between exports
const KEEP_TARGET = new Set([".git", "node_modules", "data", ".env", "dist-out"]);

mkdirSync(target, { recursive: true });
for (const e of readdirSync(target)) if (!KEEP_TARGET.has(e)) rmSync(join(target, e), { recursive: true, force: true });

const filter = (src) => {
  if (SKIP_ANY.some((r) => r.test(basename(src)))) return false;
  const rel = relative(DESK, src).split(/[\\/]/);
  if (rel[0] === "docs" && rel[1] === "dev" && rel[2] === "badge-previews") return false;   // badge review sheets and videos: dev only
  return !(rel.length === 1 && SKIP_TOP.has(rel[0]));
};
for (const e of readdirSync(DESK)) {
  const src = join(DESK, e);
  if (!filter(src)) continue;
  cpSync(src, join(target, e), { recursive: true, filter });
}
// repo files and launchers
const DIST = join(DESK, "dist");
if (existsSync(DIST)) for (const e of readdirSync(DIST)) cpSync(join(DIST, e), join(target, e), { recursive: true });
if (existsSync(join(DESK, "docs", "README.md"))) cpSync(join(DESK, "docs", "README.md"), join(target, "README.md"));
mkdirSync(join(target, "data"), { recursive: true });
writeFileSync(join(target, "data", ".gitkeep"), "");

const files = readdirSync(target, { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && !/[\\/](\.git|node_modules)([\\/]|$)/.test(join(d.parentPath ?? d.path, ""))).length;
console.log(`Exported ${files} files to ${target}`);
if (!report(scan(target), target)) {
  console.log("\nNothing was published. Fix these in the source and export again.");
  process.exit(1);
}
