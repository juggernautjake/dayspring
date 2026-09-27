// The in-app guide (/help): lists and serves the Markdown docs in docs/ (and the developer docs in docs/dev/, as
// "dev-<name>"), the screenshots in docs/images/, and finds the right section for a question. Read-only; slugs and
// image names are plain lowercase names, so nothing outside docs/ can be reached. README.md (the repository's front
// page) is not listed.
//   GET /api/help/list            → { docs: [{ slug, title, order, maintainer, dev }] }
//   GET /api/help/doc/:slug       → { slug, title, markdown }
//   GET /api/help/find?q=…        → the best section for a question ({ found, page, title, url, steps, say, … })
//   GET /api/help/image/:name     → a picture from docs/images/
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as helpskills from "./helpskills.mjs";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..", "docs");
const DEV = join(DOCS, "dev"), IMAGES = join(DOCS, "images");
// Reading order in the guide's table of contents; anything else found in docs/ goes at the end, alphabetically.
const ORDER = ["getting-started", "install", "setup-wizard", "tutorials", "talking-to-dayspring", "using-without-ai", "recipes-and-cooking", "schedule", "learning", "lantern", "xp", "ai-providers", "voices",
  "audio-devices", "display-setup", "quiet-and-notifications", "settings-reference", "connections", "permissions", "files-and-browser", "documents", "music", "discover", "phone",
  "discord-calls", "discord-bot", "photos", "claude-code", "faith-features", "privacy", "updating", "troubleshooting", "faq", "publishing-releases",
  "dev-architecture", "dev-code-map", "dev-api-reference", "dev-lantern-xp", "dev-extending", "dev-testing", "dev-releasing", "integrations-ideas"];
const SLUG = /^[a-z0-9-]+$/;
const IMAGE = /^[a-z0-9-]+\.(png|jpe?g|gif|webp|svg)$/;
const TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };

function titleOf(text, slug) {
  const m = /^#\s+(.+)$/m.exec(text);
  return m ? m[1].trim() : slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}
const mdIn = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).filter((s) => SLUG.test(s)) : []);
// a slug's file: "voices" → docs/voices.md, "dev-architecture" → docs/dev/architecture.md
function fileOf(slug) {
  if (!SLUG.test(String(slug))) return null;
  const top = join(DOCS, slug + ".md");
  if (existsSync(top)) return top;
  if (slug.startsWith("dev-")) { const d = join(DEV, slug.slice(4) + ".md"); if (existsSync(d)) return d; }
  return null;
}

export function list() {
  const slugs = [...mdIn(DOCS), ...mdIn(DEV).map((s) => "dev-" + s)];
  const rank = (s) => { const i = ORDER.indexOf(s); return i < 0 ? ORDER.length : i; };
  slugs.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return slugs.map((slug, order) => {
    const text = readFileSync(fileOf(slug), "utf8");
    return { slug, title: titleOf(text, slug), order, maintainer: slug === "publishing-releases", dev: slug.startsWith("dev-") };
  });
}

export function doc(slug) {
  const f = fileOf(slug);
  if (!f) return null;
  const text = readFileSync(f, "utf8");
  return { slug, title: titleOf(text, slug), markdown: text };
}

// ctx = { m, p, q, send, readJSON }; p is the path after /api
export async function handle(req, res, ctx) {
  const { m, p, q, send } = ctx;
  if (m !== "GET") return false;
  if (p === "/help/list") { send(res, 200, { docs: list() }); return true; }
  if (p === "/help/find") {
    const text = String(q?.get("q") ?? "").slice(0, 300);
    // ask=1: only a real "how do I …?" about Dayspring counts (the screen's no-AI answer); otherwise any words
    if (q?.get("ask")) { const a = helpskills.answer(text); send(res, 200, a ? { found: true, ...a.hit, say: a.reply } : { found: false }); return true; }
    const hit = helpskills.find(text, { min: Number(q?.get("min")) || 6 });
    send(res, 200, hit ? { found: true, ...hit } : { found: false });
    return true;
  }
  const im = /^\/help\/image\/([^/]+)$/.exec(p);
  if (im) {
    const name = decodeURIComponent(im[1]).toLowerCase(), f = join(IMAGES, name);
    if (!IMAGE.test(name) || !existsSync(f)) { send(res, 404, { error: "no such picture" }); return true; }
    res.writeHead(200, { "content-type": TYPES[name.split(".").pop()], "cache-control": "max-age=300" });
    res.end(readFileSync(f));
    return true;
  }
  const mm = /^\/help\/doc\/([^/]+)$/.exec(p);
  if (mm) {
    const d = doc(decodeURIComponent(mm[1]));
    if (!d) send(res, 404, { error: "no such page" }); else send(res, 200, d);
    return true;
  }
  return false;
}
