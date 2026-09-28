// Small running state that must survive a restart: which photos an email or folder camera has already taken in, and
// the alert cooldowns and held summaries. data/cameras-state.json (next to cameras.json). Nothing secret in it.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJSONAtomic } from "../atomic.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FILE = () => process.env.DAYSPRING_CAMERAS_STATE || (process.env.DAYSPRING_CAMERAS_FILE ? join(dirname(process.env.DAYSPRING_CAMERAS_FILE), "cameras-state.json") : join(ROOT, "data", "cameras-state.json"));
let st = null, timer = null;
function load() { if (!st) { try { st = existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), "utf8")) : {}; } catch { st = {}; } } return st; }
export function get(cam, key, dflt = null) { return load()[cam]?.[key] ?? dflt; }
export function set(cam, key, value) { const s = load(); (s[cam] ??= {})[key] = value; soon(); return value; }
export function drop(cam) { const s = load(); delete s[cam]; soon(); }
function soon() { clearTimeout(timer); timer = setTimeout(flush, 1500); timer.unref?.(); }
export function flush() { clearTimeout(timer); if (st) { try { writeJSONAtomic(FILE(), st, 1); } catch (e) { console.log(`cameras: couldn't save state (${e.message})`); } } }
export function _reset() { clearTimeout(timer); st = null; }
