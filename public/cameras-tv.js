// Cameras on the Dayspring screen: the 📷 Cameras button by the clock (only once there's a camera), the Cameras page
// when asked for ("show me the front camera"), a picture card with each alert, and a ● REC sign whenever a camera is
// recording. The card and the sign stay inside the screen margins (safe-area.css, window.dsKeepInSafe).
(() => {
  if (!document.getElementById("clock")) return;                // only on the Dayspring screen
  const css = document.createElement("style");
  css.textContent = `
    #camRec{position:fixed;z-index:60;top:calc(var(--safe-top,0px) + var(--safe-gap,10px));left:calc(var(--safe-left,0px) + var(--safe-gap,10px));
      background:rgba(20,6,12,.82);color:#ff6b7d;border:1px solid rgba(255,77,100,.55);border-radius:.7em;padding:.15em .6em;font-weight:600;font-size:.85em;letter-spacing:.05em;cursor:pointer}
    #camRec::before{content:"●";margin-right:.3em;animation:camblink 1.4s infinite}@keyframes camblink{50%{opacity:.25}}
    .campanel{position:fixed;z-index:61;right:calc(var(--safe-right,0px) + var(--safe-gap,10px));top:calc(var(--safe-top,0px) + var(--safe-gap,10px) + 2.4em);
      width:min(22em,calc(var(--safe-w,100vw) - 2 * var(--safe-gap,10px)));background:rgba(20,24,54,.96);border:1px solid rgba(170,180,255,.3);border-radius:.9em;
      overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.5);cursor:pointer;animation:camin .35s cubic-bezier(.2,.7,.2,1)}
    @keyframes camin{from{opacity:0;transform:translateY(-.5em)}to{opacity:1;transform:none}}
    .campanel img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:#050714}
    .campanel .t{padding:.4em .7em .55em;font-size:.95em}.campanel .x{position:absolute;top:.3em;right:.4em;background:rgba(5,7,20,.7);border:0;color:#fff;border-radius:.5em;cursor:pointer}`;
  document.head.appendChild(css);
  const open = (url) => (window.dsOpenPage ? window.dsOpenPage(url) : location.assign(url.replace("embed=1", "")));

  // ● REC
  const rec = document.createElement("div"); rec.id = "camRec"; rec.hidden = true; rec.textContent = "REC"; rec.setAttribute("role", "status");
  rec.onclick = () => open("/cameras.html?embed=1");
  document.body.appendChild(rec);
  const showRec = (ids = [], names = []) => { rec.hidden = !ids.length; rec.title = ids.length ? `Recording: ${names.join(", ") || ids.join(", ")}` : ""; if (ids.length) window.dsKeepInSafe?.(rec); };

  // 📷 Cameras by the clock (moves into ⋯ More when there's no room, like the other buttons)
  let btn = null;
  function addButton() {
    if (btn) return;
    const util = document.querySelector("#calBtns .util, .calbtns .util");
    if (!util) return;
    btn = document.createElement("button");
    btn.id = "camerasBtn"; btn.type = "button"; btn.title = "Cameras: live views, events, recordings"; btn.innerHTML = '<i aria-hidden="true">📷</i><span class="lbl">Cameras</span>';
    btn.onclick = () => open("/cameras.html?embed=1");
    util.insertBefore(btn, util.querySelector("#setBtn") ?? null);
  }

  // an alert: its picture, for a while (the words are said through the usual announcement)
  let card = null, cardTimer = null;
  function showCard(c) {
    card?.remove(); clearTimeout(cardTimer);
    card = document.createElement("div"); card.className = "campanel"; card.setAttribute("role", "alert");
    card.innerHTML = `${c.thumb ? `<img alt="">` : ""}<div class="t"></div><button class="x" type="button" aria-label="Close">✕</button>`;
    if (c.thumb) card.querySelector("img").src = c.thumb;
    card.querySelector(".t").textContent = c.text ?? c.name ?? "Camera";
    card.onclick = (e) => { if (e.target.closest(".x")) { card.remove(); return; } open(c.id ? `/cameras.html?embed=1&event=${encodeURIComponent(c.id)}` : `/cameras.html?embed=1&cam=${encodeURIComponent(c.cam)}`); card.remove(); };
    document.body.appendChild(card);
    window.dsKeepInSafe?.(card);
    cardTimer = setTimeout(() => card?.remove(), 45_000);
  }

  let names = {};
  async function refresh() {
    try {
      const r = await fetch("/api/cameras"); if (!r.ok) return;           // off in this version: nothing shows
      const s = await r.json();
      names = Object.fromEntries(s.cameras.map((c) => [c.id, c.name]));
      if (s.cameras.length) addButton();
      showRec(s.status?.recording ?? [], (s.status?.recording ?? []).map((id) => names[id]));
    } catch { /* offline */ }
  }
  function hook(es) {
    es.addEventListener("cameras", (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.open && /^\/(cameras\.html|setup)\?/.test(d.open)) open(d.open);
        if (d.recording) showRec(d.recording, d.recording.map((id) => names[id]));
      } catch { /* bad event */ }
    });
    es.addEventListener("camera-alert", (e) => { try { showCard(JSON.parse(e.data)); } catch { /* bad event */ } });
  }
  if (window.dsEvents) hook(window.dsEvents); else addEventListener("ds-events", (e) => hook(e.detail), { once: true });
  addEventListener("resize", () => { if (!rec.hidden) window.dsKeepInSafe?.(rec); if (card) window.dsKeepInSafe?.(card); });
  refresh(); setInterval(refresh, 60_000);
  window.dsCamerasTv = { showCard, showRec, refresh };
})();
