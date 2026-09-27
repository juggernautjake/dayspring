// How quickly Dayspring answers in calls: the last turns, for Settings → Calls, and a log file
// (data/logs/call-latency.log, one JSON line per turn). Only timings and the path taken are kept, never any words.
//
//   const t = latency.begin({ via: "tunein" | "discord-voice" | "discord-text", endedAt })  // endedAt = end of speech
//   t.mark("stt")  t.mark("firstToken")  t.mark("firstSentence")  t.mark("firstAudio")  t.done({ offline, model })
import { appendFileSync, mkdirSync, statSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LOG = () => process.env.DS_CALL_LATENCY_LOG || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "logs", "call-latency.log");
const recent = [];
const open = new Map();
let seq = 0;

export function begin({ via = "tunein", endedAt = Date.now(), id = null } = {}) {
  const rec = { id: id ?? `t${Date.now().toString(36)}${(seq++).toString(36)}`, via, endedAt, marks: {}, at: new Date().toISOString() };
  open.set(rec.id, rec);
  const api = {
    id: rec.id,
    mark(name, at = Date.now()) { if (!(name in rec.marks)) rec.marks[name] = Math.max(0, at - rec.endedAt); return api; },
    done(extra = {}) { finish(rec, extra); return summary(rec); },
    cancel() { open.delete(rec.id); },          // it wasn't for Dayspring after all: nothing is kept
    note(extra = {}) { Object.assign(rec, extra); return api; },
  };
  setTimeout(() => { if (open.has(rec.id)) finish(rec, { timeout: true }); }, 60_000).unref?.();
  return api;
}
// the display reports when the first audio actually started playing
export function markById(id, name, at = Date.now()) { const r = open.get(id); if (r && !(name in r.marks)) { r.marks[name] = Math.max(0, at - r.endedAt); if (name === "firstAudio") finish(r, {}); } }

function finish(rec, extra) {
  if (!open.delete(rec.id)) return;
  Object.assign(rec, extra);
  rec.total = rec.marks.firstAudio ?? null;
  recent.push(summary(rec)); while (recent.length > 10) recent.shift();
  try {
    const f = LOG(); mkdirSync(dirname(f), { recursive: true });
    try { if (statSync(f).size > 512 * 1024) renameSync(f, f + ".old"); } catch { /* no file yet */ }
    appendFileSync(f, JSON.stringify(summary(rec)) + "\n");
  } catch { /* logging is best-effort */ }
}
const summary = (r) => ({ id: r.id, at: r.at, via: r.via, stt: r.marks.stt ?? null, firstToken: r.marks.firstToken ?? null, firstSentence: r.marks.firstSentence ?? null, firstAudio: r.marks.firstAudio ?? null, total: r.marks.firstAudio ?? null, offline: Boolean(r.offline), model: r.model ?? null, timeout: Boolean(r.timeout) });
export const last = () => recent.slice().reverse();
export function _reset() { recent.length = 0; open.clear(); }
