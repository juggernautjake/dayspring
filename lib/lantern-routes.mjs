// Routes for the Dayspring ↔ Lantern link (lib/lantern.mjs).
//   /api/eco/hello · POST /api/eco/event (Lantern's events; needs Dayspring's token) · GET /api/eco/events (what Dayspring
//   sends, live). All three check the Host header (421) and any Origin (403), per ecosystem-core's contract.
//   /api/lantern/*   for Dayspring's own pages: status, the cards' buttons, connecting, installing, the mic, the AI key
import * as lantern from "./lantern.mjs";

export async function handle(req, res, { m, p, send, readJSON }) {
  if (p.startsWith("/eco")) {
    const eco = lantern.ecoApi();
    if (!eco) return send(res, 503, { error: "Not ready yet." }), true;
    const g = eco.guard(req);
    if (g) return send(res, g.status, { error: g.error }), true;
    if (m === "GET" && p === "/eco/hello") return send(res, 200, hello()), true;
    if (m === "GET" && p === "/eco/events") return lantern.addEcoClient(res), true;
    if (m === "POST" && p === "/eco/event") {
      if (!eco.tokenOk(req)) return send(res, 401, { error: "The ecosystem token is missing or wrong." }), true;
      const ev = await readJSON(req).catch(() => null);
      const r = eco.receive(ev);
      return send(res, r.ok ? 200 : r.status, r), true;
    }
    return send(res, 404, { error: "Not found." }), true;
  }
  if (!p.startsWith("/lantern")) return false;
  try {
    if (m === "GET" && p === "/lantern/status") return send(res, 200, await lantern.summary()), true;
    if (m === "POST" && p === "/lantern/action") { const b = await readJSON(req); return send(res, 200, await lantern.action(String(b.action ?? ""), b.data ?? {})), true; }
    if (m === "POST" && p === "/lantern/open") { const b = await readJSON(req).catch(() => ({})); const r = await lantern.open(b.course ?? null, b.lesson ?? null); return send(res, r.ok ? 200 : 409, r), true; }
    if (m === "POST" && p === "/lantern/hub") return send(res, 200, lantern.setHub(await readJSON(req))), true;
    if (m === "POST" && p === "/lantern/connect") { const b = await readJSON(req); return send(res, 200, await lantern.connectStart(b.email, b.name)), true; }
    if (m === "POST" && p === "/lantern/verify") { const b = await readJSON(req); return send(res, 200, await lantern.connectVerify(b.code)), true; }
    if (m === "POST" && p === "/lantern/password") { const b = await readJSON(req); return send(res, 200, await lantern.connectPassword(b)), true; }
    if (m === "POST" && p === "/lantern/link") { const b = await readJSON(req); return send(res, 200, await lantern.connectLink(b)), true; }
    if (m === "POST" && p === "/lantern/use-lantern") return send(res, 200, await lantern.connectViaLantern()), true;
    if (m === "POST" && p === "/lantern/disconnect") return send(res, 200, lantern.disconnect()), true;
    if (m === "GET" && p === "/lantern/install") return send(res, 200, { job: lantern.installStatus(), defaultDir: lantern.defaultInstallDir() }), true;
    if (m === "POST" && p === "/lantern/install") { const b = await readJSON(req).catch(() => ({})); return send(res, 200, { job: await lantern.install({ dir: b.dir || null, course: b.course ?? null, installNode: Boolean(b.installNode) }) }), true; }
    if (m === "POST" && p === "/lantern/mic") { const b = await readJSON(req); return send(res, 200, { micOwner: lantern.setMicOwner(b.app) }), true; }
    if (m === "POST" && p === "/lantern/key") {
      const b = await readJSON(req);
      if (b.share) return send(res, 200, lantern.shareKey()), true;
      if (b.use !== undefined) return send(res, 200, lantern.useSharedKey(Boolean(b.use))), true;
      return send(res, 400, { error: "Say share or use." }), true;
    }
  } catch (e) { return send(res, 400, { error: e.message }), true; }
  return false;
}
const hello = () => ({ app: "dayspring", version: lantern.version(), schema: 1 });

// the page an emailed "Connect to Lantern" link opens: http://127.0.0.1:<port>/lantern/auth/callback#access_token=…
// Only the page can read the #fragment; it posts the tokens to /api/lantern/link, clears the address and goes to Settings.
export async function handlePage(req, res, { m, pathname }) {
  if (m !== "GET" || pathname !== "/lantern/auth/callback") return false;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" });
  res.end(CALLBACK_HTML);
  return true;
}
const CALLBACK_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connecting to Lantern · Dayspring</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#060812;color:#eef0ff;font:16px/1.5 system-ui,Segoe UI,sans-serif}
.card{max-width:28em;padding:28px 32px;border-radius:14px;background:rgba(20,24,50,.9);border:1px solid rgba(170,180,255,.2);text-align:center}
h1{font-weight:300;letter-spacing:.2em;font-size:20px;margin:0 0 8px}a{color:#8fb8ff}.err{color:#ff9fb0}</style></head>
<body><main class="card"><h1>DAYSPRING</h1><p id="m">Connecting to Lantern…</p></main>
<script>
(async () => {
  const m = document.getElementById("m");
  const h = new URLSearchParams(location.hash.replace(/^#/, ""));
  history.replaceState(null, "", location.pathname);
  const fail = (t) => { m.className = "err"; m.textContent = t + " "; const a = document.createElement("a"); a.href = "/setup#lantern"; a.textContent = "Back to Settings"; m.append(a); };
  if (h.get("error_description")) return fail("That sign-in link didn't work: " + h.get("error_description") + ". Ask for a new one.");
  if (!h.get("refresh_token")) return fail("That sign-in link was incomplete. Ask for a new one.");
  try {
    const r = await fetch("/api/lantern/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refresh_token: h.get("refresh_token") }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return fail(j.error || "Connecting didn't work.");
    m.textContent = "Connected. Dayspring will tell you about course invitations and friend requests.";
    setTimeout(() => location.replace("/setup#lantern"), 1500);
  } catch (e) { fail("Dayspring isn't answering. Is it still running?"); }
})();
</script></body></html>`;
