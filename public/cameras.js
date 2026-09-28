// The Cameras page (/cameras.html; on the Dayspring screen it opens over everything, inside the screen margins):
//   Live       every camera: a low-rate live view (at most 4 at once; the rest refresh their latest picture), ● REC
//   a camera   the big view, "Check now", its latest events, and the recordings the camera keeps itself (SD card, GoPro)
//   Events     the feed, with thumbnails, filtered by camera and what was seen
//   Recordings a day's timeline for one camera: event markers, clips and continuous video, played right here
// ?cam=<id> opens a camera, ?event=<id> plays that event's clip (or shows its picture), ?tab=events|recordings.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (p, body, method) => { const r = await fetch("/api" + p, body === undefined && !method ? {} : { method: method ?? "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || "That didn't work."), { off: j.off }); return j; };
  const params = new URLSearchParams(location.search);
  const embed = params.get("embed") === "1";
  const MAX_LIVE = 4;
  let S = null, tab = params.get("tab") || "live", cur = params.get("cam") || null, filters = { cam: "", label: "" }, recSel = { cam: null, day: null };
  const main = $("#main");
  const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dayWords = (iso) => { const d = new Date(iso), t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1); return d.toDateString() === t.toDateString() ? "Today" : d.toDateString() === y.toDateString() ? "Yesterday" : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }); };
  const chips = (labels) => (labels ?? []).map((l) => `<span class="chip ${esc(l.label)}" title="${Math.round((l.confidence ?? 1) * 100)}%">${esc(l.raw && l.raw !== l.label ? l.raw : l.label)}</span>`).join("");
  const camName = (id) => S?.cameras.find((c) => c.id === id)?.name ?? id;

  if (embed) { $("#close").hidden = false; $("#setLink").href = "/setup?embed=1&s=cameras"; }
  $("#close").onclick = () => { try { parent.postMessage({ type: "dayspring-page-close" }, location.origin); } catch { /* not in a frame */ } };
  addEventListener("keydown", (e) => { if (e.key !== "Escape") return; if (!$("#viewer").hidden) { closeViewer(); e.stopPropagation(); } else if (cur && tab === "live") { cur = null; render(); } else if (embed) $("#close").click(); });
  for (const b of document.querySelectorAll(".tabs button")) b.onclick = () => { tab = b.dataset.tab; if (tab !== "live") cur = null; render(); };

  async function load() {
    try { S = await api("/cameras"); }
    catch (e) { main.innerHTML = `<div class="empty">${esc(e.off ? "Cameras aren't part of this version of Dayspring yet." : e.message)}</div>`; return false; }
    $("#recNow").hidden = !(S.status?.recording ?? []).length;
    $("#recNow").title = (S.status?.recording ?? []).length ? `Recording: ${S.status.recording.map(camName).join(", ")}` : "";
    return true;
  }
  // closing a live view ends its stream (the server stops reading the camera when nobody watches)
  function stopViews() { for (const img of main.querySelectorAll("img[data-live]")) { img.onerror = null; img.removeAttribute("src"); } }
  async function render() {
    stopViews();
    for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    if (!S && !(await load())) return;
    if (!S.cameras.length) { main.innerHTML = `<div class="empty">No cameras yet.<br><br><a class="btn" href="${embed ? "/setup?embed=1&s=cameras&add=1" : "/setup?s=cameras&add=1"}">＋ Add a camera</a></div>`; return; }
    if (tab === "live") return cur ? renderCam(cur) : renderGrid();
    if (tab === "events") return renderEvents();
    if (tab === "recordings") return renderRecordings();
  }

  // ---- Live ----
  function renderGrid() {
    let lives = 0;
    main.innerHTML = `<div class="grid">${S.cameras.map((c) => {
      const live = c.caps?.live && c.enabled !== false && lives < MAX_LIVE; if (live) lives++;
      return `<div class="cam" tabindex="0" role="button" data-id="${esc(c.id)}" aria-label="${esc(c.name)}">
        <div class="view">${live ? `<img data-live="1" alt="" data-src="/api/cameras/${esc(c.id)}/live?fps=1">` : `<img alt="" data-still="1" data-src="/api/cameras/${esc(c.id)}/snapshot?cached=1">`}
          <span class="badge">${live ? "LIVE" : "latest"}</span>${c.status?.recording ? `<span class="badge r rec">REC</span>` : ""}</div>
        <div class="meta"><b>${esc(c.name)}</b><span>${esc(c.room || "")}${c.status?.error ? " ⚠" : ""}</span></div></div>`;
    }).join("")}</div>`;
    for (const img of main.querySelectorAll("img[data-src]")) { img.onerror = () => { img.replaceWith(Object.assign(document.createElement("div"), { className: "none", textContent: "No picture yet" })); }; img.src = img.dataset.src; }
    for (const el of main.querySelectorAll(".cam")) { const go = () => { cur = el.dataset.id; render(); }; el.onclick = go; el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }; }
  }
  async function renderCam(id) {
    const c = S.cameras.find((x) => x.id === id);
    if (!c) { cur = null; return renderGrid(); }
    main.innerHTML = `<div class="filters"><button class="btn" id="back">← All cameras</button><b style="font-size:1.1em">${esc(c.name)}</b>${c.status?.recording ? `<span class="rec">REC</span>` : ""}<span class="sp"></span>
        <button class="btn" id="check">📸 Check now</button><button class="btn" id="recs">🎞 Recordings</button></div>
      <div class="detail"><div><div class="view" style="border-radius:.9em">${c.caps?.live ? `<img data-live="1" alt="${esc(c.name)} live" src="/api/cameras/${esc(c.id)}/live?fps=2">` : `<img alt="${esc(c.name)}" src="/api/cameras/${esc(c.id)}/snapshot?cached=1">`}</div>
        <div class="msg" id="cmsg">${c.status?.error ? "⚠ " + esc(c.status.error) : c.status?.lastAt ? `Last checked ${time(c.status.lastAt)}.` : ""}</div></div>
        <div><div class="panel"><h2>Latest events</h2><div class="list" id="evs"><span class="msg">Loading…</span></div></div>
        ${c.caps?.recordings ? `<div class="panel" style="margin-top:.8em"><h2>On the camera</h2><div class="list" id="dev"><span class="msg">Asking the camera…</span></div></div>` : ""}</div></div>`;
    $("#back").onclick = () => { cur = null; render(); };
    $("#recs").onclick = () => { recSel.cam = id; tab = "recordings"; cur = null; render(); };
    $("#check").onclick = async () => { $("#cmsg").textContent = "Looking…"; try { const r = await api(`/cameras/${encodeURIComponent(id)}/check`, {}); $("#cmsg").textContent = r.verdict ? (r.verdict.event ? `Saw: ${(r.verdict.labels ?? []).map((l) => l.label).join(", ") || "something"}.` : "Nothing new.") : r.saved?.length ? "Saved." : "Checked. Nothing new."; loadEvents(id); } catch (e) { $("#cmsg").textContent = "⚠ " + e.message; } };
    loadEvents(id);
    if (c.caps?.recordings) {
      const r = await api(`/cameras/${encodeURIComponent(id)}/device-recordings`).catch((e) => ({ recordings: [], error: e.message }));
      const box = $("#dev"); if (!box) return;
      box.innerHTML = r.recordings.length ? r.recordings.slice(0, 80).map((x, i) => `<button data-i="${i}">${x.type?.startsWith("image") ? "🖼" : "🎞"} <span>${esc(x.name)}<br><span class="msg">${x.at ? esc(dayWords(x.at) + " " + time(x.at)) : ""}${x.size ? ` · ${(x.size / 1e6).toFixed(1)} MB` : ""}</span></span></button>`).join("") : `<span class="msg">${esc(r.error ?? "Nothing on the camera.")}</span>`;
      for (const b of box.querySelectorAll("button")) b.onclick = () => { const x = r.recordings[Number(b.dataset.i)]; openViewer({ title: `${c.name}: ${x.name}`, video: x.type?.startsWith("video") ? `/api/cameras/${encodeURIComponent(id)}/device-play?ref=${encodeURIComponent(x.ref)}` : null, image: x.type?.startsWith("image") ? `/api/cameras/${encodeURIComponent(id)}/device-play?ref=${encodeURIComponent(x.ref)}` : null }); };
    }
  }
  async function loadEvents(id) {
    const r = await api(`/cameras/events?cam=${encodeURIComponent(id)}&limit=30`).catch(() => ({ events: [] }));
    const box = $("#evs"); if (!box) return;
    box.innerHTML = r.events.length ? r.events.map((e, i) => `<button data-i="${i}"><img loading="lazy" alt="" src="${esc(e.thumb)}"><span>${esc(dayWords(e.at))} ${esc(time(e.at))}${e.clip ? " 🎞" : ""}<br>${chips(e.labels)}</span></button>`).join("") : `<span class="msg">Nothing yet.</span>`;
    for (const b of box.querySelectorAll("button")) b.onclick = () => showEvent(r.events[Number(b.dataset.i)]);
  }

  // ---- Events ----
  async function renderEvents() {
    const q = new URLSearchParams({ limit: "120" }); if (filters.cam) q.set("cam", filters.cam); if (filters.label) q.set("label", filters.label);
    main.innerHTML = `<div class="filters"><label>Camera <select id="fcam"><option value="">All</option>${S.cameras.map((c) => `<option value="${esc(c.id)}"${filters.cam === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
      <label>Seen <select id="flab">${[["", "Anything"], ["person", "People"], ["deer", "Deer"], ["animal", "Animals"], ["vehicle", "Vehicles"], ["package", "Packages"], ["motion", "Motion"]].map(([v, t]) => `<option value="${v}"${filters.label === v ? " selected" : ""}>${t}</option>`).join("")}</select></label></div><div class="feed" id="feed"><span class="msg">Loading…</span></div>`;
    $("#fcam").onchange = () => { filters.cam = $("#fcam").value; renderEvents(); };
    $("#flab").onchange = () => { filters.label = $("#flab").value; renderEvents(); };
    const r = await api(`/cameras/events?${q}`).catch((e) => ({ events: [], error: e.message }));
    const feed = $("#feed"); if (!feed) return;
    feed.innerHTML = r.events.length ? r.events.map((e, i) => `<button class="ev" data-i="${i}"><img loading="lazy" alt="" src="${esc(e.thumb)}"><div class="t"><b>${esc(camName(e.cam))}</b>${esc(dayWords(e.at))} ${esc(time(e.at))}${e.clip ? " · 🎞 clip" : ""}${e.kind === "still" ? " · picture" : ""}<br>${chips(e.labels)}${e.summary ? `<div class="msg">${esc(e.summary)}</div>` : ""}</div></button>`).join("") : `<div class="empty">${esc(r.error ?? "Nothing seen yet.")}</div>`;
    for (const b of feed.querySelectorAll(".ev")) b.onclick = () => showEvent(r.events[Number(b.dataset.i)]);
  }

  // ---- Recordings: one camera, one day ----
  async function renderRecordings() {
    recSel.cam ??= S.cameras[0]?.id;
    const r = await api(`/cameras/recordings?cam=${encodeURIComponent(recSel.cam)}${recSel.day ? `&day=${recSel.day}` : ""}`).catch((e) => ({ error: e.message, clips: [], continuous: [], events: [], days: [] }));
    recSel.day = r.day ?? recSel.day;
    const days = [...new Set([r.day, ...(r.days ?? [])].filter(Boolean))];
    const pos = (iso) => { const d = new Date(iso); return ((d.getHours() * 60 + d.getMinutes()) / 1440) * 100; };
    const segMin = S.cameras.find((c) => c.id === recSel.cam)?.record?.segmentMin ?? 5;
    const clipIds = new Set(r.clips.map((c) => c.id));
    main.innerHTML = `<div class="filters"><label>Camera <select id="rcam">${S.cameras.map((c) => `<option value="${esc(c.id)}"${recSel.cam === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
        <label>Day <select id="rday">${days.map((d) => `<option${d === recSel.day ? " selected" : ""}>${d}</option>`).join("")}</select></label>
        <span class="msg">${r.events.length} events · ${r.clips.length} clips${r.continuous.length ? ` · ${r.continuous.length} pieces of continuous video` : ""}</span></div>
      <div class="timeline" id="tl" aria-label="The day, midnight to midnight">
        ${r.continuous.map((s, i) => `<div class="seg" data-c="${i}" title="${esc(time(s.at))}" style="left:${pos(s.at)}%;width:${Math.max(0.4, (segMin / 1440) * 100)}%"></div>`).join("")}
        ${r.events.map((e, i) => `<button class="mk ${clipIds.has(e.id) ? "clip" : ""} ${esc(e.labels?.[0]?.label ?? "")}" data-e="${i}" title="${esc(time(e.at))} ${esc((e.labels ?? []).map((l) => l.label).join(", "))}" style="left:${pos(e.at)}%"></button>`).join("")}
        ${[0, 3, 6, 9, 12, 15, 18, 21].map((h) => `<span class="hr" style="left:${(h / 24) * 100}%">${h === 0 ? "12a" : h === 12 ? "12p" : h > 12 ? h - 12 + "p" : h + "a"}</span>`).join("")}
      </div>
      <div class="feed">${r.clips.map((c, i) => `<button class="ev" data-k="${i}"><img loading="lazy" alt="" src="${esc(c.thumb)}"><div class="t"><b>🎞 ${esc(time(c.at))}</b>${chips(c.labels)}</div></button>`).join("") || `<div class="empty">${esc(r.error ?? "No clips this day. Turn on recording in Settings → Cameras.")}</div>`}</div>`;
    $("#rcam").onchange = () => { recSel.cam = $("#rcam").value; recSel.day = null; renderRecordings(); };
    $("#rday").onchange = () => { recSel.day = $("#rday").value; renderRecordings(); };
    for (const b of main.querySelectorAll(".mk")) b.onclick = async () => { const e = r.events[Number(b.dataset.e)]; const full = await api(`/cameras/events/${encodeURIComponent(e.id)}`).catch(() => null); if (full) showEvent(full.event); };
    for (const b of main.querySelectorAll(".seg")) b.onclick = () => { const s = r.continuous[Number(b.dataset.c)]; openViewer({ title: `${camName(recSel.cam)} · ${time(s.at)}`, video: s.url }); };
    for (const b of main.querySelectorAll(".ev[data-k]")) b.onclick = () => { const c = r.clips[Number(b.dataset.k)]; openViewer({ title: `${camName(recSel.cam)} · ${time(c.at)}`, video: c.url, labels: c.labels, summary: c.summary, id: c.id }); };
  }

  // ---- the viewer ----
  function showEvent(e) { openViewer({ title: `${camName(e.cam)} · ${dayWords(e.at)} ${time(e.at)}`, image: e.clipUrl ? null : e.thumb, video: e.clipUrl ?? null, poster: e.thumb, labels: e.labels, summary: e.summary, id: e.id }); }
  function openViewer({ title, image = null, video = null, poster = null, labels = [], summary = "", id = null }) {
    const v = $("#viewer"), box = $("#vbox");
    box.innerHTML = `<div class="row"><b style="flex:1">${esc(title)}</b>${id ? `<button class="btn danger" id="vdel">Delete</button>` : ""}<button class="btn" id="vclose" aria-label="Close">✕</button></div>
      ${video ? `<video controls autoplay playsinline ${poster ? `poster="${esc(poster)}"` : ""} src="${esc(video)}"></video>` : `<img alt="${esc(title)}" src="${esc(image)}">`}
      <div>${chips(labels)} ${summary ? `<span class="msg">${esc(summary)}</span>` : ""}</div>`;
    v.hidden = false;       // (inside the Dayspring screen this page is already within the screen margins)
    if (window.parent === window) window.dsKeepInSafe?.(box);
    $("#vclose").onclick = closeViewer;
    $("#vclose").focus();
    if ($("#vdel")) $("#vdel").onclick = async () => { if (!confirm("Delete this picture and its clip?")) return; await api(`/cameras/events/${encodeURIComponent(id)}`, undefined, "DELETE").catch(() => {}); closeViewer(); render(); };
  }
  function closeViewer() { const v = $("#viewer"); v.hidden = true; const vid = $("#vbox video"); if (vid) { vid.pause(); vid.removeAttribute("src"); vid.load(); } $("#vbox").innerHTML = ""; }
  $("#viewer").onclick = (e) => { if (e.target.id === "viewer") closeViewer(); };

  // ---- keep up to date: the Dayspring screen's events when inside it, else a gentle poll ----
  let es = null; try { es = window.parent !== window ? window.parent.dsEvents : null; } catch { es = null; }
  const onCam = (e) => { try { const d = JSON.parse(e.data); if (d.recording) { $("#recNow").hidden = !d.recording.length; if (S) S.status.recording = d.recording; } if (d.event && (tab === "events" || (tab === "live" && cur === d.event.cam))) { if (tab === "events") renderEvents(); else loadEvents(cur); } } catch { /* bad event */ } };
  if (es) { es.addEventListener("cameras", onCam); addEventListener("pagehide", () => es.removeEventListener("cameras", onCam)); }
  setInterval(async () => { if (document.hidden) return; const was = JSON.stringify(S?.cameras.map((c) => [c.id, c.status?.recording, c.status?.error])); if (await load()) { const now = JSON.stringify(S.cameras.map((c) => [c.id, c.status?.recording, c.status?.error])); if (now !== was && tab === "live" && !cur) renderGrid(); else if (tab === "live" && !cur) for (const img of main.querySelectorAll("img[data-still]")) img.src = img.dataset.src + "&t=" + Date.now(); } }, 20_000);
  addEventListener("pagehide", stopViews);

  (async () => {
    if (!(await load())) return;
    await render();
    const ev = params.get("event");
    if (ev) { const r = await api(`/cameras/events/${encodeURIComponent(ev)}`).catch(() => null); if (r?.event) showEvent(r.event); }
  })();
  window.dsCameras = { state: () => ({ tab, cur, S, viewer: !$("#viewer").hidden }), show: (id) => { cur = id; tab = "live"; render(); } };
})();
