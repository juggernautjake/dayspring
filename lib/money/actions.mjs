// Money review: the only things Dayspring can do on a money page. Each one checks the page first (a sign-in, 2FA or
// robot check stops everything), goes through the read-only rules in guard.mjs, and is written to the action log.
//
//   state(page)                        → { url, host, blocked: null|"login"|"2fa"|"captcha" }
//   read(page)                         → { host, title, text, tables }  (account and card numbers masked)
//   scroll(page, "down"|"up"|"bottom"|"top")
//   click(page, name)                  a navigation control or transaction row, found by its name
//   guardedClick(page, locator)        the same checks on one element (tests use it directly)
//   setDateRange(page, from, to)       fills the site's own date filter (YYYY-MM-DD)
//   searchSite(page, query)            types into the site's own transaction search box (never presses Enter)
//   back(page)
//   extract(page, site)                → { rows, balances, strategy, confidence }  (page reader output)
//   collect(page, { since, until, site, source, maxRounds }) → { transactions, balances, pages, rounds, reachedStart, blocked }
import { describeScript, judgeClick, judgeType, blockedState, BLOCKED_TEXT, APPLY_NAME, denyHit } from "./guard.mjs";
import { registryFor, extractScript, pageStateScript, readScript, siteFor } from "./selectors.mjs";
import { fromRow, mask, dedupe, todayISO } from "./normalize.mjs";
import * as activity from "./activity.mjs";

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "the page"; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Dayspring is "acting" while one of its own actions runs: form submits and popups to other sites are blocked then
// (the init script in browser.mjs), and the network guard refuses non-GET page loads.
let actingDepth = 0, lastAt = 0;
export const isActing = () => actingDepth > 0;
export const lastActivityAt = () => lastAt;          // the idle timer counts from the last thing done
async function acting(page, fn) {
  actingDepth++; lastAt = Date.now();
  await page.evaluate(() => { window.__dsMoneyActing = true; }).catch(() => {});
  try { return await fn(); }
  finally { actingDepth--; if (!actingDepth) await page.evaluate(() => { window.__dsMoneyActing = false; }).catch(() => {}); }
}

export async function state(page) {
  lastAt = Date.now();
  const s = await page.evaluate(pageStateScript).catch(() => ({ url: page.url(), title: "", text: "" }));
  return { url: s.url, host: hostOf(s.url), blocked: blockedState(s) };
}
async function stopIfBlocked(page, what) {
  const s = await state(page);
  if (s.blocked) { activity.log(`stopped before ${what} on ${s.host}: ${s.blocked} page`); return { ok: false, blocked: s.blocked, text: BLOCKED_TEXT[s.blocked] }; }
  return null;
}

export async function read(page) {
  const stop = await stopIfBlocked(page, "reading"); if (stop) return stop;
  const r = await page.evaluate(readScript);
  activity.log(`read the page on ${hostOf(r.url)}`);
  return { ok: true, host: hostOf(r.url), title: mask(r.title), text: mask(r.text), tables: r.tables.map((t) => t.map((row) => row.map(mask))) };
}

export async function scroll(page, dir = "down") {
  const stop = await stopIfBlocked(page, "scrolling"); if (stop) return stop;
  await page.evaluate((d) => {
    const el = document.scrollingElement || document.documentElement;
    if (d === "bottom") el.scrollTop = el.scrollHeight; else if (d === "top") el.scrollTop = 0;
    else el.scrollBy(0, (d === "up" ? -1 : 1) * Math.round(innerHeight * 0.85));
    // pages that scroll an inner list: scroll the biggest scrollable box too
    const boxes = [...document.querySelectorAll("main, [role=main], [role=feed], [role=list], div")].filter((b) => b.scrollHeight > b.clientHeight + 40 && /(auto|scroll)/.test(getComputedStyle(b).overflowY));
    const big = boxes.sort((a, b) => b.clientHeight - a.clientHeight)[0];
    if (big) { if (d === "bottom") big.scrollTop = big.scrollHeight; else if (d === "top") big.scrollTop = 0; else big.scrollBy(0, (d === "up" ? -1 : 1) * Math.round(big.clientHeight * 0.85)); }
  }, dir);
  await sleep(350);
  activity.log(`scrolled ${dir} on ${hostOf(page.url())}`);
  return { ok: true };
}

// ---- clicking -------------------------------------------------------------------------------------------------------
// Everything about the element AND whatever actually sits under its centre (an invisible "Send" laid over "Next").
async function inspect(page, loc) {
  const info = await loc.evaluate(describeScript).catch(() => null);
  if (!info) return { info: null, hit: null };
  await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  await page.evaluate(() => document.querySelectorAll("[data-ds-money-hit]").forEach((e) => e.removeAttribute("data-ds-money-hit")));
  const covered = await loc.evaluate((el) => {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false;
    const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (!h || h === el || el.contains(h)) return false;
    h.setAttribute("data-ds-money-hit", "1"); return true;
  }).catch(() => false);
  const hit = covered ? await page.locator("[data-ds-money-hit]").first().evaluate(describeScript).catch(() => null) : null;
  return { info, hit };
}

export async function guardedClick(page, loc, { label = "a control", apply = false } = {}) {
  const { info, hit } = await inspect(page, loc);
  let v = judgeClick(info, { hit });
  // set-date-range may press the filter's own Apply/Done (never a form submit, never a denied word)
  if (apply && !v.ok && info && /isn't a page-navigation control/.test(v.reason) && APPLY_NAME.test(String(info.name).toLowerCase().trim()) && !info.submits) v = { ok: true, why: "the date filter's apply button" };
  const host = hostOf(page.url());
  if (!v.ok) { activity.log(`refused to click ${label} on ${host}: ${v.reason.replace(/^Refused: /, "").slice(0, 120)}`); return { ok: false, refused: true, reason: v.reason }; }
  const before = page.url();
  await acting(page, async () => {
    await loc.click({ timeout: 6000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
    await sleep(500);
  });
  activity.log(`clicked ${v.why === "a transaction row" ? "a transaction row" : `"${String(info.name).slice(0, 40)}"`} on ${host}${page.url() !== before ? " (the page changed)" : ""}`);
  return { ok: true, clicked: v.why === "a transaction row" ? "a transaction row" : info.name, navigated: page.url() !== before };
}

// Find controls by name: exact name first, then starts-with, then contains. Rows can be picked by number ("row 3").
export async function candidates(page, name, { max = 30 } = {}) {
  return page.evaluate(({ want, max }) => {
    document.querySelectorAll("[data-ds-money-cand]").forEach((e) => e.removeAttribute("data-ds-money-cand"));
    const norm = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}›»‹«→← ]+/gu, " ").replace(/\s+/g, " ").trim();
    const w = norm(want);
    const shown = (el) => { if (!el.getClientRects().length) return false; const cs = getComputedStyle(el); return cs.visibility !== "hidden" && cs.display !== "none"; };
    const nameOf = (el) => norm(el.getAttribute("aria-label") || (el.getAttribute("aria-labelledby") || "").split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ") || el.getAttribute("title") || el.innerText || el.value || "");
    const rowN = /^(row|transaction|item) (\d{1,3})$/.exec(w);
    const els = rowN ? [...document.querySelectorAll("[data-ds-money-row]")].filter(shown).slice(Number(rowN[2]) - 1, Number(rowN[2]))
      : [...document.querySelectorAll("a, button, [role=button], [role=link], [role=tab], [role=menuitem], [role=option], summary, input[type=button], input[type=submit], [onclick], [aria-expanded], [data-ds-money-row]")].filter(shown);
    const scored = els.map((el) => { const n = nameOf(el); return { el, n, s: rowN ? 3 : n === w ? 3 : n.startsWith(w) ? 2 : n.includes(w) && w.length >= 3 ? 1 : 0 }; }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, max);
    return scored.map((x, i) => { x.el.setAttribute("data-ds-money-cand", String(i)); return { i, name: x.n.slice(0, 80), score: x.s }; });
  }, { want: name, max });
}

export async function click(page, name) {
  const stop = await stopIfBlocked(page, "clicking"); if (stop) return stop;
  if (denyHit(name)) { activity.log(`refused to click "${String(name).slice(0, 30)}" on ${hostOf(page.url())}: denied word`); return { ok: false, refused: true, reason: `Refused: "${name}" is something Dayspring never does on money sites. It only reads.` }; }
  const cands = await candidates(page, String(name ?? ""));
  if (!cands.length) return { ok: false, reason: `I couldn't find "${name}" on the page.` };
  let firstRefusal = null;
  for (const c of cands) {
    const r = await guardedClick(page, page.locator(`[data-ds-money-cand="${c.i}"]`).first(), { label: /^(row|transaction|item) \d/.test(name) ? "a transaction row" : `"${c.name.slice(0, 30)}"` });
    if (r.ok) return r;
    firstRefusal ??= r;
  }
  return firstRefusal;
}

export async function back(page) {
  const stop = await stopIfBlocked(page, "going back"); if (stop) return stop;
  await acting(page, () => page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null));
  activity.log(`went back on ${hostOf(page.url())}`);
  return { ok: true, url: page.url() };
}

// ---- typing (dates and searches only) ---------------------------------------------------------------------------------
async function fieldsFor(page, kind) {
  return page.evaluate((kind) => {
    document.querySelectorAll("[data-ds-money-field]").forEach((e) => e.removeAttribute("data-ds-money-field"));
    const shown = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden";
    const words = (el) => `${el.type} ${el.name} ${el.id} ${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("placeholder") ?? ""} ${[...(el.labels ?? [])].map((l) => l.textContent).join(" ")}`.toLowerCase();
    const all = [...document.querySelectorAll("input, [contenteditable=true]")].filter(shown);
    const dateish = (el) => ["date", "month", "week", "time", "datetime-local"].includes(el.type);
    const pick = kind === "search" ? all.filter((el) => !dateish(el) && (el.type === "search" || el.closest("[role=search]") || /search|find|filter/.test(words(el)))).sort((a, b) => Number(b.type === "search") - Number(a.type === "search"))
      : all.filter((el) => ["date", "month", "datetime-local"].includes(el.type) || /\b(date|from|to|start|end|since|until)\b/.test(words(el)));
    const role = (el) => (/\b(to|end|until|through)\b/.test(words(el)) ? "to" : /\b(from|start|since|begin)\b/.test(words(el)) ? "from" : "");
    return pick.slice(0, 6).map((el, i) => { el.setAttribute("data-ds-money-field", String(i)); return { i, role: role(el), type: el.type }; });
  }, kind);
}
// tests: what the rules say about typing into one field
export async function fieldVerdict(loc, kind) { return judgeType(await loc.evaluate(describeScript).catch(() => null), kind); }
async function typeInto(page, i, kind, value) {
  const loc = page.locator(`[data-ds-money-field="${i}"]`).first();
  const info = await loc.evaluate(describeScript).catch(() => null);
  const v = judgeType(info, kind);
  if (!v.ok) return v;
  await acting(page, async () => {
    const type = info.type;
    const shown = type === "date" ? value : type === "month" ? value.slice(0, 7) : kind === "date" ? `${value.slice(5, 7)}/${value.slice(8, 10)}/${value.slice(0, 4)}` : value;
    await loc.fill(shown, { timeout: 5000 });
    await loc.dispatchEvent("change").catch(() => {});
    await loc.evaluate((el) => el.blur()).catch(() => {});
  });
  return { ok: true };
}

export async function setDateRange(page, from, to) {
  const stop = await stopIfBlocked(page, "setting dates"); if (stop) return stop;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? "")) return { ok: false, reason: "Dates need to look like 2026-07-01." };
  const fields = await fieldsFor(page, "date");
  const f = fields.find((x) => x.role === "from") ?? fields[0], t = fields.find((x) => x.role === "to" && x !== f) ?? fields.find((x) => x !== f);
  if (!f) return { ok: false, reason: "I couldn't find a date filter on this page. Try the site's own date menu, or say a range like 'last 90 days'." };
  const host = hostOf(page.url());
  for (const [x, v] of [[f, from], [t, to]]) {
    if (!x) continue;
    const r = await typeInto(page, x.i, "date", v);
    if (!r.ok) { activity.log(`refused to type a date on ${host}: ${r.reason.replace(/^Refused: /, "").slice(0, 100)}`); return { ok: false, refused: true, reason: r.reason }; }
  }
  // press the filter's own Apply/Done if there is one near the fields (never a form submit)
  const applied = await page.evaluate(() => {
    document.querySelectorAll("[data-ds-money-apply]").forEach((e) => e.removeAttribute("data-ds-money-apply"));
    const box = document.querySelector("[data-ds-money-field]")?.closest("form, [role=dialog], [role=search], section, div");
    const btn = box && [...box.querySelectorAll("button, [role=button]")].find((b) => /^(apply|apply filters?|done|ok|update|update results|show results|see results|filter|go|view)$/i.test((b.getAttribute("aria-label") || b.innerText || "").trim()));
    if (!btn) return false; btn.setAttribute("data-ds-money-apply", "1"); return true;
  });
  let note = "";
  if (applied) { const r = await guardedClick(page, page.locator("[data-ds-money-apply]").first(), { label: "the date filter's apply button", apply: true }); if (!r.ok) note = " I set the dates but didn't press Apply (it would submit a form); press it yourself if the list doesn't change."; }
  activity.log(`set the date range on ${host}`);
  return { ok: true, from, to, note: note || undefined };
}

export async function searchSite(page, query) {
  const stop = await stopIfBlocked(page, "searching"); if (stop) return stop;
  const q = String(query ?? "").slice(0, 60);
  if (!q.trim()) return { ok: false, reason: "What should I search for?" };
  const fields = await fieldsFor(page, "search");
  if (!fields.length) return { ok: false, reason: "I couldn't find the site's transaction search box on this page." };
  const r = await typeInto(page, fields[0].i, "search", q);
  if (!r.ok) { activity.log(`refused to type a search on ${hostOf(page.url())}: ${r.reason.replace(/^Refused: /, "").slice(0, 100)}`); return { ok: false, refused: true, reason: r.reason }; }
  await sleep(900);
  activity.log(`searched within ${hostOf(page.url())}`);                // (never the words searched for)
  return { ok: true, note: "I typed it into the site's search box without pressing Enter. If the list doesn't filter by itself, press Enter yourself." };
}

// ---- reading transactions ---------------------------------------------------------------------------------------------
export async function extract(page, site = siteFor(page.url())) {
  return page.evaluate(extractScript, registryFor(site));
}

const LOAD_MORE = ["load more", "show more", "see more", "view more", "more transactions", "older transactions", "load older", "see older", "older", "more"];
const NEXT = ["next", "next page", "older", "›", "»", ">"];

// Keep reading until the oldest row is older than `since` (or the list ends). Rows seen on the same page (scrolling,
// "load more") count once; the same row on two different pages (a real duplicate charge) counts twice.
export async function collect(page, { since, until = null, site = siteFor(page.url()), source = hostOf(page.url()), maxRounds = 60, today = todayISO(), vision = null } = {}) {
  const pages = [new Map()];            // per page of results: fingerprint → { t, n }
  let rounds = 0, reachedStart = false, balances = [], strategy = null, confidence = 0, stuck = 0;
  const oldest = () => { let o = null; for (const pg of pages) for (const { t } of pg.values()) if (!o || t.date < o) o = t.date; return o; };
  const count = () => pages.reduce((s, pg) => s + [...pg.values()].reduce((a, x) => a + x.n, 0), 0);
  for (; rounds < maxRounds; rounds++) {
    const s = await state(page);
    if (s.blocked) { activity.log(`stopped reading on ${s.host}: ${s.blocked} page`); return { transactions: [], balances, pages: pages.length, rounds, blocked: s.blocked, text: BLOCKED_TEXT[s.blocked] }; }
    const got = await extract(page, site);
    if (got.balances?.length && !balances.length) balances = got.balances.map((b) => ({ label: mask(b.label), text: mask(b.text), conf: b.conf }));
    strategy ??= got.strategy; confidence = Math.max(confidence, got.confidence ?? 0);
    let rows = got.rows ?? [];
    if (!rows.length && vision && rounds === 0) rows = (await vision(page).catch(() => [])) ?? [];
    const cur = pages.at(-1), seenNow = new Map();
    for (const row of rows) {
      const t = fromRow(row, { site, source, today });
      if (!t) continue;
      const k = row.id ? `id:${row.id}` : `${t.date}|${t.direction}|${t.amount}|${t.description}|${t.status}`;
      const n = (seenNow.get(k) ?? 0) + 1; seenNow.set(k, n);
      const prev = cur.get(k); if (!prev || prev.n < n) cur.set(k, { t, n });
    }
    const before = count();
    const o = oldest();
    if (o && o <= since) { reachedStart = true; break; }
    // 1. "load more" on the same page  2. the next page  3. infinite scroll
    let moved = false;
    for (const name of LOAD_MORE) { const c = await candidates(page, name, { max: 3 }); if (c.some((x) => x.score >= 2)) { const r = await click(page, name); if (r.ok) { moved = true; break; } } }
    if (!moved) for (const name of NEXT) {
      const c = await candidates(page, name, { max: 3 });
      if (c.some((x) => x.score >= 3)) { const r = await click(page, name); if (r.ok) { moved = true; if (r.navigated || true) pages.push(new Map()); break; } }
    }
    if (!moved) {
      const h0 = await page.evaluate(() => document.querySelectorAll("[data-ds-money-row]").length).catch(() => 0);
      await scroll(page, "bottom");
      await sleep(900);
      const again = await extract(page, site);
      if ((again.rows?.length ?? 0) > h0) moved = true;
    }
    if (!moved) { stuck++; if (stuck >= 1) break; } else stuck = 0;
    if (count() === before && !moved) break;
  }
  const all = [];
  for (const pg of pages) for (const { t, n } of pg.values()) for (let i = 0; i < n; i++) all.push({ ...t });
  const tx = dedupe(all.filter((t) => t.date >= since && (!until || t.date <= until)));
  activity.log(`read ${tx.length} transactions from ${source}`);
  return { transactions: tx, balances, pages: pages.length, rounds: rounds + 1, reachedStart, strategy, confidence };
}
