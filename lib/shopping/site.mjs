// Where Amazon is, in ONE place. amazon.com (the United States store) only, for now.
// The test scripts point it at a stand-in Amazon on this computer (scripts/qa/mock-amazon.mjs): only when
// DAYSPRING_SHOPPING_TEST=1 AND the address is this computer (127.0.0.1 / localhost). Anything else is ignored, so a
// stray setting can never send Dayspring (and the owner's sign-in) to some other site.
//   origin() → "https://www.amazon.com" · url(path) · PAGES (Amazon's own pages) · hosts() · isAmazonUrl(u) · testMode()
export const DOMAIN = "www.amazon.com";
export const REAL_ORIGIN = `https://${DOMAIN}`;
export const COUNTRY = "US";
export const CURRENCY = "USD";

export const testMode = () => process.env.DAYSPRING_SHOPPING_TEST === "1";
export function origin() {
  const t = String(process.env.DAYSPRING_AMAZON_ORIGIN ?? "").trim().replace(/\/+$/, "");
  if (testMode() && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(t)) return t;
  return REAL_ORIGIN;
}
export const url = (path = "/") => origin() + (String(path).startsWith("/") ? path : "/" + path);
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };
// the hosts whose cookies are the Amazon sign-in (the real ones, and the stand-in's in tests)
export const hosts = () => [...new Set(["amazon.com", "www.amazon.com", hostOf(origin())])];
export function isAmazonUrl(u) {
  const h = hostOf(u);
  if (!h) return false;
  if (testMode() && h === hostOf(origin())) return true;
  return h === "amazon.com" || h.endsWith(".amazon.com");
}
// an Amazon address from a page (often relative: "/dp/B0…") → a full address on THIS origin, or null when it leads
// anywhere else
export function absolute(href) {
  if (!href) return null;
  try {
    const u = new URL(String(href), origin() + "/");
    if (!isAmazonUrl(u.href)) return null;
    return origin() + u.pathname + u.search;
  } catch { return null; }
}

// Amazon's own pages (paths on origin()). Changing one of these is the only place a path lives.
export const PAGES = {
  home: "/",
  search: "/s",
  item: (asin) => `/dp/${asin}`,
  itemVariant: (asin) => `/dp/${asin}?th=1&psc=1`,
  cart: "/gp/cart/view.html",
  // the checkout review page (where the owner presses "Place your order" himself). Dayspring only ever OPENS it.
  checkout: "/checkout/entry/cart?proceedToCheckout=1",
  orders: "/gp/css/order-history",
  orderSearch: (q) => `/gp/your-account/order-history?opt=ab&search=${encodeURIComponent(q)}`,
  subscriptions: "/auto-deliveries/subscriptionList",
  upcoming: "/auto-deliveries/landing",
  prime: "/gp/primecentral",
  addresses: "/a/addresses",
  payments: "/cpe/yourpayments/wallet",
  security: "/ax/account/manage",
  comms: "/gp/gss/manage",
  account: "/gp/css/homepage.html",
  signin: () => `/ap/signin?openid.pape.max_auth_age=0&openid.return_to=${encodeURIComponent(origin() + "/")}&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=usflex&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0`,
};
// the settings pages the owner can be shown (he changes these himself on Amazon; Dayspring only opens them)
export const SETTINGS_PAGES = {
  account: { path: PAGES.account, title: "Your Account" },
  addresses: { path: PAGES.addresses, title: "Your addresses", ownerOnly: true },
  payments: { path: PAGES.payments, title: "Your payments", ownerOnly: true },
  security: { path: PAGES.security, title: "Login & security", ownerOnly: true },
  prime: { path: PAGES.prime, title: "Your Prime membership", ownerOnly: true },
  comms: { path: PAGES.comms, title: "Email and communication preferences" },
  subscriptions: { path: PAGES.subscriptions, title: "Subscribe & Save subscriptions" },
  upcoming: { path: PAGES.upcoming, title: "Subscribe & Save upcoming deliveries" },
  orders: { path: PAGES.orders, title: "Your orders" },
  cart: { path: PAGES.cart, title: "Your cart" },
};
// an ASIN: Amazon's 10-character product id
export const isAsin = (s) => /^[A-Z0-9]{10}$/.test(String(s ?? ""));
