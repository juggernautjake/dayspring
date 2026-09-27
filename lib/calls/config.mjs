// Settings for calls and the Discord chat companion (data/calls.json). The Discord token and the owner's Discord ID stay
// in .env (Settings → Discord); everything else about how Dayspring behaves in calls and chat lives here.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJSONAtomic } from "../atomic.mjs";

const FILE = () => process.env.DS_CALLS_FILE || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "calls.json");

export const DEFAULTS = {
  // speed
  hangMs: 450,               // quiet after speech that ends an utterance (the old Tune in waited 700 ms)
  fastModel: "auto",         // the AI model for call answers: "auto" = the provider's fastest, or an exact model id
  ttsModel: "auto",          // ElevenLabs model for call speech: "auto" = the low-latency one the key can use
  ack: "off",                // while thinking: "off" | "earcon" (a soft blip) | "mmhm" (a short "mm-hm")
  quickTranscript: true,     // use the fast speech model's words when they're clear, instead of re-reading with the accurate one
  // behaviour
  bargeIn: true,             // stop talking when someone talks over Dayspring (Discord: per person; Tune in: see bargeInTunein)
  bargeInMs: 600,
  bargeInTunein: false,      // Tune in hears one mixed stream, so talking over can't always be told apart from Dayspring's own voice
  arbitration: "bot",        // both the Discord bot and Tune in hear the same call: "bot" answers (when it's in that call) or "tunein"
  followUpMs: 7000,          // after "Dayspring?" alone, the next thing said is the request (the 7-second rule)
  // Discord chat companion
  dm: "server",              // who may DM: "anyone" | "server" (people in a server the bot is in) | "owner" | "off"
  chatChannelId: "",         // a channel where every message is for Dayspring (falls back to DISCORD_TEXT_CHANNEL_ID)
  shareSchedule: false,      // let people other than the owner ask about the owner's schedule
  discordPersona: "",        // a personality (preset id) just for Discord; "" = the same as everywhere
  rate: { perUser: 6, perChannel: 12, windowMs: 60_000, cooldownMs: 1500 },
  memoryTurns: 10,
  memoryIdleMs: 30 * 60_000,
};

let cache = null, cacheAt = 0;
export function get() {
  if (cache && Date.now() - cacheAt < 2000) return cache;
  let saved = {};
  try { saved = JSON.parse(readFileSync(FILE(), "utf8")); } catch { /* defaults */ }
  cache = { ...DEFAULTS, ...saved, rate: { ...DEFAULTS.rate, ...(saved.rate ?? {}) } }; cacheAt = Date.now();
  return cache;
}
const ENUMS = { ack: ["off", "earcon", "mmhm"], arbitration: ["bot", "tunein"], dm: ["anyone", "server", "owner", "off"] };
export function set(patch = {}) {
  const cur = get(), next = { ...cur };
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (!(k in DEFAULTS)) continue;
    if (ENUMS[k]) { if (ENUMS[k].includes(v)) next[k] = v; continue; }
    if (k === "rate" && v && typeof v === "object") { next.rate = { ...cur.rate }; for (const [rk, rv] of Object.entries(v)) if (rk in DEFAULTS.rate && Number.isFinite(Number(rv))) next.rate[rk] = Math.max(0, Number(rv)); continue; }
    if (typeof DEFAULTS[k] === "boolean") next[k] = Boolean(v);
    else if (typeof DEFAULTS[k] === "number") { const n = Number(v); if (Number.isFinite(n)) next[k] = k === "hangMs" ? Math.max(250, Math.min(1500, n)) : k === "bargeInMs" ? Math.max(200, Math.min(3000, n)) : Math.max(0, n); }
    else next[k] = String(v ?? "").slice(0, 80);
  }
  writeJSONAtomic(FILE(), next, 2);
  cache = next; cacheAt = Date.now();
  return next;
}
export function _reset() { cache = null; }
