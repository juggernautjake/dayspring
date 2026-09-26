// The Library on the Dayspring screen: Spotify (your playlists, Liked Songs, recently played, search), videos (search with
// filters, recent videos, the up-next queue, Dayspring's own video playlists) and the queue. It sits over the left column
// so the talk panel stays reachable. Opened from the music card (the shelf button), the ☰ on a video, or by voice:
// "open my library", "browse videos about gardening", "show my recent videos", "show the queue".
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const api = (path, opts) => fetch("/api" + path, opts).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Dayspring couldn't do that just now. Try again in a moment, or restart Dayspring if it keeps happening."); return j; });
  const post = (path, body) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ds = () => window.dayspring ?? {};
  const V = () => window.dsVideos;
  const note = (title, text = "") => ds().toast?.(title, text, "", "bell");
  const thumb = (x) => (x.videoId ? `https://i.ytimg.com/vi/${x.videoId}/mqdefault.jpg` : "");
  const ytUrl = (x) => (x.videoId ? `https://www.youtube.com/watch?v=${x.videoId}${x.playlistId ? "&list=" + x.playlistId : ""}` : `https://www.youtube.com/playlist?list=${x.playlistId}`);
  const mmss = (ms) => { const x = Math.round((ms ?? 0) / 1000); return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, "0")}`; };

  // ---- styles (scoped under .lib) -------------------------------------------------------------------------------------
  const css = document.createElement("style");
  css.textContent = `
  .lib{position:fixed;z-index:17;left:calc(1.2em + var(--sx));top:calc(1em + var(--sy));bottom:calc(1em + var(--sy));width:calc((100vw - 2 * (1.2em + var(--sx)) - 1.3em) * .6078);
    display:flex;flex-direction:column;border-radius:1.2em;overflow:hidden;background:rgba(10,12,32,.94);backdrop-filter:blur(22px);border:1px solid var(--edge2);
    box-shadow:0 30px 90px rgba(0,0,0,.65),0 0 60px rgba(124,140,255,.22);animation:libin .35s var(--ease) both}
  @keyframes libin{from{opacity:0;transform:translateY(.8em) scale(.985)}to{opacity:1;transform:none}}
  .lib[hidden]{display:none}
  .lib header{display:flex;align-items:center;gap:.6em;padding:.7em .9em .55em;border-bottom:1px solid rgba(255,255,255,.07)}
  .lib header h2{margin:0 .4em 0 .2em;font-size:1.05em;font-weight:500;letter-spacing:.02em}
  .lib .ltabs{display:flex;gap:.2em;padding:.18em;border-radius:.8em;background:rgba(255,255,255,.05);border:1px solid var(--edge2)}
  .lib .ltabs button{font:inherit;font-size:.82em;color:var(--muted);background:transparent;border:0;border-radius:.6em;padding:.35em .85em;cursor:pointer}
  .lib .ltabs button[aria-selected="true"]{background:rgba(124,140,255,.35);color:var(--ink)}
  .lib .lx{margin-left:auto;font:inherit;width:2.2em;height:2.2em;border-radius:50%;border:1px solid var(--edge2);background:rgba(255,255,255,.06);color:var(--ink);cursor:pointer}
  .lib .lx:hover,.lib .lx:focus-visible{background:rgba(220,70,110,.7);outline:none}
  .lib .lbody{flex:1;min-height:0;overflow:auto;padding:.7em .9em 1em;scrollbar-width:thin}
  .lib .lsearch{display:flex;gap:.45em;align-items:center;flex-wrap:wrap;margin-bottom:.6em}
  .lib .lsearch input[type=search]{flex:1 1 14em;min-width:0;font:inherit;font-size:.9em;color:var(--ink);background:rgba(255,255,255,.07);border:1px solid var(--edge2);border-radius:.7em;padding:.45em .8em}
  .lib .lsearch input:focus-visible{outline:2px solid var(--violet);outline-offset:1px}
  .lib .chips{display:flex;gap:.25em;flex-wrap:wrap}
  .lib .chips button,.lib .lbtn{font:inherit;font-size:.78em;color:var(--muted);background:rgba(255,255,255,.05);border:1px solid var(--edge2);border-radius:2em;padding:.3em .8em;cursor:pointer;white-space:nowrap}
  .lib .chips button[aria-pressed="true"]{color:var(--ink);background:rgba(124,140,255,.32);border-color:rgba(124,140,255,.55)}
  .lib .lbtn:hover,.lib .chips button:hover{color:var(--ink);background:rgba(124,140,255,.22)}
  .lib .lbtn.go{color:#141633;background:#fff;border-color:#fff}
  .lib h3{font-size:.72em;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:.9em 0 .45em;display:flex;align-items:center;gap:.6em}
  .lib h3 .lbtn{text-transform:none;letter-spacing:0;font-size:1.05em}
  .lib .tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(8.2em,1fr));gap:.6em}
  .lib .tile{position:relative;text-align:left;font:inherit;color:var(--ink);background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:.8em;padding:.45em;cursor:pointer;min-width:0}
  .lib .tile:hover,.lib .tile:focus-visible{background:rgba(124,140,255,.16);outline:none;border-color:rgba(124,140,255,.4)}
  .lib .tile img,.lib .tile .ph{width:100%;aspect-ratio:1;object-fit:cover;border-radius:.55em;display:block;background:linear-gradient(135deg,#5b6cff,#a78bfa 60%,#d58bff)}
  .lib .tile .ph{display:grid;place-items:center;font-size:1.8em}
  .lib .tile b{display:block;font-weight:500;font-size:.82em;margin-top:.35em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lib .tile small{display:block;color:var(--muted);font-size:.72em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lib .rows{display:flex;flex-direction:column;gap:.25em}
  .lib .rowi{display:grid;grid-template-columns:2.6em minmax(0,1fr) auto;gap:.6em;align-items:center;padding:.3em .4em;border-radius:.6em;cursor:pointer}
  .lib .rowi:hover,.lib .rowi:focus-visible{background:rgba(255,255,255,.06);outline:none}
  .lib .rowi img,.lib .rowi .ph{width:2.6em;height:2.6em;border-radius:.4em;object-fit:cover;background:linear-gradient(135deg,#5b6cff,#a78bfa)}
  .lib .rowi b{display:block;font-weight:400;font-size:.86em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lib .rowi small{color:var(--muted);font-size:.74em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
  .lib .acts{display:flex;gap:.25em}
  .lib .ib{font:inherit;font-size:.8em;min-width:2em;height:2em;border-radius:1em;border:1px solid var(--edge2);background:rgba(255,255,255,.05);color:var(--ink);cursor:pointer;padding:0 .6em}
  .lib .ib:hover,.lib .ib:focus-visible{background:rgba(124,140,255,.3);outline:none}
  .lib .vgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(12.5em,1fr));gap:.7em}
  .lib .vcard{position:relative;min-width:0;border-radius:.8em;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);overflow:hidden}
  .lib .vcard .th{position:relative;display:block;width:100%;aspect-ratio:16/9;border:0;padding:0;cursor:pointer;background:#000 center/cover;font:inherit}
  .lib .vcard .th .len{position:absolute;right:.4em;bottom:.4em;font-size:.7em;background:rgba(0,0,0,.8);color:#fff;border-radius:.3em;padding:.05em .4em}
  .lib .vcard .th .pl{position:absolute;inset:auto 0 0 auto;top:0;width:38%;display:grid;place-items:center;background:rgba(0,0,0,.65);color:#fff;font-size:.8em}
  .lib .vcard .th:focus-visible{outline:2px solid var(--violet);outline-offset:-2px}
  .lib .vcard .vt{padding:.4em .55em .5em;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.3em;align-items:start}
  .lib .vcard .vt b{font-weight:400;font-size:.8em;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .lib .vcard .vt small{grid-column:1;color:var(--muted);font-size:.7em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lib .vcard .more{grid-row:1/3;grid-column:2}
  .lib .strip{display:flex;gap:.55em;overflow-x:auto;padding-bottom:.3em;scrollbar-width:thin}
  .lib .strip .vcard{flex:0 0 11em}
  .lib .menu{position:fixed;z-index:40;min-width:12em;padding:.3em;border-radius:.8em;background:rgba(20,22,52,.98);border:1px solid var(--edge2);box-shadow:0 18px 50px rgba(0,0,0,.6)}
  .lib .menu button{display:block;width:100%;text-align:left;font:inherit;font-size:.85em;color:var(--ink);background:transparent;border:0;border-radius:.5em;padding:.45em .7em;cursor:pointer}
  .lib .menu button:hover,.lib .menu button:focus-visible{background:rgba(124,140,255,.3);outline:none}
  .lib .menu hr{border:0;border-top:1px solid rgba(255,255,255,.08);margin:.25em .3em}
  .lib .empty{color:var(--muted);font-size:.85em;padding:.5em .2em}
  .lib .connect{padding:1em;border-radius:1em;background:rgba(124,140,255,.1);border:1px solid rgba(124,140,255,.3);font-size:.9em;line-height:1.5}
  .lib .connect p{margin:.2em 0 .7em;color:#d6d9f5}
  .lib .qrow{display:grid;grid-template-columns:1.2em 2.6em minmax(0,1fr) auto;gap:.55em;align-items:center;padding:.3em .4em;border-radius:.6em}
  .lib .qrow.drag{opacity:.4}.lib .qrow.over{box-shadow:inset 0 2px 0 var(--violet)}
  .lib .qrow .grip{cursor:grab;color:var(--muted);text-align:center}
  .lib .qrow img{width:2.6em;height:2.6em;border-radius:.4em;object-fit:cover;background:#000}
  .lib .qrow b{font-weight:400;font-size:.85em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
  .lib .qrow small{color:var(--muted);font-size:.72em;display:block}
  .lib .cur{outline:1px solid rgba(167,139,250,.6)}
  `;
  document.head.appendChild(css);

  // ---- the panel ------------------------------------------------------------------------------------------------------
  const root = document.createElement("section");
  root.className = "lib"; root.id = "lib"; root.hidden = true;
  root.setAttribute("aria-label", "Library");
  root.innerHTML = `<header><h2>Library</h2>
      <div class="ltabs" role="tablist"><button role="tab" data-tab="music">🎵 Music</button><button role="tab" data-tab="videos">▶ Videos</button><button role="tab" data-tab="queue">☰ Queue</button></div>
      <button class="lx" id="libClose" title="Close (Esc)" aria-label="Close the library">✕</button></header>
    <div class="lbody" id="libBody"></div>`;
  document.body.appendChild(root);
  const body = $("#libBody", root);
  let tab = "music", lastResults = [], vResults = [], vShown = 12, vQuery = "", vKind = "video", vSort = "relevance", sQuery = "", sType = "track", sResults = [], spLib = null, spStatus = null, menuEl = null;
  try { tab = localStorage.getItem("ds-lib-tab") || "music"; } catch { /* storage off */ }

  function open(which, opts = {}) {
    if (which) tab = which;
    try { localStorage.setItem("ds-lib-tab", tab); } catch { /* storage off */ }
    root.hidden = false;
    if (opts.q !== undefined && tab === "videos") { vQuery = opts.q; if (opts.kind) vKind = opts.kind; searchVideos(); }
    else if (opts.q !== undefined && tab === "music") { sQuery = opts.q; if (opts.type) sType = opts.type; searchSpotify(); }
    render();
    if (opts.focus) setTimeout(() => $(`[data-sec="${opts.focus}"]`, body)?.scrollIntoView({ block: "start", behavior: "smooth" }), 80);
  }
  function close() { root.hidden = true; closeMenu(); }
  const isOpen = () => !root.hidden;
  $("#libClose", root).onclick = close;
  $$(".ltabs [data-tab]", root).forEach((b) => (b.onclick = () => open(b.dataset.tab)));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) { if (menuEl) closeMenu(); else close(); e.stopImmediatePropagation(); } }, true);

  function render() {
    $$(".ltabs [data-tab]", root).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    if (tab === "music") renderMusic(); else if (tab === "videos") renderVideos(); else renderQueue();
  }

  // ---- Music: Spotify ----------------------------------------------------------------------------------------------------
  async function renderMusic() {
    body.innerHTML = `<div class="empty">Loading…</div>`;
    try { spStatus = await api("/player/status"); } catch { spStatus = null; }
    if (tab !== "music") return;
    const sp = spStatus?.spotify;
    if (!sp?.signedIn) {
      body.innerHTML = `<div class="connect"><b>Connect Spotify to play it right here</b>
        <p>${sp?.configured ? "Sign in once in your browser and Spotify plays on this screen, with your playlists, Liked Songs and search." : "First add your Spotify Client ID in Settings → Features &amp; apps (the guide shows how, about 5 minutes). Then sign in."}</p>
        ${sp?.configured ? `<button class="lbtn go" data-act="spLogin">Sign in to Spotify</button>` : `<button class="lbtn go" data-act="openSettings">Open Settings</button>`}
        <button class="lbtn" data-act="openHelp">How to set it up</button></div>
        <h3>Videos and YouTube music</h3><p class="empty">YouTube works without any setup: try the Videos tab.</p>`;
      return;
    }
    body.innerHTML = `<form class="lsearch" id="spForm"><input type="search" id="spQ" placeholder="Search Spotify: songs, albums, artists, playlists, podcasts" value="${esc(sQuery)}" aria-label="Search Spotify">
        <div class="chips">${[["track", "Songs"], ["album", "Albums"], ["artist", "Artists"], ["playlist", "Playlists"], ["show", "Podcasts"]].map(([k, l]) => `<button type="button" data-stype="${k}" aria-pressed="${sType === k}">${l}</button>`).join("")}</div></form>
      <div id="spResults"></div><div id="spLib"><div class="empty">Loading your library…</div></div>`;
    $("#spForm", body).onsubmit = (e) => { e.preventDefault(); sQuery = $("#spQ", body).value.trim(); searchSpotify(); };
    $$("[data-stype]", body).forEach((b) => (b.onclick = () => { sType = b.dataset.stype; $$("[data-stype]", body).forEach((x) => x.setAttribute("aria-pressed", String(x === b))); if (sQuery) searchSpotify(); }));
    renderSpResults();
    try { spLib = await api("/player/spotify/library"); } catch (e) { $("#spLib", body).innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    if (tab !== "music" || !$("#spLib", body)) return;
    const pls = spLib.playlists ?? [];
    $("#spLib", body).innerHTML = `<h3 data-sec="playlists">Your playlists</h3><div class="tiles">
        <button class="tile" data-play-liked title="Play your Liked Songs (shuffled)"><div class="ph">💜</div><b>Liked Songs</b><small>${spLib.liked?.length ? "Shuffle" : ""}</small></button>
        ${pls.map((p, i) => `<button class="tile" data-pl="${i}" title="Play ${esc(p.name)}">${p.art ? `<img src="${esc(p.art)}" alt="" loading="lazy">` : `<div class="ph">♪</div>`}<b>${esc(p.name)}</b><small>${p.count != null ? p.count + " songs" : ""}</small></button>`).join("")}</div>
      <h3 data-sec="recent">Recently played</h3>${rowsHtml(spLib.recent ?? [], "rec")}
      <h3 data-sec="liked">Liked Songs</h3>${rowsHtml((spLib.liked ?? []).slice(0, 15), "lk")}
      ${PARTY}`;
    lastResults = [];
  }
  // Parties: Spotify's Jam can only be started in Spotify's own app. Once it's going, pick "Dayspring" as the speaker and
  // everything plays here, with friends' songs showing in Up Next.
  const PARTY = `<h3 data-sec="party">Party / Jam</h3>
    <div class="connect"><b>Listen together with Spotify Jam</b>
      <p>1. In the Spotify app on your phone or computer, open what's playing, tap the <b>speaker/devices</b> icon and choose <b>Dayspring</b>.<br>
      2. Tap <b>Start a Jam</b> (the + person icon on the playing screen). Friends join with the QR code or link and add songs.<br>
      The music plays here and Dayspring's controls and Up Next keep working, including the songs friends add. Starting a Jam can only be done in Spotify's app, not by Dayspring itself.</p>
      <p><b>Discord “Listen Along”:</b> in Discord, go to Settings → Connections → Spotify and connect. When you play Spotify, friends can click <b>Listen Along</b> on your profile. Everyone needs Spotify Premium. (Dayspring doesn't stream Spotify into voice calls; Spotify's terms don't allow it.)</p>
      <button class="lbtn go" data-act="spApp">Open the Spotify app</button></div>`;
  const rowsHtml = (list, key) => (list.length ? `<div class="rows">${list.map((t, i) => `<div class="rowi" tabindex="0" data-row="${key}:${i}" title="Play">${t.art ? `<img src="${esc(t.art)}" alt="" loading="lazy">` : `<div class="ph"></div>`}<div><b>${esc(t.name)}</b><small>${esc(t.by ?? "")}${t.ms ? " · " + mmss(t.ms) : ""}</small></div>
      <div class="acts"><button class="ib" data-queue="${key}:${i}" title="Add to the queue">＋ Queue</button><button class="ib" data-spmore="${key}:${i}" title="More: play next, add to a playlist, like" aria-label="More actions">⋯</button></div></div>`).join("")}</div>` : `<div class="empty">Nothing here yet.</div>`);
  // ⋯ for a song: play now, play next, queue, add to one of your playlists, like, open in Spotify
  async function spMenu(btn, t) {
    closeMenu();
    if (!t?.uri) return;
    if (!spLib) { try { spLib = await api("/player/spotify/library"); } catch { spLib = { playlists: [] }; } }
    const mine = (spLib.playlists ?? []).filter((p) => p.mine !== false);
    menuEl = document.createElement("div"); menuEl.className = "menu"; menuEl.setAttribute("role", "menu");
    const id = t.uri.split(":").pop(), kind = t.uri.split(":")[1];
    menuEl.innerHTML = `<button data-s="now">▶ Play now</button><button data-s="next">⤴ Play next</button><button data-s="queue">＋ Add to queue</button><button data-s="like">♡ Like (add to Liked Songs)</button><hr>
      ${mine.length ? mine.slice(0, 12).map((p) => `<button data-s="pl:${esc(p.name)}">☰ Add to ${esc(p.name)}</button>`).join("") : `<div class="empty" style="padding:.3em .7em">No playlists of yours to add to.</div>`}<hr>
      <button data-s="open">↗ Open in Spotify</button>`;
    root.appendChild(menuEl);
    const r = btn.getBoundingClientRect(), mw = 240;
    menuEl.style.left = Math.max(8, Math.min(innerWidth - mw - 8, r.right - mw)) + "px";
    menuEl.style.top = Math.max(8, Math.min(innerHeight - menuEl.offsetHeight - 8, r.bottom + 4)) + "px";
    menuEl.querySelector("button")?.focus();
    menuEl.onclick = async (e) => {
      const s = e.target.closest("[data-s]")?.dataset.s; if (!s) return;
      closeMenu();
      try {
        if (s === "now") await spPlay({ uri: t.uri }, t.name);
        // Spotify's queue has no "insert at the front": a queued song plays after the current one, after anything queued before it
        else if (s === "next" || s === "queue") { await post("/player/spotify/api", { action: "queue", uri: t.uri }); note(s === "next" ? "Up next" : "Added to the queue", t.name); }
        else if (s === "like") { await post("/player/spotify/api", { action: "like", uri: t.uri }); note("Liked", t.name); }
        else if (s.startsWith("pl:")) { const res = await post("/player/spotify/api", { action: "addToPlaylist", uri: t.uri, playlist: s.slice(3) }); note(`Added to ${res.playlist ?? s.slice(3)}`, t.name); }
        else if (s === "open") await post("/open", { url: `https://open.spotify.com/${kind}/${id}` });
      } catch (err) { note("Spotify", err.message); }
      if (tab === "queue") renderQueue();
    };
  }
  async function searchSpotify() {
    if (!sQuery) { sResults = []; renderSpResults(); return; }
    const box = $("#spResults", body); if (box) box.innerHTML = `<div class="empty">Searching…</div>`;
    try { sResults = (await api(`/player/spotify/search?q=${encodeURIComponent(sQuery)}&type=${sType}`)).results ?? []; } catch (e) { sResults = []; if (box) box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    lastResults = sResults.map((x) => ({ kind: "spotify", ...x }));
    renderSpResults();
  }
  function renderSpResults() {
    const box = $("#spResults", body); if (!box) return;
    if (!sQuery || !sResults.length) { box.innerHTML = sQuery ? `<div class="empty">Nothing found for “${esc(sQuery)}”.</div>` : ""; return; }
    box.innerHTML = `<h3>Results for “${esc(sQuery)}”</h3>` + (sType === "track" || sType === "episode" ? rowsHtml(sResults, "sr") :
      `<div class="tiles">${sResults.map((x, i) => `<button class="tile" data-row="sr:${i}" title="Play ${esc(x.name)}">${x.art ? `<img src="${esc(x.art)}" alt="" loading="lazy">` : `<div class="ph">♪</div>`}<b>${esc(x.name)}</b><small>${esc(x.by ?? "")}</small></button>`).join("")}</div>`);
  }
  let spQueue = [];
  const spItem = (ref) => {
    if (ref === "cur") { const P = ds().player ?? {}; return P.uri ? { uri: P.uri, name: P.title, by: P.artist } : null; }
    const [k, i] = ref.split(":"); return (k === "rec" ? spLib?.recent : k === "lk" ? spLib?.liked : k === "q" ? spQueue : sResults)?.[Number(i)];
  };
  async function spPlay(args, label) {
    try { const r = await post("/player/spotify/api", { action: "play", ...args }); note("Playing", r.title || label || ""); }
    catch (e) { note("Spotify", e.message); }
  }

  // ---- Videos -------------------------------------------------------------------------------------------------------------
  async function renderVideos() {
    const hist = V()?.history() ?? [], q = V()?.queue() ?? [];
    let lists = [];
    try { lists = (await api("/player/videolists")).lists ?? []; } catch { /* none */ }
    if (tab !== "videos") return;
    body.innerHTML = `<form class="lsearch" id="vForm"><input type="search" id="vQ" placeholder="Search YouTube" value="${esc(vQuery)}" aria-label="Search YouTube">
        <div class="chips">${[["video", "Videos"], ["playlist", "Playlists"]].map(([k, l]) => `<button type="button" data-vkind="${k}" aria-pressed="${vKind === k}">${l}</button>`).join("")}</div>
        <div class="chips">${[["relevance", "Best match"], ["newest", "Newest"], ["popular", "Popular"]].map(([k, l]) => `<button type="button" data-vsort="${k}" aria-pressed="${vSort === k}" ${vKind === "playlist" && k !== "relevance" ? "disabled" : ""}>${l}</button>`).join("")}</div></form>
      <div id="vResults"></div>
      <h3 data-sec="recent">Recent videos ${hist.length ? `<span class="empty" style="padding:0">${hist.length}</span>` : ""}</h3>
      ${hist.length ? `<div class="strip">${hist.slice(0, 20).map((x) => vcard(x, `h:${x.i}`, x.current)).join("")}</div>` : `<div class="empty">Videos you play show up here, so you can go back to them.</div>`}
      <h3 data-sec="upnext">Up next ${q.length ? `<button class="lbtn" data-act="toQueue">Edit queue</button>` : ""}</h3>
      ${q.length ? `<div class="strip">${q.map((x) => vcard(x, `q:${x.i}`)).join("")}</div>` : `<div class="empty">Nothing queued. Use “Play next” or “Add to queue” on any video.</div>`}
      <h3 data-sec="lists">My video playlists <button class="lbtn" data-act="newList">＋ New playlist</button></h3>
      ${lists.length ? `<div class="tiles">${lists.map((l) => `<button class="tile" data-vlist="${esc(l.id)}" title="Play ${esc(l.name)}">${l.items[0]?.videoId ? `<img src="${thumb(l.items[0])}" alt="" loading="lazy" style="aspect-ratio:16/9">` : `<div class="ph" style="aspect-ratio:16/9">▶</div>`}<b>${esc(l.name)}</b><small>${l.items.length} video${l.items.length === 1 ? "" : "s"}</small></button>`).join("")}</div>` : `<div class="empty">Make a playlist, then add videos to it from any video's ⋯ menu, or say “add this video to my Worship playlist”.</div>`}`;
    $("#vForm", body).onsubmit = (e) => { e.preventDefault(); vQuery = $("#vQ", body).value.trim(); searchVideos(); };
    $$("[data-vkind]", body).forEach((b) => (b.onclick = () => { vKind = b.dataset.vkind; if (vKind === "playlist") vSort = "relevance"; renderVideos(); if (vQuery) searchVideos(); }));
    $$("[data-vsort]", body).forEach((b) => (b.onclick = () => { vSort = b.dataset.vsort; $$("[data-vsort]", body).forEach((x) => x.setAttribute("aria-pressed", String(x === b))); if (vQuery) searchVideos(); }));
    renderVResults();
  }
  function vcard(x, ref, current = false) {
    const t = thumb(x);
    return `<div class="vcard${current ? " cur" : ""}"><button class="th" data-vplay="${ref}" title="Play ${esc(x.title)}" style="${t ? `background-image:url('${t}')` : "background:linear-gradient(135deg,#27305f,#52317a)"}">
        ${x.length ? `<span class="len">${esc(x.length)}</span>` : ""}${x.playlistId && !x.videoId ? `<span class="pl">☰ ${x.count ? esc(x.count) : "Playlist"}</span>` : ""}${x.at > 15 ? `<span class="len" style="left:.4em;right:auto">▶ ${Math.floor(x.at / 60)}:${String(Math.floor(x.at % 60)).padStart(2, "0")}</span>` : ""}</button>
      <div class="vt"><b>${esc(x.title || "Video")}</b><button class="ib more" data-vmore="${ref}" title="More: play next, queue, playlist, open in browser" aria-label="More actions">⋯</button>
      <small>${esc([x.channel, x.views, x.age].filter(Boolean).join(" · "))}</small></div></div>`;
  }
  async function searchVideos() {
    const box = $("#vResults", body); if (box) box.innerHTML = `<div class="empty">Searching YouTube…</div>`;
    vShown = 12;
    try { vResults = (await api(`/player/youtube/search?q=${encodeURIComponent(vQuery)}&kind=${vKind}&sort=${vSort}`)).results ?? []; }
    catch (e) { vResults = []; if ($("#vResults", body)) $("#vResults", body).innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    lastResults = vResults.map((x) => ({ kind: "video", ...x }));
    renderVResults();
  }
  function renderVResults() {
    const box = $("#vResults", body); if (!box) return;
    if (!vQuery) { box.innerHTML = ""; return; }
    if (!vResults.length) { box.innerHTML = `<div class="empty">Nothing found for “${esc(vQuery)}”.</div>`; return; }
    box.innerHTML = `<h3>${vKind === "playlist" ? "Playlists" : "Videos"} for “${esc(vQuery)}”</h3><div class="vgrid">${vResults.slice(0, vShown).map((x, i) => vcard(x, `r:${i}`)).join("")}</div>
      ${vResults.length > vShown ? `<p style="text-align:center"><button class="lbtn" data-act="more">Load more</button></p>` : ""}`;
  }
  const vRef = (ref) => { const [k, i] = ref.split(":"); const n = Number(i); return k === "r" ? vResults[n] : k === "h" ? V()?.history().find((x) => x.i === n) : k === "q" ? V()?.queue()[n] : null; };
  function playVideo(x, ref) {
    if (!x) return;
    if (ref?.startsWith("h:")) V()?.playHistory(Number(ref.slice(2)));
    else if (ref?.startsWith("q:")) { const n = Number(ref.slice(2)); V()?.remove(n); V()?.play(x); }
    else V()?.play(x);
  }
  async function playVideoList(id, { shuffle = false } = {}) {
    const l = (await api("/player/videolists")).lists.find((x) => x.id === id || x.name === id);
    if (!l?.items.length) { note("Playlist", "That playlist is empty."); return; }
    const items = shuffle ? [...l.items].sort(() => Math.random() - 0.5) : l.items;
    V()?.play(items[0]);
    items.slice(1).reverse().forEach((x) => V()?.add(x, { next: true }));
    note("Playing", `${l.name} (${l.items.length} video${l.items.length === 1 ? "" : "s"})`);
  }

  // ---- a small menu of actions for one video --------------------------------------------------------------------------
  function closeMenu() { menuEl?.remove(); menuEl = null; }
  async function openMenu(btn, ref) {
    closeMenu();
    const x = vRef(ref); if (!x) return;
    let lists = []; try { lists = (await api("/player/videolists")).lists ?? []; } catch { /* none */ }
    menuEl = document.createElement("div"); menuEl.className = "menu"; menuEl.setAttribute("role", "menu");
    menuEl.innerHTML = `<button data-m="now">▶ Play now</button><button data-m="music">♪ Play as music (no picture)</button><button data-m="next">⤴ Play next</button><button data-m="queue">＋ Add to queue</button><hr>
      ${lists.map((l) => `<button data-m="add:${esc(l.id)}">☰ Add to ${esc(l.name)}</button>`).join("")}<button data-m="newlist">＋ New playlist with this…</button><hr>
      <button data-m="open">↗ Open in my browser</button><button data-m="copy">⧉ Copy link</button>${ref.startsWith("q:") ? `<button data-m="unqueue">✕ Remove from queue</button>` : ""}`;
    root.appendChild(menuEl);
    const r = btn.getBoundingClientRect(), mw = 230;
    menuEl.style.left = Math.max(8, Math.min(innerWidth - mw - 8, r.right - mw)) + "px";
    menuEl.style.top = Math.min(innerHeight - menuEl.offsetHeight - 8, r.bottom + 4) + "px";
    menuEl.querySelector("button")?.focus();
    menuEl.onclick = async (e) => {
      const m = e.target.closest("[data-m]")?.dataset.m; if (!m) return;
      closeMenu();
      try {
        if (m === "now") playVideo(x, ref);
        else if (m === "music") V()?.play(x, { audioOnly: true });
        else if (m === "next") { if (!ds().player?.source) V()?.play(x); else { V()?.add(x, { next: true }); note("Up next", x.title); } }
        else if (m === "queue") { if (!ds().player?.source) V()?.play(x); else { V()?.add(x); note("Added to the queue", x.title); } }
        else if (m.startsWith("add:")) { const r2 = await post("/player/videolists", { action: "add", list: m.slice(4), item: x }); note(`Added to ${r2.result.name}`, x.title); }
        else if (m === "newlist") { const name = await prompt2("Name for the new playlist"); if (name) { const r2 = await post("/player/videolists", { action: "add", list: name, create: true, item: x }); note(`Added to ${r2.result.name}`, x.title); } }
        else if (m === "open") { await post("/open", { url: ytUrl(x) }); note("Opened in your browser", x.title); }
        else if (m === "copy") { try { await navigator.clipboard.writeText(ytUrl(x)); note("Link copied", ytUrl(x)); } catch { note("The link", ytUrl(x)); } }
        else if (m === "unqueue") V()?.remove(Number(ref.slice(2)));
      } catch (err) { note("Couldn't do that", err.message); }
      if (tab === "videos") renderVideos(); else if (tab === "queue") renderQueue();
    };
  }
  // a name box that works on a kiosk screen (no browser prompt dialogs)
  function prompt2(label) {
    const n = document.createElement("form"); n.className = "menu"; n.style.cssText = "left:50%;top:40%;transform:translateX(-50%);padding:.8em;min-width:18em";
    n.innerHTML = `<label style="display:block;font-size:.85em;color:var(--muted);margin-bottom:.4em">${esc(label)}</label><input style="width:100%;font:inherit;color:var(--ink);background:rgba(255,255,255,.08);border:1px solid var(--edge2);border-radius:.6em;padding:.45em .7em" maxlength="60">
      <div style="display:flex;gap:.4em;justify-content:flex-end;margin-top:.6em"><button type="button" class="lbtn" data-c>Cancel</button><button class="lbtn go">Save</button></div>`;
    root.appendChild(n); const inp = $("input", n); inp.focus();
    return new Promise((ok) => { n.onsubmit = (e) => { e.preventDefault(); n.remove(); ok(inp.value.trim()); }; $("[data-c]", n).onclick = () => { n.remove(); ok(""); }; });
  }

  // ---- Queue ---------------------------------------------------------------------------------------------------------------
  async function renderQueue() {
    const P = ds().player ?? {}, q = V()?.queue() ?? [];
    let spq = null;
    if (P.source === "spotify") { try { spq = await api("/player/spotify/queue"); } catch { spq = null; } }
    if (tab !== "queue") return;
    spQueue = spq?.next ?? [];
    body.innerHTML = `${P.source ? `<h3>Now playing</h3><div class="rowi cur" style="cursor:default">${P.art ? `<img src="${esc(P.art)}" alt="">` : `<div class="ph"></div>`}<div><b>${esc(P.title || "—")}</b><small>${esc(P.artist || "")}</small></div>
        <div class="acts">${P.source === "spotify" && P.uri ? `<button class="ib" data-sp-like title="Add to Liked Songs">♡ Like</button><button class="ib" data-spmore="cur" title="Add to a playlist and more" aria-label="More actions">⋯</button>` : ""}</div></div>` : ""}
      ${spq ? `<h3>Up next on Spotify <span class="empty" style="padding:0;text-transform:none;letter-spacing:0">click one to jump to it</span></h3>${spq.next?.length ? `<div class="rows">${spq.next.map((t, i) => `<div class="rowi" tabindex="0" data-skipto="${i + 1}" title="Jump to this song (skips the ones before it)">${t.art ? `<img src="${esc(t.art)}" alt="" loading="lazy">` : `<div class="ph"></div>`}<div><b>${esc(t.name)}</b><small>${esc(t.by)}${t.ms ? " · " + mmss(t.ms) : ""}</small></div><div class="acts"><button class="ib" data-spmore="q:${i}" aria-label="More actions">⋯</button></div></div>`).join("")}</div>` : `<div class="empty">Nothing lined up. Say “queue” and a song, or use ＋ Queue in Music. In a Jam, songs friends add show up here.</div>`}` : ""}
      <h3>Video queue ${q.length ? `<button class="lbtn" data-act="clearQueue">Clear</button>` : ""}</h3>
      ${q.length ? `<div class="rows" id="qList">${q.map((x) => `<div class="qrow" draggable="true" data-qi="${x.i}"><span class="grip" title="Drag to reorder">⠿</span>${x.videoId ? `<img src="${thumb(x)}" alt="" loading="lazy">` : `<div class="ph"></div>`}
          <div><b>${esc(x.title || "Video")}</b><small>${esc(x.channel || "")}</small></div>
          <div class="acts"><button class="ib" data-qup="${x.i}" title="Move up" aria-label="Move up">▲</button><button class="ib" data-qdown="${x.i}" title="Move down" aria-label="Move down">▼</button><button class="ib" data-vplay="q:${x.i}" title="Play now">▶</button><button class="ib" data-qdel="${x.i}" title="Remove" aria-label="Remove">✕</button></div></div>`).join("")}</div>`
        : `<div class="empty">No videos queued. In Videos, use a video's ⋯ menu → Play next or Add to queue, or say “add this to the queue”.</div>`}`;
    // drag to reorder
    let from = null;
    $$(".qrow", body).forEach((row) => {
      row.addEventListener("dragstart", () => { from = Number(row.dataset.qi); row.classList.add("drag"); });
      row.addEventListener("dragend", () => row.classList.remove("drag"));
      row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("over"); });
      row.addEventListener("dragleave", () => row.classList.remove("over"));
      row.addEventListener("drop", (e) => { e.preventDefault(); row.classList.remove("over"); if (from !== null) { V()?.move(from, Number(row.dataset.qi)); from = null; renderQueue(); } });
    });
  }

  // ---- clicks -----------------------------------------------------------------------------------------------------------
  root.addEventListener("click", async (e) => {
    const el = e.target.closest("button, [data-row], [data-vplay], [data-skipto], .tile");
    if (!el || !root.contains(el)) return;
    const d = el.dataset;
    try {
      if (d.act === "spLogin") { await post("/player/spotify/login", {}); note("Spotify", "The sign-in page opened in your browser. Sign in there, then come back."); }
      else if (d.act === "openSettings") { close(); ds().ask?.("open settings"); }
      else if (d.act === "openHelp") { close(); await post("/open", { url: `${location.origin}/help#music` }).catch(() => {}); }
      else if (d.act === "more") { vShown += 12; renderVResults(); }
      else if (d.act === "newList") { const name = await prompt2("Name for the new video playlist"); if (name) { await post("/player/videolists", { action: "create", name }); renderVideos(); } }
      else if (d.act === "toQueue") open("queue");
      else if (d.act === "spApp") { const r2 = await post("/player/spotify/app", {}); note("Spotify", r2.opened === "app" ? "The Spotify app is opening. Choose Dayspring as the speaker, then Start a Jam." : "Spotify opened in your browser. Choose Dayspring as the device, then Start a Jam."); }
      else if (d.spmore) spMenu(el, spItem(d.spmore));
      else if ("spLike" in d) { const P = ds().player ?? {}; await post("/player/spotify/api", { action: "like", uri: P.uri }); note("Liked", P.title); }
      else if (d.skipto) { await post("/player/spotify/api", { action: "skipTo", count: Number(d.skipto) }); note("Jumping ahead", spQueue[Number(d.skipto) - 1]?.name ?? ""); setTimeout(renderQueue, 1500); }
      else if (d.act === "clearQueue") { V()?.clear(); renderQueue(); }
      else if ("playLiked" in d) spPlay({ type: "liked", shuffle: true }, "Liked Songs");
      else if (d.pl !== undefined) { const p = spLib.playlists[Number(d.pl)]; spPlay({ uri: p.uri }, p.name); }
      else if (d.queue) { const t = spItem(d.queue); await post("/player/spotify/api", { action: "queue", uri: t.uri }); note("Added to the queue", t.name); }
      else if (d.row) { const t = spItem(d.row); spPlay({ uri: t.uri }, t.name); }
      else if (d.vplay) { playVideo(vRef(d.vplay), d.vplay); if (tab === "queue") renderQueue(); }
      else if (d.vmore) openMenu(el, d.vmore);
      else if (d.vlist) playVideoList(d.vlist);
      else if (d.qdel !== undefined) { V()?.remove(Number(d.qdel)); renderQueue(); }
      else if (d.qup !== undefined) { const i = Number(d.qup); if (i > 0) V()?.move(i, i - 1); renderQueue(); }
      else if (d.qdown !== undefined) { const i = Number(d.qdown); V()?.move(i, i + 1); renderQueue(); }
    } catch (err) { note("Couldn't do that", err.message); }
  });
  root.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches(".rowi[data-row], .rowi[data-skipto]")) e.target.click(); });
  document.addEventListener("click", (e) => { if (menuEl && !menuEl.contains(e.target) && !e.target.closest("[data-vmore], [data-spmore]")) closeMenu(); });

  // ---- voice and typing -------------------------------------------------------------------------------------------------
  const ORD = { first: 0, "1st": 0, one: 0, second: 1, "2nd": 1, two: 1, third: 2, "3rd": 2, three: 2, fourth: 3, "4th": 3, four: 3, fifth: 4, "5th": 4, five: 4, sixth: 5, seventh: 6, eighth: 7, last: -1 };
  const pickResult = (w) => { const i = ORD[w]; if (i === undefined || !lastResults.length) return null; return lastResults[i < 0 ? lastResults.length - 1 : i] ?? null; };
  // Returns { say, speak } when it handled the phrase, else null.
  function command(text) {
    const t = String(text).toLowerCase().replace(/[!?,]/g, "").replace(/\.(?!\d)/g, "").replace(/\s+/g, " ").trim().replace(/^(please |can you |could you |hey |dayspring )+/, "").replace(/ please$/, "");
    const P = ds().player ?? {}, r = (say, speak = false) => ({ say, speak });
    // the same words with their capitals kept, for names ("make a playlist called Morning Hymns")
    const orig = String(text).replace(/[!?,]/g, "").replace(/\.(?!\d)/g, "").replace(/\s+/g, " ").trim().replace(/^(please |can you |could you |hey |dayspring )+/i, "").replace(/ please$/i, "");
    const named = (re) => re.exec(orig);
    let m;
    if (/^(close|hide|exit)( the| my)? (library|browser|video browser|queue)$/.test(t) && isOpen()) { close(); return r(""); }
    if ((m = /^(?:browse|search|find|look up|show me|pull up)(?: youtube| some)?(?: for)? (videos?|playlists?) (?:about|of|on|for|with) (.+)$|^what'?s on youtube (?:about|for) (.+)$|^search youtube for (.+)$|^browse videos$/.exec(t))) {
      const q = (m[2] ?? m[3] ?? m[4] ?? "").trim();
      open("videos", { q, kind: /playlist/.test(m[1] ?? "") ? "playlist" : "video" });
      return r(q ? `Here are videos about ${q}.` : "Here are your videos.", true);
    }
    if (/^(show|open|pull up)( me)? (my )?(recent|last|previous) videos$|^(what did i|what have i) (watch|watched)( lately| recently)?$/.test(t)) { open("videos", { focus: "recent" }); return r("Here are your recent videos.", true); }
    if (/^(show|open|pull up)( me)? (my |the )?(library|music library|playlists|spotify playlists)$|^open my music$/.test(t)) { open("music", { focus: "playlists" }); return r("Here's your library.", true); }
    if (/^(show|open)( me)? (the |my )?(queue|up next|video queue)$|^what'?s (in|on) (the|my) queue$|^what'?s (up next|coming up)$/.test(t)) {
      open("queue");
      const up = P.source === "spotify" ? (P.upNext ?? []).map((x) => x.title) : (V()?.queue() ?? []).map((x) => x.title);
      return r(up.length ? `Next up: ${up.slice(0, 3).join(", then ")}.` : "Nothing's lined up right now.", true);
    }
    // Spotify search: "search Spotify for Yiruma", "find the album Abbey Road on Spotify"
    if ((m = /^(?:search|look up|find)(?: on)? spotify for (.+)$|^(?:search|look up|find) (.+?) on spotify$/.exec(t))) {
      let q = (m[1] ?? m[2]).trim(), type = "track";
      const k = /^(?:the )?(album|artist|playlist|podcast|song)s? (.+)$/.exec(q); if (k) { type = { album: "album", artist: "artist", playlist: "playlist", podcast: "show", song: "track" }[k[1]]; q = k[2]; }
      open("music", { q, type });
      return r(`Here's what Spotify has for ${q}.`, true);
    }
    // a party: Spotify's Jam starts in Spotify's own app; Dayspring opens it and explains the two steps
    if (/^(start|begin|host|throw|have|make)( us)? (a |an )?(spotify )?(jam|party|listening party|music party)$|^(let'?s )?(have|start) a (jam|party)$/.test(t)) {
      post("/player/spotify/app", {}).catch(() => {});
      open("music", { focus: "party" });
      return r("Opening Spotify. Tap the speaker icon and pick Dayspring, then tap Start a Jam. Friends join with the QR code, and their songs show up here in Up Next.", true);
    }
    // results on screen: "play the second one", "add the third one to the queue", "queue that one"
    if ((m = /^(?:play|put on|start) the (first|second|third|fourth|fifth|sixth|seventh|eighth|last|1st|2nd|3rd|4th|5th) (?:one|video|result|song|playlist)$/.exec(t)) && lastResults.length) {
      const x = pickResult(m[1]); if (!x) return null;
      if (x.kind === "video") V()?.play(x); else spPlay({ uri: x.uri }, x.name);
      return r("");
    }
    if ((m = /^(?:add|put) the (first|second|third|fourth|fifth|sixth|seventh|eighth|last|1st|2nd|3rd|4th|5th) (?:one|video|result|song)(?: to)?(?: the| my)? (?:queue|up next)$|^queue the (first|second|third|fourth|fifth|last) (?:one|video|song)$/.exec(t)) && lastResults.length) {
      const x = pickResult(m[1] ?? m[2]); if (!x) return null;
      if (x.kind === "video") { if (!P.source) V()?.play(x); else V()?.add(x); } else post("/player/spotify/api", { action: "queue", uri: x.uri }).catch((e) => note("Spotify", e.message));
      return r(`Added ${x.title ?? x.name} to the queue.`);
    }
    // the video that's playing
    if (P.source === "youtube") {
      const cur = V()?.current();
      if (/^(add (this|it|that)( video| one)? to the queue|queue (this|it|that)( one| video)?|queue that one)$/.test(t)) {
        const x = lastResults.find((y) => y.kind === "video") && /that one/.test(t) ? lastResults.find((y) => y.kind === "video") : cur;
        if (x) V()?.add(x); return r("Added to the queue.");
      }
      if ((m = named(/^(?:add|save|put) (?:this|it|that)(?: video)? (?:to|in|on) (?:my |the )?(.+?)(?: videos?)?(?: playlist| list)$/i)) && cur) {
        post("/player/videolists", { action: "add", list: m[1], create: true, item: cur }).then((res) => note(`Added to ${res.result.name}`, cur.title)).catch((e) => note("Couldn't add it", e.message));
        return r(`Added it to ${m[1]}.`);
      }
    }
    if ((m = named(/^(?:make|create|start) (?:a |me a )?(?:new )?(?:video )?playlist (?:called|named) (.+)$/i))) {
      post("/player/videolists", { action: "create", name: m[1] }).then(() => { if (isOpen() && tab === "videos") renderVideos(); }).catch((e) => note("Couldn't make it", e.message));
      return r(`Made a video playlist called ${m[1]}. Say “add this video to my ${m[1]} playlist” while one is playing.`);
    }
    if ((m = /^(?:play|shuffle|put on) (?:my |the )?(.+?) (?:videos? playlist|video list|videos)$/.exec(t))) {
      const name = m[1], shuffle = /^shuffle/.test(t);
      api("/player/videolists").then((res) => {
        const l = res.lists.find((x) => x.name.toLowerCase() === name) ?? res.lists.find((x) => x.name.toLowerCase().includes(name));
        if (l) playVideoList(l.id, { shuffle }); else note("Video playlists", `There's no video playlist called ${name}.`);
      }).catch(() => {});
      return r("");
    }
    // Spotify, about what's playing
    if (P.source === "spotify" && P.uri) {
      if (/^(like|save|heart) (this|this song|it|that song|the song)$|^i (love|like) this song$|^add (this|it) to my liked songs$/.test(t)) {
        post("/player/spotify/api", { action: "like", uri: P.uri }).then(() => note("Liked", P.title)).catch((e) => note("Spotify", e.message));
        return r("Added to your Liked Songs.");
      }
      if ((m = /^(?:add|save|put) (?:this|it|that)(?: song)? (?:to|in|on) (?:my |the )?(.+?)(?: playlist)$/.exec(t))) {
        post("/player/spotify/api", { action: "addToPlaylist", uri: P.uri, playlist: m[1] }).then((res) => note(`Added to ${res.playlist ?? m[1]}`, P.title)).catch((e) => note("Spotify", e.message));
        return r(`Adding it to ${m[1]}.`);
      }
    }
    if ((m = /^(?:queue|queue up|add) (.+?)(?: to the queue| next)?$/.exec(t)) && /^(queue|queue up)\b|to the queue$/.test(t) && P.source === "spotify" && !/^(this|it|that)\b/.test(m[1])) {
      post("/player/spotify/api", { action: "queue", query: m[1] }).then(() => note("Queued", m[1])).catch((e) => note("Spotify", e.message));
      return r(`Queued ${m[1]}.`);
    }
    return null;
  }

  // Dayspring's video playlists, kept at hand so "play my Workout playlist" can tell them from Spotify playlists
  let vlCache = [];
  const refreshLists = () => api("/player/videolists").then((r) => { vlCache = r.lists ?? []; }).catch(() => {});
  refreshLists(); setInterval(refreshLists, 60_000);
  const baseCommand = command;
  command = (text) => {
    const t = String(text).toLowerCase().replace(/[!?,.]/g, "").trim().replace(/^(please |hey |dayspring )+/, "");
    const m = /^(play|shuffle|put on) (?:my |the )?(.+?) playlist$/.exec(t);
    if (m && vlCache.length) {
      const name = m[2].replace(/\bvideos?\b/g, "").trim();
      const l = vlCache.find((x) => x.name.toLowerCase() === name) ?? vlCache.find((x) => name && x.name.toLowerCase().includes(name));
      if (l) { playVideoList(l.id, { shuffle: m[1] === "shuffle" }); return { say: "", speak: false }; }
    }
    const out = baseCommand(text);
    if (out && /playlist/.test(t)) setTimeout(refreshLists, 800);
    return out;
  };
  window.dsLibrary = { open, close, isOpen, command: (t) => command(t), playList: (id, o) => playVideoList(id, o), onPlayer: () => { if (isOpen() && tab === "queue") { clearTimeout(window.dsLibrary._t); window.dsLibrary._t = setTimeout(renderQueue, 400); } }, render };
  // Always findable: a "🎵 Music" button beside Settings and Help by the clock (the music card only shows while something plays)
  (function addMusicButton() {
    const util = document.querySelector("#calBtns .util");
    if (!util || util.querySelector("#musicBtn")) return;
    const b = document.createElement("button");
    b.id = "musicBtn"; b.type = "button"; b.title = "Music & videos: search, playlists, the queue"; b.innerHTML = '<i aria-hidden="true">🎵</i>Music';
    b.onclick = () => (isOpen() ? close() : open("music"));
    util.insertBefore(b, util.firstChild);
  })();
})();
