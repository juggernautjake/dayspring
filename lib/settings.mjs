// How loudly the Dayspring screen tells the owner things. Works with or without an AI.
//   voice  — sound + spoken (the default)
//   chime  — shown on screen with a soft sound, nothing spoken
//   silent — shown on screen only
// A mode can be temporary ("silent for an hour"). The morning alarm has its own switch.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJSONAtomic } from "./atomic.mjs";

const FILE = process.env.DAYSPRING_SETTINGS_FILE || join(dirname(fileURLToPath(import.meta.url)), "..", "data", "settings.json");   // (tests use their own)
export const MODES = ["voice", "chime", "silent"];
// audioOutputs: where Dayspring's own voice and sounds play — any of "tv" (the Dayspring screen's own speakers, whatever
// kind of screen it is), "headphones", "speakers" (the computer's), or "default"
// (whatever Windows uses). Several at once plays on all of them. night: "dark" (near black), "dim", or "off".
export const OUTPUT_ROLES = ["default", "tv", "headphones", "speakers"];
// Voice style: voice (a voice name), speedAdj (added to the time-of-day pace, -0.3…+0.2), detail (simple | normal | detailed),
// attitude (free text, e.g. "a calm pastor" or "an intense drill sergeant"), timeTone (soothing mornings, chipper afternoons).
// alarm: off until the owner sets a wake-up time (the setup wizard's "Your week" turns it on) or says "turn on the alarm"
// The Dayspring screen's size and layout (Settings → Screen). Unset = the default below, so a screen nobody has
// adjusted looks exactly as it always did.
const MARGIN_KEYS = ["marginTop", "marginBottom", "marginLeft", "marginRight"];
const SCREEN_NUM = { uiScale: [60, 150], textScale: [80, 130], clockScale: [60, 160], talkWidth: [25, 50], carouselSeconds: [0, 300], listRows: [0, 20] };
export const SCREEN_DEFAULT = { uiScale: 100, textScale: 100, clockScale: 100, talkWidth: null, carouselSeconds: 40, listRows: 0 };
const SCREEN_ENUM = { layoutMode: ["auto", "two", "one", "talkLeft", "talkRight", "compact"], density: ["comfortable", "compact"], fit: ["fill", "keep"], uiMotion: ["normal", "reduced"] };
const SCREEN_SHOW = ["showClock", "showNowNext", "showPanel", "showExam", "showCourses", "showTranscript"];
const DEFAULTS = { mode: "voice", until: null, after: "voice", alarm: false, chores: true, claudeAlerts: true, goals: true, audioOutputs: ["default"], night: "dark", mixer: false,
  voice: null, voiceId: null, speedAdj: 0, detail: "normal", attitude: null, timeTone: true,
  // convMode: null | "serious" (no jokes, listen, go deep) | "spar" (push back hard) | "devil" (argue the other side). Lasts two hours.
  convMode: null, convUntil: null, bibleVersion: "kjv",
  // Active / Quiet / Off (see quiet.mjs): quiet = only "Dayspring" is heard and nothing is spoken; off = no listening at all.
  // Alarms still ring when off unless alarmsWhenOff is false; the desktop notifications still show unless overlayWhenOff is false.
  listenState: "active", alarmsWhenOff: true, overlayWhenOff: true,
  // How each kind of notification arrives: auto (the mode above) | voice | chime | silent. notifyAll overrides every kind.
  notify: {}, notifyAll: null,
  // while he's talking to Dayspring (and talkGraceSec after): notifications wait (then come out) | silent (a card, no
  // sound, not said later) | interrupt (said at once, as before 1.8). Alarms, timers and emergencies always ring.
  talkNotify: "wait", talkGraceSec: 8,
  // desktop notifications in front of every window (top-right): seconds on screen, which screen
  overlay: { on: true, seconds: 8, screen: "primary" },
  miniOnTop: false,
  // who turns speech into words on the Dayspring screen: auto (the browser's own when it has one that works, else this
  // computer) | browser | local (whisper on this computer: private, and the only way in Brave and Firefox)
  speechEngine: "auto",
  // joke offers: with a playful personality (lib/persona, Humour 60+), a joke offer now and then (jokeOffers a day, 0-5)
  jokeOffers: 3, jokeOffersOn: true,
  // phrases Dayspring didn't understand are kept (words only, on this computer) so they can be taught; off stops that
  logMisses: true,
  // timers the owner set ring even when Dayspring is Quiet or Off (like alarms)
  timersWhenQuiet: true,
  // the clock on the Dayspring screen: 12-hour (3:05 PM) or 24-hour (15:05); alarms snooze this many minutes unless one says otherwise
  clock24: false, alarmSnooze: 9,
  // videos: how one starts (big | corner | audio | remember: the way it was last time, per kind of video), and the mini
  // player card when nothing plays (hide | show "Nothing playing")
  videoStartMode: "remember", videoModeLast: {}, nowPlayingIdle: "hide" };
export const VIDEO_MODES = ["big", "corner", "audio"];
export const VIDEO_START = ["big", "corner", "audio", "remember"];
// kinds of video, each with its own "last time": YouTube music (music videos, lyrics, songs), other YouTube, his own
// files and Google Drive's
export const VIDEO_KINDS = ["youtube-music", "youtube", "file-video"];
export const LISTEN_STATES = ["active", "quiet", "off"];
export const TALK_NOTIFY = ["wait", "silent", "interrupt"];
export const NOTIFY_KINDS = ["reminders", "schedule", "texts", "lantern", "discover", "system", "discoveries"];
const BIBLE_WORDS = [[/\b(nkjv|new king james)\b/, "nkjv"], [/\b(nasb|new american standard)\b/, "nasb"], [/\b(niv|new international)\b/, "niv"], [/\b(esv|english standard)\b/, "esv"],
  [/\b(nlt|new living)\b/, "nlt"], [/\b(kjv|king james)\b/, "kjv"], [/\b(web|world english)\b/, "web"], [/\b(asv|american standard)\b/, "asv"], [/\b(darby)\b/, "darby"], [/\b(young'?s|ylt)\b/, "ylt"]];
// Voice names Dayspring knows beyond the built-in ones: the current provider's own list (ElevenLabs library voices, OpenAI
// voices), set by voice.mjs. "Switch your voice to <any of these>" works, in any letter case.
let extraVoices = [];
export function knownVoices(names = []) { extraVoices = [...new Set(names.map(String).filter(Boolean))]; }
const voiceNames = () => [...new Set([...extraVoices, ...VOICE_NAMES])];
const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const VOICE_NAMES = ["Brian", "George", "Eric", "Chris", "Daniel", "Sarah", "Jessica", "Matilda", "Liam", "Will", "Alice", "Lily", "Rachel", "Roger", "Charlotte", "Callum"];
// Words people use for voices → the voice.
const VOICE_WORDS = [[/\b(female|woman|lady|girl)\b/, "Sarah"], [/\bwarm(er)? (female|woman)\b/, "Matilda"], [/\b(british|english accent|uk)\b/, "George"],
  [/\b(news|announcer|serious)\b/, "Daniel"], [/\b(deep|deeper)\b/, "Brian"], [/\b(casual|chill|laid back)\b/, "Chris"], [/\b(smooth)\b/, "Eric"], [/\b(expressive|energetic)\b/, "Jessica"]];

let db = null;
function load() { if (!db) db = { ...DEFAULTS, ...(existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {}) }; return db; }
function save() { writeJSONAtomic(FILE, db, 2); }

// The settings in force right now (a temporary mode expires by itself).
export function get() {
  const s = load();
  let expired = null;
  if (s.until && Date.now() > Date.parse(s.until)) { s.mode = s.after || "voice"; s.until = null; save(); expired = "mode"; }
  if (s.convUntil && Date.now() > Date.parse(s.convUntil)) { s.convMode = null; s.convUntil = null; save(); expired = expired ? "both" : "convMode"; }
  // a timed mode ran out ("silent for an hour"): tell the listeners, so the screen hears it (server.mjs broadcasts it)
  if (expired) { const out = { ...s }; queueMicrotask(() => { for (const fn of listeners) { try { fn(out, { expired }); } catch { /* a listener must not break settings */ } } }); }
  return { ...s };
}

const listeners = [];
export function onChange(fn) { listeners.push(fn); }

export function set(patch = {}) {
  const out = setInner(patch);
  for (const fn of listeners) { try { fn(out, patch); } catch { /* a listener must not break settings */ } }
  return out;
}
function setInner(patch) {
  const s = load();
  if (patch.mode !== undefined) {
    if (!MODES.includes(patch.mode)) throw new Error(`mode must be ${MODES.join(", ")}`);
    if (patch.minutes) { s.after = s.until ? s.after : s.mode; s.until = new Date(Date.now() + patch.minutes * 60000).toISOString(); }
    else { s.until = null; s.after = patch.mode; }
    s.mode = patch.mode;
  }
  for (const k of ["alarm", "chores", "claudeAlerts", "goals", "mixer", "alarmsWhenOff", "overlayWhenOff", "miniOnTop", "speakWhenClosed", "timersWhenQuiet", "jokeOffersOn", "logMisses", "clock24"]) if (typeof patch[k] === "boolean") s[k] = patch[k];
  if (typeof patch.alarmSnooze === "number") s.alarmSnooze = Math.max(1, Math.min(30, Math.round(patch.alarmSnooze)));
  if (patch.speechEngine !== undefined) { if (!["auto", "browser", "local"].includes(patch.speechEngine)) throw new Error("speech recognition must be auto, browser or local"); s.speechEngine = patch.speechEngine; }
  if (patch.listenState !== undefined) { if (!LISTEN_STATES.includes(patch.listenState)) throw new Error(`listening must be ${LISTEN_STATES.join(", ")}`); s.listenState = patch.listenState; }
  if (patch.notify && typeof patch.notify === "object") {
    const next = { ...(s.notify ?? {}) };
    for (const [k, v] of Object.entries(patch.notify)) if (NOTIFY_KINDS.includes(k)) { if (v === "auto" || v == null) delete next[k]; else if (MODES.includes(v)) next[k] = v; }
    s.notify = next;
  }
  if (patch.notifyAll !== undefined) s.notifyAll = MODES.includes(patch.notifyAll) ? patch.notifyAll : null;
  if (patch.talkNotify !== undefined) { if (!TALK_NOTIFY.includes(patch.talkNotify)) throw new Error(`while talking, notifications must be ${TALK_NOTIFY.join(", ")}`); s.talkNotify = patch.talkNotify; }
  if (patch.talkGraceSec !== undefined && Number.isFinite(Number(patch.talkGraceSec))) s.talkGraceSec = Math.max(3, Math.min(30, Math.round(Number(patch.talkGraceSec))));
  if (patch.overlay && typeof patch.overlay === "object") {
    const o = { ...DEFAULTS.overlay, ...(s.overlay ?? {}) };
    if (typeof patch.overlay.on === "boolean") o.on = patch.overlay.on;
    if (typeof patch.overlay.seconds === "number") o.seconds = Math.max(3, Math.min(60, Math.round(patch.overlay.seconds)));
    if (patch.overlay.screen !== undefined) o.screen = /^\d{1,2}$/.test(String(patch.overlay.screen)) ? String(patch.overlay.screen) : "primary";
    s.overlay = o;
  }
  if (Array.isArray(patch.audioOutputs)) {
    const outs = [...new Set(patch.audioOutputs.map(String))].filter((r) => OUTPUT_ROLES.includes(r));
    if (!outs.length) throw new Error(`audio outputs must be some of ${OUTPUT_ROLES.join(", ")}`);
    s.audioOutputs = outs.includes("default") ? ["default"] : outs;
  }
  if (patch.voice !== undefined) {
    const v = patch.voice && voiceNames().find((n) => n.toLowerCase() === String(patch.voice).toLowerCase());
    if (patch.voice && !v) throw new Error(`voice must be one of ${voiceNames().join(", ")}`);
    s.voice = v || null;
    if (patch.voiceId === undefined) s.voiceId = null;     // voice.mjs fills in the exact id for the name
  }
  // the exact ElevenLabs voice id chosen (library voices too), so the choice survives restarts and duplicate names
  if (patch.voiceId !== undefined) s.voiceId = patch.voiceId ? String(patch.voiceId).replace(/[^\w-]/g, "").slice(0, 64) || null : null;
  if (typeof patch.speedAdj === "number") s.speedAdj = Math.max(-0.3, Math.min(0.2, Math.round(patch.speedAdj * 100) / 100));
  if (typeof patch.speedDelta === "number") s.speedAdj = Math.max(-0.3, Math.min(0.2, Math.round(((s.speedAdj ?? 0) + patch.speedDelta) * 100) / 100));
  if (patch.detail !== undefined) { if (!["simple", "normal", "detailed"].includes(patch.detail)) throw new Error("detail must be simple, normal or detailed"); s.detail = patch.detail; }
  if (patch.attitude !== undefined) s.attitude = patch.attitude ? String(patch.attitude).slice(0, 160) : null;
  if (typeof patch.jokeOffers === "number") s.jokeOffers = Math.max(0, Math.min(5, Math.round(patch.jokeOffers)));
  if (typeof patch.timeTone === "boolean") s.timeTone = patch.timeTone;
  if (patch.convMode !== undefined) {
    if (patch.convMode && !["serious", "spar", "devil"].includes(patch.convMode)) throw new Error("mode must be serious, spar or devil");
    s.convMode = patch.convMode || null;
    s.convUntil = patch.convMode ? new Date(Date.now() + 2 * 3600_000).toISOString() : null;
  }
  if (patch.bibleVersion) s.bibleVersion = String(patch.bibleVersion);
  if (patch.micInput && ["headset", "laptop"].includes(patch.micInput)) s.micInput = patch.micInput;
  // the free browser voice and the OpenAI voice they picked
  if (patch.browserVoice !== undefined) s.browserVoice = patch.browserVoice ? String(patch.browserVoice).slice(0, 120) : null;
  if (patch.openaiVoice !== undefined) s.openaiVoice = patch.openaiVoice ? String(patch.openaiVoice).toLowerCase().slice(0, 20) : null;
  // which exact device plays each role, when there's more than one (two headsets): { headphones: "Speakers (Logitech Gaming Headset)" }
  if (patch.preferredOutputs && typeof patch.preferredOutputs === "object") s.preferredOutputs = Object.fromEntries(Object.entries(patch.preferredOutputs).filter(([k, v]) => ["tv", "headphones", "speakers"].includes(k) && typeof v === "string").map(([k, v]) => [k, v.slice(0, 120)]));
  // volume: Dayspring's own voice and sounds (0–100); musicVolume: Spotify and YouTube (0–100)
  if (typeof patch.volume === "number") s.volume = Math.max(5, Math.min(100, Math.round(patch.volume)));
  if (typeof patch.volumeDelta === "number") s.volume = Math.max(5, Math.min(100, Math.round((s.volume ?? 80) + patch.volumeDelta)));
  if (typeof patch.musicVolume === "number") s.musicVolume = Math.max(0, Math.min(100, Math.round(patch.musicVolume)));
  // videoVolume: YouTube videos with the picture showing (music-only YouTube and Spotify use musicVolume)
  if (typeof patch.videoVolume === "number") s.videoVolume = Math.max(0, Math.min(100, Math.round(patch.videoVolume)));
  if (typeof patch.videoVolumeDelta === "number") s.videoVolume = Math.max(0, Math.min(100, Math.round((s.videoVolume ?? s.musicVolume ?? 100) + patch.videoVolumeDelta)));
  if (typeof patch.musicVolumeDelta === "number") s.musicVolume = Math.max(0, Math.min(100, Math.round((s.musicVolume ?? 100) + patch.musicVolumeDelta)));
  // soundsVolume: chimes and sound effects (defaults to the voice level); alarmVolume: the alarm's ring, never below 20 so
  // it can't be silenced by accident; callVolume: Tune in's answers into a call
  const lvl = (v, min) => Math.max(min, Math.min(100, Math.round(v)));
  if (typeof patch.soundsVolume === "number") s.soundsVolume = lvl(patch.soundsVolume, 0);
  if (typeof patch.soundsVolumeDelta === "number") s.soundsVolume = lvl((s.soundsVolume ?? s.volume ?? 80) + patch.soundsVolumeDelta, 0);
  if (typeof patch.alarmVolume === "number") s.alarmVolume = lvl(patch.alarmVolume, 20);
  if (typeof patch.alarmVolumeDelta === "number") s.alarmVolume = lvl((s.alarmVolume ?? 100) + patch.alarmVolumeDelta, 20);
  if (typeof patch.callVolume === "number") s.callVolume = lvl(patch.callVolume, 0);
  if (typeof patch.callVolumeDelta === "number") s.callVolume = lvl((s.callVolume ?? 100) + patch.callVolumeDelta, 0);
  // overscan: how far (in % of the screen) the Dayspring screen stays in from each edge, for TVs that crop the picture.
  // It's the "all sides" margin; marginTop/Bottom/Left/Right override one side (null = follow the all-sides margin).
  const half = (v) => Math.max(0, Math.min(20, Math.round(v * 2) / 2));
  if (typeof patch.overscan === "number") { s.overscan = half(patch.overscan); for (const k of MARGIN_KEYS) s[k] = null; }
  if (typeof patch.overscanDelta === "number") {
    s.overscan = half((s.overscan ?? 5) + patch.overscanDelta);
    for (const k of MARGIN_KEYS) if (typeof s[k] === "number") s[k] = half(s[k] + patch.overscanDelta);
  }
  for (const k of MARGIN_KEYS) {
    if (patch[k] === null) s[k] = null;
    else if (typeof patch[k] === "number") s[k] = half(patch[k]);
    if (typeof patch[k + "Delta"] === "number") s[k] = half((typeof s[k] === "number" ? s[k] : s.overscan ?? 5) + patch[k + "Delta"]);
  }
  // how the Dayspring screen is laid out and sized (Settings → Screen; see layout.js)
  for (const [k, [lo, hi]] of Object.entries(SCREEN_NUM)) {
    if (patch[k] === null) s[k] = null;
    else if (typeof patch[k] === "number") s[k] = Math.max(lo, Math.min(hi, Math.round(patch[k])));
    if (typeof patch[k + "Delta"] === "number") s[k] = Math.max(lo, Math.min(hi, Math.round((typeof s[k] === "number" ? s[k] : SCREEN_DEFAULT[k]) + patch[k + "Delta"])));
  }
  for (const [k, opts] of Object.entries(SCREEN_ENUM)) if (patch[k] !== undefined) { if (!opts.includes(patch[k])) throw new Error(`${k} must be one of ${opts.join(", ")}`); s[k] = patch[k]; }
  for (const k of SCREEN_SHOW) if (typeof patch[k] === "boolean") s[k] = patch[k];
  if (typeof patch.calibrateAt === "number") s.calibrateAt = patch.calibrateAt;
  // "reset the screen layout": sizes, layout and what's shown back to the defaults (the all-sides margin stays: it's the TV's fit)
  if (patch.screenReset) for (const k of [...MARGIN_KEYS, ...Object.keys(SCREEN_NUM), ...Object.keys(SCREEN_ENUM), ...SCREEN_SHOW]) delete s[k];
  // videos (Settings → Screen → Videos): how one starts (big, in the corner, audio only, or the way it was last time for
  // that kind of video), the last choice per kind, and whether the mini player card says "Nothing playing" or hides
  if (patch.videoStartMode !== undefined) { if (!VIDEO_START.includes(patch.videoStartMode)) throw new Error(`videoStartMode must be one of ${VIDEO_START.join(", ")}`); s.videoStartMode = patch.videoStartMode; }
  if (patch.videoModeLast && typeof patch.videoModeLast === "object") {
    const next = { ...(s.videoModeLast ?? {}) };
    for (const [k, v] of Object.entries(patch.videoModeLast)) if (VIDEO_KINDS.includes(k) && VIDEO_MODES.includes(v)) next[k] = v;
    s.videoModeLast = next;
  }
  if (patch.nowPlayingIdle !== undefined) { if (!["hide", "show"].includes(patch.nowPlayingIdle)) throw new Error("nowPlayingIdle must be hide or show"); s.nowPlayingIdle = patch.nowPlayingIdle; }
  if (patch.night !== undefined) {
    if (!["dark", "dim", "off"].includes(patch.night)) throw new Error("night must be dark, dim or off");
    s.night = patch.night;
  }
  save();
  return get();
}

// Put back an earlier copy of every setting ("undo that" after a spoken change, lib/commands): the copy as it was,
// then the listeners hear it like any other change
export function restore(prev) {
  if (!prev || typeof prev !== "object") throw new Error("nothing to restore");
  db = { ...DEFAULTS, ...structuredClone(prev) };
  save();
  const out = get();
  for (const fn of listeners) { try { fn(out, { restored: true }); } catch { /* a listener must not break settings */ } }
  return out;
}

export function describe(s = get()) {
  const m = { voice: "Notifications are on, spoken out loud", chime: "Notifications are chime only, nothing spoken", silent: "Notifications are silent, on screen only" }[s.mode];
  const until = s.until ? ` until ${new Date(s.until).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "";
  const outs = (s.audioOutputs ?? ["default"]).map((r) => ({ default: "the default device", tv: "the Dayspring screen", headphones: "your headphones", speakers: "the computer's speakers" }[r]));
  const where = outs.length > 1 ? outs.slice(0, -1).join(", ") + " and " + outs[outs.length - 1] : outs[0];
  return `${m}${until}. My voice plays on ${where}. The morning alarm is ${s.alarm ? "on" : "off"}, and night mode is ${s.night}.`;
}

// "make everything bigger", "the top is cut off", "one column"… → a settings patch plus what to say (screenSay)
function screenPhrase(q) {
  const say = (patch, text) => ({ ...patch, screenSay: text });
  const bigger = /\b(bigger|larger|increase|grow)\b/, smaller = /\b(smaller|decrease|shrink|tinier)\b/;
  if (/\b(fit (it |everything |dayspring )?to (the |my )?(screen|tv)|calibrate (the |my )?(screen|tv|display)|screen calibration)\b/.test(q)) return say({ calibrateAt: Date.now() }, "Opening Fit to screen. Move each edge until its bright line is just visible, then press Save.");
  if (/\breset (the )?(screen|display) (layout|settings|format(ting)?)\b|\breset the layout\b/.test(q)) return say({ screenReset: true }, "Okay, the screen layout is back to the defaults.");
  // one edge cut off
  const side = /\bthe (top|bottom|left|right)( side| edge)?( of the screen)? (is|gets|are) (cut off|cropped|hidden|missing|off (the )?screen)\b|\b(top|bottom|left|right) (is |gets )?cut off\b/.exec(q);
  if (side) { const w = side[1] ?? side[7]; const k = { top: "marginTop", bottom: "marginBottom", left: "marginLeft", right: "marginRight" }[w]; return say({ [k + "Delta"]: 1.5 }, `Okay, I moved the ${w} edge in a little. Better?`); }
  if (/\bmove (everything|it|the screen|dayspring) down\b/.test(q)) return say({ marginTopDelta: 1.5, marginBottomDelta: -1.5 }, "Moved everything down a little.");
  if (/\bmove (everything|it|the screen|dayspring) up\b/.test(q)) return say({ marginTopDelta: -1.5, marginBottomDelta: 1.5 }, "Moved everything up a little.");
  if (/\bmove (everything|it|the screen|dayspring) (to the )?left\b/.test(q)) return say({ marginLeftDelta: -1.5, marginRightDelta: 1.5 }, "Moved everything left a little.");
  if (/\bmove (everything|it|the screen|dayspring) (to the )?right\b/.test(q)) return say({ marginLeftDelta: 1.5, marginRightDelta: -1.5 }, "Moved everything right a little.");
  if (/\bmove (everything|it|the screen|dayspring) in\b|\bpull (everything|it) in\b/.test(q)) return say({ overscanDelta: 1.5 }, "Pulled everything in from the edges a little.");
  if (/\bmove (everything|it|the screen|dayspring) out\b|\bspread (everything|it) out\b/.test(q)) return say({ overscanDelta: -1.5 }, "Spread everything out a little.");
  // sizes
  if (/\b(text|words|font|writing|letters)\b/.test(q) && !/\b(message|texts? from|read)\b/.test(q)) {
    if (bigger.test(q)) return say({ textScaleDelta: 10 }, "Bigger text.");
    if (smaller.test(q)) return say({ textScaleDelta: -10 }, "Smaller text.");
  }
  if (/\bclock\b/.test(q)) {
    if (bigger.test(q)) return say({ clockScaleDelta: 15 }, "Bigger clock.");
    if (smaller.test(q)) return say({ clockScaleDelta: -15 }, "Smaller clock.");
    if (/\b(hide|turn off|remove|get rid of)\b/.test(q)) return say({ showClock: false }, "The clock row is hidden. Say \"show the clock\" to bring it back.");
    if (/\b(show|bring back|turn on)\b/.test(q)) return say({ showClock: true }, "The clock is back.");
  }
  if (/\bmake (everything|it all|the whole (screen|display)|dayspring) (bigger|larger)\b|\beverything (is )?too small\b/.test(q)) return say({ uiScaleDelta: 10 }, "Made everything a little bigger.");
  if (/\bmake (everything|it all|the whole (screen|display)|dayspring) (smaller|tinier)\b|\beverything (is )?too (big|large)\b/.test(q)) return say({ uiScaleDelta: -10 }, "Made everything a little smaller.");
  // the talk panel
  if (/\b(talk|dayspring|chat|assistant) (panel|side|column|card)\b/.test(q)) {
    if (/\b(wider|bigger|larger)\b/.test(q)) return say({ talkWidthDelta: 5 }, "Made my panel wider.");
    if (/\b(narrower|thinner|smaller)\b/.test(q)) return say({ talkWidthDelta: -5 }, "Made my panel narrower.");
    if (/\bon the left|to the left\b/.test(q)) return say({ layoutMode: "talkLeft" }, "My panel is on the left now.");
    if (/\bon the right|to the right\b/.test(q)) return say({ layoutMode: "talkRight" }, "My panel is on the right now.");
  }
  if (/\b(one|single) column\b/.test(q)) return say({ layoutMode: "one" }, "One column it is.");
  if (/\btwo columns?\b/.test(q)) return say({ layoutMode: "two" }, "Two columns.");
  if (/\b(compact|tighter) (layout|screen|spacing)\b|\bmake (it|the screen|everything) (more )?compact\b/.test(q)) return say({ density: "compact" }, "Tighter spacing.");
  if (/\b(comfortable|roomier|normal) (layout|spacing)\b|\bmore (room|space) between\b/.test(q)) return say({ density: "comfortable", layoutMode: "auto" }, "Back to comfortable spacing.");
  if (/\b(automatic|auto|default) layout\b/.test(q)) return say({ layoutMode: "auto" }, "Automatic layout.");
  if (/\bkeep (the )?proportions\b|\bdon'?t stretch\b/.test(q)) return say({ fit: "keep" }, "Keeping the proportions.");
  if (/\bstretch (it |everything )?to fill\b/.test(q)) return say({ fit: "fill" }, "Filling the screen.");
  // what's shown
  const card = [[/\bexam (card|countdown)\b/, "showExam", "the exam card"], [/\b(course|study) (rings?|cards?|progress)\b|\bcourse rings?\b/, "showCourses", "the course rings"],
    [/\b(now and next|now card|next card|now\/next)\b/, "showNowNext", "Now and Next"], [/\b(rotating panel|carousel|slideshow|main panel|big panel)\b/, "showPanel", "the rotating panel"],
    [/\b(transcript|captions?|what you('| a)re saying)\b/, "showTranscript", "the transcript"]].find(([re]) => re.test(q));
  if (card && /\b(hide|turn off|remove|get rid of|don'?t show|no more)\b/.test(q) && !/\bcarousel (speed|faster|slower)\b/.test(q)) return say({ [card[1]]: false }, `Okay, ${card[2]} is hidden.`);
  if (card && /\b(show|bring back|turn on|put back)\b/.test(q)) return say({ [card[1]]: true }, `${card[2].charAt(0).toUpperCase() + card[2].slice(1)} is back.`);
  // the rotating panel's pace; how many schedule rows
  if (/\b(carousel|rotating panel|slides?|panel)\b/.test(q)) {
    if (/\b(stop|pause|freeze) (rotating|changing|moving)|\b(don'?t|do not|stop) (rotate|rotating|change|changing)\b/.test(q)) return say({ carouselSeconds: 0 }, "The panel stays put now. Say \"rotate the panel again\" to turn it back on.");
    if (/\b(rotate|rotating|changing) again\b|\bstart rotating\b/.test(q)) return say({ carouselSeconds: 40 }, "The panel rotates again.");
    if (/\b(slower|less often)\b/.test(q)) return say({ carouselSecondsDelta: 20 }, "Slower slides.");
    if (/\b(faster|more often|quicker)\b/.test(q)) return say({ carouselSecondsDelta: -15 }, "Faster slides.");
  }
  const rows = /\bshow (only )?(\d{1,2}) (rows|items|lines) (on|in|of) (the |my )?(schedule|today|list)\b/.exec(q);
  if (rows) return say({ listRows: Number(rows[2]) }, `Showing ${rows[2]} rows of the schedule.`);
  return null;
}

// Spoken commands that work with or without Claude.
export function parse(text) {
  const q = String(text).toLowerCase().replace(/[.!?]/g, "").trim();
  const mins = (() => {
    const m = /\bfor (?:an? )?(\d+|half an?|an?)?\s*(hour|hours|minute|minutes|min)\b/.exec(q);
    if (!m) return /\buntil (?:the )?morning\b|\btonight\b/.test(q) ? minutesUntil(5, 0) : null;
    const n = m[1] && /^\d+$/.test(m[1]) ? Number(m[1]) : m[1] && /half/.test(m[1]) ? 0.5 : 1;
    return /hour/.test(m[2]) ? Math.round(n * 60) : n;
  })();
  // default Bible version: "use the World English Bible by default", "read from the ESV by default", "switch to the KJV"
  const bibleV = BIBLE_WORDS.find(([re]) => re.test(q));
  if (bibleV && /\b(by default|as (my|the) default|default (bible|version|translation)|switch (to|bibles|versions|translations)|use the|always read|from now on)\b/.test(q) && !/\b\d+\s*[:\s]\s*\d+\b|\bchapter\b/.test(q)) return { bibleVersion: bibleV[1] };
  // voice changes first: "go back to the default voice" is about the voice, not where sound plays
  if (/\b(voice|sound like|talk as)\b/.test(q) && /\b(change|switch|use|different|new|another|try|give me|go back|back to)\b/.test(q) && !/\bon (the )?(tv|screen|monitor|headphones|both)\b/.test(q)) {
    const named = voiceNames().find((n) => new RegExp(`\\b${reEsc(n.toLowerCase())}\\b`).test(q));
    if (named) return { voice: named };
    // "switch your voice to Rachel" with a name Dayspring doesn't have: say so (and list the ones it has)
    const asked = /\bvoice to ([a-z]+)\b|\b(?:use|switch to|try|talk like|sound like) ([a-z]+)'?s voice\b/.exec(q);
    const who = asked && (asked[1] ?? asked[2]);
    if (who && !["a", "the", "your", "my", "another", "different", "new", "default", "normal", "original", "regular", "something"].includes(who) && !VOICE_WORDS.some(([re]) => re.test(who))) return { voiceUnknown: who };
    for (const [re, v] of VOICE_WORDS) if (re.test(q)) return { voice: v };
    if (/\b(default|original|normal|regular|back)\b/.test(q)) return { voice: null };
    if (/\b(different|new|another|try)\b/.test(q)) return { voice: "__next" };
  }
  // "switch to Charlotte", "change to Callum", "be Rachel": a voice name on its own is enough
  {
    const m = /^(?:dayspring,? )?(?:switch|change|go|swap)(?: over)? to ([a-z]+)$|^(?:dayspring,? )?be ([a-z]+)$/.exec(q);
    const named = m && voiceNames().find((n) => n.toLowerCase() === (m[1] ?? m[2]));
    if (named) return { voice: named };
  }
  // "demo the voices", "let me hear the voices", "what voices do you have"
  if (/\b(demo|sample|preview|audition|hear|show me|list|what are) (all )?(of )?(the |your )?(different )?voices\b|\bwhat voices (do you have|are there|can you do)\b|\bvoice (demo|samples)\b/.test(q)) return { voiceDemo: true };
  // volume: "volume 60", "set the volume to 40 percent", "turn it up", "louder", "turn the music down"
  {
    // which level: videos, music, the chimes/sound effects, the alarm, Tune in's call answers, else the voice
    const video = /\b(videos?|youtube)\b/.test(q), music = !video && /\b(music|songs?|spotify|playlist)\b/.test(q);
    const sounds = !video && !music && /\b(sounds|sound effects|chimes?|dings?|bells?|beeps?|notification sounds?)\b/.test(q);
    const alarm = !video && !music && !sounds && /\balarm\b/.test(q);
    const call = !video && !music && !sounds && !alarm && /\b(call|tune ?in)\b/.test(q) && /\bvolume|louder|quieter|softer|turn\b/.test(q);
    const key = video ? "videoVolume" : music ? "musicVolume" : sounds ? "soundsVolume" : alarm ? "alarmVolume" : call ? "callVolume" : "volume";
    const n = /\b(?:volume|turn (?:it|yourself|your voice|the (?:music|videos?|volume|sounds|chimes?|alarm)) to|set (?:the |your )?(?:music |video |voice |sounds? |chimes? |alarm |call )?volume to)\s*(?:to\s*)?(\d{1,3})\s*(?:percent|%)?\b/.exec(q);
    if (n && /\b(volume|turn|set)\b/.test(q)) return { [key]: Number(n[1]) };
    if (/\b(turn (it|yourself|your voice|the volume|the music|the videos?|the sounds|the chimes?|the alarm|that|this) up|turn up (the )?(volume|sound|sounds|chimes?|alarm|music|videos?|your voice)|louder|speak up|volume up|a (little|bit) louder|can'?t hear you|too quiet)\b/.test(q)) return { [key + "Delta"]: 15 };
    if (/\b(turn (it|yourself|your voice|the volume|the music|the videos?|the sounds|the chimes?|the alarm|that|this) down|turn down (the )?(volume|sound|sounds|chimes?|alarm|music|videos?|your voice)|quieter|softer|volume down|too loud|a (little|bit) quieter|lower (the|your) volume)\b/.test(q)) return { [key + "Delta"]: -15 };
  }
  // the screen's size and layout: "make everything bigger", "bigger text", "the top is cut off", "one column", "hide the exam card"…
  {
    const sc = screenPhrase(q);
    if (sc) return sc;
  }
  // the picture: "the screen is cut off" / "make everything smaller" pulls it in; "use more of the screen" pushes it out
  if (/\b(cut off|off the (edge|screen|side)|going off|goes off|doesn'?t fit|not fitting|make (the screen|everything|it|the page) smaller|shrink (the screen|everything|it)|zoom out)\b/.test(q) && !/\b(voice|music|volume)\b/.test(q)) return { overscanDelta: 1.5 };
  if (/\b(use more of the screen|make (the screen|everything|the page) bigger|too much (border|space|black)|zoom in|fill the screen)\b/.test(q)) return { overscanDelta: -1.5 };
  if (/\breset the screen (size|fit)\b/.test(q)) return { overscan: 5 };
  // which microphone: "use my headset mic", "listen through the laptop mic", "which mic are you using"
  if (/\b(mic|microphone)s?\b/.test(q)) {
    if (/\b(which|what) (mic|microphone)\b|\b(mic|microphone) (are you using|status)\b/.test(q)) return { micStatus: true };
    if (/\b(headset|headphones?)\b/.test(q)) return { micInput: "headset" };
    if (/\b(laptop|computer|built-?in|internal|pc)\b/.test(q)) return { micInput: "laptop" };
  }
  // the Voicemeeter mixer (puts Spotify and YouTube on the screen and headphones too)
  if (/\b(voicemeeter|the mixer|audio mixer)\b/.test(q)) {
    if (/\b(off|stop|disable|don'?t use|quit|close)\b/.test(q)) return { mixer: false };
    if (/\b(on|start|use|enable|turn on|back)\b/.test(q)) return { mixer: true };
  }
  // where the sound goes: "audio on both", "play the voice through the tv and headphones", "headphones only", "tv only"
  const outputWords = /\b(tv|television|monitor|display|screen|headphones?|headset|speakers?|laptop|computer|both|everywhere|all three|all of them)\b|\bdefault\b/;
  const aboutSound = /\b(audio|sound|voice|play|playing|output|over|through|switch|use|send|put|move|only|just)\b/;
  // "move the music to the tv", "put spotify on my headphones" — media words are fine when the request is to move it
  const moveMedia = /\b(move|switch|send|put|take)\b.*\b(music|spotify|song|video|youtube|it)\b.*\b(to|on|over|through)\b/.test(q);
  if (aboutSound.test(q) && outputWords.test(q) && (moveMedia || !/\b(spotify|youtube|song|video|playlist|music)\b/.test(q))) {
    const outs = [];
    // "the tv speaker" / "the screen's speakers" / "the monitor" are the Dayspring screen and "the headset speaker" is the
    // headset; only the computer's own speakers are "speakers"
    const qq = q.replace(/\b(tv|television|monitor|screen'?s?|display'?s?) speakers?\b/g, "tv").replace(/\b(monitor|display|screen)\b/g, "tv").replace(/\b(headset|headphone) speakers?\b/g, "headset");
    if (/\b(all three|all of them|every speaker|everything|everywhere)\b/.test(qq)) outs.push("tv", "headphones", "speakers");
    if (/\bboth\b/.test(qq) && !/\b(laptop|computer|speakers?)\b/.test(qq)) outs.push("tv", "headphones");
    if (/\b(tv|television)\b/.test(qq)) outs.push("tv");
    if (/\b(headphones?|headset)\b/.test(qq)) outs.push("headphones");
    if (/\b(laptop|computer)( speakers?)?\b|\bspeakers?\b/.test(qq)) outs.push("speakers");
    // "…my headset and NOT the TV", "do not play through the TV", "without the laptop": those are left out
    const NOT = String.raw`\b(not|don'?t|do not|no|without|except|stop( using)?|instead of|rather than)\b[^.,;]{0,30}?\b`;
    const negated = { tv: new RegExp(NOT + "(tv|television)\\b"), headphones: new RegExp(NOT + "(headphones?|headset)\\b"), speakers: new RegExp(NOT + "(laptop|computer|speakers?)\\b") };
    for (const [role, re] of Object.entries(negated)) if (re.test(qq)) { for (let i = outs.length - 1; i >= 0; i--) if (outs[i] === role) outs.splice(i, 1); }
    if (!outs.length && Object.values(negated).some((re) => re.test(qq))) return null;
    if (/\bdefault\b/.test(q)) outs.push("default");
    if (outs.length) return { audioOutputs: outs };
  }
  if (/\b(go |be |turn )?(silent|mute( notifications)?|do not disturb|dnd|quiet mode|stop talking to me)\b/.test(q) && !/\b(off|unmute)\b/.test(q)) return { mode: "silent", minutes: mins };
  if (/\b(chime only|just chime|chimes only|no (voice|talking)|don'?t (talk|speak))\b/.test(q)) return { mode: "chime", minutes: mins };
  if (/\b(notifications? (back )?on|unmute|talk to me again|voice (back )?on|turn (the )?(sound|voice) back on)\b/.test(q)) return { mode: "voice" };
  if (/\b(turn off|disable|no) (the )?(morning )?alarm\b/.test(q)) return { alarm: false };
  if (/\b(turn on|enable) (the )?(morning )?alarm\b/.test(q)) return { alarm: true };
  if (/\b(no|stop|turn off) (the )?chore (reminders|suggestions)\b/.test(q)) return { chores: false };
  if (/\b(turn on|start) (the )?chore (reminders|suggestions)\b/.test(q)) return { chores: true };
  if (/\b(notification|notifications|audio|sound) (settings|status|mode)\b|\bare (you|notifications) (muted|silent)\b/.test(q)) return { status: true };
  // conversation modes
  if (/\b(devil'?s advocate|argue the other side|take the other side|argue against me)\b/.test(q)) return { convMode: "devil" };
  if (/\b(push back( on me)?|challenge me|debate me|spar with me|argue with me|poke holes|don'?t just agree( with me)?|tell me where i'?m wrong)\b/.test(q)) return { convMode: "spar" };
  if (/^(can we (get|be) serious|let'?s be serious|be serious( for a (minute|bit|second))?|no jokes( (right now|for a (bit|while)|please))?|i need to talk about something serious|i need to talk to you about something( serious)?)\b/.test(q)) return { convMode: "serious" };
  if (/\b(back to normal|you can joke again|lighten up|stop (debating|arguing)|normal mode|end (the )?debate)\b/.test(q)) return { convMode: null };
  // pace
  if (/\b(slow down|talk slower|speak slower|slower please|a little slower|too fast)\b/.test(q)) return { speedDelta: -0.08 };
  if (/\b(speed up|talk faster|speak faster|faster please|a little faster|too slow|pick up the pace)\b/.test(q)) return { speedDelta: 0.08 };
  if (/\b(normal speed|regular speed|normal pace)\b/.test(q)) return { speedAdj: 0 };
  // detail
  if (/\b(more detail(ed)?|go deeper|longer (answers|responses)|explain more|more thorough|in more depth)\b/.test(q)) return { detail: "detailed" };
  if (/\b(simpler|keep it (simple|short|brief)|shorter (answers|responses)|less detail|just the basics|be brief|simple (answers|responses))\b/.test(q)) return { detail: "simple" };
  if (/\b(normal (detail|length|answers|responses))\b/.test(q)) return { detail: "normal" };
  // attitude
  if (/\b(drop the attitude|back to (normal|yourself)|be (normal|yourself)( again)?|no attitude|normal attitude)\b/.test(q)) return { attitude: null };
  let am = /\b(?:take on|use|have|with) (?:an? |the )?(.+?) (?:attitude|personality|vibe|tone)\b/.exec(q)
    || /\b(?:talk|speak|act|sound|respond) (?:like|as) (?:an? |the )?(.+)$/.exec(q)
    || /^(?:be|get) (?:more |a bit more |a little more )?(encouraging|intense|gentle|playful|funny|serious|calm|excited|hype|chill|blunt|direct|tough|strict|motivating|motivational|warm|goofy|sarcastic)\b/.exec(q);
  if (am && !/\bvoice\b/.test(q)) return { attitude: am[1].trim() };
  // voice
  if (/\b(voice|sound like|talk as)\b/.test(q) && /\b(change|switch|use|different|new|another|try|give me)\b/.test(q)) {
    const named = voiceNames().find((n) => new RegExp(`\\b${reEsc(n.toLowerCase())}\\b`).test(q));
    if (named) return { voice: named };
    for (const [re, v] of VOICE_WORDS) if (re.test(q)) return { voice: v };
    if (/\b(default|original|normal|regular|back)\b/.test(q)) return { voice: null };
    if (/\b(different|new|another|try)\b/.test(q)) return { voice: "__next" };
  }
  if (/\b(soothing|chipper).*(time of day|morning)|time of day (tone|voice)\b/.test(q)) return { timeTone: !/\b(off|stop|no)\b/.test(q) };
  if (/\bnight ?mode (off|disabled)\b|\bturn off night ?mode\b/.test(q)) return { night: "off" };
  if (/\bnight ?mode (on|dark)\b|\bturn on night ?mode\b|\bmake (it|the (tv|screen)) dark at night\b/.test(q)) return { night: "dark" };
  if (/\bnight ?mode dim\b|\bjust dim (it|the screen) at night\b/.test(q)) return { night: "dim" };
  return null;
}
function minutesUntil(h, m) {
  const now = new Date(), t = new Date(now); t.setHours(h, m, 0, 0); if (t <= now) t.setDate(t.getDate() + 1);
  return Math.round((t - now) / 60000);
}
