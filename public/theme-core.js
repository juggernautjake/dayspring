// Dayspring colour themes: the shared engine (the pages load it as a plain script; the server and the tests import it
// for its side effect and read globalThis.DsThemeCore). No imports, no exports, so it runs the same in both.
//
// How a theme works. Dayspring's look is built from one family of colours: dawn indigo and violet (#7c8cff, #a78bfa,
// #6ea8fe…), deep navy glass and surfaces, and pale lavender-white text. A theme is a small set of numbers that says
// where that family goes: the accent hue, the secondary hue, the surface hue, how colourful each is, and whether the
// page is dark, light (day) or high contrast. Every colour in every stylesheet is passed through the theme's mapper:
//   - indigo/blue colours move to the accent hue, violet/magenta ones to the secondary hue, deep navy to the surface
//     hue, pale lavender to a pale tint of the accent; greys and other colours (the gold, mint and rose of the
//     calendar categories) stay as they are;
//   - the brightness is LUMINANCE-PRESERVING: each new colour has the same WCAG relative luminance as the colour it
//     replaces, so every text/background pair keeps the exact contrast it had in the default look (which passes AA);
//   - the day theme inverts luminance with Y' = 0.0525 / (Y + 0.05) − 0.05, which maps black to white and white to
//     black and keeps every contrast ratio exactly the same (the pair just swaps sides);
//   - high contrast pushes dark colours darker and light ones lighter, and makes glass solid.
// So the default theme is untouched (the mapper isn't even run), and every other theme is as readable as the default by
// construction. tokensFor() gives a theme's named colours (for Settings' swatches, the sky and the tests), and
// contrastReport() measures them.
//
//   DsThemeCore.THEMES · byId(id) · mapperFor(themeOrParams) → { rgb([r,g,b,a]) → [r,g,b,a], css(text) → text, hue(h) }
//   tokensFor(theme) · contrastReport(tokens) · buildCustom({ colors: ["#hex", "#hex", "#hex?"], mode }) · surprise(curId)
//   parse(cssColour) · toCss([r,g,b,a]) · lum([r,g,b]) · contrast(a, b) · over(fg, bg)
(function (root) {
  "use strict";
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const round = (x) => Math.round(x);

  // ---------------------------------------------------------------------------------------------------- colour maths
  function parse(s) {
    s = String(s ?? "").trim().toLowerCase();
    let m;
    if ((m = /^#([0-9a-f]{3,8})$/.exec(s))) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
      if (h.length !== 6 && h.length !== 8) return null;
      const n = (i) => parseInt(h.slice(i, i + 2), 16);
      return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
    }
    if ((m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s))) {
      let a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      return [+m[1], +m[2], +m[3], clamp01(a)];
    }
    return null;
  }
  const hex2 = (v) => round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  function toCss(c) {
    const a = c[3] ?? 1;
    if (a >= 0.999) return "#" + hex2(c[0]) + hex2(c[1]) + hex2(c[2]);
    return `rgba(${round(c[0])},${round(c[1])},${round(c[2])},${+a.toFixed(3)})`;
  }
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  function contrast(a, b) {
    const A = typeof a === "string" ? parse(a) : a, B = typeof b === "string" ? parse(b) : b;
    const x = lum(A), y = lum(B);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  // a translucent colour over an opaque one
  function over(fg, bg) {
    const F = typeof fg === "string" ? parse(fg) : fg, B = typeof bg === "string" ? parse(bg) : bg, a = F[3] ?? 1;
    return [F[0] * a + B[0] * (1 - a), F[1] * a + B[1] * (1 - a), F[2] * a + B[2] * (1 - a), 1];
  }
  function rgb2hsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, clamp01(s), l];
  }
  function hsl2rgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, hp = ((h % 360) + 360) % 360 / 60, x = c * (1 - Math.abs((hp % 2) - 1));
    const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
    const m = l - c / 2;
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  // the colour with hue h and saturation s whose relative luminance is Y (luminance rises with lightness)
  function withLum(h, s, Y) {
    Y = clamp01(Y);
    let lo = 0, hi = 1;
    for (let i = 0; i < 26; i++) { const mid = (lo + hi) / 2; if (lum(hsl2rgb(h, s, mid)) < Y) lo = mid; else hi = mid; }
    return hsl2rgb(h, s, (lo + hi) / 2);
  }
  const hueDist = (a, b) => { const d = Math.abs(((a - b) % 360 + 360) % 360); return Math.min(d, 360 - d); };
  const invY = (Y) => clamp01(0.0525 / (Y + 0.05) - 0.05);   // keeps every contrast ratio, swaps dark and light

  // ---------------------------------------------------------------------------------------------------- the themes
  // aH/aS: the accent hue and how colourful (× the original), bH/bS: the secondary, sH/sS: the deep surfaces,
  // inkS: how tinted the pale text is, lift: the accents' brightness (× luminance), mode: dark | light | contrast,
  // sky: the colour the living sky and scenery lean toward, skyMix: how far (at night; less by day).
  const T = (id, name, blurb, params, swatch) => ({ id, name, blurb, params, swatch });
  const THEMES = [
    T("default", "Default", "Dayspring's dawn: night indigo and violet.", null, ["#060812", "#7c8cff", "#a78bfa", "#eef0ff"]),
    T("rose", "Rose", "Deep berry glass with rose-pink light.", { aH: 338, aS: 1, bH: 312, bS: 0.9, sH: 330, sS: 0.7, inkS: 0.55, lift: 1.12, sky: "#4a1636", skyMix: 0.3 }),
    T("sage", "Sage", "Soft garden greens, calm and earthy.", { aH: 138, aS: 0.52, bH: 86, bS: 0.55, sH: 150, sS: 0.42, inkS: 0.4, lift: 1.12, sky: "#17362a", skyMix: 0.28 }),
    T("forest", "Forest", "Deep pine green with fresh leaf accents.", { aH: 128, aS: 0.85, bH: 160, bS: 0.7, sH: 140, sS: 0.6, inkS: 0.4, lift: 1.1, sky: "#0e2a1a", skyMix: 0.34 }),
    T("ocean", "Ocean", "Sea blues and aqua, like a clear harbour.", { aH: 197, aS: 1, bH: 172, bS: 0.9, sH: 208, sS: 0.9, inkS: 0.5, lift: 1.1, sky: "#0b3050", skyMix: 0.26 }),
    T("sunset", "Sunset Coral", "Warm coral and amber over dusky plum.", { aH: 12, aS: 1, bH: 36, bS: 1, sH: 345, sS: 0.6, inkS: 0.45, lift: 1.14, sky: "#4a1a2a", skyMix: 0.3 }),
    T("lavender", "Lavender", "Gentle lilac and orchid, soft and dreamy.", { aH: 268, aS: 0.62, bH: 292, bS: 0.58, sH: 262, sS: 0.5, inkS: 0.5, lift: 1.14, sky: "#2c2350", skyMix: 0.22 }),
    T("mint", "Mint", "Cool mint and seafoam, crisp and fresh.", { aH: 158, aS: 0.8, bH: 184, bS: 0.7, sH: 176, sS: 0.55, inkS: 0.45, lift: 1.25, sky: "#0f3a36", skyMix: 0.26 }),
    T("harvest", "Harvest Gold", "Golden wheat and pumpkin on warm walnut.", { aH: 43, aS: 1, bH: 24, bS: 1, sH: 28, sS: 0.45, inkS: 0.45, lift: 1.3, sky: "#3a2410", skyMix: 0.3 }),
    T("crimson", "Crimson", "Rich crimson and ember red, bold and warm.", { aH: 352, aS: 1, bH: 12, bS: 0.9, sH: 350, sS: 0.6, inkS: 0.4, lift: 1.08, sky: "#3a0c16", skyMix: 0.3 }),
    T("slate", "Slate", "Quiet graphite greys with a steel-blue touch.", { aH: 214, aS: 0.3, bH: 200, bS: 0.22, sH: 220, sS: 0.15, inkS: 0.12, lift: 1.1, sky: "#1d2430", skyMix: 0.36 }),
    T("blossom", "Cherry Blossom", "Pale blossom pink with spring-leaf green.", { aH: 336, aS: 0.72, bH: 104, bS: 0.45, sH: 318, sS: 0.34, inkS: 0.5, lift: 1.3, sky: "#3a2034", skyMix: 0.26 }),
    T("emerald", "Emerald Night", "Jewel emerald over a deep teal night.", { aH: 150, aS: 1, bH: 170, bS: 0.9, sH: 194, sS: 0.8, inkS: 0.4, lift: 1.12, sky: "#062a2a", skyMix: 0.32 }),
    T("candy", "Candy", "Bubblegum pink and bright teal on grape.", { aH: 322, aS: 1, bH: 176, bS: 1, sH: 282, sS: 0.6, inkS: 0.5, lift: 1.15, sky: "#2e1440", skyMix: 0.28 }),
    T("contrast", "High Contrast", "The strongest contrast, with bright yellow highlights: easiest to read.", { mode: "contrast", aH: 54, aS: 1, bH: 186, bS: 1, sH: 230, sS: 0, inkS: 0, lift: 1, sky: "#000000", skyMix: 0.6 }),
    T("day", "Light (Day)", "A bright daytime page with dark text.", { mode: "light", aH: 232, aS: 0.72, bH: 262, bS: 0.7, sH: 225, sS: 0.6, inkS: 1, lift: 1, sky: "#d4e0f7", skyMix: 0.7 }),
  ];
  const byId = (id) => THEMES.find((t) => t.id === id) ?? null;
  // what the theme's name can be said as ("the pink theme", "green", "dark mode off")
  const WORDS = {
    default: ["default", "normal", "original", "standard", "usual", "regular", "dayspring", "indigo", "purple and blue", "dawn"],
    rose: ["rose", "pink", "berry", "rosy"], sage: ["sage", "green", "garden", "olive"], forest: ["forest", "pine", "dark green", "evergreen"],
    ocean: ["ocean", "sea", "blue", "aqua", "teal", "harbour", "harbor"], sunset: ["sunset", "coral", "orange", "peach"],
    lavender: ["lavender", "lilac", "violet", "orchid", "purple"], mint: ["mint", "seafoam", "minty", "light green"],
    harvest: ["harvest", "gold", "golden", "yellow", "wheat", "autumn", "amber"], crimson: ["crimson", "red", "ruby", "ember"],
    slate: ["slate", "graphite", "grey", "gray", "charcoal", "steel"], blossom: ["cherry blossom", "blossom", "sakura", "cherry", "pastel pink"],
    emerald: ["emerald", "emerald night", "jade"], candy: ["candy", "bubblegum", "pink and teal", "cotton candy"],
    contrast: ["high contrast", "contrast", "easy to read", "accessible"], day: ["light", "day", "daytime", "bright", "white", "light mode"],
  };

  // ---------------------------------------------------------------------------------------------------- the mapper
  function mapperFor(theme) {
    const P = theme?.params ?? theme ?? null;
    if (!P || !("aH" in P)) return { identity: true, rgb: (c) => c, css: (s) => s, hue: (h) => h };
    const mode = P.mode ?? "dark", lift = P.lift ?? 1, inkS = P.inkS ?? 0.5;
    const cache = new Map();
    function rgb(c) {
      const key = c.join(",");
      if (cache.has(key)) return cache.get(key);
      const a = c[3] ?? 1, Y = lum(c), [h, s, l] = rgb2hsl(c);
      let H = h, S = s, tY = Y, A = a;
      const brand = s >= 0.12 && h >= 195 && h <= 300;
      if (brand) {
        if (l < 0.26) { H = P.sH; S = s * P.sS; }                                                   // deep navy: the surfaces
        else if (l > 0.8) { H = P.aH; S = s * inkS; }                                               // pale lavender: the text
        else if (s < 0.35) { H = P.sH; S = s * Math.max(P.sS, 0.35); }                              // greyish blue: muted text
        else if (h < 245) { H = P.aH + (h - 232) * 0.35; S = s * P.aS; tY = Y * lift; }             // indigo / blue: the accent
        else { H = P.bH + (h - 262) * 0.35; S = s * P.bS; tY = Y * lift; }                          // violet / magenta: the secondary
      }
      if (mode === "light") {
        // shadows stay shadows; everything else swaps dark for light, keeping every contrast ratio
        if (!(a < 1 && Y < 0.012 && Math.max(c[0], c[1], c[2]) < 14)) tY = invY(tY);
      } else if (mode === "contrast") {
        // dark glass turns solid (text on it never depends on the sky); light colours get lighter, dark ones darker
        if (tY < 0.05) { tY = tY * 0.25; if (a < 1 && a > 0.2) A = Math.max(a, 0.92); }
        else tY = 1 - (1 - tY) * 0.55;
        if (!brand && s >= 0.12 && tY > 0.4) S = Math.min(1, s * 1.1);
      }
      const out = [...withLum(H, clamp01(S), clamp01(tY)), A];
      cache.set(key, out);
      return out;
    }
    // #hex, rgb()/rgba() with numbers, and rgba() whose alpha is an expression (calc(var(--scrim) * .96)): the colour is
    // mapped and the expression kept
    const RE = /#[0-9a-f]{3,8}\b|rgba?\(\s*[\d.]+\s*[,\s]\s*[\d.]+\s*[,\s]\s*[\d.]+\s*(?:[,/]\s*(?:[^()]|\((?:[^()]|\([^()]*\))*\))*)?\)/gi;
    const css = (text) => String(text).replace(RE, (m) => {
      const c = parse(m);
      if (c) return toCss(rgb(c));
      const x = /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,/]\s*([\s\S]+)\)$/i.exec(m);
      if (!x) return m;
      const o = rgb([+x[1], +x[2], +x[3], 0.5]);            // (an unknown alpha counts as see-through)
      return `rgba(${round(o[0])},${round(o[1])},${round(o[2])},${x[4].trim()})`;
    });
    // the orb's hues (it draws with hsl): indigo/violet go where the accents went; its other moods lean most of the way
    // toward the theme's own colours, so a green theme never has a magenta orb, but the moods still show
    const near = (h) => (hueDist(h, P.aH) <= hueDist(h, P.bH) ? P.aH : P.bH);
    const lerpH = (a, b, k) => { const d = ((b - a + 540) % 360) - 180; return (a + d * k + 360) % 360; };
    const hue = (h) => { h = ((h % 360) + 360) % 360; if (h >= 195 && h <= 300) return h < 245 ? P.aH + (h - 232) * 0.35 : P.bH + (h - 262) * 0.35; const t = near(h); return hueDist(h, t) > 90 ? t : lerpH(h, t, 0.65); };
    return { identity: false, rgb, css, hue, mode, params: P };
  }

  // ---------------------------------------------------------------------------------------------------- tokens
  // the default look's named colours (tv.html, setup.html, help.html and ecosystem-core tokens.css)
  const DEFAULT_TOKENS = {
    bg: "#060812", bg2: "#0b1026", surface: "#121634", surface2: "#1a1f45",
    glass: "rgba(20,24,50,0.42)", glassStrong: "rgba(16,20,44,0.92)", panel: "rgba(22,26,56,0.72)",
    edge: "rgba(165,175,255,0.14)", edge2: "rgba(170,180,255,0.28)", cardBorder: "rgba(160,170,255,0.13)",
    ink: "#eef0ff", muted: "#a4abcc", dim: "#8d94b8",
    accent: "#7c8cff", secondary: "#a78bfa", tertiary: "#6ea8fe", accentInk: "#0a0d24",
    link: "#9db8ff", focus: "#67e8f9",
  };
  function tokensFor(theme) {
    const m = mapperFor(theme), out = {};
    for (const [k, v] of Object.entries(DEFAULT_TOKENS)) out[k] = toCss(m.rgb(parse(v)));
    const P = theme?.params ?? null;
    out.sky = P?.sky ?? "#0b1026"; out.skyMix = P?.skyMix ?? 0; out.mode = P?.mode ?? "dark";
    if (out.mode === "contrast") out.focus = "#ffe600";
    return out;
  }
  // WCAG AA: 4.5:1 for text, 3:1 for the focus ring and large display text. Glass is measured over the page background
  // (the darkest and the lightest the sky makes it are covered by the sky's own test: its glass darkens as the sky brightens).
  function contrastReport(tk) {
    const bg = parse(tk.bg), surface = parse(tk.surface), glass = over(parse(tk.glass), bg), panel = over(parse(tk.panel), bg), strong = over(parse(tk.glassStrong), bg);
    const rows = [
      ["text on the background", tk.ink, bg, 4.5], ["text on cards", tk.ink, surface, 4.5], ["text on glass", tk.ink, glass, 4.5], ["text on panels", tk.ink, panel, 4.5], ["text on pop-ups", tk.ink, strong, 4.5],
      ["quieter text on cards", tk.muted, surface, 4.5], ["quieter text on glass", tk.muted, glass, 4.5], ["quieter text on the background", tk.muted, bg, 4.5],
      ["labels on the background", tk.dim, bg, 4.5], ["labels on glass", tk.dim, glass, 4.5],
      ["links", tk.link, bg, 4.5], ["links on cards", tk.link, surface, 4.5], ["accent text", tk.accent, bg, 4.5], ["accent text on cards", tk.accent, surface, 3],
      ["button text on the accent", tk.accentInk, parse(tk.accent), 4.5], ["focus ring", tk.focus, bg, 3],
    ];
    return rows.map(([pair, fg, b, need]) => { const r = contrast(typeof fg === "string" ? parse(fg) : fg, b); return { pair, ratio: Math.round(r * 100) / 100, need, ok: r >= need }; });
  }

  // ---------------------------------------------------------------------------------------------------- your own theme
  // 2–3 colours → a theme: the first is the accent, the second the secondary, the third (optional) the surfaces
  // (otherwise the accent's hue, deep and quiet). A light third colour (or mode: "light") makes a day theme. The
  // brightness always follows the default's luminance, so the text is as readable as ever, whatever is picked.
  function buildCustom({ colors = [], mode = null, name = "My theme" } = {}) {
    const cs = colors.map(parse).filter(Boolean);
    if (!cs.length) throw new Error("Pick at least one colour.");
    const [a, b = null, c = null] = cs;
    const ha = rgb2hsl(a), hb = b ? rgb2hsl(b) : [(ha[0] + 40) % 360, ha[1], ha[2]], hc = c ? rgb2hsl(c) : null;
    const satOf = (hs) => clamp01(0.25 + hs[1] * 0.85);
    const light = mode === "light" || (!mode && c && lum(c) > 0.55);
    // how bright the accent was picked (relative to the default's indigo), kept within what stays readable
    const lift = Math.max(0.9, Math.min(1.3, (lum(a) + 0.05) / (lum(parse("#7c8cff")) + 0.05)));
    const params = { aH: round(ha[0]), aS: satOf(ha), bH: round(hb[0]), bS: satOf(hb), sH: round(hc ? hc[0] : ha[0]), sS: hc ? clamp01(0.2 + hc[1] * 0.7) : 0.45,
      inkS: 0.45, lift: light ? 1 : lift, mode: light ? "light" : "dark", sky: toCss(withLum(hc ? hc[0] : ha[0], 0.55, light ? 0.6 : 0.025)), skyMix: light ? 0.6 : 0.28 };
    // a very pale or very dark pick has no hue to speak of: keep the surfaces calm
    if (ha[1] < 0.08) params.aS = 0.3;
    const theme = { id: "custom", name: String(name || "My theme").slice(0, 40), blurb: "Your own colours.", params, custom: true, colors: cs.map((x) => toCss(x)) };
    // belt and braces: if anything still fails AA, soften the lift until it passes
    for (let i = 0; i < 6 && contrastReport(tokensFor(theme)).some((r) => !r.ok); i++) params.lift = Math.max(0.8, params.lift - 0.08);
    return theme;
  }
  function surprise(curId, rnd = Math.random) {
    const pool = THEMES.filter((t) => t.id !== curId && t.id !== "contrast");
    if (rnd() < 0.25) {   // now and then, a brand-new combination
      const h = Math.floor(rnd() * 360), scheme = [[40, 0.35], [150, 0.25], [180, 0.4], [-35, 0.3]][Math.floor(rnd() * 4)];
      const s = 0.55 + rnd() * 0.35;
      return buildCustom({ colors: [toCss(hsl2rgb(h, s, 0.66)), toCss(hsl2rgb((h + scheme[0] + 360) % 360, s, 0.68)), toCss(hsl2rgb((h + 10) % 360, scheme[1], 0.1))], name: "Surprise" });
    }
    return pool[Math.floor(rnd() * pool.length)];
  }
  // the theme a spoken name means: "pink", "the green one", "cherry blossom"
  function findByWords(text) {
    const q = " " + String(text ?? "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ") + " ";
    let best = null;
    for (const [id, ws] of Object.entries(WORDS)) for (const w of ws) if (q.includes(" " + w + " ") && (!best || w.length > best.w.length)) best = { id, w };
    return best ? byId(best.id) : null;
  }

  // swatches for Settings (the default keeps its own)
  for (const t of THEMES) if (!t.swatch) { const k = tokensFor(t); t.swatch = [k.bg, k.accent, k.secondary, k.ink]; }

  root.DsThemeCore = { THEMES, WORDS, byId, findByWords, mapperFor, tokensFor, contrastReport, buildCustom, surprise, parse, toCss, lum, contrast, over, rgb2hsl, hsl2rgb, withLum, invY, DEFAULT_TOKENS, hueDist };
})(typeof globalThis !== "undefined" ? globalThis : window);
