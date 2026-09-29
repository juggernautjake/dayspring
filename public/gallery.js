// The photo gallery on the Dayspring screen (lib/gallery): every photo Dayspring may show, as a grid you scroll
// through, and one photo at a time with a filmstrip.
//   The grid: only the rows on the screen are drawn (thousands of photos stay light), their small pictures made and cached
//     by the server. Group by folder, month or album; sort by date, name or size; filter by a person (faces, when on),
//     ★ favourites, "has text", videos too; search words; 🎲 Random with "Shuffle again" and "More" (never a repeat).
//   One photo: ◀ Back / Next ▶ on its edges, the wheel, a swipe or a drag, ← →, and "next" / "previous" / "scroll right"
//     go through the WHOLE collection (loading more as it goes), with "124 of 3,208"; at an end it says so, and one more
//     press starts over. The filmstrip along the bottom scrolls sideways (wheel, drag, touch) and loads as it goes; it
//     and the big photo stay in step. Where it's saved is always shown: Pictures › Family › 2026 (each part filters the
//     gallery to that folder) and the full path, which, like 📂 Open in File Explorer, opens Explorer with the photo selected.
//     ℹ info (date, camera, size, dimensions, people, words), ★, ▶ Slideshow.
//   Everywhere else a photo shows (the rotating photo card, the file viewer, the People page, the finder's list, the
//   media list, a saved web picture): window.dsGallery.actionsHtml(id) gives "📂 Open file location" and "🖼 View in
//   gallery" buttons; one click handler here answers them on every page (a page inside the screen hands them up to it).
// Photos by id only: the page never sends a path. Opened by voice through the server ("gallery" events), or
// window.dsGallery.open / openFor (other scripts, tests).
(() => {
  if (window.dsGallery) return;
  const featureOff = window.dsFeatures?.on && window.dsFeatures.on("gallery") === false;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (path, body) => {
    const r = await fetch("/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `Dayspring couldn't do that just now (${r.status}).`), { status: r.status, body: j });
    return j;
  };
  const toast = (t, s = "") => { try { if (window.dayspring?.toast) window.dayspring.toast(t, s, "", "bell"); else if (window.parent !== window && window.parent.dayspring?.toast) window.parent.dayspring.toast(t, s, "", "bell"); } catch { /* fine */ } };
  const fmtN = (n) => Number(n).toLocaleString("en-US");
  const isId = (s) => /^[a-f0-9]{16}$/.test(String(s ?? ""));

  // ------------------------------------------------------------------------------------------------ 📂 / 🖼 on every photo
  // (on a page inside the Dayspring screen, the screen's own gallery answers)
  const host = () => { try { if (window.parent !== window && window.parent.dsGallery?.openFor) return window.parent.dsGallery; } catch { /* another origin */ } return window.dsGallery; };
  function actionsHtml(id, { compact = false, cls = "" } = {}) {
    if (featureOff || !isId(id)) return "";
    return `<span class="dsg-acts${compact ? " compact" : ""}${cls ? " " + esc(cls) : ""}"><button type="button" class="dsg-a" data-gal-act="loc" data-gal-id="${esc(id)}" title="Open file location: File Explorer with this photo selected" aria-label="Open file location">📂${compact ? "" : " Open file location"}</button><button type="button" class="dsg-a" data-gal-act="gal" data-gal-id="${esc(id)}" title="View in gallery" aria-label="View in gallery">🖼${compact ? "" : " View in gallery"}</button></span>`;
  }
  async function reveal(id, btn = null) {
    let r;
    try { r = await api("/gallery/reveal", { id }); }
    catch (e) {
      if (e.status === 404 && e.body?.off) { try { r = await api("/viewer/folder", { id }); } catch (e2) { r = { error: e2.message }; } }
      else r = { error: e.message, denied: e.status === 403 };
    }
    const msg = r.reply ?? r.text ?? r.error ?? "";
    // (inside the gallery its own note says it: a notification would sit over the gallery's buttons)
    if (G.open && G.single) setNote(r.shown ? `📂 ${msg}` : msg);
    else if (r.shown) toast("📂 File Explorer", msg); else toast(r.denied ? "Not allowed" : "Open file location", msg);
    if (btn) { const was = btn.dataset.label ?? btn.innerHTML; btn.dataset.label = was; btn.classList.toggle("done", Boolean(r.shown)); btn.title = msg; setTimeout(() => { btn.classList.remove("done"); }, 2500); }
    return r;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-gal-act]");
    if (!b) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();
    const id = b.dataset.galId, H = host();
    if (b.dataset.galAct === "loc") return (H?.reveal ?? reveal)(id, H === window.dsGallery ? b : null);
    if (b.dataset.galAct === "gal") {
      const set = b.closest("[data-gal-ids]");
      const opts = set ? { ids: set.dataset.galIds.split(",").filter(isId), title: set.dataset.galTitle || "" } : {};
      H?.openFor?.(id, opts);
    }
  }, true);

  // ------------------------------------------------------------------------------------------------ styles
  const css = document.createElement("style");
  css.textContent = `
  .dsg-acts{display:inline-flex;gap:.35em;flex-wrap:wrap;align-items:center}
  .dsg-a{font:inherit;font-size:.85em;color:#eef0ff;background:rgba(10,12,30,.72);border:1px solid rgba(170,180,255,.4);border-radius:.55em;padding:.25em .6em;cursor:pointer;white-space:nowrap;min-height:2em;line-height:1.2}
  .dsg-a:hover,.dsg-a:focus-visible{background:rgba(124,140,255,.45);outline:2px solid rgba(160,175,255,.7);outline-offset:1px}
  .dsg-a.done{border-color:#7fe0a0}
  .dsg-acts.pacts{display:flex;margin-top:.45em}
  .dsg-acts.compact .dsg-a{padding:.15em .4em;min-width:2em}
  #dsGallery{box-sizing:border-box;position:fixed;z-index:48;display:flex;flex-direction:column;border-radius:1em;overflow:hidden;color:var(--ink,#eef0ff);font-size:15px;
    background:rgba(10,12,30,.98);border:1px solid var(--edge2,rgba(170,180,255,.28));box-shadow:0 30px 90px rgba(0,0,0,.65);
    top:calc(var(--safe-top,0px) + 2.9em);left:calc(var(--safe-left,0px) + var(--safe-gap,10px));
    width:calc(var(--safe-w,100vw) - 2 * var(--safe-gap,10px));height:calc(var(--safe-h,100vh) - 2.9em - var(--safe-gap,10px))}
  #dsGallery[hidden]{display:none}
  html.mini #dsGallery{top:2.5em;left:0;width:100vw;height:calc(100vh - 2.5em);border-radius:0}
  #dsGallery button,#dsGallery select,#dsGallery input{font:inherit;color:inherit}
  #dsGallery .gb{background:rgba(255,255,255,.07);border:1px solid var(--edge2,rgba(170,180,255,.28));border-radius:.55em;padding:.25em .6em;cursor:pointer;min-height:2em;white-space:nowrap;line-height:1.2}
  #dsGallery .gb:hover,#dsGallery .gb:focus-visible{background:rgba(124,140,255,.32);outline:2px solid rgba(160,175,255,.7);outline-offset:1px}
  #dsGallery .gb[aria-pressed="true"],#dsGallery .gb[aria-selected="true"]{background:rgba(124,140,255,.45)}
  #dsGallery select,#dsGallery input[type=search]{background:rgba(255,255,255,.08);border:1px solid var(--edge2,rgba(170,180,255,.28));border-radius:.5em;padding:.2em .4em;min-height:2em}
  #dsGallery .g-bar{display:flex;align-items:center;gap:.5em;padding:.45em .6em;border-bottom:1px solid rgba(160,170,255,.14);flex-wrap:wrap}
  #dsGallery .g-title{flex:1 1 8em;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #dsGallery .g-title b{font-weight:500}#dsGallery .g-title small{color:var(--muted,#a4abcc);margin-left:.5em}
  #dsGallery .g-tabs{display:flex;gap:.3em}
  #dsGallery .g-tools{display:flex;gap:.35em;align-items:center;padding:.35em .6em;border-bottom:1px solid rgba(160,170,255,.14);overflow-x:auto;flex:0 0 auto;scrollbar-width:thin}
  #dsGallery .g-tools label{color:var(--muted,#a4abcc);font-size:.85em;white-space:nowrap}
  #dsGallery .g-tools input[type=search]{width:12em;flex:0 1 12em;min-width:6em}
  #dsGallery .g-crumbs{display:flex;gap:.2em;align-items:center;padding:.3em .7em;flex-wrap:wrap;font-size:.9em;border-bottom:1px solid rgba(160,170,255,.14)}
  #dsGallery .g-crumbs[hidden]{display:none}
  #dsGallery .crumb{background:none;border:0;color:#9fb0ff;cursor:pointer;padding:.15em .25em;border-radius:.3em;text-decoration:underline;min-height:1.8em}
  #dsGallery .crumb:hover,#dsGallery .crumb:focus-visible{background:rgba(124,140,255,.25);outline:none}
  #dsGallery .sepc{color:var(--muted,#8990b8)}
  #dsGallery .g-grid{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;position:relative;outline:none}
  #dsGallery .g-space{position:relative;width:100%}
  #dsGallery .g-row{position:absolute;left:0;right:0;display:flex;gap:6px;padding:0 6px;box-sizing:border-box}
  #dsGallery .g-head{position:absolute;left:0;right:0;padding:.5em .8em .2em;font-weight:500;color:#ffe7b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box}
  #dsGallery .g-head small{color:var(--muted,#a4abcc);font-weight:400;margin-left:.5em}
  #dsGallery .g-cell{position:relative;flex:0 0 auto;padding:0;border:2px solid transparent;border-radius:.5em;overflow:hidden;background:rgba(255,255,255,.05);cursor:pointer}
  #dsGallery .g-cell:hover,#dsGallery .g-cell:focus-visible{border-color:#8b9bff;outline:none}
  #dsGallery .g-cell img{width:100%;height:100%;object-fit:cover;display:block}
  #dsGallery .g-cell .ph{position:absolute;inset:0;display:grid;place-items:center;color:var(--muted,#6f76a0);font-size:1.4em}
  #dsGallery .g-cell .st{position:absolute;top:.2em;right:.3em;color:#ffd84a;text-shadow:0 1px 3px #000}
  #dsGallery .g-cell .vd{position:absolute;left:.3em;bottom:.2em;background:rgba(0,0,0,.6);border-radius:.3em;padding:0 .3em;font-size:.8em}
  #dsGallery .g-foot{flex:0 0 auto;display:flex;align-items:center;gap:.5em;padding:.35em .7em;border-top:1px solid rgba(160,170,255,.14);font-size:.88em;color:var(--muted,#a4abcc);min-height:2.2em}
  #dsGallery .g-foot .g-st{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #dsGallery .g-empty{padding:2em;text-align:center;color:var(--muted,#a4abcc)}
  #dsGallery .g-single{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;background:rgba(6,7,18,.99)}
  #dsGallery .g-single[hidden]{display:none}
  #dsGallery .gs-top{display:flex;align-items:center;gap:.4em;padding:.4em .6em;flex-wrap:wrap;border-bottom:1px solid rgba(160,170,255,.14)}
  #dsGallery .gs-name{flex:1 1 8em;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}
  #dsGallery .gs-pos{color:var(--muted,#a4abcc);font-variant-numeric:tabular-nums;white-space:nowrap}
  #dsGallery .gs-main{flex:1 1 auto;min-height:0;display:flex}
  #dsGallery .gs-stage{flex:1 1 auto;min-width:0;position:relative;overflow:hidden;background:#000;touch-action:pan-y;user-select:none}
  #dsGallery .gs-stage img,#dsGallery .gs-stage video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;-webkit-user-drag:none}
  #dsGallery .gs-edge{position:absolute;top:50%;transform:translateY(-50%);z-index:2;font-size:1.25em;padding:.7em .8em;border-radius:.8em;background:rgba(10,12,30,.7);border:1px solid rgba(170,180,255,.45);color:#fff;cursor:pointer;min-width:3.4em;min-height:3.4em}
  #dsGallery .gs-edge:hover,#dsGallery .gs-edge:focus-visible{background:rgba(124,140,255,.55);outline:2px solid #aab6ff}
  #dsGallery .gs-prev{left:.6em}#dsGallery .gs-next{right:.6em}
  #dsGallery .gs-note{position:absolute;left:50%;bottom:1em;transform:translateX(-50%);z-index:2;max-width:80%;background:rgba(10,12,30,.88);border:1px solid rgba(170,180,255,.45);border-radius:.7em;padding:.4em .8em;text-align:center;font-size:.92em}
  #dsGallery .gs-note[hidden]{display:none}
  #dsGallery .gs-info{flex:0 0 250px;overflow:auto;border-left:1px solid rgba(160,170,255,.14);padding:.6em .8em;font-size:.88em}
  #dsGallery .gs-info[hidden]{display:none}
  #dsGallery .gs-info dt{color:var(--muted,#a4abcc);font-size:.85em;margin-top:.5em}#dsGallery .gs-info dd{margin:0;word-break:break-word}
  #dsGallery .gs-loc{display:flex;align-items:center;gap:.3em;padding:.35em .6em;flex-wrap:wrap;border-top:1px solid rgba(160,170,255,.14);font-size:.9em}
  #dsGallery .gs-path{color:#9fb0ff;text-decoration:underline;cursor:pointer;background:none;border:0;padding:.15em .25em;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.85em;min-height:1.8em}
  #dsGallery .gs-strip{flex:0 0 auto;height:86px;overflow-x:auto;overflow-y:hidden;position:relative;border-top:1px solid rgba(160,170,255,.14);scrollbar-width:thin;cursor:grab;touch-action:pan-x}
  #dsGallery .gs-strip.dragging{cursor:grabbing}
  #dsGallery .gs-sspace{position:relative;height:100%}
  #dsGallery .gs-t{position:absolute;top:6px;width:80px;height:70px;padding:0;border:2px solid transparent;border-radius:.4em;overflow:hidden;background:rgba(255,255,255,.06);cursor:pointer}
  #dsGallery .gs-t img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}
  #dsGallery .gs-t.on{border-color:#ffd84a;box-shadow:0 0 0 2px rgba(255,216,74,.4)}
  html.mini #dsGallery .gs-info{position:absolute;right:0;top:0;bottom:0;background:#12153a;z-index:4;width:min(250px,80%)}
  html.mini #dsGallery .gs-edge{min-width:2.8em;min-height:2.8em;padding:.4em}`;
  document.head.appendChild(css);
  if (featureOff) { window.dsGallery = { actionsHtml: () => "", open: () => false, openFor: () => false, reveal, close: () => {}, state: () => ({ open: false, off: true }) }; return; }

  // ------------------------------------------------------------------------------------------------ state
  const PAGE = 120, STRIP_W = 88, RANDOM_STEP = 60;
  const DEF = { view: "all", fid: null, deep: false, q: "", set: null, person: "", fav: false, text: false, videos: false, from: null, to: null, said: "", group: "date", sort: "date", dir: "desc" };
  const G = { open: false, single: false, idx: 0, Q: { ...DEF }, total: 0, groups: [], pages: new Map(), loading: new Set(), title: "", gen: 0, crumbs: null, folder: null,
    rs: "r" + Math.random().toString(36).slice(2, 9), randomShown: RANDOM_STEP, rows: [], cols: 1, cell: 150, endArmed: 0, slide: 0, every: 5, info: null, people: null, reportT: 0, focusAfter: null };
  let root, grid, space, single, stage, strip, sspace;
  const $ = (s, el = root) => el.querySelector(s);
  function build() {
    root = document.createElement("section"); root.id = "dsGallery"; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Photo gallery"); root.hidden = true; root.tabIndex = -1;
    root.innerHTML = `
      <header class="g-bar"><span class="g-title"><b>🖼 Photos</b><small class="g-count"></small></span>
        <div class="g-tabs" role="tablist" aria-label="Which photos">
          <button type="button" class="gb" role="tab" data-g="tab" data-view="all" aria-selected="true">All photos</button>
          <button type="button" class="gb" role="tab" data-g="tab" data-view="random" aria-selected="false">🎲 Random</button>
          <button type="button" class="gb" role="tab" data-g="tab" data-view="favs" aria-selected="false">★ Favourites</button></div>
        <button type="button" class="gb" data-g="slideshow" title="Slideshow from here">▶ Slideshow</button>
        <button type="button" class="gb g-x" data-g="close" title="Close (Esc)" aria-label="Close the gallery">✕</button></header>
      <div class="g-tools" role="toolbar" aria-label="Group, sort and filter">
        <input type="search" class="g-search" placeholder="Search your photos" aria-label="Search your photos" maxlength="120">
        <label>Group <select data-g="group" aria-label="Group by"><option value="date">Month</option><option value="folder">Folder</option><option value="album">Album</option><option value="none">None</option></select></label>
        <label>Sort <select data-g="sort" aria-label="Sort by"><option value="date">Date</option><option value="name">Name</option><option value="size">Size</option></select></label>
        <button type="button" class="gb" data-g="dir" title="Newest or oldest first" aria-label="Sort direction">↓</button>
        <select data-g="person" aria-label="Photos of" hidden><option value="">Anyone</option></select>
        <button type="button" class="gb" data-g="fav" aria-pressed="false" title="Only favourites">★ only</button>
        <button type="button" class="gb" data-g="text" aria-pressed="false" title="Only photos with text in them">Has text</button>
        <button type="button" class="gb" data-g="videos" aria-pressed="false" title="Videos too">🎬 Videos too</button></div>
      <nav class="g-crumbs" aria-label="Folder" hidden></nav>
      <div class="g-grid" tabindex="0" aria-label="Photos"><div class="g-space"></div></div>
      <footer class="g-foot"><span class="g-st" aria-live="polite"></span><button type="button" class="gb" data-g="shuffle" hidden>🎲 Shuffle again</button><button type="button" class="gb" data-g="more" hidden>More ▾</button></footer>
      <div class="g-single" hidden role="group" aria-label="One photo">
        <div class="gs-top"><button type="button" class="gb" data-s="grid" title="Back to all the photos (Esc)">▦ All photos</button><span class="gs-name"></span><span class="gs-pos" aria-live="polite"></span>
          <button type="button" class="gb" data-s="fav" aria-pressed="false" title="Favourite (F)">☆</button><button type="button" class="gb" data-s="info" aria-pressed="false" title="Info (I)">ℹ Info</button>
          <button type="button" class="gb" data-s="show" aria-pressed="false" title="Slideshow (S)">▶ Slideshow</button><button type="button" class="gb" data-s="viewer" title="Open in the file viewer (zoom, rotate)">🔍</button>
          <button type="button" class="gb" data-g="close" aria-label="Close the gallery">✕</button></div>
        <div class="gs-main"><div class="gs-stage" tabindex="0" aria-label="The photo (← → or swipe for more)">
            <button type="button" class="gs-edge gs-prev" data-s="prev" aria-label="Back: the previous photo">◀ Back</button>
            <button type="button" class="gs-edge gs-next" data-s="next" aria-label="Next photo">Next ▶</button>
            <div class="gs-note" hidden role="status"></div></div>
          <aside class="gs-info" hidden aria-label="About this photo"></aside></div>
        <div class="gs-loc" aria-label="Where it's saved"><span aria-hidden="true">📂</span><span class="gs-crumbs"></span><button type="button" class="gs-path" data-s="reveal" title="Open in File Explorer"></button>
          <button type="button" class="gb" data-s="reveal">📂 Open in File Explorer</button></div>
        <div class="gs-strip" aria-label="More photos: scroll sideways"><div class="gs-sspace"></div></div></div>`;
    document.body.appendChild(root);
    grid = $(".g-grid"); space = $(".g-space"); single = $(".g-single"); stage = $(".gs-stage"); strip = $(".gs-strip"); sspace = $(".gs-sspace");
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    $(".g-search").addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { G.Q = { ...G.Q, view: e.target.value.trim() ? "search" : "all", q: e.target.value.trim(), fid: null }; reload(); } });
    grid.addEventListener("scroll", () => requestAnimationFrame(paintGrid));
    new ResizeObserver(() => { if (G.open) { layout(); paintGrid(); paintStrip(); } }).observe(root);
    stripHandlers(); stageHandlers();
    root.addEventListener("keydown", onKey);
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !G.open || (e.dsTop && e.dsTop !== root)) return;
      if (e.target?.matches?.("input") && e.target.value) return;
      e.stopImmediatePropagation(); e.preventDefault();
      if (G.single) closeSingle(); else close();
    }, true);
    // the window manager (public/winman.js): big / normal / small / minimised to the dock / closed, its – ❐ ▢ buttons in
    // the gallery's own bar, and its voice commands ("minimize the gallery"). Without it the gallery is a safe-area pop-up.
    registerWindow();
  }

  let wmDone = false;
  function registerWindow() {
    if (wmDone || !window.winman?.register) return;
    try { wmDone = Boolean(window.winman.register("gallery", root, { title: "Photos", icon: "🖼", aliases: ["gallery", "photo gallery", "photos", "my photos"], bar: ".g-bar", before: ".g-x", onClose: () => close(), isOpen: () => G.open })); } catch { /* the gallery works on its own */ }
  }
  const minimised = () => root?.classList.contains("wm-min");

  // ------------------------------------------------------------------------------------------------ loading the collection
  function params(offset, limit) {
    const Q = G.Q, u = new URLSearchParams();
    for (const k of ["view", "fid", "q", "set", "person", "said", "group", "sort", "dir"]) if (Q[k]) u.set(k, Q[k]);
    for (const k of ["deep", "fav", "text", "videos"]) if (Q[k]) u.set(k, "1");
    if (Q.from) u.set("from", String(Q.from)); if (Q.to) u.set("to", String(Q.to));
    if (Q.view === "random") { u.set("rs", G.rs); if (Q.shuffle) u.set("shuffle", "1"); }
    u.set("offset", String(offset)); u.set("limit", String(limit));
    return u;
  }
  async function loadPage(p, focus = null) {
    if (G.pages.has(p) || G.loading.has(p) || G.failed?.has(p)) return;
    const gen = G.gen; G.loading.add(p);
    try {
      const u = params(p * PAGE, PAGE); if (focus) u.set("focus", focus);
      const r = await api(`/gallery/list?${u}`);
      if (gen !== G.gen) return;
      G.Q.shuffle = false;
      G.total = r.total; G.groups = r.groups ?? []; G.title = r.title; G.crumbs = r.crumbs ?? G.crumbs; G.folder = r.folder ?? G.folder;
      G.pages.set(p, r.items);
      if (focus) G.focusIndex = r.focusIndex;
      return r;
    } catch (e) { (G.failed ??= new Set()).add(p); status(e.message); } finally { G.loading.delete(p); if (gen === G.gen) { paintGrid(); paintStrip(); if (G.single) paintSingleIfWaiting(); } }
  }
  const itemAt = (i) => G.pages.get(Math.floor(i / PAGE))?.[i % PAGE] ?? null;
  function ensure(from, to) { for (let p = Math.max(0, Math.floor(from / PAGE)); p <= Math.floor(Math.max(from, to) / PAGE); p++) if (p * PAGE < Math.max(G.total, 1)) loadPage(p); }
  async function reload({ focus = null, single = false } = {}) {
    G.gen++; G.pages.clear(); G.loading.clear(); G.failed = new Set(); G.total = 0; G.groups = []; G.crumbs = null; G.folder = null; G.randomShown = RANDOM_STEP; G.endArmed = 0;
    paintChrome(); layout(); grid.scrollTop = 0; paintGrid();
    const r = await loadPage(0, focus);
    if (!r) { paintChrome(); return; }
    paintChrome(); layout(); paintGrid();
    const fi = focus ? r.focusIndex : -1;
    if (fi >= 0) { await loadPage(Math.floor(fi / PAGE)); scrollGridTo(fi); }
    if (single) openSingle(Math.max(0, fi));
    report();
  }

  // ------------------------------------------------------------------------------------------------ the grid (only what's on the screen is drawn)
  function shownTotal() { return G.Q.view === "random" ? Math.min(G.total, G.randomShown) : G.total; }
  function layout() {
    if (!root || root.hidden) return;
    const W = grid.clientWidth || 800, mini = document.documentElement.classList.contains("mini");
    const min = mini ? 104 : 150, gap = 6;
    G.cols = Math.max(2, Math.floor((W - 12 + gap) / (min + gap)));
    G.cell = Math.floor((W - 12 - gap * (G.cols - 1)) / G.cols);
    const rowH = Math.round(G.cell * 0.78) + gap, HEAD = 34;
    const rows = []; let y = 4;
    const total = shownTotal();
    const groups = G.groups.length ? G.groups : [{ label: null, count: total }];
    let start = 0;
    for (const g of groups) {
      const n = Math.min(g.count, Math.max(0, total - start)); if (n <= 0) break;
      if (g.label != null) { rows.push({ h: true, label: g.label, count: g.count, y, height: HEAD }); y += HEAD; }
      for (let i = 0; i < n; i += G.cols) { rows.push({ start: start + i, n: Math.min(G.cols, n - i), y, height: rowH }); y += rowH; }
      start += g.count;
    }
    G.rows = rows; G.rowH = rowH;
    space.style.height = `${y + 8}px`;
  }
  const thumbUrl = (x) => `/api/gallery/thumb?id=${x.id}&v=${x.m ?? 0}`;
  function cellHtml(i, x) {
    if (!x) return `<button type="button" class="g-cell" data-i="${i}" style="width:${G.cell}px;height:${G.rowH - 6}px" aria-label="Photo ${i + 1}"><span class="ph">…</span></button>`;
    return `<button type="button" class="g-cell" data-i="${i}" data-id="${x.id}" style="width:${G.cell}px;height:${G.rowH - 6}px" title="${esc(x.name)}" aria-label="${esc(x.name)}"><img alt="" decoding="async" src="${thumbUrl(x)}" onerror="this.remove()">${x.fav ? '<span class="st">★</span>' : ""}${x.kind === "video" ? '<span class="vd">▶ video</span>' : ""}</button>`;
  }
  function firstRow(y) { let lo = 0, hi = G.rows.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (G.rows[mid].y <= y) lo = mid; else hi = mid - 1; } return lo; }
  function paintGrid() {
    if (!G.open || !root || root.hidden) return;
    const total = shownTotal();
    if (!total) { space.style.height = "100%"; space.innerHTML = `<div class="g-empty">${G.loading.size ? "Looking through your photos…" : esc(emptyText())}</div>`; return; }
    if (!G.rows.length) layout();
    const top = grid.scrollTop, H = grid.clientHeight || 600;
    const a = firstRow(Math.max(0, top - H * 0.5)), b = firstRow(top + H * 1.5);
    const html = [];
    let lo = Infinity, hi = -1;
    for (let r = a; r <= b && r < G.rows.length; r++) {
      const row = G.rows[r];
      if (row.h) { html.push(`<div class="g-head" style="top:${row.y}px;height:${row.height}px">${esc(row.label)}<small>${fmtN(row.count)}</small></div>`); continue; }
      lo = Math.min(lo, row.start); hi = Math.max(hi, row.start + row.n - 1);
      const cells = []; for (let i = row.start; i < row.start + row.n; i++) cells.push(cellHtml(i, itemAt(i)));
      html.push(`<div class="g-row" style="top:${row.y}px;height:${row.height}px">${cells.join("")}</div>`);
    }
    space.innerHTML = html.join("");
    G.drawn = { rows: b - a + 1, cells: hi >= lo ? hi - lo + 1 : 0, lo, hi };
    if (hi >= 0) ensure(lo, hi);
    // random: more as it nears the bottom (never a repeat: the server's shuffled order for this session)
    if (G.Q.view === "random" && G.randomShown < G.total && top + H > (G.rows.at(-1)?.y ?? 0) - H * 0.3) { G.randomShown = Math.min(G.total, G.randomShown + RANDOM_STEP); layout(); requestAnimationFrame(paintGrid); }
    paintFoot();
  }
  function emptyText() {
    if (G.Q.view === "favs" || G.Q.fav) return "No favourites yet. Open a photo and press ☆ to make it one.";
    if (G.Q.view === "search") return `No photos match “${G.Q.q}”.`;
    return "No photos here. Dayspring shows photos from your photo folders and the places file access allows (Settings → Permissions).";
  }
  function scrollGridTo(i) { const r = G.rows.find((x) => !x.h && i >= x.start && i < x.start + x.n); if (r) grid.scrollTop = Math.max(0, r.y - 40); paintGrid(); }
  function paintChrome() {
    const Q = G.Q;
    $(".g-count").textContent = G.total ? `${G.title ? G.title + " · " : ""}${fmtN(G.total)} ${G.total === 1 ? "photo" : "photos"}` : G.title || "";
    root.querySelectorAll("[data-g=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === (Q.view === "favs" ? "favs" : Q.view === "random" ? "random" : "all"))));
    $("[data-g=group]").value = Q.group; $("[data-g=sort]").value = Q.sort; $("[data-g=dir]").textContent = Q.dir === "asc" ? "↑" : "↓";
    $("[data-g=group]").disabled = Q.view === "random"; $("[data-g=sort]").disabled = Q.view === "random";
    for (const k of ["fav", "text", "videos"]) $(`[data-g=${k}]`).setAttribute("aria-pressed", String(Boolean(Q[k])));
    if (document.activeElement !== $(".g-search")) $(".g-search").value = Q.view === "search" ? Q.q : "";
    $("[data-g=shuffle]").hidden = Q.view !== "random";
    const nav = $(".g-crumbs");
    if (Q.view === "folder" && G.crumbs?.length) {
      nav.hidden = false;
      nav.innerHTML = `<button type="button" class="crumb" data-crumb="" title="All photos">All photos</button>` + G.crumbs.map((c) => `<span class="sepc">›</span><button type="button" class="crumb" data-crumb="${esc(c.fid)}" data-last="${c.last ? 1 : 0}">${esc(c.label)}</button>`).join("")
        + `<label style="margin-left:.8em;color:var(--muted,#a4abcc)"><input type="checkbox" data-g="deep" ${Q.deep ? "" : "checked"}> This folder only</label>`;
    } else nav.hidden = true;
    paintFoot();
  }
  function paintFoot() {
    const more = $("[data-g=more]");
    more.hidden = !(G.Q.view === "random" && G.randomShown < G.total);
    status(G.total ? (G.Q.view === "random" ? `${fmtN(shownTotal())} of ${fmtN(G.total)} shuffled · scroll or press More for more, never a repeat` : `${fmtN(G.total)} ${G.total === 1 ? "photo" : "photos"}${G.Q.group !== "none" && G.groups.length ? ` in ${fmtN(G.groups.length)} ${G.Q.group === "date" ? "months" : G.Q.group === "folder" ? "folders" : "albums"}` : ""}`) : "");
  }
  const status = (t) => { if (root) $(".g-st").textContent = t ?? ""; };

  // ------------------------------------------------------------------------------------------------ one photo, with the filmstrip
  function openSingle(i) {
    G.single = true; single.hidden = false;
    G.idx = Math.max(0, Math.min(Math.max(0, G.total - 1), i));
    show(G.idx, { jump: true });
    stage.focus({ preventScroll: true });
  }
  function closeSingle() { slideshow(false); G.single = false; single.hidden = true; stage.querySelectorAll("img,video").forEach((e) => e.remove()); scrollGridTo(G.idx); grid.focus({ preventScroll: true }); report(); }
  let waitingFor = -1;
  function paintSingleIfWaiting() { if (waitingFor >= 0 && itemAt(waitingFor)) { const i = waitingFor; waitingFor = -1; show(i); } }
  function setNote(t, ms = 5000) { const n = $(".gs-note"); n.textContent = t; n.hidden = !t; clearTimeout(setNote.t); if (t && ms) setNote.t = setTimeout(() => { n.hidden = true; }, ms); }
  async function show(i, { jump = false } = {}) {
    G.idx = i;
    const x = itemAt(i);
    $(".gs-pos").textContent = G.total ? `${fmtN(i + 1)} of ${fmtN(G.total)}` : "";
    paintStrip(true);
    if (!x) { waitingFor = i; ensure(i, i); $(".gs-name").textContent = "Loading…"; return; }
    $(".gs-name").textContent = x.name; $(".gs-name").title = x.name;
    const fav = $("[data-s=fav]"); fav.textContent = x.fav ? "★" : "☆"; fav.setAttribute("aria-pressed", String(Boolean(x.fav)));
    stage.querySelectorAll("img,video").forEach((e) => e.remove());
    const src = `/api/gallery/file?id=${x.id}`;
    let el;
    if (x.kind === "video") { el = document.createElement("video"); el.controls = true; el.playsInline = true; el.src = src; el.preload = "metadata"; }
    else { el = document.createElement("img"); el.alt = x.name; el.decoding = "async"; el.draggable = false; el.src = src; el.onerror = () => setNote("This picture can't be shown here. 🔍 opens it in the file viewer."); }
    el.dataset.id = x.id;
    stage.prepend(el);
    // the next ones load while he looks
    for (const d of [1, 2, -1]) { const y = itemAt(i + d); if (y && y.kind !== "video") { const im = new Image(); im.src = `/api/gallery/file?id=${y.id}`; } }
    ensure(Math.max(0, i - PAGE / 2), Math.min(G.total - 1, i + PAGE / 2));
    // where it's saved (always shown), and the info
    const want = x.id;
    try {
      const r = await api(`/gallery/item?id=${x.id}`);
      if (G.idx !== i || itemAt(i)?.id !== want) return;
      G.info = r;
      $(".gs-crumbs").innerHTML = r.crumbs.map((c, k) => `${k ? '<span class="sepc">›</span>' : ""}<button type="button" class="crumb" data-crumb="${esc(c.fid)}" data-last="${c.last ? 1 : 0}" title="Show the photos in ${esc(c.label)}">${esc(c.label)}</button>`).join("");
      const p = $(".gs-path"); p.textContent = r.path; p.title = `Open in File Explorer: ${r.path}`;
      if (!$(".gs-info").hidden) paintInfo();
    } catch (e) { $(".gs-crumbs").textContent = ""; $(".gs-path").textContent = e.message; }
    report();
  }
  function step(d) {
    if (!G.total) return "There are no photos here.";
    const n = G.idx + d;
    if (n >= G.total || n < 0) {
      // at an end: say so; one more press starts over from the other end
      if (G.endArmed === d) { G.endArmed = 0; setNote(""); show(n < 0 ? G.total - 1 : 0, { jump: true }); return ""; }
      G.endArmed = d;
      const t = n < 0 ? `This is the first photo here (1 of ${fmtN(G.total)}). Press Back again to go to the last one.` : `That's the last photo here (${fmtN(G.total)} of ${fmtN(G.total)}). Press Next again to start over from the first.`;
      setNote(t, 8000); return t;
    }
    G.endArmed = 0; setNote("");
    show(n); return "";
  }
  function slideshow(on = !G.slide) {
    clearInterval(G.slide); G.slide = 0;
    if (on) { if (!G.single) openSingle(Math.max(0, G.drawn?.lo ?? 0)); G.slide = setInterval(() => { if (!G.open || !G.single) return slideshow(false); if (G.idx + 1 >= G.total) show(0, { jump: true }); else show(G.idx + 1); }, G.every * 1000); }
    const b = $("[data-s=show]"); b.setAttribute("aria-pressed", String(Boolean(G.slide))); b.textContent = G.slide ? "⏸ Slideshow" : "▶ Slideshow";
    return G.slide ? `Slideshow, every ${G.every} seconds.` : "Slideshow stopped.";
  }
  // the filmstrip: every photo in the collection, drawn only where it's scrolled to
  function paintStrip(center = false) {
    if (!G.single || !strip) return;
    sspace.style.width = `${Math.max(G.total, 1) * STRIP_W + 8}px`;
    if (center) { const want = G.idx * STRIP_W + STRIP_W / 2 - strip.clientWidth / 2; if (Math.abs(strip.scrollLeft - want) > strip.clientWidth * 3) strip.scrollLeft = want; else strip.scrollTo({ left: want, behavior: "smooth" }); }
    const L = strip.scrollLeft, W = strip.clientWidth || 800;
    const a = Math.max(0, Math.floor((L - W) / STRIP_W)), b = Math.min(G.total - 1, Math.ceil((L + 2 * W) / STRIP_W));
    const html = [];
    for (let i = a; i <= b; i++) { const x = itemAt(i); html.push(`<button type="button" class="gs-t${i === G.idx ? " on" : ""}" data-t="${i}" style="left:${i * STRIP_W + 4}px" title="${esc(x?.name ?? "")}" aria-label="${esc(x?.name ?? `Photo ${i + 1}`)}"${i === G.idx ? ' aria-current="true"' : ""}>${x ? `<img alt="" decoding="async" src="${thumbUrl(x)}" onerror="this.remove()">` : ""}</button>`); }
    sspace.innerHTML = html.join("");
    G.strip = { first: a, last: b };
    if (b >= a) ensure(a, b);
  }
  function stripHandlers() {
    strip.addEventListener("scroll", () => requestAnimationFrame(() => paintStrip(false)));
    // the wheel scrolls it sideways ("scroll to the right to see more")
    strip.addEventListener("wheel", (e) => { e.preventDefault(); strip.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; }, { passive: false });
    let drag = null;
    strip.addEventListener("pointerdown", (e) => { if (e.button !== 0 || e.pointerType === "touch") return; drag = { x: e.clientX, left: strip.scrollLeft, moved: false }; });
    addEventListener("pointermove", (e) => { if (!drag) return; const dx = e.clientX - drag.x; if (Math.abs(dx) > 5) { drag.moved = true; strip.classList.add("dragging"); } if (drag.moved) strip.scrollLeft = drag.left - dx; });
    addEventListener("pointerup", () => { if (!drag) return; const moved = drag.moved; strip.classList.remove("dragging"); setTimeout(() => { drag = null; }, 0); if (moved) strip.dataset.dragged = String(Date.now()); });
    strip.addEventListener("click", (e) => { if (Date.now() - Number(strip.dataset.dragged || 0) < 250) return; const t = e.target.closest("[data-t]"); if (t) { slideshow(false); G.endArmed = 0; show(Number(t.dataset.t)); } });
  }
  function stageHandlers() {
    // the wheel on the photo moves through them (one step at a time, however fast it spins)
    let wheelAt = 0;
    stage.addEventListener("wheel", (e) => { if (e.target.closest("video")) return; e.preventDefault(); const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; if (Math.abs(d) < 4 || Date.now() - wheelAt < 280) return; wheelAt = Date.now(); step(d > 0 ? 1 : -1); }, { passive: false });
    // a swipe or a drag across the photo
    let sw = null;
    stage.addEventListener("pointerdown", (e) => { if (e.target.closest("button, video")) return; sw = { x: e.clientX, y: e.clientY, t: Date.now() }; });
    stage.addEventListener("pointerup", (e) => { if (!sw) return; const dx = e.clientX - sw.x, dy = e.clientY - sw.y; sw = null; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) step(dx < 0 ? 1 : -1); });
    stage.addEventListener("pointercancel", () => { sw = null; });
    stage.addEventListener("dblclick", () => { const x = itemAt(G.idx); if (x) openInViewer(x); });
  }
  async function openInViewer(x) {
    if (!window.dsViewer) return;
    try { const r = await api(`/viewer/info?id=${x.id}`); window.dsViewer.open({ item: { ...r, when: r.modified ? new Date(r.modified).toLocaleDateString() : "" } }); }
    catch (e) { setNote(`${e.message} (the file viewer only opens files in the places file access allows)`); }
  }
  async function paintInfo() {
    const box = $(".gs-info"), x = itemAt(G.idx); if (!x) return;
    const r = G.info?.id === x.id ? G.info : await api(`/gallery/item?id=${x.id}`).catch((e) => ({ error: e.message }));
    if (r.error) { box.textContent = r.error; return; }
    const rows = [["Name", r.name], ["Date", r.taken ? new Date(r.taken).toLocaleString() : r.date ? new Date(r.date).toLocaleDateString() : ""], ["Camera", r.camera], ["Size", r.sizeText],
      ["Dimensions", r.width ? `${r.width} × ${r.height} pixels` : ""], ["People", (r.people ?? []).join(", ")], ["Album", r.album], ["Your words", r.ownWords], ["Description", r.description], ["Text in it", r.ocr],
      ["Location", r.gps ? "Saved in the photo (kept private)" : ""], ["Folder", r.where], ["Saved at", r.path]].filter(([, v]) => v);
    box.innerHTML = `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
  }

  // ------------------------------------------------------------------------------------------------ clicks, keys
  async function onClick(e) {
    const c = e.target.closest("[data-crumb]");
    if (c) { const fid = c.dataset.crumb; if (G.single) closeSingle(); G.Q = fid ? { ...DEF, group: "none", view: "folder", fid, deep: c.dataset.last !== "1" } : { ...DEF }; return reload(); }
    const cell = e.target.closest(".g-cell"); if (cell) { openSingle(Number(cell.dataset.i)); return; }
    const b = e.target.closest("[data-g],[data-s]"); if (!b) return;
    const g = b.dataset.g, s = b.dataset.s, Q = G.Q;
    if (g === "close") return close();
    if (g === "tab") { const v = b.dataset.view; G.Q = { ...DEF, view: v, group: v === "all" ? "date" : "none", shuffle: v === "random" }; if (G.single) closeSingle(); return reload(); }
    if (g === "dir") { Q.dir = Q.dir === "asc" ? "desc" : "asc"; return reload(); }
    if (g === "fav" || g === "text" || g === "videos") { Q[g] = !Q[g]; return reload(); }
    if (g === "shuffle") { Q.view = "random"; Q.shuffle = true; return reload(); }
    if (g === "more") { G.randomShown = Math.min(G.total, G.randomShown + RANDOM_STEP); layout(); paintGrid(); const last = G.rows.at(-1); if (last) grid.scrollTo({ top: Math.max(0, last.y - grid.clientHeight + 40), behavior: "smooth" }); return; }
    if (g === "slideshow") return slideshow(true);
    if (s === "grid") return closeSingle();
    if (s === "prev") { slideshow(false); return step(-1); }
    if (s === "next") { slideshow(false); return step(1); }
    if (s === "show") return slideshow();
    if (s === "reveal") { const x = itemAt(G.idx); if (x) reveal(x.id, b); return; }
    if (s === "info") { const box = $(".gs-info"); box.hidden = !box.hidden; b.setAttribute("aria-pressed", String(!box.hidden)); if (!box.hidden) paintInfo(); return; }
    if (s === "fav") { const x = itemAt(G.idx); if (!x) return; const r = await api("/gallery/fav", { id: x.id, on: !x.fav }).catch(() => null); if (r) { x.fav = r.fav ? 1 : 0; b.textContent = x.fav ? "★" : "☆"; b.setAttribute("aria-pressed", String(Boolean(x.fav))); } return; }
    if (s === "viewer") { const x = itemAt(G.idx); if (x) openInViewer(x); }
  }
  function onChange(e) {
    const g = e.target.dataset.g, Q = G.Q;
    if (g === "group") { Q.group = e.target.value; return reload(); }
    if (g === "sort") { Q.sort = e.target.value; Q.dir = Q.sort === "name" ? "asc" : "desc"; return reload(); }
    if (g === "person") { Q.person = e.target.value; return reload(); }
    if (g === "deep") { Q.deep = !e.target.checked; return reload(); }
  }
  function onKey(e) {
    if (e.target.matches("input, select, textarea")) return;
    const k = e.key, done = () => { e.preventDefault(); e.stopPropagation(); };
    if (G.single) {
      if (k === "ArrowRight" || k === "PageDown") { done(); slideshow(false); step(1); }
      else if (k === "ArrowLeft" || k === "PageUp") { done(); slideshow(false); step(-1); }
      else if (k === "Home") { done(); show(0, { jump: true }); } else if (k === "End") { done(); show(G.total - 1, { jump: true }); }
      else if (k === "s" || k === "S") { done(); slideshow(); } else if (k === "i" || k === "I") { done(); $("[data-s=info]").click(); } else if (k === "f" || k === "F") { done(); $("[data-s=fav]").click(); }
    } else if (k === "Enter" && e.target.closest?.(".g-cell")) { done(); openSingle(Number(e.target.closest(".g-cell").dataset.i)); }
  }

  // ------------------------------------------------------------------------------------------------ opening and closing
  async function people() {
    if (G.people) return;
    try { const r = await api("/gallery/people"); G.people = r.people ?? []; } catch { G.people = []; }
    const sel = $("[data-g=person]"); sel.hidden = !G.people.length;
    sel.innerHTML = `<option value="">Anyone</option>` + G.people.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${p.photos})</option>`).join("");
    sel.value = G.Q.person || "";
  }
  // open({ view, fid, deep, q, set, person, fav, text, videos, from, to, said, group, sort, dir, focus, single, shuffle })
  async function open(o = {}) {
    if (!root) build();
    G.open = true; root.hidden = false;
    const view = o.view ?? "all";
    G.Q = { ...DEF, group: view === "all" ? "date" : "none", ...Object.fromEntries(Object.entries(o).filter(([k, v]) => k in DEF && v != null)), view, shuffle: Boolean(o.shuffle) || view === "random" };
    if (o.sort && !o.dir) G.Q.dir = o.sort === "name" ? "asc" : "desc";
    if (!o.single && G.single) { G.single = false; single.hidden = true; }
    people();
    registerWindow();
    try { const w = window.winman?.get?.("gallery"); if (w && (w.mode === "min" || w.mode === "closed")) window.winman.setMode("gallery", "restore", { user: false }); } catch { /* fine */ }
    await reload({ focus: isId(o.focus) ? o.focus : null, single: Boolean(o.single) });
    if (!G.single) grid.focus({ preventScroll: true });
    return true;
  }
  // "🖼 View in gallery" for one photo: its folder (or the set it came from), with it open
  async function openFor(id, { ids = null, title = "" } = {}) {
    if (!isId(id)) return false;
    // the gallery comes to the front: the file viewer and the web pictures step aside
    try { if (window.dsViewer?.state?.().open) window.dsViewer.close(); } catch { /* fine */ }
    try { if (document.getElementById("dsImages")) fetch("/api/images/act", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "close" }) }).catch(() => {}); } catch { /* fine */ }
    try {
      if (ids?.length > 1) { const r = await api("/gallery/set", { ids, title }); return open({ view: "set", set: r.set, focus: id, single: true }); }
      const r = await api("/gallery/register", { id });
      return open({ view: "folder", fid: r.fid, focus: r.id, single: true });
    } catch (e) { toast("View in gallery", e.message); return false; }
  }
  function close() {
    if (!root || !G.open) return;
    slideshow(false); G.open = false; G.single = false; single.hidden = true; root.hidden = true; space.innerHTML = ""; sspace.innerHTML = "";
    stage.querySelectorAll("img,video").forEach((e) => e.remove());
    report(true);
  }
  function report(now = false) {
    clearTimeout(G.reportT);
    G.reportT = setTimeout(() => api("/gallery/state", G.open ? { open: true, id: G.single ? itemAt(G.idx)?.id ?? null : null, single: G.single } : { open: false }).catch(() => {}), now ? 0 : 300);
  }
  function ctl(c = {}) {
    if (c.ctl === "close") return close();
    if (!G.open) return false;
    switch (c.ctl) {
      case "next": if (G.single) return step(1); grid.scrollBy({ top: grid.clientHeight * 0.9, behavior: "smooth" }); return "";
      case "prev": if (G.single) return step(-1); grid.scrollBy({ top: -grid.clientHeight * 0.9, behavior: "smooth" }); return "";
      case "slideshow": return slideshow(c.on ?? !G.slide);
      case "shuffle": G.Q = { ...DEF, view: "random", group: "none", shuffle: true }; if (G.single) closeSingle(); reload(); return "Shuffled.";
      case "more": if (G.Q.view === "random") { root.querySelector("[data-g=more]").click(); return ""; } return ctl({ ctl: "next" });
      case "grid": if (G.single) closeSingle(); return "";
      case "reveal": { const x = itemAt(G.idx); if (G.single && x) reveal(x.id); return ""; }
    }
    return false;
  }

  // ------------------------------------------------------------------------------------------------ voice on the screen (instant, while it's open)
  (window.dsLocal ??= []).unshift((t) => {
    if (!G.open || !root || root.hidden || minimised() || window.dsViewer?.state?.().open) return false;
    t = String(t).toLowerCase().replace(/[.!?,]/g, "").trim();
    if (/^(next|next (one|photo|picture)|scroll right|go right|forward)$/.test(t)) { slideshow(false); const r = ctl({ ctl: "next" }); return typeof r === "string" && r ? r : true; }
    if (/^(previous|back|go back|previous (one|photo|picture)|scroll left|go left)$/.test(t)) { slideshow(false); const r = ctl({ ctl: "prev" }); return typeof r === "string" && r ? r : true; }
    if (/^((start|play|begin) (a |the )?slide ?show|slide ?show)$/.test(t)) return slideshow(true);
    if (/^(stop|end|pause) (the )?slide ?show$/.test(t)) return slideshow(false);
    if (/^(shuffle( them)? again|reshuffle)$/.test(t)) return ctl({ ctl: "shuffle" });
    if (/^(more|show more|load more)$/.test(t) && G.Q.view === "random") { ctl({ ctl: "more" }); return true; }
    if (/^(back to (the )?(grid|gallery|all photos)|show (the )?grid)$/.test(t) && G.single) { closeSingle(); return true; }
    if (/^(open (the |this )?(photo'?s |picture'?s )?(file )?location|open this (photo|picture)'?s? folder|show me where (this|it)( photo| picture)? is saved|show (it|this) in (file )?explorer)$/.test(t) && G.single) { ctl({ ctl: "reveal" }); return "Opening File Explorer."; }
    if (/^(close|close (the |my )?(photo )?gallery|exit (the )?gallery)$/.test(t)) { close(); return true; }
    return false;
  });

  // ------------------------------------------------------------------------------------------------ the server says
  const attach = (es) => es.addEventListener("gallery", (e) => {
    let d = {}; try { d = JSON.parse(e.data); } catch { return; }
    if (d.open) open(d.open);
    if (d.ctl) ctl(d.ctl);
  });
  if (window.dsEvents) attach(window.dsEvents); else addEventListener("ds-events", (e) => attach(e.detail), { once: true });
  window.dsGallery = { open, openFor, close, reveal, ctl, step, actionsHtml, slideshow: (on) => slideshow(on),
    state: () => ({ open: G.open, single: G.single, index: G.idx, total: G.total, shown: shownTotal(), id: G.single ? itemAt(G.idx)?.id ?? null : null, name: G.single ? itemAt(G.idx)?.name ?? null : null,
      view: G.Q.view, group: G.Q.group, sort: G.Q.sort, title: G.title, groups: G.groups.length, drawn: G.drawn ?? null, strip: G.strip ?? null, cols: G.cols, loaded: [...G.pages.keys()].length,
      note: root && !$(".gs-note").hidden ? $(".gs-note").textContent : "", path: root ? $(".gs-path").textContent : "", crumbs: root ? [...root.querySelectorAll(".gs-crumbs .crumb")].map((b) => b.textContent) : [], slideshow: Boolean(G.slide) }),
    _item: (i) => itemAt(i) };
})();
