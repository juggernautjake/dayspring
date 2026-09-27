// Dayspring's own named video playlists ("my Worship playlist", "Morning hymns"), kept on this computer in
// data/video-playlists.json. Items are YouTube videos or YouTube playlists: { videoId, playlistId, title, channel }.
// (Saving into a YouTube account's playlists would mean driving youtube.com's Save menu, which isn't reliable, so these
// live in Dayspring.)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { writeJSONAtomic } from "./atomic.mjs";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const FILE = join(DATA, "video-playlists.json");
let db = null;
function load() { if (!db) { try { db = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { lists: [] }; } catch { db = { lists: [] }; } db.lists ??= []; } return db; }
function save() { mkdirSync(DATA, { recursive: true }); writeJSONAtomic(FILE, db, 2); }
const clean = (s, n = 80) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const item = (x) => ({ videoId: /^[A-Za-z0-9_-]{11}$/.test(x?.videoId ?? "") ? x.videoId : null, playlistId: /^[A-Za-z0-9_-]{10,}$/.test(x?.playlistId ?? "") ? x.playlistId : null, title: clean(x?.title, 200), channel: clean(x?.channel, 100) });

export const all = () => load().lists.map((l) => ({ ...l, items: l.items.map((i) => ({ ...i })) }));
// by id or by name (exact, then contains, then every word)
export function find(ref) {
  const L = load().lists, r = clean(ref).toLowerCase().replace(/\b(my|the|playlist|videos?|list)\b/g, " ").replace(/\s+/g, " ").trim();
  return L.find((l) => l.id === ref) ?? L.find((l) => l.name.toLowerCase() === r) ?? L.find((l) => r && l.name.toLowerCase().includes(r)) ??
    L.find((l) => r && r.split(" ").every((w) => l.name.toLowerCase().includes(w))) ?? null;
}
export function create(name) {
  const n = clean(name, 60);
  if (!n) throw new Error("Give the playlist a name.");
  const have = load().lists.find((l) => l.name.toLowerCase() === n.toLowerCase());
  if (have) return have;
  const l = { id: randomUUID().slice(0, 8), name: n, items: [], created: new Date().toISOString() };
  load().lists.push(l); save(); return l;
}
export function rename(ref, name) { const l = must(ref); l.name = clean(name, 60) || l.name; save(); return l; }
export function remove(ref) { const l = must(ref); db.lists = db.lists.filter((x) => x !== l); save(); return { removed: l.name }; }
export function add(ref, x, { createIfMissing = false } = {}) {
  const l = find(ref) ?? (createIfMissing ? create(ref) : must(ref));
  const it = item(x);
  if (!it.videoId && !it.playlistId) throw new Error("There's no video to add.");
  if (!l.items.some((i) => i.videoId === it.videoId && i.playlistId === it.playlistId)) { l.items.push(it); save(); }
  return l;
}
export function removeItem(ref, index) { const l = must(ref); l.items.splice(Number(index), 1); save(); return l; }
export function move(ref, from, to) { const l = must(ref); const [x] = l.items.splice(Number(from), 1); if (x) l.items.splice(Math.max(0, Math.min(l.items.length, Number(to))), 0, x); save(); return l; }
function must(ref) { const l = find(ref); if (!l) throw new Error(`There's no video playlist called "${ref}".${load().lists.length ? ` You have: ${load().lists.map((x) => x.name).join(", ")}.` : ""}`); return l; }
