// The owner's own music and videos (and Google Drive's) on the Dayspring screen: the player, the numbered list, pictures.
//   Player: the server sends { action: "play", provider: "local", queue: [{ id, src, title, artist, kind, … }], index,
//   shuffle, repeat } on "media". Audio plays with the normal music card (tv.js's controls come here through ctl()), a
//   queue, shuffle and repeat; video plays full screen in the media box. Every file is same-origin (/api/media/local/stream
//   or /api/drive/stream), so this page steers it to Dayspring's chosen output itself (setSinkId, the same choice as
//   lib/sinkpick.mjs: /api/media/local/sink), follows a change within a few seconds, and ducks under Dayspring's voice.
//   List: "medialib" { list: { title, items } } shows a numbered list (click, or say "number 2" / "play them all");
//   { image: { src, title } } shows a picture; { close: true } closes them.
// tv.js hands over its player state through window.dsPlayerHost ({ P, render, stopOthers, musicVol, ducked, clear, push, toast });
// without it (tests) this keeps its own.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const post = (url, body) => fetch("/api" + url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j; });
  const own = { P: { source: null }, render() {}, stopOthers() {}, musicVol: () => 100, ducked: () => false, clear() { own.P.source = null; }, push() {}, toast() {} };
  const H = () => window.dsPlayerHost ?? own;

  // ---- where the sound goes ---------------------------------------------------------------------------------------------
  let pickFn = null, lastCfg = "", sinkId = null, sinkTimer = 0;
  async function applySink(force = false) {
    if (!el || typeof el.setSinkId !== "function") return;
    try {
      const r = await fetch("/api/media/local/sink").then((x) => x.json());
      const cfgStr = JSON.stringify(r.cfg);
      if (!pickFn) pickFn = new Function(`return (${r.pick})`)();
      if (!force && cfgStr === lastCfg && el.sinkId === sinkId) return;
      lastCfg = cfgStr;
      let devs = await navigator.mediaDevices.enumerateDevices();
      const pick = pickFn(devs.filter((d) => d.kind === "audiooutput").map((d) => ({ id: d.deviceId, label: d.label })), r.cfg);
      sinkId = pick.id;
      if (el.sinkId !== sinkId) await el.setSinkId(sinkId).catch(() => {});
      window.__dsLocalSink = { id: sinkId, label: pick.label, how: pick.how };
    } catch { /* keep playing where it is */ }
  }
  navigator.mediaDevices?.addEventListener?.("devicechange", () => setTimeout(() => applySink(true), 800));

  // ---- the player -------------------------------------------------------------------------------------------------------
  let Q = [], order = [], pos = 0, el = null, repeat = "off", shuffleOn = false, tried = new Set(), fade = 0;
  const cur = () => Q[order[pos]] ?? null;
  const vol = () => Math.max(0, Math.min(1, H().musicVol() / 100)) * (H().ducked() ? 0.14 : 1);
  function mkOrder(start) {
    const idx = Q.map((_, i) => i);
    if (!shuffleOn) { order = idx; pos = start; return; }
    const rest = idx.filter((i) => i !== start);
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    order = [start, ...rest]; pos = 0;
  }
  function teardown() {
    clearInterval(sinkTimer);
    if (!el) return;
    try { el.pause(); el.removeAttribute("src"); el.load(); } catch { /* gone */ }
    if (el.dataset.box) { el.remove(); const box = $("#media"); if (box && !box.querySelector("iframe")) { box.hidden = true; box.classList.remove("full", "showctl", "paused"); } const yt = $("#yt"); if (yt) yt.style.display = ""; }
    el = null;
  }
  function start(i, { first = false } = {}) {
    const it = Q[order[i]];
    if (!it) return stop(true);
    pos = i;
    const P = H().P;
    if (P.source && P.source !== "file") H().stopOthers();
    teardown();
    if (it.kind === "video") {
      const box = $("#media");
      el = document.createElement("video");
      el.id = "lv"; el.dataset.box = "1"; el.playsInline = true;
      el.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000";
      if (box) { const yt = $("#yt"); if (yt) yt.style.display = "none"; box.prepend(el); box.hidden = false; box.className = "media video full"; }
      else document.body.appendChild(el);
    } else el = new Audio();
    el.preload = "auto";
    el.src = it.src;
    el.volume = vol();
    const e = el;
    e.addEventListener("loadedmetadata", () => { if (e === el) { const P = H().P; P.dur = Number.isFinite(e.duration) ? e.duration : it.duration || 0; H().render(); } });
    e.addEventListener("timeupdate", () => { if (e === el) { const P = H().P; P.pos = e.currentTime + (it.offset || 0); P.at = Date.now(); } });
    e.addEventListener("playing", () => { if (e === el) { const P = H().P; P.playing = true; P.at = Date.now(); H().render(); } });
    e.addEventListener("pause", () => { if (e === el && !e.ended) { const P = H().P; P.playing = false; P.pos = e.currentTime + (it.offset || 0); H().render(); } });
    e.addEventListener("ended", () => { if (e === el) next(true); });
    e.addEventListener("error", () => {
      if (e !== el) return;
      // a format the screen can't play: converted once when ffmpeg is there, otherwise say so and move on
      if (it.canConvert && !it.converted && it.source === "local" && !tried.has(it.id)) { tried.add(it.id); it.converted = true; it.src += (it.src.includes("?") ? "&" : "?") + "convert=1"; return start(pos); }
      H().push("sys", `${it.title} can't play on the screen${it.ext ? ` (it's a ${String(it.ext).toUpperCase()} file)` : ""}. Say “open it in the default app” to play it on this PC.`);
      if (Q.length > 1 && pos < order.length - 1) next(true); else stop(true);
    });
    Object.assign(P, { source: "file", title: it.title || "Untitled", artist: it.artist || (it.where ?? ""), art: "", playing: false, pos: 0, dur: it.duration || 0, at: Date.now(), shuffle: shuffleOn,
      repeat: repeat === "all" ? "context" : repeat === "one" ? "track" : "off", rate: 1, rates: [1], video: it.kind === "video", playlist: Q.length > 1, videoId: null, sourceLabel: it.source === "drive" ? it.where : "On this computer" });
    H().render();
    applySink(true).finally(() => { if (e === el) e.play().catch(() => {}); });
    clearInterval(sinkTimer); sinkTimer = setInterval(() => applySink(false), 4000);
    if (!first) post("/media/local/played", { id: it.id }).catch(() => {});
  }
  function play(cmd) {
    Q = (cmd.queue ?? []).filter((x) => x && x.src);
    if (!Q.length) return;
    shuffleOn = Boolean(cmd.shuffle); repeat = cmd.repeat ?? "off"; tried = new Set();
    mkOrder(Math.max(0, Math.min(Q.length - 1, Number(cmd.index) || 0)));
    start(pos, { first: true });
  }
  function next(auto = false) {
    if (repeat === "one" && auto) { el.currentTime = 0; el.play().catch(() => {}); return ""; }
    if (pos < order.length - 1) { start(pos + 1); return ""; }
    if (repeat === "all") { if (shuffleOn) mkOrder(order[0]); start(0); return ""; }
    if (auto) { stop(true); return ""; }
    return "That's the last one.";
  }
  function stop(tell = true) {
    teardown();
    Q = []; order = [];
    if (H().P.source === "file") { H().clear(); if (tell) post("/media/stop").catch(() => {}); }
  }
  async function ctl(a, v) {
    if (!el) return "Nothing's playing right now.";
    const P = H().P, it = cur();
    switch (a) {
      case "toggle": return ctl(P.playing ? "pause" : "resume");
      case "pause": el.pause(); break;
      case "resume": case "play": await el.play().catch(() => {}); break;
      case "next": return next(false);
      case "previous": if (el.currentTime > 5 || pos === 0) el.currentTime = 0; else start(pos - 1); break;
      case "historyBack": if (pos > 0) start(pos - 1); break;
      case "historyForward": return next(false);
      case "restart": el.currentTime = 0; break;
      case "seek": case "seekBy": case "back10": case "fwd10": {
        let t = a === "seek" ? Number(v) : el.currentTime + (it.offset || 0) + (a === "back10" ? -10 : a === "fwd10" ? 10 : Number(v));
        t = Math.max(0, P.dur ? Math.min(P.dur - 1, t) : t);
        if (it.converted && it.source === "local") { it.offset = t; const was = !el.paused; el.src = it.src.replace(/&t=\d+(\.\d+)?/, "") + `&t=${Math.floor(t)}`; if (was) el.play().catch(() => {}); }
        else el.currentTime = t;
        P.pos = t; P.at = Date.now(); break;
      }
      case "volume": case "volumeBy": case "mute": case "unmute": return "";   // tv.js sets the level; volume() below applies it
      case "shuffle": { shuffleOn = v === undefined || v === null ? !shuffleOn : Boolean(v); const at = order[pos]; mkOrder(at); P.shuffle = shuffleOn; break; }
      case "repeat": { const m = ["off", "all", "one"]; repeat = v === "context" || v === true ? "all" : v === "track" ? "one" : v === false || v === "off" ? "off" : m[(m.indexOf(repeat) + 1) % 3]; P.repeat = repeat === "all" ? "context" : repeat === "one" ? "track" : "off"; break; }
      case "speed": case "speedBy": el.playbackRate = a === "speed" ? Math.max(0.5, Math.min(2, Number(v) || 1)) : Math.max(0.5, Math.min(2, el.playbackRate + 0.25 * Math.sign(Number(v) || 1))); P.rate = el.playbackRate; break;
      case "full": case "video": { const box = $("#media"); if (it.kind !== "video" || !box) return it.kind === "video" ? "" : "There's no video with this one."; const on = v === undefined || v === null ? !box.classList.contains("full") : Boolean(v); box.classList.toggle("full", on); if (on) { box.classList.remove("minip"); P.mini = false; } break; }
      case "minimize": { const box = $("#media"); if (it.kind !== "video" || !box) return "There's no video to minimize."; const on = v === undefined || v === null ? !box.classList.contains("minip") : Boolean(v); box.classList.toggle("minip", on); if (on) box.classList.remove("full"); else box.classList.add("full"); P.mini = on; break; }
      case "seekPct": { if (!P.dur) return "I can't tell how long this one is yet."; return ctl("seek", P.dur * Math.max(0, Math.min(100, Number(v) || 0)) / 100); }
      // captions: a subtitle track the file carries (or a .vtt next to it, which the stream route offers)
      case "captions": case "captionLang": {
        const tracks = [...(el.textTracks ?? [])].filter((t) => t.kind === "subtitles" || t.kind === "captions");
        if (!tracks.length) return it.kind === "video" ? "This video has no captions." : "Songs don't have captions.";
        const want = a === "captionLang" ? tracks.find((t) => String(t.language).toLowerCase().startsWith(String(v).toLowerCase())) : tracks[0];
        if (a === "captionLang" && !want) return "This video has no captions in that language.";
        const off = a === "captions" && (v === false || (v === undefined && tracks.some((t) => t.mode === "showing")));
        tracks.forEach((t) => { t.mode = !off && t === want ? "showing" : "hidden"; });
        P.captions = !off; break;
      }
      case "quality": return "Your own files play at their own quality.";
      case "queueMode": return "";
      case "popout": return "Only YouTube videos pop out into your browser.";
      case "stop": stop(true); return "";
      default: return "";
    }
    H().render();
    return "";
  }
  function duck(on) {
    if (!el) return;
    cancelAnimationFrame(fade);
    const target = vol(), step = () => { if (!el) return; const d = target - el.volume; if (Math.abs(d) < 0.02) { el.volume = target; return; } el.volume = Math.max(0, Math.min(1, el.volume + d * 0.3)); fade = requestAnimationFrame(step); };
    step();
  }
  function volume() { if (el) el.volume = vol(); }
  window.dsLocalPlayer = { play, ctl, stop, duck, volume, next, current: () => (el ? { ...cur(), position: el.currentTime, sink: el.sinkId ?? null, paused: el.paused } : null), _el: () => el };

  // ---- the numbered list, and pictures -------------------------------------------------------------------------------------
  const css = document.createElement("style");
  css.textContent = `
  .mlpanel{position:fixed;z-index:46;right:calc(1em + var(--sx, 0px));top:calc(1em + var(--sy, 0px));width:min(30em, calc(100vw - 2em));max-height:calc(100vh - 2em - var(--sy, 0px) * 2);display:flex;flex-direction:column;
    border-radius:1.1em;background:rgba(14,17,42,.96);backdrop-filter:blur(18px);border:1px solid var(--edge2, rgba(170,180,255,.28));box-shadow:0 30px 90px rgba(0,0,0,.6);color:var(--ink,#eef0ff);animation:mlin .3s ease}
  @keyframes mlin{from{opacity:0;transform:translateY(.5em)}to{opacity:1;transform:none}}
  .mlpanel header{display:flex;gap:.5em;align-items:center;padding:.8em .9em .5em;border-bottom:1px solid var(--edge, rgba(160,170,255,.14))}
  .mlpanel header h2{margin:0;font-weight:500;font-size:1.08em;flex:1;min-width:0}
  .mlpanel .mb{font:inherit;font-size:.8em;color:inherit;background:rgba(255,255,255,.06);border:1px solid var(--edge2, rgba(170,180,255,.28));border-radius:.6em;padding:.28em .65em;cursor:pointer;white-space:nowrap}
  .mlpanel .mb:hover,.mlpanel .mb:focus-visible{background:rgba(124,140,255,.3);outline:none}
  .mlpanel ol{list-style:none;margin:0;padding:.4em .7em .8em;overflow:auto;display:flex;flex-direction:column;gap:.35em}
  .mlpanel li{display:grid;grid-template-columns:1.8em 1fr auto;gap:.5em;align-items:center;padding:.45em .55em;border-radius:.7em;background:rgba(255,255,255,.035);cursor:pointer}
  .mlpanel li:hover{background:rgba(124,140,255,.16)}
  .mlpanel li .n{color:var(--muted,#a4abcc);text-align:right;font-variant-numeric:tabular-nums}
  .mlpanel li b{display:block;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mlpanel li span{display:block;color:var(--muted,#a4abcc);font-size:.82em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mlpanel li.no b{opacity:.65}
  .mlimg{position:fixed;inset:0;z-index:48;background:rgba(4,5,14,.92);display:grid;place-items:center;cursor:zoom-out}
  .mlimg img{max-width:94vw;max-height:88vh;border-radius:.6em;box-shadow:0 20px 80px rgba(0,0,0,.7)}
  .mlimg p{position:absolute;bottom:1em;left:0;right:0;text-align:center;color:#dfe3ff;margin:0}`;
  document.head.appendChild(css);
  let panel = null, imgEl = null, hideT = 0;
  const kindIcon = (x) => (x.kind === "video" ? "🎬" : x.kind === "image" ? "🖼" : x.kind === "audio" ? "♪" : "📄");
  function closeList() { panel?.remove(); panel = null; clearTimeout(hideT); }
  function showList(l) {
    closeList();
    panel = document.createElement("section"); panel.className = "mlpanel"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", l.title);
    panel.innerHTML = `<header><h2>${esc(l.title)}</h2>${l.items.some((x) => x.kind === "audio" || x.kind === "video") && l.items.length > 1 ? `<button class="mb" data-all="1">▶ All</button><button class="mb" data-all="1" data-shuffle="1">⤮ Shuffle</button>` : ""}<button class="mb" data-close="1" aria-label="Close">✕</button></header>
      <ol>${l.items.map((x) => `<li data-n="${x.n}" class="${x.playable === false ? "no" : ""}" title="${esc(x.title)}"><span class="n">${x.n}</span><div><b>${kindIcon(x)} ${esc(x.title)}</b><span>${esc([x.detail, x.where, x.time].filter(Boolean).join(" · "))}</span></div>
        ${x.source !== "drive" ? `<button class="mb" data-open="${x.n}" title="Open it in this PC's default app">PC</button>` : "<span></span>"}</li>`).join("")}</ol>`;
    document.body.appendChild(panel);
    panel.addEventListener("click", async (e) => {
      const b = e.target.closest("button, li"); if (!b) return;
      e.stopPropagation();
      try {
        if (b.dataset.close) return closeList();
        if (b.dataset.all) { await post("/media/local/pick", { all: true, shuffle: Boolean(b.dataset.shuffle) }); return closeList(); }
        if (b.dataset.open) { const r = await post("/media/local/open", { n: Number(b.dataset.open) }); H().toast("On this PC", r.opened ? `Opened ${r.opened}` : r.text || "Asked first", "", "bell"); return; }
        if (b.dataset.n) { const r = await post("/media/local/pick", { n: Number(b.dataset.n) }); if (r.reply && !/^Here's/.test(r.reply)) closeList(); }
      } catch (err) { H().toast("Media", err.message, "", "bell"); }
    });
    hideT = setTimeout(closeList, 180_000);
  }
  function showImage(im) {
    imgEl?.remove();
    imgEl = document.createElement("div"); imgEl.className = "mlimg"; imgEl.setAttribute("role", "dialog"); imgEl.setAttribute("aria-label", im.title ?? "Picture");
    imgEl.innerHTML = `<img alt="${esc(im.title ?? "")}" src="${esc(im.src)}"><p>${esc(im.title ?? "")}</p>`;
    imgEl.addEventListener("click", () => { imgEl?.remove(); imgEl = null; });
    document.body.appendChild(imgEl);
  }
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (panel || imgEl)) { closeList(); imgEl?.remove(); imgEl = null; return; }
    if (!panel || e.ctrlKey || e.altKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "")) return;
    if (/^[1-9]$/.test(e.key)) { const li = panel.querySelector(`li[data-n="${e.key}"]`); if (li) { e.preventDefault(); li.click(); } }
  });
  const attach = (es) => es.addEventListener("medialib", (e) => { let d = {}; try { d = JSON.parse(e.data); } catch { return; } if (d.close) { closeList(); return; } if (d.list) showList(d.list); if (d.image) showImage(d.image); });
  if (window.dsEvents) attach(window.dsEvents); else addEventListener("ds-events", (e) => attach(e.detail), { once: true });
  window.dsMediaLib = { showList, closeList, showImage };
})();
