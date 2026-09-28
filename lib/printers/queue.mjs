// "Program prints": a queue per printer, filled by hand or from a folder of .3mf / .gcode files, started one after
// another when the bed is clear.
//   add(id, { file, plate, amsMapping, options }) · remove(id, itemId) · list(id) · setFolder(id, folder) · scanFolder(id)
//   next(id) → starts the next one: a fresh bed check, then the owner's yes (or, with auto-start on, straight away)
//   afterPrint(id) → called when a print ends: if something's queued, look at the bed and ask / start
// Slicing (optional): an .stl is sliced with Bambu Studio or OrcaSlicer's command line when one is installed (./slicer.mjs).
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, basename, extname } from "node:path";
import * as store from "./store.mjs";

let printers = null;
const P = async () => (printers ??= await import("./index.mjs"));
const PRINTABLE = /\.(3mf|gcode|gco)$/i;
const id36 = () => Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);

export function list(id) { return store.get(id)?.queue?.items ?? []; }
export function add(id, { file, plate = 1, amsMapping = null, options = {}, name } = {}) {
  const p = store.get(id); if (!p) throw new Error("No such printer.");
  if (!file) throw new Error("Which file?");
  const onPrinter = String(file).startsWith("printer:");
  if (!onPrinter && !existsSync(file)) throw new Error(`I can't find ${basename(String(file))}.`);
  if (!onPrinter && !PRINTABLE.test(file) && !/\.stl$/i.test(file)) throw new Error("Only sliced files can be queued: .3mf or .gcode (or an .stl when a slicer is installed).");
  const item = { id: id36(), file: String(file), name: name ?? basename(String(file)).replace(/^printer:/, ""), plate: Math.max(1, Number(plate) || 1), amsMapping: Array.isArray(amsMapping) ? amsMapping.map(Number) : null, options: options ?? {}, added: new Date().toISOString() };
  p.queue.items.push(item); store.save();
  return item;
}
export function remove(id, itemId) { const p = store.get(id); if (!p) return false; const n = p.queue.items.length; p.queue.items = p.queue.items.filter((x) => x.id !== itemId); store.save(); return n !== p.queue.items.length; }
export function move(id, itemId, dir) { const p = store.get(id); const a = p?.queue.items ?? []; const i = a.findIndex((x) => x.id === itemId); const j = i + (dir === "up" ? -1 : 1); if (i < 0 || j < 0 || j >= a.length) return false; [a[i], a[j]] = [a[j], a[i]]; store.save(); return true; }
export function setFolder(id, folder) { const p = store.get(id); if (!p) throw new Error("No such printer."); if (folder && !existsSync(folder)) throw new Error("That folder isn't there."); p.queue.folder = folder ?? ""; store.save(); return scanFolder(id); }
// files in the folder not queued or printed yet, oldest first
export function scanFolder(id) {
  const p = store.get(id); if (!p?.queue?.folder) return [];
  const done = new Set(p.queue.done ?? []), queued = new Set(p.queue.items.map((x) => x.file.toLowerCase()));
  let files = []; try { files = readdirSync(p.queue.folder).filter((f) => PRINTABLE.test(f)).map((f) => join(p.queue.folder, f)); } catch { return []; }
  const added = [];
  for (const f of files.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)) if (!done.has(f.toLowerCase()) && !queued.has(f.toLowerCase())) added.push(add(id, { file: f }));
  return added;
}
export async function next(id, o = {}) {
  const p = store.get(id); if (!p) return { ok: false, text: "No such printer." };
  scanFolder(id);
  const item = p.queue.items[0];
  if (!item) return { ok: false, empty: true, text: `Nothing is queued for ${p.name}.` };
  let file = item.file;
  if (/\.stl$/i.test(file)) {
    const sl = await import("./slicer.mjs");
    try { file = await sl.slice(file, { profile: item.options?.profile }); } catch (e) { return { ok: false, text: `I couldn't slice ${item.name}: ${e.message}` }; }
  }
  const pr = await P();
  const r = await pr.startPrint(id, { file, plate: item.plate, amsMapping: item.amsMapping, options: item.options, queueItem: item.id, ...o });
  return { ...r, item };
}
// a print ended: start (or offer) the next one when the bed is clear
const waiting = new Map();
export async function afterPrint(id, { delayMs = 90_000 } = {}) {
  const p = store.get(id); if (!p) return;
  scanFolder(id);
  if (!p.queue.items.length) return;
  clearTimeout(waiting.get(id));
  // give the bed a moment to cool and the owner a moment to take the part off; then look every 5 minutes for an hour
  let tries = 0;
  const look = async () => {
    const pr = await P();
    const r = await next(id, { auto: true }).catch((e) => ({ ok: false, text: e.message }));
    if (r.ok || r.needsConfirm) { waiting.delete(id); announce(pr, p, r); return; }
    if (r.bedNotClear && ++tries < 12) { if (tries === 1) announce(pr, p, { text: `${p.name} is ready for the next print (${p.queue.items[0]?.name}), once the bed is cleared.` }); waiting.set(id, setTimeout(look, 5 * 60_000)); return; }
    waiting.delete(id);
  };
  waiting.set(id, setTimeout(look, delayMs));
}
function announce(pr, p, r) { try { pr._announce?.({ kind: "printer", text: r.text, printer: p.id, ask: Boolean(r.needsConfirm), image: r.image ?? null }); } catch { /* fine */ } }
export function _reset() { for (const t of waiting.values()) clearTimeout(t); waiting.clear(); }
export const isPrintable = (f) => PRINTABLE.test(f) || extname(f).toLowerCase() === ".stl";
