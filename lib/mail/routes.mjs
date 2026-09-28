// The Mail window, the email editor, the invitation editor and Settings → Email talk to Dayspring here (/api/mail/…).
// Only Dayspring's own pages reach these (server.mjs refuses other sites). Sending and creating an invitation also need
// the editor's own header (x-dayspring-mail), so nothing but the Send / Create button on the Dayspring screen can do it.
//   GET  /mail/status · /mail/list · /mail/folders · /mail/message · /mail/thread · /mail/attachment · /mail/contacts
//   POST /mail/act (read/unread/star/archive/trash/move, several at once) · /mail/images (always show a sender's pictures)
//   POST /mail/compose (new, reply, reply all, forward) · GET/POST /mail/compose/:id (autosave) · …/save · …/discard · …/close
//   POST /mail/send · /mail/undo · /mail/drafts/open · /mail/attachments (a file's bytes) · /mail/attachments/from
//   GET  /mail/attach/search · POST /mail/ai (polish, shorter, …) · /mail/organize (his dictated thoughts → an email)
//   GET/POST /mail/settings · POST /mail/box · /mail/accounts/test · …/add · …/update · …/remove · /mail/cache/clear
//   POST /mail/invite · GET/POST /mail/invite/:id · …/create · …/discard · …/attach
import { spawn } from "node:child_process";
import * as mail from "./index.mjs";
import * as mime from "./mime.mjs";
import * as attach from "./attach.mjs";
import * as invite from "./invite.mjs";
import * as tools from "./tools.mjs";
import * as settings from "./settings.mjs";
import * as presets from "./presets.mjs";
import * as imap from "./imap.mjs";
import * as google from "../connectors/google.mjs";
import * as microsoft from "../connectors/microsoft.mjs";
import { broadcast } from "../bus.mjs";
import * as feature from "./feature.mjs";

const openInBrowser = (url) => { if (process.env.DAYSPRING_NO_BROWSER === "1") return; try { spawn("explorer.exe", [url], { detached: true, stdio: "ignore", windowsHide: true }).unref(); } catch { /* the page has the link too */ } };
// the editor's own buttons: a same-site request with the editor's header (a plain link, another program or a page
// elsewhere can't make one)
const fromEditor = (req, what) => req.headers["x-dayspring-mail"] === what && (!req.headers["sec-fetch-site"] || req.headers["sec-fetch-site"] === "same-origin");
async function rawBody(req, max) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > max) throw Object.assign(new Error("That file is too big for email (about 25 MB in all). Share it with a Drive link instead."), { status: 413 }); chunks.push(c); }
  return Buffer.concat(chunks);
}
const DANGER = /^(text\/html|application\/xhtml|image\/svg|text\/xml|application\/xml|text\/javascript|application\/javascript|application\/x-msdownload)/i;
const INLINE_OK = /^(image\/(png|jpe?g|gif|webp|bmp)|application\/pdf|text\/plain|audio\/|video\/)/i;
const changed = () => broadcast("mail", { kind: "boxes" });

export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (p !== "/mail" && !p.startsWith("/mail/")) return false;
  if (!feature.on()) return false;                       // email isn't in this release channel: the routes don't exist (404)
  const body = m === "POST" && !/^\/mail\/attachments$/.test(p) ? await readJSON(req).catch(() => ({})) : {};
  let mm;
  try {
    // ---- reading ----
    if (m === "GET" && p === "/mail/status") {
      const st = mail.status();
      return send(res, 200, { ...st, prefs: settings.prefs(), ai: await mail.aiReady(), composes: mail.composeList(), pending: mail.pendingSends(), unread: st.connected ? await mail.unreadCounts().catch(() => null) : null }), true;
    }
    if (m === "GET" && p === "/mail/list") return send(res, 200, await mail.list({ account: q.get("account") || null, folder: q.get("folder") || "inbox", query: q.get("q") ?? "", unread: q.get("unread") === "1", from: q.get("from") ?? "", limit: Math.min(100, Number(q.get("limit")) || 40) })), true;
    if (m === "GET" && p === "/mail/folders") return send(res, 200, await mail.folders(q.get("account") || null)), true;
    if (m === "GET" && p === "/mail/unread") return send(res, 200, await mail.unreadCounts({ fresh: q.get("fresh") === "1" })), true;
    if (m === "GET" && p === "/mail/message") return send(res, 200, await mail.read(q.get("id"), { images: q.get("images") === "1", markRead: q.get("mark") === "1" })), true;
    if (m === "GET" && p === "/mail/thread") return send(res, 200, await mail.thread(q.get("id"))), true;
    if (m === "GET" && p === "/mail/attachment") {
      const a = await mail.attachment(q.get("id"), Number(q.get("idx")));
      const inline = q.get("inline") === "1" && INLINE_OK.test(a.type) && !DANGER.test(a.type);
      const type = DANGER.test(a.type) ? "application/octet-stream" : a.type;
      res.writeHead(200, { "content-type": type, "content-length": a.buf.length, "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.name)}`, "x-content-type-options": "nosniff", "cache-control": "no-store",
        ...(/pdf/i.test(type) ? {} : { "content-security-policy": "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'" }) });
      res.end(a.buf); return true;
    }
    if (m === "POST" && p === "/mail/attachment/save") {
      // his click in the reader ("Save to Downloads", then "Save") is the OK; file permission still decides where
      const r = await tools.saveAttachment(body.id, Number(body.idx), body.to || null, null, { clicked: body.confirm === true });
      return send(res, 200, r), true;
    }
    if (m === "POST" && p === "/mail/act") {
      const ids = (Array.isArray(body.ids) ? body.ids : [body.id]).filter(Boolean).slice(0, 200), out = [];
      if (body.action === "trash" && body.confirm !== true) return send(res, 400, { error: "Moving to Trash needs your OK first." }), true;
      for (const id of ids) { try { out.push(await mail.act(id, body.action, { folder: body.folder ?? null, confirmed: body.confirm === true })); } catch (e) { out.push({ id, error: e.message }); } }
      const bad = out.filter((x) => x.error);
      return send(res, 200, { done: out.length - bad.length, failed: bad.length, results: out, ...(bad.length ? { error: bad[0].error } : {}) }), true;
    }
    if (m === "POST" && p === "/mail/images") { settings.allowImagesFrom(body.sender, body.allow !== false); return send(res, 200, { ok: true }), true; }
    if (m === "GET" && p === "/mail/contacts") return send(res, 200, { contacts: await mail.contacts(q.get("q") ?? "", Math.min(20, Number(q.get("limit")) || 8)) }), true;

    // ---- composing ----
    if (m === "POST" && p === "/mail/compose") {
      const c = body.id && body.mode && body.mode !== "new" ? await mail.startReply(body.id, { mode: body.mode, asAttachment: Boolean(body.asAttachment), account: body.account || null })
        : mail.newCompose({ account: body.account || null, to: body.to ?? "", cc: body.cc ?? "", bcc: body.bcc ?? "", subject: body.subject ?? "", html: body.html ?? null, attachments: (body.attachments ?? []).filter((x) => mime.getFile(x)) });
      tools.setActive(c.id);
      return send(res, 200, mail.publicCompose(c)), true;
    }
    if (m === "POST" && p === "/mail/drafts/open") { const c = await mail.openDraft(body.id); tools.setActive(c.id); return send(res, 200, mail.publicCompose(c)), true; }
    if ((mm = /^\/mail\/compose\/(c[0-9a-f]+)(?:\/(save|discard|close|focus))?$/.exec(p))) {
      const [, id, act] = mm;
      if (m === "GET" && !act) { const c = mail.getCompose(id); return c ? (send(res, 200, mail.publicCompose(c)), true) : (send(res, 404, { error: "That email isn't open anymore." }), true); }
      if (m === "POST" && !act) {
        const out = mail.updateCompose(id, body, { by: "owner" }); tools.setActive(id);
        if (body.save) { try { const s = await mail.saveDraft(id); return send(res, 200, { ...out, savedAt: s.at, saved: s }), true; } catch (e) { return send(res, 200, { ...out, saveError: e.message }), true; } }
        return send(res, 200, out), true;
      }
      if (m === "POST" && act === "save") return send(res, 200, await mail.saveDraft(id)), true;
      if (m === "POST" && act === "discard") return send(res, 200, await mail.discard(id)), true;
      if (m === "POST" && act === "close") { mail.closeCompose(id); return send(res, 200, { ok: true }), true; }
      if (m === "POST" && act === "focus") { tools.setActive(id); return send(res, 200, { ok: true }), true; }
    }
    if (m === "POST" && p === "/mail/send") {
      if (!fromEditor(req, "send")) return send(res, 403, { error: "Only the Send button in the email editor can send." }), true;
      if (body.patch) mail.updateCompose(body.id, body.patch, { by: "owner" });
      return send(res, 200, mail.sendFromClick(body.id)), true;
    }
    if (m === "POST" && p === "/mail/undo") return send(res, 200, mail.undo(body.oid ?? null)), true;
    if (m === "POST" && p === "/mail/attachments") {
      const buf = await rawBody(req, mime.MAX_ONE + 1024);
      const name = decodeURIComponent(String(req.headers["x-file-name"] ?? "attachment"));
      return send(res, 200, mime.addFile({ name, type: String(req.headers["content-type"] ?? "").split(";")[0] || mime.guessType(name), buf, from: String(req.headers["x-file-from"] ?? "computer").slice(0, 20) })), true;
    }
    // a file he added (a GIF fetched for the text): only to this computer's own pages, never an email's attachment
    if (m === "GET" && (mm = /^\/mail\/attachments\/(a[0-9a-f]+)$/.exec(p))) {
      const f = mime.getFile(mm[1]); if (!f) return send(res, 404, { error: "That attachment isn't here anymore." }), true;
      res.writeHead(200, { "content-type": DANGER.test(f.type) ? "application/octet-stream" : f.type, "content-length": f.size, "x-content-type-options": "nosniff", "cache-control": "no-store", "content-security-policy": "sandbox; default-src 'none'" });
      res.end(f.buf); return true;
    }
    if (m === "POST" && p === "/mail/attachments/from") return send(res, 200, await attach.from(String(body.source), String(body.ref ?? ""), { name: body.name })), true;
    if (m === "GET" && p === "/mail/attach/search") return send(res, 200, { items: await attach.search(q.get("q") ?? "") }), true;
    if (m === "POST" && p === "/mail/ai") {
      if (settings.prefs().aiAccess === "none") return send(res, 400, { error: "The AI is turned off for email in Settings → Email → Privacy." }), true;
      if (body.action === "organize") return send(res, 200, await mail.organize({ text: body.text, tone: body.tone, to: body.to, subject: body.subject })), true;
      return send(res, 200, { html: await mail.rewrite(body.html, body.action, { tone: body.tone }) }), true;
    }
    if (m === "POST" && p === "/mail/organize") {
      if (settings.prefs().aiAccess === "none") return send(res, 200, mail.paragraphs(body.text, body.subject)), true;
      return send(res, 200, await mail.organize({ text: body.text, tone: body.tone, to: body.to, subject: body.subject })), true;
    }

    // ---- Settings → Email ----
    if (m === "GET" && p === "/mail/settings") {
      const st = mail.status();
      const g = google.status(), ms = microsoft.status();
      return send(res, 200, { prefs: settings.prefs(), choices: settings.CHOICES, colors: settings.COLOR_LIST, presets: presets.list(), primary: st.primary,
        boxes: st.boxes.map((b) => ({ ...b, ...settings.box(b.key), color: b.color, ...(b.kind === "gmail" ? (() => { const a = g.accounts.find((x) => "g:" + x.id === b.key); return { sendOn: a?.gmailSendOn, organizeOn: a?.gmailModifyOn, needsSignIn: a?.needsSignIn ?? [] }; })() : b.kind === "outlook" ? { sendOn: ms.mailSendOn, needsSignIn: ms.needsSignIn ?? [] } : {}) })),
        imap: st.imap, google: { configured: g.configured, gmailOff: g.accounts.filter((a) => !a.ready.gmail).map((a) => ({ id: a.id, email: a.email })) }, microsoft: { configured: ms.configured, connected: ms.connected } }), true;
    }
    if (m === "POST" && p === "/mail/settings") { const r = settings.setPrefs(body.prefs ?? body); changed(); return send(res, 200, { prefs: r }), true; }
    if (m === "POST" && p === "/mail/box") {
      const key = String(body.key ?? "");
      const b = mail.boxes().find((x) => x.key === key); if (!b) return send(res, 404, { error: "That mailbox isn't connected." }), true;
      let signIn = null;
      settings.setBox(key, body);
      if (body.primary === true) settings.setPrimary(key);
      if (typeof body.canSend === "boolean" || typeof body.canOrganize === "boolean") {
        if (b.kind === "gmail") { const r = google.update(key.slice(2), { ...(typeof body.canSend === "boolean" ? { gmailSend: body.canSend } : {}), ...(typeof body.canOrganize === "boolean" ? { gmailModify: body.canOrganize } : {}) }); if (r.needsSignIn) signIn = r; }
        else if (b.kind === "outlook" && typeof body.canSend === "boolean") { const r = microsoft.setMailSend(body.canSend); if (r.needsSignIn) signIn = r; }
        else if (b.kind === "imap" && typeof body.canSend === "boolean") imap.update(key.slice(2), { canSend: body.canSend });
      }
      if (signIn?.url && body.open !== false) openInBrowser(signIn.url);
      changed();
      return send(res, 200, { ok: true, ...(signIn ? { needsSignIn: true, url: signIn.url, what: signIn.what } : {}), box: settings.box(key) }), true;
    }
    if (m === "POST" && p === "/mail/accounts/test") return send(res, 200, body.id ? await imap.test(String(body.id)) : await imap.test(body, body.password)), true;
    if (m === "POST" && p === "/mail/accounts/add") { const r = await imap.add(body); changed(); return send(res, 200, r), true; }
    if (m === "POST" && p === "/mail/accounts/update") { const r = imap.update(String(body.id ?? ""), body); changed(); return send(res, 200, { account: r }), true; }
    if (m === "POST" && p === "/mail/accounts/remove") { const r = await imap.remove(String(body.id ?? "").replace(/^i:/, "")); changed(); return send(res, 200, r), true; }
    if (m === "POST" && p === "/mail/cache/clear") return send(res, 200, mail.clearCache({ contacts: body.contacts !== false })), true;

    // ---- invitations ----
    if (m === "POST" && p === "/mail/invite") return send(res, 200, invite.publicInvite(invite.create(body))), true;
    if ((mm = /^\/mail\/invite\/(v[0-9a-f]+)(?:\/(create|discard|attach))?$/.exec(p))) {
      const [, id, act] = mm;
      if (m === "GET" && !act) { const v = invite.get(id); return v ? (send(res, 200, invite.publicInvite(v)), true) : (send(res, 404, { error: "That invitation isn't open anymore." }), true); }
      if (m === "POST" && !act) return send(res, 200, invite.update(id, body, { by: "owner" })), true;
      if (m === "POST" && act === "create") {
        if (!fromEditor(req, "create")) return send(res, 403, { error: "Only the Create button in the invitation editor can do that." }), true;
        if (body.patch) invite.update(id, body.patch, { by: "owner" });
        return send(res, 200, await invite.createFromClick(id)), true;
      }
      if (m === "POST" && act === "discard") return send(res, 200, invite.discard(id)), true;
      if (m === "POST" && act === "attach") {
        const drive = await import("../connectors/drive.mjs");
        const f = await drive.info(String(body.ref));
        const v = invite.get(id); if (!v) return send(res, 404, { error: "That invitation isn't open anymore." }), true;
        return send(res, 200, invite.update(id, { attachments: [...v.attachments, { fileUrl: f.link, title: f.name, mimeType: f.mimeType, fileId: f.id }] })), true;
      }
    }
    return send(res, 404, { error: "no such mail route" }), true;
  } catch (e) {
    const status = e.status && e.status < 500 ? e.status : e.code === "not_connected" || e.code === "no_account" || e.code === "organize_off" || e.code === "send_off" ? 400 : 500;
    return send(res, status === 500 ? 400 : status, { error: e.message, code: e.code ?? null, ...(e.test ? { test: e.test } : {}) }), true;
  }
}
