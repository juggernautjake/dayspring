// The release gate: cameras are a "dev" stage feature (lib/features.mjs decides whether this build turns it on).
// Routes, AI tools, no-AI intents, Settings → Cameras, the Cameras page, and background monitors and recording all ask
// on() first. If lib/features.mjs isn't there (an older build), cameras are on.
let mod = null;
export const ready = import("../features.mjs").then((m) => { mod = m; }).catch(() => { mod = { on: () => true }; });
export function on() {
  if (process.env.DAYSPRING_CAMERAS_OFF === "1") return false;
  try { return mod ? mod.on("cameras") !== false : true; } catch { return true; }
}
