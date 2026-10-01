// Which of Dayspring's ~200 tools a local model sees for one request. Small models pick well from ten tools and badly
// from two hundred (and reading them all takes seconds), so each request gets:
//   the core set (reading the schedule: every "what's on…" question needs it)
//   + the tools of the families the request is about (its words, and the offline intent matcher's best guess)
//   + the best of the rest by BM25 over the tools' names and descriptions (and embeddings, with an embedding model)
//   + whatever the last turn used (so "not that one" and "the other one" still reach the same tool)
// up to N in all (Settings → AI brain → Ollama → "Tools per request", default 10).
//   selectFor(text, history, allTools, { n }) → { tools, names, families }
import { createToolIndex, DEFAULT_SYNONYMS } from "../../vendor/ecosystem-core/lib/llm-local.mjs";
import * as llm from "../llm.mjs";

// family → [tools (by name), words that point to it]
export const FAMILIES = {
  schedule: [/^(get_agenda|get_rundown|add_block|update_block|remove_block|edit_schedule|find_free_slots|resolve_conflict|set_block_done|open_schedule|plan_fit|apply_plan_fit|do_now|apply_routines|add_routine|schedule_conflicts|resolve_calendar_conflict|calendar_events|calendar_add_event)$/,
    /\b(schedule|agenda|calendar|appointments?|meetings?|events?|plans?|busy|free time|what'?s (on|next|left|up)|what do i have|when is|when'?s|today|tomorrow|tonight|this (week|weekend|afternoon|evening|morning)|next week|(mon|tues|wednes|thurs|fri|satur|sun)day|dentist|doctor|move|reschedule|push|bump|block|routine|fit in|free slot|day look)\b/],
  reminders: [/^(set_reminder|list_reminders|cancel_reminder)$/, /\b(remind|reminders?|don'?t let me forget|nudge me|alert me)\b/],
  tasks: [/^(add_task|set_task_done|remember|log_note|write_note|todo_list|todo_add|todo_complete|todoist_tasks|todoist_add|todoist_complete|learn_about_owner|list_goals|set_goal|list_chores|chore_done|set_chore)$/,
    /\b(tasks?|to-?dos?|to do list|notes?|jot|remember|study sheet|cheat ?sheet|write (a |me a )?(note|summary|sheet)|don'?t forget|goals?|chores?|errands?|i like|my favou?rite)\b/],
  music: [/^(play_spotify|media_control|stop_media|media_status|music_library|music_video_browser|music_video_history|media_login|play_sound|media_library_search|media_library_play|music_insights|more_like_this)$/,
    /\b(play|song|songs|music|spotify|album|artist|band|playlist|track|tune|pause|resume (the |my )?(music|song|playback|video)|^resume$|skip|next song|previous|louder|quieter|volume|listen|shuffle|hymns?|worship|what'?s playing)\b/],
  video: [/^(video_find|video_queue|youtube_account_playlists|video_creator_alias|find_and_play_youtube|play_youtube|my_youtube_playlists|search_youtube|video_playlists|music_video_browser|media_login|media_control|stop_media|youtube_insights)$/,
    /\b(video|videos|youtube|watch|clip|channel|episode|sermon video|tutorial|vlog|watch later|liked videos)\b/],
  web: [/^(web_search|read_web_page|research|news_latest|news_add_feed|browse|weather_alerts)$/,
    /\b(search|look (it |that )?up|google|internet|online|web|website|news|headlines?|latest|who (is|was|won)|what (is|are|was) (a |an |the )?\w+|when (did|was)|how (many|much|far|old|tall)|price|cost|score|scores|game|weather|forecast|temperature|rain|snow|open (the )?(page|site)|what time does \w+ (open|close)|\b(open|close)s? (at|today|tonight)|(opening|closing|store) (hours|time)|directions|near me|nearest|https?:|\.com)\b/],
  images: [/^(image_search|image_control|look_at_image|gif_search|gif_pick|describe_image|read_image_text)$/, /\b(pictures?|photos?|images?|gifs?|show me (a|some)|wallpaper|meme|sticker)\b/],
  files: [/^(file_find|file_open|file_show_in_folder|find_files|search_text|list_folder|read_file|write_file|edit_file|document_find|open_document|read_document|read_aloud|open_item|create_folder|copy_item|move_item|undo_change|find_plans|save_plan|refresh_knowledge|search_activity_log|show_results|close_results)$/,
    /\b(files?|folders?|documents?|docs?|resume|pdf|spreadsheet|read (me )?(the|my)|open (the|my)|save (it|this|that)|write (a|the)|desktop|downloads|plans?|save .+ (to|in|into) .+|[\w-]+\.(txt|md|docx?|pdf|csv|xlsx?|json|pptx?)|[a-z]:\\|called|named|(pictures?|photos?|videos?) (from|of) (my|the)|img_?\d+)\b/],
  email: [/^(email_\w+|invite_\w+|meet_invite|read_texts|person_messages)$/, /\b(e-?mails?|mail|inbox|reply|send|draft|message|messages|texts?|invite|invitation|write to|tell \w+ that)\b/],
  devices: [/^(device_control|device_status|device_schedule|home_devices|home_state|home_control|webhook_run|remote_devices|remote_command)$/, /\b(lights?|lamp|fan|plugs?|switch|turn (it |that )?(on|off)|devices?|scene|thermostat|heater|tv|garage|lock|unlock|dim|brightness|office pc|living room)\b/],
  printers: [/^printer_\w+$/, /\b(printers?|print(ing)?|3d|bed|filament|nozzle)\b/],
  cameras: [/^camera_\w+$/, /\b(cameras?|cam|footage|clip|motion|trail cam|doorbell)\b/],
  study: [/^(study_\w+|get_learning_progress|list_learning_items|update_learning|log_learning_note)$/, /\b(study|studying|course|courses|lesson|lessons|module|quiz|exam|learning|homework|class)\b/],
  faith: [/^(get_scripture|search_scripture|devotion|prayer_\w+)$/, /\b(bible|verse|verses|scripture|psalm|psalms|proverbs?|gospel|john|romans|genesis|pray|prayer|devotion(al)?|memory verse|church)\b/],
  settings: [/^(set_voice_style|set_notifications|sky_set|sky_status|end_conversation)$/, /\b(voice|slower|faster|simpler|more detail|quiet|silent|chime|notifications?|sound|speakers|headphones|sky|scene|make it rain|snow|night mode|dark mode|go dark)\b/],
  help: [/^(help_guide|connections_status|media_login)$/, /\b(set ?up|connect|sign ?in|log ?in|how do i|how can i|help|settings|not working|isn'?t working|broken|link (my|your)|hook up)\b/],
  programs: [/^(open_program|close_program|list_programs|launch_claude_code|open_terminal)$/, /\b(open|launch|start|close|quit) (the |my )?(app|program|chrome|word|excel|notepad|terminal|claude|vs ?code|steam|discord)\b|\bclaude code\b/],
  conversations: [/^(search_conversations|get_conversation|screen_history)$/, /\b(what did (i|you|we) (say|talk)|we talked|you said|i said|earlier|last time|conversation)\b/],
  people: [/^(people_\w+|person_update|who_is_in_photo|name_people_in_photo|photos_of_person|face_group_action)$/, /\b(who is (in|this)|people|person|friend|family|profile of)\b/],
  money: [/^money_\w+$/, /\b(money|bank|transactions?|spend|spent|venmo|cash app|balance|subscriptions?)\b/],
  shopping: [/^shopping_\w+$/, /\b(amazon|shop(?:ping)? for|for sale|buy|purchase|reorder|order history|my orders|subscribe (and|&) save|add (it|that) to (my )?cart|checkout|prime member)\b/],
  discover: [/^(discover_now|discover_feed|interests_update|youtube_insights|music_insights)$/, /\b(discover|something new|interests?|what did you find)\b/],
};
// the offline intent matcher's families → these
const FROM_INTENT = { time: ["schedule"], schedule: ["schedule"], timers: ["reminders"], programs: ["programs", "files", "web"], bible: ["faith"], weather: ["web"], media: ["music", "video"],
  dayspring: ["settings", "help"], lists: ["tasks"], phone: ["email"], faith: ["faith"], study: ["study"], documents: ["files"], photos: ["images", "people"], recipes: ["web"], images: ["images"],
  gifs: ["images"], mail: ["email"], devices: ["devices"], printers: ["printers"], cameras: ["cameras"], discover: ["discover"], knowledge: ["web"], shopping: ["shopping"] };
// what Dayspring's owner says → the words its tools use
export const SYNONYMS = { ...DEFAULT_SYNONYMS, agenda: "schedule get", day: "agenda rundown", week: "agenda", next: "agenda", appointment: "block agenda", dentist: "block agenda", doctor: "block agenda",
  spotify: "play music song", youtube: "video find play", watch: "video youtube find", queue: "video music", sign: "login media connect", connect: "login connections help", setup: "help connect login",
  recipe: "web search cook", cook: "recipe web", forecast: "weather web search", headline: "news latest", map: "web search place", directions: "web search", restaurant: "web search place" };
export const CORE = ["get_agenda"];

const familiesOf = (text) => Object.entries(FAMILIES).filter(([, [, words]]) => words.test(text)).map(([f]) => f);
let ix = null, ixKey = "", embedTried = "";
function indexFor(tools) {
  const key = tools.map((t) => t.name).join(",");
  if (ix && key === ixKey) return ix;
  ix = createToolIndex(tools, { synonyms: SYNONYMS }); ixKey = key; embedTried = "";
  return ix;
}
// embeddings, when an embedding model is installed (Settings: "auto", or a name; "off" never): computed once in the
// background; until they're ready (or if they fail) BM25 alone picks
async function maybeEmbed(index) {
  const want = llm.localOptions().embedModel;
  if (want === "off" || embedTried === ixKey) return;
  embedTried = ixKey;
  try {
    let model = want !== "auto" ? want : null;
    if (!model) { const tags = await llm.ollama.tags(); model = tags.map((t) => t.name).find((n) => /embed|minilm|bge-|nomic|arctic-embed|granite-embedding/i.test(n)) ?? null; }
    if (!model) return;
    await index.useEmbeddings((texts) => llm.ollama.embed(model, texts));
  } catch { /* BM25 alone */ }
}

export async function selectFor(text, history = [], all = [], { n = llm.localOptions().toolsN } = {}) {
  const tools = all.filter((t) => t?.name && t.input_schema);
  const index = indexFor(tools);
  maybeEmbed(index).catch(() => {});
  const q = String(text ?? "").toLowerCase();
  const fams = new Set(familiesOf(q));
  try {
    const { plan } = await import("../intents/index.mjs");
    const p = plan(text);
    if (p?.score >= 0.55) for (const id of p.ranked.slice(0, 2).map((r) => r.id)) { const cat = String(id).split(".")[0]; for (const f of FROM_INTENT[cat] ?? FROM_INTENT[p.intent?.split(".")[0]] ?? []) fams.add(f); }
  } catch { /* the words alone */ }
  // what the last turn was about: the tools it used, and his previous words
  const recent = history.slice(-6);
  const usedBefore = recent.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((b) => b.type === "tool_use").map((b) => b.name) : []));
  const prevWords = recent.filter((m) => m.role === "user" && typeof m.content === "string").map((m) => m.content).slice(-1).join(" ");
  if (/^(not that|another|the other|try again|next one|number \d|that one|yes|no|do it|go ahead|stop)\b/i.test(q.trim()) && prevWords) for (const f of familiesOf(prevWords.toLowerCase())) fams.add(f);
  const boosts = {};
  const famTools = [];
  for (const f of fams) for (const t of tools) if (FAMILIES[f][0].test(t.name)) { boosts[t.name] = (boosts[t.name] ?? 0) + 0.9; famTools.push(t.name); }
  for (const u of usedBefore) boosts[u] = (boosts[u] ?? 0) + 0.5;
  // the family's own headline tools come first (play_spotify for music, video_find for videos, web_search for the web)
  const LEAD = { music: ["play_spotify", "media_control", "media_status"], video: ["video_find", "find_and_play_youtube", "youtube_account_playlists"], settings: ["set_notifications", "set_voice_style"], web: ["web_search", "read_web_page"], reminders: ["set_reminder"], schedule: ["add_block", "update_block"], help: ["help_guide", "media_login"], faith: ["get_scripture"], email: ["email_draft", "email_search"], devices: ["device_control"], images: ["image_search"], files: ["file_find", "find_files", "read_file", "write_file"], tasks: ["remember", "add_task", "write_note"], people: ["who_is_in_photo", "describe_image"] };
  const include = [...fams].flatMap((f) => LEAD[f] ?? []).filter((nm) => tools.some((t) => t.name === nm));
  const r = await index.select({ query: text, context: prevWords, n, core: CORE.filter((c) => tools.some((t) => t.name === c)), include, boosts });
  return { tools: r.tools, names: r.names, families: [...fams], scores: r.scores };
}
export const _reset = () => { ix = null; ixKey = ""; embedTried = ""; };
