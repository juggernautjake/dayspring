// Crash-safe saving. A power cut or crash in the middle of a plain writeFileSync leaves a half-written (truncated)
// file, and a truncated settings.json used to come back as the defaults (alarm off) with no word said. Here the new
// content goes to a temporary file first and is then renamed over the old one, so the file on disk is always either
// the old version or the new one, never half of each.
//
// The files that matter most also get a daily snapshot (data/backups/daily/<name>-YYYY-MM-DD.json, the last 7 kept),
// taken from the old content before the first change of the day. firstrun.mjs restores from these when a file is damaged.
//
//   writeJSONAtomic(file, value, space = 2) · writeTextAtomic(file, text) · snapshotsFor(name)
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, writeSync, copyFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
export const DAILY = join(DATA, "backups", "daily");
const KEEP_DAYS = 7;
// the data files whose loss would hurt (a schedule, alarms, reminders, who people are…)
const IMPORTANT = /^(store|settings|reminders|special|people|goals|learning|morning|devotion|recipes|timers|snoozes|chores|profile|permissions|lists|notes|church|memorize|jokes-told)\.json$/;

const pause = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* no wait available */ } };
const today = () => new Date().toLocaleDateString("en-CA");

function snapshot(file) {
  const name = basename(file);
  if (!IMPORTANT.test(name) || !existsSync(file)) return;
  // only files in Dayspring's own data folder (tests point modules at temp folders; those don't get snapshots)
  if (dirname(file).toLowerCase() !== DATA.toLowerCase()) return;
  const stem = name.replace(/\.json$/, "");
  const dest = join(DAILY, `${stem}-${today()}.json`);
  if (existsSync(dest)) return;
  try {
    mkdirSync(DAILY, { recursive: true });
    copyFileSync(file, dest);
    const mine = readdirSync(DAILY).filter((f) => f.startsWith(stem + "-") && /-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    for (const old of mine.slice(0, Math.max(0, mine.length - KEEP_DAYS))) rmSync(join(DAILY, old), { force: true });
  } catch { /* a snapshot is a nice-to-have */ }
}

export function writeTextAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  snapshot(file);
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = openSync(tmp, "w");
  try { writeSync(fd, String(text)); try { fsyncSync(fd); } catch { /* some drives can't */ } } finally { closeSync(fd); }
  // Windows: renaming over a file an antivirus or indexer is reading can fail for a moment
  for (let i = 0; ; i++) {
    try { renameSync(tmp, file); return; }
    catch (e) { if (i >= 5 || !/EPERM|EACCES|EBUSY/.test(e.code ?? "")) { try { rmSync(tmp, { force: true }); } catch { /* gone */ } throw e; } pause(40 * (i + 1)); }
  }
}
export const writeJSONAtomic = (file, value, space = 2) => writeTextAtomic(file, JSON.stringify(value, null, space));

// newest first: this file's daily snapshots
export function snapshotsFor(name) {
  const stem = name.replace(/\.json$/, "");
  if (!existsSync(DAILY)) return [];
  return readdirSync(DAILY).filter((f) => f.startsWith(stem + "-") && /-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse().map((f) => join(DAILY, f));
}
