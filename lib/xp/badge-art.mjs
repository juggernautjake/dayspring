// Badge art: all 18 × 18 badges are drawn here as SVG, deterministically. Every part of a badge says its category:
//   • the EMBLEM tells a story over six stages, one per three tiers (Fitness: dumbbell → motion → flexed arm → flaming
//     dumbbell → winged titan → crowned champion); the drawings live in ./badges/emblems.mjs
//   • the FRAME carries big category ornaments on its sides and top (barbell ends, clefs, a compass, paint drips …),
//     so a badge says its category even with the emblem hidden
//   • the RIM is engraved with the category's motif (Fitness: chain links · Music: a five-line staff with notes ·
//     Worship: stained glass · Reading: page edges and bindings · Rest: moon phases · Business: a coin's reeded edge …)
//   • the "stars" and gems are category TOKENS (notes, leaves, hearts, coins, moons, flames, ink drops …)
//   • the side ornaments (laurels, vines, crossed whisk and spoon, crossed brushes, hanging bookmarks, a tassel …)
//   • the ribbon's ends carry the token
// The tier shows in the frame's silhouette (circle → notched → rope → hexagon → octagon → scallop → shield → cusped
// shield → star → sunburst → winged crest ×2 → pointed medallion → compass medallion → ornate celestial → winged →
// legendary), the colour story (matte → pewter → copper → steel → brass → bronze → silver → gold → rose gold →
// emerald → sapphire → ruby → platinum → opal → prismatic → cosmic), the accents (gems 1 → 2 → 3, a half then a full
// laurel), the ribbon style (swallowtail → scroll → double → gold-trimmed), the pips (1–6) or numeral (7–18), and the
// layers of motion.
//
//   svg(category, tier, { size, mode: "full"|"grid"|"static", emblem: true, style: true, uid })
//   back(category, tier, …)   the reverse side (for the coin-flip entrance): embossed emblem and the tier numeral
//   mystery(category, tier)   the "next badge" card: the silhouette and a "?" only, never the art
// Motion lives in ./badges/motion.mjs (CSS, no script), so a badge animates inline or as an <img>.
import { BADGE_CATEGORIES, NAMES, TIERS } from "./badges.mjs";
import { css as motionCSS, MOTION } from "./badges/motion.mjs";
import { EMB } from "./badges/emblems.mjs";

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
const METALS = {
  matte:      (P) => [mix(P.p, "#fff", 0.35), P.p, mix(P.p, P.d, 0.5), P.d],
  duotone:    (P) => [mix(P.s, "#fff", 0.4), P.s, P.p, P.d],
  pewter:     () => ["#F0F3F5", "#B4BCC3", "#737D86", "#3A4148"],
  copper:     () => ["#FFD9C2", "#E08B5A", "#A4512A", "#5A2410"],
  steel:      () => ["#EAF1F7", "#9FB1C1", "#5E7183", "#2A3643"],
  brass:      () => ["#FBF1C0", "#CDB45A", "#8E7524", "#4A3A0A"],
  bronze:     () => ["#FBD7A8", "#C07A3A", "#86481C", "#4A2208"],
  silver:     () => ["#FFFFFF", "#D5DDE5", "#8E9BA8", "#4A5663"],
  gold:       () => ["#FFF6C4", "#F2C94C", "#C08A12", "#6E4A00"],
  rosegold:   () => ["#FFEDE6", "#EDB3A0", "#B86F5A", "#6B3526"],
  platinum:   () => ["#FFFFFF", "#E9F0F6", "#B3C1CE", "#6E7E8E"],
  emerald:    () => ["#E6FFF2", "#5FD39A", "#12825A", "#04402A"],
  sapphire:   () => ["#E8F0FF", "#7FA6FF", "#2449C2", "#0A1A55"],
  ruby:       () => ["#FFE3E8", "#F0607A", "#A8163A", "#4E0616"],
  pearl:      () => ["#FFFFFF", "#F7E9F2", "#DCE6F4", "#EBDDF0", "#A99FB8"],
  iridescent: () => ["#FFE6F7", "#CDF3FF", "#DCCBFF", "#FFF4C4", "#C2FFE9"],
  prismatic:  () => ["#FF8FB1", "#FFD479", "#8AF5C0", "#7CC8FF", "#C09BFF", "#FF8FB1"],
  cosmic:     () => ["#FFF8E1", "#FFC2E6", "#9EDCFF", "#C3A2FF", "#FFE59A", "#FFF8E1"],
};
// ribbon: 1 swallowtail · 2 scroll ends · 3 double band · 4 gold-trimmed · laurel: 1 half, 2 full · diag: accents at the
// shoulders · cwings: the crest's small side wings
const TIER = [
  null,
  { frame: "circle",     metal: "matte",      rims: 1, pips: 1 },
  { frame: "notched",    metal: "duotone",    rims: 1, pips: 2, beads: 1 },
  { frame: "rope",       metal: "pewter",     rims: 2, pips: 3, beads: 1 },
  { frame: "hexagon",    metal: "copper",     rims: 1, pips: 4 },
  { frame: "octagon",    metal: "steel",      rims: 1, pips: 5 },
  { frame: "scallop",    metal: "brass",      rims: 1, pips: 6 },
  { frame: "shield",     metal: "bronze",     rims: 1, ribbon: 1, gems: 1 },
  { frame: "cusped",     metal: "silver",     rims: 1, ribbon: 1, gems: 2 },
  { frame: "star",       metal: "gold",       rims: 2, ribbon: 1, gems: 3 },
  { frame: "sunburst",   metal: "rosegold",   rims: 2, ribbon: 2, gems: 3, laurel: 1, ring: 1 },
  { frame: "crest",      metal: "emerald",    rims: 2, ribbon: 2, gems: 3, laurel: 2, ring: 1, cwings: 1 },
  { frame: "crest",      metal: "sapphire",   rims: 2, ribbon: 2, gems: 4, laurel: 2, ring: 2, cwings: 2, sides: 2 },
  { frame: "medallion",  metal: "ruby",       rims: 2, ribbon: 3, gems: 5, laurel: 2, ring: 2, rays: 1, sides: 2 },
  { frame: "compass",    metal: "platinum",   rims: 3, ribbon: 3, gems: 6, laurel: 2, ring: 2, rays: 1, sides: 2, filigree: 1 },
  { frame: "celestial",  metal: "iridescent", rims: 3, ribbon: 3, gems: 6, laurel: 2, ring: 2, rays: 2, sides: 2, filigree: 1 },
  { frame: "wingedShield", metal: "prismatic", rims: 3, ribbon: 4, gems: 6, laurel: 2, ring: 2, rays: 2, sides: 2, filigree: 1, wings: 1, crown: 1, aura: 1 },
  { frame: "wingedCrest",  metal: "prismatic", rims: 3, ribbon: 4, gems: 7, laurel: 2, ring: 2, rays: 3, sides: 2, filigree: 1, wings: 2, crown: 2, aura: 1 },
  { frame: "legend",     metal: "cosmic",     rims: 3, ribbon: 4, gems: 8, laurel: 2, ring: 2, rays: 3, sides: 2, filigree: 1, wings: 2, crown: 2, aura: 2, nebula: 1, particles: 1 },
];
const HALO = new Set(["prayer", "worship", "mindfulness", "volunteer"]);
const LAURELCROWN = new Set(["workout", "sports", "outdoors", "eating"]);
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII"];
export const stageOf = (tier) => Math.min(6, Math.ceil(tier / 3));   // the emblem's six stages: 1–3, 4–6 … 16–18

// ---- geometry --------------------------------------------------------------------------------------------------------
const f = (n) => Math.round(n * 10) / 10;
const polar = (cx, cy, r, a) => [f(cx + r * Math.cos(a)), f(cy + r * Math.sin(a))];
const DISC = 57, RIN = 58, ROUT = 80, RMID = 69;           // the disc, and the rim band where the category motif lives
const RSTEP = (ROUT - RIN - 5) / 4;                          // five evenly spaced lines inside the band (staff, page edges)
// mix two #rrggbb colours: t = 0 → a, 1 → b
function mix(a, b, t) { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const x = p(a), y = p(b); return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join(""); }
function roundPoly(n, r, round = 0.18, rot = -Math.PI / 2) {
  const P = []; for (let i = 0; i < n; i++) P.push(polar(100, 100, r, rot + (i * 2 * Math.PI) / n));
  let d = "";
  for (let i = 0; i < n; i++) {
    const [x0, y0] = P[(i - 1 + n) % n], [x1, y1] = P[i], [x2, y2] = P[(i + 1) % n];
    d += `${i ? "L" : "M"}${f(x1 + (x0 - x1) * round)},${f(y1 + (y0 - y1) * round)}Q${x1},${y1} ${f(x1 + (x2 - x1) * round)},${f(y1 + (y2 - y1) * round)}`;
  }
  return d + "Z";
}
function star(n, ro, ri, rot = -Math.PI / 2, cx = 100, cy = 100) { const p = []; for (let i = 0; i < n * 2; i++) p.push(polar(cx, cy, i % 2 ? ri : ro, rot + (i * Math.PI) / n).join(",")); return `M${p.join("L")}Z`; }
function scallop(n, r, bump) { let d = ""; for (let i = 0; i < n; i++) { const a0 = (i * 2 * Math.PI) / n - Math.PI / 2, a1 = ((i + 1) * 2 * Math.PI) / n - Math.PI / 2, am = (a0 + a1) / 2; const p0 = polar(100, 100, r, a0), p1 = polar(100, 100, r, a1), c = polar(100, 100, r + bump * 2, am); d += `${i ? "" : `M${p0.join(",")}`}Q${c.join(",")} ${p1.join(",")}`; } return d + "Z"; }
const SHIELD = "M100,8 C128,18 158,20 184,14 C190,96 168,158 100,194 C32,158 10,96 16,14 C42,20 72,18 100,8Z";
const CUSPED = "M100,20 C110,4 134,2 142,16 C158,22 174,18 188,8 C192,96 170,160 100,196 C30,160 8,96 12,8 C26,18 42,22 58,16 C66,2 90,4 100,20Z";
const CREST = "M100,4 L118,20 C140,16 162,18 186,10 C192,96 168,160 100,196 C32,160 8,96 14,10 C38,18 60,16 82,20Z";
const QUATRE = (() => { let d = ""; const r = 46, c = 44; for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2 - Math.PI / 4; const [x, y] = polar(100, 100, c, a); d += `M${f(x + r)},${f(y)}A${r},${r} 0 1,0 ${f(x - r)},${f(y)}A${r},${r} 0 1,0 ${f(x + r)},${f(y)}Z`; } return d; })();
const GOTHIC = "M100,2 C136,34 180,52 184,104 C188,156 150,192 100,196 C50,192 12,156 16,104 C20,52 64,34 100,2Z";
function framePath(kind) {
  switch (kind) {
    case "notched": return star(24, 92, 87.5, -Math.PI / 2);
    case "rope": return scallop(36, 88, 1.6);
    case "hexagon": return roundPoly(6, 96, 0.16);
    case "octagon": return roundPoly(8, 90, 0.14, -Math.PI / 8 - Math.PI / 2);
    case "scallop": return scallop(18, 84, 3.6);
    case "cusped": return CUSPED;
    case "shield": case "wingedShield": return SHIELD;
    case "crest": case "wingedCrest": return CREST;
    case "star": return star(8, 97, 82);
    case "sunburst": return star(16, 96, 84);
    case "medallion": return star(24, 96, 86.5, -Math.PI / 2);
    case "compass": return star(8, 99, 78) + star(8, 91, 78, -Math.PI / 2 + Math.PI / 8);
    case "quatrefoil": return QUATRE;
    case "gothic": return GOTHIC;
    case "celestial": case "legend": return star(12, 97, 85);
    default: return null;
  }
}
// n things around a circle: fn(x, y, degrees, i, radians)
function around(n, r, fn, start = -Math.PI / 2) { let s = ""; for (let i = 0; i < n; i++) { const a = start + (i * 2 * Math.PI) / n; const [x, y] = polar(100, 100, r, a); s += fn(x, y, f((a * 180) / Math.PI), i, a); } return s; }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// a stable pseudo-random number for a seed: varies details without ever changing between renders
function rnd(seed) { let h = 2166136261; for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; }

// ---- tokens: the category's small objects (as "stars", along ornaments, at the ribbon's ends) ----------------------
// drawn centred at (0,0), about 13 units across
const TOK = {
  workout: (c) => `<path d="M1.5-7L-4 1h3.5L-2 7 4-1H.5L3-7z" fill="${c}"/>`,
  sports: (c, k) => `<circle r="5.5" fill="${c}"/><path d="M-5.2-1.6c3 .8 5 3.4 5 7M5.2-1.6c-3 .8-5 3.4-5 7M-3.6-4.2c2.4 1.4 4.8 1.4 7.2 0" stroke="${k}" stroke-width="1" fill="none"/>`,
  worship: (c, k) => `<path d="M0-7c3 3 4 5.5 4 7.5A4 4 0 0 1-4 .5C-4-1.5-3-4 0-7z" fill="${c}"/><rect x="-2" y="3" width="4" height="5" rx="1" fill="${k}" opacity=".7"/>`,
  prayer: (c) => `<path d="M0-7C1.2-3 3-1.4 7 0 3 1.4 1.2 3 0 7-1.2 3-3 1.4-7 0-3-1.4-1.2-3 0-7z" fill="${c}"/>`,
  eating: (c, k) => `<path d="M0-5.5C5-6.5 6.5-1 4.5 3.5 3 7 0 6.5 0 6.5S-3 7-4.5 3.5C-6.5-1-5-6.5 0-5.5z" fill="${c}"/><path d="M0-5c.5-2 2-3 3.5-3" stroke="${k}" stroke-width="1.3" fill="none"/>`,
  chore: (c) => `<path d="M0-7l1.6 5.4L7 0 1.6 1.6 0 7-1.6 1.6-7 0-1.6-1.6z" fill="${c}"/>`,
  study: (c) => `<path d="${star(5, 6.5, 2.8, -Math.PI / 2, 0, 0)}" fill="${c}"/>`,
  reading: (c, k) => `<path d="M0-3.5c-2-2-5-2.5-7-2v9c2-.5 5 0 7 2 2-2 5-2.5 7-2v-9c-2-.5-5 0-7 2z" fill="${c}"/><path d="M0-3.5V5.5" stroke="${k}" stroke-width=".8"/>`,
  practice: (c) => `<ellipse cx="-2" cy="4" rx="3.4" ry="2.5" fill="${c}" transform="rotate(-20 -2 4)"/><path d="M1.2 3.6V-7c2 1 4 2 4.5 4.6" stroke="${c}" stroke-width="1.6" fill="none"/>`,
  call: (c) => `<path d="M0-2.5C-1.2-6.5-7-6.2-7-1.8-7 2.5-2.5 4.5 0 7c2.5-2.5 7-4.5 7-8.8 0-4.4-5.8-4.7-7-.7z" fill="${c}"/>`,
  writing: (c) => `<path d="M0-7C2.5-3 4.5-.5 4.5 2.2A4.5 4.5 0 0 1-4.5 2.2C-4.5-.5-2.5-3 0-7z" fill="${c}"/>`,
  outdoors: (c, k) => `<path d="M0-7l4 5H2l3.5 4.5H-5.5L-2-2h-2z" fill="${c}"/><rect x="-1" y="2.5" width="2" height="3.5" fill="${k}"/>`,
  sleep: (c) => `<path d="M2-6.5A7 7 0 1 0 6.5 3 5.5 5.5 0 1 1 2-6.5z" fill="${c}"/>`,
  cooking: (c, k) => `<path d="M-5 1c-2.5 0-3-3.2-.8-4-.2-2.6 3-3.6 4.6-1.6C0-6.6 3.4-6.6 4.2-4c2.4-.4 3 3 .8 4.6V4H-5z" fill="${c}"/><rect x="-5" y="3.5" width="10" height="2.5" rx=".8" fill="${k}" opacity=".6"/>`,
  volunteer: (c, k) => `<path d="M-3.5-5h7l-1 1.5v6.5c0 1.5-1 2.5-2.5 2.5h0c-1.5 0-2.5-1-2.5-2.5V-3.5z" fill="${c}"/><circle cy="1" r="1.6" fill="${k}"/><path d="M-2-5c0-2 4-2 4 0" stroke="${c}" stroke-width="1" fill="none"/>`,
  art: (c, k) => `<path d="M0-6.5c-4 0-6.5 2.6-6.5 6 0 3 2.3 5 4.6 5 1 0 1.3-1 1-1.7-.3-1 .3-1.7 1.3-1.7h2c2.3 0 4.3-1.3 4.3-3.6 0-2.4-3-4-6.7-4z" fill="${c}"/><circle cx="-3" cy="-1" r="1.2" fill="${k}"/><circle cx="0" cy="-3.6" r="1.2" fill="${k}"/><circle cx="3.2" cy="-2.6" r="1.2" fill="${k}"/>`,
  mindfulness: (c) => `<path d="M0 5C-2 1.5-2-2.5 0-6.5 2-2.5 2 1.5 0 5zM0 5C-4 4-6 1-6.5-2.5-3.5-1.5-1.5 1 0 5zM0 5C4 4 6 1 6.5-2.5 3.5-1.5 1.5 1 0 5z" fill="${c}"/>`,
  work: (c, k) => `<circle r="6" fill="${c}"/><circle r="4.4" fill="none" stroke="${k}" stroke-width=".8" opacity=".6"/><path d="M1.6-2.4H-.6a1.3 1.3 0 0 0 0 2.6h1.2a1.3 1.3 0 0 1 0 2.6h-2.2M0-3.8v7.6" stroke="${k}" stroke-width=".9" fill="none" opacity=".7"/>`,
};
const tok = (cat, x, y, s, c, k, cls = "") => `<g transform="translate(${f(x)} ${f(y)}) scale(${f(s * 100) / 100})"${cls ? ` class="${cls}"` : ""}>${TOK[cat](c, k)}</g>`;

// ---- the rim: each category's border motif, engraved in the band between the disc and the frame -------------------
// e = engraving colour, i = inlay colour; density grows with the tier
function rim(cat, tier, P, e, i) {
  const n = (base) => base + Math.floor(tier / 3) * 2;
  switch (cat) {
    case "workout": return around(n(10), RMID, (x, y, deg, k) => k % 2 ? `<circle cx="${x}" cy="${y}" r="5.4" fill="${i}" stroke="${P.d}" stroke-width=".9"/><circle cx="${x}" cy="${y}" r="2" fill="${P.d}"/>` : `<rect x="${f(x - 6)}" y="${f(y - 2)}" width="12" height="4" rx="1.4" fill="${e}" stroke="${P.d}" stroke-width=".7" transform="rotate(${f(deg + 90)} ${x} ${y})"/>`);
    case "sports": return `<circle cx="100" cy="100" r="${RIN + 2.5}" fill="none" stroke="${e}" stroke-width="1.6" stroke-dasharray="3 2.6"/><circle cx="100" cy="100" r="${ROUT - 2.5}" fill="none" stroke="${e}" stroke-width="1.6" stroke-dasharray="3 2.6"/>` +
      around(n(22), RMID, (x, y, deg) => `<path d="M-2.4-1.6L0 1.2 2.4-1.6" transform="translate(${x} ${y}) rotate(${f(deg + 90)}) scale(1.5)" stroke="${i}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`);
    case "reading": return [0, 1, 2, 3, 4].map((k) => RIN + 2.5 + k * RSTEP).map((r, k) => `<circle cx="100" cy="100" r="${r}" fill="none" stroke="${k % 2 ? i : e}" stroke-width="1.4" opacity="${k % 2 ? 0.95 : 0.8}"/>`).join("") +
      around(4 + (tier >= 7 ? 4 : 0), RMID, (x, y, deg) => `<rect x="${f(x - 11)}" y="${f(y - 3.4)}" width="22" height="6.8" rx="1.2" fill="${P.s}" stroke="${e}" stroke-width=".7" transform="rotate(${deg} ${x} ${y})"/>`, -Math.PI / 4);
    case "writing": return around(n(10), RMID, (x, y, deg, k) => `<g transform="translate(${x} ${y}) rotate(${f(deg + 90)}) scale(1.45)"><path d="M0-4.8C1.8-2 3-.5 3 1.4A3 3 0 0 1-3 1.4C-3-.5-1.8-2 0-4.8z" fill="${k % 2 ? e : i}"/></g>`) +
      around(n(10), RMID, (x, y, deg) => `<path d="M-3.4 0c1.2-2.4 2.8 1.6 4 0s-.4-2.2.8-1.8" transform="translate(${x} ${y}) rotate(${f(deg + 90)}) scale(1.4)" stroke="${e}" stroke-width="1" fill="none"/>`, -Math.PI / 2 + Math.PI / n(10));
    case "practice": return [0, 1, 2, 3, 4].map((k) => RIN + 2.5 + k * RSTEP).map((r) => `<circle cx="100" cy="100" r="${r}" fill="none" stroke="${e}" stroke-width="1" opacity=".95"/>`).join("") +
      around(n(9), RMID, (x, y, deg, k, a) => { const [nx, ny] = polar(100, 100, RIN + 2.5 + (k % 4 + 0.5) * RSTEP, a); return `<g transform="translate(${nx} ${ny}) rotate(${f(deg + 90)}) scale(1.35)"><ellipse rx="2.3" ry="1.6" fill="${i}" transform="rotate(-25)"/><path d="M2-.4V-6.5" stroke="${i}" stroke-width=".8"/></g>`; });
    case "prayer": return around(n(30), RMID, (x, y, deg, k, a) => { const [x1, y1] = polar(100, 100, RIN + 1.5, a), [x2, y2] = polar(100, 100, k % 2 ? RMID + 2 : ROUT - 1.5, a); return `<path d="M${x1},${y1}L${x2},${y2}" stroke="${k % 2 ? e : i}" stroke-width="${k % 2 ? 1.1 : 2}" stroke-linecap="round" opacity=".95"/>`; });
    case "worship": {
      const cols = [P.p, P.s, "#4FA3D9", P.g2, "#D94F6A", P.g1], m = n(10); let s = "";
      for (let k = 0; k < m; k++) { const a0 = -Math.PI / 2 + (k * 2 * Math.PI) / m, a1 = a0 + (2 * Math.PI) / m; const p = [polar(100, 100, RIN + 0.5, a0), polar(100, 100, ROUT - 0.5, a0), polar(100, 100, ROUT - 0.5, a1), polar(100, 100, RIN + 0.5, a1)];
        s += `<path d="M${p[0]}L${p[1]}A${ROUT - 0.5},${ROUT - 0.5} 0 0 1 ${p[2]}L${p[3]}A${RIN + 0.5},${RIN + 0.5} 0 0 0 ${p[0]}Z" fill="${cols[k % cols.length]}" opacity=".9" stroke="${P.d}" stroke-width="1.3"/>`; }
      return s + `<circle cx="100" cy="100" r="${RMID}" fill="none" stroke="${P.d}" stroke-width=".9" opacity=".7"/>`;
    }
    case "eating": {
      const m = n(8); let d = "";
      for (let k = 0; k <= 96; k++) { const a = -Math.PI / 2 + (k / 96) * 2 * Math.PI, r = RMID + Math.sin((a + Math.PI / 2) * m) * 3.8; const [x, y] = polar(100, 100, r, a); d += `${k ? "L" : "M"}${x},${y}`; }
      return `<path d="${d}" stroke="${e}" stroke-width="1.5" fill="none"/>` +
        around(m * 2, RMID, (x, y, deg, k) => `<ellipse cx="${x}" cy="${y}" rx="3.8" ry="1.8" fill="${k % 4 === 3 ? P.s : P.p}" stroke="${P.d}" stroke-width=".4" transform="rotate(${f(deg + (k % 2 ? 50 : -50))} ${x} ${y})"/>`, -Math.PI / 2 + Math.PI / (2 * m)) +
        (tier >= 4 ? around(m, RMID, (x, y) => `<circle cx="${x}" cy="${y}" r="2" fill="${P.s}"/>`) : "");
    }
    case "cooking": return around(n(10), RMID, (x, y, deg, k) => `<g transform="translate(${x} ${y}) rotate(${f(deg)}) scale(1.55)">${k % 2
      ? `<ellipse cx="3.4" rx="2.4" ry="1.7" fill="${i}"/><path d="M1.4 0H-5" stroke="${i}" stroke-width="1.2"/>`
      : `<path d="M-5 0H1M1-1.6h4M1 0h4M1 1.6h4M1-1.6V1.6" stroke="${i}" stroke-width="1" fill="none"/>`}</g>`);
    case "chore": return around(n(56), RMID, (x, y, deg, k, a) => { const [x1, y1] = polar(100, 100, RIN + 1, a + (k % 2 ? 0.01 : -0.01)), [x2, y2] = polar(100, 100, ROUT - (k % 3), a); return `<path d="M${x1},${y1}L${x2},${y2}" stroke="${k % 4 ? e : i}" stroke-width="1.5" opacity=".95"/>`; }) +
      around(4, RMID, (x, y) => `<circle cx="${x}" cy="${y}" r="5" fill="${P.d}"/>` + tok("chore", x, y, 0.62, P.a), -Math.PI / 4);
    case "study": {
      const glyphs = "π ∑ √ ∞ ∫ Δ λ φ θ Ω α β".split(" "), m = n(10);
      return around(m, RMID, (x, y, deg, k) => `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="11.5" fill="${k % 2 ? i : e}" transform="rotate(${f(deg + 90)} ${x} ${y})">${glyphs[k % glyphs.length]}</text>`);
    }
    case "outdoors": return around(n(12), RMID, (x, y, deg, k) => `<g transform="translate(${x} ${y}) rotate(${f(deg - 90)}) scale(1.4)"><path d="M0-4.6L3 .6H1.2L3.6 4H-3.6L-1.2.6H-3z" fill="${k % 3 ? e : i}"/></g>`) +
      ["N", "E", "S", "W"].map((L, k) => { const [x, y] = polar(100, 100, RMID, -Math.PI / 2 + (k * Math.PI) / 2); return `<circle cx="${x}" cy="${y}" r="7" fill="${P.d}" stroke="${i}" stroke-width=".9"/><text x="${x}" y="${f(y + 0.3)}" text-anchor="middle" dominant-baseline="central" font-family="Georgia,serif" font-weight="700" font-size="8.5" fill="${i}">${L}</text>`; }).join("");
    case "sleep": { const m = 8 + (tier >= 7 ? 4 : 0); return around(m, RMID, (x, y, deg, k) => { const ph = Math.cos((k / m) * 2 * Math.PI); return `<circle cx="${x}" cy="${y}" r="6" fill="${i}"/><path d="M${x},${f(y - 6)}A6,6 0 0 ${ph > 0 ? 1 : 0} ${x},${f(y + 6)}A${f(Math.abs(ph) * 6 + 0.01)},6 0 0 ${ph > 0 ? 0 : 1} ${x},${f(y - 6)}Z" fill="${P.d}" opacity=".85"/>`; }) +
      around(m, RMID, (x, y) => `<circle cx="${x}" cy="${y}" r="1" fill="${i}"/>`, -Math.PI / 2 + Math.PI / m); }
    case "call": return around(n(14), RMID, (x, y, deg, k) => `<circle cx="${x}" cy="${y}" r="6.6" fill="none" stroke="${k % 2 ? i : e}" stroke-width="2.1"/>`);
    case "volunteer": return around(n(12), RMID, (x, y, deg, k, a) => { const m = n(12), [hx, hy] = polar(100, 100, ROUT - 3.4, a), [ax, ay] = polar(100, 100, RIN + 3, a + Math.PI / m), [bx, by] = polar(100, 100, RIN + 3, a - Math.PI / m), [cx, cy] = polar(100, 100, RMID + 1, a); return `<circle cx="${hx}" cy="${hy}" r="3.3" fill="${i}"/><path d="M${bx},${by}Q${cx},${cy} ${ax},${ay}" stroke="${e}" stroke-width="2.8" fill="none" stroke-linecap="round"/>`; });
    case "art": { const cols = [P.p, P.s, P.a, P.g1, P.g2, P.m]; return around(n(12), RMID, (x, y, deg, k, a) => { const r0 = 4.2 + rnd(`${cat}${tier}${k}`) * 3; const [dx, dy] = polar(100, 100, RMID + 5.2, a + 0.09); return `<circle cx="${x}" cy="${y}" r="${f(r0)}" fill="${cols[k % cols.length]}" stroke="${P.d}" stroke-width=".4"/><circle cx="${dx}" cy="${dy}" r="1.4" fill="${cols[k % cols.length]}"/>`; }); }
    case "mindfulness": return around(n(14), RMID, (x, y, deg, k) => `<path d="M0 5.4C-2.8 1.6-2.8-2 0-5.4 2.8-2 2.8 1.6 0 5.4z" fill="${k % 2 ? i : P.s}" transform="translate(${x} ${y}) rotate(${f(deg + 90)}) scale(1.4)" opacity=".95"/>`) +
      `<circle cx="100" cy="100" r="${RIN + 1.2}" fill="none" stroke="${i}" stroke-width=".7" opacity=".7"/><circle cx="100" cy="100" r="${ROUT - 1.2}" fill="none" stroke="${i}" stroke-width=".7" opacity=".7"/>`;
    case "work": return around(96, ROUT - 3.5, (x, y, deg, k, a) => { const [x1, y1] = polar(100, 100, ROUT - 1, a), [x2, y2] = polar(100, 100, ROUT - 6, a); return `<path d="M${x1},${y1}L${x2},${y2}" stroke="${e}" stroke-width=".8" opacity=".85"/>`; }) +
      [0, Math.PI].map((a) => { const [x, y] = polar(100, 100, RMID - 2.5, a); return `<rect x="${f(x - 4)}" y="${f(y - 5)}" width="8" height="10" rx="1.6" fill="${i}" stroke="${P.d}" stroke-width=".8"/><circle cx="${x}" cy="${y}" r="1.6" fill="${P.d}"/>`; }).join("") +
      around(8, RIN + 3.2, (x, y) => `<circle cx="${x}" cy="${y}" r="1.1" fill="${i}"/>`, -Math.PI / 2 + Math.PI / 8);
  }
  return "";
}
// faint engraving in the disc behind the emblem (the category's texture), tiers 4+
function discTexture(cat, tier, P) {
  const o = tier >= 10 ? 0.22 : 0.14;
  switch (cat) {
    case "work": { let s = ""; for (let k = 50; k <= 150; k += 10) s += `M${k},44V156M44,${k}H156`; return `<path d="${s}" stroke="${P.a}" stroke-width=".5" opacity="${o}"/>`; }
    case "study": return `<g fill="none" stroke="${P.a}" stroke-width=".8" opacity="${o + 0.05}"><ellipse cx="100" cy="100" rx="52" ry="18"/><ellipse cx="100" cy="100" rx="52" ry="18" transform="rotate(60 100 100)"/><ellipse cx="100" cy="100" rx="52" ry="18" transform="rotate(-60 100 100)"/></g>`;
    case "worship": return `<path d="M62 158V96a38 38 0 0 1 76 0v62" fill="none" stroke="${P.a}" stroke-width="1" opacity="${o}"/><path d="M100 58v100M62 110h76" stroke="${P.a}" stroke-width=".6" opacity="${o}"/>`;
    case "prayer": return around(24, 44, (x, y, deg, k, a) => { const [x1, y1] = polar(100, 100, 18, a); return `<path d="M${x1},${y1}L${x},${y}" stroke="${P.a}" stroke-width=".6" opacity="${o}"/>`; });
    case "mindfulness": case "chore": return [22, 36, 50].map((r) => `<circle cx="100" cy="100" r="${r}" fill="none" stroke="${P.a}" stroke-width=".6" opacity="${o}"/>`).join("");
    case "outdoors": return `<path d="M44 138l22-26 14 14 20-30 22 26 16-14 18 28" fill="none" stroke="${P.a}" stroke-width=".9" opacity="${o}"/>`;
    case "sleep": return around(14, 46, (x, y, deg, k) => `<circle cx="${f(x + (k % 3) * 2)}" cy="${y}" r="${0.6 + (k % 3) * 0.3}" fill="${P.a}" opacity="${o + 0.2}"/>`);
    case "practice": return [84, 92, 100, 108, 116].map((y) => `<path d="M44 ${y}H156" stroke="${P.a}" stroke-width=".5" opacity="${o}"/>`).join("");
    case "reading": return [60, 72, 84, 96, 108, 120, 132, 144].map((y) => `<path d="M54 ${y}H146" stroke="${P.a}" stroke-width=".5" opacity="${o}"/>`).join("");
    case "writing": return `<path d="M50 70c20-10 30 10 50 0s30-10 50 0M50 100c20-10 30 10 50 0s30-10 50 0M50 130c20-10 30 10 50 0s30-10 50 0" fill="none" stroke="${P.a}" stroke-width=".6" opacity="${o}"/>`;
    case "art": return around(9, 44, (x, y, deg, k) => `<circle cx="${x}" cy="${y}" r="${3 + (k % 3) * 2}" fill="${[P.p, P.s, P.a][k % 3]}" opacity="${o}"/>`);
    case "call": return around(6, 40, (x, y) => `<circle cx="${x}" cy="${y}" r="16" fill="none" stroke="${P.a}" stroke-width=".6" opacity="${o}"/>`);
    default: return `<g opacity="${o}">${around(10, 46, (x, y) => tok(cat, x, y, 0.5, P.a, P.d))}</g>`;
  }
}
// the side ornaments (tiers 8+): each category's own sprays, laurels, crossed tools or hangings
function sides(cat, tier, P, mid, lvl) {
  const leaves = (col, stroke, shape = "leaf") => {
    const n = lvl > 1 ? 9 : 6, s = [];
    for (const side of [-1, 1]) for (let k = 0; k < n; k++) { const a = Math.PI / 2 + side * (0.62 + k * 0.19), [x, y] = polar(100, 100, 89, a); const rot = (a * 180) / Math.PI + (side > 0 ? 0 : 180);
      s.push(shape === "pine" ? `<path d="M0-4.5L6 0 0 4.5z" fill="${col}" stroke="${stroke}" stroke-width=".4" transform="translate(${x} ${y}) rotate(${f(rot + side * 70)})"/>` : `<ellipse cx="${x}" cy="${y}" rx="7" ry="2.9" transform="rotate(${f(rot + side * 38)} ${x} ${y})" fill="${col}" stroke="${stroke}" stroke-width=".5"/>`); }
    return s.join("");
  };
  const arcTokens = (n, r = 90, s = 0.62) => { let s2 = ""; for (const side of [-1, 1]) for (let k = 0; k < n; k++) { const a = Math.PI / 2 + side * (0.75 + k * 0.34), [x, y] = polar(100, 100, r, a); s2 += tok(cat, x, y, s, P.a, P.d); } return s2; };
  const crossed = (a, b) => `<g transform="translate(100 100) scale(1.16) translate(-100 -100)"><g transform="rotate(-42 100 100)">${a}</g><g transform="rotate(42 100 100)">${b}</g></g>`;
  switch (cat) {
    case "workout": case "sports": return leaves(mid, P.d);
    case "eating": return leaves(P.p, P.d) + arcTokens(2, 93, 0.55);
    case "outdoors": return leaves(P.p, P.d, "pine");
    case "prayer": return leaves(P.a, P.m);
    case "reading": return `<path d="M84 176v22l7-5 7 5v-22z" fill="${P.s}" stroke="${P.d}" stroke-width=".8"/><path d="M103 176v16l5-4 5 4v-16z" fill="${P.p}" stroke="${P.d}" stroke-width=".8"/>` + (lvl > 1 ? arcTokens(1, 93, 0.6) : "");
    case "study": return `<path d="M164 58c6 12 8 26 6 40" stroke="${P.a}" stroke-width="2" fill="none"/><path d="M166 96l4 14 4-14z" fill="${P.a}"/><circle cx="164" cy="58" r="3" fill="${P.a}"/>` + arcTokens(lvl > 1 ? 2 : 1, 92, 0.55);
    case "cooking": return crossed(`<g><rect x="97.5" y="2" width="5" height="44" rx="2" fill="${mid}" stroke="${P.d}" stroke-width=".6"/><ellipse cx="100" cy="2" rx="6.5" ry="8" fill="${mid}" stroke="${P.d}" stroke-width=".6"/></g>`, `<g fill="none" stroke="${mid}" stroke-width="1.8"><path d="M100 46V12"/><path d="M100 12c-9-6-9-14 0-16 9 2 9 10 0 16zM100 12c-4-6-4-12 0-16 4 4 4 10 0 16z"/></g>`);
    case "chore": return crossed(`<g><rect x="98.5" y="0" width="3" height="36" fill="${mid}"/><path d="M92 36h16l3 12H89z" fill="${P.s}" stroke="${P.d}" stroke-width=".6"/><path d="M93 40v8M97 40v8M101 40v8M105 40v8" stroke="${P.d}" stroke-width=".5"/></g>`, `<g><rect x="98.5" y="0" width="3" height="36" fill="${mid}"/><path d="M93 36h14l-2 10H95z" fill="${P.g2}" stroke="${P.d}" stroke-width=".6"/></g>`);
    case "art": return crossed(`<g><rect x="98.6" y="2" width="2.8" height="38" rx="1.2" fill="${P.m}"/><path d="M97 40h6l-1 8c0 3-4 3-4 0z" fill="${P.p}"/></g>`, `<g><rect x="98.6" y="2" width="2.8" height="38" rx="1.2" fill="${P.s}"/><path d="M97 40h6l-1 8c0 3-4 3-4 0z" fill="${P.a}"/></g>`);
    case "worship": return [-1, 1].map((side) => { const [x, y] = polar(100, 100, 90, Math.PI / 2 + side * 1.0); return `<path d="M${f(x - 6)},${f(y + 8)}V${f(y - 1)}a6 6 0 0 1 12 0V${f(y + 8)}z" fill="${P.s}" stroke="${P.d}" stroke-width=".8"/><path d="M${x},${f(y - 4)}V${f(y + 8)}" stroke="${P.d}" stroke-width=".6"/>`; }).join("") + arcTokens(1, 93, 0.5);
    case "volunteer": return `<path d="M166 40v10" stroke="${P.m}" stroke-width="1.4"/>${tok("volunteer", 166, 60, 1.15, P.s, P.a)}` + arcTokens(lvl > 1 ? 2 : 1, 92, 0.55);
    case "writing": return `<path d="M20 122c-10-16-6-34 8-40 10-4 16 6 10 12-5 4-10-2-6-6M180 122c10-16 6-34-8-40-10-4-16 6-10 12 5 4 10-2 6-6" fill="none" stroke="${mid}" stroke-width="2.2" stroke-linecap="round"/>` + arcTokens(1, 94, 0.5);
    default: return arcTokens(lvl > 1 ? 3 : 2);
  }
}


// ---- frame ornaments: big category objects on the frame's sides (and, from tier 4, its top) --------------------------
// Drawn for the LEFT side centred at (0,0), about 30 units tall; the right side is mirrored unless SIDE_R has its own.
// They sit on the frame, tucked under the rim band's edge, so they read as part of the medallion, even at 48 px.
// M = the metal, P = the palette
const SIDE = {
  workout: (M, P) => `<rect x="-6" y="-3.2" width="16" height="6.4" rx="1.5" fill="${M}" stroke="${P.d}" stroke-width="1"/><rect x="-17" y="-16" width="7.5" height="32" rx="2.4" fill="${P.p}" stroke="${P.d}" stroke-width="1.2"/><rect x="-9.5" y="-11.5" width="5.5" height="23" rx="2" fill="${P.s}" stroke="${P.d}" stroke-width="1.1"/><rect x="-21" y="-5" width="4" height="10" rx="1" fill="${M}" stroke="${P.d}" stroke-width="1"/><path d="M-15.3-13v26" stroke="#fff" stroke-width="1.2" opacity=".45"/>`,
  sports: (M, P) => `<path d="M9-17a17 17 0 0 0 0 34z" fill="#fff" stroke="${P.d}" stroke-width="1.3"/><path d="M4-14c-6 6-6 22 0 28" fill="none" stroke="#D94F4F" stroke-width="1.6"/><path d="M1-10l5 1M-1-5l5 .5M-1.6 0h5M-1 5l5-.5M1 10l5-1" stroke="#D94F4F" stroke-width="1.3"/>`,
  worship: (M, P) => `<path d="M-10 15V0c0-8 10-15 10-17 0 2 10 9 10 17v15z" fill="${M}" stroke="${P.d}" stroke-width="1.2"/><path d="M-6.5 12.5V0c0-5 6.5-10 6.5-11.5V12.5z" fill="#4FA3D9"/><path d="M6.5 12.5V0c0-5-6.5-10-6.5-11.5V12.5z" fill="#D94F6A"/><path d="M-6.5 4h13" stroke="${P.d}" stroke-width="1"/><path d="M0-11.5v24" stroke="${P.d}" stroke-width="1"/><circle cx="0" cy="-3" r="2.4" fill="${P.s}"/>`,
  prayer: (M, P) => `${[-0.6, -0.3, 0, 0.3, 0.6].map((a, i) => { const x = -22 * Math.cos(a), y = 22 * Math.sin(a); return `<path d="M4 ${f(-2.2 + a * 4)}L${f(x)} ${f(y)}L4 ${f(2.2 + a * 4)}z" fill="${i % 2 ? P.a : P.s}" stroke="${P.d}" stroke-width=".7"/>`; }).join("")}<circle cx="4" cy="0" r="5" fill="${M}" stroke="${P.d}" stroke-width="1"/>`,
  eating: (M, P) => `<path d="M6 17c-11-5-14-19-6-32" fill="none" stroke="#3E7D3E" stroke-width="2.6" stroke-linecap="round"/>${[[-6, 8, 30], [-8, -4, -20], [-2, -13, 40]].map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="7" ry="3.6" transform="rotate(${r} ${x} ${y})" fill="${P.p}" stroke="${P.d}" stroke-width=".9"/>`).join("")}<circle cx="1" cy="3" r="3.4" fill="${P.s}" stroke="${P.d}" stroke-width=".8"/>`,
  chore: (M, P) => `<path d="M4-7.5H-2L-18-15v30L-2 7.5h6z" fill="${P.s}" stroke="${P.d}" stroke-width="1.2"/><path d="M-4-6.5L-17-11M-4-3L-17-4.5M-4 0H-17M-4 3L-17 4.5M-4 6.5L-17 11" stroke="${P.d}" stroke-width=".8" opacity=".6"/><rect x="0" y="-8.5" width="6" height="17" rx="1.2" fill="${M}" stroke="${P.d}" stroke-width="1"/><path d="M-20-19l1.2 3.2 3.2 1.2-3.2 1.2-1.2 3.2-1.2-3.2-3.2-1.2 3.2-1.2z" fill="${P.a}" stroke="${P.d}" stroke-width=".5"/>`,
  study: (M, P) => `<path d="M6-15c-7 3-9 10-7 17" fill="none" stroke="${P.a}" stroke-width="2"/><circle cx="-1" cy="3" r="3.4" fill="${M}" stroke="${P.d}" stroke-width=".9"/><path d="M-6 5.5h10l2.4 14h-14.8z" fill="${P.a}" stroke="${P.d}" stroke-width="1"/><path d="M-4 9v9M-1 9v10M2 9v9" stroke="${P.d}" stroke-width=".7" opacity=".6"/>`,
  reading: (M, P) => `<rect x="-11" y="-17" width="16" height="32" rx="2" fill="${P.p}" stroke="${P.d}" stroke-width="1.2"/><rect x="-8" y="-15" width="11" height="28" fill="${P.a}"/>${[-12, -9, -6, -3, 0, 3, 6, 9].map((y) => `<path d="M-8 ${y}h11" stroke="${P.d}" stroke-width=".5" opacity=".45"/>`).join("")}<path d="M-3 13v11l3-3 3 3V13z" fill="${P.s}" stroke="${P.d}" stroke-width=".9"/>`,
  practice: (M, P) => `${[-8, -4, 0, 4, 8].map((y) => `<path d="M-20 ${y}H8" stroke="${M}" stroke-width="1.1"/>`).join("")}<path d="M-4 17c-5 2-8-3-4-5 4-1 5 3 1 5-6 2-11-2-9-9 2-8 11-9 13-3 2 6-5 9-7 5-2-5 1-17 5-23 3-4 6 0 2 6L-8 22" fill="none" stroke="${P.d}" stroke-width="4" stroke-linecap="round"/><path d="M-4 17c-5 2-8-3-4-5 4-1 5 3 1 5-6 2-11-2-9-9 2-8 11-9 13-3 2 6-5 9-7 5-2-5 1-17 5-23 3-4 6 0 2 6L-8 22" fill="none" stroke="${P.a}" stroke-width="2" stroke-linecap="round"/>`,
  call: (M, P) => `<circle cx="-5" cy="-5.5" r="7.5" fill="none" stroke="${P.d}" stroke-width="5"/><circle cx="-5" cy="5.5" r="7.5" fill="none" stroke="${P.d}" stroke-width="5"/><circle cx="-5" cy="-5.5" r="7.5" fill="none" stroke="${M}" stroke-width="3"/><circle cx="-5" cy="5.5" r="7.5" fill="none" stroke="${P.s}" stroke-width="3"/><path d="M-12.4-4.2a7.5 7.5 0 0 0 1.2 3.4" stroke="${M}" stroke-width="3" fill="none"/>`,
  writing: (M, P) => `<path d="M6 12C-2 6-15-6-12-20c9 4 17 17 18 32z" fill="${P.a}" stroke="${P.d}" stroke-width="1.1"/><path d="M6 12C0 2-6-8-11-18" stroke="${P.d}" stroke-width=".9" fill="none" opacity=".6"/><path d="M6 12l1.5 6" stroke="${P.d}" stroke-width="1.6"/><path d="M-10 6c2.5 4 4 6 4 8a4 4 0 0 1-8 0c0-2 1.5-4 4-8z" fill="${P.s}" stroke="${P.d}" stroke-width=".8"/>`,
  outdoors: (M, P) => `<path d="M8 13L0 0l-5 6-7-15-11 22z" fill="${P.p}" stroke="${P.d}" stroke-width="1.2" stroke-linejoin="round"/><path d="M-12-9l3.4 7.2-3-1.2-2 2.6-1.8-2z" fill="#fff"/><path d="M0 0l2.6 4.2-2.6-.6-1.4 1.8z" fill="#fff" opacity=".9"/>`,
  sleep: (M, P) => `<path d="M-15-2l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z" fill="${P.a}"/>` + [[-13, 1], [0, 0.4], [13, -0.4]].map(([y, ph]) => `<circle cx="-3" cy="${y}" r="6.2" fill="${P.a}" stroke="${P.d}" stroke-width=".9"/><path d="M-3 ${f(y - 6.2)}A6.2 6.2 0 0 0 -3 ${f(y + 6.2)}A${f(Math.abs(ph) * 6.2 + 0.01)} 6.2 0 0 ${ph > 0 ? 1 : 0} -3 ${f(y - 6.2)}z" fill="${P.d}" opacity=".8"/>`).join(""),
  cooking: (M, P) => `<ellipse cx="-3" cy="-11" rx="5.6" ry="7.4" fill="${M}" stroke="${P.d}" stroke-width="1.1"/><ellipse cx="-4" cy="-12" rx="2" ry="3.4" fill="#fff" opacity=".5"/><rect x="-4.6" y="-4" width="3.2" height="22" rx="1.6" fill="${M}" stroke="${P.d}" stroke-width="1"/>`,
  volunteer: (M, P) => `<path d="M8 14c-6 1-13-1-16-6l-4-9c-1-2.4 2-3.6 3.4-1.6L-6 3V-13c0-2.4 3.4-2.4 3.4 0v9-12c0-2.4 3.4-2.4 3.4 0v12-10c0-2.4 3.4-2.4 3.4 0v11-7c0-2.4 3.4-2.4 3.4 0V6c0 4-.4 6-1.6 8z" fill="${P.a}" stroke="${P.d}" stroke-width="1.1" stroke-linejoin="round"/>`,
  art: (M, P, right) => `<path d="M-11-14c4-4 16-4 20 0v8c0 3-2.6 3-2.6 0v14c0 3.4-4.4 3.4-4.4 0V-2c0 3-3 3-3 0v18c0 3.4-4.4 3.4-4.4 0V-4c0 2.4-3 2.4-3 0v7c0 3-2.6 3-2.6 0z" fill="${right ? P.s : P.p}" stroke="${P.d}" stroke-width="1"/><ellipse cx="-4" cy="-11" rx="4" ry="1.6" fill="#fff" opacity=".45"/>`,
  mindfulness: (M, P) => `${[-40, 0, 40].map((r, i) => `<path transform="rotate(${r - 90} 4 0)" d="M4 0c-5-7-5-15 0-21 5 6 5 14 0 21z" fill="${i === 1 ? P.s : P.a}" stroke="${P.d}" stroke-width=".9"/>`).join("")}<path d="M-14 14c4-2 8 2 12 0M-12 19c4-2 8 2 12 0" stroke="${P.g1}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
  work: (M, P) => `${[8, 3, -2, -7].map((y) => `<ellipse cx="-4" cy="${y}" rx="10" ry="3.8" fill="${M}" stroke="${P.d}" stroke-width="1"/>`).join("")}<ellipse cx="-4" cy="-12" rx="10" ry="3.8" fill="${P.m}" stroke="${P.d}" stroke-width="1"/>`,
};
const SIDE_R = {
  study: (M, P) => `<rect x="-14" y="-12" width="22" height="24" rx="3" fill="${P.p}" stroke="${M}" stroke-width="1.6"/><text x="-3" y="-1" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="9" fill="${P.a}">π²</text><text x="-3" y="9" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="7" fill="${P.a}">∑x</text>`,
  practice: (M, P) => `${[-8, -4, 0, 4, 8].map((y) => `<path d="M-8 ${y}H20" stroke="${M}" stroke-width="1.1"/>`).join("")}<path d="M-2-5c1-6 11-7 12 0 1 8-7 14-14 17" fill="none" stroke="${P.d}" stroke-width="4" stroke-linecap="round"/><path d="M-2-5c1-6 11-7 12 0 1 8-7 14-14 17" fill="none" stroke="${P.a}" stroke-width="2" stroke-linecap="round"/><circle cx="14" cy="-5" r="1.8" fill="${P.a}" stroke="${P.d}" stroke-width=".6"/><circle cx="14" cy="2" r="1.8" fill="${P.a}" stroke="${P.d}" stroke-width=".6"/>`,
  cooking: (M, P) => `<path d="M-1-19v8c0 3 2 5 4 5s4-2 4-5v-8" fill="none" stroke="${P.d}" stroke-width="3.4"/><path d="M-1-19v8c0 3 2 5 4 5s4-2 4-5v-8M3-19v9" fill="none" stroke="${M}" stroke-width="1.8"/><rect x="1.4" y="-6" width="3.2" height="24" rx="1.6" fill="${M}" stroke="${P.d}" stroke-width="1"/>`,
  work: (M, P) => `<rect x="-9" y="-13" width="24" height="26" rx="2" fill="${P.p}" stroke="${M}" stroke-width="1.6"/><path d="M-3-13v26M3-13v26M9-13v26M-9-6h24M-9 0h24M-9 6h24" stroke="${P.a}" stroke-width=".5" opacity=".45"/><path d="M-7 9l6-6 5 3 8-10" fill="none" stroke="${P.g2}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M14-8l-1 5-4-2z" fill="${P.g2}"/>`,
};
const around0 = (n, r, fn) => { let s = ""; for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; s += fn(f(r * Math.cos(a)), f(r * Math.sin(a)), i); } return s; };
const TOP = {
  workout: (M, P) => `<circle r="11" fill="${P.p}" stroke="${P.d}" stroke-width="1.2"/><circle r="6.4" fill="${M}" stroke="${P.d}" stroke-width=".8"/><circle r="2.4" fill="${P.d}"/>${around0(6, 8.7, (x, y) => `<circle cx="${x}" cy="${y}" r="1.1" fill="${P.a}"/>`)}`,
  worship: (M, P) => `<path d="M-2.6-13h5.2v6h6v5h-6v14h-5.2V-2h-6v-5h6z" fill="${M}" stroke="${P.d}" stroke-width="1.1"/>`,
  prayer: (M, P) => `<path d="M0-11c-3-2-6 0-6.4 4L-7.4 4-10 9H0z" fill="${P.a}" stroke="${P.d}" stroke-width="1"/><path d="M0-11c3-2 6 0 6.4 4L7.4 4 10 9H0z" fill="${P.s}" stroke="${P.d}" stroke-width="1"/>`,
  chore: (M, P) => `<path d="M0-12l2.6 8.4L11 0 2.6 2.6 0 11l-2.6-8.4L-11 0l8.4-2.6z" fill="${P.a}" stroke="${P.d}" stroke-width="1"/>`,
  study: (M, P) => `<path d="M0-9L17-2 0 5-17-2z" fill="${P.d}" stroke="${M}" stroke-width="1.2"/><path d="M-9 2v5c0 3.4 18 3.4 18 0V2L0 5z" fill="${P.p}" stroke="${P.d}" stroke-width="1"/><path d="M13-1v8" stroke="${P.a}" stroke-width="1.4"/><circle cx="13" cy="8" r="1.8" fill="${P.a}"/>`,
  outdoors: (M, P) => `<circle r="10.5" fill="${P.d}" stroke="${M}" stroke-width="1.6"/><path d="${star(4, 9.5, 2.6, -Math.PI / 2, 0, 0)}" fill="${M}"/><path d="M0-9.5L2.6 0h-5.2z" fill="${P.a}"/>`,
  sleep: (M, P) => `<path d="M3-10A10 10 0 1 0 10 5 7.6 7.6 0 1 1 3-10z" fill="${P.a}" stroke="${P.d}" stroke-width="1"/><path d="M12-10l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z" fill="${P.a}"/>`,
  cooking: (M, P) => `<path d="M-6 8c-4-6 4-10 0-16M0 8c-4-6 4-10 0-16M6 8c-4-6 4-10 0-16" fill="none" stroke="${P.d}" stroke-width="4" stroke-linecap="round"/><path d="M-6 8c-4-6 4-10 0-16M0 8c-4-6 4-10 0-16M6 8c-4-6 4-10 0-16" fill="none" stroke="${P.a}" stroke-width="2" stroke-linecap="round"/>`,
  volunteer: (M, P) => `<path d="M-4-13c0-4 8-4 8 0" stroke="${P.d}" stroke-width="1.4" fill="none"/><path d="M-7-10h14l-2 3H-5z" fill="${M}" stroke="${P.d}" stroke-width=".8"/><rect x="-5.5" y="-7" width="11" height="15" rx="2" fill="${P.g1}" stroke="${P.d}" stroke-width="1"/><path d="M0-4c2 3 3 4 3 6a3 3 0 0 1-6 0c0-2 1-3 3-6z" fill="${P.s}"/><path d="M-7 8h14l-2 3H-5z" fill="${M}" stroke="${P.d}" stroke-width=".8"/>`,
  art: (M, P) => `<path d="M-9-6c3-6 15-6 18 0 3 5-1 7-3 5v8c0 3-3.6 3-3.6 0V2c0 2-3 2-3 0v10c0 3-3.6 3-3.6 0V0c-3 1-7-1-4.8-6z" fill="${P.a}" stroke="${P.d}" stroke-width="1"/>`,
  mindfulness: (M, P) => `<path transform="scale(1.7)" d="M0 5C-2 1.5-2-2.5 0-6.5 2-2.5 2 1.5 0 5zM0 5C-4 4-6 1-6.5-2.5-3.5-1.5-1.5 1 0 5zM0 5C4 4 6 1 6.5-2.5 3.5-1.5 1.5 1 0 5z" fill="${P.s}" stroke="${P.d}" stroke-width=".5"/>`,
};
// the ornaments for a tier: big ones at the shoulders from tier 1 (growing with the tier), a topper from tier 4, and
// smaller ones on the sides from tier 7 (unless the crest's wings are there)
function frameMotif(cat, tier, P, M, sidesToo = true) {
  const s = tier <= 3 ? 1.2 : tier <= 6 ? 1.3 : tier <= 12 ? 1.38 : 1.45;
  const flipR = !SIDE_R[cat], Rt = (SIDE_R[cat] ?? SIDE[cat])(M, P, true);
  let out = "";
  for (const side of [-1, 1]) {
    const ang = -Math.PI / 2 + side * 0.84, [x, y] = polar(100, 100, 85, ang);
    const rot = side < 0 ? f((ang * 180) / Math.PI + 180) : f((ang * 180) / Math.PI);
    out += side < 0 ? `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">${SIDE[cat](M, P, false)}</g>`
                    : `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${flipR ? -s : s} ${s})">${Rt}</g>`;
  }
  if (tier >= 7 && sidesToo) out += `<g transform="translate(11 100) scale(.92)">${SIDE[cat](M, P, false)}</g><g transform="translate(189 100) scale(${flipR ? -0.92 : 0.92} .92)">${Rt}</g>`;
  if (tier >= 4) { const top = TOP[cat] ? TOP[cat](M, P) : `<circle r="10.5" fill="${M}" stroke="${P.d}" stroke-width="1.1"/>${tok(cat, 0, 0, 1.25, P.d, P.a)}`; out += `<g transform="translate(100 ${tier >= 7 ? 12 : 14}) scale(${tier >= 10 ? 1.15 : 1})">${top}</g>`; }
  return out;
}
// the crest's small side wings (tiers 11–12), up at its shoulders
function crestWings(lvl, P, M) {
  const n = 2 + lvl; let w = "";
  for (let i = 0; i < n; i++) w += `<path d="M0 ${i * 5}c-${10 + i} -${6 - i} -${22 - i * 3} -${5 - i} -${28 - i * 4} ${2 + i * 2} ${10 - i * 2} 1 ${20 - i * 3} 1 ${28 - i * 4} -2z" fill="${M}" stroke="${P.d}" stroke-width=".8"/>`;
  return [-1, 1].map((side) => `<g transform="translate(${100 + side * 78} 76) rotate(${side * -22}) scale(${-side} 1)">${w}</g>`).join("");
}
// a half (lvl 1) or full (lvl 2) laurel in the metal around the lower sides
function laurelWreath(lvl, P, M) {
  const n = lvl > 1 ? 7 : 4, s = [];
  for (const side of [-1, 1]) {
    const a0 = Math.PI / 2 - side * 0.42, a1 = Math.PI / 2 - side * (lvl > 1 ? 1.3 : 0.9), [sx, sy] = polar(100, 100, 92, a0), [ex, ey] = polar(100, 100, 92, a1);
    s.push(`<path d="M${sx},${sy}A92,92 0 0,${side < 0 ? 0 : 1} ${ex},${ey}" fill="none" stroke="${P.d}" stroke-width="1.6"/>`);
    for (let k = 0; k < n; k++) { const a = a0 + ((a1 - a0) * (k + 0.5)) / n, [x, y] = polar(100, 100, 92, a), rot = (a * 180) / Math.PI + 90 - side * 35;
      s.push(`<ellipse cx="${x}" cy="${y}" rx="8" ry="3.3" transform="rotate(${f(rot)} ${x} ${y})" fill="${M}" stroke="${P.d}" stroke-width=".7"/>`); }
  }
  return s.join("");
}

// ---- the badge ------------------------------------------------------------------------------------------------------
let uidN = 0;
function colourSet(cat, tier, P) {
  const c = { fg: P.a, hi: "#fff", ac: P.s, dk: P.d, a: P.a, a2: P.g2, dk2: tier <= 3 ? P.d : P.m };
  if (cat === "art") Object.assign(c, { fg: P.p, ac: P.a, a2: P.s, dk2: P.g2 });
  if (cat === "sleep") c.ac = P.a;
  if (cat === "outdoors") Object.assign(c, { fg: P.s, hi: P.g2, ac: P.a, dk2: P.d });
  if (cat === "prayer") Object.assign(c, { fg: P.s });
  if (cat === "chore") Object.assign(c, { fg: P.s, dk2: "#8A5A2B" });
  if (cat === "study") Object.assign(c, { dk2: P.s });
  return c;
}
const stopsOf = (cols) => cols.map((col, i) => `<stop offset="${f((i / (cols.length - 1)) * 100)}%" stop-color="${col}"/>`).join("");
export function svg(cat, tier, { size = 160, mode = "full", uid = null, title = true, emblem = true, style = true } = {}) {
  const P = PALETTES[cat]; if (!P || !(tier >= 1 && tier <= TIERS)) throw new Error("No such badge.");
  const T = TIER[tier], id = uid ?? `b${cat.slice(0, 3)}${tier}x${(uidN++).toString(36)}`, lvl = stageOf(tier);
  const full = mode === "full", anim = mode !== "static";
  const name = NAMES[cat][tier - 1], label = BADGE_CATEGORIES[cat].label;
  const metal = METALS[T.metal](P);
  const defs = [], back = [], mid = [], front = [], top = [];
  const spinGrad = full && ["prismatic", "cosmic", "iridescent"].includes(T.metal) ? `<animateTransform attributeName="gradientTransform" type="rotate" from="0 .5 .5" to="360 .5 .5" dur="${T.metal === "iridescent" ? MOTION.prism.turn * 1.5 : MOTION.prism.turn}s" repeatCount="indefinite"/>` : "";
  defs.push(`<linearGradient id="${id}m" x1="0" y1="0" x2="1" y2="1">${stopsOf(metal)}${spinGrad}</linearGradient>`);
  defs.push(`<radialGradient id="${id}r" cx="50%" cy="50%" r="50%"><stop offset=".72" stop-color="${mix(P.p, P.d, 0.55)}"/><stop offset=".86" stop-color="${mix(P.p, P.d, 0.15)}"/><stop offset="1" stop-color="${mix(P.p, P.d, 0.6)}"/></radialGradient>`);   // the rim band: the category's own colour
  // the disc deepens with the tiers: soft → metallic sheen → jewel → deep jewel → cosmic
  const discCols = tier <= 3 ? [mix(P.p, "#fff", 0.25), P.p, P.d] : tier <= 9 ? [mix(P.p, P.g2, 0.4), P.p, P.d] : tier <= 15 ? [mix(P.p, P.g1, 0.5), P.p, mix(P.d, "#000", 0.3)] : [mix(P.g1, P.p, 0.3), P.p, P.d, "#05050c"];
  defs.push(`<radialGradient id="${id}d" cx="38%" cy="30%" r="80%">${stopsOf(discCols)}</radialGradient>`);
  defs.push(`<radialGradient id="${id}h" cx="50%" cy="0%" r="70%"><stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`);
  defs.push(`<radialGradient id="${id}i" cx="50%" cy="50%" r="50%"><stop offset=".82" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient>`);
  defs.push(`<linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`);
  if (T.nebula) defs.push(`<radialGradient id="${id}n" cx="30%" cy="30%" r="85%"><stop offset="0" stop-color="${P.g2}" stop-opacity=".95"/><stop offset=".45" stop-color="${P.p}"/><stop offset="1" stop-color="#05030f"/>${full ? `<animate attributeName="cx" values="30%;62%;30%" dur="20s" repeatCount="indefinite"/>` : ""}</radialGradient>`);
  defs.push(`<clipPath id="${id}c"><circle cx="100" cy="100" r="${ROUT}"/></clipPath>`);
  defs.push(`<filter id="${id}sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2.5" stdDeviation="2.5" flood-color="#000" flood-opacity=".4"/></filter>`);
  const fp = framePath(T.frame);

  // behind the frame: aura, rays, wings, crossed tools
  if (T.aura) defs.push(`<radialGradient id="${id}a"><stop offset=".55" stop-color="${P.g1}" stop-opacity=".75"/><stop offset="1" stop-color="${P.g1}" stop-opacity="0"/></radialGradient>`);
  if (T.aura) back.push(`<circle cx="100" cy="100" r="100" fill="url(#${id}a)" class="aura"/>${T.aura > 1 ? `<circle cx="100" cy="100" r="99" fill="none" stroke="url(#${id}m)" stroke-width="2.5" opacity=".75"/>` : ""}`);
  if (T.rays) {
    const n = 12 + T.rays * 6, rays = [];
    for (let i = 0; i < n; i++) { const a = (i * 2 * Math.PI) / n, [x1, y1] = polar(100, 100, 72, a), [x2, y2] = polar(100, 100, i % 2 ? 93 : 99, a - 0.05), [x3, y3] = polar(100, 100, i % 2 ? 93 : 99, a + 0.05); rays.push(`M${x1},${y1}L${x2},${y2}L${x3},${y3}Z`); }
    back.push(`<path d="${rays.join("")}" fill="${T.rays >= 2 ? mix(P.p, P.g1, 0.35) : P.g2}" opacity="${T.rays >= 2 ? 0.7 : 0.5}" class="rays"/>`);
  }
  if (T.wings) {
    const wing = (flip) => { const feathers = []; for (let i = 0; i < 4 + T.wings; i++) { const y = 66 + i * 12, len = 44 - i * 5; feathers.push(`<path d="M100 ${y}c-${f(len * 0.5)}-${6 + i}-${len}-${2 + i}-${len + 6} ${6 + i * 2} ${f(len * 0.5)} 2 ${len} 1 ${len + 6}-1z" fill="url(#${id}m)" stroke="${P.d}" stroke-width=".7" opacity="${f(1 - i * 0.05)}"/>`); } return `<g class="${flip ? "wingR" : "wingL"}"><g transform="${flip ? "translate(200 0) scale(-1 1)" : ""} translate(-50 -4)">${feathers.join("")}</g></g>`; };
    back.push(wing(false) + wing(true));
  }
  if (T.sides && ["cooking", "chore", "art"].includes(cat)) back.push(sides(cat, tier, P, `url(#${id}m)`, T.sides));
  if (T.cwings) back.push(crestWings(T.cwings, P, `url(#${id}m)`));

  // the frame, the rim band with the category's motif, the disc
  // in a grid the blurred drop shadow is swapped for a plain offset silhouette: it looks the same at grid size and
  // costs far less to paint across 100 badges
  if (mode === "grid") mid.push(`<g transform="translate(0 2.5)" fill="#000" opacity=".35">${fp ? `<path d="${fp}"/>` : ""}<circle cx="100" cy="100" r="${fp ? 82 : 88}"/></g>`);
  mid.push(`<g${mode === "grid" ? "" : ` filter="url(#${id}sh)"`}>${fp ? `<path d="${fp}" fill="url(#${id}m)"/>` : ""}<circle cx="100" cy="100" r="${fp ? 82 : 88}" fill="url(#${id}m)"/>${T.frame === "medallion" || T.frame === "compass" ? around(8, 93, (x, y) => `<circle cx="${x}" cy="${y}" r="2.6" fill="${P.a}" stroke="${P.d}" stroke-width=".7"/>`, T.frame === "compass" ? -Math.PI / 2 : -Math.PI / 2 + Math.PI / 8) : ""}${T.frame === "celestial" || T.frame === "legend" ? around(12, 96, (x, y) => `<circle cx="${x}" cy="${y}" r="3.2" fill="${P.a}" stroke="${P.d}" stroke-width=".8"/>`) : ""}${T.laurel ? laurelWreath(T.laurel, P, `url(#${id}m)`) : ""}${frameMotif(cat, tier, P, `url(#${id}m)`)}</g>`);
  if (fp) mid.push(`<path d="${fp}" fill="none" stroke="#fff" stroke-width=".8" opacity=".45"/>`);
  if (tier >= 2) mid.push(around(Math.min(24, tier * 6), fp ? 81 : 84, (x, y) => `<circle cx="${x}" cy="${y}" r="1.25" fill="${P.a}" opacity=".85"/>`));
  if (cat === "sports" && tier >= 13) mid.push(`<g fill="none" stroke="url(#${id}m)" stroke-width="7" stroke-linecap="round"><path d="M20 64c-18 0-18 46 10 50"/><path d="M180 64c18 0 18 46-10 50"/></g>`);   // trophy handles
  if (cat === "prayer" && tier >= 10) mid.push(`<circle cx="100" cy="100" r="95" fill="none" stroke="${P.g1}" stroke-width="3" opacity=".6" class="glow"/>`);   // the halo frame
  mid.push(`<circle cx="100" cy="100" r="${ROUT}" fill="url(#${id}r)"/>`);
  mid.push(`<g clip-path="url(#${id}c)">${rim(cat, tier, P, `url(#${id}m)`, P.a)}</g>`);
  mid.push(`<circle cx="100" cy="100" r="${ROUT}" fill="none" stroke="url(#${id}m)" stroke-width="2.4"/><circle cx="100" cy="100" r="${RIN}" fill="none" stroke="url(#${id}m)" stroke-width="2.2"/>`);
  mid.push(`<circle cx="100" cy="100" r="${DISC}" fill="${T.nebula ? `url(#${id}n)` : `url(#${id}d)`}"/>`);
  if (tier >= 4) mid.push(discTexture(cat, tier, P));
  for (let i = 1; i < T.rims; i++) mid.push(`<circle cx="100" cy="100" r="${DISC - 3 - (i - 1) * 3.5}" fill="none" stroke="${P.a}" stroke-width=".7" opacity=".45"/>`);
  if (T.ring) {
    const n = 60, ticks = []; for (let i = 0; i < n; i++) { const a = (i * 2 * Math.PI) / n, [x1, y1] = polar(100, 100, DISC - 1, a), [x2, y2] = polar(100, 100, i % 5 ? DISC - 3 : DISC - 5, a); ticks.push(`M${x1},${y1}L${x2},${y2}`); }
    mid.push(`<path d="${ticks.join("")}" stroke="${P.a}" stroke-width=".8" opacity=".6" class="ring"/>`);
    if (T.ring > 1) mid.push(`<circle cx="100" cy="100" r="${DISC - 8}" fill="none" stroke="${P.a}" stroke-width=".7" stroke-dasharray="1 3.5" opacity=".6" class="raysR"/>`);
  }
  mid.push(`<circle cx="100" cy="100" r="${DISC}" fill="url(#${id}i)"/>`);
  mid.push(`<circle cx="100" cy="96" r="38" fill="${P.g1}" opacity=".3" class="glow"/>`);

  if (emblem) {
    const es = tier <= 3 ? 0.9 : tier <= 12 ? 0.9 : 0.93, ey = T.ribbon ? 90 : 98;
    front.push(`<g transform="translate(100 ${ey}) scale(${es}) translate(-50 -50)"><g class="emb">${EMB[cat](lvl, colourSet(cat, tier, P))}</g></g>`);
  }
  front.push(`<ellipse cx="100" cy="64" rx="54" ry="28" fill="url(#${id}h)" opacity=".5"/>`);
  if (tier >= 4 && anim) front.push(`<g clip-path="url(#${id}c)"><rect x="40" y="0" width="36" height="200" fill="url(#${id}s)" transform="rotate(20 100 100)" class="sheen" opacity=".7"/></g>`);
  if (T.pips) { const n = T.pips, w = 6.5; for (let i = 0; i < n; i++) front.push(`<circle cx="${f(100 - ((n - 1) * w) / 2 + i * w)}" cy="${fp ? 188 : 183}" r="2.4" fill="${P.a}" stroke="${P.d}" stroke-width=".6"/>`); }
  if (T.sides && !["cooking", "chore", "art"].includes(cat) && !(T.laurel && ["workout", "sports", "eating", "outdoors", "prayer"].includes(cat))) front.push(sides(cat, tier, P, `url(#${id}m)`, T.sides));
  if (T.toks) { const n = T.toks, out = []; for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.3, [x, y] = polar(100, 100, 87, a); out.push(`<g>${tok(cat, x, y, 0.62, P.a, P.d)}</g>`); } front.push(`<g class="tok">${out.join("")}</g>`); }
  if (T.gems) {
    const cols = [P.s, P.g1, P.p, P.g2], own = ["call", "work", "sleep", "eating", "art", "practice", "mindfulness", "worship"].includes(cat);
    for (let i = 0; i < T.gems; i++) {
      // across the upper arc, centred on the top, so even one gem shows (the ribbon covers the lower rim)
      const step = T.gems > 5 ? 3.9 / (T.gems - 1) : 0.62, a = -Math.PI / 2 + (i - (T.gems - 1) / 2) * step, [x, y] = polar(100, 100, RMID, a);
      defs.push(`<radialGradient id="${id}g${i}" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="${cols[i % 4]}"/><stop offset="1" stop-color="${P.d}"/></radialGradient>`);
      front.push(`<g><circle cx="${x}" cy="${y}" r="6.4" fill="url(#${id}m)" stroke="${P.d}" stroke-width=".5"/>${own ? tok(cat, x, y, 0.62, `url(#${id}g${i})`, P.a) : `<path d="${star(4, 5.2, 3.4, 0, x, y)}" fill="url(#${id}g${i})"/>`}<path d="${star(4, 5, 1.1, 0, x, y)}" fill="#fff" class="gem" style="animation-delay:${f(i * (MOTION.glint.period / T.gems))}s"/></g>`);
    }
  }
  if (T.filigree) front.push(`<g fill="none" stroke="url(#${id}m)" stroke-width="1.6" opacity=".9"><path d="M62 176c-10-4-16-14-10-20 5-5 12 0 9 5M138 176c10-4 16-14 10-20-5-5-12 0-9 5"/></g>`);
  if (T.crown) {
    if (HALO.has(cat)) top.push(`<g class="crown"><ellipse cx="100" cy="10" rx="${T.crown > 1 ? 30 : 24}" ry="5.5" fill="none" stroke="url(#${id}m)" stroke-width="3.2"/><ellipse cx="100" cy="10" rx="${T.crown > 1 ? 30 : 24}" ry="5.5" fill="none" stroke="#fff" stroke-width=".8" opacity=".8"/></g>`);
    else if (LAURELCROWN.has(cat)) { const l2 = []; for (let i = 0; i < 7; i++) { const x = 72 + i * 9.3, y = 13 - Math.sin((i / 6) * Math.PI) * 6; l2.push(`<ellipse cx="${f(x)}" cy="${f(y)}" rx="6" ry="2.6" transform="rotate(${f(-40 + i * 13)} ${f(x)} ${f(y)})" fill="url(#${id}m)" stroke="${P.d}" stroke-width=".5"/>`); } top.push(`<g class="crown">${l2.join("")}</g>`); }
    else top.push(`<g class="crown"><path d="M76 20l6-16 10 10 8-14 8 14 10-10 6 16z" fill="url(#${id}m)" stroke="${P.d}" stroke-width=".8"/>${tok(cat, 100, 13, 0.4, P.s, P.d)}</g>`);
  }
  if (T.ribbon) {
    const fs = name.length > 22 ? 7.8 : name.length > 16 ? 9 : 10.2;
    // four ribbon styles: swallowtail → scroll ends → a double band → gold-trimmed
    const R = T.ribbon, GOLD = "#F6C945";
    const ends = R === 2
      ? `<path d="M36 146c-12-3-18 3-18 11s7 12 16 10" fill="${P.d}"/><ellipse cx="36" cy="156" rx="5" ry="12" fill="url(#${id}m)" stroke="${P.d}" stroke-width="1"/><path d="M164 146c12-3 18 3 18 11s-7 12-16 10" fill="${P.d}"/><ellipse cx="164" cy="156" rx="5" ry="12" fill="url(#${id}m)" stroke="${P.d}" stroke-width="1"/>`
      : `<path d="M20 150l18-4v24l-18-2 7-9z" fill="${P.d}"/><path d="M180 150l-18-4v24l18-2-7-9z" fill="${P.d}"/>`;
    const under = R >= 3 ? `<path d="M26 136c48-9 100-9 148 0l10 10-10 8c-48-9-100-9-148 0l-10-8z" fill="${R === 4 ? P.d : P.p}" stroke="${R === 4 ? GOLD : P.d}" stroke-width="1"/>` : "";
    const trim = R === 4 ? `<path d="M34 146.5c44-8 88-8 132 0M34 165.5c44-8 88-8 132 0" fill="none" stroke="${GOLD}" stroke-width="1.4"/>` + [16, 184].map((x) => `<path d="${star(5, 6, 2.6, -Math.PI / 2, x, 142)}" fill="${GOLD}" stroke="${P.d}" stroke-width=".6"/>`).join("") + `<circle cx="16" cy="142" r="1.4" fill="#fff"/><circle cx="184" cy="142" r="1.4" fill="#fff"/>` : "";
    front.push(`<g class="ribbon">${under}${ends}<path d="M34 144c44-8 88-8 132 0v24c-44-8-88-8-132 0z" fill="url(#${id}m)" stroke="${P.d}" stroke-width=".8"/><path d="M34 144c44-8 88-8 132 0" fill="none" stroke="#fff" stroke-width=".8" opacity=".6"/>${trim}` +
      `<text x="100" y="159.5" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="${fs}" fill="${["emerald", "sapphire", "ruby"].includes(T.metal) ? "#fff" : P.d}" letter-spacing=".2">${esc(name)}</text>` +
      `<circle cx="30" cy="158" r="7" fill="url(#${id}m)" stroke="${P.d}" stroke-width=".6"/>${tok(cat, 30, 158, 0.5, P.d, P.a)}<circle cx="170" cy="158" r="7" fill="url(#${id}m)" stroke="${P.d}" stroke-width=".6"/>${tok(cat, 170, 158, 0.5, P.d, P.a)}</g>`);
    front.push(`<g><rect x="${f(100 - (ROMAN[tier].length * 3.2 + 5))}" y="172" width="${f(ROMAN[tier].length * 6.4 + 10)}" height="12" rx="6" fill="${P.d}" stroke="url(#${id}m)" stroke-width="1"/><text x="100" y="181" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="8.5" fill="${P.a}" letter-spacing=".6">${ROMAN[tier]}</text></g>`);
  }
  if (T.particles && anim && full) for (let i = 0; i < MOTION.particles.full; i++) { const x = 40 + ((i * 53) % 120); front.push(`<circle cx="${x}" cy="${150 - (i % 3) * 12}" r="${f(1.4 + (i % 3) * 0.5)}" fill="${[P.a, P.g1, P.g2][i % 3]}" class="particle" style="animation-delay:${f((i * MOTION.particles.period) / MOTION.particles.full)}s"/>`); }
  if (tier === 18) front.push(`<circle cx="100" cy="100" r="97" fill="none" stroke="url(#${id}m)" stroke-width="1.1" stroke-dasharray="2 6" opacity=".75" class="raysR"/>`);

  const cls = `b ${mode === "grid" ? "grid" : mode === "static" ? "static" : "full"}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${size}" height="${size}" class="${cls}" data-cat="${cat}" data-tier="${tier}" role="img" aria-label="${esc(`${label} badge, tier ${tier} of 18: ${name}`)}">${title ? `<title>${esc(`${name} · ${label} ${tier}/18`)}</title>` : ""}${style ? `<style>${motionCSS()}</style>` : ""}<defs>${defs.join("")}</defs>${back.join("")}${T.wings ? `<g transform="translate(100 104) scale(.8) translate(-100 -100)">${mid.join("")}${front.join("")}</g>` : mid.join("") + front.join("")}${top.join("")}</svg>`;
}

// The reverse side, for the coin-flip entrance: the same silhouette and metal, the emblem embossed in one colour, the
// category's name around the rim and the tier numeral, so the flip reads as a real medallion, not a mirrored front.
export function back(cat, tier, { size = 160, uid = null } = {}) {
  const P = PALETTES[cat], T = TIER[tier], id = uid ?? `k${cat.slice(0, 3)}${tier}x${(uidN++).toString(36)}`, fp = framePath(T.frame);
  const metal = METALS[T.metal](P);
  const label = BADGE_CATEGORIES[cat].label.toUpperCase();
  const emb = EMB[cat](stageOf(tier), colourSet(cat, tier, P)).replace(/\sclass="[^"]*"/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${size}" height="${size}" class="b back" role="img" aria-label="The back of a ${esc(BADGE_CATEGORIES[cat].label)} badge"><defs>` +
    `<linearGradient id="${id}m" x1="1" y1="0" x2="0" y2="1">${stopsOf(metal)}</linearGradient><radialGradient id="${id}d" cx="60%" cy="35%" r="80%">${stopsOf([metal[1], metal[2] ?? metal[1], metal[metal.length - 1]])}</radialGradient>` +
    `<filter id="${id}e"><feFlood flood-color="${P.d}" flood-opacity=".55"/><feComposite in2="SourceAlpha" operator="in"/></filter><filter id="${id}w"><feFlood flood-color="#fff" flood-opacity=".5"/><feComposite in2="SourceAlpha" operator="in"/></filter>` +
    `<path id="${id}t" d="M100,100 m-${RMID},0 a${RMID},${RMID} 0 1,1 ${RMID * 2},0 a${RMID},${RMID} 0 1,1 -${RMID * 2},0"/></defs>` +
    `${fp ? `<path d="${fp}" fill="url(#${id}m)"/>` : ""}<circle cx="100" cy="100" r="${fp ? 82 : 88}" fill="url(#${id}m)"/><circle cx="100" cy="100" r="${ROUT}" fill="none" stroke="${P.d}" stroke-width="1" opacity=".5"/>` +
    `<text font-family="Georgia,serif" font-weight="700" font-size="8" letter-spacing="2.2" fill="${P.d}" opacity=".6"><textPath href="#${id}t">${esc(`${label} · DAYSPRING · ${label} · DAYSPRING ·`)}</textPath></text>` +
    `<circle cx="100" cy="100" r="${DISC}" fill="url(#${id}d)"/><circle cx="100" cy="100" r="${DISC}" fill="none" stroke="${P.d}" stroke-width="1.2" opacity=".5"/>` +
    `<g transform="translate(100 88) scale(.62) translate(-50 -50)"><g filter="url(#${id}w)" transform="translate(-1.2 -1.2)">${emb}</g><g filter="url(#${id}e)">${emb}</g></g>` +
    `<text x="100" y="146" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="20" fill="${P.d}" opacity=".6">${ROMAN[tier]}</text></svg>`;
}

// The "next badge" mystery card: the frame's outline only (a hint of how grand it is), frosted, with a big "?" in the
// category colour. Never contains the real art.
export function mystery(cat, tier, { size = 160 } = {}) {
  const P = PALETTES[cat], T = TIER[tier], fp = framePath(T.frame);
  const shape = fp ? `<path d="${fp}"/>` : `<circle cx="100" cy="100" r="88"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${size}" height="${size}" class="b mystery" role="img" aria-label="A mystery badge"><g fill="${P.p}" fill-opacity=".22" stroke="${P.s}" stroke-opacity=".7" stroke-width="3" stroke-dasharray="6 5">${shape}</g><circle cx="100" cy="100" r="${RIN}" fill="${P.p}" fill-opacity=".18"/>${T.wings ? `<g fill="${P.p}" fill-opacity=".14"><path d="M40 70c-20 6-34 30-36 50 14-8 26-8 38-4z"/><path d="M160 70c20 6 34 30 36 50-14-8-26-8-38-4z"/></g>` : ""}<text x="100" y="128" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="88" fill="${P.s}" fill-opacity=".92">?</text></svg>`;
}
// Complexity score (the tests check each tier is grander than the one before)
export const complexity = (s) => (s.match(/<(path|circle|ellipse|rect|text|g|stop|animate|animateTransform)\b/g) ?? []).length;
export { TIERS, MOTION, motionCSS };
export { gridCSS } from "./badges/motion.mjs";
