// The Printers page (/printers.html): a card per printer with its camera (a picture every few seconds, or the live view),
// state, progress, temperatures, fans, speed, AMS filament, errors, controls (pause, resume, stop, speed, light, bed
// check, start from the queue), the queue, and the print being watched with its alerts. ?printer=<id>&camera=1 opens a
// camera big; &bed=1 shows the last bed check. Starting and stopping show the same question the voice asks.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const params = new URLSearchParams(location.search), embed = params.get("embed") === "1";
  const api = async (path, opts = {}) => { const r = await fetch("/api" + path, { method: opts.method ?? (opts.body ? "POST" : "GET"), headers: opts.body ? { "content-type": "application/json" } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `${r.status}`); return j; };
  const msg = (t, bad = false) => { const m = $("#msg"); m.textContent = t || ""; m.style.color = bad ? "var(--rose)" : ""; };
  let list = [], live = new Set(params.get("camera") === "1" && params.get("printer") ? [params.get("printer")] : []);
  const t = (x) => (x?.temp != null ? `${Math.round(x.temp)}°${x.target ? `/${Math.round(x.target)}°` : ""}` : "–");
  const mins = (m) => (m == null ? "" : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
  function card(p) {
    const s = p.status ?? {}, id = encodeURIComponent(p.id), st = s.online ? s.state : "offline";
    const printing = ["printing", "preparing", "paused"].includes(st);
    const cam = s.camera ? `<img alt="${esc(p.name)} camera" src="/api/printers/${id}/${live.has(p.id) ? "live" : `snapshot.jpg?t=${Date.now()}`}" data-cam="${esc(p.id)}" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><div class="none" hidden>The camera didn't answer.</div>${live.has(p.id) ? '<span class="live">● live</span>' : ""}<span class="zoom"><button class="btn" data-live="${esc(p.id)}">${live.has(p.id) ? "Stop live" : "Live"}</button> <button class="btn" data-big="${esc(p.id)}" aria-label="Show big">⤢</button></span>`
      : `<div class="none">No camera. ${p.brand === "marlin" ? "Lend it one in Settings → 3D printers (a webcam pointed at the bed)." : ""}</div>`;
    const job = p.job, alerts = job?.alerts ?? [];
    const ams = (s.ams ?? []).flatMap((u) => u.trays.filter((x) => x.type).map((x) => `<span class="tray" title="AMS ${u.id + 1} slot ${x.slot + 1}${x.remain != null ? `, ${x.remain}% left` : ""}"><i style="background:${esc(x.color ?? "#888")}"></i>${esc(x.type)}${s.trayNow === x.index ? " ◀" : ""}</span>`)).join("");
    const noz = (s.nozzle ?? []).map((n, i) => `nozzle${s.nozzle.length > 1 ? ` ${i ? "R" : "L"}` : ""} <b>${t(n)}</b>`).join(" · ");
    return `<article class="card ${alerts.length ? "alert" : ""}" data-id="${esc(p.id)}">
      <div class="cam">${cam}</div>
      <div class="body">
        <div class="hd"><b>${esc(p.name)}</b><span class="pill ${esc(st)}">${esc(st)}</span><span class="facts">#${p.number} · ${esc(p.brand)} ${esc(p.model || "")}</span></div>
        ${printing ? `<div>${esc(s.job?.name ?? "")}</div><div class="bar" role="progressbar" aria-valuenow="${Math.round(s.progress ?? 0)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.round(s.progress ?? 0)}%"></i></div>
          <div class="facts"><span><b>${Math.round(s.progress ?? 0)}%</b></span>${s.layer ? `<span>layer <b>${s.layer}${s.totalLayers ? `/${s.totalLayers}` : ""}</b></span>` : ""}${s.remainingMin != null ? `<span><b>${mins(s.remainingMin)}</b> left</span>` : ""}</div>` : ""}
        <div class="facts"><span>${noz || "nozzle –"}</span><span>bed <b>${t(s.bed)}</b></span>${s.chamber?.temp != null ? `<span>chamber <b>${t(s.chamber)}</b></span>` : ""}${s.fans?.part != null ? `<span>fan <b>${s.fans.part}%</b></span>` : ""}${s.speedName ? `<span>speed <b>${esc(s.speedName)}</b></span>` : ""}</div>
        ${ams ? `<div class="ams">${ams}</div>` : ""}
        ${(s.errors ?? []).length ? `<div class="errs">${s.errors.map((e) => `⚠ ${esc(e.text)}${e.link ? ` <a href="${esc(e.link)}" target="_blank" rel="noopener">what it means</a>` : ""}`).join("<br>")}</div>` : ""}
        ${alerts.length ? `<div class="alerts">${alerts.slice(-3).map((a) => `<div class="a">${a.file ? `<img src="/api/printers/${id}/jobs/${encodeURIComponent(job.id)}/${esc(a.file)}" alt="">` : ""}<span>⚠ ${esc(a.verdict)} (${Math.round(a.score * 100)}%) ${esc(a.why ?? "")}</span></div>`).join("")}</div>` : ""}
        ${job ? `<div class="facts">👁 watching: ${job.frames} picture${job.frames === 1 ? "" : "s"} so far${job.awaiting ? ` · <button class="btn" data-good="${esc(p.id)}">It came out fine</button> <button class="btn" data-bad="${esc(p.id)}">It didn't</button>` : ""}</div>` : ""}
        <div class="row">
          ${st === "paused" ? `<button class="btn main" data-cmd="resume" data-id="${esc(p.id)}">▶ Resume</button>` : printing ? `<button class="btn" data-cmd="pause" data-id="${esc(p.id)}">⏸ Pause</button>` : ""}
          ${printing ? `<button class="btn danger" data-cmd="stop" data-id="${esc(p.id)}">■ Stop</button>` : ""}
          ${s.capabilities?.light ? `<button class="btn" data-cmd="light" data-val="${s.light ? "off" : "on"}" data-id="${esc(p.id)}">💡 ${s.light ? "Light off" : "Light on"}</button>` : ""}
          ${s.capabilities?.speed && printing ? `<select data-speed="${esc(p.id)}" aria-label="Speed"><option value="">speed…</option><option value="1">silent</option><option value="2">standard</option><option value="3">sport</option><option value="4">ludicrous</option></select>` : ""}
          ${s.camera ? `<button class="btn" data-bed="${esc(p.id)}">Is the bed clear?</button>` : ""}
        </div>
        ${s.bedCheck ? `<div class="bedres ${s.bedCheck.clear ? "ok" : "bad"}">${s.bedCheck.clear ? "✓ Bed clear" : `✗ ${esc(s.bedCheck.reason)}`} <span class="facts">(${new Date(s.bedCheck.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})</span></div>` : ""}
        <details ${p.queue?.length ? "open" : ""}><summary>Queue (${p.queue?.length ?? 0})</summary>
          <div class="q">${(p.queue ?? []).map((q, i) => `<div class="it"><span title="${esc(q.file)}">${i + 1}. ${esc(q.name)}${q.plate > 1 ? ` (plate ${q.plate})` : ""}</span>${i === 0 && !printing ? `<button class="btn main" data-start="${esc(p.id)}" data-qid="${esc(q.id)}" data-file="${esc(q.file)}" data-plate="${q.plate}">Start</button>` : ""}<button class="btn" data-rm="${esc(p.id)}" data-qid="${esc(q.id)}" aria-label="Remove">✕</button></div>`).join("") || '<span class="facts">Nothing queued.</span>'}</div>
          <form class="row" data-add="${esc(p.id)}"><input type="text" placeholder="A .3mf or .gcode file (full path)" aria-label="File to queue"><button class="btn" type="submit">Add</button></form>
        </details>
      </div></article>`;
  }
  async function load() {
    try { list = (await api("/printers")).printers; } catch (e) { msg(/turned on/.test(e.message) ? e.message : `Couldn't load printers: ${e.message}`, true); return; }
    $("#cards").innerHTML = list.length ? list.map(card).join("") : `<p class="empty">No printers yet. <button class="btn main" id="goSet" type="button">Add a printer</button> (Bambu Lab in LAN mode, a Creality Ender over USB, OctoPrint or Klipper).</p>`;
    $("#goSet")?.addEventListener("click", openSettings);
    if (params.get("bed") === "1" && params.get("printer")) { const p = list.find((x) => x.id === params.get("printer")); if (p?.status?.bedCheck) show(`${p.name}: ${p.status.bedCheck.clear ? "the bed looks clear." : p.status.bedCheck.reason}`, `/api/printers/${encodeURIComponent(p.id)}/bedcheck.jpg?t=${Date.now()}`); params.delete("bed"); }
    if (params.get("camera") === "1" && params.get("printer")) { openBig(params.get("printer")); params.delete("camera"); }
  }
  function ask(text, img) {
    return new Promise((res) => {
      $("#dlgText").textContent = text; const im = $("#dlgImg"); im.hidden = !img; if (img) im.src = img;
      $("#dlgNo").hidden = false; $("#dlgYes").textContent = "Yes"; $("#dlg").hidden = false; $("#dlgYes").focus();
      const done = (v) => { $("#dlg").hidden = true; $("#dlgYes").onclick = $("#dlgNo").onclick = null; res(v); };
      $("#dlgYes").onclick = () => done(true); $("#dlgNo").onclick = () => done(false);
    });
  }
  function show(text, img) { ask(text, img); $("#dlgNo").hidden = true; $("#dlgYes").textContent = "OK"; }
  function openBig(id) { const p = list.find((x) => x.id === id); if (!p) return; $("#bigName").textContent = `${p.name} camera`; $("#bigImg").src = `/api/printers/${encodeURIComponent(id)}/live`; $("#bigCam").hidden = false; $("#bigClose").focus(); }
  function closeBig() { $("#bigImg").src = ""; $("#bigCam").hidden = true; }
  $("#bigClose").onclick = closeBig;
  async function doCmd(id, action, value) {
    try {
      let r = await api(`/printers/${encodeURIComponent(id)}/command`, { body: { action, value } });
      if (r.needsConfirm) { if (!(await ask(r.text))) return msg("Okay, I won't."); r = await api(`/printers/${encodeURIComponent(id)}/command`, { body: { action, value, approve: true } }); }
      msg(r.text, r.ok === false); setTimeout(load, 700);
    } catch (e) { msg(e.message, true); }
  }
  async function doStart(id, file, plate, queueItem) {
    msg("Looking at the bed…");
    try {
      let r = await api(`/printers/${encodeURIComponent(id)}/start`, { body: { file, plate, queueItem } });
      if (r.bedNotClear) { show(r.text, r.image); return msg(""); }
      if (r.needsConfirm) { if (!(await ask(r.text, r.image))) return msg("Okay, not starting."); r = await api(`/printers/${encodeURIComponent(id)}/start`, { body: { file, plate, queueItem, approve: true } }); }
      msg(r.text, r.ok === false); setTimeout(load, 800);
    } catch (e) { msg(e.message, true); }
  }
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.cmd) return doCmd(b.dataset.id, b.dataset.cmd, b.dataset.val);
    if (b.dataset.live) { if (live.has(b.dataset.live)) live.delete(b.dataset.live); else live.add(b.dataset.live); return load(); }
    if (b.dataset.big) return openBig(b.dataset.big);
    if (b.dataset.bed) { msg("Looking at the bed…"); try { const r = await api(`/printers/${encodeURIComponent(b.dataset.bed)}/bedcheck`, { body: {} }); msg(""); show(r.clear ? "The bed looks clear." : r.reason, r.image); load(); } catch (x) { msg(x.message, true); } return; }
    if (b.dataset.start) return doStart(b.dataset.start, b.dataset.file, Number(b.dataset.plate) || 1, b.dataset.qid);
    if (b.dataset.rm) { await api(`/printers/${encodeURIComponent(b.dataset.rm)}/queue/${encodeURIComponent(b.dataset.qid)}`, { method: "DELETE" }).catch(() => {}); return load(); }
    if (b.dataset.good || b.dataset.bad) { await api(`/printers/${encodeURIComponent(b.dataset.good ?? b.dataset.bad)}/result`, { body: { good: Boolean(b.dataset.good) } }).catch(() => {}); return load(); }
  });
  document.addEventListener("change", (e) => { const s = e.target.closest("select[data-speed]"); if (s?.value) doCmd(s.dataset.speed, "speed", Number(s.value)); });
  document.addEventListener("submit", async (e) => {
    const f = e.target.closest("form[data-add]"); if (!f) return; e.preventDefault();
    const file = $("input", f).value.trim(); if (!file) return;
    try { await api(`/printers/${encodeURIComponent(f.dataset.add)}/queue`, { body: { file } }); msg("Added to the queue."); load(); } catch (x) { msg(x.message, true); }
  });
  function openSettings() { if (embed && window.parent?.dsOpenPage) window.parent.dsOpenPage("/setup?embed=1&s=printers"); else location.href = "/setup?s=printers"; }
  $("#settings").onclick = openSettings;
  $("#refresh").onclick = () => { msg(""); load(); };
  if (embed) { $("#close").hidden = false; $("#close").onclick = () => window.parent.postMessage({ type: "dayspring-page-close" }, location.origin); }
  document.addEventListener("keydown", (e) => { if (e.key !== "Escape") return; if (!$("#bigCam").hidden) return closeBig(); if (!$("#dlg").hidden) return $("#dlgNo").hidden ? $("#dlgYes").click() : $("#dlgNo").click(); if (embed) window.parent.postMessage({ type: "dayspring-page-close" }, location.origin); });
  try { const es = new EventSource("/api/events?page=printers"); let t = null; const soon = () => { clearTimeout(t); t = setTimeout(load, 600); }; es.addEventListener("printers", soon); es.addEventListener("printer-alert", soon); } catch { /* polling only */ }
  // the pictures (not the live views) refresh every 10 seconds
  setInterval(() => { if (document.hidden) return; for (const img of document.querySelectorAll("img[data-cam]")) if (!live.has(img.dataset.cam)) img.src = `/api/printers/${encodeURIComponent(img.dataset.cam)}/snapshot.jpg?t=${Date.now()}`; }, 10_000);
  setInterval(() => { if (!document.hidden && $("#dlg").hidden && $("#bigCam").hidden && !document.activeElement?.matches?.("input")) load(); }, 20_000);
  load();
})();
