// "Tune in": Dayspring listens to whatever is playing in the owner's headset (a Discord call, a game, a video) and
// answers when someone says its name. The 🎧 button on the display turns it on and off; so do "Dayspring, tune in"
// and "stop listening to the call".
//
// Works with any call app, no bot needed: Discord, Zoom, Google Meet, Teams, a game. Which app is in use is only shown
// ("Listening to: Zoom", lib/calls/apps.mjs); nothing about the app is touched.
//
// How: lib/loopback.mjs hears the playback device (shared WASAPI loopback: nothing is taken over, nothing in the call
// app changes) → a simple voice detector cuts speech into utterances (it ends after ~0.45 s of quiet, Settings → Calls)
// → whisper tiny.en (fast) listens for the wake word → when those words are clear enough they're used as they are,
// otherwise whisper base.en re-reads that utterance → the fast AI model answers a sentence at a time
// (lib/calls/pipeline.mjs) → the display speaks each sentence as soon as it exists, streaming the voice (into the call
// too, when "talk into calls" is on; see callbridge.mjs). Timings: Settings → Calls, data/logs/call-latency.log.
//
// Privacy: what people say is held in memory only long enough to check it for the wake word, then dropped. Nothing
// is saved or logged unless it was addressed to Dayspring; then only that request and the reply (devlog
// "call-command"). People on a call can ask questions, but only the owner can make changes.
import { broadcast } from "./bus.mjs";
import * as loopback from "./loopback.mjs";
import * as stt from "./stt.mjs";
import * as owner from "./owner.mjs";
import * as devlog from "./devlog.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJSONAtomic } from "./atomic.mjs";
import * as cfg from "./calls/config.mjs";
import * as latency from "./calls/latency.mjs";
import * as pipeline from "./calls/pipeline.mjs";
import * as apps from "./calls/apps.mjs";
import { warm } from "./calls/warm.mjs";

// Whether the owner left it on (and on which device), so a restart of Dayspring picks it back up.
const WANT_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "tunein.json");
const saveWant = (w) => { try { writeJSONAtomic(WANT_FILE, w, 0); } catch { /* not critical */ } };
// Tune in comes back after a restart if it was on — but never while Dayspring is Off (no listening at all). The wish
// stays in data/tunein.json, so turning Dayspring back on (quiet.mjs) brings it back then.
export async function resume() {
  try {
    const { get } = await import("./settings.mjs");
    if ((get().listenState ?? "active") === "off") return { on: false, skipped: "Dayspring is off" };
  } catch { /* settings unreadable: behave as before */ }
  try { const w = existsSync(WANT_FILE) ? JSON.parse(readFileSync(WANT_FILE, "utf8")) : null; if (w?.on) return await start({ device: w.device ?? null }); } catch { /* stays off */ }
  return null;
}

const RATE = 16000, FRAME = 320;              // 20 ms frames
const PRE = 15, MIN = 25, MAX = 600;           // frames: 300 ms pre-roll, 0.5 s min, 12 s max
const endFrames = () => Math.max(12, Math.round(cfg.get().hangMs / 20));   // quiet that ends an utterance (450 ms; it was 700)
let cap = null, on = false, since = 0, deviceWanted = null, lastError = "", restarts = 0;
let floor = 200, speechRun = 0, quietRun = 0, recording = null, pre = [];
let queue = [], busy = false, pendingWake = 0, selfUntil = 0, history = [], queueAt = null;
const recentSaid = [];                         // Dayspring's own recent words (the loopback hears them too)
let chatFn = null;                             // the assistant, set by the server (avoids an import cycle)
let appNow = { app: null, label: null, inMeeting: false }, appTimer = null;
let replying = null;                           // the answer being written now: { id, ctl }
let bargeRun = 0;
// Who answers when the Discord bot is in the same call: the bot (it hears each person separately), unless Settings →
// Calls says Tune in. Replaceable in tests.
let botInCall = async () => { try { return (await import("./discord/bot.mjs")).inVoice(); } catch { return false; } };
export function _setBotInCall(fn) { botInCall = fn; botCached = false; }

export function setChat(fn) { chatFn = fn; }
export const isOn = () => on;
export function status() {
  return { on, since: on ? since : null, device: cap?.device || null, deviceWanted, error: lastError, stt: stt.ready(), queue: queue.length,
    app: appNow.app, appLabel: appNow.label, inMeeting: appNow.inMeeting, replying: Boolean(replying), ack: cfg.get().ack };
}

// ---- turning it on and off ----------------------------------------------------------------------------------------
export async function start({ device = null } = {}) {
  const r = stt.ready();
  if (!r.ok) return { ok: false, needsInstall: true, why: r.why };
  if (on) await stop({ quiet: true });
  deviceWanted = device || null; lastError = ""; restarts = 0;
  await open();
  if (!cap) return { ok: false, why: lastError || "Couldn't hear the headset." };
  on = true; since = Date.now(); history = [];
  saveWant({ on: true, device: deviceWanted });
  // load both models now, not mid-sentence
  stt.transcribe(new Int16Array(RATE / 2), { speed: "fast" }).then(() => stt.transcribe(new Int16Array(RATE / 2), { speed: "accurate" })).catch(() => {});
  // …and the voice's connection and the AI's model name
  import("./calls/tts-stream.mjs").then((t) => t.warm()).catch(() => {});
  import("./calls/stream-llm.mjs").then((m) => m.fastModel()).catch(() => {});
  watchApps();
  broadcast("tunein", { kind: "state", ...status() });
  return { ok: true, ...status() };
}
async function open() {
  try {
    cap = await loopback.capture({
      device: deviceWanted,
      onPcm: feed,
      onEnd: ({ code, error }) => {
        cap = null;
        if (!on) return;
        // the device went away or Windows switched the default: reopen (a few tries), else switch off with a reason
        if (restarts++ < 5) { setTimeout(() => { if (on) open(); }, 1500); return; }
        lastError = error || `stopped (${code})`; on = false; broadcast("tunein", { kind: "state", ...status() });
      },
    });
    if (cap && !cap.device) await new Promise((r) => setTimeout(r, 300));
  } catch (e) { lastError = e.message; cap = null; }
}
// shutdown: Dayspring itself is closing, so remember it was on (it comes back on at the next start)
export async function stop({ quiet = false, shutdown = false } = {}) {
  if (!shutdown) saveWant({ on: false });
  on = false; recording = null; pre = []; queue = []; pendingWake = 0;
  clearInterval(appTimer); appTimer = null; appNow = { app: null, label: null, inMeeting: false };
  try { replying?.ctl.abort(); } catch { /* fine */ } replying = null;
  try { cap?.stop(); } catch { /* gone */ }
  cap = null;
  if (!quiet) broadcast("tunein", { kind: "state", ...status() });
  return { ok: true, ...status() };
}

// Which call app is open (for the status line only), every 15 s while listening.
function watchApps() {
  clearInterval(appTimer);
  const look = () => apps.detect({ fresh: true }).then((a) => { const changed = a.app !== appNow.app || a.inMeeting !== appNow.inMeeting; appNow = a; if (changed && on) broadcast("tunein", { kind: "state", ...status() }); }).catch(() => {});
  // also whether the Discord bot is in a call (so the head start below isn't spent on speech the bot will answer)
  const bot = async () => { botCached = cfg.get().arbitration === "bot" && await botInCall(); };
  look(); bot(); appTimer = setInterval(() => { look(); bot(); }, 15_000); appTimer.unref?.();
}

// The display tells us while it's speaking, so Dayspring doesn't answer itself.
// on: for about ms (the display says when it's really done); off: a short tail for the echo to fade.
export function speaking(active, ms = 0) { selfUntil = active ? Date.now() + Math.min(Math.max(ms, 1500), 30_000) : Date.now() + 600; }
export const isSelfSpeaking = () => Date.now() < selfUntil;
// A managed meeting (lib/meet) that reads its captions answers the call itself: Tune in stands down meanwhile, so
// nobody gets two answers. It comes back on its own when the meeting ends or its captions can't be read.
let standDown = () => false;
export function setStandDown(fn) { standDown = typeof fn === "function" ? fn : () => false; }
export const standingDown = () => { try { return Boolean(standDown()); } catch { return false; } };
// A meeting taking notes while its captions can't be read: what Tune in hears goes into the notes (who said it isn't
// known). Only while that meeting sets it; otherwise what isn't for Dayspring is dropped, never stored.
let heardHook = null;
export function setHeard(fn) { heardHook = typeof fn === "function" ? fn : null; }
export function noteSaid(text) { const t = norm(text); if (t) { recentSaid.push({ t, at: Date.now() }); while (recentSaid.length > 12) recentSaid.shift(); } }

// ---- voice detection ----------------------------------------------------------------------------------------------
let carry = new Int16Array(0);
function feed(pcm) {
  if (!on) return;
  const buf = carry.length ? concat([carry, pcm]) : pcm;
  let i = 0;
  for (; i + FRAME <= buf.length; i += FRAME) frame(buf.subarray(i, i + FRAME));
  carry = buf.slice(i);
}
function frame(f) {
  let sum = 0; for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
  const rms = Math.sqrt(sum / f.length);
  // the noise floor follows quiet stretches quickly and loud ones slowly
  floor = rms < floor ? floor * 0.9 + rms * 0.1 : floor * 0.9995 + rms * 0.0005;
  const speech = rms > Math.max(350, floor * 3.2);
  // Talking over Dayspring (optional: this hears one mixed stream, so it can't always tell a friend from its own voice)
  if (Date.now() < selfUntil) {
    const c = cfg.get();
    bargeRun = speech && c.bargeIn && c.bargeInTunein ? bargeRun + 1 : 0;
    if (bargeRun * 20 >= c.bargeInMs) { bargeRun = 0; hush("barge-in"); }
  } else bargeRun = 0;
  if (!recording) {
    pre.push(f); if (pre.length > PRE) pre.shift();
    speechRun = speech ? speechRun + 1 : 0;
    if (speechRun >= 3) { recording = [...pre]; quietRun = 0; pre = []; }
    return;
  }
  recording.push(f);
  quietRun = speech ? 0 : quietRun + 1;
  // Head start: a quarter second into a pause the fast speech model already starts on what was said, so its words are
  // usually ready the moment the pause is long enough to count as the end. If they keep talking, it's thrown away.
  if (speech) spec = null;
  else if (quietRun === SPEC_FRAMES && !spec && recording.length - quietRun >= MIN && Date.now() >= selfUntil && !botCached) {
    const pcm = concat(recording);
    // (and when the name is in it, the AI and voice connections open now, while the pause runs out)
    spec = transcribe(lead(pcm), { speed: "fast", prompt: hint() }).then((r) => { if (r?.text && wakeRegex().test(r.text)) warm(); return r; }).catch(() => null);
  }
  if (quietRun >= endFrames() || recording.length >= MAX) {
    const frames = recording; recording = null; speechRun = 0;
    const endedAt = Date.now() - quietRun * 20;   // when they actually stopped talking
    const early = quietRun >= endFrames() ? spec : null; spec = null;
    if (frames.length - quietRun >= MIN) { if (DEBUG) console.log(`[tunein] utterance ended ${new Date().toISOString().slice(17, 23)}`); enqueue(concat(frames), endedAt, early); }
  }
}
const SPEC_FRAMES = 12;                          // 240 ms of quiet
let spec = null, botCached = false;
let transcribe = (pcm, o) => stt.transcribe(pcm, o);   // replaceable in tests (no real speech engine)
export function _setTranscribe(fn) { transcribe = fn ?? ((pcm, o) => stt.transcribe(pcm, o)); }
const concat = (parts) => { const n = parts.reduce((a, p) => a + p.length, 0), out = new Int16Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

// ---- listening for the name ---------------------------------------------------------------------------------------
let utteranceHook = null;                        // tests: see each utterance as it's cut (audio length and timing only)
function enqueue(pcm, endedAt = Date.now(), early = null) {
  utteranceHook?.({ seconds: pcm.length / RATE, endedAt, at: Date.now(), early: Boolean(early) });
  if (Date.now() < selfUntil) return;             // that's Dayspring talking
  queue.push({ pcm, at: Date.now(), endedAt, early });
  while (queue.length > 3) queue.shift();         // fall behind → keep only the latest
  if (!busy) drain();
}
async function drain() {
  busy = true;
  try {
    while (queue.length && on) {
      const { pcm, at, endedAt, early } = queue.shift();
      queueAt = at;
      await consider(pcm, endedAt, early).catch((e) => { lastError = e.message; });
    }
  } finally { busy = false; }
}

const norm = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
export function wakeRegex() {
  const names = new Set(["day spring", "dayspring", "day-spring", "days spring", "dace spring", "dare spring", "darespring", "date spring", "dave spring", "daisy spring", "they spring", "day springs", "dayspring's", "stay spring", "dave springer", "day springer", "des spring", "the spring", norm(owner.assistant())]);
  const alt = [...names].filter(Boolean).map((n) => n.replace(/'/g, "'?").replace(/[-\s]+/g, "[\\s'-]?")).join("|");
  return new RegExp(`\\b(?:hey\\s+|ok(?:ay)?\\s+)?(?:${alt})\\b[,.!?]*`, "i");
}
function isEcho(text) {
  const t = norm(text); if (t.length < 8) return false;
  const now = Date.now();
  return recentSaid.some((s) => now - s.at < 60_000 && (s.t.includes(t) || t.includes(s.t.slice(0, Math.min(40, s.t.length)))));
}
// What they want from "…Dayspring, what's the weather…": the words after the name, else the words before it.
export function commandFrom(text) {
  const rx = wakeRegex(), m = rx.exec(text);
  if (!m) return null;
  const after = text.slice(m.index + m[0].length).trim().replace(/^[,.!?\s]+/, "");
  const before = text.slice(0, m.index).trim().replace(/[,.!?\s]+$/, "");
  if (after.split(/\s+/).filter(Boolean).length >= 2) return after;
  if (!after && before.split(/\s+/).length >= 3) return before;
  return after || "";
}

// whisper keeps the name when the hint is a sentence that uses it (a bare "Dayspring" hint made it drop the name)
const hint = () => { const n = owner.assistant() || "Dayspring"; return `Hey ${n}, what's the weather? ${n}, tell us a joke.`; };
const lead = (pcm) => { const out = new Int16Array(pcm.length + RATE / 2); out.set(pcm, RATE / 2); return out; };
const DEBUG = process.env.TUNEIN_DEBUG === "1";   // timings only (never the words)
const words = (t) => (String(t ?? "").match(/\S+/g) ?? []).length;
async function consider(pcm, endedAt = Date.now(), early = null) {
  if (standingDown()) return;                     // the meeting answers (it knows who is talking); dropped, never stored
  // the Discord bot is in the call too and hears each person on their own: it answers, so nobody gets two answers
  botCached = cfg.get().arbitration === "bot" && await botInCall();
  if (botCached) return;
  const t0 = Date.now();
  const quick = (early && await early) || await transcribe(lead(pcm), { speed: "fast", prompt: hint() });
  if (DEBUG) console.log(`[tunein] ${(pcm.length / RATE).toFixed(1)} s utterance, fast pass ${quick.ms} ms, waited ${t0 - (queueAt ?? t0)} ms in line`);
  if (!quick.text || isEcho(quick.text) || standingDown()) return;
  if (heardHook) { try { heardHook(quick.text); } catch { /* the notes only */ } }
  const hasName = wakeRegex().test(quick.text);
  const waiting = pendingWake && Date.now() < pendingWake;
  if (!hasName && !waiting) return;               // not for Dayspring: dropped, never stored
  warm();
  const trace = latency.begin({ via: "tunein", endedAt });
  // the fast model's words are used as they are when they're clear (three words or more after the name); otherwise the
  // accurate model re-reads the utterance
  const fastCmd = hasName ? commandFrom(quick.text) : quick.text.trim();
  let cmd = fastCmd;
  if (!(cfg.get().quickTranscript && fastCmd && words(fastCmd) >= 3)) {
    const exact = (await transcribe(lead(pcm), { speed: "accurate", prompt: hint() })).text || quick.text;
    cmd = hasName ? commandFrom(exact) ?? fastCmd : exact;
    trace.note({ accurate: true });
  }
  trace.mark("stt");
  if (hasName && !cmd) { trace.cancel(); pendingWake = Date.now() + cfg.get().followUpMs; broadcast("tunein", { kind: "wake" }); return; }   // just the name: listen for the rest
  pendingWake = 0;
  if (!cmd) { trace.cancel(); return; }
  await answer(cmd, trace);
}

// Requests that change things are the owner's to make, not whoever is on the call.
// (a request that starts with a change verb: "add…", "can you move…", "please delete…"; "what's on my schedule" is fine)
const CHANGES = /^(?:(?:please|hey|so|and|can you|could you|would you|will you|go ahead and|i need you to|i want you to)\s+)*(add|schedule|book|move|reschedule|cancel|delete|remove|clear|rename|change|set|turn (?:on|off)|switch|send|text|message|email|open|close|install|buy|order|pay|mark|update|edit|write|forget|remember|play|skip|pause)\b/i;

async function answer(cmd, trace = latency.begin({ via: "tunein" })) {
  const who = owner.name();
  broadcast("tunein", { kind: "heard", text: cmd, ack: cfg.get().ack });
  if (/^(stop|quit|stop listening|tune out|leave( the call)?|go away|that'?s all)\b/i.test(cmd)) {
    trace.cancel();
    await stop({ quiet: true });
    return say(`Okay, I'll stop listening.`, cmd, { state: true });
  }
  if (/^(shh+|hush|be quiet|never ?mind|cancel|ok(?:ay)? stop|stop talking)\b/i.test(cmd)) { trace.cancel(); hush("asked"); return { heard: cmd, reply: "" }; }
  if (CHANGES.test(cmd)) { trace.cancel(); return say(`I heard that over the call. I only make changes when ${who} asks me directly, so ${who}, just say the word.`, cmd); }
  // a new question replaces an answer that's still going
  if (replying) hush("new question");
  const id = trace.id, ctl = new AbortController();
  replying = { id, ctl };
  let seq = 0;
  try {
    const r = await pipeline.reply({ text: cmd, history, who: "friend", via: "tunein", trace, signal: ctl.signal,
      onSentence: (text) => { if (!ctl.signal.aborted) sayPart(id, seq++, text, cmd); } });
    trace.note({ model: r.model, offline: r.offline });
    if (!ctl.signal.aborted) {
      history = [...history, { role: "user", content: cmd }, { role: "assistant", content: r.reply }].slice(-8);
      devlog.log("call-command", { heard: cmd, reply: r.reply });
      broadcast("tunein", { kind: "reply-part", id, seq, final: true, heard: cmd, text: "", full: r.reply, setup: r.setup ?? null });
    }
    return { heard: cmd, reply: r.reply, id, setup: r.setup ?? null };
  } catch (e) {
    trace.cancel();
    // the streaming path failed before a word: the old way (one whole answer)
    if (seq === 0 && chatFn && !ctl.signal.aborted) {
      try { const out = await chatFn(history, cmd, { surface: "call" }); history = (out.history ?? []).slice(-8); return say(out.reply, cmd); } catch { /* below */ }
    }
    return say("Sorry, I couldn't get an answer just then.", cmd);
  } finally { if (replying?.id === id) replying = null; }
}
// One sentence of an answer: the display speaks it as soon as it arrives (and knows more may follow).
function sayPart(id, seq, text, heard) {
  noteSaid(text);
  speaking(true, 1500 + text.length * 65);
  broadcast("tunein", { kind: "reply-part", id, seq, text, heard, final: false });
}
// Stop talking: the display stops the voice, and the answer still being written stops too.
export function hush(why = "") {
  try { replying?.ctl.abort(); } catch { /* fine */ }
  replying = null;
  selfUntil = Date.now() + 600;
  broadcast("tunein", { kind: "hush", why });
}
function say(reply, heard, { state = false } = {}) {
  noteSaid(reply);
  speaking(true, 1500 + reply.length * 65);   // until the display reports the real playback

  devlog.log("call-command", { heard, reply });
  broadcast("tunein", { kind: "reply", heard, text: reply });
  if (state) broadcast("tunein", { kind: "state", ...status() });
  return { heard, reply };
}

// For tests: run text through the same path as a transcribed utterance.
export async function _testHeard(text) { const cmd = commandFrom(text); if (cmd) return answer(cmd); return null; }
// For tests: feed raw 16 kHz audio as if it came from the headset (the voice detector and everything after it).
export function _setUtteranceHook(fn) { utteranceHook = fn; }
export const _isEcho = (t) => isEcho(t);
export function _testFeed(pcm) { const was = on; on = true; try { feed(pcm); } finally { on = was; } }
