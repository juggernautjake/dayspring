// Research: "research …", "look into …", "explain … with sources". Several web searches, the best pages read, and a
// few videos, handed to the AI to explain in its own words with links (shown in the results panel). Works with any AI
// provider. Without an AI, "search for …" / "look up …" shows plain search results on the screen instead.
import * as web from "./web.mjs";
import * as media from "./media.mjs";
import * as permissions from "./permissions.mjs";
import * as llm from "./llm.mjs";
import * as results from "./results.mjs";

// swappable for tests (no network)
export const deps = { web, media };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

export async function research({ question, depth = "normal", videos = true } = {}) {
  const q = String(question ?? "").trim();
  if (!q) throw new Error("What should I research?");
  if (!permissions.check("web").ok) return { error: permissions.check("web").text };
  const n = { quick: 2, normal: 4, deep: 6 }[depth] ?? 4;
  // the question itself, plus angles that usually find explainers and primary sources
  const queries = [q, ...(depth === "quick" ? [] : [`${q} explained`, ...(depth === "deep" ? [`${q} official source`, `${q} latest`] : [])])];
  const seen = new Set(), found = [];
  for (const query of queries) {
    const r = await deps.web.search(query, { max: 6 }).catch(() => ({ results: [] }));
    for (const x of r.results ?? []) {
      const h = host(x.url);
      if (!x.url || seen.has(x.url) || /youtube\.com|pinterest\.|facebook\.com|instagram\.com|tiktok\.com/.test(h)) continue;
      seen.add(x.url); found.push(x);
    }
  }
  // read the best pages (different sites first)
  const picks = [], sites = new Set();
  for (const x of found) { if (picks.length >= n) break; if (sites.has(host(x.url))) continue; sites.add(host(x.url)); picks.push(x); }
  const sources = await Promise.all(picks.map(async (x) => {
    try { const p = await deps.web.read(x.url); return { title: p.title || x.title, url: p.url, site: host(p.url), snippet: x.snippet, excerpt: String(p.text ?? "").slice(0, depth === "deep" ? 6000 : 3500) }; }
    catch { return { title: x.title, url: x.url, site: host(x.url), snippet: x.snippet, excerpt: "" }; }
  }));
  let vids = [];
  if (videos) vids = (await deps.media.searchYouTube({ query: q, max: 6 }).catch(() => [])).filter((v) => v.videoId).slice(0, 3).map((v) => ({ title: v.title, channel: v.channel, videoId: v.videoId, length: v.length ?? null }));
  return {
    question: q, sources, more: found.filter((x) => !picks.includes(x)).slice(0, 6).map((x) => ({ title: x.title, url: x.url, snippet: x.snippet })), videos: vids,
    howToAnswer: "Explain it in your own words from these sources (don't invent facts; say where they disagree). Then call show_results with a short summary and items for the key points or the best sources (url on each), plus the videos (videoId). Speak a short version.",
  };
}

export const TOOLS = [
  { name: "research", description: "Research a question on the web: several searches, the best pages read, and a few YouTube videos. Use for 'research…', 'look into…', 'explain … with sources', comparisons and anything current. Then explain in your own words and call show_results with links and videos. depth: quick | normal | deep.",
    input_schema: { type: "object", properties: { question: { type: "string" }, depth: { type: "string", enum: ["quick", "normal", "deep"] }, videos: { type: "boolean" } }, required: ["question"] } },
];
export async function runTool(name, input = {}) {
  if (name !== "research") return undefined;
  try { return await research(input); } catch (e) { return { error: e.message }; }
}

// Free mode (no AI): "search for …", "look up …", "find pages about …", "research …" → the results list on the screen
export async function handle(text) {
  if (llm.ready()) return null;                         // with an AI, the assistant researches and explains
  const m = /^(?:please )?(?:search(?: the web| online| google)? for|look up|google|find (?:me )?(?:pages|info|information|websites?) (?:about|on)|research)\s+(.+?)[.?!]?$/i.exec(String(text).trim());
  if (!m) return null;
  if (!permissions.check("web").ok) return permissions.check("web").text;
  const r = await web.search(m[1], { max: 8 }).catch(() => ({ results: [] }));
  if (!r.results?.length) return `I couldn't find anything for "${m[1]}" just now.`;
  results.show({ title: `Search: ${m[1]}`, source: "the web", summary: "Tap a result to open it in your browser. (With an AI brain I could read these and explain them.)",
    items: r.results.map((x) => ({ title: x.title, detail: x.snippet, url: x.url })) });
  return `Here's what I found for ${m[1]}. The top result is ${r.results[0].title}. They're on the screen.`;
}
