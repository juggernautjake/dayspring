// Who this Dayspring belongs to, and how they want it: everything personal lives here (data/owner.json), never in the
// code. The setup wizard (/setup.html) fills it in; Settings changes it later. A fresh install starts neutral.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const FILE = process.env.DAYSPRING_OWNER_FILE || join(dirname(fileURLToPath(import.meta.url)), "..", "data", "owner.json");   // (tests: a temp file)
export const DEFAULTS = {
  setupDone: false,
  name: "",                    // "Sam"
  nickname: "",                // the first of their nicknames (kept for older code)
  nicknames: [],               // up to 30 names the assistant picks from now and then ("Sammy", "Champ", "Boss")
  pronouns: "they",            // he | she | they (for how it talks about them)
  assistantName: "Dayspring",  // what they call the assistant (1–19 characters; lib/naming.mjs checks it). "Dayspring" stays the app's name.
  assistantSay: "",            // how to say the name, for the voice and for hearing it ("Ee-fa" for Aoife); "" = as written
  wakeWords: ["dayspring"],    // what wakes it up (lowercase, up to 3)
  wakeFollowsName: true,       // the wake word is the name, and changes with it (off once they pick their own wake words)
  wakeSay: {},                 // { wake word: how it sounds } for spellings that aren't said the way they look
  wakeAlso: {},                // { wake word: ["also accept", …] } words the recognizer writes instead (added by the owner)
  wakeTrained: {},             // { wake word: [what the recognizer heard, …] } from "Train my wake word"
  wakeSensitivity: "normal",   // strict | normal | relaxed (public/wakeword.js)
  about: "",                   // a few sentences: work, family, what matters (for the AI)
  interests: [],               // hobbies and interests (for conversation and humor)
  humor: "light, friendly teasing",
  location: { place: "", lat: null, lon: null, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  // "fixed" blocks the planner never moves (work, church, classes, kids' pickups…): categories and title words
  fixed: { categories: ["work"], titleWords: [] },
  features: {
    faith: false,              // morning devotion, prayer list, Scripture, church, memory verses
    church: false,
    memoryVerses: false,
    chores: true,              // micro-habits in the gaps
    photos: true,              // photos from their computer in the showcase
    music: true,               // Spotify / YouTube
    weather: true,
    news: true,                // needs an AI with web search
    phone: false,              // texts through Windows Phone Link
    claudeCode: false,         // work on Dayspring by voice with the Claude Code CLI
  },
  photoDirs: [],               // folders to show photos from (empty: their Pictures folders)
  fileRoot: "",                // the folder Dayspring may read and write under (empty: their user folder)
  diagnostics: true,           // local developer log (data/devlog), never uploaded
  display: "auto",             // which screen the Dayspring screen opens on: auto | primary | secondary | a screen number (1, 2…)
  notesDir: "",                // where write_note saves notes (empty: data/notes)
  backupDir: "",               // where file changes are backed up first (empty: data/file-backups)
  displayBrowser: "default",   // "default" (the Windows default browser) or one of browsers.mjs KNOWN ids: edge, chrome, brave, firefox…; DS_BROWSER overrides
  openAs: "auto",              // how the Dayspring screen opens: auto (a window on the main screen, full screen on a second one) | window | compact | fullscreen | tab; DS_OPEN_AS overrides
  miniBounds: null,            // where "Dayspring mini" was last left: { x, y, width, height }
  lastWindow: null,            // "compact" or "full": how the Dayspring window was last left (the next launch opens the same way)
  keepScreenOpen: false,       // reopen the Dayspring screen if it closes (a TV or always-on display); off: closed stays closed
  openOnStartup: false,        // when Dayspring starts with Windows: also open the screen (off: it runs hidden for alarms and notifications)
  persona: null,               // the personality: { preset, base, role, pins, custom, easterEggs, templates, defaultTemplate } (lib/persona)
  // permissions (files, programs, browser, web) live in data/permissions.json: see permissions.mjs
};
let cache = null;
function load() {
  if (cache) return cache;
  const saved = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
  cache = { ...structuredClone(DEFAULTS), ...saved, location: { ...DEFAULTS.location, ...(saved.location ?? {}) }, features: { ...DEFAULTS.features, ...(saved.features ?? {}) }, fixed: { ...DEFAULTS.fixed, ...(saved.fixed ?? {}) } };
  if (!cache.nicknames?.length && cache.nickname) cache.nicknames = [cache.nickname];   // profiles from before the list
  // profiles from before wake words could follow the name: they follow it when the wake word IS the name (the usual
  // "Dayspring" / "dayspring"), so an existing install keeps both until the owner changes one
  if (!("wakeFollowsName" in saved)) cache.wakeFollowsName = !saved.wakeWords?.length || sameWords(saved.wakeWords, [cache.assistantName]);
  return cache;
}
const lc = (w) => String(w ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const sameWords = (a, b) => (a ?? []).map(lc).filter(Boolean).join("|") === (b ?? []).map(lc).filter(Boolean).join("|");
export function get() { return structuredClone(load()); }
export function set(patch = {}) {
  const o = load();
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULTS)) continue;
    if (k === "location" || k === "features" || k === "fixed") o[k] = { ...o[k], ...v };
    else o[k] = v;
  }
  // nicknames: a clean list of at most 30; "nickname" alone (older callers) goes to the front
  if ("nickname" in patch && !("nicknames" in patch) && patch.nickname) o.nicknames = [patch.nickname, ...(o.nicknames ?? [])];
  const seen = new Set();
  o.nicknames = (Array.isArray(o.nicknames) ? o.nicknames : String(o.nicknames ?? "").split(/[,\n]/))
    .map((n) => String(n).trim().slice(0, 40)).filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase())).slice(0, MAX_NICKNAMES);
  o.nickname = o.nicknames[0] ?? "";
  if (typeof o.wakeWords === "string") o.wakeWords = o.wakeWords.split(",");
  o.wakeWords = [...new Set((o.wakeWords ?? []).map(lc).filter(Boolean))].slice(0, 3);
  if (!String(o.assistantName ?? "").trim()) o.assistantName = "Dayspring";
  // wake words set on their own stop following the name; set to exactly the name, they follow it again
  if ("wakeWords" in patch && !("wakeFollowsName" in patch)) o.wakeFollowsName = !o.wakeWords.length || sameWords(o.wakeWords, [o.assistantName]);
  if (o.wakeFollowsName !== false) { o.wakeFollowsName = true; o.wakeWords = [lc(o.assistantName)]; }
  if (!o.wakeWords.length) o.wakeWords = [lc(o.assistantName)];
  // the per-word extras only for the wake words there are now
  for (const k of ["wakeSay", "wakeAlso", "wakeTrained"]) o[k] = Object.fromEntries(Object.entries(o[k] && typeof o[k] === "object" ? o[k] : {}).filter(([w]) => o.wakeWords.includes(w)));
  if (!["strict", "normal", "relaxed"].includes(o.wakeSensitivity)) o.wakeSensitivity = "normal";
  mkdirSync(dirname(FILE), { recursive: true });
  // all or nothing: a power cut mid-save never leaves a half-written owner.json
  const tmp = FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(o, null, 2));
  renameSync(tmp, FILE);
  return get();
}
// Handy getters (never empty, so sentences always read well)
export const name = () => load().name || "friend";
export const MAX_NICKNAMES = 30;
export const nicknames = () => [...(load().nicknames ?? [])];
// one of their nicknames, picked at random each time (falls back to their name)
export const nick = () => { const n = nicknames(); return n.length ? n[Math.floor(Math.random() * n.length)] : load().name || "friend"; };
export const assistant = () => load().assistantName || "Dayspring";
export const feature = (f) => Boolean(load().features?.[f]);
export const home = () => homedir();
export const fileRoot = () => load().fileRoot || homedir();
export const they = () => ({ he: "he", she: "she" }[load().pronouns] ?? "they");
export const them = () => ({ he: "him", she: "her" }[load().pronouns] ?? "them");
export const their = () => ({ he: "his", she: "her" }[load().pronouns] ?? "their");
export const setupDone = () => Boolean(load().setupDone);
export const display = () => load().display || "auto";
export const OPEN_AS = ["auto", "window", "compact", "fullscreen", "tab"];
export const openAs = () => { const v = String(load().openAs ?? "auto").toLowerCase(); return OPEN_AS.includes(v) ? v : "auto"; };
export const displayBrowser = () => { const b = String(load().displayBrowser ?? "default").toLowerCase(); return /^[a-z]{2,16}$/.test(b) ? b : "default"; };
