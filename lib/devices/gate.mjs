// Release channels: the smart-home devices ("devices") and the 3D printers ("printers") are features at stage "dev".
// lib/features.mjs decides whether they're on for this install; until that file exists everything is on.
//   on("devices") · on("printers") → true | false (never throws)
let features = null;
export const loaded = import("../features.mjs").then((m) => { features = m; }).catch(() => { features = { on: () => true }; });
export function on(id) {
  try { return features ? features.on(id) !== false : true; } catch { return true; }
}
