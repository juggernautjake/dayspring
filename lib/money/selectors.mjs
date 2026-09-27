// Money review: where things are on money sites, in ONE place.
//
// Sites change their markup, so every part has a list of selectors tried in order, each with a confidence: the site's
// own test ids first, then accessible roles and labels (which change least), then plain structure. When none match,
// the reader falls back to tables, aria grids and lists, then to plain text (a line with a date and an amount), each
// with a lower confidence. The confidence travels with every row, so a shaky read shows up in the report.
//
//   SITES                 { venmo, cashapp, bank }: how to recognise each site, and its selector lists
//   siteFor(url)          → "venmo" | "cashapp" | "bank"
//   registryFor(site)     → the merged lists (the site's own entries first, then the generic ones)
//   extractScript         the in-page reader (no imports, no closures): (REG) → { rows, balances, strategy, confidence }
//   pageStateScript       the in-page check for sign-in, 2FA and robot checks: () → { url, title, text, hasPassword, hasOtp, captchaFrame }

const S = (sel, conf) => ({ sel, conf });

export const GENERIC = {
  row: [S("[data-testid*='transaction-row' i]", 0.8), S("[data-testid*='transaction' i][role='row']", 0.8), S("[data-transaction-id]", 0.8),
    S("[role='grid'] [role='row']", 0.7), S("[role='table'] [role='row']", 0.7), S("[role='treegrid'] [role='row']", 0.65),
    S("table tbody tr", 0.65), S("[role='list'] [role='listitem']", 0.55), S("[role='feed'] [role='article']", 0.55), S("ul li", 0.4)],
  date: [S("time[datetime]", 0.9), S("[data-testid*='date' i]", 0.8), S("[class*='date' i]", 0.6)],
  description: [S("[data-testid*='description' i]", 0.8), S("[data-testid*='merchant' i]", 0.8), S("[data-testid*='title' i]", 0.6), S("[class*='description' i]", 0.6), S("[class*='merchant' i]", 0.6), S("[class*='title' i]", 0.45)],
  amount: [S("[data-testid*='amount' i]", 0.85), S("[class*='amount' i]", 0.65), S("[aria-label*='amount' i]", 0.6)],
  status: [S("[data-testid*='status' i]", 0.8), S("[class*='pending' i]", 0.6), S("[class*='status' i]", 0.5)],
  note: [S("[data-testid*='note' i]", 0.7), S("[data-testid*='memo' i]", 0.7), S("[class*='note' i]", 0.5)],
  account: [S("[data-testid*='account' i]", 0.7), S("[class*='account' i]", 0.4)],
  balance: [S("[data-testid*='balance' i]", 0.85), S("[aria-label*='balance' i]", 0.7), S("[class*='balance' i]", 0.55)],
  search: [S("[role='search'] input", 0.8), S("input[type='search']", 0.8), S("input[placeholder*='search' i]", 0.6), S("input[aria-label*='search' i]", 0.6)],
  dateFrom: [S("input[name*='from' i]", 0.6), S("input[aria-label*='start date' i]", 0.7), S("input[aria-label*='from' i]", 0.6), S("input[type='date']", 0.5)],
  dateTo: [S("input[name*='to' i]:not([name*='total' i])", 0.6), S("input[aria-label*='end date' i]", 0.7), S("input[aria-label*='to' i]", 0.5)],
};

export const SITES = {
  venmo: {
    hosts: [/(^|\.)venmo\.com$/i], start: "https://account.venmo.com/", label: "Venmo",
    parts: {
      row: [S("[data-testid='feed-story']", 0.95), S("[data-testid*='story' i]", 0.85), S("[class*='storyContent' i]", 0.7), S("[class*='transaction' i][role='listitem']", 0.7)],
      description: [S("[data-testid='story-title']", 0.95), S("[class*='storyTitle' i]", 0.7)],
      amount: [S("[data-testid='story-amount']", 0.95), S("[class*='storyAmount' i]", 0.7)],
      date: [S("[data-testid='story-date']", 0.95), S("[class*='storyDate' i]", 0.7)],
      note: [S("[data-testid='story-note']", 0.95), S("[class*='storyNote' i]", 0.7)],
      balance: [S("[data-testid='venmo-balance']", 0.95), S("[class*='balanceAmount' i]", 0.7)],
    },
    // Venmo's wording: "You paid Josh" (out), "Josh paid you" (in), "You charged Sam" (in once paid), "Sam charged you" (out)
    outWords: /\byou (paid|sent)\b|\bcharged you\b|\btransfer(red)? to (bank|your bank)\b|\bstandard transfer\b|\binstant transfer\b/i,
    inWords: /\bpaid you\b|\bsent you\b|\byou charged\b|\badded to (your )?venmo\b|\bfrom (your )?bank\b/i,
  },
  cashapp: {
    hosts: [/(^|\.)cash\.app$/i, /(^|\.)cash\.me$/i, /(^|\.)squareup\.com$/i], start: "https://cash.app/account/activity", label: "Cash App",
    parts: {
      row: [S("[data-testid='activity-item']", 0.95), S("[data-testid*='activity' i][role='listitem']", 0.85), S("[class*='ActivityItem' i]", 0.7), S("[class*='activity-row' i]", 0.7)],
      description: [S("[data-testid='activity-title']", 0.95), S("[class*='ActivityTitle' i]", 0.7)],
      amount: [S("[data-testid='activity-amount']", 0.95), S("[class*='ActivityAmount' i]", 0.7)],
      date: [S("[data-testid='activity-date']", 0.95), S("[class*='ActivityDate' i]", 0.7)],
      status: [S("[data-testid='activity-status']", 0.95)],
      note: [S("[data-testid='activity-note']", 0.95)],
      balance: [S("[data-testid='cash-balance']", 0.95), S("[class*='CashBalance' i]", 0.7)],
    },
    outWords: /\bcash out\b|\bsent\b|\bpaid\b|\bcard purchase\b|\bpurchase\b|\bwithdrawal\b|\bbought\b/i,
    inWords: /\breceived\b|\bdeposit\b|\bcash in\b|\badded cash\b|\brefund\b|\bsold\b|\bpaid you\b/i,
  },
  bank: { hosts: [], start: null, label: "your bank", parts: {} },
};

// well-known banks, for "open my bank" (the owner can also give any address)
export const BANKS = {
  chase: "https://www.chase.com/", "bank of america": "https://www.bankofamerica.com/", "wells fargo": "https://www.wellsfargo.com/", "capital one": "https://www.capitalone.com/",
  citi: "https://www.citi.com/", citibank: "https://www.citi.com/", "us bank": "https://www.usbank.com/", pnc: "https://www.pnc.com/", truist: "https://www.truist.com/",
  discover: "https://www.discover.com/", "american express": "https://www.americanexpress.com/", amex: "https://www.americanexpress.com/", "navy federal": "https://www.navyfederal.org/",
  usaa: "https://www.usaa.com/", ally: "https://www.ally.com/", "td bank": "https://www.td.com/us/en/personal-banking", regions: "https://www.regions.com/", "fifth third": "https://www.53.com/",
  huntington: "https://www.huntington.com/", "citizens bank": "https://www.citizensbank.com/", chime: "https://app.chime.com/", sofi: "https://www.sofi.com/", paypal: "https://www.paypal.com/myaccount/activities/",
};

const testMode = () => process.env.DAYSPRING_FINANCE_ALLOW_LOCAL === "1";
const loopback = (host) => /^(127\.0\.0\.1|localhost)$/i.test(host);
export function siteFor(url) {
  let u = null; try { u = new URL(String(url)); } catch { return "bank"; }
  for (const [id, s] of Object.entries(SITES)) if (s.hosts.some((h) => h.test(u.hostname))) return id;
  // the test's mock pages (scripts/qa/fixtures/money) live on this computer: told apart by their file name
  if (testMode() && loopback(u.hostname)) return /venmo/i.test(u.pathname) ? "venmo" : /cash ?app/i.test(u.pathname) ? "cashapp" : "bank";
  return "bank";
}
// the name a site's data is kept under: its host ("account.venmo.com"), or "venmo.test" for the test's mock pages
export function sourceOf(url) {
  let u = null; try { u = new URL(String(url)); } catch { return "unknown"; }
  if (testMode() && loopback(u.hostname)) return `${siteFor(url)}.test`;
  return u.hostname.replace(/^www\./, "");
}
export function registryFor(site) {
  const own = SITES[site]?.parts ?? {};
  const out = {};
  for (const k of new Set([...Object.keys(GENERIC), ...Object.keys(own)])) out[k] = [...(own[k] ?? []), ...(GENERIC[k] ?? [])];
  return out;
}

// ---- the in-page reader ---------------------------------------------------------------------------------------------
// Runs in the page. Returns plain data only; never clicks or types. Rows it reads are tagged data-ds-money-row (so a
// click on "a transaction row" can be told apart from a button).
export function extractScript(REG) {
  const AMT = /[-−–+]?\s*\(?\s*[-−–+]?\s*\$\s?\d[\d,]*(?:\.\d{2})?\)?|\b\d[\d,]*\.\d{2}\b\s*(?:USD)?/;
  const DATEISH = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b|\b(?:today|yesterday)\b|\b\d{1,2}[dhmw]\b|\b\d{1,2} (?:days?|hours?|weeks?) ago\b/i;
  const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const shown = (el) => { if (!el || !el.getClientRects().length) return false; const cs = getComputedStyle(el); return cs.visibility !== "hidden" && cs.display !== "none"; };
  const q = (sel, root = document) => { try { return root.querySelector(sel); } catch { return null; } };
  const qa = (sel, root = document) => { try { return [...root.querySelectorAll(sel)]; } catch { return []; } };
  const first = (part, root) => { for (const { sel, conf } of REG[part] ?? []) { const el = q(sel, root); if (el && clean(el.innerText ?? el.textContent)) return { el, sel, conf }; } return null; };
  const rowId = (el) => el.getAttribute("data-transaction-id") || el.getAttribute("data-id") || el.getAttribute("data-key") || el.getAttribute("data-row-key") || (el.id && !/^ds-/.test(el.id) ? el.id : "");
  const statusOf = (el, text) => {
    const s = first("status", el);
    const hint = `${s ? clean(s.el.innerText) : ""} ${el.className ?? ""} ${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("data-status") ?? ""}`;
    return /pending|processing|authoriz|in progress|scheduled/i.test(hint) || /\bpending\b/i.test(text) ? "pending" : "posted";
  };
  const out = { rows: [], balances: [], strategy: null, confidence: 0 };

  // 1. the site's rows and generic row selectors with parts inside them
  const headerMap = (cells) => cells.map((c) => clean(c.innerText ?? c.textContent).toLowerCase());
  for (const { sel, conf } of REG.row ?? []) {
    let els = qa(sel).filter(shown);
    // a table row needs cells; a list item needs an amount; header rows are skipped
    els = els.filter((el) => !el.querySelector("th, [role=columnheader]") && AMT.test(el.innerText ?? "") && (el.innerText ?? "").length < 800);
    // skip wrappers: keep only rows that don't contain another matching row
    els = els.filter((el) => !els.some((o) => o !== el && el.contains(o)));
    if (els.length < 1) continue;
    // headers for table-ish rows
    let headers = null;
    const table = els[0].closest("table, [role=grid], [role=table], [role=treegrid]");
    if (table) {
      const hs = qa("thead th, [role=columnheader], tr th", table);
      if (hs.length) headers = headerMap(hs);
    }
    for (const el of els) {
      const text = clean(el.innerText);
      const cells = [...el.querySelectorAll(":scope > td, :scope > th, :scope > [role=gridcell], :scope > [role=cell]")].map((c) => clean(c.innerText));
      const t = q("time[datetime]", el);
      const part = (p) => { const f = first(p, el); return f ? clean(f.el.innerText) : ""; };
      el.setAttribute("data-ds-money-row", "1");
      out.rows.push({ id: rowId(el), text, cells: cells.length ? cells : null, headers: cells.length ? headers : null, time: t?.getAttribute("datetime") ?? "",
        date: part("date"), description: part("description"), amount: part("amount"), note: part("note"), account: part("account"),
        status: statusOf(el, text), cls: String(el.className ?? "").slice(0, 120), conf, via: sel });
    }
    out.strategy = sel; out.confidence = conf;
    break;
  }
  // 2. plain text: the smallest blocks holding a date and an amount
  if (!out.rows.length) {
    const blocks = qa("div, li, article, section, p").filter((el) => { const tx = el.innerText ?? ""; return tx.length < 300 && AMT.test(tx) && DATEISH.test(tx) && shown(el); });
    const leaves = blocks.filter((el) => !blocks.some((o) => o !== el && el.contains(o)));
    for (const el of leaves) { el.setAttribute("data-ds-money-row", "1"); out.rows.push({ id: rowId(el), text: clean(el.innerText), cells: null, headers: null, time: "", date: "", description: "", amount: "", note: "", account: "", status: statusOf(el, el.innerText ?? ""), cls: "", conf: 0.3, via: "text" }); }
    if (leaves.length) { out.strategy = "text"; out.confidence = 0.3; }
  }
  // balances: labelled parts first, then any short line that says "balance" next to an amount
  const seen = new Set();
  for (const { sel, conf } of REG.balance ?? []) for (const el of qa(sel).filter(shown)) {
    const tx = clean(el.innerText); if (!AMT.test(tx) || tx.length > 120 || seen.has(tx)) continue; seen.add(tx);
    const label = clean(el.getAttribute("aria-label") || el.closest("section, [role=region], div")?.querySelector("h1, h2, h3, h4, [class*='label' i]")?.innerText || "balance");
    out.balances.push({ label: label.slice(0, 60), text: tx, conf });
  }
  if (!out.balances.length) {
    for (const el of qa("div, p, span, li, dd, td").filter(shown)) {
      const tx = clean(el.innerText);
      if (tx.length > 90 || !/balance/i.test(tx) || !AMT.test(tx) || seen.has(tx)) continue;
      if ([...el.children].some((c) => /balance/i.test(c.innerText ?? "") && AMT.test(c.innerText ?? ""))) continue;
      seen.add(tx); out.balances.push({ label: tx.replace(AMT, "").trim().slice(0, 60) || "balance", text: tx, conf: 0.4 });
    }
  }
  return out;
}

export function pageStateScript() {
  const shown = (el) => Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
  const text = String(document.body?.innerText ?? "").slice(0, 6000);
  const hasPassword = [...document.querySelectorAll("input[type=password]")].some(shown);
  const hasOtp = [...document.querySelectorAll("input[autocomplete='one-time-code'], input[name*='otp' i], input[name*='verification' i], input[id*='otp' i]")].some(shown);
  const captchaFrame = [...document.querySelectorAll("iframe")].some((f) => /recaptcha|hcaptcha|captcha|challenges\.cloudflare|arkoselabs|funcaptcha/i.test(f.src ?? "")) || Boolean(document.querySelector(".g-recaptcha, .h-captcha, #captcha, [data-sitekey]"));
  return { url: location.href, title: document.title, text, hasPassword, hasOtp, captchaFrame };
}

// the page's readable text and tables, for "read the page" (the caller masks numbers before anything leaves)
export function readScript() {
  const clean = (s) => String(s ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const tables = [...document.querySelectorAll("table, [role=grid], [role=table]")].slice(0, 6).map((t) => [...t.querySelectorAll("tr, [role=row]")].slice(0, 80)
    .map((r) => [...r.querySelectorAll("th, td, [role=columnheader], [role=gridcell], [role=cell]")].map((c) => clean(c.innerText).slice(0, 80))).filter((r) => r.length));
  return { url: location.href, title: document.title, text: clean(document.body?.innerText ?? "").slice(0, 12000), tables };
}
