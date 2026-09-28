// Connected apps (Notion, Google Calendar + Gmail, Outlook + Microsoft To Do, other email by IMAP + SMTP ("mail"),
// calendar subscriptions, news feeds, Home Assistant, webhooks, Todoist, weather alerts):
//   GET  /api/connect                     → every app: its walkthrough and status
//   GET  /api/connect/<name>/status
//   POST /api/connect/<name>/start        → notion: { token } connects now; google: { clientId, clientSecret }; microsoft:
//                                           { clientId } → the sign-in URL, opened in the owner's browser (open:false to skip)
//                                           ics/feeds/homeassistant/webhooks/todoist/weatheralerts: the guide's fields → connected now
//   POST /api/connect/<name>/remove        → ics/feeds/webhooks: { id } takes one item off
//   POST /api/connect/<name>/disconnect
//   POST /api/hooks/<secret>              → incoming webhook: { say } or { remind, minutes|at } (this computer only)
//   GET  /api/connect/events?from=&to=    → events from connected outside calendars (read-only)
// handlePage(): /oauth/google and /oauth/microsoft, where the sign-in comes back to.
import { spawn } from "node:child_process";
import * as connectors from "./connectors/index.mjs";
import { guide } from "./connectors/guides.mjs";
import { broadcast, announce as speak } from "./announcer.mjs";
import * as reminders from "./reminders.mjs";

const NAMES = ["notion", "google", "microsoft", "mail", "ics", "feeds", "homeassistant", "webhooks", "todoist", "weatheralerts"];
const OAUTH = ["google", "microsoft"];   // the rest connect straight from the fields: POST start { …fields } → mod.connect
const MULTI = ["ics", "feeds", "webhooks", "mail"];   // several items each: POST /api/connect/<name>/remove { id }
const modOf = (name) => (name === "mail" ? connectors.mailConnector : connectors[name]);   // "mail": IMAP + SMTP mailboxes (lib/mail; Settings → Email has the full page)
const openInBrowser = (url) => { try { spawn("explorer.exe", [url], { detached: true, stdio: "ignore", windowsHide: true }).unref(); } catch { /* the page has the link too */ } };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const announce = () => { connectors.clearCache(); broadcast("connections", connectors.statuses()); broadcast("refresh", { reason: "connections" }); };

export async function handle(req, res, { m, p, q, send, readJSON }) {
  // Incoming webhooks: POST /api/hooks/<secret> { say } or { remind, minutes|at } (see connectors/webhooks.mjs)
  const hk = /^\/hooks\/([\w-]+)$/.exec(p);
  if (hk && m === "POST") {
    const r = await connectors.webhooks.incoming(hk[1], await readJSON(req).catch(() => ({})), { announce: speak, addReminder: (x) => { const r2 = reminders.add(x); broadcast("refresh", { reason: "reminders" }); return r2; } });
    return send(res, r.status, r.body), true;
  }
  if (p !== "/connect" && !p.startsWith("/connect/")) return false;
  const body = m === "POST" ? await readJSON(req).catch(() => ({})) : {};
  try {
    if (m === "GET" && p === "/connect") return send(res, 200, { apps: connectors.list() }), true;
    if (m === "GET" && p === "/connect/events") return send(res, 200, { events: await connectors.externalEvents(q.get("from") ?? new Date().toLocaleDateString("en-CA"), q.get("to") ?? q.get("from") ?? new Date().toLocaleDateString("en-CA")) }), true;
    // several Google accounts: add one, change one (nickname, primary, Calendar/Gmail/Drive on or off, Drive write), remove one
    //   POST /api/connect/google/account { action: "add", services?, driveWrite?, nickname? } → { url } (opened in the browser)
    //   POST … { action: "update", id, nickname?, primary?, services?, driveWrite? } → status, or { needsSignIn, url } when Google must be asked
    //   POST … { action: "remove", id } → status (the other accounts stay)
    if (m === "POST" && p === "/connect/google/account") {
      const g = connectors.google, a = String(body.action ?? "");
      if (a === "add") { const url = g.start({ clientId: body.clientId, clientSecret: body.clientSecret, services: body.services ?? null, driveWrite: Boolean(body.driveWrite), nickname: body.nickname ?? "" }); if (body.open !== false) openInBrowser(url); return send(res, 200, { url, opened: body.open !== false }), true; }
      if (a === "update") { const r = g.update(String(body.id ?? ""), { nickname: body.nickname, primary: body.primary, services: body.services, driveWrite: body.driveWrite, gmailSend: body.gmailSend, gmailModify: body.gmailModify }); if (r.needsSignIn && body.open !== false) openInBrowser(r.url); announce(); return send(res, 200, r), true; }
      if (a === "remove") { const r = await g.remove(String(body.id ?? "")); announce(); return send(res, 200, r), true; }
      return send(res, 400, { error: "unknown action" }), true;
    }
    const mm = /^\/connect\/(\w+)\/(status|start|disconnect|guide|remove)$/.exec(p);
    if (!mm || !NAMES.includes(mm[1])) return send(res, 404, { error: "unknown app" }), true;
    const [, name, action] = mm, mod = modOf(name);
    if (m === "GET" && action === "status") return send(res, 200, mod.status()), true;
    if (m === "GET" && action === "guide") return send(res, 200, guide(name)), true;
    if (m === "POST" && action === "remove" && MULTI.includes(name)) { const s = await mod.remove(body); announce(); return send(res, 200, s), true; }
    if (m === "POST" && action === "disconnect") { const s = mod.disconnect(); announce(); return send(res, 200, s), true; }
    if (m === "POST" && action === "start") {
      if (name === "notion") { const s = await notion_connect(body); announce(); return send(res, 200, { ...s, done: true }), true; }
      if (!OAUTH.includes(name)) { const s = await mod.connect(body); announce(); return send(res, 200, { ...s, done: true }), true; }
      const url = mod.start(body);
      if (body.open !== false) openInBrowser(url);
      return send(res, 200, { url, opened: body.open !== false }), true;
    }
    return send(res, 405, { error: "method not allowed" }), true;
  } catch (e) { return send(res, e.status && e.status < 500 ? 400 : 200, { ok: false, error: e.message }), true; }
}
const notion_connect = (b) => connectors.notion.connect({ token: b.token });

// The page the browser lands on after signing in
function page(res, ok, title, text) {
  res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><title>Dayspring · ${esc(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(ellipse at 30% 10%,#1d2250,#070913 70%);color:#eef0ff;font-family:Outfit,"Segoe UI",system-ui,sans-serif}
.card{max-width:32em;margin:1.5em;padding:2em 2.2em;border-radius:1.2em;background:rgba(22,26,52,.7);border:1px solid rgba(170,180,255,.28);box-shadow:0 30px 80px rgba(0,0,0,.5);text-align:center}
h1{font-weight:500;margin:.2em 0 .4em}.big{font-size:2.6em}p{color:#a4abcc;line-height:1.5}</style>
<div class="card"><div class="big">${ok ? "✓" : "⚠"}</div><h1>${esc(title)}</h1><p>${esc(text)}</p><p>You can close this tab and go back to Dayspring.</p></div>`);
}
export async function handlePage(req, res, { m, pathname, q }) {
  const mm = /^\/oauth\/(google|microsoft)$/.exec(pathname);
  if (!mm || m !== "GET") return false;
  const name = mm[1], label = name === "google" ? "Google" : "Outlook + Microsoft To Do";
  try {
    const s = await connectors[name].finish(Object.fromEntries(q));
    announce();
    page(res, true, `${label} connected`, s.who ? `Signed in as ${s.who}.` : "Dayspring can use it now.");
  } catch (e) { page(res, false, `Couldn't connect ${label}`, e.message); }
  return true;
}
