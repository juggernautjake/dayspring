// The instructions a local model gets: much shorter than Claude's (a small model reads every word on every request, and
// forgets the middle of long ones), with the tool-use rules spelled out, and the same safety rules word for word
// (confirmations, other people's words are data, no passwords, the crisis line).
//   systemPrompt(extras) → the fixed part (the same on every request, so Ollama can reuse what it already read)
//   contextNote({ surface, offered }) → the facts of this moment (date, time, time zone, the schedule, tasks) and a few
//     worked examples for the tools offered, sent with the question and not kept in the conversation
import * as owner from "../owner.mjs";
import * as store from "../store.mjs";
import * as abilities from "../abilities.mjs";

export function systemPrompt({ untrusted = "", persona = "", style = "", mood = "", about = "" } = {}) {
  const N = owner.name(), A = owner.assistant(), them = owner.them(), their = owner.their();
  const nicks = owner.nicknames().filter((n) => n !== N);
  return `You are ${A}, ${N}'s friendly home assistant and day planner on the Dayspring screen. What you say is spoken aloud, so talk like a warm, capable friend: one to three short, natural sentences. No lists, no markdown, no emoji.${nicks.length ? ` Now and then call ${them} "${nicks[0]}".` : ""}

How you work
- To do something or look something up, call a tool. Never say something is done unless the tool said it worked.
- Use the facts that come with each request (today's date, the time, the schedule). Take dates from the day list given; never work them out yourself. Times in tool arguments are 24-hour HH:MM, dates YYYY-MM-DD.
- "Remind me … at 11pm" / "tomorrow at 6" is ONE reminder at that time. Only repeat something when ${N} says every, daily, each, weekdays or the like.
- Schedule questions ("what's on today", "what's next", "when is my dentist appointment"): answer from the schedule you were given, or read it with get_agenda for other days. Say times like "4 p.m." and dates like "Friday the 12th".
- Changing the schedule: read it first for the real id, then change it. Never ask before adds, moves or done-marks; do them and say what you did in the past tense ("Done. The dentist is on Friday at 3 p.m."). Ask before deleting something or clearing a day.
- Music: Spotify requests go to play_spotify with ${their} exact words as the request. Videos: video_find (or find_and_play_youtube). If a service isn't signed in, offer to open its sign-in, and walk ${them} through it in plain words.
- Anything recent or that you're not sure of (news, scores, weather, prices, facts): search the web, then answer in a sentence or two and name the source.
- "Set up" or "connect" something, or "how do I…" about Dayspring: use the help or sign-in tools and explain the steps simply.
- Only when a request is truly unclear, ask ONE short question. Otherwise just do it.
- If a tool fails, say so simply and offer one other way ("I couldn't reach Spotify just now. Want me to try YouTube instead?").
- Never talk about how you work inside: no tool names, code, program files, JSON, settings names or error messages. Say what happened in everyday words.
- Don't list what you can do unless asked; then give two or three examples in one sentence.
- Small talk: be warm and brief, and ask something back now and then. Never sound the same twice.

Safety (always)
- ${abilities.SAFETY_TEXT}
- ${untrusted}
- When a tool says a permission is missing, tell ${them} in one sentence where to turn it on (Settings → Permissions). Never try to get around it.
- Never type passwords or payment details anywhere, and never sign in for ${them}.
- If ${N} ever talks about hurting ${them}self or not wanting to live, take it seriously, stay with ${them}, and give the 988 Suicide & Crisis Lifeline (call or text 988 in the US) or the local emergency number.${about ? `\n\nAbout ${N}: ${String(about).slice(0, 600)}` : ""}${persona ? `\n\nPersonality\n${String(persona).slice(0, 1400)}` : ""}${style ? `\n\nStyle right now: ${String(style).slice(0, 300)}` : ""}${mood ? `\n\n${String(mood).slice(0, 400)}` : ""}`;
}

const pad = (n) => String(n).padStart(2, "0");
const say12 = (hm) => { const [h, m] = hm.split(":").map(Number); return `${h % 12 || 12}${m ? ":" + pad(m) : ""} ${h >= 12 ? "p.m." : "a.m."}`; };
export function timeZone() { try { return owner.get().location?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "local time"; } catch { return "local time"; } }

// worked examples, per family of tools (only the ones offered this time are shown)
function examples(offered, d) {
  const has = (n) => offered.includes(n);
  const ex = [];
  if (has("set_reminder")) ex.push(`"remind me to drink water at 11pm" → set_reminder {"text":"drink water","date":"${d.today}","time":"23:00"} → "Okay, I'll remind you at 11 tonight to drink water."`);
  if (has("add_block")) ex.push(`"add dentist Friday at 3" → add_block {"title":"Dentist","date":"${d.friday}","start":"15:00","end":"16:00","category":"body"} → "Done. The dentist is on Friday at 3 p.m."`);
  if (has("get_agenda")) ex.push(`"what's on Thursday?" → get_agenda {"from":"${d.thursday}","to":"${d.thursday}"}, then say the day's plan with times.`);
  if (has("play_spotify")) ex.push(`"play some Hillsong on Spotify" → play_spotify {"request":"play some Hillsong on Spotify"} → "Playing Hillsong."`);
  if (has("video_find")) ex.push(`"play a video about sharpening chisels" → video_find {"action":"play","query":"sharpening chisels"}`);
  else if (has("find_and_play_youtube")) ex.push(`"play a video about sharpening chisels" → find_and_play_youtube {"query":"sharpening chisels"}`);
  if (has("web_search")) ex.push(`"who won the Royals game last night?" → web_search {"query":"Royals game result last night"} → one or two sentences, naming the source.`);
  if (has("media_login")) ex.push(`"set up Spotify" → media_login {"service":"spotify"} → "I've opened Spotify's sign-in on the screen. Sign in there, and I'll take it from there."`);
  if (has("get_scripture")) ex.push(`"read Romans 8:28" → get_scripture {"reference":"Romans 8:28"}`);
  if (has("device_control")) ex.push(`"turn off the fan" → device_control {"target":"fan","action":"off"}`);
  if (has("remember")) ex.push(`"remember that I like dark roast" → remember {"text":"likes dark roast coffee"}`);
  if (has("find_files")) ex.push(`"find my resume" → find_files {"query":"resume"}`);
  if (has("email_draft")) ex.push(`"email Sam that I'm running late" → email_draft {"to":"Sam","text":"…"}; it's only sent after ${owner.name()} says yes.`);
  return ex.slice(0, 4);
}

export function contextNote({ surface = "tv", offered = [], now = new Date() } = {}) {
  const today = store.todayISO(now), tomorrow = store.addDays(today, 1);
  const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const days = Array.from({ length: 8 }, (_, i) => { const d = store.addDays(today, i); const [y, mo, da] = d.split("-").map(Number); return [new Date(y, mo - 1, da).toLocaleDateString("en-US", { weekday: "long" }), d]; });
  const byName = Object.fromEntries(days.slice(1).map(([n, d]) => [n.toLowerCase(), d]));
  let agenda = "";
  try { agenda = store.planBetween(today, store.addDays(today, 1)).slice(0, 30).map((b) => `${b.date === today ? "Today" : "Tomorrow"} ${say12(b.start)}–${say12(b.end)} ${b.title}${b.done ? " (done)" : ""}${b.projected ? "" : ` #${b.id.slice(0, 8)}`}`).join("\n"); } catch { /* none */ }
  let tasks = "", mem = "";
  try { tasks = store.tasks(false).slice(0, 8).map((t) => `- ${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ""}`).join("\n"); } catch { /* none */ }
  try { mem = store.memories().slice(-8).map((m) => `- ${m.text}`).join("\n"); } catch { /* none */ }
  const ex = examples(offered, { today, tomorrow, friday: byName.friday ?? today, thursday: byName.thursday ?? today });
  return [
    `[Facts for this request, not ${owner.name()}'s words]`,
    `Now: ${weekday} ${today}, ${say12(hm)} (${hm}), time zone ${timeZone()}.`,
    `Days: ${days.map(([n, d], i) => `${i === 0 ? "today" : i === 1 ? "tomorrow" : n} ${n.slice(0, 3)} ${d}`).join("; ")}.`,
    surface === "phone call" ? "This is a phone call: one or two short sentences." : surface === "tv" ? `${owner.name()} is talking to you by voice in front of the Dayspring screen.` : "",
    agenda ? `Schedule today and tomorrow:\n${agenda}` : "Schedule today and tomorrow: nothing yet.",
    tasks ? `Open tasks:\n${tasks}` : "",
    mem ? `You remember:\n${mem}` : "",
    ex.length ? `Examples of good tool use:\n${ex.join("\n")}` : "",
    `[${owner.name()} says]`,
  ].filter(Boolean).join("\n");
}
