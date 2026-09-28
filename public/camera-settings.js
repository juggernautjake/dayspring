// Settings → Cameras (under Apps & connections): add a camera by type with a guided form and brand presets, find ONVIF
// and USB cameras, test and preview, draw the region to watch, the schedule, what the AI looks for, alert rules, how long
// pictures and clips are kept, and where they're stored. Talks to /api/cameras (lib/cameras/routes.mjs).
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (path, body, method) => {
    const r = await fetch("/api" + path, body === undefined && !method ? {} : { method: method ?? "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || "That didn't work. Try again."), { off: j.off });
    return j;
  };
  let root = null, opts = {}, S = null, ed = null, dirty = false;
  const $ = (s) => root?.querySelector(s);
  const $$ = (s) => [...(root?.querySelectorAll(s) ?? [])];
  const toast = (t) => (opts.toast ? opts.toast(t) : null);
  const say = (t, bad = false) => { const m = $("#cs-msg"); if (m) { m.textContent = t; m.className = "msg" + (bad ? " err" : " ok"); } };

  const TYPES = [
    ["rtsp", "📹", "IP or security camera", "Reolink, Amcrest, Hikvision, Dahua, Tapo, Wyze, Eufy, or any RTSP address"],
    ["onvif", "🔎", "ONVIF camera", "Most IP cameras: find it on your network and let it tell Dayspring its addresses"],
    ["usb", "🎥", "USB webcam", "A webcam plugged into this computer (and GoPro webcam mode)"],
    ["http", "🖼️", "Picture or MJPEG address", "A snapshot.jpg or MJPEG link"],
    ["gopro", "🏄", "GoPro", "HERO9 and newer, over USB or its Wi-Fi"],
    ["homeassistant", "🏠", "Home Assistant camera", "Any camera your Home Assistant has (Nest, Ring, Blink, Frigate…)"],
    ["email", "✉️", "Trail camera by email", "A cellular trail camera that emails its photos"],
    ["folder", "📁", "Trail camera or photo folder", "A folder the camera's app syncs to, or an SD card"],
  ];
  const typeLabel = (k) => TYPES.find((t) => t[0] === k)?.[2] ?? k;
  const LABELS = [["person", "People"], ["deer", "Deer"], ["animal", "Any animal"], ["vehicle", "Vehicles"], ["package", "Packages"], ["motion", "Any motion"]];

  function html() {
    return `<h1>Cameras</h1>
      <p class="lead">Webcams, security cameras, GoPros and trail cameras: Dayspring checks them on a schedule (or watches for motion), tells you when something matters, and keeps the pictures and clips you want. <a href="/help?embed=1#cameras" target="_blank" rel="noopener">How to find your camera's address</a></p>
      <style>
        .cs-cams{display:grid;gap:.6em;margin:.6em 0}
        .cs-cam{display:flex;gap:.8em;align-items:center;background:var(--panel2,rgba(34,40,80,.6));border:1px solid var(--edge,rgba(160,170,255,.14));border-radius:.8em;padding:.6em .8em;flex-wrap:wrap}
        .cs-cam img{width:7.5em;height:4.2em;object-fit:cover;border-radius:.5em;background:#0b0e22;flex:0 0 auto}
        .cs-cam .t{flex:1 1 12em;min-width:0}.cs-cam .t b{display:block}.cs-cam .t span{color:var(--dim,#8d94b8);font-size:.85em}
        .cs-types{display:grid;grid-template-columns:repeat(auto-fill,minmax(14em,1fr));gap:.6em;margin:.6em 0}
        .cs-type{text-align:left;background:rgba(255,255,255,.05);border:1px solid var(--edge2,rgba(170,180,255,.28));border-radius:.8em;padding:.7em .8em;cursor:pointer;color:inherit}
        .cs-type:hover,.cs-type:focus-visible{background:rgba(124,140,255,.22)}.cs-type b{display:block}.cs-type span{color:var(--dim,#8d94b8);font-size:.85em}
        .cs-edit{border:1px solid var(--edge2,rgba(170,180,255,.28));border-radius:1em;padding:.4em 1em 1em;margin:.8em 0;background:rgba(10,12,30,.35)}
        .cs-prev{position:relative;max-width:36em;margin:.6em 0;user-select:none;touch-action:none}
        .cs-prev img{width:100%;display:block;border-radius:.6em;background:#0b0e22;min-height:6em}
        .cs-prev canvas{position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;border-radius:.6em}
        .cs-chips{display:flex;flex-wrap:wrap;gap:.4em .9em;margin:.3em 0}.cs-chips label{display:flex;gap:.35em;align-items:center}
        .cs-found{display:grid;gap:.3em;margin:.4em 0}.cs-found button{text-align:left}
        .cs-rec{color:#ff6b7d;font-weight:600}
        .msg.err{color:var(--rose,#ff8fa3)}.msg.ok{color:var(--mint,#7ee3b0)}
      </style>
      <div id="cs-status" class="note" aria-live="polite">Loading…</div>
      <h2>Your cameras</h2>
      <div id="cs-cams" class="cs-cams"></div>
      <div class="row" style="gap:.6em"><button type="button" class="btn" id="cs-add">＋ Add a camera</button><a class="btn ghost" href="/cameras.html" target="_blank" rel="noopener" id="cs-open">Open the Cameras page ↗</a></div>
      <div id="cs-edit" class="cs-edit" hidden></div>
      <h2>Storage</h2>
      <div class="row">
        <div class="field"><label for="cs-dir">Keep pictures and clips in</label><input id="cs-dir" placeholder="Dayspring's own data folder"><div class="hint" id="cs-dir-h">Leave empty for Dayspring's data folder. Another folder needs "read and write" in Settings → Permissions.</div></div>
        <div class="field" style="flex:0 1 12em"><label for="cs-cap">Space limit (GB)</label><input id="cs-cap" type="number" min="0.1" step="0.1"><div class="hint">The oldest files go first when it's full.</div></div>
      </div>
      <div class="row" style="gap:.6em;align-items:center"><button type="button" class="btn small" id="cs-savest">Save storage</button><span class="hint" id="cs-usage"></span></div>
      <h2>Privacy</h2>
      <p class="hint">Passwords are encrypted with your Windows account and never shown or logged. Pictures go to your AI provider only for cameras where you turn on "Analyse with AI". Faces are never recognised unless you turn it on for one camera, and never on a camera that sees the street or a neighbour's property. Recording audio, or recording other people's property, may be restricted where you live: see the guide.</p>
      <div class="msg" id="cs-msg" aria-live="polite"></div>`;
  }

  async function load() {
    try { S = await api("/cameras"); }
    catch (e) { if ($("#cs-status")) $("#cs-status").textContent = e.off ? "Cameras aren't part of this version of Dayspring yet." : e.message; return null; }
    paint(); return S;
  }
  const kb = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(0)} MB` : `${Math.round(n / 1e3)} KB`);
  function paint() {
    if (!root?.isConnected || !S) return;
    $("#cs-status").textContent = S.cameras.length ? `${S.cameras.length} camera${S.cameras.length === 1 ? "" : "s"}. ${S.status.running ? "Watching." : "Checks start when Dayspring runs on this computer."}${S.status.recording.length ? " ● Recording now." : ""}` : "No cameras yet. Add one below.";
    $("#cs-cams").innerHTML = S.cameras.map((c) => `<div class="cs-cam" data-id="${esc(c.id)}">
        <img alt="" loading="lazy" data-src="/api/cameras/${esc(c.id)}/snapshot?cached=1">
        <div class="t"><b>${esc(c.name)}${c.status?.recording ? ' <span class="cs-rec" title="Recording">● REC</span>' : ""}</b><span>${esc(typeLabel(c.kind))}${c.room ? " · " + esc(c.room) : ""}${c.registered ? " · added by another feature" : ""} · ${c.enabled === false ? "off" : c.schedule?.mode === "motion" ? "watching for motion" : c.schedule?.mode === "every" ? `every ${c.schedule.everyMin} min` : "not scheduled"}${c.ai?.enabled ? " · AI" : ""}${c.status?.error ? ` · ⚠ ${esc(c.status.error)}` : ""}</span></div>
        ${c.registered ? "" : `<button type="button" class="btn small" data-act="edit">Edit</button><button type="button" class="btn small ghost" data-act="test">Test</button><button type="button" class="btn small danger" data-act="del">Remove</button>`}</div>`).join("") || `<div class="hint">Nothing here yet.</div>`;
    $$(".cs-cam img[data-src]").forEach((img) => { img.onerror = () => { img.style.visibility = "hidden"; }; img.src = img.dataset.src; });
    $("#cs-dir").value = S.settings.storageDir ?? ""; $("#cs-dir").placeholder = S.settings.defaultStorage;
    $("#cs-cap").value = S.settings.diskCapGB;
    $("#cs-usage").textContent = `Using ${kb(S.usage.bytes)} in ${S.usage.files} files.`;
  }

  // ---------------------------------------------------------------- the editor
  function blank(kind) {
    const trail = kind === "email" || kind === "folder";
    return { kind, name: "", room: "", role: trail ? "trail" : kind === "usb" ? "indoor" : "security", publicFacing: false, enabled: true, preset: null, conn: kind === "gopro" ? { via: "usb", mode: "photo" } : {},
      schedule: { mode: trail ? "every" : kind === "usb" || kind === "gopro" ? "off" : "motion", everyMin: trail ? 15 : 10, checkSec: 5 }, motion: { sensitivity: 50, roi: [] },
      ai: { enabled: false, when: "motion", prompt: "", watchFor: trail ? ["deer", "animal", "person"] : ["person", "animal", "vehicle", "package"] }, faces: false,
      alerts: { on: kind !== "usb" && kind !== "gopro", labels: trail ? ["deer", "animal", "person"] : ["person", "vehicle", "package"], urgent: [], quiet: null, cooldownMin: 10, channels: { screen: true, voice: true, phone: false, devices: true }, summary: true },
      retention: { mode: "events", days: 14 }, record: { mode: "off", preSec: 5, postSec: 10, segmentMin: 5 }, audio: false };
  }
  function openTypes() {
    ed = null; const box = $("#cs-edit"); box.hidden = false;
    box.innerHTML = `<h2>What kind of camera?</h2><div class="cs-types">${TYPES.map(([k, ic, t, d]) => `<button type="button" class="cs-type" data-kind="${k}"><b>${ic} ${esc(t)}</b><span>${esc(d)}</span></button>`).join("")}</div><button type="button" class="btn small ghost" id="cs-cancel">Cancel</button>`;
    $$(".cs-type").forEach((b) => b.onclick = () => openEditor(blank(b.dataset.kind)));
    $("#cs-cancel").onclick = closeEditor;
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function closeEditor() { ed = null; dirty = false; const b = $("#cs-edit"); if (b) { b.hidden = true; b.innerHTML = ""; } }
  const sel = (id, v, list) => `<select id="${id}">${list.map(([a, b]) => `<option value="${esc(a)}"${String(a) === String(v) ? " selected" : ""}>${esc(b)}</option>`).join("")}</select>`;
  const inp = (id, label, v = "", ph = "", type = "text", hint = "") => `<div class="field"><label for="${id}">${esc(label)}</label><input id="${id}" type="${type}" value="${esc(v)}" placeholder="${esc(ph)}" autocomplete="off">${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
  const chk = (id, label, on, dis = false) => `<label><input type="checkbox" id="${id}"${on ? " checked" : ""}${dis ? " disabled" : ""}> ${esc(label)}</label>`;

  function connHtml(c) {
    const k = c.kind, cn = c.conn ?? {};
    const pass = inp("cs-pass", "Password", "", cn.hasPassword ? "saved (type to change)" : "", "password", "Encrypted on this computer. Never shown again.");
    const user = inp("cs-user", "User name", cn.username ?? "", "admin");
    if (k === "usb") return `<div class="row"><div class="field"><label for="cs-dev">Webcam</label>${sel("cs-dev", cn.device ?? "", [[cn.device ?? "", cn.device || "Press Find webcams"]])}</div></div>
      <button type="button" class="btn small" id="cs-findusb">Find webcams</button> <span class="hint">Lists the names only; no camera is turned on until you press Test.</span>`;
    if (k === "rtsp") {
      const presets = (S?.presets ?? []).filter((p) => p.kind === "rtsp");
      return `<div class="row"><div class="field"><label for="cs-preset">Brand</label>${sel("cs-preset", c.preset ?? "generic-rtsp", presets.map((p) => [p.id, p.label]))}<div class="hint" id="cs-pnote"></div></div></div>
        <div class="row">${inp("cs-host", "Camera address (IP)", cn.host ?? "", "192.168.1.50")}${inp("cs-chan", "Channel", cn.channel ?? 1, "1", "number")}${inp("cs-bname", "Camera name in the bridge", cn.bridgeName ?? "", "front-door")}</div>
        <div class="row"><label style="display:flex;gap:.4em;align-items:center"><input type="checkbox" id="cs-sub"${cn.sub ? " checked" : ""}> Use the smaller sub-stream (less work for this computer)</label> <button type="button" class="btn small" id="cs-fill">Fill in the addresses</button></div>
        <div class="row">${user}${pass}</div>
        ${inp("cs-url", "Stream address", cn.url ?? "", "rtsp://…", "text", "A password typed in the address is taken out and stored encrypted.")}
        ${inp("cs-snap", "Snapshot address (optional, faster pictures)", cn.snapshotUrl ?? "", "http://…/snapshot.jpg")}`;
    }
    if (k === "onvif") return `<div class="row">${inp("cs-host", "Camera address", cn.host ?? "", "192.168.1.50")}${inp("cs-port", "ONVIF port", cn.port ?? 80, "80", "number", "80 for most; 8000 Reolink; 2020 Tapo")}</div>
      <div class="row">${user}${pass}</div>
      <div class="row" style="gap:.6em"><button type="button" class="btn small" id="cs-discover">Find ONVIF cameras</button><button type="button" class="btn small ghost" id="cs-profiles">Load its video profiles</button></div>
      <div class="cs-found" id="cs-found"></div><div class="field"><label for="cs-profile">Video profile</label>${sel("cs-profile", cn.profile ?? "", [[cn.profile ?? "", cn.profile || "The camera's first (usually the best)"]])}</div>`;
    if (k === "http") return `${inp("cs-snap", "Picture address", cn.snapshotUrl ?? "", "http://192.168.1.50/snapshot.jpg")}${inp("cs-mjpeg", "MJPEG stream address (optional, for live view)", cn.mjpegUrl ?? "", "http://192.168.1.50/video.mjpg")}<div class="row">${user}${pass}</div>`;
    if (k === "gopro") return `<div class="row"><div class="field"><label for="cs-via">Connected by</label>${sel("cs-via", cn.via ?? "usb", [["usb", "USB cable"], ["wifi", "The GoPro's Wi-Fi (this computer joins it)"]])}</div>
      ${inp("cs-serial", "Serial number (USB)", cn.serial ?? "", "C3441324567890", "text", "On the box, or in the GoPro's Preferences → About. Only the last 3 digits matter.")}
      <div class="field"><label for="cs-gmode">Pictures by</label>${sel("cs-gmode", cn.mode ?? "photo", [["photo", "Taking a real photo (sharpest)"], ["preview", "A frame from the live preview"]])}</div></div>
      <details class="note"><summary>Which GoPros work</summary><table class="hint">${(S?.gopro ?? []).map((m) => `<tr><td>${esc(m.model)}</td><td>${m.http ? "✓ pictures, live, media" : "✗ no Open GoPro"}</td><td>webcam: ${esc(m.webcam)}</td></tr>`).join("")}</table><p class="hint">For webcam mode, add it as a USB webcam instead.</p></details>`;
    if (k === "homeassistant") return `<div class="field"><label for="cs-entity">Home Assistant camera</label>${sel("cs-entity", cn.entity ?? "", [[cn.entity ?? "", cn.entity || "Press Find"]])}</div><button type="button" class="btn small" id="cs-findha">Find Home Assistant cameras</button> <span class="hint" id="cs-hahint"></span>`;
    if (k === "email" || k === "folder") {
      const brands = (S?.trail ?? []).filter((t) => t.routes.includes(k));
      return `<div class="field"><label for="cs-brand">Brand</label>${sel("cs-brand", cn.brand ?? brands[0]?.id ?? "other", brands.map((t) => [t.id, t.label]))}<div class="hint" id="cs-bnote"></div></div>
        ${k === "email" ? `<div class="row">${inp("cs-from", "Emails come from", cn.from ?? "", "spypoint.com", "text", "Part of the sender's address. Several: separate with commas.")}${inp("cs-subj", "Subject contains (optional)", cn.subject ?? "", "New photo")}</div>
          <p class="hint">Dayspring reads these with your email accounts (Settings → Email), without marking them read. Photos come from the attachments or the photo links.</p>`
          : `${inp("cs-folder", "Folder", cn.folder ?? "", "D:\\Trail cam photos", "text", "Dayspring needs permission to read it (Settings → Permissions). New pictures become events; videos show under recordings.")}`}`;
    }
    return "";
  }
  function openEditor(c) {
    ed = structuredClone(c); dirty = false;
    const box = $("#cs-edit"); box.hidden = false;
    const aiNote = S?.ai?.canSee ? `Sends pictures to ${esc(S.ai.provider)} (only this camera, only on motion or the schedule you pick).` : "Your AI can't look at pictures (or there's no AI), so Dayspring uses motion only.";
    box.innerHTML = `<h2>${ed.id ? "Edit" : "Add"}: ${esc(typeLabel(ed.kind))}</h2>
      <div class="row">${inp("cs-name", "Name", ed.name, ed.kind === "email" || ed.kind === "folder" ? "Trail cam" : "Front door")}${inp("cs-room", "Room or place", ed.room, "shop, driveway, back 40")}
        <div class="field"><label for="cs-role">Kind of place</label>${sel("cs-role", ed.role, [["security", "Security (outside, doors)"], ["indoor", "Inside the house"], ["trail", "Trail or hunting"], ["general", "Other"]])}</div></div>
      <div class="cs-chips">${chk("cs-public", "It sees the street, a sidewalk or a neighbour's property (public-facing)", ed.publicFacing)}${chk("cs-enabled", "On", ed.enabled !== false)}</div>
      ${connHtml(ed)}
      <h2>Test and preview</h2>
      <div class="row" style="gap:.6em;align-items:center"><button type="button" class="btn small" id="cs-test">Test and preview</button><span class="hint" id="cs-testmsg"></span></div>
      <div class="cs-prev" id="cs-prev" hidden><img id="cs-img" alt="Camera preview"><canvas id="cs-roi" aria-label="Region to watch: drag to draw a box"></canvas></div>
      <div class="row" style="gap:.6em" id="cs-roirow" hidden><span class="hint">Drag on the picture to draw the parts to watch for motion (up to 8). None = the whole picture.</span><button type="button" class="btn small ghost" id="cs-roiclear">Clear the boxes</button></div>
      <h2>Checking</h2>
      <div class="row"><div class="field"><label for="cs-mode">How</label>${sel("cs-mode", ed.schedule.mode, [["off", "Not on a schedule (only when you look)"], ["every", "A picture every few minutes"], ["motion", "Watch for motion (a quick check every few seconds)"]])}</div>
        ${inp("cs-every", "Picture every (minutes)", ed.schedule.everyMin, "10", "number")}${inp("cs-check", "Motion check every (seconds)", ed.schedule.checkSec, "5", "number")}</div>
      <div class="field"><label for="cs-sens">Motion sensitivity: <span id="cs-sensv">${ed.motion.sensitivity}</span></label><input id="cs-sens" type="range" min="0" max="100" value="${ed.motion.sensitivity}"><div class="hint">Lower if leaves, rain or shadows set it off; higher for small or far-off things.</div></div>
      <h2>Looking with AI</h2>
      <div class="cs-chips">${chk("cs-ai", "Analyse with AI", ed.ai.enabled, !S?.ai?.canSee)}</div><div class="hint">${aiNote}</div>
      <div class="row"><div class="field"><label for="cs-aiwhen">When</label>${sel("cs-aiwhen", ed.ai.when, [["motion", "When something moves"], ["schedule", "On the schedule"], ["both", "Both"]])}</div></div>
      <div class="field"><label>Look for</label><div class="cs-chips" id="cs-watch">${LABELS.filter(([k]) => k !== "motion").map(([k, t]) => chk(`cs-w-${k}`, t, ed.ai.watchFor.includes(k))).join("")}</div></div>
      ${inp("cs-prompt", "Your own question for this camera (optional)", ed.ai.prompt, "Tell me if there's a deer. / Is the garage door open?")}
      <div class="cs-chips">${chk("cs-faces", "Recognise people I've named (face recognition)", ed.faces && !ed.publicFacing, ed.publicFacing)}</div>
      <div class="hint" id="cs-faceshint">${ed.publicFacing ? "Never on a public-facing camera." : "Off by default. Only people you named in Photos & people, only on this camera. Others are described in general words."}</div>
      <h2>Alerts</h2>
      <div class="cs-chips">${chk("cs-alerts", "Tell me when it sees something", ed.alerts.on)}</div>
      <div class="field"><label>Alert for</label><div class="cs-chips">${LABELS.map(([k, t]) => chk(`cs-a-${k}`, t, ed.alerts.labels.includes(k))).join("")}</div><div class="hint">Your own question matching always alerts.</div></div>
      <div class="row">${inp("cs-qfrom", "Quiet from", ed.alerts.quiet?.from ?? "", "22:00", "time")}${inp("cs-qto", "Quiet until", ed.alerts.quiet?.to ?? "", "06:00", "time")}${inp("cs-cool", "Don't repeat within (minutes)", ed.alerts.cooldownMin, "10", "number")}</div>
      <div class="hint">In quiet hours alerts wait, and come out as one summary after ("3 deer visits overnight"). People still alert in quiet hours if you tick: ${chk("cs-urg-person", "People are urgent", ed.alerts.urgent.includes("person"))}</div>
      <div class="field"><label>Send alerts to</label><div class="cs-chips">${chk("cs-ch-screen", "The Dayspring screen", ed.alerts.channels.screen)}${chk("cs-ch-voice", "Say it out loud", ed.alerts.channels.voice)}${chk("cs-ch-phone", "My phone (text)", ed.alerts.channels.phone)}${chk("cs-ch-devices", "My other devices", ed.alerts.channels.devices)}${chk("cs-summary", "Summaries after quiet hours", ed.alerts.summary)}</div></div>
      <h2>Keeping pictures and video</h2>
      <div class="row"><div class="field"><label for="cs-ret">Keep</label>${sel("cs-ret", ed.retention.mode, [["events", "Only events (something happened)"], ["all", "Every picture, for the timeline"], ["hook", "Let the feature decide (printers: delete if fine)"]])}</div>${inp("cs-days", "For (days)", ed.retention.days, "14", "number")}</div>
      <div class="row"><div class="field"><label for="cs-rec">Record video</label>${sel("cs-rec", ed.record.mode, [["off", "No video"], ["events", "A clip for each event"], ["continuous", "All the time (in pieces)"]])}</div>${inp("cs-pre", "Seconds before", ed.record.preSec, "5", "number")}${inp("cs-post", "Seconds after", ed.record.postSec, "10", "number")}${inp("cs-seg", "Piece length (minutes)", ed.record.segmentMin, "5", "number")}</div>
      <div class="cs-chips">${chk("cs-audio", "Record sound too", ed.audio)}</div><div class="hint">Recording conversations can need everyone's consent where you live. Off by default.</div>
      <div class="row" style="gap:.6em;margin-top:1em"><button type="button" class="btn" id="cs-save">${ed.id ? "Save changes" : "Add the camera"}</button><button type="button" class="btn ghost" id="cs-cancel">Cancel</button></div>`;
    wireEditor();
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // read the form into a camera object (password only when typed)
  function readForm() {
    const v = (id) => $(`#${id}`)?.value?.trim() ?? "";
    const on = (id) => Boolean($(`#${id}`)?.checked);
    const c = structuredClone(ed);
    c.name = v("cs-name"); c.room = v("cs-room"); c.role = v("cs-role") || c.role; c.publicFacing = on("cs-public"); c.enabled = on("cs-enabled");
    const cn = { ...(c.conn ?? {}) }; delete cn.hasPassword;
    const k = c.kind;
    if (k === "usb") cn.device = v("cs-dev");
    if (k === "rtsp") { c.preset = v("cs-preset"); cn.host = v("cs-host"); cn.channel = Number(v("cs-chan")) || 1; cn.bridgeName = v("cs-bname"); cn.sub = on("cs-sub"); cn.url = v("cs-url"); cn.snapshotUrl = v("cs-snap"); cn.username = v("cs-user"); }
    if (k === "onvif") { cn.host = v("cs-host"); cn.port = Number(v("cs-port")) || 80; cn.username = v("cs-user"); cn.profile = v("cs-profile") || null; }
    if (k === "http") { cn.snapshotUrl = v("cs-snap"); cn.mjpegUrl = v("cs-mjpeg"); cn.username = v("cs-user"); }
    if (k === "gopro") { cn.via = v("cs-via"); cn.serial = v("cs-serial"); cn.mode = v("cs-gmode"); }
    if (k === "homeassistant") cn.entity = v("cs-entity");
    if (k === "email") { cn.brand = v("cs-brand"); cn.from = v("cs-from"); cn.subject = v("cs-subj"); }
    if (k === "folder") { cn.brand = v("cs-brand"); cn.folder = v("cs-folder"); }
    const pw = $("#cs-pass")?.value ?? ""; if (pw) cn.password = pw; else delete cn.password;
    c.conn = cn;
    c.schedule = { mode: v("cs-mode"), everyMin: Number(v("cs-every")) || 10, checkSec: Number(v("cs-check")) || 5 };
    c.motion = { sensitivity: Number(v("cs-sens")) || 0, roi: ed.motion.roi ?? [] };
    c.ai = { enabled: on("cs-ai"), when: v("cs-aiwhen"), prompt: v("cs-prompt"), watchFor: LABELS.map(([x]) => x).filter((x) => on(`cs-w-${x}`)) };
    c.faces = on("cs-faces") && !c.publicFacing;
    c.alerts = { on: on("cs-alerts"), labels: LABELS.map(([x]) => x).filter((x) => on(`cs-a-${x}`)), urgent: on("cs-urg-person") ? ["person"] : [], quiet: v("cs-qfrom") && v("cs-qto") ? { from: v("cs-qfrom"), to: v("cs-qto") } : null,
      cooldownMin: Number(v("cs-cool")) || 0, channels: { screen: on("cs-ch-screen"), voice: on("cs-ch-voice"), phone: on("cs-ch-phone"), devices: on("cs-ch-devices") }, summary: on("cs-summary") };
    c.retention = { mode: v("cs-ret"), days: Number(v("cs-days")) || 14 };
    c.record = { mode: v("cs-rec"), preSec: Number(v("cs-pre")) || 0, postSec: Number(v("cs-post")) || 10, segmentMin: Number(v("cs-seg")) || 5 };
    c.audio = on("cs-audio");
    return c;
  }

  function wireEditor() {
    const box = $("#cs-edit");
    box.addEventListener("input", () => { dirty = true; });
    box.addEventListener("change", () => { dirty = true; });
    $("#cs-cancel").onclick = closeEditor;
    $("#cs-save").onclick = saveCamera;
    $("#cs-test").onclick = test;
    $("#cs-sens").oninput = () => { $("#cs-sensv").textContent = $("#cs-sens").value; };
    $("#cs-public").onchange = () => { const p = $("#cs-public").checked; $("#cs-faces").disabled = p; if (p) $("#cs-faces").checked = false; $("#cs-faceshint").textContent = p ? "Never on a public-facing camera." : "Off by default. Only people you named in Photos & people, only on this camera."; };
    const pnote = () => { const p = (S?.presets ?? []).find((x) => x.id === $("#cs-preset")?.value); if ($("#cs-pnote")) $("#cs-pnote").textContent = p?.note ?? ""; if ($("#cs-bname")) $("#cs-bname").closest(".field").hidden = p?.id !== "wyze-bridge"; };
    if ($("#cs-preset")) { $("#cs-preset").onchange = pnote; pnote(); }
    if ($("#cs-fill")) $("#cs-fill").onclick = () => {
      const id = $("#cs-preset").value, host = $("#cs-host").value.trim();
      const p = (S?.presets ?? []).find((x) => x.id === id);
      if (!p || id.startsWith("generic")) { say("Pick a brand first, or paste the address."); return; }
      if (!host) { say("Type the camera's address first.", true); return; }
      api("/cameras/preset", { id, host, channel: Number($("#cs-chan").value) || 1, sub: $("#cs-sub").checked, name: $("#cs-bname").value.trim() }).then((r) => { $("#cs-url").value = r.url; $("#cs-snap").value = r.snapshotUrl ?? ""; ed.conn.recordings = r.recordings ?? null; dirty = true; say("Filled in. Press Test to check it."); }).catch((e) => say(e.message, true));
    };
    const bnote = () => { const t = (S?.trail ?? []).find((x) => x.id === $("#cs-brand")?.value); if ($("#cs-bnote")) $("#cs-bnote").textContent = t?.note ?? ""; if (t?.from && $("#cs-from") && !$("#cs-from").value) $("#cs-from").value = t.from.split("|")[0].replace(/\\/g, ""); };
    if ($("#cs-brand")) { $("#cs-brand").onchange = bnote; bnote(); }
    if ($("#cs-findusb")) $("#cs-findusb").onclick = async () => {
      const r = await api("/cameras/discover/usb").catch((e) => ({ devices: [], error: e.message }));
      $("#cs-dev").innerHTML = r.devices.length ? r.devices.map((d) => `<option>${esc(d.name)}</option>`).join("") : `<option value="">No webcams found</option>`;
      if (r.devices.length && !$("#cs-name").value) $("#cs-name").value = r.devices[0].name;
      dirty = true;
    };
    if ($("#cs-findha")) $("#cs-findha").onclick = async () => {
      const r = await api("/cameras/discover/homeassistant").catch((e) => ({ cameras: [], error: e.message }));
      $("#cs-hahint").textContent = r.connected ? `${r.cameras.length} found` : "Connect Home Assistant first in Settings → Apps & connections.";
      if (r.cameras.length) $("#cs-entity").innerHTML = r.cameras.map((c) => `<option value="${esc(c.entity)}">${esc(c.name)} (${esc(c.entity)})</option>`).join("");
      dirty = true;
    };
    if ($("#cs-discover")) $("#cs-discover").onclick = async () => {
      $("#cs-found").innerHTML = `<span class="hint">Asking the network for ONVIF cameras (3 seconds)…</span>`;
      const r = await api("/cameras/discover/onvif").catch((e) => ({ found: [], error: e.message }));
      $("#cs-found").innerHTML = r.found.length ? r.found.map((d, i) => `<button type="button" class="btn small ghost" data-i="${i}">${esc(d.name || d.hardware || "Camera")} · ${esc(d.host)}:${d.port}</button>`).join("") : `<span class="hint">None answered. Some cameras need ONVIF turned on in their own settings; you can still type the address.</span>`;
      $$("#cs-found button").forEach((b) => b.onclick = () => { const d = r.found[Number(b.dataset.i)]; $("#cs-host").value = d.host; $("#cs-port").value = d.port; ed.conn.xaddr = d.xaddr; if (!$("#cs-name").value && d.name) $("#cs-name").value = d.name; dirty = true; });
    };
    if ($("#cs-profiles")) $("#cs-profiles").onclick = async () => {
      const r = await api("/cameras/discover/onvif-profiles", { id: ed.id ?? null, host: $("#cs-host").value.trim(), port: Number($("#cs-port").value) || 80, xaddr: ed.conn.xaddr ?? null, username: $("#cs-user").value.trim(), password: $("#cs-pass").value });
      if (r.error) { say(r.error, true); return; }
      $("#cs-profile").innerHTML = r.profiles.map((p) => `<option value="${esc(p.token)}">${esc(p.name || p.token)}${p.width ? ` (${p.width}×${p.height})` : ""}</option>`).join("");
      say(`${r.profiles.length} profile${r.profiles.length === 1 ? "" : "s"}.`); dirty = true;
    };
    roiWire();
  }

  // ---- region of interest: drag boxes on the preview ----
  function roiWire() {
    const cv = $("#cs-roi"); if (!cv) return;
    let drag = null;
    const rel = (e) => { const r = cv.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; };
    const draw = () => {
      const r = cv.getBoundingClientRect(); cv.width = Math.max(1, Math.round(r.width)); cv.height = Math.max(1, Math.round(r.height));
      const g = cv.getContext("2d"); g.clearRect(0, 0, cv.width, cv.height);
      const boxes = [...(ed?.motion?.roi ?? []), ...(drag ? [drag.box] : [])];
      if (boxes.length) { g.fillStyle = "rgba(7,9,22,.45)"; g.fillRect(0, 0, cv.width, cv.height); }
      for (const b of boxes) { g.clearRect(b.x * cv.width, b.y * cv.height, b.w * cv.width, b.h * cv.height); g.strokeStyle = "#7ee3b0"; g.lineWidth = 2; g.strokeRect(b.x * cv.width, b.y * cv.height, b.w * cv.width, b.h * cv.height); }
    };
    cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); const p = rel(e); drag = { p, box: { x: p.x, y: p.y, w: 0, h: 0 } }; draw(); };
    cv.onpointermove = (e) => { if (!drag) return; const p = rel(e); drag.box = { x: Math.min(p.x, drag.p.x), y: Math.min(p.y, drag.p.y), w: Math.abs(p.x - drag.p.x), h: Math.abs(p.y - drag.p.y) }; draw(); };
    cv.onpointerup = () => { if (!drag) return; const b = drag.box; drag = null; if (b.w > 0.02 && b.h > 0.02) { ed.motion.roi = [...(ed.motion.roi ?? []), b].slice(-8); dirty = true; } draw(); };
    $("#cs-roiclear").onclick = () => { ed.motion.roi = []; dirty = true; draw(); };
    $("#cs-img").onload = draw;
    addEventListener("resize", draw);
    roiWire.draw = draw;
  }
  async function test() {
    const m = $("#cs-testmsg"); m.textContent = "Asking the camera for a picture…";
    try {
      const r = await api("/cameras/test", { id: ed.id ?? null, camera: readForm() });
      if (!r.ok) { m.textContent = "⚠ " + r.error; return; }
      m.textContent = `✓ Got a picture in ${(r.ms / 1000).toFixed(1)} s. Drag on it to pick the parts to watch.`;
      $("#cs-prev").hidden = false; $("#cs-roirow").hidden = false;
      $("#cs-img").src = r.jpeg;
      window.dsKeepInSafe?.($("#cs-prev"));
    } catch (e) { m.textContent = "⚠ " + e.message; }
  }
  async function saveCamera() {
    const c = readForm();
    try {
      const r = ed.id ? await api(`/cameras/${encodeURIComponent(ed.id)}`, c) : await api("/cameras", { camera: c });
      S = r; paint(); closeEditor(); say(`Saved ${r.camera.name}.`); toast?.(`Saved ${r.camera.name}`);
      return true;
    } catch (e) { say(e.message, true); return false; }
  }

  async function mount(card, o = {}) {
    root = card; opts = o; S = null; ed = null; dirty = false;
    const st = await load(); if (!st) return;
    $("#cs-add").onclick = openTypes;
    $("#cs-cams").onclick = async (e) => {
      const b = e.target.closest("button[data-act]"); if (!b) return;
      const id = b.closest(".cs-cam").dataset.id, cam = S.cameras.find((x) => x.id === id);
      if (b.dataset.act === "edit") openEditor(cam);
      if (b.dataset.act === "test") { say("Testing…"); const r = await api("/cameras/test", { id }).catch((x) => ({ ok: false, error: x.message })); say(r.ok ? `✓ ${cam.name} answered in ${(r.ms / 1000).toFixed(1)} s.` : `⚠ ${cam.name}: ${r.error}`, !r.ok); }
      if (b.dataset.act === "del") { if (!confirm(`Remove ${cam.name}? Its saved pictures and clips stay in the storage folder until they're cleaned up.`)) return; S = await api(`/cameras/${encodeURIComponent(id)}`, undefined, "DELETE"); paint(); say(`Removed ${cam.name}.`); }
    };
    $("#cs-savest").onclick = async () => {
      try { S = await api("/cameras/settings", { storageDir: $("#cs-dir").value.trim(), diskCapGB: Number($("#cs-cap").value) || 20 }); paint(); say("Storage saved."); }
      catch (e) { say(e.message, true); }
    };
    const q = new URLSearchParams(location.search);
    if (q.get("add")) openTypes();
    const t = setInterval(() => { if (!root?.isConnected) return clearInterval(t); if (!ed) load(); }, 15_000);
    o.onLeave?.(() => clearInterval(t));
  }
  // Settings saves a section when you leave it: an open, changed camera form is saved then
  async function save() { if (ed && dirty) { const ok = await saveCamera(); if (!ok) throw new Error($("#cs-msg")?.textContent || "Fix the camera's details first."); } }

  window.DayspringCameraSettings = { html, mount, save, _state: () => ({ S, ed, dirty }) };
})();
