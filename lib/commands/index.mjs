// Dayspring's commands without AI ("vanilla"): the settings, the sky and the screen, the schedule with repeats,
// reminders, alarms and timers to a clock time, understood from everyday speech and actually done, with a plain reply
// saying what changed. Also: ending the conversation ("thanks", "that's all", "bye"), "undo that", two requests at once
// ("turn off the lights and set a timer for 10 minutes"), "it" / "that" meaning the last thing, "not tomorrow, Friday",
// "don't remind me", and one clarifying question when something is truly missing ("never mind" drops it).
//
//   around(text, { surface, ai }, run)   wraps every message (lib/assistant.mjs chat): endings, lead-ins ("thanks, now
//                                         …"), follow-up questions dropped when it was ended, the floor let go at once,
//                                         and any setting change remembered for "undo that"
//   handle(text, { surface, part })       the commands themselves (lib/assistant.mjs chatInner, when there's no AI)
//   parse(text, { now, last })            dry run: which command and its details (tests, "Try it")
//   state(surface) · start() · setDeps({ run, broadcast })
import * as settings from "../settings.mjs";
import * as owner from "../owner.mjs";
import * as permissions from "../permissions.mjs";
import * as sky from "../skyprefs.mjs";
import * as store from "../store.mjs";
import * as timers from "../timers.mjs";
import * as reminders from "../reminders.mjs";
import * as offline from "../offline.mjs";
import * as intents from "../intents/index.mjs";
import { on as featureOn } from "../features.mjs";
import { prep, cap, listSay, keepCase } from "./words.mjs";
import { closing as closingOf, lead as leadOf, clean } from "./closing.mjs";
import * as S from "./settings-voice.mjs";
import * as scene from "./scene.mjs";
import * as clock from "./clock.mjs";
import * as sched from "./schedule.mjs";
import * as temp from "./temp.mjs";
import * as profile from "./profile.mjs";
import { geocode } from "../geocode.mjs";
import { when, repeatIn, soonest, describeRepeat } from "./when.mjs";
import { sayTime, sayDate, sayDuration, isoOf } from "../intents/slots.mjs";

let deps = { run: null, broadcast: () => {}, now: () => new Date(), looks: null };
export function setDeps(d) { deps = { ...deps, ...d }; }
const now = () => deps.now();
const bc = (t, d) => { try { deps.broadcast(t, d); } catch { /* no screens */ } };
const FEATURE = "commands";
export const enabled = () => featureOn(FEATURE);
// ending the conversation ("thanks, that's all", "no thanks", "bye") is its own feature, "conversation" (beta, so in
// production too); the rest of this file is "commands" (dev). With commands on, endings are always on as well.
export const endingsOn = () => enabled() || featureOn("conversation");

// ---- per-surface state -------------------------------------------------------------------------------------------------
const ST = new Map();
const st = (surface = "tv") => { const k = surface === "tv" || !surface ? "tv" : String(surface); if (!ST.has(k)) ST.set(k, { pending: null, last: null, undo: [], foreignAt: 0 }); return ST.get(k); };
export function _reset() { ST.clear(); temp._reset(); }
const PENDING_MS = 60_000, LAST_MS = 15 * 60_000, UNDO_MS = 15 * 60_000;
const fresh = (x, ms) => x && Date.now() - x.at < ms;
export function state(surface = "tv") { const s = st(surface); return { pending: s.pending ? { kind: s.pending.kind, need: s.pending.need ?? null, ask: s.pending.ask } : null, last: s.last, undo: s.undo.map((u) => ({ what: u.what, at: u.at })), temp: temp.list(), reminders: (() => { try { return reminders.upcoming(30); } catch { return []; } })() }; }
function setLast(s, x) { s.last = { ...x, at: Date.now() }; }
function pushUndo(s, what, fn) { s.undo.push({ what, fn, at: Date.now() }); s.pushes = (s.pushes ?? 0) + 1; if (s.undo.length > 20) s.undo.shift(); }

// Is Dayspring waiting for an answer anywhere? (then "okay" is an answer, and an ending drops the question)
export function anyPending(surface = "tv") {
  const s = st(surface);
  let p = fresh(s.pending, PENDING_MS) ? ["commands"] : [];
  try { p = [...p, ...intents.pendingState(surface)]; } catch { /* no intents */ }
  try { if (offline.pending()) p.push("offline"); } catch { /* fine */ }
  for (const [k, f] of otherAsks ?? []) { try { if (f(surface)) p.push(k); } catch { /* fine */ } }
  return p;
}
// Questions other skills ask and answer themselves: a Lantern card ("Accept, decline, or later?") and the assistant's
// new name ("Say yes"). Loaded once, lazily (they're big, and Lantern's module imports a lot).
let otherAsks = null;
async function loadOtherAsks() {
  if (otherAsks) return;
  otherAsks = [];
  try { const l = await import("../lantern.mjs"); otherAsks.push(["lantern", () => Boolean(l.pendingQuestion?.())]); } catch { /* no Lantern */ }
  try { const n = await import("./naming.mjs"); otherAsks.push(["naming", (sf) => n.isPending(sf)]); } catch { /* fine */ }
  // Shopping's own questions ("Add … to your Amazon cart?", "Skip the Oct 5 delivery?"): "okay" / "yeah" answers them
  try { const sh = await import("../shopping/index.mjs"); otherAsks.push(["shopping", (sf) => sh.featureEnabled() && sh.hasPending(sf)]); } catch { /* fine */ }
  // the between-blocks check-in on the screen (lib/session.mjs): "no I'm good, thanks" there gets its own sign-off
  try { const se = await import("../session.mjs"); otherAsks.push(["session", (sf) => (sf === "tv" || !sf) && Boolean(se.current())]); } catch { /* fine */ }
}
// "later" / "not now" to another skill's question is its answer (a Lantern friend request: keep it for later), not a goodbye
const LATER_ANSWER = /^(later|maybe later|later dayspring|not now|not right now|remind me later)$/;
function dropPending(surface) {
  const s = st(surface); s.pending = null;
  try { intents.clearState(surface); } catch { /* fine */ }
  try { offline.clearPending(); } catch { /* fine */ }
  import("../shopping/index.mjs").then((sh) => sh.clearPending(surface)).catch(() => {});
}

// ---- around every message ----------------------------------------------------------------------------------------------
// run(text) → the reply object from the rest of Dayspring. Returns the reply, with close: true when the conversation ended.
export async function around(text, { surface = "tv", ai = false } = {}, run) {
  const s = st(surface);
  const full = enabled();
  if (!full && !endingsOn()) return run(text);
  await loadOtherAsks();
  // "never mind the timer, cancel it" → "cancel the timer"; "thanks for the reminder, now set a timer…" → the request
  const ld = leadOf(text);
  if (ld) text = ld.text;
  const pend = anyPending(surface);
  if (pend.some((k) => k === "lantern" || k === "naming") && LATER_ANSWER.test(clean(text))) return run(text);
  if (pend.includes("session")) return run(text);             // the check-in conversation answers its own endings
  // "cancel that" / "scratch that" right after something of ours: undo it (not just "okay")
  if (full && /^(cancel that|scratch that|undo that|no undo that|never ?mind undo that)$/.test(clean(text)) && s.undo.length && Date.now() - s.undo.at(-1).at < 60_000 && s.undo.at(-1).at > s.foreignAt) {
    return await undoLast(s);
  }
  const cl = closingOf(text, { pending: pend.length > 0 });
  if (cl?.only) {
    if (cl.soft && pend.length) return run(text);                    // "okay" while a question waits: it's the answer
    // "no thanks" / "that's all" to a question: the question is dropped (what it asks just doesn't happen)
    if (pend.length) dropPending(surface);
    // "good night" / "bye" still reach the rest of Dayspring when an older skill owns them (the bedtime routine)
    return { reply: cl.ack, close: true, intent: "close", closing: cl.kind, changes: [] };
  }
  if (cl?.appended) text = cl.rest;
  const before = full ? snapshot() : null;
  const undoCount = s.pushes ?? 0;
  let out = await run(text);
  // what changed in the settings, the sky, the look or the permissions, by any path: "undo that" puts it back
  if (full) try { const diff = changed(before); if (diff && (s.pushes ?? 0) === undoCount) pushUndo(s, describeDiff(diff, out?.reply), () => restore(before, diff)); else if (!diff && (s.pushes ?? 0) === undoCount && out?.changes?.length && out.intent !== "undo") s.foreignAt = Date.now(); } catch { /* undo is a nicety */ }
  if (cl?.appended && out) {
    // no follow-up question: its question comes off the end, and nothing waits for an answer
    const reply = String(out.reply ?? "");
    const trimmed = reply.replace(/\s*(?:What's it for\?|Want a reminder before it\?|That sounds important\.[^?]*\?|[^.!?]*\?)\s*$/, "").trim();
    out = { ...out, reply: trimmed || reply, listen: false, suggest: out.suggest && trimmed ? undefined : out.suggest, close: true, closing: cl.kind };
    if (trimmed !== reply) dropPending(surface);
    else { try { intents.clearState(surface, ["purpose", "follow"]); } catch { /* fine */ } }
  }
  return out;
}

// ---- the stores, for "undo that" -----------------------------------------------------------------------------------------
const VOLATILE = new Set(["until", "convUntil", "calibrateAt", "voiceId", "lastWindow", "miniBounds", "persona", "after"]);
async function looksMod() { if (deps.looks) return deps.looks; try { deps.looks = await import("../looks/index.mjs"); } catch { deps.looks = false; } return deps.looks; }
let looksNow = null;
function snapshot() {
  let lk = null; try { lk = looksNow?.settings?.() ?? null; } catch { lk = null; }
  return { settings: settings.get(), owner: owner.get(), sky: sky.get(), permissions: (() => { try { const p = permissions.get(); delete p.folders; delete p.writeFiles; return p; } catch { return null; } })(), looks: lk };
}
function changed(before) {
  const after = snapshot(), diff = {};
  for (const k of ["settings", "owner", "sky", "permissions", "looks"]) {
    const a = before[k], b = after[k]; if (!a || !b) continue;
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((x) => !VOLATILE.has(x) && JSON.stringify(a[x]) !== JSON.stringify(b[x]));
    if (keys.length) diff[k] = keys;
  }
  return Object.keys(diff).length ? diff : null;
}
async function restore(before, diff) {
  if (diff.settings) { const cur = settings.get(); const next = { ...cur }; for (const k of diff.settings) { if (before.settings[k] === undefined) delete next[k]; else next[k] = before.settings[k]; } if (diff.settings.includes("mode")) { next.until = before.settings.until; next.after = before.settings.after; } settings.restore(next); bc("settings", settings.get()); if (diff.settings.includes("listenState")) bc("listenstate", { state: before.settings.listenState, from: "undo" }); }
  if (diff.owner) { owner.set(Object.fromEntries(diff.owner.map((k) => [k, before.owner[k]]))); bc("owner", {}); }
  if (diff.sky) { sky.set(Object.fromEntries(diff.sky.map((k) => [k, before.sky[k]])), "undo"); temp.cancel("sky"); }
  if (diff.permissions) permissions.set({ ...Object.fromEntries(diff.permissions.map((k) => [k, before.permissions[k]])), via: "voice undo" });
  if (diff.looks) { const l = await looksMod(); if (l) l.set(Object.fromEntries(diff.looks.map((k) => [k, before.looks[k]])), "undo"); }
}
function describeDiff(diff, reply) {
  const r = String(reply ?? "").replace(/\s*Say “undo that”.*$/, "").replace(/^(Okay|Done|Got it)[,.:!]?\s*/i, "").trim();
  if (r && r.length < 120) return r.replace(/\.$/, "");
  const keys = Object.values(diff).flat();
  return `the change to ${listSay(keys.slice(0, 3))}`;
}
async function undoLast(s) {
  const u = s.undo.pop();
  if (!u) return { reply: "There's nothing of mine to undo.", intent: "undo", changes: [] };
  try { await u.fn(); } catch (e) { return { reply: `I couldn't undo that: ${e.message}`, intent: "undo", changes: [] }; }
  return { reply: `Undone. ${cap(u.what.replace(/^(it|that)\b/i, "that"))}: back the way it was.`.replace(/: back the way it was\.$/, " is back the way it was."), intent: "undo", changes: ["settings", "update"], timers: timers.snapshot() };
}

// ---- the dry run ---------------------------------------------------------------------------------------------------------
const UNDO_RE = /^(undo|undo that|undo it|undo this|undo the last (change|thing|setting|one)|undo the (setting|change)|put it back|put that back|change it back|set it back|revert( that| it)?|take that back|go back to how it was|reverse that)$/;
export function parse(text, { now: n = now(), last = null } = {}) {
  const ld = leadOf(text);
  if (ld) text = ld.text;
  const cl = closingOf(text);
  if (cl?.only) return { intent: "close", args: { kind: cl.kind } };
  if (cl?.appended) { const inner = parse(cl.rest, { now: n, last }); return { ...(inner ?? { intent: "pass", args: {} }), closing: cl.kind }; }
  const { q } = prep(text);
  if (!q) return null;
  if (UNDO_RE.test(q)) return { intent: "undo", args: {} };
  const neg = negation(q);
  if (neg) return neg;
  const parts = splitParts(q);
  if (parts) return { intent: "compound", args: { parts } };
  const one = parseOne(q, { now: n, last });
  if (one) return one;
  return ld ? { intent: "pass", args: {}, lead: ld.why } : null;
}
// two requests at once, when each one is something Dayspring knows how to do on its own
function splitParts(q) {
  if (!/\b(and|then|also|plus)\b|;/.test(q)) return null;
  const parts = q.split(SPLIT).map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return null;
  const known = (p) => Boolean(parseOne(p) || intents.confident(p) || /^(turn|switch) (on|off) (the |my )?[a-z ]{2,30}$|^(turn|switch) (the |my )?[a-z ]{2,30} (on|off)$/.test(p) || /^(play|pause|stop|skip|resume|next|open|close|launch) \w/.test(p));
  return parts.every((p) => VERB.test(p) && p.split(" ").length >= 2 && known(p)) ? parts : null;
}
// (the sky's and the settings' words are the most particular, so they're asked before the schedule's: "make it
// night" is the sky, "make it 6pm" moves the last thing)
function parseOne(q, { now: n = now(), last = null } = {}) {
  return profile.parse(q) ?? scene.parse(q) ?? S.parse(q) ?? clock.parse(q, n) ?? sched.parse(q, { now: n, last }) ?? null;
}
// "don't remind me to …", "not tomorrow, Friday", "no, not at 5, at 6", "don't do that"
function negation(q) {
  let m;
  if ((m = /^(?:do not|dont|please do not|no do not|never mind the reminder|i do not need (?:the |a |my )?reminder)(?:\s+(?:remind me|reminder))?(?:\s+(?:to|about|of))?\s*(.*)$/.exec(q)) && /\bremind(er)?\b|^never mind the reminder|need (the |a |my )?reminder/.test(q)) return { intent: "reminder.cancel", args: { text: m[1].trim() || null } };
  if ((m = /^(?:no |nope |actually )?not (today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|this week|next week|at \S+(?: [ap] ?m)?|\d{1,2}(?::\d{2})?(?: [ap] ?m)?)[, ]*(?:(?:make it|i said|i meant|move it to|on|at|but)\s+)?(.*)$/.exec(q))) {
    return { intent: "correct", args: { not: m[1], to: m[2].trim() || null } };
  }
  if ((m = /^(?:no |actually |sorry )?(?:i said|i meant|i mean) (.+)$/.exec(q))) return { intent: "correct", args: { not: null, to: m[1].trim() } };
  if (/^(no )?(do not|dont) (do that|do it|set (it|that))$|^no no$|^no that is wrong$/.test(q)) return { intent: "undo", args: {} };
  if ((m = /^(?:do not|dont) (set|start|add|make|schedule) (?:a |an |the )?(.+)$/.exec(q))) return { intent: "noop", args: { what: `${m[1]} ${m[2]}` } };
  return null;
}

// ---- the commands --------------------------------------------------------------------------------------------------------
const SPLIT = /\s*(?:,\s*)?\b(?:and then|and also|then also|and after that|after that|also|plus|and|then)\b\s*|\s*;\s*/;
const VERB = /^(set|add|remind|make|turn|switch|cancel|delete|remove|schedule|play|pause|start|stop|move|show|hide|open|close|put|change|use|skip|snooze|wake|what|whats|how|tell|read|call|text|book|create|give|go|lock|unlock|dim|brighten|resume|clear|mark|rename|let|bring)\b/;
export async function handle(text, { surface = "tv", typed = false, part = false } = {}) {
  if (!enabled()) return null;
  if (!looksNow) looksMod().then((l) => { looksNow = l || null; }).catch(() => {});
  const s = st(surface);
  const { raw, q } = prep(text);
  if (!q) return null;
  // 1. an answer to our own question
  if (fresh(s.pending, PENDING_MS)) { const r = await answerPending(s, q, raw, surface); if (r) return r; }
  else s.pending = null;
  // 2. "undo that"
  if (UNDO_RE.test(q) && s.undo.length && Date.now() - s.undo.at(-1).at < UNDO_MS && s.undo.at(-1).at > s.foreignAt) return undoLast(s);
  // 3. corrections and "don't"
  const neg = negation(q);
  if (neg) { const r = await exec(neg, { s, raw, q, surface }); if (r) return r; }
  // 4. two requests at once
  if (!part && deps.run) { const r = await compound(raw, q, surface, typed); if (r) return r; }
  // 5. one command
  const p = parseOne(q, { now: now(), last: fresh(s.last, LAST_MS) ? s.last : null });
  if (!p) return null;
  return exec(p, { s, raw, q, surface });
}

async function compound(raw, q, surface, typed) {
  // (never inside a list or a name: "add milk and eggs", "remind me to call mom and dad", "rock and roll")
  const parts = splitParts(q);
  if (!parts) return null;
  const replies = [], outs = [];
  for (const p of parts) {
    const r = await deps.run(p, { surface, typed, part: true }).catch((e) => ({ reply: `That didn't work: ${e.message}` }));
    outs.push(r ?? {}); if (r?.reply) replies.push(r.reply.trim());
  }
  const lastOut = outs.at(-1) ?? {};
  const merged = { reply: replies.join(" "), intent: "compound", parts, changes: [...new Set(outs.flatMap((o) => o.changes ?? []))] };
  for (const o of outs) for (const k of ["timers", "clientRun", "openPage", "clientShow", "recipes", "cooking"]) if (o[k] !== undefined) merged[k] = o[k];
  if (lastOut.listen) merged.listen = true;
  return merged;
}

// ---- our own questions -------------------------------------------------------------------------------------------------------
function ask(s, pending, question) { s.pending = { ...pending, at: Date.now(), ask: question }; return { reply: question, listen: true, intent: pending.intent ?? "clarify" }; }
async function answerPending(s, q, raw, surface) {
  const p = s.pending;
  // "let me tell you about myself": each answer saved, then the next question ("skip" moves on, "stop" ends it)
  if (p.kind === "tour") {
    const step = profile.TOUR[p.step];
    if (/^(stop|done|quit|end|cancel|enough|no more|that is enough|finish|i am done|im done)$/.test(q)) { s.pending = null; return ok("Okay, that's plenty. Thanks for telling me about yourself! Say “what do you know about me?” any time.", { intent: "profile.tour", close: true }); }
    const reply = [];
    if (!/^(skip|pass|next|next one|i would rather not|id rather not|rather not|no|none|nothing|not really|i do not know|i dont know)$/.test(q)) {
      const pp = profile.parse(step.to(q)) ?? profile.parse(q);
      if (pp) { const r = await exec(pp, { s, raw, q, surface, inTour: true }); if (r?.reply) reply.push(r.reply.replace(/ Say “undo that”.*$/, "")); }
      else reply.push("I didn't catch that one, so I'll skip it.");
    }
    const next = p.step + 1;
    if (next >= profile.TOUR.length) { s.pending = null; reply.push("That's everything. Thanks! Say “what do you know about me?” any time."); return ok(reply.join(" "), { intent: "profile.tour", changes: ["settings"] }); }
    s.pending = { ...p, step: next, at: Date.now(), ask: profile.TOUR[next].ask };
    reply.push(profile.TOUR[next].ask);
    return ok(reply.join(" "), { intent: "profile.tour", listen: true, changes: ["settings"] });
  }
  if (/^(no|nope|nah|cancel|never ?mind|forget it|stop|leave it|do not|dont|not now)\b/.test(q) && p.kind === "confirm") { s.pending = null; return { reply: "Okay, I left it alone.", intent: "confirm.no", changes: [] }; }
  if (p.kind === "confirm") {
    if (/^(yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|confirm|confirmed|please do|correct|that is right|absolutely|yes please|i am sure|im sure)\b/.test(q)) { s.pending = null; return p.yes(); }
    s.pending = null; return null;                  // something else: the change doesn't happen, and this is handled normally
  }
  if (/^(never ?mind|cancel|forget it|stop|no|nothing)$/.test(q)) { s.pending = null; return { reply: "Okay, never mind.", intent: "clarify.cancel", close: true, changes: [] }; }
  // a whole new request instead of an answer
  const fresh1 = parseOne(q);
  if ((fresh1 && q.split(" ").length > 3) || (q.split(" ").length > 4 && intents.confident(q))) { s.pending = null; return null; }
  const a = { ...p.args };
  if (p.need === "time" || p.need === "when") {
    const w = when(/^\d/.test(q) ? `at ${q}` : q, now());
    if (!w.time && !w.date) { s.pending = null; return null; }
    if (w.time) { a.time = w.time; a.loose = !w.explicit; } if (w.date) a.date = w.date;
    if (p.need === "when" && !a.time) return ask(s, { ...p, args: a, need: "time" }, `What time on ${sayDate(a.date, now())}?`);
  } else if (p.need === "ampm") {
    const pm = /\b(pm|p m|evening|night|afternoon|tonight)\b/.test(q), am = /\b(am|a m|morning)\b/.test(q);
    if (!pm && !am) { s.pending = null; return null; }
    const [h, mi] = a.time.split(":").map(Number); const h12 = h % 12;
    a.time = `${String(pm ? h12 + 12 : h12).padStart(2, "0")}:${String(mi).padStart(2, "0")}`; a.loose = false; a.ampmAsked = true;
  } else if (p.need === "title") { a.title = keepCase(raw, q.replace(/^(it is|its|it s|call it|the title is|a|an|the)\s+/, "")); a.needTitle = false; }
  else if (p.need === "text") { a.text = q.replace(/^(to|about|that)\s+/, ""); a.needText = false; }
  else if (p.need === "repeat") { const r = repeatIn(q, now()) ?? repeatIn(`every ${q}`, now()); if (!r) { s.pending = null; return null; } a.repeat = r.repeat; }
  s.pending = null;
  return exec({ intent: p.intent, args: a }, { s, raw, q, surface, answered: true });
}

// ---- doing it --------------------------------------------------------------------------------------------------------------
const nowHM = () => { const d = now(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const todayIso = () => isoOf(now());
const say = (hm) => sayTime(hm);
const ok = (reply, extra = {}) => ({ reply, changes: [], ...extra });

async function exec(p, ctx) {
  const { s, raw, surface } = ctx;
  const a = p.args ?? {};
  switch (p.intent) {
    // ---- settings ----
    case "setting.set": case "setting.adjust": case "setting.reset": case "setting.get": case "setting.toggle": {
      const e = S.byId.get(a.id);
      if (e?.type === "text" && typeof a.value === "string") p = { ...p, args: { ...a, value: keepCase(raw, a.value) } };
      if (e?.special === "listen" && p.intent === "setting.set") return listenSet(s, a);
      if (e?.id === "mode" && p.intent === "setting.set" && (a.minutes || a.until)) {
        const mins = a.minutes ?? minutesUntil(a.until, a.untilAmbiguous);
        const out = settings.set({ mode: a.value, minutes: mins }); bc("settings", out);
        return ok(`Okay, notifications are ${S.say(e, a.value)} until ${say(hmIn(mins))}.`, { intent: p.intent, changes: ["settings"] });
      }
      const pl = S.plan(p);
      if (pl.refused || (!pl.apply && pl.reply)) return ok(pl.reply, { intent: p.intent });
      if (pl.confirm) {
        return ask(s, { kind: "confirm", intent: p.intent, yes: () => { const v = pl.apply(); afterSetting(e); return ok(pl.done(v), { intent: p.intent, changes: ["settings"], security: true }); } }, pl.confirm);
      }
      const v = pl.apply();
      afterSetting(e);
      return ok(`${pl.done(v)} Say “undo that” to change it back.`, { intent: p.intent, changes: ["settings"] });
    }
    // ---- the sky and the window ----
    case "ui.window": {
      if (a.client) return ok("Okay.", { intent: p.intent, clientRun: a.canon });
      const wr = await import("../window-routes.mjs");
      const r = await wr.command(a.canon).catch((err) => `I couldn't do that: ${err.message}`);
      return r ? ok(r, { intent: p.intent }) : null;
    }
    case "sky.status": case "sky.on": case "sky.real": case "sky.motion": case "sky.preset": case "sky.element": case "sky.amount": case "sky.scene": case "sky.weather": case "sky.weatherOff": case "sky.phase": case "sky.season": case "sky.colors": {
      const pl = scene.plan(p);
      if (!pl) return null;
      if (!pl.patch && !pl.preset) return ok(pl.reply, { intent: p.intent });
      const cur = sky.get();
      if (pl.minutes) {
        const back = pl.preset ? structuredClone(cur) : scene.before(pl.patch, cur);
        if (pl.preset) sky.applyPreset(pl.preset, "voice"); else sky.set(pl.patch, "voice");
        temp.add({ kind: "sky", what: p.intent, restore: back, until: Date.now() + pl.minutes * 60_000 });
      } else {
        temp.cancel("sky");
        if (pl.preset) sky.applyPreset(pl.preset, "voice"); else sky.set(pl.patch, "voice");
      }
      return ok(pl.reply, { intent: p.intent, changes: ["sky"] });
    }
    // ---- alarms ----
    case "alarm.create": return alarmCreate(s, a);
    case "alarm.list": return alarmList(a);
    case "alarm.onoff": return alarmOnOff(s, a);
    case "alarm.delete": return alarmDelete(s, a);
    case "alarm.skip": return alarmSkip(s, a);
    case "alarm.change": return alarmChange(s, a);
    // ---- timers to a clock time, and "every 30 minutes" ----
    case "timer.until": {
      let hm = a.hm, date = todayIso();
      if (a.loose) ({ hm, date } = soonest(hm, now()));
      const [h, mi] = hm.split(":").map(Number), [y, mo, d] = date.split("-").map(Number);
      let at = new Date(y, mo - 1, d, h, mi, 0, 0); if (at <= now()) at = new Date(at.getTime() + 86_400_000);
      const ms = at - now();
      const r = timers.start({ ms, label: a.label || `until ${sayTime(hm).replace(/\./g, "")}` });
      if (r.full) return ok(`You already have ${timers.MAX} timers running. Cancel one first.`, { intent: p.intent });
      setLast(s, { kind: "timer", id: r.timer.id, title: r.timer.label });
      pushUndo(s, `the timer until ${say(hm)}`, () => timers.cancel(r.timer.id));
      return ok(`Timer set until ${say(hm)}${sayDate(isoOf(at), now()) !== "today" ? ` ${sayDate(isoOf(at), now())}` : ""}: that's ${sayDuration(Math.round(ms / 60_000) * 60_000)} from now.`, { intent: p.intent, timers: timers.snapshot() });
    }
    case "timer.cancel": {
      const list = timers.list();
      if (!list.length) return ok("You don't have any timers running.", { intent: p.intent });
      // "cancel the timer" with several: the newest one (the one just set), said by name
      const r = timers.cancel(a.ref || "");
      if (!r.length) return ok(`I don't see a ${a.ref} timer. You have ${listSay(list.map((t) => t.label))}.`, { intent: p.intent });
      return ok(`Cancelled ${r.length > 1 ? `${r.length} timers` : `the ${r[0].label} timer`.replace(/the (Timer \d+) timer/i, "$1")}.`, { intent: p.intent, timers: timers.snapshot() });
    }
    case "every.start": {
      const text = a.text.replace(/^(to|about) /, "");
      const r = timers.start({ ms: a.ms, label: text, every: a.ms });
      if (r.full) return ok(`You already have ${timers.MAX} timers and repeating reminders going. Cancel one first.`, { intent: p.intent });
      setLast(s, { kind: "every", id: r.timer.id, title: text });
      pushUndo(s, `the reminder to ${text} every ${sayDuration(a.ms)}`, () => timers.cancel(r.timer.id));
      return ok(`Okay, I'll remind you to ${text} every ${sayDuration(a.ms).replace(/^1 (hour|minute)$/, "$1")}. Say “stop reminding me to ${text}” when you're done.`, { intent: p.intent, timers: timers.snapshot() });
    }
    case "every.stop": {
      const w = a.text.toLowerCase().split(" ").filter((x) => x.length > 2);
      const hit = timers.list().filter((t) => w.length && w.every((x) => t.label.toLowerCase().includes(x)));
      const al = timers.alarms().filter((x) => x.kind === "reminder" && w.length && w.every((y) => x.label.toLowerCase().includes(y)));
      for (const t of hit) timers.cancel(t.id);
      for (const x of al) timers.cancelAlarm(x.id);
      if (!hit.length && !al.length) return ok(`I don't have a repeating reminder about ${a.text}.`, { intent: p.intent });
      return ok(`Okay, no more reminders to ${hit[0]?.label ?? al[0]?.label}.`, { intent: p.intent, timers: timers.snapshot() });
    }
    // ---- reminders ----
    case "reminder.create": return reminderCreate(s, a, raw);
    case "reminder.cancel": return reminderCancel(s, a);
    // ---- the schedule ----
    case "sched.create": return schedCreate(s, a, raw, ctx);
    case "sched.move": return schedMove(s, a);
    case "sched.cancel": return schedCancel(s, a);
    case "sched.recur": return schedRecur(s, a);
    case "sched.norecur": return schedNoRecur(s, a);
    // ---- you: your name, where you live, what you like (lib/commands/profile.mjs) ----
    case "profile.tour": return ask(s, { kind: "tour", step: 0, intent: "profile.tour" }, `Okay! I'll ask a few quick questions. Say “skip” to skip one, or “stop” when you're done. ${profile.TOUR[0].ask}`);
    case "profile.whoami": case "profile.where": case "profile.here": case "profile.about": case "profile.name": case "profile.nickname": case "profile.location": case "profile.birthday": case "profile.fact": case "profile.interest": case "profile.dislike": case "profile.forget": {
      const r = await profile.run(p, { geocode: (x) => geocode(x), keepCase: (w) => keepCase(raw, w), ask: (pending, question) => (ctx.inTour ? null : ask(s, pending, question)), undo: (what, fn) => pushUndo(s, what, fn), changed: () => bc("owner", {}) });
      if (!r) return null;
      if (r.reply && ["profile.name", "profile.nickname", "profile.location", "profile.birthday", "profile.fact", "profile.interest", "profile.dislike", "profile.forget"].includes(p.intent)) { bc("owner", {}); return { ...ok(r.reply, { intent: p.intent, changes: ["settings"] }), ...r }; }
      return { ...ok(r.reply, { intent: p.intent }), ...r };
    }
    // ---- the conversation ----
    case "correct": return correct(s, a);
    case "undo": return undoLast(s);
    case "noop": return ok("Okay, I won't.", { intent: "noop" });
    case "close": return ok("Okay!", { close: true, intent: "close" });
  }
  return null;
}
function afterSetting(e) {
  if (!e) return;
  if (["settings", "overlay"].includes(e.store)) bc("settings", settings.get());
  if (["owner", "features"].includes(e.store)) { bc("owner", {}); bc("refresh", { reason: "settings" }); }
}
const hmIn = (mins) => { const d = new Date(now().getTime() + mins * 60_000); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
function minutesUntil(hm, loose) {
  let t = hm; if (loose) t = soonest(hm, now()).hm;
  const [h, m] = t.split(":").map(Number), d = new Date(now()); d.setHours(h, m, 0, 0); if (d <= now()) d.setDate(d.getDate() + 1);
  return Math.max(1, Math.round((d - now()) / 60_000));
}
async function listenSet(s, a) {
  const quiet = await import("../quiet.mjs");
  const before = quiet.state();
  const r = await quiet.setState(a.value, { from: "voice" });
  if (a.minutes || a.until) {
    const mins = a.minutes ?? minutesUntil(a.until, a.untilAmbiguous);
    temp.add({ kind: "listen", what: "listening", restore: { state: before }, until: Date.now() + mins * 60_000 });
    return ok(`${r.text.replace(/\.$/, "")} until ${say(hmIn(mins))}. Then I'll go back to ${before === "active" ? "normal" : before}.`, { intent: "setting.set", changes: ["settings"] });
  }
  temp.cancel("listen");
  return ok(r.text, { intent: "setting.set", changes: ["settings"] });
}

// ---- alarms ----
function alarmCreate(s, a) {
  if (a.needTime) return ask(s, { kind: "clarify", intent: "alarm.create", args: { ...a, needTime: false }, need: "time" }, "What time should the alarm go off?");
  let hm = a.time ?? a.hm, date = a.date;
  if (a.loose && !date) ({ hm, date } = soonest(hm, now()));
  const opts = Object.fromEntries(["sound", "volume", "snooze", "gentle", "flash"].filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
  const repeat = a.days ? { days: a.days } : a.rule ? { rule: a.rule } : null;
  const al = timers.setAlarm({ date: repeat ? null : date, hm, label: a.label ?? "", kind: "alarm", repeat, ...opts });
  setLast(s, { kind: "alarm", id: al.id, title: al.label || say(hm) });
  pushUndo(s, `the ${say(hm)} alarm`, () => timers.cancelAlarm(al.id));
  return ok(`Alarm set for ${clock.alarmWhen(al, now())}${clock.alarmExtras(al)}.${repeat ? ` The next one is ${sayDate(isoOf(new Date(al.at)), now())}.` : ""}`, { intent: "alarm.create", timers: timers.snapshot() });
}
function pickAlarms(s, f) {
  const all = timers.alarms();
  let hit = clock.matchAlarms(all, f, now());
  if (!Object.keys(f).length || (Object.keys(f).length === 1 && f.hmLoose === undefined && f.all === undefined && !f.hm && !f.days && !f.date && !f.label && !f.next)) {
    const mine = fresh(s.last, LAST_MS) && s.last.kind === "alarm" ? all.filter((x) => x.id === s.last.id) : [];
    const only = all.filter((x) => (x.kind ?? "alarm") === "alarm");
    hit = f.all ? only : mine.length ? mine : only;
  }
  return hit;
}
function alarmList(a) {
  const all = timers.alarms().filter((x) => (x.kind ?? "alarm") === "alarm");
  const list = Object.keys(a.filter ?? {}).length ? clock.matchAlarms(all, a.filter, now()) : all;
  const morning = settings.get().alarm;
  if (!list.length) return ok(`You don't have any alarms set${Object.keys(a.filter ?? {}).length ? " like that" : ""}.${morning ? " The morning alarm is on, though: it rings before your day's first thing." : ""}`, { intent: "alarm.list" });
  return ok(`You have ${list.length === 1 ? "one alarm" : `${list.length} alarms`}: ${list.map((x) => `${clock.alarmWhen(x, now())}${x.label ? `, ${x.label}` : ""}${x.off ? " (off)" : ""}`).join("; ")}.`, { intent: "alarm.list" });
}
function alarmOnOff(s, a) {
  const hit = pickAlarms(s, a.filter);
  if (!hit.length) {
    const noFilter = !Object.keys(a.filter ?? {}).some((k) => ["hm", "days", "label", "date"].includes(k));
    if (noFilter && !timers.alarms().some((x) => (x.kind ?? "alarm") === "alarm")) {        // "turn off my alarm" with only the morning alarm
      const before = settings.get().alarm;
      if (before === !a.on) return ok(`The morning alarm is already ${a.on ? "on" : "off"}.`, { intent: "alarm.onoff" });
      bc("settings", settings.set({ alarm: a.on }));
      return ok(`The morning alarm is ${a.on ? "on" : "off"}. Say “undo that” to change it back.`, { intent: "alarm.onoff", changes: ["settings"] });
    }
    return ok("I couldn't find an alarm like that. Say “what alarms do I have” to hear them.", { intent: "alarm.onoff" });
  }
  const prev = hit.map((x) => structuredClone(timers.alarmById(x.id)));
  for (const x of hit) timers.updateAlarm(x.id, { off: !a.on });
  pushUndo(s, `switching ${hit.length === 1 ? "that alarm" : "those alarms"} ${a.on ? "on" : "off"}`, () => prev.forEach((x) => timers.restoreAlarm(x)));
  return ok(`${a.on ? "Turned on" : "Turned off"} ${hit.length === 1 ? clock.nameOf(hit[0], now()) : `${hit.length} alarms: ${listSay(hit.map((x) => clock.alarmWhen(x, now())))}`}.${a.on ? "" : " They're kept, so you can turn them back on."}`, { intent: "alarm.onoff", timers: timers.snapshot() });
}
function alarmDelete(s, a) {
  const hit = pickAlarms(s, a.filter);
  if (!hit.length) return ok("There's no alarm like that.", { intent: "alarm.delete" });
  if (hit.length > 1 && !a.filter.all && !a.filter.days && !a.filter.label) return ask(s, { kind: "confirm", intent: "alarm.delete", yes: () => doDelete(s, hit) }, `You have ${hit.length} alarms: ${listSay(hit.map((x) => clock.alarmWhen(x, now())))}. Delete all of them? Say yes, or say which one.`);
  return doDelete(s, hit);
}
function doDelete(s, hit) {
  const prev = hit.map((x) => structuredClone(timers.alarmById(x.id)));
  for (const x of hit) timers.cancelAlarm(x.id);
  pushUndo(s, `deleting ${hit.length === 1 ? "that alarm" : "those alarms"}`, () => prev.forEach((x) => timers.restoreAlarm(x)));
  return ok(`Deleted ${hit.length === 1 ? clock.nameOf(hit[0], now()) : `${hit.length} alarms`}. Say “undo that” to bring ${hit.length === 1 ? "it" : "them"} back.`, { intent: "alarm.delete", timers: timers.snapshot() });
}
function alarmSkip(s, a) {
  const n = now(); let date;
  if (a.day === "tomorrow") date = isoOf(new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1));
  else if (a.day === "today" || a.day === "tonight") date = isoOf(n);
  else if (a.day === "next") { const nx = timers.alarms().filter((x) => (x.kind ?? "alarm") === "alarm" && !x.off)[0]; if (!nx) return ok("You don't have an alarm coming up.", { intent: "alarm.skip" }); date = isoOf(new Date(nx.at)); }
  else { const w = when(a.day, n); date = w.date; }
  const prev = timers.alarms().map((x) => structuredClone(x));
  const r = timers.skipAlarms(date);
  if (!r.length) return ok(`You don't have an alarm ${sayDate(date, n)}.`, { intent: "alarm.skip" });
  pushUndo(s, `skipping ${sayDate(date, n)}'s alarm`, () => { for (const x of prev) if (r.some((y) => y.id === x.id)) timers.restoreAlarm(x); });
  return ok(`Okay, no alarm ${sayDate(date, n)}: I'll skip ${r.length === 1 ? clock.nameOf({ ...r[0], repeat: null, at: r[0].skippedAt ?? r[0].at }, n) : `${r.length} alarms`}.${r.some((x) => x.repeat) ? " It rings again as usual after that." : ""}`, { intent: "alarm.skip", timers: timers.snapshot() });
}
function alarmChange(s, a) {
  const hit = pickAlarms(s, a.filter);
  // "set my alarm for 6 in the morning" with no alarm yet: a new one
  if (!hit.length && a.hm && !Object.keys(a.filter ?? {}).some((k) => ["hm", "label", "days"].includes(k))) return alarmCreate(s, { hm: a.hm, loose: a.loose, label: a.label ?? "", ...Object.fromEntries(["sound", "volume", "snooze", "gentle", "flash"].filter((k) => a[k] !== undefined).map((k) => [k, a[k]])) });
  if (!hit.length) return ok("I couldn't find that alarm. Say “what alarms do I have” to hear them.", { intent: "alarm.change" });
  if (hit.length > 1 && !a.filter.days) return ok(`Which one? You have ${listSay(hit.map((x) => clock.alarmWhen(x, now())))}. Say the time, like “change my ${sayTime(hit[0].hm).replace(/ [ap]\.m\./, "")} alarm to …”.`, { intent: "alarm.change" });
  const prev = hit.map((x) => structuredClone(timers.alarmById(x.id)));
  const patch = {};
  if (a.hm) { let hm = a.hm; if (a.loose) { const h = Number(hm.slice(0, 2)); const old = Number(hit[0].hm.slice(0, 2)); if (old < 12 && h >= 12) hm = `${String(h - 12).padStart(2, "0")}${hm.slice(2)}`; } patch.hm = hm; }
  for (const k of ["sound", "snooze", "gentle", "flash", "label"]) if (a[k] !== undefined) patch[k] = a[k];
  if (a.volume !== undefined) patch.volume = a.volume;
  const out = [];
  for (const x of hit) { const p2 = { ...patch }; if (a.volumeDelta) p2.volume = Math.max(20, Math.min(100, (x.volume ?? settings.get().alarmVolume ?? 100) + a.volumeDelta)); out.push(timers.updateAlarm(x.id, p2)); }
  pushUndo(s, "the alarm change", () => prev.forEach((x) => timers.restoreAlarm(x)));
  return ok(`Done. ${cap(out.length === 1 ? `the alarm is now ${clock.alarmWhen(out[0], now())}${clock.alarmExtras(out[0])}` : `${out.length} alarms changed`)}.`, { intent: "alarm.change", timers: timers.snapshot() });
}

// ---- reminders ----
async function reminderCreate(s, a, raw) {
  if (a.needText) return ask(s, { kind: "clarify", intent: "reminder.create", args: a, need: "text" }, "What should I remind you about?");
  const text = keepCase(raw, a.text).replace(/^./, (c) => c.toLowerCase()).replace(/\bi\b/g, "I");
  if (a.repeat) {
    const r = a.repeat;
    const simple = r.freq === "weekly" && (r.interval ?? 1) === 1 && !r.until && !r.start && !r.exceptHolidays && r.days?.length;
    const daily = r.freq === "daily" && (r.interval ?? 1) === 1 && !r.until && !r.start && !r.exceptHolidays;
    const DN = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    const repeat = simple ? { days: r.days.map((d) => DN[d]).sort() } : daily ? { days: [0, 1, 2, 3, 4, 5, 6] } : { rule: r };
    const al = timers.setAlarm({ hm: a.time, label: text, kind: "reminder", repeat });
    setLast(s, { kind: "reminder", id: al.id, title: text, alarm: true });
    pushUndo(s, `the reminder to ${text}`, () => timers.cancelAlarm(al.id));
    const how = repeat.days ? clock.daysSay(repeat.days) : describeRepeat(r).replace(/^./, (c) => c.toLowerCase());
    return ok(`Okay, I'll remind you to ${text} ${how} at ${say(a.time)}.${repeat.rule ? ` The first one is ${sayDate(isoOf(new Date(al.at)), now())}.` : ""}`, { intent: "reminder.create", changes: ["update"] });
  }
  let hm = a.time, date = a.date;
  if (a.loose && !date) ({ hm, date } = soonest(hm, now()));
  if (!date) date = hm <= nowHM() ? isoOf(new Date(now().getTime() + 86_400_000)) : todayIso();
  const r = reminders.add({ date, time: hm, text });
  setLast(s, { kind: "reminder", id: r.id, title: text, date, time: hm });
  pushUndo(s, `the reminder to ${text}`, () => { try { reminders.cancel(r.id); } catch { /* gone */ } });
  const d = sayDate(date, now());
  return ok(`Okay, I'll remind you to ${text} ${d === "today" ? "today" : d} at ${say(hm)}. Just once.`, { intent: "reminder.create", changes: ["update"] });
}
function reminderCancel(s, a) {
  let text = a.text;
  if (!text && fresh(s.last, LAST_MS) && ["reminder", "every"].includes(s.last.kind)) text = s.last.title;
  if (!text) return ok("Which reminder? Say “don't remind me to” and what it was.", { intent: "reminder.cancel" });
  const w = text.toLowerCase().replace(/^(to|about) /, "").split(" ").filter((x) => x.length > 2);
  const found = [];
  for (const r of reminders.upcoming(100)) if (w.every((x) => r.text.toLowerCase().includes(x))) { try { reminders.cancel(r.id); found.push(r.text); } catch { /* gone */ } }
  for (const x of timers.alarms()) if (x.kind === "reminder" && w.every((y) => x.label.toLowerCase().includes(y))) { timers.cancelAlarm(x.id); found.push(x.label); }
  for (const t of timers.list()) if (w.every((y) => t.label.toLowerCase().includes(y))) { timers.cancel(t.id); found.push(t.label); }
  if (!found.length) return ok(`You don't have a reminder about ${text.replace(/^(to|about) /, "")}.`, { intent: "reminder.cancel" });
  return ok(`Okay, I won't remind you to ${text.replace(/^(to|about) /, "")}.${found.length > 1 ? ` (That was ${found.length} reminders.)` : ""}`, { intent: "reminder.cancel", changes: ["update"], timers: timers.snapshot() });
}

// ---- the schedule ----
function schedCreate(s, a, raw, ctx) {
  if (a.needTitle) return ask(s, { kind: "clarify", intent: "sched.create", args: { ...a, needTitle: false }, need: "title" }, "What should I call it?");
  const title = keepCase(raw, a.title);
  if (!a.time) return ask(s, { kind: "clarify", intent: "sched.create", args: { ...a, title: a.title }, need: a.date ? "time" : "when" }, a.date ? `What time on ${sayDate(a.date, now())}?` : `When is ${title}? Say a day and a time.`);
  // a repeating one at a bare "9": a.m. or p.m.? (it'll be on the schedule every time, so it's worth one question)
  // (1 to 6 is afternoon for an event, the usual reading; 7 to 11 could be either)
  if (a.repeat && a.loose && !a.ampmAsked && Number(a.time.slice(0, 2)) % 12 >= 7) { const h = Number(a.time.slice(0, 2)) % 12 || 12; return ask(s, { kind: "clarify", intent: "sched.create", args: a, need: "ampm" }, `Is that ${h} a.m. or ${h} p.m.?`); }
  const minutes = a.minutes ?? sched.defaultMinutes(title);
  let start = a.time, soon = null;
  // "add a meeting at quarter to 9" said at 2 p.m., no day: tonight's 8:45, the next one to come round
  if (a.loose && !a.date && !a.repeat) { soon = soonest(start, now()); start = soon.hm; }
  const end = sched.toHM(Math.min(sched.toMin(start) + minutes, 23 * 60 + 59));
  if (end <= start) return ok(`I couldn't fit ${title} in before midnight. Try an earlier time.`, { intent: "sched.create" });
  if (a.repeat) {
    const from = a.date ?? (a.repeat.start ?? todayIso());
    const r = store.addRoutine({ title, start, end, category: sched.category(title), repeat: { ...a.repeat, start: a.repeat.start ?? from } });
    if (sched.recur.occursOn(r, todayIso()) && start > nowHM()) store.applyRoutines(todayIso());
    setLast(s, { kind: "routine", routineId: r.id, title: r.title });
    pushUndo(s, `adding ${r.title}`, () => { try { store.removeRoutine(r.id, { future: true }); } catch { /* gone */ } });
    const first = nextOccurrence(r);
    return ok(`Added ${r.title}, ${r.repeatText.replace(/^./, (c) => c.toLowerCase())} at ${say(start)}${minutes !== 30 ? ` for ${sayDuration(minutes * 60_000)}` : ""}.${first ? ` The first one is ${sayDate(first, now())}.` : ""}`, { intent: "sched.create", changes: ["update"] });
  }
  let date = a.date ?? soon?.date;
  if (!date) date = start < nowHM() ? store.addDays(todayIso(), 1) : todayIso();
  if (date < todayIso()) return ok(`${cap(sayDate(date, now()))} has already gone by. Which day did you mean?`, { intent: "sched.create" });
  const r = store.addBlock({ date, start, end, title, category: sched.category(title), source: "manual" });
  setLast(s, { kind: "block", id: r.block.id, title: r.block.title, date });
  pushUndo(s, `adding ${r.block.title}`, () => { try { store.removeBlock(r.block.id); } catch { /* gone */ } });
  try { offline.askReminderFor(r.block.id); } catch { /* fine */ }
  return ok(`Added ${r.block.title}, ${sched.whenSay(date, start, now())}${minutes !== 30 ? ` for ${sayDuration(minutes * 60_000)}` : ""}.${r.conflicts?.length ? ` Heads up: it overlaps ${listSay(r.conflicts.map((c) => c.title))}.` : ""} Want a reminder before it?`, { intent: "sched.create", changes: ["update"], listen: true });
}
function nextOccurrence(r) { for (let i = 0; i < 400; i++) { const d = store.addDays(todayIso(), i); if (sched.recur.occursOn(r, d) && (i > 0 || r.start > nowHM())) return d; } return null; }
function resolve(s, ref, date = null, time = null) {
  const last = fresh(s.last, LAST_MS) ? s.last : null;
  return sched.findBlock(ref, { date, time, last, now: now() });
}
function schedMove(s, a) {
  const f = resolve(s, a.ref);
  if (!f) return null;                                                    // not on the schedule: something else may know it
  let time = a.time;
  if (f.routine || (a.series && f.block?.routineId)) {
    const ro = f.routine ?? store.routines().find((x) => x.id === f.block.routineId);
    const prev = structuredClone(ro);
    const t = time ?? ro.start, dur = sched.toMin(ro.end) - sched.toMin(ro.start);
    if (time && a.loose && Number(ro.start.slice(0, 2)) >= 12 !== Number(time.slice(0, 2)) >= 12 && Number(time.slice(0, 2)) % 12 !== 0) time = sched.toHM((sched.toMin(time) + 12 * 60) % (24 * 60));
    const r = store.updateRoutine(ro.id, { start: time ?? ro.start, end: sched.toHM(Math.min(sched.toMin(time ?? t) + dur, 23 * 60 + 59)) });
    setLast(s, { kind: "routine", routineId: r.id, title: r.title });
    pushUndo(s, `moving ${r.title}`, () => store.updateRoutine(prev.id, { start: prev.start, end: prev.end }));
    return ok(`Moved ${r.title}: it's ${r.repeatText.replace(/^./, (c) => c.toLowerCase())} at ${say(r.start)} now.`, { intent: "sched.move", changes: ["update"] });
  }
  let b = f.block;
  if (b.projected) b = store.materialize(b.id);
  const prev = { ...b };
  const dur = sched.toMin(b.end) - sched.toMin(b.start);
  // "move my 3pm to 4": 4 p.m. (the same half of the day unless it says otherwise)
  if (time && a.loose) { const was = Number(b.start.slice(0, 2)) >= 12, is = Number(time.slice(0, 2)) >= 12; if (was !== is && Number(time.slice(0, 2)) % 12 !== 0 && Number(time.slice(0, 2)) <= 12) time = sched.toHM((sched.toMin(time) + 12 * 60) % (24 * 60)); }
  const start = time ?? b.start;
  const r = store.updateBlock(b.id, { date: a.date ?? b.date, start, end: sched.toHM(Math.min(sched.toMin(start) + dur, 23 * 60 + 59)) });
  setLast(s, { kind: "block", id: r.block.id, title: r.block.title, date: r.block.date });
  pushUndo(s, `moving ${r.block.title}`, () => store.updateBlock(prev.id, { date: prev.date, start: prev.start, end: prev.end }));
  return ok(`Moved ${r.block.title} to ${sched.whenSay(r.block.date, r.block.start, now())}${prev.routineId || prev.source === "routine" ? " (just that day)" : ""}.${r.conflicts?.length ? ` It now overlaps ${listSay(r.conflicts.map((c) => c.title))}.` : ""}`, { intent: "sched.move", changes: ["update"] });
}
function schedCancel(s, a) {
  const f = resolve(s, a.ref, a.date, a.time);
  if (!f) return null;
  if (f.routine) return schedNoRecur(s, { ref: "it" });
  const b = f.block;
  if (b.projected) {
    store.skipRoutineDay(b.date, b.title);
    pushUndo(s, `cancelling ${b.title} on ${sayDate(b.date, now())}`, () => store.unskipRoutineDay(b.date, b.title));
    setLast(s, { kind: "routine", routineId: b.routineId, title: b.title });
    return ok(`Cancelled ${b.title} ${sayDate(b.date, now())} (just that one; it repeats ${String(b.repeatText ?? "").replace(/^./, (c) => c.toLowerCase())}). Say “cancel all ${b.title.toLowerCase()}” to stop the whole series.`, { intent: "sched.cancel", changes: ["update"] });
  }
  const removed = store.removeBlock(b.id);
  pushUndo(s, `cancelling ${b.title}`, () => { store.addBlock({ ...removed, source: removed.source === "routine" ? "manual" : removed.source }); if (removed.source === "routine") store.unskipRoutineDay(removed.date, removed.title); });
  return ok(`Cancelled ${b.title} ${sayDate(b.date, now())} at ${say(b.start)}.${b.routineId || b.source === "routine" ? " The rest of the series stays." : ""} Say “undo that” to put it back.`, { intent: "sched.cancel", changes: ["update"] });
}
function schedRecur(s, a) {
  const f = resolve(s, a.ref);
  if (!f) return ok(a.ref && !/^(it|that|this)$/.test(a.ref) ? `I couldn't find ${a.ref} on the schedule.` : "Which item? Say its name, like “make gym repeat every Monday”.", { intent: "sched.recur" });
  if (!a.repeat) return ask(s, { kind: "clarify", intent: "sched.recur", args: a, need: "repeat" }, `How often should ${(f.routine ?? f.block).title} repeat? For example every week, every weekday, or every other Tuesday.`);
  if (f.routine || f.block?.routineId) {
    const ro = f.routine ?? store.routines().find((x) => x.id === f.block.routineId);
    const prev = structuredClone(ro);
    const rep = { ...a.repeat, start: ro.repeat?.start ?? todayIso() };
    if (rep.freq === "weekly" && !rep.days?.length) rep.days = ro.repeat?.days?.length ? ro.repeat.days : ro.days;
    const r = store.updateRoutine(ro.id, { repeat: rep });
    setLast(s, { kind: "routine", routineId: r.id, title: r.title });
    pushUndo(s, `the change to ${r.title}`, () => store.updateRoutine(prev.id, { repeat: prev.repeat }));
    return ok(`Done. ${r.title} now repeats ${r.repeatText.replace(/^./, (c) => c.toLowerCase())}.`, { intent: "sched.recur", changes: ["update"] });
  }
  let b = f.block; if (b.projected) b = store.materialize(b.id);
  const rep = { ...a.repeat };
  if (rep.freq === "weekly" && !rep.days?.length) rep.days = [store.weekdayOf(b.date)];
  const r = store.makeRecurring(b.id, rep);
  setLast(s, { kind: "routine", routineId: r.id, title: r.title });
  pushUndo(s, `making ${r.title} repeat`, () => { try { store.endRoutine(r.id, store.addDays(b.date, 1)); } catch { /* gone */ } });
  return ok(`Done. ${r.title} now repeats ${r.repeatText.replace(/^./, (c) => c.toLowerCase())} at ${say(r.start)}.`, { intent: "sched.recur", changes: ["update"] });
}
function schedNoRecur(s, a) {
  const f = resolve(s, a.ref);
  const ro = f?.routine ?? (f?.block?.routineId ? store.routines().find((x) => x.id === f.block.routineId) : null) ?? (f?.block?.source === "routine" ? store.routines().find((x) => x.title === f.block.title) : null);
  if (!ro) return f ? ok(`${f.block.title} doesn't repeat.`, { intent: "sched.norecur" }) : null;
  // the next one stays (it's what was just planned); none after it
  const next = nextOccurrence(ro) ?? todayIso();
  const prev = structuredClone(ro);
  store.endRoutine(ro.id, store.addDays(next, 1));
  setLast(s, { kind: "routine", routineId: ro.id, title: ro.title });
  pushUndo(s, `stopping ${ro.title}`, () => store.updateRoutine(prev.id, { repeat: prev.repeat }));
  return ok(`Okay, ${ro.title} won't repeat after ${sayDate(next, now())}. Past days stay on the history.`, { intent: "sched.norecur", changes: ["update"] });
}
async function correct(s, a) {
  const last = fresh(s.last, LAST_MS) ? s.last : null;
  if (!last) return null;
  if (!a.to) return ask(s, { kind: "clarify", intent: "sched.move", args: { ref: "it" }, need: "when" }, "Okay. When should it be instead?");
  const w = when(a.to, now());
  if (!w.date && !w.time && /^\d{1,2}$/.test(a.to)) Object.assign(w, when(`at ${a.to}`, now()));
  if (!w.date && !w.time) return null;
  if (last.kind === "block" || last.kind === "routine") return schedMove(s, { ref: "it", date: w.date, time: w.time, loose: !w.explicit });
  if (last.kind === "alarm") return alarmChange(s, { filter: {}, hm: w.time ?? undefined, loose: !w.explicit });
  if (last.kind === "reminder" && !last.alarm) {
    try { reminders.cancel(last.id); } catch { /* gone */ }
    return reminderCreate(s, { text: last.title, time: w.time ?? last.time, date: w.date ?? (w.time ? null : last.date), loose: !w.explicit }, last.title);
  }
  return null;
}

// "stop" / "that's enough" on the screen (public/tv.js cut the speech itself): whatever question or guided flow was
// waiting ends here too, and the floor is let go at once. Listening is never switched off by it.
export async function stopNow(surface = "tv") {
  const pending = anyPending(surface);
  dropPending(surface);
  try { (await import("../floor.mjs")).replied(surface, { close: true }); } catch { /* no floor */ }
  return { stopped: true, dropped: pending };
}

// ---- starting up ----
export function start() {
  temp.start({
    sky: async (restore) => { sky.set(restore, "back after a while"); },
    listen: async (restore) => { const quiet = await import("../quiet.mjs"); await quiet.setState(restore.state, { from: "timed" }); },
  });
  looksMod().then((l) => { looksNow = l || null; }).catch(() => {});
}
export { SPLIT };
