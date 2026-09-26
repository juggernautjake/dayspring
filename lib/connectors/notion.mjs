// Notion: search, read, create pages, add notes. The owner pastes a personal access token (or an internal integration
// token), kept in data/connectors/notion.json. Uses the long-supported 2022-06-28 API version (pages and blocks).
import * as store from "./store.mjs";

const API = () => process.env.NOTION_API_BASE || "https://api.notion.com/v1";
const VERSION = "2022-06-28";
const token = () => store.load("notion").token || "";
export const configured = () => Boolean(token());

async function call(method, path, body, tok = token()) {
  if (!tok) throw Object.assign(new Error("Notion isn't connected yet. Add your Notion token in Settings → Apps."), { code: "not_connected" });
  const res = await fetch(API() + path, { method, headers: { authorization: `Bearer ${tok}`, "notion-version": VERSION, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw await store.fail(res, "Notion");
  return res.json();
}

// Connect: check the token works (who it belongs to), then keep it
export async function connect({ token: tok }) {
  tok = String(tok ?? "").trim();
  if (!/^(ntn_|secret_)[\w-]{20,}$/.test(tok)) throw new Error("That doesn't look like a Notion token (it starts with “ntn_”).");
  const me = await call("GET", "/users/me", null, tok);
  store.save("notion", { token: tok, who: me.name ?? me.bot?.owner?.user?.name ?? "Notion", workspace: me.bot?.workspace_name ?? null, at: Date.now() });
  return status();
}
export function status() { const s = store.load("notion"); return { id: "notion", connected: Boolean(s.token), who: s.workspace || s.who || null }; }
export function disconnect() { store.forget("notion"); return status(); }

// ---- reading ----
const plain = (rich = []) => rich.map((r) => r.plain_text ?? "").join("");
export function titleOf(page) {
  const props = page.properties ?? {};
  for (const v of Object.values(props)) if (v?.type === "title") return plain(v.title) || "Untitled";
  return plain(page.title) || "Untitled";
}
export async function search(query = "", { limit = 10 } = {}) {
  const r = await call("POST", "/search", { query, page_size: Math.min(25, limit), sort: { direction: "descending", timestamp: "last_edited_time" } });
  return (r.results ?? []).map((x) => ({ id: x.id, kind: x.object, title: x.object === "database" ? plain(x.title) || "Untitled database" : titleOf(x), url: x.url, edited: x.last_edited_time }));
}
function blockText(b) {
  const t = b[b.type] ?? {};
  const text = plain(t.rich_text ?? []);
  switch (b.type) {
    case "heading_1": return `# ${text}`; case "heading_2": return `## ${text}`; case "heading_3": return `### ${text}`;
    case "bulleted_list_item": return `• ${text}`; case "numbered_list_item": return `1. ${text}`;
    case "to_do": return `${t.checked ? "☑" : "☐"} ${text}`; case "quote": return `“${text}”`; case "callout": return `💡 ${text}`;
    case "code": return text; case "child_page": return `[page] ${t.title ?? ""}`; case "divider": return "—";
    default: return text;
  }
}
// A page's words (top-level blocks and one level of nesting), capped
export async function read(pageId, { maxBlocks = 400 } = {}) {
  const page = await call("GET", `/pages/${encodeURIComponent(pageId)}`);
  const lines = []; let cursor, n = 0;
  do {
    const r = await call("GET", `/blocks/${encodeURIComponent(pageId)}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    for (const b of r.results ?? []) {
      lines.push(blockText(b)); n++;
      if (b.has_children && ["toggle", "bulleted_list_item", "numbered_list_item", "to_do"].includes(b.type) && n < maxBlocks) {
        const kids = await call("GET", `/blocks/${b.id}/children?page_size=50`).catch(() => ({ results: [] }));
        for (const k of kids.results ?? []) { lines.push("   " + blockText(k)); n++; }
      }
    }
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor && n < maxBlocks);
  return { id: page.id, title: titleOf(page), url: page.url, text: lines.filter((l) => l.trim()).join("\n"), truncated: Boolean(cursor) };
}

// ---- writing (only what the owner asked for) ----
const para = (text) => String(text).split(/\n+/).filter(Boolean).slice(0, 90).map((line) => {
  const t = line.replace(/^\s*[-•]\s+/, ""), bullet = t !== line;
  const type = bullet ? "bulleted_list_item" : /^#{1,3}\s/.test(line) ? `heading_${Math.min(3, line.match(/^#+/)[0].length)}` : "paragraph";
  const content = type.startsWith("heading") ? line.replace(/^#+\s*/, "") : t;
  return { object: "block", type, [type]: { rich_text: [{ type: "text", text: { content: content.slice(0, 1900) } }] } };
});
export async function createPage({ parentId, title, text = "" }) {
  if (!parentId) { const top = (await search("", { limit: 25 })).find((x) => x.kind === "page"); if (!top) throw new Error("I need a page to put it under. Name one (or share one with the integration)."); parentId = top.id; }
  const r = await call("POST", "/pages", { parent: { page_id: parentId }, properties: { title: { title: [{ type: "text", text: { content: String(title || "Untitled").slice(0, 200) } }] } }, children: para(text) });
  return { id: r.id, title: titleOf(r), url: r.url };
}
export async function append(pageId, text) {
  await call("PATCH", `/blocks/${encodeURIComponent(pageId)}/children`, { children: para(text) });
  return { ok: true };
}
// Find one page by words in its title (for voice: "add to my Groceries page")
export async function findPage(words) {
  const hits = (await search(words, { limit: 10 })).filter((x) => x.kind === "page");
  return hits.find((h) => h.title.toLowerCase() === String(words).toLowerCase()) ?? hits[0] ?? null;
}
