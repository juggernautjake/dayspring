// Makes a release zip of the generic Dayspring: export (with the privacy scan) → the checks → the zip.
//   node scripts/release.mjs [export folder] [--channel stable|dev] [--tag v1.7.0-dev.1]
// Two channels (lib/features.mjs, docs/publishing-releases.md):
//   --channel stable (the default): production. dist-out/Dayspring.zip for a normal GitHub release (Latest). The file
//            name never changes, so the one-click link …/releases/latest/download/Dayspring.zip always gets the newest.
//   --channel dev: development. dist-out/Dayspring-dev.zip for a GitHub PRE-release (never Latest), tagged like
//            v1.7.0-dev.1 (--tag, required). Its export goes to a separate folder (default: the export folder + "-dev"),
//            never the public repo's, because its package.json carries the -dev version.
// Both run the privacy scan and the same checks, and both write build-info.json { channel, version, commit } into the
// zip: that's how an install knows which features it has (the dev code is in both; the channel switches it on or off).
// It never pushes or publishes anything; it prints the steps for you to do that yourself.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_TARGET } from "./privacy-scan.mjs";
import { buildInfo, ghCommand, options } from "./release-channel.mjs";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(DESK, "package.json"), "utf8"));
const repo = pkg.dayspring?.updateRepo ?? "";
const opt = options(process.argv.slice(2), { pkgVersion: pkg.version, defaultTarget: DEFAULT_TARGET });
if (opt.errors.length) { console.error("Release stopped:\n  " + opt.errors.join("\n  ")); process.exit(1); }
const { target, channel } = opt, v = opt.version;

console.log(`Dayspring ${v} (${channel === "dev" ? "development" : "production"}): exporting to ${target}\n`);
const ex = spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), target], { stdio: "inherit" });
if (ex.status !== 0) { console.error("\nRelease stopped: the export or its privacy scan failed (see above). Nothing was zipped."); process.exit(1); }

// the checks: the feature registry, the compatibility lists and the test checklist must be sound
{
  const env = { ...process.env, DAYSPRING_CHANNEL: channel };
  const chk = spawnSync(process.execPath, ["--input-type=module", "-e", `
    const f = await import(${JSON.stringify(new URL("../lib/features.mjs", import.meta.url).href)});
    const c = await import(${JSON.stringify(new URL("../lib/compat.mjs", import.meta.url).href)});
    const t = await import(${JSON.stringify(new URL("../lib/testing.mjs", import.meta.url).href)});
    const bad = [...c.validateAll()];
    const items = t.checklist().items, ids = new Set(f.ids());
    for (const i of items) if (!ids.has(i.feature)) bad.push("checklist " + i.id + ": unknown feature " + i.feature);
    for (const x of f.REGISTRY) if (x.stage !== "stable" && !items.some((i) => i.feature === x.id)) bad.push("feature " + x.id + " has no checklist items");
    if (bad.length) { console.error(bad.slice(0, 20).join("\\n")); process.exit(1); }`], { encoding: "utf8", env });
  if (chk.status !== 0) { console.error("Release stopped: the feature, compatibility or checklist data has problems:\n" + (chk.stderr || chk.stdout)); process.exit(1); }
}

// build-info.json: which channel this build is, so lib/features.mjs turns the right features on
const commit = (() => { try { const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: DESK, encoding: "utf8", windowsHide: true }); return r.status === 0 ? r.stdout.trim() : null; } catch { return null; } })();
writeFileSync(join(target, "build-info.json"), JSON.stringify(buildInfo({ channel, version: v, commit }), null, 2) + "\n");
// a development build's version is its tag (1.7.0-dev.1), in the export only (the source's package.json is untouched)
if (channel === "dev") {
  const pj = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
  pj.version = v;
  writeFileSync(join(target, "package.json"), JSON.stringify(pj, null, 2) + "\n");
}

// The owner's Lantern hub, baked into the zip only (config/lantern-hub.json), so an invited person's Dayspring can
// "Connect to Lantern" without pasting anything. It comes from the same private file Lantern's release uses:
// DAYSPRING_RELEASE_HUB, else %LOCALAPPDATA%\Lantern\release-hub.json, shaped { url, anonKey[, emailCode] }. Only the
// PUBLIC key may go in: a secret or service_role key stops the release. The export (the public repo) never has it.
const hubFile = process.env.DAYSPRING_RELEASE_HUB || join(process.env.LOCALAPPDATA || "", "Lantern", "release-hub.json");
const hubTarget = join(target, "config", "lantern-hub.json");
let bakedHub = null;
if (process.env.DAYSPRING_RELEASE_HUB !== "" && existsSync(hubFile)) {
  let h = null;
  try { h = JSON.parse(readFileSync(hubFile, "utf8").replace(/^﻿/, "")); } catch { console.error("Release stopped: " + hubFile + " is not valid JSON."); process.exit(1); }
  const key = String(h?.anonKey ?? "");
  const secret = /sb_secret_|service_role/i.test(key) || (() => { try { return JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString()).role === "service_role"; } catch { return false; } })();
  if (!/^https:\/\/\S+$/.test(String(h?.url ?? "")) || key.length < 20) { console.error("Release stopped: " + hubFile + ' needs { "url": "https://<project>.supabase.co", "anonKey": "<the public key>" }.'); process.exit(1); }
  if (secret) { console.error("Release stopped: " + hubFile + " holds a SECRET key. Only the public (anon or publishable) key may go into a release."); process.exit(1); }
  mkdirSync(join(target, "config"), { recursive: true });
  writeFileSync(hubTarget, JSON.stringify({ url: h.url, anonKey: key, ...(h.emailCode === true ? { emailCode: true } : {}) }, null, 2) + "\n");
  bakedHub = h.url;
}

const out = join(DESK, "dist-out");
mkdirSync(out, { recursive: true });
const zip = join(out, opt.zipName);
rmSync(zip, { force: true });
// everything in the export except git, installed modules, and anything personal a test run may have left behind
const SKIP = new Set([".git", "node_modules", "data", ".env", "dist-out", "backups", "bin", "updates", "logs"]);
const entries = readdirSync(target).filter((e) => !SKIP.has(e));
const t = spawnSync("tar", ["-a", "-c", "-f", zip, "-C", target, ...entries, "data/.gitkeep"], { encoding: "utf8", windowsHide: true });
if (t.status !== 0 || !existsSync(zip)) { console.error("Zipping failed: " + (t.stderr || "").trim()); process.exit(1); }
const list = spawnSync("tar", ["-t", "-f", zip], { encoding: "utf8" }).stdout.split(/\r?\n/).filter(Boolean);
if (!list.includes("server.mjs") || !list.includes("package.json")) { console.error("The zip is missing server.mjs or package.json."); process.exit(1); }
if (!list.includes("build-info.json")) { console.error("The zip is missing build-info.json (the release channel)."); process.exit(1); }
if (list.some((f) => /^(\.env$|data\/(?!\.gitkeep$).|node_modules\/)|\.onnx$|(^|\/)(faces|comms)\.bin$|(^|\/)vision-cache\//.test(f))) { console.error("The zip contains personal or installed files; stopping."); process.exit(1); }
if (bakedHub) { rmSync(hubTarget, { force: true }); console.log("Lantern hub baked into the zip only (config/lantern-hub.json): " + bakedHub); }
else console.log("No Lantern hub baked in (invited people paste the hub address in Settings → Lantern).");
// the development build's version stays in its own export folder; the production export keeps its build-info.json
// (a copy cloned from the public repo is production too, with or without it)

console.log(`\nRelease zip: ${zip} (${(statSync(zip).size / 1024).toFixed(0)} KB, ${list.length} files, channel ${channel})`);
if (channel === "dev") {
  console.log(`
Nothing has been published. To publish the development version ${v} (you do this yourself):

  ${ghCommand(opt, zip)}

  It's a PRE-release and never "Latest": production installs never see it. Installs on the Development channel
  (Settings → Updates → Which versions) pick it up. The source repo isn't changed; the development export is in
  ${target} (not a git repo; don't push it).
`);
} else console.log(`
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
     - GitHub CLI: ${ghCommand(opt, zip)}

  Installed copies see it within a day (or right away with "Update Dayspring.cmd" / Settings → Updates).
`);
