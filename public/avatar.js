// Dayspring's avatar on the screen (and in Dayspring mini): the orb stays unless the owner picks another in Settings →
// Look & feel (or says "use the blob avatar"). Another style is drawn over the orb's place and the orb rests; the orb
// itself is never changed. Also: "your picture" (breathes while talking, grows a little while listening, one picture per
// state if uploaded, crossfading), and expression mode's GIFs (public/avatar-core.js draws the styles; lib/looks has
// the choices and the GIFs).
//
// What it follows: window.dsVoice from tv.js ({ mode, level }, every frame), the listening state (Active/Quiet/Off, stop
// listening, text only), the connection (error), and the voice's own waveform while it talks.
//   window.dsAvatar = { state(), style(), express(item), preview(style, ms), stats() }
(() => {
  "use strict";
  const C = window.DsAvatarCore;
  const presence = document.getElementById("presence"), viz = document.getElementById("viz");
  if (!C || !presence || !viz) return;
  const $ = (s, r = document) => r.querySelector(s);
  const featureOn = () => (window.dsFeatures?.on ? window.dsFeatures.on("avatar") !== false : true);

  const css = document.createElement("style");
  css.textContent = `
  #presence[data-avatar]:not([data-avatar="orb"]) #viz{visibility:hidden}
  #dsAvatar,#dsExpr{position:absolute;z-index:1;pointer-events:none;display:grid;place-items:center}
  #dsAvatar[hidden],#dsExpr[hidden]{display:none!important}
  #dsAvatar canvas{width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;aspect-ratio:auto!important;transform:none!important;filter:none!important}
  #dsAvatar .dsav-img{position:relative;width:78%;height:78%;transform-origin:50% 55%;will-change:transform}
  #dsAvatar .dsav-img img{position:absolute;inset:0;width:100%;height:100%;object-fit:var(--fit,cover);opacity:0;transition:opacity .45s ease;border-radius:var(--round,50%)}
  #dsAvatar .dsav-img img.on{opacity:1}
  #dsAvatar .dsav-img::after{content:"";position:absolute;inset:-4%;border-radius:var(--round,50%);pointer-events:none;
    box-shadow:0 0 calc(1em + var(--glow,0) * 2.5em) calc(var(--glow,0) * .4em) var(--avglow,rgba(124,140,255,.55));opacity:calc(.35 + var(--glow,0) * .65)}
  #dsAvatar .dsav-img.muted img{filter:grayscale(.55) brightness(.8)}
  #dsAvatar .dsav-img.sleep img{filter:brightness(.7) saturate(.7)}
  #dsExpr{z-index:2;opacity:0;transform:scale(.9);transition:opacity .35s ease,transform .45s cubic-bezier(.2,.9,.3,1.3)}
  #dsExpr.on{opacity:1;transform:none}
  #dsExpr .ex-media{max-width:100%;max-height:100%;border-radius:1.1em;box-shadow:0 10px 40px -12px rgba(0,0,0,.7),0 0 0 2px var(--exring,rgba(170,180,255,.35));background:rgba(0,0,0,.2);object-fit:contain}
  #dsExpr .ex-attr{position:absolute;left:50%;bottom:.2em;transform:translateX(-50%);max-width:92%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.62em;padding:.15em .6em;border-radius:1em;
    background:rgba(8,10,24,.78);color:#dfe3ff;opacity:0;transition:opacity .2s;pointer-events:auto}
  #dsExpr:hover .ex-attr,#dsExpr:focus-within .ex-attr{opacity:1}
  #dsExpr.on{pointer-events:auto}
  @media (prefers-reduced-motion: reduce){#dsExpr{transition:opacity .2s}}`;
  document.head.appendChild(css);

  const box = document.createElement("div"); box.id = "dsAvatar"; box.hidden = true; box.setAttribute("aria-hidden", "true");
  const ex = document.createElement("div"); ex.id = "dsExpr"; ex.hidden = true; ex.setAttribute("role", "img");
  presence.append(box, ex);
  // over the orb's own box, whatever the layout does with it
  function place() {
    const pr = presence.getBoundingClientRect(), r = viz.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const s = Math.min(r.width, r.height), left = r.left - pr.left + (r.width - s) / 2, top = r.top - pr.top + (r.height - s) / 2;
    for (const el of [box, ex]) Object.assign(el.style, { left: left + "px", top: top + "px", width: s + "px", height: s + "px" });
  }
  new ResizeObserver(place).observe(viz); new ResizeObserver(place).observe(presence); addEventListener("resize", place); place();
  setInterval(() => { if (!box.hidden || !ex.hidden) place(); }, 1000);   // (the layout can move it without resizing it)

  // ---------------------------------------------------------------- the state it shows
  let testUntil = 0, testState = "speak", previewStyle = null, previewUntil = 0;
  // (tests: window.__dsAvatarState / __dsAvatarLevel pin the state and the voice level)
  function state() {
    if (window.__dsAvatarState) return window.__dsAvatarState;
    if (Date.now() < testUntil) return testState;
    const v = window.dsVoice ?? {}, core = window.dsCore;
    if (v.mode === "speak") return "speak";
    if (v.mode === "think") return "think";
    if (v.mode === "listen") return "listen";
    if (document.body.classList.contains("offline")) return "error";
    if (core?.listenState === "off" || core?.textOnly) return "muted";
    if (core?.micMuted) return "stopped";
    if (core?.listenState === "quiet" || (document.body.classList.contains("night") && document.body.classList.contains("dim"))) return "sleep";
    return "idle";
  }
  function level() {
    if (typeof window.__dsAvatarLevel === "number") return window.__dsAvatarLevel;
    if (Date.now() < testUntil) return testState === "speak" ? C.fakeVoice(performance.now()) : testState === "listen" ? 0.3 + 0.2 * Math.sin(performance.now() / 300) : 0;
    const v = window.dsVoice ?? {};
    return Math.max(0, Math.min(1, v.level ?? 0));
  }
  const signal = () => { const st = state(); return { state: st, level: level(), wave: st === "speak" && window.dsVoice?.live ? window.dsVoiceWave : null, freq: st === "speak" ? window.dsVoiceFreq : null }; };

  // ---------------------------------------------------------------- the style in use
  let look = { style: "orb", images: {}, fit: "cover", round: true }, inst = null, img = null, expression = { on: false };
  function current() { return previewStyle && Date.now() < previewUntil ? previewStyle : look.style; }
  function apply() {
    const st = featureOn() ? current() : "orb";
    presence.dataset.avatar = st;
    window.dsAvatarActive = st !== "orb";
    box.hidden = st === "orb";
    if (st === "image") { if (inst) { inst.destroy(); inst = null; } buildImage(); }
    else { if (img) { img.el.remove(); img = null; } if (st !== "orb") { if (!inst) inst = C.mount(box, { style: st, signal }); else inst.setStyle(st); } else if (inst) { inst.destroy(); inst = null; } }
    place();
  }
  // your picture: two layers for crossfading, the scale follows the voice
  function buildImage() {
    if (img) { img.refresh(); return; }
    const el = document.createElement("div"); el.className = "dsav-img";
    const a = new Image(), b = new Image(); a.alt = b.alt = ""; a.decoding = b.decoding = "async";
    el.append(a, b); box.append(el);
    let front = a, back = b, shown = "", raf = 0, s = 1, lv = 0;
    const urlFor = (st) => look.images[st] ?? look.images.idle ?? Object.values(look.images)[0] ?? null;
    function show(url) {
      if (!url || url === shown) return;
      shown = url;
      back.onload = () => { back.classList.add("on"); front.classList.remove("on"); [front, back] = [back, front]; };
      back.onerror = () => {};
      back.src = url;
    }
    function tick(t) {
      raf = 0; if (!img) return;
      const st = state(), L = level();
      lv += (L - lv) * 0.3;
      show(urlFor(st));
      // talking: it gently breathes bigger and smaller with the voice · listening: a little bigger · idle: a slow breath
      const target = st === "speak" ? 1.02 + lv * 0.11 : st === "listen" ? 1.07 + lv * 0.02 : st === "think" ? 1.01 + 0.012 * Math.sin(t / 380) : st === "sleep" ? 0.96 : st === "muted" || st === "stopped" ? 0.97 : 1 + 0.01 * Math.sin(t / 1500);
      s += (target - s) * (st === "speak" ? 0.45 : 0.12);
      el.style.transform = `scale(${s.toFixed(4)})`;
      el.style.setProperty("--glow", (st === "speak" ? lv : st === "listen" ? 0.45 : 0.1).toFixed(3));
      el.className = "dsav-img" + (st === "muted" && !look.images.muted ? " muted" : st === "sleep" && !look.images.sleep ? " sleep" : "");
      raf = requestAnimationFrame(tick);
    }
    const refresh = () => {
      el.style.setProperty("--fit", look.fit === "contain" ? "contain" : "cover");
      el.style.setProperty("--round", look.round === false ? "1.2em" : "50%");
      const ac = window.dsTheme?.tokens?.accent; el.style.setProperty("--avglow", ac ? ac : "rgba(124,140,255,.55)");
      shown = "";
    };
    img = { el, refresh }; refresh();
    raf = requestAnimationFrame(tick);
  }

  async function load() {
    try {
      const r = await fetch("/api/looks/avatar", { cache: "no-store" });
      if (!r.ok) { look = { style: "orb", images: {} }; expression = { on: false }; apply(); return; }
      const j = await r.json();
      look = j.avatar ?? look; expression = j.expression ?? { on: false };
      if (look.style === "image" && !Object.keys(look.images ?? {}).length) look.style = "orb";
      apply();
      if (img) img.refresh();
    } catch { /* restarting: keep what's showing */ }
  }
  addEventListener("ds-theme", () => { if (img) img.refresh(); });

  // ---------------------------------------------------------------- expression mode: a GIF or meme in the avatar's place
  let exTimer = 0, exBusy = false, lastAsk = 0;
  function hideExpr() {
    clearTimeout(exTimer);
    ex.classList.remove("on");
    setTimeout(() => { if (!ex.classList.contains("on")) { ex.hidden = true; ex.textContent = ""; } }, 400);
  }
  function express(item) {
    if (!item?.url) return;
    clearTimeout(exTimer);
    ex.textContent = "";
    const media = item.type === "video/mp4" ? Object.assign(document.createElement("video"), { muted: true, loop: true, autoplay: true, playsInline: true }) : new Image();
    media.className = "ex-media"; media.src = item.url;
    if (media.tagName === "IMG") media.alt = item.title || "";
    const attr = document.createElement(item.page ? "a" : "span");
    attr.className = "ex-attr";
    attr.textContent = [item.title, item.attribution?.text ?? (item.own ? "Your picture" : "")].filter(Boolean).join(" · ");
    if (item.page) { attr.href = item.page; attr.target = "_blank"; attr.rel = "noopener noreferrer"; }
    ex.title = attr.textContent;
    ex.setAttribute("aria-label", `Dayspring feels ${item.emotionLabel ?? item.emotion ?? ""}: ${item.title ?? ""}`.trim());
    ex.append(media, attr);
    const ring = window.dsTheme?.tokens?.edge2; if (ring) ex.style.setProperty("--exring", ring);
    ex.hidden = false; place();
    const start = () => { requestAnimationFrame(() => ex.classList.add("on")); exTimer = setTimeout(hideExpr, Math.max(1500, Math.min(15_000, item.plan?.ms ?? 4000))); };
    if (media.tagName === "VIDEO") { media.play?.().catch(() => {}); start(); } else if (media.complete) start(); else { media.onload = start; media.onerror = hideExpr; }
  }
  async function ask(params) {
    if (!featureOn() || exBusy) return;
    if (!expression.on && !params.force) return;
    exBusy = true;
    try {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)]));
      const r = await fetch("/api/expressions/pick?" + qs, { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      if (j.show && j.item) express({ ...j.item, emotion: j.emotion });
    } catch { /* no GIF this time */ } finally { exBusy = false; }
  }
  // when Dayspring starts saying something (tv.js "ds-stage"), and on events: a badge, a level, an alarm
  addEventListener("ds-stage", (e) => {
    const d = e.detail ?? {};
    if (d.mode !== "speak" || !d.text || Date.now() - lastAsk < 800) return;
    lastAsk = Date.now();
    ask({ text: String(d.text).slice(0, 500), speechMs: Math.round(Math.min(20_000, 900 + String(d.text).length * 62)) });
  });
  const hook = (es) => {
    es.addEventListener("looks", (e) => { let d = {}; try { d = JSON.parse(e.data); } catch { /* fine */ } if (!d.preview) load(); });
    es.addEventListener("persona", () => load());
    es.addEventListener("looks-test", (e) => {
      let d = {}; try { d = JSON.parse(e.data); } catch { /* fine */ }
      testState = d.state || "speak"; testUntil = Date.now() + (d.ms || 4000);
      if (d.style) { previewStyle = d.style; previewUntil = testUntil; apply(); setTimeout(apply, (d.ms || 4000) + 50); }
      if (d.emotion) ask({ emotion: d.emotion, force: 1, speechMs: d.ms || 4000 });
    });
    es.addEventListener("xp", (e) => { let d = {}; try { d = JSON.parse(e.data); } catch { return; } const ev = d.kind === "badge" || d.kind === "levelup" ? d.kind : d.kind === "award" ? "award" : null; if (ev) ask({ event: ev }); });
    es.addEventListener("announce", (e) => { let d = {}; try { d = JSON.parse(e.data); } catch { return; } if (d.kind === "alarm" || d.alarm) ask({ event: "alarm" }); });
  };
  if (window.dsEvents) hook(window.dsEvents); else addEventListener("ds-events", (e) => hook(e.detail), { once: true });
  // the connection coming back after an error: a small "oops, I'm back"
  new MutationObserver(() => { const off = document.body.classList.contains("offline"); if (!off && hook.wasOff) ask({ event: "error" }); hook.wasOff = off; }).observe(document.body, { attributes: true, attributeFilter: ["class"] });

  window.dsAvatar = {
    state, style: current, express, hideExpr,
    preview(style, ms = 8000) { previewStyle = style; previewUntil = Date.now() + ms; apply(); setTimeout(apply, ms + 50); },
    test(st = "speak", ms = 4000) { testState = st; testUntil = Date.now() + ms; },
    reload: load,
    stats: () => ({ style: current(), active: Boolean(window.dsAvatarActive), state: state(), canvas: inst?.stats() ?? null, image: Boolean(img), expression: { ...expression, showing: !ex.hidden } }),
  };
  load();
})();
