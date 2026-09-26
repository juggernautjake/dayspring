// Discover on the Dayspring screen: the "For you" slide in the rotating panel (a popular video, a short clip or an
// article about something the owner is into, with why they'd like it), a gentle pop-up now and then, and the full list.
// The finding happens on the server (lib/discover.mjs); this shows it. Loaded by tv.html after tv.js.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = (path, body) => fetch("/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  const shown = (e) => api("/screen/shown", e).catch(() => {});
  let feed = [], settings = {}, cur = null, lastRender = 0;

  const css = document.createElement("style");
  css.textContent = `
  .foryou{container-type:inline-size}
  .fy{display:flex;gap:1.1em;align-items:stretch;height:100%;min-height:0}
  .fy-media{position:relative;flex:0 0 46%;max-width:46%;border-radius:.9em;overflow:hidden;background:linear-gradient(135deg,rgba(124,140,255,.35),rgba(167,139,250,.2));cursor:pointer;min-height:8em}
  .fy-media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .fy-media .play{position:absolute;inset:0;margin:auto;width:3.2em;height:3.2em;border-radius:50%;display:grid;place-items:center;background:rgba(0,0,0,.55);color:#fff;font-size:1.2em}
  .fy-media .tile{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.2em;font-size:3.2em}
  .fy-media .tile small{font-size:.24em;letter-spacing:.06em;color:var(--muted,#a4abcc);max-width:90%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .fy-badge{position:absolute;left:.6em;top:.6em;padding:.15em .6em;border-radius:2em;font-size:.78em;font-weight:500;background:rgba(0,0,0,.6);color:#fff;letter-spacing:.02em}
  .fy-badge.short{background:#ff2e63}
  .fy-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:.35em}
  .fy-tag{font-size:.78em;letter-spacing:.08em;text-transform:uppercase;color:var(--violet,#a78bfa)}
  .fy-title{font-size:1.25em;font-weight:500;line-height:1.25;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .fy-meta{color:var(--muted,#a4abcc);font-size:.88em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .fy-why{margin:.2em 0 0;color:var(--ink,#eef0ff);opacity:.9;font-size:.95em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .fy-snip{margin:.1em 0 0;color:var(--muted,#a4abcc);font-size:.9em;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .fy-actions{margin-top:auto;display:flex;flex-wrap:wrap;gap:.4em}
  .fy-actions button,.fyl button{font:inherit;font-size:.85em;color:var(--ink,#eef0ff);background:rgba(255,255,255,.07);border:1px solid var(--edge2,rgba(170,180,255,.28));border-radius:2em;padding:.3em .85em;cursor:pointer}
  .fy-actions button:hover,.fyl button:hover{background:rgba(124,140,255,.3)}
  .fy-actions .go{background:linear-gradient(135deg,#7c8cff,#a78bfa);border-color:transparent;color:#fff}
  .fy-empty{color:var(--muted,#a4abcc);display:grid;place-items:center;height:100%;text-align:center}
  @container (max-width: 30em){ .fy{flex-direction:column} .fy-media{flex:0 0 auto;max-width:100%;height:9em} .fy-actions .more{display:none} }
  .fyl{position:fixed;z-index:47;left:calc(var(--sl,var(--sx,0px)) + 1em);right:calc(var(--sr,var(--sx,0px)) + 1em);top:calc(var(--st,var(--sy,0px)) + 1em);bottom:calc(var(--sb,var(--sy,0px)) + 1em);
    max-width:56em;margin:0 auto;display:flex;flex-direction:column;background:rgba(14,16,40,.97);backdrop-filter:blur(18px);border:1px solid var(--edge2,rgba(170,180,255,.28));border-radius:1.1em;box-shadow:0 24px 70px rgba(0,0,0,.6)}
  .fyl header{display:flex;align-items:center;gap:.6em;padding:.8em 1em;border-bottom:1px solid var(--edge,rgba(160,170,255,.14))}
  .fyl header h2{margin:0;font-size:1.15em;font-weight:500;flex:1}
  .fyl .chips{display:flex;gap:.35em;flex-wrap:wrap;padding:.6em 1em 0}
  .fyl .chips button.on{background:rgba(124,140,255,.35);border-color:var(--indigo,#7c8cff)}
  .fyl ul{list-style:none;margin:0;padding:.6em 1em 1em;overflow:auto;display:grid;gap:.6em;grid-template-columns:repeat(auto-fill,minmax(min(100%,22em),1fr))}
  .fyl li{display:flex;gap:.7em;padding:.6em;border-radius:.8em;background:rgba(255,255,255,.04);border:1px solid var(--edge,rgba(160,170,255,.14))}
  .fyl li.seen{opacity:.75}
  .fyl .th{flex:0 0 7.5em;height:4.6em;border-radius:.5em;background:rgba(124,140,255,.25) center/cover;position:relative;display:grid;place-items:center;font-size:1.6em;cursor:pointer}
  .fyl .th .fy-badge{font-size:.45em;top:.3em;left:.3em}
  .fyl .bd{min-width:0;flex:1;display:flex;flex-direction:column;gap:.2em}
  .fyl .bd b{font-weight:500;font-size:.95em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .fyl .bd small{color:var(--muted,#a4abcc);font-size:.78em}
  .fyl .bd .acts{display:flex;gap:.3em;flex-wrap:wrap;margin-top:auto}
  .fyl .bd .acts button{font-size:.75em;padding:.2em .6em}
  .fyl .none{padding:2em;text-align:center;color:var(--muted,#a4abcc)}
  .toast .fyt{display:flex;gap:.4em;margin-top:.5em}
  .toast .fyt button{font:inherit;font-size:.8em;color:var(--ink,#eef0ff);background:rgba(255,255,255,.08);border:1px solid var(--edge2,rgba(170,180,255,.28));border-radius:2em;padding:.22em .8em;cursor:pointer}`;
  document.head.appendChild(css);

  const typeLabel = (x) => (x.type === "short" ? "Short" : x.type === "video" ? "Video" : "Article");
  const tileIcon = (x) => (x.kind === "discovery" ? "🔭" : x.kind === "news" ? "📰" : "📖");
  const meta = (x) => [x.source, x.views, x.age].filter(Boolean).join(" · ");
  const live = () => feed.filter((x) => !x.dismissed);

  async function load() {
    try { const r = await api("/discover"); feed = r.feed ?? []; settings = r.settings ?? {}; } catch { /* keep */ }
  }
  // the next thing to show: unseen first (newest first), then the rest
  function next() {
    const l = live(); if (!l.length) return null;
    const unseen = l.filter((x) => !x.seen);
    if (unseen.length) return unseen[0];
    const i = cur ? l.findIndex((x) => x.id === cur.id) : -1;
    return l[(i + 1) % l.length];
  }
  function act(it, a) { it[a === "liked" ? "liked" : a === "dismissed" ? "dismissed" : "seen"] = true; return api("/discover/item", { id: it.id, action: a }).catch(() => {}); }
  function open(it) {
    if (!it) return;
    if (it.videoId) { api("/media/play", { videoId: it.videoId, title: it.title }).catch(() => {}); act(it, "played"); }
    else if (it.url) { api("/open", { url: it.url }).catch(() => {}); act(it, "opened"); note("Opened in your browser", it.title); }
  }
  function note(title, text) {
    const box = $("#toasts"); if (!box) return;
    const el = document.createElement("div"); el.className = "toast";
    el.innerHTML = `<div class="row"><b>${esc(title)}</b></div>${text ? `<span>${esc(text)}</span>` : ""}`;
    box.appendChild(el); setTimeout(() => el.remove(), 6000);
  }

  // ---- the For you slide ----
  function render(el) {
    if (!el) return;
    if (!cur || Date.now() - lastRender > 25_000 || cur.dismissed) cur = next();
    lastRender = Date.now();
    if (!cur) { el.innerHTML = `<div class="fy-empty">Tell me what you're into and I'll find good videos and articles about it.<br><small>Say “add hiking to my interests”.</small></div>`; return; }
    const it = cur;
    el.innerHTML = `<div class="fy">
      <div class="fy-media" data-fy="open">${it.thumb ? `<img src="${esc(it.thumb)}" alt="">` : `<div class="tile">${tileIcon(it)}<small>${esc(it.source ?? "")}</small></div>`}<span class="fy-badge${it.type === "short" ? " short" : ""}">${typeLabel(it)}</span>${it.videoId ? `<span class="play">▶</span>` : ""}</div>
      <div class="fy-body">
        <div class="fy-tag">${esc(it.interest)}</div>
        <b class="fy-title" title="${esc(it.title)}">${esc(it.title)}</b>
        <div class="fy-meta">${esc(meta(it))}</div>
        ${it.type === "article" && it.snippet ? `<p class="fy-snip">${esc(it.snippet)}</p>` : ""}${it.why && !/^From /.test(it.why) ? `<p class="fy-why">✨ ${esc(it.why)}</p>` : ""}
        <div class="fy-actions"><button class="go" data-fy="open">${it.videoId ? "▶ Watch" : "Open ↗"}</button><button data-fy="like" title="More like this">👍 More like this</button><button data-fy="nope" title="Not interested">👎</button><button class="more" data-fy="list">All finds (${live().length})</button></div>
      </div></div>`;
    if (!it.seen) act(it, "shown"); else api("/discover/item", { id: it.id, action: "shown" }).catch(() => {});
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fy]"); if (!b || !b.closest("#vForYou")) return;
    e.stopPropagation();
    const a = b.dataset.fy;
    if (a === "open") open(cur);
    if (a === "like" && cur) { act(cur, "liked"); note("👍 More like this", `Looking for more like “${cur.title}”.`); }
    if (a === "nope" && cur) { act(cur, "dismissed"); cur = null; render($("#vForYou")); }
    if (a === "list") openList();
  }, true);

  // ---- the full list ----
  let listEl = null, filter = "";
  function openList() {
    listEl?.remove();
    listEl = document.createElement("div"); listEl.className = "fyl"; listEl.setAttribute("role", "dialog"); listEl.setAttribute("aria-label", "For you");
    document.body.appendChild(listEl); paintList();
    shown({ kind: "panel", title: "For you", text: live().slice(0, 12).map((x) => `${typeLabel(x)}: ${x.title} (${x.interest})`).join("; ") });
  }
  function paintList() {
    if (!listEl) return;
    const topics = [...new Set(live().map((x) => x.interest))];
    const items = live().filter((x) => !filter || x.interest === filter);
    listEl.innerHTML = `<header><h2>For you</h2><button data-fl="look">🔎 Look now</button><button data-fl="close" aria-label="Close">✕</button></header>
      ${topics.length > 1 ? `<div class="chips"><button data-fl="f" data-t="" class="${!filter ? "on" : ""}">All</button>${topics.map((t) => `<button data-fl="f" data-t="${esc(t)}" class="${filter === t ? "on" : ""}">${esc(t)}</button>`).join("")}</div>` : ""}
      ${items.length ? `<ul>${items.map((x) => `<li class="${x.seen ? "seen" : ""}" data-id="${esc(x.id)}">
        <div class="th" data-fl="open" style="${x.thumb ? `background-image:url('${esc(x.thumb)}')` : ""}">${x.thumb ? "" : tileIcon(x)}<span class="fy-badge${x.type === "short" ? " short" : ""}">${typeLabel(x)}</span></div>
        <div class="bd"><b title="${esc(x.title)}">${esc(x.title)}</b><small>${esc(x.interest)} · ${esc(meta(x))}</small>${x.why ? `<small>${esc(x.why)}</small>` : ""}
          <div class="acts"><button data-fl="open">${x.videoId ? "▶ Watch" : "Open ↗"}</button><button data-fl="like">👍</button><button data-fl="nope">👎</button></div></div></li>`).join("")}</ul>`
        : `<div class="none">Nothing here yet. ${settings.on === false ? "Discover is off in Settings." : "Press “Look now”, or add interests in Settings → You."}</div>`}`;
  }
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-fl]"); if (!b || !listEl?.contains(b)) return;
    const a = b.dataset.fl, it = feed.find((x) => x.id === b.closest("li")?.dataset.id);
    if (a === "close") { listEl.remove(); listEl = null; return; }
    if (a === "f") { filter = b.dataset.t; paintList(); return; }
    if (a === "look") { b.textContent = "Looking…"; const r = await api("/discover/refresh", {}).catch(() => null); await load(); paintList(); if (!r?.items?.length) note("Nothing new right now", r?.why === "no-interests" ? "Add interests in Settings → You." : "I'll keep looking."); return; }
    if (!it) return;
    if (a === "open") open(it);
    if (a === "like") { act(it, "liked"); note("👍 More like this", it.title); }
    if (a === "nope") { act(it, "dismissed"); paintList(); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && listEl) { listEl.remove(); listEl = null; } });

  // ---- a gentle pop-up when something good turns up ----
  function toast(t, items) {
    const box = $("#toasts"); if (!box) return;
    const it = items.find((x) => x.id === t.id) ?? items[0];
    const el = document.createElement("div"); el.className = "toast";
    el.innerHTML = `<div class="row"><b>✨ For you</b></div><span>${esc(t.text)}</span><span>${esc(it?.title ?? "")}</span>
      <div class="fyt"><button data-a="go">${it?.videoId ? "▶ Watch" : "Open ↗"}</button><button data-a="show">Show me</button><button data-a="later">Later</button></div>`;
    box.appendChild(el);
    const bye = () => el.remove();
    el.addEventListener("click", (e) => { const b = e.target.closest("[data-a]"); if (!b) return; if (b.dataset.a === "go") open(it); if (b.dataset.a === "show") { cur = it; window.dsShowcase?.show("forYou", { pin: true }); } bye(); });
    setTimeout(bye, 45_000);
    shown({ kind: "toast", title: "For you", text: `${t.text} ${it?.title ?? ""}` });
  }

  // ---- live updates from the server ----
  function listen(es) {
    es.addEventListener("discover", async (e) => {
      const d = JSON.parse(e.data || "{}");
      await load();
      if (d.kind === "new" && d.toast) toast(d.toast, d.items ?? []);
      if (d.kind === "show") { cur = (d.items ?? [])[0] ? feed.find((x) => x.id === d.items[0].id) ?? null : null; lastRender = Date.now(); if (window.dsShowcase) window.dsShowcase.show("forYou", { pin: true }); }
      if (d.kind === "open") openList();
      if (listEl) paintList();
      if (window.dsShowcase?.current?.() === "forYou" && d.kind !== "show") render($("#vForYou"));
    });
  }
  const hooked = new WeakSet(), hook = (es) => { if (es && !hooked.has(es)) { hooked.add(es); listen(es); } };
  if (window.dsEvents) hook(window.dsEvents);
  window.addEventListener("ds-events", (e) => hook(e.detail));

  window.dsDiscover = { has: () => live().length > 0, render, text: () => (cur ? `${typeLabel(cur)} about ${cur.interest}: ${cur.title}${cur.why ? ` — ${cur.why}` : ""}${cur.url ? ` (${cur.url})` : ""}` : ""), openList, reload: load };
  load();
  setInterval(load, 10 * 60_000);
})();
