// Shopping on Amazon, for the no-AI intent catalogue (catalog.mjs), in its template language: (a|b) one of, [x]
// optional, {text} free words. Every one plans { do: "shopping", id, text } and the runner hands the words to
// lib/shopping/index.mjs (which also answers them directly, before anything else, when it's sure: lib/assistant.mjs).
// The 5th item boosts the score when the words clearly mean Amazon shopping, and lowers it a lot when they don't:
// "play amazon music", "the amazon river", "my shopping list" and "go to amazon" belong to others.
// "amazon", also misheard or mistyped by one letter ("amzaon", "aamzon", "amazn")
function nearly(w, target) {
  if (w === target) return true;
  if (Math.abs(w.length - target.length) > 1 || w.length < 5) return false;
  if (w.length === target.length) {
    const diff = [...w].map((c, i) => (c !== target[i] ? i : -1)).filter((i) => i >= 0);
    return diff.length === 1 || (diff.length === 2 && diff[1] === diff[0] + 1 && w[diff[0]] === target[diff[1]] && w[diff[1]] === target[diff[0]]);
  }
  const [a, b] = w.length < target.length ? [w, target] : [target, w];
  for (let i = 0; i < b.length; i++) if (b.slice(0, i) + b.slice(i + 1) === a) return true;
  return false;
}
const AMZ = { test: (q) => String(q).split(/\s+/).some((w) => nearly(w, "amazon")) };
// (lib/shopping: the words with a misheard "amazon" put right, or null when Amazon isn't mentioned at all)
export function withAmazon(text) {
  let hit = false;
  const out = String(text ?? "").replace(/[A-Za-z]+/g, (w) => (nearly(w.toLowerCase(), "amazon") ? ((hit = true), "amazon") : w));
  return hit ? out : null;
}
const NOT =/\b(amazon music|prime video|amazon (river|rainforest|jungle|basin)|documentar|movie|episode|podcast|shopping list|grocery list)\b|^(play|watch|listen|read|go to|open amazon$)/;
const shop = (x = 1.35) => (c) => (NOT.test(c.q) ? 0.3 : AMZ.test(c.q) ? x : 0.55);
export const SHOPPING_INTENTS = [
  ["shopping.search", "Find something for sale on Amazon", "find a waterproof work boot on amazon", [
    "(find|search for|look for|look up|shop for) {text} on amazon", "(find|get) me {text} on amazon", "search amazon for {text}", "is there (a|an|any) {text} on amazon",
    "(does|do) amazon (sell|have) {text}", "can i buy {text} on amazon", "is {text} for sale on amazon", "check amazon for {text}", "amazon search {text}", "show me {text} on amazon",
  ], shop(1.4)],
  ["shopping.orders", "Show your Amazon orders", "show my amazon orders", [
    "(show|open|list|pull up) [me] my amazon orders", "my amazon order history", "(where is|track) my amazon (package|order|delivery)", "what did i order on amazon", "show my recent amazon orders",
  ], shop(1.35)],
  ["shopping.lastbought", "When you last bought something on Amazon", "when did i last buy coffee filters on amazon", [
    "when did i last (buy|order) {text} [on amazon]", "did i already (buy|order) {text} on amazon", "search my amazon orders for {text}", "find {text} in my amazon orders",
  ], (c) => (NOT.test(c.q) || /^what did i order\b/.test(c.q) ? 0.3 : /\b(when did i|did i (already )?(buy|order)|my (amazon )?orders)\b/.test(c.q) ? 1.3 : 0.6)],
  ["shopping.reorder", "Buy something again on Amazon", "buy coffee filters again on amazon", ["(buy|order) {text} again [on amazon]", "reorder {text} [on amazon]", "re-order {text}"],
    (c) => (NOT.test(c.q) ? 0.3 : /\b(again|reorder|re order)\b/.test(c.q) ? (AMZ.test(c.q) || /\breorder\b/.test(c.q) ? 1.3 : 0.9) : 0.5)],
  ["shopping.subs", "Your Subscribe & Save deliveries", "show my subscribe and save", [
    "(show|open|list) [me] my subscribe and save", "what is coming from subscribe and save", "my amazon subscriptions", "(show|list) my upcoming amazon deliveries", "skip the {text} delivery",
    "(turn|switch) (on|off) [my] amazon subscription notifications",
  ], (c) => (/\bsubscribe and save\b|\bamazon subscriptions?\b|\bamazon (subscription )?notifications\b/.test(c.q) ? 1.4 : /\bskip\b.*\bdelivery\b/.test(c.q) ? 1.2 : 0.5)],
  ["shopping.account", "Your Amazon account (read-only)", "show my amazon account", [
    "(show|open) [me] my amazon (account|settings|preferences)", "am i a prime member", "(what is|whats) my prime (status|membership)", "open my amazon (addresses|payment methods|prime settings|cart)",
  ], (c) => (/\bamazon (account|settings|preferences|addresses|cart)\b|\bprime (member|status|membership)\b/.test(c.q) ? 1.35 : 0.5)],
  ["shopping.open", "Open Shopping", "open shopping", ["(open|show) [the] shopping [panel|window]", "open amazon shopping", "show my saved items [on amazon]"],
    (c) => (/\bshopping\b/.test(c.q) && !/\bshopping list\b/.test(c.q) ? 1.3 : 0.5)],
  ["shopping.signin", "Sign in to Amazon in Dayspring", "sign in to amazon", ["(sign|log) [me] in to amazon", "(sign|log) [me] out of amazon", "am i signed in to amazon"], (c) => (NOT.test(c.q) ? 0.3 : AMZ.test(c.q) && /\b(sign|log|signed|logged)\b/.test(c.q) ? 1.4 : 0.4)],
];
