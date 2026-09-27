// Sharing with friends: the working part. Loaded ONLY by ./index.mjs, and only when social.enabled is on (a developer
// setting; see ./flag.mjs). Even then nothing happens by itself: no timers, no automatic key, no automatic sync. Each step
// is an explicit request from the dev page (/api/social/dev), and there is no real server yet:
//   - the adapter is ecosystem-core's httpServerAdapter, which says "not configured" (and refuses anything but 127.0.0.1)
//   - or, for a developer, the in-memory/file mock (dev-settings "mock": true, or DAYSPRING_SOCIAL_MOCK=1)
//
// Routes (after /api):
//   GET  /social/status        switch, device key (fingerprint only), adapter, what's waiting
//   GET  /social/dev           the hidden dev mockup page
//   GET  /social/candidates    what could be shared (everything private until the owner shares it)
//   POST /social/device        make this computer's device key (the only place a key is ever made)
//   POST /social/register      register with the (mock or local test) server
//   POST /social/sync          send what's waiting and fetch what's new
//   GET  /social/reminders     reminders from shared memories and events
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJSONAtomic } from "../atomic.mjs";
import { devSettings } from "./flag.mjs";
import * as integration from "./integration.mjs";
import * as core from "../../vendor/ecosystem-core/lib/social/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = () => process.env.DAYSPRING_SOCIAL_DIR || join(HERE, "..", "..", "data", "social");
const ds = () => devSettings();

let keys = null, adapter = null, client = null;
const keyStore = () => (keys ??= core.createKeyStore({ app: "dayspring", dir: process.env.DAYSPRING_SOCIAL_KEYDIR || null }));
function getAdapter() {
  if (adapter) return adapter;
  const url = process.env.DAYSPRING_SOCIAL_SERVER || ds().server || null;
  if (url) return (adapter = core.httpServerAdapter({ url }));                          // refuses anything but 127.0.0.1
  if (process.env.DAYSPRING_SOCIAL_MOCK === "1" || ds().mock === true) return (adapter = core.mockServerAdapter({ file: join(DATA(), "dev-mock-hub.json") }));
  return (adapter = core.httpServerAdapter());                                          // "not configured"
}
function getClient() {
  if (client) return client;
  const identity = keyStore().load();
  if (!identity) throw Object.assign(new Error("This computer has no sharing key yet."), { status: 409 });
  const userId = ds().userId || "u_local", handle = ds().handle || "local";
  const file = join(DATA(), "client.json");
  client = core.createSocialClient({ adapter: getAdapter(), identity, userId, handle,
    store: { load: () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null), save: (d) => { mkdirSync(DATA(), { recursive: true }); writeJSONAtomic(file, d); } } });
  return client;
}

export function status() {
  const ks = keyStore();
  let fingerprint = null;
  try { const id = ks.exists() ? ks.load() : null; fingerprint = id ? core.fingerprint(id.sign.pub) : null; } catch { fingerprint = "unreadable"; }
  const a = getAdapter();
  return { enabled: true, device: { exists: ks.exists(), fingerprint }, adapter: { name: a.name, configured: a.configured },
    userId: ds().userId || "u_local", waiting: client ? client.outbox.pending().length : null, note: "Sharing with friends isn't switched on for real yet: there's no server." };
}

export async function runTool(name, input = {}) {
  if (name === "social_status") return status();
  if (name === "social_reminders") {
    const c = getClient();
    const people = (await import("../people/index.mjs")).list().map((p) => ({ id: p.id, name: p.name, birthday: p.birthday }));
    return { reminders: c.reminders({ people, lastContact: await integration.lastContactMap(), horizonDays: Number(input.days) || 14 }) };
  }
  return undefined;
}

export async function handle(req, res, { m, p, send }) {
  if (m === "GET" && p === "/social/status") return send(res, 200, status()), true;
  if (m === "GET" && p === "/social/dev") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(readFileSync(join(HERE, "dev.html")));
    return true;
  }
  if (m === "GET" && p === "/social/candidates") {
    const items = await integration.shareables();
    return send(res, 200, { count: items.length, byKind: items.reduce((a, x) => ((a[x.kind] = (a[x.kind] ?? 0) + 1), a), {}), items: items.slice(0, 200).map((x) => ({ ref: x.ref, kind: x.kind, date: x.date, visibility: x.visibility, title: x.content?.title ?? null })) }), true;
  }
  if (m === "POST" && p === "/social/device") {
    if (keyStore().exists()) return send(res, 409, { error: "This computer already has a sharing key." }), true;
    const pub = keyStore().create();
    return send(res, 200, { created: true, fingerprint: core.fingerprint(pub.signPub) }), true;
  }
  if (m === "POST" && p === "/social/register") {
    try { return send(res, 200, await getClient().register()), true; } catch (e) { return send(res, e.status ?? 400, { error: e.message, kind: e.kind ?? null }), true; }
  }
  if (m === "POST" && p === "/social/sync") {
    try { return send(res, 200, await getClient().sync()), true; } catch (e) { return send(res, e.status ?? 400, { error: e.message, kind: e.kind ?? null }), true; }
  }
  if (m === "GET" && p === "/social/reminders") {
    try { return send(res, 200, await runTool("social_reminders", {})), true; } catch (e) { return send(res, e.status ?? 400, { error: e.message }), true; }
  }
  return false;
}
