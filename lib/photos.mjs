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

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "photos.json");
const EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const PRIVATE = /screenshot|screen shot|scan|passport|license|licence|\bid\b|ssn|social security|tax|w-?2|1099|bank|statement|receipt|invoice|medical|insurance|private|password|nsfw|document/i;
const SKIP_DIRS = /^(\.|node_modules$|appdata$|\$recycle)/i;
// Where the owner's photos and images live: the folders they chose (personal photos, art, things they've made), or
// their Pictures folders. Screenshots are skipped by the privacy filter below.
function roots() {
  const env = process.env.DAYSPRING_PHOTO_DIRS;
  if (env) return env.split(";").map((s) => s.trim()).filter(Boolean);
  const home = process.env.USERPROFILE ?? homedir();
  return [...(owner.get().photoDirs ?? []), join(home, "OneDrive", "Pictures"), join(home, "Pictures")].filter((d, i, a) => a.indexOf(d) === i);
}
export const idOf = (p) => createHash("sha1").update(p.toLowerCase()).digest("hex").slice(0, 16);

let db = null;
function load() {
  if (!db) db = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { photos: {}, lastAsked: null, pending: null };
  db.photos ??= {};
  return db;
}
function save() { writeFileSync(FILE, JSON.stringify(load(), null, 2)); }

// The photo list, rescanned every few hours (cheap: a few hundred files).
let index = { at: 0, list: [] };
export function scan(force = false) {
  if (!force && index.list.length && Date.now() - index.at < 6 * 3600_000) return index.list;
  const out = [];
  const walk = (dir, depth, root) => {
    if (depth > 6 || out.length > 20000) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.test(e.name) && !PRIVATE.test(e.name)) walk(p, depth + 1, root); continue; }
      if (!EXT.has(extname(e.name).toLowerCase()) || PRIVATE.test(e.name)) continue;
      let st; try { st = statSync(p); } catch { continue; }
      if (st.size < 60_000) continue;          // icons and thumbnails
      const rel = relative(root, p);
      out.push({ id: idOf(p), path: p, folder: dirname(rel) === "." ? basename(root) : dirname(rel), name: basename(p), taken: st.mtime.toISOString().slice(0, 10), picked: /(^|[\\/])dayspring([\\/]|$)/i.test(rel) });
    }
  };
  for (const r of roots()) if (existsSync(r)) walk(r, 0, r);
  index = { at: Date.now(), list: out };
  return out;
}
export const byId = (id) => scan().find((p) => p.id === id) ?? null;

// A photo to show: hand-picked ones more often, never a hidden one, uncatalogued ones first when asked for a question.
let lastShown = [];
export function pick({ forQuestion = false } = {}) {
  const d = load(), list = scan().filter((p) => d.photos[p.id]?.status !== "hidden" && !lastShown.includes(p.id));
  if (!list.length) return null;
  let pool = forQuestion ? list.filter((p) => !d.photos[p.id]?.description) : list;
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
  d.photos[id] = { ...(d.photos[id] ?? {}), status: "catalogued", description: text, category: cat, tags, importance, at: new Date().toISOString(), needsAI: !extra.category };
  d.pending = null;
  save();
  return { ...info(id) };
}
export function hide(id, why = "") { const d = load(); d.photos[id] = { ...(d.photos[id] ?? {}), status: "hidden", hiddenWhy: why, at: new Date().toISOString() }; if (d.pending?.id === id) d.pending = null; save(); return true; }
export function stats() { const d = load(), all = scan(); const c = Object.values(d.photos); return { total: all.length, catalogued: c.filter((x) => x.status === "catalogued").length, hidden: c.filter((x) => x.status === "hidden").length }; }
export function search(q) { const n = String(q).toLowerCase(); return scan().map(describe).filter((p) => p.description && (p.description.toLowerCase().includes(n) || p.category?.toLowerCase().includes(n) || p.tags.some((t) => t.includes(n)))); }
export function filePath(id) { return byId(id)?.path ?? null; }
