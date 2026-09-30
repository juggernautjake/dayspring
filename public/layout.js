// The Dayspring display fits any window size and any Settings → Screen margin (loaded last, after the add-ons).
//   • Toolbars never spill: labels shorten, then the least-used buttons move into a "⋯ More" menu.
//   • Text picks the longest version that fits (the date, times, the exam's place; see layout.css ".fitv").
//   • When a column runs out of height, small cards go compact, then fold away (they come back when there's room).
//   • Pop-ups are kept inside the screen's margins (the safe area: safe-area.css, dsSafeRect, dsKeepInSafe).
//   • The window bar: move the pointer to the top edge for 🔊 Sound, ⛶ full screen, — minimize, □ maximize, 👁 hide, ✕ exit.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const post = (path, body) => fetch("/api" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }).then((r) => r.json().catch(() => ({})));
  const wideOver = (el) => el && el.scrollWidth > el.clientWidth + 1;
  const tallOver = (el) => el && el.scrollHeight > el.clientHeight + 1;
  const visible = (el) => el && el.offsetParent !== null;
  // Does anything inside stick out of el's content box? (scrollWidth over-reports by a few pixels for glyphs and
  // shadows, so this looks at where the pieces actually are.) Content inside something that clips is fine.
  function spills(el, axis = "x") {
    if (!el || !visible(el)) return false;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const x = axis === "x";
    const lo = (x ? r.left + parseFloat(cs.paddingLeft) : r.top + parseFloat(cs.paddingTop)) - 1.5;
    const hi = (x ? r.right - parseFloat(cs.paddingRight) : r.bottom - parseFloat(cs.paddingBottom)) + 1.5;
    for (const c of el.querySelectorAll("*")) {
      const cr = c.getBoundingClientRect();
      if (!cr.width || !cr.height) continue;
      if ((x ? cr.right : cr.bottom) <= hi && (x ? cr.left : cr.top) >= lo) continue;
      if (getComputedStyle(c).position === "fixed") continue;
      let clipped = false;
      for (let e = c.parentElement; e && e !== el; e = e.parentElement) { const s2 = getComputedStyle(e); if ((x ? s2.overflowX : s2.overflowY) !== "visible") { clipped = true; break; } }
      if (!clipped) return true;
    }
    return false;
  }

  /* ---------------- text that picks the longest version that fits ---------------- */
  function fitVariants(el) {
    if (!el || !visible(el)) return 0;
    const n = el.querySelectorAll(":scope > .v").length;
    if (n < 2) { el.removeAttribute("data-pick"); return 0; }
    for (let i = 0; i < n; i++) { el.dataset.pick = i; if (!wideOver(el) && !tallOver(el)) return i; }
    return n - 1;
  }

  /* ---------------- "⋯ More" menus ---------------- */
  const allMores = [];
  function makeMore(host, label) {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "morebtn"; btn.textContent = "⋯"; btn.hidden = true;
    btn.title = `More ${label}`; btn.setAttribute("aria-label", `More ${label}`); btn.setAttribute("aria-haspopup", "true"); btn.setAttribute("aria-expanded", "false");
    const box = document.createElement("div");
    box.className = "morebox"; box.hidden = true; box.setAttribute("role", "group"); box.setAttribute("aria-label", `More ${label}`);
    document.body.appendChild(box);
    host.appendChild(btn);
    const m = { btn, box, host, items: [] };
    allMores.push(m);
    const place = () => {
      // below the ⋯ (above it if there's no room), inside the screen's margins
      const r = btn.getBoundingClientRect(), b = box.getBoundingClientRect(), S = safeRect(), pad = 8;
      let left = Math.min(r.right - b.width, S.right - b.width - pad); left = Math.max(S.left + pad, left);
      let top = r.bottom + 6; if (top + b.height > S.bottom - pad) top = Math.max(S.top + pad, r.top - b.height - 6);
      box.style.left = left + "px"; box.style.top = top + "px"; box.style.right = box.style.bottom = "auto";
      keepInSafe(box);
    };
    m.open = () => { box.hidden = false; btn.setAttribute("aria-expanded", "true"); place(); (box.querySelector("button, select, input") ?? box).focus?.(); };
    m.close = (refocus) => { if (box.hidden) return; box.hidden = true; btn.setAttribute("aria-expanded", "false"); if (refocus) btn.focus(); };
    btn.onclick = (e) => { e.stopPropagation(); box.hidden ? m.open() : m.close(); };
    box.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b && !b.closest(".tune")) setTimeout(() => m.close(), 0); });
    box.addEventListener("change", (e) => { if (e.target.matches("select")) setTimeout(() => m.close(), 0); });
    // Esc closes the open menu first (before the page's own Esc handling) and puts focus back on ⋯
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !box.hidden && (!e.dsTop || e.dsTop === box)) { e.stopPropagation(); e.preventDefault(); m.close(true); } }, true);
    document.addEventListener("pointerdown", (e) => { if (!box.hidden && !box.contains(e.target) && e.target !== btn) m.close(); });
    return m;
  }
  function moveToMore(m, el) {
    if (!el || !el.parentNode || m.items.some((x) => x.el === el)) return;
    const ph = document.createComment("more");
    el.parentNode.insertBefore(ph, el);
    m.items.push({ el, ph });
    m.box.appendChild(el);
    m.btn.hidden = false;
  }
  function restoreMore(m) {
    for (const { el, ph } of m.items.reverse()) { if (ph.parentNode) ph.parentNode.insertBefore(el, ph); ph.remove(); }
    m.items = []; m.btn.hidden = true; m.close();
  }

  /* ---------------- shorter labels ---------------- */
  // "🔔 Voice" → "🔔" (the full label stays as the tooltip); buttons with a .lbl span just hide it
  function iconOnly(el, on) {
    if (!el) return;
    if (el.querySelector(".lbl")) { el.classList.toggle("ico-only", on); if (on) el.setAttribute("aria-label", el.textContent.trim()); return; }
    if (on) {
      const t = el.textContent.trim(), m = /^(\S+)\s+(.+)$/u.exec(t);
      if (!m || /^[\p{L}\p{N}]/u.test(m[1])) return;             // no leading icon: leave it
      el.dataset.full = t; el.dataset.short = m[1]; el.textContent = m[1];
      if (!el.title) el.title = t; el.setAttribute("aria-label", t);
    } else if (el.dataset.full && el.textContent === el.dataset.short) { el.textContent = el.dataset.full; delete el.dataset.full; delete el.dataset.short; }
  }
  function shortText(el, on, text) {
    if (!el) return;
    if (on) { if (el.dataset.full === undefined) el.dataset.full = el.textContent; el.textContent = text; el.setAttribute("aria-label", el.dataset.full); }
    else if (el.dataset.full !== undefined) { el.textContent = el.dataset.full; delete el.dataset.full; el.removeAttribute("aria-label"); }
  }
  // the clock row's buttons: wrap their words so they can hide
  for (const b of $$(".calbtns .util button")) for (const n of [...b.childNodes]) if (n.nodeType === 3 && n.textContent.trim()) { const s = document.createElement("span"); s.className = "lbl"; s.textContent = n.textContent; n.replaceWith(s); }

  /* ---------------- fitters: each has ordered steps; undo all, then apply until it fits ---------------- */
  const cls = (el, c) => ({ apply: () => el?.classList.add(c), undo: () => el?.classList.remove(c) });
  const fitters = [];
  function addFitter(name, measure, steps, before) { fitters.push({ name, measure, steps, before, applied: 0 }); }

  // the clock row
  const clock = $(".clock"), date = $("#date"), util = $(".calbtns .util"), seg = $(".calbtns .seg");
  if (clock && util) {
    const more = makeMore(util, "buttons");
    const utilBtns = () => $$(".calbtns .util > button:not(.morebtn)");
    const segBtns = () => $$(".calbtns .seg button");
    const SHORT = { day: "D", week: "W", month: "M", year: "Y" };
    addFitter("clock", () => { fitVariants(date); return spills(clock) || Number(date?.dataset.pick ?? 0) >= 2; }, [
      { apply: () => utilBtns().forEach((b) => iconOnly(b, true)), undo: () => $$(".calbtns .util button, .morebox button").forEach((b) => iconOnly(b, false)) },
      { apply: () => segBtns().forEach((b) => shortText(b, true, SHORT[b.dataset.cal] ?? b.textContent.slice(0, 1))), undo: () => segBtns().forEach((b) => shortText(b, false)) },
      cls(seg, "fit-nolead"),
      { apply: () => moveToMore(more, $("#helpBtn")), undo: () => {} },
      { apply: () => moveToMore(more, $("#skyBtn")), undo: () => {} },
      { apply: () => moveToMore(more, $("#setBtn")), undo: () => {} },
      { apply: () => moveToMore(more, $("#musicBtn")), undo: () => {} },
      cls(clock, "fit-compact"),
    ], () => { restoreMore(more); moveToMore(more, $("#aiBtn")); });   // 🧠 AI brain always lives in the ⋯ menu (ai-switch.js)
  }
  // the Dayspring panel's header: Dayspring · Ready · ✋ Stop 🎧 ▾ ⌨ Type 🔇 ↻ 💬
  const head = $(".talkhead"), tt = $(".talktools");
  if (head && tt) {
    const more = makeMore(tt, "controls");
    const mv = (sel) => ({ apply: () => moveToMore(more, $(sel)), undo: () => {} });
    addFitter("talkhead", () => spills(head), [
      cls(head, "fit-quiet"),
      mv("#chatBtn"), mv("#repeatBtn"), mv("#quietBtn"),
      { apply: () => iconOnly($("#typeBtn"), true), undo: () => iconOnly($("#typeBtn"), false) },
      mv("#typeBtn"),
      cls(head, "fit-dots"),
      { apply: () => iconOnly($("#stopBtn"), true), undo: () => iconOnly($("#stopBtn"), false) },
      cls(head, "fit-nolabel"),
      { apply: () => moveToMore(more, $(".talktools .tune")), undo: () => {} },
    ], () => { restoreMore(more); iconOnly($("#typeBtn"), false); iconOnly($("#stopBtn"), false); });
  }
  // the Dayspring panel's bottom row: status · 🔔 Voice · 🔊 Sound · 🎚 Volume · What's now? · voice · ⛶
  const mic = $(".mic"), tools = $(".mic .tools");
  if (mic && tools) {
    const more = makeMore(tools, "options");
    const mv = (sel) => ({ apply: () => moveToMore(more, typeof sel === "string" ? $(sel) : sel()), undo: () => {} });
    const icons = () => [$("#bell"), $(".mic .tools > button:not(#bell):not(#mixBtn):not(.morebtn):not(#sayNow):not(#full)"), $("#mixBtn")];
    addFitter("mic", () => spills(mic) || ($("#micText") && $("#micText").clientWidth < 40 && !mic.classList.contains("fit-notext")), [
      mv("#full"), mv("#voice"), mv("#sayNow"),
      { apply: () => icons().forEach((b) => iconOnly(b, true)), undo: () => icons().forEach((b) => iconOnly(b, false)) },
      cls(mic, "fit-notext"),
      mv(() => $(".mic .tools > button:not(#bell):not(#mixBtn):not(.morebtn)")),
      mv("#mixBtn"), mv("#bell"),
    ], () => { restoreMore(more); icons().forEach((b) => iconOnly(b, false)); $$(".morebox #bell, .morebox #mixBtn").forEach((b) => iconOnly(b, false)); });
  }
  // the columns' height: compact cards, then fold the small ones away
  const [col1, col2] = $$(".screen > .col");
  // (a card that clips its own content counts too: the music card's buttons cut off at its bottom edge)
  const cardsSpill = (col) => [...col.querySelectorAll(":scope > .card, :scope > .nowrow > .card")].some((c) => spills(c, "y"));
  if (col1) addFitter("col1", () => spills(col1, "y") || cardsSpill(col1), [cls($(".nowrow"), "fit-compact"), cls(clock, "fit-short")]);
  if (col2) addFitter("col2", () => spills(col2, "y") || cardsSpill(col2) || (col2.querySelector(".talk") && col2.querySelector(".talk").clientHeight < 150), [
    cls($("#examCard"), "fit-compact"), cls($("#courses"), "fit-compact"), cls($("#np"), "fit-compact"),
    cls($("#examCard"), "fit-hide"), cls($("#courses"), "fit-hide"), cls($(".talk"), "fit-small"),
  ]);

  let busy = false, lastRun = 0, runs = 0;
  function refit() {
    if (busy) return;
    // many changes at once (while loading): catch up a little later instead of dropping the last one
    const now = performance.now();
    if (now - lastRun < 1000) { if (++runs > 25) { clearTimeout(refit.later); refit.later = setTimeout(schedule, 400); return; } } else { runs = 0; lastRun = now; }
    busy = true; mo.disconnect();
    const focused = document.activeElement;
    // a ⋯ menu that's open stays open through a refit (the screen updates while he's choosing)
    const wasOpen = allMores.filter((m) => !m.box.hidden);
    try {
      for (const f of fitters) {
        for (let i = f.steps.length - 1; i >= 0; i--) f.steps[i].undo();
        f.before?.();
        let i = 0;
        while (i < f.steps.length && f.measure()) f.steps[i++].apply();
        f.applied = i;
      }
      for (const el of $$(".fitv")) if (el !== date) fitVariants(el);
      for (const m of wasOpen) if (m.items.length && !m.btn.hidden && m.box.hidden) { m.box.hidden = false; m.btn.setAttribute("aria-expanded", "true"); }
      clampPopups();
      // moving a focused button in or out of a ⋯ menu drops keyboard focus: put it back (or on the ⋯ that now holds it)
      if (focused && focused !== document.body && document.activeElement !== focused) {
        const box = focused.closest?.(".morebox");
        if (box?.hidden) fitters && document.querySelectorAll(".morebtn").forEach((b) => { if (!b.hidden && b.getAttribute("aria-label") === box.getAttribute("aria-label")) b.focus(); });
        else if (focused.isConnected) focused.focus?.();
      }
    } finally { busy = false; observe(); }
  }
  let queued = 0;
  const schedule = () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; refit(); }); };

  /* ---------------- pop-ups stay inside the screen's margins (the safe area) ---------------- */
  // safe-area.css turns the margins into --safe-top/right/bottom/left (Dayspring mini: its whole window). An invisible
  // fixed box pinned to them measures the safe rectangle in pixels for anything placed from script.
  const probe = document.createElement("div");
  probe.id = "dsSafeArea"; probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:fixed;top:var(--safe-top,0px);right:var(--safe-right,0px);bottom:var(--safe-bottom,0px);left:var(--safe-left,0px);visibility:hidden;pointer-events:none;z-index:-1";
  document.body.appendChild(probe);
  function safeRect() {
    const r = probe.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight };
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }
  // Move a fixed pop-up (placed by script next to its button) back inside the safe rectangle, keeping a small gap. Its
  // size is already capped by safe-area.css, so it always fits. Returns true if it moved.
  const GAP = 6;
  function keepInSafe(el) {
    if (!el || !el.isConnected || el.hidden || getComputedStyle(el).position !== "fixed") return false;
    const cs = getComputedStyle(el), S = safeRect();
    const w = el.offsetWidth, h = el.offsetHeight; if (!w || !h) return false;
    const left = parseFloat(cs.left), top = parseFloat(cs.top); if (!isFinite(left) || !isFinite(top)) return false;
    let x = Math.min(left, S.right - GAP - w); x = Math.max(x, S.left + GAP);
    let y = Math.min(top, S.bottom - GAP - h); y = Math.max(y, S.top + GAP);
    if (Math.abs(x - left) < 0.5 && Math.abs(y - top) < 0.5) return false;
    el.style.left = x + "px"; el.style.top = y + "px"; el.style.right = "auto"; el.style.bottom = "auto";
    return true;
  }
  window.dsSafeRect = safeRect;
  window.dsKeepInSafe = keepInSafe;

  /* ---------------- "full screen" is the whole safe area, never the whole TV ---------------- */
  // A TV crops its edges, so only the Dayspring screen itself goes truly full screen (F11, ⛶ on the window bar). Anything
  // else that asks — the details card's ⛶ (a photo, a video), the file viewer's video ⛶, a video's own ⛶ in its
  // controls (the gallery's), YouTube's ⛶ inside a frame — fills the safe area instead (.ds-safe-full, safe-area.css).
  // Asking again, or Esc, puts it back. Inside a window of the window manager (winman.js) that window is made big for as
  // long (a window with a blurred backdrop is where its fixed children are placed), then goes back to how it was.
  //   dsSafeFull(el[, on]) → true when it's now filling the safe area
  const FULL = "ds-safe-full", fullOn = new Set(), FULL_PROPS = ["left", "top", "right", "bottom", "width", "height"];
  // placed in pixels: a fixed element inside a window with a blurred backdrop or a transform is placed from that window,
  // not the screen, so where its 0,0 lands is measured first
  function placeFull(el) {
    if (!el.isConnected) return;
    const S = safeRect(), g = el.dataset.dsFullWin ? (window.winman?.GAP ?? 12) : 0;   // (in a window: the big window's place)
    const T = { left: S.left + g, top: S.top + g, width: Math.max(1, S.width - 2 * g), height: Math.max(1, S.height - 2 * g) };
    Object.assign(el.style, { left: "0px", top: "0px", right: "auto", bottom: "auto", width: T.width + "px", height: T.height + "px" });
    const o = el.getBoundingClientRect();
    el.style.left = T.left - o.left + "px"; el.style.top = T.top - o.top + "px";
  }
  function safeFull(el, on) {
    if (!el || el === document.documentElement || el === document.body) return false;
    on = on === undefined ? !el.classList.contains(FULL) : Boolean(on);
    if (on === el.classList.contains(FULL)) return on;
    const win = el.parentElement?.closest?.("[data-wm-id]"), id = win?.dataset.wmId, W = window.winman;
    if (on) {
      el.__dsFullStyle = Object.fromEntries(FULL_PROPS.map((k) => [k, el.style[k]]));
      el.classList.add(FULL); fullOn.add(el);
      if (id && W?.get?.(id)) { el.dataset.dsFullWin = id; const m = W.get(id).mode; if (m !== "max") { el.dataset.dsFullWas = m; W.setMode(id, "max", { user: false }); } }
      placeFull(el);
    } else {
      el.classList.remove(FULL); fullOn.delete(el);
      Object.assign(el.style, el.__dsFullStyle ?? Object.fromEntries(FULL_PROPS.map((k) => [k, ""]))); delete el.__dsFullStyle;
      const was = el.dataset.dsFullWas, wid = el.dataset.dsFullWin; delete el.dataset.dsFullWas; delete el.dataset.dsFullWin;
      if (was && wid && W?.get?.(wid)?.mode === "max") W.setMode(wid, was, { user: false });
    }
    document.dispatchEvent(new CustomEvent("ds-safefull", { detail: { el, on } }));
    return on;
  }
  window.dsSafeFull = safeFull;
  // what page code asks for (el.requestFullscreen()): the safe area, except for the whole screen
  for (const k of ["requestFullscreen", "webkitRequestFullscreen"]) {
    const native = Element.prototype[k]; if (typeof native !== "function") continue;
    Element.prototype[k] = function (...a) { if (this === document.documentElement) return native.apply(this, a); safeFull(this); return Promise.resolve(); };
  }
  // what the browser does by itself (a video's own ⛶, YouTube's ⛶ in a frame): straight back out, into the safe area
  const onNativeFull = () => {
    const el = document.fullscreenElement ?? document.webkitFullscreenElement;
    if (!el || el === document.documentElement) { for (const x of fullOn) placeFull(x); return; }
    // (placed once it's out: in the browser's full screen it's measured from the whole screen)
    Promise.resolve((document.exitFullscreen ?? document.webkitExitFullscreen)?.call(document)).catch(() => {}).then(() => requestAnimationFrame(() => safeFull(el)));
  };
  document.addEventListener("fullscreenchange", onNativeFull);
  document.addEventListener("webkitfullscreenchange", onNativeFull);
  // Esc: the newest one goes back first (before the window it's in closes)
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !fullOn.size) return;
    const el = [...fullOn].pop();
    e.stopImmediatePropagation(); e.preventDefault(); safeFull(el, false);
  }, true);
  // gone (closed, hidden, another photo): nothing left filling the safe area, its window back to how it was
  setInterval(() => { for (const el of [...fullOn]) if (!el.isConnected || el.closest("[hidden]") || getComputedStyle(el).display === "none") safeFull(el, false); }, 700);
  // everything placed from script (menus and pop-overs next to their buttons); the rest are pinned by safe-area.css
  const POPS = ".stpop, .tunepop, .meetpop, .lib .menu, .morebox, .statemenu, #soundPanel, .mailcomp";   // (.mailcomp: the email and invitation editors, mail-compose.js)
  const popRo = new ResizeObserver(() => requestAnimationFrame(clampPopups));
  const watched = new WeakSet();
  function clampPopups() {
    for (const el of $$(POPS)) {
      if (el.hidden || !el.offsetWidth) continue;
      if (!watched.has(el)) { watched.add(el); popRo.observe(el); }   // it grows (more text, a longer list): check again
      keepInSafe(el);
    }
    for (const el of fullOn) placeFull(el);   // (a "full screen" follows the margins and the window's size too)
  }

  /* ---------------- watching for anything that changes sizes ---------------- */
  const ro = new ResizeObserver(schedule);
  for (const el of [document.body, clock, head, mic, col1, col2, ...$$(".screen .card")].filter(Boolean)) ro.observe(el);
  const WATCH = [clock, head, mic, $("#nowBody"), $("#next"), $("#examCard"), $("#courses"), $("#np .meta")].filter(Boolean);
  const mo = new MutationObserver((list) => { if (list.some((r) => !(r.target.closest?.(".morebox")))) schedule(); });
  const bodyMo = new MutationObserver(() => requestAnimationFrame(clampPopups));
  bodyMo.observe(document.body, { childList: true });
  // a menu that's shown again (hidden → visible) is checked too
  new MutationObserver((list) => { if (list.some((r) => r.target.matches?.(POPS))) requestAnimationFrame(clampPopups); })
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
  // the margins changed (Settings, or dragging the 📐 lines) or the window was resized: straight away, not after a refit
  let clampQueued = 0;
  const clampSoon = () => { if (!clampQueued) clampQueued = requestAnimationFrame(() => { clampQueued = 0; clampPopups(); }); };
  new MutationObserver(clampSoon).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
  addEventListener("resize", clampSoon);
  function observe() { for (const el of WATCH) mo.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden"] }); }
  new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });   // the margin (--os) changed
  addEventListener("resize", schedule);
  document.fonts?.ready?.then(schedule);
  observe(); schedule(); setTimeout(schedule, 800); setTimeout(schedule, 2500);
  setTimeout(() => { $$(".screen .card").forEach((c) => c.classList.add("fit-steady")); schedule(); }, 1200);
  window.dsRefit = schedule;

  /* ---------------- the window bar ---------------- */
  const bar = document.createElement("div");
  bar.className = "wbar"; bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", "Window");
  bar.innerHTML = `<span class="wt"><b>Dayspring</b></span>
    <button data-w="update" class="wupd" hidden title="A new version is available" aria-label="A new version is available">⬆</button>
    <button data-w="state" class="wstate" title="Active, Quiet or Off, and notifications" aria-label="Listening and notifications"><i></i></button>
    <button data-w="sound" title="Sound: outputs, microphone and volume" aria-label="Sound">🔊</button>
    <button data-w="size" title="Compact: shrink to Dayspring mini" aria-label="Compact">⤡</button>
    <button data-w="fit" title="Fit to screen: size and edges" aria-label="Fit to screen">📐</button>
    <button data-w="full" title="Full screen (F11)" aria-label="Full screen">⛶</button>
    <button data-w="minimize" title="Minimize" aria-label="Minimize">—</button>
    <button data-w="max" title="Maximize" aria-label="Maximize">□</button>
    <button data-w="hide" title="Hide (keeps listening)" aria-label="Hide">👁</button>
    <button data-w="exit" class="x" title="Close the Dayspring screen" aria-label="Close the Dayspring screen">✕</button>`;
  document.body.appendChild(bar);
  let barTimer = 0;
  const showBar = () => { clearTimeout(barTimer); bar.classList.add("show"); paintMax(); };
  const hideBarSoon = () => { clearTimeout(barTimer); barTimer = setTimeout(() => { if (!bar.matches(":hover") && !bar.contains(document.activeElement)) bar.classList.remove("show"); }, 1500); };
  // the top band that brings it up: the cropped margin (a TV hides it) plus a little inside the visible area
  // (the bar sits just above the content; the whole band from the very top down to the content's top edge brings it up)
  const contentTop = () => { const tops = $$(".screen > .col").map((c) => c.getBoundingClientRect()).filter((r) => r.height > 0).map((r) => r.top); return tops.length ? Math.min(...tops) : parseFloat(getComputedStyle(bar).top) || 0; };
  // Only the thin strip at the very top (plus a TV's cropped margin) brings it up, and only after the pointer rests there
  // briefly: the clock and date sit just below, so passing over them (or coming in from the title bar) mustn't cover them.
  const margin = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--st") || getComputedStyle(document.documentElement).getPropertyValue("--sy")) || 0;
  let dwell = 0;
  addEventListener("pointermove", (e) => {
    const band = Math.min(contentTop(), margin()) + 12, barBottom = bar.getBoundingClientRect().bottom;
    if (e.clientY <= band) { if (!bar.classList.contains("show") && !dwell) dwell = setTimeout(() => { dwell = 0; showBar(); }, 350); }
    else { clearTimeout(dwell); dwell = 0; if (bar.classList.contains("show") && e.clientY > Math.max(band, barBottom) + 24) hideBarSoon(); }
  }, { passive: true });
  document.documentElement.addEventListener("pointerleave", () => { clearTimeout(dwell); dwell = 0; if (bar.classList.contains("show")) hideBarSoon(); });
  // the keyboard way: Alt shows it (like a window's menu bar)
  addEventListener("keydown", (e) => { if (e.key === "Alt" && !e.repeat) { showBar(); hideBarSoon(); } });
  bar.addEventListener("pointerleave", hideBarSoon);
  document.documentElement.addEventListener("pointerleave", hideBarSoon);
  bar.addEventListener("focusin", showBar);
  bar.addEventListener("focusout", hideBarSoon);
  const isMax = () => Boolean(document.fullscreenElement) || (outerWidth >= screen.availWidth - 8 && outerHeight >= screen.availHeight - 8);
  function paintMax() {
    const sz = bar.querySelector('[data-w="size"]'), mini = document.documentElement.classList.contains("mini");
    if (sz) { sz.textContent = mini ? "⤢" : "⤡"; sz.title = mini ? "Expand to the full Dayspring screen" : "Compact: shrink to Dayspring mini"; sz.setAttribute("aria-label", mini ? "Expand" : "Compact"); }
    const b = bar.querySelector('[data-w="max"]'), m = isMax();
    b.textContent = m ? "❐" : "□"; b.title = m ? "Restore down" : "Maximize"; b.setAttribute("aria-label", b.title);
    const f = bar.querySelector('[data-w="full"]'); f.title = document.fullscreenElement ? "Exit full screen (F11)" : "Full screen (F11)"; f.setAttribute("aria-label", f.title);
  }
  addEventListener("resize", paintMax);
  document.addEventListener("fullscreenchange", () => { paintMax(); schedule(); });
  const toggleFull = (on) => {
    const want = on ?? !document.fullscreenElement;
    return (want ? document.documentElement.requestFullscreen?.() : document.exitFullscreen?.())?.catch?.(() => {});
  };
  addEventListener("keydown", (e) => { if (e.key === "F11") { e.preventDefault(); toggleFull(); } }, true);
  const win = (action) => post("/window", { action }).catch(() => ({}));

  function confirmBox({ title, text, go, goClass = "go", cancel = "Cancel", onGo, alt = null }) {
    const d = document.createElement("div");
    d.className = "wconfirm"; d.setAttribute("role", "alertdialog"); d.setAttribute("aria-modal", "true"); d.setAttribute("aria-label", title);
    d.innerHTML = `<div class="wbox"><h3>${title}</h3><p>${text}</p><div class="row"><button data-c="no">${cancel}</button>${alt ? `<button data-c="alt">${alt.label}</button>` : ""}<button data-c="yes" class="${goClass}">${go}</button></div></div>`;
    document.body.appendChild(d);
    const close = () => d.remove();
    d.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b && e.target === d) return close(); if (!b) return; close(); if (b.dataset.c === "yes") onGo(); else if (b.dataset.c === "alt") alt?.onGo(); });
    d.addEventListener("keydown", (e) => { if (e.key === "Escape" && (!e.dsTop || e.dsTop === d)) { e.stopPropagation(); close(); } });
    setTimeout(() => d.querySelector('[data-c="no"]').focus(), 20);
    return d;
  }
  function askExit() {
    return confirmBox({ title: "Close Dayspring's screen?", text: "Alarms and reminders won't sound until you open it again with the Dayspring icon. <b>Quit Dayspring</b> stops it completely.", go: "Close the screen", goClass: "danger", cancel: "Keep open", onGo: () => win("close"), alt: { label: "Quit Dayspring", onGo: () => post("/app/quit", {}).catch(() => {}) } });
  }
  function doHide(explain = true) {
    let seen = false; try { seen = localStorage.getItem("ds-hide-tip") === "1"; } catch { /* no storage */ }
    if (seen || !explain) return win("hide");
    confirmBox({ title: "Hide the Dayspring screen?", text: "It keeps running: voice, alarms and reminders still work. To bring it back, say “Dayspring, show yourself”, or open Start Dayspring.", go: "Hide", onGo: () => { try { localStorage.setItem("ds-hide-tip", "1"); } catch { /* no storage */ } win("hide"); } });
  }
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const a = b.dataset.w;
    if (a === "sound") window.dsSound?.toggle?.();
    else if (a === "state") document.getElementById("stateBtn")?.click();
    else if (a === "size") document.getElementById(document.documentElement.classList.contains("mini") ? "expandBtn" : "compactBtn")?.click();
    else if (a === "fit") openFit();
    else if (a === "full") toggleFull();
    else if (a === "minimize") win("minimize");
    else if (a === "max") { if (document.fullscreenElement) toggleFull(false); win(isMax() ? "restore" : "maximize").then(() => setTimeout(paintMax, 400)); }
    else if (a === "hide") doHide();
    else if (a === "exit") askExit();
  });

  /* ---------------- the screen's size, margins, layout and what's shown (Settings → Screen) ---------------- */
  const root = document.documentElement, body = document.body;
  const OS_URL = (() => { const v = new URLSearchParams(location.search).get("os"); return v !== null && v !== "" && isFinite(v) ? Number(v) : null; })();
  let prefs = {}, lastCal = 0, rowCap = 0;
  const SIDES = { t: "marginTop", b: "marginBottom", l: "marginLeft", r: "marginRight" };
  // each edge's margin in %: its own setting, else the all-sides margin (the ?os= test override wins)
  const sides = (p = prefs) => { const all = OS_URL ?? (typeof p.overscan === "number" ? p.overscan : 5); const o = {}; for (const [k, key] of Object.entries(SIDES)) o[k] = OS_URL !== null ? all : typeof p[key] === "number" ? p[key] : all; return o; };
  function setMargins(m) {
    root.style.setProperty("--st", m.t + "vh"); root.style.setProperty("--sb", m.b + "vh");
    root.style.setProperty("--sl", m.l + "vw"); root.style.setProperty("--sr", m.r + "vw");
    root.style.setProperty("--sx", `max(${m.l}vw, ${m.r}vw)`); root.style.setProperty("--sy", `max(${m.t}vh, ${m.b}vh)`);
  }
  const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
  function applyScreen(p = prefs) {
    if (!fitOpen) setMargins(sides(p));
    root.style.setProperty("--ui", String(num(p.uiScale, 100) / 100));
    root.style.setProperty("--txt", String(num(p.textScale, 100) / 100));
    root.style.setProperty("--clk", String(num(p.clockScale, 100) / 100));
    const tw = typeof p.talkWidth === "number" ? p.talkWidth : null;
    body.classList.toggle("tw", tw !== null); if (tw !== null) root.style.setProperty("--tw", String(tw / 100));
    const lay = p.layoutMode ?? "auto";
    for (const [c, v] of [["lay-two", "two"], ["lay-one", "one"], ["lay-left", "talkLeft"], ["lay-right", "talkRight"], ["lay-compact", "compact"]]) body.classList.toggle(c, lay === v);
    body.classList.toggle("dense", p.density === "compact" || lay === "compact");
    body.classList.toggle("keep", p.fit === "keep");
    body.classList.toggle("calm", p.uiMotion === "reduced");
    const hide = { "hide-clock": p.showClock === false, "hide-nownext": p.showNowNext === false, "hide-panel": p.showPanel === false, "hide-exam": p.showExam === false, "hide-courses": p.showCourses === false, "hide-transcript": p.showTranscript === false };
    for (const [c, on] of Object.entries(hide)) body.classList.toggle(c, on);
    body.classList.toggle("hide-col1", hide["hide-clock"] && hide["hide-nownext"] && hide["hide-panel"]);
    rowCap = num(p.listRows, 0); capRows();
    if (typeof p.calibrateAt === "number" && p.calibrateAt > lastCal) { const fresh = Date.now() - p.calibrateAt < 60_000 && lastCal !== 0; lastCal = p.calibrateAt; if (fresh) openFit(); }
    if (!lastCal) lastCal = num(p.calibrateAt, 1);
    schedule();
  }
  // "show 5 rows": the day list stops after that many (0 = as many as fit)
  function capRows() { $$("#today li").forEach((li, i) => li.classList.toggle("rowcap", rowCap > 0 && i >= rowCap)); }
  const todayEl = $("#today"); if (todayEl) new MutationObserver(capRows).observe(todayEl, { childList: true });
  window.dsScreen = { apply: applyScreen, get: () => prefs, open: () => openFit() };
  fetch("/api/settings").then((r) => r.json()).then((j) => { prefs = j.settings ?? {}; lastCal = num(prefs.calibrateAt, 1); applyScreen(); }).catch(() => {});
  const hook = (es) => es?.addEventListener?.("settings", (e) => { try { prefs = JSON.parse(e.data); applyScreen(); } catch { /* bad event */ } });
  if (window.dsEvents) hook(window.dsEvents); else addEventListener("ds-events", (e) => hook(e.detail), { once: true });
  // the setup page on this screen (an overlay) asks for the calibration directly
  addEventListener("message", (e) => { if (e.data?.type === "dayspring-fit") openFit(); });

  /* ---------------- 📐 Fit to screen: nudge each edge until its bright line is just visible ---------------- */
  let fitOpen = null;
  function openFit() {
    if (fitOpen) return;
    const start = sides(), m = { ...start };
    let sel = "t", msg = "";
    const d = document.createElement("div");
    d.className = "fitcal"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true"); d.setAttribute("aria-label", "Fit to screen"); d.tabIndex = -1;
    const NAME = { t: "Top", b: "Bottom", l: "Left", r: "Right" };
    const clamp = (v) => Math.max(0, Math.min(20, Math.round(v * 2) / 2));
    function draw() {
      // the dialog is redrawn on every change: keep keyboard focus on the same control, so a second Enter presses
      // that button again instead of falling through to "Enter saves"
      const f = document.activeElement, keep = f && d.contains(f) ? (f.dataset.a ? `[data-a="${f.dataset.a}"]` : f.dataset.p ? `[data-p="${f.dataset.p}"]` : null) : null;
      setMargins(m);
      const W = innerWidth, H = innerHeight, t = H * m.t / 100, b = H * m.b / 100, l = W * m.l / 100, r = W * m.r / 100;
      d.innerHTML = `
        <div class="shade" style="left:0;right:0;top:0;height:${t}px"></div><div class="shade" style="left:0;right:0;bottom:0;height:${b}px"></div>
        <div class="shade" style="left:0;width:${l}px;top:${t}px;bottom:${b}px"></div><div class="shade" style="right:0;width:${r}px;top:${t}px;bottom:${b}px"></div>
        <div class="frame" style="left:${l}px;right:${r}px;top:${t}px;bottom:${b}px"></div>
        <i class="corner tl" style="left:${l}px;top:${t}px"></i><i class="corner tr" style="right:${r}px;top:${t}px"></i><i class="corner bl" style="left:${l}px;bottom:${b}px"></i><i class="corner br" style="right:${r}px;bottom:${b}px"></i>
        <div class="edge t${sel === "t" ? " sel" : ""}" data-e="t" style="top:${t}px"><i>▲ Top ${m.t}%</i></div>
        <div class="edge b${sel === "b" ? " sel" : ""}" data-e="b" style="bottom:${b}px"><i>▼ Bottom ${m.b}%</i></div>
        <div class="edge l${sel === "l" ? " sel" : ""}" data-e="l" style="left:${l}px"><i>◀ ${m.l}%</i></div>
        <div class="edge r${sel === "r" ? " sel" : ""}" data-e="r" style="right:${r}px"><i>${m.r}% ▶</i></div>
        <div class="fcbox">
          <h3>📐 Fit to screen</h3>
          <p>Move each edge until its <b>bright green line</b> is just visible on your screen. The pink areas are what your TV may cut off.</p>
          <div class="grid">${Object.entries(NAME).map(([k, n]) => `<b>${n}</b><span class="pair"><button data-a="${k}-" aria-label="${n} edge out">−</button><button data-a="${k}+" aria-label="${n} edge in">+</button></span><output>${m[k]}%</output>`).join("")}
            <b>All edges</b><span class="pair"><button data-a="all-" aria-label="All edges out">−</button><button data-a="all+" aria-label="All edges in">+</button></span><output></output></div>
          <p class="keys">Keys: T B L R pick an edge · arrows move it · Shift for bigger steps · Enter saves · Esc cancels. You can also drag the green lines.</p>
          <div class="presets"><span>Common TV margins:</span>${[0, 2.5, 5, 7.5, 10].map((v) => `<button data-p="${v}">${v}%</button>`).join("")}</div>
          ${msg ? `<p>${msg}</p>` : ""}
          <div class="actions"><button data-a="auto">Auto-fit</button><button data-a="reset">Reset to defaults</button><button data-a="cancel">Cancel</button><button data-a="save" class="go">Save</button></div>
        </div>`;
      if (keep) d.querySelector(keep)?.focus(); else if (f && !document.contains(f)) d.focus();
    }
    const close = () => { d.remove(); fitOpen = null; removeEventListener("keydown", onKey, true); applyScreen(); };
    async function save() {
      const same = m.t === m.b && m.b === m.l && m.l === m.r;
      const patch = same ? { overscan: m.t } : { marginTop: m.t, marginBottom: m.b, marginLeft: m.l, marginRight: m.r };
      try { const r = await post("/settings", patch); prefs = r.settings ?? { ...prefs, ...patch }; } catch { prefs = { ...prefs, ...patch }; }
      close();
    }
    function act(a) {
      if (a === "save") return save();
      if (a === "cancel") { Object.assign(m, start); return close(); }
      if (a === "reset") { const all = typeof prefs.overscan === "number" ? prefs.overscan : 5; for (const k of Object.keys(m)) m[k] = OS_URL ?? all; msg = "Edges back to the all-sides margin."; return draw(); }
      if (a === "auto") { for (const k of Object.keys(m)) m[k] = 0; msg = "All margins are at 0. Can you see all four green lines? If an edge is hidden, tap the smallest preset that shows it: 2.5%, 5%, 7.5% or 10%."; return draw(); }
      const [k, dir] = [a.slice(0, -1), a.slice(-1)], step = dir === "+" ? 0.5 : -0.5;
      if (k === "all") for (const x of Object.keys(m)) m[x] = clamp(m[x] + step); else if (m[k] !== undefined) { m[k] = clamp(m[k] + step); sel = k; }
      draw();
    }
    d.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; if (b.dataset.p) { for (const k of Object.keys(m)) m[k] = Number(b.dataset.p); msg = ""; draw(); } else if (b.dataset.a) act(b.dataset.a); });
    // dragging a green line
    d.addEventListener("pointerdown", (e) => {
      const ed = e.target.closest(".edge"); if (!ed) return;
      const k = ed.dataset.e; sel = k; e.preventDefault();
      const move = (ev) => {
        const W = innerWidth, H = innerHeight;
        const v = k === "t" ? ev.clientY / H : k === "b" ? (H - ev.clientY) / H : k === "l" ? ev.clientX / W : (W - ev.clientX) / W;
        m[k] = clamp(v * 100); draw();
      };
      const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
      addEventListener("pointermove", move); addEventListener("pointerup", up);
    });
    // keys: T/B/L/R pick an edge, arrows move its line, Shift = bigger steps, +/- all edges
    function onKey(e) {
      if (!fitOpen) return;
      const k = e.key.toLowerCase(), big = e.shiftKey ? 2 : 0.5;
      if (e.key === "Escape") { if (e.dsTop && e.dsTop !== d) return; e.preventDefault(); e.stopPropagation(); return act("cancel"); }
      // Enter saves only from the dialog itself (a focused button presses that button instead)
      if (e.key === "Enter" && e.target === d) { e.preventDefault(); return act("save"); }
      if (["t", "b", "l", "r"].includes(k) && !e.ctrlKey && !e.altKey) { sel = k; draw(); e.preventDefault(); return; }
      if (e.key === "+" || e.key === "=") { for (const x of Object.keys(m)) m[x] = clamp(m[x] + 0.5); draw(); e.preventDefault(); return; }
      if (e.key === "-") { for (const x of Object.keys(m)) m[x] = clamp(m[x] - 0.5); draw(); e.preventDefault(); return; }
      const dirs = { ArrowUp: { t: -1, b: 1 }, ArrowDown: { t: 1, b: -1 }, ArrowLeft: { l: -1, r: 1 }, ArrowRight: { l: 1, r: -1 } }[e.key];
      if (dirs && dirs[sel] !== undefined) { m[sel] = clamp(m[sel] + dirs[sel] * big); draw(); e.preventDefault(); e.stopPropagation(); }
    }
    addEventListener("keydown", onKey, true);
    fitOpen = d; document.body.appendChild(d); draw(); d.focus();
  }

  /* ---------------- said or typed on the display ---------------- */
  (window.dsLocal ??= []).push((t) => {
    const W = "(?: (?:dayspring|yourself|the (?:screen|window|display|app)|your (?:screen|window)))?";
    if (/^(go |make it |enter )?full ?screen$/.test(t)) { toggleFull(true); return "Full screen."; }
    if (/^(exit|leave|close|get out of) (the )?full ?screen$/.test(t)) { toggleFull(false); return "Okay."; }
    if (new RegExp(`^minimi[sz]e${W}$`).test(t)) { win("minimize"); return "Minimized."; }
    if (new RegExp(`^maximi[sz]e${W}$`).test(t)) { win("maximize"); return "Maximized."; }
    if (/^restore( the)? (window|screen|size)$|^(un ?maximi[sz]e|restore down)$/.test(t)) { win("restore"); return "Done."; }
    if (new RegExp(`^hide${W}$`).test(t) && !/notification|pop ?up|alert/.test(t)) { setTimeout(() => doHide(false), 2500); return "Hiding the screen. Say “Dayspring, show yourself” to bring it back."; }
    if (/^(show yourself|show the screen|come back|unhide( yourself)?)$/.test(t)) { win("show"); return "I'm right here."; }
    if (/^(close|exit|quit)( the)? (screen|display|window)$|^close dayspring$/.test(t)) { askExit(); return "Close the screen? Press Close to confirm."; }
    if (/^(fit (it |everything )?to (the )?(screen|tv)|calibrate (the )?(screen|tv|display)|fit to screen)$/.test(t)) { openFit(); return "Move each edge until its bright line is just visible, then press Save."; }
    return null;
  });
})();
