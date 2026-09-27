// Text messages and calls on people's profiles: only with "Save my text messages to people's profiles" (saveTexts) or
// "Save call history" (saveCalls) on in Settings → Photos & people. Both are OFF by default; off means nothing is
// written. Stored encrypted (DPAPI) in data/people/comms.bin; kept for the chosen time (default: keep); deleting a person
// deletes theirs; "Delete all saved messages" deletes them all. The announce-and-read-on-yes behaviour for new texts is
// unchanged (lib/phonenotify.mjs); this only keeps a copy when the owner asked for that.
//
// Who a text is from: Phone Link shows a name (from the phone's contacts) or a number. A name that matches one person
// exactly is theirs; anything unsure ("Mike R" when there's a Mike on the prayer list) waits for the owner's answer
// ("Is 'Mike R' the same as Mike from your prayer list?"), asked within the daily question budget.
//   onPhoneEvent(n) · recordText({ who, dir, text, at }) · recordOutgoing(to, body) · logCall({ who, app, start, end, dir })
//   thread(personId) · calls(personId) · pendingMatches() · answerMatch(id, personId|null) · suggestions()
//   deleteFor(personId) · deleteAll() · prune()
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { secureFile } from "../vision/secure.mjs";
import * as vsettings from "../vision/settings.mjs";

const DATA = () => process.env.DAYSPRING_PEOPLE_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "people");
const empty = () => ({ v: 1, texts: [], calls: [], matches: [], aliases: {}, suggestions: [] });
let store = null;
const S = () => (store ??= secureFile(join(DATA(), "comms.bin"), empty));
const db = () => S().load();
const src = (from) => ({ app: "dayspring", user: "local", from });
let resolver = null;            // lib/people: (raw) → { personId, sure, candidates }
export function setResolver(fn) { resolver = fn; }

// who is this sender? an alias the owner confirmed first, then the people module's guess
async function resolve(raw) {
  const d = await db(), key = norm(raw);
  if (d.aliases[key] !== undefined) return { personId: d.aliases[key], sure: true };
  return resolver ? resolver(raw) : { personId: null, sure: false, candidates: [] };
}
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}+ ]/gu, "").replace(/\s+/g, " ").trim();

async function queueMatch(raw, candidates) {
  const d = await db(), key = norm(raw);
  if (!candidates?.length || d.matches.some((m) => m.key === key && !m.answered)) return;
  d.matches.push({ id: randomUUID(), key, raw: String(raw).slice(0, 80), candidates: candidates.slice(0, 3), at: new Date().toISOString(), asked: null, answered: false, source: src("match"), visibility: "private" });
  S().changed();
}

export async function recordText({ who, dir = "in", text, at = Date.now(), from = "phonelink" }) {
  if (!vsettings.get().saveTexts) return null;                       // off: nothing is written
  if (!String(text ?? "").trim()) return null;
  const d = await db(), r = await resolve(who);
  const rec = { id: randomUUID(), personId: r.sure ? r.personId : null, who: String(who ?? "").slice(0, 80), dir, at: new Date(at).toISOString(), text: String(text).slice(0, 4000), source: src(from), visibility: "private" };
  d.texts.push(rec);
  if (!r.sure) await queueMatch(who, r.candidates);
  await mentions(rec, r);
  S().changed();
  return rec;
}
export const recordOutgoing = (to, body, from = "dayspring") => recordText({ who: to, dir: "out", text: body, from });

export async function logCall({ who = [], app = "phone", start = Date.now(), end = null, dir = "unknown", missed = false }) {
  if (!vsettings.get().saveCalls) return null;
  const d = await db(), out = [];
  for (const w of [].concat(who).filter(Boolean).slice(0, 20)) {
    const r = await resolve(w);
    const rec = { id: randomUUID(), personId: r.sure ? r.personId : null, who: String(w).slice(0, 80), app, dir, missed: Boolean(missed), start: new Date(start).toISOString(), end: end ? new Date(end).toISOString() : null, durationSec: end ? Math.max(0, Math.round((end - start) / 1000)) : null, source: src(app), visibility: "private" };
    d.calls.push(rec); out.push(rec);
    if (!r.sure) await queueMatch(w, r.candidates);
  }
  S().changed();
  return out;
}

// Phone Link: texts (and calls, when its notifications say so)
export async function onPhoneEvent(n) {
  try {
    if (n?.kind === "text") return await recordText({ who: n.from, dir: "in", text: n.body, at: n.at ?? Date.now() });
    if (n?.kind === "call") return await logCall({ who: [n.from], app: "phone", start: n.at ?? Date.now(), dir: "in", missed: Boolean(n.missed) });
  } catch (e) { console.log(`people: ${e.message}`); }
  return null;
}

// "Sarah mentioned her husband Tom": only ever a suggestion for the owner to confirm
const MENTION = /\b(?:[Mm]y|[Hh]er|[Hh]is|[Tt]heir|[Oo]ur)\s+(husband|wife|son|daughter|mom|mother|dad|father|brother|sister|boyfriend|girlfriend|fianc[eé]e?|cousin|aunt|uncle|grandma|grandpa|friend|boss|roommate|baby)\s+([A-Z][a-z]{1,20})\b/g;
async function mentions(rec, r) {
  const d = await db();
  for (const m of rec.text.matchAll(MENTION)) {
    const name = m[2], relation = m[1].toLowerCase();
    if (d.suggestions.some((s) => s.name === name && s.relatedTo === (r.personId ?? rec.who))) continue;
    d.suggestions.push({ id: randomUUID(), name, relation, relatedTo: r.personId ?? null, relatedWho: rec.who, text: `${rec.who} mentioned ${m[0].trim()}`, at: rec.at, status: "new", source: src(rec.source.from), visibility: "private" });
  }
}

export async function thread(personId, { limit = 200 } = {}) { return (await db()).texts.filter((t) => t.personId === personId).slice(-limit); }
export async function calls(personId, { limit = 100 } = {}) { return (await db()).calls.filter((c) => c.personId === personId).slice(-limit); }
export async function lastContact(personId) {
  const d = await db();
  const t = d.texts.filter((x) => x.personId === personId).map((x) => ({ at: x.at, how: x.dir === "out" ? "you texted" : "they texted" }));
  const c = d.calls.filter((x) => x.personId === personId).map((x) => ({ at: x.start, how: `a ${x.app === "phone" ? "phone" : x.app} call` }));
  return [...t, ...c].sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
}
export async function pendingMatches() { return (await db()).matches.filter((m) => !m.answered); }
// the owner's answer: that sender is this person (or nobody we know): every earlier message from them moves too
export async function answerMatch(id, personId) {
  const d = await db(), m = d.matches.find((x) => x.id === id);
  if (!m) throw new Error("I don't have that question any more.");
  m.answered = true; m.personId = personId ?? null;
  d.aliases[m.key] = personId ?? null;
  if (personId) { for (const t of d.texts) if (norm(t.who) === m.key) t.personId = personId; for (const c of d.calls) if (norm(c.who) === m.key) c.personId = personId; }
  S().changed();
  return m;
}
export async function markAsked(id) { const d = await db(), m = d.matches.find((x) => x.id === id); if (m) { m.asked = new Date().toISOString(); S().changed(); } }
export async function suggestions() { return (await db()).suggestions.filter((s) => s.status === "new"); }
export async function answerSuggestion(id, status) { const d = await db(), s = d.suggestions.find((x) => x.id === id); if (s) { s.status = status; S().changed(); } return s; }
export async function reassign(fromId, toId) { const d = await db(); for (const x of [...d.texts, ...d.calls]) if (x.personId === fromId) x.personId = toId; for (const k of Object.keys(d.aliases)) if (d.aliases[k] === fromId) d.aliases[k] = toId; S().changed(); }

export async function deleteFor(personId) {
  const d = await db(), before = d.texts.length + d.calls.length;
  d.texts = d.texts.filter((t) => t.personId !== personId);
  d.calls = d.calls.filter((c) => c.personId !== personId);
  for (const k of Object.keys(d.aliases)) if (d.aliases[k] === personId) delete d.aliases[k];
  d.matches = d.matches.filter((m) => !m.candidates.includes(personId) && m.personId !== personId);
  d.suggestions = d.suggestions.filter((s) => s.relatedTo !== personId);
  S().changed(); await S().flush();
  return { removed: before - d.texts.length - d.calls.length };
}
export async function deleteAll() { await S().wipe(); return { ok: true }; }
export async function deleteAllTexts() { const d = await db(); const n = d.texts.length; d.texts = []; S().changed(); await S().flush(); return { removed: n }; }
// older than the chosen time goes (0 = keep)
export async function prune(now = Date.now()) {
  const days = vsettings.get().keepDays; if (!days) return { removed: 0 };
  const d = await db(), cut = new Date(now - days * 86400_000).toISOString(), before = d.texts.length + d.calls.length;
  d.texts = d.texts.filter((t) => t.at >= cut); d.calls = d.calls.filter((c) => c.start >= cut);
  const removed = before - d.texts.length - d.calls.length;
  if (removed) S().changed();
  return { removed };
}
export async function counts() { const d = await db(); return { texts: d.texts.length, calls: d.calls.length, unmatched: d.texts.filter((t) => !t.personId).length + d.calls.filter((c) => !c.personId).length, questions: d.matches.filter((m) => !m.answered).length }; }
export const flush = () => S().flush();
export function _reset() { store?._reset(); store = null; }
