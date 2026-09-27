// What the owner has corrected: for each request (by its key, so "christian fold" and "christian folk" are the same
// request) the picks he turned down ("not that") and the one he kept. The resolver skips turned-down picks and
// prefers the kept one next time. A small JSON file on this computer: data/music-prefs.json
// (tests: DAYSPRING_MUSIC_PREFS=<file>).
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJSONAtomic } from "../atomic.mjs";

const FILE = () => process.env.DAYSPRING_MUSIC_PREFS || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "music-prefs.json");
let db = null, dbFile = null;
function load() {
  if (db && dbFile === FILE()) return db;
  dbFile = FILE();
  try { db = existsSync(dbFile) ? JSON.parse(readFileSync(dbFile, "utf8")) : null; } catch { db = null; }
  db ??= { requests: {} };
  db.requests ??= {};
  return db;
}
function save() {
  const d = load();
  // keep it small: the 300 most recent requests
  const keys = Object.keys(d.requests);
  if (keys.length > 300) for (const k of keys.sort((a, b) => (d.requests[a].at ?? 0) - (d.requests[b].at ?? 0)).slice(0, keys.length - 300)) delete d.requests[k];
  try { mkdirSync(dirname(dbFile), { recursive: true }); writeJSONAtomic(dbFile, d, 2); } catch (e) { console.log(`music prefs: not saved (${e.message})`); }
}
const entry = (key) => { const d = load(); return (d.requests[key] ??= { rejected: [], kept: null, at: Date.now() }); };

export function forKey(key) {
  const e = load().requests[key];
  return { rejected: new Set(e?.rejected ?? []), kept: e?.kept ?? null };
}
export function reject(key, uri, name = "") {
  if (!key || !uri) return;
  const e = entry(key);
  e.rejected = [...e.rejected.filter((u) => u !== uri), uri].slice(-30);
  if (e.kept?.uri === uri) e.kept = null;
  e.at = Date.now(); e.lastRejected = name || uri;
  save();
}
export function keep(key, uri, name = "") {
  if (!key || !uri) return;
  const e = entry(key);
  e.kept = { uri, name, at: Date.now() };
  e.rejected = e.rejected.filter((u) => u !== uri);
  e.at = Date.now();
  save();
}
export function forget(key) { const d = load(); delete d.requests[key]; save(); }
export function all() { return load(); }
// read the file again next time (tests swap the file between cases)
export function reload() { db = null; dbFile = null; }
