// The developer preview by voice (only on a verified developer computer; everywhere else this returns null and the words
// go on to Dayspring's other skills as always):
//   "show me all the badges"            the gallery with Preview all on
//   "preview the running badges"        …just that category
//   "let me hear the cowboy voice"      that character's sample lines, in its voice (nothing is switched)
//   "preview the secret characters"     the Personality lab, secret characters first
import * as dev from "./status.mjs";

const CATS = { workout: "running|runs?|fitness|workouts?|exercise|gym", sports: "sports?|games?", worship: "worship|church", prayer: "prayers?|praying", eating: "healthy eating|eating|food|nutrition",
  chore: "chores?|home|cleaning", study: "study|studying|learning|school", reading: "reading|books?", practice: "music|practice|instruments?", call: "relationships?|friends?|family|calls?",
  writing: "writing|journal(?:ing)?", outdoors: "outdoors?|nature|outside", sleep: "rest|sleep|bedtime", cooking: "cooking|kitchen", volunteer: "service|volunteering|serving",
  art: "creativity|art|creative|crafts?", mindfulness: "mindfulness|meditation|calm", work: "business|work|job" };
const catOf = (t) => { for (const [c, w] of Object.entries(CATS)) if (new RegExp(`^(?:${w})$`).test(t)) return c; return null; };
const norm = (text) => String(text ?? "").toLowerCase().replace(/[.!?,]/g, " ").replace(/\s+/g, " ").trim()
  .replace(/^(hey |ok |okay )?(dayspring |lantern )?(can you |could you |please |would you )*/, "").replace(/ please$/, "").trim();

export async function handle(text) {
  const q = norm(text);
  if (!q || !/\b(badges?|voice|characters?|personalit(y|ies))\b/.test(q)) return null;
  if (!dev.isDev()) return null;
  let m;
  if (/^(show me|show|preview|let me see|open) (all|every) (of )?(the |my )?badges$|^preview (the |my )?badges$/.test(q))
    return { reply: "Developer preview: every badge, earned or not. Nothing here counts as earned.", show: "badges:preview", intent: "dev" };
  if ((m = /^(?:preview|show me|show) (?:all )?(?:of )?(?:the |my )?(.+?) badges?$/.exec(q)) && catOf(m[1])) {
    const cat = catOf(m[1]);
    const { BADGE_CATEGORIES } = await import("../xp/badges.mjs");
    return { reply: `Developer preview: all 18 ${BADGE_CATEGORIES[cat].label} badges.`, show: `badges:preview:${cat}`, intent: "dev" };
  }
  if (/^(preview|show me|show|list|let me see) (all )?(of )?(the |my )?secret (characters|personalities)$/.test(q) && /^preview|all/.test(q)) {
    const persona = await import("../persona/index.mjs");
    const secrets = persona.devCharacters().filter((c) => c.kind === "secret");
    return { reply: `Developer preview: all ${secrets.length} secret characters. ${secrets.map((c) => c.name).join(", ")}.`, show: "personality:lab:secrets", intent: "dev" };
  }
  if ((m = /^(?:let me hear|i want to hear|can i hear|play|preview) (?:the |a |an |what )?(.+?)(?: sounds like)? (?:voice|character|personality)$/.exec(q))) {
    const persona = await import("../persona/index.mjs");
    const want = m[1].replace(/^the /, "");
    const all = persona.devCharacters();
    let best = null;
    for (const c of all) for (const nm of [c.id, c.name, c.name.replace(/^The /, "")]) { const sc = persona.similarity(want, nm); if (sc >= 0.8 && (!best || sc > best.sc)) best = { c, sc }; }
    if (!best) { const t = persona.findTarget(want); if (t?.kind === "preset") best = { c: all.find((c) => c.id === t.id), sc: t.score }; }
    if (!best?.c || best.c.id === "default") return null;
    const c = best.c, state = persona.stateFor(c.id, { role: c.role ?? null });
    const lines = ["greeting", "ack", "done"].map((k) => persona.phraseAs(state, k, { seed: "devvoice" + k })).filter(Boolean);
    const said = lines.join(" ") || persona.styleAs(state, "Your meeting is at 3:30.", { kind: "reply", seed: "devvoice" });
    return { reply: `Developer preview, ${c.name}: ${said}`, devVoice: { voice: c.voice?.name ?? null, edge: c.voice?.edge ?? null, text: said, name: c.name }, intent: "dev" };
  }
  return null;
}
