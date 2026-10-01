// /api/shopping/*: the Shopping panel (public/shopping.js) and Settings → Shopping (public/shopping-settings.js).
// The whole prefix is the "shopping" feature (lib/features.mjs answers 404 while it's off).
//   GET  /shopping/status                     on/off, signed in, paused, the settings (never a cookie or a password)
//   GET  /shopping/state                      what the panel shows: results, the open item, orders, subscriptions, account
//   POST /shopping/settings { enabled, notify, notifyDays, askBeforeOpen, defaults }      Settings → Shopping
//   POST /shopping/search { query, filters, more, keepFilters }      POST /shopping/item { asin | n, variant }
//   POST /shopping/variant { dimension, value | asin }               POST /shopping/compare { numbers | asins }
//   POST /shopping/cart { asin, mode }  → the question (needsConfirm, token)
//   POST /shopping/cart { asin, mode, yes: true }   his tap on "Yes" in the panel: his own yes, for exactly that item
//   POST /shopping/checkout                   the checkout review page, shown to him (he places the order himself)
//   POST /shopping/orders { query }           POST /shopping/reorder { orderItem }
//   POST /shopping/subscriptions              POST /shopping/skip { id }  (question) · { id, yes: true } (his tap)
//   POST /shopping/account                    POST /shopping/open { page | asin }
//   POST /shopping/signin · /shopping/signout · /shopping/signin/check · /shopping/resume
//   POST /shopping/allow-open { yes: true }   "Ask before opening Amazon pages": his tap
//   POST /shopping/save { asin } · /shopping/unsave { asin } · /shopping/view { open, tab } · /shopping/notify-now (tests: run the daily check)
import * as shop from "./index.mjs";
import * as store from "./store.mjs";

export async function handle(req, res, { m, p, send, readJSON }) {
  if (!p.startsWith("/shopping/") && p !== "/shopping") return false;
  try {
    if (m === "GET" && p === "/shopping/status") return send(res, 200, shop.status()), true;
    if (m === "GET" && p === "/shopping/state") return send(res, 200, shop.state()), true;
    if (m !== "POST") return false;
    const b = await readJSON(req).catch(() => ({}));
    const out = (r) => send(res, r?.error && !r.needsConfirm ? (r.signIn || r.captcha ? 409 : 400) : 200, r);
    const tap = b.yes === true;          // the owner's own tap on the panel's Yes (the screen is his)
    switch (p) {
      case "/shopping/settings": {
        const v = store.set(b);
        shop.startSubsJob();
        return send(res, 200, { settings: v, status: shop.status() }), true;
      }
      case "/shopping/search": return out(b.more ? await shop.more({ surface: "tv" }) : await shop.search({ query: b.query, filters: b.filters ?? {}, keepFilters: Boolean(b.keepFilters), surface: "tv" })), true;
      case "/shopping/item": return out(await shop.item({ asin: b.asin, n: b.n, variant: Boolean(b.variant), surface: "tv" })), true;
      case "/shopping/variant": return out(await shop.variant({ dimension: b.dimension, value: b.value, asin: b.asin })), true;
      case "/shopping/compare": return out(await shop.compare({ numbers: Array.isArray(b.numbers) ? b.numbers : [], asins: Array.isArray(b.asins) ? b.asins : [] })), true;
      case "/shopping/cart": return out(tap ? await shop.cartWithToken({ asin: b.asin, mode: b.mode, via: "click" }) : shop.askCart({ asin: b.asin, n: b.n, orderItem: b.orderItem, mode: b.mode, surface: "tv" })), true;
      case "/shopping/checkout": return out(await shop.checkout()), true;
      case "/shopping/orders": return out(await shop.orders({ query: b.query ?? "", surface: "tv" })), true;
      case "/shopping/reorder": return out(shop.askCart({ orderItem: b.orderItem, asin: b.asin, mode: "reorder", surface: "tv" })), true;
      case "/shopping/subscriptions": return out(await shop.subscriptions({ surface: "tv", fresh: Boolean(b.fresh) })), true;
      case "/shopping/skip": return out(tap ? await shop.skipWithToken({ id: b.id, via: "click" }) : await shop.askSkip({ id: b.id, surface: "tv" })), true;
      case "/shopping/account": return out(await shop.account({ surface: "tv" })), true;
      case "/shopping/open": return out(b.page ? await shop.openPage(String(b.page)) : b.track ? await shop.openTrack(String(b.track)) : await shop.openItem({ asin: b.asin, n: b.n })), true;
      case "/shopping/window": return out(await shop.showWindow()), true;
      case "/shopping/signin": return out(await shop.signIn()), true;
      case "/shopping/signout": return out(await shop.signOut()), true;
      case "/shopping/signin/check": return out(await shop.checkSignin()), true;
      case "/shopping/resume": return send(res, 200, await shop.resume()), true;
      case "/shopping/allow-open": { if (!tap) return send(res, 400, { error: "Only your own tap allows this." }), true; return send(res, 200, shop.allowOpen(null, { via: "click" })), true; }
      case "/shopping/save": return out(shop.save({ asin: b.asin, n: b.n })), true;
      case "/shopping/unsave": return out(shop.unsave({ asin: b.asin })), true;
      case "/shopping/view": return send(res, 200, shop.setView(b)), true;
      case "/shopping/decline": return send(res, 200, shop.decline(String(b.token ?? ""))), true;
      case "/shopping/notify-now": { if (process.env.DAYSPRING_SHOPPING_TEST !== "1") return send(res, 404, { error: "no route" }), true; return send(res, 200, await shop.checkSubscriptions({ force: true })), true; }
    }
  } catch (e) { return send(res, 400, { error: e.message }), true; }
  return false;
}
