// Makes a release zip of the generic Dayspring: export (with the privacy scan) → dist-out/Dayspring.zip.
// The file name never changes, so the one-click link …/releases/latest/download/Dayspring.zip always gets the newest version.
// It never pushes or publishes anything; it prints the steps for you to do that yourself.
//   node scripts/release.mjs [export folder]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_TARGET } from "./privacy-scan.mjs";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(process.argv[2] ?? DEFAULT_TARGET);
const pkg = JSON.parse(readFileSync(join(DESK, "package.json"), "utf8"));
const v = pkg.version, repo = pkg.dayspring?.updateRepo ?? "";

console.log(`Dayspring ${v}: exporting to ${target}\n`);
const ex = spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), target], { stdio: "inherit" });
if (ex.status !== 0) { console.error("\nRelease stopped: the export or its privacy scan failed (see above). Nothing was zipped."); process.exit(1); }

const out = join(DESK, "dist-out");
mkdirSync(out, { recursive: true });
const zip = join(out, "Dayspring.zip");
rmSync(zip, { force: true });
// everything in the export except git, installed modules, and anything personal a test run may have left behind
const SKIP = new Set([".git", "node_modules", "data", ".env", "dist-out", "backups", "bin", "updates", "logs"]);
const entries = readdirSync(target).filter((e) => !SKIP.has(e));
const t = spawnSync("tar", ["-a", "-c", "-f", zip, "-C", target, ...entries, "data/.gitkeep"], { encoding: "utf8", windowsHide: true });
if (t.status !== 0 || !existsSync(zip)) { console.error("Zipping failed: " + (t.stderr || "").trim()); process.exit(1); }
const list = spawnSync("tar", ["-t", "-f", zip], { encoding: "utf8" }).stdout.split(/\r?\n/).filter(Boolean);
if (!list.includes("server.mjs") || !list.includes("package.json")) { console.error("The zip is missing server.mjs or package.json."); process.exit(1); }
if (list.some((f) => /^(\.env$|data\/(?!\.gitkeep$).|node_modules\/)/.test(f))) { console.error("The zip contains personal or installed files; stopping."); process.exit(1); }

console.log(`\nRelease zip: ${zip} (${(statSync(zip).size / 1024).toFixed(0)} KB, ${list.length} files)`);
console.log(`
Nothing has been published. To publish Dayspring ${v} (you do these yourself):
${repo ? "" : `
  0. Set the update repo first, so installs can find updates: in apps/desk/package.json set
     "dayspring": { "updateRepo": "YOUR-GITHUB-NAME/dayspring" }, then run this again.
`}
  1. First time only: create an empty public repo on GitHub named "dayspring" (github.com/new), then:
       cd "${target}"
       git init -b main
       git add -A
       git commit -m "Dayspring ${v}"
       git remote add origin https://github.com/${repo || "YOUR-GITHUB-NAME/dayspring"}.git
       git push -u origin main
     Later releases:
       cd "${target}"
       git add -A
       git commit -m "Dayspring ${v}"
       git push

  2. Make the release (either way):
     - Website: github.com/${repo || "YOUR-GITHUB-NAME/dayspring"}/releases/new → tag v${v} → title "Dayspring ${v}" →
       write what's new → attach ${zip} → Publish release.
     - GitHub CLI: gh release create v${v} "${zip}" --title "Dayspring ${v}" --notes "What's new: ..."

  Installed copies see it within a day (or right away with "Update Dayspring.cmd" / Settings → Updates).
`);
