// Remote control between the owner's own Dayspring devices: the rules both ends agree on. No I/O, no imports, so the
// Settings page, the voice skills, the engine and the tests can all read it cheaply.
//
//   PERMS / PERM_WORDS / DEFAULT_PERMS    what one device may ask another to do (per SENDING device, signed grants)
//   ACTIONS                                every remote action → the permission it needs
//   permFor(action) · isRisky(action, args) · riskText(action, args)
//   LIMITS                                 sizes, lifetimes and rates (the hub's SQL enforces its own copies of these)
//
// The protocol itself is docs/dev/remote-protocol.md; the threat model is docs/dev/remote-security.md.

export const PROTO = "ds-remote/1";

// what a device may ask the others to do
export const PERMS = ["status", "schedule", "announce", "control", "camera", "print"];
export const PERM_WORDS = {
  status: "View status (online, what's running, printer progress)",
  schedule: "See the schedule and recent notifications",
  announce: "Say things and set reminders on the other devices",
  control: "Control smart devices (outlets, computers, fans…)",
  camera: "See cameras (printer cameras and home cameras)",
  print: "Start 3D prints",
};
// what a newly approved device gets unless the owner changes it while approving: everything but starting prints
export const DEFAULT_PERMS = ["status", "schedule", "announce", "control", "camera"];

// action → permission. "ping" needs nothing beyond being one of the owner's approved devices.
export const ACTIONS = {
  ping: null,
  status: "status",
  schedule: "schedule",
  announce: "announce",
  remind: "announce",
  notify: "announce",
  devices: "control",                 // devices.run(command, { from }) on the receiving device (lib/devices)
  "printers.status": "status",
  "printers.camera": "camera",
  "printers.start": "print",
  "cameras.list": "status",
  "cameras.snapshot": "camera",
  "cameras.clip": "camera",
};
export const permFor = (action) => (Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : undefined);
export const cleanPerms = (list) => [...new Set((Array.isArray(list) ? list : []).map(String).filter((p) => PERMS.includes(p)))].sort();

// Risky: the owner confirms on the SENDING device before it goes (and the receiver refuses a risky command that doesn't
// say it was confirmed). Starting a print, anything that switches power to a computer or a heat source, unlocking,
// shutting down or restarting.
const HEAT_OR_POWER = /\b(computer|pc|desktop|laptop|server|printer|heater|space heater|oven|stove|hob|iron|kettle|dryer|garage|gate|door|lock|furnace|boiler|ac|air ?conditioner)\b/;
export function isRisky(action, args = {}) {
  if (action === "printers.start") return true;
  if (action !== "devices") return false;
  const c = String(args?.command ?? "").toLowerCase();
  if (/\b(unlock|open the garage|open the gate|shut ?down|restart|reboot|power ?cycle|factory reset|format|delete|wipe)\b/.test(c)) return true;
  if (/\b(turn|switch|power|cut|kill)\b.*\b(on|off|up|down)\b|\b(on|off)\b.*\b(power)\b/.test(c) && HEAT_OR_POWER.test(c)) return true;
  if (/\b(start|resume|cancel|stop|abort)\b.*\bprint/.test(c)) return true;
  return false;
}
export function riskText(action, args = {}) {
  if (action === "printers.start") return `start a print${args?.printer ? " on " + args.printer : ""}`;
  return String(args?.command ?? action).trim().replace(/[.?!]+$/, "");
}

export const LIMITS = {
  COMMAND_TTL_MS: 5 * 60_000,         // a command nobody picked up is gone after 5 minutes (the hub refuses longer)
  CHUNK_TTL_MS: 2 * 60_000,           // camera pieces: 2 minutes
  MAX_AGE_MS: 5 * 60_000,             // a command older than this is refused even if it hasn't expired
  MAX_SKEW_MS: 60_000,                // clocks may disagree by a minute
  REPLY_WAIT_MS: 20_000,              // how long the sender waits for an answer
  BLOB_WAIT_MS: 45_000,               // …for a camera still or clip
  CHUNK_BYTES: 60 * 1024,             // raw bytes per encrypted piece (the hub takes envelopes up to 96 KB)
  MAX_STILL_BYTES: 2 * 1024 * 1024,
  MAX_CLIP_BYTES: 8 * 1024 * 1024,
  ONLINE_MS: 150_000,                 // seen in the last 2.5 minutes = online (heartbeat every minute)
  HEARTBEAT_MS: 60_000,
  POLL_MS: 15_000,                    // looking for new messages when live updates aren't connected
  POLL_LIVE_MS: 60_000,               // …and a safety net when they are
  MAX_BACKOFF_MS: 5 * 60_000,         // no endless fast retries: at most every 5 minutes while the hub is unreachable
  PER_SENDER_PER_MIN: 60,             // commands one device may send another per minute
  PAIRING_TTL_MS: 10 * 60_000,
  LIVE_FRAME_MS: 3000,                // the "live" camera view: one frame every 3 seconds…
  LIVE_MAX_MS: 2 * 60_000,            // …for 2 minutes, then it pauses until asked again
};
