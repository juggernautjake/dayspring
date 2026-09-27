// Money review: importing a statement the owner downloaded themselves (the most reliable way; offered first).
//
//   parseStatement(text, { name, source, today }) → { source, format, transactions, balances }
//     CSV from most banks and card sites (Date / Description / Amount, or Debit + Credit columns), Venmo's and
//     Cash App's statement CSVs, and OFX / QFX / QBO (Quicken and Money downloads).
// Account numbers are masked on the way in; nothing is sent anywhere.
import { fromRow, mask, todayISO } from "./normalize.mjs";

// ---- CSV ------------------------------------------------------------------------------------------------------------
export function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  const s = String(text ?? "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x));
}

const pick = (headers, names) => { for (const n of names) { const i = headers.findIndex((h) => h === n); if (i >= 0) return i; } for (const n of names) { const i = headers.findIndex((h) => h.includes(n)); if (i >= 0) return i; } return -1; };

function csvTransactions(text, { source, today }) {
  const rows = parseCSV(text);
  // the header is the first row naming a date and an amount (Bank of America and Venmo put summary lines above it)
  const hi = rows.findIndex((r) => { const h = r.map((x) => x.toLowerCase()); return h.some((x) => /date|datetime/.test(x)) && h.some((x) => /amount|debit|credit|withdraw|deposit/.test(x)); });
  if (hi < 0) throw new Error("I couldn't find the column names (a Date and an Amount column) in that file.");
  const H = rows[hi].map((x) => x.toLowerCase());
  const venmo = H.includes("from") && H.includes("to") && H.some((h) => h.startsWith("amount (total)") || h === "amount (total)") || (H.includes("datetime") && H.includes("note") && H.includes("from"));
  const cashapp = H.some((h) => h.includes("name of sender/receiver"));
  const site = venmo ? "venmo" : cashapp ? "cashapp" : "bank";
  const col = {
    date: pick(H, ["transaction date", "date", "datetime", "posting date", "posted date", "trans. date", "trans date"]),
    desc: pick(H, ["description", "payee", "merchant", "name", "transaction description", "original description", "details"]),
    amount: pick(H, ["amount (total)", "amount", "net amount", "transaction amount"]),
    debit: pick(H, ["debit", "withdrawal", "withdrawals", "money out", "charge"]),
    credit: pick(H, ["credit", "deposit", "deposits", "money in"]),
    status: pick(H, ["status"]), category: pick(H, ["category"]), account: pick(H, ["card no.", "card number", "account", "account number"]),
    note: pick(H, ["note", "notes", "memo"]), type: pick(H, ["type", "transaction type"]), from: H.indexOf("from"), to: H.indexOf("to"), who: H.findIndex((h) => h.includes("name of sender/receiver")),
  };
  if (col.date < 0 || (col.amount < 0 && col.debit < 0 && col.credit < 0)) throw new Error("That file needs a date column and an amount (or debit/credit) column.");
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const at = (i) => (i >= 0 ? r[i] ?? "" : "");
    if (!at(col.date) || /^(total|ending|beginning|opening|closing)\b/i.test(at(col.date))) continue;
    let description = at(col.desc);
    const amountText = at(col.amount);
    if (venmo) {
      const neg = /^\s*[-−]/.test(amountText) || /^\s*-\s*\$/.test(amountText);
      const type = at(col.type).toLowerCase();
      if (/transfer/.test(type)) description = `${at(col.type)} to bank`;
      else if (/charge/.test(type)) description = neg ? `${at(col.to) || at(col.from)} charged you` : `You charged ${at(col.to)}`;
      else description = neg ? `You paid ${at(col.to)}` : `${at(col.from)} paid you`;
    } else if (cashapp && !description) description = `${at(col.type)} ${at(col.who)}`.trim();
    const cells = [at(col.date), description, amountText, at(col.debit), at(col.credit), at(col.status), at(col.category), at(col.account), at(col.note)];
    const t = fromRow({ cells, headers: ["date", "description", "amount", "debit", "credit", "status", "category", "account", "note"], text: description, conf: 0.95, note: at(col.note), account: at(col.account),
      status: /pending|processing|authoriz/i.test(at(col.status)) ? "pending" : "posted" }, { site, source, today });
    if (t) out.push(t);
  }
  return { transactions: out, site };
}

// ---- OFX / QFX ------------------------------------------------------------------------------------------------------
const tag = (block, name) => { const m = new RegExp(`<${name}>([^<\\r\\n]*)`, "i").exec(block); return m ? m[1].trim() : ""; };
function ofxTransactions(text, { source, today }) {
  const acct = tag(text, "ACCTID");
  const out = [];
  for (const m of String(text).matchAll(/<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/BANKTRANLIST>))/gi)) {
    const b = m[1];
    const d = tag(b, "DTPOSTED") || tag(b, "DTUSER");
    const date = /^\d{8}/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : "";
    const amt = tag(b, "TRNAMT");
    const name = tag(b, "NAME") || tag(b, "PAYEE"), memo = tag(b, "MEMO");
    const t = fromRow({ cells: [date, name || memo, amt, "", "", "", "", acct ? `account ••••${acct.replace(/\D/g, "").slice(-4)}` : "", name ? memo : ""], headers: ["date", "description", "amount", "debit", "credit", "status", "category", "account", "note"],
      text: name, conf: 0.95, note: name ? memo : "", account: acct ? `account ••••${acct.replace(/\D/g, "").slice(-4)}` : "" }, { site: "bank", source, today });
    if (t) out.push(t);
  }
  const bal = tag(text, "BALAMT");
  return { transactions: out, balances: bal ? [{ label: "ledger balance", text: `$${bal}` }] : [] };
}

export function parseStatement(text, { name = "", source = "", today = todayISO() } = {}) {
  const s = String(text ?? "");
  if (s.length > 20_000_000) throw new Error("That file is too big to import (over 20 MB).");
  const isOfx = /<OFX>|OFXHEADER|<STMTTRN>/i.test(s.slice(0, 4000)) || /\.(ofx|qfx|qbo)$/i.test(name);
  const base = String(name).replace(/\.[a-z]+$/i, "").toLowerCase();
  const guess = /venmo/.test(base) ? "venmo.com" : /cash ?app|cashapp/.test(base) ? "cash.app" : "";
  if (isOfx) {
    const org = tag(s, "ORG");
    const src = source || (org ? org.toLowerCase().replace(/[^a-z0-9.]+/g, "-") : guess || "bank-statement");
    const r = ofxTransactions(s, { source: src, today });
    return { source: src, format: "ofx", ...r, balances: r.balances.map((b) => ({ ...b, text: mask(b.text) })) };
  }
  const probe = csvTransactions(s, { source: source || "import", today });
  const src = source || (probe.site === "venmo" ? "venmo.com" : probe.site === "cashapp" ? "cash.app" : guess || "bank-statement");
  const tx = probe.transactions.map((t) => ({ ...t, source: src }));
  return { source: src, format: "csv", transactions: tx, balances: [] };
}
