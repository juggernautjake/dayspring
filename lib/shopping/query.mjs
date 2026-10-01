// Turning what the owner asked for into an Amazon search, with Amazon's OWN filters (its URL parameters and
// refinements), so a new filter re-asks Amazon instead of only hiding results on the screen.
//   normalize(filters) → clean filters      buildSearchUrl({ query, ...filters, page }) → a full address on site.origin()
//   parseRequest(text) → { query, filters, said } | null   the no-AI understanding of "find a waterproof work boot size 11
//                        under $120 on amazon" (with AI, the model fills the same fields through the shopping_search tool)
//   describe(filters) → "under $120, Prime only"            SORTS, RATINGS
import { url, PAGES } from "./site.mjs";

// Amazon's sort orders (s=…)
export const SORTS = {
  relevance: { s: "relevanceblender", label: "Best match" },
  "price-asc": { s: "price-asc-rank", label: "Price: low to high" },
  "price-desc": { s: "price-desc-rank", label: "Price: high to low" },
  reviews: { s: "review-rank", label: "Customer reviews" },
  newest: { s: "date-desc-rank", label: "Newest arrivals" },
  bestsellers: { s: "exact-aware-popularity-rank", label: "Best sellers" },
};
// Amazon's (US) customer-review refinement: p_72 with these node ids
export const RATINGS = { 4: "1248882011", 3: "1248883011", 2: "1248884011", 1: "1248885011" };
// Prime (free fast delivery) refinement
export const PRIME_NODE = "2470955011";

const num = (v) => { const c = String(v ?? "").replace(/[$,\s]/g, ""); if (!c) return null; const n = Number(c); return Number.isFinite(n) && n >= 0 ? n : null; };
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
export function normalize(f = {}) {
  let min = num(f.minPrice ?? f.min_price), max = num(f.maxPrice ?? f.max_price);
  if (min != null && max != null && min > max) [min, max] = [max, min];
  if (max === 0) max = null;
  const rating = [1, 2, 3, 4].includes(Math.floor(Number(f.minRating ?? f.min_rating))) ? Math.floor(Number(f.minRating ?? f.min_rating)) : null;
  const sort = SORTS[f.sort] ? f.sort : "relevance";
  const brand = clip(f.brand, 60).replace(/[^\p{L}\p{N} &'.+-]/gu, "") || null;
  return { minPrice: min, maxPrice: max, brand, prime: Boolean(f.prime ?? f.prime_only), minRating: rating, sort };
}
// Amazon's p_36 price refinement is in cents; low-price / high-price are the same in dollars (both are sent: whichever the
// page honours). Brand uses p_89 (the brand name); a brand refinement link read from the page (p_123) is used instead
// when there is one (brandHref).
export function buildSearchUrl({ query = "", page = 1, brandHref = null, ...f } = {}) {
  const F = normalize(f);
  const q = clip(query, 200);
  const u = new URL(url(PAGES.search));
  if (brandHref) { try { const b = new URL(brandHref, u.origin); for (const [k, v] of b.searchParams) if (k === "rh") u.searchParams.set("rh", v); } catch { /* fine */ } }
  u.searchParams.set("k", q);
  const rh = (u.searchParams.get("rh") ?? "").split(",").filter((x) => x && !/^p_(36|72|85):/.test(x) && !(F.brand && /^p_89:/.test(x)));
  if (F.minPrice != null || F.maxPrice != null) rh.push(`p_36:${F.minPrice != null ? Math.round(F.minPrice * 100) : ""}-${F.maxPrice != null ? Math.round(F.maxPrice * 100) : ""}`);
  if (F.minRating) rh.push(`p_72:${RATINGS[F.minRating]}`);
  if (F.prime) rh.push(`p_85:${PRIME_NODE}`);
  if (F.brand && !brandHref) rh.push(`p_89:${F.brand}`);
  if (rh.length) u.searchParams.set("rh", rh.join(","));
  if (F.minPrice != null) u.searchParams.set("low-price", String(F.minPrice));
  if (F.maxPrice != null) u.searchParams.set("high-price", String(F.maxPrice));
  if (F.sort !== "relevance") u.searchParams.set("s", SORTS[F.sort].s);
  if (page > 1) u.searchParams.set("page", String(Math.min(20, Math.floor(page))));
  return u.href;
}
const money = (n) => (n == null ? "" : `$${Number.isInteger(n) ? n : n.toFixed(2)}`);
export function describe(f = {}) {
  const F = normalize(f), out = [];
  if (F.minPrice != null && F.maxPrice != null) out.push(`${money(F.minPrice)} to ${money(F.maxPrice)}`);
  else if (F.maxPrice != null) out.push(`under ${money(F.maxPrice)}`);
  else if (F.minPrice != null) out.push(`over ${money(F.minPrice)}`);
  if (F.brand) out.push(`by ${F.brand}`);
  if (F.minRating) out.push(`${F.minRating} stars and up`);
  if (F.prime) out.push("Prime only");
  if (F.sort !== "relevance") out.push(SORTS[F.sort].label.toLowerCase());
  return out.join(", ");
}

// ---- the no-AI understanding ---------------------------------------------------------------------------------------------
const NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };
const MONEY = String.raw`\$?\s?(\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?)\s?(?:dollars?|bucks|usd)?`;
// words that are never part of what to search for
const LEAD = /^(?:(?:hey|ok|okay)\s+)?(?:dayspring[,\s]+)?(?:please\s+|can you\s+|could you\s+|would you\s+|will you\s+|i want you to\s+|i'?d like you to\s+|help me\s+)*/i;
const ASKS = [
  /^(?:(?:go\s+)?(?:find|search|look|hunt|shop|check)(?:\s+(?:up|for|around))*(?:\s+on)?\s+(?:amazon\s+(?:for\s+)?)?)(?:me\s+)?(?:if\s+(?:there(?:'s| is| are)|they\s+(?:have|sell))\s+)?/i,
  /^(?:is|are)\s+there\s+(?:any\s+)?/i,
  /^(?:is|are)\s+(?=.+\s(?:for sale|available|in stock)\b)/i,
  /^(?:does|do|can|will)\s+amazon\s+(?:have|sell|carry|stock)\s+/i,
  /^(?:does|do)\s+(?:they|you)\s+(?:sell|have|carry|stock)\s+/i,
  /^(?:can|could)\s+i\s+(?:buy|get|order|find)\s+/i,
  /^(?:show|pull up|get)\s+(?:me\s+)?/i,
  /^(?:amazon\s+(?:search|search for|find|look up)\s+)/i,
  /^(?:i\s+(?:need|want|am looking for|'m looking for|am shopping for|'m shopping for)\s+)/i,
];
const TAIL = [
  /\s+(?:for sale\s+)?on\s+(?:the\s+)?amazon(?:\.com)?(?:\s+(?:right now|today|please|for me))*\s*$/i,
  /\s+(?:at|from)\s+amazon(?:\.com)?\s*$/i,
  /\s+(?:on|at)\s+(?:the\s+)?amazon\s+(?:store|website|site|app)\s*$/i,
  /\s+for\s+sale\s*$/i,
  /\s+(?:anywhere|online)\s*$/i,
  /\s+(?:please|for me|right now)\s*$/i,
];
export function parseRequest(text) {
  let t = String(text ?? "").replace(/[“”]/g, '"').replace(/[’]/g, "'").replace(/[?!]+\s*$/, "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const said = t;
  t = t.replace(LEAD, "");
  for (const re of ASKS) { const n = t.replace(re, ""); if (n !== t) { t = n; break; } }
  for (let i = 0; i < 3; i++) for (const re of TAIL) t = t.replace(re, "");
  // "… on amazon sorted by reviews": the store's name in the middle goes too
  t = t.replace(/\s+(?:for sale\s+)?(?:on|at|from)\s+(?:the\s+)?amazon(?:\.com)?\b/gi, "");
  t = ` ${t} `;
  const f = {};
  let m;
  // price: a range, then a ceiling, then a floor
  const RANGE = new RegExp(String.raw`\s(?:between|from)\s${MONEY}\s(?:and|to|-)\s${MONEY}\s`, "i");
  const RANGE2 = new RegExp(String.raw`\s\$(\d{1,6}(?:\.\d{1,2})?)\s?(?:-|to)\s?\$?(\d{1,6}(?:\.\d{1,2})?)\s?(?:dollars?|bucks)?\s`, "i");
  if ((m = RANGE.exec(t)) || (m = RANGE2.exec(t))) { f.minPrice = num(m[1]); f.maxPrice = num(m[2]); t = t.replace(m[0], " "); }
  const UNDER = new RegExp(String.raw`\s(?:for\s+)?(?:that(?:'s| is| are)\s+|which (?:is|are)\s+)?(?:under|below|less than|cheaper than|no more than|not more than|at most|max(?:imum)?(?: of)?|up to|within|for less than|for under|beneath)\s${MONEY}\s`, "i");
  const UNDER2 = new RegExp(String.raw`\s${MONEY}\s(?:or (?:less|under|cheaper)|max(?:imum)?|tops|budget)\s`, "i");
  if ((m = UNDER.exec(t)) || (m = UNDER2.exec(t))) { f.maxPrice = num(m[1]); t = t.replace(m[0], " "); }
  const OVER = new RegExp(String.raw`\s(?:over|above|more than|at least|min(?:imum)?(?: of)?|starting at)\s${MONEY}\s`, "i");
  if ((m = OVER.exec(t)) && /\$|dollar|buck/i.test(m[0])) { f.minPrice = num(m[1]); t = t.replace(m[0], " "); }
  // spelled-out prices ("under fifty dollars")
  if (f.maxPrice == null && (m = /\s(?:under|below|less than)\s([a-z]+)(?:\s(hundred))?\s(?:dollars?|bucks)\s/i.exec(t)) && NUMW[m[1].toLowerCase()]) { f.maxPrice = NUMW[m[1].toLowerCase()] * (m[2] ? 100 : 1); t = t.replace(m[0], " "); }
  // rating
  if ((m = /\s(?:(?:rated|with)\s+)?(?:at least\s+)?([1-4])(?:\.0)?\s*(?:stars?|star rating)(?:\s+(?:and|or)\s+(?:up|above|higher|more|better))?(?:\s+or\s+(?:better|higher|more))?\s/i.exec(t))) { f.minRating = Number(m[1]); t = t.replace(m[0], " "); }
  else if ((m = /\s(?:that(?:'s| is| are)\s+)?(?:highly|well|top|best)[\s-]rated\s/i.exec(t))) { f.minRating = 4; t = t.replace(m[0], " "); }
  // Prime
  if ((m = /\s(?:(?:with|that (?:has|have|is|are)|that'?s|eligible for|on|only|just)\s+)?(?:amazon\s+)?prime(?:\s+(?:only|shipping|delivery|eligible))?(?:\s+only)?\s/i.exec(t)) && !/prime (video|day|music|reading|gaming|rib|time|number|minister|lens|meat|cut|member(ship)?)\b/i.test(t)) { f.prime = true; t = t.replace(m[0], " "); }
  else if ((m = /\s(?:with\s+)?free\s+(?:fast\s+)?(?:shipping|delivery)\s/i.exec(t))) { f.prime = true; t = t.replace(m[0], " "); }
  // sort
  if ((m = /\s(?:the\s+)?(cheapest|least expensive|lowest price(?:d)?|most expensive|priciest|highest price(?:d)?|best[\s-]?rated|top[\s-]?rated|most reviewed|newest|latest|best[\s-]?selling|best sellers?|most popular)(?:\s+(?:one|ones|first))?\s/i.exec(t))) {
    const w = m[1].toLowerCase();
    f.sort = /cheap|least|lowest/.test(w) ? "price-asc" : /most exp|pric|highest/.test(w) ? "price-desc" : /rated|reviewed/.test(w) ? "reviews" : /newest|latest/.test(w) ? "newest" : "bestsellers";
    t = t.replace(m[0], " ");
  }
  if ((m = /\s(?:sorted |sort |order(?:ed)? )by\s+(price(?: low to high| high to low)?|reviews?|ratings?|newest|best sellers?)\s/i.exec(t))) {
    const w = m[1].toLowerCase();
    f.sort = /high to low/.test(w) ? "price-desc" : /price/.test(w) ? "price-asc" : /review|rating/.test(w) ? "reviews" : /newest/.test(w) ? "newest" : "bestsellers";
    t = t.replace(m[0], " ");
  }
  // brand: "by Carhartt", "brand Carhartt", "from Carhartt", "made by Carhartt", "Carhartt brand"
  if ((m = /\s(?:(?:made|sold)\s+)?(?:by|from)\s+(?:the\s+)?(?:brand\s+)?([A-Za-z0-9][\w&'.+-]*(?:\s+[A-Z0-9][\w&'.+-]*){0,2})\s*$/.exec(t.trimEnd() + " ")) && !/^(amazon|the|a|an|my|me|size|color|colour)$/i.test(m[1])) { f.brand = m[1]; t = t.replace(m[0], " "); }
  else if ((m = /\s([A-Za-z0-9][\w&'.+-]*)\s+brand\s/i.exec(t)) && !/^(the|a|an|any|some|what|which|this|that|name|good|best|same|store|other|off|generic)$/i.test(m[1])) { f.brand = m[1]; t = t.replace(m[0], " "); }
  else if ((m = /\s(?:the\s+)?brand(?:\s+name)?\s+(?:is\s+)?([A-Za-z0-9][\w&'.+-]*)\s/i.exec(t))) { f.brand = m[1]; t = t.replace(m[0], " "); }
  // what's left is what to search for
  let q = t.replace(/\s(?:a|an|some|any|one|me|good|nice|new|that|which|for sale|available|i can buy|to buy|in stock)(?=\s)/gi, " ").replace(/\s+/g, " ").trim();
  q = q.replace(/^(?:for|of|the)\s+/i, "").replace(/\s+(?:for|with|that|and|or|on)$/i, "").replace(/^["']|["']$/g, "").trim();
  if (!q || q.length < 2 || /^(amazon|it|that|this|them|something|anything|stuff|things?)$/i.test(q)) return null;
  return { query: q.slice(0, 200), filters: normalize(f), said };
}
