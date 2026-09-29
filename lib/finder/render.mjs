// Turning a file into something the viewer can show, here on this computer (nothing leaves it):
//   text(buf)          → { text, truncated, encoding }                 txt, md, csv, json, logs, code
//   docx(buf)          → { html }                                      Word (mammoth → HTML, then cleaned: no scripts, no links out)
//   sheet(buf, ext)    → { sheets: [{ name, rows, cols, truncated }] }  Excel, OpenDocument, CSV (SheetJS)
//   slides(buf)        → { slides: [{ n, title, paras, notes, images: [entry] }] }   PowerPoint: the text and pictures
//   zipList(buf)       → { entries: [{ i, name, size, packed, dir, date }], total }
//   zipEntry(buf, name, { max }) → { buf, name }                        one file from inside (small ones only)
import { createRequire } from "node:module";
import { basename } from "node:path";

const require = createRequire(import.meta.url);
export const MAX_TEXT = 2 * 1024 * 1024, MAX_ROWS = 2000, MAX_COLS = 60, MAX_INNER = 25 * 1024 * 1024, MAX_ENTRIES = 5000;

export function text(buf) {
  let b = Buffer.from(buf), encoding = "utf-8", truncated = false;
  if (b.length > MAX_TEXT) { b = b.subarray(0, MAX_TEXT); truncated = true; }
  let s;
  if (b[0] === 0xff && b[1] === 0xfe) { s = b.subarray(2).toString("utf16le"); encoding = "utf-16"; }
  else if (b[0] === 0xfe && b[1] === 0xff) { const c = Buffer.from(b.subarray(2)); c.swap16?.(); s = c.toString("utf16le"); encoding = "utf-16"; }
  else {
    s = b.toString("utf8").replace(/^﻿/, "");
    // not UTF-8 (lots of replacement characters): an older Windows file
    if ((s.match(/�/g) ?? []).length > Math.max(3, s.length / 200)) { s = b.toString("latin1"); encoding = "windows-1252"; }
  }
  if (truncated) s = s.replace(/[^\n]*$/, "");
  return { text: s, truncated, encoding, binary: /[\0-\x08\x0e-\x1f]/.test(s.slice(0, 4000).replace(/[\t\r\n\f\x1b]/g, "")) };
}

let sanitize = null;
const clean = (html) => {
  sanitize ??= require("sanitize-html");
  return sanitize(html, {
    allowedTags: ["h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "b", "strong", "i", "em", "u", "s", "sub", "sup", "ul", "ol", "li", "table", "thead", "tbody", "tr", "td", "th", "img", "a", "blockquote", "pre", "code", "span", "div"],
    allowedAttributes: { img: ["src", "alt"], a: ["href", "title"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"], ol: ["start"] },
    // pictures inside the document only (never fetched from the internet), links shown but kept out of the page
    allowedSchemes: ["http", "https", "mailto"], allowedSchemesByTag: { img: ["data"] },
    transformTags: { a: (tag, attribs) => ({ tagName: "a", attribs: { ...(/^(https?:|mailto:)/i.test(attribs.href ?? "") ? { href: attribs.href, title: attribs.href } : {}), rel: "noopener noreferrer", target: "_blank" } }) },
    allowedSchemesAppliedToAttributes: ["href", "src"],
  });
};
export async function docx(buf) {
  const mammoth = require("mammoth");
  const r = await mammoth.convertToHtml({ buffer: Buffer.from(buf) });
  return { html: clean(r.value), warnings: (r.messages ?? []).length };
}
export function paragraphsHtml(paras) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return paras.map((p) => (p.heading ? `<h3>${esc(p.text)}</h3>` : `<p>${esc(p.text).replace(/\n/g, "<br>")}</p>`)).join("");
}

export function sheet(buf, ext = "xlsx") {
  const XLSX = require("xlsx");
  const opts = { cellDates: true, sheetRows: MAX_ROWS + 1, dense: true };
  const wb = /^(csv|tsv)$/.test(ext) ? XLSX.read(text(buf).text, { ...opts, type: "string", raw: true, FS: ext === "tsv" ? "\t" : undefined }) : XLSX.read(Buffer.from(buf), { ...opts, type: "buffer" });
  const sheets = [];
  for (const name of wb.SheetNames.slice(0, 30)) {
    const ws = wb.Sheets[name];
    const ref = ws?.["!fullref"] ?? ws?.["!ref"];
    let totalRows = null; try { if (ref) { const r = XLSX.utils.decode_range(ref); totalRows = r.e.r - r.s.r + 1; } } catch { /* unknown */ }
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, blankrows: false, defval: "" }).map((r) => r.slice(0, MAX_COLS).map((v) => String(v ?? "").slice(0, 500)));
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    sheets.push({ name, rows: rows.slice(0, MAX_ROWS), cols, totalRows, truncated: (totalRows ?? rows.length) > MAX_ROWS || rows.some((r) => r.length >= MAX_COLS) });
  }
  return { sheets };
}

async function zipOf(buf) { const JSZip = require("jszip"); return JSZip.loadAsync(Buffer.from(buf)); }
const xmlText = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
const paras = (xml) => [...xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)].map((p) => xmlText([...p[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => t[1]).join(""))).map((x) => x.trim()).filter(Boolean);
export async function slides(buf) {
  const zip = await zipOf(buf);
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));
  // the order in the presentation (slides can be reordered without being renamed)
  let order = names;
  try {
    const pres = await zip.file("ppt/presentation.xml")?.async("string"), rels = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
    if (pres && rels) {
      const target = Object.fromEntries([...rels.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], "ppt/" + m[2].replace(/^\/?ppt\//, "").replace(/^\.\.\//, "")]));
      const ids = [...pres.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map((m) => target[m[1]]).filter((n) => names.includes(n));
      if (ids.length === names.length) order = ids;
    }
  } catch { /* the file names' order */ }
  const out = [];
  for (const [k, n] of order.entries()) {
    const num = Number(n.match(/(\d+)\.xml$/)[1]);
    const xml = await zip.file(n).async("string");
    const p = paras(xml);
    const relsXml = await zip.file(`ppt/slides/_rels/slide${num}.xml.rels`)?.async("string") ?? "";
    const rel = Object.fromEntries([...relsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
    const images = [...xml.matchAll(/r:embed="([^"]+)"/g)].map((m) => rel[m[1]]).filter((t) => t && /\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(t)).map((t) => "ppt/" + t.replace(/^\.\.\//, "")).filter((t, i, a) => a.indexOf(t) === i && zip.file(t));
    const notesXml = await zip.file(`ppt/notesSlides/notesSlide${num}.xml`)?.async("string");
    out.push({ n: k + 1, title: p[0] ?? "", paras: p.slice(1), notes: notesXml ? paras(notesXml).filter((x) => !/^\d+$/.test(x)).join("\n") : "", images: images.slice(0, 8) });
  }
  return { slides: out };
}

const sizeOf = (f) => (typeof f?._data?.uncompressedSize === "number" ? f._data.uncompressedSize : null);
export async function zipList(buf) {
  const zip = await zipOf(buf);
  const all = Object.values(zip.files);
  const entries = all.slice(0, MAX_ENTRIES).map((f, i) => ({ i, name: f.name, size: f.dir ? null : sizeOf(f), packed: f.dir ? null : f._data?.compressedSize ?? null, dir: Boolean(f.dir), date: f.date ? new Date(f.date).toISOString() : null }));
  return { entries, total: all.length, truncated: all.length > MAX_ENTRIES };
}
export async function zipEntry(buf, name, { max = MAX_INNER } = {}) {
  const zip = await zipOf(buf);
  const f = zip.file(String(name));
  if (!f || f.dir) throw Object.assign(new Error("That isn't in the archive."), { status: 404 });
  const size = sizeOf(f);
  if (size != null && size > max) throw Object.assign(new Error(`That file is ${Math.round(size / 1048576)} MB inside the archive, too big to open here. Open the archive in the default app instead.`), { status: 413 });
  // a file that claims to be small but isn't (a "zip bomb"): stopped as soon as it passes the limit
  const out = await new Promise((ok, no) => {
    const parts = []; let n = 0;
    const s = f.nodeStream();
    s.on("data", (c) => { n += c.length; if (n > max) { s.pause(); no(Object.assign(new Error("That file is too big inside the archive to open here."), { status: 413 })); return; } parts.push(c); });
    s.on("end", () => ok(Buffer.concat(parts)));
    s.on("error", (e) => no(e));
  });
  return { buf: out, name: basename(f.name) };
}
