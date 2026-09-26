// All the owner's calendars together, and the conflicts between them (for the Schedule app and the display):
//   GET  /api/calendar/unified?from=&to=[&refresh=1] → { items (outside calendars and tasks, each with its source, color and
//                                                      link), conflicts (with ranked fixes), clash: { itemId: [conflictId] },
//                                                      dupOf, alsoOn, sources }
//   GET  /api/calendar/sources                     → every source: shown or hidden, color, last refresh, any error; travel
//                                                      setting; sync status
//   POST /api/calendar/sources { key, hidden }     → show or hide one source (remembered)
//   POST /api/calendar/refresh                     → fetch every source again now
//   POST /api/calendar/busy { id, busy }           → count an all-day item as busy (or not) for conflicts
//   POST /api/calendar/travel { on, minutes }      → check travel time between places
//   POST /api/calendar/sync { account, on }        → put the Dayspring schedule on Google/Outlook (off removes the copies)
//   GET  /api/conflicts?from=&to=                  → conflicts with fixes (default: today and the next 6 days)
//   POST /api/conflicts/resolve { id, choice, confirmed } → apply a fix (outside-calendar fixes need confirmed: true)
import * as unified from "./unified.mjs";
import * as conflicts from "./conflicts.mjs";
import * as calsync from "./calsync.mjs";
import { broadcast } from "./bus.mjs";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toLocaleDateString("en-CA");
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const span = (q, days = 6) => { const from = ISO.test(q.get("from") ?? "") ? q.get("from") : today(); let to = ISO.test(q.get("to") ?? "") ? q.get("to") : addDays(from, days); if (to < from) to = from; if (to > addDays(from, 62)) to = addDays(from, 62); return [from, to]; };
const changed = () => { broadcast("refresh", { reason: "calendars" }); broadcast("conflicts", { at: Date.now() }); };

export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (m === "GET" && p === "/calendar/unified") {
    const [from, to] = span(q);
    const force = q.get("refresh") === "1";
    const r = await conflicts.list(from, to, { force });
    const clash = {};
    for (const c of r.conflicts) if (!c.past) for (const x of c.items) (clash[x.id] ??= []).push(c.id);
    const items = r.items.filter((x) => x.source !== "dayspring").map(({ notes, ...x }) => ({ ...x, notes: String(notes ?? "").slice(0, 400) }));
    const hiddenDayspring = unified.config().hidden.includes("dayspring");
    return send(res, 200, { from, to, items, conflicts: r.conflicts, clash, dupOf: r.dupOf, alsoOn: r.alsoOn, hiddenDayspring, ...(await unified.sources()) }), true;
  }
  if (m === "GET" && p === "/calendar/sources") return send(res, 200, await unified.sources()), true;
  if (m === "POST" && p === "/calendar/sources") {
    const b = await readJSON(req).catch(() => ({}));
    if (!b.key) return send(res, 400, { error: "Which calendar?" }), true;
    unified.setHidden(String(b.key), Boolean(b.hidden)); changed();
    return send(res, 200, await unified.sources()), true;
  }
  if (m === "POST" && p === "/calendar/refresh") {
    unified.clear();
    try { await (await import("./connectors/index.mjs")).clearCache(); } catch { /* the connectors keep their own caches */ }
    await unified.items(today(), addDays(today(), 6), { force: true });
    changed();
    return send(res, 200, await unified.sources()), true;
  }
  if (m === "POST" && p === "/calendar/busy") {
    const b = await readJSON(req).catch(() => ({}));
    if (!b.id) return send(res, 400, { error: "Which item?" }), true;
    unified.setBusyAllDay(String(b.id), Boolean(b.busy)); changed();
    return send(res, 200, { ok: true, busy: Boolean(b.busy) }), true;
  }
  if (m === "POST" && p === "/calendar/travel") {
    const b = await readJSON(req).catch(() => ({}));
    const c = unified.setConfig({ travel: { on: Boolean(b.on), minutes: Number(b.minutes) || unified.config().travel.minutes } }); changed();
    return send(res, 200, { travel: c.travel }), true;
  }
  if (p === "/calendar/sync") {
    if (m === "GET") return send(res, 200, calsync.status()), true;
    if (m === "POST") {
      const b = await readJSON(req).catch(() => ({}));
      try { const r = await calsync.setEnabled(String(b.account ?? ""), Boolean(b.on)); unified.clear(); changed(); return send(res, 200, { result: r, sync: calsync.status() }), true; }
      catch (e) { return send(res, 400, { error: e.message }), true; }
    }
  }
  if (m === "GET" && p === "/conflicts") { const [from, to] = span(q); const r = await conflicts.list(from, to); return send(res, 200, { from, to, conflicts: r.conflicts }), true; }
  if (m === "POST" && p === "/conflicts/resolve") {
    const b = await readJSON(req).catch(() => ({}));
    if (!b.id) return send(res, 400, { error: "Which conflict?" }), true;
    try { const r = await conflicts.resolve(String(b.id), String(b.choice ?? "best"), { confirmed: b.confirmed === true }); return send(res, r.error ? 409 : 200, r), true; }
    catch (e) { return send(res, 502, { error: e.message }), true; }
  }
  return false;
}

// For the server's /api/calendar (the display's week and month panels): outside events from the shown sources, one
// copy each (duplicates merged), in the block shape it already uses. Tasks stay out of the time grid.
export async function externalBlocks(from, to) {
  const all = await unified.items(from, to);
  const { dupOf } = conflicts.detect(all);
  return all.filter((x) => x.source !== "dayspring" && x.kind === "event" && !x.hidden && !dupOf[x.id])
    .map((x) => ({ id: x.id, date: x.date, start: x.start, end: x.end, title: x.title, description: x.where ?? "", category: "flex", external: x.source, projected: true, allDay: x.allDay, color: x.color, sourceLabel: x.sourceLabel }));
}
