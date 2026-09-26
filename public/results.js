// The results panel on the Dayspring screen: lists, rankings, research answers, stats, the prayer list, plans.
// A title, a short summary, numbered items (thumbnail, title, one-line detail, source), and actions per item:
// ▶ play (a YouTube video or a Spotify song), 🔗 open the link in the laptop's browser, Open (a document or plan in the
// reader). "Read it to me" reads the summary and the items; ✕ / Esc / "close the results" closes it.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const post = (url, body) => fetch("/api" + url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j; });
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const PAGE = 10;

  const css = document.createElement("style");
  css.textContent = `
  .rpanel{position:fixed;z-index:47;top:calc(1em + var(--st, var(--sy, 0px)));bottom:calc(1em + var(--sb, var(--sy, 0px)));left:50%;transform:translateX(-50%);
    width:min(44em, calc(100vw - var(--sl, var(--sx, 0px)) - var(--sr, var(--sx, 0px)) - 2em));display:flex;flex-direction:column;border-radius:1.1em;
    background:rgba(14,17,42,.96);backdrop-filter:blur(18px);border:1px solid var(--edge2, rgba(170,180,255,.28));box-shadow:0 30px 90px rgba(0,0,0,.6);animation:rin .3s ease}
  @keyframes rin{from{opacity:0;transform:translate(-50%,.6em)}to{opacity:1;transform:translate(-50%,0)}}
  .rpanel header{display:flex;align-items:flex-start;gap:.6em;padding:.9em 1em .6em;border-bottom:1px solid var(--edge, rgba(160,170,255,.14))}
  .rpanel header h2{margin:0;font-weight:500;font-size:1.2em;flex:1;min-width:0;line-height:1.25}
  .rpanel header small{display:block;color:var(--muted,#a4abcc);font-size:.62em;font-weight:400;margin-top:.25em;letter-spacing:.03em}
  .rpanel .rbtn{font:inherit;font-size:.82em;color:var(--ink,#eef0ff);background:rgba(255,255,255,.06);border:1px solid var(--edge2, rgba(170,180,255,.28));border-radius:.6em;padding:.3em .7em;cursor:pointer;white-space:nowrap}
  .rpanel .rbtn:hover,.rpanel .rbtn:focus-visible{background:rgba(124,140,255,.3);outline:none}
  .rpanel .rbtn.on{background:rgba(124,140,255,.35)}
  .rpanel .rbody{overflow:auto;padding:.4em 1em 1em;flex:1;min-height:0}
  .rpanel .rsum{color:var(--ink,#eef0ff);opacity:.92;line-height:1.45;margin:.5em 0 .7em;font-weight:300}
  .rpanel .rnote{color:var(--gold,#ffd27a);font-size:.85em;margin:.2em 0 .6em}
  .rpanel ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.45em}
  .rpanel li{display:grid;grid-template-columns:2em auto 1fr auto;gap:.6em;align-items:center;padding:.5em .6em;border-radius:.8em;background:rgba(255,255,255,.035);border:1px solid transparent}
  .rpanel li.cur{border-color:var(--violet,#a78bfa);background:rgba(167,139,250,.12)}
  .rpanel li .n{color:var(--muted,#a4abcc);font-variant-numeric:tabular-nums;text-align:right}
  .rpanel li img{width:5.2em;aspect-ratio:16/9;object-fit:cover;border-radius:.45em;background:#111}
  .rpanel li .t{min-width:0}
  .rpanel li .t b{display:block;font-weight:500;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .rpanel li .t span{display:block;color:var(--muted,#a4abcc);font-size:.84em;font-weight:300;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .rpanel li .t em{display:block;font-style:normal;color:var(--indigo,#7c8cff);font-size:.75em;margin-top:.1em}
  .rpanel li .acts{display:flex;gap:.3em}
  .rpanel li.noimg{grid-template-columns:2em 1fr auto}
  .rpanel .rmore{margin-top:.7em}
  @media (max-width:640px){.rpanel li img{display:none}.rpanel li{grid-template-columns:1.6em 1fr auto}}`;
  document.head.appendChild(css);

  let R = null, shown = PAGE, reading = 0, el = null;
  function close() { stopReading(); el?.remove(); el = null; R = null; }
  function stopReading() { if (reading) { reading = 0; window.dsStopSpeaking?.(); } el?.querySelectorAll("li.cur").forEach((x) => x.classList.remove("cur")); const b = el && $("#rRead", el); if (b) { b.textContent = "🔊 Read it to me"; b.classList.remove("on"); } }
  async function readAloud() {
    if (reading) return stopReading();
    const token = reading = Date.now();
    const b = $("#rRead", el); b.textContent = "■ Stop"; b.classList.add("on");
    const say = (t) => (window.dsSpeak ? window.dsSpeak(t) : Promise.resolve());
    await say(`${R.title}.${R.summary ? " " + R.summary : ""}`);
    for (const it of R.items) {
      if (reading !== token) return;
      if (it.n > shown) { shown = it.n; paint(); }
      el?.querySelectorAll("li").forEach((x) => x.classList.toggle("cur", Number(x.dataset.n) === it.n));
      el?.querySelector(`li[data-n="${it.n}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      await say(`${it.n}. ${it.title}.${it.detail && it.detail !== "(private)" ? " " + it.detail : ""}`);
    }
    if (reading === token) stopReading();
  }
  function item(it) {
    const acts = [
      it.videoId || it.spotifyUri ? `<button class="rbtn" data-act="play" title="Play">▶</button>` : "",
      it.path ? `<button class="rbtn" data-act="doc" title="Open it in the reader">Open</button>` : "",
      it.url ? `<button class="rbtn" data-act="link" title="Open in your browser">🔗</button>` : "",
    ].join("");
    const src = it.url && !it.videoId ? host(it.url) : "";
    return `<li data-n="${it.n}" class="${it.thumb ? "" : "noimg"}"><span class="n">${it.n}</span>${it.thumb ? `<img src="${esc(it.thumb)}" alt="" loading="lazy">` : ""}
      <div class="t"><b title="${esc(it.title)}">${esc(it.title)}</b>${it.detail ? `<span title="${esc(it.detail)}">${esc(it.detail)}</span>` : ""}${src ? `<em>${esc(src)}</em>` : ""}</div>
      <div class="acts">${acts}</div></li>`;
  }
  function paint() {
    if (!el || !R) return;
    $(".rbody", el).innerHTML = `${R.summary ? `<p class="rsum">${esc(R.summary)}</p>` : ""}${R.note ? `<p class="rnote">${esc(R.note)}</p>` : ""}
      <ol>${R.items.slice(0, shown).map(item).join("")}</ol>
      ${R.items.length > shown ? `<button class="rbtn rmore" id="rMore">Show ${Math.min(PAGE, R.items.length - shown)} more (${R.items.length - shown} left)</button>` : ""}`;
  }
  function open(r) {
    stopReading(); R = r; shown = PAGE;
    if (!el) {
      el = document.createElement("section"); el.className = "rpanel"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Results");
      document.body.appendChild(el);
      el.addEventListener("click", async (e) => {
        const b = e.target.closest("button"); if (!b) return;
        if (b.id === "rsClose") return close();
        if (b.id === "rRead") return readAloud();
        if (b.id === "rMore") { shown += PAGE; return paint(); }
        const li = b.closest("li"), it = R?.items.find((x) => x.n === Number(li?.dataset.n)); if (!it) return;
        try {
          if (b.dataset.act === "link") { await post("/open", { url: it.url }); b.textContent = "✓"; }
          else if (b.dataset.act === "doc") { await post("/docs/show", { path: it.path }); close(); }
          else if (b.dataset.act === "play") {
            if (it.videoId) await post("/media/play", { videoId: it.videoId, title: it.title });
            else await post("/player/spotify/api", { action: "play", uri: it.spotifyUri }).catch(() => post("/chat", { message: `play ${it.title}${it.detail ? " by " + it.detail : ""} on spotify`, surface: "tv" }));
            b.textContent = "✓";
          }
        } catch (err) { b.textContent = "!"; b.title = err.message; }
      });
    }
    el.innerHTML = `<header><h2>${esc(R.title)}${R.source ? `<small>From ${esc(R.source)} · ${R.items.length} item${R.items.length === 1 ? "" : "s"}</small>` : ""}</h2>
      <button class="rbtn" id="rRead">🔊 Read it to me</button><button class="rbtn" id="rsClose" aria-label="Close">✕</button></header><div class="rbody"></div>`;
    paint();
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && el && (!e.dsTop || e.dsTop === el)) { close(); } });
  const attach = (es) => es.addEventListener("results", (e) => { let r = {}; try { r = JSON.parse(e.data); } catch { return; } if (r.close) close(); else open(r); });
  if (window.dsEvents) attach(window.dsEvents); else addEventListener("ds-events", (e) => attach(e.detail), { once: true });
  // said on the display (no trip to the server needed)
  (window.dsLocal ??= []).push((t) => {
    if (!el) return null;
    if (/^(close|hide|dismiss) (the |those )?(results|list)$/.test(t)) { close(); return "Okay."; }
    if (/^(read|say) (me )?(the|that|this) (results|list|whole list|full list)( to me)?$/.test(t)) { if (!reading) readAloud(); return "Reading it."; }
    if (/^(show|see) more$/.test(t)) { shown += PAGE; paint(); return "Here's more."; }
    if (/^stop reading$/.test(t) && reading) { stopReading(); return "Okay."; }
    return null;
  });
  // tests: window.dispatchEvent(new CustomEvent("ds-test-results", { detail: {...} }))
  addEventListener("ds-test-results", (e) => open(e.detail));
})();
