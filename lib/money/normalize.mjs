// Money review: turning what a page (or a CSV/OFX file) shows into one shape, and keeping account numbers masked.
//
//   { id, date: "YYYY-MM-DD", description, merchant, amount (always positive), direction: "in"|"out", account, source,
//     status: "pending"|"posted", note, category, confidence }
//
//   mask(text)                 every long number (cards, accounts, routing) → "••••1234"
//   parseAmount(text)          → { value, sign } | null      parseDate(text, today) → "YYYY-MM-DD" | null
//   fromRow(row, ctx)          a row the page reader returned → a transaction (or null)
//   dedupe(list)               drops rows read twice and pending entries that have since posted
//   categorize(merchant, desc) → a category from the merchant keyword map (no AI needed)
import { SITES } from "./selectors.mjs";

// ---- masking ------------------------------------------------------------------------------------------------------
// 8+ digits, with or without spaces/dashes (cards, accounts, routing numbers) and SSN-shaped numbers → ••••last4.
// Money amounts ($1,234.56) and dates are left alone.
export function mask(text) {
  return String(text ?? "")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "•••-••-••••")
    .replace(/(?<![\d$.,])(?:\d[ -]?){7,}\d(?![\d.,]\d)/g, (m) => { if (/^\d{4}-\d{2}-\d{2}/.test(m.trim())) return m; const d = m.replace(/\D/g, ""); return d.length >= 8 ? `••••${d.slice(-4)}` : m; })
    .replace(/\b(?:x|X|\*{2,}|•{2,}|ending in |ending |acct\.? ?|account ?#? ?)(\d{4,})\b/g, (m, d) => m.replace(d, d.slice(-4)));
}
export const hasUnmasked = (s) => /(?<![\d$.,])(?:\d[ -]?){7,}\d(?![\d.,]\d)/.test(String(s ?? "").replace(/\b\d{4}-\d{2}-\d{2}\b/g, ""));

// ---- amounts ------------------------------------------------------------------------------------------------------
export function parseAmount(text) {
  const s = String(text ?? "").replace(/[−–]/g, "-");
  const m = /([-+]?)\s*(\()?\s*([-+]?)\s*\$?\s?(\d[\d,]*(?:\.\d{1,2})?)\s*(\))?\s*(USD)?/.exec(s.includes("$") ? s.slice(Math.max(0, s.indexOf("$") - 3)) : s);
  if (!m) return null;
  const value = Number(m[4].replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  const neg = m[1] === "-" || m[3] === "-" || (m[2] && m[5]);
  const pos = m[1] === "+" || m[3] === "+";
  return { value: Math.round(value * 100) / 100, sign: neg ? -1 : pos ? 1 : 0 };
}
// all the money amounts in a line of text (for rows read as plain text)
export const amountsIn = (text) => [...String(text ?? "").replace(/[−–]/g, "-").matchAll(/[-+]?\s?\(?\$\s?\d[\d,]*(?:\.\d{2})?\)?|[-+]?\b\d[\d,]*\.\d{2}\b/g)].map((m) => m[0]);

// ---- dates --------------------------------------------------------------------------------------------------------
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const todayISO = () => iso(new Date());
export function addDays(isoDate, n) { const [y, m, d] = isoDate.split("-").map(Number); return iso(new Date(y, m - 1, d + n)); }
export function monthsBack(isoDate, n) { const [y, m, d] = isoDate.split("-").map(Number); return iso(new Date(y, m - 1 - n, d)); }
export function parseDate(text, today = todayISO()) {
  const s = String(text ?? "").trim().toLowerCase();
  if (!s) return null;
  const [ty, tm, td] = today.split("-").map(Number);
  const base = new Date(ty, tm - 1, td);
  let m;
  if ((m = /\b(\d{4})-(\d{2})-(\d{2})/.exec(s))) return `${m[1]}-${m[2]}-${m[3]}`;
  if (/\btoday\b|\bjust now\b|\b\d{1,2}\s?(h|m|min|mins|hr|hrs|hours?|minutes?)\b( ago)?/.test(s) && !/\b\d{1,2}\s?(d|w)\b/.test(s)) return today;
  if (/\byesterday\b/.test(s)) return addDays(today, -1);
  if ((m = /\b(\d{1,3})\s?(?:d|days?)\b( ago)?/.exec(s)) && !/[a-z]{3,}\.? \d/.test(s)) return addDays(today, -Number(m[1]));
  if ((m = /\b(\d{1,2})\s?(?:w|wks?|weeks?)\b( ago)?/.exec(s))) return addDays(today, -7 * Number(m[1]));
  if ((m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(s))) {
    let y = m[3] ? Number(m[3]) : null; if (y !== null && y < 100) y += 2000;
    const mo = Number(m[1]) - 1, d = Number(m[2]);
    if (mo > 11 || d > 31) return null;
    return iso(y !== null ? new Date(y, mo, d) : nearestPast(base, mo, d));
  }
  if ((m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/.exec(s))) {
    const mo = MON[m[1]], d = Number(m[2]);
    return iso(m[3] ? new Date(Number(m[3]), mo, d) : nearestPast(base, mo, d));
  }
  if ((m = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?/.exec(s))) {
    const mo = MON[m[2]], d = Number(m[1]);
    return iso(m[3] ? new Date(Number(m[3]), mo, d) : nearestPast(base, mo, d));
  }
  return null;
}
// a date shown without a year: this year's, unless that is more than 2 days in the future (then last year's)
function nearestPast(base, mo, d) { const t = new Date(base.getFullYear(), mo, d); if (t - base > 2 * 86_400_000) t.setFullYear(t.getFullYear() - 1); return t; }

// ---- merchants and categories ---------------------------------------------------------------------------------------
const NOISE = /\b(pos|debit|credit|card|purchase|checkcard|chkcard|visa|mastercard|recurring|payment|pmt|ach|withdrawal|deposit|online|web|transfer|xfer|pending|authorized|autopay|bill|ppd|ccd|web id|id|ref|trace|des|indn|co id|electronic|preauthorized|dbt|crd|pur|sq|tst|pp|paypal|apple pay|google pay|contactless)\b\*?/gi;
export function merchantOf(desc) {
  let s = mask(String(desc ?? "")).replace(/••••\d{4}/g, " ").replace(/[*#]+/g, " ")
    .replace(/^\s*(cash card|card purchase|debit card|visa debit|visa|mastercard)\s*[·•:|-]\s*/i, "");   // "Cash Card · McDonald's"
  // P2P wording: "You paid Josh Smith", "Josh Smith paid you", "Payment to Sam", "Received from Alex", "Sent to Jordan"
  let m;
  if ((m = /\byou (?:paid|sent|charged) (.+?)(?:$| for | · |\s{2,})/i.exec(s))) return title(m[1]);
  if ((m = /^(.+?) (?:paid|sent|charged) you\b/i.exec(s))) return title(m[1]);
  if ((m = /\b(?:payment|sent|paid|transfer) to (.+?)(?:$| on | for |\s{2,})/i.exec(s))) return title(m[1]);
  if ((m = /\b(?:received|payment|transfer) from (.+?)(?:$| on | for |\s{2,})/i.exec(s))) return title(m[1]);
  s = s.replace(NOISE, " ").replace(/\b\d{2}\/\d{2}\b/g, " ").replace(/\b\d{3,}\b/g, " ")
    .replace(/\b(?:[A-Z]{2})\s*$/i, (x) => (/^(inc|llc|co)$/i.test(x.trim()) ? x : " "))          // a trailing state code
    .replace(/\s+(?:#?\d+|store \d+)\s*/gi, " ").replace(/\s+/g, " ").trim();
  // "NETFLIX.COM" → "Netflix", "AMZN Mktp US" → "Amazon"
  s = s.replace(/\.(com|net|org|co)\b/gi, "").replace(/\bamzn( mktp)?( us)?\b|\bamazon\.com\b/gi, "Amazon");
  return title(s.split(/\s{2,}| - | \| /)[0].slice(0, 40)) || "Unknown";
}
const title = (s) => String(s ?? "").trim().replace(/[.,;:]+$/, "").toLowerCase().replace(/(^|[\s/&(.-])([a-z])/g, (m, p, c) => p + c.toUpperCase()).replace(/\b(Llc|Inc|Usa|Us|Atm|Tv|Hbo)\b/g, (w) => w.toUpperCase());
export const merchantKey = (m) => String(m ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\b(the|inc|llc|co|com|us|usa)\b/g, " ").trim().split(/\s+/).slice(0, 2).join(" ");

// category ← merchant/description keywords (first match wins; order matters)
export const CATEGORIES = [
  ["Fees & interest", /\b(overdraft|nsf|insufficient funds|service charge|maintenance (fee|charge)|monthly (service |maintenance )?fee|interest charge|finance charge|late (fee|charge|payment fee)|atm fee|non-network atm|foreign transaction|returned item|annual fee|cash advance fee|wire fee|paper statement fee|interest paid)\b|^\s*(bank )?fees?\s*$/i],
  ["Income", /\b(payroll|salary|direct dep|paycheck|pay ?check|wages|employer|irs treas|tax refund|ssa|social security|unemployment|dividend|interest earned|cashback|cash back reward)\b/i],
  ["Subscriptions", /\b(netflix|hulu|disney|hbo|max\.com|\bmax\b|peacock|paramount|spotify|apple\.com\/bill|apple music|itunes|icloud|youtube premium|youtube tv|google one|google storage|google \*|amazon prime|prime video|audible|kindle unlimited|dropbox|microsoft 365|office 365|xbox game pass|playstation plus|ps plus|nintendo|adobe|canva|chatgpt|openai|anthropic|claude|patreon|siriusxm|sirius xm|pandora|tidal|crunchyroll|espn|sling|fubo|philo|discovery\+|starz|showtime|masterclass|duolingo|headspace|calm|nordvpn|expressvpn|norton|mcafee|onlyfans|substack|new york times|nytimes|wsj|washington post|ancestry|match\.com|bumble|tinder|hinge|onstar|ring|simplisafe|adt|peloton)\b/i],
  ["Gym & fitness", /\b(planet fitness|la fitness|anytime fitness|gold'?s gym|ymca|crunch fitness|orangetheory|gym|fitness|crossfit|yoga)\b/i],
  ["Groceries", /\b(kroger|walmart grocery|aldi|publix|safeway|albertsons|h-e-b|heb|meijer|food lion|giant eagle|wegmans|trader joe|whole foods|sprouts|costco|sam'?s club|hy-vee|winco|grocery|market|piggly|ingles|harris teeter|stop & shop|shoprite|food city|save a lot|instacart)\b/i],
  ["Dining & coffee", /\b(restaurant|mcdonald|burger|wendy|taco bell|chick-fil-a|chipotle|subway|starbucks|dunkin|coffee|cafe|pizza|domino|papa john|panera|sonic|arby|kfc|popeyes|dairy queen|grill|diner|bar & grill|doordash|uber eats|ubereats|grubhub|postmates|olive garden|applebee|chili'?s|ihop|denny|waffle house|cracker barrel|bojangles|zaxby|culver|whataburger|in-n-out|five guys|jimmy john|jersey mike|firehouse)\b/i],
  ["Gas & auto", /\b(shell|exxon|mobil|chevron|bp|marathon|speedway|sunoco|circle k|wawa|sheetz|quiktrip|qt|valero|citgo|phillips 66|casey'?s|murphy usa|pilot|love'?s|fuel|gas|autozone|o'?reilly|advance auto|jiffy lube|valvoline|car wash|dmv|parking|toll|ez ?pass)\b/i],
  ["Transport", /\b(uber|lyft|transit|metro|amtrak|greyhound|airline|delta|united|american air|southwest|spirit|frontier|jetblue)\b/i],
  ["Housing", /\b(rent|mortgage|apartments?|property management|hoa|landlord|realty|loan servicing)\b/i],
  ["Utilities", /\b(electric|energy|power|water|sewer|gas company|utility|utilities|duke energy|dominion|georgia power|pg&e|con ed|xcel|ameren|entergy|trash|waste management|republic services)\b/i],
  ["Phone & internet", /\b(verizon|at&t|att\b|t-mobile|tmobile|sprint|mint mobile|cricket|boost mobile|visible|comcast|xfinity|spectrum|charter|cox|frontier comm|centurylink|lumen|starlink|google fi|metro by t-mobile|straight talk|tracfone|consumer cellular)\b/i],
  ["Insurance", /\b(insurance|geico|state farm|progressive|allstate|farmers|liberty mutual|nationwide|usaa ins|aflac|metlife|lemonade)\b/i],
  ["Health", /\b(pharmacy|cvs|walgreens|rite aid|doctor|dental|dentist|medical|clinic|hospital|health|vision|optometr|urgent care|labcorp|quest diag|copay)\b/i],
  ["Shopping", /\b(amazon|target|walmart|best buy|home depot|lowe'?s|ebay|etsy|temu|shein|wish|kohl'?s|macy'?s|tj ?maxx|marshalls|ross|old navy|gap|nike|dollar general|dollar tree|family dollar|five below|ikea|wayfair|hobby lobby|michaels|staples|office depot|apple store|gamestop)\b/i],
  ["Entertainment", /\b(movie|cinema|amc|regal|theater|theatre|steam|playstation|xbox|nintendo eshop|ticketmaster|stubhub|concert|bowling|arcade|golf)\b/i],
  ["Travel", /\b(hotel|motel|marriott|hilton|hyatt|airbnb|vrbo|expedia|booking\.com|priceline)\b/i],
  ["Giving", /\b(church|tithe|offering|donation|charity|ministry|ministries|red cross|salvation army|gofundme)\b/i],
  ["Education", /\b(tuition|school|college|university|udemy|coursera|textbook|student loan|navient|nelnet|sallie mae)\b/i],
  ["Pets", /\b(petsmart|petco|chewy|vet|veterinary|animal hospital)\b/i],
  ["Cash & ATM", /\b(atm|cash withdrawal|cash out|cashout)\b/i],
  ["Transfers", /\b(transfer|xfer|zelle|venmo|cash app|paypal|to savings|from savings|to checking|from checking|standard transfer|instant transfer|added to venmo|added cash|cash in)\b/i],
];
export function categorize(merchant, desc = "", { p2p = false } = {}) {
  const s = `${merchant} ${desc}`;
  for (const [cat, re] of CATEGORIES) if (re.test(s)) return cat;
  return p2p ? "People (P2P)" : "Other";
}

// ---- a row → a transaction ------------------------------------------------------------------------------------------
const HEAD = { date: /\b(date|posted|posting|trans(action)? date|when)\b/, desc: /\b(description|merchant|payee|details|name|transaction|memo|narrative)\b/, amount: /\bamount\b/,
  debit: /\b(debit|withdrawal|withdrawals|money out|charges?|spent|outflow)\b/, credit: /\b(credit|deposit|deposits|money in|payments? received|inflow)\b/, status: /\bstatus\b/, balance: /\bbalance\b/, category: /\bcategory\b/, account: /\baccount|card\b/, note: /\b(note|memo)\b/ };

export function fromRow(row, { site = "bank", source = "", today = todayISO() } = {}) {
  const S = SITES[site] ?? {};
  let date = null, desc = "", amountText = "", dir = null, note = row.note ?? "", account = row.account ?? "", siteCategory = "";
  // a table / grid row with headers: read the columns by name
  if (row.cells?.length && row.headers?.length) {
    const col = (re) => row.headers.findIndex((h) => re.test(h));
    const at = (i) => (i >= 0 ? row.cells[i] ?? "" : "");
    date = parseDate(at(col(HEAD.date)), today);
    desc = at(col(HEAD.desc));
    const debit = at(col(HEAD.debit)), credit = at(col(HEAD.credit)), amt = at(col(HEAD.amount));
    if (parseAmount(debit)?.value) { amountText = debit; dir = "out"; }
    else if (parseAmount(credit)?.value) { amountText = credit; dir = "in"; }
    else amountText = amt;
    if (col(HEAD.status) >= 0 && /pending|processing|authoriz/i.test(at(col(HEAD.status)))) row = { ...row, status: "pending" };
    if (col(HEAD.category) >= 0) siteCategory = at(col(HEAD.category));
    if (col(HEAD.account) >= 0) account = at(col(HEAD.account));
  } else if (row.cells?.length >= 3 && !row.headers) {
    // cells without headers: the first date-looking cell, the first amount-looking cell, the longest other cell
    const dateCell = row.cells.find((c) => parseDate(c, today));
    const amtCell = row.cells.find((c) => /\$|\d\.\d{2}\b/.test(c) && parseAmount(c));
    date = parseDate(dateCell, today); amountText = amtCell ?? "";
    desc = row.cells.filter((c) => c !== dateCell && c !== amtCell).sort((a, b) => b.length - a.length)[0] ?? "";
  }
  if (!date) date = parseDate(row.time, today) ?? parseDate(row.date, today) ?? parseDate(row.text, today);
  if (!amountText) amountText = row.amount || amountsIn(row.text)[0] || "";
  if (!desc) desc = row.description || String(row.text ?? "").replace(amountsIn(row.text)[0] ?? "", "").replace(row.date ?? "", "").replace(/\bpending\b/i, "").trim().slice(0, 120);
  const a = parseAmount(amountText);
  if (!date || !a || !a.value) return null;
  const words = `${desc} ${row.text ?? ""}`;
  if (!dir) {
    if (a.sign < 0) dir = "out";
    else if (a.sign > 0) dir = "in";
    else if (S.inWords?.test(words)) dir = "in";
    else if (S.outWords?.test(words)) dir = "out";
    else if (/\b(deposit|refund|credit|received|paid you|payroll|interest earned)\b/i.test(words)) dir = "in";
    else dir = "out";
  }
  const p2p = site === "venmo" || (site === "cashapp" && !/card|purchase/i.test(words));
  const merchant = merchantOf(desc);
  const category = /^(income|fees|interest)/i.test(siteCategory) ? (/fee|interest/i.test(siteCategory) ? "Fees & interest" : "Income") : categorize(merchant, desc, { p2p });
  const status = row.status === "pending" ? "pending" : "posted";
  return {
    date, description: mask(desc).slice(0, 160), merchant: mask(merchant), amount: a.value, direction: dir,
    account: mask(account).slice(0, 60) || null, source: source || site, status, note: mask(note).slice(0, 160) || null,
    category: dir === "in" && category !== "Transfers" && category !== "Fees & interest" && !p2p ? "Income" : category,
    confidence: Math.round((row.conf ?? 0.5) * 100) / 100, rowId: row.id || null,
  };
}

// ---- de-duplication -------------------------------------------------------------------------------------------------
export const fingerprint = (t) => `${t.source}|${t.date}|${t.direction}|${t.amount.toFixed(2)}|${merchantKey(t.merchant)}|${t.status}`;
// A pending entry is dropped when a posted one with the same amount and direction and a similar merchant turns up
// within 5 days after it (card holds often post a day or three later, sometimes under a slightly different name).
export function dedupe(list) {
  const posted = list.filter((t) => t.status === "posted");
  const used = new Set();
  const out = [];
  for (const t of list) {
    if (t.status !== "pending") { out.push(t); continue; }
    const k = merchantKey(t.merchant).split(" ")[0];
    const match = posted.find((p, i) => !used.has(i) && p.source === t.source && p.direction === t.direction && Math.abs(p.amount - t.amount) < 0.005
      && p.date >= t.date && p.date <= addDays(t.date, 5) && (merchantKey(p.merchant).split(" ")[0] === k || merchantKey(p.merchant).includes(k) || k.includes(merchantKey(p.merchant).split(" ")[0])));
    if (match) { used.add(posted.indexOf(match)); continue; }
    out.push(t);
  }
  return out.map((t, i) => ({ ...t, id: t.id ?? `t${i + 1}` })).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
