// "I need to schedule something Saturday at 3. Do I have anything then? Can we move things around that day or that week
// to fit it in and still get everything knocked out?"  →  fit() finds what's in the way and proposes where each movable
// block could go instead (the same day first, then later that week), keeping every block's length. Nothing changes until
// apply() is called, after the owner says yes.
import * as store from "./store.mjs";
import * as owner from "./owner.mjs";

const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const toHM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const EARLIEST = 6 * 60, LATEST = 22 * 60;

// Fixed commitments never move by themselves; everything else can. Which ones are fixed is the owner's (data/owner.json "fixed").
export function isFixed(b) {
  const f = owner.get().fixed ?? {}, t = String(b.title ?? "").toLowerCase();
  return (f.categories ?? []).includes(b.category) || (f.titleWords ?? []).some((w) => w && t.includes(String(w).toLowerCase()));
}
// Pinned to a clock time someone else sets (work, church, classes, meetings). Personal fixed habits like nightly
// reading and prayer before bed are fixed in the sense of "don't skip", but they can slide earlier with the evening.
export function isAnchored(b) {
  const t = String(b.title ?? "").toLowerCase();
  const personal = /\b(reading|prayer|praise|devotion|quiet time|journal|bed|bedtime|wind down)\b/.test(t) && !/\b(church|service|worship|class|potluck|meeting|study group)\b/.test(t);
  return isFixed(b) && !personal;
}
// Free time and open blocks are the first place to take time from — they don't need to be re-placed.
const isFiller = (b) => /free time|your time|open afternoon|open evening|game time/i.test(b.title);

function freeOn(date, minutes, blocksToIgnore, taken) {
  const day = store.blocksBetween(date, date).filter((b) => !blocksToIgnore.has(b.id) && !isFiller(b));
  const busy = day.map((b) => [toMin(b.start), toMin(b.end)]).concat(taken.filter((t) => t.date === date).map((t) => [t.s, t.e]))
    .sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let cur = EARLIEST;
  for (const [s, e] of busy) { if (s - cur >= minutes) gaps.push([cur, s]); cur = Math.max(cur, e); }
  if (LATEST - cur >= minutes) gaps.push([cur, LATEST]);
  return gaps;
}

// Where could this block go instead? Nearest to its old time on the same day, else the same time on a later day this week.
function placeFor(b, dates, ignore, taken) {
  const dur = toMin(b.end) - toMin(b.start);
  for (const d of dates) {
    const gaps = freeOn(d, dur, ignore, taken);
    if (!gaps.length) continue;
    const want = toMin(b.start);
    let best = null;
    for (const [gs, ge] of gaps) {
      const s = Math.min(Math.max(want, gs), ge - dur);
      const cost = Math.abs(s - want);
      if (!best || cost < best.cost) best = { s, cost };
    }
    return { date: d, start: toHM(best.s), end: toHM(best.s + dur) };
  }
  return null;
}

let pending = null;   // the last proposal, waiting for a yes

export function fit({ date, start, end, minutes, title = "the new thing" }) {
  if (!start) throw new Error("fit needs a start time");
  const e = end ?? toHM(Math.min(toMin(start) + (minutes ?? 60), 23 * 60 + 59));
  const clash = store.blocksBetween(date, date).filter((b) => b.start < e && start < b.end);
  const fixed = clash.filter(isFixed), fillers = clash.filter((b) => !isFixed(b) && isFiller(b)), movable = clash.filter((b) => !isFixed(b) && !isFiller(b));
  // the rest of that week (through Sunday)
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  const dates = [date, ...Array.from({ length: (7 - dow) % 7 }, (_, i) => store.addDays(date, i + 1))];
  const ignore = new Set(clash.map((b) => b.id));
  const taken = [{ date, s: toMin(start), e: toMin(e) }];
  const moves = [], stuck = [];
  for (const b of movable) {
    const to = placeFor(b, dates, ignore, taken);
    if (to) { moves.push({ id: b.id, title: b.title, from: { date: b.date, start: b.start, end: b.end }, to }); taken.push({ date: to.date, s: toMin(to.start), e: toMin(to.end) }); }
    else stuck.push({ id: b.id, title: b.title, start: b.start, end: b.end });
  }
  pending = { add: { date, start, end: e, title }, moves, shrink: fillers.map((b) => ({ id: b.id, title: b.title })) };
  return {
    date, start, end: e, free: clash.length === 0,
    inTheWay: clash.map((b) => ({ title: b.title, start: b.start, end: b.end, fixed: isFixed(b) })),
    fixed: fixed.map((b) => ({ title: b.title, start: b.start, end: b.end })),
    freeTimeUsed: fillers.map((b) => b.title),
    moves, stuck,
    workable: fixed.length === 0 && stuck.length === 0,
  };
}

// Free/open time under something that now needs that slot: cut it around the slot.
function carveFillers(date, start, end, keepId) {
  const s = toMin(start), e = toMin(end);
  for (const b of store.blocksBetween(date, date)) {
    if (b.id === keepId || !isFiller(b) || !(b.start < end && start < b.end)) continue;
    const bs = toMin(b.start), be = toMin(b.end);
    if (s <= bs && e >= be) store.removeBlock(b.id);
    else if (s > bs && e < be) { store.updateBlock(b.id, { end: toHM(s) }); store.addBlock({ date: b.date, start: toHM(e), end: b.end, title: b.title, category: b.category, description: b.description, source: "plan" }); }
    else if (s <= bs) store.updateBlock(b.id, { start: toHM(e) });
    else store.updateBlock(b.id, { end: toHM(s) });
  }
}

// Do it: move the blocks, trim free time wherever something lands, and add the new block.
export function apply({ title, category = "flex", description = "" } = {}) {
  if (!pending) throw new Error("There's no plan waiting. Ask me to fit something in first.");
  const p = pending; pending = null;
  for (const mv of p.moves) { store.updateBlock(mv.id, { date: mv.to.date, start: mv.to.start, end: mv.to.end }); carveFillers(mv.to.date, mv.to.start, mv.to.end, mv.id); }
  carveFillers(p.add.date, p.add.start, p.add.end, null);
  const r = store.addBlock({ date: p.add.date, start: p.add.start, end: p.add.end, title: title || p.add.title, category, description, source: "plan" });
  return { added: r.block, moved: p.moves, conflictsLeft: r.conflicts.map((c) => c.title) };
}
export function hasPending() { return Boolean(pending); }
export function dropPending() { pending = null; }

// "I need to do X next": X starts now. What they were doing stops here; the movable blocks after it slide back,
// hopping over anything fixed. Fixed blocks (work and the owner's own list) never move: if they're in one of those
// right now, nothing changes and the answer offers the slot right after it instead.
export function doNow({ title, minutes = 30, category = "flex" }) {
  const now = new Date();
  const date = store.todayISO(now), s = now.getHours() * 60 + now.getMinutes();
  const day = store.blocksBetween(date, date);
  const cur = day.find((b) => toMin(b.start) <= s && s < toMin(b.end) && !b.done);
  if (cur && isFixed(cur)) {
    fit({ date, start: cur.end, minutes, title });             // ready for a "yes"
    return { blockedBy: { title: cur.title, end: cur.end }, suggestion: cur.end };
  }
  const e = Math.min(s + minutes, 23 * 60 + 59);
  if (cur && !isFiller(cur)) store.updateBlock(cur.id, { end: toHM(Math.max(s, toMin(cur.start) + 1)) });   // what they were doing stops now
  carveFillers(date, toHM(s), toHM(e), null);
  const fixed = day.filter((b) => isFixed(b) && toMin(b.end) > s);
  const pushed = [];
  let cursor = e;
  for (const b of store.blocksBetween(date, date).filter((x) => toMin(x.start) >= s && x.id !== cur?.id && !isFiller(x)).sort((a, z) => a.start.localeCompare(z.start))) {
    if (toMin(b.start) >= cursor) break;                        // nothing else overlaps: done
    if (isFixed(b)) { cursor = Math.max(cursor, toMin(b.end)); continue; }
    const dur = toMin(b.end) - toMin(b.start);
    let ns = cursor;
    for (const f of fixed) if (ns < toMin(f.end) && toMin(f.start) < ns + dur) ns = toMin(f.end);   // hop over fixed blocks
    if (ns + dur > 23 * 60 + 59) break;
    store.updateBlock(b.id, { start: toHM(ns), end: toHM(ns + dur) });
    pushed.push({ title: b.title, start: toHM(ns) });
    cursor = ns + dur;
  }
  const r = store.addBlock({ date, start: toHM(s), end: toHM(e), title, category, source: "plan" });
  return { added: r.block, stopped: cur && !isFiller(cur) ? cur.title : null, pushed };
}
