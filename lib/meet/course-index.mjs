// A search index over one installed Lantern course, so a question asked in a meeting can be matched to the lessons
// that teach it. Read-only: it only reads the course pack Lantern installed (%LOCALAPPDATA%\Lantern\packs\<id>\<ver>).
//
//   const ix = await load("cfml")            → null when the course isn't installed
//   ix.search("how do I stop sql injection", 3) → [{ id, title, unit: { id, n, title }, n, score, why }]
//   ix.lesson("u4l2") → { id, title, unit, n, objectives, takeaways, keyTerms, text }   (text: the lesson's teaching text)
//   ix.course → { id, title, version, subject }
//
// What's indexed: titles, objectives, key terms, takeaways, unit titles and overviews, and each lesson's teaching text
// and example code. Never the exercises, quizzes or "predict" answers (no solutions).
// Ranking: BM25 over weighted fields. Query words are lightly stemmed, and joined-up words are tried too ("query
// param" also looks for …queryparam), because captions spell code words as separate words.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const STOP = new Set("a an the and or but if then else of to in on at by for with from as is are was were be been being it its this that these those what whats which who whom how why when where do does did done can could should would will shall may might must i me my we our you your he she they them their there here about into over under than so not no yes just also only very really please tell explain show give want need know like get got use using used make makes way ways thing things some any each every all one two lesson lessons course unit module covered cover question hey ok okay um uh".split(" "));
export const stem = (w) => w.length > 4 ? w.replace(/(?:ies)$/, "y").replace(/(?:ing|ed|es|s)$/, "") : w;
export function tokens(text) {
  const t = String(text ?? "").toLowerCase().replace(/<\/?([a-z][\w.-]*)[^>]*>/g, " $1 ").replace(/&[a-z]+;/g, " ").replace(/[^a-z0-9_.#]+/g, " ");
  const out = [];
  for (let w of t.split(/\s+/)) { w = w.replace(/^[.#_]+|[.#_]+$/g, ""); if (!w || w.length < 2 || STOP.has(w)) continue; for (const part of w.split(/[.#]/)) if (part.length >= 2 && !STOP.has(part)) out.push(stem(part)); if (/[.#]/.test(w)) out.push(stem(w.replace(/[.#]/g, ""))); }
  return out;
}
// Everyday words for programming ideas that lessons name differently (general, not tied to one course). A course can add
// its own (build({ synonyms })).
export const SYNONYMS = {
  "pound sign": "hash mark", "pound signs": "hash marks", "number sign": "hash mark", octothorpe: "hash",
  xss: "encode html escape output", "cross site scripting": "encode html escape output", "cross-site scripting": "encode html escape output",
  dollars: "dollar format currency", currency: "dollar format",
  "try catch": "catch error", exception: "error catch", "secret key": "key encrypt", hashing: "hash",
};
function withSynonyms(q, extra = {}) {
  // the everyday phrase is replaced by the lesson's words (so "scripting" in "cross site scripting" doesn't pull in script lessons)
  let t = " " + String(q ?? "").toLowerCase().replace(/[?!.,;:]+/g, " ") + " ";
  for (const [k, v] of Object.entries({ ...SYNONYMS, ...extra }).sort((x, y) => y[0].length - x[0].length)) if (t.includes(" " + k + " ")) t = t.replace(" " + k + " ", " " + v + " ");
  return t.trim();
}
const html2text = (h) => String(h ?? "").replace(/<(?:br|\/p|\/li|\/tr|\/h\d)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

// ---- reading a pack ----------------------------------------------------------------------------------------------------
export const packsDir = () => join(process.env.LANTERN_DATA || join(process.env.LOCALAPPDATA || ".", "Lantern"), "packs");
const vparts = (v) => String(v).split(".").map((x) => Number(x) || 0);
const newer = (a, b) => { const x = vparts(a), y = vparts(b); for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0); return false; };
export function packPath(courseId) {
  const dir = join(packsDir(), courseId);
  if (!existsSync(dir)) return null;
  let best = null;
  for (const v of readdirSync(dir)) { try { if (statSync(join(dir, v)).isDirectory() && existsSync(join(dir, v, "manifest.json")) && (!best || newer(v, best))) best = v; } catch { /* skip */ } }
  return best ? join(dir, best) : null;
}
export function installedCourses() {
  try { return readdirSync(packsDir()).filter((id) => packPath(id)); } catch { return []; }
}

// The lesson text lives in the course page's script (the pack's index.html). It's run in an empty sandbox (no Node,
// no page, a time limit) only to read the lesson objects it defines; it's fine for it to stop partway (it expects a page).
function lessonBlocks(dir) {
  const out = new Map();
  let html = "";
  try { html = readFileSync(join(dir, "index.html"), "utf8"); } catch { return out; }
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => /lessons/.test(s));
  const sb = Object.create(null); sb.window = sb; sb.globalThis = sb; sb.self = sb; sb.console = { log() {}, warn() {}, error() {}, info() {} };
  const ctx = vm.createContext(sb, { codeGeneration: { strings: false, wasm: false } });
  for (const s of scripts) { try { vm.runInContext(s, ctx, { timeout: 3000 }); } catch { /* stops where it needs a page: what it defined so far is enough */ } }
  const seen = new Set();
  const walk = (o, depth) => {
    if (!o || typeof o !== "object" || depth > 6 || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
    if (typeof o.id === "string" && Array.isArray(o.blocks) && o.title) { if (!out.has(o.id)) out.set(o.id, o.blocks); return; }
    for (const k of Object.keys(o)) { try { walk(o[k], depth + 1); } catch { /* getters */ } }
  };
  for (const k of Object.keys(sb)) if (k !== "window" && k !== "globalThis" && k !== "self") walk(sb[k], 0);
  return out;
}
const SKIP_BLOCKS = new Set(["exercise", "quiz", "predict", "project", "milestone", "check"]);
function blockText(blocks) {
  const text = [], code = [];
  for (const b of blocks ?? []) {
    if (!b || SKIP_BLOCKS.has(b.t)) continue;
    if (b.html) text.push(html2text(b.html));
    if (b.title) text.push(String(b.title));
    if (Array.isArray(b.items)) text.push(b.items.map((i) => html2text(typeof i === "string" ? i : i?.html ?? i?.text ?? "")).join("\n"));
    if (Array.isArray(b.head)) text.push(b.head.join(" · "));
    if (Array.isArray(b.rows)) text.push(b.rows.map((r) => (Array.isArray(r) ? r.map(html2text).join(" · ") : "")).join("\n"));
    const src = b.code ?? b.src ?? b.source;
    if (typeof src === "string" && b.t === "code") code.push(src.slice(0, 4000));
  }
  return { text: text.filter(Boolean).join("\n"), code: code.join("\n") };
}

// ---- BM25 --------------------------------------------------------------------------------------------------------------
const FIELDS = { title: 3, keyTerms: 2.5, objectives: 2, takeaways: 2, unit: 0.8, text: 1, code: 0.6 };
const K1 = 1.2, B = 0.75;

export function build({ manifest, blocks = new Map(), synonyms = {} }) {
  const lessons = [];
  for (const u of manifest.units ?? []) {
    (u.lessons ?? []).forEach((l, i) => {
      const bt = blockText(blocks.get(l.id));
      lessons.push({
        id: l.id, title: l.title, n: i + 1, unit: { id: u.id, n: u.n, title: u.title },
        objectives: l.objectives ?? [], takeaways: l.takeaways ?? [], keyTerms: l.keyTerms ?? [], text: bt.text, code: bt.code,
        fields: { title: tokens(l.title), keyTerms: tokens((l.keyTerms ?? []).join(" ")), objectives: tokens((l.objectives ?? []).join(" ")), takeaways: tokens((l.takeaways ?? []).join(" ")),
          unit: tokens(`${u.title} ${u.overview ?? ""}`), text: tokens(bt.text), code: tokens(bt.code) },
      });
    });
  }
  // per-field document frequencies and average lengths
  const df = new Map(), avg = {};
  for (const f of Object.keys(FIELDS)) avg[f] = lessons.reduce((a, l) => a + l.fields[f].length, 0) / Math.max(1, lessons.length) || 1;
  const tf = lessons.map((l) => { const m = {}; for (const f of Object.keys(FIELDS)) { const c = new Map(); for (const w of l.fields[f]) c.set(w, (c.get(w) ?? 0) + 1); m[f] = c; } return m; });
  for (const t of tf) { const seen = new Set(); for (const f of Object.keys(FIELDS)) for (const w of t[f].keys()) seen.add(w); for (const w of seen) df.set(w, (df.get(w) ?? 0) + 1); }
  const vocab = [...df.keys()];
  const N = lessons.length;
  const idf = (w) => { const d = df.get(w) ?? 0; return Math.log(1 + (N - d + 0.5) / (d + 0.5)); };

  // The course's tag prefix, learned from its key terms (e.g. key terms like <xyset>, <xyloop> → "xy"), so a spoken
  // "set" or "loop" also finds the tag.
  const tagWords = (manifest.units ?? []).flatMap((u) => (u.lessons ?? []).flatMap((l) => (l.keyTerms ?? []).map((k) => /^<\/?([a-z][a-z0-9]{2,})/i.exec(k)?.[1]?.toLowerCase()).filter(Boolean)));
  const pc = new Map(); for (const w of tagWords) pc.set(w.slice(0, 2), (pc.get(w.slice(0, 2)) ?? 0) + 1);
  const [tagPrefix, tagCount] = [...pc.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const prefix = tagCount >= 3 && tagCount >= tagWords.length * 0.6 ? tagPrefix : null;
  // "query param" → also "queryparam" and the words ending in it; "c f query" → "cfquery"; "dollar" → "dollarformat"
  function expand(qt) {
    const extra = [], near = [];
    for (const w of qt) {
      if (prefix && w.length >= 3 && df.has(prefix + w)) near.push(prefix + w);
      if (w.length >= 5) for (const v of vocab) if (v !== w && v.startsWith(w) && v.length - w.length >= 4 && v.length - w.length <= 8 && /^(format|param|of|for|to|from|json|html|list|array|struct|exists|read|write|set|get)/.test(v.slice(w.length))) near.push(v);
    }
    for (let n = 2; n <= 3; n++) for (let i = 0; i + n <= qt.length; i++) {
      const joined = qt.slice(i, i + n).join("");
      if (joined.length < 5) continue;
      if (df.has(joined)) extra.push(joined);
      else if (joined.length >= 6) for (const v of vocab) if (v.length > joined.length && v.length - joined.length <= 3 && v.endsWith(joined)) extra.push(v);
    }
    return { words: [...qt, ...extra, ...extra], near };   // a joined-up code word is a strong signal: counted twice
  }
  function search(question, k = 3, { synonyms: more = null } = {}) {
    const raw = tokens(withSynonyms(question, more ? { ...synonyms, ...more } : synonyms));
    // the owner's letters spelled out ("c f query") become one word
    const { words: qt, near } = expand(raw);
    if (!qt.length) return [];
    const NEAR = 0.5;                                 // a tag or function name that only looks like a spoken word counts for less
    const scored = lessons.map((l, i) => {
      let s = 0; const why = new Map();
      for (const w of new Set([...qt, ...near])) {
        const weightQ = qt.filter((x) => x === w).length + (qt.includes(w) ? 0 : NEAR * near.filter((x) => x === w).length);
        let fsum = 0;
        for (const [f, wf] of Object.entries(FIELDS)) {
          const c = tf[i][f].get(w) ?? 0; if (!c) continue;
          const len = l.fields[f].length;
          fsum += wf * (c * (K1 + 1)) / (c + K1 * (1 - B + B * len / avg[f]));
        }
        if (fsum) { const add = idf(w) * fsum * weightQ; s += add; why.set(w, add); }
      }
      return { l, s, why };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k);
    const top = scored[0]?.s ?? 1;
    return scored.map(({ l, s, why }) => ({ id: l.id, title: l.title, n: l.n, unit: l.unit, score: Math.round(s * 100) / 100, rel: Math.round((s / top) * 100) / 100,
      why: [...why.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w]) => w) }));
  }
  const byId = new Map(lessons.map((l) => [l.id, l]));
  // How strongly a question is about this course at all (0..): the best lesson's score per query word
  function strength(question) { const r = search(question, 1)[0]; const n = Math.max(1, new Set(tokens(question)).size); return r ? r.score / n : 0; }
  return {
    search, strength, size: lessons.length, vocab: () => vocab.length,
    lesson(id) { const l = byId.get(id); if (!l) return null; const { fields: _f, ...rest } = l; return rest; },
    lessons: () => lessons.map((l) => ({ id: l.id, title: l.title, n: l.n, unit: l.unit })),
    // words that mark a question as being about this course, for "is this a course question?": the course's title and
    // its code-like key terms (<tags>, functions(), dotted.names, camelCase, ACRONYMS), not everyday words like "name"
    signature: () => new Set([...tokens(manifest.title), ...(manifest.units ?? []).flatMap((u) => (u.lessons ?? []).flatMap((l) => (l.keyTerms ?? [])
      .filter((k) => /[<(.#]|[a-z][A-Z]|^[A-Z]{2,}(?![a-z])/.test(String(k)) || (prefix && String(k).toLowerCase().startsWith(prefix))).flatMap((k) => tokens(k))))].filter((w) => w.length >= 3)),
    top: (question) => search(question, 1)[0]?.score ?? 0,
  };
}

const cache = new Map();     // courseId → { dir, at, ix }
export async function load(courseId) {
  const dir = packPath(courseId);
  if (!dir) return null;
  const hit = cache.get(courseId);
  if (hit && hit.dir === dir) return hit.ix;
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const blocks = lessonBlocks(dir);
  const ix = build({ manifest, blocks });
  ix.course = { id: manifest.id ?? courseId, title: manifest.title ?? courseId, version: manifest.version ?? null, subject: manifest.subject ?? null, withText: blocks.size };
  cache.set(courseId, { dir, at: Date.now(), ix });
  return ix;
}
export function _clear() { cache.clear(); }
