// Photos from the owner's computer, shown now and then on the TV, and catalogued in their own words over time.
//   - Where: DAYSPRING_PHOTO_DIRS in .env (";"-separated), else the owner's photo folders (data/owner.json "photoDirs"),
//     else their Pictures folders. A "Dayspring" folder inside Pictures is their hand-picked set, and those come up more often.
//   - Never shown: screenshots, and anything whose folder or name looks private (IDs, taxes, bank, medical…).
//   - About once a day, at a relaxed time, the TV asks "What's this one?". The answer is kept word for word with a
//     category and tags (data/photos.json). "Show me another" moves on; "don't show me that again" hides it for good.
import { readdirSync, statSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, extname, basename, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import * as owner from "./owner.mjs";
import { writeJSONAtomic } from "./atomic.mjs";

// (DAYSPRING_PHOTOS_FILE: tests point it elsewhere, as lib/finder/search.mjs already reads it)
const FILE_OF = () => process.env.DAYSPRING_PHOTOS_FILE || join(dirname(fileURLToPath(import.meta.url)), "..", "data", "photos.json");
const EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
// pictures the TV can't show as they are (Windows decodes them), or that only the photo gallery lists (lib/gallery)
const GALLERY_EXT = new Set([".heic", ".heif", ".tif", ".tiff", ".avif", ".bmp", ".jfif"]);
export const PRIVATE = /screenshot|screen shot|scan|passport|license|licence|\bid\b|ssn|social security|tax|\bw-?2\b|\b1099\b|bank|statement|receipt|invoice|medical|insurance|private|password|nsfw|document/i;
const SKIP_DIRS = /^(\.|node_modules$|appdata$|\$recycle)/i;
// smaller than this is an icon or a thumbnail, not a photo (DAYSPRING_PHOTO_MIN_BYTES: tests with tiny made-up pictures)
export const MIN_BYTES = () => { const v = process.env.DAYSPRING_PHOTO_MIN_BYTES; return v != null && v !== "" && Number(v) >= 0 ? Number(v) : 60_000; };
// Where the owner's photos and images live: the folders they chose (personal photos, art, things they've made), or
// their Pictures folders. Screenshots are skipped by the privacy filter below.
export function roots() {
  const env = process.env.DAYSPRING_PHOTO_DIRS;
  if (env) return env.split(";").map((s) => s.trim()).filter(Boolean);
  const home = process.env.USERPROFILE ?? homedir();
  return [...(owner.get().photoDirs ?? []), join(home, "OneDrive", "Pictures"), join(home, "Pictures")].filter((d, i, a) => a.indexOf(d) === i);
}
export const idOf = (p) => createHash("sha1").update(p.toLowerCase()).digest("hex").slice(0, 16);

let db = null;
function load() {
  if (!db) db = existsSync(FILE_OF()) ? JSON.parse(readFileSync(FILE_OF(), "utf8")) : { photos: {}, lastAsked: null, pending: null };
  db.photos ??= {};
  return db;
}
function save() { writeJSONAtomic(FILE_OF(), load(), 2); }

// The photo list, rescanned every few hours (cheap: a few hundred files). "more": the photo gallery's extra formats
// (HEIC and friends), kept apart so the TV's rotating photo never picks one it can't show.
let index = { at: 0, list: [], more: [] };
export const indexedAt = () => index.at;
export const moreList = () => index.more;
// Built in the background (a big Pictures or OneDrive folder must never freeze Dayspring): scan() answers with the last
// list right away and starts a fresh one when it's old. At most 20,000 photos and 60,000 files are looked at.
let building = null;
export function scan(force = false) {
  if (force || !index.at || Date.now() - index.at > 6 * 3600_000) rebuild().catch(() => {});
  return index.list;
}
export async function scanNow() { await rebuild(); return index.list; }
function rebuild() {
  if (building) return building;
  building = (async () => {
    const { readdir, stat } = await import("node:fs/promises");
    const out = [], more = []; let visited = 0;
    const min = MIN_BYTES();
    const walk = async (dir, depth, root) => {
      if (depth > 6 || out.length > 20000 || visited > 60000) return;
      let entries = [];
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (++visited > 60000) return;
        const p = join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP_DIRS.test(e.name) && !PRIVATE.test(e.name)) await walk(p, depth + 1, root); continue; }
        const ext = extname(e.name).toLowerCase();
        const extra = GALLERY_EXT.has(ext);
        if ((!EXT.has(ext) && !extra) || PRIVATE.test(e.name)) continue;
        let st; try { st = await stat(p); } catch { continue; }
        if (st.size < min) continue;          // icons and thumbnails
        const rel = relative(root, p);
        (extra ? more : out).push({ id: idOf(p), path: p, folder: dirname(rel) === "." ? basename(root) : dirname(rel), name: basename(p), taken: st.mtime.toISOString().slice(0, 10), picked: /(^|[\\/])dayspring([\\/]|$)/i.test(rel),
          size: st.size, mtime: Math.round(st.mtimeMs), root });
      }
    };
    for (const r of roots()) if (existsSync(r)) await walk(r, 0, r);
    index = { at: Date.now(), list: out, more };
  })().finally(() => { building = null; });
  return building;
}
export const byId = (id) => scan().find((p) => p.id === id) ?? null;

// A photo to show: hand-picked ones more often, never a hidden one, uncatalogued ones first when asked for a question.
let lastShown = [];
// A set to show first ("show me photos of Sarah"), for a while; prefer: ids a question would rather be about (faces not named yet).
let focus = null;
export function setFocus(ids, minutes = 30) { focus = ids?.length ? { ids: [...ids], until: Date.now() + minutes * 60_000 } : null; lastShown = []; return focus?.ids.length ?? 0; }
export const isHidden = (id) => load().photos[id]?.status === "hidden";
// the catalogue itself (id → { status, description, category, tags, … }), read-only, for the photo gallery's albums
export const catalogueEntries = () => load().photos;
export function pick({ forQuestion = false, prefer = null } = {}) {
  const d = load(), list = scan().filter((p) => d.photos[p.id]?.status !== "hidden" && !lastShown.includes(p.id));
  if (focus && Date.now() < focus.until) { const next = focus.ids.map((id) => list.find((p) => p.id === id)).find(Boolean); if (next) { lastShown = [...lastShown.slice(-200), next.id]; return describe(next); } focus = null; }
  if (!list.length) return null;
  let pool = forQuestion ? list.filter((p) => !d.photos[p.id]?.description) : list;
  if (prefer?.size) { const pref = list.filter((p) => prefer.has(p.id)); if (pref.length) pool = pref; }
  if (!pool.length) pool = list;
  // Fair to every kind of photo: pick a group (family, art, school, projects…) first, weighted by the square root of
  // its size so hundreds of art images don't crowd out a dozen family photos; hand-picked ones count three times.
  const groupOf = (x) => x.path.replace(/^C:\\Users\\[^\\]+\\/i, "").split("\\").slice(0, 2).join("\\");
  const groups = new Map();
  for (const x of pool) { const g = groupOf(x); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(x); }
  const entries = [...groups.values()], weights = entries.map((g) => Math.sqrt(g.length) * (g.some((x) => x.picked) ? 3 : 1));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0), gi = 0;
  while (gi < entries.length - 1 && (r -= weights[gi]) > 0) gi++;
  const group = entries[gi], p = group[Math.floor(Math.random() * group.length)];
  lastShown = [...lastShown.slice(-20), p.id];
  const c = d.photos[p.id];
  c && (c.shown = (c.shown ?? 0) + 1);
  return describe(p);
}
function describe(p) {
  const c = load().photos[p.id] ?? {};
  return { id: p.id, folder: p.folder, name: p.name, taken: p.taken, picked: p.picked, description: c.description ?? null, category: c.category ?? null, tags: c.tags ?? [], importance: c.importance ?? null };
}
export const info = (id) => { const p = byId(id); return p ? describe(p) : null; };

// Once a day, somewhere relaxed: may we ask about this one?
export function canAskToday(date) { return load().lastAsked !== date; }
export function markAsked(id, date) { const d = load(); d.lastAsked = date; d.pending = { id, at: Date.now() }; save(); }
export function pending() { const p = load().pending; return p && Date.now() - p.at < 15 * 60_000 ? p : null; }
export function clearPending() { load().pending = null; save(); }

// Categories from the owner's words, without the AI. The AI (when available) refines these later: needsAI marks them.
// The owner's own rules (data/photos.json "categoryRules": [["regex source", "Category"], …]) replace these general ones.
const GENERAL_CATS = [[/\b(trip|vacation|travel|beach|camping|road trip|holiday)\b/i, "Family trip"], [/\b(christmas|thanksgiving|easter|birthday|wedding|graduation|party)\b/i, "Celebration"],
  [/\b(school|class|project|homework|college|university|assignment)\b/i, "School project"], [/\b(job ?site|field work|office|work trip|coworkers?)\b/i, "Work"],
  [/\b(church|bible study|worship|youth group|mission)\b/i, "Church"], [/\b(gym|lift|game day|tournament|match|team|practice|race)\b/i, "Sports & fitness"],
  [/\b(build|project I made|made this|diy|craft)\b/i, "Builds & making"],
  [/\b(family|mom|dad|brother|sister|grand\w+|cousin|aunt|uncle)\b/i, "Family"], [/\b(friend|friends|buddy|buddies)\b/i, "Friends"],
  [/\b(meme|funny|joke)\b/i, "Funny"], [/\b(art|drawing|painting|sketch|wallpaper|design)\b/i, "Art"], [/\b(dog|cat|pet)\b/i, "Pets"]];
function cats() {
  const own = load().categoryRules;
  if (!Array.isArray(own) || !own.length) return GENERAL_CATS;
  return own.flatMap(([src, name]) => { try { return [[new RegExp(src, "i"), name]]; } catch { return []; } });
}
export function catalogue(id, words, extra = {}) {
  const d = load(), text = String(words).trim();
  const cat = extra.category ?? cats().find(([re]) => re.test(text))?.[1] ?? "Uncategorised";
  const importance = extra.importance ?? (/\b(doesn'?t matter|not important|no value|random|nothing special|junk)\b/i.test(text) ? "low" : /\b(important|special|favorite|love this|precious|means a lot|memory|memories)\b/i.test(text) ? "high" : "normal");
  const words3 = text.toLowerCase().match(/\b[a-z][a-z'&]{3,}\b/g) ?? [];
  const STOP = new Set(["this", "that", "with", "from", "they", "were", "when", "what", "just", "like", "it's", "there", "about", "been", "have", "some", "really", "because", "photo", "picture", "image"]);
  const tags = extra.tags ?? [...new Set(words3.filter((w) => !STOP.has(w)))].slice(0, 8);
  d.photos[id] = { ...(d.photos[id] ?? {}), id, status: "catalogued", description: text, category: cat, tags, importance, at: new Date().toISOString(), needsAI: !extra.category, source: d.photos[id]?.source ?? { app: "dayspring", user: "local", from: "photo" }, visibility: d.photos[id]?.visibility ?? "private", ...(extra.people ? { people: extra.people } : {}) };
  d.pending = null;
  save();
  return { ...info(id) };
}
export function hide(id, why = "") { const d = load(); d.photos[id] = { ...(d.photos[id] ?? {}), status: "hidden", hiddenWhy: why, at: new Date().toISOString() }; if (d.pending?.id === id) d.pending = null; save(); return true; }
export function stats() { const d = load(), all = scan(); const c = Object.values(d.photos); return { total: all.length, catalogued: c.filter((x) => x.status === "catalogued").length, hidden: c.filter((x) => x.status === "hidden").length }; }
export function search(q) { const n = String(q).toLowerCase(); return scan().map(describe).filter((p) => p.description && (p.description.toLowerCase().includes(n) || p.category?.toLowerCase().includes(n) || p.tags.some((t) => t.includes(n)))); }
export function filePath(id) { return byId(id)?.path ?? null; }
