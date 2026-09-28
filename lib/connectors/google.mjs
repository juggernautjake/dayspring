// Google: Calendar, Gmail and Drive, for one or several Google accounts at once. The owner creates their own Google Cloud
// OAuth "Desktop app" client (walkthrough in guides.mjs), pastes its ID and secret once, and signs in to each account in
// their browser. Sign-in uses the installed-app flow with PKCE and a loopback redirect (http://127.0.0.1:<port>/oauth/google).
//
// Several accounts: each has a label (its email, plus an optional nickname like "Work" or "Personal") and is turned on
// per service: Calendar, Gmail, Drive. One account is the primary: Calendar and Gmail use it unless another is named.
// Scopes are asked for as they're needed (incremental sign-in, include_granted_scopes) and kept to the least:
//   calendar  calendar.readonly + calendar.events        gmail  gmail.readonly + gmail.compose (drafts, never sending)
//   drive     drive.readonly                              + "Let Dayspring add and change files in this Drive": drive
// Stored in data/connectors/google.json (v2):
//   { v: 2, clientId, clientSecret, primary: "g1", next: 2,
//     accounts: [{ id, email, nickname, services: { calendar, gmail, drive }, driveWrite, scopes: [granted], token, at }] }
// The refresh token (token) is ENCRYPTED with Windows DPAPI for this Windows user ("dpapi:<base64>"); access tokens are
// only ever kept in memory. Nothing here hands a token to a page: status() says who is connected and what's allowed.
// The older single-account file ({ clientId, clientSecret, refreshToken, email }) becomes account 1 with its scopes.
// Email: search, read and create DRAFTS only. There is no send function in Dayspring at all.
import * as store from "./store.mjs";
import { redirectUri } from "./guides.mjs";
import { dpapi, fakeCrypto } from "../../vendor/ecosystem-core/lib/credentials.mjs";
import * as activity from "../activity.mjs";

const AUTH = () => process.env.GOOGLE_AUTH_BASE || "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = () => process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const REVOKE = () => process.env.GOOGLE_REVOKE_URL || "https://oauth2.googleapis.com/revoke";
const CAL = () => process.env.GOOGLE_CAL_BASE || "https://www.googleapis.com/calendar/v3";
const GMAIL = () => process.env.GOOGLE_GMAIL_BASE || "https://gmail.googleapis.com/gmail/v1";
const G = "https://www.googleapis.com/auth/";
export const SCOPE = {
  base: ["openid", "email"],
  calendar: [G + "calendar.readonly", G + "calendar.events"],
  gmail: [G + "gmail.readonly", G + "gmail.compose"],
  drive: [G + "drive.readonly"],
  driveWrite: [G + "drive"],
};
// what one account asked for before several accounts (and Drive) existed
export const SCOPES = [...SCOPE.base, ...SCOPE.calendar, ...SCOPE.gmail];
export const SERVICES = ["calendar", "gmail", "drive"];
const SERVICE_NAME = { calendar: "Google Calendar", gmail: "Gmail", drive: "Google Drive" };

// ---- the refresh tokens, encrypted at rest -------------------------------------------------------------------------------
let box = null;
const crypto = () => (box ??= process.env.DAYSPRING_TOKEN_CRYPTO === "fake" ? fakeCrypto() : dpapi({ entropy: "dayspring-google-v1" }));
export function _setCrypto(b) { box = b; live.clear(); }             // tests
function seal(token) {
  if (process.platform !== "win32" && process.env.DAYSPRING_TOKEN_CRYPTO !== "fake") return "plain:" + Buffer.from(token, "utf8").toString("base64");   // (no DPAPI off Windows: development only)
  return "dpapi:" + crypto().protect(Buffer.from(String(token), "utf8")).toString("base64");
}
function unseal(v) {
  const s = String(v ?? "");
  if (s.startsWith("dpapi:")) return crypto().unprotect(Buffer.from(s.slice(6), "base64")).toString("utf8");
  if (s.startsWith("plain:")) return Buffer.from(s.slice(6), "base64").toString("utf8");
  throw new Error("The saved Google sign-in can't be read. Remove the account in Settings → Apps → Google and add it again.");
}
// in memory only: id → { refresh, access, expires }
const live = new Map();

// ---- the file, and the move from one account to several -------------------------------------------------------------------
const cleanAccount = (a) => ({ id: String(a.id), email: a.email ?? null, nickname: String(a.nickname ?? "").slice(0, 40), services: Object.fromEntries(SERVICES.map((k) => [k, Boolean(a.services?.[k])])),
  driveWrite: Boolean(a.driveWrite), scopes: Array.isArray(a.scopes) ? a.scopes.map(String) : [], token: a.token ?? null, at: a.at ?? null, ...(a.migrated ? { migrated: true } : {}) });
function data() {
  const s = store.load("google");
  if (s.v === 2) return { ...s, accounts: (s.accounts ?? []).map(cleanAccount) };
  const out = { v: 2, clientId: s.clientId ?? null, clientSecret: s.clientSecret ?? null, primary: null, next: 1, accounts: [] };
  if (s.refreshToken) {
    // the older single account: account 1, with exactly the scopes it had (Calendar and Gmail), and its email
    out.accounts.push(cleanAccount({ id: "g1", email: s.email ?? null, services: { calendar: true, gmail: true, drive: false }, scopes: SCOPES, token: seal(s.refreshToken), at: s.at ?? Date.now(), migrated: true }));
    out.primary = "g1"; out.next = 2;
    live.set("g1", { refresh: s.refreshToken, access: null, expires: 0 });
  }
  if (s.clientId || s.refreshToken) {
    store.save("google", out);
    if (s.refreshToken) activity.log("connect.google.upgraded", { note: "The Google connection now supports several accounts. The existing account became account 1, with the same access (Calendar and Gmail). Its sign-in is now encrypted with Windows.", email: s.email ?? null });
  }
  return out;
}
const save = (d) => store.save("google", { v: 2, clientId: d.clientId ?? null, clientSecret: d.clientSecret ?? null, primary: d.primary ?? null, next: d.next ?? 1, accounts: d.accounts.map(cleanAccount) });

// ---- accounts ---------------------------------------------------------------------------------------------------------------
export const labelOf = (a) => (a ? (a.nickname ? `${a.nickname} (${a.email ?? "Google"})` : a.email ?? "Google account") : "");
const shortLabel = (a) => a.nickname || a.email || "Google";
const hasAll = (a, list) => list.every((s) => a.scopes.includes(s));
export function granted(a, svc) {
  if (svc === "drive") return hasAll(a, SCOPE.drive) || hasAll(a, SCOPE.driveWrite);
  if (svc === "driveWrite") return hasAll(a, SCOPE.driveWrite);
  return hasAll(a, SCOPE[svc] ?? ["-"]);
}
// on for that service and signed in with what it needs
export const enabled = (a, svc) => Boolean(a?.token && a.services?.[svc] && granted(a, svc));
export const canWriteDrive = (a) => enabled(a, "drive") && a.driveWrite && granted(a, "driveWrite");
export const accounts = () => data().accounts;
export function publicAccount(a, d = data()) {
  return { id: a.id, email: a.email, nickname: a.nickname, label: labelOf(a), short: shortLabel(a), primary: d.primary === a.id, services: { ...a.services },
    ready: Object.fromEntries(SERVICES.map((k) => [k, enabled(a, k)])), driveWrite: canWriteDrive(a), driveWriteOn: a.driveWrite,
    needsSignIn: [...SERVICES.filter((k) => a.services[k] && !granted(a, k)), ...(a.driveWrite && !granted(a, "driveWrite") ? ["driveWrite"] : [])], migrated: a.migrated || undefined, at: a.at };
}
export function accountsFor(svc) { return data().accounts.filter((a) => enabled(a, svc)); }
// find an account by id, email, nickname, or part of its label ("work", "my work drive" → the "Work" account)
export function find(want, list = data().accounts) {
  if (want && typeof want === "object") want = want.id;
  const w = String(want ?? "").toLowerCase().replace(/\b(my|the|google|account|drive|gmail|calendar|email|mail)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!w) return null;
  return list.find((a) => a.id === w) ?? list.find((a) => (a.email ?? "").toLowerCase() === w) ?? list.find((a) => a.nickname && a.nickname.toLowerCase() === w)
    ?? list.find((a) => (a.email ?? "").toLowerCase().split("@")[0] === w) ?? list.find((a) => a.nickname && (a.nickname.toLowerCase().includes(w) || w.includes(a.nickname.toLowerCase())))
    ?? list.find((a) => (a.email ?? "").toLowerCase().includes(w)) ?? null;
}
const notConnected = (svc) => Object.assign(new Error(`${SERVICE_NAME[svc] ?? "Google"} isn't connected yet. Connect a Google account in Settings → Apps → Google.`), { code: "not_connected" });
// The account to use for a service: the one asked for, else the primary (when it has that service on), else the first that does
export function accountFor(svc, want = null) {
  const d = data();
  if (want) {
    const a = find(want, d.accounts);
    if (!a) throw Object.assign(new Error(`I don't have a Google account called "${want}". Connected: ${d.accounts.map(labelOf).join(", ") || "none"}.`), { code: "no_account" });
    if (!enabled(a, svc)) throw Object.assign(new Error(`${labelOf(a)} isn't set up for ${SERVICE_NAME[svc] ?? svc}. Turn it on in Settings → Apps → Google.`), { code: "not_enabled" });
    return a;
  }
  const p = d.accounts.find((a) => a.id === d.primary);
  if (p && enabled(p, svc)) return p;
  const a = d.accounts.find((x) => enabled(x, svc));
  if (!a) throw notConnected(svc);
  return a;
}
export const defaultAccount = (svc) => { try { return accountFor(svc); } catch { return null; } };
export const connectedFor = (svc) => data().accounts.some((a) => enabled(a, svc));

export function status() {
  const d = data();
  const list = d.accounts.map((a) => publicAccount(a, d));
  const who = list.length === 0 ? null : list.length === 1 ? list[0].email ?? list[0].label : `${list.find((x) => x.primary)?.email ?? list[0].email} + ${list.length - 1} more`;
  return { id: "google", configured: Boolean(d.clientId && d.clientSecret), connected: list.length > 0, who, accounts: list, primary: d.primary,
    calendar: connectedFor("calendar"), gmail: connectedFor("gmail"), drive: connectedFor("drive") };
}
// Calendar or Gmail can be used (what the older callers mean by "Google is connected")
export const connected = () => connectedFor("calendar") || connectedFor("gmail");

// ---- signing in (a new account, or more services for one) -------------------------------------------------------------------
// start({ clientId, clientSecret, account, services, driveWrite, nickname }) → the Google sign-in URL (the caller opens it)
export function start({ clientId, clientSecret, account = null, services = null, driveWrite = false, nickname = "" } = {}) {
  const d = data();
  const id = String(clientId ?? d.clientId ?? "").trim(), secret = String(clientSecret ?? d.clientSecret ?? "").trim();
  if (!/\.apps\.googleusercontent\.com$/.test(id)) throw new Error("That Client ID doesn't look right. It ends with “.apps.googleusercontent.com”.");
  if (!secret) throw new Error("Paste the Client secret too (it starts with “GOCSPX-”).");
  if (id !== d.clientId || secret !== d.clientSecret) { d.clientId = id; d.clientSecret = secret; save(d); }
  const acct = account ? find(account, d.accounts) : null;
  if (account && !acct) throw new Error("That Google account isn't connected anymore.");
  // what to ask for: a new account gets Calendar, Gmail and Drive (look only) unless told otherwise
  const want = { ...(acct ? acct.services : { calendar: true, gmail: true, drive: true }), ...(services ?? {}) };
  const scopes = [...SCOPE.base, ...SERVICES.filter((k) => want[k]).flatMap((k) => SCOPE[k]), ...(driveWrite || (acct?.driveWrite && want.drive) ? SCOPE.driveWrite : [])];
  const p = store.pkce();
  store.remember(p.state, { provider: "google", verifier: p.verifier, account: acct?.id ?? null, services: want, driveWrite: Boolean(driveWrite), nickname: String(nickname ?? "").slice(0, 40) });
  const q = new URLSearchParams({ client_id: id, redirect_uri: redirectUri("google"), response_type: "code", scope: [...new Set(scopes)].join(" "), code_challenge: p.challenge, code_challenge_method: "S256", state: p.state,
    access_type: "offline", prompt: acct ? "consent" : "consent select_account", include_granted_scopes: "true", ...(acct?.email ? { login_hint: acct.email } : {}) });
  return `${AUTH()}?${q}`;
}
// Google sends the browser back with ?code&state
export async function finish({ code, state, error }) {
  if (error) throw new Error(error === "access_denied" ? "Google sign-in was cancelled." : `Google said: ${error}`);
  const p = store.take(state);
  if (!p || p.provider !== "google") throw new Error("That sign-in link expired. Press Connect again.");
  const d = data();
  const res = await fetch(TOKEN(), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: d.clientId, client_secret: d.clientSecret, redirect_uri: redirectUri("google"), grant_type: "authorization_code", code_verifier: p.verifier }), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw await store.fail(res, "Google");
  const t = await res.json();
  let email = null;
  try { if (t.id_token) email = JSON.parse(Buffer.from(t.id_token.split(".")[1], "base64url").toString("utf8")).email ?? null; } catch { /* no email */ }
  const scopes = String(t.scope ?? "").split(/\s+/).filter(Boolean);
  // the same Google account signing in again (more services, or a fresh sign-in) updates it; anyone else is a new account
  let a = (email && d.accounts.find((x) => (x.email ?? "").toLowerCase() === email.toLowerCase())) ?? (p.account && !email ? d.accounts.find((x) => x.id === p.account) : null);
  const isNew = !a;
  if (isNew) {
    if (!t.refresh_token) throw new Error("Google didn't give Dayspring a lasting sign-in. Open myaccount.google.com/permissions, remove Dayspring, and add the account again.");
    a = cleanAccount({ id: `g${d.next ?? d.accounts.length + 1}`, email, nickname: p.nickname, services: {}, scopes: [] });
    d.next = (d.next ?? d.accounts.length + 1) + 1;
    d.accounts.push(a);
  }
  if (t.refresh_token) a.token = seal(t.refresh_token);
  a.scopes = scopes.length ? [...new Set(scopes)] : a.scopes;   // Google answers with everything this account has granted (include_granted_scopes)
  for (const k of SERVICES) if (p.services?.[k]) a.services[k] = true;
  if (p.driveWrite && granted(a, "driveWrite")) a.driveWrite = true;
  if (p.nickname && !a.nickname) a.nickname = p.nickname;
  a.email = email ?? a.email; a.at = Date.now(); delete a.migrated;
  if (!d.primary || !d.accounts.some((x) => x.id === d.primary)) d.primary = a.id;
  save(d);
  const refresh = t.refresh_token ?? live.get(a.id)?.refresh ?? null;
  live.set(a.id, { refresh, access: t.access_token ?? null, expires: Date.now() + (t.expires_in ?? 3600) * 1000 - 60_000 });
  activity.log(isNew ? "connect.google.added" : "connect.google.signin", { email: a.email, services: SERVICES.filter((k) => enabled(a, k)), driveWrite: canWriteDrive(a) });
  return { ...status(), who: a.email, account: publicAccount(a) };
}

// Change an account: nickname, primary, services on/off, Drive write on/off. Turning on something the account hasn't
// agreed to yet returns { needsSignIn, url } (the caller opens the Google sign-in for just that).
export function update(id, { nickname, primary, services, driveWrite } = {}) {
  const d = data(), a = d.accounts.find((x) => x.id === id);
  if (!a) throw new Error("That Google account isn't connected.");
  const before = publicAccount(a, d);
  if (nickname !== undefined) a.nickname = String(nickname ?? "").trim().slice(0, 40);
  if (primary === true) d.primary = a.id;
  const more = {};
  for (const k of SERVICES) if (services && typeof services[k] === "boolean") { if (services[k] && !granted(a, k)) more[k] = true; else a.services[k] = services[k]; }
  let writeSignIn = false;
  if (typeof driveWrite === "boolean") {
    if (driveWrite && !granted(a, "driveWrite")) writeSignIn = true;
    else a.driveWrite = driveWrite && (a.services.drive || Boolean(more.drive));
  }
  if (!a.services.drive && !more.drive) a.driveWrite = false;
  save(d);
  const after = publicAccount(a, d);
  if (JSON.stringify(before) !== JSON.stringify(after)) activity.log("connect.google.change", { email: a.email, before: { services: before.services, driveWrite: before.driveWrite, primary: before.primary, nickname: before.nickname }, after: { services: after.services, driveWrite: after.driveWrite, primary: after.primary, nickname: after.nickname } });
  if (Object.keys(more).length || writeSignIn) {
    const url = start({ account: a.id, services: { ...a.services, ...more }, driveWrite: writeSignIn || a.driveWrite });
    return { ...status(), needsSignIn: true, url, what: [...Object.keys(more).map((k) => SERVICE_NAME[k]), ...(writeSignIn ? ["changing files in Google Drive"] : [])] };
  }
  return status();
}
// Remove one account (the others stay). Its sign-in is also withdrawn at Google, when Google can be reached.
export async function remove(id) {
  const d = data(), a = d.accounts.find((x) => x.id === id);
  if (!a) throw new Error("That Google account isn't connected.");
  let refresh = live.get(a.id)?.refresh ?? null;
  try { refresh ??= a.token ? unseal(a.token) : null; } catch { /* can't read it: nothing to withdraw */ }
  d.accounts = d.accounts.filter((x) => x.id !== id);
  if (d.primary === id) d.primary = d.accounts[0]?.id ?? null;
  save(d);
  live.delete(id);
  for (const m of [evAcct, calAcct, msgAcct]) for (const [k, v] of m) if (v === id) m.delete(k);
  activity.log("connect.google.removed", { email: a.email });
  if (refresh) await fetch(REVOKE(), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: refresh }), signal: AbortSignal.timeout(8000) }).catch(() => {});
  return status();
}
// Disconnect every account (the Cloud client stays, so adding one again is one click)
export function disconnect() {
  const d = data();
  for (const a of d.accounts) live.delete(a.id);
  save({ clientId: d.clientId, clientSecret: d.clientSecret, primary: null, next: d.next, accounts: [] });
  if (d.accounts.length) activity.log("connect.google.removed", { email: d.accounts.map((a) => a.email).join(", "), all: true });
  return status();
}

// ---- talking to Google ----------------------------------------------------------------------------------------------------
async function access(a) {
  const d = data(), cur = d.accounts.find((x) => x.id === a.id);
  if (!cur?.token) throw notConnected("calendar");
  let l = live.get(cur.id);
  if (l?.access && l.expires > Date.now()) return l.access;
  const refresh = l?.refresh ?? unseal(cur.token);
  const res = await fetch(TOKEN(), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: d.clientId, client_secret: d.clientSecret, refresh_token: refresh, grant_type: "refresh_token" }), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) { const e = await store.fail(res, "Google"); if (e.status === 400) e.message = `Google signed Dayspring out of ${labelOf(cur)} (this happens every 7 days while the Google app is in Testing). Sign in again in Settings → Apps → Google, and publish the app to stop it.`; throw e; }
  const t = await res.json();
  l = { refresh, access: t.access_token, expires: Date.now() + (t.expires_in ?? 3600) * 1000 - 60_000 };
  live.set(cur.id, l);
  return l.access;
}
// A request to Google as one account. The token goes only in the Authorization header to Google (or the test server
// standing in for it); a 401 refreshes once and tries again. Returns the Response (drive.mjs streams it).
export async function authFetch(acct, url, init = {}) {
  const a = typeof acct === "string" ? data().accounts.find((x) => x.id === acct) : acct;
  if (!a) throw notConnected("drive");
  const go = async () => fetch(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${await access(a)}` }, signal: init.signal ?? AbortSignal.timeout(init.timeout ?? 30_000) });
  let res = await go();
  if (res.status === 401) { const l = live.get(a.id); if (l) l.expires = 0; res = await go(); }
  return res;
}
async function api(a, base, method, path, body) {
  const res = await authFetch(a, base + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, timeout: 20_000 });
  if (!res.ok) throw await store.fail(res, "Google");
  return res.status === 204 ? {} : res.json();
}

// which account an event, a calendar or an email came from (so "move it" and "read it" go back to the same account)
const evAcct = new Map(), calAcct = new Map(), msgAcct = new Map();
const remember = (m, k, v) => { m.set(k, v); if (m.size > 5000) m.delete(m.keys().next().value); };
const calAccounts = (account) => (account ? [accountFor("calendar", account)] : (() => { const l = accountsFor("calendar"); if (!l.length) throw notConnected("calendar"); return l; })());
const acctOf = (svc, account, ...hints) => (account ? accountFor(svc, account) : hints.map((h) => h && data().accounts.find((a) => a.id === h && enabled(a, svc))).find(Boolean) ?? accountFor(svc));

// ---- calendar ----
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const localISO = (d) => d.toLocaleDateString("en-CA");
const hm = (d) => d.toTimeString().slice(0, 5);
// Every connected calendar (every account with Calendar on, or one): the primary account's own calendar is "primary";
// another account's own calendar is named after the account ("Work"), so the schedule can tell them apart.
export async function calendars({ account } = {}) {
  const d = data(), out = [], seen = new Set();
  for (const a of calAccounts(account)) {
    const items = (await api(a, CAL(), "GET", "/users/me/calendarList?minAccessRole=reader")).items ?? [];
    for (const c of items) {
      if (seen.has(c.id)) continue;
      seen.add(c.id); remember(calAcct, c.id, a.id);
      const mine = Boolean(c.primary);
      out.push({ id: c.id, name: mine && d.primary !== a.id ? shortLabel(a) : c.summaryOverride ?? c.summary, primary: mine && (d.primary === a.id || Boolean(account)), selected: c.selected !== false, account: a.id, accountLabel: shortLabel(a) });
    }
  }
  return out;
}
// Events between two dates (YYYY-MM-DD, inclusive), normalized for Dayspring's schedule
export async function events(from, to, { calendarIds, account } = {}) {
  const out = [];
  for (const a of calAccounts(account)) {
    let ids;
    if (calendarIds) { const dflt = defaultAccount("calendar")?.id; ids = calendarIds.filter((id) => (calAcct.get(id) ?? dflt) === a.id); if (!ids.length) continue; }
    else ids = (await calendars({ account: a.id }).catch(() => [])).filter((c) => c.selected).map((c) => c.id);
    for (const id of ids.slice(0, 10)) {
      const q = new URLSearchParams({ timeMin: new Date(from + "T00:00:00").toISOString(), timeMax: new Date(to + "T23:59:59").toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250" });
      const r = await api(a, CAL(), "GET", `/calendars/${encodeURIComponent(id)}/events?${q}`).catch(() => ({ items: [] }));
      for (const e of r.items ?? []) {
        if (e.status === "cancelled") continue;
        const me = (e.attendees ?? []).find((x) => x.self);
        const allDay = Boolean(e.start?.date);
        const s = allDay ? new Date(e.start.date + "T00:00:00") : new Date(e.start?.dateTime), en = allDay ? new Date(e.end.date + "T00:00:00") : new Date(e.end?.dateTime);
        remember(evAcct, e.id, a.id);
        out.push({ id: `g:${e.id}`, source: "google", calendar: id, account: a.id, title: e.summary || "(no title)", date: localISO(s), start: allDay ? "00:00" : hm(s), end: allDay ? "23:59" : localISO(en) !== localISO(s) ? "23:59" : hm(en), allDay, where: e.location ?? "", notes: (e.description ?? "").slice(0, 500), link: e.htmlLink,
          // for the conflict checker: all-day events count as busy only when marked busy; invited = someone else organizes it
          busy: allDay ? e.transparency === "opaque" : e.transparency !== "transparent", organizerSelf: e.organizer?.self !== false, invited: Boolean(me) && e.organizer?.self !== true,
          meet: meetOf(e), declined: me?.responseStatus === "declined", dayspring: e.extendedProperties?.private?.dayspring === "1", tz: e.start?.timeZone ?? null });
      }
    }
  }
  return out.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}
export async function addEvent({ title, date, start, end, allDay = false, where = "", notes = "", calendarId = "primary", tag = null, account = null }) {
  const a = acctOf("calendar", account, calendarId !== "primary" ? calAcct.get(calendarId) : null);
  const body = allDay ? { summary: title, location: where, description: notes, start: { date }, end: { date: localISO(new Date(new Date(date + "T12:00:00").getTime() + 86_400_000)) } }
    : { summary: title, location: where, description: notes, start: { dateTime: `${date}T${start}:00`, timeZone: tz() }, end: { dateTime: `${date}T${end}:00`, timeZone: tz() } };
  // tag: an item Dayspring copies here itself (Settings → Apps → "Put my Dayspring schedule on this calendar"); no reminders on copies
  if (tag) Object.assign(body, { extendedProperties: { private: { dayspring: "1", dsKey: String(tag) } }, reminders: { useDefault: false, overrides: [] } });
  const e = await api(a, CAL(), "POST", `/calendars/${encodeURIComponent(calendarId)}/events`, body);
  remember(evAcct, e.id, a.id);
  return { id: `g:${e.id}`, title: e.summary, link: e.htmlLink, account: a.id };
}
// An event's Google Meet link, if it has one
function meetOf(e) { return e.hangoutLink || (e.conferenceData?.entryPoints ?? []).find((p) => p.entryPointType === "video")?.uri || null; }
// A Google Calendar event with a new Google Meet link. invitees: email addresses; Google itself emails them the invitation
// (sendUpdates=all). Only after the owner said yes (the meet_invite tool asks first; the Meetings panel is his own click).
export async function createMeeting({ title = "Meeting", date, start, end, invitees = [], notes = "", account = null }) {
  const a = acctOf("calendar", account, null);
  const emails = [...new Set((invitees ?? []).map((x) => String(x).trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))];
  const body = { summary: title, description: notes, start: { dateTime: date + "T" + start + ":00", timeZone: tz() }, end: { dateTime: date + "T" + end + ":00", timeZone: tz() },
    attendees: emails.map((email) => ({ email })),
    conferenceData: { createRequest: { requestId: "ds-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), conferenceSolutionKey: { type: "hangoutsMeet" } } } };
  const e = await api(a, CAL(), "POST", "/calendars/primary/events?conferenceDataVersion=1&sendUpdates=" + (emails.length ? "all" : "none"), body);
  remember(evAcct, e.id, a.id);
  return { id: "g:" + e.id, title: e.summary, date, start, end, meet: meetOf(e), link: e.htmlLink, invited: emails, account: a.id };
}
const rawId = (id) => String(id).replace(/^g:/, "");
const evAccount = (id, calendarId, account) => acctOf("calendar", account, evAcct.get(rawId(id)), calendarId !== "primary" ? calAcct.get(calendarId) : null);
// Move or rename an event (only after the owner said yes; the conflict resolver asks first)
export async function updateEvent({ id, calendarId = "primary", title, date, start, end, account = null }) {
  const body = {};
  if (title) body.summary = title;
  if (date && start && end) Object.assign(body, { start: { dateTime: `${date}T${start}:00`, timeZone: tz() }, end: { dateTime: `${date}T${end}:00`, timeZone: tz() } });
  const e = await api(evAccount(id, calendarId, account), CAL(), "PATCH", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(rawId(id))}?sendUpdates=all`, body);
  return { id: `g:${e.id}`, title: e.summary, link: e.htmlLink };
}
export async function deleteEvent({ id, calendarId = "primary", account = null }) { await api(evAccount(id, calendarId, account), CAL(), "DELETE", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(rawId(id))}`); return { deleted: true }; }
// Decline an invitation: the organizer is told (only after the owner said yes)
export async function declineEvent({ id, calendarId = "primary", account = null }) {
  const a = evAccount(id, calendarId, account);
  const cur = await api(a, CAL(), "GET", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(rawId(id))}`);
  const attendees = (cur.attendees ?? []).map((x) => (x.self ? { ...x, responseStatus: "declined" } : x));
  if (!attendees.some((x) => x.self)) throw new Error("You're not on the guest list of that event, so there's nothing to decline. You can delete it instead.");
  await api(a, CAL(), "PATCH", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(rawId(id))}?sendUpdates=all`, { attendees });
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
export async function searchMail(query = "in:inbox", { limit = 8, account = null } = {}) {
  const a = accountFor("gmail", account);
  const r = await api(a, GMAIL(), "GET", `/users/me/messages?${new URLSearchParams({ q: query, maxResults: String(Math.min(20, limit)) })}`);
  const out = [];
  for (const { id } of r.messages ?? []) {
    const m = await api(a, GMAIL(), "GET", `/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    remember(msgAcct, id, a.id);
    out.push({ id, threadId: m.threadId, from: header(m, "From"), subject: header(m, "Subject"), date: header(m, "Date"), snippet: m.snippet, unread: (m.labelIds ?? []).includes("UNREAD"), ...(accountsFor("gmail").length > 1 ? { account: shortLabel(a) } : {}) });
  }
  return out;
}
export async function readMail(id, { account = null } = {}) {
  const a = acctOf("gmail", account, msgAcct.get(String(id)));
  const m = await api(a, GMAIL(), "GET", `/users/me/messages/${encodeURIComponent(id)}?format=full`);
  return { id, threadId: m.threadId, from: header(m, "From"), to: header(m, "To"), subject: header(m, "Subject"), date: header(m, "Date"), messageId: header(m, "Message-ID"), text: bodyText(m.payload).replace(/\r/g, "").slice(0, 20_000) };
}
// A draft (new, or a reply in the same thread). Saved in Gmail's Drafts for the owner to review and send themselves.
export async function draft({ to, subject, text, replyToId, account = null }) {
  const a = acctOf("gmail", account, replyToId ? msgAcct.get(String(replyToId)) : null);
  let threadId, inReply = "", refs = "";
  if (replyToId) { const o = await readMail(replyToId, { account: a.id }); threadId = o.threadId; inReply = o.messageId; refs = o.messageId; to = to || o.from; subject = subject || (/^re:/i.test(o.subject) ? o.subject : `Re: ${o.subject}`); }
  if (!to) throw new Error("Who should the email go to?");
  const lines = [`To: ${to}`, `Subject: ${subject ?? ""}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", ...(inReply ? [`In-Reply-To: ${inReply}`, `References: ${refs}`] : []), "", String(text ?? "")];
  const dr = await api(a, GMAIL(), "POST", "/users/me/drafts", { message: { raw: Buffer.from(lines.join("\r\n"), "utf8").toString("base64url"), ...(threadId ? { threadId } : {}) } });
  return { draftId: dr.id, to, subject, saved: `in ${accountsFor("gmail").length > 1 ? shortLabel(a) + "'s " : ""}Gmail Drafts (not sent)` };
}

// The same calendar/Gmail functions, for one account (calsync keeps its copies on one account's calendar)
export function forAccount(want) {
  const id = () => { if (!want) return null; const a = find(want); if (!a) throw Object.assign(new Error(`I don't have a Google account called "${want}". Connected: ${accounts().map(labelOf).join(", ") || "none"}.`), { code: "no_account" }); return a.id; };
  return {
    id, connected: () => { const a = want ? find(want) : null; return a ? enabled(a, "calendar") || enabled(a, "gmail") : connected(); },
    calendars: (o = {}) => calendars({ ...o, account: id() ?? o.account }), events: (f, t, o = {}) => events(f, t, { ...o, account: id() ?? o.account }),
    addEvent: (x) => addEvent({ ...x, account: id() ?? x.account }), updateEvent: (x) => updateEvent({ ...x, account: id() ?? x.account }), deleteEvent: (x) => deleteEvent({ ...x, account: id() ?? x.account }),
    declineEvent: (x) => declineEvent({ ...x, account: id() ?? x.account }), searchMail: (q, o = {}) => searchMail(q, { ...o, account: id() ?? o.account }),
    readMail: (m, o = {}) => readMail(m, { ...o, account: id() ?? o.account }), draft: (x) => draft({ ...x, account: id() ?? x.account }),
  };
}
export function _resetMemory() { live.clear(); evAcct.clear(); calAcct.clear(); msgAcct.clear(); }   // tests
