// The GIF picker: search GIPHY, KLIPY, Imgur and the web at once and pick, copy or save a GIF. On the Dayspring screen
// it opens by voice ("show me a GIF of a dancing cat", "show me GIFs") or from 🎞 GIFs by the clock; any page can open
// it with window.dsGifPicker.open({ query, onPick }) (the email editor does, to insert a GIF).
//   onPick({ url, mp4, width, height, title, source, id, preview, page, attribution, file? })
//     url/mp4: the GIF's own web addresses; preview: Dayspring's proxied copy (safe to show in a page);
//     file: { path, name, type, bytes, href } a local copy for attaching (GET /api/gifs/file?id=…).
// Results stream in as each source answers (/api/gifs/stream), so a slow one never holds the rest up. Tiles are
// numbered for voice ("number 4") in order, once they've loaded: a GIF that doesn't load, or looks the same as one
// already shown (an 8×8 fingerprint of its first frame), is dropped and the next one moves up. Every picture comes
// through Dayspring's own /api/gifs/media (never from the GIF sites), and titles are only ever set as text.
(() => {
  if (window.dsGifPicker) return;
  // switched off in this build (release channels, lib/features.mjs): no picker, no button, no window.dsGifPicker
  const featureOn = window.dsFeatures?.on ? window.dsFeatures.on("gifs") !== false : (() => { try { const x = new XMLHttpRequest(); x.open("GET", "/api/gifs/enabled", false); x.send(); return x.status === 200 ? JSON.parse(x.responseText).enabled !== false : x.status !== 404; } catch { return true; } })();
  if (!featureOn) return;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (cls, text, label) => { const b = el("button", cls, text); b.type = "button"; if (label) { b.setAttribute("aria-label", label); b.title = label; } return b; };
  const api = async (path, body) => {
    const r = await fetch("/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `That didn't work (${r.status}).`);
    return j;
  };
  const onlyMedia = (u) => (typeof u === "string" && u.startsWith("/api/gifs/media?u=") ? u : "");
  const httpUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : "");
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const LABEL = { giphy: "GIPHY", klipy: "KLIPY", imgur: "Imgur", web: "Web" };
  const RWORD = { g: "G", pg: "PG", "pg-13": "PG-13", r: "R" };
  const RATINGS = ["g", "pg", "pg-13", "r"];
  const ratingOk = (r, max) => RATINGS.includes(r) && RATINGS.indexOf(r) <= RATINGS.indexOf(max);
  const store = { get(k) { try { return JSON.parse(localStorage.getItem("dsGifs." + k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem("dsGifs." + k, JSON.stringify(v)); } catch { /* private window */ } } };
  if (!document.querySelector('link[href="/gifs.css"]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/gifs.css"; document.head.appendChild(l); }
  const isDisplay = () => Boolean(document.getElementById("clock") && window.dsEvents);

  // ---------------------------------------------------------------------------------------------------- state
  let root = null, pill = null, S = null;           // S: settings from the server
  const st = {
    open: false, tab: "search", q: "", rating: "pg-13", type: "gif", format: "gif", saver: false, provider: "all", onPick: null,
    sid: null, evIndex: 0, loading: false, more: false, ctrl: null, items: [], tiles: [], committed: 0, hashes: [], dropped: { broken: 0, look: 0, rating: 0 },
    statuses: {}, providers: [], fallback: false, detail: null, local: null, pos: store.get("pos"), minimized: false, timeline: [],
  };
  const el$ = (s) => root?.querySelector(s);

  // ---------------------------------------------------------------------------------------------------- building the window
  function build() {
    root = el("section"); root.id = "dsGifs"; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "GIFs"); root.hidden = true;
    const bar = el("header", "g-bar");
    const tabs = el("div", "g-tabs"); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "GIF lists");
    for (const [id, name] of [["search", "Search"], ["trending", "Trending"], ["categories", "Categories"], ["favorites", "Favorites"], ["recent", "Recent"]]) {
      const t = btn("g-tab", name); t.setAttribute("role", "tab"); t.dataset.tab = id; t.id = "dsg-tab-" + id; t.setAttribute("aria-selected", "false"); t.onclick = () => setTab(id); tabs.appendChild(t);
    }
    tabs.addEventListener("keydown", (e) => { if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return; const all = [...tabs.children], i = all.indexOf(document.activeElement); if (i < 0) return; const n = all[(i + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length]; n.focus(); n.click(); e.preventDefault(); });
    const win = el("div", "g-win");
    const min = btn("g-btn g-min", "–", "Minimise"), max = btn("g-btn g-max", "▢", "Fill the screen"), x = btn("g-btn g-x", "✕", "Close GIFs");
    min.onclick = () => minimize(true); max.onclick = () => dock(); x.onclick = () => close();
    win.append(min, max, x);
    bar.append(el("span", "g-title", "🎞 GIFs"), tabs, el("span", "g-sp"), win);
    const search = el("form", "g-search"); search.setAttribute("role", "search");
    const input = el("input"); input.type = "search"; input.placeholder = "Search GIFs (a dancing cat, thumbs up, Mondays…)"; input.setAttribute("aria-label", "Search GIFs"); input.maxLength = 120; input.enterKeyHint = "search";
    const go = btn("g-btn main", "Search"); go.type = "submit";
    search.append(input, go);
    search.onsubmit = (e) => { e.preventDefault(); const q = input.value.trim(); if (q) { setTab("search", { silent: true }); runSearch({ q }); } };
    const filters = el("div", "g-filters");
    const prov = el("div", "g-prov"); prov.setAttribute("role", "group"); prov.setAttribute("aria-label", "Sources");
    const sel = (label, cls, opts) => { const l = el("label"); const s = el("select", cls); s.setAttribute("aria-label", label); for (const [v, t] of opts) { const o = el("option", "", t); o.value = v; s.appendChild(o); } l.append(el("span", "", label), s); return l; };
    const rating = sel("Rating", "g-rating", [["g", "G"], ["pg", "PG"], ["pg-13", "PG-13"], ["r", "R"]]);
    const type = sel("Type", "g-type", [["gif", "GIFs"], ["sticker", "Stickers"]]);
    const format = sel("Format", "g-format", [["gif", "GIF"], ["mp4", "MP4"], ["webp", "WebP"]]);
    const size = sel("Size", "g-size", [["normal", "Normal"], ["small", "Small (data saver)"]]);
    filters.append(prov, rating, type, format, size, el("div", "g-status"));
    const chips = el("div", "g-chips"); chips.setAttribute("aria-label", "Reactions and categories");
    const wrap = el("div", "g-body-wrap");
    const body = el("div", "g-body"); body.tabIndex = -1;
    const grid = el("div", "g-grid"); grid.setAttribute("role", "list"); grid.setAttribute("aria-label", "GIF results");
    const empty = el("p", "g-empty"); empty.hidden = true;
    const moreBox = el("div", "g-more"); const moreBtn = btn("g-btn", "Load more", "Load more GIFs"); moreBtn.onclick = () => loadMore(); moreBox.appendChild(moreBtn); moreBox.hidden = true;
    const sentinel = el("div", "g-sentinel");
    body.append(grid, empty, moreBox, sentinel);
    const detail = el("div", "g-detail"); detail.hidden = true; detail.setAttribute("role", "region"); detail.setAttribute("aria-label", "GIF preview");
    wrap.append(body, detail);
    const foot = el("footer", "g-foot"); const attr = el("div", "g-attr"); const msg = el("span", "g-msg"); msg.setAttribute("role", "status"); msg.setAttribute("aria-live", "polite");
    foot.append(attr, msg);
    const grip = el("div", "g-resize"); grip.setAttribute("aria-hidden", "true");
    root.append(bar, search, filters, chips, wrap, foot, grip);
    document.body.appendChild(root);
    pill = btn("", "🎞 GIFs", "Show the GIFs again"); pill.id = "dsGifsPill"; pill.hidden = true; pill.onclick = () => minimize(false); document.body.appendChild(pill);

    root.querySelector(".g-rating").onchange = (e) => { st.rating = e.target.value; refilter(); };
    root.querySelector(".g-type").onchange = (e) => { st.type = e.target.value; refilter(); };
    root.querySelector(".g-format").onchange = (e) => { st.format = e.target.value; if (st.detail) showDetail(st.detail); };
    root.querySelector(".g-size").onchange = (e) => { st.saver = e.target.value === "small"; refilter(); };
    new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting) && st.more && !st.loading && st.open && !st.local) loadMore(); }, { root: body, rootMargin: "400px" }).observe(sentinel);
    lazy = new IntersectionObserver((es) => { for (const x of es) if (x.isIntersecting) { lazy.unobserve(x.target); startTile(x.target); } }, { root: body, rootMargin: "500px" });
    new ResizeObserver(() => relayout()).observe(body);
    dragging(bar, grip);
    root.addEventListener("keydown", keys);
  }
  let lazy = null;

  // ---------------------------------------------------------------------------------------------------- moving, resizing, minimising
  function safe() { const r = window.dsSafeRect?.(); return r && r.width > 0 ? r : { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight }; }
  function clampFloat() {
    if (!root || !root.classList.contains("float") || !st.pos) return;
    const S2 = safe(), g = 10;
    const w = Math.min(st.pos.w, S2.width - 2 * g), h = Math.min(st.pos.h, S2.height - 2 * g);
    const x = Math.max(S2.left + g, Math.min(st.pos.x, S2.right - g - w)), y = Math.max(S2.top + g, Math.min(st.pos.y, S2.bottom - g - h));
    Object.assign(root.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
  }
  function floatAt(pos) { st.pos = pos; root.classList.add("float"); clampFloat(); }
  function dock() { st.pos = null; store.set("pos", null); root.classList.remove("float"); for (const k of ["left", "top", "width", "height"]) root.style[k] = ""; }
  function dragging(bar, grip) {
    const start = (e, mode) => {
      if (e.button !== 0 || (mode === "move" && e.target.closest("button, input, select, [role=tab]"))) return;
      const r = root.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
      const base = { x: r.left, y: r.top, w: r.width, h: r.height };
      e.preventDefault();
      const mv = (ev) => { const dx = ev.clientX - x0, dy = ev.clientY - y0; floatAt(mode === "move" ? { ...base, x: base.x + dx, y: base.y + dy } : { ...base, w: Math.max(300, base.w + dx), h: Math.max(260, base.h + dy) }); };
      const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); if (st.pos) store.set("pos", st.pos); };
      addEventListener("pointermove", mv); addEventListener("pointerup", up);
    };
    bar.addEventListener("pointerdown", (e) => start(e, "move"));
    grip.addEventListener("pointerdown", (e) => start(e, "size"));
    bar.addEventListener("dblclick", (e) => { if (!e.target.closest("button, input, select")) dock(); });
  }
  addEventListener("resize", clampFloat);
  new MutationObserver(clampFloat).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
  function minimize(on) {
    st.minimized = on;
    root.hidden = on; pill.hidden = !on;
    if (on) { pill.textContent = st.committed ? `🎞 GIFs (${st.committed})` : "🎞 GIFs"; pill.focus(); } else focusFirst();
  }

  // ---------------------------------------------------------------------------------------------------- settings
  async function loadSettings() {
    try { S = await api("/gifs/settings"); } catch { S = S ?? { settings: { rating: "pg-13", format: "gif", autoplay: "always", dataSaver: false, type: "gif" }, providers: [{ id: "web", label: "Web", on: true, state: "ready", attribution: { text: "Web results via DuckDuckGo and Bing" } }], clipboard: "browser" }; }
    return S;
  }
  function paintFilters() {
    el$(".g-rating").value = st.rating; el$(".g-type").value = st.type; el$(".g-format").value = st.format; el$(".g-size").value = st.saver ? "small" : "normal";
    const prov = el$(".g-prov"); prov.replaceChildren();
    const list = [{ id: "all", label: "All" }, ...(S?.providers ?? []).filter((p) => p.on || p.id === "web")];
    for (const p of list) {
      const b = btn("g-btn", p.label); b.dataset.p = p.id; b.setAttribute("aria-pressed", String(st.provider === p.id));
      if (p.id !== "all" && p.needsKey && !p.keySet) { b.disabled = true; b.title = `${p.label} needs a free key: Settings → GIFs`; b.style.opacity = ".5"; }
      b.onclick = () => { st.provider = p.id; paintFilters(); refilter(); };
      prov.appendChild(b);
    }
  }
  function paintStatus() {
    const box = el$(".g-status"); box.replaceChildren();
    for (const [id, s] of Object.entries(st.statuses)) {
      if (s.state === "ok") continue;
      const word = s.state === "rate-limited" ? "busy right now" : s.state === "invalid-key" ? "key not accepted" : s.state === "timeout" ? "slow, skipped" : "unavailable";
      const c = el("span", "g-chipbad", `${LABEL[id] ?? id} ${word}`); c.title = s.message || ""; c.dataset.p = id; c.dataset.state = s.state; box.appendChild(c);
    }
  }
  function paintAttribution() {
    const a = el$(".g-attr"); a.replaceChildren();
    const used = [...new Set(st.tiles.filter((t) => t.el.isConnected).map((t) => t.it.source))];
    for (const id of used) {
      const p = S?.providers?.find((x) => x.id === id);
      const text = p?.attribution?.text ?? LABEL[id];
      const b = el("b", "", text); b.dataset.p = id; a.appendChild(b);
    }
    if (st.fallback && !st.local) a.appendChild(el("span", "", "No GIF keys yet: showing web results. Add a free GIPHY or KLIPY key in Settings → GIFs."));
  }
  const say = (t) => { const m = el$(".g-msg"); if (m) { m.textContent = t; clearTimeout(say._t); say._t = setTimeout(() => { if (m.textContent === t) m.textContent = ""; }, 6000); } };

  // ---------------------------------------------------------------------------------------------------- tabs
  async function setTab(tab, { silent = false } = {}) {
    st.tab = tab;
    for (const t of root.querySelectorAll(".g-tab")) t.setAttribute("aria-selected", String(t.dataset.tab === tab));
    closeDetail(true);
    if (silent) return;
    if (tab === "search") { paintChips(); if (st.q && !st.local && st.sid) return; if (st.q) runSearch({ q: st.q }); else el$(".g-search input").focus(); return; }
    if (tab === "trending") { paintChips(); return runSearch({ q: "", mode: "trending" }); }
    if (tab === "categories") { stopStream(); resetGrid(); st.local = "categories"; paintCategories(); return; }
    if (tab === "favorites" || tab === "recent") return showLibrary(tab);
  }
  const REACTIONS = ["happy", "thumbs up", "facepalm", "lol", "applause", "wow", "sad", "love", "dance", "yes", "no", "thank you", "celebrate", "mind blown", "eye roll", "shrug", "hugs", "excited", "sorry", "mondays", "coffee"];
  let cats = null;
  function paintChips() {
    const c = el$(".g-chips"); c.replaceChildren(); c.hidden = false;
    const tr = btn("g-chip", "🔥 Trending"); tr.onclick = () => setTab("trending"); c.appendChild(tr);
    for (const r of REACTIONS) { const b = btn("g-chip", r); b.onclick = () => { el$(".g-search input").value = r; setTab("search", { silent: true }); runSearch({ q: r }); }; c.appendChild(b); }
  }
  async function paintCategories() {
    el$(".g-chips").hidden = true;
    const grid = el$(".g-grid"); grid.replaceChildren();
    const box = el("div"); box.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;padding:4px 0";
    grid.appendChild(box);
    empty("Loading categories…");
    try { cats = cats ?? (await api("/gifs/categories")).categories; } catch { cats = REACTIONS.map((r) => ({ name: r, query: r })); }
    if (st.local !== "categories") return;
    empty("");
    for (const c of cats) { const b = btn("g-chip g-cat", c.name); b.onclick = () => { el$(".g-search input").value = c.query; setTab("search", { silent: true }); el$(".g-chips").hidden = false; paintChips(); runSearch({ q: c.query }); }; box.appendChild(b); }
    box.querySelector("button")?.focus();
  }
  async function showLibrary(which) {
    stopStream(); resetGrid(); st.local = which; el$(".g-chips").hidden = true;
    let lib; try { lib = await api("/gifs/library"); } catch (e) { return empty(e.message); }
    const list = which === "favorites" ? lib.favorites : lib.recents;
    st.sid = `library:${which}`;
    if (!list.length) return empty(which === "favorites" ? "No favourites yet. Open a GIF and press ☆ Favourite (or say \"favourite that one\")." : "Nothing here yet. GIFs you pick, copy or save show up here.");
    addItems(list.map((x, i) => ({ ...x, seq: i + 1 })));
  }

  // ---------------------------------------------------------------------------------------------------- searching (streamed)
  function stopStream() { try { st.ctrl?.abort(); } catch { /* fine */ } st.ctrl = null; st.loading = false; }
  function resetGrid() {
    st.items = []; st.tiles = []; st.committed = 0; st.hashes = []; st.dropped = { broken: 0, look: 0, rating: 0 }; st.statuses = {}; st.more = false; st.fallback = false; st.local = null; st.timeline = [];
    el$(".g-grid").replaceChildren(); relayout(true); empty(""); el$(".g-more").hidden = true; paintStatus(); paintAttribution(); closeDetail(true);
  }
  function runSearch({ q = st.q, mode = "search", sid = null } = {}) {
    stopStream(); resetGrid();
    st.q = mode === "trending" ? "" : q; st.mode = mode;
    if (mode === "search") el$(".g-search input").value = q;
    const p = new URLSearchParams(sid ? { sid, from: "0" } : { q: st.q, mode, rating: st.rating, type: st.type, pick: st.onPick ? "1" : "0" });
    if (!sid && st.provider !== "all") p.set("providers", st.provider);
    empty(mode === "trending" ? "Loading trending GIFs…" : `Looking for ${q}…`);
    return readStream(`/api/gifs/stream?${p}`);
  }
  function loadMore() {
    if (!st.sid || st.loading || !st.more || st.local) return;
    return readStream(`/api/gifs/stream?${new URLSearchParams({ sid: st.sid, from: String(st.evIndex), more: "1" })}`);
  }
  function attach(sid) { if (st.loading && st.sid === sid) return; stopStream(); return readStream(`/api/gifs/stream?${new URLSearchParams({ sid, from: String(st.sid === sid ? st.evIndex : 0) })}`, sid !== st.sid); }
  async function readStream(url, fresh = false) {
    if (fresh) resetGrid();
    const ctrl = new AbortController(); st.ctrl = ctrl; st.loading = true;
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Search failed (${r.status})`); }
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) { try { onEvent(JSON.parse(line)); } catch { /* a broken line */ } } }
      }
    } catch (e) { if (e.name !== "AbortError") { empty(e.message); } }
    finally { if (st.ctrl === ctrl) { st.loading = false; st.ctrl = null; } }
  }
  function onEvent(ev) {
    if (typeof ev.i === "number") st.evIndex = Math.max(st.evIndex, ev.i + 1);
    st.timeline.push({ t: ev.t, provider: ev.provider ?? null, state: ev.state ?? null, n: ev.items?.length ?? null, sources: ev.items ? [...new Set(ev.items.map((x) => x.source))] : null, at: performance.now() });
    if (ev.t === "start") {
      st.sid = ev.sid; st.fallback = Boolean(ev.fallback || ev.noKeys);
      if (ev.q !== undefined && ev.mode === "search") { st.q = ev.q; el$(".g-search input").value = ev.q; }
      if (ev.rating) st.rating = ev.rating; if (ev.type) st.type = ev.type;
      paintFilters();
      empty(ev.providers?.length ? "" : "No GIF sources are switched on. Turn some on in Settings → GIFs.");
    } else if (ev.t === "status") { st.statuses[ev.provider] = ev; paintStatus(); }
    else if (ev.t === "fallback") { st.fallback = true; paintAttribution(); }
    else if (ev.t === "items") addItems(ev.items);
    else if (ev.t === "done") {
      st.more = Boolean(ev.more); el$(".g-more").hidden = !st.more;
      if (!st.items.length) empty(st.mode === "trending" ? "No trending GIFs right now." : `No GIFs found for ${st.q}.`);
      paintAttribution();
      try { api("/screen/shown", { kind: "gifs", view: "gifs", title: st.mode === "trending" ? "Trending GIFs" : `GIFs of ${st.q}`, text: st.tiles.filter((t) => t.n).slice(0, 30).map((t) => `${t.n}. ${t.it.title}`).join(" ") }).catch(() => {}); } catch { /* fine */ }
    }
  }
  const empty = (t) => { const e = el$(".g-empty"); if (!e) return; e.textContent = t; e.hidden = !t; };

  // ---------------------------------------------------------------------------------------------------- tiles (masonry, lazy, numbered)
  let cols = [];
  function colCount() { const w = el$(".g-body")?.clientWidth || 800; return Math.max(2, Math.min(8, Math.floor(w / (st.saver ? 150 : 200)))); }
  function relayout(force = false) {
    if (!root) return;
    const n = colCount(), grid = el$(".g-grid");
    if (!force && n === cols.length && cols.every((c) => c.isConnected)) return;
    if (st.local === "categories") return;
    cols = Array.from({ length: n }, () => { const c = el("div", "g-col"); c.dataset.h = "0"; return c; });
    grid.replaceChildren(...cols);
    for (const t of st.tiles) if (!t.gone) place(t);
  }
  function place(t) {
    if (!cols.length || !cols[0].isConnected) relayout(true);
    const c = cols.reduce((a, b) => (Number(b.dataset.h) < Number(a.dataset.h) ? b : a));
    c.appendChild(t.el);
    c.dataset.h = String(Number(c.dataset.h) + (t.ar ? 1 / t.ar : 1) + 0.08);
  }
  function passes(it) {
    if (!ratingOk(it.rating, st.rating)) { st.dropped.rating++; return false; }       // the screen checks the rating too
    if (st.local && st.provider !== "all" && it.source !== st.provider) return false;
    return true;
  }
  function addItems(items) {
    empty("");
    const firstNew = st.tiles.length;
    for (const it of items) {
      if (st.items.some((x) => x.id === it.id) || !passes(it)) continue;
      st.items.push(it);
      const t = { it, ar: it.previewWidth && it.previewHeight ? it.previewWidth / it.previewHeight : it.width && it.height ? it.width / it.height : 1, state: "wait", n: null, el: null, gone: false };
      t.ar = Math.max(0.4, Math.min(2.8, t.ar));
      const b = el("button", "g-tile"); b.type = "button"; b.setAttribute("role", "listitem"); b.dataset.id = it.id; b.dataset.source = it.source;
      b.setAttribute("aria-label", `${it.title}, from ${LABEL[it.source] ?? it.source}`);
      b.title = it.title;
      const m = el("div", "g-media"); m.style.aspectRatio = String(t.ar);
      b.append(m, el("span", "g-num"), el("span", "g-src", LABEL[it.source] ?? it.source));
      b.onclick = () => showDetail(t);
      b.onpointerenter = () => { if (animMode() === "hover") b.classList.remove("still"); };
      b.onpointerleave = () => { if (animMode() !== "always" && t.state === "ok") b.classList.add("still"); };
      b.onfocus = () => { if (animMode() === "hover") b.classList.remove("still"); };
      b.onblur = () => { if (animMode() !== "always" && t.state === "ok") b.classList.add("still"); };
      t.el = b; st.tiles.push(t); place(t);
      lazy?.observe(b);
    }
    // "more" by voice: bring the new ones into view (they load and get their numbers there)
    if (st.scrollNew && st.tiles[firstNew]) { st.scrollNew = false; st.tiles[firstNew].el.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" }); }
  }
  const animMode = () => { const a = S?.settings?.autoplay ?? "always"; return a === "always" && reduced() ? "hover" : a; };
  function startTile(tileEl) {
    const t = st.tiles.find((x) => x.el === tileEl);
    if (!t || t.state !== "wait") return;
    t.state = "loading";
    const src = onlyMedia(st.saver ? t.it.px?.small || t.it.px?.preview : t.it.px?.preview) || onlyMedia(t.it.px?.gif);
    if (!src) return fail(t);
    const img = new Image(); img.alt = ""; img.decoding = "async"; img.referrerPolicy = "no-referrer";
    img.onload = () => loaded(t, img);
    img.onerror = () => { const alt = onlyMedia(t.it.px?.small); if (alt && !img.src.endsWith(alt) && img.dataset.retry !== "1") { img.dataset.retry = "1"; img.src = alt; return; } fail(t); };
    img.src = src;
    t.el.querySelector(".g-media").appendChild(img);
  }
  // an 8×8 grey fingerprint of the first frame: look-alikes from two sources are dropped
  function fingerprint(img) {
    try {
      const c = document.createElement("canvas"); c.width = 8; c.height = 8;
      const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0, 8, 8);
      const d = x.getImageData(0, 0, 8, 8).data, g = [];
      for (let i = 0; i < 64; i++) g.push(d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114);
      const mean = g.reduce((a, b) => a + b, 0) / 64;
      const bits = g.map((v) => (v > mean ? 1 : 0));
      const ones = bits.reduce((a, b) => a + b, 0);
      return ones === 0 || ones === 64 ? null : bits;           // a flat picture tells nothing
    } catch { return null; }
  }
  const hamming = (a, b) => { let d = 0; for (let i = 0; i < 64; i++) if (a[i] !== b[i]) d++; return d; };
  function loaded(t, img) {
    if (t.gone) return;
    const h = fingerprint(img);
    if (h && st.hashes.some((x) => x.t !== t && hamming(x.h, h) <= 4)) { st.dropped.look++; return drop(t); }
    if (h) st.hashes.push({ t, h });
    t.state = "ok"; t.el.classList.add("loaded");
    // a still of the first frame, for "animate on hover" and reduced motion
    try { const c = document.createElement("canvas"); c.width = img.naturalWidth || 200; c.height = img.naturalHeight || 150; c.getContext("2d").drawImage(img, 0, 0); t.el.querySelector(".g-media").appendChild(c); t.still = c; } catch { /* fine */ }
    if (animMode() !== "always") t.el.classList.add("still");
    commit();
  }
  function fail(t) { st.dropped.broken++; drop(t); }
  function drop(t) {
    t.gone = true; t.state = "gone"; lazy?.unobserve(t.el); t.el.remove();
    st.items = st.items.filter((x) => x.id !== t.it.id);
    relayout(true); commit();
  }
  // numbers go on in order, only past tiles that have loaded (a dropped one just gives its place to the next)
  let postTimer = null;
  function commit() {
    let changed = false;
    for (const t of st.tiles) {
      if (t.gone) continue;
      if (t.state !== "ok") break;
      if (t.n == null) { t.n = ++st.committed; t.el.querySelector(".g-num").textContent = String(t.n); t.el.setAttribute("aria-label", `Number ${t.n}: ${t.it.title}, from ${LABEL[t.it.source] ?? t.it.source}`); t.el.dataset.n = String(t.n); changed = true; }
    }
    if (changed) { paintAttribution(); clearTimeout(postTimer); postTimer = setTimeout(postNumbers, 150); }
  }
  function postNumbers() {
    if (!st.sid) return;
    api("/gifs/numbers", { sid: st.sid, pickMode: Boolean(st.onPick), items: st.tiles.filter((t) => t.n && !t.gone).map((t) => ({ n: t.n, id: t.it.id })) }).catch(() => {});
  }
  function refilter() {
    if (st.local === "favorites" || st.local === "recent") return showLibrary(st.local);
    if (st.local === "categories") return;
    if (st.mode === "trending") return runSearch({ mode: "trending" });
    if (st.q) return runSearch({ q: st.q });
  }

  // ---------------------------------------------------------------------------------------------------- the big preview and its actions
  const byN = (n) => st.tiles.find((t) => t.n === Number(n) && !t.gone);
  function mediaFor(it, format) {
    const px = it.px ?? {};
    if (format === "mp4" && onlyMedia(px.mp4)) { const v = el("video"); v.src = px.mp4; v.muted = true; v.loop = true; v.autoplay = !reduced(); v.playsInline = true; v.controls = reduced(); v.setAttribute("aria-label", it.title); v.onerror = () => v.replaceWith(mediaFor(it, "gif")); return v; }
    const src = (format === "webp" && onlyMedia(px.webp)) || onlyMedia(px.gif) || onlyMedia(px.preview);
    const i = new Image(); i.alt = it.title; i.referrerPolicy = "no-referrer"; i.src = src;
    i.onerror = () => { const p = onlyMedia(px.preview); if (p && !i.src.endsWith(p)) i.src = p; else i.replaceWith(el("p", "", "Couldn't load this GIF.")); };
    return i;
  }
  function showDetail(t) {
    if (!t) return;
    st.detail = t;
    const d = el$(".g-detail"), it = t.it;
    const frame = el("div", "g-frame"); frame.appendChild(mediaFor(it, st.format));
    const info = el("div", "g-info");
    info.appendChild(el("div", "g-dt", it.title));
    const meta = el("div", "g-meta");
    if (t.n) meta.appendChild(el("span", "g-num", String(t.n)));
    const p = S?.providers?.find((x) => x.id === it.source);
    meta.append(el("span", "", p?.attribution?.text ?? LABEL[it.source] ?? it.source), el("span", "", `Rated ${RWORD[it.rating] ?? "?"}`));
    if (it.width && it.height) meta.appendChild(el("span", "", `${it.width}×${it.height}`));
    if (it.bytes) meta.appendChild(el("span", "", `${(it.bytes / 1048576).toFixed(it.bytes > 1048576 ? 1 : 2)} MB`));
    if (it.type === "sticker") meta.appendChild(el("span", "", "Sticker"));
    info.appendChild(meta);
    const acts = el("div", "g-acts");
    const add = (label, fn, cls = "g-btn", key = "") => { const b = btn(cls, label); if (key) b.setAttribute("aria-keyshortcuts", key); b.onclick = fn; acts.appendChild(b); return b; };
    if (st.onPick) add("✚ Insert this GIF", () => pick(t), "g-btn main g-act-pick", "Enter");
    add("Copy GIF", () => copyGif(it), "g-btn g-act-copy", "C");
    add("Copy link", () => copyLink(it), "g-btn g-act-link", "L");
    add("Save to my computer", () => save(it), "g-btn g-act-save", "S");
    const fav = add(favSet.has(it.id) ? "★ Favourite" : "☆ Favourite", () => toggleFav(it, fav), "g-btn g-act-fav", "F");
    const page = httpUrl(it.page);
    if (page) add("Open source page ↗", () => window.open(page, "_blank", "noopener,noreferrer"), "g-btn g-act-src");
    add("More like this", () => { const w = it.title.replace(/\b(gif|gifs|sticker|by|giphy|klipy|imgur)\b/gi, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 6).join(" "); if (w.length > 2) { setTab("search", { silent: true }); runSearch({ q: w }); } }, "g-btn g-act-similar");
    add("◀ Back", () => closeDetail(), "g-btn g-act-back", "Escape");
    info.appendChild(acts);
    d.replaceChildren(frame, info); d.hidden = false;
    acts.querySelector("button")?.focus();
    if (st.sid && t.n && !st.local) api("/gifs/act", { action: "view", n: t.n }).catch(() => {});
  }
  function closeDetail(quiet = false) {
    const d = el$(".g-detail"); if (!d || d.hidden) return;
    const t = st.detail; st.detail = null; d.hidden = true; d.replaceChildren();
    if (!quiet) { t?.el?.isConnected && t.el.focus(); if (st.sid && !st.local) api("/gifs/act", { action: "grid" }).catch(() => {}); }
  }
  const favSet = new Set();
  api("/gifs/library").then((l) => l.favorites.forEach((x) => favSet.add(x.id))).catch(() => {});
  async function toggleFav(it, b) {
    const on = !favSet.has(it.id);
    try { await api("/gifs/favorite", { id: it.id, on }); if (on) favSet.add(it.id); else favSet.delete(it.id); b.textContent = on ? "★ Favourite" : "☆ Favourite"; say(on ? "Added to your favourites." : "Removed from your favourites."); } catch (e) { say(e.message); }
  }
  async function save(it) {
    say("Saving…");
    try { const r = await api("/gifs/save", { id: it.id, format: st.format === "mp4" ? "mp4" : "gif" }); st.lastSave = r.saved; say(r.saved.where === "pictures" ? "Saved in Pictures › Dayspring GIFs." : r.saved.where === "custom" ? `Saved in ${r.saved.folder}.` : "Saved in Dayspring's GIFs folder (Dayspring may not change your Pictures folder: Settings → Permissions)."); }
    catch (e) { say(`Couldn't save: ${e.message}`); }
  }
  async function copyLink(it) {
    const link = httpUrl(it.page) || httpUrl(it.url);
    try { await navigator.clipboard.writeText(link); say("Link copied."); api("/gifs/used", { id: it.id }).catch(() => {}); return; } catch { /* the page may not be focused */ }
    try { await api("/gifs/copy", { id: it.id, what: "link" }); say("Link copied."); } catch (e) { say(`Couldn't copy: ${e.message}`); }
  }
  // the GIF itself: on Windows, Dayspring puts the file, a picture for rich editors and the link on the clipboard at
  // once; elsewhere the browser copies the picture (its first frame as PNG) with HTML pointing at the GIF, and the link
  async function copyGif(it) {
    if (S?.clipboard === "system" || S?.clipboard === "dry") {
      try { const r = await api("/gifs/copy", { id: it.id, what: "gif" }); st.lastCopy = r; say("GIF copied. Paste it into an email, a chat or a folder."); return; } catch (e) { say(`Couldn't copy: ${e.message}`); }
    }
    const url = httpUrl(it.url);
    try {
      const t = st.tiles.find((x) => x.it.id === it.id);
      const html = `<img src="${url.replace(/"/g, "&quot;")}" alt="${it.title.replace(/[<>"&]/g, "")}">`;
      const parts = { "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([url], { type: "text/plain" }) };
      if (t?.still) { const png = await new Promise((r) => t.still.toBlob(r, "image/png")); if (png) parts["image/png"] = png; }
      await navigator.clipboard.write([new ClipboardItem(parts)]);
      say("GIF copied."); api("/gifs/used", { id: it.id }).catch(() => {});
    } catch { copyLink(it); }
  }
  async function pick(t) {
    const it = t.it, cb = st.onPick;
    if (!cb) return;
    say("Adding…");
    let file = null;
    try { const f = await api(`/gifs/file?id=${encodeURIComponent(it.id)}&format=${st.format === "mp4" ? "mp4" : "gif"}`); file = { path: f.path, name: f.name, type: f.type, bytes: f.bytes, href: f.href }; } catch { /* the address still works */ }
    api("/gifs/used", { id: it.id }).catch(() => {});
    const p = S?.providers?.find((x) => x.id === it.source);
    const out = { url: it.url, mp4: it.mp4 ?? null, width: it.width, height: it.height, title: it.title, source: it.source, id: it.id, preview: onlyMedia(it.px?.gif) || onlyMedia(it.px?.preview), page: it.page ?? null, attribution: p?.attribution?.text ?? null, ...(file ? { file } : {}) };
    st.onPick = null;
    close();
    try { cb(out); } catch (e) { console.error("GIF picker: onPick failed", e); }
  }

  // ---------------------------------------------------------------------------------------------------- keyboard
  function keys(e) {
    if (e.key === "Escape") {
      if (e.dsTop && e.dsTop !== root) return;
      e.preventDefault(); e.stopPropagation();
      if (st.detail) closeDetail(); else close();
      return;
    }
    const inField = e.target.matches("input, select, textarea");
    if (e.key === "/" && !inField) { e.preventDefault(); el$(".g-search input").focus(); return; }
    if (st.detail && !inField && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const k = e.key.toLowerCase(), it = st.detail.it;
      if (k === "c") { e.preventDefault(); copyGif(it); } else if (k === "l") { e.preventDefault(); copyLink(it); } else if (k === "s") { e.preventDefault(); save(it); }
      else if (k === "f") { e.preventDefault(); root.querySelector(".g-act-fav")?.click(); }
      else if (e.key === "ArrowRight" || e.key === "ArrowLeft") { const live = st.tiles.filter((x) => !x.gone && x.state === "ok"); const i = live.indexOf(st.detail); const n = live[i + (e.key === "ArrowRight" ? 1 : -1)]; if (n) { e.preventDefault(); showDetail(n); } }
      else if (e.key === "Backspace") { e.preventDefault(); closeDetail(); }
      return;
    }
    if (!/^Arrow/.test(e.key) || inField) return;
    const tile = e.target.closest?.(".g-tile"); if (!tile) { if (e.key === "ArrowDown" && e.target.closest(".g-search, .g-filters, .g-chips")) { const f = root.querySelector(".g-tile"); if (f) { e.preventDefault(); f.focus(); } } return; }
    const r0 = tile.getBoundingClientRect(), cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    let best = null, bd = Infinity;
    for (const o of root.querySelectorAll(".g-tile")) {
      if (o === tile) continue;
      const r = o.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, dx = x - cx, dy = y - cy;
      const ok = e.key === "ArrowRight" ? dx > 5 && Math.abs(dy) < r0.height * 1.2 + r.height : e.key === "ArrowLeft" ? dx < -5 && Math.abs(dy) < r0.height * 1.2 + r.height : e.key === "ArrowDown" ? dy > 5 && Math.abs(dx) < r0.width / 2 + 4 : dy < -5 && Math.abs(dx) < r0.width / 2 + 4;
      if (!ok) continue;
      const dist = Math.abs(dx) + Math.abs(dy) * (e.key === "ArrowLeft" || e.key === "ArrowRight" ? 3 : 1);
      if (dist < bd) { bd = dist; best = o; }
    }
    if (best) { e.preventDefault(); best.focus(); best.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "ArrowUp") { e.preventDefault(); el$(".g-search input").focus(); }
  }
  function focusFirst() { (root.querySelector(".g-tile") ?? el$(".g-search input"))?.focus(); }

  // ---------------------------------------------------------------------------------------------------- open / close
  async function open({ query = "", onPick = null, type, rating, tab, sid = null, mode, provider } = {}) {
    if (!root) build();
    await loadSettings();
    const s = S.settings ?? {};
    st.onPick = typeof onPick === "function" ? onPick : null;
    st.rating = RATINGS.includes(rating) ? rating : s.rating ?? "pg-13";
    st.type = type === "sticker" ? "sticker" : type === "gif" ? "gif" : s.type ?? "gif";
    st.format = ["gif", "mp4", "webp"].includes(s.format) ? s.format : "gif";
    st.saver = Boolean(s.dataSaver);
    st.provider = provider && provider !== "all" ? provider : "all";
    st.open = true; root.hidden = false; pill.hidden = true; st.minimized = false;
    root.classList.toggle("picking", Boolean(st.onPick));
    if (st.pos) floatAt(st.pos);
    paintFilters(); paintChips();
    const q = String(query ?? "").trim();
    if (sid) { for (const t of root.querySelectorAll(".g-tab")) t.setAttribute("aria-selected", String(t.dataset.tab === (mode === "trending" ? "trending" : "search"))); st.tab = mode === "trending" ? "trending" : "search"; st.mode = mode ?? "search"; st.q = q; await attach(sid); }
    else if (tab && tab !== "search" && tab !== "trending") await setTab(tab);
    else if (q) { await setTab("search", { silent: true }); runSearch({ q }); }
    else await setTab("trending");
    setTimeout(focusFirst, 50);
    return true;
  }
  function close() {
    if (!root || !st.open) return;
    stopStream(); st.open = false; root.hidden = true; pill.hidden = true;
    st.onPick = null;
    api("/gifs/closed", { sid: st.sid }).catch(() => {});
  }

  // ---------------------------------------------------------------------------------------------------- what the server says (voice and the AI)
  function onServer(v) {
    if (!v || typeof v !== "object") return;
    const mine = st.open && v.sid && v.sid === st.sid;
    if (v.do === "open") { if (st.open || isDisplay()) open({ sid: v.sid, query: v.q, mode: v.mode, rating: v.rating, type: v.type, provider: v.providers?.[0], onPick: st.onPick }); return; }
    if (v.do === "close") { if (st.open) close(); return; }
    if (!mine) return;
    if (st.minimized) minimize(false);
    if (v.do === "view") { const t = byN(v.n); if (t) showDetail(t); }
    else if (v.do === "grid") closeDetail(true);
    else if (v.do === "more") { st.scrollNew = true; attach(v.sid); }
    else if (v.do === "pick") { const t = byN(v.n); if (t && st.onPick) pick(t); }
    else if (v.do === "saved") say(v.where === "pictures" ? `Saved number ${v.n} in Pictures › Dayspring GIFs.` : `Saved number ${v.n}.`);
    else if (v.do === "favorited") { favSet.add(v.id); say(`Number ${v.n} is a favourite now.`); }
  }
  const listen = (es) => es.addEventListener("gifs", (e) => { let v = null; try { v = JSON.parse(e.data); } catch { return; } onServer(v); });
  if (window.dsEvents) listen(window.dsEvents);
  else {
    addEventListener("ds-events", (e) => listen(e.detail), { once: true });
    // a page without the Dayspring screen's events (the email editor, /gifs): its own connection
    setTimeout(() => { if (!window.dsEvents && !listen.own) { try { listen.own = new EventSource("/api/events"); listen(listen.own); } catch { /* fine without voice */ } } }, 2500);
  }
  addEventListener("ds-test-gifs", (e) => onServer(e.detail));

  // 🎞 GIFs by the clock on the Dayspring screen (it moves into ⋯ More when there's no room)
  (function addButton() {
    const util = document.querySelector("#calBtns .util, .calbtns .util");
    if (!util || document.getElementById("gifsBtn")) return;
    const b = document.createElement("button");
    b.id = "gifsBtn"; b.type = "button"; b.title = "GIFs: search, trending, favourites"; b.innerHTML = '<i aria-hidden="true">🎞</i><span class="lbl">GIFs</span>';
    b.onclick = () => (st.open ? close() : open({}));
    util.insertBefore(b, util.querySelector("#setBtn") ?? null);
  })();

  window.dsGifPicker = {
    open: (o = {}) => open(o),
    close: () => close(),
    isOpen: () => st.open,
    // for tests and the email editor: what's showing
    _state: () => ({ open: st.open, tab: st.tab, sid: st.sid, q: st.q, rating: st.rating, type: st.type, provider: st.provider, loading: st.loading, more: st.more, minimized: st.minimized, detail: st.detail ? { n: st.detail.n, id: st.detail.it.id } : null,
      numbers: st.tiles.filter((t) => t.n && !t.gone).map((t) => ({ n: t.n, id: t.it.id, source: t.it.source, title: t.it.title })), dropped: { ...st.dropped }, statuses: { ...st.statuses }, fallback: st.fallback, timeline: st.timeline.slice(), lastSave: st.lastSave ?? null, lastCopy: st.lastCopy ?? null, picking: Boolean(st.onPick) }),
  };
})();
