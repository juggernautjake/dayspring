// The owner's own music and videos: an index of the audio and video files in the folders Dayspring may read.
//   Where: Music, Videos and Downloads (and OneDrive's Music and Videos), the folders the owner chose for file access
//          ("custom"), and any extra media folders added here, but ONLY where file access allows reading
//          (lib/permissions.mjs). With file access off nothing is indexed, and status() says how to allow a folder.
//   What:  mp3 m4a aac flac wav ogg opus wma · mp4 m4v mkv webm mov avi wmv, with their tags (tags.mjs).
//   Never: folders or files whose names look private (private, personal, taxes, bank, medical…), hidden and system
//          folders, anything file access keeps out ("none" entries), and secrets (lib/filesafety.mjs).
//   How:   in the background, slowly (a pause between files, at most ~30 new files a second by default), and only what
//          changed since last time (same size and modified time = the tags already read are kept). Rescanned every 6 hours.
//   Kept:  data/media-library.json (paths, tags, sizes: no file contents). DAYSPRING_MEDIALIB_FILE moves it (tests).
// search() finds by title, artist, album, genre, file name and folder, forgiving small misspellings.
import { existsSync, readFileSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as permissions from "../permissions.mjs";
import * as safety from "../filesafety.mjs";
import { writeJSONAtomic } from "../atomic.mjs";
import { readTags, kindOf, extOf } from "./tags.mjs";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const FILE = () => process.env.DAYSPRING_MEDIALIB_FILE || join(DATA, "media-library.json");
const DELAY = () => Math.max(0, Number(process.env.DAYSPRING_MEDIALIB_DELAY_MS ?? 30));          // between tag reads
const MAX_ITEMS = 50_000, MAX_VISIT = 400_000, MAX_DEPTH = 14, STALE_MS = 6 * 3600_000;
// folder and file names that look private: never indexed (the same idea as lib/photos.mjs, tuned for media)
export const PRIVATE = /\b(private|personal|secret|confidential|hidden|nsfw|xxx|adult|porn|taxes?|irs|w-?2|1099|bank(ing)?|statements?|medical|health records?|insurance|passports?|ssn|social security|passwords?|diary|journal|therapy|legal)\b/i;
const SKIP_DIR = /^(\.|\$|node_modules$|appdata$|application data$|local settings$|windows$|program files|programdata$|system volume information$|\$recycle\.bin$|temp$|tmp$|cache$|\.cache$|dayspring$)/i;
export const idOf = (p) => createHash("sha1").update(resolve(p).toLowerCase()).digest("hex").slice(0, 16);
const sleep = (ms) => new Promise((r) => (ms ? setTimeout(r, ms) : setImmediate(r)));

// ---- the index on disk -------------------------------------------------------------------------------------------------
let db = null, byIdMap = null;
function load() {
  if (db && db.file === FILE()) return db;
  let raw = {};
  try { raw = existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), "utf8")) : {}; } catch { raw = {}; }
  db = { file: FILE(), v: 1, at: raw.at ?? 0, roots: raw.roots ?? [], folders: Array.isArray(raw.folders) ? raw.folders : [], items: Array.isArray(raw.items) ? raw.items : [], skipped: raw.skipped ?? 0 };
  byIdMap = null;
  return db;
}
function save() { const d = load(); writeJSONAtomic(d.file, { v: 1, at: d.at, roots: d.roots, folders: d.folders, skipped: d.skipped, items: d.items }, 0); }
export function _reset() { db = null; byIdMap = null; scanning = null; rootsCache = { at: 0, list: [] }; }   // tests
export const items = () => load().items;
export function byId(id) {
  const d = load();
  if (!byIdMap) byIdMap = new Map(d.items.map((x) => [x.id, x]));
  return byIdMap.get(String(id ?? "")) ?? null;
}

// ---- where to look -------------------------------------------------------------------------------------------------------
const HOW_TO_ALLOW = "To let me find your music and videos, open Settings → Permissions, choose “Only the places I pick”, and add your Music, Videos or Downloads folder with “Can look”. Nothing else on the computer is opened.";
function defaults() {
  const home = process.env.DAYSPRING_MEDIALIB_HOME || homedir();
  return ["Music", "Videos", "Downloads", join("OneDrive", "Music"), join("OneDrive", "Videos")].map((x) => join(home, x));
}
// { roots: [allowed folders], off: true|undefined, how, refused: [folders it may not read] }
export function roots() {
  const p = permissions.get();
  if (p.files === "off") return { roots: [], off: true, how: HOW_TO_ALLOW };
  const custom = p.files === "custom" ? p.entries.filter((e) => e.kind === "folder" && e.access !== "none").map((e) => e.path) : [];
  const cands = [...new Map([...defaults(), ...load().folders, ...custom].map((r) => [resolve(r).toLowerCase(), resolve(r)])).values()].filter((r) => { try { return statSync(r).isDirectory(); } catch { return false; } });
  const ok = [], refused = [];
  for (const r of cands) (permissions.check("read", r).ok ? ok : refused).push(r);
  // a folder inside another one is already covered
  const out = ok.filter((r) => !ok.some((o) => o !== r && safety.under(r, o)));
  return { roots: out, refused, ...(out.length ? {} : { how: HOW_TO_ALLOW }) };
}
// extra media folders the owner adds ("also look in D:\Media"): still only read where file access allows
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

// ---- scanning -----------------------------------------------------------------------------------------------------------
let scanning = null;
export const isScanning = () => Boolean(scanning);
export function scanSoon(force = false) {
  const d = load();
  if (!scanning && (force || !d.at || Date.now() - d.at > STALE_MS)) scanning = scan().catch((e) => { console.log(`media library: ${e.message}`); }).finally(() => { scanning = null; });
  return scanning;
}
export async function scanNow() { if (scanning) await scanning; scanning = scan().finally(() => { scanning = null; }); return scanning; }
async function scan() {
  const d = load();
  const r = roots();
  const prev = new Map(d.items.map((x) => [x.path.toLowerCase(), x]));
  const out = [], seen = new Set();
  let visited = 0, parsed = 0, skipped = 0;
  for (const root of r.roots) {
    const rootName = basename(root);
    const stack = [[root, 0]];
    while (stack.length) {
      const [dir, depth] = stack.pop();
      if (depth > MAX_DEPTH || out.length >= MAX_ITEMS || visited > MAX_VISIT) break;
      if (permissions.accessFor(dir) === "none") { skipped++; continue; }   // a folder file access keeps out
      let ents; try { ents = await readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        if (++visited % 250 === 0) await sleep(0);                          // let everything else run
        const p = join(dir, e.name);
        if (e.isDirectory()) { if (SKIP_DIR.test(e.name) || PRIVATE.test(e.name)) { skipped++; continue; } stack.push([p, depth + 1]); continue; }
        if (!e.isFile()) continue;
        const kind = kindOf(e.name);
        if (!kind) continue;
        if (PRIVATE.test(e.name) || safety.isSecretPath(p) || permissions.accessFor(p) === "none") { skipped++; continue; }
        const key = p.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        let st; try { st = await stat(p); } catch { continue; }
        if (st.size < 1024) continue;                                        // empty or broken
        const old = prev.get(key);
        if (old && old.size === st.size && old.mtime === Math.round(st.mtimeMs)) { out.push(old); continue; }
        const t = await readTags(p);
        parsed++;
        const rel = relative(root, dirname(p));
        out.push({ id: idOf(p), path: p, name: e.name, kind, ext: extOf(e.name), size: st.size, mtime: Math.round(st.mtimeMs), root: rootName, folder: rel ? `${rootName}\\${rel}` : rootName,
          title: t.title, artist: t.artist, album: t.album, genre: t.genre, year: t.year, track: t.track, duration: t.duration, width: t.width, height: t.height, tagged: t.tagged || undefined, codec: t.codec ?? undefined });
        await sleep(DELAY());
        if (out.length >= MAX_ITEMS) break;
      }
    }
  }
  d.items = out; d.roots = r.roots; d.at = Date.now(); d.skipped = skipped; byIdMap = null;
  save();
  return { items: out.length, parsed, skipped, roots: r.roots };
}
export function status() {
  const d = load(), r = roots();
  const audio = d.items.filter((x) => x.kind === "audio").length;
  return { off: Boolean(r.off), how: r.how ?? null, roots: r.roots, refused: r.refused ?? [], folders: d.folders, items: d.items.length, audio, video: d.items.length - audio, scannedAt: d.at || null, scanning: isScanning(), skipped: d.skipped };
}

// ---- finding ---------------------------------------------------------------------------------------------------------------
let rootsCache = { at: 0, list: [] };
function allowedRoots() {
  if (Date.now() - rootsCache.at > 5000) rootsCache = { at: Date.now(), list: roots().roots };
  return rootsCache.list;
}
export function _forgetRoots() { rootsCache = { at: 0, list: [] }; }   // tests (right after a permission change)
export const norm = (s) => String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
function tokenScore(t, toks) {
  let best = 0;
  for (const w of toks) {
    if (w === t) return 1;
    if (t.length >= 3 && w.startsWith(t)) best = Math.max(best, 0.85);
    else if (t.length >= 4 && w.includes(t)) best = Math.max(best, 0.7);
    else if (t.length >= 5 && w.length >= 4) { const l = lev(t, w); if (l <= 1) best = Math.max(best, 0.62); else if (l <= 2 && t.length >= 8) best = Math.max(best, 0.5); }
  }
  return best;
}
const FIELDS = [["title", 1], ["artist", 0.95], ["album", 0.75], ["genre", 0.6], ["name", 0.85], ["folder", 0.55]];
const fieldsOf = (x) => FIELDS.map(([k, w]) => [w, norm(k === "name" ? String(x.name ?? "").replace(/\.[^.]+$/, "") : x[k]).split(" ").filter(Boolean), norm(k === "name" ? String(x.name ?? "").replace(/\.[^.]+$/, "") : x[k])]);
// score(item, tokens, phrase) → 0..~1.5
export function score(x, toks, phrase = toks.join(" ")) {
  if (!toks.length) return 0.5;
  const f = fieldsOf(x);
  let sum = 0, missing = 0;
  for (const t of toks) { let best = 0; for (const [w, ws] of f) best = Math.max(best, w * tokenScore(t, ws)); if (best < 0.3) missing++; sum += best; }
  let s = sum / toks.length;
  if (missing) s *= toks.length >= 3 && missing === 1 ? 0.6 : 0;
  if (s && phrase.length > 3) { if (f[0][2].includes(phrase)) s += 0.3; else if (f[1][2].includes(phrase) || f[2][2].includes(phrase)) s += 0.15; if (f[0][2] === phrase) s += 0.2; }
  return s;
}
// search(words, { kind, year, folder, ext, latest, limit, min }) → [{ ...item, score }]
export function search(words = "", { kind = null, year = null, folder = null, ext = null, latest = false, limit = 25, min = 0.45, list = null } = {}) {
  const toks = norm(words).split(" ").filter(Boolean);
  const phrase = toks.join(" ");
  const exts = ext ? new Set([].concat(ext).map((e) => String(e).toLowerCase().replace(/^\./, ""))) : null;
  const fol = folder ? norm(folder) : null;
  const out = [];
  // what file access allows RIGHT NOW (an older index is never a way around a permission taken back)
  const allowed = list ? null : allowedRoots();
  for (const x of list ?? load().items) {
    if (allowed && !allowed.some((r) => safety.under(x.path, r))) continue;
    if (kind && x.kind !== kind) continue;
    if (exts && !exts.has(x.ext)) continue;
    if (year && x.year !== year && !(x.year == null && new Date(x.mtime).getFullYear() === year)) continue;
    if (fol && !norm(x.folder).split(" ").join(" ").includes(fol) && norm(x.root) !== fol) continue;
    const s = score(x, toks, phrase);
    if (toks.length && s < min) continue;
    out.push({ ...x, score: Math.round(s * 1000) / 1000 });
  }
  out.sort(latest ? (a, b) => b.mtime - a.mtime : toks.length ? (a, b) => b.score - a.score || b.mtime - a.mtime : natural);
  return out.slice(0, Math.max(1, Math.min(500, limit)));
}
// the order an album plays in: artist, album, track, title
export const natural = (a, b) => (a.artist || "~").localeCompare(b.artist || "~") || (a.album || "").localeCompare(b.album || "") || (a.track ?? 999) - (b.track ?? 999) || String(a.title).localeCompare(String(b.title));
// "Holy Forever by Chris Tomlin" / "Sarah's wedding (video, 12 minutes)"
export function describe(x, { long = false } = {}) {
  const by = x.artist ? ` by ${x.artist}` : "";
  const mins = x.duration ? (x.duration >= 90 ? `${Math.round(x.duration / 60)} minutes` : `${x.duration} seconds`) : "";
  return `${x.title}${by}${long ? ` (${[x.kind === "video" ? "video" : null, mins, x.drive ? `${x.drive}'s Drive` : x.folder].filter(Boolean).join(", ")})` : ""}`;
}
