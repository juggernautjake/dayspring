// Changes that put themselves back: "make it rain for 10 minutes", "make it night for an hour", "go quiet until 3".
// Each override remembers only what it changed (so anything else changed meanwhile is left alone) and when to put it
// back. Kept in data/commands-temp.json, so one still ends on time after a restart (or ends at once if it's overdue).
//   add({ kind, what, restore, until }) · list() · cancel(kind) · start(appliers) · _tick(now)
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const FILE = () => process.env.DAYSPRING_COMMANDS_TEMP_FILE || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "commands-temp.json");
let items = null, timer = null;
// how each kind is put back: kind → async (restore) => void (set by lib/commands/index.mjs: the sky, listening…)
let appliers = {};
let clock = () => Date.now();
export function setClock(fn) { clock = fn ?? (() => Date.now()); }

function load() {
  if (items) return items;
  try { items = existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), "utf8")).items ?? [] : []; } catch { items = []; }
  return items;
}
function save() {
  try { mkdirSync(dirname(FILE()), { recursive: true }); writeFileSync(FILE() + ".tmp", JSON.stringify({ items }, null, 1)); renameSync(FILE() + ".tmp", FILE()); } catch { /* not fatal: it still ends on time while running */ }
}
// a newer override of the same kind replaces the older one's end time but keeps the ORIGINAL values to go back to
export function add({ kind, what, restore, until }) {
  load();
  const old = items.find((x) => x.kind === kind);
  const it = { id: randomUUID().slice(0, 8), kind, what, restore: old ? { ...restore, ...old.restore } : restore, until: new Date(until).toISOString() };
  items = items.filter((x) => x.kind !== kind);
  items.push(it); save(); arm();
  return it;
}
export const list = () => load().slice();
// the owner changed that thing himself: the override is forgotten (nothing is put back)
export function cancel(kind) { load(); const n = items.length; items = items.filter((x) => x.kind !== kind); if (items.length !== n) { save(); arm(); } }
export async function _tick(now = clock()) {
  load();
  const due = items.filter((x) => Date.parse(x.until) <= now);
  if (!due.length) return [];
  items = items.filter((x) => !due.includes(x)); save();
  for (const x of due) { try { await appliers[x.kind]?.(x.restore, x); } catch (e) { console.log(`commands: couldn't put back ${x.kind}: ${e.message}`); } }
  arm();
  return due;
}
function arm() {
  clearTimeout(timer); timer = null;
  if (!items?.length) return;
  const next = Math.min(...items.map((x) => Date.parse(x.until)));
  timer = setTimeout(() => { _tick().catch(() => {}); }, Math.max(200, Math.min(next - clock(), 2 ** 31 - 1)));
  timer.unref?.();
}
export function start(a = {}) { appliers = { ...appliers, ...a }; load(); _tick().catch(() => {}); arm(); }
export function _reset() { items = []; clearTimeout(timer); timer = null; }
