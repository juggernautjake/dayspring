// Link check: every web address a user can open (Help pages, setup walkthroughs, installers) and every in-app Help
// link ("page.md#heading", "/help#page/heading"). Pages behind a sign-in (401/403, sign-in redirects) count as OK.
//   node scripts/qa/links.mjs [app folder] [--offline]      (--offline: only the in-app Help links)
// Exit code: 0 when nothing is broken, 1 otherwise.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const APP = resolve(args.find((a) => !a.startsWith("--")) ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
const OFFLINE = args.includes("--offline");
const walk = (p) => !existsSync(p) ? [] : readdirSync(p, { withFileTypes: true }).flatMap((e) => ["node_modules", ".git", "data", "backups", "bin", "dist-out"].includes(e.name) ? [] : e.isDirectory() ? walk(join(p, e.name)) : [join(p, e.name)]);
const files = ["docs", "lib", "public", "scripts", "dist"].flatMap((d) => walk(join(APP, d))).concat(["README.md", "Install Dayspring.cmd"].map((f) => join(APP, f)).filter(existsSync))
  .filter((f) => [".md", ".mjs", ".js", ".cjs", ".html", ".cmd", ".ps1"].includes(extname(f)));

// 1. in-app Help links (same heading ids as public/help.js)
const anchor = (t) => String(t).toLowerCase().replace(/<[^>]+>/g, "").replace(/[*_`]/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s/g, "-");
const docs = {};
for (const f of walk(join(APP, "docs")).filter((f) => f.endsWith(".md"))) {
  const text = readFileSync(f, "utf8");
  docs[relative(join(APP, "docs"), f).replace(/\\/g, "/").replace(/\.md$/, "")] = new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => anchor(m[1])));
}
const helpBad = []; let helpN = 0;
const test = (where, slug, a) => { helpN++; if (!docs[slug]) helpBad.push(`${where}: there's no Help page "${slug}"`); else if (a && !docs[slug].has(a)) helpBad.push(`${where}: "${slug}" has no heading #${a}`); };
for (const f of files) {
  const text = readFileSync(f, "utf8"), rel = relative(APP, f);
  if (f.endsWith(".md") && f.startsWith(join(APP, "docs")) && f !== join(APP, "docs", "README.md")) {   // docs/README.md becomes the export's front page
    const here = relative(join(APP, "docs"), dirname(f)).replace(/\\/g, "/");
    for (const m of text.matchAll(/\]\(((?:\.\.\/|[\w-]+\/)*[\w-]+)\.md(?:#([\w-]+))?\)/g)) test(rel, join(here, m[1]).replace(/\\/g, "/"), m[2]);
  }
  if (/\.(m?js|html)$/.test(f) && !f.startsWith(join(APP, "scripts"))) for (const m of text.matchAll(/\/help#([\w-]+(?:\/[\w-]+)?)(?:\/([\w-]+))?/g)) {
    const [slug, a] = docs[m[1]] ? [m[1], m[2]] : m[1].includes("/") ? [m[1].split("/")[0], m[1].split("/")[1]] : [m[1], m[2]];
    test(rel, slug, a);
  }
}
console.log(`Help links: ${helpN} checked, ${helpBad.length} broken`); helpBad.forEach((b) => console.log("  BROKEN " + b));

// 2. web addresses
const found = new Map();
// not pages for people: service addresses the code calls, templates, placeholders
const NOT_A_PAGE = /localhost|127\.0\.0\.1|\[::1\]|^https?:\/\/(192\.168|10)\.|\.local[:/]|\.local$|^https?:\/\/$|example\.(com|invalid|org)|your-name|\$\{|\$\w|\{|%|<|…|^https?:\/\/[^./]+(\/|$)|^https:\/\/fonts\.(googleapis|gstatic)\.com\/?$|googleapis\.com\/(calendar|gmail|oauth2|youtube\/v3)|graph\.microsoft\.com|api\.[\w-]+\.(com|ai|org|io)|accounts\.spotify\.com\/(api|authorize)|login\.microsoftonline\.com\/.+\/oauth2|oauth2\.googleapis|accounts\.google\.com\/o\/oauth2|open-meteo\.com\/v1|geocoding-api|bible-api|youtube\.com\/(embed|iframe_api|results|watch\?)|ytimg|duckduckgo\.com\/html|bing\.com\/search|schemas\.openxmlformats|w3\.org|cdn\.sheetjs|raw\.githubusercontent|objects\.githubusercontent/;
for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/https?:\/\/[^\s"'`<>)\]\\|]+/g)) {
  const u = m[0].replace(/[.,;:!?*]+$/, "");
  if (NOT_A_PAGE.test(u)) continue;
  const rel = relative(APP, f); if (!found.has(u)) found.set(u, new Set()); found.get(u).add(rel);
}
let webBad = [];
if (!OFFLINE) {
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
  const check = async (u) => {
    for (const method of ["HEAD", "GET"]) {
      try {
        const r = await fetch(u, { method, redirect: "follow", headers: { "user-agent": UA, accept: "text/html,*/*" }, signal: AbortSignal.timeout(25_000) });
        if (method === "GET") r.body?.cancel().catch(() => {});
        if (r.status < 400 || method === "GET") return { status: r.status };
      } catch (e) {
        if (/redirect/i.test(String(e.cause?.message ?? e.message))) return { status: 302, wall: true };   // sign-in redirect loop (Google Cloud console)
        if (method === "GET") return { status: 0, error: e.cause?.code || e.name };
      }
    }
  };
  const urls = [...found.keys()], out = [];
  for (let i = 0; i < urls.length; i += 8) out.push(...await Promise.all(urls.slice(i, i + 8).map(async (u) => ({ u, ...(await check(u)) }))));
  webBad = out.filter((r) => !r.status || r.status === 404 || r.status === 410 || r.status >= 500);
  const walled = out.filter((r) => r.wall || [401, 403, 429].includes(r.status));
  console.log(`Web links: ${urls.length} checked, ${urls.length - webBad.length - walled.length} open, ${walled.length} behind a sign-in or bot check, ${webBad.length} broken`);
  for (const r of webBad) console.log(`  BROKEN ${r.status || r.error}  ${r.u}\n         in ${[...found.get(r.u)].join(", ")}`);
} else console.log(`Web links: ${found.size} found (not checked: --offline)`);
process.exit(helpBad.length || webBad.length ? 1 : 0);
