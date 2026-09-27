// Turns what the Meet window sees (caption lines that grow as people talk, and chat messages) into requests for an
// assistant: who asked, which assistant, what they asked, and whether they're allowed to.
//
//   const l = createMeetListener({ parser, permissions, onRequest, onDenied, isEcho, ownerSpeaking });
//   session events → l.event(ev)
//   onRequest({ assistant, question, speaker, via: "voice" | "chat", isOwner })
//
// Caption lines are only acted on once they stop changing for a moment (settleMs): the end of what was said. Anything
// not addressed to an assistant is dropped here and never kept. Captions of the assistants' own voice (which reaches
// the meeting through the owner's microphone, so it's captioned as the owner) are ignored via isEcho / ownerSpeaking.
import { createAddressParser } from "./address.mjs";
import { isOwnMessage } from "./chat.mjs";
import { isSelf } from "./names.mjs";

const norm = (t) => String(t ?? "").toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
const words = (t) => (String(t ?? "").match(/\S+/g) ?? []).length;

export function createMeetListener({ parser = createAddressParser(), permissions, onRequest = () => {}, onDenied = () => {}, isEcho = () => false,
  ownerSpeaking = () => false, isOwner = (name) => isSelf(name), settleMs = 1300, speakers = ["Dayspring", "Lantern"], setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const lines = new Map();            // caption id → { speaker, text, timer, handled: [questions] }
  const seenChat = new Set();
  let stats = { captions: 0, chats: 0, requests: 0, denied: 0, echoes: 0 };

  function settle(id) {
    const l = lines.get(id); if (!l) return;
    l.timer = null;
    const owner = isOwner(l.speaker);
    if (owner && ownerSpeaking()) return;                      // the assistant's own voice, captioned as the owner
    const r = parser.parseLast(l.text);
    if (!r || words(r.question) < (owner ? 1 : 2)) return;          // the owner's one-word commands ("Dayspring, mute")
    const q = norm(r.question);
    if (l.handled.some((h) => q === h || q.startsWith(h) || h.startsWith(q))) return;   // already answered (the line just grew)
    if (owner && isEcho(r.question)) { stats.echoes++; l.handled.push(q); return; }
    l.handled.push(q);
    dispatch({ assistant: r.assistant, question: r.question, speaker: l.speaker, via: "voice", isOwner: owner });
  }
  function dispatch(req) {
    if (!permissions || permissions.allowed(req.speaker, req.assistant, { isOwner: req.isOwner })) { stats.requests++; onRequest(req); }
    else { stats.denied++; onDenied({ assistant: req.assistant, speaker: req.speaker, via: req.via }); }   // the words are not passed on
  }

  return {
    event(ev) {
      if (!ev || typeof ev !== "object") return;
      if (ev.type === "caption") {
        stats.captions++;
        const id = String(ev.id ?? ev.speaker ?? "");
        let l = lines.get(id);
        if (!l) { l = { speaker: ev.speaker ?? "", text: "", timer: null, handled: [] }; lines.set(id, l); }
        if (ev.speaker) l.speaker = ev.speaker;
        l.text = String(ev.text ?? "");
        if (l.timer) clearTimer(l.timer);
        l.timer = setTimer(() => settle(id), settleMs);
        if (lines.size > 200) { for (const k of [...lines.keys()].slice(0, 100)) { const x = lines.get(k); if (x?.timer) clearTimer(x.timer); lines.delete(k); } }
      } else if (ev.type === "chat") {
        stats.chats++;
        const id = String(ev.id ?? "");
        if (id && seenChat.has(id)) return;
        if (id) seenChat.add(id);
        const text = String(ev.text ?? "").trim();
        if (!text || isOwnMessage(text, speakers)) return;
        // "@Lantern …" / "Dayspring, …" in the chat
        const r = parser.parse(text.replace(/^@\s*/, "@"));
        if (!r || words(r.question) < 1) return;
        dispatch({ assistant: r.assistant, question: r.question, speaker: ev.author ?? "", via: "chat", isOwner: isOwner(ev.author ?? "") });
      }
    },
    flush() { for (const [id, l] of lines) if (l.timer) { clearTimer(l.timer); settle(id); } },
    stats: () => ({ ...stats }),
    clear() { for (const l of lines.values()) if (l.timer) clearTimer(l.timer); lines.clear(); seenChat.clear(); stats = { captions: 0, chats: 0, requests: 0, denied: 0, echoes: 0 }; },
  };
}
