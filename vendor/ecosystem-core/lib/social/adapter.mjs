// Social: the server adapter. Everything that talks to a social server goes through one of these, the same pattern as
// Lantern's HubAdapter (server/src/platform/sync/supabase.js), so the real server can be dropped in later.
//
// The SocialAdapter interface (all async):
//   name                                  "mock" | "http"
//   configured                            false until a server has been set up
//   register({ user, proof, invite })     → { userId }
//   directory(session, { ids | handle })  → [{ id, handle, devices }]   exact lookups only
//   push(session, ops)                    → { accepted: [opId], rejected: [{ opId, reason }] }
//   pull(session)                         → { ops, cursor }
//   audit(session)                        → this user's own audit entries
// session = { userId, identity } (identity: this device's keys, used to sign each request; never sent)
//
// Errors are SocialAdapterError with .kind: "not-configured", "offline", "auth", "denied", or "server".
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { createHub } from "./hub.mjs";
import { canonical, signBytes } from "./crypto.mjs";

export class SocialAdapterError extends Error {
  constructor(message, kind = "server", status = 0) { super(message); this.name = "SocialAdapterError"; this.kind = kind; this.status = status; }
}
export const ADAPTER_METHODS = ["register", "directory", "push", "pull", "audit"];
export function isSocialAdapter(a) { return Boolean(a) && typeof a.name === "string" && ADAPTER_METHODS.every((m) => typeof a[m] === "function"); }

// In memory (or one JSON file) — for tests and the dev mockup. Runs the same server rules as the reference server.
export function mockServerAdapter({ file = null, hub = null, ...hubOpts } = {}) {
  const h = hub ?? createHub({
    ...hubOpts,
    load: () => (file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null),
    save: (data) => { if (!file) return; mkdirSync(dirname(file), { recursive: true }); writeFileSync(file + ".tmp", JSON.stringify(data)); renameSync(file + ".tmp", file); },
  });
  const who = (session) => { if (!session?.userId) throw new SocialAdapterError("Not signed in.", "auth"); return session.userId; };
  const wrap = async (fn) => { try { return await fn(); } catch (e) { if (e instanceof SocialAdapterError) throw e; throw new SocialAdapterError(e.message, e.code === "auth" ? "auth" : "denied"); } };
  return {
    name: "mock", configured: true, hub: h,
    register: (body) => wrap(() => h.register(body)),
    directory: (session, q) => wrap(() => h.directory(who(session), q)),
    push: (session, ops) => wrap(() => h.push(who(session), ops)),
    pull: (session) => wrap(() => h.pull(who(session))),
    audit: (session) => wrap(() => h.audit(who(session))),
  };
}

const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?(\/|$)/i;

// The real server's adapter. Until a server exists and has been reviewed, it is a stub: with no url every call throws
// "not configured", and it refuses any address that isn't this computer (127.0.0.1), so no data can leave by accident.
// allowRemote is the switch for later; nothing in the apps sets it.
export function httpServerAdapter({ url = null, fetch: doFetch = globalThis.fetch, allowRemote = false, timeout = 15_000 } = {}) {
  const base = url ? String(url).replace(/\/+$/, "") : null;
  const why = !base ? "The social server is not configured." : !allowRemote && !LOOPBACK.test(base + "/") ? "The social server is not configured (only a local test server on 127.0.0.1 is allowed until the real server is set up)." : null;
  const notConfigured = async () => { throw new SocialAdapterError(why, "not-configured"); };
  if (why) return { name: "http", configured: false, url: base, register: notConfigured, directory: notConfigured, push: notConfigured, pull: notConfigured, audit: notConfigured };

  async function req(method, path, body, session) {
    const text = body === undefined ? "" : JSON.stringify(body);
    const headers = { "content-type": "application/json" };
    if (session) {
      const ts = new Date().toISOString();
      const digest = createHash("sha256").update(text).digest("base64");
      headers["x-social-user"] = session.userId;
      headers["x-social-device"] = session.identity.deviceId;
      headers["x-social-ts"] = ts;
      headers["x-social-sig"] = signBytes(canonical([method, path, ts, digest]), session.identity);
    }
    let r;
    try { r = await doFetch(base + path, { method, headers, body: text || undefined, signal: AbortSignal.timeout(timeout) }); }
    catch { throw new SocialAdapterError("The social server can't be reached right now.", "offline"); }
    const out = await r.json().catch(() => ({}));
    if (r.ok) return out;
    const kind = r.status === 401 ? "auth" : r.status === 403 ? "denied" : r.status >= 500 || r.status === 429 ? "offline" : "server";
    throw new SocialAdapterError(out.error ?? `The social server answered ${r.status}.`, kind, r.status);
  }
  return {
    name: "http", configured: true, url: base,
    register: (body) => req("POST", "/v1/register", body, null),
    directory: (session, q) => req("POST", "/v1/directory", q ?? {}, session),
    push: (session, ops) => req("POST", "/v1/push", { ops }, session),
    pull: (session) => req("POST", "/v1/pull", {}, session),
    audit: (session) => req("GET", "/v1/audit", undefined, session),
  };
}
