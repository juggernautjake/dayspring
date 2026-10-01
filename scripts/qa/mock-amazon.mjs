// A stand-in amazon.com on this computer, for scripts/qa/shopping.mjs. It serves the made-up pages of
// fixtures/amazon/pages.mjs, applies Amazon's own search parameters (k, rh with p_36 price, p_72 rating, p_85 Prime,
// p_89 brand, s sort, page) so the tests can see that filters re-ask the store, and keeps a log of every request.
// It also keeps score of the things that must NEVER happen: an order placed, Buy Now pressed, a robot check answered,
// a subscription cancelled, a payment or address changed. Modes (POST /__mock/mode): signedIn, autologin, captcha,
// oops, slowMs. Nothing here talks to the internet.
//   const m = await startMockAmazon({ port });  m.origin · m.log · m.flags · m.cart · m.subs · m.set(mode) · m.close()
import { createServer } from "node:http";
import * as P from "./fixtures/amazon/pages.mjs";

const PER_PAGE = 4;
const RATING_NODE = { "1248882011": 4, "1248883011": 3, "1248884011": 2, "1248885011": 1 };
const localDate = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export async function startMockAmazon({ port = 0 } = {}) {
  const state = {
    mode: { signedIn: false, autologin: true, captcha: false, oops: false, slowMs: 0 },
    log: [], cart: [], flags: { orderPlaced: false, buyNowPressed: false, captchaAnswered: false, subscriptionCancelled: false, accountChanged: false, skips: [] },
    subs: [
      { id: "SUB-001", asin: "B0TEST0201", inDays: 3, every: 2, qty: 1 },
      { id: "SUB-002", asin: "B0TEST0202", inDays: 12, every: 1, qty: 2, isNew: true },
      { id: "SUB-003", asin: "B0TEST0301", inDays: 5, every: 3, qty: 1 },
    ],
  };
  const subsNow = () => state.subs.map((s) => ({ ...s, next: localDate(new Date(Date.now() + s.inDays * 86_400_000)) }));
  const cookieIn = (req) => /(?:^|;\s*)at-main=/.test(req.headers.cookie ?? "");
  const html = (res, body, status = 200, headers = {}) => { res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers }); res.end(body); };
  const readBody = (req) => new Promise((ok) => { let b = ""; req.on("data", (d) => { b += d; if (b.length > 1e6) req.destroy(); }); req.on("end", () => ok(b)); });
  // a tiny picture for every product image (a 1×1 PNG)
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");

  // a made-up product picture (a drawn box with the product's initial), different for each product and picture
  const picture = (path) => {
    const asin = /\/I\/(B0[A-Z0-9]{8})/.exec(path)?.[1] ?? "";
    const prod = P.product(asin);
    let h = 0; for (const c of path) h = (h * 31 + c.charCodeAt(0)) % 360;
    const label = prod ? prod.brand : /swatch-(\w+)/.exec(path)?.[1] ?? "";
    const fill = label === "Charcoal" ? "#222" : label === "Walnut" ? "#7a4b2a" : `hsl(${h},55%,55%)`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="400" height="400" fill="#f4f4f6"/><rect x="70" y="90" width="260" height="220" rx="28" fill="${fill}"/><circle cx="200" cy="200" r="62" fill="#fff" opacity=".85"/><text x="200" y="222" font-family="Arial" font-size="64" font-weight="bold" text-anchor="middle" fill="${fill}">${(label || "?").slice(0, 1)}</text><text x="200" y="360" font-family="Arial" font-size="26" text-anchor="middle" fill="#555">${label} (test)</text></svg>`;
  };
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    const p = u.pathname;
    const entry = { at: Date.now(), method: req.method, path: p, query: Object.fromEntries(u.searchParams), signedIn: cookieIn(req) };
    if (!p.startsWith("/__mock") && !p.startsWith("/images/") && p !== "/favicon.ico") state.log.push(entry);
    try {
      // ---- the test's own controls
      if (p === "/__mock/mode" && req.method === "POST") { Object.assign(state.mode, JSON.parse((await readBody(req)) || "{}")); res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(state.mode)); }
      if (p === "/__mock/state") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ mode: state.mode, flags: state.flags, cart: state.cart.map((l) => l.asin), log: state.log, subs: subsNow() })); }
      if (p.startsWith("/images/I/")) { res.writeHead(200, { "content-type": "image/svg+xml" }); return res.end(picture(p)); }
      if (p.startsWith("/images/") || p.startsWith("/captcha/")) { res.writeHead(200, { "content-type": "image/png" }); return res.end(PNG); }
      if (p === "/favicon.ico") { res.writeHead(404); return res.end(); }
      if (state.mode.slowMs) await new Promise((r) => setTimeout(r, state.mode.slowMs));
      // ---- never: a robot check answered, an order placed, Buy Now, a subscription cancelled, the account changed
      if (p === "/errors/validateCaptcha") { if (u.searchParams.get("field-keywords")) state.flags.captchaAnswered = true; return html(res, P.captchaPage()); }
      if (/place-?order|placeYourOrder|\/checkout\/p\//i.test(p) || (req.method === "POST" && /\/gp\/buy\/spc/.test(p))) { state.flags.orderPlaced = true; return html(res, P.frame("<h1>Order placed (THIS MUST NEVER HAPPEN IN THE TESTS)</h1>")); }
      if (/cancelSubscription/.test(p)) { state.flags.subscriptionCancelled = true; res.writeHead(200); return res.end("{}"); }
      if (req.method === "POST" && /\/(a\/addresses|cpe\/|ax\/|gp\/primecentral)/.test(p)) { state.flags.accountChanged = true; res.writeHead(200); return res.end("{}"); }
      if (state.mode.oops) return html(res, P.oopsPage(), 503);
      if (state.mode.captcha) return html(res, P.captchaPage());
      // ---- signing in: the "owner" signs in by himself (autologin stands in for him typing his own password)
      if (p === "/ap/signin") {
        if (state.mode.autologin) { state.mode.signedIn = true; return html(res, P.frame("<p>Signed in (test).</p>"), 200, { "set-cookie": ["at-main=test-token; Path=/; Max-Age=86400", "x-main=test; Path=/; Max-Age=86400"] }); }
        return html(res, P.signinPage());
      }
      const signedIn = cookieIn(req) && state.mode.signedIn;
      const needSignin = () => html(res, P.signinPage(), 200);
      if (p === "/" || p === "/gp/css/homepage.html") return html(res, P.frame("<h1>Your Account (test)</h1>", { signedIn, cart: state.cart.length }));
      // ---- search, with Amazon's own parameters
      if (p === "/s") {
        const k = (u.searchParams.get("k") ?? "").toLowerCase();
        const words = k.split(/\s+/).filter((w) => w.length >= 3 && !/^(size|the|and|for|with)$/.test(w) && !/^\d+$/.test(w));
        let items = P.PRODUCTS.filter((x) => !x.trap || /trap/.test(k)).filter((x) => words.every((w) => `${x.title} ${x.words}`.toLowerCase().includes(w.replace(/s$/, ""))));
        const rh = (u.searchParams.get("rh") ?? "").split(",").filter(Boolean);
        for (const r of rh) {
          const [key, val] = r.split(":");
          if (key === "p_36") { const [lo, hi] = val.split("-"); if (lo) items = items.filter((x) => x.price * 100 >= Number(lo)); if (hi) items = items.filter((x) => x.price * 100 <= Number(hi)); }
          if (key === "p_72") items = items.filter((x) => x.rating >= (RATING_NODE[val] ?? 0));
          if (key === "p_85") items = items.filter((x) => x.prime);
          if (key === "p_89") items = items.filter((x) => x.brand.toLowerCase() === decodeURIComponent(val).toLowerCase());
          if (key === "p_123") { const b = P.BRANDS[Number(val) - 4000]; items = items.filter((x) => x.brand === b); }
        }
        const s = u.searchParams.get("s");
        if (s === "price-asc-rank") items.sort((a, b) => a.price - b.price);
        if (s === "price-desc-rank") items.sort((a, b) => b.price - a.price);
        if (s === "review-rank") items.sort((a, b) => b.rating - a.rating);
        const page = Math.max(1, Number(u.searchParams.get("page")) || 1);
        const slice = items.slice((page - 1) * PER_PAGE, page * PER_PAGE);
        const next = new URL(u.href); next.searchParams.set("page", String(page + 1));
        return html(res, P.searchPage({ query: u.searchParams.get("k") ?? "", items: slice, total: items.length, page, hasNext: page * PER_PAGE < items.length, nextHref: next.pathname + next.search, signedIn, cart: state.cart.length }));
      }
      // ---- an item
      let m;
      if ((m = /^\/(?:[^/]+\/)?dp\/([A-Z0-9]{10})/.exec(p))) { const page = P.itemPage(m[1], { signedIn, cart: state.cart.length }); return page ? html(res, page) : html(res, P.oopsPage(), 404); }
      // ---- the cart: Add to Cart (allowed, after the owner's yes), Buy Now (never)
      if (p.startsWith("/cart/add-to-cart") && req.method === "POST") {
        const f = new URLSearchParams(await readBody(req));
        if (f.has("submit.buy-now")) { state.flags.buyNowPressed = true; return html(res, P.frame("<h1>Buy Now pressed (THIS MUST NEVER HAPPEN)</h1>")); }
        const asin = f.get("ASIN"); const prod = P.product(asin);
        if (!prod) return html(res, P.oopsPage(), 404);
        state.cart.push({ asin, title: prod.title, price: prod.price });
        return html(res, P.cartAddedPage(prod, state.cart.length));
      }
      if (p === "/gp/cart/view.html") return html(res, P.cartPage(state.cart));
      if (p.startsWith("/checkout/entry/cart")) { if (!signedIn) return needSignin(); return html(res, P.checkoutPage(state.cart)); }
      // ---- his account (needs the sign-in)
      if (p === "/gp/css/order-history" || p === "/gp/your-account/order-history") {
        if (!signedIn) return needSignin();
        const q = (u.searchParams.get("search") ?? "").toLowerCase();
        const orders = q ? P.ORDERS.filter((o) => o.items.some((a) => P.product(a).title.toLowerCase().includes(q.replace(/s$/, "")))) : P.ORDERS;
        return html(res, P.ordersPage(orders));
      }
      if (p.startsWith("/gp/your-account/ship-track")) { if (!signedIn) return needSignin(); return html(res, P.frame("<h1>Track package (test)</h1><p>Delivered.</p>")); }
      if (p === "/auto-deliveries/landing" || p === "/auto-deliveries/subscriptionList") { if (!signedIn) return needSignin(); return html(res, P.subsPage(subsNow())); }
      if (p === "/auto-deliveries/ajax/skipDelivery" && req.method === "POST") {
        const id = u.searchParams.get("id"); const s = state.subs.find((x) => x.id === id);
        if (s) { state.flags.skips.push(id); s.inDays += s.every * 30; }
        res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: Boolean(s) }));
      }
      if (p === "/gp/primecentral") { if (!signedIn) return needSignin(); return html(res, P.primePage()); }
      if (p === "/a/addresses") { if (!signedIn) return needSignin(); return html(res, P.addressesPage()); }
      if (p === "/gp/gss/manage") { if (!signedIn) return needSignin(); return html(res, P.commsPage()); }
      if (p === "/cpe/yourpayments/wallet" || p === "/ax/account/manage") { if (!signedIn) return needSignin(); return html(res, P.frame("<h1>A settings page (test). Only the owner changes things here.</h1>")); }
      return html(res, P.frame("<h1>Not found (test)</h1>"), 404);
    } catch (e) { res.writeHead(500); res.end(String(e?.message ?? e)); }
  });
  await new Promise((ok) => server.listen(port, "127.0.0.1", ok));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, state, server,
    get log() { return state.log; }, get flags() { return state.flags; }, get cart() { return state.cart; },
    set: (mode) => Object.assign(state.mode, mode),
    clearLog: () => { state.log.length = 0; },
    close: () => new Promise((ok) => server.close(() => ok())),
  };
}
