// What was seen in a picture (its description and the text in it, from lib/vision/describe.mjs) the last time the viewer
// described it, so "find the picture with the wifi password" or "the photo of the lake" finds it later. Only what the
// owner asked to have described is kept (a line of words per picture, never the picture). data/file-captions.json;
// DAYSPRING_FILECAPTIONS_FILE moves it (tests).
//   get(id) · set(id, { description, ocr }) · textOf(id) (the words for searching) · forget(id)
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJSONAtomic } from "../atomic.mjs";

const FILE = () => process.env.DAYSPRING_FILECAPTIONS_FILE || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "file-captions.json");
const MAX = 5000;
let db = null;
function load() {
  if (db && db.file === FILE()) return db;
  let raw = {}; try { raw = existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), "utf8")) : {}; } catch { raw = {}; }
  db = { file: FILE(), items: raw.items && typeof raw.items === "object" ? raw.items : {} };
  return db;
}
export const get = (id) => load().items[String(id)] ?? null;
export const textOf = (id) => { const c = get(id); return c ? `${c.description ?? ""} ${c.ocr ?? ""}`.trim() : ""; };
export function set(id, { description = "", ocr = "", usedAI = false } = {}) {
  const d = load();
  d.items[String(id)] = { description: String(description).slice(0, 1500), ocr: String(ocr).slice(0, 3000), usedAI: Boolean(usedAI), at: new Date().toISOString() };
  const keys = Object.keys(d.items);
  if (keys.length > MAX) for (const k of keys.sort((a, b) => String(d.items[a].at).localeCompare(String(d.items[b].at))).slice(0, keys.length - MAX)) delete d.items[k];
  try { writeJSONAtomic(d.file, { v: 1, items: d.items }, 0); } catch { /* kept in memory */ }
  return d.items[String(id)];
}
export function forget(id) { const d = load(); if (d.items[String(id)]) { delete d.items[String(id)]; try { writeJSONAtomic(d.file, { v: 1, items: d.items }, 0); } catch { /* fine */ } } }
export function _reset() { db = null; }
