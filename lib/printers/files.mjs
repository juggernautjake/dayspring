// Finding a print file by the words the owner used ("the benchy"): the printer's queue, then the queue folders.
import { existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import * as store from "./store.mjs";
import { nameKey } from "../devices/model.mjs";

// a file by the words he used ("the benchy"): the queue, then the print folders, then what's on the printer
export async function findFile(p, words) {
  const k = nameKey(words).replace(/\b(file|print|model|one)\b/g, "").trim();
  if (!k) return null;
  const score = (name) => { const n = nameKey(basename(name).replace(/\.(gcode\.)?3mf$|\.gcode$/i, "").replace(/[_-]+/g, " ")); return n === k ? 3 : n.includes(k) ? 2 : k.split(" ").every((w) => n.includes(w)) ? 1 : 0; };
  const q = (p.queue?.items ?? []).map((x) => ({ file: x.file, s: score(x.name), item: x })).filter((x) => x.s).sort((a, b) => b.s - a.s)[0];
  if (q) return { file: q.file, item: q.item };
  const folders = [...new Set([p.queue?.folder, ...store.list().map((x) => x.queue?.folder)].filter((f) => f && existsSync(f)))];
  const local = folders.flatMap((f) => { try { return readdirSync(f).filter((n) => /\.(3mf|gcode|gco)$/i.test(n)).map((n) => join(f, n)); } catch { return []; } }).map((file) => ({ file, s: score(file) })).filter((x) => x.s).sort((a, b) => b.s - a.s)[0];
  if (local) return { file: local.file };
  return null;
}
