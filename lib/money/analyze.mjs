// Money review: the report, built entirely offline with plain rules (no AI needed).
//
//   buildReport(transactions, { from, to, sources, today }) → report
//     { from, to, count, sources, months: [{ month, in, out, net }], totals: { in, out, net }, categories: [{ category, total, count, share }],
//       merchants: [{ merchant, total, count }], recurring: [{ merchant, amount, interval, every, count, last, next, yearly, category, priceUp }],
//       priceIncreases, duplicates, unusual, fees, cancel: [{ merchant, reasons, yearly, how }], transactions, notes }
//   toMarkdown(report) · toCSV(transactions) · spokenSummary(report)
//   budget(report) → a simple 50/30/20 starting point from the owner's own months
import { merchantKey, addDays } from "./normalize.mjs";

const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const $ = money;
const r2 = (n) => Math.round(n * 100) / 100;
const dayNum = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86_400_000; };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

// Streaming, music and the like: two at once is an overlap worth a look
const OVERLAP = [
  ["video streaming", /\b(netflix|hulu|disney|hbo|\bmax\b|peacock|paramount|prime video|apple tv|youtube tv|sling|fubo|philo|starz|showtime|discovery|crunchyroll|espn)\b/i],
  ["music", /\b(spotify|apple music|youtube (premium|music)|amazon music|pandora|tidal|siriusxm|sirius xm)\b/i],
  ["cloud storage", /\b(icloud|google one|google storage|dropbox|onedrive|box\.com)\b/i],
  ["fitness", /\b(planet fitness|la fitness|anytime fitness|gold'?s gym|ymca|crunch|orangetheory|peloton|gym)\b/i],
  ["AI assistants", /\b(chatgpt|openai|anthropic|claude|gemini|copilot|perplexity)\b/i],
  ["security / VPN", /\b(nordvpn|expressvpn|surfshark|norton|mcafee|lifelock)\b/i],
];
const ESSENTIAL = /^(Housing|Utilities|Phone & internet|Insurance|Income|Transfers|Groceries|Health|Education)$/;

// How to cancel the common ones (Dayspring never cancels anything itself; the owner does it)
export const HOW_TO_CANCEL = [
  [/netflix/i, "Netflix: sign in at netflix.com, open Account, then Cancel Membership."],
  [/hulu/i, "Hulu: sign in at hulu.com, open Account, then Cancel under Your Subscription."],
  [/disney/i, "Disney+: sign in at disneyplus.com, open Account, choose the subscription, then Cancel."],
  [/\bmax\b|hbo/i, "Max: sign in at max.com, open Settings, Subscription, then Manage Subscription and Cancel."],
  [/peacock/i, "Peacock: sign in at peacocktv.com, open Account, Plans & Payment, then Change Plan or Cancel."],
  [/paramount/i, "Paramount+: sign in, open Account, then Cancel Subscription."],
  [/spotify/i, "Spotify: sign in at spotify.com/account, open Manage your plan, then Cancel."],
  [/youtube/i, "YouTube Premium or TV: go to youtube.com/paid_memberships, then Deactivate or Cancel."],
  [/apple|icloud|itunes/i, "Apple subscriptions: on an iPhone open Settings, tap your name, then Subscriptions; or reportaproblem.apple.com."],
  [/google/i, "Google subscriptions: open play.google.com, your profile, Payments & subscriptions, then Subscriptions."],
  [/amazon|prime|audible|kindle/i, "Amazon: sign in at amazon.com, open Account, Memberships & Subscriptions, then End membership."],
  [/microsoft|xbox|office|365/i, "Microsoft: sign in at account.microsoft.com, open Services & subscriptions, then Cancel."],
  [/adobe/i, "Adobe: sign in at account.adobe.com, open Plans, then Manage plan and Cancel."],
  [/planet fitness|gym|fitness|ymca/i, "Gyms often need a visit, a letter or a call. Check your membership agreement, and ask for written confirmation."],
  [/siriusxm|sirius/i, "SiriusXM: call them or use the online chat, and ask for written confirmation."],
  [/chatgpt|openai/i, "ChatGPT: sign in, open Settings, Subscription, then Cancel."],
  [/patreon/i, "Patreon: sign in, open Memberships, choose the creator, then Edit and Cancel."],
];
export const howToCancel = (m) => (HOW_TO_CANCEL.find(([re]) => re.test(m))?.[1]) ?? "Sign in to their website or app and look under Account, Billing or Subscription for Cancel. If you signed up through an app store, cancel there. If you can't find it, call them and ask for written confirmation; your bank can also tell you how to stop a recurring charge.";

// ---- recurring charges ----------------------------------------------------------------------------------------------
const CADENCES = [["weekly", 7, 2], ["every two weeks", 14, 3], ["monthly", 30.4, 5], ["every three months", 91, 12], ["yearly", 365, 25]];
function recurringFrom(outs) {
  const groups = new Map();
  for (const t of outs) { const k = merchantKey(t.merchant); if (!k || k === "unknown") continue; (groups.get(k) ?? groups.set(k, []).get(k)).push(t); }
  const found = [];
  for (const [key, list0] of groups) {
    const list = [...list0].sort((a, b) => (a.date < b.date ? -1 : 1));
    if (list.length < 2) continue;
    // one charge per cycle: a same-day or next-day repeat is a possible duplicate, not a new cycle
    const cycles = [];
    for (const t of list) { const prev = cycles.at(-1); if (prev && dayNum(t.date) - dayNum(prev.date) <= 3) continue; cycles.push(t); }
    if (cycles.length < 2) continue;
    const gaps = cycles.slice(1).map((t, i) => dayNum(t.date) - dayNum(cycles[i].date));
    const gap = median(gaps);
    const cad = CADENCES.find(([, d, tol]) => Math.abs(gap - d) <= tol && gaps.every((g) => Math.abs(g - d) <= tol * 1.6));
    if (!cad) continue;
    // amounts: similar (within 25%), or a clear step up (a price increase)
    const amts = cycles.map((t) => t.amount), med = median(amts);
    const similar = amts.every((a) => Math.abs(a - med) <= Math.max(1.5, med * 0.25));
    const steps = amts.slice(1).map((a, i) => a - amts[i]);
    const stepUp = !similar && steps.every((s) => s >= -0.01) && amts.at(-1) > amts[0];
    if (!similar && !stepUp) continue;
    // monthly with only two charges needs a subscription-looking merchant or identical amounts
    if (cycles.length === 2 && !(cycles[0].category === "Subscriptions" || Math.abs(amts[0] - amts[1]) < 0.01 || stepUp)) continue;
    const last = cycles.at(-1);
    // the latest step up anywhere in the run (15.49, 17.99, 17.99 is still a price increase)
    let priceUp = null;
    // only a fixed price that stepped up counts (a utility bill that goes up and down every month is not a price increase)
    const flat = (xs) => xs.every((a) => Math.abs(a - xs[0]) < 0.011);
    for (let i = 1; i < amts.length; i++) if (amts[i] - amts[i - 1] >= Math.max(0.5, amts[i - 1] * 0.01) && flat(amts.slice(0, i)) && flat(amts.slice(i))) priceUp = { from: r2(amts[i - 1]), to: r2(amts[i]), date: cycles[i].date };
    if (priceUp && last.amount < priceUp.to - 0.01) priceUp = null;          // it came back down
    found.push({ key, merchant: last.merchant, category: last.category, amount: r2(last.amount), every: cad[0], interval: cad[1], count: list.length,
      first: cycles[0].date, last: last.date, next: addDays(last.date, Math.round(cad[1])), yearly: r2(last.amount * (365 / cad[1])), priceUp, source: last.source });
  }
  return found.sort((a, b) => b.yearly - a.yearly);
}

export function buildReport(all, { from = null, to = null, sources = null, today = null } = {}) {
  const tx = all.filter((t) => (!from || t.date >= from) && (!to || t.date <= to)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const outs = tx.filter((t) => t.direction === "out"), ins = tx.filter((t) => t.direction === "in");
  const sum = (xs) => r2(xs.reduce((s, t) => s + t.amount, 0));
  // by month
  const mm = new Map();
  for (const t of tx) { const k = t.date.slice(0, 7); const m = mm.get(k) ?? mm.set(k, { month: k, in: 0, out: 0 }).get(k); m[t.direction] += t.amount; }
  const months = [...mm.values()].sort((a, b) => (a.month < b.month ? -1 : 1)).map((m) => ({ month: m.month, in: r2(m.in), out: r2(m.out), net: r2(m.in - m.out) }));
  // categories (money out)
  const cm = new Map();
  for (const t of outs) { const c = cm.get(t.category) ?? cm.set(t.category, { category: t.category, total: 0, count: 0 }).get(t.category); c.total += t.amount; c.count++; }
  const totalOut = sum(outs);
  const categories = [...cm.values()].map((c) => ({ ...c, total: r2(c.total), share: totalOut ? Math.round((c.total / totalOut) * 1000) / 10 : 0 })).sort((a, b) => b.total - a.total);
  // merchants
  const mer = new Map();
  for (const t of outs) { const k = merchantKey(t.merchant) || t.merchant; const m = mer.get(k) ?? mer.set(k, { merchant: t.merchant, total: 0, count: 0, category: t.category }).get(k); m.total += t.amount; m.count++; }
  const merchants = [...mer.values()].map((m) => ({ ...m, total: r2(m.total) })).sort((a, b) => b.total - a.total).slice(0, 15);
  // recurring and price increases
  const recurring = recurringFrom(outs);
  const recurringKeys = new Set(recurring.map((r) => r.key));
  const priceIncreases = recurring.filter((r) => r.priceUp).map((r) => ({ merchant: r.merchant, from: r.priceUp.from, to: r.priceUp.to, date: r.priceUp.date, yearlyExtra: r2((r.priceUp.to - r.priceUp.from) * (365 / r.interval)) }));
  // duplicates: same merchant and amount within a day, both posted (or both pending)
  const duplicates = [];
  const byKey = new Map();
  for (const t of [...outs].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const k = `${merchantKey(t.merchant)}|${t.amount.toFixed(2)}|${t.status}|${t.source}`;
    const prev = byKey.get(k);
    if (prev && dayNum(t.date) - dayNum(prev.date) <= 1 && t.amount >= 1) duplicates.push({ merchant: t.merchant, amount: t.amount, dates: [prev.date, t.date], source: t.source });
    byKey.set(k, t);
  }
  // unusual / large: much bigger than usual overall, or than this merchant's usual
  const outAmts = outs.map((t) => t.amount), medOut = median(outAmts);
  const sorted = [...outAmts].sort((a, b) => a - b), p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const unusual = [];
  for (const t of outs) {
    if (t.category === "Housing" || t.category === "Transfers" || recurringKeys.has(merchantKey(t.merchant))) continue;   // rent and regular bills aren't "unusual"
    const same = outs.filter((o) => merchantKey(o.merchant) === merchantKey(t.merchant) && o !== t).map((o) => o.amount);
    const usual = same.length >= 2 ? median(same) : null;
    const big = t.amount >= 100 && t.amount >= Math.max(3 * medOut, p95);
    const odd = usual && t.amount >= 2.5 * usual && t.amount - usual >= 25;
    if (big || odd) unusual.push({ date: t.date, merchant: t.merchant, amount: t.amount, why: odd ? `about ${Math.round(t.amount / usual)} times your usual ${money(usual)} there` : "much larger than your usual spending" });
  }
  unusual.sort((a, b) => b.amount - a.amount);
  const fees = outs.filter((t) => t.category === "Fees & interest").map((t) => ({ date: t.date, merchant: t.merchant, description: t.description, amount: t.amount }));
  // things you might want to cancel
  const cancel = [];
  const add = (r, reason) => { let c = cancel.find((x) => x.key === r.key); if (!c) { c = { key: r.key, merchant: r.merchant, amount: r.amount, every: r.every, yearly: r.yearly, reasons: [], how: howToCancel(r.merchant) }; cancel.push(c); } if (!c.reasons.includes(reason)) c.reasons.push(reason); };
  const subs = recurring.filter((r) => !ESSENTIAL.test(r.category));
  for (const r of subs) if (r.priceUp) add(r, `the price went up from ${money(r.priceUp.from)} to ${money(r.priceUp.to)}`);
  for (const d of duplicates) { const r = subs.find((x) => merchantKey(x.merchant) === merchantKey(d.merchant)); if (r) add(r, `charged twice around ${d.dates[1]} (possible duplicate)`); }
  for (const [what, re] of OVERLAP) { const hits = subs.filter((r) => re.test(r.merchant)); if (hits.length >= 2) for (const r of hits) add(r, `you pay for ${hits.length} ${what} services (${hits.map((h) => h.merchant).join(", ")})`); }
  for (const r of subs) {
    // unused-looking: a small repeating charge from a place you don't otherwise spend at
    const other = outs.filter((t) => merchantKey(t.merchant) === r.key && Math.abs(t.amount - r.amount) > Math.max(1, r.amount * 0.3)).length;
    if (r.category === "Subscriptions" && r.amount < 20 && !other) add(r, "a small repeating charge that's easy to forget; worth checking you still use it");
    if (r.category === "Gym & fitness") add(r, "a membership; worth checking how often you go");
  }
  cancel.sort((a, b) => b.reasons.length - a.reasons.length || b.yearly - a.yearly);
  const notes = [];
  const lowConf = tx.filter((t) => t.confidence < 0.5).length;
  if (lowConf) notes.push(`${lowConf} transaction(s) were read from plain page text and may be less exact.`);
  const pending = tx.filter((t) => t.status === "pending").length;
  if (pending) notes.push(`${pending} pending transaction(s) are included; amounts can still change.`);
  return {
    createdAt: new Date().toISOString(), from: from ?? tx.at(-1)?.date ?? null, to: to ?? tx[0]?.date ?? today, count: tx.length,
    sources: sources ?? [...new Set(tx.map((t) => t.source))], months, totals: { in: sum(ins), out: totalOut, net: r2(sum(ins) - totalOut) },
    categories, merchants, recurring: recurring.map(({ key, ...r }) => r), priceIncreases, duplicates, unusual: unusual.slice(0, 15), fees, feesTotal: sum(fees),
    cancel: cancel.map(({ key, ...c }) => c), transactions: tx, notes,
  };
}

// ---- words ----------------------------------------------------------------------------------------------------------
const monthName = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }); };
export function spokenSummary(r) {
  if (!r.count) return "I didn't find any transactions in that range.";
  const top = r.categories[0];
  const bits = [`I went through ${r.count} transactions. Money in: ${money(r.totals.in)}. Money out: ${money(r.totals.out)}.`];
  if (top) bits.push(`Your biggest category was ${top.category.toLowerCase()}, at ${money(top.total)}.`);
  if (r.recurring.length) bits.push(`I found ${r.recurring.length} repeating charge${r.recurring.length > 1 ? "s" : ""}, about ${money(r.recurring.reduce((s, x) => s + x.yearly, 0))} a year.`);
  if (r.cancel.length) bits.push(`${r.cancel.length} might be worth cancelling.`);
  bits.push("The full report is on the screen.");
  return bits.join(" ");
}

const esc = (s) => String(s ?? "").replace(/\|/g, "/").replace(/\n/g, " ");
export function toMarkdown(r) {
  const L = [];
  L.push(`# Money review: ${r.from ?? "?"} to ${r.to ?? "?"}`, "", `Made by Dayspring on ${r.createdAt.slice(0, 10)} from ${r.sources.join(", ") || "your data"}. Read-only: nothing was changed on any account. Account numbers are masked.`, "");
  L.push("## Summary", "", `- Transactions: ${r.count}`, `- Money in: ${money(r.totals.in)}`, `- Money out: ${money(r.totals.out)}`, `- Net: ${money(r.totals.net)}`, `- Fees and interest: ${money(r.feesTotal)}`, "");
  L.push("## By month", "", "| Month | In | Out | Net |", "|---|---:|---:|---:|", ...r.months.map((m) => `| ${monthName(m.month)} | ${money(m.in)} | ${money(m.out)} | ${money(m.net)} |`), "");
  L.push("## Spending by category", "", "| Category | Total | Share | Count |", "|---|---:|---:|---:|", ...r.categories.map((c) => `| ${c.category} | ${money(c.total)} | ${c.share}% | ${c.count} |`), "");
  L.push("## Top merchants", "", "| Merchant | Total | Count |", "|---|---:|---:|", ...r.merchants.map((m) => `| ${esc(m.merchant)} | ${money(m.total)} | ${m.count} |`), "");
  L.push("## Repeating charges and subscriptions", "");
  if (r.recurring.length) L.push("| Merchant | Amount | How often | Next expected | Per year |", "|---|---:|---|---|---:|", ...r.recurring.map((x) => `| ${esc(x.merchant)}${x.priceUp ? " (price went up)" : ""} | ${money(x.amount)} | ${x.every} | ${x.next} | ${money(x.yearly)} |`), "");
  else L.push("None found.", "");
  L.push("## Things you might want to cancel", "", "Dayspring never cancels anything itself. Here's why each one is listed and how you can cancel it.", "");
  if (r.cancel.length) for (const c of r.cancel) L.push(`- **${esc(c.merchant)}** (${money(c.amount)} ${c.every}, ${money(c.yearly)} a year): ${c.reasons.join("; ")}.`, `  - How: ${c.how}`);
  else L.push("Nothing stood out.");
  L.push("");
  L.push("## Price increases", "", ...(r.priceIncreases.length ? r.priceIncreases.map((p) => `- ${esc(p.merchant)}: ${money(p.from)} to ${money(p.to)} on ${p.date} (about ${money(p.yearlyExtra)} more a year)`) : ["None found."]), "");
  L.push("## Possible duplicate charges", "", ...(r.duplicates.length ? r.duplicates.map((d) => `- ${esc(d.merchant)}: ${money(d.amount)} on ${d.dates.join(" and ")}`) : ["None found."]), "");
  L.push("## Unusual or large charges", "", ...(r.unusual.length ? r.unusual.map((u) => `- ${u.date} ${esc(u.merchant)}: ${money(u.amount)} (${u.why})`) : ["None found."]), "");
  L.push("## Fees and interest", "", ...(r.fees.length ? r.fees.map((f) => `- ${f.date} ${esc(f.description || f.merchant)}: ${money(f.amount)}`) : ["None found."]), "");
  if (r.insights) L.push("## Notes from your AI", "", r.insights, "");
  if (r.notes.length) L.push("## About this report", "", ...r.notes.map((n) => `- ${n}`), "");
  L.push("## All transactions", "", "| Date | Description | Merchant | Amount | In/Out | Category | Status | Account |", "|---|---|---|---:|---|---|---|---|",
    ...r.transactions.map((t) => `| ${t.date} | ${esc(t.description)} | ${esc(t.merchant)} | ${money(t.amount)} | ${t.direction} | ${t.category} | ${t.status} | ${esc(t.account ?? t.source)} |`), "");
  L.push("_This is a summary to help you review your spending and budget. It isn't investment, tax or legal advice; for those, please talk to a qualified professional._", "");
  return L.join("\n");
}
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };
export function toCSV(tx) {
  const cols = ["date", "description", "merchant", "amount", "direction", "account", "source", "status", "note", "category"];
  return [cols.join(","), ...tx.map((t) => cols.map((c) => csvCell(c === "amount" ? t.amount.toFixed(2) : t[c])).join(","))].join("\r\n") + "\r\n";
}

// A simple starting budget: the owner's average monthly income, split 50/30/20, next to what they actually spent.
const NEEDS = /^(Housing|Utilities|Phone & internet|Insurance|Groceries|Health|Gas & auto|Transport|Education|Fees & interest)$/;
export function budget(r) {
  const n = Math.max(1, r.months.length);
  const income = r2(r.totals.in / n);
  const perMonth = (cats) => r2(r.categories.filter((c) => cats(c.category)).reduce((s, c) => s + c.total, 0) / n);
  const needs = perMonth((c) => NEEDS.test(c)), wants = perMonth((c) => !NEEDS.test(c) && c !== "Transfers" && c !== "Income");
  return { income, plan: { needs: r2(income * 0.5), wants: r2(income * 0.3), savings: r2(income * 0.2) }, actual: { needs, wants, left: r2(income - needs - wants) },
    text: income > 0
      ? `On average about ${money(income)} a month came in. A common starting point is 50/30/20: about ${money(income * 0.5)} for needs, ${money(income * 0.3)} for wants, and ${money(income * 0.2)} for savings or paying down debt. You averaged ${money(needs)} a month on needs and ${money(wants)} on wants.`
      : "I didn't see regular income in these transactions, so I can't size a budget from them. Tell me your monthly take-home pay and I'll lay one out." };
}
