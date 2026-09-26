// Webhooks: the bridge to IFTTT, Zapier, Make, n8n, Home Assistant automations and almost anything else.
//   Outgoing — named actions the owner defines: a phrase ("I'm leaving") and a link Dayspring calls when they say it
//              (or when the AI runs it by name). e.g. IFTTT "Webhooks" → turn off the lights, text someone, log a sheet row.
//   Incoming — a private address other services call to make Dayspring say something or add a reminder:
//              POST http://<this computer>:4747/api/hooks/<secret>  { "say": "…" } or { "remind": "…", "minutes": 30 }
//              Dayspring listens on this computer only (127.0.0.1), so callers are programs here, unless you run a tunnel (see the guide).
// Kept in data/connectors/webhooks.json: { outgoing: [{ id, name, phrase, url, method, body }], secret }.
import { randomBytes } from "node:crypto";
import * as store from "./store.mjs";

const load = () => ({ outgoing: [], ...store.load("webhooks") });
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
export function secret() { const s = load(); if (!s.secret) { s.secret = randomBytes(18).toString("hex"); store.save("webhooks", s); } return s.secret; }
export const incomingUrl = () => `http://127.0.0.1:${process.env.PORT || 4747}/api/hooks/${secret()}`;
export function status() {
  const s = load();
  return { id: "webhooks", connected: s.outgoing.length > 0 || Boolean(s.incomingUsed), who: s.outgoing.length ? `${s.outgoing.length} action${s.outgoing.length > 1 ? "s" : ""}` : null,
    outgoing: s.outgoing.map((w) => ({ id: w.id, name: w.name, phrase: w.phrase, host: (() => { try { return new URL(w.url).hostname; } catch { return ""; } })() })), incoming: incomingUrl() };
}
export const connected = () => load().outgoing.length > 0;

// connect = add an outgoing action { name, phrase?, url, method?, body? }
export function connect({ name, phrase, url, method = "POST", body } = {}) {
  const u = String(url ?? "").trim();
  if (!/^https:\/\/[^\s]+$/i.test(u) && !/^http:\/\/(localhost|127\.0\.0\.1|192\.168\.|10\.|homeassistant\.local)[^\s]*$/i.test(u)) throw new Error("Paste the webhook link from IFTTT, Zapier, Make or n8n (it starts with https://).");
  const n = String(name ?? phrase ?? "").trim().slice(0, 60);
  if (!n) throw new Error("Give the action a name, like “Leaving home”.");
  const s = load();
  if (s.outgoing.some((w) => norm(w.name) === norm(n))) throw new Error(`There's already an action called “${n}”.`);
  s.outgoing.push({ id: randomBytes(4).toString("hex"), name: n, phrase: norm(phrase || n), url: u, method: String(method).toUpperCase() === "GET" ? "GET" : "POST", body: body ?? null });
  store.save("webhooks", s);
  return status();
}
export function remove({ id } = {}) { const s = load(), k = norm(id); s.outgoing = s.outgoing.filter((w) => w.id !== id && norm(w.name) !== k); store.save("webhooks", s); return status(); }
export function disconnect() { const s = load(); store.save("webhooks", { outgoing: [], secret: s.secret }); return status(); }   // keeps the incoming secret

// Run an outgoing action by name or phrase. IFTTT's Maker webhooks take value1..3; others get the JSON as-is.
export async function run(nameOrPhrase, payload = {}) {
  const k = norm(nameOrPhrase), w = load().outgoing.find((x) => norm(x.name) === k || x.phrase === k) ?? load().outgoing.find((x) => k.includes(x.phrase) || norm(x.name).includes(k));
  if (!w) return { error: `No action called “${nameOrPhrase}”. You can add one in Settings → Apps → Webhooks.` };
  const body = w.method === "GET" ? undefined : JSON.stringify({ ...(w.body ?? {}), ...(payload ?? {}), source: "Dayspring", at: new Date().toISOString() });
  const r = await fetch(w.url, { method: w.method, headers: body ? { "content-type": "application/json" } : {}, body, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw await store.fail(r, "The webhook");
  return { ran: w.name, status: r.status };
}
// "I'm leaving" said to Dayspring → the action whose phrase it is (exact phrase, so ordinary talk doesn't trigger it)
export function matchPhrase(text) { const k = norm(text).replace(/^(dayspring|hey dayspring)\s+/, ""); return load().outgoing.find((w) => w.phrase === k) ?? null; }

// Incoming: { say } → announce it; { remind, minutes|at } → a reminder; { title, text } works too.
// deps (from the server): { announce(item), addReminder({ date, time, text }) }
export async function incoming(secretIn, body = {}, deps) {
  if (!secretIn || secretIn !== load().secret) return { status: 404, body: { error: "not found" } };
  const s = load(); if (!s.incomingUsed) { s.incomingUsed = true; store.save("webhooks", s); }
  const say = String(body.say ?? body.text ?? body.message ?? body.value1 ?? "").trim().slice(0, 500);
  const remind = String(body.remind ?? "").trim().slice(0, 300);
  if (remind) {
    const at = body.at ? new Date(body.at) : new Date(Date.now() + (Number(body.minutes) || 0) * 60_000);
    if (isNaN(at)) return { status: 400, body: { error: "at must be a date and time" } };
    const r = deps.addReminder({ date: at.toLocaleDateString("en-CA"), time: `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`, text: remind });
    return { status: 200, body: { ok: true, reminder: r?.id ?? true } };
  }
  if (!say) return { status: 400, body: { error: "send { \"say\": \"…\" } or { \"remind\": \"…\", \"minutes\": 30 }" } };
  deps.announce({ kind: "hook", title: String(body.title ?? "Message").slice(0, 60), text: say });
  return { status: 200, body: { ok: true } };
}
