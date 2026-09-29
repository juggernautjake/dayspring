// Image search on the Dayspring screen: the /api/images routes, what people say ("show me pictures of golden
// retrievers", "show number 3 bigger", "more", "save that one", "close images"), and the AI's tools
// (image_search, look_at_image). The search itself is lib/imagesearch.mjs.
//   /api/images/proxy?u=<address>   one picture, fetched by Dayspring (never by the screen: no hotlinking, the owner's
//                                   address isn't handed to every site, private addresses refused, image/* only, 8 MB)
//   /api/images/state · search · act · settings · keys
// What's on screen is kept here and sent to the screen as the "images" event (public/images.js draws it).
import * as imgs from "./imagesearch.mjs";
import { broadcast } from "./bus.mjs";
import * as screenlog from "./screenlog.mjs";
import { on as featureOn } from "./features.mjs";   // "images" (beta): off → no commands, no tools, no routes

const PER_PAGE = 12;
let view = null;          // { query, filters, page, results (this page), offset, total, more, selected, source, at, all: Map n → item }
let lastSaved = null;
let deps = { vision: null, openUrl: null, permissionsCheck: async () => (await import("./permissions.mjs")).check("web") };
export function setDeps(d) { deps = { ...deps, ...d }; }
export const current = () => view;
export function _reset() { view = null; lastSaved = null; visionShown = null; }
// the grid counts as "on screen" for half an hour after it was last used
const active = () => Boolean(view && !view.closed && Date.now() - view.at < 30 * 60_000);

// someone in the owner's people (lib/special.mjs, already loaded by the assistant)
async function knownPerson(name) {
  const n = String(name ?? "").trim().replace(/'s$/i, "");
  if (!n) return false;
  try { const sp = await import("./special.mjs"); return Boolean(sp.profileOf(n) ?? sp.allProfiles().find((p) => p.nickname && p.nickname.toLowerCase() === n.toLowerCase())); } catch { return false; }
}
const proxied = (u) => (u ? `/api/images/proxy?u=${encodeURIComponent(u)}` : null);
function screenView() {
  if (!view || view.closed) return { open: false };
  return {
    open: true, query: view.query, filters: view.filters, page: view.page, perPage: PER_PAGE, total: view.total, more: view.more, source: view.source, safeSearch: view.safeSearch,
    selected: view.selected ?? null, note: view.note ?? null,
    items: view.results.map((x, i) => ({ n: view.offset + i + 1, title: x.title, sourceDomain: x.sourceDomain, sourcePage: x.sourcePage, width: x.width, height: x.height, thumb: proxied(x.thumbUrl), full: proxied(x.fullUrl) })),
    big: view.selected ? (() => { const x = view.all.get(view.selected); return x ? { n: view.selected, title: x.title, sourceDomain: x.sourceDomain, sourcePage: x.sourcePage, width: x.width, height: x.height, thumb: proxied(x.thumbUrl), full: proxied(x.fullUrl) } : null; })() : null,
  };
}
function push() { const v = screenView(); broadcast("images", v); syncVision(); return v; }

// "describe this picture", "what does this say?", "who's in this picture?" work on the picture shown big: it's told to
// lib/vision/describe.mjs as a web picture (described, never identified), with its bytes fetched once through the safe
// fetcher. Back to the grid, a new search or closing clears it again, so it never hides a photo shown after. Vision is
// only loaded once a picture is shown big.
let visionShown = null;                 // the address told to vision, or null
function syncVision() {
  const it = view && !view.closed && view.selected ? view.all.get(view.selected) : null;
  const url = it ? it.fullUrl || it.thumbUrl : null;
  if (url === visionShown) return;
  const had = visionShown; visionShown = url;
  const vision = deps.vision ? Promise.resolve(deps.vision) : import("./vision/describe.mjs");
  vision.then(async (v) => {
    if (!url) { const s = v.onScreen(); if (s?.kind === "web" && s.url === had) v.setOnScreen(null); return; }
    const title = String(it.title ?? "");
    v.setOnScreen({ kind: "web", url, title });
    const img = await imgs.fetchImage(it.fullUrl || it.thumbUrl).catch(() => (it.thumbUrl ? imgs.fetchImage(it.thumbUrl) : null)).catch(() => null);
    if (img && visionShown === url) v.setOnScreen({ kind: "web", url, buffer: img.buf, title });
  }).catch(() => {});
}

// ---- doing things -------------------------------------------------------------------------------------------------------
export async function doSearch(query, filters = {}, { page = 0 } = {}) {
  const perm = await deps.permissionsCheck().catch(() => ({ ok: true }));
  if (perm && perm.ok === false) throw new Error(perm.text || "Looking things up online is turned off.");
  const r = await imgs.search(query, { filters, page, perPage: PER_PAGE });
  const keep = view && view.query === r.query && JSON.stringify(view.filters) === JSON.stringify(r.filters) ? view.all : new Map();
  r.results.forEach((x, i) => keep.set(r.offset + i + 1, x));
  view = { query: r.query, filters: r.filters, page, results: r.results, offset: r.offset, total: r.total, more: r.more, source: r.source, safeSearch: r.safeSearch, selected: null, at: Date.now(), all: keep, tried: r.tried };
  push();
  if (r.results.length) screenlog.shown({ kind: "images", view: "images", title: `Pictures of ${r.query}`, text: r.results.map((x, i) => `${r.offset + i + 1}. ${x.title} (${x.sourceDomain})`).join(" ") });
  return r;
}
const byNumber = (n) => (view ? view.all.get(Number(n)) ?? null : null);
function select(n) {
  if (!active()) throw new Error("There aren't any pictures up right now. Try \"show me pictures of…\".");
  const it = byNumber(n);
  if (!it) throw new Error(`There's no number ${n} on the screen.`);
  view.selected = Number(n); view.at = Date.now(); push();
  return it;
}
export function close() { if (view) { view.closed = true; view.selected = null; } broadcast("images", { open: false }); syncVision(); return true; }
async function page(delta) {
  if (!active()) throw new Error("There aren't any pictures up right now.");
  const next = Math.max(0, view.page + delta);
  if (delta > 0 && !view.more) return null;
  if (delta < 0 && view.page === 0) return view;
  await doSearch(view.query, view.filters, { page: next });
  return view;
}
// "that one": the one shown big, else the only one, else the last one mentioned
const thatOne = () => view?.selected ?? (view?.results.length === 1 ? view.offset + 1 : null);
export async function saveNumber(n) {
  const num = n ?? thatOne();
  if (!active()) throw new Error("There aren't any pictures up right now.");
  if (!num) throw new Error("Which one? Say \"save number 3\", for example.");
  const it = byNumber(num);
  if (!it) throw new Error(`There's no number ${num} on the screen.`);
  const r = await imgs.save(it, { query: view.query });
  lastSaved = { ...r, n: num };
  return { ...r, n: num, title: it.title, sourcePage: it.sourcePage, sourceDomain: it.sourceDomain };
}

// ---- what people say --------------------------------------------------------------------------------------------------
const NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, to: 2, too: 2, for: 4, won: 1 };
const NUM = "(\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)";
const ORD = "(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)";
const num = (s) => (s == null ? null : /^\d+$/.test(s) ? Number(s) : NUMW[s] ?? null);
const PIC = "(?:pictures?|photos?|photographs?|images?|pics?|wallpapers?|clip ?art|drawings?|gifs?|pngs?|jpe?gs?|icons?|illustrations?)";
const COLORS_RE = /\b(red|orange|yellow|green|blue|purple|pink|brown|black|gr[ae]y|teal|white)\b/;

// filter words said along with the search ("a transparent png of a lantern", "wallpapers of mountains")
export function filtersFrom(words) {
  const f = {}, w = ` ${words} `;
  if (/\btransparent\b|\bpngs?\b|\bno background\b|\bcut ?out\b/.test(w)) f.type = "transparent";
  else if (/\b(gifs?|animated)\b/.test(w)) f.type = "gif";
  else if (/\bclip ?art\b|\bcartoons?\b/.test(w)) f.type = "clipart";
  else if (/\b(line )?drawings?\b|\bline art\b|\bsketch(es)?\b/.test(w)) f.type = "line";
  else if (/\b(real )?(photos?|photographs?)\b/.test(w) && /\b(real|actual|only|just)\b/.test(w)) f.type = "photo";
  if (/\bwallpapers?\b|\bdesktop background\b/.test(w)) f.size = "wallpaper";
  else if (/\b(large|big|high res(olution)?|hd|4k|huge)\b/.test(w)) f.size = "large";
  else if (/\b(small|tiny|little)\b/.test(w) && /\b(small|tiny) (ones|pictures|images|photos)\b/.test(w)) f.size = "small";
  if (/\bblack and white\b|\bmonochrome\b|\bgr[ae]yscale\b/.test(w)) f.color = "mono";
  if (/\b(square)\b/.test(w)) f.layout = "square"; else if (/\b(wide|landscape|panoramic)\b/.test(w)) f.layout = "wide"; else if (/\b(tall|portrait|vertical)\b/.test(w) && !/\bportrait of\b/.test(w)) f.layout = "tall";
  if (/\b(from )?(today|the last day)\b/.test(w)) f.recent = "day"; else if (/\b(this|past|last) week\b/.test(w)) f.recent = "week"; else if (/\b(recent|latest|newest|this month|new)\b/.test(w)) f.recent = "month"; else if (/\bthis year\b/.test(w)) f.recent = "year";
  let m;
  if ((m = /\bsite:\s*([\w.-]+)/.exec(w)) || (m = /\b(?:from|on) (?:the )?(wikipedia|wikimedia|unsplash|pexels|pixabay|flickr|reddit|pinterest|nasa|instagram|etsy|amazon|[\w-]+\.(?:com|org|net|gov|edu|io|co\.uk))\b/.exec(w)) || (m = /\bonly from ([\w.-]+)\b/.exec(w))) f.site = m[1];
  return f;
}
// what to actually search for, without the filter words
function subject(words) {
  return String(words)
    .replace(/\bsite:\s*[\w.-]+/g, " ")
    .replace(/\b(?:from|on) (?:the )?(wikipedia|wikimedia|unsplash|pexels|pixabay|flickr|reddit|pinterest|nasa|instagram|etsy|amazon|[\w-]+\.(?:com|org|net|gov|edu|io|co\.uk))\b/g, " ")
    .replace(/\b(please|for me|on (the )?screen|real quick|right now)\b/g, " ")
    .replace(/\b(from )?(today|this week|last week|the past week|this month|this year)\b/g, " ")
    .replace(/[?.!]+$/, "").replace(/\s+/g, " ").trim();
}
// "show me pictures of golden retrievers" → { query: "golden retrievers", filters }
export function parseSearch(text) {
  const t = String(text).toLowerCase().replace(/[’']/g, "").replace(/^(hey |ok |okay )?dayspring,?\s+/, "").replace(/[,]/g, " ").replace(/\s+/g, " ").trim();
  let m, pre = "", q = null;
  const lead = "(?:(?:can|could|would|will) you |please |go |and )*(?:show me|show|find me|find|get me|get|give me|search for|search|look up|look for|pull up|bring up|display|i want to see|i wanna see|let me see|lets see|let us see|i need|google|bing)";
  if ((m = new RegExp(`^(?:image|images|picture|photo|pic) search (?:for |of )?(.+)$`).exec(t))) q = m[1];
  else if ((m = new RegExp(`^(?:search|google|bing|look up|find) (?:the web |online |the internet )?(?:for )?(?:images?|pictures?|photos?|pics?) (?:of |for |showing )?(.+)$`).exec(t))) q = m[1];
  else if ((m = new RegExp(`^${lead} (?:me )?((?:some |a few |a couple of |a |an |the |more |other |different |any )?(?:[a-z0-9]+ ){0,3}?)${PIC} (?:of|for|showing|with) (.+)$`).exec(t))) { pre = m[1]; q = m[2]; }
  else if ((m = new RegExp(`^(?:what (?:does|do) (?:a |an |the )?)(.+?) look like$`).exec(t)) && !/^(it|that|this|he|she|they|i|you|we|my|me)\b/.test(m[1])) { q = m[1]; }
  else if ((m = new RegExp(`^(?:${lead} )?(?:some |a few |a couple of )?((?:[a-z0-9]+ ){0,3}?)${PIC} of (.+)$`).exec(t))) { pre = m[1]; q = m[2]; }
  if (!q) return null;
  // the owner's own photos ("pictures of my kids", "photos of us") are for the photo slideshow, not the web
  if (/^(my|me|us|our|mine|myself|ourselves|this computer)\b/.test(q.trim())) return null;
  if (/^(the )?(screen|schedule|calendar|calender)\b/.test(q.trim())) return null;
  const filters = filtersFrom(`${pre} ${t.includes("png") ? "png" : ""} ${t.includes("gif") ? "gif" : ""} ${/\bwallpapers?\b/.test(t) ? "wallpaper" : ""} ${q}`);
  let query = subject(q);
  // filter words said as part of the subject ("a lantern transparent png") come off the end
  query = query.replace(/\b(transparent|png|pngs|gif|gifs|animated|clip ?art|wallpapers?|in black and white|black and white|in hd|in 4k|high res(olution)?)\b/g, " ").replace(/\s+/g, " ").trim();
  query = query.replace(/^(a|an|the|some) /, "");
  if (!query || query.length < 2) return null;
  return { query, filters };
}
// refining what's on screen: "only photos", "bigger ones", "from wikipedia", "any size"
export function parseRefine(text) {
  const t = String(text).toLowerCase().replace(/[’']/g, "").replace(/[?.!,]/g, "").trim();
  const f = {};
  if (/^(show )?(me )?(all of them|any (kind|size|type)|clear (the )?filters|no filters|remove (the )?filters|all (kinds|sizes|types))( again)?$/.test(t)) return { clear: true };
  const body = t.replace(/^((only|just|now|and|but|with|find|get|show( me)?|make (them|it))\s+)+/, "").trim();
  if (/^(photos?|photographs?|real (ones|photos|pictures)|actual photos)( only)?$/.test(body)) f.type = "photo";
  else if (/^(clip ?art|cartoons?|clip ?art ones|cartoon ones)( only)?$/.test(body)) f.type = "clipart";
  else if (/^(gifs?|animated( ones)?|moving ones)( only)?$/.test(body)) f.type = "gif";
  else if (/^(transparent( ones| pngs?)?|pngs?|ones with no background)( only)?$/.test(body)) f.type = "transparent";
  else if (/^(line drawings?|drawings?|sketches)( only)?$/.test(body)) f.type = "line";
  else if (/^(bigger|larger|big|large|higher res(olution)?|hi ?res|hd|high quality)( ones| pictures| images| photos)?( only)?$/.test(body)) f.size = "large";
  else if (/^(smaller|small|tiny)( ones| pictures| images)?( only)?$/.test(body)) f.size = "small";
  else if (/^wallpapers?( size)?( ones)?$/.test(body)) f.size = "wallpaper";
  else if (/^(in )?(black and white|monochrome|gr[ae]yscale)( ones)?( only)?$/.test(body)) f.color = "mono";
  else if (COLORS_RE.test(body) && /^(the )?(in )?(red|orange|yellow|green|blue|purple|pink|brown|black|gr[ae]y|teal|white)( ones| pictures| images)?( only)?$/.test(body)) f.color = COLORS_RE.exec(body)[1];
  else if (/^(square)( ones)?$/.test(body)) f.layout = "square";
  else if (/^(wide|landscape|wider)( ones)?$/.test(body)) f.layout = "wide";
  else if (/^(tall|portrait|vertical|taller)( ones)?$/.test(body)) f.layout = "tall";
  else if (/^(recent|newer|new|latest|newest)( ones| pictures| images)?( only)?$/.test(body)) f.recent = "month";
  else { const s = /^(?:ones )?(?:from|on) (?:the )?([\w.-]+)( only)?$|^site:\s*([\w.-]+)$/.exec(body); if (s) f.site = s[1] ?? s[3]; }
  return Object.keys(f).length ? { filters: f } : null;
}
// everything else said while pictures are up
export function parseContext(text) {
  const t = String(text).toLowerCase().replace(/[’']/g, "").replace(/[?.!,]/g, "").replace(/\s+/g, " ").trim().replace(/^(hey |ok |okay )?dayspring /, "").replace(/ please$/, "").replace(/^please /, "");
  let m;
  if (/^(close|hide|dismiss|clear|exit|stop showing|put away|get rid of)( the| those| these| all)?( web)? (images?|pictures?|photos?|pics?|image search|image results|picture results)$|^(close|hide) (it|that|them)$|^(no more|done with|enough) (pictures|images|photos)$/.test(t)) return { do: "close" };
  if (/^(more|next|next page|show more|more (pictures|images|photos|results|please|of them)|show me more( pictures| images)?|next (pictures|images|ones|twelve|12)|the next (page|ones|twelve)|keep going|load more)$/.test(t)) return { do: "more" };
  if (/^(previous|previous page|back|go back|the previous (page|ones)|last page|the ones before)$/.test(t)) return { do: "prev" };
  if (/^(back to|show) (the |all the )?(grid|all of them|results|all (the )?(pictures|images))$|^(smaller|shrink it|make it smaller|show them all)$/.test(t)) return { do: "grid" };
  if ((m = new RegExp(`^(?:find |show (?:me )?|get )?more (?:like|similar to) (?:(?:number|picture|image|photo|pic) )?${NUM}$`).exec(t)) || (m = new RegExp(`^(?:find |show (?:me )?|get )?more (?:like|similar to) the ${ORD}(?: one)?$`).exec(t))) return { do: "similar", n: num(m[1]) };
  if (/^(find |show (me )?|get )?more like (this|that)( one)?$|^(find |show )?similar( ones| pictures| images)?$/.test(t)) return { do: "similar", n: null };
  if ((m = new RegExp(`^(?:save|download|keep|grab) (?:number |picture |image |photo |pic )${NUM}$`).exec(t)) || (m = new RegExp(`^(?:save|download|keep|grab) the ${ORD}(?: one| picture| image)?$`).exec(t)) || (m = new RegExp(`^(?:save|download|keep|grab) ${NUM}$`).exec(t))) return { do: "save", n: num(m[1]) };
  if (/^(save|download|keep|grab) (that|this|it|that one|this one|that picture|this picture|that image|this image|the picture|the image)( for me)?$/.test(t)) return { do: "save", n: null };
  if ((m = new RegExp(`^(?:open|go to|visit|show me) (?:the )?(?:source|site|page|website|web page)(?: (?:for|of) (?:number |picture )?${NUM})?$`).exec(t))) return { do: "source", n: m[1] ? num(m[1]) : null };
  if ((m = new RegExp(`^(?:show|open|zoom (?:in )?(?:on|to)|enlarge|view|see|look at|let me see|go to|pick|select)? ?(?:me )?(?:number|picture|image|photo|pic|#) ?${NUM}(?: (?:bigger|larger|big|full ?screen|up close|closer))?$`).exec(t)) && !/^\d/.test(t)) return { do: "view", n: num(m[1]) };
  if ((m = new RegExp(`^(?:show|open|zoom (?:in )?(?:on|to)|enlarge|view) ${NUM}(?: (?:bigger|larger|big|full ?screen))?$`).exec(t))) return { do: "view", n: num(m[1]) };
  if ((m = new RegExp(`^(?:show|open|zoom (?:in )?on|enlarge|view|let me see|i like) (?:me )?the ${ORD}(?: one| picture| image| photo)?(?: (?:bigger|larger|big|full ?screen))?$`).exec(t))) return { do: "view", n: num(m[1]) };
  if ((m = new RegExp(`^make (?:number |picture )?${NUM} bigger$`).exec(t))) return { do: "view", n: num(m[1]) };
  if ((m = new RegExp(`^the ${ORD}(?: one| picture| image| photo)?$`).exec(t))) return { do: "view", n: num(m[1]) };
  return null;
}

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const listed = (r) => r.results.slice(0, 3).map((x, i) => `${r.offset + i + 1}, ${x.title.slice(0, 60)}`).join("; ");
const filterWords = (f) => [f.type === "photo" ? "photos only" : f.type ? `${f.type === "clipart" ? "clip art" : f.type === "gif" ? "GIFs" : f.type === "line" ? "line drawings" : "transparent"}` : null, f.size ? `${f.size} size` : null, f.color ? (f.color === "mono" ? "black and white" : f.color) : null, f.layout ?? null, f.recent ? `from the past ${f.recent}` : null, f.site ? `from ${f.site}` : null].filter(Boolean).join(", ");
async function searchReply(query, filters, { refine = false } = {}) {
  const r = await doSearch(query, filters);
  if (!r.results.length) {
    const failed = r.tried?.every((x) => !x.ok);
    return failed ? `I couldn't reach any picture search just now, so I couldn't look for ${query}.` : `I didn't find any pictures of ${query}${filterWords(r.filters) ? ` (${filterWords(r.filters)})` : ""}.`;
  }
  const fw = filterWords(r.filters);
  return `${refine ? "Okay, here" : "Here"} ${r.results.length === 1 ? "is 1 picture" : `are ${r.results.length} pictures`} of ${r.query}${fw ? `, ${fw}` : ""}. Say "show number 3" to see one bigger${r.more ? `, or "more" for the next ones` : ""}.`;
}

// command(text) → a reply, or null when it isn't about web pictures. Works with or without an AI.
export async function command(text) {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 300) return null;
  if (!featureOn("images")) return null;   // switched off (release channels, lib/features.mjs)
  const tl = raw.toLowerCase().replace(/[’']/g, "");
  // SafeSearch, any time
  let m;
  if ((m = /\b(?:set |turn )?safe ?search (?:to |on |mode )?(strict|moderate|off|on)\b|\b(?:turn|switch) (on|off) safe ?search\b|\bsafe ?search (on|off)\b/.exec(tl))) {
    const v = m[1] ?? m[2] ?? m[3]; const level = v === "on" ? "moderate" : v;
    imgs.setPrefs({ safeSearch: level });
    return level === "off" ? "SafeSearch is off for picture searches." : `SafeSearch is set to ${level} for picture searches.`;
  }
  if (active()) {
    const c = parseContext(raw);
    if (c) {
      try {
        switch (c.do) {
          case "close": close(); return "Closed the pictures.";
          case "more": { const v = await page(1); if (!v) return "That's all the pictures I found."; return `Here are ${plural(v.results.length, "more picture")}, numbers ${v.offset + 1} to ${v.offset + v.results.length}.`; }
          case "prev": { const was = view.page; const v = await page(-1); return was === 0 ? "These are the first ones." : `Back to numbers ${v.offset + 1} to ${v.offset + v.results.length}.`; }
          case "grid": view.selected = null; view.at = Date.now(); push(); return "Here they all are.";
          case "view": { const it = select(c.n); return `Number ${c.n}: ${it.title}${it.sourceDomain ? `, from ${it.sourceDomain}` : ""}.`; }
          case "save": { const s = await saveNumber(c.n); return `Saved number ${s.n}${s.where === "pictures" ? " to your Pictures folder, in Dayspring" : " in Dayspring's images folder"}${s.thumbnailOnly ? " (only the small version could be downloaded)" : ""}. I noted where it came from${s.sourceDomain ? `: ${s.sourceDomain}` : ""}.`; }
          case "source": {
            const n = c.n ?? thatOne(); const it = n ? byNumber(n) : null;
            if (!it) return "Which one? Say \"open the source for number 3\".";
            if (!it.sourcePage) return `I don't know which page number ${n} came from.`;
            if (deps.openUrl) { const r = await deps.openUrl(it.sourcePage).catch(() => null); if (r?.opened || r?.dryRun) return `I opened the page for number ${n} in your browser.`; }
            return `Number ${n} is from ${it.sourceDomain}. The link is under the picture.`;
          }
          case "similar": {
            const n = c.n ?? thatOne(); const it = n ? byNumber(n) : null;
            if (!it) return "More like which one? Say \"more like number 4\".";
            const words = it.title.replace(/\.(jpe?g|png|gif|webp)\b/gi, " ").replace(/[|•·–—:_-]+.*$/, "").replace(/\b(stock|photo|photos|image|images|picture|pictures|free|download|hd|wallpaper|royalty|vector|png|jpg)\b/gi, " ").replace(/\s+/g, " ").trim();
            const q = words.length >= 3 && words.split(" ").length <= 10 ? words : `${view.query}`;
            return await searchReply(q, view.filters, { refine: true });
          }
        }
      } catch (e) { return e.message; }
    }
    const rf = parseRefine(raw);
    if (rf) {
      try {
        if (rf.clear) return await searchReply(view.query, {}, { refine: true });
        return await searchReply(view.query, { ...view.filters, ...rf.filters }, { refine: true });
      } catch (e) { return e.message; }
    }
  }
  // "show me photos of Sarah" when Sarah is someone the owner knows: their own photos (lib/vision), not a web search
  if ((m = /^(?:(?:hey )?dayspring[, ]+)?(?:can you |please )?(?:show|find|pull up|bring up)(?: me)? (?:the |my |some )?(?:photos|pictures|pics) (?:of|with) ([\p{L}][\p{L} .'-]{0,40}?)[?.!]*$/iu.exec(raw)) && await knownPerson(m[1])) return null;
  const s = parseSearch(raw);
  if (!s) return null;
  try { return await searchReply(s.query, s.filters); }
  catch (e) { return e.message; }
}

// a pick from the no-AI suggestion list (lib/intents/images.mjs): do that thing with the words that were said
export async function fromIntent(id, text) {
  const t = String(text ?? "").toLowerCase();
  const n = num((new RegExp(`\\b${NUM}\\b`).exec(t) ?? [])[1] ?? null);
  try {
    if (id === "images.search") {
      const words = subject(t.replace(/\b(please|can you|could you|would you|show|find|get|give|me|some|search|look|for|google|bing|image|images|picture|pictures|photo|photos|pics?|of|i want to see|what does|look like)\b/g, " ").replace(/\s+/g, " ").trim()).replace(/^(a|an|the) /, "");
      return words.length >= 2 ? await searchReply(words, filtersFrom(t)) : "What would you like to see pictures of? Say \"show me pictures of\" and what it is.";
    }
    // "show number 3" with nothing numbered up: said plainly (never the book of Numbers, never a guess)
    if (!active() && id === "images.view") return "There's nothing numbered on the screen right now.";
    if (!active()) return "There aren't any pictures up right now. Try \"show me pictures of golden retrievers\".";
    if (id === "images.view") { if (!n) return "Which number?"; const it = select(n); return `Number ${n}: ${it.title}.`; }
    if (id === "images.more") { const v = await page(1); return v ? `Here are ${plural(v.results.length, "more picture")}.` : "That's all the pictures I found."; }
    if (id === "images.save") { const s = await saveNumber(n); return `Saved number ${s.n}${s.where === "pictures" ? " to your Pictures folder, in Dayspring" : " in Dayspring's images folder"}.`; }
    if (id === "images.close") { close(); return "Closed the pictures."; }
  } catch (e) { return e.message; }
  return "I'm not sure what to do with the pictures.";
}

// ---- the AI's tools --------------------------------------------------------------------------------------------------
const FILTER_SCHEMA = { type: "object", description: "Optional filters", properties: {
  size: { type: "string", enum: ["small", "medium", "large", "wallpaper"] }, type: { type: "string", enum: ["photo", "clipart", "gif", "transparent", "line"] },
  color: { type: "string", description: "color, mono, or a colour name (red, blue…)" }, layout: { type: "string", enum: ["square", "wide", "tall"] },
  recent: { type: "string", enum: ["day", "week", "month", "year"] }, site: { type: "string", description: "Only from this site, e.g. wikipedia.org" } } };
export const TOOLS = [
  { name: "image_search", description: "Search the web for pictures and show them on the Dayspring screen as a numbered grid (12 at a time; the owner can say \"show number 3\", \"more\", \"save that one\"). Use it whenever the owner wants to see pictures/photos/images of something. Returns each result's number, title, size and source site so you can describe them briefly. page: 0 for the first twelve, 1 for the next, …",
    input_schema: { type: "object", properties: { query: { type: "string" }, filters: FILTER_SCHEMA, page: { type: "number" } }, required: ["query"] } },
  { name: "image_control", description: "Control the pictures on the Dayspring screen: view one bigger (n), more / previous page, back to the grid, save one (n; it goes to the owner's Pictures folder if allowed, else Dayspring's data/images), or close.",
    input_schema: { type: "object", properties: { action: { type: "string", enum: ["view", "more", "previous", "grid", "save", "close"] }, n: { type: "number" } }, required: ["action"] } },
  { name: "look_at_image", description: "Look at pictures from the current image search (by their numbers on the screen) to answer questions about what they show, like \"which of these has a red door?\". Describe what's visible; NEVER say who a real person in a picture is (don't recognise or name people from their faces).",
    input_schema: { type: "object", properties: { n: { type: "number", description: "One picture's number" }, numbers: { type: "array", items: { type: "number" }, description: "Several numbers at once (up to 12)" }, question: { type: "string", description: "What to look for, e.g. \"a red door\"" } } } },
];
// what the AI is offered right now: looking at pictures needs a model that sees (Claude) or lib/vision/describe.mjs
imgs.describer().catch(() => {});            // finds out (in the background) whether lib/vision is there
export function tools({ provider = "none" } = {}) {
  const canSee = provider === "anthropic" || imgs.hasDescriber();
  return TOOLS.filter((t) => t.name !== "look_at_image" || canSee);
}
const brief = (r) => r.results.map((x, i) => ({ n: r.offset + i + 1, title: x.title, site: x.sourceDomain, size: x.width && x.height ? `${x.width}x${x.height}` : undefined }));
export async function runTool(name, input = {}, { provider = "none" } = {}) {
  if (name === "image_search") {
    const r = await doSearch(String(input.query ?? ""), input.filters ?? {}, { page: Math.max(0, Math.floor(Number(input.page) || 0)) });
    return { shownOnScreen: r.results.length > 0, query: r.query, filters: r.filters, results: brief(r), more: r.more, note: r.results.length ? "The pictures are on the screen now; don't list them all out loud. People in them may be described but never identified." : "Nothing found." };
  }
  if (name === "image_control") {
    const a = input.action;
    if (a === "close") { close(); return { closed: true }; }
    if (a === "view") { const it = select(input.n); return { showing: input.n, title: it.title, site: it.sourceDomain }; }
    if (a === "more" || a === "previous") { const v = await page(a === "more" ? 1 : -1); return v ? { showing: brief(v) } : { note: "No more pictures." }; }
    if (a === "grid") { if (view) { view.selected = null; push(); } return { ok: true }; }
    if (a === "save") { const s = await saveNumber(input.n); return { saved: s.name, folder: s.where === "pictures" ? "Pictures\\Dayspring" : "Dayspring's data/images", thumbnailOnly: s.thumbnailOnly }; }
    throw new Error("unknown action");
  }
  if (name === "look_at_image") {
    if (!active()) throw new Error("There aren't any pictures up right now.");
    const ns = [...new Set([...(Array.isArray(input.numbers) ? input.numbers : []), ...(input.n != null ? [input.n] : [])].map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 12);
    const list = ns.length ? ns : view.results.map((_, i) => view.offset + i + 1);
    const describe = await imgs.describer();
    const sees = provider === "anthropic";
    if (!sees && !describe) throw new Error("This AI can't look at pictures.");
    // Claude looks at the thumbnails itself; lib/vision adds what it reads locally (text in the picture, colours) for a
    // few. Other AIs get lib/vision's words (it describes web pictures and never says who anyone is), for up to 6.
    const question = String(input.question ?? "").slice(0, 300);
    const blocks = [{ type: "text", text: "Pictures from the image search (describe what is visible; never identify real people):" }];
    const texts = [];
    for (const [i, n] of list.entries()) {
      const it = byNumber(n);
      if (!it) { texts.push({ n, error: "not on the screen" }); blocks.push({ type: "text", text: `Number ${n}: not on the screen.` }); continue; }
      try {
        const img = await imgs.fetchImage(it.thumbUrl);
        let words = null;
        if (describe && (sees ? list.length <= 4 : i < 6)) {
          try { const r = await describe(img.buf, { detail: "brief", question, title: it.title, ai: sees ? false : undefined }); words = String(typeof r === "string" ? r : r?.text ?? "").slice(0, 1200) || null; } catch { words = null; }
        }
        texts.push({ n, title: it.title, site: it.sourceDomain, description: words ?? undefined });
        if (sees && ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(img.type)) {
          blocks.push({ type: "text", text: `Number ${n}: "${it.title}" (${it.sourceDomain})${words ? `. Noticed on this computer: ${words}` : ""}` }, { type: "image", source: { type: "base64", media_type: img.type, data: img.buf.toString("base64") } });
        } else if (sees) blocks.push({ type: "text", text: `Number ${n}: "${it.title}", ${words ?? `a ${img.type} picture I can't pass along`}` });
      } catch (e) { texts.push({ n, error: e.message }); blocks.push({ type: "text", text: `Number ${n}: couldn't load (${e.message}).` }); }
    }
    if (sees) return { toolContent: blocks };
    return { pictures: texts, note: "Describe what's visible; never identify real people." };
  }
  return undefined;
}

// ---- /api/images/… ----------------------------------------------------------------------------------------------------
const KEYS = { brave: ["BRAVE_SEARCH_API_KEY"], google: ["GOOGLE_CSE_KEY", "GOOGLE_CSE_ID"], bing: ["BING_IMAGE_SEARCH_KEY"] };
export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (!p.startsWith("/images/")) return false;
  if (p === "/images/proxy" && m === "GET") {
    const u = q.get("u") ?? "";
    try {
      const img = await imgs.fetchImage(u);
      res.writeHead(200, { "content-type": img.type, "content-length": img.buf.length, "cache-control": "private, max-age=600", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "referrer-policy": "no-referrer" });
      res.end(img.buf);
    } catch (e) {
      res.writeHead(e.status ?? 502, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
      res.end(String(e.message ?? "couldn't load that picture"));
    }
    return true;
  }
  const body = m === "POST" ? await readJSON(req).catch(() => ({})) : {};
  if (p === "/images/state" && m === "GET") return send(res, 200, screenView()), true;
  if (p === "/images/search" && m === "POST") {
    try { const r = await doSearch(String(body.query ?? ""), body.filters ?? {}, { page: Number(body.page) || 0 }); return send(res, 200, { ...screenView(), found: r.results.length, tried: r.tried }), true; }
    catch (e) { return send(res, 400, { error: e.message }), true; }
  }
  if (p === "/images/act" && m === "POST") {
    try {
      const a = String(body.action ?? "");
      if (a === "view") select(body.n);
      else if (a === "grid") { if (view) { view.selected = null; view.at = Date.now(); push(); } }
      else if (a === "close") close();
      else if (a === "more" || a === "prev") await page(a === "more" ? 1 : -1);
      else if (a === "save") {
        const s = await saveNumber(body.n);
        // saved where the photo gallery may show it (Pictures › Dayspring): its id, for 📂 Open file location and 🖼 View in gallery
        let id = null; try { const F = await import("./features.mjs"); if (F.on("gallery")) { const g = (await import("./gallery/index.mjs")).register(s.path); id = g.id ?? null; } } catch { /* not in a permitted place: no file location */ }
        return send(res, 200, { saved: { name: s.name, where: s.where, thumbnailOnly: s.thumbnailOnly, id } }), true;
      }
      else return send(res, 400, { error: "unknown action" }), true;
      return send(res, 200, screenView()), true;
    } catch (e) { return send(res, 400, { error: e.message }), true; }
  }
  if (p === "/images/settings") {
    if (m === "POST") { try { imgs.setPrefs({ safeSearch: body.safeSearch }); } catch (e) { return send(res, 400, { error: e.message }), true; } }
    return send(res, 200, { ...imgs.prefs(), keys: imgs.keysSet(), order: imgs.order() }), true;
  }
  // optional search keys: written to .env through envfile (only these names; values never come back or get logged)
  if (p === "/images/keys") {
    const envfile = await import("./envfile.mjs");
    if (m === "POST") {
      const names = KEYS[body.service];
      if (!names) return send(res, 400, { error: "service must be brave, google or bing" }), true;
      const vars = {};
      if (body.service === "google") { vars.GOOGLE_CSE_KEY = body.key ?? ""; vars.GOOGLE_CSE_ID = body.id ?? ""; } else vars[names[0]] = body.key ?? "";
      try { envfile.setVars(vars); imgs._clearCache(); } catch (e) { return send(res, 400, { error: e.message }), true; }
    }
    return send(res, 200, { keys: envfile.status(imgs.KEY_VARS), using: imgs.keysSet() }), true;
  }
  return false;
}
