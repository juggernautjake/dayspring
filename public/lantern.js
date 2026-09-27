/* Lantern on the Dayspring screen (lib/lantern.mjs does the talking to Lantern):
   - cards for what Lantern sends: course invitations, friend requests, updates, "installing Lantern…" with its progress.
     Each wears the Lantern chip (amber) so it's clear where it came from.
   - Lantern's courses next to Dayspring's own study rings, with the one measure "X of Y steps · A of B lessons" and the
     next lesson; clicking one opens Lantern right there.
   Nothing shows at all for someone who never uses Lantern. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const post = async (path, body) => {
    const r = await fetch("/api" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "That didn't work just now. Try again in a moment.");
    return j;
  };
  const short = (t) => String(t ?? "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+\d{3}$/, "").trim();

  const css = document.createElement("style");
  css.textContent = `
  .lnstack{position:fixed;right:max(1.2em,calc(var(--sr,0px) + 1em));bottom:max(1.2em,calc(var(--sb,0px) + 1em));z-index:45;display:flex;flex-direction:column;gap:.7em;width:min(25em,calc(100vw - 2em));pointer-events:none}
  .lncard{pointer-events:auto;position:relative;padding:.9em 1em .85em 1.15em;border-radius:1em;background:rgba(18,16,30,.94);backdrop-filter:blur(16px);color:#f6ead2;
    border:1px solid rgba(255,181,71,.28);box-shadow:0 18px 50px rgba(0,0,0,.55),0 0 26px rgba(255,181,71,.12);animation:lnin .25s cubic-bezier(.2,.7,.2,1);font-size:.95em;overflow-wrap:anywhere}
  .lncard::before{content:"";position:absolute;left:0;top:.7em;bottom:.7em;width:3px;border-radius:3px;background:linear-gradient(#ffb547,#ff8a3d)}
  @keyframes lnin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  .lnchip{display:inline-flex;align-items:center;gap:.35em;font-size:.72em;font-weight:600;letter-spacing:.03em;padding:.12em .6em;border-radius:2em;background:rgba(255,181,71,.14);color:#ffcf85;border:1px solid rgba(255,181,71,.35)}
  .lnchip::before{content:"";width:.55em;height:.55em;border-radius:50%;background:#ffb547;box-shadow:0 0 .5em #ffb547}
  .lncard h4{margin:.45em 0 .2em;font-size:1.02em;font-weight:500}
  .lncard p{margin:0;color:#e9dcc2;line-height:1.4}
  .lncard .note{margin-top:.4em;font-style:italic;color:#d8c9a8}
  .lncard .row{display:flex;flex-wrap:wrap;gap:.45em;margin-top:.7em}
  .lncard button{font:inherit;font-size:.9em;cursor:pointer;border-radius:.7em;padding:.45em .85em;color:#f6ead2;background:rgba(255,255,255,.06);border:1px solid rgba(255,181,71,.3)}
  .lncard button:hover,.lncard button:focus-visible{background:rgba(255,181,71,.18);outline:none}
  .lncard button.primary{background:linear-gradient(135deg,#ffb547,#ff8a3d);color:#1d1206;border-color:transparent;font-weight:600}
  .lncard button:disabled{opacity:.55;cursor:progress}
  .lncard .x{position:absolute;top:.45em;right:.45em;width:1.8em;height:1.8em;padding:0;border-radius:50%;border:0;background:rgba(255,255,255,.06);color:#d8c9a8}
  .lncard .bar{height:6px;border-radius:6px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:.6em}
  .lncard .bar i{display:block;height:100%;background:linear-gradient(90deg,#ffb547,#ff8a3d);transition:width .4s}
  .lncard .msg{margin-top:.5em;font-size:.88em;color:#ffcf85}
  #courses .course.lnc .gauge .fill{stroke:#ffb547}
  #courses .course.lnc .label::after{content:"Lantern";margin-left:.45em;font-size:.62em;padding:.08em .5em;border-radius:2em;color:#ffcf85;border:1px solid rgba(255,181,71,.4);vertical-align:.15em}
  #courses .course.lnc{cursor:pointer}
  #courses .course.lnc:hover,#courses .course.lnc:focus-visible{outline:none;box-shadow:0 0 0 2px rgba(255,181,71,.55),0 0 22px rgba(255,181,71,.2);border-radius:1em}`;
  document.head.appendChild(css);

  const stack = document.createElement("div");
  stack.className = "lnstack"; stack.setAttribute("aria-live", "polite");
  document.body.appendChild(stack);
  const cards = new Map();

  function showCard(c) {
    let el = cards.get(c.id);
    if (!el) { el = document.createElement("div"); el.className = "lncard"; el.dataset.id = c.id; stack.appendChild(el); cards.set(c.id, el); }
    el.innerHTML = `<span class="lnchip">Lantern</span><button class="x" aria-label="Close">✕</button>
      <h4>${esc(c.title ?? "Lantern")}</h4><p>${esc(c.text)}</p>${c.note ? `<p class="note">“${esc(c.note)}”</p>` : ""}
      ${c.progress != null ? `<div class="bar"><i style="width:${Math.max(2, Math.min(100, c.progress))}%"></i></div>` : ""}
      ${(c.buttons ?? []).length ? `<div class="row">${c.buttons.map((b, i) => `<button data-i="${i}" class="${b.primary ? "primary" : ""}">${esc(b.label)}</button>`).join("")}</div>` : ""}
      <div class="msg" hidden></div>`;
    el.querySelector(".x").onclick = () => close(c.id);
    el.querySelectorAll("button[data-i]").forEach((btn) => { btn.onclick = () => act(c, c.buttons[Number(btn.dataset.i)], el); });
    if (c.type === "info" || c.type === "update") { clearTimeout(el._t); el._t = setTimeout(() => close(c.id), 45_000); }
  }
  function close(id) { const el = cards.get(id); if (el) { el.remove(); cards.delete(id); } }
  async function act(c, b, el) {
    const msg = el.querySelector(".msg");
    if (b.action === "dismiss") return close(c.id);
    if (b.action === "url") { window.open(b.url, "_blank", "noopener"); return; }
    el.querySelectorAll("button").forEach((x) => { x.disabled = true; });
    try {
      const r = await post("/lantern/action", { action: b.action, data: c.data ?? {} });
      if (r.url) window.open(r.url, "_blank", "noopener");
      if (r.say) { msg.hidden = false; msg.textContent = r.say; }
      if (b.action !== "guide" && b.action !== "open") setTimeout(() => close(c.id), r.say ? 6000 : 300);
      else el.querySelectorAll("button").forEach((x) => { x.disabled = false; });
    } catch (e) {
      msg.hidden = false; msg.textContent = e.message;
      el.querySelectorAll("button").forEach((x) => { x.disabled = false; });
    }
  }
  // installing Lantern: one card that follows the installer
  function installCard(j) {
    if (!j) return;
    const c = { id: "install", type: "install", title: j.step === "done" ? "Lantern is installed" : j.step === "failed" ? "Lantern didn't install" : j.step === "needs-node" ? "Lantern needs Node.js" : j.step === "no-winget" ? "Lantern needs Node.js" : "Installing Lantern",
      text: j.message ?? "", progress: ["failed", "needs-node", "no-winget"].includes(j.step) ? null : j.progress ?? 0, data: { dir: j.dir, course: j.course }, buttons: [] };
    if (j.step === "needs-node") c.buttons = [{ label: "Install Node.js", action: "install-node", primary: true }, { label: "Show me the steps", action: "guide" }, { label: "Not now", action: "dismiss" }];
    else if (j.step === "no-winget") c.buttons = [{ label: "Open nodejs.org", action: "url", url: j.url || "https://nodejs.org", primary: true }, { label: "Show me the steps", action: "guide" }];
    else if (j.step === "failed") c.buttons = [{ label: "Try again", action: "install", primary: true }, { label: "Show me the steps", action: "guide" }];
    else if (j.step === "done") { c.buttons = [{ label: "Open Lantern", action: "open", primary: true }]; c.data.course = j.course; }
    showCard(c);
  }

  // ---- Lantern's courses among the study rings ----
  let courses = [];
  let xpFor = {};            // XP: what each course has earned in Dayspring (lib/xp/learning.mjs), for the chips
  const C = 2 * Math.PI * 42;
  function drawCourses() {
    const box = $("#courses"); if (!box) return;
    box.querySelectorAll(".course.lnc").forEach((x) => x.remove());
    for (const c of courses) {
      const el = document.createElement("div");
      el.className = "course lnc"; el.tabIndex = 0; el.setAttribute("role", "button");
      el.title = `Open ${short(c.title)} in Lantern`;
      const pct = Math.max(0, Math.min(100, Math.round(c.percent ?? 0)));
      el.innerHTML = `<div class="gauge"><svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="42"/><circle class="fill" cx="50" cy="50" r="42" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct / 100)}"/></svg><span class="pct">${pct}%</span></div>
        <div class="info"><div class="label">${esc(short(c.title))}${xpFor[c.id] ? `<span class="xpchip" title="XP earned in Dayspring from this course">${xpFor[c.id]} XP</span>` : ""}</div><b style="font-size:.8em;font-weight:500">${esc(c.measure || `${pct}%`)}</b>
          <div class="nx">Next: ${esc(c.next?.title ?? (pct >= 100 ? "all done" : "—"))}</div></div>`;
      const go = (e) => { e.preventDefault(); e.stopPropagation(); post("/lantern/open", { course: c.id, lesson: c.next?.id ?? null }).catch((x) => showCard({ id: "open-err", type: "info", title: "Lantern", text: x.message })); };
      el.addEventListener("click", go, true);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") go(e); }, true);
      box.appendChild(el);
    }
  }
  // tv.js redraws #courses on its own schedule: put ours back after each redraw
  const box = $("#courses");
  if (box) new MutationObserver(() => { if (courses.length && !box.querySelector(".course.lnc")) drawCourses(); }).observe(box, { childList: true });

  async function refresh() {
    try {
      const s = await (await fetch("/api/lantern/status")).json();
      window.dsMicOwner = s.micOwner || "dayspring";
      courses = s.running && s.status?.courses ? s.status.courses.filter((c) => c.installed !== false) : [];
      try { const lx = await (await fetch("/api/xp/learning")).json(); xpFor = Object.fromEntries(Object.entries(lx.perCourse ?? {}).map(([k, v]) => [k, v.xpAwarded])); } catch { xpFor = {}; }
      drawCourses();
      if (s.install && !["done"].includes(s.install.step) && Date.now() - (s.install.at ?? 0) < 30 * 60_000) installCard(s.install);
    } catch { /* Dayspring is restarting */ }
  }
  function hook(es) {
    es.addEventListener("lantern", (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.kind === "card" && d.card) showCard(d.card);
        else if (d.kind === "install") installCard(d.job);
        else if (d.kind === "status") refresh();
      } catch { /* bad event */ }
    });
  }
  if (window.dsEvents) hook(window.dsEvents);
  window.addEventListener("ds-events", (e) => hook(e.detail));
  refresh();
  setInterval(refresh, 60_000);
  // tests (headless): show a card without Lantern
  window.addEventListener("ds-test-lantern", (e) => showCard({ id: "test", type: "offer", title: "Course invitation", text: "Riley wants to send you a course: Python.", buttons: [{ label: "Accept", action: "dismiss", primary: true }], ...(e.detail || {}) }));
})();
