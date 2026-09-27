// Call apps: which meeting app is in use right now (for the "Listening to: Zoom" line), and exactly which microphone and
// speaker each app needs so the meeting hears Dayspring and Dayspring hears the meeting.
//
// Dayspring never changes a device, in Windows or in any app. It only reads what's there and shows what to pick.
//
// How the sound flows (with "Answer into the call" on, lib/callbridge.mjs + lib/voicemeeter.mjs):
//   your real microphone ─┐
//                          ├─► Voicemeeter bus B1 ─► "Voicemeeter Out B1" ─► the meeting app's MICROPHONE
//   Dayspring's voice ────┘   (Dayspring plays its answers into "Voicemeeter Input")
//   the meeting app's SPEAKER = your normal headset/speakers ─► Dayspring listens there (Tune in, loopback)
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PS1 = join(ROOT, "scripts", "audio-default.ps1");
export const CALL_MIC_GENERIC = "Voicemeeter Out B1";
export const VOICE_TO_GENERIC = "Voicemeeter Input";

// ---- which app is in a call ------------------------------------------------------------------------------------
// a list of { name (process), title (window title) }; replaceable in tests
let lister = defaultLister;
export function _setLister(fn) { lister = fn ?? defaultLister; }
function defaultLister() {
  const script = "Get-Process | Where-Object { $_.MainWindowTitle -ne '' -or $_.ProcessName -match '^(zoom|discord|ms-teams|teams)$' } | Select-Object @{n='name';e={$_.ProcessName}},@{n='title';e={$_.MainWindowTitle}} | ConvertTo-Json -Compress";
  return new Promise((resolve) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 8000, maxBuffer: 1 << 20 }, (e, so) => {
    if (e) return resolve([]);
    try { const j = JSON.parse(so || "[]"); resolve(Array.isArray(j) ? j : [j]); } catch { resolve([]); }
  }));
}
// the most specific match wins: an actual meeting window before an app that's merely open
export function classify(list) {
  const rows = (list ?? []).map((r) => ({ name: String(r.name ?? "").toLowerCase(), title: String(r.title ?? "") }));
  const has = (fn) => rows.find(fn);
  const meet = has((r) => /^(chrome|msedge|brave|firefox|opera|vivaldi)$/.test(r.name) && /(^meet\s*[-–]|google meet|meet\.google\.com)/i.test(r.title));
  if (meet) return { app: "meet", label: "Google Meet", inMeeting: true };
  const zoomMeeting = has((r) => r.name === "zoom" && /zoom meeting|meeting|webinar/i.test(r.title));
  if (zoomMeeting) return { app: "zoom", label: "Zoom", inMeeting: true };
  const teamsCall = has((r) => /^(ms-teams|teams)$/.test(r.name) && /(meeting|call)\b/i.test(r.title));
  if (teamsCall) return { app: "teams", label: "Microsoft Teams", inMeeting: true };
  const discord = has((r) => r.name === "discord");
  if (discord) return { app: "discord", label: "Discord", inMeeting: false };
  if (has((r) => r.name === "zoom")) return { app: "zoom", label: "Zoom", inMeeting: false };
  if (has((r) => /^(ms-teams|teams)$/.test(r.name))) return { app: "teams", label: "Microsoft Teams", inMeeting: false };
  return { app: null, label: null, inMeeting: false };
}
let last = { app: null, label: null, inMeeting: false, at: 0 };
export async function detect({ fresh = false } = {}) {
  if (!fresh && Date.now() - last.at < 10_000) return last;
  try { last = { ...classify(await lister()), at: Date.now() }; } catch { last = { app: null, label: null, inMeeting: false, at: Date.now() }; }
  return last;
}

// ---- the device names on this computer ------------------------------------------------------------------------------
let devLister = defaultDevices;
export function _setDevices(fn) { devLister = fn ?? defaultDevices; }
function ps(args) {
  return new Promise((resolve) => execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PS1, ...args], { windowsHide: true, timeout: 15000 }, (e, so) => {
    if (e) return resolve([]); try { const j = JSON.parse(String(so).trim() || "[]"); resolve(Array.isArray(j) ? j : [j]); } catch { resolve([]); }
  }));
}
async function defaultDevices() { const [capture, playback] = await Promise.all([ps(["-List", "-Capture"]), ps(["-List"])]); return { capture, playback }; }
let devCache = null, devAt = 0;
export async function devices({ fresh = false } = {}) {
  if (!fresh && devCache && Date.now() - devAt < 30_000) return devCache;
  const { capture = [], playback = [] } = await devLister();
  const callMic = capture.find((d) => /^voicemeeter out b1\b/i.test(d.name))?.name ?? null;
  const voiceTo = playback.find((d) => /^voicemeeter input\b/i.test(d.name))?.name ?? null;
  const yourMic = capture.find((d) => d.default && !/voicemeeter/i.test(d.name))?.name ?? null;
  const yourSpeakers = playback.find((d) => d.default && !/voicemeeter/i.test(d.name))?.name ?? null;
  devCache = { callMic, voiceTo, yourMic, yourSpeakers, voicemeeterInstalled: Boolean(callMic || voiceTo) }; devAt = Date.now();
  return devCache;
}

// ---- the per-app setup cards ---------------------------------------------------------------------------------------
// `listening` = the device Tune in is listening to right now (or null when it's off).
export function guides({ callMic, yourSpeakers, voicemeeterInstalled } = {}, listening = null) {
  const mic = callMic || `${CALL_MIC_GENERIC} (VB-Audio Voicemeeter VAIO)`;
  const spk = listening || yourSpeakers || "your usual headset or speakers";
  const why = "It carries your own microphone and Dayspring's voice together, so people hear both of you.";
  const hear = `Dayspring listens to ${spk}, so the app's sound has to come out there.`;
  const common = { microphone: mic, speaker: spk, micWhy: why, speakerWhy: hear, installed: voicemeeterInstalled !== false };
  return [
    { app: "discord", name: "Discord", ...common, where: "User Settings (⚙ bottom left) → Voice & Video → Input Device / Output Device",
      extras: ["Turn off Noise Suppression (Krisp) and Echo Cancellation for this input, or Dayspring's voice may be cut out.", "Turn off Automatically determine input sensitivity, or set the slider low.", "Prefer the Dayspring Discord bot? It hears everyone separately and answers faster; see the Discord bot guide."] },
    { app: "zoom", name: "Zoom", ...common, where: "Zoom → Settings (⚙) → Audio → Microphone / Speaker (during a meeting: the ^ next to Mute → pick them there)",
      extras: ["Uncheck Automatically adjust microphone volume.", "Set Background noise suppression to Low.", "Optional: turn on Original sound for musicians for the most natural voice."] },
    { app: "meet", name: "Google Meet (Chrome or Edge)", ...common, where: "In the meeting: ⋮ More options → Settings → Audio → Microphone / Speakers. (Or before joining: the mic and speaker menus under the preview.)",
      extras: ["If Meet keeps switching back, set the browser's own site setting too: the lock icon in the address bar → Site settings → Microphone.", "Meet's noise cancellation can soften Dayspring's voice; turn it off in Settings → Audio if people can't hear it."] },
    { app: "teams", name: "Microsoft Teams", ...common, where: "Teams → Settings (… next to your picture) → Devices → Microphone / Speaker",
      extras: ["Set Noise suppression to Low or Off.", "Don't pick a 'Custom setup' that uses the headset for the microphone."] },
    { app: "other", name: "Any other app", ...common, where: "The app's audio or voice settings: choose the microphone and speaker below.",
      extras: ["Any app that lets you choose a microphone works the same way."] },
  ];
}

// ---- the Test button ------------------------------------------------------------------------------------------------------
// While the display plays a test phrase into "Voicemeeter Input", listen (loopback, read-only) to that device and to the
// one Tune in listens to. Loud enough on the first = Dayspring's voice reaches the mixer that feeds the call's microphone.
// Nothing is changed and nothing heard is kept: only the loudest level.
export async function selfCheck({ ms = 5000, voiceTo = null, listening = null, capture = null } = {}) {
  const cap = capture ?? (await import("../loopback.mjs")).capture;
  const peakOf = async (device) => {
    if (!device) return { device: null, peak: 0, ok: false, why: "not found" };
    let peak = 0, got = 0, err = "";
    let c = null;
    try {
      c = await cap({ device, onPcm: (pcm) => { got += pcm.length; for (let i = 0; i < pcm.length; i += 160) { let s = 0; const n = Math.min(160, pcm.length - i); for (let j = 0; j < n; j++) s += pcm[i + j] * pcm[i + j]; peak = Math.max(peak, Math.sqrt(s / n)); } }, onEnd: ({ error }) => { err = error || err; } });
    } catch (e) { return { device, peak: 0, ok: false, why: e.message }; }
    await new Promise((r) => setTimeout(r, ms));
    try { c?.stop(); } catch { /* gone */ }
    return { device: c?.device || device, peak: Math.round(peak), frames: got, ok: peak >= 300, why: err || null };
  };
  const [voice, heard] = await Promise.all([peakOf(voiceTo), listening ? peakOf(listening) : Promise.resolve(null)]);
  return { voice, listening: heard };
}

// ---- voice questions: "what mic should Zoom use?", "how do I set up Google Meet for you?" -------------------------------
const APP_WORDS = [["zoom", /\bzoom\b/], ["meet", /\b(google )?meet\b|\bgoogle meeting/], ["teams", /\bteams\b/], ["discord", /\bdiscord\b/]];
export function appFromText(t) { for (const [id, rx] of APP_WORDS) if (rx.test(t)) return id; return null; }
export function isSetupQuestion(text) {
  const t = String(text ?? "").toLowerCase();
  if (!appFromText(t) && !/\b(meeting|call) app\b/.test(t)) return false;
  return /\b(mic|microphone|input|speaker|output|audio|sound|set ?up|setup|configure|hear you|hear me|talk (?:in|into))\b/.test(t) && /\b(what|which|how|set|setup|should|do i|can)\b/.test(t);
}
export function spokenAnswer(appId, dev, listening) {
  const g = guides(dev, listening).find((x) => x.app === (appId ?? "other")) ?? guides(dev, listening).at(-1);
  if (dev && dev.voicemeeterInstalled === false) return `For ${g.name}, I need the free Voicemeeter mixer first; Settings → Calls walks you through it. Then set the microphone to ${CALL_MIC_GENERIC} and keep the speaker on your usual headset.`;
  return `In ${g.name}, set the microphone to ${g.microphone}, and the speaker to ${g.speaker}. You'll find them in ${g.where.split(" (")[0]}. I've opened the setup card with the details.`;
}
