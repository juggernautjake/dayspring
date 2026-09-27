// Optional: put Dayspring's schedule on Google Calendar and/or Outlook, so it shows on the owner's phone. One direction
// only (Dayspring → that calendar), off until the owner turns it on for an account, the next two weeks at a time.
// Every copy is remembered (data/calsync.json: which Dayspring item became which event), so nothing is ever copied twice;
// a changed item updates its copy, a removed item removes it, and turning sync off removes every copy it made.
// Copies are tagged (Google: a private property; Outlook: the "Dayspring" category) and have no reminders of their own,
// and the unified schedule leaves them out, so they never show twice or clash with the original.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "./store.mjs";
import * as google from "./connectors/google.mjs";
import * as microsoft from "./connectors/microsoft.mjs";
import { writeJSONAtomic } from "./atomic.mjs";

const DIR = process.env.DAYSPRING_CALDATA_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const FILE = () => join(DIR, "calsync.json");
// Google: the copies go on one account's calendar (the one chosen when sync was turned on; the primary one by default),
// so changing the primary account later never strands or duplicates them
const googleFor = () => { const d = load(); const id = d.accounts.google?.account; return id && google.accounts().some((a) => a.id === id) ? google.forAccount(id) : google.forAccount(google.defaultAccount("calendar")?.id ?? null); };
const ACCOUNTS = { get google() { return googleFor(); }, microsoft };
const DAYS = 14, MAX_WRITES = 80;
const load = () => { try { const d = existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), "utf8")) : {}; return { accounts: {}, map: {}, ...d }; } catch { return { accounts: {}, map: {} }; } };
const save = (d) => { mkdirSync(DIR, { recursive: true }); writeJSONAtomic(FILE(), d, 2); };
const keyOf = (b) => (b.routineId ? `r:${b.routineId}:${b.date}` : b.id);
const isFiller = (b) => /free time|your time|open afternoon|open evening|game time|\bbuffer\b/i.test(b.title ?? "");
const hash = (b) => `${b.date}|${b.start}|${b.end}|${b.title}`;

export function status() {
  const d = load(), out = {};
  for (const [name, mod] of Object.entries(ACCOUNTS)) { const a = d.accounts[name] ?? {}; out[name] = { on: Boolean(a.on), connected: mod.connected(), at: a.at ?? null, error: a.error ?? null, count: Object.keys(d.map[name] ?? {}).length }; }
  return out;
}
// Ids of the events this module made (so the unified schedule can leave them out)
export function ownIds() { const d = load(), s = new Set(); for (const m of Object.values(d.map)) for (const v of Object.values(m ?? {})) s.add(v.id); return s; }

let running = null;
export async function setEnabled(account, on) {
  if (!ACCOUNTS[account]) throw new Error("Sync works with google or microsoft (Outlook).");
  if (on && !ACCOUNTS[account].connected()) throw new Error(`${account === "google" ? "Google Calendar" : "Outlook"} isn't connected yet. Connect it in Settings → Apps first.`);
  const d = load(); d.accounts[account] = { ...(d.accounts[account] ?? {}), on: Boolean(on), ...(account === "google" && on && !d.accounts.google?.account ? { account: google.defaultAccount("calendar")?.id ?? null } : {}) }; save(d);
  return on ? sync(account) : cleanup(account);
}
// Remove every copy made on that account (sync turned off, or the owner asked)
export async function cleanup(account) {
  await running;
  const d = load(), map = d.map[account] ?? {}, mod = ACCOUNTS[account];
  let removed = 0, failed = 0;
  for (const [k, v] of Object.entries(map)) {
    try { await mod.deleteEvent({ id: v.id }); removed++; delete map[k]; }
    catch (e) { if (e.status === 404 || e.status === 410) { delete map[k]; } else failed++; }
  }
  d.map[account] = map; d.accounts[account] = { ...(d.accounts[account] ?? {}), on: false, at: Date.now(), error: failed ? `${failed} copies couldn't be removed yet; they'll be retried.` : null };
  save(d);
  return { account, on: false, removed, failed };
}
// Bring the copies up to date for the enabled accounts (or one). Safe to run often; it only writes what changed.
export async function sync(only = null) {
  if (running) return running;
  running = (async () => {
    const d = load(), results = {};
    const today = store.todayISO(), to = store.addDays(today, DAYS - 1);
    const plan = store.planBetween(today, to).filter((b) => !isFiller(b));
    const want = new Map(plan.map((b) => [keyOf(b), b]));
    for (const [name, mod] of Object.entries(ACCOUNTS)) {
      if (only && name !== only) continue;
      const map = (d.map[name] ??= {});
      if (!d.accounts[name]?.on) { if (Object.keys(map).length) results[name] = await cleanupInline(name, mod, map); continue; }
      if (!mod.connected()) { d.accounts[name].error = "Not connected"; continue; }
      let writes = 0, added = 0, updated = 0, removed = 0, error = null;
      try {
        for (const [k, b] of want) {
          if (writes >= MAX_WRITES) break;
          const have = map[k], h = hash(b);
          if (have?.hash === h) continue;
          writes++;
          if (have) {
            try { await mod.updateEvent({ id: have.id, title: b.title, date: b.date, start: b.start, end: b.end }); map[k] = { ...have, hash: h, date: b.date }; updated++; continue; }
            catch (e) { if (e.status !== 404 && e.status !== 410) throw e; delete map[k]; }   // deleted over there: make it again
          }
          const r = await mod.addEvent({ title: b.title, date: b.date, start: b.start, end: b.end, notes: `${b.description ? b.description + "\n\n" : ""}From Dayspring. Edit it in Dayspring; changes here are replaced.`, tag: k });
          map[k] = { id: r.id, hash: h, date: b.date }; added++;
        }
        // gone from Dayspring (or moved out of the window into the past): remove the copy; past ones are just forgotten
        for (const [k, v] of Object.entries(map)) {
          if (want.has(k)) continue;
          if ((v.date ?? today) < today) { delete map[k]; continue; }
          if (writes >= MAX_WRITES) break;
          writes++;
          try { await mod.deleteEvent({ id: v.id }); } catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
          delete map[k]; removed++;
        }
      } catch (e) { error = e.message; }
      d.accounts[name] = { ...d.accounts[name], at: Date.now(), error };
      results[name] = { added, updated, removed, error };
    }
    save(d);
    return results;
  })();
  try { return await running; } finally { running = null; }
}
async function cleanupInline(name, mod, map) {
  let removed = 0;
  for (const [k, v] of Object.entries(map)) { try { await mod.deleteEvent({ id: v.id }); removed++; delete map[k]; } catch (e) { if (e.status === 404 || e.status === 410) delete map[k]; } }
  return { removed };
}
// Every 15 minutes while any account has sync on (the server calls this once at start)
let timer = null;
export function startBackground() {
  if (timer) return;
  timer = setInterval(() => { if (Object.values(load().accounts).some((a) => a?.on)) sync().catch(() => {}); }, 15 * 60_000);
  timer.unref?.();
}
