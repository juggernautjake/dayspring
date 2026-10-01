// Reading Amazon's pages (their HTML, in Node; nothing on the page is ever run by these). Pure functions: the tests run
// them on hand-written stand-in pages in scripts/qa/fixtures/amazon/ (never on the owner's real pages).
//   pageKind(html, url)      → { kind: "ok" | "captcha" | "signin" | "oops", signedIn: true | false | null, greeting }
//   parseResults(html)       → { items: [{ asin, title, brand, url, image, price, priceText, listPrice, rating, reviews,
//                                prime, delivery, sponsored, badge }], hasMore, nextHref, brands: [{ name, href }], total, empty }
//   parseItem(html, asin)    → { asin, title, brand, price, …, images, bullets, specs, histogram, reviews, variations, … }
//   parseCartAdded(html)     → { added, count, subtotal }
//   parseCheckout(html, url) → { review: true|false, total }
//   parseOrders(html)        → { orders: [{ id, date, total, status, track, items: [{ title, asin, url, image, buyAgain }] }], empty }
//   parseSubscriptions(html) → { items: [{ id, title, asin, image, next, nextISO, frequency, qty, price, isNew, canSkip }] }
//   parsePrime(html) · parseAddresses(html) (the default's NAME and city only; the street is never read) · parseComms(html)
import { load, $, $$, first, all, text, attr, scripts } from "./dom.mjs";
import { RESULTS, ITEM, CART, CHECKOUT, ORDERS, SUBS, ACCOUNT, DETECT } from "./selectors.mjs";
import { absolute, isAsin } from "./site.mjs";

// ---- small readers ------------------------------------------------------------------------------------------------------
export function priceOf(s) {
  const m = /\$\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/.exec(String(s ?? ""));
  if (!m) return null;
  return Number(m[1].replace(/,/g, "")) + (m[2] ? Number(m[2].padEnd(2, "0")) / 100 : 0);
}
export function ratingOf(s) { const m = /(\d(?:\.\d)?)\s*out of\s*5/i.exec(String(s ?? "")) ?? /^\s*(\d(?:\.\d)?)\s*$/.exec(String(s ?? "")); return m ? Number(m[1]) : null; }
export function countOf(s) {
  const t = String(s ?? "").replace(/[()]/g, "");
  let m = /(\d+(?:\.\d+)?)\s*([KkMm])\b/.exec(t);
  if (m) return Math.round(Number(m[1]) * (/k/i.test(m[2]) ? 1000 : 1_000_000));
  m = /(\d{1,3}(?:,\d{3})+|\d+)/.exec(t);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}
export function asinFrom(href) {
  const m = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?#]|$)/.exec(String(href ?? ""));
  return m ? m[1] : null;
}
const clip = (s, n = 300) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; };
const firstText = (root, sels) => text(first(root, sels));
const money = (n) => (n == null ? "" : `$${n.toFixed(2)}`);
// a big picture from a thumbnail's address (Amazon sizes images in the file name: …_AC_US40_.jpg → …_AC_SL1200_.jpg)
export const bigImage = (src) => String(src ?? "").replace(/\._[A-Z0-9,_]+_\.(jpg|jpeg|png|webp)$/i, "._AC_SL1200_.$1");
// a picture's address: Amazon's own (https), or a path on the store's own site made whole; nothing else (no data:, no javascript:)
const safeImg = (src) => { const s = String(src ?? ""); if (/^https:\/\/[\w.-]+\//.test(s)) return s; if (/^\/[\w./%-]+\.(jpg|jpeg|png|webp|gif)$/i.test(s)) return absolute(s); return null; };

// ---- what kind of page ------------------------------------------------------------------------------------------------------
export function pageKind(html, url = "") {
  const doc = load(html);
  const body = text($(doc, "body") ?? doc).slice(0, 20000);
  const greeting = firstText(doc, ACCOUNT.greeting);
  const signedIn = greeting ? !DETECT.signedOutNav.test(greeting) : null;
  if (DETECT.captchaUrl.test(url) || first(doc, DETECT.captcha) || DETECT.captchaText.test(body)) return { kind: "captcha", signedIn, greeting };
  if (DETECT.signinUrl.test(url) || first(doc, DETECT.signin)) return { kind: "signin", signedIn: false, greeting };
  if (first(doc, DETECT.oops) || (DETECT.oopsText.test(body) && body.length < 4000)) return { kind: "oops", signedIn, greeting };
  return { kind: "ok", signedIn, greeting: greeting && signedIn ? greeting.replace(/^hello,?\s*/i, "").trim() : greeting };
}

// ---- search results ---------------------------------------------------------------------------------------------------------
export function parseResults(html) {
  const doc = load(html);
  const cards = all(doc, RESULTS.card).filter((c) => isAsin(attr(c, "data-asin")));
  const items = [];
  const seen = new Set();
  for (const c of cards) {
    const asin = attr(c, "data-asin");
    if (seen.has(asin)) continue;
    const title = clip(firstText(c, RESULTS.title) || attr(first(c, RESULTS.titleAria), "aria-label") || attr(first(c, RESULTS.image), "alt"), 300);
    if (!title) continue;
    seen.add(asin);
    const link = first(c, RESULTS.link);
    const priceText = firstText(c, RESULTS.price);
    const ratingEl = first(c, RESULTS.rating);
    const reviewsEl = first(c, RESULTS.reviews);
    const img = first(c, RESULTS.image);
    const sponsored = Boolean(first(c, RESULTS.sponsored)) || /\bSponsored\b/.test(text(c).slice(0, 200));
    items.push({
      asin, title,
      brand: clip(firstText(c, RESULTS.brand), 80) || null,
      url: absolute(attr(link, "href")) ?? null,
      image: safeImg(attr(img, "src")),
      price: priceOf(priceText), priceText: priceText || null,
      listPrice: priceOf(firstText(c, RESULTS.listPrice)),
      rating: ratingOf(text(ratingEl) || attr(ratingEl, "aria-label")),
      reviews: countOf(attr(reviewsEl, "aria-label") || text(reviewsEl)),
      prime: Boolean(first(c, RESULTS.prime)),
      delivery: clip(firstText(c, RESULTS.delivery), 160) || null,
      sponsored,
      badge: clip(firstText(c, RESULTS.badge), 60) || null,
    });
  }
  const next = first(doc, RESULTS.next);
  const brands = all(doc, RESULTS.brandFilter).map((a) => ({ name: clip(text(first(a, RESULTS.brandName)) || text(a), 60), href: absolute(attr(a, "href")) })).filter((b) => b.name && b.href).slice(0, 40);
  const countText = firstText(doc, RESULTS.count);
  const total = countOf(/of\s+(?:over\s+)?([\d,]+)/i.exec(countText)?.[1] ?? "") ?? null;
  const empty = !items.length && DETECT.noResultsText.test(text($(doc, "body") ?? doc).slice(0, 8000));
  return { items, hasMore: Boolean(next), nextHref: next ? absolute(attr(next, "href")) : null, brands, total, empty };
}

// ---- one item -------------------------------------------------------------------------------------------------------------
function imagesOf(doc) {
  const out = [], seen = new Set();
  // (one picture comes in several sizes: …/abc._AC_SL1500_.jpg and …/abc._AC_US40_.jpg are the same picture)
  const add = (u) => { const s = safeImg(u); if (!s) return; const k = s.replace(/\._[^/]*_\.(jpg|jpeg|png|webp|gif)$/i, ""); if (!seen.has(k)) { seen.add(k); out.push(s); } };
  // the gallery's own list (colorImages / ImageBlockATF data in a script): hiRes, else large
  for (const src of scripts(doc)) {
    if (!/colorImages|ImageBlockATF|"hiRes"/.test(src)) continue;
    for (const m of src.matchAll(/"(?:hiRes|large)"\s*:\s*"((?:https:\/\/|\/)[^"]+)"/g)) add(m[1]);
    if (out.length) break;
  }
  const land = first(doc, ITEM.landing);
  if (land) {
    const dyn = attr(land, "data-a-dynamic-image");
    if (dyn) { try { const o = JSON.parse(dyn); const best = Object.entries(o).sort((a, b) => (b[1]?.[0] ?? 0) - (a[1]?.[0] ?? 0))[0]; if (best) add(best[0]); } catch { /* fine */ } }
    add(attr(land, "data-old-hires")); add(attr(land, "src"));
  }
  for (const t of all(doc, ITEM.thumbs)) { const s = attr(t, "src"); if (s && !/play-icon|video|transparent-pixel|sprite/i.test(s)) add(bigImage(s)); }
  return out.slice(0, 20);
}
function specsOf(doc) {
  const out = [], seen = new Set();
  const push = (k, v) => {
    const name = clip(String(k ?? "").replace(/[:‎‏]/g, ""), 60), value = clip(String(v ?? "").replace(/[‎‏]/g, ""), 240);
    if (!name || !value || seen.has(name.toLowerCase()) || /customer reviews|best sellers rank/i.test(name)) return;
    seen.add(name.toLowerCase()); out.push({ name, value });
  };
  for (const sel of ITEM.specRows) for (const r of $$(doc, sel)) {
    const th = $(r, "th"), tds = $$(r, "td");
    if (th && tds[0]) push(text(th), text(tds[0]));
    else if (tds.length >= 2) push(text(tds[0]), text(tds[1]));
  }
  for (const li of all(doc, ITEM.detailBullets)) {
    const t = text(li); const m = /^(.+?)\s*:\s*(.+)$/.exec(t);
    if (m) push(m[1], m[2]);
  }
  return out.slice(0, 40);
}
function histogramOf(doc) {
  const out = [];
  for (const el of all(doc, ITEM.histogram)) {
    const label = attr(el, "aria-label") || text(el);
    let m = /(\d{1,3})\s*percent of reviews have\s*(\d)\s*stars?/i.exec(label) ?? /(\d)\s*stars?\D+(\d{1,3})\s*%/i.exec(label);
    if (!m) continue;
    const [stars, pct] = /percent/i.test(label) ? [Number(m[2]), Number(m[1])] : [Number(m[1]), Number(m[2])];
    if (!out.some((x) => x.stars === stars)) out.push({ stars, pct });
  }
  return out.sort((a, b) => b.stars - a.stars);
}
function reviewsOf(doc) {
  return all(doc, ITEM.review).slice(0, 8).map((r) => ({
    title: clip(firstText(r, ITEM.reviewTitle).replace(/^\d(?:\.\d)? out of 5 stars\s*/i, ""), 140),
    rating: ratingOf(firstText(r, ITEM.reviewStars)),
    body: clip(firstText(r, ITEM.reviewBody), 900),
    author: clip(firstText(r, ITEM.reviewAuthor), 60),
    date: clip(firstText(r, ITEM.reviewDate), 120),
  })).filter((x) => x.body || x.title);
}
// the customisations (size, colour, style, count…): each dimension, what's chosen, every option with its own ASIN
function variationsOf(doc, asin) {
  const out = [];
  for (const box of all(doc, ITEM.twister)) {
    const id = attr(box, "id") ?? "";
    const key = (/^(?:variation_|inline-twister-row-)(.+)$/.exec(id)?.[1] ?? id).replace(/_name$/, "");
    const label = clip(firstText(box, ITEM.twisterLabel).replace(/:\s*$/, "").replace(/:.*/, ""), 40) || key.replace(/_/g, " ");
    let selected = clip(firstText(box, ITEM.twisterSelected), 80);
    const options = [];
    for (const o of $$(box, "li[data-defaultasin], li[data-asin], option[value]")) {
      let oa = attr(o, "data-defaultasin") || attr(o, "data-asin") || null;
      if (o.name === "option") { const v = attr(o, "value") ?? ""; oa = /,([A-Z0-9]{10})$/.exec(v)?.[1] ?? null; if (v === "-1") continue; }
      const dp = attr(o, "data-dp-url"); if (!oa && dp) oa = asinFrom(dp);
      const img = $(o, "img");
      const olabel = clip(attr(o, "data-ds-label") || text($(o, ".swatch-title-text-display, .twisterTextDiv, .a-size-base, p")) || attr(img, "alt") || (attr(o, "title") ?? "").replace(/^click to select\s*/i, "") || text(o), 60);
      if (!olabel) continue;
      const cls = attr(o, "class") ?? "";
      const unavailable = /swatchUnavailable|swatch-unavailable|unavailable|a-button-unavailable/i.test(cls) || attr(o, "data-ds-available") === "false" || /currently unavailable/i.test(attr(o, "title") ?? "");
      const isSel = /swatchSelect|a-button-selected|selected/i.test(cls) || attr(o, "selected") != null || oa === asin;
      options.push({ label: olabel, asin: isAsin(oa) ? oa : null, available: !unavailable, selected: isSel, image: safeImg(attr(img, "src")) });
    }
    if (!selected) selected = options.find((o) => o.selected)?.label ?? "";
    if (options.length) out.push({ key, name: label.charAt(0).toUpperCase() + label.slice(1), selected, options: options.slice(0, 60) });
  }
  return out;
}
export function parseItem(html, asinHint = null) {
  const doc = load(html);
  const canonical = attr($(doc, 'link[rel="canonical"]'), "href");
  const asin = (isAsin(asinHint) ? asinHint : null) ?? attr($(doc, "#ASIN, input[name=\"ASIN\"]"), "value") ?? asinFrom(canonical) ?? null;
  const title = clip(firstText(doc, ITEM.title), 400);
  const priceText = firstText(doc, ITEM.price);
  const listText = firstText(doc, ITEM.listPrice);
  const stockText = clip(firstText(doc, ITEM.stock), 160);
  const price = priceOf(priceText), listPrice = priceOf(listText);
  const savings = clip(firstText(doc, ITEM.savings), 40) || (listPrice && price && listPrice > price ? `-${Math.round((1 - price / listPrice) * 100)}%` : "");
  const brandText = clip(firstText(doc, ITEM.brand).replace(/^(visit the|brand:)\s*/i, "").replace(/\s*store$/i, ""), 80);
  const offers = all(doc, ITEM.otherOffers).map((a) => clip(text(a), 120)).filter(Boolean).slice(0, 4);
  const sns = first(doc, ITEM.subscribe);
  const buying = [];
  if (price != null) buying.push(`One-time purchase: ${money(price)}`);
  if (sns) buying.push(clip(`Subscribe & Save${priceOf(text(sns)) ? `: ${money(priceOf(text(sns)))}` : ""}`, 80));
  for (const o of offers) buying.push(o);
  return {
    asin, title,
    brand: brandText || null,
    price, priceText: priceText || null, listPrice, savings: savings || null,
    deal: clip(firstText(doc, ITEM.deal), 80) || null,
    images: imagesOf(doc),
    bullets: all(doc, ITEM.bullets).map((b) => clip(text(b), 600)).filter((b) => b && !/^make sure this fits/i.test(b)).slice(0, 12),
    specs: specsOf(doc),
    rating: ratingOf(attr(first(doc, ITEM.ratingText), "title") || firstText(doc, ITEM.ratingText)),
    reviews: countOf(firstText(doc, ITEM.reviewCount)),
    histogram: histogramOf(doc),
    topReviews: reviewsOf(doc),
    delivery: clip(firstText(doc, ITEM.delivery), 200) || null,
    seller: clip(firstText(doc, ITEM.seller), 120) || null,
    shipsFrom: clip(firstText(doc, ITEM.shipsFrom), 120) || null,
    stock: stockText || null,
    inStock: stockText ? !/currently unavailable|out of stock|unavailable/i.test(stockText) : price != null,
    buyingOptions: buying,
    subscribe: Boolean(sns),
    variations: variationsOf(doc, asin),
    canAddToCart: Boolean(first(doc, ITEM.addToCart)),
    url: asin ? absolute(`/dp/${asin}`) : null,
  };
}

// ---- the cart and the checkout ----------------------------------------------------------------------------------------------
export function parseCartAdded(html) {
  const doc = load(html);
  const box = first(doc, CART.added);
  const added = Boolean(box && /added to (cart|basket)/i.test(text(box))) || /added to (your )?(cart|basket)/i.test(text($(doc, "body") ?? doc).slice(0, 6000));
  return { added, count: countOf(firstText(doc, CART.count)), subtotal: priceOf(firstText(doc, CART.subtotal)) };
}
export function parseCheckout(html, url = "") {
  const doc = load(html);
  const review = Boolean(first(doc, CHECKOUT.placeOrder)) || /\/checkout\/|\/gp\/buy\//i.test(url) && /place your order|review your order|order total/i.test(text($(doc, "body") ?? doc).slice(0, 20000));
  return { review, total: priceOf(firstText(doc, CHECKOUT.total)) };
}

// ---- your orders ------------------------------------------------------------------------------------------------------------
export function parseOrders(html) {
  const doc = load(html);
  const orders = [];
  for (const c of all(doc, ORDERS.card)) {
    const items = all(c, ORDERS.item).map((it) => {
      const a = first(it, ORDERS.itemLink);
      const href = attr(a, "href");
      return { title: clip(firstText(it, ORDERS.itemTitle), 200), asin: asinFrom(href), url: absolute(href), image: safeImg(attr(first(it, ORDERS.itemImage), "src")), buyAgain: Boolean(first(it, ORDERS.buyAgain)) };
    }).filter((x) => x.title);
    const track = first(c, ORDERS.track);
    const idText = firstText(c, ORDERS.id);
    orders.push({
      id: /(\d{3}-\d{7}-\d{7}|D\d{2}-\d{7}-\d{7})/.exec(idText || text(c))?.[1] ?? null,
      date: clip(firstText(c, ORDERS.date), 40) || null,
      total: priceOf(firstText(c, ORDERS.total)),
      status: clip(firstText(c, ORDERS.status), 120) || null,
      track: absolute(attr(track, "href")),
      items,
    });
  }
  return { orders: orders.filter((o) => o.items.length || o.id), empty: !orders.length };
}

// ---- Subscribe & Save ---------------------------------------------------------------------------------------------------------
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// "Oct 5", "October 5, 2026", "Arriving Mon, Oct 5" → "2026-10-05" (the next such date from `now`)
export function dateOf(s, now = new Date()) {
  const m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/i.exec(String(s ?? ""));
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)), d = Number(m[2]);
  let y = m[3] ? Number(m[3]) : now.getFullYear();
  if (!m[3]) { const cand = new Date(y, mo, d); if (cand < new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30)) y++; }
  return `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
export function parseSubscriptions(html, now = new Date()) {
  const doc = load(html);
  const items = all(doc, SUBS.card).map((c) => {
    const link = first(c, SUBS.link);
    const next = clip(firstText(c, SUBS.next), 80);
    return {
      id: clip(attr(c, "data-subscription-id"), 60) || null,
      title: clip(firstText(c, SUBS.title), 200),
      asin: asinFrom(attr(link, "href")),
      image: safeImg(attr(first(c, SUBS.image), "src")),
      next: next || null, nextISO: dateOf(next, now),
      frequency: clip(firstText(c, SUBS.frequency), 60) || null,
      qty: countOf(firstText(c, SUBS.qty)),
      price: priceOf(firstText(c, SUBS.price)),
      isNew: Boolean(first(c, SUBS.isNew)),
      canSkip: Boolean($(c, 'button[data-action="skip-delivery"], button.subscription-skip, a[data-action="skip-delivery"]')),
    };
  }).filter((x) => x.title);
  return { items };
}

// ---- your account (read-only; nothing here is ever changed by Dayspring) ------------------------------------------------------------
export function parsePrime(html) {
  const doc = load(html);
  const status = clip(firstText(doc, ACCOUNT.primeStatus), 120);
  const body = text($(doc, "body") ?? doc).slice(0, 20000);
  const member = status ? !/not a (prime )?member|join prime|start your free trial|no membership/i.test(status) : /your prime membership|prime member since|membership renews/i.test(body) && !/join prime|start your free trial/i.test(body);
  return { member, status: status || (member ? "Prime member" : "Not a Prime member"), plan: clip(firstText(doc, ACCOUNT.primePlan), 80) || null, renews: clip(firstText(doc, ACCOUNT.primeRenews), 80) || null };
}
// the default address: the name on it and its city/state only. The street is never read (it's shown masked).
export function parseAddresses(html) {
  const doc = load(html);
  const box = first(doc, ACCOUNT.addressDefault);
  if (!box) return { default: null };
  const city = clip(firstText(box, ACCOUNT.addressCity), 80).replace(/\s*\d{5}(-\d{4})?\b/, "").replace(/,?\s*united states\s*$/i, "").trim();
  return { default: { name: clip(firstText(box, ACCOUNT.addressName), 60) || null, street: "•••• (hidden)", city: city || null } };
}
export function parseComms(html) {
  const doc = load(html);
  return { prefs: all(doc, ACCOUNT.comms).map((r) => ({ name: clip(firstText(r, ACCOUNT.commName), 80), on: Boolean(first(r, ACCOUNT.commOn)) || attr(r, "data-ds-on") === "true" })).filter((x) => x.name).slice(0, 30) };
}
