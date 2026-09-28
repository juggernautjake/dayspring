// Settings → Devices & sign-in (lib/remote): Dayspring on several of his computers, one account.
//   not signed in   the device's name, sign in (email + password, or an emailed link). Nothing is made until then.
//   waiting         "approve me on another device", then the 6-digit code to compare, and "The codes match"
//   approved        this device (rename, accept commands, sign out), requests to join (Review → code → Approve),
//                   all his devices (online, last seen, what each may do, rename, sign out remotely, remove)
// With the "remote" feature off the server answers 404 and this section isn't shown at all.
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const featureOn = (() => { try { const x = new XMLHttpRequest(); x.open("GET", "/api/remote/status", false); x.send(); return x.status === 200; } catch { return false; } })();
  const api = async (path, opts = {}) => {
    const r = await fetch("/api/remote" + path, { ...opts, headers: { "content-type": "application/json" } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "That didn't work. Try again in a moment.");
    return j;
  };
  const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body ?? {}) });
  const ago = (iso) => { if (!iso) return "never"; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 2 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
  let S = null, perms = [];

  const html = () => `
    <h1>Devices &amp; sign-in</h1>
    <p class="lead">Sign in on each computer that runs Dayspring (the TV at home, your laptop, the office PC) with the same account you use for Lantern. Then any of them can ask the others for things over the internet: "turn on my computer at home", "how's printer 3 doing?", "tell the living room TV dinner's ready". No router settings needed.</p>
    <div class="note">🔒 Every command is signed by the device that sends it and encrypted so only the device it's for can read it. The hub in between can't read or fake them. A new device only joins after you approve it on one you already have, by comparing a code on both screens.</div>
    <div id="rmBox" aria-live="polite"><p class="hint">Looking…</p></div>
    <div class="msg" id="rmMsg"></div>`;

  function mount(card, { toast = () => {}, onLeave = () => {} } = {}) {
    const $ = (s) => card.querySelector(s);
    const msg = (t, kind = "") => { const m = $("#rmMsg"); if (m) { m.className = "msg " + kind; m.textContent = t; } };
    const go = async (fn, ok = "") => { try { const r = await fn(); if (ok) msg(ok, "ok"); await paint(); return r; } catch (e) { msg(e.message, "bad"); return null; } };
    let timer = null, reviewing = {};
    onLeave(() => clearInterval(timer));

    const signInForm = () => `
      <h2>Sign in on this computer</h2>
      ${S.hubKnown ? "" : `<p class="hint">First add your account's hub in <a href="#lantern">Settings → Lantern</a> (the address and public key from whoever set up your Lantern account).</p>`}
      <div class="row"><div class="field"><label for="rmName">What to call this computer</label><input id="rmName" type="text" maxlength="60" value="${esc(S.name ?? "")}" placeholder="Office PC, Laptop, Living room TV"></div></div>
      <div class="row"><div class="field"><label for="rmEmail">Your email (the same account as Lantern)</label><input id="rmEmail" type="email" autocomplete="username" placeholder="you@example.com"></div></div>
      <div class="row"><div class="field"><label for="rmPw">Password</label><input id="rmPw" type="password" autocomplete="current-password"></div></div>
      <div class="row" style="gap:.5em"><button class="btn primary" type="button" id="rmSignIn" ${S.hubKnown ? "" : "disabled"}>Sign in</button>
        <button class="btn" type="button" id="rmLink" ${S.hubKnown ? "" : "disabled"}>Email me a sign-in link</button></div>
      <p class="hint">Your password goes straight to the hub and isn't kept. Dayspring doesn't make accounts here: use the one you already have. The first computer you sign in on is approved straight away; every other one needs your OK on one you already have.</p>`;

    const pairingBox = (p) => p.state === "offered" ? `
      <h2>Compare this code</h2>
      <p>On <b>${esc(p.approverName)}</b> you should see the same code:</p>
      <p style="font-size:2.4em;letter-spacing:.12em;font-variant-numeric:tabular-nums;margin:.2em 0" aria-label="Pairing code ${esc(p.code)}"><b>${esc(p.code)}</b></p>
      ${p.confirmed ? `<p class="hint">✓ You said they match. Now press <b>Approve</b> on ${esc(p.approverName)}.</p>` : `<div class="row" style="gap:.5em"><button class="btn primary" type="button" id="rmMatch">The codes match</button><button class="btn" type="button" id="rmNoMatch">They don't match</button></div>
      <p class="hint">If they're different, press "They don't match": someone else may have answered. Nothing joins until the codes match and you approve it on the other device.</p>`}`
      : `<h2>Waiting for approval</h2>
      <p>${p.rejected ? "That request was turned down. A new one has started. " : ""}On one of your other Dayspring computers, open <b>Settings → Devices &amp; sign-in</b> and choose <b>Review</b> next to <b>${esc(S.name)}</b>. A code shows on both screens.</p>
      ${p.warning ? `<p class="hint">⚠️ ${esc(p.warning)}</p>` : ""}<p class="hint">The request lasts 10 minutes; a new one starts by itself.</p>`;

    const permBoxes = (id, on, disabled = false) => perms.map((p) => `<label class="scshow" style="display:block"><input type="checkbox" data-perm="${esc(p.id)}" data-dev="${esc(id)}" ${on.includes(p.id) ? "checked" : ""} ${disabled ? "disabled" : ""}> ${esc(p.label)}</label>`).join("");
    const trustWord = { this: "This computer", approved: "Approved", pending: "Waiting for approval", revoked: "Signed out", unverified: "Not approved (ignored)", "keys-changed": "⚠️ Keys changed (ignored)" };

    async function paint() {
      try { S = await api("/status"); } catch (e) { $("#rmBox").innerHTML = `<p class="bad">${esc(e.message)}</p>`; return; }
      perms = S.perms ?? [];
      const box = $("#rmBox");
      if (!S.signedIn) { box.innerHTML = signInForm(); wireSignIn(); return; }
      if (S.status === "pending") {
        const p = await api("/pairing").catch((e) => ({ state: "waiting", warning: e.message }));
        if (p.state === "approved") return paint();
        box.innerHTML = pairingBox(p) + `<p style="margin-top:1.4em"><button class="btn small" type="button" id="rmOut">Cancel and sign out on this computer</button></p>`;
        $("#rmMatch")?.addEventListener("click", () => go(() => post("/pairing/confirm", { match: true })));
        $("#rmNoMatch")?.addEventListener("click", () => go(() => post("/pairing/confirm", { match: false }), "Cancelled. A new request has started; compare the new code."));
        $("#rmOut")?.addEventListener("click", () => go(() => post("/signout"), "Signed out on this computer."));
        return;
      }
      const [{ devices = [] } = {}, { requests = [] } = {}] = await Promise.all([api("/devices").catch(() => ({})), api("/requests").catch(() => ({}))]);
      const me = devices.find((d) => d.trust === "this");
      const others = devices.filter((d) => d.trust !== "this");
      box.innerHTML = `
        <h2>This computer</h2>
        <p><b>${esc(S.name)}</b> · signed in as ${esc(S.email)} · ${S.connection === "offline" ? "⚠️ can't reach the internet right now (everything on this computer still works)" : S.live === "live" ? "● connected" : "connected"}</p>
        <p class="hint">Its key fingerprint: <code>${esc(S.device?.fingerprint ?? "")}</code></p>
        <div class="row" style="gap:.5em;align-items:flex-end"><div class="field"><label for="rmMyName">Name</label><input id="rmMyName" type="text" maxlength="60" value="${esc(S.name)}"></div><button class="btn" type="button" id="rmRenameMe">Rename</button></div>
        <label class="scshow" style="display:block;margin:.6em 0"><input type="checkbox" id="rmAccept" ${S.accept ? "checked" : ""}> Let my other devices ask this one to do things (each still only what you allow below)</label>
        ${requests.length ? `<h2>Asking to join</h2>${requests.map((r) => `
          <div class="note" style="margin:.5em 0">
            <p><b>${esc(r.device.name)}</b> (${esc(r.device.platform || r.device.client)}${r.device.version ? " · Dayspring " + esc(r.device.version) : ""}) wants to join your devices.</p>
            ${r.other ? `<p class="hint">⚠️ Another device already answered this request. If that wasn't you, turn it down and start again on ${esc(r.device.name)}.</p><button class="btn" type="button" data-reject="${esc(r.id)}">Turn it down</button>`
              : reviewing[r.id] ? `<p>Code: <b style="font-size:1.6em;letter-spacing:.1em">${esc(reviewing[r.id])}</b> Is the same code on ${esc(r.device.name)}'s screen?</p>
                <p class="hint">What it may do:</p>${permBoxes("req-" + r.id, perms.filter((p) => p.default).map((p) => p.id))}
                <div class="row" style="gap:.5em;margin-top:.5em"><button class="btn primary" type="button" data-approve="${esc(r.id)}">Approve</button><button class="btn" type="button" data-reject="${esc(r.id)}">The codes don't match</button></div>`
              : `<div class="row" style="gap:.5em"><button class="btn primary" type="button" data-review="${esc(r.id)}">Review</button><button class="btn" type="button" data-reject="${esc(r.id)}">Turn it down</button></div>`}
          </div>`).join("")}` : ""}
        <h2>Your devices</h2>
        ${others.length ? others.map((d) => `
          <details class="note" style="margin:.5em 0" ${d.trust === "pending" ? "open" : ""}><summary><b>${esc(d.name)}</b> · ${d.online ? "🟢 online" : "⚪ offline"} · last seen ${esc(ago(d.lastSeen))} · ${esc(trustWord[d.trust] ?? d.trust)}</summary>
            <p class="hint">${esc(d.platform || d.client)}${d.version ? " · Dayspring " + esc(d.version) : ""}${d.approvedBy ? " · approved on " + esc(d.approvedBy) : ""}${Object.values(d.names ?? {}).flat().length ? " · controls: " + esc([...new Set(Object.values(d.names).flat())].slice(0, 12).join(", ")) : ""}</p>
            ${d.trust === "approved" ? `<p class="hint">What ${esc(d.name)} may ask your other devices to do:</p>${permBoxes(d.id, d.perms)}
              <div class="row" style="gap:.5em;margin-top:.5em"><button class="btn" type="button" data-perms="${esc(d.id)}">Save what it may do</button>
              <button class="btn" type="button" data-ping="${esc(d.id)}">Say hello</button>
              <button class="btn" type="button" data-rename="${esc(d.id)}" data-name="${esc(d.name)}">Rename</button>
              <button class="btn" type="button" data-revoke="${esc(d.id)}" data-name="${esc(d.name)}">Sign it out remotely</button></div>`
            : d.trust === "revoked" ? `<button class="btn small" type="button" data-forget="${esc(d.id)}">Remove from the list</button>` : ""}
          </details>`).join("") : `<p class="hint">No other devices yet. On another computer, open Dayspring's Settings → Devices &amp; sign-in, sign in with the same account, and approve it here.</p>`}
        <p style="margin-top:1.4em"><button class="btn" type="button" id="rmOut">Sign out on this computer</button> <span class="hint">It stops working with your other devices and its keys are deleted. To add it back, sign in again and approve it.</span></p>`;
      wireApproved();
      void me;
    }

    function wireSignIn() {
      const creds = () => ({ email: $("#rmEmail").value, password: $("#rmPw").value, name: $("#rmName").value });
      $("#rmSignIn")?.addEventListener("click", async () => { msg("Signing in…"); const r = await go(() => post("/signin", creds())); if ($("#rmPw")) $("#rmPw").value = ""; if (r) msg(r.status === "approved" ? "Signed in. This is your first Dayspring device on this account." : "Signed in. Now approve this computer on one of your others.", "ok"); });
      $("#rmLink")?.addEventListener("click", async () => { const c = creds(); const r = await go(() => post("/link", { email: c.email, name: c.name })); if (r) msg("Sent. Open the email on THIS computer and press its link (check spam too).", "ok"); });
    }
    const checked = (id) => [...card.querySelectorAll(`input[data-dev="${CSS.escape(id)}"]`)].filter((i) => i.checked).map((i) => i.dataset.perm);
    function wireApproved() {
      $("#rmRenameMe")?.addEventListener("click", () => go(() => post("/name", { name: $("#rmMyName").value }), "Renamed."));
      $("#rmAccept")?.addEventListener("change", (e) => go(() => post("/accept", { on: e.target.checked })));
      $("#rmOut")?.addEventListener("click", () => { if (confirm("Sign out on this computer? It stops working with your other devices until you sign in and approve it again.")) go(() => post("/signout"), "Signed out on this computer."); });
      card.querySelectorAll("[data-review]").forEach((b) => b.addEventListener("click", async () => { const r = await go(() => post("/requests/review", { id: b.dataset.review })); if (r) { reviewing[b.dataset.review] = r.code; paint(); } }));
      card.querySelectorAll("[data-approve]").forEach((b) => b.addEventListener("click", () => { const id = b.dataset.approve; go(() => post("/requests/approve", { id, perms: checked("req-" + id) }), "Approved. It can now work with your other devices."); delete reviewing[id]; }));
      card.querySelectorAll("[data-reject]").forEach((b) => b.addEventListener("click", () => { delete reviewing[b.dataset.reject]; go(() => post("/requests/reject", { id: b.dataset.reject }), "Turned down."); }));
      card.querySelectorAll("[data-perms]").forEach((b) => b.addEventListener("click", () => go(() => post("/device/perms", { id: b.dataset.perms, perms: checked(b.dataset.perms) }), "Saved.")));
      card.querySelectorAll("[data-ping]").forEach((b) => b.addEventListener("click", async () => { msg("Asking…"); try { const r = await post("/send", { device: b.dataset.ping, action: "ping" }); msg(r.say || (r.ok ? "It answered." : "No answer."), r.ok ? "ok" : "bad"); } catch (e) { msg(e.message, "bad"); } }));
      card.querySelectorAll("[data-rename]").forEach((b) => b.addEventListener("click", () => { const n = prompt("New name for " + b.dataset.name, b.dataset.name); if (n && n.trim()) go(() => post("/device/rename", { id: b.dataset.rename, name: n }), "Renamed."); }));
      card.querySelectorAll("[data-revoke]").forEach((b) => b.addEventListener("click", () => { if (confirm(`Sign out ${b.dataset.name} remotely? Its sign-in ends, it deletes its keys the next time it's online, and your other devices refuse it from now on. To add it back you'd sign in on it and approve it again.`)) go(() => post("/device/revoke", { id: b.dataset.revoke }), `${b.dataset.name} was signed out.`); }));
      card.querySelectorAll("[data-forget]").forEach((b) => b.addEventListener("click", () => go(() => post("/device/forget", { id: b.dataset.forget }), "Removed.")));
    }

    paint();
    // keep the list and the pairing code fresh while this page is open (not while typing in a field)
    timer = setInterval(() => { if (document.hidden || card.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName) || Object.keys(reviewing).length) return; paint(); }, 5000);
  }

  window.DayspringRemote = { enabled: featureOn, html, mount };
})();
