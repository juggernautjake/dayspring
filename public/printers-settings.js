// Settings → 3D printers (public/setup.js shows it under "Apps & connections"; lib/printers behind /api/printers):
//   · add a printer: Bambu Lab (IP, serial, access code, model), a Creality Ender or other Marlin printer over USB (its
//     COM port), OctoPrint (address + API key) or Klipper/Moonraker (address), and Test the connection
//   · the Bambu LAN-mode / Developer-mode guide for each model (what to turn on at the printer)
//   · per printer: the empty-bed picture (per plate) and the bed area (drag a box on the picture), how often to look
//     while printing, auto-pause (off), auto-start when the bed is clear (off: "ask me first"), AI double-checks, keeping a
//     timelapse, "ask me if it came out okay", how long failed-print pictures are kept, a text on failure, a queue folder
// Everything saves as it's changed.
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const api = async (path, body, method) => { const r = await fetch("/api" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "That didn't work. Try again."); return j; };
  let root = null, opts = {}, L = [], CAT = null, editing = null;
  const $ = (s) => root?.querySelector(s);
  const say = (t, bad = false) => { const m = $("#pr-m"); if (m) { m.textContent = t; m.style.color = bad ? "var(--rose)" : ""; } };
  const GUIDE = {
    X1: "X1 / X1C / X1E: Settings (⚙) → Network → turn on LAN Only mode, then Developer mode (firmware 01.08.03 or newer). The Access Code is on the same screen. The camera works in LAN mode (turn on “LAN Only Liveview” if it's there).",
    P1: "P1S / P1P: Settings → WLAN (network) → turn on LAN Only mode, restart the printer, then turn on Developer mode (firmware 01.08.02 or newer). The Access Code is on the WLAN screen. The camera is the built-in (low frame rate) one.",
    A1: "A1 / A1 mini: Settings → WLAN → LAN Only mode on, restart, then Developer mode (firmware 01.05.00 or newer). The Access Code is on the WLAN screen.",
    H2: "H2D / H2S: Settings → General / Network → LAN Only mode and Developer mode, and ALSO “LAN Only Liveview” for the camera. Restart after turning it on.",
    P2: "P2S: LAN Only mode + Developer mode in the network settings; the Access Code is shown there.",
  };
  function html() {
    return `<h1>3D printers</h1>
      <p class="lead">Your printers' state, camera, and control by voice ("how's printer 3 doing?", "pause printer 3", "is the bed clear on printer 2?", "start the benchy on printer 1") and on the <a href="/printers.html" target="_blank" rel="noopener">Printers page</a>. Dayspring watches each print through the camera and warns you about spaghetti, stringing or a part coming loose.</p>
      <div class="note">🔒 Starting a print always needs a clear bed (checked with the camera just before) and, unless you turn on auto-start for that printer, your yes. Stopping asks. Dayspring never stops a print by itself.</div>
      <div id="pr-list"></div>
      <div class="row"><button type="button" class="btn" id="pr-add">+ Add a printer</button></div>
      <div id="pr-form" hidden></div>
      <h2>Bambu Lab: LAN mode and Developer mode</h2>
      <p class="hint">Newer Bambu firmware only takes commands from other apps (like Dayspring) when the printer is in <b>LAN Only mode with Developer mode on</b>. Status still works without it; pause, start and the rest are refused. In LAN Only mode the Bambu Handy app and cloud printing stop working (Bambu Studio and OrcaSlicer still print over your network). Dayspring never asks for your Bambu account password.</p>
      <div id="pr-guide"></div>
      <div class="msg" id="pr-m" aria-live="polite"></div>`;
  }
  const guideHtml = () => Object.entries(GUIDE).map(([k, t]) => `<div class="hint" style="margin:.3em 0"><b>${k}</b>: ${esc(t)}</div>`).join("");
  function listHtml() {
    if (!L.length) return `<p class="hint">No printers yet.</p>`;
    return L.map((p) => { const o = p.options ?? {}, id = esc(p.id); return `<div class="note" style="margin:.6em 0" data-p="${id}">
      <div class="row" style="align-items:center;gap:.5em;flex-wrap:wrap"><b>#${p.number} ${esc(p.name)}</b><span class="hint">${esc(p.brand)} ${esc(p.model ?? "")} · ${esc(p.brand === "marlin" ? p.serialPath : p.host)}${p.hasAccessCode ? " · 🔒 access code saved" : ""}${p.hasApiKey ? " · 🔒 API key saved" : ""} · ${esc(p.status?.online ? p.status.state : "not connected")}</span>
        <span style="flex:1"></span><button type="button" class="btn small" data-test="${id}">Test connection</button><button type="button" class="btn small ghost" data-edit="${id}">Change</button><button type="button" class="btn small ghost danger" data-del="${id}">Remove</button></div>
      <div class="hint" data-res="${id}"></div>
      ${p.status?.camera ? `<h3 style="margin:.7em 0 .3em">The empty bed</h3>
      <p class="hint">Clear the bed completely (the plate you normally print on), then take its picture. Then drag a box around the bed so only the bed is compared. A picture per plate: textured PEI, smooth PEI, cool plate…</p>
      <div class="row" style="align-items:flex-end"><div class="field"><label for="pl-${id}">Plate</label><input id="pl-${id}" type="text" value="${esc(p.bed?.plate ?? "default")}" data-plate="${id}"></div><button type="button" class="btn" data-ref="${id}">📷 Take the empty-bed picture</button><button type="button" class="btn ghost" data-check="${id}">Check the bed now</button></div>
      <div class="roi" data-roi="${id}" style="position:relative;max-width:36em;user-select:none;touch-action:none;cursor:crosshair" title="Drag a box around the bed">
        <img alt="${p.hasReference ? "The empty-bed picture" : "No empty-bed picture yet"}" src="/api/printers/${id}/${p.hasReference ? "reference" : "snapshot"}.jpg?t=${Date.now()}" style="width:100%;display:block;border-radius:.5em" draggable="false" onerror="this.alt='The camera didn\\'t answer.'">
        <div class="box" style="position:absolute;border:2px solid var(--gold);box-shadow:0 0 0 9999px rgba(0,0,0,.35);border-radius:.3em;pointer-events:none;${p.bed?.roi ? `left:${p.bed.roi.x * 100}%;top:${p.bed.roi.y * 100}%;width:${p.bed.roi.w * 100}%;height:${p.bed.roi.h * 100}%` : "display:none"}"></div></div>
      <div class="hint" data-bedres="${id}"></div>` : `<p class="hint">${p.brand === "marlin" ? "No camera: Dayspring will ask you to check the bed before every print. To have it look for you, point a webcam at the bed (Settings → Cameras) and choose it under Change." : "The camera isn't answering yet: Test connection first."}</p>`}
      <h3 style="margin:.7em 0 .3em">While printing</h3>
      <div class="row">
        <div class="field"><label for="sm-${id}">Look every (minutes)</label><input id="sm-${id}" type="number" min="1" max="120" value="${o.snapshotMinutes ?? 10}" data-opt="snapshotMinutes" data-id="${id}"></div>
        <div class="field"><label for="se-${id}">How sure before it warns you</label><select id="se-${id}" data-opt="sensitivity" data-id="${id}">${[[0.45, "Warn early (more false alarms)"], [0.6, "Balanced"], [0.75, "Only when quite sure"]].map(([v, l]) => `<option value="${v}" ${Math.abs((o.sensitivity ?? 0.6) - v) < 0.05 ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="field"><label for="ai-${id}">Ask the AI to look too</label><select id="ai-${id}" data-opt="aiVision" data-id="${id}"><option value="auto" ${o.aiVision == null ? "selected" : ""}>Like “Describe pictures with AI”</option><option value="true" ${o.aiVision === true ? "selected" : ""}>Yes (sends bed pictures to your AI)</option><option value="false" ${o.aiVision === false ? "selected" : ""}>No (this computer only)</option></select></div>
        <div class="field"><label for="rd-${id}">Keep failed-print pictures (days)</label><input id="rd-${id}" type="number" min="1" max="365" value="${o.retentionDays ?? 30}" data-opt="retentionDays" data-id="${id}"></div>
      </div>
      ${[["autoPause", "Pause by itself when it looks like it's failing", "Off: it tells you and asks. It never stops a print by itself."], ["autoStart", "Start queued prints by itself when the bed is clear", "Off (\"ask me first\"): it checks the bed, then asks you. On: a fresh clear-bed check is still required every time."], ["keepTimelapse", "Always keep a timelapse", "After a good print the pictures become one short video instead of being deleted."], ["confirmGood", "Ask me if it came out okay before clearing the pictures", ""], ["textOnFailure", "Also text me when a print fails", "Uses the phone number in Settings → Notifications."]].map(([k, l, h]) => `<div class="toggle"><div class="txt"><b id="t-${k}-${id}">${l}</b>${h ? `<div>${h}</div>` : ""}</div><button type="button" class="sw" role="switch" aria-labelledby="t-${k}-${id}" aria-checked="${Boolean(o[k])}" data-sw="${k}" data-id="${id}"></button></div>`).join("")}
      <div class="row" style="align-items:flex-end"><div class="field"><label for="qf-${id}">Queue folder (its .3mf / .gcode files are queued)</label><input id="qf-${id}" type="text" value="${esc(p.queue?.folder ?? "")}" data-folder="${id}" placeholder="C:\\Users\\you\\Documents\\Prints\\${esc(p.name)}"></div></div>
      </div>`; }).join("");
  }
  function form(p = {}) {
    editing = p; const f = $("#pr-form"); f.hidden = false;
    const brand = p.brand ?? "bambu";
    f.innerHTML = `<div class="note"><h3 style="margin:.2em 0">${p.id ? "Change" : "Add"} a printer</h3>
      <div class="row"><div class="field"><label for="pf-brand">Kind</label><select id="pf-brand"><option value="bambu">Bambu Lab (LAN mode)</option><option value="marlin">Creality Ender / other Marlin, over USB</option><option value="octoprint">OctoPrint</option><option value="moonraker">Klipper (Mainsail / Fluidd)</option></select></div>
        <div class="field"><label for="pf-name">Name</label><input id="pf-name" type="text" value="${esc(p.name ?? "")}" placeholder="Printer 1"></div>
        <div class="field"><label for="pf-num">Number (\"printer 3\")</label><input id="pf-num" type="number" min="1" max="99" value="${esc(p.number ?? "")}"></div></div>
      <div class="row" data-b="bambu"><div class="field"><label for="pf-model">Model</label><select id="pf-model">${(CAT?.bambuModels ?? []).map((m) => `<option value="${esc(m.id)}" ${m.id === p.model ? "selected" : ""}>${esc(m.label)}${m.camera === "none" ? " (camera not supported yet)" : ""}</option>`).join("")}</select></div>
        <div class="field"><label for="pf-serial">Serial number</label><input id="pf-serial" type="text" value="${esc(p.serial ?? "")}" placeholder="01P00A…" autocomplete="off"></div>
        <div class="field"><label for="pf-code">Access code</label><input id="pf-code" type="password" autocomplete="off" placeholder="${p.hasAccessCode ? "saved (type to change)" : "8 characters, on the printer's screen"}"></div></div>
      <div class="row" data-b="bambu octoprint moonraker"><div class="field"><label for="pf-host">IP address</label><input id="pf-host" type="text" value="${esc(p.host ?? "")}" placeholder="192.168.1.50"></div>
        <div class="field" data-b="octoprint moonraker"><label for="pf-key">API key</label><input id="pf-key" type="password" autocomplete="off" placeholder="${p.hasApiKey ? "saved (type to change)" : "OctoPrint: Settings → Application Keys"}"></div></div>
      <div class="row" data-b="marlin"><div class="field"><label for="pf-port">USB port</label><select id="pf-port">${(CAT?.ports ?? []).map((x) => `<option value="${esc(x.path)}" ${x.path === p.serialPath ? "selected" : ""}>${esc(x.path)} ${esc(x.name)}${x.likelyPrinter ? " ✓" : ""}</option>`).join("")}<option value="">(type it below)</option></select></div>
        <div class="field"><label for="pf-porttxt">…or type it</label><input id="pf-porttxt" type="text" value="${esc(p.serialPath ?? "")}" placeholder="COM3, or tcp://192.168.1.70:23 for a Wi-Fi serial bridge"></div>
        <div class="field"><label for="pf-baud">Speed (baud)</label><select id="pf-baud">${[115200, 250000].map((b) => `<option ${b === (p.baud ?? 115200) ? "selected" : ""}>${b}</option>`).join("")}</select></div>
        <div class="field"><label for="pf-mmodel">Model</label><select id="pf-mmodel"><option value="ENDER5PLUS">Ender 5 Plus</option><option value="ENDER3">Ender 3 / V2 / S1</option><option value="OTHER">Other</option></select></div></div>
      <div class="note" data-b="marlin">Straight over USB works, but this computer then feeds the printer line by line: if it sleeps, restarts for an update or the cable is bumped, the print stops. Dayspring keeps the computer awake while printing. <b>OctoPrint or Klipper on a Raspberry Pi is more reliable</b>; add it here when you have one.</div>
      <div class="row" data-b="marlin octoprint moonraker bambu"><div class="field"><label for="pf-cam">Camera (optional): a snapshot address</label><input id="pf-cam" type="text" value="${esc(p.cameraUrl ?? "")}" placeholder="http://…/snapshot.jpg (leave blank for the printer's own)"></div>
        <div class="field"><label for="pf-camid">…or a camera from Settings → Cameras (its id)</label><input id="pf-camid" type="text" value="${esc(p.cameraId ?? "")}" placeholder="garage-webcam"></div></div>
      <p class="hint" id="pf-guide"></p>
      <div class="row"><button type="button" class="btn primary" id="pf-save">Save and connect</button><button type="button" class="btn ghost" id="pf-cancel">Cancel</button></div><div class="hint" id="pf-res"></div></div>`;
    $("#pf-brand").value = brand;
    const sync = () => { const b = $("#pf-brand").value; f.querySelectorAll("[data-b]").forEach((x) => { x.hidden = !x.dataset.b.split(" ").includes(b); }); const fam = CAT?.bambuModels?.find((m) => m.id === $("#pf-model").value)?.family; $("#pf-guide").textContent = b === "bambu" ? GUIDE[fam] ?? "" : ""; };
    $("#pf-brand").onchange = sync; $("#pf-model").onchange = sync; sync();
    $("#pf-serial").onchange = async () => { const r = await api(`/printers/guess?serial=${encodeURIComponent($("#pf-serial").value)}`).catch(() => ({})); if (r.model) { $("#pf-model").value = r.model; sync(); } };
    if (p.model && brand === "marlin") $("#pf-mmodel").value = p.model;
    $("#pf-save").onclick = async () => {
      const b = $("#pf-brand").value;
      const body = { id: p.id, brand: b, name: $("#pf-name").value.trim(), number: $("#pf-num").value || undefined, cameraUrl: $("#pf-cam").value.trim(), cameraId: $("#pf-camid").value.trim(),
        ...(b === "bambu" ? { model: $("#pf-model").value, serial: $("#pf-serial").value.trim(), host: $("#pf-host").value.trim(), accessCode: $("#pf-code").value.trim() || undefined } : {}),
        ...(b === "marlin" ? { serialPath: $("#pf-porttxt").value.trim() || $("#pf-port").value, baud: Number($("#pf-baud").value), model: $("#pf-mmodel").value } : {}),
        ...(b === "octoprint" || b === "moonraker" ? { host: $("#pf-host").value.trim(), apiKey: $("#pf-key").value.trim() || undefined, model: b === "octoprint" ? "OctoPrint" : "Klipper" } : {}) };
      try { const r = await api("/printers/printer", body); $("#pf-res").textContent = "Saved. Testing…"; const t = await api(`/printers/${encodeURIComponent(r.printer.id)}/test`, {}); $("#pf-res").textContent = t.text; if (t.ok) { f.hidden = true; say(t.text); } await load(); }
      catch (e) { $("#pf-res").textContent = e.message; }
    };
    $("#pf-cancel").onclick = () => { f.hidden = true; };
    $("#pf-name").focus();
  }
  async function load() { [L, CAT] = await Promise.all([api("/printers").then((r) => r.printers), CAT ? Promise.resolve(CAT) : api("/printers/catalog")]); $("#pr-list").innerHTML = listHtml(); $("#pr-guide").innerHTML = guideHtml(); }
  // dragging a box on the empty-bed picture = the bed area (saved as fractions of the picture)
  function roiDrag(e) {
    const wrap = e.target.closest("[data-roi]"); if (!wrap) return;
    e.preventDefault();
    const r = wrap.getBoundingClientRect(), box = wrap.querySelector(".box"), x0 = (e.clientX - r.left) / r.width, y0 = (e.clientY - r.top) / r.height;
    const clamp = (v) => Math.max(0, Math.min(1, v));
    let roi = null;
    const move = (ev) => { const x1 = clamp((ev.clientX - r.left) / r.width), y1 = clamp((ev.clientY - r.top) / r.height); roi = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }; Object.assign(box.style, { display: "block", left: `${roi.x * 100}%`, top: `${roi.y * 100}%`, width: `${roi.w * 100}%`, height: `${roi.h * 100}%` }); };
    const up = async () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); if (roi && roi.w > 0.05 && roi.h > 0.05) { await api(`/printers/${encodeURIComponent(wrap.dataset.roi)}/bed`, { roi }).catch((x) => say(x.message, true)); say("Bed area saved."); } };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  }
  function mount(card, o = {}) {
    root = card; opts = o;
    load().catch((e) => say(e.message, true));
    root.addEventListener("pointerdown", roiDrag);
    root.addEventListener("click", async (e) => {
      const b = e.target.closest("button"); if (!b || !root.contains(b)) return;
      try {
        if (b.id === "pr-add") form({});
        else if (b.dataset.edit) form(L.find((p) => p.id === b.dataset.edit));
        else if (b.dataset.del) { if (confirm("Remove this printer from Dayspring? (The printer itself isn't changed.)")) { await api(`/printers/${encodeURIComponent(b.dataset.del)}`, undefined, "DELETE"); await load(); } }
        else if (b.dataset.test) { const el = root.querySelector(`[data-res="${CSS.escape(b.dataset.test)}"]`); el.textContent = "Connecting…"; const t = await api(`/printers/${encodeURIComponent(b.dataset.test)}/test`, {}); el.textContent = t.text; if (t.ok) await load(); }
        else if (b.dataset.ref) { b.disabled = true; const pl = root.querySelector(`[data-plate="${CSS.escape(b.dataset.ref)}"]`)?.value; const r = await api(`/printers/${encodeURIComponent(b.dataset.ref)}/reference`, { plate: pl }); say(`Saved the empty-bed picture for the ${r.plate} plate. Now drag a box around the bed.`); await load(); }
        else if (b.dataset.check) { const el = root.querySelector(`[data-bedres="${CSS.escape(b.dataset.check)}"]`); el.textContent = "Looking…"; const r = await api(`/printers/${encodeURIComponent(b.dataset.check)}/bedcheck`, {}); el.textContent = r.clear ? `✓ Clear (${Math.round(r.confidence * 100)}% sure)` : `✗ ${r.reason}`; }
        else if (b.dataset.sw) { const on = b.getAttribute("aria-checked") !== "true"; if (b.dataset.sw === "autoStart" && on && !confirm("Start queued prints by themselves whenever the bed looks clear? A fresh bed check still has to pass every time.")) return; await api(`/printers/${encodeURIComponent(b.dataset.id)}/options`, { [b.dataset.sw]: on }); b.setAttribute("aria-checked", String(on)); say("Saved."); }
      } catch (x) { say(x.message, true); }
    });
    root.addEventListener("change", async (e) => {
      const t = e.target;
      try {
        if (t.dataset.opt) { await api(`/printers/${encodeURIComponent(t.dataset.id)}/options`, { [t.dataset.opt]: t.dataset.opt === "aiVision" ? (t.value === "auto" ? null : t.value === "true") : t.value }); say("Saved."); }
        else if (t.dataset.folder) { const r = await api(`/printers/${encodeURIComponent(t.dataset.folder)}/queue/folder`, { folder: t.value.trim() }); say(`Saved. ${r.added?.length ?? 0} file${r.added?.length === 1 ? "" : "s"} queued from it.`); }
        else if (t.dataset.plate) { await api(`/printers/${encodeURIComponent(t.dataset.plate)}/bed`, { plate: t.value }); say("Plate saved: take its empty-bed picture if it's new."); }
      } catch (x) { say(x.message, true); }
    });
  }
  window.DayspringPrinterSettings = { html, mount, save: async () => {} };
})();
