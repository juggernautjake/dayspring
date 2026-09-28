// Gmail as a mailbox (one per Google account with Gmail on), through the Gmail API with that account's sign-in
// (lib/connectors/google.mjs keeps it; the token never leaves the server). Same shape as the IMAP and Outlook adapters.
//   reading: gmail.readonly · drafts: gmail.compose · sending: gmail.send (only after "Let Dayspring send email from this
//   account") · marking, starring, archiving, labels and Trash: gmail.modify (only after "…organize this mailbox")
// Trash is Gmail's Trash (restorable for 30 days); nothing here ever deletes a message for good.
import * as google from "../connectors/google.mjs";
import * as store from "../connectors/store.mjs";
import { parseList } from "./mime.mjs";

const hdr = (headers, name) => (headers ?? []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
const decode = (data, charset = "utf-8") => { const b = Buffer.from(String(data ?? ""), "base64url"); try { return new TextDecoder(charset || "utf-8").decode(b); } catch { return b.toString("utf8"); } };
const charsetOf = (headers) => /charset="?([\w-]+)/i.exec(hdr(headers, "content-type"))?.[1] ?? "utf-8";
const FOLDERS = {
  inbox: { labelIds: ["INBOX"] }, starred: { labelIds: ["STARRED"] }, sent: { labelIds: ["SENT"] }, drafts: { labelIds: ["DRAFT"] },
  archive: { q: "-in:inbox -in:sent -in:drafts -in:trash -in:spam -in:chats" }, trash: { labelIds: ["TRASH"], trash: true },
};
async function mapLimit(items, n, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }

export function adapter(a) {
  const key = "g:" + a.id, base = () => google.gmailBase();
  const call = async (method, path, body, { raw = false } = {}) => {
    const res = await google.authFetch(a, base() + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, timeout: 60_000 });
    if (raw) return res;
    if (!res.ok) { const e = await store.fail(res, "Gmail"); if (e.status === 403 && /insufficient|scope|permission/i.test(e.message)) e.message = `Google hasn't allowed that for ${google.labelOf(a)} yet. Turn it on in Settings → Email (Google asks you once).`; throw e; }
    return res.status === 204 ? {} : res.json().catch(() => ({}));
  };
  const needOrganize = () => { if (!google.canOrganizeMail(a)) throw Object.assign(new Error(`Dayspring can't change mail in ${google.labelOf(a)} yet. Turn on “Let Dayspring organize this mailbox” in Settings → Email (Google asks you once).`), { code: "organize_off" }); };
  const row = (m, folder) => {
    const h = m.payload?.headers ?? [];
    const from = parseList(hdr(h, "From"))[0] ?? { name: "", address: "" };
    const date = hdr(h, "Date"), when = Number(m.internalDate) || Date.parse(date) || Date.now();
    return { id: m.id, threadId: m.threadId ?? null, from, to: parseList(hdr(h, "To")), cc: parseList(hdr(h, "Cc")), subject: hdr(h, "Subject"), date: new Date(when).toISOString(),
      unread: (m.labelIds ?? []).includes("UNREAD"), starred: (m.labelIds ?? []).includes("STARRED"), draft: (m.labelIds ?? []).includes("DRAFT"),
      snippet: String(m.snippet ?? "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").slice(0, 200),
      hasAttachments: m.payload?.mimeType === "multipart/mixed" || (m.payload?.parts ?? []).some((p) => p.filename), size: m.sizeEstimate ?? 0, messageId: hdr(h, "Message-ID") || null, labels: m.labelIds ?? [], folder };
  };
  let draftMap = null;   // message id → draft id (to edit a draft)
  return {
    key, kind: "gmail", email: a.email, name: google.labelOf(a), nickname: a.nickname || "", canSend: google.canSendMail(a), canOrganize: google.canOrganizeMail(a), account: a,
    async folders() {
      const std = ["inbox", "starred", "sent", "drafts", "archive", "trash"].map((k) => ({ id: k, name: k[0].toUpperCase() + k.slice(1) }));
      const l = await call("GET", "/users/me/labels").catch(() => ({ labels: [] }));
      return [...std, ...(l.labels ?? []).filter((x) => x.type === "user").map((x) => ({ id: "f:" + x.id, name: x.name, custom: true }))];
    },
    async list({ folder = "inbox", query = "", unread = false, from = "", limit = 30 } = {}) {
      const f = FOLDERS[folder] ?? (String(folder).startsWith("f:") ? { labelIds: [String(folder).slice(2)] } : FOLDERS.inbox);
      const q = [f.q, query, unread ? "is:unread" : "", from ? `from:(${from})` : ""].filter(Boolean).join(" ");
      const p = new URLSearchParams({ maxResults: String(Math.min(100, limit)) });
      for (const l of f.labelIds ?? []) p.append("labelIds", l);
      if (q) p.set("q", q);
      if (f.trash) p.set("includeSpamTrash", "true");
      const r = await call("GET", `/users/me/messages?${p}`);
      const ids = (r.messages ?? []).map((x) => x.id).slice(0, limit);
      const rows = await mapLimit(ids, 6, (id) => call("GET", `/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID`).then((m) => row(m, folder)).catch(() => null));
      return rows.filter(Boolean).sort((x, y) => y.date.localeCompare(x.date));
    },
    // one message, in the shape lib/mail/index.mjs reads (the body's text and HTML, the attachments as a list)
    async read(id) {
      const m = await call("GET", `/users/me/messages/${encodeURIComponent(id)}?format=full`);
      const h = m.payload?.headers ?? [];
      let html = "", text = ""; const atts = [], bodies = [];
      const walk = (p) => {
        if (!p) return;
        const ph = p.headers ?? [], cd = hdr(ph, "content-disposition"), cidRaw = hdr(ph, "content-id").replace(/[<>]/g, "");
        if (String(p.mimeType ?? "").startsWith("multipart/")) { for (const c of p.parts ?? []) walk(c); return; }
        const isAtt = Boolean(p.filename) || /attachment/i.test(cd) || Boolean(cidRaw && /^image\//.test(p.mimeType ?? ""));
        if (!isAtt && (p.mimeType === "text/html" || p.mimeType === "text/plain")) { bodies.push({ kind: p.mimeType === "text/html" ? "html" : "text", p, cs: charsetOf(ph) }); return; }
        if (p.body?.attachmentId || p.body?.data || p.filename)
          atts.push({ idx: atts.length, name: p.filename || (cidRaw ? cidRaw.split("@")[0] : "attachment"), type: p.mimeType ?? "application/octet-stream", size: p.body?.size ?? 0, cid: cidRaw.toLowerCase() || null, inline: /inline/i.test(cd) || Boolean(cidRaw && !p.filename), attachmentId: p.body?.attachmentId ?? null, data: p.body?.data ?? null });
      };
      walk(m.payload);
      // (a long body can come as a separate download: Gmail gives an attachmentId instead of the data)
      for (const b of bodies) {
        const data = b.p.body?.data ?? (b.p.body?.attachmentId ? (await call("GET", `/users/me/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(b.p.body.attachmentId)}`).catch(() => ({}))).data : null);
        if (!data) continue;
        if (b.kind === "html") html += decode(data, b.cs); else text += decode(data, b.cs);
      }
      return { ...row(m, null), replyTo: parseList(hdr(h, "Reply-To")), references: hdr(h, "References") || null, inReplyTo: hdr(h, "In-Reply-To") || null, listUnsubscribe: hdr(h, "List-Unsubscribe") || null,
        html, text, attachments: atts.map(({ data, attachmentId, ...x }) => ({ ...x, _att: attachmentId, _data: data })) };
    },
    async attachment(id, att) {
      if (att._data) return Buffer.from(att._data, "base64url");
      const r = await call("GET", `/users/me/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(att._att)}`);
      return Buffer.from(String(r.data ?? ""), "base64url");
    },
    async raw(id) { const r = await call("GET", `/users/me/messages/${encodeURIComponent(id)}?format=raw`); if (!r.raw) throw new Error("Gmail didn't send that email's contents."); return Buffer.from(r.raw, "base64url"); },
    async thread(id, subject, threadId) {
      if (!threadId) return [id];
      const t = await call("GET", `/users/me/threads/${encodeURIComponent(threadId)}?format=minimal`).catch(() => null);
      return (t?.messages ?? []).map((m) => m.id).filter(Boolean).length ? t.messages.map((m) => m.id) : [id];
    },
    async mark(id, { read, starred } = {}) {
      needOrganize();
      const add = [], rem = [];
      if (read === true) rem.push("UNREAD"); else if (read === false) add.push("UNREAD");
      if (starred === true) add.push("STARRED"); else if (starred === false) rem.push("STARRED");
      await call("POST", `/users/me/messages/${encodeURIComponent(id)}/modify`, { addLabelIds: add, removeLabelIds: rem });
      return { ok: true };
    },
    async moveTo(id, folder) {
      needOrganize();
      if (folder === "trash") { await call("POST", `/users/me/messages/${encodeURIComponent(id)}/trash`); return { ok: true, id }; }
      if (folder === "archive") { await call("POST", `/users/me/messages/${encodeURIComponent(id)}/modify`, { removeLabelIds: ["INBOX"] }); return { ok: true, id }; }
      if (folder === "inbox") { await call("POST", `/users/me/messages/${encodeURIComponent(id)}/untrash`).catch(() => {}); await call("POST", `/users/me/messages/${encodeURIComponent(id)}/modify`, { addLabelIds: ["INBOX"] }); return { ok: true, id }; }
      if (String(folder).startsWith("f:")) { await call("POST", `/users/me/messages/${encodeURIComponent(id)}/modify`, { addLabelIds: [String(folder).slice(2)], removeLabelIds: ["INBOX"] }); return { ok: true, id }; }
      throw new Error(`There's no ${folder} folder in Gmail.`);
    },
    archive(id) { return this.moveTo(id, "archive"); },
    trash(id) { return this.moveTo(id, "trash"); },
    async saveDraft(mime, { replaceId = null, threadId = null } = {}) {
      const message = { raw: Buffer.from(mime).toString("base64url"), ...(threadId ? { threadId } : {}) };
      const d = replaceId ? await call("PUT", `/users/me/drafts/${encodeURIComponent(replaceId)}`, { id: replaceId, message }).catch(() => call("POST", "/users/me/drafts", { message })) : await call("POST", "/users/me/drafts", { message });
      draftMap = null;
      return { draftId: d.id, messageId: d.message?.id ?? null };
    },
    async deleteDraft(draftId) { await call("DELETE", `/users/me/drafts/${encodeURIComponent(draftId)}`); draftMap = null; return { ok: true }; },
    async draftIdFor(messageId) {
      if (!draftMap) { const r = await call("GET", "/users/me/drafts?maxResults=200").catch(() => ({ drafts: [] })); draftMap = new Map((r.drafts ?? []).map((d) => [d.message?.id, d.id])); }
      return draftMap.get(messageId) ?? null;
    },
    async send(mime, { threadId = null } = {}) {
      if (!google.canSendMail(a)) throw Object.assign(new Error(`Sending isn't turned on for ${google.labelOf(a)}. Turn on “Let Dayspring send email from this account” in Settings → Email (Google asks you once).`), { code: "send_off" });
      const r = await call("POST", "/users/me/messages/send", { raw: Buffer.from(mime).toString("base64url"), ...(threadId ? { threadId } : {}) });
      return { ok: true, id: r.id ?? null };
    },
    async unread() { const l = await call("GET", "/users/me/labels/INBOX").catch(() => null); return l?.messagesUnread ?? 0; },
  };
}
