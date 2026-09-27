// Micro-habits: 5-10 minute tasks done consistently in the small windows of a day. Household chores
// (dishes and a kitchen reset every day; laundry in short steps; folding every other day) and growth habits
// (Spanish, scripture memory, an instrument). Dayspring slips one in at a transition or a gap in the schedule
// that fits it — a few times a day, never into study or work, never the same one twice in a row.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import * as reminders from "./reminders.mjs";
import * as owner from "./owner.mjs";
import { writeJSONAtomic } from "./atomic.mjs";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "chores.json");
// [slug, text, minutes, every N days, kind, when]  when: "am" | "pm" | "any"
const SEED = [
  ["kitchen", "Wash the dishes and reset the kitchen", 10, 1, "chore", "any"],
  ["bed", "Make the bed", 3, 1, "chore", "am"],
  ["tidy", "Five-minute tidy of your room", 5, 1, "chore", "any"],
  ["washer", "Put a load of laundry in the washer", 5, 3, "chore", "any"],
  ["dryer", "Move the laundry to the dryer", 5, 0, "chore", "any"],      // due after the washer, handled below
  ["fold", "Fold and put away some laundry", 10, 2, "chore", "any"],
  ["trash", "Take out the trash", 5, 3, "chore", "pm"],
  ["bathroom", "Wipe down the bathroom sink and mirror", 5, 4, "chore", "any"],
  ["vacuum", "Quick vacuum", 10, 5, "chore", "any"],
  // habits (practice something daily) are the owner's own: added by voice ("add a habit: guitar practice, 10 minutes a day")
  ["scripture", "Scripture memory review", 5, 1, "habit", "any"],   // only when Scripture memory is on
];
export const MAX_PER_DAY = 6;
const GAP_MINUTES = 60;              // at least this long between suggestions
const WASH_MINUTES = 45;             // a wash cycle, before the dryer step is due

let db = null;
function load() {
  if (db) return db;
  db = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8"))
    : { chores: SEED.filter(([slug]) => slug !== "scripture" || owner.feature("memoryVerses")).map(([slug, text, minutes, everyDays, kind, when]) => ({ id: randomUUID(), slug, text, minutes, everyDays, kind, when, lastDone: null, lastSuggested: null, active: true })), suggestedOn: {} };
  if (!existsSync(FILE)) save();
  return db;
}
function save() { writeJSONAtomic(FILE, db, 2); }

const daysSince = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 86_400_000 : 99);
const minsSince = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 60_000 : 1e9);
const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function isDue(c, all) {
  if (c.slug === "dryer") {
    // due once the washer has run long enough, and only once per load
    const w = all.find((x) => x.slug === "washer");
    return Boolean(w?.lastDone && minsSince(w.lastDone) >= WASH_MINUTES && (!c.lastDone || Date.parse(c.lastDone) < Date.parse(w.lastDone)));
  }
  return daysSince(c.lastDone) >= c.everyDays - 0.1;     // a little slack so "every day" means every day
}

export function list() {
  const all = load().chores;
  return all.filter((c) => c.active).map((c) => ({ ...c, due: isDue(c, all) }));
}

// The micro-task to suggest now, if any: due, fits in `maxMinutes`, right for the time of day, not just suggested.
export function pick(maxMinutes, now = new Date(), { kind = null, extra = null } = {}) {
  const d = load();
  const today = localDate(now);
  const todays = d.suggestedOn[today] ?? [];
  if (todays.length >= MAX_PER_DAY) return null;
  const last = todays[todays.length - 1];
  if (last && (now - Date.parse(last)) / 60000 < GAP_MINUTES) return null;
  const hour = now.getHours();
  const cands = list().filter((c) => c.due && c.minutes <= maxMinutes && minsSince(c.lastSuggested) > 180 && (!kind || c.kind === kind))
    .filter((c) => c.when === "any" || (c.when === "am" ? hour < 12 : hour >= 12));
  if (!cands.length) return null;
  // the laundry step that's waiting beats everything; then whatever is most overdue; habits and chores take turns
  const lastKind = d.chores.find((c) => c.lastSuggested && c.lastSuggested === d.chores.map((x) => x.lastSuggested).filter(Boolean).sort().pop())?.kind;
  const score = (c) => (c.slug === "dryer" ? 100 : 0) + (c.everyDays ? daysSince(c.lastDone) / c.everyDays : 1) + (c.kind !== lastKind ? 0.5 : 0);
  const c = cands.sort((a, b) => score(b) - score(a))[0];
  const real = d.chores.find((x) => x.id === c.id);
  real.lastSuggested = now.toISOString();
  d.suggestedOn = { [today]: [...todays, now.toISOString()] };
  save();
  return { id: c.id, slug: c.slug, text: c.text, minutes: c.minutes, kind: c.kind, extra: c.slug === "scripture" ? extra : null };
}

export function markDone(match) {
  const all = load().chores;
  const q = String(match ?? "").toLowerCase();
  const words = q.replace(/\b(the|my|a|some|with|done|finished|did|i|just)\b/g, " ").split(/\s+/).filter((w) => w.length > 2);
  // "laundry" alone means whichever laundry step is next
  let c = all.find((x) => x.id === match);
  if (!c && /laundry|washer|dryer|wash/.test(q) && !/fold/.test(q)) c = all.find((x) => x.slug === (/dryer/.test(q) ? "dryer" : isDue(all.find((y) => y.slug === "dryer"), all) ? "dryer" : "washer"));
  if (!c && /dishes|kitchen/.test(q)) c = all.find((x) => x.slug === "kitchen");
  if (!c && /spanish/.test(q)) c = all.find((x) => x.slug === "spanish");
  if (!c && /scripture|verse|memory|memoriz/.test(q)) c = all.find((x) => x.slug === "scripture");
  if (!c && /guitar|piano|instrument|practice|music/.test(q)) c = all.find((x) => x.slug === "instrument");
  if (!c) c = all.find((x) => words.length && words.every((w) => x.text.toLowerCase().includes(w))) ?? all.find((x) => words.some((w) => x.text.toLowerCase().includes(w)));
  if (!c) throw new Error(`no chore or habit matches "${match}"`);
  c.lastDone = new Date().toISOString(); save();
  if (c.slug === "washer") {
    // a real reminder, spoken like any other, when the wash should be done
    const at = new Date(Date.now() + WASH_MINUTES * 60_000);
    reminders.add({ date: localDate(at), time: `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`, text: "Move the laundry to the dryer",
      spoken: `Hey ${owner.name()}, the wash should be done. Quick one: move the laundry over to the dryer. About five minutes.` });
  }
  const next = c.slug === "washer" ? `I'll remind you to move it to the dryer in about ${WASH_MINUTES} minutes.` : c.everyDays ? `Next one's due in ${c.everyDays} day${c.everyDays > 1 ? "s" : ""}.` : "";
  return { done: c.text, kind: c.kind, next };
}

export function set({ id, text, minutes, every_days, active, kind }) {
  const d = load();
  let c = id ? d.chores.find((x) => x.id === id || x.id.startsWith(id)) : d.chores.find((x) => x.text.toLowerCase() === String(text ?? "").toLowerCase());
  if (!c) {
    if (!text) throw new Error("a new chore or habit needs text");
    c = { id: randomUUID(), slug: null, text, minutes: minutes ?? 10, everyDays: every_days ?? 1, kind: kind ?? "chore", when: "any", lastDone: null, lastSuggested: null, active: true };
    d.chores.push(c);
  } else {
    if (text) c.text = text; if (minutes) c.minutes = minutes; if (every_days !== undefined) c.everyDays = every_days; if (active !== undefined) c.active = active; if (kind) c.kind = kind;
  }
  save();
  return c;
}
