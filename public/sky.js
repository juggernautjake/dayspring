// The living sky behind the Dayspring screen: it follows the real time of day, weather and season outside (or a look the
// owner picks). Two canvases sit behind the cards:
//   #sky    the sky itself — gradient by the sun's height, sun and glow, rays, stars and the moon's real phase, lit clouds
//   #skyfx  the world — a layered landscape (hills, fields, forest or a river; lit by the sky, re-lit every 30 s), grass in
//           the foreground swaying with the real wind, rain, snow, fog, seasonal leaves/petals/seeds, fireflies,
//           raindrops beading on the glass, and a gentle lightning flash in storms
// It also tints the whole screen (accents, glass cards, text) so everything reads well from a starry night to a bright noon.
// Settings: GET /api/sky (Settings → Sky & scenery, voice, the assistant); the outside world: GET /api/ambient.
// Test with /display?sky=sunrise&weather=rain&season=fall&scene=river&wind=18
(() => {
  "use strict";
  const qs = new URLSearchParams(location.search);
  const OS_REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const RAD = Math.PI / 180;

  // ---------------------------------------------------------------------------------------------------- colors & math
  const hex = (h) => { h = h.replace("#", ""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const cl = (c) => c.map((v) => Math.max(0, Math.min(255, v)));
  const rgba = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  const toHex = (c) => "#" + cl(c).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const gray = (c) => { const g = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11; return [g, g, g]; };
  const sat = (c, s) => cl(mix(gray(c), c, s));
  const scale = (c, k) => cl([c[0] * k, c[1] * k, c[2] * k]);
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const rng = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const hash = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
  const hueOf = (c) => { const [r, g, b] = c.map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 240; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };

  // ---------------------------------------------------------------------------------------------------- the sun
  const DAY_MS = 86_400_000, J1970 = 2440588, J2000 = 2451545, OBL = RAD * 23.4397;
  const toDays = (d) => d.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
  const fromJ = (j) => new Date((j + 0.5 - J1970) * DAY_MS);
  const M_ = (d) => RAD * (357.5291 + 0.98560028 * d);
  const L_ = (M) => M + RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + RAD * 102.9372 + Math.PI;
  function sunElev(date, lat, lon) {
    const lw = RAD * -lon, phi = RAD * lat, d = toDays(date), L = L_(M_(d));
    const dec = Math.asin(Math.sin(OBL) * Math.sin(L)), ra = Math.atan2(Math.sin(L) * Math.cos(OBL), Math.cos(L));
    const H = RAD * (280.16 + 360.9856235 * d) - lw - ra;
    return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / RAD;
  }
  function sunTimes(date, lat, lon) {
    const lw = RAD * -lon, phi = RAD * lat, d = toDays(date), n = Math.round(d - 0.0009 - lw / (2 * Math.PI)), ds = 0.0009 + lw / (2 * Math.PI) + n;
    const M = M_(ds), L = L_(M), dec = Math.asin(Math.sin(OBL) * Math.sin(L)), Jn = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    const cw = (Math.sin(-0.833 * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
    if (cw < -1 || cw > 1) return { rise: null, set: null, noon: fromJ(Jn) };
    const w = Math.acos(cw), a = 0.0009 + (w + lw) / (2 * Math.PI) + n, Js = J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    return { rise: fromJ(Jn - (Js - Jn)), set: fromJ(Js), noon: fromJ(Jn) };
  }
  const moonPhase = (date) => ((((date - Date.UTC(2000, 0, 6, 18, 14)) / DAY_MS / 29.530588853) % 1) + 1) % 1;
  const seasonOf = (date, lat) => { const md = (date.getMonth() + 1) * 100 + date.getDate(); const n = md >= 320 && md < 621 ? "spring" : md >= 621 && md < 923 ? "summer" : md >= 923 && md < 1221 ? "fall" : "winter"; return lat < 0 ? { spring: "fall", summer: "winter", fall: "spring", winter: "summer" }[n] : n; };

  // ---------------------------------------------------------------------------------------------------- the palette
  // Sky colors by the sun's height (degrees), separately for mornings (rosy, peach) and evenings (orange, magenta, violet).
  const K = (e, top, mid, hor, light, a1, a2) => ({ e, top: hex(top), mid: hex(mid), hor: hex(hor), light: hex(light), a1: hex(a1), a2: hex(a2) });
  const NIGHT = [K(-90, "#03050d", "#060a1a", "#0c1230", "#7f8fc4", "#7c8cff", "#a78bfa"), K(-15, "#04071a", "#0a1032", "#161c4a", "#8090c4", "#7c8cff", "#a78bfa")];
  const DAY = [K(35, "#2a77d6", "#63abed", "#c6e3f7", "#ffffff", "#4f9ff0", "#f2bf5e"), K(90, "#2470d2", "#5ea7ec", "#c0e0f6", "#ffffff", "#4f9ff0", "#f2bf5e")];
  const AM = [...NIGHT,
    K(-9, "#0b1034", "#24296b", "#4c4088", "#a08cd0", "#8e8cff", "#b58bff"),
    K(-4, "#1b2360", "#5b4b93", "#e0879d", "#ffb3c0", "#f08fbb", "#c79bff"),
    K(0, "#304083", "#a172a8", "#ffae8c", "#ffc7a2", "#ff9ab6", "#ffb58f"),
    K(5, "#4e75be", "#c89fba", "#ffd4a3", "#ffe0b6", "#f3a0b4", "#ffc28a"),
    K(14, "#4a8ad8", "#8fbde8", "#f4e2c4", "#fff1d8", "#6aaef0", "#f2c26d"), ...DAY];
  const PM = [...NIGHT,
    K(-9, "#0b1036", "#1f2363", "#3d3576", "#9080c0", "#8e8cff", "#b58bff"),
    K(-4, "#1b2058", "#4c3b86", "#b65a82", "#ff9aa8", "#e48ac0", "#b58bff"),
    K(0, "#363e88", "#c45b7d", "#ff8c4e", "#ffb173", "#ff8f6b", "#c98bff"),
    K(6, "#4a6eb3", "#d8a476", "#ffc86c", "#ffd99c", "#ef9f5c", "#f0b04f"),
    K(20, "#3a83d2", "#7db7e6", "#ece6d0", "#fff4e0", "#58a8f3", "#efbd67"), ...DAY];
  function keyAt(table, e) {
    let i = 1; while (i < table.length - 1 && table[i].e < e) i++;
    const a = table[i - 1], b = table[i], t = smooth(0, 1, (e - a.e) / Math.max(0.001, b.e - a.e));
    const o = { e }; for (const k of ["top", "mid", "hor", "light", "a1", "a2"]) o[k] = mix(a[k], b[k], t); return o;
  }
  const SEASON_TINT = { spring: { hor: "#ffd6e6", a2: "#8fe0b0", a1: null, s: 1.02, k: 0.08 }, summer: { hor: "#ffe2a8", a2: null, a1: null, s: 1.1, k: 0.05 }, fall: { hor: "#ffb26b", a2: "#f0a35a", a1: "#e8875a", s: 1.02, k: 0.12 }, winter: { hor: "#d6e6ff", a2: null, a1: "#8fc2ff", s: 0.86, k: 0.12 } };
  const WEATHER_DEFAULTS = { clear: { cloud: 4, intensity: 0 }, partly: { cloud: 45, intensity: 0.5 }, overcast: { cloud: 100, intensity: 1 }, drizzle: { cloud: 96, intensity: 0.3 }, rain: { cloud: 100, intensity: 0.65 }, storm: { cloud: 100, intensity: 0.9 }, snow: { cloud: 96, intensity: 0.6 }, fog: { cloud: 88, intensity: 0.8 } };
  const PHASE = { night: { e: -32, am: false, f: 0.5 }, predawn: { e: -8, am: true, f: -0.04 }, sunrise: { e: 1.2, am: true, f: 0.03 }, morning: { e: 16, am: true, f: 0.2 }, midday: { e: 62, am: true, f: 0.5 }, afternoon: { e: 30, am: false, f: 0.74 }, golden: { e: 6, am: false, f: 0.93 }, sunset: { e: 0.6, am: false, f: 0.985 }, dusk: { e: -5, am: false, f: 1.04 } };
  const SCENES = ["hills", "fields", "forest", "river"];

  // ---------------------------------------------------------------------------------------------------- settings
  const DEFAULTS = { on: true, time: { follow: true, phase: "midday", shift: 0 }, weather: { follow: true, choice: "clear", clouds: 1, rain: 1, droplets: 1, snow: 1, fog: 1, lightning: true, wind: 1, rays: 1 },
    season: { follow: true, choice: "fall", particles: 1 }, scenery: { scene: "rotate", grass: true, water: true, lights: true, stars: true }, colors: { brightness: 1, saturation: 1, warmth: 0, dim: 0, accentFollows: true }, motion: "normal", fps: 30, preset: "real", schedule: { on: false, map: {} } };
  const deep = (a, b) => { const o = structuredClone(a); for (const [k, v] of Object.entries(b ?? {})) o[k] = v && typeof v === "object" && !Array.isArray(v) && typeof o[k] === "object" ? deep(o[k], v) : v; return o; };
  let prefs = structuredClone(DEFAULTS), presets = {}, amb = null, preview = null, schedPreset = null, lastWet = 0;
  const url = { sky: qs.get("sky"), weather: qs.get("weather"), season: qs.get("season"), scene: qs.get("scene"), wind: qs.get("wind"), dir: qs.get("winddir"), t: qs.get("t"), preset: qs.get("preset"), motion: qs.get("motion") };
  const eff = () => { let p = prefs; if (schedPreset && presets[schedPreset]) p = deep(p, presets[schedPreset].patch); if (url.preset && presets[url.preset]) p = deep(DEFAULTS, presets[url.preset].patch); if (url.motion) p = deep(p, { motion: url.motion }); return p; };

  // ---------------------------------------------------------------------------------------------------- the layers
  const css = document.createElement("style");
  css.textContent = `
  #sky,#skyfx{position:fixed;inset:0;width:100vw;height:100vh;display:block;pointer-events:none;transition:filter 2s ease,opacity 1.2s ease;
    filter:brightness(calc(var(--skyb,1) * var(--nightb,1))) saturate(var(--skys,1))}
  #sky{z-index:0} #skyfx{z-index:1}
  #skydim{position:fixed;inset:0;z-index:1;pointer-events:none;background:rgba(4,6,14,var(--skydim,0));transition:background 1s ease}
  body.night.dim{--nightb:.55} body.night.wake{--nightb:1}
  body.sky-off #sky,body.sky-off #skyfx,body.sky-off #skydim{opacity:0}
  .vignette{background:radial-gradient(ellipse at 50% 42%,transparent 38%,rgba(3,4,10,var(--vig,.6)) 100%)!important}
  /* the clock sits right on the sky: a soft shade behind it keeps it readable when the sky is bright */
  .clock{position:relative}
  .clock::before{content:"";position:absolute;inset:-.5em -.85em -.45em -.85em;z-index:-1;pointer-events:none;border-radius:1.15em;
    background:rgba(11,16,36,calc(var(--scrim,0) * .96));box-shadow:0 0 0 1px rgba(170,180,255,calc(var(--scrim,0) * .16)),0 18px 50px -24px rgba(0,0,0,calc(var(--scrim,0) * .6));
    backdrop-filter:blur(18px) saturate(140%);-webkit-backdrop-filter:blur(18px) saturate(140%);transition:background 2s ease}
  .clock .t{filter:drop-shadow(0 6px 30px rgba(124,140,255,.35)) drop-shadow(0 1px 8px rgba(6,10,28,calc(var(--scrim,0) * 1.3)))!important}
  .clock .d,.calbtns{text-shadow:0 1px 10px rgba(6,10,28,var(--scrim,0))}
  /* sunlight glinting across the glass cards */
  .card::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:-1;opacity:var(--glint,0);transition:opacity 3s ease;
    background:linear-gradient(115deg,transparent 42%,rgba(255,250,235,.55) 50%,transparent 58%);background-size:260% 100%;animation:skyglint 16s linear infinite}
  @keyframes skyglint{from{background-position:130% 0}to{background-position:-130% 0}}
  @media (prefers-reduced-motion: reduce){.card::before{animation:none}}
  #skypill{position:fixed;left:50%;bottom:calc(.8em + var(--sy,0px));transform:translateX(-50%);z-index:30;padding:.35em 1em;border-radius:2em;font-size:.8em;
    background:rgba(12,16,36,.78);border:1px solid rgba(170,180,255,.3);color:#eef0ff;backdrop-filter:blur(10px);pointer-events:none;transition:opacity .4s}
  #skypill[hidden]{display:none}
  .calbtns .util .skybtn i{background:linear-gradient(135deg,var(--indigo),var(--violet))!important}`;
  document.head.appendChild(css);
  const mk = (id) => { const c = document.createElement("canvas"); c.id = id; c.setAttribute("aria-hidden", "true"); return c; };
  const skyC = mk("sky"), fxC = mk("skyfx"), dimEl = Object.assign(document.createElement("div"), { id: "skydim" });
  const bgEl = document.getElementById("bg");
  document.body.insertBefore(skyC, bgEl ?? document.body.firstChild);
  const vig = document.querySelector(".vignette");
  (vig?.nextSibling ? document.body.insertBefore(fxC, vig.nextSibling) : document.body.insertBefore(fxC, skyC.nextSibling));
  document.body.insertBefore(dimEl, fxC.nextSibling);
  const pill = Object.assign(document.createElement("div"), { id: "skypill", hidden: true });
  document.body.appendChild(pill);
  const sx = skyC.getContext("2d"), fx = fxC.getContext("2d");
  let SW = 0, SH = 0, FW = 0, FH = 0;
  function size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    SW = skyC.width = Math.max(320, Math.floor(innerWidth * dpr * 0.5)); SH = skyC.height = Math.max(180, Math.floor(innerHeight * dpr * 0.5));
    FW = fxC.width = Math.max(320, Math.floor(innerWidth * dpr * 0.65)); FH = fxC.height = Math.max(180, Math.floor(innerHeight * dpr * 0.65));
    landKey = ""; cloudKey = ""; grass = null; stars = null;
  }
  addEventListener("resize", () => { clearTimeout(size._t); size._t = setTimeout(size, 200); });

  // ---------------------------------------------------------------------------------------------------- the state of the world
  let W = null;   // the resolved world for this moment: { elev, am, f, weather, season, scene, pal, bright, cover, windX, wind, ... }
  function nowDate() {
    if (url.t && /^\d{1,2}:\d{2}$/.test(url.t)) { const d = new Date(); const [h, m] = url.t.split(":").map(Number); d.setHours(h, m, 0, 0); return d; }
    return new Date();
  }
  function resolve() {
    const p = eff(), d = nowDate();
    const lat = amb?.lat ?? 35, lon = amb?.lon ?? -new Date().getTimezoneOffset() / 4;
    // time of day
    const phaseName = url.sky ?? preview?.sky ?? (!p.time.follow ? p.time.phase : null);
    let elev, am, f;
    if (phaseName && PHASE[phaseName]) ({ e: elev, am, f } = PHASE[phaseName]);
    else {
      const t = new Date(d.getTime() - (p.time.shift || 0) * 60_000);
      elev = sunElev(t, lat, lon); const st = sunTimes(t, lat, lon);
      am = st.noon ? t < st.noon : t.getHours() < 12;
      f = st.rise && st.set ? (t - st.rise) / (st.set - st.rise) : (t.getHours() + t.getMinutes() / 60 - 6) / 12;
    }
    // weather
    const wName = url.weather ?? preview?.weather ?? (!p.weather.follow ? p.weather.choice : null);
    const real = amb?.weather ?? { kind: "clear", intensity: 0, cloud: 5 };
    let w = wName ? { kind: wName, ...WEATHER_DEFAULTS[wName], wind: real.wind ?? 6, windDir: real.windDir ?? 225, gusts: real.gusts ?? 9 } : { ...real };
    if (wName === "storm") { w.wind = Math.max(w.wind, 16); w.gusts = Math.max(w.gusts ?? 0, 28); }
    if (url.wind) w.wind = Number(url.wind), w.gusts = Number(url.wind) * 1.5;
    if (url.dir) w.windDir = Number(url.dir);
    if (["rain", "drizzle", "storm"].includes(w.kind)) lastWet = Date.now();
    const season = url.season ?? preview?.season ?? (!p.season.follow ? p.season.choice : amb?.season ?? seasonOf(d, lat));
    let scene = url.scene ?? preview?.scene ?? p.scenery.scene;
    if (scene === "rotate") { const doy = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / DAY_MS); scene = SCENES[doy % SCENES.length]; }
    // the palette for that sky
    let pal = keyAt(am ? AM : PM, elev);
    const cover = clamp01(((w.cloud ?? 0) / 100)) * (p.weather.clouds > 0 ? 1 : 0.25);
    const heavy = { rain: 0.78, drizzle: 0.9, storm: 0.55, snow: 1.06, fog: 1.08, overcast: 0.92 }[w.kind] ?? 1;
    const dayL = smooth(-8, 14, elev);
    const greyAmt = clamp01((cover - 0.35) / 0.65) * (["rain", "storm", "drizzle", "overcast", "snow", "fog"].includes(w.kind) ? 0.82 : 0.5);
    const g = lerp(16, 196, dayL) * heavy, greyC = [g * 0.93, g * 0.96, g * 1.04];
    for (const k of ["top", "mid", "hor"]) pal[k] = mix(pal[k], k === "top" ? scale(greyC, 0.82) : greyC, greyAmt);
    if (w.kind === "fog") pal.hor = mix(pal.hor, scale(greyC, 1.12), 0.5 * (p.weather.fog > 0 ? 1 : 0)), pal.mid = mix(pal.mid, greyC, 0.35);
    pal.light = mix(pal.light, [235, 238, 245], greyAmt * 0.8);
    const st = SEASON_TINT[season];
    if (st) { pal.hor = mix(pal.hor, hex(st.hor), st.k * (1 - greyAmt)); for (const k of ["top", "mid", "hor"]) pal[k] = sat(pal[k], st.s); if (st.a1) pal.a1 = mix(pal.a1, hex(st.a1), 0.22); if (st.a2) pal.a2 = mix(pal.a2, hex(st.a2), 0.3); }
    const warm = p.colors.warmth;
    if (warm) for (const k of ["top", "mid", "hor", "light", "a1", "a2"]) pal[k] = mix(pal[k], warm > 0 ? [255, 176, 112] : [127, 176, 255], Math.abs(warm) * 0.18);
    // a colour theme (Settings → Look & feel) leans the sky and the scenery toward its own colour, most at night; the
    // default theme has no tint, so the sky is exactly as it always was
    const TH = window.dsTheme?.tokens;
    if (TH?.skyMix && /^#[0-9a-f]{6}$/i.test(TH.sky)) {
      const tc = hex(TH.sky), k = TH.skyMix * (1 - dayL * 0.55);
      for (const kk of ["top", "mid", "hor"]) pal[kk] = mix(pal[kk], tc, k * (kk === "hor" ? 0.6 : 1));
      if (/^#[0-9a-f]{6}$/i.test(TH.accent)) pal.a1 = mix(pal.a1, hex(TH.accent), 0.6);
      if (/^#[0-9a-f]{6}$/i.test(TH.secondary)) pal.a2 = mix(pal.a2, hex(TH.secondary), 0.6);
    }
    const bright = clamp01(Math.max(lum(pal.mid), lum(pal.hor) * 0.85) * 1.9) * p.colors.brightness ** 2;
    // wind: which way it blows on screen (east → right), how hard, gusting
    const toward = ((w.windDir ?? 225) + 180) * RAD;
    let wx = Math.sin(toward); if (Math.abs(wx) < 0.3) wx = wx < 0 ? -0.3 : 0.3;
    const windMph = (w.wind ?? 5) * p.weather.wind, gustRatio = Math.max(0, Math.min(1.5, ((w.gusts ?? windMph) - (w.wind ?? 5)) / Math.max(3, w.wind ?? 5)));
    const moon = moonPhase(d);
    W = { p, d, lat, lon, elev, am, f, weather: w, season, scene, pal, bright, dayL, cover, greyAmt, windX: wx, windMph, gustRatio, moon,
      stars: smooth(-4, -14, elev) * (1 - cover * 0.92) * (p.scenery.stars ? 1 : 0),
      sunVisible: elev > -2 && greyAmt < 0.6,
      snowy: w.kind === "snow" || (season === "winter" && (amb?.weather?.temp ?? 40) <= 34),
      wet: Date.now() - lastWet < 45 * 60_000, dirty: true };
    applyUI();
    return W;
  }

  // ---------------------------------------------------------------------------------------------------- the whole screen's colors
  let uiKey = "";
  function applyUI() {
    const r = document.documentElement.style, p = W.p, pal = W.pal, b = W.bright;
    document.body.classList.toggle("sky-off", !p.on);
    window.dsSky = p.on ? { on: true, glow: lerp(1, 0.26, b), aurora: lerp(1, 0.12, b), dust: lerp(1, 0.3, b), stars: W.stars, hue: hueOf(pal.a1), still: p.motion === "still", stillDrawn: window.dsSky?.stillDrawn ?? 0 } : { on: false };
    if (!p.on) { for (const v of ["--bg", "--glass", "--glass2", "--edge", "--edge2", "--muted", "--dim", "--indigo", "--violet", "--blue", "--vig", "--scrim", "--glint", "--skyb", "--skys", "--skydim"]) r.removeProperty(v); return; }
    // glass cards darken as the sky brightens, so text keeps ≥ 4.5:1 (checked by the screenshot test)
    const glassA = clamp01(0.44 + b * 0.4 + W.greyAmt * 0.08), tint = mix([20, 24, 50], [11, 16, 36], b);
    const vars = {
      "--bg": toHex(pal.top),
      "--glass": rgba(tint, glassA), "--glass2": rgba(mix(tint, [30, 36, 72], 0.5), Math.min(0.92, glassA + 0.1)),
      "--edge": rgba(mix(pal.a1, [255, 255, 255], 0.5), 0.13 + b * 0.08), "--edge2": rgba(mix(pal.a1, [255, 255, 255], 0.55), 0.26 + b * 0.1),
      "--muted": toHex(mix(hex("#a4abcc"), hex("#d5daef"), clamp01(b + W.greyAmt * 0.35))), "--dim": toHex(mix(hex("#6f7699"), hex("#bec5df"), clamp01(b + W.greyAmt * 0.35))),
      "--vig": (0.6 - b * 0.4).toFixed(3), "--scrim": Math.min(0.9, 0.16 + b * 0.82 + W.greyAmt * 0.22).toFixed(3),
      "--glint": (W.sunVisible && W.elev > 4 && p.motion !== "still" ? clamp01(0.07 * p.weather.rays * (1 - W.cover) + (W.wet ? 0.03 : 0)) : 0).toFixed(3),
      "--skyb": p.colors.brightness.toFixed(3), "--skys": p.colors.saturation.toFixed(3), "--skydim": p.colors.dim.toFixed(3),
    };
    if (p.colors.accentFollows) Object.assign(vars, { "--indigo": toHex(mix(hex("#7c8cff"), pal.a1, 0.75)), "--violet": toHex(mix(hex("#a78bfa"), pal.a2, 0.7)), "--blue": toHex(mix(hex("#6ea8fe"), pal.a1, 0.5)) });
    // a colour theme: every colour the sky sets goes through the theme's mapper too (same contrast, the theme's hues)
    if (window.dsThemeMap) for (const [k, v] of Object.entries(vars)) { if (!/^--(skyb|skys|skydim|vig|scrim|glint)$/.test(k)) vars[k] = themed(v); }
    const key = JSON.stringify(vars) + p.colors.accentFollows;
    if (key === uiKey) return;
    uiKey = key;
    for (const v of ["--indigo", "--violet", "--blue"]) if (!p.colors.accentFollows) r.removeProperty(v);
    for (const [k, v] of Object.entries(vars)) r.setProperty(k, v);
    // the Schedule app (when it's open on the screen) takes the same accents
    try { const cd = document.getElementById("calframe")?.contentDocument?.documentElement; if (cd) for (const k of ["--indigo", "--violet"]) vars[k] ? cd.style.setProperty(k, vars[k]) : cd.style.removeProperty(k); } catch { /* not open */ }
  }
  document.getElementById("calframe")?.addEventListener("load", () => { uiKey = ""; if (W) applyUI(); });
  // a colour passed through the theme's mapper ("#rrggbb" or "rgba(r,g,b,a)")
  function themed(v) {
    const m = /^#([0-9a-f]{6})$/i.exec(v) ? [...hex(v), 1] : (/^rgba?\(([^)]*)\)$/.exec(v)?.[1].split(",").map(Number) ?? null);
    if (!m || m.length < 3 || m.some((n) => !Number.isFinite(n))) return v;
    const c = window.dsThemeMap([m[0], m[1], m[2], m[3] ?? 1]).slice(0, 3);
    return (m[3] ?? 1) >= 0.999 ? toHex(c) : rgba(c, m[3]);
  }
  // a new theme: the sky, the scenery and the screen's colours are worked out again
  addEventListener("ds-theme", () => { uiKey = ""; landKey = ""; cloudKey = ""; try { if (W) resolve(); } catch { /* next tick */ } });

  // ---------------------------------------------------------------------------------------------------- stars, moon, sun
  let stars = null;
  function makeStars() { const r = rng(7); stars = Array.from({ length: 190 }, () => ({ x: r(), y: r() * 0.78, s: 0.35 + r() * r() * 1.5, tw: r() * 6.28, sp: 0.6 + r() * 1.8, warm: r() < 0.15 })); }
  function drawMoon(ctx, x, y, R, phase, light) {
    // glow
    const g = ctx.createRadialGradient(x, y, R * 0.8, x, y, R * 7); g.addColorStop(0, rgba([220, 228, 255], 0.16 * light)); g.addColorStop(1, rgba([220, 228, 255], 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R * 7, 0, Math.PI * 2); ctx.fill();
    // the dark disc, faintly visible (earthshine), then the lit part
    ctx.fillStyle = rgba([60, 70, 110], 0.35 * light); ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    const k = Math.cos(phase * 2 * Math.PI), waxing = phase < 0.5;
    ctx.fillStyle = rgba([238, 240, 250], 0.95 * light);
    ctx.beginPath();
    ctx.arc(x, y, R, -Math.PI / 2, Math.PI / 2, !waxing);           // the lit limb
    ctx.ellipse(x, y, Math.abs(k) * R, R, 0, Math.PI / 2, -Math.PI / 2, (k > 0) === waxing);
    ctx.fill();
  }
  // ---------------------------------------------------------------------------------------------------- clouds
  let cloudSprites = [], cloudKey = "", clouds = [];
  function cloudSprite(seed, w, h, top, bottom, flat) {
    const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"), r = rng(seed);
    x.filter = `blur(${Math.max(2, Math.round(h * 0.06))}px)`;
    x.fillStyle = "#fff";
    const n = flat ? 16 : 13;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), cx = w * (0.14 + t * 0.72 + (r() - 0.5) * 0.06);
      const rad = flat ? h * (0.16 + r() * 0.12) : h * (0.18 + Math.sin(t * Math.PI) * 0.22 + r() * 0.1);
      const cy = flat ? h * (0.55 + (r() - 0.5) * 0.1) : h * 0.72 - rad * (0.55 + r() * 0.35);
      x.beginPath(); x.arc(cx, cy, rad, 0, Math.PI * 2); x.fill();
    }
    if (!flat) { x.beginPath(); x.ellipse(w * 0.5, h * 0.72, w * 0.36, h * 0.11, 0, 0, Math.PI * 2); x.fill(); }
    x.filter = "none";
    // lit from above, shaded underneath
    x.globalCompositeOperation = "source-atop";
    const g = x.createLinearGradient(0, h * 0.15, 0, h * 0.85); g.addColorStop(0, rgba(top)); g.addColorStop(0.55, rgba(mix(top, bottom, 0.45))); g.addColorStop(1, rgba(bottom));
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    return c;
  }
  function buildClouds() {
    const { pal, dayL, weather, greyAmt, elev } = W;
    const storm = weather.kind === "storm", rainy = ["rain", "drizzle", "storm"].includes(weather.kind);
    // lit tops, and undersides that catch the sunrise pinks or sunset gold
    let top = mix(scale(pal.hor, 0.35 + 0.65 * dayL), [255, 255, 255], 0.55 * dayL);
    let bottom = mix(scale(pal.mid, 0.5 + 0.4 * dayL), pal.hor, Math.abs(elev) < 12 ? 0.55 : 0.2);
    if (dayL < 0.2) { top = mix([44, 52, 88], pal.mid, 0.3); bottom = [20, 24, 46]; }
    if (greyAmt > 0.4) { top = mix(top, scale([200, 205, 214], 0.2 + 0.8 * dayL), 0.6); bottom = mix(bottom, scale([120, 126, 140], 0.25 + 0.75 * dayL), 0.7); }
    if (storm) { top = scale(top, 0.62); bottom = scale([48, 52, 66], 0.4 + 0.6 * dayL); } else if (rainy) { top = scale(top, 0.85); bottom = scale(bottom, 0.78); }
    const flat = greyAmt > 0.45;
    cloudSprites = Array.from({ length: 6 }, (_, i) => cloudSprite(101 + i * 17, Math.round(SW * (flat ? 0.55 : 0.34)), Math.round(SH * (flat ? 0.2 : 0.3)), top, bottom, flat));
    const want = Math.round((W.cover < 0.08 ? 1 : 2 + W.cover * (flat ? 9 : 7)) * Math.min(1.6, W.p.weather.clouds));
    const r = rng(33);
    while (clouds.length < want) clouds.push({ x: r() * 1.3 - 0.15, y: 0.04 + r() * (flat ? 0.42 : 0.5), s: 0.55 + r() * 0.7, sp: 0.6 + r() * 0.8, i: clouds.length % 6, a: 0.75 + r() * 0.25 });
    clouds.length = want;
  }

  // ---------------------------------------------------------------------------------------------------- the landscape
  let landC = null, landKey = "", landAt = 0, river = null, lightsList = [];
  const MAT = {
    spring: { grass: "#6fae5a", far: "#86b58e", tree: ["#5ea85a", "#79bd62", "#4f9a55"], blossom: ["#f7c9da", "#fbe4ee", "#f3b1c9"], soil: "#6d5a45", row: "#8fd07a", row2: "#6fb35c" },
    summer: { grass: "#3f7f3a", far: "#5d8f6b", tree: ["#2f6b35", "#3b7d3c", "#27592e"], blossom: [], soil: "#7c6a44", row: "#6c9a3a", row2: "#d6b85a" },
    fall: { grass: "#a8893d", far: "#8f8a6a", tree: ["#d9722b", "#c2412d", "#e6a83a", "#b8562a", "#8a5a2b", "#e38b2f"], blossom: [], soil: "#8a6a3e", row: "#cfa65a", row2: "#a7843f" },
    winter: { grass: "#dfe6ee", far: "#a9b6c8", tree: ["#3d4a4a", "#47524f"], blossom: [], soil: "#e8eef5", row: "#dbe3ec", row2: "#c7d1dd" },
  };
  function lit(c, haze, W2) {
    const { dayL, pal } = W2;
    let o = scale(c, 0.16 + 0.84 * dayL);
    o = mix(o, mix(o, scale(pal.light, 0.9), 0.5), 0.3 * dayL);            // the light's color
    o = mix(o, lum(c) > 0.55 ? [46, 56, 90] : [8, 12, 34], (1 - dayL) * 0.72);   // night silhouettes (snow stays moonlit blue-grey)
    return mix(o, mix(pal.hor, pal.mid, 0.3), haze * (0.55 + 0.45 * (W2.weather.kind === "fog" ? 1 : 0)) + (W2.weather.kind === "fog" ? 0.25 : 0));
  }
  function ridge(x, r, y0, amp, color, W2, H, Wd) {
    const f1 = 1 + r() * 2, f2 = 3 + r() * 4, p1 = r() * 6, p2 = r() * 6;
    x.beginPath(); x.moveTo(0, H);
    for (let i = 0; i <= 64; i++) { const t = i / 64; x.lineTo(t * Wd, y0 - (Math.sin(t * Math.PI * f1 + p1) * 0.6 + Math.sin(t * Math.PI * f2 + p2) * 0.25 + 0.4) * amp); }
    x.lineTo(Wd, H); x.closePath();
    const g = x.createLinearGradient(0, y0 - amp, 0, H); g.addColorStop(0, rgba(mix(color, W2.pal.light, 0.12 * W2.dayL))); g.addColorStop(1, rgba(scale(color, 0.82)));
    x.fillStyle = g; x.fill();
  }
  function tree(x, r, cx, base, h, kind, colors, W2, haze, season) {
    const trunk = lit(hex(season === "winter" ? "#4a4038" : "#4b3a2a"), haze, W2);
    if (kind === "pine") {
      const c = lit(hex(season === "fall" ? "#2f5a3a" : season === "winter" ? "#3a5a52" : "#2f6b3f"), haze, W2);
      x.fillStyle = rgba(c); x.beginPath(); x.moveTo(cx, base - h); x.lineTo(cx - h * 0.28, base - h * 0.08); x.lineTo(cx + h * 0.28, base - h * 0.08); x.closePath(); x.fill();
      if (season === "winter") { x.fillStyle = rgba(lit(hex("#eef3f8"), haze, W2), 0.85); x.beginPath(); x.moveTo(cx, base - h); x.lineTo(cx - h * 0.12, base - h * 0.6); x.lineTo(cx + h * 0.12, base - h * 0.6); x.closePath(); x.fill(); }
      return;
    }
    x.strokeStyle = rgba(trunk); x.lineWidth = Math.max(1, h * 0.06); x.beginPath(); x.moveTo(cx, base); x.lineTo(cx, base - h * 0.55); x.stroke();
    if (season === "winter") {          // bare branches, a little snow
      x.lineWidth = Math.max(0.6, h * 0.025);
      for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (r() - 0.5) * 1.6, l = h * (0.25 + r() * 0.25), y = base - h * (0.35 + r() * 0.25); x.beginPath(); x.moveTo(cx, y); x.lineTo(cx + Math.cos(a) * l, y + Math.sin(a) * l); x.stroke(); }
      return;
    }
    const c = lit(hex(colors[Math.floor(r() * colors.length)]), haze, W2);
    for (let i = 0; i < 4; i++) { x.fillStyle = rgba(mix(c, scale(c, 1.12), r())); x.beginPath(); x.arc(cx + (r() - 0.5) * h * 0.35, base - h * (0.62 + r() * 0.2), h * (0.2 + r() * 0.1), 0, Math.PI * 2); x.fill(); }
  }
  function buildLand() {
    const Wd = FW, H = FH, W2 = W, season = W2.snowy ? "winter" : W2.season, M = MAT[season], scene = W2.scene;
    landC ??= document.createElement("canvas"); landC.width = Wd; landC.height = H;
    const x = landC.getContext("2d"); x.clearRect(0, 0, Wd, H);
    river = null; lightsList = [];
    if (scene === "none" || !W2.p.on) return;
    const day = new Date(W2.d); const r = rng(hash(scene + day.getFullYear() + "-" + day.getMonth() + "-" + day.getDate()));
    const hY = H * 0.845;
    const far = lit(hex(M.far), 0.62, W2), mid = lit(mix(hex(M.far), hex(M.grass), 0.5), 0.35, W2), near = lit(hex(M.grass), 0.1, W2);
    ridge(x, r, hY - H * 0.02, H * 0.05, far, W2, H, Wd);
    // distant lights once it's dark (farmhouses, a little town)
    if (W2.p.scenery.lights && W2.dayL < 0.35) for (let i = 0, n = 5 + Math.floor(r() * 6); i < n; i++) lightsList.push({ x: r() * Wd, y: hY - H * (0.005 + r() * 0.03), r: 0.8 + r() * 1.2, tw: r() * 6.28 });
    if (scene === "hills") {
      ridge(x, r, hY + H * 0.01, H * 0.045, mid, W2, H, Wd);
      ridge(x, r, hY + H * 0.06, H * 0.05, near, W2, H, Wd);
      if (season !== "winter") for (let i = 0; i < 16; i++) tree(x, r, r() * Wd, hY + H * (0.02 + r() * 0.03), H * (0.02 + r() * 0.02), r() < 0.5 ? "pine" : "round", M.tree, W2, 0.35, season);
    } else if (scene === "fields") {
      for (let i = 0; i < 26; i++) tree(x, r, r() * Wd, hY + H * 0.004, H * (0.012 + r() * 0.012), r() < 0.4 ? "pine" : "round", M.tree, W2, 0.45, season);
      // the field: rows receding to a point on the horizon
      const top = hY + H * 0.004, vpx = Wd * (0.35 + r() * 0.3);
      x.fillStyle = rgba(lit(hex(M.soil), 0.18, W2)); x.fillRect(0, top, Wd, H - top);
      const rows = 26, spread = Wd * 2.6;
      for (let i = 0; i < rows; i++) {
        const a = (i / rows) * spread - spread / 2 + vpx, b = ((i + 0.45) / rows) * spread - spread / 2 + vpx;
        const c = lit(hex(i % 2 ? M.row : M.row2), 0.14, W2);
        const g = x.createLinearGradient(0, top, 0, H); g.addColorStop(0, rgba(mix(c, lit(hex(M.far), 0.5, W2), 0.55))); g.addColorStop(1, rgba(c));
        x.fillStyle = g; x.beginPath(); x.moveTo(vpx, top); x.lineTo(a, H); x.lineTo(b, H); x.closePath(); x.fill();
      }
      // round hay bales in the fall: small, shaded, sitting on the stubble
      if (season === "fall") for (let i = 0; i < 6; i++) {
        const by = top + (H - top) * (0.08 + r() * 0.35), k = (by - top) / (H - top), bx = r() * Wd, s = H * (0.004 + k * 0.012);
        x.fillStyle = rgba(lit(hex("#3a2c14"), 0.1, W2), 0.35); x.beginPath(); x.ellipse(bx + s * 0.4, by + s * 0.85, s * 1.5, s * 0.35, 0, 0, Math.PI * 2); x.fill();
        const hg = x.createLinearGradient(bx, by - s, bx, by + s); hg.addColorStop(0, rgba(lit(hex("#e3c273"), 0.1, W2))); hg.addColorStop(1, rgba(lit(hex("#9c7a36"), 0.1, W2)));
        x.fillStyle = hg; x.beginPath(); x.ellipse(bx, by, s * 1.25, s, 0, 0, Math.PI * 2); x.fill();
        x.strokeStyle = rgba(lit(hex("#7a5d28"), 0.1, W2), 0.6); x.lineWidth = Math.max(0.5, s * 0.12); x.beginPath(); x.ellipse(bx - s * 0.5, by, s * 0.45, s * 0.8, 0, 0, Math.PI * 2); x.stroke();
      }
    } else if (scene === "forest") {
      ridge(x, r, hY - H * 0.004, H * 0.03, mid, W2, H, Wd);
      for (let layer = 0; layer < 3; layer++) {
        const haze = [0.5, 0.28, 0.08][layer], base = hY + H * [0.012, 0.045, 0.1][layer], hs = H * [0.035, 0.06, 0.1][layer], n = [60, 36, 18][layer];
        x.fillStyle = rgba(lit(hex(M.grass), haze, W2)); x.fillRect(0, base - hs * 0.08, Wd, H);
        for (let i = 0; i < n; i++) tree(x, r, (i / n) * Wd + (r() - 0.5) * (Wd / n), base, hs * (0.7 + r() * 0.6), r() < (season === "fall" ? 0.25 : 0.45) ? "pine" : "round", M.tree, W2, haze, season);
        if (season === "spring" && layer > 0) for (let i = 0; i < n * 3; i++) { x.fillStyle = rgba(lit(hex(M.blossom[i % M.blossom.length]), haze, W2), 0.9); x.beginPath(); x.arc(r() * Wd, base - hs * (0.4 + r() * 0.5), hs * 0.035, 0, Math.PI * 2); x.fill(); }
      }
    } else if (scene === "river") {
      ridge(x, r, hY + H * 0.008, H * 0.035, mid, W2, H, Wd);
      const top = hY + H * 0.02; x.fillStyle = rgba(near); x.fillRect(0, top, Wd, H - top);
      for (let i = 0; i < 20; i++) tree(x, r, r() * Wd, top + H * r() * 0.02, H * (0.015 + r() * 0.015), r() < 0.5 ? "pine" : "round", M.tree, W2, 0.3, season);
      // the river winds toward you, widening; it reflects the sky
      const vpx = Wd * (0.4 + r() * 0.2), ph = r() * 6, pts = [];
      for (let i = 0; i <= 40; i++) { const t = i / 40, y = top + (H - top) * t, cx = vpx + Math.sin(t * 3.2 + ph) * t * Wd * 0.2, w = Wd * (0.004 + t ** 1.7 * 0.3); pts.push({ y, cx, w, t }); }
      river = { pts, top };
      const iced = season === "winter" && (amb?.weather?.temp ?? 40) <= 30 || (season === "winter" && W2.snowy);
      river.iced = iced;
      const g = x.createLinearGradient(0, top, 0, H);
      g.addColorStop(0, rgba(iced ? mix(W2.pal.hor, [225, 235, 245], 0.6) : mix(W2.pal.hor, W2.pal.mid, 0.2)));
      g.addColorStop(1, rgba(iced ? scale(mix(W2.pal.mid, [205, 220, 236], 0.55), 0.95) : scale(mix(W2.pal.mid, W2.pal.top, 0.4), 0.9)));
      x.fillStyle = g; x.beginPath();
      pts.forEach((p, i) => (i ? x.lineTo(p.cx - p.w, p.y) : x.moveTo(p.cx - p.w, p.y)));
      for (let i = pts.length - 1; i >= 0; i--) x.lineTo(pts[i].cx + pts[i].w, pts[i].y);
      x.closePath(); x.fill();
      x.strokeStyle = rgba(scale(near, 0.7), 0.6); x.lineWidth = 1.2; x.stroke();
    }
    // snow cover on everything in front
    if (W2.snowy && scene !== "fields") { const g = x.createLinearGradient(0, hY, 0, H); g.addColorStop(0, rgba(lit(hex("#eef3f9"), 0.3, W2), 0)); g.addColorStop(0.4, rgba(lit(hex("#eef3f9"), 0.1, W2), 0.55)); g.addColorStop(1, rgba(lit(hex("#f4f7fb"), 0, W2), 0.8)); x.fillStyle = g; x.fillRect(0, hY, Wd, H - hY); }
  }

  // ---------------------------------------------------------------------------------------------------- grass, particles
  let grass = null, rain = [], snow = [], bits = [], flies = [], drops = [], flash = null, nextFlash = 0, nextDrop = 0;
  function makeGrass() { const r = rng(91); grass = Array.from({ length: 150 }, (_, i) => ({ x: (i + r()) / 150, h: 0.018 + r() * r() * 0.05, w: 0.0025 + r() * 0.003, lean: (r() - 0.5) * 0.25, ph: r() * 6.28, v: Math.floor(r() * 3) })); }
  function grassColors() {
    const season = W.snowy ? "winter" : W.season;
    const base = { spring: ["#4f9a4a", "#6fbf5a", "#3f8a40"], summer: ["#2f6b30", "#3f7f35", "#27592a"], fall: ["#9a7a35", "#b8913e", "#7a5a2a"], winter: ["#8f9aa8", "#a9b3bf", "#77828f"] }[season];
    return base.map((h) => scale(mix(lit(hex(h), 0.02, W), [6, 8, 20], (1 - W.dayL) * 0.35), 1));
  }
  function spawn(list, n, make) { while (list.length < n) list.push(make()); if (list.length > n) list.length = n; }

  // ---------------------------------------------------------------------------------------------------- drawing
  let lastT = 0, last = 0, drawnStill = 0, resolvedAt = 0, gustPhase = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const p = W?.p ?? eff(), still = p.motion === "still" || false;
    const fps = still ? 1 / 60 : OS_REDUCED || p.motion === "reduced" ? 12 : p.fps;
    if (last && t - last < 1000 / fps - 2 && !W?.dirty) return;
    if (W) W.dirty = false;
    const dt = Math.min(0.1, (t - (last || t)) / 1000); last = t;
    if (!W || t - resolvedAt > 5000) { resolve(); resolvedAt = t; }
    if (!p.on) { if (lastT !== -1) { sx.clearRect(0, 0, SW, SH); fx.clearRect(0, 0, FW, FH); lastT = -1; } return; }
    lastT = t;
    const moving = !still && !(OS_REDUCED || p.motion === "reduced");
    const t0 = performance.now();
    drawSky(t, dt, moving);
    drawWorld(t, dt, moving);
    window.dsSkyFrameMs = performance.now() - t0;
  }
  function drawSky(t, dt, moving) {
    const { pal, elev, f, dayL } = W, Wd = SW, H = SH, M = Math.max(Wd, H), hY = H * 0.845;
    // the sky
    const g = sx.createLinearGradient(0, 0, 0, hY);
    g.addColorStop(0, rgba(pal.top)); g.addColorStop(0.55, rgba(pal.mid)); g.addColorStop(1, rgba(pal.hor));
    sx.fillStyle = g; sx.fillRect(0, 0, Wd, H);
    // where the sun is (or would be): across the sky from sunrise to sunset
    const sxp = Wd * (0.08 + 0.84 * clamp01(f)), peak = Math.max(20, W.am ? 62 : 62), syp = hY - (Math.max(-6, elev) / peak) * (hY - H * 0.12);
    // the glow of the sun near the horizon (dawn/dusk band), and around it by day
    if (elev > -12) {
      const band = smooth(-12, -1, elev) * (1 - smooth(8, 25, elev)) * (1 - W.greyAmt * 0.6);
      if (band > 0.01) { const bg = sx.createRadialGradient(sxp, hY, 0, sxp, hY, M * 0.7); bg.addColorStop(0, rgba(mix(pal.hor, pal.light, 0.4), 0.55 * band)); bg.addColorStop(1, rgba(pal.hor, 0)); sx.fillStyle = bg; sx.fillRect(0, 0, Wd, H); }
      if (elev > -2) { const sg = sx.createRadialGradient(sxp, syp, 0, sxp, syp, M * 0.45); sg.addColorStop(0, rgba(pal.light, 0.5 * (1 - W.greyAmt * 0.7) * smooth(-2, 6, elev))); sg.addColorStop(1, rgba(pal.light, 0)); sx.fillStyle = sg; sx.fillRect(0, 0, Wd, H); }
    }
    // stars and the moon
    if (W.stars > 0.02) {
      if (!stars) makeStars();
      for (const s of stars) {
        const tw = moving ? 0.55 + 0.45 * Math.sin(t * 0.001 * s.sp + s.tw) : 0.8;
        sx.fillStyle = s.warm ? rgba([255, 226, 190], W.stars * tw) : rgba([226, 232, 255], W.stars * tw);
        sx.fillRect(s.x * Wd, s.y * hY, s.s, s.s);
      }
      const nightF = W.am ? 0.75 + clamp01(-f) * 0.2 : 0.25 - clamp01(f - 1) * 0.2;
      // the moon stays up in the band above the cards (never behind the clock or text)
      drawMoon(sx, Wd * (0.45 + 0.5 * clamp01(nightF)), H * (0.055 + Math.abs(nightF - 0.5) * 0.04), Math.max(4, M * 0.016), W.moon, Math.min(1, W.stars * 1.2));
    }
    // the sun itself, sun rays and a little lens shimmer on clear days
    if (W.sunVisible) {
      const R = Math.max(3, M * 0.022), a = smooth(-2, 3, elev) * (1 - W.greyAmt);
      const d = sx.createRadialGradient(sxp, syp, 0, sxp, syp, R * 3.2); d.addColorStop(0, rgba([255, 252, 240], a)); d.addColorStop(0.3, rgba(mix(pal.light, [255, 240, 200], 0.5), a * 0.9)); d.addColorStop(1, rgba(pal.light, 0));
      sx.fillStyle = d; sx.beginPath(); sx.arc(sxp, syp, R * 3.2, 0, Math.PI * 2); sx.fill();
      const rays = W.p.weather.rays * (1 - W.cover) * smooth(1, 8, elev);
      if (rays > 0.02) {
        sx.save(); sx.translate(sxp, syp); sx.rotate(moving ? t * 0.00002 : 0.3); sx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 9; i++) { sx.rotate((Math.PI * 2) / 9); const rg = sx.createLinearGradient(0, 0, M * 0.8, 0); rg.addColorStop(0, rgba(pal.light, 0.07 * rays)); rg.addColorStop(1, rgba(pal.light, 0)); sx.fillStyle = rg; sx.beginPath(); sx.moveTo(0, 0); sx.lineTo(M * 0.8, -M * 0.05); sx.lineTo(M * 0.8, M * 0.05); sx.closePath(); sx.fill(); }
        sx.restore();
        // lens shimmer: faint rings along the line from the sun through the middle
        sx.globalCompositeOperation = "lighter";
        const cx = Wd / 2, cy = H / 2;
        for (const [k, rr, aa] of [[0.55, 0.018, 0.05], [0.9, 0.03, 0.035], [1.3, 0.012, 0.05], [1.6, 0.045, 0.025]]) { const px = sxp + (cx - sxp) * k, py = syp + (cy - syp) * k, rad = M * rr; const lg = sx.createRadialGradient(px, py, 0, px, py, rad); lg.addColorStop(0, rgba([255, 240, 220], aa * rays)); lg.addColorStop(1, rgba([255, 240, 220], 0)); sx.fillStyle = lg; sx.beginPath(); sx.arc(px, py, rad, 0, Math.PI * 2); sx.fill(); }
        sx.globalCompositeOperation = "source-over";
      }
    }
    // clouds drift with the wind (re-lit every half minute)
    const ck = `${Math.round(elev)}|${W.am}|${W.weather.kind}|${Math.round(W.cover * 10)}|${W.season}|${SW}|${Math.round(W.p.weather.clouds * 5)}`;
    if (ck !== cloudKey && (!cloudKey || performance.now() - (buildClouds.at ?? 0) > 30_000 || !cloudSprites.length || ck.split("|")[2] !== cloudKey.split("|")[2])) { buildClouds(); buildClouds.at = performance.now(); cloudKey = ck; }
    if (W.p.weather.clouds > 0) {
      // overcast: a soft grey ceiling first
      if (W.greyAmt > 0.35) { const og = sx.createLinearGradient(0, 0, 0, hY); og.addColorStop(0, rgba(scale(mix(pal.top, pal.mid, 0.5), 0.95), 0.55 * W.greyAmt)); og.addColorStop(1, rgba(pal.mid, 0)); sx.fillStyle = og; sx.fillRect(0, 0, Wd, hY); }
      const speed = (0.004 + Math.min(1.6, W.windMph / 25) * 0.02) * W.windX * (moving ? 1 : 0);
      for (const c of clouds) {
        c.x += speed * c.sp * dt * (0.7 + c.s * 0.5);
        if (c.x > 1.25) c.x = -0.45; if (c.x < -0.5) c.x = 1.2;
        const spr = cloudSprites[c.i % cloudSprites.length]; if (!spr) continue;
        const w = spr.width * c.s, h = spr.height * c.s;
        sx.globalAlpha = c.a * Math.min(1, 0.35 + W.p.weather.clouds * 0.65); sx.drawImage(spr, c.x * Wd, c.y * H, w, h); sx.globalAlpha = 1;
      }
    }
  }
  function drawWorld(t, dt, moving) {
    const Wd = FW, H = FH, p = W.p, kind = W.weather.kind, hY = H * 0.845;
    fx.clearRect(0, 0, Wd, H);
    // landscape: rebuilt when the scene, season or light changes (at most every 30 s)
    const lk = `${W.scene}|${W.snowy ? "winter" : W.season}|${Math.round(W.elev / 2)}|${W.am}|${kind}|${FW}|${p.scenery.lights}|${new Date(W.d).getDate()}`;
    if (lk !== landKey && (!landKey || performance.now() - landAt > 30_000 || lk.split("|")[0] !== landKey.split("|")[0] || lk.split("|")[1] !== landKey.split("|")[1] || lk.split("|")[5] !== landKey.split("|")[5])) { buildLand(); landKey = lk; landAt = performance.now(); }
    if (landC && W.scene !== "none") fx.drawImage(landC, 0, 0);
    const wind = Math.min(1.6, W.windMph / 25) * (1 + W.gustRatio * 0.6 * Math.max(0, Math.sin(t * 0.00031) * Math.sin(t * 0.00073 + 1.3)));
    const wx = W.windX;
    // water: shimmer of reflected light, and rings where raindrops land
    if (river && p.scenery.water && !river.iced) {
      fx.globalCompositeOperation = "lighter";
      const lt = mix(W.pal.light, [255, 255, 255], 0.3), a = 0.1 + W.dayL * 0.18;
      for (let i = 3; i < river.pts.length; i += 2) {
        const q = river.pts[i], k = moving ? Math.sin(t * 0.0012 + i * 1.7) : 0.5;
        if (k < 0.2) continue;
        fx.fillStyle = rgba(lt, a * k * q.t); fx.fillRect(q.cx - q.w * 0.6 + Math.sin(t * 0.0004 + i) * q.w * 0.3, q.y, q.w * (0.3 + 0.4 * k), Math.max(1, H * 0.0025 * (0.5 + q.t)));
      }
      fx.globalCompositeOperation = "source-over";
      if (["rain", "drizzle", "storm"].includes(kind) && moving && p.weather.rain > 0) {
        spawn(bits.ripples ??= [], Math.round(10 * p.weather.rain), () => ({ i: 6 + Math.floor(Math.random() * 34), dx: Math.random() - 0.5, age: Math.random() }));
        fx.strokeStyle = rgba([225, 235, 250], 0.35); fx.lineWidth = 0.8;
        for (const rp of bits.ripples) { rp.age += dt * 0.9; if (rp.age > 1) { rp.age = 0; rp.i = 6 + Math.floor(Math.random() * 34); rp.dx = Math.random() - 0.5; } const q = river.pts[rp.i]; fx.globalAlpha = 1 - rp.age; fx.beginPath(); fx.ellipse(q.cx + rp.dx * q.w * 1.4, q.y, 1 + rp.age * q.w * 0.12, (1 + rp.age * q.w * 0.12) * 0.3, 0, 0, Math.PI * 2); fx.stroke(); }
        fx.globalAlpha = 1;
      }
    }
    // distant lights and summer fireflies after dark
    if (lightsList.length) { fx.globalCompositeOperation = "lighter"; for (const l of lightsList) { const a = 0.55 + (moving ? 0.25 * Math.sin(t * 0.002 + l.tw) : 0); fx.fillStyle = rgba([255, 205, 130], a * (1 - W.dayL)); fx.beginPath(); fx.arc(l.x, l.y, l.r, 0, Math.PI * 2); fx.fill(); } fx.globalCompositeOperation = "source-over"; }
    const fireflies = p.scenery.lights && W.season === "summer" && W.dayL < 0.25 && !["rain", "storm", "snow"].includes(kind) && moving;
    spawn(flies, fireflies ? 16 : 0, () => ({ x: Math.random(), y: 0.78 + Math.random() * 0.2, ph: Math.random() * 6.28, sp: 0.3 + Math.random() }));
    if (flies.length) { fx.globalCompositeOperation = "lighter"; for (const q of flies) { q.x += Math.sin(t * 0.0005 * q.sp + q.ph) * 0.0006 + wx * wind * 0.0004; q.y += Math.cos(t * 0.0007 * q.sp + q.ph) * 0.0004; if (q.x > 1.02) q.x = -0.02; if (q.x < -0.02) q.x = 1.02; const a = Math.max(0, Math.sin(t * 0.0025 * q.sp + q.ph)) ** 3; const fg = fx.createRadialGradient(q.x * Wd, q.y * H, 0, q.x * Wd, q.y * H, 6); fg.addColorStop(0, rgba([235, 255, 150], a)); fg.addColorStop(1, rgba([235, 255, 150], 0)); fx.fillStyle = fg; fx.beginPath(); fx.arc(q.x * Wd, q.y * H, 6, 0, Math.PI * 2); fx.fill(); } fx.globalCompositeOperation = "source-over"; }
    // fog: drifting haze low over the land
    if (kind === "fog" && p.weather.fog > 0) {
      const a = 0.28 * W.weather.intensity * p.weather.fog, fc = mix(W.pal.hor, [220, 225, 232], 0.4);
      for (let i = 0; i < 3; i++) { const y = H * (0.62 + i * 0.1), off = moving ? (t * 0.000012 * (i + 1) * W.windX * Wd) % Wd : 0; const g = fx.createLinearGradient(0, y - H * 0.12, 0, y + H * 0.12); g.addColorStop(0, rgba(fc, 0)); g.addColorStop(0.5, rgba(fc, a)); g.addColorStop(1, rgba(fc, 0)); fx.fillStyle = g; fx.save(); fx.translate(off, 0); fx.fillRect(-Wd, y - H * 0.12, Wd * 3, H * 0.24); fx.restore(); }
      const vg = fx.createLinearGradient(0, H * 0.4, 0, H); vg.addColorStop(0, rgba(fc, 0)); vg.addColorStop(1, rgba(fc, a * 0.9)); fx.fillStyle = vg; fx.fillRect(0, H * 0.4, Wd, H * 0.6);
    }
    // rain: far, middle and near layers; the wind slants it
    const rainOn = ["rain", "drizzle", "storm"].includes(kind) && p.weather.rain > 0;
    const nRain = rainOn ? Math.round((kind === "drizzle" ? 70 : 90 + 200 * W.weather.intensity) * Math.min(1.5, p.weather.rain)) : 0;
    spawn(rain, moving || !rain.length ? nRain : rain.length, () => { const z = Math.random(); return { x: Math.random() * 1.2 - 0.1, y: Math.random(), z }; });
    if (rain.length) {
      const slant = wx * wind * 0.5, rc = mix([200, 215, 235], W.pal.light, 0.2);
      for (let layer = 0; layer < 3; layer++) {
        fx.beginPath();
        for (const d of rain) {
          if (Math.floor(d.z * 3) !== layer) continue;
          const len = H * (kind === "drizzle" ? 0.012 : 0.03) * (0.5 + d.z), vy = (0.55 + d.z * 0.9) * (kind === "drizzle" ? 0.55 : 1);
          if (moving) { d.y += vy * dt; d.x += vy * dt * slant * (H / Wd); if (d.y > 1.02) { d.y = -0.05; d.x = Math.random() * 1.2 - 0.1; } }
          const X = d.x * Wd, Y = d.y * H; fx.moveTo(X, Y); fx.lineTo(X - slant * len, Y - len);
        }
        fx.strokeStyle = rgba(rc, (0.1 + layer * 0.09) * (0.6 + 0.4 * W.dayL + 0.2)); fx.lineWidth = 0.6 + layer * 0.45; fx.stroke();
      }
    }
    // snow: flakes at different depths, drifting with the wind
    const snowOn = kind === "snow" && p.weather.snow > 0;
    spawn(snow, snowOn ? Math.round((70 + 150 * W.weather.intensity) * Math.min(1.5, p.weather.snow)) : 0, () => ({ x: Math.random(), y: Math.random(), z: 0.25 + Math.random() * 0.75, ph: Math.random() * 6.28 }));
    if (snow.length) {
      fx.fillStyle = rgba(mix([245, 248, 255], W.pal.light, 0.15), 0.85);
      fx.beginPath();
      for (const s of snow) {
        if (moving) { s.y += (0.03 + s.z * 0.06) * dt; s.x += (Math.sin(t * 0.0008 + s.ph) * 0.004 + wx * wind * 0.03 * s.z) * dt; if (s.y > 1.02) { s.y = -0.02; s.x = Math.random(); } if (s.x > 1.02) s.x = -0.02; if (s.x < -0.02) s.x = 1.02; }
        const r = 0.6 + s.z * 1.9; fx.moveTo(s.x * Wd + r, s.y * H); fx.arc(s.x * Wd, s.y * H, r, 0, Math.PI * 2);
      }
      fx.fill();
    }
    // seasonal bits in the air: fall leaves, spring petals, summer seeds (more when it's windy)
    const amount = p.season.particles * (moving ? 1 : 0.6);
    const season = W.snowy && kind === "snow" ? "winter" : W.season;
    const nBits = amount <= 0 || season === "winter" || rainOn ? 0 : Math.round(Math.min(18, (season === "fall" ? 3 + wind * 9 : season === "spring" ? 2 + wind * 6 : 4 + wind * 3) * amount));
    const leafCols = { fall: ["#d9722b", "#c2412d", "#e6a83a", "#b8562a"], spring: ["#f7c9da", "#fbe4ee", "#f3b1c9", "#ffffff"], summer: ["#f4f0d0", "#fffbe6"] }[season] ?? ["#ffffff"];
    spawn(bits, nBits, () => ({ x: Math.random(), y: Math.random() * 0.9, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 3, ph: Math.random() * 6.28, s: 0.6 + Math.random() * 0.8, c: leafCols[Math.floor(Math.random() * leafCols.length)] }));
    for (const b of bits) {
      if (moving) { b.x += (wx * (0.02 + wind * 0.09) + Math.sin(t * 0.0012 + b.ph) * 0.01) * dt; b.y += (season === "summer" ? Math.sin(t * 0.0006 + b.ph) * 0.004 - 0.002 : 0.035 + Math.sin(t * 0.002 + b.ph) * 0.02) * dt; b.rot += b.vr * dt * (0.5 + wind); if (b.x > 1.05) { b.x = -0.05; b.y = Math.random() * 0.8; } if (b.x < -0.05) { b.x = 1.05; b.y = Math.random() * 0.8; } if (b.y > 1.02) { b.y = -0.02; b.x = Math.random(); } if (b.y < -0.05) b.y = 1; }
      const X = b.x * Wd, Y = b.y * H, c = mix(hex(b.c), [10, 14, 34], (1 - W.dayL) * 0.6);
      fx.save(); fx.translate(X, Y); fx.rotate(b.rot);
      if (season === "summer") { fx.fillStyle = rgba(c, 0.55); fx.beginPath(); fx.arc(0, 0, 1.2 * b.s, 0, Math.PI * 2); fx.fill(); }
      else { fx.scale(1, Math.abs(Math.sin(t * 0.003 + b.ph)) * 0.7 + 0.3); fx.fillStyle = rgba(c, 0.9); fx.beginPath(); fx.ellipse(0, 0, (season === "fall" ? 4 : 2.6) * b.s, (season === "fall" ? 2.2 : 1.6) * b.s, 0, 0, Math.PI * 2); fx.fill(); }
      fx.restore();
    }
    // grass in the foreground, swaying with the wind
    if (p.scenery.grass && W.scene !== "none") {
      if (!grass) makeGrass();
      const cols = grassColors(), lean = wx * wind * 0.32, amp = 0.05 + wind * 0.12;
      for (let v = 0; v < 3; v++) {
        fx.beginPath();
        for (const b of grass) {
          if (b.v !== v) continue;
          const x0 = b.x * Wd, h = b.h * H * (W.snowy ? 0.55 : 1), a = b.lean + lean + (moving ? Math.sin(t * 0.0016 + b.ph + b.x * 6) * amp : 0);
          const tx = x0 + Math.sin(a) * h, ty = H - Math.cos(a) * h, w = b.w * Wd;
          fx.moveTo(x0 - w, H); fx.quadraticCurveTo(x0 + Math.sin(a) * h * 0.4, H - h * 0.55, tx, ty); fx.quadraticCurveTo(x0 + Math.sin(a) * h * 0.4 + w * 0.5, H - h * 0.5, x0 + w, H);
        }
        fx.fillStyle = rgba(cols[v]); fx.fill();
      }
      if (W.snowy) { const sg = fx.createLinearGradient(0, H * 0.965, 0, H); sg.addColorStop(0, rgba(lit(hex("#f4f7fb"), 0, W), 0)); sg.addColorStop(0.4, rgba(lit(hex("#f4f7fb"), 0, W), 0.9)); fx.fillStyle = sg; fx.fillRect(0, H * 0.965, Wd, H * 0.035); }
      // after rain in the sun: a faint glisten on the blades
      if (W.wet && W.sunVisible && !rainOn && moving) { fx.globalCompositeOperation = "lighter"; for (let i = 0; i < 12; i++) { const b = grass[(i * 13 + Math.floor(t / 900)) % grass.length], a = Math.max(0, Math.sin(t * 0.004 + i)) ** 4; fx.fillStyle = rgba([255, 255, 240], 0.6 * a); fx.fillRect(b.x * Wd, H - b.h * H, 1.5, 1.5); } fx.globalCompositeOperation = "source-over"; }
    }
    // raindrops beading on the glass and sliding down, leaving a trail
    const dropsOn = rainOn && p.weather.droplets > 0 && moving;
    if (dropsOn && t > nextDrop && drops.length < Math.round(7 * p.weather.droplets)) { drops.push({ x: 0.05 + Math.random() * 0.9, y: Math.random() * 0.65, r: 2 + Math.random() * 3.5, vy: 0, hold: 0.6 + Math.random() * 2.5, trail: [] }); nextDrop = t + (1500 + Math.random() * 3000) / Math.max(0.3, p.weather.droplets); }
    if (!dropsOn && drops.length && !moving) { /* keep a still painting */ } else if (!dropsOn) drops.length = 0;
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      if (moving) { d.hold -= dt; if (d.hold <= 0) { d.vy = Math.min(0.09, d.vy + dt * 0.05); d.y += d.vy * dt; d.x += Math.sin(d.y * 40) * 0.0004; if (Math.random() < dt * 0.4) d.hold = 0.2 + Math.random() * 0.8, d.vy = 0; } d.trail.push([d.x, d.y]); if (d.trail.length > 60) d.trail.shift(); if (d.y > 1.05) { drops.splice(i, 1); continue; } }
      const X = d.x * Wd, Y = d.y * H;
      if (d.trail.length > 2) { fx.strokeStyle = rgba([230, 238, 255], 0.09); fx.lineWidth = d.r * 0.5; fx.beginPath(); d.trail.forEach(([a, b], k) => (k ? fx.lineTo(a * Wd, b * H) : fx.moveTo(a * Wd, b * H))); fx.stroke(); }
      const dg = fx.createRadialGradient(X - d.r * 0.3, Y - d.r * 0.35, 0, X, Y, d.r);
      dg.addColorStop(0, rgba([255, 255, 255], 0.28)); dg.addColorStop(0.55, rgba(mix(W.pal.hor, [255, 255, 255], 0.4), 0.1)); dg.addColorStop(0.85, rgba([255, 255, 255], 0.22)); dg.addColorStop(1, rgba([10, 14, 30], 0.12));
      fx.fillStyle = dg; fx.beginPath(); fx.ellipse(X, Y, d.r * 0.9, d.r, 0, 0, Math.PI * 2); fx.fill();
    }
    // a soft lightning flash now and then (never more than one every ~20 s)
    if (kind === "storm" && p.weather.lightning && moving) {
      if (!flash && t > nextFlash) { flash = { at: t }; nextFlash = t + 20_000 + Math.random() * 25_000; }
      if (flash) { const e = (t - flash.at) / 1000, a = e < 0.08 ? e / 0.08 : Math.exp(-(e - 0.08) * 7) + (e > 0.14 && e < 0.22 ? 0.35 : 0); fx.fillStyle = rgba([220, 228, 255], 0.11 * Math.min(1, a)); fx.fillRect(0, 0, Wd, H); if (e > 0.9) flash = null; }
    }
  }

  // ---------------------------------------------------------------------------------------------------- data and live updates
  async function getJSON(path) { try { const r = await fetch(path); return r.ok ? await r.json() : null; } catch { return null; } }
  async function loadPrefs() { const r = await getJSON("/api/sky"); if (r?.prefs) { prefs = deep(DEFAULTS, r.prefs); presets = r.presets ?? presets; } resolve(); }
  async function loadAmbient() { const r = await getJSON("/api/ambient"); if (r) amb = r; resolve(); }
  function showPreview(look) {
    preview = { ...look, until: Date.now() + (look.seconds ?? 20) * 1000 };
    const words = [look.scene && `${look.scene} scene`, look.sky, look.weather === "partly" ? "partly cloudy" : look.weather, look.season].filter(Boolean).join(" · ");
    pill.textContent = `Preview: ${words}`; pill.hidden = false;
    landKey = ""; cloudKey = ""; resolve();
    clearTimeout(showPreview._t); showPreview._t = setTimeout(() => { preview = null; pill.hidden = true; landKey = ""; cloudKey = ""; resolve(); }, (look.seconds ?? 20) * 1000);
  }
  function attach(es) {
    if (!es || attach.done === es) return; attach.done = es;
    es.addEventListener("sky", (e) => { try { const d = JSON.parse(e.data); prefs = deep(DEFAULTS, d.prefs); landKey = ""; cloudKey = ""; resolve(); } catch { /* ignore */ } });
    es.addEventListener("ambient", () => { loadAmbient(); });
    es.addEventListener("ambient-preview", (e) => { try { showPreview(JSON.parse(e.data)); } catch { /* ignore */ } });
  }
  if (window.dsEvents) attach(window.dsEvents);
  window.addEventListener("ds-events", (e) => attach(e.detail));
  // a page without the display's own connection (e.g. tested on its own) listens by itself
  setTimeout(() => { if (!attach.done && !document.getElementById("clock")) attach(new EventSource("/api/events")); }, 3000);
  // schedule-aware vibes: study → Focus, faith → Calm… (the owner's map in Settings)
  async function checkSchedule() {
    if (!prefs.schedule?.on) { if (schedPreset) { schedPreset = null; resolve(); } return; }
    const d = new Date(), iso = d.toLocaleDateString("en-CA"), hm = d.toTimeString().slice(0, 5);
    const r = await getJSON(`/api/calendar?from=${iso}&to=${iso}`);
    const b = r?.days?.[0]?.blocks?.find((x) => x.start <= hm && hm < x.end);
    const want = (b && prefs.schedule.map?.[b.category]) || null;
    if (want !== schedPreset) { schedPreset = want; landKey = ""; cloudKey = ""; resolve(); }
  }

  // the 🎨 button by the clock opens Settings → Sky & scenery
  const util = document.querySelector(".calbtns .util");
  if (util && !document.getElementById("skyBtn")) {
    const b = Object.assign(document.createElement("button"), { id: "skyBtn", className: "skybtn", title: "Sky & scenery", type: "button" });
    b.innerHTML = '<i aria-hidden="true">🎨</i>Sky';
    b.onclick = () => (window.dsOpenPage ? window.dsOpenPage("/setup?embed=1&s=sky") : (location.href = "/setup?s=sky"));
    util.insertBefore(b, util.firstChild);
  }
  // for tests and the Settings preview
  window.dsSkyDebug = { resolve: () => resolve(), state: () => W && { elev: W.elev, am: W.am, kind: W.weather.kind, season: W.season, scene: W.scene, bright: W.bright, glass: getComputedStyle(document.documentElement).getPropertyValue("--glass"), stars: W.stars, cover: W.cover, wind: W.windMph, frameMs: window.dsSkyFrameMs }, preview: showPreview };

  size(); resolve(); loadPrefs(); loadAmbient();
  setInterval(loadAmbient, 12 * 60_000);
  setInterval(checkSchedule, 60_000); setTimeout(checkSchedule, 4000);
  requestAnimationFrame(frame);
})();
