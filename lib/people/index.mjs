// People: the ONE way in to everything Dayspring knows about the people in the owner's life. Other code (photos, faces,
// texts, calls, the AI's tools, the settings page) goes through here, so a sync adapter can be added in one place later.
//
// Where it lives:
//   data/people.json            who they are (lib/special.mjs keeps it): name, nickname(s), relationship, birthday, notes
//   data/people/faces.bin       their faces in the owner's photos: fingerprints and thumbnails (encrypted, lib/vision/library)
//   data/people/comms.bin       saved texts and calls, only when the owner turned that on (encrypted, ./comms.mjs)
// and what's linked, read where it already lives: the prayer list (data/devotion.json), goals (data/goals.json), the
// schedule and connected calendars. Every record has a stable id, a source ({ app, user, from }) and a visibility
// ("private" unless the owner ever shares it; there's no sharing yet).
//
//   list() · find(nameOrId) · ensure(name, patch) · update(id, patch) · addFact(id, text, from) · rename(id, name)
//   merge(keepId, dropId) · remove(id) · nameFaces({ cluster | face, name, relation, nickname }) · resolveSender(raw)
//   profile(nameOrId, { openPrivate }) · spoken.about / lastTalked / lately (plain-language answers)
import * as special from "../special.mjs";
import * as library from "../vision/library.mjs";
import * as comms from "./comms.mjs";
import * as devlog from "../devlog.mjs";
import * as morning from "../morning.mjs";
import * as goals from "../goals.mjs";
import * as store from "../store.mjs";

const SRC = (from) => ({ app: "dayspring", user: "local", from });
const cap = (s) => String(s ?? "").trim().replace(/\s+/g, " ").replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());
// face-profile changes go to the activity log (lib/activity.mjs): what changed and the person's id, never names, faces or words
let activity = undefined;
async function log(what, data = {}) {
  try { devlog.log("people", { what, ...data }); } catch { /* fine */ }
  try {
    if (activity === undefined) activity = await import("../activity.mjs").catch(() => null);
    activity?.log?.("people", { action: what, ...data });
  } catch { /* the activity log is optional */ }
}

const pub = (p) => p && ({ id: p.id, name: p.name, nickname: p.nickname ?? null, aliases: p.aliases ?? [], relation: p.relation ?? null, birthday: p.birthday ?? null, year: p.year ?? null, phone: p.phone ?? null,
  links: p.links ?? [], created: p.created ?? null, source: p.source ?? SRC("told"), visibility: p.visibility ?? "private",
  notes: (p.notes ?? []).map((n) => ({ id: n.id, at: n.at, text: n.text, photoId: n.photoId ?? null, source: typeof n.source === "object" ? n.source : SRC(n.source ?? "told"), visibility: n.visibility ?? "private" })) });

export function list() { return special.allProfiles().map(pub); }
export function find(nameOrId) {
  const k = String(nameOrId ?? "").trim();
  if (!k) return null;
  const byId = special.personById(k);
  if (byId) return pub(byId);
  const p = special.profileOf(k) ?? special.allProfiles().find((x) => (x.nickname && x.nickname.toLowerCase() === k.toLowerCase()));
  return p ? pub(p) : null;
}
export function ensure(name, patch = {}) {
  const p = special.ensurePerson(cap(name), {});
  const up = {};
  if (patch.relation) up.relation = String(patch.relation).slice(0, 120);
  if (patch.nickname) { up.nickname = String(patch.nickname).slice(0, 40); up.aliases = [...new Set([...(p.aliases ?? []), up.nickname])]; }
  if (patch.phone) up.phone = String(patch.phone).slice(0, 40);
  if (patch.source && !p.source) up.source = patch.source;
  const out = Object.keys(up).length ? special.updatePerson(p.id, up) : special.personById(p.id);
  return pub(out);
}
export function update(id, patch = {}) {
  const p = special.personById(id); if (!p) throw new Error("I don't know that person.");
  const up = {};
  for (const k of ["relation", "birthday", "year", "phone"]) if (patch[k] !== undefined) up[k] = patch[k];
  if (patch.name) up.name = cap(patch.name);
  if (patch.nickname !== undefined) { up.nickname = patch.nickname || null; if (patch.nickname) up.aliases = [...new Set([...(p.aliases ?? []), patch.nickname])]; }
  if (Array.isArray(patch.links)) up.links = patch.links.filter((l) => l?.personId && special.personById(l.personId)).map((l) => ({ id: l.id ?? cryptoId(), personId: l.personId, relation: String(l.relation ?? "").slice(0, 60), source: l.source ?? SRC("told"), visibility: "private" }));
  const out = pub(special.updatePerson(id, up));
  log("updated", { person: id, fields: Object.keys(up) });
  return out;
}
const cryptoId = () => globalThis.crypto.randomUUID();
export function addFact(id, text, from = "told", extra = {}) {
  const p = special.personById(id); if (!p || !String(text ?? "").trim()) return null;
  const note = { id: cryptoId(), at: new Date().toISOString(), text: String(text).trim().slice(0, 600), source: from, visibility: "private", ...(extra.photoId ? { photoId: extra.photoId } : {}) };
  special.updatePerson(id, { notes: [...(p.notes ?? []), note] });
  return note;
}
export function rename(id, name) { const out = update(id, { name }); log("renamed", { person: id }); return out; }
// connect two people ("Tom is Sarah's husband")
export function connect(aId, bId, relation) {
  const a = special.personById(aId); if (!a || !special.personById(bId)) throw new Error("I don't know one of them.");
  const links = (a.links ?? []).filter((l) => l.personId !== bId).concat({ id: cryptoId(), personId: bId, relation: String(relation ?? "").slice(0, 60), source: SRC("told"), visibility: "private" });
  special.updatePerson(aId, { links });
  return pub(special.personById(aId));
}

// Two entries that are one person: notes, nicknames, faces, messages and calls all go to the one kept
export async function merge(keepId, dropId) {
  const a = special.personById(keepId), b = special.personById(dropId);
  if (!a || !b || keepId === dropId) throw new Error("I need two different people to merge.");
  special.updatePerson(keepId, { aliases: [...new Set([...(a.aliases ?? []), b.name, ...(b.aliases ?? [])])], notes: [...(a.notes ?? []), ...(b.notes ?? [])], prayer: [...new Set([...(a.prayer ?? []), ...(b.prayer ?? [])])],
    relation: a.relation ?? b.relation ?? null, birthday: a.birthday ?? b.birthday ?? null, phone: a.phone ?? b.phone ?? null, links: [...(a.links ?? []), ...(b.links ?? [])].filter((l) => l.personId !== keepId && l.personId !== dropId) });
  await library.reassignPerson(dropId, keepId);
  await comms.reassign(dropId, keepId);
  for (const p of special.allProfiles()) if (p.links?.some((l) => l.personId === dropId)) special.updatePerson(p.id, { links: p.links.map((l) => (l.personId === dropId ? { ...l, personId: keepId } : l)) });
  special.removePersonById(dropId);
  await log("merged", { person: keepId, from: dropId });
  return pub(special.personById(keepId));
}
// Delete a person: their profile, faces (fingerprints and thumbnails), saved messages and calls
export async function remove(id) {
  const p = special.personById(id); if (!p) throw new Error("I don't know that person.");
  const f = await library.forgetPerson(id);
  const c = await comms.deleteFor(id);
  for (const q of special.allProfiles()) if (q.links?.some((l) => l.personId === id)) special.updatePerson(q.id, { links: q.links.filter((l) => l.personId !== id) });
  special.removePersonById(id);
  await log("deleted", { person: id, faces: f.faces, messages: c.removed });
  return { removed: p.name, faces: f.faces, messages: c.removed };
}

// ---- faces → people ----
// The owner named a face or a group ("that's my cousin Sarah"): the person (new or known), then the whole group
export async function nameFaces({ cluster = null, face = null, name, relation = null, nickname = null, note = null, photoId = null }) {
  if (!String(name ?? "").trim()) throw new Error("Who is it?");
  const p = find(name) ?? ensure(name, { relation, nickname, source: SRC("photo") });
  if (relation && !p.relation) update(p.id, { relation });
  if (nickname) update(p.id, { nickname });
  const r = face ? await library.linkFace(face, p.id) : await library.linkCluster(cluster, p.id);
  if (note) addFact(p.id, note, "photo", { photoId });
  await log("named", { person: p.id, faces: r.faces });
  return { person: find(p.id), ...r };
}
export const answerFaceSuggestion = async (cluster, personId, yes) => { const r = await library.answerSuggestion(cluster, personId, yes); await log(yes ? "confirmed" : "not-this-person", { person: personId }); return r; };
export async function notPerson(faceId) { const r = await library.notPerson(faceId); await log("not-a-person", {}); return r; }
export async function ignoreFaces(clusterOrPerson) { const r = await library.ignore(clusterOrPerson); await log("ignored", {}); return r; }
export async function splitFaces(faceIds) { const r = await library.split(faceIds); await log("split", { faces: r.faces }); return r; }
export async function mergeFaceGroups(a, b) { const r = await library.mergeClusters(a, b); await log("groups-merged", {}); return r; }

// ---- who sent this? (texts and calls) ----
const digits = (s) => String(s ?? "").replace(/\D/g, "").slice(-10);
export function resolveSender(raw) {
  const r = String(raw ?? "").trim();
  if (!r) return { personId: null, sure: false, candidates: [] };
  const all = special.allProfiles();
  const d = digits(r);
  if (d.length >= 7) { const hit = all.filter((p) => p.phone && digits(p.phone) === d); if (hit.length === 1) return { personId: hit[0].id, sure: true }; }
  const low = r.toLowerCase();
  const exact = all.filter((p) => p.name.toLowerCase() === low || (p.aliases ?? []).some((a) => a.toLowerCase() === low) || (p.nickname ?? "").toLowerCase() === low);
  if (exact.length === 1) return { personId: exact[0].id, sure: true };
  // "Mike R", "Mike Roberts", "Mom ❤️": a first word in common is only a guess
  const words = low.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean);
  // how well a name fits: the first word must be the same; each later word that starts the same way ("R" → "Roberts") counts
  const fit = (n) => { const w = n.toLowerCase().split(/\s+/); if (!words[0] || words[0].length < 2 || w[0] !== words[0]) return 0; return 1 + words.slice(1).filter((x, i) => w[i + 1]?.startsWith(x)).length; };
  const scored = all.map((p) => ({ p, s: Math.max(...[p.name, ...(p.aliases ?? [])].map(fit)) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  return { personId: null, sure: false, candidates: (exact.length > 1 ? exact : scored.map((x) => x.p)).map((p) => p.id) };
}
comms.setResolver(resolveSender);
// "Is 'Mike R' the same as Mike from your prayer list?"
export async function nextMatchQuestion() {
  const m = (await comms.pendingMatches()).find((x) => !x.asked);
  if (!m) return null;
  const p = special.personById(m.candidates[0]); if (!p) return null;
  const where = linkedPrayer(p).length ? " from your prayer list" : p.relation ? `, ${p.relation}` : "";
  return { id: m.id, personId: p.id, raw: m.raw, text: `Quick question: is "${m.raw}" in your texts the same person as ${p.name}${where}?` };
}

// ---- the profile: one page per person ----
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
const mentions = (text, p) => {
  const t = ` ${norm(text)} `;
  // a first name alone ("coffee with Mike" for Mike Roberts) only when nobody else Dayspring knows has it
  const first = p.name.split(" ").length > 1 ? p.name.split(" ")[0] : null;
  const firstOk = first && special.allProfiles().filter((x) => x.name.split(" ")[0].toLowerCase() === first.toLowerCase()).length === 1;
  const names = [p.name, ...(p.aliases ?? []), p.nickname, firstOk ? first : null].filter((n) => n && n.length >= 2).map(norm);
  return names.some((n) => t.includes(` ${n} `) || t.includes(` ${n}'s `) || t.includes(` ${n}s `));
};
function linkedPrayer(p, { openPrivate = false } = {}) {
  let d; try { d = morning.devotion(); } catch { return []; }
  const item = (x, answered) => {
    const i = typeof x === "string" ? { title: x } : x;
    const who = (i.people ?? []).some((n) => norm(n) === norm(p.name) || (p.aliases ?? []).some((a) => norm(a) === norm(n))) || mentions(i.title, p);
    if (!who) return null;
    return { id: i.id ?? `prayer:${norm(i.title)}`, title: i.title, detail: i.private && !openPrivate ? null : i.detail ?? null, private: Boolean(i.private), answered, answeredOn: i.answeredOn ?? null, note: i.private && !openPrivate ? null : i.note ?? null, source: SRC("prayer"), visibility: "private" };
  };
  return [...(d.prayer?.list ?? []).map((x) => item(x, false)), ...(d.prayer?.answered ?? []).map((x) => item(x, true))].filter(Boolean);
}
function linkedGoals(p) {
  return goals.list(true).filter((g) => (g.people ?? []).includes(p.id) || mentions(`${g.text} ${g.why ?? ""}`, p))
    .map((g) => ({ id: g.id, text: g.text, why: g.why || null, due: g.due ?? null, area: g.area ?? null, active: g.active !== false, done: g.done ?? (g.active === false), source: SRC("goal"), visibility: "private" }));
}
function linkedEvents(p, today = store.todayISO()) {
  const back = store.addDays(today, -365), ahead = store.addDays(today, 120);
  let past = [], next = [];
  try { past = store.blocksBetween(back, store.addDays(today, -1)).concat(store.blocksBetween(today, today)); } catch { /* no schedule */ }
  try { next = store.planBetween(store.addDays(today, 1), ahead); } catch { /* no plan */ }
  const pick = (b) => mentions(`${b.title} ${b.description ?? ""}`, p);
  const shape = (b) => ({ id: b.id, date: b.date, start: b.start ?? null, title: b.title, source: SRC(b.external ? "calendar" : "schedule"), visibility: "private" });
  const before = past.filter(pick).map(shape).sort((a, b) => `${b.date}${b.start}`.localeCompare(`${a.date}${a.start}`));
  const after = next.filter(pick).map(shape).sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
  // birthdays and occasions from people.json
  const birthday = p.birthday ? { date: nextDate(p.birthday, today), title: `${p.name}'s birthday`, source: SRC("birthday") } : null;
  return { past: before.slice(0, 20), upcoming: [...(birthday ? [birthday] : []), ...after].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 20), lastTogether: before[0] ?? null, nextPlanned: after[0] ?? null };
}
function nextDate(md, today) { const y = Number(today.slice(0, 4)); const d = `${y}-${md}`; return d >= today ? d : `${y + 1}-${md}`; }

export async function profile(nameOrId, { openPrivate = false, withMessages = true } = {}) {
  const base = find(nameOrId); if (!base) return null;
  const raw = special.personById(base.id);
  const faces = await library.summaryFor(base.id).catch(() => ({ photos: 0, photoIds: [], firstSeen: null, lastSeen: null, thumb: null }));
  const connections = (base.links ?? []).map((l) => ({ ...l, name: special.personById(l.personId)?.name ?? null })).filter((l) => l.name);
  // people who list this person as a connection
  for (const q of special.allProfiles()) for (const l of q.links ?? []) if (l.personId === base.id && !connections.some((c) => c.personId === q.id)) connections.push({ id: l.id, personId: q.id, name: q.name, relation: `${l.relation ? l.relation + " of" : "connected to"} ${base.name}`.trim(), inverse: true, source: l.source, visibility: "private" });
  const sugg = (await comms.suggestions().catch(() => [])).filter((s) => s.relatedTo === base.id);
  return { ...base, prayer: linkedPrayer(raw, { openPrivate }), goals: linkedGoals(raw), events: linkedEvents(raw), connections, connectionSuggestions: sugg,
    faces: { photos: faces.photos, photoIds: faces.photoIds.slice(0, 60), firstSeen: faces.firstSeen, lastSeen: faces.lastSeen, thumb: faces.thumb },
    messages: withMessages ? await comms.thread(base.id).catch(() => []) : [], calls: withMessages ? await comms.calls(base.id).catch(() => []) : [], lastContact: await comms.lastContact(base.id).catch(() => null) };
}

// ---- plain-language answers (no AI needed) ----
const when = (iso) => { if (!iso) return null; const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso); const days = Math.round((Date.now() - d) / 86400_000); return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 14 ? `${days} days ago` : d.toLocaleDateString("en-US", { month: "long", day: "numeric", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) }); };
// a day coming up: "today", "tomorrow", "Friday, October 3"
const ahead = (date) => { const t = store.todayISO(); return date === t ? "today" : date === store.addDays(t, 1) ? "tomorrow" : new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }); };
export const spoken = {
  async about(name) {
    const p = await profile(name, { withMessages: true }); if (!p) return null;
    const bits = [p.relation ? `${p.name} is ${/^(your|my|a|an|the)\b/i.test(p.relation) ? p.relation.replace(/^my\b/i, "your") : "your " + p.relation}.` : `${p.name}.`];
    if (p.nickname && p.nickname !== p.name) bits.push(`You call them ${p.nickname}.`);
    if (p.birthday) bits.push(`Birthday: ${special.monthName(p.birthday)}.`);
    if (p.faces.photos) bits.push(`They're in ${p.faces.photos} of your photos${p.faces.lastSeen ? `, most recently ${when(p.faces.lastSeen)}` : ""}.`);
    const open = p.prayer.filter((x) => !x.answered), done = p.prayer.filter((x) => x.answered);
    if (open.length) bits.push(`On your prayer list: ${open.map((x) => (x.private ? `${x.title} (private)` : x.title)).join("; ")}.`);
    if (done.length) bits.push(`${done.length} answered prayer${done.length > 1 ? "s" : ""}.`);
    if (p.goals.length) bits.push(`Goal${p.goals.length > 1 ? "s" : ""}: ${p.goals.map((g) => g.text).join("; ")}.`);
    if (p.events.nextPlanned) bits.push(`Next planned: ${p.events.nextPlanned.title}, ${ahead(p.events.nextPlanned.date)}.`);
    if (p.connections.length) bits.push(p.connections.slice(0, 3).map((c) => `${c.name}${c.relation ? ` (${c.relation})` : ""}`).join(", ") + ".");
    const told = p.notes.filter((n) => n.source?.from !== "mentioned");   // things said about them, not every sentence that named them
    if (told.length) bits.push(told.slice(-2).map((n) => n.text).join(" "));
    return bits.join(" ");
  },
  async lastTalked(name) {
    const p = await profile(name); if (!p) return null;
    const c = p.lastContact, e = p.events.lastTogether, ph = p.faces.lastSeen;
    const bits = [];
    if (c) bits.push(`The last time was ${when(c.at)}: ${c.how}.`);
    if (e) bits.push(`The last time on your schedule: ${e.title}, ${when(e.date)}.`);
    if (ph) bits.push(`The latest photo of ${p.name} is from ${when(ph)}.`);
    return bits.length ? bits.join(" ") : `I don't have any texts, calls or plans with ${p.name} saved.${!(await import("../vision/settings.mjs")).get().saveTexts ? " Saving texts to profiles is off in Settings." : ""}`;
  },
  async lastPhoto(name) {
    const p = await profile(name, { withMessages: false }); if (!p) return null;
    return p.faces.photos ? `The most recent photo I've found of ${p.name} is from ${when(p.faces.lastSeen) ?? "a while back"}. They're in ${p.faces.photos} photo${p.faces.photos > 1 ? "s" : ""}.` : `I haven't found ${p.name} in your photos yet.`;
  },
  async lately(name) {
    const p = await profile(name); if (!p) return null;
    const since = new Date(Date.now() - 21 * 86400_000).toISOString();
    const texts = p.messages.filter((m) => m.at >= since), calls = p.calls.filter((c) => c.start >= since);
    const bits = [];
    if (texts.length) { const last = texts[texts.length - 1]; bits.push(`${texts.length} text${texts.length > 1 ? "s" : ""} in the last three weeks. The latest, ${when(last.at)}${last.dir === "out" ? ", from you" : ""}: "${last.text.slice(0, 160)}"`); }
    if (calls.length) bits.push(`${calls.length} call${calls.length > 1 ? "s" : ""} lately.`);
    const open = p.prayer.filter((x) => !x.answered);
    if (open.length) bits.push(`You're praying about ${open.map((x) => x.title).join(" and ")}.`);
    const recentAns = p.prayer.filter((x) => x.answered && x.answeredOn && x.answeredOn >= since.slice(0, 10));
    if (recentAns.length) bits.push(`Answered lately: ${recentAns.map((x) => x.title).join(", ")}.`);
    if (p.events.nextPlanned) bits.push(`Coming up: ${p.events.nextPlanned.title}, ${ahead(p.events.nextPlanned.date)}.`);
    if (p.events.lastTogether && p.events.lastTogether.date >= since.slice(0, 10)) bits.push(`You had ${p.events.lastTogether.title} ${when(p.events.lastTogether.date)}.`);
    return bits.length ? bits.join(" ") : `Nothing new saved about ${p.name} lately.`;
  },
};
