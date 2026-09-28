// What the owner corrected about videos, the same way lib/music/prefs.mjs does for songs: for each request (its key,
// rank.mjs keyOf) the videos he turned down ("not that") and the one he kept (a pick from the top 3, or one he let play).
// data/video-prefs.json (tests: DAYSPRING_VIDEO_PREFS).
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJSONAtomic } from "../atomic.mjs";

const FILE = () => process.env.DAYSPRING_VIDEO_PREFS || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "video-prefs.json");
let db = null, dbFile = null;
function load() {
  if (db && dbFile === FILE()) return db;
  dbFile = FILE();
  try { db = existsSync(dbFile) ? JSON.parse(readFileSync(dbFile, "utf8")) : null; } catch { db = null; }
  db ??= { requests: {} }; db.requests ??= {};
  return db;
}
function save() {
  const d = load(), keys = Object.keys(d.requests);
  if (keys.length > 300) for (const k of keys.sort((a, b) => (d.requests[a].at ?? 0) - (d.requests[b].at ?? 0)).slice(0, keys.length - 300)) delete d.requests[k];
  try { mkdirSync(dirname(dbFile), { recursive: true }); writeJSONAtomic(dbFile, d, 2); } catch (e) { console.log(`video prefs: not saved (${e.message})`); }
}
const entry = (key) => (load().requests[key] ??= { rejected: [], kept: null, at: Date.now() });
export function forKey(key) { const e = load().requests[key]; return { rejected: new Set(e?.rejected ?? []), kept: e?.kept?.id ?? null }; }
export function reject(key, id, title = "") {
  if (!key || !id) return;
  const e = entry(key);
  e.rejected = [...e.rejected.filter((x) => x !== id), id].slice(-40);
  if (e.kept?.id === id) e.kept = null;
  e.at = Date.now(); e.lastRejected = title || id; save();
}
export function keep(key, id, title = "") {
  if (!key || !id) return;
  const e = entry(key);
  e.kept = { id, title, at: Date.now() }; e.rejected = e.rejected.filter((x) => x !== id); e.at = Date.now(); save();
}
export const all = () => load();
export function reload() { db = null; dbFile = null; }
