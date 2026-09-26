// A brand-new install starts clean: the data folder and its subfolders exist, and every data file the modules read
// is either missing (each module has its own empty default) or valid JSON. Nothing personal is ever written here;
// the setup wizard (/setup) fills data/owner.json. Called once at server start.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA = join(DESK, "data");
const DIRS = ["", "devlog", "transcripts", "bibles"];
const README = `This folder is yours alone. Everything Dayspring knows about you lives here: your profile (owner.json), schedule
(store.json), people, notes, transcripts and settings. It is never uploaded, never included in updates, and never
shared. Back it up if you like; delete it to start over from the setup wizard.
`;

// Returns { created: [...], repaired: [...], fresh } — fresh = no owner profile yet (the wizard should open).
export function ensure() {
  const created = [], repaired = [];
  for (const d of DIRS) {
    const p = join(DATA, d);
    if (!existsSync(p)) { mkdirSync(p, { recursive: true }); created.push(d || "data"); }
  }
  mkdirSync(join(DESK, "backups"), { recursive: true });
  const readme = join(DATA, "README.txt");
  if (!existsSync(readme)) { writeFileSync(readme, README); created.push("README.txt"); }
  // a damaged JSON file would stop its module from loading: set it aside (kept, renamed) so the module starts from its default
  for (const f of readdirSync(DATA)) {
    if (!f.endsWith(".json")) continue;
    const p = join(DATA, f);
    try { const t = readFileSync(p, "utf8").replace(/^﻿/, ""); if (t.trim()) JSON.parse(t); }
    catch {
      const aside = p.replace(/\.json$/, `.damaged-${Date.now()}.json.txt`);
      try { renameSync(p, aside); repaired.push(f); } catch { /* leave it */ }
    }
  }
  const fresh = !existsSync(join(DATA, "owner.json"));
  if (repaired.length) console.warn(`[firstrun] set aside unreadable data files: ${repaired.join(", ")}`);
  return { created, repaired, fresh };
}
