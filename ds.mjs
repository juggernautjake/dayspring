#!/usr/bin/env node
// ds — command-line view of the Dayspring schedule. Works with or without the server running;
// both read and write the same data/store.json. Made to be easy for a person or Claude Code to read.
//
//   node ds.mjs                      today
//   node ds.mjs today | tomorrow | day 2026-09-14 | week [date] | range FROM TO | year
//   node ds.mjs add "Title" DATE START END [CATEGORY] [--desc "..."] [--flex] [--push]
//   node ds.mjs move REF [--date D] [--start HH:MM] [--end HH:MM] [--to HH:MM] [--push]
//   node ds.mjs edit REF [--title T] [--cat C] [--desc D] [--flex | --no-flex]
//   node ds.mjs done REF | undone REF | rm REF | push REF
//   node ds.mjs free DATE MINUTES [--earliest HH:MM] [--latest HH:MM]
//   node ds.mjs stamp [DATE]           stamp routines onto a day (default today)
//   node ds.mjs routines | routine-add "Title" START END CATEGORY DAYS(mon,wed,fri|daily|weekdays) [--desc ...]
//   node ds.mjs tasks | task-add "Title" [--cat C] [--due DATE] | task-done REF | task-rm REF
//   node ds.mjs memories | remember "text" | forget REF
//   node ds.mjs log [DAYS]             activity log for the last N days (default 1)
//   node ds.mjs json CMD ...           same as any read command, but raw JSON
//
// REF = full id, id prefix, or a piece of the title. DATE = YYYY-MM-DD or today/tomorrow/mon..sun.
// Add --date DATE to done/rm/push/move/edit to disambiguate a title that repeats across days.

import { parseArgs } from "node:util";
import * as s from "./lib/store.mjs";

const { values: o, positionals: argv } = parseArgs({
  allowPositionals: true,
  options: {
    date: { type: "string" }, start: { type: "string" }, end: { type: "string" }, to: { type: "string" },
    title: { type: "string" }, cat: { type: "string" }, desc: { type: "string" }, due: { type: "string" },
    earliest: { type: "string" }, latest: { type: "string" },
    flex: { type: "boolean" }, "no-flex": { type: "boolean" }, push: { type: "boolean" },
  },
});

let asJSON = false;
if (argv[0] === "json") { asJSON = true; argv.shift(); }
const cmd = argv.shift() ?? "today";

// ---- helpers ----
const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
function date(x, fallback = s.todayISO()) {
  if (!x) return fallback;
  const t = x.toLowerCase();
  if (t === "today") return s.todayISO();
  if (t === "tomorrow") return s.addDays(s.todayISO(), 1);
  if (t === "yesterday") return s.addDays(s.todayISO(), -1);
  const wd = WD.indexOf(t.slice(0, 3));
  if (wd >= 0) { // next occurrence, including today
    const today = s.todayISO(); const cur = WD.indexOf(s.weekdayOf(today));
    return s.addDays(today, (wd - cur + 7) % 7);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(x)) return x;
  throw new Error(`bad date "${x}"`);
}
const hm = (t) => { const [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "pm" : "am"; return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""}${ap}`; };
const long = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }); };
const out = (obj, text) => console.log(asJSON ? JSON.stringify(obj, null, 2) : text);
const nowHM = () => new Date().toTimeString().slice(0, 5);

function lineFor(b, clashes, today) {
  const flag = b.done ? "x" : (b.date === today && b.start <= nowHM() && nowHM() < b.end) ? ">" : " ";
  const tags = [b.category, b.flexible ? "flex" : "", clashes.has(b.id) ? "OVERLAP" : ""].filter(Boolean).join(" ");
  const desc = b.description ? `  — ${b.description}` : "";
  return `  [${flag}] ${b.start}-${b.end}  ${b.title}  (${tags})  #${b.id.slice(0, 8)}${desc}`;
}

function printDay(d, header = true) {
  const blocks = s.blocksBetween(d, d);
  const clashes = s.overlapsOn(d);
  const today = s.todayISO();
  const lines = [];
  if (header) lines.push(`${long(d)}${d === today ? "  (today)" : ""}${blocks.length ? "" : "  — nothing scheduled"}`);
  for (const b of blocks) lines.push(lineFor(b, clashes, today));
  if (clashes.size) lines.push(`  ! ${clashes.size} blocks overlap`);
  return { blocks, text: lines.join("\n") };
}

function printRange(from, to) {
  const days = [];
  for (let d = from; d <= to; d = s.addDays(d, 1)) days.push(d);
  const parts = days.map((d) => printDay(d));
  out({ from, to, days: parts.map((p, i) => ({ date: days[i], blocks: p.blocks })) }, parts.map((p) => p.text).join("\n\n"));
}

function printTasks() {
  const t = s.tasks(false);
  out({ tasks: t }, t.length ? "Open tasks:\n" + t.map((x) => `  [ ] ${x.title}  (${x.category}${x.dueDate ? `, due ${x.dueDate}` : ""})  #${x.id.slice(0, 8)}`).join("\n") : "Open tasks: none");
}

function resolveTask(ref) {
  const list = s.tasks(true);
  const r = ref.toLowerCase();
  const hits = list.filter((t) => t.id === ref || t.id.startsWith(r) || t.title.toLowerCase().includes(r));
  if (hits.length === 1) return hits[0];
  throw new Error(hits.length ? `"${ref}" matches ${hits.length} tasks` : `no task matches "${ref}"`);
}

function reportConflicts(r) {
  if (!r.conflicts?.length) return "";
  let t = `\n  ! overlaps ${r.conflicts.map((c) => `${c.title} (${c.start}-${c.end})`).join(", ")}`;
  if (o.push) { const moved = s.shiftOthers(r.block.id); t += moved.length ? `\n  pushed: ${moved.map((m) => `${m.title} → ${m.start}-${m.end}`).join(", ")}` : ""; }
  else t += `\n  (add --push to bump them later, or: node ds.mjs push ${r.block.id.slice(0, 8)})`;
  return t;
}

// ---- commands ----
try {
  switch (cmd) {
    case "today": { const d = s.todayISO(); const p = printDay(d); const t = s.tasks(false); out({ date: d, blocks: p.blocks, openTasks: t }, `${p.text}\n\n${t.length ? `Open tasks: ${t.map((x) => x.title).join("; ")}` : "Open tasks: none"}`); break; }
    case "tomorrow": { const d = s.addDays(s.todayISO(), 1); const p = printDay(d); out({ date: d, blocks: p.blocks }, p.text); break; }
    case "day": { const d = date(argv[0]); const p = printDay(d); out({ date: d, blocks: p.blocks }, p.text); break; }
    case "week": { const d = date(argv[0]); const [y, m, dd] = d.split("-").map(Number); const start = s.addDays(d, -new Date(y, m - 1, dd).getDay()); printRange(start, s.addDays(start, 6)); break; }
    case "range": printRange(date(argv[0]), date(argv[1])); break;
    case "year": {
      const from = s.todayISO(); const to = `${from.slice(0, 4)}-12-31`;
      const blocks = s.blocksBetween(from, to); const byMonth = {};
      for (const b of blocks) (byMonth[b.date.slice(0, 7)] ??= []).push(b);
      const text = Object.entries(byMonth).map(([mo, list]) => `${mo}: ${list.length} blocks\n` + list.filter((b) => b.source !== "routine").map((b) => `  ${b.date} ${b.start} ${b.title}`).join("\n")).join("\n");
      out({ from, to, byMonth }, text || "Nothing scheduled for the rest of the year yet.");
      break;
    }
    case "add": {
      const [title, d, start, end, cat] = argv;
      if (!title || !d || !start || !end) throw new Error('usage: add "Title" DATE START END [CATEGORY] [--desc ...] [--flex] [--push]');
      const r = s.addBlock({ title, date: date(d), start, end, category: cat ?? o.cat ?? "flex", description: o.desc, flexible: o.flex, source: "manual" });
      out(r, `Added ${r.block.title} ${r.block.date} ${r.block.start}-${r.block.end} #${r.block.id.slice(0, 8)}` + reportConflicts(r));
      break;
    }
    case "move": case "edit": {
      const b = s.resolveBlock(argv[0], o.date && cmd === "edit" ? date(o.date) : undefined);
      const patch = {};
      if (o.title) patch.title = o.title;
      if (o.cat) patch.category = o.cat;
      if (o.desc !== undefined) patch.description = o.desc;
      if (o.flex) patch.flexible = true;
      if (o["no-flex"]) patch.flexible = false;
      if (o.date && cmd === "move") patch.date = date(o.date);
      if (o.start) patch.start = o.start;
      if (o.end) patch.end = o.end;
      if (o.to) { // shift keeping duration
        const [sh, sm] = b.start.split(":").map(Number); const [eh, em] = b.end.split(":").map(Number);
        const dur = eh * 60 + em - (sh * 60 + sm); const [th, tm] = o.to.split(":").map(Number); const ne = th * 60 + tm + dur;
        patch.start = o.to; patch.end = `${String(Math.floor(ne / 60)).padStart(2, "0")}:${String(ne % 60).padStart(2, "0")}`;
      }
      const r = s.updateBlock(b.id, patch);
      out(r, `${cmd === "move" ? "Moved" : "Updated"} ${r.block.title} → ${r.block.date} ${r.block.start}-${r.block.end}` + reportConflicts(r));
      break;
    }
    case "done": case "undone": { const b = s.resolveBlock(argv[0], o.date ? date(o.date) : undefined); const r = s.setDone(b.id, cmd === "done"); out(r, `${cmd === "done" ? "Done" : "Reopened"}: ${r.title} (${r.date} ${r.start})`); break; }
    case "rm": { const b = s.resolveBlock(argv[0], o.date ? date(o.date) : undefined); s.removeBlock(b.id); out({ removed: b }, `Removed ${b.title} (${b.date} ${b.start}-${b.end})`); break; }
    case "push": { const b = s.resolveBlock(argv[0], o.date ? date(o.date) : undefined); const moved = s.shiftOthers(b.id); out({ moved }, moved.length ? `Pushed: ${moved.map((m) => `${m.title} → ${m.start}-${m.end}${m.note ? ` (${m.note})` : ""}`).join(", ")}` : "Nothing overlapped it."); break; }
    case "free": { const d = date(argv[0]); const mins = Number(argv[1]) || 30; const slots = s.freeSlots(d, mins, o.earliest, o.latest); out({ date: d, minutes: mins, slots }, slots.length ? `Free ${mins}+ min on ${long(d)}:\n` + slots.map((x) => `  ${x.start}-${x.end}  (${x.minutes} min)`).join("\n") : `No ${mins}-minute gap on ${long(d)}.`); break; }
    case "stamp": { const d = date(argv[0]); const added = s.applyRoutines(d); out({ date: d, added }, added.length ? `Stamped ${added.length} routine(s) onto ${long(d)}: ${added.map((b) => b.title).join(", ")}` : `Routines already on ${long(d)}.`); break; }
    case "routines": { const r = s.routines(); out({ routines: r }, r.map((x) => `  ${x.active ? "on " : "off"} ${x.start}-${x.end}  ${x.title}  (${x.category}; ${x.days.length === 7 ? "daily" : x.days.join(",")})  #${x.id.slice(0, 8)}`).join("\n")); break; }
    case "routine-add": {
      const [title, start, end, cat, days] = argv;
      if (!title || !start || !end || !cat || !days) throw new Error('usage: routine-add "Title" START END CATEGORY DAYS');
      const dl = days === "daily" ? s.WEEKDAYS : days === "weekdays" ? ["mon", "tue", "wed", "thu", "fri"] : days === "weekends" ? ["sat", "sun"] : days.split(",");
      const r = s.addRoutine({ title, start, end, category: cat, days: dl, description: o.desc });
      out({ routine: r }, `Routine added: ${r.title} ${r.start}-${r.end} (${r.days.join(",")})`);
      break;
    }
    case "tasks": printTasks(); break;
    case "task-add": { const t = s.addTask({ title: argv[0], category: o.cat ?? "flex", dueDate: o.due ? date(o.due) : undefined }); out({ task: t }, `Task added: ${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ""} #${t.id.slice(0, 8)}`); break; }
    case "task-done": { const t = resolveTask(argv[0]); s.setTaskDone(t.id, true); out({ task: t }, `Task done: ${t.title}`); break; }
    case "task-rm": { const t = resolveTask(argv[0]); s.removeTask(t.id); out({ removed: t }, `Task removed: ${t.title}`); break; }
    case "memories": { const m = s.memories(); out({ memories: m }, m.length ? m.map((x) => `  - ${x.text}  #${x.id.slice(0, 8)}`).join("\n") : "No memories yet."); break; }
    case "remember": { const m = s.remember(argv.join(" ")); out({ memory: m }, `Remembered: ${m.text}`); break; }
    case "forget": { const m = s.memories().find((x) => x.id.startsWith(argv[0]) || x.text.toLowerCase().includes(argv[0].toLowerCase())); if (!m) throw new Error("no such memory"); s.forget(m.id); out({ forgot: m }, `Forgot: ${m.text}`); break; }
    case "log": { const days = Number(argv[0]) || 1; const since = new Date(Date.now() - days * 864e5).toISOString(); const a = s.activitySince(since); out({ since, activity: a }, a.length ? a.map((x) => `  ${x.at.slice(0, 16).replace("T", " ")}  ${x.kind}  ${x.text}`).join("\n") : "No activity logged."); break; }
    case "help": default:
      console.log(`ds — Dayspring schedule CLI\n\n  today | tomorrow | day DATE | week [DATE] | range FROM TO | year\n  add "Title" DATE START END [CATEGORY] [--desc ..] [--flex] [--push]\n  move REF [--date D] [--start HH:MM] [--end HH:MM] [--to HH:MM] [--push]\n  edit REF [--title ..] [--cat ..] [--desc ..] [--flex|--no-flex]\n  done REF | undone REF | rm REF | push REF     (add --date D to disambiguate)\n  free DATE MINUTES | stamp [DATE] | routines | routine-add "T" START END CAT DAYS\n  tasks | task-add "T" [--cat C] [--due D] | task-done REF | task-rm REF\n  memories | remember "text" | forget REF | log [DAYS]\n  json <any read command>\n\nCategories: ${s.CATEGORIES.join(", ")}. Times 24h HH:MM. Dates YYYY-MM-DD, today, tomorrow, mon..sun.`);
      if (cmd !== "help") process.exitCode = 1;
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
}
