// Settings → Look & feel (public/setup.js shows it under "Sound & screen"): the colour theme (15 of them, your own from
// 2–3 colours, Surprise me, a preview on the Dayspring screen), the avatar (five animated ones and your own picture, with
// live previews, a picture per state, Test talking), a look per personality and per saved template, and expression mode
// (GIFs and memes that fit the feeling and the personality; off until turned on). Everything saves as it's changed and
// shows on the screen straight away; "Back to the default look" undoes it all.
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (path, body, method) => {
    const r = await fetch("/api" + path, body === undefined && !method ? {} : { method: method ?? "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "That didn't work. Try again.");
    return j;
  };
  const upload = async (path, file) => {
    const r = await fetch("/api" + path, { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "That upload didn't work.");
    return j;
  };
  const on = (id) => (window.dsFeatures?.on ? window.dsFeatures.on(id) !== false : true);
  const TC = window.DsThemeCore, AC = window.DsAvatarCore;
  let root = null, opts = {}, V = null, P = null, previews = [], previewState = "auto", buildTimer = 0;
  const $ = (s) => root?.querySelector(s);
  const $$ = (s) => [...(root?.querySelectorAll(s) ?? [])];
  const msg = (t, ok = true) => { const m = $("#lf-m"); if (m) { m.textContent = t; m.className = "msg " + (ok ? "ok" : "bad"); } opts.toast?.(t); };
  const mb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

  function html() {
    return `<h1>Look &amp; feel</h1>
      <p class="lead">Dayspring's colours and its face. All of it is optional: the usual look stays until you change it, every change shows on the Dayspring screen straight away, and <b>Back to the default look</b> puts it all back.</p>
      <div id="lf-body"><div class="hint">Loading…</div></div>
      <div class="msg" id="lf-m" role="status" aria-live="polite"></div>`;
  }

  // ---------------------------------------------------------------- colour themes
  function themeCard(t, cur) {
    const tk = TC.tokensFor(t.params ? t : null);
    return `<button type="button" class="lf-theme${cur === t.id ? " on" : ""}" data-theme="${esc(t.id)}" role="radio" aria-checked="${cur === t.id}" style="--tb:${tk.bg};--ts:${tk.surface};--ti:${tk.ink};--tm:${tk.muted};--ta:${tk.accent};--t2:${tk.secondary};--tg:${tk.glass};--te:${tk.edge2}">
      <span class="lf-mock" aria-hidden="true"><i class="bar"></i><span class="c"><b>Aa</b><em>9:41</em></span><span class="pill"></span><span class="dot"></span></span>
      <span class="lf-tn"><b>${esc(t.name)}</b><small>${esc(t.blurb)}</small></span></button>`;
  }
  function themesHTML() {
    const cur = V.settings.theme, list = V.themes.map((t) => themeCard(t, cur)).join("");
    const c = V.settings.custom;
    const customCard = c ? themeCard({ id: "custom", name: c.name || "My theme", blurb: "Your own colours.", params: c.params }, cur) : "";
    const from = V.effective.themeFrom;
    return `<h2>Colour theme</h2>
      ${!on("themes") ? `<div class="note warn">Colour themes are switched off in Settings → Features.</div>` : ""}
      ${from === "personality" || from === "template" ? `<div class="note">The ${from === "template" ? "saved personality (template)" : "current personality"} has its own theme (${esc(V.effective.theme.name)}); it shows instead of the one picked here. Change that below, under <b>Per personality</b>.</div>` : ""}
      <div class="lf-themes" role="radiogroup" aria-label="Colour theme">${list}${customCard}</div>
      <div class="row lf-acts">
        <button type="button" class="btn" id="lf-surprise">🎲 Surprise me</button>
        <button type="button" class="btn" id="lf-preview">👀 Preview on the Dayspring screen</button>
        <button type="button" class="btn ghost" id="lf-reset">Back to the default look</button>
      </div>
      <details class="lf-builder" id="lf-builder"${cur === "custom" ? " open" : ""}><summary><b>Make your own theme</b> <small>pick 2 or 3 colours; the rest is worked out so text stays easy to read</small></summary>
        <div class="row">
          <div class="field"><label for="lf-c1">Main colour</label><input type="color" id="lf-c1" value="${esc(c?.colors?.[0] ?? "#ff6fae")}"></div>
          <div class="field"><label for="lf-c2">Second colour</label><input type="color" id="lf-c2" value="${esc(c?.colors?.[1] ?? "#3ad6c4")}"></div>
          <div class="field"><label for="lf-c3"><input type="checkbox" id="lf-c3on"${c?.colors?.[2] ? " checked" : ""}> Background colour (optional)</label><input type="color" id="lf-c3" value="${esc(c?.colors?.[2] ?? "#1c1030")}"></div>
          <div class="field"><label for="lf-mode">Dark or light</label><select id="lf-mode"><option value="">Automatic</option><option value="dark">Dark</option><option value="light">Light</option></select></div>
          <div class="field"><label for="lf-name">Name</label><input type="text" id="lf-name" maxlength="40" value="${esc(c?.name ?? "My theme")}"></div>
        </div>
        <div class="lf-sample" id="lf-sample" aria-label="A sample of your theme"></div>
        <div class="lf-contrast" id="lf-contrast"></div>
        <div class="row"><button type="button" class="btn primary" id="lf-usecustom">Use this theme</button><button type="button" class="btn" id="lf-previewcustom">Preview it on the screen</button></div>
      </details>
      <p class="hint">Or say “switch to the pink theme”, “green theme”, “surprise me with a theme” or “default theme”.</p>`;
  }
  function builderTheme() {
    const colors = [$("#lf-c1").value, $("#lf-c2").value, ...($("#lf-c3on").checked ? [$("#lf-c3").value] : [])];
    return TC.buildCustom({ colors, mode: $("#lf-mode").value || null, name: $("#lf-name").value.trim() || "My theme" });
  }
  function paintBuilder() {
    let t; try { t = builderTheme(); } catch { return; }
    const tk = TC.tokensFor(t), rep = TC.contrastReport(tk);
    $("#lf-sample").style.cssText = `--tb:${tk.bg};--ts:${tk.surface};--ti:${tk.ink};--tm:${tk.muted};--ta:${tk.accent};--t2:${tk.secondary};--tai:${tk.accentInk};--te:${tk.edge2};--tl:${tk.link}`;
    $("#lf-sample").innerHTML = `<div class="s-card"><b>Up next · 3:30 PM</b><p>Study session: Chapter 4. <a href="#" tabindex="-1">Open lesson</a></p><span class="s-btn">Start</span><span class="s-chip">🎵 Now playing</span></div>`;
    const bad = rep.filter((r) => !r.ok);
    $("#lf-contrast").innerHTML = bad.length ? `<span class="status bad">⚠ ${bad.length} pair${bad.length > 1 ? "s" : ""} too faint</span>` : `<span class="status ok">✓ Easy to read: every text colour passes WCAG AA (lowest ${Math.min(...rep.filter((r) => r.need === 4.5).map((r) => r.ratio)).toFixed(1)}:1)</span>`;
  }

  // ---------------------------------------------------------------- avatars
  const STATE_WORD = { idle: "Idle", listen: "Listening", think: "Thinking", speak: "Talking", muted: "Off (deafened)", stopped: "Stopped listening", error: "Error", sleep: "Sleeping / quiet" };
  function avatarHTML() {
    const cur = V.settings.avatar.style, imgs = V.effective.avatar.images ?? {};
    const cards = V.styles.map((s) => `<button type="button" class="lf-av${cur === s.id ? " on" : ""}" data-style="${s.id}" role="radio" aria-checked="${cur === s.id}">
      <span class="lf-stage" data-prev="${s.id}">${s.id === "image" ? (imgs.idle || Object.values(imgs)[0] ? `<img alt="" src="${esc(imgs.idle || Object.values(imgs)[0])}">` : `<span class="lf-empty">Upload a picture below</span>`) : ""}</span>
      <b>${esc(s.name)}${s.id === "orb" ? ` <small class="tag">default</small>` : ""}</b><small>${esc(s.blurb)}</small></button>`).join("");
    const slots = V.states.map((st) => `<div class="lf-slot" data-state="${st.id}">
      <div class="lf-thumb">${imgs[st.id] ? `<img alt="" src="${esc(imgs[st.id])}">` : `<span>${st.id === "idle" ? "Main picture" : "Uses the main picture"}</span>`}</div>
      <b>${esc(st.name)}</b>
      <label class="btn small"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden data-up="${st.id}">${imgs[st.id] ? "Replace" : "Upload"}</label>
      ${imgs[st.id] ? `<button type="button" class="btn small ghost" data-rm="${st.id}" aria-label="Remove the ${esc(st.name)} picture">✕</button>` : ""}</div>`).join("");
    return `<h2>Avatar</h2>
      ${!on("avatar") ? `<div class="note warn">Avatars are switched off in Settings → Features: the screen shows the orb.</div>` : ""}
      ${V.effective.avatar.from === "personality" || V.effective.avatar.from === "template" ? `<div class="note">The ${V.effective.avatar.from === "template" ? "saved personality (template)" : "current personality"} has its own avatar; it shows instead of the one picked here.</div>` : ""}
      <div class="chips lf-states" role="group" aria-label="Show the previews as">${["auto", ...Object.keys(STATE_WORD)].map((s) => `<button type="button" class="chip${previewState === s ? " on" : ""}" data-pstate="${s}" aria-pressed="${previewState === s}">${s === "auto" ? "▶ All of them" : STATE_WORD[s]}</button>`).join("")}</div>
      <div class="lf-avs" role="radiogroup" aria-label="Avatar">${cards}</div>
      <div class="row lf-acts"><button type="button" class="btn" id="lf-test">🗣 Test talking on the screen</button><button type="button" class="btn" id="lf-testlisten">👂 Test listening</button></div>
      <h3>Your picture</h3>
      <p class="hint">Upload a JPEG, PNG, WebP or GIF. While Dayspring talks it gently grows and shrinks with the voice, and it gets a little bigger while it listens. Add a different picture for any state if you like; the others use the main picture, and each change crossfades. The pictures stay on this computer (Dayspring's <b>data\\avatar</b> folder).</p>
      <div class="lf-slots">${slots}</div>
      <div class="row">
        <div class="field"><label for="lf-fit">Fit</label><select id="lf-fit"><option value="cover"${V.settings.avatar.fit !== "contain" ? " selected" : ""}>Fill the circle</option><option value="contain"${V.settings.avatar.fit === "contain" ? " selected" : ""}>Show the whole picture</option></select></div>
        <div class="field"><label for="lf-round">Shape</label><select id="lf-round"><option value="1"${V.settings.avatar.round !== false ? " selected" : ""}>Round</option><option value="0"${V.settings.avatar.round === false ? " selected" : ""}>Rounded square</option></select></div>
      </div>
      <p class="hint">Or say “use the blob avatar”, “change your avatar” or “go back to the orb”.</p>`;
  }

  // ---------------------------------------------------------------- per personality and template
  function personaHTML() {
    const presets = [...(P?.presets ?? []), ...((P?.secrets?.list ?? []).filter((x) => x.unlocked))];
    const curId = P?.preset ?? "default", pp = V.settings.perPersona ?? {};
    const opt = (list, val, none) => `<option value="">${none}</option>` + list.map(([id, name]) => `<option value="${esc(id)}"${val === id ? " selected" : ""}>${esc(name)}</option>`).join("");
    const avOpts = V.styles.map((s) => [s.id, s.name]), thOpts = [...V.themes.map((t) => [t.id, t.name]), ...(V.settings.custom ? [["custom", V.settings.custom.name || "My theme"]] : [])];
    const rows = presets.map((p) => `<div class="item lf-pp${p.id === curId ? " cur" : ""}" data-preset="${esc(p.id)}"><span class="grow"><span class="t">${esc(p.icon ?? "")} ${esc(p.name)}${p.id === curId ? ' <small class="tag">now</small>' : ""}</span></span>
      <label class="sr" for="pa-${esc(p.id)}">Avatar for ${esc(p.name)}</label><select id="pa-${esc(p.id)}" data-ppav="${esc(p.id)}">${opt(avOpts, pp[p.id]?.avatar, "Avatar: the usual")}</select>
      <label class="sr" for="pt-${esc(p.id)}">Theme for ${esc(p.name)}</label><select id="pt-${esc(p.id)}" data-ppth="${esc(p.id)}">${opt(thOpts, pp[p.id]?.theme, "Theme: the usual")}</select></div>`).join("");
    const tpls = (P?.templates ?? []).map((t) => { const r = V.settings.templates?.[t.id]; return `<div class="item" data-tpl="${esc(t.id)}"><span class="grow"><span class="t">${esc(t.emoji ?? "")} ${esc(t.name)}</span><span class="s">${r ? `Remembers: ${esc(V.styles.find((s) => s.id === r.avatar)?.name ?? "the orb")} · ${esc(r.theme === "custom" ? r.custom?.name ?? "your theme" : V.themes.find((x) => x.id === r.theme)?.name ?? "Default")}` : "Doesn't change the look"}</span></span>
      <button type="button" class="btn small" data-tplsave="${esc(t.id)}">Remember the look in use now</button>${r ? `<button type="button" class="btn small ghost" data-tplforget="${esc(t.id)}">Forget</button>` : ""}</div>`; }).join("");
    return `<h2>Per personality</h2>
      <p class="hint">Give any personality its own avatar or theme (optional). “The usual” means the one picked above.</p>
      <details class="lf-pps"${Object.keys(pp).length ? " open" : ""}><summary>Personalities (${presets.length})</summary><div class="list">${rows || '<div class="hint">Loading…</div>'}</div></details>
      ${tpls ? `<h3>Saved personalities (templates)</h3><p class="hint">A saved personality can remember an avatar and a theme; switching to it switches the look too. A new one remembers the look in use when it's saved.</p><div class="list">${tpls}</div>` : ""}`;
  }

  // ---------------------------------------------------------------- expression mode
  function exprHTML() {
    const e = V.settings.expression, lib = V.expr?.library ?? { total: 0, bytes: 0, counts: {} };
    const pack = V.effective.persona?.preset ?? "default";
    const packInfo = V.packs.find((p) => p.id === pack) ?? V.packs.find((p) => p.id === "default");
    const counts = lib.counts?.[packInfo?.id ?? "default"] ?? {};
    return `<h2>Expression mode</h2>
      <div class="toggle"><div class="txt"><b id="lf-exon-l">Express feelings with GIFs and memes</b><div>Now and then, when Dayspring is excited, proud, puzzled, sympathetic or laughing, a GIF or meme that fits shows in the avatar's place for a loop or two, then the avatar comes back. Each personality has its own kind: the Cowboy's are western, the Robot's are tech and sci-fi, the Default's warm and wholesome. It never repeats one it showed recently.</div></div>
        <button type="button" class="sw" role="switch" id="lf-exon" aria-labelledby="lf-exon-l" aria-checked="${Boolean(e.on)}"></button></div>
      <div class="sub" id="lf-exopts"${e.on ? "" : " hidden"}>
        <div class="row">
          <div class="field"><label for="lf-exrating">Highest rating</label><select id="lf-exrating"><option value="g"${e.rating === "g" ? " selected" : ""}>G: for everyone</option><option value="pg"${e.rating === "pg" ? " selected" : ""}>PG (the usual)</option><option value="pg-13"${e.rating === "pg-13" ? " selected" : ""}>PG-13</option></select></div>
          <div class="field"><label for="lf-exoften">How often</label><select id="lf-exoften">${[["always", "Whenever it clearly feels something"], ["sometimes", "Sometimes (at most about once a minute)"], ["rarely", "Rarely (big feelings only)"], ["events", "Only for events (badges, alarms, errors)"]].map(([v, t]) => `<option value="${v}"${e.often === v ? " selected" : ""}>${t}</option>`).join("")}</select></div>
          <div class="field"><label for="lf-exmax">Keep at most</label><select id="lf-exmax">${[100, 200, 300, 500, 1000].map((n) => `<option value="${n}"${e.maxMB === n ? " selected" : ""}>${n} MB</option>`).join("")}</select></div>
        </div>
        <label class="scshow"><input type="checkbox" id="lf-exvision"${e.vision ? " checked" : ""}> Check each picture before using it (the text in it, and with <b>Describe images with AI</b> on, what's in it)</label>
        <label class="scshow"><input type="checkbox" id="lf-exweb"${e.web ? " checked" : ""}> Find new ones on the web (through Settings → GIFs' sources)</label>
        <label class="scshow"><input type="checkbox" id="lf-exown"${e.own ? " checked" : ""}> Use my own pictures and GIFs</label>
        <label class="scshow"><input type="checkbox" id="lf-exevents"${e.events ? " checked" : ""}> Also for events: a badge earned 🎉, an alarm ⏰, an error that fixed itself</label>
        <h3>Your expression library</h3>
        <p class="hint">${lib.total} kept (${mb(lib.bytes)} of ${e.maxMB} MB)${lib.own ? `, ${lib.own} of them yours` : ""}. For ${esc(packInfo?.genre ?? "warm and wholesome")} (the ${esc(pack)} personality): ${Object.entries(counts).map(([k, n]) => `${esc(V.emotions.find((x) => x.id === k)?.label ?? k)} ${n}`).join(", ") || "none yet"}.</p>
        <div class="row lf-acts">
          <button type="button" class="btn primary" id="lf-build">📚 Build my expression library</button>
          <select id="lf-buildscope" aria-label="For which personalities"><option value="current">This personality and the default</option><option value="all">Every personality (slow)</option></select>
          <button type="button" class="btn ghost" id="lf-buildstop" hidden>Stop</button>
        </div>
        <div class="lf-progress" id="lf-progress" hidden><div class="bar"><i></i></div><div class="hint" id="lf-progt"></div></div>
        <details><summary>See and remove what's kept</summary>
          <div class="row"><div class="field"><label for="lf-libem">Feeling</label><select id="lf-libem"><option value="">All</option>${V.emotions.map((x) => `<option value="${x.id}">${esc(x.label)}</option>`).join("")}</select></div></div>
          <div class="lf-lib" id="lf-lib"></div>
          <button type="button" class="btn small ghost" id="lf-clear">Clear the library (keeps your own)</button>
        </details>
        <h3>Add your own</h3>
        <div class="row">
          <div class="field"><label for="lf-ownem">It shows the feeling</label><select id="lf-ownem">${V.emotions.map((x) => `<option value="${x.id}">${esc(x.label)}</option>`).join("")}</select></div>
          <div class="field"><label for="lf-ownpk">For</label><select id="lf-ownpk"><option value="any">Every personality</option>${V.packs.map((p) => `<option value="${esc(p.id)}">${esc(p.id)}: ${esc(p.genre)}</option>`).join("")}</select></div>
          <div class="field"><label>&nbsp;</label><label class="btn"><input type="file" id="lf-ownfile" accept="image/gif,image/png,image/jpeg,image/webp,video/mp4" hidden>Upload a GIF or picture</label></div>
        </div>
        <div class="note">📜 <b>Where these come from.</b> Dayspring doesn't ship anyone's memes or GIFs. They're found while you use it, through the GIF sources in Settings → GIFs (GIPHY, KLIPY and Imgur with your own free keys, or the web), under those services' terms, and kept only on this computer. Hover over one on the screen to see where it's from. Dayspring's own stickers (used by the Default personality when nothing else is at hand) were drawn for it.</div>
      </div>`;
  }

  // ---------------------------------------------------------------- putting it together
  async function load() {
    const [v, per, ex] = await Promise.all([api("/looks"), api("/persona").catch(() => null), api("/expressions").catch(() => null)]);
    V = v; P = per; V.expr = ex;
    paint();
  }
  function paint() {
    stopPreviews();
    const b = $("#lf-body"); if (!b) return;
    b.innerHTML = themesHTML() + avatarHTML() + personaHTML() + exprHTML();
    wire(); startPreviews(); paintBuilder(); if (V.expr?.build?.running) pollBuild();
  }
  // live previews: every style animates in its card, talking, listening, thinking… in turn (or the state picked)
  function stopPreviews() { for (const p of previews) p.destroy?.(); previews = []; }
  function startPreviews() {
    const cycle = ["idle", "listen", "think", "speak", "speak", "muted", "sleep"];
    const sig = () => { const t = performance.now(); const st = previewState === "auto" ? cycle[Math.floor(t / 2600) % cycle.length] : previewState; return { state: st, level: st === "speak" ? AC.fakeVoice(t) : st === "listen" ? 0.35 : 0, wave: null }; };
    for (const el of $$("[data-prev]")) {
      const s = el.dataset.prev;
      if (s === "image") { const im = el.querySelector("img"); if (!im) continue; let raf = 0; const tick = () => { const S = sig(); im.style.transform = `scale(${S.state === "speak" ? 1.02 + S.level * 0.11 : S.state === "listen" ? 1.07 : 1})`; raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); previews.push({ destroy: () => cancelAnimationFrame(raf) }); continue; }
      if (s === "orb") { import("/eco/client/voice-orb.js").then((m) => { if (!el.isConnected) return; const o = m.mount(el, { mood: "calm", label: "The orb" }); let raf = 0; const tick = () => { const S = sig(); o.setState(S.state === "speak" ? "speak" : S.state === "listen" ? "listen" : S.state === "think" ? "think" : S.state === "idle" ? "idle" : "off"); o.setLevel(S.level); raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); previews.push({ destroy: () => { cancelAnimationFrame(raf); o.destroy(); } }); }).catch(() => {}); continue; }
      previews.push(AC.mount(el, { style: s, signal: sig, fps: 30 }));
    }
  }
  const save = async (patch, note) => { try { const r = await api("/looks", patch); V.settings = r.settings; V.effective = r.effective; if (note) msg(note); return r; } catch (e) { msg(e.message, false); throw e; } };
  function wire() {
    // themes
    $$("[data-theme]").forEach((b) => b.onclick = async () => {
      const id = b.dataset.theme;
      try {
        const r = id === "custom" ? await api("/looks", { theme: "custom" }) : await api("/looks/theme", { id });
        V.settings = r.settings; window.dsThemeApply?.(id === "custom" ? { id: "custom", name: V.settings.custom?.name, params: V.settings.custom?.params } : id);
        $$("[data-theme]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-checked", String(x === b)); });
        msg(`${b.querySelector("b").textContent} theme on. It's on the Dayspring screen too.`);
      } catch (e) { msg(e.message, false); }
    });
    $("#lf-surprise").onclick = async () => { try { const r = await api("/looks/surprise", {}); V.settings = r.settings; window.dsThemeApply?.(r.theme); msg(`How about ${r.theme.name}?`); await load(); } catch (e) { msg(e.message, false); } };
    $("#lf-preview").onclick = async () => { const id = V.settings.theme; try { await api("/looks/theme/preview", id === "custom" ? { colors: V.settings.custom?.colors ?? [], name: V.settings.custom?.name } : { id, ms: 15000 }); msg("Showing on the Dayspring screen for 15 seconds."); } catch (e) { msg(e.message, false); } };
    $("#lf-reset").onclick = async () => {
      try { const r = await api("/looks", { theme: "default", avatar: { style: "orb" }, expression: { on: false } }); V.settings = r.settings; V.effective = r.effective; window.dsThemeApply?.(null); msg("Back to the default look: the dawn theme and the orb."); paint(); } catch (e) { msg(e.message, false); }
    };
    for (const id of ["lf-c1", "lf-c2", "lf-c3", "lf-c3on", "lf-mode", "lf-name"]) $("#" + id).addEventListener("input", paintBuilder);
    $("#lf-usecustom").onclick = async () => { try { const t = builderTheme(); const r = await api("/looks/theme", { colors: t.colors, mode: $("#lf-mode").value || null, name: t.name }); V.settings = r.settings; window.dsThemeApply?.(r.theme); msg(`${t.name} is on.`); paint(); } catch (e) { msg(e.message, false); } };
    $("#lf-previewcustom").onclick = async () => { try { const t = builderTheme(); await api("/looks/theme/preview", { colors: t.colors, mode: $("#lf-mode").value || null, name: t.name, ms: 15000 }); window.dsThemeApply?.(t, { preview: true, ms: 15000 }); msg("Previewing for 15 seconds, here and on the Dayspring screen."); } catch (e) { msg(e.message, false); } };
    // avatars
    $$("[data-pstate]").forEach((b) => b.onclick = () => { previewState = b.dataset.pstate; $$("[data-pstate]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); }); });
    $$("[data-style]").forEach((b) => b.onclick = async () => {
      const s = b.dataset.style;
      if (s === "image" && !Object.keys(V.effective.avatar.images ?? {}).length) { msg("Upload a picture first (the Main picture slot below).", false); root.querySelector('[data-up="idle"]')?.closest("label")?.focus?.(); return; }
      await save({ avatar: { style: s } }, `${b.querySelector("b").childNodes[0].textContent.trim()} is Dayspring's face now.`).catch(() => {});
      $$("[data-style]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-checked", String(x === b)); });
    });
    $("#lf-test").onclick = () => api("/looks/avatar/test", { ms: 5000, state: "speak" }).then(() => msg("Talking on the Dayspring screen for 5 seconds (no sound).")).catch((e) => msg(e.message, false));
    $("#lf-testlisten").onclick = () => api("/looks/avatar/test", { ms: 4000, state: "listen" }).then(() => msg("Listening on the Dayspring screen for 4 seconds.")).catch((e) => msg(e.message, false));
    $$("[data-up]").forEach((inp) => inp.onchange = async () => {
      const f = inp.files?.[0]; if (!f) return;
      try { const first = !Object.keys(V.effective.avatar.images ?? {}).length; await upload(`/looks/avatar/upload?state=${encodeURIComponent(inp.dataset.up)}${first ? "&use=1" : ""}`, f); msg(first ? "Picture saved, and it's Dayspring's face now." : "Picture saved."); await load(); }
      catch (e) { msg(e.message, false); }
    });
    $$("[data-rm]").forEach((b) => b.onclick = async () => { try { await api(`/looks/avatar/upload?state=${encodeURIComponent(b.dataset.rm)}`, undefined, "DELETE"); msg("Picture removed."); await load(); } catch (e) { msg(e.message, false); } });
    $("#lf-fit").onchange = () => save({ avatar: { fit: $("#lf-fit").value } }, "Saved.").catch(() => {});
    $("#lf-round").onchange = () => save({ avatar: { round: $("#lf-round").value === "1" } }, "Saved.").catch(() => {});
    // per personality / template
    $$("[data-ppav]").forEach((s) => s.onchange = () => api("/looks/persona", { preset: s.dataset.ppav, avatar: s.value }).then((r) => { V.settings = r.settings; V.effective = r.effective; msg("Saved for that personality."); }).catch((e) => msg(e.message, false)));
    $$("[data-ppth]").forEach((s) => s.onchange = () => api("/looks/persona", { preset: s.dataset.ppth, theme: s.value }).then((r) => { V.settings = r.settings; V.effective = r.effective; window.dsThemeRefresh?.(); msg("Saved for that personality."); }).catch((e) => msg(e.message, false)));
    $$("[data-tplsave]").forEach((b) => b.onclick = () => api("/looks/template", { id: b.dataset.tplsave, remember: true }).then(() => { msg("That saved personality now remembers this look."); return load(); }).catch((e) => msg(e.message, false)));
    $$("[data-tplforget]").forEach((b) => b.onclick = () => api("/looks/template", { id: b.dataset.tplforget, remember: false }).then(() => load()).catch((e) => msg(e.message, false)));
    // expression mode
    $("#lf-exon").onclick = async () => { const v = $("#lf-exon").getAttribute("aria-checked") !== "true"; await save({ expression: { on: v } }, v ? "Expression mode is on." : "Expression mode is off.").catch(() => {}); $("#lf-exon").setAttribute("aria-checked", String(v)); $("#lf-exopts").hidden = !v; };
    const exSet = (k, val, note = "Saved.") => save({ expression: { [k]: val } }, note).catch(() => {});
    $("#lf-exrating").onchange = () => exSet("rating", $("#lf-exrating").value);
    $("#lf-exoften").onchange = () => exSet("often", $("#lf-exoften").value);
    $("#lf-exmax").onchange = () => exSet("maxMB", Number($("#lf-exmax").value));
    for (const [id, k] of [["lf-exvision", "vision"], ["lf-exweb", "web"], ["lf-exown", "own"], ["lf-exevents", "events"]]) $("#" + id).onchange = () => exSet(k, $("#" + id).checked);
    $("#lf-build").onclick = async () => { try { await api("/expressions/build", $("#lf-buildscope").value === "all" ? { all: true } : { personas: "current" }); pollBuild(); } catch (e) { msg(e.message, false); } };
    $("#lf-buildstop").onclick = () => api("/expressions/build/cancel", {}).catch(() => {});
    $("#lf-libem").onchange = paintLib;
    $("#lf-clear").onclick = async () => { if (!confirm("Clear the expression library? Your own pictures stay.")) return; await api("/expressions/clear", { keepOwn: true }).catch(() => {}); msg("Cleared."); await load(); };
    $("#lf-ownfile").onchange = async () => {
      const f = $("#lf-ownfile").files?.[0]; if (!f) return;
      try { await upload(`/expressions/upload?emotion=${encodeURIComponent($("#lf-ownem").value)}&persona=${encodeURIComponent($("#lf-ownpk").value)}&title=${encodeURIComponent(f.name.replace(/\.[^.]+$/, ""))}`, f); msg("Added to your expression library."); await load(); }
      catch (e) { msg(e.message, false); }
    };
    root.querySelector(".lf-pps")?.addEventListener("toggle", () => {}, { once: true });
    const det = $("#lf-lib")?.closest("details"); det?.addEventListener("toggle", () => { if (det.open) paintLib(); });
  }
  async function paintLib() {
    const pack = V.effective.persona?.preset ?? "default";
    const em = $("#lf-libem").value;
    const r = await api(`/expressions/list?pack=${encodeURIComponent(pack)}${em ? "&emotion=" + em : ""}&limit=60`).catch(() => ({ items: [] }));
    $("#lf-lib").innerHTML = r.items.length ? r.items.map((x) => `<figure class="lf-gif" title="${esc(x.title)}${x.attribution?.text ? " · " + esc(x.attribution.text) : ""}">${x.type === "video/mp4" ? `<video src="${esc(x.url)}" muted loop autoplay playsinline></video>` : `<img alt="${esc(x.title)}" src="${esc(x.url)}" loading="lazy">`}
      <figcaption>${esc(V.emotions.find((e) => e.id === x.emotion)?.label ?? x.emotion)} · ${x.loopMs ? (x.loopMs / 1000).toFixed(1) + " s loop" : "still"}${x.own ? " · yours" : ""}</figcaption><button type="button" class="btn small ghost" data-del="${esc(x.id)}" aria-label="Remove ${esc(x.title)}">✕</button></figure>`).join("") : `<p class="hint">Nothing kept for this personality${em ? " and feeling" : ""} yet.</p>`;
    $$("[data-del]").forEach((b) => b.onclick = async () => { await api(`/expressions/item/${encodeURIComponent(b.dataset.del)}`, undefined, "DELETE").catch(() => {}); b.closest("figure").remove(); });
  }
  function pollBuild() {
    clearTimeout(buildTimer);
    const tick = async () => {
      const s = await api("/expressions/build").catch(() => null);
      if (!s || !root?.isConnected) return;
      const box = $("#lf-progress"); if (!box) return;
      box.hidden = false; $("#lf-buildstop").hidden = !s.running; $("#lf-build").disabled = Boolean(s.running);
      const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
      box.querySelector(".bar i").style.width = pct + "%";
      box.querySelector(".bar").setAttribute("role", "progressbar"); box.querySelector(".bar").setAttribute("aria-valuenow", String(pct)); box.querySelector(".bar").setAttribute("aria-valuemin", "0"); box.querySelector(".bar").setAttribute("aria-valuemax", "100");
      $("#lf-progt").textContent = s.running ? `${pct}% · ${s.current ?? "starting"} · ${s.added} added, ${s.rejected} left out (didn't fit or weren't clean)` : s.finishedAt ? `Done: ${s.added} added, ${s.rejected} left out${s.stopped ? " (stopped)" : ""}${s.lastWhy && !s.added ? ` · ${s.lastWhy}` : ""}.` : "";
      if (s.running) buildTimer = setTimeout(tick, 1500); else if (s.finishedAt) api("/expressions").then((x) => { V.expr = x; }).catch(() => {});
    };
    tick();
  }
  function mount(el, o = {}) {
    root = el; opts = o;
    if (!TC || !AC) { $("#lf-body").innerHTML = `<p class="hint">This page didn't load completely. Reload to try again.</p>`; return; }
    load().catch((e) => { $("#lf-body").innerHTML = `<p class="hint">${esc(e.message)}</p>`; });
  }
  function leave() { stopPreviews(); clearTimeout(buildTimer); }
  window.DayspringLooks = { html, mount, leave, enabled: on("themes") || on("avatar") };
})();
