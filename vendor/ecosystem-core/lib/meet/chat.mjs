// Messages for a meeting's chat: prefixed with who is talking ("Dayspring: …", "Lantern: …") and split at sentence or
// line breaks so each piece fits the chat box (Google Meet takes 500 characters per message).
//
//   splitChat("Dayspring", longText) → ["Dayspring: first part…", "Dayspring (2/3): …", …]
//   isOwnMessage("Lantern: hello", ["Dayspring", "Lantern"]) → true   (so the assistants never answer themselves)

export const MEET_CHAT_MAX = 500;

export function splitChat(speaker, text, { max = MEET_CHAT_MAX } = {}) {
  const body = String(text ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!body) return [];
  const head = (i, n) => (n > 1 && i > 0 ? `${speaker} (${i + 1}/${n}): ` : `${speaker}: `);
  const room = max - `${speaker} (99/99): `.length;
  const pieces = [];
  let cur = "";
  const push = () => { if (cur.trim()) pieces.push(cur.trim()); cur = ""; };
  // lines first, then sentences, then words
  for (const line of body.split("\n")) {
    const units = line.length <= room ? [line] : line.split(/(?<=[.!?])\s+/);
    for (let u of units) {
      while (u.length > room) {                  // one very long sentence: at a space
        const cut = u.lastIndexOf(" ", room); const at = cut > room * 0.5 ? cut : room;
        if (cur) push();
        pieces.push(u.slice(0, at).trim()); u = u.slice(at).trim();
      }
      const sep = cur ? (cur.endsWith("\n") ? "" : " ") : "";
      if ((cur + sep + u).length > room) push();
      cur += (cur ? (cur.endsWith("\n") ? "" : " ") : "") + u;
    }
    if (cur && (cur + "\n").length <= room) cur += "\n"; else push();
  }
  push();
  return pieces.map((p, i) => head(i, pieces.length) + p.replace(/\n+$/, ""));
}

export function isOwnMessage(text, speakers = ["Dayspring", "Lantern"]) {
  const t = String(text ?? "").trim();
  return speakers.some((s) => new RegExp(`^${s}(?: \\(\\d+/\\d+\\))?:`, "i").test(t));
}
