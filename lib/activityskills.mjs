// Spoken (and typed) commands about what Dayspring did, with or without an AI brain:
//   "what did you change today?" / "what files did you change yesterday?"   → the file changes from the activity log
//   "undo that last change" / "put that file back"                           → the same undo as undo_change, asking first
//   "show the activity log"                                                  → Settings → Activity log
// The undo asks "Are you sure?" and only goes ahead on the owner's own yes (confirm.mjs), exactly like the AI's tools.
import * as activity from "./activity.mjs";
import * as abilities from "./abilities.mjs";
import * as confirm from "./confirm.mjs";

let pending = null;          // { id, token, at, text }
const WINDOW = confirm.WINDOW_MS;
const norm = (t) => String(t ?? "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim()
  .replace(/^(hey |ok |okay )?dayspring\s+/, "").replace(/^(can you|could you|would you|please)\s+/, "").replace(/\s+please$/, "");

const WHAT = /^(what|which) (files )?(did|have) you (change|changed|edit|edited|touch|touched|do to my files|modify|modified)( (today|yesterday|this week|lately|recently))?( to my files| on my computer| in my files)?$|^(what|which) files (did|have) you (change|changed|edit|edited|touch|touched|create|created|delete|deleted)( (today|yesterday|this week|lately|recently))?$|^(what'?s|what is) in (the|your) activity log( (today|yesterday))?$/;
const UNDO_FILE = /^(undo|revert|reverse|take back) (that|the|your|this) (last )?(file )?(change|edit)( to (that|the|my) file)?( you (just )?made)?$|^(undo|revert) (the|that|your) (last )?file (change|edit)$|^put (that|the|my) file back( the way it was)?$|^(restore|bring back) (that|the) (last )?file( you (changed|deleted|edited))?$|^undo what you (just )?did to (that|the|my) file$/;
const SHOW = /^(show|open|pull up|bring up|display) (me )?(the |your |my )?(activity|file) log$|^(show|open) (me )?what you('ve| have)? (done|changed)$/;

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const listSay = (a) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a.at(-1)}`);
const nm = (p) => String(p ?? "").split(/[\\/]/).filter(Boolean).pop() ?? p;

function changesOn(day) {
  const { entries } = activity.search({ from: day, to: day, kind: "file,folder", limit: 2000 });
  const by = { create: [], change: [], move: [], del: [], undo: [] };
  for (const e of entries.reverse()) {
    if (e.result !== "ok") continue;
    if (e.kind === "file.create" || e.kind === "folder.create") by.create.push(nm(e.path));
    else if (e.kind === "file.write" || e.kind === "file.edit") by.change.push(nm(e.path));
    else if (e.kind === "file.move") by.move.push(nm(e.path));
    else if (e.kind === "file.delete") by.del.push(nm(e.path));
    else if (e.kind === "file.undo") by.undo.push(nm(e.path));
  }
  for (const k of Object.keys(by)) by[k] = [...new Set(by[k])];
  return by;
}
function sayChanges(q) {
  const yest = /\byesterday\b/.test(q);
  const d = new Date(Date.now() - (yest ? 86400000 : 0)).toLocaleDateString("en-CA");
  const by = changesOn(d), when = yest ? "yesterday" : "today";
  const parts = [];
  const few = (a) => (a.length > 4 ? `${a.slice(0, 3).join(", ")} and ${a.length - 3} more` : listSay(a));
  if (by.create.length) parts.push(`created ${plural(by.create.length, "file")} (${few(by.create)})`);
  if (by.change.length) parts.push(`changed ${few(by.change)}`);
  if (by.move.length) parts.push(`moved ${few(by.move)}`);
  if (by.del.length) parts.push(`moved ${few(by.del)} to the Recycle Bin`);
  if (by.undo.length) parts.push(`put back ${few(by.undo)}`);
  if (!parts.length) return `I haven't changed any of your files ${when}.`;
  return `${yest ? "Yesterday" : "Today"} I ${listSay(parts)}. Every change has a backup, so say "undo that last change" if you want one put back, or "show the activity log" to see it all.`;
}

// handle(text, { surface }) → { reply, listen?, openPage?, changes, intent } or null (not for this module)
export async function handle(text, { surface = "tv" } = {}) {
  if (surface === "call") return null;
  const q = norm(text);
  if (!q) return null;
  // the answer to "Are you sure?" about an undo
  if (pending && Date.now() - pending.at < WINDOW) {
    if (confirm.isYes(text)) {
      const p = pending; pending = null;
      const r = await abilities.run("undo_change", { id: p.id, confirm_token: p.token }, { via: "offline" });
      if (r?.restored) return done(`Done. ${nm(r.restored)} is back the way it was${r.backupOfCurrent ? ", and the version it replaced is saved too" : ""}.`, ["file"]);
      if (r?.movedBack) return done(`Done. ${nm(r.movedBack)} is back where it was.`, ["file"]);
      if (r?.removed) return done(`Done. ${nm(r.removed)} is in the Recycle Bin now.`, ["file"]);
      return done(r?.text ?? r?.error ?? "I couldn't undo that.");
    }
    if (confirm.isNo(text)) { pending = null; return done("Okay, I left it alone."); }
    pending = null;
  }
  if (WHAT.test(q)) return done(sayChanges(q), [], "activity.changes");
  if (SHOW.test(q)) return { reply: "Here's the activity log.", openPage: "/setup?s=activity", changes: [], intent: "activity.show" };
  // "undo that last change": a file change when it's clearly about a file, or when the last thing Dayspring changed was a
  // file (in the last 15 minutes); otherwise the older "undo" (the schedule) answers
  const last = UNDO_FILE.test(q) || /^undo (that|the|your) last change$/.test(q) ? abilities.lastUndoable() : null;
  if (last && (/\bfile\b/.test(q) || Date.now() - Date.parse(last.at) < 15 * 60_000)) {
    const r = await abilities.run("undo_change", { id: last.id }, { via: "offline" });
    if (r?.needsConfirm) { pending = { id: last.id, token: r.confirm_token, at: Date.now() }; return { reply: r.text, listen: true, changes: [], intent: "activity.undo" }; }
    return done(r?.text ?? r?.error ?? "I couldn't undo that.");
  }
  if (UNDO_FILE.test(q) && /\bfile\b/.test(q)) return done("I haven't changed any files lately, so there's nothing to undo.");
  return null;
}
const done = (reply, changes = [], intent = "activity.undo") => ({ reply, changes, intent });
export function _reset() { pending = null; }
