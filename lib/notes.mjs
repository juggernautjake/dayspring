// Lists and notes: "add milk to my shopping list", "what's on the grocery list", "take milk off the list",
// "take a note: call the plumber", "read my notes". Kept in data/lists.json. The to-do list is Dayspring's task list.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const FILE = () => process.env.DAYSPRING_LISTS_FILE || join(dirname(fileURLToPath(import.meta.url)), "..", "data", "lists.json");
let db = null;
function load() { if (db) return db; try { db = existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), "utf8")) : null; } catch { db = null; } db = { lists: { shopping: [] }, notes: [], ...(db ?? {}) }; return db; }
function save() { const f = FILE(); try { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f + ".tmp", JSON.stringify(db, null, 1)); renameSync(f + ".tmp", f); } catch { /* not fatal */ } }
export function _reset() { db = { lists: { shopping: [] }, notes: [] }; save(); }

// "grocery", "groceries", "shopping" → "shopping"; "packing list" → "packing"
export function listName(raw) {
  const r = String(raw ?? "").toLowerCase().replace(/\b(my|the|a|list|lists)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!r || /^(shopping|grocery|groceries|store)$/.test(r)) return "shopping";
  return r.slice(0, 30);
}
export function items(name) { return (load().lists[listName(name)] ?? []).map((x) => x.text); }
export function lists() { return Object.keys(load().lists); }
export function add(name, text) {
  const s = load(); const n = listName(name);
  const things = String(text).split(/\s*,\s*|\s+and\s+/).map((t) => t.trim().replace(/^(some|a|an|the)\s+/i, "")).filter(Boolean);
  s.lists[n] = s.lists[n] ?? [];
  const added = [];
  for (const t of things) if (!s.lists[n].some((x) => x.text.toLowerCase() === t.toLowerCase())) { s.lists[n].push({ id: randomUUID().slice(0, 8), text: t, at: new Date().toISOString() }); added.push(t); }
  save();
  return { list: n, added, all: s.lists[n].map((x) => x.text) };
}
export function removeItem(name, text) {
  const s = load(); const n = listName(name); const want = String(text).toLowerCase().replace(/^(the|some|a|an)\s+/, "").trim();
  const before = s.lists[n] ?? [];
  const hit = before.find((x) => x.text.toLowerCase() === want) ?? before.find((x) => x.text.toLowerCase().includes(want) || want.includes(x.text.toLowerCase()));
  if (!hit) return null;
  s.lists[n] = before.filter((x) => x !== hit); save();
  return { list: n, removed: hit.text };
}
export function clearList(name) { const s = load(); const n = listName(name); const had = (s.lists[n] ?? []).length; s.lists[n] = []; save(); return { list: n, cleared: had }; }
export function addNote(text) { const s = load(); const n = { id: randomUUID().slice(0, 8), text: String(text).trim(), at: new Date().toISOString() }; if (!n.text) return null; s.notes.push(n); save(); return n; }
export function notes(n = 10) { return load().notes.slice(-n).reverse(); }
export function removeNote(ref) { const s = load(); const r = String(ref ?? "").toLowerCase(); const hit = r === "last" || !r ? s.notes.at(-1) : s.notes.find((x) => x.text.toLowerCase().includes(r)); if (!hit) return null; s.notes = s.notes.filter((x) => x !== hit); save(); return hit; }
