// Remote control: talking to the hub (the same Supabase project as the Lantern account). Plain fetch and the built-in
// WebSocket; no client library. Same shape as Lantern's adapter (lantern/server/src/platform/sync/supabase.js).
//
//   createHub({ url, anonKey, fetch, WebSocket, timeoutMs })
//     auth:  signIn(email, password) · sendLink(email, redirectTo) · refresh(refreshToken) · signOut(token)
//     data:  rpc(name, args, token) · select(table, query, token)
//     live:  live({ token: async () => jwt, topics: [{ table, filter, event }], onChange, onState }) → { stop() }
//     clockOffset()  hub time minus this computer's time (from the hub's Date header)
// Errors carry .kind: "offline" (no network or the hub is down), "auth" (signed out), "denied", "hub" (the hub said no).
// Only the PUBLIC (publishable/anon) key is ever used; a secret key is refused.

export class HubError extends Error {
  constructor(message, kind = "hub", status = 0) { super(message); this.name = "HubError"; this.kind = kind; this.status = status; }
}
export const isSecretKey = (k) => /service_role|sb_secret_/i.test(String(k)) || (() => { try { return JSON.parse(Buffer.from(String(k).split(".")[1] ?? "", "base64url").toString()).role === "service_role"; } catch { return false; } })();

export function createHub({ url, anonKey, fetch: doFetch = globalThis.fetch, WebSocket: WS = globalThis.WebSocket, timeoutMs = 10_000 }) {
  if (!url || !anonKey) throw new HubError("Dayspring doesn't know your account's hub yet (Settings → Lantern → Your Lantern hub).", "hub");
  if (isSecretKey(anonKey)) throw new HubError("That's a SECRET hub key. Dayspring only ever uses the public one.", "hub");
  const base = String(url).replace(/\/+$/, "");
  const clock = { offset: 0, n: 0 };

  async function req(path, init = {}, token = null) {
    const headers = { apikey: anonKey, "content-type": "application/json", ...(init.headers ?? {}) };
    if (token) headers.authorization = "Bearer " + token;
    let r;
    try { r = await doFetch(base + path, { ...init, headers, signal: AbortSignal.timeout(init.timeout ?? timeoutMs) }); }
    catch { throw new HubError("I can't reach the internet right now, so I can't reach your other devices. Everything on this computer still works.", "offline"); }
    if (r.status >= 500 || r.status === 429) throw new HubError(r.status === 429 ? "The hub says too many requests. Try again in a minute." : `The hub is busy or down (${r.status}). Try again in a little while.`, "offline", r.status);
    try { const d = Date.parse(r.headers.get("date") ?? ""); if (!Number.isNaN(d)) { const off = d + 500 - Date.now(); clock.offset = clock.n ? Math.round(clock.offset * 0.7 + off * 0.3) : off; clock.n++; } } catch { /* no date */ }
    return r;
  }
  async function jsonOf(r) {
    const text = await r.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
    if (r.ok) return body;
    const msg = body?.msg || body?.message || body?.error_description || body?.error || `The hub answered ${r.status}.`;
    if (r.status === 401 || (r.status === 403 && /jwt|token/i.test(msg))) throw new HubError(msg, "auth", r.status);
    if (r.status === 403 || body?.code === "42501") throw new HubError(msg, "denied", r.status);
    throw new HubError(msg, "hub", r.status);
  }
  const session = (b) => {
    if (!b?.access_token) return null;
    return { access_token: b.access_token, refresh_token: b.refresh_token, expires_at: b.expires_at ? b.expires_at * 1000 : Date.now() + (Number(b.expires_in) || 3600) * 1000,
      user: b.user ? { id: b.user.id, email: b.user.email } : null };
  };

  const api = {
    url: base,
    clockOffset: () => clock.offset,
    async signIn(email, password) {
      let b;
      try { b = await jsonOf(await req("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) })); }
      catch (e) { if (e.kind === "hub" || e.kind === "auth") throw new HubError(/invalid login|credentials/i.test(e.message) ? "That email and password don't match. Try again, or use \"Email me a sign-in link\"." : /not confirmed/i.test(e.message) ? "That email isn't confirmed yet. Press the link in the email the hub sent, then try again." : e.message, "auth", e.status); throw e; }
      const s = session(b); if (!s) throw new HubError("Signing in didn't work.", "auth"); return s;
    },
    // an emailed sign-in link; the account must already exist (Dayspring never makes accounts here)
    async sendLink(email, redirectTo) {
      const q = redirectTo ? "?redirect_to=" + encodeURIComponent(redirectTo) : "";
      await jsonOf(await req("/auth/v1/otp" + q, { method: "POST", body: JSON.stringify({ email, create_user: false }) }));
      return true;
    },
    async refresh(refreshToken) {
      const s = session(await jsonOf(await req("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) })));
      if (!s) throw new HubError("Your sign-in has expired. Sign in again.", "auth"); return s;
    },
    async signOut(token) { try { await req("/auth/v1/logout", { method: "POST", body: "{}" }, token); } catch { /* signing out here is what matters */ } },
    async rpc(name, args, token) { return jsonOf(await req("/rest/v1/rpc/" + encodeURIComponent(name), { method: "POST", body: JSON.stringify(args ?? {}) }, token)); },
    async select(table, query, token) { return jsonOf(await req(`/rest/v1/${encodeURIComponent(table)}?${query}`, { method: "GET" }, token)); },

    // Live updates (Supabase Realtime, postgres_changes). Used only as a doorbell: a change means "look now"; what's in
    // it is fetched and checked the normal way. Reconnects with a growing wait (1 s → 60 s), never a tight loop.
    live({ token, topics, onChange, onState = () => {} }) {
      if (typeof WS !== "function") { onState("unavailable"); return { stop() {}, state: () => "unavailable" }; }
      let ws = null, stopped = false, ref = 0, hb = null, wait = 1000, state = "connecting", retry = null;
      const set = (s) => { state = s; try { onState(s); } catch { /* ignore */ } };
      const wsUrl = base.replace(/^http/i, "ws") + "/realtime/v1/websocket?apikey=" + encodeURIComponent(anonKey) + "&vsn=1.0.0";
      const topic = "realtime:ds-remote";
      const sendJ = (o) => { try { ws?.readyState === 1 && ws.send(JSON.stringify(o)); } catch { /* closed */ } };
      async function connect() {
        if (stopped) return;
        let jwt; try { jwt = await token(); } catch { return later(); }
        if (!jwt) return later();
        try { ws = new WS(wsUrl); } catch { return later(); }
        ws.onopen = () => {
          const r = String(++ref);
          sendJ({ topic, event: "phx_join", ref: r, join_ref: r, payload: { access_token: jwt, config: { broadcast: { self: false }, presence: { key: "" }, private: false,
            postgres_changes: topics.map((t) => ({ event: t.event ?? "*", schema: "public", table: t.table, ...(t.filter ? { filter: t.filter } : {}) })) } } });
          clearInterval(hb);
          hb = setInterval(async () => {
            sendJ({ topic: "phoenix", event: "heartbeat", payload: {}, ref: String(++ref) });
            try { const j = await token(); if (j && j !== jwt) { jwt = j; sendJ({ topic, event: "access_token", payload: { access_token: j }, ref: String(++ref) }); } } catch { /* next time */ }
          }, 25_000);
          hb.unref?.();
        };
        ws.onmessage = (m) => {
          let msg; try { msg = JSON.parse(typeof m.data === "string" ? m.data : Buffer.from(m.data).toString("utf8")); } catch { return; }
          if (msg.event === "phx_reply" && msg.topic === topic) { if (msg.payload?.status === "ok") { wait = 1000; set("live"); } else set("refused"); }
          else if (msg.event === "postgres_changes") { try { onChange(msg.payload?.data ?? msg.payload); } catch { /* the engine logs its own */ } }
          else if (msg.event === "phx_error" || msg.event === "system" && msg.payload?.status === "error") set("error");
        };
        ws.onclose = () => { clearInterval(hb); if (!stopped) later(); };
        ws.onerror = () => { /* onclose follows */ };
      }
      function later() {
        if (stopped) return;
        set("reconnecting");
        clearTimeout(retry);
        retry = setTimeout(connect, wait); retry.unref?.();
        wait = Math.min(wait * 2, 60_000);
      }
      connect();
      return { stop() { stopped = true; clearInterval(hb); clearTimeout(retry); try { ws?.close(); } catch { /* gone */ } set("stopped"); }, state: () => state };
    },
  };
  return api;
}
