// A small, safe HTML reader for Amazon's pages (lib/shopping/parse.mjs): the page's HTML is read in Node, never run.
// htmlparser2 (already part of Dayspring through sanitize-html and mailparser) builds the tree; this adds the little bit
// of CSS selector support the parsers need:
//   tag  #id  .class  [attr]  [attr=v]  [attr*=v]  [attr^=v]  [attr$=v]  [attr~=v]  :not(simple)  descendant " "  child ">"
//   and comma lists ("a, b"). Nothing else (no :nth-child, no siblings), on purpose: selectors stay simple and
//   each one has fallbacks in lib/shopping/selectors.mjs.
//   load(html) → doc · $(root, sel) → element | null · $$(root, sel) → [elements] · text(el) · attr(el, name)
import { parseDocument, DomUtils } from "htmlparser2";

export const load = (html) => parseDocument(String(html ?? ""), { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });

// ---- the selector parser ----------------------------------------------------------------------------------------------
const cache = new Map();
function compile(sel) {
  if (cache.has(sel)) return cache.get(sel);
  const groups = splitTop(sel, ",").map((g) => g.trim()).filter(Boolean).map(parseComplex);
  if (cache.size > 500) cache.clear();
  cache.set(sel, groups);
  return groups;
}
// split on a character outside brackets, parentheses and quotes
function splitTop(s, ch) {
  const out = []; let depth = 0, q = null, cur = "";
  for (const c of s) {
    if (q) { if (c === q) q = null; cur += c; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === "[" || c === "(") depth++;
    if (c === "]" || c === ")") depth--;
    if (c === ch && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}
// "div.a > span b" → [{ comb: null, simple }, { comb: ">", simple }, { comb: " ", simple }]
function parseComplex(s) {
  const parts = []; let comb = null, i = 0;
  const str = s.trim();
  while (i < str.length) {
    while (str[i] === " ") { if (comb === null && parts.length) comb = " "; i++; }
    if (str[i] === ">") { comb = ">"; i++; while (str[i] === " ") i++; }
    let j = i, depth = 0, q = null;
    while (j < str.length) {
      const c = str[j];
      if (q) { if (c === q) q = null; j++; continue; }
      if (c === '"' || c === "'") { q = c; j++; continue; }
      if (c === "[" || c === "(") depth++;
      if (c === "]" || c === ")") depth--;
      if (depth === 0 && (c === " " || c === ">")) break;
      j++;
    }
    const tok = str.slice(i, j);
    if (tok) { parts.push({ comb: parts.length ? comb ?? " " : null, simple: parseSimple(tok) }); comb = null; }
    i = j;
  }
  return parts;
}
function parseSimple(tok) {
  const o = { tag: null, id: null, classes: [], attrs: [], nots: [] };
  let i = 0;
  const m0 = /^[a-z0-9*-]+/i.exec(tok);
  if (m0) { o.tag = m0[0].toLowerCase() === "*" ? null : m0[0].toLowerCase(); i = m0[0].length; }
  while (i < tok.length) {
    const c = tok[i];
    if (c === "#" || c === ".") {
      const m = /^[\w-]+/.exec(tok.slice(i + 1)); if (!m) break;
      if (c === "#") o.id = m[0]; else o.classes.push(m[0]);
      i += 1 + m[0].length;
    } else if (c === "[") {
      const end = findClose(tok, i, "[", "]");
      const body = tok.slice(i + 1, end);
      const m = /^\s*([\w:-]+)\s*(?:([*^$~|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?\s*(i)?\s*$/.exec(body);
      if (m) o.attrs.push({ name: m[1].toLowerCase(), op: m[2] ?? null, value: m[3] ?? m[4] ?? m[5] ?? "", ci: Boolean(m[6]) });
      i = end + 1;
    } else if (tok.startsWith(":not(", i)) {
      const end = findClose(tok, i + 4, "(", ")");
      o.nots.push(parseSimple(tok.slice(i + 5, end)));
      i = end + 1;
    } else break;
  }
  return o;
}
function findClose(s, from, open, close) {
  let depth = 0, q = null;
  for (let k = from; k < s.length; k++) {
    const c = s[k];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return k; }
  }
  return s.length;
}

// ---- matching ---------------------------------------------------------------------------------------------------------
const isEl = (n) => n && (n.type === "tag" || n.type === "script" || n.type === "style");
function matchSimple(el, s) {
  if (!isEl(el)) return false;
  if (s.tag && el.name !== s.tag) return false;
  const a = el.attribs ?? {};
  if (s.id && a.id !== s.id) return false;
  if (s.classes.length) { const cl = String(a.class ?? "").split(/\s+/); if (!s.classes.every((c) => cl.includes(c))) return false; }
  for (const t of s.attrs) {
    if (!(t.name in a)) return false;
    if (!t.op) continue;
    let v = String(a[t.name]), want = t.value;
    if (t.ci) { v = v.toLowerCase(); want = want.toLowerCase(); }
    if (t.op === "=" && v !== want) return false;
    if (t.op === "*=" && !v.includes(want)) return false;
    if (t.op === "^=" && !v.startsWith(want)) return false;
    if (t.op === "$=" && !v.endsWith(want)) return false;
    if (t.op === "~=" && !v.split(/\s+/).includes(want)) return false;
    if (t.op === "|=" && !(v === want || v.startsWith(want + "-"))) return false;
  }
  for (const n of s.nots) if (matchSimple(el, n)) return false;
  return true;
}
function matchComplex(el, parts, k = parts.length - 1) {
  if (!matchSimple(el, parts[k].simple)) return false;
  if (k === 0) return true;
  const comb = parts[k].comb;
  let p = el.parent;
  if (comb === ">") return isEl(p) && matchComplex(p, parts, k - 1);
  while (isEl(p)) { if (matchComplex(p, parts, k - 1)) return true; p = p.parent; }
  return false;
}
export function matches(el, sel) { return compile(sel).some((g) => matchComplex(el, g)); }

export function $$(root, sel) {
  if (!root) return [];
  const groups = compile(sel);
  const kids = Array.isArray(root) ? root : root.children ?? [];
  // every element under root (not root itself), in document order
  return DomUtils.findAll((el) => groups.some((g) => matchComplex(el, g)), kids);
}
export function $(root, sel) {
  if (!root) return null;
  const groups = compile(sel);
  const kids = Array.isArray(root) ? root : root.children ?? [];
  return DomUtils.findOne((el) => groups.some((g) => matchComplex(el, g)), kids, true);
}
// the first match of the first selector in a list that matches anything (fallbacks, in order of preference)
export function first(root, sels) { for (const s of [].concat(sels)) { const e = $(root, s); if (e) return e; } return null; }
export function all(root, sels) { for (const s of [].concat(sels)) { const e = $$(root, s); if (e.length) return e; } return []; }

// text: the visible words, with runs of space folded (scripts and styles never count)
export function text(el) {
  if (!el) return "";
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.type === "text") { out.push(n.data); return; }
    if (n.type === "script" || n.type === "style" || n.type === "comment") return;
    if (n.name === "br") out.push(" ");
    for (const c of n.children ?? []) walk(c);
    if (n.type === "tag" && /^(p|div|li|tr|td|th|h\d|span)$/.test(n.name)) out.push(" ");
  };
  walk(el);
  return out.join("").replace(/\s+/g, " ").trim();
}
export const attr = (el, name) => (el?.attribs?.[String(name).toLowerCase()] ?? null);
export const raw = (el) => (el ? DomUtils.getOuterHTML(el) : "");
// the text inside every <script> of the page (Amazon keeps some data there, e.g. the gallery's image list)
export const scripts = (doc) => $$(doc, "script").map((s) => (s.children ?? []).map((c) => c.data ?? "").join(""));
