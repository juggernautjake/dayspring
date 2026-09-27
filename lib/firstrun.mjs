// A brand-new install starts clean: the data folder and its subfolders exist, and every data file the modules read
// is either missing (each module has its own empty default) or valid JSON. Nothing personal is ever written here;
// the setup wizard (/setup) fills data/owner.json. Called once at server start.
//
// A damaged data file (cut short by a power loss, say) is set aside (kept, renamed) and, when there's a good copy, put
// back from the newest one: the daily snapshot (data/backups/daily, see atomic.mjs), an older "<name>.backup-*.json",
// or the copy taken before the last update (backups/data-*). Either way the owner is told once, on the screen
// (data/notices.json, sent to each page when it connects), never just in a log. A reset settings file never
// silently turns the wake-up alarm off: for someone already set up, the alarm stays on.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotsFor, writeJSONAtomic, writeTextAtomic } from "./atomic.mjs";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA = join(DESK, "data");
const BACKUPS = join(DESK, "backups");
const NOTICES = join(DATA, "notices.json");
const DIRS = ["", "devlog", "transcripts", "bibles"];
const README = `This folder is yours alone. Everything Dayspring knows about you lives here: your profile (owner.json), schedule
(store.json), people, notes, transcripts and settings. It is never uploaded, never included in updates, and never
shared. Back it up if you like; delete it to start over from the setup wizard.
`;
const LABEL = { store: "schedule", settings: "settings", reminders: "reminders", owner: "profile", people: "people list", special: "people and special days",
  goals: "goals", learning: "learning", morning: "morning routine", devotion: "devotion", recipes: "recipes", timers: "timers", snoozes: "snoozes",
  chores: "chores", notes: "notes", lists: "lists", permissions: "permissions", profile: "profile" };

const parses = (p) => { try { const t = readFileSync(p, "utf8").replace(/^﻿/, ""); if (!t.trim()) return false; JSON.parse(t); return true; } catch { return false; } };
const dayOf = (p) => /(\d{4}-\d{2}-\d{2})/.exec(p)?.[1] ?? new Date(statSync(p).mtimeMs).toLocaleDateString("en-CA");
function spoken(day) {
  const today = new Date().toLocaleDateString("en-CA"), y = new Date(Date.now() - 86400000).toLocaleDateString("en-CA");
  if (day === today) return "earlier today";
  if (day === y) return "yesterday";
  return new Date(day + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" });
}
// the newest good copy of data/<name>, or null
export function findBackup(name) {
  const stem = name.replace(/\.json$/, "");
  const cands = [...snapshotsFor(name)];
  try { for (const f of readdirSync(DATA)) if (f.startsWith(stem + ".backup-") && f.endsWith(".json")) cands.push(join(DATA, f)); } catch { /* none */ }
  try {
    for (const d of readdirSync(BACKUPS)) if (d.startsWith("data-")) { const p = join(BACKUPS, d, "data", name); if (existsSync(p)) cands.push(p); }
  } catch { /* none */ }
  const ranked = cands.map((p) => ({ p, t: (() => { try { return statSync(p).mtimeMs; } catch { return 0; } })() })).sort((a, b) => b.t - a.t);
  for (const { p } of ranked) if (parses(p)) return p;
  return null;
}
export function addNotice(text, kind = "data") {
  let list = [];
  try { list = JSON.parse(readFileSync(NOTICES, "utf8")); if (!Array.isArray(list)) list = []; } catch { list = []; }
  list.push({ id: `${Date.now()}-${list.length}`, kind, text, at: new Date().toISOString() });
  try { writeJSONAtomic(NOTICES, list.slice(-20), 2); } catch { /* can't even write a notice: the log still has it */ }
}
// what pages are told when they connect: notices from the last three days (each page shows each one once)
export function notices() {
  try { const list = JSON.parse(readFileSync(NOTICES, "utf8")); return (Array.isArray(list) ? list : []).filter((n) => Date.now() - Date.parse(n.at) < 3 * 86400000); } catch { return []; }
}

// Returns { created: [...], repaired: [...], restored: [...], fresh } — fresh = no owner profile yet (the wizard should open).
export function ensure() {
  const created = [], repaired = [], restored = [];
  for (const d of DIRS) {
    const p = join(DATA, d);
    if (!existsSync(p)) { mkdirSync(p, { recursive: true }); created.push(d || "data"); }
  }
  mkdirSync(BACKUPS, { recursive: true });
  const readme = join(DATA, "README.txt");
  if (!existsSync(readme)) { writeFileSync(readme, README); created.push("README.txt"); }
  const setUp = existsSync(join(DATA, "owner.json")) && parses(join(DATA, "owner.json"));
  // a damaged JSON file would stop its module from loading: set it aside (kept, renamed), then put back a good copy
  for (const f of readdirSync(DATA)) {
    if (!f.endsWith(".json") || f === "notices.json") continue;
    const p = join(DATA, f);
    let ok = true;
    try { const t = readFileSync(p, "utf8").replace(/^﻿/, ""); if (t.trim()) JSON.parse(t); } catch { ok = false; }
    if (ok) continue;
    const aside = p.replace(/\.json$/, `.damaged-${Date.now()}.json.txt`);
    try { renameSync(p, aside); repaired.push(f); } catch { continue; }
    const stem = f.replace(/\.json$/, ""), what = LABEL[stem] ?? stem.replace(/[-_]/g, " ");
    const good = findBackup(f);
    if (good) {
      try { writeTextAtomic(p, readFileSync(good, "utf8")); restored.push(f); addNotice(`Your ${what} file was damaged, so I restored the copy from ${spoken(dayOf(good))}. Anything changed since then may need adding again.`); continue; }
      catch { /* fall through to a fresh start */ }
    }
    if (stem === "settings" && setUp) {
      // someone already set up: a fresh settings file keeps the wake-up alarm on
      try { writeJSONAtomic(p, { alarm: true }, 2); } catch { /* the default then */ }
      addNotice("Your settings file was damaged and there was no backup, so settings started fresh. Your wake-up alarm is still on; check Settings for anything else you'd changed.");
    } else addNotice(`Your ${what} file was damaged and there was no backup, so it started fresh.`);
  }
  const fresh = !existsSync(join(DATA, "owner.json"));
  if (repaired.length) console.warn(`[firstrun] damaged data files: ${repaired.join(", ")}; restored from a backup: ${restored.join(", ") || "none"}`);
  return { created, repaired, restored, fresh };
}
