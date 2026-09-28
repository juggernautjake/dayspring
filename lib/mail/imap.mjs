// Any email provider by IMAP (reading) and SMTP (sending): Yahoo, iCloud, AOL, Zoho, GMX, Fastmail, a custom domain,
// anything else. The owner types the address and an app password into Settings → Email himself; the password is sealed
// with Windows DPAPI (lib/mail/secret.mjs) and never shown again, never sent to a page, never logged.
// Stored in data/connectors/mail.json (lib/mail/settings.mjs keeps the rest of that file):
//   accounts: [{ id: "m1", email, name, preset, user, imap: { host, port, secure }, smtp: { host, port, secure },
//                pass: "dpapi:…", canSend, sentAuto, at }]
// Encrypted connections only (TLS on 993/465, STARTTLS required on 143/587), except to this computer itself (127.0.0.1,
// for a local bridge like Proton Mail Bridge, or the tests' stand-in server).
// Each mailbox is one "adapter" (see adapter() below) with the same shape as Gmail's and Outlook's (lib/mail/gmail.mjs,
// lib/mail/outlook.mjs): folders, list, raw, mark, move, archive, trash, saveDraft, deleteDraft, send.
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import { PRESETS, presetFor } from "./presets.mjs";
import * as secret from "./secret.mjs";
import * as settings from "./settings.mjs";
import * as activity from "../activity.mjs";
import { toText } from "./sanitize.mjs";

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|localhost|::1|\[::1\])$/i;
const isLocal = (h) => LOOPBACK.test(String(h ?? ""));
const ID = /^m\d+$/;

// ---- the accounts ---------------------------------------------------------------------------------------------------------
const clean = (a) => ({ id: String(a.id), email: String(a.email ?? ""), name: String(a.name ?? "").slice(0, 80), preset: a.preset ?? "other", user: String(a.user ?? a.email ?? ""),
  imap: { host: String(a.imap?.host ?? ""), port: Number(a.imap?.port) || 993, secure: a.imap?.secure !== false }, smtp: { host: String(a.smtp?.host ?? ""), port: Number(a.smtp?.port) || 465, secure: a.smtp?.secure !== false },
  pass: a.pass ?? null, canSend: Boolean(a.canSend), sentAuto: Boolean(a.sentAuto), at: a.at ?? null });
export const accounts = () => settings.data().accounts.map(clean);
export const get = (id) => accounts().find((a) => a.id === id) ?? null;
export function publicAccount(a) {
  return { id: a.id, key: "i:" + a.id, kind: "imap", email: a.email, name: a.name, preset: a.preset, provider: PRESETS[a.preset]?.name ?? "Email", user: a.user,
    imap: { host: a.imap.host, port: a.imap.port, secure: a.imap.secure }, smtp: { host: a.smtp.host, port: a.smtp.port, secure: a.smtp.secure },
    hasPassword: Boolean(a.pass), canSend: a.canSend, at: a.at };
}

// what the owner typed → a full configuration (the preset fills the servers)
export function configFrom(b = {}) {
  const email = String(b.email ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Type the whole email address (like name@example.com).");
  const pid = b.preset && PRESETS[b.preset] ? b.preset : presetFor(email) ?? "other";
  const p = PRESETS[pid];
  const port = (v, d) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 65536 ? n : d; };
  const imapHost = String(b.imapHost ?? "").trim() || p.imap.host, smtpHost = String(b.smtpHost ?? "").trim() || p.smtp.host;
  if (!imapHost) throw new Error("Type the IMAP server (your provider's help pages list it, e.g. imap.example.com).");
  const imapPort = port(b.imapPort, p.imap.port), smtpPort = port(b.smtpPort, p.smtp.port);
  return { email, name: String(b.name ?? "").trim().slice(0, 80), preset: pid, user: String(b.user ?? "").trim() || email,
    imap: { host: imapHost, port: imapPort, secure: b.imapSecure !== undefined ? b.imapSecure !== false && b.imapSecure !== "false" : imapPort === 993 },
    smtp: { host: smtpHost, port: smtpPort, secure: b.smtpSecure !== undefined ? b.smtpSecure !== false && b.smtpSecure !== "false" : smtpPort === 465 }, sentAuto: p.sentAuto };
}
const passOf = (a) => (a._plain ?? (a.pass ? secret.unseal(a.pass) : ""));

function imapOptions(a) {
  const local = isLocal(a.imap.host);
  return { host: a.imap.host, port: a.imap.port, secure: a.imap.secure, auth: { user: a.user, pass: passOf(a) }, logger: false, emitLogs: false,
    ...(local ? { tls: { rejectUnauthorized: false } } : { doSTARTTLS: a.imap.secure ? undefined : true }),
    connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 5 * 60_000, clientInfo: { name: "Dayspring" } };
}
function smtpOptions(a) {
  const local = isLocal(a.smtp.host);
  return { host: a.smtp.host, port: a.smtp.port, secure: a.smtp.secure, auth: { user: a.user, pass: passOf(a) }, name: "dayspring.local",
    ...(local ? { tls: { rejectUnauthorized: false }, ignoreTLS: !a.smtp.secure } : { requireTLS: !a.smtp.secure }), connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 120_000 };
}
// plain words for what went wrong (never the password, never the server's whole reply)
export function friendly(e, what = "IMAP") {
  const m = String(e?.responseText ?? e?.response ?? e?.message ?? e ?? "");
  const code = e?.code ?? "";
  if (e?.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|authentication failed|535|LOGIN failed|auth(entication)? (failed|error)|\bEAUTH\b/i.test(m + " " + code)) return "The address or app password wasn't accepted. Yahoo, iCloud and AOL need an app password (not your normal password): the guide shows how to make one.";
  if (/ENOTFOUND|EAI_AGAIN/.test(code + m)) return `Dayspring couldn't find the ${what} server. Check its name (and your internet connection).`;
  if (/ECONNREFUSED/.test(code + m)) return `The ${what} server refused the connection. Check the port.`;
  if (/ETIMEDOUT|timeout/i.test(code + m)) return `The ${what} server didn't answer in time. Check the server name and port, or try again.`;
  if (/certificate|self.signed|CERT_/i.test(code + m)) return `The ${what} server's security certificate isn't valid, so Dayspring won't send your password to it.`;
  if (/STARTTLS|TLS/i.test(m)) return `The ${what} server doesn't offer an encrypted connection on that port, so Dayspring won't use it. Try port ${what === "SMTP" ? "465" : "993"}.`;
  return `${what} said: ${m.replace(/\s+/g, " ").slice(0, 160) || "an error"}`;
}

// Test connection: logs in to IMAP (and lists the folders) and to SMTP. Nothing is saved.
export async function test(cfgOrId, password) {
  const cfg = typeof cfgOrId === "string" ? null : cfgOrId?.imap?.host ? cfgOrId : configFrom(cfgOrId);   // (add() passes a finished configuration)
  const typed = password ?? cfgOrId?.password;
  const a = typeof cfgOrId === "string" ? get(cfgOrId) : { ...cfg, _plain: PRESETS[cfg.preset]?.appPassword ? String(typed ?? "").replace(/\s+/g, "") : String(typed ?? "").trim() };
  if (!a) throw new Error("That mailbox isn't set up.");
  if (!passOf(a)) throw new Error("Type the app password first.");
  const out = { imap: { ok: false }, smtp: { ok: false } };
  const c = new ImapFlow(imapOptions(a));
  c.on("error", () => {});
  try { await c.connect(); const f = await c.list(); out.imap = { ok: true, folders: f.length }; }
  catch (e) { out.imap = { ok: false, error: friendly(e, "IMAP") }; }
  finally { try { await c.logout(); } catch { /* closed */ } }
  if (a.smtp.host) {
    const t = nodemailer.createTransport(smtpOptions(a));
    try { await t.verify(); out.smtp = { ok: true }; } catch (e) { out.smtp = { ok: false, error: friendly(e, "SMTP") }; } finally { t.close(); }
  } else out.smtp = { ok: false, error: "No SMTP server: this mailbox can read but not send." };
  out.ok = out.imap.ok;
  return out;
}

// Add a mailbox: tested first (reading must work; sending is checked but can be fixed later)
export async function add(b = {}) {
  const cfg = configFrom(b);
  // (app passwords never have spaces; providers show them in groups, "abcd efgh ijkl mnop", and people copy the spaces)
  const pass = PRESETS[cfg.preset]?.appPassword ? String(b.password ?? "").replace(/\s+/g, "") : String(b.password ?? "").trim();
  if (!pass) throw new Error("Type the app password (it's saved encrypted, and never shown again).");
  const r = await test(cfg, pass);
  if (!r.imap.ok) throw Object.assign(new Error(r.imap.error), { test: r });
  const d = settings.data();
  if (d.accounts.some((x) => String(x.email).toLowerCase() === cfg.email.toLowerCase())) throw new Error(`${cfg.email} is already connected. Remove it first to set it up again.`);
  const id = "m" + (d.next ?? 1);
  const acct = clean({ ...cfg, id, pass: secret.seal(pass), canSend: Boolean(b.canSend) && r.smtp.ok, at: Date.now() });
  settings.write((x) => { x.accounts.push(acct); x.next = (x.next ?? 1) + 1; if (!x.primary) x.primary = "i:" + id; });
  if (b.nickname) settings.setBox("i:" + id, { nickname: b.nickname });
  activity.log("mail.account.added", { email: cfg.email, provider: PRESETS[cfg.preset]?.name ?? "IMAP", imap: `${cfg.imap.host}:${cfg.imap.port}`, smtp: cfg.smtp.host ? `${cfg.smtp.host}:${cfg.smtp.port}` : null, canSend: acct.canSend });
  return { account: publicAccount(acct), test: r };
}
export function update(id, b = {}) {
  let changed = null;
  settings.write((d) => {
    const a = d.accounts.find((x) => x.id === id); if (!a) throw new Error("That mailbox isn't set up.");
    const before = { canSend: Boolean(a.canSend), name: a.name };
    if (b.name !== undefined) a.name = String(b.name ?? "").slice(0, 80);
    if (typeof b.canSend === "boolean") a.canSend = b.canSend;
    if (b.password) { secret.forget(a.pass); a.pass = secret.seal(String(b.password).trim()); }
    for (const k of ["imapHost", "imapPort", "smtpHost", "smtpPort"]) if (b[k]) { const [box, f] = [k.slice(0, 4), k.slice(4).toLowerCase()]; a[box] = { ...(a[box] ?? {}), [f]: f === "port" ? Number(b[k]) : String(b[k]) }; }
    changed = { email: a.email, before, after: { canSend: Boolean(a.canSend), name: a.name }, password: Boolean(b.password) };
  });
  drop(id);
  activity.log("mail.account.changed", changed);
  return publicAccount(get(id));
}
export async function remove(id) {
  const a = get(id); if (!a) throw new Error("That mailbox isn't set up.");
  secret.forget(a.pass);
  settings.write((d) => { d.accounts = d.accounts.filter((x) => x.id !== id); });
  settings.dropBox("i:" + id);
  await drop(id);
  activity.log("mail.account.removed", { email: a.email });
  return { removed: a.email };
}

// ---- connections (one per mailbox, kept for a minute; one command at a time) -----------------------------------------------
const pool = new Map();     // id → { client, chain, timer }
async function drop(id) { const p = pool.get(id); pool.delete(id); if (p?.client) { clearTimeout(p.timer); try { await p.client.logout(); } catch { /* gone */ } } }
export async function closeAll() { for (const id of [...pool.keys()]) await drop(id); }
function withClient(a, fn) {
  let p = pool.get(a.id);
  if (!p) { p = { client: null, chain: Promise.resolve(), timer: null }; pool.set(a.id, p); }
  const run = async () => {
    clearTimeout(p.timer);
    if (!p.client || !p.client.usable) {
      const c = new ImapFlow(imapOptions(a));
      c.on("error", () => { if (pool.get(a.id)?.client === c) pool.get(a.id).client = null; });
      c.on("close", () => { if (pool.get(a.id)?.client === c) pool.get(a.id).client = null; });
      try { await c.connect(); } catch (e) { throw Object.assign(new Error(friendly(e, "IMAP")), { status: 400 }); }
      p.client = c;
    }
    try { return await fn(p.client); }
    finally { p.timer = setTimeout(() => drop(a.id), 60_000); p.timer.unref?.(); }
  };
  const r = p.chain.then(run, run);
  p.chain = r.catch(() => {});
  return r;
}
async function inBox(c, path, fn, readOnly = false) { const lock = await c.getMailboxLock(path, { readOnly }); try { return await fn(); } finally { lock.release(); } }

// ---- folders ----------------------------------------------------------------------------------------------------------------
const NAMES = { sent: /^(sent|sent items|sent messages|sent mail|\[gmail\]\/sent mail|gesendet)$/i, drafts: /^(drafts?|\[gmail\]\/drafts|entw(ü|u)rfe)$/i, trash: /^(trash|deleted|deleted items|deleted messages|bin|\[gmail\]\/trash|papierkorb)$/i,
  archive: /^(archive|archives|all mail|\[gmail\]\/all mail)$/i, junk: /^(junk|spam|bulk mail|junk e-?mail|\[gmail\]\/spam)$/i };
const USE = { "\\Sent": "sent", "\\Drafts": "drafts", "\\Trash": "trash", "\\Archive": "archive", "\\All": "archive", "\\Junk": "junk" };
const folderCache = new Map();   // id → { at, map, list }
async function folderMap(a, c) {
  const hit = folderCache.get(a.id); if (hit && Date.now() - hit.at < 10 * 60_000) return hit;
  const list = await c.list();
  const map = { inbox: "INBOX" };
  for (const f of list) { const k = USE[f.specialUse]; if (k && !map[k]) map[k] = f.path; }
  for (const f of list) for (const [k, re] of Object.entries(NAMES)) if (!map[k] && (re.test(f.path) || re.test(f.name))) map[k] = f.path;
  const out = { at: Date.now(), map, list: list.filter((f) => !f.flags?.has?.("\\Noselect")).map((f) => ({ path: f.path, name: f.name })) };
  folderCache.set(a.id, out);
  return out;
}
const pathFor = (fm, folder) => (folder === "starred" ? "INBOX" : fm.map[folder] ?? (String(folder).startsWith("f:") ? String(folder).slice(2) : null));
const lid = (path, uid) => `${encodeURIComponent(path)}/${uid}`;
const parseLid = (s) => { const i = String(s).lastIndexOf("/"); return { path: decodeURIComponent(String(s).slice(0, i)), uid: Number(String(s).slice(i + 1)) }; };

// a short preview and whether it has attachments, from the first few KB of the message
async function peek(buf) {
  const head = buf.toString("latin1", 0, Math.min(buf.length, 8192)), hdrEnd = head.search(/\r?\n\r?\n/);
  const ct = /^content-type:\s*([^;\r\n]+)/im.exec(hdrEnd > 0 ? head.slice(0, hdrEnd) : head)?.[1]?.toLowerCase() ?? "text/plain";
  let snippet = "";
  try { const m = await simpleParser(buf, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true }); snippet = (m.text || toText(m.html || "")).replace(/\s+/g, " ").trim().slice(0, 200); } catch { /* cut short */ }
  return { snippet, hasAttachments: ct === "multipart/mixed" };
}
const addrOf = (l) => (l ?? []).map((x) => ({ name: x.name ?? "", address: x.address ?? "" }));

export function adapter(a) {
  const key = "i:" + a.id;
  return {
    key, kind: "imap", email: a.email, name: a.name, canSend: Boolean(a.canSend && a.smtp.host), canOrganize: true, account: a,
    async folders() {
      return withClient(a, async (c) => {
        const fm = await folderMap(a, c);
        const std = ["inbox", "starred", "sent", "drafts", "archive", "trash"].filter((k) => k === "starred" || fm.map[k]).map((k) => ({ id: k, name: k[0].toUpperCase() + k.slice(1) }));
        const used = new Set(Object.values(fm.map));
        return [...std, ...fm.list.filter((f) => !used.has(f.path)).map((f) => ({ id: "f:" + f.path, name: f.name, custom: true }))];
      });
    },
    async list({ folder = "inbox", query = "", unread = false, from = "", limit = 30 } = {}) {
      return withClient(a, async (c) => {
        const fm = await folderMap(a, c), path = pathFor(fm, folder);
        if (!path) return [];
        return inBox(c, path, async () => {
          if (!c.mailbox?.exists) return [];
          const q = {};
          if (folder === "starred") q.flagged = true;
          if (unread) q.seen = false;
          if (from) q.from = from;
          if (query) q.or = [{ from: query }, { subject: query }, { body: query }];
          let uids = await c.search(Object.keys(q).length ? q : { all: true }, { uid: true });
          uids = (uids || []).sort((x, y) => y - x).slice(0, Math.min(100, limit));
          if (!uids.length) return [];
          const rows = [];
          for await (const m of c.fetch(uids, { uid: true, envelope: true, flags: true, internalDate: true, size: true, source: { start: 0, maxLength: 8192 } }, { uid: true })) {
            const pk = await peek(m.source ?? Buffer.alloc(0));
            rows.push({ id: lid(path, m.uid), threadId: null, from: addrOf(m.envelope?.from)[0] ?? { name: "", address: "" }, to: addrOf(m.envelope?.to), cc: addrOf(m.envelope?.cc), subject: m.envelope?.subject ?? "",
              date: new Date(m.envelope?.date ?? m.internalDate ?? Date.now()).toISOString(), unread: !m.flags?.has("\\Seen"), starred: Boolean(m.flags?.has("\\Flagged")), draft: Boolean(m.flags?.has("\\Draft")),
              snippet: pk.snippet, hasAttachments: pk.hasAttachments, size: m.size ?? 0, messageId: m.envelope?.messageId ?? null, folder });
          }
          return rows.sort((x, y) => y.date.localeCompare(x.date));
        }, true);
      });
    },
    async raw(id) {
      const { path, uid } = parseLid(id);
      return withClient(a, (c) => inBox(c, path, async () => { const m = await c.fetchOne(String(uid), { source: true, flags: true }, { uid: true }); if (!m?.source) throw new Error("That email isn't there anymore."); return m.source; }, true));
    },
    // the same conversation: same subject (without Re:/Fwd:) in this folder and in Sent
    async thread(id, subject) {
      const s = String(subject ?? "").replace(/^\s*((re|fwd?|aw|wg)\s*:\s*)+/i, "").trim();
      if (!s) return [id];
      return withClient(a, async (c) => {
        const fm = await folderMap(a, c), { path } = parseLid(id), ids = [];
        for (const p of [...new Set([path, fm.map.sent].filter(Boolean))]) {
          await inBox(c, p, async () => { const u = await c.search({ subject: s }, { uid: true }); for (const x of (u || []).slice(-20)) ids.push(lid(p, x)); }, true);
        }
        return ids.length ? ids : [id];
      });
    },
    async mark(id, { read, starred } = {}) {
      const { path, uid } = parseLid(id);
      return withClient(a, (c) => inBox(c, path, async () => {
        if (read === true) await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }); else if (read === false) await c.messageFlagsRemove(String(uid), ["\\Seen"], { uid: true });
        if (starred === true) await c.messageFlagsAdd(String(uid), ["\\Flagged"], { uid: true }); else if (starred === false) await c.messageFlagsRemove(String(uid), ["\\Flagged"], { uid: true });
        return { ok: true };
      }));
    },
    async moveTo(id, folder) {
      const { path, uid } = parseLid(id);
      return withClient(a, async (c) => {
        const fm = await folderMap(a, c), dest = pathFor(fm, folder);
        if (!dest) throw new Error(folder === "archive" ? `${a.email} has no Archive folder. Make one in your mail provider's website, or move it to another folder.` : `There's no ${folder} folder in ${a.email}.`);
        if (dest === path) return { ok: true, id };
        return inBox(c, path, async () => {
          const r = await c.messageMove(String(uid), dest, { uid: true });
          if (!r) throw new Error(`${a.email} didn't move it (the folder may be gone). Try Refresh.`);
          const nu = r?.uidMap?.get?.(uid); return { ok: true, id: nu ? lid(dest, nu) : null };
        });
      });
    },
    archive(id) { return this.moveTo(id, "archive"); },
    trash(id) { return this.moveTo(id, "trash"); },
    // a draft: added to the Drafts folder (the one it replaces, which Dayspring saved itself, is removed from Drafts)
    async saveDraft(mime, { replaceId = null } = {}) {
      return withClient(a, async (c) => {
        const fm = await folderMap(a, c), drafts = fm.map.drafts;
        if (!drafts) throw new Error(`${a.email} has no Drafts folder.`);
        const r = await c.append(drafts, mime, ["\\Draft", "\\Seen"]);
        let id = r?.uid ? lid(drafts, r.uid) : null;
        if (!id) { const mid = /^message-id:\s*(<[^>]+>)/im.exec(mime.toString("latin1", 0, 4000))?.[1]; if (mid) id = await inBox(c, drafts, async () => { const u = await c.search({ header: { "message-id": mid } }, { uid: true }); return u?.length ? lid(drafts, u.at(-1)) : null; }, true); }
        if (replaceId) { const old = parseLid(replaceId); if (old.path === drafts && old.uid) await inBox(c, drafts, () => c.messageDelete(String(old.uid), { uid: true })).catch(() => {}); }
        return { draftId: id };
      });
    },
    async deleteDraft(draftId) {
      const { path, uid } = parseLid(draftId);
      return withClient(a, async (c) => { const fm = await folderMap(a, c); if (path !== fm.map.drafts) throw new Error("Only drafts can be discarded this way."); await inBox(c, path, () => c.messageDelete(String(uid), { uid: true })); return { ok: true }; });
    },
    async send(mimeNoBcc, { envelope, sentCopy }) {
      if (!a.canSend) throw Object.assign(new Error(`Sending isn't turned on for ${a.email}. Turn on “Let Dayspring send email from this account” in Settings → Email.`), { code: "send_off" });
      const t = nodemailer.createTransport(smtpOptions(a));
      try { await t.sendMail({ envelope, raw: mimeNoBcc }); }
      catch (e) { throw Object.assign(new Error(friendly(e, "SMTP")), { status: 400 }); }
      finally { t.close(); }
      if (!a.sentAuto && sentCopy) await withClient(a, async (c) => { const fm = await folderMap(a, c); if (fm.map.sent) await c.append(fm.map.sent, sentCopy, ["\\Seen"]); }).catch(() => {});
      return { ok: true };
    },
    async unread() {
      return withClient(a, async (c) => { const s = await c.status("INBOX", { unseen: true }); return s?.unseen ?? 0; });
    },
  };
}
export function _reset() { folderCache.clear(); return closeAll(); }
