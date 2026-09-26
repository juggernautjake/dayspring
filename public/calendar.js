// Dayspring Schedule: day, week, month and year views, with full editing.
//   ‹ › move through time (← → keys), Today jumps back, D/W/M/Y switch views, N adds, Esc closes.
//   Click an item to edit or delete it; click an empty time (day/week) or a day (month/year) to add or zoom in.
//   Importance: 0 normal · 1 notable · 2 important (stands out in the week) · 3 major (month and year too).
//   Routine days are editable too: the change applies to that day only.
// Opened on the TV as an overlay (?embed=1) or on the laptop as a normal page. It refreshes itself when Dayspring
// (by voice) changes the schedule.
// Every calendar together: Google, Outlook, subscriptions and To Do / Todoist due items show with their own color and a
// badge (the strip under the top bar shows or hides each one; ☰ Calendars has sync status, Refresh and sync settings).
// Clicking an outside item opens its card with a link to open it in its own app. ⚠ marks clashes; the ⚠ button lists them
// with one-tap fixes (outside-calendar changes ask first).
(() => {
  const $ = (s) => document.querySelector(s);
  const api = (path, opts) => fetch("/api" + path, opts).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Dayspring couldn't do that just now. Try again in a moment, or restart Dayspring if it keeps happening."); return j; });
  const send = (method, path, body) => api(path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dateOf = (iso) => new Date(iso + "T12:00:00");
  const addDays = (iso, n) => { const d = dateOf(iso); d.setDate(d.getDate() + n); return isoOf(d); };
  const todayISO = () => isoOf(new Date());
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const hm12 = (t) => { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}${m ? ":" + pad(m) : ""}${h >= 12 ? "pm" : "am"}`; };
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const catVar = (c) => `var(--${["faith", "body", "work", "study", "meal", "home", "rest", "flex"].includes(c) ? c : "flex"})`;
  const params = new URLSearchParams(location.search);
  const embed = params.get("embed") === "1";
  let view = ["day", "week", "month", "year"].includes(params.get("view")) ? params.get("view") : "week";
  let cursor = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? params.get("date") : todayISO();
  let categories = ["faith", "home", "body", "work", "study", "rest", "meal", "flex"];
  let lastData = null, uni = null, uniItems = new Map();

  if (embed) { $("#close").hidden = false; $("#laptop").hidden = false; }
  $("#close").onclick = () => parent.postMessage({ type: "dayspring-calendar-close" }, "*");
  $("#laptop").onclick = () => send("POST", "/open", { url: `http://localhost:4747/calendar.html?view=${view}&date=${cursor}` }).then(() => toast("Opened on the laptop")).catch(() => {});
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2600); }

  // ---------- ranges ----------
  function range() {
    if (view === "day") return [cursor, cursor];
    if (view === "week") { const s = addDays(cursor, -dateOf(cursor).getDay()); return [s, addDays(s, 6)]; }
    if (view === "month") { const d = dateOf(cursor), first = isoOf(new Date(d.getFullYear(), d.getMonth(), 1)), last = isoOf(new Date(d.getFullYear(), d.getMonth() + 1, 0)); return [addDays(first, -dateOf(first).getDay()), addDays(last, 6 - dateOf(last).getDay())]; }
    const y = dateOf(cursor).getFullYear(); return [`${y}-01-01`, `${y}-12-31`];
  }
  function titleText() {
    const d = dateOf(cursor);
    if (view === "day") return `${d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}<small>${d.getFullYear()}</small>`;
    if (view === "week") { const [a, b] = range(); const A = dateOf(a), B = dateOf(b); return `${A.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${B.toLocaleDateString("en-US", { month: A.getMonth() === B.getMonth() ? undefined : "short", day: "numeric" })}<small>${B.getFullYear()}</small>`; }
    if (view === "month") return `${MON[d.getMonth()]}<small>${d.getFullYear()}</small>`;
    return String(d.getFullYear());
  }
  function step(dir) {
    const d = dateOf(cursor);
    if (view === "day") cursor = addDays(cursor, dir);
    else if (view === "week") cursor = addDays(cursor, 7 * dir);
    else if (view === "month") cursor = isoOf(new Date(d.getFullYear(), d.getMonth() + dir, Math.min(d.getDate(), 28)));
    else cursor = isoOf(new Date(d.getFullYear() + dir, d.getMonth(), 1));
    render();
  }
  function setView(v, date) { view = v; if (date) cursor = date; history.replaceState(null, "", `?${embed ? "embed=1&" : ""}view=${view}&date=${cursor}`); render(); }

  // ---------- render ----------
  async function render() {
    document.querySelectorAll("#views button").forEach((b) => b.classList.toggle("on", b.dataset.v === view));
    $("#title").innerHTML = titleText();
    const [from, to] = range();
    let data;
    const uP = view === "year" ? Promise.resolve(null) : api(`/calendar/unified?from=${from}&to=${to}`).catch(() => null);
    try { data = await api(`/calendar?from=${from}&to=${to}${view === "year" ? "&summary=1" : ""}`); } catch (e) { $("#view").innerHTML = `<div class="empty">Couldn't load the schedule: ${esc(e.message)}</div>`; return; }
    if (data.categories) categories = data.categories;
    const u = await uP;
    if (u) { uni = u; merge(data, u); }
    renderSrcbar(); refreshConfCount();
    lastData = data;
    const el = $("#view");
    el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
    if (view === "day" || view === "week") renderGrid(data.days);
    else if (view === "month") renderMonth(data.days);
    else renderYear(data.days);
  }

  // ---------- every calendar together ----------
  // the outside items (from /api/calendar/unified) replace the plain ones /api/calendar adds, with their color, badge,
  // all-day row, duplicates merged, and ⚠ on anything that clashes
  function merge(data, u) {
    uniItems = new Map(u.items.map((x) => [x.id, x]));
    for (const d of data.days) { d.blocks = u.hiddenDayspring ? [] : d.blocks.filter((b) => !b.external); d.allDay = []; }
    const byDate = new Map(data.days.map((d) => [d.date, d]));
    for (const x of u.items) {
      const d = byDate.get(x.date);
      if (!d || x.hidden || u.dupOf[x.id]) continue;
      const b = { id: x.id, start: x.start, end: x.end, title: x.title, description: x.where ?? "", category: "flex", importance: 0, external: x.source, projected: true, color: x.color, sourceLabel: x.sourceLabel, kind: x.kind, allDay: x.allDay, busy: x.busy };
      (x.allDay ? d.allDay : d.blocks).push(b);
    }
    for (const d of data.days) for (const b of [...d.blocks, ...d.allDay]) { b.clash = u.clash[b.id] ?? null; b.alsoOn = u.alsoOn[b.id] ?? null; }
  }
  const shortLabel = (l) => { const s = String(l ?? ""); return s === "Google" ? "G" : s.startsWith("Google · ") ? s.slice(9) : s === "Microsoft To Do" ? "To Do" : s.split(/\s+/).slice(0, 2).join(" "); };
  const badge = (b, full) => (b.external && b.sourceLabel ? `<em class="src" style="--c:${esc(b.color || "#888")}" title="${esc(b.sourceLabel)}">${esc(full ? b.sourceLabel : shortLabel(b.sourceLabel))}</em>` : "");
  const marks = (b) => (b.clash ? '<i class="wm" title="Clashes with something">⚠</i>' : "");
  const also = (b) => (b.alsoOn?.length ? `<i class="also" title="Also on ${esc(b.alsoOn.join(", "))}">⧉</i>` : "");
  const colorOf = (b) => (b.external && b.color ? esc(b.color) : catVar(b.category));
  const ago = (t) => { if (!t) return "not yet"; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
  function renderSrcbar() {
    const bar = $("#srcbar"), src = uni?.sources ?? [];
    if (src.length < 2) { bar.hidden = true; return; }
    bar.hidden = false;
    const newest = Math.max(0, ...src.filter((s) => s.source !== "dayspring").map((s) => s.at ?? 0));
    bar.innerHTML = src.map((s) => `<button class="lg${s.hidden ? " off" : ""}${s.ok === false ? " err" : ""}" data-src="${esc(s.key)}" style="--c:${esc(s.color || "var(--violet)")}" title="${s.hidden ? "Hidden. Click to show" : "Shown. Click to hide"}${s.error ? " · " + esc(s.error) : ""}"><i></i><span>${esc(s.label)}</span>${s.ok === false ? " ⚠" : ""}</button>`).join("")
      + `<span class="upd">Updated ${ago(newest)}</span><button class="ref" id="srcRefresh" title="Fetch every calendar again">⟳ Refresh</button>`;
  }
  // show or hide a source (remembered by Dayspring, so the TV and the laptop agree)
  $("#srcbar").addEventListener("click", async (e) => {
    const lg = e.target.closest("[data-src]");
    if (lg) {
      const hide = !lg.classList.contains("off");
      lg.classList.toggle("off", hide);
      try { await send("POST", "/calendar/sources", { key: lg.dataset.src, hidden: hide }); } catch (err) { toast(err.message); }
      return render();
    }
    if (e.target.closest("#srcRefresh")) return refreshAll();
  });
  async function refreshAll() {
    toast("Refreshing your calendars…");
    try { await send("POST", "/calendar/refresh"); toast("Calendars refreshed"); } catch (err) { toast(err.message); }
    render(); if ($("#srcPanel").classList.contains("open")) openSources();
  }
  async function refreshConfCount() {
    let n;
    try { n = (await api(`/conflicts?from=${todayISO()}&to=${addDays(todayISO(), 6)}`)).conflicts.filter((c) => !c.past).length; } catch { return; }
    $("#confBtn").hidden = !n; $("#confN").textContent = n;
    $("#confBtn").title = `${n} scheduling conflict${n === 1 ? "" : "s"} this week`;
  }
  // one drawer at a time: the editor, an item's card, conflicts, calendars
  const PANELS = ["#drawer", "#card", "#confPanel", "#srcPanel"];
  function openPanel(id) { PANELS.forEach((p) => $(p).classList.toggle("open", p === id)); }
  function closePanels() { PANELS.forEach((p) => $(p).classList.remove("open")); editing = null; }
  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closePanels));
  const openLink = (url) => { if (embed) send("POST", "/open", { url }).then(() => toast("Opened on the computer")).catch((e) => toast(e.message)); else window.open(url, "_blank", "noopener"); };
  const whenText = (x) => `${dateOf(x.date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · ${x.allDay ? "All day" : `${hm12(x.start)} – ${hm12(x.end)}`}`;
  const cap = (t) => t[0].toUpperCase() + t.slice(1);
  const clashLine = (ids) => {
    const cs = (uni?.conflicts ?? []).filter((c) => ids?.includes(c.id));
    return cs.length ? `<div class="note">⚠ ${cs.map((c) => esc(cap(c.text))).join(".<br>⚠ ")}.<br><button class="tool" data-fixes style="margin-top:.4em">See ways to fix it</button></div>` : "";
  };
  // an outside calendar's item: what, when, where, which calendar, and a link to open it where it lives
  function openCard(b) {
    const x = uniItems.get(b.id) ?? b;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    $("#cTitle").textContent = x.kind === "task" ? "Task" : "Event";
    $("#cBody").innerHTML = `<h3 style="margin:0;font-weight:500;font-size:1.25em">${esc(x.title)}</h3>
      <div class="kv"><span>When</span><b>${esc(whenText(x))}</b>
        ${x.where ? `<span>Where</span><b>${esc(x.where)}</b>` : ""}
        <span>Calendar</span><b><em class="src" style="--c:${esc(x.color || "#888")}">${esc(x.sourceLabel ?? "")}</em>${x.calendar && x.calendar !== x.sourceLabel ? esc(x.calendar) : ""}</b>
        ${b.alsoOn?.length ? `<span>Also on</span><b>${esc(b.alsoOn.join(", "))}</b>` : ""}
        ${x.invited ? `<span>You're</span><b>invited (someone else organizes it)</b>` : ""}</div>
      ${x.tz && x.tz !== tz ? `<p class="muted">Set in ${esc(x.tz.replace(/_/g, " "))} time; shown here in yours.</p>` : ""}
      ${x.notes ? `<div class="card-notes">${esc(x.notes)}</div>` : ""}
      ${clashLine(b.clash)}
      ${x.allDay && x.kind === "event" ? `<label class="check"><input type="checkbox" class="switch" id="cBusy"${x.busy ? " checked" : ""}> Counts as busy (flag anything else that day)</label>` : ""}
      ${x.link ? `<a class="linkbtn" id="cOpen" href="${esc(x.link)}" target="_blank" rel="noopener">Open in ${esc(x.openIn ?? "its app")}</a>` : ""}
      <p class="muted">${x.readOnly ? `This comes from ${esc(x.sourceLabel ?? "another calendar")}; change it there.` : `Change it in ${esc(x.openIn ?? "its app")}, or ask Dayspring to move it.`}</p>`;
    const op = $("#cOpen"); if (op) op.onclick = (e) => { e.preventDefault(); openLink(x.link); };
    const bz = $("#cBusy"); if (bz) bz.onchange = async () => { try { await send("POST", "/calendar/busy", { id: x.id, busy: bz.checked }); toast(bz.checked ? "Counted as busy" : "Not counted as busy"); render(); } catch (e) { toast(e.message); } };
    openPanel("#card");
  }
  $("#card").addEventListener("click", (e) => { if (e.target.closest("[data-fixes]")) openConflicts("week"); });
  $("#drawer").addEventListener("click", (e) => { if (e.target.closest("[data-fixes]")) { e.preventDefault(); openConflicts("week"); } });

  // ---------- conflicts: the list and one-tap fixes ----------
  let confRange = "week";
  async function openConflicts(r = confRange) {
    confRange = r;
    document.querySelectorAll("#confTabs button").forEach((b) => b.classList.toggle("on", b.dataset.r === r));
    openPanel("#confPanel");
    const list = $("#confList");
    list.innerHTML = '<p class="muted">Checking every calendar…</p>';
    let data;
    try { data = await api(`/conflicts?from=${todayISO()}&to=${r === "today" ? todayISO() : addDays(todayISO(), 6)}`); } catch (e) { list.innerHTML = `<p class="warn">${esc(e.message)}</p>`; return; }
    const cs = data.conflicts.filter((c) => !c.past);
    if (!cs.length) { list.innerHTML = `<p class="muted">No conflicts ${r === "today" ? "today" : "this week"}. Everything lines up.</p>`; return; }
    list.innerHTML = cs.map((c) => `<div class="cf ${c.severity}" data-cid="${esc(c.id)}">
      <p>${c.severity === "hard" ? "⚠ " : ""}${esc(cap(c.text))}.</p>
      <div class="pair">${c.items.map((x) => { const u = uniItems.get(x.id); return `<span style="--c:${esc(u?.color || "var(--violet)")}">${esc(x.title)} · ${x.allDay ? "all day" : hm12(x.start) + "–" + hm12(x.end)} · ${esc(x.sourceLabel)}</span>`; }).join("")}</div>
      <div class="opts">${c.options.map((o, i) => `<button class="${i === 0 ? "first" : ""}${o.needsConfirm ? " ext" : ""}" data-opt="${esc(o.id)}">${esc(o.label)}</button>`).join("")}</div>
      <div class="ask" hidden></div></div>`).join("");
  }
  // one tap applies a Dayspring fix; a change to Google/Outlook asks here first
  async function resolveConf(card, choice, confirmed = false) {
    card.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      const r = await send("POST", "/conflicts/resolve", { id: card.dataset.cid, choice, confirmed });
      if (r.needsConfirm) {
        const ask = card.querySelector(".ask");
        ask.hidden = false; ask.innerHTML = `<span>${esc(r.question)}</span><div><button class="yes" data-yes="${esc(r.choice)}">Yes, do it</button><button data-no>Cancel</button></div>`;
        return;
      }
      toast(r.said || "Done."); render(); openConflicts(confRange);
    } catch (e) { toast(e.message); card.querySelectorAll("button").forEach((b) => (b.disabled = false)); }
  }
  $("#confList").addEventListener("click", (e) => {
    const card = e.target.closest("[data-cid]"); if (!card) return;
    const y = e.target.closest("[data-yes]"); if (y) return resolveConf(card, y.dataset.yes, true);
    if (e.target.closest("[data-no]")) { card.querySelector(".ask").hidden = true; card.querySelectorAll("button").forEach((b) => (b.disabled = false)); return; }
    const o = e.target.closest("[data-opt]"); if (o) resolveConf(card, o.dataset.opt);
  });
  document.querySelectorAll("#confTabs button").forEach((b) => (b.onclick = () => openConflicts(b.dataset.r)));
  $("#confBtn").onclick = () => openConflicts("week");

  // ---------- your calendars: shown or hidden, how each is doing, travel time, sync ----------
  async function openSources() {
    openPanel("#srcPanel");
    const el = $("#srcList");
    let s;
    try { s = await api("/calendar/sources"); } catch (e) { el.innerHTML = `<p class="warn">${esc(e.message)}</p>`; return; }
    const sync = s.sync ?? {};
    const syncRows = ["google", "microsoft"].map((a) => { const x = sync[a] ?? {}; return x.connected ? `<div class="srow" style="--c:${a === "google" ? "#4285f4" : "#0078d4"}"><i></i><b>${a === "google" ? "Google Calendar" : "Outlook"}</b><input type="checkbox" class="switch" data-sync="${a}"${x.on ? " checked" : ""}>
        <small class="${x.error ? "bad" : ""}">${x.on ? `On · ${x.count} item${x.count === 1 ? "" : "s"} copied${x.at ? ` · ${ago(x.at)}` : ""}` : "Off"}${x.error ? ` · ${esc(x.error)}` : ""}</small></div>` : ""; }).join("");
    el.innerHTML = `<div class="sec">Calendars</div>
      ${s.sources.map((x) => `<div class="srow" style="--c:${esc(x.color || "var(--violet)")}"><i></i><b>${esc(x.label)}</b><input type="checkbox" class="switch" data-show="${esc(x.key)}"${x.hidden ? "" : " checked"} title="Show on the schedule">
        <small class="${x.ok === false ? "bad" : ""}">${x.ok === false ? `⚠ ${esc(x.error ?? "Couldn't reach it")}` : x.source === "dayspring" ? "Your own schedule" : `Updated ${ago(x.at)}`}${x.note && x.source !== "dayspring" ? ` · ${esc(x.note)}` : ""}</small></div>`).join("")}
      <button class="tool" id="srcRefresh2">⟳ Refresh all now</button>
      ${s.sources.length < 2 ? `<p class="muted">Connect Google Calendar, Outlook, a calendar link (iCloud, school, team…), To Do or Todoist in Settings → Apps, and they show up here next to your Dayspring schedule.</p>` : ""}
      <div class="sec">Conflicts</div>
      <label class="check"><input type="checkbox" class="switch" id="tvOn"${s.travel?.on ? " checked" : ""}> Leave travel time between places</label>
      <label class="every">At least <select id="tvMin">${[5, 10, 15, 20, 30, 45, 60].map((m) => `<option${m === s.travel?.minutes ? " selected" : ""}>${m}</option>`).join("")}</select> minutes between two things in different places</label>
      <p class="muted">Hidden calendars aren't checked for clashes. All-day items only count when they're marked busy.</p>
      <div class="sec">Put your Dayspring schedule on another calendar</div>
      ${syncRows || '<p class="muted">Connect Google Calendar or Outlook in Settings → Apps to use this.</p>'}
      <p class="muted">One way: the next two weeks of your Dayspring schedule are copied there (so they're on your phone), kept up to date, and never doubled. Turning it off removes the copies.</p>`;
  }
  $("#srcBtn").onclick = openSources;
  $("#srcList").addEventListener("change", async (e) => {
    const t = e.target;
    try {
      if (t.dataset.show) { await send("POST", "/calendar/sources", { key: t.dataset.show, hidden: !t.checked }); render(); }
      else if (t.id === "tvOn" || t.id === "tvMin") { await send("POST", "/calendar/travel", { on: $("#tvOn").checked, minutes: Number($("#tvMin").value) }); render(); }
      else if (t.dataset.sync) {
        toast(t.checked ? "Copying your schedule…" : "Removing the copies…");
        const r = await send("POST", "/calendar/sync", { account: t.dataset.sync, on: t.checked });
        const x = r.result ?? {}; toast(t.checked ? `Synced: ${x[t.dataset.sync]?.added ?? 0} added` : `Sync off: ${x.removed ?? 0} removed`);
      }
    } catch (err) { toast(err.message); }
    openSources();
  });
  $("#srcList").addEventListener("click", (e) => { if (e.target.closest("#srcRefresh2")) refreshAll(); });

  // day and week: a time grid, blocks placed by time, overlaps side by side
  function renderGrid(days) {
    const all = days.flatMap((d) => d.blocks);
    let startH = 6, endH = 22;
    for (const b of all) { startH = Math.min(startH, Math.floor(toMin(b.start) / 60)); endH = Math.max(endH, Math.ceil(toMin(b.end) / 60)); }
    const hours = endH - startH, t = todayISO();
    const cols = days.map((d) => d.date);
    const heads = `<div class="heads" style="grid-template-columns:repeat(${cols.length},minmax(0,1fr))">${days.map((d) => {
      const dd = dateOf(d.date), sp = d.special.map((s) => s.title.replace(/\. He is risen!$/, "").replace(/^the /, "")).join(" · ");
      return `<div class="head${d.date === t ? " today" : ""}" data-goday="${d.date}"><b>${DOW[dd.getDay()]} ${dd.getDate()}</b>${view === "day" ? `<span>${dd.toLocaleDateString("en-US", { month: "long" })}</span>` : ""}${sp ? `<span class="sp">★ ${esc(sp)}</span>` : ""}</div>`;
    }).join("")}</div>`;
    const hasAll = days.some((d) => d.allDay?.length);
    const allRow = hasAll ? `<div class="alld" style="grid-template-columns:repeat(${cols.length},minmax(0,1fr))">${days.map((d) => `<div class="adc">${(d.allDay ?? []).map((b) =>
      `<div class="adi${b.kind === "task" ? " task" : ""}${b.busy ? "" : " free"}${b.clash ? " clash" : ""}" data-id="${esc(b.id)}" style="--c:${colorOf(b)}" title="${esc(b.title)} · ${esc(b.sourceLabel ?? "")}">${marks(b)}${esc(b.title)}</div>`).join("")}</div>`).join("")}</div>` : "";
    const body = `<div class="body" id="gbody"><div class="canvas" id="gcanvas" style="grid-template-columns:repeat(${cols.length},minmax(0,1fr))">
      <div class="hours">${Array.from({ length: hours + 1 }, (_, i) => `<div class="hour" style="top:calc(${i} * var(--hh))">${hm12(pad(startH + i) + ":00")}</div>`).join("")}</div>
      ${days.map((d) => `<div class="col${d.date === t ? " today" : ""}" data-date="${d.date}">
        ${Array.from({ length: hours }, (_, i) => `<div class="line" style="top:calc(${i} * var(--hh))"></div><div class="line half" style="top:calc(${i + 0.5} * var(--hh))"></div><div class="slot" data-slot="${d.date}|${pad(startH + i)}:00" style="top:calc(${i} * var(--hh));height:var(--hh)"></div>`).join("")}
        ${layout(d.blocks).map(({ b, lane, lanes }) => {
          const top = (toMin(b.start) - startH * 60) / 60, h = Math.max(0.33, (toMin(b.end) - toMin(b.start)) / 60);
          return `<div class="ev imp-${b.importance ?? 0}${b.done ? " done" : ""}${b.projected && !b.external ? " proj" : ""}${b.external ? " ext" : ""}${b.clash ? " clash" : ""}" data-id="${esc(b.id)}" style="--c:${colorOf(b)};top:calc(${top} * var(--hh) + 1px);height:calc(${h} * var(--hh) - 3px);left:calc(${lane} * 100% / ${lanes} + 2px);width:calc(100% / ${lanes} - 4px)">
            <b>${marks(b)}${badge(b, view === "day")}${b.repeatText ? `<i class="rep" title="${esc(b.repeatText)}">↻</i>` : ""}${(b.importance ?? 0) >= 2 ? `<span class="star">${b.importance >= 3 ? "★★" : "★"}</span>` : ""}${esc(b.title)}${also(b)}</b><small><span>${hm12(b.start)}</span><span class="to"> – ${hm12(b.end)}</span></small><i class="grip" title="Drag to change the end time"></i></div>`;
        }).join("")}
        ${d.date === t ? `<div class="now" style="top:calc(${(new Date().getHours() * 60 + new Date().getMinutes() - startH * 60) / 60} * var(--hh))"></div>` : ""}
      </div>`).join("")}
    </div></div>`;
    $("#view").innerHTML = `<div class="grid"${hasAll ? ' style="grid-template-rows:auto auto 1fr"' : ""}>${heads}${allRow}${body}</div>`;
    // an hour's height: fill the screen on the day view, a bit tighter for the week; never too small to read
    const bodyEl = $("#gbody"), avail = bodyEl.clientHeight;
    const hh = Math.max(view === "day" ? 52 : 40, Math.floor(avail / Math.min(hours, view === "day" ? 12 : 14)));
    $("#gcanvas").style.setProperty("--hh", hh + "px");
    $("#gcanvas").style.height = hours * hh + "px";
    // too short for two lines: the time goes to the right of the title; too narrow for both times: just the start
    document.querySelectorAll("#gcanvas .ev").forEach((el) => {
      if (el.scrollHeight <= el.clientHeight + 1) return;
      el.classList.add("row");
      if (el.querySelector("b").scrollWidth > el.querySelector("b").clientWidth + 1) el.classList.add("tight");
    });
    // start at the current time (or the first thing that day)
    const firstMin = cols.includes(t) ? new Date().getHours() * 60 - 90 : Math.min(...all.map((b) => toMin(b.start)), 8 * 60);
    bodyEl.scrollTop = Math.max(0, ((firstMin - startH * 60) / 60) * hh);
  }
  function layout(blocks) {
    const sorted = [...blocks].sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));
    const out = [], active = [];
    let group = [];
    const flush = () => { const lanes = Math.max(1, ...group.map((g) => g.lane + 1)); group.forEach((g) => (g.lanes = lanes)); group = []; };
    for (const b of sorted) {
      for (let i = active.length - 1; i >= 0; i--) if (toMin(active[i].b.end) <= toMin(b.start)) active.splice(i, 1);
      if (!active.length && group.length) flush();
      const used = new Set(active.map((a) => a.lane));
      let lane = 0; while (used.has(lane)) lane++;
      const item = { b, lane, lanes: 1 };
      active.push(item); group.push(item); out.push(item);
    }
    if (group.length) flush();
    return out;
  }

  // month: every day, the important things first
  function renderMonth(days) {
    const d0 = dateOf(cursor), m = d0.getMonth(), t = todayISO();
    const rows = Math.ceil(days.length / 7);
    $("#view").innerHTML = `<div class="month"><div class="mdow">${DOW.map((w) => `<div>${w}</div>`).join("")}</div>
      <div class="mgrid" style="grid-template-rows:repeat(${rows},minmax(0,1fr))">${days.map((d) => {
        const dd = dateOf(d.date), out = dd.getMonth() !== m;
        const items = [...(d.allDay ?? []), ...[...d.blocks].sort((a, b) => Boolean(b.clash) - Boolean(a.clash) || (b.importance ?? 0) - (a.importance ?? 0) || a.start.localeCompare(b.start))];
        const shown = items.filter((b) => b.external || b.clash || (b.importance ?? 0) >= 1 || !/^(breakfast|lunch|dinner|shower|morning|nightly|your time)/i.test(b.title)).slice(0, 4);
        return `<div class="mc${out ? " out" : ""}${d.date < t ? " past" : ""}${d.date === t ? " today" : ""}" data-goday="${d.date}">
          <div class="dn"><b>${dd.getDate()}</b></div>
          ${d.special.slice(0, 2).map((s) => `<div class="msp ${s.kind}">★ ${esc(s.title.replace(/\. He is risen!$/, "").replace(/^the /, ""))}</div>`).join("")}
          ${shown.map((b) => `<div class="mi imp-${b.importance ?? 0}${b.kind === "task" ? " task" : ""}${b.clash ? " clash" : ""}" data-id="${esc(b.id)}" data-date="${d.date}" style="--c:${colorOf(b)}" title="${esc(b.title)}${b.sourceLabel ? " · " + esc(b.sourceLabel) : ""}">${marks(b)}${(b.importance ?? 0) >= 2 ? `<span class="star">★</span>` : ""}${esc(b.title)}</div>`).join("")}
          ${items.length > shown.length ? `<div class="more">+${items.length - shown.length} more</div>` : ""}</div>`;
      }).join("")}</div></div>`;
    fitMonth();
  }
  // each day shows only what fits; the rest is counted in "+N more" (click the day to see everything)
  function fitMonth() {
    for (const c of document.querySelectorAll(".mc")) {
      const items = [...c.querySelectorAll(".mi")];
      let more = c.querySelector(".more"), hidden = Number(more?.textContent.match(/\d+/)?.[0] ?? 0);
      while (c.scrollHeight > c.clientHeight + 1 && items.length) {
        items.pop().remove(); hidden++;
        if (!more) { more = document.createElement("div"); more.className = "more"; c.appendChild(more); }
        more.textContent = `+${hidden} more`;
      }
    }
  }

  // year: majors and big days at a glance, and a list of them
  function renderYear(days) {
    const y = dateOf(cursor).getFullYear(), t = todayISO(), by = new Map(days.map((d) => [d.date, d]));
    const list = days.flatMap((d) => [...(d.major ?? []).map((title) => ({ date: d.date, title, major: true })), ...d.special.filter((s) => s.big || s.kind === "birthday").map((s) => ({ date: d.date, title: s.title.replace(/\. He is risen!$/, ""), major: false }))]);
    $("#view").innerHTML = `<div class="year"><div class="ymonths">${MON.map((name, mi) => {
      const first = `${y}-${pad(mi + 1)}-01`, lead = dateOf(first).getDay(), len = new Date(y, mi + 1, 0).getDate();
      let cells = "<i></i>".repeat(0);
      for (let i = 0; i < lead; i++) cells += "<span></span>";
      for (let dd = 1; dd <= len; dd++) {
        const iso = `${y}-${pad(mi + 1)}-${pad(dd)}`, d = by.get(iso) ?? { special: [], major: [], important: [] };
        const cls = [iso === t ? "today" : "", iso < t ? "past" : "", d.major?.length ? "major" : "", d.important?.length ? "imp" : "", d.special.some((s) => s.kind === "birthday") ? "bday" : d.special.some((s) => s.big) ? "big" : ""].join(" ");
        cells += `<span class="yd ${cls}" data-goday="${iso}" title="${esc([...(d.major ?? []), ...(d.important ?? []), ...d.special.map((s) => s.title)].join(" · "))}">${dd}</span>`;
      }
      return `<div class="ym${mi === new Date().getMonth() && y === new Date().getFullYear() ? " cur" : ""}"><h3 data-gomonth="${y}-${pad(mi + 1)}-01">${name}</h3><div class="yg">${cells}</div></div>`;
    }).join("")}</div>
      <div class="yside"><h3>This year's big days</h3>${list.length ? list.map((x) => `<div class="yl${x.major ? " major" : ""}" data-goday="${x.date}"><span>${dateOf(x.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span><b>${x.major ? "★★ " : ""}${esc(x.title)}</b></div>`).join("") : '<p style="color:var(--muted)">Nothing marked yet. Mark something as ★★ Major and it shows up here.</p>'}
        <div class="legend"><span><i style="background:rgba(255,210,122,.8)"></i>major</span><span><i style="box-shadow:inset 0 0 0 2px rgba(255,210,122,.6)"></i>holiday</span><span><i style="box-shadow:inset 0 0 0 2px rgba(255,160,200,.8)"></i>birthday</span><span><i style="background:var(--violet);border-radius:50%;width:.4em;height:.4em"></i>important</span></div></div></div>`;
  }

  // ---------- clicks ----------
  $("#view").addEventListener("click", (e) => {
    if (Date.now() - justDragged < 350) return;
    const ev = e.target.closest("[data-id]");
    if (ev) {
      e.stopPropagation();
      const fb = findBlock(ev.dataset.id);
      // from an outside calendar or task app: its card (what, when, where, which calendar, open it there)
      if (fb?.external) return openCard(fb);
      return openEditor(fb);
    }
    const slot = e.target.closest("[data-slot]");
    if (slot) { const [date, start] = slot.dataset.slot.split("|"); return openEditor(null, { date, start }); }
    const m = e.target.closest("[data-gomonth]");
    if (m) return setView("month", m.dataset.gomonth);
    const d = e.target.closest("[data-goday]");
    if (d) return setView("day", d.dataset.goday);
  });
  // ---------- drag: move a block (to another time, or another day in the week view) or drag its bottom edge to resize ----------
  let drag = null, justDragged = 0;
  const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  $("#view").addEventListener("pointerdown", (e) => {
    const el = e.target.closest("#gcanvas .ev");
    if (!el || e.button !== 0) return;
    const b = findBlock(el.dataset.id); if (!b || b.external) return;     // outside-calendar events don't drag
    drag = { el, b, x0: e.clientX, y0: e.clientY, pid: e.pointerId, mode: e.target.classList.contains("grip") ? "resize" : "move", moved: false, col: el.parentElement };
    if (drag.mode === "resize") e.preventDefault();
  });
  window.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    if (!drag.moved) { drag.moved = true; try { drag.el.setPointerCapture(drag.pid); } catch {} drag.el.classList.add("dragging"); }
    const hh = parseFloat(getComputedStyle($("#gcanvas")).getPropertyValue("--hh")) || 50;
    const steps = Math.round(dy / (hh / 4)), s0 = toMin(drag.b.start), e0 = toMin(drag.b.end), dur = e0 - s0;
    let date = drag.b.date, s = s0, en = e0, tx = 0;
    if (drag.mode === "resize") { en = Math.min(24 * 60 - 1, Math.max(s0 + 15, e0 + steps * 15)); drag.el.style.height = `${((en - s0) / 60) * hh - 3}px`; }
    else {
      s = Math.max(0, Math.min(24 * 60 - dur, s0 + steps * 15)); en = s + dur;
      const col = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.classList?.contains("col")) ?? drag.col;
      date = col.dataset.date; tx = col.offsetLeft - drag.col.offsetLeft;
      drag.el.style.transform = `translate(${tx}px, ${((s - s0) / 60) * hh}px)`;
    }
    drag.to = { date, start: fromMin(s), end: fromMin(en) };
    const sm = drag.el.querySelector("small"); if (sm) sm.innerHTML = `<span>${hm12(drag.to.start)}</span><span class="to"> – ${hm12(drag.to.end)}</span>`;
  });
  const endDrag = async () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved || !d.to) return;
    justDragged = Date.now();
    const same = d.to.date === d.b.date && d.to.start === d.b.start && d.to.end === d.b.end;
    if (same) return render();
    try {
      const r = await send("PATCH", `/blocks/${encodeURIComponent(d.b.id)}`, d.to);
      toast(r.conflicts?.length ? `Moved. It overlaps ${r.conflicts.map((c) => c.title).slice(0, 2).join(" and ")}.` : `${d.b.title}: ${hm12(d.to.start)} – ${hm12(d.to.end)}`);
    } catch (err) { toast(err.message); }
    render();
  };
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", () => { if (drag) { drag = null; render(); } });

  const findBlock = (id) => lastData?.days.flatMap((d) => [...d.blocks, ...(d.allDay ?? [])].map((b) => ({ ...b, date: d.date }))).find((b) => b.id === id);
  document.querySelectorAll("#views button").forEach((b) => (b.onclick = () => setView(b.dataset.v)));
  $("#prev").onclick = () => step(-1);
  $("#next").onclick = () => step(1);
  $("#today").onclick = () => { cursor = todayISO(); render(); };
  $("#addBtn").onclick = () => openEditor(null, { date: view === "day" ? cursor : cursor < todayISO() ? todayISO() : cursor });
  document.addEventListener("keydown", (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName ?? "")) { if (e.key === "Escape") closeEditor(); return; }
    if (e.key === "ArrowLeft") step(-1); else if (e.key === "ArrowRight") step(1);
    else if (e.key === "Escape") { if (PANELS.some((p) => $(p).classList.contains("open"))) closePanels(); else if (embed) $("#close").click(); }
    else if (/^[dwmy]$/i.test(e.key)) setView({ d: "day", w: "week", m: "month", y: "year" }[e.key.toLowerCase()]);
    else if (/^n$/i.test(e.key)) $("#addBtn").click();
    else if (e.key === "t") { cursor = todayISO(); render(); }
  });
  let wheelAt = 0;
  $("#view").addEventListener("wheel", (e) => { if (view === "day" || view === "week") return; if (Date.now() - wheelAt < 450) return; wheelAt = Date.now(); step(e.deltaY > 0 ? 1 : -1); }, { passive: true });

  // ---------- the editor ----------
  let editing = null, delArmed = 0;
  $("#fCat").innerHTML = categories.map((c) => `<option value="${c}">${c[0].toUpperCase() + c.slice(1)}</option>`).join("");
  function setImp(n) { document.querySelectorAll("#fImp button").forEach((b) => b.classList.toggle("on", Number(b.dataset.imp) === n)); $("#fImp").dataset.v = n; }
  document.querySelectorAll("#fImp button").forEach((b) => (b.onclick = (e) => { e.preventDefault(); setImp(Number(b.dataset.imp)); }));
  // ---------- repeating ----------
  const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"], WDN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const ordn = (n) => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
  let scope = "one", repDays = [];
  function fillRepeat(date) {
    const d = dateOf(date), day = d.getDate(), wd = d.getDay(), nth = Math.ceil(day / 7), last = day + 7 > new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const cur = $("#fRep").value;
    $("#fRep").innerHTML = [["none", "Doesn't repeat"], ["daily", "Every day"], ["daily2", "Every other day"], ["weekdays", "Every weekday (Mon–Fri)"], ["weekends", "Weekends"],
      ["weekly", `Weekly on ${WDN[wd]}`], ["biweekly", `Every other week on ${WDN[wd]}`], ["monthly", `Monthly on the ${ordn(day)}`],
      ...(nth <= 4 ? [["monthlyNth", `Monthly on the ${["first", "second", "third", "fourth"][nth - 1]} ${WDN[wd]}`]] : []), ...(last ? [["monthlyLast", `Monthly on the last ${WDN[wd]}`]] : []),
      ["yearly", `Every year on ${d.toLocaleDateString("en-US", { month: "long", day: "numeric" })}`], ["custom", "Custom…"]].map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
    if ([...$("#fRep").options].some((o) => o.value === cur)) $("#fRep").value = cur;
  }
  function syncRepeat() {
    const v = $("#fRep").value, custom = v === "custom";
    $("#repCustom").hidden = !custom;
    const weekly = v === "weekly" || v === "biweekly" || (custom && $("#fUnit").value === "weekly");
    $("#fDays").hidden = !weekly;
    if (weekly && !repDays.length) repDays = [WD[dateOf($("#fDate").value || todayISO()).getDay()]];
    document.querySelectorAll("#fDays button").forEach((x) => x.classList.toggle("on", repDays.includes(x.dataset.d)));
    $("#untilRow").hidden = v === "none";
  }
  // the rule from the form (null: doesn't repeat)
  function ruleFromForm() {
    const v = $("#fRep").value, date = $("#fDate").value, d = dateOf(date), wd = WD[d.getDay()];
    const until = $("#fUntil").value || undefined, start = date;
    const days = WD.filter((x) => repDays.includes(x));
    const r = { none: null, daily: { freq: "daily" }, daily2: { freq: "daily", interval: 2 }, weekdays: { freq: "weekly", days: ["mon", "tue", "wed", "thu", "fri"] }, weekends: { freq: "weekly", days: ["sun", "sat"] },
      weekly: { freq: "weekly", days: days.length ? days : [wd] }, biweekly: { freq: "weekly", interval: 2, days: days.length ? days : [wd] }, monthly: { freq: "monthly", monthDay: d.getDate() },
      monthlyNth: { freq: "monthly", nth: { n: Math.ceil(d.getDate() / 7), day: wd } }, monthlyLast: { freq: "monthly", nth: { n: -1, day: wd } }, yearly: { freq: "yearly" },
      custom: { freq: $("#fUnit").value, interval: Math.max(1, Number($("#fEvery").value) || 1), ...($("#fUnit").value === "weekly" ? { days: days.length ? days : [wd] } : {}) } }[v];
    return r ? { ...r, start, ...(until ? { until } : {}) } : null;
  }
  // an existing series → the form
  function ruleToForm(rule) {
    repDays = [...(rule?.days ?? [])];
    let v = "none";
    if (rule) {
      const n = rule.interval ?? 1, set = (rule.days ?? []).join(",");
      if (rule.freq === "daily") v = n === 1 ? "daily" : n === 2 ? "daily2" : "custom";
      else if (rule.freq === "weekly") v = n === 1 ? (set === "mon,tue,wed,thu,fri" ? "weekdays" : set === "sun,sat" ? "weekends" : "weekly") : n === 2 ? "biweekly" : "custom";
      else if (rule.freq === "monthly") v = n !== 1 ? "custom" : rule.nth ? (rule.nth.n === -1 ? "monthlyLast" : "monthlyNth") : "monthly";
      else if (rule.freq === "yearly") v = n === 1 ? "yearly" : "custom";
      if (v === "custom") { $("#fEvery").value = n; $("#fUnit").value = rule.freq; }
    }
    if (![...$("#fRep").options].some((o) => o.value === v)) v = "custom";
    $("#fRep").value = v; $("#fUntil").value = rule?.until ?? "";
    syncRepeat();
  }
  function setScope(sc) {
    scope = sc;
    document.querySelectorAll("#fScope button").forEach((x) => x.classList.toggle("on", x.dataset.scope === sc));
    $("#repeatBox").hidden = Boolean(editing?.routineId) && sc === "one";
    $("#fDel").textContent = editing?.routineId && sc === "all" ? "Delete this and all after" : "Delete";
    $("#fDel").classList.remove("arm"); delArmed = 0;
  }
  $("#fRep").onchange = syncRepeat; $("#fUnit").onchange = syncRepeat;
  $("#fDate").addEventListener("change", () => { fillRepeat($("#fDate").value); syncRepeat(); });
  document.querySelectorAll("#fDays button").forEach((x) => (x.onclick = (e) => { e.preventDefault(); repDays = repDays.includes(x.dataset.d) ? repDays.filter((d) => d !== x.dataset.d) : [...repDays, x.dataset.d]; if (!repDays.length) repDays = [x.dataset.d]; syncRepeat(); }));
  document.querySelectorAll("#fScope button").forEach((x) => (x.onclick = (e) => { e.preventDefault(); setScope(x.dataset.scope); }));

  function openEditor(b, seed = {}) {
    editing = b ?? null;
    $("#fCat").innerHTML = categories.map((c) => `<option value="${c}">${c[0].toUpperCase() + c.slice(1)}</option>`).join("");
    $("#dTitle").textContent = b ? "Edit" : "Add to your schedule";
    $("#fTitle").value = b?.title ?? "";
    $("#fDate").value = b?.date ?? seed.date ?? todayISO();
    const s = b?.start ?? seed.start ?? "09:00";
    $("#fStart").value = s;
    $("#fEnd").value = b?.end ?? `${pad(Math.min(23, Number(s.slice(0, 2)) + 1))}:${s.slice(3)}`;
    $("#fCat").value = b?.category ?? "flex";
    $("#fNotes").value = b?.description ?? "";
    $("#fDone").checked = Boolean(b?.done);
    $("#doneRow").hidden = !b;
    $("#gapRow").hidden = !b; $("#fGap").checked = false;
    setImp(b?.importance ?? 0);
    // repeating: which series, and whether a change is for this day or every time
    const series = Boolean(b?.routineId);
    $("#routineNote").hidden = !series;
    $("#routineNote").textContent = series ? `↻ Repeats: ${b.repeatText}` : "";
    $("#scopeRow").hidden = !series;
    fillRepeat($("#fDate").value);
    ruleToForm(series ? b.repeat : null);
    $("#fDel").hidden = !b; $("#fDel").classList.remove("arm"); $("#fDel").textContent = "Delete"; delArmed = 0;
    $("#fWarn").innerHTML = b?.clash ? clashLine(b.clash) : "";
    setScope("one");
    openPanel("#drawer");
    setTimeout(() => $("#fTitle").focus(), 200);
  }
  function closeEditor() { $("#drawer").classList.remove("open"); editing = null; }
  $("#dClose").onclick = closeEditor;
  $("#fSave").onclick = async () => {
    const body = { title: $("#fTitle").value.trim(), date: $("#fDate").value, start: $("#fStart").value, end: $("#fEnd").value, category: $("#fCat").value, description: $("#fNotes").value, importance: Number($("#fImp").dataset.v ?? 0) };
    if (!body.title) return ($("#fWarn").textContent = "Give it a name first.");
    if (!body.start || !body.end || body.end <= body.start) return ($("#fWarn").textContent = "The end time needs to be after the start.");
    try {
      let r;
      const rule = ruleFromForm();
      if (editing?.routineId && scope === "all") {
        // the whole series: its time, name, notes… and how often (none = it ends after this day)
        const cur = editing.repeat ?? {};
        const repeat = rule ? { ...rule, start: cur.start ?? rule.start } : { ...cur, until: body.date };
        await send("PATCH", `/routines/${encodeURIComponent(editing.routineId)}`, { title: body.title, start: body.start, end: body.end, category: body.category, description: body.description, importance: body.importance, repeat });
        closeEditor(); toast(rule ? "Saved for every time." : "Saved. It won't repeat after this day."); render(); return;
      }
      if (!editing && rule) {
        r = await send("POST", "/routines", { ...body, repeat: rule });
        closeEditor(); toast(`Saved. ${r.routine?.repeatText ?? "Repeats"}.`); render(); return;
      }
      if (editing) {
        r = await send("PATCH", `/blocks/${encodeURIComponent(editing.id)}`, { ...body, close_gap: $("#fGap").checked });
        if (!editing.routineId && rule) { const rr = await send("POST", `/blocks/${encodeURIComponent(r.block.id)}/repeat`, { repeat: rule }); toast(`Saved. ${rr.routine?.repeatText ?? "Repeats"}.`); }
        if (Boolean($("#fDone").checked) !== Boolean(editing.done)) await send("POST", `/blocks/${encodeURIComponent(r.block.id)}/done`, { done: $("#fDone").checked });
      } else r = await send("POST", "/blocks", body);
      closeEditor();
      if (r.pulledEarlier?.length) toast(`Saved, and moved ${r.pulledEarlier.length} later thing${r.pulledEarlier.length > 1 ? "s" : ""} up.`); else toast(r.conflicts?.length ? `Saved. Heads up: it overlaps ${r.conflicts.map((c) => c.title).slice(0, 2).join(" and ")}.` : "Saved.");
      render();
    } catch (e) { $("#fWarn").textContent = e.message; }
  };
  $("#fDel").onclick = async () => {
    if (!editing) return;
    if (!delArmed || Date.now() - delArmed > 4000) { delArmed = Date.now(); $("#fDel").classList.add("arm"); $("#fDel").textContent = "Tap again to delete"; return; }
    if (editing.routineId && scope === "all") {
      try { await send("POST", `/routines/${encodeURIComponent(editing.routineId)}/end`, { from: editing.date }); closeEditor(); toast("Deleted this and every one after it."); render(); } catch (e) { $("#fWarn").textContent = e.message; }
      return;
    }
    try { const r = await send("DELETE", `/blocks/${encodeURIComponent(editing.id)}${$("#fGap").checked ? "?close_gap=1" : ""}`); closeEditor(); toast(r.pulledEarlier?.length ? `Deleted, and moved ${r.pulledEarlier.length} later thing${r.pulledEarlier.length > 1 ? "s" : ""} up.` : "Deleted."); render(); } catch (e) { $("#fWarn").textContent = e.message; }
  };

  // ---------- live: Dayspring changed something by voice ----------
  try {
    const es = new EventSource("/api/events");
    es.addEventListener("refresh", (e) => {
      if ($("#drawer").classList.contains("open") || $("#card").classList.contains("open")) return;
      let r = {}; try { r = JSON.parse(e.data); } catch { /* no details */ }
      if (r.reason === "ai-edit") {
        const [from, to] = range();
        if (r.date && (r.date < from || r.date > to)) setView(view === "year" ? "year" : view, r.date); else render();
        toast("Updated by Dayspring");
      } else render();
    });
    es.addEventListener("calendar", (e) => { const c = JSON.parse(e.data); if (c.view) setView(c.view, c.date); });
    es.addEventListener("conflicts", () => { refreshConfCount(); if ($("#confPanel").classList.contains("open")) openConflicts(confRange); });
  } catch { /* fine without */ }
  // the display jumps an open schedule to a view and day without reloading it
  window.addEventListener("message", (e) => { const m = e.data; if (m?.type === "dayspring-calendar-goto" && m.view) setView(m.view, m.date); });
  window.addEventListener("resize", () => { clearTimeout(window._rs); window._rs = setTimeout(render, 200); });
  render();
})();
