// The photo gallery: every photo on this computer that Dayspring may show, in one place (public/gallery.js).
//   Sources: the owner's photo folders (lib/photos.mjs, with its PRIVATE filter and the hidden ones left out) and the
//            pictures the finder's index knows in the places file access allows (lib/finder/index.mjs), plus single
//            files it was shown (a saved web picture, a file opened from somewhere else). Same id for the same path in
//            all of them (sha1 of the lower-case full path), so a photo from the TV's rotating card, the file viewer,
//            the People page or the finder opens the same entry here.
//   Views:   all photos, one folder (with or without its subfolders), search words, a person (faces, when on),
//            favourites, a set of ids (the People page's photos, the finder's results), and 🎲 Random (a shuffled
//            order per session: "More" never repeats one, "Shuffle again" puts the ones not seen yet first).
//   Groups:  folder, month, album (the catalogue's category) or none.  Sorts: date (taken, else modified), name, size.
//   Filters: favourites, "has text" (read from the picture by the viewer's describe), videos too, a date range.
//   Thumbnails: made here (lib/vision/helper.mjs decodes, HEIC and TIFF too), cached in data/thumbs (a size cap: the
//            oldest go first); a small JPEG, PNG, GIF or WebP is sent as it is.
//   Location: every photo's folder as breadcrumbs (Pictures › Family › 2026); "Open in File Explorer" selects the file
//            (lib/gallery/explorer.mjs), only inside the permitted places, logged.
// Pages ask for files by id only; folders by a folder id (fid). Paths are only ever shown, never taken from the page.
// Kept: data/gallery.json (favourites; dates read from the photos) · data/thumbs/.   Tests: DAYSPRING_GALLERY_FILE,
// DAYSPRING_THUMBS_DIR, DAYSPRING_THUMBS_MAX_MB, DAYSPRING_THUMB_DIRECT_MAX (bytes sent as they are; 0 = always make one).
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync, utimesSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as photos from "../photos.mjs";
import * as owner from "../owner.mjs";
import * as findex from "../finder/index.mjs";
import * as captions from "../finder/captions.mjs";
import * as permissions from "../permissions.mjs";
import * as safety from "../filesafety.mjs";
import * as activity from "../activity.mjs";
import { writeJSONAtomic } from "../atomic.mjs";
import { extOf, kindOf, NEEDS_DECODE } from "../finder/kinds.mjs";
import { facts } from "../finder/exif.mjs";
import * as explorer from "./explorer.mjs";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const FILE = () => process.env.DAYSPRING_GALLERY_FILE || join(DATA, "gallery.json");
export const THUMBS = () => process.env.DAYSPRING_THUMBS_DIR || join(DATA, "thumbs");
const THUMBS_MAX = () => Math.round(Math.max(0.02, Number(process.env.DAYSPRING_THUMBS_MAX_MB) || 250) * 1024 * 1024);
const DIRECT_MAX = () => { const v = process.env.DAYSPRING_THUMB_DIRECT_MAX; return v != null && v !== "" ? Math.max(0, Number(v) || 0) : 300 * 1024; };
const IMG = new Set(["jpg", "jpeg", "jfif", "png", "gif", "webp", "bmp", "heic", "heif", "avif", "tif", "tiff"]);
const SHOWS_AS_IS = new Set(["jpg", "jpeg", "jfif", "png", "gif", "webp", "bmp", "avif"]);
export const idOf = (p) => createHash("sha1").update(resolve(String(p)).toLowerCase()).digest("hex").slice(0, 16);
export const fidOf = (dir) => "f" + createHash("sha1").update(resolve(String(dir)).toLowerCase()).digest("hex").slice(0, 15);
const lc = (s) => String(s).toLowerCase();
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// ---- what's kept: favourites, and the dates read from the photos ------------------------------------------------------------------
let db = null;
function load() {
  if (db && db.file === FILE()) return db;
  let raw = {}; try { raw = existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), "utf8")) : {}; } catch { raw = {}; }
  db = { file: FILE(), favs: new Set(Array.isArray(raw.favs) ? raw.favs : []), meta: raw.meta && typeof raw.meta === "object" ? raw.meta : {} };
  return db;
}
let saveT = null;
function save(now = false) {
  clearTimeout(saveT);
  const w = () => { const d = load(); try { mkdirSync(dirname(d.file), { recursive: true }); writeJSONAtomic(d.file, { v: 1, favs: [...d.favs], meta: d.meta }, 0); } catch { /* next time */ } };
  if (now) w(); else { saveT = setTimeout(w, 1500); saveT.unref?.(); }
}
export const favs = () => load().favs;
export function setFav(id, on) {
  const it = item(id); if (!it) return { error: "That photo isn't in the gallery." };
  const d = load(); if (on) d.favs.add(it.id); else d.favs.delete(it.id);
  save(true); qcache.clear();
  return { id: it.id, fav: d.favs.has(it.id) };
}

// ---- where Dayspring may show pictures from ----------------------------------------------------------------------------------------
const photosOn = () => { try { return owner.feature("photos") || Boolean(process.env.DAYSPRING_PHOTO_DIRS); } catch { return false; } };
const photoRoots = () => (photosOn() ? photos.roots().filter((r) => existsSync(r)).map((r) => resolve(r)) : []);
// the most specific file-access entry for this path says "keep out"
function keptOut(full) {
  const p = permissions.get(); let best = null;
  for (const e of p.entries) if (safety.under(full, e.path) && (!best || e.path.length > best.path.length)) best = e;
  return best?.access === "none";
}
// a name or a folder (below the place it's in) that looks private: the photos' own filter (screenshots, IDs, taxes…)
function looksPrivate(full, root) {
  const rel = root && safety.under(full, root) ? relative(root, full) : basename(full);
  return rel.split(/[\\/]/).some((s) => photos.PRIVATE.test(s) || findex.PRIVATE.test(s));
}
// allowed(path) → { ok, real } | { ok: false, reason, text }
export function allowed(path) {
  const full = resolve(String(path ?? ""));
  if (safety.isSecretPath(full)) return { ok: false, reason: "secret", text: permissions.DENY.secret };
  if (keptOut(full)) return { ok: false, reason: "none", text: "That folder is kept out of Dayspring (Settings → Permissions)." };
  const f = findex.allowedNow(full);
  if (f.ok) return { ok: true, full, real: f.real ?? full };
  const root = photoRoots().find((r) => safety.under(full, r));
  if (root) {
    let real = full; try { real = realpathSync.native(full); } catch { return { ok: false, reason: "gone", text: "That photo isn't there anymore." }; }
    if (!safety.under(real, root)) return { ok: false, reason: "outside", text: "That photo is linked from somewhere outside your photo folders." };
    if (looksPrivate(full, root)) return { ok: false, reason: "private", text: "That picture looks private, so I keep it off the screen." };
    return { ok: true, full, real };
  }
  return { ok: false, reason: f.reason ?? "outside", text: f.text ?? "That picture isn't in a folder I'm allowed to look in." };
}

// ---- the collection -------------------------------------------------------------------------------------------------------------
const extras = new Map();          // id → item (single files registered: a saved web picture, a file opened elsewhere)
const fids = new Map();            // fid → folder
let built = { key: "", list: [], byId: new Map() };
let version = 0;
function buildKey() { return `${photos.indexedAt()}|${photosOn() ? photos.scan().length : 0}|${photos.moreList().length}|${findex.scannedAt()}|${findex.items().length}|${extras.size}|${photosOn()}|${hiddenCount()}`; }
function hiddenCount() { try { return Object.values(photos.catalogueEntries()).filter((c) => c?.status === "hidden").length; } catch { return 0; } }
function rootLabel(root) { return basename(root) || root; }
function collection() {
  const key = buildKey();
  if (key === built.key) return built;
  const out = new Map(), min = photos.MIN_BYTES();
  const hidden = new Set(Object.entries(photos.catalogueEntries?.() ?? {}).filter(([, c]) => c?.status === "hidden").map(([id]) => id));
  const add = (x) => {
    if (out.has(x.id) || hidden.has(x.id) || looksPrivate(x.path, x.root)) return;
    out.set(x.id, x); fids.set(fidOf(x.dir), x.dir);
  };
  const fromPhotos = (p) => { const full = resolve(p.path); return { id: idOf(full), path: full, name: basename(full), ext: extOf(full), kind: "image", size: p.size ?? 0, mtime: p.mtime ?? Date.parse(p.taken) ?? 0, root: p.root ? resolve(p.root) : null, dir: dirname(full), src: "photos" }; };
  if (photosOn()) for (const p of [...photos.scan(), ...photos.moreList()]) add(fromPhotos(p));
  let froots = []; try { froots = findex.roots().roots ?? []; } catch { froots = []; }
  for (const x of findex.items()) {
    if (x.kind !== "image" && x.kind !== "video") continue;
    if (x.kind === "image" && (!IMG.has(x.ext) || x.size < min)) continue;
    if (safety.isSecretPath(x.path) || keptOut(x.path)) continue;
    const full = resolve(x.path);
    add({ id: idOf(full), path: full, name: x.name, ext: x.ext, kind: x.kind, size: x.size, mtime: x.mtime, root: froots.find((r) => safety.under(full, r)) ?? null, dir: dirname(full), src: "files" });
  }
  for (const [id, x] of extras) if (!out.has(id) && !hidden.has(id)) { out.set(id, x); fids.set(fidOf(x.dir), x.dir); }
  built = { key, list: [...out.values()], byId: out };
  version++; qcache.clear(); labels.clear();
  // every folder a breadcrumb can name (a parent with no photos of its own too) has its folder id from the start
  const dirs = new Map(); for (const x of built.list) if (!dirs.has(x.dir)) dirs.set(x.dir, x);
  for (const x of dirs.values()) crumbs(x);
  fillMeta();
  return built;
}
export const _items = () => collection().list;
export function item(id) { const s = String(id ?? ""); if (!/^[a-f0-9]{16}$/.test(s)) return null; return collection().byId.get(s) ?? null; }
// an id from somewhere else (the finder, the TV's photo) that isn't in the collection yet: looked up and added
export function find(id) {
  const hit = item(id); if (hit) return hit;
  const s = String(id ?? ""); if (!/^[a-f0-9]{16}$/.test(s)) return null;
  const path = findex.byId(s)?.path ?? photos.filePath(s);
  return path ? register(path).item ?? null : null;
}
// a single picture (or video) shown elsewhere: checked, then part of the gallery
export function register(path) {
  const k = allowed(path);
  if (!k.ok) return { denied: true, text: k.text, reason: k.reason };
  let st; try { st = statSync(k.real); } catch { return { error: "That file isn't there anymore." }; }
  const kind = kindOf(k.full);
  if (!st.isFile() || (kind !== "image" && kind !== "video")) return { error: "That isn't a picture." };
  const id = idOf(k.full);
  const hit = collection().byId.get(id); if (hit) return { id, item: hit };
  const roots = [...photoRoots(), ...(findex.roots().roots ?? [])];
  const x = { id, path: k.full, name: basename(k.full), ext: extOf(k.full), kind, size: st.size, mtime: Math.round(st.mtimeMs), root: roots.find((r) => safety.under(k.full, r)) ?? null, dir: dirname(k.full), src: "single" };
  extras.set(id, x); if (extras.size > 2000) extras.delete(extras.keys().next().value);
  return { id, item: collection().byId.get(id) ?? x };
}

// ---- dates (EXIF "taken", read a little at a time in the background) -------------------------------------------------------------
let filling = false;
function fillMeta() {
  if (filling || process.env.DAYSPRING_GALLERY_NO_EXIF === "1") return;
  const d = load(), todo = built.list.filter((x) => x.kind === "image" && /^(jpe?g|jfif)$/.test(x.ext) && d.meta[x.id]?.[0] !== x.mtime);
  if (!todo.length) return;
  filling = true;
  let i = 0, changed = 0;
  const step = () => {
    const end = Math.min(todo.length, i + 40);
    for (; i < end; i++) { const x = todo[i]; const f = facts(x.path, { bytes: 128 * 1024 }); const t = f.taken ? Date.parse(f.taken) : 0; d.meta[x.id] = [x.mtime, Number.isFinite(t) ? t : 0]; changed++; }
    if (i < todo.length) { const t = setTimeout(step, 15); t.unref?.(); return; }
    filling = false; if (changed) { save(); qcache.clear(); }
  };
  const t = setTimeout(step, 0); t.unref?.();
}
const dateOf = (x) => { const m = load().meta[x.id]; return m && m[0] === x.mtime && m[1] ? m[1] : x.mtime; };

// ---- where a photo is, in words: Pictures › Family › 2026 ----------------------------------------------------------------------------
const labels = new Map();   // dir → label
function baseOf(dir, root) {
  if (root && safety.under(dir, root)) return root;
  const h = process.env.DAYSPRING_FINDER_HOME || homedir();
  if (safety.under(dir, h) && lc(resolve(dir)) !== lc(resolve(h))) { const top = relative(h, dir).split(/[\\/]/)[0]; return join(h, top); }
  return resolve(dir).split(/[\\/]/)[0] + "\\";
}
export function crumbs(x) {
  const base = baseOf(x.dir, x.root);
  const parts = relative(base, x.dir).split(/[\\/]/).filter(Boolean);
  const out = [{ label: rootLabel(base).replace(/\\$/, ""), dir: base }];
  let cur = base; for (const s of parts) { cur = join(cur, s); out.push({ label: s, dir: cur }); }
  for (const c of out) fids.set(fidOf(c.dir), c.dir);
  return out.map((c, i) => ({ label: c.label, fid: fidOf(c.dir), last: i === out.length - 1 }));
}
export function whereText(x) { if (!labels.has(x.dir)) labels.set(x.dir, crumbs(x).map((c) => c.label).join(" › ")); return labels.get(x.dir); }
export const folderOf = (fid) => fids.get(String(fid ?? "")) ?? null;

// ---- people in the photos (only when face recognition is on) -------------------------------------------------------------------------
let facesCache = { at: 0, byPhoto: null, people: [] };
async function faceIndex() {
  if (Date.now() - facesCache.at < 60_000 && facesCache.byPhoto) return facesCache;
  facesCache = { at: Date.now(), byPhoto: new Map(), people: [] };
  try {
    const F = await import("../features.mjs"); if (!F.on("faces")) return facesCache;
    const vs = await import("../vision/settings.mjs"); if (!vs.get().faces) return facesCache;
    const lib = await import("../vision/library.mjs"), people = await import("../people/index.mjs");
    const d = await lib.db();
    for (const f of Object.values(d.faces ?? {})) { if (!f.personId || f.state === "suggested" || f.state === "notPerson") continue; const s = facesCache.byPhoto.get(f.photoId) ?? new Set(); s.add(f.personId); facesCache.byPhoto.set(f.photoId, s); }
    const count = new Map(); for (const s of facesCache.byPhoto.values()) for (const p of s) count.set(p, (count.get(p) ?? 0) + 1);
    facesCache.people = people.list().filter((p) => count.has(p.id)).map((p) => ({ id: p.id, name: p.name, photos: count.get(p.id) })).sort((a, b) => a.name.localeCompare(b.name));
  } catch { /* faces off or not readable here */ }
  return facesCache;
}
export async function peopleList() { return (await faceIndex()).people; }

// ---- sets of ids (the People page's photos, the finder's results) and random sessions ---------------------------------------------------
const sets = new Map();
export function makeSet(ids, title = "") {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter((x) => /^[a-f0-9]{16}$/.test(x)))].slice(0, 5000);
  for (const id of list) find(id);
  const token = "s" + createHash("sha1").update(list.join(",") + title).digest("hex").slice(0, 12);
  sets.set(token, { ids: list, title: String(title ?? "").slice(0, 120) }); if (sets.size > 30) sets.delete(sets.keys().next().value);
  return token;
}
const randoms = new Map();   // session → { order, seen, filter }
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffle(a, rnd) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ---- asking for a collection --------------------------------------------------------------------------------------------------------
// query({ view, fid, deep, q, set, person, fav, text, videos, from, to, group, sort, dir, rs, shuffle, seed, focus, offset, limit })
//   → { total, offset, items: [{ id, name, kind, t, size, m, fav }], groups: [{ label, count }], focusIndex, title }
const qcache = new Map();
const words = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 1);
function hay(x) {
  const c = photos.catalogueEntries?.()[x.id], cap = captions.get(x.id);
  return [x.name, relative(baseOf(x.dir, x.root), x.dir), c?.description, c?.category, ...(c?.tags ?? []), cap?.description, cap?.ocr].filter(Boolean).join(" ").toLowerCase().replace(/[_.-]+/g, " ");
}
const albumOf = (x) => { const c = photos.catalogueEntries?.()[x.id]; return c?.category && c.status !== "hidden" ? c.category : null; };
function monthKey(t) { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function monthLabel(t) { const d = new Date(t); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }

export async function query(o = {}) {
  const C = collection();
  const view = ["all", "folder", "search", "person", "favs", "set", "random"].includes(o.view) ? o.view : "all";
  const group = ["folder", "date", "album", "none"].includes(o.group) ? o.group : "none";
  const sort = ["date", "name", "size"].includes(o.sort) ? o.sort : "date";
  const dir = o.dir === "asc" || o.dir === "desc" ? o.dir : sort === "name" ? "asc" : "desc";
  const limit = Math.max(1, Math.min(500, Number(o.limit) || 120)), offset = Math.max(0, Number(o.offset) || 0);
  let title = "All photos";
  const fk = JSON.stringify([version, view, o.fid, Boolean(o.deep), o.q, o.set, o.person, Boolean(o.fav), Boolean(o.text), Boolean(o.videos), o.from, o.to, group, sort, dir]);
  let ids;
  if (view !== "random" && qcache.has(fk)) ({ ids, title } = qcache.get(fk));
  else {
    // (a single picture opened from elsewhere shows with its folder or its set, never in "all" or random)
    let list = C.list.filter((x) => (x.kind === "image" || (o.videos && x.kind === "video")) && (x.src !== "single" || view === "folder" || view === "set"));
    if (view === "folder") {
      const f = folderOf(o.fid); if (!f) return { total: 0, offset: 0, items: [], groups: [], focusIndex: -1, title: "That folder", error: "That folder isn't in the gallery." };
      list = list.filter((x) => (o.deep ? safety.under(x.dir, f) : lc(x.dir) === lc(f)));
      title = basename(f) || f;
    }
    if (view === "set") { const s = sets.get(String(o.set)); const want = new Set(s?.ids ?? []); list = (s?.ids ?? []).map((id) => C.byId.get(id)).filter(Boolean); list = list.filter((x) => want.has(x.id)); title = s?.title || "These photos"; }
    if (view === "favs" || o.fav) { const F = favs(); list = list.filter((x) => F.has(x.id)); if (view === "favs") title = "Favourites"; }
    if (o.person) { const fi = await faceIndex(); list = list.filter((x) => fi.byPhoto?.get(x.id)?.has(String(o.person))); const p = fi.people.find((y) => y.id === String(o.person)); title = p ? `Photos of ${p.name}` : title; }
    if (o.q) { const ws = words(o.q); if (ws.length) { list = list.filter((x) => { const h = hay(x); return ws.every((w) => h.includes(w)); }); title = `Photos like “${String(o.q).slice(0, 60)}”`; } }
    if (o.text) list = list.filter((x) => (captions.get(x.id)?.ocr ?? "").trim().length > 0);
    const from = Number(o.from) || 0, to = Number(o.to) || 0;
    if (from || to) list = list.filter((x) => { const t = dateOf(x); return (!from || t >= from) && (!to || t < to); });
    if (o.said) title = `${title === "All photos" ? "Photos" : title} from ${String(o.said).slice(0, 40)}`;
    const sgn = dir === "asc" ? 1 : -1;
    const cmp = sort === "name" ? (a, b) => sgn * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) || a.id.localeCompare(b.id)
      : sort === "size" ? (a, b) => sgn * (a.size - b.size) || a.name.localeCompare(b.name)
      : (a, b) => sgn * (dateOf(a) - dateOf(b)) || a.name.localeCompare(b.name, undefined, { numeric: true });
    if (view === "random") list = list.slice();
    else if (group === "folder") list.sort((a, b) => whereText(a).localeCompare(whereText(b), undefined, { numeric: true, sensitivity: "base" }) || cmp(a, b));
    else if (group === "date") { const md = sort === "date" ? sgn : -1; list.sort((a, b) => md * monthKey(dateOf(a)).localeCompare(monthKey(dateOf(b))) || cmp(a, b)); }
    else if (group === "album") list.sort((a, b) => { const x = albumOf(a), y = albumOf(b); return (x ? 0 : 1) - (y ? 0 : 1) || String(x ?? "").localeCompare(String(y ?? "")) || cmp(a, b); });
    else list.sort(cmp);
    if (view === "random") {
      // a session's own order: More never repeats one; Shuffle again puts the ones not seen yet first
      const rs = String(o.rs || "default").slice(0, 40), key = JSON.stringify([version, Boolean(o.videos), Boolean(o.fav), o.q, o.person]);
      let s = randoms.get(rs);
      if (!s || o.shuffle || s.key !== key) {
        const rnd = mulberry(Number(o.seed) || (Date.now() ^ (Math.random() * 1e9)));
        const seen = s?.seen ?? new Set();
        const pool = list.map((x) => x.id);
        s = { key, seen, order: [...shuffle(pool.filter((id) => !seen.has(id)), rnd), ...shuffle(pool.filter((id) => seen.has(id)), rnd)] };
        randoms.set(rs, s); if (randoms.size > 20) randoms.delete(randoms.keys().next().value);
      }
      ids = s.order; title = "🎲 Random photos";
      for (const id of ids.slice(offset, offset + limit)) s.seen.add(id);
    } else {
      ids = list.map((x) => x.id);
      qcache.set(fk, { ids, title }); if (qcache.size > 16) qcache.delete(qcache.keys().next().value);
    }
  }
  // the groups over the whole collection (the page lays out its headers from these)
  const groups = [];
  if (group !== "none" && view !== "random") {
    let last = null;
    for (const id of ids) {
      const x = C.byId.get(id); if (!x) continue;
      const g = group === "folder" ? whereText(x) : group === "date" ? monthLabel(dateOf(x)) : albumOf(x) ?? "Not sorted into an album yet";
      if (g === last) groups[groups.length - 1].count++; else { groups.push({ label: g, count: 1 }); last = g; }
    }
  }
  const F = favs();
  const items = ids.slice(offset, offset + limit).map((id) => C.byId.get(id)).filter(Boolean).map((x) => ({ id: x.id, name: x.name, kind: x.kind, t: dateOf(x), size: x.size, m: x.mtime, fav: F.has(x.id) ? 1 : 0 }));
  const focusIndex = o.focus ? ids.indexOf(String(o.focus)) : -1;
  const folder = view === "folder" ? folderOf(o.fid) : null;
  return { total: ids.length, offset, items, groups: group === "none" || view === "random" ? [] : groups, focusIndex, title, view, folder, crumbs: folder ? crumbs({ dir: folder, root: C.list.find((x) => safety.under(x.dir, folder))?.root ?? null }) : null };
}

// ---- one photo's details --------------------------------------------------------------------------------------------------------------
const sizeText = (n) => (n == null ? "" : n < 1024 ? `${n} B` : n < 1 << 20 ? `${Math.max(1, Math.round(n / 1024))} KB` : n < 1 << 30 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${(n / (1 << 30)).toFixed(1)} GB`);
export async function info(id) {
  const x = find(id); if (!x) return { error: "That photo isn't in the gallery." };
  const k = allowed(x.path); if (!k.ok) return { denied: true, text: k.text };
  const out = { id: x.id, name: x.name, kind: x.kind, ext: x.ext, size: x.size, sizeText: sizeText(x.size), modified: x.mtime ? new Date(x.mtime).toISOString() : null, date: new Date(dateOf(x)).toISOString(),
    folder: x.dir, path: x.path, where: whereText(x), crumbs: crumbs(x), fav: favs().has(x.id) };
  if (x.kind === "image") {
    const f = NEEDS_DECODE.has(x.ext) ? {} : facts(k.real);
    Object.assign(out, { width: f.width ?? null, height: f.height ?? null, camera: f.camera ?? null, taken: f.taken ?? null, gps: Boolean(f.gps) });
  }
  const c = photos.catalogueEntries?.()[x.id]; if (c?.description) { out.ownWords = c.description; out.album = c.category ?? null; }
  const cap = captions.get(x.id); if (cap) { out.description = cap.description || null; out.ocr = cap.ocr || null; }
  const fi = await faceIndex(); const ps = fi.byPhoto?.get(x.id);
  if (ps?.size) out.people = fi.people.filter((p) => ps.has(p.id)).map((p) => p.name);
  return out;
}

// ---- 📂 Open in File Explorer -----------------------------------------------------------------------------------------------------------
export function reveal(id, { via = "screen" } = {}) {
  const x = find(id);
  if (!x) { return { error: "That photo isn't in the gallery." }; }
  const k = allowed(x.path);
  if (!k.ok) { activity.log("blocked", { path: x.path, reason: k.reason, text: k.text, via, op: "show in folder" }); return { denied: true, text: k.text }; }
  if (!existsSync(k.real)) return { error: "That photo isn't there anymore." };
  const r = explorer.select(k.real, { via });
  const where = whereText(x);
  return { shown: x.name, folder: x.dir, where, dryRun: r.dryRun, command: `${r.exe} ${r.args.join(" ")}`, reply: `Showing ${x.name} in File Explorer, in ${where}.` };
}

// ---- the files themselves --------------------------------------------------------------------------------------------------------------
// fileFor(id) → { item, real } | { denied, text } | { error }
export function fileFor(id) {
  const x = find(id); if (!x) return { error: "That photo isn't in the gallery." };
  const k = allowed(x.path); if (!k.ok) return { denied: true, text: k.text };
  if (!existsSync(k.real)) return { error: "That photo isn't there anymore." };
  return { item: x, real: k.real };
}
let thumbBytes = null;
function thumbsUsed() {
  if (thumbBytes != null) return thumbBytes;
  thumbBytes = 0; try { for (const n of readdirSync(THUMBS())) { try { thumbBytes += statSync(join(THUMBS(), n)).size; } catch { /* gone */ } } } catch { /* none yet */ }
  return thumbBytes;
}
// keeps data/thumbs under its cap: the least recently used go first, down to 80% of it
export function pruneThumbs() {
  const max = THUMBS_MAX();
  if (thumbsUsed() <= max) return 0;
  let files = []; try { files = readdirSync(THUMBS()).map((n) => { const p = join(THUMBS(), n); try { const s = statSync(p); return { p, size: s.size, t: s.mtimeMs }; } catch { return null; } }).filter(Boolean); } catch { return 0; }
  files.sort((a, b) => a.t - b.t);
  let total = files.reduce((a, f) => a + f.size, 0), gone = 0;
  for (const f of files) { if (total <= max * 0.8) break; try { unlinkSync(f.p); total -= f.size; gone++; } catch { /* in use */ } }
  thumbBytes = total;
  return gone;
}
const making = new Map();
// thumb(id) → { buf, type, cached? } | { file, type } (small enough to send as it is) | { denied|error }
export async function thumb(id, { size = 320 } = {}) {
  const f = fileFor(id); if (!f.item) return f;
  const x = f.item;
  if (x.kind === "image" && SHOWS_AS_IS.has(x.ext) && x.size <= DIRECT_MAX()) return { file: f.real, type: x.ext === "png" ? "image/png" : x.ext === "gif" ? "image/gif" : x.ext === "webp" ? "image/webp" : x.ext === "bmp" ? "image/bmp" : x.ext === "avif" ? "image/avif" : "image/jpeg" };
  const name = `${x.id}-${Math.round(x.mtime)}-${size}.jpg`, out = join(THUMBS(), name);
  if (existsSync(out)) { try { const now = new Date(); utimesSync(out, now, now); } catch { /* fine */ } return { buf: readFileSync(out), type: "image/jpeg", cached: true }; }
  if (making.has(name)) return making.get(name);
  const job = (async () => {
    let buf = null;
    if (x.kind === "image") { try { const helper = await import("../vision/helper.mjs"); buf = Buffer.from((await helper.jpeg(f.real, size)).data, "base64"); } catch { buf = null; } }
    else if (x.kind === "video") buf = await videoFrame(f.real, size);
    if (!buf) return x.kind === "image" && SHOWS_AS_IS.has(x.ext) && x.size <= 8 * 1024 * 1024 ? { file: f.real, type: "image/jpeg" } : { error: "No picture." };
    try { mkdirSync(THUMBS(), { recursive: true }); writeFileSync(out, buf); thumbBytes = thumbsUsed() + buf.length; pruneThumbs(); } catch { /* not cached: still sent */ }
    return { buf, type: "image/jpeg" };
  })().finally(() => making.delete(name));
  making.set(name, job);
  return job;
}
async function videoFrame(path, size) {
  const { ffmpegPath } = await import("../medialib/player.mjs");
  const bin = ffmpegPath(); if (!bin) return null;
  const { spawn } = await import("node:child_process");
  return new Promise((ok) => {
    const p = spawn(bin, ["-hide_banner", "-loglevel", "error", "-ss", "1", "-i", path, "-frames:v", "1", "-vf", `scale=${size}:-2`, "-f", "image2", "-c:v", "mjpeg", "pipe:1"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    const parts = []; const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* gone */ } }, 8000);
    p.stdout.on("data", (c) => parts.push(c)); p.on("close", () => { clearTimeout(t); const b = Buffer.concat(parts); ok(b.length > 100 ? b : null); }); p.on("error", () => { clearTimeout(t); ok(null); });
  });
}

// ---- what the gallery on the screen has open (it tells us: "view this in the gallery", "open this photo's folder") ----------------------
let state = null;
export function setState(s = {}) { state = s && s.open ? { open: true, id: /^[a-f0-9]{16}$/.test(String(s.id ?? "")) ? String(s.id) : null, single: Boolean(s.single), at: Date.now() } : null; return state; }
export const current = () => (state && Date.now() - state.at < 60 * 60_000 ? state : null);
export function status() { const C = collection(); return { photos: C.list.filter((x) => x.kind === "image").length, videos: C.list.filter((x) => x.kind === "video").length, photoFolders: photoRoots().length, thumbs: thumbsUsed(), thumbsMax: THUMBS_MAX() }; }
export function _reset() { db = null; built = { key: "", list: [], byId: new Map() }; extras.clear(); fids.clear(); qcache.clear(); sets.clear(); randoms.clear(); labels.clear(); state = null; thumbBytes = null; facesCache = { at: 0, byPhoto: null, people: [] }; }
