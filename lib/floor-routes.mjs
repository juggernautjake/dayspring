// /api/floor: the Dayspring screen's half of the conversation floor (lib/floor.mjs, public/floor.js).
//   POST /api/floor { type: "owner", source }          he started talking on the screen (wake word, 🎙 Talk, typing)
//   POST /api/floor { type: "tv", state: idle|busy }   what the speaking screen is doing (with a heartbeat while busy)
//   POST /api/floor { type: "done", fid, outcome, tv } an announcement was presented ("spoken") or called back ("cancelled")
//   POST /api/floor { type: "release" }                "what were you going to say?" (the sign's tap)
//   GET  /api/floor                                    what's held, and why
// Only the page that speaks is listened to (bus.speaker()), so a second open screen can't end his turn early.
import * as floor from "./floor.mjs";
import * as bus from "./bus.mjs";
import * as confirm from "./confirm.mjs";

// Something he's in the middle of answering keeps the floor his: a file confirmation (two minutes at most), a Money
// review question. A joke offer that was held gets its "yes" window when it's finally said.
floor.addBusyCheck(() => confirm.pendingCount() > 0);
import("./money/index.mjs").then((money) => floor.addBusyCheck(() => { const p = money._pending?.(); return Boolean(p && Date.now() - p.at < 3 * 60_000); })).catch(() => {});
import("./intents/index.mjs").then((intents) => floor.onFire((item) => { if (item.kind === "jokeoffer") intents.markJokeOffer?.("tv"); })).catch(() => {});

const lastSeq = new Map();          // page → the last event number seen from it
const fromSpeaker = (page) => { const s = bus.speaker(); return !s?.id || !page || s.id === String(page); };

export async function handle(req, res, { m, p, send, readJSON }) {
  if (p !== "/floor") return false;
  if (m === "GET") return send(res, 200, floor.status()), true;
  if (m !== "POST") return false;
  const b = await readJSON(req).catch(() => ({}));
  if (!fromSpeaker(b.page)) return send(res, 200, { ok: false, why: "not the speaking screen" }), true;
  // "owner" and "tv" arrive in the order they were sent (a late "owner" after an "idle" would leave his turn open)
  if ((b.type === "owner" || b.type === "tv") && Number.isFinite(b.seq) && b.page) {
    const last = lastSeq.get(b.page) ?? 0;
    if (b.seq <= last) return send(res, 200, { ok: false, why: "out of order" }), true;
    lastSeq.set(b.page, b.seq); if (lastSeq.size > 20) lastSeq.delete(lastSeq.keys().next().value);
  }
  switch (b.type) {
    case "owner": floor.owner(String(b.source ?? "voice").slice(0, 30), "tv"); break;
    case "tv": floor.tv(b.state === "busy" ? "busy" : "idle"); break;
    case "done": floor.done(String(b.fid ?? ""), b.outcome === "cancelled" ? "cancelled" : "spoken", b.tv === "busy" || b.tv === "idle" ? b.tv : null); break;
    case "release": return send(res, 200, { ok: true, released: floor.release() }), true;
    default: return send(res, 400, { error: "unknown floor event" }), true;
  }
  return send(res, 200, { ok: true, blockedBy: floor.floor.blockedBy(), held: floor.status().held.length }), true;
}
