// Every Amazon selector Dayspring uses, in one place, each with fallbacks (Amazon changes its pages often; the first one
// that finds something wins). When Amazon changes a page, this is the file to fix. lib/shopping/parse.mjs reads pages
// with these; lib/shopping/clicker.mjs clicks only the few buttons listed in CLICKABLE.
//
// THE SAFETY LISTS ARE HERE TOO:
//   FORBIDDEN    words that, on a button (its text, value, label, title, name or id) or in a selector, mean "this
//                spends money, subscribes, pays, signs up or changes the account". The click layer refuses them always.
//   CLICKABLE    the only buttons Dayspring ever presses, each only after the owner's own yes: "Add to Cart" and the
//                Subscribe & Save "Skip" for one delivery. Nothing else is clickable at all.

// ---- search results (/s?k=…) -------------------------------------------------------------------------------------------
export const RESULTS = {
  card: ['div.s-main-slot div[data-component-type="s-search-result"][data-asin]', 'div[data-component-type="s-search-result"][data-asin]', "div.s-result-item[data-asin]"],
  title: ['[data-cy="title-recipe"] h2 span', "h2 a span", "h2 span", "h2"],
  titleAria: ["h2[aria-label]"],
  link: ['[data-cy="title-recipe"] a.a-link-normal[href]', "h2 a[href]", "a.a-link-normal.s-no-outline[href]", 'a[href*="/dp/"]'],
  brand: ['[data-cy="title-recipe"] .a-row .a-size-base-plus', ".s-line-clamp-1 .a-size-base-plus", "h5 .a-size-base-plus"],
  image: ["img.s-image", 'img[data-image-latency="s-product-image"]', ".s-product-image-container img"],
  price: [".a-price:not(.a-text-price) .a-offscreen", '[data-cy="price-recipe"] .a-price .a-offscreen', ".a-price .a-offscreen"],
  listPrice: [".a-price.a-text-price .a-offscreen", '[data-a-strike="true"] .a-offscreen'],
  rating: ['[data-cy="reviews-ratings-slot"] .a-icon-alt', "i.a-icon-star-small .a-icon-alt", "i[class*=\"a-star\"] .a-icon-alt", 'span[aria-label*="out of 5 stars"]'],
  reviews: ['[data-cy="reviews-block"] a[href*="customerReviews"] span', 'a[href*="#customerReviews"] span.a-size-base', 'span[aria-label$="ratings"]', 'span[aria-label$="reviews"]', "span.s-underline-text"],
  prime: ["i.a-icon-prime", '[aria-label="Amazon Prime"]', "span.s-prime", 'i[aria-label*="Prime"]'],
  delivery: ['[data-cy="delivery-recipe"]', ".udm-primary-delivery-message", '[data-cy="delivery-block"]'],
  sponsored: [".puis-sponsored-label-text", ".s-sponsored-label-text", "span.s-label-popover-default", '[aria-label="View Sponsored information or leave ad feedback"]'],
  badge: [".a-badge-text", '[data-component-type="s-status-badge-component"] .a-badge-text', ".s-badge-text"],
  next: ["a.s-pagination-next:not(.s-pagination-disabled)", 'a[aria-label^="Go to next page"]'],
  count: ['[data-component-type="s-result-info-bar"] h1 span', ".s-desktop-toolbar .a-section span", "#search > span[data-component-type=\"s-result-info-bar\"] span"],
  brandFilter: ['#brandsRefinements li a', '#filter-p_123 li a', '#filter-p_89 li a', 'div[id$="-brand"] li a'],
  brandName: [".a-size-base", "span"],
};

// ---- one item (/dp/ASIN) -----------------------------------------------------------------------------------------------
export const ITEM = {
  title: ["#productTitle", "#title span", "h1#title"],
  brand: ["#bylineInfo", "a#bylineInfo", "#brand"],
  price: ["#corePrice_feature_div .a-price .a-offscreen", "#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen", "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen", ".apexPriceToPay .a-offscreen", "#priceblock_ourprice", "#priceblock_dealprice", "#price_inside_buybox", "#tp_price_block_total_price_ww .a-offscreen"],
  listPrice: [".basisPrice .a-offscreen", "#corePriceDisplay_desktop_feature_div .a-text-price .a-offscreen", "#listPrice", ".priceBlockStrikePriceString"],
  savings: ["#corePriceDisplay_desktop_feature_div .savingsPercentage", ".savingsPercentage", "#regularprice_savings"],
  deal: ["#dealBadge_feature_div .a-badge-text", "#dealBadge_feature_div", ".dealBadge", "#deal_status_progress_feature_div"],
  landing: ["#landingImage", "#imgTagWrapperId img", "#main-image", "#imgBlkFront"],
  thumbs: ["#altImages li.imageThumbnail img", "#altImages li.item img", "#imageBlock .a-button-thumbnail img"],
  bullets: ["#feature-bullets ul li span.a-list-item", "#feature-bullets li", "#productFactsDesktopExpander li span.a-list-item"],
  specRows: ["#productDetails_techSpec_section_1 tr", "#productDetails_detailBullets_sections1 tr", "#prodDetails table tr", "#productOverview_feature_div tr", "#technicalSpecifications_section_1 tr"],
  detailBullets: ["#detailBullets_feature_div li span.a-list-item", "#detailBulletsWrapper_feature_div li span.a-list-item"],
  ratingText: ['#acrPopover[title]', "#acrPopover .a-icon-alt", '#averageCustomerReviews .a-icon-alt', 'span[data-hook="rating-out-of-text"]'],
  reviewCount: ["#acrCustomerReviewText", '#averageCustomerReviews #acrCustomerReviewText', 'span[data-hook="total-review-count"]'],
  histogram: ['#histogramTable a[aria-label*="percent of reviews"]', '#histogramTable li a[aria-label]', '#histogramTable tr', "#cm_cr_dp_d_rating_histogram tr"],
  review: ['#cm-cr-dp-review-list div[data-hook="review"]', 'div[data-hook="review"]', "#customer_review_list .review"],
  reviewTitle: ['[data-hook="review-title"] span:not(.a-icon-alt):not(.a-letter-space)', '[data-hook="review-title"]'],
  reviewStars: ['[data-hook="review-star-rating"] .a-icon-alt', '[data-hook="cmps-review-star-rating"] .a-icon-alt', "i.review-rating .a-icon-alt"],
  reviewBody: ['[data-hook="review-body"] span', '[data-hook="review-body"]', ".review-text"],
  reviewAuthor: [".a-profile-name"],
  reviewDate: ['[data-hook="review-date"]'],
  delivery: ["#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE", "#mir-layout-DELIVERY_BLOCK", "#deliveryBlockMessage", "#delivery-message", "#ddmDeliveryMessage"],
  stock: ["#availability span", "#availability", "#outOfStock", "#availabilityInsideBuyBox_feature_div"],
  seller: ["#merchantInfoFeature_feature_div .offer-display-feature-text-message", "#sellerProfileTriggerId", "#merchant-info", '#tabular-buybox [tabular-attribute-name="Sold by"] .tabular-buybox-text'],
  shipsFrom: ["#fulfillerInfoFeature_feature_div .offer-display-feature-text-message", '#tabular-buybox [tabular-attribute-name="Ships from"] .tabular-buybox-text'],
  otherOffers: ["#olpLinkWidget_feature_div a", "#buybox-see-all-buying-choices a", "#mbc-action-panel-wrapper a", ".olp-text-box"],
  subscribe: ["#snsAccordionRowMiddle", "#sns-base-price", "#snsBuyBox", '[id*="subscribeAndSave"]'],
  addToCart: ["#add-to-cart-button", 'input[name="submit.add-to-cart"]', "#add-to-cart-button-ubb"],
  quantity: ["#quantity", 'select[name="quantity"]'],
  twister: ['#twister div[id^="variation_"]', '#twister_feature_div div[id^="variation_"]', 'div[id^="inline-twister-row-"]'],
  twisterLabel: [".a-form-label", ".inline-twister-dim-title", "label"],
  twisterSelected: [".selection", ".inline-twister-dim-title .a-text-bold", ".a-dropdown-prompt"],
  twisterOption: ["li[data-defaultasin]", "li[data-asin]", "option[value]"],
};

// ---- the cart ----------------------------------------------------------------------------------------------------------
export const CART = {
  added: ["#NATC_SMART_WAGON_CONF_MSG_SUCCESS", "#sw-atc-details-single-container", "#huc-v2-order-row-confirm-text", "#attachDisplayAddBaseAlert", '#sw-atc-confirmation, [data-csa-c-content-id="sw-atc-confirmation"]'],
  count: ["#nav-cart-count", "#nav-cart .nav-cart-count"],
  subtotal: ["#sw-subtotal .a-price .a-offscreen", "#sc-subtotal-amount-buybox .a-price", "#sc-subtotal-amount-activecart"],
};

// ---- the checkout review page: recognised, NEVER pressed ------------------------------------------------------------------
export const CHECKOUT = {
  placeOrder: ["#submitOrderButtonId", 'input[name="placeYourOrder1"]', "#placeYourOrder", '[data-testid="SPC_selectPlaceOrder"]'],
  total: ["#subtotals-marketplace-table .grand-total-price", ".grand-total-price", "#spc-orders .grand-total-cell"],
};

// ---- your orders ---------------------------------------------------------------------------------------------------------
export const ORDERS = {
  card: [".order-card", ".js-order-card", "#ordersContainer .order", ".a-box-group.order"],
  date: [".order-header .a-column:first-child .a-size-base", ".order-header .a-span3 .value", ".order-info .a-column:first-child .value", '[data-ds="order-date"]'],
  total: [".order-header .yohtmlc-order-total .a-size-base", ".order-header .a-span2 .value", '[data-ds="order-total"]'],
  id: [".yohtmlc-order-id span[dir=\"ltr\"]", ".order-header .yohtmlc-order-id .a-color-secondary + span", ".order-info .actions .value", '[data-ds="order-id"]'],
  shipment: [".delivery-box", ".shipment", ".a-box.shipment"],
  status: [".delivery-box__primary-text", ".yohtmlc-shipment-status-primaryText", ".shipment-top-row .a-size-medium", '[data-ds="status"]'],
  track: ['a[href*="ship-track"]', ".track-package-button a", 'a[href*="progress-tracker"]'],
  item: [".yohtmlc-item", ".item-box", ".a-fixed-left-grid.item", '[data-ds="item"]'],
  itemTitle: [".yohtmlc-product-title a", ".yohtmlc-product-title", 'a.a-link-normal[href*="/dp/"]', 'a[href*="/gp/product/"]'],
  itemLink: ['.yohtmlc-product-title a[href]', 'a[href*="/dp/"]', 'a[href*="/gp/product/"]'],
  itemImage: [".product-image img", "img"],
  buyAgain: ['a[href*="/gp/buyagain"]', ".buy-it-again-button a", '[data-ds="buy-again"]'],
  none: ["#ordersContainer .a-section.a-text-center", ".your-orders-content-empty", '[data-ds="no-orders"]'],
};

// ---- Subscribe & Save -----------------------------------------------------------------------------------------------------
export const SUBS = {
  card: ['[data-subscription-id]', ".subscription-card", ".delivery-card [data-ds=\"sub\"]"],
  title: [".subscription-product-title", ".product-title", '[data-ds="title"]'],
  next: [".subscription-next-delivery", ".delivery-date", '[data-ds="next"]'],
  frequency: [".subscription-frequency", ".frequency", '[data-ds="frequency"]'],
  qty: [".subscription-quantity", ".quantity", '[data-ds="qty"]'],
  price: [".subscription-price", ".a-price .a-offscreen", '[data-ds="price"]'],
  image: ["img"],
  link: ['a[href*="/dp/"]', 'a[href*="/gp/product/"]'],
  isNew: [".subscription-new-badge", '[data-ds="new"]'],
};

// ---- your account (read-only) --------------------------------------------------------------------------------------------
export const ACCOUNT = {
  greeting: ["#nav-link-accountList-nav-line-1", "#nav-link-accountList .nav-line-1", "#glow-ingress-line1"],
  primeStatus: ["#prime-membership-status", ".prime-membership-status", '[data-ds="prime-status"]', ".pc-membership-status"],
  primePlan: ["#prime-plan-name", '[data-ds="prime-plan"]', ".pc-plan-name"],
  primeRenews: ["#prime-renewal-date", '[data-ds="prime-renews"]', ".pc-renewal-date"],
  addressDefault: ['#ya-myab-display-address-block-0', ".address-tile.default-address", ".a-box.address-tile:first-child", '[data-ds="address-default"]'],
  addressName: ["#address-ui-widgets-FullName", ".id-addr-ux-search-text .a-text-bold", "h5", '[data-ds="addr-name"]'],
  addressCity: ["#address-ui-widgets-CityStatePostalCountry", '[data-ds="addr-city"]'],
  comms: ['[data-ds="comm"]', ".gss-subscription-row", ".communication-preference"],
  commName: ['[data-ds="comm-name"]', ".gss-subscription-name", "label"],
  commOn: ['input[type="checkbox"][checked]', '[data-ds="comm-on"]'],
};

// ---- what kind of page this is -----------------------------------------------------------------------------------------
// (checked on every page Dayspring opens, before anything is read from it)
export const DETECT = {
  captchaUrl: /\/errors\/validateCaptcha|\/captcha|opfcaptcha/i,
  captcha: ['form[action*="validateCaptcha"]', "#captchacharacters", 'img[src*="captcha"]', "#auth-captcha-image", 'input[name="cvf_captcha_input"]'],
  captchaText: /enter the characters you see below|type the characters you see in this (image|picture)|make sure you'?re not a robot|solve this puzzle|to discuss automated access to amazon data/i,
  signinUrl: /\/ap\/(signin|mfa|cvf|challenge)|\/ax\/claim/i,
  signin: ['form[name="signIn"]', "#ap_email", "#ap_password", 'input[name="email"][type="email"]'],
  signedOutNav: /hello,\s*sign in/i,
  oopsText: /sorry!? something went wrong|we'?re sorry\.? an error occurred|service unavailable|looking for something\?\s*we'?re sorry\. the web address you entered/i,
  oops: ['img[alt*="Dogs of Amazon"]', 'a[href*="/ref=cs_503_link"]', "#g img[alt*=\"Sorry\"]"],
  noResultsText: /no results for|did not match any products/i,
};

// ---- the safety lists ---------------------------------------------------------------------------------------------------
// Words that mean "this spends money, subscribes, pays, signs up, cancels, or changes the account". Checked against a
// button's text, value, aria-label, title, name and id, against the selector itself, and against the form it submits.
export const FORBIDDEN = [
  /place\s*(your\s*)?order/i, /placeYourOrder/i, /submit\s*-?\s*order/i, /submitOrder/i, /\bspc\b/i, /turbo-?checkout/i,
  /buy[\s_-]*now/i, /\b1[\s-]*click\b/i, /one[\s-]*click/i, /\bbuy\b(?!\s*it\s*again\b)/i,
  /\bsubscribe\b/i, /subscribeAndSave/i, /\bsns-?(subscribe|signup|join)/i,
  /\bpay\b/i, /\bpayment/i, /\bpurchase\b/i, /complete\s*(your\s*)?(order|purchase)/i, /confirm\s*(your\s*)?(order|purchase)/i,
  /\bcheckout\b/i, /check\s*out/i, /proceed\s*to/i, /\bcontinue\b/i,
  /\bcancel\b/i, /\bend\s*(your\s*)?membership/i, /join\s*prime/i, /start\s*(your\s*)?(free\s*)?trial/i, /\bsign\s*-?\s*up\b/i, /\bsign\s*-?\s*in\b/i, /\bsign\s*-?\s*out\b/i,
  /\b(add|save|edit|update|change|remove|delete)\b.*\b(card|address|payment|password|phone|email|security|wallet)\b/i,
  /\bdelete\b/i, /\bremove\b/i, /\bpassword\b/i, /\bgift\s*card\b/i, /\bredeem\b/i, /\bdonate\b/i, /\bapply\b/i,
];
export const isForbidden = (s) => FORBIDDEN.some((re) => re.test(String(s ?? "")));
// Where a form or a request goes: these addresses place orders, pay, subscribe or sign up (checked on the form a button
// submits, and on every POST made while Dayspring's click is happening)
export const FORBIDDEN_POST = /place-?(your-?)?order|placeYourOrder|submitOrder|\/spc\/|\/buy\/spc|turbo|1-?click|one-?click|\/checkout\/p\/|\/checkout\/.*(place|submit)|subscribe(?!.*skip)|\/payments?\b|\/wallet|\/cpe\/|primecentral\/.*(join|cancel|end)|\/ap\/|\/ax\//i;
export const isForbiddenPost = (u) => FORBIDDEN_POST.test(String(u ?? ""));
// The only buttons Dayspring ever presses (lib/shopping/clicker.mjs), each after the owner's own yes.
//   selectors: where the button is; must: what the button itself must say (its text, value or label); posts: which form
//   submissions it may cause (any other POST during the click is blocked)
export const CLICKABLE = {
  "add-to-cart": { selectors: ITEM.addToCart, must: /^\s*add\s+to\s+(cart|basket)\s*$/i, posts: /\/(cart|gp\/product\/handle-buy-box|gp\/add-to-cart|gp\/aws\/cart)\b|add-to-cart|addToCart|smart-wagon|huc/i },
  "sns-skip": { selectors: ['button[data-action="skip-delivery"]', "button.subscription-skip", 'a[data-action="skip-delivery"]', 'span[data-action="skip-delivery"] button'], must: /^\s*skip(\s+(this\s+)?(delivery|shipment))?\s*$/i, posts: /\/auto-deliveries\/.*skip|\/subscribe-and-save\/.*skip|skipDelivery/i },
  // Amazon's "Skip this delivery?" question that can follow: its own Skip (the same yes, the same one delivery)
  "sns-skip-confirm": { selectors: ['[role="dialog"] button[data-action="confirm-skip"]', '.a-popover button[data-action="confirm-skip"]', '[role="dialog"] .skip-confirm-button'], must: /^\s*(yes,?\s+)?skip(\s+(this\s+)?(delivery|shipment))?\s*$/i, posts: /\/auto-deliveries\/.*skip|\/subscribe-and-save\/.*skip|skipDelivery/i },
};
