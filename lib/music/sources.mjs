// Other places music can come from, besides Spotify: the owner's own files ("local"), Google Drive ("drive"), …
// A source registers once (at start-up) and the music resolver then asks it too, so "play Holy Forever" can match a
// file on his computer or a Spotify song (the best match wins), and "play Holy Forever from my computer" asks only it.
//
//   registerSource({
//     id: "local",                                   // also what candidates carry as c.source
//     label: "your computer",                        // for replies ("Playing Holy Forever from your computer.")
//     phrases: /\b(?:from|on|off) (?:my )?(?:computer|pc|laptop|files|hard drive)\b/,   // "from my computer" → only this source
//     available: () => true,                         // optional: false skips it (not set up)
//     search: async (req) => [candidate, …],         // req is the parsed request (parse.mjs); return candidates:
//        { type: "track"|"album"|"artist"|"playlist", name, by, uri|id, play: {…anything your play() needs…}, art? }
//        Leave score out to be scored like Spotify's results (resolve.mjs scoreItem), or give score 0–1.
//     play: async (candidate, req) => ({ title, artist }),   // start it; return what's playing if you know
//     verify: async (candidate, started) => ({ ok: true|false|null, now: { name, by } }),   // optional
//   })
// Spotify itself is the built-in source "spotify" ("on spotify" / "from spotify" picks it alone).

const list = new Map();
export const SPOTIFY_PHRASE = /\b(?:on|from|in|using|with) spotify\b/;

export function registerSource(src) {
  if (!src?.id || typeof src.search !== "function" || typeof src.play !== "function") throw new Error("registerSource needs id, search() and play()");
  if (src.id === "spotify") throw new Error("\"spotify\" is built in");
  list.set(src.id, src);
  return () => unregisterSource(src.id);
}
export function unregisterSource(id) { list.delete(id); }
export const sources = () => [...list.values()];
export const getSource = (id) => list.get(id) ?? null;

// Which source the words ask for ("from my drive" → "drive", "on spotify" → "spotify"), and the words without it.
export function sourceIn(text) {
  const t = String(text ?? "");
  if (SPOTIFY_PHRASE.test(t)) return { from: "spotify", rest: t.replace(SPOTIFY_PHRASE, " ").replace(/\s+/g, " ").trim() };
  for (const s of list.values()) if (s.phrases && s.phrases.test(t)) return { from: s.id, rest: t.replace(s.phrases, " ").replace(/\s+/g, " ").trim() };
  return { from: null, rest: t };
}
