// The colour theme on every Dayspring page (the screen, Dayspring mini, Settings, the guide, the GIF, mail and video
// windows, the Schedule app…). The engine is public/theme-core.js; the choice is kept by the server (Settings → Look &
// feel, or "switch to the pink theme"): GET /api/looks/theme.
//
// The default theme touches nothing at all: the page looks exactly as it always has. Any other theme passes every colour
// in the page's stylesheets through the theme's mapper (luminance-preserving, so text stays as readable as the default),
// remembers the originals (so switching back restores them exactly), and does the same to stylesheets that arrive later.
// The living sky (sky.js), the orb (tv.js) and the avatars (avatar.js) read window.dsTheme and window.dsThemeMap.
//
//   window.dsThemeApply(theme | null, { preview })   apply a theme now (Settings' live preview); null = the default
//   window.dsTheme          { id, name, tokens, mode } or null for the default
//   window.dsThemeMap([r,g,b,a]) → [r,g,b,a]  ·  window.dsThemeHue(h) → h        (identity for the default)
//   event "ds-theme" on window after every change
(() => {
  "use strict";
  const C = window.DsThemeCore;
  if (!C) return;
  const doc = document.documentElement;
  const CACHE = "ds-theme-v1";
  let mapper = C.mapperFor(null), current = null, done = [], seen = new WeakSet(), observer = null, previewTimer = 0, saved = null;
  const featureOn = () => (window.dsFeatures?.on ? window.dsFeatures.on("themes") !== false : true);
  const COLOR_PROP = /color|background|border|shadow|outline|fill|stroke|caret|column-rule|text-decoration|filter|mask|^--/;
  const NAMED = /\b(white|black)\b/g;

  // ---- rewriting the stylesheets (and putting them back) ----
  function eachRule(list, fn) {
    for (const r of list) {
      if (r.style) fn(r.style);
      if (r.cssRules) { try { eachRule(r.cssRules, fn); } catch { /* not readable */ } }
    }
  }
  function mapStyle(st) {
    for (let i = 0; i < st.length; i++) {
      const prop = st[i];
      if (!COLOR_PROP.test(prop)) continue;
      const v = st.getPropertyValue(prop);
      if (!v || !/#|rgb|white|black/i.test(v)) continue;
      let nv = mapper.css(v);
      if (/\b(white|black)\b/.test(nv) && !/^--/.test(prop) && !/url\(/.test(nv)) nv = nv.replace(NAMED, (w) => C.toCss(mapper.rgb(w === "white" ? [255, 255, 255, 1] : [0, 0, 0, 1])));
      if (nv !== v) { const pr = st.getPropertyPriority(prop); done.push([st, prop, v, pr]); st.setProperty(prop, nv, pr); }
    }
    // a shorthand written with var() (background: rgba(11,16,36,calc(var(--scrim) * .96))) keeps its text only on the
    // shorthand itself; its longhands read as empty
    for (const sh of SHORTHANDS) {
      const v = st.getPropertyValue(sh);
      if (!v || !/var\(/.test(v) || !/#|rgb/i.test(v)) continue;
      const nv = mapper.css(v);
      if (nv !== v) { const pr = st.getPropertyPriority(sh); done.push([st, sh, v, pr]); st.setProperty(sh, nv, pr); }
    }
  }
  const SHORTHANDS = ["background", "border", "border-top", "border-right", "border-bottom", "border-left", "border-color", "outline", "text-decoration", "column-rule", "mask"];
  function mapSheet(sheet) {
    if (!sheet || seen.has(sheet) || sheet.ownerNode?.dataset?.dsThemeSkip != null) return;
    let rules; try { rules = sheet.cssRules; } catch { return; }      // another site's stylesheet (fonts): nothing to do
    seen.add(sheet);
    eachRule(rules, mapStyle);
  }
  function mapAll() { for (const s of document.styleSheets) mapSheet(s); }
  function revert() {
    for (let i = done.length - 1; i >= 0; i--) { const [st, prop, v, pr] = done[i]; try { st.setProperty(prop, v, pr); } catch { /* gone */ } }
    done = []; seen = new WeakSet();
  }
  // stylesheets added later (the page's own scripts add some as they start)
  function watch() {
    if (observer) return;
    observer = new MutationObserver((muts) => {
      if (mapper.identity) return;
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeName === "STYLE") mapSheet(n.sheet);
        else if (n.nodeName === "LINK" && /stylesheet/i.test(n.rel)) { if (n.sheet) mapSheet(n.sheet); n.addEventListener("load", () => mapSheet(n.sheet), { once: true }); }
      }
    });
    observer.observe(doc, { childList: true, subtree: true });
  }

  // ---- applying a theme ----
  function apply(theme, { preview = false, silent = false } = {}) {
    const t = theme && theme.id !== "default" && featureOn() ? theme : null;
    const key = t ? JSON.stringify([t.id, t.params]) : "default";
    if (key === (current ? JSON.stringify([current.id, current.params]) : "default") && !preview) return;
    revert();
    mapper = C.mapperFor(t);
    current = t;
    if (t) {
      doc.dataset.dsTheme = t.id;
      doc.dataset.dsThemeMode = mapper.mode;
      doc.style.colorScheme = mapper.mode === "light" ? "light" : "dark";
      mapAll(); watch();
      const tokens = C.tokensFor(t);
      window.dsTheme = { id: t.id, name: t.name, params: t.params, tokens, mode: mapper.mode };
      window.dsThemeMap = (c) => mapper.rgb(c.length === 3 ? [...c, 1] : c).slice(0, c.length);
      window.dsThemeHue = mapper.hue;
    } else {
      delete doc.dataset.dsTheme; delete doc.dataset.dsThemeMode; doc.style.removeProperty("color-scheme");
      window.dsTheme = null; window.dsThemeMap = null; window.dsThemeHue = null;
    }
    if (!preview) { try { localStorage.setItem(CACHE, JSON.stringify(t ? { id: t.id, name: t.name, params: t.params } : { id: "default" })); } catch { /* private mode */ } }
    if (!silent) window.dispatchEvent(new CustomEvent("ds-theme", { detail: window.dsTheme }));
  }
  const fromWire = (x) => (!x || x.id === "default" ? null : x.params ? x : C.byId(x.id));
  window.dsThemeApply = (theme, opts = {}) => {
    const t = typeof theme === "string" ? C.byId(theme) : theme;
    if (opts.preview) {
      if (!saved) saved = current ?? { id: "default" };
      apply(fromWire(t), { preview: true });
      clearTimeout(previewTimer);
      if (opts.ms) previewTimer = setTimeout(() => { const s = saved; saved = null; apply(fromWire(s)); }, opts.ms);
      return;
    }
    saved = null; clearTimeout(previewTimer);
    apply(fromWire(t));
  };
  window.dsThemeRefresh = load;

  // ---- what the server says ----
  async function load() {
    try {
      const r = await fetch("/api/looks/theme", { cache: "no-store" });
      if (!r.ok) { if (r.status === 404) apply(null); return; }
      const j = await r.json();
      if (!saved) apply(fromWire(j.theme));
    } catch { /* the server is restarting: keep what's showing */ }
  }
  // instantly, the last theme this page used (no flash of the default), then the server's word
  try { const c = JSON.parse(localStorage.getItem(CACHE) || "null"); if (c && c.id !== "default") apply(fromWire(c), { silent: true }); } catch { /* none */ }
  load();
  const hook = (es) => {
    es.addEventListener("looks", (e) => {
      let d = {}; try { d = JSON.parse(e.data); } catch { /* fine */ }
      if (d.preview) window.dsThemeApply(d.preview.theme, { preview: true, ms: d.preview.ms || 20_000 });
      else load();
    });
  };
  if (window.dsEvents) hook(window.dsEvents); else addEventListener("ds-events", (e) => hook(e.detail), { once: true });
  // pages without the live connection (Settings, the guide) check again when they come back into view
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !window.dsEvents) load(); });
  // a stylesheet that was still loading (or still being parsed) when the theme was applied
  document.addEventListener("DOMContentLoaded", () => { if (!mapper.identity) mapAll(); });
  addEventListener("load", () => { if (!mapper.identity) mapAll(); });
})();
