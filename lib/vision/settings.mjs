// Settings → Photos & people (data/vision.json; nothing secret in it). Everything that touches faces, sending pictures
// to an AI, or saving messages is OFF until the owner turns it on.
//   faces        "Recognise faces in my photos" (local only; the models download only after a yes)
//   askWho       "Ask who's in pictures" (only matters with faces on; on by default once they are)
//   askPerDay    1 or 2: at most this many photo/people questions a day (default 1), shared with "What's this one?"
//   aiDescribe   "Describe images with AI": sends the picture to the AI provider; asked once (aiConsentAt)
//   saveTexts    "Save my text messages to people's profiles" (encrypted); saveCalls: "Save call history" (encrypted)
//   keepDays     how long saved messages and calls are kept: 0 = keep (default), else 30 / 90 / 365
//   indexPaused  the owner paused the background look through their photos
//   aiMessages   "Let the AI read saved messages when I ask about someone" (off: message words never go to the AI)
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJSONAtomic } from "../atomic.mjs";

const FILE = () => process.env.DAYSPRING_VISION_SETTINGS || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "vision.json");
export const DEFAULTS = { faces: false, facesAt: null, askWho: true, askPerDay: 1, aiDescribe: false, aiConsentAt: null, saveTexts: false, saveCalls: false, keepDays: 0, indexPaused: false, aiMessages: false };
const BOOLS = ["faces", "askWho", "aiDescribe", "saveTexts", "saveCalls", "indexPaused", "aiMessages"];
const KEEP = [0, 30, 90, 365];

let db = null;
function load() { if (!db) { let d = {}; try { d = existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), "utf8")) : {}; } catch { d = {}; } db = { ...DEFAULTS, ...d, ask: d.ask ?? { date: null, count: 0, last: 0 } }; } return db; }
function save() { writeJSONAtomic(FILE(), db, 2); }

export function get() { const d = load(); const out = {}; for (const k of Object.keys(DEFAULTS)) out[k] = d[k]; return out; }
const listeners = [];
export function onChange(fn) { listeners.push(fn); }
export function set(patch = {}) {
  const d = load(), before = get();
  for (const k of BOOLS) if (typeof patch[k] === "boolean") d[k] = patch[k];
  if (patch.askPerDay !== undefined) { const n = Number(patch.askPerDay); if (![1, 2].includes(n)) throw new Error("Ask at most once or twice a day (1 or 2)."); d.askPerDay = n; }
  if (patch.keepDays !== undefined) { const n = Number(patch.keepDays); if (!KEEP.includes(n)) throw new Error("Keep messages for 30, 90 or 365 days, or keep them (0)."); d.keepDays = n; }
  if (patch.faces === true && !before.faces) d.facesAt = new Date().toISOString();
  if (patch.aiDescribe === true && !d.aiConsentAt) d.aiConsentAt = new Date().toISOString();
  save();
  const after = get();
  for (const fn of listeners) { try { fn(after, before); } catch { /* a listener must not break settings */ } }
  return after;
}
// the question budget (who's in this picture, "What's this one?", "Is 'Mike R' the same as Mike?")
export function askState(date) { const d = load(); if (d.ask.date !== date) d.ask = { date, count: 0, last: 0 }; return { ...d.ask }; }
export function countAsk(date, at = Date.now()) { const d = load(); if (d.ask.date !== date) d.ask = { date, count: 0, last: 0 }; d.ask.count++; d.ask.last = at; save(); return { ...d.ask }; }
export function _reset() { db = null; }
