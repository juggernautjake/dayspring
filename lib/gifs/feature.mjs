// Whether GIFs are switched on in this build: the release channels (lib/features.mjs, feature id "gifs", stage "dev").
// Until lib/features.mjs exists (or if it can't be loaded) GIFs count as on. Everything GIF-related asks enabled():
// the /api/gifs routes (404 when off, except /api/gifs/enabled), the voice commands, the no-AI intents, the AI's tools,
// Settings → GIFs and the picker on the screen (public/gifs.js asks /api/gifs/enabled).
const F = await import("../features.mjs").catch(() => ({ on: () => true }));
export const ID = "gifs";
export function enabled() {
  try { return typeof F.on === "function" ? F.on(ID) !== false : true; } catch { return true; }
}
