// Email is a release-channel feature ("email"; lib/features.mjs decides whether this install has it). Everything email
// asks on() first: its routes (404 when off), the AI's email tools, the voice commands and intents, Settings → Email, the
// ✉ button and Mail window on the screen, and the background check for new mail.
// (Before lib/features.mjs exists, email is on.)
const features = await import("../features.mjs").catch(() => null);
export function on() {
  try { return typeof features?.on === "function" ? Boolean(features.on("email")) : true; } catch { return true; }
}
export const OFF_TEXT = "Email isn't turned on in this version of Dayspring yet.";
// the background check for new mail starts only through the feature gate (features.startJob("email", "mail.background")),
// so GET /api/features lists whether it ran
export function startJob(fn) {
  try { if (typeof features?.startJob === "function") return features.startJob("email", "mail.background", fn); } catch { return false; }
  if (!on()) return false;
  fn(); return true;
}
