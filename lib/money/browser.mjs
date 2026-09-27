// Money review: its own browser window. A real Chrome (or Edge) window with its OWN profile,
// %LOCALAPPDATA%\DayspringFinance, apart from the media and search browsers, so cookies never mix. It opens only when
// the owner asks ("open my bank"), stays visible (the owner signs in there themselves, 2FA too), and closes on
// "close my money browser" or after `idleMinutes` (15 by default) with nothing asked of it.
//
// Dayspring never types, stores or reads passwords or codes, and never fills sign-in forms. While one of its own
// actions runs, forms can't be submitted, popups to other sites are blocked, pages can't be loaded with POST and
// links to pay/transfer/settings/sign-out pages are refused (guard.mjs + actions.mjs). Downloads are always refused.
//
//   open(target)   target: "venmo" | "cashapp" | "bank" | a bank's name | an https address   → { opened, url, site }
//   page()         the money page (or null)          close()      isOpen()      status()
//   DAYSPRING_FINANCE_PROFILE / _HEADLESS / _EXE / _ALLOW_LOCAL / _IDLE_MS: tests only
import { createRequire } from "node:module";
import { join } from "node:path";
import { playwrightChannel } from "../browsers.mjs";
import { SITES, BANKS, siteFor } from "./selectors.mjs";
import { isActing, lastActivityAt } from "./actions.mjs";
import * as store from "./store.mjs";
import * as activity from "./activity.mjs";

const require = createRequire(import.meta.url);
export const PROFILE = () => process.env.DAYSPRING_FINANCE_PROFILE || join(process.env.LOCALAPPDATA || ".", "DayspringFinance");
let chromiumOverride = null;
export function _setPlaywright(chromium) { chromiumOverride = chromium; }     // tests: the one headless Chrome they allow

let ctx = null, launching = null, moneyPage = null, lastUsed = 0, idleTimer = null;
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const DENY_NAV = /(^|[/?#&=._-])(logout|log-out|signout|sign-out|logoff|pay|send|transfer|withdraw|cashout|cash-out|settings|security|password|close-account|delete)(?=$|[/?#&=._-])/i;

// in every page of the money window: popups to other sites and form submits are blocked while Dayspring is acting
const INIT = () => {
  const acting = () => window.__dsMoneyActing === true;
  const open = window.open;
  window.open = function (url, ...rest) {
    let other = true; try { other = new URL(url, location.href).hostname !== location.hostname; } catch { /* a bad address counts as another site */ }
    if (acting() && other) { window.__dsMoneyBlockedPopups = (window.__dsMoneyBlockedPopups || 0) + 1; return null; }
    return open.call(this, url, ...rest);
  };
  window.addEventListener("submit", (e) => { if (acting()) { e.preventDefault(); e.stopImmediatePropagation(); window.__dsMoneyBlockedSubmits = (window.__dsMoneyBlockedSubmits || 0) + 1; } }, true);
  const submit = HTMLFormElement.prototype.submit, requestSubmit = HTMLFormElement.prototype.requestSubmit;
  HTMLFormElement.prototype.submit = function (...a) { if (acting()) { window.__dsMoneyBlockedSubmits = (window.__dsMoneyBlockedSubmits || 0) + 1; return; } return submit.apply(this, a); };
  if (requestSubmit) HTMLFormElement.prototype.requestSubmit = function (...a) { if (acting()) { window.__dsMoneyBlockedSubmits = (window.__dsMoneyBlockedSubmits || 0) + 1; return; } return requestSubmit.apply(this, a); };
};

async function context() {
  if (ctx) return ctx;
  if (launching) return launching;
  launching = (async () => {
    const chromium = chromiumOverride ?? require("playwright-core").chromium;
    const headless = process.env.DAYSPRING_FINANCE_HEADLESS === "1";
    const exe = process.env.DAYSPRING_FINANCE_EXE;
    const c = await chromium.launchPersistentContext(PROFILE(), {
      ...(exe ? { executablePath: exe } : { channel: playwrightChannel() }), headless, viewport: headless ? { width: 1280, height: 900 } : null, acceptDownloads: false,
      args: ["--window-size=1200,900", "--window-position=80,60", "--no-first-run", "--disable-session-crashed-bubble", "--mute-audio", "--disable-blink-features=AutomationControlled"],
      ignoreDefaultArgs: ["--enable-automation"],
    });
    await c.addInitScript(INIT);
    // popups Dayspring's own click opened on another site are closed straight away
    c.on("page", async (p) => {
      if (!isActing()) return;
      const opener = await p.opener().catch(() => null);
      await p.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      if (opener && hostOf(p.url()) && hostOf(p.url()) !== hostOf(opener.url())) { activity.log(`closed a popup to ${hostOf(p.url())}`); await p.close().catch(() => {}); }
    });
    // while Dayspring acts: no page loads by POST (a form sending something) and no pay/transfer/settings/sign-out pages
    await c.route("**/*", (route) => {
      const r = route.request();
      if (isActing() && r.isNavigationRequest() && (r.method() !== "GET" || DENY_NAV.test(new URL(r.url()).pathname + new URL(r.url()).search))) {
        activity.log(`blocked a page load to ${hostOf(r.url())} (${r.method()})`);
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    c.on("close", () => { ctx = null; moneyPage = null; if (idleTimer) { clearInterval(idleTimer); idleTimer = null; } });
    ctx = c;
    return c;
  })();
  try { return await launching; } finally { launching = null; }
}

export function touch() {
  lastUsed = Date.now();
  const ms = Number(process.env.DAYSPRING_FINANCE_IDLE_MS) || store.settings().idleMinutes * 60_000;
  if (idleTimer) return;
  idleTimer = setInterval(() => {
    if (!ctx) { clearInterval(idleTimer); idleTimer = null; return; }
    const limit = Number(process.env.DAYSPRING_FINANCE_IDLE_MS) || store.settings().idleMinutes * 60_000;
    if (!isActing() && Date.now() - Math.max(lastUsed, lastActivityAt()) >= limit) { activity.log("closed the money browser after being idle"); close().catch(() => {}); }
  }, Math.max(250, Math.min(30_000, ms / 4)));
  idleTimer.unref?.();
}

// "venmo" / "cash app" / "my bank" / "chase" / "https://…" → an address Dayspring may open
export function resolveTarget(target) {
  const t = String(target ?? "").trim().toLowerCase();
  if (!t) return null;
  if (/^venmo$|^venmo\.com$/.test(t)) return SITES.venmo.start;
  if (/^cash ?app$|^cash\.app$|^cashapp$/.test(t)) return SITES.cashapp.start;
  if (BANKS[t]) return BANKS[t];
  if (/^(bank|my bank|the bank)$/.test(t)) return store.settings().bankUrl || null;
  const raw = String(target).trim();
  const local = process.env.DAYSPRING_FINANCE_ALLOW_LOCAL === "1" && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(raw);
  if (/^https:\/\//i.test(raw) || local) { try { return new URL(raw).href; } catch { return null; } }
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(raw)) return `https://${raw}`;
  return null;
}

export async function open(target) {
  const url = resolveTarget(target);
  if (!url) return { opened: false, reason: /bank/i.test(String(target)) ? "Which bank? Say its name (\"open my bank, Chase\") or its web address, or set it on the Money page." : "I can only open Venmo, Cash App, or a bank's https:// address." };
  const c = await context();
  if (!moneyPage || moneyPage.isClosed()) moneyPage = c.pages().find((p) => p.url() === "about:blank") ?? await c.newPage();
  if (!moneyPage.__dsDl) { moneyPage.__dsDl = true; moneyPage.on("download", (d) => { activity.log("refused a download"); d.cancel().catch(() => {}); }); }
  await moneyPage.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((e) => { throw new Error(`The site didn't open: ${String(e.message).split("\n")[0]}`); });
  await moneyPage.bringToFront().catch(() => {});
  touch();
  activity.log(`opened ${hostOf(url)} in the money browser`);
  return { opened: true, url: moneyPage.url(), host: hostOf(moneyPage.url()), site: siteFor(moneyPage.url()) };
}
export function page() { if (moneyPage && !moneyPage.isClosed()) { touch(); return moneyPage; } return null; }
export const isOpen = () => Boolean(ctx);
export async function close() {
  const had = Boolean(ctx);
  if (ctx) await ctx.close().catch(() => {});
  ctx = null; moneyPage = null;
  if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
  if (had) activity.log("closed the money browser");
  return had;
}
export function status() { const p = moneyPage && !moneyPage.isClosed() ? moneyPage : null; return { open: Boolean(ctx), host: p ? hostOf(p.url()) : null, site: p ? siteFor(p.url()) : null, idleMinutes: store.settings().idleMinutes }; }
