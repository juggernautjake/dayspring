// Settings → Shopping (public/setup.js shows it under "Apps & connections"; the "shopping" feature hides it when off):
// the on/off switch, signing in to Amazon (he signs in himself, in Dayspring's browser window), signed-in status and
// Sign out, Subscribe & Save notices, default filters, and "Ask before opening Amazon pages". Saves with the section
// (moving to another section, or Save); the switches and sign-in buttons act straight away.
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (path, body) => {
    const r = await fetch("/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok && !j.error) j.error = "That didn't work. Try again.";
    return j;
  };
  const featureOn = window.dsFeatures?.on ? window.dsFeatures.on("shopping") !== false : true;
  let root = null, opts = {}, V = null, poll = null;
  const $ = (s) => root?.querySelector(s);
  const sw = (id, on) => { const b = $(id); if (b) b.setAttribute("aria-checked", String(Boolean(on))); };
  const swOn = (id) => $(id)?.getAttribute("aria-checked") === "true";

  function html() {
    return `<h1>Shopping</h1>
      <p class="lead">Ask Dayspring to find things on Amazon (“find a waterproof work boot size 11 under $120 on Amazon”, “is there a 6-outlet smart power strip on Amazon?”). Results show in the Shopping panel (🛒 Shop by the clock), with Amazon's own filters, every picture, the details, the sizes and colours, reviews, comparing, your orders, buying again and Subscribe &amp; Save.</p>
      <div class="note">🔒 <b>Dayspring never buys anything.</b> It never presses Place your order, Buy Now, any 1-Click, Subscribe or Pay, and never touches payment methods, addresses, your password, security or Prime. Adding to your cart asks for your yes first. “Buy now” stops at Amazon's checkout page, shown to you with <b>Review and press Place order yourself</b>. You sign in to Amazon yourself; Dayspring never sees, types or keeps your password or codes, and never keeps card details.</div>
      <div class="toggle"><div class="txt"><b id="shs-on-l">Shopping on Amazon</b><div>Off until you turn it on. While it's off Dayspring never opens Amazon.</div></div><button type="button" class="sw" role="switch" id="shs-on" aria-labelledby="shs-on-l" aria-checked="false"></button></div>
      <h2>Amazon sign-in</h2>
      <p class="hint">Sign in once, in Dayspring's own browser window (the same one YouTube and Spotify use). It stays signed in. amazon.com (United States) only, for now.</p>
      <div id="shs-sign" class="hint" aria-live="polite">Loading…</div>
      <div class="row" style="gap:.5em;flex-wrap:wrap"><button type="button" class="btn small" id="shs-signin">Sign in to Amazon</button><button type="button" class="btn small ghost" id="shs-check">Check</button><button type="button" class="btn small ghost" id="shs-signout">Sign out</button></div>
      <div id="shs-signout-msg" class="hint" aria-live="polite"></div>
      <h2>Subscribe &amp; Save notices</h2>
      <div class="toggle"><div class="txt"><b id="shs-notify-l">Tell me about new subscriptions and upcoming deliveries</b><div>At most once a day, at a calm pace, Dayspring looks at your Subscribe &amp; Save deliveries and tells you what's new or coming soon, with “Want me to skip it?” (only with your yes). Off: nothing checks Amazon at all.</div></div><button type="button" class="sw" role="switch" id="shs-notify" aria-labelledby="shs-notify-l" aria-checked="false"></button></div>
      <div class="field"><label for="shs-days">Tell me about deliveries in the next</label><select id="shs-days"><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option></select></div>
      <h2>Default filters</h2>
      <p class="hint">Used for every search unless you say otherwise.</p>
      <div class="toggle"><div class="txt"><b id="shs-prime-l">Prime only</b><div>Only items with Prime delivery.</div></div><button type="button" class="sw" role="switch" id="shs-prime" aria-labelledby="shs-prime-l" aria-checked="false"></button></div>
      <div class="row">
        <div class="field"><label for="shs-max">Highest price ($, blank for none)</label><input id="shs-max" type="number" min="1" step="1"></div>
        <div class="field"><label for="shs-rate">Lowest rating</label><select id="shs-rate"><option value="">Any</option><option value="4">4 stars &amp; up</option><option value="3">3 stars &amp; up</option></select></div>
      </div>
      <h2>Opening Amazon</h2>
      <div class="toggle"><div class="txt"><b id="shs-ask-l">Ask before opening Amazon pages</b><div>Dayspring asks “Okay to open Amazon?” before it looks anything up there; a yes covers the next 15 minutes.</div></div><button type="button" class="sw" role="switch" id="shs-ask" aria-labelledby="shs-ask-l" aria-checked="false"></button></div>
      <div class="msg" id="m" aria-live="polite"></div>`;
  }
  function paint() {
    const s = V.settings ?? {};
    sw("#shs-on", s.enabled); sw("#shs-notify", s.notify); sw("#shs-prime", s.defaults?.prime); sw("#shs-ask", s.askBeforeOpen);
    $("#shs-days").value = String(s.notifyDays ?? 7);
    $("#shs-max").value = s.defaults?.maxPrice ?? "";
    $("#shs-rate").value = s.defaults?.minRating ? String(s.defaults.minRating) : "";
    const on = Boolean(s.enabled);
    for (const id of ["#shs-signin", "#shs-check", "#shs-signout"]) $(id).disabled = !on;
    $("#shs-sign").innerHTML = !on ? "Turn Shopping on first." : V.paused ? "⏸ Paused: Amazon is showing a robot check in Dayspring's browser window. Solve it there yourself." : V.signedIn ? `✓ Signed in to Amazon${V.account ? ` as <b>${esc(V.account)}</b>` : ""}.` : V.signedIn === false ? "Not signed in to Amazon yet." : "Not checked yet. Press Check (it opens Dayspring's browser window in the background).";
  }
  async function load() { const r = await api("/shopping/status"); if (r.error) throw new Error(r.error); V = r; paint(); }
  async function setNow(patch) { const r = await api("/shopping/settings", patch); if (r.status) { V = r.status; paint(); } return r; }

  function mount(card, o = {}) {
    root = card; opts = o;
    $("#shs-on").onclick = async () => { const want = !swOn("#shs-on"); await setNow({ enabled: want }); opts.toast?.(want ? "Shopping is on" : "Shopping is off"); };
    $("#shs-notify").onclick = async () => { const want = !swOn("#shs-notify"); await setNow({ notify: want }); };
    $("#shs-ask").onclick = async () => { const want = !swOn("#shs-ask"); await setNow({ askBeforeOpen: want }); };
    $("#shs-prime").onclick = () => { sw("#shs-prime", !swOn("#shs-prime")); card.dispatchEvent(new Event("change", { bubbles: true })); };
    $("#shs-signin").onclick = async () => { const r = await api("/shopping/signin", {}); $("#shs-signout-msg").textContent = r.reply ?? r.error ?? ""; clearInterval(poll); poll = setInterval(() => load().catch(() => {}), 3000); setTimeout(() => clearInterval(poll), 15 * 60_000); };
    $("#shs-check").onclick = async () => { $("#shs-sign").textContent = "Checking…"; const r = await api("/shopping/signin/check", {}); await load().catch(() => {}); $("#shs-signout-msg").textContent = r.reply ?? r.error ?? ""; };
    $("#shs-signout").onclick = async () => { const r = await api("/shopping/signout", {}); await load().catch(() => {}); $("#shs-signout-msg").textContent = r.reply ?? r.error ?? ""; };
    opts.onLeave?.(() => clearInterval(poll));
    load().catch((e) => { $("#shs-sign").textContent = e.message; });
  }
  async function save() {
    if (!root || !V) return;
    const max = $("#shs-max").value.trim();
    const r = await api("/shopping/settings", { notifyDays: Number($("#shs-days").value) || 7, defaults: { prime: swOn("#shs-prime"), maxPrice: max ? Number(max) : null, minRating: $("#shs-rate").value ? Number($("#shs-rate").value) : null } });
    if (r.error) throw new Error(r.error);
    if (r.status) { V = r.status; paint(); }
  }
  window.DayspringShoppingSettings = { html, mount, save, enabled: featureOn };
})();
