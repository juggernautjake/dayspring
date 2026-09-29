// Finding files by name the way people say them: forgiving typos ("resumee", "leese agrement"), spoken numbers, words run
// together or split apart ("IMG5782" / "img 5782"), plurals and possessives ("Sarah's"), the kind of file, dates, folders,
// the owner's own words about a photo (the photo catalogue), what was read in a picture (the viewer's descriptions and
// text), and a song's or video's tags (the media library).
//   search(q, { limit, min }) → { results: [{ ...item, score, why }], searched: [folders], total }   q: a parse() result
//   similar(q) → a few names that are close (for "did you mean")
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as index from "./index.mjs";
import * as captions from "./captions.mjs";
import { normWords, compact } from "./query.mjs";
import { extsOf } from "./kinds.mjs";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");

// ---- the owner's own words about photos (lib/photos.mjs keeps them in data/photos.json) ----------------------------------------
// read here directly (lib/photos.mjs would start walking the photo folders just by being asked)
let photoCat = { at: 0, file: "", map: new Map(), hidden: new Set() };
const photoId = (p) => createHash("sha1").update(String(p).toLowerCase()).digest("hex").slice(0, 16);
function catalogue() {
  const file = process.env.DAYSPRING_PHOTOS_FILE || join(DATA, "photos.json");
  if (photoCat.file !== file || Date.now() - photoCat.at > 60_000) {
    const map = new Map(), hidden = new Set();
    try {
      if (existsSync(file)) for (const [id, c] of Object.entries(JSON.parse(readFileSync(file, "utf8")).photos ?? {})) {
        if (c?.status === "hidden") hidden.add(id);
        else if (c?.description || c?.tags?.length) map.set(id, [c.description, c.category, ...(c.tags ?? [])].filter(Boolean).join(" "));
      }
    } catch { /* unreadable: no words */ }
    photoCat = { at: Date.now(), file, map, hidden };
  }
  return photoCat;
}
export const photoWords = (path) => catalogue().map.get(photoId(path)) ?? "";
// a photo the owner hid ("don't show me that again") stays hidden here too
export const photoHidden = (path) => catalogue().hidden.has(photoId(path));
// a song's or video's tags (lib/medialib: the same id for the same path)
let medialib = null;
async function mediaTags() { if (medialib === null) { try { medialib = await import("../medialib/library.mjs"); } catch { medialib = false; } } return medialib || null; }

// ---- matching one word ------------------------------------------------------------------------------------------------------
export function lev(a, b, max = 3) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length, n = b.length; let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= n; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] ? prev[j - 2] + 1 : Infinity); best = Math.min(best, cur[j]); }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[n];
}
const stem = (w) => (w.length > 4 && /ies$/.test(w) ? w.slice(0, -3) + "y" : w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w);
function wordScore(t, toks) {
  let best = 0;
  const ts = stem(t), num = /^\d+$/.test(t);
  for (const w of toks) {
    if (w === t || stem(w) === ts) return 1;
    if (num) { if (/^\d+$/.test(w) && (w.endsWith(t) || w.startsWith(t)) && t.length >= 2) best = Math.max(best, t.length >= 3 ? 0.8 : 0.55); continue; }
    if (t.length >= 3 && w.startsWith(t)) best = Math.max(best, 0.86);
    else if (t.length >= 3 && ts.length >= 3 && w.startsWith(ts)) best = Math.max(best, 0.84);
    else if (t.length >= 4 && w.includes(t)) best = Math.max(best, 0.72);
    else if (w.length >= 4 && t.startsWith(w) && t.length - w.length <= 2) best = Math.max(best, 0.7);
    if (t.length >= 4 && w.length >= 3 && !/\d/.test(w)) { const l = lev(ts, stem(w), 2); if (l <= 1) best = Math.max(best, 0.74); else if (l === 2 && t.length >= 7) best = Math.max(best, 0.6); }
  }
  return best;
}

// ---- one file against the request -----------------------------------------------------------------------------------------------
function fields(x, extra) {
  const base = x.name.replace(/\.[^.]+$/, "");
  const folder = relative(index.home(), dirname(x.path)).split(/[\\/]/).slice(-3).join(" ");
  // (the extension counts as a word of the name: "config json", "the report pptx")
  return { name: [...normWords(base), ...(x.ext ? [x.ext] : [])], compactName: compact(base), folder: normWords(folder), words: extra ? normWords(extra) : [], full: base.toLowerCase() };
}
// words that often come along with a name without being in it ("my todo list", "a copy of", "the new one")
const SOFT = new Set(["list", "lists", "copy", "version", "new", "old", "one", "thing", "stuff"]);
export function score(x, q, extra = "", { loose = false } = {}) {
  const all = q.words.flatMap((w) => normWords(w));
  if (!all.length) return { s: 0.5, why: "" };
  const f = fields(x, extra);
  let sum = 0, missing = 0, fromName = 0, fromWords = 0, n0 = 0, exact = 0;
  for (const t of all) {
    const n = wordScore(t, f.name), o = 0.62 * wordScore(t, f.folder), c = 0.8 * wordScore(t, f.words);
    const best = Math.max(n, o, c);
    if (best < 0.3 && SOFT.has(t) && all.length > 1) continue;
    n0++;
    if (best < 0.3) missing++;
    if (n >= best && n > 0) fromName++; else if (c >= best && c > 0) fromWords++;
    if (n === 1 || wordScore(t, f.folder) === 1) exact++;
    sum += best;
  }
  const toks = all;
  let s = n0 ? sum / n0 : 0;
  if (missing && !loose) s *= n0 >= 3 && missing === 1 ? 0.75 : n0 >= 5 && missing === 2 ? 0.5 : 0;
  // said as one run: "img 5782" in IMG_5782, "leaseagreement", the whole name
  const cq = toks.filter((t) => !SOFT.has(t) || toks.length === 1).join("");
  if (s > 0 || cq.length >= 5) {
    if (cq.length >= 4 && f.compactName.includes(cq)) s = Math.max(s, 0.85) + 0.25;
    else if (cq.length >= 6 && lev(cq, f.compactName, 2) <= (cq.length >= 10 ? 2 : 1)) s = Math.max(s, 0.8) + 0.1;
    if (f.compactName === cq) s += 0.3;
  }
  return { s, exact, why: fromName ? "name" : fromWords ? "description" : "folder" };
}

const inRange = (x, q) => {
  if (q.after && x.mtime < +q.after) return false;
  if (q.before && x.mtime >= +q.before) return false;
  if (q.year != null) {
    const d = new Date(x.mtime);
    const named = new RegExp(`(^|\\D)${q.year}(\\D|$)`).test(x.path);
    if (d.getFullYear() !== q.year && !named) return false;
    if (q.month != null && d.getMonth() !== q.month && !(named && new RegExp(`${q.year}[-_ ]?${String(q.month + 1).padStart(2, "0")}`).test(x.name))) return false;
  }
  return true;
};
const folderHit = (x, folder) => {
  if (!folder) return true;
  const want = compact(folder), parts = dirname(x.path).split(/[\\/]/).map(compact);
  return parts.some((p) => p === want || (want.length >= 4 && (p.startsWith(want) || lev(p, want, 1) <= 1)));
};

// search(q) → { results, total, searched }
export async function search(q, { limit = 30, min = 0.5, list = null, loose = false } = {}) {
  const r = index.roots();
  const all = list ?? index.items();
  const kinds = new Set(q.kinds ?? []), exts = new Set(q.exts ?? []);
  for (const k of kinds) for (const e of extsOf(k)) exts.add(e);
  const typed = exts.size > 0;
  const ml = await mediaTags();
  const out = [];
  for (const x of all) {
    if (typed && !exts.has(x.ext)) continue;
    if (!inRange(x, q) || !folderHit(x, q.folder)) continue;
    if (!list && !r.roots.some((root) => x.path.toLowerCase().startsWith(root.toLowerCase())) && !r.files.some((f) => f.toLowerCase() === x.path.toLowerCase())) continue;
    if (x.kind === "image" && photoHidden(x.path)) continue;
    let extra = "";
    if (q.words.length) {
      if (x.kind === "image") extra = [photoWords(x.path), captions.textOf(x.id)].filter(Boolean).join(" ");
      else if (x.kind === "video" || x.kind === "audio") { const t = ml?.byId?.(x.id); if (t) extra = [t.title, t.artist, t.album, t.genre].filter(Boolean).join(" "); }
      else extra = captions.textOf(x.id);
    }
    const { s, why, exact } = score(x, q, extra, { loose });
    if (q.words.length && s < min) continue;
    // a little for being newer (a tie goes to the one touched lately)
    const age = Math.max(0, Date.now() - x.mtime) / 86_400_000;
    out.push({ ...x, score: Math.round((s + Math.max(0, 0.04 - age / 5000)) * 1000) / 1000, why, exact });
  }
  out.sort(q.latest || !q.words.length ? (a, b) => b.mtime - a.mtime : (a, b) => b.score - a.score || b.mtime - a.mtime);
  return { results: out.slice(0, limit), total: out.length, searched: r.roots, files: r.files, off: r.off, how: r.how };
}

// "did you mean …": the closest names, ignoring the kind and dates
export async function similar(q, n = 3) {
  if (!q.words.length) return [];
  const loose = { ...q, kinds: [], exts: [], after: null, before: null, year: null, month: null, folder: null };
  const { results } = await search(loose, { limit: n * 3, min: 0.34, loose: true });
  const seen = new Set();
  return results.filter((x) => (seen.has(x.name.toLowerCase()) ? false : seen.add(x.name.toLowerCase()))).slice(0, n);
}

// is the best one clearly the one? (then it opens straight away)
export function confident(results, q) {
  const [a, b] = results;
  if (!a) return false;
  if (!q.words.length) return q.latest && q.action === "open";
  if (a.score >= 1.3 && (!b || b.score < a.score - 0.15)) return true;
  if (a.score >= 0.9 && (!b || b.score < a.score - 0.3)) return true;
  return results.length === 1 && a.score >= 0.7;
}
