/* Dayspring desk front end. No framework, no build step. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const api = async (path, opts = {}) => {
    const res = await fetch("/api" + path, {
      headers: { "content-type": "application/json" },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  };

  // ---- date helpers (local time only) ----
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
  const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtTime = (hm) => { const [h, m] = hm.split(":").map(Number); const ap = h >= 12 ? "pm" : "am"; const hh = h % 12 || 12; return m ? `${hh}:${pad(m)}${ap}` : `${hh}${ap}`; };
  const longDate = (s) => parseISO(s).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const minutesUntil = (hm) => { const [h, m] = hm.split(":").map(Number); const d = new Date(); return h * 60 + m - (d.getHours() * 60 + d.getMinutes()); };
  const humanMins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

  const state = { date: iso(new Date()), blocks: [], weekCounts: {}, categories: [], hasKey: false, busy: false, view: (() => { try { return localStorage.getItem("ds.view") || "day"; } catch { return "day"; } })() };
  const today = () => iso(new Date());

  // ---- day view ----
  async function loadDay() {
    const [{ blocks }, { ids }] = await Promise.all([api(`/agenda?from=${state.date}&to=${state.date}`), api(`/overlaps?date=${state.date}`)]);
    state.blocks = blocks;
    state.clashes = new Set(ids);
    const wk = weekStart(state.date);
    const { blocks: wkBlocks } = await api(`/agenda?from=${wk}&to=${addDays(wk, 6)}`);
    state.weekCounts = {};
    for (const b of wkBlocks) (state.weekCounts[b.date] ??= []).push(b);
    renderDay();
  }

  function weekStart(s) { const d = parseISO(s); d.setDate(d.getDate() - d.getDay()); return iso(d); }

  function renderDay() {
    const isToday = state.date === today();
    $("#dayTitle").textContent = isToday ? "Today" : state.date === addDays(today(), 1) ? "Tomorrow" : parseISO(state.date).toLocaleDateString("en-US", { weekday: "long" });
    $("#daySub").textContent = longDate(state.date);

    const wk = weekStart(state.date);
    $("#week").innerHTML = "";
    for (let i = 0; i < 7; i++) {
      const d = addDays(wk, i);
      const btn = document.createElement("button");
      btn.className = (d === state.date ? "sel " : "") + (d === today() ? "today" : "");
      const list = state.weekCounts[d] ?? [];
      const dots = list.slice(0, 6).map((b) => `<i style="background:${catColor(b.category)}"></i>`).join("");
      btn.innerHTML = `<span>${parseISO(d).toLocaleDateString("en-US", { weekday: "short" })}</span><b>${parseISO(d).getDate()}</b><span class="dots">${dots}</span>`;
      btn.onclick = () => { state.date = d; loadDay(); };
      $("#week").appendChild(btn);
    }

    const list = $("#blocks");
    list.innerHTML = summaryHTML(state.blocks);
    if (!state.blocks.length) {
      list.insertAdjacentHTML("beforeend", `<p class="empty">Nothing scheduled. Stamp your routines, add a block, or ask the assistant to plan the day.</p>`);
    }
    const nm = nowHM();
    let current = null, next = null;
    for (const b of state.blocks) {
      const isNow = isToday && b.start <= nm && nm < b.end;
      const isPast = isToday && b.end <= nm;
      if (isNow && !current) current = b;
      if (isToday && b.start > nm && !b.done && !next) next = b;
      const clash = state.clashes?.has(b.id);
      const el = document.createElement("div");
      el.className = `block ${b.category === "meal" ? "meal" : ""} ${b.done ? "done" : ""} ${isNow ? "now" : ""} ${isPast ? "past" : ""} ${clash ? "clash" : ""}`;
      el.dataset.id = b.id;
      el.style.animation = `vfade .3s ease-out ${Math.min(12, state.blocks.indexOf(b)) * 30}ms both`;
      el.innerHTML = `
        <input type="checkbox" ${b.done ? "checked" : ""} aria-label="Done">
        <span class="time">${fmtTime(b.start)}–${fmtTime(b.end)}</span>
        <div class="body"><p class="title">${esc(b.title)}<span class="tag t-${b.category}">${b.category}</span>${b.flexible ? '<span class="tag t-flex">flex</span>' : ""}${clash ? '<span class="tag t-clash">overlap</span>' : ""}</p>
        ${b.description ? `<p class="desc">${esc(b.description)}</p>` : ""}</div>
        <button class="btn ghost edit">Edit</button>`;
      $("input", el).onchange = async (e) => { await api(`/blocks/${b.id}/done`, { method: "POST", body: { done: e.target.checked } }); loadDay(); };
      $(".edit", el).onclick = () => openEdit(b, el);
      list.appendChild(el);
    }

    const cc = $("#clashcount");
    if (state.clashes?.size) { cc.hidden = false; cc.textContent = `${state.clashes.size} blocks overlap`; } else cc.hidden = true;

    const nu = $("#nextup");
    if (isToday && (current || next)) {
      nu.hidden = false;
      const parts = [];
      if (current) parts.push(`<div><b>Now:</b> ${esc(current.title)} <span class="cd">until ${fmtTime(current.end)} · ${humanMins(minutesUntil(current.end))} left</span></div>`);
      if (next) parts.push(`<div><b>Next:</b> ${esc(next.title)} <span class="cd">at ${fmtTime(next.start)} · in ${humanMins(minutesUntil(next.start))}</span></div>`);
      nu.innerHTML = parts.join("");
    } else nu.hidden = true;
  }

  function catColor(c) {
    return { faith: "var(--pink)", home: "var(--accent2)", body: "var(--accent)", rest: "var(--accent)", meal: "var(--accent2)", work: "var(--purple)", study: "var(--purple)", flex: "var(--warn)" }[c] || "var(--line)";
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function catOptions(sel, def = "flex") {
    sel.innerHTML = state.categories.map((c) => `<option value="${c}" ${c === def ? "selected" : ""}>${c}</option>`).join("");
  }

  // ---- conflict banner ----
  // Shown after a save that overlaps something. The block is already saved; the user picks what happens next.
  function showConflict(block, conflicts, undo) {
    const box = $("#conflict");
    const list = conflicts.map((c) => `${esc(c.title)} (${fmtTime(c.start)}–${fmtTime(c.end)})`).join(", ");
    box.innerHTML = `<div><b>${esc(block.title)}</b> at ${fmtTime(block.start)}–${fmtTime(block.end)} overlaps ${list}.</div>
      <div class="acts">
        <button class="btn primary" data-act="shift">Push the others later</button>
        <button class="btn" data-act="free">Show free slots</button>
        <button class="btn" data-act="undo">Undo</button>
        <button class="btn ghost" data-act="keep">Keep both</button>
      </div>`;
    box.hidden = false;
    box.onclick = async (e) => {
      const act = e.target.dataset?.act;
      if (!act) return;
      try {
        if (act === "shift") {
          const { moved } = await api(`/blocks/${block.id}/resolve`, { method: "POST", body: { mode: "shift_others" } });
          sys(moved.length ? `Moved: ${moved.map((m) => `${m.title} → ${fmtTime(m.start)}`).join(", ")}` : "Nothing needed to move.");
        } else if (act === "undo") { await undo(); sys("Undone."); }
        else if (act === "free") {
          const mins = minutesUntil(block.end) - minutesUntil(block.start);
          const { slots } = await api(`/free?date=${block.date}&minutes=${mins}`);
          sys(slots.length ? `Free for ${mins} min on ${block.date}: ${slots.map((s) => `${fmtTime(s.start)}–${fmtTime(s.end)}`).join(", ")}. Edit the block to move it.` : "No gap that long today.");
          return; // leave the banner up
        }
      } catch (err) { sys(err.message); }
      box.hidden = true; loadDay();
    };
  }

  // ---- add / edit forms ----
  $("#showAdd").onclick = () => { const f = $("#addForm"); f.hidden = false; f.date.value = state.date; f.title.focus(); };
  $("#cancelAdd").onclick = () => { $("#addForm").hidden = true; };
  $("#addForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const r = await api("/blocks", { method: "POST", body: { title: f.title.value, date: f.date.value, start: f.start.value, end: f.end.value, category: f.category.value, flexible: f.flexible.checked, description: f.description.value } });
      f.reset(); f.hidden = true; state.date = r.block.date; await loadDay();
      if (r.conflicts?.length) showConflict(r.block, r.conflicts, () => api(`/blocks/${r.block.id}`, { method: "DELETE" }));
    } catch (err) { sys(err.message); }
  };

  function openEdit(b, el) {
    const f = document.createElement("form");
    f.className = "form";
    f.innerHTML = `
      <input class="c6" name="title" value="${esc(b.title)}" required>
      <input class="c2" name="date" type="date" value="${b.date}" required>
      <input class="c2" name="start" type="time" value="${b.start}" required>
      <input class="c2" name="end" type="time" value="${b.end}" required>
      <select class="c3" name="category"></select>
      <label class="c3" style="display:flex;align-items:center;gap:6px;font-size:.86rem;color:var(--muted)"><input type="checkbox" name="flexible" ${b.flexible ? "checked" : ""} style="width:16px;height:16px"> Flexible</label>
      <textarea class="c6" name="description" rows="2">${esc(b.description)}</textarea>
      <div class="row"><button type="button" class="btn danger ghost del">Delete</button><button type="button" class="btn ghost cancel">Cancel</button><button class="btn primary" type="submit">Save</button></div>`;
    catOptions($("select", f), b.category);
    $(".cancel", f).onclick = () => f.replaceWith(el);
    $(".del", f).onclick = async () => { if (confirm(`Delete "${b.title}"?`)) { await api(`/blocks/${b.id}`, { method: "DELETE" }); loadDay(); } };
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const before = { date: b.date, start: b.start, end: b.end };
        const r = await api(`/blocks/${b.id}`, { method: "PATCH", body: { title: f.title.value, date: f.date.value, start: f.start.value, end: f.end.value, category: f.category.value, flexible: f.flexible.checked, description: f.description.value } });
        state.date = r.block.date; await loadDay();
        if (r.conflicts?.length) showConflict(r.block, r.conflicts, () => api(`/blocks/${b.id}`, { method: "PATCH", body: before }));
      } catch (err) { sys(err.message); }
    };
    el.replaceWith(f);
    f.title.focus();
  }

  // ---- views: day / week / month / year ----
  // Owner, 2026-09-12: "I need to be able to view past and present and future days and weeks and
  // months so that I can review what was done or what has been scheduled to do … day, week, month
  // and year views that I can dynamically switch between." One anchor date, four ways to look at it.
  const VIEWS = ["day", "week", "month", "year"];
  const monthStart = (s) => s.slice(0, 7) + "-01";
  const addMonths = (s, n) => { const d = parseISO(s); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); return iso(d); };
  const addYears = (s, n) => addMonths(s, 12 * n);
  const hours = (blocks) => blocks.reduce((t, b) => { const [h1, m1] = b.start.split(":").map(Number), [h2, m2] = b.end.split(":").map(Number); return t + Math.max(0, h2 * 60 + m2 - h1 * 60 - m1); }, 0) / 60;
  const fmtHours = (h) => (h >= 1 ? `${Math.round(h * 10) / 10}h` : `${Math.round(h * 60)}m`);

  function summaryHTML(blocks) {
    const done = blocks.filter((b) => b.done).length, n = blocks.length;
    if (!n) return "";
    const pct = Math.round((done / n) * 100);
    return `<div class="summary"><span><b>${n}</b> block${n === 1 ? "" : "s"}</span><span><b>${done}</b> done</span><span><b>${fmtHours(hours(blocks))}</b> scheduled</span><span class="bar" title="${pct}% done"><i style="width:${pct}%"></i></span></div>`;
  }

  function setView(v, dir = "fade") {
    if (!VIEWS.includes(v)) v = "day";
    state.view = v;
    try { localStorage.setItem("ds.view", v); } catch {}
    $$("#viewSeg button").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
    const on = $(`#viewSeg button[data-view="${v}"]`), pill = $(".seg__pill");
    if (on && pill) { pill.style.left = on.offsetLeft + "px"; pill.style.width = on.offsetWidth + "px"; }
    load(dir);
  }
  function animate(el, dir) {
    el.classList.remove("in-fade", "in-left", "in-right");
    void el.offsetWidth; // restart the animation
    el.classList.add(dir === "prev" ? "in-left" : dir === "next" ? "in-right" : "in-fade");
  }
  async function load(dir = "fade") {
    VIEWS.forEach((v) => { $(`#view-${v}`).hidden = v !== state.view; });
    const el = $(`#view-${state.view}`);
    if (state.view === "day") await loadDay();
    else if (state.view === "week") await loadWeek();
    else if (state.view === "month") await loadMonth();
    else await loadYear();
    animate(el, dir);
  }
  function navigate(n) {
    const dir = n < 0 ? "prev" : "next";
    if (state.view === "day") state.date = addDays(state.date, n);
    else if (state.view === "week") state.date = addDays(state.date, 7 * n);
    else if (state.view === "month") state.date = addMonths(state.date, n);
    else state.date = addYears(state.date, n);
    load(dir);
  }
  const jumpToDay = (d) => { state.date = d; setView("day", "fade"); };

  // week
  async function loadWeek() {
    const wk = weekStart(state.date), end = addDays(wk, 6);
    const { blocks } = await api(`/agenda?from=${wk}&to=${end}`);
    const a = parseISO(wk), b = parseISO(end);
    const sameMonth = a.getMonth() === b.getMonth();
    $("#dayTitle").textContent = `Week of ${a.toLocaleDateString("en-US", { month: "long", day: "numeric" })}${sameMonth ? "" : " – " + b.toLocaleDateString("en-US", { month: "long", day: "numeric" })}`;
    $("#daySub").textContent = `${a.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${b.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    const byDay = {}; for (const x of blocks) (byDay[x.date] ??= []).push(x);
    const H = 44, TOP = 6, HOURS = 17;
    const y = (hm) => { const [h, m] = hm.split(":").map(Number); return Math.max(0, Math.min(HOURS * H, ((h - TOP) * 60 + m) / 60 * H)); };
    let head = '<div class="wk__head"><span></span>', body = '<div class="wk__body"><div class="wk__gutter">';
    for (let h = TOP; h <= 23; h++) body += `<span style="top:${(h - TOP) * H}px">${h % 12 || 12}${h < 12 ? "a" : "p"}</span>`;
    body += "</div>";
    for (let i = 0; i < 7; i++) {
      const d = addDays(wk, i), list = byDay[d] ?? [], done = list.filter((x) => x.done).length, dt = parseISO(d);
      head += `<button data-day="${d}" class="${d === today() ? "today" : ""} ${d === state.date ? "sel" : ""}"><span>${dt.toLocaleDateString("en-US", { weekday: "short" })}</span><b>${dt.getDate()}</b><small>${list.length ? `${done}/${list.length} done` : "—"}</small></button>`;
      body += `<div class="wk__col ${d === today() ? "today" : ""}" data-day="${d}">`;
      list.forEach((x, k) => {
        const top = y(x.start), h = Math.max(22, y(x.end) - top);
        body += `<div class="wk__ev c-${x.category} ${x.done ? "done" : ""}" style="top:${top}px;height:${h - 2}px;animation-delay:${k * 25}ms" data-id="${x.id}" data-day="${d}" title="${esc(x.title)} · ${fmtTime(x.start)}–${fmtTime(x.end)}"><b>${esc(x.title)}</b><small>${fmtTime(x.start)}–${fmtTime(x.end)}</small></div>`;
      });
      if (d === today()) body += `<div class="wk__now" style="top:${y(nowHM())}px"></div>`;
      body += "</div>";
    }
    head += "</div>"; body += "</div>";
    const el = $("#view-week");
    el.innerHTML = summaryHTML(blocks) + `<div class="wk">${head}${body}</div>`;
    $$(".wk__head button, .wk__ev", el).forEach((b) => (b.onclick = () => jumpToDay(b.dataset.day)));
    const nowEl = $(".wk__now", el); if (nowEl) $(".wk__body", el).scrollTop = Math.max(0, parseInt(nowEl.style.top) - 160);
  }

  // month
  async function loadMonth() {
    const first = monthStart(state.date), fd = parseISO(first);
    const gridStart = addDays(first, -fd.getDay());
    const gridEnd = addDays(gridStart, 41);
    const { blocks } = await api(`/agenda?from=${gridStart}&to=${gridEnd}`);
    const inMonth = blocks.filter((b) => b.date.slice(0, 7) === first.slice(0, 7));
    $("#dayTitle").textContent = fd.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    $("#daySub").textContent = `${fd.toLocaleDateString("en-US", { month: "long" })} 1 – ${new Date(fd.getFullYear(), fd.getMonth() + 1, 0).getDate()}, ${fd.getFullYear()}` + (inMonth.length ? "" : " · nothing scheduled");
    const byDay = {}; for (const x of blocks) (byDay[x.date] ??= []).push(x);
    let html = summaryHTML(inMonth) + '<div class="mo__dow">' + ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<span>${d}</span>`).join("") + '</div><div class="mo">';
    for (let i = 0; i < 42; i++) {
      const d = addDays(gridStart, i), list = byDay[d] ?? [], dt = parseISO(d), other = d.slice(0, 7) !== first.slice(0, 7);
      const done = list.filter((x) => x.done).length, pct = list.length ? Math.round((done / list.length) * 100) : 0;
      html += `<button class="mo__cell ${other ? "other" : ""} ${d === today() ? "today" : ""} ${d === state.date ? "sel" : ""}" data-day="${d}" style="animation-delay:${i * 8}ms">
        <div class="mo__d"><span>${dt.getDate()}</span>${list.length ? `<small>${done}/${list.length}</small>` : ""}</div>
        ${list.slice(0, 3).map((x) => `<div class="mo__chip c-${x.category} ${x.done ? "done" : ""}">${fmtTime(x.start)} ${esc(x.title)}</div>`).join("")}
        ${list.length > 3 ? `<div class="mo__more">+${list.length - 3} more</div>` : ""}
        ${list.length ? `<div class="mo__bar"><i style="width:${pct}%"></i></div>` : ""}
      </button>`;
    }
    html += "</div>";
    const el = $("#view-month"); el.innerHTML = html;
    $$(".mo__cell", el).forEach((b) => (b.onclick = () => jumpToDay(b.dataset.day)));
  }

  // year
  async function loadYear() {
    const yr = state.date.slice(0, 4);
    const { blocks } = await api(`/agenda?from=${yr}-01-01&to=${yr}-12-31`);
    $("#dayTitle").textContent = yr;
    $("#daySub").textContent = `January – December ${yr}` + (blocks.length ? "" : " · nothing scheduled");
    const byDay = {}; for (const x of blocks) (byDay[x.date] ??= []).push(x);
    let html = summaryHTML(blocks) + '<div class="yr">';
    for (let m = 0; m < 12; m++) {
      const first = `${yr}-${pad(m + 1)}-01`, fd = parseISO(first), days = new Date(fd.getFullYear(), m + 1, 0).getDate();
      const mBlocks = blocks.filter((b) => b.date.slice(0, 7) === first.slice(0, 7));
      html += `<div class="yr__m" style="animation-delay:${m * 30}ms"><h3><button data-month="${first}">${fd.toLocaleDateString("en-US", { month: "long" })}</button><small>${mBlocks.length ? `${mBlocks.filter((b) => b.done).length}/${mBlocks.length}` : ""}</small></h3><div class="yr__g">`;
      html += ["S", "M", "T", "W", "T", "F", "S"].map((d) => `<span>${d}</span>`).join("");
      for (let i = 0; i < fd.getDay(); i++) html += '<button class="blank" tabindex="-1"></button>';
      for (let day = 1; day <= days; day++) {
        const d = `${first.slice(0, 8)}${pad(day)}`, list = byDay[d] ?? [];
        const lvl = list.length === 0 ? "" : list.length <= 1 ? "l1" : list.length <= 3 ? "l2" : list.length <= 6 ? "l3" : "l4";
        const allDone = list.length > 0 && list.every((x) => x.done);
        html += `<button data-day="${d}" class="${lvl} ${allDone ? "done" : ""} ${d === today() ? "today" : ""}" title="${d}${list.length ? ` · ${list.length} block${list.length === 1 ? "" : "s"}${allDone ? ", all done" : ""}` : ""}">${day}</button>`;
      }
      html += "</div></div>";
    }
    html += "</div>";
    const el = $("#view-year"); el.innerHTML = html;
    $$(".yr__g button[data-day]", el).forEach((b) => (b.onclick = () => jumpToDay(b.dataset.day)));
    $$(".yr__m h3 button", el).forEach((b) => (b.onclick = () => { state.date = b.dataset.month; setView("month"); }));
  }

  $$("#viewSeg button").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  $("#prevDay").onclick = () => navigate(-1);
  $("#nextDay").onclick = () => navigate(1);
  $("#todayBtn").onclick = () => { state.date = today(); load("fade"); };
  document.addEventListener("keydown", (e) => {
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowLeft") navigate(-1);
    else if (e.key === "ArrowRight") navigate(1);
    else if (e.key === "t" || e.key === "T") { state.date = today(); load("fade"); }
    else { const v = { d: "day", w: "week", m: "month", y: "year" }[e.key.toLowerCase()]; if (v) setView(v); }
  });
  window.addEventListener("resize", () => { const on = $("#viewSeg button.on"), pill = $(".seg__pill"); if (on && pill) { pill.style.left = on.offsetLeft + "px"; pill.style.width = on.offsetWidth + "px"; } });
  $("#applyRoutines").onclick = async () => { const { added } = await api("/routines/apply", { method: "POST", body: { date: state.date } }); sys(added.length ? `Stamped ${added.length} routine block(s).` : "Routines already on this day."); loadDay(); };

  // ---- side panes ----
  $$(".tabs button").forEach((b) => (b.onclick = () => {
    $$(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
    $$(".pane").forEach((p) => p.classList.toggle("on", p.id === `pane-${b.dataset.tab}`));
    if (b.dataset.tab === "tasks") loadTasks();
    if (b.dataset.tab === "routines") loadRoutines();
    if (b.dataset.tab === "memory") loadMemories();
  }));

  async function loadTasks() {
    const { tasks } = await api("/tasks");
    const el = $("#tasks");
    el.innerHTML = tasks.length ? "" : `<p class="empty">No open tasks.</p>`;
    for (const t of tasks) {
      const it = document.createElement("div");
      it.className = "item";
      it.innerHTML = `<input type="checkbox"><div class="grow">${esc(t.title)}<span class="tag t-${t.category}">${t.category}</span>${t.dueDate ? `<small>due ${t.dueDate}</small>` : ""}</div><button class="x" title="Delete">×</button>`;
      $("input", it).onchange = async () => { await api(`/tasks/${t.id}`, { method: "PATCH", body: { done: true } }); loadTasks(); };
      $(".x", it).onclick = async () => { await api(`/tasks/${t.id}`, { method: "DELETE" }); loadTasks(); };
      el.appendChild(it);
    }
  }
  $("#taskForm").onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    try { await api("/tasks", { method: "POST", body: { title: f.title.value, category: f.category.value, dueDate: f.dueDate.value || undefined } }); f.reset(); loadTasks(); } catch (err) { sys(err.message); }
  };

  const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  async function loadRoutines() {
    const { routines } = await api("/routines");
    const el = $("#routines");
    el.innerHTML = routines.length ? "" : `<p class="empty">No routines yet.</p>`;
    for (const r of routines) {
      const it = document.createElement("div");
      it.className = "item";
      it.innerHTML = `<input type="checkbox" ${r.active ? "checked" : ""} title="Active"><div class="grow">${esc(r.title)}<span class="tag t-${r.category}">${r.category}</span><small>${fmtTime(r.start)}–${fmtTime(r.end)} · ${r.days.length === 7 ? "every day" : r.days.join(" ")}</small></div><button class="x" title="Delete">×</button>`;
      $("input", it).onchange = async (e) => { await api(`/routines/${r.id}`, { method: "PATCH", body: { active: e.target.checked } }); };
      $(".x", it).onclick = async () => { if (confirm(`Delete routine "${r.title}"?`)) { await api(`/routines/${r.id}`, { method: "DELETE" }); loadRoutines(); } };
      el.appendChild(it);
    }
  }
  $("#routineDays").innerHTML = DAYS.map((d) => `<label><input type="checkbox" name="days" value="${d}" ${d !== "sun" && d !== "sat" ? "checked" : ""}>${d}</label>`).join("");
  $("#routineForm").onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    const days = $$("input[name=days]:checked", f).map((x) => x.value);
    try { await api("/routines", { method: "POST", body: { title: f.title.value, start: f.start.value, end: f.end.value, category: f.category.value, days } }); f.reset(); loadRoutines(); } catch (err) { sys(err.message); }
  };

  async function loadMemories() {
    const { memories } = await api("/memories");
    const el = $("#memories");
    el.innerHTML = memories.length ? "" : `<p class="empty">Nothing remembered yet.</p>`;
    for (const m of memories) {
      const it = document.createElement("div");
      it.className = "item";
      it.innerHTML = `<div class="grow">${esc(m.text)}<small>${new Date(m.createdAt).toLocaleDateString()}</small></div><button class="x" title="Forget">×</button>`;
      $(".x", it).onclick = async () => { await api(`/memories/${m.id}`, { method: "DELETE" }); loadMemories(); };
      el.appendChild(it);
    }
  }

  // ---- chat ----
  const log = $("#log");
  const hint = $("#hint");
  function push(cls, text) {
    if (hint && hint.parentNode) hint.remove();
    const d = document.createElement("div");
    d.className = `msg ${cls}`;
    const isAi = cls.startsWith("ai"), isSys = cls.startsWith("sys");
    const av = isAi ? '<span class="av" aria-hidden="true"><svg class="i"><use href="#ic-sun"/></svg></span>' : "";
    const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    d.innerHTML = `${av}<div class="col"><div class="bub"></div>${isSys ? "" : `<div class="meta">${isAi ? "Dayspring · " : ""}${time}</div>`}</div>`;
    const bub = $(".bub", d);
    if (isAi && cls.includes("interim")) bub.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    else bub.textContent = text;
    // keep the old contract: callers set .textContent on the returned element
    Object.defineProperty(d, "textContent", { set(v) { bub.textContent = v; }, get() { return bub.textContent; } });
    log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
  }
  const sys = (t, warn) => push(warn ? "sys warn" : "sys", t);
  $$("#hint .chips button").forEach((b) => (b.onclick = () => sendText(b.dataset.say)));
  // the textarea grows with the message
  const ta = $("#input");
  const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight) + "px"; };
  ta.addEventListener("input", grow);

  async function sendText(text) {
    text = text.trim();
    if (!text || state.busy) return;
    state.busy = true;
    push("me", text);
    $("#input").value = ""; grow();
    const thinking = push("ai interim", "…");
    try {
      const r = await api("/chat", { method: "POST", body: { message: text } });
      thinking.remove();
      push("ai", r.reply);
      if (r.changes?.length) { loadDay(); if (r.changes.includes("task")) loadTasks(); if (r.changes.includes("memory")) loadMemories(); if (r.changes.includes("routine")) loadRoutines(); }
      if ($("#speak").checked) speak(r.reply);
      else if ($("#handsfree").checked) startListening();
    } catch (err) {
      thinking.remove(); sys(`Error: ${err.message}`);
    } finally { state.busy = false; }
  }
  $("#send").onclick = () => sendText($("#input").value);
  $("#input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendText(e.target.value); } });

  // ---- voice out (browser speechSynthesis) ----
  const synth = window.speechSynthesis;
  let voices = [];
  function loadVoices() {
    voices = synth ? synth.getVoices().filter((v) => v.lang.startsWith("en")) : [];
    const sel = $("#voice");
    const saved = localStorage.getItem("ds.voice");
    sel.innerHTML = voices.map((v) => `<option value="${esc(v.name)}" ${v.name === saved ? "selected" : ""}>${esc(v.name.replace(/^Microsoft |^Google /, ""))}</option>`).join("");
    if (!saved) {
      const pref = voices.find((v) => /natural|neural|online/i.test(v.name) && /en-US/i.test(v.lang)) || voices.find((v) => /en-US/i.test(v.lang)) || voices[0];
      if (pref) sel.value = pref.name;
    }
  }
  if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }
  $("#voice").onchange = (e) => localStorage.setItem("ds.voice", e.target.value);

  function speak(text) {
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = voices.find((x) => x.name === $("#voice").value);
    if (v) u.voice = v;
    u.rate = 1.02;
    u.onend = () => { if ($("#handsfree").checked || wakeOn) startListening(); };
    synth.speak(u);
  }

  // ---- voice in (browser SpeechRecognition) ----
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false, wakeOn = false, interimEl = null;
  const WAKE = /^(hey\s+|ok\s+|okay\s+)?dayspring[,.!?]?\s*/i;

  function startListening() {
    if (!SR) { sys("Speech recognition isn't available in this browser. Chrome or Edge on desktop works."); return; }
    if (listening) return;
    rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = wakeOn;
    let finalText = "";
    rec.onstart = () => { listening = true; $("#mic").classList.add("live"); if (!wakeOn) interimEl = push("me interim", "listening…"); };
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t + " "; else interim += t;
      }
      if (wakeOn) {
        const f = finalText.trim();
        if (f && WAKE.test(f)) { const cmd = f.replace(WAKE, "").trim(); finalText = ""; if (cmd) { stopListening(); sendText(cmd); } }
        else if (f) finalText = ""; // not for us; drop it
      } else if (interimEl) {
        interimEl.textContent = (finalText + interim).trim() || "listening…";
      }
    };
    const MIC_ERRORS = {
      "not-allowed": "The browser is blocking the microphone. Click the lock icon in the address bar, allow the microphone for this site, then try again.",
      "service-not-allowed": "Speech recognition is turned off in this browser. Chrome or Edge on desktop works best.",
      "audio-capture": "No microphone was found. Plug one in or pick one in the system sound settings.",
      "network": "Speech recognition needs an internet connection right now.",
    };
    rec.onerror = (e) => { if (e.error !== "no-speech" && e.error !== "aborted") sys(MIC_ERRORS[e.error] || `Mic error: ${e.error}`, true); };
    rec.onend = () => {
      listening = false; $("#mic").classList.remove("live");
      if (wakeOn && $("#wake").checked && !state.busy) { setTimeout(startListening, 250); return; }
      if (interimEl) { interimEl.remove(); interimEl = null; }
      const t = finalText.trim();
      if (t && !wakeOn) sendText(t);
    };
    rec.start();
  }
  function stopListening() { if (rec && listening) rec.stop(); }

  $("#mic").onclick = () => (listening ? stopListening() : startListening());
  document.addEventListener("keydown", (e) => { if (e.code === "Space" && !e.repeat && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) { e.preventDefault(); startListening(); } });
  document.addEventListener("keyup", (e) => { if (e.code === "Space" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) stopListening(); });
  $("#wake").onchange = (e) => { wakeOn = e.target.checked; stopListening(); if (wakeOn) { sys('Wake word on. Say "Dayspring, what\'s next?"'); setTimeout(startListening, 300); } };

  // ---- theme: Dark → Light → System, remembered ----
  const THEMES = ["dark", "light", "system"];
  function applyTheme(t) {
    if (t === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
    $("#theme").title = `Theme: ${t} (click to change)`;
    $("#theme use").setAttribute("href", t === "dark" ? "#ic-moon" : t === "light" ? "#ic-sunny" : "#ic-auto");
    try { localStorage.setItem("ds.theme", t); } catch {}
  }
  $("#theme").onclick = () => {
    const cur = (() => { try { return localStorage.getItem("ds.theme") || "dark"; } catch { return "dark"; } })();
    applyTheme(THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]);
  };
  applyTheme((() => { try { return localStorage.getItem("ds.theme") || "dark"; } catch { return "dark"; } })());

  // ---- boot ----
  async function boot() {
    const s = await api("/status");
    state.categories = s.categories; state.hasKey = s.hasKey;
    $("#keyStatus").textContent = s.hasKey ? "Assistant ready" : "Assistant off (no key yet)";
    $("#keyStatusWrap").classList.toggle("bad", !s.hasKey);
    $$("select[name=category]").forEach((sel) => catOptions(sel));
    setView(state.view, "fade");
    tick();
    setInterval(tick, 30000);
    setInterval(() => { if (state.date === today()) renderDay(); }, 60000);
  }
  function tick() { $("#clock").textContent = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
  boot();
})();
