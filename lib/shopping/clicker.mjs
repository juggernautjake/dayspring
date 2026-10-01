// THE ONLY PLACE DAYSPRING PRESSES ANYTHING ON AMAZON. Every other part of lib/shopping only opens pages and reads them
// (scripts/qa/shopping.mjs checks that no other file in lib/shopping clicks, presses keys, types, fills or submits).
//
// Two buttons exist for it, and only after the owner's own yes (a confirm token, lib/confirm.mjs, spent for exactly
// that item):
//   "add-to-cart"  Amazon's "Add to Cart" on an item's page
//   "sns-skip"     Subscribe & Save's "Skip" for ONE upcoming delivery
// Everything else is refused, always, whatever asks: "Place your order", "Buy Now", any 1-Click, Subscribe, Pay, a
// payment method or an address, Cancel, Sign up, Proceed to checkout… (selectors.mjs FORBIDDEN). A button is refused when
//   - the action isn't one of the two, or no grant (the spent yes) for that action comes with it
//   - the selector, or the button's text, value, aria-label, title, name or id says any forbidden word
//   - the button doesn't itself say what it should ("Add to Cart", "Skip")
//   - the form it would submit goes to a forbidden address (placing an order, paying, subscribing, signing in)
// While the click happens, any POST to a forbidden address is blocked in the browser itself.
//   judge(action, { selector, desc }) → { ok, why }      (pure; the tests call it directly)
//   safeClick(page, action, grant) → { clicked: true, selector } | throws (e.refused = true)
import { CLICKABLE, isForbidden, isForbiddenPost } from "./selectors.mjs";

const HUMAN = ["text", "value", "aria", "title", "name", "id"];
export function judge(action, { selector = "", desc = {} } = {}) {
  const spec = Object.prototype.hasOwnProperty.call(CLICKABLE, action) ? CLICKABLE[action] : null;
  if (!spec) return { ok: false, why: `"${String(action).slice(0, 60)}" isn't something Dayspring may press on Amazon.` };
  if (isForbidden(selector)) return { ok: false, why: "That button is one only you may press." };
  if (selector && !spec.selectors.includes(selector)) return { ok: false, why: "That isn't the button Dayspring may press." };
  for (const k of HUMAN) if (desc[k] && isForbidden(desc[k])) return { ok: false, why: `The button says "${String(desc[k]).slice(0, 60)}", which only you may press.` };
  if (!["text", "value", "aria"].some((k) => desc[k] && spec.must.test(String(desc[k])))) return { ok: false, why: "The button doesn't say what Dayspring expected, so it wasn't pressed." };
  for (const k of ["formAction", "formaction"]) if (desc[k] && isForbiddenPost(desc[k])) return { ok: false, why: "That button would send an order or a payment, so it wasn't pressed." };
  return { ok: true };
}

// within: only inside one part of the page (one subscription's card): [data-subscription-id="…"] and nothing else
const WITHIN = /^\[data-subscription-id="[\w.-]{1,60}"\]$/;
export async function safeClick(page, action, grant, { timeout = 15000, log = () => {}, within = null } = {}) {
  const refuse = (why) => { log("blocked", { action: String(action).slice(0, 60), why }); throw Object.assign(new Error(why), { refused: true }); };
  const spec = Object.prototype.hasOwnProperty.call(CLICKABLE, action) ? CLICKABLE[action] : null;
  if (!spec) refuse(judge(action).why);
  // the owner's yes, already spent for exactly this action (lib/shopping/index.mjs: confirm.consume)
  if (!grant || grant.ok !== true || grant.action !== action) refuse("Dayspring needs your own yes before it presses that.");
  if (within != null && !WITHIN.test(String(within))) refuse("Dayspring can't press a button there.");
  let el = null, selector = null;
  for (const sel of spec.selectors) {
    const loc = (within ? page.locator(within).locator(sel) : page.locator(sel)).first();
    if (await loc.count().catch(() => 0) && await loc.isVisible().catch(() => false)) { el = loc; selector = sel; break; }
  }
  if (!el) throw Object.assign(new Error(action === "add-to-cart" ? "Amazon's page has no Add to Cart button for this item right now." : "Amazon's page doesn't show a Skip button for that delivery."), { missing: true });
  const desc = await el.evaluate((e) => ({
    tag: e.tagName, id: e.id || "", name: e.getAttribute("name") || "", value: e.value || e.getAttribute("value") || "",
    aria: e.getAttribute("aria-label") || (e.getAttribute("aria-labelledby") ? (document.getElementById(e.getAttribute("aria-labelledby"))?.textContent ?? "") : ""),
    title: e.getAttribute("title") || "", text: (e.innerText || e.textContent || "").trim().slice(0, 200),
    formAction: e.form ? e.form.getAttribute("action") || e.form.action || "" : "", formaction: e.getAttribute("formaction") || "",
  }), null, { timeout: 5000 }).catch(() => null);
  if (!desc) refuse("Dayspring couldn't read that button, so it wasn't pressed.");
  const j = judge(action, { selector, desc });
  if (!j.ok) refuse(j.why);
  // while it's pressed: nothing may be sent to an order, payment, subscription or sign-in address
  const blocked = [];
  const guard = (route) => {
    const r = route.request();
    if (r.method() !== "GET" && isForbiddenPost(r.url())) { blocked.push(r.url()); return route.abort("blockedbyclient"); }
    return route.fallback();
  };
  await page.route("**/*", guard);
  try {
    await el.click({ timeout });
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(600);
  } finally { await page.unroute("**/*", guard).catch(() => {}); }
  if (blocked.length) { log("blocked", { action, why: "a request to an order or payment address was stopped", count: blocked.length }); }
  log("clicked", { action, selector });
  return { clicked: true, selector, blocked: blocked.length };
}
