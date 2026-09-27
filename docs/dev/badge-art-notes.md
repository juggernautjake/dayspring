# Badge art notes

What the badge art is trying to do, and a changelog of each visual review pass. Code:
- `lib/xp/badge-art.mjs`: frames, metals, rims, ornaments, ribbons
- `lib/xp/badges/emblems.mjs`: the emblem stories
- `lib/xp/badges/motion.mjs`: motion

## Reviewing the art

```
node scripts/qa/badge-sheets.mjs                   # every sheet → docs/dev/badge-previews/
node scripts/qa/badge-sheets.mjs --only cats --cat volunteer
node scripts/qa/badge-sheets.mjs --only overview   # the one small picture the Help guide shows → docs/images/badges-overview.jpg
node scripts/qa/badge-previews.mjs                 # the webm/gif motion previews → docs/dev/badge-previews/
node scripts/qa/badge-art.mjs                      # complexity, validity, uniqueness, frame rate
```

`docs/dev/badge-previews/` is for development only; `scripts/export.mjs` leaves it out of the release. Only
`docs/images/badges-overview.jpg` ships, because docs/xp.md shows it.

For each sheet, ask:
- **Contact sheet:** does every row tell a story, and is each tier visibly grander than its neighbours?
- **Frames only:** with the emblem hidden, can you still name the category?
- **48 px:** can you still tell what the emblem is?
- **Per category:** are all 18 tiers clearly different?

## The design

| Tiers | Frame family | Metal | Accents | Ribbon |
|---|---|---|---|---|
| 1–3 | circle, notched, rope | matte, duotone, pewter | pips 1–3 | none |
| 4–6 | hexagon, octagon, scallop | copper, steel, brass | pips 4–6, topper ornament | none |
| 7–8 | shield, cusped shield | bronze, silver | gems 1, 2; side ornaments | swallowtail |
| 9–10 | 8-point star, 16-point sunburst | gold, rose gold | gems 3; half laurel (10) | swallowtail, then scroll ends |
| 11–12 | crest with side wings | emerald, sapphire | full laurel, tick ring | scroll ends |
| 13–14 | pointed medallion, compass medallion (with tip bosses) | ruby, platinum | gems 5–6, rays | double band |
| 15 | ornate celestial (bosses at its 12 tips) | opal (iridescent) | filigree | double band |
| 16–18 | winged shield, winged crest, legendary | prismatic, prismatic, cosmic | wings, crown or halo, aura; nebula and particles (18) | gold-trimmed, with stars |

Every tier's element count is strictly higher than the tier before, in every category; the art test checks this.

**Emblems:** six stages, one for every three tiers. Stage 6 is always golden, glowing, and often crowned.

| Category | Stages 1 → 6 |
|---|---|
| Fitness | dumbbell → motion lines → flexed arm → flaming dumbbell → winged titan → crowned champion |
| Sports | basketball → ball and whistle → trophy → podium → laurel trophy → golden cup with stars |
| Worship | chapel → chapel and bell tower → stained glass → cathedral → cathedral in rays → radiant golden cathedral |
| Prayer | folded hands → hands and candle → hands in light → dove → dove and halo → radiant dove |
| Healthy eating | apple → fruit bowl → seedling in a pot → harvest basket → tree of life → golden tree |
| Chores | broom → broom and sparkles → tidy house → house and heart → gleaming manor → crowned home |
| Study | pencil → graduation cap → atom → diploma → lamp of knowledge → laurel-crowned owl |
| Reading | book → open book → stack → lantern-lit tome → library arch → rune tome |
| Music | note → double notes → lyre → staff of notes → grand piano → golden lyre and halo |
| Relationships | heart → two hearts → linked rings → family-tree heart → a circle of hearts → crowned heart |
| Writing | quill → quill and inkwell → scroll → open journal → illuminated manuscript → golden quill and stars |
| Outdoors | sapling → tree on hills → forest → mountains → summit flag → starry peak |
| Rest | moon → moon and stars → cloud and moon → moon in a nightcap → constellation → galaxy |
| Cooking | chef's hat → hat and whisk → steaming pot → cake → feast table → golden chef's hat |
| Service | open hands → hands and heart → lantern → lighthouse → heart of hands → radiant lighthouse |
| Creativity | brush → palette → canvas on easel → paint splash → masterpiece frame → prismatic palette |
| Mindfulness | lotus bud → open lotus → lotus and ripples → lotus with the sun → meditating figure → lotus mandala |
| Business | briefcase → coin → rising chart → building → skyline → crowned tower |

**Frame ornaments** (`SIDE`, `SIDE_R`, `TOP` in badge-art.mjs):
- Big category objects sit at the frame's shoulders from tier 1.
- A topper is added from tier 4, and smaller copies on the sides from tier 7.
- The rim band carries the category's pattern.

| Category | Ornaments |
|---|---|
| Fitness | barbell ends, a weight plate, plate studs |
| Sports | ball seams |
| Worship | stained-glass arches, a cross |
| Prayer | ray fans, clasped hands |
| Healthy eating | vines with leaves and a berry |
| Chores | broom heads, sparkles, bristles |
| Study | tassels, a formula plaque, a mortarboard |
| Reading | page-edge book blocks with a bookmark |
| Music | treble and bass clefs on staff lines |
| Relationships | interlocking rings |
| Writing | quills, ink drops |
| Outdoors | ridgelines, a compass rose |
| Rest | moon phases, a crescent |
| Cooking | spoon and fork, steam |
| Service | open hands, a lantern |
| Creativity | paint drips |
| Mindfulness | lotus-petal fans, ripples |
| Business | coin stacks, a chart grid |

## Changelog

### Pass 1: the redesign (2026-09-27)
**Before:**
- Tiers 7–15 looked alike: similar round frames, gold, rose gold and platinum in turn, and the same accents.
- Only Outdoors' emblem really evolved; the others added small extras to one drawing over 4 stages.
- The frames said the category only through colour and a thin rim pattern.

**Changes:**
- New `badges/emblems.mjs`: 6-stage stories for all 18 categories, redrawn as full new pictures at every stage.
- A new tier table:
  - the frame family changes every 2–3 tiers
  - a new metal story (copper, steel, brass, emerald, sapphire, pearl)
  - gems 1 → 2 → 3, a half then a full laurel
  - four ribbon styles
- New frame ornaments per category, a pointed-medallion frame and a compass-medallion frame.
- The gems moved to the upper arc, so even one gem shows; before, a single gem sat under the ribbon.

**Critique after rendering:**
- The side ornaments were centred on the frame edge, half hidden under the rim band and too small. In the frames-only sheet only Worship, Relationships, Reading and Creativity were nameable.
- The flexed arm read as a bean.
- The Fitness rim's chain links read as rows of zeros.
- Tiers 13–15 (platinum, pearl, opal) were all whitish.
- The laurel was barely visible.
- The stage-1 sports ball's seams looked like a logo.
- The green seedling was lost on the green disc.

### Pass 2: legibility
- **Ornaments moved to the frame's shoulders:**
  - There is room there to draw them at 1.2–1.45×, rotated to point outward.
  - The sides keep smaller copies from tier 7, and the crest's wings flare above them.
  - The frames-only sheet now names every category at a glance: barbells, clefs, broom heads, peaks, rings, quills, paint drips, lotus fans, coin stacks.
- The metals for tiers 13–15 are now ruby, platinum and opal (distinct neighbours). The medallion and compass frames got tip bosses.
- A new flexed arm made of clean shapes (upper arm, bicep, forearm, fist).
- A basketball for Sports stage 1.
- The seedling now grows in a terracotta pot with light leaves and dark outlines.
- The Fitness rim is now weight-plate studs.
- Bigger laurel leaves.

**Critique:**
- Ribbon text was dark on the dark jewel metals.
- Stage-1 Service hands (outline strokes) were faint.
- The stage-1 broom handle vanished on the dark early discs.
- The Rest moon phases were small.

### Pass 3: finishing
- Ribbon text turns white on emerald, sapphire and ruby.
- Service stage 1–2 hands:
  - First attempt: filled cupped hands. At small size they looked like a toothy grin.
  - Redrawn as two open hands reaching up, matching the shoulder ornament. They read clearly at 48 px.
  - The stage-2 heart was lifted clear of the fingers.
- A light wooden broom handle with an outline.
- Bigger moon phases with a star.
- The titan's wings are drawn in the warm accent.
- Grid mode swaps the blurred drop shadow for a plain offset silhouette. It looks the same at grid size and is much cheaper to paint across 100 badges (the frame group grew with the ornaments).
- The review sheets, category sheets and webm/gif previews moved to `docs/dev/badge-previews/` and were regenerated, and export.mjs excludes that folder. Help now shows a 271 KB overview JPG instead of the 2 MB contact sheet, and docs/images went from 17 MB to 3.1 MB.

**Still worth a future look:**
- At tiers 16–18 the whole medallion is scaled to 0.8 to make room for the wings, so the ornaments get small there.
- The Study tassel is the quietest of the shoulder ornaments.
