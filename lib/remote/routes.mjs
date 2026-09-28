// Routes for Settings → Devices & sign-in and the camera viewer (lib/remote). Local only, like every Dayspring route
// (server.mjs refuses other hosts and other sites). With the "remote" feature off, none of these exist (404).
//   GET  /api/remote/status                      this device: signed in?, approved?, connection
//   POST /api/remote/signin {email,password}     the owner's own sign-in (never stored; only the hub's session is kept)
//   POST /api/remote/link {email}                "Email me a sign-in link" → /remote/auth/callback
//   POST /api/remote/link/complete {refresh_token}
//   POST /api/remote/signout                     sign out here (and revoke this device)
//   GET  /api/remote/devices                     all his devices
//   GET  /api/remote/pairing · POST /api/remote/pairing/confirm {match}          the new device's side
//   GET  /api/remote/requests · POST /api/remote/requests/{review,approve,reject} {id, perms}   an approved device's side
//   POST /api/remote/device/{rename,perms,revoke,forget} {id, name | perms}
//   POST /api/remote/name {name} · POST /api/remote/accept {on}
//   POST /api/remote/send {device, action, args, confirmed}                     (Settings: ping, status)
//   GET  /api/remote/camera?device=&action=&target=   a fresh still (the viewer's "live" asks every few seconds)
//   GET  /api/remote/still/<id>                  a picture already fetched (a camera alert, the last still)
import * as remote from "./index.mjs";
import { PERMS, PERM_WORDS, DEFAULT_PERMS, LIMITS, isRisky } from "./policy.mjs";

const PORT = () => Number(process.env.PORT) || 4747;
export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (!p.startsWith("/remote")) return false;
  if (!remote.enabled()) return false;                          // not ours: 404 like any unknown path
  try {
    if (m === "GET" && p.startsWith("/remote/still/")) {
      const s = remote.stills.get(p.slice("/remote/still/".length));
      if (!s) return send(res, 404, { error: "That picture is gone." }), true;
      res.writeHead(200, { "content-type": s.contentType, "cache-control": "no-store", "x-content-type-options": "nosniff" }); res.end(s.bytes); return true;
    }
    if (m === "GET" && p === "/remote/status") {
      const e = await remote.engine();
      const base = { enabled: true, perms: PERMS.map((k) => ({ id: k, label: PERM_WORDS[k], default: DEFAULT_PERMS.includes(k) })), limits: { liveFrameMs: LIMITS.LIVE_FRAME_MS, liveMaxMs: LIMITS.LIVE_MAX_MS } };
      if (!e) { const hub = await hubKnown(); return send(res, 200, { ...base, hubKnown: hub, signedIn: false, status: "none" }), true; }
      return send(res, 200, { ...base, ...e.status() }), true;
    }
    if (m === "POST" && p === "/remote/signin") {
      const b = await readJSON(req); const e = await remote.engine({ create: true }); await e.refreshHub();
      const r = await e.signIn({ email: b.email, password: b.password, name: b.name });
      await remote.start({});
      return send(res, 200, r), true;
    }
    if (m === "POST" && p === "/remote/link") {
      const b = await readJSON(req); const e = await remote.engine({ create: true }); await e.refreshHub();
      return send(res, 200, await e.sendLink(b.email, `http://127.0.0.1:${PORT()}/remote/auth/callback`, b.name)), true;
    }
    if (m === "POST" && p === "/remote/link/complete") {
      const b = await readJSON(req); const e = await remote.engine({ create: true }); await e.refreshHub();
      const r = await e.completeLink(b); await remote.start({});
      return send(res, 200, r), true;
    }
    const e = await remote.engine();
    if (!e) return send(res, 409, { error: "Sign in on this device first." }), true;
    if (m === "POST" && p === "/remote/name") { const b = await readJSON(req); return send(res, 200, await e.setName(b.name)), true; }
    if (m === "POST" && p === "/remote/signout") return send(res, 200, await e.signOutHere()), true;
    if (m === "POST" && p === "/remote/accept") { const b = await readJSON(req); return send(res, 200, e.setAccept(Boolean(b.on))), true; }
    if (m === "GET" && p === "/remote/devices") return send(res, 200, { devices: await e.devices(), status: e.status() }), true;
    if (m === "GET" && p === "/remote/pairing") return send(res, 200, await e.pairingView()), true;
    if (m === "POST" && p === "/remote/pairing/confirm") { const b = await readJSON(req); return send(res, 200, await e.confirmPairing(Boolean(b.match))), true; }
    if (m === "GET" && p === "/remote/requests") return send(res, 200, { requests: await e.requests() }), true;
    if (m === "POST" && p.startsWith("/remote/requests/")) {
      const b = await readJSON(req), what = p.slice("/remote/requests/".length);
      if (what === "review") return send(res, 200, await e.review(String(b.id))), true;
      if (what === "approve") return send(res, 200, await e.approve(String(b.id), Array.isArray(b.perms) ? b.perms : DEFAULT_PERMS)), true;
      if (what === "reject") return send(res, 200, await e.reject(String(b.id))), true;
    }
    if (m === "POST" && p.startsWith("/remote/device/")) {
      const b = await readJSON(req), what = p.slice("/remote/device/".length), id = String(b.id ?? "");
      if (what === "rename") return send(res, 200, await e.rename(id, b.name)), true;
      if (what === "perms") return send(res, 200, await e.setPerms(id, b.perms)), true;
      if (what === "revoke") return send(res, 200, await e.revoke(id)), true;
      if (what === "forget") return send(res, 200, await e.forget(id)), true;
    }
    if (m === "POST" && p === "/remote/send") {
      const b = await readJSON(req);
      const args = b.args && typeof b.args === "object" ? b.args : {};
      // a risky command from the Settings page needs the page's own "Are you sure?" (it sends confirmed: true after it)
      if (isRisky(String(b.action), args) && b.confirmed !== true) return send(res, 200, { ok: false, needsConfirm: true, say: "That needs your OK first." }), true;
      const r = await e.send(String(b.device), String(b.action), args, { confirmed: b.confirmed === true });
      return send(res, 200, { ...r, bytes: undefined }), true;
    }
    if (m === "GET" && p === "/remote/camera") {
      const device = String(q.get("device") ?? ""), action = String(q.get("action") ?? "printers.camera"), target = String(q.get("target") ?? "");
      if (!["printers.camera", "cameras.snapshot"].includes(action)) return send(res, 400, { error: "Not a camera." }), true;
      const key = device + "|" + action + "|" + target;
      if (busy.has(key)) return send(res, 429, { error: "Still getting the last picture." }), true;
      busy.add(key);
      try {
        const r = await e.send(device, action, action === "printers.camera" ? { printer: target || null } : { camera: target || null });
        if (!r?.bytes) return send(res, r?.offline ? 409 : 502, { error: r?.say ?? "No picture came back." }), true;
        const id = remote.keepStill({ bytes: r.bytes, contentType: r.contentType, device: { name: r.from }, label: target });
        res.writeHead(200, { "content-type": r.contentType ?? "image/jpeg", "cache-control": "no-store", "x-still": id, "x-content-type-options": "nosniff" }); res.end(r.bytes); return true;
      } finally { busy.delete(key); }
    }
  } catch (err) { return send(res, err?.kind === "offline" ? 503 : 400, { error: err?.message ?? String(err), kind: err?.kind ?? null }), true; }
  return false;
}
const busy = new Set();
async function hubKnown() { try { const l = await import("../lantern.mjs"); return Boolean(l.hubConfig()); } catch { return false; } }

// /remote/auth/callback: the page an emailed sign-in link opens. Only the page can read the #fragment; it posts the
// refresh token here, clears the address bar, and goes back to Settings → Devices & sign-in.
// /devices-panel.js: with the feature off it's an empty script, so Settings has no Devices section at all.
export async function handlePage(req, res, { m, pathname }) {
  if (m !== "GET") return false;
  if (pathname === "/devices-panel.js" && !remote.enabled()) { res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" }); res.end("/* remote control is off in this channel */\n"); return true; }
  if (pathname === "/remote-view.html" && !remote.enabled()) { res.writeHead(404, { "content-type": "text/plain" }); res.end("Not found."); return true; }
  if (pathname !== "/remote/auth/callback" || !remote.enabled()) return false;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" });
  res.end(CALLBACK_HTML);
  return true;
}
const CALLBACK_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Signing in · Dayspring</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#060812;color:#eef0ff;font:16px/1.5 system-ui,Segoe UI,sans-serif}
.card{max-width:28em;padding:28px 32px;border-radius:14px;background:rgba(20,24,50,.9);border:1px solid rgba(170,180,255,.2);text-align:center}
h1{font-weight:300;letter-spacing:.2em;font-size:20px;margin:0 0 8px}a{color:#8fb8ff}.err{color:#ff9fb0}</style></head>
<body><main class="card"><h1>DAYSPRING</h1><p id="m">Signing in this device…</p></main>
<script>
(async () => {
  const m = document.getElementById("m");
  const h = new URLSearchParams(location.hash.replace(/^#/, ""));
  history.replaceState(null, "", location.pathname);
  const fail = (t) => { m.className = "err"; m.textContent = t + " "; const a = document.createElement("a"); a.href = "/setup#devices"; a.textContent = "Back to Settings"; m.append(a); };
  if (h.get("error_description")) return fail("That sign-in link didn't work: " + h.get("error_description") + ". Ask for a new one.");
  if (!h.get("refresh_token")) return fail("That sign-in link was incomplete. Ask for a new one.");
  try {
    const r = await fetch("/api/remote/link/complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refresh_token: h.get("refresh_token") }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return fail(j.error || "Signing in didn't work.");
    m.textContent = j.status === "pending" ? "Signed in. Now approve this device on one of your other Dayspring devices." : "Signed in.";
    setTimeout(() => location.replace("/setup#devices"), 1500);
  } catch (e) { fail("Dayspring isn't answering. Is it still running?"); }
})();
</script></body></html>`;
