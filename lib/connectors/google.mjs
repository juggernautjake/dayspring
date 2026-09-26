// Google Calendar + Gmail. The owner creates their own Google Cloud OAuth "Desktop app" client (walkthrough in
// guides.mjs), pastes its ID and secret, and signs in once in their browser. Sign-in uses the installed-app flow with
// PKCE and a loopback redirect (http://127.0.0.1:<port>/oauth/google). Tokens stay in data/connectors/google.json.
// Email: search, read and create DRAFTS only. There is no send function in Dayspring at all.
import * as store from "./store.mjs";
import { redirectUri } from "./guides.mjs";

const AUTH = () => process.env.GOOGLE_AUTH_BASE || "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = () => process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const CAL = () => process.env.GOOGLE_CAL_BASE || "https://www.googleapis.com/calendar/v3";
const GMAIL = () => process.env.GOOGLE_GMAIL_BASE || "https://gmail.googleapis.com/gmail/v1";
export const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"];

export function status() { const s = store.load("google"); return { id: "google", configured: Boolean(s.clientId && s.clientSecret), connected: Boolean(s.refreshToken), who: s.email ?? null }; }
export const connected = () => status().connected;
export function disconnect() { const s = store.load("google"); store.save("google", { clientId: s.clientId, clientSecret: s.clientSecret }); return status(); }

// Step 1: keep the client, return the Google sign-in URL (the caller opens it in the owner's browser)
export function start({ clientId, clientSecret } = {}) {
  const s = store.load("google");
  const id = String(clientId ?? s.clientId ?? "").trim(), secret = String(clientSecret ?? s.clientSecret ?? "").trim();
  if (!/\.apps\.googleusercontent\.com$/.test(id)) throw new Error("That Client ID doesn't look right. It ends with “.apps.googleusercontent.com”.");
  if (!secret) throw new Error("Paste the Client secret too (it starts with “GOCSPX-”).");
  store.patch("google", { clientId: id, clientSecret: secret });
  const p = store.pkce();
  store.remember(p.state, { provider: "google", verifier: p.verifier });
  const q = new URLSearchParams({ client_id: id, redirect_uri: redirectUri("google"), response_type: "code", scope: SCOPES.join(" "), code_challenge: p.challenge, code_challenge_method: "S256", state: p.state, access_type: "offline", prompt: "consent", include_granted_scopes: "true" });
  return `${AUTH()}?${q}`;
}
// Step 2: Google sends the browser back with ?code&state
export async function finish({ code, state, error }) {
  if (error) throw new Error(error === "access_denied" ? "Google sign-in was cancelled." : `Google said: ${error}`);
  const p = store.take(state);
  if (!p || p.provider !== "google") throw new Error("That sign-in link expired. Press Connect again.");
  const s = store.load("google");
  const res = await fetch(TOKEN(), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: s.clientId, client_secret: s.clientSecret, redirect_uri: redirectUri("google"), grant_type: "authorization_code", code_verifier: p.verifier }), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw await store.fail(res, "Google");
  const t = await res.json();
  let email = null;
  try { if (t.id_token) email = JSON.parse(Buffer.from(t.id_token.split(".")[1], "base64url").toString("utf8")).email ?? null; } catch { /* no email */ }
  store.patch("google", { refreshToken: t.refresh_token ?? s.refreshToken, accessToken: t.access_token, expires: Date.now() + (t.expires_in ?? 3600) * 1000 - 60_000, email, at: Date.now() });
  return status();
}
async function access() {
  const s = store.load("google");
  if (!s.refreshToken) throw Object.assign(new Error("Google isn't connected yet. Connect it in Settings → Apps."), { code: "not_connected" });
  if (s.accessToken && s.expires > Date.now()) return s.accessToken;
  const res = await fetch(TOKEN(), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: s.clientId, client_secret: s.clientSecret, refresh_token: s.refreshToken, grant_type: "refresh_token" }), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) { const e = await store.fail(res, "Google"); if (e.status === 400) e.message = "Google signed Dayspring out (this happens every 7 days while the Google app is in Testing). Reconnect it in Settings → Apps, and publish the app to stop it."; throw e; }
  const t = await res.json();
  store.patch("google", { accessToken: t.access_token, expires: Date.now() + (t.expires_in ?? 3600) * 1000 - 60_000 });
  return t.access_token;
}
async function api(base, method, path, body) {
  const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${await access()}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw await store.fail(res, "Google");
  return res.status === 204 ? {} : res.json();
}

// ---- calendar ----
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const localISO = (d) => d.toLocaleDateString("en-CA");
const hm = (d) => d.toTimeString().slice(0, 5);
export async function calendars() { return ((await api(CAL(), "GET", "/users/me/calendarList?minAccessRole=reader")).items ?? []).map((c) => ({ id: c.id, name: c.summaryOverride ?? c.summary, primary: Boolean(c.primary), selected: c.selected !== false })); }
// Events between two dates (YYYY-MM-DD, inclusive), normalized for Dayspring's schedule
export async function events(from, to, { calendarIds } = {}) {
  const ids = calendarIds ?? (await calendars()).filter((c) => c.selected).map((c) => c.id);
  const out = [];
  for (const id of ids.slice(0, 10)) {
    const q = new URLSearchParams({ timeMin: new Date(from + "T00:00:00").toISOString(), timeMax: new Date(to + "T23:59:59").toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250" });
    const r = await api(CAL(), "GET", `/calendars/${encodeURIComponent(id)}/events?${q}`).catch(() => ({ items: [] }));
    for (const e of r.items ?? []) {
      if (e.status === "cancelled") continue;
      const me = (e.attendees ?? []).find((a) => a.self);
      const allDay = Boolean(e.start?.date);
      const s = allDay ? new Date(e.start.date + "T00:00:00") : new Date(e.start?.dateTime), en = allDay ? new Date(e.end.date + "T00:00:00") : new Date(e.end?.dateTime);
      out.push({ id: `g:${e.id}`, source: "google", calendar: id, title: e.summary || "(no title)", date: localISO(s), start: allDay ? "00:00" : hm(s), end: allDay ? "23:59" : localISO(en) !== localISO(s) ? "23:59" : hm(en), allDay, where: e.location ?? "", notes: (e.description ?? "").slice(0, 500), link: e.htmlLink,
        // for the conflict checker: all-day events count as busy only when marked busy; invited = someone else organizes it
        busy: allDay ? e.transparency === "opaque" : e.transparency !== "transparent", organizerSelf: e.organizer?.self !== false, invited: Boolean(me) && e.organizer?.self !== true,
        declined: me?.responseStatus === "declined", dayspring: e.extendedProperties?.private?.dayspring === "1", tz: e.start?.timeZone ?? null });
    }
  }
  return out.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}
export async function addEvent({ title, date, start, end, allDay = false, where = "", notes = "", calendarId = "primary", tag = null }) {
  const body = allDay ? { summary: title, location: where, description: notes, start: { date }, end: { date: localISO(new Date(new Date(date + "T12:00:00").getTime() + 86_400_000)) } }
    : { summary: title, location: where, description: notes, start: { dateTime: `${date}T${start}:00`, timeZone: tz() }, end: { dateTime: `${date}T${end}:00`, timeZone: tz() } };
  // tag: an item Dayspring copies here itself (Settings → Apps → "Put my Dayspring schedule on this calendar"); no reminders on copies
  if (tag) Object.assign(body, { extendedProperties: { private: { dayspring: "1", dsKey: String(tag) } }, reminders: { useDefault: false, overrides: [] } });
  const e = await api(CAL(), "POST", `/calendars/${encodeURIComponent(calendarId)}/events`, body);
  return { id: `g:${e.id}`, title: e.summary, link: e.htmlLink };
}
const rawId = (id) => String(id).replace(/^g:/, "");
// Move or rename an event (only after the owner said yes; the conflict resolver asks first)
export async function updateEvent({ id, calendarId = "primary", title, date, start, end }) {
  const body = {};
  if (title) body.summary = title;
  if (date && start && end) Object.assign(body, { start: { dateTime: `${date}T${start}:00`, timeZone: tz() }, end: { dateTime: `${date}T${end}:00`, timeZone: tz() } });
  const e = await api(CAL(), "PATCH", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(rawId(id))}?sendUpdates=all`, body);
  return { id: `g:${e.id}`, title: e.summary, link: e.htmlLink };
}
export async function deleteEvent({ id, calendarId = "primary" }) { await api(CAL(), "DELETE", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(rawId(id))}`); return { deleted: true }; }
// Decline an invitation: the organizer is told (only after the owner said yes)
export async function declineEvent({ id, calendarId = "primary" }) {
  const cur = await api(CAL(), "GET", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(rawId(id))}`);
  const attendees = (cur.attendees ?? []).map((a) => (a.self ? { ...a, responseStatus: "declined" } : a));
  if (!attendees.some((a) => a.self)) throw new Error("You're not on the guest list of that event, so there's nothing to decline. You can delete it instead.");
  await api(CAL(), "PATCH", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(rawId(id))}?sendUpdates=all`, { attendees });
  return { declined: cur.summary ?? true };
}

// ---- Gmail: search, read, drafts (never send) ----
const header = (m, name) => (m.payload?.headers ?? []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
function bodyText(part) {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf8");
  for (const p of part.parts ?? []) { const t = bodyText(p); if (t) return t; }
  if (part.mimeType === "text/html" && part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf8").replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  return "";
}
export async function searchMail(query = "in:inbox", { limit = 8 } = {}) {
  const r = await api(GMAIL(), "GET", `/users/me/messages?${new URLSearchParams({ q: query, maxResults: String(Math.min(20, limit)) })}`);
  const out = [];
  for (const { id } of r.messages ?? []) {
    const m = await api(GMAIL(), "GET", `/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    out.push({ id, threadId: m.threadId, from: header(m, "From"), subject: header(m, "Subject"), date: header(m, "Date"), snippet: m.snippet, unread: (m.labelIds ?? []).includes("UNREAD") });
  }
  return out;
}
export async function readMail(id) {
  const m = await api(GMAIL(), "GET", `/users/me/messages/${encodeURIComponent(id)}?format=full`);
  return { id, threadId: m.threadId, from: header(m, "From"), to: header(m, "To"), subject: header(m, "Subject"), date: header(m, "Date"), messageId: header(m, "Message-ID"), text: bodyText(m.payload).replace(/\r/g, "").slice(0, 20_000) };
}
// A draft (new, or a reply in the same thread). Saved in Gmail's Drafts for the owner to review and send themselves.
export async function draft({ to, subject, text, replyToId }) {
  let threadId, inReply = "", refs = "";
  if (replyToId) { const o = await readMail(replyToId); threadId = o.threadId; inReply = o.messageId; refs = o.messageId; to = to || o.from; subject = subject || (/^re:/i.test(o.subject) ? o.subject : `Re: ${o.subject}`); }
  if (!to) throw new Error("Who should the email go to?");
  const lines = [`To: ${to}`, `Subject: ${subject ?? ""}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", ...(inReply ? [`In-Reply-To: ${inReply}`, `References: ${refs}`] : []), "", String(text ?? "")];
  const d = await api(GMAIL(), "POST", "/users/me/drafts", { message: { raw: Buffer.from(lines.join("\r\n"), "utf8").toString("base64url"), ...(threadId ? { threadId } : {}) } });
  return { draftId: d.id, to, subject, saved: "in Gmail Drafts (not sent)" };
}
