// social.enabled: the hidden switch for sharing memories with friends. OFF by default, and not in the Settings page.
// It can be turned on only by a developer:
//   env    DAYSPRING_SOCIAL=1                                   (DAYSPRING_SOCIAL=0 forces it off)
//   file   data/dev-settings.json  { "social": { "enabled": true } }   (DAYSPRING_DEV_SETTINGS names another file)
// This file imports nothing but node:fs and lib/features.mjs, so checking the switch loads none of the social code.
// The file switch works only where the release channel allows social (development builds); the env switch is the
// developer's own override.
import { existsSync, readFileSync } from "node:fs";
import { on as featureOn } from "../features.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const devSettingsFile = () => process.env.DAYSPRING_DEV_SETTINGS || join(ROOT, "data", "dev-settings.json");

export function enabled() {
  const env = String(process.env.DAYSPRING_SOCIAL ?? "").trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(env)) return false;
  if (["1", "true", "on", "yes"].includes(env)) return true;
  // the release channel (lib/features.mjs "social", stage dev): never in a production build, even with the file below
  try { if (!featureOn("social")) return false; } catch { return false; }
  try {
    const f = devSettingsFile();
    if (!existsSync(f)) return false;
    return JSON.parse(readFileSync(f, "utf8"))?.social?.enabled === true;
  } catch { return false; }
}

// Other dev-only social settings (user id, handle, a local test server), from the same file.
export function devSettings() {
  try { const f = devSettingsFile(); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8"))?.social ?? {} : {}; } catch { return {}; }
}
