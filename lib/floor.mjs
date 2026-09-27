// The conversation floor: the owner's requests come before anything Dayspring planned to say.
//
// A turn starts the moment the owner starts talking (the wake word, 🎙 Talk, typing on the screen, or a message from the
// desk panel, Discord, a text or a phone call) and lasts until the request is fully resolved: the reply has been said,
// any follow-up on the same topic is done (a clarifying question answered, a confirmation given, the answer window
// closed), and then a short grace period passes with no new words from the owner.
//
// Everything Dayspring says on its own (reminders, check-ins, questions, offers, texts, jokes, badges, update notes…)
// goes through offer(). While a turn is on, or while an earlier item of Dayspring's own is still being said or waiting
// for its answer, the item is HELD: not said, not dropped. Held items come out after the turn, one at a time, most
// important first, spaced out, each waiting again if the owner starts a new turn. Duplicates merge; stale ones expire
// or are re-worded ("in 10 minutes" becomes "at 3:15 p.m.").
//
// Not held: alarms and timers (they ring on time; the screen holds only their SPOKEN part until the reply finishes, at
// most RING_SPEECH_MAX_MS), true emergencies (EMERGENCY, below), and what the owner asked for himself (item.requested).
//
// The Dayspring screen (public/floor.js) reports what it's doing: "owner" (he started talking), "tv" idle/busy, and
// "done" for each item it presented (spoken, or cancelled because he started talking during its lead-in chime, in
// which case it's put back in the queue). Nothing here writes to disk.
//
//   offer(item, fire, { refire, expectDone }) · owner(source, surface) · replied(surface, out) · tv(state)
//   done(fid, outcome, tvState) · release() · command(text) · free() · status() · addBusyCheck(fn) · onFire(fn)
//   createFloor(deps) → a separate floor with its own clock and timers (tests)
import * as bus from "./bus.mjs";

export const GRACE_MS = 4000;              // after his request is resolved, this long with no new words before anything planned
export const GAP_MS = 2500;                // between two held items
export const LEAD_CANCEL_MS = 300;         // an item this far into its first words is still called back (the screen does it)
export const RING_SPEECH_MAX_MS = 20_000;  // an alarm's or timer's words wait for the reply at most this long (the screen)
export const PRESENT_MAX_MS = 90_000;      // no word back from the screen about an item: counted as done after this
export const TV_STALE_MS = 90_000;         // "busy" from the screen with no heartbeat for this long: not believed
export const TURN_STALE_MS = 90_000;       // a turn with no activity at all for this long is over (a closed page, a lost reply)
export const REMOTE_ASK_MS = 60_000;       // a reply on Discord / the phone that asked him something: time to answer it
export const LATE_MS = 60_000;             // held longer than this: relative times are re-worded
export const BUSY_CHECK_MAX_MS = 3 * 60_000; // a pending confirmation holds things only this long after he last spoke

// Emergencies interrupt (the whole list): an item marked emergency by its source, and an Extreme weather alert
// (a tornado warning and the like). Everything else waits its turn.
export const EMERGENCY = [
  (it) => it.kind === "emergency" || it.emergency === true,
  (it) => it.kind === "weather" && it.official !== false && /^extreme$/i.test(String(it.severity ?? "")),
];
const RING_KINDS = new Set(["alarm", "morning", "timer"]);
export function classify(item = {}) {
  if (EMERGENCY.some((f) => f(item))) return "emergency";
  if (item.alarm === true || RING_KINDS.has(item.kind)) return "ring";
  if (item.requested === true) return "requested";
  return "hold";
}

// lower comes first
const PRIORITY = { reminder: 1, ready: 1, weather: 1, rundown: 2, checkin: 2, start: 2, text: 3, hook: 3, coder: 4, claude: 4, lantern: 4,
  church: 5, person: 6, xpcheckin: 6, update: 7, discovery: 7, xpbadge: 7, buffer: 8, jokeoffer: 9 };
export const priorityOf = (it = {}) => PRIORITY[it.kind] ?? 5;
const ASK_KINDS = new Set(["checkin", "ready", "person", "church", "text", "jokeoffer", "xpcheckin"]);
export const isQuestion = (it = {}) => Boolean(it.ask) || ASK_KINDS.has(it.kind) || /\?["”’')\s]*$/.test(String(it.text ?? ""));

// how long an item is still worth saying (from when it was first offered)
const MIN = 60_000;
const TTL = { jokeoffer: 30 * MIN, buffer: 10 * MIN, xpcheckin: 90_000, text: 15 * MIN, ready: 20 * MIN, checkin: 30 * MIN, start: 45 * MIN,
  person: 60 * MIN, church: 60 * MIN, lantern: 60 * MIN, discovery: 60 * MIN, xpbadge: 60 * MIN, claude: 60 * MIN, coder: 60 * MIN, hook: 60 * MIN, weather: 60 * MIN,
  update: 24 * 60 * MIN, reminder: Infinity, rundown: 60 * MIN };
export const ttlOf = (it = {}) => TTL[it.kind] ?? 60 * MIN;

const pad = (n) => String(n).padStart(2, "0");
const hmOf = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const spokenAt = (t) => { const d = new Date(t), h = d.getHours(), m = d.getMinutes(); return `${h % 12 || 12}${m ? ":" + pad(m) : ""} ${h >= 12 ? "p.m." : "a.m."}`; };
const WORDN = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, "forty-five": 45 };
const REL = /\bin (\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty-five) (minutes?|mins?|hours?)\b/i;
// Held too long to say as it was: "Leave in 10 minutes" (offered at 3:05) → "Leave at 3:15 p.m."; a reminder more than
// two minutes late says when it was due. A block that has already ended, or anything past its TTL, is dropped.
export function freshen(entry, now) {
  const it = entry.item, age = now - entry.createdAt;
  if (age > ttlOf(it)) return { drop: true, why: `stale (${Math.round(age / 1000)} s old)` };
  if (it.kind === "start" && it.started?.end && it.date === localDate(now) && hmOf(now) >= it.started.end) return { drop: true, why: "that block is over" };
  if (age < LATE_MS) return { item: it };
  let text = String(it.text ?? "");
  const m = REL.exec(text);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORDN[m[1].toLowerCase()] ?? 1;
    const at = entry.createdAt + n * (/^h/i.test(m[2]) ? 60 : 1) * MIN;
    text = text.replace(REL, `at ${spokenAt(at)}`).replace(/\b([ap])\.m\.\./, "$1.m.");
  }
  if (it.kind === "reminder" && age >= 2 * MIN && !/^this was due at\b/i.test(text)) text = `This was due at ${spokenAt(entry.createdAt)}: ${text}`;
  return { item: text === it.text ? it : { ...it, text, reworded: true } };
}
const localDate = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// what the held item is, for the little "after this" sign
export function labelOf(it = {}) {
  switch (it.kind) {
    case "reminder": return `a reminder: ${String(it.reminder?.text ?? it.text ?? "").slice(0, 50)}`;
    case "text": return `a text from ${it.from ?? "someone"}`;
    case "checkin": return "a check-in";
    case "start": return it.started?.title ? `what's next: ${it.started.title}` : "what's next";
    case "person": return "a question about someone";
    case "jokeoffer": return "a joke";
    case "weather": return "a weather alert";
    case "coder": case "claude": return "a note about Claude Code";
    case "update": return "an update";
    case "xpbadge": return "a badge";
    case "xpcheckin": return "a quick check-in";
    case "lantern": return "something from Lantern";
    case "church": return "an offer about church";
    case "buffer": return "a few free minutes";
    default: return isQuestion(it) ? "a question" : "something to tell you";
  }
}
// the same thing twice (two texts from one person, the same reminder snoozed back in) is said once, the newest wording
export function keyOf(it = {}) {
  const who = it.reminder?.id ?? it.reminder?.text ?? it.from ?? it.person ?? it.badge ?? it.started?.id ?? null;
  return `${it.kind ?? "say"}|${who ?? String(it.text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
}

// "Dayspring, what were you going to say?" — hear what's waiting right away
export const RELEASE_RE = /^(?:(?:hey|ok|okay|so)[,\s]+)?(?:dayspring[,\s]+)?(?:what (?:were|was) you (?:going|gonna|about) to (?:say|tell me|ask(?: me)?)|what did you want to (?:say|tell me|ask(?: me)?)|you were (?:going|about) to (?:say|tell me|ask) (?:something|me something)|(?:did you|do you) (?:have|want to (?:say|tell me)) (?:something|anything)(?: to tell me| for me)?|what(?:'s| is) waiting|what did you (?:hold|save) for me|(?:tell me|say) what you were (?:going|about) to say|go ahead and (?:tell me|say it)|anything (?:you wanted|waiting) to tell me)(?: now)?[?.!\s]*$/i;
export const isRelease = (text) => RELEASE_RE.test(String(text ?? "").trim());

export function createFloor(d = {}) {
  const now = d.now ?? (() => Date.now());
  const setTimer = d.setTimer ?? ((fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; });
  const clearTimer = d.clearTimer ?? ((t) => clearTimeout(t));
  const broadcast = d.broadcast ?? (() => {});
  const displayCount = d.displayCount ?? (() => 1);
  const log = d.log ?? (() => {});
  const queue = [];                          // held entries
  const turns = new Map();                   // surface → { source, startedAt, lastAt }
  const busyChecks = [], fireHooks = [];
  let presenting = null;                     // { entry, until }
  let tvState = "idle", tvAt = 0;
  let graceUntil = 0, lastOwnerAt = 0, releasing = false, timer = null, seq = 0, lastSent = "";
  const expired = [], delivered = [];

  const turnActive = () => {
    const t = now();
    for (const [k, v] of turns) if (t - v.lastAt > TURN_STALE_MS) { turns.delete(k); log("turn-stale", { surface: k }); }
    return turns.size > 0;
  };
  const tvBusy = () => displayCount() > 0 && tvState === "busy" && now() - tvAt < TV_STALE_MS;
  const checksBusy = () => now() - lastOwnerAt < BUSY_CHECK_MAX_MS && busyChecks.some((f) => { try { return Boolean(f()); } catch { return false; } });
  function blockedBy() {
    if (presenting && now() < presenting.until) return "presenting";
    if (presenting) { log("present-timeout", { kind: presenting.entry.item.kind }); presenting = null; }
    if (turnActive()) return "owner";
    if (tvBusy()) return "screen";
    if (now() < graceUntil) return "grace";
    if (checksBusy()) return "pending";
    return null;
  }
  const free = () => blockedBy() === null;

  function sendState() {
    const s = { held: queue.length, next: queue[0] ? labelOf(queue[0].item) : null, items: queue.slice(0, 5).map((e) => labelOf(e.item)), turn: turns.size > 0, presenting: Boolean(presenting) };
    const k = JSON.stringify(s);
    if (k === lastSent) return;
    lastSent = k;
    try { broadcast("floor", s); } catch { /* no screens */ }
  }
  const order = () => queue.sort((a, b) => a.prio - b.prio || a.createdAt - b.createdAt);
  function hold(entry) {
    const same = queue.find((e) => e.key === entry.key);
    if (same) {                                           // merged: the newest wording, the oldest place in line
      same.item = { ...entry.item, fid: same.fid }; same.fire = entry.fire; same.refire = entry.refire; same.merged++;
      log("merged", { kind: entry.item.kind });
    } else queue.push(entry);
    order();
    log("held", { kind: entry.item.kind, why: blockedBy(), held: queue.length });
    sendState(); schedule();
  }
  function present(entry) {
    const f = freshen(entry, now());
    if (f.drop) { expired.push({ kind: entry.item.kind, text: entry.item.text, why: f.why }); log("expired", { kind: entry.item.kind, why: f.why }); return false; }
    entry.item = f.item;
    const expect = entry.expectDone && displayCount() > 0;
    presenting = { entry, until: now() + (expect ? PRESENT_MAX_MS : Math.min(15_000, 1500 + String(entry.item.text ?? "").length * 60)) };
    const again = entry.fired;
    entry.fired = true;
    delivered.push({ kind: entry.item.kind, text: entry.item.text, at: now(), fid: entry.fid });
    if (delivered.length > 50) delivered.shift();
    // again: it was shown once already (its desktop card is up)
    try { if (again && entry.refire) entry.refire({ ...entry.item, again: true }); else entry.fire(entry.item); } catch (e) { log("fire-failed", { error: String(e?.message ?? e) }); }
    for (const fn of fireHooks) { try { fn(entry.item); } catch { /* a hook's problem stays its own */ } }
    log("delivered", { kind: entry.item.kind, held: now() - entry.createdAt, again });
    return true;
  }
  function pump() {
    // expired items leave the line even while it waits, so the "after this" count stays true
    for (let i = queue.length - 1; i >= 0; i--) { const f = freshen(queue[i], now()); if (f.drop) { const [e] = queue.splice(i, 1); expired.push({ kind: e.item.kind, text: e.item.text, why: f.why }); log("expired", { kind: e.item.kind, why: f.why }); } }
    while (queue.length && free()) { const e = queue.shift(); if (present(e)) break; }
    if (!queue.length) releasing = false;
    sendState(); schedule();
  }
  function schedule() {
    if (timer) { clearTimer(timer); timer = null; }
    if (!queue.length && !presenting) return;
    const t = now(), soon = [graceUntil, presenting?.until ?? 0, tvBusy() ? tvAt + TV_STALE_MS : 0,
      ...[...turns.values()].map((v) => v.lastAt + TURN_STALE_MS)].map((x) => x + 1).filter((x) => x > t);
    const wait = Math.max(50, Math.min(5000, ...(soon.length ? soon.map((x) => x - t + 10) : [5000])));
    timer = setTimer(() => { timer = null; pump(); }, wait);
  }

  return {
    // Something Dayspring wants to say on its own. fire(item) delivers it (the announce broadcast); refire(item) delivers
    // it again after the screen called it back. expectDone: the screen reports "done" for it (announce items do).
    offer(item, fire, { refire = null, expectDone = true } = {}) {
      if (!item || typeof fire !== "function") return "invalid";
      item.fid = `f${now().toString(36)}${(++seq).toString(36)}`;   // always new (a snoozed item comes back as a copy of the old one)
      const cls = classify(item);
      item.floor = cls;
      if (cls !== "hold") { log("through", { kind: item.kind, cls }); try { fire(item); } catch (e) { log("fire-failed", { error: String(e?.message ?? e) }); } return cls; }
      const entry = { fid: item.fid, item, fire, refire, expectDone, createdAt: now(), prio: priorityOf(item), key: keyOf(item), merged: 0, requeued: 0, fired: false };
      if (!queue.length && free()) { present(entry) ; sendState(); schedule(); return "now"; }
      hold(entry);
      return "held";
    },
    // He started (or kept) talking. surface "tv" is the Dayspring screen; anything else is Discord, the phone, the desk panel…
    owner(source = "voice", surface = "tv") {
      const t = now(), s = surface === "tv" || !surface ? "tv" : String(surface);
      const cur = turns.get(s);
      if (cur) cur.lastAt = t; else { turns.set(s, { source, startedAt: t, lastAt: t }); log("turn", { source, surface: s }); }
      lastOwnerAt = t; releasing = false;
      sendState(); schedule();
    },
    // A reply was given. On the screen the turn goes on until the screen is idle again (the reply said, any follow-up
    // window closed); elsewhere it ends now, with the grace period (a minute if the reply asked him something).
    replied(surface = "tv", out = null) {
      const s = surface === "tv" || !surface ? "tv" : String(surface), t = now();
      if (s === "tv" && displayCount() > 0) { const cur = turns.get("tv"); if (cur) cur.lastAt = t; return; }
      if (!turns.delete(s) && s !== "tv") return;
      const asked = Boolean(out && (out.listen || out.conversation || out.suggest || /\?["”’')\s]*$/.test(String(out.reply ?? ""))));
      graceUntil = Math.max(graceUntil, t + (asked && s !== "tv" ? REMOTE_ASK_MS : GRACE_MS));
      pump();
    },
    // the speaking screen: "busy" (talking, thinking, listening for an answer, ringing) or "idle"
    tv(state) {
      const t = now(), was = tvState;
      tvState = state === "busy" ? "busy" : "idle"; tvAt = t;
      if (tvState === "busy" && turns.has("tv")) turns.get("tv").lastAt = t;   // his exchange is still going (the heartbeat)
      if (tvState === "idle") {                          // the screen is idle again: his exchange there is over
        const owned = turns.delete("tv");
        if (owned || was !== "idle") graceUntil = Math.max(graceUntil, t + (owned && !releasing ? GRACE_MS : GAP_MS));
      }
      pump();
    },
    // the screen finished presenting an item: "spoken" (or shown), or "cancelled" (he started talking as it began: put back)
    done(fid, outcome = "spoken", tvNow = null) {
      if (tvNow === "busy" || tvNow === "idle") { tvState = tvNow; tvAt = now(); }
      if (!presenting || presenting.entry.fid !== fid) return false;
      const e = presenting.entry;
      presenting = null;
      graceUntil = Math.max(graceUntil, now() + GAP_MS);
      if (outcome === "cancelled") { e.requeued++; queue.push(e); order(); log("requeued", { kind: e.item.kind }); }
      pump();
      return true;
    },
    // "what were you going to say?": what's waiting comes out as soon as the reply to that has been said
    release() {
      releasing = queue.length > 0;
      graceUntil = Math.min(graceUntil, now());
      lastOwnerAt = 0;                                  // a forgotten confirmation doesn't hold it back
      const n = queue.length;
      pump();
      return n;
    },
    command(text) {
      if (!isRelease(text)) return null;
      const n = queue.length + (presenting ? 1 : 0);
      if (!n) return "Nothing's waiting. I've told you everything I had.";
      const r = this.release();
      return r > 1 ? `I was holding ${r} things. Here they are.` : "Here's what I was going to say.";
    },
    free,
    blockedBy,
    tick: pump,
    addBusyCheck(fn) { if (typeof fn === "function") busyChecks.push(fn); },
    onFire(fn) { if (typeof fn === "function") fireHooks.push(fn); },
    status() {
      return { held: queue.map((e) => ({ kind: e.item.kind, label: labelOf(e.item), fid: e.fid, priority: e.prio, heldMs: now() - e.createdAt, merged: e.merged, requeued: e.requeued, question: isQuestion(e.item) })),
        presenting: presenting ? { kind: presenting.entry.item.kind, fid: presenting.entry.fid } : null, turn: [...turns.keys()], screen: tvState, blockedBy: blockedBy(),
        graceLeftMs: Math.max(0, graceUntil - now()), releasing, expired: expired.slice(-20), delivered: delivered.slice(-20) };
    },
    _reset() { queue.length = 0; turns.clear(); presenting = null; tvState = "idle"; tvAt = 0; graceUntil = 0; lastOwnerAt = 0; releasing = false; expired.length = 0; delivered.length = 0; if (timer) clearTimer(timer); timer = null; lastSent = ""; },
  };
}

// the one the server uses
let devlog = null;
import("./devlog.mjs").then((m) => { devlog = m; }).catch(() => {});
export const floor = createFloor({
  broadcast: (t, x) => bus.broadcast(t, x),
  displayCount: () => bus.displayCount(),
  log: (what, x) => { try { devlog?.log("floor", { what, ...x }); } catch { /* logging only */ } },
});
export const offer = (...a) => floor.offer(...a);
export const owner = (...a) => floor.owner(...a);
export const replied = (...a) => floor.replied(...a);
export const tv = (...a) => floor.tv(...a);
export const done = (...a) => floor.done(...a);
export const release = () => floor.release();
export const command = (t) => floor.command(t);
export const free = () => floor.free();
export const status = () => floor.status();
export const addBusyCheck = (fn) => floor.addBusyCheck(fn);
export const onFire = (fn) => floor.onFire(fn);
bus.addHello("floor", () => { const s = floor.status(); return { held: s.held.length, next: s.held[0]?.label ?? null, items: s.held.slice(0, 5).map((x) => x.label) }; });
