// Lists, stats, research and the prayer list — one entry point for the assistant:
//   TOOLS / runTool(name, input)   show_results, close_results, prayer_*, youtube_insights, music_insights, more_like_this, research
//   handle(text)                   the no-AI phrases (results panel, prayer list, stats, "more like this", plans, free-mode search)
//   GUIDANCE                       what the AI is told about showing results
import * as results from "./results.mjs";
import * as prayer from "./prayerskills.mjs";
import * as insights from "./insights.mjs";
import * as research from "./research.mjs";

export const TOOLS = [...results.TOOLS, ...prayer.TOOLS, ...insights.TOOLS, ...research.TOOLS];
export const GUIDANCE = results.GUIDANCE + " Plans made together in conversation: when the owner wants to keep one, save it with save_plan; \"pull up my plans\" → find_plans, then show_results with each plan's path so it can be opened.";
export async function runTool(name, input) {
  for (const m of [results, prayer, insights, research]) { const r = await m.runTool(name, input); if (r !== undefined) return r; }
  return undefined;
}

const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
function showStats(title, r, source) {
  if (!r.items?.length) return r.note ?? "I don't have enough to go on yet.";
  results.show({ title, source: r.source ?? source, summary: r.note ?? "", items: r.items });
  const top = r.items.slice(0, 3).map((x) => x.title);
  return `${title}: ${top.join(", ")}${r.items.length > 3 ? ", and more on the screen" : ""}.${r.note ? " " + r.note : ""}`;
}

export async function handle(text) {
  const t = String(text).trim(), q = t.toLowerCase().replace(/[.!?]/g, "").trim();
  const r0 = results.handle(t); if (r0) return r0;
  const p = prayer.handle(t); if (p) return p;
  let m;
  // stats
  if (/\b(most|top|favorite|favourite)\b.*\b(youtube )?(channels?)\b|\bmost watched\b/.test(q) && /\b(youtube|channel|watch)/.test(q)) {
    const period = /\bweek\b/.test(q) ? "week" : /\byear\b/.test(q) ? "year" : /\b(all time|ever)\b/.test(q) ? "all" : "month";
    const top = /\bvideos?\b/.test(q) && !/\bchannels?\b/.test(q) ? "videos" : "channels";
    return showStats(top === "videos" ? "Your most watched videos" : "Your most watched YouTube channels", await insights.youtubeInsights({ period, top }), "YouTube");
  }
  if (/\b(most|top|favorite|favourite)\b.*\b(artists?|bands?|singers?|songs?|tracks?|music)\b|\bmost listened\b|\bwhat have i been listening to\b/.test(q) && !/\byoutube\b/.test(q)) {
    const kind = /\bwhat have i been listening\b|\brecently\b/.test(q) ? "recent" : /\b(songs?|tracks?)\b/.test(q) && !/\bartists?\b/.test(q) ? "tracks" : "artists";
    const range = /\b(this month|lately|recently|past month|last month)\b/.test(q) ? "short" : /\b(all time|ever|years?)\b/.test(q) ? "long" : "medium";
    return showStats(kind === "tracks" ? "Your top songs" : kind === "recent" ? "What you've been listening to" : "Your top artists", await insights.musicInsights({ kind, range }), "Spotify");
  }
  // more like this
  const ml = /^(?:find|show|get|play)? ?(?:me )?(?:some )?more (?:videos|songs|music|stuff|things)? ?like (?:this|that|it|(.+))$/.exec(q) ?? /^(?:find|recommend) (?:me )?(?:videos|songs|music) like (?:this|that|it|(.+))$/.exec(q);
  if (ml) {
    const kind = /\b(songs?|music|artists?|band)\b/.test(q) ? "music" : "video";
    const seed = ml[1] ?? "";
    const r = await insights.moreLike({ kind, seed });
    return showStats(`More ${kind === "music" ? "music" : "videos"} like ${seed ? titleCase(seed) : "this"}`, r, kind === "music" ? "Spotify" : "YouTube");
  }
  // plans
  if (/^(pull up|show|open|find|list|what are) (me )?(all )?(of )?my plans?$|^(pull up|show) (the )?plans? i('ve)? made$/.test(q)) {
    const ab = await import("./abilities.mjs");
    const r = await ab.run("find_plans", {});
    if (r?.denied || r?.error) return r.text ?? r.error;
    if (!r?.plans?.length) return r?.note ?? "I don't see any plans yet.";
    results.show({ title: "Your plans", source: "your files", summary: `${r.plans.length} plan${r.plans.length === 1 ? "" : "s"}. Tap Open to read one.`,
      items: r.plans.map((x) => ({ title: x.title, detail: `${x.saved ? "Saved with Dayspring" : "On your computer"}${x.modified ? " · " + x.modified : ""}`, path: x.path })) });
    return `You have ${r.plans.length} plan${r.plans.length === 1 ? "" : "s"}: ${r.plans.slice(0, 3).map((x) => x.title).join(", ")}${r.plans.length > 3 ? ", and more" : ""}. They're on the screen.`;
  }
  // free mode: a plain web search list
  return research.handle(t);
}
