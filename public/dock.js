/* The assistant panel's window behaviour: drag, resize, dock, minimize. Position and size are
   remembered per browser. Nothing here touches the schedule or the chat; app.js owns those. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const dock = $("#dock"), head = $("#dockHead"), grip = $("#grip"), edge = $("#edgegrip");
  const KEY = "ds.dock";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
  const save = (patch) => { try { localStorage.setItem(KEY, JSON.stringify({ ...load(), ...patch })); } catch {} };
  const mode = () => (document.body.classList.contains("docked") ? "docked" : "floating");
  const setMode = (m) => {
    document.body.classList.toggle("docked", m === "docked");
    try { localStorage.setItem("ds.dock.mode", m); } catch {}
    $("#dockToggle").title = m === "docked" ? "Float the panel" : "Dock to the side";
    $("#dockToggle use").setAttribute("href", m === "docked" ? "#ic-float" : "#ic-dock");
    if (m === "docked") { dock.classList.remove("min"); applyDockWidth(); }
    else applyFloat();
  };

  // ---- floating geometry ----
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function applyFloat() {
    const s = load();
    const w = clamp(s.w || 440, 340, window.innerWidth - 16);
    const h = clamp(s.h || 640, 380, window.innerHeight - 16);
    dock.style.width = w + "px"; dock.style.height = h + "px";
    // Position is stored as the top-left corner; default is the bottom-right of the window.
    const x = clamp(s.x ?? window.innerWidth - w - 24, 8, Math.max(8, window.innerWidth - w - 8));
    const y = clamp(s.y ?? window.innerHeight - h - 24, 8, Math.max(8, window.innerHeight - h - 8));
    dock.style.left = x + "px"; dock.style.top = y + "px"; dock.style.right = "auto"; dock.style.bottom = "auto";
  }
  function applyDockWidth() {
    const s = load();
    const w = clamp(s.dw || 420, 340, Math.min(720, window.innerWidth - 320));
    document.documentElement.style.setProperty("--dock-w", w + "px");
    dock.style.left = dock.style.top = dock.style.width = dock.style.height = "";
  }

  // ---- drag by the header (pointer events, so touch works too) ----
  let drag = null;
  head.addEventListener("pointerdown", (e) => {
    if (mode() === "docked" || e.target.closest("button")) return;
    if (dock.classList.contains("min")) return;
    drag = { dx: e.clientX - dock.offsetLeft, dy: e.clientY - dock.offsetTop };
    dock.classList.add("dragging");
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const x = clamp(e.clientX - drag.dx, 8, window.innerWidth - dock.offsetWidth - 8);
    const y = clamp(e.clientY - drag.dy, 8, window.innerHeight - dock.offsetHeight - 8);
    dock.style.left = x + "px"; dock.style.top = y + "px";
  });
  const endDrag = () => { if (!drag) return; drag = null; dock.classList.remove("dragging"); save({ x: dock.offsetLeft, y: dock.offsetTop }); };
  head.addEventListener("pointerup", endDrag);
  head.addEventListener("pointercancel", endDrag);
  // A click (not a drag) on a minimized header restores it.
  head.addEventListener("click", (e) => { if (dock.classList.contains("min") && !e.target.closest("button")) setMin(false); });

  // ---- resize from the corner (floating) or the left edge (docked) ----
  let rs = null;
  grip.addEventListener("pointerdown", (e) => { rs = { x: e.clientX, y: e.clientY, w: dock.offsetWidth, h: dock.offsetHeight }; grip.setPointerCapture(e.pointerId); dock.classList.add("dragging"); });
  grip.addEventListener("pointermove", (e) => {
    if (!rs) return;
    const w = clamp(rs.w + (e.clientX - rs.x), 340, window.innerWidth - dock.offsetLeft - 8);
    const h = clamp(rs.h + (e.clientY - rs.y), 380, window.innerHeight - dock.offsetTop - 8);
    dock.style.width = w + "px"; dock.style.height = h + "px";
  });
  const endRs = () => { if (!rs) return; rs = null; dock.classList.remove("dragging"); save({ w: dock.offsetWidth, h: dock.offsetHeight }); };
  grip.addEventListener("pointerup", endRs); grip.addEventListener("pointercancel", endRs);
  let es = null;
  edge.addEventListener("pointerdown", (e) => { es = { x: e.clientX, w: dock.offsetWidth }; edge.setPointerCapture(e.pointerId); });
  edge.addEventListener("pointermove", (e) => { if (!es) return; const w = clamp(es.w - (e.clientX - es.x), 340, Math.min(720, window.innerWidth - 320)); document.documentElement.style.setProperty("--dock-w", w + "px"); });
  const endEs = () => { if (!es) return; es = null; save({ dw: dock.offsetWidth }); };
  edge.addEventListener("pointerup", endEs); edge.addEventListener("pointercancel", endEs);

  // ---- minimize ----
  function setMin(on) {
    dock.classList.toggle("min", on);
    $("#minToggle").title = on ? "Expand" : "Minimize";
    $("#minToggle use").setAttribute("href", on ? "#ic-float" : "#ic-min");
    if (!on && mode() === "floating") applyFloat();
    save({ min: on });
  }
  $("#minToggle").onclick = (e) => { e.stopPropagation(); setMin(!dock.classList.contains("min")); };
  $("#dockToggle").onclick = (e) => { e.stopPropagation(); setMode(mode() === "docked" ? "floating" : "docked"); };

  // ---- keep it on screen when the window changes ----
  window.addEventListener("resize", () => { if (mode() === "floating" && !dock.classList.contains("min")) applyFloat(); else if (mode() === "docked") applyDockWidth(); });

  // ---- boot ----
  setMode(mode());
  if (load().min && mode() === "floating") setMin(true);
})();
