// The file viewer on the Dayspring screen: one window for every kind of file the finder opens (lib/finder), plus the
// numbered list of matches ("find my resume" → several → "number 2") with a search box.
//   Pictures: zoom (wheel, pinch, + −, Fit, 100%), pan, rotate, flip, ◀ ▶ through the folder or the results, a slideshow,
//             the info panel (date taken, camera, size, the description and the text in it), copy, save a copy, set as
//             avatar, delete (Recycle Bin, asks first), show in folder.   HEIC and TIFF are decoded by Windows (server).
//   Video and audio: play/pause, seek, ±10 s, speed, volume, captions (.srt/.vtt next to it), loop, picture-in-picture,
//             full screen; formats the screen can't play are converted by the server's ffmpeg (as the media library does).
//   PDF: pdf.js (public/vendor/pdfjs): page thumbnails, pages, zoom, fit width/page, rotate, search, print, download, and
//             "read aloud" (the page's text through window.dsSpeak, so the floor decides when it speaks).
//   Text and code: highlighting (public/vendor/prism), word wrap, search, text size; Markdown rendered; CSV as a sortable table.
//   Word (rendered on the server), Excel/CSV sheets (sortable), PowerPoint (each slide's text and pictures), zip (the list;
//   a small file inside opens here too). Anything else: an info card and "Open in the default app".
// Files are only ever asked for by id (/api/viewer/…?id=): the page never sees or sends a path.
// Keyboard and remote: ← → previous/next (a page in a PDF), + − zoom, 0 fit, 1 actual size, R rotate, F full screen,
// I info, S slideshow, Space play/pause, / search, Delete asks to delete, Esc closes. Voice (window.dsLocal, only while it's
// open): "next", "previous", "zoom in", "rotate", "page 5", "read this page", "search for rent", "start slideshow", "close".
// Opened by the server ("viewer" events: { open }, { list }, { ctl }), or window.dsViewer.open / find (tests, other pages).
(() => {
  if (window.dsViewer) return;
  if (window.dsFeatures?.on && window.dsFeatures.on("fileviewer") === false) return;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (path, body) => {
    const r = await fetch("/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `Dayspring couldn't do that just now (${r.status}).`), { status: r.status, body: j });
    return j;
  };
  const toast = (t, s = "") => { try { window.dayspring?.toast ? window.dayspring.toast(t, s, "", "bell") : console.log("viewer:", t, s); } catch { /* fine */ } };
  const mmss = (x) => { x = Math.max(0, Math.floor(Number(x) || 0)); const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), s = String(x % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`; };
  const fileUrl = (id, entry, extra = "") => (entry ? `/api/viewer/inner?id=${encodeURIComponent(id)}&entry=${encodeURIComponent(entry)}${extra}` : `/api/viewer/file?id=${encodeURIComponent(id)}${extra}`);
  const ICON = { image: "🖼", video: "🎬", audio: "♪", pdf: "📕", text: "📄", markdown: "📝", csv: "📊", code: "⌨", docx: "📘", doc: "📘", sheet: "📊", slides: "📽", zip: "🗜", drivedoc: "☁", other: "📦" };
  const kindOfName = (n) => {
    const e = String(n).split(".").pop().toLowerCase();
    const K = { image: "jpg jpeg jfif png gif webp bmp svg heic heif avif ico tif tiff", video: "mp4 m4v mkv webm mov avi wmv mpg mpeg 3gp", audio: "mp3 m4a aac flac wav ogg opus wma", pdf: "pdf", markdown: "md markdown", csv: "csv tsv",
      text: "txt log ini cfg conf srt vtt nfo", code: "js mjs cjs ts tsx jsx json css scss html htm xml yml yaml toml py c cpp h hpp cs java go rs rb php lua sql sh bash ps1 psm1 bat cmd cfm cfc ino scad gcode kt swift vb r pl dart", docx: "docx docm dotx", sheet: "xlsx xlsm xls ods", slides: "pptx", zip: "zip" };
    for (const [k, v] of Object.entries(K)) if (v.split(" ").includes(e)) return k;
    return "other";
  };
  const LANG = { js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx", ts: "typescript", tsx: "tsx", json: "json", css: "css", scss: "css", html: "markup", htm: "markup", xml: "markup", yml: "yaml", yaml: "yaml", toml: "toml", py: "python", c: "c", h: "c", cpp: "cpp", hpp: "cpp", ino: "cpp", cs: "csharp", java: "java", go: "go", rs: "rust", rb: "ruby", php: "php", lua: "lua", sql: "sql", sh: "bash", bash: "bash", ps1: "powershell", psm1: "powershell", bat: "batch", cmd: "batch", ini: "ini", cfg: "ini", md: "markdown" };

  // ---------------------------------------------------------------------------------------------------- styles
  const css = document.createElement("style");
  css.textContent = `
  #dsViewer{box-sizing:border-box;position:fixed;z-index:49;display:flex;flex-direction:column;min-width:280px;min-height:240px;border-radius:1em;overflow:hidden;color:var(--ink,#eef0ff);
    background:rgba(10,12,30,.97);backdrop-filter:blur(18px);border:1px solid var(--edge2,rgba(170,180,255,.28));box-shadow:0 30px 90px rgba(0,0,0,.65);font-size:15px;
    left:calc(var(--safe-left,0px) + 4vw);top:calc(var(--safe-top,0px) + 4vh);width:min(1100px,calc(var(--safe-w,100vw) - 8vw));height:min(760px,calc(var(--safe-h,100vh) - 8vh))}
  #dsViewer[hidden],#dsFinder[hidden]{display:none}
  #dsViewer.full{border-radius:0}
  #dsViewer button,#dsFinder button,#dsViewer select,#dsViewer input,#dsFinder input,#dsFinder select{font:inherit;color:inherit}
  #dsViewer .vb,#dsFinder .vb{background:rgba(255,255,255,.07);border:1px solid var(--edge2,rgba(170,180,255,.28));border-radius:.55em;padding:.28em .55em;cursor:pointer;min-width:2.1em;min-height:2em;white-space:nowrap;line-height:1.2}
  #dsViewer .vb:hover,#dsViewer .vb:focus-visible,#dsFinder .vb:hover,#dsFinder .vb:focus-visible{background:rgba(124,140,255,.32);outline:2px solid rgba(160,175,255,.7);outline-offset:1px}
  #dsViewer .vb[aria-pressed="true"]{background:rgba(124,140,255,.45)}
  #dsViewer .vb.danger{border-color:rgba(255,120,120,.5)}
  #dsViewer select,#dsViewer input[type=search],#dsViewer input[type=number],#dsFinder input,#dsFinder select{background:rgba(255,255,255,.08);border:1px solid var(--edge2,rgba(170,180,255,.28));border-radius:.5em;padding:.25em .45em;min-height:2em}
  #dsViewer .vw-bar{display:flex;align-items:center;gap:.5em;padding:.45em .6em;border-bottom:1px solid var(--edge,rgba(160,170,255,.14));cursor:move;user-select:none;flex:0 0 auto}
  #dsViewer .vw-title{flex:1 1 8em;min-width:0}
  #dsViewer .vw-title b{display:block;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #dsViewer .vw-title small{display:block;color:var(--muted,#a4abcc);font-size:.78em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #dsViewer .vw-win{display:flex;gap:.3em;flex:0 0 auto}
  #dsViewer .vw-tools{display:flex;gap:.3em;align-items:center;padding:.35em .6em;border-bottom:1px solid var(--edge,rgba(160,170,255,.14));overflow-x:auto;overflow-y:hidden;flex:0 0 auto;scrollbar-width:thin}
  #dsViewer .vw-tools:empty{display:none}
  #dsViewer .vw-tools .sep{width:1px;align-self:stretch;background:var(--edge,rgba(160,170,255,.2));margin:0 .2em;flex:0 0 1px}
  #dsViewer .vw-tools .lbl{color:var(--muted,#a4abcc);font-size:.85em;white-space:nowrap;min-width:3.4em;text-align:center}
  #dsViewer .vw-body{flex:1 1 auto;display:flex;min-height:0;position:relative}
  #dsViewer .vw-side{flex:0 0 150px;overflow:auto;border-right:1px solid var(--edge,rgba(160,170,255,.14));padding:.4em}
  #dsViewer .vw-side[hidden]{display:none}
  #dsViewer .vw-stage{flex:1 1 auto;min-width:0;position:relative;overflow:auto;outline:none}
  #dsViewer .vw-info{flex:0 0 260px;overflow:auto;border-left:1px solid var(--edge,rgba(160,170,255,.14));padding:.7em .8em;font-size:.88em}
  #dsViewer .vw-info[hidden]{display:none}
  #dsViewer .vw-info dt{color:var(--muted,#a4abcc);font-size:.85em;margin-top:.55em}#dsViewer .vw-info dd{margin:0;word-break:break-word}
  #dsViewer .vw-info .acts{display:flex;flex-wrap:wrap;gap:.35em;margin-top:.8em}
  #dsViewer .vw-foot{flex:0 0 auto;display:flex;align-items:center;gap:.5em;padding:.3em .7em;border-top:1px solid var(--edge,rgba(160,170,255,.14));font-size:.82em;color:var(--muted,#a4abcc);min-height:1.9em}
  #dsViewer .vw-foot .st{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #dsViewer .vw-grip{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,rgba(170,180,255,.5) 50% 58%,transparent 58% 70%,rgba(170,180,255,.5) 70% 78%,transparent 78%)}
  #dsViewer.full .vw-grip{display:none}
  #dsViewer .vw-img{position:absolute;inset:0;overflow:hidden;cursor:grab;touch-action:none;background:repeating-conic-gradient(rgba(255,255,255,.03) 0 25%,transparent 0 50%) 0 0/24px 24px}
  #dsViewer .vw-img.panning{cursor:grabbing}
  #dsViewer .vw-img img{position:absolute;left:50%;top:50%;transform-origin:center center;max-width:none;user-select:none;-webkit-user-drag:none;image-rendering:auto}
  #dsViewer .vw-media{position:absolute;inset:0;display:flex;flex-direction:column;background:#000}
  #dsViewer .vw-media video{flex:1;min-height:0;width:100%;background:#000;object-fit:contain}
  #dsViewer .vw-media .aud{flex:1;display:grid;place-items:center;text-align:center;color:#dfe3ff;background:radial-gradient(circle at 50% 40%,rgba(124,140,255,.25),transparent 60%)}
  #dsViewer .vw-media .aud b{font-size:4em;display:block}
  #dsViewer .vw-mctl{display:flex;align-items:center;gap:.35em;padding:.4em .6em;background:rgba(10,12,30,.95);flex-wrap:wrap}
  #dsViewer .vw-mctl input[type=range]{accent-color:#8b9bff}
  #dsViewer .vw-mctl .seek{flex:1 1 10em;min-width:6em}
  #dsViewer .vw-mctl .vol{width:6em}
  #dsViewer .vw-pages{padding:1em;display:flex;flex-direction:column;align-items:center;gap:1em}
  #dsViewer .vw-page{position:relative;background:#fff;box-shadow:0 6px 24px rgba(0,0,0,.5);flex:0 0 auto}
  #dsViewer .vw-page canvas{display:block;width:100%;height:100%}
  #dsViewer .textLayer{position:absolute;inset:0;overflow:hidden;line-height:1;opacity:1;text-align:initial;forced-color-adjust:none;transform-origin:0 0}
  #dsViewer .textLayer span,#dsViewer .textLayer br{color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0 0}
  #dsViewer .textLayer .hit{background:rgba(255,205,0,.45);border-radius:2px}
  #dsViewer .textLayer .hit.cur{background:rgba(255,120,0,.6)}
  #dsViewer .vw-thumb{display:block;width:100%;margin:0 0 .5em;padding:.25em;border-radius:.4em;background:transparent;border:2px solid transparent;cursor:pointer;color:var(--muted,#a4abcc);font-size:.75em;text-align:center}
  #dsViewer .vw-thumb.on{border-color:#8b9bff;color:#fff}
  #dsViewer .vw-thumb canvas,#dsViewer .vw-thumb .ph{display:block;width:100%;background:#fff;min-height:40px}
  #dsViewer pre.vw-code{margin:0;padding:.8em 1em;font:13px/1.5 Consolas,"Cascadia Mono",monospace;white-space:pre;tab-size:4;min-height:100%;box-sizing:border-box}
  #dsViewer pre.vw-code.wrap{white-space:pre-wrap;word-break:break-word}
  #dsViewer mark.vw-hit{background:rgba(255,205,0,.5);color:inherit;border-radius:2px}#dsViewer mark.vw-hit.cur{background:rgba(255,120,0,.75)}
  #dsViewer .vw-doc{padding:1em 1.6em 3em;line-height:1.55;max-width:60em;margin:0 auto}
  #dsViewer .vw-doc img{max-width:100%;height:auto}
  #dsViewer .vw-doc table{border-collapse:collapse}#dsViewer .vw-doc td,#dsViewer .vw-doc th{border:1px solid rgba(170,180,255,.3);padding:.25em .5em}
  #dsViewer .vw-doc pre{background:rgba(255,255,255,.05);padding:.6em;border-radius:.5em;overflow:auto}
  #dsViewer .vw-doc a{color:#9fb0ff}
  #dsViewer .vw-doc blockquote{border-left:3px solid rgba(160,175,255,.5);margin:.5em 0;padding:.1em .9em;color:var(--muted,#c7ccef)}
  #dsViewer .vw-table{border-collapse:collapse;font-size:.88em;min-width:100%}
  #dsViewer .vw-table th,#dsViewer .vw-table td{border:1px solid rgba(170,180,255,.2);padding:.3em .55em;text-align:left;vertical-align:top;white-space:nowrap;max-width:28em;overflow:hidden;text-overflow:ellipsis}
  #dsViewer .vw-table thead th{position:sticky;top:0;background:#1a1e44;cursor:pointer;z-index:1}
  #dsViewer .vw-table thead th[aria-sort=ascending]::after{content:" ▲"}#dsViewer .vw-table thead th[aria-sort=descending]::after{content:" ▼"}
  #dsViewer .vw-table td.num{text-align:right;font-variant-numeric:tabular-nums}
  #dsViewer .vw-table tr:nth-child(even) td{background:rgba(255,255,255,.025)}
  #dsViewer .vw-rownum{color:var(--muted,#8990b8);text-align:right}
  #dsViewer .vw-tabs{display:flex;gap:.25em;padding:.3em .5em;overflow-x:auto;border-bottom:1px solid var(--edge,rgba(160,170,255,.14))}
  #dsViewer .vw-slide{max-width:56em;margin:1em auto;padding:1.4em 1.8em;border-radius:.8em;background:rgba(255,255,255,.05);border:1px solid rgba(170,180,255,.2);aspect-ratio:16/9;overflow:auto}
  #dsViewer .vw-slide h2{margin:.1em 0 .5em;font-weight:500}
  #dsViewer .vw-slide .pics{display:flex;flex-wrap:wrap;gap:.6em;margin-top:.8em}#dsViewer .vw-slide .pics img{max-width:45%;max-height:14em;border-radius:.4em;background:#fff}
  #dsViewer .vw-slide .notes{margin-top:1em;color:var(--muted,#a4abcc);font-size:.88em;white-space:pre-wrap}
  #dsViewer .vw-card{max-width:30em;margin:3em auto;text-align:center;padding:1.5em;border-radius:1em;background:rgba(255,255,255,.04);border:1px solid rgba(170,180,255,.2)}
  #dsViewer .vw-card .big{font-size:3.5em}#dsViewer .vw-card .acts{display:flex;flex-wrap:wrap;gap:.5em;justify-content:center;margin-top:1em}
  #dsViewer .vw-zip td button{background:none;border:0;color:#9fb0ff;cursor:pointer;text-align:left;padding:0}
  #dsViewer .vw-msg{padding:2em;text-align:center;color:var(--muted,#a4abcc)}
  #dsViewer .vw-ask{position:absolute;inset:0;z-index:5;display:grid;place-items:center;background:rgba(4,5,14,.6)}
  #dsViewer .vw-ask>div{max-width:26em;margin:1em;padding:1.1em 1.2em;border-radius:.9em;background:#171a3c;border:1px solid rgba(255,140,140,.45);box-shadow:0 20px 60px rgba(0,0,0,.6)}
  #dsViewer .vw-ask .acts{display:flex;gap:.5em;justify-content:flex-end;margin-top:.9em;flex-wrap:wrap}
  #dsViewer .vw-menu{position:absolute;z-index:6;right:.5em;top:3em;display:flex;flex-direction:column;gap:.2em;padding:.35em;border-radius:.7em;background:#171a3c;border:1px solid var(--edge2,rgba(170,180,255,.3));box-shadow:0 16px 50px rgba(0,0,0,.6);max-height:70%;overflow:auto}
  #dsViewer .vw-menu[hidden]{display:none}#dsViewer .vw-menu .vb{text-align:left}
  #dsFinder{box-sizing:border-box;position:fixed;z-index:47;display:flex;flex-direction:column;border-radius:1.1em;background:rgba(14,17,42,.97);backdrop-filter:blur(18px);border:1px solid var(--edge2,rgba(170,180,255,.28));box-shadow:0 30px 90px rgba(0,0,0,.6);color:var(--ink,#eef0ff);
    right:calc(var(--safe-right,0px) + 1em);top:calc(var(--safe-top,0px) + 1em);width:min(36em,calc(var(--safe-w,100vw) - 2em));max-height:calc(var(--safe-h,100vh) - 2em)}
  #dsFinder header{display:flex;gap:.4em;align-items:center;padding:.6em .7em;border-bottom:1px solid var(--edge,rgba(160,170,255,.14));flex-wrap:wrap}
  #dsFinder header h2{margin:0;font-weight:500;font-size:1.02em;flex:1 1 8em;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #dsFinder form{display:flex;gap:.35em;padding:.5em .7em;flex-wrap:wrap}#dsFinder form input{flex:1 1 10em;min-width:6em}
  #dsFinder ol{list-style:none;margin:0;padding:.2em .6em .7em;overflow:auto;display:flex;flex-direction:column;gap:.3em}
  #dsFinder li{display:grid;grid-template-columns:1.6em 3.2em 1fr;gap:.55em;align-items:center;padding:.4em .5em;border-radius:.7em;background:rgba(255,255,255,.035);cursor:pointer}
  #dsFinder li:hover,#dsFinder li:focus-visible{background:rgba(124,140,255,.2);outline:none}
  #dsFinder li .n{color:var(--muted,#a4abcc);text-align:right;font-variant-numeric:tabular-nums}
  #dsFinder li .th{width:3.2em;height:2.4em;border-radius:.4em;background:rgba(255,255,255,.06);display:grid;place-items:center;overflow:hidden;font-size:1.2em}
  #dsFinder li .th img{width:100%;height:100%;object-fit:cover}
  #dsFinder li b{display:block;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #dsFinder li span.meta{display:block;color:var(--muted,#a4abcc);font-size:.8em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #dsFinder .drive{color:#ffd27a}
  #dsFinder .empty{padding:1em;color:var(--muted,#a4abcc)}
  #dsViewer .vw-foot{flex-wrap:wrap}
  #dsViewer .vw-loc{display:flex;gap:.3em;align-items:center;flex-wrap:wrap;min-width:0;max-width:100%;color:var(--ink,#eef0ff)}
  #dsViewer .vw-loc .crumb{background:none;border:0;color:#9fb0ff;cursor:pointer;text-decoration:underline;padding:.1em .2em;min-height:1.8em;font:inherit}
  #dsViewer .vw-strip{flex:0 0 76px;overflow-x:auto;overflow-y:hidden;position:relative;border-top:1px solid var(--edge,rgba(160,170,255,.14));scrollbar-width:thin;cursor:grab;touch-action:pan-x}
  #dsViewer .vw-strip .sp{position:relative;height:100%}
  #dsViewer .vw-strip button{position:absolute;top:5px;width:76px;height:62px;padding:0;border:2px solid transparent;border-radius:.4em;overflow:hidden;background:rgba(255,255,255,.06);cursor:pointer}
  #dsViewer .vw-strip button img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}
  #dsViewer .vw-strip button.on{border-color:#ffd84a}
  html.mini #dsViewer .vw-side{flex-basis:90px}html.mini #dsViewer .vw-info{position:absolute;right:0;top:0;bottom:0;background:#12153a;z-index:3;width:min(260px,80%)}`;
  document.head.appendChild(css);

  // ---------------------------------------------------------------------------------------------------- the window
  const V = { open: false, item: null, info: null, list: null, index: 0, entry: null, zipBack: null, kind: null, full: false, pos: null, cleanup: [], ctl: {}, reportT: 0, seq: 0 };
  let root, bar, tools, side, stage, info, foot, menu;
  function build() {
    root = document.createElement("section"); root.id = "dsViewer"; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "File viewer"); root.hidden = true; root.tabIndex = -1;
    root.innerHTML = `
      <header class="vw-bar"><span class="vw-title"><b>File</b><small></small></span>
        <div class="vw-win">
          <button type="button" class="vb" data-a="prev" title="Previous (←)" aria-label="Previous file">◀</button>
          <button type="button" class="vb" data-a="next" title="Next (→)" aria-label="Next file">▶</button>
          <button type="button" class="vb" data-a="info" title="Info (I)" aria-label="Show information" aria-pressed="false">ℹ</button>
          <button type="button" class="vb" data-a="menu" title="More" aria-label="More actions" aria-haspopup="true">⋯</button>
          <button type="button" class="vb" data-a="full" title="Full screen (F)" aria-label="Full screen" aria-pressed="false">⛶</button>
          <button type="button" class="vb vw-x" data-a="close" title="Close (Esc)" aria-label="Close the viewer">✕</button>
        </div></header>
      <div class="vw-tools" role="toolbar" aria-label="Controls"></div>
      <div class="vw-body"><aside class="vw-side" hidden aria-label="Pages"></aside><div class="vw-stage" tabindex="0"></div><aside class="vw-info" hidden aria-label="Information"></aside>
        <div class="vw-menu" hidden role="menu"></div></div>
      <footer class="vw-foot"><span class="st" aria-live="polite"></span></footer>
      <div class="vw-grip" aria-hidden="true"></div>`;
    document.body.appendChild(root);
    bar = $(".vw-bar", root); tools = $(".vw-tools", root); side = $(".vw-side", root); stage = $(".vw-stage", root); info = $(".vw-info", root); foot = $(".vw-foot", root); menu = $(".vw-menu", root);
    bar.addEventListener("click", (e) => { const b = e.target.closest("[data-a]"); if (!b) return; const a = b.dataset.a;
      if (a === "prev") step(-1); else if (a === "next") step(1); else if (a === "info") toggleInfo(); else if (a === "menu") toggleMenu(); else if (a === "full") setFull(!V.full); else if (a === "close") close(); });
    menu.addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (!b) return; menu.hidden = true; action(b.dataset.m); });
    dragging();
    root.addEventListener("keydown", onKey);
    root.addEventListener("click", (e) => { if (!menu.hidden && !e.target.closest(".vw-menu, [data-a=menu]")) menu.hidden = true; const a = e.target.closest(".vw-doc a[href]"); if (a) { e.preventDefault(); toast("A link in the file", a.getAttribute("href")); } });
    addEventListener("resize", clamp);
    new MutationObserver(clamp).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !V.open || (e.dsTop && e.dsTop !== root)) return;
      e.stopImmediatePropagation(); e.preventDefault();
      if ($(".vw-ask", root)) { $(".vw-ask", root).remove(); return; }
      if (!menu.hidden) { menu.hidden = true; return; }
      if (V.entry && V.zipBack) { V.zipBack(); return; }
      close();
    }, true);
  }
  function safe() { const r = window.dsSafeRect?.(); return r && r.width > 0 ? r : { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight }; }
  // inside the screen's margins: full fills them; a floating window keeps its size and place, pulled back inside
  function clamp() {
    if (!root || root.hidden) return;
    const S = safe(), g = window.dsSafeRect ? 10 : 0;
    if (V.full) { Object.assign(root.style, { left: S.left + "px", top: S.top + "px", width: S.width + "px", height: S.height + "px" }); return; }
    const p = V.pos ?? { w: Math.min(1100, S.width * 0.9), h: Math.min(780, S.height * 0.88), x: null, y: null };
    const w = Math.max(Math.min(280, S.width - 2 * g), Math.min(p.w, S.width - 2 * g)), h = Math.max(Math.min(240, S.height - 2 * g), Math.min(p.h, S.height - 2 * g));
    const x = p.x == null ? S.left + (S.width - w) / 2 : Math.max(S.left + g, Math.min(p.x, S.right - g - w)), y = p.y == null ? S.top + (S.height - h) / 2 : Math.max(S.top + g, Math.min(p.y, S.bottom - g - h));
    Object.assign(root.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
  }
  function dragging() {
    const start = (e, mode) => {
      if (e.button !== 0 || V.full || (mode === "move" && e.target.closest("button, input, select"))) return;
      const r = root.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY, base = { x: r.left, y: r.top, w: r.width, h: r.height };
      e.preventDefault();
      const mv = (ev) => { const dx = ev.clientX - x0, dy = ev.clientY - y0; V.pos = mode === "move" ? { ...base, x: base.x + dx, y: base.y + dy } : { ...base, w: Math.max(280, base.w + dx), h: Math.max(240, base.h + dy) }; clamp(); };
      const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); V.ctl.fit?.(); };
      addEventListener("pointermove", mv); addEventListener("pointerup", up);
    };
    bar.addEventListener("pointerdown", (e) => start(e, "move"));
    $(".vw-grip", root).addEventListener("pointerdown", (e) => start(e, "size"));
    bar.addEventListener("dblclick", (e) => { if (!e.target.closest("button")) setFull(!V.full); });
  }
  function setFull(on) {
    // (a small window of the window manager goes back to normal first: it would keep pulling the viewer back to its place)
    if (on && window.winman?.get?.("viewer")?.mode === "small") window.winman.setMode("viewer", "normal");
    V.full = Boolean(on); root.classList.toggle("full", V.full); $("[data-a=full]", root).setAttribute("aria-pressed", String(V.full)); clamp(); setTimeout(() => V.ctl.refit?.(), 30); }
  const status = (t) => { $(".st", foot).textContent = t ?? ""; };
  function report(now = false) {
    clearTimeout(V.reportT);
    V.reportT = setTimeout(() => api("/viewer/state", V.open && V.item ? { open: true, id: V.item.id, kind: V.kind, page: V.ctl.page?.() ?? null, pages: V.ctl.pages?.() ?? null } : { open: false }).catch(() => {}), now ? 0 : 400);
  }

  // ---------------------------------------------------------------------------------------------------- opening
  function teardown() {
    for (const f of V.cleanup.splice(0)) { try { f(); } catch { /* gone */ } }
    V.ctl = {}; stopSpeaking();
    stage.innerHTML = ""; tools.innerHTML = ""; side.innerHTML = ""; side.hidden = true; menu.hidden = true;
    $$(".vw-foot > :not(.st)", root).forEach((x) => x.remove());
    stage.onscroll = null;
  }
  async function open(o = {}) {
    if (!root) build();
    const it = o.item ?? o;
    if (!it?.id) return false;
    const seq = ++V.seq;
    V.open = true; root.hidden = false;
    if (o.list !== undefined) { V.list = Array.isArray(o.list) && o.list.length > 1 ? o.list : null; V.index = Math.max(0, Number(o.index) || 0); }
    V.item = it; V.entry = null; V.zipBack = null; V.info = null;
    teardown();
    clamp();
    const title = $(".vw-title", root);
    title.querySelector("b").textContent = it.name ?? "File";
    title.querySelector("small").textContent = [it.type, it.sizeText, it.when, it.where ? (it.source === "drive" ? `☁ ${it.where}` : it.where) : ""].filter(Boolean).join(" · ");
    root.setAttribute("aria-label", `File viewer: ${it.name ?? "file"}`);
    V.kind = it.kind ?? kindOfName(it.name);
    paintMenu();
    // ◀ ▶: the results it came from, else the files next to it in its folder
    if (!V.list && it.source !== "drive") api(`/viewer/siblings?id=${encodeURIComponent(it.id)}`).then((s) => { if (seq === V.seq && s.ids?.length > 1) { V.list = s.ids; V.index = Math.max(0, s.index); navButtons(); if (V.kind === "image") filmstrip(); } }).catch(() => {});
    navButtons();
    try { await show(it, V.kind, null, seq); }
    catch (e) { if (seq === V.seq) { stage.innerHTML = `<div class="vw-msg">${esc(e.message)}</div>`; card(it); } }
    if (!info.hidden) paintInfo();
    stage.focus({ preventScroll: true });
    report();
    return true;
  }
  function navButtons() { const n = V.list?.length ?? 0; $("[data-a=prev]", root).disabled = n < 2; $("[data-a=next]", root).disabled = n < 2; }
  async function step(d) {
    if (!V.list || V.list.length < 2) return "There's no other file here.";
    V.index = (V.index + d + V.list.length) % V.list.length;
    const id = V.list[V.index];
    try { const r = await api(`/viewer/info?id=${encodeURIComponent(id)}`); await open({ item: { ...r, when: r.modified ? new Date(r.modified).toLocaleDateString() : "" }, list: V.list, index: V.index }); }
    catch (e) { toast("Viewer", e.message); }
    return "";
  }
  function close() {
    if (!root || !V.open) return;
    V.open = false; teardown(); root.hidden = true; V.item = null; report(true);
  }
  const btn = (label, a, title, extra = "") => `<button type="button" class="vb" data-t="${a}" title="${esc(title)}" aria-label="${esc(title)}" ${extra}>${label}</button>`;
  function onTools(map) { tools.onclick = (e) => { const b = e.target.closest("[data-t]"); if (b && map[b.dataset.t]) map[b.dataset.t](b, e); }; }

  // the kind decides the view
  async function show(it, kind, entry, seq) {
    const src = fileUrl(it.id, entry);
    if (it.source === "drive" && !["image", "video", "audio"].includes(kind)) return card(it);
    if (kind === "image") return showImage(it, src, entry);
    if (kind === "video" || kind === "audio") return showMedia(it, src, kind, entry);
    if (kind === "pdf") return showPdf(it, src, seq);
    if (kind === "text" || kind === "code" || kind === "markdown") return showText(it, kind, entry, seq);
    if (kind === "csv" || kind === "sheet") return showSheet(it, kind, entry, seq);
    if (kind === "docx" || (kind === "doc" && !entry)) return showDoc(it, entry, seq);
    if (kind === "slides" && !entry) return showSlides(it, seq);
    if (kind === "zip" && !entry) return showZip(it, seq);
    return card(it, entry);
  }

  // ---------------------------------------------------------------------------------------------------- pictures
  function showImage(it, src, entry) {
    const ext = String(entry ?? it.name).split(".").pop().toLowerCase();
    const url = /^(heic|heif|tif|tiff)$/.test(ext) && !entry ? src + "&as=jpeg" : src;
    stage.innerHTML = `<div class="vw-img" tabindex="-1"><img alt="${esc(it.name)}" draggable="false"></div>`;
    const wrap = $(".vw-img", stage), img = $("img", wrap);
    const T = { z: 1, fit: 1, x: 0, y: 0, rot: 0, fx: 1, fy: 1, auto: true };
    const apply = () => { img.style.transform = `translate(calc(-50% + ${T.x}px), calc(-50% + ${T.y}px)) rotate(${T.rot}deg) scale(${T.z * T.fx}, ${T.z * T.fy})`; const l = $("[data-lbl=z]", tools); if (l) l.textContent = Math.round(T.z * 100) + "%"; };
    const fitScale = () => { const W = wrap.clientWidth, H = wrap.clientHeight, w = img.naturalWidth || 1, h = img.naturalHeight || 1, turned = T.rot % 180 !== 0; return Math.min(1, Math.min(W / (turned ? h : w), H / (turned ? w : h))) || 1; };
    const fit = () => { T.fit = fitScale(); T.z = T.fit; T.x = T.y = 0; T.auto = true; apply(); };
    const zoomAt = (f, cx = 0, cy = 0) => { const z = Math.max(0.05, Math.min(16, T.z * f)); const k = z / T.z; T.x = cx - (cx - T.x) * k; T.y = cy - (cy - T.y) * k; T.z = z; T.auto = false; apply(); };
    const center = (e) => { const r = wrap.getBoundingClientRect(); return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]; };
    img.onload = () => { fit(); status(`${img.naturalWidth} × ${img.naturalHeight} pixels`); };
    img.onerror = async () => { let msg = "This picture can't be shown here."; try { const r = await fetch(url); const j = await r.json(); msg = j.error || msg; } catch { /* keep */ } stage.innerHTML = `<div class="vw-msg">${esc(msg)}</div>`; card(it); };
    img.src = url;
    wrap.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, ...center(e)); }, { passive: false });
    const pts = new Map(); let pinch = null, pan = null;
    wrap.addEventListener("pointerdown", (e) => { wrap.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: T.z }; pan = null; } else { pan = { x: e.clientX, y: e.clientY, tx: T.x, ty: T.y }; wrap.classList.add("panning"); } });
    wrap.addEventListener("pointermove", (e) => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); T.z = Math.max(0.05, Math.min(16, pinch.z * d / pinch.d)); T.auto = false; apply(); }
      else if (pan) { T.x = pan.tx + e.clientX - pan.x; T.y = pan.ty + e.clientY - pan.y; apply(); } });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) { pan = null; wrap.classList.remove("panning"); } };
    wrap.addEventListener("pointerup", up); wrap.addEventListener("pointercancel", up);
    wrap.addEventListener("dblclick", (e) => { if (Math.abs(T.z - T.fit) < 0.01) { const [cx, cy] = center(e); zoomAt(1 / T.z, cx, cy); } else fit(); });
    // the slideshow
    let slide = 0, every = Number(localStorage.getItem?.("dsViewer.every")) || 5;
    const slideshow = (on = !slide) => { clearInterval(slide); slide = 0; const b = $("[data-t=show]", tools); if (on) { slide = setInterval(() => step(1).then(() => {}), every * 1000); } if (b) { b.setAttribute("aria-pressed", String(Boolean(slide))); b.textContent = slide ? "⏸ Slideshow" : "▶ Slideshow"; } return slide ? `Slideshow, every ${every} seconds.` : "Slideshow stopped."; };
    tools.innerHTML = [btn("−", "out", "Zoom out (−)"), `<span class="lbl" data-lbl="z">100%</span>`, btn("+", "in", "Zoom in (+)"), btn("Fit", "fit", "Fit to the window (0)"), btn("100%", "one", "Actual size (1)"), `<span class="sep"></span>`,
      btn("⟲", "rotl", "Rotate left (Shift+R)"), btn("⟳", "rotr", "Rotate right (R)"), btn("⇋", "fliph", "Flip left to right (H)"), btn("⇅", "flipv", "Flip upside down (V)"), `<span class="sep"></span>`,
      btn("▶ Slideshow", "show", "Slideshow (S)", `aria-pressed="false"`), `<select data-t="every" aria-label="Seconds between pictures">${[3, 5, 10, 20, 30].map((s) => `<option value="${s}"${s === every ? " selected" : ""}>${s} s</option>`).join("")}</select>`].join("");
    $("select[data-t=every]", tools).onchange = (e) => { every = Number(e.target.value) || 5; try { localStorage.setItem("dsViewer.every", String(every)); } catch { /* fine */ } if (slide) slideshow(true); };
    const rotate = (d) => { T.rot = (T.rot + 90 * d + 360) % 360; if (T.auto) fit(); else apply(); };
    onTools({ out: () => zoomAt(1 / 1.25), in: () => zoomAt(1.25), fit, one: () => { T.z = 1; T.x = T.y = 0; T.auto = false; apply(); }, rotl: () => rotate(-1), rotr: () => rotate(1), fliph: () => { T.fx *= -1; apply(); }, flipv: () => { T.fy *= -1; apply(); }, show: () => slideshow() });
    const ro = new ResizeObserver(() => { if (T.auto) fit(); }); ro.observe(wrap); V.cleanup.push(() => ro.disconnect());
    V.cleanup.push(() => clearInterval(slide));
    if (!entry && it.source !== "drive") { showWhere(it); filmstrip(); }
    V.ctl = { zoomIn: () => zoomAt(1.25), zoomOut: () => zoomAt(1 / 1.25), fit, refit: () => { if (T.auto) fit(); }, actual: () => { T.z = 1; T.x = T.y = 0; apply(); }, rotate: (d = 1) => rotate(d), flip: () => { T.fx *= -1; apply(); }, flipV: () => { T.fy *= -1; apply(); }, slideshow: (on) => slideshow(on ?? !slide),
      state: () => ({ zoom: T.z, fit: T.fit, rot: T.rot, fx: T.fx, fy: T.fy, x: T.x, y: T.y, slideshow: Boolean(slide), every, natural: [img.naturalWidth, img.naturalHeight] }) };
  }

  // where a picture is saved, always in view: Pictures › Family › 2026 (each part opens the photo gallery there),
  // 📂 Open file location (File Explorer with it selected) and 🖼 View in gallery (public/gallery.js, lib/gallery)
  function showWhere(it) {
    const acts = window.dsGallery?.actionsHtml?.(it.id) ?? "";
    if (!acts) return;
    const el = document.createElement("span"); el.className = "vw-loc"; el.setAttribute("aria-label", "Where it's saved");
    el.innerHTML = `<span class="crumbs" aria-hidden="false"></span>${acts}`;
    foot.appendChild(el);
    const seq = V.seq;
    api(`/gallery/item?id=${encodeURIComponent(it.id)}`).then((r) => {
      if (seq !== V.seq || !r.crumbs) return;
      $(".crumbs", el).innerHTML = "📂 " + r.crumbs.map((c, k) => `${k ? " › " : ""}<button type="button" class="crumb" data-fid="${esc(c.fid)}" data-last="${c.last ? 1 : 0}" title="Show the photos in ${esc(c.label)}">${esc(c.label)}</button>`).join("");
      $(".crumbs", el).title = r.path ?? "";
    }).catch(() => {});
    el.addEventListener("click", (e) => { const c = e.target.closest("[data-fid]"); if (!c) return; e.stopPropagation(); close(); window.dsGallery?.open?.({ view: "folder", fid: c.dataset.fid, deep: c.dataset.last !== "1", group: "none" }); });
  }
  // a filmstrip of the pictures around it (the folder, or the results it came from): scroll sideways, click one
  function filmstrip() {
    $(".vw-strip", root)?.remove();
    if (V.kind !== "image" || !V.list || V.list.length < 2) return;
    const W = 82, s = document.createElement("div"); s.className = "vw-strip"; s.setAttribute("aria-label", "More pictures: scroll sideways");
    s.innerHTML = `<div class="sp" style="width:${V.list.length * W + 8}px"></div>`;
    root.insertBefore(s, foot);
    const sp = s.firstChild;
    const paint = () => { const L = s.scrollLeft, w = s.clientWidth || 800, a = Math.max(0, Math.floor((L - w) / W)), b = Math.min(V.list.length - 1, Math.ceil((L + 2 * w) / W)); let h = ""; for (let k = a; k <= b; k++) h += `<button type="button" data-k="${k}" class="${k === V.index ? "on" : ""}" style="left:${k * W + 4}px" aria-label="Picture ${k + 1} of ${V.list.length}"><img alt="" decoding="async" src="/api/viewer/thumb?id=${encodeURIComponent(V.list[k])}" onerror="this.remove()"></button>`; sp.innerHTML = h; };
    s.scrollLeft = Math.max(0, V.index * W + W / 2 - (s.clientWidth || 800) / 2); paint();
    s.addEventListener("scroll", () => requestAnimationFrame(paint));
    s.addEventListener("wheel", (e) => { e.preventDefault(); s.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; }, { passive: false });
    let drag = null, dragged = 0;
    s.addEventListener("pointerdown", (e) => { if (e.button === 0 && e.pointerType !== "touch") drag = { x: e.clientX, l: s.scrollLeft, moved: false }; });
    const mv = (e) => { if (!drag) return; const dx = e.clientX - drag.x; if (Math.abs(dx) > 5) drag.moved = true; if (drag.moved) s.scrollLeft = drag.l - dx; };
    const up = () => { if (drag?.moved) dragged = Date.now(); drag = null; };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
    s.addEventListener("click", (e) => { if (Date.now() - dragged < 250) return; const b = e.target.closest("[data-k]"); if (!b) return; V.index = Number(b.dataset.k); step(0); });
    V.cleanup.push(() => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); s.remove(); });
  }

  // ---------------------------------------------------------------------------------------------------- video and audio
  function showMedia(it, src, kind, entry) {
    const ext = String(entry ?? it.name).split(".").pop().toLowerCase();
    const convertFirst = /^(wma|wmv|avi|mpg|mpeg)$/.test(ext) && !entry && it.source !== "drive";
    const base = it.source === "drive" ? `/api/drive/stream?ref=${encodeURIComponent(it.ref)}` : src;
    stage.innerHTML = `<div class="vw-media">${kind === "video" ? `<video playsinline preload="metadata"></video>` : `<div class="aud"><div><b>♪</b>${esc(it.title || it.name)}<br><small>${esc([it.artist, it.album].filter(Boolean).join(" · "))}</small></div></div><audio preload="metadata"></audio>`}
      <div class="vw-mctl">
        ${btn("⏯", "play", "Play or pause (Space)")}${btn("↺10", "back", "Back 10 seconds (←)")}${btn("10↻", "fwd", "Forward 10 seconds (→)")}
        <span class="lbl" data-lbl="t">0:00</span><input class="seek" type="range" min="0" max="1000" value="0" step="1" aria-label="Position"><span class="lbl" data-lbl="d">0:00</span>
        <select data-t="speed" aria-label="Speed">${[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((s) => `<option value="${s}"${s === 1 ? " selected" : ""}>${s}×</option>`).join("")}</select>
        ${btn("🔊", "mute", "Mute")}<input class="vol" type="range" min="0" max="100" value="100" aria-label="Volume">
        ${btn("CC", "cc", "Captions", `aria-pressed="false" hidden`)}${btn("🔁", "loop", "Loop", `aria-pressed="false"`)}
        ${kind === "video" ? btn("⧉", "pip", "Picture in picture") + btn("⛶", "vfull", "Full screen video") : ""}
      </div></div>`;
    const el = $(kind === "video" ? "video" : "audio", stage), bar2 = $(".vw-mctl", stage), seek = $(".seek", bar2);
    let offset = 0, converted = convertFirst, dragging = false;
    const dur = () => (Number.isFinite(el.duration) && el.duration > 0 ? el.duration + offset : Number(it.duration) || 0);
    const setSrc = (t = 0) => { offset = converted ? t : 0; el.src = converted ? `${base}&convert=1${t ? `&t=${Math.floor(t)}` : ""}` : base; };
    setSrc(0);
    el.volume = 1;
    el.addEventListener("error", () => { if (!converted && it.source !== "drive" && !entry) { converted = true; const was = el.currentTime; setSrc(was); el.play().catch(() => {}); status("Converting it as it plays…"); } else status("This can't play here. “Open in the default app” should play it."); });
    el.addEventListener("timeupdate", () => { const t = el.currentTime + offset; $("[data-lbl=t]", bar2).textContent = mmss(t); if (!dragging && dur()) seek.value = String(Math.round(t / dur() * 1000)); });
    el.addEventListener("loadedmetadata", () => { $("[data-lbl=d]", bar2).textContent = mmss(dur()); });
    el.addEventListener("play", () => report()); el.addEventListener("pause", () => report());
    seek.addEventListener("input", () => { dragging = true; }); seek.addEventListener("change", () => { dragging = false; seekTo(Number(seek.value) / 1000 * dur()); });
    const seekTo = (t) => { t = Math.max(0, dur() ? Math.min(dur() - 0.5, t) : t); if (converted) { const was = !el.paused; setSrc(t); if (was) el.play().catch(() => {}); } else el.currentTime = t; $("[data-lbl=t]", bar2).textContent = mmss(t); };
    const cur = () => el.currentTime + offset;
    // captions next to the file
    if (it.captions?.length) addCaptions(it.captions); else if (!entry && it.source !== "drive") api(`/viewer/info?id=${encodeURIComponent(it.id)}`).then((r) => { V.info = r; if (r.captions?.length) addCaptions(r.captions); }).catch(() => {});
    function addCaptions(list) {
      for (const c of list) { const tr = document.createElement("track"); tr.kind = "subtitles"; tr.label = c.label; tr.src = `/api/viewer/captions?id=${encodeURIComponent(it.id)}&n=${c.n}`; tr.srclang = /^[A-Z]{2}$/.test(c.label) ? c.label.toLowerCase() : "en"; el.appendChild(tr); }
      const b = $("[data-t=cc]", bar2); b.hidden = false;
    }
    const cc = (on) => { const tracks = [...el.textTracks]; if (!tracks.length) return "There are no captions for this one."; const show = on ?? !tracks.some((t) => t.mode === "showing"); tracks.forEach((t, i) => { t.mode = show && i === 0 ? "showing" : "hidden"; }); $("[data-t=cc]", bar2).setAttribute("aria-pressed", String(show)); return ""; };
    const map = {
      play: () => (el.paused ? el.play().catch(() => {}) : el.pause()), back: () => seekTo(cur() - 10), fwd: () => seekTo(cur() + 10),
      mute: (b) => { el.muted = !el.muted; b.textContent = el.muted ? "🔇" : "🔊"; }, cc: () => cc(), loop: (b) => { el.loop = !el.loop; b.setAttribute("aria-pressed", String(el.loop)); },
      pip: async () => { try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await el.requestPictureInPicture(); } catch { status("Picture-in-picture isn't available here."); } },
      // (the viewer fills the screen's safe area with the video in it, its controls still there: never the whole TV)
      vfull: () => setFull(!V.full),
    };
    bar2.addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b && map[b.dataset.t]) map[b.dataset.t](b); });
    $("select[data-t=speed]", bar2).onchange = (e) => { el.playbackRate = Number(e.target.value) || 1; };
    $(".vol", bar2).oninput = (e) => { el.volume = Number(e.target.value) / 100; };
    if (kind === "video") el.addEventListener("click", () => map.play());
    el.play().catch(() => {});
    V.cleanup.push(() => { try { el.pause(); el.removeAttribute("src"); el.load(); } catch { /* gone */ } if (document.pictureInPictureElement === el) document.exitPictureInPicture?.().catch(() => {}); });
    V.ctl = { toggle: map.play, pause: () => el.pause(), play: () => el.play().catch(() => {}), seek: seekTo, seekBy: (d) => seekTo(cur() + d), speed: (r) => { el.playbackRate = r; $("select[data-t=speed]", bar2).value = String(r); }, captions: cc, loop: () => map.loop($("[data-t=loop]", bar2)),
      volume: (v) => { el.volume = Math.max(0, Math.min(1, v)); $(".vol", bar2).value = String(Math.round(el.volume * 100)); }, el: () => el, state: () => ({ time: cur(), paused: el.paused, rate: el.playbackRate, loop: el.loop, volume: el.volume, muted: el.muted, converted, duration: dur(), tracks: el.textTracks.length }) };
  }

  // ---------------------------------------------------------------------------------------------------- PDF
  let pdfjsP = null;
  const pdfjs = () => (pdfjsP ??= import("/vendor/pdfjs/pdf.min.mjs").then((m) => { m.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs"; return m; }));
  async function showPdf(it, src, seq) {
    stage.innerHTML = `<div class="vw-msg">Opening the PDF…</div>`;
    const lib = await pdfjs();
    const task = lib.getDocument({ url: src, cMapUrl: "/vendor/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/vendor/pdfjs/standard_fonts/", wasmUrl: "/vendor/pdfjs/wasm/", iccUrl: "/vendor/pdfjs/iccs/", isEvalSupported: false, enableXfa: false });
    V.cleanup.push(() => task.destroy());
    let doc;
    try { doc = await task.promise; } catch (e) { if (/password/i.test(e.name + e.message)) throw new Error("This PDF has a password, so it can't be opened here. “Open in the default app” asks for it."); throw new Error(`This PDF couldn't be opened here (${e.message}).`); }
    if (seq !== V.seq) return;
    const N = doc.numPages, P = { scale: 1, mode: "width", rot: 0, cur: 1, texts: new Map(), hits: [], hi: -1, term: "", reading: false };
    const first = await doc.getPage(1);
    const base = first.getViewport({ scale: 1 });
    stage.innerHTML = `<div class="vw-pages">${Array.from({ length: N }, (_, i) => `<div class="vw-page" data-p="${i + 1}"></div>`).join("")}</div>`;
    const pagesEl = $(".vw-pages", stage);
    const vpOf = (page, scale) => page.getViewport({ scale, rotation: (page.rotate + P.rot) % 360 });
    const size0 = (scale) => { const turned = P.rot % 180 !== 0; return { w: (turned ? base.height : base.width) * scale, h: (turned ? base.width : base.height) * scale }; };
    const scaleFor = (mode) => { const W = stage.clientWidth - 40, H = stage.clientHeight - 32, s = size0(1); return mode === "page" ? Math.min(W / s.w, H / s.h) : W / s.w; };
    const rendered = new Map();   // page → scale|rot it was drawn at
    const renderPage = async (n) => {
      const key = `${P.scale.toFixed(3)}|${P.rot}`;
      if (rendered.get(n) === key) return; rendered.set(n, key);
      const page = await doc.getPage(n), vp = vpOf(page, P.scale), box = $(`.vw-page[data-p="${n}"]`, pagesEl); if (!box) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const c = document.createElement("canvas"); c.width = Math.floor(vp.width * ratio); c.height = Math.floor(vp.height * ratio);
      box.style.width = vp.width + "px"; box.style.height = vp.height + "px";
      try { await page.render({ canvasContext: c.getContext("2d"), viewport: vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null }).promise; } catch { rendered.delete(n); return; }
      if (rendered.get(n) !== key) return;
      const tl = document.createElement("div"); tl.className = "textLayer";
      box.replaceChildren(c, tl);
      box.style.setProperty("--scale-factor", String(vp.scale)); box.style.setProperty("--total-scale-factor", String(vp.scale));
      try { const content = await textOf(n, page); await new lib.TextLayer({ textContentSource: content.raw, container: tl, viewport: vp }).render(); markHits(n); } catch { /* the picture of the page is there */ }
    };
    const textOf = async (n, pg = null) => { if (P.texts.has(n)) return P.texts.get(n); const page = pg ?? await doc.getPage(n); const raw = await page.getTextContent(); const t = { raw, text: raw.items.map((x) => x.str + (x.hasEOL ? "\n" : "")).join("").replace(/[ \t]+\n/g, "\n") }; P.texts.set(n, t); return t; };
    const layout = () => { const s = size0(P.scale); for (const box of $$(".vw-page", pagesEl)) { if (!box.querySelector("canvas") || rendered.get(Number(box.dataset.p)) !== `${P.scale.toFixed(3)}|${P.rot}`) { box.style.width = s.w + "px"; box.style.height = s.h + "px"; } } visible(); };
    const io = new IntersectionObserver((ents) => { for (const e of ents) if (e.isIntersecting) renderPage(Number(e.target.dataset.p)); }, { root: stage, rootMargin: "600px 0px" });
    $$(".vw-page", pagesEl).forEach((b) => io.observe(b));
    V.cleanup.push(() => io.disconnect());
    const visible = () => { for (const b of $$(".vw-page", pagesEl)) { const r = b.getBoundingClientRect(), s = stage.getBoundingClientRect(); if (r.bottom > s.top - 600 && r.top < s.bottom + 600) renderPage(Number(b.dataset.p)); } };
    const setScale = (s, mode = null) => { const was = P.cur; P.scale = Math.max(0.2, Math.min(6, s)); P.mode = mode; const zl = $("[data-lbl=z]", tools); if (zl) zl.textContent = Math.round(P.scale * 100) + "%"; layout(); goPage(was, false); };
    const fitMode = (mode) => setScale(scaleFor(mode), mode);
    const goPage = (n, smooth = true) => { n = Math.max(1, Math.min(N, Number(n) || 1)); P.lock = Date.now() + 900; const b = $(`.vw-page[data-p="${n}"]`, pagesEl); if (b) stage.scrollTo({ top: b.offsetTop - 12, behavior: smooth ? "smooth" : "auto" }); setCur(n); renderPage(n); return ""; };
    const setCur = (n) => { if (P.cur === n && $("[data-t=pg]", tools)?.value === String(n)) return; P.cur = n; const inp = $("input[data-t=pg]", tools); if (inp && document.activeElement !== inp) inp.value = String(n); status(`Page ${n} of ${N}`); $$(".vw-thumb", side).forEach((t) => t.classList.toggle("on", Number(t.dataset.p) === n)); $(`.vw-thumb[data-p="${n}"]`, side)?.scrollIntoView({ block: "nearest" }); report(); };
    stage.onscroll = () => { if (Date.now() < (P.lock ?? 0)) return; const s = stage.getBoundingClientRect(); let best = 1, bd = Infinity; for (const b of $$(".vw-page", pagesEl)) { const d = Math.abs(b.getBoundingClientRect().top - s.top - 12); if (d < bd) { bd = d; best = Number(b.dataset.p); } } setCur(best); };
    // thumbnails
    side.hidden = false;
    side.innerHTML = Array.from({ length: N }, (_, i) => `<button type="button" class="vw-thumb" data-p="${i + 1}" aria-label="Page ${i + 1}"><span class="ph"></span>${i + 1}</button>`).join("");
    side.onclick = (e) => { const t = e.target.closest(".vw-thumb"); if (t) goPage(Number(t.dataset.p)); };
    const tio = new IntersectionObserver(async (ents) => { for (const e of ents) { if (!e.isIntersecting || e.target.dataset.done) continue; e.target.dataset.done = "1"; tio.unobserve(e.target); const n = Number(e.target.dataset.p); const page = await doc.getPage(n); const vp = vpOf(page, 110 / page.getViewport({ scale: 1 }).width); const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height; await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise.catch(() => {}); $(".ph", e.target)?.replaceWith(c); } }, { root: side, rootMargin: "300px 0px" });
    $$(".vw-thumb", side).forEach((t) => tio.observe(t));
    V.cleanup.push(() => tio.disconnect());
    // search
    async function search(term) {
      P.term = String(term ?? "").trim().toLowerCase(); P.hits = []; P.hi = -1;
      $$(".textLayer .hit", pagesEl).forEach((s) => s.classList.remove("hit", "cur"));
      if (!P.term) { status(`Page ${P.cur} of ${N}`); return ""; }
      status("Searching…");
      for (let n = 1; n <= N; n++) { const t = (await textOf(n)).text.toLowerCase(); let at = t.indexOf(P.term); while (at >= 0) { P.hits.push(n); at = t.indexOf(P.term, at + P.term.length); } }
      for (let n = 1; n <= N; n++) markHits(n);
      if (!P.hits.length) { status(`“${term}” isn't in this PDF.`); return `“${term}” isn't in this PDF.`; }
      const pages = [...new Set(P.hits)];
      status(`${P.hits.length} match${P.hits.length === 1 ? "" : "es"} for “${term}” on page${pages.length === 1 ? "" : "s"} ${pages.slice(0, 12).join(", ")}${pages.length > 12 ? "…" : ""}`);
      nextHit(1);
      return `Found “${term}” ${P.hits.length === 1 ? "once" : `${P.hits.length} times`}, first on page ${P.hits[0]}.`;
    }
    function markHits(n) { if (!P.term) return; const tl = $(`.vw-page[data-p="${n}"] .textLayer`, pagesEl); if (!tl) return; for (const s of $$("span", tl)) if (s.textContent.toLowerCase().includes(P.term)) s.classList.add("hit"); }
    function nextHit(d) { if (!P.hits.length) return; P.hi = (P.hi + d + P.hits.length) % P.hits.length; const n = P.hits[P.hi]; goPage(n); setTimeout(() => { $$(".textLayer .hit.cur", pagesEl).forEach((s) => s.classList.remove("cur")); const hs = $$(`.vw-page[data-p="${n}"] .textLayer .hit`, pagesEl); const k = P.hits.slice(0, P.hi).filter((x) => x === n).length; const h = hs[Math.min(k, hs.length - 1)]; if (h) { h.classList.add("cur"); h.scrollIntoView({ block: "center" }); } }, 350); }
    // read aloud: this page's text through Dayspring's voice (and so through the floor), then the next page
    async function read(from = P.cur) {
      stopSpeaking(); P.reading = true; paintRead();
      const my = ++readSeq;
      for (let n = from; n <= N && P.reading && my === readSeq; n++) {
        goPage(n);
        const t = (await textOf(n)).text.replace(/\s+/g, " ").trim();
        if (!t) continue;
        for (const chunk of t.match(/[^.!?]{1,380}[.!?]*["')\]]*\s*|.{1,380}/g) ?? [t]) { if (!P.reading || my !== readSeq) return; await speak(chunk.trim()); }
      }
      if (my === readSeq) { P.reading = false; paintRead(); }
    }
    const paintRead = () => { const b = $("[data-t=read]", tools); if (b) { b.textContent = P.reading ? "■ Stop reading" : "🔈 Read aloud"; b.setAttribute("aria-pressed", String(P.reading)); } };
    V.cleanup.push(() => { P.reading = false; });
    tools.innerHTML = [btn("◀", "pp", "Previous page (←, Page Up)"), `<input type="number" data-t="pg" min="1" max="${N}" value="1" style="width:4.2em" aria-label="Page">`, `<span class="lbl">of ${N}</span>`, btn("▶", "np", "Next page (→, Page Down)"), `<span class="sep"></span>`,
      btn("−", "out", "Zoom out"), `<span class="lbl" data-lbl="z">100%</span>`, btn("+", "in", "Zoom in"), btn("↔ Width", "fw", "Fit width"), btn("▯ Page", "fp", "Fit page"), btn("⟳", "rot", "Rotate"), `<span class="sep"></span>`,
      `<input type="search" data-t="find" placeholder="Search in the PDF" aria-label="Search in the PDF" style="width:10em">`, btn("▲", "hp", "Previous match"), btn("▼", "hn", "Next match"), `<span class="sep"></span>`,
      btn("🔈 Read aloud", "read", "Read this page aloud", `aria-pressed="false"`), btn("🖨", "print", "Print"), `<a class="vb" role="button" data-t="dl" href="${esc(src + "&download=1")}" download="${esc(it.name)}" title="Download" aria-label="Download">⤓</a>`].join("");
    $("input[data-t=pg]", tools).addEventListener("change", (e) => goPage(e.target.value));
    $("input[data-t=find]", tools).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (e.target.value.trim().toLowerCase() === P.term && P.hits.length) nextHit(e.shiftKey ? -1 : 1); else search(e.target.value); } e.stopPropagation(); });
    onTools({ pp: () => goPage(P.cur - 1), np: () => goPage(P.cur + 1), out: () => setScale(P.scale / 1.2), in: () => setScale(P.scale * 1.2), fw: () => fitMode("width"), fp: () => fitMode("page"),
      rot: () => { P.rot = (P.rot + 90) % 360; rendered.clear(); P.mode ? fitMode(P.mode) : layout(); $$(".vw-thumb", side).forEach((t) => { delete t.dataset.done; tio.observe(t); }); }, hp: () => nextHit(-1), hn: () => nextHit(1),
      read: () => { if (P.reading) { P.reading = false; readSeq++; stopSpeaking(); paintRead(); } else read(); }, print: () => printPdf(src), dl: () => {} });
    const ro = new ResizeObserver(() => { if (P.mode && seq === V.seq) setScale(scaleFor(P.mode), P.mode); }); ro.observe(stage); V.cleanup.push(() => ro.disconnect());
    fitMode("width");
    status(`Page 1 of ${N}`);
    V.ctl = { next: () => goPage(P.cur + 1), prev: () => goPage(P.cur - 1), page: () => P.cur, pages: () => N, goPage, zoomIn: () => setScale(P.scale * 1.2), zoomOut: () => setScale(P.scale / 1.2), fit: () => fitMode("page"), fitWidth: () => fitMode("width"),
      refit: () => { if (P.mode) fitMode(P.mode); }, rotate: () => { $("[data-t=rot]", tools).click(); }, search, read: () => read(), stopRead: () => { P.reading = false; readSeq++; stopSpeaking(); paintRead(); },
      state: () => ({ page: P.cur, pages: N, scale: P.scale, rot: P.rot, hits: P.hits.length, term: P.term, reading: P.reading, rendered: $$(".vw-page canvas", pagesEl).length }), text: async (n) => (await textOf(n)).text };
  }
  function printPdf(src) {
    try {
      const f = document.createElement("iframe"); f.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0"; f.src = src;
      f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { toast("Printing", "This window can't print it. Download it, or open it in the default app, to print."); } setTimeout(() => f.remove(), 60_000); };
      document.body.appendChild(f); window.__dsViewerPrinted = (window.__dsViewerPrinted ?? 0) + 1;
    } catch { toast("Printing", "This window can't print it."); }
  }
  // Dayspring's voice (tv.js dsSpeak goes through the floor); the browser's own voice only where there's no Dayspring screen
  let readSeq = 0;
  function speak(t) { if (window.dsSpeak) return Promise.resolve(window.dsSpeak(t, { tone: "bright" })).catch(() => {}); return new Promise((r) => { try { const u = new SpeechSynthesisUtterance(t); u.onend = u.onerror = () => r(); speechSynthesis.speak(u); } catch { r(); } }); }
  function stopSpeaking() { readSeq++; try { window.dsStopSpeaking ? window.dsStopSpeaking() : speechSynthesis?.cancel(); } catch { /* fine */ } }

  // ---------------------------------------------------------------------------------------------------- text, code, Markdown
  let prismP = null;
  const prism = () => (prismP ??= new Promise((ok) => { if (window.Prism?.highlightElement) return ok(window.Prism); const s = document.createElement("script"); s.src = "/vendor/prism/prism.min.js"; s.onload = () => ok(window.Prism ?? null); s.onerror = () => ok(null); document.head.appendChild(s); }));
  const inline = (s) => s.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>").replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>").replace(/(^|[\s(])_([^_\s][^_]*)_/g, "$1<em>$2</em>").replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "[picture: $1]").replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>');
  // Markdown → HTML, safely: everything is escaped first, then only these shapes become tags
  function markdown(src) {
    const lines = esc(src.replace(/\r/g, "")).split("\n"), out = [];
    for (let i = 0; i < lines.length;) {
      const l = lines[i]; let m;
      if (!l.trim()) { i++; continue; }
      if ((m = /^```\s*([\w-]*)/.exec(l))) { const body = []; i++; while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]); i++; out.push(`<pre><code class="language-${esc(m[1] || "none")}">${body.join("\n")}</code></pre>`); continue; }
      if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) { out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push("<hr>"); i++; continue; }
      if (/^&gt;/.test(l)) { const b = []; while (i < lines.length && /^&gt;/.test(lines[i])) b.push(lines[i++].replace(/^&gt;\s?/, "")); out.push(`<blockquote>${b.map(inline).join("<br>")}</blockquote>`); continue; }
      if (/^\|.*\|\s*$/.test(l) && /^\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) { const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim())); const head = cells(l); i += 2; const rows = []; while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++])); out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`); continue; }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) { const ordered = /^\s*\d/.test(l); const items = []; while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, "").replace(/^\[( |x)\]\s*/i, (x) => (/x/i.test(x) ? "☑ " : "☐ "))); out.push(`<${ordered ? "ol" : "ul"}>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`); continue; }
      const p = []; while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|&gt;|\s*([-*+]|\d+[.)])\s)/.test(lines[i])) p.push(lines[i++]);
      if (!p.length) { out.push(`<p>${inline(lines[i++])}</p>`); continue; }
      out.push(`<p>${inline(p.join(" "))}</p>`);
    }
    return out.join("");
  }
  // search inside the shown text: every match marked, ▲ ▼ move between them
  function textSearch(container, term) {
    for (const m of $$("mark.vw-hit", container)) m.replaceWith(document.createTextNode(m.textContent));
    container.normalize();
    const t = String(term ?? "").trim().toLowerCase(); if (!t) return 0;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let n = 0;
    for (const node of nodes) {
      const s = node.nodeValue, low = s.toLowerCase(); let at = low.indexOf(t); if (at < 0) continue;
      const frag = document.createDocumentFragment(); let last = 0;
      while (at >= 0 && n < 5000) { frag.append(s.slice(last, at)); const mk = document.createElement("mark"); mk.className = "vw-hit"; mk.textContent = s.slice(at, at + t.length); frag.append(mk); n++; last = at + t.length; at = low.indexOf(t, last); }
      frag.append(s.slice(last)); node.replaceWith(frag);
    }
    return n;
  }
  function searchTools(container, onDone = () => {}) {
    let hits = [], hi = -1;
    const run = (term) => { const n = textSearch(container(), term); hits = $$("mark.vw-hit", container()); hi = -1; if (n) move(1); status(n ? `${n} match${n === 1 ? "" : "es"} for “${term}”` : term ? `“${term}” isn't in this file.` : ""); onDone(n); return n ? `Found “${term}” ${n === 1 ? "once" : `${n} times`}.` : `“${term}” isn't in this file.`; };
    const move = (d) => { if (!hits.length) return; hits[hi]?.classList.remove("cur"); hi = (hi + d + hits.length) % hits.length; hits[hi].classList.add("cur"); hits[hi].scrollIntoView({ block: "center", inline: "nearest" }); };
    return { html: `<input type="search" data-t="find" placeholder="Search" aria-label="Search in the file" style="width:9em">${btn("▲", "hp", "Previous match")}${btn("▼", "hn", "Next match")}`,
      wire: () => { $("input[data-t=find]", tools).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const v = e.target.value; if (hits.length && container().dataset.term === v) move(e.shiftKey ? -1 : 1); else { container().dataset.term = v; run(v); } } e.stopPropagation(); }); },
      run, move, count: () => hits.length };
  }
  async function showText(it, kind, entry, seq) {
    stage.innerHTML = `<div class="vw-msg">Opening…</div>`;
    const r = await api(`/viewer/text?id=${encodeURIComponent(it.id)}${entry ? `&entry=${encodeURIComponent(entry)}` : ""}`);
    if (seq !== V.seq) return;
    if (r.binary) { stage.innerHTML = `<div class="vw-msg">This file isn't text, so it can't be shown here.</div>`; return card(it, entry); }
    const ext = String(entry ?? it.name).split(".").pop().toLowerCase();
    let size = Number(localStorage.getItem?.("dsViewer.font")) || 13, wrap = kind !== "code", rendered = kind === "markdown";
    const pretty = ext === "json" && r.text.length < 2e6 ? (() => { try { return JSON.stringify(JSON.parse(r.text), null, 2); } catch { return null; } })() : null;
    let usePretty = false;
    const paint = async () => {
      if (rendered) stage.innerHTML = `<article class="vw-doc" style="font-size:${size + 2}px">${markdown(r.text)}</article>`;
      else stage.innerHTML = `<pre class="vw-code${wrap ? " wrap" : ""}" style="font-size:${size}px"><code class="language-${esc(LANG[ext] ?? "none")}"></code></pre>`;
      if (!rendered) $("code", stage).textContent = usePretty && pretty ? pretty : r.text;
      const P = LANG[ext] || rendered ? await prism() : null;
      if (P && r.text.length < 400_000) for (const c of $$("code[class*=language-]", stage)) { try { P.highlightElement(c); } catch { /* plain */ } }
      const inp = $("input[data-t=find]", tools); if (inp?.value) S.run(inp.value);
    };
    const S = searchTools(() => stage.firstElementChild);
    tools.innerHTML = [kind === "markdown" ? btn("Source", "src", "Show the Markdown source", `aria-pressed="false"`) : "", pretty ? btn("{ } Pretty", "pretty", "Format the JSON", `aria-pressed="false"`) : "",
      btn("↵ Wrap", "wrap", "Word wrap", `aria-pressed="${wrap}"`), btn("A−", "small", "Smaller text"), btn("A+", "big", "Bigger text"), `<span class="sep"></span>`, S.html, `<span class="sep"></span>`, btn("⧉ Copy", "copy", "Copy the text")].join("");
    S.wire();
    const setSize = (d) => { size = Math.max(9, Math.min(32, size + d)); try { localStorage.setItem("dsViewer.font", String(size)); } catch { /* fine */ } paint(); };
    onTools({ src: (b) => { rendered = !rendered; b.setAttribute("aria-pressed", String(!rendered)); paint(); }, pretty: (b) => { usePretty = !usePretty; b.setAttribute("aria-pressed", String(usePretty)); paint(); },
      wrap: (b) => { wrap = !wrap; b.setAttribute("aria-pressed", String(wrap)); paint(); }, small: () => setSize(-1), big: () => setSize(1),
      copy: () => navigator.clipboard?.writeText(r.text).then(() => status("Copied."), () => status("Copying isn't allowed here.")) });
    await paint();
    status(`${r.text.split("\n").length} lines${r.truncated ? " (only the first 2 MB is shown)" : ""}${r.encoding && r.encoding !== "utf-8" ? ` · ${r.encoding}` : ""}`);
    V.ctl = { search: (q) => { const inp = $("input[data-t=find]", tools); inp.value = q; stage.firstElementChild.dataset.term = q; return S.run(q); }, zoomIn: () => setSize(1), zoomOut: () => setSize(-1), next: () => S.move(1), prev: () => S.move(-1), read: () => readText(stage.innerText),
      state: () => ({ wrap, size, rendered, hits: S.count(), highlighted: $$("code .token", stage).length }) };
  }
  async function readText(t) { stopSpeaking(); const my = readSeq; for (const chunk of String(t).replace(/\s+/g, " ").match(/[^.!?]{1,380}[.!?]*\s*|.{1,380}/g) ?? []) { if (my !== readSeq) return; await speak(chunk.trim()); } }

  // ---------------------------------------------------------------------------------------------------- tables: CSV and Excel
  const numOf = (v) => { const s = String(v).trim().replace(/[$€£,%\s]/g, "").replace(/^\((.*)\)$/, "-$1"); return s !== "" && /^-?\d*\.?\d+(e-?\d+)?$/i.test(s) ? Number(s) : null; };
  function table(rows, { header = null } = {}) {
    const head = header ?? (rows.length > 1 && rows[0].filter((c) => String(c).trim()).length >= Math.max(1, rows[0].length / 2) && rows[0].every((c) => numOf(c) === null) ? rows[0] : null);
    const body = head ? rows.slice(1) : rows.slice();
    const cols = Math.max(head?.length ?? 0, ...body.map((r) => r.length), 1);
    const numeric = Array.from({ length: cols }, (_, j) => { const vals = body.map((r) => r[j]).filter((v) => String(v ?? "").trim()); return vals.length > 0 && vals.filter((v) => numOf(v) !== null).length / vals.length > 0.8; });
    const T = { body, sortCol: -1, dir: 1, filter: "" };
    const el = document.createElement("table"); el.className = "vw-table";
    const letters = (j) => { let s = ""; j++; while (j) { const r = (j - 1) % 26; s = String.fromCharCode(65 + r) + s; j = Math.floor((j - 1) / 26); } return s; };
    const paint = () => {
      const f = T.filter.toLowerCase();
      const shown = f ? T.body.filter((r) => r.some((c) => String(c).toLowerCase().includes(f))) : T.body;
      el.innerHTML = `<thead><tr><th class="vw-rownum" aria-label="Row">#</th>${Array.from({ length: cols }, (_, j) => `<th data-c="${j}" tabindex="0" aria-sort="${T.sortCol === j ? (T.dir > 0 ? "ascending" : "descending") : "none"}">${esc(head?.[j] || letters(j))}</th>`).join("")}</tr></thead>`
        + `<tbody>${shown.slice(0, 3000).map((r) => `<tr><td class="vw-rownum">${T.body.indexOf(r) + 1}</td>${Array.from({ length: cols }, (_, j) => `<td${numeric[j] ? ' class="num"' : ""} title="${esc(r[j] ?? "")}">${esc(r[j] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>`;
      return shown.length;
    };
    const sort = (j) => {
      T.dir = T.sortCol === j ? -T.dir : 1; T.sortCol = j;
      const cmp = numeric[j] ? (a, b) => (numOf(a[j]) ?? -Infinity) - (numOf(b[j]) ?? -Infinity) : (a, b) => String(a[j] ?? "").localeCompare(String(b[j] ?? ""), undefined, { numeric: true, sensitivity: "base" });
      T.body = [...T.body].sort((a, b) => cmp(a, b) * T.dir); paint();
    };
    el.addEventListener("click", (e) => { const th = e.target.closest("th[data-c]"); if (th) sort(Number(th.dataset.c)); });
    el.addEventListener("keydown", (e) => { const th = e.target.closest("th[data-c]"); if (th && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); sort(Number(th.dataset.c)); } });
    paint();
    return { el, sort, filter: (f) => { T.filter = f; return paint(); }, rows: () => T.body, cols };
  }
  async function showSheet(it, kind, entry, seq) {
    stage.innerHTML = `<div class="vw-msg">Opening…</div>`;
    const r = await api(`/viewer/render?id=${encodeURIComponent(it.id)}${entry ? `&entry=${encodeURIComponent(entry)}` : ""}`);
    if (seq !== V.seq) return;
    const sheets = r.sheets ?? [];
    if (!sheets.length) { stage.innerHTML = `<div class="vw-msg">This spreadsheet is empty.</div>`; return; }
    let cur = 0, T = null;
    const paint = () => {
      const s = sheets[cur];
      stage.innerHTML = (sheets.length > 1 ? `<div class="vw-tabs" role="tablist">${sheets.map((x, i) => `<button type="button" class="vb" role="tab" data-sheet="${i}" aria-selected="${i === cur}"${i === cur ? ' aria-pressed="true"' : ""}>${esc(x.name)}</button>`).join("")}</div>` : "") + `<div class="vw-tablewrap"></div>`;
      T = table(s.rows); $(".vw-tablewrap", stage).appendChild(T.el);
      const f = $("input[data-t=filter]", tools)?.value; if (f) T.filter(f);
      status(`${s.name}: ${s.totalRows ?? s.rows.length} rows, ${s.cols} columns${s.truncated ? " (the first 2,000 rows and 60 columns are shown)" : ""}. Click a column to sort.`);
    };
    stage.onclick = (e) => { const b = e.target.closest("[data-sheet]"); if (b) { cur = Number(b.dataset.sheet); paint(); } };
    tools.innerHTML = [`<input type="search" data-t="filter" placeholder="Show rows with…" aria-label="Show only rows containing" style="width:12em">`, kind === "csv" ? btn("Source", "src", "Show the file as text") : ""].join("");
    $("input[data-t=filter]", tools).addEventListener("input", (e) => { const n = T.filter(e.target.value); status(e.target.value ? `${n} row${n === 1 ? "" : "s"} with “${e.target.value}”` : ""); });
    $("input[data-t=filter]", tools).addEventListener("keydown", (e) => e.stopPropagation());
    onTools({ src: () => showText(it, "text", entry, V.seq) });
    paint();
    V.ctl = { sort: (j) => T.sort(j), search: (q) => { const inp = $("input[data-t=filter]", tools); inp.value = q; const n = T.filter(q); return n ? `${n} row${n === 1 ? "" : "s"} with “${q}”.` : `No rows with “${q}”.`; }, sheet: (i) => { cur = Math.max(0, Math.min(sheets.length - 1, i)); paint(); },
      next: () => { if (sheets.length > 1) { cur = (cur + 1) % sheets.length; paint(); } }, prev: () => { if (sheets.length > 1) { cur = (cur - 1 + sheets.length) % sheets.length; paint(); } },
      state: () => ({ sheet: cur, sheets: sheets.length, rows: T.rows().length, first: T.rows()[0] ?? null }) };
  }

  // ---------------------------------------------------------------------------------------------------- Word, PowerPoint, zip
  async function showDoc(it, entry, seq) {
    stage.innerHTML = `<div class="vw-msg">Opening…</div>`;
    const r = await api(`/viewer/render?id=${encodeURIComponent(it.id)}${entry ? `&entry=${encodeURIComponent(entry)}` : ""}`);
    if (seq !== V.seq) return;
    let size = 16;
    stage.innerHTML = `<article class="vw-doc" style="font-size:${size}px">${r.html || '<p class="vw-msg">This document is empty.</p>'}</article>`;   // (cleaned on the server: no scripts, no outside pictures)
    const S = searchTools(() => $(".vw-doc", stage));
    tools.innerHTML = [btn("A−", "small", "Smaller text"), btn("A+", "big", "Bigger text"), `<span class="sep"></span>`, S.html, `<span class="sep"></span>`, btn("🔈 Read aloud", "read", "Read it aloud")].join("");
    S.wire();
    const setSize = (d) => { size = Math.max(10, Math.min(34, size + d)); $(".vw-doc", stage).style.fontSize = size + "px"; };
    onTools({ small: () => setSize(-1), big: () => setSize(1), read: () => readText($(".vw-doc", stage).innerText) });
    status(r.note ?? "");
    V.ctl = { search: (q) => { $("input[data-t=find]", tools).value = q; $(".vw-doc", stage).dataset.term = q; return S.run(q); }, zoomIn: () => setSize(1), zoomOut: () => setSize(-1), read: () => readText($(".vw-doc", stage).innerText), state: () => ({ size, hits: S.count(), paragraphs: $$(".vw-doc p", stage).length }) };
  }
  async function showSlides(it, seq) {
    stage.innerHTML = `<div class="vw-msg">Opening…</div>`;
    const r = await api(`/viewer/render?id=${encodeURIComponent(it.id)}`);
    if (seq !== V.seq) return;
    const slides = r.slides ?? [];
    if (!slides.length) { stage.innerHTML = `<div class="vw-msg">No slides with text or pictures were found.</div>`; return card(it); }
    let cur = 0;
    side.hidden = false;
    side.innerHTML = slides.map((s, i) => `<button type="button" class="vw-thumb" data-s="${i}">${i + 1}. ${esc((s.title || "Slide").slice(0, 40))}</button>`).join("");
    side.onclick = (e) => { const b = e.target.closest("[data-s]"); if (b) go(Number(b.dataset.s)); };
    const go = (i) => {
      cur = Math.max(0, Math.min(slides.length - 1, i)); const s = slides[cur];
      stage.innerHTML = `<div class="vw-slide"><h2>${esc(s.title || `Slide ${s.n}`)}</h2>${s.paras.map((p) => `<p>${esc(p)}</p>`).join("")}${s.images.length ? `<div class="pics">${s.images.map((e) => `<img alt="" loading="lazy" src="${esc(fileUrl(it.id, e))}">`).join("")}</div>` : ""}${s.notes ? `<div class="notes">Speaker notes: ${esc(s.notes)}</div>` : ""}</div>`;
      $$(".vw-thumb", side).forEach((t) => t.classList.toggle("on", Number(t.dataset.s) === cur));
      $("[data-lbl=s]", tools).textContent = `${cur + 1} / ${slides.length}`; status(`Slide ${cur + 1} of ${slides.length}`); report();
      return "";
    };
    tools.innerHTML = [btn("◀", "ps", "Previous slide"), `<span class="lbl" data-lbl="s"></span>`, btn("▶", "ns", "Next slide"), `<span class="sep"></span>`, btn("🔈 Read aloud", "read", "Read this slide aloud")].join("");
    onTools({ ps: () => go(cur - 1), ns: () => go(cur + 1), read: () => readText(stage.innerText) });
    go(0);
    V.ctl = { next: () => go(cur + 1), prev: () => go(cur - 1), goPage: (n) => go(n - 1), page: () => cur + 1, pages: () => slides.length, read: () => readText(stage.innerText), state: () => ({ slide: cur + 1, slides: slides.length }) };
  }
  async function showZip(it, seq) {
    stage.innerHTML = `<div class="vw-msg">Opening…</div>`;
    const r = await api(`/viewer/render?id=${encodeURIComponent(it.id)}`);
    if (seq !== V.seq) return;
    const files = r.entries.filter((e) => !e.dir);
    const size = (n) => (n == null ? "" : n < 1024 ? `${n} B` : n < 1 << 20 ? `${Math.round(n / 1024)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`);
    const paint = () => {
      stage.innerHTML = `<table class="vw-table vw-zip"><thead><tr><th>Name</th><th>Size</th><th>Packed</th><th>Date</th></tr></thead><tbody>${files.map((e) => `<tr><td><button type="button" data-e="${esc(e.name)}" title="Open">${ICON[kindOfName(e.name)] ?? "📄"} ${esc(e.name)}</button></td><td class="num">${size(e.size)}</td><td class="num">${size(e.packed)}</td><td>${e.date ? esc(new Date(e.date).toLocaleDateString()) : ""}</td></tr>`).join("")}</tbody></table>`;
      status(`${files.length} file${files.length === 1 ? "" : "s"} inside${r.truncated ? ` (the first ${r.entries.length} are listed)` : ""}. Click one to open it here (small files only).`);
    };
    const openEntry = async (name) => {
      const e = files.find((x) => x.name === name); if (!e) return;
      if (e.size != null && e.size > 25 * 1024 * 1024) { status(`${name} is too big to open from inside the archive. Open the archive in the default app instead.`); return; }
      const k = kindOfName(name);
      if (["other", "zip"].includes(k)) { status(`${name} can't be shown here.`); return; }
      V.entry = name; tools.innerHTML = ""; stage.innerHTML = "";
      V.zipBack = () => { V.entry = null; V.zipBack = null; teardown(); showZip(it, V.seq); };
      $(".vw-title small", root).textContent = `Inside ${it.name}: ${name}`;
      await show(it, k, name, V.seq).catch((err) => { stage.innerHTML = `<div class="vw-msg">${esc(err.message)}</div>`; });
      const back = document.createElement("button"); back.type = "button"; back.className = "vb"; back.dataset.t = "back"; back.textContent = "↩ Back to the archive"; tools.prepend(back);
      back.onclick = () => V.zipBack?.();
    };
    stage.onclick = (e) => { const b = e.target.closest("[data-e]"); if (b) openEntry(b.dataset.e); };
    paint();
    V.ctl = { openEntry, state: () => ({ entries: files.length, entry: V.entry }) };
  }
  // anything else: what it is, and where it can open
  function card(it, entry = null) {
    const k = it.kind ?? kindOfName(it.name);
    const box = document.createElement("div"); box.className = "vw-card";
    box.innerHTML = `<div class="big">${ICON[k] ?? "📦"}</div><h3>${esc(entry ? entry : it.name)}</h3><p>${esc([it.type, it.sizeText, it.when].filter(Boolean).join(" · "))}</p><p><small>${esc(it.source === "drive" ? `In ${it.where}` : it.where ?? "")}</small></p>
      <div class="acts">${it.source === "drive" ? (it.link ? `<a class="vb" href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">Open in Google Drive</a>` : "") + (["drivedoc", "pdf", "text", "docx"].includes(k) ? btn("Show its text", "drivetext", "Show the text") : "")
        : `${btn("↗ Open in the default app", "default", "Open in its usual app")}${btn("📂 Show in folder", "folder", "Show it in its folder")}<a class="vb" href="${esc(fileUrl(it.id, entry, "&download=1"))}" download>⤓ Download</a>`}</div>`;
    stage.appendChild(box);
    box.addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (!b) return; if (b.dataset.t === "drivetext") showText({ ...it }, "text", null, V.seq); else action(b.dataset.t); });
  }

  // ---------------------------------------------------------------------------------------------------- the info panel and the actions
  function paintMenu() {
    const it = V.item, img = V.kind === "image", local = it.source !== "drive";
    menu.innerHTML = [local ? `<button type="button" class="vb" data-m="default" role="menuitem">↗ Open in the default app</button>` : "", local ? `<button type="button" class="vb" data-m="folder" role="menuitem">📂 Show in folder</button>` : "",
      local ? `<button type="button" class="vb" data-m="download" role="menuitem">⤓ Download</button>` : "", img ? `<button type="button" class="vb" data-m="copyimg" role="menuitem">⧉ Copy the picture</button>` : "",
      local ? `<button type="button" class="vb" data-m="copy" role="menuitem">⎘ Save a copy</button>` : "", img && local ? `<button type="button" class="vb" data-m="avatar" role="menuitem">👤 Set as avatar</button>` : "",
      img && local ? `<button type="button" class="vb" data-m="describe" role="menuitem">🗨 Describe it and read its text</button>` : "", `<button type="button" class="vb" data-m="ask" role="menuitem">✦ Summarize this with AI</button>`,
      local ? `<button type="button" class="vb danger" data-m="delete" role="menuitem">🗑 Delete…</button>` : "", it.source === "drive" && it.link ? `<a class="vb" href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">Open in Google Drive</a>` : ""].join("");
  }
  function toggleMenu() { menu.hidden = !menu.hidden; if (!menu.hidden) { $(".vb", menu)?.focus(); window.dsKeepInSafe?.(menu); } }
  async function toggleInfo(on) { const show = on ?? info.hidden; info.hidden = !show; $("[data-a=info]", root).setAttribute("aria-pressed", String(show)); if (show) await paintInfo(); V.ctl.refit?.(); return ""; }
  async function paintInfo() {
    const it = V.item; if (!it) return;
    info.innerHTML = `<p>Loading…</p>`;
    try { V.info = V.info?.id === it.id ? V.info : await api(`/viewer/info?id=${encodeURIComponent(it.id)}`); } catch (e) { info.innerHTML = `<p>${esc(e.message)}</p>`; return; }
    const r = V.info, rows = [["Name", r.name], ["Type", r.type], ["Size", r.sizeText], ["Where", r.where], ["Modified", r.modified ? new Date(r.modified).toLocaleString() : ""],
      ["Taken", r.taken ? new Date(r.taken).toLocaleString() : ""], ["Camera", r.camera], ["Dimensions", r.width ? `${r.width} × ${r.height} pixels` : ""], ["Location", r.gps ? "Saved in the photo (kept private)" : ""],
      ["Title", r.title], ["Artist", r.artist], ["Length", r.duration ? mmss(r.duration) : ""], ["Your words", r.ownWords], ["Description", r.description], ["Text in it", r.ocr]].filter(([, v]) => v);
    info.innerHTML = `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      <div class="acts">${V.kind === "image" && it.source !== "drive" ? btn(r.description ? "Describe again" : "🗨 Describe it", "describe", "Describe the picture and read its text") : ""}${it.source !== "drive" ? btn("📂 Folder", "folder", "Show in folder") : ""}</div>`;
    info.onclick = (e) => { const b = e.target.closest("[data-t]"); if (b) action(b.dataset.t); };
  }
  // a question on the viewer itself (delete, a risky open): the owner's click is the yes, bound to this one file
  function ask(text, yes = "Yes", danger = false) {
    return new Promise((ok) => {
      $(".vw-ask", root)?.remove();
      const d = document.createElement("div"); d.className = "vw-ask"; d.setAttribute("role", "alertdialog"); d.setAttribute("aria-label", "Are you sure?");
      d.innerHTML = `<div><p>${esc(text)}</p><div class="acts"><button type="button" class="vb" data-k="no">Cancel</button><button type="button" class="vb${danger ? " danger" : ""}" data-k="yes">${esc(yes)}</button></div></div>`;
      $(".vw-body", root).appendChild(d);
      d.addEventListener("click", (e) => { const b = e.target.closest("[data-k]"); if (!b) return; d.remove(); ok(b.dataset.k === "yes"); });
      setTimeout(() => $("[data-k=no]", d).focus(), 0);
    });
  }
  async function action(a) {
    const it = V.item; if (!it) return;
    const id = it.id;
    try {
      if (a === "default") { let r = await api("/viewer/default", { id }); if (r.needsConfirm) { if (!(await ask(r.text, "Open it"))) return; r = await api("/viewer/default", { id, ask: r.ask }); } status(r.opened ? `Opened ${r.opened} in its usual app.` : r.text ?? ""); return; }
      if (a === "folder") { const r = await api("/viewer/folder", { id }); status(r.reply ?? ""); return; }
      if (a === "download") { const l = document.createElement("a"); l.href = fileUrl(id, V.entry, "&download=1"); l.download = V.entry ?? it.name; document.body.appendChild(l); l.click(); l.remove(); return; }
      if (a === "copyimg") { const img = $(".vw-img img", stage); if (!img) return; const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext("2d").drawImage(img, 0, 0); const blob = await new Promise((r) => c.toBlob(r, "image/png")); await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); status("Copied the picture."); return; }
      if (a === "copy") { let r = await api("/viewer/copy", { id }); if (r.needsConfirm) { if (!(await ask(r.text, "Save the copy"))) return; r = await api("/viewer/copy", { id, ask: r.ask }); } status(r.copied ? `Saved ${r.copied} in ${r.where}.` : r.text ?? ""); return; }
      if (a === "avatar") { if (!(await ask(`Use ${it.name} as Dayspring's avatar?`, "Use it"))) return; const r = await api("/viewer/avatar", { id }); status(r.avatar ? `${r.avatar} is the avatar now.` : ""); return; }
      if (a === "describe") { status("Looking at it…"); const r = await api("/viewer/describe", { id }); V.info = null; status(r.usedAI ? "Described with the AI." : "Described on this computer."); await toggleInfo(true); return r; }
      if (a === "ask") { status("Asking…"); const r = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: `Summarize the file open in the viewer, ${it.name}`, surface: "tv" }) }).then((x) => x.json()).catch(() => ({})); if (r.reply) { status(""); window.dsSpeak?.(r.reply); toast("About " + it.name, r.reply.slice(0, 300)); } return; }
      if (a === "delete") {
        let r = await api("/viewer/delete", { id });
        if (r.needsConfirm) { if (!(await ask(r.text, "Move it to the Recycle Bin", true))) { status("Kept it."); return; } r = await api("/viewer/delete", { id, ask: r.ask }); }
        if (r.recycled) { status(`${r.recycled} is in the Recycle Bin.`); toast("Deleted", `${r.recycled} went to the Recycle Bin.`); const L = V.list?.filter((x) => x !== id); if (L?.length) { V.list = L; V.index = Math.min(V.index, L.length - 1); V.index--; step(1); } else close(); }
        return;
      }
    } catch (e) { status(e.message); if (e.status === 403) toast("Not allowed", e.message); }
  }

  // ---------------------------------------------------------------------------------------------------- keyboard and remote
  function onKey(e) {
    if (e.target.matches("input, select, textarea")) return;
    const k = e.key, C = V.ctl;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === "ArrowLeft" && !e.target.closest(".vw-win, .vw-tools")) { handled(); (V.kind === "video" || V.kind === "audio") ? C.seekBy?.(-10) : C.prev ? C.prev() : step(-1); }
    else if (k === "ArrowRight" && !e.target.closest(".vw-win, .vw-tools")) { handled(); (V.kind === "video" || V.kind === "audio") ? C.seekBy?.(10) : C.next ? C.next() : step(1); }
    else if (k === "PageDown") { handled(); C.next ? C.next() : step(1); } else if (k === "PageUp") { handled(); C.prev ? C.prev() : step(-1); }
    else if (k === "+" || k === "=") { handled(); C.zoomIn?.(); } else if (k === "-" || k === "_") { handled(); C.zoomOut?.(); }
    else if (k === "0") { handled(); C.fit?.(); } else if (k === "1" && V.kind === "image") { handled(); C.actual?.(); }
    else if (k === "r" || k === "R") { handled(); C.rotate?.(e.shiftKey ? -1 : 1); } else if ((k === "h" || k === "H") && V.kind === "image") { handled(); C.flip?.(); } else if ((k === "v" || k === "V") && V.kind === "image") { handled(); C.flipV?.(); }
    else if (k === "f" || k === "F") { handled(); setFull(!V.full); } else if (k === "i" || k === "I") { handled(); toggleInfo(); }
    else if ((k === "s" || k === "S") && V.kind === "image") { handled(); C.slideshow?.(); }
    else if (k === " " && (V.kind === "video" || V.kind === "audio")) { handled(); C.toggle?.(); }
    else if (k === "/") { const f = $("input[data-t=find], input[data-t=filter]", tools); if (f) { handled(); f.focus(); } }
    else if (k === "Delete") { handled(); action("delete"); }
  }

  // ---------------------------------------------------------------------------------------------------- the list of matches, and the search box
  let fin = null, finItems = [];
  function buildFinder() {
    fin = document.createElement("section"); fin.id = "dsFinder"; fin.setAttribute("role", "dialog"); fin.setAttribute("aria-label", "Files found"); fin.hidden = true;
    fin.innerHTML = `<header><h2>🔎 Find a file</h2><button type="button" class="vb" data-f="close" aria-label="Close the list">✕</button></header>
      <form role="search" autocomplete="off"><input type="search" name="q" placeholder="A name, a type, a date… (“lease pdf last month”)" aria-label="Find a file by name" maxlength="200">
      <select name="kind" aria-label="Kind"><option value="">Any kind</option><option value="image">Pictures</option><option value="video">Videos</option><option value="audio">Audio</option><option value="pdf">PDFs</option><option value="docx">Word</option><option value="sheet">Spreadsheets</option><option value="slides">Presentations</option><option value="text">Text</option><option value="zip">Zip</option></select>
      <button type="submit" class="vb">Find</button></form><ol></ol>`;
    document.body.appendChild(fin);
    fin.addEventListener("click", (e) => { const b = e.target.closest("[data-f=close]"); if (b) return closeFinder(true); const li = e.target.closest("li[data-n]"); if (li) pickN(Number(li.dataset.n)); });
    fin.addEventListener("keydown", (e) => {
      if (e.target.matches("input, select")) return;
      const li = e.target.closest("li[data-n]");
      if (li && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pickN(Number(li.dataset.n)); }
      else if (li && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); (e.key === "ArrowDown" ? li.nextElementSibling : li.previousElementSibling)?.focus(); }
      else if (/^[1-9]$/.test(e.key)) { e.preventDefault(); pickN(Number(e.key)); }
    });
    $("form", fin).addEventListener("submit", async (e) => { e.preventDefault(); const f = new FormData(e.target); await searchBox(String(f.get("q") ?? ""), String(f.get("kind") ?? "")); });
    $("form input", fin).addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); $("li[data-n]", fin)?.focus(); } e.stopPropagation(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && fin && !fin.hidden && (!V.open || root.hidden) && (!e.dsTop || e.dsTop === fin)) { e.stopImmediatePropagation(); closeFinder(true); } }, true);
    addEventListener("resize", () => { if (!fin.hidden) window.dsKeepInSafe?.(fin); });
  }
  function paintList(title, items, note = "") {
    if (!fin) buildFinder();
    finItems = items ?? [];
    $("h2", fin).textContent = title ? `🔎 ${title}` : "🔎 Find a file";
    $("ol", fin).innerHTML = finItems.length ? finItems.map((x) => `<li data-n="${x.n}" tabindex="0" title="${esc(x.name)}"><span class="n">${x.n}</span><span class="th">${x.thumb ? `<img alt="" loading="lazy" src="${esc(x.thumb)}" onerror="this.replaceWith(document.createTextNode('${ICON[x.kind] ?? "📄"}'))">` : ICON[x.kind] ?? "📄"}</span>
      <div><b>${esc(x.name)}</b>${x.kind === "image" && x.source !== "drive" ? (window.dsGallery?.actionsHtml?.(x.id, { compact: true }) ?? "") : ""}<span class="meta">${x.source === "drive" ? `<span class="drive">☁ Google Drive</span> · ` : ""}${esc([x.where, x.sizeText, x.when, x.type].filter(Boolean).join(" · "))}</span></div></li>`).join("") : `<li class="empty" aria-disabled="true">${esc(note || "Nothing found.")}</li>`;
    fin.hidden = false;
    window.dsKeepInSafe?.(fin);
  }
  async function searchBox(q, kind = "") {
    if (!fin) buildFinder();
    $("form input", fin).value = q;
    if (!q.trim() && !kind) return paintList("", [], "Type a few words from the name.");
    try {
      const r = await api(`/viewer/search?q=${encodeURIComponent(q)}${kind ? `&kind=${encodeURIComponent(kind)}` : ""}`);
      paintList(q ? `Files like “${q}”` : "Files", r.results, r.off ? r.how : `Nothing like that in ${r.searched.join(", ") || "the folders I may look in"}.${r.scanning ? " (Still looking through your folders.)" : ""}`);
      return r.results.length;
    } catch (e) { paintList("", [], e.message); return 0; }
  }
  async function pickN(n) {
    const x = finItems.find((y) => y.n === n); if (!x) return false;
    try { await api("/viewer/open", { id: x.id, n }); } catch (e) { toast("Viewer", e.message); }
    return true;
  }
  function closeFinder(tell = false) { if (fin) fin.hidden = true; finItems = []; if (tell) api("/viewer/list/close", {}).catch(() => {}); }

  // ---------------------------------------------------------------------------------------------------- voice on the screen (instant, only while it's up)
  const N = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
  (window.dsLocal ??= []).push((t) => {
    t = String(t).toLowerCase().replace(/[.!?,]/g, "").trim();
    let m;
    if (fin && !fin.hidden && finItems.length && (m = /^(?:open |show( me)? |play )?(?:number |#)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|first|second|third|fourth|fifth)(?: one)?$/.exec(t)) && (/^\d+$/.test(t) === false || finItems.length >= Number(t))) {
      const n = Number(N[m[2]] ?? m[2]); if (!finItems.some((x) => x.n === n)) return `There are only ${finItems.length} on the list.`; pickN(n); return true;
    }
    if (fin && !fin.hidden && /^(close|hide) (the )?(list|results)$/.test(t)) { closeFinder(true); return true; }
    if (!V.open || root.hidden) return false;
    const C = V.ctl;
    const say = (r) => (typeof r === "string" && r ? r : true);
    if (/^(next|next (one|picture|photo|image|file|page|slide))$/.test(t)) { C.next ? C.next() : step(1); return true; }
    if (/^(previous|go back|back|previous (one|picture|photo|image|file|page|slide)|last (page|picture|photo))$/.test(t)) { C.prev ? C.prev() : step(-1); return true; }
    if (/^(zoom in|zoom closer|bigger|make it bigger|enlarge( it)?)$/.test(t)) { C.zoomIn?.(); return true; }
    if (/^(zoom out|smaller|make it smaller)$/.test(t)) { C.zoomOut?.(); return true; }
    if (/^(fit( it)?( to (the )?(screen|window|page))?|fit width|reset (the )?zoom)$/.test(t)) { (t === "fit width" ? C.fitWidth ?? C.fit : C.fit)?.(); return true; }
    if (/^(rotate( it)?( (right|clockwise))?|turn it( right)?)$/.test(t)) { C.rotate?.(1); return true; }
    if (/^(rotate( it)? (left|counter ?clockwise|anti ?clockwise)|turn it left)$/.test(t)) { C.rotate?.(-1); return true; }
    if (/^flip( it)?$/.test(t)) { C.flip?.(); return true; }
    if (/^((start|play|begin) (the |a )?slide ?show|slide ?show)$/.test(t)) return say(C.slideshow?.(true) ?? "Slideshows are for pictures.");
    if (/^(stop|end|pause) (the )?slide ?show$/.test(t)) return say(C.slideshow?.(false) ?? true);
    if ((m = /^(?:go to |turn to |jump to |show )?(page|slide) (\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten)$/.exec(t))) { const n = Number(N[m[2]] ?? m[2]); if (C.goPage) { C.goPage(n); return `Page ${n}.`; } return "This file doesn't have pages."; }
    if (/^(read (this|the) page|read (it|this|the page) (to me|aloud|out loud)|read aloud|read this( to me)?|read it)$/.test(t)) { if (C.read) { C.read(); return true; } return "There's nothing to read aloud in this one."; }
    if (/^stop reading$/.test(t)) { C.stopRead?.(); stopSpeaking(); return true; }
    // "search for rent", "find rent in this document" (a plain "find …" is a file to find: the server's)
    if ((m = /^(?:search(?: for)?|look for) (.+?)(?: in (?:it|this|here|the (?:document|pdf|file|page)))?$|^(?:find|look for|search for) (.+?) (?:in|on) (?:it|this|here|this page|the (?:document|pdf|file|page))$|^search (?:this|the) (?:page|document|file|pdf) for (.+)$/.exec(t)) && C.search && !/\b(file|files|folder|photos?|pictures?|pdfs?|documents?|videos?)\b/.test(m[1] ?? m[2] ?? m[3])) { const q = m[1] ?? m[2] ?? m[3]; Promise.resolve(C.search(q)).then((r) => { if (typeof r === "string") status(r); }); return true; }
    if (/^(full ?screen|go full ?screen)$/.test(t)) { setFull(true); return true; }
    if (/^(exit|leave) full ?screen$/.test(t)) { setFull(false); return true; }
    if (/^(show|hide) (the )?(info|details|information)$/.test(t)) { toggleInfo(/^show/.test(t)); return true; }
    if (/^(pause|stop)( it| the video| the song)?$/.test(t) && C.pause) { C.pause(); return true; }
    if (/^(play|resume|continue|keep playing)( it| the video| the song)?$/.test(t) && C.play) { C.play(); return true; }
    if (/^(close|close (it|this|the viewer|the file|the picture|the pdf|the document)|stop viewing|i'?m done( looking)?)$/.test(t)) { close(); return true; }
    return false;
  });

  // ---------------------------------------------------------------------------------------------------- the server says
  function ctl(c = {}) {
    if (!V.open) return false;
    const C = V.ctl;
    switch (c.ctl) {
      case "next": return C.next ? C.next() : step(1);
      case "prev": return C.prev ? C.prev() : step(-1);
      case "zoomIn": return C.zoomIn?.(); case "zoomOut": return C.zoomOut?.(); case "fit": return C.fit?.();
      case "rotate": return C.rotate?.(c.dir ?? 1); case "flip": return C.flip?.();
      case "slideshow": return C.slideshow?.(c.on);
      case "read": return C.read?.(); case "stopRead": return C.stopRead?.();
      case "page": return C.goPage?.(c.n);
      case "search": return C.search?.(c.q);
      case "full": return setFull(c.on);
      case "info": return toggleInfo();
      case "toggle": return C.toggle?.();
      case "pause": return C.pause?.();
      case "play": return C.play?.();
      case "close": return close();
    }
    return false;
  }
  const attach = (es) => es.addEventListener("viewer", (e) => {
    let d = {}; try { d = JSON.parse(e.data); } catch { return; }
    if (d.list !== undefined) { if (d.list) paintList(d.list.title, d.list.items); else closeFinder(false); }
    if (d.open) { closeFinder(false); open({ item: d.open, list: d.open.list ?? null, index: d.open.index ?? 0 }); }
    if (d.ctl) ctl(d.ctl);
    if (d.close) close();
  });
  if (window.dsEvents) attach(window.dsEvents); else addEventListener("ds-events", (e) => attach(e.detail), { once: true });
  window.dsViewer = { open, close, ctl, step, find: searchBox, showList: paintList, closeList: closeFinder, pick: pickN, action, info: toggleInfo, full: setFull,
    state: () => ({ open: V.open, id: V.item?.id ?? null, kind: V.kind, full: V.full, list: V.list, index: V.index, entry: V.entry, infoOpen: Boolean(info && !info.hidden), ...(V.ctl.state?.() ?? {}) }), _ctl: () => V.ctl, _markdown: markdown };
})();
