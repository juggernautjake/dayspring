// The document reader on the Dayspring screen: shows a document (Word, PDF, slides, a spreadsheet…) with its sections,
// and reads it aloud paragraph by paragraph with the current one highlighted. Controls: ⏮ ◀ ⏯ ▶ ⏭, slower/faster,
// Summary, ✕; and by voice: "pause", "keep going", "go back", "read that again", "next section", "skip to section 3",
// "go to page 2", "slower", "faster", "stop reading". Opened by the server ("doc" events: "open my resume", "read me the
// lease") or by the AI. It tells the server where it is, so "pick up where we left off" works next time.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const post = (u, b) => fetch("/api" + u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) });
  const get = (u) => fetch("/api" + u).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Dayspring couldn't do that just now. Try again in a moment, or restart Dayspring if it keeps happening."); return j; });

  const css = document.createElement("style");
  css.textContent = `
  .reader{position:fixed;inset:calc(.8em + var(--sy,0px)) calc(.8em + var(--sx,0px));z-index:40;display:flex;flex-direction:column;border-radius:1.1em;overflow:hidden;
    background:rgba(12,14,34,.96);backdrop-filter:blur(18px);border:1px solid var(--edge2,rgba(170,180,255,.28));box-shadow:0 30px 90px rgba(0,0,0,.65);color:var(--ink,#eef0ff);container-type:inline-size}
  .reader[hidden]{display:none}
  .reader header{display:flex;align-items:center;gap:.8em;padding:.7em 1em;border-bottom:1px solid var(--edge,rgba(160,170,255,.14));flex-wrap:wrap}
  .reader header .rt{flex:1 1 12em;min-width:0}
  .reader header .rt b{display:block;font-weight:500;font-size:1.15em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .reader header .rt small{color:var(--muted,#a4abcc);font-size:.8em}
  .reader .rctl{display:flex;gap:.3em;align-items:center;flex-wrap:wrap}
  .reader button{font:inherit;color:inherit;background:rgba(255,255,255,.06);border:1px solid var(--edge2,rgba(170,180,255,.28));border-radius:.6em;padding:.3em .6em;cursor:pointer;min-width:2.2em}
  .reader button:hover,.reader button:focus-visible{background:rgba(124,140,255,.3);outline:none}
  .reader button.play{background:linear-gradient(135deg,#7c8cff,#a78bfa);border:0;color:#fff;min-width:2.8em}
  .reader .rbar{height:3px;background:rgba(255,255,255,.08)}.reader .rbar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#7c8cff,#a78bfa);transition:width .4s}
  .reader main{flex:1;display:grid;grid-template-columns:minmax(10em,16em) 1fr;min-height:0}
  .reader nav{overflow:auto;border-right:1px solid var(--edge,rgba(160,170,255,.14));padding:.6em .4em;font-size:.86em}
  .reader nav a{display:block;padding:.35em .6em;border-radius:.5em;color:var(--muted,#a4abcc);text-decoration:none;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .reader nav a:hover{background:rgba(255,255,255,.06);color:var(--ink,#fff)}.reader nav a.on{background:rgba(124,140,255,.22);color:#fff}
  .reader article{overflow:auto;padding:1em 1.6em 3em;line-height:1.55;font-size:1.05em}
  .reader article p{margin:0 0 .8em;padding:.25em .5em;border-radius:.5em;white-space:pre-wrap;cursor:pointer;transition:background .3s}
  .reader article h3{margin:1.2em 0 .5em;font-weight:500;font-size:1.15em;color:#fff;padding:.2em .5em;border-radius:.5em;cursor:pointer}
  .reader article .on{background:rgba(124,140,255,.22);box-shadow:inset 3px 0 0 #a78bfa}
  .reader .rnote{margin:0 0 1em;padding:.5em .8em;border-radius:.6em;background:rgba(255,210,122,.1);border:1px solid rgba(255,210,122,.3);color:#ffe6ad;font-size:.9em}
  @container (max-width: 720px){ .reader main{grid-template-columns:1fr} .reader nav{display:none} .reader article{padding:.8em 1em 2em} }`;
  document.head.appendChild(css);
  const el = document.createElement("section");
  el.className = "reader"; el.id = "reader"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Document reader");
  el.innerHTML = `<header><div class="rt"><b id="rTitle"></b><small id="rMeta"></small></div>
    <div class="rctl"><button id="rPrevS" title="Previous section" aria-label="Previous section">⏮</button><button id="rBack" title="Back a paragraph" aria-label="Back a paragraph">◀</button>
    <button id="rPlay" class="play" title="Read aloud / pause" aria-label="Read aloud">▶</button><button id="rNext" title="Next paragraph" aria-label="Next paragraph">▶▶</button><button id="rNextS" title="Next section" aria-label="Next section">⏭</button>
    <button id="rSlow" title="Read slower" aria-label="Slower">−</button><span id="rSpeed" aria-live="polite">1.0×</span><button id="rFast" title="Read faster" aria-label="Faster">+</button>
    <button id="rSum" title="Summarize this document">Summary</button><button id="rClose" title="Close (Esc)" aria-label="Close">✕</button></div></header>
    <div class="rbar"><i id="rProg"></i></div><main><nav id="rToc" aria-label="Sections"></nav><article id="rText" tabindex="0"></article></main>`;
  document.body.appendChild(el);

  const R = { path: null, title: "", type: "", paras: [], sections: [], i: 0, playing: false, token: 0, speed: 1, total: 0 };
  let saveT = 0;
  const report = () => { clearTimeout(saveT); saveT = setTimeout(() => post("/docs/progress", { path: R.path, title: R.title, para: R.i, total: R.total, playing: R.playing }).catch(() => {}), 600); };
  function highlight(scroll = true) {
    el.querySelectorAll("#rText .on").forEach((x) => x.classList.remove("on"));
    const p = el.querySelector(`#rText [data-i="${R.i}"]`);
    if (p) { p.classList.add("on"); if (scroll) p.scrollIntoView({ block: "center", behavior: "smooth" }); }
    const sec = R.paras[R.i]?.section;
    el.querySelectorAll("#rToc a").forEach((a) => a.classList.toggle("on", Number(a.dataset.s) === sec));
    $("#rProg").style.width = `${R.total ? Math.round(((R.i + 1) / R.total) * 100) : 0}%`;
    $("#rMeta").textContent = `${R.type}${R.total ? ` · paragraph ${Math.min(R.i + 1, R.total)} of ${R.total}` : ""}`;
    $("#rPlay").textContent = R.playing ? "⏸" : "▶"; $("#rPlay").setAttribute("aria-label", R.playing ? "Pause" : "Read aloud");
    $("#rSpeed").textContent = `${R.speed.toFixed(1)}×`;
    report();
  }
  async function load(path, from = null) {
    const o = await get(`/docs/open?path=${encodeURIComponent(path)}`);
    Object.assign(R, { path: o.path, title: o.title, type: o.type, total: o.paragraphs, paras: [], sections: o.sections });
    // all paragraphs, in pages of 200
    for (let f = 0; f < o.paragraphs; f += 200) { const r = await get(`/docs/read?path=${encodeURIComponent(o.path)}&from=${f}&n=200`); R.paras.push(...r.paras); }
    R.i = Math.max(0, Math.min(R.total - 1, from ?? o.stoppedAt ?? 0));
    $("#rTitle").textContent = o.title; $("#rTitle").title = o.name;
    $("#rToc").innerHTML = o.sections.filter((s) => s.heading && s.heading !== "(start)").map((s) => `<a data-s="${s.n}" title="${esc(s.heading)}">${esc(s.heading)}</a>`).join("") || `<a data-s="1">Start</a>`;
    $("#rText").innerHTML = (o.note ? `<div class="rnote">${esc(o.note)}</div>` : "") + R.paras.map((p) => p.heading ? `<h3 data-i="${p.i}">${esc(p.text)}</h3>` : `<p data-i="${p.i}">${esc(p.text)}</p>`).join("");
    el.hidden = false; highlight();
    try { window.dsLayout?.clamp?.(el); } catch { /* layout helper optional */ }
  }
  async function play() {
    if (!R.paras.length) return;
    const my = ++R.token; R.playing = true; highlight();
    while (R.playing && my === R.token && R.i < R.paras.length) {
      highlight();
      const p = R.paras[R.i];
      try { await window.dsSpeak?.(p.text, { speed: R.speed, tone: "bright" }); } catch { /* keep going */ }
      if (my !== R.token || !R.playing) return;
      if (p.heading) await new Promise((r) => setTimeout(r, 250));
      if (R.i >= R.paras.length - 1) { R.playing = false; highlight(false); window.dsSpeak?.("That's the end of the document."); return; }
      R.i++;
    }
  }
  function pause() { R.playing = false; R.token++; window.dsStopSpeaking?.(); highlight(false); }
  const jump = (i, keep = R.playing) => { R.token++; window.dsStopSpeaking?.(); R.i = Math.max(0, Math.min(R.paras.length - 1, i)); highlight(); if (keep) setTimeout(play, 150); };
  const sectionStart = (n) => R.paras.findIndex((p) => p.section === n);
  const cmd = (c, n) => {
    if (!R.path) return false;
    const sec = R.paras[R.i]?.section ?? 1;
    switch (c) {
      case "pause": pause(); return true;
      case "resume": case "play": if (!R.playing) play(); return true;
      case "stop": pause(); return true;
      case "close": pause(); el.hidden = true; return true;
      case "again": jump(R.i, true); return true;
      case "back": jump(R.i - 1, true); return true;
      case "next": jump(R.i + 1, true); return true;
      case "nextSection": { const i = R.paras.findIndex((p) => p.section > sec); if (i >= 0) jump(i, true); return true; }
      case "prevSection": { const cur = sectionStart(sec); const i = R.i > cur + 1 ? cur : sectionStart(Math.max(1, sec - 1)); jump(i >= 0 ? i : 0, true); return true; }
      case "section": { const i = sectionStart(Number(n)); if (i >= 0) jump(i, true); return true; }
      case "page": { const s = R.sections.find((x) => x.page === Number(n)); if (s) { const i = sectionStart(s.n); if (i >= 0) jump(i, true); } return true; }
      case "slower": R.speed = Math.max(0.7, Math.round((R.speed - 0.1) * 10) / 10); highlight(false); if (R.playing) jump(R.i, true); return true;
      case "faster": R.speed = Math.min(1.3, Math.round((R.speed + 0.1) * 10) / 10); highlight(false); if (R.playing) jump(R.i, true); return true;
    }
    return false;
  };
  // buttons
  $("#rPlay").onclick = () => (R.playing ? pause() : play());
  $("#rBack").onclick = () => cmd("back"); $("#rNext").onclick = () => cmd("next");
  $("#rPrevS").onclick = () => cmd("prevSection"); $("#rNextS").onclick = () => cmd("nextSection");
  $("#rSlow").onclick = () => cmd("slower"); $("#rFast").onclick = () => cmd("faster");
  $("#rClose").onclick = () => cmd("close");
  $("#rSum").onclick = () => fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "summarize it", surface: "tv" }) }).then((r) => r.json()).then((r) => r.reply && window.dsSpeak?.(r.reply)).catch(() => {});
  $("#rText").addEventListener("click", (e) => { const p = e.target.closest("[data-i]"); if (p) jump(Number(p.dataset.i), R.playing); });
  $("#rToc").addEventListener("click", (e) => { const a = e.target.closest("[data-s]"); if (a) { const i = sectionStart(Number(a.dataset.s)); if (i >= 0) jump(i, R.playing); } });
  document.addEventListener("keydown", (e) => {
    if (el.hidden || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? "")) return;
    if (e.key === "Escape" && (!e.dsTop || e.dsTop === el)) { e.stopPropagation(); cmd("close"); }
    else if (e.key === " " && el.contains(document.activeElement)) { e.preventDefault(); R.playing ? pause() : play(); }
  }, true);
  // voice on the display, instant: only while a document is open
  (window.dsLocal ??= []).push((t) => {
    if (el.hidden || !R.path) return false;
    const map = [[/^(pause|hold on|wait|hang on)( reading)?$/, "pause"], [/^(keep going|continue|resume|go on|keep reading|carry on)$/, "resume"], [/^(stop|stop reading|that'?s enough)$/, "stop"],
      [/^(close (it|the (document|reader))|close)$/, "close"], [/^(read (that|it) again|say that again|repeat that|again)$/, "again"], [/^(go back|back up|previous paragraph)$/, "back"],
      [/^(skip|skip that|next paragraph)$/, "next"], [/^next (section|part|chapter|slide|page)$/, "nextSection"], [/^(previous|last) (section|part|chapter|slide)$/, "prevSection"],
      [/^(read )?(slower|slow down)$/, "slower"], [/^(read )?(faster|speed up)$/, "faster"], [/^(read it|read it to me|start reading|read the whole thing)$/, "play"]];
    for (const [re, c] of map) if (re.test(t)) { cmd(c); return c === "pause" || c === "stop" ? "Paused." : true; }
    const N = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, first: 1, second: 2, third: 3 };
    let m;
    if ((m = /^(?:skip|go|jump) to (?:section|part|chapter|slide) (\w+)$/.exec(t))) { cmd("section", Number(N[m[1]] ?? m[1])); return true; }
    if ((m = /^(?:skip|go|jump|turn) to page (\w+)$/.exec(t))) { cmd("page", Number(N[m[1]] ?? m[1])); return true; }
    return false;
  });
  // the server says: open / read / control
  function attach(es) {
    es.addEventListener("doc", async (e) => {
      const d = JSON.parse(e.data);
      try {
        if (d.action === "open" || d.action === "read") {
          if (d.path !== R.path || !R.paras.length) { pause(); await load(d.path, d.from ?? null); }
          else { el.hidden = false; if (d.from != null) jump(d.from, false); }
          if (d.action === "read") play();
        } else if (d.action === "control") cmd(d.cmd, d.n);
      } catch (err) { console.warn("reader:", err.message); }
    });
  }
  if (window.dsEvents) attach(window.dsEvents);
  window.addEventListener("ds-events", (e) => attach(e.detail));
  window.dsReader = { load, play, pause, cmd, state: () => ({ ...R, paras: R.paras.length }) };   // tests
})();
