// "Tune in": Dayspring listens to whatever is playing in the owner's headset (a Discord call, a game, a video) and
// answers when someone says its name. The 🎧 button on the display turns it on and off; so do "Dayspring, tune in"
// and "stop listening to the call".
//
// How: lib/loopback.mjs hears the playback device (shared WASAPI loopback: nothing is taken over, nothing in Discord
// changes) → a simple voice detector cuts speech into utterances → whisper tiny.en (fast) listens for the wake word →
// only then whisper base.en re-reads that utterance for the actual request → the assistant answers → the display
// speaks it (into the call too, when "talk into calls" is on; see callbridge.mjs).
//
// Privacy: what people say is held in memory only long enough to check it for the wake word, then dropped. Nothing
// is saved or logged unless it was addressed to Dayspring; then only that request and the reply (devlog
// "call-command"). People on a call can ask questions, but only the owner can make changes.
import { broadcast } from "./announcer.mjs";
import * as loopback from "./loopback.mjs";
import * as stt from "./stt.mjs";
import * as owner from "./owner.mjs";
import * as devlog from "./devlog.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Whether the owner left it on (and on which device), so a restart of Dayspring picks it back up.
const WANT_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "tunein.json");
const saveWant = (w) => { try { writeFileSync(WANT_FILE, JSON.stringify(w)); } catch { /* not critical */ } };
export async function resume() {
  try { const w = existsSync(WANT_FILE) ? JSON.parse(readFileSync(WANT_FILE, "utf8")) : null; if (w?.on) return await start({ device: w.device ?? null }); } catch { /* stays off */ }
  return null;
}

const RATE = 16000, FRAME = 320;              // 20 ms frames
const PRE = 15, END = 35, MIN = 25, MAX = 600; // frames: 300 ms pre-roll, 700 ms quiet ends it, 0.5 s min, 12 s max
let cap = null, on = false, since = 0, deviceWanted = null, lastError = "", restarts = 0;
let floor = 200, speechRun = 0, quietRun = 0, recording = null, pre = [];
let queue = [], busy = false, pendingWake = 0, selfUntil = 0, history = [], queueAt = null;
const recentSaid = [];                         // Dayspring's own recent words (the loopback hears them too)
let chatFn = null;                             // the assistant, set by the server (avoids an import cycle)

export function setChat(fn) { chatFn = fn; }
export const isOn = () => on;
export function status() {
  return { on, since: on ? since : null, device: cap?.device || null, deviceWanted, error: lastError, stt: stt.ready(), queue: queue.length };
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
  try { cap?.stop(); } catch { /* gone */ }
  cap = null;
  if (!quiet) broadcast("tunein", { kind: "state", ...status() });
  return { ok: true, ...status() };
}

// The display tells us while it's speaking, so Dayspring doesn't answer itself.
// on: for about ms (the display says when it's really done); off: a short tail for the echo to fade.
export function speaking(active, ms = 0) { selfUntil = active ? Date.now() + Math.min(Math.max(ms, 1500), 30_000) : Date.now() + 600; }
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
  if (!recording) {
    pre.push(f); if (pre.length > PRE) pre.shift();
    speechRun = speech ? speechRun + 1 : 0;
    if (speechRun >= 3) { recording = [...pre]; quietRun = 0; pre = []; }
    return;
  }
  recording.push(f);
  quietRun = speech ? 0 : quietRun + 1;
  if (quietRun >= END || recording.length >= MAX) {
    const frames = recording; recording = null; speechRun = 0;
    if (frames.length - quietRun >= MIN) { if (DEBUG) console.log(`[tunein] utterance ended ${new Date().toISOString().slice(17, 23)}`); enqueue(concat(frames)); }
  }
}
const concat = (parts) => { const n = parts.reduce((a, p) => a + p.length, 0), out = new Int16Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

// ---- listening for the name ---------------------------------------------------------------------------------------
function enqueue(pcm) {
  if (Date.now() < selfUntil) return;             // that's Dayspring talking
  queue.push({ pcm, at: Date.now() });
  while (queue.length > 3) queue.shift();         // fall behind → keep only the latest
  if (!busy) drain();
}
async function drain() {
  busy = true;
  try {
    while (queue.length && on) {
      const { pcm, at } = queue.shift();
      queueAt = at;
      await consider(pcm).catch((e) => { lastError = e.message; });
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
async function consider(pcm) {
  const t0 = Date.now();
  const quick = await stt.transcribe(lead(pcm), { speed: "fast", prompt: hint() });
  if (DEBUG) console.log(`[tunein] ${(pcm.length / RATE).toFixed(1)} s utterance, fast pass ${quick.ms} ms, waited ${t0 - (queueAt ?? t0)} ms in line`);
  if (!quick.text || isEcho(quick.text)) return;
  const hasName = wakeRegex().test(quick.text);
  const waiting = pendingWake && Date.now() < pendingWake;
  if (!hasName && !waiting) return;               // not for Dayspring: dropped, never stored
  const exact = (await stt.transcribe(lead(pcm), { speed: "accurate", prompt: hint() })).text || quick.text;
  let cmd = hasName ? commandFrom(exact) ?? commandFrom(quick.text) : exact;
  if (hasName && !cmd) { pendingWake = Date.now() + 6000; broadcast("tunein", { kind: "wake" }); return; }   // just the name: listen for the rest
  pendingWake = 0;
  if (!cmd) return;
  await answer(cmd);
}

// Requests that change things are the owner's to make, not whoever is on the call.
// (a request that starts with a change verb: "add…", "can you move…", "please delete…"; "what's on my schedule" is fine)
const CHANGES = /^(?:(?:please|hey|so|and|can you|could you|would you|will you|go ahead and|i need you to|i want you to)\s+)*(add|schedule|book|move|reschedule|cancel|delete|remove|clear|rename|change|set|turn (?:on|off)|switch|send|text|message|email|open|close|install|buy|order|pay|mark|update|edit|write|forget|remember|play|skip|pause)\b/i;

async function answer(cmd) {
  const who = owner.name();
  broadcast("tunein", { kind: "heard", text: cmd });
  if (/^(stop|quit|stop listening|tune out|leave( the call)?|go away|that'?s all)\b/i.test(cmd)) {
    await stop({ quiet: true });
    return say(`Okay, I'll stop listening.`, cmd, { state: true });
  }
  if (CHANGES.test(cmd)) return say(`I heard that over the call. I only make changes when ${who} asks me directly, so ${who}, just say the word.`, cmd);
  if (!chatFn) return say("I'm not quite ready to answer yet.", cmd);
  try {
    // the words alone: the call context goes with surface "call" (text in brackets set off the instant commands)
    const out = await chatFn(history, cmd, { surface: "call" });
    history = (out.history ?? []).slice(-8);
    return say(out.reply, cmd);
  } catch (e) { return say("Sorry, I couldn't get an answer just then.", cmd); }
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
