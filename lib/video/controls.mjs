// Playback controls by voice or typing, no AI needed, for whatever is playing: a YouTube video on the Dayspring screen,
// a video in the media window, his own music and videos and Google Drive's, and Spotify where it applies.
//   parse(text, { playing, video }) → { action, value, say } | { ask: "now"|"left"|"next" } | null
// The actions are the screen player's (public/tv.js ctl()): pause, resume, stop, restart, seek, seekBy, seekPct, speed,
// speedBy, volume, volumeBy, mute, unmute, captions, captionLang, quality, full, minimize, next, previous, repeat, shuffle,
// and how a video is shown: view (big | corner | audio | full | exitFull), place (tl | tr | bl | br | t | b | l | r | c),
// resize (bigger | smaller).
// Volume here is the MEDIA volume (the video's or the music's), never the computer's or Dayspring's own voice.
import { clean } from "./parse.mjs";
import { secondsIn, mmss, spokenLength } from "./text.mjs";
import "../../public/view-words.js";                // (a plain script shared with the screen: it sets globalThis.dsViewWords)
export const viewWords = (t) => globalThis.dsViewWords(t);

export const LANGS = { english: "en", spanish: "es", french: "fr", german: "de", portuguese: "pt", italian: "it", russian: "ru", japanese: "ja", korean: "ko", chinese: "zh", mandarin: "zh",
  arabic: "ar", hindi: "hi", dutch: "nl", greek: "el", hebrew: "he", polish: "pl", turkish: "tr", vietnamese: "vi", swedish: "sv", ukrainian: "uk", indonesian: "id", tagalog: "tl", filipino: "fil",
  latin: "la", norwegian: "no", danish: "da", finnish: "fi", czech: "cs", romanian: "ro", hungarian: "hu", thai: "th", persian: "fa", swahili: "sw" };
const LANG_RE = new RegExp(`\\b(${Object.keys(LANGS).join("|")})\\b`);
const THE = "(?:the |this |that |my )?";
const MEDIA = "(?:it|this|that|the (?:music|song|video|movie|show|clip|player|playback|track)|music|video|playback|youtube|spotify)";

// "1.5x", "one and a half", "double" → a rate
function rateIn(t) {
  const tt = t.replace(/\bone and a half\b/g, "1.5").replace(/\bone point two five\b/g, "1.25").replace(/\bone point five\b/g, "1.5").replace(/\bone point seven five\b/g, "1.75").replace(/\b(?:zero )?point seven five\b/g, "0.75").replace(/\b(?:zero )?point five\b/g, "0.5").replace(/\bhalf\b(?= speed)/g, "0.5").replace(/\b(?:double|twice)\b(?= (?:the )?speed)/g, "2");
  let m;
  if ((m = /\b(\d(?:\.\d{1,2})?) ?(?:x|times)\b/.exec(tt)) || (m = /\bspeed (?:to |at |of )?(\d(?:\.\d{1,2})?)\b/.exec(tt)) || (m = /\b(\d(?:\.\d{1,2})?) (?:speed|playback)\b/.exec(tt)) || (m = /\b(?:play|put|set) (?:it |this |the video )?(?:at|to) (\d(?:\.\d{1,2})?)(?: speed)?$/.exec(tt))) {
    const v = Number(m[1]); if (v >= 0.25 && v <= 2) return v;
  }
  if (/\bdouble speed\b|\btwice as fast\b|\b2 speed\b/.test(tt)) return 2;
  return null;
}
export function qualityIn(t) {
  let m;
  if (/\b(?:highest|best|maximum|max|top|full) (?:possible )?quality\b|\bquality (?:to )?(?:the )?(?:highest|best|max|maximum)\b/.test(t)) return "highest";
  if (/\b(?:lowest|worst|minimum|min|data saver|lower) quality\b|\bquality (?:to )?(?:the )?(?:lowest|min|minimum)\b|\bsave data\b/.test(t)) return "lowest";
  if (/\bauto(?:matic)? quality\b|\bquality (?:to |on )?auto(?:matic)?\b/.test(t)) return "auto";
  if (/\b4k\b|\b2160 ?p?\b|\bultra hd\b/.test(t)) return "2160p";
  if ((m = /\b(144|240|360|480|720|1080|1440) ?p?\b/.exec(t))) return `${m[1]}p`;
  if (/\bfull hd\b/.test(t)) return "1080p";
  if (/\b(?:in )?hd\b|\bhigh definition\b/.test(t)) return "720p";
  return null;
}
// playing: something is playing (the screen said so); video: it's a video (not music)
export function parse(text, { playing = true, video = true } = {}) {
  const t = clean(text);
  if (!t || t.length > 120) return null;
  if (/\b(?:your voice|yourself|you talk|you speak|talking|speaking|your volume|the computer|the pc|the laptop|the tv volume|system volume|windows volume)\b/.test(t)) return null;   // Dayspring's own voice, or the device
  let m, v;
  // questions
  if (/^(?:what(?:'s| s| is|s)|which) (?:this|playing|on|this (?:song|video|one)|the (?:song|video)(?: playing)?|song is (?:this|playing)|video is (?:this|playing|on))(?: called| now| right now)?$|^what am i (?:watching|listening to)$|^what(?:'s| is|s) (?:this|that) (?:song|video) called$|^what(?:'s| s| is|s) playing(?: now| right now)?$|^who(?:'s| is) (?:this|singing this|talking)$|^whose (?:video|channel) is this$/.test(t)) return { ask: "now" };
  if (/^how (?:much|long) (?:time )?(?:is |has it got |does it have )?(?:left|remaining|to go)(?: (?:in|on) (?:this|the) (?:video|song|one|movie|episode))?$|^how long is (?:this|the|it)(?: video| song| one| movie| episode)?(?: left)?$|^(?:how much|what(?:'s| is)) (?:of )?(?:this|the) (?:video|song) (?:is )?left$|^when (?:does|will) (?:this|it|the video|the song) (?:end|finish|be over)$|^time (?:left|remaining)$/.test(t)) return { ask: "left" };
  if (/^what(?:'s| s| is|s) (?:up next|next|coming up next|playing next|after this)$/.test(t)) return { ask: "next" };
  if (!playing) return null;
  // play / pause / stop
  if (new RegExp(`^(?:pause|pause ${THE}${MEDIA}|hold on|hold it|freeze it|pause for a (?:sec|second|moment|minute))$`).test(t)) return { action: "pause", say: "Paused." };
  if (new RegExp(`^(?:resume|unpause|play|keep (?:going|playing|watching)|continue(?: playing| watching)?|resume ${THE}${MEDIA}|play ${MEDIA}(?: again)?|start ${MEDIA} again|go on|carry on)$`).test(t)) return { action: "resume", say: "Playing." };
  if (new RegExp(`^(?:stop|stop ${THE}${MEDIA}|close ${THE}(?:video|player|youtube)|turn off ${THE}(?:video|music)|end ${THE}(?:video|music)|stop playing|stop playback)$`).test(t)) return { action: "stop", say: "Stopped." };
  // where in it
  if (/^(?:restart|start (?:it |this |the video |the song )?over|start from the (?:beginning|top|start)|from the (?:beginning|top)|go (?:back )?to the (?:beginning|start|top)|back to the (?:beginning|start|top)|restart (?:the |this )?(?:song|video|track|episode)|play (?:it|this) from the (?:beginning|start)|rewind to the (?:beginning|start)|take it from the top)$/.test(t)) return { action: "restart", say: "From the beginning." };
  if (/^(?:go|jump|skip|take me|seek) to (?:the )?(?:middle|halfway(?: point)?|half ?way)(?: of (?:it|the video|the song))?$|^(?:go|jump) halfway(?: through)?$/.test(t)) return { action: "seekPct", value: 50, say: "Halfway through." };
  if ((m = /^(?:go|jump|skip|seek|fast forward|move|take me|take it|start|play from|start from|start it|go ahead|skip ahead) ?(?:ahead|forward)? (?:to|at|from) (?:the )?(.+?)(?: mark| point| in| minute mark| second mark)?$/.exec(t)) && /\d|minute|second|hour|half/.test(m[1]) && !/\b(?:ahead|forward|back) (?:by )?\d/.test(t)) { v = secondsIn(m[1]); if (v >= 0) return { action: "seek", value: v, say: `Jumping to ${mmss(v)}.` }; }
  if ((m = /^(?:skip|jump|go|fast forward|forward|move|zip)(?: it)?(?: ahead| forward| forwards)(?: by)? (.+)$|^fast forward (.+)$|^skip (?:ahead )?(\d.+|a minute|a few seconds|an? .+)$/.exec(t))) { v = secondsIn(m[1] ?? m[2] ?? m[3]); if (/\ba few seconds\b/.test(t)) v = 10; if (v > 0) return { action: "seekBy", value: v, say: `Forward ${spokenLength(v)}.` }; }
  if (/^(?:fast forward|skip ahead|skip forward|jump ahead|go forward|forward)(?: a (?:bit|little))?$/.test(t)) return { action: "seekBy", value: /bit|little/.test(t) ? 15 : 30, say: "Forward 30 seconds." };
  if ((m = /^(?:go back|rewind|back up|skip back|jump back|back|move back|rewind it)(?: it)?(?: by)? (.+)$/.exec(t))) { v = secondsIn(m[1]); if (/\ba (?:bit|little|few seconds)\b/.test(m[1])) v = 10; if (v > 0) return { action: "seekBy", value: -v, say: `Back ${spokenLength(v)}.` }; }
  if (/^(?:rewind|rewind (?:it|a bit|a little)|go back a (?:bit|little)|back up a (?:bit|little)|skip back|jump back)$/.test(t)) return { action: "seekBy", value: -10, say: "Back 10 seconds." };
  // speed
  if (!/\b(?:talk|speak|read|your)\b/.test(t)) {
    v = rateIn(t);
    if (v != null && /\b(?:speed|x|times|play|playback|set|put)\b|^\d/.test(t)) return { action: "speed", value: v, say: `${v === 1 ? "Normal" : v + "×"} speed.` };
    if (/\bhalf speed\b/.test(t)) return { action: "speed", value: 0.5, say: "Half speed." };
    if (/^(?:(?:play at |back to |set it to |go back to )?(?:normal|regular|usual|standard) (?:speed|playback(?: speed)?)|reset (?:the )?speed|speed (?:back )?to normal|1 x|one x)$/.test(t)) return { action: "speed", value: 1, say: "Normal speed." };
    if (/^(?:speed (?:it |this |the video |up the video )?up|faster|play (?:it )?faster|a (?:little|bit) faster|speed up (?:the )?(?:video|playback)|increase (?:the )?(?:playback )?speed)$/.test(t)) return { action: "speedBy", value: 1, say: "A little faster." };
    if (/^(?:slow (?:it |this |the video )?down|slower|play (?:it )?slower|a (?:little|bit) slower|slow down (?:the )?(?:video|playback)|decrease (?:the )?(?:playback )?speed|slow motion)$/.test(t)) return { action: "speedBy", value: -1, say: "A little slower." };
  }
  // media volume
  if (new RegExp(`^mute(?: ${THE}${MEDIA})?$|^(?:turn|put) (?:the )?(?:sound|volume) off$`).test(t)) return { action: "mute", say: "Muted." };
  if (new RegExp(`^unmute(?: ${THE}${MEDIA})?$|^(?:turn|put) (?:the )?(?:sound|volume) (?:back )?on$|^sound on$`).test(t)) return { action: "unmute", say: "Sound's back on." };
  if ((m = /^(?:set |turn |put |change )?(?:the )?(?:music |song |video |media |youtube |spotify )?volume (?:to |at )?(\d{1,3})(?: ?%| percent)?$|^(?:turn|set|put) (?:it|the music|the video|this|the volume|the sound) (?:to|at) (\d{1,3})(?: ?%| percent)?$|^volume (\d{1,3})$/.exec(t))) { v = Math.min(100, Number(m[1] ?? m[2] ?? m[3])); return { action: "volume", value: v, say: `Volume ${v}.` }; }
  if (/^(?:turn (?:it|this|that|the music|the song|the video|the volume|the sound) up(?: a (?:little|bit|lot|notch))?|turn up (?:the )?(?:music|volume|song|video|sound)|louder|volume up|a (?:little|bit) louder|crank it(?: up)?|make it louder)$/.test(t)) return { action: "volumeBy", value: /little|bit|notch/.test(t) ? 8 : /lot/.test(t) ? 25 : 15, say: "Louder." };
  if (/^(?:turn (?:it|this|that|the music|the song|the video|the volume|the sound) down(?: a (?:little|bit|lot|notch))?|turn down (?:the )?(?:music|volume|song|video|sound)|quieter|softer|volume down|a (?:little|bit) quieter|too loud|make it quieter)$/.test(t)) return { action: "volumeBy", value: /little|bit|notch/.test(t) ? -8 : /lot/.test(t) ? -25 : -15, say: "Quieter." };
  // captions
  const CAP = "(?:captions?|subtitles?|closed captions?|cc|subs)";
  if ((m = new RegExp(`\\b${CAP}\\b.*${LANG_RE.source}|${LANG_RE.source}.*\\b${CAP}\\b`).exec(t)) && !/\b(?:off|hide|disable|no)\b/.test(t)) { const lang = m[1] ?? m[2]; return { action: "captionLang", value: LANGS[lang], say: `Captions in ${lang[0].toUpperCase() + lang.slice(1)}.` }; }
  if (new RegExp(`^(?:turn |switch |put )?(?:on )?(?:the )?${CAP} on$|^(?:turn|switch|put) on (?:the )?${CAP}$|^(?:show|enable|start)(?: me)? (?:the )?${CAP}$|^${CAP}(?: please)?$|^(?:i need|give me) (?:the )?${CAP}$`).test(t)) return { action: "captions", value: true, say: "Captions on." };
  if (new RegExp(`^(?:turn |switch )?(?:the )?${CAP} off$|^(?:turn|switch) off (?:the )?${CAP}$|^(?:hide|disable|stop|remove)(?: the)? ${CAP}$|^no (?:more )?${CAP}$`).test(t)) return { action: "captions", value: false, say: "Captions off." };
  // quality
  if (/\bquality\b|\b(?:\d{3,4}p|4k|hd)\b/.test(t) && /^(?:set |change |switch |put |make |play |watch |go to |turn )?(?:it |the video |the quality |this )?(?:to |in |at |on )?(?:the )?(?:\w+ ){0,3}(?:quality|\d{3,4} ?p|4k|hd|full hd|ultra hd)(?: quality)?(?: please)?$/.test(t)) { v = qualityIn(t); if (v) return { action: "quality", value: v, say: v === "auto" ? "Quality on automatic." : `Asking for ${v === "highest" ? "the highest" : v === "lowest" ? "the lowest" : v} quality.` }; }
  // the picture: big, in the corner (picture in picture), audio only, full screen; where the corner window goes, its
  // size (public/view-words.js: the same words the screen understands on its own)
  { const w = viewWords(t); if (w) return w; }
  // next / previous / repeat / shuffle
  if (/^(?:next|skip|next (?:song|track|one|video)|skip (?:this|it|that|this song|song|this one|track|this video|the video)|play the next (?:song|one|video)|skip to the next (?:song|one|track|video))$/.test(t)) return { action: "next", say: "Next." };
  if (/^(?:previous|go back|previous (?:song|track|one|video)|last (?:song|track|one|video)|play the (?:previous|last) (?:song|one|video)|go back a (?:song|video)|go back one|back a video|go back to the (?:last|previous) (?:song|video))$/.test(t)) return { action: "previous", say: "Going back." };
  if (/^(?:repeat|loop) (?:this|this song|it|the song|this one|this video|the video|one)$|^repeat one$|^(?:put|set) (?:it )?on repeat$/.test(t)) return { action: "repeat", value: "track", say: "Repeating this one." };
  if (/^(?:repeat(?: all| everything)?|repeat on|turn on repeat|loop (?:all|everything))$/.test(t)) return { action: "repeat", value: "context", say: "Repeat all on." };
  if (/^(?:repeat off|stop repeating|turn off repeat|no repeat|stop looping|loop off)$/.test(t)) return { action: "repeat", value: "off", say: "Repeat off." };
  if (/^(?:shuffle(?: on| it)?|turn on shuffle|put it on shuffle|shuffle (?:this|the playlist))$/.test(t)) return { action: "shuffle", value: true, say: "Shuffle on." };
  if (/^(?:shuffle off|turn off shuffle|stop shuffling|no shuffle|unshuffle)$/.test(t)) return { action: "shuffle", value: false, say: "Shuffle off." };
  return null;
}

// "What's playing?" and "how long is left?" from what the screen last said it was doing (media.playerState())
export function position(st, now = Date.now()) {
  if (!st?.source) return null;
  const at = Date.parse(st.at ?? "") || now, pos = Number(st.position) || 0, dur = Number(st.duration) || 0;
  const p = st.playing ? pos + ((now - at) / 1000) * (Number(st.rate) || 1) : pos;
  return { pos: dur ? Math.min(dur, p) : p, dur };
}
export function answer(ask, st, { queue = null } = {}) {
  if (!st?.source) return "Nothing is playing right now.";
  const what = st.source === "youtube" ? "video" : st.source === "file" ? (st.video ? "video" : "song") : "song";
  if (ask === "now") {
    const from = st.artist && !/^youtube$/i.test(st.artist) ? (st.source === "youtube" ? `, from ${st.artist}` : `, by ${st.artist}`) : "";
    const place = queue && queue.current && st.source === "youtube" && queue.total > 1 ? ` It's number ${queue.index + 1} of ${queue.total} in the queue.` : "";
    return st.title ? `This is ${st.title}${from}.${st.playing ? "" : " It's paused."}${place}` : `I'm not sure what this ${what} is called.`;
  }
  if (ask === "left") {
    const p = position(st);
    if (!p?.dur) return st.source === "youtube" && st.live ? "It's a live stream, so there's no end time." : `I can't tell how long this ${what} is.`;
    const left = Math.max(0, p.dur - p.pos);
    return `About ${spokenLength(left)} left, of ${spokenLength(p.dur)}.${st.playing ? "" : " It's paused."}`;
  }
  return null;
}
