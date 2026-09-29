// The Music & Video browser on the Dayspring screen: Spotify, YouTube, his own files and Google Drive in one window.
//   Top: the sources, and a big search box: results appear as he types (after a quarter of a second), grouped (Songs ·
//        Artists · Albums · Playlists · Genres and moods on Spotify; Videos · Channels · Playlists on YouTube). Every
//        result: ▶ Play, ⤴ Play next, ＋ Queue, ↗ Open (an artist, album, playlist or channel opens INSIDE the browser),
//        ♥ Save where Spotify allows it, ☰ Add to a playlist.
//   Left: the sections (Spotify: now playing, playlists, Liked Songs, saved albums, followed artists, top artists and
//        songs, recently played, the queue · YouTube: watch history, playlists, Liked videos, Watch later, subscriptions,
//        the queue · My files: recent, songs, albums, artists, videos · Drive: recent). Long lists load more by themselves
//        as he scrolls (and with "Load more").
//   Common: list or grid, sort, filters (YouTube: length, date, no Shorts · Spotify: type), multi-select, recent
//        searches, a mini now-playing bar with controls. Everything is numbered, and the numbers go to the server
//        (/api/mb/view) so "play number 3" works on whatever is showing.
// Opened from 🎵 Music by the clock (it moves into ⋯ More when there's no room), by voice ("open my music", "show my
// liked songs", "show my YouTube history", "search Spotify for …") or by the AI (the "mbrowser" event).
// The window lives inside the screen's margins (safe-area.css, dsKeepInSafe), docked or floating, and can be resized.
// Keyboard and remote: ↑↓ ←→ move, Enter plays, Space selects, N play next, Q queue, L like, O or → opens, Backspace
// goes back, / searches, Esc closes (a menu, then a page, then the window).
(() => {
  if (window.dsMB) return;
  if (window.dsFeatures?.on && window.dsFeatures.on("mediabrowser") === false) return;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (typeof u === "string" && /^https:\/\/[\w.-]+\//.test(u) ? u : "");
  const api = async (path, body) => {
    const r = await fetch("/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok && !j.error) j.error = `Dayspring couldn't do that just now (${r.status}).`;
    return j;
  };
  const store = { get(k, d = null) { try { const v = JSON.parse(localStorage.getItem("dsMB." + k)); return v ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem("dsMB." + k, JSON.stringify(v)); } catch { /* private window */ } } };
  const toast = (t, s = "") => (window.dayspring?.toast ? window.dayspring.toast(t, s, "", "bell") : null);
  const mmss = (x) => { x = Math.max(0, Math.floor(Number(x) || 0)); const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), s = String(x % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`; };
  const lenOf = (x) => x.length || (x.ms ? mmss(x.ms / 1000) : x.secs ? mmss(x.secs) : "");
  if (!document.querySelector('link[href="/mediabrowser.css"]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/mediabrowser.css"; document.head.appendChild(l); }

  const SRC = [["spotify", "Spotify"], ["youtube", "YouTube"], ["local", "My files"], ["drive", "Drive"]];
  const ICON = { track: "♪", episode: "🎙", album: "◉", artist: "★", playlist: "☰", genre: "✦", video: "▶", channel: "◎", ytplaylist: "☰", file: "♪", localalbum: "◉", localartist: "★" };
  const st = {
    open: false, source: store.get("source", "spotify"), section: null, q: "", view: store.get("view", "list"), sort: "default", filters: store.get("filters", {}), stype: "all",
    status: null, data: null, groups: null, items: [], next: null, loading: false, seq: 0, page: null, pages: [], sel: new Set(), pos: store.get("pos"), minimized: false,
    range: "short", topType: "tracks", plFilter: "all", subsWhat: "videos", day: null, likedNow: {}, numbered: [], signWaiting: null, err: null,
  };

  // ---------------------------------------------------------------------------------------------------- building the window
  let root, pill, list, nav, input, recentBox, filtersBox, selbar, np, headEl, menuEl = null;
  function build() {
    root = document.createElement("section"); root.id = "dsMB"; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Music and videos"); root.hidden = true;
    root.innerHTML = `
      <header class="mb-bar"><span class="mb-title">🎵 Music &amp; Video</span>
        <div class="mb-src" role="tablist" aria-label="Where from">${SRC.map(([id, n]) => `<button type="button" role="tab" data-src="${id}" id="mb-src-${id}" aria-selected="false">${n}</button>`).join("")}</div>
        <span class="mb-sp"></span>
        <div class="mb-win"><button type="button" class="mb-min" title="Minimise" aria-label="Minimise">–</button><button type="button" class="mb-dock" title="Fill the screen (double-click the title bar)" aria-label="Fill the screen">▢</button><button type="button" class="mb-x" title="Close (Esc)" aria-label="Close the music and video browser">✕</button></div></header>
      <form class="mb-search" role="search" autocomplete="off">
        <input class="mb-q" type="search" maxlength="200" enterkeyhint="search" aria-label="Search">
        <div class="mb-tools">
          <select class="mb-type" aria-label="Show only"></select>
          <select class="mb-sort" aria-label="Sort"><option value="default">Sort: best</option><option value="title">Title A–Z</option><option value="by">Artist / channel</option><option value="length">Length</option><option value="newest">Newest first</option></select>
          <button type="button" class="mb-btn mb-filt" aria-pressed="false" title="Filters">⚲ Filters</button>
          <button type="button" class="mb-btn mb-viewbtn" title="List or grid" aria-label="Switch between list and grid">▦ Grid</button>
          <button type="button" class="mb-btn mb-selbtn" aria-pressed="false" title="Pick several">☑ Select</button>
        </div>
        <div class="mb-recent" hidden></div>
      </form>
      <div class="mb-filters" hidden></div>
      <div class="mb-main"><nav class="mb-nav" aria-label="Sections"></nav>
        <div class="mb-content"><div class="mb-head"></div><div class="mb-list" role="list" tabindex="-1"></div></div></div>
      <div class="mb-selbar" hidden></div>
      <footer class="mb-np" hidden></footer>
      <div class="mb-grip" aria-hidden="true"></div>`;
    document.body.appendChild(root);
    pill = document.createElement("button"); pill.id = "dsMBPill"; pill.type = "button"; pill.hidden = true; pill.textContent = "🎵 Music & Video"; pill.onclick = () => minimize(false);
    document.body.appendChild(pill);
    list = $(".mb-list", root); nav = $(".mb-nav", root); input = $(".mb-q", root); recentBox = $(".mb-recent", root); filtersBox = $(".mb-filters", root); selbar = $(".mb-selbar", root); np = $(".mb-np", root); headEl = $(".mb-head", root);
    $$(".mb-src [data-src]", root).forEach((b) => (b.onclick = () => setSource(b.dataset.src)));
    $(".mb-src", root).addEventListener("keydown", (e) => { if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return; const all = $$(".mb-src button:not([hidden])", root), i = all.indexOf(document.activeElement); if (i < 0) return; const n = all[(i + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length]; n.focus(); n.click(); e.preventDefault(); });
    $(".mb-x", root).onclick = close; $(".mb-min", root).onclick = () => minimize(true); $(".mb-dock", root).onclick = dock;
    $(".mb-search", root).onsubmit = (e) => { e.preventDefault(); clearTimeout(typeTimer); runSearch({ remember: true }); input.blur(); focusFirst(); };
    input.addEventListener("input", onType);
    input.addEventListener("focus", () => paintRecent());
    input.addEventListener("blur", () => setTimeout(() => { if (!root.contains(document.activeElement) || !recentBox.contains(document.activeElement)) recentBox.hidden = true; }, 150));
    input.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); recentBox.hidden = true; focusFirst(); } });
    $(".mb-sort", root).onchange = (e) => { st.sort = e.target.value; paintList(); };
    $(".mb-type", root).onchange = (e) => { st.stype = e.target.value; if (st.q) runSearch({}); else paintList(); };
    $(".mb-filt", root).onclick = () => { filtersBox.hidden = !filtersBox.hidden; $(".mb-filt", root).setAttribute("aria-pressed", String(!filtersBox.hidden)); paintFilters(); };
    $(".mb-viewbtn", root).onclick = () => { st.view = st.view === "grid" ? "list" : "grid"; store.set("view", st.view); paintList(); };
    $(".mb-selbtn", root).onclick = () => { root.classList.toggle("selecting"); $(".mb-selbtn", root).setAttribute("aria-pressed", String(root.classList.contains("selecting"))); if (!root.classList.contains("selecting")) { st.sel.clear(); } paintList(); };
    list.addEventListener("click", onListClick);
    // a picture that doesn't load (offline, blocked): the coloured tile with its icon instead of a broken image
    root.addEventListener("error", (e) => { const im = e.target; if (im?.tagName === "IMG" && im.classList.contains("mb-art")) { const s2 = document.createElement("span"); s2.className = im.className; s2.setAttribute("aria-hidden", "true"); s2.textContent = im.dataset.icon || "♪"; im.replaceWith(s2); } }, true);
    list.addEventListener("keydown", onListKey);
    list.addEventListener("scroll", () => { if (st.next != null && !st.loading && list.scrollTop + list.clientHeight > list.scrollHeight - 280) loadMore(); }, { passive: true });
    selbar.addEventListener("click", onSelbar);
    np.addEventListener("click", onNp);
    nav.addEventListener("click", (e) => { const b = e.target.closest("[data-sec]"); if (b) setSection(b.dataset.sec); });
    dragging($(".mb-bar", root), $(".mb-grip", root));
    new ResizeObserver(() => { root.classList.toggle("narrow", root.offsetWidth < 680); }).observe(root);
    // Esc: only when this window is the top one on the screen (tv.js marks it on the key event, e.dsTop), wherever the
    // focus is: a menu or the recent searches first, then the open page, then the window. A pop-up over it (the Sound
    // panel, a notice) closes first.
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !isOpen() || (e.dsTop && e.dsTop !== root)) return;
      e.stopImmediatePropagation(); e.preventDefault();
      if (menuEl) closeMenu(); else if (!recentBox.hidden) recentBox.hidden = true; else if (st.page) back(); else close();
    }, true);
    root.addEventListener("keydown", (e) => {
      if (e.key === "/" && e.target !== input && !e.target.matches("input, select")) { e.preventDefault(); input.focus(); input.select(); }
    });
    if (st.pos) floatAt(st.pos);
  }

  // ---------------------------------------------------------------------------------------------------- moving, resizing, minimising
  function safe() { const r = window.dsSafeRect?.(); return r && r.width > 0 ? r : { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight }; }
  function clampFloat() {
    if (!root || !root.classList.contains("float") || !st.pos) return;
    const S = safe(), g = 10;
    const w = Math.min(st.pos.w, S.width - 2 * g), h = Math.min(st.pos.h, S.height - 2 * g);
    const x = Math.max(S.left + g, Math.min(st.pos.x, S.right - g - w)), y = Math.max(S.top + g, Math.min(st.pos.y, S.bottom - g - h));
    Object.assign(root.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
  }
  function floatAt(pos) { st.pos = pos; root.classList.add("float"); clampFloat(); }
  function dock() { st.pos = null; store.set("pos", null); root.classList.remove("float"); for (const k of ["left", "top", "width", "height"]) root.style[k] = ""; }
  function dragging(bar, grip) {
    const start = (e, mode) => {
      if (e.button !== 0 || (mode === "move" && e.target.closest("button, input, select, [role=tab]"))) return;
      const r = root.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY, base = { x: r.left, y: r.top, w: r.width, h: r.height };
      e.preventDefault();
      const mv = (ev) => { const dx = ev.clientX - x0, dy = ev.clientY - y0; floatAt(mode === "move" ? { ...base, x: base.x + dx, y: base.y + dy } : { ...base, w: Math.max(320, base.w + dx), h: Math.max(320, base.h + dy) }); };
      const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); if (st.pos) store.set("pos", st.pos); };
      addEventListener("pointermove", mv); addEventListener("pointerup", up);
    };
    bar.addEventListener("pointerdown", (e) => start(e, "move"));
    grip.addEventListener("pointerdown", (e) => start(e, "size"));
    bar.addEventListener("dblclick", (e) => { if (!e.target.closest("button, input, select")) dock(); });
  }
  addEventListener("resize", () => { clampFloat(); if (menuEl) window.dsKeepInSafe?.(menuEl); });
  new MutationObserver(() => clampFloat()).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
  function minimize(on) { st.minimized = on; root.hidden = on; pill.hidden = !on; if (on) pill.focus(); else focusFirst(); report(); }

  // ---------------------------------------------------------------------------------------------------- opening and closing
  async function open(o = {}) {
    if (!root) build();
    const wasOpen = st.open;
    st.open = true; st.minimized = false; root.hidden = false; pill.hidden = true;
    if (!st.status || !wasOpen) st.status = await api("/mb/status").catch(() => null);
    if (o.source && SRC.some(([id]) => id === o.source)) st.source = o.source;
    else if (!wasOpen && !o.source && st.status && st.source === "spotify" && !st.status.sources.spotify.api.signedIn && !st.status.sources.spotify.web?.signedIn) st.source = "youtube";
    if (o.range) st.range = o.range; if (o.type) st.topType = o.type === "artists" ? "artists" : "tracks"; st.day = o.day ?? null;
    st.page = null; st.pages = [];
    paintSources();
    if (o.q) { input.value = o.q; st.q = o.q; paintNav(); runSearch({ remember: false }); }
    else { if (!o.keepQuery) { input.value = ""; st.q = ""; } setSection(o.section ?? (wasOpen ? st.section : null), { quiet: true }); }
    clampFloat();
    startNp();
    if (!o.q && !wasOpen) setTimeout(() => input.focus(), 60);
    return true;
  }
  function close() {
    if (!root || !st.open) return;
    st.open = false; root.hidden = true; pill.hidden = true; closeMenu(); stopNp();
    api("/mb/view", { open: false }).catch(() => {});
  }
  const isOpen = () => Boolean(st.open && !st.minimized);

  // ---------------------------------------------------------------------------------------------------- sources, sections, the nav
  const SECTIONS = () => st.status?.sections ?? { spotify: [], youtube: [], local: [], drive: [] };
  function setSource(src) {
    if (!SRC.some(([id]) => id === src)) return;
    st.source = src; store.set("source", src); st.page = null; st.pages = []; st.sel.clear(); root.classList.remove("selecting");
    paintSources();
    if (st.q) runSearch({ remember: false }); else setSection(null);
  }
  function paintSources() {
    for (const b of $$(".mb-src [data-src]", root)) {
      b.setAttribute("aria-selected", String(b.dataset.src === st.source));
      if (b.dataset.src === "drive") b.hidden = !st.status?.sources?.drive?.connected;
    }
    input.placeholder = { spotify: "Search Spotify: songs, artists, albums, playlists, genres…", youtube: "Search YouTube: videos, channels, playlists…", local: "Search your music and videos…", drive: "Search your Google Drive…" }[st.source];
    const types = st.source === "spotify" ? [["all", "Everything"], ["track", "Songs"], ["artist", "Artists"], ["album", "Albums"], ["playlist", "Playlists"], ["genre", "Genres & moods"]]
      : st.source === "youtube" ? [["all", "Everything"], ["video", "Videos"], ["channel", "Channels"], ["ytplaylist", "Playlists"]]
      : st.source === "local" ? [["all", "Everything"], ["song", "Songs"], ["filevideo", "Videos"], ["localalbum", "Albums"], ["localartist", "Artists"]] : [["all", "Everything"]];
    const sel = $(".mb-type", root); sel.innerHTML = types.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join(""); st.stype = "all"; sel.hidden = types.length < 2;
    paintNav(); paintFilters();
  }
  function paintNav() {
    const secs = SECTIONS()[st.source] ?? [];
    nav.innerHTML = (st.q ? `<button type="button" data-sec="__search" aria-current="${!st.section || st.section === "__search"}"><i>⚲</i>Results for “${esc(st.q.slice(0, 24))}”</button><div class="mb-navsep"></div>` : "")
      + secs.map((s) => `<button type="button" data-sec="${s.id}" aria-current="${!st.q && st.section === s.id}"><i aria-hidden="true">${esc(s.icon)}</i>${esc(s.title)}</button>`).join("");
  }
  function defaultSection() {
    const s = st.status?.sources ?? {};
    if (st.source === "spotify") return s.spotify?.api?.signedIn ? "playlists" : "now";
    if (st.source === "youtube") return "history";
    return "recent";
  }
  function setSection(id, { quiet = false } = {}) {
    if (id === "__search") { if (st.q) runSearch({ remember: false }); return; }
    const secs = SECTIONS()[st.source] ?? [];
    st.section = secs.some((s) => s.id === id) ? id : defaultSection();
    if (!quiet || !st.q) { st.q = ""; input.value = ""; }
    st.page = null; st.pages = []; st.sel.clear(); st.err = null; root.classList.remove("selecting"); $(".mb-selbtn", root)?.setAttribute("aria-pressed", "false");
    paintNav();
    loadSection();
  }

  // ---------------------------------------------------------------------------------------------------- loading
  const secQuery = (cursor) => {
    const p = new URLSearchParams({ source: st.source, section: st.section });
    if (cursor != null) p.set("cursor", cursor);
    if (st.section === "top") { p.set("range", st.range); p.set("type", st.topType); }
    if (st.section === "playlists" && st.source === "spotify") p.set("filter", st.plFilter);
    if (st.section === "subscriptions") p.set("type", st.subsWhat);
    if (st.section === "recent" && st.day) p.set("day", st.day);
    if (st.section === "history" && st.histQ) p.set("query", st.histQ);
    return p;
  };
  async function loadSection() {
    const my = ++st.seq;
    st.loading = true; st.groups = null; st.items = []; st.next = null; st.data = null;
    paintHead(); list.innerHTML = skeleton(); list.scrollTop = 0;
    const r = await api("/mb/section?" + secQuery());
    if (my !== st.seq) return;
    st.loading = false; st.data = r; st.items = r.items ?? []; st.next = r.next ?? null;
    paintHead(); paintList();
  }
  async function loadMore() {
    if (st.loading || st.next == null) return;
    const my = st.seq;
    st.loading = true; paintMoreBtn();
    let r;
    if (st.page) r = await api("/mb/page?" + new URLSearchParams({ ...st.page.q, cursor: st.next }));
    else r = await api("/mb/section?" + secQuery(st.next));
    if (my !== st.seq) return;
    st.loading = false;
    if (r.error) { toast("Couldn't load more", r.error); st.next = null; paintMoreBtn(); return; }
    const have = new Set(st.items.map((x) => x.key));
    st.items.push(...(r.items ?? []).filter((x) => !have.has(x.key)));
    st.next = r.next ?? null;
    paintList({ keepScroll: true });
  }
  const skeleton = () => Array.from({ length: 7 }, () => `<div class="mb-skel"></div>`).join("");

  // ---- live search: after a quarter of a second of no typing; stale answers are dropped ----
  let typeTimer = null, keepTimer = null;
  function onType() {
    clearTimeout(typeTimer); clearTimeout(keepTimer);
    const q = input.value.trim();
    recentBox.hidden = Boolean(q);
    if (!q) { st.q = ""; paintNav(); setSection(st.section); paintRecent(); return; }
    typeTimer = setTimeout(() => runSearch({ remember: false }), 250);
    // what he settles on is kept in the recent searches (not every letter of it)
    keepTimer = setTimeout(() => { if (input.value.trim() === q && q.length >= 2) api("/mb/recent", { q, source: st.source }).catch(() => {}); }, 2000);
  }
  async function runSearch({ remember = false, only = null } = {}) {
    const q = input.value.trim();
    if (!q) return;
    st.q = q; st.section = "__search"; st.page = null; st.pages = []; st.sel.clear(); st.err = null;
    paintNav();
    const my = ++st.seq;
    st.loading = true; st.groups = null; st.items = []; st.next = null;
    paintHead(); if (!list.querySelector(".mb-item")) list.innerHTML = skeleton();
    const typeOnly = only ?? (st.stype !== "all" ? st.stype : null);
    const p = new URLSearchParams({ source: st.source, q, remember: remember ? "1" : "0" });
    if (typeOnly) p.set("only", typeOnly);
    if (st.source === "youtube") p.set("filters", JSON.stringify(st.filters));
    const r = await api("/mb/search?" + p);
    if (my !== st.seq) return;
    st.loading = false; st.data = r;
    st.groups = (r.groups ?? []).map((g) => ({ ...g }));
    st.items = st.groups.flatMap((g) => g.items);
    paintHead(); paintList();
  }
  async function groupMore(gid) {
    const g = st.groups?.find((x) => x.id === gid); if (!g || g.next == null) return;
    const p = new URLSearchParams({ source: st.source, q: st.q, only: gid, from: String(g.next), remember: "0" });
    if (st.source === "youtube") { p.set("filters", JSON.stringify(st.filters)); p.set("have", g.items.map((x) => x.videoId).filter(Boolean).join(",")); }
    g.loading = true; paintList({ keepScroll: true });
    const r = await api("/mb/search?" + p);
    g.loading = false;
    const add = (r.groups ?? [])[0];
    if (add) { const have = new Set(g.items.map((x) => x.key)); g.items.push(...add.items.filter((x) => !have.has(x.key))); g.next = add.next ?? null; } else g.next = null;
    st.items = st.groups.flatMap((x) => x.items);
    paintList({ keepScroll: true });
  }
  async function paintRecent() {
    if (input.value.trim()) { recentBox.hidden = true; return; }
    const rec = (st.status?.recent ?? []).filter((x) => !x.source || x.source === st.source).slice(0, 10);
    if (!rec.length) { recentBox.hidden = true; return; }
    recentBox.innerHTML = `<b>Recent</b>${rec.map((x) => `<button type="button" class="mb-chip" data-rq="${esc(x.q)}">${esc(x.q)}</button>`).join("")}<button type="button" class="mb-chip" data-rclear title="Forget recent searches">✕ Clear</button>`;
    recentBox.hidden = false;
    recentBox.onclick = async (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if ("rclear" in b.dataset) { await api("/mb/recent", { clear: true }); if (st.status) st.status.recent = []; recentBox.hidden = true; return; }
      input.value = b.dataset.rq; recentBox.hidden = true; runSearch({ remember: true });
    };
  }

  // ---------------------------------------------------------------------------------------------------- filters (YouTube: length, date, no Shorts)
  function paintFilters() {
    if (!filtersBox) return;
    $(".mb-filt", root).hidden = st.source !== "youtube";
    if (st.source !== "youtube") { filtersBox.hidden = true; return; }
    const f = st.filters;
    filtersBox.innerHTML = `<label>Length <select data-f="duration"><option value="">Any</option><option value="short">Under 4 min</option><option value="medium">4–20 min</option><option value="long">Over 20 min</option></select></label>
      <label>Uploaded <select data-f="date"><option value="">Any time</option><option value="today">Today</option><option value="week">This week</option><option value="month">This month</option><option value="year">This year</option></select></label>
      <label><input type="checkbox" data-f="noShorts"> No Shorts</label>
      <label>Order <select data-f="sort"><option value="relevance">Best match</option><option value="newest">Newest</option><option value="popular">Most viewed</option></select></label>`;
    for (const el of $$("[data-f]", filtersBox)) {
      if (el.type === "checkbox") el.checked = Boolean(f[el.dataset.f]); else el.value = f[el.dataset.f] ?? (el.dataset.f === "sort" ? "relevance" : "");
      el.onchange = () => { const v = el.type === "checkbox" ? el.checked : el.value; if (v) f[el.dataset.f] = v; else delete f[el.dataset.f]; store.set("filters", f); if (st.q) runSearch({}); else paintList(); };
    }
  }
  // the same limits for a section's list, here (the server applies them to searches)
  const DAYS = { today: 1, week: 7, month: 31, year: 366 };
  function ageDays(a) { const m = /(\d+)\s*(second|minute|hour|day|week|month|year)/i.exec(a ?? ""); if (!m) return null; const n = Number(m[1]); return { second: 0, minute: 0, hour: 0, day: n, week: n * 7, month: n * 30, year: n * 365 }[m[2].toLowerCase()]; }
  function passes(x) {
    if (st.source !== "youtube" || x.kind !== "video") return true;
    const f = st.filters;
    if (f.noShorts && x.short) return false;
    if (f.duration && x.secs) { if (f.duration === "short" && x.secs >= 240) return false; if (f.duration === "medium" && (x.secs < 240 || x.secs > 1200)) return false; if (f.duration === "long" && x.secs <= 1200) return false; }
    if (f.date && x.age) { const d = ageDays(x.age); if (d != null && d > DAYS[f.date]) return false; }
    return true;
  }
  function sorted(items) {
    const s = st.sort; if (s === "default") return items;
    const by = (x) => (x.by || x.channel || x.artist || x.sub || "").toLowerCase();
    const len = (x) => x.ms ? x.ms / 1000 : x.secs ?? 0;
    const when = (x) => Date.parse(x.added ?? x.playedAt ?? "") || -(ageDays(x.age) ?? 1e9);
    const cmp = s === "title" ? (a, b) => a.title.localeCompare(b.title) : s === "by" ? (a, b) => by(a).localeCompare(by(b)) || a.title.localeCompare(b.title) : s === "length" ? (a, b) => len(a) - len(b) : (a, b) => when(b) - when(a);
    return [...items].sort(cmp);
  }

  // ---------------------------------------------------------------------------------------------------- painting
  const secTitle = () => st.page ? st.page.title : st.section === "__search" ? `Results for “${st.q}”` : (SECTIONS()[st.source] ?? []).find((s) => s.id === st.section)?.title ?? "";
  function paintHead() {
    const d = st.data ?? {};
    const tabs = [];
    if (!st.page && st.section === "top") tabs.push(["topType", [["tracks", "Songs"], ["artists", "Artists"]], st.topType], ["range", [["short", "4 weeks"], ["medium", "6 months"], ["long", "All time"]], st.range]);
    if (!st.page && st.section === "playlists" && st.source === "spotify") tabs.push(["plFilter", [["all", "All"], ["mine", "Yours"], ["followed", "Followed"], ["collab", "Collaborative"]], st.plFilter]);
    if (!st.page && st.section === "subscriptions") tabs.push(["subsWhat", [["videos", "Latest videos"], ["channels", "Channels"]], st.subsWhat]);
    const count = st.page ? (d.total ?? st.items.length) : st.section === "__search" ? null : d.total ?? null;
    headEl.innerHTML = `${st.page ? `<button type="button" class="mb-btn" data-back title="Back (Backspace)">‹ Back</button>` : ""}<h2>${esc(secTitle())}</h2>${count ? `<span class="mb-count">${count.toLocaleString("en-US")}</span>` : ""}
      ${tabs.map(([k, opts, cur]) => `<div class="mb-subtabs" role="group">${opts.map(([v, l]) => `<button type="button" class="mb-btn" data-tab="${k}:${v}" aria-pressed="${cur === v}">${esc(l)}</button>`).join("")}</div>`).join("")}
      ${!st.page && st.section === "history" ? `<input type="search" class="mb-btn mb-hq" placeholder="Search your history" value="${esc(st.histQ ?? "")}" aria-label="Search your watch history" style="cursor:text;min-width:10em">` : ""}
      ${st.day && st.section === "recent" && !st.page ? `<button type="button" class="mb-btn" data-tab="day:" title="Every day">${esc(st.day)} ✕</button>` : ""}
      ${st.items.length && !st.page && ["liked", "queue", "history", "recent", "watchlater"].includes(st.section) ? `<button type="button" class="mb-btn" data-playall>▶ Play all</button>` : ""}`;
    headEl.onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if ("back" in b.dataset) return back();
      if ("playall" in b.dataset) return doAct("play", st.items.filter(passes).slice(0, 100));
      const [k, v] = (b.dataset.tab ?? "").split(":");
      if (k === "day") { st.day = null; return loadSection(); }
      if (k) { st[k] = v; loadSection(); }
    };
    const hq = $(".mb-hq", headEl);
    if (hq) { let t = null; hq.oninput = () => { clearTimeout(t); t = setTimeout(() => { st.histQ = hq.value.trim(); loadSection(); }, 400); }; }
  }
  function cardFor(d) {
    if (d.needsScopes) return `<div class="mb-card"><b>Grant access to your library and history</b><p>Dayspring's Spotify sign-in is from before it could read ${esc(secTitle().toLowerCase() || "this")}. One new sign-in fixes it (Spotify asks you to approve the new permissions).</p><div class="mb-btns"><button type="button" class="mb-btn go" data-do="grant">Grant access to your library and history</button></div></div>`;
    if (d.connect) {
      const web = st.status?.sources?.spotify?.web;
      return `<div class="mb-card"><b>Connect Spotify to see your library here</b><p>Your playlists, Liked Songs, history and top songs come from Spotify's own connection (Settings → Apps &amp; connections → Spotify). ${web?.signedIn ? "The Spotify web player in the media window is signed in, so playing still works." : ""}</p>
        <div class="mb-btns"><button type="button" class="mb-btn go" data-do="settings">Open Apps &amp; connections</button>${web?.signedIn ? `<button type="button" class="mb-btn" data-do="webplayer" data-url="https://open.spotify.com/collection/tracks">Open Liked Songs in the web player</button>` : `<button type="button" class="mb-btn" data-do="signin" data-svc="spotify">Sign in to the Spotify web player</button>`}</div></div>`;
    }
    if (d.signIn) return `<div class="mb-card warn"><b>Sign in to ${d.signIn === "spotify" ? "Spotify" : "YouTube"} first</b><p>${esc(d.error)} Dayspring opens its media window on the sign-in page; you sign in yourself (2-step codes too) and it never sees your password.</p>
      <div class="mb-btns"><button type="button" class="mb-btn go" data-do="signin" data-svc="${esc(d.signIn)}">${st.signWaiting === d.signIn ? "Waiting for you to finish…" : `Sign in to ${d.signIn === "spotify" ? "Spotify" : "YouTube"}`}</button></div></div>`;
    if (d.fallback === "webplayer") return `<div class="mb-card warn"><b>Only in the Spotify web player</b><p>${esc(d.note)}</p><div class="mb-btns"><button type="button" class="mb-btn go" data-do="webplayer" data-url="${esc(safeUrl(d.url))}">Open it in the web player</button></div></div>`;
    if (d.unavailable || d.error) return `<div class="mb-card warn"><b>Couldn't load this</b><p>${esc(d.error)}</p><div class="mb-btns"><button type="button" class="mb-btn" data-do="retry">Try again</button></div></div>`;
    if (d.note && !st.items.length) return `<div class="mb-card"><p>${esc(d.note)}</p></div>`;
    return "";
  }
  function policyBanner() {
    const p = st.status?.policy;
    return p && p.videosAllowed === false && (st.source === "youtube") ? `<div class="mb-card warn"><b>Study time</b><p>${esc(p.reason ?? "")} Videos wait until it's over; music is fine.</p></div>` : "";
  }
  function dayLabel(iso) {
    const d = new Date(iso); if (isNaN(d)) return "";
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const x = new Date(d); x.setHours(0, 0, 0, 0);
    const diff = Math.round((t - x) / 86400000);
    return diff === 0 ? "Today" : diff === 1 ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  }
  function paintList({ keepScroll = false } = {}) {
    const top = list.scrollTop;
    const d = st.data ?? {};
    let n = 0;
    const numbered = [];
    const row = (x) => { n++; numbered.push({ ...x, n }); return itemHtml(x, n); };
    const wrap = (html) => (st.view === "grid" ? `<div class="mb-grid">${html}</div>` : `<div class="mb-rows">${html}</div>`);
    let html = policyBanner();
    if (st.loading && !st.items.length) html += skeleton();
    else if (st.groups) {
      // search results, grouped (a type picked: only that group)
      const gs = st.groups.filter((g) => g.items.length);
      if (!gs.length) html += cardFor(d) || `<div class="mb-empty">Nothing found for “${esc(st.q)}”.${st.source === "youtube" && Object.keys(st.filters).length ? " Try fewer filters." : ""}</div>`;
      for (const g of gs) {
        const items = sorted(g.items.filter(passes));
        html += `<section class="mb-group" aria-label="${esc(g.title)}"><h3>${esc(g.title)} <span>${items.length}</span>${g.next != null ? `<button type="button" class="mb-btn" data-gmore="${esc(g.id)}"${g.loading ? " disabled" : ""}>${g.loading ? "Loading…" : "Load more"}</button>` : ""}</h3>${wrap(items.map(row).join(""))}</section>`;
      }
    } else if (st.page) {
      html += pageHead(st.page);
      if (d.groups) for (const g of d.groups.filter((x) => x.items?.length)) html += `<section class="mb-group"><h3>${esc(g.title)}</h3>${wrap(sorted(g.items).map(row).join(""))}</section>`;
      else html += st.items.length ? wrap(sorted(st.items.filter(passes)).map(row).join("")) : cardFor(d) || `<div class="mb-empty">Nothing here.</div>`;
    } else {
      const card = cardFor(d);
      if (card && !st.items.length) html += card;
      else if (st.section === "now" && d.now) html += nowCard(d.now);
      else if (!st.items.length) html += `<div class="mb-empty">${esc(emptyText())}</div>`;
      else {
        const items = sorted(st.items.filter(passes));
        // grouped by day: YouTube history (YouTube's own days), Spotify's recently played (from when)
        if ((st.section === "history" || st.section === "recent") && st.sort === "default") {
          let day = null, chunk = [];
          const flush = () => { if (chunk.length) html += `${day ? `<div class="mb-day">${esc(day)}</div>` : ""}${wrap(chunk.map(row).join(""))}`; chunk = []; };
          for (const x of items) { const dl = x.day ?? (x.playedAt ? dayLabel(x.playedAt) : ""); if (dl !== day) { flush(); day = dl; } chunk.push(x); }
          flush();
        } else html += wrap(items.map(row).join(""));
        if (st.section === "queue" && d.current) html = `<div class="mb-day">Now playing</div>${wrap(itemHtml(d.current, "▶"))}<div class="mb-day">Up next</div>` + html;
      }
    }
    html += `<div class="mb-more">${st.next != null ? `<button type="button" class="mb-btn" data-more${st.loading ? " disabled" : ""}>${st.loading ? "Loading…" : "Load more"}</button>` : ""}</div>`;
    list.innerHTML = html;
    if (keepScroll) list.scrollTop = top;
    st.numbered = numbered;
    paintSel(); report();
    $(".mb-viewbtn", root).textContent = st.view === "grid" ? "☰ List" : "▦ Grid";
  }
  function paintMoreBtn() { const b = $("[data-more]", list); if (b) { b.disabled = st.loading; b.textContent = st.loading ? "Loading…" : "Load more"; } }
  const emptyText = () => ({ liked: "No Liked Songs yet.", albums: "No saved albums yet.", artists: "You don't follow any artists yet.", recent: st.day ? `Nothing played on ${st.day}.` : "Nothing played lately.", queue: "Nothing lined up.", history: "Your watch history is empty (or paused on YouTube).", watchlater: "Watch later is empty.", subscriptions: "No subscriptions yet.", playlists: "No playlists yet.", songs: "No songs found in your folders.", videos: "No videos found in your folders." }[st.section] ?? "Nothing here yet.");
  function artHtml(x) {
    const u = safeUrl(x.art);
    const cls = `mb-art${x.kind === "video" || (x.source === "youtube" && x.kind !== "channel") ? " wide" : ""}${x.kind === "artist" || x.kind === "channel" || x.kind === "localartist" ? " round" : ""}`;
    return u ? `<img class="${cls}" src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-icon="${ICON[x.kind] ?? "♪"}">` : `<span class="${cls}" aria-hidden="true">${ICON[x.kind] ?? "♪"}</span>`;
  }
  const canQueue = (x) => ["track", "episode", "video", "file"].includes(x.kind) || x.kind === "localalbum" || x.kind === "localartist";
  const canOpen = (x) => ["artist", "album", "playlist", "genre", "channel", "ytplaylist", "localalbum", "localartist"].includes(x.kind);
  const canLike = (x) => x.source === "spotify" && ["track", "episode", "album", "artist", "playlist"].includes(x.kind);
  const canAdd = (x) => (x.source === "spotify" && (x.kind === "track" || x.kind === "episode")) || (x.source === "youtube" && x.kind === "video");
  function itemHtml(x, n) {
    const liked = x.liked ?? st.likedNow[x.uri] ?? (x.saved || x.followed ? true : undefined);
    const sel = st.sel.has(x.key);
    const acts = [`<button type="button" class="mb-ib play" data-a="play" title="Play" aria-label="Play ${esc(x.title)}">▶</button>`];
    if (canQueue(x)) acts.push(`<button type="button" class="mb-ib opt" data-a="next" title="Play next (N)" aria-label="Play next">⤴</button><button type="button" class="mb-ib" data-a="queue" title="Add to queue (Q)" aria-label="Add to queue">＋</button>`);
    if (canOpen(x)) acts.push(`<button type="button" class="mb-ib" data-a="open" title="Open (O)" aria-label="Open ${esc(x.title)}">↗</button>`);
    if (canLike(x)) acts.push(`<button type="button" class="mb-ib${liked ? " on" : ""}" data-a="${liked ? "unlike" : "like"}" title="${liked ? "Saved: click to remove" : x.kind === "artist" ? "Follow" : "Save (L)"}" aria-label="${liked ? "Remove from your library" : "Save"}" aria-pressed="${Boolean(liked)}">${liked ? "♥" : "♡"}</button>`);
    if (canAdd(x)) acts.push(`<button type="button" class="mb-ib opt" data-a="addpl" title="Add to a playlist" aria-label="Add to a playlist">☰＋</button>`);
    if (x.removeToken) acts.push(`<button type="button" class="mb-ib opt" data-a="removeHistory" title="Remove from watch history" aria-label="Remove from watch history">🗑</button>`);
    return `<div class="mb-item${sel ? " sel" : ""}${x.current ? " cur" : ""}" role="listitem" tabindex="0" data-k="${esc(x.key)}" data-n="${n}" aria-label="${typeof n === "number" ? n + ". " : ""}${esc(x.title)}${x.sub ? ", " + esc(x.sub) : ""}">
      <span class="mb-chk"><input type="checkbox" tabindex="-1" aria-label="Pick ${esc(x.title)}"${sel ? " checked" : ""}></span>
      <span class="mb-num">${n}</span>${artHtml(x)}
      <div class="mb-txt"><b>${esc(x.title)}</b><small>${esc(x.sub ?? "")}${x.playedAt ? ` · ${esc(new Date(x.playedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}` : ""}</small></div>
      <span class="mb-len">${esc(lenOf(x))}</span><div class="mb-acts">${acts.join("")}</div></div>`;
  }
  function pageHead(pg) {
    const h = st.data?.head ?? pg.head ?? {};
    const x = { ...pg.item, ...h };
    const liked = canLike(x) ? (x.saved || x.followed || st.likedNow[x.uri]) : false;
    return `<div class="mb-pagehead">${artHtml(x)}<div><h2>${esc(x.title ?? pg.title)}</h2><p>${esc(x.sub ?? "")}</p><div class="mb-btns" style="display:flex;gap:.4em;flex-wrap:wrap">
      ${x.kind !== "localartist" || st.items.length ? `<button type="button" class="mb-btn go" data-pg="play">▶ Play</button>` : ""}
      ${canLike(x) ? `<button type="button" class="mb-btn" data-pg="${liked ? "unlike" : "like"}">${liked ? "♥ Saved" : x.kind === "artist" ? "♡ Follow" : "♡ Save"}</button>` : ""}
      ${x.source === "spotify" && st.data?.url ? `<button type="button" class="mb-btn" data-pg="web" data-url="${esc(safeUrl(st.data.url))}">Open in the web player</button>` : ""}</div></div></div>`;
  }
  function nowCard(n) {
    if (!n.item) return `<div class="mb-empty">Nothing is playing on Spotify right now.</div>`;
    const x = n.item;
    return `<div class="mb-pagehead">${artHtml(x)}<div><h2>${esc(x.title)}</h2><p>${esc(x.by)}${n.device ? ` · on ${esc(n.device)}` : ""}</p><div style="display:flex;gap:.4em;flex-wrap:wrap">
      <button type="button" class="mb-btn" data-np="toggle">${n.playing ? "⏸ Pause" : "▶ Play"}</button><button type="button" class="mb-btn" data-pg="${x.liked ? "unlike" : "like"}" data-cur>${x.liked ? "♥ Liked" : "♡ Like"}</button>
      <button type="button" class="mb-btn" data-lyrics="${esc(safeUrl(n.lyrics))}">Lyrics ↗</button></div></div></div>` + `<div class="mb-rows">${itemHtml({ ...x, key: x.key + "#now" }, 1)}</div>`;
  }

  // ---------------------------------------------------------------------------------------------------- voice numbers → the server
  let reportT = null;
  function report() {
    clearTimeout(reportT);
    reportT = setTimeout(() => {
      const open = isOpen();
      api("/mb/view", { open, source: st.source, section: st.page ? "page" : st.section, title: secTitle(), more: st.next != null || Boolean(st.groups?.some((g) => g.next != null)),
        items: open ? st.numbered.slice(0, 300).map((x) => ({ n: x.n, source: x.source, kind: x.kind, title: x.title, sub: x.sub, by: x.by, uri: x.uri, id: x.id, context: x.context, videoId: x.videoId, playlistId: x.playlistId, channelId: x.channelId, handle: x.handle, fileId: x.fileId, ref: x.ref, media: x.media, genre: x.genre, request: x.request, album: x.album, artist: x.artist, secs: x.secs, length: x.length, removeToken: x.removeToken })) : [] }).catch(() => {});
    }, 120);
  }

  // ---------------------------------------------------------------------------------------------------- clicks and keys
  const itemOf = (el) => { const k = el?.closest(".mb-item")?.dataset.k; if (!k) return null; if (k.endsWith("#now")) return st.data?.now?.item ?? null; return st.numbered.find((x) => x.key === k) ?? (st.data?.current?.key === k ? st.data.current : null); };
  async function onListClick(e) {
    const b = e.target.closest("button, input[type=checkbox]");
    if (b?.dataset.more !== undefined) return loadMore();
    if (b?.dataset.gmore) return groupMore(b.dataset.gmore);
    if (b?.dataset.do) return cardAction(b);
    if (b?.dataset.pg) return pageAction(b);
    if (b?.dataset.np) return window.dayspring?.playerCtl?.(b.dataset.np);
    if (b?.dataset.lyrics) return openLink(b.dataset.lyrics);
    const x = itemOf(e.target); if (!x) return;
    if (b?.type === "checkbox" || e.shiftKey || e.ctrlKey || (root.classList.contains("selecting") && !b)) { toggleSel(x); return; }
    const a = b?.dataset.a;
    if (!a) return canOpen(x) ? openItem(x) : doAct("play", [x]);
    if (a === "open") return openItem(x);
    if (a === "addpl") return playlistMenu(b, [x]);
    return doAct(a, [x], b);
  }
  function onListKey(e) {
    const cur = e.target.closest(".mb-item");
    const items = $$(".mb-item", list);
    const i = items.indexOf(cur);
    const grid = st.view === "grid";
    const cols = grid && items.length ? Math.max(1, Math.round(list.querySelector(".mb-grid")?.offsetWidth / (items[0].offsetWidth + 10)) || 1) : 1;
    const go = (j) => { const t = items[Math.max(0, Math.min(items.length - 1, j))]; if (t) { t.focus(); t.scrollIntoView({ block: "nearest" }); } e.preventDefault(); };
    if (e.key === "Backspace" && !e.target.matches("input") && st.page) { e.preventDefault(); return back(); }
    if (!cur || e.target !== cur) return;
    const x = itemOf(cur);
    if (e.key === "ArrowDown") return go(i + cols);
    if (e.key === "ArrowUp") { if (i - cols < 0) { e.preventDefault(); input.focus(); return; } return go(i - cols); }
    if (e.key === "ArrowRight") { if (grid) return go(i + 1); if (x && canOpen(x)) { e.preventDefault(); return openItem(x); } return; }
    if (e.key === "ArrowLeft") { if (grid) return go(i - 1); if (st.page) { e.preventDefault(); return back(); } return; }
    if (e.key === "Home") return go(0);
    if (e.key === "End") return go(items.length - 1);
    if (!x) return;
    if (e.key === "Enter") { e.preventDefault(); return canOpen(x) && !e.ctrlKey ? openItem(x) : doAct("play", [x]); }
    if (e.key === " ") { e.preventDefault(); return toggleSel(x); }
    const k = e.key.toLowerCase();
    if (k === "n" && canQueue(x)) { e.preventDefault(); return doAct("next", [x]); }
    if (k === "q" && canQueue(x)) { e.preventDefault(); return doAct("queue", [x]); }
    if (k === "l" && canLike(x)) { e.preventDefault(); return doAct(x.liked || st.likedNow[x.uri] ? "unlike" : "like", [x]); }
    if (k === "o" && canOpen(x)) { e.preventDefault(); return openItem(x); }
    if (k === "p") { e.preventDefault(); return doAct("play", [x]); }
  }
  function focusFirst() { const f = $(".mb-item", list) ?? $(".mb-card button", list); if (f) f.focus(); else list.focus(); }

  // ---------------------------------------------------------------------------------------------------- multi-select
  function toggleSel(x) { if (st.sel.has(x.key)) st.sel.delete(x.key); else st.sel.add(x.key); const el = list.querySelector(`.mb-item[data-k="${CSS.escape(x.key)}"]`); if (el) { el.classList.toggle("sel", st.sel.has(x.key)); const c = el.querySelector("input[type=checkbox]"); if (c) c.checked = st.sel.has(x.key); } if (st.sel.size && !root.classList.contains("selecting")) root.classList.add("selecting"); paintSel(); }
  const selected = () => st.numbered.filter((x) => st.sel.has(x.key));
  function paintSel() {
    const xs = selected();
    selbar.hidden = !xs.length;
    if (!xs.length) return;
    const q = xs.some(canQueue), add = xs.some(canAdd), like = xs.some(canLike);
    selbar.innerHTML = `<b>${xs.length} picked</b><button type="button" class="mb-btn go" data-s="play">▶ Play</button>${q ? `<button type="button" class="mb-btn" data-s="next">⤴ Play next</button><button type="button" class="mb-btn" data-s="queue">＋ Add to queue</button>` : ""}
      ${add ? `<button type="button" class="mb-btn" data-s="addpl">☰＋ Add to playlist</button>` : ""}${like ? `<button type="button" class="mb-btn" data-s="like">♡ Save</button>` : ""}<span class="mb-sp" style="flex:1"></span><button type="button" class="mb-btn" data-s="all">Pick all</button><button type="button" class="mb-btn" data-s="none">Clear</button>`;
  }
  function onSelbar(e) {
    const b = e.target.closest("[data-s]"); if (!b) return;
    const s = b.dataset.s, xs = selected();
    if (s === "none") { st.sel.clear(); root.classList.remove("selecting"); $(".mb-selbtn", root).setAttribute("aria-pressed", "false"); return paintList({ keepScroll: true }); }
    if (s === "all") { for (const x of st.numbered) st.sel.add(x.key); return paintList({ keepScroll: true }); }
    if (s === "addpl") return playlistMenu(b, xs.filter(canAdd));
    const use = s === "play" ? xs : s === "like" ? xs.filter(canLike) : xs.filter(canQueue);
    if (!use.length) return;
    const src = use[0].source;
    doAct(s, use.filter((x) => x.source === src)).then(() => { if (s !== "like") endSelecting(); });
  }
  // picking is over: after an action, or on another list
  function endSelecting() { st.sel.clear(); root.classList.remove("selecting"); $(".mb-selbtn", root)?.setAttribute("aria-pressed", "false"); if (st.open) paintList({ keepScroll: true }); }

  // ---------------------------------------------------------------------------------------------------- actions
  const strip = (x) => ({ source: x.source, kind: x.kind, title: x.title, sub: x.sub, by: x.by, uri: x.uri, id: x.id, context: x.context, videoId: x.videoId, playlistId: x.playlistId, channelId: x.channelId, handle: x.handle, fileId: x.fileId, ref: x.ref, media: x.media, genre: x.genre, request: x.request, album: x.album, artist: x.artist, secs: x.secs, length: x.length, channel: x.channel, removeToken: x.removeToken, fromPlaylist: x.fromPlaylist });
  async function doAct(action, xs, btn = null, extra = {}) {
    if (!xs.length) return null;
    if (btn) btn.disabled = true;
    const r = await api("/mb/act", { action, items: xs.map(strip), ...extra });
    if (btn) btn.disabled = false;
    if (r.needsScopes) { toast("Spotify needs your OK", "Use “Grant access to your library and history”."); st.data = { ...(st.data ?? {}), needsScopes: r.needsScopes }; paintList({ keepScroll: true }); return r; }
    if (r.error) { toast(action === "play" ? "Couldn't play that" : "Couldn't do that", r.error); return r; }
    if (action === "like" || action === "unlike") { for (const x of xs) { if (x.uri) st.likedNow[x.uri] = action === "like"; x.liked = action === "like"; } paintList({ keepScroll: true }); }
    else if (action === "removeHistory") { const gone = new Set(xs.map((x) => x.key)); st.items = st.items.filter((x) => !gone.has(x.key)); paintList({ keepScroll: true }); }
    toast({ play: "Playing", next: "Up next", queue: "Queued", like: "Saved", unlike: "Removed", addToPlaylist: "Added", removeHistory: "Removed from history" }[action] ?? "Done", r.reply ?? "");
    if (action === "queue" || action === "next") { if (st.section === "queue" && !st.page) setTimeout(loadSection, 600); }
    return r;
  }
  async function cardAction(b) {
    const d = b.dataset.do;
    if (d === "retry") return st.page ? openItem(st.page.item, { replace: true }) : st.q ? runSearch({}) : loadSection();
    if (d === "grant") { const r = await api("/player/spotify/login", {}); toast("Spotify", r.error ?? "Spotify's sign-in opened in your browser. Approve the new permissions there, and this updates by itself."); return; }
    if (d === "settings") { close(); window.dsOpenPage?.("/setup?embed=1&s=apps"); return; }
    if (d === "webplayer") return doWeb(b.dataset.url);
    if (d === "signin") { st.signWaiting = b.dataset.svc; b.textContent = "Waiting for you to finish…"; b.disabled = true; const r = await api("/media/signin", { service: b.dataset.svc }); toast(b.dataset.svc === "youtube" ? "YouTube" : "Spotify", r.error ?? r.text ?? ""); }
  }
  async function doWeb(url) { if (!url) return; const r = await api("/mb/act", { action: "webplayer", url }); toast("Spotify web player", r.error ?? r.reply ?? ""); }
  function openLink(url) { if (url) api("/open", { url }).catch(() => {}); }
  async function pageAction(b) {
    const p = b.dataset.pg;
    if (p === "web") return doWeb(b.dataset.url);
    const x = "cur" in b.dataset ? st.data?.now?.item : { ...st.page?.item, ...(st.data?.head ?? {}) };
    if (!x) return;
    if (p === "play") {
      if (x.kind === "localalbum" || x.kind === "localartist" || x.kind === "channel" || (x.source === "youtube" && st.items.length && x.kind !== "ytplaylist")) return doAct("play", st.items.slice(0, 100));
      return doAct("play", [x]);
    }
    if (p === "like" || p === "unlike") { await doAct(p, [x]); if (st.data?.head) st.data.head.saved = p === "like"; if ("cur" in b.dataset && st.data.now?.item) st.data.now.item.liked = p === "like"; paintList({ keepScroll: true }); }
  }
  // the playlists to add to: his Spotify playlists (his own and collaborative), or Dayspring's video playlists
  let plCache = { spotify: null, youtube: null };
  async function playlistMenu(btn, xs) {
    closeMenu();
    if (!xs.length) return;
    const src = xs[0].source;
    if (!plCache[src]) { const r = await api("/mb/act", { action: src === "spotify" ? "playlists" : "videolists" }); if (r.needsScopes || r.error) { toast("Playlists", r.error ?? "Spotify needs your OK first."); return; } plCache[src] = r.playlists ?? []; }
    menuEl = document.createElement("div"); menuEl.className = "mb-menu"; menuEl.setAttribute("role", "menu");
    menuEl.innerHTML = `<div class="mb-mhead">Add ${xs.length === 1 ? "to" : `${xs.length} to`}…</div>${plCache[src].map((p) => `<button type="button" role="menuitem" data-pl="${esc(p.id)}" data-t="${esc(p.title)}">☰ ${esc(p.title)}${p.total != null ? ` <small style="opacity:.6">${p.total}</small>` : ""}</button>`).join("") || `<div class="mb-mhead" style="text-transform:none;letter-spacing:0">No playlists you can add to.</div>`}
      ${src === "youtube" ? `<hr><button type="button" role="menuitem" data-new>＋ New video playlist…</button>` : ""}`;
    document.body.appendChild(menuEl);
    const r = btn.getBoundingClientRect(), S = safe(), mw = Math.max(224, menuEl.offsetWidth);
    menuEl.style.left = Math.max(S.left + 8, Math.min(S.right - mw - 8, r.right - mw)) + "px";
    menuEl.style.top = Math.max(S.top + 8, Math.min(S.bottom - menuEl.offsetHeight - 8, r.bottom + 4)) + "px";
    window.dsKeepInSafe?.(menuEl);
    menuEl.querySelector("button")?.focus();
    menuEl.addEventListener("keydown", (e) => { const bs = $$("button", menuEl), i = bs.indexOf(document.activeElement); if (e.key === "ArrowDown") { bs[(i + 1) % bs.length]?.focus(); e.preventDefault(); } if (e.key === "ArrowUp") { bs[(i - 1 + bs.length) % bs.length]?.focus(); e.preventDefault(); } if (e.key === "Escape") { closeMenu(); btn.focus(); e.stopPropagation(); } });
    menuEl.onclick = async (e) => {
      const b = e.target.closest("button"); if (!b) return;
      let id = b.dataset.pl, title = b.dataset.t;
      if ("new" in b.dataset) { title = (await nameBox("Name for the new video playlist")).trim(); if (!title) return closeMenu(); id = ""; plCache.youtube = null; }
      closeMenu();
      await doAct("addToPlaylist", xs, null, { playlistId: id, playlistTitle: title });
    };
  }
  function closeMenu() { menuEl?.remove(); menuEl = null; }
  document.addEventListener("pointerdown", (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
  function nameBox(label) {
    return new Promise((ok) => {
      const f = document.createElement("form"); f.className = "mb-menu"; f.style.cssText = "left:50%;top:35%;transform:translateX(-50%);padding:.8em;min-width:18em";
      f.innerHTML = `<label style="display:block;font-size:.85em;opacity:.75;margin-bottom:.4em">${esc(label)}</label><input maxlength="60" style="width:100%;font:inherit;color:inherit;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:.6em;padding:.45em .7em"><div style="display:flex;gap:.4em;justify-content:flex-end;margin-top:.6em"><button type="button" data-c style="width:auto">Cancel</button><button style="width:auto">Save</button></div>`;
      document.body.appendChild(f); const i = $("input", f); i.focus();
      f.onsubmit = (e) => { e.preventDefault(); f.remove(); ok(i.value); }; $("[data-c]", f).onclick = () => { f.remove(); ok(""); };
    });
  }

  // ---------------------------------------------------------------------------------------------------- pages inside the browser
  async function openItem(x, { replace = false } = {}) {
    if (!x || !canOpen(x)) return;
    const q = { source: x.source, kind: x.kind };
    if (x.id) q.id = x.id; if (x.channelId) q.channelId = x.channelId; if (x.handle) q.handle = x.handle; if (x.playlistId) q.playlistId = x.playlistId; if (x.title) q.title = x.title;
    if (x.special || (st.source === "youtube" && st.section === "playlists")) q.mine = "1";
    if (x.album) q.album = x.album; if (x.artist) q.artist = x.artist; if (x.genre) { q.genre = x.genre; q.request = x.request ?? ""; }
    if (st.page && !replace) st.pages.push({ page: st.page, data: st.data, items: st.items, next: st.next, scroll: list.scrollTop });
    else if (!st.page) st.pages.push({ page: null, data: st.data, items: st.items, next: st.next, groups: st.groups, scroll: list.scrollTop });
    st.page = { q, item: x, title: x.title };
    const my = ++st.seq;
    st.loading = true; st.groups = null; st.items = []; st.next = null; st.data = null; st.sel.clear();
    paintHead(); list.innerHTML = skeleton(); list.scrollTop = 0;
    const r = await api("/mb/page?" + new URLSearchParams(q));
    if (my !== st.seq) return;
    st.loading = false; st.data = r; st.items = r.items ?? (r.groups ?? []).flatMap((g) => g.items ?? []); st.next = r.next ?? null;
    if (r.groups && !r.items) st.items = r.groups.flatMap((g) => g.items);
    paintHead(); paintList();
    setTimeout(focusFirst, 30);
  }
  function back() {
    const prev = st.pages.pop();
    st.seq++;
    if (!prev) { st.page = null; return st.q ? runSearch({}) : loadSection(); }
    st.page = prev.page; st.data = prev.data; st.items = prev.items; st.next = prev.next; st.groups = prev.groups ?? null; st.loading = false;
    paintHead(); paintList(); list.scrollTop = prev.scroll ?? 0;
    setTimeout(focusFirst, 30);
  }

  // ---------------------------------------------------------------------------------------------------- the mini now-playing bar
  let npTimer = null, npKey = "";
  function startNp() { stopNp(); paintNp(); npTimer = setInterval(paintNp, 1000); }
  function stopNp() { clearInterval(npTimer); npTimer = null; }
  function paintNp() {
    const P = window.dayspring?.player;
    if (!P?.source) { np.hidden = true; npKey = ""; return; }
    np.hidden = false;
    const pos = Math.min(P.dur || Infinity, (P.pos || 0) + (P.playing ? ((Date.now() - (P.at || Date.now())) / 1000) * (P.rate || 1) : 0));
    const key = `${P.source}|${P.title}|${P.artist}|${P.playing}|${P.uri ?? ""}|${st.likedNow[P.uri] ?? ""}`;
    if (key !== npKey) {
      npKey = key;
      const liked = P.uri ? st.likedNow[P.uri] : undefined;
      const art = safeUrl(P.art) || (P.videoId ? `https://i.ytimg.com/vi/${P.videoId}/mqdefault.jpg` : "");
      np.innerHTML = `${art ? `<img class="mb-art" src="${esc(art)}" alt="">` : `<span class="mb-art" aria-hidden="true">♪</span>`}
        <div class="mb-txt"><b>${esc(P.title || "Playing")}</b><small>${esc(P.artist || (P.source === "youtube" ? "YouTube" : P.source === "file" ? "Your files" : "Spotify"))}${P.source === "spotify" && P.title ? ` · <a href="#" data-lyrics>Lyrics</a>` : ""}</small></div>
        <div class="mb-ctl"><button type="button" class="mb-ib" data-c="previous" title="Previous" aria-label="Previous">⏮</button><button type="button" class="mb-ib main" data-c="toggle" title="Play or pause" aria-label="${P.playing ? "Pause" : "Play"}">${P.playing ? "⏸" : "▶"}</button><button type="button" class="mb-ib" data-c="next" title="Next" aria-label="Next">⏭</button>
          ${P.source === "spotify" && P.uri ? `<button type="button" class="mb-ib${liked ? " on" : ""}" data-c="like" title="${liked ? "Liked" : "Like this song"}" aria-label="Like this song" aria-pressed="${Boolean(liked)}">${liked ? "♥" : "♡"}</button>` : ""}</div>
        <div class="mb-seek"><span class="mb-pos">0:00</span><input type="range" min="0" max="1000" value="0" aria-label="Position"><span class="mb-dur">${esc(mmss(P.dur))}</span></div>`;
      const r = $("input[type=range]", np);
      r.onchange = () => { const P2 = window.dayspring?.player; if (P2?.dur) window.dayspring.playerCtl("seek", (Number(r.value) / 1000) * P2.dur); };
    }
    const r = $("input[type=range]", np);
    if (r && document.activeElement !== r) r.value = P.dur ? String(Math.round((pos / P.dur) * 1000)) : "0";
    const pe = $(".mb-pos", np); if (pe) pe.textContent = mmss(pos);
  }
  async function onNp(e) {
    if (e.target.closest("[data-lyrics]")) { e.preventDefault(); const P = window.dayspring?.player; openLink(`https://www.google.com/search?q=${encodeURIComponent(`${P.title} ${P.artist} lyrics`)}`); return; }
    const b = e.target.closest("[data-c]"); if (!b) return;
    const c = b.dataset.c, P = window.dayspring?.player;
    if (c === "like") { const on = !st.likedNow[P.uri]; const r = await api("/mb/act", { action: on ? "like" : "unlike", items: [{ source: "spotify", kind: "track", uri: P.uri, title: P.title }] }); if (r.error) toast("Spotify", r.error); else { st.likedNow[P.uri] = on; paintNp(); } return; }
    try { const msg = await window.dayspring?.playerCtl?.(c); if (msg) toast("Player", msg); } catch { /* fine */ }
    setTimeout(paintNp, 400);
  }

  // ---------------------------------------------------------------------------------------------------- what the server says
  function onServer(v) {
    if (!v || typeof v !== "object") return;
    if (v.do === "open") { if (isDisplay()) open({ source: v.source, section: v.section, q: v.q, range: v.range, type: v.type, day: v.day }); return; }
    if (v.do === "close") { close(); return; }
    if (!st.open) return;
    if (st.minimized) minimize(false);
    if (v.do === "more") { if (st.groups) { const g = st.groups.find((x) => x.next != null); if (g) groupMore(g.id); } else loadMore(); }
    else if (v.do === "openItem") { const x = st.numbered.find((y) => y.n === Number(v.n)); if (x) openItem(x); }
    else if (v.do === "acted") { const x = st.numbered.find((y) => y.n === Number(v.n)); if (x && (v.action === "like" || v.action === "unlike")) { if (x.uri) st.likedNow[x.uri] = v.action === "like"; paintList({ keepScroll: true }); } if (x && v.action === "removeHistory") { st.items = st.items.filter((y) => y.key !== x.key); paintList({ keepScroll: true }); } }
  }
  const isDisplay = () => Boolean(document.getElementById("clock") && (window.dsEvents || window.dayspring));
  function onSignin(v) {
    if (!v?.service) return;
    const s = st.status?.sources?.[v.service];
    if (s) s.web = { ...(s.web ?? {}), signedIn: v.signedIn, account: v.account ?? s.web?.account ?? null, expired: Boolean(v.expired) };
    if (v.signedIn && st.signWaiting === v.service) { st.signWaiting = null; toast(v.service === "youtube" ? "YouTube" : "Spotify", v.text ?? "Signed in ✓"); if (st.open && !st.q) loadSection(); }
    if (v.notice) signCard(v.service, v.notice);
    if (v.signedIn) $("#mbSignCard")?.remove();
  }
  // "Your YouTube sign-in has ended" (once, through the floor): a card with Sign in again
  function signCard(service, text) {
    $("#mbSignCard")?.remove();
    const c = document.createElement("div"); c.id = "mbSignCard"; c.setAttribute("role", "alert");
    c.innerHTML = `<b>${service === "youtube" ? "YouTube" : "Spotify"} sign-in ended</b><p>${esc(text)}</p><div class="mb-btns"><button type="button" data-later>Later</button><button type="button" class="go" data-again>Sign in again</button></div>`;
    document.body.appendChild(c);
    c.onclick = async (e) => { if (e.target.closest("[data-later]")) c.remove(); else if (e.target.closest("[data-again]")) { st.signWaiting = service; const r = await api("/media/signin", { service }); toast(service === "youtube" ? "YouTube" : "Spotify", r.error ?? r.text ?? ""); c.remove(); } };
  }
  const listen = (es) => {
    es.addEventListener("mbrowser", (e) => { let v = null; try { v = JSON.parse(e.data); } catch { return; } onServer(v); });
    es.addEventListener("mediasignin", (e) => { let v = null; try { v = JSON.parse(e.data); } catch { return; } onSignin(v); });
    es.addEventListener("spotify-auth", () => { if (st.open) { api("/mb/status").then((s) => { st.status = s; if (!st.q) loadSection(); }).catch(() => {}); } });
    es.addEventListener("vqueue", () => { if (st.open && st.source === "youtube" && st.section === "queue" && !st.page && !st.q) { clearTimeout(listen.t); listen.t = setTimeout(loadSection, 400); } });
  };
  if (window.dsEvents) listen(window.dsEvents); else addEventListener("ds-events", (e) => listen(e.detail), { once: true });
  addEventListener("ds-test-mb", (e) => { const d = e.detail ?? {}; if (d.signin) onSignin(d.signin); else onServer(d); });

  // ---------------------------------------------------------------------------------------------------- the buttons that open it
  // 🎵 Music by the clock (library.js adds it; it moves into ⋯ More when there's no room): now the Music & Video browser
  function claimButton() {
    const b = document.getElementById("musicBtn");
    if (b && !b.dataset.mb) { b.dataset.mb = "1"; b.title = "Music & Video: Spotify, YouTube, your files; search, playlists, history, the queue"; b.onclick = () => (isOpen() ? close() : open({})); return true; }
    if (!b) {
      const util = document.querySelector("#calBtns .util, .calbtns .util");
      if (!util || document.getElementById("mbBtn")) return Boolean(document.getElementById("mbBtn"));
      const n = document.createElement("button"); n.id = "mbBtn"; n.type = "button"; n.title = "Music & Video"; n.innerHTML = '<i aria-hidden="true">🎵</i><span class="lbl">Music</span>';
      n.onclick = () => (isOpen() ? close() : open({})); util.insertBefore(n, util.firstChild); return true;
    }
    return true;
  }
  if (!claimButton()) setTimeout(claimButton, 1500);
  // the Library's doors (the music card's shelf button, the ☰ on a video) lead here too
  function claimLibrary() {
    const L = window.dsLibrary; if (!L || L.__mb) return;
    L.__mb = true;
    const orig = L.open;
    L.open = (tab, o = {}) => { if (tab === "queue" && !o.q) { const P = window.dayspring?.player; return open({ source: P?.source === "spotify" ? "spotify" : "youtube", section: "queue" }); } return open({ source: tab === "videos" ? "youtube" : "spotify", q: o.q, section: o.focus === "recent" ? (tab === "videos" ? "history" : "recent") : undefined }); };
    L.openLibrary = orig;
    // the browser IS the Library now: "is it open" and "close it" mean the browser too (Esc order, voice, the keys in tv.js)
    const origOpen = L.isOpen, origClose = L.close;
    L.isOpen = () => isOpen() || Boolean(origOpen?.());
    L.close = () => { close(); origClose?.(); };
  }
  claimLibrary(); setTimeout(claimLibrary, 1500);

  window.dsMB = {
    open: (o = {}) => open(o), close, isOpen, enabled: () => true,
    _state: () => ({ open: st.open, minimized: st.minimized, source: st.source, section: st.section, q: st.q, page: st.page?.title ?? null, view: st.view, loading: st.loading, next: st.next, sel: st.sel.size,
      groups: (st.groups ?? []).map((g) => ({ id: g.id, title: g.title, n: g.items.length, next: g.next })), items: st.numbered.map((x) => ({ n: x.n, kind: x.kind, title: x.title, key: x.key })), data: st.data ? { error: st.data.error ?? null, needsScopes: st.data.needsScopes ?? null, signIn: st.data.signIn ?? null, fallback: st.data.fallback ?? null, connect: Boolean(st.data.connect) } : null }),
  };
})();
