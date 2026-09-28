// What Dayspring may do on this computer. The owner decides (first-run setup, then Settings → Permissions); everything
// is off until granted, except looking things up on the web.
//   files: "off" | "custom" (only what's listed in entries) | "all" (everything on this computer)
//   allAccess: "read" | "readwrite"                       — for "all": look only, or look and change
//   entries: [{ path, kind: "folder"|"file", access: "none"|"read"|"readwrite", subfolders: true }]
//            — in "custom" these are what's allowed; in "all" they refine it (e.g. a "none" entry keeps a folder out,
//              a "read" entry makes one folder look-only). The most specific entry wins (a file beats its folder).
//   writeConfirm: "ask" (read the change back and wait for a yes; a backup is made) | "on" (a backup is still made)
//   can: { create, edit, move, delete } — what "read & write" places allow, one kind of change at a time. Delete is off
//        until the owner turns it on (it's never implied by read & write, and older files never get it); deleting always
//        goes to the Recycle Bin and always asks first.
//   programs: "off" | "ask" | "on" (opening programs, terminals and commands)   browser: drive Dayspring's own browser window
//   web: search and read web pages
//   important: [paths] the owner marked important (changing them always asks, with a warning)
//   bulkLimit: more files than this in one change (default 25) always asks first, with the count
//   choiceMade: the owner picked a file-access option themselves (the setup won't go on without it)
//   confirmPending: an older install whose setting was kept as it was, waiting for the owner to confirm it once
// Always, in every mode (filesafety.mjs): secrets are never opened, and Windows, Program Files, boot files, the registry,
// other people's profiles, Dayspring's own code and data, and these permissions and the activity log are never changed.
// Paths are checked where they really lead (links and junctions followed), and path tricks are refused.
// Older files ({ files: "folders", folders: [...], writeFiles }) are read and upgraded without widening anything.
// Stored in data/permissions.json (kept apart from owner.json so the two never overwrite each other).
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, relative, isAbsolute, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import * as owner from "./owner.mjs";
import { writeJSONAtomic } from "./atomic.mjs";
import * as safety from "./filesafety.mjs";
import * as activity from "./activity.mjs";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const FILE = process.env.DAYSPRING_PERMISSIONS_FILE || join(DATA, "permissions.json");
export const DEFAULTS = { files: "off", allAccess: "read", entries: [], writeConfirm: "ask", can: { create: true, edit: true, move: true, delete: false },
  programs: "off", browser: false, web: true, important: [], bulkLimit: 25, choiceMade: false, confirmPending: false,
  money: false,   // money: "Money review (read-only)", lib/money (turned on on its own page, after an explanation)
  devices: "off" };   // devices: smart plugs, strips, lights and printers (lib/devices, lib/printers): off | ask | on; each device can override it
const CAN = ["create", "edit", "move", "delete"];
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
  out.money = r.money === true;
  out.devices = ["off", "ask", "on"].includes(r.devices) ? r.devices : DEFAULTS.devices;
  // one kind of change at a time; delete only when it was turned on in so many words
  const c = r.can && typeof r.can === "object" ? r.can : {};
  out.can = Object.fromEntries(CAN.map((k) => [k, typeof c[k] === "boolean" ? c[k] : DEFAULTS.can[k]]));
  out.important = [...new Map((Array.isArray(r.important) ? r.important : []).map((x) => String(x ?? "").trim()).filter(Boolean).map((x) => [cleanPath(x).toLowerCase(), cleanPath(x)])).values()].slice(0, 200);
  const bl = Math.round(Number(r.bulkLimit));
  out.bulkLimit = Number.isFinite(bl) ? Math.max(2, Math.min(1000, bl)) : DEFAULTS.bulkLimit;
  out.choiceMade = Boolean(r.choiceMade);
  out.confirmPending = Boolean(r.confirmPending) && !out.choiceMade;
  if (r.choiceAt) out.choiceAt = String(r.choiceAt).slice(0, 40);
  return out;
}

let cache = null;
function load() {
  if (cache) return cache;
  if (existsSync(FILE)) {
    try {
      const raw = JSON.parse(readFileSync(FILE, "utf8"));
      cache = normalize(raw);
      // from before file access had to be chosen: kept exactly as it was (delete stays off), and when it lets Dayspring
      // at any files, the owner is asked once to confirm it
      const older = raw.choiceMade === undefined;
      if (older) { cache.confirmPending = cache.files !== "off"; cache.choiceMade = false; }
      if (older || raw.files === "folders" || !Array.isArray(raw.entries) || raw.writeConfirm === undefined || raw.allAccess === undefined || raw.can === undefined) {
        save();   // upgraded once
        if (older) activity.log("permissions.upgraded", { note: "Permissions were upgraded to the new model without widening anything. Deleting stays off.", summary: summary(cache), askToConfirm: cache.confirmPending });
      }
      return cache;
    } catch { /* rebuilt below */ }
  }
  // One-time migration: an install that already had a file root keeps what it could do before.
  const o = owner.get();
  cache = o.fileRoot
    ? normalize({ files: "custom", entries: [{ path: o.fileRoot, kind: "folder", access: "readwrite" }], writeConfirm: "ask", programs: "ask", browser: true, web: true, confirmPending: true })
    : normalize({});
  save();
  return cache;
}
// the older fields ride along (derived), so an older Dayspring reading this file still understands it
function save() {
  mkdirSync(dirname(FILE), { recursive: true });
  const legacy = { folders: cache.entries.filter((e) => e.kind === "folder" && e.access !== "none").map((e) => e.path), writeFiles: canWriteSomewhere(cache) ? cache.writeConfirm : "off" };
  writeJSONAtomic(FILE, { ...cache, ...legacy, files: cache.files }, 2);
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
  for (const k of ["files", "allAccess", "writeConfirm", "programs", "browser", "web", "entries", "important", "bulkLimit", "money", "devices"]) if (has(k)) next[k] = patch[k];
  if (patch.can && typeof patch.can === "object") next.can = { ...cur.can, ...Object.fromEntries(CAN.filter((k) => typeof patch.can[k] === "boolean").map((k) => [k, patch.can[k]])) };
  if (Array.isArray(patch.addEntries)) next.entries = [...(next.entries ?? []), ...patch.addEntries];
  if (Array.isArray(patch.removePaths)) { const gone = new Set(patch.removePaths.map((x) => cleanPath(x).toLowerCase())); next.entries = next.entries.filter((e) => !gone.has(cleanPath(e.path).toLowerCase())); }
  // the owner picked an option themselves (setup, Settings, or "keep this" on the one-time question)
  if (patch.choice === true || patch.confirmCurrent === true) { next.choiceMade = true; next.confirmPending = false; next.choiceAt = new Date().toISOString(); }
  const before = summary(cur), beforeRaw = JSON.stringify(cur);
  cache = normalize(next);
  save();
  if (JSON.stringify(cache) !== beforeRaw) activity.log("permissions", { via: patch.via ?? "settings", before, after: summary(cache), files: cache.files, allAccess: cache.allAccess, can: cache.can, writeConfirm: cache.writeConfirm, programs: cache.programs, browser: cache.browser, web: cache.web, devices: cache.devices, entries: cache.entries.map((e) => `${e.access} ${e.path}${e.kind === "folder" && !e.subfolders ? " (this folder only)" : ""}`), important: cache.important, confirmed: patch.choice === true || patch.confirmCurrent === true || undefined });
  return get();
}

const SETTINGS = "You can change that in Settings → Permissions.";
export const DENY = {
  files: `I don't have permission to look at your files yet. ${SETTINGS}`,
  folder: `That isn't a place I've been given permission to use. ${SETTINGS}`,
  write: `I don't have permission to change files. ${SETTINGS}`,
  readonly: `I'm allowed to look at that, but not to change it. ${SETTINGS}`,
  create: `I'm not allowed to create new files or folders. ${SETTINGS}`,
  edit: `I'm not allowed to change existing files. ${SETTINGS}`,
  move: `I'm not allowed to move or rename things. ${SETTINGS}`,
  delete: `I'm not allowed to delete files. You can turn on "Can delete files" in Settings → Permissions (deleted things go to the Recycle Bin).`,
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

// The places the fail-safes guard, and the owner's own places (filesafety.hardBlock uses these).
function guarded() {
  const places = [safety.PROJECT, safety.DESK, dirname(FILE), FILE, activity.DIR()];
  for (const v of [process.env.DAYSPRING_BACKUP_DIR, process.env.DAYSPRING_ABILITY_BACKUPS]) if (v) places.push(v);
  try { const o = owner.get(); if (o.backupDir) places.push(o.backupDir); } catch { /* none */ }
  let notes = null;
  try { notes = resolve(process.env.DAYSPRING_NOTES_DIR || owner.get().notesDir || join(DATA, "notes")); } catch { /* none */ }
  return { protect: places.map((x) => resolve(x)), allow: notes ? [notes] : [] };
}
function ownPlaces(p = load()) {
  const out = [safety.DESK];
  try { const fr = owner.get().fileRoot; if (fr) out.push(fr); } catch { /* none */ }
  for (const e of p.entries) if (e.access !== "none") out.push(e.path);
  return out;
}
export const safetyOptions = (p = load()) => ({ ...guarded(), ownPlaces: ownPlaces(p) });
// What the owner normally uses (for "outside your usual folders"): their known folders and the places they chose.
export const usualFolders = (p = load()) => safety.usualFolders([...p.entries.filter((e) => e.access !== "none").map((e) => e.path), ...guarded().allow]);
const CHANGE = ["write", "create", "edit", "move", "delete"];
const lower = (a, b) => (a === "none" || b === "none" ? "none" : a === "read" || b === "read" ? "read" : "readwrite");

// check(kind, target?, opts?) → { ok: true, ask?, full, real } or { ok: false, reason, text }
//   kind: "read" | "write" (create or edit, whichever it is) | "create" | "edit" | "move" | "delete" | "programs" | "browser" | "web"
//   opts.kind: "file" | "folder" for something that doesn't exist yet
export function check(kind, target, opts = {}) {
  const p = load();
  if (kind === "web") return p.web ? { ok: true } : { ok: false, reason: "web", text: DENY.web };
  if (kind === "browser") return p.browser ? { ok: true } : { ok: false, reason: "browser", text: DENY.browser };
  if (kind === "devices") return p.devices === "off" ? { ok: false, reason: "devices", text: "Controlling devices is turned off. You can turn it on in Settings → Devices." } : { ok: true, ask: p.devices === "ask" };
  if (kind === "money") return p.money ? { ok: true } : { ok: false, reason: "money", text: "Money review is turned off. You can turn it on on the Money page (say \"open my bank\" or \"import my bank statement\")." };
  if (kind === "programs") return p.programs === "off" ? { ok: false, reason: "programs", text: DENY.programs } : { ok: true, ask: p.programs === "ask" };
  if (kind === "read" || CHANGE.includes(kind)) {
    if (p.files === "off") return { ok: false, reason: "files", text: DENY.files };
    if (target == null) {
      if (kind !== "read" && !canWriteSomewhere(p)) return { ok: false, reason: "write", text: DENY.write };
      if (kind === "delete" && !p.can.delete) return { ok: false, reason: "delete", text: DENY.delete };
      return kind !== "read" ? { ok: true, ask: p.writeConfirm === "ask" } : { ok: true };
    }
    const trick = safety.pathTrick(target);
    if (trick) return { ok: false, reason: "trick", text: `I won't use that path. ${trick}` };
    const full = resolve(String(target));
    const real = safety.realPath(full);
    if (safety.isNetworkPath(real) && !safety.isNetworkPath(full)) return { ok: false, reason: "trick", text: "That leads to another computer on the network, so I won't use it." };
    // the stricter of where it looks like it is and where it really is (a link can't lead somewhere less protected)
    const a = lower(accessFor(full), real.toLowerCase() === full.toLowerCase() ? "readwrite" : accessFor(real));
    if (a === "none") return { ok: false, reason: "folder", text: DENY.folder, full, real };
    if (safety.isSecretPath(full) || safety.isSecretPath(real)) return { ok: false, reason: "secret", text: DENY.secret, full, real };
    if (kind === "read") return { ok: true, full, real };
    if (a !== "readwrite") return { ok: false, reason: "readonly", text: DENY.readonly, full, real };
    const so = { ...safetyOptions(p), kind: opts.kind };
    const hb = safety.hardBlock(full, so) ?? (real.toLowerCase() !== full.toLowerCase() ? safety.hardBlock(real, so) : null);
    if (hb) return { ok: false, reason: "protected", why: hb.reason, text: hb.text, full, real };
    const k = kind === "write" ? (existsSync(real) ? "edit" : "create") : kind;
    if (!p.can[k]) return { ok: false, reason: k, text: DENY[k], full, real };
    return { ok: true, ask: p.writeConfirm === "ask", full, real, op: k };
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
    if (p.allAccess === "readwrite" || rw.length) s += `${confirm}, and keeps a backup.${delWords(p)}`;
    return s + " Windows, program folders, other people's files and files holding passwords or keys are always off-limits.";
  }
  if (!read.length && !rw.length) return "Dayspring can only look at files you choose, and you haven't chosen any yet.";
  const parts = [];
  if (read.length) parts.push(`read ${listWords(read)}`);
  if (rw.length) parts.push(`read and change ${listWords(rw)}`);
  let s = `Dayspring can ${parts.join(", and ")}${none.length ? `, but stays out of ${listWords(none)}` : ""}.`;
  if (rw.length) s += `${confirm}, and keeps a backup.${delWords(p)}`;
  return s + " Nothing else on the computer is open to it.";
}
const delWords = (p) => (p.can?.delete ? " It can delete files (to the Recycle Bin, always asking first)." : " It can't delete files.");

// What Dayspring will and won't be able to do with a setting (saved or not yet): short plain lines for the setup screen.
export function explain(draft) {
  const p = draft ? normalize(draft) : load();
  const will = [], wont = [];
  const rw = p.files !== "off" && ((p.files === "all" && p.allAccess === "readwrite") || p.entries.some((e) => e.access === "readwrite"));
  const places = (acc) => p.entries.filter((e) => e.access === acc).map((e) => nice(e.path) + (e.kind === "folder" && !e.subfolders ? " (not its subfolders)" : ""));
  if (p.files === "off") wont.push("Look at, open or search any of your files.");
  else if (p.files === "all") will.push(p.allAccess === "readwrite" ? "Read and change files anywhere on this computer." : "Read files anywhere on this computer (but not change them).");
  else if (!p.entries.some((e) => e.access !== "none")) wont.push("Look at any files yet. Add a folder or file to allow it.");
  if (p.files !== "off") {
    const r = places("read"), w = places("readwrite"), n = places("none");
    if (p.files === "custom" && r.length) will.push(`Read ${listWords(r)}.`);
    if (w.length) will.push(`${p.files === "all" && p.allAccess === "read" ? "Also change" : "Read and change"} ${listWords(w)}.`);
    if (p.files === "all" && p.allAccess === "readwrite" && r.length) will.push(`Only read (not change) ${listWords(r)}.`);
    if (n.length) wont.push(`Go into ${listWords(n)}.`);
    if (p.files === "custom") wont.push("Look anywhere you didn't choose.");
  }
  if (rw) {
    const kinds = [p.can.create && "create files and folders", p.can.edit && "edit files", p.can.move && "rename and move things"].filter(Boolean);
    if (kinds.length) will.push(`${kinds[0][0].toUpperCase() + listWords(kinds).slice(1)}${p.writeConfirm === "ask" ? ", asking you first every time" : ""}, with a backup of anything it changes.`);
    will.push(p.can.delete ? "Delete files, only to the Recycle Bin, and only after you say yes." : "");
    if (!p.can.delete) wont.push("Delete anything.");
    will.push("Warn you and ask \"Are you sure?\" before changing important files (start-up files, settings, project and database files, anything you marked).");
  } else if (p.files !== "off") wont.push("Change, rename or delete anything.");
  wont.push("Touch Windows, Program Files, boot files, the registry or other people's profiles.");
  wont.push("Open files that hold passwords or keys.");
  wont.push("Change its own code, its permissions or its activity log.");
  will.push("Keep a log of everything it does, for at least 120 days.");
  return { will: will.filter(Boolean), wont, summary: summary(p) };
}

// For the system prompt: what Dayspring can do right now, in plain words.
export function describe() {
  const p = load();
  const bits = [summary(p).replace(/^Dayspring /, "").replace(/[.\s]+$/, "")];
  if (p.files !== "off" && canWriteSomewhere(p)) bits.push(`${p.can.delete ? "may delete (Recycle Bin, always asking)" : "may NOT delete files"}; ${["create", "edit", "move"].filter((k) => !p.can[k]).map((k) => `may not ${k === "move" ? "move or rename" : k}`).join("; ") || "may create, edit, move and rename"}`);
  bits.push(p.programs === "off" ? "cannot open programs" : p.programs === "ask" ? "can open programs after asking" : "can open programs");
  bits.push(p.browser ? "can drive its own browser window" : "cannot drive the browser");
  bits.push(p.web ? "can look things up on the web" : "cannot look things up on the web");
  bits.push(p.devices === "off" ? "cannot switch smart devices or printers" : p.devices === "ask" ? "can switch smart devices and printers after asking" : "can switch smart devices and printers (the safety rules still ask for risky ones)");
  bits.push(p.money ? "can READ (never change) bank, Venmo and Cash App pages in its money window (money_ tools)" : "money review of bank sites is off (statement imports still work)");
  return bits.join("; ");
}
export function _reset() { cache = null; }   // tests
export { FILE as _file };
