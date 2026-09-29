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
  createMeetSession, createMeetListener, createPermissions, createNamePolicy, createMeetingMemory, createAddressParser, createRoster,
  callName, displayName, nameKey, isSelfLabel, firstName, opener, splitChat, meetLink, isMeetUrl, parseNotice, isOwnMessage, matchPerson,
} from "../../vendor/ecosystem-core/lib/meet/index.mjs";
import { broadcast, displayCount } from "../bus.mjs";
import * as owner from "../owner.mjs";
import * as wakeword from "../wakeword.mjs";
import * as tunein from "../tunein.mjs";
import * as settings from "./settings.mjs";
import * as courseAnswer from "./course-answer.mjs";
import * as lanternAsk from "./lantern-ask.mjs";
import * as win from "./window.mjs";
import * as ocr from "./ocr.mjs";
import * as notes from "./notes.mjs";
import { on as featureOn } from "../features.mjs";

const require = createRequire(import.meta.url);
const PORT = () => Number(process.env.PORT) || 4747;
// the chat signature and the badge: the assistant's own name ("Nova: …"), Lantern's
const A = () => owner.assistant();
const LABEL = { get dayspring() { return A(); }, lantern: "Lantern" };

// ---- replaceable pieces (tests) ----------------------------------------------------------------------------------------
let deps = {
  chromium: () => require("playwright-core").chromium,
  channel: async () => { try { return (await import("../browsers.mjs")).playwrightChannel(); } catch { return "chrome"; } },
  generalReply: async ({ text, who, onSentence, signal }) => { const p = await import("../calls/pipeline.mjs"); return p.reply({ text, who, via: "meet", surface: "call", onSentence, signal }); },
  lanternGeneral: async ({ question }) => lanternGeneral(question),
  lanternSpeaking: async () => { try { return (await import("../lantern.mjs")).peerSpeakingNow(); } catch { return false; } },
  persona: async () => { try { return (await import("../persona/index.mjs")).get()?.preset ?? "default"; } catch { return "default"; } },
  now: () => Date.now(),
  tuneinOn: () => tunein.isOn(),
  tuneinStart: () => tunein.start({}),
  tuneinStop: () => tunein.stop({ quiet: true }),
  // people's profiles: lib/people/comms writes nothing unless "Save call history" is on (loaded only when a meeting ends)
  logCall: async (call) => (await import("../people/comms.mjs")).logCall(call),
};
export function setDeps(d) { deps = { ...deps, ...d }; }
// a meeting's summary is ready (written in the background after it ends)
notes.setDeps({ onDone: (id) => broadcast("meet", { kind: "notes", state: "summary", id }) });

// ---- meeting state -----------------------------------------------------------------------------------------------------------
let session = null, stage = "closed", view = "large", link = null, rehearsal = false;
let check = { captions: null, chat: null, used: {}, at: 0 };
let perms = null, policy = null, memory = null, listener = null, parser = null;
// people: who is in the call, merged from the People list, the tiles, captions, chat and Meet's notices (roster.mjs)
let people = null, selfName = "", announced = false, joinedAt = 0, fallbackTunein = false;
let lastPanelAt = 0, lastOcrAt = 0, domPeopleAt = 0, lastRecaption = 0, captionsWanted = true, impostorWarned = false;
let transcript = [];                               // this meeting's answered questions (addressed ones only)
let speakingUntil = 0, queue = Promise.resolve(), pendingLeave = 0, turnSeq = 0, poll = null;
// gen: which meeting this is. Work that started in a meeting that has since ended (a join still polling, an answer
// still being written) checks it and stops, so nothing is spoken, kept or switched on after leaving.
let gen = 0, opening = null, joining = null, startedTunein = false;
const recentSaid = [];

function fresh() {
  const s = settings.get();
  perms = createPermissions({ mode: s.demo ? "everyone" : s.mode });
  policy = createNamePolicy({ now: deps.now });
  memory = createMeetingMemory({ now: deps.now });
  parser = addressParser();
  people = createRoster({ now: deps.now });
  selfName = ""; announced = false; transcript = []; recentSaid.length = 0; pendingLeave = 0; fallbackTunein = false;
  lastPanelAt = 0; lastOcrAt = 0; domPeopleAt = 0; lastRecaption = 0; captionsWanted = true; impostorWarned = false;
  listener = createMeetListener({
    parser, permissions: perms, speakers: [...new Set([A(), "Dayspring", "Lantern"])],
    isOwner: (n) => isOwnerName(n),
    ownerSpeaking: () => deps.now() < speakingUntil || tunein.isSelfSpeaking(),
    isEcho: (t) => isEcho(t),
    onRequest: (req) => { const g = gen; enqueue(() => (g === gen ? respond(req) : null)); },
    onDenied: (d) => { broadcast("meet", { kind: "denied", as: d.assistant, who: displayName(d.speaker) }); },
  });
}
// Who was addressed: the shared parser (Lantern's name and its mishearings, "Dayspring" and its mishearings, plus the
// assistant's own name and wake words that aren't everyday words, anywhere in a caption), then the owner's wake words
// the way every other listener hears them (lib/wakeword.mjs: sound-alikes and everyday words, at the start or after a pause).
function addressParser() {
  // (a function: read on every caption, so a rename or a new wake word counts mid-meeting; "Dayspring" always works too)
  const base = createAddressParser({ names: () => ({ dayspring: (deps.meetNames ?? wakeword.meetNames)() }) });
  const fuzzy = (text) => {
    const m = wakeword.match(text);
    if (!m) return null;
    const words = (t) => (String(t).match(/\S+/g) ?? []).length;
    return { assistant: "dayspring", question: words(m.rest) >= 1 ? m.rest : words(m.before) >= 3 ? m.before : m.rest, wake: m.wake, index: m.index };
  };
  return { get names() { return base.names; }, parse: (t) => base.parse(t) ?? fuzzy(t), parseLast: (t) => base.parseLast(t) ?? fuzzy(t) };
}
// The owner is who Meet labels "You" (in its language). Never by name: a guest can call themselves anything, and one
// who calls themselves "You" makes the label useless (people.impostor): then nobody gives owner commands in the call.
const isOwnerName = (n) => !people?.impostor() && isSelfLabel(n, people?.lang() ?? "en");
const names = () => (people ? people.people().map((p) => p.name) : []);
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
  const who = people?.status() ?? null;
  const list = (who?.people ?? []).map((p) => ({ name: p.name, owner: false, presenting: p.presenting, sources: p.sources, can: Object.fromEntries(["dayspring", "lantern"].map((a) => [a, perms?.allowed(p.name, a) ?? false])) }));
  return {
    stage, view, link: rehearsal ? "rehearsal" : link, rehearsal, mode: perms?.mode() ?? s.mode, assistants: ["dayspring", "lantern"], people: list,
    roster: who ? { count: who.count, expected: who.expected, agrees: who.agrees, sources: who.sources, impostor: who.impostor, talking: who.talking, lang: who.lang } : null,
    check: { captions: check.captions, chat: check.chat, used: check.used, at: check.at, people: peopleCheck(), ocr: check.ocr ?? null }, demo: s.demo, routeCourseToLantern: settings.routeToLantern(),
    notes: notes.status(), notesOn: s.notes !== false, recordAudio: Boolean(s.recordAudio), notesKeepDays: s.notesKeepDays ?? 90,
    announce: s.announce, fallbackTunein, answered: transcript.length, speaking: deps.now() < speakingUntil || tunein.isSelfSpeaking(), stats: listener?.stats() ?? null, selfName: selfName || null,
  };
}
const push = () => broadcast("meet", { kind: "state", ...status() });
export const recent = () => transcript.slice(-20);

// ---- the window ----------------------------------------------------------------------------------------------------------------
// One meeting window at a time: two joins at once share the same launch (never two Chromes on one profile).
async function ensureSession() {
  if (session) return session;
  opening ??= makeSession().finally(() => { opening = null; });
  return opening;
}
async function makeSession() {
  if (!perms) fresh();
  const chromium = deps.chromium();
  const channel = await deps.channel();
  if (session) return session;
  session = createMeetSession({
    chromium, channel, headless: process.env.DAYSPRING_MEET_HEADLESS === "1",
    profileDir: process.env.DAYSPRING_MEET_PROFILE || joinPath(process.env.LOCALAPPDATA || ".", win.PROFILE_NAME),
    args: [`--app=data:text/html,<title>Meet</title><body style="background:%23202124;color:%23e8eaed;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0">Opening the meeting…</body>`],
    allowUrl: (u) => new RegExp(`^http://(localhost|127\\.0\\.0\\.1):${PORT()}/api/meet/mock(\\?|$)`).test(u) || /^https:\/\/meet\.google\.com\/(landing)?(\?|$)/.test(u),
    onEvent: (e) => onEvent(e), log: (m) => console.log(m),
  });
  return session;
}
// Who a transcript line is from: the owner by name (Meet says "You"), everyone else as Meet shows them
const whoFor = (raw) => (isSelfLabel(raw, people?.lang() ?? "en") ? (people?.impostor() ? "“You”" : owner.name()) : displayName(raw) || null);
function onEvent(e) {
  if (e.type === "caption") {
    people?.seen("caption", e.speaker);
    // (Dayspring's and Lantern's own voice comes back captioned as the owner: their answers are kept as answers instead)
    const echo = isSelfLabel(e.speaker, people?.lang() ?? "en") && (deps.now() < speakingUntil || tunein.isSelfSpeaking() || isEcho(e.text));
    notes.caption({ id: e.id, who: whoFor(e.speaker), text: e.text, echo });
    listener?.event(e); return;
  }
  if (e.type === "chat") {
    people?.seen("chat", e.author);
    if (!isOwnMessage(e.text)) notes.chat({ who: whoFor(e.author), text: e.text });
    listener?.event(e); return;
  }
  if (e.type === "roster") { applyRoster(e); push(); return; }
  if (e.type === "speaking") { people?.speaking(e.name, { source: e.source, confidence: e.confidence }); return; }
  if (e.type === "notice") {
    const n = parseNotice(e.text); if (!n || !people) return;
    if (n.action === "joined") people.joined(n.name); else if (n.action === "left") people.left(n.name); else people.presenting(n.name);
    if (n.action !== "presenting") notes.presence({ action: n.action, who: displayName(n.name) });
    push(); return;
  }
  if (e.type === "tile-click") { large().catch(() => {}); return; }
  if (e.type === "state") {
    const was = check.captions;
    check = { ...check, captions: e.captions, chat: e.chat, at: deps.now() };
    if (e.lang) people?.setLang(e.lang);
    // captions went off by themselves (Meet does that sometimes): turned back on, unless the owner turned them off
    if (was === true && e.captions === false && inCall() && captionsWanted) recaption();
    push(); return;
  }
  if (e.type === "stage") { stage = e.stage; push(); return; }
  if (e.type === "closed") { ended("closed"); }
}
async function recaption() {
  if (deps.now() - lastRecaption < 10_000 || !session) return;
  lastRecaption = deps.now();
  await session.enableCaptions().catch(() => false);
}
// What the page shows about who's here (the tiles, the People list when it's open, the count on its button)
function applyRoster(r) {
  if (!people || !r) return;
  if (r.lang) people.setLang(r.lang);
  if (Array.isArray(r.tiles)) people.snapshot("tiles", r.tiles);
  if (Array.isArray(r.panel)) { people.snapshot("panel", r.panel); lastPanelAt = deps.now(); }
  if (r.count) people.count(r.count);
  if (r.tiles?.length || r.panel?.length) domPeopleAt = deps.now();
  const me = people.self().name; if (me && !selfName) selfName = me;
  if (people.impostor() && !impostorWarned) {
    impostorWarned = true;
    broadcast("meet", { kind: "notice", text: "Someone in the meeting is named “You”, like you are in the captions, so I can't tell you apart there: meeting commands said in the call are off. Use the Dayspring screen for them." });
  }
}
async function refreshPeople(s, { panel = false } = {}) {
  const r = panel ? await s.readPeople().catch(() => null) : await s.roster().catch(() => null);
  if (r && s === session) applyRoster(r);
  return r;
}
// Nothing on the page says who's here (no tiles or People list can be read): the names on a picture of the window,
// read on this computer by Windows (never sent anywhere), at most once a minute.
async function peopleFromPicture(s, g, { force = false } = {}) {
  if (!people || !ocr.available() || settings.get().ocr === false) return null;
  if (!force && (domPeopleAt || deps.now() - lastOcrAt < 60_000 || deps.now() - joinedAt < 20_000)) return null;
  lastOcrAt = deps.now();
  const png = await s.screenshot().catch(() => null);
  if (!png || g !== gen) return null;
  const r = await ocr.namesFromPicture(png).catch(() => null);
  if (!r?.ok || g !== gen || !people) return null;
  people.snapshot("ocr", r.names);
  check = { ...check, ocr: { at: deps.now(), names: r.names.length, ms: r.ms } };
  push();
  return r.names;
}
// ---- meeting notes: the heads-up comes first, then the notes -------------------------------------------------------------
function meetingTitle(sc = {}) {
  if (rehearsal) return "Rehearsal";
  const t = String(sc.title ?? session?.status?.().title ?? "").replace(/^Meet\s*[-–—:]\s*/i, "").replace(/\s*[-–—]\s*Google Meet$/i, "").trim();
  return t && !/^meet$/i.test(t) && !/^[a-z]{3,4}-[a-z]{3,5}-[a-z]{3,4}$/.test(t) ? t.slice(0, 80) : "Meeting";
}
function headsUp(audio) {
  const N = owner.name();
  return {
    chat: `Heads up: ${A()} is taking notes${audio ? " and recording the audio" : ""} in this meeting, for a summary. They're kept on ${N}'s computer. ${N} can say “${A()}, don't record this part” at any time.`,
    spoken: `Heads up: I'm taking notes in this meeting${audio ? " and recording the audio" : ""}, for a summary.`,
  };
}
// Everyone is told (in the chat, and out loud when the Dayspring screen is open to speak into the call) before a single
// word is written down. If neither can reach the meeting, no notes are taken.
async function startNotes(g, { title = "Meeting" } = {}) {
  if (g !== gen || !session) return false;
  if (!featureOn("meetnotes")) return false;   // meeting notes switched off (lib/features.mjs): nothing is written down
  const audio = Boolean(settings.get().recordAudio);
  if (!notes.active()) notes.begin({ title, link: rehearsal ? null : link, rehearsal });
  const h = headsUp(audio);
  const posted = await postChat("dayspring", h.chat);
  const spoken = displayCount() > 0;
  if (spoken) { const turn = startTurn("dayspring", ""); turn.part(h.spoken); turn.end(h.spoken); }
  if (g !== gen) return false;
  if (!posted && !spoken) {
    broadcast("meet", { kind: "notice", text: "I couldn't tell the meeting I'm taking notes (its chat didn't work and the Dayspring screen isn't open), so I'm not taking any. Say “start taking notes” to try again." });
    return false;
  }
  notes.live({ audio });
  await showRec();
  push();
  return true;
}
async function showRec() {
  const st = notes.status();
  await session?.rec(st.on && st.live ? { paused: Boolean(st.paused), text: st.paused ? "Notes paused" : st.audio ? "Notes · recording" : "Notes" } : null);
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
  if (joining && link === target) return joining;              // a second click on Join while it's joining
  joining = joinNow(target, isRehearsal).finally(() => { joining = null; });
  return joining;
}
async function joinNow(target, isRehearsal) {
  if (active() && link === target) { await large(); return { ok: true, reply: "We're already in that meeting. Here it is." }; }
  if (active()) await leave({ quiet: true });
  fresh();
  const g = gen;
  rehearsal = isRehearsal; link = target; stage = "loading"; view = "large"; joinedAt = deps.now();
  if (!isRehearsal) settings.set({ lastLink: target });
  push();
  let r;
  try { const s = await ensureSession(); r = await s.open(target, { join: true }); }
  catch (e) { if (g === gen) await close().catch(() => {}); return { ok: false, reply: `I couldn't open the meeting window: ${String(e.message).split(String.fromCharCode(10))[0]}` }; }
  if (g !== gen) return { ok: false, reply: "The meeting was closed." };
  stage = r.stage;
  if (stage === "sign-in") { waitForSignIn(); push(); return { ok: false, stage, reply: "Google wants you to sign in first. Sign in in the meeting window (I never type passwords), and I'll join as soon as you're in." }; }
  if (stage !== "in-call") { waitForJoin(); push(); return { ok: false, stage, reply: stage === "prejoin" ? "I'm at the meeting's door. If it says Ask to join, the host needs to let us in." : "The meeting is still loading. I'll keep trying." }; }
  await afterJoin(g);
  if (g !== gen) return { ok: false, reply: "The meeting was closed." };
  return { ok: true, stage, reply: `I'm in the meeting.${check.captions ? "" : " I can't read the captions yet; I'll keep trying."} It's in the bottom-right corner: click it to enlarge it.` };
}
// (each tick checks it's still the same meeting and that the last tick is done: a slow page never runs two at once)
function waitForSignIn() {
  clearInterval(poll);
  const g = gen, s = session, until = deps.now() + 10 * 60_000;
  let busy = false;
  const me = poll = setInterval(async () => {
    if (g !== gen || session !== s || !s || deps.now() > until) { clearInterval(me); return; }
    if (busy) return; busy = true;
    try {
      const st = await s.refreshStage().catch(() => stage);
      if (g !== gen) return;
      if (st !== "sign-in" && st !== "closed") {
        clearInterval(me); settings.set({ signedIn: true });
        const r = await s.open(link, { join: true }).catch(() => ({ stage }));
        if (g !== gen) return;
        stage = r.stage; if (stage === "in-call") await afterJoin(g); else waitForJoin(); push();
      }
    } finally { busy = false; }
  }, 3000);
  poll.unref?.();
}
function waitForJoin() {
  clearInterval(poll);
  const g = gen, s = session, until = deps.now() + 10 * 60_000;
  let busy = false;
  const me = poll = setInterval(async () => {
    if (g !== gen || session !== s || !s || deps.now() > until) { clearInterval(me); return; }
    if (busy) return; busy = true;
    try {
      const st = await s.refreshStage().catch(() => stage);
      if (st === "in-call" && g === gen) { clearInterval(me); stage = st; await afterJoin(g); }
    } finally { busy = false; }
  }, 2500);
  poll.unref?.();
}
async function afterJoin(g = gen) {
  if (g !== gen || !session) return;
  const s = session, live = () => g === gen && session === s;
  if (!rehearsal) settings.set({ signedIn: true });
  const caps = await s.enableCaptions().catch(() => false);
  await s.openChat().catch(() => false);
  if (!live()) return;
  await refreshPeople(s, { panel: true });            // the People list, read once (then closed again)
  if (!live()) return;
  if (!selfName) selfName = await s.selfName().catch(() => "") || "";
  const sc = await s.selfCheck().catch(() => ({}));
  if (!live()) return;
  check = { captions: Boolean(sc.captions ?? caps), chat: Boolean(sc.chatInput), used: sc.used ?? {}, at: deps.now() };
  if (check.captions) settings.set({ confirmed: { captionsSeen: true } });
  if (peopleCheck().ok) settings.set({ confirmed: { peopleSeen: true } });
  tunein.setStandDown(() => ownsCall());
  if (settings.get().announce && !announced) { announced = true; await postChat("dayspring", announcement()); }
  if (settings.get().notes !== false) await startNotes(g, { title: meetingTitle(sc) });
  await tile().catch(() => {});
  if (!live()) return;
  // keep the people list fresh, and watch the captions: if they can't be read, Tune in listens instead
  clearInterval(poll);
  let busy = false;
  const me = poll = setInterval(async () => {
    if (!live()) { clearInterval(me); return; }
    if (stage !== "in-call" || busy) return;
    busy = true;
    try {
      // the People list again when Meet's count and ours disagree (at most every 90 s: it flickers the side panel);
      // the picture of the window when the page shows nobody at all
      const st = people?.status();
      await refreshPeople(s, { panel: st?.agrees === false && deps.now() - lastPanelAt > 90_000 });
      await peopleFromPicture(s, g);
      if (!live()) return;
      await showRec();                                 // (the "● Notes" sign, again if the page was reloaded)
      const sc2 = await s.selfCheck().catch(() => null);
      if (!live()) return;
      if (sc2) {
        // left from the meeting window itself (or the host ended it): its window closes too, so the next join never
        // finds a leftover Chrome holding the meeting profile
        if (!sc2.inCall && sc2.open) { ended("left"); await s.close().catch(() => {}); return; }
        check = { ...check, captions: Boolean(sc2.captions), chat: Boolean(sc2.chatInput), used: sc2.used ?? check.used, at: deps.now() };
        if (peopleCheck().ok && !settings.get().confirmed?.peopleSeen) settings.set({ confirmed: { peopleSeen: true } });
        if (!sc2.captions && deps.now() - joinedAt > 20_000) await captionsLost(g); else if (sc2.captions && fallbackTunein) { fallbackTunein = false; push(); }
      }
      push();
    } finally { busy = false; }
  }, 8000);
  poll.unref?.();
  push();
}
async function captionsLost(g = gen) {
  if (fallbackTunein) return;
  await session?.enableCaptions().catch(() => false);
  const sc = await session?.selfCheck().catch(() => null);
  if (sc?.captions || g !== gen || !session) return;
  fallbackTunein = true;
  tunein.setHeard((text) => notes.heard(text));      // the notes keep what Tune in hears (who said it isn't known)
  // (Tune in switched on here is switched off again when the meeting ends; one the owner had on stays on)
  if (!deps.tuneinOn()) { startedTunein = true; await Promise.resolve().then(() => deps.tuneinStart()).catch(() => { startedTunein = false; }); }
  broadcast("meet", { kind: "notice", text: "I can't read the meeting's captions, so I'm listening with Tune in instead (it can't tell who's talking, so everyone's questions get the safe answers)." });
  push();
}
function announcement() {
  const N = owner.name(), mode = perms.mode();
  const who = mode === "everyone" ? "Anyone here can ask us things" : mode === "custom" ? `${N} can let people ask us things` : `${N} can let you ask us things`;
  const a = A(), w = wakeword.display()[0]?.replace(/^(Hey|Ok|Okay|Hi) /, "") || a;   // (what it answers to, the way it's written)
  return `Hi everyone! I'm ${a}, ${N}'s assistant, and Lantern (the learning app) is here too. ${who}: start with "${w}," or "Lantern," out loud, or type @${a.replace(/\s+/g, "")} or @Lantern here in the chat.`;
}
export async function leave({ quiet = false } = {}) {
  if (!session) { ended("left"); return { ok: true, reply: "We're not in a meeting." }; }
  await session.leave().catch(() => {});
  await session.close().catch(() => {});
  ended("left");
  return { ok: true, reply: quiet ? "" : "I left the meeting." };
}
// Who was in the meeting, onto their people profiles as a "meet" call (only with "Save call history" on; comms.logCall
// checks that itself). Never for a rehearsal: its people are made up.
export async function _logAttendees(attendance, { rehearsal: isRehearsal = false, start = 0, end = Date.now() } = {}) {
  if (isRehearsal || !start) return 0;
  let n = 0;
  for (const a of attendance ?? []) {
    const who = String(a?.name ?? "").trim();
    if (!who) continue;
    const r = await deps.logCall({ who, app: "meet", start: a.joinedAt || start, end: a.leftAt || end });
    if (r?.length) n += r.length;
  }
  return n;
}
function ended(why) {
  const attendees = people?.history() ?? [], wasRehearsal = rehearsal, startedAt = session ? joinedAt : 0;
  if (attendees.length) _logAttendees(attendees, { rehearsal: wasRehearsal, start: startedAt, end: deps.now() }).catch((e) => console.log(`meet call history: ${e.message}`));
  gen++;
  clearInterval(poll); poll = null;
  session = null; stage = why === "closed" ? "closed" : "left"; view = "large";
  tunein.setStandDown(null);
  tunein.setHeard(null);
  fallbackTunein = false;
  // the notes are saved (the summary is written in the background), then everything about the meeting is forgotten
  if (notes.active()) {
    const me = people?.self();
    notes.finish({ attendance: people?.history() ?? [], self: { name: owner.name(), talkMs: me?.talkMs ?? 0 } })
      .then((r) => { if (r) broadcast("meet", { kind: "notes", state: "saved", id: r.id }); }).catch((e) => console.log(`meet notes: ${e.message}`));
  }
  if (startedTunein) { startedTunein = false; Promise.resolve().then(() => deps.tuneinStop()).catch(() => {}); }
  // this meeting's memory goes with it (who asked what, who was there and who was allowed to ask)
  memory?.clear(); policy?.clear(); listener?.clear(); people?.clear(); transcript = []; recentSaid.length = 0;
  perms = null; selfName = "";
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
  const id = `meet-${deps.now()}-${++turnSeq}`, g = gen;
  let seq = 0, chars = 0;
  return {
    id,
    part(text) {
      const t = String(text ?? "").replace(/\s+/g, " ").trim(); if (!t || g !== gen) return;
      noteSaid(t); chars += t.length;
      speakingUntil = Math.max(speakingUntil, deps.now()) + 1200 + t.length * 70;
      tunein.speaking(true, 1500 + t.length * 70);
      broadcast("tunein", { kind: "reply-part", id, seq: seq++, text: t, heard, final: false, as: as === "lantern" ? "lantern" : null });
    },
    end(full = "") { if (g !== gen && !seq) return; broadcast("tunein", { kind: "reply-part", id, seq, text: "", heard, final: true, full, as: as === "lantern" ? "lantern" : null }); },
    get spoken() { return seq > 0; }, get chars() { return chars; },
  };
}
export async function postChat(as, text) {
  if (!session) return false;
  let ok = true;
  // (chat is never spoken, so it isn't noted as Dayspring's own voice: a command it quotes, like “yes, leave”, can
  // still be said by the owner right after)
  for (const piece of splitChat(LABEL[as] ?? "Dayspring", text)) ok = (await session.sendChat(piece).catch(() => false)) && ok;
  return ok;
}
async function waitForLanternVoice() { for (let i = 0; i < 30 && await deps.lanternSpeaking().catch(() => false); i++) await new Promise((r) => setTimeout(r, 500)); }

// ---- answering ------------------------------------------------------------------------------------------------------------------------
const OWNER_ONLY = /^(?:(?:please|hey|so|and|can you|could you|would you|will you)\s+)*(?:mute|unmute|leave|end|hang up|turn (?:on|off)|let |allow |stop letting|don'?t let|only (?:listen|answer)|kick|remove|admit|share|present|record|start|stop|open|close|demo mode|rehearse|shrink|minimi[sz]e|enlarge|bring|pause|resume|take notes|don'?t record|off the record|summari[sz]e|recap|what did (?:\S+\s){1,3}(?:say|said|mention))\b/i;
const CHANGES = /^(?:(?:please|hey|so|and|can you|could you|would you|will you|go ahead and|i need you to|i want you to)\s+)*(add|schedule|book|move|reschedule|cancel|delete|remove|clear|rename|change|set|switch|send|text|message|email|install|buy|order|pay|mark|update|edit|write|forget|remember|play|skip|pause)\b/i;

async function respond(req) {
  const { assistant, question, speaker, via, isOwner } = req;
  const t0 = deps.now(), g = gen;
  const key = isOwner ? "owner" : nameKey(speaker);
  const who = callName(speaker, [...names(), selfName].filter(Boolean), { selfName: owner.name() });
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
  if (g !== gen) return null;                     // the meeting ended while answering: nothing of it is kept
  if (say.buildingUsed) nameUsed = true;
  policy.note(key, nameUsed);
  memory.add({ name: who ?? shown, key, question, topic: result?.citations?.[0]?.title ?? null, ref: result?.citations?.[0]?.lessonId ?? null, group: result?.citations?.[0]?.unit?.n ?? null, assistant: as });
  const entry = { at: new Date().toISOString(), as, who: shown, question, via, spoken: result?.spoken ?? "", chat: result?.chat ?? "", citations: result?.citations ?? [], course: isCourse, ms: deps.now() - t0, nameUsed, lanternApi: Boolean(result?.lanternApi) };
  transcript.push(entry); if (transcript.length > 60) transcript.shift();
  notes.answer({ as, who: shown, question, spoken: entry.spoken, chat: entry.chat, citations: entry.citations });
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
  if (!active()) return null;
  if (via === "voice") { const t = startTurn(as, heard); for (const s of String(spoken).split(/(?<=[.!?])\s+/)) t.part(s); t.end(spoken); }
  else if (!noChat) await postChat(as, spoken);
  const entry = { at: new Date().toISOString(), as, who: null, question: heard, via, spoken: via === "voice" ? spoken : "", chat: via === "chat" ? spoken : "", citations: [], course: false };
  transcript.push(entry);
  broadcast("meet", { kind: "answer", ...entry });
  return entry;
}

// The next meeting on the owner's Google Calendar that has a Meet link (null: Google isn't connected; undefined: none)
export async function nextCalendarMeet(now = Date.now()) {
  const google = await import("../connectors/google.mjs");
  if (!google.connectedFor("calendar")) return null;
  const day = (ms) => { const d = new Date(ms); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const list = await google.events(day(now), day(now + 86_400_000));
  const when = (e) => new Date(e.date + "T" + e.start + ":00").getTime();
  return list.filter((e) => e.meet && !e.declined && !e.allDay && when(e) > now - 60 * 60_000).sort((a, b) => when(a) - when(b))[0];
}
// ---- the owner's commands (said to Dayspring anywhere, or in the meeting) ------------------------------------------------------------
export async function command(text, { inMeeting = false } = {}) {
  const raw = String(text ?? "").trim();
  const t = wakeword.strip(raw).toLowerCase().replace(/[.!?]+$/g, "").replace(/^(?:hey |ok(?:ay)? )?(?:dayspring[, ]+)?/, "").replace(/^(?:please |can you |could you |would you )+/, "").trim();
  // a pasted Meet link, or "join my meeting"
  const url = meetLink(raw);
  if (url && (/^(?:join|open|go to|start)\b/.test(t) || raw.replace(/\s+/g, "") === url || raw.replace(/^https?:\/\//, "").replace(/\s+/g, "") === url.replace(/^https:\/\//, ""))) return (await join(url)).reply;
  // "join my next meeting": the next Google Calendar event with a Meet link (started up to an hour ago, or later today/tomorrow)
  if (/^(?:join|open|start|get (?:me |us )?into) (?:my |the |our )?(?:next|upcoming|scheduled|calendar) (?:google )?(?:meet|meeting|call|video call)$/.test(t)) {
    const next = await nextCalendarMeet().catch(() => null);
    if (next === null) return "I can't see your Google Calendar yet. Connect Google in Settings → Apps & connections, or paste the Meet link.";
    if (!next) return "I don't see a meeting with a Google Meet link on your calendar today or tomorrow. Paste the link and I'll join it.";
    const r = await join(next.meet);
    return r.ok === false ? r.reply : "Joining " + next.title + ". " + r.reply;
  }
  if (/^(?:join|open|start|get (?:me |us )?into) (?:my |the |our )?(?:google )?(?:meet|meeting|call|video call)(?: now)?$/.test(t)) {
    const last = settings.get().lastLink;
    if (last) return (await join(last)).reply;
    return "Paste the Google Meet link here (it looks like meet.google.com/abc-defg-hij) and I'll join it.";
  }
  if (/^(?:start (?:a |the )?rehearsal|rehearse(?: the)? (?:meeting|demo)|practi[cs]e the demo)$/.test(t)) return (await rehearse()).reply;
  if (/^(?:turn (on|off) demo mode|demo mode (on|off))$/.test(t)) { const on = /on/.test(RegExp.$1 || RegExp.$2); setDemo(on); return on ? "Demo mode is on: anyone in the meeting can ask Dayspring or Lantern, and course questions go to Lantern." : "Demo mode is off. Only you can ask now, unless you let people."; }
  if (/^(?:recap|summari[sz]e|what happened in) (?:my |the )?last meeting$|^(?:give me a )?recap of (?:my |the )?last meeting$/.test(t)) {
    const r = notes.recapOf(); return r ? r.text : "There are no saved meeting notes yet.";
  }
  // "who's in the meeting?" with no meeting: said plainly (not "did you mean…"). "…in the call" is left for other calls.
  if (!active() && /^(?:who(?:'s| is| all is) (?:in|on) (?:the |this |my )?meeting|who(?:'s| is) (?:talking|speaking) in (?:the |this )?meeting)$/.test(t)) return "I'm not in a meeting right now.";
  if (!active()) return null;
  // meeting notes
  if (/^(?:(?:start|begin) (?:taking )?notes|take notes|start recording|(?:resume|continue) (?:the )?(?:notes|recording|taking notes)|you can record (?:again|now)|back on the record|go back on the record)$/.test(t)) {
    if (!inCall()) return "I'll take notes once we're in the meeting.";
    const st = notes.status();
    if (st.on && st.live && st.paused) { notes.resume(); await showRec(); push(); await postChat("dayspring", "Notes are back on."); return "Notes are back on."; }
    if (st.on && st.live) return "I'm already taking notes.";
    settings.set({ notes: true });
    const ok = await startNotes(gen, { title: meetingTitle({}) });
    return ok ? "I'm taking notes. I told everyone in the meeting." : "I couldn't tell the meeting I'm taking notes (the chat and the Dayspring screen are both unavailable), so I'm not taking any.";
  }
  if (/^(?:stop (?:taking )?notes|stop (?:the )?recording|stop the notes|no more notes)$/.test(t)) {
    if (!notes.status().live) return "I'm not taking notes.";
    notes.stop(); await session?.rec(null); push(); await postChat("dayspring", `${A()} has stopped taking notes.`);
    return "I've stopped taking notes. What I have so far will be saved when the meeting ends.";
  }
  if (/^(?:pause (?:the )?(?:recording|notes)|pause taking notes|hold the notes)$/.test(t)) {
    if (!notes.status().live) return "I'm not taking notes.";
    notes.pause("paused"); await showRec(); push(); await postChat("dayspring", "Notes are paused.");
    return "Notes are paused. Say “resume the notes” when you want them back.";
  }
  if (/^(?:don'?t (?:record|write down|take notes (?:on|of)) (?:this|that)(?: part| bit)?|(?:this is |we'?re |go |let'?s go )?off the record)$/.test(t)) {
    if (!notes.status().live) return "I'm not taking notes, so nothing is being written down.";
    notes.pause("private"); await showRec(); push(); await postChat("dayspring", "Notes are paused for this part.");
    return "Okay, I'm not writing this part down. Say “you can record again” when it's over.";
  }
  let wd;
  if ((wd = /^what did (.+?) (?:say|said|mention)(?: about (.+))?$/.exec(t))) {
    const who = matchPerson(wd[1], names()) ?? wd[1];
    return notes.whatDid(who, wd[2] ?? "");
  }
  if (/^(?:summari[sz]e (?:the |this )?(?:meeting |call )?so far|summari[sz]e (?:the |this )?(?:meeting|call)|what have we (?:covered|talked about|discussed)(?: so far)?|(?:give me a )?(?:summary|recap)(?: so far)?|recap(?: the)? (?:meeting|call)(?: so far)?)$/.test(t)) {
    if (!notes.status().on) return "I'm not taking notes in this meeting, so I don't have a summary. Say “start taking notes” first.";
    return notes.soFar();
  }
  // the window
  if (/^(?:bring (?:the )?meeting back|show (?:me )?the meeting|enlarge the meeting|make the meeting (?:big|bigger|large)|open the meeting|meeting (?:big|large))$/.test(t)) { await large(); return "Here's the meeting."; }
  if (/^(?:shrink|minimi[sz]e|hide) the meeting|^(?:put|move) the meeting (?:in|to) the corner$|^meeting (?:small|to the corner)$/.test(t)) { await tile(); return "The meeting is in the corner. Click it to bring it back."; }
  // the call
  if (/^(?:mute|mute me|mute my (?:mic|microphone)|mute the (?:mic|microphone)|turn off my (?:mic|microphone))$/.test(t)) return micTo("muted");
  if (/^(?:unmute|unmute me|unmute my (?:mic|microphone)|turn on my (?:mic|microphone))$/.test(t)) return micTo("on");
  if (/^(?:turn (on|off) my camera|camera (on|off)|turn my camera (on|off))$/.test(t)) { await session.toggleCamera(); return "Camera switched."; }
  if (/^(?:turn (on|off) (?:the )?captions|captions (on|off))$/.test(t)) { captionsWanted = /on/.test(t); if (captionsWanted) { const ok = await session.enableCaptions(); return ok ? "Captions are on." : "I couldn't turn captions on. Press C in the meeting window."; } await session.toggleCaptions(); return "Captions switched."; }
  if (/^(?:open|show) (?:the )?(?:meeting )?chat$/.test(t)) { await large(); await session.openChat(); return "The chat is open."; }
  if (/^(?:share my screen|present(?: my screen)?|start presenting)$/.test(t)) { await large(); return "In the meeting window, press Present now (the screen with an arrow at the bottom), choose A window or Entire screen, and pick what to share. The picker is Chrome's own, so you choose it yourself."; }
  if (/^(?:who(?:'s| is| all is) (?:in|on) (?:the |this )?(?:meeting|call)|who(?:'s| is) here|who(?:'s| is) in (?:here|it)|who joined|who came)$/.test(t)) {
    await refreshPeople(session);
    return whoIsHere();
  }
  if (/^(?:who(?:'s| is) (?:talking|speaking)(?: now)?|who (?:just )?(?:spoke|talked)|who was that|who said that)$/.test(t)) return whoIsTalking();
  if (/^(?:leave|end|hang up|exit)(?: the)? (?:meeting|call)$|^hang up$/.test(t)) { pendingLeave = deps.now() + 20_000; return "Leave the meeting? Say “yes, leave” to confirm."; }
  if (pendingLeave && deps.now() < pendingLeave && /^(?:yes|yeah|yep|confirm)(?:,? (?:leave|go|do it|please))?$|^yes leave$/.test(t)) { pendingLeave = 0; return (await leave()).reply || "I left the meeting."; }
  if (/^(?:is the meeting (?:working|ok|okay)|meeting (?:check|status)|can you (?:read|see) the captions)$/.test(t)) {
    const sc = await session.selfCheck().catch(() => ({}));
    const pc = peopleCheck();
    return `Captions ${sc.captions ? "detected ✓" : "not detected ✗"}, chat ${sc.chatInput ? "ready ✓" : "not ready ✗"}, people ${pc.ok ? "detected ✓" : "not detected ✗"} (${pc.how}).`;
  }
  // who may ask (the people list read fresh, so someone who just joined can be named)
  await refreshPeople(session);
  const pc = perms.command(wakeword.strip(raw).replace(/^(?:hey |ok(?:ay)? )?(?:dayspring[, ]+)?/i, ""), names());
  if (pc) { if (pc.mode) settings.set({ mode: pc.mode }); push(); return pc.reply; }
  return inMeeting ? null : null;
}
// "In the meeting: Rich Alvarez, Jess Park (presenting) and Sam Lee, and you. Meet counts 5, so I may be missing someone."
const listOf = (a) => (a.length > 1 ? `${a.slice(0, -1).join(", ")} and ${a.at(-1)}` : a[0] ?? "");
export function whoIsHere() {
  const st = people?.status();
  if (!st || !active()) return "We're not in a meeting.";
  const list = st.people.map((p) => p.name + (p.presenting ? " (presenting)" : ""));
  const base = list.length ? `In the meeting: ${listOf(list)}, and you.` : "It's just us so far.";
  const off = st.agrees === false ? ` Meet counts ${st.expected}, so ${st.expected > st.count ? "I may be missing someone" : "someone may have just left"}.` : "";
  return base + off;
}
export function whoIsTalking() {
  const t = people?.talking();
  if (!t) return "Nobody is talking right now.";
  if (t.self) return "You are.";
  return t.source === "caption" ? `${t.name} is talking.` : `It looks like ${t.name} (their tile shows them talking).`;
}
// How people are being found, for the checklist and "is the meeting working?"
export function peopleCheck() {
  const src = people?.status().sources ?? {};
  const how = [src.panel && "the People list", src.tiles?.n && "the video tiles", src.caption && "the captions", src.chat && "the chat", src.toast && "Meet's notices", src.ocr?.n && "a picture of the window", src.count && "the People count"].filter(Boolean);
  return { ok: Boolean(src.panel?.n || src.tiles?.n || src.ocr?.n || src.caption?.n), how: how.length ? `from ${listOf(how)}` : "nothing read yet" };
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
export const _people = () => people;
export const _notes = () => notes;
export const _captionsLost = () => captionsLost(gen);
export const _peopleFromPicture = () => (session ? peopleFromPicture(session, gen, { force: true }) : null);
