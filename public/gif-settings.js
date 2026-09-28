// Settings → GIFs (public/setup.js shows it under "Apps & connections"): the GIF sources (GIPHY, KLIPY, Imgur and the
// keyless web search), each with its on/off switch, its key (saved to .env, never shown back), a "Get a free key"
// guide, a Test button and its attribution; their order; the default rating, format, autoplay and data saver; where
// saved GIFs go; the cache; favourites and recents; and what Dayspring says when you pick one.
// Keys save straight away (Save key); everything else saves with the section (Save, or moving to another section).
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (path, body) => {
    const r = await fetch("/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "That didn't work. Try again.");
    return j;
  };
  // switched off in this build (release channels, lib/features.mjs): Settings → GIFs is hidden
  const featureOn = window.dsFeatures?.on ? window.dsFeatures.on("gifs") !== false : (() => { try { const x = new XMLHttpRequest(); x.open("GET", "/api/gifs/enabled", false); x.send(); return x.status === 200 ? JSON.parse(x.responseText).enabled !== false : x.status !== 404; } catch { return true; } })();
  let root = null, opts = {}, V = null, order = [], on = {};
  const $ = (s) => root?.querySelector(s);
  const $$ = (s) => [...(root?.querySelectorAll(s) ?? [])];
  const STATE = { ok: ["✓ Works", "ok"], ready: ["Ready", "ok"], "needs-key": ["Needs a key", ""], "invalid-key": ["Key not accepted", "bad"], "rate-limited": ["Busy: too many searches for now", "warn"], unavailable: ["Unavailable right now", "warn"], timeout: ["Slow to answer", "warn"], off: ["Off", ""] };
  const mb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

  function html() {
    return `<h1>GIFs</h1>
      <p class="lead">Find GIFs and stickers from several places at once, by voice ("show me a GIF of a dancing cat") or in the GIF picker (🎞 GIFs by the clock, or <a href="/gifs" target="_blank" rel="noopener">open it in a tab ↗</a>). Copy them, save them, or add them to an email.</p>
      <div class="note">GIFs work straight away with <b>no keys</b>, from the web. For far more (and better-labelled) GIFs, add a free key from GIPHY or KLIPY below. Each takes about a minute. Keys are kept in Dayspring's <b>.env</b> file and are never shown again.</div>
      <h2>Sources</h2>
      <p class="hint">Results from every source that's on are mixed together, one from each in turn. Drag a card (or use ▲ ▼) to change the order: the top one goes first.</p>
      <div id="gs-provs" role="list" aria-label="GIF sources"></div>
      <h2>Showing GIFs</h2>
      <div class="row">
        <div class="field"><label for="gs-rating">Highest rating to show</label><select id="gs-rating"><option value="g">G: suitable for everyone</option><option value="pg">PG</option><option value="pg-13">PG-13 (the usual)</option><option value="r">R</option></select><div class="hint">Checked twice: the sources are asked for it, and Dayspring drops anything rated higher.</div></div>
        <div class="field"><label for="gs-type">Show at first</label><select id="gs-type"><option value="gif">GIFs</option><option value="sticker">Stickers</option></select></div>
      </div>
      <div class="row">
        <div class="field"><label for="gs-format">Preferred format</label><select id="gs-format"><option value="gif">GIF (works everywhere)</option><option value="mp4">MP4 video (smaller)</option><option value="webp">WebP (smaller)</option></select><div class="hint">Used for the big preview, saving and attaching. GIF is the one every email and chat app understands.</div></div>
        <div class="field"><label for="gs-autoplay">Animate GIFs</label><select id="gs-autoplay"><option value="always">Always</option><option value="hover">Only when pointed at</option><option value="never">Never in the grid (only in the big preview)</option></select><div class="hint">If Windows is set to reduce motion, "Always" animates only when pointed at.</div></div>
      </div>
      <div class="toggle"><div class="txt"><b id="gs-saver-l">Data saver</b><div>Smaller, lower-quality previews in the grid. Handy on a slow connection.</div></div><button type="button" class="sw" role="switch" id="gs-saver" aria-labelledby="gs-saver-l" aria-checked="false"></button></div>
      <h2>Saving and the cache</h2>
      <div class="field"><label for="gs-dir">Save GIFs to (optional)</label><input id="gs-dir" type="text" placeholder="Pictures\\Dayspring GIFs" autocomplete="off" spellcheck="false"><div class="hint" id="gs-dirhint"></div></div>
      <div class="row" style="align-items:flex-end">
        <div class="field"><label for="gs-cache">Keep up to (MB of GIFs, for attaching and copying)</label><input id="gs-cache" type="number" min="20" max="5000" step="10"></div>
        <div class="field"><span class="hint" id="gs-cacheuse"></span> <button type="button" class="btn small ghost" id="gs-clearcache">Clear GIF cache</button></div>
      </div>
      <h2>Favourites and recent GIFs</h2>
      <p class="hint" id="gs-lists"></p>
      <div class="row" style="gap:.6em;flex-wrap:wrap"><button type="button" class="btn small ghost" id="gs-clearfav">Clear favourites</button><button type="button" class="btn small ghost" id="gs-clearrec">Clear recent GIFs</button></div>
      <h2>Voice</h2>
      <div class="toggle"><div class="txt"><b id="gs-say-l">Say the GIF's title when you pick one</b><div>"Number 4: Dancing cat, from GIPHY." Off: just "Number 4."</div></div><button type="button" class="sw" role="switch" id="gs-say" aria-labelledby="gs-say-l" aria-checked="true"></button></div>
      <p class="hint">Things to say: "show me a GIF of a dancing cat", "find a thumbs up GIF", "trending GIFs", "number 4", "more", "save that GIF", "copy that one", "only stickers", "clean ones only".</p>
      <div class="msg" id="m" aria-live="polite"></div>`;
  }

  function card(p, i) {
    const [word, kind] = STATE[p.on ? p.state : "off"] ?? [p.state, ""];
    const g = p.keyGuide;
    return `<div class="note gs-prov" role="listitem" draggable="true" data-id="${esc(p.id)}" aria-label="${esc(p.label)}" style="margin:.5em 0">
      <div class="row" style="align-items:center;gap:.6em;flex-wrap:wrap">
        <span class="gs-grip" aria-hidden="true" style="cursor:grab;opacity:.6;padding:0 .2em">⠿</span>
        <b style="font-size:1.08em">${esc(p.label)}</b>
        <span class="hint gs-state ${kind}" data-state="${esc(p.on ? p.state : "off")}" aria-live="polite">${esc(word)}</span>
        <span style="flex:1"></span>
        <button type="button" class="btn small ghost gs-up" aria-label="Move ${esc(p.label)} up" ${i === 0 ? "disabled" : ""}>▲</button>
        <button type="button" class="btn small ghost gs-down" aria-label="Move ${esc(p.label)} down" ${i === order.length - 1 ? "disabled" : ""}>▼</button>
        <button type="button" class="sw gs-on" role="switch" aria-label="Use ${esc(p.label)}" aria-checked="${on[p.id] ? "true" : "false"}"></button>
      </div>
      ${p.needsKey ? `<div class="row" style="gap:.5em;align-items:center;flex-wrap:wrap;margin-top:.5em">
        <input type="password" class="gs-key" autocomplete="off" spellcheck="false" aria-label="${esc(p.label)} key" placeholder="${p.keySet ? "Key saved ✓ (type a new one to replace it)" : "Paste your free key here"}" style="flex:1;min-width:14em">
        <button type="button" class="btn small gs-savekey">Save key</button>
        ${p.keySet ? `<button type="button" class="btn small ghost gs-delkey">Remove key</button>` : ""}
        <button type="button" class="btn small ghost gs-test" ${p.keySet ? "" : "disabled"}>Test</button>
      </div>` : `<div class="hint" style="margin-top:.3em">No key needed. When no other source can answer, the web search always steps in, even if it's switched off here.</div><div class="row" style="margin-top:.4em"><button type="button" class="btn small ghost gs-test">Test</button></div>`}
      ${g ? `<details style="margin-top:.4em"><summary>Get a free ${esc(p.label)} key</summary><ol style="margin:.4em 0 .2em 1.2em;padding:0">${g.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol><a href="${esc(g.url)}" target="_blank" rel="noopener noreferrer">Open ${esc(p.label)}'s developer page ↗</a></details>` : ""}
      <div class="hint" style="margin-top:.3em">Shown with its results: <b>${esc(p.attribution?.text ?? p.label)}</b></div>
    </div>`;
  }
  function paintProviders() {
    const byId = Object.fromEntries(V.providers.map((p) => [p.id, p]));
    $("#gs-provs").innerHTML = order.map((id, i) => card(byId[id], i)).join("");
    for (const c of $$(".gs-prov")) {
      const id = c.dataset.id;
      c.querySelector(".gs-on").onclick = (e) => { e.stopPropagation(); on[id] = !on[id]; e.currentTarget.setAttribute("aria-checked", String(on[id])); dirty(); };
      c.querySelector(".gs-up").onclick = () => move(id, -1);
      c.querySelector(".gs-down").onclick = () => move(id, 1);
      const sk = c.querySelector(".gs-savekey"); if (sk) sk.onclick = () => saveKey(id, c.querySelector(".gs-key").value);
      const dk = c.querySelector(".gs-delkey"); if (dk) dk.onclick = () => { if (confirm(`Remove the ${byId[id].label} key?`)) saveKey(id, ""); };
      const k = c.querySelector(".gs-key"); if (k) k.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); saveKey(id, k.value); } };
      c.querySelector(".gs-test").onclick = () => test(id);
      c.ondragstart = (e) => { e.dataTransfer.setData("text/plain", id); e.dataTransfer.effectAllowed = "move"; c.style.opacity = ".5"; };
      c.ondragend = () => { c.style.opacity = ""; };
      c.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; };
      c.ondrop = (e) => { e.preventDefault(); const from = e.dataTransfer.getData("text/plain"); if (!from || from === id) return; order.splice(order.indexOf(from), 1); order.splice(order.indexOf(id), 0, from); dirty(); paintProviders(); $(`.gs-prov[data-id="${from}"]`)?.focus(); };
    }
  }
  function move(id, d) {
    const i = order.indexOf(id), j = i + d; if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]]; dirty(); paintProviders();
    $(`.gs-prov[data-id="${id}"] ${d < 0 ? ".gs-up" : ".gs-down"}`)?.focus?.();
    if ($(`.gs-prov[data-id="${id}"] ${d < 0 ? ".gs-up" : ".gs-down"}`)?.disabled) $(`.gs-prov[data-id="${id}"] .gs-on`)?.focus();
  }
  const dirty = () => root?.dispatchEvent(new Event("change", { bubbles: true }));
  const msg = (t, kind = "") => { const m = $("#m"); if (m) { m.textContent = t; m.className = `msg ${kind}`; } };
  function setState(id, state, text) {
    const s = $(`.gs-prov[data-id="${id}"] .gs-state`); if (!s) return;
    const [word, kind] = STATE[state] ?? [state, ""];
    s.textContent = text && state !== "ok" ? `${word}: ${text}` : word; s.dataset.state = state; s.className = `hint gs-state ${kind}`;
  }
  async function saveKey(id, key) {
    const k = String(key ?? "").trim();
    try {
      await api("/gifs/keys", { provider: id, key: k });
      opts.toast?.(k ? "Key saved ✓" : "Key removed");
      await refresh(true);
      if (k) await test(id);
    } catch (e) { msg(e.message, "bad"); }
  }
  async function test(id) {
    setState(id, "ready", ""); const s = $(`.gs-prov[data-id="${id}"] .gs-state`); if (s) s.textContent = "Testing…";
    try { const r = await api("/gifs/test", { provider: id }); setState(id, r.state, r.state === "ok" ? "" : r.text); msg(r.text, r.state === "ok" ? "ok" : "bad"); }
    catch (e) { setState(id, "unavailable", e.message); }
  }
  function paint() {
    const s = V.settings;
    order = [...s.order]; on = Object.fromEntries(Object.entries(s.providers).map(([k, v]) => [k, Boolean(v.on)]));
    paintProviders();
    $("#gs-rating").value = s.rating; $("#gs-type").value = s.type ?? "gif"; $("#gs-format").value = s.format; $("#gs-autoplay").value = s.autoplay;
    $("#gs-saver").setAttribute("aria-checked", String(Boolean(s.dataSaver))); $("#gs-say").setAttribute("aria-checked", String(s.sayTitle !== false));
    $("#gs-dir").value = s.saveDir ?? ""; $("#gs-cache").value = String(s.cacheMB);
    paintExtras();
  }
  function paintExtras() {
    const sv = V.save ?? {};
    $("#gs-dirhint").textContent = sv.where === "data" ? `Right now saved GIFs go to Dayspring's own folder (${sv.folder}), because Dayspring may not change files in ${V.settings.saveDir || "your Pictures folder"}. Allow it in Settings → Permissions to save there.` : `Saved GIFs go to ${sv.folder}. Leave this empty for Pictures › Dayspring GIFs.`;
    $("#gs-cacheuse").textContent = `In use: ${mb(V.cache?.bytes ?? 0)} (${V.cache?.files ?? 0} file${V.cache?.files === 1 ? "" : "s"}).`;
    $("#gs-lists").textContent = `${V.favorites} favourite${V.favorites === 1 ? "" : "s"} and ${V.recents} recent GIF${V.recents === 1 ? "" : "s"}, kept on this computer (data\\gifs.json).`;
  }
  async function refresh(keepForm = false) {
    V = await api("/gifs/settings");
    if (!keepForm) return paint();
    // keep what's been changed but not saved; just update the cards and the numbers
    paintProviders(); paintExtras();
  }
  async function save() {
    const cache = Number($("#gs-cache").value);
    if (!Number.isFinite(cache) || cache < 20 || cache > 5000) throw new Error("The cache size must be between 20 and 5000 MB.");
    const patch = {
      order, providers: Object.fromEntries(order.map((id) => [id, { on: Boolean(on[id]) }])),
      rating: $("#gs-rating").value, type: $("#gs-type").value, format: $("#gs-format").value, autoplay: $("#gs-autoplay").value,
      dataSaver: $("#gs-saver").getAttribute("aria-checked") === "true", sayTitle: $("#gs-say").getAttribute("aria-checked") === "true",
      saveDir: $("#gs-dir").value.trim(), cacheMB: Math.round(cache),
    };
    V = await api("/gifs/settings", patch);
    paint();
    return V;
  }
  async function mount(el, o = {}) {
    root = el; opts = o;
    for (const id of ["gs-saver", "gs-say"]) $("#" + id).onclick = (e) => { e.stopPropagation(); const b = e.currentTarget; b.setAttribute("aria-checked", String(b.getAttribute("aria-checked") !== "true")); dirty(); };
    $("#gs-clearcache").onclick = async () => { try { const r = await api("/gifs/clear", { what: "cache" }); V.cache = r.cache; paintExtras(); opts.toast?.(`GIF cache cleared (${r.removed} file${r.removed === 1 ? "" : "s"})`); } catch (e) { msg(e.message, "bad"); } };
    $("#gs-clearfav").onclick = async () => { if (!confirm("Clear all your favourite GIFs?")) return; try { await api("/gifs/clear", { what: "favorites" }); V.favorites = 0; paintExtras(); opts.toast?.("Favourites cleared"); } catch (e) { msg(e.message, "bad"); } };
    $("#gs-clearrec").onclick = async () => { try { await api("/gifs/clear", { what: "recents" }); V.recents = 0; paintExtras(); opts.toast?.("Recent GIFs cleared"); } catch (e) { msg(e.message, "bad"); } };
    try { await refresh(); } catch (e) { msg(e.message, "bad"); }
  }
  window.DayspringGifSettings = { enabled: featureOn, html, mount, save, _state: () => ({ order: order.slice(), on: { ...on } }) };
})();
