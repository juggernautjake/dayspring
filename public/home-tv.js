// Smart devices and 3D printers on the Dayspring screen: 🏠 Devices and 🖨 Printers by the clock (only once something is
// set up), the pages when asked for ("show me the camera on the X1"), and a card with the picture when a print looks
// like it's failing, with "Pause it" right there. Cards stay inside the screen margins (safe-area.css, dsKeepInSafe).
(() => {
  if (!document.getElementById("clock")) return;                // only on the Dayspring screen
  const css = document.createElement("style");
  css.textContent = `
    .printpanel{position:fixed;z-index:61;right:calc(var(--safe-right,0px) + var(--safe-gap,10px));top:calc(var(--safe-top,0px) + var(--safe-gap,10px) + 2.4em);
      width:min(24em,calc(var(--safe-w,100vw) - 2 * var(--safe-gap,10px)));max-height:calc(var(--safe-h,100vh) - 2 * var(--safe-gap,10px) - 2.4em);overflow:auto;
      background:rgba(20,24,54,.97);border:1px solid rgba(255,143,163,.55);border-radius:.9em;box-shadow:0 10px 40px rgba(0,0,0,.5)}
    .printpanel.warning{border-color:rgba(255,210,122,.55)}
    .printpanel img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:#050714}
    .printpanel .t{padding:.45em .75em .3em;font-size:.95em}
    .printpanel .b{display:flex;gap:.4em;flex-wrap:wrap;padding:0 .75em .6em}
    .printpanel .b button{background:rgba(255,255,255,.08);border:1px solid rgba(170,180,255,.3);border-radius:.6em;color:inherit;padding:.25em .7em;cursor:pointer;font:inherit}
    .printpanel .b button.main{background:#7c8cff;border-color:#7c8cff;color:#0b0f22;font-weight:600}`;
  document.head.appendChild(css);
  const open = (url) => (window.dsOpenPage ? window.dsOpenPage(url) : location.assign(url.replace("embed=1", "")));
  const buttons = {};
  function addButton(id, icon, label, url, title) {
    if (buttons[id]) return;
    const util = document.querySelector("#calBtns .util, .calbtns .util"); if (!util) return;
    const b = document.createElement("button"); b.id = id; b.type = "button"; b.title = title; b.innerHTML = `<i aria-hidden="true">${icon}</i><span class="lbl">${label}</span>`;
    b.onclick = () => open(url);
    util.insertBefore(b, util.querySelector("#setBtn") ?? null);
    buttons[id] = b;
  }
  let card = null, timer = null;
  function showCard(a) {
    card?.remove(); clearTimeout(timer);
    card = document.createElement("div"); card.className = `printpanel ${a.severity === "warning" ? "warning" : ""}`; card.setAttribute("role", "alert");
    card.innerHTML = `${a.image ? '<img alt="">' : ""}<div class="t"></div><div class="b">${a.printer && a.severity !== "info" ? '<button class="main" data-pause type="button">⏸ Pause it</button>' : ""}<button data-show type="button">Show the printer</button><button data-x type="button">Dismiss</button></div>`;
    if (a.image) card.querySelector("img").src = a.image;
    card.querySelector(".t").textContent = a.text ?? `${a.name ?? "A printer"} needs a look.`;
    card.addEventListener("click", async (e) => {
      if (e.target.closest("[data-x]")) { card.remove(); return; }
      if (e.target.closest("[data-show]")) { open(`/printers.html?embed=1&printer=${encodeURIComponent(a.printer ?? "")}&camera=1`); card.remove(); return; }
      if (e.target.closest("[data-pause]")) {
        const r = await fetch(`/api/printers/${encodeURIComponent(a.printer)}/command`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "pause" }) }).then((x) => x.json()).catch(() => ({ text: "I couldn't reach Dayspring." }));
        card.querySelector(".t").textContent = r.text ?? "Paused."; card.querySelector("[data-pause]")?.remove();
      }
    });
    document.body.appendChild(card);
    window.dsKeepInSafe?.(card);
    timer = setTimeout(() => card?.remove(), 10 * 60_000);
  }
  async function refresh() {
    try { const r = await fetch("/api/smarthome/summary"); if (r.ok) { const d = await r.json(); if (d.devices || d.strips) addButton("devicesBtn", "🏠", "Devices", "/smarthome.html?embed=1", "Smart devices: switch things, strips, scenes"); } } catch { /* off */ }
    try { const r = await fetch("/api/printers"); if (r.ok) { const d = await r.json(); if (d.printers?.length) addButton("printersBtn", "🖨️", "Printers", "/printers.html?embed=1", "3D printers: camera, progress, controls"); } } catch { /* off */ }
  }
  function hook(es) {
    es.addEventListener("printer-alert", (e) => { try { showCard(JSON.parse(e.data)); } catch { /* bad event */ } });
    es.addEventListener("printers", (e) => { try { const d = JSON.parse(e.data); if (d.open && /^\/printers\.html\?/.test(d.open)) open(d.open); } catch { /* bad event */ } });
    es.addEventListener("devices", (e) => { try { const d = JSON.parse(e.data); if (d.open && /^\/smarthome\.html\?/.test(d.open)) open(d.open); } catch { /* bad event */ } });
  }
  if (window.dsEvents) hook(window.dsEvents); else addEventListener("ds-events", (e) => hook(e.detail), { once: true });
  addEventListener("resize", () => { if (card) window.dsKeepInSafe?.(card); });
  refresh(); setInterval(refresh, 120_000);
  window.dsHomeTv = { showCard, refresh };
})();
