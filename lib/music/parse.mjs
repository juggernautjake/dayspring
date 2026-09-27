// Understanding a music request: what kind of thing the owner asked for and the words that name it.
//   parseRequest("play christian fold music")      → { kind: "genre", genre: christian folk, query: "christian folk", … }
//   parseRequest("play Gratitude by Hollow Pines") → { kind: "track", title: "gratitude", artist: "hollow pines", … }
// kinds: track | artist | album | playlist | myplaylist | liked | genre | mood | radio | lyrics | any | url
// hint: what the AI's tool call said ({ type, query }) — a hint, not the final word: "christian folk" asked for as a
// "track" is still a genre.
import { norm, words, FILLER } from "./text.mjs";
import { findGenre, findMoods, MOODS } from "./genres.mjs";
import { sourceIn } from "./sources.mjs";

const LEAD = /^(?:(?:hey|ok|okay|hi|yo)\s+)?(?:dayspring|day spring|days bring)?[\s,]*/;
const POLITE = /\b(?:can you|could you|would you|will you|would you mind|please|pls|i want to|i wanna|i would like to|id like to|i'd like to|let me|lets|let us|go ahead and|for me|right now|real quick|thanks|thank you)\b/g;
const WHERE = /\b(?:on|from|in|using|with|through) (?:spotify|the tv|the screen|the speakers?|dayspring)\b|\bspotify\b(?= *$)/g;
const VERB = /^(?:play|put on|throw on|start|start playing|queue up|queue|shuffle|listen to|hear|blast|spin|turn on|give me|find me|find|i want|i need|i feel like|how about|try|switch to|change to|go to)\b\s*/;
const HITS = /^(?:something|anything|some songs?|a song|songs|music|stuff|the hits|hits|top songs|top hits|popular songs|the best|best songs|greatest hits|some music|a few songs|tracks|a mix|popular stuff)$/;
const LOOSE = new Set([...FILLER, "something", "anything", "good", "nice", "new", "old", "best", "some", "little", "bit", "few", "kind", "sort", "type", "style",
  "genre", "vibes", "vibe", "stuff", "that", "is", "its", "while", "i", "am", "im", "listen", "hear", "time", "when", "can", "let", "into", "like"]);

// "no Y" / "without Y" / "but not Y" at the end; "only X" / "just X" at the start
function modifiers(b) {
  const out = { exclude: [], only: [] };
  // plain "no"/"not" only with a joining word ("…, no Hillsong", "but not rap"): titles say "no" too ("Say No More")
  let m = /\s*(?:,\s*|\b(?:but|and|with)\s+)(?:no|not|nothing by|nothing from|none of|without|except|excluding|minus|avoid|skip)\s+(?!like\b|that\b|this\b|too\b)(.+)$/.exec(b)
    ?? /\s+\b(?:without|except|excluding|minus|nothing by|nothing from)\s+(.+)$/.exec(b);
  if (m && m.index > 0) { out.exclude = m[1].split(/\s*(?:,|\bor\b|\band\b|\bnor\b)\s*/).map((s) => s.replace(/^(?:any|the|some)\s+/, "").trim()).filter(Boolean); b = b.slice(0, m.index).trim(); }
  m = /^(?:only|just|nothing but|all)\s+(.+)$/.exec(b);
  if (m && !/^(?:a|one|the|this)\b/.test(m[1])) { out.only = [m[1].replace(/\s+(?:music|songs|stuff)$/, "")]; b = m[1]; }
  return { b, ...out };
}

export function parseRequest(text, hint = {}) {
  const raw = String(text ?? hint.query ?? "").trim();
  const link = /(?:open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist|artist|episode)\/([A-Za-z0-9]+))|spotify:(track|album|playlist|artist|episode):([A-Za-z0-9]+)/.exec(raw);
  if (link) return base(raw, { kind: "url", uri: `spotify:${link[1] ?? link[3]}:${link[2] ?? link[4]}` });

  let t = norm(raw.replace(/[,;]\s*(no|not|none of|nothing by|without)\b/gi, " but $1")).replace(LEAD, "").replace(POLITE, " ");
  // where from: "from my computer", "from my drive" (registered sources, lib/music/sources.mjs), "on spotify"
  const where = sourceIn(t);
  t = where.rest.replace(WHERE, " ").replace(/\s+/g, " ").trim();
  const shuffle = /\bshuffle(?:d)?\b|\bon shuffle\b|\bin (?:a )?random order\b|\bmix it up\b/.test(t);
  t = t.replace(/\b(?:on shuffle|shuffled|in (?:a )?random order)\b/g, " ").replace(/\s+/g, " ").trim();
  let b = t;
  for (let i = 0; i < 3; i++) b = b.replace(VERB, "").trim();
  b = b.replace(/^(?:me|us)\s+/, "").replace(/^(?:some|a little|a bit of|a little bit of|any|a few|a mix of|a|an)\s+/, "").trim();
  const mod = modifiers(b);
  b = mod.b;
  const common = { shuffle, exclude: mod.exclude, only: mod.only, from: where.from };
  let m;

  // the AI already said exactly which of the owner's things this is
  if (hint.type === "liked") return base(raw, { kind: "liked", ...common, shuffle: true });
  if (hint.type === "myplaylist") return base(raw, { kind: "myplaylist", query: norm(hint.query || b).replace(/\s*\bplaylist$/, ""), ...common });
  if (hint.type === "show" || hint.type === "episode") return base(raw, { kind: hint.type, query: norm(hint.query || b), ...common });

  if (/\b(?:my )?(?:liked|saved|favou?rite|loved|hearted) (?:songs|tracks|music)\b|\bmy likes\b|\bmy (?:spotify )?library\b|\bsongs i (?:liked|saved|like|love)\b/.test(b))
    return base(raw, { kind: "liked", ...common, shuffle: true });
  if ((m = /\b(discover weekly|release radar|daily mix(?: \d)?|on repeat|repeat rewind|daylist|time capsule)\b/.exec(b))) return base(raw, { kind: "myplaylist", query: m[1], special: true, ...common });

  // "more like this", "songs like Johnny Cash", "Josh Garrels radio"
  if (/^(?:more|songs|music|something|stuff|anything|others?)? ?(?:like|similar to) (?:this|that|this one|that one|this song|that song|it|what is playing|whats playing)$/.test(b) || /^(?:more of (?:this|that)|keep (?:this|that|the) (?:vibe|mood|going)|(?:a )?radio (?:station )?(?:from|for|based on) (?:this|that)(?: song)?|start (?:a )?radio)$/.test(b))
    return base(raw, { kind: "radio", seed: "current", ...common });
  if ((m = /^(?:more |songs |music |something |stuff |anything )?(?:like|similar to|in the style of) (.+)$/.exec(b)) || (m = /^(?:a )?radio (?:station )?(?:for|of|based on|from) (.+)$/.exec(b)) || (m = /^(.+?) radio$/.exec(b)))
    return base(raw, { kind: "radio", seed: m[1].replace(/^(?:the )?(?:song|artist|band) /, ""), query: m[1], ...common });

  // one of his own playlists
  if ((m = /^(?:my|our) (.+?) playlist$/.exec(b)) || (m = /^(?:my|our) playlist (?:called |named )?(.+)$/.exec(b)) || (m = /^(?:the )?playlist (?:i made|i have|of mine) (?:called |named )?(.+)$/.exec(b)))
    return base(raw, { kind: "myplaylist", query: m[1], ...common });

  if ((m = /^(?:my|our) (.+)$/.exec(b)) && !genreOf(m[1], true)) return base(raw, { kind: "myplaylist", query: m[1], ...common });

  // the song that goes …
  if ((m = /^(?:the |that )?song (?:that goes|that says|that sings|with the (?:lyrics?|words?)|where (?:they|he|she) (?:sing|says?)|with) (.+)$/.exec(b)))
    return base(raw, { kind: "lyrics", query: m[1], lyrics: m[1], ...common });

  // albums
  if ((m = /^(?:the )?album (?:called |named )?(.+?)(?: by (.+))?$/.exec(b)) || (m = /^(.+?) (?:the )?album(?: by (.+))?$/.exec(b)))
    return base(raw, { kind: "album", album: m[1].replace(/^(?:the|their|his|her) /, ""), artist: m[2] ?? null, query: m[1], ...common });

  // public playlists ("a christian folk playlist" is still a genre, played from a playlist)
  if ((m = /^(?:the )?(.+?) playlist$/.exec(b)) || (m = /^(?:the )?playlist (?:called |named )?(.+)$/.exec(b))) {
    const inner = m[1];
    const g = genreOf(inner, true);
    if (g) return base(raw, { ...g, prefer: "playlist", ...common });
    const moods = moodOf(inner);
    if (moods) return base(raw, { ...moods, prefer: "playlist", ...common });
    return base(raw, { kind: "playlist", query: inner, name: inner, ...common });
  }

  // artists: "songs by X", "something from X", "the band X", "X's music"
  if ((m = /^(?:(?:some|a few|the) )?(?:music|songs|stuff|anything|something|hits|tracks|tunes|the hits|greatest hits|top songs|best songs|popular songs) (?:by|from) (.+)$/.exec(b)) || (m = /^(?:the )?(?:artist|band|singer|group) (.+)$/.exec(b)))
    return base(raw, { kind: "artist", artist: m[1], query: m[1], ...common });
  if ((m = /^(.+?)s? (?:greatest hits|top songs|best songs|best of|hits|discography)$/.exec(b)) && !genreOf(m[1], true))
    return base(raw, { kind: "artist", artist: m[1], query: m[1], ...common });

  // songs: "the song X", "X by Y"
  if ((m = /^(?:the )?(?:song|track|tune|single) (?:called |named )?(.+?)(?: by (.+))?$/.exec(b)))
    return base(raw, { kind: "track", title: m[1], artist: m[2] ?? null, query: m[2] ? `${m[1]} ${m[2]}` : m[1], ...common });
  if ((m = /^(.+?) (?:by|from) (.+)$/.exec(b))) {
    if (HITS.test(m[1])) return base(raw, { kind: "artist", artist: m[2], query: m[2], ...common });
    return base(raw, { kind: "track", title: m[1], artist: m[2], query: `${m[1]} ${m[2]}`, ...common });
  }

  // genres and moods ("christian fold music", "worhsip", "90s country", "something calm for studying")
  const g = genreOf(b, false);
  if (g) return base(raw, { ...g, ...common });
  const moods = moodOf(b);
  if (moods) return base(raw, { ...moods, ...common });

  // nothing specific: search everything and let the best match decide (an artist, a song, an album or a playlist)
  if (!b || HITS.test(b) || /^(?:music|some music|songs|a song|something|anything|tunes)$/.test(b)) return base(raw, { kind: "vague", query: "", ...common });
  const kind = ["track", "artist", "album", "playlist"].includes(hint.type) ? hint.type : "any";
  return base(raw, { kind, query: b, title: kind === "track" ? b : null, artist: kind === "artist" ? b : null, album: kind === "album" ? b : null, name: kind === "playlist" ? b : null, hinted: kind !== "any", ...common });
}

// a genre that makes up the whole request (apart from filler, moods and a decade)
function genreOf(s, shapedAlready) {
  const shaped = shapedAlready || /\b(?:music|songs|tunes|stuff|playlist|mix|vibes|hits|genre)$/.test(s) || /^(?:some|any|a little|a bit of)\b/.test(s);
  const g = findGenre(s, { shaped: true });
  if (!g) return null;
  if (g.dist > 0 && g.words === 1 && g.alias.length <= 5 && !shaped) return null;
  const W = words(s);
  // a mood phrase over the genre's own words: "blue grass" is not sad; "road trip" is a mood, not a typo of "trap"
  const inSpan = (x) => x.word.split(" ").some((w) => W.slice(g.span[0], g.span[1]).includes(w));
  if (g.dist > 0 && findMoods(s).some(inSpan)) return null;
  const moodHits = findMoods(s).filter((x) => !inSpan(x));
  const moodWords = new Set(moodHits.flatMap((x) => x.word.split(" ")));
  const rest = W.filter((w, i) => (i < g.span[0] || i >= g.span[1]) && !LOOSE.has(w) && !moodWords.has(w) && w !== g.decade && !/^(?:christian|faith|modern|classic|old|older|new|newer|latest|popular|top|upbeat|acoustic|live|instrumental|clean|traditional|southern|chill|for|to|with|the)$/.test(w));
  if (rest.length) return null;
  const extra = W.filter((w, i) => (i < g.span[0] || i >= g.span[1]) && /^(?:modern|classic|old|new|latest|popular|acoustic|live|instrumental|traditional)$/.test(w));
  const q = [g.decade, ...extra, g.genre.name].filter(Boolean).join(" ");
  const moods = moodHits.map((x) => x.mood.id);
  return { kind: "genre", genre: { id: g.genre.id, name: g.genre.name, decade: g.decade ?? null, typo: g.dist > 0, heard: g.alias }, moods, query: [q, ...moodHits.map((x) => x.mood.query)].join(" ").trim() };
}
function moodOf(s) {
  const hits = findMoods(s);
  if (!hits.length) return null;
  const used = new Set(hits.flatMap((x) => x.word.split(" ")));
  const rest = words(s).filter((w) => !LOOSE.has(w) && !used.has(w) && !/^(?:for|to|while|when|during|during|some|kind|of|more|less|really|very|pretty|fall|asleep|get|getting|me|up|down|out|in|at|night|day)$/.test(w));
  if (rest.length) return null;
  const moods = hits.map((x) => x.mood.id);
  return { kind: "mood", moods, query: hits.map((x) => x.mood.query).join(" ") };
}

function base(raw, o) {
  const r = { raw, kind: "any", query: "", title: null, artist: null, album: null, name: null, genre: null, moods: [], shuffle: false, exclude: [], only: [], seed: null, from: null, ...o };
  for (const k of ["query", "title", "artist", "album", "name", "seed"]) if (typeof r[k] === "string") r[k] = r[k].replace(/\s+/g, " ").trim();
  r.key = requestKey(r);
  return r;
}
// The same request asked again (even with a typo) has the same key, so corrections are remembered for it.
export function requestKey(r) {
  if (r.kind === "genre") return `genre:${[r.genre.decade, r.genre.id, ...(r.moods ?? [])].filter(Boolean).join(" ")}`;
  if (r.kind === "mood") return `mood:${[...r.moods].sort().join(" ")}`;
  if (r.kind === "liked" || r.kind === "vague") return r.kind;
  const w = words([r.title, r.artist, r.album, r.name, r.seed, r.query].filter(Boolean).join(" ")).filter((x) => !FILLER.has(x));
  return `${r.kind}:${[...new Set(w)].join(" ")}`;
}
export const describeMood = (ids) => ids.map((id) => MOODS.find((m) => m.id === id)?.query ?? id).join(" ");

// Merge what the AI tool call said with the owner's own words: the more specific reading wins.
export function parseBoth(request, hint = {}) {
  const a = request ? parseRequest(request, {}) : null;
  const b = hint.query || hint.type ? parseRequest(hint.query ?? "", hint) : null;
  if (!a) return b ?? parseRequest("", hint);
  if (!b) return a;
  const rank = (r) => ({ url: 9, liked: 8, myplaylist: 8, radio: 7, genre: 6, mood: 5, track: 5, album: 5, artist: 5, lyrics: 4, playlist: 4, show: 4, episode: 4, any: 1, vague: 0 })[r.kind] ?? 0;
  // the AI's reading knows the song titles; the owner's words know typos were typos (both parse to the genre then)
  if (rank(b) > rank(a) || (rank(b) === rank(a) && b.kind !== "any")) return { ...b, raw: a.raw, shuffle: a.shuffle || b.shuffle, exclude: a.exclude.length ? a.exclude : b.exclude, only: a.only.length ? a.only : b.only };
  return { ...a, shuffle: a.shuffle || Boolean(hint.shuffle) };
}
