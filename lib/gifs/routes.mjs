// GIFs on the Dayspring screen and in any page that opens the GIF picker (public/gifs.js): the /api/gifs routes,
// what people say ("show me a GIF of a dancing cat", "number 4", "more", "save that GIF", "copy that one", "only
// stickers", "clean ones only"), and the AI's tools (gif_search, gif_pick). The searching is lib/gifs/index.mjs.
//   /api/gifs/stream        a search, streamed as it arrives (one JSON event per line: start, status, items, done)
//   /api/gifs/media?u=      one GIF / video, fetched by Dayspring (no hotlinking; private addresses refused; 20 MB)
//   /api/gifs/file?id=      a local copy of a GIF Dayspring has shown (for attaching to an email); &raw=1 sends the bytes
//   /api/gifs/save · copy · favorite · used · clear · library · categories · settings · keys · test · numbers · act · state
// What the picker on the screen shows is numbered by the screen (it skips GIFs that don't load and look-alikes) and
// told back here, so "number 4" by voice is the tile with a 4 on it.
import * as gifs from "./index.mjs";
import * as media from "./media.mjs";
import { copyToClipboard, imgHtml } from "./clipboard.mjs";
import { broadcast } from "../bus.mjs";
import { enabled } from "./feature.mjs";

let deps = { openUrl: null, permissionsCheck: async () => (await import("../permissions.mjs")).check("web"), imagesAt: async () => { try { const ir = await import("../image-routes.mjs"); const v = ir.current(); return v && !v.closed ? v.at : 0; } catch { return 0; } } };
export function setDeps(d) { deps = { ...deps, ...d }; }

// ---- what's on the screen -------------------------------------------------------------------------------------------
let view = null;   // { sid, at, closed, selected, numbers: Map n → id, pickMode, filters }
export const current = () => view;
export function _reset() { view = null; }
const active = () => Boolean(view && !view.closed && Date.now() - view.at < 30 * 60_000);
function setView(ses, extra = {}) {
  view = { sid: ses.sid, at: Date.now(), closed: false, selected: null, numbers: new Map(), pickMode: Boolean(extra.pickMode ?? view?.pickMode), filters: { q: ses.q, mode: ses.mode, rating: ses.rating, type: ses.type, providers: extra.providers ?? null } };
  return view;
}
function numbered(n) {
  if (!view) return null;
  const id = view.numbers.get(Number(n));
  if (id) return gifs.item(id);
  if (view.numbers.size) return null;                       // the screen numbered them: only its numbers count
  const ses = gifs.session(view.sid);
  return ses?.items[Number(n) - 1] ?? null;
}
const thatOne = () => view?.selected ?? (view && view.numbers.size === 1 ? [...view.numbers.keys()][0] : null);

const px = (u) => (u ? `/api/gifs/media?u=${encodeURIComponent(u)}` : null);
export function clientItem(it) {
  return { id: it.id, seq: it.seq, source: it.source, title: it.title, tags: it.tags, rating: it.rating, type: it.type, width: it.width, height: it.height, previewWidth: it.previewWidth, previewHeight: it.previewHeight, bytes: it.bytes,
    page: it.page, url: it.gif ?? it.webp ?? it.mp4, gif: it.gif, mp4: it.mp4, webp: it.webp,
    px: { preview: px(it.preview), small: px(it.previewSmall), still: px(it.still), gif: px(it.gif), mp4: px(it.mp4), webp: px(it.webp) } };
}
const clientEvent = (ev) => (ev.t === "items" ? { ...ev, items: ev.items.map(clientItem) } : ev);
const LABEL = Object.fromEntries(gifs.PROVIDERS.map((p) => [p.id, p.label]));

// ---- searching ---------------------------------------------------------------------------------------------------------
async function webAllowed() {
  const perm = await deps.permissionsCheck().catch(() => ({ ok: true }));
  if (perm && perm.ok === false) throw Object.assign(new Error(perm.text || "Looking things up online is turned off."), { status: 403 });
}
export async function search({ q = "", mode = "search", rating, type, providers, screen = true, pickMode } = {}) {
  await webAllowed();
  const ses = gifs.startSession({ mode, q, rating, type, providers });
  if (screen) { setView(ses, { providers, pickMode }); broadcast("gifs", { do: "open", sid: ses.sid, q: ses.q, mode: ses.mode, rating: ses.rating, type: ses.type, providers: providers ?? null }); }
  await ses.ready;
  if (screen && view?.sid === ses.sid) view.at = Date.now();
  return ses;
}
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const listSources = (ses) => { const s = [...new Set(ses.items.map((x) => LABEL[x.source]))]; return s.length > 1 ? `${s.slice(0, -1).join(", ")} and ${s.at(-1)}` : s[0] ?? ""; };
const ratingWord = (r) => ({ g: "G", pg: "PG", "pg-13": "PG-13", r: "R" }[r] ?? r);
function searchReply(ses) {
  const kind = ses.type === "sticker" ? "sticker" : "GIF";
  if (!ses.items.length) {
    const failed = Object.values(ses.statuses).length && Object.values(ses.statuses).every((s) => s.state !== "ok");
    return failed ? `I couldn't reach any GIF search just now, so I couldn't look for ${ses.q || "trending GIFs"}.` : `I didn't find any ${kind}s ${ses.mode === "trending" ? "trending right now" : `of ${ses.q}`}${ses.rating !== "r" ? ` rated ${ratingWord(ses.rating)} or cleaner` : ""}.`;
  }
  const what = ses.mode === "trending" ? `Here are the trending ${kind}s` : `Here are ${kind}s of ${ses.q}`;
  return `${what}, from ${listSources(ses)}. Say "number 3" to see one, "more" for more, or "save that one" or "copy that one".`;
}

// ---- doing things to one GIF --------------------------------------------------------------------------------------------
async function copyItem(it, what = "gif") {
  gifs.addRecent(it.id);
  if (what === "link") return copyToClipboard({ text: it.page ?? it.gif ?? it.mp4 });
  let file = null;
  try { file = (await gifs.file(it.id, { format: "gif" })).path; } catch { /* the link and picture still copy */ }
  const url = it.gif ?? it.webp ?? it.mp4;
  return copyToClipboard({ file, html: imgHtml(url, it.title), text: url });
}
function sayItem(n, it) {
  const s = gifs.settings();
  return s.sayTitle ? `Number ${n}: ${it.title}, from ${LABEL[it.source]}.` : `Number ${n}.`;
}

// ---- what people say --------------------------------------------------------------------------------------------------
const NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, to: 2, too: 2, for: 4, won: 1 };
const NUM = "(\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|to|too|for|won)";
const num = (s) => (s == null ? null : /^\d+$/.test(s) ? Number(s) : NUMW[s] ?? null);
const clean = (text) => String(text ?? "").toLowerCase().replace(/[’']/g, "").replace(/^(hey |ok |okay )?dayspring,?\s+/, "").replace(/[?.!,]+/g, " ").replace(/\s+/g, " ").trim().replace(/ please$/, "").replace(/^please /, "");
const GIFW = "(?:gifs?|jifs?|gif images?|animated gifs?|stickers?)";
const LEAD = "(?:(?:can|could|would|will) you |go |and )*(?:show me|show|find me|find|get me|get|give me|search for|search|look up|look for|pull up|bring up|send me|i want|i need|i want to see|i wanna see|let me see|lets see|add|insert|attach|put in|grab|pick)";
export function parseSearch(text) {
  const t = clean(text);
  let m, q = null, word = "gif";
  if ((m = new RegExp(`^(?:${LEAD} )?(?:me )?(?:the )?(?:trending|popular|top|hot) (gifs?|stickers?)(?: right now| today| now)?$|^what (gifs?|stickers?) are trending(?: right now| today)?$|^(?:${LEAD} )?(?:me )?whats trending (?:on|in) (gifs?|stickers?)$`).exec(t))) return { mode: "trending", q: "", type: /sticker/.test(m[1] ?? m[2] ?? m[3]) ? "sticker" : "gif" };
  if ((m = new RegExp(`^(?:open|show|bring up|pull up)(?: me)?(?: the| some| my)? (gifs|gif picker|gif page|gif search|gif finder|stickers|sticker picker)$`).exec(t))) return { mode: "trending", q: "", type: /sticker/.test(m[1]) ? "sticker" : "gif", open: true };
  if ((m = new RegExp(`^(?:${LEAD} )?(?:me |us )?(?:a |an |some |the |a few |a couple of |another |a good |a funny |some funny |funny |cute |a cute )?(?:funny |cute |good )?(${GIFW}) (?:of|about|for|with|showing|that says|saying|where|like) (.+)$`).exec(t))) { word = m[1]; q = m[2]; }
  else if ((m = new RegExp(`^(?:${LEAD} )(?:me |us )?(?:a |an |some |the |a few |another )?(.+?) (${GIFW})(?: (?:for|to) (?:me|us|the email|my email|this email))?$`).exec(t))) { q = m[1]; word = m[2]; }
  else if ((m = new RegExp(`^(.+?) (${GIFW})$`).exec(t)) && !/^(show|find|open|close|save|copy|more|only|just|no|any|the|my|all|trending|clean)\b/.test(m[1]) && m[1].split(" ").length <= 5) { q = m[1]; word = m[2]; }
  if (!q) return null;
  q = q.replace(/^(a|an|the|some) /, "").replace(/ (for me|on (the )?screen|to (the|my|this) email|in (the|my|this) email|please)$/g, "").trim();
  if (!q || q.length < 2 || /^(it|that|this|them|one|more|number \w+)$/.test(q)) return null;
  const out = { mode: "search", q, type: /sticker/.test(word) ? "sticker" : "gif" };
  if (/\b(clean|family friendly|kid friendly|safe)\b/.test(t)) out.rating = "g";
  return out;
}
export function parseContext(text) {
  const t = clean(text);
  let m;
  if (/^(close|hide|dismiss|exit|put away|get rid of|done with|no more)( the| those| these| all)? (gifs?|gif picker|gif page|gif search|stickers?)$|^(close|hide) (it|that|them|the picker)$/.test(t)) return { do: "close" };
  if (/^(more|next|next page|show more|more (gifs|stickers|please|of them|results)|show me more( gifs| stickers)?|keep going|load more|even more)$/.test(t)) return { do: "more" };
  if (/^(back|go back|back to (the )?(grid|gifs|results|all of them)|show (them )?all|show all( of them)?)$/.test(t)) return { do: "grid" };
  if (/^((only|just) )?stickers( only| please)?$|^(show|find) (me )?stickers( instead)?$|^switch to stickers$/.test(t)) return { do: "filter", type: "sticker" };
  if (/^((only|just) )?(gifs|regular gifs|normal gifs)( only| please| instead)?$|^no (more )?stickers$|^switch to gifs$/.test(t)) return { do: "filter", type: "gif" };
  if (/^((only|just) )?(clean|family friendly|kid friendly|safe|g rated|rated g)( ones| gifs| stickers)?( only| please)?$|^keep it clean$|^nothing (rude|inappropriate)$/.test(t)) return { do: "filter", rating: "g" };
  if (/^((only|just) )?(pg|rated pg)( ones| gifs)?( only)?$/.test(t)) return { do: "filter", rating: "pg" };
  if (/^((only|just) )?(pg 13|pg13|rated pg 13)( ones| gifs)?( only)?$/.test(t)) return { do: "filter", rating: "pg-13" };
  if (/^(any rating|all ratings|r rated( ones| gifs)?( too| are ok| is ok)?|allow r rated)$/.test(t)) return { do: "filter", rating: "r" };
  if ((m = /^(?:(?:only|just) )?(?:from )?(giphy|klipy|imgur|the web|web)(?: only| results| ones)?$|^(?:only|just) (?:from )?(giphy|klipy|imgur|the web|web)$/.exec(t))) return { do: "filter", providers: [(m[1] ?? m[2]).replace("the web", "web")] };
  if (/^(all sources|everything|from everywhere|all of them again|every source)$/.test(t)) return { do: "filter", providers: [] };
  if ((m = new RegExp(`^(?:save|download|keep|grab) (?:gif |number |sticker |#)${NUM}$`).exec(t)) || (m = new RegExp(`^(?:save|download|keep) ${NUM}$`).exec(t))) return { do: "save", n: num(m[1]) };
  if (/^(save|download|keep|grab) (that|this|it|that one|this one|that gif|this gif|the gif|that sticker|this sticker)( for me| to my computer)?$/.test(t)) return { do: "save", n: null };
  if ((m = new RegExp(`^copy (?:the )?link (?:to|for|of) (?:number |gif )?${NUM}$`).exec(t))) return { do: "copy", n: num(m[1]), what: "link" };
  if (/^copy (the |that |its )?(link|address|url)( to (that|this|it|that one|this one))?$/.test(t)) return { do: "copy", n: null, what: "link" };
  if ((m = new RegExp(`^copy (?:gif |number |sticker |#)?${NUM}$`).exec(t))) return { do: "copy", n: num(m[1]), what: "gif" };
  if (/^copy (that|this|it|that one|this one|that gif|this gif|the gif|that sticker)$/.test(t)) return { do: "copy", n: null, what: "gif" };
  if ((m = new RegExp(`^(?:pick|use|choose|insert|attach|send|add|go with) (?:gif |number |sticker |#)?${NUM}$`).exec(t))) return { do: "pick", n: num(m[1]) };
  if (/^(pick|use|choose|insert|attach|send|add|go with) (that|this|it|that one|this one|that gif|this gif)$|^(that|this) one$/.test(t)) return { do: "pick", n: null };
  if ((m = new RegExp(`^(?:favorite|favourite|star|add) (?:number |gif )?${NUM}(?: to (?:my )?favou?rites)?$`).exec(t))) return { do: "favorite", n: num(m[1]) };
  if (/^(favorite|favourite|star|add) (that|this|it|that one|this one|that gif)( to (my )?favou?rites)?$|^(i love (that|this) one)$/.test(t)) return { do: "favorite", n: null };
  if ((m = new RegExp(`^(?:find |show (?:me )?|get )?more like (?:number |gif )?${NUM}$`).exec(t))) return { do: "similar", n: num(m[1]) };
  if (/^(find |show (me )?|get )?more like (this|that)( one)?$/.test(t)) return { do: "similar", n: null };
  if ((m = new RegExp(`^(?:open|go to|visit) (?:the )?(?:source|page|website|web page)(?: (?:for|of) (?:number )?${NUM})?$`).exec(t))) return { do: "source", n: m[1] ? num(m[1]) : null };
  if ((m = new RegExp(`^(?:show |open |view |preview |see |let me see |zoom in on |look at )?(?:me )?(?:number|gif|sticker|#) ?${NUM}(?: bigger| up close)?$`).exec(t))) return { do: "view", n: num(m[1]) };
  if ((m = new RegExp(`^(?:show |open |view )?(?:me )?the ${NUM}(?: one| gif)?$`).exec(t))) return { do: "view", n: num(m[1]) };
  return null;
}

// command(text) → a reply, or null when it isn't about GIFs. Works with or without an AI.
export async function command(text) {
  if (!enabled()) return null;
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 300) return null;
  // while GIFs are up (and the picture grid isn't the newer thing on the screen)
  if (active() && (await deps.imagesAt()) <= view.at) {
    const c = parseContext(raw);
    if (c) { try { return await doContext(c); } catch (e) { return e.message; } }
  }
  const s = parseSearch(raw);
  if (!s) return null;
  try {
    const ses = await search({ q: s.q, mode: s.mode, type: s.type, rating: s.rating });
    return searchReply(ses);
  } catch (e) { return e.message; }
}
async function doContext(c) {
  const n = c.n ?? thatOne();
  const need = () => { if (!n) throw new Error(`Which one? Say "${c.do} number 3", for example.`); const it = numbered(n); if (!it) throw new Error(`There's no number ${n} in the GIFs.`); return it; };
  switch (c.do) {
    case "close": view.closed = true; view.selected = null; broadcast("gifs", { do: "close" }); return "Closed the GIFs.";
    case "grid": view.selected = null; view.at = Date.now(); broadcast("gifs", { do: "grid", sid: view.sid }); return "Here they all are.";
    case "more": {
      const ses = gifs.session(view.sid);
      if (!ses) return "Those GIFs are gone. Search again?";
      const before = ses.items.length;
      broadcast("gifs", { do: "more", sid: ses.sid });
      await new Promise((r) => { if (ses.idle) { ses.more().then(r); return; } const off = ses.on((ev) => { if (ev.t === "done" && ses.idle) { off(); r(); } }); });
      view.at = Date.now();
      const got = ses.items.length - before;
      return got ? `Here are ${plural(got, "more GIF")}.` : "That's all the GIFs I found.";
    }
    case "filter": {
      const f = view.filters;
      const ses = await search({ q: f.q, mode: f.mode, rating: c.rating ?? f.rating, type: c.type ?? f.type, providers: c.providers ? (c.providers.length ? c.providers : null) : f.providers, pickMode: view.pickMode });
      const what = c.type ? (c.type === "sticker" ? "stickers only" : "GIFs only") : c.rating ? `rated ${ratingWord(c.rating)}${c.rating === "r" ? " and below" : " or cleaner"}` : c.providers?.length ? `only from ${LABEL[c.providers[0]]}` : "from every source";
      return ses.items.length ? `Okay, ${what}: ${plural(ses.items.length, ses.type === "sticker" ? "sticker" : "GIF")}.` : `Okay, ${what}, but I didn't find any.`;
    }
    case "view": { const it = need(); view.selected = n; view.at = Date.now(); broadcast("gifs", { do: "view", sid: view.sid, n, id: it.id }); return sayItem(n, it); }
    case "save": { const it = need(); const s = await gifs.save(it.id); broadcast("gifs", { do: "saved", sid: view.sid, n, where: s.where }); return `Saved number ${n}${s.where === "pictures" ? " to your Pictures folder, in Dayspring GIFs" : s.where === "custom" ? " to your GIF folder" : " in Dayspring's GIFs folder"}.`; }
    case "copy": { const it = need(); await copyItem(it, c.what); return c.what === "link" ? `Copied the link to number ${n}.` : `Copied number ${n}. Paste it wherever you like.`; }
    case "favorite": { const it = need(); gifs.setFavorite(it.id, true); broadcast("gifs", { do: "favorited", sid: view.sid, n, id: it.id }); return `Added number ${n} to your favourite GIFs.`; }
    case "pick": {
      const it = need();
      gifs.addRecent(it.id);
      if (view.pickMode) { broadcast("gifs", { do: "pick", sid: view.sid, n, id: it.id }); return gifs.settings().sayTitle ? `Added number ${n}, ${it.title}.` : `Added number ${n}.`; }
      view.selected = n; broadcast("gifs", { do: "view", sid: view.sid, n, id: it.id });
      return `${sayItem(n, it)} Say "copy that one" or "save that one".`;
    }
    case "similar": {
      const it = need();
      const words = it.title.replace(/\b(gif|gifs|sticker|by|giphy|klipy|imgur|animated|reaction)\b/gi, " ").replace(/\s+/g, " ").trim();
      const ses = await search({ q: words.length >= 3 ? words.split(" ").slice(0, 6).join(" ") : view.filters.q, rating: view.filters.rating, type: view.filters.type, pickMode: view.pickMode });
      return searchReply(ses);
    }
    case "source": {
      const it = need();
      if (!it.page) return `I don't know which page number ${n} came from.`;
      if (deps.openUrl) { const r = await deps.openUrl(it.page).catch(() => null); if (r?.opened || r?.dryRun) return `I opened the page for number ${n} in your browser.`; }
      return `Number ${n} is from ${LABEL[it.source]}.`;
    }
  }
  return null;
}
// a pick from the no-AI suggestion list (lib/intents/gifs.mjs)
export async function fromIntent(id, text) {
  // switched off in this build: "a GIF of …" is a picture search again
  if (!enabled()) { try { const ir = await import("../image-routes.mjs"); return (await ir.command(text)) ?? "GIFs aren't available in this version of Dayspring."; } catch { return "GIFs aren't available in this version of Dayspring."; } }
  const r = await command(text);
  if (r) return r;
  if (id === "gifs.trending" || id === "gifs.open") { try { return searchReply(await search({ mode: "trending" })); } catch (e) { return e.message; } }
  if (id === "gifs.search") {
    const words = clean(text).replace(/\b(please|can you|could you|show|find|get|give|me|some|search|look|for|a|an|the|of|gifs?|stickers?|animated)\b/g, " ").replace(/\s+/g, " ").trim();
    if (words.length < 2) return "What kind of GIF? Say \"show me a GIF of\" and what it is.";
    try { return searchReply(await search({ q: words, type: /sticker/.test(clean(text)) ? "sticker" : "gif" })); } catch (e) { return e.message; }
  }
  if (!active()) return "There aren't any GIFs up right now. Try \"show me a GIF of a dancing cat\".";
  return "I'm not sure what to do with the GIFs.";
}

// ---- the AI's tools --------------------------------------------------------------------------------------------------
export const TOOLS = [
  { name: "gif_search", description: "Find GIFs (or stickers) from GIPHY, KLIPY, Imgur and the web at once and show them in the GIF picker on the Dayspring screen, numbered. Use it when the owner wants a GIF, a reaction, or a GIF for an email or message (\"add a funny GIF about Mondays\"). Returns each result's number, title, source and rating so you can choose one with gif_pick. trending: true for what's popular (query can be empty). rating defaults to the owner's setting (usually PG-13); use \"g\" when it's for work or kids.",
    input_schema: { type: "object", properties: { query: { type: "string" }, rating: { type: "string", enum: ["g", "pg", "pg-13", "r"] }, type: { type: "string", enum: ["gif", "sticker"] }, trending: { type: "boolean" } } } },
  { name: "gif_pick", description: "Choose GIF number n from the current GIF results (after gif_search). Returns its address, size and a local file path that can be attached to an email; when the owner is composing (the picker was opened from the email editor) it is inserted there. Pick the one whose title best matches what the owner wants.",
    input_schema: { type: "object", properties: { n: { type: "number" } }, required: ["n"] } },
];
// what the AI is offered right now (nothing while GIFs are switched off)
export const tools = () => (enabled() ? TOOLS : []);
const brief = (ses) => ses.items.slice(0, 24).map((x, i) => ({ n: i + 1, title: x.title, source: LABEL[x.source], rating: x.rating, size: x.width && x.height ? `${x.width}x${x.height}` : undefined }));
export async function runTool(name, input = {}) {
  if (!enabled() && (name === "gif_search" || name === "gif_pick")) return { error: "GIFs aren't available in this version of Dayspring." };
  if (name === "gif_search") {
    const ses = await search({ q: String(input.query ?? ""), mode: input.trending || !String(input.query ?? "").trim() ? "trending" : "search", rating: input.rating, type: input.type });
    const statuses = Object.entries(ses.statuses).map(([id, s]) => `${LABEL[id]}: ${s.state}`).join(", ");
    return { shownOnScreen: ses.items.length > 0, query: ses.q, rating: ses.rating, type: ses.type, results: brief(ses), sources: statuses, note: ses.items.length ? "The GIFs are in the picker on the screen, numbered. Don't read them all out. Choose one with gif_pick, or let the owner say a number." : "Nothing found." };
  }
  if (name === "gif_pick") {
    if (!view) throw new Error("Search for GIFs first (gif_search).");
    const n = Math.floor(Number(input.n));
    const it = numbered(n);
    if (!it) throw new Error(`There's no GIF number ${n}.`);
    let file = null;
    try { const f = await gifs.file(it.id, { format: "gif" }); file = { path: f.path, name: f.name, type: f.type, bytes: f.bytes }; } catch (e) { file = { error: e.message }; }
    gifs.addRecent(it.id);
    view.selected = n;
    broadcast("gifs", view.pickMode ? { do: "pick", sid: view.sid, n, id: it.id } : { do: "view", sid: view.sid, n, id: it.id });
    return { picked: n, id: it.id, title: it.title, source: LABEL[it.source], attribution: gifs.PROVIDERS.find((p) => p.id === it.source)?.attribution?.text ?? null, url: it.gif ?? it.webp ?? it.mp4, mp4: it.mp4, width: it.width, height: it.height, page: it.page, file, insertedInEditor: Boolean(view.pickMode) };
  }
  return undefined;
}

// ---- /api/gifs/… ------------------------------------------------------------------------------------------------------
const list = (s) => String(s ?? "").split(",").map((x) => x.trim()).filter((x) => gifs.providerIds().includes(x));
function stream(req, res, ses, from) {
  res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  let ended = false;
  const end = () => { if (ended) return; ended = true; off(); try { res.end(); } catch { /* gone */ } };
  const write = (ev) => { if (!ended) { try { res.write(JSON.stringify(clientEvent(ev)) + "\n"); } catch { end(); } } };
  const off = ses.on((ev) => { write(ev); if (ev.t === "done") setImmediate(() => { if (ses.idle) end(); }); });
  for (const ev of ses.events.slice(Math.max(0, from))) write(ev);
  req.on("close", end);
  if (ses.idle) setImmediate(() => { if (ses.idle) end(); });
  return end;
}
async function settingsView() {
  const envfile = await import("../envfile.mjs");
  const keys = envfile.status(gifs.KEY_VARS);
  const target = await gifs.whereToSave();
  const s = gifs.settings();
  return { settings: s, providers: gifs.providerList().map((p) => ({ ...p, keySet: p.needsKey ? Boolean(keys[p.keyVar]?.set) : false })), save: target, cache: media.cacheUsage(), favorites: gifs.favorites().length, recents: gifs.recents().length, clipboard: process.platform === "win32" && process.env.DAYSPRING_GIFS_CLIPBOARD !== "dry" ? "system" : process.env.DAYSPRING_GIFS_CLIPBOARD === "dry" ? "dry" : "browser" };
}
export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (!p.startsWith("/gifs/")) return false;
  // the screen and Settings ask this first (it answers even when GIFs are off)
  if (p === "/gifs/enabled" && m === "GET") return send(res, 200, { enabled: enabled() }), true;
  if (!enabled()) return send(res, 404, { error: "GIFs aren't available in this version of Dayspring." }), true;
  if (p === "/gifs/media" && m === "GET") {
    try {
      const x = await media.fetchMedia(q.get("u") ?? "");
      res.writeHead(200, { "content-type": x.type, "content-length": x.buf.length, "cache-control": "private, max-age=600", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "referrer-policy": "no-referrer", "accept-ranges": "none" });
      res.end(x.buf);
    } catch (e) { res.writeHead(e.status ?? 502, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" }); res.end(String(e.message ?? "couldn't load that GIF")); }
    return true;
  }
  if (p === "/gifs/stream" && m === "GET") {
    try {
      let ses = q.get("sid") ? gifs.session(q.get("sid")) : null;
      if (q.get("sid") && !ses) return send(res, 404, { error: "Those GIFs are gone. Search again." }), true;
      if (!ses) {
        await webAllowed();
        ses = gifs.startSession({ mode: q.get("mode") === "trending" ? "trending" : "search", q: q.get("q") ?? "", rating: q.get("rating") || undefined, type: q.get("type") || undefined, providers: list(q.get("providers")) });
        if (q.get("screen") !== "0") setView(ses, { providers: list(q.get("providers")), pickMode: q.get("pick") === "1" });
      }
      const from = Number(q.get("from")) || 0;
      stream(req, res, ses, from);
      if (q.get("more") === "1") { if (ses.idle) ses.more(); }
      if (view?.sid === ses.sid) view.at = Date.now();
    } catch (e) { if (!res.headersSent) send(res, e.status ?? 400, { error: e.message }); }
    return true;
  }
  if (p === "/gifs/file" && m === "GET") {
    try {
      const f = await gifs.file(q.get("id"), { format: q.get("format") || "gif" });
      if (q.get("raw") === "1") {
        const { readFileSync } = await import("node:fs");
        const buf = readFileSync(f.path);
        res.writeHead(200, { "content-type": f.type, "content-length": buf.length, "content-disposition": `attachment; filename="${f.name.replace(/[^\w.-]/g, "_")}"`, "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" });
        res.end(buf); return true;
      }
      return send(res, 200, { id: f.id, path: f.path, name: f.name, type: f.type, bytes: f.bytes, title: f.title, source: f.source, url: f.url, href: `/api/gifs/file?id=${encodeURIComponent(f.id)}&format=${encodeURIComponent(q.get("format") || "gif")}&raw=1` }), true;
    } catch (e) { return send(res, e.status ?? 502, { error: e.message }), true; }
  }
  if (p === "/gifs/categories" && m === "GET") return send(res, 200, { categories: await gifs.categories() }), true;
  if (p === "/gifs/library" && m === "GET") return send(res, 200, { favorites: gifs.favorites().map(clientItem), recents: gifs.recents().map(clientItem) }), true;
  if (p === "/gifs/state" && m === "GET") return send(res, 200, active() ? { open: true, sid: view.sid, selected: view.selected, filters: view.filters } : { open: false }), true;
  if (p === "/gifs/settings" && m === "GET") return send(res, 200, await settingsView()), true;
  if (p === "/gifs/search" && m === "GET") {
    try { const ses = await search({ q: q.get("q") ?? "", mode: q.get("mode") === "trending" ? "trending" : "search", rating: q.get("rating") || undefined, type: q.get("type") || undefined, providers: list(q.get("providers")), screen: q.get("screen") === "1" }); return send(res, 200, { sid: ses.sid, items: ses.items.map(clientItem), statuses: ses.statuses, fallback: ses.fallback }), true; }
    catch (e) { return send(res, e.status ?? 400, { error: e.message }), true; }
  }
  if (m !== "POST") return false;
  const body = await readJSON(req).catch(() => ({}));
  try {
    if (p === "/gifs/settings") { gifs.setSettings(body ?? {}); gifs.clearCaches(); gifs._clearCategories(); return send(res, 200, await settingsView()), true; }
    if (p === "/gifs/keys") {
      const prov = gifs.PROVIDERS.find((x) => x.id === body.provider && x.keyVar);
      if (!prov) return send(res, 400, { error: "provider must be giphy, klipy or imgur" }), true;
      const key = String(body.key ?? "").trim();
      if (key && !/^[\w.-]{6,200}$/.test(key)) return send(res, 400, { error: "That doesn't look like a key. Copy it again, without spaces." }), true;
      const envfile = await import("../envfile.mjs");
      envfile.setVars({ [prov.keyVar]: key });
      gifs.keyChanged(prov.id); gifs._clearCategories();
      return send(res, 200, { provider: prov.id, keySet: Boolean(key) }), true;
    }
    if (p === "/gifs/test") return send(res, 200, { provider: body.provider, ...(await gifs.testProvider(String(body.provider ?? ""))) }), true;
    if (p === "/gifs/numbers") {
      // favourites and recents are numbered too ("number 2" works on them)
      if (/^library:(favorites|recent)$/.test(String(body.sid ?? "")) && view?.sid !== body.sid) {
        const s = gifs.settings();
        view = { sid: body.sid, at: Date.now(), closed: false, selected: null, numbers: new Map(), pickMode: Boolean(body.pickMode), filters: view?.filters ?? { q: "", mode: "trending", rating: s.rating, type: s.type, providers: null } };
      }
      if (view && view.sid === body.sid && Array.isArray(body.items)) {
        for (const x of body.items.slice(0, 2000)) { const n = Number(x?.n); if (Number.isInteger(n) && n > 0 && gifs.item(x.id)) view.numbers.set(n, String(x.id)); }
        if (typeof body.pickMode === "boolean") view.pickMode = body.pickMode;
        view.at = Date.now();
      }
      return send(res, 200, { ok: true }), true;
    }
    if (p === "/gifs/closed") { if (view && (!body.sid || view.sid === body.sid)) { view.closed = true; view.selected = null; } return send(res, 200, { ok: true }), true; }
    if (p === "/gifs/act") {
      if (!view) return send(res, 400, { error: "There aren't any GIFs up." }), true;
      if (body.action === "view") { view.selected = Number(body.n) || null; view.at = Date.now(); }
      else if (body.action === "grid") view.selected = null;
      return send(res, 200, { ok: true }), true;
    }
    if (p === "/gifs/save") { const s = await gifs.save(String(body.id ?? ""), { format: body.format }); return send(res, 200, { saved: { name: s.name, where: s.where, folder: s.folder, bytes: s.bytes } }), true; }
    if (p === "/gifs/copy") {
      const it = gifs.item(String(body.id ?? ""));
      if (!it) return send(res, 404, { error: "I don't know that GIF. Search for it again." }), true;
      const r = await copyItem(it, body.what === "link" ? "link" : "gif");
      return send(res, 200, { ...(r.dryRun ? { dryRun: true, would: { file: Boolean(r.would.file), html: Boolean(r.would.html), text: r.would.text } } : { copied: true }) }), true;
    }
    if (p === "/gifs/used") { gifs.addRecent(String(body.id ?? "")); return send(res, 200, { ok: true }), true; }
    if (p === "/gifs/favorite") { return send(res, 200, gifs.setFavorite(String(body.id ?? ""), body.on !== false)), true; }
    if (p === "/gifs/clear") {
      if (body.what === "cache") return send(res, 200, { ...media.clearCache(), cache: media.cacheUsage() }), true;
      return send(res, 200, gifs.clearList(body.what)), true;
    }
  } catch (e) { return send(res, e.status ?? 400, { error: e.message }), true; }
  return false;
}
