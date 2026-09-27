// The keys and provider choices in .env, written safely for the setup wizard. Only the names below can be written;
// comments and every other line stay exactly as they were; the file is replaced in one step (never half-written).
// Values of secret keys never leave this module: callers get "set / not set" and the last four characters.
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FILE = process.env.DAYSPRING_ENV_FILE || join(ROOT, ".env");

// secret: never shown. plain: safe to show (a choice or an address, not a password).
export const SECRET = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY", "ELEVENLABS_API_KEY", "YOUTUBE_API_KEY", "ESV_API_KEY", "NLT_API_KEY", "DISCORD_BOT_TOKEN", "BRAVE_SEARCH_API_KEY", "GOOGLE_CSE_KEY", "BING_IMAGE_SEARCH_KEY"];
export const PLAIN = ["AI_PROVIDER", "AI_MODEL", "OLLAMA_URL", "TTS_PROVIDER", "ELEVENLABS_MODEL", "DAYSPRING_VOICE_ID", "OPENAI_TTS_MODEL", "DAYSPRING_WAKE_PHRASES", "DISCORD_OWNER_ID", "DISCORD_GUILD_ID", "DISCORD_TEXT_CHANNEL_ID", "SPOTIFY_CLIENT_ID", "GOOGLE_CSE_ID"];
const ALLOWED = new Set([...SECRET, ...PLAIN]);

function lines() {
  if (existsSync(FILE)) return readFileSync(FILE, "utf8").split(/\r?\n/);
  const example = join(ROOT, ".env.example");
  return existsSync(example) ? readFileSync(example, "utf8").split(/\r?\n/) : ["# Dayspring settings. Written by the setup wizard. Never share this file."];
}
const LINE = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=(.*)$/;
function unquote(v) { v = v.trim(); if (/^(['"]).*\1$/.test(v)) return v.slice(1, -1); return v.replace(/\s+#.*$/, ""); }
function quote(v) { return /[\s#'"=]/.test(v) ? `"${v.replace(/"/g, "")}"` : v; }

function readAll() {
  const out = {};
  for (const l of lines()) { const m = LINE.exec(l); if (m) out[m[1]] = unquote(m[2]); }
  return out;
}

// { NAME: "value" } sets, { NAME: "" | null } clears. Also updates process.env so the change works right away.
export function setVars(vars) {
  const want = {};
  for (const [k, v] of Object.entries(vars ?? {})) {
    if (!ALLOWED.has(k)) throw new Error(`${k} can't be set from here`);
    const s = v == null ? "" : String(v).trim();
    if (/[\r\n]/.test(s)) throw new Error(`${k} can't contain line breaks`);
    if (s.length > 400) throw new Error(`${k} is too long`);
    want[k] = s;
  }
  const ls = lines(), done = new Set();
  for (let i = 0; i < ls.length; i++) {
    const m = LINE.exec(ls[i]);
    if (!m || !(m[1] in want)) continue;
    if (done.has(m[1])) { ls[i] = null; continue; }         // a duplicate line: keep only the first
    ls[i] = `${m[1]}=${quote(want[m[1]])}`; done.add(m[1]);
  }
  const add = Object.keys(want).filter((k) => !done.has(k));
  const kept = ls.filter((l) => l !== null);
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  if (add.length) {
    if (kept.length && !LINE.test(kept[kept.length - 1])) kept.push("");   // one blank line after comments, none between settings
    kept.push(...add.map((k) => `${k}=${quote(want[k])}`));
  }
  const tmp = FILE + ".tmp";
  writeFileSync(tmp, kept.join("\r\n") + "\r\n");
  renameSync(tmp, FILE);
  for (const [k, v] of Object.entries(want)) { if (v) process.env[k] = v; else delete process.env[k]; }
  return status(Object.keys(want));
}

// { NAME: { set, last4 } } for secrets, { NAME: { set, value } } for plain choices. Reads the live process first.
export function status(names = [...SECRET, ...PLAIN]) {
  const file = readAll(), out = {};
  for (const k of names) {
    if (!ALLOWED.has(k)) continue;
    const v = process.env[k] || file[k] || "";
    out[k] = SECRET.includes(k) ? { set: Boolean(v), last4: v.length >= 12 ? v.slice(-4) : v ? "…" : "" } : { set: Boolean(v), value: v };
  }
  return out;
}
