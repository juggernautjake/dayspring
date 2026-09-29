// Every setting by voice, no AI needed. The grammar is generated from SCHEMA below (one entry per setting, from
// lib/settings.mjs, the owner's preferences in lib/owner.mjs and the permissions in lib/permissions.mjs), so a new
// setting only needs an entry here to be readable and changeable by voice, and the "things you can say" page lists it.
//
//   parse(q)  → { intent: "setting.set" | "setting.adjust" | "setting.reset" | "setting.get", args } | null   (dry run)
//   run(p)    → { reply, patch, confirm? }       (does it; security settings come back with confirm: a yes is needed)
//
// What people say:
//   on / off       "turn off the weather", "enable 24-hour time", "hide the clock", "show the transcript", "no more joke offers"
//   a value        "set the volume to 40", "use 24-hour time", "night mode dim", "show 8 rows", "set the margin to 5 percent"
//   a direction    "make the text bigger", "louder", "a little quieter", "wider panel", "slower slides", "turn the alarm up by 10"
//   back to normal "reset the text size", "put the clock back to the default"
//   a question     "what's my wake word set to?", "what's the volume at?", "is night mode on?", "what layout is this?"
// Security (file access, programs, the browser, deleting, smart devices, Claude Code, the wake word) never changes on
// the words alone: Dayspring says what it would do and waits for a yes, or points to Settings for the bigger grants.
import * as settings from "../settings.mjs";
import * as owner from "../owner.mjs";
import * as permissions from "../permissions.mjs";
import { cap } from "./words.mjs";

// ---- the schema -------------------------------------------------------------------------------------------------------
// store: settings | owner | features (owner.features) | overlay (settings.overlay) | permissions | can (permissions.can)
// type: bool | enum | num | text     names: what people call it (regex source, matched on whole words)
// bool: on/off words beyond the usual (yes: "24 hour" means on); enum: opts [value, words, said]
// num: min, max, step (a "bigger"/"louder"), unit (how it's said), up/down: extra direction words
// ask: a question about it needs no "set to" ("what's the volume"); security: "confirm" (a yes) | "settings" (Settings only)
// delegate: the older skills say it better (they still get the change, and "undo that" still works: lib/commands/index.mjs)
const PCT = { unit: "%" };
export const SCHEMA = [
  // voice and sound
  { id: "volume", store: "settings", key: "volume", type: "num", min: 5, max: 100, step: 15, def: 80, ...PCT, label: "my voice volume", ask: true,
    names: ["(your |my )?(voice |speaking |talking )?volume(?! (of|for) (the )?(music|videos?|youtube|spotify|alarm|chimes?|sounds|calls?))", "your voice", "how loud you (are|talk)"], up: ["louder"], down: ["quieter", "softer"] },
  { id: "musicVolume", store: "settings", key: "musicVolume", type: "num", min: 0, max: 100, step: 15, def: 100, ...PCT, label: "the music volume", ask: true,
    names: ["(the )?music( volume)?(?= (volume|louder|quieter|softer|up|down|to \\d|at \\d))", "(the )?(music|spotify|song) volume", "volume (of|for) (the )?(music|spotify|songs?)"], up: ["louder"], down: ["quieter", "softer"], needs: /\b(volume|louder|quieter|softer|up|down|\d)\b/ },
  { id: "videoVolume", store: "settings", key: "videoVolume", type: "num", min: 0, max: 100, step: 15, def: 100, ...PCT, label: "the video volume", ask: true,
    names: ["(the )?(video|youtube) volume", "volume (of|for) (the )?(videos?|youtube)"], up: ["louder"], down: ["quieter", "softer"] },
  { id: "soundsVolume", store: "settings", key: "soundsVolume", type: "num", min: 0, max: 100, step: 15, def: 80, ...PCT, label: "the chimes and sound effects", ask: true,
    names: ["(the )?(chimes?|sound effects|notification sounds|dings|beeps)( volume)?(?= (volume|louder|quieter|softer|up|down|to \\d|at \\d))", "(the )?(chime|sounds|sound effects?) volume"], up: ["louder"], down: ["quieter", "softer"] },
  { id: "alarmVolume", store: "settings", key: "alarmVolume", type: "num", min: 20, max: 100, step: 15, def: 100, ...PCT, label: "the alarm volume", ask: true,
    names: ["(the )?alarm volume", "volume (of|for) (the |my )?alarms?", "(the |my )alarms?(?= (louder|quieter|softer))"], up: ["louder"], down: ["quieter", "softer"] },
  { id: "callVolume", store: "settings", key: "callVolume", type: "num", min: 0, max: 100, step: 15, def: 100, ...PCT, label: "the call answer volume", names: ["(the )?(call|tune in) volume"], up: ["louder"], down: ["quieter", "softer"] },
  { id: "speed", store: "settings", key: "speedAdj", type: "num", min: -0.3, max: 0.2, step: 0.08, def: 0, unit: "speed", label: "how fast I talk", ask: true,
    names: ["(your |my )?(talking|speaking|speech|voice|reading) (speed|pace|rate)", "how fast you (talk|speak)", "your pace", "(the |your )speed(?! (of|for|on) (the )?(video|song|music))", "(talk|speak|talking|speaking)(?= (a )?(little |bit |lot )?(faster|slower|quicker))"], up: ["faster", "quicker"], down: ["slower"] },
  { id: "voice", store: "settings", key: "voice", type: "text", label: "my voice", ask: true, delegate: true, names: ["(your|the) voice"] },
  { id: "detail", store: "settings", key: "detail", type: "enum", label: "how much detail I give", ask: true, names: ["(answer|response|reply) (length|detail|style)", "(the )?detail( level)?", "how (long|detailed) your answers are", "(short|shorter|long|longer|brief|briefer|detailed|simple|simpler|normal|more detailed|thorough) (answers|responses|replies)"],
    opts: [["simple", "simple|simpler|short|shorter|brief|briefer|basic|less", "short and simple"], ["normal", "normal|regular|medium|default", "normal"], ["detailed", "detailed|more detailed|long|longer|more|thorough|in depth", "detailed"]], def: "normal" },
  { id: "timeTone", store: "settings", key: "timeTone", type: "bool", label: "the time-of-day tone (soothing mornings, upbeat afternoons)", names: ["time of day (tone|voice|mood)", "soothing mornings"] },
  { id: "bibleVersion", store: "settings", key: "bibleVersion", type: "text", label: "the Bible version I read", ask: true, delegate: true, names: ["(default )?bible (version|translation)"] },
  // notifications and listening
  { id: "mode", store: "settings", key: "mode", type: "enum", label: "notifications", ask: true, names: ["(the |my |all )?(notifications?|notification (mode|sounds?|style)|alerts)(?! (cards?|pop ?ups?|when))"],
    opts: [["voice", "spoken|voice|out loud|aloud|on|normal|talk|talking|back on", "spoken out loud"], ["chime", "chimes?( only)?|just (a )?chime|ding", "a chime only"], ["silent", "silent|silence|mute|muted|off|quiet|screen only|on screen only", "silent (on screen only)"]], timed: true },
  { id: "listenState", store: "settings", key: "listenState", type: "enum", label: "listening", ask: true, names: ["listening( mode| state)?", "(active|quiet) mode", "(your )?mic(rophone)? state", "(go|be|stay|keep|keep it) quiet(?= (for|until|till|through) )"],
    opts: [["active", "active|on|normal|back on", "active (listening and talking)"], ["quiet", "quiet|quiet mode|hush", "quiet (I hear “Dayspring” but say nothing)"], ["off", "off|not listening|deaf", "off (not listening)"]], timed: true, special: "listen" },
  { id: "overlayOn", store: "overlay", key: "on", type: "bool", label: "the desktop notification cards", names: ["(the )?(desktop )?(notification cards?|pop ?ups?|popups|toasts|desktop notifications)"] },
  { id: "overlaySeconds", store: "overlay", key: "seconds", type: "num", min: 3, max: 60, step: 3, def: 8, unit: "seconds", label: "how long notification cards stay up", ask: true,
    names: ["how long (the )?(notification cards?|pop ?ups?|notifications) stay( up| on screen)?", "(notification card|pop ?up|notification) (time|length|duration)", "(the )?(notification cards?|pop ?ups?|popups|notifications) (for|up for|stay( up)? for|on screen for)(?= \\d+ seconds)"], up: ["longer"], down: ["shorter"] },
  { id: "alarmsWhenOff", store: "settings", key: "alarmsWhenOff", type: "bool", label: "alarms ringing while I'm off", names: ["alarms (when|while) (you are |you re |dayspring is )?(off|quiet)"] },
  { id: "overlayWhenOff", store: "settings", key: "overlayWhenOff", type: "bool", label: "notification cards while I'm off", names: ["(notifications?|notification cards|pop ?ups) (when|while) (you are |you re )?off"] },
  { id: "timersWhenQuiet", store: "settings", key: "timersWhenQuiet", type: "bool", label: "timers ringing while I'm quiet", names: ["timers (when|while) (you are |you re )?(quiet|off)"] },
  { id: "speakWhenClosed", store: "settings", key: "speakWhenClosed", type: "bool", label: "talking when the screen is closed", names: ["(speak|talk|talking|speaking) (when|while) (the screen is |the window is )?closed"] },
  { id: "speechEngine", store: "settings", key: "speechEngine", type: "enum", label: "speech recognition", ask: true, names: ["speech (recognition|engine|to text)", "(the )?listening engine", "voice recognition"],
    opts: [["auto", "auto|automatic|default|normal", "automatic"], ["browser", "browser|chrome|google|online", "the browser's"], ["local", "local|private|this computer|whisper|offline|on device", "private, on this computer"]] },
  { id: "logMisses", store: "settings", key: "logMisses", type: "bool", label: "keeping the phrases I didn't understand", names: ["(missed|misunderstood) phrases", "(log|logging) (the )?misses", "phrases you (did not|didn t) understand"] },
  // the alarm and the day
  { id: "alarm", store: "settings", key: "alarm", type: "bool", label: "the morning alarm", ask: true, names: ["(the |my )?(morning|wake ?up|daily wake up) alarm"] },
  { id: "alarmSnooze", store: "settings", key: "alarmSnooze", type: "num", min: 1, max: 30, step: 1, def: 9, unit: "minutes", label: "the snooze length", ask: true,
    names: ["(the |my |default )?snooze( length| time| duration)?(?! (it|the alarm|for|on|of|button))", "how long (the )?snooze (lasts|is)", "how long is (the |my )?snooze"], up: ["longer"], down: ["shorter"] },
  { id: "chores", store: "settings", key: "chores", type: "bool", label: "chore suggestions", names: ["(the )?chore (reminders?|suggestions?|nudges?)", "micro ?habits?"] },
  { id: "goals", store: "settings", key: "goals", type: "bool", label: "goal check-ins", names: ["goal (check ins?|reminders?|nudges)"] },
  { id: "claudeAlerts", store: "settings", key: "claudeAlerts", type: "bool", label: "Claude Code alerts", names: ["claude (code )?alerts"] },
  { id: "jokeOffersOn", store: "settings", key: "jokeOffersOn", type: "bool", label: "joke offers", names: ["joke offers?", "offering (me )?jokes"] },
  { id: "jokeOffers", store: "settings", key: "jokeOffers", type: "num", min: 0, max: 5, step: 1, def: 3, unit: "a day", label: "how many joke offers a day", names: ["joke offers (a|per) day", "how many jokes (a|per) day"] },
  { id: "mixer", store: "settings", key: "mixer", type: "bool", label: "the audio mixer", delegate: true, names: ["(the )?(audio )?mixer", "voicemeeter"] },
  // the screen
  { id: "clock24", store: "settings", key: "clock24", type: "bool", label: "24-hour time", ask: true, names: ["24 hour (time|clock|format)", "12 hour (time|clock|format)", "(the )?(time|clock) format", "military time", "am pm (time|clock)"],
    yes: /\b24 hour|military\b/, no: /\b12 hour|am pm|a m p m\b/ },
  { id: "uiScale", store: "settings", key: "uiScale", type: "num", min: 60, max: 150, step: 10, def: 100, ...PCT, label: "the size of everything", ask: true,
    names: ["everything", "(the )?(whole|entire) (screen|display|layout)", "(the )?(screen|display|ui|interface) (size|scale|zoom)", "(the )?zoom( level)?"], up: ["bigger", "larger", "zoom in"], down: ["smaller", "tinier", "zoom out"], needs: /\b(bigger|larger|smaller|tinier|size|scale|zoom|percent|\d|reset|default)\b/ },
  { id: "textScale", store: "settings", key: "textScale", type: "num", min: 80, max: 130, step: 10, def: 100, ...PCT, label: "the text size", ask: true,
    names: ["(the )?(text|font|writing|letters|words|type)( size)?(?! (messages?|from|me|mom|dad))", "(the )?(text|font) scale"], up: ["bigger", "larger"], down: ["smaller", "tinier"], needs: /\b(bigger|larger|smaller|tinier|size|scale|percent|\d|reset|default)\b/ },
  { id: "clockScale", store: "settings", key: "clockScale", type: "num", min: 60, max: 160, step: 15, def: 100, ...PCT, label: "the clock size", ask: true,
    names: ["(the )?clock( size)?(?= (bigger|larger|smaller|size|to \\d))", "(the )?clock size", "(the )?(size of the|big) clock", "(bigger|larger|smaller) clock"], up: ["bigger", "larger"], down: ["smaller"], needs: /\b(bigger|larger|smaller|size|percent|\d|reset|default)\b/ },
  { id: "talkWidth", store: "settings", key: "talkWidth", type: "num", min: 25, max: 50, step: 5, def: null, ...PCT, label: "my panel's width", ask: true,
    names: ["(your|my|the|dayspring s|dayspring|talk|chat|assistant) (panel|side|column|card)( width)?"], up: ["wider", "bigger"], down: ["narrower", "thinner", "smaller"], needs: /\b(wider|bigger|narrower|thinner|smaller|width|percent|\d|reset|default)\b/ },
  { id: "carousel", store: "settings", key: "carouselSeconds", type: "num", min: 0, max: 300, step: 20, def: 40, unit: "seconds", label: "how long each slide stays", ask: true,
    names: ["(the )?(slides?|slideshow|carousel|panel rotation)( speed| timing)?", "(the )?rotating panel (speed|timing)"], up: ["slower", "longer", "slow down"], down: ["faster", "quicker", "shorter", "speed up"], needs: /\b(slower|faster|quicker|longer|shorter|seconds?|\d|reset|default|speed|stop|rotat\w*|changing|moving|freeze|slow down|speed up)\b/ },
  { id: "listRows", store: "settings", key: "listRows", type: "num", min: 0, max: 20, step: 1, def: 0, unit: "rows", label: "how many schedule rows show", ask: true,
    names: ["(the )?(schedule |today s |list )?rows", "rows (on|of|in) (the |my )?(schedule|list|today)", "(schedule|list) (items|lines)"], up: ["more"], down: ["fewer", "less"] },
  { id: "layout", store: "settings", key: "layoutMode", type: "enum", label: "the layout", ask: true, names: ["(the )?(screen )?layout", "(the )?columns?", "(your |my |the |dayspring s |dayspring |talk |chat |assistant )?(panel|side|column|card)s? (on|to|over to) the (left|right)( side)?", "dayspring on the (left|right)"],
    opts: [["auto", "auto|automatic|default|normal", "automatic"], ["two", "two columns?|2 columns?|double", "two columns"], ["one", "one column|1 column|single column|single", "one column"],
      ["talkLeft", "(your |my |the |dayspring |talk |chat )?(panel|side|column) on the left|left side|on the left|to the left", "my panel on the left"], ["talkRight", "(your |my |the |dayspring |talk |chat )?(panel|side|column) on the right|right side|on the right|to the right", "my panel on the right"],
      ["compact", "compact( layout)?", "compact"]] },
  { id: "density", store: "settings", key: "density", type: "enum", label: "the spacing", ask: true, names: ["(the )?(spacing|density)", "(more|less) (room|space) between"], opts: [["comfortable", "comfortable|roomy|roomier|normal|more room|more space|relaxed", "comfortable"], ["compact", "compact|tight|tighter|dense|less room|less space", "compact"]] },
  { id: "fit", store: "settings", key: "fit", type: "enum", label: "how the screen fits", names: ["(the )?(screen )?fit", "proportions", "stretch(ing)? (it |everything )?(to fill|the screen)"], opts: [["fill", "fill|stretch", "stretched to fill"], ["keep", "keep|proportions|do not stretch|dont stretch", "keeping the proportions"]] },
  { id: "uiMotion", store: "settings", key: "uiMotion", type: "enum", label: "screen motion", ask: true, names: ["(the )?(screen )?(motion|movement|animations?)(?! (of|in) the (sky|background))", "calm(er)? motion", "reduced motion", "less motion"],
    opts: [["reduced", "reduced|reduce|calm|calmer|less|minimal|gentle|gentler|off|slow", "calmer (reduced motion)"], ["normal", "normal|full|on|regular|more|usual", "normal"]], onValue: "normal", offValue: "reduced", def: "normal" },
  { id: "showClock", store: "settings", key: "showClock", type: "bool", label: "the clock", show: true, names: ["(the )?clock( row)?(?! (size|bigger|smaller|format))"] },
  { id: "showNowNext", store: "settings", key: "showNowNext", type: "bool", label: "Now and Next", show: true, names: ["now and next", "(the )?(now|next) card", "now next"] },
  { id: "showPanel", store: "settings", key: "showPanel", type: "bool", label: "the rotating panel", show: true, names: ["(the )?(rotating|main|big) panel", "(the )?carousel(?! (speed|faster|slower))"] },
  { id: "showExam", store: "settings", key: "showExam", type: "bool", label: "the exam card", show: true, names: ["(the )?exam (card|countdown)"] },
  { id: "showCourses", store: "settings", key: "showCourses", type: "bool", label: "the course rings", show: true, names: ["(the )?(course|study) (rings?|cards?|progress)"] },
  { id: "showTranscript", store: "settings", key: "showTranscript", type: "bool", label: "the transcript", show: true, names: ["(the )?(transcript|captions?|subtitles)"] },
  { id: "overscan", store: "settings", key: "overscan", type: "num", min: 0, max: 20, step: 1.5, def: 5, ...PCT, label: "the screen margin", ask: true, names: ["(the )?(screen )?(margins?|borders?|overscan|edges?)(?! (top|bottom|left|right))"], up: ["bigger", "wider", "more"], down: ["smaller", "narrower", "less"] },
  { id: "marginTop", store: "settings", key: "marginTop", type: "num", min: 0, max: 20, step: 1.5, def: null, ...PCT, label: "the top margin", names: ["(the )?top (margin|edge|border)"], up: ["bigger", "more"], down: ["smaller", "less"] },
  { id: "marginBottom", store: "settings", key: "marginBottom", type: "num", min: 0, max: 20, step: 1.5, def: null, ...PCT, label: "the bottom margin", names: ["(the )?bottom (margin|edge|border)"], up: ["bigger", "more"], down: ["smaller", "less"] },
  { id: "marginLeft", store: "settings", key: "marginLeft", type: "num", min: 0, max: 20, step: 1.5, def: null, ...PCT, label: "the left margin", names: ["(the )?left (margin|edge|border)"], up: ["bigger", "more"], down: ["smaller", "less"] },
  { id: "marginRight", store: "settings", key: "marginRight", type: "num", min: 0, max: 20, step: 1.5, def: null, ...PCT, label: "the right margin", names: ["(the )?right (margin|edge|border)"], up: ["bigger", "more"], down: ["smaller", "less"] },
  { id: "night", store: "settings", key: "night", type: "enum", label: "night mode", ask: true, names: ["night ?mode", "(the )?screen at night"], opts: [["dark", "dark|on|black|darkest", "dark"], ["dim", "dim|dimmed|dimmer", "dim"], ["off", "off|bright|none|disabled", "off (bright all night)"]], onValue: "dark", offValue: "off" },
  { id: "miniOnTop", store: "settings", key: "miniOnTop", type: "bool", label: "keeping Dayspring mini on top", nameOn: true, names: ["(dayspring )?mini on top", "(stay|keep|always) on top"] },
  // you and your assistant
  { id: "wakeWords", store: "owner", key: "wakeWords", type: "text", label: "the wake word", ask: true, security: "confirm", names: ["(the |my |your )?wake (words?|phrases?)"] },
  // (your own name, nicknames, where you live and what you like: lib/commands/profile.mjs; the assistant's own name belongs to
  // the personality: "your name is Nova" isn't handled here)
  { id: "pronouns", store: "owner", key: "pronouns", type: "enum", label: "your pronouns", ask: true, names: ["(my )?pronouns"], opts: [["he", "he|him|he him", "he/him"], ["she", "she|her|she her", "she/her"], ["they", "they|them|they them", "they/them"]] },
  { id: "location", store: "owner", key: "location", type: "text", label: "where you are", ask: true, security: "settings", names: ["(my |your )?(location|town|city|home town)", "where (i am|i live)"] },
  { id: "diagnostics", store: "owner", key: "diagnostics", type: "bool", label: "the developer log", names: ["(the )?(developer|debug|diagnostic) (log|logging)", "diagnostics"] },
  { id: "keepScreenOpen", store: "owner", key: "keepScreenOpen", type: "bool", label: "reopening the screen if it closes", nameOn: true, names: ["keep(ing)? the screen open", "reopen(ing)? the screen( if it closes)?"] },
  { id: "openOnStartup", store: "owner", key: "openOnStartup", type: "bool", label: "opening the screen when Windows starts", nameOn: true, names: ["open(ing)? (the screen )?(on|at|when) (startup|start up|windows starts)", "open on startup"] },
  { id: "folders", store: "owner", key: "fileRoot", type: "text", label: "the folders I use", security: "settings", names: ["(my )?(file root|notes folder|backup folder|photo folders?|pictures folder setting)"] },
  // features
  { id: "weather", store: "features", key: "weather", type: "bool", label: "the weather", names: ["(the )?weather(?! (effects?|in the sky|on the sky|animations?))( feature| forecast| card| on the screen)?"], needsOp: true },
  { id: "news", store: "features", key: "news", type: "bool", label: "the news", names: ["(the )?news( feature| in the morning| briefing)?"], needsOp: true },
  { id: "photos", store: "features", key: "photos", type: "bool", label: "photos in the slideshow", names: ["(the )?photo(s)? (feature|slideshow|in the (showcase|slideshow|panel))", "(my )?photos on the screen"] },
  { id: "music", store: "features", key: "music", type: "bool", label: "the music features", names: ["(the )?music features?", "spotify and youtube"] },
  { id: "faith", store: "features", key: "faith", type: "bool", label: "the faith features", names: ["(the )?faith features?", "(the )?(morning )?devotions?"] },
  { id: "church", store: "features", key: "church", type: "bool", label: "church features", names: ["(the )?church features?"] },
  { id: "memoryVerses", store: "features", key: "memoryVerses", type: "bool", label: "memory verses", names: ["(the )?(scripture )?memory verses?( feature)?"] },
  { id: "phone", store: "features", key: "phone", type: "bool", label: "texts through Phone Link", security: "confirm", names: ["(the )?(phone link|phone features?|text messages feature|reading my texts feature)"] },
  { id: "claudeCode", store: "features", key: "claudeCode", type: "bool", label: "Claude Code", security: "confirm", names: ["claude code"] },
  // permissions (security: never on the words alone)
  { id: "files", store: "permissions", key: "files", type: "enum", label: "file access", ask: true, security: "confirm", names: ["(your |the )?(file access|access to (all (of )?)?(my |your )?files|files permission|permission to (use|read|see) (all (of )?)?(my )?files)"], onValue: "custom", offValue: "off",
    opts: [["off", "off|none|no|nothing|revoke|disable", "off"], ["all", "all|everything|every file|full|all my files", "all your files"], ["custom", "some|custom|certain folders|just some folders", "chosen folders"]], grantSettings: ["all", "custom"] },
  { id: "programs", store: "permissions", key: "programs", type: "enum", label: "opening programs", ask: true, security: "confirm", names: ["(opening|launching|running) programs", "program (access|permission)", "(access|permission) to (open )?programs"],
    opts: [["off", "off|no|never|disable", "off"], ["ask", "ask|ask first|ask me", "ask first"], ["on", "on|yes|always|allow|enable", "on"]] },
  { id: "browser", store: "permissions", key: "browser", type: "bool", label: "controlling the browser", security: "confirm", names: ["(browser control|controlling the browser|control (of )?(my |the )?browser)"] },
  { id: "web", store: "permissions", key: "web", type: "bool", label: "web search", security: "confirm", names: ["web (search|access)", "internet (search|access)", "searching the web"] },
  { id: "deleteFiles", store: "can", key: "delete", type: "bool", label: "deleting files", security: "confirm", names: ["deleting (my )?files", "(permission|access) to delete( files)?", "file deletion"] },
  { id: "devices", store: "permissions", key: "devices", type: "enum", label: "smart device control", security: "confirm", names: ["(smart )?device control", "controlling (my )?(smart )?devices"],
    opts: [["off", "off|no|disable", "off"], ["ask", "ask|ask first", "ask first"], ["on", "on|yes|allow|enable", "on"]] },
  { id: "money", store: "permissions", key: "money", type: "bool", label: "the money review", security: "settings", names: ["money (review|access|permission)"] },
];

// ---- reading and writing the stores ------------------------------------------------------------------------------------
export function current(e) {
  if (e.store === "settings") return settings.get()[e.key];
  if (e.store === "overlay") return (settings.get().overlay ?? {})[e.key];
  if (e.store === "owner") return owner.get()[e.key];
  if (e.store === "features") return owner.get().features?.[e.key];
  if (e.store === "permissions") return permissions.get()[e.key];
  if (e.store === "can") return permissions.get().can?.[e.key];
  return undefined;
}
function patchFor(e, v) {
  if (e.store === "overlay") return { overlay: { [e.key]: v } };
  if (e.store === "features") return { features: { [e.key]: v } };
  if (e.store === "can") return { can: { [e.key]: v } };
  return { [e.key]: v };
}
export function write(e, v, why = "voice") {
  const p = patchFor(e, v);
  if (["settings", "overlay"].includes(e.store)) return settings.set(p);
  if (["owner", "features"].includes(e.store)) return owner.set(p);
  if (["permissions", "can"].includes(e.store)) return permissions.set({ ...p, via: why });
  throw new Error(`unknown store ${e.store}`);
}

// ---- saying values ---------------------------------------------------------------------------------------------------
const fmtNum = (e, v) => {
  if (v === null || v === undefined) return e.id === "talkWidth" ? "automatic" : e.id.startsWith("margin") ? "the same as the others" : "the default";
  if (e.unit === "%") return `${Math.round(v * 10) / 10}%`;
  if (e.unit === "speed") return v === 0 ? "my normal pace" : v < 0 ? `${Math.round(-v * 100)}% slower than normal` : `${Math.round(v * 100)}% faster than normal`;
  if (e.id === "carousel" && v === 0) return "not rotating";
  if (e.id === "listRows" && v === 0) return "as many rows as fit";
  return `${Math.round(v * 10) / 10} ${e.unit ?? ""}`.trim();
};
export function say(e, v) {
  if (e.type === "bool") return e.id === "clock24" ? (v ? "24-hour time" : "12-hour time") : v === false ? "off" : "on";
  if (e.type === "enum") return e.opts.find((o) => o[0] === v)?.[2] ?? String(v ?? "the default");
  if (e.type === "num") return fmtNum(e, v);
  if (e.id === "wakeWords") return (v ?? []).map((w) => `“${w}”`).join(" or ") || "“dayspring”";
  if (e.id === "location") return v?.place || "not set yet";
  if (e.id === "voice") return v || "my usual voice";
  if (e.id === "bibleVersion") return String(v ?? "kjv").toUpperCase();
  return v ? String(v) : "not set";
}
const is = (e) => (/s$/.test(e.label) && !/\b(news|alerts)\b/.test(e.label) ? "are" : "is");

// ---- the generated grammar -------------------------------------------------------------------------------------------
// (each name on its own, so the longest one said wins: "music volume" over "volume")
const compiled = SCHEMA.map((e) => ({ e, res: e.names.map((n) => new RegExp(`\\b(?:${n})\\b`)) }));
const ON_W = /\b(turn(ed)? on|switch(ed)? on|enable|enabled|activate|start|show|bring back|put back|unhide|use|want|keep|allow|resume|on|yes|give|grant)\b/;
const OFF_W = /\b(turn(ed)? off|switch(ed)? off|disable|disabled|deactivate|stop|hide|no more|do not show|dont show|get rid of|remove|off|no|without|do not want|dont want|never|pause|kill|block|do not|dont|freeze)\b/;
const UP_W = /\b(bigger|larger|louder|higher|more|increase|raise|up|wider|longer|grow)\b/, DOWN_W = /\b(smaller|tinier|quieter|softer|lower|less|fewer|decrease|reduce|down|narrower|thinner|shorter|shrink)\b/;
const RESET_W = /\b(reset|restore|(back )?to (the )?(default|normal|standard|usual|original)|default (value|setting|size)|back to normal|put .* back to (normal|the default))\b/;
const QUERY_W = /^(what is|what are|what|whats|how is|how are|how loud is|how big is|how fast|how long|how many|is|are|tell me|check|which|do i have|what s)\b/;
const SET_W = /\b(set|change|make|put|switch|use|turn|adjust|go|bump|drop|raise|lower|increase|decrease|move|show|hide|enable|disable|want|like|prefer|keep|give|grant|allow|let|talk|speak)\b/;

function matchEntry(q) {
  let best = null;
  for (const c of compiled) {
    const m = c.res.map((re) => re.exec(q)).filter(Boolean).sort((a, b) => b[0].length - a[0].length)[0];
    if (!m) continue;
    if (c.e.needs && !c.e.needs.test(q)) continue;
    if (!best || m[0].length > best.m[0].length) best = { e: c.e, m };
  }
  return best;
}
// a number said for this setting ("to 40", "40 percent", "8 rows", "at 5%"), leaving out numbers in its own name
function numberIn(q, e, nameText) {
  const s = q.replace(nameText, " ");
  const m = /(?:\bto\b|\bat\b|\bis\b|=|^|\s)\s*(-?\d+(?:\.\d+)?)\s*(percent|%|seconds?|secs?|rows?|items?|lines?|minutes?|mins?|a day|per day|times)?\b/.exec(s);
  if (!m) return null;
  if (e.id === "clock24") return null;
  return Number(m[1]);
}
const amountIn = (q) => { const m = /\bby (\d+(?:\.\d+)?)\b/.exec(q); return m ? Number(m[1]) : null; };

export function parse(q) {
  q = String(q ?? "").trim();
  if (!q) return null;
  // a reminder or an event about a setting ("remind me to turn off the weather at 5") isn't the setting itself
  if (/^(remind me|set (a |up a )?reminder|schedule|book|pencil in|every|each|tomorrow|tonight|on (sun|mon|tues|wednes|thurs|fri|satur)day|at \d|wake me)\b/.test(q)) return null;
  if (/^(add|put)\b/.test(q) && /\b(at \d|tomorrow|tonight|every|each|calendar|schedule|interests?|hobbies|nicknames?|(on|this|next) (sun|mon|tues|wednes|thurs|fri|satur)day)\b/.test(q)) return null;
  // …nor is a new alarm with its own snooze or volume ("set an alarm for 6 with a 5 minute snooze")
  if (/\b(set|create|add|make|give me|i need|i want|schedule) (an?|another|new|one more) (\w+ )?alarm\b|\balarm (for|at) \d/.test(q)) return null;
  const hit = matchEntry(q);
  if (!hit) return null;
  const { e, m } = hit;
  const nameText = m[0];
  const rest = q.replace(nameText, " ").replace(/\s+/g, " ").trim();
  // a question about it
  const asking = QUERY_W.test(q) && !/^(what if|is it possible)/.test(q) && !/^(set|turn|make|change|switch)/.test(q);
  if (asking && (e.ask || /\b(set to|set at|setting|on or off|turned on|turned off|enabled|disabled|currently|right now|on|off|at|using)\b/.test(q))) {
    if (!/\b(bigger|smaller|louder|quieter|to \d)\b/.test(q)) return { intent: "setting.get", args: { id: e.id } };
  }
  if (e.delegate) return null;
  const optIn = (s) => (e.opts ?? []).find(([, words]) => new RegExp(`\\b(${words})\\b`).test(s))?.[0] ?? null;
  // ("set the detail to normal": "normal" is one of its choices, not a reset)
  if (RESET_W.test(q) && (e.type === "num" || e.type === "bool" || (e.type === "enum" && !optIn(rest.replace(/\b(back )?to (the )?(default|standard|usual|original)\b/, " "))))) return { intent: "setting.reset", args: { id: e.id } };
  const fromRest = e.type === "enum" ? optIn(rest) : null, fromName = e.type === "enum" ? optIn(nameText) : null;
  const dirWord = [...(e.up ?? []), ...(e.down ?? [])].some((w) => new RegExp(`\\b${w}\\b`).test(q));
  const op = SET_W.test(q) || ON_W.test(rest) || OFF_W.test(rest) || (e.nameOn && !rest.replace(/\b(please|always|dayspring|the)\b/g, "").trim()) || UP_W.test(q) || DOWN_W.test(q) || /\d/.test(rest) || dirWord || fromRest || (fromName && q.split(" ").length <= 6) || (e.yes && e.yes.test(q)) || (e.no && e.no.test(q));
  if (!op) return null;
  // "show me the weather" is a question about the weather, not a setting: these need a real on/off
  if (e.needsOp && !/\b(turn|switch|enable|disable|hide|stop showing|start showing|no more|get rid of|remove|bring back|put back|dont show|do not show)\b/.test(q)) return null;
  if (e.type === "bool") {
    if (e.yes && e.yes.test(q) && !/\b(off|disable|stop|no more|dont|do not)\b/.test(rest)) return { intent: "setting.set", args: { id: e.id, value: true } };
    if (e.no && e.no.test(q) && !/\b(off|disable|stop|no more|dont|do not)\b/.test(rest)) return { intent: "setting.set", args: { id: e.id, value: false } };
    const off = OFF_W.test(rest) || /^(hide|no more|stop)\b/.test(q), on = ON_W.test(rest) || /^(show|bring back|use|enable)\b/.test(q) || (e.nameOn && !rest.replace(/\b(please|always|dayspring|the)\b/g, "").trim());
    if (off && !(/\b(turn|switch) (it |that )?on\b/.test(q))) return { intent: "setting.set", args: { id: e.id, value: false } };
    if (on) return { intent: "setting.set", args: { id: e.id, value: true } };
    if (/\b(toggle|flip)\b/.test(q)) return { intent: "setting.toggle", args: { id: e.id } };
    return null;
  }
  if (e.type === "enum") {
    const until = e.timed ? untilIn(q) : null;
    const set = (v) => ({ intent: "setting.set", args: { id: e.id, value: v, ...(until ?? {}) } });
    // the value is in its name ("quiet mode", "calmer motion", "your panel on the left"): on/off words toggle it
    const opposite = (v) => (e.opts.length === 2 ? e.opts.find((o) => o[0] !== v)[0] : v === e.onValue ? e.offValue : v === e.offValue ? e.onValue : e.opts[0][0]);
    if (fromName) return set(OFF_W.test(rest) && !ON_W.test(rest.replace(/\b(turn|switch) off\b/, "")) ? opposite(fromName) : fromName);
    if (fromRest) return set(fromRest);
    const fromAll = optIn(q);
    if (fromAll) return set(fromAll);
    if (e.onValue && OFF_W.test(rest)) return set(e.offValue);
    if (e.onValue && ON_W.test(rest)) return set(e.onValue);
    return null;
  }
  if (e.type === "num") {
    if (e.id === "carousel" && (/\b(stop|pause|freeze|do not|dont) (rotat\w*|changing|moving)\b/.test(q) || /^freeze\b/.test(q) || (OFF_W.test(rest) && !/\bslower|faster|slow down|speed up\b/.test(q)))) return { intent: "setting.set", args: { id: e.id, value: 0 } };
    if (e.id === "carousel" && /\b(rotat\w*|start|changing) again\b|\bstart rotating\b/.test(q)) return { intent: "setting.set", args: { id: e.id, value: 40 } };
    const n = numberIn(q, e, nameText);
    const up = UP_W.test(q) || (e.up ?? []).some((w) => new RegExp(`\\b${w}\\b`).test(q)), down = DOWN_W.test(q) || (e.down ?? []).some((w) => new RegExp(`\\b${w}\\b`).test(q));
    if (n !== null && !/\bby \d/.test(q)) {
      if (e.unit === "speed") return null;
      return { intent: "setting.set", args: { id: e.id, value: n } };
    }
    if (up || down) {
      const by = amountIn(q), size = /\b(a (little|bit|touch|tad)|slightly|a little bit)\b/.test(q) ? 0.5 : /\b(a lot|much|way)\b/.test(q) ? 2 : 1;
      const dirUp = (e.up ?? []).some((w) => new RegExp(`\\b${w}\\b`).test(q)) ? true : (e.down ?? []).some((w) => new RegExp(`\\b${w}\\b`).test(q)) ? false : up && !down;
      return { intent: "setting.adjust", args: { id: e.id, delta: (dirUp ? 1 : -1) * (by ?? e.step * size) } };
    }
    if (/\b(normal|default)\b/.test(rest)) return { intent: "setting.reset", args: { id: e.id } };
    if (e.id === "listRows" && /\b(all|every)\b/.test(q)) return { intent: "setting.set", args: { id: e.id, value: 0 } };
    if (e.id === "carousel" && OFF_W.test(rest)) return { intent: "setting.set", args: { id: e.id, value: 0 } };
    return null;
  }
  if (e.type === "text") {
    if (e.security === "settings") return { intent: "setting.set", args: { id: e.id, value: null } };
    const v = /\b(?:to|as|is|be)\s+(.+)$/.exec(rest)?.[1]?.replace(/^(the |a |an )/, "").trim();
    if (!v) return null;
    return { intent: "setting.set", args: { id: e.id, value: e.id === "wakeWords" ? v.split(/\s*(?:,| or | and )\s*/).map((w) => w.trim()).filter(Boolean) : v } };
  }
  return null;
}
// "until 3" / "for an hour" on a timed setting (notifications, listening)
function untilIn(q) {
  let m = /\bfor (?:an? |the next )?(\d+(?:\.\d+)?|half an?|an?)?\s*(hours?|minutes?)\b/.exec(q);
  if (m) { const n = !m[1] || /^an?$/.test(m[1]) ? 1 : /half/.test(m[1]) ? 0.5 : Number(m[1]); return { minutes: Math.round(/hour/.test(m[2]) ? n * 60 : n) }; }
  m = /\b(?:until|till|til|through) (\d{1,2})(?::(\d{2}))?\s*(am|pm|a m|p m)?\b|\b(?:until|till) (noon|midnight|the morning|morning|tomorrow)\b/.exec(q);
  if (!m) return null;
  if (m[4]) return { until: m[4] === "noon" ? "12:00" : m[4] === "midnight" ? "00:00" : "07:00" };
  let h = Number(m[1]); const mi = Number(m[2] ?? 0), ap = (m[3] ?? "").replace(" ", "");
  if (ap === "pm" && h < 12) h += 12; else if (ap === "am" && h === 12) h = 0;
  return { until: `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`, untilAmbiguous: !ap && h <= 12 };
}

// ---- doing it --------------------------------------------------------------------------------------------------------
export const byId = new Map(SCHEMA.map((e) => [e.id, e]));
const clampNum = (e, v) => { const r = Math.max(e.min, Math.min(e.max, v)); return e.unit === "speed" ? Math.round(r * 100) / 100 : e.step % 1 ? Math.round(r * 2) / 2 : Math.round(r); };
// → { reply, apply?: () => result, confirm?: text, security? }
export function plan(p) {
  const e = byId.get(p.args.id);
  if (!e) return { reply: "I don't know that setting." };
  const cur = current(e);
  if (p.intent === "setting.get") return { reply: getLine(e, cur) };
  let next;
  if (p.intent === "setting.set") next = p.args.value;
  else if (p.intent === "setting.toggle") next = !(cur ?? true);
  else if (p.intent === "setting.reset") next = e.type === "num" ? e.def : e.type === "bool" ? (e.id === "clock24" ? false : e.id === "diagnostics" ? true : true) : e.def ?? e.opts?.[0]?.[0];
  else if (p.intent === "setting.adjust") next = (typeof cur === "number" ? cur : e.def ?? (e.min + e.max) / 2) + p.args.delta;
  if (e.type === "num" && typeof next === "number") next = clampNum(e, next);
  if (e.security === "settings" || (e.grantSettings ?? []).includes(next)) return { reply: `${cap(e.label)} ${e.security === "settings" && e.type === "text" ? "is" : "can only be changed"} ${e.security === "settings" && e.type === "text" ? `set in Settings (it's ${say(e, cur)} now).` : "in Settings, where you can see exactly what it allows."} I won't change it by voice.`, refused: true };
  if (e.type === "num" && next === cur) return { reply: `${cap(e.label)} ${is(e)} already ${say(e, cur)}${(p.args.delta ?? 0) > 0 && cur >= e.max ? ", as high as it goes" : (p.args.delta ?? 0) < 0 && cur <= e.min ? ", as low as it goes" : ""}.` };
  if (e.type !== "num" && JSON.stringify(next) === JSON.stringify(cur)) return { reply: `${cap(e.label)} ${is(e)} already ${say(e, cur)}.` };
  const apply = () => { write(e, next, "voice"); return current(e); };
  const changeLine = (now) => `${e.type === "bool" && e.id !== "clock24" ? `${cap(e.label)} ${is(e)} ${say(e, now)} now` : `${cap(e.label)} ${is(e)} now ${say(e, now)}`}${cur !== undefined && cur !== null && e.type === "num" ? ` (it was ${say(e, cur)})` : ""}.`;
  if (e.security === "confirm") return { confirm: `That's a security setting: ${e.label} would be ${say(e, next)}. Say yes to change it, or no to leave it.`, apply, done: (now) => `Done. ${changeLine(now)}`, security: true };
  return { apply, done: (now) => changeLine(now), undoable: true };
}
function getLine(e, v) {
  if (e.id === "voice") return `I'm using ${say(e, v)}${v ? "" : ""}.`;
  if (e.id === "wakeWords") return `Your wake word is ${say(e, v)}.`;
  if (e.id === "name") return v ? `Your name is ${v}.` : "I don't know your name yet. You can add it in Settings.";
  if (e.id === "assistantName") return `My name is ${v || "Dayspring"}.`;
  if (e.id === "location") return v?.place ? `You're set to ${v.place}.` : "Your town isn't set yet. Add it in Settings, Where you are.";
  if (e.type === "bool") return e.id === "clock24" ? `The clock shows ${say(e, v)}.` : `${cap(e.label)} ${is(e)} ${v === false ? "off" : "on"}.`;
  return `${cap(e.label)} ${is(e)} ${say(e, v ?? e.def)}.`;
}

// Ready-to-say phrasings for each setting (the "Things you can say" page; scripts/test-intents.mjs checks that each one
// is understood as that setting). The ones handled by the older skills (the voice, the Bible version, the mixer) say so.
export const EXAMPLES = {
  volume: ["set the volume to 40", "turn the volume up", "what's the volume?"], musicVolume: ["set the music volume to 30", "turn the music down"], videoVolume: ["set the video volume to 60", "turn the video volume up"],
  soundsVolume: ["set the chime volume to 50", "turn the chimes down"], alarmVolume: ["set the alarm volume to 70", "make the alarm louder"], callVolume: ["set the call volume to 50"],
  speed: ["talk a bit faster", "speak slower", "set your talking speed back to normal"], detail: ["give me short answers", "more detailed answers", "set the detail to normal"],
  timeTone: ["turn off the time of day tone", "turn on the time of day tone"], mode: ["mute notifications for an hour", "set notifications to chime only", "turn notifications back on"],
  listenState: ["switch to quiet mode until 3", "go quiet for an hour", "turn listening back on"], overlayOn: ["turn off the notification cards", "show the pop ups"], overlaySeconds: ["show notification cards for 15 seconds"],
  alarmsWhenOff: ["turn off alarms when you're off"], overlayWhenOff: ["turn off notification cards when you're off"], timersWhenQuiet: ["turn off timers when you're quiet"], speakWhenClosed: ["turn on talking when the screen is closed"],
  speechEngine: ["use the private speech recognition", "set speech recognition to automatic"], logMisses: ["stop logging the missed phrases"], alarm: ["turn on the morning alarm", "is the morning alarm on?"],
  alarmSnooze: ["set the snooze to 10 minutes", "how long is the snooze?"], chores: ["turn off chore reminders"], goals: ["turn off goal check ins"], claudeAlerts: ["turn off claude alerts"],
  jokeOffersOn: ["turn off joke offers"], jokeOffers: ["set joke offers per day to 2"], clock24: ["use 24-hour time", "use 12-hour time", "what time format are you using?"],
  uiScale: ["make everything bigger", "zoom out", "set the screen size to 120 percent"], textScale: ["make the text bigger", "set the text size to 120 percent", "reset the text size"],
  clockScale: ["make the clock bigger", "make the clock smaller"], talkWidth: ["make your panel wider", "make your panel narrower"], carousel: ["slower slides", "faster slides", "stop rotating the slides"],
  listRows: ["show 8 rows", "show all the rows"], layout: ["one column", "two columns", "put your panel on the left", "automatic layout"], density: ["make the spacing tighter", "comfortable spacing"],
  fit: ["keep the proportions", "stretch to fill"], uiMotion: ["turn on calmer motion", "turn on animations"], showClock: ["hide the clock", "show the clock"], showNowNext: ["hide now and next"],
  showPanel: ["hide the rotating panel", "show the rotating panel"], showExam: ["hide the exam card"], showCourses: ["hide the course rings"], showTranscript: ["show the transcript", "hide the captions"],
  overscan: ["set the margin to 5 percent", "make the margins bigger", "reset the margins"], marginTop: ["set the top margin to 3"], marginBottom: ["set the bottom margin to 3"], marginLeft: ["set the left margin to 4"], marginRight: ["set the right margin to 4"],
  night: ["night mode dim", "turn off night mode", "is night mode on?"], miniOnTop: ["keep dayspring mini on top"], wakeWords: ["what's my wake word set to?", "change the wake word to computer"],
  pronouns: ["my pronouns are she her", "set my pronouns to he"], diagnostics: ["turn off the developer log"], keepScreenOpen: ["keep the screen open"], openOnStartup: ["open on startup"],
  weather: ["turn off the weather", "turn the weather back on"], news: ["turn off the news"], photos: ["turn off the photo slideshow"], music: ["turn off the music features"], faith: ["turn on the faith features"],
  church: ["turn on the church features"], memoryVerses: ["turn on memory verses"], phone: ["turn on phone link"], claudeCode: ["turn on claude code"], files: ["turn off file access"], programs: ["set opening programs to ask first"],
  browser: ["turn on browser control"], web: ["turn off web search"], deleteFiles: ["allow deleting files"], devices: ["set smart device control to ask first"],
  location: [], folders: [], money: [],
  voice: ["change your voice to Rachel (the voice skill)"], bibleVersion: ["use the ESV by default (the Bible skill)"], mixer: ["turn on the mixer (the audio skill)"],
};
// For the "things you can say" page: each setting with a few ready-made phrasings.
export function examples() {
  const out = [];
  for (const e of SCHEMA) {
    const name = e.names[0].replace(/\(\?[=!][^)]*\)/g, "").replace(/\((?:[^()|]*\|)*([^()|]*)\)\?/g, "").replace(/\(([^()|]+)\|[^()]*\)/g, "$1").replace(/[()?\\]/g, "").replace(/\s+/g, " ").trim();
    const ex = [];
    if (e.type === "bool") ex.push(e.show ? `hide ${name}` : `turn off ${name}`, e.show ? `show ${name}` : `turn on ${name}`);
    if (e.type === "enum") ex.push(`set ${name} to ${e.opts[1]?.[0] ?? e.opts[0][0]}`.replace(/talkLeft/, "the left").replace(/talkRight/, "the right"));
    if (e.type === "num") ex.push(`set ${name} to ${Math.round((e.min + e.max) / 2)}`, `make ${name} ${e.up?.[0] ?? "bigger"}`);
    if (e.ask) ex.push(`what's ${name} set to?`);
    if (e.type === "num" || e.type === "enum") ex.push(`reset ${name}`);
    out.push({ id: e.id, label: e.label, security: e.security ?? null, delegate: Boolean(e.delegate), examples: EXAMPLES[e.id]?.length ? EXAMPLES[e.id] : ex });
  }
  return out;
}
