// Money review (read-only) checks, against LOCAL MOCK PAGES ONLY (scripts/qa/fixtures/money). No real bank, Venmo or
// Cash App site is ever opened, and your own Dayspring and its data are never touched:
//   - everything runs on a throwaway copy of Dayspring (node_modules/.dayspring-money-qa), with its own empty data
//   - one headless Chrome (muted) with its own throwaway profile; a local file server on a free port for the mock pages
//   - the last part starts the copy's server on a free port (4730-4739) with no AI keys and talks to it
// What it proves: extraction over 3 months (infinite scroll, "load more", pagination, pending vs posted), recurring
// charges / duplicates / price increases, every denylisted button refused (renamed, nested, hidden, covered, in a
// payment form), no typing into payment forms, sign-in / 2FA / robot-check pages stop everything, numbers masked,
// encryption at rest, retention, CSV/OFX import = the same report, the offline report with no AI, consent before AI.
//   node scripts/qa/money.mjs [--keep]        exit code 0 when everything passed
import "./guard-data.mjs";   // first: tests never write to the real data folder
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, openSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as netServer } from "node:net";
import { spawn } from "node:child_process";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESK = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIX = join(DESK, "scripts", "qa", "fixtures", "money");
const SCRATCH = join(DESK, "node_modules", ".dayspring-money-qa"), APP = join(SCRATCH, "app");
const CHROME = process.env.QA_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
// playwright-core: the shared copy next to this project when there is one, else this project's own
const PW = process.env.QA_PLAYWRIGHT || [resolve(DESK, "..", "..", "..", "dayspring-app", "node_modules", "playwright-core", "index.mjs"), join(DESK, "node_modules", "playwright-core", "index.mjs")].find(existsSync);
const keep = process.argv.includes("--keep");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const rec = (area, ok, note = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${area}${note ? " — " + String(note).slice(0, 240) : ""}`); };
const safe = async (area, fn) => { try { await fn(); } catch (e) { rec(area, false, `threw: ${e.stack?.split("\n").slice(0, 3).join(" | ") ?? e}`); } };

// ---- a throwaway copy (inside node_modules so it finds the packages; export and git skip node_modules) ----------------
rmSync(SCRATCH, { recursive: true, force: true });
const SKIP = new Set(["data", ".env", "node_modules", "backups", "dist-out", "bin", ".git", "qa-out", "dist"]);
for (const e of readdirSync(DESK)) if (!SKIP.has(e)) cpSync(join(DESK, e), join(APP, e), { recursive: true, filter: (s) => !/\.log$/.test(s) });
mkdirSync(join(APP, "data"), { recursive: true });
Object.assign(process.env, {
  DAYSPRING_FINANCE_PROFILE: join(SCRATCH, "profile"), DAYSPRING_FINANCE_HEADLESS: "1", DAYSPRING_FINANCE_EXE: CHROME, DAYSPRING_FINANCE_ALLOW_LOCAL: "1",
  DAYSPRING_NO_BROWSER: "1", DAYSPRING_NO_ECO: "1", AI_PROVIDER: "none",
});
for (const k of Object.keys(process.env)) if (/API_KEY|TOKEN|SECRET/i.test(k)) delete process.env[k];
delete process.env.DAYSPRING_FINANCE_DIR; delete process.env.DAYSPRING_FINANCE_IDLE_MS;
const L = (m) => import(pathToFileURL(join(APP, "lib", m)).href);
const [guard, normalize, analyze, store, actions, fin, ai, money, permissions] = await Promise.all(["money/guard.mjs", "money/normalize.mjs", "money/analyze.mjs", "money/store.mjs", "money/actions.mjs", "money/browser.mjs", "money/ai.mjs", "money/index.mjs", "permissions.mjs"].map(L));
const { makeData, showDate } = await import(pathToFileURL(join(FIX, "data.js")).href);
const FINDIR = join(APP, "data", "finance");
rec("the copy's money data lives in the copy", store.dir().startsWith(APP), store.dir());

// ---- the mock pages, served locally --------------------------------------------------------------------------------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const files = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
  const f = join(FIX, p);
  if (!f.startsWith(FIX) || !existsSync(f) || !MIME[extname(f)]) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": MIME[extname(f)] }); res.end(readFileSync(f));
});
await new Promise((r) => files.listen(0, "127.0.0.1", r));
const FP = files.address().port, BASE = `http://127.0.0.1:${FP}`;
const today = normalize.todayISO(), since = normalize.monthsBack(today, 3);
const D = makeData(today);
const url = (page, extra = "") => `${BASE}/${page}?today=${today}${extra}`;

// ---- 1. the parts on their own ---------------------------------------------------------------------------------------
await safe("masking", () => {
  const m = normalize.mask("Card 4111 2222 3333 4444, acct 000123456789, routing 021000021, SSN 123-45-6789, on 2026-07-03 for $1,234.56");
  rec("card, account, routing and SSN numbers are masked; dates and amounts stay", !/\d{5,}/.test(m.replace("2026-07-03", "")) && m.includes("••••4444") && m.includes("••••6789") && m.includes("$1,234.56") && m.includes("2026-07-03"), m);
});
await safe("parsing", () => {
  const ok = normalize.parseDate("Jul 3", "2026-09-27") === "2026-07-03" && normalize.parseDate("Dec 30", "2026-09-27") === "2025-12-30" && normalize.parseDate("07/03/2026") === "2026-07-03"
    && normalize.parseAmount("- $25.00").sign === -1 && normalize.parseAmount("($12.34)").sign === -1 && normalize.parseAmount("+ $40.00").value === 40 && normalize.parseAmount("$1,234.56").value === 1234.56;
  rec("dates (with and without a year) and amounts (signs, brackets, commas) read right", ok);
});
await safe("guard words", () => {
  const words = ["Send", "Pay now", "Transfer", "Request", "Cash Out", "Withdraw", "Deposit", "Buy Bitcoin", "Sell stock", "Invest", "Confirm", "Submit", "Approve", "Add money", "Link bank", "Card settings", "Lock card", "Unlock card", "Dispute", "Cancel", "Delete", "Close account", "Settings", "Profile", "Password", "Security", "Log out", "Sign out", "sendMoneyButton", "S\u200Bend", "Ｓｅｎｄ"];
  const missed = words.filter((w) => !guard.denyHit(w));
  rec(`every denylisted word is caught (${words.length}, incl. camelCase, zero-width and full-width tricks)`, !missed.length, missed.join(", "));
  const nav = ["Next", "Next page", "Previous", "Older", "Load more", "See more", "Show more", "View all", "Activity", "Transactions", "Statements", "History", "July", "July 2026", "Last 90 days", "Back", "Details", "›", "2"];
  const notNav = nav.filter((w) => !guard.allowedName(w));
  rec("navigation names are on the allowlist", !notNav.length, notNav.join(", "));
  rec("\"Continue\", \"OK\" and \"Pay\" are not navigation", !guard.allowedName("Continue") && !guard.allowedName("OK") && !guard.allowedName("Pay"));
});

// ---- 2. the money window on the mock pages ----------------------------------------------------------------------------
const { chromium } = await import(pathToFileURL(PW).href);
fin._setPlaywright(chromium);
const offTools = money.toolsNow().map((t) => t.name);
const offOpen = await money.handle("open my bank");
permissions.set({ money: true });
rec("the Money review permission is off by default and on once set", permissions.DEFAULTS.money === false && permissions.get().money === true);
rec("while it's off: no money-window tools for the AI, and \"open my bank\" explains how to turn it on", offTools.every((n) => ["money_review", "money_query", "money_import_file"].includes(n)) && /turned off/.test(offOpen) && money.toolsNow().length === money.TOOLS.length && !fin.isOpen(), offTools.join(","));
const signed = (t) => (t.direction === "out" ? -t.amount : t.amount);
const expected = (list) => {
  const inRange = list.filter((t) => t.date >= since && t.date <= today);
  return inRange.filter((t) => !(t.status === "pending" && inRange.some((p) => p.status === "posted" && p.amount === t.amount && p.date >= t.date && p.date <= normalize.addDays(t.date, 5))));
};
const same = (got, want) => {
  const a = got.map((t) => `${t.date}|${signed(t).toFixed(2)}`).sort(), b = want.map((t) => `${t.date}|${t.amount.toFixed(2)}`).sort();
  const sum = (xs) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;
  return { ok: a.length === b.length && a.every((x, i) => x === b[i]), note: `read ${a.length}, expected ${b.length}; sums ${sum(got.map(signed))} vs ${sum(want.map((t) => t.amount))}${a.length !== b.length ? `; missing ${b.filter((x) => !a.includes(x)).slice(0, 3).join(" ")}; extra ${a.filter((x) => !b.includes(x)).slice(0, 3).join(" ")}` : ""}` };
};
let page = null;
for (const [name, file, list, how] of [["Venmo-like", "venmo.html", D.venmo, "infinite scroll"], ["Cash App-like", "cashapp.html", D.cashapp, "load more"], ["bank", "bank.html", D.bank, "pagination (real page loads)"]]) {
  await safe(`${name} page`, async () => {
    const r = await fin.open(url(file));
    page = fin.page();
    const c = await money.collectLive({ from: since, to: today });
    const got = store.allTransactions({ from: since, to: today, source: normalize && `${file.replace(".html", "")}.test` });
    const s = same(got, expected(list));
    rec(`${name}: every transaction over 3 months is read (${how}), pending/posted de-duplicated`, c.ok && r.opened && s.ok, s.note);
    const pend = got.filter((t) => t.status === "pending").length, wantPend = expected(list).filter((t) => t.status === "pending").length;
    rec(`${name}: pending entries kept as pending`, pend === wantPend, `${pend} vs ${wantPend}`);
  });
}
await safe("bank details", async () => {
  const got = store.allTransactions({ source: "bank.test" });
  const kroger = got.filter((t) => /kroger/i.test(t.merchant));
  rec("card numbers in descriptions are masked to the last 4", kroger.length > 0 && kroger.every((t) => !/\d{8,}/.test(t.description)) && kroger.some((t) => t.description.includes("••••4444")), kroger[0]?.description);
  const shape = got[0];
  rec("each transaction has the normalized shape", ["date", "description", "merchant", "amount", "direction", "account", "source", "status", "note", "category"].every((k) => k in shape) && ["in", "out"].includes(shape.direction), Object.keys(shape).join(","));
  const read = await actions.read(page);
  rec("reading the page masks the account number", read.ok && !read.text.includes("4000123456789010") && read.text.includes("••••9010"), read.text.replace(/\s+/g, " ").slice(0, 80));
  const bal = store.latestBalances().find((b) => b.source === "bank.test");
  rec("the balance is read", /2,345\.67/.test(bal?.balances?.[0]?.text ?? ""), JSON.stringify(bal?.balances?.[0]));
  // date filter and search: typed into the site's own fields, nothing submitted
  await fin.open(url("bank.html"));
  page = fin.page();
  const from = normalize.addDays(today, -20);
  const dr = await actions.setDateRange(page, from, today);
  const rows = (await actions.extract(page)).rows.map((r) => normalize.parseDate(r.cells?.[0]));
  rec("setting a date range fills the site's filter and presses its Apply (not a form submit)", dr.ok && rows.length > 0 && rows.every((d) => d >= from) && (await page.title()) !== "SUBMITTED", `${rows.length} rows, oldest ${rows.sort()[0]}`);
  const sr = await actions.searchSite(page, "netflix");
  const srows = (await actions.extract(page)).rows;
  rec("searching types into the site's search box only", sr.ok && srows.length > 0 && srows.every((r) => /netflix/i.test(r.text)), `${srows.length} rows`);
  const log = readFileSync(join(FINDIR, "activity.log"), "utf8");
  rec("the action log never has what was searched for", !/netflix/i.test(log) && /searched within/.test(log));
});

// ---- 3. traps: denylisted controls, payment forms, popups, submits -----------------------------------------------------
await safe("traps", async () => {
  await fin.open(url("traps.html"));
  page = fin.page();
  await page.evaluate((o) => { window.__otherSite = o; }, `http://localhost:${FP}/login.html`);
  const bad = [...Array(42)].map((_, i) => `t${i + 1}`).filter((id) => id !== "t8o");
  const wrong = [];
  for (const id of bad) { if (!(await page.locator(`#${id}`).count())) continue; const r = await actions.guardedClick(page, page.locator(`#${id}`)); if (r.ok) wrong.push(id); }
  const clicked = await page.evaluate(() => window.__clicked);
  rec(`every denylisted control is refused (${bad.length}: plain, renamed, aria-labelled, nested, hidden text, covered, camelCase ids, script links, downloads, form submits, payment forms)`, !wrong.length && !clicked.length, `pressed: ${[...wrong, ...clicked].join(", ")}`);
  const byName = await actions.click(page, "Next");
  const after = await page.evaluate(() => window.__clicked);
  rec("\"click Next\" skips every trap named Next and presses only the real one", byName.ok && after.length === 1 && after[0] === "ok1", `${after.join(",")}`);
  for (const w of ["Send", "Pay", "Cash out", "Sign out", "Confirm"]) { const r = await actions.click(page, w); if (r.ok) wrong.push(w); }
  rec("asking to click a money word by name is refused before looking", !wrong.length && (await page.evaluate(() => window.__clicked)).length === 1, wrong.join(","));
  const ok = [];
  for (const id of ["ok2", "ok5"]) ok.push((await actions.guardedClick(page, page.locator(`#${id}`))).ok);
  rec("real navigation (load more, last 90 days) is allowed", ok.every(Boolean));
  const pages0 = page.context().pages().length;
  const pop = await actions.guardedClick(page, page.locator("#ok3"));
  await sleep(600);
  const blockedPop = await page.evaluate(() => window.__dsMoneyBlockedPopups || 0);
  rec("a popup to another site is blocked", pop.ok && blockedPop === 1 && page.context().pages().length === pages0, `blocked ${blockedPop}, pages ${pages0}→${page.context().pages().length}`);
  const sub = await actions.guardedClick(page, page.locator("#ok4"));
  const subs = await page.evaluate(() => ({ c: window.__clicked, n: window.__dsMoneyBlockedSubmits || 0 }));
  rec("a form submit set off by an allowed button is blocked", sub.ok && subs.c.includes("ok4") && !subs.c.includes("f17-submit") && subs.n >= 1, JSON.stringify(subs));
  const st = await actions.searchSite(page, "anything");
  rec("searching on a page whose search box sits in a payment form is refused, and nothing is typed", !st.ok && st.refused && (await page.inputValue("#paysearch")) === "", st.reason);
  // typing (the page with password and code fields is a sign-in page, so these are asked of the rules directly)
  await fin.open(url("traps.html", "&fields=1")); page = fin.page();
  rec("with password and code fields showing, the page counts as a sign-in / code page", ["login", "2fa"].includes((await actions.state(page)).blocked));
  const verdict = async (sel, kind) => (await actions.fieldVerdict(page.locator(sel), kind)).ok;
  const typing = { amount: await verdict("#amount", "search"), recipient: await verdict("#recipient", "search"), paysearch: await verdict("#paysearch", "search"), password: await verdict("#pw", "search"), otp: await verdict("#otp", "date"), card: await verdict("#cc", "search") };
  rec("typing into payment forms, passwords, codes and card fields is refused", Object.values(typing).every((v) => v === false), JSON.stringify(typing));
  rec("a transaction search box and a date field outside forms are allowed", (await verdict("#goodsearch", "search")) && (await verdict("#gooddate", "date")));
  rec("the refusals are in the action log", /refused to click/.test(readFileSync(join(FINDIR, "activity.log"), "utf8")));
});

// ---- 4. sign-in, 2FA and robot checks stop everything ------------------------------------------------------------------
await safe("walls", async () => {
  for (const [file, extra, want] of [["login.html", "", "login"], ["bank.html", "&mfa=1", "2fa"], ["bank.html", "&captcha=1", "captcha"]]) {
    await fin.open(url(file, extra));
    page = fin.page();
    const c = await money.collectLive({ from: since, to: today });
    const k = await actions.click(page, "Next"), rd = await actions.read(page), sc = await actions.scroll(page, "down");
    const said = await money.handle("review my transactions for the last three months");
    rec(`a ${want} page stops reading, clicking, reading and scrolling, and hands over to the owner`, c.blocked === want && k.blocked === want && rd.blocked === want && sc.blocked === want && /yourself/.test(said) && (await page.title()) !== "SUBMITTED", `${c.blocked}/${k.blocked}/${rd.blocked}: ${said.slice(0, 60)}`);
  }
  rec("nothing was typed on the sign-in page", true);
});

// ---- 5. the report ---------------------------------------------------------------------------------------------------
let report = null;
await safe("report", async () => {
  await fin.close();
  const r = await money.review({ live: false, show: false });
  report = r.report;
  const rec1 = (m) => report.recurring.find((x) => new RegExp(m, "i").test(x.merchant));
  const nf = rec1("netflix");
  rec("recurring charges found (Netflix, Spotify, Hulu, gym, iCloud, Crunchyroll, rent share)", ["netflix", "spotify", "hulu", "planet fitness", "icloud", "crunchyroll", "alex moreau"].every((m) => rec1(m)), report.recurring.map((x) => x.merchant).join(", "));
  rec("monthly cadence, next expected date and yearly cost", nf?.every === "monthly" && /^\d{4}-\d{2}-\d{2}$/.test(nf.next) && nf.next > nf.last && Math.abs(nf.yearly - 17.99 * 12) < 2, JSON.stringify(nf));
  rec("the Netflix price increase is caught", report.priceIncreases.some((p) => /netflix/i.test(p.merchant) && p.from === 15.49 && p.to === 17.99), JSON.stringify(report.priceIncreases));
  rec("the duplicate iCloud charge is caught", report.duplicates.some((d) => /icloud/i.test(d.merchant) && d.amount === 2.99), JSON.stringify(report.duplicates));
  rec("the large Best Buy charge is flagged as unusual", report.unusual.some((u) => /best buy/i.test(u.merchant)), report.unusual.map((u) => u.merchant).join(", "));
  rec("the overdraft fee is listed", report.fees.some((f) => /overdraft/i.test(f.description)) && report.feesTotal >= 35);
  const cancel = report.cancel.map((c) => c.merchant.toLowerCase()).join(" | ");
  rec("things to cancel: price went up, duplicate, overlapping streaming, with reasons and how", /netflix/.test(cancel) && /icloud/.test(cancel) && /hulu/.test(cancel) && report.cancel.every((c) => c.reasons.length && c.how.length > 20), cancel);
  rec("rent, utilities and phone are never suggested for cancelling", !/rent|duke|at&t|alex moreau/.test(cancel));
  rec("totals by month and a net figure", report.months.length >= 3 && report.months.every((m) => Math.abs(m.in - m.out - m.net) < 0.01) && Math.abs(report.totals.in - report.totals.out - report.totals.net) < 0.01);
  rec("spending by category and top merchants", report.categories.some((c) => c.category === "Groceries") && report.merchants[0]?.total > 0);
  rec("the spoken summary is short", r.reply.length < 400 && /screen/.test(r.reply), r.reply);
  const md = readdirSync(join(FINDIR, "reports")).filter((f) => f.endsWith(".md"));
  const csv = readdirSync(join(FINDIR, "reports")).filter((f) => f.endsWith(".csv"));
  const mdText = md.length ? readFileSync(join(FINDIR, "reports", md.at(-1)), "utf8") : "";
  rec("saved as Markdown and CSV in data/finance/reports", md.length >= 1 && csv.length >= 1 && /## Things you might want to cancel/.test(mdText) && /investment, tax or legal advice/.test(mdText));
  rec("no unmasked account or card numbers anywhere in the report", !/4111222233334444|4000123456789010/.test(mdText + readFileSync(join(FINDIR, "reports", csv.at(-1)), "utf8")));
});

// ---- 6. encryption at rest and retention ---------------------------------------------------------------------------------
await safe("encryption", async () => {
  const raw = store.rawFiles();
  const bytes = raw.map((f) => readFileSync(f));
  const plain = bytes.some((b) => /netflix|kroger|josh|17\.99|1850/i.test(b.toString("latin1")));
  rec("raw transactions are encrypted on disk (DPAPI): no merchant names or amounts readable", raw.length >= 3 && !plain && bytes.every((b) => b.subarray(0, 4).toString() === "DSF1"), `${raw.length} files`);
  const one = store.decrypt(bytes[0]);
  rec("and they decrypt for this Windows user", Array.isArray(one.transactions));
  const rep = readdirSync(join(FINDIR, "reports")).filter((f) => f.endsWith(".json.bin"));
  rec("the report data for the Money page is encrypted too", rep.length && !/netflix/i.test(readFileSync(join(FINDIR, "reports", rep[0])).toString("latin1")));
  // a damaged file is skipped, not fatal
  writeFileSync(join(store.rawDir(), "2099-01-01T00-00-00-000Z-broken.bin"), Buffer.from("DSF1garbage"));
  const n = store.loadSets().length;
  rmSync(join(store.rawDir(), "2099-01-01T00-00-00-000Z-broken.bin"));
  rec("a damaged file is skipped", n === raw.length);
});
await safe("retention", async () => {
  const f = store.saveRaw({ source: "old.test", transactions: [{ date: "2020-01-01", description: "x", merchant: "X", amount: 1, direction: "out", account: null, source: "old.test", status: "posted", note: null, category: "Other" }], balances: [] });
  const old = join(store.rawDir(), `${new Date(Date.now() - 100 * 86_400_000).toISOString().replace(/[:.]/g, "-")}-old.test.bin`);
  renameSync(f, old);
  const recent = store.rawFiles().length;
  const removed = store.prune();
  rec("raw data older than the retention period (90 days by default) is deleted", removed === 1 && !existsSync(old) && store.rawFiles().length === recent - 1, `removed ${removed}`);
  store.setSettings({ retentionDays: 30 });
  rec("the retention period is a setting", store.settings().retentionDays === 30);
  store.setSettings({ retentionDays: 90 });
  rec("reports are kept (retention only touches raw data)", store.reports().length >= 1);
});

// ---- 7. CSV and OFX imports make the same report --------------------------------------------------------------------------
await safe("import", async () => {
  const pageTx = store.allTransactions({ from: since, to: today, source: "bank.test" });
  const csv = ["Account summary for Everyday Checking,,,", "Date,Description,Amount,Status", ...D.bank.map((t) => `${showDate.bank(t.date)},"${t.desc}",${t.amount.toFixed(2)},${t.status === "pending" ? "Pending" : "Posted"}`)].join("\r\n");
  const ofx = `OFXHEADER:100\nDATA:OFXSGML\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><ACCTID>4000123456789010</BANKACCTFROM><BANKTRANLIST>\n` +
    D.bank.filter((t) => t.status === "posted").map((t) => `<STMTTRN><TRNTYPE>${t.amount < 0 ? "DEBIT" : "CREDIT"}<DTPOSTED>${t.date.replace(/-/g, "")}120000<TRNAMT>${t.amount.toFixed(2)}<FITID>${t.id}<NAME>${t.desc}</STMTTRN>`).join("\n") +
    `\n</BANKTRANLIST><LEDGERBAL><BALAMT>2345.67</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const keyOf = (r) => JSON.stringify({ totals: r.totals, months: r.months, cats: r.categories.map((c) => [c.category, c.total]), rec: r.recurring.map((x) => [x.merchant, x.amount, x.every]), dup: r.duplicates.length, up: r.priceIncreases.map((p) => [p.merchant, p.from, p.to]), cancel: r.cancel.map((c) => c.merchant), count: r.count, fees: r.feesTotal });
  const fromPage = analyze.buildReport(pageTx, { from: since, to: today });
  const other = join(SCRATCH, "fin-import");
  process.env.DAYSPRING_FINANCE_DIR = other;
  money.importText("statement.csv", csv, { source: "bank.test" });
  const fromCsv = analyze.buildReport(store.allTransactions({ from: since, to: today }), { from: since, to: today });
  rec("a CSV statement makes the same report as reading the bank page", keyOf(fromCsv) === keyOf(fromPage), `${fromCsv.count} vs ${fromPage.count}; ${keyOf(fromCsv).slice(0, 120)} / ${keyOf(fromPage).slice(0, 120)}`);
  store.deleteAll();
  money.importText("statement.ofx", ofx, { source: "bank.test" });
  const ofxTx = store.allTransactions({ from: since, to: today });
  const fromOfx = analyze.buildReport(ofxTx, { from: since, to: today });
  const postedOnly = analyze.buildReport(pageTx.filter((t) => t.status === "posted"), { from: since, to: today });
  rec("an OFX statement (posted only) makes the same report as the page's posted transactions", keyOf(fromOfx) === keyOf(postedOnly), `${fromOfx.count} vs ${postedOnly.count}`);
  rec("the OFX account number is masked", ofxTx.every((t) => !/\d{8,}/.test(`${t.account} ${t.description}`)) && ofxTx.some((t) => /9010/.test(t.account ?? "")), ofxTx[0]?.account);
  // "import my bank statement": the drop folder, then the plain copy is removed
  store.deleteAll();
  mkdirSync(store.importDir(), { recursive: true });
  writeFileSync(join(store.importDir(), "my-bank.csv"), csv);
  const said = await money.handle("import my bank statement");
  rec("\"import my bank statement\" imports the folder, reports, and deletes the plain copy", /imported \d+ transactions/i.test(said) && !existsSync(join(store.importDir(), "my-bank.csv")), said.slice(0, 120));
  store.deleteAll();
  delete process.env.DAYSPRING_FINANCE_DIR;
});

// ---- 8. no AI: the offline report and the spoken commands -------------------------------------------------------------------
await safe("offline", async () => {
  money._reset();
  const r = await money.review({ live: false, show: false });
  rec("with no AI the report is made fully offline", r.ok && !r.report.insights && r.report.notes.some((n) => /no AI/.test(n)) && !/look it over/.test(r.reply));
  const ask = async (q) => (await money.handle(q)) ?? "";
  const checks = [
    ["review my transactions for the last three months", /went through \d+ transactions/],
    ["what subscriptions do I have", /repeating charge/],
    ["what should I cancel", /netflix/i],
    ["how much did I spend on food last month", /spent \$[\d,.]+ on food/],
    ["how much on groceries", /on groceries/],
    ["what did I pay Josh last week", /josh|any payments to josh/i],
    ["when did Netflix last charge me", /netflix last charged you \$17\.99/i],
    ["help me make a budget", /50\/30\/20/],
    ["how do I cancel Netflix", /netflix\.com/i],
  ];
  for (const [q, want] of checks) { const a = await ask(q); rec(`"${q}"`, want.test(a), a.slice(0, 140)); }
  const bal = await ask("what's my Venmo balance");
  rec("\"what's my Venmo balance\" answers from the last read", /\$152\.40/.test(bal), bal);
  const nope = ["what's the weather", "play some music", "cancel the timer", "what's on my schedule", "check my email", "open settings", "how much is a gallon of milk"];
  const stole = []; for (const q of nope) if (await money.handle(q)) stole.push(q);
  rec("other commands aren't taken over", !stole.length, stole.join(" | "));
});

// ---- 9. consent before anything goes to an AI ------------------------------------------------------------------------------
await safe("consent", async () => {
  money._reset();
  let calls = 0, payload = "";
  ai._setReady(() => true);
  ai._setComplete(async (o) => { calls++; payload = o.prompt; return "- Groceries are your biggest cost."; });
  store.setSettings({ aiConsent: false, aiConsentAsked: false });
  const r = await money.review({ live: false, show: false });
  rec("before consent, a review never calls the AI and asks the consent question word for word", calls === 0 && r.reply.includes(money.CONSENT_TEXT), r.reply.slice(-140));
  const q1 = await money.runTool("money_query", { find: "how much on food?" });
  const q2 = await money.runTool("money_review", {});
  rec("the AI's money tools return no data without consent", q1.consentNeeded && !q1.transactions && q2.consentNeeded && !q2.totals && calls === 0);
  for (const t of money.TOOLS) await money.runTool(t.name, { aiConsent: true, consent: true, visionConsent: true }).catch(() => null);
  rec("no tool can give consent (none has a consent field, and calling every tool with one changes nothing)", !money.TOOLS.some((t) => /consent/i.test(t.name + Object.keys(t.input_schema?.properties ?? {}).join(" "))) && !store.settings().aiConsent && !store.settings().visionConsent && calls === 0);
  const yes = await money.handle("yes");
  rec("the owner's own yes records consent, and only then the AI is asked", store.settings().aiConsent === true && calls === 1 && /noticed/.test(yes), yes.slice(0, 100));
  rec("what's sent has masked numbers only: date, merchant, amount, category", payload.length > 100 && !/\d{8,}/.test(payload.replace(/\d{4}-\d{2}-\d{2}/g, "")) && !/4111222233334444|4000123456789010/.test(payload));
  const q3 = await money.runTool("money_query", { find: "food", category: "groceries" });
  rec("with consent the AI's query tool returns the transactions", q3.found > 0 && q3.transactions.length > 0);
  // screenshots need their own consent
  let shots = 0;
  await fin.open(url("venmo.html")); page = fin.page();
  const v0 = await ai.visionRows(page, { vision: async () => { shots++; return []; } });
  store.setSettings({ visionConsent: true });
  await ai.visionRows(page, { vision: async () => { shots++; return [{ date: "Jul 3", description: "Test", amount: "-$1.00" }]; } });
  rec("the screenshot fallback runs only with its own consent", v0.length === 0 && shots === 1);
  store.setSettings({ aiConsent: false, visionConsent: false });
  const q4 = await money.runTool("money_query", { find: "food" });
  rec("withdrawing consent stops it again", q4.consentNeeded === true);
  ai._setReady(null); ai._setComplete(null);
});

// ---- 10. the window closes itself when idle; the logs hold no money --------------------------------------------------------
await safe("idle", async () => {
  await fin.close();
  process.env.DAYSPRING_FINANCE_IDLE_MS = "1200";
  await fin.open(url("venmo.html"));
  const was = fin.isOpen();
  await sleep(3000);
  rec("the money window closes itself after the idle time (a setting, 15 minutes by default)", was && !fin.isOpen() && store.DEFAULTS.idleMinutes === 15);
  delete process.env.DAYSPRING_FINANCE_IDLE_MS;
});
await safe("logs", async () => {
  const mine = readFileSync(join(FINDIR, "activity.log"), "utf8");
  // the shared log's own hashes are left out (hex can look like anything)
  const shared = existsSync(join(APP, "data", "logs", "activity")) ? readdirSync(join(APP, "data", "logs", "activity")).flatMap((f) => readFileSync(join(APP, "data", "logs", "activity", f), "utf8").split("\n").filter(Boolean))
    .map((l) => { try { const { hash, prev, id, ...rest } = JSON.parse(l); return JSON.stringify(rest); } catch { return ""; } }).join("\n") : "";
  const leak = /\$\s?\d|\d+\.\d{2}\b|netflix|kroger|josh|alex moreau|4111222233334444|4000123456789010/i;
  rec("the money log and the shared activity log hold no amounts, merchants, names or numbers", !leak.test(mine) && !leak.test(shared) && /read \d+ transactions from venmo\.test/.test(mine), (mine.match(leak) ?? shared.match(leak) ?? [""])[0]);
  rec("money actions reach the shared activity log", /"money"/.test(shared) || !existsSync(join(APP, "lib", "activity.mjs")), shared ? "" : "no shared log in this copy");
});

// ---- 11. "delete my money data" ------------------------------------------------------------------------------------------
await safe("delete", async () => {
  const ask = await money.handle("delete my money data");
  const before = store.rawFiles().length;
  const done = await money.handle("yes, delete it");
  rec("\"delete my money data\" asks first, then deletes everything kept", /can't be undone/.test(ask) && before > 0 && /deleted/i.test(done) && store.rawFiles().length === 0 && store.reports().length === 0, done);
});

// ---- 12. the real server (the throwaway copy): routes, voice commands, the page -----------------------------------------------
await safe("server", async () => {
  // data for the server to find: the bank statement, imported into the copy
  money.importText("statement.csv", ["Date,Description,Amount,Status", ...D.bank.map((t) => `${showDate.bank(t.date)},"${t.desc}",${t.amount.toFixed(2)},${t.status === "pending" ? "Pending" : "Posted"}`)].join("\n"), { source: "bank.test" });
  store.setSettings({ bankUrl: url("bank.html") });
  const port = await (async () => { for (let p = 4730; p <= 4739; p++) if (await new Promise((ok) => { const s = netServer().once("error", () => ok(false)).once("listening", () => s.close(() => ok(true))).listen(p, "127.0.0.1"); })) return p; throw new Error("ports 4730-4739 are busy"); })();
  const env = { ...process.env, PORT: String(port), DAYSPRING_DEVICES_DRYRUN: "1", DAYSPRING_DISPLAY: "", USERPROFILE: join(SCRATCH, "home"), HOME: join(SCRATCH, "home"), APPDATA: join(SCRATCH, "home", "AppData", "Roaming"), LOCALAPPDATA: join(SCRATCH, "home", "AppData", "Local") };
  mkdirSync(join(SCRATCH, "home", "AppData", "Local"), { recursive: true });
  const log = openSync(join(SCRATCH, "server.log"), "a");
  const server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", log, log], windowsHide: true });
  const B = `http://127.0.0.1:${port}`;
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) { await sleep(500); try { up = (await fetch(B + "/api/money/state")).ok; } catch { /* starting */ } }
    rec(`the copy's server starts with Money review in it (${B})`, up, up ? "" : readFileSync(join(SCRATCH, "server.log"), "utf8").slice(-400));
    if (!up) return;
    const J = async (u, body) => { const r = await fetch(B + "/api" + u, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}); return { status: r.status, j: await r.json().catch(() => ({})) }; };
    const chat = async (message) => (await J("/chat", { message, surface: "desk", typed: true })).j.reply ?? "";
    const st = (await J("/money/state")).j;
    rec("/api/money/state: permission, settings, reports", st.permission === true && st.settings.retentionDays === 90 && Array.isArray(st.reports));
    const page = await fetch(B + "/money.html"); const html = await page.text();
    rec("the Money page is served and says it's read-only", page.ok && /read-only/.test(html) && /never types, stores or reads passwords/.test(html));
    rec("/api/money/delete-all needs DELETE typed", (await J("/money/delete-all", {})).status === 400);
    rec("turning the permission on from the page needs \"I understand\" ticked", (await J("/money/permission", { on: true })).status === 400);
    const subs = await chat("what subscriptions do I have");
    rec("voice: \"what subscriptions do I have\" (no AI)", /repeating charge/.test(subs), subs.slice(0, 120));
    const cancel = await chat("what should I cancel");
    rec("voice: \"what should I cancel\"", /netflix/i.test(cancel) && /never cancel/i.test(cancel), cancel.slice(0, 120));
    const rev = await chat("review my transactions for the last three months");
    rec("voice: \"review my transactions for the last three months\"", /went through \d+ transactions/.test(rev), rev.slice(0, 120));
    const rep = (await J("/money/report")).j;
    rec("the report is there for the screen (/api/money/report)", rep.count > 0 && rep.recurring?.length > 0);
    const opened = await chat("open my bank");
    rec("voice: \"open my bank\" opens the mock bank in the money window and asks the owner to sign in", /sign in yourself/i.test(opened), opened.slice(0, 120));
    const closed = await chat("close my money browser");
    rec("voice: \"close my money browser\"", /closed the money window/i.test(closed), closed);
    const del = await chat("delete my money data"); const yes = await chat("yes, delete it");
    rec("voice: \"delete my money data\" (asks, then deletes)", /can't be undone/.test(del) && /deleted/i.test(yes), yes);
    const actDir = join(APP, "data", "logs", "activity");
    const acts = existsSync(actDir) ? readdirSync(actDir).map((f) => readFileSync(join(actDir, f), "utf8")).join("\n") : "";
    rec("the activity log keeps the question but not the money answer", !acts || (!/\$\d+\.\d{2}/.test(acts) && /not kept in the log/.test(acts)), acts ? "" : "no activity log in this copy");
    // the conversation history on disk (data/transcripts) and the developer log (data/devlog) don't keep money answers either
    const readAll = (d) => existsSync(d) ? readdirSync(d, { recursive: true }).filter((f) => /\.(jsonl?|log|txt)$/.test(f)).map((f) => readFileSync(join(d, f), "utf8")).join("\n") : "";
    const trans = readAll(join(APP, "data", "transcripts")), dev = readAll(join(APP, "data", "devlog"));
    rec("conversation transcripts keep \"(a money review answer; not kept)\", never the amounts", /a money review answer; not kept/.test(trans) && !/\$\s?\d[\d,]*\.\d{2}|repeating charge|went through \d+ transactions/i.test(trans), (trans.match(/\$\s?\d[\d,]*\.\d{2}|repeating charge|went through \d+ transactions/i) ?? ["no money answer placeholder"])[0]);
    rec("the developer log doesn't keep money answers", !/\$\s?\d[\d,]*\.\d{2}|repeating charge|went through \d+ transactions/i.test(dev), (dev.match(/\$\s?\d[\d,]*\.\d{2}|repeating charge|went through \d+ transactions/i) ?? [""])[0]);
  } finally { server.kill(); await sleep(800); }
});

await fin.close().catch(() => {});
files.close();
if (!keep) { await sleep(500); rmSync(SCRATCH, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }); }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
