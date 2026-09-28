// Videos on the Dayspring screen (lib/video, the "videosearch" feature): the grid of videos to pick from, and the queue.
//   The grid ("vbrowse" events): "pull up videos about biking", "videos by Mike Winger", his YouTube playlists, or the top 3
//   when Dayspring isn't sure. Numbered cards with the thumbnail, title, channel, length and age; click one (or say
//   "number 3") to play it, ＋ Queue on each, filters (newest, most viewed, long, short, no Shorts) and More.
//   The queue ("vqueue" events): every video with its thumbnail, title, channel and length, the one playing marked; click
//   to jump, ▲ ▼ to move, ✕ to remove, Clear, Shuffle, Repeat. Opens with ☰ on the video, Q, or "show the queue".
// Both stay inside the screen's margins (safe-area.css pins them to the margins; they scroll inside themselves). Everything they do goes to /api/video/*,
// so the voice, the desk and this screen always agree.
(() => {
  if (window.dsFeatures?.on && window.dsFeatures.on("videosearch") === false) return;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const post = (url, body) => fetch("/api" + url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j; });
  const get = (url) => fetch("/api" + url).then((r) => r.json());
  const note = (t, b = "") => window.dayspring?.toast?.(t, b, "", "bell");
  const say = (r) => { if (r?.reply) note("Videos", r.reply); };
  const mmss = (x) => { x = Math.max(0, Math.floor(Number(x) || 0)); const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), s = String(x % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`; };

  const css = document.createElement("style");
  css.textContent = `
  #dsVideos{position:fixed;z-index:57;inset:1em;display:flex;flex-direction:column;border-radius:1.1em;background:rgba(12,14,36,.97);backdrop-filter:blur(18px);border:1px solid var(--edge2,rgba(170,180,255,.28));
    box-shadow:0 30px 90px rgba(0,0,0,.65);color:var(--ink,#eef0ff);animation:dsvin .28s ease;min-height:0}
  @keyframes dsvin{from{opacity:0;transform:translateY(.5em)}to{opacity:1;transform:none}}
  #dsVideos header,#dsVQueue header{display:flex;flex-wrap:wrap;gap:.4em;align-items:center;padding:.7em .85em .55em;border-bottom:1px solid var(--edge,rgba(160,170,255,.14))}
  #dsVideos h2,#dsVQueue h2{margin:0;font-weight:500;font-size:1.05em;flex:1 1 12em;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .dsv-b{font:inherit;font-size:.8em;color:inherit;background:rgba(255,255,255,.06);border:1px solid var(--edge2,rgba(170,180,255,.28));border-radius:.6em;padding:.3em .65em;cursor:pointer;white-space:nowrap}
  .dsv-b:hover,.dsv-b:focus-visible{background:rgba(124,140,255,.32);outline:none}
  .dsv-b[aria-pressed="true"]{background:rgba(124,140,255,.45);border-color:rgba(160,170,255,.7)}
  .dsv-chips{display:flex;flex-wrap:wrap;gap:.3em;padding:.45em .85em;border-bottom:1px solid var(--edge,rgba(160,170,255,.1))}
  .dsv-body{overflow:auto;min-height:0;flex:1;padding:.7em .85em 1em}
  .dsv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(13.5em,1fr));gap:.75em}
  .dsv-card{position:relative;display:flex;flex-direction:column;border-radius:.8em;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);overflow:hidden}
  .dsv-card .th{position:relative;display:block;width:100%;aspect-ratio:16/9;border:0;padding:0;cursor:pointer;background:#1b1f45 center/cover no-repeat}
  .dsv-card .th:focus-visible{outline:2px solid var(--violet,#a78bfa);outline-offset:-2px}
  .dsv-card .n{position:absolute;left:.4em;top:.4em;min-width:1.7em;height:1.7em;display:grid;place-items:center;border-radius:.9em;background:rgba(8,10,28,.85);font-weight:700;font-size:.9em;padding:0 .35em}
  .dsv-card .len{position:absolute;right:.4em;bottom:.4em;background:rgba(0,0,0,.8);border-radius:.35em;padding:.05em .35em;font-size:.78em}
  .dsv-card .live{position:absolute;right:.4em;bottom:.4em;background:#d11;border-radius:.35em;padding:.05em .4em;font-size:.72em;font-weight:700}
  .dsv-card .meta{padding:.5em .6em .6em;display:flex;flex-direction:column;gap:.35em;flex:1}
  .dsv-card b{font-weight:500;font-size:.92em;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .dsv-card small{color:var(--muted,#a4abcc);font-size:.78em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .dsv-card .acts{display:flex;gap:.35em;margin-top:auto}
  .dsv-empty{color:var(--muted,#a4abcc);padding:1em;text-align:center}
  #dsVQueue{position:fixed;z-index:56;top:1em;bottom:1em;right:1em;width:min(32em,calc(100vw - 2em));display:flex;flex-direction:column;border-radius:1.1em;background:rgba(12,14,36,.97);
    backdrop-filter:blur(18px);border:1px solid var(--edge2,rgba(170,180,255,.28));box-shadow:0 30px 90px rgba(0,0,0,.65);color:var(--ink,#eef0ff);animation:dsvin .28s ease;min-height:0}
  #dsVQueue ol{list-style:none;margin:0;padding:.5em .6em .8em;overflow:auto;flex:1;min-height:0;display:flex;flex-direction:column;gap:.35em}
  #dsVQueue li{display:grid;grid-template-columns:1.9em 6.4em 1fr auto;gap:.55em;align-items:center;padding:.4em .45em;border-radius:.7em;background:rgba(255,255,255,.035);cursor:pointer;border:1px solid transparent}
  #dsVQueue li:hover{background:rgba(124,140,255,.14)}
  #dsVQueue li.cur{background:rgba(124,140,255,.24);border-color:rgba(160,170,255,.55)}
  #dsVQueue li.drag{opacity:.4} #dsVQueue li.over{border-color:var(--violet,#a78bfa)}
  #dsVQueue li .n{color:var(--muted,#a4abcc);text-align:right;font-variant-numeric:tabular-nums}
  #dsVQueue li.cur .n{color:var(--violet,#a78bfa)}
  #dsVQueue li .im{width:6.4em;aspect-ratio:16/9;border-radius:.4em;background:#1b1f45 center/cover no-repeat}
  #dsVQueue li b{display:block;font-weight:500;font-size:.9em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #dsVQueue li span.sub{display:block;color:var(--muted,#a4abcc);font-size:.76em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #dsVQueue li .now{color:var(--violet,#a78bfa);font-size:.74em;font-weight:600;letter-spacing:.02em}
  #dsVQueue li .ib{font:inherit;font-size:.78em;width:2em;height:2em;border-radius:50%;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:inherit;cursor:pointer}
  #dsVQueue li .ib:hover,#dsVQueue li .ib:focus-visible{background:rgba(124,140,255,.4);outline:none}
  #dsVQueue li .acts{display:flex;gap:.25em}
  html.mini #dsVQueue li{grid-template-columns:1.6em 4.6em 1fr auto}html.mini #dsVQueue li .im{width:4.6em}
  html.mini .dsv-grid{grid-template-columns:repeat(auto-fill,minmax(10em,1fr))}`;
  document.head.appendChild(css);

  // ---------------------------------------------------------------- the grid
  let G = null, gridEl = null;
  const thumbOf = (x) => x.thumb || (x.videoId ? `https://i.ytimg.com/vi/${x.videoId}/mqdefault.jpg` : "");
  function renderGrid(v) {
    if (!v?.open) { closeGrid(false); return; }
    G = v;
    if (!gridEl) { gridEl = document.createElement("section"); gridEl.id = "dsVideos"; gridEl.setAttribute("role", "dialog"); document.body.appendChild(gridEl); gridEl.addEventListener("click", onGridClick); }
    gridEl.setAttribute("aria-label", v.title || "Videos");
    const f = v.filters ?? {}, vids = v.kind === "videos";
    const chip = (key, label, on) => `<button class="dsv-b" data-f="${key}" aria-pressed="${on ? "true" : "false"}">${label}</button>`;
    const chips = vids && !v.ask ? `<div class="dsv-chips" role="group" aria-label="Filters">${chip("newest", "Newest", f.newest)}${chip("popular", "Most viewed", f.popular)}${chip("long", "Over 20 min", f.minSecs >= 1200)}${chip("short", "Under 10 min", f.maxSecs && f.maxSecs <= 600)}${chip("noShorts", "No Shorts", f.noShorts !== false && !f.shorts)}${chip("reset", "All", false)}</div>` : "";
    const card = (x) => {
      const t = thumbOf(x), isPl = v.kind === "playlists", isCh = v.kind === "channels";
      const sub = isPl ? x.channel || (x.count != null ? `${x.count} videos` : "Playlist") : isCh ? x.channel || "Channel" : [x.channel, x.age, x.views].filter(Boolean).join(" · ");
      const acts = isPl ? `<button class="dsv-b" data-play="${x.n}">▶ Play</button><button class="dsv-b" data-shuffle="${x.n}">⤮ Shuffle</button><button class="dsv-b vq-add" data-queue="${x.n}" title="Add the whole playlist to the queue">＋ Queue</button>`
        : isCh ? `<button class="dsv-b" data-play="${x.n}">▶ Videos</button>`
        : `<button class="dsv-b" data-play="${x.n}" title="Play it now">▶ Play</button><button class="dsv-b vq-add" data-queue="${x.n}" title="Add it to the queue">＋ Queue</button>`;
      return `<article class="dsv-card"><button class="th" data-play="${x.n}" aria-label="Play number ${x.n}: ${esc(x.title)}" style="${t ? `background-image:url('${esc(t)}')` : "background:linear-gradient(135deg,#27305f,#52317a)"}"><span class="n">${x.n}</span>${x.live ? `<span class="live">LIVE</span>` : x.length ? `<span class="len">${esc(x.length)}</span>` : isPl ? `<span class="len">☰</span>` : ""}</button>
        <div class="meta"><b title="${esc(x.title)}">${esc(x.title)}</b><small>${esc(sub)}</small><div class="acts">${acts}</div></div></article>`;
    };
    gridEl.innerHTML = `<header><h2>${esc(v.title || "Videos")}</h2>${v.more ? `<button class="dsv-b" data-more="1">More</button>` : ""}<button class="dsv-b" data-close="1" aria-label="Close the videos">✕</button></header>${chips}
      <div class="dsv-body">${v.items?.length ? `<div class="dsv-grid">${v.items.map(card).join("")}</div>` : `<div class="dsv-empty">Nothing here.</div>`}</div>`;
  }
  function closeGrid(tell = true) { if (gridEl) { gridEl.remove(); gridEl = null; } if (tell && G?.open) post("/video/browse", { action: "close" }).catch(() => {}); G = null; }
  async function onGridClick(e) {
    const b = e.target.closest("button"); if (!b || !gridEl?.contains(b)) return;
    e.stopPropagation();
    const d = b.dataset;
    try {
      if (d.close) return closeGrid(true);
      if (d.more) return say(await post("/video/browse", { action: "more" }));
      if (d.f) {
        const f = { newest: { newest: true }, popular: { popular: true }, long: { minSecs: 1200 }, short: { maxSecs: 600 }, noShorts: { noShorts: true }, reset: { reset: true } }[d.f];
        return say(await post("/video/browse", { action: "refine", filters: f }));
      }
      if (d.queue) { const r = await post("/video/browse", { action: "queue", n: Number(d.queue) }); say(r); b.textContent = "✓ Queued"; return; }
      if (d.shuffle) { const x = G.items[Number(d.shuffle) - 1]; closeGrid(false); return say(await post("/video/playlists", { action: "shuffle", playlistId: x.playlistId, title: x.title, name: x.title })); }
      if (d.play) return say(await post("/video/browse", { action: "pick", n: Number(d.play) }));
    } catch (err) { note("Videos", err.message); }
  }

  // ---------------------------------------------------------------- the queue
  let Qs = null, qEl = null, from = null;
  const qOpen = () => Boolean(qEl);
  function renderQueue(q = Qs) {
    if (q) Qs = q;
    if (!qEl) return;
    const s = Qs ?? { items: [], index: -1 };
    const rep = { off: "Repeat: off", all: "Repeat: all", one: "Repeat: this one" }[s.repeat] ?? "Repeat";
    qEl.innerHTML = `<header><h2>${esc(s.source?.name ? `Queue · ${s.source.name}` : "Queue")} <small style="color:var(--muted,#a4abcc);font-size:.75em">${s.total ?? 0} ${s.total === 1 ? "video" : "videos"}</small></h2>
        <button class="dsv-b" data-qa="shuffle" aria-pressed="${s.shuffle ? "true" : "false"}" title="Shuffle what's up next">⤮ Shuffle</button>
        <button class="dsv-b" data-qa="repeat" aria-pressed="${s.repeat !== "off" ? "true" : "false"}" title="${rep}">${s.repeat === "one" ? "↻ One" : s.repeat === "all" ? "↻ All" : "↻ Off"}</button>
        <button class="dsv-b" data-qa="clear" title="Remove everything except what's playing">Clear</button><button class="dsv-b" data-qa="close" aria-label="Close the queue">✕</button></header>
      ${s.items?.length ? `<ol>${s.items.map((x) => `<li draggable="true" data-n="${x.n}" class="${x.current ? "cur" : ""}" title="Play number ${x.n}" ${x.current ? 'aria-current="true"' : ""}><span class="n">${x.current ? "▶" : x.n}</span>
          <span class="im" style="${x.videoId ? `background-image:url('https://i.ytimg.com/vi/${esc(x.videoId)}/mqdefault.jpg')` : ""}"></span>
          <div style="min-width:0"><b>${esc(x.title)}</b><span class="sub">${x.current ? `<span class="now">NOW PLAYING · </span>` : ""}${esc([x.channel, x.length || (x.secs ? mmss(x.secs) : "")].filter(Boolean).join(" · "))}</span></div>
          <span class="acts"><button class="ib" data-up="${x.n}" aria-label="Move number ${x.n} up" title="Move up">▲</button><button class="ib" data-down="${x.n}" aria-label="Move number ${x.n} down" title="Move down">▼</button><button class="ib" data-del="${x.n}" aria-label="Remove number ${x.n}" title="Remove">✕</button></span></li>`).join("")}</ol>`
        : `<div class="dsv-empty">The queue is empty. Say “queue” and a video, or use ＋ Queue on any video.</div>`}`;
    const cur = qEl.querySelector("li.cur"); if (cur) cur.scrollIntoView({ block: "nearest" });
  }
  function openQueue({ tell = true, fetch: refetch = true } = {}) {
    if (!qEl) { qEl = document.createElement("section"); qEl.id = "dsVQueue"; qEl.setAttribute("role", "dialog"); qEl.setAttribute("aria-label", "The video queue"); document.body.appendChild(qEl); qEl.addEventListener("click", onQueueClick); wireDrag(); }
    renderQueue();
    if (refetch) get("/video/queue").then((r) => renderQueue(r.queue)).catch(() => {});
    if (tell) post("/video/queue", { action: "shown", open: true }).catch(() => {});
  }
  function closeQueue({ tell = true } = {}) { if (qEl) { qEl.remove(); qEl = null; if (tell) post("/video/queue", { action: "shown", open: false }).catch(() => {}); } }
  async function onQueueClick(e) {
    const b = e.target.closest("button, li"); if (!b || !qEl?.contains(b)) return;
    e.stopPropagation();
    const d = b.dataset;
    try {
      if (d.qa === "close") return closeQueue();
      if (d.qa === "clear") return renderQueue((await post("/video/queue", { action: "clear" })).queue);
      if (d.qa === "shuffle") return renderQueue((await post("/video/queue", { action: "shuffle", value: !Qs?.shuffle })).queue);
      if (d.qa === "repeat") { const next = { off: "all", all: "one", one: "off" }[Qs?.repeat ?? "off"]; return renderQueue((await post("/video/queue", { action: "repeat", mode: next })).queue); }
      if (d.up) return renderQueue((await post("/video/queue", { action: "move", n: Number(d.up), to: "up" })).queue);
      if (d.down) return renderQueue((await post("/video/queue", { action: "move", n: Number(d.down), to: "down" })).queue);
      if (d.del) return renderQueue((await post("/video/queue", { action: "remove", n: Number(d.del) })).queue);
      if (d.n) return renderQueue((await post("/video/queue", { action: "jump", n: Number(d.n) })).queue);
    } catch (err) { note("Queue", err.message); }
  }
  function wireDrag() {
    qEl.addEventListener("dragstart", (e) => { const li = e.target.closest("li"); if (li) { from = Number(li.dataset.n); li.classList.add("drag"); } });
    qEl.addEventListener("dragend", (e) => e.target.closest("li")?.classList.remove("drag"));
    qEl.addEventListener("dragover", (e) => { const li = e.target.closest("li"); if (li) { e.preventDefault(); li.classList.add("over"); } });
    qEl.addEventListener("dragleave", (e) => e.target.closest("li")?.classList.remove("over"));
    qEl.addEventListener("drop", async (e) => { const li = e.target.closest("li"); if (!li || from == null) return; e.preventDefault(); li.classList.remove("over"); const to = Number(li.dataset.n); const f = from; from = null; if (f !== to) renderQueue((await post("/video/queue", { action: "move", n: f, to })).queue); });
  }

  // ---------------------------------------------------------------- keys, events
  addEventListener("keydown", (e) => {
    if (!gridEl && !qEl) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "") || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); if (gridEl) closeGrid(true); else closeQueue(); return; }
    if (gridEl && /^[1-9]$/.test(e.key)) { const b = gridEl.querySelector(`.th[data-play="${e.key}"]`); if (b) { e.preventDefault(); e.stopImmediatePropagation(); b.click(); } }
    if (!gridEl && qEl && (e.key === "q" || e.key === "Q")) { e.preventDefault(); e.stopImmediatePropagation(); closeQueue(); }
  }, true);
  const attach = (es) => {
    es.addEventListener("vbrowse", (e) => { try { renderGrid(JSON.parse(e.data)); } catch { /* bad event */ } });
    es.addEventListener("vqueue", (e) => { try { const d = JSON.parse(e.data); if (d.queue) Qs = d.queue; if (d.open === true) openQueue({ tell: false }); else if (d.open === false) closeQueue({ tell: false }); else renderQueue(); } catch { /* bad event */ } });
  };
  if (window.dsEvents) attach(window.dsEvents); else addEventListener("ds-events", (e) => attach(e.detail), { once: true });
  window.dsVQueue = { open: openQueue, close: closeQueue, toggle: () => (qOpen() ? closeQueue() : openQueue()), isOpen: qOpen, render: renderQueue };
  window.dsVideoPanels = { isOpen: () => Boolean(gridEl || qEl), grid: renderGrid, closeGrid, openQueue, closeQueue };
  // (tests and the overlay checks open them with made-up data)
  addEventListener("ds-test-videos", (e) => renderGrid(e.detail));
  addEventListener("ds-test-vqueue", (e) => { Qs = e.detail; openQueue({ tell: false, fetch: false }); renderQueue(e.detail); });
})();
