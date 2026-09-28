// The release channel part of scripts/release.mjs, kept separate so the tests can check it without making a release.
//   production ("stable"): a normal GitHub release (Latest), asset Dayspring.zip, the version in package.json
//   development ("dev"):   a GitHub PRE-release, never Latest, asset Dayspring-dev.zip, tag like v1.7.0-dev.1
//   options(argv) → { channel, tag, version, target, zipName, errors }
//   buildInfo({ channel, version, commit }) → the build-info.json lib/features.mjs reads (the channel this build is)
//   ghCommand(opts, zipPath) → the gh command that publishes it (printed, never run)
//   suggestDevTag(version) → "v1.7.0-dev.1" (the next minor, first dev build)
import { resolve } from "node:path";

export const CHANNELS = ["stable", "dev"];
export const DEV_TAG = /^v?(\d+)\.(\d+)\.(\d+)-dev\.(\d+)$/;
export const zipName = (channel) => (channel === "dev" ? "Dayspring-dev.zip" : "Dayspring.zip");
export function suggestDevTag(version) {
  const [a, b] = String(version ?? "0.0.0").split("-")[0].split(".").map((x) => Number.parseInt(x, 10) || 0);
  return `v${a}.${b + 1}.0-dev.1`;
}

export function options(argv, { pkgVersion, defaultTarget }) {
  const errors = [];
  const val = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const flags = new Set(["--channel", "--tag"]);
  const positional = argv.filter((a, i) => !a.startsWith("--") && !flags.has(argv[i - 1]));
  let channel = String(val("--channel") ?? "stable").toLowerCase();
  if (channel === "production") channel = "stable";
  if (channel === "development") channel = "dev";
  if (!CHANNELS.includes(channel)) errors.push(`--channel must be "stable" or "dev" (got "${channel}").`);
  let tag = val("--tag"), version = pkgVersion;
  if (channel === "dev") {
    if (!tag) errors.push(`A development release needs its tag, for example: --tag ${suggestDevTag(pkgVersion)}`);
    else if (!DEV_TAG.test(tag)) errors.push(`"${tag}" isn't a development tag. Use the form v1.7.0-dev.1.`);
    else { tag = tag.startsWith("v") ? tag : "v" + tag; version = tag.slice(1); }
  } else {
    if (tag && tag.replace(/^v/, "") !== pkgVersion) errors.push(`A production release uses the version in package.json (${pkgVersion}); leave --tag out or use v${pkgVersion}.`);
    tag = `v${pkgVersion}`;
  }
  // a development export never goes into the public repo's folder (its package.json carries the -dev version)
  const target = resolve(positional[0] ?? (channel === "dev" ? `${defaultTarget}-dev` : defaultTarget));
  return { channel, tag, version, target, zipName: zipName(channel), errors };
}

export const buildInfo = ({ channel, version, commit = null }) => ({ channel, version, commit: commit || null, built: new Date().toISOString() });

export function ghCommand({ channel, tag, version }, zipPath) {
  return channel === "dev"
    ? `gh release create ${tag} "${zipPath}" --prerelease --latest=false --title "Dayspring ${version} (development)" --notes "Development version: everything, including features still being built. May have bugs."`
    : `gh release create ${tag} "${zipPath}" --latest --title "Dayspring ${version}" --notes "What's new: ..."`;
}
