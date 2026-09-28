// Meeting invitations with a real description: an agenda, links, notes (HTML, which Google Calendar and Outlook both show)
// and Drive files on the event. An invitation being written lives here (in memory) and in the invite editor on the
// Dayspring screen; the owner or the AI can change it. It's created (and the invitations emailed by Google or Outlook)
// only after the owner's yes: his Create click, or a clear yes on the Dayspring screen after it's read back. The yes is
// bound to the whole invitation (title, time, guests, description, attachments), so any change means asking again.
import { createHash, randomBytes } from "node:crypto";
import * as google from "../connectors/google.mjs";
import * as microsoft from "../connectors/microsoft.mjs";
import * as confirm from "../confirm.mjs";
import * as activity from "../activity.mjs";
import { broadcast } from "../bus.mjs";
import * as san from "./sanitize.mjs";

const invites = new Map();
const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const cleanGuests = (l) => [...new Set((Array.isArray(l) ? l : String(l ?? "").split(/[,;\s]+/)).map((x) => String(x).trim().toLowerCase().replace(/^.*<|>.*$/g, "")).filter(Boolean))].sort();
export const endOf = (start, minutes) => { const [h, m] = String(start).split(":").map(Number); const e = h * 60 + m + minutes; return String(Math.min(23, Math.floor(e / 60))).padStart(2, "0") + ":" + String(e >= 24 * 60 ? 59 : e % 60).padStart(2, "0"); };
const esc = san.escape;
export const agendaHtml = (items = []) => (items.length ? `<h3>Agenda</h3><ol>${items.map((x) => `<li>${esc(String(x))}</li>`).join("")}</ol>` : "");
export const linksHtml = (links = []) => (links.length ? `<p>${links.map((l) => { const u = String(l.url ?? l).trim(); return /^https?:\/\//i.test(u) ? `<a href="${esc(u)}">${esc(l.title || u)}</a>` : ""; }).filter(Boolean).join("<br>")}</p>` : "");
// the description as the owner or the AI gave it: HTML, or plain text, plus an agenda and links
export function describe({ description_html, description, agenda, links } = {}) {
  const body = description_html ? san.clean(String(description_html)).html : description ? san.textToHtml(description) : "";
  return body + agendaHtml(agenda ?? []) + linksHtml(links ?? []);
}
const defaultProvider = () => (google.connectedFor("calendar") ? "google" : microsoft.connected() ? "microsoft" : null);
export function publicInvite(v) {
  if (!v) return null;
  return { id: v.id, provider: v.provider, account: v.account, title: v.title, date: v.date, start: v.start, minutes: v.minutes, end: endOf(v.start, v.minutes), invitees: v.invitees, meet: v.meet, html: v.html, location: v.location,
    attachments: v.attachments, rev: v.rev, by: v.by };
}
export const get = (id) => invites.get(String(id)) ?? null;
export const latest = () => [...invites.values()].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
export function create(fields = {}, { by = "owner" } = {}) {
  // (with no calendar connected it can still be written; Create says what's missing)
  const provider = fields.provider === "microsoft" || fields.provider === "outlook" ? "microsoft" : fields.provider === "google" ? "google" : defaultProvider() ?? "google";
  const v = { id: "v" + randomBytes(6).toString("hex"), provider, account: fields.account ?? null, title: String(fields.title || "Meeting").slice(0, 200), date: fields.date ?? new Date().toLocaleDateString("en-CA"), start: fields.start ?? "10:00",
    minutes: Math.max(10, Math.min(480, Number(fields.minutes) || 30)), invitees: cleanGuests(fields.invitees ?? []), meet: fields.meet !== false, html: fields.html ?? describe(fields), location: String(fields.location ?? "").slice(0, 200),
    attachments: (fields.attachments ?? []).slice(0, 25), rev: 1, by, updatedAt: Date.now() };
  invites.set(v.id, v);
  return v;
}
export function update(id, patch = {}, { by = "owner", note = "" } = {}) {
  const v = get(id); if (!v) throw Object.assign(new Error("That invitation isn't open anymore."), { status: 404 });
  const before = JSON.stringify(publicInvite(v));
  for (const k of ["title", "location"]) if (patch[k] !== undefined) v[k] = String(patch[k] ?? "").slice(0, 200);
  if (patch.date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(patch.date)) v.date = patch.date;
  if (patch.start !== undefined && /^\d{1,2}:\d{2}$/.test(patch.start)) v.start = patch.start.padStart(5, "0");
  if (patch.minutes !== undefined) v.minutes = Math.max(10, Math.min(480, Number(patch.minutes) || v.minutes));
  if (patch.invitees !== undefined) v.invitees = cleanGuests(patch.invitees);
  if (patch.add_invitees) v.invitees = cleanGuests([...v.invitees, ...cleanGuests(patch.add_invitees)]);
  if (patch.remove_invitees) { const r = new Set(cleanGuests(patch.remove_invitees)); v.invitees = v.invitees.filter((x) => !r.has(x)); }
  if (typeof patch.meet === "boolean") v.meet = patch.meet;
  if (patch.html !== undefined) v.html = san.clean(String(patch.html ?? "")).html;
  if (patch.description !== undefined || patch.description_html !== undefined || patch.agenda || patch.links) { if (patch.description !== undefined || patch.description_html !== undefined) v.html = describe(patch); else v.html += agendaHtml(patch.agenda ?? []) + linksHtml(patch.links ?? []); }
  if (patch.append_html) v.html += san.clean(String(patch.append_html)).html;
  if (Array.isArray(patch.attachments)) v.attachments = patch.attachments.slice(0, 25);
  if (patch.provider) v.provider = patch.provider === "microsoft" || patch.provider === "outlook" ? "microsoft" : "google";
  const changed = before !== JSON.stringify(publicInvite(v));
  if (changed) { v.rev++; v.updatedAt = Date.now(); v.by = by; }
  if (changed && by === "ai") broadcast("mail", { kind: "invite-edit", invite: publicInvite(v), note });
  return publicInvite(v);
}
export const discard = (id) => { invites.delete(String(id)); broadcast("mail", { kind: "invite-closed", inviteId: String(id) }); return { ok: true }; };

// what a yes is bound to: everything that goes out (same fields → same fingerprint, so asking twice is the same question)
export function opFor(v) {
  return { tool: "meet_invite", account: v.account ?? null, title: v.title, date: v.date, start: v.start, end: endOf(v.start, v.minutes), invitees: v.invitees,
    ...(v.provider === "microsoft" ? { provider: "microsoft" } : {}), content: sha(JSON.stringify([v.html ?? "", v.meet !== false, v.location ?? "", (v.attachments ?? []).map((a) => a.fileUrl ?? a.url ?? "")])) };
}
export function problems(v) {
  const bad = v.invitees.filter((x) => !EMAIL.test(x));
  if (bad.length) return "These aren't email addresses: " + bad.join(", ") + ". Ask the owner for each person's email.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date) || !/^\d{2}:\d{2}$/.test(v.start)) return "When should it be? Give a date and a start time.";
  if (v.provider === "google" && !google.connectedFor("calendar")) return "Google Calendar isn't connected. Connect it in Settings → Apps & connections → Google first.";
  if (v.provider === "microsoft" && !microsoft.connected()) return "Outlook isn't connected. Connect it in Settings → Apps & connections first.";
  return null;
}
export function readBack(v) {
  const what = v.provider === "microsoft" ? (v.meet ? "the Outlook meeting (with a Teams link)" : "the Outlook meeting") : v.meet ? "the Google Meet" : "the Google Calendar event";
  const extras = [v.html ? "the description" + (/<ol>/i.test(v.html) ? " and agenda" : "") : "", v.attachments?.length ? `${v.attachments.length} attached file${v.attachments.length === 1 ? "" : "s"}` : ""].filter(Boolean);
  return `Create ${what} "${v.title}" on ${v.date} at ${v.start} (${v.minutes} min)${extras.length ? ` with ${extras.join(" and ")}` : ""} and have ${v.provider === "microsoft" ? "Outlook" : "Google"} email invitations to ${v.invitees.join(", ") || "nobody"}?`;
}
export function ask(v) {
  const p = problems(v); if (p) return { error: p };
  const text = readBack(v);
  // (a yes from a call, a meeting, a text message or Discord doesn't count; "" is Dayspring's own inner callers)
  return { needsConfirm: true, confirm_token: confirm.issue(opFor(v), { text, what: "meet_invite " + v.invitees.join(","), surfaces: ["tv", "desk", ""] }), text, invite_id: v.id };
}
// create it, if the token is the owner's yes to exactly this
export async function createWithToken(v, token) {
  const p = problems(v); if (p) return { error: p };
  const r = confirm.consume(token, opFor(v));
  if (!r.ok) return r.why === "not-approved" ? { needsConfirm: true, waiting: true, confirm_token: token, text: "I still need the owner's clear yes, said on the Dayspring screen." } : { ...ask(v), note: r.why === "different" ? "The invitation changed, so I'm asking again." : undefined };
  const end = endOf(v.start, v.minutes);
  const out = v.provider === "microsoft"
    ? await microsoft.createMeeting({ title: v.title, date: v.date, start: v.start, end, invitees: v.invitees, descriptionHtml: v.html, online: v.meet, location: v.location })
    : await google.createMeeting({ title: v.title, date: v.date, start: v.start, end, invitees: v.invitees, descriptionHtml: v.html, attachments: v.attachments, meet: v.meet, location: v.location, account: v.account });
  activity.log("invite.create", { provider: v.provider, title: v.title, date: v.date, start: v.start, invitees: v.invitees, attachments: (v.attachments ?? []).length, result: "ok" });
  invites.delete(v.id);
  broadcast("mail", { kind: "invite-created", inviteId: v.id, title: v.title, meet: out.meet ?? null });
  return { ...out, said: out.meet ? `Done. ${v.provider === "microsoft" ? "Outlook" : "Google"} is emailing the invitations. The meeting link is ${out.meet}.` : `Done. It's on your calendar and the invitations are on their way.` };
}
export function createFromClick(id) {
  const v = get(id); if (!v) throw Object.assign(new Error("That invitation isn't open anymore."), { status: 404 });
  const p = problems(v); if (p) return { error: p };
  return createWithToken(v, confirm.issueApproved(opFor(v), { what: "meet_invite " + v.invitees.join(","), via: "create button" }));
}
export function _reset() { invites.clear(); }
