// What Dayspring may do on this computer. The owner decides (first-run setup, then Settings → Permissions); everything
// is off until granted, except looking things up on the web.
//   files: "off" | "custom" (only what's listed in entries) | "all" (everything on this computer)
//   allAccess: "read" | "readwrite"                       — for "all": look only, or look and change
//   entries: [{ path, kind: "folder"|"file", access: "none"|"read"|"readwrite", subfolders: true }]
//            — in "custom" these are what's allowed; in "all" they refine it (e.g. a "none" entry keeps a folder out,
//              a "read" entry makes one folder look-only). The most specific entry wins (a file beats its folder).
//   writeConfirm: "ask" (read the change back and wait for a yes; a backup is made) | "on" (a backup is still made)
//   programs: "off" | "ask" | "on"      browser: drive Dayspring's own browser window      web: search and read web pages
// Always, in every mode: secrets (.env, keys, password vaults, wallets) are never opened (abilities.mjs), and nothing
// inside Windows or Program Files is changed.
// Older files ({ files: "folders", folders: [...], writeFiles }) are read and upgraded without changing what they meant.
// Stored in data/permissions.json (kept apart from owner.json so the two never overwrite each other).
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, relative, isAbsolute, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import * as owner from "./owner.mjs";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const FILE = process.env.DAYSPRING_PERMISSIONS_FILE || join(DATA, "permissions.json");
export const DEFAULTS = { files: "off", allAccess: "read", entries: [], writeConfirm: "ask", programs: "off", browser: false, web: true };
const ACCESS = ["none", "read", "readwrite"];

// ---- storage and the upgrade from the older shape --------------------------------------------------------------------
const cleanPath = (p) => resolve(String(p ?? "").trim().replace(/^"|"$/g, ""));
function cleanEntry(e) {
  if (!e || !String(e.path ?? "").trim()) return null;
  const path = cleanPath(e.path);
  let kind = e.kind === "file" || e.kind === "folder" ? e.kind : null;
  if (!kind) { try { kind = statSync(path).isDirectory() ? "folder" : "file"; } catch { kind = "folder"; } }
  return { path, kind, access: ACCESS.includes(e.access) ? e.access : "read", subfolders: e.subfolders !== false };
}

export function normalize(raw = {}) {
  const r = { ...raw };
  const out = { ...DEFAULTS };
  // older shape: files "folders" + folders[] + writeFiles "off"|"ask"|"on"
  const legacyWrite = ["off", "ask", "on"].includes(r.writeFiles) ? r.writeFiles : null;
  if (r.files === "folders") r.files = "custom";
  out.files = ["off", "custom", "all"].includes(r.files) ? r.files : DEFAULTS.files;
  out.writeConfirm = r.writeConfirm === "on" || r.writeConfirm === "ask" ? r.writeConfirm : legacyWrite === "on" ? "on" : "ask";
  out.allAccess = r.allAccess === "read" || r.allAccess === "readwrite" ? r.allAccess : legacyWrite ? (legacyWrite === "off" ? "read" : "readwrite") : DEFAULTS.allAccess;
  let entries = Array.isArray(r.entries) ? r.entries : [];
  if (!entries.length && Array.isArray(r.folders) && r.folders.length) entries = r.folders.map((f) => ({ path: f, kind: "folder", access: legacyWrite === "off" ? "read" : legacyWrite ? "readwrite" : "read", subfolders: true }));
  const seen = new Map();
  for (const e of entries.map(cleanEntry).filter(Boolean)) seen.set(e.path.toLowerCase(), e);   // the last one for a path wins
  out.entries = [...seen.values()].slice(0, 200);
  out.programs = ["off", "ask", "on"].includes(r.programs) ? r.programs : DEFAULTS.programs;
  out.browser = r.browser === undefined ? DEFAULTS.browser : Boolean(r.browser);
  out.web = r.web === undefined ? DEFAULTS.web : Boolean(r.web);
  return out;
}

let cache = null;
function load() {
  if (cache) return cache;
  if (existsSync(FILE)) {
    try {
      const raw = JSON.parse(readFileSync(FILE, "utf8"));
      cache = normalize(raw);
      if (raw.files === "folders" || !Array.isArray(raw.entries) || raw.writeConfirm === undefined || raw.allAccess === undefined) save();   // upgraded once
      return cache;
    } catch { /* rebuilt below */ }
  }
  // One-time migration: an install that already had a file root keeps what it could do before.
  const o = owner.get();
  cache = o.fileRoot
    ? normalize({ files: "custom", entries: [{ path: o.fileRoot, kind: "folder", access: "readwrite" }], writeConfirm: "ask", programs: "ask", browser: true, web: true })
    : normalize({});
  save();
  return cache;
}
// the older fields ride along (derived), so an older Dayspring reading this file still understands it
function save() {
  mkdirSync(dirname(FILE), { recursive: true });
  const legacy = { folders: cache.entries.filter((e) => e.kind === "folder" && e.access !== "none").map((e) => e.path), writeFiles: canWriteSomewhere(cache) ? cache.writeConfirm : "off" };
  writeFileSync(FILE, JSON.stringify({ ...cache, ...legacy, files: cache.files }, null, 2));
}

// get(): the model, plus the older fields (folders, writeFiles) derived for code that still reads them
export function get() {
  const p = structuredClone(load());
  p.folders = p.entries.filter((e) => e.kind === "folder" && e.access !== "none").map((e) => e.path);
  p.writeFiles = canWriteSomewhere(p) ? p.writeConfirm : "off";
  return p;
}
const canWriteSomewhere = (p) => p.files !== "off" && ((p.files === "all" && p.allAccess === "readwrite") || p.entries.some((e) => e.access === "readwrite"));

// set(patch): any of the fields (new or older names); entries replace the whole list unless `addEntries`/`removePaths` is used
export function set(patch = {}) {
  const cur = load();
  const next = { ...cur };
  const has = (k) => patch[k] !== undefined;
  // older callers
  if (patch.files === "folders") patch = { ...patch, files: "custom" };
  if (has("folders") && !has("entries")) {
    const list = (Array.isArray(patch.folders) ? patch.folders : String(patch.folders).split(/[;\n]/)).map((f) => String(f).trim()).filter(Boolean);
    const keep = new Map(cur.entries.map((e) => [e.path.toLowerCase(), e]));
    next.entries = list.map((f) => keep.get(cleanPath(f).toLowerCase()) ?? { path: f, kind: "folder", access: cur.entries[0]?.access ?? "read", subfolders: true });
  }
  if (has("writeFiles")) {
    if (patch.writeFiles === "off") { next.allAccess = "read"; next.entries = (next.entries ?? cur.entries).map((e) => ({ ...e, access: e.access === "readwrite" ? "read" : e.access })); }
    else if (["ask", "on"].includes(patch.writeFiles)) {
      next.writeConfirm = patch.writeFiles;
      if (!has("allAccess")) next.allAccess = "readwrite";
      if (!has("entries")) next.entries = (next.entries ?? cur.entries).map((e) => ({ ...e, access: e.access === "read" ? "readwrite" : e.access }));
    }
  }
  for (const k of ["files", "allAccess", "writeConfirm", "programs", "browser", "web", "entries"]) if (has(k)) next[k] = patch[k];
  if (Array.isArray(patch.addEntries)) next.entries = [...(next.entries ?? []), ...patch.addEntries];
  if (Array.isArray(patch.removePaths)) { const gone = new Set(patch.removePaths.map((x) => cleanPath(x).toLowerCase())); next.entries = next.entries.filter((e) => !gone.has(cleanPath(e.path).toLowerCase())); }
  cache = normalize(next);
  save();
  return get();
}

const SETTINGS = "You can change that in Settings → Permissions.";
export const DENY = {
  files: `I don't have permission to look at your files yet. ${SETTINGS}`,
  folder: `That isn't a place I've been given permission to use. ${SETTINGS}`,
  write: `I don't have permission to change files. ${SETTINGS}`,
  readonly: `I'm allowed to look at that, but not to change it. ${SETTINGS}`,
  system: "That's a Windows system folder, so I can look but I won't change anything there.",
  secret: "That file looks like it holds passwords or keys, so I won't open it.",
  programs: `I don't have permission to open programs yet. ${SETTINGS}`,
  browser: `I don't have permission to use the browser for you yet. ${SETTINGS}`,
  web: `Looking things up online is turned off. ${SETTINGS}`,
};

// ---- where things are -------------------------------------------------------------------------------------------------
function drives() { const d = []; for (const l of "CDEFGHIJKLMNOPQRSTUVWXYZ") { const r = `${l}:\\`; if (existsSync(r)) d.push(r); } return d; }
// Every person's folder under C:\Users (someone's files may live in a folder other than the signed-in profile).
export function userFolders() {
  const home = homedir(), usersDir = join(parse(home).root, "Users");
  let people = [];
  try { people = readdirSync(usersDir, { withFileTypes: true }).filter((e) => e.isDirectory() && !/^(public|default|default user|all users|defaultapppool)$/i.test(e.name)).map((e) => join(usersDir, e.name)); } catch { /* no Users folder */ }
  return [...new Map([home, ...people].map((r) => [r.toLowerCase(), r])).values()];
}
// Where searches start (and what "the folders I may look in" lists).
export function roots() {
  const p = load();
  if (p.files === "off") return [];
  const usable = p.entries.filter((e) => e.kind === "folder" && e.access !== "none").map((e) => e.path);
  if (p.files === "custom") return usable;
  const home = homedir();
  const out = [...userFolders(), ...usable, ...drives().filter((d) => d.toLowerCase() !== parse(home).root.toLowerCase())];
  return [...new Map(out.map((r) => [r.toLowerCase(), r])).values()];
}
// Specific files the owner allowed on their own (searches can include them).
export const fileEntries = () => load().entries.filter((e) => e.kind === "file" && e.access !== "none").map((e) => ({ ...e }));

const within = (full, root) => { const r = relative(root, full); return r === "" || (!r.startsWith("..") && !isAbsolute(r)); };
export function isSystemPath(full) {
  const f = resolve(full).toLowerCase(), win = (process.env.SystemRoot || "C:\\Windows").toLowerCase();
  const pf = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.ProgramData].filter(Boolean).map((x) => x.toLowerCase());
  return [win, ...pf].some((s) => f === s || f.startsWith(s + "\\"));
}
// The entry that decides a path: the most specific one that covers it (an exact file entry, else the deepest folder).
function entryFor(full, p = load()) {
  const f = full.toLowerCase();
  let best = null, depth = -1;
  for (const e of p.entries) {
    const ep = e.path.toLowerCase();
    if (e.kind === "file") { if (f === ep) return e; continue; }
    if (!within(full, e.path)) continue;
    if (!e.subfolders && f !== ep && dirname(full).toLowerCase() !== ep) continue;   // "this folder only"
    const d = ep.split(/[\\/]+/).length;
    if (d > depth) { best = e; depth = d; }
  }
  return best;
}
// What Dayspring may do with this path: "none" | "read" | "readwrite"
export function accessFor(target) {
  const p = load();
  if (p.files === "off") return "none";
  const full = resolve(String(target));
  const e = entryFor(full, p);
  if (e) return e.access;
  return p.files === "all" ? p.allAccess : "none";
}

// check(kind, target?) → { ok: true, ask? } or { ok: false, reason, text }
export function check(kind, target) {
  const p = load();
  if (kind === "web") return p.web ? { ok: true } : { ok: false, reason: "web", text: DENY.web };
  if (kind === "browser") return p.browser ? { ok: true } : { ok: false, reason: "browser", text: DENY.browser };
  if (kind === "programs") return p.programs === "off" ? { ok: false, reason: "programs", text: DENY.programs } : { ok: true, ask: p.programs === "ask" };
  if (kind === "read" || kind === "write") {
    if (p.files === "off") return { ok: false, reason: "files", text: DENY.files };
    if (target == null) {
      if (kind === "write" && !canWriteSomewhere(p)) return { ok: false, reason: "write", text: DENY.write };
      return kind === "write" ? { ok: true, ask: p.writeConfirm === "ask" } : { ok: true };
    }
    const full = resolve(String(target));
    const a = accessFor(full);
    if (a === "none") return { ok: false, reason: "folder", text: DENY.folder };
    if (kind === "read") return { ok: true };
    if (a !== "readwrite") return { ok: false, reason: "readonly", text: DENY.readonly };
    if (isSystemPath(full)) return { ok: false, reason: "system", text: DENY.system };
    return { ok: true, ask: p.writeConfirm === "ask" };
  }
  return { ok: false, reason: "unknown", text: "I'm not sure what that permission is." };
}

// ---- in plain words ---------------------------------------------------------------------------------------------------
const nice = (path) => {
  const home = homedir(); const rel = relative(home, path);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
  const users = join(parse(home).root, "Users"); const ru = relative(users, path);
  if (ru && !ru.startsWith("..") && !isAbsolute(ru)) return ru.split(/[\\/]/).slice(1).join("\\") || ru;
  return path;
};
const listWords = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
// "Dayspring can read everything in Documents and Desktop, and change files only in Documents\Notes."
export function summary(p = load()) {
  if (p.files === "off") return "Dayspring can't look at any of your files.";
  const read = p.entries.filter((e) => e.access === "read").map((e) => nice(e.path) + (e.kind === "file" ? "" : e.subfolders ? "" : " (not its subfolders)"));
  const rw = p.entries.filter((e) => e.access === "readwrite").map((e) => nice(e.path) + (e.kind === "file" ? "" : e.subfolders ? "" : " (not its subfolders)"));
  const none = p.entries.filter((e) => e.access === "none").map((e) => nice(e.path));
  const confirm = p.writeConfirm === "ask" ? " It asks you before changing anything" : " It changes files without asking";
  if (p.files === "all") {
    let s = p.allAccess === "readwrite" ? "Dayspring can read and change files anywhere on this computer" : "Dayspring can read files anywhere on this computer, but can't change them";
    if (p.allAccess === "readwrite" && read.length) s += `, except that ${listWords(read)} ${read.length > 1 ? "are" : "is"} look-only`;
    if (p.allAccess === "read" && rw.length) s += `, except that it can change files in ${listWords(rw)}`;
    if (none.length) s += `. It stays out of ${listWords(none)}`;
    s += ".";
    if (p.allAccess === "readwrite" || rw.length) s += `${confirm}, and keeps a backup.`;
    return s + " Windows system folders and files holding passwords or keys are always off-limits.";
  }
  if (!read.length && !rw.length) return "Dayspring can only look at files you choose, and you haven't chosen any yet.";
  const parts = [];
  if (read.length) parts.push(`read ${listWords(read)}`);
  if (rw.length) parts.push(`read and change ${listWords(rw)}`);
  let s = `Dayspring can ${parts.join(", and ")}${none.length ? `, but stays out of ${listWords(none)}` : ""}.`;
  if (rw.length) s += `${confirm}, and keeps a backup.`;
  return s + " Nothing else on the computer is open to it.";
}

// For the system prompt: what Dayspring can do right now, in plain words.
export function describe() {
  const p = load();
  const bits = [summary(p).replace(/^Dayspring /, "").replace(/[.\s]+$/, "")];
  bits.push(p.programs === "off" ? "cannot open programs" : p.programs === "ask" ? "can open programs after asking" : "can open programs");
  bits.push(p.browser ? "can drive its own browser window" : "cannot drive the browser");
  bits.push(p.web ? "can look things up on the web" : "cannot look things up on the web");
  return bits.join("; ");
}
export function _reset() { cache = null; }   // tests
export { FILE as _file };
