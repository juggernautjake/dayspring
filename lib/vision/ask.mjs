// "Who's in this picture?" and the other photo and people questions, and understanding the answers.
//
// When: only when the TV is showing one of the owner's photos in a relaxed moment (8am–9pm, not in a study or work
// block), with Dayspring Active (never Quiet or Off), not in a meeting or call, and at most once or twice a day (Settings
// → Photos & people, default once). That budget is shared by every question here: the old "What's this one?", "Who's in
// this picture?" (only with face recognition on and faces nobody named yet), and "Is 'Mike R' the same as Mike?" about
// texts. When a photo needs both "who" and "what", it's ONE question: "Who's in this picture, and what was going on?"
//
//   plan({ date, want, relaxedSchedule }) → { any, what, who, prefer }     (before a photo is picked)
//   decide(photo, plan) → { ask, kind: "what" | "who" | "both", question }
//   markAsked(photoId, kind, date) · pending() · clear() · canAskNow(date)
//   parseAnswer(text, faceCount, { owner }) → { skip, people: [{ name, me, relation, relOf, pos }], activity }
//   answer(text) → the reply (saves the names on the faces, the words in the photo catalogue, facts on each person)
//   tickPeople() → maybe asks one "Is 'Mike R' the same as Mike?" question (from the server, now and then)
import * as vsettings from "./settings.mjs";
import * as photos from "../photos.mjs";
import * as settings from "../settings.mjs";
import * as store from "../store.mjs";
import * as owner from "../owner.mjs";

// what else is going on (the server fills these in: calls and meetings live in modules this file shouldn't load)
let deps = { inCall: () => false, announce: null };
export function setDeps(d) { deps = { ...deps, ...d }; }

const MEETING = /\b(meeting|call|zoom|teams|meet|interview|appointment|class|lecture|exam|test|webinar|standup|stand-up)\b/i;
export function canAskNow(date = store.todayISO(), now = new Date()) {
  const s = settings.get();
  if (s.listenState && s.listenState !== "active") return { ok: false, why: "quiet-or-off" };
  if (s.mode && s.mode !== "voice") return { ok: false, why: "not-speaking" };
  const h = now.getHours();
  if (h < 8 || h >= 21) return { ok: false, why: "hour" };
  const hm = now.toTimeString().slice(0, 5);
  let cur = null; try { cur = store.blocksBetween(date, date).find((b) => b.start <= hm && hm < b.end); } catch { /* no schedule */ }
  if (cur && (!["flex", "home", "meal", "rest"].includes(cur.category) || MEETING.test(cur.title ?? ""))) return { ok: false, why: "busy" };
  try { if (deps.inCall()) return { ok: false, why: "call" }; } catch { /* fine */ }
  const a = vsettings.askState(date), per = vsettings.get().askPerDay;
  if (a.count >= per) return { ok: false, why: "budget" };
  if (a.last && now.getTime() - a.last < 3 * 3600_000) return { ok: false, why: "spacing" };
  return { ok: true };
}

let lib = null;
const library = async () => (lib ??= await import("./library.mjs"));
const facesOn = () => { const s = vsettings.get(); return s.faces && s.askWho; };

export async function plan({ date = store.todayISO(), want = true, now: clock = new Date() } = {}) {
  const none = { any: false, what: false, who: false, prefer: null };
  if (!want) return none;
  const now = canAskNow(date, clock);
  if (!now.ok) return { ...none, why: now.why };
  const what = photos.canAskToday(date);
  let who = false, prefer = null;
  if (facesOn()) { try { prefer = await (await library()).photosWithUnnamed(); who = prefer.size > 0; } catch { /* no index yet */ } }
  return { any: what || who, what, who, prefer };
}
export async function decide(photo, p) {
  if (!photo || !p?.any) return { ask: false };
  let unnamed = [];
  if (p.who) { try { unnamed = await (await library()).unnamedIn(photo.id); } catch { unnamed = []; } }
  const needWhat = p.what && !photo.description;
  if (unnamed.length && needWhat) return { ask: true, kind: "both", question: unnamed.length === 1 ? "Who's this in the picture, and what was going on?" : "Who's in this picture, and what was going on?", faces: unnamed.length };
  if (unnamed.length) return { ask: true, kind: "who", question: unnamed.length === 1 ? "Who's this in the picture?" : `Who's in this picture? I count ${unnamed.length} people I don't know yet.`, faces: unnamed.length };
  if (needWhat) return { ask: true, kind: "what", question: null };            // the TV uses its own "What's this one?" lines
  return { ask: false };
}

// ---- the question in the air ----
let waiting = null;           // { photoId, kind, faces: [faceId left→right], at } or { match, at }
export async function markAsked(photoId, kind, date = store.todayISO(), { count = true } = {}) {
  let faces = [];
  if (kind === "who" || kind === "both") { try { faces = await (await library()).facesIn(photoId); } catch { faces = []; } }
  waiting = { photoId, kind, faces, at: Date.now() };
  if (count) vsettings.countAsk(date);
  return waiting;
}
export const pending = () => (waiting && Date.now() - waiting.at < 15 * 60_000 ? waiting : null);
export function clear() { waiting = null; }

// ---- understanding "me, Sarah and her husband Tom" ----
const RELS = "husband|wife|son|daughter|mom|mother|dad|father|brother|sister|boyfriend|girlfriend|fianc[eé]e?|cousin|aunt|uncle|grandma|grandmother|grandpa|grandfather|niece|nephew|friend|best friend|buddy|coworker|co-worker|boss|neighbor|neighbour|roommate|teacher|pastor|mentor|kid|kids|baby|stepmom|stepdad|in-law|mother-in-law|father-in-law|sister-in-law|brother-in-law|wife's|husband's";
const REL = new RegExp(`\\b(my|her|his|their|our)\\s+(${RELS})\\b`, "i");
const POS = /\b(?:(?:is |'s |are )?(?:on|at|to) the (far )?(left|right)|in the (middle|center|centre|back|front)|(left|right|middle)(?:most)?)\b/i;
const STOP = new Set("that's thats this is it's its those these are there here the a an and with from me myself i um uh oh well yeah yes so just also plus both all of us we our on at in to far left right middle center centre back front picture photo pic image one guy girl lady man woman person people someone somebody who what was going when while having getting".split(" "));
const ACTIVITY = /\b(at|during|while|celebrating|having|playing|eating|watching|hiking|fishing|camping|visiting|getting|doing|after|before|for (?:his|her|their|our|my|the)|on (?:his|her|their|our|my|the|a|christmas|thanksgiving|easter|vacation|holiday|a trip|our trip)(?! (?:far )?(?:left|right)\b)|in (?!the (?:middle|center|centre|back|front)\b))\b/i;

export function parseAnswer(text, faceCount = 0) {
  const raw = String(text ?? "").trim().replace(/[“”]/g, '"');
  const q = raw.toLowerCase();
  if (!raw || /^(skip|not now|pass|later|never ?mind|no idea|i don'?t know|i'?m not sure|dunno|no one|nobody)\b/.test(q)) return { skip: true, people: [], activity: "" };
  // the people part, and what was going on (after "at", "during", "celebrating"…, or a new sentence)
  let s = raw.replace(/^(?:well|um|uh|oh|so|yeah|okay|ok)[, ]+/i, "").replace(/^(?:that'?s|this is|it'?s|those are|these are|it is|thats)\s+/i, "").replace(/^(?:from )?left to right[:,]?\s*/i, "");
  const ordered = /\bleft to right\b/i.test(raw);
  let activity = "";
  const sentence = s.search(/[.!?;]\s/);
  if (sentence > 0) { activity = s.slice(sentence + 1).trim(); s = s.slice(0, sentence); }
  // positions first ("Sarah's on the left"), so "on the left" isn't taken for what was going on
  const act = ACTIVITY.exec(s.replace(/\b(?:is |'s )?(?:on|at|to) the (?:far )?(?:left|right)\b|\bin the (?:middle|center|centre|back|front)\b/gi, (m) => "~".repeat(m.length)));
  if (act && act.index > 0) { activity = (s.slice(act.index) + (activity ? ". " + activity : "")).trim(); s = s.slice(0, act.index); }
  const chunks = s.split(/\s*(?:,|\band\b|&|\bplus\b|\bwith\b|\bnext to\b|\bbeside\b)\s*/i).map((c) => c.trim()).filter(Boolean);
  const people = [];
  for (const c of chunks) {
    const pos = POS.exec(c);
    const where = pos ? (pos[2] || pos[3] || pos[4]).toLowerCase().replace(/centre|center/, "middle") : null;
    const rel = REL.exec(c);
    if (/^(?:me|myself|i|i'?m)\b/i.test(c) || /\b(?:me|myself)\b/i.test(c) && !/\b[A-Z][a-z]+/.test(c.replace(/^(?:Me|Myself)\b/, ""))) { people.push({ me: true, name: null, relation: null, relOf: null, pos: where }); continue; }
    // "his dog", "the car": a thing, not a person
    if (!rel && /^(?:his|her|their|my|our|the|a|an|some)\s/i.test(c) && !/\s\p{Lu}/u.test(c)) continue;
    const words = c.replace(POS, " ").replace(REL, " ").replace(/'s\b/g, "").split(/\s+/).filter((w) => w && !STOP.has(w.toLowerCase()) && /^[\p{L}][\p{L}'.-]*$/u.test(w));
    // names: capitalised words when there are any (speech often capitalises names), else what's left
    const caps = words.filter((w) => /^\p{Lu}/u.test(w));
    const nameWords = (caps.length ? caps : words).slice(0, 3);
    if (!nameWords.length) continue;
    const name = nameWords.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    const familyWord = !rel && new RegExp(`^(?:${RELS})$`, "i").test(name) ? name.toLowerCase() : null;   // "Dad", "Grandma"
    people.push({ me: false, name, relation: rel ? rel[2].toLowerCase() : familyWord, relOf: rel ? (rel[1].toLowerCase() === "my" || rel[1].toLowerCase() === "our" ? "owner" : "previous") : familyWord ? "owner" : null, pos: where });
  }
  // match to faces (left to right): explicit positions first, then the order they were said in when the count fits
  const n = faceCount, taken = new Set();
  const slot = (w) => { if (!n) return null; const order = w === "left" ? [...Array(n).keys()] : w === "right" ? [...Array(n).keys()].reverse() : w === "middle" ? [Math.floor((n - 1) / 2), ...[...Array(n).keys()]] : []; return order.find((i) => !taken.has(i)) ?? null; };
  for (const p of people) if (p.pos) { const i = slot(p.pos); if (i != null) { p.face = i; taken.add(i); } }
  const rest = people.filter((p) => p.face == null);
  if (n && rest.length && (ordered || people.length === n || (n === 1 && people.length === 1))) {
    const free = [...Array(n).keys()].filter((i) => !taken.has(i));
    if (rest.length <= free.length) rest.forEach((p, k) => { p.face = free[k]; p.guessed = !ordered && n > 1 && !people.some((x) => x.pos); });
  }
  return { skip: false, people, activity: activity.replace(/^[,\s]+|[.\s]+$/g, ""), ordered };
}

// ---- the answer ----
let peopleMod = null;
const people = async () => (peopleMod ??= await import("../people/index.mjs"));
const listWords = (a) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);
const POSWORD = (i, n) => (n <= 1 ? "" : i === 0 ? " on the left" : i === n - 1 ? " on the right" : n === 3 && i === 1 ? " in the middle" : ` (${i + 1} from the left)`);

export async function answer(text) {
  const w = pending();
  if (!w) return null;
  const parsed = parseAnswer(text, w.faces.length);
  if (parsed.skip) { clear(); photos.clearPending(); return { reply: "No problem. Maybe another time." }; }
  const P = await people(), L = await library();
  const saved = [], notes = [];
  let prev = null;
  const ownerName = owner.name();
  for (const p of parsed.people) {
    const name = p.me ? ownerName : p.name;
    if (!name) continue;
    const relation = p.me ? "you" : p.relation ? (p.relOf === "owner" ? `your ${p.relation}` : prev ? `${prev.name}'s ${p.relation}` : p.relation) : null;
    const face = p.face != null ? w.faces[p.face] : null;
    let person;
    if (face && !face.personId) person = (await P.nameFaces({ face: face.id, name, relation })).person;
    else if (face && face.personId && P.find(face.personId)?.name?.toLowerCase() !== name.toLowerCase()) { await L.split([face.id]); person = (await P.nameFaces({ face: face.id, name, relation })).person; }
    else person = P.find(name) ?? P.ensure(name, { relation });
    if (relation && !person.relation && !p.me) P.update(person.id, { relation });
    if (p.relOf === "previous" && prev && p.relation) { try { P.connect(person.id, prev.id, p.relation); } catch { /* fine */ } }
    saved.push({ name: p.me ? "you" : person.name, face: p.face, guessed: p.guessed, id: person.id });
    if (!p.me) prev = person;
  }
  // what was going on → the photo catalogue (the owner's own words), and a fact on each person's profile
  const words = String(text).trim();
  let filed = null;
  if (w.kind !== "who" || parsed.activity) {
    const info = photos.info(w.photoId);
    if (!info?.description) filed = photos.catalogue(w.photoId, words, { people: saved.filter((x) => x.id).map((x) => x.id) });
  }
  if (parsed.activity) for (const s of saved) if (s.name !== "you") { P.addFact(s.id, `In a photo: ${parsed.activity}`, "photo", { photoId: w.photoId }); notes.push(s.name); }
  clear(); photos.clearPending();
  if (!saved.length) return { reply: filed ? `Got it. Filed under ${filed.category}.` : "I didn't catch any names. Try something like \"Sarah on the left and Tom on the right\"." };
  const n = w.faces.length;
  const who = saved.map((s) => `${s.name}${s.face != null ? POSWORD(s.face, n) : ""}`);
  const guessed = saved.some((s) => s.guessed);
  const unplaced = saved.filter((s) => s.face == null && s.name !== "you");
  let reply = `Saved: ${listWords(who)}${parsed.activity ? `, ${parsed.activity}` : ""}.`;
  if (filed) reply += ` Filed under ${filed.category}.`;
  if (guessed) reply += " I matched them left to right; tell me if that's wrong.";
  if (unplaced.length && n) reply += ` I didn't know which face is ${listWords(unplaced.map((s) => s.name))}; say who's on the left or right and I'll match them.`;
  return { reply, saved };
}

// ---- "Is 'Mike R' the same as Mike from your prayer list?" (texts and calls), within the same daily budget ----
let matchWaiting = null;
export async function tickPeople(date = store.todayISO(), clock = new Date()) {
  if (!deps.announce || matchWaiting && Date.now() - matchWaiting.at < 15 * 60_000) return null;
  if (!canAskNow(date, clock).ok || pending()) return null;
  const P = await people();
  const q = await P.nextMatchQuestion().catch(() => null);
  if (!q) return null;
  const comms = await import("../people/comms.mjs");
  await comms.markAsked(q.id);
  vsettings.countAsk(date);
  matchWaiting = { ...q, at: Date.now() };
  deps.announce({ kind: "person", text: q.text, person: q.raw });
  return q;
}
export const pendingMatch = () => (matchWaiting && Date.now() - matchWaiting.at < 15 * 60_000 ? matchWaiting : null);
export async function answerMatch(text) {
  const m = pendingMatch(); if (!m) return null;
  const q = String(text).trim().toLowerCase().replace(/[.!?]+$/, "");
  const comms = await import("../people/comms.mjs"), P = await people();
  if (/^(yes|yeah|yep|yup|right|correct|that'?s (right|her|him|them)|same (person|one)|it is)\b/.test(q)) { await comms.answerMatch(m.id, m.personId); matchWaiting = null; return { reply: `Got it. I'll keep "${m.raw}" with ${P.find(m.personId)?.name ?? "them"}.` }; }
  const other = /^(?:no[,.]?\s*)?(?:it'?s|that'?s|that is|it is)\s+(.+)$/i.exec(String(text).trim());
  if (other && !/^(no|nope)$/i.test(other[1])) { const p = P.find(other[1]) ?? P.ensure(other[1].replace(/[.!?]+$/, "").slice(0, 60)); await comms.answerMatch(m.id, p.id); matchWaiting = null; return { reply: `Okay, "${m.raw}" is ${p.name}. Noted.` }; }
  if (/^(no|nope|not the same|different|wrong)\b/.test(q)) { await comms.answerMatch(m.id, null); matchWaiting = null; return { reply: "Okay, I'll keep them apart." }; }
  if (/^(skip|not now|later|never ?mind|i don'?t know)\b/.test(q)) { matchWaiting = null; return { reply: "No problem." }; }
  return null;
}
export function _reset() { waiting = null; matchWaiting = null; }
