// The photo gallery by voice, with no AI needed (server.mjs asks this before pictures from the web, the media library
// and the finder):
//   "open the photo gallery" · "show my photos" · "show my photos from last summer" · "show my photos from June 2024"
//   "show photos in the Family folder" · "show my photos of Sarah" (faces, when on) · "show my favourite photos"
//   "show me random photos" · "shuffle my photos" · "surprise me with a photo"
//   "view this in the gallery" · "open this photo's folder" · "show me where this is saved" · "open file location"
//   while it's open: "next", "previous", "scroll right", "scroll left", "start a slideshow", "stop the slideshow",
//   "shuffle again", "more", "close the gallery"   (the screen answers these itself at once; this is the fallback)
// "This" is the photo open in the gallery, else the picture in the file viewer, else the photo on the TV's card.
//   command(text, { photo }) → { reply, intent } | null
import { broadcast } from "../bus.mjs";
import * as G from "./index.mjs";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const SEASONS = { spring: [2, 5], summer: [5, 8], fall: [8, 11], autumn: [8, 11], winter: [11, 14] };   // [first month, end month) (winter runs into the next year)
const clean = (s) => String(s ?? "").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”"?!.,]/g, " ").replace(/\s+/g, " ").trim()
  .replace(/^(?:(?:hey|ok|okay) )?(?:dayspring )?(?:please |can you |could you |would you |will you |i want to |i'd like to |let's )*/, "").replace(/ (?:please|for me|now)$/, "").trim();
const PICS = "(?:photos?|pictures?|pics|images)";

// dateRange("last summer") → { from, to, said } (ms) | null
export function dateRange(text, now = new Date()) {
  const t = clean(text).replace(/^(?:from|in|during|taken in|of|back in) /, "").replace(/^the /, "");
  const Y = now.getFullYear(), M = now.getMonth();
  const range = (a, b, said) => ({ from: a.getTime(), to: b.getTime(), said });
  let m;
  if ((m = /^(last|this|past) (spring|summer|fall|autumn|winter)$|^(spring|summer|fall|autumn|winter)(?: of)? ((?:19|20)\d\d)$|^(spring|summer|fall|autumn|winter)$/.exec(t))) {
    const which = m[1] ?? (m[4] ? "year" : "this"), s = m[2] ?? m[3] ?? m[5], [a, b] = SEASONS[s];
    let y;
    if (which === "year") y = Number(m[4]) - (s === "winter" ? 1 : 0);
    else {
      // the most recent one that has started (this one: this year's, or the one going on now)
      const startOf = (yy) => new Date(yy, a, 1), endOf = (yy) => new Date(yy, b, 1);
      y = startOf(Y) <= now ? Y : Y - 1;
      if (which === "last" || which === "past") { if (endOf(y) > now) y -= 1; }
    }
    const said = which === "year" ? `${s} ${m[4]}` : `${which === "this" ? "this" : "last"} ${s}`;
    return range(new Date(y, a, 1), new Date(y, b, 1), said);
  }
  if (/^(today)$/.test(t)) return range(new Date(Y, M, now.getDate()), new Date(Y, M, now.getDate() + 1), "today");
  if (/^yesterday$/.test(t)) return range(new Date(Y, M, now.getDate() - 1), new Date(Y, M, now.getDate()), "yesterday");
  if (/^(this|past) week$/.test(t)) return range(new Date(Y, M, now.getDate() - 7), new Date(Y, M, now.getDate() + 1), "this week");
  if (/^last week$/.test(t)) return range(new Date(Y, M, now.getDate() - 14), new Date(Y, M, now.getDate() - 6), "last week");
  if (/^this month$/.test(t)) return range(new Date(Y, M, 1), new Date(Y, M + 1, 1), "this month");
  if (/^last month$/.test(t)) return range(new Date(Y, M - 1, 1), new Date(Y, M, 1), "last month");
  if (/^this year$/.test(t)) return range(new Date(Y, 0, 1), new Date(Y + 1, 0, 1), "this year");
  if (/^last year$/.test(t)) return range(new Date(Y - 1, 0, 1), new Date(Y, 0, 1), "last year");
  if ((m = /^((?:19|20)\d\d)$/.exec(t))) return range(new Date(Number(m[1]), 0, 1), new Date(Number(m[1]) + 1, 0, 1), m[1]);
  if ((m = /^(?:last )?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?: (?:of )?((?:19|20)\d\d))?$/.exec(t))) {
    const mi = MONTHS.findIndex((x) => x.startsWith(m[1].slice(0, 3)));
    const y = m[2] ? Number(m[2]) : mi > M || (/^last /.test(t) && mi === M) ? Y - 1 : Y;
    return range(new Date(y, mi, 1), new Date(y, mi + 1, 1), `${MONTHS[mi][0].toUpperCase()}${MONTHS[mi].slice(1)} ${y}`);
  }
  if ((m = /^christmas(?: ((?:19|20)\d\d))?$/.exec(t))) { const y = m[1] ? Number(m[1]) : (M === 11 && now.getDate() >= 20 ? Y : Y - 1); return range(new Date(y, 11, 18), new Date(y + 1, 0, 3), `Christmas ${y}`); }
  return null;
}

// a folder the owner named ("the Family folder"): the gallery's folder whose name fits best
function folderNamed(name) {
  const want = clean(name).replace(/^(the|my) /, "");
  if (!want) return null;
  let best = null;
  const seen = new Set();
  for (const x of allItems()) {
    for (const c of G.crumbs(x)) {
      if (seen.has(c.fid)) continue; seen.add(c.fid);
      const n = c.label.toLowerCase(), score = n === want ? 3 : n.replace(/[^a-z0-9]+/g, " ").trim() === want ? 2.5 : n.startsWith(want) ? 2 : n.includes(want) ? 1 : 0;
      if (score && (!best || score > best.score || (score === best.score && c.last && !best.last))) best = { ...c, score };
    }
  }
  return best;
}
const allItems = () => G._items();

function open(payload, reply) { broadcast("gallery", { open: payload }); return { reply, intent: "gallery.open", opened: payload }; }
function ctl(c, reply = "Okay.") { broadcast("gallery", { ctl: c }); return { reply, intent: `gallery.${c.ctl}` }; }

// the photo "this" means, as a gallery item
async function thisPhoto(ctx) {
  const cur = G.current();
  if (cur?.id) return G.find(cur.id);
  try { const S = await import("../finder/skills.mjs"); const v = S.current(); if (v?.id && v.kind === "image") { const r = S.resolve(v.id); if (r.path) return G.register(r.path).item ?? null; } } catch { /* no viewer */ }
  if (ctx.photo) return G.find(ctx.photo);
  return null;
}

export async function command(text, ctx = {}) {
  const t = clean(text);
  if (!t) return null;
  let m;
  const cur = G.current();
  // while it's open
  if (cur?.open) {
    if (/^(next|next (one|photo|picture)|scroll right|go right|swipe left|forward)$/.test(t)) return ctl({ ctl: "next" });
    if (/^(previous|back|go back|previous (one|photo|picture)|last (photo|picture)|scroll left|go left|swipe right)$/.test(t)) return ctl({ ctl: "prev" });
    if (/^((start|play|begin) (a |the )?slide ?show|slide ?show)$/.test(t)) return ctl({ ctl: "slideshow", on: true }, "Starting a slideshow.");
    if (/^(stop|end|pause) (the )?slide ?show$/.test(t)) return ctl({ ctl: "slideshow", on: false }, "Slideshow stopped.");
    if (/^(shuffle( them)? again|reshuffle|new shuffle)$/.test(t)) return ctl({ ctl: "shuffle" }, "Shuffled again.");
    if (/^(more|show more|load more|more (photos|pictures))$/.test(t)) return ctl({ ctl: "more" });
    if (/^(back to (the )?(grid|gallery|all photos)|show (the )?grid)$/.test(t)) return ctl({ ctl: "grid" });
  }
  if (/^(close|hide|exit) (the |my )?(photo |picture )?gallery$/.test(t)) return ctl({ ctl: "close" }, "Closed the gallery.");
  // this photo
  if (/^(view|show|open|see|put|look at) (this|that|it)( photo| picture| image| one)? in (the |my )?(photo |picture )?gallery$|^(view|open) in (the )?gallery$/.test(t)) {
    const x = await thisPhoto(ctx);
    if (!x) return { reply: "Which photo? Open one first, then say “view this in the gallery”.", intent: "gallery.this" };
    return open({ view: "folder", fid: G.fidOf(x.dir), focus: x.id, single: true }, `Here's ${x.name} in the gallery, with the other photos from ${G.whereText(x)}.`);
  }
  if (/^(open|show)( me)? (this|that|the) (photo|picture|image|file)'?s? (folder|location|file location)$|^show me where (this|that|it)( photo| picture| image)? (is )?saved$|^where is (this|that) (photo|picture|image) saved$|^(open|show) (the )?file location$|^(show|open) (this|that|it) in (file )?explorer$/.test(t)
    || (cur?.id && /^(show|open)( me)? (it|that|this) in (the |its )?(folder|file explorer|explorer)$|^where is (it|that|this)( saved)?$/.test(t))) {
    const x = await thisPhoto(ctx);
    if (!x) return null;
    const r = G.reveal(x.id, { via: "voice" });
    return { reply: r.reply ?? r.text ?? r.error, intent: "gallery.reveal", revealed: Boolean(r.shown) };
  }
  // random
  if (new RegExp(`^(show|give)( me)?( some| a few)? random ${PICS}$|^shuffle (my |the )?(${PICS}|photo gallery|gallery)$|^surprise me with (a|some|one of my) ${PICS}$|^(show me )?a random (photo|picture)( of mine)?$`).test(t))
    return open({ view: "random", shuffle: true }, "Here are some of your photos, shuffled. Say “shuffle again” or “more”.");
  // the gallery itself
  if (new RegExp(`^(open|show|bring up|pull up|launch|go to)( me)?( the| my)? (photo|picture|photos|pictures) (gallery|viewer|library|album)$|^(open|show)( me)?( the| my)? gallery$|^(show|open|see|view|bring up|pull up)( me)?( all)?( of)? my ${PICS}$`).test(t))
    return open({ view: "all" }, "Here's your photo gallery.");
  if (new RegExp(`^(show|open|see|view)( me)?( my)? (favou?rite|starred) ${PICS}$`).test(t)) return open({ view: "favs" }, "Your favourite photos.");
  // a folder
  if ((m = new RegExp(`^(?:show|open|view|see|pull up)(?: me)?(?: all)?(?: of)?(?: my| the)? ${PICS} (?:in|from|inside) (?:the |my )?(.+?) folder$`).exec(t))) {
    const f = folderNamed(m[1]);
    if (!f) return { reply: `I couldn't find a photo folder called “${m[1]}”.`, intent: "gallery.folder" };
    return open({ view: "folder", fid: f.fid, deep: true }, `Photos in ${f.label}.`);
  }
  // a date, a person, or (said with "my") words
  if ((m = new RegExp(`^(?:show|open|view|see|pull up|bring up|let me see|display)(?: me)?(?: all)?(?: of)?( my| the)? ${PICS} (from|of|with|taken|in|during|at) (.+)$`).exec(t))) {
    const mine = Boolean(m[1]?.trim()), rest = m[3];
    const d = dateRange(`${m[2]} ${rest}`) ?? dateRange(rest);
    if (d) return open({ view: "all", from: d.from, to: d.to, said: d.said, group: "date" }, `Your photos from ${d.said}.`);
    if (m[2] === "of" || m[2] === "with") {
      const who = (await G.peopleList()).find((p) => p.name.toLowerCase() === rest || p.name.toLowerCase().split(" ")[0] === rest);
      if (who) return open({ view: "all", person: who.id }, `Photos of ${who.name}.`);
    }
    if (mine) return open({ view: "search", q: rest }, `Your photos with “${rest}”.`);
  }
  return null;
}
export const _folderNamed = folderNamed;
