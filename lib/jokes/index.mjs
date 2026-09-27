// Joke helpers for Dayspring: pick a fresh joke, list categories, map a spoken
// request to a category/type, and shape a joke for TTS.
//
//   import { pick, categories, find, speakable } from './lib/jokes/index.mjs';
//   const want = find('tell me a knock knock joke about animals'); // { category: 'animals', type: 'knock' }
//   const joke = pick(want);                                        // records it as told
//   const say  = speakable(joke);                                   // { setup, pause_ms, punchline, text }

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOKES, CATEGORY_LABELS } from './catalogue.mjs';

export { JOKES, CATEGORY_LABELS };

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RECENT_WINDOW = 50;

let toldPath = process.env.DAYSPRING_JOKES_TOLD || path.resolve(HERE, '..', '..', 'data', 'jokes-told.json');

/** Override where the "recently told" list lives (used by tests). */
export function configure({ toldPath: p } = {}) {
  if (p) toldPath = p;
  return { toldPath };
}

const BY_ID = new Map(JOKES.map((j) => [j.id, j]));
export function get(id) { return BY_ID.get(id) || null; }

// ---------- recently-told store ----------

/** Ids told most recently, oldest first. Missing or unreadable file -> []. */
export function recent() {
  try {
    const raw = JSON.parse(fs.readFileSync(toldPath, 'utf8'));
    const ids = Array.isArray(raw) ? raw : Array.isArray(raw?.ids) ? raw.ids : [];
    return ids.filter((x) => typeof x === 'string').slice(-RECENT_WINDOW);
  } catch {
    return [];
  }
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }
}

/** Record a joke id as told (keeps the last RECENT_WINDOW). */
export function markTold(id) {
  const ids = recent().filter((x) => x !== id);
  ids.push(id);
  const keep = ids.slice(-RECENT_WINDOW);
  try {
    writeAtomic(toldPath, JSON.stringify({ updated: new Date().toISOString(), ids: keep }, null, 2) + '\n');
  } catch {
    // Telling a joke should never fail because the history couldn't be saved.
  }
  return keep;
}

/** Forget the told history. */
export function resetTold() {
  try { writeAtomic(toldPath, JSON.stringify({ updated: new Date().toISOString(), ids: [] }, null, 2) + '\n'); } catch {}
}

// ---------- picking ----------

/**
 * Pick a random joke, avoiding the last RECENT_WINDOW told ids.
 * @param {{category?: string, type?: 'qa'|'oneliner'|'knock', exclude?: string[]|Set<string>, record?: boolean}} opts
 * Unknown category/type filters are ignored rather than returning nothing.
 * If every candidate was told recently, the one told longest ago is reused.
 */
export function pick({ category, type, exclude, record = true } = {}) {
  let pool = JOKES;
  if (category && CATEGORY_LABELS[category]) pool = pool.filter((j) => j.category === category);
  if (type) {
    const typed = pool.filter((j) => j.type === type);
    if (typed.length) pool = typed;
  }
  const skip = new Set(exclude ? [...exclude] : []);
  const told = recent();
  const toldSet = new Set(told);
  let fresh = pool.filter((j) => !skip.has(j.id) && !toldSet.has(j.id));
  let joke;
  if (fresh.length) {
    joke = fresh[Math.floor(Math.random() * fresh.length)];
  } else {
    const candidates = pool.filter((j) => !skip.has(j.id));
    if (!candidates.length) return null;
    const age = new Map(told.map((id, i) => [id, i]));
    candidates.sort((a, b) => (age.get(a.id) ?? -1) - (age.get(b.id) ?? -1));
    joke = candidates[0];
  }
  if (record) markTold(joke.id);
  return joke;
}

/** Categories with counts, in catalogue order. */
export function categories() {
  const out = new Map();
  for (const j of JOKES) {
    if (!out.has(j.category)) out.set(j.category, { id: j.category, label: CATEGORY_LABELS[j.category] || j.category, count: 0, types: { qa: 0, oneliner: 0, knock: 0 } });
    const c = out.get(j.category);
    c.count++;
    c.types[j.type]++;
  }
  return [...out.values()];
}

// ---------- request mapping ----------

// Order matters: more specific categories first (e.g. "christmas" before "holidays").
const KEYWORDS = [
  ['church', ['bible', 'church', 'churches', 'jesus', 'god', 'noah', 'moses', 'pastor', 'preacher', 'sermon', 'sunday school', 'choir', 'hymn', 'hymns', 'christian', 'faith', 'scripture', 'ark', 'adam and eve', 'religious']],
  ['christmas', ['christmas', 'xmas', 'santa', 'reindeer', 'elf', 'elves', 'rudolph', 'north pole', 'ornament', 'ornaments', 'snowman', 'snowmen']],
  ['thanksgiving', ['thanksgiving', 'turkey', 'turkeys', 'pilgrim', 'pilgrims', 'gravy', 'pumpkin pie', 'mayflower']],
  ['halloween', ['halloween', 'ghost', 'ghosts', 'witch', 'witches', 'vampire', 'vampires', 'skeleton', 'skeletons', 'mummy', 'mummies', 'spooky', 'scary', 'pumpkin', 'jack-o-lantern', 'costume', 'trick or treat']],
  ['valentines', ['valentine', 'valentines', "valentine's", 'sweetheart', 'romance', 'romantic']],
  ['birthdays', ['birthday', 'birthdays', 'candles']],
  ['seasons', ['holiday', 'holidays', 'season', 'seasons', 'spring', 'summer', 'autumn', 'winter', 'easter', 'new year', 'new years', 'fourth of july', 'st patrick', "st. patrick's", 'groundhog']],
  ['politics', ['politics', 'political', 'politician', 'politicians', 'government', 'election', 'elections', 'vote', 'voting', 'votes', 'congress', 'senate', 'senator', 'mayor', 'president', 'taxes', 'tax', 'city council', 'campaign', 'debate']],
  ['showbiz', ['celebrity', 'celebrities', 'famous', 'fame', 'hollywood', 'movie', 'movies', 'movie star', 'actor', 'actors', 'actress', 'show business', 'showbiz', 'oscar', 'oscars', 'awards', 'red carpet', 'film', 'films', 'television']],
  ['geography', ['geography', 'country', 'countries', 'city', 'cities', 'map', 'maps', 'international', 'landmark', 'landmarks', 'travel the world', 'capital', 'capitals', 'europe', 'asia', 'africa']],
  ['dinosaurs', ['dinosaur', 'dinosaurs', 'dino', 'dinos', 't rex', 't-rex', 'trex', 'fossil', 'fossils', 'jurassic']],
  ['bugs', ['bug', 'bugs', 'insect', 'insects', 'bee', 'bees', 'ant', 'ants', 'spider', 'spiders', 'butterfly', 'snail', 'snails', 'caterpillar']],
  ['ocean', ['ocean', 'oceans', 'sea', 'fish', 'fishes', 'whale', 'whales', 'shark', 'sharks', 'beach', 'dolphin', 'octopus', 'crab', 'underwater']],
  ['farm', ['farm', 'farms', 'farmer', 'farmers', 'cow', 'cows', 'pig', 'pigs', 'chicken', 'chickens', 'sheep', 'horse', 'horses', 'barn', 'tractor']],
  ['pirates', ['pirate', 'pirates', 'treasure', 'matey', 'buccaneer', 'arr']],
  ['monsters', ['monster', 'monsters', 'bigfoot', 'yeti', 'frankenstein', 'loch ness', 'ogre', 'zombie', 'zombies', 'cyclops']],
  ['robots', ['robot', 'robots', 'android', 'droid', 'ai', 'artificial intelligence']],
  ['space', ['space', 'astronomy', 'astronaut', 'astronauts', 'planet', 'planets', 'moon', 'sun', 'star', 'stars', 'alien', 'aliens', 'galaxy', 'rocket', 'mars', 'saturn', 'nasa', 'universe']],
  ['math', ['math', 'maths', 'number', 'numbers', 'algebra', 'geometry', 'fractions', 'calculator', 'arithmetic']],
  ['science', ['science', 'scientist', 'scientists', 'chemistry', 'physics', 'biology', 'atom', 'atoms', 'lab', 'experiment']],
  ['school', ['school', 'teacher', 'teachers', 'classroom', 'homework', 'student', 'students', 'principal', 'recess']],
  ['sports', ['sport', 'sports', 'football', 'soccer', 'baseball', 'basketball', 'golf', 'tennis', 'hockey', 'athlete', 'athletes', 'gym', 'olympics']],
  ['music', ['music', 'musical', 'song', 'songs', 'singing', 'singer', 'piano', 'guitar', 'drum', 'drums', 'musician']],
  ['weather', ['weather', 'rain', 'rainy', 'snow', 'snowy', 'storm', 'storms', 'thunder', 'lightning', 'cloud', 'clouds', 'tornado', 'hurricane', 'forecast']],
  ['tech', ['computer', 'computers', 'technology', 'tech', 'internet', 'wifi', 'wi-fi', 'phone', 'phones', 'smartphone', 'programmer', 'programming', 'coding', 'software', 'keyboard', 'website']],
  ['health', ['doctor', 'doctors', 'health', 'hospital', 'nurse', 'nurses', 'dentist', 'medicine', 'sick', 'germs']],
  ['jobs', ['job', 'jobs', 'career', 'boss', 'occupation', 'workplace']],
  ['history', ['history', 'historical', 'ancient', 'knight', 'knights', 'king', 'kings', 'queen', 'castle', 'viking', 'vikings', 'romans', 'egypt', 'pyramid', 'pyramids', 'medieval']],
  ['travel', ['car', 'cars', 'travel', 'traveling', 'trip', 'road trip', 'vacation', 'train', 'trains', 'airplane', 'airplanes', 'plane', 'bus', 'truck', 'bike', 'bicycle']],
  ['family', ['dad', 'dads', 'dad joke', 'dad jokes', 'mom', 'moms', 'mother', 'father', 'parent', 'parents', 'family', 'families', 'grandma', 'grandpa', 'brother', 'sister']],
  ['books', ['book', 'books', 'reading', 'library', 'libraries', 'librarian', 'author', 'dictionary', 'novel']],
  ['art', ['art', 'artist', 'artists', 'painting', 'painter', 'drawing', 'museum', 'crayon', 'crayons', 'sculpture']],
  ['kitchen', ['kitchen', 'chef', 'chefs', 'baking', 'bake', 'recipe', 'recipes', 'oven', 'stove']],
  ['food', ['food', 'foods', 'cooking', 'cook', 'cooks', 'snack', 'snacks', 'fruit', 'fruits', 'vegetable', 'vegetables', 'pizza', 'cheese', 'banana', 'sandwich', 'dessert', 'candy', 'restaurant']],
  ['garden', ['garden', 'gardens', 'gardening', 'gardener', 'plant', 'plants', 'flower', 'flowers', 'tree', 'trees', 'seed', 'seeds']],
  ['time', ['time joke', 'time jokes', 'about time', 'telling time', 'time travel', 'clock', 'clocks', 'watches', 'calendar', 'calendars']],
  ['money', ['money', 'cash', 'bank', 'banks', 'banker', 'dollar', 'dollars', 'penny', 'pennies', 'coin', 'coins', 'savings', 'allowance', 'budget']],
  ['animals', ['animal', 'animals', 'dog', 'dogs', 'puppy', 'cat', 'cats', 'kitten', 'bear', 'bears', 'elephant', 'elephants', 'owl', 'owls', 'zoo', 'pet', 'pets', 'frog', 'frogs', 'penguin', 'lion', 'monkey', 'kangaroo', 'bird', 'birds', 'rabbit', 'bunny', 'snake']],
];

const KNOCK_RE = /\bknock[\s,.-]*knock\b|\bknock knocks?\b|\bknock-knock\b|\bknock jokes?\b|\bknocks\b/;
const QA_RE = /\b(riddle|riddles|question and answer|q and a)\b/;
const ONELINER_RE = /\b(one[\s-]?liner|one[\s-]?liners|quick one|short one)\b/;

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const MATCHERS = KEYWORDS.map(([cat, words]) => [
  cat,
  new RegExp('(?:^|[^a-z0-9])(?:' + words.slice().sort((a, b) => b.length - a.length).map(escapeRe).join('|') + ')(?=$|[^a-z0-9])'),
]);

/**
 * Map a spoken/typed request to { category, type } (either may be null).
 * Returns null when nothing in the text points anywhere.
 *   find('a space joke')            -> { category: 'space', type: null }
 *   find('cooking joke please')     -> { category: 'kitchen', type: null }
 *   find('knock knock')             -> { category: null, type: 'knock' }
 */
export function find(text) {
  if (!text || typeof text !== 'string') return null;
  const t = ' ' + text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ') + ' ';
  let type = null;
  if (KNOCK_RE.test(t)) type = 'knock';
  else if (ONELINER_RE.test(t)) type = 'oneliner';
  else if (QA_RE.test(t)) type = 'qa';
  // Remove the knock-knock words so "knock" can't trip other matches.
  const body = t.replace(/knock[\s,.-]*knock|knock/g, ' ');
  let category = null;
  // Direct category id or label mention wins (e.g. "valentines", "the bible and church").
  for (const [cat, re] of MATCHERS) {
    if (re.test(body)) { category = cat; break; }
  }
  if (!category && !type) return null;
  return { category, type };
}

// ---------- TTS shaping ----------

/**
 * Text for TTS with a natural pause before the punchline.
 * Knock-knock jokes are told as a whole routine (the assistant voices both sides).
 * @returns {{ id: string, setup: string, pause_ms: number, punchline: string, text: string }}
 */
export function speakable(joke, { pause_ms } = {}) {
  if (!joke) return null;
  let setup, punchline, pause;
  if (joke.type === 'knock') {
    const name = String(joke.setup).replace(/[.!?]+$/, '');
    setup = `Knock knock. Who's there? ${name}. ${name} who?`;
    punchline = joke.punchline;
    pause = 900;
  } else {
    setup = joke.setup;
    punchline = joke.punchline || '';
    pause = punchline ? (joke.type === 'qa' ? 1200 : 900) : 0;
  }
  if (typeof pause_ms === 'number' && punchline) pause = pause_ms;
  const text = punchline ? `${setup} ... ${punchline}` : setup;
  return { id: joke.id, setup, pause_ms: pause, punchline, text };
}

/** Convenience: knock-knock as separate lines, for a call-and-response UI. */
export function knockLines(joke) {
  if (!joke || joke.type !== 'knock') return null;
  const name = String(joke.setup).replace(/[.!?]+$/, '');
  return ['Knock knock.', "Who's there?", `${name}.`, `${name} who?`, joke.punchline];
}

export default { JOKES, CATEGORY_LABELS, pick, categories, find, speakable, knockLines, recent, markTold, resetTold, configure, get };
