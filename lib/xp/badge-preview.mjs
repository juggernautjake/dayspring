// The developer preview of the badge gallery (lib/dev): every tier of every category with its name, description and a
// SAMPLE citation, for looking at badges that haven't been earned. Read-only: it never records, awards, marks anything
// seen or touches the ledger. xp-routes only serves it (and the art of unearned badges) on a verified developer computer.
import * as B from "./badges.mjs";
import * as C from "./citation.mjs";

// a believable check-in per category, only for the sample citation
const SAMPLE = {
  workout: { evidence: "a 45-minute run" }, sports: { evidence: "played basketball with friends" }, worship: {}, prayer: {},
  eating: { evidence: "a big salad with grilled chicken" }, chore: { evidence: "did the dishes" }, study: { title: "Spanish", evidence: "I learned the past tense." },
  reading: { title: "a novel", evidence: "Read two chapters." }, practice: { evidence: "practised guitar for 30 minutes" }, call: { evidence: "called Grandma" },
  writing: { evidence: "wrote in my journal" }, outdoors: { evidence: "a walk in the park" }, sleep: {}, cooking: { evidence: "cooked chicken soup" },
  volunteer: { evidence: "served at the food bank" }, art: { evidence: "painted a landscape" }, mindfulness: { evidence: "10 minutes of meditation" }, work: { title: "the quarterly report", hours: 2 },
};
export function sampleCitation(cat, tier, { name = "", nickname = "", mode = "name", now = Date.now() } = {}) {
  const d = new Date(now), day = d.toLocaleDateString("en-CA");
  const e = { id: "sample", category: cat, at: d.toISOString(), day, source: "self", title: "", evidence: "", ...(SAMPLE[cat] ?? {}) };
  return C.build(e, { cat, tier, mode, name, nickname }).text;
}
// view: badge-state view(). Earned tiers stay exactly as they are; every other tier gets preview: true and its details.
export function previewView(view, opts = {}) {
  return {
    ...view, preview: true,
    categories: view.categories.map((c) => ({
      ...c,
      tiers: c.tiers.map((t) => (t.state === "earned" ? t : {
        tier: t.tier, state: t.state, preview: true, key: `${c.cat}:${t.tier}`, name: B.NAMES[c.cat][t.tier - 1], description: B.description(c.cat, t.tier),
        need: B.thresholds(c.cat)[t.tier - 1], sampleCitation: sampleCitation(c.cat, t.tier, opts),
      })),
    })),
  };
}
