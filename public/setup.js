// Dayspring setup: the first-run wizard, and the Settings page afterwards (same sections).
// Wizard: one section at a time with Back / Skip / Next (Next saves). Settings: a list of sections on the left, Save each.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (path, opts = {}) => {
    const r = await fetch("/api" + path, { ...opts, headers: { "content-type": "application/json", ...(opts.headers ?? {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Dayspring couldn't do that just now. Try again in a moment, or restart Dayspring if it keeps happening.");
    return j;
  };
  const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body ?? {}) });
  const toast = (t) => { const el = $("#toast"); el.textContent = t; el.classList.add("show"); clearTimeout(el._h); el._h = setTimeout(() => el.classList.remove("show"), 2600); };
  const msg = (el, text, kind = "") => { if (!el) return; el.className = "msg " + kind; el.textContent = text; };
  const openLink = (url) => post("/open", { url }).then(() => toast("Opened in your browser")).catch(() => window.open(url, "_blank", "noopener"));
  const DAYS = [["sun", "S"], ["mon", "M"], ["tue", "T"], ["wed", "W"], ["thu", "T"], ["fri", "F"], ["sat", "S"]];
  const DAYNAME = { sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" };
  const CATS = { faith: "Faith", home: "Home", body: "Health & fitness", work: "Work", study: "Study", rest: "Rest", meal: "Meals", flex: "Other" };
  const hm12 = (t) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""}${h >= 12 ? "pm" : "am"}`; };
  const daysText = (ds) => (ds.length === 7 ? "Every day" : ds.join(",") === "mon,tue,wed,thu,fri" ? "Weekdays" : ds.join(",") === "sun,sat" ? "Weekends" : ds.map((d) => DAYNAME[d].slice(0, 3)).join(", "));

  let S = null;                       // the state from /api/setup/state
  const params = new URLSearchParams(location.search);
  let wizard = false, cur = 0;

  // small building blocks -------------------------------------------------------------------------------------------
  const MAX_NICKS = 30;
  const nickRow = (v) => `<div class="nick-row" role="listitem"><input type="text" maxlength="40" value="${esc(v)}" placeholder="e.g. Champ" aria-label="Nickname"><button type="button" class="rm" title="Remove" aria-label="Remove this nickname">✕</button></div>`;
  const field = (id, label, input, hint = "") => `<div class="field"><label for="${id}">${label}</label>${input}${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
  const text = (id, value = "", ph = "", type = "text", extra = "") => `<input type="${type}" id="${id}" value="${esc(value)}" placeholder="${esc(ph)}" autocomplete="off" spellcheck="false" ${extra}>`;
  const sw = (id, on) => `<button type="button" class="sw" role="switch" id="${id}" aria-checked="${Boolean(on)}"></button>`;
  // ---- Settings → Screen: sizes, margins, layout, what to show, motion (all applied live) ----
  const rng = (k, label, min, max, step, hint = "") => `<div class="field"><label for="sc-${k}">${label} <span class="hint" data-v="${k}"></span></label><input type="range" id="sc-${k}" data-k="${k}" min="${min}" max="${max}" step="${step}">${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
  const sel = (k, label, opts) => `<div class="field"><label for="sc-${k}">${label}</label><select id="sc-${k}" data-k="${k}">${opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select></div>`;
  const SHOW = [["showClock", "The clock and date"], ["showNowNext", "Now and Next"], ["showPanel", "The rotating panel (today, week, weather…)"], ["showExam", "The exam countdown"], ["showCourses", "The course rings"], ["showTranscript", "What you and Dayspring said (the transcript)"]];
  const SC_GROUPS = [
    { id: "size", title: "Size", keys: ["uiScale", "textScale", "clockScale"], html: rng("uiScale", "Everything", 60, 150, 5, "Makes the whole screen bigger or smaller.") + rng("textScale", "Text in the cards", 80, 130, 5) + rng("clockScale", "The clock", 60, 160, 5) },
    { id: "margins", title: "Margins", keys: ["overscan", "marginTop", "marginBottom", "marginLeft", "marginRight"], html: `<p class="hint">TVs often crop the edges. Pull an edge in until nothing is cut off.</p>${rng("overscan", "All sides", 0, 20, 0.5)}<div class="row">${rng("marginTop", "Top", 0, 20, 0.5)}${rng("marginBottom", "Bottom", 0, 20, 0.5)}</div><div class="row">${rng("marginLeft", "Left", 0, 20, 0.5)}${rng("marginRight", "Right", 0, 20, 0.5)}</div><div class="overscan" aria-hidden="true"><i id="overBox">Dayspring</i></div>` },
    { id: "layout", title: "Layout", keys: ["layoutMode", "talkWidth", "density", "fit"], html: sel("layoutMode", "Arrangement", [["auto", "Automatic (follows the screen's shape)"], ["two", "Two columns"], ["talkRight", "Dayspring panel on the right"], ["talkLeft", "Dayspring panel on the left"], ["one", "One column"], ["compact", "Compact"]])
      + `<div class="field"><label><input type="checkbox" id="sc-twAuto"> Automatic width for the Dayspring panel</label></div>` + rng("talkWidth", "Dayspring panel width", 25, 50, 1)
      + sel("density", "Spacing", [["comfortable", "Comfortable"], ["compact", "Compact"]]) + sel("fit", "Shape", [["fill", "Fill the screen"], ["keep", "Keep proportions (16:9, centered)"]]) },
    { id: "show", title: "What to show", keys: [...SHOW.map((x) => x[0]), "listRows"], html: SHOW.map(([k, t]) => `<label class="scshow"><input type="checkbox" data-k="${k}" id="sc-${k}"> ${t}</label>`).join("") + rng("listRows", "Rows in the day list", 0, 20, 1, "0 = as many as fit.") },
    { id: "motion", title: "Motion", keys: ["carouselSeconds", "uiMotion"], html: rng("carouselSeconds", "Seconds per slide in the rotating panel", 0, 300, 5, "0 = it stays put.") + `<label class="scshow"><input type="checkbox" id="sc-uiMotion" data-k="uiMotion"> Calmer motion (fewer animations)</label>` },
  ];
  const SC_FMT = { uiScale: (v) => v + "%", textScale: (v) => v + "%", clockScale: (v) => v + "%", talkWidth: (v) => v + "% of the width", listRows: (v) => (v ? v + " rows" : "as many as fit"), carouselSeconds: (v) => (v ? v + " s" : "stays put"), overscan: (v) => (v ? v + "%" : "none") };
  const SC_DEF = { uiScale: 100, textScale: 100, clockScale: 100, carouselSeconds: 40, listRows: 0, layoutMode: "auto", density: "comfortable", fit: "fill" };
  async function screenMount() {
    let s = {};
    try { s = (await api("/settings")).settings ?? {}; } catch { /* defaults */ }
    const all = () => (typeof s.overscan === "number" ? s.overscan : 5);
    const val = (k) => (["marginTop", "marginBottom", "marginLeft", "marginRight"].includes(k) ? (typeof s[k] === "number" ? s[k] : all()) : k === "overscan" ? all() : s[k] ?? SC_DEF[k]);
    const box = () => { const b = $("#overBox"); if (b) b.style.inset = `${val("marginTop")}% ${val("marginRight")}% ${val("marginBottom")}% ${val("marginLeft")}%`; };
    const paint = () => {
      for (const el of $$("[data-k]", $("#scbox"))) {
        const k = el.dataset.k;
        if (el.type === "checkbox") el.checked = k === "uiMotion" ? s.uiMotion === "reduced" : s[k] !== false;
        else if (k === "talkWidth") { el.value = typeof s.talkWidth === "number" ? s.talkWidth : 39; el.disabled = typeof s.talkWidth !== "number"; }
        else el.value = val(k);
        const v = $(`[data-v="${k}"]`); if (v) v.textContent = SC_FMT[k] ? SC_FMT[k](Number(el.value)) : el.value + (el.step === "0.5" ? "%" : "");
      }
      const tw = $("#sc-twAuto"); if (tw) tw.checked = typeof s.talkWidth !== "number";
      box();
    };
    const timers = {};
    const send = (patch) => { Object.assign(s, patch); if ("overscan" in patch) for (const k of ["marginTop", "marginBottom", "marginLeft", "marginRight"]) s[k] = null; paint(); for (const k of Object.keys(patch)) clearTimeout(timers[k]);
      const key = Object.keys(patch).join(); timers[key] = setTimeout(() => post("/settings", patch).then((r) => { if (r?.settings) s = r.settings; }).catch(() => {}), 200); };
    const sec = $("#scbox");
    sec.addEventListener("input", (e) => { const el = e.target.closest("[data-k]"); if (!el || el.type === "checkbox" || el.tagName === "SELECT") return; send({ [el.dataset.k]: Number(el.value) }); });
    sec.addEventListener("change", (e) => {
      const el = e.target;
      if (el.id === "sc-twAuto") return send({ talkWidth: el.checked ? null : Number($("#sc-talkWidth").value) || 39 });
      if (!el.dataset?.k) return;
      if (el.type === "checkbox") return send({ [el.dataset.k]: el.dataset.k === "uiMotion" ? (el.checked ? "reduced" : "normal") : el.checked });
      if (el.tagName === "SELECT") return send({ [el.dataset.k]: el.value });
    });
    sec.addEventListener("click", (e) => {
      const r = e.target.closest(".screset"); if (!r) return;
      const g = SC_GROUPS.find((x) => x.id === r.dataset.g), patch = {};
      for (const k of g.keys) patch[k] = k === "overscan" ? all() : ["marginTop", "marginBottom", "marginLeft", "marginRight", "talkWidth"].includes(k) ? null : k.startsWith("show") ? true : SC_DEF[k] ?? (k === "uiMotion" ? "normal" : null);
      if (g.id === "margins") { delete patch.marginTop; delete patch.marginBottom; delete patch.marginLeft; delete patch.marginRight; }   // "all sides" clears them
      send(patch);
    });
    $("#scResetAll").onclick = () => { post("/settings", { screenReset: true }).then((r) => { s = r.settings ?? {}; paint(); }).catch(() => {}); };
    $("#fitNow").onclick = () => {
      if (window.parent !== window) { window.parent.postMessage({ type: "dayspring-fit" }, "*"); return; }
      post("/settings", { calibrateAt: Date.now() }).catch(() => {});
      toast("📐 Fit to screen is open on the Dayspring screen.");
    };
    paint();
  }
  const toggle = (id, title, desc, on, sub = "") => `<div class="toggle"><div class="txt"><b id="${id}-l">${title}</b><div>${desc}</div>${sub}</div>${sw(id, on).replace('role="switch"', `role="switch" aria-labelledby="${id}-l"`)}</div>`;
  const isOn = (id) => $("#" + id)?.getAttribute("aria-checked") === "true";
  const val = (id) => ($("#" + id)?.value ?? "").trim();
  const choiceGroup = (name, items, current) => `<div class="choices" role="radiogroup" data-group="${name}">${items.map((it) => `<button type="button" class="choice${it.value === current ? " on" : ""}" role="radio" aria-checked="${it.value === current}" data-value="${esc(it.value)}">${it.tag ? `<span class="tag${it.paid ? " paid" : ""}">${it.tag}</span>` : ""}<b>${it.title}</b><small>${it.desc ?? ""}</small></button>`).join("")}</div>`;
  const chosen = (name) => $(`[data-group="${name}"] .choice.on`)?.dataset.value ?? null;
  const chipGroup = (name, items, selected, multi = true) => `<div class="chips" data-chips="${name}" data-multi="${multi}">${items.map(([v, l]) => `<button type="button" class="chip${selected.includes(v) ? " on" : ""}" aria-pressed="${selected.includes(v)}" data-value="${esc(v)}">${esc(l)}</button>`).join("")}</div>`;
  const chipsOf = (name) => $$(`[data-chips="${name}"] .chip.on`).map((c) => c.dataset.value);
  const daysPicker = (name, selected) => `<div class="days" data-days="${name}">${DAYS.map(([d, l]) => `<button type="button" class="${selected.includes(d) ? "on" : ""}" aria-pressed="${selected.includes(d)}" data-day="${d}" title="${DAYNAME[d]}" aria-label="${DAYNAME[d]}">${l}</button>`).join("")}</div>`;
  const daysOf = (el) => $$("[data-day].on", el).map((b) => b.dataset.day);
  const keyStatus = (k) => { const s = S.keys?.[k]; return s?.set ? `<span class="status ok">✓ Saved${s.last4 ? " · ends in " + esc(s.last4) : ""}</span>` : `<span class="status">Not set</span>`; };

  // one click handler for switches, choices, chips, days
  document.addEventListener("click", (e) => {
    const s = e.target.closest(".sw");
    if (s) { s.setAttribute("aria-checked", s.getAttribute("aria-checked") !== "true"); s.dispatchEvent(new Event("change", { bubbles: true })); return; }
    const c = e.target.closest(".choice");
    if (c && c.closest("[data-group]")) { $$(".choice", c.parentElement).forEach((x) => { x.classList.toggle("on", x === c); x.setAttribute("aria-checked", x === c); }); c.parentElement.dispatchEvent(new Event("change", { bubbles: true })); return; }
    const ch = e.target.closest(".chip");
    if (ch && ch.closest("[data-chips]")) {
      const g = ch.parentElement;
      if (g.dataset.multi === "false") $$(".chip", g).forEach((x) => { x.classList.toggle("on", x === ch); x.setAttribute("aria-pressed", x === ch); });
      else { ch.classList.toggle("on"); ch.setAttribute("aria-pressed", ch.classList.contains("on")); }
      g.dispatchEvent(new Event("change", { bubbles: true })); return;
    }
    const d = e.target.closest("[data-day]");
    if (d) { d.classList.toggle("on"); d.setAttribute("aria-pressed", d.classList.contains("on")); d.parentElement.dispatchEvent(new Event("change", { bubbles: true })); }
  });

  // audio preview (ElevenLabs / OpenAI come back as mp3; the free voices speak right here)
  let previewAudio = null;
  async function previewServer(provider, voiceName, key) {
    const r = await fetch("/api/setup/voice/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, voice: voiceName, key }) });
    if ((r.headers.get("content-type") ?? "").includes("audio")) {
      const url = URL.createObjectURL(await r.blob());
      previewAudio?.pause(); previewAudio = new Audio(url); await previewAudio.play().catch(() => {});
      return { ok: true };
    }
    return r.json().catch(() => ({ ok: false, error: "The voice didn't answer." }));
  }
  function browserVoices() { return (window.speechSynthesis?.getVoices() ?? []).slice().sort((a, b) => (b.lang.startsWith("en") - a.lang.startsWith("en")) || (/natural|online/i.test(b.name) - /natural|online/i.test(a.name)) || a.name.localeCompare(b.name)); }
  function speakBrowser(name, sample) {
    if (!window.speechSynthesis) return false;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(sample), v = browserVoices().find((x) => x.name === name);
    if (v) { u.voice = v; u.lang = v.lang; }
    speechSynthesis.speak(u); return true;
  }
  const sample = () => `Hi${S.owner.name ? " " + S.owner.name : ""}! I'm ${S.owner.assistantName || "Dayspring"}. Here's how I sound.`;

  // ================================================================================================= the sections
  const SECTIONS = [
    // ------------------------------------------------------------------------------------------------ welcome
    { id: "welcome", icon: "☀️", title: "Welcome", wizardOnly: true,
      render: () => `
        <h1>Welcome to Dayspring</h1>
        <p class="lead">Dayspring is a friendly assistant for your day. It keeps your schedule, talks with you, reminds you of what's next, and fills a spare screen with your week, the weather, photos and more. Setup takes about five minutes, and you can change everything later in Settings.</p>
        <div class="choices" style="grid-template-columns:repeat(auto-fit,minmax(15em,1fr))">
          <div class="choice on" style="cursor:default"><span class="tag">Free</span><b>Works right away</b><small>Your schedule (day, week, month, year), voice commands, reminders, weather, music and photos. It uses the voices already built into Windows, and you don't need any account.</small></div>
          <div class="choice" style="cursor:default"><span class="tag paid">Optional</span><b>Even better with upgrades</b><small>Connect an AI (Claude, ChatGPT, Grok, or Ollama, a free model that runs on your computer) for real conversation. Add ElevenLabs or OpenAI for lifelike voices.</small></div>
        </div>
        <div class="note">🔒 Everything you enter stays on this computer, in Dayspring's <b>data</b> folder and its <b>.env</b> file. Nothing is uploaded, except what you choose to send to an AI or voice service you connect.</div>
        <p class="hint">Tip: you can press <b>Enter</b> to go to the next step.</p>` },

    // ------------------------------------------------------------------------------------------------ you
    { id: "you", icon: "🙂", title: "You",
      render: () => { const o = S.owner; return `
        <h1>Tell me about you</h1>
        <p class="lead">This helps ${esc(o.assistantName || "Dayspring")} greet you, talk naturally, and keep you in mind when it plans.</p>
        <div class="row">${field("name", "Your first name", text("name", o.name, "Sam", "text", 'required aria-required="true" maxlength="60"'))}</div>
        <div class="field"><span class="lbl" id="nk-l">Nicknames (optional)</span>
          <div class="nicks" id="nicks" role="list" aria-labelledby="nk-l">${(o.nicknames ?? []).map((n) => nickRow(n)).join("")}</div>
          <button type="button" class="btn ghost addnick" id="addNick">+ Add nickname</button>
          <div class="hint" id="nickHint"></div></div>
        ${field("about", "A little about you (optional)", `<textarea id="about" placeholder="For example: I'm a nurse on day shifts. Married, two kids (Ava, 8, and Leo, 5). Trying to read more and get to the gym three times a week.">${esc(o.about)}</textarea>`, "Work, family, and what matters to you. The more it knows, the more helpful it gets.")}
        <div class="field"><label id="interests-l">Interests and hobbies (optional)</label><div id="interests"></div><div class="hint">Anything you're into, up to 40. Discover finds popular videos, short clips and articles about them, and they shape the videos and quotes on the screen.</div></div>
        <div class="msg" id="m"></div>`; },
      mount: () => {
        S.interestsInput = window.dsChipInput($("#interests"), { values: S.owner.interests ?? [], max: 40, placeholder: "e.g. gardening, hunting, marine wildlife", label: "Your interests" });
        const list = $("#nicks"), add = $("#addNick");
        const sync = () => {
          const n = list.children.length;
          add.disabled = n >= MAX_NICKS;
          add.textContent = n >= MAX_NICKS ? `That's the most (${MAX_NICKS})` : "+ Add nickname";
          $("#nickHint").textContent = n ? `${n} of ${MAX_NICKS}. It'll use one now and then, just for fun; otherwise it calls you by your name.` : "None yet, so it calls you by your name. Add as many as you like, up to 30.";
        };
        add.onclick = () => { if (list.children.length >= MAX_NICKS) return; list.insertAdjacentHTML("beforeend", nickRow("")); list.lastElementChild.querySelector("input").focus(); sync(); };
        list.addEventListener("click", (e) => { const x = e.target.closest(".rm"); if (!x) return; const row = x.closest(".nick-row"); const next = row.nextElementSibling ?? row.previousElementSibling; row.remove(); (next?.querySelector("input") ?? add).focus(); sync(); });
        // Enter in a nickname adds the next one instead of jumping to the next step
        list.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("input")) { e.preventDefault(); e.stopPropagation(); if (e.target.value.trim()) add.click(); } });
        // the same nickname twice: the second one goes (it'd only be removed on save anyway)
        list.addEventListener("change", (e) => {
          if (!e.target.matches("input")) return;
          const v = e.target.value.trim().toLowerCase(); if (!v) return;
          const dup = [...list.querySelectorAll("input")].some((i) => i !== e.target && i.value.trim().toLowerCase() === v);
          if (dup) { $("#nickHint").textContent = `“${e.target.value.trim()}” is already on the list.`; e.target.closest(".nick-row").remove(); sync(); }
        });
        sync();
      },
      save: async () => {
        if (!val("name")) { $("#name").focus(); throw new Error("Please enter your name. It's the one thing Dayspring needs."); }
        const seen = new Set(), nicks = [...document.querySelectorAll("#nicks input")].map((i) => i.value.trim()).filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase())).slice(0, MAX_NICKS);
        const r = await post("/setup/owner", { name: val("name"), nicknames: nicks, about: $("#about").value, interests: S.interestsInput?.values() ?? S.owner.interests ?? [] });
        S.owner = r.owner;
      } },

    // ------------------------------------------------------------------------------------------------ assistant
    { id: "assistant", icon: "✨", title: "Your assistant",
      render: () => { const o = S.owner; const humor = ["none", "light, friendly teasing", "dry and witty", "goofy and playful"]; const custom = o.humor && !humor.includes(o.humor); return `
        <h1>Name your assistant</h1>
        <p class="lead">Keep "Dayspring" or give it any name you like. Say its name to wake it up, like "Hey Dayspring, what's next?"</p>
        <div class="row">${field("aname", "Assistant's name", text("aname", o.assistantName || "Dayspring", "Dayspring"))}${field("wake", "Wake words", text("wake", (o.wakeWords ?? []).join(", "), "dayspring"), "What you say to get its attention. Separate them with commas. \"Hey …\" works automatically.")}</div>
        <div class="field"><span class="lbl" id="hu-l">Sense of humor</span>${chipGroup("humor", [["none", "Just the facts"], ["light, friendly teasing", "Light and friendly"], ["dry and witty", "Dry and witty"], ["goofy and playful", "Goofy and playful"], ["custom", "Something else…"]], [custom ? "custom" : o.humor || "light, friendly teasing"], false).replace('class="chips"', 'class="chips" role="group" aria-labelledby="hu-l"')}</div>
        <div id="humorCustomWrap" ${custom ? "" : "hidden"}>${field("humorCustom", "Describe it", text("humorCustom", custom ? o.humor : "", "like a cheerful coach"))}</div>
        <div class="msg" id="m"></div>`; },
      mount: () => { $("[data-chips=humor]").addEventListener("change", () => { $("#humorCustomWrap").hidden = chipsOf("humor")[0] !== "custom"; }); },
      save: async () => {
        const h = chipsOf("humor")[0];
        const r = await post("/setup/owner", { assistantName: val("aname") || "Dayspring", wakeWords: val("wake") || (val("aname") || "Dayspring").toLowerCase(), humor: h === "custom" ? val("humorCustom") || "light, friendly teasing" : h });
        S.owner = r.owner; $("#brandName").textContent = S.owner.assistantName || "Dayspring";
      } },

    // ------------------------------------------------------------------------------------------------ location
    { id: "location", icon: "📍", title: "Where you are",
      render: () => { const l = S.owner.location ?? {}; return `
        <h1>Where are you?</h1>
        <p class="lead">This is used for your weather and to get times right. Just your city is enough.</p>
        <div class="field"><label for="city">Your city or town</label>
          <div class="row" style="gap:.5em;align-items:center"><input type="search" id="city" placeholder="Austin, Texas" value="" style="flex:1 1 14em" autocomplete="off"><button class="btn" type="button" id="find">Search</button></div></div>
        <div class="results" id="results" role="listbox" aria-label="Places"></div>
        <div class="note" id="picked" ${l.place ? "" : "hidden"}>📍 <b id="pickedPlace">${esc(l.place)}</b> <span class="hint" id="pickedTz">${esc(l.timezone ?? "")}</span></div>
        ${field("tz", "Time zone", text("tz", l.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone, "America/Chicago"), "Filled in for you when you pick a place.")}
        <div class="msg" id="m"></div>`; },
      mount: (sec) => {
        const find = async () => {
          const qv = val("city"); if (qv.length < 2) return;
          msg($("#m"), "Looking…");
          try {
            const r = await api("/setup/location?q=" + encodeURIComponent(qv));
            msg($("#m"), r.error ?? (r.results.length ? "" : "I couldn't find that. Try adding the state or country."), r.error ? "bad" : "");
            $("#results").innerHTML = r.results.map((x, i) => `<button type="button" class="btn" role="option" data-i="${i}">📍 ${esc(x.place)} <span class="hint">${esc(x.timezone ?? "")}</span></button>`).join("");
            $$("#results button").forEach((b) => b.onclick = () => { sec.pick = r.results[b.dataset.i]; $("#picked").hidden = false; $("#pickedPlace").textContent = sec.pick.place; $("#pickedTz").textContent = sec.pick.timezone ?? ""; if (sec.pick.timezone) $("#tz").value = sec.pick.timezone; $("#results").innerHTML = ""; });
          } catch (e) { msg($("#m"), e.message, "bad"); }
        };
        $("#find").onclick = find;
        $("#city").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); find(); } });
      },
      save: async (sec) => {
        const l = S.owner.location ?? {};
        const p = sec.pick ?? { place: l.place, lat: l.lat, lon: l.lon };
        const r = await post("/setup/owner", { location: { ...p, timezone: val("tz") || p.timezone } });
        S.owner = r.owner;
      } },

    // ------------------------------------------------------------------------------------------------ AI
    { id: "ai", icon: "🧠", title: "AI brain",
      render: () => { const a = S.ai, P = a.providers; const cur = a.provider; return `
        <h1>Choose an AI brain</h1>
        <p class="lead">Dayspring works without one. It can manage your schedule, set reminders, play music and answer simple commands. Connect an AI and it can hold real conversations, plan your day with you, look things up, and help with almost anything.</p>
        ${choiceGroup("provider", [
          { value: "none", title: "No AI (free)", desc: "Built-in commands only. You can add one any time.", tag: "Free" },
          { value: "anthropic", title: "Claude", desc: "By Anthropic. Warm, careful, great at planning. Can search the web.", tag: "Pay as you go", paid: true },
          { value: "openai", title: "ChatGPT", desc: "By OpenAI. Quick and capable all-rounder.", tag: "Pay as you go", paid: true },
          { value: "xai", title: "Grok", desc: "By xAI. Direct, with a sense of humor.", tag: "Pay as you go", paid: true },
          { value: "ollama", title: "Ollama (on this computer)", desc: "A free model that runs on your own computer. It's private, but needs a fairly strong PC.", tag: "Free" },
        ], cur)}
        <div id="aiDetail"></div>
        <div class="msg" id="m" aria-live="polite"></div>`; },
      mount: (sec) => {
        const draw = async () => {
          const p = chosen("provider"), info = S.ai.providers[p], el = $("#aiDetail");
          if (p === "none" || !info) { el.innerHTML = `<div class="note">That's fine: everything else still works. You can connect an AI later in Settings → AI brain. The guide explains each option: <a href="/help#ai-providers">AI providers</a>.</div>`; return; }
          const same = S.ai.provider === p;
          const keyBox = info.keyVar ? `
            <div class="field"><label for="key">${esc(info.label)} API key</label>
              <div class="row" style="gap:.5em;align-items:center"><input type="password" id="key" placeholder="${S.keys[info.keyVar]?.set ? "Saved. Paste a new one to replace it." : "Paste your key here"}" autocomplete="off" style="flex:1 1 16em"><button type="button" class="btn small" id="getKey">Get a key ↗</button></div>
              <div class="hint">${keyStatus(info.keyVar)} &nbsp;Your key is kept only in this computer's .env file.</div></div>
            <div class="note">${{ anthropic: "Sign in at <b>platform.claude.com</b>, then go to <b>Billing</b>, add a few dollars of credit, and create a key under <b>API keys</b>. Everyday use usually costs a few dollars a month.", openai: "Sign in at <b>platform.openai.com</b>, add credit under <b>Billing</b>, then create a key under <b>API keys</b>. A ChatGPT Plus subscription is separate and doesn't include API use.", xai: "Sign in at <b>console.x.ai</b>, add credit, then create an API key." }[p]} <a href="/help#ai-providers">Step-by-step guide</a></div>` : `
            ${field("ollamaUrl", "Ollama address", text("ollamaUrl", S.keys.OLLAMA_URL?.value || "http://127.0.0.1:11434", "http://127.0.0.1:11434", "url"))}
            <div class="note">1. Install Ollama from <b>ollama.com/download</b> <button type="button" class="btn small" id="getKey">Open ↗</button><br>2. Open a terminal and run <code>ollama pull llama3.1:8b</code> (about 5 GB).<br>3. Press <b>Test</b> below.</div>`;
          el.innerHTML = `${keyBox}
            <div class="field"><label for="model">Model</label><div class="row" style="gap:.5em;align-items:center"><select id="model" style="flex:1 1 14em"><option value="">Recommended (${esc(info.defaultModel)})</option></select><button type="button" class="btn small" id="loadModels">Refresh list</button></div>
              <div class="hint">You can leave this on Recommended.</div></div>
            <div class="row" style="gap:.5em;align-items:center"><button type="button" class="btn" id="test">Test</button><span id="testOut" class="hint"></span></div>`;
          $("#getKey").onclick = () => openLink(info.keyUrl);
          const loadModels = async () => {
            try { const r = await api("/setup/ai/models?provider=" + p); const cm = same ? S.ai.model : ""; $("#model").innerHTML = `<option value="">Recommended (${esc(info.defaultModel)})</option>` + r.models.filter((x) => x !== info.defaultModel).map((x) => `<option ${x === cm ? "selected" : ""}>${esc(x)}</option>`).join(""); } catch { /* keep the default */ }
          };
          $("#loadModels").onclick = loadModels;
          if (same || p === "ollama") loadModels();
          $("#test").onclick = async () => {
            $("#test").disabled = true; $("#testOut").className = "hint"; $("#testOut").textContent = "Testing…";
            try {
              const r = await post("/setup/ai/test", { provider: p, key: $("#key")?.value.trim() || undefined, model: $("#model").value || undefined, url: val("ollamaUrl") || undefined });
              $("#testOut").className = r.ok ? "status ok" : "status bad";
              $("#testOut").textContent = r.ok ? `✓ It works (${(r.ms / 1000).toFixed(1)}s, ${r.model})` : "✗ " + friendlyAiError(r.error);
            } catch (e) { $("#testOut").className = "status bad"; $("#testOut").textContent = "✗ " + e.message; }
            $("#test").disabled = false;
          };
        };
        $("[data-group=provider]").addEventListener("change", draw);
        draw();
      },
      save: async () => {
        const p = chosen("provider");
        if (!p) return;
        msg($("#m"), p === "none" ? "" : "Testing and saving…");
        const r = await post("/setup/ai", { provider: p, key: $("#key")?.value.trim() || undefined, model: $("#model")?.value || undefined, url: val("ollamaUrl") || undefined });
        if (!r.ok) throw new Error("That didn't work: " + friendlyAiError(r.error));
        S.ai = r.ai; S.keys = (await api("/setup/keys")).keys;
        msg($("#m"), p === "none" ? "Okay, no AI for now." : `✓ Connected: ${r.ai.label}`, "ok");
      } },

    // ------------------------------------------------------------------------------------------------ voice
    { id: "voice", icon: "🗣️", title: "Voice",
      render: () => { const v = S.voice; return `
        <h1>Pick a voice</h1>
        <p class="lead">Free voices come with Windows. The newest "Natural" ones sound great. For the most lifelike voices, connect ElevenLabs or OpenAI.</p>
        <div class="tabs" role="tablist" id="vtabs">${[["browser", "Free voices"], ["elevenlabs", "ElevenLabs"], ["openai", "OpenAI"]].map(([k, l]) => `<button type="button" role="tab" data-p="${k}" class="${v.provider === k ? "on" : ""}" aria-selected="${v.provider === k}">${l}</button>`).join("")}</div>
        <div id="vbody"></div>
        <h2>How it speaks</h2>
        <div class="row">
          <div class="field"><label for="speed">Speed <span class="hint" id="speedV"></span></label><input type="range" id="speed" min="-0.3" max="0.2" step="0.05" value="${v.speedAdj ?? 0}"></div>
          <div class="field"><label for="vol">Volume <span class="hint" id="volV"></span></label><input type="range" id="vol" min="5" max="100" step="5" value="${v.volume ?? 80}"></div>
        </div>
        <div class="msg" id="m" aria-live="polite"></div>`; },
      mount: (sec) => {
        sec.provider = S.voice.provider;
        const lbl = () => { const s = Number($("#speed").value); $("#speedV").textContent = s === 0 ? "normal" : s < 0 ? "slower" : "faster"; $("#volV").textContent = $("#vol").value + "%"; };
        $("#speed").oninput = lbl; $("#vol").oninput = lbl; lbl();
        const pick = (el) => { $$(".voice", $("#vbody")).forEach((x) => x.classList.toggle("on", x === el)); sec.voice = el.dataset.name; sec.voiceId = el.dataset.id || null; };
        const drawList = (items, current, onPlay) => {
          const box = $("#vlist");
          box.innerHTML = items.length ? items.map((x) => `<div class="voice${x.name === current ? " on" : ""}" tabindex="0" role="option" data-name="${esc(x.name)}" data-id="${esc(x.id ?? "")}"><button type="button" class="play" aria-label="Play ${esc(x.name)}">▶</button><div class="grow"><div class="n">${esc(x.name)}${x.mine ? " ⭐" : ""}</div><div class="d">${esc(x.describe ?? "")}</div></div></div>`).join("") : `<div class="hint">No voices found.</div>`;
          $$(".voice", box).forEach((el) => {
            el.addEventListener("click", (e) => { pick(el); if (e.target.closest(".play")) onPlay(el.dataset.name); });
            el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(el); onPlay(el.dataset.name); } });
          });
          if (current) sec.voice = current;
        };
        const draw = async (p) => {
          sec.provider = p; sec.voice = null; sec.voiceId = null;
          $$("#vtabs button").forEach((b) => { b.classList.toggle("on", b.dataset.p === p); b.setAttribute("aria-selected", b.dataset.p === p); });
          const body = $("#vbody");
          if (p === "browser") {
            body.innerHTML = `<p class="hint">These are the voices on this computer. Press ▶ to hear one. The ones marked "Natural" or "Online" sound the most human. The Dayspring screen gets Microsoft's free Natural voices when it's shown in Edge (Settings → Screen).</p><div class="voices" id="vlist" role="listbox" aria-label="Voices"></div>`;
            const fill = () => drawList(browserVoices().map((v) => ({ name: v.name, describe: `${v.lang}${v.localService ? "" : " · online"}${/natural/i.test(v.name) ? " · natural" : ""}` })), S.voice.browserVoice, (n) => { if (!speakBrowser(n, sample())) msg($("#m"), "This browser can't speak.", "bad"); });
            fill(); if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => { if (sec.provider === "browser") fill(); };
            return;
          }
          const keyVar = p === "openai" ? "OPENAI_API_KEY" : "ELEVENLABS_API_KEY";
          body.innerHTML = `
            <div class="field"><label for="vkey">${p === "openai" ? "OpenAI" : "ElevenLabs"} API key</label>
              <div class="row" style="gap:.5em;align-items:center"><input type="password" id="vkey" placeholder="${S.keys[keyVar]?.set ? "Saved. Paste a new one to replace it." : "Paste your key here"}" autocomplete="off" style="flex:1 1 16em"><button type="button" class="btn small" id="vget">Get a key ↗</button></div>
              <div class="hint">${keyStatus(keyVar)}${p === "openai" ? " &nbsp;This is the same key as ChatGPT if you connected it as your AI." : " &nbsp;ElevenLabs has a free tier with about 10 minutes of speech a month."}</div></div>
            ${p === "elevenlabs" ? `<p class="hint">Your own voices (from the ElevenLabs Voice Library, or ones you've cloned) show up with ⭐ once your key is saved. <a href="/help#voices">How to add more voices</a></p>` : ""}
            <div class="voices" id="vlist" role="listbox" aria-label="Voices"><div class="hint">Loading voices…</div></div>`;
          $("#vget").onclick = () => openLink(p === "openai" ? "https://platform.openai.com/api-keys" : "https://elevenlabs.io/app/settings/api-keys");
          try {
            const r = await api("/setup/voices?provider=" + p);
            const current = p === "openai" ? (S.voice.openaiVoice ?? "coral").replace(/^./, (c) => c.toUpperCase()) : S.voice.elevenVoice;
            drawList(r.voices, current, async (n) => {
              msg($("#m"), `Playing ${n}…`);
              const out = await previewServer(p, n, $("#vkey").value.trim() || undefined);
              msg($("#m"), out.ok ? "" : "✗ " + (/not set/i.test(out.error ?? "") ? "Paste your key above first, then press ▶ again." : out.error || "Couldn't play that voice. Check the key."), out.ok ? "" : "bad");
            });
          } catch (e) { $("#vlist").innerHTML = `<div class="hint">${esc(e.message)}</div>`; }
        };
        $$("#vtabs button").forEach((b) => b.onclick = () => draw(b.dataset.p));
        draw(sec.provider);
      },
      save: async (sec) => {
        const p = sec.provider, body = { provider: p, speedAdj: Number($("#speed").value), volume: Number($("#vol").value) };
        if (p === "browser") body.browserVoice = sec.voice ?? S.voice.browserVoice ?? "";
        else { body.key = $("#vkey")?.value.trim() || undefined; body.voice = sec.voice || undefined; body.voiceId = sec.voiceId || undefined; }
        const r = await post("/setup/voice", body);
        S.voice = r.voice; S.keys = (await api("/setup/keys")).keys;
        msg($("#m"), `✓ Voice saved${r.voice.voiceName ? ": " + r.voice.voiceName : ""}`, "ok");
      } },

    // ------------------------------------------------------------------------------------------------ sound devices
    { id: "sound", icon: "🎧", title: "Speakers & mic",
      render: () => `
        <h1>Speakers and microphone</h1>
        <p class="lead">Choose which speakers Dayspring talks through (you can pick more than one) and which mic it listens with. Dayspring only changes its <b>own</b> sound. Your other apps and your Windows default stay exactly as they are.</p>
        <div class="row" style="gap:.5em;align-items:center"><button type="button" class="btn small" id="refresh">↻ Look again</button><span class="hint">Plugged something in? Press "Look again".</span></div>
        <div class="list" id="devs"><div class="hint">Looking for your speakers and mics…</div></div>
        <div class="note">You can also just say it: "use my headset for sound", "listen through the laptop mic", or "call the X100 my blue headset". <a href="/help#audio-devices">More about sound</a></div>
        <div class="msg" id="m"></div>`,
      nosave: true,
      mount: (sec) => {
        const draw = async (fresh) => {
          const box = $("#devs");
          try {
            const r = await api("/setup/devices" + (fresh ? "?fresh=1" : ""));
            if (r.error) { box.innerHTML = `<div class="note warn">${esc(r.error)}</div>`; return; }
            if (!r.devices.length) { box.innerHTML = `<div class="hint">No sound devices found.</div>`; return; }
            box.innerHTML = r.devices.map((d) => `
              <div class="item" data-key="${esc(d.key)}">
                <span style="font-size:1.4em" aria-hidden="true">${{ headset: "🎧", headphones: "🎧", earbuds: "🎧", tv: "🖥️", "laptop-speaker": "💻", "laptop-mic": "🎙️", microphone: "🎙️", speaker: "🔊" }[d.type] ?? "🔈"}</span>
                <div class="grow"><div class="t">${esc(d.nickname || d.name)}</div><div class="s">${esc(d.typeWord)}${d.nickname ? " · " + esc(d.key) : ""} · ${d.outputs.length ? "speaker" : ""}${d.outputs.length && d.inputs.length ? " + " : ""}${d.inputs.length ? "mic" : ""}</div></div>
                <input type="text" class="nick" value="${esc(d.nickname ?? "")}" placeholder="Nickname" aria-label="Nickname for ${esc(d.name)}" style="flex:0 1 10em">
                ${d.outputs.length ? `<button type="button" class="btn small ${d.inUse.sound ? "primary" : ""}" data-act="sound" aria-pressed="${d.inUse.sound}">${d.inUse.sound ? "✓ " : ""}Sound</button>` : ""}
                ${d.inputs.length ? `<button type="button" class="btn small ${d.inUse.mic ? "primary" : ""}" data-act="mic" aria-pressed="${d.inUse.mic}">${d.inUse.mic ? "✓ " : ""}Mic</button>` : ""}
              </div>`).join("");
            sec.devices = r.devices;
            $$(".item", box).forEach((row) => {
              const d = r.devices.find((x) => x.key === row.dataset.key);
              $(".nick", row).addEventListener("change", async (e) => { await post("/devices/nickname", { key: d.key, nickname: e.target.value }); toast("Nickname saved"); });
              row.querySelector("[data-act=mic]")?.addEventListener("click", async () => { try { const x = await post("/devices/use", { key: d.key, as: "mic" }); toast((x.said ?? []).join(", ") || "Mic set"); draw(true); } catch (e) { msg($("#m"), e.message, "bad"); } });
              row.querySelector("[data-act=sound]")?.addEventListener("click", async () => {
                // add or remove this device from Dayspring's own outputs (a combination is fine)
                const on = r.devices.filter((x) => x.inUse.sound && x.key !== d.key);
                if (!d.inUse.sound) on.push(d);
                if (!on.length) { msg($("#m"), "Keep at least one speaker on.", "bad"); return; }
                const roles = [...new Set(on.map((x) => x.role).filter(Boolean))], preferred = {};
                for (const x of on) if (x.role && x.outputs[0]) preferred[x.role] = x.outputs[0].name;
                try { await post("/settings", { audioOutputs: roles.length ? roles : ["default"], preferredOutputs: preferred }); msg($("#m"), ""); draw(true); } catch (e) { msg($("#m"), e.message, "bad"); }
              });
            });
          } catch (e) { box.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; }
        };
        $("#refresh").onclick = () => draw(true);
        draw(false);
      } },

    // ------------------------------------------------------------------------------------------------ your week
    { id: "week", icon: "🗓️", title: "Your week",
      render: () => { const f = S.schedule.fixed ?? { categories: ["work"], titleWords: [] }; return `
        <h1>Your usual week</h1>
        <p class="lead">Answer a few questions and Dayspring will sketch your regular week. You can add anything that repeats, like work, classes, practice or worship. Everything can be changed later in the Schedule.</p>
        <div class="row">
          ${field("wakeT", "Usually up at", text("wakeT", "07:00", "", "time"))}
          ${field("bedT", "Usually in bed by", text("bedT", "22:30", "", "time"))}
        </div>
        <div class="field"><span class="lbl">Work or school days</span>${daysPicker("work", ["mon", "tue", "wed", "thu", "fri"])}</div>
        <div class="row">
          ${field("workTitle", "Called", text("workTitle", "Work", "Work"))}
          ${field("workStart", "From", text("workStart", "09:00", "", "time"))}
          ${field("workEnd", "Until", text("workEnd", "17:00", "", "time"))}
        </div>
        ${toggle("meals", "Add meal times", "Breakfast, lunch and dinner, so it plans around them.", !(S.schedule.routines ?? []).length || (S.schedule.routines ?? []).some((r) => r.category === "meal"))}
        <h2>Other things that repeat</h2>
        <div class="list" id="commits"></div>
        <button type="button" class="btn small" id="addCommit">+ Add something that repeats</button>
        <div class="row" style="gap:.6em;align-items:center;margin-top:1em">
          <button type="button" class="btn primary" id="build">Build my week</button>
          <label class="hint" style="display:flex;gap:.4em;align-items:center"><input type="checkbox" id="replace" ${S.schedule.routines.length ? "checked" : ""}> Replace the routines I have now</label>
        </div>
        <div class="msg" id="m" aria-live="polite"></div>
        <h2>Your routines <span class="hint" id="rcount"></span></h2>
        <div class="list" id="routines"></div>
        <details style="margin-top:1em"><summary class="lbl" style="cursor:pointer">Things Dayspring should never move</summary>
          <p class="hint">When plans shift, Dayspring rearranges flexible things around these.</p>
          <div class="field"><span class="lbl">Whole categories</span>${chipGroup("fixedCats", Object.entries(CATS), f.categories ?? [])}</div>
          ${field("fixedWords", "Or anything with these words in the title", text("fixedWords", (f.titleWords ?? []).join(", "), "class, practice, pickup"))}
        </details>`; },
      mount: (sec) => {
        const commitRow = (c = {}) => {
          const el = document.createElement("div"); el.className = "item";
          el.innerHTML = `<input type="text" class="ct" placeholder="Soccer practice" value="${esc(c.title ?? "")}" aria-label="What" style="flex:1 1 10em">
            ${daysPicker("c", c.days ?? ["sat"])}
            <input type="time" class="cs" value="${c.start ?? "18:00"}" aria-label="Starts" style="flex:0 0 8.6em"><input type="time" class="ce" value="${c.end ?? "19:00"}" aria-label="Ends" style="flex:0 0 8.6em">
            <select class="cc" aria-label="Kind" style="flex:0 0 9em">${Object.entries(CATS).map(([k, l]) => `<option value="${k}" ${k === (c.category ?? "flex") ? "selected" : ""}>${l}</option>`).join("")}</select>
            <button type="button" class="btn small ghost danger" aria-label="Remove">✕</button>`;
          $(".danger", el).onclick = () => el.remove();
          $("#commits").append(el);
        };
        $("#addCommit").onclick = () => { commitRow(); $("#commits .item:last-child .ct").focus(); };
        const drawRoutines = () => {
          const rs = S.schedule.routines.slice().sort((a, b) => a.start.localeCompare(b.start));
          $("#rcount").textContent = rs.length ? `(${rs.length})` : "";
          $("#routines").innerHTML = rs.length ? rs.map((r) => `
            <div class="item routine" data-id="${r.id}" style="${r.active ? "" : "opacity:.55"}">
              <span class="dot" style="background:var(--${r.category})"></span>
              <input type="text" class="rt" value="${esc(r.title)}" aria-label="Title">
              <span class="times" style="display:flex;gap:.3em;align-items:center"><input type="time" class="rs" value="${r.start}" aria-label="Starts" style="width:8.6em"><span class="hint">–</span><input type="time" class="re" value="${r.end}" aria-label="Ends" style="width:8.6em"></span>
              ${daysPicker("r", r.days)}
              <span style="display:flex;gap:.3em">${sw("ra-" + r.id, r.active).replace('role="switch"', `role="switch" aria-label="On"`)}<button type="button" class="btn small ghost danger" aria-label="Delete ${esc(r.title)}">✕</button></span>
            </div>`).join("") : `<div class="hint">No routines yet. Build your week above, or add them later in the Schedule.</div>`;
          $$("#routines .item").forEach((row) => {
            const id = row.dataset.id;
            const upd = async (patch) => { try { S.schedule = await post("/setup/schedule", { action: "update", id, patch }); toast("Saved"); } catch (e) { msg($("#m"), e.message, "bad"); drawRoutines(); } };
            $(".rt", row).onchange = (e) => upd({ title: e.target.value });
            $(".rs", row).onchange = (e) => upd({ start: e.target.value });
            $(".re", row).onchange = (e) => upd({ end: e.target.value });
            $("[data-days]", row).addEventListener("change", (e) => { const ds = daysOf(e.currentTarget); if (ds.length) upd({ days: ds }); });
            $(".sw", row).addEventListener("change", (e) => { row.style.opacity = isOn(e.target.id) ? "" : ".55"; upd({ active: isOn(e.target.id) }); });
            $(".danger", row).onclick = async () => { S.schedule = await post("/setup/schedule", { action: "remove", id }); drawRoutines(); toast("Removed"); };
          });
        };
        drawRoutines();
        $("#build").onclick = async () => {
          const commitments = $$("#commits .item").map((el) => ({ title: $(".ct", el).value.trim(), days: daysOf($("[data-days]", el)), start: $(".cs", el).value, end: $(".ce", el).value, category: $(".cc", el).value })).filter((c) => c.title);
          try {
            S.schedule = await post("/setup/schedule", { action: "template", replace: $("#replace").checked, template: { wake: val("wakeT"), bed: val("bedT"), workDays: daysOf($("[data-days=work]")), workStart: val("workStart"), workEnd: val("workEnd"), workTitle: val("workTitle"), meals: isOn("meals"), commitments } });
            drawRoutines(); $("#replace").checked = true; sec.built = true;
            msg($("#m"), `✓ Your week is sketched out: ${S.schedule.routines.length} routines. Adjust them below.`, "ok");
          } catch (e) { msg($("#m"), e.message, "bad"); }
        };
      },
      save: async () => {
        S.schedule = await post("/setup/schedule", { fixed: { categories: chipsOf("fixedCats"), titleWords: val("fixedWords") } });
      } },

    // ------------------------------------------------------------------------------------------------ features
    { id: "features", icon: "🧩", title: "Features & apps",
      render: () => { const f = S.owner.features, k = S.keys; return `
        <h1>What would you like?</h1>
        <p class="lead">Turn on what's useful and leave the rest off. You can change these any time.</p>
        ${toggle("f-weather", "☀️ Weather", "Today's forecast on the screen and in your morning briefing.", f.weather)}
        ${toggle("f-chores", "🧹 Little habits and chores", "Small tasks and good habits slipped into the gaps in your day.", f.chores)}
        ${toggle("f-music", "🎵 Music", "Play Spotify or YouTube by voice. Sign in once and it stays signed in.", f.music, `
          <div class="sub"><div class="row" style="gap:.5em;margin-top:.5em"><button type="button" class="btn small" data-login="spotify">Sign in to Spotify</button><button type="button" class="btn small" data-login="youtube">Sign in to YouTube</button></div>
          <div class="hint" style="margin-top:.3em">A window opens where you sign in yourself. Dayspring never sees your password. Spotify needs Premium to play whole songs on demand, and YouTube Premium removes the ads.</div>
          <div class="item" style="margin-top:.7em"><div class="grow"><div class="t">Spotify inside Dayspring (recommended)</div><div class="s">Music plays right on the screen with full controls: volume, skip, seek, shuffle, your playlists and Liked Songs. Needs Spotify Premium and a free Spotify developer app. <a href="/help#music">5-minute setup</a></div></div>${keyStatus("SPOTIFY_CLIENT_ID")}
            <input type="text" class="xkey" id="spClientId" data-name="SPOTIFY" placeholder="Paste Client ID" aria-label="Spotify Client ID" autocomplete="off" spellcheck="false" style="flex:0 1 12em"><button type="button" class="btn small" data-url="https://developer.spotify.com/dashboard">Open ↗</button></div>
          <div class="row" style="gap:.6em;align-items:center;flex-wrap:wrap"><button type="button" class="btn small" id="spConnect">Connect Spotify</button><span class="hint" id="spState"></span></div>
          <div class="hint">In your Spotify app's settings, the Redirect URI must be exactly <code>http://127.0.0.1:${esc(location.port || "4747")}/spotify/callback</code>.</div></div>`)}
        ${toggle("f-photos", "🖼️ Your photos", "Shows a photo from your computer now and then, and asks about it.", f.photos, `
          <div class="sub">${field("photoDirs", "Photo folders (one per line)", `<textarea id="photoDirs" style="min-height:3.5em" placeholder="Leave empty to use your Pictures folder">${esc((S.owner.photoDirs ?? []).join("\n"))}</textarea>`)}</div>`)}
        ${toggle("f-news", "📰 News", "A few headlines when you ask. This works best with an AI that can search the web.", f.news)}
        ${toggle("f-discover", "✨ Discover: things you're into", "Now and then, finds popular new videos, short clips and articles about your interests and shows the best few on the screen under “For you”. Only while the screen is on, never at night.", true, `
          <div class="sub"><div class="row" style="gap:.8em;margin-top:.5em;flex-wrap:wrap;align-items:end">
            <div class="field" style="flex:1 1 12em;margin:0"><label for="dzFreq">How often</label><select id="dzFreq"><option value="few">A few times a day</option><option value="hourly">About every hour</option><option value="off">Only when I ask</option></select></div>
            <div class="field" style="flex:1 1 12em;margin:0"><label for="dzMax">Pop-ups a day</label><select id="dzMax"><option value="0">None</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="5">5</option></select></div></div>
          <div class="hint" id="dzHint" style="margin-top:.3em">Articles need web access (Permissions). Your interests are under You.</div></div>`)}
        ${toggle("f-phone", "📱 Phone texts", "Read your texts and notifications through Windows Phone Link (works with iPhone and Android).", f.phone, `<div class="sub hint">To set it up, open <b>Phone Link</b> from the Start menu and pair your phone. <a href="/help#phone">Step-by-step</a></div>`)}
        ${toggle("f-faith", "🙏 Faith", "Morning devotion, a prayer list, Bible reading and Scripture memory.", f.faith, `
          <div class="sub">${toggle("f-church", "⛪ Church", "Service times, sermon prep and a recap afterwards, plus your church bulletin.", f.church)}${toggle("f-memoryVerses", "📖 Scripture memory", "A chapter at a time, with gentle review.", f.memoryVerses)}</div>`)}
        ${toggle("f-claudeCode", "🛠️ Claude Code (for tinkerers)", "Ask Dayspring to change its own code by voice. This needs the Claude Code app installed.", f.claudeCode, `<div class="sub hint"><a href="/help#claude-code">How to install Claude Code</a></div>`)}
        <h2>Extra keys (optional)</h2>
        <p class="hint">These make a few things better. Skip them if you're not sure.</p>
        ${[["YOUTUBE", "YOUTUBE_API_KEY", "YouTube search", "Optional: YouTube search already works with no key and nothing opens on screen. A free key (Google Cloud, YouTube Data API v3) only makes searches a little faster and steadier.", "https://console.cloud.google.com/apis/library/youtube.googleapis.com"],
           ["ESV", "ESV_API_KEY", "ESV Bible", "Adds the English Standard Version. Free from api.esv.org.", "https://api.esv.org/"],
           ["NLT", "NLT_API_KEY", "NLT Bible", "Adds the New Living Translation. Free from api.nlt.to.", "https://api.nlt.to/"]].map(([n, kv, t, d, url]) => `
          <div class="item"><div class="grow"><div class="t">${t}</div><div class="s">${d}</div></div>${keyStatus(kv)}
            <input type="password" class="xkey" data-name="${n}" placeholder="Paste key" aria-label="${t} key" style="flex:0 1 12em"><button type="button" class="btn small" data-url="${url}">Get ↗</button></div>`).join("")}
        <h2>🎧 Discord bot (optional)</h2>
        <p class="hint">Dayspring can join your server's voice channels as its own member, hear its name, and answer out loud, and answer in text chat when you @mention it. Only you get your schedule and personal things; friends get friendly general answers. <a href="/help#discord-bot">Step-by-step setup</a></p>
        <div class="item"><div class="grow"><div class="t">Bot token</div><div class="s">Discord Developer Portal → your app → Bot → Reset Token.</div></div><span id="dcTokenState"></span>
          <input type="password" id="dcToken" placeholder="Paste token" aria-label="Discord bot token" style="flex:0 1 12em"><button type="button" class="btn small" data-url="https://discord.com/developers/applications">Open ↗</button></div>
        <div class="row" style="gap:.6em;flex-wrap:wrap">
          ${field("dcOwner", "Your Discord user ID", text("dcOwner", "", "e.g. 123456789012345678", "text", 'inputmode="numeric"'))}
          ${field("dcChannel", "Text channel ID (optional)", text("dcChannel", "", "Where it answers when you say its name", "text", 'inputmode="numeric"'))}
        </div>
        <div class="row" style="gap:.6em;align-items:center"><button type="button" class="btn small" id="dcSave">Save &amp; connect</button><span class="hint" id="dcState"></span></div>
        <div class="msg" id="m"></div>`; },
      mount: () => {
        $$("[data-login]").forEach((b) => b.onclick = async () => { try { await post("/media/login", { service: b.dataset.login }); toast("Sign-in window opened"); } catch (e) { msg($("#m"), "Couldn't open the sign-in window: " + e.message, "bad"); } });
        $$("[data-url]").forEach((b) => b.onclick = () => openLink(b.dataset.url));
        // Spotify inside Dayspring: save the Client ID (if one was just pasted), then sign in in the browser
        // (the section may be gone by the time an answer comes back: then there's nothing to write to)
        const spShow = async () => { const el = () => $("#spState"); try { const r = await api("/player/status"); const s = r.spotify ?? {}; if (el()) el().textContent = s.signedIn ? `✓ Connected${s.name ? " as " + s.name : ""}${s.product && s.product !== "premium" ? " (not Premium: songs won't play here)" : ""}` : s.configured ? "Client ID saved. Click Connect to sign in." : "Paste your Client ID first."; } catch { if (el()) el().textContent = ""; } };
        spShow();
        $("#spConnect").onclick = async () => {
          try {
            const v = $("#spClientId").value.trim();
            if (v) { S.keys = (await post("/setup/key", { name: "SPOTIFY", value: v })).keys; $("#spClientId").value = ""; }
            await post("/player/spotify/login", {});
            $("#spState").textContent = "The Spotify sign-in page opened in your browser. Sign in there, then come back.";
            const t0 = Date.now(), poll = setInterval(async () => { await spShow(); if (!$("#spState") || $("#spState").textContent.startsWith("✓") || Date.now() - t0 > 180000) clearInterval(poll); }, 3000);
            onLeave(() => clearInterval(poll));
          } catch (e) { msg($("#m"), "Couldn't connect Spotify: " + e.message, "bad"); }
        };
        // Church and Scripture memory are part of Faith: with Faith off they're greyed out and can't be switched
        const faith = () => $$("#f-church, #f-memoryVerses").forEach((x) => { const on = isOn("f-faith"); x.closest(".toggle").style.opacity = on ? "" : ".5"; x.disabled = !on; x.title = on ? "" : "Turn on Faith first"; });
        $("#f-faith").addEventListener("change", faith); faith();
        // Discord bot: show what's saved (never the token itself) and whether it's online
        const dcShow = (r) => {
          const k = r.keys ?? {}, b = r.bot ?? {};
          if (k.DISCORD_BOT_TOKEN) { S.keys = { ...(S.keys ?? {}), DISCORD_BOT_TOKEN: k.DISCORD_BOT_TOKEN }; $("#dcTokenState").innerHTML = keyStatus("DISCORD_BOT_TOKEN"); }
          if (k.DISCORD_OWNER_ID?.value && !$("#dcOwner").value) $("#dcOwner").value = k.DISCORD_OWNER_ID.value;
          if (k.DISCORD_TEXT_CHANNEL_ID?.value && !$("#dcChannel").value) $("#dcChannel").value = k.DISCORD_TEXT_CHANNEL_ID.value;
          $("#dcState").textContent = !b.configured ? "Not set up." : b.status === "online" ? `Online as ${b.user}${b.guilds?.length ? ` in ${b.guilds.map((g) => g.name).join(", ")}` : " (not in a server yet: use the invite link from the guide)"}${b.voice ? ` · in ${b.voice.channel}` : ""}.`
            : b.status === "connecting" ? "Connecting…" : `Not connected${b.lastError ? ": " + b.lastError : "."}`;
        };
        api("/setup/discord").then(dcShow).catch(() => {});
        api("/discover").then((d) => { const s = d.settings ?? {}; $("#f-discover")?.setAttribute("aria-checked", String(s.on !== false)); if ($("#dzFreq")) $("#dzFreq").value = s.frequency === "off" ? "off" : s.frequency || "few"; if ($("#dzMax")) $("#dzMax").value = String(s.toasts === false ? 0 : s.maxToastsPerDay ?? 2); }).catch(() => {});
        $("#dcSave").onclick = async () => {
          $("#dcState").textContent = "Connecting…";
          try { const r = await post("/setup/discord", { token: $("#dcToken").value.trim(), ownerId: $("#dcOwner").value.trim(), textChannelId: $("#dcChannel").value.trim() }); $("#dcToken").value = ""; dcShow(r); }
          catch (e) { $("#dcState").textContent = e.message; }
        };
      },
      save: async () => {
        const features = Object.fromEntries(["weather", "chores", "music", "photos", "news", "phone", "faith", "church", "memoryVerses", "claudeCode"].map((k) => [k, isOn("f-" + k)]));
        if (!features.faith) { features.church = false; features.memoryVerses = false; }
        const dzMax = Number($("#dzMax")?.value ?? 2);
        await post("/discover/settings", { on: isOn("f-discover"), frequency: $("#dzFreq")?.value ?? "few", toasts: dzMax > 0, maxToastsPerDay: dzMax }).catch(() => {});
        const r = await post("/setup/features", { features, photoDirs: $("#photoDirs").value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) });
        S.owner = r.owner;
        for (const el of $$(".xkey")) if (el.value.trim()) { S.keys = (await post("/setup/key", { name: el.dataset.name, value: el.value.trim() })).keys; el.value = ""; }
      } },

    // ------------------------------------------------------------------------------------------------ apps & connections (public/connections.js)
    // Every connected app: status, Set up / Manage (a step-by-step drawer) and Disconnect. Each card saves itself, so no Save button.
    { id: "apps", icon: "🔌", title: "Apps & connections", settingsOnly: true,
      render: () => window.DayspringApps ? window.DayspringApps.html() : `<h1>Apps &amp; connections</h1><p class="lead">This page didn't load. Reload to try again.</p>`,
      mount: () => window.DayspringApps?.mount($("#card"), { toast, openLink, keys: S.keys, owner: S.owner }) },

    // ------------------------------------------------------------------------------------------------ permissions
    { id: "permissions", icon: "🔐", title: "Permissions",
      render: () => { const p = S.permissions; return `
        <h1>What may Dayspring do?</h1>
        <p class="lead">You're in charge. Anything left off, Dayspring simply won't do, and it will say so if you ask. You can change these any time.</p>
        <h2>📁 Your files and folders</h2>
        ${choiceGroup("files", [
          { value: "off", title: "No file access", desc: "It won't look at your files." },
          { value: "folders", title: "Only certain folders", desc: "Just the folders you list below." },
          { value: "all", title: "All my files", desc: "Everything you can open. Windows system folders stay read-only." },
        ], p.files)}
        <div id="foldersWrap" ${p.files === "folders" ? "" : "hidden"}>${field("folders", "Folders it may use (one per line)", `<textarea id="folders" placeholder="C:\\Users\\you\\Documents\nD:\\Projects">${esc((p.folders ?? []).join("\n"))}</textarea>`)}</div>
        <div class="field"><span class="lbl" id="wf-l">Creating or changing files</span>${chipGroup("writeFiles", [["ask", "Ask me first"], ["on", "Just do it"], ["off", "Never"]], [p.writeFiles], false).replace('class="chips"', 'class="chips" role="group" aria-labelledby="wf-l"')}
          <div class="hint">With "Ask me first", it reads back what it's about to change and waits for your OK. A backup is always saved first.</div></div>
        <h2>🖥️ Programs</h2>
        <div class="field"><span class="lbl" id="pg-l">Opening apps on this computer (for example "open Word" or "start Discord")</span>${chipGroup("programs", [["off", "Off"], ["ask", "Ask me first"], ["on", "Allowed"]], [p.programs], false).replace('class="chips"', 'class="chips" role="group" aria-labelledby="pg-l"')}</div>
        <h2>🌐 The internet</h2>
        ${toggle("p-web", "Look things up online", "Search the web and read pages to answer your questions. This works with any AI you connect.", p.web)}
        ${toggle("p-browser", "Use its own browser window", "Open websites, click, fill in simple things and read pages for you. It never types passwords or payment details; you sign in to sites yourself.", p.browser)}
        <div class="note">You can also say it out loud: "you can read my Documents folder", "stop opening programs". <a href="/help#permissions">About permissions</a></div>
        <div class="msg" id="m"></div>`; },
      mount: () => { $("[data-group=files]").addEventListener("change", () => { $("#foldersWrap").hidden = chosen("files") !== "folders"; }); },
      save: async () => {
        const files = chosen("files") ?? "off", folders = ($("#folders")?.value ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
        if (files === "folders" && !folders.length) { $("#folders").focus(); throw new Error("List at least one folder, or pick another option."); }
        S.permissions = await post("/setup/permissions", { files, folders, writeFiles: chipsOf("writeFiles")[0] ?? "ask", programs: chipsOf("programs")[0] ?? "off", web: isOn("p-web"), browser: isOn("p-browser") });
      } },

    // ------------------------------------------------------------------------------------------------ screen
    { id: "screen", icon: "🖥️", title: "Screen",
      render: () => `
        <h1>Which screen?</h1>
        <p class="lead">Dayspring can fill a screen with your day: a second monitor, a TV, a tablet or just this laptop. Choose where it opens when you start it.</p>
        <div class="screens" id="screens"><div class="hint">Looking at your screens…</div></div>
        ${choiceGroup("display", [
          { value: "auto", title: "Automatic", desc: "The second screen if there is one, otherwise this one." },
          { value: "primary", title: "Main screen", desc: "Always on the main screen." },
          { value: "secondary", title: "Second screen", desc: "Always on the other screen." },
        ], ["auto", "primary", "secondary"].includes(S.owner.display) ? S.owner.display : "")}
        <h2>How Dayspring opens</h2>
        ${choiceGroup("openAs", [
          { value: "auto", title: "Automatic", desc: "Its own window on this screen, full screen on a TV or second screen." },
          { value: "window", title: "App window", desc: "A clean window of its own with no browser bars. It remembers the microphone and your sign-ins." },
          { value: "compact", title: "Compact (Dayspring mini)", desc: "A small window you can put anywhere: the time, what's on now and next, the weather, and a chat box." },
          { value: "fullscreen", title: "Full screen", desc: "Fills the screen, like the TV view. Move the mouse to the top for minimize, exit and sound." },
          { value: "tab", title: "Browser tab", desc: "A normal tab in your browser. The browser may ask to use the microphone, and sound may need one click to start." },
        ], ["auto", "window", "compact", "fullscreen", "tab"].includes(S.owner.openAs) ? S.owner.openAs : "auto")}
        <p class="hint">The Start menu also has "Dayspring (full screen)", "Dayspring mini" and "Dayspring in browser" to open it a different way just once. You can also say "open Dayspring in my browser", "make Dayspring small", "open in its own window" or "go full screen".</p>
        <h2>Which browser shows Dayspring?</h2>
        <div class="field"><select id="dbrowser" aria-label="Browser for the Dayspring screen"><option value="default">Your default browser</option></select>
          <div class="hint" id="dbNote">Any browser on this computer works. Microsoft Edge has the most natural-sounding free voices.</div>
          <p class="hint" id="dbUsing"></p>
          <p><button type="button" class="btn small" id="dbReopen" hidden>Reopen now</button></p>
          <p class="hint">It's used for every way Dayspring opens (mini, app window, full screen, browser tab) and for "Pop out". Each browser keeps its own Dayspring sign-ins, so after switching, allow the microphone once and sign in to your apps again in the new browser.</p></div>
        <h2>Speech recognition</h2>
        ${choiceGroup("speechEngine", [
          { value: "auto", title: "Automatic", desc: "The browser's own when it has one that works (Chrome, Edge), otherwise the private one on this computer (Brave, Firefox)." },
          { value: "browser", title: "The browser", desc: "Fast, and needs the internet. Chrome and Edge only." },
          { value: "local", title: "On this computer (private)", desc: "Nothing you say leaves the PC. Works in every browser. A one-time download of about 200 MB." },
        ], ["auto", "browser", "local"].includes(S.voice?.speechEngine) ? S.voice.speechEngine : "auto")}
        <h2>Opening and closing</h2>
        ${toggle("keepScreenOpen", "Keep the Dayspring screen open", "For a TV or an always-on display: if the screen closes or the TV is unplugged, it opens again by itself. Off: when you close Dayspring, it stays closed (alarms and notifications still work).", S.owner.keepScreenOpen === true)}
        ${toggle("openOnStartup", "Open the screen when Windows starts", "Only if Dayspring starts with Windows. Off: it starts hidden and shows notifications and alarms, and you open the screen when you want it.", S.owner.openOnStartup === true)}
        <h2>Stay awake</h2>
        ${toggle("keepAwake", "Keep this computer awake while Dayspring is running", "Only while it's plugged in: no sleep and no idle lock screen, so Dayspring can wake you, remind you and hear you. On battery it sleeps as usual. Nothing in your power settings changes.", S.keepAwake !== false)}
        <h2>Fit Dayspring to your screen</h2>
        <p class="hint">Everything here changes the Dayspring screen right away, so you can watch it while you adjust. Each group has its own Reset.</p>
        <p><button type="button" class="btn" id="fitNow">📐 Fit to screen…</button> <span class="hint">Shows bright lines at the edges to line up with your TV.</span></p>
        <div id="scbox">${SC_GROUPS.map((g) => `<fieldset class="scg" data-g="${g.id}"><legend>${g.title}</legend>${g.html}<button type="button" class="btn small ghost screset" data-g="${g.id}">Reset ${g.title.toLowerCase()}</button></fieldset>`).join("")}</div>
        <p><button type="button" class="btn small ghost" id="scResetAll">Reset the whole screen layout</button></p>
        <div class="msg" id="m"></div>`,
      mount: async (sec) => {
        await screenMount();
        api("/keepawake").then((k) => { S.keepAwake = k.on; $("#keepAwake")?.setAttribute("aria-checked", String(k.on)); }).catch(() => {});
        api("/settings").then((r) => { const v = r.settings?.speechEngine ?? "auto"; $$("[data-group=speechEngine] .choice").forEach((c) => { const on = c.dataset.value === v; c.classList.toggle("on", on); c.setAttribute("aria-checked", String(on)); }); }).catch(() => {});
        api("/setup/browsers").then((b) => {
          const sel = $("#dbrowser"); if (!sel) return;
          const def = (b.browsers ?? []).find((x) => x.isDefault);
          sel.innerHTML = `<option value="default">Your default browser${def ? " (" + esc(def.name) + ")" : ""}</option>` + (b.browsers ?? []).map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("");
          sel.value = [...sel.options].some((o) => o.value === b.chosen) ? b.chosen : "default";
          const using = (b.browsers ?? []).find((y) => y.id === b.using);
          if ($("#dbUsing")) $("#dbUsing").textContent = using ? `In use now: ${using.name}.` : "";
          const note = () => {
            const id = sel.value === "default" ? def?.id : sel.value; const x = (b.browsers ?? []).find((y) => y.id === id);
            $("#dbNote").textContent = (x?.note ? x.note + " " : "") + (id === "brave" ? "In Brave, Dayspring listens with the private speech recognition on this computer, and Brave has Windows' basic voices only (for a warmer voice use ElevenLabs, or Edge's free Natural voices). If a video won't play, turn Brave Shields down for localhost." : "Microsoft Edge has the most natural-sounding free voices.");
            const r = $("#dbReopen"); if (r) { r.hidden = !x || id === b.using; r.textContent = x ? `Reopen now in ${x.name}` : "Reopen now"; }
          };
          sel.onchange = note; note();
          $("#dbReopen").onclick = async () => {
            try { await post("/setup/display", { displayBrowser: sel.value }); const r = await post("/app/reopen", {}); msg($("#m"), r.noScreen ? r.message : "Reopening Dayspring in the new browser…", r.ok === false ? "bad" : "ok"); b.using = sel.value === "default" ? def?.id : sel.value; note(); if ($("#dbUsing") && x0()) $("#dbUsing").textContent = `In use now: ${x0().name}.`; }
            catch (e) { msg($("#m"), e.message, "bad"); }
          };
          const x0 = () => (b.browsers ?? []).find((y) => y.id === b.using);
        }).catch(() => {});
        $("[data-group=display]").addEventListener("change", () => { sec.display = chosen("display"); $$(".scr").forEach((x) => x.classList.remove("on")); });
        try {
          const r = await api("/setup/screens");
          if (!$("#screens")) return;   // they moved on to another section while the screens were being read
          if (!r.screens.length) { $("#screens").innerHTML = `<div class="hint">Couldn't read the screen layout. The choices below still work.</div>`; return; }
          const maxW = Math.max(...r.screens.map((s) => s.width));
          $("#screens").innerHTML = r.screens.map((s) => `<button type="button" class="scr${String(s.number) === String(S.owner.display) ? " on" : ""}" data-n="${s.number}" style="width:${Math.max(6, 11 * s.width / maxW)}em;aspect-ratio:${s.width}/${s.height}" aria-label="Screen ${s.number}, ${s.width} by ${s.height}${s.primary ? ", main" : ""}"><b>${s.number}</b>${s.width}×${s.height}${s.primary ? "<br>main" : ""}</button>`).join("");
          $$(".scr").forEach((b) => b.onclick = () => { $$(".scr").forEach((x) => x.classList.toggle("on", x === b)); $$("[data-group=display] .choice").forEach((x) => { x.classList.remove("on"); x.setAttribute("aria-checked", "false"); }); sec.display = b.dataset.n; });
        } catch { if ($("#screens")) $("#screens").innerHTML = ""; }
      },
      save: async (sec) => {
        const r = await post("/setup/display", { display: sec.display ?? chosen("display") ?? S.owner.display ?? "auto", displayBrowser: $("#dbrowser")?.value || S.owner.displayBrowser || "default", openAs: chosen("openAs") ?? S.owner.openAs ?? "auto", keepScreenOpen: isOn("keepScreenOpen"), openOnStartup: isOn("openOnStartup") });
        S.owner.keepScreenOpen = r.keepScreenOpen; S.owner.openOnStartup = r.openOnStartup;
        if (chosen("speechEngine")) { const st = await post("/settings", { speechEngine: chosen("speechEngine") }).catch(() => null); if (st?.settings && S.voice) S.voice.speechEngine = st.settings.speechEngine; }
        S.owner.display = r.display; S.owner.displayBrowser = r.displayBrowser; S.owner.openAs = r.openAs; S.voice.overscan = r.overscan;
        if ($("#keepAwake")) { const k = await post("/keepawake", { on: isOn("keepAwake") }).catch(() => null); if (k) S.keepAwake = k.on; }
      } },

    // ------------------------------------------------------------------------------------------------ sky & scenery
    { id: "sky", icon: "🎨", title: "Sky & scenery",
      render: () => `
        <h1>Sky &amp; scenery</h1>
        <p class="lead">The background of the Dayspring screen follows the real sky outside: the time of day, the weather and the season. Or choose your own look. Every change shows on the screen right away.</p>
        <div id="skyBox"><div class="hint">Loading…</div></div>
        <div class="msg" id="m"></div>`,
      mount: () => skyPanel() },

    // ------------------------------------------------------------------------------------------------ updates
    // New versions come from GitHub. The notice on the Dayspring screen offers the same three choices as "When a new
    // version comes out". Data and keys are backed up first and never replaced; a failed update is undone by itself.
    { id: "updates", icon: "⬆️", title: "Updates", settingsOnly: true,
      render: () => `
        <h1>Updates</h1>
        <p class="lead">Dayspring checks for a new version when it starts and every few hours. Your schedule, settings and keys are backed up first and are never replaced. If a new version doesn't start, the old one comes back by itself.</p>
        <div id="upBox" aria-live="polite"><div class="hint">Looking…</div></div>
        <h2>When a new version comes out</h2>
        ${choiceGroup("upWhen", [
          { value: "ask", title: "Ask me", desc: "Show what's new on the Dayspring screen and let me choose." },
          { value: "idle", title: "Install it when I'm not using Dayspring", desc: "After half an hour of quiet. Never during an alarm, a call or Tune in." },
          { value: "launch", title: "Install it the next time Dayspring starts", desc: "Downloaded now, installed just before Dayspring opens next time." },
        ], "ask")}
        <h2>What changed</h2>
        <div id="upHist"><div class="hint">Looking…</div></div>
        <div class="msg" id="m"></div>`,
      mount: async () => {
        const md = (t) => esc(t).split(/\r?\n/).map((l) => /^\s*[-*]\s+/.test(l) ? `<li>${l.replace(/^\s*[-*]\s+/, "").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")}</li>` : /^#+\s/.test(l) ? `<b>${l.replace(/^#+\s/, "")}</b>` : l.trim() ? `<p>${l.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")}</p>` : "").join("").replace(/(<li>.*?<\/li>)+/g, (x) => `<ul>${x}</ul>`);
        const when = (iso) => { try { return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); } catch { return iso; } };
        const paint = (st, info) => {
          const box = $("#upBox"); if (!box) return;
          const L = info ?? st.latest;
          const avail = L && L.available;
          box.innerHTML = `<p>This is <b>Dayspring ${esc(st.version)}</b>.${st.lastCheck ? ` <span class="hint">Last checked ${esc(when(st.lastCheck))}.</span>` : ""}</p>
            ${st.phase && !["idle", "error"].includes(st.phase) ? `<p class="msg">${esc(st.message)}</p>` : ""}
            ${st.error ? `<p class="msg bad">${esc(st.error)} <button class="btn small" type="button" id="upRetry">Retry</button></p>` : ""}
            ${!st.repo || L?.off ? `<p class="hint">${esc(L?.message || st.message || "Automatic updates aren't set up for this copy of Dayspring.")}</p>` : ""}${avail ? `<div class="note"><b>${esc(L.name || "Dayspring " + L.latest)} is available.</b>${st.staged ? " It's downloaded and ready." : ""}${L.notes ? `<details open><summary>What's new</summary>${md(L.notes)}</details>` : ""}</div>` : L && !L.off ? `<p>✓ You're up to date.</p>` : ""}
            <div class="row" style="gap:.5em;margin-top:.6em"><button class="btn" type="button" id="upCheck">Check now</button>${avail ? `<button class="btn primary" type="button" id="upNow">Update now</button>` : ""}</div>`;
          $("#upRetry")?.addEventListener("click", () => $("#upCheck").click());
          $("#upCheck").onclick = async () => { msg($("#m"), "Checking…"); try { const r = await api("/update/check"); paint(r.status, r); msg($("#m"), r.off ? "" : r.available ? "" : "You're up to date."); } catch (e) { msg($("#m"), e.message, "bad"); } };
          $("#upNow")?.addEventListener("click", async () => { if (!confirm("Install the update now? Dayspring restarts (about a minute). Your data is backed up first.")) return; msg($("#m"), "Installing… Dayspring will restart in a moment."); try { await post("/update/choose", { choice: "now" }); } catch (e) { msg($("#m"), e.message, "bad"); } });
          $$("[data-group=upWhen] .choice").forEach((b) => { const on = b.dataset.value === st.when; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); });
          const h = st.history ?? [];
          $("#upHist").innerHTML = h.length ? h.map((x) => `<details class="note"${x === h[0] ? " open" : ""}><summary><b>${esc(x.to)}</b> · ${esc(when(x.at))} · ${x.ok === true ? "✓ installed" : x.ok === false ? "✗ didn't work, the previous version was kept" : "installing"}</summary>${x.error ? `<p class="msg bad">${esc(x.error)}</p>` : ""}${x.notes ? md(x.notes) : "<p class='hint'>No notes.</p>"}</details>`).join("") : `<p class="hint">No updates installed yet. When one is, its notes show here.</p>`;
        };
        try { paint(await api("/update/status")); } catch (e) { msg($("#m"), e.message, "bad"); }
        // the choice saves as soon as it's made
        $("[data-group=upWhen]")?.addEventListener("change", async () => { try { await post("/update/when", { when: chosen("upWhen") ?? "ask" }); toast("Saved"); } catch (e) { msg($("#m"), e.message, "bad"); } });
      },
      save: async () => { await post("/update/when", { when: chosen("upWhen") ?? "ask" }); } },

    // ------------------------------------------------------------------------------------------------ notifications
    { id: "notifications", icon: "🔔", title: "Notifications", settingsOnly: true,
      render: () => `
        <h1>Notifications and quiet</h1>
        <p class="lead">Turn Dayspring's listening off with one click, choose how each kind of notification reaches you, and show notifications in front of every window.</p>
        <h2>Dayspring is</h2>
        ${choiceGroup("listenState", [
          { value: "active", title: "Active", desc: "Listens for “Dayspring” and speaks." },
          { value: "quiet", title: "Quiet", desc: "Still hears “Dayspring”, but says nothing: answers and notifications show on screen. Alarms still ring." },
          { value: "off", title: "Off", desc: "Not listening at all (the microphone is released) and says nothing. The schedule and alarms keep going." },
        ], ["active", "quiet", "off"].includes(S.voice?.listenState) ? S.voice.listenState : "active")}
        ${toggle("alarmsWhenOff", "Alarms still ring when Off", "Your wake-up alarm and alarm reminders ring even when Dayspring is off.", S.voice?.alarmsWhenOff !== false)}
        <p class="hint">Shortcuts: the coloured badge on the Dayspring screen, <b>Ctrl+Alt+Shift+D</b> anywhere in Windows (off / back on), or say “Dayspring, go quiet”.</p>
        <h2>How each kind arrives</h2>
        <div class="field" id="nkinds"></div>
        <div class="field"><label for="nAll"><b>Quick switch for everything</b></label> <select id="nAll"><option value="">Use the settings above</option><option value="voice">Speak everything</option><option value="chime">Chime only for everything</option><option value="silent">Everything silent (on screen only)</option></select></div>
        <h2>Desktop notifications</h2>
        ${toggle("ovOn", "Show notifications in front of every window", "Small cards at the top-right of the screen, even over full-screen apps. They never take the focus, and they go away by themselves. Skipped while the Dayspring window itself is in front.", S.voice?.overlay?.on !== false)}
        ${toggle("overlayWhenOff", "Show them when Dayspring is off", "Off stops listening and talking; the cards can still show.", S.voice?.overlayWhenOff !== false)}
        <p class="hint">With the Dayspring screen closed, alarms still ring from these cards (Snooze 9 min, Dismiss, Open Dayspring), and notifications set to Chime still chime.</p>
        ${toggle("speakWhenClosed", "Speak announcements even when the screen is closed", "Uses Windows' own voice when no Dayspring screen is open. Off: a chime instead.", S.voice?.speakWhenClosed === true)}
        <div class="field"><label for="ovSecs"><b>Stay on screen for</b> <span id="ovSecsV"></span></label><input type="range" id="ovSecs" min="3" max="30" step="1" value="${Number(S.voice?.overlay?.seconds) || 8}"></div>
        <div class="field"><label for="ovScreen"><b>Show them on</b></label> <select id="ovScreen"><option value="primary">The main screen</option><option value="1">Screen 1</option><option value="2">Screen 2</option><option value="3">Screen 3</option></select></div>
        <p><button type="button" class="btn small" id="ovTest">Show a test notification</button> <span class="hint" id="ovState"></span></p>
        <div class="msg" id="m"></div>`,
      mount: async () => {
        let s = {}; try { s = (await api("/settings")).settings ?? {}; } catch { /* defaults */ }
        const pick = (g, v) => $$(`[data-group=${g}] .choice`).forEach((b) => { const on = b.dataset.value === v; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); });
        if (!$("#nkinds")) return;          // left this section while loading
        pick("listenState", s.listenState ?? "active");
        const setT = (id, on) => $("#" + id)?.setAttribute("aria-checked", String(Boolean(on)));
        setT("alarmsWhenOff", s.alarmsWhenOff !== false); setT("overlayWhenOff", s.overlayWhenOff !== false); setT("speakWhenClosed", s.speakWhenClosed === true); setT("ovOn", s.overlay?.on !== false);
        $("#ovSecs").value = Number(s.overlay?.seconds) || 8;
        const KINDS = [["reminders", "Reminders"], ["schedule", "Schedule: start times, changes and check-ins"], ["texts", "Texts and phone"], ["lantern", "Lantern"], ["discover", "Discover"], ["system", "Updates, alerts and system"]];
        const OPTS = [["auto", "Usual (" + ({ voice: "spoken", chime: "chime", silent: "silent" }[s.mode] ?? "spoken") + ")"], ["voice", "Speak"], ["chime", "Chime only"], ["silent", "Silent"]];
        $("#nkinds").innerHTML = KINDS.map(([k, t]) => `<div class="row" style="display:flex;gap:.6em;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:.25em 0"><label for="nk-${k}">${t}</label><select id="nk-${k}" data-kind="${k}">${OPTS.map(([v, l]) => `<option value="${v}"${(s.notify?.[k] ?? "auto") === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>`).join("");
        $("#nAll").value = s.notifyAll ?? "";
        $("#ovScreen").value = String(s.overlay?.screen ?? "primary");
        const secs = () => { $("#ovSecsV").textContent = `${$("#ovSecs").value} seconds`; }; $("#ovSecs").oninput = secs; secs();
        api("/overlay").then((o) => { $("#ovState").textContent = o.running ? "On." : o.error ? o.error : "Starts with Dayspring's screen."; }).catch(() => {});
        $("#ovTest").onclick = async () => { try { const r = await post("/overlay/test", {}); $("#ovState").textContent = r.sent ? "Sent: look at the top-right of the screen." : (r.error || r.skipped || "Couldn't show it here."); } catch (e) { $("#ovState").textContent = e.message; } };
        $("[data-group=listenState]")?.addEventListener("change", async () => { try { await post("/listen", { state: chosen("listenState") ?? "active", from: "settings" }); } catch (e) { msg($("#m"), e.message, "bad"); } });
      },
      save: async () => {
        const notify = Object.fromEntries($$("#nkinds select").map((x) => [x.dataset.kind, x.value]));
        const r = await post("/settings", { notify, notifyAll: $("#nAll").value || null, alarmsWhenOff: isOn("alarmsWhenOff"), overlayWhenOff: isOn("overlayWhenOff"), speakWhenClosed: isOn("speakWhenClosed"), overlay: { on: isOn("ovOn"), seconds: Number($("#ovSecs").value), screen: $("#ovScreen").value } });
        if (S.voice) Object.assign(S.voice, r.settings ?? {});
        const want = chosen("listenState"); if (want && want !== (r.settings?.listenState ?? "active")) await post("/listen", { state: want, from: "settings" });
      } },

    // ------------------------------------------------------------------------------------------------ about
    { id: "about", icon: "ℹ️", title: "About", settingsOnly: true,
      render: () => `
        <h1>About Dayspring</h1>
        <p class="lead">Dayspring ${esc(S.version ?? "")}. It runs on this computer; your schedule, settings and keys stay here.</p>
        <h2>Running parts</h2>
        <p class="hint">Everything of Dayspring's that's running now. In Task Manager, look for <b>Dayspring</b> (with <b>Dayspring Server</b> under it) and helpers named Dayspring Speech, Dayspring Notifications, Dayspring Keep Awake and Dayspring Audio Capture. The Dayspring window itself shows under its browser (Edge, Chrome…), using its own Dayspring profile.</p>
        <div id="procBox" class="tablewrap"><div class="hint">Looking…</div></div>
        <p><button type="button" class="btn small" id="procRefresh">Refresh</button> <button type="button" class="btn small" id="procStop">Stop all</button></p>
        <div class="danger" style="margin-top:2em;border:1px solid rgba(255,143,163,.45);border-radius:.8em;padding:1em 1.1em">
          <h2 style="margin-top:0">Uninstall Dayspring</h2>
          <p class="hint" id="unHint">Removes Dayspring from this computer. You choose whether your data stays.</p>
          <button type="button" class="btn" id="unOpen" style="border-color:#ff8fa3;color:#ffb3c1">Uninstall Dayspring…</button>
        </div>
        <div class="msg" id="m"></div>
        <div id="unDlg" role="dialog" aria-modal="true" aria-labelledby="unTitle" hidden style="position:fixed;inset:0;z-index:100;background:rgba(5,7,16,.72);display:grid;place-items:center;padding:16px">
          <div style="max-width:34em;width:100%;background:#12162e;border:1px solid rgba(255,143,163,.45);border-radius:1em;padding:1.2em 1.3em;display:grid;gap:.7em">
            <h2 id="unTitle" style="margin:0">Uninstall Dayspring?</h2>
            <p class="hint" style="margin:0">This stops Dayspring and removes its program files, its shortcuts (desktop, Start menu, Start with Windows), its browser profiles (its sign-ins in the Dayspring window), and its entry in the shared folder Lantern uses. Lantern itself isn't touched.</p>
            ${choiceGroup("unData", [
              { value: "keep", title: "Remove Dayspring, keep my data", desc: "Settings, schedule, notes and backups stay in the folder shown below." },
              { value: "remove", title: "Remove Dayspring and my data", desc: "Your data goes to the Recycle Bin, so it can still be restored from there." },
            ], "keep")}
            <p class="hint" id="unWhere" style="margin:0"></p>
            ${toggle("unBackup", "Save a backup of my data to Documents first", "A .zip of your data folder, in your Documents folder.", false)}
            <label for="unName"><b id="unAsk">Type your name to confirm</b></label>
            <input id="unName" autocomplete="off" spellcheck="false">
            <div style="display:flex;gap:.6em;justify-content:flex-end;flex-wrap:wrap">
              <button type="button" class="btn" id="unCancel">Cancel</button>
              <button type="button" class="btn" id="unGo" disabled style="background:#c2334d;border-color:#c2334d;color:#fff">Uninstall</button>
            </div>
            <p class="msg" id="unMsg" aria-live="polite"></p>
          </div>
        </div>`,
      mount: async () => {
        const paint = async () => {
          try {
            const r = await api("/processes");
            const rows = r.processes ?? [];
            if (!$("#procBox")) return;        // left this section while loading
            $("#procBox").innerHTML = rows.length ? `<table><thead><tr><th>Name</th><th>What it is</th><th>PID</th><th>Memory</th></tr></thead><tbody>${rows.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.kind)}</td><td>${p.pid}</td><td>${p.memoryMB} MB</td></tr>`).join("")}</tbody></table>` : `<div class="hint">Nothing found.</div>`;
          } catch (e) { if ($("#procBox")) $("#procBox").innerHTML = `<div class="hint">${esc(e.message)}</div>`; }
        };
        paint();
        $("#procRefresh").onclick = paint;
        $("#procStop").onclick = async () => { await post("/processes/stop", {}).catch(() => {}); msg($("#m"), "Stopping Dayspring. Start it again with the Dayspring shortcut.", "ok"); };
        let info = null;
        try { info = await api("/uninstall/info"); } catch { /* shown when opened */ }
        if (info && !info.allowed) { $("#unOpen").disabled = true; $("#unHint").textContent = info.reason; }
        const dlg = $("#unDlg"), name = $("#unName");
        const matches = () => info && name.value.trim().toLowerCase().replace(/\s+/g, " ") === String(info.confirmWord).trim().toLowerCase().replace(/\s+/g, " ");
        const sync = () => {
          const remove = chosen("unData") === "remove";
          $("#unWhere").textContent = remove ? "Your data goes to the Recycle Bin." : `Your data stays in: ${info?.dataDir ?? ""}`;
          $("#unGo").disabled = !matches();
        };
        $("[data-group=unData]")?.addEventListener("change", () => { const remove = chosen("unData") === "remove"; $("#unBackup")?.setAttribute("aria-checked", String(remove)); sync(); });
        name.addEventListener("input", sync);
        const close = () => { dlg.hidden = true; $("#unOpen").focus(); };
        $("#unOpen").onclick = () => {
          if (!info?.allowed) return;
          dlg.hidden = false; name.value = "";
          $("#unAsk").textContent = `Type ${info.confirmWord === "Dayspring" ? "Dayspring" : "your name, " + info.confirmWord + ","} to confirm`;
          sync(); name.focus();
        };
        $("#unCancel").onclick = close;
        dlg.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
        $("#unGo").onclick = async () => {
          if (!matches()) return;
          $("#unGo").disabled = true; msg($("#unMsg"), "Uninstalling…");
          try { const r = await post("/uninstall", { keepData: chosen("unData") !== "remove", backup: isOn("unBackup"), confirm: name.value }); msg($("#unMsg"), (r.backup ? `Backup saved: ${r.backup}. ` : "") + r.text, "ok"); }
          catch (e) { msg($("#unMsg"), e.message, "bad"); $("#unGo").disabled = !matches(); }
        };
        if (params.get("uninstall") === "1") setTimeout(() => $("#unOpen").click(), 300);
      } },

    // ------------------------------------------------------------------------------------------------ lantern
    { id: "lantern", icon: "🏮", title: "Lantern", settingsOnly: true,
      render: () => `
        <h1>Lantern</h1>
        <p class="lead">Lantern is a free learning app from the same family as Dayspring. When both are on this computer they work together: Dayspring shows your courses and next lesson, opens a lesson when you ask, reads out course invitations and friend requests, and the two never talk over each other. Nothing here is needed if you don't use Lantern.</p>
        <div id="lnBox" aria-live="polite"><div class="hint">Looking…</div></div>
        <h2>Connect to Lantern</h2>
        <p class="hint">So Dayspring can tell you about course invitations and friend requests. If Lantern is on this computer, it keeps your account and Dayspring uses it. If not, sign in here with the email you were invited with; when Lantern is installed later, it takes over the sign-in, so you won't sign in twice.</p>
        <div id="lnConnect"></div>
        <details class="note"><summary>Your Lantern hub (from the person who invited you)</summary>
          <p class="hint">The hub is where Lantern keeps accounts. Paste its address and its <b>public</b> key (never a secret key). Leave it alone if Dayspring already knows it.</p>
          <div class="row">${field("lnHubUrl", "Hub address", text("lnHubUrl", "", "https://….supabase.co"))}</div>
          <div class="row">${field("lnHubKey", "Public key", text("lnHubKey", "", "sb_publishable_… or eyJ…"))}</div>
          <button class="btn" type="button" id="lnHubSave">Save the hub</button></details>
        <h2>The AI key</h2>
        <div id="lnKey"></div>
        <h2>Listening</h2>
        <p class="hint">Only one app listens for its name at a time. Dayspring does while it's running; you can hand the microphone to Lantern (say "Dayspring, let Lantern listen", and "take the mic back" to return it).</p>
        <div class="row" style="gap:.5em"><button class="btn" type="button" id="lnMicL">Let Lantern listen</button><button class="btn" type="button" id="lnMicD">Dayspring listens</button></div>
        <div class="msg" id="m"></div>`,
      mount: async () => {
        const m = $("#m");
        const paint = async () => {
          let s; try { s = await api("/lantern/status"); } catch (e) { return msg(m, e.message, "bad"); }
          const st = s.status;
          $("#lnBox").innerHTML = s.running
            ? `<p>✓ <b>Lantern is running</b>${st?.version ? " (" + esc(st.version) + ")" : ""}${st?.name ? ", signed in as <b>" + esc(st.name) + "</b>" : ""}.</p>
               ${(st?.courses ?? []).length ? "<ul>" + st.courses.map((c) => `<li><b>${esc(c.title)}</b>: ${esc(c.measure || (c.percent ?? 0) + "%")}${c.next ? " · next: " + esc(c.next.title) : ""}</li>`).join("") + "</ul>" : "<p class='hint'>No courses yet.</p>"}
               <button class="btn" type="button" id="lnOpen">Open Lantern</button>`
            : s.installed ? `<p>Lantern is installed but not running.</p><button class="btn" type="button" id="lnOpen">Open Lantern</button>`
            : `<p>Lantern isn't on this computer.</p><p class="hint">Dayspring can install it for you in <b>${esc(s.installDir)}</b> (about a minute, and it asks before installing anything else).</p><button class="btn primary" type="button" id="lnInstall">Install Lantern</button>${s.install ? `<p class="msg">${esc(s.install.message ?? "")}</p>` : ""}`;
          $("#lnOpen")?.addEventListener("click", async () => { try { await post("/lantern/open", {}); toast("Opening Lantern"); } catch (e) { msg(m, e.message, "bad"); } });
          $("#lnInstall")?.addEventListener("click", async () => { msg(m, "Installing Lantern… you can follow it on the Dayspring screen."); try { await post("/lantern/install", {}); } catch (e) { msg(m, e.message, "bad"); } });
          const c = s.connected;
          const codeHub = Boolean(s.hub?.emailCode);
          $("#lnConnect").innerHTML = s.running ? `<p class="hint">${st?.signedIn ? "✓ Lantern is running and signed in, so it keeps your account and Dayspring uses it." : "Lantern is running. Sign in there (Settings → Account &amp; hub) and Dayspring uses that account."}</p>`
            : c ? `<p>Connected as <b>${esc(c.email)}</b>.</p><button class="btn" type="button" id="lnOut">Disconnect</button>`
            : !s.hub ? `<p class="hint">First add the hub below (the person who invited you has it).</p>`
            : `${s.installed ? `<p><button class="btn primary" type="button" id="lnUseL">I already have Lantern on this computer</button> <span class="hint">Dayspring uses Lantern's sign-in.</span></p>` : ""}
               <div class="row">${field("lnEmail", "Your email", text("lnEmail", "", "you@example.com", "email"))}</div>
               <div class="row">${field("lnPw", "Password (6 or more characters)", text("lnPw", "", "", "password"))}</div>
               <div class="row" style="gap:.5em"><button class="btn primary" type="button" id="lnSignIn">Sign in</button><button class="btn" type="button" id="lnCreate">Create an account</button></div>
               <p class="hint" style="margin-top:.8em">No password? <button class="btn small" type="button" id="lnSend">Email me a sign-in link</button> Open the email on this computer and press its link.</p>
               ${codeHub ? `<div class="row" style="margin-top:.6em">${field("lnCode", "Or the 6-digit code from the email", text("lnCode", "", "123456", "text", 'inputmode="numeric" maxlength="8"'))}</div><button class="btn" type="button" id="lnVerify">Connect with the code</button>` : ""}`;
          $("#lnOut")?.addEventListener("click", async () => { await post("/lantern/disconnect", {}); paint(); });
          $("#lnUseL")?.addEventListener("click", async () => { msg(m, "Opening Lantern…"); try { const r = await post("/lantern/use-lantern", {}); msg(m, r.connected ? "✓ Dayspring uses Lantern's account." : (r.say || "Sign in in Lantern."), r.connected ? "ok" : ""); paint(); } catch (e) { msg(m, e.message, "bad"); } });
          const pwGo = async (create) => { const pw = $("#lnPw"); try { const r = await post("/lantern/password", { email: $("#lnEmail").value, password: pw.value, create }); pw.value = ""; msg(m, r.connected ? "Connected." : (r.say || "Check your email."), r.connected ? "ok" : ""); paint(); } catch (e) { msg(m, e.message, "bad"); } };
          $("#lnSignIn")?.addEventListener("click", () => pwGo(false));
          $("#lnCreate")?.addEventListener("click", () => pwGo(true));
          $("#lnSend")?.addEventListener("click", async () => { try { await post("/lantern/connect", { email: $("#lnEmail").value }); msg(m, codeHub ? "Sent. Press the link in the email on this computer, or type the code from it below." : "Sent. Open the email on this computer and press its sign-in link (check spam too). This page updates by itself.", "ok"); const was = Date.now(); const t = setInterval(async () => { const x = await api("/lantern/status").catch(() => null); if (x?.connected || Date.now() - was > 600000) { clearInterval(t); if (x?.connected) paint(); } }, 3000); } catch (e) { msg(m, e.message, "bad"); } });
          $("#lnVerify")?.addEventListener("click", async () => { try { await post("/lantern/verify", { code: $("#lnCode").value }); msg(m, "Connected.", "ok"); paint(); } catch (e) { msg(m, e.message, "bad"); } });
          const k = s.sharedKey ?? {};
          $("#lnKey").innerHTML = k.exists && k.updatedBy === "lantern" && !k.allowed ? `<p>Lantern already has an AI set up (${esc(k.provider ?? "")}). Use it in Dayspring too? The key stays encrypted on this computer and is never sent between the apps.</p><button class="btn primary" type="button" id="lnUse">Use the AI key from Lantern</button>`
            : k.exists && k.allowed && k.updatedBy !== "dayspring" ? `<p>✓ Dayspring uses the AI key from Lantern.</p><button class="btn" type="button" id="lnStop">Stop using it</button>`
            : k.exists && k.updatedBy === "dayspring" ? `<p>✓ Dayspring's AI key is shared with this computer's Lantern (Lantern still asks you first). <button class="btn" type="button" id="lnShare">Share it again</button></p>`
            : `<p class="hint">Share Dayspring's AI key with Lantern, so you only set it up once. It's stored encrypted for your Windows account only, and Lantern asks you before it uses it.</p><button class="btn" type="button" id="lnShare">Use Dayspring's AI key in Lantern</button>`;
          $("#lnUse")?.addEventListener("click", async () => { try { await post("/lantern/key", { use: true }); msg(m, "Done. Dayspring uses Lantern's AI key (restart Dayspring if replies don't use it yet).", "ok"); paint(); } catch (e) { msg(m, e.message, "bad"); } });
          $("#lnStop")?.addEventListener("click", async () => { try { await post("/lantern/key", { use: false }); paint(); } catch (e) { msg(m, e.message, "bad"); } });
          $("#lnShare")?.addEventListener("click", async () => { try { await post("/lantern/key", { share: true }); msg(m, "Shared. Lantern will ask you before it uses it.", "ok"); paint(); } catch (e) { msg(m, e.message, "bad"); } });
          $("#lnMicL").classList.toggle("primary", s.micOwner === "lantern"); $("#lnMicD").classList.toggle("primary", s.micOwner !== "lantern");
        };
        $("#lnMicL").onclick = async () => { await post("/lantern/mic", { app: "lantern" }).catch(() => {}); paint(); };
        $("#lnMicD").onclick = async () => { await post("/lantern/mic", { app: "dayspring" }).catch(() => {}); paint(); };
        $("#lnHubSave").onclick = async () => { try { await post("/lantern/hub", { url: $("#lnHubUrl").value, anonKey: $("#lnHubKey").value }); msg(m, "Hub saved.", "ok"); paint(); } catch (e) { msg(m, e.message, "bad"); } };
        await paint();
      } },

    // ------------------------------------------------------------------------------------------------ done
    { id: "done", icon: "🎉", title: "All set", wizardOnly: true,
      render: () => { const o = S.owner, f = o.features, on = Object.entries(f).filter(([, v]) => v).length; return `
        <h1>You're all set${o.name ? ", " + esc(o.name) : ""}!</h1>
        <p class="lead">Here's how ${esc(o.assistantName || "Dayspring")} is set up. You can change any of it later in <b>Settings</b> (the ⚙ button on the Dayspring screen).</p>
        <dl class="summary">
          <dt>Assistant</dt><dd>${esc(o.assistantName || "Dayspring")} · wakes to "${esc((o.wakeWords ?? [])[0] ?? "dayspring")}"</dd>
          <dt>AI brain</dt><dd>${esc(S.ai.label)}</dd>
          <dt>Voice</dt><dd>${esc({ browser: "Free voice", elevenlabs: "ElevenLabs", openai: "OpenAI" }[S.voice.provider])}${S.voice.voiceName ? " · " + esc(S.voice.voiceName) : ""}</dd>
          <dt>Location</dt><dd>${esc(o.location?.place || "Not set")}</dd>
          <dt>Routines</dt><dd>${S.schedule.routines.length}</dd>
          <dt>Features</dt><dd>${on} turned on</dd>
          <dt>Files</dt><dd>${esc({ off: "No access", folders: "Chosen folders", all: "All files" }[S.permissions.files] ?? "No access")}</dd>
        </dl>
        <h2>Try saying</h2>
        <div class="chips">${[`"${(o.wakeWords ?? ["dayspring"])[0]}, what's on today?"`, `"Add lunch with Mom on Friday at noon"`, `"Show me my week"`, `"What's the weather?"`, `"Play some calm music"`].map((x) => `<span class="chip" style="cursor:default">${esc(x)}</span>`).join("")}</div>
        <div class="row" style="gap:.6em;margin-top:1.4em"><a class="btn primary" href="/display" id="openIt">Open Dayspring →</a><a class="btn" href="/help">Read the guide</a></div>
        <div class="msg" id="m"></div>`; },
      mount: async () => {
        try { await post("/setup/finish"); S.owner.setupDone = true; }
        catch (e) { msg($("#m"), e.message, "bad"); }
      } },
  ];

  function friendlyAiError(e) {
    const s = String(e ?? "");
    if (/401|invalid.*key|authentication|incorrect api key|unauthorized/i.test(s)) return "The key wasn't accepted. Copy it again, including every character.";
    if (/credit|balance|billing|quota|402|insufficient/i.test(s)) return "The account needs credit. Add a few dollars in the provider's Billing page.";
    if (/ECONNREFUSED|fetch failed|11434/i.test(s)) return "Couldn't reach it. Is Ollama running? Open the Ollama app, then try again.";
    if (/model/i.test(s) && /not found|does not exist|404/i.test(s)) return "That model isn't available. Pick Recommended.";
    if (/timeout|aborted/i.test(s)) return "It took too long to answer. Check your internet connection and try again.";
    return s.slice(0, 200) || "Unknown error";
  }

  // ================================================================================================= the sky panel
  // Everything saves as you change it (POST /api/sky) and the Dayspring screen follows live. Voice changes ("make it rain")
  // arrive here too (the "sky" event), so the panel always shows what's really set.
  let skyES = null, skyMine = 0;
  async function skyPanel() {
    const box = $("#skyBox"); if (!box) return;
    let d;
    try { d = await api("/sky"); } catch (e) { box.innerHTML = `<div class="msg bad">Couldn't load the sky settings: ${esc(e.message)}. Restart Dayspring after updating, then try again.</div>`; return; }
    if (!document.getElementById("skycss")) {
      const st = document.createElement("style"); st.id = "skycss";
      st.textContent = `.skygrp{background:var(--panel);border:1px solid var(--edge);border-radius:var(--r);padding:.4em 1em .9em;margin:.8em 0}
        .skygrp h2{display:flex;align-items:center;gap:.6em;margin:.6em 0 .3em}.skygrp h2 .btn{margin-left:auto}
        .slider{display:grid;grid-template-columns:minmax(8em,11em) 1fr 3.4em;align-items:center;gap:.8em;margin:.35em 0}
        .slider label{font-size:.92em}.slider output{text-align:right;color:var(--muted);font-size:.88em;font-variant-numeric:tabular-nums}
        .skygrp .toggle{margin:.4em 0;background:none;border-color:var(--edge)}
        .chips.off{opacity:.55}.skysum{color:var(--muted);margin:.2em 0 .6em}
        .skyprev{display:flex;flex-wrap:wrap;gap:.35em}.skyprev .btn{min-height:2em}
        .schedmap{display:grid;grid-template-columns:repeat(auto-fill,minmax(12em,1fr));gap:.4em .9em}.schedmap label{display:flex;align-items:center;justify-content:space-between;gap:.5em;font-size:.92em}
        @media (max-width:560px){.slider{grid-template-columns:1fr 3em}.slider label{grid-column:1/-1}}`;
      document.head.appendChild(st);
    }
    const P = d.prefs, PR = d.presets, C = d.choices;
    const pct = (v) => `${Math.round(v * 100)}%`;
    const slider = (id, label, v, min, max, step, fmt = pct) => `<div class="slider"><label for="${id}">${label}</label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}"><output id="${id}-o">${fmt(Number(v))}</output></div>`;
    const WXN = { clear: "☀️ Clear", partly: "⛅ Partly cloudy", overcast: "☁️ Overcast", drizzle: "🌦️ Drizzle", rain: "🌧️ Rain", storm: "⛈️ Storm", snow: "🌨️ Snow", fog: "🌫️ Fog" };
    const PHN = { night: "Night", predawn: "Before dawn", sunrise: "Sunrise", morning: "Morning", midday: "Midday", afternoon: "Afternoon", golden: "Golden hour", sunset: "Sunset", dusk: "Dusk" };
    const SCN = { rotate: "A new one each day", hills: "Rolling hills", fields: "Crop fields", forest: "Forest", river: "River", none: "None (just sky)" };
    const cap = (s) => s[0].toUpperCase() + s.slice(1);
    const fmtShift = (v) => (v ? `${v > 0 ? "+" : ""}${v} min` : "none");
    const fmtWarm = (v) => (Math.abs(v) < 0.05 ? "neutral" : v > 0 ? `warm ${pct(v)}` : `cool ${pct(-v)}`);
    const grpHead = (title, group) => `<h2>${title}${group ? `<button type="button" class="btn small ghost" data-reset="${group}">Reset</button>` : ""}</h2>`;
    box.innerHTML = `
      ${toggle("skyOn", "Living sky", "Turn it off for a plain dark background.", P.on)}
      <p class="skysum" id="skySum">${esc(d.summary)}</p>
      <div class="skygrp">${grpHead("Vibe")}
        <p class="hint">One tap sets everything below; then tweak anything.</p>
        ${chipGroup("skyPreset", Object.entries(PR).map(([k, v]) => [k, v.label]), [P.preset], false)}
        <p class="hint" id="skyPresetDesc">${esc(PR[P.preset]?.desc ?? "Your own mix.")}</p>
        <div class="row"><button type="button" class="btn small" id="skyResetAll">Reset everything</button></div>
      </div>
      <div class="skygrp">${grpHead("Weather", "weather")}
        ${toggle("skyWxFollow", "Follow the real weather", "Rain outside means rain on the screen. Turn off to choose your own.", P.weather.follow)}
        ${chipGroup("skyWx", C.weathers.map((w) => [w, WXN[w] ?? cap(w)]), [P.weather.choice], false).replace('class="chips"', `class="chips${P.weather.follow ? " off" : ""}"`)}
        ${slider("skyClouds", "Clouds", P.weather.clouds, 0, 2, 0.1)}
        ${slider("skyRain", "Rain", P.weather.rain, 0, 2, 0.1)}
        ${slider("skyDrops", "Drops on the glass", P.weather.droplets, 0, 2, 0.1)}
        ${slider("skySnow", "Snow", P.weather.snow, 0, 2, 0.1)}
        ${slider("skyFog", "Fog", P.weather.fog, 0, 2, 0.1)}
        ${slider("skyWind", "Wind strength", P.weather.wind, 0, 2, 0.1)}
        ${slider("skyRays", "Sun rays &amp; glimmer", P.weather.rays, 0, 2, 0.1)}
        ${toggle("skyLightning", "Lightning in storms", "A soft flash now and then (never more than one every ~20 seconds).", P.weather.lightning)}
      </div>
      <div class="skygrp">${grpHead("Time of day", "time")}
        ${toggle("skyTimeFollow", "Follow the sun", "The sky changes with the real sunrise and sunset where you live.", P.time.follow)}
        ${chipGroup("skyPhase", C.phases.map((x) => [x, PHN[x] ?? cap(x)]), [P.time.phase], false).replace('class="chips"', `class="chips${P.time.follow ? " off" : ""}"`)}
        ${slider("skyShift", "Shift sunrise/sunset", P.time.shift, -60, 60, 5, fmtShift)}
      </div>
      <div class="skygrp">${grpHead("Season", "season")}
        ${toggle("skySeasonFollow", "Follow the calendar", "Spring blossoms, summer green, fall colors, winter snow.", P.season.follow)}
        ${chipGroup("skySeason", C.seasons.map((x) => [x, cap(x)]), [P.season.choice], false).replace('class="chips"', `class="chips${P.season.follow ? " off" : ""}"`)}
        ${slider("skyParticles", "Leaves, petals &amp; seeds", P.season.particles, 0, 2, 0.1)}
      </div>
      <div class="skygrp">${grpHead("Scenery", "scenery")}
        ${chipGroup("skyScene", C.scenes.map((x) => [x, SCN[x] ?? cap(x)]), [P.scenery.scene], false)}
        ${toggle("skyGrass", "Grass in the front", "Sways with the real wind.", P.scenery.grass)}
        ${toggle("skyWater", "Water shimmer", "Light on the river (it freezes in deep winter).", P.scenery.water)}
        ${toggle("skyLights", "Night lights &amp; fireflies", "Distant lights after dark; fireflies on summer nights.", P.scenery.lights)}
        ${toggle("skyStars", "Stars &amp; moon", "The moon shows its real phase.", P.scenery.stars)}
      </div>
      <div class="skygrp">${grpHead("Colors", "colors")}
        ${slider("skyBright", "Brightness", P.colors.brightness, 0.6, 1.3, 0.05)}
        ${slider("skySat", "Color richness", P.colors.saturation, 0.5, 1.5, 0.05)}
        ${slider("skyWarm", "Warmth", P.colors.warmth, -1, 1, 0.05, fmtWarm)}
        ${slider("skyDim", "Darken behind the cards", P.colors.dim, 0, 0.6, 0.05)}
        ${toggle("skyAccent", "Accent colors follow the sky", "Buttons and highlights turn rosy at dawn, sky blue by day, amber at dusk.", P.colors.accentFollows)}
        <p class="hint">Text always stays readable: the cards get darker when the sky is bright.</p>
      </div>
      <div class="skygrp">${grpHead("Motion")}
        ${chipGroup("skyMotion", [["normal", "Normal"], ["reduced", "Reduced (no particles)"], ["still", "Still (a paused painting)"]], [P.motion], false)}
        <p class="hint">Smoothness</p>
        ${chipGroup("skyFps", [["15", "15 fps (lightest)"], ["30", "30 fps"], ["60", "60 fps (smoothest)"]], [String(P.fps)], false)}
      </div>
      <div class="skygrp">${grpHead("Schedule-aware vibe", "schedule")}
        ${toggle("skySched", "Change the vibe with my schedule", "For example Focus during study blocks and Calm during devotions. It goes back when the block ends.", P.schedule.on)}
        <div class="schedmap">${C.categories.map((c) => `<label>${esc(CATS[c] ?? cap(c))}<select data-cat="${c}"><option value="">(no change)</option>${Object.entries(PR).map(([k, v]) => `<option value="${k}" ${P.schedule.map?.[c] === k ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</select></label>`).join("")}</div>
      </div>
      <div class="skygrp">${grpHead("Preview")}
        <p class="hint">Shows a look on the Dayspring screen for 20 seconds, then goes back. Nothing is saved.</p>
        <div class="skyprev">${[["sky", "night"], ["sky", "sunrise"], ["sky", "midday"], ["sky", "golden"], ["sky", "sunset"], ["weather", "rain"], ["weather", "storm"], ["weather", "snow"], ["weather", "fog"], ["season", "spring"], ["season", "summer"], ["season", "fall"], ["season", "winter"], ["scene", "forest"], ["scene", "fields"], ["scene", "river"], ["scene", "hills"]].map(([k, v]) => `<button type="button" class="btn small" data-prev-k="${k}" data-prev-v="${v}">${esc(k === "sky" ? PHN[v] : k === "weather" ? WXN[v] : cap(v))}</button>`).join("")}</div>
      </div>`;
    // ---- reading the form into a patch
    const num = (id) => Number($("#" + id).value);
    const one = (name) => chipsOf(name)[0];
    const readAll = () => ({
      on: isOn("skyOn"),
      weather: { follow: isOn("skyWxFollow"), choice: one("skyWx"), clouds: num("skyClouds"), rain: num("skyRain"), droplets: num("skyDrops"), snow: num("skySnow"), fog: num("skyFog"), wind: num("skyWind"), rays: num("skyRays"), lightning: isOn("skyLightning") },
      time: { follow: isOn("skyTimeFollow"), phase: one("skyPhase"), shift: num("skyShift") },
      season: { follow: isOn("skySeasonFollow"), choice: one("skySeason"), particles: num("skyParticles") },
      scenery: { scene: one("skyScene"), grass: isOn("skyGrass"), water: isOn("skyWater"), lights: isOn("skyLights"), stars: isOn("skyStars") },
      colors: { brightness: num("skyBright"), saturation: num("skySat"), warmth: num("skyWarm"), dim: num("skyDim"), accentFollows: isOn("skyAccent") },
      motion: one("skyMotion"), fps: Number(one("skyFps")),
      schedule: { on: isOn("skySched"), map: Object.fromEntries($$("[data-cat]", box).map((s) => [s.dataset.cat, s.value])) },
    });
    clearTimeout(skyPanel.t);
    skyPanel.read = readAll;
    const send = (body) => { clearTimeout(skyPanel.t); skyPanel.t = setTimeout(async () => {
      skyMine = Date.now();
      try { const r = await post("/sky", body); $("#skySum").textContent = r.summary; if (!body.preset && !body.reset) { $$('[data-chips="skyPreset"] .chip').forEach((c) => { const on = c.dataset.value === r.prefs.preset; c.classList.toggle("on", on); c.setAttribute("aria-pressed", on); }); $("#skyPresetDesc").textContent = PR[r.prefs.preset]?.desc ?? "Your own mix."; } }
      catch (e) { msg($("#m"), e.message, "bad"); }
    }, 180); };
    const saveAll = () => send({ patch: readAll() });
    // sliders: live label, save as you drag
    $$('input[type=range]', box).forEach((r) => r.addEventListener("input", () => {
      const v = Number(r.value), o = $("#" + r.id + "-o");
      if (o) o.textContent = r.id === "skyShift" ? fmtShift(v) : r.id === "skyWarm" ? fmtWarm(v) : pct(v);
      saveAll();
    }));
    // picking a weather/phase/season means "not following" that one any more
    const follows = { skyWx: "skyWxFollow", skyPhase: "skyTimeFollow", skySeason: "skySeasonFollow" };
    // the panel redraws after presets and resets: only the newest drawing listens (old ones would save stale values)
    if (box._skyChange) box.removeEventListener("change", box._skyChange);
    box.addEventListener("change", box._skyChange = (e) => {
      const el = e.target;
      if (el.matches?.('[data-chips="skyPreset"]')) { const k = one("skyPreset"); skyMine = Date.now(); post("/sky", { preset: k }).then(() => skyPanel()).catch((err) => msg($("#m"), err.message, "bad")); return; }
      const chipName = el.dataset?.chips;
      if (chipName && follows[chipName]) { const s = $("#" + follows[chipName]); if (s.getAttribute("aria-checked") === "true") s.setAttribute("aria-checked", "false"); }
      for (const [chips, sw] of Object.entries(follows)) $(`[data-chips="${chips}"]`)?.classList.toggle("off", isOn(sw));
      saveAll();
    });
    $$("[data-reset]", box).forEach((b) => (b.onclick = () => { skyMine = Date.now(); post("/sky", { reset: b.dataset.reset }).then(() => skyPanel()).catch((e) => msg($("#m"), e.message, "bad")); }));
    $("#skyResetAll").onclick = () => { skyMine = Date.now(); post("/sky", { reset: true }).then(() => { skyPanel(); toast("Back to the real world"); }).catch((e) => msg($("#m"), e.message, "bad")); };
    $$("[data-prev-k]", box).forEach((b) => (b.onclick = () => post("/ambient/preview", { [b.dataset.prevK]: b.dataset.prevV, seconds: 20 }).then(() => toast("Previewing on the Dayspring screen")).catch((e) => msg($("#m"), e.message, "bad"))));
    // changes from elsewhere (voice, the assistant) show up here
    if (!skyES) {
      try {
        skyES = new EventSource("/api/events");
        // redraw when what's saved differs from what the form shows (a voice change, the assistant, another window)
        skyES.addEventListener("sky", (e) => {
          if (visible()[cur]?.id !== "sky" || !skyPanel.read) return;
          let d = null; try { d = JSON.parse(e.data).prefs; } catch { return; }
          const pickOf = (x) => JSON.stringify(["on", "weather", "time", "season", "scenery", "colors", "motion", "fps"].map((k) => x[k]));
          if (pickOf(d) !== pickOf(skyPanel.read())) skyPanel();
        });
      } catch { /* fine without */ }
    }
  }

  // ================================================================================================= wizard / settings
  const visible = () => SECTIONS.filter((s) => (wizard ? !s.settingsOnly : !s.wizardOnly));
  function nav() {
    $("#nav").innerHTML = visible().map((s, i) => `<button type="button" data-i="${i}" class="${i === cur ? "on" : ""}" ${i === cur ? 'aria-current="page"' : ""}><span class="ic" aria-hidden="true">${s.icon}</span>${esc(s.title)}</button>`).join("");
    $$("#nav button").forEach((b) => b.onclick = () => go(Number(b.dataset.i)));
  }
  // "Need help?" under every section: its walkthrough in the guide (in the same frame on the Dayspring screen)
  const GUIDE = { welcome: ["getting-started", "Getting started"], you: ["settings-reference/you", "About you"], assistant: ["settings-reference/your-assistant", "Your assistant"],
    location: ["settings-reference/where-you-are", "Where you are"], ai: ["ai-providers", "AI providers"], voice: ["voices", "Voices"], sound: ["audio-devices", "Speakers and microphones"],
    week: ["schedule/routine-and-fixed-blocks", "Your usual week"], features: ["settings-reference/features--apps", "Features & apps"], apps: ["connections", "Connecting apps"],
    permissions: ["permissions", "Permissions"], screen: ["display-setup/fitting-dayspring-to-your-screen", "Fitting Dayspring to your screen"], sky: ["display-setup/the-living-sky", "The living sky"],
    done: ["tutorials", "Tutorials: how do I…?"] };
  const guideLink = (id) => { const g = GUIDE[id]; if (!g) return ""; const embed = params.get("embed");
    return `<p class="hint guide-link" style="margin-top:1.4em">❓ Need help? <a href="/help${embed ? "?embed=1" : ""}#${g[0]}"${embed ? "" : ' target="_blank" rel="noopener"'}>Open the guide for this step: ${esc(g[1])}</a> · <a href="/help${embed ? "?embed=1" : ""}#settings-reference"${embed ? "" : ' target="_blank" rel="noopener"'}>every setting explained</a></p>`; };
  let goGen = 0;   // which section is showing: a section still loading when they click to another one just stops quietly
  // things a section started (a poll, a timer) stop when you leave it
  let leaving = [];
  function onLeave(fn) { leaving.push(fn); }
  // Settings (not the wizard) saves a section's changes by itself when you move to another one
  let dirty = false;
  $("#card").addEventListener("input", () => { dirty = true; });
  $("#card").addEventListener("change", () => { dirty = true; });
  addEventListener("beforeunload", (e) => { if (dirty && !wizard && visible()[cur]?.save) { e.preventDefault(); e.returnValue = ""; } });
  async function go(i, { focus = true } = {}) {
    if (!wizard && dirty && visible()[cur]?.save && i !== cur) {
      const ok = await saveCurrent();
      if (!ok) return;                         // the message says what to fix; they stay here
    }
    dirty = false;
    for (const fn of leaving.splice(0)) { try { fn(); } catch { /* already gone */ } }
    const list = visible(), gen = ++goGen;
    cur = Math.max(0, Math.min(list.length - 1, i));
    const sec = list[cur];
    $("#card").innerHTML = (wizard ? `<div class="step">Step ${cur + 1} of ${list.length}</div>` : "") + sec.render(sec) + guideLink(sec.id);
    $("#card").style.animation = "none"; void $("#card").offsetWidth; $("#card").style.animation = "";
    $("#main").scrollTop = 0;
    try { await sec.mount?.(sec); } catch (e) { if (gen === goGen) console.error(e); }
    if (gen !== goGen) return;
    dirty = false;
    $("#bar").style.width = wizard ? `${(cur / (list.length - 1)) * 100}%` : "0";
    // footer
    const last = cur === list.length - 1;
    $("#back").hidden = !wizard || cur === 0;
    $("#skip").hidden = !wizard || last || sec.id === "welcome" || sec.id === "you";
    $("#next").textContent = wizard ? (last ? "Open Dayspring →" : sec.id === "welcome" ? "Let's go →" : "Next →") : "Save";
    $("#next").hidden = !wizard && !sec.save;
    $("#where").textContent = wizard ? sec.title : "";
    nav();
    history.replaceState(null, "", `?${wizard ? "wizard=1&" : ""}s=${sec.id}`);
    if (focus) { const first = $("#card input:not([type=hidden]), #card textarea"); if (sec.id === "you" && first) first.focus(); else $("#main").focus({ preventScroll: true }); }
  }
  async function saveCurrent() {
    const sec = visible()[cur];
    if (!sec.save) return true;
    const m = $("#m"), btn = $("#next");
    btn.disabled = true;
    try { await sec.save(sec); dirty = false; if (!wizard) { toast("Saved ✓"); } return true; }
    catch (e) { msg(m, e.message, "bad"); m?.scrollIntoView({ block: "nearest", behavior: "smooth" }); return false; }
    finally { btn.disabled = false; }
  }
  $("#next").onclick = async () => {
    const list = visible();
    if (wizard && cur === list.length - 1) { location.href = "/display"; return; }
    if (!(await saveCurrent())) return;
    if (wizard) go(cur + 1);
  };
  $("#skip").onclick = () => go(cur + 1);
  $("#back").onclick = () => go(cur - 1);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (!wizard || t.tagName === "TEXTAREA" || t.tagName === "BUTTON" || t.tagName === "A" || t.tagName === "SELECT" || t.closest?.(".voice")) return;
    e.preventDefault(); $("#next").click();
  });

  (async () => {
    try { S = await api("/setup/state"); }
    catch (e) { $("#card").innerHTML = `<h1>Can't reach Dayspring</h1><p class="lead">Is it running? Start it with <b>Start Dayspring</b>, then reload this page.</p><p class="hint">${esc(e.message)}</p>`; $("#foot").hidden = true; return; }
    wizard = params.get("wizard") === "1" || !S.owner.setupDone;
    document.body.classList.toggle("wizard", wizard);
    $("#ver").textContent = S.version ? "v" + S.version : "";
    $("#brandName").textContent = S.owner.assistantName || "Dayspring";
    $("#openLink").hidden = wizard;
    document.title = wizard ? "Set up Dayspring" : "Dayspring Settings";
    const want = visible().findIndex((s) => s.id === params.get("s"));
    go(want >= 0 ? want : 0, { focus: false });
  })();
})();
