// The owner's goals, which the assistant brings up now and then: at the morning alarm, before an
// evening study block, and when they ask. Edit by voice ("add a goal…") or in data/goals.json.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { writeJSONAtomic } from "./atomic.mjs";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "goals.json");
const SEED = [];   // a fresh install starts with no goals; the owner adds them by voice

let db = null;
function load() {
  if (db) return db;
  db = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { goals: SEED.map((g) => ({ id: randomUUID(), active: true, ...g })), lastReminded: {} };
  if (!existsSync(FILE)) save();
  return db;
}
function save() { writeJSONAtomic(FILE, db, 2); }

export function list(all = false) { return load().goals.filter((g) => all || g.active).map((g) => ({ ...g })); }
export function add({ text, why = "", due = null, area = "life" }) {
  if (!String(text ?? "").trim()) throw new Error("goal text is required");
  const g = { id: randomUUID(), active: true, text: text.trim(), why, due, area };
  load().goals.push(g); save();
  return g;
}
export function update(id, patch) {
  const g = load().goals.find((x) => x.id === id || x.id.startsWith(id));
  if (!g) throw new Error(`no goal ${id}`);
  for (const k of ["text", "why", "due", "area", "active"]) if (patch[k] !== undefined) g[k] = patch[k];
  save();
  return g;
}

// The goal to mention next: the one reminded longest ago (dated goals first while they're close).
export function pickToRemind() {
  const d = load();
  const goals = d.goals.filter((g) => g.active);
  if (!goals.length) return null;
  const score = (g) => (d.lastReminded[g.id] ?? "") + (g.due ? "0" : "1");
  const g = goals.slice().sort((a, b) => score(a).localeCompare(score(b)))[0];
  d.lastReminded[g.id] = new Date().toISOString(); save();
  return g;
}
