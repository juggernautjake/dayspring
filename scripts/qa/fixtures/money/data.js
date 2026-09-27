// Made-up money data for the Money review tests (scripts/qa/money.mjs). Nothing here is real: invented people,
// ordinary merchants, fake account numbers. Dates are counted back from "today", so there are always four months.
// Used by the mock pages in this folder (as an ES module in the browser) and by the test in Node.
//   makeData(todayISO) → { bank: [...], venmo: [...], cashapp: [...], balances }
// Each item: { id, date, desc, amount (signed: - is money out), status: "posted"|"pending", note }

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const back = (today, days) => { const [y, m, d] = today.split("-").map(Number); return iso(new Date(y, m - 1, d - days)); };
// the same day-of-month in each of the last n months (skipping ones in the future)
function monthly(today, day, n) {
  const [y, m, d] = today.split("-").map(Number);
  const out = [];
  for (let i = n; i >= 0; i--) { const dt = new Date(y, m - 1 - i, day); if (iso(dt) <= today) out.push(iso(dt)); }
  return out;
}
// a small deterministic random
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export function makeData(today) {
  const r = rng(42);
  const bank = [];
  let id = 1;
  const add = (list, date, desc, amount, extra = {}) => list.push({ id: `${list === bank ? "b" : list.tag}${id++}`, date, desc, amount: Math.round(amount * 100) / 100, status: "posted", note: "", ...extra });
  // income every two weeks
  for (let d = 4; d <= 125; d += 14) add(bank, back(today, d), "PAYROLL ACME CORP DIRECT DEP", 1850);
  // bills
  for (const dt of monthly(today, 1, 4)) add(bank, dt, "RENT - OAK APARTMENTS", -1200);
  const nf = monthly(today, 12, 4);
  nf.forEach((dt, i) => add(bank, dt, "NETFLIX.COM", i < nf.length - 2 ? -15.49 : -17.99));             // price went up
  for (const dt of monthly(today, 5, 4)) add(bank, dt, "SPOTIFY USA", -11.99);
  for (const dt of monthly(today, 20, 4)) add(bank, dt, "HULU 877-8244858 CA", -7.99);
  for (const dt of monthly(today, 17, 4)) add(bank, dt, "PLANET FITNESS CLUB FEES", -24.99);
  const ic = monthly(today, 8, 4);
  ic.forEach((dt, i) => { add(bank, dt, "APPLE.COM/BILL ICLOUD", -2.99); if (i === ic.length - 2) add(bank, dt, "APPLE.COM/BILL ICLOUD", -2.99); });   // charged twice once
  for (const dt of monthly(today, 22, 4)) add(bank, dt, "DUKE ENERGY PAYMENT", -(90 + Math.round(r() * 50)));
  for (const dt of monthly(today, 15, 4)) add(bank, dt, "AT&T WIRELESS", -65);
  // everyday spending
  for (let d = 2; d <= 125; d += 7) add(bank, back(today, d), "POS PURCHASE CARD 4111222233334444 KROGER #412", -(60 + Math.round(r() * 6000) / 100));
  for (let d = 3; d <= 125; d += 10) add(bank, back(today, d), "SHELL OIL 57444", -(40 + Math.round(r() * 1500) / 100));
  for (let d = 6; d <= 125; d += 16) add(bank, back(today, d), "STARBUCKS STORE 1234", -(5 + Math.round(r() * 300) / 100));
  for (let d = 9; d <= 125; d += 21) add(bank, back(today, d), "AMZN Mktp US", -(20 + Math.round(r() * 4000) / 100));
  add(bank, back(today, 33), "BEST BUY 00012", -899.99);                                       // unusual
  add(bank, back(today, 47), "OVERDRAFT FEE", -35);                                           // a fee
  // a card hold that has since posted (same amount, later date), and one still pending
  add(bank, back(today, 3), "KROGER #412 PENDING", -54.21, { status: "pending" });
  add(bank, back(today, 1), "POS PURCHASE CARD 4111222233334444 KROGER #412", -54.21);
  add(bank, back(today, 0), "CHIPOTLE 2231", -13.45, { status: "pending" });
  bank.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const venmo = []; venmo.tag = "v";
  for (const dt of monthly(today, 2, 4)) add(venmo, dt, "You paid Alex Kim", -600, { note: "Rent share" });
  for (let d = 5; d <= 120; d += 19) add(venmo, back(today, d), "You paid Josh Rivera", -(12 + Math.round(r() * 30)), { note: "Pizza night" });
  for (let d = 11; d <= 120; d += 30) add(venmo, back(today, d), "Sam Lee paid you", 40, { note: "Concert tickets" });
  for (let d = 15; d <= 120; d += 45) add(venmo, back(today, d), "Standard transfer to bank", -100);
  add(venmo, back(today, 0), "You paid Jordan Park", -18, { status: "pending", note: "Lunch" });
  venmo.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const cashapp = []; cashapp.tag = "c";
  for (let d = 1; d <= 120; d += 6) add(cashapp, back(today, d), "Cash Card · McDonald's", -(6 + Math.round(r() * 900) / 100));
  for (let d = 8; d <= 120; d += 25) add(cashapp, back(today, d), "Received from Taylor Brooks", 25);
  for (let d = 12; d <= 120; d += 40) add(cashapp, back(today, d), "Cash Out to bank", -50);
  for (const dt of monthly(today, 9, 4)) add(cashapp, dt, "Cash Card · Crunchyroll", -7.99);
  add(cashapp, back(today, 4), "Cash Card · Walgreens", -23.5, { status: "pending" });
  add(cashapp, back(today, 2), "Cash Card · Walgreens", -23.5);
  cashapp.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return { bank, venmo, cashapp, balances: { bank: 2345.67, venmo: 152.4, cashapp: 88.1 } };
}

// how the pages show a date: Venmo "Jul 3", Cash App "Jul 3, 2026", the bank "07/03/2026"
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const showDate = {
  venmo: (d) => `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`,
  cashapp: (d) => `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`,
  bank: (d) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`,
};
export const money = (n) => `${n < 0 ? "-" : "+"}$${Math.abs(n).toFixed(2)}`;
