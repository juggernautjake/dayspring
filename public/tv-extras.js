// Dayspring 1.3: the parts of the screen that go with understanding people without AI.
//   · "Here's what I can do that sounds close:" — up to 7 numbered choices and "None of these" (say, tap or press 1–7)
//   · timers: a small stack of countdowns (pause/resume, +1 min, cancel) and the card when one finishes
//   · recipes found online (6 cards), a recipe's easy steps (°F/°C), and cooking mode (big text, the screen stays awake)
//   · counting out loud, jokes with a beat before the punchline, knock-knock both ways, and Funny-mode joke offers
// Everything here uses tv.js's own speaking and listening (window.dsCore), so ✋ Stop stops it all.
(() => {
  const core = window.dsCore;
  if (!core) return;
  const $ = (s, el = document) => el.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (label, onClick, cls = "") => { const b = el("button", "dsx-btn " + cls, label); b.type = "button"; b.onclick = (e) => { e.stopPropagation(); onClick(e); }; return b; };
  const ORD = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh"];

  const css = el("style");
  css.textContent = `
  .dsx-card{position:fixed;z-index:60;left:50%;transform:translateX(-50%);bottom:12vh;width:min(560px,92vw);background:rgba(14,18,36,.96);color:#eef0ff;border:1px solid rgba(124,140,255,.45);border-radius:16px;padding:16px 18px;box-shadow:0 18px 60px rgba(0,0,0,.5);font:16px/1.4 system-ui,Segoe UI,sans-serif}
  .dsx-card h3{margin:0 0 10px;font-size:18px;font-weight:600}
  .dsx-opts{display:grid;gap:6px;margin:0;padding:0;list-style:none}
  .dsx-opts button{display:flex;gap:10px;align-items:center;width:100%;text-align:left;background:rgba(255,255,255,.06);color:inherit;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:8px 10px;font:inherit;cursor:pointer}
  .dsx-opts button:hover,.dsx-opts button:focus-visible{background:rgba(124,140,255,.25);outline:none}
  .dsx-opts b{display:inline-grid;place-items:center;min-width:26px;height:26px;border-radius:50%;background:#7c8cff;color:#0b0f22;font-size:14px}
  .dsx-none{margin-top:8px;background:none;border:1px dashed rgba(255,255,255,.3);color:#cfd3f5}
  .dsx-btn{background:rgba(255,255,255,.1);color:#eef0ff;border:1px solid rgba(255,255,255,.2);border-radius:9px;padding:6px 10px;font:inherit;font-size:14px;cursor:pointer}
  .dsx-btn:hover{background:rgba(124,140,255,.3)}
  .dsx-btn.main{background:#7c8cff;color:#0b0f22;border-color:#7c8cff;font-weight:600}
  .dsx-link{display:inline-block;margin-top:6px;color:#9fb0ff;text-decoration:underline;cursor:pointer;background:none;border:0;font:inherit;padding:0}
  #dsxTimers{position:fixed;z-index:40;right:16px;top:86px;display:grid;gap:6px;width:250px;font:14px/1.3 system-ui,Segoe UI,sans-serif}
  html.mini #dsxTimers{top:auto;bottom:54px;right:8px;width:200px;font-size:12px}
  .dsx-timer{display:grid;grid-template-columns:1fr auto;align-items:center;gap:2px 8px;background:rgba(14,18,36,.88);color:#eef0ff;border:1px solid rgba(124,140,255,.35);border-radius:12px;padding:7px 10px}
  .dsx-timer .t{font-variant-numeric:tabular-nums;font-size:20px;font-weight:600}
  html.mini .dsx-timer .t{font-size:16px}
  .dsx-timer .l{grid-column:1/-1;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .dsx-timer .c{display:flex;gap:4px}
  .dsx-timer .c button{background:rgba(255,255,255,.08);border:0;color:inherit;border-radius:7px;min-width:28px;height:26px;cursor:pointer;font:inherit}
  .dsx-timer.paused .t{opacity:.55}
  .dsx-timer.ringing{border-color:#ffb36b;background:rgba(70,36,10,.92);animation:dsxPulse 1.2s infinite}
  @keyframes dsxPulse{50%{box-shadow:0 0 0 6px rgba(255,179,107,.25)}}
  #dsxRing{bottom:auto;top:18vh;border-color:#ffb36b;background:rgba(40,24,10,.97);text-align:center}
  #dsxRing .big{font-size:30px;font-weight:600;margin:4px 0 12px}
  #dsxRing .row{display:flex;gap:8px;justify-content:center}
  #dsxCount{position:fixed;z-index:55;inset:0;display:grid;place-items:center;pointer-events:none}
  #dsxCount span{font:700 min(40vw,40vh)/1 system-ui,Segoe UI,sans-serif;color:#fff;text-shadow:0 10px 60px rgba(124,140,255,.7)}
  #dsxCook{position:fixed;z-index:58;inset:4vh 4vw;background:rgba(10,13,28,.97);color:#f4f5ff;border:1px solid rgba(124,140,255,.4);border-radius:22px;padding:22px 28px;display:grid;grid-template-rows:auto 1fr auto;gap:14px;font:18px/1.45 system-ui,Segoe UI,sans-serif}
  html.mini #dsxCook{inset:0;border-radius:0;padding:12px;font-size:15px}
  #dsxCook .hd{display:flex;justify-content:space-between;gap:12px;align-items:baseline}
  #dsxCook .hd h2{margin:0;font-size:26px}
  #dsxCook .step{font-size:clamp(24px,4.2vw,54px);line-height:1.3;overflow:auto}
  html.mini #dsxCook .step{font-size:22px}
  #dsxCook .n{opacity:.75;font-size:18px}
  #dsxCook .ft{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  #dsxCook .ing{columns:2 240px;font-size:18px;margin:0;padding-left:20px}
  .dsx-chip{display:inline-block;margin:2px 4px 2px 0;padding:2px 9px;border-radius:999px;background:rgba(124,140,255,.22);border:1px solid rgba(124,140,255,.45);font-size:.8em;cursor:pointer;color:inherit}
  .dsx-chip.temp{background:rgba(255,179,107,.18);border-color:rgba(255,179,107,.5)}
  #dsxRecipes{position:fixed;z-index:57;inset:5vh 4vw;overflow:auto;background:rgba(10,13,28,.97);color:#f4f5ff;border:1px solid rgba(124,140,255,.4);border-radius:22px;padding:18px 22px;font:15px/1.4 system-ui,Segoe UI,sans-serif}
  html.mini #dsxRecipes{inset:0;border-radius:0;padding:10px}
  #dsxRecipes .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px;margin-top:12px}
  .dsx-rc{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
  .dsx-rc .img{aspect-ratio:4/3;background:#1b2140 center/cover no-repeat;display:grid;place-items:center;font-size:40px}
  .dsx-rc .img img{width:100%;height:100%;object-fit:cover;display:block}
  .dsx-rc .bd{padding:10px 12px;display:grid;gap:4px;flex:1}
  .dsx-rc h4{margin:0;font-size:16px}
  .dsx-rc .meta{opacity:.8;font-size:13px}
  .dsx-rc .act{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 12px}
  .dsx-num{display:inline-grid;place-items:center;min-width:22px;height:22px;border-radius:50%;background:#7c8cff;color:#0b0f22;font-size:12px;font-weight:700;margin-right:6px}
  .dsx-close{float:right}
  .dsx-phase{margin:14px 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.7}
  .dsx-steps{margin:0;padding-left:22px;display:grid;gap:8px}
  .dsx-uses{font-size:13px;opacity:.75}
  `;
  document.head.appendChild(css);

  const silentNow = () => core.textOnly || core.listenState !== "active";

  // ---------------------------------------------------------------- suggestions
  let sugEl = null, sugTimer = 0;
  function hideSuggest() { sugEl?.remove(); sugEl = null; clearTimeout(sugTimer); }
  function showSuggest(sg, { typed }) {
    hideSuggest();
    sugEl = el("div", "dsx-card"); sugEl.id = "dsxSuggest"; sugEl.setAttribute("role", "dialog"); sugEl.setAttribute("aria-label", sg.prompt);
    sugEl.appendChild(el("h3", "", sg.prompt));
    const ol = el("ol", "dsx-opts");
    for (const o of sg.options) {
      const li = el("li"); const b = el("button"); b.type = "button"; b.dataset.n = o.n;
      b.appendChild(el("b", "", String(o.n))); b.appendChild(el("span", "", o.label));
      b.onclick = () => pick(o.n, o.label, typed);
      li.appendChild(b); ol.appendChild(li);
    }
    sugEl.appendChild(ol);
    const none = btn(sg.none || "None of these", () => pick("none", sg.none || "None of these", typed), "dsx-none");
    sugEl.appendChild(none);
    document.body.appendChild(sugEl);
    sugTimer = setTimeout(hideSuggest, 90_000);
  }
  function pick(n, label, typed) { hideSuggest(); core.push("me", n === "none" ? "None of these" : `${n}. ${label}`); core.ask(n === "none" ? "none of these" : String(n), { typed: typed || silentNow(), internal: true }); }
  addEventListener("keydown", (e) => {
    if (!sugEl || e.ctrlKey || e.altKey || e.metaKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "")) return;
    if (/^[1-7]$/.test(e.key)) { const b = $(`button[data-n="${e.key}"]`, sugEl); if (b) { e.preventDefault(); b.click(); } }
    else if (e.key === "Escape" || e.key === "0") { e.preventDefault(); $(".dsx-none", sugEl)?.click(); }
  });

  // ---------------------------------------------------------------- timers
  let snap = { timers: [], ringing: [], stopwatch: { running: false, elapsed: 0 }, now: Date.now() }, skew = 0, ringCard = null;
  const box = el("div"); box.id = "dsxTimers"; box.setAttribute("aria-live", "polite");
  // the countdowns live at the top of the notification stack, so together they stay clear of the talk controls
  { const rail = document.getElementById("toasts"); if (rail) rail.insertBefore(box, rail.firstChild); else document.body.appendChild(box); }
  const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
  const leftOf = (t) => (t.paused || !t.endsAt ? t.left : t.endsAt - (Date.now() + skew));
  const act = (action, ref, extra = {}) => core.post("/timers", { action, ref, ...extra }).then(setTimers).catch((e) => core.toast("Timer", e.message, "", "bell"));
  function setTimers(s) { if (!s?.timers) return; snap = s; if (s.now) skew = s.now - Date.now(); render(); if (!s.ringing?.length) hideRing(); }
  function render() {
    box.replaceChildren();
    for (const r of snap.ringing ?? []) {
      const d = el("div", "dsx-timer ringing"); d.appendChild(el("span", "t", "0:00"));
      const c = el("span", "c"); c.appendChild(btn("✓", () => act("dismiss", r.id))); d.appendChild(c);
      d.appendChild(el("span", "l", `${r.label} · done`)); box.appendChild(d);
    }
    for (const t of snap.timers ?? []) {
      const d = el("div", "dsx-timer" + (t.paused ? " paused" : "")); d.dataset.id = t.id;
      d.appendChild(el("span", "t", fmt(leftOf(t))));
      const c = el("span", "c");
      const p = btn(t.paused ? "▶" : "⏸", () => act(t.paused ? "resume" : "pause", t.id)); p.title = t.paused ? "Resume" : "Pause"; p.setAttribute("aria-label", `${t.paused ? "Resume" : "Pause"} ${t.label}`);
      const a = btn("+1", () => act("add", t.id, { ms: 60_000 })); a.title = "Add a minute"; a.setAttribute("aria-label", `Add a minute to ${t.label}`);
      const x = btn("✕", () => act("cancel", t.id)); x.title = "Cancel"; x.setAttribute("aria-label", `Cancel ${t.label}`);
      c.append(p, a, x); d.appendChild(c);
      d.appendChild(el("span", "l", t.label)); box.appendChild(d);
    }
    const w = snap.stopwatch;
    if (w && (w.running || w.elapsed > 0)) {
      const d = el("div", "dsx-timer" + (w.running ? "" : " paused")); d.dataset.sw = "1";
      d.appendChild(el("span", "t", fmt(w.elapsed + (w.running ? Date.now() + skew - snap.now : 0))));
      const c = el("span", "c"); c.append(btn(w.running ? "⏸" : "▶", () => act("stopwatch", "", { what: w.running ? "stop" : "start" })), btn("✕", () => act("stopwatch", "", { what: "reset" }))); d.appendChild(c);
      d.appendChild(el("span", "l", "Stopwatch")); box.appendChild(d);
    }
  }
  setInterval(() => {
    for (const d of box.querySelectorAll(".dsx-timer[data-id]")) { const t = snap.timers.find((x) => x.id === d.dataset.id); if (t) $(".t", d).textContent = fmt(leftOf(t)); }
    const sw = $(".dsx-timer[data-sw] .t", box), w = snap.stopwatch; if (sw && w?.running) sw.textContent = fmt(w.elapsed + Date.now() + skew - snap.now);
  }, 500);
  function hideRing() { ringCard?.remove(); ringCard = null; }
  function showRing(item) {
    const labels = item.timer?.labels ?? [];
    if (!ringCard) {
      ringCard = el("div", "dsx-card"); ringCard.id = "dsxRing"; ringCard.setAttribute("role", "alertdialog");
      document.body.appendChild(ringCard);
    }
    ringCard.replaceChildren(el("h3", "", "⏲ Timer done"), el("div", "big", labels.join(" · ") || "Timer"), el("div", "", item.text));
    const row = el("div", "row");
    row.append(btn("Dismiss", () => { act("dismiss", ""); hideRing(); core.stopSpeaking(); }, "main"), btn("+5 min", () => { act("snooze", "", { ms: 5 * 60_000 }); hideRing(); }), btn("Snooze 10 min", () => { act("snooze", "", { ms: 10 * 60_000 }); hideRing(); }));
    ringCard.appendChild(row);
  }
  async function timerDone(item) {
    // a focus round moving on, or "time to drink water": said once, nothing to dismiss
    if (item.timer?.once) { core.toast("⏲ " + (item.timer.labels?.[0] ?? "Timer"), item.text, "", "bell"); if (core.listenState === "active" && !core.textOnly) await core.notify(item.text, { kind: "reminders", sound: "ding", chip: { title: "⏲ Timer", category: "flex" }, polite: false, toasted: true }); return; }
    showRing(item);
    core.wake(10 * 60_000);
    const quietNow = core.listenState !== "active";
    if (quietNow && core.prefs.timersWhenQuiet === false) return;          // Quiet/Off, and timers follow it: shown only
    if (core.textOnly) { core.playSound("ding", "alarm"); return; }
    if (quietNow) { core.playSound("alarm", "alarm"); await core.sleep(900); await core.speak(item.text, { title: "Timer", category: "flex" }, "alarm"); return; }
    await core.notify(item.text, { kind: "reminders", sound: "alarm", chip: { title: "⏲ Timer", category: "flex" }, polite: false, toasted: true });
    if (core.prefs.mode === "voice" && !item.timer?.repeat) core.openCommandWindow(core.REPLY_MS);   // "dismiss" / "five more minutes"
  }
  function hook(es) {
    es.addEventListener("timers", (e) => { try { setTimers(JSON.parse(e.data)); } catch { /* bad event */ } });
    es.addEventListener("cooking", (e) => { try { const d = JSON.parse(e.data); showCooking(d?.cooking === undefined ? d : d.cooking); } catch { /* bad event */ } });
  }
  if (window.dsEvents) hook(window.dsEvents); else addEventListener("ds-events", (e) => hook(e.detail), { once: true });
  core.json("/timers").then(setTimers).catch(() => {});

  // ---------------------------------------------------------------- cooking mode
  let cookEl = null, wakeLock = null, unit = (() => { try { return localStorage.getItem("ds-temp-unit") || "F"; } catch { return "F"; } })();
  function tempChip(t) { const c = el("button", "dsx-chip temp", unit === "C" ? `${t.c}°C` : `${t.f}°F`); c.type = "button"; c.title = "Switch °F / °C"; c.onclick = () => { unit = unit === "C" ? "F" : "C"; try { localStorage.setItem("ds-temp-unit", unit); } catch { /* fine */ } rerender(); }; return c; }
  function timerChip(tm, label) { const c = el("button", "dsx-chip", `⏲ ${tm.text}`); c.type = "button"; c.title = "Start this timer"; c.onclick = () => act("start", "", { ms: tm.ms, label: tm.label || label }); return c; }
  let lastCook = null, lastView = null;
  function rerender() { if (cookEl && lastCook) showCooking(lastCook); if (viewEl && lastView) showRecipe(lastView); }
  async function keepAwake(on) {
    try { if (on && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener?.("release", () => { wakeLock = null; }); } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; } } catch { /* not allowed here */ }
  }
  function showCooking(c) {
    if (!c) { cookEl?.remove(); cookEl = null; lastCook = null; keepAwake(false); return; }
    lastCook = c; core.wake(60 * 60_000); keepAwake(true);
    if (!cookEl) { cookEl = el("section"); cookEl.id = "dsxCook"; cookEl.setAttribute("aria-label", "Cooking"); document.body.appendChild(cookEl); }
    const hd = el("div", "hd"); hd.append(el("h2", "", c.title), el("span", "n", c.i < 0 ? `${c.total} steps` : `Step ${c.i + 1} of ${c.total}${c.factor && c.factor !== 1 ? ` · ×${Math.round(c.factor * 100) / 100}` : ""}`));
    const mid = el("div", "step");
    if (c.i < 0) {
      mid.appendChild(el("div", "n", "You'll need"));
      const ul = el("ul", "ing"); for (const x of c.ingredients ?? []) ul.appendChild(el("li", "", x)); mid.appendChild(ul);
    } else {
      mid.appendChild(el("div", "", c.step?.text ?? ""));
      const chips = el("div");
      for (const tm of c.step?.timers ?? []) chips.appendChild(timerChip(tm, `step ${c.i + 1}`));
      for (const t of c.step?.temps ?? []) chips.appendChild(tempChip(t));
      if (chips.childNodes.length) mid.appendChild(chips);
      if (c.step?.uses?.length) mid.appendChild(el("div", "dsx-uses", "Uses: " + c.step.uses.join(", ")));
    }
    const ft = el("div", "ft");
    const say = (t) => core.ask(t, { typed: silentNow(), internal: true });
    ft.append(btn("◀ Back", () => say("previous step")), btn(c.i < 0 ? "Start ▶" : "Next ▶", () => say("next step"), "main"), btn("Ingredients", () => say("what are the ingredients")), btn("Repeat", () => say("repeat the step")), btn("Done cooking", () => say("stop cooking")));
    cookEl.replaceChildren(hd, mid, ft);
  }

  // ---------------------------------------------------------------- recipes found online, and one recipe's easy steps
  let gridEl = null, viewEl = null;
  function closeGrid() { gridEl?.remove(); gridEl = null; }
  function closeView() { viewEl?.remove(); viewEl = null; lastView = null; }
  function showResults(r) {
    closeView();
    if (!gridEl) { gridEl = el("section"); gridEl.id = "dsxRecipes"; gridEl.setAttribute("aria-label", "Recipes"); document.body.appendChild(gridEl); }
    const head = el("div"); head.append(btn("✕ Close", closeGrid, "dsx-close"), el("h2", "", `${r.query ? r.query[0].toUpperCase() + r.query.slice(1) : "Recipe"} recipes`));
    const grid = el("div", "grid");
    for (const x of r.results ?? []) {
      const card = el("article", "dsx-rc");
      const im = el("div", "img");
      if (x.image) { const i = new Image(); i.alt = ""; i.loading = "lazy"; i.src = `/api/recipes/found-image?ref=${encodeURIComponent(x.tempId)}`; i.onerror = () => { i.remove(); im.textContent = "🍽"; }; im.appendChild(i); } else im.textContent = "🍽";
      const bd = el("div", "bd");
      const h = el("h4"); h.append(el("span", "dsx-num", String(x.n)), document.createTextNode(x.title)); bd.appendChild(h);
      bd.appendChild(el("div", "meta", [x.site, x.time ? `${x.time} min` : null, x.servings ? `serves ${x.servings}` : null].filter(Boolean).join(" · ")));
      bd.appendChild(el("div", "meta", [x.rating?.value ? `★ ${Math.round(x.rating.value * 10) / 10}${x.rating.count ? ` (${x.rating.count})` : ""}` : null, `${x.ingredients} ingredients`].filter(Boolean).join(" · ")));
      const a = el("div", "act");
      a.append(
        btn("Use this one", () => { closeGrid(); core.ask(`use the ${ORD[x.n - 1]} one`, { typed: silentNow(), internal: true }); }, "main"),
        btn("Save for later", () => core.post("/recipes/found", { ref: x.tempId, then: "save" }).then((s) => core.toast("Saved", s.recipe?.title ?? x.title, "", "bell")).catch((e) => core.toast("Couldn't save", e.message, "", "bell"))),
        btn("View details", () => core.post("/recipes/found", { ref: x.tempId, then: "view" }).then((s) => showRecipe({ ...s.recipe, found: x })).catch((e) => core.toast("Recipe", e.message, "", "bell"))),
      );
      card.append(im, bd, a); grid.appendChild(card);
    }
    const foot = el("div", "act");
    if (r.more) foot.appendChild(btn("More options", () => core.ask("more options", { typed: silentNow(), internal: true })));
    gridEl.replaceChildren(head, grid, foot);
  }
  function showRecipe(r) {
    lastView = r;
    if (!viewEl) { viewEl = el("section"); viewEl.id = "dsxRecipes"; viewEl.setAttribute("aria-label", r.title); document.body.appendChild(viewEl); }
    gridEl?.remove(); gridEl = null;
    const head = el("div"); head.append(btn("✕ Close", closeView, "dsx-close"), el("h2", "", r.title));
    const src = r.source ?? {};
    if (src.site || src.author) head.appendChild(el("div", "meta", `From ${[src.author, src.site].filter(Boolean).join(" · ")}`));
    if (src.url && /^https?:\/\//.test(src.url)) { const a = el("a", "dsx-link", "Original page ↗"); a.href = src.url; a.target = "_blank"; a.rel = "noopener noreferrer"; head.appendChild(a); }
    const body = el("div");
    body.appendChild(el("div", "dsx-phase", "Ingredients"));
    const ul = el("ul", "ing"); for (const x of r.ingredients ?? []) ul.appendChild(el("li", "", x)); body.appendChild(ul);
    let phase = null, ol = null;
    for (const st of r.easy ?? []) {
      if (st.phase !== phase) { phase = st.phase; body.appendChild(el("div", "dsx-phase", phase)); ol = el("ol", "dsx-steps"); ol.start = st.n; body.appendChild(ol); }
      const li = el("li"); li.appendChild(el("div", "", st.text));
      const chips = el("div"); for (const tm of st.timers ?? []) chips.appendChild(timerChip(tm, `step ${st.n}`)); for (const t of st.temps ?? []) chips.appendChild(tempChip(t));
      if (chips.childNodes.length) li.appendChild(chips);
      if (st.uses?.length) li.appendChild(el("div", "dsx-uses", "Uses: " + st.uses.join(", ")));
      ol.appendChild(li);
    }
    const foot = el("div", "act");
    if (r.found) foot.append(btn("Use this one", () => { closeView(); core.ask(`use the ${ORD[r.found.n - 1]} one`, { typed: silentNow(), internal: true }); }, "main"), btn("Save for later", () => core.post("/recipes/found", { ref: r.found.tempId, then: "save" }).then((s) => core.toast("Saved", s.recipe?.title ?? r.title, "", "bell")).catch(() => {})));
    else if (r.id) foot.append(btn("Start cooking", () => { closeView(); core.post("/cooking", { action: "start", id: r.id }).then((c) => showCooking(c.cooking)).catch(() => {}); }, "main"));
    foot.appendChild(btn("Simplify with AI", () => core.ask(`Simplify this recipe into short, easy steps: ${r.title}. ${(r.easy ?? []).map((s) => s.text).join(" ")}`.slice(0, 1800), { typed: true, internal: true })));
    viewEl.replaceChildren(head, body, foot);
  }

  // ---------------------------------------------------------------- counting, jokes
  let counting = null;
  const countEl = el("div"); countEl.id = "dsxCount"; countEl.hidden = true; const countNum = el("span"); countEl.appendChild(countNum); document.body.appendChild(countEl);
  async function count(numbers, gen) {
    const g0 = core.speechGen;
    let done; counting = new Promise((r) => { done = r; });
    countEl.hidden = false;
    try {
      const size = numbers.length > 30 ? 4 : 3;                      // about 2–3 numbers a second
      for (let i = 0; i < numbers.length; i += size) {
        if (!gen() || core.speechGen !== g0) break;                 // ✋ Stop, "that's enough", or a new question
        const chunk = numbers.slice(i, i + size);
        countNum.textContent = String(chunk[0]);
        const tick = setInterval(() => { const k = chunk.indexOf(Number(countNum.textContent)); if (k >= 0 && k < chunk.length - 1) countNum.textContent = String(chunk[k + 1]); }, 420);
        await core.speak(chunk.join(", ") + (i + size >= numbers.length ? "." : ","), null, "general", { speed: 1.05 });
        clearInterval(tick); countNum.textContent = String(chunk.at(-1));
      }
    } finally { await core.sleep(500); countEl.hidden = true; counting = null; done(); }
  }
  // no answer to "Knock knock" or a riddle: the joke finishes on its own
  async function waitForAnswer(ms) { const a = core.askGen; core.openCommandWindow(ms); const t0 = Date.now(); while (Date.now() - t0 < ms + 1500) { await core.sleep(250); if (core.askGen !== a) return true; if (core.mode === "idle" && Date.now() - t0 > 1500) break; } return core.askGen !== a; }
  async function deliverJoke(r, { gen, rv }) {
    const j = r.joke;
    if (j.type === "oneliner" && j.punchline) {
      await core.speak(j.setup, null, "general", rv); if (!gen()) return true;
      await core.sleep(j.pauseMs || 1200); if (!gen()) return true;
      await core.speak(j.punchline, null, "general", rv);
      if (core.prefs.mode === "chime") core.playSound("done");
      core.openCommandWindow(core.REPLY_MS);
      return true;
    }
    if (j.type === "qa") {
      await core.speak(j.setup, null, "general", rv); if (!gen()) return true;
      if (await waitForAnswer(core.REPLY_MS)) return true;           // they guessed: the server has the reaction
      if (!gen()) return true;
      core.post("/intents/clear", { surface: "tv", what: ["jokeQA"] }).catch(() => {});
      core.push("ai", j.punchline); await core.speak(j.punchline, null, "general", rv);
      if (core.prefs.mode === "chime") core.playSound("done");
      core.backToIdle();
      return true;
    }
    if (j.type === "knock" && (j.stage === 1 || j.stage === 2)) {
      await core.speak(r.reply, null, "general", rv); if (!gen()) return true;
      if (await waitForAnswer(core.REPLY_MS)) return true;
      if (!gen()) return true;
      core.post("/intents/clear", { surface: "tv", what: ["knock"] }).catch(() => {});
      const rest = j.stage === 1 ? [`Who's there? ${j.setup}.`, `${j.setup} who?`, j.punchline] : [`${j.setup} who?`, j.punchline];
      for (const line of rest) { if (!gen()) return true; core.push("ai", line); await core.speak(line, null, "general", rv); await core.sleep(500); }
      core.backToIdle();
      return true;
    }
    return false;
  }

  // box breathing: each step said, then counted on screen (✋ Stop ends it)
  async function breathe(r, gen, rv) {
    const g0 = core.speechGen;
    await core.speak(r.reply, null, "general", { ...rv, tone: "soothing" });
    countEl.hidden = false;
    try {
      for (let round = 0; round < (r.breathing.rounds ?? 4); round++) for (const [label, secs] of r.breathing.steps) {
        if (!gen() || core.speechGen !== g0) return;
        countNum.textContent = label;
        core.speak(label, null, "general", { speed: 0.85, tone: "soothing" });
        for (let k = secs; k > 0; k--) { if (!gen() || core.speechGen !== g0) return; countNum.textContent = `${label} · ${k}`; await core.sleep(1000); }
      }
      if (gen()) await core.speak("Nice work. Notice how you feel.", null, "general", { tone: "soothing" });
    } finally { countEl.hidden = true; }
  }
  // web results ("Want me to search the web?" → yes): a short list with links
  let webEl = null;
  function showWeb(w) {
    webEl?.remove();
    webEl = el("section"); webEl.id = "dsxRecipes"; webEl.setAttribute("aria-label", "Web results");
    const head = el("div"); head.append(btn("✕ Close", () => { webEl?.remove(); webEl = null; }, "dsx-close"), el("h2", "", `Results for “${w.query}”`));
    const ol = el("ol", "dsx-steps");
    for (const x of w.results ?? []) {
      const li = el("li"); const a = el("a", "dsx-link", x.title); if (/^https?:\/\//.test(x.url)) { a.href = x.url; a.target = "_blank"; a.rel = "noopener noreferrer"; }
      li.append(a, el("div", "dsx-uses", [x.site, x.snippet].filter(Boolean).join(" — "))); ol.appendChild(li);
    }
    webEl.append(head, ol); document.body.appendChild(webEl);
  }

  // ---------------------------------------------------------------- joke offers (Funny personality)
  async function jokeOffer(item) {
    const busy = core.micMuted || core.textOnly || core.listenState !== "active" || core.speaking || core.mode !== "idle" || ringCard || cookEl || counting || document.querySelector("#alarm:not([hidden])") || core.prefs.mode !== "voice" || !core.isSpeaker;
    if (busy) { core.post("/intents/clear", { surface: "tv", what: ["jokeOffer"] }).catch(() => {}); return; }
    core.push("ai", item.text);
    await core.speak(item.text, null, "notify");
    core.openCommandWindow(core.REPLY_MS);
  }

  // ---------------------------------------------------------------- what tv.js calls
  window.dsExtras = {
    asking(text, { internal }) { if (!internal || !/^(\d|none)/.test(text)) hideSuggest(); },
    stop() { hideSuggest(); countEl.hidden = true; },
    before(r, { typed }) {
      hideSuggest();
      if (r.suggest) showSuggest(r.suggest, { typed });
      if (r.timers) setTimers(r.timers);
      if (r.dismissTimers) hideRing();
      if (r.cooking !== undefined) { closeGrid(); showCooking(r.cooking); }
      if (r.recipes) showResults(r.recipes);
      if (r.recipeView) showRecipe(r.recipeView);
      if (r.openPage) core.openPage(r.openPage);
      if (r.webResults) showWeb(r.webResults);
      if (r.show === "personality") core.openPage("/setup?embed=1&s=personality");
      if (r.show === "badges") core.openPage("/progress?embed=1#badges");   // XP: "open my badge gallery"
      if (typeof r.show === "string" && r.show.startsWith("toast:")) core.toast(r.show.slice(6), "", "", "bell");
      return null;
    },
    decorate(msgEl, r) {
      if (!msgEl) return;
      if (r.link?.url) {
        const b = el("button", "dsx-link", r.link.label && r.link.label !== "here" ? r.link.label : "How to add AI to Dayspring"); b.type = "button";
        b.onclick = () => core.openPage(r.link.url);
        msgEl.appendChild(document.createElement("br")); msgEl.appendChild(b);
        const cap = document.querySelector("#cap"); if (cap && !core.speaking) { const b2 = b.cloneNode(true); b2.onclick = b.onclick; cap.appendChild(document.createElement("br")); cap.appendChild(b2); }
      }
      if (r.offerSearch) { const b = el("button", "dsx-link", "Open a web search"); b.type = "button"; b.onclick = () => core.ask(`search the web for ${r.offerSearch} recipe`, { typed: true, internal: true }); msgEl.appendChild(document.createElement("br")); msgEl.appendChild(b); }
    },
    chipFor(r) { return r.cooking ? { title: r.cooking.title, category: "meal" } : r.timers && /timer/i.test(r.intent ?? "") ? { title: "⏲ Timer", category: "flex" } : null; },
    async deliver(r, { silent, gen, rv }) {
      if (silent) return false;
      if (r.count?.numbers?.length) { await count(r.count.numbers, gen); if (gen()) core.backToIdle(); return true; }
      if (r.breathing) { await breathe(r, gen, rv); if (gen()) core.backToIdle(); return true; }
      if (r.joke && !r.joke.straight && await deliverJoke(r, { gen, rv })) return true;
      return false;
    },
    async announce(item) {
      if (item.kind === "timer") { await timerDone(item); return true; }
      if (item.kind === "jokeoffer") { await jokeOffer(item); return true; }
      if (counting && !item.alarm && item.kind !== "morning") await counting;   // notifications wait for the counting to finish
      return false;
    },
    // tests
    _state: () => ({ suggest: Boolean(sugEl), options: sugEl ? [...sugEl.querySelectorAll("button[data-n]")].map((b) => b.textContent) : [], timers: snap.timers.length, ringing: Boolean(ringCard), ringText: ringCard?.textContent ?? "", cooking: Boolean(cookEl), cookText: cookEl?.textContent ?? "", recipeCards: gridEl ? gridEl.querySelectorAll(".dsx-rc").length : 0, recipeView: Boolean(viewEl), counting: Boolean(counting), countShown: !countEl.hidden }),
    _show: { suggest: showSuggest, results: showResults, recipe: showRecipe, cooking: showCooking, ring: showRing, timers: setTimers },
  };
})();
