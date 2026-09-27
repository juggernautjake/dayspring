// Recipes: save them (typed, pasted, from a web page, or dictated), find them online, and cook them step by step.
//   list/get/save/remove/search         data/recipes.json (atomic writes), with 5 example recipes to start
//   parseText(text)                     "Pancakes\nServes 4\nIngredients\n…\nSteps\n1. …" → a recipe
//   fromHtml(html, url)                 schema.org Recipe JSON-LD (or microdata) → a recipe; no AI
//   importUrl(url) / findOnline(dish)   the web: fetched with timeouts, private addresses refused, images cached locally
//   easySteps(recipe)                   short steps grouped Prep / Cooking / Finish, with timers, temperatures and ingredients per step
//   scale(recipe, factor)               "double it", "for 8 people"
//   cooking: start/next/prev/step/…     one recipe at a time, step by step
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = () => process.env.DAYSPRING_RECIPES_FILE || join(ROOT, "data", "recipes.json");
export const IMG_DIR = () => process.env.DAYSPRING_RECIPE_IMAGES || join(ROOT, "data", "recipe-images");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Dayspring/1.3";
let deps = { search: null, fetch: (...a) => fetch(...a), emit: () => {}, lookup: (h) => lookup(h, { all: true }) };
export function setDeps(d) { deps = { ...deps, ...d }; }

// ---- text hygiene -------------------------------------------------------------------------------------------------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", deg: "°", frac12: "½", frac14: "¼", frac34: "¾", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", mdash: "—", ndash: "–", hellip: "…" };
export function clean(s) {
  return String(s ?? "").replace(/<[^>]*>/g, " ").replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e) => ENT[e] ?? (/^#x/i.test(e) ? String.fromCodePoint(parseInt(e.slice(2), 16)) : /^#\d/.test(e) ? String.fromCodePoint(Number(e.slice(1))) : m))
    .replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
}

// ---- storage ------------------------------------------------------------------------------------------------------
let db = null;
function load() {
  if (db) return db;
  try { db = existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), "utf8")) : null; } catch { db = null; }
  if (!db) { db = { recipes: EXAMPLES.map((r) => ({ ...r, id: randomUUID().slice(0, 8), example: true, createdAt: new Date().toISOString() })), seeded: true }; save(); }
  return db;
}
function save() { const f = FILE(); try { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f + ".tmp", JSON.stringify(db, null, 1)); renameSync(f + ".tmp", f); } catch { /* not fatal */ } try { deps.emit("recipes", { count: db.recipes.length }); } catch { /* none */ } }
export function _reset(withExamples = true) { db = { recipes: withExamples ? EXAMPLES.map((r) => ({ ...r, id: randomUUID().slice(0, 8), example: true })) : [] }; save(); }
export const list = () => load().recipes.map(summary);
export function get(ref) {
  const all = load().recipes;
  const r = String(ref ?? "").toLowerCase().trim();
  return all.find((x) => x.id === r) ?? all.find((x) => x.title.toLowerCase() === r)
    ?? all.find((x) => x.title.toLowerCase().replace(/^(the|my|easy|simple|basic|classic)\s+/g, "").startsWith(r.replace(/^(the|my|some|a|an)\s+/, "")))
    ?? bestTitle(all, r);
}
function bestTitle(all, r) {
  const words = r.replace(/\b(the|my|a|an|some|recipe|recipes|for)\b/g, " ").split(/\s+/).filter((w) => w.length > 2).map((w) => w.replace(/s$/, ""));
  if (!words.length) return null;
  let best = null, bestN = 0;
  for (const x of all) { const t = x.title.toLowerCase(); const n = words.filter((w) => t.includes(w)).length; if (n > bestN) { best = x; bestN = n; } }
  return bestN >= Math.ceil(words.length / 2) ? best : null;
}
export function summary(r) { return { id: r.id, title: r.title, servings: r.servings ?? null, time: r.times?.total ?? null, tags: r.tags ?? [], favourite: Boolean(r.favourite), example: Boolean(r.example), image: r.image ?? null, source: r.source ?? null, ingredients: r.ingredients?.length ?? 0, steps: flatSteps(r).length }; }
export function saveRecipe(input) {
  const s = load();
  const r = normalizeRecipe(input);
  if (!r.title) throw new Error("A recipe needs a title.");
  if (!r.ingredients.length && !flatSteps(r).length) throw new Error("A recipe needs ingredients or steps.");
  const existing = input.id ? s.recipes.find((x) => x.id === input.id) : null;
  if (existing) Object.assign(existing, r, { id: existing.id, updatedAt: new Date().toISOString() });
  else s.recipes.push({ ...r, id: randomUUID().slice(0, 8), createdAt: new Date().toISOString() });
  save();
  return existing ?? s.recipes.at(-1);
}
export function update(id, patch) { const r = load().recipes.find((x) => x.id === id); if (!r) return null; Object.assign(r, normalizeRecipe({ ...r, ...patch }), { id }); save(); return r; }
export function remove(id) { const s = load(); const r = s.recipes.find((x) => x.id === id); if (!r) return null; s.recipes = s.recipes.filter((x) => x !== r); save(); return r; }
export function searchSaved(q) {
  const words = String(q).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return load().recipes.filter((r) => { const hay = `${r.title} ${(r.tags ?? []).join(" ")} ${(r.ingredients ?? []).join(" ")}`.toLowerCase(); return words.every((w) => hay.includes(w.replace(/s$/, ""))); }).map(summary);
}
export function flatSteps(r) { return (r.sections?.length ? r.sections.flatMap((s) => s.steps) : r.steps ?? []).filter(Boolean); }
function normalizeRecipe(i) {
  const steps = (i.steps ?? []).map(clean).filter(Boolean);
  const sections = (i.sections ?? []).map((s) => ({ name: clean(s.name), steps: (s.steps ?? []).map(clean).filter(Boolean) })).filter((s) => s.steps.length);
  return {
    title: clean(i.title).slice(0, 120), servings: i.servings ? Number(String(i.servings).match(/\d+/)?.[0]) || null : null,
    ingredients: (i.ingredients ?? []).map(clean).filter(Boolean).slice(0, 80), steps: sections.length ? [] : steps.slice(0, 80), sections,
    tags: [...new Set((i.tags ?? []).map((t) => clean(t).toLowerCase()).filter(Boolean))].slice(0, 12), favourite: Boolean(i.favourite),
    times: { prep: i.times?.prep ?? null, cook: i.times?.cook ?? null, total: i.times?.total ?? (i.times?.prep || i.times?.cook ? (i.times.prep ?? 0) + (i.times.cook ?? 0) : null) },
    image: i.image ?? null, source: i.source ?? null, description: clean(i.description).slice(0, 400) || null, notes: clean(i.notes).slice(0, 1000) || null,
    rating: i.rating ?? null, example: Boolean(i.example),
  };
}

// ---- typed or pasted recipes ---------------------------------------------------------------------------------------
const QTY_START = /^([\d½¼¾⅓⅔⅛]|a |an |one |two |three |pinch|dash|handful|some |salt|pepper)/i;
export function parseText(text) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error("There's no recipe text there.");
  let title = lines[0].replace(/^(recipe|title)\s*[:\-]\s*/i, "");
  let servings = null; const ingredients = [], steps = [], tags = [];
  let mode = null;
  for (const raw of lines.slice(1)) {
    const l = raw.replace(/^[-*•·]\s*/, "");
    const sv = /^(?:serves|servings|yield|makes)\s*[:\-]?\s*(\d+)/i.exec(l);
    if (sv) { servings = Number(sv[1]); continue; }
    if (/^tags?\s*:/i.test(l)) { tags.push(...l.replace(/^tags?\s*:/i, "").split(/[,;]/)); continue; }
    if (/^(ingredients|you('ll)? need|what you need|shopping list)\s*:?$/i.test(l)) { mode = "ing"; continue; }
    if (/^(instructions|directions|method|steps|preparation|how to make( it)?)\s*:?$/i.test(l)) { mode = "steps"; continue; }
    const numbered = /^(?:step\s*)?(\d+)[.):\-]\s*(.+)$/i.exec(l);
    if (numbered) { mode = mode ?? "steps"; if (mode === "steps" || !QTY_START.test(numbered[2])) { steps.push(numbered[2]); continue; } }
    if (mode === "ing") ingredients.push(l);
    else if (mode === "steps") steps.push(l);
    else if (QTY_START.test(l) && l.length < 80) ingredients.push(l);
    else steps.push(l);
  }
  const times = timesFromSteps(steps);
  return normalizeRecipe({ title, servings, ingredients, steps, tags, times });
}
function timesFromSteps(steps) { const mins = steps.flatMap((s) => stepTimers(s).map((t) => t.ms / 60000)); return { total: mins.length ? Math.round(mins.reduce((a, b) => a + b, 0)) : null }; }

// ---- schema.org Recipe ---------------------------------------------------------------------------------------------
export function isoMinutes(d) {
  if (!d) return null;
  if (typeof d === "number") return d;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+)S)?)?$/i.exec(String(d).trim());
  if (!m) { const n = /(\d+)\s*(min|hour|hr)/i.exec(String(d)); return n ? Number(n[1]) * (/h/i.test(n[2]) ? 60 : 1) : null; }
  const total = (Number(m[1] || 0) * 1440) + (Number(m[2] || 0) * 60) + Number(m[3] || 0) + Math.round(Number(m[4] || 0) / 60);
  return total || null;
}
const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const typeIs = (o, t) => asArray(o?.["@type"]).some((x) => String(x).toLowerCase() === t);
function findRecipeNode(node, depth = 0) {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) { for (const n of node) { const f = findRecipeNode(n, depth + 1); if (f) return f; } return null; }
  if (typeof node !== "object") return null;
  if (typeIs(node, "recipe")) return node;
  for (const k of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item"]) { const f = findRecipeNode(node[k], depth + 1); if (f) return f; }
  return null;
}
function imageUrl(img) {
  for (const i of asArray(img)) {
    if (typeof i === "string" && /^https?:/.test(i)) return i;
    if (i && typeof i === "object") { const u = i.url ?? i.contentUrl ?? i["@id"]; if (typeof u === "string" && /^https?:/.test(u)) return u; }
  }
  return null;
}
function instructions(ins) {
  const sections = []; const loose = [];
  const walk = (x, into) => {
    if (x == null) return;
    if (typeof x === "string") { for (const part of clean(x).split(/(?:\n|(?<=\.)\s+(?=\d+\.\s))/)) if (part.trim()) into.push(part.trim().replace(/^\d+\.\s*/, "")); return; }
    if (Array.isArray(x)) { x.forEach((y) => walk(y, into)); return; }
    if (typeIs(x, "howtosection")) { const s = { name: clean(x.name) || "Steps", steps: [] }; walk(x.itemListElement ?? x.steps, s.steps); sections.push(s); return; }
    if (typeIs(x, "howtostep") || x.text || x.name) { const t = clean(x.text ?? x.name); if (t) into.push(t); const img = imageUrl(x.image); if (img) into.images = [...(into.images ?? []), { step: into.length - 1, url: img }]; return; }
  };
  walk(ins, loose);
  if (sections.length && loose.length) sections.unshift({ name: "Steps", steps: loose });
  return sections.length ? { sections } : { steps: loose };
}
export function fromJsonLd(node, url = null) {
  const r = findRecipeNode(node);
  if (!r) return null;
  const ins = instructions(r.recipeInstructions);
  let host = null; try { host = url ? new URL(url).hostname.replace(/^www\./, "") : null; } catch { /* none */ }
  const author = asArray(r.author).map((a) => clean(typeof a === "string" ? a : a?.name)).filter(Boolean)[0] ?? null;
  const rating = r.aggregateRating ? { value: Number(r.aggregateRating.ratingValue) || null, count: Number(r.aggregateRating.ratingCount ?? r.aggregateRating.reviewCount) || null } : null;
  const out = normalizeRecipe({
    title: r.name, description: r.description, servings: asArray(r.recipeYield).map(String).find((y) => /\d/.test(y)) ?? null,
    ingredients: asArray(r.recipeIngredient ?? r.ingredients).map(String), ...ins,
    times: { prep: isoMinutes(r.prepTime), cook: isoMinutes(r.cookTime), total: isoMinutes(r.totalTime) },
    tags: [...asArray(r.recipeCategory), ...asArray(r.recipeCuisine), ...String(r.keywords ?? "").split(",")].map(String).slice(0, 8),
    source: url ? { site: clean(r.publisher?.name) || host, url, author } : null, rating,
  });
  out.remoteImage = imageUrl(r.image);
  out.stepImages = (ins.steps?.images ?? []).slice(0, 12);
  if (r.nutrition?.calories) out.nutrition = { calories: clean(r.nutrition.calories) };
  return out;
}
export function fromHtml(html, url = null) {
  const blocks = [...String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const b of blocks) {
    let j; try { j = JSON.parse(b.trim().replace(/^\s*<!--|-->\s*$/g, "")); } catch { try { j = JSON.parse(b.replace(/[\u0000-\u001f]+/g, " ")); } catch { continue; } }
    const r = fromJsonLd(j, url);
    if (r && r.title && (r.ingredients.length || flatSteps(r).length)) return r;
  }
  // microdata, at its simplest
  if (/itemtype=["']https?:\/\/schema\.org\/Recipe["']/i.test(html)) {
    const prop = (p) => [...String(html).matchAll(new RegExp(`itemprop=["']${p}["'][^>]*?(?:content=["']([^"']+)["'][^>]*>|>([\\s\\S]*?)<\\/)`, "gi"))].map((m) => clean(m[1] ?? m[2]));
    const title = prop("name")[0]; const ingredients = prop("recipeIngredient").concat(prop("ingredients")); const steps = prop("recipeInstructions");
    if (title && (ingredients.length || steps.length)) { let host = null; try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* none */ } return normalizeRecipe({ title, ingredients, steps, source: url ? { site: host, url } : null }); }
  }
  return null;
}

// ---- the web, safely -----------------------------------------------------------------------------------------------
function privateIp(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  return x === "::1" || x === "::" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80") || x.startsWith("::ffff:127.") || x.startsWith("::ffff:10.") || x.startsWith("::ffff:192.168.");
}
export async function guard(url) {
  let u; try { u = new URL(String(url)); } catch { throw new Error("That isn't a web address."); }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http and https pages can be read.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal|.*\.lan|.*\.home)$/i.test(host)) throw new Error("That address is on this network, so I won't open it.");
  const addrs = isIP(host) ? [{ address: host }] : await deps.lookup(host).catch(() => []);
  if (!addrs.length) throw new Error("I couldn't find that site.");
  if (addrs.some((a) => privateIp(a.address))) throw new Error("That address is on this network, so I won't open it.");
  return u.href;
}
async function getText(url, ms = 3000) {
  const href = await guard(url);
  const r = await deps.fetch(href, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "accept-language": "en-US,en;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`The page returned ${r.status}.`);
  const reader = r.body?.getReader?.();
  if (!reader) return (await r.text()).slice(0, 3_000_000);
  let got = "", size = 0; const dec = new TextDecoder();
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; got += dec.decode(value, { stream: true }); if (size > 3_000_000) { try { await reader.cancel(); } catch { /* fine */ } break; } }
  return got;
}
export async function importUrl(url) {
  const html = await getText(url, 8000);
  const r = fromHtml(html, url);
  if (!r) throw new Error("I couldn't find a recipe I can read on that page.");
  return r;
}
export async function cacheImage(url) {
  if (!url) return null;
  const href = await guard(url);
  const r = await deps.fetch(href, { headers: { "user-agent": UA, accept: "image/*" }, redirect: "follow", signal: AbortSignal.timeout(5000) });
  const type = r.headers.get("content-type") ?? "";
  if (!r.ok || !/^image\/(jpeg|jpg|png|webp|gif|avif)/i.test(type)) throw new Error("not an image");
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 5 * 1024 * 1024) throw new Error("image too big");
  const ext = ({ "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif" })[type.split(";")[0].toLowerCase()] ?? ".jpg";
  const name = createHash("sha1").update(href).digest("hex").slice(0, 16) + ext;
  mkdirSync(IMG_DIR(), { recursive: true });
  writeFileSync(join(IMG_DIR(), name), buf);
  return name;
}
export function imagePath(name) { if (!/^[a-f0-9]{16}\.(jpg|png|webp|gif|avif)$/.test(String(name))) return null; const p = join(IMG_DIR(), name); return existsSync(p) ? p : null; }
export const imageType = (name) => ({ ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif" })[extname(name)] ?? "image/jpeg";

// find(dish) → up to 6 recipes from different sites, complete ones first; "more options" gets the next ones
const SKIP_SITES = /(youtube\.com|youtu\.be|pinterest\.|facebook\.com|instagram\.com|tiktok\.com|reddit\.com|amazon\.|walmart\.|wikipedia\.org|quora\.com|x\.com|twitter\.com)/i;
let lastSearch = null;
export const lastResults = () => lastSearch;
export async function findOnline(dish, { offset = 0, count = 6 } = {}) {
  const query = String(dish ?? "").replace(/\b(recipes?|how to make|how do i make)\b/gi, "").trim();
  if (!query) throw new Error("What dish should I look for?");
  if (!deps.search) throw new Error("Web search isn't available.");
  let pool = lastSearch?.query === query ? lastSearch.pool : null;
  if (!pool) {
    const found = await deps.search(`${query} recipe`, { max: 15 });
    const urls = [...new Set((found.results ?? []).map((x) => x.url).filter((u) => /^https?:/.test(u) && !SKIP_SITES.test(u)))].slice(0, 15);
    const settled = await Promise.allSettled(urls.map(async (u) => { const html = await getText(u, 3000); const r = fromHtml(html, u); if (!r) throw new Error("no recipe"); return r; }));
    const seen = new Set(), bySite = new Map();
    pool = [];
    for (const s of settled) {
      if (s.status !== "fulfilled") continue;
      const r = s.value, key = r.title.toLowerCase().replace(/[^a-z0-9]/g, "") + "|" + (r.source?.site ?? "");
      if (seen.has(key)) continue; seen.add(key);
      r.score = (r.ingredients.length ? 2 : 0) + (flatSteps(r).length ? 2 : 0) + (r.remoteImage ? 1 : 0) + (r.times?.total ? 1 : 0) + (r.rating?.value ? 0.5 : 0);
      const site = r.source?.site ?? "?";
      bySite.set(site, (bySite.get(site) ?? 0) + 1);
      r.score -= (bySite.get(site) - 1) * 1.5;                 // variety: a second recipe from the same site ranks lower
      pool.push(r);
    }
    pool.sort((a, b) => b.score - a.score);
    pool.forEach((r, i) => { r.tempId = "r" + (i + 1); });
  }
  lastSearch = { query, pool, offset };
  const page = pool.slice(offset, offset + count);
  return { query, results: page.map((r, i) => ({ n: i + 1, tempId: r.tempId, title: r.title, site: r.source?.site ?? null, url: r.source?.url ?? null, time: r.times?.total ?? null, servings: r.servings, rating: r.rating, ingredients: r.ingredients.length, image: r.remoteImage ?? null })), more: pool.length > offset + count, total: pool.length };
}
export function fromResults(ref) {
  if (!lastSearch) return null;
  const page = lastSearch.pool.slice(lastSearch.offset, lastSearch.offset + 6);
  const r = String(ref ?? "").toLowerCase();
  if (/quick|fast|shortest/.test(r)) return page.filter((x) => x.times?.total).sort((a, b) => a.times.total - b.times.total)[0] ?? page[0] ?? null;
  if (/best|top rated|highest/.test(r)) return page.slice().sort((a, b) => (b.rating?.value ?? 0) - (a.rating?.value ?? 0))[0] ?? null;
  const n = Number(r.match(/\d+/)?.[0]) || ({ first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, last: page.length })[r.match(/first|second|third|fourth|fifth|sixth|last/)?.[0]];
  if (n) return page[n - 1] ?? null;
  const site = page.find((x) => x.source?.site && r.includes(x.source.site.split(".")[0].toLowerCase()));
  return site ?? page.find((x) => x.tempId === r) ?? null;
}
export async function saveFound(r) {
  const copy = { ...r, tags: [...(r.tags ?? []), r.source?.site ? `from ${r.source.site}` : null].filter(Boolean) };
  try { if (r.remoteImage) copy.image = await cacheImage(r.remoteImage); } catch { copy.image = null; }
  delete copy.remoteImage; delete copy.score; delete copy.tempId; delete copy.stepImages;
  return saveRecipe(copy);
}

// ---- easy steps ----------------------------------------------------------------------------------------------------
const PREP = /\b(chop|dice|mince|slice|peel|grate|zest|measure|preheat|pre-heat|whisk|mix|stir together|combine|beat|cream|sift|marinate|season|rinse|wash|trim|cut|line|grease|soak|set out|gather|prepare|toss)\b/i;
const COOK = /\b(bake|roast|simmer|boil|fry|saute|sauté|sear|brown|grill|broil|cook|steam|poach|heat|melt|reduce|braise|toast|microwave|flip)\b/i;
const FINISH = /\b(serve|garnish|rest|let (it )?(cool|stand|rest)|cool|slice and serve|enjoy|plate|top with|sprinkle)\b/i;
const NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty-five": 45, sixty: 60 };
export function stepTimers(text) {
  const out = [];
  const re = /\b(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|forty-five|sixty)(?:\s*(?:-|to|–)\s*(\d+))?\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/gi;
  let m;
  while ((m = re.exec(text))) {
    const n = Number(m[2] ?? (NUMW[m[1].toLowerCase()] ?? m[1]));
    if (!Number.isFinite(n) || n <= 0) continue;
    const unit = /^h/i.test(m[3]) ? 3_600_000 : /^s/i.test(m[3]) ? 1000 : 60_000;
    out.push({ ms: Math.round(n * unit), text: m[0] });
  }
  return out;
}
export function temps(text) {
  const out = [];
  for (const m of String(text).matchAll(/(\d{2,3})\s*°?\s*(f|c|fahrenheit|celsius)\b|(\d{3})\s*degrees(?:\s*(f|c|fahrenheit|celsius))?/gi)) {
    const v = Number(m[1] ?? m[3]); const u = (m[2] ?? m[4] ?? (v >= 200 ? "f" : "c")).toLowerCase()[0];
    out.push(u === "f" ? { f: v, c: Math.round((v - 32) * 5 / 9) } : { c: v, f: Math.round(v * 9 / 5 + 32) });
  }
  return out;
}
const INGR_WORD = (line) => clean(line).toLowerCase().replace(/\(.*?\)/g, " ").replace(/^[\d½¼¾⅓⅔⅛\/.\s-]+/, "").replace(/\b(cups?|tbsp|tablespoons?|tsp|teaspoons?|ounces?|oz|pounds?|lbs?|grams?|g|kg|ml|liters?|l|pinch|dash|cloves?|cans?|large|small|medium|fresh|chopped|diced|minced|sliced|of|to taste|and|or|optional|packed|softened|melted|ground)\b/g, " ").replace(/[,;].*$/, "").replace(/\s+/g, " ").trim();
export function easySteps(recipe) {
  const raw = flatSteps(recipe);
  const out = []; let n = 0;
  const names = (recipe.ingredients ?? []).map((l) => ({ line: l, key: INGR_WORD(l) })).filter((x) => x.key);
  for (const s of raw) {
    const parts = s.length > 160 ? s.split(/(?<=[.!?])\s+(?=[A-Z])/) : [s];
    for (const p of parts) {
      const text = p.trim(); if (!text) continue;
      const phase = FINISH.test(text) && !COOK.test(text.split(/[,;]/)[0]) ? "Finish" : COOK.test(text) ? "Cooking" : PREP.test(text) ? "Prep" : out.at(-1)?.phase ?? "Prep";
      const low = text.toLowerCase();
      const uses = names.filter((x) => x.key.split(" ").some((w) => w.length > 3 && low.includes(w.replace(/s$/, "")))).map((x) => x.line).slice(0, 6);
      out.push({ n: ++n, phase, text, timers: stepTimers(text).map((t) => ({ ...t, label: timerLabel(text) })), temps: temps(text), uses });
    }
  }
  return out;
}
function timerLabel(step) {
  const verb = (step.match(COOK) ?? step.match(PREP) ?? step.match(FINISH) ?? ["cook"])[0].toLowerCase();
  const obj = /\b(?:the|your)\s+([a-z]+(?:\s+[a-z]+)?)/i.exec(step.slice(step.toLowerCase().indexOf(verb)))?.[1] ?? "";
  return (`${verb} ${obj}`).trim().replace(/\b(for|until|about|minutes?|hours?)\b.*$/, "").trim().slice(0, 30);
}

// ---- scaling and questions -----------------------------------------------------------------------------------------
const UNI = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };
function parseQty(s) {
  const m = /^\s*(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?\s*[½¼¾⅓⅔⅛]?|[½¼¾⅓⅔⅛])(\s*(?:-|to)\s*(\d+(?:\.\d+)?))?/.exec(s);
  if (!m) return null;
  const v = (t) => { t = t.trim(); if (/^\d+\s+\d+\/\d+$/.test(t)) { const [w, f] = t.split(/\s+/); const [a, b] = f.split("/").map(Number); return Number(w) + a / b; } if (/^\d+\/\d+$/.test(t)) { const [a, b] = t.split("/").map(Number); return a / b; } const u = /[½¼¾⅓⅔⅛]/.exec(t); return (parseFloat(t) || 0) + (u ? UNI[u[0]] : 0); };
  return { value: v(m[1]), to: m[3] ? Number(m[3]) : null, text: m[0] };
}
function fmtQty(x) {
  const whole = Math.floor(x + 1e-9), frac = x - whole;
  const fr = [[0, ""], [0.125, "⅛"], [0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"], [1, ""]].reduce((a, b) => (Math.abs(b[0] - frac) < Math.abs(a[0] - frac) ? b : a));
  const w = fr[0] === 1 ? whole + 1 : whole;
  return x >= 10 ? String(Math.round(x)) : `${w || ""}${fr[1]}`.trim() || "0";
}
export function scaleLine(line, factor) {
  const q = parseQty(line);
  if (!q || factor === 1) return line;
  const scaled = fmtQty(q.value * factor) + (q.to ? `–${fmtQty(q.to * factor)}` : "");
  return line.replace(q.text, scaled + (/\s$/.test(q.text) ? " " : ""));
}
export function scale(recipe, factor) { return { ...recipe, ingredients: (recipe.ingredients ?? []).map((l) => scaleLine(l, factor)), servings: recipe.servings ? Math.round(recipe.servings * factor) : null, scaledBy: factor }; }
export function howMuch(recipe, what) {
  const w = String(what).toLowerCase().replace(/\b(of|the|do i need|need|use|should i use|goes in|in it|for this|how much|how many)\b/g, " ").replace(/\s+/g, " ").trim().replace(/s$/, "");
  if (!w) return null;
  const hits = (recipe.ingredients ?? []).filter((l) => l.toLowerCase().includes(w) || (w.length > 4 && l.toLowerCase().includes(w.slice(0, -1))));
  return hits.length ? hits : null;
}

// ---- cooking mode --------------------------------------------------------------------------------------------------
let cooking = null;            // { recipe, steps, i, factor }
export const cookingNow = () => (cooking ? { title: cooking.recipe.title, i: cooking.i, total: cooking.steps.length, step: cooking.steps[cooking.i] ?? null, factor: cooking.factor, image: cooking.recipe.image ?? null, ingredients: cooking.recipe.ingredients, id: cooking.recipe.id ?? null } : null);
function emitCooking() { try { deps.emit("cooking", cookingNow() ?? { done: true }); } catch { /* none */ } }
export function startCooking(recipe, factor = 1) {
  const r = factor !== 1 ? scale(recipe, factor) : recipe;
  cooking = { recipe: r, steps: easySteps(r), i: -1, factor };
  emitCooking();
  return cookingNow();
}
export function stopCooking() { const was = cooking?.recipe?.title ?? null; cooking = null; emitCooking(); return was; }
export function move(delta) {
  if (!cooking) return null;
  cooking.i = Math.max(0, Math.min(cooking.steps.length, cooking.i + delta));
  emitCooking();
  return cookingNow();
}
export function goTo(n) { if (!cooking) return null; cooking.i = Math.max(0, Math.min(cooking.steps.length - 1, n - 1)); emitCooking(); return cookingNow(); }
export function setScale(factor) { if (!cooking) return null; const r = scale(cooking.recipe, factor / (cooking.factor || 1)); cooking.recipe = r; cooking.factor = factor; cooking.steps = easySteps(r); emitCooking(); return cookingNow(); }

// ---- dictating a new recipe ----------------------------------------------------------------------------------------
let dictation = null;          // { title, ingredients, steps, stage }
export const dictating = () => dictation;
export function startDictation(title) { dictation = { title: clean(title) || "", ingredients: [], steps: [], stage: title ? "ingredients" : "title" }; return dictation; }
export function dictate(text) {
  if (!dictation) return null;
  const t = clean(text);
  if (/^(done|that is it|thats it|finished|save it|save the recipe|all done)$/i.test(t)) {
    const d = dictation; dictation = null;
    if (!d.title) d.title = "My recipe";
    return { saved: saveRecipe({ title: d.title, ingredients: d.ingredients, steps: d.steps }) };
  }
  if (/^(cancel|never ?mind|forget it|stop)$/i.test(t)) { dictation = null; return { cancelled: true }; }
  if (dictation.stage === "title") { dictation.title = t.replace(/^(it is called|its called|call it|the title is)\s+/i, ""); dictation.stage = "ingredients"; return { stage: "ingredients" }; }
  if (/^(steps|instructions|now the steps|directions|method)$/i.test(t)) { dictation.stage = "steps"; return { stage: "steps" }; }
  if (/^(ingredients|the ingredients)$/i.test(t)) { dictation.stage = "ingredients"; return { stage: "ingredients" }; }
  const step = /^(?:step\s*)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|next)\b[.:,]?\s*(.+)$/i.exec(t);
  if (dictation.stage === "steps" || (step && /^step/i.test(t))) { dictation.stage = "steps"; dictation.steps.push(step ? step[1] : t); return { stage: "steps", added: step ? step[1] : t, count: dictation.steps.length }; }
  const ing = t.replace(/^(add|and|also|plus)\s+/i, "");
  dictation.ingredients.push(ing);
  return { stage: "ingredients", added: ing, count: dictation.ingredients.length };
}

// ---- five simple examples (written for Dayspring; deletable) -------------------------------------------------------
const EXAMPLES = [
  { title: "Simple pancakes", servings: 4, tags: ["breakfast", "example"], times: { prep: 10, cook: 15, total: 25 },
    ingredients: ["1 1/2 cups all-purpose flour", "1 tablespoon sugar", "2 teaspoons baking powder", "1/2 teaspoon salt", "1 1/4 cups milk", "1 egg", "3 tablespoons melted butter"],
    steps: ["Whisk the flour, sugar, baking powder and salt in a large bowl.", "Whisk the milk, egg and melted butter in another bowl, then pour it into the dry ingredients and stir until just combined.", "Heat a lightly greased pan over medium heat.", "Pour about 1/4 cup of batter for each pancake and cook for 2 minutes, until bubbles form on top.", "Flip and cook for 1 minute more, until golden.", "Serve warm with syrup or fruit."] },
  { title: "Easy chili", servings: 6, tags: ["dinner", "example"], times: { prep: 15, cook: 45, total: 60 },
    ingredients: ["1 pound ground beef", "1 onion, diced", "2 cloves garlic, minced", "1 can (15 oz) kidney beans, drained", "1 can (15 oz) diced tomatoes", "1 can (8 oz) tomato sauce", "2 tablespoons chili powder", "1 teaspoon cumin", "1 teaspoon salt"],
    steps: ["Brown the ground beef with the onion in a large pot over medium heat, about 8 minutes.", "Add the garlic and cook for 1 minute.", "Stir in the beans, diced tomatoes, tomato sauce, chili powder, cumin and salt.", "Bring to a boil, then lower the heat and simmer the chili for 30 minutes, stirring now and then.", "Taste, adjust the seasoning, and serve with your favourite toppings."] },
  { title: "Banana bread", servings: 8, tags: ["baking", "example"], times: { prep: 15, cook: 60, total: 75 },
    ingredients: ["3 ripe bananas, mashed", "1/3 cup melted butter", "3/4 cup sugar", "1 egg, beaten", "1 teaspoon vanilla", "1 teaspoon baking soda", "1 pinch salt", "1 1/2 cups all-purpose flour"],
    steps: ["Preheat the oven to 350°F and grease a loaf pan.", "Mix the mashed bananas and melted butter in a bowl.", "Stir in the sugar, egg and vanilla.", "Sprinkle the baking soda and salt over the mixture and stir, then mix in the flour.", "Pour the batter into the pan and bake for 60 minutes, until a toothpick comes out clean.", "Let it cool in the pan for 10 minutes before slicing."] },
  { title: "Fluffy white rice", servings: 4, tags: ["side", "example"], times: { prep: 2, cook: 25, total: 27 },
    ingredients: ["1 cup long-grain white rice", "2 cups water", "1/2 teaspoon salt", "1 teaspoon butter (optional)"],
    steps: ["Rinse the rice in a strainer until the water runs clear.", "Bring the water, salt and butter to a boil in a saucepan.", "Stir in the rice, cover, and turn the heat to low.", "Simmer the rice for 18 minutes without lifting the lid.", "Take it off the heat and let it rest, covered, for 5 minutes.", "Fluff with a fork and serve."] },
  { title: "Scrambled eggs", servings: 2, tags: ["breakfast", "quick", "example"], times: { prep: 2, cook: 5, total: 7 },
    ingredients: ["4 eggs", "2 tablespoons milk", "1 pinch salt", "1 pinch pepper", "1 tablespoon butter"],
    steps: ["Whisk the eggs, milk, salt and pepper in a bowl.", "Melt the butter in a pan over medium-low heat.", "Pour in the eggs and let them sit for 20 seconds.", "Gently stir with a spatula, pushing the eggs from the edges to the middle, for about 3 minutes, until just set.", "Serve right away."] },
];
