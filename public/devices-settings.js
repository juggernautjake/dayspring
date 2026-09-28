// Settings → Smart devices (public/setup.js shows it under "Apps & connections"; lib/devices behind /api/smarthome):
//   · whether Dayspring may switch devices (off / ask first / on), and per device
//   · the recommended power strips (per-outlet control that works without the internet), with links and notes
//   · Find devices (a scan of this network, only when clicked) → add what it found
//   · add or change a strip or plug (Kasa, Tapo, Shelly, Meross, or a custom HTTP/MQTT device from a template), Test it
//   · name each outlet: the device on it, its words ("fan 2", "the bedroom fan"), type, room, critical / this PC
//   · Wake-on-LAN, Home Assistant / Matter entities, WLED and Hue lights; scenes; the rate limits
// Everything saves as it's changed (no Save button needed).
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const api = async (path, body, method) => { const r = await fetch("/api" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "That didn't work. Try again."); return j; };
  let root = null, opts = {}, D = null, CAT = null, found = [];
  const $ = (s) => root?.querySelector(s);
  const say = (t, bad = false) => { const m = $("#dv-m"); if (m) { m.textContent = t; m.style.color = bad ? "var(--rose)" : ""; } if (t && opts.toast && !bad) opts.toast(t); };
  const NEEDS = { kasa: [], tapo: ["username", "password"], shelly: ["password"], meross: ["key"], custom: [] };

  function html() {
    return `<h1>Smart devices</h1>
      <p class="lead">Power strips and smart plugs, computers, TVs, fans, lights and LED strips, and your 3D printers' power: switched by voice ("turn fan 2 off", "turn on my computer", "movie mode", "turn everything off in the office at 10 pm") or on the <a href="/smarthome.html" target="_blank" rel="noopener">Devices page</a>.</p>
      <h2>May Dayspring switch your devices?</h2>
      <div class="choices" id="dv-perm" role="radiogroup" aria-label="Device control" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(12em,1fr));gap:.6em">
        <button type="button" class="choice" data-perm="off" role="radio"><b>Off</b><small>Nothing is switched. Status only.</small></button>
        <button type="button" class="choice" data-perm="ask" role="radio"><b>Ask me first</b><small>Every switch waits for your yes.</small></button>
        <button type="button" class="choice" data-perm="on" role="radio"><b>On</b><small>Everyday things just happen; risky ones still ask.</small></button>
      </div>
      <p class="hint">Always, whatever you choose: this computer, critical outlets (fridge, router), a printing or hot 3D printer, heaters, garage doors and locks ask first and say why; "everything off" asks; "everything on" never happens; nobody but you can switch heaters, doors or locks; and every switch is in the activity log.</p>
      <h2>Recommended power strips</h2>
      <p class="hint">Each outlet switched on its own, controlled on your own network (they keep working without the internet).</p>
      <div id="dv-rec"></div>
      <h2>Your strips and plugs</h2>
      <div class="row" style="gap:.5em;flex-wrap:wrap"><button type="button" class="btn" id="dv-scan">🔎 Find devices on my network</button><button type="button" class="btn ghost" id="dv-addstrip">+ Add one by hand</button></div>
      <div id="dv-found"></div>
      <div id="dv-stripform" hidden></div>
      <div id="dv-strips"></div>
      <h2>Devices</h2>
      <p class="hint">A device is what you call it: "Computer", "Fan 2", "TV". Give it the words you'll say (“fan two”, “the bedroom fan”), a room ("turn off everything in the garage"), and how it's switched.</p>
      <div class="row"><button type="button" class="btn" id="dv-adddev">+ Add a device</button></div>
      <div id="dv-devform" hidden></div>
      <div id="dv-devs"></div>
      <h2>Scenes</h2>
      <p class="hint">A scene switches several things at once: "movie mode" = TV on, lamp off, fan 2 off.</p>
      <div id="dv-scenes"></div>
      <div class="row"><button type="button" class="btn" id="dv-addscene">+ Add a scene</button></div>
      <div id="dv-sceneform" hidden></div>
      <h2>Philips Hue</h2>
      <div class="row" style="align-items:flex-end"><div class="field"><label for="dv-huehost">Hue bridge address</label><input id="dv-huehost" type="text" placeholder="192.168.1.20" autocomplete="off"></div><button type="button" class="btn" id="dv-huepair">Pair (press the bridge's button first)</button></div>
      <div id="dv-hues" class="hint"></div>
      <h2>Limits</h2>
      <div class="row">
        <div class="field"><label for="dv-min">Seconds between switching the same thing</label><input id="dv-min" type="number" min="0" max="120"></div>
        <div class="field"><label for="dv-max">Most switches of one thing per minute</label><input id="dv-max" type="number" min="1" max="60"></div>
        <div class="field"><label for="dv-bulk">Ask first when a command switches this many or more</label><input id="dv-bulk" type="number" min="2" max="50"></div>
      </div>
      <div id="dv-adapters" class="hint"></div>
      <div class="msg" id="dv-m" aria-live="polite"></div>`;
  }
  const typeOpts = (sel) => Object.entries(D?.types ?? {}).map(([k, t]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${esc(t.icon)} ${esc(t.label)}</option>`).join("");
  function renderAll() {
    const perm = D.permission ?? "off";
    root.querySelectorAll("[data-perm]").forEach((b) => { b.classList.toggle("on", b.dataset.perm === perm); b.setAttribute("aria-checked", String(b.dataset.perm === perm)); });
    $("#dv-rec").innerHTML = (CAT?.recommended ?? []).map((r) => `<div class="note" style="margin:.4em 0"><b>${esc(r.name)}</b> · ${r.outlets} outlets · ${esc(r.price)} · <span style="color:var(--mint)">works offline ✓</span> · <a href="${esc(r.link)}" target="_blank" rel="noopener">about it</a><div class="hint">${esc(r.why)} ${esc(r.note)}</div></div>`).join("")
      + (CAT?.notRecommended ?? []).map((r) => `<div class="hint">Not on the list: <b>${esc(r.name)}</b>. ${esc(r.why)}</div>`).join("");
    $("#dv-adapters").innerHTML = "Built in: " + (CAT?.adapters ?? []).map((a) => `${esc(a.label)}${a.stub ? " (coming)" : ""} <span title="${esc((a.transports ?? []).join(", "))}">${a.offline ? "✓ offline" : "needs internet"}</span>`).join(" · ") + ". Anything else: a custom HTTP/MQTT device, or Home Assistant.";
    const devOn = (sid, n) => D.devices.find((d) => (d.power ?? []).some((p) => p.via === "outlet" && p.strip === sid && Number(p.outlet) === n));
    $("#dv-strips").innerHTML = D.stripConfig.map((s) => `<div class="note" style="margin:.5em 0" data-strip="${esc(s.id)}">
      <div class="row" style="align-items:center;gap:.5em;flex-wrap:wrap"><b>${esc(s.name)}</b><span class="hint">${esc(s.adapter)} ${esc(s.model ?? "")} · ${esc(s.host)}${s.port ? ":" + s.port : ""} · ${s.outlets} outlet${s.outlets === 1 ? "" : "s"}${s.hasSecret ? " · 🔒 login saved" : ""}</span>
        <span style="flex:1"></span><button type="button" class="btn small" data-test="${esc(s.id)}">Test</button><button type="button" class="btn small ghost" data-editstrip="${esc(s.id)}">Change</button><button type="button" class="btn small ghost danger" data-delstrip="${esc(s.id)}">Remove</button></div>
      <div class="row" style="flex-wrap:wrap;gap:.4em;margin-top:.4em">${Array.from({ length: s.outlets }, (_, i) => { const d = devOn(s.id, i + 1); return `<button type="button" class="btn small" data-outlet="${esc(s.id)}:${i + 1}" title="${d ? "Change the device on this outlet" : "Name this outlet"}">${i + 1}: ${d ? esc(d.name) : "<i>name it</i>"}</button>`; }).join("")}</div>
      <div class="hint" data-testres="${esc(s.id)}"></div></div>`).join("") || `<p class="hint">None yet. Find them, or add one by hand.</p>`;
    $("#dv-devs").innerHTML = D.devices.map((d) => `<div class="note" style="margin:.4em 0"><div class="row" style="align-items:center;gap:.5em;flex-wrap:wrap">
        <span aria-hidden="true">${esc(d.icon)}</span><b>${esc(d.name)}</b><span class="hint">${esc(d.room || "no room")}${d.aliases?.length ? ` · also “${d.aliases.map(esc).join("”, “")}”` : ""} · ${esc(powerWords(d))}${d.critical ? " · ⚠ critical" : ""}${d.hostsDayspring ? " · 🖥 this PC" : ""}${d.class !== "normal" ? ` · ${esc(d.class)}` : ""}${d.permission && d.permission !== "inherit" ? ` · control: ${esc(d.permission)}` : ""}</span>
        <span style="flex:1"></span><button type="button" class="btn small" data-devtest="${esc(d.id)}">Test</button><button type="button" class="btn small ghost" data-editdev="${esc(d.id)}">Change</button><button type="button" class="btn small ghost danger" data-deldev="${esc(d.id)}">Remove</button></div>
        <div class="hint" data-devres="${esc(d.id)}"></div></div>`).join("") || `<p class="hint">No devices yet.</p>`;
    $("#dv-scenes").innerHTML = D.scenes.map((s) => `<div class="note" style="margin:.4em 0"><b>${esc(s.name)}</b> <span class="hint">${s.steps.map((x) => `${esc(D.devices.find((d) => d.id === x.device)?.name ?? x.device)} ${esc(x.action)}`).join(", ")}</span> <button type="button" class="btn small ghost danger" data-delscene="${esc(s.id)}">Remove</button></div>`).join("");
    $("#dv-hues").textContent = D.hues.length ? `Paired: ${D.hues.map((h) => `${h.name} (${h.host})${h.paired ? "" : " — not paired"}`).join(", ")}` : "";
    $("#dv-min").value = D.options.minToggleSeconds; $("#dv-max").value = D.options.maxTogglesPerMinute; $("#dv-bulk").value = D.options.bulkConfirmAt;
  }
  const powerWords = (d) => [...(d.power ?? []).map((p) => (p.via === "outlet" ? `outlet ${p.outlet} of ${D.stripConfig.find((s) => s.id === p.strip)?.name ?? p.strip}` : p.via === "wol" ? "Wake-on-LAN" : p.via === "homeassistant" || p.via === "matter" ? p.entity : p.via)), d.control ? d.control.via : ""].filter(Boolean).join(" + ") || "not connected yet";

  function stripForm(s = {}) {
    const f = $("#dv-stripform"); f.hidden = false;
    const tpl = Object.entries(CAT?.templates ?? {}).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join("");
    f.innerHTML = `<div class="note"><h3 style="margin:.2em 0">${s.id ? "Change" : "Add"} a strip or plug</h3>
      <div class="row"><div class="field"><label for="sf-ad">Kind</label><select id="sf-ad">${["kasa", "tapo", "shelly", "meross", "custom"].map((a) => `<option value="${a}" ${a === s.adapter ? "selected" : ""}>${esc(CAT.adapters.find((x) => x.id === a)?.label ?? a)}</option>`).join("")}</select></div>
        <div class="field"><label for="sf-name">Name</label><input id="sf-name" type="text" value="${esc(s.name ?? "")}" placeholder="Strip A"></div>
        <div class="field"><label for="sf-id">Letter / short id</label><input id="sf-id" type="text" value="${esc(s.id ?? "")}" ${s.id ? "disabled" : ""} placeholder="A" maxlength="12"></div></div>
      <div class="row"><div class="field"><label for="sf-host">IP address</label><input id="sf-host" type="text" value="${esc(s.host ?? "")}" placeholder="192.168.1.40"></div>
        <div class="field"><label for="sf-port">Port (usually blank)</label><input id="sf-port" type="number" value="${esc(s.port ?? "")}"></div>
        <div class="field"><label for="sf-out">Outlets</label><input id="sf-out" type="number" min="1" max="16" value="${esc(s.outlets ?? 1)}"></div></div>
      <div class="row" id="sf-creds"><div class="field" data-need="username"><label for="sf-user">Email (TP-Link account)</label><input id="sf-user" type="text" autocomplete="off"></div>
        <div class="field" data-need="password"><label for="sf-pass">Password</label><input id="sf-pass" type="password" autocomplete="new-password" placeholder="${s.hasSecret ? "saved (type to change)" : ""}"></div>
        <div class="field" data-need="key"><label for="sf-key">Device key</label><input id="sf-key" type="password" autocomplete="off"></div></div>
      <div id="sf-custom"><div class="field"><label for="sf-tpl">Start from a template</label><select id="sf-tpl"><option value="">(choose)</option>${tpl}</select></div>
        <div class="field"><label for="sf-json">Commands (JSON): on, off, and optionally status</label><textarea id="sf-json" rows="6" spellcheck="false" style="font-family:monospace">${esc(s.custom ? JSON.stringify(s.custom, null, 2) : "")}</textarea><div class="hint">{host} {outlet} {channel} {name} are filled in. MQTT: "url": "mqtt://broker:1883".</div></div></div>
      <p class="hint" id="sf-hint"></p>
      <div class="row"><button type="button" class="btn" id="sf-test">Test</button><button type="button" class="btn primary" id="sf-save">Save</button><button type="button" class="btn ghost" id="sf-cancel">Cancel</button></div><div class="hint" id="sf-res"></div></div>`;
    const sync = () => { const a = $("#sf-ad").value; f.querySelectorAll("[data-need]").forEach((x) => { x.hidden = !(NEEDS[a] ?? []).includes(x.dataset.need); }); $("#sf-custom").hidden = a !== "custom"; $("#sf-hint").textContent = CAT.adapters.find((x) => x.id === a)?.hint ?? ""; };
    $("#sf-ad").onchange = sync; sync();
    $("#sf-tpl").onchange = () => { const t = CAT.templates[$("#sf-tpl").value]; if (t) $("#sf-json").value = JSON.stringify(t.custom, null, 2); };
    const read = () => { let custom = null; if ($("#sf-ad").value === "custom") { try { custom = JSON.parse($("#sf-json").value || "{}"); } catch { throw new Error("The commands aren't valid JSON."); } }
      const secret = Object.fromEntries([["username", $("#sf-user").value], ["password", $("#sf-pass").value], ["key", $("#sf-key").value]].filter(([, v]) => v));
      return { id: s.id ?? ($("#sf-id").value.trim() || undefined), name: $("#sf-name").value.trim() || undefined, adapter: $("#sf-ad").value, host: $("#sf-host").value.trim(), port: $("#sf-port").value || undefined, outlets: Number($("#sf-out").value) || 1, custom, ...(Object.keys(secret).length ? { secret } : {}), model: s.model }; };
    $("#sf-test").onclick = async () => { try { const b = read(); const r = await api("/smarthome/test", { ...b, id: undefined, secret: b.secret ?? undefined }); $("#sf-res").textContent = r.text; if (r.state?.on?.length && !$("#sf-out").value) $("#sf-out").value = r.state.on.length; } catch (e) { $("#sf-res").textContent = e.message; } };
    $("#sf-save").onclick = async () => { try { await api("/smarthome/strip", read()); f.hidden = true; say("Saved."); await load(); } catch (e) { $("#sf-res").textContent = e.message; } };
    $("#sf-cancel").onclick = () => { f.hidden = true; };
    $("#sf-host").focus();
  }
  function devForm(d = {}, preset = {}) {
    const f = $("#dv-devform"); f.hidden = false;
    const outlet = (d.power ?? []).find((p) => p.via === "outlet") ?? preset.outlet ?? {}, wol = (d.power ?? []).find((p) => p.via === "wol") ?? {}, ha = (d.power ?? []).find((p) => p.via === "homeassistant" || p.via === "matter") ?? {};
    f.innerHTML = `<div class="note"><h3 style="margin:.2em 0">${d.id ? "Change" : "Add"} a device</h3>
      <div class="row"><div class="field"><label for="df-name">Name</label><input id="df-name" type="text" value="${esc(d.name ?? "")}" placeholder="Fan 2"></div>
        <div class="field"><label for="df-type">Kind</label><select id="df-type">${typeOpts(d.type ?? preset.type ?? "other")}</select></div>
        <div class="field"><label for="df-room">Room</label><input id="df-room" type="text" list="df-rooms" value="${esc(d.room ?? "")}" placeholder="office"><datalist id="df-rooms">${(D.rooms ?? []).map((r) => `<option value="${esc(r)}">`).join("")}</datalist></div></div>
      <div class="field"><label for="df-al">Other words for it (commas)</label><input id="df-al" type="text" value="${esc((d.aliases ?? []).join(", "))}" placeholder="fan two, the bedroom fan"><div class="hint">Numbers and ordinals are understood by themselves: "Fan 2" also answers to "fan two", "second fan", "fan number 2".</div></div>
      <div class="row"><div class="field"><label for="df-strip">On strip</label><select id="df-strip"><option value="">(none)</option>${D.stripConfig.map((s) => `<option value="${esc(s.id)}" ${s.id === outlet.strip ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="df-outlet">Outlet</label><input id="df-outlet" type="number" min="1" max="16" value="${esc(outlet.outlet ?? "")}"></div>
        <div class="field"><label for="df-mac">Wake-on-LAN MAC (computers, some TVs)</label><input id="df-mac" type="text" value="${esc(wol.mac ?? "")}" placeholder="3C-7C-3F-1A-2B-4D"></div></div>
      <div class="row"><div class="field"><label for="df-ha">Home Assistant / Matter entity</label><input id="df-ha" type="text" value="${esc(ha.entity ?? d.control?.entity ?? "")}" placeholder="switch.garage_fan" list="df-ents"><datalist id="df-ents"></datalist></div>
        <div class="field"><label for="df-wled">WLED address (LED strips)</label><input id="df-wled" type="text" value="${esc(d.control?.via === "wled" ? d.control.host : "")}" placeholder="192.168.1.60"></div>
        ${D.hues.some((h) => h.paired) ? `<div class="field"><label for="df-hue">Hue light</label><select id="df-hue"><option value="">(none)</option></select></div>` : ""}
        <div class="field"><label for="df-perm">Control</label><select id="df-perm">${[["inherit", "Like everything else"], ["ask", "Always ask me"], ["on", "Just do it"], ["off", "Never switch it"]].map(([v, l]) => `<option value="${v}" ${v === (d.permission ?? "inherit") ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
      <div class="row"><label><input type="checkbox" id="df-crit" ${d.critical ? "checked" : ""}> Critical (fridge, router: turning it off always asks)</label><label><input type="checkbox" id="df-host" ${d.hostsDayspring ? "checked" : ""}> This is the computer Dayspring runs on</label></div>
      <div class="row"><div class="field"><label for="df-auto">Heating appliance: turn off by itself after (minutes, blank = never)</label><input id="df-auto" type="number" min="0" value="${esc(d.autoOffMinutes ?? "")}"></div>
        <div class="field"><label for="df-printer">Its 3D printer (so its power is never cut mid-print)</label><select id="df-printer"><option value="">(not a printer)</option>${(D.printers ?? []).map((p) => `<option value="${esc(p.id)}" ${p.id === d.printer ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div></div>
      <div class="row"><button type="button" class="btn primary" id="df-save">Save</button><button type="button" class="btn ghost" id="df-cancel">Cancel</button></div><div class="hint" id="df-res"></div></div>`;
    for (const h of D.hues.filter((x) => x.paired)) api(`/smarthome/hue/${encodeURIComponent(h.id)}/lights`).then((r) => { const sel = $("#df-hue"); if (!sel) return; sel.insertAdjacentHTML("beforeend", (r.lights ?? []).map((l) => { const v = `${h.id}|${l.kind}|${l.id}`, cur = d.control?.via === "hue" && `${d.control.bridge}|${d.control.kind ?? "light"}|${d.control.light}` === v; return `<option value="${esc(v)}" ${cur ? "selected" : ""}>${esc(l.name)}${l.kind === "group" ? " (room)" : ""}</option>`; }).join("")); }).catch(() => {});
    api("/smarthome/ha/entities").then((r) => { $("#df-ents").innerHTML = (r.entities ?? []).map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join(""); }).catch(() => {});
    $("#df-save").onclick = async () => {
      const power = [];
      if ($("#df-strip").value && $("#df-outlet").value) power.push({ via: "outlet", strip: $("#df-strip").value, outlet: Number($("#df-outlet").value) });
      if ($("#df-mac").value.trim()) power.push({ via: "wol", mac: $("#df-mac").value.trim() });
      const ent = $("#df-ha").value.trim(); const lightish = /^(light|cover|lock|climate)\./.test(ent);
      if (ent && !lightish) power.push({ via: "homeassistant", entity: ent });
      const hueSel = $("#df-hue")?.value; const [hb, hk, hl] = (hueSel || "").split("|");
      const control = $("#df-wled").value.trim() ? { via: "wled", host: $("#df-wled").value.trim() } : hueSel ? { via: "hue", bridge: hb, kind: hk, light: hl } : ent && lightish ? { via: "homeassistant", entity: ent } : null;
      try { await api("/smarthome/device", { id: d.id, name: $("#df-name").value.trim(), type: $("#df-type").value, room: $("#df-room").value.trim(), aliases: $("#df-al").value, power, control, permission: $("#df-perm").value, critical: $("#df-crit").checked, hostsDayspring: $("#df-host").checked, autoOffMinutes: $("#df-auto").value || null, printer: $("#df-printer").value || null }); f.hidden = true; say("Saved."); await load(); }
      catch (e) { $("#df-res").textContent = e.message; }
    };
    $("#df-cancel").onclick = () => { f.hidden = true; };
    $("#df-name").focus();
  }
  function sceneForm() {
    const f = $("#dv-sceneform"); f.hidden = false;
    f.innerHTML = `<div class="note"><div class="field"><label for="scf-name">Scene name</label><input id="scf-name" type="text" placeholder="Movie mode"></div>
      <div class="hint">For each device: what it does in this scene.</div>
      ${D.devices.map((d) => `<div class="row" style="align-items:center"><span style="flex:1">${esc(d.icon)} ${esc(d.name)}</span><select data-scdev="${esc(d.id)}"><option value="">(leave it)</option><option value="on">on</option><option value="off">off</option></select></div>`).join("")}
      <div class="row"><button type="button" class="btn primary" id="scf-save">Save scene</button><button type="button" class="btn ghost" id="scf-cancel">Cancel</button></div></div>`;
    $("#scf-save").onclick = async () => { const steps = [...f.querySelectorAll("[data-scdev]")].filter((s) => s.value).map((s) => ({ device: s.dataset.scdev, action: s.value })); try { await api("/smarthome/scene", { name: $("#scf-name").value.trim(), steps }); f.hidden = true; await load(); } catch (e) { say(e.message, true); } };
    $("#scf-cancel").onclick = () => { f.hidden = true; };
  }
  async function load() {
    [D, CAT] = await Promise.all([api("/smarthome"), CAT ? Promise.resolve(CAT) : api("/smarthome/catalog")]);
    D.printers = await api("/printers").then((r) => r.printers).catch(() => []);
    renderAll();
  }
  function mount(card, o = {}) {
    root = card; opts = o;
    load().catch((e) => say(e.message, true));
    root.addEventListener("click", async (e) => {
      const b = e.target.closest("button"); if (!b || !root.contains(b)) return;
      try {
        if (b.dataset.perm) { await api("/smarthome/permission", { devices: b.dataset.perm }); D.permission = b.dataset.perm; renderAll(); say(b.dataset.perm === "off" ? "Device control is off." : b.dataset.perm === "ask" ? "Dayspring will ask before switching anything." : "Device control is on (risky ones still ask)."); }
        else if (b.id === "dv-scan") { b.disabled = true; say("Looking on your network (about 10 seconds)…"); found = (await api("/smarthome/discover", {})).found; b.disabled = false; $("#dv-found").innerHTML = found.length ? found.map((x, i) => `<div class="note" style="margin:.35em 0">${esc(x.adapter)} <b>${esc(x.model || "")}</b> ${esc(x.name || "")} · ${esc(x.host)}${x.port ? ":" + x.port : ""}${x.outlets ? ` · ${x.outlets} outlet${x.outlets === 1 ? "" : "s"}` : ""}${x.needsLogin ? " · needs its login" : ""} ${x.known ? '<span class="hint">(already added)</span>' : `<button type="button" class="btn small" data-addfound="${i}">Add</button>`}</div>`).join("") : `<p class="hint">Nothing found. Check the device is on the same network (not a guest network), or add it by hand with its IP address.</p>`; say(`Found ${found.length}.`); }
        else if (b.dataset.addfound !== undefined) { const x = found[Number(b.dataset.addfound)]; if (x.adapter === "wled") devForm({ name: x.name || "LED strip", type: "light", control: { via: "wled", host: x.host } }); else stripForm({ adapter: x.adapter, host: x.host, port: x.port, outlets: x.outlets, model: x.model, name: x.name || undefined }); }
        else if (b.id === "dv-addstrip") stripForm({ adapter: "kasa" });
        else if (b.dataset.editstrip) stripForm(D.stripConfig.find((s) => s.id === b.dataset.editstrip));
        else if (b.dataset.delstrip) { if (confirm("Remove this strip? The devices on it stay, without it.")) { await api(`/smarthome/strip/${encodeURIComponent(b.dataset.delstrip)}`, undefined, "DELETE"); await load(); } }
        else if (b.dataset.test) { const r = await api("/smarthome/test", { id: b.dataset.test }); root.querySelector(`[data-testres="${CSS.escape(b.dataset.test)}"]`).textContent = r.text; }
        else if (b.dataset.outlet) { const [sid, n] = b.dataset.outlet.split(":"); const d = D.devices.find((x) => (x.power ?? []).some((p) => p.via === "outlet" && p.strip === sid && Number(p.outlet) === Number(n))); devForm(d ?? {}, { outlet: { strip: sid, outlet: Number(n) } }); }
        else if (b.id === "dv-adddev") devForm({});
        else if (b.dataset.editdev) devForm(D.devices.find((d) => d.id === b.dataset.editdev));
        else if (b.dataset.deldev) { if (confirm("Remove this device from Dayspring? (Nothing is switched.)")) { await api(`/smarthome/device/${encodeURIComponent(b.dataset.deldev)}`, undefined, "DELETE"); await load(); } }
        else if (b.dataset.devtest) { const st = (await api("/smarthome/status")).devices.find((x) => x.id === b.dataset.devtest); root.querySelector(`[data-devres="${CSS.escape(b.dataset.devtest)}"]`).textContent = !st ? "" : st.reachable === false ? `Can't reach it: ${st.error ?? ""}` : st.on === null ? (st.unknown ?? "Connected, but it can't say whether it's on.") : `Connected: it's ${st.on ? "on" : "off"}${st.watts != null ? `, using ${st.watts} W` : ""}.`; }
        else if (b.dataset.delscene) { await api(`/smarthome/scene/${encodeURIComponent(b.dataset.delscene)}`, undefined, "DELETE"); await load(); }
        else if (b.id === "dv-addscene") sceneForm();
        else if (b.id === "dv-huepair") { const r = await api("/smarthome/hue/pair", { host: $("#dv-huehost").value.trim() }); say(r.ok ? "Hue bridge paired. Add its lights as devices (Kind: Light) with “hue” in Settings, or ask Dayspring to list them." : r.text, !r.ok); await load(); }
      } catch (x) { say(x.message, true); }
    });
    root.addEventListener("change", async (e) => { if (["dv-min", "dv-max", "dv-bulk"].includes(e.target.id)) { try { await api("/smarthome/options", { minToggleSeconds: $("#dv-min").value, maxTogglesPerMinute: $("#dv-max").value, bulkConfirmAt: $("#dv-bulk").value }); say("Saved."); } catch (x) { say(x.message, true); } } });
  }
  window.DayspringDeviceSettings = { html, mount, save: async () => {} };
})();
