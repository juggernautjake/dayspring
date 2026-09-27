// Snooze: the alarm, a reminder, "time for …", "time's up" — anything Dayspring alerts about can come back later.
//   "snooze" (the last alert, default minutes), "snooze for 15 minutes", "remind me again in 10 minutes",
//   "five more minutes" (the alarm), "cancel the snooze", "what's snoozed?"; the 💤 buttons on the alarm and pop-ups.
// Snoozes are saved (data/snoozes.json), so they still go off after Dayspring restarts. When one is due, the same alert
// comes back (the alarm rings again; a snoozed wake-up song comes back as the alarm).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import * as announcer from "./announcer.mjs";
import { writeJSONAtomic } from "./atomic.mjs";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "snoozes.json");
const SNOOZABLE = new Set(["alarm", "morning", "reminder", "start", "checkin", "buffer", "ready", "rundown"]);
export const DEFAULT_ALARM = 9, DEFAULT = 10;
let list = null, timer = null;
const load = () => (list ??= existsSync(FILE) ? (() => { try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return []; } })() : []);
const save = () => { try { writeJSONAtomic(FILE, load(), 2); } catch { /* not critical */ } };
const hm12 = (d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const isAlarm = (item) => Boolean(item?.alarm) || item?.kind === "morning";
const titleOf = (item) => (isAlarm(item) ? "the alarm" : item?.kind === "reminder" ? `the reminder${item.reminder?.text ? ` to ${item.reminder.text}` : ""}` : item?.started?.title ? item.started.title : item?.ended?.title ? `${item.ended.title} wrap-up` : "that");

// The alert a bare "snooze" means: the most recent snoozable one from the last hour.
export function lastAlert() {
  const cutoff = Date.now() - 60 * 60_000;
  return [...announcer.recent()].reverse().find((i) => SNOOZABLE.has(i.alarm ? "alarm" : i.kind) && Date.parse(i.at ?? 0) >= cutoff && !i.snoozedAgain) ?? null;
}
export function list_() { return load().map((s) => ({ id: s.id, until: s.until, what: s.what })); }
export { list_ as list };

export function snooze(item = lastAlert(), minutes) {
  if (!item) return { ok: false, text: "There's nothing to snooze right now." };
  const m = Math.max(1, Math.min(240, Math.round(Number(minutes) || (isAlarm(item) ? DEFAULT_ALARM : DEFAULT))));
  const until = Date.now() + m * 60_000;
  // a wake-up song comes back as the alarm (its music and greeting already happened)
  const again = isAlarm(item) ? { kind: "alarm", alarm: true, hm: item.hm, date: item.date, text: item.alarmText ?? item.greeting ?? item.text ?? "Time to get up.", mode: item.mode }
    : { ...item };
  // the screen and the desktop card send a copy of the alert: find the original, so a later bare "snooze" doesn't
  // snooze the same alert a second time (which brought the alarm back twice)
  const orig = item.at ? announcer.recent().find((i) => i.at === item.at && (i.kind ?? null) === (item.kind ?? null)) : null;
  const already = item.at ? load().find((x) => x.from === item.at) : null;
  if (already) { already.until = until; save(); announcer.broadcast("snooze", { list: list_() }); return { ok: true, id: already.id, minutes: m, until, text: `Snoozed ${already.what} for ${m} minute${m === 1 ? "" : "s"}, until ${hm12(new Date(until))}.` }; }
  const s = { id: randomUUID(), until, what: titleOf(item), item: again, from: item.at ?? null };
  item.snoozedAgain = true;
  if (orig) orig.snoozedAgain = true;
  load().push(s); save(); start();
  announcer.broadcast("snooze", { list: list_() });
  return { ok: true, id: s.id, minutes: m, until, text: `Snoozed ${s.what} for ${m} minute${m === 1 ? "" : "s"}, until ${hm12(new Date(until))}.` };
}
export function cancel(id) {
  const l = load(), i = id ? l.findIndex((s) => s.id === id) : l.length - 1;
  if (i < 0) return { ok: false, text: "Nothing is snoozed." };
  const [s] = l.splice(i, 1); save();
  announcer.broadcast("snooze", { list: list_() });
  return { ok: true, text: `Okay, ${s.what} won't come back.` };
}
function tick() {
  const now = Date.now(), l = load(), due = l.filter((s) => s.until <= now);
  if (!due.length) return;
  list = l.filter((s) => s.until > now); save();
  for (const s of due) {
    const item = { ...s.item, at: new Date().toISOString(), snoozed: true };
    delete item.hm; delete item.date;                  // it's now, not when it first went off
    if (!isAlarm(item) && !/^(snoozed|back again)/i.test(item.text ?? "")) item.text = `Back again: ${item.text}`;
    announcer.announce(item);
  }
  announcer.broadcast("snooze", { list: list_() });
}
export function start() { if (!timer) timer = setInterval(tick, 10_000); tick(); }

// Voice and typing (no AI needed).
const NUM = { one: 1, two: 2, three: 3, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, "forty five": 45, sixty: 60 };
export function handle(text) {
  const q = String(text).toLowerCase().replace(/[.!?,]/g, " ").replace(/\s+/g, " ").trim();
  const mins = () => { const m = /(\d{1,3}|one|two|three|five|ten|fifteen|twenty|thirty|forty five|sixty) (more )?(minutes?|mins?)|an? (hour)|half an hour/.exec(q); return !m ? undefined : m[4] ? 60 : /half an hour/.test(m[0]) ? 30 : Number(NUM[m[1]] ?? m[1]); };
  if (/^(what'?s|what is|anything) snoozed|^(show|list) (my )?snoozes?/.test(q)) {
    const l = list_(); return l.length ? `Snoozed: ${l.map((s) => `${s.what} until ${hm12(new Date(s.until))}`).join("; ")}.` : "Nothing is snoozed.";
  }
  if (/^(cancel|stop|clear|forget) (the |my |that )?snooze/.test(q) || /^(don'?t|do not) (remind|bring) (me )?(it |that )?(again|back)/.test(q)) return cancel().text;
  if (/^(snooze|hit snooze|press snooze)\b/.test(q) || /^(remind|ask|tell|ping) me (again|later)\b/.test(q) || /^(remind|ask) me (again )?in \d+|^(remind|ask) me again in/.test(q) && !/\bto\b/.test(q) || /^(give me )?(five|ten|\d+|a few) more minutes$/.test(q)) {
    const it = lastAlert();
    // already snoozed it: "remind me again in 20 minutes" moves that snooze
    if (!it && load().length && mins()) {
      const s = load().at(-1), m = mins(); s.until = Date.now() + m * 60_000; save();
      announcer.broadcast("snooze", { list: list_() });
      return `Okay, ${s.what} comes back in ${m} minute${m === 1 ? "" : "s"}, at ${hm12(new Date(s.until))}.`;
    }
    if (!it) return /^(snooze|hit snooze|press snooze)\b/.test(q) ? "There's nothing to snooze right now." : null;
    return snooze(it, mins() ?? (/a few/.test(q) ? 5 : undefined)).text;
  }
  return null;
}
