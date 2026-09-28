// Outlook.com / Hotmail / Microsoft 365 mail as a mailbox, through Microsoft Graph with the sign-in lib/connectors/
// microsoft.mjs keeps (Mail.ReadWrite: reading, drafts, marking, moving; Mail.Send only after "Let Dayspring send email
// from this account"). Same shape as the IMAP and Gmail adapters. Messages are read and sent as MIME, so what the editor
// made is exactly what goes out. Deleting moves to Deleted Items; nothing is ever deleted for good.
import * as microsoft from "../connectors/microsoft.mjs";
import * as store from "../connectors/store.mjs";

const WK = { inbox: "inbox", sent: "sentitems", drafts: "drafts", archive: "archive", trash: "deleteditems", junk: "junkemail" };
const STD_NAMES = new Set(["inbox", "sent items", "drafts", "archive", "deleted items", "junk email", "outbox", "conversation history", "sync issues"]);
const SELECT = "id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,isRead,flag,hasAttachments,conversationId,isDraft,internetMessageId";
const addr = (r) => (r?.emailAddress ? { name: r.emailAddress.name ?? "", address: r.emailAddress.address ?? "" } : { name: "", address: "" });
export const MAX_MIME = 3 * 1024 * 1024;   // Graph takes up to 4 MB in one request; the message is sent base64

export function adapter() {
  const st = microsoft.status();
  const g = (method, path, o) => microsoft.graph(method, path, o);
  const row = (m, folder) => ({ id: m.id, threadId: m.conversationId ?? null, from: addr(m.from), to: (m.toRecipients ?? []).map(addr), cc: (m.ccRecipients ?? []).map(addr), subject: m.subject ?? "",
    date: new Date(m.receivedDateTime ?? Date.now()).toISOString(), unread: m.isRead === false, starred: m.flag?.flagStatus === "flagged", draft: Boolean(m.isDraft), snippet: String(m.bodyPreview ?? "").slice(0, 200),
    hasAttachments: Boolean(m.hasAttachments), size: 0, messageId: m.internetMessageId ?? null, folder });
  return {
    key: "ms", kind: "outlook", email: st.who ?? "Outlook", name: st.who ?? "Outlook", canSend: microsoft.canSendMail(), canOrganize: true,
    async folders() {
      const std = ["inbox", "starred", "sent", "drafts", "archive", "trash"].map((k) => ({ id: k, name: k[0].toUpperCase() + k.slice(1) }));
      const r = await g("GET", "/me/mailFolders?$top=100&$select=id,displayName").catch(() => ({ value: [] }));
      return [...std, ...(r.value ?? []).filter((f) => !STD_NAMES.has(String(f.displayName).toLowerCase())).map((f) => ({ id: "f:" + f.id, name: f.displayName, custom: true }))];
    },
    async list({ folder = "inbox", query = "", unread = false, from = "", limit = 30 } = {}) {
      const p = new URLSearchParams({ $top: String(Math.min(100, limit)), $select: SELECT });
      const search = [query ? String(query).replace(/"/g, "") : "", from ? `from:${String(from).replace(/"/g, "")}` : ""].filter(Boolean).join(" ");
      let path;
      if (folder === "starred") { path = "/me/messages"; p.set("$filter", "flag/flagStatus eq 'flagged'"); }
      else path = `/me/mailFolders/${encodeURIComponent(WK[folder] ?? (String(folder).startsWith("f:") ? String(folder).slice(2) : "inbox"))}/messages`;
      if (search) p.set("$search", `"${search}"`);
      else { if (unread && folder !== "starred") p.set("$filter", "isRead eq false"); if (folder !== "starred") p.set("$orderby", "receivedDateTime desc"); }
      const r = await g("GET", `${path}?${p}`, search ? { headers: { ConsistencyLevel: "eventual" } } : {});
      return (r.value ?? []).map((m) => row(m, folder)).filter((m) => !unread || m.unread).sort((x, y) => y.date.localeCompare(x.date));
    },
    async raw(id) {
      const res = await g("GET", `/me/messages/${encodeURIComponent(id)}/$value`, { raw: true, timeout: 60_000 });
      if (!res.ok) throw await store.fail(res, "Microsoft");
      return Buffer.from(await res.arrayBuffer());
    },
    async meta(id) { return row(await g("GET", `/me/messages/${encodeURIComponent(id)}?$select=${SELECT}`), null); },
    async thread(id, subject, threadId) {
      if (!threadId) return [id];
      const r = await g("GET", `/me/messages?$filter=${encodeURIComponent(`conversationId eq '${String(threadId).replace(/'/g, "''")}'`)}&$select=id,receivedDateTime&$top=30`).catch(() => ({ value: [] }));
      const ids = (r.value ?? []).sort((x, y) => String(x.receivedDateTime).localeCompare(String(y.receivedDateTime))).map((m) => m.id);
      return ids.length ? ids : [id];
    },
    async mark(id, { read, starred } = {}) {
      const body = {};
      if (typeof read === "boolean") body.isRead = read;
      if (typeof starred === "boolean") body.flag = { flagStatus: starred ? "flagged" : "notFlagged" };
      await g("PATCH", `/me/messages/${encodeURIComponent(id)}`, { body });
      return { ok: true };
    },
    async moveTo(id, folder) {
      const dest = WK[folder] ?? (String(folder).startsWith("f:") ? String(folder).slice(2) : null);
      if (!dest) throw new Error(`There's no ${folder} folder in Outlook.`);
      const m = await g("POST", `/me/messages/${encodeURIComponent(id)}/move`, { body: { destinationId: dest } });
      return { ok: true, id: m.id ?? null };
    },
    archive(id) { return this.moveTo(id, "archive"); },
    trash(id) { return this.moveTo(id, "trash"); },
    // a draft from MIME (Graph makes a draft from a base64 MIME body); the one it replaces (Dayspring's own) is removed
    async saveDraft(mime, { replaceId = null } = {}) {
      if (mime.length > MAX_MIME) throw new Error("With its attachments this draft is over 3 MB, more than Outlook takes in one go from Dayspring. Remove a big attachment or share it with a link.");
      const d = await g("POST", "/me/messages", { body: Buffer.from(mime).toString("base64"), contentType: "text/plain" });
      if (replaceId && replaceId !== d.id) await g("DELETE", `/me/messages/${encodeURIComponent(replaceId)}`).catch(() => {});
      return { draftId: d.id };
    },
    async deleteDraft(draftId) { await g("DELETE", `/me/messages/${encodeURIComponent(draftId)}`); return { ok: true }; },
    async send(mime) {
      if (!microsoft.canSendMail()) throw Object.assign(new Error("Sending isn't turned on for Outlook. Turn on “Let Dayspring send email from this account” in Settings → Email (Microsoft asks you once)."), { code: "send_off" });
      if (mime.length > MAX_MIME) throw new Error("With its attachments this email is over 3 MB, more than Outlook takes in one go from Dayspring. Remove a big attachment or share it with a link.");
      await g("POST", "/me/sendMail", { body: Buffer.from(mime).toString("base64"), contentType: "text/plain" });
      return { ok: true };
    },
    async unread() { const f = await g("GET", "/me/mailFolders/inbox?$select=unreadItemCount").catch(() => null); return f?.unreadItemCount ?? 0; },
  };
}
