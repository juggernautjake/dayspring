// A stand-in for the Lantern hub (Supabase) for the remote-control tests: auth, PostgREST selects with row level
// security, the dayspring_remote_* functions (the same rules as docs/dev/remote-hub.sql), and Realtime
// (postgres_changes over a Phoenix WebSocket). In memory, on 127.0.0.1, never the real hub.
//   const hub = await startMockHub({ users: [{ email, password }] })
//   hub.url · hub.anonKey · hub.db (the tables, for a "malicious admin" to read and change) · hub.log (every envelope
//   ever stored) · hub.down(true|false) (the internet goes away) · hub.close() · hub.fns (the function names it has)
import { createServer } from "node:http";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";

const b64u = (x) => Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url");
class DbError extends Error { constructor(msg, code = "P0001", status = 400) { super(msg); this.code = code; this.status = status; } }
const deny = (msg) => new DbError(msg, "42501", 403);

export async function startMockHub({ users = [], jwtTtlSec = 3600 } = {}) {
  const SECRET = randomBytes(32);
  const anonKey = "sb_publishable_mock_" + randomBytes(12).toString("hex");
  const db = { users: users.map((u) => ({ id: randomUUID(), email: u.email.toLowerCase(), password: u.password })), sessions: new Map(), refresh: new Map(),
    devices: [], bindings: [], pairings: [], messages: [], usage: new Map(), links: [] };
  const log = [];                                                   // every envelope ever stored (what a hub admin could keep)
  let isDown = false;

  // ---- auth ----
  const jwt = (user, sid) => { const h = b64u({ alg: "HS256", typ: "JWT" }), p = b64u({ sub: user.id, email: user.email, role: "authenticated", session_id: sid, exp: Math.floor(Date.now() / 1000) + jwtTtlSec }); return `${h}.${p}.${createHmac("sha256", SECRET).update(h + "." + p).digest("base64url")}`; };
  function claims(req) {
    const t = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
    const [h, p, s] = t.split(".");
    if (!s || createHmac("sha256", SECRET).update(h + "." + p).digest("base64url") !== s) return null;
    const c = JSON.parse(Buffer.from(p, "base64url").toString());
    return c.exp * 1000 > Date.now() ? c : null;
  }
  function newSession(user) {
    const sid = randomUUID(), rt = randomBytes(16).toString("hex");
    db.sessions.set(sid, { user: user.id }); db.refresh.set(rt, sid);
    return { access_token: jwt(user, sid), refresh_token: rt, expires_in: jwtTtlSec, token_type: "bearer", user: { id: user.id, email: user.email } };
  }

  // ---- the functions (docs/dev/remote-hub.sql, in JavaScript) ----
  const now = () => Date.now();
  const iso = (t = now()) => new Date(t).toISOString();
  const dev = (id) => db.devices.find((d) => d.id === id);
  const caller = (c) => db.bindings.find((b) => b.user_id === c.sub && b.session_id === c.session_id)?.device_id ?? null;
  function require(c, device, approved) {
    if (!device || caller(c) !== device) throw deny("This sign-in doesn't belong to that device.");
    const d = dev(device);
    if (!d || d.user_id !== c.sub || d.status === "revoked") throw deny("This device was signed out.");
    if (approved && d.status !== "approved") throw deny("This device hasn't been approved yet.");
    return d;
  }
  function count(c, kind, limit) {
    const k = `${c.sub}|${Math.floor(now() / 60_000)}|${kind}`;
    const n = (db.usage.get(k) ?? 0) + 1; db.usage.set(k, n);
    if (n > limit) throw new DbError("Too many requests. Wait a minute.", "P0429");
  }
  function purge() { db.messages = db.messages.filter((m) => Date.parse(m.expires_at) >= now()); db.pairings = db.pairings.filter((p) => Date.parse(p.expires_at) >= now() - 3600_000); }
  const changed = (table, type, record) => { for (const s of subs) s.notify(table, type, record); };
  const FNS = {
    dayspring_remote_register(c, a) {
      if (!c.session_id) throw deny("This sign-in has no session id.");
      const others = db.devices.filter((d) => d.user_id === c.sub && d.status === "approved" && d.id !== a.p_id).length;
      const d = dev(a.p_id);
      if (d) {
        if (d.user_id !== c.sub) throw deny("That device id is taken.");
        if (d.sign_pub !== a.p_sign_pub || d.enc_pub !== a.p_enc_pub) throw deny("That device already has other keys.");
        if (d.status === "revoked") return { id: d.id, status: "revoked", first: false, server_time: iso() };
        if (d.status === "pending" && others === 0) { d.status = "approved"; d.cert = a.p_root_cert; d.approved_at = iso(); }
        const b = db.bindings.find((x) => x.device_id === d.id);
        if (b && b.session_id !== c.session_id && db.sessions.has(b.session_id)) throw deny("This device is still signed in with another sign-in.");
        if (!b || b.session_id !== c.session_id) { db.bindings = db.bindings.filter((x) => x.device_id !== d.id); db.bindings.push({ device_id: d.id, user_id: c.sub, session_id: c.session_id }); if (others > 0) d.status = "pending"; }
        Object.assign(d, { name: String(a.p_name || d.name).slice(0, 60), platform: String(a.p_platform ?? "").slice(0, 40), app_version: String(a.p_version ?? "").slice(0, 40), last_seen: iso() });
        changed("dayspring_remote_devices", "UPDATE", d);
        return { id: d.id, status: d.status, first: d.status === "approved" && others === 0, server_time: iso() };
      }
      if (!/^dev_[a-f0-9]{20}$/.test(a.p_id)) throw new DbError("bad id");
      if (db.devices.filter((x) => x.user_id === c.sub && x.status !== "revoked").length >= 20) throw new DbError("You have 20 devices already.", "P0429");
      const first = others === 0;
      const row = { id: a.p_id, user_id: c.sub, name: String(a.p_name || "Dayspring").slice(0, 60), platform: String(a.p_platform ?? ""), app_version: String(a.p_version ?? ""), client: a.p_client || "desk",
        sign_pub: a.p_sign_pub, enc_pub: a.p_enc_pub, status: first ? "approved" : "pending", cert: first ? a.p_root_cert : null, perm_grant: null, revocation: null, profile: null,
        created_at: iso(), approved_at: first ? iso() : null, revoked_at: null, last_seen: iso() };
      db.devices.push(row);
      db.bindings = db.bindings.filter((x) => x.device_id !== a.p_id); db.bindings.push({ device_id: a.p_id, user_id: c.sub, session_id: c.session_id });
      changed("dayspring_remote_devices", "INSERT", row);
      return { id: a.p_id, status: row.status, first, server_time: iso() };
    },
    dayspring_remote_heartbeat(c, a) {
      const d = dev(a.p_device);
      if (!d || d.user_id !== c.sub) return { status: "unknown", server_time: iso() };
      if (caller(c) !== a.p_device) return { status: d.status === "revoked" ? "revoked" : "unbound", server_time: iso() };
      d.last_seen = iso(); return { status: d.status, server_time: iso() };
    },
    dayspring_remote_rename(c, a) { const me = caller(c); require(c, me, me !== a.p_device); const d = dev(a.p_device); if (d && d.user_id === c.sub && d.status !== "revoked") { d.name = String(a.p_name).trim().slice(0, 60); changed("dayspring_remote_devices", "UPDATE", d); } return null; },
    dayspring_remote_set_grant(c, a) {
      const me = caller(c); require(c, me, true);
      if (a.p_grant?.device !== a.p_device || a.p_grant?.by !== me) throw new DbError("That permission change isn't for this device.");
      const d = dev(a.p_device); if (d && d.user_id === c.sub && d.status === "approved") { d.perm_grant = a.p_grant; changed("dayspring_remote_devices", "UPDATE", d); } return null;
    },
    dayspring_remote_set_profile(c, a) { const d = require(c, a.p_device, true); d.profile = a.p_profile; changed("dayspring_remote_devices", "UPDATE", d); return null; },
    dayspring_remote_revoke(c, a) {
      const me = caller(c); require(c, me, me !== a.p_device);
      if (a.p_revocation?.device !== a.p_device || a.p_revocation?.by !== me) throw new DbError("That sign-out isn't for this device.");
      const d = dev(a.p_device); if (!d || d.user_id !== c.sub) return null;
      Object.assign(d, { status: "revoked", revocation: a.p_revocation, revoked_at: iso(), profile: null });
      db.messages = db.messages.filter((m) => !(m.user_id === c.sub && (m.to_device === d.id || m.from_device === d.id)));
      db.pairings = db.pairings.filter((p) => p.device_id !== d.id);
      const b = db.bindings.find((x) => x.device_id === d.id);
      db.bindings = db.bindings.filter((x) => x.device_id !== d.id);
      if (b) { db.sessions.delete(b.session_id); for (const [rt, sid] of db.refresh) if (sid === b.session_id) db.refresh.delete(rt); }
      changed("dayspring_remote_devices", "UPDATE", d);
      return null;
    },
    dayspring_remote_forget(c, a) { require(c, caller(c), true); db.devices = db.devices.filter((d) => !(d.id === a.p_device && d.user_id === c.sub && d.status === "revoked")); return null; },
    dayspring_remote_pair_open(c, a) {
      require(c, a.p_device, false);
      if (dev(a.p_device).status !== "pending") throw new DbError("This device is already approved.");
      if (db.pairings.filter((p) => p.user_id === c.sub && Date.parse(p.created_at) > now() - 3600_000).length >= 10) throw new DbError("Too many requests to join.", "P0429");
      for (const p of db.pairings) if (p.device_id === a.p_device && ["open", "offered"].includes(p.status)) p.status = "cancelled";
      const r = { id: randomUUID(), user_id: c.sub, device_id: a.p_device, approver_id: null, offer: null, approval: null, status: "open", created_at: iso(), expires_at: iso(now() + 10 * 60_000) };
      db.pairings.push(r); changed("dayspring_remote_pairings", "INSERT", r);
      return r;
    },
    dayspring_remote_pair_offer(c, a) {
      require(c, a.p_device, true);
      if (a.p_offer?.approver !== a.p_device || a.p_offer?.pairing !== a.p_pairing) throw new DbError("That answer isn't for this request.");
      const p = db.pairings.find((x) => x.id === a.p_pairing && x.user_id === c.sub && x.status === "open" && Date.parse(x.expires_at) > now() && x.device_id !== a.p_device);
      if (!p) throw new DbError("That request has expired or was already answered.");
      Object.assign(p, { approver_id: a.p_device, offer: a.p_offer, status: "offered" }); changed("dayspring_remote_pairings", "UPDATE", p);
      return null;
    },
    dayspring_remote_pair_approve(c, a) {
      require(c, a.p_device, true);
      const p = db.pairings.find((x) => x.id === a.p_pairing && x.user_id === c.sub);
      if (!p || p.status !== "offered" || p.approver_id !== a.p_device || Date.parse(p.expires_at) < now()) throw new DbError("That request has expired or was answered by another device.");
      if (a.p_cert?.device !== p.device_id || a.p_cert?.by !== a.p_device) throw new DbError("That approval isn't for this request.");
      p.status = "approved"; p.approval = a.p_approval;
      const d = dev(p.device_id); if (d && d.user_id === c.sub && d.status === "pending") Object.assign(d, { status: "approved", cert: a.p_cert, perm_grant: a.p_grant, approved_at: iso() });
      changed("dayspring_remote_pairings", "UPDATE", p); changed("dayspring_remote_devices", "UPDATE", d);
      return null;
    },
    dayspring_remote_pair_cancel(c, a) { const me = caller(c); for (const p of db.pairings) if (p.id === a.p_pairing && p.user_id === c.sub && ["open", "offered"].includes(p.status) && p.device_id === me) { p.status = "cancelled"; changed("dayspring_remote_pairings", "UPDATE", p); } return null; },
    dayspring_remote_pair_reject(c, a) { require(c, caller(c), true); for (const p of db.pairings) if (p.id === a.p_pairing && p.user_id === c.sub && ["open", "offered"].includes(p.status)) { p.status = "rejected"; changed("dayspring_remote_pairings", "UPDATE", p); } return null; },
    dayspring_remote_send(c, a) {
      require(c, a.p_from, true);
      const to = dev(a.p_to);
      if (a.p_to === a.p_from || !to || to.user_id !== c.sub || to.status !== "approved") throw new DbError("That device isn't one of your approved devices.");
      const e = a.p_envelope ?? {};
      if (e.id !== a.p_id || e.from !== a.p_from || e.to !== a.p_to || e.kind !== a.p_kind) throw new DbError("The message doesn't match its envelope.");
      if (JSON.stringify(e).length > 98304) throw new DbError("too big");
      if (!["cmd", "resp", "chunk"].includes(a.p_kind)) throw new DbError("bad kind");
      count(c, "send", 600);
      if (db.messages.filter((m) => m.to_device === a.p_to).length >= 1000) throw new DbError("That device has too many messages waiting.", "P0429");
      if (db.messages.some((m) => m.id === a.p_id)) throw new DbError("duplicate key value violates unique constraint", "23505", 409);
      const ttl = Math.min(Math.max(Number(a.p_ttl_seconds) || 60, 5), a.p_kind === "chunk" ? 120 : 300);
      const row = { id: a.p_id, user_id: c.sub, from_device: a.p_from, to_device: a.p_to, kind: a.p_kind, reply_to: a.p_reply_to ?? null, seq: a.p_seq ?? 0, envelope: e, created_at: iso(), expires_at: iso(now() + ttl * 1000) };
      db.messages.push(row); log.push(structuredClone(row)); changed("dayspring_remote_messages", "INSERT", row);
      return { id: a.p_id, expires_at: row.expires_at };
    },
    dayspring_remote_inbox(c, a) { require(c, a.p_device, true); return db.messages.filter((m) => m.to_device === a.p_device && m.user_id === c.sub && Date.parse(m.expires_at) > now()).slice(0, 200); },
    dayspring_remote_ack(c, a) { require(c, a.p_device, true); const ids = new Set(a.p_ids ?? []); const before = db.messages.length; db.messages = db.messages.filter((m) => !(m.to_device === a.p_device && m.user_id === c.sub && ids.has(m.id))); return before - db.messages.length; },
    dayspring_remote_purge() { purge(); return {}; },
  };
  const TABLES = { dayspring_remote_devices: () => db.devices, dayspring_remote_pairings: () => db.pairings, dayspring_remote_messages: () => db.messages };

  // ---- HTTP ----
  const body = (req) => new Promise((ok) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => ok(s)); });
  const out = (res, status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(obj === undefined ? "" : JSON.stringify(obj)); };
  const server = createServer(async (req, res) => {
    if (isDown) return req.socket.destroy();
    const url = new URL(req.url, "http://x");
    if (req.headers.apikey !== anonKey) return out(res, 401, { message: "Invalid API key" });
    const raw = await body(req);
    const j = raw ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : {};
    try {
      if (url.pathname === "/auth/v1/token") {
        const g = url.searchParams.get("grant_type");
        if (g === "password") { const u = db.users.find((x) => x.email === String(j.email).toLowerCase() && x.password === j.password); if (!u) return out(res, 400, { error_description: "Invalid login credentials" }); return out(res, 200, newSession(u)); }
        if (g === "refresh_token") {
          const sid = db.refresh.get(j.refresh_token); if (!sid || !db.sessions.has(sid)) return out(res, 400, { error_description: "Invalid Refresh Token" });
          db.refresh.delete(j.refresh_token);
          const u = db.users.find((x) => x.id === db.sessions.get(sid).user), rt = randomBytes(16).toString("hex"); db.refresh.set(rt, sid);
          return out(res, 200, { access_token: jwt(u, sid), refresh_token: rt, expires_in: jwtTtlSec, user: { id: u.id, email: u.email } });
        }
      }
      if (url.pathname === "/auth/v1/otp") {
        const u = db.users.find((x) => x.email === String(j.email).toLowerCase());
        if (!u) return out(res, 422, { msg: "Signups not allowed for otp" });
        const s = newSession(u); db.links.push({ email: u.email, redirect: url.searchParams.get("redirect_to"), refresh_token: s.refresh_token });
        return out(res, 200, {});
      }
      if (url.pathname === "/auth/v1/logout") { const c = claims(req); if (c) { db.sessions.delete(c.session_id); for (const [rt, sid] of db.refresh) if (sid === c.session_id) db.refresh.delete(rt); } return out(res, 204); }
      const c = claims(req);
      if (!c) return out(res, 401, { message: "JWT expired or invalid" });
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const fn = FNS[decodeURIComponent(url.pathname.slice("/rest/v1/rpc/".length))];
        if (!fn || /^dayspring_remote_(purge)$/.test(url.pathname.split("/").pop())) return out(res, 404, { message: "function not found" });
        return out(res, 200, structuredClone(fn(c, j) ?? null));
      }
      if (url.pathname.startsWith("/rest/v1/") && req.method === "GET") {
        const t = TABLES[url.pathname.slice("/rest/v1/".length)];
        if (!t) return out(res, 404, { message: "relation does not exist" });
        let rows = t().filter((r) => r.user_id === c.sub);                  // row level security: your own rows only
        for (const [k, v] of url.searchParams) {
          if (["select", "order", "limit"].includes(k)) continue;
          const m = /^(eq|in)\.(.*)$/.exec(v); if (!m) continue;
          if (m[1] === "eq") rows = rows.filter((r) => String(r[k]) === m[2]);
          else { const set = new Set(m[2].replace(/^\(|\)$/g, "").split(",")); rows = rows.filter((r) => set.has(String(r[k]))); }
        }
        const sel = url.searchParams.get("select");
        if (sel && sel !== "*") rows = rows.map((r) => Object.fromEntries(sel.split(",").map((f) => [f, r[f]])));
        return out(res, 200, structuredClone(rows));
      }
      return out(res, 404, { message: "not found" });
    } catch (e) { return out(res, e.status ?? 400, { message: e.message, code: e.code }); }
  });

  // ---- Realtime (postgres_changes; row level security applies: only your own rows) ----
  const subs = new Set();
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, sock, head) => {
    const url = new URL(req.url, "http://x");
    if (isDown || url.pathname !== "/realtime/v1/websocket" || url.searchParams.get("apikey") !== anonKey) return sock.destroy();
    wss.handleUpgrade(req, sock, head, (ws) => {
      const sub = { ws, uid: null, topic: null, changes: [], notify(table, type, record) {
        if (!this.uid || record?.user_id !== this.uid) return;
        for (const ch of this.changes) {
          if (ch.table !== table || (ch.event && ch.event !== "*" && ch.event !== type)) continue;
          if (ch.filter) { const [col, cond] = ch.filter.split("="); if (String(record[col]) !== cond.replace(/^eq\./, "")) continue; }
          try { ws.send(JSON.stringify({ topic: this.topic, event: "postgres_changes", payload: { ids: [1], data: { type, table, schema: "public", record, commit_timestamp: iso() } }, ref: null })); } catch { /* closed */ }
          return;
        }
      } };
      subs.add(sub);
      ws.on("close", () => subs.delete(sub));
      ws.on("message", (m) => {
        let msg; try { msg = JSON.parse(String(m)); } catch { return; }
        if (msg.event === "heartbeat") return ws.send(JSON.stringify({ topic: "phoenix", event: "phx_reply", payload: { status: "ok", response: {} }, ref: msg.ref }));
        if (msg.event === "phx_join") {
          const c = claims({ headers: { authorization: "Bearer " + msg.payload?.access_token } });
          if (!c) return ws.send(JSON.stringify({ topic: msg.topic, event: "phx_reply", payload: { status: "error", response: { reason: "bad token" } }, ref: msg.ref }));
          sub.uid = c.sub; sub.topic = msg.topic; sub.changes = msg.payload?.config?.postgres_changes ?? [];
          return ws.send(JSON.stringify({ topic: msg.topic, event: "phx_reply", payload: { status: "ok", response: { postgres_changes: sub.changes.map((x, i) => ({ ...x, id: i + 1 })) } }, ref: msg.ref }));
        }
      });
    });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url, anonKey, db, log, fns: Object.keys(FNS), subs,
    down(on) { isDown = Boolean(on); if (on) for (const s of subs) { try { s.ws.terminate(); } catch { /* gone */ } } },
    close: () => new Promise((ok) => { for (const s of subs) { try { s.ws.terminate(); } catch { /* gone */ } } wss.close(); server.closeAllConnections?.(); server.close(() => ok()); }),
    session: (email, password) => newSession(db.users.find((u) => u.email === email && u.password === password)),
  };
}
