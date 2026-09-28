// Bambu Lab printer models: which camera each has, its safe temperature limits, and what's different about it.
//   camera "rtsps": X1 / X1C / X1E / H2D / H2S / P2S — rtsps://bblp:<access code>@<ip>:322/streaming/live/1
//                   (H2D/H2S: also turn on "LAN Only Liveview" on the printer)
//   camera "tcp":   P1P / P1S / A1 / A1 mini — JPEG frames over TLS on port 6000 (an 80-byte login, then 16-byte headers)
//   camera "none":  X2D and anything newer that uses Bambu's own WebRTC stream (not supported yet)
// Serial-number prefixes are only a hint for the model picker (the owner chooses the model).
export const MODELS = {
  X1C: { label: "X1 Carbon", family: "X1", camera: "rtsps", nozzleMax: 300, bedMax: 110, chamber: false, ams: true, lidar: true },
  X1: { label: "X1", family: "X1", camera: "rtsps", nozzleMax: 300, bedMax: 110, chamber: false, ams: true, lidar: true },
  X1E: { label: "X1E", family: "X1", camera: "rtsps", nozzleMax: 320, bedMax: 120, chamber: true, chamberMax: 60, ams: true, lidar: true },
  P1S: { label: "P1S", family: "P1", camera: "tcp", nozzleMax: 300, bedMax: 100, chamber: false, ams: true },
  P1P: { label: "P1P", family: "P1", camera: "tcp", nozzleMax: 300, bedMax: 100, chamber: false, ams: true },
  P2S: { label: "P2S", family: "P2", camera: "rtsps", nozzleMax: 300, bedMax: 110, chamber: false, ams: true },
  A1: { label: "A1", family: "A1", camera: "tcp", nozzleMax: 300, bedMax: 100, chamber: false, ams: true, amsLite: true },
  A1MINI: { label: "A1 mini", family: "A1", camera: "tcp", nozzleMax: 300, bedMax: 80, chamber: false, ams: true, amsLite: true },
  H2D: { label: "H2D", family: "H2", camera: "rtsps", nozzleMax: 350, bedMax: 120, chamber: true, chamberMax: 65, ams: true, dualNozzle: true, liveviewToggle: true },
  H2S: { label: "H2S", family: "H2", camera: "rtsps", nozzleMax: 350, bedMax: 120, chamber: true, chamberMax: 65, ams: true, liveviewToggle: true },
};
export const PREFIX = { "00M": "X1C", "00W": "X1", "03W": "X1E", "01S": "P1P", "01P": "P1S", "030": "A1MINI", "039": "A1", "094": "H2D", "093": "H2S" };
export const modelOf = (key) => MODELS[String(key ?? "").toUpperCase().replace(/[\s-]/g, "").replace(/^A1MINI$/, "A1MINI")] ?? null;
export function guessFromSerial(serial) { const p = String(serial ?? "").slice(0, 3).toUpperCase(); return PREFIX[p] ?? null; }
export const SPEEDS = { 1: "silent", 2: "standard", 3: "sport", 4: "ludicrous" };
// gcode_state → our state
export const STATES = { IDLE: "idle", PREPARE: "preparing", SLICING: "preparing", RUNNING: "printing", PAUSE: "paused", FINISH: "finished", FAILED: "failed", INIT: "preparing", OFFLINE: "offline", UNKNOWN: "unknown" };
