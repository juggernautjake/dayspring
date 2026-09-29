// Settings → Maps (public/setup.js shows it under "Apps & connections"; the "maps" feature hides it when off):
// which maps to use (automatic: Google when a key is saved, otherwise the free OpenStreetMap maps), the Google Maps key
// (saved to .env, never shown again) with a Test button and the step-by-step guide to making a safe, capped key, an
// optional free OpenRouteService key, units, the usual way of getting around, spoken guidance, the demo's pace, the
// "leave by" cushion, and the two Google extras that cost more (ratings and hours, live traffic).
// Keys save straight away (Save key); everything else saves with the section (moving to another section, or Save).
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (path, body) => {
    const r = await fetch("/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "That didn't work. Try again.");
    return j;
  };
  const featureOn = window.dsFeatures?.on ? window.dsFeatures.on("maps") !== false : true;
  let root = null, opts = {}, V = null;
  const $ = (s) => root?.querySelector(s);

  function html() {
    return `<h1>Maps</h1>
      <p class="lead">A map on the Dayspring screen (🗺 Maps by the clock): search for places, get directions for driving, walking or cycling, and have them read to you step by step. Say “find coffee near me”, “directions to the library”, “read the directions”, “next step”, “send the directions to my phone”.</p>
      <div class="note">It works right away with <b>no key</b>, using free OpenStreetMap maps. Add a Google Maps key below and Dayspring switches to Google by itself (ratings, better search, bus and train directions). <b>This computer has no GPS</b>: “near me” and directions start from your home in <a href="#" data-go="location">Where you are</a>, unless you type or say another start.</div>
      <div id="mps-status" class="hint" aria-live="polite">Loading…</div>
      <h2>Which maps</h2>
      <div class="field"><label for="mps-provider">Maps</label><select id="mps-provider">
        <option value="auto">Automatic: Google when a key is saved, otherwise OpenStreetMap</option>
        <option value="osm">Always the free OpenStreetMap maps</option>
        <option value="google">Always Google (needs the key below)</option></select></div>
      <h2>Google Maps key</h2>
      <p class="hint">Optional. Kept in Dayspring's <b>.env</b> file on this computer and never shown again. <span id="mps-gstate"></span></p>
      <div class="row" style="align-items:flex-end;gap:.5em;flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:16em"><label for="mps-gkey">Paste the key</label><input id="mps-gkey" type="password" autocomplete="off" spellcheck="false" placeholder="AIza…"></div>
        <button type="button" class="btn small" id="mps-gsave">Save key</button><button type="button" class="btn small ghost" id="mps-gtest">Test</button><button type="button" class="btn small ghost" id="mps-gclear">Remove key</button>
      </div>
      <div id="mps-gtestout" class="hint" aria-live="polite"></div>
      <details class="note"><summary><b>How to make a Google Maps key safely (about 10 minutes)</b></summary>
        <ol>
          <li>Open the <a href="https://console.cloud.google.com/" data-link>Google Cloud console</a> and pick your project at the top (or make one, for example “Dayspring”).</li>
          <li><b>Billing:</b> Google asks for a billing account even for the free amounts. Turn it on under Billing.</li>
          <li><b>Turn on three APIs</b> (APIs &amp; Services → Library): <b>Maps Embed API</b> (the map itself; free, no limit), <b>Places API (New)</b> (search) and <b>Routes API</b> (directions).</li>
          <li><b>Make the key:</b> APIs &amp; Services → Credentials → Create credentials → API key.</li>
          <li><b>Restrict it:</b> edit the key → API restrictions → Restrict key → tick only Maps Embed API, Places API (New) and Routes API. (Leave Application restrictions on None: Dayspring asks Google from this computer, not from a website. If your home internet address never changes you can use an IP address restriction instead.)</li>
          <li><b>Cap it so it can't cost money:</b> for Places API (New) and Routes API open Quotas &amp; System Limits and lower the requests per day (100 a day is plenty for one person). Then Billing → Budgets &amp; alerts → a small budget (like $1) with email alerts. A budget only warns; the quotas are what stop it.</li>
          <li>Copy the key, paste it above, press <b>Save key</b>, then <b>Test</b>.</li>
        </ol>
        <p class="hint">What's free each month (Google's prices from March 2025): the map, always; search 5,000 (1,000 with ratings and hours turned on below); directions 10,000 (5,000 with live traffic). Dayspring caches answers so the same search twice asks once.</p>
      </details>
      <h2>OpenRouteService key (optional, free)</h2>
      <p class="hint">Better free walking and cycling routes and avoiding highways or tolls: 2,000 routes a day. <a href="https://openrouteservice.org/dev/#/signup" data-link>Sign up</a>, copy the key from the dashboard, paste it here. Without it, the free FOSSGIS route servers are used. <span id="mps-ostate"></span></p>
      <div class="row" style="align-items:flex-end;gap:.5em;flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:16em"><label for="mps-okey">Paste the key</label><input id="mps-okey" type="password" autocomplete="off" spellcheck="false"></div>
        <button type="button" class="btn small" id="mps-osave">Save key</button><button type="button" class="btn small ghost" id="mps-otest">Test</button><button type="button" class="btn small ghost" id="mps-oclear">Remove key</button>
      </div>
      <div id="mps-otestout" class="hint" aria-live="polite"></div>
      <h2>Directions</h2>
      <div class="row">
        <div class="field"><label for="mps-units">Distances in</label><select id="mps-units"><option value="mi">Miles and feet</option><option value="km">Kilometers and meters</option></select></div>
        <div class="field"><label for="mps-mode">Usually travel by</label><select id="mps-mode"><option value="driving">Car</option><option value="walking">Walking</option><option value="cycling">Bike</option><option value="transit">Bus or train (Google only)</option></select></div>
      </div>
      <div class="toggle"><div class="txt"><b id="mps-voice-l">Say each step out loud</b><div>“In half a mile, turn left onto Main Street.” Steps wait while you're talking, like everything Dayspring says.</div></div><button type="button" class="sw" role="switch" id="mps-voice" aria-labelledby="mps-voice-l" aria-checked="true"></button></div>
      <div class="row">
        <div class="field"><label for="mps-auto">Demo: seconds between steps</label><input id="mps-auto" type="number" min="3" max="60" step="1"><div class="hint">“Demo the directions” reads every step on a timer, to hear how guidance sounds.</div></div>
        <div class="field"><label for="mps-buffer">“Leave by”: extra minutes</label><input id="mps-buffer" type="number" min="0" max="60" step="1"><div class="hint">Added to the trip time for schedule items with a place (parking, walking in).</div></div>
      </div>
      <h2>Google extras (cost more)</h2>
      <div class="toggle"><div class="txt"><b id="mps-rich-l">Ratings and opening hours in search results</b><div>Uses Google's higher search tier: 1,000 free searches a month instead of 5,000.</div></div><button type="button" class="sw" role="switch" id="mps-rich" aria-labelledby="mps-rich-l" aria-checked="false"></button></div>
      <div class="toggle"><div class="txt"><b id="mps-traffic-l">Live traffic in driving times</b><div>Uses Google's higher directions tier: 5,000 free a month instead of 10,000.</div></div><button type="button" class="sw" role="switch" id="mps-traffic" aria-labelledby="mps-traffic-l" aria-checked="false"></button></div>
      <p class="hint">Live turn-by-turn navigation needs a moving position (GPS). This computer has none, so steps move on when you say “next”. Send a trip to your phone (📱, or the QR code) to drive with it there.</p>
      <div class="msg" id="m" aria-live="polite"></div>`;
  }
  const sw = (id, on) => { const b = $(id); if (b) b.setAttribute("aria-checked", String(Boolean(on))); };
  const swOn = (id) => $(id)?.getAttribute("aria-checked") === "true";
  function paint() {
    const s = V.settings, k = V.keys, sv = V.services;
    $("#mps-provider").value = s.provider; $("#mps-units").value = s.units; $("#mps-mode").value = s.mode;
    $("#mps-auto").value = s.autoSeconds; $("#mps-buffer").value = s.bufferMin;
    sw("#mps-voice", s.voice); sw("#mps-rich", s.richDetails); sw("#mps-traffic", s.traffic);
    $("#mps-gstate").textContent = k.google.set ? `A key is saved (ending ${k.google.last4}).` : "No key saved.";
    $("#mps-ostate").textContent = k.ors.set ? `A key is saved (ending ${k.ors.last4}).` : "No key saved.";
    $("#mps-status").innerHTML = `In use now: <b>${esc(sv.active === "google" ? "Google Maps" : "OpenStreetMap (free)")}</b>. Map: ${esc(sv.map)}. Search: ${esc(sv.search)}. Directions: ${esc(sv.route)}.${sv.wantedGoogleButNoKey ? " <b>Google is chosen but no key is saved, so the free maps are used.</b>" : ""}`;
  }
  async function load() { V = await api("/maps/settings"); paint(); }
  function testOut(sel, r) {
    const el = $(sel);
    el.innerHTML = (r.ok ? "✓ " : "✗ ") + esc(r.text ?? "") + (r.checks ? `<ul>${r.checks.map((c) => `<li>${c.ok === true ? "✓" : c.ok === false ? "✗" : "•"} <b>${esc(c.name)}</b>: ${esc(c.text)}</li>`).join("")}</ul>` : "");
  }
  async function saveKey(provider, input, out) {
    const key = $(input).value.trim();
    if (!key) { opts.toast?.("Paste the key first"); return; }
    try { V = await api("/maps/key", { provider, key }); $(input).value = ""; paint(); opts.toast?.("Key saved"); $(out).textContent = "Saved. Press Test to check it."; }
    catch (e) { $(out).textContent = e.message; }
  }
  async function clearKey(provider, out) { try { V = await api("/maps/key", { provider, key: "" }); paint(); $(out).textContent = "Removed."; } catch (e) { $(out).textContent = e.message; } }
  async function test(provider, out) { $(out).textContent = "Testing…"; try { testOut(out, await api("/maps/test", { provider })); } catch (e) { $(out).textContent = e.message; } }

  function mount(card, o = {}) {
    root = card; opts = o;
    for (const id of ["#mps-voice", "#mps-rich", "#mps-traffic"]) $(id).onclick = () => { sw(id, !swOn(id)); card.dispatchEvent(new Event("change", { bubbles: true })); };
    $("#mps-gsave").onclick = () => saveKey("google", "#mps-gkey", "#mps-gtestout");
    $("#mps-osave").onclick = () => saveKey("ors", "#mps-okey", "#mps-otestout");
    $("#mps-gclear").onclick = () => clearKey("google", "#mps-gtestout");
    $("#mps-oclear").onclick = () => clearKey("ors", "#mps-otestout");
    $("#mps-gtest").onclick = () => test("google", "#mps-gtestout");
    $("#mps-otest").onclick = () => test("ors", "#mps-otestout");
    card.querySelectorAll("a[data-link]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); if (o.openLink) o.openLink(a.href); else window.open(a.href, "_blank", "noopener"); }));
    const loc = card.querySelector("a[data-go]"); if (loc) loc.onclick = (e) => { e.preventDefault(); const p = new URLSearchParams(location.search); p.set("s", "location"); location.search = p.toString(); };
    load().catch((e) => { $("#mps-status").textContent = e.message; });
  }
  async function save() {
    if (!root || !V) return;
    V = await api("/maps/settings", { provider: $("#mps-provider").value, units: $("#mps-units").value, mode: $("#mps-mode").value, voice: swOn("#mps-voice"), richDetails: swOn("#mps-rich"), traffic: swOn("#mps-traffic"),
      autoSeconds: Number($("#mps-auto").value), bufferMin: Number($("#mps-buffer").value) });
    paint();
  }
  window.DayspringMapsSettings = { html, mount, save, enabled: featureOn };
})();
