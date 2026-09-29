// A light index of the owner's file NAMES (never their contents), so "find my resume" or "the picture named IMG_5782"
// answers at once instead of walking the disk every time.
//   Where: only where file access (lib/permissions.mjs) allows reading, right now. "Only the places I pick": those folders
//          (and single files the owner added). "Everything": the owner's own folders (Desktop, Documents, Downloads,
//          Pictures, Music, Videos, OneDrive) plus any folder they added, not whole drives. Folders added only for the finder
//          (addFolder) still need file access.
//   Never: secrets (lib/filesafety.mjs: passwords, keys, wallets), names or folders that look private (the media
//          library's filter: taxes, bank, medical…), hidden and system folders, program and build folders, Office lock
//          files, and anything file access keeps out ("none" places inside allowed ones).
//   How:   in the background, a little at a time (a pause every few hundred entries), and only what changed: a folder
//          whose modified time is the same still has the same names, so it isn't listed again. Rescanned every 6 hours.
//   Kept:  data/file-index.json (paths, sizes, dates: no contents). DAYSPRING_FILEINDEX_FILE moves it (tests).
// Every item has an id (the same as the media library's for the same path): the viewer asks for files by id only.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as permissions from "../permissions.mjs";
import * as safety from "../filesafety.mjs";
import { writeJSONAtomic } from "../atomic.mjs";
import { kindOf, extOf } from "./kinds.mjs";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const FILE = () => process.env.DAYSPRING_FILEINDEX_FILE || join(DATA, "file-index.json");
const PAUSE_EVERY = () => Math.max(20, Number(process.env.DAYSPRING_FINDER_BATCH ?? 250));
const DELAY = () => Math.max(0, Number(process.env.DAYSPRING_FINDER_DELAY_MS ?? 4));     // after each batch
const MAX_ITEMS = 80_000, MAX_VISIT = 400_000, MAX_DEPTH = 14, STALE_MS = 6 * 3600_000;
// the same idea (and words) as the media library and the photos on the screen: never indexed, never shown
export const PRIVATE = /\b(private|personal|secret|confidential|hidden|nsfw|xxx|adult|porn|taxes?|irs|w-?2|1099|bank(ing)?|statements?|medical|health records?|insurance|passports?|ssn|social security|passwords?|diary|journal|therapy|legal)\b/i;
const SKIP_DIR = /^(\.|\$|~|node_modules$|appdata$|application data$|local settings$|windows$|program files|programdata$|system volume information$|temp$|tmp$|cache$|__pycache__$|\.venv$|venv$|site-packages$|dist$|build$|out$|target$|coverage$|\.next$|dayspring$|backups?$)/i;
const SKIP_FILE = /^(~\$|\.|desktop\.ini$|thumbs\.db$|ntuser|\$)/i;
export const idOf = (p) => createHash("sha1").update(resolve(p).toLowerCase()).digest("hex").slice(0, 16);
const sleep = (ms) => new Promise((r) => (ms ? setTimeout(r, ms) : setImmediate(r)));

// ---- on disk -------------------------------------------------------------------------------------------------------------
let db = null, byIdMap = null;
function load() {
  if (db && db.file === FILE()) return db;
  let raw = {};
  try { raw = existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), "utf8")) : {}; } catch { raw = {}; }
  // items are kept as short rows: [path, size, mtime]; the rest is worked out from the path
  const items = (Array.isArray(raw.items) ? raw.items : []).map(expand).filter(Boolean);
  db = { file: FILE(), at: raw.at ?? 0, roots: raw.roots ?? [], folders: Array.isArray(raw.folders) ? raw.folders : [], dirs: raw.dirs && typeof raw.dirs === "object" ? raw.dirs : {}, items, skipped: raw.skipped ?? 0 };
  byIdMap = null;
  return db;
}
function expand(r) {
  if (!Array.isArray(r) || typeof r[0] !== "string") return null;
  const [path, size, mtime, root] = r;
  const name = basename(path);
  return { id: idOf(path), path, name, ext: extOf(name), kind: kindOf(name), size: Number(size) || 0, mtime: Number(mtime) || 0, root: root ?? null };
}
function save() { const d = load(); writeJSONAtomic(d.file, { v: 1, at: d.at, roots: d.roots, folders: d.folders, skipped: d.skipped, dirs: d.dirs, items: d.items.map((x) => [x.path, x.size, x.mtime, x.root]) }, 0); }
export function _reset() { db = null; byIdMap = null; scanning = null; }
export const items = () => load().items;
export const scannedAt = () => load().at;
export function byId(id) {
  const d = load();
  if (!byIdMap) byIdMap = new Map(d.items.map((x) => [x.id, x]));
  return byIdMap.get(String(id ?? "")) ?? null;
}

// ---- where to look -------------------------------------------------------------------------------------------------------
export const HOW_TO_ALLOW = "To let me look in more places, open Settings → Permissions and add a folder with “Can look” (or choose “Everything on this computer”).";
export const home = () => process.env.DAYSPRING_FINDER_HOME || homedir();
function ownFolders() {
  const h = home();
  const out = ["Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos"].map((x) => join(h, x));
  try { for (const n of readdirSync(h)) if (/^onedrive/i.test(n)) out.push(join(h, n)); } catch { /* none */ }
  return out;
}
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
// { roots, files, off, how, refused }
export function roots() {
  const p = permissions.get();
  if (p.files === "off") return { roots: [], files: [], off: true, how: "I can't look at your files yet. " + HOW_TO_ALLOW };
  const chosen = p.entries.filter((e) => e.kind === "folder" && e.access !== "none").map((e) => e.path);
  const cands = [...new Map([...(p.files === "all" ? ownFolders() : []), ...chosen, ...load().folders].map((r) => [resolve(r).toLowerCase(), resolve(r)])).values()].filter(isDir);
  const ok = [], refused = [];
  for (const r of cands) (permissions.check("read", r).ok ? ok : refused).push(r);
  const out = ok.filter((r) => !ok.some((o) => o !== r && safety.under(r, o)));
  const files = permissions.fileEntries().map((e) => e.path).filter((f) => { try { return statSync(f).isFile() && permissions.check("read", f).ok; } catch { return false; } });
  return { roots: out, files, refused, ...(out.length || files.length ? {} : { how: HOW_TO_ALLOW }) };
}
export function addFolder(path) {
  const full = resolve(String(path ?? ""));
  const k = permissions.check("read", full);
  if (!k.ok) return { denied: true, text: k.text };
  const d = load();
  if (!d.folders.some((f) => f.toLowerCase() === full.toLowerCase())) { d.folders.push(full); save(); }
  scanSoon(true);
  return { added: full, folders: d.folders };
}
export function removeFolder(path) { const d = load(), full = resolve(String(path ?? "")).toLowerCase(); d.folders = d.folders.filter((f) => f.toLowerCase() !== full); save(); scanSoon(true); return { folders: d.folders }; }

// is this path one the finder may hand out right now? (the index is never a way around a permission taken back)
export function allowedNow(path, r = roots()) {
  const full = resolve(String(path));
  const k = permissions.check("read", full);
  if (!k.ok) return k;
  const real = k.real ?? full;
  const inRoot = r.roots.some((x) => safety.under(full, x) && safety.under(real, x)) || r.files.some((f) => f.toLowerCase() === full.toLowerCase() && f.toLowerCase() === real.toLowerCase());
  if (!inRoot) return { ok: false, reason: "outside", text: "That file isn't in a folder I'm allowed to look in. " + HOW_TO_ALLOW };
  if (safety.isSecretPath(full) || safety.isSecretPath(real)) return { ok: false, reason: "secret", text: permissions.DENY.secret };
  const tail = full.split(/[\\/]/).slice(-6).join("\\");
  if (PRIVATE.test(tail)) return { ok: false, reason: "private", text: "That file looks private, so I keep it off the screen." };
  return { ok: true, full, real };
}

// ---- scanning ------------------------------------------------------------------------------------------------------------
let scanning = null;
export const isScanning = () => Boolean(scanning);
export function scanSoon(force = false) {
  const d = load();
  if (!scanning && (force || !d.at || Date.now() - d.at > STALE_MS)) scanning = scan().catch((e) => { console.log(`file finder: ${e.message}`); }).finally(() => { scanning = null; });
  return scanning;
}
export async function scanNow() { if (scanning) await scanning.catch(() => {}); scanning = scan().finally(() => { scanning = null; }); return scanning; }
async function scan() {
  const d = load();
  const r = roots();
  const prevByDir = new Map();
  for (const x of d.items) { const k = dirname(x.path).toLowerCase(); if (!prevByDir.has(k)) prevByDir.set(k, []); prevByDir.get(k).push(x); }
  const out = [], seen = new Set(), dirs = {};
  let visited = 0, listed = 0, reused = 0, skipped = 0;
  const pause = async () => { if (++visited % PAUSE_EVERY() === 0) await sleep(DELAY()); };
  const keep = (x) => { const k = x.path.toLowerCase(); if (seen.has(k) || out.length >= MAX_ITEMS) return; seen.add(k); out.push(x); };
  for (const root of r.roots) {
    const rootName = basename(root) || root;
    const stack = [[root, 0]];
    while (stack.length && out.length < MAX_ITEMS && visited < MAX_VISIT) {
      const [dir, depth] = stack.pop();
      if (depth > MAX_DEPTH) continue;
      if (permissions.accessFor(dir) === "none") { skipped++; continue; }
      let dst; try { dst = await stat(dir); } catch { continue; }
      const key = dir.toLowerCase(), was = d.dirs[key];
      // the same folder as last time (nothing added, removed or renamed in it): its files are the same names
      const same = was && was.m === Math.round(dst.mtimeMs) && Array.isArray(was.sub);
      let files = [], subs = [];
      if (same) {
        reused++;
        files = (prevByDir.get(key) ?? []).map((x) => ({ ...x, root: rootName }));
        subs = was.sub.map((s) => join(dir, s));
      } else {
        let ents; try { ents = await readdir(dir, { withFileTypes: true }); } catch { continue; }
        listed++;
        for (const e of ents) {
          await pause();
          const p = join(dir, e.name);
          if (e.isDirectory()) { if (SKIP_DIR.test(e.name) || PRIVATE.test(e.name) || safety.SECRET_DIR.test(p + "\\")) { skipped++; continue; } subs.push(p); continue; }
          if (!e.isFile() || SKIP_FILE.test(e.name)) continue;
          if (PRIVATE.test(e.name) || safety.isSecretPath(p)) { skipped++; continue; }
          let st; try { st = await stat(p); } catch { continue; }
          files.push({ id: idOf(p), path: p, name: e.name, ext: extOf(e.name), kind: kindOf(e.name), size: st.size, mtime: Math.round(st.mtimeMs), root: rootName });
        }
      }
      dirs[key] = { m: Math.round(dst.mtimeMs), sub: subs.map((s) => basename(s)) };
      for (const f of files) { if (permissions.accessFor(f.path) === "none") { skipped++; continue; } keep(f); }
      for (let i = subs.length - 1; i >= 0; i--) stack.push([subs[i], depth + 1]);
      await pause();
    }
  }
  for (const f of r.files) { try { const st = statSync(f); keep({ id: idOf(f), path: f, name: basename(f), ext: extOf(f), kind: kindOf(f), size: st.size, mtime: Math.round(st.mtimeMs), root: basename(dirname(f)) }); } catch { /* gone */ } }
  d.items = out; d.roots = r.roots; d.at = Date.now(); d.skipped = skipped; d.dirs = dirs; byIdMap = null;
  save();
  return { items: out.length, listed, reused, skipped, roots: r.roots };
}
// a file changed under us (deleted, copied): the next scan lists that folder again
export function forgetDir(path) { const d = load(); delete d.dirs[dirname(resolve(path)).toLowerCase()]; }
export function removeItem(id) { const d = load(); d.items = d.items.filter((x) => x.id !== id); byIdMap = null; }
export function addItem(path) {
  const d = load(); const full = resolve(path);
  let st; try { st = statSync(full); } catch { return null; }
  if (d.items.some((x) => x.path.toLowerCase() === full.toLowerCase())) return byId(idOf(full));
  const x = { id: idOf(full), path: full, name: basename(full), ext: extOf(full), kind: kindOf(full), size: st.size, mtime: Math.round(st.mtimeMs), root: null };
  d.items.push(x); byIdMap = null; forgetDir(full);
  return x;
}
export function status() {
  const d = load(), r = roots();
  const byKind = {}; for (const x of d.items) byKind[x.kind] = (byKind[x.kind] ?? 0) + 1;
  return { off: Boolean(r.off), how: r.how ?? null, roots: r.roots, files: r.files, refused: r.refused ?? [], folders: d.folders, items: d.items.length, byKind, scannedAt: d.at || null, scanning: isScanning(), skipped: d.skipped };
}
// "Documents", "Pictures\Lake 2023": where a file is, in words
export function whereOf(path) {
  const full = resolve(path), h = home();
  const rel = relative(h, dirname(full));
  if (rel && !rel.startsWith("..") && !/^[a-z]:/i.test(rel)) return rel;
  if (!rel) return basename(h);
  const r = roots().roots.find((x) => safety.under(full, x));
  if (r) { const rr = relative(r, dirname(full)); return rr ? `${basename(r)}\\${rr}` : basename(r) || r; }
  return dirname(full);
}
