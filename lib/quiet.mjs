// Quick OFF / Do Not Disturb, and how each kind of notification arrives.
//
//   Active  normal: listens for "Dayspring", speaks replies and notifications
//   Quiet   still hears "Dayspring" (or not at all, if the screen's mic is muted), but says nothing: replies and
//           notifications show on screen only. Alarms still ring.
//   Off     no listening at all (the screen stops speech recognition and releases the microphone, Tune in pauses), nothing
//           is spoken. Time, the schedule and alarms keep going; alarms ring unless "Alarms still ring when Off" is off.
//
// Notification kinds: reminders, schedule (start times, changes, check-ins), texts (phone), lantern, discover, system
// (updates, Claude Code, webhooks, weather). Each is auto (the notification mode: voice/chime/silent) or voice | chime |
// silent; "notifyAll" (a quick switch) overrides them all. Quiet and Off make everything silent (on-screen only).
//
//   state() · setState(s) · kindOf(item) · modeFor(kind) · handle(text)
import * as settings from "./settings.mjs";
import { broadcast } from "./bus.mjs";

export const STATES = settings.LISTEN_STATES;
export const KINDS = settings.NOTIFY_KINDS;
export const KIND_LABEL = { reminders: "Reminders", schedule: "Schedule (start times, changes, check-ins)", texts: "Texts and phone", lantern: "Lantern", discover: "Discover", system: "System, updates and alerts" };
const LABEL = { active: "Active", quiet: "Quiet", off: "Off" };
const SAID = {
  active: "I'm back on and listening.",
  quiet: "Quiet mode: I'll still hear “Dayspring”, but I'll only show things on screen. Alarms still ring.",
  off: "I'm off: I'm not listening at all and won't speak. The schedule and alarms keep going. Click the badge or say “Dayspring, turn back on” when you type it.",
};

export const state = () => { const s = settings.get().listenState; return STATES.includes(s) ? s : "active"; };
export const label = (s = state()) => LABEL[s];

let tunein = null, tuneinWasOn = false;
export function _setDeps(d) { if (d.tunein) tunein = d.tunein; }

// Change the state; the pages hear "listenstate" and apply it (mic released on Off). Announced once, on screen.
export async function setState(next, { from = "settings" } = {}) {
  if (!STATES.includes(next)) throw new Error(`Say active, quiet or off.`);
  const before = state();
  const s = settings.set({ listenState: next });
  broadcast("settings", s);
  broadcast("listenstate", { state: next, before, from, text: SAID[next] });
  // Tune in (the headset/call listener) pauses while Off and comes back after
  try {
    if (tunein) {
      if (next === "off" && tunein.isOn()) { tuneinWasOn = true; await tunein.stop({ shutdown: true }); }
      else if (next !== "off" && before === "off" && tuneinWasOn) { tuneinWasOn = false; await tunein.resume(); }
    }
  } catch { /* Tune in keeps its own state */ }
  return { state: next, before, text: before === next ? `Already ${LABEL[next].toLowerCase()}.` : SAID[next] };
}

// Which kind an announcement is
export function kindOf(item = {}) {
  const k = item.kind;
  if (k === "reminder") return "reminders";
  if (k === "text") return "texts";
  if (k === "lantern") return "lantern";
  if (k === "discover") return "discover";
  if (k === "discovery") return "discoveries";          // a secret personality was found (lib/persona)
  if (["update", "coder", "hook", "weather", "system", "claude"].includes(k)) return "system";
  return "schedule";      // start, checkin, buffer, ready, rundown, person, church, and everything else on the schedule
}

// How a notification of this kind arrives right now: voice | chime | silent
export function modeFor(kind, s = settings.get()) {
  const st = STATES.includes(s.listenState) ? s.listenState : "active";
  if (st !== "active") return "silent";
  if (s.notifyAll) return s.notifyAll;
  const c = s.notify?.[kind];
  if (settings.MODES.includes(c)) return c;
  return settings.MODES.includes(s.mode) ? s.mode : "voice";
}

const MODE_WORD = { voice: "spoken", chime: "a chime only", silent: "silent (on screen only)" };
const KIND_WORDS = [
  [/\breminders?\b/, "reminders"], [/\b(schedule|calendar|start times?|check-?ins?)\b/, "schedule"], [/\b(texts?|messages?|phone)\b/, "texts"],
  [/\blantern\b/, "lantern"], [/\bdiscover\b/, "discover"], [/\b(system|updates?|alerts?)\b/, "system"],
];

// "Dayspring, go quiet" / "turn off listening" / "turn back on" / "just chime for reminders" / "make notifications silent"
export async function handle(text) {
  const q = String(text ?? "").toLowerCase().replace(/[.!?,]/g, " ").replace(/\s+/g, " ").replace(/^(hey )?dayspring /, "").trim();
  if (!q) return null;
  if (/^(go quiet|be quiet mode|quiet mode on|switch to quiet( mode)?|only listen for (your name|dayspring|the wake word))$/.test(q)) return (await setState("quiet", { from: "voice" })).text;
  if (/^(turn off listening|stop listening( completely)?|turn yourself off|go off|switch off|dayspring off|turn off( the)? mic(rophone)?|don'?t listen( to me)?)$/.test(q)) return (await setState("off", { from: "voice" })).text;
  if (/^(turn (back )?on|turn (yourself )?back on|start listening( again)?|you can listen again|wake up|back on|active mode|listen again|turn listening (back )?on)$/.test(q)) return (await setState("active", { from: "voice" })).text;
  if (/^(are you (listening|on|off|quiet)|what mode are you in|listening status)$/.test(q)) return `I'm ${LABEL[state()].toLowerCase()}.`;
  if (/^(all )?notifications? (back )?to normal$|^normal notifications$|^undo (all )?silent$/.test(q)) { const s = settings.set({ notifyAll: null }); broadcast("settings", s); return "Notifications are back to your usual settings."; }
  // notification modes per kind: "just chime for reminders", "make texts silent", "speak lantern notifications"
  const mode = /\b(just )?chimes?( only)?\b/.test(q) ? "chime" : /\b(silent|silence|mute|quiet)\b/.test(q) ? "silent" : /\b(speak|say|read|announce|out loud|voice)\b/.test(q) ? "voice" : /\b(normal|default|usual)\b/.test(q) ? "auto" : null;
  if (!mode || !/\b(notifications?|reminders?|texts?|messages?|schedule|lantern|discover|updates?|alerts?|everything|all)\b/.test(q)) return null;
  if (!/^(make|set|switch|turn|just|only|please|speak|say|read|announce|chime|mute|silence|put)\b|\b(for|to)\b/.test(q)) return null;
  if (/\b(all|every|everything)\b/.test(q) || /^(make|set|turn|put) (the )?notifications? /.test(q) && !KIND_WORDS.some(([re]) => re.test(q.replace(/notifications?/, "")))) {
    const s = settings.set({ notifyAll: mode === "auto" ? null : mode }); broadcast("settings", s);
    return mode === "auto" ? "Notifications are back to your usual settings." : `All notifications are ${MODE_WORD[mode]} now. Say “notifications back to normal” to undo it.`;
  }
  const kinds = KIND_WORDS.filter(([re]) => re.test(q)).map(([, k]) => k);
  if (!kinds.length) return null;
  const s = settings.set({ notify: Object.fromEntries(kinds.map((k) => [k, mode])) }); broadcast("settings", s);
  const names = kinds.map((k) => KIND_LABEL[k].split(" (")[0].toLowerCase()).join(" and ");
  return mode === "auto" ? `${names[0].toUpperCase() + names.slice(1)} follow your usual notification mode again.` : `Okay: ${names} will be ${MODE_WORD[mode]}.`;
}
