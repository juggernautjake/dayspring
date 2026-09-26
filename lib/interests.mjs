// Interests: a short, friendly list people pick from during setup (and later in Settings). Each one quietly tunes
// Dayspring: which features are on (faith → devotion, prayer list and memory verses; study → course cards; music →
// music; news → the news), what the showcase recommends (video topics come from these), and a few optional starter
// routines they can add to their week with one tap. Nothing here is personal: it's a menu.
import * as owner from "./owner.mjs";
import * as store from "./store.mjs";

// { id, label, emoji, group, topic (for video/quote searches), features: {feature: true}, routines: [...suggestions] }
export const CATALOG = [
  { id: "faith", label: "Faith", emoji: "✝️", group: "Life", topic: "encouraging sermons and worship", features: { faith: true, memoryVerses: true },
    routines: [{ title: "Morning devotion", category: "faith", days: "daily", start: "07:30", end: "07:50", description: "Scripture and prayer to start the day." }] },
  { id: "church", label: "Church life", emoji: "⛪", group: "Life", topic: "Bible study", features: { faith: true, church: true } },
  { id: "family", label: "Family", emoji: "👨‍👩‍👧", group: "Life", topic: "family activities and parenting tips", features: {} },
  { id: "pets", label: "Pets", emoji: "🐾", group: "Life", topic: "pet care and training", features: {},
    routines: [{ title: "Walk the dog", category: "home", days: "daily", start: "18:30", end: "19:00", description: "" }] },
  { id: "home", label: "Home & garden", emoji: "🪴", group: "Life", topic: "home organizing and gardening", features: { chores: true } },
  { id: "cooking", label: "Cooking", emoji: "🍳", group: "Life", topic: "easy weeknight recipes", features: {},
    routines: [{ title: "Plan the week's meals", category: "meal", days: ["sun"], start: "16:00", end: "16:30", description: "" }] },
  { id: "fitness", label: "Fitness", emoji: "💪", group: "Health", topic: "home workouts", features: { chores: true },
    routines: [{ title: "Workout", category: "body", days: ["mon", "wed", "fri"], start: "17:30", end: "18:15", description: "" }] },
  { id: "running", label: "Running & outdoors", emoji: "🥾", group: "Health", topic: "hiking and trail running", features: { weather: true },
    routines: [{ title: "Run", category: "body", days: ["tue", "thu", "sat"], start: "06:30", end: "07:00", description: "" }] },
  { id: "wellness", label: "Health & wellness", emoji: "🧘", group: "Health", topic: "mindfulness and healthy habits", features: {},
    routines: [{ title: "Stretch & breathe", category: "rest", days: "daily", start: "21:30", end: "21:45", description: "" }] },
  { id: "sports", label: "Sports", emoji: "🏀", group: "Health", topic: "sports highlights", features: {} },
  { id: "study", label: "Studying / classes", emoji: "📚", group: "Growth", topic: "study tips", features: {},
    routines: [{ title: "Study", category: "study", days: ["mon", "tue", "wed", "thu"], start: "19:00", end: "20:00", description: "" }] },
  { id: "reading", label: "Reading", emoji: "📖", group: "Growth", topic: "book recommendations", features: {},
    routines: [{ title: "Read a chapter", category: "rest", days: "daily", start: "21:00", end: "21:30", description: "" }] },
  { id: "languages", label: "Learning a language", emoji: "🗣️", group: "Growth", topic: "language learning tips", features: { chores: true },
    routines: [{ title: "Language practice", category: "study", days: "daily", start: "12:30", end: "12:45", description: "" }] },
  { id: "career", label: "Work & career", emoji: "💼", group: "Growth", topic: "productivity and career growth", features: {} },
  { id: "productivity", label: "Productivity", emoji: "✅", group: "Growth", topic: "productivity systems", features: { chores: true } },
  { id: "finance", label: "Money & finance", emoji: "💰", group: "Growth", topic: "personal finance basics", features: {} },
  { id: "music", label: "Music", emoji: "🎵", group: "Fun", topic: "music performances", features: { music: true } },
  { id: "instrument", label: "Playing an instrument", emoji: "🎸", group: "Fun", topic: "instrument practice lessons", features: { music: true },
    routines: [{ title: "Practice", category: "flex", days: ["mon", "wed", "fri", "sat"], start: "20:00", end: "20:30", description: "" }] },
  { id: "gaming", label: "Gaming", emoji: "🎮", group: "Fun", topic: "video game news", features: {} },
  { id: "art", label: "Art & creativity", emoji: "🎨", group: "Fun", topic: "drawing and creative projects", features: { photos: true } },
  { id: "photography", label: "Photography", emoji: "📷", group: "Fun", topic: "photography tips", features: { photos: true } },
  { id: "movies", label: "Movies & TV", emoji: "🎬", group: "Fun", topic: "movie reviews", features: {} },
  { id: "travel", label: "Travel", emoji: "✈️", group: "Fun", topic: "travel guides", features: { weather: true } },
  { id: "tech", label: "Tech", emoji: "💻", group: "Fun", topic: "technology news", features: { claudeCode: true } },
  { id: "news", label: "News", emoji: "📰", group: "Fun", topic: "world news", features: { news: true } },
  { id: "science", label: "Science & nature", emoji: "🔭", group: "Fun", topic: "science explained", features: {} },
];
export const GROUPS = ["Life", "Health", "Growth", "Fun"];
const byId = new Map(CATALOG.map((c) => [c.id, c]));

// What the owner has picked now (ids), read back from owner.interests (labels, plus "other" free text)
export function picked() {
  const saved = (owner.get().interests ?? []).map(String);
  return { ids: CATALOG.filter((c) => saved.some((s) => s.toLowerCase() === c.label.toLowerCase() || s.toLowerCase() === c.topic.toLowerCase())).map((c) => c.id),
    other: saved.filter((s) => !CATALOG.some((c) => s.toLowerCase() === c.label.toLowerCase() || s.toLowerCase() === c.topic.toLowerCase())) };
}

// The starter routines these interests suggest (for the "add these to my week?" checkboxes)
export function suggestions(ids = []) {
  const out = [];
  for (const id of ids) for (const r of byId.get(id)?.routines ?? []) out.push({ key: `${id}:${r.title}`, from: byId.get(id).label, ...r });
  return out;
}

// Save: interests (their topics feed the recommended videos), the features they imply (only ever turned ON here — never
// switches off something the owner turned on), and any starter routines they ticked.
export function apply({ ids = [], other = [], addRoutines = [] } = {}) {
  const chosen = ids.map((id) => byId.get(id)).filter(Boolean);
  const extra = (Array.isArray(other) ? other : String(other).split(",")).map((s) => String(s).trim().slice(0, 80)).filter(Boolean).slice(0, MAX - chosen.length);
  const features = {};
  for (const c of chosen) Object.assign(features, c.features);
  for (const e of extra) Object.assign(features, mapFree(e)?.features ?? {});   // their own words can turn features on too
  // interests are saved as search-friendly topics ("home workouts"), so video picks match them
  const interests = [...chosen.map((c) => c.topic), ...extra];
  owner.set({ interests, features });
  const added = [];
  const wanted = new Set(addRoutines);
  const have = new Set(store.routines().map((r) => r.title.toLowerCase()));
  for (const s of suggestions(ids)) {
    if (!wanted.has(s.key) || have.has(s.title.toLowerCase())) continue;
    const repeat = s.days === "daily" ? { freq: "daily" } : { freq: "weekly", days: s.days };
    added.push(store.addRoutine({ title: s.title, category: s.category, start: s.start, end: s.end, description: s.description, repeat }));
  }
  return { interests, features: owner.get().features, added: added.map((r) => r.title) };
}

// ---- their own words ("woodworking", "marine wildlife", "pickleball") -----------------------------------------------
// Up to MAX interests in all. A free-text interest is kept as they typed it (it's also the search topic for Discover), and
// when it clearly belongs to one of the menu's interests it turns on that interest's features too.
export const MAX = 40;
const KEYWORDS = [
  ["sports", /\b(pickleball|basketball|football|soccer|baseball|softball|golf|tennis|volleyball|hockey|boxing|mma|wrestling|arm ?wrestling|bowling|nfl|nba|mlb|f1|formula 1|racing|lacrosse|rugby|cricket)\b/i],
  ["running", /\b(running|hiking|hunting|fishing|camping|trail|backpacking|climbing|kayaking|canoeing|outdoors?|archery|biking|cycling|skiing|snowboarding|surfing)\b/i],
  ["fitness", /\b(gym|workouts?|lifting|weights?|crossfit|bodybuilding|calisthenics|powerlifting|strength)\b/i],
  ["wellness", /\b(yoga|meditation|mindfulness|sleep|nutrition|mental health)\b/i],
  ["cooking", /\b(cooking|baking|bbq|barbecue|grilling|recipes|smoking meat|coffee|brewing)\b/i],
  ["home", /\b(gardening|garden|diy|home improvement|houseplants|plants|landscaping|woodworking|homestead(ing)?)\b/i],
  ["art", /\b(drawing|painting|pottery|crafts?|knitting|sewing|crochet|calligraphy|sculpting|woodworking)\b/i],
  ["instrument", /\b(guitar|piano|drums|violin|bass guitar|ukulele|banjo|cello|saxophone)\b/i],
  ["music", /\b(music|singing|choir|concerts?|hip hop|jazz|country music|worship music)\b/i],
  ["gaming", /\b(gaming|video games?|minecraft|fortnite|d ?& ?d|dnd|dungeons|board games?|chess|esports)\b/i],
  ["reading", /\b(books?|reading|novels?|sci-?fi|fantasy|poetry)\b/i],
  ["science", /\b(science|space|astronomy|ocean|marine|wildlife|nature|animals|birds?|dinosaurs?|fossils?|geology|physics|biology|chemistry)\b/i],
  ["tech", /\b(tech|technology|coding|programming|computers?|ai|3d printing|electronics|robotics|gadgets)\b/i],
  ["faith", /\b(bible|faith|prayer|church|worship|jesus|christian|scripture|theology)\b/i],
  ["travel", /\b(travel|road trips?|traveling|vacations?)\b/i],
  ["photography", /\b(photography|cameras?|film photography)\b/i],
  ["movies", /\b(movies?|films?|tv shows?|anime|netflix)\b/i],
  ["finance", /\b(investing|stocks?|budgeting|crypto|personal finance|real estate)\b/i],
  ["pets", /\b(dogs?|cats?|pets?|horses?|puppies)\b/i],
  ["languages", /\b(spanish|french|german|italian|japanese|korean|mandarin|language learning|languages?)\b/i],
];
export function mapFree(text) { const hit = KEYWORDS.find(([, re]) => re.test(String(text))); return hit ? byId.get(hit[0]) ?? null : null; }
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
export function addFree(texts) {
  const list = (Array.isArray(texts) ? texts : String(texts ?? "").split(",")).map(norm).filter(Boolean);
  const cur = (owner.get().interests ?? []).map(String), added = [], features = {}, mapped = [];
  for (const t of list) {
    if (cur.length >= MAX) break;
    const menu = CATALOG.find((c) => same(c.label, t) || same(c.id, t));
    const word = menu ? menu.topic : t;                          // "Cooking" (the menu's label) → its search topic
    if (cur.some((c) => same(c, word) || same(c, t))) continue;
    cur.push(word); added.push(t);
    const m = menu ?? mapFree(t); if (m) { Object.assign(features, m.features); mapped.push({ text: t, like: m.label }); }
  }
  if (added.length) owner.set({ interests: cur, features });
  return { added, mapped, interests: owner.get().interests ?? [] };
}
export function removeFree(texts) {
  const list = (Array.isArray(texts) ? texts : String(texts ?? "").split(",")).map(norm).filter(Boolean);
  const cur = (owner.get().interests ?? []).map(String), removed = [];
  const keep = cur.filter((c) => { const hit = list.find((t) => same(c, t) || CATALOG.some((m) => same(m.label, t) && same(m.topic, c))); if (hit) removed.push(c); return !hit; });
  if (removed.length) owner.set({ interests: keep });
  return { removed, interests: owner.get().interests ?? [] };
}
