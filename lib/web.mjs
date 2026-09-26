// Looking things up online, for any AI provider (Claude also has its own web search built in).
//   search(query) → { query, results: [{ title, url, snippet }] }   DuckDuckGo's plain HTML page, then Bing's, then Bing in Dayspring's browser
//   read(url)     → { url, title, text }        the readable text of a page, capped so it fits a conversation
// Only http(s) addresses are ever fetched.
import * as browser from "./browser.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const CAP = 15_000;

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'", "#x2F": "/", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
const decode = (s) => String(s).replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e) => {
  if (ENT[e] != null) return ENT[e];
  if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16));
  if (/^#\d/.test(e)) return String.fromCodePoint(Number(e.slice(1)));
  return m;
});
const strip = (html) => decode(String(html).replace(/<[^>]+>/g, " ")).replace(/(^|\s)️/g, "$1").replace(/[​-‍]/g, "").replace(/\s+/g, " ").trim();

export function safeUrl(u) {
  let url;
  try { url = new URL(String(u).trim()); } catch { throw new Error(`That isn't a web address: ${u}`); }
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only http and https web addresses can be opened.");
  return url.href;
}

// DuckDuckGo wraps results as //duckduckgo.com/l/?uddg=<real url>
function unwrap(href) {
  try {
    const u = new URL(decode(href), "https://duckduckgo.com");
    const real = u.searchParams.get("uddg");
    return real ? decodeURIComponent(real) : u.href;
  } catch { return null; }
}

async function ddg(query, max) {
  const r = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    // (an accept-language header here gets a "are you a robot" page back)
    headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
    body: `q=${encodeURIComponent(query)}&kl=us-en`,
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new Error(`search returned ${r.status}`);
  const html = await r.text();
  if (/anomaly-modal|challenge-form/i.test(html)) throw new Error("search asked for a check");
  const out = [];
  // one chunk per result; ads carry "result--ad"
  for (const chunk of html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/).slice(1)) {
    if (out.length >= max) break;
    if (/^[^>]*result--ad/.test(chunk)) continue;
    const a = /<a([^>]*class="result__a"[^>]*)>([\s\S]*?)<\/a>/.exec(chunk);
    if (!a) continue;
    const href = (/href="([^"]+)"/.exec(a[1]) ?? [])[1];
    const url = href && unwrap(href);
    if (!url || !/^https?:/.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue;
    const sn = /class="result__snippet"[^>]*>([\s\S]*?)<\/(a|div|td)>/.exec(chunk);
    out.push({ title: strip(a[2]), url, snippet: strip(sn?.[1] ?? "") });
  }
  return out;
}

// Bing's plain page; its links go through bing.com/ck/a?…&u=a1<base64 of the real address>
function bingUrl(href) {
  try {
    const u = new URL(decode(href));
    if (!/bing\.com$/.test(u.hostname)) return u.href;
    const enc = u.searchParams.get("u");
    if (enc?.startsWith("a1")) return Buffer.from(enc.slice(2).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch { /* not a link */ }
  return null;
}
async function bingFetch(query, max) {
  const r = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en-US&cc=US`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`search returned ${r.status}`);
  const html = await r.text(), out = [];
  for (const chunk of html.split(/<li class="b_algo"/).slice(1)) {
    if (out.length >= max) break;
    const a = /<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(chunk);
    const url = a && bingUrl(a[1]);
    if (!url || !/^https?:/.test(url)) continue;
    const sn = /<p[^>]*>([\s\S]*?)<\/p>/.exec(chunk);
    out.push({ title: strip(a[2]), url, snippet: strip(sn?.[1] ?? "").slice(0, 300) });
  }
  return out;
}

async function bing(query, max) {
  const p = await browser.searchPage("web");
  await p.goto(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en-US`, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await p.waitForSelector("#b_results", { timeout: 10_000 }).catch(() => {});
  return p.evaluate((n) => [...document.querySelectorAll("#b_results > li.b_algo")].slice(0, n).map((li) => ({
    title: li.querySelector("h2")?.innerText?.trim() ?? "",
    url: li.querySelector("h2 a")?.href ?? "",
    snippet: (li.querySelector(".b_caption p, .b_lineclamp2, .b_lineclamp3, .b_lineclamp4") ?? li).innerText.trim().slice(0, 300),
  })).filter((x) => /^https?:/.test(x.url)), max);
}

export async function search(query, { max = 6 } = {}) {
  const q = String(query ?? "").trim();
  if (!q) throw new Error("What should I search for?");
  let results = [];
  for (const engine of [ddg, bingFetch, bing]) {        // plain pages first; the browser only if both are blocked
    try { results = await engine(q, max); } catch { results = []; }
    if (results.length) break;
  }
  return { query: q, results, source: results.length ? undefined : "none" };
}

// The readable part of a page: drop scripts, styles, navigation, headers, footers and forms.
export function readable(html) {
  let h = String(html);
  const title = strip((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(h) ?? [])[1] ?? "");
  h = h.replace(/<(script|style|noscript|svg|template|iframe|nav|header|footer|form|aside)\b[\s\S]*?<\/\1>/gi, " ");
  const main = /<(main|article)\b[\s\S]*?<\/\1>/i.exec(h);
  if (main && main[0].length > 800) h = main[0];
  h = h.replace(/<\/(p|div|li|h[1-6]|tr|section|br|pre|blockquote)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<li\b[^>]*>/gi, "\n• ");
  const text = decode(h.replace(/<[^>]+>/g, " ")).split("\n").map((l) => l.replace(/[ \t\f\v]+/g, " ").trim()).filter(Boolean).join("\n").replace(/\n{3,}/g, "\n\n");
  return { title, text };
}

export async function read(url) {
  const href = safeUrl(url);
  let title = "", text = "", err = null;
  try {
    const r = await fetch(href, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5", "accept-language": "en-US,en;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    const type = r.headers.get("content-type") ?? "";
    if (!r.ok) throw new Error(`the page returned ${r.status}`);
    if (/json|text\/plain|markdown/.test(type)) text = (await r.text());
    else if (/html|xml/.test(type) || !type) ({ title, text } = readable(await r.text()));
    else return { url: href, title: "", text: "", note: `That link is a ${type.split(";")[0]} file, not a web page.` };
  } catch (e) { text = ""; title = ""; err = e; }
  // pages that build themselves with JavaScript: read them in the browser instead
  if (text.replace(/\s/g, "").length < 400) {
    try {
      const p = await browser.searchPage("web");
      await p.goto(href, { waitUntil: "domcontentloaded", timeout: 25_000 });
      await p.waitForTimeout(1500);
      title = (await p.title()) || title;
      text = await p.evaluate(() => (document.querySelector("main, article") ?? document.body).innerText);
    } catch (e) { if (!text) throw new Error(`I couldn't open that page (${(err ?? e).message}).`); }
  }
  const trimmed = text.length > CAP;
  return { url: href, title, text: trimmed ? text.slice(0, CAP) + "\n…(cut off here)" : text, trimmed };
}
