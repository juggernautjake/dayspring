// Shopping on Amazon (the "shopping" feature, lib/features.mjs; off until the owner turns it on in Settings → Shopping).
// Dayspring looks things up on amazon.com in its media window, where the owner signed in himself, and shows them in the
// Shopping panel on the screen (public/shopping.js): search by description with Amazon's own filters, an item's full
// details and its customisations, comparing, his orders, buying again, Subscribe & Save, his account (read-only).
//
// THE RULES (the owner's, and how they're kept):
//   - Dayspring NEVER buys. It never presses "Place your order", "Buy Now", any 1-Click, Subscribe, Pay or anything to do
//     with payment methods, addresses, passwords, security or Prime. Only lib/shopping/clicker.mjs can press anything, and
//     it presses only "Add to Cart" and Subscribe & Save's "Skip" (one delivery), each after the owner's own yes.
//   - "Buy now" and "Buy it again" put the item in the cart (after his yes) and open Amazon's checkout review page in a
//     window he can see, with "Review and press Place order yourself." He places the order, or doesn't.
//   - Every yes is a lib/confirm.mjs token: bound to exactly that item (or that delivery), one use, two minutes, and only
//     from the owner on his own screen (a tap, or his voice there; never a call, Discord or the AI itself).
//   - Nothing about payment, addresses (beyond the default's name and city), passwords or one-time codes is read, kept
//     or logged. Every Amazon action goes into the activity log (what was asked, never a secret).
//   - Robot checks are never solved: the page is shown to him and Dayspring waits (driver.mjs).
//
//   status() · state() · search(o) · more() · item(o) · variant(o) · compare(o) · askCart(o) · cartWithToken(o) · checkout()
//   orders(o) · reorder(o) · subscriptions() · askSkip(o) · skipWithToken(o) · account() · openPage(which) · openItem(o)
//   signIn() · signOut() · checkSignin() · resume() · save(o) · unsave(o) · setView(v) · handle(text, { surface })
//   TOOLS / runTool(name, input) · start({ announce }) · checkSubscriptions({ force })
import * as confirm from "../confirm.mjs";
import * as activity from "../activity.mjs";
import * as permissions from "../permissions.mjs";
import { on as featureOn } from "../features.mjs";
import { broadcast as busBroadcast } from "../bus.mjs";
import * as store from "./store.mjs";
import * as driver from "./driver.mjs";
import * as clicker from "./clicker.mjs";
import { PAGES, SETTINGS_PAGES, isAsin, isAmazonUrl } from "./site.mjs";
import { buildSearchUrl, normalize, describe as describeFilters, parseRequest, SORTS } from "./query.mjs";
import { parseResults, parseItem, parseCartAdded, parseCheckout, parseOrders, parseSubscriptions, parsePrime, parseAddresses, parseComms } from "./parse.mjs";
import { RESULTS, ORDERS } from "./selectors.mjs";
import { withAmazon } from "../intents/shopping.mjs";

export const FEATURE = "shopping";
let deps = {
  broadcast: busBroadcast,
  log: (kind, data) => { try { activity.log(kind, data); } catch { /* the log's own problem */ } },
  announce: null,
  now: () => Date.now(),
  othersAt: async () => {
    let t = 0;
    try { const m = await import("../mediabrowser/index.mjs"); t = Math.max(t, m.shownAt?.() ?? 0); } catch { /* none */ }
    try { const v = await import("../video/index.mjs"); const s = v.state(); if (s.grid && !s.grid.closed) t = Math.max(t, s.grid.at ?? 0); } catch { /* none */ }
    try { const ir = await import("../image-routes.mjs"); const v = ir.current(); if (v && !v.closed) t = Math.max(t, v.at ?? 0); } catch { /* none */ }
    try { const g = await import("../gifs/routes.mjs"); const v = g.current(); if (v && !v.closed) t = Math.max(t, v.at ?? 0); } catch { /* none */ }
    return t;
  },
};
export function _setDeps(d) { deps = { ...deps, ...d }; driver._setDeps({ ...(d.browser ? { browser: d.browser } : {}), ...(d.broadcast ? { broadcast: d.broadcast } : {}), log: (k, x) => deps.log(k, x) }); }
driver._setDeps({ log: (k, x) => deps.log(k, x) });
const broadcast = (d) => { try { deps.broadcast("shopping", d); } catch { /* no screens */ } };
const log = (kind, data = {}) => deps.log(kind, data);

// where a yes counts: the owner's own screens (never a call, a meeting, Discord or a text)
const OWNER = ["tv", "desk", ""];
const surfaceKey = (s) => (s === "desk" ? "desk" : "tv");

// ---- is it on? ----------------------------------------------------------------------------------------------------------
export const featureEnabled = () => featureOn(FEATURE);
export const enabled = () => featureEnabled() && store.load().enabled === true;
function gate() {
  if (!featureEnabled()) return "Shopping on Amazon isn't part of this version of Dayspring.";
  if (!store.load().enabled) return "Amazon shopping is turned off. You can turn it on in Settings → Shopping.";
  const w = permissions.check("web");
  if (!w.ok) return w.text;
  return null;
}
const fail = (e) => ({ error: String(e?.message ?? e).slice(0, 400), ...(e?.signIn ? { signIn: true } : {}), ...(e?.captcha ? { captcha: true } : {}), ...(e?.timeout ? { timeout: true } : {}), ...(e?.oops ? { oops: true } : {}), ...(e?.refused ? { refused: true } : {}) });
// signed out: remembered, and (unless it was the quiet daily check) the panel opens on its "Sign in to Amazon" card
function noteSignin(e, { show = true } = {}) { if (e?.signIn) { store.patch({ signedIn: false, checkedAt: deps.now() }); broadcast({ do: "signin", signedIn: false }); if (show) openPanel(S.view.open ? S.view.tab : "search"); } }

// ---- state (in memory: results, the open item, orders and subscriptions are never written to disk) --------------------------
let S = { results: null, item: null, compare: [], orders: null, subs: null, account: null, view: { open: false, tab: "search", at: 0 }, banner: null };
const pending = new Map();          // surface → { kind, token, op, at, text, run }
let openOkUntil = 0;                // "Ask before opening Amazon pages": a yes covers the next 15 minutes
export function _reset() { S = { results: null, item: null, compare: [], orders: null, subs: null, account: null, view: { open: false, tab: "search", at: 0 }, banner: null }; pending.clear(); openOkUntil = 0; store._reset(); driver._reset(); stopSubsJob(); }

export function status() {
  const s = store.view();
  return { feature: featureEnabled(), enabled: enabled(), settings: s, signedIn: s.signedIn, account: s.account, paused: driver.pausedState(), web: permissions.check("web").ok };
}
const pub = (r) => r && { query: r.query, filters: r.filters, filterText: describeFilters(r.filters), items: r.items, page: r.page, hasMore: r.hasMore, brands: (r.brands ?? []).map((b) => b.name), total: r.total, empty: r.empty, at: r.at };
export function state() {
  return { status: status(), results: pub(S.results), item: S.item, compare: S.compare, orders: S.orders, subs: S.subs, account: S.account, view: S.view, banner: S.banner, sorts: Object.fromEntries(Object.entries(SORTS).map(([k, v]) => [k, v.label])), saved: store.load().saved };
}
export function setView(v = {}) {
  S.view = { open: Boolean(v.open), tab: ["search", "item", "orders", "subs", "account", "saved", "compare"].includes(v.tab) ? v.tab : "search", at: v.open ? deps.now() : 0 };
  return { ok: true };
}
export const shownAt = () => (S.view.open ? S.view.at : 0);
const FRESH_MS = 20 * 60_000;
const panelFresh = async () => S.view.open && deps.now() - S.view.at < FRESH_MS && S.view.at >= (await deps.othersAt().catch(() => 0));
const openPanel = (tab, extra = {}) => { S.view = { ...S.view, open: true, tab, at: deps.now() }; broadcast({ do: "open", tab, ...extra }); };

// ---- "Ask before opening Amazon pages" --------------------------------------------------------------------------------------
function needsOpenOk() { return store.load().askBeforeOpen && deps.now() > openOkUntil; }
const OPEN_OP = { tool: "shopping_open" };
function askOpen(surface, run, what) {
  const text = `Okay to open Amazon ${what}? (You asked Dayspring to check first. A yes covers the next 15 minutes.)`;
  const token = confirm.issue(OPEN_OP, { text, what: "shopping_open", surfaces: OWNER });
  pending.set(surfaceKey(surface), { kind: "open", token, op: OPEN_OP, at: deps.now(), text, run });
  broadcast({ do: "ask", kind: "open", token, text });
  return { needsConfirm: true, confirm_token: token, text, reply: text, listen: true };
}
export function allowOpen(token, { via = "voice" } = {}) {
  const t = via === "click" ? confirm.issueApproved(OPEN_OP, { what: "shopping_open", via: "click" }) : token;
  const r = confirm.consume(t, OPEN_OP);
  if (!r.ok) return { ok: false, why: r.why };
  openOkUntil = deps.now() + 15 * 60_000;
  log("shopping.allow", { minutes: 15, via });
  return { ok: true };
}

// ---- searching -----------------------------------------------------------------------------------------------------------
const money = (n) => (n == null ? "" : `$${Number(n).toFixed(2).replace(/\.00$/, "")}`);
const short = (s, n = 70) => { const t = String(s ?? ""); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : t; };
const sayItem = (x) => `${short(x.title, 80)}${x.price != null ? `, ${money(x.price)}` : ""}${x.rating ? `, ${x.rating} stars${x.reviews ? ` from ${x.reviews.toLocaleString("en-US")} ratings` : ""}` : ""}${x.prime ? ", Prime" : ""}`;
// the owner's default filters (Settings → Shopping), under whatever was asked this time
function withDefaults(f = {}) {
  const d = store.load().defaults ?? {};
  const out = { prime: d.prime || undefined, maxPrice: d.maxPrice ?? undefined, minRating: d.minRating ?? undefined };
  for (const [k, v] of Object.entries(f ?? {})) if (v !== undefined && v !== null && v !== "") out[k] = v;
  return normalize(out);
}
export async function search({ query, filters = {}, page = 1, more = false, surface = "tv", keepFilters = false } = {}) {
  const g = gate(); if (g) return { error: g };
  let q = String(query ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  let F;
  if (more) {
    if (!S.results) return { error: "There's no Amazon search open. Say what you're looking for." };
    if (!S.results.hasMore) return { ok: true, reply: "That's everything Amazon showed for that search.", results: pub(S.results) };
    q = S.results.query; F = S.results.filters; page = S.results.page + 1;
  } else {
    if (!q) return { error: "What should I look for on Amazon?" };
    F = keepFilters && S.results ? normalize({ ...S.results.filters, ...filters }) : withDefaults(filters);
  }
  if (needsOpenOk()) return askOpen(surface, () => search({ query: q, filters, page, more, surface, keepFilters }), `to search for ${short(q, 60)}`);
  // a brand refinement Amazon itself offered on the last page for this search (its own p_123 id), else p_89 by name
  const brandHref = F.brand && S.results && S.results.query.toLowerCase() === q.toLowerCase() ? (S.results.brands ?? []).find((b) => b.name.toLowerCase() === F.brand.toLowerCase())?.href ?? null : null;
  const u = buildSearchUrl({ query: q, ...F, page, brandHref });
  let pg, r;
  try { pg = await driver.open(u, { wait: RESULTS.card[1] }); r = parseResults(pg.html); }
  catch (e) { noteSignin(e); log("shopping.search", { query: q, filters: describeFilters(F), result: "error", error: String(e.message).slice(0, 160) }); return fail(e); }
  if (pg.signedIn !== null && pg.signedIn !== store.load().signedIn) store.patch({ signedIn: pg.signedIn, account: pg.signedIn ? pg.greeting ?? store.load().account : null, checkedAt: deps.now() });
  const start = more ? S.results.items.length : 0;
  const items = r.items.map((x, i) => ({ ...x, n: start + i + 1 }));
  S.results = more ? { ...S.results, items: [...S.results.items, ...items], page, hasMore: r.hasMore, nextHref: r.nextHref, at: deps.now() }
    : { query: q, filters: F, items, page, hasMore: r.hasMore, nextHref: r.nextHref, brands: r.brands, total: r.total, empty: r.empty, url: u, at: deps.now() };
  S.item = more ? S.item : null;
  log("shopping.search", { query: q, filters: describeFilters(F), page, results: items.length, cached: Boolean(pg.cached) });
  openPanel("search", { results: pub(S.results) });
  const f = describeFilters(F);
  const reply = !S.results.items.length ? `Amazon didn't show anything for ${q}${f ? ` (${f})` : ""}. Try fewer words or looser filters.`
    : more ? `Here are ${items.length} more.${items[0] ? ` Number ${items[0].n}: ${sayItem(items[0])}.` : ""}`
    : `Here's what Amazon has for ${q}${f ? `, ${f}` : ""}. Number 1: ${sayItem(items[0])}.${items[1] ? ` Number 2: ${sayItem(items[1])}.` : ""} Say "open number 2" for the details, or "show more".`;
  return { ok: true, reply, results: pub(S.results) };
}
export const more = (o = {}) => search({ ...o, more: true });

// ---- one item ----------------------------------------------------------------------------------------------------------------
function pickResult(n) {
  const x = S.results?.items?.find((y) => y.n === Number(n));
  if (!x) throw new Error(S.results ? `There ${S.results.items.length === 1 ? "is only 1 result" : `are only ${S.results.items.length} results`} on the screen.` : "There's no Amazon search open.");
  return x;
}
export async function item({ asin, n, variant = false, surface = "tv", fresh = false } = {}) {
  const g = gate(); if (g) return { error: g };
  try { if (!asin && n != null) asin = pickResult(n).asin; } catch (e) { return { error: e.message }; }
  if (!isAsin(asin)) return { error: "Which item? Say a number from the list." };
  if (needsOpenOk()) return askOpen(surface, () => item({ asin, n, variant, surface }), "to show that item");
  let d;
  try { const pg = await driver.open(variant ? PAGES.itemVariant(asin) : PAGES.item(asin), { wait: "#productTitle", fresh }); d = parseItem(pg.html, asin); }
  catch (e) { noteSignin(e); log("shopping.item", { asin, result: "error", error: String(e.message).slice(0, 160) }); return fail(e); }
  if (!d.title) return { error: "Amazon's page for that item didn't load properly. Try again in a moment." };
  S.item = { ...d, n: S.results?.items?.find((x) => x.asin === asin)?.n ?? n ?? null };
  log("shopping.item", { asin, variant });
  openPanel("item", { item: S.item });
  const vs = d.variations.map((v) => `${v.name}: ${v.selected || "choose one"}`).join("; ");
  return { ok: true, item: S.item, reply: `${short(d.title, 90)}. ${d.price != null ? money(d.price) : "No price shown"}${d.savings ? ` (${d.savings})` : ""}${d.rating ? `, ${d.rating} stars` : ""}. ${d.stock ?? ""}${vs ? ` ${vs}.` : ""} It's on the screen.`.replace(/\s+/g, " ").trim() };
}
// choosing a size, colour, style or count: that variant's own page, so its price and stock are its own
const loose = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();
export async function variant({ dimension, value, asin } = {}) {
  const g = gate(); if (g) return { error: g };
  if (!S.item) return { error: "Open an item first." };
  if (isAsin(asin)) {
    const known = S.item.variations.some((v) => v.options.some((o) => o.asin === asin));
    if (!known) return { error: "That isn't one of this item's options." };
    return item({ asin, variant: true });
  }
  const want = loose(value);
  if (!want) return { error: "Which option?" };
  const dims = dimension ? S.item.variations.filter((v) => loose(v.name).includes(loose(dimension)) || loose(v.key).includes(loose(dimension))) : S.item.variations;
  let hit = null;
  for (const v of dims) { hit = v.options.find((o) => loose(o.label) === want) ?? v.options.find((o) => loose(o.label).startsWith(want + " ") || loose(o.label).split(" ").includes(want)) ?? v.options.find((o) => loose(o.label).includes(want)); if (hit) break; }
  if (!hit) return { error: `I don't see "${value}" among the choices${dims.length === 1 ? ` for ${dims[0].name}` : ""}.` };
  if (!hit.available) return { error: `${hit.label} is currently unavailable.` };
  if (!hit.asin) return { error: `Amazon doesn't give ${hit.label} its own page. Choose it on Amazon: say "open it on Amazon".` };
  if (hit.asin === S.item.asin) return { ok: true, item: S.item, reply: `${hit.label} is already chosen.` };
  return item({ asin: hit.asin, variant: true });
}
export async function compare({ numbers = [], asins = [] } = {}) {
  const g = gate(); if (g) return { error: g };
  let list;
  try { list = [...new Set([...asins.filter(isAsin), ...numbers.map((n) => pickResult(n).asin)])].slice(0, 3); } catch (e) { return { error: e.message }; }
  if (list.length < 2) return { error: "Pick two or three to compare, like \"compare number 1 and number 3\"." };
  const out = [];
  for (const a of list) {
    try { const pg = await driver.open(PAGES.item(a), { wait: "#productTitle" }); const d = parseItem(pg.html, a); out.push({ asin: a, title: d.title, brand: d.brand, price: d.price, rating: d.rating, reviews: d.reviews, stock: d.stock, delivery: d.delivery, image: d.images[0] ?? null, prime: S.results?.items?.find((x) => x.asin === a)?.prime ?? null, specs: d.specs.slice(0, 12), n: S.results?.items?.find((x) => x.asin === a)?.n ?? null }); }
    catch (e) { noteSignin(e); return fail(e); }
  }
  S.compare = out;
  log("shopping.compare", { asins: list });
  openPanel("compare", { compare: out });
  const cheapest = [...out].filter((x) => x.price != null).sort((a, b) => a.price - b.price)[0];
  const best = [...out].filter((x) => x.rating != null).sort((a, b) => b.rating - a.rating || (b.reviews ?? 0) - (a.reviews ?? 0))[0];
  return { ok: true, compare: out, reply: `Side by side on the screen.${cheapest ? ` Cheapest: ${short(cheapest.title, 50)} at ${money(cheapest.price)}.` : ""}${best ? ` Best rated: ${short(best.title, 50)}, ${best.rating} stars.` : ""}` };
}

// ---- the cart: only with his yes ---------------------------------------------------------------------------------------------
const cartOp = (asin, mode) => ({ tool: "shopping_cart", asin, mode: mode === "buynow" ? "buynow" : mode === "reorder" ? "reorder" : "cart" });
function described(asin) {
  const it = S.item?.asin === asin ? S.item : null;
  const r = S.results?.items?.find((x) => x.asin === asin) ?? null;
  const o = S.orders?.items?.find((x) => x.asin === asin) ?? null;
  const title = it?.title ?? r?.title ?? o?.title ?? asin;
  const price = it?.price ?? r?.price ?? null;
  const vs = it ? it.variations.map((v) => v.selected).filter(Boolean).join(", ") : "";
  return { title, price, label: `${short(title, 70)}${vs ? ` (${vs})` : ""}${price != null ? ` for ${money(price)}` : ""}` };
}
export function askCart({ asin, n, mode = "cart", surface = "tv", orderItem } = {}) {
  const g = gate(); if (g) return { error: g };
  try {
    if (!asin && orderItem != null) asin = S.orders?.items?.find((x) => x.n === Number(orderItem))?.asin;
    if (!asin && n != null) asin = pickResult(n).asin;
    if (!asin && S.item) asin = S.item.asin;
  } catch (e) { return { error: e.message }; }
  if (!isAsin(asin)) return { error: mode === "reorder" ? "I couldn't find that item in your orders anymore." : "Which item? Open it first, or say its number." };
  const op = cartOp(asin, mode), d = described(asin);
  const text = mode === "buynow" ? `Add ${d.label} to your Amazon cart and open the checkout page for you to review? Dayspring never places the order: you press Place your order yourself.`
    : mode === "reorder" ? `Buy it again: add ${d.label} to your Amazon cart? Then you can go to checkout and place the order yourself.`
    : `Add ${d.label} to your Amazon cart?`;
  const token = confirm.issue(op, { text, what: `shopping_cart ${asin}`, surfaces: OWNER });
  pending.set(surfaceKey(surface), { kind: "cart", token, op, at: deps.now(), text });
  broadcast({ do: "ask", kind: "cart", token, text, asin, mode: op.mode });
  log("shopping.cart", { asin, mode: op.mode, result: "asked" });
  return { needsConfirm: true, confirm_token: token, text, reply: text, listen: true, asin, mode: op.mode,
    howToConfirm: "Read this to the owner exactly and wait. Only after the owner's own clear yes on his screen, call shopping_cart again with the same item, mode and this confirm_token." };
}
// the yes was given: put it in the cart (the click layer presses Add to Cart and nothing else), then for "buy now" open the checkout
export async function cartWithToken({ asin, mode = "cart", token, via = "voice" } = {}) {
  const g = gate(); if (g) return { error: g };
  if (!isAsin(asin)) return { error: "Which item?" };
  const op = cartOp(asin, mode);
  const t = via === "click" ? confirm.issueApproved(op, { what: `shopping_cart ${asin}`, via: "tap" }) : token;
  const c = confirm.consume(t, op);
  if (!c.ok) {
    log("shopping.cart", { asin, mode: op.mode, result: "refused", why: c.why });
    if (c.why === "not-approved") return { needsConfirm: true, waiting: true, confirm_token: t, text: "I still need your own yes, on the Dayspring screen, before anything goes in your cart. Nothing was added." };
    if (c.why === "different") return { refused: true, error: "That yes was for something else, so nothing was added. Ask again for this item." };
    return { refused: true, error: "That yes has expired or was already used. Nothing was added. Ask again." };
  }
  for (const [k, p] of pending) if (p.token === token || (via === "click" && p.kind === "cart" && p.op.asin === op.asin && p.op.mode === op.mode)) { if (p.token !== t) confirm.cancel(p.token, { via: "answered by tap" }); pending.delete(k); }
  const d = described(asin);
  let after;
  try {
    after = await driver.exclusive(async () => {
      await driver.openNow(PAGES.itemVariant(asin), { wait: "#add-to-cart-button", fresh: true, noCache: true });
      const p = await driver.pageForClick();
      await clicker.safeClick(p, "add-to-cart", { ok: true, action: "add-to-cart" }, { log: (k, x) => log(k === "blocked" ? "blocked" : "shopping.click", { ...x, asin }) });
      return driver.settle();
    });
  } catch (e) {
    noteSignin(e);
    log("shopping.cart", { asin, mode: op.mode, result: "error", error: String(e.message).slice(0, 160) });
    return fail(e);
  }
  const r = parseCartAdded(after.html);
  driver.forget(/\/gp\/cart|\/checkout/);
  log("shopping.cart", { asin, mode: op.mode, result: r.added ? "added" : "unconfirmed", via });
  broadcast({ do: "cart", asin, added: r.added, count: r.count });
  if (!r.added) { await driver.hide().catch(() => {}); return { ok: false, error: `Amazon didn't confirm that ${short(d.title, 60)} went in your cart. Say "show my Amazon cart" to check.` }; }
  if (op.mode === "buynow") return checkout({ after: `${short(d.title, 60)} is in your cart.` });
  await driver.hide().catch(() => {});
  return { ok: true, added: true, count: r.count, reply: `Added ${short(d.title, 70)} to your Amazon cart.${r.count ? ` Your cart has ${r.count} ${r.count === 1 ? "item" : "items"}.` : ""} Say "go to checkout" when you're ready; you place the order yourself.` };
}
// the checkout review page, shown to him with the banner; Dayspring stops there
export const BANNER = "Review and press Place order yourself. Dayspring never places orders.";
export async function checkout({ after = "" } = {}) {
  const g = gate(); if (g) return { error: g };
  let pg;
  try { pg = await driver.open(PAGES.checkout, { show: true, keepShown: true, fresh: true, noCache: true }); }
  catch (e) {
    if (e?.signIn) { await driver.show().catch(() => {}); log("shopping.checkout", { result: "signin" }); return { ok: false, signIn: true, error: "Amazon wants you to sign in before checkout. The sign-in is open in Dayspring's browser window: sign in there yourself, then say \"go to checkout\" again." }; }
    log("shopping.checkout", { result: "error", error: String(e.message).slice(0, 160) }); return fail(e);
  }
  const ck = parseCheckout(pg.html, pg.url);
  await driver.show().catch(() => {});
  await driver.banner(BANNER);
  S.banner = { text: BANNER, review: ck.review, total: ck.total, at: deps.now() };
  broadcast({ do: "checkout", banner: S.banner });
  log("shopping.checkout", { result: ck.review ? "review page shown" : "page shown", total: ck.total });
  return { ok: true, checkout: true, review: ck.review, reply: `${after ? after + " " : ""}Amazon's checkout is open in Dayspring's browser window${ck.total != null ? `, order total ${money(ck.total)}` : ""}. Review it and press Place your order yourself. Dayspring never places orders.` };
}

// ---- orders --------------------------------------------------------------------------------------------------------------------
export async function orders({ query = "", surface = "tv" } = {}) {
  const g = gate(); if (g) return { error: g };
  const q = String(query ?? "").trim().slice(0, 100);
  if (needsOpenOk()) return askOpen(surface, () => orders({ query: q, surface }), q ? `to search your orders for ${short(q, 40)}` : "to show your orders");
  let r;
  try { const pg = await driver.open(q ? PAGES.orderSearch(q) : PAGES.orders, { wait: ORDERS.card[0] }); r = parseOrders(pg.html); }
  catch (e) { noteSignin(e); log("shopping.orders", { search: Boolean(q), result: "error", error: String(e.message).slice(0, 160) }); return fail(e); }
  let n = 0;
  const list = r.orders.map((o) => ({ ...o, items: o.items.map((it) => ({ ...it, n: ++n })) }));
  S.orders = { query: q, orders: list, items: list.flatMap((o) => o.items.map((it) => ({ ...it, date: o.date, orderId: o.id }))), at: deps.now() };
  log("shopping.orders", { search: Boolean(q), orders: list.length });
  openPanel("orders", { orders: S.orders });
  if (!list.length) return { ok: true, orders: S.orders, reply: q ? `I don't see ${q} in your Amazon orders.` : "Your Amazon order history is empty." };
  if (q) { const o = list[0]; return { ok: true, orders: S.orders, reply: `You last ordered ${short(o.items[0]?.title ?? q, 70)} on ${o.date ?? "a date Amazon didn't show"}${o.total != null ? ` (order total ${money(o.total)})` : ""}${o.status ? `. ${o.status}` : ""}.` }; }
  const o = list[0];
  return { ok: true, orders: S.orders, reply: `Here are your recent Amazon orders. The latest, on ${o.date ?? "?"}: ${short(o.items[0]?.title ?? "", 60)}${o.items.length > 1 ? ` and ${o.items.length - 1} more` : ""}${o.status ? `, ${o.status}` : ""}.` };
}
// "buy coffee filters again": find it in his orders, then the cart question
export async function reorder({ query, orderItem, surface = "tv" } = {}) {
  const g = gate(); if (g) return { error: g };
  if (orderItem != null) return askCart({ orderItem, mode: "reorder", surface });
  const r = await orders({ query, surface });
  if (r.error || r.needsConfirm) return r;
  const it = S.orders.items.find((x) => x.asin);
  if (!it) return { ok: true, reply: `I don't see ${query} in your Amazon orders, so there's nothing to buy again.` };
  return askCart({ asin: it.asin, mode: "reorder", surface });
}

// ---- Subscribe & Save ---------------------------------------------------------------------------------------------------------
export async function subscriptions({ surface = "tv", fresh = false, quiet = false } = {}) {
  const g = gate(); if (g) return { error: g };
  if (!quiet && needsOpenOk()) return askOpen(surface, () => subscriptions({ surface }), "to show your Subscribe & Save deliveries");
  let r;
  try { const pg = await driver.open(PAGES.upcoming, { wait: "[data-subscription-id]", fresh }); r = parseSubscriptions(pg.html); }
  catch (e) { noteSignin(e, { show: !quiet }); log("shopping.subscriptions", { result: "error", error: String(e.message).slice(0, 160) }); return fail(e); }
  const items = r.items.map((x, i) => ({ ...x, n: i + 1 })).sort((a, b) => String(a.nextISO ?? "9").localeCompare(String(b.nextISO ?? "9"))).map((x, i) => ({ ...x, n: i + 1 }));
  S.subs = { items, at: deps.now(), notify: store.load().notify };
  log("shopping.subscriptions", { count: items.length });
  if (!quiet) openPanel("subs", { subs: S.subs });
  const next = items.find((x) => x.nextISO);
  return { ok: true, subs: S.subs, reply: !items.length ? "You don't have any Subscribe & Save deliveries." : `You have ${items.length} Subscribe & Save ${items.length === 1 ? "subscription" : "subscriptions"}.${next ? ` Next: ${short(next.title, 60)} on ${next.next}.` : ""}` };
}
const skipOp = (it) => ({ tool: "shopping_skip", id: it.id, date: it.nextISO ?? null });
function findSub({ id, n, title } = {}) {
  const L = S.subs?.items ?? [];
  if (id) return L.find((x) => x.id === id) ?? null;
  if (n != null) return L.find((x) => x.n === Number(n)) ?? null;
  if (title) { const w = loose(title); return L.find((x) => loose(x.title).includes(w)) ?? L.find((x) => w.split(" ").filter((k) => k.length > 2).every((k) => loose(x.title).includes(k))) ?? null; }
  return null;
}
export async function askSkip({ id, n, title, surface = "tv" } = {}) {
  const g = gate(); if (g) return { error: g };
  if (!S.subs) { const r = await subscriptions({ surface, quiet: true }); if (r.error) return r; }
  const it = findSub({ id, n, title });
  if (!it) return { error: title ? `I don't see ${title} in your Subscribe & Save deliveries.` : "Which delivery?" };
  if (!it.id) return { error: "Amazon didn't give that delivery an id Dayspring can use. Skip it on Amazon: say \"open my subscriptions on Amazon\"." };
  const text = `Skip the ${it.next ?? "next"} delivery of ${short(it.title, 60)}? Only that one delivery; the subscription stays.`;
  const op = skipOp(it);
  const token = confirm.issue(op, { text, what: `shopping_skip ${it.id}`, surfaces: OWNER });
  pending.set(surfaceKey(surface), { kind: "skip", token, op, at: deps.now(), text, id: it.id });
  broadcast({ do: "ask", kind: "skip", token, text, id: it.id });
  return { needsConfirm: true, confirm_token: token, text, reply: text, listen: true, id: it.id };
}
export async function skipWithToken({ id, token, via = "voice" } = {}) {
  const g = gate(); if (g) return { error: g };
  const it = findSub({ id });
  if (!it) return { error: "That delivery isn't on the list anymore." };
  const op = skipOp(it);
  const t = via === "click" ? confirm.issueApproved(op, { what: `shopping_skip ${it.id}`, via: "tap" }) : token;
  const c = confirm.consume(t, op);
  if (!c.ok) { log("shopping.skip", { id: it.id, result: "refused", why: c.why }); return { refused: true, error: c.why === "not-approved" ? "I still need your own yes on the Dayspring screen. Nothing was skipped." : "That yes has expired or was for something else. Nothing was skipped." }; }
  for (const [k, p] of pending) if (p.token === token || (via === "click" && p.kind === "skip" && p.id === it.id)) { if (p.token !== t) confirm.cancel(p.token, { via: "answered by tap" }); pending.delete(k); }
  const within = `[data-subscription-id="${it.id.replace(/[^\w.-]/g, "")}"]`;
  try {
    await driver.exclusive(async () => {
      await driver.openNow(PAGES.upcoming, { wait: within, fresh: true, noCache: true });
      const p = await driver.pageForClick();
      const lg = (k, x) => log(k === "blocked" ? "blocked" : "shopping.click", { ...x, id: it.id });
      await clicker.safeClick(p, "sns-skip", { ok: true, action: "sns-skip" }, { within, log: lg });
      // Amazon may ask "Skip this delivery?": its own Skip, for the same one delivery
      await clicker.safeClick(p, "sns-skip-confirm", { ok: true, action: "sns-skip-confirm" }, { log: lg }).catch((e) => { if (!e.missing) throw e; });
      await driver.settle();
    });
  } catch (e) { noteSignin(e); log("shopping.skip", { id: it.id, result: "error", error: String(e.message).slice(0, 160) }); return fail(e); }
  driver.forget(/auto-deliveries/);
  await driver.hide().catch(() => {});
  log("shopping.skip", { id: it.id, date: it.nextISO, result: "skipped", via });
  const r = await subscriptions({ quiet: true, fresh: true }).catch(() => null);
  broadcast({ do: "subs", subs: S.subs });
  const still = r?.subs?.items?.find((x) => x.id === it.id);
  return { ok: true, reply: `Skipped the ${it.next ?? "next"} delivery of ${short(it.title, 60)}.${still?.next && still.next !== it.next ? ` The next one is ${still.next}.` : ""}` };
}

// ---- your account (read-only) ---------------------------------------------------------------------------------------------------
export async function account({ surface = "tv" } = {}) {
  const g = gate(); if (g) return { error: g };
  if (needsOpenOk()) return askOpen(surface, () => account({ surface }), "to show your account");
  const out = { prime: null, address: null, comms: [] };
  try {
    out.prime = parsePrime((await driver.open(PAGES.prime)).html);
    out.address = parseAddresses((await driver.open(PAGES.addresses)).html).default;
    out.comms = parseComms((await driver.open(PAGES.comms)).html).prefs;
  } catch (e) { noteSignin(e); log("shopping.account", { result: "error", error: String(e.message).slice(0, 160) }); if (!out.prime) return fail(e); }
  S.account = { ...out, pages: Object.fromEntries(Object.entries(SETTINGS_PAGES).map(([k, v]) => [k, { title: v.title, ownerOnly: Boolean(v.ownerOnly) }])), at: deps.now() };
  log("shopping.account", { read: ["prime", "default address (name and city)", "communication preferences"] });
  openPanel("account", { account: S.account });
  return { ok: true, account: S.account, reply: `${out.prime?.member ? `You're a Prime member${out.prime.renews ? `; it renews ${out.prime.renews}` : ""}.` : "Amazon doesn't show a Prime membership."}${out.address?.name ? ` Default address: ${out.address.name}${out.address.city ? `, ${out.address.city}` : ""}.` : ""} Your account is on the screen.` };
}
// one of Amazon's own settings pages, shown in Dayspring's browser window for HIM to change
export async function openPage(which, { surface = "tv" } = {}) {
  const g = gate(); if (g) return { error: g };
  const pgDef = SETTINGS_PAGES[which];
  if (!pgDef) return { error: "Which Amazon page?" };
  try { await driver.open(pgDef.path, { show: true, keepShown: true, fresh: true, noCache: true }); await driver.show(); }
  catch (e) { if (e?.signIn) { await driver.show().catch(() => {}); } noteSignin(e); return fail(e); }
  log("shopping.open", { page: which });
  return { ok: true, reply: `${pgDef.title} is open in Dayspring's browser window.${pgDef.ownerOnly ? " You make any changes there yourself; Dayspring never changes these." : ""}` };
}
// a package's tracking page (from his orders), shown in the window
export async function openTrack(u) {
  const g = gate(); if (g) return { error: g };
  let path = "";
  try { const x = new URL(String(u)); if (!isAmazonUrl(x.href)) throw 0; path = x.pathname + x.search; } catch { return { error: "That isn't an Amazon tracking page." }; }
  if (!/ship-track|progress-tracker|order-details|your-orders|order-history/.test(path)) return { error: "That isn't an Amazon tracking page." };
  try { await driver.open(path, { show: true, keepShown: true, fresh: true, noCache: true }); await driver.show(); } catch (e) { if (e?.signIn) await driver.show().catch(() => {}); return fail(e); }
  log("shopping.open", { page: "tracking" });
  return { ok: true, reply: "The tracking page is open in Dayspring's browser window." };
}
export async function showWindow() { const g = gate(); if (g) return { error: g }; try { await driver.show(); return { ok: true }; } catch (e) { return fail(e); } }
export async function openItem({ asin, n } = {}) {
  const g = gate(); if (g) return { error: g };
  try { if (!asin && n != null) asin = pickResult(n).asin; } catch (e) { return { error: e.message }; }
  if (!asin && S.item) asin = S.item.asin;
  if (!isAsin(asin)) return { error: "Which item?" };
  try { await driver.open(PAGES.item(asin), { show: true, keepShown: true, fresh: true, noCache: true }); await driver.show(); } catch (e) { return fail(e); }
  log("shopping.open", { page: "item", asin });
  return { ok: true, reply: "It's open on Amazon in Dayspring's browser window." };
}

// ---- saved for later (on this computer only) ---------------------------------------------------------------------------------
export function save({ asin, n } = {}) {
  const g = gate(); if (g) return { error: g };
  let x = null;
  try { x = asin ? (S.item?.asin === asin ? S.item : S.results?.items?.find((y) => y.asin === asin)) : n != null ? pickResult(n) : S.item; } catch (e) { return { error: e.message }; }
  if (!x || !isAsin(x.asin)) return { error: "Open an item first, or say its number." };
  const s = store.load();
  const entry = { asin: x.asin, title: short(x.title, 200), price: x.price ?? null, image: x.image ?? x.images?.[0] ?? null, at: new Date(deps.now()).toISOString() };
  store.patch({ saved: [entry, ...s.saved.filter((y) => y.asin !== x.asin)].slice(0, 100) });
  log("shopping.save", { asin: x.asin });
  broadcast({ do: "saved", saved: store.load().saved });
  return { ok: true, reply: `Saved ${short(x.title, 60)} for later (on this computer; say "show my saved items").` };
}
export function unsave({ asin } = {}) { const s = store.load(); store.patch({ saved: s.saved.filter((y) => y.asin !== asin) }); broadcast({ do: "saved", saved: store.load().saved }); return { ok: true }; }

// ---- signing in (he does it; Dayspring never sees the password) --------------------------------------------------------------------
let signWatch = null;
export async function signIn() {
  const g = gate(); if (g) return { error: g };
  try { await driver.showSignin(); } catch (e) { return fail(e); }
  log("shopping.signin", { shown: true });
  clearInterval(signWatch);
  const until = deps.now() + 15 * 60_000;
  signWatch = setInterval(async () => {
    if (deps.now() > until) { clearInterval(signWatch); signWatch = null; return; }
    try {
      if (!(await driver.cookieSignedIn())) return;
      clearInterval(signWatch); signWatch = null;
      let greeting = null;
      try { const pg = await driver.open(PAGES.home, { fresh: true, noCache: true }); greeting = pg.signedIn ? pg.greeting : null; } catch { /* fine */ }
      store.patch({ signedIn: true, account: greeting, checkedAt: deps.now() });
      await driver.hide().catch(() => {});
      log("shopping.signin", { signedIn: true });
      broadcast({ do: "signin", signedIn: true, account: greeting, text: `✓ Signed in to Amazon${greeting ? ` as ${greeting}` : ""}` });
    } catch { /* the window is busy; next time */ }
  }, Number(process.env.DAYSPRING_SHOPPING_SIGNIN_POLL_MS ?? 2000));
  signWatch.unref?.();
  return { ok: true, reply: "Amazon's sign-in is open in Dayspring's browser window. Sign in there yourself (codes too). Dayspring never sees or keeps your password, and it notices by itself when you're done." };
}
export async function signOut() {
  const g = gate(); if (g && featureEnabled() && !store.load().enabled) { /* signing out always works */ } else if (g) return { error: g };
  try { await driver.clearSignin(); } catch (e) { return fail(e); }
  store.patch({ signedIn: false, account: null, checkedAt: deps.now() });
  S.orders = null; S.subs = null; S.account = null;
  log("shopping.signout", {});
  broadcast({ do: "signin", signedIn: false, signedOut: true });
  return { ok: true, reply: "Signed out of Amazon in Dayspring's browser window. Nothing else changed." };
}
export async function checkSignin() {
  const g = gate(); if (g) return { error: g };
  let on;
  try { on = await driver.cookieSignedIn(); } catch (e) { return fail(e); }
  store.patch({ signedIn: on, checkedAt: deps.now(), ...(on ? {} : { account: null }) });
  return { ok: true, signedIn: on, account: store.load().account, reply: on ? `Yes, Amazon is signed in${store.load().account ? ` as ${store.load().account}` : ""}.` : "No, Amazon isn't signed in. Say \"sign in to Amazon\" when you're ready." };
}
export const resume = () => driver.resume();

// ---- subscription notifications (his switch; nothing polls while it's off) ----------------------------------------------------------
export const SUBS_EVERY_MS = () => Number(process.env.DAYSPRING_SHOPPING_SUBS_EVERY_MS ?? 22 * 3600_000);
const TICK_MS = () => Number(process.env.DAYSPRING_SHOPPING_SUBS_TICK_MS ?? 30 * 60_000);
let subsT = null, offer = null;        // offer: the delivery the last notice offered to skip ({ item, at })
export function startSubsJob() {
  stopSubsJob();
  if (!enabled() || !store.load().notify) return false;
  subsT = setInterval(() => { checkSubscriptions().catch(() => {}); }, TICK_MS());
  subsT.unref?.();
  return true;
}
export function stopSubsJob() { if (subsT) clearInterval(subsT); subsT = null; }
export const subsJobRunning = () => Boolean(subsT);
const localDay = (t) => new Date(t).toLocaleDateString("en-CA");
export async function checkSubscriptions({ force = false } = {}) {
  const s = store.load();
  if (!enabled() || !s.notify) { stopSubsJob(); return { skipped: "off" }; }
  if (s.signedIn === false) return { skipped: "signed out" };
  if (driver.pausedState()) return { skipped: "paused" };
  const now = deps.now(), h = new Date(now).getHours();
  if (!force && (now - (s.lastSubsCheck || 0) < SUBS_EVERY_MS() || h < 9 || h >= 21)) return { skipped: "not yet" };
  store.patch({ lastSubsCheck: now });
  const r = await subscriptions({ quiet: true, fresh: true });
  if (r.error) return { error: r.error };
  const days = s.notifyDays ?? 7, today = localDay(now), until = localDay(now + days * 86_400_000);
  const seen = new Set(s.seenSubs ?? []);
  const fresh = S.subs.items.filter((x) => (x.isNew && !seen.has(`new|${x.id}`)) || (x.nextISO && x.nextISO >= today && x.nextISO <= until && !seen.has(`due|${x.id}|${x.nextISO}`)));
  if (!fresh.length) return { told: 0 };
  const newOnes = fresh.filter((x) => x.isNew && !seen.has(`new|${x.id}`)), due = fresh.filter((x) => x.nextISO && x.nextISO <= until && x.nextISO >= today);
  const parts = [];
  if (newOnes.length) parts.push(`New on Subscribe & Save: ${newOnes.map((x) => short(x.title, 50)).join("; ")}.`);
  if (due.length) parts.push(`Coming in the next ${days} days: ${due.map((x) => `${short(x.title, 50)} on ${x.next}`).join("; ")}.`);
  const first = due[0];
  if (first) parts.push(`Want me to skip the ${first.next} delivery of ${short(first.title, 40)}?`);
  const text = parts.join(" ");
  store.patch({ seenSubs: [...new Set([...seen, ...newOnes.map((x) => `new|${x.id}`), ...due.map((x) => `due|${x.id}|${x.nextISO}`)])].slice(-300) });
  offer = first ? { item: first, at: deps.now() } : null;
  log("shopping.notify", { new: newOnes.length, upcoming: due.length });
  deps.announce?.({ kind: "shopping", title: "Amazon Subscribe & Save", text, ask: Boolean(first) });
  broadcast({ do: "subs", subs: S.subs, notice: text });
  return { told: fresh.length, text };
}
export function start({ announce } = {}) { if (announce) deps.announce = announce; return startSubsJob(); }

// ---- the yes or no to Dayspring's own question ------------------------------------------------------------------------------------
export function hasPending(surface = "tv") {
  const p = pending.get(surfaceKey(surface));
  if (p && deps.now() - p.at < confirm.WINDOW_MS) return true;
  return offerOpen(surface);
}
// the notice's "Want me to skip …?" counts for 5 minutes, on the screen, and only while nothing else is waiting for a yes
export const OFFER_MS = 5 * 60_000;
const offerOpen = (surface) => Boolean(offer && deps.now() - offer.at < OFFER_MS && surfaceKey(surface) === "tv" && confirm.pendingCount() === 0);
// his No on the panel's question card: that question only
export function decline(token) {
  const ok = confirm.cancel(token, { via: "tap" });
  for (const [k, p] of pending) if (p.token === token) pending.delete(k);
  if (ok) { log("shopping.declined", { via: "tap" }); broadcast({ do: "asked", token, answer: "no" }); }
  return { ok };
}
export function clearPending(surface = "tv") { pending.delete(surfaceKey(surface)); if (surfaceKey(surface) === "tv") offer = null; }
async function answer(text, surface) {
  const k = surfaceKey(surface), p = pending.get(k);
  const fresh = p && deps.now() - p.at < confirm.WINDOW_MS;
  const yes = confirm.isYes(text), no = confirm.isNo(text) || /^(no thanks|nope|don'?t|leave it)\b/i.test(String(text).trim());
  if (fresh && (yes || no)) {
    pending.delete(k);
    if (no) { broadcast({ do: "asked", token: p.token, answer: "no" }); log(p.kind === "skip" ? "shopping.skip" : p.kind === "open" ? "shopping.allow" : "shopping.cart", { result: "declined" }); return { reply: p.kind === "skip" ? "Okay, I'll leave that delivery alone." : "Okay, I won't.", intent: "shopping.answer" }; }
    if (!confirm.isApproved(p.token)) return { reply: "I need your yes on the Dayspring screen itself for that. Nothing was changed.", intent: "shopping.answer" };
    broadcast({ do: "asked", token: p.token, answer: "yes" });
    if (p.kind === "open") { const a = allowOpen(p.token); if (!a.ok) return { reply: "That yes expired. Ask again.", intent: "shopping.answer" }; const r = await p.run(); return { reply: r.reply ?? r.error ?? "Okay.", intent: "shopping.answer", ...(r.listen ? { listen: true } : {}) }; }
    if (p.kind === "cart") { const r = await cartWithToken({ asin: p.op.asin, mode: p.op.mode, token: p.token, via: "voice" }); return { reply: r.reply ?? r.error ?? r.text ?? "Okay.", intent: "shopping.cart" }; }
    if (p.kind === "skip") { const r = await skipWithToken({ id: p.id, token: p.token, via: "voice" }); return { reply: r.reply ?? r.error ?? "Okay.", intent: "shopping.skip" }; }
  }
  // the subscription notice's own question ("Want me to skip …?"): his yes to exactly that question, for that one delivery
  if (!fresh && offerOpen(surface) && (yes || no)) {
    const it = offer.item; offer = null;
    if (no) return { reply: "Okay, it'll come as planned.", intent: "shopping.answer" };
    const tok = confirm.issueApproved(skipOp(it), { what: `shopping_skip ${it.id}`, via: "voice (to the notice's question)" });
    const r = await skipWithToken({ id: it.id, token: tok, via: "voice" });
    return { reply: r.reply ?? r.error ?? "Okay.", intent: "shopping.skip" };
  }
  return null;
}

// ---- the words (no AI needed) ---------------------------------------------------------------------------------------------------------
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, last: -1 };
const N = "(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last)";
const numOf = (w) => { const v = /^\d+$/.test(w) ? Number(w) : NUM[w] ?? null; return v === -1 ? S.results?.items?.length ?? null : v; };
const tidy = (t) => String(t ?? "").toLowerCase().replace(/[’']/g, "'").replace(/[!?,.]+(\s|$)/g, " ").replace(/\s+/g, " ").trim().replace(/^(?:hey |ok |okay )?(?:dayspring )?(?:please |can you |could you |would you |will you )*/, "").replace(/ please$/, "").trim();
// Amazon words that are NOT shopping (music, video, the river…): left to the rest of Dayspring
const NOT_SHOPPING = /\b(amazon music|prime video|amazon video|amazon prime video|amazon river|amazon rainforest|amazon jungle|amazon basin|amazon (?:the )?company|amazon stock|amazon shares|amazon warriors?|amazon parrot|amazon women|amazon web services|aws|alexa|echo dot|kindle (?:book|store|unlimited)|audible|twitch|documentar(?:y|ies)|movie|movies|tv show|episode|series|podcast)\b|^(?:play|watch|listen to|stream|read|tell me about|what is|what's|who is|how (?:big|long|old|deep)|go to|open|launch|start)\b/;
const AMZ = /\bamazon(?:\.com)?\b/;
const SHOP_ASK = /\b(?:on|at|from|in) (?:the )?amazon(?:\.com)?\b|^(?:search|check|look on|shop on|browse) amazon\b|^amazon (?:search|find|look up)\b|^(?:does|do|can|will) amazon (?:have|sell|carry|stock)\b/;

const say = (r, intent, extra = {}) => (r ? { reply: r.reply ?? r.error ?? r.text ?? "Okay.", intent, ...(r.listen ? { listen: true } : {}), ...extra } : null);
// → { reply, intent, listen? } | null (null: not shopping words; the rest of Dayspring answers)
// ai: an AI brain is up. A long or loose description ("something to keep my coffee warm at my desk that plugs into USB")
// is then left to it: it turns the description into a search and filters (the shopping_search tool). Short, plain
// requests are answered here either way, at once.
export async function handle(text, { surface = "tv", ai = false } = {}) {
  if (!featureEnabled() || surface === "call" || surface === "discord") return null;
  const raw = String(text ?? "").trim();
  const t = tidy(raw);
  if (!t || t.length > 300) return null;
  // the answer to its own question first ("yes" / "no")
  if (hasPending(surface)) { const a = await answer(raw, surface); if (a) return a; }
  const isOn = store.load().enabled;
  const off = () => ({ reply: "Amazon shopping is turned off. You can turn it on in Settings → Shopping.", intent: "shopping.off" });
  let m;
  // signing in and out
  if (/^(?:sign|log) ?(?:me )?(?:back )?(?:in|into|on)(?: to)? (?:my )?amazon(?: account)?(?: again)?$/.test(t)) return isOn ? say(await signIn(), "shopping.signin") : off();
  if (/^(?:sign|log) (?:me )?out (?:of|from) (?:my )?amazon(?: account)?(?: in dayspring)?$/.test(t)) return isOn ? say(await signOut(), "shopping.signout") : off();
  if (/^am i (?:still )?(?:signed|logged) in(?: to)? amazon$/.test(t)) return isOn ? say(await checkSignin(), "shopping.signin") : off();
  if (/^(?:continue|resume|keep) shopping$|^i (?:solved|did|finished) (?:it|the (?:check|captcha|puzzle))$/.test(t) && driver.pausedState()) { const r = await resume(); return { reply: r.resumed ? "Thanks. Back to shopping." : r.text, intent: "shopping.resume" }; }
  // the panel itself
  if (/^(?:open|show|pull up|bring up)(?: me)? (?:the |my )?(?:shopping|amazon shopping|shopping panel|shopping window|amazon panel)$/.test(t)) { if (!isOn) return off(); openPanel(S.view.tab ?? "search"); return { reply: "Here's Shopping.", intent: "shopping.open" }; }
  if (/^(?:close|hide|exit)(?: the| my)? (?:shopping|amazon|amazon shopping)(?: panel| window)?$/.test(t)) { if (!S.view.open) return null; S.view.open = false; broadcast({ do: "close" }); return { reply: "Okay.", intent: "shopping.close" }; }
  // orders
  if ((m = /^(?:when|what day) did i (?:last |most recently )?(?:buy|order|get|purchase) (.+?)(?: (?:on|from|off) amazon)?$/.exec(t)) || (m = /^did i (?:already |ever )?(?:buy|order) (.+?) (?:on|from) amazon$/.exec(t)) || (m = /^(?:search|find|look (?:for|up)|look) (.+?) in my (?:amazon )?orders$/.exec(t)) || (m = /^(?:search|look through|check) my amazon orders for (.+)$/.exec(t))) {
    if (!isOn) return off();
    const r = await orders({ query: m[1].replace(/^(?:the|some|my)\s+/, ""), surface });
    return say(r, "shopping.orders");
  }
  if (/^(?:show|open|pull up|list|what are|read)(?: me)? (?:my )?(?:recent |latest |past )?amazon (?:orders?|order history|purchases)$|^(?:show|open)(?: me)? my (?:order history|orders) (?:on|from) amazon$|^my amazon orders$|^(?:where(?:'s| is) my|track my) amazon (?:package|order|delivery|shipment)s?$|^(?:where(?:'s| is) my|track my) (?:package|order|delivery) from amazon$/.test(t)) {
    return isOn ? say(await orders({ surface }), "shopping.orders") : off();
  }
  if ((m = /^(?:re-?order|buy (.+?) again(?: (?:on|from) amazon)?$|order (.+?) again(?: (?:on|from) amazon)?$)(?: (.+))?$/.exec(t))) {
    const what = (m[1] ?? m[2] ?? m[3] ?? "").replace(/^(?:the|some|my|more)\s+/, "").trim();
    if (what && /^(?:it|that|this)$/.test(what) && S.item) { if (!isOn) return off(); return say(askCart({ asin: S.item.asin, mode: "reorder", surface }), "shopping.reorder"); }
    if ((m = new RegExp(`^(?:number )?${N}$`).exec(what)) && S.orders) { if (!isOn) return off(); return say(askCart({ orderItem: numOf(m[1]), mode: "reorder", surface }), "shopping.reorder"); }
    if (what && (AMZ.test(t) || /^re-?order/.test(t))) { if (!isOn) return off(); return say(await reorder({ query: what.replace(/ (?:on|from) amazon$/, ""), surface }), "shopping.reorder"); }
  }
  // Subscribe & Save
  if ((m = /^(?:turn|switch) (on|off) (?:my |the )?(?:amazon |subscribe (?:and|&|n) save )(?:subscription )?(?:notifications|alerts|notices|reminders)$|^(?:stop|start) (?:telling|notifying) me about (?:my )?(?:amazon |subscribe and save )?(?:subscriptions|deliveries)$/.exec(t))) {
    if (!isOn) return off();
    const want = m[1] ? m[1] === "on" : /^start/.test(t);
    store.set({ notify: want }); startSubsJob();
    log("shopping.settings", { notify: want, via: "voice" });
    return { reply: want ? `Okay. Once a day I'll check your Subscribe & Save deliveries and tell you about new ones and anything coming in the next ${store.load().notifyDays} days.` : "Okay, no more Subscribe & Save notices. Nothing checks Amazon for them now.", intent: "shopping.notify" };
  }
  if ((m = /^skip (?:the |my )?(?:next |upcoming )?(.+?) (?:delivery|shipment|order)(?: from (?:subscribe and save|amazon))?$/.exec(t))) { if (!isOn) return off(); return say(await askSkip({ title: m[1], surface }), "shopping.skip"); }
  if (/\bsubscribe (?:and|&|n) save\b|\bamazon subscriptions?\b|^(?:show|what are|list) my (?:amazon )?(?:upcoming )?(?:subscription )?deliveries$/.test(t) && !/\b(?:turn|switch|notif)/.test(t)) return isOn ? say(await subscriptions({ surface }), "shopping.subs") : off();
  // the account
  if ((m = /^open (?:my )?amazon (addresses|address book|payments?|payment methods?|wallet|login (?:and|&) security|security settings|prime(?: settings| membership)?|email (?:preferences|settings)|communication preferences|cart|orders|subscriptions|account)(?: page)?$/.exec(t)) || (m = /^(?:show|open)(?: me)? my amazon (cart)$/.exec(t))) {
    if (!isOn) return off();
    const w = m[1];
    const which = /address/.test(w) ? "addresses" : /pay|wallet/.test(w) ? "payments" : /security/.test(w) ? "security" : /prime/.test(w) ? "prime" : /email|communication/.test(w) ? "comms" : /cart/.test(w) ? "cart" : /orders/.test(w) ? "orders" : /subscriptions/.test(w) ? "subscriptions" : "account";
    return say(await openPage(which, { surface }), "shopping.open");
  }
  if (/^(?:show|open|pull up)(?: me)? my amazon (?:account|settings|preferences|account settings)$|^(?:am i|are we) (?:a )?prime members?$|^(?:what(?:'s| is) )?my (?:amazon )?prime (?:membership|status)$/.test(t)) return isOn ? say(await account({ surface }), "shopping.account") : off();
  if (/^(?:go to|open|show me|take me to) (?:the |my )?(?:amazon )?checkout$|^check ?out (?:on amazon|now)$/.test(t) && (AMZ.test(t) || S.view.open)) return isOn ? say(await checkout(), "shopping.checkout") : off();
  if (/^(?:show|open)(?: me)? my saved (?:items|things|for later)(?: on amazon)?$/.test(t) && isOn) { openPanel("saved"); return { reply: `You have ${store.load().saved.length} saved.`, intent: "shopping.saved" }; }
  // what's on the screen: numbers, more, filters, the item's choices, the cart
  if (isOn && (await panelFresh())) { const r = await onScreen(t, raw, surface); if (r) return r; }
  // searching (the word Amazon has to be there: "find work boots on amazon", "is there a … on amazon")
  if (SHOP_ASK.test(t) || (/^(?:is|are) .+ (?:for sale|available) (?:on|at) amazon$/.test(t))) {
    if (/\b(?:shopping|grocery) list\b/.test(t) || NOT_SHOPPING.test(t)) return null;
    if (!isOn) return off();
    const pr = parseRequest(raw);
    if (ai && pr && (pr.query.split(/\s+/).length > 6 || /\b(something|anything|thing|stuff|kind of|sort of|that (?:can|will|would|is|has|keeps?)|which|so (?:i|that)|to keep|for my|for when)\b/i.test(pr.query))) return null;
    if (!pr) return { reply: "What should I look for on Amazon?", intent: "shopping.search", listen: true };
    return say(await search({ query: pr.query, filters: pr.filters, surface }), "shopping.search");
  }
  return null;
}
async function onScreen(t, raw, surface) {
  let m;
  const tab = S.view.tab;
  try {
    if (/^(?:more|show more|show me more|load more|more results|next page|keep going|see more)$/.test(t) && S.results) return say(await more({ surface }), "shopping.more");
    if ((m = new RegExp(`^(?:open|show me|show|pick|choose|select|go to|tell me about|what about|details (?:on|for))(?: the)?(?: number| #)? ${N}(?: one| result| item)?$|^(?:number|#) ${N}$|^the ${N} one$`).exec(t)) && S.results && tab !== "orders" && tab !== "subs") { const n = numOf(m[1] ?? m[2] ?? m[3]); return n ? say(await item({ n, surface }), "shopping.item") : null; }
    if ((m = new RegExp(`^open (?:it|that|this|number ${N}|the ${N} one) (?:on|in) amazon$`).exec(t))) { const n = m[1] ?? m[2]; return say(await openItem(n ? { n: numOf(n) } : {}), "shopping.open"); }
    if ((m = new RegExp(`^compare (?:number )?${N} (?:and|with|to) (?:number )?${N}(?: and (?:number )?${N})?$`).exec(t))) return say(await compare({ numbers: [m[1], m[2], m[3]].filter(Boolean).map(numOf) }), "shopping.compare");
    if ((m = new RegExp(`^(?:add|put) (?:it|that|this|that one|this one|the (?:${N}) one|number ${N}) (?:to|in|into) (?:my |the )?(?:amazon )?(?:cart|basket)$`).exec(t))) { const n = m[1] ?? m[2]; return say(askCart(n ? { n: numOf(n), surface } : { surface }), "shopping.cart"); }
    if ((m = new RegExp(`^buy (?:it|that|this|that one|this one|the (?:${N}) one|number ${N})(?: now)?$`).exec(t))) { const n = m[1] ?? m[2]; return say(askCart(n ? { n: numOf(n), mode: "buynow", surface } : { mode: "buynow", surface }), "shopping.buynow"); }
    if ((m = new RegExp(`^save (?:it|that|this|number ${N}) (?:for later)?$`).exec(t.replace(/ for later$/, " for later")))) return say(save(m[1] ? { n: numOf(m[1]) } : {}), "shopping.save");
    if ((m = new RegExp(`^buy (?:number )?${N} again$`).exec(t)) && S.orders) return say(askCart({ orderItem: numOf(m[1]), mode: "reorder", surface }), "shopping.reorder");
    if ((m = new RegExp(`^skip (?:number )?${N}$`).exec(t)) && tab === "subs") return say(await askSkip({ n: numOf(m[1]), surface }), "shopping.skip");
    if (/^(?:go )?back(?: to the (?:results|list))?$/.test(t) && tab === "item") { broadcast({ do: "back" }); S.view.tab = "search"; return { reply: "", intent: "shopping.back" }; }
    // the item's choices: "size 11", "choose the gray one", "color navy", "make it the 2 pack"
    if (tab === "item" && S.item?.variations?.length) {
      if ((m = /^(?:(?:choose|pick|select|get|use|switch to|change (?:it )?to|make it|i want|go with)(?: the)? )?(size|color|colour|style|count|pack|pattern|flavor|flavour|capacity|length|width|model|material|scent)(?: to| of)? (.+?)(?: one)?$/.exec(t))) return say(await variant({ dimension: m[1].replace("colour", "color"), value: m[2] }), "shopping.variant");
      if ((m = /^(?:choose|pick|select|get|switch to|make it|i want|go with) (?:the )?(.+?)(?: one| version| option)?$/.exec(t)) || (m = /^the (.+?) one$/.exec(t))) { const r = await variant({ value: m[1] }); if (!r.error || /among the choices/.test(r.error) === false) return say(r, "shopping.variant"); }
    }
    // filters on the results: "under $50", "only prime", "brand carhartt", "sort by price", "4 stars and up", "clear the filters"
    if (S.results && tab === "search") {
      if (/^(?:clear|remove|reset|no) (?:the |all )?filters$/.test(t)) return say(await search({ query: S.results.query, filters: { prime: false, maxPrice: null, minPrice: null, brand: null, minRating: null, sort: "relevance" }, surface }), "shopping.filter");
      if (/^(?:only|just|show|filter|under|below|less than|cheaper than|over|above|between|sort|sorted|cheapest|most expensive|best rated|top rated|newest|brand|by|from|made by|with|4|3|four|three|prime|highly rated|price)\b/.test(t)) {
        const pr = parseRequest(`zzitem ${raw.replace(/^(?:only|just|show(?: me)?(?: only)?|filter(?: (?:by|to))?)\s+/i, "").replace(/^(?:ones?|the ones?)\s+/i, "")}`);
        const f = pr?.filters ?? {};
        const changed = {};
        if (f.maxPrice != null) changed.maxPrice = f.maxPrice;
        if (f.minPrice != null) changed.minPrice = f.minPrice;
        if (f.brand) changed.brand = f.brand;
        if (f.prime) changed.prime = true;
        if (f.minRating) changed.minRating = f.minRating;
        if (f.sort && f.sort !== "relevance") changed.sort = f.sort;
        if ((m = /^(?:brand|by|from|made by) ([a-z0-9][\w&'.+-]*(?: [a-z0-9][\w&'.+-]*)?)$/.exec(t))) changed.brand = raw.replace(/^.*?\b(?:brand|by|from|made by)\s+/i, "").trim();
        if (Object.keys(changed).length) return say(await search({ query: S.results.query, filters: changed, keepFilters: true, surface }), "shopping.filter");
      }
    }
  } catch (e) { return { reply: e.message, intent: "shopping" }; }
  return null;
}
// the no-AI intent catalogue's runner (lib/intents/index.mjs) hands the words here
export async function fromIntent(id, text, { surface = "tv" } = {}) {
  const r = await handle(text, { surface });
  if (r) return r;
  if (!featureEnabled()) return { reply: "Shopping on Amazon isn't part of this version of Dayspring." };
  if (!store.load().enabled) return { reply: "Amazon shopping is turned off. You can turn it on in Settings → Shopping." };
  if (id === "shopping.search") {
    // only when Amazon was really mentioned (a misheard "amzaon" counts); otherwise it's a question, never a search
    const fixed = withAmazon(text);
    if (!fixed) return { reply: "To look something up on Amazon, say “find … on Amazon”.", listen: true };
    const again = await handle(fixed, { surface }); if (again) return again;
    const pr = parseRequest(fixed); if (pr) return say(await search({ query: pr.query, filters: pr.filters, surface }), "shopping.search");
    return { reply: "What should I look for on Amazon?", listen: true };
  }
  if (id === "shopping.orders") return say(await orders({ surface }), "shopping.orders");
  if (id === "shopping.subs") return say(await subscriptions({ surface }), "shopping.subs");
  if (id === "shopping.account") return say(await account({ surface }), "shopping.account");
  if (id === "shopping.open") { openPanel("search"); return { reply: "Here's Shopping." }; }
  return { reply: "Say something like \"find work boots under $100 on Amazon\", \"show my Amazon orders\" or \"show my Subscribe & Save\"." };
}

// ---- the AI's tools (Claude, Ollama, any model) --------------------------------------------------------------------------------------
export const TOOLS = [
  { name: "shopping_search", description: "Search amazon.com for something the owner described, with Amazon's own filters, and show the results in the Shopping panel on his screen (numbered). Turn his description into a short Amazon search query (the product words, plus size or model if he said one) and the filters. Use more=true for the next page of the same search. Returns the top results (number, title, price, rating, Prime). Only when he asked about Amazon or shopping.",
    input_schema: { type: "object", properties: {
      query: { type: "string", description: "What to search Amazon for, e.g. \"waterproof work boot size 11\"" },
      min_price: { type: "number" }, max_price: { type: "number", description: "dollars" }, brand: { type: "string" },
      prime_only: { type: "boolean" }, min_rating: { type: "number", enum: [1, 2, 3, 4], description: "stars and up" },
      sort: { type: "string", enum: Object.keys(SORTS) }, more: { type: "boolean", description: "the next page of the last search" },
    }, required: [] } },
  { name: "shopping_item", description: "Open one Amazon item in the Shopping panel and read its details: price, deal, stock, delivery, seller, the customisation choices (size, colour, style, count), About this item, specs, the rating breakdown and top reviews. Give number (from the results on the screen) or asin. To choose a customisation, give dimension and value (e.g. size, 11): that option's own price and stock are read. compare: two or three numbers to compare side by side.",
    input_schema: { type: "object", properties: { number: { type: "number" }, asin: { type: "string" }, dimension: { type: "string" }, value: { type: "string" }, compare: { type: "array", items: { type: "number" } }, open_on_amazon: { type: "boolean", description: "show the item on amazon.com in Dayspring's browser window" } } } },
  { name: "shopping_cart", description: "Put an Amazon item in the owner's cart, ONLY with his own yes. The first call returns a question (needsConfirm, confirm_token): read it to him exactly and wait. Call again with the same item, mode and confirm_token only after he says yes. mode: cart (just add), buy_now (add, then open Amazon's checkout review page for HIM to place the order; Dayspring never places orders), reorder (an item from his orders: order_item number). checkout=true just opens the checkout page for his cart. Dayspring can never press Place your order, Buy Now, Subscribe or Pay.",
    input_schema: { type: "object", properties: { number: { type: "number" }, asin: { type: "string" }, order_item: { type: "number" }, mode: { type: "string", enum: ["cart", "buy_now", "reorder"] }, confirm_token: { type: "string" }, checkout: { type: "boolean" } } } },
  { name: "shopping_orders", description: "The owner's Amazon order history (date, items, total, status, tracking), shown in the Shopping panel. query: search his orders (\"coffee filters\") to answer \"when did I last buy …\". To buy something again use shopping_cart with mode reorder.",
    input_schema: { type: "object", properties: { query: { type: "string" } } } },
  { name: "shopping_subscriptions", description: "The owner's Amazon Subscribe & Save subscriptions and upcoming deliveries. action list (default), or skip ONE delivery: the first skip call returns a question (needsConfirm, confirm_token); read it and call again with the token only after his yes. notifications: true/false turns his once-a-day subscription notices on or off.",
    input_schema: { type: "object", properties: { action: { type: "string", enum: ["list", "skip"] }, number: { type: "number" }, title: { type: "string" }, confirm_token: { type: "string" }, notifications: { type: "boolean" } } } },
  { name: "shopping_account", description: "The owner's Amazon account, read-only: Prime status, default address (name and city; the street is never read), communication preferences. open_page shows one of Amazon's own settings pages in Dayspring's browser window for HIM to change (Dayspring never changes payment, addresses, password, security or Prime). Also sign_in (shows Amazon's sign-in for him), sign_out, signed_in (check).",
    input_schema: { type: "object", properties: { action: { type: "string", enum: ["show", "open_page", "sign_in", "sign_out", "signed_in"] }, page: { type: "string", enum: Object.keys(SETTINGS_PAGES) } } } },
];
export const tools = () => (featureEnabled() ? TOOLS : []);
const brief = (r) => (r?.results ? { ...r, results: { ...r.results, items: r.results.items.slice(0, 10).map((x) => ({ number: x.n, title: x.title, brand: x.brand, price: x.price, rating: x.rating, reviews: x.reviews, prime: x.prime, sponsored: x.sponsored, delivery: x.delivery })) } } : r);
export async function runTool(name, i = {}) {
  if (!TOOLS.some((t) => t.name === name)) return undefined;
  const g = gate(); if (g) return { error: g };
  try {
    if (name === "shopping_search") {
      if (i.more) return brief(await more({}));
      return brief(await search({ query: i.query, filters: { minPrice: i.min_price, maxPrice: i.max_price, brand: i.brand, prime: i.prime_only, minRating: i.min_rating, sort: i.sort } }));
    }
    if (name === "shopping_item") {
      if (Array.isArray(i.compare) && i.compare.length) return compare({ numbers: i.compare });
      if (i.open_on_amazon) return openItem({ asin: i.asin, n: i.number });
      if (i.dimension || i.value) { if (!S.item || (i.asin && i.asin !== S.item.asin) || (i.number && S.item.n !== i.number)) { const r = await item({ asin: i.asin, n: i.number }); if (r.error) return r; } return variant({ dimension: i.dimension, value: i.value }); }
      const r = await item({ asin: i.asin, n: i.number });
      return r.item ? { ...r, item: { ...r.item, images: r.item.images.length, topReviews: r.item.topReviews.slice(0, 3) } } : r;
    }
    if (name === "shopping_cart") {
      if (i.checkout) return checkout();
      const mode = i.mode === "buy_now" ? "buynow" : i.mode === "reorder" ? "reorder" : "cart";
      let asin = isAsin(i.asin) ? i.asin : null;
      try { if (!asin && mode === "reorder" && i.order_item != null) asin = S.orders?.items?.find((x) => x.n === Number(i.order_item))?.asin ?? null; if (!asin && i.number != null) asin = pickResult(i.number).asin; } catch (e) { return { error: e.message }; }
      if (!asin && S.item) asin = S.item.asin;
      if (i.confirm_token) return cartWithToken({ asin, mode, token: i.confirm_token, via: "tool" });
      return askCart({ asin, mode });
    }
    if (name === "shopping_orders") return orders({ query: i.query ?? "" });
    if (name === "shopping_subscriptions") {
      if (typeof i.notifications === "boolean") { store.set({ notify: i.notifications }); startSubsJob(); log("shopping.settings", { notify: i.notifications, via: "assistant" }); return { ok: true, notify: i.notifications }; }
      if (i.action === "skip") {
        if (i.confirm_token) { const it = findSub({ n: i.number, title: i.title }); if (!it) return { error: "Which delivery?" }; return skipWithToken({ id: it.id, token: i.confirm_token, via: "tool" }); }
        return askSkip({ n: i.number, title: i.title });
      }
      return subscriptions({});
    }
    if (name === "shopping_account") {
      if (i.action === "open_page") return openPage(i.page ?? "account");
      if (i.action === "sign_in") return signIn();
      if (i.action === "sign_out") return signOut();
      if (i.action === "signed_in") return checkSignin();
      return account({});
    }
  } catch (e) { return fail(e); }
  return undefined;
}
