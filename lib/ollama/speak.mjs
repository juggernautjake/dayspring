// What a local model says, made fit to say out loud. Small models leak their insides: tool names ("I'll use
// play_spotify"), JSON, the program's file paths, stack traces, error codes ("ECONNREFUSED", "status 500"). None of that
// is ever spoken or shown: sentences carrying it are dropped, markdown goes, and when nothing sensible is left (or a
// tool failed and the model just repeated the error) a friendly sentence about what didn't work takes its place.
//   cleanReply(text, { toolNames, failed: [{ name, error }] }) → text
const MOOD = /^\s*((?:⟪|\[\[?|\{)\s*mood\s*[:=][^⟫\]}]*(?:⟫|\]\]?|\}))\s*/i;
// the program's own insides, never the owner's things (his "resume.docx" can be named; "lib/music/index.mjs" can't)
const CODE_PATH = /(?:[A-Za-z]:\\|\/)?(?:[\w.-]+[\\/])*[\w.-]+\.(?:mjs|cjs|js|ts|json|py|env|ps1|cs|log)\b|\b(?:node_modules|apps[\\/]desk|lib[\\/]\w+|vendor[\\/]ecosystem-core|data[\\/]\w+\.json)\b/;
const STACK = /\bat \w[\w.<>]*\s*\((?:file|node):|\n\s+at |\b(?:TypeError|ReferenceError|SyntaxError|RangeError|AbortError|FetchError)\b|\bUnhandled\b/;
const ERRCODE = /\b(?:E[A-Z]{3,}|ECONN\w*|ENOTFOUND|ETIMEDOUT|EFIRSTTOKEN|EACCES|EPERM|HTTP ?\d{3}|status(?: code)? \d{3}|\d{3} (?:error|bad request|unauthorized|forbidden|not found|internal server error))\b/i;
const TECH = /\b(?:JSON|API (?:call|request|response|error)|endpoint|payload|schema|stack trace|undefined|null value|NaN|tool[_ ]?calls?|function calls?|(?:my|the|a|this) (?:tool|function)s? (?:to|called|named|for|returned|failed|result)|tool results?|call(?:ing|ed)? (?:the )?\w+_\w+|(?:the|required|missing) (?:parameter|argument)s?|arguments? (?:for|to) (?:the )?\w+_\w+|the (?:system )?prompt|system message|confirm_token|block_id|compose_id|\w+_id)\b/i;
const VERB_ID = /\b(?:get|set|add|list|play|open|find|read|search|update|remove|cancel|show|close|apply|log|write|edit|create|copy|move|undo|study|sky|email|invite|drive|media|video|image|gif|device|printer|camera|money|people|person|prayer|todo|todoist|notion|news|help|chore|music|youtube|remote|discover|interests|calendar|web|look|describe|who|name|photos|refresh|launch|end|do|plan|save|search)_[a-z_]+\b/;
const SNAKE3 = /\b[a-z]+_[a-z]+_[a-z_]+\b/;
const FENCED = /```[\s\S]*?```/g;
const JSONISH = /[{[]\s*"[\w ]+"\s*:[\s\S]*?[}\]]/g;

// friendly words for what failed, by the kind of tool
const FAIL = [
  [/spotify|music_|media_|play_sound/, "I couldn't reach Spotify just now. Want me to try YouTube instead?"],
  [/youtube|video_|music_video/, "I couldn't get that video going just now. Want me to try again?"],
  [/web_search|read_web_page|research|news_|browse/, "I couldn't get online to look that up just now. Want me to try again in a moment?"],
  [/email_|invite_|meet_invite|read_texts/, "I couldn't reach your email just now. Want me to try again?"],
  [/block|agenda|schedule|routine|rundown|conflict|calendar_|plan_fit|do_now/, "I couldn't change the schedule just then. Want me to try that again?"],
  [/reminder/, "I couldn't set that reminder just then. Want me to try again?"],
  [/device_|home_|webhook|remote_/, "I couldn't reach that device just now. Is it switched on and connected?"],
  [/printer_/, "I couldn't reach the printer just now."],
  [/camera_/, "I couldn't reach that camera just now."],
  [/file|folder|document|read_aloud|open_item|copy_item|move_item|note|plan/, "I couldn't get to that file just now."],
  [/image_|gif_|describe_image|look_at_image/, "I couldn't get the pictures just now. Want me to try again?"],
  [/drive_/, "I couldn't reach your Google Drive just now."],
  [/study_|learning/, "I couldn't open your course just now."],
  [/scripture|prayer|devotion/, "I couldn't get that passage just now."],
];
export function friendlyFailure(name = "") { for (const [re, say] of FAIL) if (re.test(name)) return say; return "Sorry, that didn't work just now. Want me to try again?"; }
// a tool's own "permission is off" / "not connected" answers are useful as they are: those words stay
const USEFUL_FAIL = /\b(permission|settings|turn (it )?on|isn'?t (connected|set up|signed in)|sign in|connect)\b/i;

export function cleanReply(text, { toolNames = [], failed = [] } = {}) {
  let s = String(text ?? "");
  const mood = MOOD.exec(s); if (mood) s = s.slice(mood[0].length);
  const names = new Set(toolNames);
  s = s.replace(/<\/?(tool_call|tool_calls|functioncall|tool_response)>|<\|[a-z_]+\|>|\[TOOL_CALLS\]/gi, " ").replace(FENCED, " ").replace(JSONISH, " ");
  // markdown → plain speech
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|[.,!?]|$)/g, "$1$2").replace(/^#{1,6}\s*/gm, "").replace(/^\s*[-*•]\s+/gm, "").replace(/^\s*\d+\.\s+/gm, "").replace(/`([^`]+)`/g, "$1");
  const bad = (x) => CODE_PATH.test(x) || STACK.test(x) || ERRCODE.test(x) || TECH.test(x) || VERB_ID.test(x) || SNAKE3.test(x) || [...names].some((n) => n.includes("_") && x.includes(n));
  const sentences = s.replace(/\s*\n+\s*/g, " ").split(/(?<=[.!?])\s+(?=[A-Z"'(])/).map((x) => x.trim()).filter(Boolean);
  let kept = sentences.filter((x) => !bad(x));
  let out = kept.join(" ").replace(/\s{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
  const lastFail = failed.at(-1);
  const leaked = kept.length < sentences.length;
  if (!out || (!/[a-z]{3}/i.test(out))) out = lastFail ? (USEFUL_FAIL.test(String(lastFail.error)) && !bad(String(lastFail.error)) ? String(lastFail.error) : friendlyFailure(lastFail.name)) : leaked ? "Sorry, I got my wires crossed there. Could you say that again?" : out;
  else if (lastFail && leaked && !/\b(couldn'?t|can'?t|didn'?t|unable|not able|sorry|trouble)\b/i.test(out)) out = friendlyFailure(lastFail.name) + " " + out;
  return (mood ? mood[1] + " " : "") + out;
}
