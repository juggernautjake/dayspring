// Email in Dayspring: every mailbox the owner connected (Gmail and Outlook by their sign-ins, anything else by IMAP + SMTP),
// read, searched and organized in one place, and emails written in the editor on the Dayspring screen.
//
// Mailboxes are "adapters" with one shape (lib/mail/gmail.mjs, outlook.mjs, imap.mjs), known by a key: "g:g1" (a Google
// account), "ms" (Outlook), "i:m1" (an IMAP mailbox). A message's id is "<key>~<the provider's id>".
//
// SENDING. Nothing is ever sent unless the owner himself asks, and only from a mailbox where he turned sending on:
//   · the Send button in the editor (his click: the route makes a token that's approved as it's made), or
//   · his clear yes, said on the Dayspring screen, after Dayspring read back the recipients and subject (email_send asks
//     first; lib/confirm.mjs only counts a yes from the screen, never from a call, a meeting, a text or Discord).
// Either way the token is bound to a fingerprint of the exact message (recipients, subject, body, attachments), so any
// edit after the question means asking again; the AI can't approve anything. A sent message waits a few seconds first
// ("Undo send"), the number of sends is limited, and each send is in the activity log with only its To/Cc and subject.
// Email bodies never go in the activity log, and go to the AI only when the owner asks something that needs them.
import { simpleParser } from "mailparser";
import { randomBytes } from "node:crypto";
import * as google from "../connectors/google.mjs";
import * as microsoft from "../connectors/microsoft.mjs";
import * as store from "../connectors/store.mjs";
import * as imap from "./imap.mjs";
import * as gmailA from "./gmail.mjs";
import * as outlookA from "./outlook.mjs";
import * as settings from "./settings.mjs";
import * as mime from "./mime.mjs";
import * as san from "./sanitize.mjs";
import * as presets from "./presets.mjs";
import * as confirm from "../confirm.mjs";
import * as activity from "../activity.mjs";
import { broadcast } from "../bus.mjs";
import * as feature from "./feature.mjs";

export { settings, mime, san, presets, imap, feature };
const plural = (n, w, ws = w + "s") => `${n} ${n === 1 ? w : ws}`;

// ---- mailboxes ----------------------------------------------------------------------------------------------------------
export function boxes() {
  const out = [];
  try { for (const a of google.accountsFor("gmail")) out.push(gmailA.adapter(a)); } catch { /* not set up */ }
  try { if (microsoft.connected()) out.push(outlookA.adapter()); } catch { /* not set up */ }
  try { for (const a of imap.accounts()) out.push(imap.adapter(a)); } catch { /* not set up */ }
  // (a Gmail mailbox's nickname is its Google account's, "Work", unless one is set in Settings → Email)
  for (const b of out) { const s = settings.box(b.key); b.nickname = s.nickname || b.nickname || ""; b.color = s.color ?? settings.COLOR_LIST[out.indexOf(b) % settings.COLOR_LIST.length]; b.label = s.nickname || b.email; }
  return out;
}
export const connected = () => boxes().length > 0;
export function primaryKey(list = boxes()) {
  const p = settings.primary();
  if (p && list.some((b) => b.key === p)) return p;
  const gp = google.status().primary;
  return list.find((b) => b.key === "g:" + gp)?.key ?? list[0]?.key ?? null;
}
// "work", "yahoo", "sam@example.com", "i:m1", "all" → the mailbox (or null)
export function findBox(want, list = boxes()) {
  if (!want) return null;
  const w = String(want).toLowerCase().replace(/\b(my|the|email|e-mail|mail|inbox|account|mailbox)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!w) return null;
  return list.find((b) => b.key.toLowerCase() === w) ?? list.find((b) => b.email.toLowerCase() === w) ?? list.find((b) => b.nickname && b.nickname.toLowerCase() === w)
    ?? list.find((b) => b.email.toLowerCase().split("@")[0] === w) ?? list.find((b) => b.kind === w || (w === "google" && b.kind === "gmail") || ((w === "hotmail" || w === "microsoft") && b.kind === "outlook"))
    ?? list.find((b) => (b.nickname && b.nickname.toLowerCase().includes(w)) || b.email.toLowerCase().includes(w)) ?? list.find((b) => b.kind === "imap" && (b.account?.preset === w || presets.findPreset(w) === b.account?.preset)) ?? null;
}
export function box(want = null) {
  const list = boxes();
  if (!list.length) throw Object.assign(new Error("No email account is connected yet. Add one in Settings → Email (Gmail, Outlook, Yahoo, iCloud or any other)."), { code: "not_connected" });
  if (!want || want === "primary") return list.find((b) => b.key === primaryKey(list));
  const b = findBox(want, list);
  if (!b) throw Object.assign(new Error(`I don't have a ${list.every((x) => x.kind === "gmail") ? "Google account" : "mailbox"} called "${want}". Connected: ${list.map((x) => x.label).join(", ")}.`), { code: "no_account" });
  return b;
}
export const publicBox = (b, primary) => ({ key: b.key, kind: b.kind, email: b.email, label: b.label, nickname: b.nickname, color: b.color, primary: b.key === primary, canSend: b.canSend, canOrganize: b.canOrganize,
  provider: b.kind === "gmail" ? "Gmail" : b.kind === "outlook" ? "Outlook" : presets.PRESETS[b.account?.preset]?.name ?? "Email" });
export function status() {
  const list = boxes(), p = primaryKey(list);
  return { id: "mail", connected: list.length > 0, who: list.length ? `${plural(list.length, "mailbox", "mailboxes")}${list.length === 1 ? ` (${list[0].email})` : ""}` : null, boxes: list.map((b) => publicBox(b, p)),
    imap: imap.accounts().map(imap.publicAccount), primary: p };
}

// ---- ids ------------------------------------------------------------------------------------------------------------------
export const uidOf = (key, local) => `${key}~${local}`;
export function parseUid(u) {
  const s = String(u ?? ""), i = s.indexOf("~");
  if (i > 0) return { key: s.slice(0, i), local: s.slice(i + 1) };
  const key = rawIds.get(s);
  if (key) return { key, local: s };
  return { key: null, local: s };
}
const rawIds = new Map();       // Gmail/Outlook ids as the AI sees them → their mailbox
const metaCache = new Map();    // uid → the list row (flags, subject…)
const remember = (m, k, v, max = 4000) => { m.set(k, v); if (m.size > max) m.delete(m.keys().next().value); };
// what the AI gets as an id: the provider's own id for Gmail/Outlook (unique on their own), the full id for IMAP
export const toolId = (uid) => { const { key, local } = parseUid(uid); return key && !key.startsWith("i:") ? local : uid; };
function boxOfUid(u) {
  const { key, local } = parseUid(u);
  const list = boxes();
  const b = key ? list.find((x) => x.key === key) : list.find((x) => x.key === primaryKey(list) && x.kind !== "imap") ?? list.find((x) => x.kind !== "imap");
  if (!b) throw Object.assign(new Error("That email's mailbox isn't connected anymore."), { code: "no_account" });
  return { b, local, uid: uidOf(b.key, local) };
}

// ---- contacts: people he's written to or heard from, and Dayspring's people (if they have an email) ------------------------
function contactData() { const d = store.load("mail-contacts"); d.list ??= []; return d; }
export function noteContacts(list, { sent = false } = {}) {
  const add = (list ?? []).filter((a) => a?.address && mime.isEmail(a.address));
  if (!add.length) return;
  const d = contactData(), mine = new Set(boxes().map((b) => b.email.toLowerCase()));
  for (const a of add) {
    const k = a.address.toLowerCase(); if (mine.has(k) || /no-?reply|do-?not-?reply|mailer-daemon|notifications?@/i.test(k)) continue;
    let c = d.list.find((x) => x.address === k);
    if (!c) { c = { address: k, name: "", n: 0, last: 0, sent: false }; d.list.push(c); }
    if (a.name && (!c.name || sent)) c.name = String(a.name).slice(0, 80);
    c.n++; c.last = Date.now(); if (sent) c.sent = true;
  }
  d.list.sort((x, y) => y.last - x.last); d.list = d.list.slice(0, 3000);
  store.save("mail-contacts", d);
}
async function peopleWithEmail() {
  if (process.env.DAYSPRING_MAIL_PEOPLE === "0") return [];
  try { const sp = await import("../special.mjs"); return sp.people().flatMap((p) => [p.email, ...(p.emails ?? [])].filter((e) => e && mime.isEmail(e)).map((e) => ({ name: p.name, address: String(e).toLowerCase(), people: true }))); } catch { return []; }
}
export async function contacts(q = "", limit = 8) {
  const w = String(q ?? "").toLowerCase().trim();
  const all = [...(await peopleWithEmail()), ...contactData().list];
  const seen = new Set(), out = [];
  const score = (c) => { const n = c.name.toLowerCase(), a = c.address; if (!w) return 1; if (n === w || a === w) return 5; if (n.split(/\s+/).some((p) => p.startsWith(w)) || a.startsWith(w)) return 3 + (c.sent ? 1 : 0) + (c.people ? 1 : 0); if (n.includes(w) || a.includes(w)) return 1; return 0; };
  for (const c of all.map((c) => ({ ...c, name: c.name ?? "" })).map((c) => ({ c, s: score(c) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s || (y.c.last ?? 0) - (x.c.last ?? 0))) {
    if (seen.has(c.c.address)) continue; seen.add(c.c.address); out.push({ name: c.c.name, address: c.c.address, sent: Boolean(c.c.sent), people: Boolean(c.c.people) });
    if (out.length >= limit) break;
  }
  return out;
}
export const isKnown = (addr) => { const a = String(addr ?? "").toLowerCase(); return contactData().list.some((c) => c.address === a && c.sent) || settings.imagesAllowed(a); };
// "Sam" → sam@example.com when there's exactly one good match (else null, and the editor asks)
export async function resolveName(name) {
  if (mime.isEmail(name)) return { address: String(name).trim(), name: "" };
  const c = await contacts(name, 5);
  const w = String(name).toLowerCase().trim();
  const exact = c.filter((x) => x.name.toLowerCase() === w || x.name.toLowerCase().split(/\s+/)[0] === w);
  if (exact.length === 1) return exact[0];
  if (c.length === 1) return c[0];
  return null;
}

// ---- listing ----------------------------------------------------------------------------------------------------------------
let lastList = { at: 0, messages: [] };
export const lastListed = () => (Date.now() - lastList.at < 15 * 60_000 ? lastList.messages : []);
export async function list({ account = null, folder = "inbox", query = "", unread = false, from = "", limit = 30 } = {}) {
  const all = boxes();
  if (!all.length) throw Object.assign(new Error("No email account is connected yet. Add one in Settings → Email."), { code: "not_connected" });
  const targets = account === "all" ? all : [box(account)];
  const errors = [], rows = [];
  await Promise.all(targets.map(async (b) => {
    try {
      const r = await b.list({ folder, query, unread, from, limit });
      for (const m of r) {
        const uid = uidOf(b.key, m.id);
        const row = { ...m, id: uid, local: m.id, account: b.key, accountLabel: b.label, color: b.color, kind: b.kind };
        remember(metaCache, uid, row); if (b.kind !== "imap") remember(rawIds, m.id, b.key);
        rows.push(row);
      }
    } catch (e) { errors.push({ account: b.key, label: b.label, error: e.message }); }
  }));
  rows.sort((x, y) => y.date.localeCompare(x.date));
  const out = rows.slice(0, limit);
  noteContacts(out.map((m) => m.from));
  lastList = { at: Date.now(), messages: out };
  return { messages: out, errors, folder, account: account === "all" ? "all" : targets[0]?.key };
}
export async function folders(account = null) { const b = box(account); return { account: b.key, folders: await b.folders() }; }
const unreadCache = { at: 0, v: null };
export async function unreadCounts({ fresh = false } = {}) {
  if (!fresh && unreadCache.v && Date.now() - unreadCache.at < 60_000) return unreadCache.v;
  const out = { total: 0, boxes: {} };
  await Promise.all(boxes().map(async (b) => { const n = await b.unread().catch(() => 0); out.boxes[b.key] = n; out.total += n; }));
  unreadCache.at = Date.now(); unreadCache.v = out;
  return out;
}

// ---- reading ----------------------------------------------------------------------------------------------------------------
const parsed = new Map();   // uid → { msg, at } (a few recent ones, in memory only)
const addrList = (x) => (Array.isArray(x) ? x : x ? [x] : []).flatMap((o) => o.value ?? []).flatMap((v) => (v.group ? v.group : [v])).map((v) => ({ name: v.name ?? "", address: v.address ?? "" })).filter((v) => v.address);
export async function parseRaw(buf) {
  const m = await simpleParser(buf, { skipImageLinks: true, skipTextLinks: true, keepCidLinks: true });
  return { from: addrList(m.from)[0] ?? { name: "", address: "" }, to: addrList(m.to), cc: addrList(m.cc), replyTo: addrList(m.replyTo), subject: m.subject ?? "", date: (m.date ?? new Date()).toISOString(),
    messageId: m.messageId ?? null, inReplyTo: m.inReplyTo ?? null, references: Array.isArray(m.references) ? m.references.join(" ") : m.references ?? null, listUnsubscribe: m.headers?.get?.("list-unsubscribe") ? String(m.headers.get("list-unsubscribe")?.url ?? m.headers.get("list-unsubscribe")?.mail ?? "") : null,
    html: typeof m.html === "string" ? m.html : "", text: m.text ?? "",
    attachments: (m.attachments ?? []).map((a, idx) => ({ idx, name: a.filename || (a.contentType === "message/rfc822" ? "message.eml" : a.cid ? String(a.cid).split("@")[0] : "attachment"), type: a.contentType ?? "application/octet-stream", size: a.size ?? a.content?.length ?? 0, cid: a.cid ? String(a.cid).replace(/[<>]/g, "").toLowerCase() : null, inline: a.contentDisposition === "inline" || Boolean(a.related), _buf: a.content })) };
}
async function load(uid) {
  const { b, local, uid: full } = boxOfUid(uid);
  const hit = parsed.get(full); if (hit && Date.now() - hit.at < 10 * 60_000) return { b, local, uid: full, msg: hit.msg };
  let msg;
  if (b.read) msg = await b.read(local);
  else { const buf = await b.raw(local); msg = { ...(metaCache.get(full) ?? {}), ...(await parseRaw(buf)) }; if (b.meta && !metaCache.get(full)) { try { const mm = await b.meta(local); msg = { ...mm, ...msg, unread: mm.unread, starred: mm.starred, threadId: mm.threadId }; } catch { /* flags unknown */ } } }
  const meta = metaCache.get(full) ?? {};
  msg = { ...msg, unread: msg.unread ?? meta.unread ?? false, starred: msg.starred ?? meta.starred ?? false, threadId: msg.threadId ?? meta.threadId ?? null };
  parsed.set(full, { msg, at: Date.now() }); if (parsed.size > 30) parsed.delete(parsed.keys().next().value);
  return { b, local, uid: full, msg };
}
const who = (a) => (a?.name ? `${a.name} <${a.address}>` : a?.address ?? "");
// read(uid, { images, markRead }) → everything the reader shows, made safe; images: true shows remote pictures this once
export async function read(uid, { images = false, markRead = false } = {}) {
  const { b, local, uid: full, msg } = await load(uid);
  const p = settings.prefs(), sender = msg.from?.address?.toLowerCase() ?? "";
  const allowRemote = images === true || (p.remoteImages !== "never" && settings.imagesAllowed(sender)) || (p.remoteImages === "known" && isKnown(sender));
  // pictures inside the email (cid:) become data: URLs here, so nothing is fetched by the page
  const cid = new Map();
  for (const a of msg.attachments ?? []) {
    if (!a.cid || !/^image\//.test(a.type) || (a.size ?? 0) > 3 * 1024 * 1024) continue;
    try { const buf = a._buf ?? (b.attachment ? await b.attachment(local, a) : null); if (buf) { a._buf = buf; cid.set(a.cid, `data:${a.type};base64,${buf.toString("base64")}`); } } catch { /* shows as a box */ }
  }
  const c = san.clean(msg.html || san.textToHtml(msg.text), { allowRemote, cid });
  if (markRead && p.markReadOnOpen && msg.unread && b.canOrganize) { b.mark(local, { read: true }).then(() => { msg.unread = false; const r = metaCache.get(full); if (r) r.unread = false; unreadCache.at = 0; }).catch(() => {}); }
  noteContacts([msg.from, ...(msg.cc ?? [])]);
  return { id: full, account: b.key, accountLabel: b.label, color: b.color, canOrganize: b.canOrganize, canSend: b.canSend, threadId: msg.threadId ?? null,
    from: msg.from, fromText: who(msg.from), to: msg.to ?? [], toText: (msg.to ?? []).map(who).join(", "), cc: msg.cc ?? [], ccText: (msg.cc ?? []).map(who).join(", "), replyTo: msg.replyTo ?? [],
    subject: msg.subject ?? "", date: msg.date, unread: Boolean(msg.unread), starred: Boolean(msg.starred), messageId: msg.messageId ?? null, references: msg.references ?? null,
    html: c.html, doc: san.srcdoc(c.html, { allowRemote }), blocked: c.blocked, blockedHosts: c.hosts, imagesShown: allowRemote, senderAllowed: settings.imagesAllowed(sender),
    text: (msg.text || san.toText(msg.html)).replace(/\r/g, "").slice(0, 60_000), listUnsubscribe: msg.listUnsubscribe ?? null,
    attachments: (msg.attachments ?? []).filter((a) => !(a.inline && a.cid && cid.has(a.cid))).map((a) => ({ idx: a.idx, name: a.name, type: a.type, size: a.size, inline: Boolean(a.inline) })) };
}
export async function thread(uid) {
  const { b, local, msg } = await load(uid);
  if (!b.thread) return { messages: [] };
  const ids = (await b.thread(local, msg.subject, msg.threadId).catch(() => [local])).slice(-12);
  const out = [];
  for (const id of ids) { try { const r = await read(uidOf(b.key, id)); out.push({ id: r.id, from: r.from, fromText: r.fromText, date: r.date, subject: r.subject, snippet: r.text.replace(/\s+/g, " ").slice(0, 160), unread: r.unread }); } catch { /* gone */ } }
  return { messages: out.sort((x, y) => String(x.date).localeCompare(String(y.date))) };
}
export async function attachment(uid, idx) {
  const { b, local, msg } = await load(uid);
  const a = (msg.attachments ?? []).find((x) => x.idx === Number(idx));
  if (!a) throw Object.assign(new Error("That attachment isn't in this email."), { status: 404 });
  const buf = a._buf ?? (b.attachment ? await b.attachment(local, a) : null);
  if (!buf) throw new Error("That attachment couldn't be downloaded.");
  return { name: a.name, type: a.type, buf };
}
// the whole email as a .eml file (attaching an email, forwarding as an attachment)
export async function rawOf(uid) {
  const { b, local, msg } = await load(uid);
  const buf = await b.raw(local);
  return { name: `${(msg.subject || "email").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80).trim() || "email"}.eml`, buf };
}

// ---- organizing ---------------------------------------------------------------------------------------------------------
// act(uid, action, { folder }) — read, unread, star, unstar, archive, trash (Trash only, restorable), move, inbox.
// Trash always needs the owner's OK first: from the screen his confirm click (confirmed: true), from the AI a token.
export async function act(uid, action, { folder = null, confirmed = false } = {}) {
  const { b, local, uid: full } = boxOfUid(uid);
  if (!b.canOrganize) throw Object.assign(new Error(`Dayspring can't change mail in ${b.label} yet. Turn on “Let Dayspring organize this mailbox” in Settings → Email.`), { code: "organize_off" });
  if (action === "trash" && !confirmed) throw Object.assign(new Error("Moving to Trash needs your OK first."), { code: "needs_confirm" });
  let r;
  switch (action) {
    case "read": r = await b.mark(local, { read: true }); break;
    case "unread": r = await b.mark(local, { read: false }); break;
    case "star": r = await b.mark(local, { starred: true }); break;
    case "unstar": r = await b.mark(local, { starred: false }); break;
    case "archive": r = await b.archive(local); break;
    case "trash": r = await b.trash(local); break;
    case "inbox": r = await b.moveTo(local, "inbox"); break;
    case "move": if (!folder) throw new Error("Which folder?"); r = await b.moveTo(local, folder); break;
    default: throw new Error("I don't know that action.");
  }
  const row = metaCache.get(full);
  if (row) { if (action === "read" || action === "unread") row.unread = action === "unread"; if (action === "star" || action === "unstar") row.starred = action === "star"; }
  parsed.delete(full); unreadCache.at = 0;
  if (["archive", "trash", "move", "inbox"].includes(action)) activity.log("mail." + action, { account: b.email, folder: folder ?? undefined, subject: row?.subject ?? undefined, recoverable: action === "trash" ? "the mailbox's Trash" : undefined });
  broadcast("mail", { kind: "changed", id: full, action });
  return { ok: true, id: r?.id ? uidOf(b.key, r.id) : full, action };
}

// ---- composing ------------------------------------------------------------------------------------------------------------
// A message being written: kept here (in memory) and in the provider's Drafts (auto-saved), shown in the editor window.
const composes = new Map();
const newId = () => "c" + randomBytes(6).toString("hex");
const escHtml = san.escape;
function senderName(b) {
  if (process.env.DAYSPRING_MAIL_SENDER_NAME) return process.env.DAYSPRING_MAIL_SENDER_NAME;
  return b.kind === "imap" ? b.account?.name || "" : "";
}
export const fromOf = (b) => ({ name: senderName(b), address: b.email });
function sigBlock(key, reply) { const s = settings.signatureFor(key, { reply }); return s ? `<p><br></p>${s}` : ""; }
export function publicCompose(c) {
  if (!c) return null;
  const b = boxes().find((x) => x.key === c.account);
  return { id: c.id, account: c.account, accountLabel: b?.label ?? c.account, from: b ? who(fromOf(b)) : "", to: c.to, cc: c.cc, bcc: c.bcc, subject: c.subject, html: c.html, rev: c.rev, kind: c.kind,
    attachments: c.attachments.map((id) => mime.meta(mime.getFile(id)) ?? { id, name: "(missing)", size: 0, missing: true }), draftId: c.draft?.id ?? null, savedAt: c.draft?.at ?? null,
    replyTo: c.replyToUid ?? null, canSend: Boolean(b?.canSend), unresolved: c.unresolved ?? [], updatedAt: c.updatedAt, by: c.by };
}
export const getCompose = (id) => composes.get(String(id)) ?? null;
export const composeList = () => [...composes.values()].map(publicCompose);
const cleanList = (v) => mime.fmtList(mime.parseList(v));
export function newCompose({ account = null, to = "", cc = "", bcc = "", subject = "", html = null, text = null, attachments = [], by = "owner", kind = "new", signature = true, inReplyTo = null, references = null, threadId = null, replyToUid = null, unresolved = [] } = {}) {
  const b = box(account);
  const body = html != null ? String(html) : text != null ? san.textToHtml(text) : "<p><br></p>";
  const c = { id: newId(), account: b.key, to: cleanList(to), cc: cleanList(cc), bcc: cleanList(bcc), subject: String(subject ?? "").slice(0, 400), html: body + (signature && kind === "new" ? sigBlock(b.key, false) : ""),
    attachments: [...attachments], inReplyTo, references, threadId, replyToUid, kind, by, unresolved, rev: 1, createdAt: Date.now(), updatedAt: Date.now(), draft: null };
  composes.set(c.id, c);
  return c;
}
// reply, reply all, forward (with the quoted original); asAttachment: forward the whole email as a .eml attachment
export async function startReply(uid, { mode = "reply", asAttachment = false, account = null, text = null, html = null, by = "owner" } = {}) {
  const r = await read(uid);
  const b = account ? box(account) : boxes().find((x) => x.key === r.account) ?? box();
  const mine = new Set(boxes().map((x) => x.email.toLowerCase()));
  const re = (s) => (/^\s*re:/i.test(s) ? s : `Re: ${s}`), fw = (s) => (/^\s*(fwd?|fw):/i.test(s) ? s : `Fwd: ${s}`);
  let to = [], cc = [];
  if (mode === "reply" || mode === "replyAll") {
    to = r.replyTo?.length ? r.replyTo : [r.from];
    if (mode === "replyAll") { cc = [...r.to, ...r.cc].filter((a) => !mine.has(a.address.toLowerCase()) && !to.some((t) => t.address.toLowerCase() === a.address.toLowerCase())); }
    to = to.filter((a) => !mine.has(a.address.toLowerCase()) || to.length === 1);
  }
  const p = settings.prefs(), reply = mode !== "forward";
  const mineText = html != null ? String(html) : text != null ? san.textToHtml(text) : "<p><br></p>";
  const sig = sigBlock(b.key, reply);
  const atts = [];
  if (mode === "forward" && asAttachment) { const e = await rawOf(uid); atts.push(mime.addFile({ name: e.name, type: "message/rfc822", buf: e.buf, from: "email" }).id); }
  else if (mode === "forward") for (const a of r.attachments) { try { const f = await attachment(uid, a.idx); atts.push(mime.addFile({ name: f.name, type: f.type, buf: f.buf, from: "email" }).id); } catch { /* skipped */ } }
  const q = asAttachment ? "" : san.quote(r, reply ? "reply" : "forward");
  const body = p.replyStyle === "below" && reply ? `${q}${mineText}${sig}` : `${mineText}${sig}${q}`;
  return newCompose({ account: b.key, to: mime.fmtList(to), cc: mime.fmtList(cc), subject: reply ? re(r.subject) : fw(r.subject), html: body, attachments: atts, by, kind: mode, signature: false,
    inReplyTo: reply ? r.messageId : null, references: reply ? [r.references, r.messageId].filter(Boolean).join(" ") : null, threadId: reply ? r.threadId : null, replyToUid: r.id });
}
// the editor's autosave, or a change the AI made: returns the new version (rev)
export function updateCompose(id, patch = {}, { by = "owner", note = "" } = {}) {
  const c = composes.get(String(id));
  if (!c) throw Object.assign(new Error("That email isn't open anymore."), { status: 404 });
  const before = { to: c.to, cc: c.cc, bcc: c.bcc, subject: c.subject, html: c.html, attachments: [...c.attachments], account: c.account };
  if (patch.account !== undefined) c.account = box(patch.account).key;
  for (const k of ["to", "cc", "bcc"]) if (patch[k] !== undefined) c[k] = cleanList(patch[k]);
  if (patch.subject !== undefined) c.subject = String(patch.subject ?? "").slice(0, 400);
  if (patch.html !== undefined) c.html = String(patch.html ?? "");
  if (Array.isArray(patch.attachments)) c.attachments = patch.attachments.map(String).filter((x) => mime.getFile(x));
  if (patch.unresolved !== undefined) c.unresolved = patch.unresolved;
  const changed = JSON.stringify(before) !== JSON.stringify({ to: c.to, cc: c.cc, bcc: c.bcc, subject: c.subject, html: c.html, attachments: c.attachments, account: c.account });
  if (changed) { c.rev++; c.updatedAt = Date.now(); c.by = by; c.dirty = true; }
  if (by === "ai" && changed) broadcast("mail", { kind: "edit", compose: publicCompose(c), before, note });
  return publicCompose(c);
}
export async function saveDraft(id) {
  const c = composes.get(String(id)); if (!c) throw Object.assign(new Error("That email isn't open anymore."), { status: 404 });
  // one save at a time (a send waits for it, so the draft it leaves behind is the one removed)
  const prev = c.saving ?? Promise.resolve();
  const run = prev.catch(() => {}).then(() => saveNow(c));
  c.saving = run;
  try { return await run; } finally { if (c.saving === run) c.saving = null; }
}
async function saveNow(c) {
  const b = box(c.account);
  const buf = await mime.build(c, { from: fromOf(b), keepBcc: true });
  // a draft saved in another mailbox (the From changed) is removed from that one
  if (c.draft && c.draft.account !== b.key) { const ob = boxes().find((x) => x.key === c.draft.account); await ob?.deleteDraft(c.draft.id).catch(() => {}); c.draft = null; }
  const r = await b.saveDraft(buf, { replaceId: c.draft?.id ?? null, threadId: c.threadId });
  c.draft = { id: r.draftId, account: b.key, at: Date.now(), rev: c.rev }; c.dirty = false;
  return { saved: true, draftId: r.draftId, at: c.draft.at, where: `${b.label}'s Drafts` };
}
// open a draft that's in a mailbox's Drafts folder in the editor
export async function openDraft(uid) {
  const r = await read(uid);
  const { b, local } = boxOfUid(uid);
  const draftId = b.kind === "gmail" ? await b.draftIdFor(local).catch(() => null) : local;
  const src = await load(uid);
  const atts = [];
  for (const a of src.msg.attachments ?? []) { if (a.inline && a.cid) continue; try { const f = await attachment(uid, a.idx); atts.push(mime.addFile({ name: f.name, type: f.type, buf: f.buf, from: "email" }).id); } catch { /* skipped */ } }
  const c = newCompose({ account: b.key, to: r.toText, cc: r.ccText, subject: r.subject, html: src.msg.html || san.textToHtml(src.msg.text), attachments: atts, signature: false, kind: "draft", inReplyTo: src.msg.inReplyTo ?? null, references: src.msg.references ?? null, threadId: r.threadId });
  if (draftId) c.draft = { id: draftId, account: b.key, at: Date.now(), rev: c.rev };
  return c;
}
export async function discard(id) {
  const c = composes.get(String(id)); if (!c) return { ok: true };
  if (c.draft) { const b = boxes().find((x) => x.key === c.draft.account); await b?.deleteDraft(c.draft.id).catch(() => {}); }
  composes.delete(c.id);
  broadcast("mail", { kind: "closed", composeId: c.id });
  return { ok: true, discarded: true };
}
export const closeCompose = (id) => composes.delete(String(id));

// ---- sending --------------------------------------------------------------------------------------------------------------
const SCREEN = ["tv", "desk"];                 // where a spoken or typed yes counts for sending
export const RATE = { perTenMinutes: 10, perDay: 60, recipients: 50 };
let sent = [];                                 // times of sends (queued ones count)
const outbox = new Map();                      // oid → { oid, composeId, snap, timer, sendAt }
const undoMs = () => (process.env.DAYSPRING_MAIL_UNDO_MS != null ? Number(process.env.DAYSPRING_MAIL_UNDO_MS) : settings.prefs().undoSeconds * 1000);
const opFor = (c) => ({ tool: "email_send", compose: c.id, hash: mime.hashOf(c) });
function problems(c) {
  const b = boxes().find((x) => x.key === c.account);
  if (!b) return "That mailbox isn't connected anymore. Pick another one in From.";
  if (!b.canSend) return `Sending isn't turned on for ${b.label}. Turn on “Let Dayspring send email from this account” in Settings → Email.`;
  if ((c.unresolved ?? []).length) return `I still need an email address for ${c.unresolved.join(" and ")}.`;
  const rc = mime.recipients(c);
  if (!rc.length) return "Who should it go to? Add someone in To.";
  const bad = rc.filter((a) => !mime.isEmail(a));
  if (bad.length) return `These aren't email addresses: ${bad.join(", ")}.`;
  if (rc.length > RATE.recipients) return `That's ${rc.length} recipients; Dayspring sends to at most ${RATE.recipients} at once.`;
  const size = mime.totalSize(c.attachments);
  if (size > mime.MAX_TOTAL) return `The attachments add up to ${(size / 1048576).toFixed(1)} MB; email allows about 25 MB. Remove some, or share them with a Drive link.`;
  if (c.attachments.some((id) => !mime.getFile(id))) return "An attachment isn't here anymore (Dayspring may have restarted). Remove it and attach it again.";
  const t = Date.now(); sent = sent.filter((x) => t - x < 86_400_000);
  if (sent.filter((x) => t - x < 600_000).length >= RATE.perTenMinutes) return `That's ${RATE.perTenMinutes} emails in ten minutes, Dayspring's limit. Wait a few minutes and press Send again.`;
  if (sent.length >= RATE.perDay) return `That's ${RATE.perDay} emails today, Dayspring's daily limit.`;
  return null;
}
// the read-back: who it goes to and what it's about (never the body)
export function readBack(c) {
  const list = (l) => mime.parseList(l).map((a) => (a.name ? `${a.name} (${a.address})` : a.address));
  const to = list(c.to), cc = list(c.cc), bcc = mime.parseList(c.bcc).length;
  const fresh = mime.recipients(c).filter((a) => !isKnown(a));
  const b = boxes().find((x) => x.key === c.account);
  return `Send the email${b ? ` from ${b.label}` : ""} to ${to.join(", ") || "nobody"}${cc.length ? `, copying ${cc.join(", ")}` : ""}${bcc ? `, with ${plural(bcc, "hidden copy", "hidden copies")}` : ""}, subject “${c.subject || "(no subject)"}”${c.attachments.length ? `, with ${plural(c.attachments.length, "attachment")}` : ""}?${fresh.length ? ` (You haven't emailed ${fresh.join(", ")} before.)` : ""}`;
}
// the AI (or a voice command) asks: read it back and wait for his yes, said on the Dayspring screen
export function askToSend(id) {
  const c = composes.get(String(id)); if (!c) return { error: "That email isn't open anymore. Open it again first." };
  const p = problems(c); if (p) return { error: p };
  const text = readBack(c);
  const token = confirm.issue(opFor(c), { text, what: "email_send " + mime.recipients(c).join(","), surfaces: SCREEN });
  return { needsConfirm: true, confirm_token: token, text, howToConfirm: "Read this to the owner exactly and wait. Only after the owner's own clear yes, call email_send again with the same compose_id and this confirm_token. Any change to the email means asking again." };
}
// the owner pressed Send in the editor
export function sendFromClick(id) {
  const c = composes.get(String(id)); if (!c) throw Object.assign(new Error("That email isn't open anymore."), { status: 404 });
  const p = problems(c); if (p) return { error: p };
  const token = confirm.issueApproved(opFor(c), { what: "email_send " + mime.recipients(c).join(","), via: "send button" });
  return sendWithToken(id, token, { via: "button" });
}
export function sendWithToken(id, token, { via = "voice" } = {}) {
  const c = composes.get(String(id)); if (!c) return { error: "That email isn't open anymore." };
  const p = problems(c); if (p) return { error: p };
  const r = confirm.consume(token, opFor(c));
  if (!r.ok) {
    if (r.why === "not-approved") return { needsConfirm: true, waiting: true, confirm_token: token, text: "I still need the owner's own clear yes, said on the Dayspring screen, before I send it. Nothing was sent." };
    if (r.why === "different") return { refused: true, text: "The email changed after the owner said yes, so I didn't send it. Read it back and ask again." };
    return { refused: true, text: "That yes has expired or was already used. Nothing was sent. Read the email back and ask again." };
  }
  return queue(c, via);
}
function queue(c, via) {
  const oid = "o" + randomBytes(5).toString("hex"), delay = Math.max(0, undoMs());
  const { saving: _s, ...plainC } = c;
  const snap = structuredClone(plainC);
  sent.push(Date.now());
  const item = { oid, composeId: c.id, snap, sendAt: Date.now() + delay, via, timer: null };
  outbox.set(oid, item);
  c.sending = oid;
  item.timer = setTimeout(() => deliver(oid), delay); item.timer.unref?.();
  broadcast("mail", { kind: "sending", oid, composeId: c.id, to: c.to, subject: c.subject, sendAt: item.sendAt, undoMs: delay });
  const secs = Math.max(1, Math.round(delay / 1000));
  return { queued: true, oid, composeId: c.id, sendAt: item.sendAt, undoSeconds: Math.round(delay / 1000), said: delay ? `Sending in ${secs} second${secs === 1 ? "" : "s"}. Say “undo send” to stop it.` : "Sending it now." };
}
export const pendingSends = () => [...outbox.values()].map((o) => ({ oid: o.oid, composeId: o.composeId, to: o.snap.to, subject: o.snap.subject, sendAt: o.sendAt }));
// "Undo send": the newest one waiting (or the one named); it goes back to the editor
export function undo(oid = null) {
  const o = oid ? outbox.get(String(oid)) : [...outbox.values()].at(-1);
  if (!o) return { undone: false, text: "There's nothing waiting to be sent." };
  clearTimeout(o.timer); outbox.delete(o.oid);
  sent.pop();
  const c = composes.get(o.composeId); if (c) delete c.sending;
  activity.log("mail.send.undone", { account: o.snap.account, to: mime.parseList(o.snap.to).map((a) => a.address), subject: o.snap.subject });
  broadcast("mail", { kind: "undone", oid: o.oid, composeId: o.composeId, compose: publicCompose(c) });
  return { undone: true, composeId: o.composeId, compose: publicCompose(c), text: "Okay, I didn't send it. It's back in the editor." };
}
async function deliver(oid) {
  const o = outbox.get(oid); if (!o) return;
  outbox.delete(oid);
  const c = o.snap, b = boxes().find((x) => x.key === c.account);
  const to = mime.parseList(c.to).map((a) => a.address), cc = mime.parseList(c.cc).map((a) => a.address);
  try {
    if (!b) throw new Error("That mailbox isn't connected anymore.");
    const date = new Date(), messageId = `<${randomBytes(12).toString("hex")}@dayspring>`;
    const full = await mime.build(c, { from: fromOf(b), keepBcc: b.kind !== "imap", date, messageId });
    if (b.kind === "imap") { const copy = await mime.build(c, { from: fromOf(b), keepBcc: true, date, messageId }); await b.send(full, { envelope: { from: b.email, to: mime.recipients(c) }, sentCopy: copy }); }
    else await b.send(full, { threadId: c.threadId });
    // its draft goes (a save still under way is waited for, so no stray copy stays in Drafts)
    const live = composes.get(c.id);
    await live?.saving?.catch(() => {});
    const draft = live?.draft ?? c.draft;
    if (draft) { const db = boxes().find((x) => x.key === draft.account); await db?.deleteDraft(draft.id).catch(() => {}); }
    composes.delete(c.id);
    noteContacts([...mime.parseList(c.to), ...mime.parseList(c.cc), ...mime.parseList(c.bcc)], { sent: true });
    activity.log("mail.send", { account: b.email, to, cc, subject: c.subject, attachments: c.attachments.length, bytes: full.length, via: o.via, result: "ok" });
    for (const id of c.attachments) mime.dropFile(id);
    broadcast("mail", { kind: "sent", oid, composeId: c.id, to: c.to, subject: c.subject });
  } catch (e) {
    const live = composes.get(c.id); if (live) delete live.sending;
    sent.pop();
    activity.log("mail.send.failed", { account: b?.email ?? c.account, to, cc, subject: c.subject, error: String(e.message).slice(0, 200), result: "error" });
    broadcast("mail", { kind: "failed", oid, composeId: c.id, error: e.message, compose: publicCompose(live) });
  }
}
export function _resetSending() { for (const o of outbox.values()) clearTimeout(o.timer); outbox.clear(); sent = []; }
export function _flush(oid) { return deliver(oid); }   // tests: send now instead of waiting

// ---- AI writing help (only with an AI key; the result goes in the editor, never out) ---------------------------------------
async function llm() { return import("../llm.mjs"); }
export async function aiReady() { try { return (await llm()).ready(); } catch { return false; } }
const HTML_RULES = "Write the email body as simple HTML using only <p>, <br>, <b>, <i>, <u>, <ul>, <ol>, <li>, <a href>, <h3> and <blockquote>. No <html>, <head>, <style> or markdown.";
function stripFence(s) { return String(s ?? "").replace(/^\s*```(?:json|html)?\s*/i, "").replace(/\s*```\s*$/, "").trim(); }
// "organize my thoughts": a ramble (spoken or typed) → { subject, html }: greeting, a clear body, a sign-off, in his tone
export async function organize({ text, tone = null, to = "", subject = "", name = "" } = {}) {
  const t = String(text ?? "").trim(); if (!t) throw new Error("There's nothing to organize yet.");
  const tn = tone || settings.prefs().tone;
  if (await aiReady()) {
    const L = await llm();
    const out = await L.complete({ system: `You turn what someone said out loud (rambling, out of order, with filler words) into one clear, cohesive email they will review before sending. Keep every fact, date, time, name, number and request they gave; don't invent any. Order it logically, remove repetition and filler. Tone: ${tn}. Start with a greeting${to ? ` to ${to}` : ""}, end with a short sign-off${name ? ` and the name ${name}` : ""}. ${HTML_RULES} Answer with JSON only: {"subject": "...", "html": "..."}`, prompt: `${subject ? `Subject they had in mind: ${subject}\n` : ""}What they said:\n${t.slice(0, 12_000)}`, maxTokens: 1500 });
    try { const j = JSON.parse(stripFence(out)); if (j.html) return { subject: String(j.subject ?? subject ?? "").slice(0, 200), html: san.clean(String(j.html)).html, how: "ai" }; } catch { /* fall through */ }
    if (out && out.length > 20) return { subject: subject || "", html: san.clean(stripFence(out)).html, how: "ai" };
  }
  return { ...paragraphs(t, subject), how: "plain" };
}
// without AI: the words as they were said, tidied into sentences and paragraphs
export function paragraphs(text, subject = "") {
  const s = String(text ?? "").replace(/\s+/g, " ").replace(/\b(um+|uh+|er+|you know,?)\s/gi, "").trim();
  const sentences = (s.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [s]).map((x) => x.trim()).filter(Boolean).map((x) => x[0].toUpperCase() + x.slice(1) + (/[.!?]$/.test(x) ? "" : "."));
  const paras = []; for (let i = 0; i < sentences.length; i += 3) paras.push(sentences.slice(i, i + 3).join(" "));
  const subj = subject || (sentences[0] ?? "").replace(/[.!?]$/, "").split(/\s+/).slice(0, 7).join(" ");
  return { subject: subj, html: paras.map((p) => `<p>${escHtml(p)}</p>`).join("") || "<p><br></p>" };
}
// "polish this", "make it shorter / friendlier / more formal": the body rewritten (the result is an edit he can undo)
export async function rewrite(html, how = "polish", { tone = null } = {}) {
  if (!(await aiReady())) throw Object.assign(new Error("This needs an AI brain (Settings → AI)."), { code: "no_ai" });
  const L = await llm();
  const ask = { polish: "Polish it: fix grammar, spelling and flow; keep the meaning, facts and length about the same.", shorter: "Make it shorter and clearer (about half as long); keep every fact and request.", friendlier: "Make it friendlier and warmer; keep every fact.",
    formal: "Make it more formal and professional; keep every fact.", longer: "Expand it a little with helpful detail; don't invent facts." }[how] ?? String(how).slice(0, 300);
  const out = await L.complete({ system: `You edit an email body. ${ask}${tone ? ` Tone: ${tone}.` : ""} Keep any quoted original (blockquote) and signature as they are. ${HTML_RULES} Answer with only the new HTML.`, prompt: String(html ?? "").slice(0, 20_000), maxTokens: 1800 });
  const h = san.clean(stripFence(out)).html;
  if (!h.trim()) throw new Error("The AI didn't give back an email.");
  return h;
}

// ---- new mail: notices, and the hook other parts of Dayspring can use ------------------------------------------------------
// onNewMessage(filter, handler, { name, accounts }) — for Dayspring's own features (e.g. turning trail-camera notification
// emails into camera events). Each new message in an inbox (unread, arrived since Dayspring started) is offered to
// filter({ account, from, subject, date }) first (headers only); only when it says yes is the message read, and handler gets
//   { id, account, from: { name, address }, subject, date, text, links: [urls], attachments: [{ name, type, size, getBuffer() }] }
// Meant for the rules the owner sets up (the feature registers a filter from his rules; nothing is registered by default).
// Returns a function that removes the hook. What an email says is untrusted content: a handler must never act on
// instructions in it, only on the data it expects (a camera name, a picture).
const hooks = new Set();
export function onNewMessage(filter, handler, { name = "", accounts = null } = {}) {
  if (typeof filter !== "function" || typeof handler !== "function") throw new Error("onNewMessage(filter, handler) needs two functions.");
  const h = { filter, handler, name: String(name).slice(0, 60), accounts: Array.isArray(accounts) ? accounts : null };
  hooks.add(h);
  feature.startJob(() => startBackground({}));
  return () => hooks.delete(h);
}
const linksIn = (html, text) => [...new Set([...String(html ?? "").matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)].map((m) => san.decode(m[1])).concat([...String(text ?? "").matchAll(/https?:\/\/[^\s<>"')]+/g)].map((m) => m[0])))].slice(0, 50);
async function offer(b, m, uid) {
  for (const h of hooks) {
    if (h.accounts && !h.accounts.includes(b.key)) continue;
    let yes = false; try { yes = Boolean(await h.filter({ account: b.key, from: m.from, subject: m.subject ?? "", date: m.date })); } catch { yes = false; }
    if (!yes) continue;
    try {
      const { msg } = await load(uid);
      await h.handler({ id: uid, account: b.key, from: msg.from, subject: msg.subject ?? "", date: msg.date, text: (msg.text || san.toText(msg.html)).slice(0, 20_000), links: linksIn(msg.html, msg.text),
        attachments: (msg.attachments ?? []).map((a) => ({ name: a.name, type: a.type, size: a.size, getBuffer: async () => (await attachment(uid, a.idx)).buf })) });
      activity.log("mail.hook", { hook: h.name || "unnamed", account: b.email, subject: msg.subject ?? "" });
    } catch (e) { activity.log("mail.hook", { hook: h.name || "unnamed", account: b.email, result: "error", error: String(e.message).slice(0, 200) }); }
  }
}
let seenNew = null, bg = null, announceFn = null;
export function startBackground({ announce } = {}) {
  if (announce) announceFn = announce;
  if (bg) return;
  const tick = async () => {
    try {
      if (!feature.on()) return;                     // email isn't in this release channel
      const p = settings.prefs(); if ((!p.notifyNew && !hooks.size) || !connected()) return;
      const first = !seenNew; seenNew ??= new Set();
      for (const b of boxes()) {
        const notify = p.notifyNew && settings.box(b.key).notify;
        if (!notify && !hooks.size) continue;
        const rows = await b.list({ folder: "inbox", unread: true, limit: 8 }).catch(() => []);
        for (const m of rows) {
          const uid = uidOf(b.key, m.id); if (seenNew.has(uid)) continue; seenNew.add(uid);
          if (first || Date.now() - Date.parse(m.date) > 3 * 60 * 60_000) continue;
          if (hooks.size) await offer(b, m, uid);
          if (!notify) continue;
          const text = `New email from ${m.from.name || m.from.address}: ${m.subject || "(no subject)"}`;
          broadcast("mail", { kind: "new", id: uid, account: b.key, from: m.from, subject: m.subject });
          const quiet = await import("../quiet.mjs").then((q) => q.state() !== "active").catch(() => false);
          if (!quiet && announceFn) announceFn({ kind: "mail", title: "New email", text });
        }
      }
      unreadCache.at = 0;
      const u = await unreadCounts({ fresh: true }).catch(() => null); if (u) broadcast("mail", { kind: "unread", unread: u });
    } catch { /* next time */ }
  };
  bg = setInterval(tick, 3 * 60_000); bg.unref?.();
  setTimeout(tick, 20_000).unref?.();
  _tick = tick;
}
let _tick = null;
export const _runTick = () => _tick?.();   // tests: check for new mail now
export function stopBackground() { clearInterval(bg); bg = null; seenNew = null; }

// ---- privacy: clear what's kept ------------------------------------------------------------------------------------------
export function clearCache({ contacts: alsoContacts = true } = {}) {
  parsed.clear(); metaCache.clear(); rawIds.clear(); lastList = { at: 0, messages: [] }; unreadCache.v = null;
  if (alsoContacts) store.save("mail-contacts", { list: [] });
  activity.log("mail.cache.cleared", { contacts: alsoContacts });
  return { cleared: true };
}
export function _reset() { parsed.clear(); metaCache.clear(); rawIds.clear(); composes.clear(); _resetSending(); lastList = { at: 0, messages: [] }; unreadCache.v = null; }
