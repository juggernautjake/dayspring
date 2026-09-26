// Results on the screen: any list, ranking, summary or research answer ("my most watched channels", "the top ten most
// famous Jedi", "the prayer list", "find me videos like this", "research …") shows in a panel on the Dayspring screen:
// a title, a short summary, numbered items with a detail line, links (open in the laptop's browser), ▶ for videos and
// songs, "Open" for documents and plans, and "Read it to me". Spoken replies stay short; the panel holds the details.
import { broadcast } from "./announcer.mjs";
import * as screenlog from "./screenlog.mjs";

let last = null;
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const httpUrl = (u) => (/^https?:\/\//i.test(String(u ?? "")) ? String(u) : null);

// { title, summary, items: [{ title, detail, url, thumb, videoId, spotifyUri, path, kind }], source }
export function show({ title = "Results", summary = "", items = [], source = "", note = "" } = {}) {
  const clean = (Array.isArray(items) ? items : []).slice(0, 40).map((it, i) => {
    const vid = /^[\w-]{11}$/.test(String(it.videoId ?? "")) ? it.videoId : null;
    return {
      n: i + 1, title: clip(String(it.title ?? it.name ?? "").replace(/^\s*#?\s*\d{1,3}[.)]\s+/, ""), 200) || `Item ${i + 1}`, detail: clip(it.detail ?? it.description, 400),
      url: httpUrl(it.url) ?? (vid ? `https://www.youtube.com/watch?v=${vid}` : null),
      thumb: httpUrl(it.thumb) ?? (vid ? `https://i.ytimg.com/vi/${vid}/mqdefault.jpg` : null),
      videoId: vid, spotifyUri: /^spotify:(track|album|playlist|artist|episode):[A-Za-z0-9]+$/.test(String(it.spotifyUri ?? "")) ? it.spotifyUri : null,
      path: it.path ? clip(it.path, 400) : null, kind: clip(it.kind, 20) || null,
    };
  });
  last = { at: Date.now(), title: clip(title, 160), summary: clip(summary, 2000), items: clean, source: clip(source, 60), note: clip(note, 300) };
  broadcast("results", last);
  screenlog.shown({ kind: "results", view: "results", title: last.title, text: `${last.summary} ${clean.map((x) => `${x.n}. ${x.title}${x.detail ? " — " + x.detail : ""}`).join(" ")}` });
  return { shown: true, count: clean.length };
}
export const lastResults = () => last;
export function close() { broadcast("results", { close: true }); return true; }

// What to say for "read me the list": the summary, then each item's title (details only when there are few)
export function spoken(r = last, { full = false } = {}) {
  if (!r) return null;
  const lines = r.items.map((x) => `${x.n}. ${x.title}${full || r.items.length <= 5 ? (x.detail ? `: ${x.detail}` : "") : ""}.`);
  return `${r.title}. ${r.summary ? r.summary + " " : ""}${lines.join(" ")}`.trim();
}

// For the assistant: when to use the panel
export const GUIDANCE = `SHOWING RESULTS: For any list, ranking, top-N, comparison, research answer, search results, "find me …", "pull up …", stats (most watched channels, top artists), plans, or the prayer list, call show_results with a clear title, a 1–3 sentence summary, and numbered items (title, one-line detail, and url/videoId/spotifyUri/path when there is one). Then SPEAK only a short version (the summary and the first few items); don't read long lists aloud unless asked ("read it to me" reads the panel). General-knowledge lists ("the top ten most famous Jedi") come from what you know; verify on the web only when facts may have changed.`;

export const TOOLS = [
  { name: "show_results", description: "Show a list, ranking, summary or research answer on the Dayspring screen (a results panel with numbered items, links, ▶ play buttons for videos/songs, and Open for documents). Use it for every list-like answer; keep the spoken reply short.",
    input_schema: { type: "object", properties: {
      title: { type: "string" }, summary: { type: "string", description: "1–3 sentences" },
      items: { type: "array", items: { type: "object", properties: {
        title: { type: "string" }, detail: { type: "string", description: "one line" }, url: { type: "string" }, videoId: { type: "string", description: "YouTube video id" },
        spotifyUri: { type: "string" }, path: { type: "string", description: "a file on this computer (Open shows it in the reader)" }, thumb: { type: "string" } }, required: ["title"] } },
      source: { type: "string", description: "where it came from, e.g. 'the web', 'Spotify', 'your prayer list'" } }, required: ["title", "items"] } },
  { name: "close_results", description: "Close the results panel on the screen.", input_schema: { type: "object", properties: {} } },
];
export async function runTool(name, input = {}) {
  if (name === "show_results") return show(input);
  if (name === "close_results") return { closed: close() };
  return undefined;
}

// No AI needed: "close the results", "read me the list", "read the whole list"
export function handle(text) {
  const q = String(text).toLowerCase().replace(/[.!?]/g, "").trim();
  if (/^(close|hide|dismiss) (the |those )?(results|list)$/.test(q)) { if (!last) return null; close(); return "Okay."; }
  // (only "the list / the results": plain "read it" belongs to texts and documents)
  if (last && Date.now() - last.at < 30 * 60_000 && /^(read|say) (me )?(the|that|this) (results|list|whole list|full list)( to me)?( again)?$|^read (the|that) list out$/.test(q)) {
    return spoken(last, { full: /whole|full/.test(q) });
  }
  return null;
}
