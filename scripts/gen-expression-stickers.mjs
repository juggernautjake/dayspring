// Dayspring's own emotion stickers (original art): a little dawn-orb face with a prop per feeling, animated in SVG.
// Loops: 2 s (3 s for sleepy, sad, thinking), matching lib/looks/expressions.mjs STICKERS.
// Original art made for Dayspring (no third-party media). Run: node scripts/gen-expression-stickers.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "expressions");
mkdirSync(OUT, { recursive: true });
const loop = (e) => (["sleepy", "sad", "thinking"].includes(e) ? 3 : 2);
const face = (body, extra, { eyes, mouth, cheeks = true, anim = "", bodyAnim = "" }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
<defs>
<radialGradient id="g" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#fff6e0"/><stop offset=".35" stop-color="${body[0]}"/><stop offset="1" stop-color="${body[1]}"/></radialGradient>
<radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset=".55" stop-color="${body[0]}" stop-opacity=".45"/><stop offset="1" stop-color="${body[1]}" stop-opacity="0"/></radialGradient>
</defs>
<circle cx="100" cy="104" r="96" fill="url(#glow)"/>
<g>${bodyAnim}
<circle cx="100" cy="106" r="62" fill="url(#g)"/>
<ellipse cx="78" cy="78" rx="14" ry="8" fill="#fff" opacity=".45" transform="rotate(-30 78 78)"/>
${cheeks ? `<ellipse cx="66" cy="120" rx="10" ry="6" fill="#ff8fa3" opacity=".55"/><ellipse cx="134" cy="120" rx="10" ry="6" fill="#ff8fa3" opacity=".55"/>` : ""}
${eyes}
${mouth}
</g>
${extra}${anim}
</svg>
`;
const INK = "#1b1733";
const openEyes = (dx = 0, dy = 0, r = 9) => `<g><circle cx="${78 + dx}" cy="${100 + dy}" r="${r}" fill="${INK}"/><circle cx="${122 + dx}" cy="${100 + dy}" r="${r}" fill="${INK}"/><circle cx="${75 + dx}" cy="${97 + dy}" r="3" fill="#fff"/><circle cx="${119 + dx}" cy="${97 + dy}" r="3" fill="#fff"/></g>`;
const blinkEyes = (dur) => `<g><animateTransform attributeName="transform" type="scale" values="1 1;1 1;1 .1;1 1" keyTimes="0;.86;.93;1" dur="${dur}s" repeatCount="indefinite" additive="sum"/>${openEyes()}</g>`;
const happyEyes = `<path d="M68 102 q10 -12 20 0 M112 102 q10 -12 20 0" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
const closedEyes = `<path d="M68 100 q10 8 20 0 M112 100 q10 8 20 0" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
const smile = `<path d="M82 124 q18 16 36 0" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
const bigSmile = `<path d="M78 120 q22 30 44 0 z" fill="#5a1d33"/><path d="M88 132 q12 8 24 0" fill="#ff8fa3"/>`;
const oMouth = `<ellipse cx="100" cy="130" rx="8" ry="10" fill="#5a1d33"/>`;
const flat = `<path d="M88 128 h24" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`;
const frown = `<path d="M84 134 q16 -12 32 0" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
const wavy = `<path d="M82 130 q6 -6 12 0 t12 0 t12 0" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
const WARM = ["#ffd27a", "#f08fbb"], DAWN = ["#9aa8ff", "#8b6cf0"], GOLD = ["#ffe08a", "#ff9f5a"], COOL = ["#a8c8ff", "#7c8cff"], MINT = ["#9ff0c8", "#48b8a0"];
const bounce = (d, h = 8) => `<animateTransform attributeName="transform" type="translate" values="0 0;0 -${h};0 0" dur="${d}s" repeatCount="indefinite" calcMode="spline" keySplines=".4 0 .6 1;.4 0 .6 1"/>`;
const sway = (d, a = 6) => `<animateTransform attributeName="transform" type="rotate" values="-${a} 100 110;${a} 100 110;-${a} 100 110" dur="${d}s" repeatCount="indefinite"/>`;
const confetti = (d) => Array.from({ length: 14 }, (_, i) => { const x = 20 + ((i * 53) % 160), c = ["#ff8fa3", "#ffd27a", "#7ee3b0", "#7c8cff", "#67e8f9"][i % 5], dl = ((i * 0.13) % d).toFixed(2); return `<rect x="${x}" y="-10" width="7" height="11" rx="2" fill="${c}"><animate attributeName="y" values="-12;210" dur="${d}s" begin="-${dl}s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="rotate" values="0 ${x} 0;360 ${x} 200" dur="${d}s" begin="-${dl}s" repeatCount="indefinite"/></rect>`; }).join("");
const sparkles = (d, c = "#fff4c2") => [[30, 40], [168, 52], [40, 160], [165, 158], [100, 18]].map(([x, y], i) => `<path d="M${x} ${y - 9} L${x + 3} ${y - 3} L${x + 9} ${y} L${x + 3} ${y + 3} L${x} ${y + 9} L${x - 3} ${y + 3} L${x - 9} ${y} L${x - 3} ${y - 3} Z" fill="${c}"><animate attributeName="opacity" values="0;1;0" dur="${d}s" begin="${(i * d / 5).toFixed(2)}s" repeatCount="indefinite"/></path>`).join("");
const S = {
  excited: () => face(GOLD, sparkles(2), { eyes: openEyes(0, -2, 10), mouth: bigSmile, bodyAnim: bounce(0.5, 12) }),
  happy: () => face(WARM, "", { eyes: happyEyes, mouth: smile, bodyAnim: sway(2, 5) }),
  proud: () => face(GOLD, `<g transform="translate(100 34)"><path d="M-22 10 L-14 -12 L0 4 L14 -12 L22 10 Z" fill="#ffd27a" stroke="#c98a2b" stroke-width="3"/><circle cx="0" cy="-2" r="3" fill="#ff8fa3"/><animateTransform attributeName="transform" type="translate" values="100 34;100 28;100 34" dur="2s" repeatCount="indefinite"/></g>`, { eyes: happyEyes, mouth: smile }),
  celebrate: () => face(WARM, confetti(2), { eyes: happyEyes, mouth: bigSmile, bodyAnim: bounce(0.5, 10) }),
  thinking: () => face(DAWN, `<g fill="#eef0ff">${[0, 1, 2].map((i) => `<circle cx="${142 + i * 16}" cy="${50 - i * 10}" r="${5 + i * 2}"><animate attributeName="opacity" values=".2;1;.2" dur="3s" begin="${i}s" repeatCount="indefinite"/></circle>`).join("")}</g>`, { eyes: openEyes(8, -8), mouth: `<path d="M92 128 l20 -4" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`, cheeks: false }),
  confused: () => face(COOL, `<text x="150" y="60" font-family="Outfit,Segoe UI,sans-serif" font-size="46" font-weight="700" fill="#eef0ff">?<animateTransform attributeName="transform" type="rotate" values="-12 160 45;12 160 45;-12 160 45" dur="2s" repeatCount="indefinite"/></text>`, { eyes: `<g><circle cx="78" cy="100" r="9" fill="${INK}"/><circle cx="122" cy="100" r="6" fill="${INK}"/></g>`, mouth: wavy, cheeks: false, bodyAnim: sway(2, 4) }),
  surprised: () => face(GOLD, `<g stroke="#eef0ff" stroke-width="5" stroke-linecap="round">${[[40, 40, 26, 26], [160, 40, 174, 26], [100, 26, 100, 8]].map(([a, b, c, d]) => `<path d="M${a} ${b} L${c} ${d}"><animate attributeName="opacity" values="0;1;0" dur="2s" repeatCount="indefinite"/></path>`).join("")}</g>`, { eyes: openEyes(0, -4, 12), mouth: oMouth, cheeks: false, bodyAnim: `<animateTransform attributeName="transform" type="scale" values="1;1.06;1" dur="2s" repeatCount="indefinite" additive="sum"/>` }),
  sad: () => face(COOL, `<path d="M72 112 q-4 10 0 14 q4 -4 0 -14 z" fill="#8fd8ff"><animate attributeName="opacity" values="0;1;1;0" dur="3s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="translate" values="0 0;0 18" dur="3s" repeatCount="indefinite"/></path><g transform="translate(100 172)"><path d="M-30 0 q30 -26 60 0" stroke="#ff8fa3" stroke-width="6" fill="none" stroke-linecap="round"/><text x="-8" y="-6" font-size="20">💗</text></g>`, { eyes: closedEyes, mouth: frown }),
  upset: () => face(["#ffc39a", "#f08a8a"], `<g><path d="M150 44 q10 -14 20 0 q-10 14 -20 0" fill="#ff8fa3"><animate attributeName="opacity" values="1;.3;1" dur="1s" repeatCount="indefinite"/></path></g>`, { eyes: `<g><path d="M68 90 l18 4 M132 90 l-18 4" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>${openEyes(0, 4, 7)}</g>`, mouth: flat, cheeks: false, bodyAnim: `<animateTransform attributeName="transform" type="translate" values="0 0;-2 0;2 0;0 0" dur=".4s" repeatCount="indefinite"/>` }),
  sleepy: () => face(DAWN, `<g font-family="Outfit,Segoe UI,sans-serif" font-weight="700" fill="#eef0ff">${[0, 1, 2].map((i) => `<text x="${140 + i * 14}" y="${70 - i * 16}" font-size="${16 + i * 6}">z<animate attributeName="opacity" values="0;1;0" dur="3s" begin="${i}s" repeatCount="indefinite"/></text>`).join("")}</g>`, { eyes: closedEyes, mouth: `<ellipse cx="100" cy="130" rx="6" ry="4" fill="#5a1d33"/>`, bodyAnim: `<animateTransform attributeName="transform" type="scale" values="1;1.03;1" dur="3s" repeatCount="indefinite" additive="sum"/>` }),
  laughing: () => face(GOLD, `<g fill="#8fd8ff"><circle cx="54" cy="96" r="5"><animate attributeName="cy" values="96;130" dur=".7s" repeatCount="indefinite"/></circle><circle cx="146" cy="96" r="5"><animate attributeName="cy" values="96;130" dur=".7s" repeatCount="indefinite"/></circle></g>`, { eyes: `<path d="M66 98 l18 -6 l-18 -6 M134 98 l-18 -6 l18 -6" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`, mouth: bigSmile, bodyAnim: `<animateTransform attributeName="transform" type="rotate" values="-4 100 110;4 100 110;-4 100 110" dur=".5s" repeatCount="indefinite"/>` }),
  encourage: () => face(MINT, `<g transform="translate(160 118)"><circle r="16" fill="#ffd27a"/><path d="M-6 -2 v-12 q0 -6 6 -6 v14 h8 q6 0 5 6 l-2 10 q-1 6 -7 6 h-10 z" fill="#ffe8b5" stroke="#c98a2b" stroke-width="2"/><animateTransform attributeName="transform" type="translate" values="160 118;160 108;160 118" dur="1s" repeatCount="indefinite"/></g>${sparkles(2, "#c4ffe4")}`, { eyes: openEyes(0, -2), mouth: smile }),
  grateful: () => face(WARM, `<g><path d="M100 60 c-8 -14 -30 -6 -22 10 l22 20 l22 -20 c8 -16 -14 -24 -22 -10 z" fill="#ff8fa3" transform="translate(0 -28)"><animateTransform attributeName="transform" type="translate" values="0 -28;0 -36;0 -28" dur="2s" repeatCount="indefinite"/></path></g>`, { eyes: happyEyes, mouth: smile, bodyAnim: `<animateTransform attributeName="transform" type="rotate" values="0 100 170;8 100 170;0 100 170" dur="2s" repeatCount="indefinite"/>` }),
  greeting: () => face(WARM, `<g><path d="M150 120 q14 -30 30 -24" stroke="#ffd27a" stroke-width="12" fill="none" stroke-linecap="round"/><circle cx="182" cy="92" r="11" fill="#ffd27a"/><animateTransform attributeName="transform" type="rotate" values="-10 150 120;18 150 120;-10 150 120" dur=".7s" repeatCount="indefinite"/></g>`, { eyes: openEyes(), mouth: smile }),
  goodbye: () => face(DAWN, `<g><path d="M50 120 q-14 -30 -30 -24" stroke="#a78bfa" stroke-width="12" fill="none" stroke-linecap="round"/><circle cx="18" cy="92" r="11" fill="#a78bfa"/><animateTransform attributeName="transform" type="rotate" values="10 50 120;-18 50 120;10 50 120" dur=".7s" repeatCount="indefinite"/></g>`, { eyes: happyEyes, mouth: smile }),
  oops: () => face(COOL, `<g><path d="M150 36 l10 18 h-20 z" fill="#ffd27a" stroke="#c98a2b" stroke-width="2"/><path d="M150 42 v6" stroke="#5a3a10" stroke-width="3" stroke-linecap="round"/><animateTransform attributeName="transform" type="rotate" values="-8 150 46;8 150 46;-8 150 46" dur=".6s" repeatCount="indefinite"/></g><path d="M40 70 q10 -8 20 0" stroke="#8fd8ff" stroke-width="4" fill="none"><animate attributeName="opacity" values="0;1;0" dur="2s" repeatCount="indefinite"/></path>`, { eyes: `<g>${openEyes(0, 0, 8)}</g>`, mouth: `<path d="M86 130 q7 -6 14 0 q7 6 14 0" stroke="${INK}" stroke-width="5" fill="none" stroke-linecap="round"/>`, cheeks: false }),
  alert: () => face(GOLD, `<g transform="translate(100 40)"><path d="M-14 12 q0 -24 14 -24 q14 0 14 24 z" fill="#ffd27a" stroke="#c98a2b" stroke-width="3"/><circle cy="15" r="4" fill="#c98a2b"/><animateTransform attributeName="transform" type="rotate" values="-16 0 -6;16 0 -6;-16 0 -6" dur=".5s" repeatCount="indefinite" additive="sum"/></g>`, { eyes: openEyes(0, -3, 11), mouth: oMouth, cheeks: false }),
  agree: () => face(MINT, `<g transform="translate(158 124)"><circle r="18" fill="#7ee3b0"/><path d="M-8 0 l6 7 l11 -13" stroke="#0e3b2c" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`, { eyes: happyEyes, mouth: smile, bodyAnim: `<animateTransform attributeName="transform" type="translate" values="0 0;0 6;0 0" dur="1s" repeatCount="indefinite"/>` }),
};
for (const [e, f] of Object.entries(S)) { const svg = f(); writeFileSync(`${OUT}/${e}.svg`, svg); console.log(e, svg.length, loop(e)); }
