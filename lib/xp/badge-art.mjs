// Badge art: every one of the 18 × 18 badges is drawn here as SVG, deterministically, from three things:
//   the category's palette and emblem (which evolves over three detail levels as tiers climb),
//   the tier's frame shape and accent motifs (circle → hexagon → scalloped medallion → shield → star → crest → sunburst
//   → quatrefoil → gothic arch → celestial ring → winged frames → the legendary cosmic frame),
//   and the tier's colour story (matte → metal → jewel → iridescent → prismatic → cosmic).
// Motion is built into the SVG (CSS keyframes on transform/opacity, plus SMIL for gradients in the full view), with no
// script, so it works inline or as an <img>. mode "grid" = light motion; "full" = everything (detail view, the reveal).
//   svg(category, tier, { size = 160, mode = "full" | "grid" | "static", uid })
import { BADGE_CATEGORIES, NAMES, TIERS } from "./badges.mjs";

// ---- palettes: primary, secondary, accent, metal tint, two glows, deep ----------------------------------------------
export const PALETTES = {
  workout:     { p: "#E4572E", s: "#F3A712", a: "#FFE08A", m: "#D9A066", g1: "#FF7B39", g2: "#FFE29A", d: "#4A1206" },
  sports:      { p: "#1F77D0", s: "#2EC4B6", a: "#E8F6FF", m: "#A7BCD0", g1: "#56CCF2", g2: "#B8F2E6", d: "#08223F" },
  worship:     { p: "#6A4C9C", s: "#E9C46A", a: "#FFF6D5", m: "#E2C27A", g1: "#FFE8A3", g2: "#C9B6FF", d: "#211335" },
  prayer:      { p: "#3A6EA5", s: "#F2D0A4", a: "#FFFFFF", m: "#DCC795", g1: "#FFF1C1", g2: "#A7C7E7", d: "#101D34" },
  eating:      { p: "#2E9E6E", s: "#EF4444", a: "#F9D95C", m: "#B5C99A", g1: "#90BE6D", g2: "#FFE27A", d: "#113524" },
  chore:       { p: "#1B98E0", s: "#7FDBFF", a: "#FFFFFF", m: "#A9D6E5", g1: "#CAF0F8", g2: "#90E0EF", d: "#062C5A" },
  study:       { p: "#1F5F6B", s: "#2A9D8F", a: "#F2CC6B", m: "#D4AF37", g1: "#8AB6D6", g2: "#FFE8A3", d: "#0A1A26" },
  reading:     { p: "#8C4A2F", s: "#D9A566", a: "#F7E6C4", m: "#C08552", g1: "#FFD89C", g2: "#F6BD60", d: "#2E170D" },
  practice:    { p: "#8E3FD6", s: "#F72585", a: "#6FE3FF", m: "#CFCFE8", g1: "#E0AAFF", g2: "#FF8FC8", d: "#1E0340" },
  call:        { p: "#D62839", s: "#FF8FA3", a: "#FFE0E8", m: "#E8B4B8", g1: "#FFB3C1", g2: "#FFE5EC", d: "#4A0716" },
  writing:     { p: "#2F3350", s: "#7C8AA8", a: "#EDF2F4", m: "#B08D57", g1: "#A5B4FC", g2: "#EF476F", d: "#0C0D18" },
  outdoors:    { p: "#2D6A4F", s: "#74C69D", a: "#FFB703", m: "#A7C957", g1: "#FFD166", g2: "#B7E4C7", d: "#06170F" },
  sleep:       { p: "#2A2A52", s: "#5A5F8A", a: "#F5ECD7", m: "#C9ADA7", g1: "#9A8CFF", g2: "#FFF1C1", d: "#090918" },
  cooking:     { p: "#E0762F", s: "#C8553D", a: "#FFF3B0", m: "#B9BBA8", g1: "#FFB870", g2: "#FFE8D6", d: "#4A200F" },
  volunteer:   { p: "#E76F6A", s: "#F6BD60", a: "#FFF4E6", m: "#E9B872", g1: "#FFD6A5", g2: "#FFC8DD", d: "#5A1D2B" },
  art:         { p: "#E0006B", s: "#3A86FF", a: "#FFBE0B", m: "#8338EC", g1: "#FB5607", g2: "#06D6A0", d: "#1A0033" },
  mindfulness: { p: "#3F9E8F", s: "#CDB4DB", a: "#FFF1E6", m: "#B8C0B5", g1: "#BDE0FE", g2: "#FFC8DD", d: "#12302C" },
  work:        { p: "#1D3557", s: "#457B9D", a: "#F1FAEE", m: "#D4AF37", g1: "#A8DADC", g2: "#FFD166", d: "#080F1C" },
};

// ---- tier stories ---------------------------------------------------------------------------------------------------
// metal: the frame's gradient family · frame: the silhouette · motifs: accents · lvl: emblem detail level (1–3)
const METALS = {
  matte:    (pal) => [pal.s, pal.p, pal.d],
  bronze:   () => ["#F4C28A", "#B8733A", "#6B3A17"],
  silver:   () => ["#FFFFFF", "#B9C3CE", "#5E6B78"],
  gold:     () => ["#FFF3B0", "#E1B12C", "#8A5A00"],
  rosegold: () => ["#FFE3D8", "#D99A87", "#7E4536"],
  platinum: () => ["#FFFFFF", "#DDE6EE", "#8C9AA8"],
  iridescent: () => ["#FFE1F5", "#C9F2FF", "#D8C8FF", "#FFF6C8"],
  prismatic:  () => ["#FF7AA2", "#FFD166", "#7CF3B8", "#6FC3FF", "#B18CFF"],
  cosmic:     () => ["#FFF6D6", "#FFB7E0", "#8FD3FF", "#B78CFF", "#FFE08A"],
};
const TIER = [
  null,
  { frame: "circle",    metal: "matte",   rims: 0, pips: 1 },
  { frame: "circle",    metal: "matte",   rims: 1, pips: 2 },
  { frame: "circle",    metal: "matte",   rims: 2, pips: 3 },
  { frame: "hexagon",   metal: "bronze",  rims: 1, pips: 4 },
  { frame: "octagon",   metal: "silver",  rims: 1, pips: 5 },
  { frame: "scallop",   metal: "gold",    rims: 1, pips: 6 },
  { frame: "shield",    metal: "gold",    rims: 1, ribbon: 1, stars: 1 },
  { frame: "shield",    metal: "rosegold", rims: 1, ribbon: 1, stars: 2, laurel: 1 },
  { frame: "star",      metal: "gold",    rims: 1, ribbon: 1, stars: 3, laurel: 1 },
  { frame: "crest",     metal: "platinum", rims: 2, ribbon: 1, stars: 3, laurel: 2, ticks: 1 },
  { frame: "sunburst",  metal: "gold",    rims: 2, ribbon: 1, stars: 3, laurel: 2, ticks: 1, rays: 1 },
  { frame: "quatrefoil", metal: "rosegold", rims: 2, ribbon: 1, stars: 3, laurel: 2, ticks: 2, rays: 1 },
  { frame: "gothic",    metal: "iridescent", rims: 2, ribbon: 1, stars: 3, laurel: 2, gems: 2, rays: 1, filigree: 0 },
  { frame: "celestial", metal: "iridescent", rims: 2, ribbon: 1, stars: 3, laurel: 2, gems: 4, rays: 2, filigree: 1 },
  { frame: "celestial", metal: "platinum", rims: 3, ribbon: 1, stars: 3, laurel: 2, gems: 6, rays: 2, filigree: 1 },
  { frame: "wingedShield", metal: "prismatic", rims: 2, ribbon: 1, stars: 3, laurel: 2, gems: 4, rays: 2, filigree: 1, wings: 1, crown: 1, aura: 1 },
  { frame: "wingedCrest", metal: "prismatic", rims: 3, ribbon: 1, stars: 3, laurel: 2, gems: 6, rays: 3, filigree: 1, wings: 2, crown: 2, aura: 1 },
  { frame: "legend",    metal: "cosmic",  rims: 3, ribbon: 1, stars: 5, laurel: 2, gems: 8, rays: 3, filigree: 1, wings: 2, crown: 2, aura: 2, nebula: 1, particles: 1 },
];
const HALO = new Set(["prayer", "worship", "mindfulness", "volunteer"]);
const LAURELCROWN = new Set(["workout", "sports", "outdoors"]);

// ---- small geometry helpers ------------------------------------------------------------------------------------------
const f = (n) => Math.round(n * 10) / 10;
const polar = (cx, cy, r, a) => [f(cx + r * Math.cos(a)), f(cy + r * Math.sin(a))];
function poly(n, r, rot = -Math.PI / 2, cx = 100, cy = 100) { const pts = []; for (let i = 0; i < n; i++) pts.push(polar(cx, cy, r, rot + (i * 2 * Math.PI) / n).join(",")); return `M${pts.join("L")}Z`; }
function roundPoly(n, r, round = 0.18, rot = -Math.PI / 2, cx = 100, cy = 100) {
  const P = []; for (let i = 0; i < n; i++) P.push(polar(cx, cy, r, rot + (i * 2 * Math.PI) / n));
  let d = "";
  for (let i = 0; i < n; i++) {
    const [x0, y0] = P[(i - 1 + n) % n], [x1, y1] = P[i], [x2, y2] = P[(i + 1) % n];
    const a = [f(x1 + (x0 - x1) * round), f(y1 + (y0 - y1) * round)], b = [f(x1 + (x2 - x1) * round), f(y1 + (y2 - y1) * round)];
    d += `${i ? "L" : "M"}${a.join(",")}Q${x1},${y1} ${b.join(",")}`;
  }
  return d + "Z";
}
function star(n, ro, ri, rot = -Math.PI / 2, cx = 100, cy = 100) { const pts = []; for (let i = 0; i < n * 2; i++) pts.push(polar(cx, cy, i % 2 ? ri : ro, rot + (i * Math.PI) / n).join(",")); return `M${pts.join("L")}Z`; }
function scallop(n, r, bump) { let d = ""; for (let i = 0; i < n; i++) { const a0 = (i * 2 * Math.PI) / n - Math.PI / 2, a1 = ((i + 1) * 2 * Math.PI) / n - Math.PI / 2, am = (a0 + a1) / 2; const p0 = polar(100, 100, r, a0), p1 = polar(100, 100, r, a1), c = polar(100, 100, r + bump * 2, am); d += `${i ? "" : `M${p0.join(",")}`}Q${c.join(",")} ${p1.join(",")}`; } return d + "Z"; }
const SHIELD = "M100,14 C128,22 150,24 170,22 C172,92 156,150 100,186 C44,150 28,92 30,22 C50,24 72,22 100,14Z";
const CREST = "M100,10 L116,26 C136,22 156,24 174,18 C176,94 158,152 100,188 C42,152 24,94 26,18 C44,24 64,22 84,26Z";
const QUATRE = (() => { let d = ""; const r = 44, c = 46; for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2 - Math.PI / 2; const [x, y] = polar(100, 100, c, a); d += `M${f(x + r)},${f(y)}A${r},${r} 0 1,0 ${f(x - r)},${f(y)}A${r},${r} 0 1,0 ${f(x + r)},${f(y)}Z`; } return d; })();
const GOTHIC = "M100,8 C132,40 168,60 172,104 C176,150 142,186 100,190 C58,186 24,150 28,104 C32,60 68,40 100,8Z";

function framePath(kind) {
  switch (kind) {
    case "hexagon": return roundPoly(6, 84, 0.16, -Math.PI / 2);
    case "octagon": return roundPoly(8, 86, 0.14, -Math.PI / 8 - Math.PI / 2);
    case "scallop": return scallop(16, 80, 4.2);
    case "shield": case "wingedShield": return SHIELD;
    case "crest": case "wingedCrest": return CREST;
    case "star": return star(8, 94, 76);
    case "sunburst": return star(16, 92, 80);
    case "quatrefoil": return QUATRE;
    case "gothic": return GOTHIC;
    case "celestial": case "legend": return star(12, 94, 82);
    default: return null;                         // circle
  }
}

// ---- emblems: each category's signature art at three detail levels (drawn in a 100×100 box, centred) --------------
// c = { fg (main colour), hi (highlight), ac (accent), dk (dark), id (gradient id prefix) }
const EMB = {
  workout(l, c) {
    const bar = `<rect x="22" y="46" width="56" height="8" rx="3" fill="${c.fg}"/>`;
    const plate = (x, h) => `<rect x="${x}" y="${50 - h / 2}" width="9" height="${h}" rx="3" fill="${c.fg}"/><rect x="${x + 1.5}" y="${50 - h / 2 + 2}" width="2.5" height="${h - 4}" rx="1.2" fill="${c.hi}" opacity=".55"/>`;
    let g = bar + plate(12, 34) + plate(22, 26) + plate(69, 26) + plate(79, 34);
    if (l >= 2) g += `<g class="e-speed" stroke="${c.ac}" stroke-width="3" stroke-linecap="round" opacity=".9"><path d="M8 22h14"/><path d="M4 30h12"/><path d="M84 70h12"/><path d="M80 78h14"/></g>`;
    if (l >= 3) g = `<path class="e-flame" d="M50 8c8 12 18 16 14 30 6-4 8-10 8-16 8 10 10 22 4 32H24c-6-12 0-24 10-30-2 8 2 12 6 14-4-14 4-22 10-30z" fill="${c.ac}" opacity=".85"/>` + g;
    return g;
  },
  sports(l, c) {
    let g = `<circle cx="50" cy="52" r="30" fill="${c.fg}"/><path d="M22 44c12 4 22 16 24 36M78 44c-12 4-22 16-24 36M28 30c14 8 30 8 44 0" fill="none" stroke="${c.dk}" stroke-width="3.2" stroke-linecap="round" opacity=".55"/><ellipse cx="40" cy="38" rx="9" ry="5" fill="${c.hi}" opacity=".5" transform="rotate(-30 40 38)"/>`;
    g = `<g class="e-spin">${g}</g>`;
    if (l >= 2) g = `<path d="M26 12h48v10c0 16-10 26-24 28-14-2-24-12-24-28z" fill="${c.ac}" opacity=".35"/>` + g;
    if (l >= 3) g += `<path d="M50 4l4 8 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1z" fill="${c.ac}"/>`;
    return g;
  },
  worship(l, c) {
    let g = `<path d="M22 86V52L50 30l28 22v34z" fill="${c.fg}"/><rect x="44" y="64" width="12" height="22" rx="6" fill="${c.dk}" opacity=".55"/><path d="M50 30V10M43 17h14" stroke="${c.ac}" stroke-width="4" stroke-linecap="round"/><circle cx="50" cy="48" r="5" fill="${c.hi}" opacity=".8"/>`;
    if (l >= 2) g = `<path d="M8 86V62l14-10v34zM92 86V62L78 52v34z" fill="${c.fg}" opacity=".7"/>` + g;
    if (l >= 3) g = `<g class="e-rays" opacity=".55">${Array.from({ length: 9 }, (_, i) => `<path d="M50 10 L${f(50 + 44 * Math.cos(Math.PI + (i * Math.PI) / 8))} ${f(10 + 44 * Math.sin(Math.PI + (i * Math.PI) / 8) * -1)}" stroke="${c.ac}" stroke-width="2"/>`).join("")}</g>` + g;
    return g;
  },
  prayer(l, c) {
    let g = `<path d="M50 14c-4 10-12 22-12 36v18l-10 10c-2 2 0 6 3 6h19V26c0-6 0-9 0-12z" fill="${c.fg}"/><path d="M50 14c4 10 12 22 12 36v18l10 10c2 2 0 6-3 6H50V26c0-6 0-9 0-12z" fill="${c.hi}" opacity=".92"/><path d="M50 26v58" stroke="${c.dk}" stroke-width="1.6" opacity=".45"/>`;
    if (l >= 2) g = `<circle cx="50" cy="40" r="30" fill="${c.ac}" opacity=".18" class="e-glow"/>` + g;
    if (l >= 3) g += `<path class="e-dove" d="M70 16c6-2 12 0 16 4-5 0-8 2-10 5 4 1 6 4 6 7-6-3-12-3-16 0 0-6 1-12 4-16z" fill="${c.a2}" opacity=".95"/>`;
    return g;
  },
  eating(l, c) {
    let g = `<path d="M50 30c-10-8-30-6-32 14-2 18 12 40 26 40 3 0 5-2 6-2s3 2 6 2c14 0 28-22 26-40-2-20-22-22-32-14z" fill="${c.fg}"/><path d="M34 44c-2 10 2 22 8 28" stroke="${c.hi}" stroke-width="4" fill="none" stroke-linecap="round" opacity=".6"/><path d="M50 30c0-8 2-14 6-18" stroke="${c.dk}" stroke-width="3.5" stroke-linecap="round"/>`;
    g += `<path class="e-leaf" d="M56 18c8-8 20-8 24-4-6 8-16 10-24 4z" fill="${c.ac}"/>`;
    if (l >= 2) g += `<circle cx="26" cy="24" r="5" fill="${c.ac}" opacity=".85"/><circle cx="80" cy="38" r="4" fill="${c.hi}" opacity=".85"/>`;
    if (l >= 3) g = `<path d="M10 70c20 14 60 14 80 0" stroke="${c.ac}" stroke-width="4" fill="none" opacity=".6" stroke-linecap="round"/>` + g;
    return g;
  },
  chore(l, c) {
    let g = `<path d="M62 8l8 3-14 44-8-3z" fill="${c.dk}" opacity=".85"/><path d="M40 50l20 7c4 10 2 22-4 32l-34-12c4-12 10-22 18-27z" fill="${c.fg}"/><path d="M28 78l6-16M36 82l6-18M44 85l5-18" stroke="${c.hi}" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>`;
    g += `<g class="e-glint" fill="${c.ac}"><path d="M78 30l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>${l >= 2 ? `<path d="M22 22l1.5 4.5 4.5 1.5-4.5 1.5-1.5 4.5-1.5-4.5-4.5-1.5 4.5-1.5z"/>` : ""}${l >= 3 ? `<path d="M84 64l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z"/><circle cx="16" cy="48" r="3"/>` : ""}</g>`;
    return g;
  },
  study(l, c) {
    let g = `<path d="M50 20L8 38l42 18 42-18z" fill="${c.fg}"/><path d="M26 46v16c0 8 48 8 48 0V46L50 56z" fill="${c.dk}" opacity=".8"/><path d="M50 20L8 38l42 18" fill="${c.hi}" opacity=".25"/><path d="M84 42v22" stroke="${c.ac}" stroke-width="3"/><circle cx="84" cy="68" r="5" fill="${c.ac}"/>`;
    if (l >= 2) g += `<g class="e-twinkle" fill="${c.ac}"><path d="M16 12l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/><path d="M78 8l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z"/></g>`;
    if (l >= 3) g += `<path d="M22 78h56l-4 10H26z" fill="${c.fg}" opacity=".8"/><path d="M28 76h44" stroke="${c.ac}" stroke-width="2"/>`;
    return g;
  },
  reading(l, c) {
    let g = `<path d="M50 30c-10-8-26-10-40-6v54c14-4 30-2 40 6z" fill="${c.fg}"/><path d="M50 30c10-8 26-10 40-6v54c-14-4-30-2-40 6z" fill="${c.hi}"/><path d="M50 30v54" stroke="${c.dk}" stroke-width="2"/><path d="M18 38c8-2 16-1 24 2M18 48c8-2 16-1 24 2M18 58c8-2 16-1 24 2M58 40c8-3 16-4 24-2M58 50c8-3 16-4 24-2" stroke="${c.dk}" stroke-width="1.6" opacity=".35"/>`;
    if (l >= 2) g += `<path class="e-page" d="M50 30c8-10 18-14 30-14v8c-12 0-22 4-30 12z" fill="${c.a2}" opacity=".9"/>`;
    if (l >= 3) g = `<circle cx="50" cy="40" r="34" fill="${c.ac}" opacity=".2" class="e-glow"/><g fill="${c.ac}" opacity=".8" class="e-twinkle"><circle cx="20" cy="18" r="2"/><circle cx="84" cy="14" r="2.4"/><circle cx="90" cy="30" r="1.6"/></g>` + g;
    return g;
  },
  practice(l, c) {
    let g = `<path d="M40 22l38-10v48" fill="none" stroke="${c.fg}" stroke-width="7" stroke-linejoin="round"/><ellipse cx="30" cy="70" rx="12" ry="9" fill="${c.fg}" transform="rotate(-20 30 70)"/><ellipse cx="68" cy="60" rx="12" ry="9" fill="${c.fg}" transform="rotate(-20 68 60)"/><path d="M40 22v48" stroke="${c.fg}" stroke-width="7"/><path d="M40 32l38-10" stroke="${c.hi}" stroke-width="3" opacity=".6"/>`;
    if (l >= 2) g += `<g class="e-float" fill="${c.ac}"><path d="M86 26c0-4 6-6 6-2v14" stroke="${c.ac}" stroke-width="2.5" fill="none"/><circle cx="88" cy="40" r="3.5"/></g>`;
    if (l >= 3) g += `<g class="e-eq" fill="${c.a2}">${[8, 14, 20, 26].map((x, i) => `<rect x="${x}" y="${88 - (6 + i * 3)}" width="4" height="${6 + i * 3}" rx="1.5" class="eq${i}"/>`).join("")}</g>`;
    return g;
  },
  call(l, c) {
    const heart = (x, y, s, fill) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -6c-3-8-16-8-16 2 0 9 12 14 16 20 4-6 16-11 16-20 0-10-13-10-16-2z" fill="${fill}"/>`;
    let g = `<g class="e-beat">${heart(38, 50, 1.55, c.fg)}${heart(64, 54, 1.4, c.hi)}</g>`;
    if (l >= 2) g += `<path d="M44 44c4-4 10-4 14 0" stroke="${c.ac}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    if (l >= 3) g = `<circle cx="50" cy="52" r="36" fill="${c.ac}" opacity=".2" class="e-glow"/>` + g + heart(80, 22, 0.6, c.ac) + heart(20, 24, 0.5, c.ac);
    return g;
  },
  writing(l, c) {
    let g = `<path d="M84 10C60 14 36 34 28 72l6 2c6-10 14-18 22-24-6 0-10 2-14 4 10-16 26-30 42-44z" fill="${c.hi}"/><path d="M84 10C66 20 48 40 36 70" stroke="${c.dk}" stroke-width="2" fill="none" opacity=".5"/><path d="M28 72l-4 14 10-10z" fill="${c.fg}"/>`;
    if (l >= 2) g += `<path class="e-ink" d="M12 88c10-8 22 6 34-2s16-10 26-4" stroke="${c.ac}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    if (l >= 3) g = `<path d="M14 20h40M14 30h32M14 40h24" stroke="${c.fg}" stroke-width="3" stroke-linecap="round" opacity=".5"/>` + g;
    return g;
  },
  outdoors(l, c) {
    let g = `<circle class="e-sun" cx="70" cy="28" r="12" fill="${c.ac}"/><path d="M6 86l30-44 16 22 12-16 30 38z" fill="${c.fg}"/><path d="M36 42l8 12-6-2-4 6-4-4z" fill="${c.a}" opacity=".9"/>`;
    if (l >= 2) g += `<g class="e-drift" fill="${c.hi}" opacity=".85"><ellipse cx="26" cy="22" rx="12" ry="5"/><ellipse cx="34" cy="18" rx="8" ry="5"/></g>`;
    if (l >= 3) g += `<path d="M78 86V62M78 58l-10 14h20zM78 50l-8 12h16z" fill="${c.dk}" stroke="${c.dk}" stroke-width="2"/>`;
    return g;
  },
  sleep(l, c) {
    let g = `<path d="M60 14c-20 4-34 22-30 42 4 22 26 36 48 30-24-2-40-22-36-44 2-12 8-22 18-28z" fill="${c.a}"/><circle cx="46" cy="44" r="3" fill="${c.dk}" opacity=".15"/><circle cx="54" cy="64" r="4" fill="${c.dk}" opacity=".12"/>`;
    g += `<g class="e-twinkle" fill="${c.ac}"><path d="M74 26l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>${l >= 2 ? `<path d="M84 50l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z"/><circle cx="70" cy="68" r="2"/>` : ""}</g>`;
    if (l >= 3) g = `<circle cx="50" cy="50" r="38" fill="${c.a2}" opacity=".18" class="e-glow"/>` + g + `<text x="72" y="92" font-size="12" font-family="Georgia,serif" fill="${c.ac}" opacity=".85">z z</text>`;
    return g;
  },
  cooking(l, c) {
    let g = `<path d="M26 50c-10 0-14-14-4-20 0-12 16-16 22-8 6-10 22-8 24 2 12-2 16 14 6 20v6H26z" fill="${c.a}"/><rect x="26" y="54" width="48" height="16" rx="3" fill="${c.hi}"/><path d="M34 54v16M50 54v16M66 54v16" stroke="${c.dk}" stroke-width="1.4" opacity=".25"/>`;
    g += `<g class="e-steam" stroke="${c.fg}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"><path d="M36 26c-4-6 4-10 0-16"/><path d="M52 22c-4-6 4-10 0-16"/>${l >= 2 ? `<path d="M68 26c-4-6 4-10 0-16"/>` : ""}</g>`;
    if (l >= 3) g += `<path d="M20 78h60c-2 8-10 12-30 12S22 86 20 78z" fill="${c.fg}"/>`;
    return g;
  },
  volunteer(l, c) {
    let g = `<path d="M10 70c10-4 22-4 30 2l12 6c4 2 2 8-2 7l-14-3" fill="none" stroke="${c.hi}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 70l8 16h20l24-8c6-2 20-10 26-16 3-3 0-8-4-6l-18 10" fill="none" stroke="${c.fg}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
    g += `<g class="e-beat"><path d="M50 22c-3-8-16-8-16 2 0 9 12 14 16 20 4-6 16-11 16-20 0-10-13-10-16-2z" fill="${c.ac}"/></g>`;
    if (l >= 2) g = `<circle cx="50" cy="36" r="22" fill="${c.a2}" opacity=".25" class="e-glow"/>` + g;
    if (l >= 3) g += `<g fill="${c.a2}" class="e-twinkle"><circle cx="24" cy="18" r="2.5"/><circle cx="78" cy="14" r="2.5"/><circle cx="84" cy="34" r="2"/></g>`;
    return g;
  },
  art(l, c) {
    let g = `<path d="M50 12C26 12 10 28 10 48c0 18 14 30 28 30 6 0 8-6 6-10-2-6 2-10 8-10h12c14 0 26-8 26-22C90 22 72 12 50 12z" fill="${c.hi}"/><circle cx="68" cy="60" r="0"/><g class="e-paint"><circle cx="30" cy="40" r="6" fill="${c.fg}"/><circle cx="46" cy="26" r="6" fill="${c.ac}"/><circle cx="66" cy="28" r="6" fill="${c.a2}"/><circle cx="76" cy="44" r="6" fill="${c.dk2}"/></g>`;
    if (l >= 2) g += `<path d="M58 88l28-40 6 4-26 40z" fill="${c.dk}"/><path d="M58 88l-6 8 12-4z" fill="${c.fg}"/>`;
    if (l >= 3) g = `<path class="e-stroke" d="M6 90c20-12 40 4 60-8" stroke="${c.a2}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".8"/>` + g;
    return g;
  },
  mindfulness(l, c) {
    const petal = (rot, fill, s = 1) => `<path transform="rotate(${rot} 50 70)" d="M50 70c-${8 * s}-14-${8 * s}-32 0-46 ${8 * s} 14 ${8 * s} 32 0 46z" fill="${fill}"/>`;
    let g = `<g class="e-breathe">${petal(-50, c.hi, 0.9)}${petal(50, c.hi, 0.9)}${petal(-25, c.fg)}${petal(25, c.fg)}${petal(0, c.ac)}</g><path d="M22 76c12 8 44 8 56 0" stroke="${c.dk}" stroke-width="3" fill="none" opacity=".4" stroke-linecap="round"/>`;
    if (l >= 2) g += `<g class="e-ripple" fill="none" stroke="${c.a2}" stroke-width="2" opacity=".6"><ellipse cx="50" cy="84" rx="34" ry="5"/><ellipse cx="50" cy="84" rx="22" ry="3"/></g>`;
    if (l >= 3) g = `<circle cx="50" cy="42" r="34" fill="${c.a2}" opacity=".2" class="e-glow"/>` + g;
    return g;
  },
  work(l, c) {
    let g = `<rect x="14" y="34" width="72" height="48" rx="7" fill="${c.fg}"/><path d="M38 34v-8c0-3 2-5 5-5h14c3 0 5 2 5 5v8" stroke="${c.fg}" stroke-width="5" fill="none"/><rect x="14" y="50" width="72" height="5" fill="${c.dk}" opacity=".4"/><rect x="44" y="48" width="12" height="10" rx="2" fill="${c.ac}"/><rect x="18" y="37" width="30" height="4" rx="2" fill="${c.hi}" opacity=".45"/>`;
    if (l >= 2) g += `<path class="e-chart" d="M18 96l16-12 12 6 20-18 18 4" stroke="${c.a2}" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 -8)"/>`;
    if (l >= 3) g += `<g class="e-coin"><circle cx="84" cy="22" r="10" fill="${c.ac}"/><circle cx="84" cy="22" r="7" fill="none" stroke="${c.dk}" stroke-width="1.5" opacity=".5"/><text x="80.5" y="26.5" font-size="11" font-family="Georgia,serif" font-weight="700" fill="${c.dk}" opacity=".6">$</text></g>`;
    return g;
  },
};

// ---- motion: category flavour × tier intensity --------------------------------------------------------------------
const CSS = `
.b svg,.b *{transform-box:fill-box;transform-origin:center}
@keyframes bBreath{0%,100%{opacity:.55}50%{opacity:1}}
@keyframes bPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
@keyframes bSpin{to{transform:rotate(360deg)}}
@keyframes bSpinR{to{transform:rotate(-360deg)}}
@keyframes bFloat{0%{transform:translateY(4px);opacity:0}30%{opacity:1}100%{transform:translateY(-10px);opacity:0}}
@keyframes bTwinkle{0%,100%{opacity:.25;transform:scale(.8)}50%{opacity:1;transform:scale(1.15)}}
@keyframes bSway{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(8deg)}}
@keyframes bDrift{0%,100%{transform:translateX(-4px)}50%{transform:translateX(5px)}}
@keyframes bSteam{0%{transform:translateY(3px);opacity:0}40%{opacity:.8}100%{transform:translateY(-8px);opacity:0}}
@keyframes bEq{0%,100%{transform:scaleY(.4)}50%{transform:scaleY(1)}}
@keyframes bFlap{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-7deg)}}
@keyframes bFlapR{0%,100%{transform:rotate(0deg)}50%{transform:rotate(7deg)}}
@keyframes bSheen{0%{transform:translateX(-140px)}60%,100%{transform:translateX(160px)}}
@keyframes bGlint{0%,80%,100%{opacity:0;transform:scale(.4)}88%{opacity:1;transform:scale(1.2)}}
@keyframes bWave{0%,100%{transform:skewY(0deg)}50%{transform:skewY(-2.5deg)}}
@keyframes bHue{0%{opacity:.35}50%{opacity:.8}100%{opacity:.35}}
@keyframes bRise{0%{transform:translateY(8px);opacity:0}20%{opacity:.9}100%{transform:translateY(-90px);opacity:0}}
@keyframes bPage{0%,60%,100%{transform:scaleX(1)}75%{transform:scaleX(-.2)}}
.b .glow{animation:bBreath 4s ease-in-out infinite}
.b .sheen{animation:bSheen 5.5s ease-in-out infinite}
.b .twinkle,.b .e-twinkle>*{animation:bTwinkle 2.6s ease-in-out infinite}
.b .e-twinkle>*:nth-child(2){animation-delay:.9s}.b .e-twinkle>*:nth-child(3){animation-delay:1.7s}
.b .ticks{animation:bSpin 60s linear infinite}
.b .rays{animation:bSpin 40s linear infinite}
.b .raysR{animation:bSpinR 70s linear infinite}
.b .ribbon{animation:bWave 3.2s ease-in-out infinite}
.b .gem{animation:bGlint 3.4s ease-in-out infinite}
.b .wingL{animation:bFlap 3s ease-in-out infinite;transform-origin:right center}
.b .wingR{animation:bFlapR 3s ease-in-out infinite;transform-origin:left center}
.b .crown{animation:bPulse 2.8s ease-in-out infinite}
.b .aura{animation:bHue 3.6s ease-in-out infinite}
.b .particle{animation:bRise 6s linear infinite}
.b .e-speed{animation:bDrift 1.4s ease-in-out infinite}
.b .e-flame{animation:bPulse 1.2s ease-in-out infinite}
.b .e-spin{animation:bSpin 9s linear infinite}
.b .e-rays{animation:bBreath 3.4s ease-in-out infinite}
.b .e-glow{animation:bBreath 3.8s ease-in-out infinite}
.b .e-dove{animation:bDrift 4s ease-in-out infinite}
.b .e-leaf{animation:bSway 3.4s ease-in-out infinite;transform-origin:left bottom}
.b .e-glint>*{animation:bGlint 2.8s ease-in-out infinite}.b .e-glint>*:nth-child(2){animation-delay:.9s}.b .e-glint>*:nth-child(3){animation-delay:1.8s}
.b .e-page{animation:bPage 4.5s ease-in-out infinite;transform-origin:left center}
.b .e-float{animation:bFloat 3.2s ease-in-out infinite}
.b .e-eq>*{animation:bEq 1.1s ease-in-out infinite;transform-origin:center bottom}.b .e-eq .eq1{animation-delay:.2s}.b .e-eq .eq2{animation-delay:.45s}.b .e-eq .eq3{animation-delay:.7s}
.b .e-beat{animation:bPulse 1.6s ease-in-out infinite}
.b .e-ink{animation:bDrift 3s ease-in-out infinite}
.b .e-sun{animation:bPulse 4s ease-in-out infinite}
.b .e-drift{animation:bDrift 6s ease-in-out infinite}
.b .e-steam>*{animation:bSteam 2.8s ease-in-out infinite}.b .e-steam>*:nth-child(2){animation-delay:.9s}.b .e-steam>*:nth-child(3){animation-delay:1.8s}
.b .e-paint>*{animation:bTwinkle 3s ease-in-out infinite}.b .e-paint>*:nth-child(2){animation-delay:.6s}.b .e-paint>*:nth-child(3){animation-delay:1.2s}.b .e-paint>*:nth-child(4){animation-delay:1.8s}
.b .e-stroke{animation:bHue 3s ease-in-out infinite}
.b .e-breathe{animation:bPulse 5s ease-in-out infinite}
.b .e-ripple{animation:bBreath 3s ease-in-out infinite}
.b .e-chart{animation:bBreath 2.6s ease-in-out infinite}
.b .e-coin{animation:bPulse 2.2s ease-in-out infinite}
.b.grid .ticks,.b.grid .rays,.b.grid .raysR,.b.grid .particle,.b.grid .wingL,.b.grid .wingR,.b.grid .ribbon,.b.grid .gem:nth-child(n+3){animation:none}
.b.grid.paused *,.b.static *{animation:none!important}
@media (prefers-reduced-motion:reduce){.b *{animation:none!important}}`;

// ---- the badge ------------------------------------------------------------------------------------------------------
let uidN = 0;
export function svg(cat, tier, { size = 160, mode = "full", uid = null, title = true } = {}) {
  const P = PALETTES[cat]; if (!P || tier < 1 || tier > 18) throw new Error("No such badge.");
  const T = TIER[tier], id = uid ?? `b${cat.slice(0, 3)}${tier}x${(uidN++).toString(36)}`;
  const lvl = tier <= 6 ? 1 : tier <= 12 ? 2 : 3;
  const metal = METALS[T.metal](P);
  const full = mode === "full", anim = mode !== "static";
  const name = NAMES[cat][tier - 1], label = BADGE_CATEGORIES[cat].label;
  const defs = [], back = [], mid = [], front = [];
  // gradients: the metal frame, the disc (a jewel/cosmic body that deepens with the tiers), highlights
  const stops = (cols) => cols.map((col, i) => `<stop offset="${f((i / (cols.length - 1)) * 100)}%" stop-color="${col}"/>`).join("");
  defs.push(`<linearGradient id="${id}m" x1="0" y1="0" x2="1" y2="1">${stops(metal)}${full && ["prismatic", "cosmic", "iridescent"].includes(T.metal) ? `<animateTransform attributeName="gradientTransform" type="rotate" from="0 .5 .5" to="360 .5 .5" dur="${T.metal === "iridescent" ? 14 : 8}s" repeatCount="indefinite"/>` : ""}</linearGradient>`);
  const discCols = tier <= 3 ? [P.s, P.p, P.d] : tier <= 6 ? [P.g2, P.p, P.d] : tier <= 12 ? [P.g1, P.p, P.d] : tier <= 15 ? [P.g2, P.g1, P.p, P.d] : [P.a, P.g1, P.p, P.d, "#05050c"];
  defs.push(`<radialGradient id="${id}d" cx="38%" cy="32%" r="78%">${stops(discCols)}</radialGradient>`);
  defs.push(`<radialGradient id="${id}h" cx="50%" cy="0%" r="70%"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`);
  defs.push(`<linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`);
  if (T.nebula) defs.push(`<radialGradient id="${id}n" cx="30%" cy="30%" r="80%"><stop offset="0" stop-color="${P.g2}" stop-opacity=".9"/><stop offset=".45" stop-color="${P.p}" stop-opacity=".6"/><stop offset="1" stop-color="#05030f" stop-opacity="1"/>${full ? `<animate attributeName="cx" values="30%;65%;30%" dur="16s" repeatCount="indefinite"/>` : ""}</radialGradient>`);
  const fp = framePath(T.frame);
  defs.push(`<clipPath id="${id}c">${fp ? `<path d="${fp}"/>` : `<circle cx="100" cy="100" r="86"/>`}</clipPath>`);

  // behind the frame: aura, rays, wings
  if (T.aura) back.push(`<circle cx="100" cy="100" r="98" fill="${P.g1}" class="aura" opacity=".45"/>${T.aura > 1 ? `<circle cx="100" cy="100" r="99" fill="none" stroke="url(#${id}m)" stroke-width="3" opacity=".7" class="aura"/>` : ""}`);
  if (T.rays) {
    const n = 12 + T.rays * 6, rays = [];
    for (let i = 0; i < n; i++) { const a = (i * 2 * Math.PI) / n, [x1, y1] = polar(100, 100, 70, a), [x2, y2] = polar(100, 100, i % 2 ? 92 : 99, a - 0.05), [x3, y3] = polar(100, 100, i % 2 ? 92 : 99, a + 0.05); rays.push(`M${x1},${y1}L${x2},${y2}L${x3},${y3}Z`); }
    back.push(`<path d="${rays.join("")}" fill="${T.rays >= 2 ? `url(#${id}m)` : P.g2}" opacity="${0.35 + T.rays * 0.15}" class="rays"/>`);
  }
  if (T.wings) {
    const wing = (flip) => { const feathers = []; for (let i = 0; i < 4 + T.wings; i++) { const y = 70 + i * 11, len = 46 - i * 6; feathers.push(`<path d="M100 ${y}c-${len * 0.5}-${6 + i}-${len}-${2 + i}-${len + 6} ${6 + i * 2} ${len * 0.5} ${2} ${len} ${1} ${len + 6}-${1}z" fill="url(#${id}m)" opacity="${0.95 - i * 0.07}"/>`); } return `<g class="${flip ? "wingR" : "wingL"}" transform="${flip ? "translate(200 0) scale(-1 1)" : ""} translate(-34 -8)">${feathers.join("")}</g>`; };
    back.push(wing(false) + wing(true));
  }

  // the frame and the disc
  const frameEl = fp ? `<path d="${fp}" fill="url(#${id}m)"/>` : `<circle cx="100" cy="100" r="88" fill="url(#${id}m)"/>`;
  mid.push(`<g filter="url(#${id}sh)">${frameEl}</g>`);
  defs.push(`<filter id="${id}sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity=".35"/></filter>`);
  const inset = fp ? (T.frame.includes("hield") || T.frame.includes("rest") ? 0.84 : 0.86) : 0.88;
  const discInner = fp ? `<path d="${fp}" transform="translate(100 100) scale(${inset}) translate(-100 -100)" fill="${T.nebula ? `url(#${id}n)` : `url(#${id}d)`}"/>` : `<circle cx="100" cy="100" r="76" fill="url(#${id}d)"/>`;
  mid.push(discInner);
  // rims and engraving
  for (let i = 0; i < T.rims; i++) mid.push(fp ? `<path d="${fp}" transform="translate(100 100) scale(${f(inset - 0.04 - i * 0.07)}) translate(-100 -100)" fill="none" stroke="${i ? P.a : "url(#" + id + "m)"}" stroke-width="${i ? 1.2 : 2.4}" opacity="${i ? 0.55 : 0.9}"/>` : `<circle cx="100" cy="100" r="${72 - i * 6}" fill="none" stroke="${i ? P.a : "url(#" + id + "m)"}" stroke-width="${i ? 1.2 : 2.4}" opacity="${i ? 0.55 : 0.9}"/>`);
  if (T.ticks) {
    const n = 48, ticks = []; for (let i = 0; i < n; i++) { const a = (i * 2 * Math.PI) / n, [x1, y1] = polar(100, 100, 62, a), [x2, y2] = polar(100, 100, i % 4 ? 65 : 67, a); ticks.push(`M${x1},${y1}L${x2},${y2}`); }
    mid.push(`<path d="${ticks.join("")}" stroke="${P.a}" stroke-width="1.1" opacity=".55" class="ticks"/>`);
    if (T.ticks > 1) mid.push(`<circle cx="100" cy="100" r="58" fill="none" stroke="${P.a}" stroke-width=".8" stroke-dasharray="1 3" opacity=".6" class="raysR"/>`);
  }
  // the glow behind the emblem
  mid.push(`<circle cx="100" cy="96" r="44" fill="${P.g1}" opacity=".28" class="glow"/>`);
  // the emblem
  const colours = tier <= 3 ? { fg: P.a, hi: "#fff", ac: P.s, dk: P.d, a: P.a, a2: P.g2, dk2: P.d }
    : { fg: P.a, hi: "#fff", ac: P.s === P.a ? P.g2 : P.s, dk: P.d, a: P.a, a2: P.g2, dk2: P.m };
  if (cat === "art") Object.assign(colours, { fg: P.p, ac: P.a, a2: P.s, dk2: P.g2 });
  if (cat === "sleep" || cat === "outdoors") colours.ac = P.a;
  const es = tier <= 3 ? 0.82 : tier <= 12 ? 0.9 : 0.96;
  const ey = T.ribbon ? 90 : 96;
  front.push(`<g transform="translate(100 ${ey}) scale(${f(es)}) translate(-50 -50)">${EMB[cat](lvl, colours)}</g>`);
  // highlight and sheen
  front.push(`<ellipse cx="100" cy="62" rx="56" ry="30" fill="url(#${id}h)" opacity=".55" clip-path="url(#${id}c)"/>`);
  if (tier >= 4 && anim) front.push(`<g clip-path="url(#${id}c)"><rect x="40" y="0" width="40" height="200" fill="url(#${id}s)" transform="rotate(20 100 100)" class="sheen" opacity=".8"/></g>`);
  // pips (tiers 1–6)
  if (T.pips) { const n = T.pips, w = 7; for (let i = 0; i < n; i++) front.push(`<circle cx="${f(100 - ((n - 1) * w) / 2 + i * w)}" cy="${fp && T.frame === "hexagon" ? 150 : 156}" r="2.6" fill="${P.a}" opacity=".9"/>`); }
  // laurels
  if (T.laurel) {
    const leaves = [], n = T.laurel > 1 ? 9 : 5;
    for (let side of [-1, 1]) for (let i = 0; i < n; i++) { const a = Math.PI / 2 + side * (0.5 + i * (T.laurel > 1 ? 0.2 : 0.22)); const [x, y] = polar(100, 100, 80, a); const rot = (a * 180) / Math.PI + (side > 0 ? 0 : 180); leaves.push(`<ellipse cx="${x}" cy="${y}" rx="7" ry="3" transform="rotate(${f(rot + side * 35)} ${x} ${y})" fill="url(#${id}m)" stroke="${P.d}" stroke-width=".5"/>`); }
    front.push(`<g opacity=".95">${leaves.join("")}</g>`);
  }
  // stars above
  if (T.stars) { const n = T.stars; for (let i = 0; i < n; i++) { const x = 100 + (i - (n - 1) / 2) * 16, y = (T.frame.includes("hield") || T.frame.includes("rest")) ? 40 : 34 - Math.abs(i - (n - 1) / 2) * -2; front.push(`<path d="${star(5, 6, 2.6, -Math.PI / 2, x, y)}" fill="${P.a}" stroke="${P.d}" stroke-width=".6" class="twinkle" style="animation-delay:${i * 0.5}s"/>`); } }
  // gems around the frame
  if (T.gems) {
    const cols = [P.s, P.g1, P.p, P.g2];
    for (let i = 0; i < T.gems; i++) {
      const a = -Math.PI / 2 + Math.PI / T.gems + (i * 2 * Math.PI) / T.gems, [x, y] = polar(100, 100, 80, a);
      defs.push(`<radialGradient id="${id}g${i}" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="${cols[i % 4]}"/><stop offset="1" stop-color="${P.d}"/></radialGradient>`);
      front.push(`<g><path d="${star(4, 6.5, 4.6, 0, x, y)}" fill="url(#${id}m)"/><circle cx="${x}" cy="${y}" r="4.3" fill="url(#${id}g${i})"/><path d="${star(4, 5, 1.2, 0, x, y)}" fill="#fff" class="gem" style="animation-delay:${(i * 0.43).toFixed(2)}s"/></g>`);
    }
  }
  // filigree swirls
  if (T.filigree) front.push(`<g fill="none" stroke="url(#${id}m)" stroke-width="1.6" opacity=".85"><path d="M60 170c-10-4-16-14-10-20 5-5 12 0 9 5M140 170c10-4 16-14 10-20-5-5-12 0-9 5"/><path d="M52 34c-8 4-12 12-6 16 4 3 9-1 6-5M148 34c8 4 12 12 6 16-4 3-9-1-6-5"/></g>`);
  // crown or halo
  if (T.crown) {
    if (HALO.has(cat)) front.push(`<ellipse cx="100" cy="14" rx="${T.crown > 1 ? 30 : 24}" ry="6" fill="none" stroke="url(#${id}m)" stroke-width="3.2" class="crown"/><ellipse cx="100" cy="14" rx="${T.crown > 1 ? 30 : 24}" ry="6" fill="none" stroke="#fff" stroke-width=".8" opacity=".8" class="crown"/>`);
    else if (LAURELCROWN.has(cat)) { const l2 = []; for (let i = 0; i < 7; i++) { const x = 72 + i * 9.3, y = 16 - Math.sin((i / 6) * Math.PI) * 6; l2.push(`<ellipse cx="${f(x)}" cy="${f(y)}" rx="6" ry="2.6" transform="rotate(${f(-40 + i * 13)} ${f(x)} ${f(y)})" fill="url(#${id}m)"/>`); } front.push(`<g class="crown">${l2.join("")}</g>`); }
    else front.push(`<g class="crown"><path d="M76 24l6-16 10 10 8-14 8 14 10-10 6 16z" fill="url(#${id}m)" stroke="${P.d}" stroke-width=".8"/><circle cx="100" cy="10" r="2.6" fill="${P.s}"/>${T.crown > 1 ? `<circle cx="82" cy="12" r="1.8" fill="${P.g1}"/><circle cx="118" cy="12" r="1.8" fill="${P.g1}"/>` : ""}</g>`);
  }
  // the ribbon with the badge's name (tiers 7+)
  if (T.ribbon) {
    const fs = name.length > 22 ? 8.2 : name.length > 16 ? 9.4 : 10.5;
    front.push(`<g class="ribbon"><path d="M26 150l14-4v22l-14-2 6-8z" fill="${P.d}"/><path d="M174 150l-14-4v22l14-2-6-8z" fill="${P.d}"/><path d="M36 144c42-8 86-8 128 0v24c-42-8-86-8-128 0z" fill="url(#${id}m)" stroke="${P.d}" stroke-width=".8"/><path d="M36 144c42-8 86-8 128 0" fill="none" stroke="#fff" stroke-width=".8" opacity=".6"/><text x="100" y="160" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="${fs}" fill="${P.d}" letter-spacing=".3">${esc(name)}</text></g>`);
  }
  // legendary particles
  if (T.particles && anim) { for (let i = 0; i < (full ? 10 : 4); i++) { const x = 30 + ((i * 53) % 140), d = (i * 0.63) % 6; front.push(`<circle cx="${x}" cy="${160 - (i % 3) * 10}" r="${1.4 + (i % 3) * 0.6}" fill="${[P.a, P.g1, P.g2][i % 3]}" class="particle" style="animation-delay:${d.toFixed(2)}s"/>`); } }
  if (tier === 18) front.push(`<g fill="none" stroke="url(#${id}m)" stroke-width="1.2" opacity=".7" class="raysR"><circle cx="100" cy="100" r="96" stroke-dasharray="2 6"/></g>`);

  const cls = `b ${mode === "grid" ? "grid" : mode === "static" ? "static" : "full"}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${size}" height="${size}" class="${cls}" data-cat="${cat}" data-tier="${tier}" role="img" aria-label="${esc(`${label} badge, tier ${tier} of 18: ${name}`)}">${title ? `<title>${esc(`${name} · ${label} ${tier}/18`)}</title>` : ""}<style>${CSS}</style><defs>${defs.join("")}</defs>${back.join("")}${mid.join("")}${front.join("")}</svg>`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// A mystery silhouette for the next badge: the frame's outline only (hints at its size and fanciness), frosted,
// with a big "?" in the category colour. Never contains the real art.
export function mystery(cat, tier, { size = 160 } = {}) {
  const P = PALETTES[cat], T = TIER[tier], fp = framePath(T.frame);
  const shape = fp ? `<path d="${fp}"/>` : `<circle cx="100" cy="100" r="88"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${size}" height="${size}" class="b mystery" role="img" aria-label="A mystery badge"><g fill="${P.p}" fill-opacity=".22" stroke="${P.s}" stroke-opacity=".7" stroke-width="3" stroke-dasharray="6 5">${shape}</g>${T.wings ? `<g fill="${P.p}" fill-opacity=".14"><path d="M40 70c-20 6-34 30-36 50 14-8 26-8 38-4z"/><path d="M160 70c20 6 34 30 36 50-14-8-26-8-38-4z"/></g>` : ""}<text x="100" y="128" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="88" fill="${P.s}" fill-opacity=".9">?</text></svg>`;
}
// Complexity score (for tests: each tier must be fancier than the one before)
export const complexity = (s) => (s.match(/<(path|circle|ellipse|rect|text|g|stop|animate|animateTransform)\b/g) ?? []).length;
export { TIERS };
