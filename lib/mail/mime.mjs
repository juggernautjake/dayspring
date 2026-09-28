// Building the real email (RFC 5322 / MIME) from what's in the editor, with nodemailer's MailComposer: the same bytes go
// to Gmail (raw), Outlook (Graph's MIME send) and any SMTP server, so what's sent is exactly what the editor shows.
//   build(c, { from, keepBcc })  → Buffer        c: { to, cc, bcc, subject, html, attachments: [store ids], inReplyTo, references }
//   inlineImages(html)           → { html, parts }   pictures pasted into the editor (data: URLs) become cid: attachments
//   hashOf(c)                    → the fingerprint a "yes" is bound to (recipients, subject, body, attachments)
// And the attachment store: files the owner added to a message, in memory only (never on disk), until it's sent or gone.
import { createHash, randomBytes } from "node:crypto";
import MailComposer from "nodemailer/lib/mail-composer";
import { toText } from "./sanitize.mjs";

export const MAX_TOTAL = 25 * 1024 * 1024;        // Gmail's limit, and a sane one for everyone else
export const MAX_ONE = 25 * 1024 * 1024;
const sha = (b) => createHash("sha256").update(b).digest("hex");

// ---- addresses ------------------------------------------------------------------------------------------------------------
const EMAIL = /^[^@\s<>(),;:"]+@[^@\s<>(),;:"]+\.[^@\s<>(),;:"]+$/;
export const isEmail = (s) => EMAIL.test(String(s ?? "").trim());
// "Sam Carter <sam@example.com>, bo@example.org" or [..] → [{ name, address }]
export function parseList(v) {
  const items = Array.isArray(v) ? v.flatMap((x) => (typeof x === "object" && x ? [x] : String(x ?? "").split(/[,;](?=(?:[^"]*"[^"]*")*[^"]*$)/))) : String(v ?? "").split(/[,;](?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const out = [];
  for (const it of items) {
    if (it && typeof it === "object") { const a = String(it.address ?? it.email ?? "").trim(); if (a) out.push({ name: String(it.name ?? "").trim(), address: a }); continue; }
    const s = String(it).trim(); if (!s) continue;
    const m = /^(.*?)<([^>]+)>\s*$/.exec(s);
    if (m) out.push({ name: m[1].replace(/^["'\s]+|["'\s]+$/g, ""), address: m[2].trim() });
    else out.push({ name: "", address: s.replace(/^mailto:/i, "") });
  }
  const seen = new Set();
  return out.filter((a) => { const k = a.address.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}
export const fmt = (a) => (a.name ? `${a.name} <${a.address}>` : a.address);
export const fmtList = (l) => (l ?? []).map(fmt).join(", ");

// ---- the attachment store (memory only) ---------------------------------------------------------------------------------
const files = new Map();       // id → { id, name, type, size, sha, buf, at, from }
const TTL = 12 * 60 * 60_000;
function sweep() { const t = Date.now(); for (const [k, v] of files) if (t - v.at > TTL) files.delete(k); }
export function addFile({ name, type, buf, from = "computer" }) {
  sweep();
  if (!Buffer.isBuffer(buf)) throw new Error("No file came through.");
  if (buf.length > MAX_ONE) throw new Error(`That file is ${(buf.length / 1048576).toFixed(1)} MB. Email allows about 25 MB in all; share big files with a Drive link instead.`);
  const clean = String(name || "attachment").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").trim().slice(0, 180) || "attachment";
  const id = "a" + randomBytes(8).toString("hex");
  const f = { id, name: clean, type: String(type || guessType(clean)).slice(0, 100), size: buf.length, sha: sha(buf), buf, at: Date.now(), from };
  files.set(id, f);
  return meta(f);
}
export const meta = (f) => (f ? { id: f.id, name: f.name, type: f.type, size: f.size, sha: f.sha, from: f.from } : null);
export const getFile = (id) => files.get(String(id)) ?? null;
export const dropFile = (id) => files.delete(String(id));
export function clearFiles() { files.clear(); }
const TYPES = { pdf: "application/pdf", txt: "text/plain", csv: "text/csv", htm: "text/html", html: "text/html", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", zip: "application/zip", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", mp4: "video/mp4", mov: "video/quicktime", eml: "message/rfc822", ics: "text/calendar", json: "application/json", md: "text/markdown" };
export const guessType = (name) => TYPES[String(name).toLowerCase().split(".").pop()] ?? "application/octet-stream";
export function totalSize(ids = []) { return ids.reduce((n, id) => n + (files.get(String(id))?.size ?? 0), 0); }

// ---- pictures in the body -------------------------------------------------------------------------------------------------
export function inlineImages(html) {
  const parts = []; let n = 0;
  const out = String(html ?? "").replace(/(<img\b[^>]*?\ssrc=)(["'])(data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+))\2/gi, (m, pre, q, all, type, b64) => {
    const buf = Buffer.from(b64.replace(/\s+/g, ""), "base64");
    const cid = `img${++n}.${sha(buf).slice(0, 12)}@dayspring`;
    parts.push({ cid, contentType: type, content: buf, filename: `image${n}.${type.split("/")[1].replace("jpeg", "jpg").replace(/\+.*$/, "")}`, contentDisposition: "inline" });
    return `${pre}${q}cid:${cid}${q}`;
  });
  return { html: out, parts };
}

// ---- the fingerprint a "yes" is bound to ------------------------------------------------------------------------------------
const addrs = (l) => parseList(l).map((a) => a.address.toLowerCase()).sort();
export function hashOf(c) {
  const body = { account: c.account ?? null, to: addrs(c.to), cc: addrs(c.cc), bcc: addrs(c.bcc), subject: String(c.subject ?? ""), html: String(c.html ?? ""),
    attachments: (c.attachments ?? []).map((id) => { const f = files.get(String(id)); return f ? `${f.name}|${f.size}|${f.sha}` : `missing:${id}`; }).sort(), inReplyTo: c.inReplyTo ?? null };
  return sha(JSON.stringify(body));
}

// ---- the email itself ---------------------------------------------------------------------------------------------------
export async function build(c, { from, keepBcc = true, date = new Date(), messageId = null } = {}) {
  const { html, parts } = inlineImages(c.html ?? "");
  const attachments = [];
  for (const id of c.attachments ?? []) {
    const f = files.get(String(id));
    if (!f) throw new Error("An attachment isn't here anymore (Dayspring may have restarted). Remove it and attach it again.");
    attachments.push(f.type === "message/rfc822" ? { filename: f.name, content: f.buf, contentType: "message/rfc822", contentDisposition: "attachment" } : { filename: f.name, content: f.buf, contentType: f.type });
  }
  const opts = {
    from: from ? fmt(from) : undefined, to: fmtList(parseList(c.to)) || undefined, cc: fmtList(parseList(c.cc)) || undefined, bcc: fmtList(parseList(c.bcc)) || undefined,
    subject: String(c.subject ?? ""), html, text: toText(html), attachments: [...parts, ...attachments], date,
    ...(c.inReplyTo ? { inReplyTo: c.inReplyTo } : {}), ...(c.references ? { references: c.references } : {}), ...(messageId ? { messageId } : {}),
    headers: { "X-Mailer": "Dayspring" },
  };
  const mail = new MailComposer(opts).compile();
  mail.keepBcc = keepBcc;
  return await mail.build();
}
// the envelope for SMTP: every recipient (To, Cc and Bcc)
export const recipients = (c) => [...parseList(c.to), ...parseList(c.cc), ...parseList(c.bcc)].map((a) => a.address);
export const b64url = (buf) => Buffer.from(buf).toString("base64url");
