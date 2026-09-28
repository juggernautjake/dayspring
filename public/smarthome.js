// The Devices page (/smarthome.html): every device by room as a tile drawn from its capabilities (a switch, a brightness
// slider, a colour picker, an effects list, open/close, lock), the power strips outlet by outlet, scenes and schedules.
// Live: it listens to Dayspring's events and refreshes every 15 seconds. Anything risky shows the same question the
// voice gives, with "Yes, do it" (the owner's own click on his own screen).
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const params = new URLSearchParams(location.search), embed = params.get("embed") === "1";
  const api = async (path, opts = {}) => { const r = await fetch("/api" + path, { method: opts.body ? "POST" : opts.method ?? "GET", headers: opts.body ? { "content-type": "application/json" } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `${r.status}`); return j; };
  const msg = (t, bad = false) => { const m = $("#msg"); m.textContent = t || ""; m.style.color = bad ? "var(--rose)" : ""; };
  let data = null, busy = false;
  const CLASS = { heat: ["🔥", "heats"], motion: ["↕", "moves"], security: ["🔒", "lock"] };

  function stateWords(d) {
    const s = d.state;
    if (!s) return ["…", ""];
    if (s.printer?.state && s.printer.state !== "offline") return [`${s.printer.state}${s.printer.progress != null ? ` ${Math.round(s.printer.progress)}%` : ""}`, "on"];
    if (s.reachable === false) return ["can't reach it", "bad"];
    if (s.open) return [s.open, s.open === "open" ? "on" : ""];
    if (s.locked !== undefined) return [s.locked ? "locked" : "unlocked", s.locked ? "" : "on"];
    if (s.on === null) return [s.unknown ? "on/off unknown" : "unknown", ""];
    return [`${s.on ? "on" : "off"}${s.on && s.brightness != null ? ` · ${s.brightness}%` : ""}${s.watts != null ? ` · ${s.watts} W` : ""}`, s.on ? "on" : ""];
  }
  const hex = (c) => (c ? "#" + [c.r, c.g, c.b].map((x) => Math.max(0, Math.min(255, x | 0)).toString(16).padStart(2, "0")).join("") : "#ffffff");
  function tile(d) {
    const s = d.state ?? {}, caps = s.caps ?? ["onoff"], [words, cls] = stateWords(d);
    const badges = [d.class !== "normal" && CLASS[d.class] ? `<span class="badge ${d.class}" title="Needs an exact name and your yes">${CLASS[d.class][0]} ${CLASS[d.class][1]}</span>` : "",
      d.hostsDayspring ? `<span class="badge crit" title="The computer Dayspring runs on">🖥 this PC</span>` : d.critical ? `<span class="badge crit" title="Critical: turning it off always asks">⚠ critical</span>` : "",
      d.effective === "ask" ? `<span class="badge">asks first</span>` : d.effective === "off" ? `<span class="badge">control off</span>` : ""].join("");
    const ctl = [];
    if (caps.includes("brightness")) ctl.push(`<div class="ctl"><label for="b-${esc(d.id)}">☀</label><input type="range" id="b-${esc(d.id)}" min="1" max="100" value="${s.brightness ?? 50}" data-act="brightness" data-id="${esc(d.id)}" aria-label="${esc(d.name)} brightness"></div>`);
    if (caps.includes("color")) ctl.push(`<div class="ctl"><label>🎨 <input type="color" value="${hex(s.color)}" data-act="color" data-id="${esc(d.id)}" aria-label="${esc(d.name)} colour"></label>${caps.includes("colortemp") ? `<select data-act="colortemp" data-id="${esc(d.id)}" aria-label="white"><option value="">white…</option><option value="2700">warm</option><option value="4000">neutral</option><option value="6000">cool</option></select>` : ""}</div>`);
    if (caps.includes("effect") && (s.effects ?? []).length) ctl.push(`<div class="ctl"><select data-act="effect" data-id="${esc(d.id)}" aria-label="${esc(d.name)} effect"><option value="">effect…</option>${s.effects.map((e) => `<option ${e === s.effect ? "selected" : ""}>${esc(e)}</option>`).join("")}</select></div>`);
    const openclose = caps.includes("openclose"), lock = caps.includes("lock");
    const main = openclose ? `<button class="btn" data-act="open" data-id="${esc(d.id)}">Open</button><button class="btn" data-act="close" data-id="${esc(d.id)}">Close</button>`
      : lock ? `<button class="btn" data-act="lock" data-id="${esc(d.id)}">Lock</button><button class="btn" data-act="unlock" data-id="${esc(d.id)}">Unlock</button>`
      : `<button class="sw" role="switch" aria-checked="${s.on === true}" aria-label="${esc(d.name)}" data-act="${s.on ? "off" : "on"}" data-id="${esc(d.id)}"></button>`;
    return `<div class="tile ${cls === "on" ? "on" : ""}" data-id="${esc(d.id)}"><div class="hd"><span class="ic" aria-hidden="true">${esc(d.icon)}</span><span class="nm" title="${esc(d.name)}">${esc(d.name)}</span>${main}</div>
      <div class="st ${cls}">${esc(words)}</div>${badges ? `<div class="badges">${badges}</div>` : ""}${ctl.join("")}</div>`;
  }
  function render() {
    if (!data) return;
    const byRoom = new Map();
    for (const d of data.devices) { const r = d.room || "other"; if (!byRoom.has(r)) byRoom.set(r, []); byRoom.get(r).push(d); }
    $("#rooms").innerHTML = data.devices.length ? [...byRoom].sort((a, b) => a[0].localeCompare(b[0])).map(([r, list]) => `<section><h2>${esc(r)}</h2><div class="grid">${list.map(tile).join("")}</div></section>`).join("")
      : `<p class="empty">No devices yet. <button class="btn main" id="goSet" type="button">Add your plugs and strips</button> — Dayspring can find Kasa, Shelly, Tapo, Meross and WLED devices on your network.</p>`;
    $("#goSet")?.addEventListener("click", openSettings);
    $("#scenesBox").hidden = !data.scenes.length;
    $("#scenes").innerHTML = data.scenes.map((s) => `<button class="btn" data-scene="${esc(s.id)}">🎬 ${esc(s.name)}</button>`).join("");
    $("#stripsBox").hidden = !data.strips.length;
    const nameOf = (id) => data.devices.find((d) => d.id === id)?.name;
    $("#strips").innerHTML = data.strips.map((s) => `<div class="strip"><div class="row"><b>${esc(s.name)}</b><span class="st">${esc(s.model || s.adapter)}${s.reachable === false ? ` · <span style="color:var(--rose)">can't reach it${s.error ? `: ${esc(s.error)}` : ""}</span>` : ""}</span></div>
      <div class="outlets">${Array.from({ length: s.outlets }, (_, i) => { const dev = s.devices[i], on = s.on?.[i]; return `<button class="outlet ${on ? "on" : ""}" ${dev ? `data-act="${on ? "off" : "on"}" data-id="${esc(dev)}"` : "disabled"} aria-pressed="${Boolean(on)}" title="${dev ? `Switch ${esc(nameOf(dev))}` : "Not assigned: name it in Settings"}"><b>Outlet ${i + 1}${s.watts?.[i] ? ` · ${s.watts[i]} W` : ""}</b><span>${esc(nameOf(dev) ?? s.names?.[i] ?? "—")}</span></button>`; }).join("")}</div></div>`).join("");
    $("#schedBox").hidden = !data.schedules.length;
    $("#scheds").innerHTML = data.schedules.map((s) => `<div class="item"><span class="grow">${esc(`${s.action === "off" ? "Turn off" : s.action === "on" ? "Turn on" : s.action} ${s.label} ${s.whenLabel ?? (s.daily ? `every day at ${s.daily}` : new Date(s.at).toLocaleString())}`)}${s.tag === "autooff" ? " (auto-off)" : ""}</span><button class="btn" data-cancel="${esc(s.id)}" aria-label="Cancel this schedule">✕</button></div>`).join("");
  }
  async function load() { try { data = await api("/smarthome"); render(); } catch (e) { msg(/turned on/.test(e.message) ? e.message : `Couldn't load devices: ${e.message}`, true); } }
  // a command's answer: done, a question, or a refusal
  async function handleResult(r, retry) {
    if (r?.needsConfirm) { const ok = await ask(r.text); if (ok) return handleResult(await retry(), null); msg("Okay, I won't."); return; }
    msg(r?.text ?? "", r && r.ok === false);
    setTimeout(load, 400);
  }
  function ask(text) {
    return new Promise((res) => {
      $("#dlgText").textContent = text; $("#dlg").hidden = false; $("#dlgYes").focus();
      const done = (v) => { $("#dlg").hidden = true; $("#dlgYes").onclick = $("#dlgNo").onclick = null; res(v); };
      $("#dlgYes").onclick = () => done(true); $("#dlgNo").onclick = () => done(false);
    });
  }
  async function act(id, action, value) {
    if (busy) return; busy = true;
    try { const body = { ids: [id], action, value }; await handleResult(await api("/smarthome/control", { body }), () => api("/smarthome/control", { body: { ...body, approve: true } })); }
    catch (e) { msg(e.message, true); } finally { busy = false; }
  }
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-act]"); if (b && !b.disabled) return act(b.dataset.id, b.dataset.act);
    const sc = e.target.closest("[data-scene]"); if (sc) { try { await handleResult(await api("/smarthome/scene/run", { body: { id: sc.dataset.scene } }), null); } catch (x) { msg(x.message, true); } return; }
    const c = e.target.closest("[data-cancel]"); if (c) { await api(`/smarthome/schedule/${encodeURIComponent(c.dataset.cancel)}`, { method: "DELETE" }).catch(() => {}); load(); }
  });
  document.addEventListener("change", (e) => { const el = e.target.closest("[data-act]"); if (!el || el.tagName === "BUTTON" || !el.value) return; act(el.dataset.id, el.dataset.act, el.dataset.act === "brightness" || el.dataset.act === "colortemp" ? Number(el.value) : el.value); });
  $("#say").addEventListener("submit", async (e) => {
    e.preventDefault(); const t = $("#sayIn").value.trim(); if (!t) return;
    try { const r = await api("/smarthome/say", { body: { text: t } }); $("#sayIn").value = ""; if (r.needsConfirm) { const ok = await ask(r.text); const r2 = await api("/smarthome/say", { body: { text: ok ? "yes" : "no" } }); msg(r2.text ?? ""); } else msg(r.text, r.ok === false); setTimeout(load, 400); }
    catch (x) { msg(x.message, true); }
  });
  function openSettings() { if (embed && window.parent?.dsOpenPage) window.parent.dsOpenPage("/setup?embed=1&s=devices"); else location.href = "/setup?s=devices"; }
  $("#settings").onclick = openSettings;
  $("#refresh").onclick = () => { msg(""); load(); };
  if (embed) { $("#close").hidden = false; $("#close").onclick = () => window.parent.postMessage({ type: "dayspring-page-close" }, location.origin); }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (!$("#dlg").hidden) $("#dlgNo").click(); else if (embed) window.parent.postMessage({ type: "dayspring-page-close" }, location.origin); } });
  try { const es = new EventSource("/api/events?page=smarthome"); es.addEventListener("devices", () => setTimeout(load, 300)); } catch { /* polling only */ }
  setInterval(() => { if (!document.hidden && $("#dlg").hidden) load(); }, 15_000);
  load();
})();
