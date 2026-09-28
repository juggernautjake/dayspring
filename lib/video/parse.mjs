// Understanding a video request, no AI needed. Pure functions (tests call them directly).
//   request(text)  → { act, kind, query, creator, filters, count, next, shuffle, name, explicit } | null
//       act:  play | browse | queue | playlists (list his YouTube playlists) | playlist (play/shuffle one of his)
//             | queuePlaylist | showPlaylist | alias (teach a name → channel)
//       kind: title | topic | creator | playlist | live | morelike | episode | this
//   context(text)  → an answer to what's on screen: { op: "pick"|"queueMany"|"more"|"refine"|"close"|"none"|"notThat", n, ns, filters }
//   queueOp(text)  → { op: "show"|"whatsNext"|"play"|"remove"|"move"|"clear"|"shuffle"|"unshuffle"|"repeat"|"skip"|"previous", n, to }
// A request "claims" the words (they go to videos, not the Bible, music or pictures) when it says YouTube, video(s),
// a channel, a live stream, a clip or an episode: "find bible reading in psalms on youtube" is a video search, while
// "read psalms 23" is not a video request at all.
import { NUM_RE, numOf, secondsIn } from "./text.mjs";

const LEAD = /^(?:(?:hey|ok|okay|hi|yo)\s+)?(?:dayspring|day spring)?[\s,]*/;
const POLITE = /\b(?:can you|could you|would you|will you|please|pls|i want to|i wanna|i would like to|id like to|let me|lets|go ahead and|for me|real quick|thanks|thank you|right now)\b/g;
export function clean(text) {
  return String(text ?? "").toLowerCase().replace(/[’`]/g, "'").replace(/[!?,;"“”]/g, " ").replace(/\.(?!\d)/g, " ").replace(/\s+/g, " ").trim()
    .replace(LEAD, "").replace(POLITE, " ").replace(/\s+/g, " ").trim();
}
// the words that make it a video request
export const VIDEO_WORDS = /\b(?:youtube|you tube|videos?|vids?|clips?|vlogs?|livestreams?|live ?streams?|episodes?|channel|youtuber|youtube shorts?)\b/;
const ON_YT = /\s*\b(?:on|from|in|off|using|through) (?:the )?(?:youtube|you tube)(?: please)?\b\s*/g;

// ---- filters: length, how new, how popular, Shorts ---------------------------------------------------------------------
export function filtersFrom(q) {
  const f = {};
  let m, rest = ` ${q} `;
  const cut = (re) => { rest = rest.replace(re, " "); };
  if ((m = new RegExp(`\\b(?:under|less than|shorter than|no longer than|at most|below) ${NUM_RE} ?(minutes?|mins?|hours?|seconds?)\\b`).exec(rest))) { f.maxSecs = secondsIn(`${m[1]} ${m[2]}`); cut(m[0]); }
  if ((m = new RegExp(`\\b(?:over|more than|longer than|at least|above|bigger than) ${NUM_RE} ?(minutes?|mins?|hours?)\\b`).exec(rest))) { f.minSecs = secondsIn(`${m[1]} ${m[2]}`); cut(m[0]); }
  if (/\b(?:over|more than|longer than|at least) (?:an|one) hour\b/.test(rest)) { f.minSecs = 3600; cut(/\b(?:over|more than|longer than|at least) (?:an|one) hour\b/); }
  if (/\b(?:under|less than|shorter than) (?:an|one) hour\b/.test(rest)) { f.maxSecs = 3600; cut(/\b(?:under|less than|shorter than) (?:an|one) hour\b/); }
  if (/\bfull[- ]?(?:length|episodes?|movie|sermon|service|video)\b/.test(rest)) { f.full = true; f.minSecs ??= 1200; cut(/\bfull[- ]?length\b|\bfull(?= (?:episodes?|movie|sermon|service|video))/); }
  if (/\b(?:long|longer|lengthy)\b(?= (?:videos?|ones?|sermons?|documentar))/.test(rest)) { f.minSecs ??= 1200; cut(/\b(?:long|longer|lengthy)\b(?= )/); }
  if (/\b(?:short|shorter|quick)\b(?= (?:videos?|ones?|clips?))/.test(rest)) { f.maxSecs ??= 600; cut(/\b(?:short|shorter|quick)\b(?= )/); }
  if (/\b(?:no|without|not|skip(?: the)?|exclude|hide) (?:youtube )?shorts\b|\bnot a short\b/.test(rest)) { f.noShorts = true; cut(/\b(?:no|without|not|skip(?: the)?|exclude|hide) (?:youtube )?shorts\b|\bnot a short\b/); }
  else if (/\b(?:youtube )?shorts?\b(?! (?:videos?|clips?|ones?))|\ba short\b/.test(rest) && !/\bshort (?:videos?|clips?|ones?)\b/.test(rest)) { f.shorts = true; cut(/\b(?:youtube )?shorts?\b/); }
  if (/\b(?:newest|latest|most recent|newest first|brand new)\b/.test(rest)) { f.newest = true; cut(/\b(?:newest|latest|most recent|brand new)(?: first)?\b/); }
  else if (/\b(?:recent|new)\b(?= (?:videos?|ones?|uploads?|episodes?|video))/.test(rest)) { f.recentDays = 60; cut(/\b(?:recent|new)\b(?= )/); }
  if ((m = /\b(?:from |uploaded |posted )?(today|this week|this month|this year|the last week|the past week|the last month|the past month|the last year)\b/.exec(rest))) { f.recentDays = { today: 1, "this week": 7, "the last week": 7, "the past week": 7, "this month": 31, "the last month": 31, "the past month": 31, "this year": 365, "the last year": 365 }[m[1]]; cut(m[0]); }
  if (/\b(?:most viewed|most watched|most popular|popular|top|best|viral|trending)\b/.test(rest)) { f.popular = true; cut(/\b(?:most viewed|most watched|most popular|popular|top|best|viral|trending)\b/); }
  return { filters: f, rest: rest.replace(/\s+/g, " ").trim() };
}

// the topic words, without the request's own words
const tidy = (s) => String(s ?? "").replace(ON_YT, " ").replace(/\b(?:video|videos|vids?|clips?)\b/g, " ").replace(/^(?:a|an|the|some|any|me|us)\s+/, "").replace(/\s+(?:please|now|again)$/, "")
  .replace(/^(?:about|on|of|for|with)\s+/, "").replace(/\s+/g, " ").trim();
const countOf = (w) => { const n = numOf(w); return Number.isFinite(n) && n > 0 ? Math.min(25, Math.round(n)) : null; };

// ---- the request ------------------------------------------------------------------------------------------------------
export function request(text) {
  const raw = String(text ?? "").trim();
  let q = clean(raw);
  if (!q || q.length > 240) return null;
  const explicit = VIDEO_WORDS.test(q);
  let m;
  // teaching a name: "when I say Pastor Bob I mean First Baptist Church", "John MacArthur's channel is Grace to You"
  if ((m = /^(?:when i say|if i say) (.+?),? i mean(?: the channel| the youtube channel)? (.+)$/.exec(q)) || (m = /^(?:remember(?: that)? )?(.+?)(?:'s| s) (?:youtube )?channel is (?:called )?(.+)$/.exec(q)) || (m = /^(?:remember(?: that)?|note that) (.+?) is on (?:the )?(.+?)(?: channel)?(?: on youtube)?$/.exec(q)))
    return { act: "alias", name: m[1].trim(), channel: m[2].replace(/\b(?:channel|on youtube)\b/g, "").trim(), explicit: true };
  if ((m = /^(?:forget|remove|delete) (?:the )?(?:channel )?(?:name |alias )?(?:for )?(.+?)(?:'s| s)? (?:channel|alias)$/.exec(q))) return { act: "unalias", name: m[1].trim(), explicit: true };

  // the owner's own YouTube playlists
  if (/^(?:list|show|read|tell me|what are|whats|what s|what is|pull up|open|see)(?: me)?(?: all)?(?: of)? my (?:youtube |yt )?playlists(?: on youtube)?$|^what (?:youtube )?playlists do i have(?: on youtube)?$|^(?:do i have any|which) (?:youtube )?playlists(?: do i have)?(?: on youtube)?$/.test(q)) {
    if (/\b(?:youtube|yt)\b/.test(q)) return { act: "playlists", explicit: true };
    return { act: "playlists", explicit: false };
  }
  const special = (s) => (/\b(?:liked|like|likes|thumbs up|favou?rited?)\b/.test(s) ? "liked" : /\bwatch ?later\b|\bsaved for later\b/.test(s) ? "watchlater" : null);
  if ((m = /^(play|shuffle|start|put on|watch|queue|queue up|add)(?: me)? (?:my|the) (.+?)(?: youtube| video| videos)? (?:playlist|list)(?: on youtube)?(?: (after this|next|to the queue|to my queue|at the end))?$/.exec(q)) || (m = /^(play|shuffle|watch|queue|add) (?:my |the )?(liked (?:youtube )?videos|videos i (?:liked|like)|watch ?later(?: list| videos)?|youtube likes|liked list)(?: on youtube)?(?: (after this|next|to the queue|to my queue))?$/.exec(q))) {
    const name = m[2].replace(/\b(?:youtube|videos?)\b/g, " ").replace(/\s+/g, " ").trim(), sp = special(m[2]);
    const queueIt = /^(?:queue|add)/.test(m[1]) || Boolean(m[3]);
    return { act: queueIt ? "queuePlaylist" : "playlist", name: sp === "liked" ? "Liked videos" : sp === "watchlater" ? "Watch later" : name, special: sp, shuffle: m[1] === "shuffle", next: /next|after this/.test(m[3] ?? ""), explicit: /\b(?:youtube|videos?)\b/.test(q) || Boolean(sp) };
  }
  if ((m = /^what(?:'s| s| is|s) (?:in|on) (?:my |the )?(.+?) (?:youtube )?playlist$/.exec(q)) && !/^(?:this|that|the)$/.test(m[1])) return { act: "showPlaylist", name: m[1].replace(/\byoutube\b/g, "").trim(), explicit: /youtube|video/.test(q) };

  // "more like this"
  if (/^(?:play |find |show me |pull up |queue )?(?:me )?(?:some )?(?:more|other|similar)(?: videos?| ones?| stuff| things)? (?:like (?:this|that)(?: one| video)?|similar to (?:this|that)(?: one| video)?)$|^(?:play|find|show me) (?:something|videos?) (?:similar|like (?:this|that))(?: one| video)?$/.test(q))
    return { act: /^(?:find|show me|pull up)/.test(q) ? "browse" : /^queue/.test(q) ? "queue" : "play", kind: "morelike", query: "", filters: {}, explicit: true };
  // "queue the next episode", "play the next episode"
  if ((m = /^(queue|queue up|add|play|put on|watch)(?: me)? the (next|following) (?:episode|part|video in (?:the|this) series)(?: of (.+?))?(?: to the queue)?$/.exec(q)))
    return { act: /^(?:queue|add)/.test(m[1]) ? "queue" : "play", kind: "episode", query: (m[3] ?? "").trim(), filters: {}, explicit: true };

  // queueing: "queue X", "add X to the queue", "play X next", "queue 3 videos about Y"
  if ((m = /^(?:queue|queue up|line up) (.+)$/.exec(q)) || (m = /^(?:add|put) (.+?) (?:to|in|on|onto|into) (?:the |my )?(?:video )?(?:queue|up next|watch queue|list)$/.exec(q)) || (m = /^(?:play|watch|put on) (.+?) (?:next|after this(?: one| video)?|after that)$/.exec(q))) {
    const next = /^(?:play|watch|put on) .+ (?:next|after)/.test(q);
    let body = m[1].trim();
    if (/^(?:this|it|that|this one|that one|this video|that video|the current (?:one|video))$/.test(body)) return { act: "queue", kind: "this", query: "", filters: {}, next, explicit: true };
    let count = null;
    if ((m = new RegExp(`^${NUM_RE} (?:more )?(?:youtube )?(?:videos?|clips?|ones?|episodes?)\\b(.*)$`).exec(body)) && countOf(m[1]) > 1) { count = countOf(m[1]); body = m[2].trim(); }
    // "queue number 2 and 4": the screen's list (context), not a search
    if (count == null && (/^(?:numbers? )?\d+(?:st|nd|rd|th)?(?:,? (?:and |& ?|plus )?(?:number )?\d+(?:st|nd|rd|th)?)*(?: ones?)?$/.test(body) || /^(?:numbers? \d|the (?:first|second|third|fourth|fifth|last)(?: one)?$)/.test(body))) return null;
    const { filters, rest } = filtersFrom(body);
    const r = subject(rest);
    if (!r.query && !r.creator) return null;
    return { act: "queue", ...r, filters, count, next, explicit: explicit || count != null };
  }

  // browsing: "pull up videos about biking", "show me videos by mike winger", "search youtube for dovetails"
  if ((m = /^(?:pull up|bring up|show me|show|give me|find me|find|get me|look up|search for|search|browse|list|let me see|i want to see)(?: me)?(?: a (?:bunch|list|lot|few|couple|grid|page)(?: of)?| some| a few| more| all the| all| the)? ((?:[\w'-]+ ){0,4}?)(?:youtube )?(videos|vids|clips|youtubers|channels|episodes|sermons|livestreams|live ?streams) (.+)$/.exec(q)) && !/^(?:my|on my computer)/.test(m[3]))
    return browse(m[1] + " " + m[3], explicit, m[2]);
  if ((m = /^(?:search|browse|look (?:on|through)|check) (?:youtube|you tube)(?: for)? (.+)$/.exec(q)) || (m = /^(?:search|browse)(?: for)? (.+?) on (?:youtube|you tube)$/.exec(q)) || (m = /^what(?:'s| s| is|s) on youtube (?:about|for|with) (.+)$/.exec(q)))
    return browse(m[1], true, "videos");
  if ((m = /^(?:videos|youtube videos) (about|of|on|by|from|with) (.+)$/.exec(q))) return browse(`${m[1]} ${m[2]}`, true, "videos");

  // playing: "play X on youtube", "find bible reading in psalms on youtube", "play a video by oneyplays", "show me a video of a cat"
  const onYT = ON_YT.test(` ${q} `); ON_YT.lastIndex = 0;
  const verb = /^(?:play|put on|throw on|start|watch|find|look up|search for|pull up|bring up|show me|show|get me|i want to watch|let me watch|can i watch|youtube|open)(?: me)?\s+/;
  if (verb.test(q) && (onYT || explicit)) {
    let body = q.replace(verb, "");
    if (/^(?:the |my )?(?:queue|up next|playlist)$/.test(body)) return null;
    let count = null;
    if ((m = new RegExp(`^${NUM_RE} (?:youtube )?(?:videos?|clips?|episodes?)\\b(.*)$`).exec(body)) && countOf(m[1]) > 1) { count = countOf(m[1]); body = m[2].trim(); }
    // a live stream
    const live = /\b(?:live ?streams?|livestreams?|streaming live|live now|live right now|currently live|is live|live)\b/.test(body) && !/\blive (?:worship|music|performance|concert|version|recording|album)\b/.test(body) ? true : false;
    const { filters, rest } = filtersFrom(body);
    let r = subject(live ? rest.replace(/\b(?:the |a |an )?(?:live ?streams?|livestreams?|streaming live|live now|live right now|currently live|live)\b/g, " ").replace(/\s+/g, " ").trim() : rest);
    if (live) r = { ...r, kind: r.creator ? "creator" : "live", live: true };
    if (!r.query && !r.creator) return null;
    const playlistKind = /\bplaylists?\b/.test(body) && !r.creator;
    const act = count && count > 1 ? "play" : (/^(?:pull up|bring up|show me|show) /.test(q) && /\bvideos\b/.test(body) ? "browse" : "play");
    return { act, ...r, kind: playlistKind ? "playlist" : r.kind, query: playlistKind ? r.query.replace(/\b(?:a |the )?(?:youtube )?playlists?(?: of| for| about| with)?\b/g, " ").replace(/\s+/g, " ").trim() : r.query, filters, count, explicit: true };
  }
  // "is mike winger live", "is grace to you streaming"
  if ((m = /^is (.+?) (?:live|streaming|live streaming|live right now|on live)(?: on youtube)?(?: right now| now)?$/.exec(q))) return { act: "play", kind: "creator", creator: m[1].trim(), query: "", live: true, filters: {}, explicit: true };
  return null;
}
// what's being asked for: a creator ("by X", "from X", "X's latest"), a topic ("about X") or a title
export function subject(body) {
  let b = String(body ?? "").replace(ON_YT, " ").replace(/\s+/g, " ").trim(), m;
  b = b.replace(/^(?:a|an|the|some|any|one|another)\s+/, "");
  // "X's latest video", "X's channel", "something from X's channel", "the latest X video" (X a known creator is decided later)
  if ((m = /^(?:(?:a|an|the|some) )?(?:(?:new|recent|latest|newest|popular|random|good|great|funny) )*(?:videos?|vids?|clips?|episodes?|sermons?|streams?|uploads?|something|stuff|one)(?: (?:uploaded|posted|made|done|preached|put out|published))? (?:by|from) (?:the )?(.+?)(?:(?:'s| s) channel| channel| on youtube)?(?: (?:about|on) (.+))?$/.exec(b)))
    return { kind: "creator", creator: m[1].trim(), query: (m[2] ?? "").trim() };
  if ((m = /^(?:something|stuff|anything|a video|videos?) (?:on|from) (.+?)(?:'s| s) (?:youtube )?channel$/.exec(b)) || (m = /^(.+?)(?:'s| s) (?:(?:latest|newest|new|recent|last|most recent|popular|most popular|best) )*(?:videos?|uploads?|vids?|clips?|episodes?|sermons?|stream|channel)$/.exec(b)))
    return { kind: "creator", creator: m[1].trim(), query: "" };
  if ((m = /^(?:(?:latest|newest|new|recent|most recent|popular) )(.+?) (?:videos?|uploads?|episodes?|sermons?)$/.exec(b))) return { kind: "creator", creator: m[1].trim(), query: "", maybe: true };
  if ((m = /^(?:(?:youtube )?playlists?|a playlist) (?:of|for|about|with) (.+)$/.exec(b))) return { kind: "playlist", query: tidy(m[1]) };
  if ((m = /^(?:about|on|of|showing|explaining|teaching|covering) (.+)$/.exec(b))) return { kind: "topic", query: tidy(m[1]) };
  if ((m = /^(?:videos?|vids?|clips?|youtube videos?|episodes?|documentar(?:y|ies)|sermons?|tutorials?|lessons?|how to videos?) (?:about|on|of|for|with|showing|explaining|teaching|where) (.+)$/.exec(b))) return { kind: "topic", query: tidy(m[1]) };
  if ((m = /^(?:the |a )?(?:video|clip|episode) (?:called|named|titled) (.+)$/.exec(b))) return { kind: "title", query: tidy(m[1]) };
  if ((m = /^(?:the |a )?(?:video|clip|episode) (.+)$/.exec(b))) return { kind: "title", query: tidy(m[1]) };
  const q = tidy(b);
  return { kind: /\b(?:how to|about|tutorial|reading|sermon|lesson|documentary)\b/.test(q) ? "topic" : "title", query: q };
}
function browse(body, explicit, noun) {
  const { filters, rest } = filtersFrom(body.trim());
  const b = rest.replace(/^(?:about|on|of|for|with|showing|related to|to do with|where)\s+/, (x) => x);
  let r;
  if (/^(?:by|from) /.test(b)) r = { kind: "creator", creator: b.replace(/^(?:by|from) (?:the )?/, "").replace(/(?:'s| s)? (?:youtube )?channel$/, "").trim(), query: "" };
  else r = { kind: "topic", query: tidy(b) };
  if (/^(?:youtubers|channels)$/.test(noun ?? "")) r = { kind: "channels", query: tidy(b) };
  if (/live/.test(noun ?? "")) r.live = true;
  if (!r.query && !r.creator) return null;
  return { act: "browse", ...r, filters, explicit: explicit || true };
}

// ---- answers to what's on the screen (the grid, or the top 3 it offered) --------------------------------------------------
const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5 };
const nOf = (w) => (/^\d+$/.test(w) ? Number(w) : ORD[w] ?? (/^twenty[- ](one|two|three|four)$/.test(w) ? 20 + ORD[w.split(/[- ]/)[1]] : null));
const NW = "(\\d{1,2}|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[- ](?:one|two|three|four))?|1st|2nd|3rd|4th|5th)";
export function numbersIn(s) {
  const out = [];
  for (const m of String(s).matchAll(new RegExp(`\\b${NW}\\b`, "g"))) { const n = nOf(m[1]); if (n) out.push(n); }
  return [...new Set(out)];
}
export function context(text) {
  const q = clean(text);
  if (!q) return null;
  let m;
  if (/^(?:none|none of (?:these|those|them)|neither|none of the above|not (?:those|these|any of (?:these|those|them)))$/.test(q)) return { op: "none" };
  if (/^(?:(?:no |nope |nah )?not (?:that|this)(?: one| video| channel)?|(?:thats|that is|this is|this isnt|that isnt|thats not|this is not|that is not) (?:not )?(?:the right (?:one|video|channel)|what i (?:wanted|asked for|meant))|wrong (?:one|video|channel)|(?:the )?next one|try (?:another|a different|again|the next)(?: one| video| channel)?|(?:a )?different (?:one|video|channel)|not (?:that|this) channel|wrong channel)$/.test(q))
    return { op: "notThat", channel: /channel/.test(q) };
  if ((m = new RegExp(`^(?:queue|add|put|line up)(?: up)?(?: numbers?| the)? ((?:${NW}(?:st|nd|rd|th)?(?: ones?)?(?:,? (?:and |&|plus )?)?)+)(?: ones?| videos?)?(?: (?:to|in|on) (?:the |my )?(?:queue|up next))?(?: next)?$`).exec(q))) {
    const ns = numbersIn(m[1]); if (ns.length) return { op: "queueMany", ns, next: / next$/.test(q) };
  }
  if ((m = new RegExp(`^(?:(?:play|watch|open|start|pick|choose|go with|i want|lets watch|lets do) )?(?:the )?(?:(?:number|video|option|choice) )?${NW}(?:st|nd|rd|th)?(?: one| video| please)?$`).exec(q)) || (m = new RegExp(`^(?:number|video|option) ${NW}$`).exec(q)) || (m = new RegExp(`^${NW}$`).exec(q))) {
    const n = nOf(m[1]); if (n) return { op: "pick", n };
  }
  if (/^the last one$/.test(q)) return { op: "pick", n: -1 };
  if (/^(?:show (?:me )?(?:them )?all|all of them|show everything|clear (?:the )?filters?|no filters?|reset(?: the)? filters?|remove (?:the )?filters?)$/.test(q)) return { op: "refine", filters: { reset: true } };
  if (/^(?:(?:show |load |give me |see |get )?more(?: videos| results| of (?:these|those|them)| like (?:these|those))?|next page|show me more|keep going|any more|what else)$/.test(q)) return { op: "more" };
  if (/^(?:(?:close|hide|exit|dismiss|clear|get rid of)(?: the| these| those)?(?: videos| video list| video grid| results| list| grid)?|no thanks|never ?mind)$/.test(q)) return { op: "close" };
  // refining what's shown: "newest first", "only the long ones", "no shorts", "most viewed", "shorter than 5 minutes"
  const f = filtersFrom(q.replace(/^(?:sort (?:them |it )?by|show(?: me)?(?: only)?|only(?: show)?(?: the)?|just(?: the)?|filter(?: by| to)?|make it|now)\s+/, "").replace(/\s+(?:first|only|ones|videos)$/, "")).filters;
  if (Object.keys(f).length && q.split(" ").length <= 8 && !VIDEO_WORDS.test(q.replace(/\bvideos\b/, ""))) {
    if (/\b(?:long|longer)\b/.test(q) && !f.minSecs) f.minSecs = 1200;
    if (/\b(?:short|shorter)\b/.test(q) && !f.maxSecs && !f.shorts) f.maxSecs = 600;
    return { op: "refine", filters: f };
  }
  if (/^(?:only |just )?(?:the )?(?:long|longer) ones$/.test(q)) return { op: "refine", filters: { minSecs: 1200 } };
  if (/^(?:only |just )?(?:the )?(?:short|shorter) ones$/.test(q)) return { op: "refine", filters: { maxSecs: 600 } };
  return null;
}

// ---- the queue --------------------------------------------------------------------------------------------------------
export function queueOp(text) {
  const q = clean(text);
  if (!q) return null;
  let m;
  if (/^(?:show|open|pull up|bring up|display|see|view)(?: me)? (?:the |my )?(?:video )?(?:queue|up next|watch queue|video list|playlist|current playlist)(?: on (?:the )?(?:screen|tv))?$|^(?:what(?:'s| s| is|s) in|whats in) (?:the |my |this )?(?:queue|video queue|playlist)$|^what(?:'s| s| is|s) (?:in|on) (?:the |this )?(?:queue|playlist|list)$|^what(?:'s| s| is|s) queued(?: up)?$|^(?:list|read me|read) (?:the |my )?queue$/.test(q)) return { op: "show" };
  if (/^(?:what(?:'s| s| is|s) (?:up next|next|coming up|after this|playing next)|whats next)$/.test(q)) return { op: "whatsNext" };
  if (/^(?:close|hide)(?: the| my)? (?:queue|up next|video queue|playlist panel)$/.test(q)) return { op: "hide" };
  if (/^(?:clear|empty|wipe|delete|erase)(?: out)? (?:the |my )?(?:whole )?(?:video )?queue$|^(?:remove|delete) everything (?:from|in) (?:the |my )?queue$/.test(q)) return { op: "clear" };
  if ((m = new RegExp(`^(?:remove|delete|drop|take out|take off)(?: the)?(?: number| video)? ${NW}(?:st|nd|rd|th)?(?: one| video)?(?: (?:from|out of|off) (?:the |my )?(?:queue|list|playlist))?$`).exec(q))) return { op: "remove", n: nOf(m[1]) };
  if (/^(?:remove|delete|drop) (?:this|that|the current)(?: one| video)? from (?:the |my )?queue$/.test(q)) return { op: "remove", n: 0 };
  if ((m = new RegExp(`^(?:move|put|bump)(?: the)?(?: number| video)? ${NW}(?:st|nd|rd|th)?(?: one| video)? (up|down|to the top|to the front|first|to the (?:end|bottom|back)|last|next|(?:up )?to (?:number |position |spot )?${NW}|(?:after|before) (?:number )?${NW})(?: one| spot| place)?(?: in the queue)?$`).exec(q))) {
    const n = nOf(m[1]), w = m[2];
    const to = /^up$/.test(w) ? "up" : /^down$/.test(w) ? "down" : /top|front|first/.test(w) ? "top" : /end|bottom|back|last/.test(w) ? "end" : /^next$/.test(w) ? "next" : nOf(m[3] ?? m[4] ?? "");
    return { op: "move", n, to: /^after/.test(w) ? { after: nOf(m[4]) } : /^before/.test(w) ? { before: nOf(m[4]) } : to };
  }
  if ((m = new RegExp(`^(?:play|jump to|go to|skip to|start|watch)(?: the)?(?: number| video)? ${NW}(?:st|nd|rd|th)?(?: one| video)?(?: (?:in|on|from) (?:the |my |this )?(?:queue|playlist|list))?$`).exec(q)) && (/queue|playlist|list|number|jump|skip to|go to/.test(q))) return { op: "play", n: nOf(m[1]) };
  if (/^(?:shuffle|mix up|randomi[sz]e)(?: the| my)? (?:queue|playlist|up next|list)$|^shuffle (?:it|them)$/.test(q)) return { op: "shuffle" };
  if (/^(?:unshuffle|stop shuffling|shuffle off|turn off shuffle|put (?:it|them) back in order)(?: the queue)?$/.test(q)) return { op: "unshuffle" };
  if (/^(?:repeat|loop)(?: the| my)? (?:queue|playlist|whole queue|whole playlist|list)$|^repeat all$/.test(q)) return { op: "repeat", mode: "all" };
  if (/^(?:repeat|loop) (?:this|this one|this video|the video|one|it)$|^repeat one$/.test(q)) return { op: "repeat", mode: "one" };
  if (/^(?:repeat|loop) off$|^(?:stop|turn off) (?:repeating|repeat|looping)$|^no repeat$/.test(q)) return { op: "repeat", mode: "off" };
  return null;
}
