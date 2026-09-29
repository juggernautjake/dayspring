// The Maps window on the Dayspring screen: a map, a search box with suggestions as you type, numbered results (name,
// address, distance, rating and hours when known), directions for driving, walking, cycling and transit (Google only)
// with the routes drawn and their alternatives, and the step-by-step list: the current step highlighted, ◀ Previous,
// 🔊 Say it, Next ▶, ▷ Demo (a step every few seconds). "Open in Google Maps", 📱 Send to phone, and a QR code.
// The server keeps what's showing (lib/maps/guide.mjs) and sends it as the "maps" event, so voice ("directions to the
// mall", "next step"), the AI and these buttons always agree. Steps said from here go through the floor like any
// announcement (lib/maps/routes.mjs). The map: OpenStreetMap pictures through Dayspring (/api/maps/tile, Leaflet from
// /vendor/leaflet, nothing from other sites) or, with a Google key, Google's own map (/api/maps/embed).
// Opened from 🗺 Maps by the clock (it moves into ⋯ More when there's no room), by voice or by the AI. Like the Music &
// Video browser it lives inside the screen's margins, docked or floating, and can be moved and resized. Esc closes the
// suggestions, then the window. This computer has no GPS: trips start from home (Settings → Where you are) or a typed start.
(() => {
  if (window.dsMaps) return;
  if (window.dsFeatures?.on && window.dsFeatures.on("maps") === false) return;
  const $ = (s, el = root) => el?.querySelector(s);
  const $$ = (s, el = root) => [...(el?.querySelectorAll(s) ?? [])];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const httpsUrl = (u) => (typeof u === "string" && /^https:\/\/(?:www\.)?google\.com\/maps[/?]/.test(u) ? u : "");
  const api = async (path, body) => {
    const r = await fetch("/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Maps couldn't do that just now (${r.status}).`);
    return j;
  };
  const store = { get(k, d = null) { try { const v = JSON.parse(localStorage.getItem("dsMaps." + k)); return v ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem("dsMaps." + k, JSON.stringify(v)); } catch { /* private window */ } } };
  const toast = (t, s = "") => (window.dayspring?.toast ? window.dayspring.toast(t, s, "", "bell") : null);
  if (!document.querySelector('link[href="/maps.css"]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/maps.css"; document.head.appendChild(l); }

  let root = null, pill = null, V = { open: false }, pos = store.get("pos"), minimized = false, useOsmView = false;
  // ---------------------------------------------------------------------------------------------------- Leaflet, the QR maker
  let leafletP = null, qrP = null;
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("couldn't load " + src)); document.head.appendChild(s); });
  function leaflet() {
    if (window.L?.map) return Promise.resolve(window.L);
    if (!leafletP) {
      if (!document.querySelector('link[href="/vendor/leaflet/leaflet.css"]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/vendor/leaflet/leaflet.css"; document.head.appendChild(l); }
      leafletP = loadScript("/vendor/leaflet/leaflet.js").then(() => window.L).catch((e) => { leafletP = null; throw e; });
    }
    return leafletP;
  }
  const qrLib = () => (window.qrcode ? Promise.resolve(window.qrcode) : (qrP ??= loadScript("/vendor/qrcode/qrcode.js").then(() => window.qrcode)));

  // ---------------------------------------------------------------------------------------------------- building the window
  function build() {
    root = document.createElement("section"); root.id = "dsMaps"; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Maps"); root.hidden = true;
    root.innerHTML = `
      <header class="mp-bar"><span class="mp-title">🗺 Maps</span><span class="mp-prov"></span><span class="mp-sp"></span>
        <div class="mp-win"><button type="button" class="mp-min" title="Minimise" aria-label="Minimise">–</button><button type="button" class="mp-dock" title="Fill the screen (double-click the title bar)" aria-label="Fill the screen">▢</button><button type="button" class="mp-x" title="Close (Esc)" aria-label="Close the map">✕</button></div></header>
      <div class="mp-main">
        <aside class="mp-side">
          <form class="mp-search" role="search" autocomplete="off">
            <input class="mp-q" type="search" maxlength="200" enterkeyhint="search" placeholder="Search places or an address" aria-label="Search the map" aria-autocomplete="list" aria-controls="mpSugg">
            <button type="submit" class="mp-btn mp-go">Search</button>
            <label class="mp-near" title="Only places near home (Settings → Where you are)"><input type="checkbox" class="mp-nearbox"> Near home</label>
            <ul class="mp-sugg" id="mpSugg" role="listbox" aria-label="Suggestions" hidden></ul>
          </form>
          <div class="mp-body" aria-live="polite"></div>
        </aside>
        <div class="mp-mapwrap"><div class="mp-map" role="img" aria-label="Map"></div><iframe class="mp-gmap" title="Google map" referrerpolicy="no-referrer-when-downgrade" loading="lazy" hidden></iframe>
          <div class="mp-qr" hidden></div><div class="mp-busy" hidden></div></div>
      </div>
      <div class="mp-grip" aria-hidden="true"></div>`;
    document.body.appendChild(root);
    pill = document.createElement("button"); pill.id = "dsMapsPill"; pill.type = "button"; pill.hidden = true; pill.textContent = "🗺 Maps"; pill.onclick = () => minimize(false);
    document.body.appendChild(pill);
    $(".mp-x").onclick = () => close(); $(".mp-min").onclick = () => minimize(true); $(".mp-dock").onclick = dock;
    const input = $(".mp-q");
    $(".mp-search").onsubmit = (e) => { e.preventDefault(); const sel = $(".mp-sugg li[aria-selected=true]"); hideSugg(); if (sel && sugg[Number(sel.dataset.i)]) return pickSugg(sugg[Number(sel.dataset.i)]); runSearch(input.value); };
    input.addEventListener("input", () => { clearTimeout(typeT); typeT = setTimeout(() => suggest(input.value), 450); });
    input.addEventListener("keydown", onSuggKey);
    input.addEventListener("blur", () => setTimeout(() => { if (!root.contains(document.activeElement) || document.activeElement === input) return; hideSugg(); }, 180));
    $(".mp-sugg").addEventListener("pointerdown", (e) => { const li = e.target.closest("li"); if (li) { e.preventDefault(); hideSugg(); pickSugg(sugg[Number(li.dataset.i)]); } });
    $(".mp-body").addEventListener("click", onBody);
    $(".mp-body").addEventListener("change", onBodyChange);
    $(".mp-body").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches(".mp-fromq")) { e.preventDefault(); act("/maps/directions", { to: V.to, from: e.target.value.trim() || null, mode: V.mode }); } });
    dragging($(".mp-bar"), $(".mp-grip"));
    new ResizeObserver(() => { root.classList.toggle("narrow", root.offsetWidth < 700); map?.invalidateSize(); }).observe(root);
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !isOpen() || (e.dsTop && e.dsTop !== root)) return;
      e.stopImmediatePropagation(); e.preventDefault();
      if (!$(".mp-sugg").hidden) hideSugg(); else close();
    }, true);
    if (pos) floatAt(pos);
  }

  // ---------------------------------------------------------------------------------------------------- moving, resizing, minimising
  function safe() { const r = window.dsSafeRect?.(); return r && r.width > 0 ? r : { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight }; }
  function clampFloat() {
    if (!root || !root.classList.contains("float") || !pos) return;
    const S = safe(), g = 10;
    const w = Math.min(pos.w, S.width - 2 * g), h = Math.min(pos.h, S.height - 2 * g);
    const x = Math.max(S.left + g, Math.min(pos.x, S.right - g - w)), y = Math.max(S.top + g, Math.min(pos.y, S.bottom - g - h));
    Object.assign(root.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
  }
  function floatAt(p) { pos = p; root.classList.add("float"); clampFloat(); }
  function dock() { pos = null; store.set("pos", null); root.classList.remove("float"); for (const k of ["left", "top", "width", "height"]) root.style[k] = ""; setTimeout(() => map?.invalidateSize(), 50); }
  function dragging(bar, grip) {
    const start = (e, mode) => {
      if (e.button !== 0 || (mode === "move" && e.target.closest("button, input, select"))) return;
      const r = root.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY, base = { x: r.left, y: r.top, w: r.width, h: r.height };
      e.preventDefault();
      const mv = (ev) => { const dx = ev.clientX - x0, dy = ev.clientY - y0; floatAt(mode === "move" ? { ...base, x: base.x + dx, y: base.y + dy } : { ...base, w: Math.max(320, base.w + dx), h: Math.max(320, base.h + dy) }); };
      const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); if (pos) store.set("pos", pos); map?.invalidateSize(); };
      addEventListener("pointermove", mv); addEventListener("pointerup", up);
    };
    bar.addEventListener("pointerdown", (e) => start(e, "move"));
    grip.addEventListener("pointerdown", (e) => start(e, "size"));
    bar.addEventListener("dblclick", (e) => { if (!e.target.closest("button, input, select")) dock(); });
  }
  addEventListener("resize", () => clampFloat());
  new MutationObserver(() => clampFloat()).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
  function minimize(on) { minimized = on; root.hidden = on; pill.hidden = !on; if (!on) setTimeout(() => map?.invalidateSize(), 30); }

  // ---------------------------------------------------------------------------------------------------- opening and closing
  const isOpen = () => Boolean(root && !root.hidden);
  function open() { if (!root) build(); act("/maps/act", { action: "open" }); show(); }
  function show() { if (!root) build(); root.hidden = minimized; pill.hidden = !minimized; ensureMap(); }
  function close(local = false) { if (root) root.hidden = true; if (pill) pill.hidden = true; minimized = false; V = { open: false }; if (!local) api("/maps/act", { action: "close" }).catch(() => {}); }
  async function act(path, body) {
    try { const v = await api(path, body); if (v && v.open !== undefined) render(v); return v; }
    catch (e) { toast("Maps", e.message); const b = $(".mp-body"); if (b) { const p = b.querySelector(".mp-err") ?? b.insertAdjacentElement("afterbegin", Object.assign(document.createElement("p"), { className: "mp-err" })); p.textContent = e.message; } return null; }
  }
  const runSearch = (q) => { q = String(q ?? "").trim(); if (q.length < 2) return; busy("Searching…"); act("/maps/search", { q, nearMe: $(".mp-nearbox").checked }); };

  // ---------------------------------------------------------------------------------------------------- suggestions as you type
  let typeT = null, seq = 0, sugg = [];
  async function suggest(q) {
    q = q.trim();
    if (q.length < 3) return hideSugg();
    const my = ++seq;
    let r; try { r = await api(`/maps/suggest?q=${encodeURIComponent(q)}&seq=${my}`); } catch { return; }
    if (my !== seq || document.activeElement !== $(".mp-q")) return;
    sugg = r.items ?? [];
    const ul = $(".mp-sugg");
    if (!sugg.length) return hideSugg();
    ul.innerHTML = sugg.map((s, i) => `<li role="option" id="mpS${i}" data-i="${i}" aria-selected="false"><span>${esc(s.name)}</span>${s.address ? `<span class="mp-sa">${esc(s.address)}${s.distance != null ? " · " + esc(dist(s.distance)) : ""}</span>` : ""}</li>`).join("");
    ul.hidden = false;
  }
  const dist = (m) => (V.units === "km" ? (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`) : (m < 305 ? `${Math.round(m * 3.28084 / 10) * 10} ft` : `${(m / 1609.344).toFixed(1)} mi`));
  function hideSugg() { const ul = $(".mp-sugg"); if (ul) { ul.hidden = true; ul.innerHTML = ""; } $(".mp-q")?.removeAttribute("aria-activedescendant"); }
  function onSuggKey(e) {
    const ul = $(".mp-sugg"); if (!ul || ul.hidden) return;
    const items = $$(".mp-sugg li"); if (!items.length) return;
    let i = items.findIndex((x) => x.getAttribute("aria-selected") === "true");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); i = e.key === "ArrowDown" ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
      items.forEach((x, k) => x.setAttribute("aria-selected", String(k === i))); $(".mp-q").setAttribute("aria-activedescendant", items[i].id);
    }
  }
  function pickSugg(s) { if (!s) return; $(".mp-q").value = s.name; busy("Finding it…"); act("/maps/act", { action: "place", place: s }); }

  // ---------------------------------------------------------------------------------------------------- the list side
  const MODES = [["driving", "🚗 Drive"], ["walking", "🚶 Walk"], ["cycling", "🚲 Bike"], ["transit", "🚌 Transit"]];
  function resultsHtml(v) {
    if (!v.results?.length) {
      if (v.q && !v.busy) return `<p class="mp-note">Nothing found for “${esc(v.q)}”. Try other words, or turn off Near home.</p>`;
      return `<p class="mp-note">Search for a place or an address, or say “find coffee near me”, “directions to …”, “show me a map of …”.</p>
        <p class="mp-note">${v.home ? `Home: ${esc(v.home.name)}. This computer has no GPS, so “near me” and directions start from home.` : "Set your home in Settings → Where you are: this computer has no GPS, so “near me” and directions start from there."}</p>`;
    }
    return `<p class="mp-h">${v.nearMe ? "Near home" : "Results"}: ${esc(v.q)}</p><ol class="mp-res">${v.results.map((p, i) => `<li data-n="${p.n}" class="${i === v.selected ? "mp-sel" : ""}" tabindex="0" aria-label="Number ${p.n}: ${esc(p.name)}">
      <span class="mp-n">${p.n}</span><span class="mp-nm">${esc(p.name)}</span>
      ${p.address ? `<span class="mp-ad">${esc(p.address)}</span>` : ""}
      <span class="mp-mt">${[p.distanceText ? `${esc(p.distanceText)} from home` : "", p.category ? esc(p.category) : "", p.rating ? `★ ${esc(p.rating)}${p.ratingCount ? ` (${esc(p.ratingCount)})` : ""}` : "", p.openNow === true ? "Open now" : p.openNow === false ? "Closed now" : ""].filter(Boolean).join(" · ")}</span>
      ${p.hours?.length ? `<details><summary>Hours</summary>${p.hours.map((h) => esc(h)).join("<br>")}</details>` : ""}
      <span class="mp-acts"><button type="button" class="mp-btn mp-go" data-dir="${p.n}">Directions</button><button type="button" class="mp-btn" data-gmap="${p.n}">Google Maps ↗</button></span></li>`).join("")}</ol>`;
  }
  function routeHtml(v) {
    const r = v.routes[v.alt] ?? v.routes[0], steps = r.steps ?? [];
    const cur = steps[v.step];
    return `<div class="mp-trip">
        <label for="mpFrom">From</label>
        <div class="mp-from"><input id="mpFrom" class="mp-fromq" type="text" maxlength="200" value="${esc(v.from?.id === "home" ? "" : v.from?.name ?? "")}" placeholder="${esc(v.from?.id === "home" ? `Home${v.from?.address ? ` (${v.from.address})` : ""}` : "Home")}" aria-label="Start from (empty: home)"><button type="button" class="mp-btn" data-a="from">Go</button></div>
        <span class="mp-note">No GPS on this computer: trips start from home unless you type a start.</span>
        <label>To</label><span class="mp-to">${esc(v.to?.name ?? "")}${v.to?.address ? `<span class="mp-note"> · ${esc(v.to.address)}</span>` : ""}</span>
      </div>
      <div class="mp-modes" role="group" aria-label="Travel mode">${MODES.map(([m, n]) => `<button type="button" data-mode="${m}" aria-pressed="${v.mode === m}" ${m === "transit" && !v.services?.transit ? 'disabled title="Bus and train directions need a Google Maps key (Settings → Maps)"' : ""}>${n}</button>`).join("")}</div>
      ${v.mode === "driving" ? `<div class="mp-avoid">${["highways", "tolls", "ferries"].map((a) => `<label><input type="checkbox" data-avoid="${a}" ${v.avoid?.[a] ? "checked" : ""}> Avoid ${a}</label>`).join("")}</div>` : ""}
      ${r.note ? `<p class="mp-note">${esc(r.note)}</p>` : ""}
      <p class="mp-h">${v.routes.length > 1 ? `${v.routes.length} routes` : "Route"}</p>
      <div class="mp-alts">${v.routes.map((x) => `<button type="button" data-alt="${x.i}" aria-pressed="${x.i === v.alt}"><span class="mp-dur">${esc(x.durationText)}</span><span>${esc(x.distanceText)}${x.traffic ? " · with traffic" : ""}</span>${x.summary ? `<span class="mp-via">${esc(x.summary)}</span>` : ""}</button>`).join("")}</div>
      <p class="mp-h">Step ${v.step + 1} of ${steps.length}${v.auto ? " · demo" : v.guided ? " · guided" : ""}</p>
      <div class="mp-cur" aria-live="polite">${esc(v.stepText || cur?.text || "")}</div>
      <div class="mp-ctl"><button type="button" class="mp-btn" data-step="previous" ${v.step === 0 ? "disabled" : ""}>◀ Previous</button><button type="button" class="mp-btn" data-step="current">🔊 Say it</button>
        <button type="button" class="mp-btn mp-go" data-step="next" ${v.step >= steps.length - 1 ? "disabled" : ""}>Next ▶</button>
        ${v.auto || v.guided ? `<button type="button" class="mp-btn" data-a="stop">■ Stop</button>` : `<button type="button" class="mp-btn" data-a="auto" title="Says each step on a timer, as a demo">▷ Demo</button>`}</div>
      <ol class="mp-steps">${steps.map((s, i) => `<li data-i="${i}" class="${i === v.step ? "mp-on" : i < v.step ? "mp-past" : ""}" ${i === v.step ? 'aria-current="step"' : ""}><span class="mp-n">${s.n}</span><span>${esc(s.text)}</span><span class="mp-sd">${esc(s.distanceText)}</span></li>`).join("")}</ol>
      ${linksHtml(v)}`;
  }
  const linksHtml = (v) => `<div class="mp-links"><button type="button" class="mp-btn" data-a="gmaps">Open in Google Maps ↗</button><button type="button" class="mp-btn" data-a="phone">📱 Send to phone</button><button type="button" class="mp-btn" data-a="qr" aria-pressed="${Boolean(v.qr)}">▦ QR code</button>${v.routes?.length ? `<button type="button" class="mp-btn" data-a="back">◀ Results</button>` : ""}</div>`;
  function paintSide(v) {
    const b = $(".mp-body");
    const keepScroll = b.scrollTop;
    const showRoute = v.routes?.length && !showResults;
    b.innerHTML = (v.error ? `<p class="mp-err">${esc(v.error)}</p>` : "") + (showRoute ? routeHtml(v) : resultsHtml(v) + (v.results?.length ? linksHtml(v) : ""));
    b.scrollTop = keepScroll;
    const curLi = $(".mp-steps li.mp-on"); if (curLi && showRoute) { const br = b.getBoundingClientRect(), lr = curLi.getBoundingClientRect(); if (lr.top < br.top || lr.bottom > br.bottom) curLi.scrollIntoView({ block: "nearest" }); }
    const sv = v.services ?? {};
    $(".mp-prov").textContent = sv.active === "google" ? "Google Maps" : "OpenStreetMap · free";
    $(".mp-prov").title = sv.active ? `Map: ${sv.map}. Search: ${sv.search}. Directions: ${sv.route}.` : "";
  }
  let showResults = false;
  function onBody(e) {
    const t = e.target.closest("button, li[data-n], li[data-i]"); if (!t) return;
    if (t.dataset.dir) { showResults = false; busy("Finding a route…"); return act("/maps/directions", { to: `number ${t.dataset.dir}`, mode: V.mode }); }
    if (t.dataset.gmap) { const p = V.results?.[Number(t.dataset.gmap) - 1]; if (p) openLink(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.address ? `${p.name}, ${p.address}` : `${p.lat},${p.lon}`)}`); return; }
    if (t.dataset.mode) { if (t.disabled) return; busy("Finding a route…"); return act("/maps/act", { action: "mode", mode: t.dataset.mode }); }
    if (t.dataset.alt) return act("/maps/act", { action: "alt", i: Number(t.dataset.alt) });
    if (t.dataset.step) return act("/maps/act", { action: "step", step: t.dataset.step });
    if (t.matches("li[data-i]")) return act("/maps/act", { action: "goto", i: Number(t.dataset.i) });
    if (t.matches("li[data-n]")) return act("/maps/act", { action: "select", n: Number(t.dataset.n) });
    const a = t.dataset.a;
    if (a === "auto") return act("/maps/act", { action: "auto" });
    if (a === "stop") return act("/maps/act", { action: "stop" });
    if (a === "qr") return act("/maps/act", { action: "qr", on: !V.qr });
    if (a === "gmaps") return openLink(httpsUrl(V.link));
    if (a === "phone") return api("/maps/act", { action: "phone" }).then((r) => { render(r); toast(r.sent ? "Sent to your phone" : "Scan the code with your phone", r.sent ? "It opens in Google Maps." : "Dayspring can't reach your phone yet; the QR code opens the same trip."); }).catch((x) => toast("Maps", x.message));
    if (a === "from") { const q = $(".mp-fromq")?.value.trim(); busy("Finding a route…"); return act("/maps/directions", { to: V.to, from: q || null, mode: V.mode }); }
    if (a === "back") { showResults = true; paintSide(V); paintMap(V); }
  }
  function onBodyChange(e) { const c = e.target.closest("[data-avoid]"); if (c) { busy("Finding a route…"); act("/maps/act", { action: "avoid", what: c.dataset.avoid, on: c.checked }); } }
  function openLink(url) { if (!url) return; fetch("/api/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) }).then((r) => { if (!r.ok) throw new Error(); toast("Opened in the browser", "Google Maps"); }).catch(() => window.open(url, "_blank", "noopener")); }
  function busy(text) { const b = $(".mp-busy"); if (!b) return; b.textContent = text; b.hidden = !text; }

  // ---------------------------------------------------------------------------------------------------- the map
  let map = null, layer = null, lastMapKey = "", lastEmbed = "";
  async function ensureMap() {
    if (map || !root) return map;
    let L; try { L = await leaflet(); } catch { $(".mp-map").textContent = "The map couldn't load."; return null; }
    if (map) return map;
    map = L.map($(".mp-map"), { zoomControl: true, attributionControl: true, worldCopyJump: true }).setView([39.8, -98.6], 4);
    L.tileLayer("/api/maps/tile/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' }).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    layer = L.layerGroup().addTo(map);
    if (V.open) paintMap(V, true);
    return map;
  }
  const pin = (L, cls, label) => L.divIcon({ className: "", html: `<div class="mp-pin ${cls}"><b>${esc(label)}</b></div>`, iconSize: [26, 26], iconAnchor: [4, 26] });
  function paintMap(v, force = false) {
    // Google's own map when a key is saved (and not switched off for this view)
    const g = v.embed && !useOsmView ? `/api/maps/embed?${new URLSearchParams(v.embed)}` : "";
    const fr = $(".mp-gmap");
    if (g) { if (g !== lastEmbed) { fr.src = g; lastEmbed = g; } fr.hidden = false; } else { fr.hidden = true; if (lastEmbed) { fr.removeAttribute("src"); lastEmbed = ""; } }
    if (!map || !window.L) return;
    const L = window.L;
    const showRoute = v.routes?.length && !showResults;
    const key = JSON.stringify([showRoute ? v.routes.map((r) => [r.distance, r.duration, r.geometry?.length]) : null, v.alt, v.results?.map((p) => [p.lat, p.lon]), v.selected, v.home?.lat, showRoute ? v.step : null]);
    if (key === lastMapKey && !force) return;
    const newShape = !lastMapKey || JSON.parse(lastMapKey)[0]?.toString() !== JSON.parse(key)[0]?.toString() || JSON.parse(lastMapKey)[2]?.toString() !== JSON.parse(key)[2]?.toString() || JSON.parse(lastMapKey)[1] !== v.alt;
    lastMapKey = key;
    layer.clearLayers();
    const pts = [];
    if (v.home) { L.marker([v.home.lat, v.home.lon], { icon: pin(L, "mp-phome", "⌂"), title: "Home", keyboard: false }).addTo(layer); if (!showRoute && !v.results?.length) pts.push([v.home.lat, v.home.lon]); }
    if (showRoute) {
      v.routes.forEach((r) => { if (r.i !== v.alt && r.geometry?.length) L.polyline(r.geometry, { color: "#8b93b8", weight: 5, opacity: 0.6 }).on("click", () => act("/maps/act", { action: "alt", i: r.i })).addTo(layer); });
      const r = v.routes[v.alt];
      if (r?.geometry?.length) { L.polyline(r.geometry, { color: "#1f2a80", weight: 9, opacity: 0.55 }).addTo(layer); L.polyline(r.geometry, { color: "#7c8cff", weight: 5, opacity: 1, className: "mp-route" }).addTo(layer); pts.push(...r.geometry); }
      if (v.from) L.marker([v.from.lat, v.from.lon], { icon: pin(L, "mp-phome", "A"), title: v.from.name, keyboard: false }).addTo(layer);
      if (v.to) L.marker([v.to.lat, v.to.lon], { icon: pin(L, "mp-psel", "B"), title: v.to.name, keyboard: false }).addTo(layer);
      const st = r?.steps?.[v.step];
      if (st?.at) L.circleMarker(st.at, { radius: 9, color: "#fff", weight: 3, fillColor: "#a78bfa", fillOpacity: 1, className: "mp-stepdot" }).addTo(layer);
      if (!newShape && st?.at && (v.guided || v.step > 0)) { map.setView(st.at, Math.max(map.getZoom(), 16), { animate: true }); return; }
    } else {
      (v.results ?? []).forEach((p, i) => { L.marker([p.lat, p.lon], { icon: pin(L, i === v.selected ? "mp-psel" : "", String(p.n)), title: `${p.n}. ${p.name}`, keyboard: false }).on("click", () => act("/maps/act", { action: "select", n: p.n })).addTo(layer); pts.push([p.lat, p.lon]); });
      if (!newShape && v.selected != null && v.results?.[v.selected]) { const p = v.results[v.selected]; map.panTo([p.lat, p.lon]); return; }
    }
    if (pts.length === 1) map.setView(pts[0], v.results?.[0]?.category === "administrative" || /city|town|village/.test(v.results?.[0]?.category ?? "") ? 12 : 15);
    else if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 16 });
  }
  async function paintQr(v) {
    const box = $(".mp-qr");
    const link = httpsUrl(v.link);
    if (!v.qr || !link) { box.hidden = true; box.innerHTML = ""; return; }
    try {
      const qrcode = await qrLib();
      const q = qrcode(0, "M"); q.addData(link); q.make();
      box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) + `<p>Scan with your phone's camera to open this in Google Maps.</p>`;
      box.hidden = false;
    } catch { box.innerHTML = "<p>The code couldn't be made.</p>"; box.hidden = false; }
  }

  // ---------------------------------------------------------------------------------------------------- the server's view
  function render(v) {
    if (!v || v.open === false) { if (root) { root.hidden = true; pill.hidden = true; } V = { open: false }; return; }
    const hadRoute = V.routes?.length, isNewRoute = v.routes?.length && (!hadRoute || V.to?.lat !== v.to?.lat || V.to?.lon !== v.to?.lon || V.mode !== v.mode);
    if (isNewRoute) showResults = false;
    if (!v.routes?.length) showResults = false;
    V = v;
    if (!root) build();
    if (!isOpen() && !minimized) show();
    busy(v.busy === "search" ? "Searching…" : v.busy === "route" ? "Finding a route…" : "");
    paintSide(v); paintMap(v); paintQr(v);
    ensureMap();
    try { fetch("/api/screen/shown", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "maps", view: "maps", title: v.to ? `Directions to ${v.to.name}` : v.q ? `Map: ${v.q}` : "Map", text: v.routes?.length ? v.stepText : (v.results ?? []).map((p) => `${p.n}. ${p.name}`).join(" ") }) }).catch(() => {}); } catch { /* fine */ }
  }
  const attach = (es) => es.addEventListener("maps", (e) => { let v = {}; try { v = JSON.parse(e.data); } catch { return; } render(v); });
  if (window.dsEvents) attach(window.dsEvents); else addEventListener("ds-events", (e) => attach(e.detail), { once: true });
  fetch("/api/maps/state").then((r) => (r.ok ? r.json() : null)).then((v) => { if (v?.open) render(v); }).catch(() => {});
  addEventListener("ds-test-maps", (e) => render(e.detail));

  // 🗺 Maps by the clock on the Dayspring screen (it moves into ⋯ More when there's no room)
  (function addButton() {
    const util = document.querySelector("#calBtns .util, .calbtns .util");
    if (!util || document.getElementById("mapsBtn")) return;
    const b = document.createElement("button");
    b.id = "mapsBtn"; b.type = "button"; b.title = "Maps: search, directions, step by step"; b.innerHTML = '<i aria-hidden="true">🗺</i><span class="lbl">Maps</span>';
    b.onclick = () => (isOpen() ? close() : open());
    util.insertBefore(b, util.querySelector("#setBtn") ?? null);
  })();

  window.dsMaps = {
    open, close: () => close(), isOpen, osmView: (on = true) => { useOsmView = Boolean(on); if (V.open) paintMap(V, true); },
    _state: () => ({ open: isOpen(), minimized, results: $$(".mp-res li").map((li) => Number(li.dataset.n)), selected: V.selected ?? null, route: Boolean(V.routes?.length) && !showResults, step: V.step ?? null,
      curStep: $(".mp-steps li.mp-on")?.dataset.i != null ? Number($(".mp-steps li.mp-on").dataset.i) : null, stepText: $(".mp-cur")?.textContent ?? "", suggestions: $$(".mp-sugg li").length, map: Boolean(map),
      lines: $$(".mp-map path.mp-route").length, stepDot: $$(".mp-map path.mp-stepdot").length, markers: $$(".mp-map .mp-pin").length, qr: Boolean($(".mp-qr svg")) && !$(".mp-qr").hidden, gmap: !$(".mp-gmap")?.hidden, provider: V.provider ?? null }),
  };
})();
