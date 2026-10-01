// Shopping on Amazon (lib/shopping, public/shopping.js), tested WITHOUT the real amazon.com and WITHOUT the owner's
// browser profile: a stand-in Amazon on this computer (mock-amazon.mjs, made-up pages from fixtures/amazon/) and a
// throwaway copy of Dayspring with its own empty data and its own temp browser profile (headless, muted).
//   A. modules, in this process (no browser): the query and filter builder, understanding 30+ ways of asking (and the
//      look-alikes that must NOT shop: "play amazon music", "amazon river documentary", "read psalm 23"…), the parsers on
//      the saved stand-in pages, the click layer refusing "Place your order", "Buy Now", Subscribe, Pay…, nothing else
//      in lib/shopping able to click, type or submit, the yes-token gating, test mode refusing the real amazon.com, the
//      feature gate (production has none of it), the owner's switch, notices off = nothing polls
//   B. the whole thing: Settings → Shopping, signed out, signing in, searching by voice, Amazon's own filters, Show more,
//      an item, choosing a size and a colour, add to cart (No, then Yes; by tap and by voice), Buy now stopping at the
//      checkout page with the banner, a trap button that says Buy Now, orders and "when did I last buy", Buy it again,
//      Subscribe & Save (the notice, skipping with a yes), the account read-only (the street hidden), a robot check (shown,
//      never answered, everything paused, Continue), Amazon's error page, a slow Amazon, the pace and the memory, the
//      activity log, the window inside the screen's margins (big, small, minimised, back), closing by voice. Screenshots
//      go to the scratchpad (SHOP_SHOTS=<folder>) or the temp folder.
//   node scripts/qa/shopping.mjs [--unit] [--keep]
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { qaPort } from "./port.mjs";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIX = join(DESK, "scripts", "qa", "fixtures", "amazon");
const TMP = mkdtempSync(join(tmpdir(), "ds-shopping-"));
const UNIT = process.argv.includes("--unit"), KEEP = process.argv.includes("--keep");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, got = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && got !== "" ? "  (" + String(typeof got === "string" ? got : JSON.stringify(got)).slice(0, 400) + ")" : ""}`); };
const fx = (f) => readFileSync(join(FIX, f), "utf8");

// ====================================================================================================================== A
Object.assign(process.env, {
  DAYSPRING_CHANNEL: "dev", DAYSPRING_DATA_DIR: join(TMP, "data"), DAYSPRING_SHOPPING_FILE: join(TMP, "data", "shopping.json"), DAYSPRING_ACTIVITY_DIR: join(TMP, "data", "activity"),
  DAYSPRING_PERMISSIONS_FILE: join(TMP, "data", "permissions.json"), DAYSPRING_FEATURE_SWITCHES: join(TMP, "data", "feature-switches.json"), DAYSPRING_FEATURE_STAGES: join(TMP, "data", "feature-stages.json"),
  DAYSPRING_TIMERS_FILE: join(TMP, "timers.json"), DAYSPRING_RECIPES_FILE: join(TMP, "recipes.json"), DAYSPRING_LISTS_FILE: join(TMP, "lists.json"), DAYSPRING_INTENT_LEARNED: join(TMP, "learned.json"),
  DAYSPRING_INTENT_MISSES: join(TMP, "misses.json"), DAYSPRING_JOKES_TOLD: join(TMP, "jokes.json"), DAYSPRING_JOKE_OFFERS: join(TMP, "offers.json"), DAYSPRING_SETTINGS_FILE: join(TMP, "settings.json"),
  DAYSPRING_NO_BROWSER: "1", DAYSPRING_SHOPPING_TEST: "1", DAYSPRING_AMAZON_ORIGIN: "http://127.0.0.1:9", DAYSPRING_NO_MEDIA_BROWSER: "1", DAYSPRING_MEDIA_PROFILE: join(TMP, "unit-profile"),
});
mkdirSync(join(TMP, "data"), { recursive: true });
const imp = (p) => import(pathToFileURL(join(DESK, p)).href);
const Q = await imp("lib/shopping/query.mjs");
const P = await imp("lib/shopping/parse.mjs");
const SEL = await imp("lib/shopping/selectors.mjs");
const C = await imp("lib/shopping/clicker.mjs");
const site = await imp("lib/shopping/site.mjs");
const shop = await imp("lib/shopping/index.mjs");
const store = await imp("lib/shopping/store.mjs");
const driver = await imp("lib/shopping/driver.mjs");
const confirm = await imp("lib/confirm.mjs");
const F = await imp("lib/features.mjs");
const I = await imp("lib/intents/index.mjs");

console.log("— A. modules —");
// ---- the query and filter builder
{
  const u = new URL(Q.buildSearchUrl({ query: "waterproof work boot size 11", maxPrice: 120 }));
  check("query: the words go in k", u.searchParams.get("k") === "waterproof work boot size 11", u.href);
  check("query: under $120 is Amazon's p_36 (cents) and high-price", u.searchParams.get("rh") === "p_36:-12000" && u.searchParams.get("high-price") === "120", u.href);
  const all = new URL(Q.buildSearchUrl({ query: "boots", minPrice: 20, maxPrice: 80, brand: "Stormtrek", prime: true, minRating: 4, sort: "price-asc", page: 3 }));
  const rh = all.searchParams.get("rh").split(",");
  check("query: price range, rating, Prime and brand are Amazon's refinements", rh.includes("p_36:2000-8000") && rh.includes("p_72:1248882011") && rh.includes("p_85:2470955011") && rh.includes("p_89:Stormtrek"), rh.join(","));
  check("query: sort and page", all.searchParams.get("s") === "price-asc-rank" && all.searchParams.get("page") === "3");
  for (const [k, s] of [["price-desc", "price-desc-rank"], ["reviews", "review-rank"], ["newest", "date-desc-rank"], ["bestsellers", "exact-aware-popularity-rank"]]) check(`query: sort ${k} → s=${s}`, new URL(Q.buildSearchUrl({ query: "x", sort: k })).searchParams.get("s") === s);
  check("query: relevance has no s", !new URL(Q.buildSearchUrl({ query: "x" })).searchParams.has("s"));
  const brandRef = new URL(Q.buildSearchUrl({ query: "boots", brand: "Ridgeline", brandHref: "/s?k=boots&rh=n%3A1%2Cp_123%3A4001" }));
  check("query: a brand refinement Amazon offered (p_123) is used instead of p_89", brandRef.searchParams.get("rh").includes("p_123:4001") && !brandRef.searchParams.get("rh").includes("p_89"), brandRef.searchParams.get("rh"));
  const n = Q.normalize({ minPrice: 90, maxPrice: 30, minRating: 9, sort: "bogus", brand: "<b>Evil</b>" });
  check("query: normalize swaps a backwards range, drops a bad rating and sort, cleans the brand", n.minPrice === 30 && n.maxPrice === 90 && n.minRating === null && n.sort === "relevance" && !/[<>]/.test(n.brand), n);
  check("query: describe", Q.describe({ maxPrice: 120, prime: true, minRating: 4 }) === "under $120, 4 stars and up, Prime only", Q.describe({ maxPrice: 120, prime: true, minRating: 4 }));
  check("site: the address is amazon.com unless test mode points it at this computer", site.origin() === "http://127.0.0.1:9");
  process.env.DAYSPRING_AMAZON_ORIGIN = "http://evil.example.com"; check("site: test mode never points anywhere but this computer", site.origin() === site.REAL_ORIGIN);
  process.env.DAYSPRING_SHOPPING_TEST = "0"; process.env.DAYSPRING_AMAZON_ORIGIN = "http://127.0.0.1:9"; check("site: outside test mode the stand-in address is ignored", site.origin() === "https://www.amazon.com");
  process.env.DAYSPRING_SHOPPING_TEST = "1";
  check("site: an address from a page leading off Amazon is dropped", site.absolute("https://evil.example.com/dp/B0TEST0001") === null && site.absolute("/dp/B0TEST0001") === "http://127.0.0.1:9/dp/B0TEST0001");
}
// ---- understanding what he asked (no AI)
{
  const T = [
    ["find a waterproof work boot size 11 under $120 on amazon", { query: "waterproof work boot size 11", maxPrice: 120 }],
    ["is there a 6-outlet smart power strip on amazon", { query: "6-outlet smart power strip" }],
    ["search amazon for coffee filters", { query: "coffee filters" }],
    ["does amazon sell cast iron skillets under 40 dollars", { query: "cast iron skillets", maxPrice: 40 }],
    ["find me prime eligible usb c cables between $10 and $20 on amazon", { query: "usb c cables", minPrice: 10, maxPrice: 20, prime: true }],
    ["find the cheapest air fryer on amazon", { query: "air fryer", sort: "price-asc" }],
    ["find highly rated running shoes by Nike on amazon", { query: "running shoes", brand: "Nike", minRating: 4 }],
    ["look up 4 stars and up desk lamps on amazon", { query: "desk lamps", minRating: 4 }],
    ["can i buy a kindle paperwhite on amazon?", { query: "kindle paperwhite" }],
    ["find Carhartt brand beanies on amazon", { query: "beanies", brand: "Carhartt" }],
    ["find a phone case for iphone 15 from OtterBox on amazon", { query: "phone case for iphone 15", brand: "OtterBox" }],
    ["hey dayspring, find some wool socks under 25 bucks on amazon please", { query: "wool socks", maxPrice: 25 }],
    ["look for a standing desk over $200 on amazon", { query: "standing desk", minPrice: 200 }],
    ["find a cordless drill with free shipping on amazon", { query: "cordless drill", prime: true }],
    ["shop for a rain jacket on amazon", { query: "rain jacket" }],
    ["check amazon for a replacement water filter", { query: "replacement water filter" }],
    ["is a nintendo switch for sale on amazon", { query: "nintendo switch" }],
    ["find the most expensive espresso machine on amazon", { query: "espresso machine", sort: "price-desc" }],
    ["find the newest bluetooth speakers on amazon", { query: "bluetooth speakers", sort: "newest" }],
    ["find best selling notebooks on amazon", { query: "notebooks", sort: "bestsellers" }],
    ["find a 32 oz water bottle under $15 on amazon.com", { query: "32 oz water bottle", maxPrice: 15 }],
    ["find led light bulbs that are prime on amazon", { query: "led light bulbs", prime: true }],
    ["find a dog bed up to $60 on amazon", { query: "dog bed", maxPrice: 60 }],
    ["search for a laptop stand on amazon sorted by reviews", { query: "laptop stand", sort: "reviews" }],
    ["find 3 stars or better garden hoses on amazon", { query: "garden hoses", minRating: 3 }],
    ["find a car phone mount for less than $20 on amazon", { query: "car phone mount", maxPrice: 20 }],
    ["amazon search hiking backpack", { query: "hiking backpack" }],
    ["is there any good noise cancelling headphones on amazon", { query: "noise cancelling headphones" }],
    ["find a twin mattress $150 or less on amazon", { query: "twin mattress", maxPrice: 150 }],
    ["find kids rain boots from $20 to $40 on amazon", { query: "kids rain boots", minPrice: 20, maxPrice: 40 }],
    ["do they sell replacement vacuum belts on amazon", { query: "replacement vacuum belts" }],
    ["find work gloves made by Ironclad on amazon", { query: "work gloves", brand: "Ironclad" }],
  ];
  let ok = 0;
  for (const [text, want] of T) {
    const r = Q.parseRequest(text);
    const f = r?.filters ?? {};
    const good = r && r.query.toLowerCase() === want.query.toLowerCase() && Object.entries(want).filter(([k]) => k !== "query").every(([k, v]) => f[k] === v)
      && ["maxPrice", "minPrice", "brand", "minRating"].every((k) => k in want || f[k] == null) && (want.prime ? true : !f.prime) && (want.sort ? true : f.sort === "relevance");
    if (good) ok++; else check(`understands "${text}"`, false, r);
  }
  check(`understands ${T.length} ways of asking (query and filters)`, ok === T.length, `${ok}/${T.length}`);
}
// ---- the look-alikes that must NOT shop, and the ones that must
store.set({ enabled: true });
{
  const NOT = ["play amazon music", "play my discover weekly on amazon music", "amazon river documentary", "find a documentary about the amazon river", "watch the boys on prime video", "read psalm 23", "add milk to my shopping list",
    "what's on my shopping list", "go to amazon", "open amazon", "how big is the amazon rainforest", "tell me about amazon the company", "what is amazon's stock price", "play some music", "find coffee near me", "show me pictures of boots",
    "set a timer for 10 minutes", "what's the weather", "remind me to order coffee filters", "find my resume", "search youtube for work boots", "listen to the amazon rainforest sounds", "order a pizza"];
  let bad = [];
  for (const t of NOT) { const r = await shop.handle(t, { surface: "tv" }); const pl = I.plan(t, {}); if (r || String(pl.intent ?? "").startsWith("shopping.")) bad.push(`${t} → ${r?.intent ?? pl.intent}`); }
  check(`${NOT.length} look-alikes never shop ("play amazon music", "amazon river documentary", "read psalm 23", "my shopping list"…)`, !bad.length, bad.join(" | "));
  const YES = [["find a waterproof work boot on amazon", "shopping.search"], ["show my amazon orders", "shopping.orders"], ["when did i last buy coffee filters on amazon", "shopping.lastbought"], ["buy coffee filters again on amazon", "shopping.reorder"],
    ["show my subscribe and save", "shopping.subs"], ["show my amazon account", "shopping.account"], ["sign in to amazon", "shopping.signin"], ["is there a smart power strip on amazon", "shopping.search"], ["does amazon sell hiking boots", "shopping.search"]];
  bad = [];
  for (const [t, id] of YES) { const pl = I.plan(t, {}); if (pl.intent !== id) bad.push(`${t} → ${pl.intent} (${pl.ranked.slice(0, 2).map((r) => r.id).join(",")})`); }
  check(`the no-AI catalogue understands ${YES.length} shopping requests`, !bad.length, bad.join(" | "));
}
// ---- the parsers, on the saved stand-in pages
{
  const r = P.parseResults(fx("search-boots.html"));
  check("results: six cards with ASINs and titles", r.items.length === 6 && r.items.every((x) => site.isAsin(x.asin) && x.title), r.items.length);
  const a = r.items[0], s = r.items.find((x) => x.sponsored);
  check("results: price, list price, rating, reviews, Prime, delivery, badge, brand, picture", a.price === 109.99 && a.listPrice === 139.99 && a.rating === 4.6 && a.reviews === 12345 && a.prime && /Oct 3/.test(a.delivery) && a.badge === "Best Seller" && a.brand === "Stormtrek" && /B0TEST0001/.test(a.image), a);
  check("results: the sponsored one is marked, a non-Prime one isn't Prime", s?.asin === "B0TEST0004" && r.items.find((x) => x.asin === "B0TEST0003").prime === false);
  check("results: next page, total and Amazon's brand refinements", r.hasMore && /page=2/.test(r.nextHref) && r.total === 8 && r.brands.length === 8 && /p_123/.test(r.brands[0].href), r);
  const none = P.parseResults(fx("search-none.html"));
  check("results: an empty search says so", none.items.length === 0 && none.empty === true);
  const d = P.parseItem(fx("item-boot.html"), "B0TEST0001");
  check("item: title, brand, price, list price, savings, deal", /Waterproof Work Boot/.test(d.title) && d.brand === "Stormtrek" && d.price === 109.99 && d.listPrice === 139.99 && d.savings === "-21%" && /deal/i.test(d.deal), d);
  check("item: every picture once (gallery), big sizes", d.images.length === 4 && d.images.every((u) => /_AC_SL1500_|_AC_SL1200_/.test(u)), d.images);
  check("item: About this item (without Amazon's 'Make sure this fits')", d.bullets.length === 4 && !d.bullets.some((b) => /make sure/i.test(b)));
  check("item: details and specs", d.specs.some((x) => x.name === "Item Weight" && x.value === "4.2 pounds") && d.specs.some((x) => x.name === "Brand") && !d.specs.some((x) => /customer reviews/i.test(x.name)), d.specs);
  check("item: rating, count, the five-bar breakdown, three reviews", d.rating === 4.6 && d.reviews === 12345 && d.histogram.length === 5 && d.histogram[0].stars === 5 && d.histogram[0].pct === 72 && d.topReviews.length === 3 && d.topReviews[0].rating === 5 && d.topReviews[0].title === "Kept my feet dry all winter", d.topReviews[0]);
  check("item: delivery, seller, ships from, stock, buying options, Subscribe & Save", /Oct 3/.test(d.delivery) && d.seller === "Stormtrek Direct" && d.shipsFrom === "Amazon" && d.stock === "In Stock" && d.inStock && d.buyingOptions.length === 3 && d.subscribe, d);
  const col = d.variations.find((v) => v.key === "color"), size = d.variations.find((v) => v.key === "size");
  check("item: the customisations, each option with its own ASIN, the chosen one, the unavailable one", col?.selected === "Walnut" && size?.selected === "10" && size.options.length === 4 && size.options.find((o) => o.label === "11").asin === "B0TESTB011" && size.options.find((o) => o.label === "12").available === false && col.options.find((o) => o.label === "Charcoal").asin === "B0TESTK010", d.variations);
  const v11 = P.parseItem(fx("item-boot-walnut-11.html"), "B0TESTB011");
  check("item: a variant's own price and stock", v11.stock === "Only 3 left in stock - order soon." && v11.price === 109.99 && v11.variations.find((v) => v.key === "size").selected === "11");
  check("cart: Added to Cart, the count", JSON.stringify(P.parseCartAdded(fx("cart-added.html"))) === JSON.stringify({ added: true, count: 2, subtotal: 109.99 }));
  check("checkout: recognised (Place your order is there) with the total", P.parseCheckout(fx("checkout.html"), "http://x/checkout/entry/cart").review === true);
  const o = P.parseOrders(fx("orders.html"));
  check("orders: three orders with date, total, status, tracking, items with ASINs and Buy it again", o.orders.length === 3 && o.orders[0].date === "September 3, 2026" && o.orders[0].total === 31.48 && /Delivered/.test(o.orders[0].status) && /ship-track/.test(o.orders[0].track) && o.orders[0].items.length === 2 && o.orders[0].items[0].asin === "B0TEST0201" && o.orders[0].items[0].buyAgain && o.orders[0].id === "111-0000001-0000001", o.orders[0]);
  const sb = P.parseSubscriptions(fx("subscriptions.html"), new Date(2026, 9, 1));
  check("subscriptions: id, title, next date, frequency, quantity, new, Skip", sb.items.length === 2 && sb.items[0].id === "SUB-001" && sb.items[0].nextISO === "2026-10-05" && sb.items[1].isNew && sb.items[0].canSkip && sb.items[1].qty === 2, sb.items);
  const ad = P.parseAddresses(fx("addresses.html"));
  check("account: the default address's name and city only; the street is never read", ad.default.name === "Testshopper Example" && ad.default.city === "Exampletown, TX" && !JSON.stringify(ad).includes("Placeholder Lane"), ad);
  check("account: Prime and email preferences", P.parsePrime(fx("prime.html")).member === true && P.parseComms(fx("comms.html")).prefs.length === 3);
  check("page kinds: robot check, sign-in, Amazon's error page, a normal page (signed in)", P.pageKind(fx("captcha.html")).kind === "captcha" && P.pageKind(fx("signin.html")).kind === "signin" && P.pageKind(fx("oops.html")).kind === "oops" && P.pageKind(fx("orders.html")).kind === "ok" && P.pageKind(fx("orders.html")).signedIn === true);
  check("page kinds: a robot check by its address alone", P.pageKind("<html><body>hi</body></html>", "https://www.amazon.com/errors/validateCaptcha").kind === "captcha");
  check("page kinds: the one-time code page is a sign-in (never read)", P.pageKind("<html><body>Enter OTP</body></html>", "https://www.amazon.com/ap/mfa?x=1").kind === "signin");
  check("small readers: prices, ratings, counts", P.priceOf("$1,299.99") === 1299.99 && P.ratingOf("4.5 out of 5 stars") === 4.5 && P.countOf("(12.3K)") === 12300 && P.countOf("12,345 ratings") === 12345 && P.asinFrom("/x/dp/B0TEST0001/ref=1") === "B0TEST0001");
}
// ---- the click layer: "Place your order" and friends can never be pressed
{
  const NEVER = ["Place your order", "Place Order", "Buy Now", "Buy now with 1-Click", "1-Click ordering", "Subscribe & Save", "Subscribe", "Pay", "Pay now", "Payment method", "Add a card", "Proceed to checkout", "Checkout", "Cancel subscription", "Cancel", "End membership", "Join Prime", "Start your free trial", "Sign in", "Continue", "Remove address", "Delete", "Confirm order", "Complete purchase"];
  check("FORBIDDEN catches every final button word", NEVER.every((w) => SEL.isForbidden(w)), NEVER.filter((w) => !SEL.isForbidden(w)).join(", "));
  check("FORBIDDEN leaves Add to Cart and Skip alone", !SEL.isForbidden("Add to Cart") && !SEL.isForbidden("Skip") && !SEL.isForbidden("add-to-cart-button"));
  const SELS = ["#submitOrderButtonId", 'input[name="placeYourOrder1"]', "#buy-now-button", "#one-click-button", "#turbo-checkout-pyo-button", 'input[name="proceedToRetailCheckout"]', "#sns-base-subscribe", 'button[data-action="cancel-subscription"]', "#pay-button"];
  check("the click layer refuses purchase-final selectors as actions", SELS.every((s) => !C.judge(s, {}).ok), SELS.filter((s) => C.judge(s, {}).ok).join(", "));
  check("the click layer refuses a forbidden selector even for its own action", !C.judge("add-to-cart", { selector: "#buy-now-button", desc: { value: "Add to Cart" } }).ok && !C.judge("add-to-cart", { selector: "#submitOrderButtonId", desc: { text: "Add to Cart" } }).ok);
  check("the click layer refuses an Add to Cart spot whose button says Buy Now / Place your order / Subscribe / Pay",
    ["Buy Now", "Place your order", "Subscribe", "Pay"].every((w) => !C.judge("add-to-cart", { selector: "#add-to-cart-button", desc: { value: w, text: w } }).ok));
  check("the click layer refuses a button whose form places an order", !C.judge("add-to-cart", { selector: "#add-to-cart-button", desc: { value: "Add to Cart", formAction: "/gp/buy/spc/handlers/place-order" } }).ok && !C.judge("add-to-cart", { selector: "#add-to-cart-button", desc: { value: "Add to Cart", formAction: "/checkout/p/place-order" } }).ok);
  check("the click layer refuses a Skip spot that says Cancel subscription", !C.judge("sns-skip", { selector: 'button[data-action="skip-delivery"]', desc: { text: "Cancel subscription" } }).ok);
  check("the click layer allows exactly Add to Cart and Skip", C.judge("add-to-cart", { selector: "#add-to-cart-button", desc: { value: "Add to Cart", formAction: "/cart/add-to-cart/ref=x" } }).ok && C.judge("sns-skip", { selector: 'button[data-action="skip-delivery"]', desc: { text: "Skip", aria: "Skip delivery of Coffee Filters" } }).ok);
  // safeClick on a pretend page: never presses without the owner's yes, never anything outside its two buttons
  const clicks = [];
  const fakeEl = (desc) => ({ count: async () => 1, isVisible: async () => true, evaluate: async () => desc, click: async () => { clicks.push(desc); }, first() { return this; }, locator() { return this; } });
  const fakePage = (desc) => ({ locator: () => fakeEl(desc), route: async () => {}, unroute: async () => {}, waitForLoadState: async () => {}, waitForTimeout: async () => {} });
  const GOOD = { value: "Add to Cart", id: "add-to-cart-button", formAction: "/cart/add-to-cart/x" };
  const tryClick = async (...a) => { try { await C.safeClick(...a); return "clicked"; } catch (e) { return e.refused ? "refused" : "error: " + e.message; } };
  check("safeClick: no grant (no yes), no click", await tryClick(fakePage(GOOD), "add-to-cart", null) === "refused" && !clicks.length);
  check("safeClick: a yes for something else, no click", await tryClick(fakePage(GOOD), "add-to-cart", { ok: true, action: "sns-skip" }) === "refused" && !clicks.length);
  check("safeClick: 'Place your order' as an action, even with a grant, no click", await tryClick(fakePage({ text: "Place your order" }), "#submitOrderButtonId", { ok: true, action: "#submitOrderButtonId" }) === "refused" && !clicks.length);
  check("safeClick: the button turns out to say Buy Now, no click", await tryClick(fakePage({ ...GOOD, value: "Buy Now" }), "add-to-cart", { ok: true, action: "add-to-cart" }) === "refused" && !clicks.length);
  check("safeClick: a scope that isn't one subscription card, no click", await tryClick(fakePage({ text: "Skip" }), "sns-skip", { ok: true, action: "sns-skip" }, { within: "body" }) === "refused" && !clicks.length);
  check("safeClick: Add to Cart with its yes is pressed (once)", await tryClick(fakePage(GOOD), "add-to-cart", { ok: true, action: "add-to-cart" }) === "clicked" && clicks.length === 1);
  // nothing else in lib/shopping can press, type, fill or submit anything
  const dir = join(DESK, "lib", "shopping");
  const BAD = /(?<!permissions)\.(click|dblclick|press|tap|type|fill|check|uncheck|selectOption|setInputFiles|dispatchEvent|submit|requestSubmit|focus)\s*\(|\bkeyboard\.|\bmouse\./;
  const offenders = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".mjs"))) {
    const src = readFileSync(join(dir, f), "utf8").split("\n");
    src.forEach((l, i) => { const code = l.replace(/\/\/.*$/, ""); if (BAD.test(code) && !(f === "clicker.mjs" && /await el\.click\(\{ timeout \}\)/.test(code))) offenders.push(`${f}:${i + 1}`); });
  }
  check("only clicker.mjs clicks, and only once; nothing in lib/shopping types, fills, presses keys or submits", !offenders.length && (readFileSync(join(dir, "clicker.mjs"), "utf8").match(/\.click\(/g) ?? []).length === 1, offenders.join(", "));
}
// ---- test mode never reaches the real amazon.com
{
  let msg = "";
  try { await driver.open("https://www.amazon.com/s?k=boots"); } catch (e) { msg = e.message; }
  check("test mode refuses the real amazon.com", /never contacts the real amazon/i.test(msg), msg);
  try { await driver.open("https://example.com/"); msg = "opened"; } catch (e) { msg = e.message; }
  check("only Amazon pages are ever opened", /only opens amazon/i.test(msg), msg);
}
// ---- the yes gating (no browser: every refusal happens before Amazon is touched)
{
  let touched = 0;
  shop._setDeps({ browser: async () => { touched++; throw new Error("the browser must not be used here"); }, broadcast: () => {} });
  confirm._reset();
  const ask = shop.askCart({ asin: "B0TEST0001", mode: "cart", surface: "tv" });
  check("asking: a question with a one-time token, nothing done", ask.needsConfirm && ask.confirm_token && /Add .* to your Amazon cart\?/.test(ask.text) && touched === 0, ask);
  const noYes = await shop.cartWithToken({ asin: "B0TEST0001", mode: "cart", token: ask.confirm_token });
  check("no yes yet: nothing added, Amazon not touched", noYes.waiting && touched === 0, noYes);
  confirm.userSaid("yes", { surface: "call" });
  const callYes = await shop.cartWithToken({ asin: "B0TEST0001", mode: "cart", token: ask.confirm_token });
  check("a yes on a call doesn't count", callYes.waiting && touched === 0, callYes);
  confirm.userSaid("yes", { surface: "tv" });
  const other = await shop.cartWithToken({ asin: "B0TEST0002", mode: "cart", token: ask.confirm_token });
  check("the yes for one item can't add another", other.refused && touched === 0, other);
  const again = await shop.cartWithToken({ asin: "B0TEST0001", mode: "cart", token: ask.confirm_token });
  check("a token is used up after one try", again.refused && touched === 0, again);
  const ask2 = shop.askCart({ asin: "B0TEST0001", mode: "cart", surface: "tv" });
  confirm.userSaid("no", { surface: "tv" });
  const after = await shop.cartWithToken({ asin: "B0TEST0001", mode: "cart", token: ask2.confirm_token });
  check("a no cancels it", after.refused && touched === 0, after);
  const ask3 = shop.askCart({ asin: "B0TEST0001", mode: "buynow", surface: "tv" });
  confirm.userSaid("yes", { surface: "tv" });
  const mismatch = await shop.cartWithToken({ asin: "B0TEST0001", mode: "cart", token: ask3.confirm_token });
  check("a yes for 'buy now' isn't a yes for a different mode", mismatch.refused && touched === 0, mismatch);
  const t = await shop.runTool("shopping_cart", { asin: "B0TEST0001", mode: "cart", confirm_token: "made-up-token" });
  check("the AI can't make up a yes", (t.refused || t.error) && touched === 0, t);
  shop._setDeps({ browser: () => import(pathToFileURL(join(DESK, "lib", "browser.mjs")).href) });
}
// ---- the gates: production has none of it; his switch; notices off = nothing polls
{
  check("development: the feature is on, its tools offered", F.on("shopping") && F.toolAllowed("shopping_search"));
  process.env.DAYSPRING_CHANNEL = "stable"; F._clear();
  check("production: off (routes 404, no tools, no intents, no Settings section, no jobs)", !F.on("shopping") && F.routeBlocked("/shopping/status") === "shopping" && !F.toolAllowed("shopping_cart") && !F.intentAllowed("shopping.search") && F.hiddenSections().includes("shopping") && !F.startJob("shopping", "shopping.subscriptions", () => { throw new Error("must not run"); }));
  check("production: the words don't reach shopping", (await shop.handle("find work boots on amazon", { surface: "tv" })) === null);
  process.env.DAYSPRING_CHANNEL = "dev"; F._clear();
  store.set({ enabled: false });
  const off = await shop.handle("find work boots on amazon", { surface: "tv" });
  check("his switch off: it says so and opens nothing", /turned off/i.test(off?.reply ?? ""), off);
  const s0 = store.view();
  check("defaults: shopping off, notices off, ask-before-opening off", s0.enabled === false && s0.notify === false && s0.askBeforeOpen === false);
  store.set({ enabled: true, notify: false });
  check("notices off: no job runs and the check does nothing", shop.startSubsJob() === false && !shop.subsJobRunning() && (await shop.checkSubscriptions({ force: true })).skipped === "off");
  store.set({ notify: true });
  check("notices on: the daily job runs", shop.startSubsJob() === true && shop.subsJobRunning());
  store.set({ notify: false }); shop.startSubsJob();
  check("notices off again: the job stops", !shop.subsJobRunning());
  const tools = shop.TOOLS.map((x) => x.name);
  check("six AI tools, unique names, each saying when to ask first", tools.length === 6 && new Set(tools).size === 6 && /yes/i.test(shop.TOOLS.find((x) => x.name === "shopping_cart").description));
  check("activity log: shopping actions were logged in the temp folder", existsSync(join(TMP, "data", "activity")) && readdirSync(join(TMP, "data", "activity")).length > 0);
}
shop._reset();
if (UNIT) { finish(); }

// ====================================================================================================================== B
console.log("\n— B. the whole thing, against a stand-in Amazon —");
const { startMockAmazon } = await import(pathToFileURL(join(DESK, "scripts", "qa", "mock-amazon.mjs")).href);
const MPORT = await qaPort(4891, { env: null });
const mock = await startMockAmazon({ port: MPORT });
const PORT = await qaPort(4792), BASE = `http://127.0.0.1:${PORT}`;
const APP = join(TMP, "app");
const PW = [join(DESK, "node_modules", "playwright-core", "index.mjs")].find((p) => existsSync(p));
const { chromium } = await import(pathToFileURL(PW).href);
const SHOTS = process.env.SHOP_SHOTS || join(TMP, "shots");
mkdirSync(SHOTS, { recursive: true });
const ex = spawnSync(process.execPath, [join(DESK, "scripts", "export.mjs"), APP], { encoding: "utf8" });
check("a throwaway copy of Dayspring", existsSync(join(APP, "server.mjs")), (ex.stdout + ex.stderr).slice(-300));
spawnSync("cmd.exe", ["/d", "/c", "mklink", "/J", join(APP, "node_modules"), join(DESK, "node_modules")], { windowsHide: true });
mkdirSync(join(APP, "data"), { recursive: true });
writeFileSync(join(APP, "data", "owner.json"), JSON.stringify({ name: "Tester", setupDone: true, display: "primary" }));
const env = { ...process.env, PORT: String(PORT), DAYSPRING_DISPLAY: "", DAYSPRING_TV: "", DAYSPRING_NO_BROWSER: "1", DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_NO_OVERLAY: "1", DAYSPRING_NO_ECO: "1", DS_PROFILE: "DayspringQA",
  DAYSPRING_CHANNEL: "dev", DAYSPRING_SHOPPING_TEST: "1", DAYSPRING_AMAZON_ORIGIN: mock.origin, DAYSPRING_MEDIA_PROFILE: join(TMP, "media-profile"), DAYSPRING_SEARCH_PROFILE: join(TMP, "search-profile"), DAYSPRING_MEDIA_HEADLESS: "1",
  DAYSPRING_SHOPPING_GAP_MS: "300", DAYSPRING_SHOPPING_JITTER_MS: "100", DAYSPRING_SHOPPING_SIGNIN_POLL_MS: "400", DAYSPRING_SHOPPING_TIMEOUT_MS: "6000", DAYSPRING_SHOPPING_PAUSE_POLL_MS: "60000", DAYSPRING_SHOPPING_SUBS_TICK_MS: "3600000" };
for (const k of ["DAYSPRING_DATA_DIR", "DAYSPRING_SHOPPING_FILE", "DAYSPRING_ACTIVITY_DIR", "DAYSPRING_PERMISSIONS_FILE", "DAYSPRING_FEATURE_SWITCHES", "DAYSPRING_FEATURE_STAGES", "DAYSPRING_NO_MEDIA_BROWSER", "DAYSPRING_SETTINGS_FILE", "DAYSPRING_TIMERS_FILE", "DAYSPRING_RECIPES_FILE", "DAYSPRING_LISTS_FILE", "DAYSPRING_INTENT_LEARNED", "DAYSPRING_INTENT_MISSES", "DAYSPRING_JOKES_TOLD", "DAYSPRING_JOKE_OFFERS"]) delete env[k];
const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let serverLog = ""; server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
const up = async () => { try { return (await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
let isUp = false;
for (let i = 0; i < 120 && !(isUp = await up()); i++) await sleep(500);
check("the throwaway server is up", isUp, serverLog.slice(-400));
const api = async (path, body) => { const r = await fetch(BASE + "/api" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return r.json().catch(() => ({})); };
const say = async (message) => (await api("/chat", { message, surface: "tv" }));
const mockState = async () => (await fetch(mock.origin + "/__mock/state")).json();
const amazonHits = () => mock.log.length;
const waitFor = async (fn, ms = 15000, step = 250) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch { /* again */ } await sleep(step); } return null; };

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { const ss = window.speechSynthesis; if (ss) { ss.speak = (u) => setTimeout(() => u.onend?.(), 10); ss.cancel = () => {}; } HTMLMediaElement.prototype.play = function () { return Promise.resolve(); }; });
await ctx.route("**/api/{window,sound,keepawake,open,app/quit,update}**", (rt) => rt.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
const page = await ctx.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));
const shot = (name) => page.screenshot({ path: join(SHOTS, `shopping-${name}.png`) }).catch(() => {});
const ST = () => page.evaluate(() => window.dsShop?._state?.() ?? null);

try {
  // ---- off until he turns it on
  const s0 = await api("/shopping/status");
  check("Shopping starts off (his switch), the feature is on in development", s0.feature === true && s0.enabled === false, s0);
  const r0 = await say("find work boots on amazon");
  check("off: Dayspring says so and never contacts Amazon", /turned off/i.test(r0.reply ?? "") && amazonHits() === 0, r0.reply);
  // ---- Settings → Shopping (the real page)
  await page.goto(BASE + "/settings?s=shopping"); await page.waitForTimeout(1500);
  const hasSection = await page.locator("#shs-on").count();
  check("Settings → Shopping is there", hasSection === 1);
  if (hasSection) { await page.click("#shs-on"); await page.waitForTimeout(700); }
  const s1 = await api("/shopping/status");
  check("the switch turns it on", s1.enabled === true, s1);
  await shot("settings");
  // ---- signed out
  await page.goto(BASE + "/display"); await page.waitForTimeout(2500);
  if (await page.locator("#startBtn").isVisible().catch(() => false)) { await page.click("#startBtn"); await page.waitForTimeout(500); }
  check("🛒 Shop appears by the clock once it's on", await waitFor(() => page.locator("#shopBtn").count(), 5000) ? true : false);
  mock.set({ signedIn: false, autologin: false });
  const r1 = await say("show my amazon orders");
  check("signed out: a plain 'sign in' answer", /sign in/i.test(r1.reply ?? ""), r1.reply);
  await waitFor(async () => (await ST())?.open, 5000);
  const signCard = await page.locator('#dsShop [data-a="signin"]').isVisible().catch(() => false);
  check("signed out: the panel shows Sign in to Amazon", signCard, await ST());
  await shot("signed-out");
  // ---- signing in (the "owner" signs in by himself: the stand-in's sign-in page sets his cookie)
  mock.set({ autologin: true });
  await page.click('#dsShop [data-a="signin"]');
  const signed = await waitFor(async () => (await api("/shopping/status")).signedIn === true, 20000);
  check("Sign in to Amazon: Amazon's own sign-in shown, Dayspring notices when he's done", Boolean(signed), await api("/shopping/status"));
  check("…and knows the greeting name, never a password", (await api("/shopping/status")).account === "Testshopper" && !/password|token/i.test(readFileSync(join(APP, "data", "shopping.json"), "utf8")));
  // ---- searching by voice
  mock.clearLog();
  const r2 = await say("find a waterproof work boot size 11 under $120 on amazon");
  const s2 = mock.log.find((x) => x.path === "/s");
  check("voice search: Amazon is asked with the words and Amazon's own price filter", s2 && s2.query.k === "waterproof work boot size 11" && /p_36:-12000/.test(s2.query.rh ?? ""), s2);
  check("voice search: a spoken summary with numbers", /Number 1:/.test(r2.reply ?? ""), r2.reply);
  const st2 = await waitFor(async () => { const s = await ST(); return s?.open && s.results >= 4 ? s : null; }, 8000);
  check("the panel shows numbered results", Boolean(st2), await ST());
  const cards = await page.$$eval("#dsShop .sh-card", (els) => els.map((e) => ({ n: e.querySelector(".sh-n")?.textContent, price: Number((e.querySelector(".sh-price")?.textContent ?? "").replace(/[^0-9.]/g, "")), img: Boolean(e.querySelector("img.sh-img, .sh-ph")), rating: Boolean(e.querySelector(".sh-stars")), prime: Boolean(e.querySelector(".sh-prime")), spon: Boolean(e.querySelector(".sh-spon")) })));
  check("each card: picture, price, rating; all under $120", cards.length === 4 && cards.every((c) => c.img && c.rating && c.price > 0 && c.price <= 120), cards);
  check("Prime and Sponsored are shown", cards.some((c) => c.prime) && cards.some((c) => c.spon), cards);
  await shot("results");
  // ---- filters in the panel: Amazon is asked again
  mock.clearLog();
  await page.fill("#dsShop .sh-fbrand", "Stormtrek");
  await page.check("#dsShop .sh-fprime");
  await page.waitForTimeout(1200);
  await page.selectOption("#dsShop .sh-fsort", "price-asc");
  await page.waitForTimeout(1500);
  await waitFor(async () => !(await ST())?.busy, 8000);
  const sq = mock.log.filter((x) => x.path === "/s").at(-1);
  check("filters: brand, Prime and sort re-ask Amazon with its own parameters (the brand as Amazon's own refinement)", sq && /p_123:4000|p_89:Stormtrek/.test(sq.query.rh ?? "") && /p_85:2470955011/.test(sq.query.rh ?? "") && sq.query.s === "price-asc-rank" && /p_36:-12000/.test(sq.query.rh ?? ""), sq);
  const fcards = await page.$$eval("#dsShop .sh-card", (els) => els.map((e) => ({ t: e.querySelector(".sh-t")?.textContent ?? "", price: Number((e.querySelector(".sh-price")?.textContent ?? "").replace(/[^0-9.]/g, "")), prime: Boolean(e.querySelector(".sh-prime")) })));
  check("filters: only Stormtrek, Prime, cheapest first", fcards.length >= 2 && fcards.every((c) => /Stormtrek/.test(c.t) && c.prime) && fcards.every((c, i) => i === 0 || fcards[i - 1].price <= c.price), fcards);
  // voice filter on what's showing, then Show more
  const r3 = await say("clear the filters");
  check("voice: clear the filters", /Number 1/.test(r3.reply ?? ""), r3.reply);
  mock.clearLog();
  const r4 = await say("show more");
  const pg2 = mock.log.find((x) => x.path === "/s");
  check("voice: show more asks for Amazon's next page; numbering goes on", pg2?.query.page === "2" && /Number 5/.test(r4.reply ?? ""), [pg2?.query, r4.reply]);
  // ---- the pace and the memory
  mock.clearLog();
  await say("find a smart power strip on amazon"); await say("find usb-c cable on amazon"); await say("find a smart power strip on amazon");
  const sl = mock.log.filter((x) => x.path === "/s");
  check("memory: the same search twice is one visit to Amazon", sl.length === 2, sl.map((x) => x.query.k));
  const gaps = mock.log.slice(1).map((x, i) => x.at - mock.log[i].at);
  check("pace: at least the set gap between Amazon pages", gaps.every((g) => g >= 280), gaps);
  // ---- an item, its customisations
  await say("find a waterproof work boot size 11 under $120 on amazon");
  const r5 = await say("open number 1");
  check("voice: open number 1 reads the item", /Stormtrek/.test(r5.reply ?? "") && /\$109\.99/.test(r5.reply ?? ""), r5.reply);
  const st5 = await waitFor(async () => { const s = await ST(); return s?.tab === "item" && s.item ? s : null; }, 6000);
  check("the item view is open", st5?.item === "B0TEST0001", st5);
  const iv = await page.evaluate(() => ({ thumbs: document.querySelectorAll("#dsShop .sh-thumbs button").length, dims: document.querySelectorAll("#dsShop .sh-dim").length, bullets: document.querySelectorAll("#dsShop ul.sh-bul li").length, specs: document.querySelectorAll("#dsShop table.sh-specs tr").length, hist: document.querySelectorAll("#dsShop .sh-hist i").length, revs: document.querySelectorAll("#dsShop .sh-rev").length, acts: [...document.querySelectorAll("#dsShop .sh-info .sh-acts button")].map((b) => b.textContent.trim()) }));
  check("item view: gallery, choices, About this item, details, rating bars, reviews, the actions", iv.thumbs === 4 && iv.dims === 2 && iv.bullets === 4 && iv.specs >= 4 && iv.hist === 5 && iv.revs === 3 && iv.acts.some((a) => /Add to cart/.test(a)) && iv.acts.some((a) => /Buy now/.test(a)) && iv.acts.some((a) => /Save for later/.test(a)) && iv.acts.some((a) => /Open on Amazon/.test(a)), iv);
  await shot("item");
  await page.click('#dsShop [data-a="var"][data-val="11"]');
  const st6 = await waitFor(async () => { const s = await ST(); return s?.item === "B0TESTB011" ? s : null; }, 8000);
  check("choosing size 11 reads that option's own page: its price and stock", st6?.stock === "Only 3 left in stock - order soon.", await ST());
  const r7 = await say("color charcoal");
  const st7 = await waitFor(async () => { const s = await ST(); return s?.item === "B0TESTK011" ? s : null; }, 8000);
  check("voice: 'color charcoal' → the charcoal size 11, its own price", st7?.price === 114.99, [r7.reply, await ST()]);
  const r8 = await say("size 12");
  check("an unavailable option says so", /unavailable/i.test(r8.reply ?? ""), r8.reply);
  // ---- add to cart: No, then Yes (tap)
  await page.click('#dsShop [data-a="cart"][data-mode="cart"]');
  const askShown = await waitFor(async () => (await ST())?.ask?.kind === "cart", 5000);
  check("Add to cart asks first (the question card)", Boolean(askShown), await ST());
  await shot("ask");
  await page.click('#dsShop [data-a="no"]'); await page.waitForTimeout(800);
  check("No: nothing in the cart", (await mockState()).cart.length === 0);
  await page.click('#dsShop [data-a="cart"][data-mode="cart"]'); await waitFor(async () => (await ST())?.ask, 5000);
  await page.click('#dsShop [data-a="yes"]');
  const inCart = await waitFor(async () => (await mockState()).cart.includes("B0TESTK011"), 15000);
  check("Yes (tap): Add to Cart pressed for exactly that item", Boolean(inCart), (await mockState()).cart);
  // by voice: the question, then "yes"
  await say("find a smart power strip on amazon");
  const r9 = await say("add number 1 to my cart");
  check("voice: 'add number 1 to my cart' asks", /to your Amazon cart\?/.test(r9.reply ?? ""), r9.reply);
  const r10 = await say("yes");
  check("voice: 'yes' adds it", /Added .* to your Amazon cart/.test(r10.reply ?? "") && (await mockState()).cart.includes("B0TEST0101"), [r10.reply, (await mockState()).cart]);
  // ---- buy now: stops at the checkout page
  await say("find a waterproof work boot size 11 under $120 on amazon");
  await say("open number 2");
  await waitFor(async () => (await ST())?.item === "B0TEST0002", 6000);
  mock.clearLog();
  await page.click('#dsShop [data-a="cart"][data-mode="buynow"]'); await waitFor(async () => (await ST())?.ask, 5000);
  await page.click('#dsShop [data-a="yes"]');
  const ban = await waitFor(async () => (await ST())?.banner, 20000);
  check("Buy now: in the cart, then Amazon's checkout page with the banner", Boolean(ban) && mock.log.some((x) => x.path.startsWith("/checkout/entry/cart")) && (await mockState()).cart.includes("B0TEST0002"), await ST());
  const banText = await page.locator('#dsShop [data-k="banner"]').innerText().catch(() => "");
  check("…the banner says: Review and press Place order yourself", /Review and press Place order yourself/.test(banText), banText);
  await shot("checkout-banner");
  const fl1 = (await mockState()).flags;
  check("…and Dayspring never placed the order or pressed Buy Now", !fl1.orderPlaced && !fl1.buyNowPressed, fl1);
  // ---- the trap: a button in Add to Cart's place that says Buy Now and posts to an order address
  const trap = await api("/shopping/cart", { asin: "B0TESTTRAP", mode: "cart", yes: true });
  const fl2 = (await mockState()).flags;
  check("the trap: refused, nothing placed, nothing in the cart", (trap.refused || trap.error) && !fl2.orderPlaced && !fl2.buyNowPressed && !(await mockState()).cart.includes("B0TESTTRAP"), [trap, fl2]);
  // ---- orders, "when did I last buy", Buy it again
  const r11 = await say("show my amazon orders");
  check("orders: spoken and shown", /latest/.test(r11.reply ?? "") && (await waitFor(async () => (await ST())?.orders === 3, 6000)), [r11.reply, await ST()]);
  await shot("orders");
  mock.clearLog();
  const r12 = await say("when did i last buy coffee filters");
  check("'when did I last buy coffee filters' → the date, from Amazon's own order search", /September 3, 2026/.test(r12.reply ?? "") && mock.log.some((x) => x.query.search === "coffee filters"), [r12.reply, mock.log.map((x) => x.path)]);
  const before = (await mockState()).cart.length;
  await page.click('#dsShop [data-a="reorder"][data-asin="B0TEST0201"]');
  await waitFor(async () => (await ST())?.ask, 5000);
  await page.click('#dsShop [data-a="no"]'); await page.waitForTimeout(500);
  check("Buy it again asks; No adds nothing", (await mockState()).cart.length === before);
  const r13 = await say("buy coffee filters again on amazon");
  check("voice: 'buy coffee filters again' asks", /Buy it again/.test(r13.reply ?? ""), r13.reply);
  const r14 = await say("yes");
  check("…yes puts it in the cart, and he places the order himself", /Added/.test(r14.reply ?? "") && (await mockState()).cart.includes("B0TEST0201") && /place the order yourself/i.test(r14.reply ?? ""), r14.reply);
  // ---- Subscribe & Save
  const r15 = await say("show my subscribe and save");
  check("subscriptions: spoken and shown, soonest first", /3 Subscribe & Save subscriptions/.test(r15.reply ?? "") && (await waitFor(async () => (await ST())?.subs === 3, 6000)), r15.reply);
  await page.click('#dsShop [role="switch"][data-a="notify"]'); await page.waitForTimeout(600);
  const s15 = await api("/shopping/status");
  check("the notices switch in the panel turns his notices on", s15.settings.notify === true, s15.settings);
  await shot("subscriptions");
  const n1 = await api("/shopping/notify-now", {});
  check("the daily check: new and upcoming (within 7 days), with 'Want me to skip …?'", /New on Subscribe & Save: Softleaf/.test(n1.text ?? "") && /Coming in the next 7 days/.test(n1.text ?? "") && /Want me to skip/.test(n1.text ?? "") && !/Softleaf[^.;]*on /.test((n1.text ?? "").split("Coming")[1] ?? ""), n1);
  const n2 = await api("/shopping/notify-now", {});
  check("…told once: the same deliveries aren't told again", n2.told === 0, n2);
  const r16 = await say("yes");
  const fl3 = (await mockState()).flags;
  check("'yes' to the notice skips exactly that one delivery", /Skipped/.test(r16.reply ?? "") && fl3.skips.length === 1 && fl3.skips[0] === "SUB-001" && !fl3.subscriptionCancelled, [r16.reply, fl3]);
  await say("show my subscribe and save");
  await waitFor(async () => (await ST())?.subs === 3, 6000);
  await page.click('#dsShop [data-a="skip"][data-id="SUB-003"]');
  await waitFor(async () => (await ST())?.ask?.kind === "skip", 6000);
  await page.click('#dsShop [data-a="yes"]');
  const sk = await waitFor(async () => (await mockState()).flags.skips.includes("SUB-003"), 15000);
  check("Skip in the panel, with his tap: that one delivery only, never Cancel", Boolean(sk) && !(await mockState()).flags.subscriptionCancelled, (await mockState()).flags);
  const r17 = await say("turn off amazon subscription notifications");
  check("voice: notices off; nothing polls", /no more/i.test(r17.reply ?? "") && (await api("/shopping/status")).settings.notify === false && (await api("/shopping/notify-now", {})).skipped === "off", r17.reply);
  // ---- the account (read-only)
  const r18 = await say("show my amazon account");
  check("account: Prime and the default address's name, said", /Prime member/.test(r18.reply ?? "") && /Testshopper Example/.test(r18.reply ?? ""), r18.reply);
  await waitFor(async () => (await ST())?.account, 6000);
  const acct = await page.locator("#dsShop .sh-body").innerText();
  check("account: the street is hidden, preferences shown, Amazon's own pages to open", !/Placeholder Lane/.test(acct) && /hidden/.test(acct) && /Deals and recommendations/.test(acct) && /Payments/.test(acct), acct.slice(0, 300));
  await shot("account");
  const op = await api("/shopping/open", { page: "addresses" });
  check("opening his address page: shown to him, Dayspring never changes it", /never changes/.test(op.reply ?? "") && !(await mockState()).flags.accountChanged, op);
  // ---- a robot check: shown, never answered; everything waits; Continue
  mock.set({ captcha: true }); mock.clearLog();
  const r19 = await say("find a garden hose on amazon");
  check("robot check: plain words, never answered", /check that you're a person/i.test(r19.reply ?? "") && !(await mockState()).flags.captchaAnswered, r19.reply);
  const pausedSt = await api("/shopping/status");
  check("robot check: paused, the panel says so", Boolean(pausedSt.paused) && (await waitFor(async () => (await ST())?.paused, 5000)), pausedSt);
  await shot("captcha-paused");
  const hits = amazonHits();
  const r20 = await say("show my amazon orders");
  check("while paused nothing more is asked of Amazon", /person/i.test(r20.reply ?? "") && amazonHits() === hits, [r20.reply, amazonHits() - hits]);
  const still = await api("/shopping/resume", {});
  check("Continue while the check is still there: still paused", still.resumed === false);
  mock.set({ captcha: false });
  await page.goto(BASE + "/display"); await page.waitForTimeout(2000);
  if (await page.locator("#startBtn").isVisible().catch(() => false)) { await page.click("#startBtn"); await page.waitForTimeout(500); }
  const res = await api("/shopping/resume", {});
  const r21 = res.resumed ? await say("find a garden hose on amazon") : {};
  check("after he solves it himself: Continue, and shopping goes on", res.resumed === true && /Amazon (has|didn't)/.test(r21.reply ?? ""), [res, r21.reply]);
  check("the robot check was never answered", !(await mockState()).flags.captchaAnswered);
  // ---- Amazon's error page, a slow Amazon
  mock.set({ oops: true });
  const r22 = await say("find a desk lamp on amazon");
  check("Amazon's 'something went wrong' page: a plain answer", /something went wrong/i.test(r22.reply ?? "") && /try again/i.test(r22.reply ?? ""), r22.reply);
  mock.set({ oops: false, slowMs: 9000 });
  const r23 = await say("find a reading lamp on amazon");
  check("a slow Amazon: a plain 'took too long'", /took too long/i.test(r23.reply ?? ""), r23.reply);
  mock.set({ slowMs: 0 });
  await sleep(3500);
  // ---- the window: inside the margins, big, small, minimised, back; voice
  await say("find a waterproof work boot size 11 under $120 on amazon");
  await fetch(BASE + "/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ overscan: 0, marginTop: 8, marginBottom: 8, marginLeft: 8, marginRight: 8 }) });
  await page.waitForTimeout(1500);
  const fit = (sel) => page.evaluate((s) => {
    const S = window.dsSafeRect?.(), e = document.querySelector(s); if (!S || !e || e.hidden) return { ok: false, why: "missing" };
    const r = e.getBoundingClientRect(), tol = 1.5;
    const inside = (b) => b.left >= S.left - tol && b.top >= S.top - tol && b.right <= S.right + tol && b.bottom <= S.bottom + tol;
    const bad = [...e.querySelectorAll(".sh-bar button, .sh-filters button, .sh-search button")].filter((b) => b.offsetWidth).filter((b) => { b.scrollIntoView({ block: "nearest", inline: "nearest" }); const x = b.getBoundingClientRect(); const at = document.elementFromPoint(x.left + x.width / 2, x.top + x.height / 2); return !inside(x) || !(at && (at === b || b.contains(at))); });
    return { ok: inside(r) && !bad.length, box: [r.left, r.top, r.right, r.bottom].map(Math.round), safe: [S.left, S.top, S.right, S.bottom].map(Math.round), bad: bad.map((b) => b.textContent.trim()).slice(0, 3) };
  }, sel);
  const f1 = await fit("#dsShop");
  check("safe area: the panel and its buttons are inside 8% margins", f1.ok, f1);
  await page.evaluate(() => window.winman.setMode("shopping", "small")); await page.waitForTimeout(500);
  const f2 = await fit("#dsShop");
  check("safe area: as a small window too", f2.ok, f2);
  await shot("small-window");
  await page.evaluate(() => window.winman.setMode("shopping", "max")); await page.waitForTimeout(500);
  const f3 = await fit("#dsShop");
  check("safe area: big (inside the margins, never the TV's cropped edges)", f3.ok, f3);
  const rmin = await say("minimize shopping");
  const minimized = await waitFor(() => page.evaluate(() => document.querySelector("#dsShop").hidden && [...document.querySelectorAll("#wmDock .wm-chip")].some((c) => /Shopping/.test(c.textContent))), 5000);
  check("voice: 'minimize shopping' → a chip in the dock", Boolean(minimized), rmin.reply);
  await page.click('#wmDock .wm-chip[data-id="shopping"]'); await page.waitForTimeout(500);
  check("the chip brings it back", await page.evaluate(() => !document.querySelector("#dsShop").hidden));
  await page.evaluate(() => window.winman.setMode("shopping", "normal"));
  await fetch(BASE + "/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ overscan: 0, marginTop: 3, marginBottom: 12, marginLeft: 10, marginRight: 2 }) });
  await page.waitForTimeout(1500);
  const f4 = await fit("#dsShop");
  check("safe area: margins changed while open: it moves to stay inside", f4.ok, f4);
  await fetch(BASE + "/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ overscan: 0, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 }) });
  const r24 = await say("close shopping");
  check("voice: 'close shopping' closes it", (await waitFor(() => page.evaluate(() => document.querySelector("#dsShop").hidden), 4000)) === true, r24.reply);
  // ---- signing out
  const so = await api("/shopping/signout", {});
  check("Sign out: Amazon cleared from Dayspring's window only", /Signed out/.test(so.reply ?? "") && (await api("/shopping/status")).signedIn === false, so);
  mock.set({ signedIn: false, autologin: false });
  const r25 = await say("show my amazon orders");
  check("…after signing out: asks him to sign in again", /sign in/i.test(r25.reply ?? ""), r25.reply);
  // ---- the activity log (every Amazon action, no secrets)
  const logDir = join(APP, "data", "logs", "activity");
  const lines = existsSync(logDir) ? readdirSync(logDir).flatMap((f) => readFileSync(join(logDir, f), "utf8").split("\n").filter(Boolean)) : [];
  const kinds = new Set(lines.map((l) => { try { return JSON.parse(l).kind; } catch { return ""; } }));
  check("activity log: searches, items, cart, checkout, orders, subscriptions, skips, account, sign-in, the robot check, the blocked trap", ["shopping.search", "shopping.item", "shopping.cart", "shopping.checkout", "shopping.orders", "shopping.subscriptions", "shopping.skip", "shopping.account", "shopping.signin", "shopping.captcha", "blocked"].every((k) => kinds.has(k)), [...kinds].filter((k) => /shopping|blocked|confirm/.test(k)).join(","));
  check("activity log: no cookie, token or password", !lines.some((l) => /test-token|at-main=|password":"[^"]/.test(l)));
  // ---- the end: the things that must never happen
  const fl = (await mockState()).flags;
  check("never: an order placed, Buy Now pressed, a robot check answered, a subscription cancelled, the account changed", !fl.orderPlaced && !fl.buyNowPressed && !fl.captchaAnswered && !fl.subscriptionCancelled && !fl.accountChanged, fl);
  check("no page errors on the screen", errs.length === 0, errs.slice(0, 3).join(" | "));
} catch (e) { check("the run finished without an exception", false, e.stack ?? e.message); }

await browser.close().catch(() => {});
server.kill(); await mock.close(); await sleep(800);
finish();

function finish() {
  if (!KEEP) { try { if (existsSync(join(TMP, "app", "node_modules"))) spawnSync("cmd.exe", ["/d", "/c", "rmdir", join(TMP, "app", "node_modules")], { windowsHide: true }); rmSync(TMP, { recursive: true, force: true }); } catch { /* fine */ } }
  else console.log("kept:", TMP);
  console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nALL PASSED: ${pass} passed`);
  process.exit(fail ? 1 : 0);
}
