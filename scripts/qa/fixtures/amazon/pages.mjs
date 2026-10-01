// A stand-in Amazon for the shopping tests: hand-written pages in the SHAPE of amazon.com's (the same element ids,
// classes and data- attributes Dayspring's selectors look for), filled from a small MADE-UP catalogue. Nothing here
// comes from a real Amazon page or a real account: the brands, products, orders, subscriptions, the shopper's name
// and the address are all invented. scripts/qa/mock-amazon.mjs serves these; the parser tests read the saved copies
// (*.html next to this file, written by `node scripts/qa/fixtures/amazon/pages.mjs --write`).
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => `$${Number(n).toFixed(2)}`;
const img = (name) => `/images/I/${name}._AC_UL320_.jpg`;

// ---- the made-up catalogue ----------------------------------------------------------------------------------------------
export const PRODUCTS = [
  { asin: "B0TEST0001", title: "Stormtrek Men's Waterproof Work Boot, Steel Toe, Slip Resistant", brand: "Stormtrek", price: 109.99, list: 139.99, rating: 4.6, reviews: 12345, prime: true, words: "waterproof work boot boots steel toe men", badge: "Best Seller", delivery: "FREE delivery Fri, Oct 3", parent: "BOOT" },
  { asin: "B0TEST0002", title: "Ridgeline Men's Waterproof Leather Work Boot", brand: "Ridgeline", price: 89.99, rating: 4.3, reviews: 2311, prime: true, words: "waterproof work boot boots leather men", delivery: "FREE delivery Sat, Oct 4" },
  { asin: "B0TEST0003", title: "Northpeak Insulated Waterproof Work Boot, 8 inch", brand: "Northpeak", price: 129.99, rating: 4.7, reviews: 980, prime: false, words: "waterproof work boot boots insulated", delivery: "Delivery Tue, Oct 7" },
  { asin: "B0TEST0004", title: "Stormtrek Composite Toe Waterproof Work Boot", brand: "Stormtrek", price: 119.0, rating: 4.1, reviews: 455, prime: true, sponsored: true, words: "waterproof work boot boots composite toe", delivery: "FREE delivery Fri, Oct 3" },
  { asin: "B0TEST0005", title: "Puddle Budget Waterproof Work Boot", brand: "Puddle", price: 34.99, rating: 3.6, reviews: 120, prime: false, words: "waterproof work boot boots budget", delivery: "Delivery Oct 9 - 14" },
  { asin: "B0TEST0006", title: "Ridgeline Lightweight Waterproof Work Boot, Wide", brand: "Ridgeline", price: 74.5, rating: 4.8, reviews: 77, prime: true, words: "waterproof work boot boots wide lightweight", delivery: "FREE delivery Sat, Oct 4" },
  { asin: "B0TEST0007", title: "Stormtrek Waterproof Work Boot, Soft Toe", brand: "Stormtrek", price: 99.95, rating: 4.4, reviews: 3020, prime: true, words: "waterproof work boot boots soft toe", delivery: "FREE delivery Fri, Oct 3" },
  { asin: "B0TEST0008", title: "Northpeak Waterproof Hiking and Work Boot", brand: "Northpeak", price: 64.0, rating: 4.0, reviews: 610, prime: true, words: "waterproof work boot boots hiking", delivery: "FREE delivery Mon, Oct 6" },
  { asin: "B0TEST0101", title: "VoltHub 6-Outlet Smart Power Strip, Wi-Fi, Works with Voice Assistants", brand: "VoltHub", price: 29.99, rating: 4.4, reviews: 3210, prime: true, words: "6-outlet smart power strip wifi outlet", delivery: "FREE delivery Fri, Oct 3" },
  { asin: "B0TEST0102", title: "VoltHub Surge Protector 12 Outlets", brand: "VoltHub", price: 21.99, rating: 4.5, reviews: 8800, prime: true, words: "power strip surge protector outlet", delivery: "FREE delivery Fri, Oct 3" },
  { asin: "B0TEST0201", title: "BrewMate Basket Coffee Filters, 200 Count", brand: "BrewMate", price: 6.49, rating: 4.7, reviews: 15022, prime: true, words: "coffee filters basket", delivery: "FREE delivery Fri, Oct 3" },
  { asin: "B0TEST0202", title: "Softleaf Paper Towels, 12 Rolls", brand: "Softleaf", price: 24.99, rating: 4.6, reviews: 40211, prime: true, words: "paper towels", delivery: "FREE delivery Fri, Oct 3" },
  { asin: "B0TEST0301", title: "Glowline USB-C Cable 6 ft, 2 Pack", brand: "Glowline", price: 9.99, rating: 4.5, reviews: 21000, prime: true, words: "usb c cable usb-c charger", delivery: "FREE delivery Fri, Oct 3" },
  // a TRAP for the click layer: its "Add to Cart" button really says Buy Now and posts to an order address
  { asin: "B0TESTTRAP", title: "Trapdoor Test Widget (the safety test's trap)", brand: "Trapdoor", price: 1.0, rating: 1.0, reviews: 1, prime: false, words: "zz trap widget", trap: true },
];
// the work boot's customisations: colour × size → its own ASIN, price and stock
export const BOOT_VARIANTS = [
  { asin: "B0TEST0001", color: "Walnut", size: "10", price: 109.99, stock: "In Stock" },
  { asin: "B0TESTB009", color: "Walnut", size: "9", price: 104.99, stock: "In Stock" },
  { asin: "B0TESTB011", color: "Walnut", size: "11", price: 109.99, stock: "Only 3 left in stock - order soon." },
  { asin: "B0TESTB012", color: "Walnut", size: "12", price: 109.99, stock: "Currently unavailable.", unavailable: true },
  { asin: "B0TESTK010", color: "Charcoal", size: "10", price: 114.99, stock: "In Stock" },
  { asin: "B0TESTK011", color: "Charcoal", size: "11", price: 114.99, stock: "In Stock" },
];
export const BRANDS = ["Stormtrek", "Ridgeline", "Northpeak", "Puddle", "VoltHub", "BrewMate", "Softleaf", "Glowline"];
export const product = (asin) => PRODUCTS.find((p) => p.asin === asin) ?? (BOOT_VARIANTS.some((v) => v.asin === asin) ? { ...PRODUCTS[0], asin } : null);

// ---- the page frame (the nav bar shows who's signed in, like Amazon's) ------------------------------------------------------
export function frame(body, { title = "Amazon.com", signedIn = true, cart = 0 } = {}) {
  return `<!doctype html><html lang="en-us"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:14px Arial,sans-serif;margin:0;background:#fff;color:#0f1111}#navbar{background:#131921;color:#fff;padding:8px 14px;display:flex;gap:18px;align-items:center}.a-offscreen{position:absolute;left:-9999px}
.s-result-item{display:inline-block;width:220px;vertical-align:top;margin:8px;border:1px solid #ddd;padding:8px}img{max-width:100%}.a-button-unavailable{opacity:.4}button,input[type=submit]{cursor:pointer}</style></head>
<body><header id="navbar"><a href="/" id="nav-logo">amazon (test)</a><a id="nav-link-accountList" href="/gp/css/homepage.html"><span id="nav-link-accountList-nav-line-1">${signedIn ? "Hello, Testshopper" : "Hello, sign in"}</span></a>
<a id="nav-cart" href="/gp/cart/view.html">Cart <span id="nav-cart-count">${cart}</span></a></header><main id="a-page">${body}</main></body></html>`;
}

// ---- search results -----------------------------------------------------------------------------------------------------------
export function resultCard(p) {
  const stars = `${p.rating} out of 5 stars`;
  return `<div data-asin="${p.asin}" data-index="1" data-component-type="s-search-result" class="sg-col s-result-item s-asin">
  <div class="s-product-image-container"><a class="a-link-normal s-no-outline" href="/${esc(p.title.replace(/[^A-Za-z0-9]+/g, "-"))}/dp/${p.asin}/ref=sr_1_1?keywords=x"><img class="s-image" src="${img(p.asin)}" alt="${esc(p.title)}" data-image-latency="s-product-image"></a></div>
  ${p.sponsored ? '<div class="a-row"><span class="puis-sponsored-label-text">Sponsored</span></div>' : ""}
  ${p.badge ? `<span class="a-badge-text" data-a-badge-color="sx-orange">${esc(p.badge)}</span>` : ""}
  <div data-cy="title-recipe"><div class="a-row"><span class="a-size-base-plus a-color-base">${esc(p.brand)}</span></div>
    <a class="a-link-normal s-line-clamp-2 s-link-style a-text-normal" href="/${esc(p.title.replace(/[^A-Za-z0-9]+/g, "-"))}/dp/${p.asin}/ref=sr_1_1"><h2 aria-label="${esc(p.title)}" class="a-size-base-plus a-spacing-none a-color-base a-text-normal"><span>${esc(p.title)}</span></h2></a></div>
  <div data-cy="reviews-block" class="a-section"><span class="a-declarative"><a aria-label="${stars}, rating details" href="#"><i class="a-icon a-icon-star-small a-star-small-4-5"><span class="a-icon-alt">${stars}</span></i></a></span>
    <a href="/dp/${p.asin}#customerReviews" class="a-link-normal s-underline-text"><span aria-label="${p.reviews.toLocaleString("en-US")} ratings" class="a-size-base s-underline-text">(${p.reviews.toLocaleString("en-US")})</span></a></div>
  <div data-cy="price-recipe"><a class="a-link-normal s-no-hover" href="/dp/${p.asin}"><span class="a-price" data-a-size="xl"><span class="a-offscreen">${money(p.price)}</span><span aria-hidden="true">${money(p.price)}</span></span>
    ${p.list ? `<span class="a-price a-text-price" data-a-strike="true"><span class="a-offscreen">${money(p.list)}</span><span aria-hidden="true">${money(p.list)}</span></span>` : ""}</a></div>
  ${p.prime ? '<div class="a-row"><i class="a-icon a-icon-prime a-icon-medium" role="img" aria-label="Amazon Prime"></i></div>' : ""}
  <div data-cy="delivery-recipe"><div class="udm-primary-delivery-message">${esc(p.delivery ?? "")}</div></div>
</div>`;
}
export function searchPage({ query, items, total, page = 1, hasNext = false, nextHref = "", brands = BRANDS, signedIn = true, cart = 0 }) {
  const info = items.length ? `${(page - 1) * 4 + 1}-${(page - 1) * 4 + items.length} of ${total} results for` : "No results for";
  return frame(`<span data-component-type="s-result-info-bar"><h1><span>${info}</span> <span class="a-color-state a-text-bold">"${esc(query)}"</span></h1></span>
<div class="s-main-slot s-result-list s-search-results sg-row">${items.map(resultCard).join("\n")}</div>
${items.length ? "" : `<div class="s-no-outline"><span>No results for ${esc(query)}.</span> <span>Try checking your spelling or use more general terms</span></div>`}
<span class="s-pagination-strip">${page > 1 ? `<a class="s-pagination-previous" href="#">Previous</a>` : ""}${hasNext ? `<a href="${esc(nextHref)}" aria-label="Go to next page, page ${page + 1}" class="s-pagination-item s-pagination-next s-pagination-button">Next</a>` : '<span class="s-pagination-item s-pagination-next s-pagination-disabled">Next</span>'}</span>
<div id="brandsRefinements"><ul>${brands.map((b, i) => `<li id="p_123/${4000 + i}"><a class="a-link-normal s-navigation-item" href="/s?k=${encodeURIComponent(query)}&rh=n%3A1%2Cp_123%3A${4000 + i}"><span class="a-size-base a-color-base">${esc(b)}</span></a></li>`).join("")}</ul></div>`, { title: `Amazon.com : ${query}`, signedIn, cart });
}

// ---- one item ------------------------------------------------------------------------------------------------------------------
export function itemPage(asin, { signedIn = true, cart = 0 } = {}) {
  const v = BOOT_VARIANTS.find((x) => x.asin === asin);
  const p = v ? { ...PRODUCTS[0], asin, price: v.price } : product(asin);
  if (!p) return null;
  const stock = v ? v.stock : "In Stock";
  const pics = [1, 2, 3, 4].map((i) => `/images/I/${p.asin}-${v?.color ?? "x"}-${i}`);
  const twister = !v && p.parent !== "BOOT" ? "" : (() => {
    const cur = v ?? BOOT_VARIANTS[0];
    const sizes = ["9", "10", "11", "12"].map((s) => { const o = BOOT_VARIANTS.find((x) => x.color === cur.color && x.size === s); return `<li id="size_name_${s}" data-defaultasin="${o?.asin ?? ""}" data-dp-url="${o ? `/dp/${o.asin}?th=1&amp;psc=1` : ""}" class="swatch-list-item-text ${o && !o.unavailable ? "" : "swatchUnavailable"} ${s === cur.size ? "swatchSelect" : "swatchAvailable"}" title="Click to select ${s}"><span class="a-button"><span class="a-button-inner"><button class="a-button-text" type="button"><div class="twisterTextDiv text"><p class="a-text-left a-size-base">${s}</p></div></button></span></span></li>`; }).join("");
    const colors = ["Walnut", "Charcoal"].map((c) => { const o = BOOT_VARIANTS.find((x) => x.color === c && x.size === cur.size) ?? BOOT_VARIANTS.find((x) => x.color === c && !x.unavailable); return `<li id="color_name_${c}" data-defaultasin="${o?.asin ?? ""}" data-dp-url="/dp/${o?.asin ?? ""}?th=1&amp;psc=1" class="${c === cur.color ? "swatchSelect" : "swatchAvailable"}" title="Click to select ${c}"><span class="a-button"><span class="a-button-inner"><button class="a-button-text" type="button"><img alt="${c}" src="/images/I/swatch-${c}._SS36_.jpg"></button></span></span></li>`; }).join("");
    return `<div id="twister_feature_div"><form id="twister" method="get" action="/gp/twister/dimension">
      <div id="variation_color_name" class="a-section"><div class="a-row"><label class="a-form-label">Color: </label><span class="selection">${cur.color}</span></div><ul class="a-unordered-list a-nostyle a-button-list a-horizontal">${colors}</ul></div>
      <div id="variation_size_name" class="a-section"><div class="a-row"><label class="a-form-label">Size: </label><span class="selection">${cur.size}</span></div><ul class="a-unordered-list a-nostyle a-button-list a-horizontal">${sizes}</ul></div>
    </form></div>`;
  })();
  const trap = p.trap;
  const buyBox = `<div id="buybox"><div id="availability" class="a-section a-spacing-base"><span class="a-size-medium a-color-success">${esc(stock)}</span></div>
    <div id="mir-layout-DELIVERY_BLOCK"><span>${esc(p.delivery ?? "FREE delivery Fri, Oct 3")}</span></div>
    <form id="addToCart" method="post" action="${trap ? "/gp/buy/spc/handlers/place-order" : "/cart/add-to-cart/ref=dp_start-bbf_1_glance"}">
      <input type="hidden" name="ASIN" id="ASIN" value="${p.asin}"><input type="hidden" name="offerListingID" value="test-offer">
      <label for="quantity">Quantity:</label><select name="quantity" id="quantity"><option value="1" selected>1</option><option value="2">2</option></select>
      ${(v?.unavailable) ? "" : trap ? `<span id="submit.add-to-cart"><input id="add-to-cart-button" name="submit.add-to-cart" type="submit" value="Buy Now" aria-labelledby="atc-trap-label"><span id="atc-trap-label">Buy Now</span></span>`
        : `<span id="submit.add-to-cart" class="a-button a-button-primary"><span class="a-button-inner"><input id="add-to-cart-button" name="submit.add-to-cart" title="Add to Shopping Cart" type="submit" value="Add to Cart" class="a-button-input"><span class="a-button-text" aria-hidden="true">Add to Cart</span></span></span>
      <span id="submit.buy-now" class="a-button"><span class="a-button-inner"><input id="buy-now-button" name="submit.buy-now" title="Buy Now" type="submit" value="Buy Now" class="a-button-input"><span class="a-button-text" aria-hidden="true">Buy Now</span></span></span>`}
    </form>
    <div id="merchantInfoFeature_feature_div"><span class="offer-display-feature-text-message">${esc(p.brand)} Direct</span></div>
    <div id="fulfillerInfoFeature_feature_div"><span class="offer-display-feature-text-message">Amazon</span></div>
    <div id="snsAccordionRowMiddle"><span>Subscribe &amp; Save: ${money(p.price * 0.95)}</span></div>
    <div id="olpLinkWidget_feature_div"><a href="/gp/offer-listing/${p.asin}">New (5) from ${money(p.price - 3)}</a></div></div>`;
  return frame(`<link rel="canonical" href="/dp/${p.asin}">
<div id="dp-container">
 <div id="imageBlock"><div id="imgTagWrapperId"><img id="landingImage" src="${pics[0]}._AC_SX300_.jpg" data-old-hires="${pics[0]}._AC_SL1500_.jpg" data-a-dynamic-image='{"${pics[0]}._AC_SX300_.jpg":[300,300],"${pics[0]}._AC_SX679_.jpg":[679,679]}' alt="${esc(p.title)}"></div>
  <div id="altImages"><ul>${pics.map((u) => `<li class="a-spacing-small item imageThumbnail a-declarative"><span class="a-button-thumbnail"><img src="${u}._AC_US40_.jpg" alt=""></span></li>`).join("")}<li class="a-spacing-small item videoThumbnail"><img src="/images/I/play-icon-overlay._AC_US40_.png" alt=""></li></ul></div></div>
 <script type="text/javascript">P.when('A').register("ImageBlockATF", function(A){ var data = { 'colorImages': { 'initial': [${pics.map((u) => `{"hiRes":"${u}._AC_SL1500_.jpg","thumb":"${u}._AC_US40_.jpg","large":"${u}._AC_SX679_.jpg","variant":"MAIN"}`).join(",")}]} }; return data; });</script>
 <div id="centerCol">
  <h1 id="title"><span id="productTitle" class="a-size-large product-title-word-break">  ${esc(p.title)}${v ? `, ${v.color}, Size ${v.size}` : ""}  </span></h1>
  <a id="bylineInfo" href="/stores/${esc(p.brand)}">Visit the ${esc(p.brand)} Store</a>
  <div id="averageCustomerReviews"><span id="acrPopover" title="${p.rating} out of 5 stars"><i class="a-icon a-icon-star"><span class="a-icon-alt">${p.rating} out of 5 stars</span></i></span> <span id="acrCustomerReviewText">${p.reviews.toLocaleString("en-US")} ratings</span></div>
  ${p.badge ? `<div id="dealBadge_feature_div"><span class="a-badge-text">Limited time deal</span></div>` : ""}
  <div id="corePriceDisplay_desktop_feature_div"><span class="a-price aok-align-center priceToPay"><span class="a-offscreen">${money(p.price)}</span><span aria-hidden="true">${money(p.price)}</span></span>
    ${p.list ? `<span class="a-size-large a-color-price savingsPercentage">-${Math.round((1 - p.price / p.list) * 100)}%</span><span class="a-price a-text-price basisPrice"><span class="a-offscreen">${money(p.list)}</span></span>` : ""}</div>
  ${twister}
  <div id="productOverview_feature_div"><table><tr><td class="a-span3"><span class="a-text-bold">Brand</span></td><td class="a-span9"><span>${esc(p.brand)}</span></td></tr><tr><td class="a-span3"><span class="a-text-bold">Material</span></td><td class="a-span9"><span>Leather</span></td></tr></table></div>
  <div id="feature-bullets"><ul class="a-unordered-list a-vertical a-spacing-mini">
   <li><span class="a-list-item">Make sure this fits by entering your model number.</span></li>
   <li><span class="a-list-item">WATERPROOF: sealed seams keep feet dry in rain and slush.</span></li>
   <li><span class="a-list-item">PROTECTIVE TOE: meets the test safety standard for impact and compression.</span></li>
   <li><span class="a-list-item">GRIP: slip-resistant rubber outsole for wet floors.</span></li>
   <li><span class="a-list-item">COMFORT: cushioned insole and padded collar for long shifts.</span></li></ul></div>
 </div>
 ${buyBox}
 <div id="prodDetails"><table id="productDetails_techSpec_section_1" class="a-keyvalue prodDetTable"><tr><th class="a-color-secondary a-size-base prodDetSectionEntry"> Item Weight </th><td class="a-size-base prodDetAttrValue">&lrm;4.2 pounds</td></tr><tr><th class="a-color-secondary a-size-base prodDetSectionEntry"> Sole material </th><td class="a-size-base prodDetAttrValue">&lrm;Rubber</td></tr></table>
  <table id="productDetails_detailBullets_sections1" class="a-keyvalue prodDetTable"><tr><th class="a-color-secondary a-size-base prodDetSectionEntry"> ASIN </th><td class="a-size-base prodDetAttrValue">${p.asin}</td></tr><tr><th class="a-color-secondary a-size-base prodDetSectionEntry"> Customer Reviews </th><td>${p.rating} out of 5 stars</td></tr><tr><th class="a-color-secondary a-size-base prodDetSectionEntry"> Date First Available </th><td class="a-size-base prodDetAttrValue">March 3, 2025</td></tr></table></div>
 <div id="reviewsMedley"><table id="histogramTable" class="a-normal a-align-center a-spacing-base"><tbody>
  ${[[5, 72], [4, 15], [3, 6], [2, 3], [1, 4]].map(([s, pct]) => `<tr class="a-histogram-row"><td><a class="a-link-normal" aria-label="${pct} percent of reviews have ${s} stars" href="#">${s} star</a></td><td><div class="a-meter" role="progressbar" aria-valuenow="${pct}%"></div></td><td>${pct}%</td></tr>`).join("")}</tbody></table>
  <div id="cm-cr-dp-review-list">
   ${[["Kept my feet dry all winter", 5, "Wore these through a wet season on job sites. No leaks, good grip on wet concrete.", "R. Example", "Reviewed in the United States on August 2, 2026"], ["Runs a little narrow", 4, "Comfortable after a week of breaking in. Order half a size up if you have wide feet.", "J. Sample", "Reviewed in the United States on July 19, 2026"], ["Sole wore fast", 2, "Good for the price but the sole wore down in four months.", "T. Placeholder", "Reviewed in the United States on June 1, 2026"]]
     .map(([t, r, b, a, d]) => `<div id="R-${r}${a.length}" data-hook="review" class="a-section review aok-relative"><div class="a-profile-content"><span class="a-profile-name">${a}</span></div>
     <a data-hook="review-title" class="a-size-base a-link-normal review-title" href="#"><i data-hook="review-star-rating" class="a-icon a-icon-star a-star-${r}"><span class="a-icon-alt">${r}.0 out of 5 stars</span></i><span class="a-letter-space"></span><span>${t}</span></a>
     <span data-hook="review-date" class="a-size-base a-color-secondary review-date">${d}</span><div data-hook="review-body" class="a-expander-content"><span>${b}</span></div></div>`).join("")}
  </div></div>
</div>`, { title: `Amazon.com: ${p.title}`, signedIn, cart });
}

// ---- the cart and the checkout ---------------------------------------------------------------------------------------------
export function cartAddedPage(p, count) {
  return frame(`<div id="sw-atc-details-single-container"><div id="NATC_SMART_WAGON_CONF_MSG_SUCCESS"><h1 class="a-size-medium-plus a-color-base sw-atc-text a-text-bold">Added to Cart</h1></div>
<div class="a-section"><img src="${img(p.asin)}" alt=""><span>${esc(p.title)}</span></div><div id="sw-subtotal"><span class="a-price"><span class="a-offscreen">${money(p.price)}</span></span></div>
<a href="/gp/cart/view.html" class="a-button-text">Go to Cart</a> <form method="post" action="/checkout/entry/cart"><input type="submit" name="proceedToRetailCheckout" value="Proceed to checkout (${count} items)"></form></div>`, { title: "Amazon.com Shopping Cart", cart: count });
}
export function cartPage(lines) {
  return frame(`<h1>Shopping Cart</h1>${lines.length ? lines.map((l) => `<div class="sc-list-item" data-asin="${l.asin}"><span class="sc-product-title">${esc(l.title)}</span> <span class="sc-price">${money(l.price)}</span></div>`).join("") : "<p>Your Amazon Cart is empty.</p>"}
<div id="sc-subtotal-amount-activecart"><span>${money(lines.reduce((a, l) => a + l.price, 0))}</span></div>`, { title: "Amazon.com Shopping Cart", cart: lines.length });
}
export function checkoutPage(lines) {
  const total = lines.reduce((a, l) => a + l.price, 0) * 1.0825;
  return frame(`<h1>Review your order</h1><div id="spc-orders">${lines.map((l) => `<div class="item-row">${esc(l.title)} — ${money(l.price)}</div>`).join("")}</div>
<div id="shipping-address">Shipping to: Testshopper (test address)</div><div id="payment-information">Paying with: Test card ending in 0000</div>
<table id="subtotals-marketplace-table"><tr><td>Order total:</td><td class="grand-total-price">${money(total)}</td></tr></table>
<form id="spc-form" method="post" action="/checkout/p/place-order"><span id="submitOrderButtonId" class="a-button a-button-primary"><span class="a-button-inner"><input name="placeYourOrder1" class="a-button-input" type="submit" value="Place your order" aria-labelledby="submitOrderButtonId-announce"><span id="submitOrderButtonId-announce" class="a-button-text">Place your order</span></span></span></form>`, { title: "Amazon.com Checkout" });
}

// ---- your orders --------------------------------------------------------------------------------------------------------------
export const ORDERS = [
  { id: "111-0000001-0000001", date: "September 3, 2026", total: 31.48, status: "Delivered Sep 5", items: ["B0TEST0201", "B0TEST0202"] },
  { id: "111-0000002-0000002", date: "August 14, 2026", total: 29.99, status: "Delivered Aug 16", items: ["B0TEST0101"] },
  { id: "111-0000003-0000003", date: "June 2, 2026", total: 6.49, status: "Delivered Jun 4", items: ["B0TEST0201"] },
];
export function ordersPage(orders = ORDERS, { signedIn = true } = {}) {
  return frame(`<h1>Your Orders</h1><div id="ordersContainer">${!orders.length ? '<div class="a-section a-text-center your-orders-content-empty">We couldn\'t find any orders.</div>' : orders.map((o) => `<div class="a-box-group a-spacing-base order js-order-card order-card">
 <div class="a-box a-color-offset-background order-header"><div class="a-box-inner"><div class="a-fixed-right-grid"><div class="a-row">
  <div class="a-column a-span3"><div class="a-row a-size-mini"><span class="a-color-secondary">Order placed</span></div><div class="a-row"><span class="a-size-base a-color-secondary">${o.date}</span></div></div>
  <div class="a-column a-span2 yohtmlc-order-total"><div class="a-row a-size-mini"><span class="a-color-secondary">Total</span></div><div class="a-row"><span class="a-size-base a-color-secondary">${money(o.total)}</span></div></div>
  <div class="yohtmlc-order-id"><span class="a-color-secondary">Order #</span> <span class="a-color-secondary" dir="ltr">${o.id}</span></div></div></div></div></div>
 <div class="a-box delivery-box"><div class="a-box-inner"><div class="a-row"><span class="a-size-medium a-color-base a-text-bold delivery-box__primary-text">${o.status}</span></div>
  <span class="track-package-button"><a href="/gp/your-account/ship-track?orderId=${o.id}">Track package</a></span>
  ${o.items.map((a) => { const p = product(a); return `<div class="a-fixed-left-grid item-box"><div class="product-image"><a href="/gp/product/${a}/ref=ppx_yo_dt_b_asin_image"><img alt="" src="${img(a)}"></a></div>
   <div class="yohtmlc-product-title"><a class="a-link-normal" href="/gp/product/${a}/ref=ppx_yo_dt_b_asin_title">${esc(p.title)}</a></div>
   <span class="buy-it-again-button"><a href="/gp/buyagain?ats=${a}">Buy it again</a></span></div>`; }).join("")}</div></div></div>`).join("")}</div>`, { title: "Your Orders", signedIn });
}

// ---- Subscribe & Save (dates are given by the stand-in, relative to today) ----------------------------------------------------
export function subsPage(subs) {
  return frame(`<h1>Subscribe &amp; Save: upcoming deliveries</h1><div id="subscription-list">${subs.map((s) => { const p = product(s.asin); return `<div class="subscription-card a-box" data-subscription-id="${s.id}">
  <img src="${img(s.asin)}" alt=""><a href="/dp/${s.asin}"><span class="subscription-product-title">${esc(p.title)}</span></a>${s.isNew ? '<span class="subscription-new-badge">New</span>' : ""}
  <div class="subscription-next-delivery">Arriving ${s.next}</div><div class="subscription-frequency">Every ${s.every} months</div><div class="subscription-quantity">Qty: ${s.qty}</div>
  <div class="subscription-price"><span class="a-price"><span class="a-offscreen">${money(p.price * 0.95)}</span></span></div>
  <span class="a-button"><button type="button" data-action="skip-delivery" class="subscription-skip" aria-label="Skip delivery of ${esc(p.title)}">Skip</button></span>
  <span class="a-button"><button type="button" data-action="cancel-subscription">Cancel subscription</button></span>
  <span class="a-button"><button type="button" data-action="deliver-now">Deliver now</button></span></div>`; }).join("")}</div>
<div class="a-popover" role="dialog" id="skip-dialog" hidden aria-label="Skip this delivery?"><p>Skip this delivery?</p><button type="button" data-action="confirm-skip">Skip</button> <button type="button" data-action="dismiss">Keep it</button></div>
<script>
let target = null;
for (const b of document.querySelectorAll('[data-action="skip-delivery"]')) b.addEventListener("click", () => { target = b.closest("[data-subscription-id]").dataset.subscriptionId; document.getElementById("skip-dialog").hidden = false; });
document.querySelector('[data-action="confirm-skip"]').addEventListener("click", async () => { await fetch("/auto-deliveries/ajax/skipDelivery?id=" + encodeURIComponent(target), { method: "POST" }); location.reload(); });
document.querySelector('[data-action="cancel-subscription"]')?.addEventListener("click", () => fetch("/auto-deliveries/ajax/cancelSubscription", { method: "POST" }));
</script>`, { title: "Subscribe & Save" });
}

// ---- the account (read-only) -----------------------------------------------------------------------------------------------------
export const primePage = () => frame(`<h1>Prime Membership</h1><div id="prime-membership-status" class="pc-membership-status">Prime member since 2019</div><div id="prime-plan-name">Prime monthly plan (test)</div><div id="prime-renewal-date">October 20, 2026</div>
<button type="button">End membership</button>`, { title: "Prime Central" });
export const addressesPage = () => frame(`<h1>Your Addresses</h1><div id="ya-myab-display-address-block-0" class="a-box address-tile default-address"><span class="a-text-bold">Default:</span>
<ul><li><span id="address-ui-widgets-FullName" class="id-addr-ux-search-text a-text-bold">Testshopper Example</span></li><li><span id="address-ui-widgets-AddressLineOne">123 Placeholder Lane</span></li>
<li><span id="address-ui-widgets-CityStatePostalCountry">Exampletown, TX 00000</span></li><li><span id="address-ui-widgets-Country">United States</span></li></ul><a href="/a/addresses/edit">Edit</a> <a href="/a/addresses/remove">Remove</a></div>`, { title: "Your Addresses" });
export const commsPage = () => frame(`<h1>Email subscriptions</h1>
${[["Deals and recommendations", true], ["Subscribe & Save reminders", true], ["Prime Video news", false]].map(([n, on]) => `<div class="gss-subscription-row" data-ds="comm"><label><input type="checkbox"${on ? " checked" : ""}> <span class="gss-subscription-name">${n}</span></label></div>`).join("")}`, { title: "Communication preferences" });

// ---- the pages that stop everything ------------------------------------------------------------------------------------------------
export const captchaPage = () => `<!doctype html><html><head><title>Amazon.com</title></head><body><div class="a-container"><h4>Enter the characters you see below</h4><p class="a-last">Sorry, we just need to make sure you're not a robot. For best results, please make sure your browser is accepting cookies.</p>
<form method="get" action="/errors/validateCaptcha" name=""><img src="/captcha/test-captcha.jpg" alt=""><input autocomplete="off" type="text" id="captchacharacters" name="field-keywords" placeholder="Type characters"><button type="submit" class="a-button-text">Continue shopping</button></form></div></body></html>`;
export const signinPage = () => frame(`<div class="a-section"><h1 class="a-spacing-small">Sign in</h1><form name="signIn" method="post" action="/ap/signin"><label for="ap_email">Email or mobile phone number</label><input type="email" id="ap_email" name="email"><input type="submit" id="continue" value="Continue"></form></div>`, { title: "Amazon Sign-In", signedIn: false });
export const oopsPage = () => `<!doctype html><html><head><title>Sorry! Something went wrong!</title></head><body><a href="/ref=cs_503_logo"><img src="/images/G/01/error/logo.png" alt="Amazon.com"></a><h1>Sorry! Something went wrong!</h1><a href="/ref=cs_503_link">Go to the Amazon.com home page</a><img src="/images/G/01/error/dog.jpg" alt="Dogs of Amazon"></body></html>`;

// ---- writing the saved copies (the parser tests read these) ------------------------------------------------------------------------
export const SAVED = {
  "search-boots.html": () => searchPage({ query: "waterproof work boot", items: PRODUCTS.slice(0, 6), total: 8, page: 1, hasNext: true, nextHref: "/s?k=waterproof+work+boot&page=2" }),
  "search-none.html": () => searchPage({ query: "zzz nothing", items: [], total: 0 }),
  "item-boot.html": () => itemPage("B0TEST0001"),
  "item-boot-walnut-11.html": () => itemPage("B0TESTB011"),
  "item-trap.html": () => itemPage("B0TESTTRAP"),
  "cart-added.html": () => cartAddedPage(PRODUCTS[0], 2),
  "checkout.html": () => checkoutPage([{ ...PRODUCTS[0] }]),
  "orders.html": () => ordersPage(),
  "subscriptions.html": () => subsPage([{ id: "SUB-001", asin: "B0TEST0201", next: "Oct 5, 2026", every: 2, qty: 1 }, { id: "SUB-002", asin: "B0TEST0202", next: "Oct 19, 2026", every: 1, qty: 2, isNew: true }]),
  "prime.html": () => primePage(),
  "addresses.html": () => addressesPage(),
  "comms.html": () => commsPage(),
  "captcha.html": () => captchaPage(),
  "signin.html": () => signinPage(),
  "oops.html": () => oopsPage(),
};
if (process.argv.includes("--write")) {
  const { writeFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const dir = dirname(fileURLToPath(import.meta.url));
  for (const [f, make] of Object.entries(SAVED)) writeFileSync(join(dir, f), "<!-- A made-up stand-in page in the shape of amazon.com's, for Dayspring's tests. Not a real Amazon page; no real account data. -->\n" + make() + "\n");
  console.log(`wrote ${Object.keys(SAVED).length} fixture pages`);
}
