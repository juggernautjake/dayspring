// Money review: the read-only rules, enforced in code (not just in the AI's instructions).
//
// Dayspring may only READ a money site: read the page, scroll, click navigation (next, older, load more, a month, a
// date range, a transaction row to expand, back), set a date-range filter, and type into the site's own transaction
// search box. Everything else is refused here, before anything happens on the page.
//
//   describeScript          a function run in the page: everything about one element the rules look at
//   judgeClick(info)        → { ok, reason }   the allowlist, with the denylist always winning
//   judgeType(info, kind)   → { ok, reason }   only a date or search field that isn't in a payment form
//   blockedState(pageInfo)  → null | "login" | "2fa" | "captcha"
//
// The denylist is checked on the element's accessible name, its text (hidden text too), aria-label, title, id,
// data-testid, name, href, every element nested inside it, the element actually under the mouse, and the form (or
// dialog) around it. One hit anywhere refuses the click.

const norm = (s) => String(s ?? "")
  .normalize("NFKC").replace(/[\u00AD\u200B-\u200F\u2060-\u2064\uFEFF]/g, "")   // zero-width tricks ("S\u200Bend")
  .replace(/([a-z])([A-Z])/g, "$1 $2")          // sendMoneyButton → send Money Button
  .toLowerCase()
  .replace(/[_\-./:#?=&+]+/g, " ")
  .replace(/[^\p{L}\p{N}$ ]+/gu, " ")
  .replace(/\s+/g, " ")
  .trim();

// ---- the denylist: any of these words anywhere refuses the action -------------------------------------------------
export const DENY_WORDS = [
  "send", "sending", "pay", "pays", "paying", "payment", "payments", "pay now", "bill pay", "autopay", "transfer", "transfers", "request", "requests",
  "cash out", "cashout", "withdraw", "withdrawal", "deposit", "deposits", "add money", "add cash", "add funds", "buy", "sell", "invest", "investing",
  "bitcoin", "btc", "crypto", "stock", "stocks", "trade", "confirm", "submit", "approve", "accept", "decline", "link bank", "link a bank", "link card",
  "link account", "card settings", "lock", "unlock", "lock card", "unlock card", "freeze", "unfreeze", "dispute", "report", "cancel", "delete", "remove",
  "close account", "settings", "setting", "profile", "password", "passcode", "pin", "security", "logout", "log out", "sign out", "signout", "log off",
  "edit", "save", "split", "tip", "donate", "borrow", "loan", "redeem", "refund", "checkout", "check out", "order", "zelle", "wire", "upgrade", "enroll",
  "enable", "disable", "turn on", "turn off", "verify", "activate", "deactivate", "download", "export", "print", "share", "invite", "boost", "gift",
  "claim", "open account", "apply now", "sign up", "signup", "register", "reset", "change", "manage", "replace card", "new card", "order card",
  "direct deposit", "pay back", "payback", "repay", "schedule payment", "send money", "request money", "pay or request", "remind", "chargeback",
];
const DENY_RE = new RegExp(`(?:^|\\s)(?:${DENY_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s")).join("|")})(?=\\s|$)`);
export const denyHit = (s) => { const t = norm(s); const m = DENY_RE.exec(t); return m ? m[0].trim() : null; };

// href paths that are never navigation: pay/send/transfer pages, settings, logout, downloads, script links
const DENY_HREF = /(^|[/?#&=._-])(pay|payments?|send|transfer|transfers|request|cashout|cash-out|withdraw|deposit|buy|sell|invest|bitcoin|crypto|stocks?|settings|profile|security|password|logout|log-out|signout|sign-out|logoff|dispute|cancel|delete|close-account|link-bank|add-money|download|export|print|checkout)(?=$|[/?#&=._-])/i;

// ---- the allowlist: the whole name has to be one of these -----------------------------------------------------------
const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
const ALLOW = [
  /^(go to |show |view |see |load )?(the )?(next|previous|prev|older|newer|earlier|later)( page| month| week| transactions| activity| results| statement| statements| \d+)?$/,
  /^(load|see|show|view) (more|all|older|earlier|more transactions|more activity|all transactions|all activity|older transactions|more results)$/,
  /^(more|view all|see all|show all|more transactions|older transactions|older activity|all transactions|all activity)$/,
  /^(activity|transactions|transaction history|recent transactions|recent activity|account activity|statements|statements and documents|history|payment history|posted|pending|all)$/,
  /^(back|go back|back to (activity|transactions|account|accounts|summary|home|history|list|results))$/,
  /^(details|detail|expand|expand row|view details|show details|see details|more details|more info|transaction details|view transaction|show transaction)$/,
  /^(page )?\d{1,3}$/, /^(go to )?page \d{1,3}$/, /^(first|last)( page)?$/,
  new RegExp(`^(${MONTHS})( \\d{4})?$`),
  /^(last|past|previous) (\d{1,3}|seven|thirty|sixty|ninety|three|six|twelve) (days?|weeks?|months?)$/,
  /^(this|last|previous) (week|month|year|statement|statement period)$/, /^(year to date|ytd|all dates|any date|all time|date|dates|date range|custom|custom range|custom dates|choose dates|filter|filters|filter by date|date filter)$/,
  /^\d{4}$/,
  // arrow buttons that only carry an arrow ("›") are named by their aria-label, which is judged the same way
  /^(›|»|‹|«|→|←|>|<)$/,
];
export const allowedName = (s) => { const t = norm(s); if (!t) return /^\s*(›|»|‹|«|→|←|>|<)\s*$/.test(String(s ?? "")); return ALLOW.some((r) => r.test(t)); };

// the "apply" of a date filter: only clicked by set-date-range, never on its own
export const APPLY_NAME = /^(apply|apply filter|apply filters|done|ok|update|update results|show results|see results|filter|search|go|view)$/;

// ---- what the page tells us about one element -----------------------------------------------------------------------
// Run in the page (no closures): (el) → info. Also used on the element under the mouse.
export function describeScript(el) {
  const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
  const labelled = (e) => { const ids = (e.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean); return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" "); };
  const typed = (e) => e.tagName === "TEXTAREA" || (e.tagName === "INPUT" && !["button", "submit", "reset", "image"].includes((e.getAttribute("type") || "").toLowerCase()));
  const attrs = (e) => ["aria-label", "title", "id", "name", "data-testid", "data-test", "data-qa", "data-action", ...(typed(e) ? [] : ["value"]), "alt", "aria-describedby"].map((a) => e.getAttribute?.(a) ?? "").join(" ") + " " + labelled(e);
  const visibleText = (e) => clean(e.innerText ?? "");
  const allText = (e) => clean(e.textContent ?? "");          // hidden text too
  const nested = [...el.querySelectorAll("a, button, input, select, textarea, [role=button], [role=link], [role=menuitem], [role=tab], [onclick], [aria-label], [title], [data-testid]")].slice(0, 60)
    .map((c) => clean(`${c.getAttribute("aria-label") ?? ""} ${c.getAttribute("title") ?? ""} ${c.id ?? ""} ${c.getAttribute("data-testid") ?? ""} ${c.getAttribute("name") ?? ""} ${c.getAttribute("href") ?? ""} ${c.textContent ?? ""} ${c.value ?? ""}`)).join(" | ");
  // the form around it, or a dialog / region acting as one
  const form = el.closest("form, [role=form], [role=dialog], dialog");
  let formInfo = "", paymentForm = false;
  if (form) {
    const fields = [...form.querySelectorAll("input, select, textarea, button, [role=button]")].slice(0, 80);
    formInfo = clean([form.getAttribute("action") ?? "", form.getAttribute("aria-label") ?? "", form.id ?? "", form.getAttribute("name") ?? "", form.getAttribute("data-testid") ?? "",
      ...fields.map((f) => `${f.getAttribute("name") ?? ""} ${f.id ?? ""} ${f.getAttribute("placeholder") ?? ""} ${f.getAttribute("aria-label") ?? ""} ${f.getAttribute("autocomplete") ?? ""} ${f.type ?? ""} ${f.tagName === "BUTTON" || f.getAttribute("role") === "button" ? f.textContent ?? "" : ""} ${[...(f.labels ?? [])].map((l) => l.textContent).join(" ")}`)].join(" "));
    paymentForm = fields.some((f) => /amount|recipient|payee|to_user|send_to|card.?number|cc-number|cc-csc|cvv|cvc|routing|account.?number|iban|pin\b|memo|note/i.test(`${f.getAttribute("name") ?? ""} ${f.id ?? ""} ${f.getAttribute("placeholder") ?? ""} ${f.getAttribute("aria-label") ?? ""} ${f.getAttribute("autocomplete") ?? ""} ${[...(f.labels ?? [])].map((l) => l.textContent).join(" ")}`))
      || /\b(pay|send|transfer|request|payment|withdraw|deposit|cash out)\b/i.test(formInfo);
  }
  // what the boxes around it are called (a "Send money" panel around a plain "Next")
  const around = []; for (let a = el.parentElement, i = 0; a && i < 6; a = a.parentElement, i++) around.push(`${a.getAttribute("aria-label") ?? ""} ${a.id ?? ""} ${a.getAttribute("data-testid") ?? ""} ${a.getAttribute("role") === "dialog" || a.tagName === "DIALOG" ? a.querySelector("h1, h2, h3")?.textContent ?? "" : ""}`);
  const tag = el.tagName.toLowerCase(), type = (el.getAttribute("type") || "").toLowerCase();
  const inForm = Boolean(el.form || el.closest("form"));
  const submits = (tag === "button" && (type === "submit" || (!type && inForm))) || (tag === "input" && (type === "submit" || type === "image"));
  const r = el.getBoundingClientRect();
  const labels = [...(el.labels ?? [])].map((l) => l.textContent).join(" ");
  return {
    tag, type, role: el.getAttribute("role") ?? "", href: el.getAttribute("href") ?? "", download: el.hasAttribute("download"),
    name: clean(el.getAttribute("aria-label") || labelled(el) || el.getAttribute("title") || visibleText(el) || el.getAttribute("alt") || (typed(el) ? "" : el.value) || labels || el.getAttribute("placeholder") || ""),
    visible: visibleText(el), text: allText(el), attrs: clean(attrs(el)), nested, form: formInfo, around: clean(around.join(" ")), paymentForm, submits, inForm,
    placeholder: el.getAttribute("placeholder") ?? "", autocomplete: el.getAttribute("autocomplete") ?? "", labels: clean(labels), inputMode: el.getAttribute("inputmode") ?? "",
    formMethod: (form?.getAttribute?.("method") ?? "").toLowerCase(), searchRole: Boolean(el.closest("[role=search]")),
    isRow: Boolean(el.closest("[data-ds-money-row]")) || el.hasAttribute("data-ds-money-row"),
    box: { x: r.x, y: r.y, w: r.width, h: r.height }, contentEditable: el.isContentEditable,
  };
}

// Around a control, a form counts against it when it moves money or signs in (a date filter's own "Cancel" button
// doesn't make the whole filter off-limits; a payment form's "Next" is always refused).
export const FORM_DENY_WORDS = ["send", "pay", "payment", "payments", "transfer", "request", "cash out", "cashout", "withdraw", "withdrawal", "deposit",
  "buy", "sell", "invest", "bitcoin", "btc", "crypto", "stock", "stocks", "trade", "add money", "add cash", "link bank", "amount", "recipient", "payee",
  "card number", "cc number", "cvv", "cvc", "routing", "account number", "password", "passcode", "pin", "one time code", "verification", "dispute",
  "close account", "lock card", "unlock card", "freeze", "approve", "confirm", "submit", "zelle", "wire", "autopay", "bill pay", "log in", "login", "sign in"];
const FORM_RE = new RegExp(`(?:^|\\s)(?:${FORM_DENY_WORDS.map((w) => w.replace(/ /g, "\\s")).join("|")})(?=\\s|$)`);
// the panels around a control: only clear money-moving names count (a "Payment history" list is fine to page through)
const AROUND_RE = /(?:^|\s)(send|send money|pay now|pay someone|pay a friend|make a payment|transfer money|transfer funds|withdraw|cash out|cashout|request money|confirm|checkout|buy|sell|add money|add cash|link bank|sign out|log out|close account|lock card)(?=\s|$)/;
const formHit = (s) => { const m = FORM_RE.exec(norm(s)); return m ? m[0].trim() : null; };

// every place the denylist looks, in one list (for the reason given back)
function denyReason(info) {
  const places = [["name", info.name], ["text", info.text], ["label", info.attrs], ["nested", info.nested]];
  for (const [where, s] of places) { const w = denyHit(s); if (w) return `"${w}" (${where})`; }
  if (info.paymentForm) return "a payment or transfer form (form)";
  { const m = AROUND_RE.exec(norm(info.around)); if (m) return `"${m[0].trim()}" (the panel around it)`; }
  { const w = formHit(info.form); if (w) return `"${w}" (form)`; }
  if (info.href && DENY_HREF.test(info.href.replace(/^https?:\/\/[^/]+/i, ""))) return `a link to ${info.href.replace(/^https?:\/\/[^/]+/i, "").slice(0, 60)} (href)`;
  if (/^javascript:/i.test(info.href) && !/^javascript:\s*(void\(0\)|;)?\s*;?$/i.test(info.href)) return "a script link (href)";
  return null;
}

// Clicks: the denylist first (always wins), then no downloads, no form submits, then the allowlist.
export function judgeClick(info, { hit = null } = {}) {
  if (!info) return { ok: false, reason: "I couldn't find that on the page." };
  const d = denyReason(info);
  if (d) return { ok: false, reason: `Refused: it mentions ${d}. Dayspring only reads money sites.` };
  if (hit) { const h = denyReason(hit); if (h) return { ok: false, reason: `Refused: something else sits on top of it that mentions ${h}.` }; }
  if (info.download || /\.(pdf|csv|ofx|qfx|qbo|xlsx?|zip)(\?|$)/i.test(info.href)) return { ok: false, reason: "Refused: that downloads a file. You can download statements yourself and import them." };
  if (info.submits) return { ok: false, reason: "Refused: that button submits a form, and Dayspring never submits forms on money sites." };
  if (info.tag === "input" || info.tag === "textarea" || info.tag === "select") return { ok: false, reason: "Refused: that's a field, not a button." };
  if (info.isRow) return { ok: true, why: "a transaction row" };
  if (!allowedName(info.name) && !allowedName(info.visible)) return { ok: false, reason: `Refused: "${String(info.name || info.visible).slice(0, 40)}" isn't a page-navigation control (next, older, load more, a month or date range, details, back).` };
  return { ok: true, why: "navigation" };
}

// Typing: only into a date or search field, never in a payment form, never passwords/codes/cards/money/people.
const FIELD_DENY = /password|passcode|one.?time|otp|2fa|verification|security code|\bcode\b|\bpin\b|ssn|social security|card|cvv|cvc|expir|routing|account.?(number|no)|iban|amount|\$|recipient|payee|send to|pay to|\bto\b.*(phone|email|user)|phone|e-?mail|username|user name|login|sign.?in|memo|note|message|comment|name on/i;
export function judgeType(info, kind) {
  if (!info) return { ok: false, reason: "I couldn't find that field." };
  if (!["date", "search"].includes(kind)) return { ok: false, reason: "Refused: Dayspring only types dates and searches on money sites." };
  if (info.paymentForm) return { ok: false, reason: "Refused: that field is inside a payment or transfer form." };
  const d = denyReason({ ...info, text: "", nested: "" });   // a field's own text is its value; the rest still counts
  if (d) return { ok: false, reason: `Refused: the field or its form mentions ${d}.` };
  if (["password", "hidden", "email", "tel", "number", "file", "checkbox", "radio", "submit", "button", "image", "range", "color"].includes(info.type)) return { ok: false, reason: `Refused: Dayspring never types into a ${info.type} field here.` };
  if (/cc-|one-time-code|current-password|new-password|username|email|tel|transaction-amount/i.test(info.autocomplete)) return { ok: false, reason: "Refused: that field is for sign-in, card or payment details." };
  const words = `${info.name} ${info.attrs} ${info.placeholder} ${info.labels}`;
  if (FIELD_DENY.test(words.replace(/\b(start|end|from|to) date\b/gi, "date"))) return { ok: false, reason: "Refused: that field isn't a date or a transaction search." };
  if (info.tag !== "input" && !info.contentEditable) return { ok: false, reason: "Refused: that isn't a text field." };
  if (kind === "date") {
    const ok = ["date", "month", "datetime-local"].includes(info.type) || /\b(date|from|to|start|end|since|until|begin|through)\b/i.test(words);
    return ok ? { ok: true } : { ok: false, reason: "Refused: that doesn't look like a date field." };
  }
  if (["date", "month", "week", "time", "datetime-local"].includes(info.type)) return { ok: false, reason: "Refused: that's a date field, not the search box." };
  const ok = info.type === "search" || info.searchRole || /\b(search|find|filter|look ?up)\b/i.test(words);
  return ok ? { ok: true } : { ok: false, reason: "Refused: that doesn't look like the site's transaction search box." };
}

// ---- stop-and-hand-over pages ---------------------------------------------------------------------------------------
// pageInfo: { url, title, text, hasPassword, hasOtp, captchaFrame }
export function blockedState(p = {}) {
  const t = `${p.title ?? ""} ${p.text ?? ""}`.toLowerCase();
  if (p.captchaFrame || /\b(captcha|recaptcha|hcaptcha|i'?m not a robot|verify (that )?you are (a )?human|are you a robot|press and hold|security check|checking your browser)\b/.test(t)) return "captcha";
  if (p.hasOtp || /\b(two.?factor|2.?step|2fa|verification code|one.?time (pass)?code|enter the code|we (just )?(sent|texted|emailed) (you )?a code|security code sent|confirm it'?s you|authenticator app)\b/.test(t)) return "2fa";
  if (p.hasPassword || /\b(sign in to|log in to|login to) (your )?(account|venmo|cash app|online banking)\b|^\s*(sign in|log in)\s*$/m.test(t)) return "login";
  return null;
}
export const BLOCKED_TEXT = {
  login: "The site is asking you to sign in. Please sign in yourself in the money window (Dayspring never types or sees passwords), then ask me again.",
  "2fa": "The site wants a verification code. Please finish that yourself in the money window, then ask me again. Dayspring never reads or types codes.",
  captcha: "The site is showing a robot check. Please finish it yourself in the money window, then ask me again. Dayspring never tries those.",
};
export { norm as _norm };
