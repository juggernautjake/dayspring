// Email HTML made safe to show (server side, before it ever reaches a page), plain text for reading aloud and for the AI,
// and the quoted original for replies and forwards.
//   clean(html, { allowRemote, cid })  → { html, blocked, hosts }   sanitize-html with a strict list: no scripts, forms,
//        frames, objects or event handlers; links open in a new window; remote pictures (tracking pixels) are held back
//        (data-blocked-src) unless allowRemote; cid: pictures become the attached picture (data: URL, no network)
//   srcdoc(html, { allowRemote })      → the whole document for <iframe sandbox srcdoc>, with its own Content-Security-
//        Policy (nothing loads but data: pictures, and remote pictures only when shown), so even a slip in the list above
//        can't run anything or phone home
//   toText(html)                       → readable text          quote(msg, kind) → the quoted original (HTML)
import sanitizeHtml from "sanitize-html";

const TAGS = ["a", "abbr", "address", "b", "big", "blockquote", "br", "caption", "center", "cite", "code", "col", "colgroup", "dd", "del", "dfn", "div", "dl", "dt", "em", "font", "h1", "h2", "h3", "h4", "h5", "h6",
  "hr", "i", "img", "ins", "kbd", "li", "mark", "ol", "p", "pre", "q", "s", "samp", "small", "span", "strike", "strong", "style", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "tt", "u", "ul", "wbr", "article", "section", "header", "footer", "main", "figure", "figcaption"];
const COMMON = ["style", "class", "align", "valign", "width", "height", "bgcolor", "color", "border", "dir", "title", "lang", "id"];
const REMOTE = /^\s*(https?:)?\/\//i;
const SAFE_DATA_IMG = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i;
// CSS that could run anything or reach the network: url(…), @import, expression(), behaviour, -moz-binding
const cssClean = (css, allowRemote) => {
  let s = String(css ?? "").replace(/expression\s*\(|behaviou?r\s*:|-moz-binding|javascript:/gi, "x-blocked:").replace(/@import[^;]*;?/gi, "");
  s = s.replace(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, q, u) => (/^data:image\//i.test(u) || (allowRemote && REMOTE.test(u)) ? m : "none"));
  return s;
};

export function clean(html, { allowRemote = false, cid = null } = {}) {
  let blocked = 0; const hosts = new Set();
  const hostOf = (u) => { try { return new URL(u.startsWith("//") ? "https:" + u : u).hostname; } catch { return ""; } };
  const out = sanitizeHtml(String(html ?? ""), {
    allowedTags: TAGS, allowVulnerableTags: true,
    allowedAttributes: { "*": COMMON, a: [...COMMON, "href", "name", "target", "rel"], img: [...COMMON, "src", "alt", "data-blocked-src", "data-cid"], td: [...COMMON, "colspan", "rowspan", "nowrap"], th: [...COMMON, "colspan", "rowspan", "nowrap", "scope"],
      table: [...COMMON, "cellpadding", "cellspacing", "summary"], font: [...COMMON, "face", "size"], col: [...COMMON, "span"], colgroup: [...COMMON, "span"], ol: [...COMMON, "start", "type"], li: [...COMMON, "value"] },
    allowedSchemes: ["http", "https", "mailto", "tel"], allowedSchemesByTag: { img: ["http", "https", "data", "cid"] }, allowProtocolRelative: true,
    nonTextTags: ["script", "textarea", "option", "noscript", "title", "head", "iframe", "object", "embed", "svg", "math", "template", "form", "select", "button"],
    textFilter: (text, tag) => (tag === "style" ? cssClean(text, allowRemote) : text),
    transformTags: {
      "*": (tagName, attribs) => {
        const a = { ...attribs };
        if (a.style) a.style = cssClean(a.style, allowRemote);
        if (tagName === "a") { a.target = "_blank"; a.rel = "noopener noreferrer"; }
        if (tagName === "img") {
          const src = String(a.src ?? "").trim();
          if (/^cid:/i.test(src)) { const id = src.slice(4).replace(/^<|>$/g, "").toLowerCase(); const d = cid?.get?.(id); if (d) a.src = d; else { a["data-cid"] = id; delete a.src; } }
          else if (/^data:/i.test(src)) { if (!SAFE_DATA_IMG.test(src)) delete a.src; }
          else if (REMOTE.test(src)) { if (!allowRemote) { blocked++; const h = hostOf(src); if (h) hosts.add(h); a["data-blocked-src"] = src; delete a.src; if (!a.alt) a.alt = ""; } }
          else delete a.src;
        }
        return { tagName, attribs: a };
      },
    },
  });
  // (the text of a <style> block isn't a text node to sanitize-html: its CSS is cleaned here)
  const html2 = out.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, a, css, b) => a + cssClean(css, allowRemote).replace(/<\/?[a-z]/gi, "") + b);
  return { html: html2, blocked, hosts: [...hosts].slice(0, 20) };
}

const escHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const escape = escHtml;
// the document the reader's sandboxed frame shows
export function srcdoc(html, { allowRemote = false, dark = false } = {}) {
  const csp = `default-src 'none'; img-src data:${allowRemote ? " https: http:" : ""}; style-src 'unsafe-inline'; font-src data:; media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><base target="_blank">`
    + `<style>html{color-scheme:${dark ? "dark" : "light"}}body{margin:0;padding:14px 16px;font:15px/1.5 Arial,Helvetica,sans-serif;color:#1c1e21;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}img[data-blocked-src]{display:inline-block;min-width:16px;min-height:16px;background:#eceff4;outline:1px dashed #b0b8c8}blockquote{margin:0 0 0 .8ex;border-left:2px solid #c8cdd8;padding-left:1ex;color:#444}pre{white-space:pre-wrap}table{max-width:100%}</style></head><body>${html}</body></html>`;
}
// plain text (reading aloud, the AI, the text-only view)
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™", bull: "•", middot: "·", zwnj: "", zwj: "" };
export const decode = (s) => String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === "#" ? (() => { try { return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))); } catch { return ""; } })() : ENT[e.toLowerCase()] ?? m));
export function toText(html) {
  return decode(String(html ?? "")
    .replace(/<(style|script|head|title)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|h[1-6]|tr|table|blockquote|ul|ol|pre|section|article|header|footer)>/gi, "\n")
    .replace(/<hr[^>]*>/gi, "\n———\n")
    .replace(/<a [^>]*href=["'](https?:[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, t) => { const text = t.replace(/<[^>]+>/g, "").trim(); return text && text !== href && !/^https?:/.test(text) ? `${text} (${href})` : href; })
    .replace(/<[^>]+>/g, ""))
    .replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
// plain text → simple HTML (paragraphs and line breaks)
export function textToHtml(text) {
  return String(text ?? "").replace(/\r/g, "").split(/\n{2,}/).map((p) => `<p>${escHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
}
// The original, quoted under a reply or a forward (HTML the editor can take: paragraphs inside a blockquote)
export function quote(m, kind = "reply") {
  const when = m.date ? new Date(m.date).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "";
  const body = textToHtml(m.text || toText(m.html) || "");
  if (kind === "forward") {
    const lines = [`---------- Forwarded message ---------`, `From: ${m.fromText ?? ""}`, `Date: ${when}`, `Subject: ${m.subject ?? ""}`, `To: ${m.toText ?? ""}`, ...(m.ccText ? [`Cc: ${m.ccText}`] : [])];
    return `<p><br></p><p>${lines.map(escHtml).join("<br>")}</p>${body}`;
  }
  return `<p><br></p><p>On ${escHtml(when)}, ${escHtml(m.fromText ?? "")} wrote:</p><blockquote>${body}</blockquote>`;
}
