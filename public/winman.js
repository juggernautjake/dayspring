// The window manager: every floating window and panel on the Dayspring screen can be
//   max     big: it fills the screen's safe area (inside the TV margins)
//   normal  its own usual size and place
//   small   a window you can drag anywhere (by its title bar, or the picture for a video), that snaps to an edge or corner
//           when let go within 24 px of it, resizes from its corner handle, and always stays inside the safe area
//   min     minimised: a chip in the dock along the bottom (title and icon); click the chip to bring it back
//   closed  its own close
// Media windows add audio only (the video player: its "min" is audio only, and the mini player card is its chip).
// Positions and sizes are remembered per window and per screen size; the last mode per window too.
//
//   const w = winman.register(id, el, opts)      → { setMode(m), mode(), place(where), resizeBy(k), update(opts), unregister() }
//   opts: title, icon, aliases (words for voice: ["map", "maps"]), modes (default all), bar (the title bar: element or
//         selector, the drag handle; the mode buttons go in it), dragBody (drag by the whole window, a click is still a
//         click), aspect (width / height when small, e.g. 16/9), minW, minH, defaultSmall(S) → { x, y, w, h },
//         custom (the window styles its own max / normal / min; winman places it only when small), apply(mode, prev),
//         onClose(), isOpen(), chip (a dock chip when minimised; default true), buttons (the – ❐ ▢ buttons; default true),
//         hide (selectors of the window's own buttons that winman's replace), grip (a selector: the window's own resize handle)
//   winman.setMode(id, mode) · place(id, where) · resizeBy(id, k) · minimizeAll() · restoreAll() · list() · get(id)
// Keys: with a window focused, Alt+↑ maximise (again: back to normal), Alt+↓ minimise, Alt+S small window (again:
// normal); when a small window itself has the focus, the arrows move it and Shift+arrows resize it. Alt+Shift+↓
// minimises everything, Alt+Shift+↑ brings it all back. Voice: lib/winman.mjs (public/view-words.js dsWindowWords).
// The dock sits along the bottom of the safe area, to the left of the mini player card, and never covers it.
(() => {
  if (window.winman) return;
  const MODES = ["max", "normal", "small", "min"];
  const GAP = 12, SNAP = 24, STEP = 24;
  const W = new Map();
  let topSeq = 0, lastActive = null, reportT = 0, sse = false;
  const store = { get(k) { try { return JSON.parse(localStorage.getItem(k) ?? "null"); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } } };
  const css = document.createElement("style");
  css.textContent = `
  .wm-min{display:none!important}
  .wm-small{z-index:14!important;margin:0!important;transform:none!important;max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important}
  .wm-small.wm-top{z-index:15!important}
  .wm-max{margin:0!important;transform:none!important;max-width:none!important;max-height:none!important}
  .wm-dragging,.wm-dragging *{transition:none!important;user-select:none!important}
  .wm-small.wm-dragbody{touch-action:none}
  .wm-small:focus{outline:2px solid rgba(185,195,255,.8);outline-offset:2px}
  .wm-resize{position:absolute;z-index:6;width:22px;height:22px;touch-action:none;display:none;
    background:radial-gradient(circle at 50% 50%,rgba(255,255,255,.95) 0 2px,transparent 2.5px) 0 0/7px 7px;opacity:.75;border-radius:4px}
  .wm-small > .wm-resize{display:block}
  .wm-resize[data-at="br"]{right:2px;bottom:2px;cursor:nwse-resize}.wm-resize[data-at="tl"]{left:2px;top:2px;cursor:nwse-resize}
  .wm-resize[data-at="bl"]{left:2px;bottom:2px;cursor:nesw-resize}.wm-resize[data-at="tr"]{right:2px;top:2px;cursor:nesw-resize}
  .wm-btns{display:inline-flex;gap:.25em;align-items:center;flex:0 0 auto}
  .wm-btns.wm-over{position:absolute;top:.45em;right:3.2em;z-index:7}
  .wm-btns button{font:inherit;font-size:.85em;line-height:1;width:2em;height:2em;border-radius:.55em;border:1px solid rgba(255,255,255,.18);background:rgba(10,12,30,.6);color:#eef0ff;cursor:pointer;display:grid;place-items:center;padding:0}
  .wm-btns button:hover,.wm-btns button:focus-visible{background:rgba(124,140,255,.45);outline:none}
  .wm-btns button[aria-pressed="true"]{background:rgba(124,140,255,.35);border-color:rgba(185,195,255,.6)}
  #wmDock{position:fixed;z-index:15;display:flex;gap:.4em;align-items:center;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin;pointer-events:none}
  #wmDock[hidden]{display:none}
  #wmDock .wm-chip{pointer-events:auto;display:inline-flex;align-items:center;gap:.4em;max-width:16em;flex:0 0 auto;padding:.35em .55em .35em .7em;border-radius:1em;border:1px solid rgba(170,180,255,.35);
    background:rgba(20,24,56,.92);backdrop-filter:blur(12px);color:#eef0ff;font:inherit;font-size:.85em;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.45)}
  #wmDock .wm-chip:hover,#wmDock .wm-chip:focus-visible{background:rgba(60,70,140,.95);outline:none}
  #wmDock .wm-chip b{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  #wmDock .wm-chip .x{margin-left:.15em;width:1.5em;height:1.5em;border-radius:50%;display:grid;place-items:center;color:rgba(230,233,255,.7)}
  #wmDock .wm-chip .x:hover{background:rgba(220,70,110,.8);color:#fff}
  @media (prefers-reduced-motion: reduce){.wm-small{transition:none!important}}`;
  document.head.appendChild(css);
  const dock = document.createElement("div"); dock.id = "wmDock"; dock.setAttribute("role", "toolbar"); dock.setAttribute("aria-label", "Minimised windows"); dock.hidden = true;
  const addDock = () => { if (!dock.isConnected && document.body) document.body.appendChild(dock); };
  if (document.body) addDock(); else addEventListener("DOMContentLoaded", addDock, { once: true });

  // ---- the safe area (inside the TV margins; layout.js measures it) ----------------------------------------------------
  function safe() {
    const r = window.dsSafeRect?.();
    return r && r.width > 0 ? r : { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight };
  }
  const sizeKey = () => `${innerWidth}x${innerHeight}`;
  const resolve = (x, el) => (typeof x === "string" ? el.querySelector(x) : typeof x === "function" ? x(el) : x) ?? null;
  // open: the window's own answer, or it's in the page and not hidden (a minimised one is hidden by winman, and still open)
  // (isOpen(rec) is given the record: rec.minHidden is true while winman keeps it hidden in the dock)
  const isOpenRec = (r) => (r.o.isOpen ? Boolean(r.o.isOpen(r)) : r.el.isConnected && (!r.el.hidden || r.minHidden));

  // ---- a small window's size and place ----------------------------------------------------------------------------------
  function limits(r, S = safe()) {
    const aw = Math.max(80, S.width - 2 * GAP), ah = Math.max(60, S.height - 2 * GAP);
    let maxW = aw, maxH = ah;
    if (r.o.aspect) { maxW = Math.min(aw, ah * r.o.aspect); maxH = maxW / r.o.aspect; }
    const minW = Math.min(maxW, r.o.minW ?? 260), minH = Math.min(maxH, r.o.aspect ? minW / r.o.aspect : r.o.minH ?? 180);
    return { minW, minH, maxW, maxH };
  }
  function clamp(r, g, S = safe()) {
    const L = limits(r, S);
    let w = Math.max(L.minW, Math.min(L.maxW, g.w));
    let h = r.o.aspect ? w / r.o.aspect : Math.max(L.minH, Math.min(L.maxH, g.h ?? w * 0.7));
    if (r.o.aspect && h > L.maxH) { h = L.maxH; w = h * r.o.aspect; }
    const x = Math.max(S.left + GAP, Math.min(S.right - GAP - w, g.x));
    const y = Math.max(S.top + GAP, Math.min(S.bottom - GAP - h, g.y));
    return { x, y, w, h };
  }
  function snap(g, S = safe()) {
    const L = S.left + GAP, R = S.right - GAP, T = S.top + GAP, B = S.bottom - GAP;
    const out = { ...g };
    if (Math.abs(g.x - L) <= SNAP) out.x = L; else if (Math.abs(R - (g.x + g.w)) <= SNAP) out.x = R - g.w;
    if (Math.abs(g.y - T) <= SNAP) out.y = T; else if (Math.abs(B - (g.y + g.h)) <= SNAP) out.y = B - g.h;
    return out;
  }
  function defaultSmall(r, S = safe()) {
    if (r.o.defaultSmall) { const d = r.o.defaultSmall(S); if (d) return d; }
    const w = S.width * 0.42, h = r.o.aspect ? w / r.o.aspect : S.height * 0.55;
    return { x: S.right - GAP - w, y: S.top + (S.height - h) / 2, w, h };
  }
  const rectKey = (r) => `ds-wm-rect-${r.id}-${sizeKey()}`;
  const loadRect = (r) => { const g = store.get(rectKey(r)); return g && [g.x, g.y, g.w].every(Number.isFinite) ? g : null; };
  const saveRect = (r, g) => store.set(rectKey(r), { x: Math.round(g.x), y: Math.round(g.y), w: Math.round(g.w), h: Math.round(g.h) });
  const PROPS = ["left", "top", "width", "height", "right", "bottom", "inset"];
  function clearGeom(r) { for (const k of PROPS) r.el.style[k] = ""; r.el.classList.remove("wm-small", "wm-max", "wm-top", "wm-dragbody"); r.el.removeAttribute("data-wm-grip"); }
  function setGeom(r, g, { save = false } = {}) {
    const S = safe(); g = clamp(r, g, S); r.g = g;
    Object.assign(r.el.style, { inset: "auto", left: g.x + "px", top: g.y + "px", width: g.w + "px", height: g.h + "px", right: "auto", bottom: "auto" });
    // the resize handle is on the corner facing the middle of the screen (the window grows toward the room there is)
    const at = (g.y + g.h / 2 < (S.top + S.bottom) / 2 ? "b" : "t") + (g.x + g.w / 2 < (S.left + S.right) / 2 ? "r" : "l");
    r.el.dataset.wmGrip = at; const h = r.el.querySelector(":scope > .wm-resize"); if (h) h.dataset.at = at;
    if (save) saveRect(r, g);
    return g;
  }
  function fillSafe(r) {
    const S = safe();
    Object.assign(r.el.style, { inset: "auto", left: S.left + GAP + "px", top: S.top + GAP + "px", width: S.width - 2 * GAP + "px", height: S.height - 2 * GAP + "px", right: "auto", bottom: "auto" });
  }

  // ---- modes ------------------------------------------------------------------------------------------------------------
  function setMode(id, mode, { user = true, quiet = false, geom = null } = {}) {
    const r = W.get(id); if (!r) return false;
    if (mode === "restore") mode = r.mode === "min" || r.mode === "closed" ? r.prev || "normal" : "normal";
    if (mode === "close") { r.mode = "closed"; if (r.minHidden) { r.minHidden = false; } r.el.classList.remove("wm-min"); r.o.onClose?.(); if (!r.o.custom) clearGeom(r); paintDock(); report(); return true; }
    if (!MODES.includes(mode) || (r.o.modes && !r.o.modes.includes(mode))) return false;
    const prev = r.mode;
    if (prev !== "min" && prev !== "closed" && mode === "min") r.prev = prev;
    if (mode !== "min") r.prev = mode;
    r.mode = mode;
    // minimised: hidden (the window's own "show" brings it straight back: see watch()), with a chip in the dock
    r.el.classList.toggle("wm-min", mode === "min" && !r.o.custom);
    if (mode === "min" && !r.o.custom) { if (!r.el.hidden) { r.minHidden = true; r.el.hidden = true; } }
    else if (r.minHidden) { r.minHidden = false; r.el.hidden = false; }
    if (r.o.custom) { r.el.classList.remove("wm-max"); if (mode !== "small") clearGeom(r); }
    else if (mode === "normal") clearGeom(r);
    else if (mode === "max") { clearGeom(r); r.el.classList.add("wm-max"); fillSafe(r); }
    if (mode === "small") { r.el.classList.add("wm-small"); r.el.classList.toggle("wm-dragbody", Boolean(r.o.dragBody)); ensureChrome(r); setGeom(r, geom ?? loadRect(r) ?? r.g ?? defaultSmall(r), { save: Boolean(geom) }); r.el.tabIndex = 0; if (prev !== "small") raise(r); }
    else if (r.tab0 == null) r.el.removeAttribute("tabindex"); else r.el.setAttribute("tabindex", r.tab0);
    try { r.o.apply?.(mode, prev); } catch (e) { console.warn("winman apply", e); }
    if (user && mode !== "min" && r.o.remember !== false) store.set(`ds-wm-mode-${id}`, mode);
    paintButtons(r); paintDock(); if (!quiet) report();
    if (mode !== "min") lastActive = id;
    return true;
  }
  function place(id, where) {
    const r = W.get(id); if (!r) return false;
    if (r.mode !== "small") setMode(id, "small");
    const S = safe(), g = r.g ?? clamp(r, defaultSmall(r));
    const L = S.left + GAP, R = S.right - GAP, T = S.top + GAP, B = S.bottom - GAP;
    let { x, y } = g;
    if (where === "c") { x = (S.left + S.right - g.w) / 2; y = (S.top + S.bottom - g.h) / 2; }
    if (where.includes("l")) x = L; if (where.includes("r")) x = R - g.w;
    if (where.includes("t")) y = T; if (where.includes("b")) y = B - g.h;
    setGeom(r, { ...g, x, y }, { save: true }); report();
    return true;
  }
  // bigger or smaller, keeping the edges it's pinned to (or its middle)
  function resizeBy(id, k) {
    const r = W.get(id); if (!r) return false;
    if (r.mode !== "small") setMode(id, "small");
    const S = safe(), g = r.g ?? clamp(r, defaultSmall(r)), L = limits(r, S);
    const w = Math.max(L.minW, Math.min(L.maxW, g.w * k)), h = r.o.aspect ? w / r.o.aspect : Math.max(L.minH, Math.min(L.maxH, g.h * k));
    const Rr = S.right - GAP, Bb = S.bottom - GAP;
    const x = Math.abs(Rr - (g.x + g.w)) < 3 ? Rr - w : Math.abs(g.x - (S.left + GAP)) < 3 ? g.x : g.x + (g.w - w) / 2;
    const y = Math.abs(Bb - (g.y + g.h)) < 3 ? Bb - h : Math.abs(g.y - (S.top + GAP)) < 3 ? g.y : g.y + (g.h - h) / 2;
    setGeom(r, { x, y, w, h }, { save: true }); report();
    return true;
  }
  function minimizeAll() { const hit = []; for (const r of W.values()) if (isOpenRec(r) && r.mode !== "min" && r.mode !== "closed" && (!r.o.modes || r.o.modes.includes("min"))) { r.allMin = true; setMode(r.id, "min", { quiet: true }); hit.push(r.id); } report(); return hit; }
  function restoreAll() { const hit = []; for (const r of W.values()) if (r.mode === "min" && isOpenRec(r)) { r.allMin = false; setMode(r.id, "restore", { quiet: true }); hit.push(r.id); } report(); return hit; }

  // ---- the – ❐ ▢ buttons, the resize handle ------------------------------------------------------------------------------
  function ensureChrome(r) {
    if (r.o.buttons !== false && !r.el.querySelector(".wm-btns")) {
      const b = document.createElement("span"); b.className = "wm-btns"; b.setAttribute("role", "group"); b.setAttribute("aria-label", "Window");
      // (a window whose own – and ▢ are routed to winman gets just ❐ next to them)
      const has = (k) => !r.o.route || !Object.values(r.o.route).includes(k);
      b.innerHTML = `${has("min") ? '<button type="button" data-wm="min" title="Minimise (Alt+↓)" aria-label="Minimise">–</button>' : ""}<button type="button" data-wm="small" title="Small window (Alt+S)" aria-label="Small window" aria-pressed="false">❐</button>${has("max") ? '<button type="button" data-wm="max" title="Maximise (Alt+↑)" aria-label="Maximise" aria-pressed="false">▢</button>' : ""}${r.o.closeButton ? '<button type="button" data-wm="close" title="Close" aria-label="Close">✕</button>' : ""}`;
      const bar = resolve(r.o.bar, r.el);
      const own = bar && r.o.before ? bar.querySelector(r.o.before) : null;
      if (own) own.parentNode.insertBefore(b, own); else if (bar) bar.appendChild(b); else { b.classList.add("wm-over"); r.el.appendChild(b); }
      paintButtons(r);
    }
    if (!r.el.querySelector(":scope > .wm-resize")) { const h = document.createElement("div"); h.className = "wm-resize"; h.setAttribute("aria-hidden", "true"); h.dataset.at = r.el.dataset.wmGrip ?? "tl"; r.el.appendChild(h); }
    for (const sel of r.o.hide ?? []) for (const x of r.el.querySelectorAll(sel)) x.style.display = "none";
  }
  function paintButtons(r) {
    const b = r.el.querySelector(".wm-btns"); if (!b) return;
    const s = b.querySelector('[data-wm="small"]'), m = b.querySelector('[data-wm="max"]');
    if (s) { s.setAttribute("aria-pressed", String(r.mode === "small")); s.title = r.mode === "small" ? "Back to normal size (Alt+S)" : "Small window (Alt+S)"; }
    if (m) { m.setAttribute("aria-pressed", String(r.mode === "max")); m.title = r.mode === "max" ? "Back to normal size (Alt+↑)" : "Maximise (Alt+↑)"; }
  }
  document.addEventListener("click", (e) => {
    const el0 = e.target.closest?.("[data-wm-id]"), r0 = el0 && W.get(el0.dataset.wmId);
    // a window's own – and ▢ (opts.route: { selector: "min" | "max" }) do winman's minimise and big, so every window
    // minimises into the same dock
    if (r0?.o.route) for (const [sel, act] of Object.entries(r0.o.route)) if (e.target.closest(sel) && el0.contains(e.target.closest(sel))) {
      e.preventDefault(); e.stopImmediatePropagation();
      setMode(r0.id, act === "max" ? (r0.mode === "max" ? "normal" : "max") : act);
      return;
    }
    const b = e.target.closest?.(".wm-btns [data-wm]"); if (!b) return;
    const el = b.closest("[data-wm-id]"), r = el && W.get(el.dataset.wmId); if (!r) return;
    e.preventDefault(); e.stopPropagation();
    const a = b.dataset.wm;
    if (a === "small") setMode(r.id, r.mode === "small" ? "normal" : "small");
    else if (a === "max") setMode(r.id, r.mode === "max" ? "normal" : "max");
    else setMode(r.id, a);
  }, true);

  // ---- dragging and resizing (mouse, touch and pen) ----------------------------------------------------------------------
  let drag = null, dragEndAt = 0;
  document.addEventListener("pointerdown", (e) => {
    dragEndAt = 0;                                   // (a new press: the click after it is a real one)
    if (e.button > 0) return;
    const el = e.target.closest?.("[data-wm-id]"), r = el && W.get(el.dataset.wmId); if (!r) return;
    lastActive = r.id; raise(r);
    const grip = e.target.closest(".wm-resize") || (r.o.grip && e.target.closest(r.o.grip));
    const bar = resolve(r.o.bar, r.el);
    const busy = e.target.closest("button, input, select, textarea, a, label, [role=tab], [contenteditable], .pvol, .wm-btns");
    const onBar = Boolean(bar && bar.contains(e.target) && !busy);
    let from = null;
    if (r.mode === "small") { if (!grip && !onBar && (!r.o.dragBody || busy)) return; }
    else if (!r.o.custom && isOpenRec(r) && (grip || onBar) && r.mode !== "min") from = r.mode;   // pulling a big or normal window by its title bar makes it a small one
    else return;
    const g = from ? (() => { const s = clamp(r, loadRect(r) ?? defaultSmall(r)); return { ...s, x: e.clientX - s.w / 2, y: e.clientY - 18 }; })() : { ...(r.g ?? setGeom(r, defaultSmall(r))) };
    drag = { r, id: e.pointerId, sx: e.clientX, sy: e.clientY, g, from, resize: Boolean(grip) && !from, moved: false, at: r.el.dataset.wmGrip ?? "tl" };
    if (grip && !from) { drag.moved = true; r.el.classList.add("wm-dragging"); try { r.el.setPointerCapture(e.pointerId); } catch { /* fine */ } }
    if (grip || onBar) { e.stopPropagation(); e.preventDefault(); }      // (the window's own dragging stays out of it)
  }, true);
  addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { r } = drag, dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 6) return;
      drag.moved = true; r.el.classList.add("wm-dragging"); try { r.el.setPointerCapture(drag.id); } catch { /* fine */ }
      if (drag.from) setMode(r.id, "small", { geom: drag.g });
    }
    e.preventDefault();
    if (drag.resize) {
      const sx = drag.at.includes("r") ? 1 : -1, sy = drag.at.includes("b") ? 1 : -1, L = limits(r);
      let w = drag.g.w + sx * dx, h = drag.g.h + sy * dy;
      if (r.o.aspect) { w = Math.max(w, h * r.o.aspect); h = w / r.o.aspect; }
      w = Math.max(L.minW, Math.min(L.maxW, w)); h = r.o.aspect ? w / r.o.aspect : Math.max(L.minH, Math.min(L.maxH, h));
      setGeom(r, { x: sx > 0 ? drag.g.x : drag.g.x + drag.g.w - w, y: sy > 0 ? drag.g.y : drag.g.y + drag.g.h - h, w, h });
    } else setGeom(r, { ...drag.g, x: drag.g.x + dx, y: drag.g.y + dy });
  }, { passive: false });
  const endDrag = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const d = drag; drag = null;
    if (!d.moved) { d.r.el.classList.remove("wm-dragging"); return; }
    dragEndAt = Date.now();
    setGeom(d.r, d.resize ? d.r.g : snap(d.r.g), { save: true }); report();
    d.r.el.getBoundingClientRect();                  // (the snap lands at once: no glide from where it was let go)
    d.r.el.classList.remove("wm-dragging");
  };
  addEventListener("pointerup", endDrag); addEventListener("pointercancel", endDrag);
  // a drag isn't a click (a video's picture plays and pauses on a click)
  document.addEventListener("click", (e) => { if (Date.now() - dragEndAt < 300 && e.target.closest?.("[data-wm-id]")) { e.stopPropagation(); e.preventDefault(); } }, true);
  document.addEventListener("dblclick", (e) => {
    const el = e.target.closest?.("[data-wm-id]"), r = el && W.get(el.dataset.wmId); if (!r || r.o.custom) return;
    const bar = resolve(r.o.bar, r.el); if (!bar || !bar.contains(e.target) || e.target.closest("button, input, select, textarea")) return;
    e.stopPropagation(); e.preventDefault(); setMode(r.id, r.mode === "max" ? "normal" : "max");
  }, true);
  function raise(r) { if (r.mode !== "small") return; for (const x of W.values()) x.el.classList.toggle("wm-top", x === r); r.top = ++topSeq; }

  // ---- keys -----------------------------------------------------------------------------------------------------------------
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey) return;
    const el = document.activeElement?.closest?.("[data-wm-id]"), r = el ? W.get(el.dataset.wmId) : W.get(lastActive);
    if (e.altKey && e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) { if (e.key === "ArrowDown") minimizeAll(); else restoreAll(); e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (!r || !isOpenRec(r)) return;
    if (e.altKey && !e.shiftKey) {
      const k = e.key.toLowerCase();
      if (e.key === "ArrowUp") setMode(r.id, r.mode === "max" ? "normal" : "max");
      else if (e.key === "ArrowDown") setMode(r.id, "min");
      else if (k === "s") setMode(r.id, r.mode === "small" ? "normal" : "small");
      else return;
      e.preventDefault(); e.stopImmediatePropagation(); return;
    }
    // the small window itself has the focus: arrows move it, Shift+arrows resize it
    if (r.mode === "small" && document.activeElement === r.el && /^Arrow/.test(e.key) && !e.altKey) {
      const g = r.g ?? setGeom(r, defaultSmall(r));
      if (e.shiftKey) { const grow = e.key === "ArrowUp" || e.key === "ArrowRight"; resizeBy(r.id, (g.w + (grow ? STEP : -STEP)) / g.w); }
      else { const dx = e.key === "ArrowLeft" ? -STEP : e.key === "ArrowRight" ? STEP : 0, dy = e.key === "ArrowUp" ? -STEP : e.key === "ArrowDown" ? STEP : 0; setGeom(r, { ...g, x: g.x + dx, y: g.y + dy }, { save: true }); report(); }
      e.preventDefault(); e.stopImmediatePropagation();
    }
  }, true);

  // ---- the dock: a chip per minimised window, along the bottom, left of the mini player card --------------------------------
  function paintDock() {
    addDock();
    const mins = [...W.values()].filter((r) => r.mode === "min" && r.o.chip !== false && isOpenRec(r));
    dock.hidden = !mins.length;
    const have = new Map([...dock.children].map((c) => [c.dataset.id, c]));
    for (const r of mins) {
      let c = have.get(r.id);
      if (!c) { c = document.createElement("button"); c.type = "button"; c.className = "wm-chip"; c.dataset.id = r.id; dock.appendChild(c); }
      const t = typeof r.o.title === "function" ? r.o.title() : r.o.title ?? r.id;
      const html = `<span aria-hidden="true">${esc(r.o.icon ?? "▣")}</span><b>${esc(t)}</b>${r.o.onClose ? '<span class="x" data-close="1" title="Close" aria-label="Close">✕</span>' : ""}`;
      if (c.dataset.html !== html) { c.innerHTML = html; c.dataset.html = html; c.title = `Bring back ${t}`; c.setAttribute("aria-label", `${t}: bring it back`); }
      have.delete(r.id);
    }
    for (const c of have.values()) c.remove();
    placeDock();
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function placeDock() {
    if (dock.hidden) return;
    const S = safe();
    let right = S.right - GAP, left = S.left + GAP;
    const np = document.getElementById("np");
    if (np && !np.hidden && np.offsetWidth) { const c = np.getBoundingClientRect(); if (c.bottom > S.bottom - 90 && c.left < right) right = Math.max(S.left + GAP + 120, c.left - GAP); }
    // (the XP badge sits in the bottom-left corner: the dock starts just after it)
    for (const b of document.querySelectorAll(".xp-badge")) { if (b.hidden || !b.offsetWidth) continue; const c = b.getBoundingClientRect(); if (c.bottom > S.bottom - 70 && c.left < S.left + 200) left = Math.max(left, c.right + GAP); }
    Object.assign(dock.style, { left: left + "px", bottom: innerHeight - S.bottom + GAP + "px", maxWidth: Math.max(120, right - left) + "px" });
  }
  dock.addEventListener("click", (e) => {
    const c = e.target.closest(".wm-chip"); if (!c) return;
    if (e.target.closest("[data-close]")) { setMode(c.dataset.id, "close"); return; }
    setMode(c.dataset.id, "restore");
  });

  // ---- open, closed, the screen changing size -----------------------------------------------------------------------------
  function sync() {
    let changed = false;
    for (const r of [...W.values()]) {
      if (!r.el.isConnected && !r.o.isOpen) { W.delete(r.id); changed = true; continue; }
      const open = isOpenRec(r);
      if (!open && r.mode !== "closed") { r.el.classList.remove("wm-min"); r.minHidden = false; r.mode = "closed"; changed = true; }
      else if (open && r.mode === "closed") { r.mode = "normal"; const m = store.get(`ds-wm-mode-${r.id}`); if (m && m !== "normal" && r.o.remember !== false && !r.o.custom) setMode(r.id, m, { user: false, quiet: true }); changed = true; }
      if (open && r.mode === "small" && r.el.isConnected) { ensureChrome(r); }
    }
    if (changed) { paintDock(); report(); }
  }
  setInterval(sync, 700);
  // the margins or the window changed: every small or big window goes back inside (its place for this size, if it has one)
  function refit() {
    for (const r of W.values()) {
      if (r.mode === "small") setGeom(r, loadRect(r) ?? r.g ?? defaultSmall(r));
      else if (r.mode === "max" && !r.o.custom) fillSafe(r);
    }
    placeDock();
  }
  let refitT = 0; const refitSoon = () => { cancelAnimationFrame(refitT); refitT = requestAnimationFrame(refit); };
  addEventListener("resize", refitSoon);
  new MutationObserver(refitSoon).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
  const watchProbe = () => { const p = document.getElementById("dsSafeArea"); if (p) new ResizeObserver(refitSoon).observe(p); else setTimeout(watchProbe, 1000); };
  watchProbe();

  // A window that places itself (the viewer, a panel's own float) or shows itself again: a small or big window keeps the
  // place winman gave it; a minimised window that its own code shows again (opened again by voice, say) comes back.
  function watch(r) {
    r.mo?.disconnect();
    r.mo = new MutationObserver(() => {
      if (!W.has(r.id) || W.get(r.id) !== r) return;
      if (r.mode === "min" && !r.o.custom && r.minHidden && !r.el.hidden) { r.minHidden = false; setMode(r.id, r.prev && r.prev !== "min" ? r.prev : "normal"); return; }
      const px = (v) => parseFloat(v);
      if (r.mode === "small" && r.g && (Math.abs(px(r.el.style.left) - r.g.x) > 0.5 || Math.abs(px(r.el.style.top) - r.g.y) > 0.5 || Math.abs(px(r.el.style.width) - r.g.w) > 0.5 || Math.abs(px(r.el.style.height) - r.g.h) > 0.5)) setGeom(r, r.g);
      else if (r.mode === "max" && !r.o.custom) { const S = safe(); if (Math.abs(px(r.el.style.left) - (S.left + GAP)) > 0.5 || Math.abs(px(r.el.style.width) - (S.width - 2 * GAP)) > 0.5) fillSafe(r); }
      if (r.o.stripClass && r.mode !== "closed") for (const c of [].concat(r.o.stripClass)) if (r.el.classList.contains(c)) r.el.classList.remove(c);
    });
    r.mo.observe(r.el, { attributes: true, attributeFilter: ["style", "hidden", "class"] });
  }

  // ---- register --------------------------------------------------------------------------------------------------------------
  function register(id, el, o = {}) {
    if (!id || !el) return null;
    const old = W.get(id);
    if (old && old.el !== el) { clearGeom(old); old.el.classList.remove("wm-min"); delete old.el.dataset.wmId; }
    const r = old && old.el === el ? Object.assign(old, { o: { ...old.o, ...o } }) : { id, el, o, mode: "closed", prev: "normal", g: null, tab0: el.getAttribute("tabindex") };
    W.set(id, r);
    el.dataset.wmId = id;
    watch(r);
    // (a panel's own floating place, from before winman: winman places it now)
    if (o.stripClass && [].concat(o.stripClass).some((c) => el.classList.contains(c))) { for (const c of [].concat(o.stripClass)) el.classList.remove(c); if (r.mode !== "small" && r.mode !== "max") clearGeom(r); }
    if (!old || old.el !== el) {
      r.mode = isOpenRec(r) ? "normal" : "closed";
      // (an open window starts the way it was last time: small or big)
      const m = store.get(`ds-wm-mode-${id}`);
      if (r.mode === "normal" && m && m !== "normal" && o.remember !== false && !o.custom) setMode(id, m, { user: false, quiet: true });
    }
    if (r.o.buttons !== false) ensureChrome(r);
    report();
    return { setMode: (m, opt) => setMode(id, m, opt), mode: () => W.get(id)?.mode ?? null, place: (w) => place(id, w), resizeBy: (k) => resizeBy(id, k), update: (x) => { Object.assign(r.o, x); paintDock(); report(); }, unregister: () => unregister(id), rect: () => r.g, el };
  }
  function unregister(id) { const r = W.get(id); if (!r) return; clearGeom(r); r.el.classList.remove("wm-min"); delete r.el.dataset.wmId; r.el.querySelector(".wm-btns")?.remove(); r.el.querySelector(":scope > .wm-resize")?.remove(); W.delete(id); paintDock(); report(); }
  function list() {
    return [...W.values()].map((r) => ({ id: r.id, title: typeof r.o.title === "function" ? r.o.title() : r.o.title ?? r.id, icon: r.o.icon ?? "", mode: isOpenRec(r) ? r.mode : "closed", open: isOpenRec(r),
      aliases: typeof r.o.aliases === "function" ? r.o.aliases() : r.o.aliases ?? [], rect: r.mode === "small" && r.g ? { x: Math.round(r.g.x), y: Math.round(r.g.y), w: Math.round(r.g.w), h: Math.round(r.g.h) } : null }));
  }

  // ---- the server: what's open (for voice), and voice commands for these windows (lib/winman.mjs) -------------------------
  function report() {
    clearTimeout(reportT);
    reportT = setTimeout(() => { fetch("/api/winman/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ page: window.dsPageId ?? "", windows: list() }) }).catch(() => {}); }, 250);
  }
  function command(c) {
    if (!c || window.dsIsSpeaker === false && c.speakerOnly) return;
    if (c.op === "minAll") return minimizeAll();
    if (c.op === "restoreAll") return restoreAll();
    if (!W.has(c.id)) return;
    if (c.op === "mode") return setMode(c.id, c.value);
    if (c.op === "place") return place(c.id, c.value);
    if (c.op === "resize") { const r = W.get(c.id); if (r.mode !== "small") return setMode(c.id, c.value === "smaller" ? (r.mode === "max" ? "normal" : "small") : "max"); return resizeBy(c.id, c.value === "smaller" ? 0.8 : 1.25); }
  }
  const attach = (es) => { if (sse) return; sse = true; es.addEventListener("winman", (e) => { try { command(JSON.parse(e.data)); } catch { /* bad event */ } }); };
  if (window.dsEvents) attach(window.dsEvents); else addEventListener("ds-events", (e) => attach(e.detail), { once: true });

  window.winman = { register, unregister, setMode, place, resizeBy, minimizeAll, restoreAll, list, command, get: (id) => W.get(id) ?? null, safe, snap, clamp: (id, g) => { const r = W.get(id); return r ? clamp(r, g) : g; }, _limits: (id) => limits(W.get(id)), GAP, SNAP };
})();
