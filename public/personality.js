// Settings → Personality: characters, saved personalities, the base sliders (with pins and live nudging), each
// character's own role sliders, a custom persona from up to 300 words, and a live preview. Saves as you go.
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (path, body) => {
    const r = await fetch("/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "That didn't work. Try again.");
    return j;
  };
  const MAX_WORDS = 300;
  const words = (t) => (String(t).trim().match(/\S+/g) ?? []).length;
  let S = null, root = null, opts = {}, draftCard = null;
  const TRAITS = [
    ["warmth", "Warmth", "Cool", "Sweet on you", "Businesslike and to the point.", "Warm, then affectionate, then wholesomely devoted (never romantic)."],
    ["humour", "Humour", "Solemn", "Jokester", "Serious and steady; no jokes.", "Playful, then full of quips (60+ offers jokes)."],
    ["bite", "Bite", "Gentle", "Sassy", "Soft and kind, never teases.", "Teasing and a little sassy, always affectionate."],
    ["praise", "Praise", "Candid", "Flattering", "Tells it straight.", "Encouraging, then a full cheerleader."],
    ["care", "Care style", "Motherly", "Fatherly", "Nurturing reminders and kind fussing.", "Steady and practical: here's what we'll do."],
    ["maturity", "Maturity", "Childlike", "Professor", "Wonder, simple words, easily excited.", "Precise and scholarly."],
    ["formality", "Formality", "Broski", "Courtly", "Casual, then full bro.", "Formal, then grandly courteous."],
    ["length", "Length", "Brief", "Explanatory", "One or two sentences.", "Explains the why and the how."],
    ["curiosity", "Curiosity", "Tells", "Asks", "States things; few questions.", "Follow-up questions and check-ins."],
    ["energy", "Energy", "Mellow", "Hyped", "Calm and slow.", "Excited and upbeat."],
    ["outlook", "Outlook", "Brooding", "Sunny", "Theatrically gloomy (never hopeless).", "Upbeat, sees the bright side."],
    ["flavour", "Flavour", "None", "Heavy", "Plain words, no accent.", "Thick character accent or dialect."],
  ];

  const slider = (kind, id, label, left, right, tipL, tipR, value, pinned) => `
    <div class="ps-row" data-kind="${kind}" data-id="${esc(id)}">
      <div class="ps-lbl"><span>${esc(label)}</span>${kind === "base" ? `<button type="button" class="ps-pin${pinned ? " on" : ""}" data-pin="${esc(id)}" aria-pressed="${pinned}" title="${pinned ? "Pinned: other sliders won't move it" : "Pin so other sliders don't nudge it"}">${pinned ? "🔒" : "🔓"}</button>` : ""}<output id="ps-v-${kind}-${esc(id)}">${value}</output></div>
      <div class="ps-track"><span class="ps-end" title="${esc(tipL)}">${esc(left)}</span>
        <input type="range" min="-100" max="100" step="1" value="${value}" id="ps-${kind}-${esc(id)}" aria-label="${esc(label)}: ${esc(left)} to ${esc(right)}" title="${esc(tipL)} ↔ ${esc(tipR)}">
        <span class="ps-end r" title="${esc(tipR)}">${esc(right)}</span></div>
    </div>`;

  function presetCards() {
    return (S.presets ?? []).map((p) => `<button type="button" class="ps-card${S.preset === p.id && !S.activeTemplate ? " on" : ""}" data-preset="${esc(p.id)}" title="${esc(p.blurb)}"><span class="ps-ico">${esc(p.icon)}</span><b>${esc(p.name)}</b><small>${esc(p.blurb)}</small></button>`).join("");
  }
  function templateCards() {
    if (!S.templates?.length) return `<p class="hint">Nothing saved yet. Set things up the way you like, then press <b>Save as…</b>. You can keep up to 50.</p>`;
    return S.templates.map((t) => `<div class="ps-card saved${S.activeTemplate === t.id ? " on" : ""}" data-tid="${esc(t.id)}">
      <button type="button" class="ps-use" data-apply="${esc(t.id)}"><span class="ps-ico">${esc(t.emoji || "⭐")}</span><b>${esc(t.name)}</b><small>${S.defaultTemplate === t.id ? "Default · " : ""}${esc(t.voice ? "Voice: " + t.voice : "")}</small></button>
      <div class="ps-acts"><button type="button" data-tact="rename" title="Rename">✎</button><button type="button" data-tact="duplicate" title="Duplicate">⧉</button><button type="button" data-tact="default" title="${S.defaultTemplate === t.id ? "Default personality" : "Set as default"}">${S.defaultTemplate === t.id ? "★" : "☆"}</button><button type="button" data-tact="delete" title="Delete">🗑</button></div></div>`).join("");
  }
  function roleSliders() {
    const preset = (S.presets ?? []).find((p) => p.id === S.preset);
    const secret = S.secrets?.list?.find((x) => x.id === S.preset && !x.locked);
    const roles = S.preset === "custom" ? (S.custom?.card?.roles ?? []).map((r) => ({ ...r, def: r.value })) : preset?.roles ?? secret?.roles ?? [];
    if (!roles.length) return S.preset === "custom" ? `<p class="hint">This custom personality has no role sliders yet. With an AI key, "Build persona" invents 2–4 that fit it.</p>` : `<p class="hint">The Default personality has no role sliders. Pick a character above to get its own.</p>`;
    return roles.map((r) => slider("role", r.id, `${r.left} ↔ ${r.right}`, r.left, r.right, r.tipL, r.tipR, S.role?.[r.id] ?? r.def ?? 0, false)).join("");
  }
  const secretCount = () => `Secrets found: ${S.secrets.found} of ${S.secrets.total}` + (S.secrets.xp?.available ? ` · Your XP: ${S.secrets.xp.balance ?? "?"}` : "");
  function secretCards() {
    const v = S.secrets; if (!v) return "";
    return v.list.map((x) => x.locked
      ? `<div class="ps-card locked" title="${esc(x.hint)}"><span class="ps-ico">❔</span><b>???</b><small>${esc(x.hint)}</small>${x.clue ? `<small class="ps-clue">💡 ${esc(x.clue)}</small>` : ""}</div>`
      : !x.unlocked
      ? `<div class="ps-card found" title="${esc(x.blurb)}"><span class="ps-ico">${esc(x.icon)}</span><b>${esc(x.name)}</b><small>${esc(x.blurb)}</small><button type="button" class="btn ps-unlock" data-unlock="${esc(x.id)}"${v.xp?.available && v.xp.balance != null && v.xp.balance < x.cost ? " disabled" : ""}>🔒 Unlock for ${esc(x.cost)} XP</button></div>`
      : `<button type="button" class="ps-card secret${S.preset === x.id && !S.activeTemplate ? " on" : ""}" data-preset="${esc(x.id)}" title="${esc(x.blurb)}"><span class="ps-ico">${esc(x.icon)}</span><b>${esc(x.name)}</b><small>${esc(x.blurb)}</small></button>`).join("");
  }
  function html() {
    return `<h1>Personality</h1>
      <p class="lead">How Dayspring talks: pick a character, fine-tune it with the sliders, or describe your own. Facts like times and alarms always stay clear.</p>
      <div class="ps-now"><span id="ps-desc"></span><button type="button" class="btn ghost" id="ps-normal">Back to normal</button><button type="button" class="btn" id="ps-save">Save as…</button></div>
      <div id="ps-offer" hidden></div>
      <h2>Your saved personalities</h2><div class="ps-gallery" id="ps-saved"></div>
      <h2>Characters</h2><div class="ps-gallery" id="ps-presets"></div>
      <h2>Secret characters <small id="ps-secret-count"></small></h2>
      <p class="hint">Some characters are hidden. Find them by what you say, how you set the sliders, or what you do.</p>
      <div class="ps-gallery" id="ps-secrets"></div>
      <div class="row ps-secret-tools"><label><input type="checkbox" id="ps-hints"> Reveal all hints</label><button type="button" class="btn ghost" id="ps-reset-secrets">Reset discoveries</button></div>
      <h2>Fine-tune</h2><p class="hint">Moving a slider gently nudges related ones. Pin 🔒 any slider to keep it where it is.</p><div class="ps-sliders" id="ps-base"></div>
      <h2 id="ps-role-h">This character</h2><div class="ps-sliders" id="ps-role"></div>
      <h2>Preview</h2><div class="ps-preview" id="ps-preview" aria-live="polite"></div>
      <h2>Describe your own</h2>
      <p class="hint">Up to 300 words, for example: "a grumpy lighthouse keeper who secretly loves people". With an AI key, Dayspring builds a full persona with its own sliders; without one, it sets the sliders from your words.</p>
      <textarea id="ps-custom" rows="5" maxlength="3000" placeholder="Describe the personality…"></textarea>
      <div class="ps-count"><span id="ps-words">0 / ${MAX_WORDS} words</span><button type="button" class="btn" id="ps-build">Build persona</button></div>
      <div id="ps-card" hidden></div>
      <details class="ps-io"><summary>Export or import saved personalities</summary>
        <div class="row"><button type="button" class="btn ghost" id="ps-export">Export</button><button type="button" class="btn ghost" id="ps-import">Import</button><label><input type="checkbox" id="ps-replace"> Replace my saved ones</label></div>
        <textarea id="ps-io" rows="4" placeholder="Exported personalities appear here. Paste a file's text here to import."></textarea></details>
      <div id="ps-lab-slot"></div>
      <div class="msg" id="m"></div>`;
  }
  const $ = (q) => root.querySelector(q);
  const toast = (t, b) => (opts.toast ? opts.toast(b ? `${t}. ${b}` : t) : console.log(t, b));

  function paint() {
    $("#ps-desc").textContent = S.describe ?? "";
    $("#ps-saved").innerHTML = templateCards();
    $("#ps-presets").innerHTML = presetCards();
    $("#ps-secrets").innerHTML = secretCards();
    if (S.secrets) { $("#ps-secret-count").textContent = secretCount(); $("#ps-hints").checked = Boolean(S.secrets.revealHints); }
    $("#ps-base").innerHTML = TRAITS.map(([id, label, l, r, tl, tr]) => slider("base", id, label, l, r, tl, tr, S.base?.[id] ?? 0, (S.pins ?? []).includes(id))).join("");
    $("#ps-role").innerHTML = roleSliders();
    if (S.sage) $("#ps-role-h").textContent = "This character ✨";
    preview();
  }
  let pvT = 0;
  function preview() {
    clearTimeout(pvT);
    pvT = setTimeout(async () => {
      try {
        const p = await api("/persona/preview", {});
        $("#ps-preview").innerHTML = [["Hello", p.greeting], ["Okay", p.ack], ["Done", p.done], ["A reply", p.reply], ["Timer done", p.timerDone], ["Good news", p.goodNews], ["Bad news", p.badNews]].filter(([, v]) => v).map(([k, v]) => `<div><span>${esc(k)}</span>${esc(v ?? "")}</div>`).join("");
      } catch { /* preview is a nicety */ }
    }, 200);
  }
  function offer(o) {
    const box = $("#ps-offer");
    if (!o) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<div class="note">${esc(o.ask)} <button type="button" class="btn" id="ps-voice-yes">Use ${esc(o.voice)}</button> <button type="button" class="btn ghost" id="ps-voice-no">No thanks</button></div>`;
    $("#ps-voice-yes").onclick = async () => { try { await api("/persona/voice", { voice: o.voice }); toast("Voice changed", `Now speaking as ${o.voice}.`); } catch (e) { toast("Voice", e.message); } box.hidden = true; };
    $("#ps-voice-no").onclick = () => { box.hidden = true; };
  }
  function after(r) {
    S = r; paint();
    if (r.voiceOffer) offer(r.voiceOffer);
    if (r.switchedVoice) toast("Voice changed", `Now speaking as ${r.switchedVoice}.`);
    if (r.easter?.toast) toast(r.easter.toast, "A wise old voice stirs among the stars.");
    if (r.discovered) celebrate(r.discovered);
  }
  function celebrate(d) {
    toast(d.text, d.line || "");
    const box = document.createElement("div"); box.className = "ps-found"; box.setAttribute("role", "status");
    box.innerHTML = `<span class="ps-ico">${esc(d.icon)}</span><div><b>${esc(d.title || "✨ Secret character discovered")}</b><br>${esc(d.name)}: ${esc(d.reveal)}</div>`;
    document.body.appendChild(box); setTimeout(() => box.remove(), 6000);
  }
  // animate a slider to its new value (the ones nudged by another)
  function glide(input, to) {
    const from = Number(input.value), t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / 260); input.value = String(Math.round(from + (to - from) * k)); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
    const row = input.closest(".ps-row"); row?.classList.add("nudged"); setTimeout(() => row?.classList.remove("nudged"), 500);
  }
  const pending = {};
  function onSlide(e) {
    const inp = e.target.closest("input[type=range]"); if (!inp) return;
    const row = inp.closest(".ps-row"), kind = row.dataset.kind, id = row.dataset.id;
    const out = root.querySelector(`#ps-v-${kind}-${CSS.escape(id)}`); if (out) out.textContent = inp.value;
    clearTimeout(pending[kind + id]);
    pending[kind + id] = setTimeout(async () => {
      try {
        const r = await api("/persona/slider", { kind, id, value: Number(inp.value) });
        for (const [mid, v] of Object.entries(r.moved ?? {})) {
          if (mid === id) continue;
          const other = root.querySelector(`#ps-${kind}-${CSS.escape(mid)}`);
          if (other) { glide(other, v); const o = root.querySelector(`#ps-v-${kind}-${CSS.escape(mid)}`); if (o) o.textContent = v; }
        }
        S = r; $("#ps-desc").textContent = S.describe ?? "";
        if (r.easter?.toast) { toast(r.easter.toast, "A wise old voice stirs among the stars."); $("#ps-role-h").textContent = "This character ✨"; }
        if (r.discovered) { celebrate(r.discovered); $("#ps-secrets").innerHTML = secretCards(); $("#ps-secret-count").textContent = secretCount(); }
        preview();
      } catch (err) { toast("Personality", err.message); }
    }, 120);
  }
  function counter() {
    const n = words($("#ps-custom").value);
    const over = n > MAX_WORDS;
    $("#ps-words").textContent = `${n} / ${MAX_WORDS} words${over ? ": please trim it down" : ""}`;
    $("#ps-words").classList.toggle("over", over);
    $("#ps-build").disabled = over || n === 0;
  }
  function showCard(r) {
    draftCard = r.card;
    const c = r.card, box = $("#ps-card");
    box.hidden = false;
    box.innerHTML = `<div class="ps-review"><h3>Review your persona</h3>
      ${r.notes?.length ? `<div class="note">${r.notes.map(esc).join("<br>")}</div>` : ""}
      <label>Name <input type="text" id="ps-card-name" maxlength="40" value="${esc(c.name)}"></label>
      <label>Summary <input type="text" id="ps-card-sum" maxlength="160" value="${esc(c.summary)}"></label>
      ${c.rules?.length ? `<ul>${c.rules.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${c.roles?.length ? `<p><b>Its own sliders:</b> ${c.roles.map((x) => `${esc(x.left)} ↔ ${esc(x.right)}`).join(" · ")}</p>` : ""}
      ${c.samples?.length ? `<p><b>Sounds like:</b> ${c.samples.map((x) => `“${esc(x)}”`).join(" ")}</p>` : ""}
      <div class="row"><button type="button" class="btn" id="ps-card-use">Use this persona</button><button type="button" class="btn ghost" id="ps-card-cancel">Cancel</button></div></div>`;
    $("#ps-card-use").onclick = async () => {
      try {
        const card = { ...draftCard, name: $("#ps-card-name").value || draftCard.name, summary: $("#ps-card-sum").value };
        const s = await api("/persona/custom", { text: $("#ps-custom").value, card });
        box.hidden = true; after(s); toast("Personality", `Now: ${card.name}. Press "Save as…" to keep it.`);
      } catch (e) { toast("Personality", e.message); }
    };
    $("#ps-card-cancel").onclick = () => { box.hidden = true; };
  }
  // the in-page question (no browser pop-ups): text input when ask.input
  function ask(q, { input = false, value = "" } = {}) {
    return new Promise((res) => {
      const d = document.createElement("div"); d.className = "ps-dialog"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true");
      d.innerHTML = `<div class="ps-dbox"><p>${esc(q)}</p>${input ? `<input type="text" maxlength="40" value="${esc(value)}">` : ""}<div class="row"><button type="button" class="btn" data-ok>OK</button><button type="button" class="btn ghost" data-no>Cancel</button></div></div>`;
      document.body.appendChild(d);
      const inp = d.querySelector("input"); (inp ?? d.querySelector("[data-ok]")).focus();
      const done = (v) => { d.remove(); res(v); };
      d.querySelector("[data-ok]").onclick = () => done(input ? inp.value.trim() : true);
      d.querySelector("[data-no]").onclick = () => done(null);
      d.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); done(null); } if (e.key === "Enter") done(input ? inp.value.trim() : true); });
    });
  }

  // ------------------------------------------------------------------------------------------------ the Personality lab
  // Developer preview only: /api/dev/* answers on the developer's own computer and 404s everywhere else, so nobody else
  // ever sees this section. Hear any character (secret ones too) in its own voice without switching, unlocking or
  // discovering anything; try one for 10 minutes; play with a slider sandbox. Unlock all / reset are separate and logged.
  const L = { chars: [], filter: "all", sel: null, base: {}, role: {}, lines: null, trial: null, tick: 0, audio: null, gen: 0 };
  const KIND = { preset: "Character", secret: "Secret", easter: "Easter egg" };
  const labEl = () => root.querySelector("#ps-lab");
  async function lab() {
    const want = new URLSearchParams(location.search).get("lab");      // read now: Settings tidies the address after mounting
    const st = await fetch("/api/dev/status").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!st?.dev) return;
    const slot = root.querySelector("#ps-lab-slot"); if (!slot) return;
    slot.innerHTML = `<section id="ps-lab" class="ps-lab" aria-labelledby="ps-lab-h">
      <h2 id="ps-lab-h">Personality lab <span class="ps-devtag">Dev preview</span></h2>
      <p class="hint">Only you see this: this computer holds the developer's token. Hear any character, including secret ones you haven't found, in its own voice, without switching or unlocking anything. Your unlocks, XP costs and discoveries stay exactly as they are.</p>
      <div id="ps-lab-trial" aria-live="polite"></div>
      <div class="row ps-lab-tools"><label>Show <select id="ps-lab-filter"><option value="all">Everyone</option><option value="preset">Characters</option><option value="secret">Secret characters</option><option value="easter">Easter egg</option></select></label>
        <button type="button" class="btn ghost" data-lab="unlock-all">Dev: unlock all (testing)</button><button type="button" class="btn ghost" data-lab="reset-unlocks">Dev: reset unlocks</button></div>
      <div class="ps-gallery" id="ps-lab-list"></div>
      <div id="ps-lab-box"></div></section>`;
    const el = labEl();
    el.addEventListener("click", labClick);
    el.addEventListener("input", labSlide);
    el.querySelector("#ps-lab-filter").onchange = (e) => { L.filter = e.target.value; labList(); };
    await labLoad();
    // opened by voice: /setup?s=personality&lab=secrets or &lab=cowboy
    if (want) {
      if (["secrets", "secret"].includes(want)) { L.filter = "secret"; el.querySelector("#ps-lab-filter").value = "secret"; labList(); }
      else if (L.chars.some((c) => c.key === want)) await labOpen(want);
      setTimeout(() => el.scrollIntoView({ block: "start" }), 150);
    }
  }
  async function labLoad() {
    const r = await api("/dev/persona/characters");
    L.chars = r.characters ?? []; L.trial = r.trial ?? null;
    labList(); labTrial();
  }
  const charByKey = (k) => L.chars.find((c) => c.key === k);
  function labList() {
    const list = L.chars.filter((c) => L.filter === "all" || c.kind === L.filter);
    labEl().querySelector("#ps-lab-list").innerHTML = list.map((c) => {
      const state = c.kind !== "secret" ? "" : c.unlocked ? (c.devUnlocked ? "Unlocked (dev, testing)" : "Unlocked") : c.discovered ? "Found, not unlocked" : "Not found yet";
      return `<div class="ps-card lab${L.sel === c.key ? " on" : ""}" data-lab-key="${esc(c.key)}"><span class="ps-ico">${esc(c.icon)}</span><b>${esc(c.name)}</b>
        <small><span class="ps-devtag k-${esc(c.kind)}">${esc(KIND[c.kind])}</span>${state ? ` ${esc(state)}` : ""}</small><small>${esc(c.blurb)}</small>
        <div class="ps-lab-acts"><button type="button" data-lab-hear="${esc(c.key)}" title="Hear sample lines in its voice">▶ Hear</button><button type="button" data-lab-open="${esc(c.key)}">Lines &amp; sliders</button><button type="button" data-lab-try="${esc(c.key)}" title="Switch to it for 10 minutes, then back">Try 10 min</button></div></div>`;
    }).join("");
  }
  function labTrial() {
    const box = labEl()?.querySelector("#ps-lab-trial"); if (!box) return;
    clearInterval(L.tick);
    if (!L.trial) { box.innerHTML = ""; return; }
    const draw = () => {
      const left = Math.max(0, L.trial.until - Date.now());
      if (!left) { clearInterval(L.tick); L.trial = null; box.innerHTML = ""; api("/persona").then(after).catch(() => {}); labLoad().catch(() => {}); return; }
      const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      box.innerHTML = `<div class="note ps-lab-trial"><span class="ps-devtag">Dev preview</span> Trying <b>${esc(L.trial.name)}</b> · ${m}:${String(s).padStart(2, "0")} left, then back to what you had. <button type="button" class="btn ghost" data-lab="end-trial">End now</button></div>`;
    };
    draw(); L.tick = setInterval(draw, 1000);
  }
  async function labPreview() {
    const c = charByKey(L.sel); if (!c) return;
    const r = await api("/persona/preview", { id: c.id, base: L.base, role: L.role });
    L.lines = r;
    const box = labEl().querySelector("#ps-lab-lines"); if (!box) return;
    box.innerHTML = [["Hello", r.greeting], ["Okay", r.ack], ["Done", r.done], ["A reply", r.reply], ["Timer done", r.timerDone], ["Good news", r.goodNews], ["Bad news", r.badNews], ["Not sure", r.notSure]]
      .filter(([, v]) => v).map(([k, v]) => `<div><span>${esc(k)}</span>${esc(v)}</div>`).join("");
    const d = labEl().querySelector("#ps-lab-desc"); if (d) d.textContent = `${r.describe ?? ""}${r.sage ? " ✨ (the easter egg is awake)" : ""}`;
  }
  async function labOpen(key) {
    const c = charByKey(key); if (!c) return;
    L.sel = key; L.base = { ...c.base }; L.role = { ...Object.fromEntries((c.roles ?? []).map((r) => [r.id, r.def ?? 0])), ...(c.role ?? {}) };
    labList();
    const box = labEl().querySelector("#ps-lab-box");
    box.innerHTML = `<div class="ps-lab-box"><h3>${esc(c.icon)} ${esc(c.name)} <span class="ps-devtag">Dev preview</span></h3><p class="hint" id="ps-lab-desc"></p>
      <div class="row"><button type="button" class="btn" data-lab="hear">▶ Hear these lines</button><button type="button" class="btn ghost" data-lab="stop">■ Stop</button><button type="button" class="btn ghost" data-lab-try="${esc(c.key)}">Try it for 10 minutes</button><button type="button" class="btn ghost" data-lab="reset-sliders">Reset sliders</button></div>
      <p class="hint">Voice: ${esc(c.voice?.name ?? "the current voice")}. Nothing here is saved: the sliders only change this preview.</p>
      <div class="ps-preview" id="ps-lab-lines" aria-live="polite"></div>
      <h4>Slider sandbox</h4><div class="ps-sliders">${TRAITS.map(([id, label, l, r, tl, tr]) => labSlider("base", id, label, l, r, tl, tr, L.base[id] ?? 0)).join("")}</div>
      ${(c.roles ?? []).length ? `<h4>This character</h4><div class="ps-sliders">${c.roles.map((r) => labSlider("role", r.id, `${r.left} ↔ ${r.right}`, r.left, r.right, r.tipL, r.tipR, L.role[r.id] ?? 0)).join("")}</div>` : ""}</div>`;
    await labPreview();
  }
  const labSlider = (kind, id, label, left, right, tipL, tipR, value) => `
    <div class="ps-lab-row"><div class="ps-lbl"><span>${esc(label)}</span><output data-lab-out="${kind}-${esc(id)}">${value}</output></div>
      <div class="ps-track"><span class="ps-end" title="${esc(tipL)}">${esc(left)}</span><input type="range" min="-100" max="100" step="1" value="${value}" data-lab-kind="${kind}" data-lab-id="${esc(id)}" aria-label="${esc(label)} (sandbox): ${esc(left)} to ${esc(right)}"><span class="ps-end r" title="${esc(tipR)}">${esc(right)}</span></div></div>`;
  let labT = 0;
  function labSlide(e) {
    const inp = e.target.closest("input[type=range][data-lab-kind]"); if (!inp) return;
    const kind = inp.dataset.labKind, id = inp.dataset.labId, v = Number(inp.value);
    (kind === "role" ? L.role : L.base)[id] = v;
    const o = labEl().querySelector(`[data-lab-out="${kind}-${CSS.escape(id)}"]`); if (o) o.textContent = v;
    clearTimeout(labT); labT = setTimeout(() => labPreview().catch((err) => toast("Personality lab", err.message)), 150);
  }
  function stopHear() { L.gen++; try { L.audio?.pause(); } catch { /* gone */ } L.audio = null; try { window.speechSynthesis?.cancel(); } catch { /* none */ } }
  async function hear(text, voice) {
    stopHear(); const g = L.gen;
    const r = await fetch("/api/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, ...(voice?.name ? { voice: voice.name } : {}) }) });
    if (g !== L.gen) return;
    if (r.status === 204) {                  // free voices: this page speaks, with the character's voice if Windows has it
      const u = new SpeechSynthesisUtterance(text), vs = window.speechSynthesis?.getVoices?.() ?? [];
      const pick = voice?.edge && vs.find((v) => v.name.toLowerCase().includes(voice.edge.toLowerCase()) && /^en/i.test(v.lang));
      if (pick) u.voice = pick;
      window.speechSynthesis?.speak(u); return;
    }
    if (!r.ok) { toast("Personality lab", (await r.json().catch(() => ({}))).error || "That voice couldn't play."); return; }
    const url = URL.createObjectURL(await r.blob());
    L.audio = new Audio(url); L.audio.onended = () => URL.revokeObjectURL(url);
    await L.audio.play().catch(() => {});
  }
  const hearText = (p) => [p.greeting, p.ack, p.done, p.reply].filter(Boolean).join(" ");
  async function labClick(e) {
    const b = e.target.closest("button"); if (!b) return;
    try {
      if (b.dataset.labHear) { const c = charByKey(b.dataset.labHear); const p = await api("/persona/preview", { id: c.id, role: c.role ?? undefined }); await hear(hearText(p), c.voice); }
      else if (b.dataset.labOpen) await labOpen(b.dataset.labOpen);
      else if (b.dataset.labTry) {
        const c = charByKey(b.dataset.labTry);
        const r = await api("/dev/persona/try", { id: c.id, role: L.sel === c.key ? L.role : c.role ?? undefined, base: L.sel === c.key ? L.base : undefined });
        L.trial = r.trial; after(r.view); labTrial(); toast("Dev preview", `Trying ${c.name} for 10 minutes. It changes back by itself.`);
      }
      else if (b.dataset.lab === "hear" && L.lines) await hear(hearText(L.lines), charByKey(L.sel)?.voice);
      else if (b.dataset.lab === "stop") stopHear();
      else if (b.dataset.lab === "reset-sliders" && L.sel) await labOpen(L.sel);
      else if (b.dataset.lab === "end-trial") { const r = await api("/dev/persona/try/end", {}); L.trial = null; after(r.view); labTrial(); }
      else if (b.dataset.lab === "unlock-all") {
        if (!(await ask("Dev: unlock every secret character for testing? No XP is spent, nothing is announced, it's logged in the activity log, and \"Dev: reset unlocks\" takes it back."))) return;
        const r = await api("/dev/persona/unlock-all", {}); after(r.view); await labLoad(); toast("Dev: unlock all", `${r.added.length} unlocked for testing (logged).`);
      }
      else if (b.dataset.lab === "reset-unlocks") {
        if (!(await ask("Dev: take back every testing unlock? What you found or bought for real stays."))) return;
        const r = await api("/dev/persona/reset-unlocks", {}); after(r.view); await labLoad(); toast("Dev: reset unlocks", `${r.removed.length} testing unlock${r.removed.length === 1 ? "" : "s"} taken back (logged).`);
      }
    } catch (err) { toast("Personality lab", err.message); }
  }

  async function mount(el, o = {}) {
    root = el; opts = o;
    try { S = await api("/persona"); } catch (e) { $("#m").textContent = e.message; return; }
    paint(); counter();
    root.addEventListener("input", (e) => { if (e.target.matches("input[type=range]") && !e.target.closest("#ps-lab")) onSlide(e); if (e.target.id === "ps-custom") counter(); });
    lab().catch(() => { /* the lab is the developer's only */ });
    root.addEventListener("change", async (e) => { if (e.target.id === "ps-hints") { try { after(await api("/persona/secrets/hints", { on: e.target.checked })); } catch (err) { toast("Personality", err.message); } } });
    root.addEventListener("click", async (e) => {
      const b = e.target.closest("button"); if (!b) return;
      try {
        if (b.dataset.preset) after(await api("/persona/preset", { id: b.dataset.preset }));
        else if (b.dataset.pin) after(await api("/persona/pin", { id: b.dataset.pin }));
        else if (b.dataset.apply) after(await api(`/persona/templates/${b.dataset.apply}/apply`, {}));
        else if (b.dataset.tact) {
          const id = b.closest("[data-tid]").dataset.tid, t = S.templates.find((x) => x.id === id), act = b.dataset.tact;
          if (act === "rename") { const nm = await ask("New name for this personality:", { input: true, value: t.name }); if (nm) after(await api(`/persona/templates/${id}/rename`, { name: nm })); }
          else if (act === "delete") { if (await ask(`Delete "${t.name}"? This can't be undone.`)) after(await api(`/persona/templates/${id}/delete`, {})); }
          else if (act === "default") after(await api(`/persona/templates/${id}/default`, { clear: S.defaultTemplate === id }));
          else after(await api(`/persona/templates/${id}/${act}`, {}));
        }
        else if (b.dataset.unlock) { const x = S.secrets.list.find((y) => y.id === b.dataset.unlock); if (await ask(`Unlock ${x.name} for ${x.cost} XP?`)) { const r = await api("/persona/secrets/unlock", { id: x.id }); after(r); if (r.unlocked?.ok) celebrate({ icon: x.icon, name: x.name, title: "🔓 Character unlocked", reveal: x.reveal || "Unlocked!", text: `🔓 Unlocked: ${x.name}!`, line: r.unlocked.line }); } }
        else if (b.id === "ps-normal") after(await api("/persona/normal", {}));
        else if (b.id === "ps-reset-secrets") { if (await ask("Lock all the secret characters again? You can find them again later.")) after(await api("/persona/secrets/reset", { confirm: true })); }
        else if (b.id === "ps-save") { const nm = await ask("Save this personality as:", { input: true }); if (nm) { after(await api("/persona/templates", { name: nm })); toast("Saved", `"${nm}" is in your saved personalities.`); } }
        else if (b.id === "ps-build") { b.disabled = true; b.textContent = "Building…"; try { showCard(await api("/persona/build", { text: $("#ps-custom").value })); } finally { b.textContent = "Build persona"; counter(); } }
        else if (b.id === "ps-export") { const r = await api("/persona/templates/export"); $("#ps-io").value = r.json; $("#ps-io").select(); try { await navigator.clipboard.writeText(r.json); toast("Exported", "Copied to the clipboard."); } catch { /* selected instead */ } }
        else if (b.id === "ps-import") { const r = await api("/persona/templates/import", { json: $("#ps-io").value, replace: $("#ps-replace").checked }); after(r); toast("Imported", `${r.import.added} added${r.import.skipped ? `, ${r.import.skipped} skipped` : ""}.`); }
      } catch (err) { toast("Personality", err.message); }
    });
  }
  window.DayspringPersonality = { html, mount, words, MAX_WORDS };
})();
