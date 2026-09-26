// The developer log: everything needed to see why a conversation went the way it did, one JSON line per event in
// data/devlog/YYYY-MM-DD.jsonl (local only; never sent anywhere).
//   heard     what speech recognition finalized (or what was typed), and how (voice / typed)
//   sent      the full message that went to be answered (after gathering pieces)
//   reply     who answered (claude / skill / offline / tv-local), how long it took, tokens, what changed
//   announce  something Dayspring said on its own (schedule, reminders, texts, church, people…)
//   error     anything that failed (timeouts, rejected requests, display errors)
//   watchdog  listening restarted, stuck states reset
// Read it with GET /api/devlog?date=YYYY-MM-DD (or open the file). Kept 60 days.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "devlog");
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
let pruned = null;

export function log(type, data = {}) {
  try {
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
    const at = data.at ? new Date(data.at) : new Date();
    const line = { at: at.toISOString(), type, ...data };
    delete line.at_;
    appendFileSync(join(DIR, `${localDate(at)}.jsonl`), JSON.stringify(line) + "\n");
    if (pruned !== localDate()) { pruned = localDate(); prune(); }
  } catch { /* logging must never break anything */ }
}
export function read(date = localDate()) {
  const f = join(DIR, `${date}.jsonl`);
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function prune() {
  const cutoff = localDate(new Date(Date.now() - 60 * 86400000));
  for (const f of readdirSync(DIR)) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) < cutoff) { try { unlinkSync(join(DIR, f)); } catch { /* in use */ } }
}
