// Badge motion: every timing and amplitude in one place, tuned to feel like the Dayspring orb at rest (tv.js #viz:
// a ~11 s breath of ±2.5%, soft glow, slow drift). Subtle but noticeable: slow ease-in-out loops, gentle glow, soft
// light. Nothing fast, jittery or flashy. Higher tiers get MORE layers of motion, never faster or bigger ones.
//
// Amplitudes are multiplied by --amp (1 in the detail view, GRID_AMP in grids), so the same SVG is calmer in a grid.
// Only transform and opacity animate (plus gradient transforms in the full view), so it stays GPU-friendly.

export const MOTION = {
  gridAmp: 0.5,                 // grids move at half the detail view's amplitude
  stagger: 0.9,                 // s between layers, so a badge never "fires everything at once"
  breath:   { period: 7,  opacityMin: 0.7 },                 // the glow behind the emblem (tiers 1+)
  hue:      { period: 11, opacityMin: 0.7 },                 // the aura's slow colour drift
  emblem:   { period: 8,  scale: 0.025 },                    // the emblem's own breath (≤ 3%)
  flavour:  { period: 6,  scale: 0.03, drift: 2.2, sway: 5 },// the category's own motion (steam, notes, leaves…)
  sheen:    { period: 9,  sweep: 1.6 },                      // a light sweep every 9 s, crossing in 1.6 s (tiers 4+)
  ribbon:   { period: 6,  skew: 1.2 },                       // the ribbon waves (tiers 7+)
  tokens:   { period: 5,  opacityMin: 0.7, scale: 0.08 },    // the category tokens twinkle (tiers 7+)
  ring:     { turn: 90 },                                    // s per full turn: the engraved ring (tiers 10+)
  burst:    { turn: 60 },                                    // the ray burst (tiers 11+)
  glint:    { period: 7,  flash: 0.6 },                      // gems glint for 0.6 s every 7 s, staggered (tiers 13+)
  wings:    { period: 7,  deg: 3 },                          // wings (tiers 16+)
  crown:    { period: 7,  scale: 0.025 },                    // halo / crown pulse (tiers 16+)
  particles:{ full: 6, grid: 0, period: 12, rise: 70 },      // few and slow (tier 18)
  prism:    { turn: 24 },                                    // the prismatic metal's gradient turn (tiers 16+, full view)
  // the entrance: a coin flip that spins down, lands face-forward with a small damped wobble, a light sweep and one
  // burst of glints, then settles into the loop above
  entrance: {
    turns: (tier) => (tier <= 5 ? 2 : tier <= 12 ? 3 : 4),
    duration: (tier) => (tier <= 5 ? 1.6 : tier <= 12 ? 2.0 : 2.4),     // s
    ease: [0.12, 0.7, 0.18, 1],                                          // a coin spinning down
    wobbleDeg: 6, wobbleTime: 0.7,                                       // ±6°, damped
    scaleFrom: 0.72, lift: 10,                                           // a gentle scale-in and rise
    landSheen: 0.9, glints: 8, glintTime: 0.9,
    shadowMin: 0.3,                                                      // the shadow narrows to 30% edge-on
    quick: { turns: 1, duration: 0.8 },                                  // hover or tap in the detail view
    reduced: { fade: 0.5, glint: 0.6 },                                  // reduced motion: a fade and one glint
    gridStagger: 0.35,                                                   // s between several new badges in a grid
  },
};

const s = (n) => `${Math.round(n * 1000) / 1000}s`;
// The CSS inside (or beside) every badge SVG. Classes are scoped by .b.
export function css(M = MOTION) {
  const st = M.stagger;
  return `
.b{--amp:1}.b.grid{--amp:${M.gridAmp}}
.b :is(.emb,.tok>*,.ring,.rays,.raysR,.ribbon,.gem,.crown,.particle,.f-pulse,.f-drift,.f-rise>*,.f-sway,.f-spin,.f-tw>*,.f-eq>*){transform-box:fill-box;transform-origin:center}
@keyframes bBreath{0%,100%{opacity:calc(1 - var(--amp) * ${1 - M.breath.opacityMin})}50%{opacity:1}}
@keyframes bHue{0%,100%{opacity:calc(1 - var(--amp) * ${1 - M.hue.opacityMin})}50%{opacity:1}}
@keyframes bScale{0%,100%{transform:scale(1)}50%{transform:scale(calc(1 + var(--amp) * ${M.emblem.scale}))}}
@keyframes bFlav{0%,100%{transform:scale(1)}50%{transform:scale(calc(1 + var(--amp) * ${M.flavour.scale}))}}
@keyframes bDrift{0%,100%{transform:translateX(calc(var(--amp) * -${M.flavour.drift}px))}50%{transform:translateX(calc(var(--amp) * ${M.flavour.drift}px))}}
@keyframes bRise{0%{transform:translateY(calc(var(--amp) * 2px));opacity:.35}50%{opacity:1}100%{transform:translateY(calc(var(--amp) * -4px));opacity:.35}}
@keyframes bSway{0%,100%{transform:rotate(calc(var(--amp) * -${M.flavour.sway}deg))}50%{transform:rotate(calc(var(--amp) * ${M.flavour.sway}deg))}}
@keyframes bTok{0%,100%{opacity:calc(1 - var(--amp) * ${1 - M.tokens.opacityMin});transform:scale(1)}50%{opacity:1;transform:scale(calc(1 + var(--amp) * ${M.tokens.scale}))}}
@keyframes bSpin{to{transform:rotate(360deg)}}
@keyframes bSpinR{to{transform:rotate(-360deg)}}
@keyframes bSheen{0%{transform:translateX(-150px)}${Math.round((M.sheen.sweep / M.sheen.period) * 100)}%,100%{transform:translateX(170px)}}
@keyframes bGlint{0%,${100 - Math.round((M.glint.flash / M.glint.period) * 100)}%,100%{opacity:0;transform:scale(.5)}${100 - Math.round((M.glint.flash / M.glint.period) * 50)}%{opacity:1;transform:scale(1.1)}}
@keyframes bWave{0%,100%{transform:skewY(0deg)}50%{transform:skewY(calc(var(--amp) * -${M.ribbon.skew}deg))}}
@keyframes bFlap{0%,100%{transform:rotate(0deg)}50%{transform:rotate(calc(var(--amp) * -${M.wings.deg}deg))}}
@keyframes bFlapR{0%,100%{transform:rotate(0deg)}50%{transform:rotate(calc(var(--amp) * ${M.wings.deg}deg))}}
@keyframes bCrown{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(calc(1 + var(--amp) * ${M.crown.scale}));opacity:1}}
@keyframes bPart{0%{transform:translateY(0);opacity:0}25%{opacity:.8}100%{transform:translateY(-${M.particles.rise}px);opacity:0}}
.b .glow{animation:bBreath ${s(M.breath.period)} ease-in-out infinite}
.b .aura{animation:bHue ${s(M.hue.period)} ease-in-out infinite ${s(st)}}
.b .emb{animation:bScale ${s(M.emblem.period)} ease-in-out infinite}
.b .sheen{animation:bSheen ${s(M.sheen.period)} ease-in-out infinite ${s(st * 2)}}
.b .tok>*{animation:bTok ${s(M.tokens.period)} ease-in-out infinite}
${[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `.b .tok>*:nth-child(${i}){animation-delay:${s((i * M.tokens.period) / 8)}}`).join("")}
.b .ring{animation:bSpin ${s(M.ring.turn)} linear infinite}
.b .rays{animation:bSpin ${s(M.burst.turn)} linear infinite}
.b .raysR{animation:bSpinR ${s(M.ring.turn * 1.3)} linear infinite}
.b .ribbon{animation:bWave ${s(M.ribbon.period)} ease-in-out infinite ${s(st)}}
.b .gem{animation:bGlint ${s(M.glint.period)} ease-in-out infinite}
.b .wingL{animation:bFlap ${s(M.wings.period)} ease-in-out infinite;transform-origin:right center}
.b .wingR{animation:bFlapR ${s(M.wings.period)} ease-in-out infinite;transform-origin:left center}
.b .crown{animation:bCrown ${s(M.crown.period)} ease-in-out infinite ${s(st * 1.5)}}
.b .particle{animation:bPart ${s(M.particles.period)} ease-in-out infinite}
.b .f-pulse{animation:bFlav ${s(M.flavour.period)} ease-in-out infinite}
.b .f-drift{animation:bDrift ${s(M.flavour.period * 1.3)} ease-in-out infinite}
.b .f-rise>*{animation:bRise ${s(M.flavour.period * 0.8)} ease-in-out infinite}
.b .f-rise>*:nth-child(2){animation-delay:${s(M.flavour.period * 0.27)}}.b .f-rise>*:nth-child(3){animation-delay:${s(M.flavour.period * 0.53)}}
.b .f-sway{animation:bSway ${s(M.flavour.period)} ease-in-out infinite;transform-origin:left bottom}
.b .f-spin{animation:bSpin ${s(M.ring.turn / 2)} linear infinite}
.b .f-glow{animation:bBreath ${s(M.flavour.period)} ease-in-out infinite}
.b .f-tw>*{animation:bTok ${s(M.tokens.period)} ease-in-out infinite}
.b .f-tw>*:nth-child(2){animation-delay:${s(M.tokens.period / 3)}}.b .f-tw>*:nth-child(3){animation-delay:${s((M.tokens.period * 2) / 3)}}
.b .f-eq>*{animation:bFlav ${s(M.flavour.period / 2)} ease-in-out infinite;transform-origin:center bottom}
.b .f-eq>*:nth-child(2){animation-delay:${s(M.flavour.period / 6)}}.b .f-eq>*:nth-child(3){animation-delay:${s(M.flavour.period / 3)}}.b .f-eq>*:nth-child(4){animation-delay:${s(M.flavour.period / 2)}}
.b.grid *,.b.paused *,.b.static *{animation:none!important}
@media (prefers-reduced-motion:reduce){.b *{animation:none!important}}`;
}
// Grids (the gallery, the badge case): animating inside an SVG repaints the whole SVG every frame, so a grid keeps each
// badge's SVG still and moves its WRAPPER instead (.bart): a gentle composited breath at half the detail view's
// amplitude and, from tier 4, a light sweep across the top, each on its own stagger (--d). Transform only: GPU work.
export function gridCSS(M = MOTION) {
  const amp = M.gridAmp;
  return `
.bart{position:relative;display:inline-block;line-height:0;border-radius:50%;will-change:transform;animation:bArtBreath ${M.emblem.period}s ease-in-out infinite;animation-delay:var(--d,0s)}
@keyframes bArtBreath{0%,100%{transform:scale(1)}50%{transform:scale(${1 + M.emblem.scale * amp})}}
.bart[data-sheen]{overflow:hidden}
.bart[data-sheen]::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 42%,rgba(255,255,255,${0.28 * amp + 0.08}) 50%,transparent 58%);transform:translateX(-130%);will-change:transform;pointer-events:none;animation:bArtSheen ${M.sheen.period}s ease-in-out infinite;animation-delay:var(--d2,0s)}
@keyframes bArtSheen{0%{transform:translateX(-130%)}${Math.round((M.sheen.sweep / M.sheen.period) * 100)}%,100%{transform:translateX(130%)}}
.bart.paused,.bart.paused::after{animation-play-state:paused}
@media (prefers-reduced-motion:reduce){.bart,.bart::after{animation:none!important}.bart[data-sheen]:hover::after{animation:bArtSheen ${M.glint.flash * 2}s ease-out 1!important}}`;
}
