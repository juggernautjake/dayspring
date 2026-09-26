// Outlook calendar + mail and Microsoft To Do through Microsoft Graph. The owner registers a small "public client"
// app in Microsoft Entra (walkthrough in guides.mjs) and pastes its client ID; sign-in is the auth-code flow with PKCE
// and a localhost redirect (no client secret). Tokens stay in data/connectors/microsoft.json.
// Email: search, read and DRAFTS only (saved in Drafts). There is no send function in Dayspring at all.
import * as store from "./store.mjs";
import { redirectUri } from "./guides.mjs";

const LOGIN = () => process.env.MS_LOGIN_BASE || "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH = () => process.env.MS_GRAPH_BASE || "https://graph.microsoft.com/v1.0";
export const SCOPES = ["openid", "profile", "offline_access", "User.Read", "Calendars.ReadWrite", "Mail.ReadWrite", "Tasks.ReadWrite"];

export function status() { const s = store.load("microsoft"); return { id: "microsoft", configured: Boolean(s.clientId), connected: Boolean(s.refreshToken), who: s.email ?? null }; }
export const connected = () => status().connected;
export function disconnect() { const s = store.load("microsoft"); store.save("microsoft", { clientId: s.clientId }); return status(); }

export function start({ clientId } = {}) {
  const id = String(clientId ?? store.load("microsoft").clientId ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("That doesn't look like an Application (client) ID (it looks like 1a2b3c4d-…).");
  store.patch("microsoft", { clientId: id });
  const p = store.pkce();
  store.remember(p.state, { provider: "microsoft", verifier: p.verifier });
  const q = new URLSearchParams({ client_id: id, response_type: "code", redirect_uri: redirectUri("microsoft"), response_mode: "query", scope: SCOPES.join(" "), state: p.state, code_challenge: p.challenge, code_challenge_method: "S256", prompt: "select_account" });
  return `${LOGIN()}/authorize?${q}`;
}
async function tokenCall(params) {
  const res = await fetch(`${LOGIN()}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw await store.fail(res, "Microsoft");
  return res.json();
}
export async function finish({ code, state, error, error_description }) {
  if (error) throw new Error(error === "access_denied" ? "Microsoft sign-in was cancelled." : `Microsoft said: ${error_description || error}`);
  const p = store.take(state);
  if (!p || p.provider !== "microsoft") throw new Error("That sign-in link expired. Press Connect again.");
  const s = store.load("microsoft");
  const t = await tokenCall({ client_id: s.clientId, grant_type: "authorization_code", code, redirect_uri: redirectUri("microsoft"), code_verifier: p.verifier, scope: SCOPES.join(" ") });
  store.patch("microsoft", { refreshToken: t.refresh_token, accessToken: t.access_token, expires: Date.now() + (t.expires_in ?? 3600) * 1000 - 60_000, at: Date.now() });
  try { const me = await api("GET", "/me"); store.patch("microsoft", { email: me.mail || me.userPrincipalName || null }); } catch { /* who is optional */ }
  return status();
}
async function access() {
  const s = store.load("microsoft");
  if (!s.refreshToken) throw Object.assign(new Error("Outlook isn't connected yet. Connect it in Settings → Apps."), { code: "not_connected" });
  if (s.accessToken && s.expires > Date.now()) return s.accessToken;
  const t = await tokenCall({ client_id: s.clientId, grant_type: "refresh_token", refresh_token: s.refreshToken, scope: SCOPES.join(" ") });
  store.patch("microsoft", { accessToken: t.access_token, refreshToken: t.refresh_token ?? s.refreshToken, expires: Date.now() + (t.expires_in ?? 3600) * 1000 - 60_000 });
  return t.access_token;
}
async function api(method, path, body, extra = {}) {
  const res = await fetch(GRAPH() + path, { method, headers: { authorization: `Bearer ${await access()}`, ...(body ? { "content-type": "application/json" } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw await store.fail(res, "Microsoft");
  const t = res.status === 204 ? "" : await res.text();   // 202 Accepted (decline) has no body either
  return t ? JSON.parse(t) : {};
}

// ---- calendar ----
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
export async function events(from, to) {
  const q = new URLSearchParams({ startDateTime: new Date(from + "T00:00:00").toISOString(), endDateTime: new Date(to + "T23:59:59").toISOString(), $top: "250", $orderby: "start/dateTime", $select: "id,subject,start,end,isAllDay,location,bodyPreview,webLink,isCancelled,showAs,isOrganizer,responseStatus,categories" });
  const r = await api("GET", `/me/calendarView?${q}`, null, { Prefer: `outlook.timezone="${tz()}"` });
  return (r.value ?? []).filter((e) => !e.isCancelled).map((e) => {
    const s = e.start.dateTime, en = e.end.dateTime;
    return { id: `m:${e.id}`, source: "microsoft", title: e.subject || "(no title)", date: s.slice(0, 10), start: e.isAllDay ? "00:00" : s.slice(11, 16), end: e.isAllDay || en.slice(0, 10) !== s.slice(0, 10) ? "23:59" : en.slice(11, 16), allDay: Boolean(e.isAllDay), where: e.location?.displayName ?? "", notes: e.bodyPreview ?? "", link: e.webLink,
      // for the conflict checker: all-day events count as busy only when marked busy (or out of office)
      busy: e.isAllDay ? ["busy", "oof"].includes(e.showAs) : e.showAs !== "free", organizerSelf: e.isOrganizer !== false, invited: e.isOrganizer === false,
      declined: e.responseStatus?.response === "declined", dayspring: (e.categories ?? []).includes("Dayspring") };
  });
}
export async function addEvent({ title, date, start, end, allDay = false, where = "", notes = "", tag = null }) {
  const body = { subject: title, body: { contentType: "text", content: notes }, location: { displayName: where }, isAllDay: allDay,
    start: { dateTime: allDay ? `${date}T00:00:00` : `${date}T${start}:00`, timeZone: tz() }, end: { dateTime: allDay ? `${new Date(new Date(date + "T12:00:00").getTime() + 86_400_000).toLocaleDateString("en-CA")}T00:00:00` : `${date}T${end}:00`, timeZone: tz() } };
  if (tag) Object.assign(body, { categories: ["Dayspring"], isReminderOn: false });   // a copy of Dayspring's own schedule
  const e = await api("POST", "/me/events", body);
  return { id: `m:${e.id}`, title: e.subject, link: e.webLink };
}
const rawId = (id) => encodeURIComponent(String(id).replace(/^m:/, ""));
// Move or rename an event (only after the owner said yes; the conflict resolver asks first)
export async function updateEvent({ id, title, date, start, end }) {
  const body = {};
  if (title) body.subject = title;
  if (date && start && end) Object.assign(body, { start: { dateTime: `${date}T${start}:00`, timeZone: tz() }, end: { dateTime: `${date}T${end}:00`, timeZone: tz() } });
  const e = await api("PATCH", `/me/events/${rawId(id)}`, body);
  return { id: `m:${e.id}`, title: e.subject, link: e.webLink };
}
export async function deleteEvent({ id }) { await api("DELETE", `/me/events/${rawId(id)}`); return { deleted: true }; }
// Decline an invitation: the organizer gets the reply (only after the owner said yes)
export async function declineEvent({ id, comment = "" }) { await api("POST", `/me/events/${rawId(id)}/decline`, { sendResponse: true, ...(comment ? { comment } : {}) }); return { declined: true }; }

// ---- mail: search, read, drafts (never send) ----
const plain = (html) => String(html ?? "").replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
export async function searchMail(query = "", { limit = 8 } = {}) {
  const q = new URLSearchParams({ $top: String(Math.min(20, limit)), $select: "id,subject,from,receivedDateTime,bodyPreview,isRead,conversationId" });
  if (query) q.set("$search", `"${String(query).replace(/"/g, "")}"`); else q.set("$orderby", "receivedDateTime desc");
  const r = await api("GET", `/me/messages?${q}`, null, query ? { ConsistencyLevel: "eventual" } : {});
  return (r.value ?? []).map((m) => ({ id: m.id, from: m.from?.emailAddress ? `${m.from.emailAddress.name} <${m.from.emailAddress.address}>` : "", subject: m.subject, date: m.receivedDateTime, snippet: m.bodyPreview, unread: !m.isRead }));
}
export async function readMail(id) {
  const m = await api("GET", `/me/messages/${encodeURIComponent(id)}?$select=id,subject,from,toRecipients,receivedDateTime,body`);
  return { id, from: m.from?.emailAddress ? `${m.from.emailAddress.name} <${m.from.emailAddress.address}>` : "", to: (m.toRecipients ?? []).map((r) => r.emailAddress.address).join(", "), subject: m.subject, date: m.receivedDateTime, text: (m.body?.contentType === "html" ? plain(m.body.content) : m.body?.content ?? "").slice(0, 20_000) };
}
export async function draft({ to, subject, text, replyToId }) {
  if (replyToId) {
    const d = await api("POST", `/me/messages/${encodeURIComponent(replyToId)}/createReply`, { comment: String(text ?? "") });
    return { draftId: d.id, subject: d.subject, saved: "in Outlook Drafts (not sent)" };
  }
  if (!to) throw new Error("Who should the email go to?");
  const d = await api("POST", "/me/messages", { subject: subject ?? "", body: { contentType: "text", content: String(text ?? "") }, toRecipients: String(to).split(/[,;]\s*/).filter(Boolean).map((a) => ({ emailAddress: { address: a.replace(/.*<|>.*/g, "") } })) });
  return { draftId: d.id, to, subject, saved: "in Outlook Drafts (not sent)" };
}

// ---- Microsoft To Do ----
export async function taskLists() { return ((await api("GET", "/me/todo/lists")).value ?? []).map((l) => ({ id: l.id, name: l.displayName, default: l.wellknownListName === "defaultList" })); }
async function listId(name) {
  const lists = await taskLists();
  const l = name ? lists.find((x) => x.name.toLowerCase().includes(String(name).toLowerCase())) : lists.find((x) => x.default) ?? lists[0];
  if (!l) throw new Error(name ? `There's no To Do list called “${name}”.` : "There are no To Do lists yet.");
  return l;
}
export async function tasks({ list, includeDone = false } = {}) {
  const l = await listId(list);
  const r = await api("GET", `/me/todo/lists/${l.id}/tasks?$top=100${includeDone ? "" : "&$filter=status ne 'completed'"}`);
  return { list: l.name, tasks: (r.value ?? []).map((t) => ({ id: t.id, title: t.title, due: t.dueDateTime?.dateTime?.slice(0, 10) ?? null, done: t.status === "completed", important: t.importance === "high" })) };
}
export async function addTask({ title, list, due }) {
  const l = await listId(list);
  const t = await api("POST", `/me/todo/lists/${l.id}/tasks`, { title, ...(due ? { dueDateTime: { dateTime: `${due}T09:00:00`, timeZone: tz() } } : {}) });
  return { id: t.id, title: t.title, list: l.name };
}
export async function completeTask({ list, match }) {
  const { tasks: all } = await tasks({ list }); const l = await listId(list);
  const t = all.find((x) => x.title.toLowerCase().includes(String(match).toLowerCase()));
  if (!t) throw new Error(`No open task matches “${match}”.`);
  await api("PATCH", `/me/todo/lists/${l.id}/tasks/${t.id}`, { status: "completed" });
  return { done: t.title };
}
