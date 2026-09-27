// Badges: 18 per category, earned by XP from check-ins in that category, collected over years.
// Every check-in category (rules.CATEGORIES) is exactly one badge category. Badges measure badge credit: the XP earned
// in that category, counted at most one session's worth a day (two for meals and chores) and a few sessions a week, so
// they reward steady habits rather than a single big week. Spending XP never takes a badge away.
//
// Thresholds are computed per category (see thresholds()): tier 1 comes after ~4 days of realistic effort, the gaps
// then widen geometrically, and tier 18 lands at ~4–5 years of realistic effort (and never under ~2 years even at the
// fastest possible pace the caps allow). The badge art is procedural (badge-art.mjs).
import * as R from "./rules.mjs";

// label, the realistic sessions a week (s), the badge sessions a day (dS), the XP of one realistic session (u)
export const BADGE_CATEGORIES = {
  workout:     { label: "Fitness",              u: 20, s: 4,   dS: 1, noun: "workouts" },
  sports:      { label: "Sports",               u: 20, s: 1.5, dS: 1, noun: "games" },
  worship:     { label: "Worship",              u: 15, s: 1.2, dS: 1, noun: "times of worship" },
  prayer:      { label: "Prayer",               u: 10, s: 6,   dS: 1, noun: "prayers" },
  eating:      { label: "Healthy Eating",       u: 8,  s: 7,   dS: 2, noun: "healthy meals" },
  chore:       { label: "Chores & Home",        u: 8,  s: 5,   dS: 2, noun: "chores" },
  study:       { label: "Study & Learning",     u: 25, s: 4,   dS: 1, noun: "study sessions" },
  reading:     { label: "Reading",              u: 15, s: 4,   dS: 1, noun: "reading sessions" },
  practice:    { label: "Music & Practice",     u: 15, s: 3,   dS: 1, noun: "practice sessions" },
  call:        { label: "Relationships",        u: 12, s: 2.5, dS: 1, noun: "calls and visits" },
  writing:     { label: "Writing & Journaling", u: 10, s: 3,   dS: 1, noun: "writing sessions" },
  outdoors:    { label: "Outdoors & Nature",    u: 12, s: 3,   dS: 1, noun: "times outside" },
  sleep:       { label: "Rest & Sleep",         u: 10, s: 5,   dS: 1, noun: "early nights" },
  cooking:     { label: "Cooking",              u: 10, s: 4,   dS: 1, noun: "home-cooked meals" },
  volunteer:   { label: "Service",              u: 20, s: 0.6, dS: 1, noun: "acts of service" },
  art:         { label: "Creativity & Art",     u: 12, s: 2,   dS: 1, noun: "creative sessions" },
  mindfulness: { label: "Mindfulness",          u: 8,  s: 4,   dS: 1, noun: "mindful moments" },
  work:        { label: "Business & Work",      u: 30, s: 5,   dS: 1, noun: "workdays" },
};
export const BADGE_IDS = Object.keys(BADGE_CATEGORIES);
export const TIERS = 18;

// Tier names: 18 per category, fitting the category (worship and prayer kept reverent).
export const NAMES = {
  workout: ["First Sweat", "Warmed Up", "Steady Mover", "Pace Setter", "Iron Starter", "Endurance Seeker", "Power Builder", "Relentless", "Trailblazer", "Iron Will", "Peak Performer", "Unbreakable", "Champion's Heart", "Titan", "Colossus", "Legend of Grit", "Olympian Spirit", "Immortal Athlete"],
  sports: ["Rookie", "Off the Bench", "Team Player", "Starter", "Playmaker", "Clutch", "Captain", "All-Star", "MVP", "Hall of Hustle", "Franchise Player", "Game Changer", "Dynasty Builder", "Champion", "Grand Slam", "Hall of Famer", "Living Legend", "Greatest of All Time"],
  worship: ["First Pew", "Faithful Attender", "Joyful Noise", "Steady Worshipper", "Glad Heart", "Psalm Singer", "Lamp Bearer", "Pillar of the Congregation", "Faithful Servant", "Living Stone", "Chorus of Praise", "Temple Keeper", "Sanctuary Steward", "Crown of Praise", "Hallowed Voice", "Pillar of Faith", "Everlasting Hymn", "Heavenly Chorus"],
  prayer: ["Mustard Seed", "First Knock", "Quiet Heart", "Seeker", "Daily Bread", "Watchful", "Intercessor", "Steadfast", "Prayer Warrior", "Mountain Mover", "Upper Room", "Burning Bush", "Faithful Watchman", "Pillar of Prayer", "Refiner's Fire", "Holy Vigil", "Throne of Grace", "Unceasing Prayer"],
  eating: ["First Bite", "Green Plate", "Fresh Start", "Veggie Friend", "Balanced Plate", "Fruit Fancier", "Garden Gourmet", "Nutrition Knight", "Whole Food Hero", "Rainbow Eater", "Vitality Keeper", "Harvest Champion", "Wellness Warden", "Farm-to-Table Master", "Vital Sage", "Evergreen", "Temple of Health", "Golden Harvest"],
  chore: ["First Sweep", "Dish Duty", "Tidy Up", "Home Helper", "Spotless", "Laundry Legend", "Order Keeper", "Clean Machine", "Household Hero", "Home Guardian", "Master of Order", "Sparkle Sovereign", "Keeper of the Hearth", "Grand Steward", "Castle Keeper", "Home Champion", "Hearth Master", "Legend of the Hearth"],
  study: ["First Lesson", "Curious Mind", "Note Taker", "Quick Learner", "Scholar in Training", "Diligent Student", "Deep Thinker", "Honor Roll", "Scholar", "Graduate", "Researcher", "Master's Mind", "Professor", "Polymath", "Sage", "Luminary", "Keeper of Knowledge", "Grand Scholar"],
  reading: ["First Page", "Chapter One", "Page Turner", "Story Seeker", "Avid Reader", "Shelf Explorer", "Bookworm", "Literary Traveler", "Library Regular", "Well-Read", "Novel Navigator", "Bibliophile", "Tome Keeper", "Master Reader", "Archivist", "Lore Master", "Great Reader", "Grand Librarian"],
  practice: ["First Note", "Scale Climber", "Steady Rhythm", "Melody Maker", "Practice Pal", "Harmony Seeker", "Encore", "Rising Soloist", "Soloist", "Maestro Apprentice", "Crescendo", "Concert Ready", "Virtuoso", "Composer's Muse", "Maestro", "Symphony", "Grand Maestro", "Living Opus"],
  call: ["First Hello", "Friendly Call", "Good Listener", "Kind Heart", "Connector", "Faithful Friend", "Family Anchor", "Bridge Builder", "Heart Keeper", "Circle of Trust", "Beloved Friend", "Community Pillar", "Gatherer", "Kindred Spirit", "Heart of the Family", "Friend to All", "Loyal Legend", "Bonds Everlasting"],
  writing: ["First Word", "Scribbler", "Journal Keeper", "Wordsmith Apprentice", "Storyteller", "Pen Pal", "Essayist", "Poet", "Chronicler", "Wordsmith", "Author", "Master Scribe", "Laureate", "Keeper of Tales", "Scribe of Ages", "Grand Chronicler", "Legend of Letters", "Immortal Quill"],
  outdoors: ["First Steps Outside", "Fresh Air", "Trail Walker", "Park Explorer", "Sunshine Seeker", "Nature Friend", "Hill Climber", "Trail Blazer", "Wanderer", "Pathfinder", "Mountaineer", "Forest Ranger", "Summit Seeker", "Wilderness Guide", "Explorer", "Nature's Guardian", "Horizon Chaser", "Legend of the Wild"],
  sleep: ["First Early Night", "Pillow Friend", "Dream Starter", "Steady Sleeper", "Night Owl Tamed", "Moonlit", "Well Rested", "Dream Keeper", "Starlit Slumber", "Restful Soul", "Sleep Scholar", "Serene Night", "Guardian of Rest", "Master of Dreams", "Moon Sage", "Deep Peace", "Celestial Slumber", "Eternal Calm"],
  cooking: ["First Dish", "Kitchen Helper", "Home Chef", "Recipe Follower", "Skillet Star", "Flavor Finder", "Sous Chef", "Baker's Pride", "Family Chef", "Kitchen Commander", "Kitchen Virtuoso", "Chef de Cuisine", "Culinary Artist", "Head Chef", "Executive Chef", "Master Chef", "Grand Chef", "Legendary Kitchen"],
  volunteer: ["First Helping Hand", "Kind Deed", "Willing Helper", "Good Neighbor", "Volunteer", "Servant Heart", "Community Helper", "Good Samaritan", "Giving Hand", "Pillar of Service", "Beacon of Kindness", "Faithful Steward", "Lighthouse", "Champion of Kindness", "Heart of Gold", "Shepherd", "Legacy of Service", "Servant of All"],
  art: ["First Sketch", "Doodler", "Color Mixer", "Crafter", "Maker", "Designer", "Studio Regular", "Artisan", "Creator", "Gallery Ready", "Visionary", "Master Artisan", "Muse", "Masterpiece Maker", "Grand Artisan", "Virtuoso Creator", "Renaissance Soul", "Living Masterpiece"],
  mindfulness: ["First Breath", "Stillness", "Calm Mind", "Present Moment", "Quiet Seeker", "Gentle Heart", "Mindful Walker", "Centered", "Tranquil", "Clear Mind", "Inner Peace", "Serene Spirit", "Zen Apprentice", "Lotus Heart", "Still Waters", "Deep Calm", "Enlightened Peace", "Boundless Calm"],
  work: ["First Shift", "Clocked In", "Task Tackler", "Go-Getter", "Steady Worker", "Project Starter", "Deal Maker", "Team Lead", "Rainmaker", "Manager", "Strategist", "Director", "Executive", "Visionary Leader", "Tycoon", "Industry Titan", "Chairman of the Board", "Legend of Industry"],
};
const BAND_LINES = ["Every journey starts somewhere, and yours has begun.", "A habit is taking root.", "Your consistency is showing.", "Steady, faithful work adds up.", "Few people keep at it this long.", "A true legend of the craft."];
export function description(cat, tier) {
  const c = BADGE_CATEGORIES[cat]; if (!c) return "";
  return `${BAND_LINES[Math.min(5, Math.floor((tier - 1) / 3))]} Earned with ${fmtXP(thresholds(cat)[tier - 1])} badge XP of ${c.noun}.`;
}
const fmtXP = (n) => n.toLocaleString("en-US");

// ---- the numbers -----------------------------------------------------------------------------------------------------
export const REALISTIC_FACTOR = 0.85;     // a mix of scheduled (100%) and self-reported (70%) check-ins
const dayCredit = (c) => Math.round(c.u * 1.1) * c.dS;                   // the most one day can add (a session, +10% streak bonus)
const weekSessions = (c) => Math.max(1, Math.min(7 * c.dS, Math.floor(c.s * 1.85)));
export function rates(cat) {
  const c = BADGE_CATEGORIES[cat];
  const realistic = c.s * c.u * REALISTIC_FACTOR;                        // badge XP in a realistic week
  const max = weekSessions(c) * Math.round(c.u * 1.1);                   // the fastest the caps allow
  return { realistic, max, dayCap: dayCredit(c), weekCap: max };
}
const friendly = (n) => { const step = n < 100 ? 5 : n < 1000 ? 10 : n < 5000 ? 50 : n < 20000 ? 100 : 500; return Math.max(step, Math.round(n / step) * step); };
const cacheT = new Map();
// 18 thresholds of badge XP for a category
export function thresholds(cat) {
  if (cacheT.has(cat)) return cacheT.get(cat);
  const { realistic, max } = rates(cat);
  const years = Math.min(5, Math.max(4, 2.05 * max / realistic));        // ~4–5 years realistic, ≥2 at the fastest
  const total = realistic * 52 * years, first = realistic * 4 / 7;       // tier 1 after ~4 days
  // gaps: first, first·r, first·r², … summing to total. Find r by bisection.
  const sum = (r) => first * (Math.pow(r, TIERS) - 1) / (r - 1);
  let lo = 1.01, hi = 2;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (sum(mid) < total) lo = mid; else hi = mid; }
  const r = (lo + hi) / 2;
  const out = []; let acc = 0, gap = first, prev = 0;
  for (let t = 0; t < TIERS; t++) { acc += gap; gap *= r; let v = friendly(acc); if (v <= prev) v = prev + (prev < 100 ? 5 : 10); out.push(v); prev = v; }
  out.ratio = r; out.years = years;
  cacheT.set(cat, out);
  return out;
}

// ---- credit and earned badges (replayed from the ledger, so undo just works) -----------------------------------------
const weekOf = (day) => { const d = new Date(day + "T12:00:00"); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return d.toLocaleDateString("en-CA"); };
// awards (in order) → per category: { credit, earned: [{tier, clincher entry, contributing entries since the previous tier}] }
export function replay(awards) {
  const st = {};
  for (const cat of BADGE_IDS) st[cat] = { credit: 0, days: {}, weeks: {}, earned: [], since: [] };
  for (const e of awards) {
    const s = st[e.category]; if (!s || !(e.amount > 0)) continue;
    const c = BADGE_CATEGORIES[e.category], rt = rates(e.category);
    const dayUsed = s.days[e.day] ?? 0, wk = weekOf(e.day), wkUsed = s.weeks[wk] ?? 0;
    const add = Math.max(0, Math.min(e.amount, rt.dayCap - dayUsed, rt.weekCap - wkUsed));
    s.since.push(e);
    if (!add) continue;
    s.days[e.day] = dayUsed + add; s.weeks[wk] = wkUsed + add; s.credit += add;
    const th = thresholds(e.category);
    while (s.earned.length < TIERS && s.credit >= th[s.earned.length]) {
      s.earned.push({ tier: s.earned.length + 1, clincher: e, contributing: s.since.slice() });
      s.since = [];
    }
    void c;
  }
  return st;
}

// ---- human summaries of the check-in that earned a badge -------------------------------------------------------------
const clip = (t, n) => { const s = String(t ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };
const partOfDay = (iso) => { const h = new Date(iso).getHours(); return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"; };
const firstSentence = (t) => clip(String(t ?? "").split(/(?<=[.!?])\s/)[0], 90);
export function summary(e) {
  const ev = String(e.evidence ?? "").split("\n")[0].trim(), title = e.title ? clip(e.title, 40) : "";
  if (e.source === "lantern") {                                        // verified learning in Lantern
    const course = String(e.courseTitle ?? e.course ?? "").replace(/\s*\([^)]*\)\s*/g, " ").trim();
    const what = { lesson: "Lesson", exercise: "Exercise", practice: "Practice", check: "Passed", milestone: "Milestone", unit: "Finished", course: "Finished the course" }[e.kind] ?? "Learning";
    return clip(`${what}${e.title && e.kind !== "course" ? `: ${e.title}` : ""}${course ? ` (${course})` : ""}`, 80);
  }
  switch (e.category) {
    case "prayer": return /\bmorning\b/i.test(title) || partOfDay(e.at) === "morning" ? "Morning prayer" : partOfDay(e.at) === "evening" ? "Evening prayer" : "Time in prayer";   // never the words of a prayer
    case "worship": return new Date(e.at).getDay() === 0 ? "Sunday worship" : title && !/pray/i.test(title) ? clip(title, 40) : "Worship";
    case "study": return ev ? `Studied${title ? ` ${title}` : ""}: ${firstSentence(ev).replace(/^i learned (that )?/i, "learned that ")}` : `Studied${title ? ` ${title}` : ""}`;
    case "reading": return ev ? `Read: ${firstSentence(ev)}` : "Reading time";
    case "work": return e.hours ? `Worked ${e.hours >= 1 ? `${e.hours} hour${e.hours === 1 ? "" : "s"}` : `${Math.round(e.hours * 60)} minutes`}${title ? ` on ${title}` : ""}` : title ? `Work: ${title}` : "A focused work session";
    case "call": return ev ? `Talked with ${clip(ev.replace(/^(i )?(talked|called|spoke) (to|with)\s*/i, ""), 40)}` : "Reached out to someone";
    case "sleep": return "Bed on time";
    default: {
      const lead = { workout: "", sports: "Played ", eating: "Ate ", chore: "Chore: ", cooking: "Cooked ", practice: "Practised ", writing: "Wrote ", outdoors: "", volunteer: "Helped with ", art: "Made ", mindfulness: "" }[e.category] ?? "";
      return ev ? clip(lead + ev.replace(/^(i )?(did|made|cooked|played|practiced|practised|wrote|ate|had)\s+/i, ""), 70) : (title || R.CATEGORIES[e.category]?.label || "A check-in");
    }
  }
}
export const summaryWhen = (e) => `this ${partOfDay(e.at)}`;
export const privateCategory = (cat) => cat === "prayer" || cat === "worship";
