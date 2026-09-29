// The schedule's side of Maps (public/calendar.js calls it): an item with a place gets 🗺 Directions (the trip opens in
// the Maps window on the Dayspring screen) and, for one still ahead, a "leave by" line: "You need to leave by 2:35 to
// make your 3:00." (the drive from home plus the cushion in Settings → Maps), with ⏰ Remind me.
// A place comes from an outside calendar's location, or from a Dayspring item's notes: a line starting "Where:",
// "Location:", "At:" or 📍. Nothing shows while the "maps" feature is off.
(() => {
  let enabled = null;
  const on = () => (enabled ??= fetch("/api/maps/enabled").then((r) => (r.ok ? r.json() : { enabled: false })).then((j) => j.enabled === true).catch(() => false));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const post = (url, body) => fetch("/api" + url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Maps couldn't do that."); return j; });
  // "Where: 123 Main St" / "📍 Community Center" in notes → the place
  function placeIn(notes) {
    const m = /(?:^|\n)\s*(?:where|location|place|address|at)\s*[:\-–]\s*(.+)|📍\s*(.+)/i.exec(String(notes ?? ""));
    return m ? (m[1] ?? m[2]).trim().slice(0, 200) : "";
  }
  const ahead = (date, start) => { if (!date || !start) return false; const [y, mo, d] = date.split("-").map(Number), [h, mi] = start.split(":").map(Number); return new Date(y, mo - 1, d, h, mi).getTime() > Date.now(); };
  const toast = (t) => { try { window.dsCalToast?.(t); } catch { /* none */ } };
  async function decorate(host, { where = "", notes = "", date = "", start = "", title = "" } = {}) {
    if (!host) return;
    host.querySelector(".ds-maps-dir")?.remove();
    const place = String(where || placeIn(notes)).trim();
    if (!place || !(await on())) return;
    const box = document.createElement("div"); box.className = "ds-maps-dir";
    box.style.cssText = "display:flex;flex-wrap:wrap;gap:.4em;align-items:center;margin:.6em 0";
    box.innerHTML = `<button type="button" class="tool" data-mdir>🗺 Directions</button><span class="muted" data-mlb style="flex:1 1 14em"></span>`;
    host.appendChild(box);
    box.querySelector("[data-mdir]").onclick = async () => {
      try { await post("/maps/directions", { to: place }); if (window.parent !== window) window.parent.postMessage({ type: "dayspring-calendar-close" }, "*"); else toast("The directions are in the Maps window on the Dayspring screen."); }
      catch (e) { box.querySelector("[data-mlb]").textContent = e.message; }
    };
    if (!ahead(date, start)) return;
    const lb = box.querySelector("[data-mlb]");
    lb.textContent = "Checking the trip…";
    try {
      const r = await post("/maps/leaveby", { where: place, date, start, title });
      lb.innerHTML = `${esc(r.text)} <span style="opacity:.75">(${esc(r.durationText)}, ${esc(r.distanceText)} from home)</span>`;
      if (!r.late) {
        const b = document.createElement("button"); b.type = "button"; b.className = "tool"; b.dataset.mremind = "1";
        b.textContent = `⏰ Remind me at ${r.text.match(/leave by ([\d:]+)/)?.[1] ?? r.leaveAt}`;
        b.onclick = async () => { try { await post("/maps/leaveby/remind", { date: r.leaveDate, time: r.leaveAt, text: `leave for ${title || place}`, spoken: `Time to leave for ${title || place}. ${r.durationText} from home.` }); b.disabled = true; b.textContent = "⏰ Reminder set"; } catch (e) { lb.textContent = e.message; } };
        box.appendChild(b);
      }
    } catch (e) { lb.textContent = e.message; }
  }
  window.dsMapsCal = { decorate, placeIn };
})();
