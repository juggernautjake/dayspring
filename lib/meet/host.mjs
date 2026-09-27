// Dayspring in a Google Meet call: it opens the meeting in its own window (a small tile in the corner, or large), reads
// the captions to know who is talking, and answers people the owner allowed. Two assistants take part: Dayspring and
// Lantern (Lantern answers through its own API when it has one, else Dayspring answers for it, in Lantern's voice).
//
//   join(link) · rehearse() · leave() · close() · tile() · large() · status() · command(text) (the owner's)
//
// Privacy: only what's addressed to an assistant is acted on; everything else in the captions is dropped. The meeting's
// memory (who asked what) is kept in memory only and cleared when the meeting ends.
import { createRequire } from "node:module";
import { join as joinPath } from "node:path";
import {
  createMeetSession, createMeetListener, createPermissions, createNamePolicy, createMeetingMemory, createAddressParser,
  callName, displayName, nameKey, isSelf, firstName, opener, splitChat, meetLink, isMeetUrl,
} from "../../vendor/ecosystem-core/lib/meet/index.mjs";
import { broadcast } from "../bus.mjs";
import * as owner from "../owner.mjs";
import * as tunein from "../tunein.mjs";
import * as settings from "./settings.mjs";
import * as courseAnswer from "./course-answer.mjs";
import * as lanternAsk from "./lantern-ask.mjs";
import * as win from "./window.mjs";

const require = createRequire(import.meta.url);
const PORT = () => Number(process.env.PORT) || 4747;
const LABEL = { dayspring: "Dayspring", lantern: "Lantern" };

// ---- replaceable pieces (tests) ----------------------------------------------------------------------------------------
let deps = {
  chromium: () => require("playwright-core").chromium,
  channel: async () => { try { return (await import("../browsers.mjs")).playwrightChannel(); } catch { return "chrome"; } },
  generalReply: async ({ text, who, onSentence, signal }) => { const p = await import("../calls/pipeline.mjs"); return p.reply({ text, who, via: "meet", surface: "call", onSentence, signal }); },
  lanternGeneral: async ({ question }) => lanternGeneral(question),
  lanternSpeaking: async () => { try { return (await import("../lantern.mjs")).peerSpeakingNow(); } catch { return false; } },
  persona: async () => { try { return (await import("../persona/index.mjs")).get()?.preset ?? "default"; } catch { return "default"; } },
  now: () => Date.now(),
};
export function setDeps(d) { deps = { ...deps, ...d }; }

// ---- meeting state -----------------------------------------------------------------------------------------------------------
let session = null, stage = "closed", view = "large", link = null, rehearsal = false;
let check = { captions: null, chat: null, used: {}, at: 0 };
let perms = null, policy = null, memory = null, listener = null, parser = null;
let roster = new Set(), selfName = "", announced = false, joinedAt = 0, fallbackTunein = false;
let transcript = [];                               // this meeting's answered questions (addressed ones only)
let speakingUntil = 0, queue = Promise.resolve(), pendingLeave = 0, turnSeq = 0, poll = null;
const recentSaid = [];

function fresh() {
  const s = settings.get();
  perms = createPermissions({ mode: s.demo ? "everyone" : s.mode });
  policy = createNamePolicy({ now: deps.now });
  memory = createMeetingMemory({ now: deps.now });
  const assistantName = owner.assistant();
  parser = createAddressParser({ names: assistantName && assistantName !== "Dayspring" ? { dayspring: [assistantName] } : {} });
  roster = new Set(); selfName = ""; announced = false; transcript = []; recentSaid.length = 0; pendingLeave = 0; fallbackTunein = false;
  listener = createMeetListener({
    parser, permissions: perms,
    isOwner: (n) => isOwnerName(n),
    ownerSpeaking: () => deps.now() < speakingUntil || tunein.isSelfSpeaking(),
    isEcho: (t) => isEcho(t),
    onRequest: (req) => { noteName(req.speaker); enqueue(() => respond(req)); },
    onDenied: (d) => { noteName(d.speaker); broadcast("meet", { kind: "denied", as: d.assistant, who: displayName(d.speaker) }); },
  });
}
const isOwnerName = (n) => isSelf(n) || Boolean(selfName && nameKey(n) === nameKey(selfName));
const noteName = (n) => { const d = displayName(n); if (d && !isSelf(d) && !/^unknown/i.test(d)) roster.add(d); };
const norm = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
function isEcho(text) {
  const t = norm(text); if (t.length < 6) return false;
  const now = deps.now();
  return recentSaid.some((s) => now - s.at < 90_000 && (s.t.includes(t) || t.includes(s.t.slice(0, Math.min(40, s.t.length)))));
}
function noteSaid(text) { const t = norm(text); if (t) { recentSaid.push({ t, at: deps.now() }); while (recentSaid.length > 30) recentSaid.shift(); } tunein.noteSaid(text); }
function enqueue(fn) { queue = queue.then(fn, fn).catch((e) => console.log(`meet: ${e.message}`)); return queue; }

// ---- status ------------------------------------------------------------------------------------------------------------------
export const active = () => Boolean(session) && stage !== "closed" && stage !== "left";
export const inCall = () => stage === "in-call";
// Tune in stands down while the meeting reads captions (it knows who is talking; no double answers)
export const ownsCall = () => inCall() && check.captions !== false && !fallbackTunein;
export function status() {
  const s = settings.get();
  const people = [...roster].map((n) => ({ name: n, owner: isOwnerName(n), can: Object.fromEntries(["dayspring", "lantern"].map((a) => [a, perms?.allowed(n, a) ?? false])) }));
  return {
    stage, view, link: rehearsal ? "rehearsal" : link, rehearsal, mode: perms?.mode() ?? s.mode, assistants: ["dayspring", "lantern"], people,
    check: { captions: check.captions, chat: check.chat, used: check.used, at: check.at }, demo: s.demo, routeCourseToLantern: settings.routeToLantern(),
    announce: s.announce, fallbackTunein, answered: transcript.length, speaking: deps.now() < speakingUntil || tunein.isSelfSpeaking(), stats: listener?.stats() ?? null, selfName: selfName || null,
  };
}
const push = () => broadcast("meet", { kind: "state", ...status() });
export const recent = () => transcript.slice(-20);

// ---- the window ----------------------------------------------------------------------------------------------------------------
async function ensureSession() {
  if (session) return session;
  if (!perms) fresh();
  const chromium = deps.chromium();
  session = createMeetSession({
    chromium, channel: await deps.channel(), headless: process.env.DAYSPRING_MEET_HEADLESS === "1",
    profileDir: process.env.DAYSPRING_MEET_PROFILE || joinPath(process.env.LOCALAPPDATA || ".", win.PROFILE_NAME),
    args: [`--app=data:text/html,<title>Meet</title><body style="background:%23202124;color:%23e8eaed;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0">Opening the meeting…</body>`],
    allowUrl: (u) => new RegExp(`^http://(localhost|127\\.0\\.0\\.1):${PORT()}/api/meet/mock(\\?|$)`).test(u) || /^https:\/\/meet\.google\.com\/(landing)?(\?|$)/.test(u),
    onEvent: (e) => onEvent(e), log: (m) => console.log(m),
  });
  return session;
}
function onEvent(e) {
  if (e.type === "caption" || e.type === "chat") { if (e.speaker || e.author) noteName(e.speaker || e.author); listener?.event(e); return; }
  if (e.type === "tile-click") { large().catch(() => {}); return; }
  if (e.type === "state") { check = { ...check, captions: e.captions, chat: e.chat, at: deps.now() }; push(); return; }
  if (e.type === "stage") { stage = e.stage; push(); return; }
  if (e.type === "closed") { ended("closed"); }
}
export async function tile() {
  if (!session?.page) return { ok: false };
  const wa = await win.workArea();
  await session.bounds(win.tileBounds(wa), { scale: { width: win.PAGE.width, height: win.PAGE.height, factor: win.TILE.width / win.PAGE.width } });
  await session.setTile(true, "Click to enlarge");
  await win.topmost(true);
  view = "tile"; push();
  return { ok: true, view };
}
export async function large() {
  if (!session?.page) return { ok: false };
  const wa = await win.workArea();
  await session.setTile(false);
  await session.bounds(win.largeBounds(wa));
  await win.topmost(false);
  await session.page.bringToFront().catch(() => {});
  view = "large"; push();
  return { ok: true, view };
}

// ---- joining and leaving -------------------------------------------------------------------------------------------------------
export async function join(url, { isRehearsal = false } = {}) {
  const target = isRehearsal ? url : meetLink(url) ?? (isMeetUrl(url) ? url : null);
  if (!target) return { ok: false, reply: "That doesn't look like a Google Meet link. It looks like meet.google.com/abc-defg-hij." };
  if (active() && link === target) { await large(); return { ok: true, reply: "We're already in that meeting. Here it is." }; }
  if (active()) await leave({ quiet: true });
  fresh();
  rehearsal = isRehearsal; link = target; stage = "loading"; view = "large"; joinedAt = deps.now();
  if (!isRehearsal) settings.set({ lastLink: target });
  push();
  let r;
  try { const s = await ensureSession(); r = await s.open(target, { join: true }); }
  catch (e) { await close().catch(() => {}); return { ok: false, reply: `I couldn't open the meeting window: ${String(e.message).split(String.fromCharCode(10))[0]}` }; }
  stage = r.stage;
  if (stage === "sign-in") { waitForSignIn(); push(); return { ok: false, stage, reply: "Google wants you to sign in first. Sign in in the meeting window (I never type passwords), and I'll join as soon as you're in." }; }
  if (stage !== "in-call") { waitForJoin(); push(); return { ok: false, stage, reply: stage === "prejoin" ? "I'm at the meeting's door. If it says Ask to join, the host needs to let us in." : "The meeting is still loading. I'll keep trying." }; }
  await afterJoin();
  return { ok: true, stage, reply: `I'm in the meeting.${check.captions ? "" : " I can't read the captions yet; I'll keep trying."} It's in the bottom-right corner: click it to enlarge it.` };
}
function waitForSignIn() {
  clearInterval(poll);
  const until = deps.now() + 10 * 60_000;
  poll = setInterval(async () => {
    if (!session || deps.now() > until) { clearInterval(poll); return; }
    const st = await session.refreshStage().catch(() => stage);
    if (st !== "sign-in" && st !== "closed") { clearInterval(poll); settings.set({ signedIn: true }); const r = await session.open(link, { join: true }).catch(() => ({ stage })); stage = r.stage; if (stage === "in-call") await afterJoin(); else waitForJoin(); push(); }
  }, 3000);
  poll.unref?.();
}
function waitForJoin() {
  clearInterval(poll);
  const until = deps.now() + 10 * 60_000;
  poll = setInterval(async () => {
    if (!session || deps.now() > until) { clearInterval(poll); return; }
    const st = await session.refreshStage().catch(() => stage);
    if (st === "in-call") { clearInterval(poll); stage = st; await afterJoin(); }
  }, 2500);
  poll.unref?.();
}
async function afterJoin() {
  stage = "in-call";
  if (!rehearsal) settings.set({ signedIn: true });
  const caps = await session.enableCaptions().catch(() => false);
  await session.openChat().catch(() => false);
  selfName = await session.selfName().catch(() => "") || "";
  for (const p of await session.participants().catch(() => [])) noteName(p);
  const sc = await session.selfCheck().catch(() => ({}));
  check = { captions: Boolean(sc.captions ?? caps), chat: Boolean(sc.chatInput), used: sc.used ?? {}, at: deps.now() };
  if (check.captions) settings.set({ confirmed: { captionsSeen: true } });
  tunein.setStandDown(() => ownsCall());
  if (settings.get().announce && !announced) { announced = true; await postChat("dayspring", announcement()); }
  await tile().catch(() => {});
  // keep the people list fresh, and watch the captions: if they can't be read, Tune in listens instead
  clearInterval(poll);
  poll = setInterval(async () => {
    if (!session || stage !== "in-call") return;
    for (const p of await session.participants().catch(() => [])) noteName(p);
    const sc2 = await session.selfCheck().catch(() => null);
    if (sc2) {
      if (!sc2.inCall && sc2.open) { ended("left"); return; }
      check = { ...check, captions: Boolean(sc2.captions), chat: Boolean(sc2.chatInput), used: sc2.used ?? check.used, at: deps.now() };
      if (!sc2.captions && deps.now() - joinedAt > 20_000) captionsLost(); else if (sc2.captions && fallbackTunein) { fallbackTunein = false; push(); }
    }
    push();
  }, 8000);
  poll.unref?.();
  push();
}
async function captionsLost() {
  if (fallbackTunein) return;
  await session?.enableCaptions().catch(() => false);
  const sc = await session?.selfCheck().catch(() => null);
  if (sc?.captions) return;
  fallbackTunein = true;
  if (!tunein.isOn()) await tunein.start({}).catch(() => {});
  broadcast("meet", { kind: "notice", text: "I can't read the meeting's captions, so I'm listening with Tune in instead (it can't tell who's talking, so everyone's questions get the safe answers)." });
  push();
}
function announcement() {
  const N = owner.name(), mode = perms.mode();
  const who = mode === "everyone" ? "Anyone here can ask us things" : mode === "custom" ? `${N} can let people ask us things` : `${N} can let you ask us things`;
  return `Hi everyone! I'm Dayspring, ${N}'s assistant, and Lantern (the learning app) is here too. ${who}: start with "Dayspring," or "Lantern," out loud, or type @Dayspring or @Lantern here in the chat.`;
}
export async function leave({ quiet = false } = {}) {
  if (!session) { ended("left"); return { ok: true, reply: "We're not in a meeting." }; }
  await session.leave().catch(() => {});
  await session.close().catch(() => {});
  ended("left");
  return { ok: true, reply: quiet ? "" : "I left the meeting." };
}
function ended(why) {
  clearInterval(poll); poll = null;
  session = null; stage = why === "closed" ? "closed" : "left"; view = "large";
  tunein.setStandDown(null);
  // this meeting's memory goes with it
  memory?.clear(); policy?.clear(); listener?.clear(); transcript = []; roster = new Set(); recentSaid.length = 0;
  push();
  setTimeout(() => { if (!session) { stage = "closed"; push(); } }, 4000).unref?.();
}
// Pre-flight: open Meet's start page in the meeting window so the owner can sign in to Google (by themselves).
export async function openSignIn() {
  if (active() && stage !== "setup") { await large(); return { ok: true, reply: "The meeting window is open." }; }
  fresh();
  const s = await ensureSession();
  stage = "setup"; view = "large"; push();
  await s.open("https://meet.google.com/", { join: false, waitMs: 2500 }).catch(() => null);
  stage = "setup"; push();
  clearInterval(poll);
  const until = deps.now() + 10 * 60_000;
  const look = async () => {
    const u = s.page?.url() ?? "";
    const signedIn = /^https:\/\/meet\.google\.com\/(landing|new|[a-z]{3,4}-)/.test(u) || await s.page?.getByRole("button", { name: /new meeting/i }).first().isVisible().catch(() => false);
    if (signedIn) { clearInterval(poll); settings.set({ signedIn: true }); broadcast("meet", { kind: "notice", text: "You're signed in to Google in the meeting window ✓" }); push(); }
    else if (deps.now() > until) clearInterval(poll);
  };
  poll = setInterval(look, 3000); poll.unref?.();
  await look();
  return { ok: true, reply: settings.get().signedIn ? "You're signed in to Google in the meeting window." : "Sign in to Google in the meeting window (press Sign in there). I'll notice when you're in." };
}
export async function close() { if (session) await session.close().catch(() => {}); ended("closed"); }
export async function rehearse() {
  const q = settings.get().rehearsalQuestions;
  const qs = new URLSearchParams({ script: "demo" });
  for (const x of Array.isArray(q) && q.length ? q : []) qs.append("q", x);
  return join(`http://localhost:${PORT()}/api/meet/mock?${qs}`, { isRehearsal: true });
}

// ---- speaking and the chat ------------------------------------------------------------------------------------------------------
// One answer's voice, a sentence at a time: the Dayspring screen plays it into the call (one voice at a time).
function startTurn(as, heard) {
  const id = `meet-${deps.now()}-${++turnSeq}`;
  let seq = 0, chars = 0;
  return {
    id,
    part(text) {
      const t = String(text ?? "").replace(/\s+/g, " ").trim(); if (!t) return;
      noteSaid(t); chars += t.length;
      speakingUntil = Math.max(speakingUntil, deps.now()) + 1200 + t.length * 70;
      tunein.speaking(true, 1500 + t.length * 70);
      broadcast("tunein", { kind: "reply-part", id, seq: seq++, text: t, heard, final: false, as: as === "lantern" ? "lantern" : null });
    },
    end(full = "") { broadcast("tunein", { kind: "reply-part", id, seq, text: "", heard, final: true, full, as: as === "lantern" ? "lantern" : null }); },
    get spoken() { return seq > 0; }, get chars() { return chars; },
  };
}
export async function postChat(as, text) {
  if (!session) return false;
  let ok = true;
  for (const piece of splitChat(LABEL[as] ?? "Dayspring", text)) { noteSaid(piece); ok = (await session.sendChat(piece).catch(() => false)) && ok; }
  return ok;
}
async function waitForLanternVoice() { for (let i = 0; i < 30 && await deps.lanternSpeaking().catch(() => false); i++) await new Promise((r) => setTimeout(r, 500)); }

// ---- answering ------------------------------------------------------------------------------------------------------------------------
const OWNER_ONLY = /^(?:(?:please|hey|so|and|can you|could you|would you|will you)\s+)*(?:mute|unmute|leave|end|hang up|turn (?:on|off)|let |allow |stop letting|don'?t let|only (?:listen|answer)|kick|remove|admit|share|present|record|start|stop|open|close|demo mode|rehearse|shrink|minimi[sz]e|enlarge|bring)\b/i;
const CHANGES = /^(?:(?:please|hey|so|and|can you|could you|would you|will you|go ahead and|i need you to|i want you to)\s+)*(add|schedule|book|move|reschedule|cancel|delete|remove|clear|rename|change|set|switch|send|text|message|email|install|buy|order|pay|mark|update|edit|write|forget|remember|play|skip|pause)\b/i;

async function respond(req) {
  const { assistant, question, speaker, via, isOwner } = req;
  const t0 = deps.now();
  const key = isOwner ? "owner" : nameKey(speaker);
  const who = callName(speaker, [...roster, selfName].filter(Boolean), { selfName: owner.name() });
  const shown = isOwner ? owner.name() : displayName(speaker) || "Someone";
  broadcast("meet", { kind: "asked", as: assistant, who: shown, question, via });
  // the owner's meeting commands ("let Rich ask", "mute", "shrink the meeting"…)
  if (isOwner) { const c = await command(question, { inMeeting: true }); if (c) return speakAndPost({ as: "dayspring", spoken: c, heard: question, via, noChat: via === "voice" }); }
  const style = assistant === "lantern" ? "lantern" : await deps.persona();
  const nameNow = Boolean(who) && policy.decide(key);
  // a question about the course? (always answered: "how do I set a variable" isn't a request to change anything)
  const course = courseAnswer.courseId();
  const isCourse = course ? await courseAnswer.isCourseQuestion(question, { course, assistant }).catch(() => false) : false;
  if (!isOwner && !isCourse && (OWNER_ONLY.test(question) || CHANGES.test(question))) {
    const lead = nameNow ? opener(who, { style, kind: "refuse" }) + " " : "";
    policy.note(key, nameNow);
    return speakAndPost({ as: assistant, spoken: `${lead}${lead ? "only" : "Only"} ${owner.name()} can ask me to do that. I'm happy to answer questions, though.`, heard: question, via });
  }
  let as = assistant;
  let nameUsed = false;
  const say = { opener: "" };
  if (isCourse && as === "dayspring" && settings.routeToLantern()) {
    // Dayspring hands it to Lantern ("Great question, Rich. Lantern, want to take that one?")
    const lead = nameNow ? opener(who, { style, kind: "handoff" }) : "Great question.";
    nameUsed = nameNow;
    const turn = startTurn("dayspring", question); turn.part(`${lead} Lantern, want to take that one?`); turn.end();
    broadcast("meet", { kind: "handoff", from: "dayspring", to: "lantern", who: shown });
    as = "lantern";
  } else if (nameNow) { say.opener = opener(who, { style: as === "lantern" ? "lantern" : style, kind: "answer", n: policy.stats(key).uses }); nameUsed = true; }
  // "Building on Jess's question about sessions…" (when the asker's name isn't used this time; the earlier question has
  // to be about the same lesson or unit, looked up after retrieval)
  if (isCourse && !nameUsed) say.maybeBuilding = true;
  const card = { as, who: shown, question, via };
  await session?.badge({ as, text: `${LABEL[as]} — answering ${who ?? shown}`, speaking: true });
  broadcast("meet", { kind: "answering", ...card, text: `${LABEL[as]} — answering ${who ?? shown}` });
  if (as === "lantern") await waitForLanternVoice();
  let result;
  try {
    if (isCourse) result = await courseReply({ as, question, who, via, say, key, speaker, course });
    else result = await generalReply({ as, question, via, say, isOwner });
  } finally { await session?.badge(null); }
  if (say.buildingUsed) nameUsed = true;
  policy.note(key, nameUsed);
  memory.add({ name: who ?? shown, key, question, topic: result?.citations?.[0]?.title ?? null, ref: result?.citations?.[0]?.lessonId ?? null, group: result?.citations?.[0]?.unit?.n ?? null, assistant: as });
  const entry = { at: new Date().toISOString(), as, who: shown, question, via, spoken: result?.spoken ?? "", chat: result?.chat ?? "", citations: result?.citations ?? [], course: isCourse, ms: deps.now() - t0, nameUsed, lanternApi: Boolean(result?.lanternApi) };
  transcript.push(entry); if (transcript.length > 60) transcript.shift();
  broadcast("meet", { kind: "answer", ...entry });
  return entry;
}

async function courseReply({ as, question, who, via, say, key, course }) {
  const turn = via === "voice" ? startTurn(as, question) : null;
  let spokeLead = false;
  const lead = () => { if (turn && !spokeLead) { spokeLead = true; const b = say.building ? say.building + " " : ""; if (say.opener) turn.part(say.opener); if (b) turn.part(b); } };
  // Lantern's own answer first (when it offers /ask), else the answer from the course here
  let a = null;
  if (as === "lantern") {
    const la = await lanternAsk.ask({ question, askerName: who, course });
    if (la) a = { ...la, citations: la.citations.map((c) => ({ ...c, publicUrl: c.publicUrl ?? settingsUrl(course, c.lessonId) })), lanternApi: true };
  }
  const found = a ? null : await courseAnswer.retrieve(question, { course });
  if (found && !found.hits.length) return generalReply({ as, question, via, say });
  if (!a && say.maybeBuilding) {
    const rel = memory.related({ ref: found.hits[0]?.id, group: found.hits[0]?.unit?.n, notKey: key });
    if (rel?.name && rel.topic) { say.building = `Building on ${rel.name}'s question about ${rel.topic},`; say.buildingUsed = true; }
  }
  if (!a) {
    a = await courseAnswer.answer({ question, course, hits: found.hits, as, onSpoken: turn ? (text) => { lead(); turn.part(text); } : null });
  }
  const where = courseAnswer.whereSpoken(a.citations, { linkInChat: Boolean(session) });
  if (turn) {
    lead();
    if (!a.spokenSent) turn.part(a.spoken);
    turn.part(where);
    turn.end([say.opener, say.building, a.spoken, where].filter(Boolean).join(" "));
  }
  // the chat gets the detail and the links (the name only when it wasn't said out loud: never both)
  const namePrefix = via === "chat" && say.opener ? `${who} — ` : via === "chat" && say.building ? `${say.building} ` : "";
  const chat = `${namePrefix}${a.detail}\n${courseAnswer.whereChat(a.citations)}`.trim();
  await postChat(as, chat);
  return { spoken: turn ? [say.opener, say.building, a.spoken, where].filter(Boolean).join(" ") : "", chat, citations: a.citations, lanternApi: Boolean(a.lanternApi) };
}
const settingsUrl = (course, id) => settings.publicLessonUrl(course, id);

async function generalReply({ as, question, via, say, isOwner = false }) {
  const turn = via === "voice" ? startTurn(as, question) : null;
  if (turn && say.opener) turn.part(say.opener);
  let full = "";
  if (as === "lantern") {
    full = await deps.lanternGeneral({ question });
    if (turn) for (const s of full.split(/(?<=[.!?])\s+/)) turn.part(s);
  } else {
    const r = await deps.generalReply({ text: question, who: isOwner ? "owner" : "friend", onSentence: (s) => turn?.part(s) });
    full = r.reply;
  }
  turn?.end([say.opener, full].filter(Boolean).join(" "));
  let chat = "";
  if (via === "chat") { chat = (say.opener ? `${say.opener.replace(/[.!]$/, "")} — ` : "") + full; await postChat(as, chat); }
  return { spoken: turn ? [say.opener, full].filter(Boolean).join(" ") : "", chat, citations: [] };
}

// Lantern, when it isn't a course question: short, warm, and safe (it can't change anything either)
async function lanternGeneral(question) {
  const llm = await import("../llm.mjs");
  if (!llm.ready()) { const p = await import("../calls/pipeline.mjs"); return (await p.offlineAnswer(question)) ?? "I'm best with questions about my courses. Ask me about a lesson!"; }
  try {
    const { streamText, fastModel } = await import("../calls/stream-llm.mjs");
    let out = "";
    for await (const piece of streamText({ model: await fastModel(), maxTokens: 200, system: [
      "You are Lantern, a warm and wise learning companion (a glowing lantern that lights the way), in a live video meeting.",
      "Answer out loud in one or two short, warm sentences: plain words, no lists, no markdown. You can't change anything from here.",
      `Keep ${owner.name()}'s private life private.`].join("\n"), prompt: `Heard: ${question}\nYour answer:` })) out += piece;
    return out.replace(/[*_#`]/g, "").trim() || "Hmm, I'm not sure about that one.";
  } catch { return "Sorry, I couldn't get an answer just then."; }
}

async function speakAndPost({ as, spoken, heard, via, noChat = false }) {
  if (via === "voice") { const t = startTurn(as, heard); for (const s of String(spoken).split(/(?<=[.!?])\s+/)) t.part(s); t.end(spoken); }
  else if (!noChat) await postChat(as, spoken);
  const entry = { at: new Date().toISOString(), as, who: null, question: heard, via, spoken: via === "voice" ? spoken : "", chat: via === "chat" ? spoken : "", citations: [], course: false };
  transcript.push(entry);
  broadcast("meet", { kind: "answer", ...entry });
  return entry;
}

// ---- the owner's commands (said to Dayspring anywhere, or in the meeting) ------------------------------------------------------------
export async function command(text, { inMeeting = false } = {}) {
  const raw = String(text ?? "").trim();
  const t = raw.toLowerCase().replace(/[.!?]+$/g, "").replace(/^(?:hey |ok(?:ay)? )?(?:dayspring[, ]+)?/, "").replace(/^(?:please |can you |could you |would you )+/, "").trim();
  // a pasted Meet link, or "join my meeting"
  const url = meetLink(raw);
  if (url && (/^(?:join|open|go to|start)\b/.test(t) || raw.replace(/\s+/g, "") === url || raw.replace(/^https?:\/\//, "").replace(/\s+/g, "") === url.replace(/^https:\/\//, ""))) return (await join(url)).reply;
  if (/^(?:join|open|start|get (?:me |us )?into) (?:my |the |our )?(?:google )?(?:meet|meeting|call|video call)(?: now)?$/.test(t)) {
    const last = settings.get().lastLink;
    if (last) return (await join(last)).reply;
    return "Paste the Google Meet link here (it looks like meet.google.com/abc-defg-hij) and I'll join it.";
  }
  if (/^(?:start (?:a |the )?rehearsal|rehearse(?: the)? (?:meeting|demo)|practi[cs]e the demo)$/.test(t)) return (await rehearse()).reply;
  if (/^(?:turn (on|off) demo mode|demo mode (on|off))$/.test(t)) { const on = /on/.test(RegExp.$1 || RegExp.$2); setDemo(on); return on ? "Demo mode is on: anyone in the meeting can ask Dayspring or Lantern, and course questions go to Lantern." : "Demo mode is off. Only you can ask now, unless you let people."; }
  if (!active()) return null;
  // the window
  if (/^(?:bring (?:the )?meeting back|show (?:me )?the meeting|enlarge the meeting|make the meeting (?:big|bigger|large)|open the meeting|meeting (?:big|large))$/.test(t)) { await large(); return "Here's the meeting."; }
  if (/^(?:shrink|minimi[sz]e|hide) the meeting|^(?:put|move) the meeting (?:in|to) the corner$|^meeting (?:small|to the corner)$/.test(t)) { await tile(); return "The meeting is in the corner. Click it to bring it back."; }
  // the call
  if (/^(?:mute|mute me|mute my (?:mic|microphone)|mute the (?:mic|microphone)|turn off my (?:mic|microphone))$/.test(t)) return micTo("muted");
  if (/^(?:unmute|unmute me|unmute my (?:mic|microphone)|turn on my (?:mic|microphone))$/.test(t)) return micTo("on");
  if (/^(?:turn (on|off) my camera|camera (on|off)|turn my camera (on|off))$/.test(t)) { await session.toggleCamera(); return "Camera switched."; }
  if (/^(?:turn (on|off) (?:the )?captions|captions (on|off))$/.test(t)) { if (/on/.test(t)) { const ok = await session.enableCaptions(); return ok ? "Captions are on." : "I couldn't turn captions on. Press C in the meeting window."; } await session.toggleCaptions(); return "Captions switched."; }
  if (/^(?:open|show) (?:the )?(?:meeting )?chat$/.test(t)) { await large(); await session.openChat(); return "The chat is open."; }
  if (/^(?:share my screen|present(?: my screen)?|start presenting)$/.test(t)) { await large(); return "In the meeting window, press Present now (the screen with an arrow at the bottom), choose A window or Entire screen, and pick what to share. The picker is Chrome's own, so you choose it yourself."; }
  if (/^(?:who(?:'s| is) (?:in|on) (?:the |this )?(?:meeting|call)|who(?:'s| is) here)$/.test(t)) {
    const list = [...roster].filter((n) => !isOwnerName(n));
    return list.length ? `In the meeting: ${list.join(", ")}${list.length > 1 ? "" : ""}, and you.` : "It's just us so far.";
  }
  if (/^(?:leave|end|hang up|exit)(?: the)? (?:meeting|call)$|^hang up$/.test(t)) { pendingLeave = deps.now() + 20_000; return "Leave the meeting? Say “yes, leave” to confirm."; }
  if (pendingLeave && deps.now() < pendingLeave && /^(?:yes|yeah|yep|confirm)(?:,? (?:leave|go|do it|please))?$|^yes leave$/.test(t)) { pendingLeave = 0; return (await leave()).reply || "I left the meeting."; }
  if (/^(?:is the meeting (?:working|ok|okay)|meeting (?:check|status)|can you (?:read|see) the captions)$/.test(t)) {
    const sc = await session.selfCheck().catch(() => ({}));
    return `Captions ${sc.captions ? "detected ✓" : "not detected ✗"}, chat ${sc.chatInput ? "ready ✓" : "not ready ✗"}, ${Math.max(0, (sc.participants ?? 1) - 1)} other people.`;
  }
  // who may ask (the people list read fresh, so someone who just joined can be named)
  for (const p of await session.participants().catch(() => [])) noteName(p);
  const pc = perms.command(raw.replace(/^(?:hey |ok(?:ay)? )?(?:dayspring[, ]+)?/i, ""), [...roster]);
  if (pc) { if (pc.mode) settings.set({ mode: pc.mode }); push(); return pc.reply; }
  return inMeeting ? null : null;
}
async function micTo(want) {
  const now = await session.micState().catch(() => null);
  if (now === want) return want === "muted" ? "You're already muted." : "Your mic is already on.";
  await session.toggleMic();
  return want === "muted" ? "Muted." : "You're unmuted.";
}
export function setDemo(on) {
  settings.set({ demo: Boolean(on) });
  if (perms) { if (on) perms.setMode("everyone"); else perms.setMode(settings.get().mode === "everyone" ? "only-me" : settings.get().mode); }
  push();
}
export function setPermission({ mode, name, can } = {}) {
  if (!perms) fresh();
  if (mode) { perms.setMode(mode); settings.set({ mode }); }
  if (name && can) perms.set(name, can);
  push();
  return status();
}

// tests
export const _listener = () => listener;
export const _session = () => session;
export function _reset() { clearInterval(poll); session = null; stage = "closed"; perms = null; fresh(); }
