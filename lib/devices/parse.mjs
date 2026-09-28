// Understanding what the owner says about devices, with no AI: "turn on my computer", "turn fan number 2 off", "turn
// on 3D printer number 3", "is the TV on?", "turn everything off in the office at 10 pm", "what's on right now?",
// "movie mode", "set the desk lights to blue", "dim the bedroom lamp to 30 percent", "open the garage door".
//   parse(text, now?) → null | { kind, action?, value?, target?, scope?, when? }
//     kind: control · set · status · whatson · list · page · scene · schedules · cancelschedule
//     scope: { all: true, room?, type? }  (everything / everything in a room / all the fans)
//     when:  { at: ISO, label } or { daily: "HH:MM", days?, label }
import { norm, typeFromWords } from "./model.mjs";
import { time as findTime, duration as findDuration, date as findDate, sayTime } from "../intents/slots.mjs";

const LEAD = /^(?:(?:hey|ok|okay|so)\s+)?(?:dayspring\s+)?(?:(?:can|could|would|will) you\s+|please\s+|i want you to\s+|i need you to\s+|go ahead and\s+|i'd like you to\s+)*(?:please\s+)?/;
const TAIL = /\s+(?:please|for me|now|right now|thanks|thank you)$/;
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => d.toISOString();

// ---- when ------------------------------------------------------------------------------------------------------------
// the time clause at the end of a command: "… at 10 pm", "… in 30 minutes", "… tomorrow at 7", "… every night at 10"
const WHEN_START = /\s+(?=(?:at|by|around)\s+(?:\d|noon|midnight)|in\s+(?:\d+|a|an|half(?: an)?)\s+(?:min|minute|minutes|hour|hours|hr|hrs|sec|seconds)\b|tonight\b|tomorrow\b|this (?:evening|afternoon|morning)\b|every\s|each\s|daily\b|nightly\b|on weekdays\b|every weekday\b)/;
export function splitWhen(q, now = new Date()) {
  const m = WHEN_START.exec(q);
  if (!m) return { head: q, when: null };
  const head = q.slice(0, m.index).trim(), tail = q.slice(m.index).trim();
  const t = tail.replace(/\bmins?\b/g, "minutes").replace(/\bhrs?\b/g, "hours");
  const daily = /\b(every (?:day|night|morning|evening|afternoon)|each (?:day|night|morning|evening)|daily|nightly)\b/.test(t);
  const weekdays = /\b(weekdays?|every weekday|on weekdays)\b/.test(t);
  let hm = findTime(t)?.hm ?? null;
  if (!hm && /\btonight\b/.test(t) && !/\bat\b/.test(t)) hm = "21:00";
  if ((daily || weekdays) && hm) {
    const days = weekdays ? [1, 2, 3, 4, 5] : undefined;
    return { head, when: { daily: hm, ...(days ? { days } : {}), label: `${weekdays ? "every weekday" : "every day"} at ${sayTime(hm)}` } };
  }
  const du = /^in\s/.test(t) ? findDuration(t) : null;
  if (du) { const at = new Date(now.getTime() + du.ms); return { head, when: { at: iso(at), label: `in ${Math.round(du.ms / 60000)} minute${Math.round(du.ms / 60000) === 1 ? "" : "s"}` } }; }
  if (hm) {
    const d = findDate(t, now);
    const [h, mi] = hm.split(":").map(Number);
    let at = d ? new Date(`${d.iso}T${hm}:00`) : new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, mi, 0, 0);
    if (!d && at <= now) at = new Date(at.getTime() + 86400000);
    const today = at.toDateString() === now.toDateString(), tomorrow = at.toDateString() === new Date(now.getTime() + 86400000).toDateString();
    return { head, when: { at: iso(at), label: `${today ? "" : tomorrow ? "tomorrow " : `on ${at.toLocaleDateString("en-US", { weekday: "long" })} `}at ${sayTime(hm)}` } };
  }
  return { head: q, when: null };
}

// ---- the thing it's about ---------------------------------------------------------------------------------------------
const ALL = /^(?:every ?thing|all(?: devices| my devices| the devices| of them| of it)?|all (?:my |the )?(?:stuff|things)|every device|the whole (?:house|place|home))$/;
// "everything in the office", "all the lights in the garage", "all the fans", "the office"
export function scopeOf(target) {
  let t = target.replace(/^(?:the|my|our)\s+/, "");
  let m;
  if ((m = /^(?:every ?thing|all(?: (?:my |the )?(?:devices|stuff|things))?)\s+(?:in|on|at|from)\s+(?:the |my )?(.+)$/.exec(t))) return { all: true, room: m[1].trim() };
  if ((m = /^(?:all|every)\s+(?:of\s+)?(?:the\s+|my\s+)?(.+?)(?:\s+(?:in|on|at)\s+(?:the |my )?(.+))?$/.exec(t)) && !ALL.test(t)) {
    const type = typeFromWords(m[1].trim());
    if (type) return { all: true, type, ...(m[2] ? { room: m[2].trim() } : {}) };
  }
  if ((m = /^(?:the\s+)?(.+?)\s+in\s+(?:the |my )?(.+)$/.exec(t)) && typeFromWords(m[1]) && /s$/.test(m[1])) return { all: true, type: typeFromWords(m[1]), room: m[2].trim() };
  if (ALL.test(t)) return { all: true };
  return null;
}

// ---- values -----------------------------------------------------------------------------------------------------------
const COLOR_WORDS = "red|orange|yellow|green|teal|cyan|blue|purple|violet|pink|magenta|white|warm white|cool white|gold|lime|amber";
const COLOR = new RegExp(`\\b(${COLOR_WORDS})\\b`);

export function parse(text, now = new Date()) {
  let q = norm(text).replace(LEAD, "").replace(TAIL, "").replace(TAIL, "").trim();
  if (!q) return null;
  let m;
  // the Devices page
  // ("my devices" alone is the speakers and microphones: lib/devices.mjs)
  if (/^(?:open|show|pull up|bring up|go to)(?: me)?(?: the| my)? (?:devices (?:page|screen|dashboard)|smart (?:home|devices)|home control|outlets|power strips?|smart plugs)(?: page| screen| panel| dashboard)?$/.test(q) || /^(?:devices|smart home) (?:page|screen|dashboard)$/.test(q)) return { kind: "page" };
  // lists and questions
  if (/^(?:list|show|tell me|what are)(?: me)?(?: all)? (?:my|the)? ?smart (?:home )?devices(?: do i have)?$|^what smart devices do (?:i|you|we) have$|^what can you (?:turn on|control|switch)$/.test(q)) return { kind: "list" };
  if (/^(?:what|which)(?:'s| is| are)?(?: (?:things|devices|stuff|lights|outlets))? (?:is |are )?(?:turned |switched |powered )?on(?: right now| now| at the moment| in here)?$|^what(?:'s| is) (?:turned|switched|powered) on(?: right now)?$|^what (?:devices|things) are (?:on|running)(?: right now)?$|^is anything (?:still )?on$|^what(?:'s| is) on right now$/.test(q)) return { kind: "whatson", said: q };
  if (/^(?:what(?:'s| is| are)|list|show)(?: me)?(?: the| my)? (?:device |devices )?schedules?(?: for (?:my|the) devices)?$|^what(?:'s| is) scheduled for (?:my|the) devices$|^(?:what|which) devices are scheduled$/.test(q)) return { kind: "schedules" };
  if ((m = /^(?:cancel|delete|remove|stop|clear)(?: the| my)? (.+?) (?:schedule|timer)$/.exec(q)) && !/\btimer$/.test(q)) return { kind: "cancelschedule", target: m[1] };
  if ((m = /^(?:cancel|clear|delete) (?:all )?(?:the |my )?device schedules$/.exec(q))) return { kind: "cancelschedule", target: "all" };
  // status: "is the TV on?", "is fan 2 off", "are the office lights on", "is the garage door open", "is the computer running"
  if ((m = /^(?:is|are)(?: the| my)? (.+?)(?: still)? (?:turned |switched |powered )?(on|off|running|open|closed|shut|locked|unlocked|plugged in)$/.exec(q))) return { kind: "status", target: m[1], asked: m[2] };
  if ((m = /^(?:what(?:'s| is) the (?:status|state) of|how(?:'s| is)|check on)(?: the| my)? (.+)$/.exec(q)) && !/printer|print\b/.test(q)) return { kind: "status", target: m[1] };
  // scenes: "movie mode", "activate movie mode", "start the movie scene", "goodnight scene"
  if ((m = /^(?:activate|start|run|set|turn on|switch to|go to|put on|enable)(?: the| my)? (.+?)(?: (?:scene|mode|routine))?$/.exec(q)) && /\b(mode|scene|routine)$/.test(q)) return { kind: "scene", name: m[1].replace(/ (?:scene|mode|routine)$/, "") , said: q };
  if ((m = /^(.+?) (mode|scene|time)$/.exec(q)) && !/\b(turn|switch|set|is|are)\b/.test(m[1])) return { kind: "scene", name: m[1], said: q };

  const { head, when } = splitWhen(q, now);
  q = head;
  const control = (action, target, extra = {}) => { const t = target.replace(/^(?:the|my|our)\s+/, "").trim(); if (!t) return null; const scope = scopeOf(t); return { kind: "control", action, target: t, ...(scope ? { scope } : {}), ...(when ? { when } : {}), ...extra }; };

  // colour, brightness, colour temperature, effects
  if ((m = /^(?:set|turn|make|change|switch)(?: the| my)? (.+?) (?:to |into )?(\d{1,3})(?: ?%| percent)(?: brightness)?$/.exec(q)) || (m = /^(?:dim|brighten|set)(?: the| my)? (.+?) to (\d{1,3})(?: ?%| percent)?$/.exec(q))) return { kind: "set", action: "brightness", value: Math.min(100, Number(m[2])), target: m[1], ...(when ? { when } : {}) };
  if ((m = /^dim(?: the| my)? (.+)$/.exec(q))) return { kind: "set", action: "brightness", value: 30, target: m[1], relative: "dim" };
  if ((m = /^brighten(?: the| my)? (.+)$/.exec(q))) return { kind: "set", action: "brightness", value: 100, target: m[1], relative: "bright" };
  if ((m = /^(?:set|turn|make|change|switch)(?: the| my)? (.+?) (?:to )?(warm|cool|daylight|soft white|cold)(?: white)?(?: light)?$/.exec(q)) && !COLOR.test(m[1])) return { kind: "set", action: "colortemp", value: { warm: 2700, "soft white": 2700, cool: 4500, cold: 6000, daylight: 5500 }[m[2]] ?? 3000, target: m[1] };
  if ((m = new RegExp(`^(?:set|turn|make|change|switch|paint)(?: the| my)? (.+?) (?:to |into )?(?:the color )?(${COLOR_WORDS})$`).exec(q))) return { kind: "set", action: "color", value: m[2], target: m[1], ...(when ? { when } : {}) };
  if ((m = /^(?:set|put|change|switch)(?: the| my)? (.+?) (?:to|on)(?: the)? (.+?) effect$/.exec(q)) || (m = /^(?:play|start|run)(?: the)? (.+?) effect on(?: the| my)? (.+)$/.exec(q))) return /effect on/.test(q) ? { kind: "set", action: "effect", value: m[1], target: m[2] } : { kind: "set", action: "effect", value: m[2], target: m[1] };
  // open / close / lock / unlock
  if ((m = /^(open|close|shut|lock|unlock|raise|lower)(?: up| down)?(?: the| my)? (.+)$/.exec(q)) && /door|garage|gate|blind|shade|curtain|lock|shutter|window|cover/.test(m[2])) return control({ shut: "close", raise: "open", lower: "close" }[m[1]] ?? m[1], m[2]);
  // on / off
  if ((m = /^(?:turn|switch|power|flip|shut|click)\s+(on|off)\s+(.+)$/.exec(q))) return control(m[1], m[2]);
  if ((m = /^(?:turn|switch|power|flip|shut|click)\s+(.+?)\s+(on|off)$/.exec(q))) return control(m[2], m[1]);
  // "turn everything off in the office", "switch all the fans off in the garage"
  if ((m = /^(?:turn|switch|power|flip|shut)\s+(.+?)\s+(on|off)\s+((?:in|at|from)\s+.+)$/.exec(q))) return control(m[2], `${m[1]} ${m[3]}`);
  if ((m = /^(?:shut down|power down|cut (?:the )?power (?:to|on)|kill (?:the )?power (?:to|on)|unplug|de-?energi[sz]e)\s+(.+)$/.exec(q))) return control("off", m[1], { hard: /cut|kill|unplug/.test(q) });
  if ((m = /^(?:power up|boot(?: up)?|start up|wake(?: up)?|fire up)\s+(.+?)(?:\s+up)?$/.exec(q)) && !/\b(?:print|prints|job)\b|\.3mf\b/.test(q)) return control("on", m[1]);
  if ((m = /^toggle\s+(.+)$/.exec(q))) return control("toggle", m[1]);
  // "office on", "garage lights off", "everything off": a place or a thing, then on/off
  if ((m = /^(.+?)\s+(on|off)$/.exec(q)) && m[1].split(" ").length <= 5 && !/^(?:is|are|what|how|was|did|log|sign|check|put|hold|keep|carry|move|go|come|lay|take|dozed|nod|drop|leave)\b/.test(m[1])) return control(m[2], m[1], { bare: true });
  return null;
}
