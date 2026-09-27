// What the owner said about their own music and videos, as data (no AI needed):
//   "play the song Holy Forever from my computer"   → { action: "play", kind: "audio", query: "holy forever", source: "local", explicit }
//   "play my Johnny Cash mp3s"                      → { action: "play", kind: "audio", ext: ["mp3"], query: "johnny cash", explicit }
//   "find the video from Sarah's wedding"           → { action: "find", kind: "video", query: "sarahs wedding" }
//   "play the latest video in Downloads"            → { action: "play", kind: "video", folder: "downloads", latest: true, explicit }
//   "shuffle my music folder"                       → { action: "shuffle", kind: "audio", folder: "music", explicit }
//   "what audio files do I have from 2019"          → { action: "list", kind: "audio", year: 2019, explicit }
//   "play Holy Forever from my work drive"          → { …, source: "drive", drive: "work", explicit }
// explicit: it can only mean the owner's own files (so it's answered even when nothing matches); otherwise it's answered
// only when the library has a good match (so "play Holy Forever" still goes to Spotify when there's no such file).
export const AUDIO_EXT = ["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "wma"];
export const VIDEO_EXT = ["mp4", "m4v", "mkv", "webm", "mov", "avi", "wmv"];
const EXT_RE = new RegExp(`\\b(${[...AUDIO_EXT, ...VIDEO_EXT].join("|")})s?\\b`, "g");
// "from my computer", "on this pc", "off my laptop", "from my files", "on my hard drive", "local"
export const LOCAL_RE = /\b(?:from|on|off|in|of) (?:my |this |the )?(?:own )?(?:computer|pc|laptop|desktop computer|hard ?drive|hard disk|disk|files|machine)\b|\b(?:local|downloaded) (?:files?|music|songs?|videos?|copy)\b|\bon (?:my )?(?:c|d|e) drive\b/;
// "from my drive", "on google drive", "in my work drive", "from Sarah's google drive"
export const DRIVE_RE = /\b(?:from|on|in|off) (?:my |the |our )?(?:([a-z][a-z'-]{1,20}(?: [a-z][a-z'-]{1,20})?) )?(?:google )?drive\b/;
const FOLDER_RE = /\b(?:in|from|on) (?:my |the )?(downloads?|music|videos|desktop|documents|onedrive)(?: folder)?\b|\bmy (downloads?|music|videos) folder\b|\bthe (downloads?|music|videos) folder\b/;
const YEAR_RE = /\b(?:from|in|of|during) ((?:19|20)\d\d)\b|\b((?:19|20)\d\d)(?:'s)? (?:songs|music|videos|files|recordings)\b/;
const VIDEO_WORDS = /\b(videos?|movies?|clips?|films?|footage|recordings? of|home videos?)\b/;
const AUDIO_WORDS = /\b(songs?|music|audio|tracks?|albums?|tunes|recordings?|podcasts?|sermons?|audiobooks?)\b/;
const LIST_RE = /^(?:what|which) (?:(?:audio|music|video|media|song|mp3|sound)\s+)?(?:files?|songs?|videos?|music|mp3s?|tracks?|albums?|movies?)(?: files)? (?:do|did) i have\b|^(?:list|show me|show|tell me) (?:all )?(?:of )?my (?:audio|music|video|media|song|mp3|sound)? ?(?:files?|songs?|videos?|music|mp3s?|tracks?|movies?)\b|^(?:do i have|have i got|how many) (?:any )?(?:audio|music|video|media|song|mp3)? ?(?:files?|songs?|videos?|mp3s?|tracks?|movies?)\b/;
const FIND_RE = /^(?:find|search for|search|look for|look up|where is|wheres|where are|locate|pull up|get)(?: me)? /;
const PLAY_RE = /^(?:play|put on|start|watch|listen to|let me (?:hear|watch|see)|throw on|queue up|i want to (?:hear|watch|listen to)|can you play|could you play|please play)\b/;
const SHUFFLE_RE = /\bshuffle\b|\bon shuffle\b|\bin random order\b|\bmix up\b/;
const LATEST_RE = /\b(latest|newest|most recent|last|recent|new)\b/;
const OWN_RE = /\bmy\b.*\b(files?|mp3s?|recordings?|home videos?|downloads?|folder)\b|\b(audio|video|music|media|sound) files?\b/;
// words that say HOW, not WHAT (dropped from the search words)
const FILLER = /\b(?:the|a|an|my|me|some|all|of|any|please|can|could|you|would|for|to|from|on|in|off|by|that|this|these|those|with|and|song|songs|track|tracks|video|videos|movie|movies|clip|clips|film|films|music|audio|file|files|folder|called|named|titled|about|one|ones|do|i|have|what|which|play|played|playing|find|search|look|looking|up|where|is|are|show|list|shuffle|shuffled|start|watch|listen|hear|let|put|throw|queue|latest|newest|most|recent|last|new|computer|pc|laptop|local|own|drive|google|mp3s?|here|there|screen|tv|again|random|order|mix|want|get|pull|locate|tell|how|many|got|media|sound|recording|recordings|from)\b/g;

const clean = (t) => String(t ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim()
  .replace(/^(?:hey |ok |okay )?(?:dayspring )?/, "").replace(/^(?:can you|could you|would you|please|will you) /, "").replace(/ please$/, "").trim();

export function parse(text) {
  const raw = clean(text);
  if (!raw) return null;
  let q = raw;
  const action = LIST_RE.test(q) ? "list" : SHUFFLE_RE.test(q) && !FIND_RE.test(q) ? "shuffle" : FIND_RE.test(q) ? "find" : PLAY_RE.test(q) ? "play" : null;
  if (!action) return null;
  if (/\b(youtube|spotify|pandora|netflix|hulu|radio|podcast app|playlist on spotify)\b/.test(q)) return null;   // someone else's
  const out = { action, kind: null, query: "", source: "any", drive: null, folder: null, year: null, ext: null, latest: false, explicit: false, raw };
  let m;
  if (LOCAL_RE.test(q)) { out.source = "local"; out.explicit = true; q = q.replace(LOCAL_RE, " "); }
  else if ((m = DRIVE_RE.exec(q)) && !/\bhard ?drive\b/.test(m[0])) {
    out.source = "drive"; out.explicit = true;
    const who = (m[1] ?? "").replace(/\b(my|the|our|google)\b/g, "").replace(/'s$/, "").trim();
    if (who && !/^(google|the|my)$/.test(who)) out.drive = who;
    q = q.replace(m[0], " ");
  }
  if ((m = FOLDER_RE.exec(q))) { out.folder = (m[1] ?? m[2] ?? m[3]).replace(/^download$/, "downloads"); out.explicit = true; q = q.replace(m[0], " "); }
  const exts = [...new Set([...q.matchAll(EXT_RE)].map((x) => x[1]))];
  if (exts.length) { out.ext = exts; out.explicit = true; q = q.replace(EXT_RE, " "); }
  if ((m = YEAR_RE.exec(q))) { out.year = Number(m[1] ?? m[2]); q = q.replace(m[0], " "); }
  if (VIDEO_WORDS.test(raw) || (out.ext && out.ext.every((e) => VIDEO_EXT.includes(e))) || out.folder === "videos") out.kind = "video";
  else if (AUDIO_WORDS.test(raw) || (out.ext && out.ext.every((e) => AUDIO_EXT.includes(e))) || out.folder === "music") out.kind = "audio";
  if (LATEST_RE.test(q)) out.latest = true;
  if (OWN_RE.test(raw) || action === "list") out.explicit = true;
  // how to say it back: the words as said, without the verb and "the song"
  out.said = q.replace(/^(?:play|put on|start|watch|listen to|let me (?:hear|watch|see)|throw on|queue up|i want to (?:hear|watch|listen to)|find|search for|search|look for|look up|where is|wheres|where are|locate|pull up|get|shuffle)\b(?: me)?/, " ")
    .replace(/^\s*(?:(?:the|a|an|my|some|all|of)\s+)*(?:(?:song|video|track|movie|clip|file|recording)s?\s+)?(?:(?:called|named|titled)\s+)?/, "").replace(/\s+/g, " ").trim();
  // "the video from Sarah's wedding": what's left after the how-words
  out.query = q.replace(/'s\b/g, "s").replace(/'/g, "").replace(FILLER, " ").replace(/\s+/g, " ").trim();
  // "shuffle" with nothing else named means "my music"
  if (action === "shuffle" && !out.query && !out.folder && !out.ext && out.source !== "drive") out.kind ??= "audio";
  return out;
}

// follow-ups while a list of the owner's files is on the screen
export function followUp(text) {
  const q = clean(text);
  let m;
  const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
  if ((m = /^(?:play |open |pick |choose |go with |start )?(?:number |option |the )?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?:st|nd|rd|th)?(?: one| song| video| file)?$/.exec(q))) return { pick: NUM[m[1]] ?? Number(m[1]) };
  if (/^(?:play|shuffle|queue) (?:them )?all(?: of them)?$|^play (?:all of )?(?:them|these|those|the (?:whole )?list)$|^(?:shuffle) (?:them|these|those|the list)$/.test(q)) return { all: true, shuffle: /shuffle/.test(q) };
  if (/^(?:none|none of (?:these|those|them)|close (?:the |that )?(?:list|results)|never ?mind|nevermind)$/.test(q)) return { close: true };
  return null;
}
// "open it in the default app", "play it on this pc", "use windows media player", "open it in vlc"
export const OPEN_DEFAULT = /\b(?:open|play) (?:it|that|this|that file|this file|the file)? ?(?:in|with|on|using) (?:the |my |your )?(?:default (?:app|player|program)|usual (?:app|player)|this pc|the pc|windows|media player|windows media player|vlc|movies (?:and|&) tv|groove|another app|an app|my player)\b|^(?:open it|use my (?:usual|default) player)$/;
