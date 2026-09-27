// The genre and mood vocabulary: what "christian folk", "worship", "lo-fi", "90s country" or "something calm for
// studying" means, found even through typos and speech-to-text slips ("christian fold", "worhsip", "blue grass").
//   findGenre(text)  → { genre, span, dist, words } | null      findMood(text) → [{ mood, span }]
//   genreFits(artistGenres, genre) → true when an artist's Spotify genres belong to that genre
import { words, wordMatch, dl, sound, norm } from "./text.mjs";

// One line per genre: "Name|alias|alias". The name is also what Spotify is searched for (genre:"…").
const RAW = `
christian folk|christian folk music|faith folk|folk worship
christian|christian music|christian songs|faith music|jesus music
christian indie|indie christian|christian indie folk
christian rock|christian alternative rock|christian alt rock
christian alternative|christian alt
christian pop|ccm|contemporary christian|contemporary christian music|christian contemporary|christian radio
christian hip hop|christian rap|holy hip hop|chh
christian country|country christian|country worship
christian metal|christian metalcore|christian hard rock
christian punk
christian acoustic|acoustic christian|acoustic worship
christian lo fi|lo fi worship|worship lo fi|christian lofi
christian instrumental|instrumental worship|instrumental christian
piano worship|worship piano|soaking worship|soaking music
worship|praise and worship|praise worship|worship music|praise music|praise|modern worship|church music|worship songs
gospel|gospel music|black gospel|traditional gospel|urban contemporary gospel
southern gospel|quartet gospel
bluegrass gospel|gospel bluegrass|blue grass gospel
country gospel|gospel country
hymns|hymn|old hymns|traditional hymns|hymnal|church hymns|classic hymns|sacred music
acapella hymns|a cappella hymns
christian kids|kids worship|childrens worship|kids christian|sunday school songs
christmas worship|christian christmas
catholic|catholic music|catholic hymns
gregorian chant|chant|monastic chant
choral|choir|choir music|sacred choral
folk|folk music|traditional folk
indie folk|indie folk music|modern folk
folk rock
americana
bluegrass|blue grass|bluegrass music
country|country music|modern country|country hits
classic country|old country|traditional country|old school country
outlaw country
texas country|red dirt
honky tonk
western swing
cowboy|cowboy songs|western
rock|rock music|rock and roll|rock n roll
classic rock|old rock|classic rock hits
alternative rock|alt rock|alternative
indie rock
indie|indie music
hard rock
soft rock|yacht rock
punk|punk rock
pop punk
emo
grunge
metal|heavy metal
metalcore
pop|pop music|pop hits|top 40
indie pop
synthpop|synth pop
k pop|kpop|korean pop
j pop|jpop
latin pop
dance pop|dance
electronic|electronica
edm|electronic dance music
house|house music|deep house
techno
trance
dubstep
drum and bass|dnb
synthwave|retrowave|outrun
chillwave|vaporwave
ambient|ambient music
lo fi|lo fi beats|lo fi hip hop|chillhop|lo fi music
hip hop|hip hop music
rap|rap music
trap
boom bap|old school hip hop|90s hip hop
r and b|rnb|rhythm and blues
neo soul
soul|soul music|classic soul
motown
funk
disco
jazz|jazz music
smooth jazz
bebop
swing|swing music|big band
jazz piano
bossa nova
blues|blues music
delta blues
reggae
ska
reggaeton
salsa
bachata
cumbia
flamenco
tango
afrobeats|afrobeat
celtic|celtic music|irish|irish folk|irish music|scottish folk
sea shanties|shanties|sea shanty
classical|classical music|orchestral|symphony
baroque
opera
piano|piano music|solo piano|peaceful piano
instrumental|instrumental music
acoustic|acoustic music|acoustic covers
singer songwriter
new age
meditation|meditation music
soundtrack|soundtracks|film score|movie soundtrack|movie music|score
video game music|game music|video game soundtracks
musicals|broadway|show tunes
oldies|golden oldies
doo wop
surf rock|surf
new wave
shoegaze
chiptune
anime|anime music
christmas|christmas music|holiday music|christmas songs
childrens music|kids music|kids songs|nursery rhymes
lullabies|lullaby
easy listening|lounge
polka
zydeco|cajun
hawaiian
`;

export const GENRES = RAW.trim().split("\n").map((line) => {
  const [name, ...aliases] = line.split("|").map((s) => norm(s));
  return { id: name, name, aliases: [name, ...aliases].map((a) => a.split(" ")) };
});

// The words a Spotify artist genre may use for each word of a genre ("christian" is also "ccm", "worship", "gospel").
const GROUP = {
  christian: ["christian", "ccm", "worship", "gospel", "praise", "hymn", "hymns", "catholic", "sacred", "church", "christ", "jesus", "faith"],
  worship: ["worship", "ccm", "praise", "christian", "gospel"],
  gospel: ["gospel", "worship", "christian"],
  hymns: ["hymn", "hymns", "sacred", "choral", "christian", "gospel", "worship", "a cappella", "acapella"],
  folk: ["folk", "americana", "acoustic", "singer songwriter", "bluegrass", "roots", "celtic", "songwriter"],
  indie: ["indie", "alternative", "folk"],
  country: ["country", "americana", "nashville", "honky tonk", "red dirt", "texas", "bluegrass", "western"],
  bluegrass: ["bluegrass", "newgrass", "string band", "appalachian"],
  lo: ["lo fi", "lofi", "chillhop", "chill"], fi: ["lo fi", "lofi", "chillhop", "chill"],
  rap: ["rap", "hip hop", "trap"], hop: ["hip hop", "rap"], hip: ["hip hop", "rap"],
  rock: ["rock", "metal", "punk", "grunge"],
  classical: ["classical", "baroque", "orchestra", "orchestral", "symphony", "romantic era", "opera", "chamber"],
  piano: ["piano", "classical", "instrumental", "neo classical", "neoclassical"],
  instrumental: ["instrumental", "piano", "classical", "ambient", "lo fi", "post rock"],
  acoustic: ["acoustic", "folk", "singer songwriter"],
  jazz: ["jazz", "bebop", "swing", "bossa"], soul: ["soul", "r and b", "motown"], r: ["r and b", "soul"], b: ["r and b", "soul"],
  pop: ["pop"], metal: ["metal", "metalcore"], punk: ["punk"], kids: ["kids", "children", "childrens"], childrens: ["kids", "children"],
};
const GENRE_STOP = new Set(["and", "music", "songs", "the", "of", "s", "a", "n"]);
const artistGenreText = (g) => norm(g);
// Do an artist's Spotify genres belong to this genre? Every meaningful word of the genre must be covered by one of
// the artist's genres (through the synonyms above). Artists with no genres on file are "unknown" (null).
export function genreFits(artistGenres, genre) {
  const list = (artistGenres ?? []).map(artistGenreText).filter(Boolean);
  if (!list.length) return null;
  const want = genre.name.split(" ").filter((w) => !GENRE_STOP.has(w) && !/^\d0s$/.test(w));
  if (!want.length) return null;
  return want.every((w) => {
    const syn = GROUP[w] ?? [w];
    return list.some((g) => syn.some((s) => (` ${g} `).includes(` ${s} `) || g.split(" ").some((x) => x.length > 3 && wordMatch(x, s) === 0)));
  });
}

// The best genre named anywhere in the text. strict: single short words must match exactly unless the request is
// "genre-shaped" ("play some fold music"), so "Rock of Ages" or "play Cash" don't turn into a genre by accident.
export function findGenre(text, { shaped = false } = {}) {
  const T = words(text);
  let best = null;
  for (const g of GENRES) for (const alias of g.aliases) {
    const n = alias.length;
    for (let i = 0; i + n <= T.length; i++) {
      let dist = 0, ok = true;
      for (let k = 0; k < n && ok; k++) {
        const a = alias[k], t = T[i + k];
        if (a === t) continue;
        const d = dl(a, t, 2);
        const soundAlike = a.length > 3 && t.length > 3 && sound(a) === sound(t);
        const allowed = a.length <= 3 ? 0 : a.length <= 5 ? (shaped || n > 1 ? 1 : 0) : a.length <= 9 ? 1 : 2;
        if (d <= allowed) dist += d; else if (soundAlike && (shaped || n > 1 || a.length > 5)) dist += 1; else ok = false;
      }
      if (!ok) continue;
      // two separate words for one ("blue grass") are handled by the aliases; longer and closer wins
      const cand = { genre: g, span: [i, i + n], dist, words: n, alias: alias.join(" ") };
      if (!best || n > best.words || (n === best.words && dist < best.dist)) best = cand;
    }
  }
  // two words heard for one ("war ship", "hymn al"): join neighbours and try the one-word names again
  for (let i = 0; i + 1 < T.length; i++) {
    const j = T[i] + T[i + 1];
    for (const g of GENRES) for (const alias of g.aliases) {
      if (alias.length !== 1 || alias[0].length < 5) continue;
      const d = dl(alias[0], j, 1);
      if (d <= 1 && (!best || (best.words === 1 && d < best.dist))) best = { genre: g, span: [i, i + 2], dist: d, words: 1, alias: alias[0] };
    }
  }
  // a typo in a one-word match of a short word only counts in a genre-shaped request
  if (best && best.dist > 0 && best.words === 1 && best.alias.length <= 5 && !shaped) return null;
  // decades: "90s country" keeps the decade with the genre
  if (best) { const d = T.slice(0, best.span[0]).reverse().find((w) => /^(\d0s|2000s)$/.test(w)); if (d && best.span[0] > 0 && T[best.span[0] - 1] === d) best.decade = d; }
  return best;
}

// Moods and activities: what they mean for searching, and the words that show a playlist suits them.
export const MOODS = [
  { id: "calm", words: ["calm", "calming", "relaxing", "relax", "peaceful", "soothing", "chill", "chilled", "mellow", "gentle", "quiet", "soft", "unwind", "wind down", "laid back", "slow"], query: "calm", fit: ["calm", "chill", "relax", "peace", "soft", "acoustic", "mellow", "quiet", "slow", "gentle"] },
  { id: "study", words: ["study", "studying", "focus", "focused", "concentrate", "concentration", "homework", "reading", "work", "working", "deep work", "coding"], query: "study focus", fit: ["study", "focus", "concentrat", "reading", "work", "instrumental", "lo fi"] },
  { id: "sleep", words: ["sleep", "sleeping", "bedtime", "fall asleep", "nap", "night time", "lullaby"], query: "sleep", fit: ["sleep", "night", "dream", "calm", "rest"] },
  { id: "workout", words: ["workout", "work out", "gym", "exercise", "running", "run", "lifting", "cardio", "training", "pump up", "pumped", "hype"], query: "workout", fit: ["workout", "gym", "run", "power", "energy", "cardio", "beast", "hype", "motivation"] },
  { id: "upbeat", words: ["upbeat", "happy", "energetic", "energy", "feel good", "feelgood", "cheerful", "fun", "joyful", "bright", "uplifting", "positive", "good vibes", "dance", "dancing"], query: "upbeat", fit: ["upbeat", "happy", "feel good", "good vibes", "energy", "joy", "fun", "uplift", "positive", "dance"] },
  { id: "sad", words: ["sad", "melancholy", "heartbreak", "breakup", "crying", "lonely"], query: "sad", fit: ["sad", "melanchol", "heartbreak", "tears", "cry", "lonely"] },
  { id: "party", words: ["party", "parties", "get together", "celebration", "celebrate"], query: "party", fit: ["party", "hits", "dance", "celebrat"] },
  { id: "romantic", words: ["romantic", "romance", "love songs", "date night", "love"], query: "love songs", fit: ["love", "romantic", "romance", "date"] },
  { id: "dinner", words: ["dinner", "cooking", "kitchen", "brunch", "coffee shop", "coffeehouse", "cafe"], query: "dinner", fit: ["dinner", "cooking", "kitchen", "coffee", "cafe", "brunch"] },
  { id: "driving", words: ["driving", "drive", "road trip", "car", "commute"], query: "road trip", fit: ["road trip", "driv", "drive", "car", "highway"] },
  { id: "morning", words: ["morning", "wake up", "waking up", "sunrise", "start the day"], query: "morning", fit: ["morning", "wake", "sunrise", "coffee"] },
  { id: "rainy", words: ["rainy day", "rain", "rainy", "cozy", "cosy", "autumn", "fall"], query: "rainy day", fit: ["rain", "cozy", "cosy", "autumn", "fall"] },
  { id: "prayer", words: ["prayer", "praying", "devotion", "devotional", "quiet time", "bible reading", "meditate on"], query: "prayer", fit: ["prayer", "pray", "devotion", "soaking", "quiet time", "instrumental"] },
  { id: "background", words: ["background", "ambient", "ambience"], query: "background", fit: ["background", "ambient", "instrumental", "chill"] },
];
export function findMoods(text) {
  const t = ` ${norm(text)} `, out = [];
  for (const m of MOODS) {
    const w = m.words.find((x) => t.includes(` ${x} `) || words(text).some((y) => y.length > 5 && x.length > 5 && !x.includes(" ") && dl(x, y, 1) <= 1));
    if (w) out.push({ mood: m, word: w });
  }
  return out;
}
