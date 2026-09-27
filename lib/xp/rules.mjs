// XP rules: what a real, confirmed task is worth, and what things cost. All the numbers live here.
//
// The owner wants people to REALLY earn it: a secret character should take at least a week's worth of real, confirmed
// effort. The daily cap is the lever that makes that true:
//   • DAILY_CAP = 80 XP. The first character costs 500 XP, so even a perfect day every day takes 500 / 80 → 7 days.
//   • A realistic good day (a workout, a study session with a real takeaway, some chores, a prayer) is ~55–70 XP,
//     so a typical first unlock takes 8–12 days. Each later character costs 50 more (550, 600, …), so it keeps
//     feeling earned as people get into the habit.
//   • Self-reported check-ins (not tied to a scheduled block or a Dayspring timer) count for 70%. Scheduling the thing
//     in Dayspring and checking in when it ends is the best-paid path: it's the behaviour Dayspring exists to build.
//   • The same category can only be claimed a couple of times a day, with a 2-hour gap, so one task can't be
//     chopped into ten claims. Duplicate "what I learned" answers earn nothing.
// Levels are only for fun (they measure lifetime XP; nothing is spent on them).

export const DAILY_CAP = 80;
export const SELF_REPORT_FACTOR = 0.7;      // a check-in the person started themselves, not tied to a block or a timer
export const MIN_GAP_HOURS = 2;             // between two check-ins of the same category
export const PARTIAL_MIN = 0.25;            // "I did a little" still counts for a quarter
export const STREAK_BONUS = 0.10;           // +10% from the 7th day of a streak (still inside the daily cap)
export const STREAK_BONUS_FROM = 7;
export const LEVEL_STEP = 300;              // lifetime XP per level
export const UNDO_MINUTES = 10;             // "undo my last check-in" works this long
export const MAX_DAYS_BACK = 1;             // today or yesterday; no backfilling a week
export const STREAK_SAVERS_PER_MONTH = 1;   // one missed day a month doesn't break a streak

// base: XP for a full session · perHour: work/focus is paid by the hour (maxHours) · max: sessions a day ·
// proof: how the check-in makes sure it happened ("learned" = say what you learned, then one follow-up)
export const CATEGORIES = {
  workout:  { label: "Workout",            base: 20, max: 2, verb: "worked out",     proof: "activity", ask: "What did you do, and for about how long?" },
  study:    { label: "Study",              base: 25, bonus: 10, max: 2, verb: "studied", proof: "learned", ask: "Nice. What's one thing you learned?" },
  reading:  { label: "Reading",            base: 15, bonus: 5, max: 2, verb: "read",    proof: "learned", ask: "What did you read, and what's one thing that stuck with you?" },
  work:     { label: "Work / focus",       perHour: 15, maxHours: 3, max: 2, verb: "worked", proof: "hours", ask: "About how long did you work?" },
  chore:    { label: "Chore",              base: 8,  max: 3, verb: "did a chore",    proof: "which", ask: "Which chore was it?" },
  prayer:   { label: "Prayer / devotional", base: 10, max: 2, verb: "prayed",        proof: "honour", ask: "Anything you'd like to add to your prayer list?" },
  call:     { label: "Called or visited someone", base: 12, max: 1, verb: "reached out", proof: "who", ask: "Who did you talk to?" },
  writing:  { label: "Writing",            base: 10, max: 2, verb: "wrote",          proof: "which", ask: "What did you write?" },
  practice: { label: "Practice",           base: 15, max: 2, verb: "practised",      proof: "which", ask: "What did you practise?" },
  outdoors: { label: "Outdoors / walk",    base: 12, max: 1, verb: "got outside",    proof: "which", ask: "What did you do outside?" },
  cooking:  { label: "Cooked a meal",      base: 10, max: 2, verb: "cooked",         proof: "which", ask: "What did you make?" },
  sleep:    { label: "Bed on time",        base: 10, max: 1, verb: "went to bed on time", proof: "honour", ask: null },
  sports:   { label: "Sports",             base: 20, max: 1, verb: "played",         proof: "activity", ask: "What did you play, and for about how long?" },
  eating:   { label: "Healthy meal",       base: 8,  max: 2, verb: "ate healthy",    proof: "which", ask: "Nice. What did you eat?" },
  worship:  { label: "Worship / church",   base: 15, max: 1, verb: "worshipped",     proof: "honour", ask: null },
  volunteer:{ label: "Service / volunteering", base: 20, max: 1, verb: "served",     proof: "which", ask: "What did you help with?" },
  art:      { label: "Art / making",       base: 12, max: 2, verb: "made something", proof: "which", ask: "What did you make?" },
  mindfulness: { label: "Mindfulness",     base: 8,  max: 2, verb: "took a mindful moment", proof: "which", ask: "What did you do? A breathing exercise, meditation, a quiet walk?" },
};
export const CATEGORY_IDS = Object.keys(CATEGORIES);

// Dayspring's schedule categories → XP categories (a block's title can say more: "Gym" is a workout, "Call Mom" a call)
export const FROM_SCHEDULE = { faith: "prayer", body: "workout", work: "work", study: "study", home: "chore", rest: "sleep", meal: "cooking" };
const TITLE_HINTS = [
  [/\b(volleyball|soccer|basketball|football|baseball|softball|tennis|pickleball|golf|hockey|practice game|league|match|scrimmage)\b/i, "sports"],
  [/\b(church|service|mass|worship service|sunday school|small group|choir practice)\b/i, "worship"],
  [/\b(volunteer|volunteering|serving|food bank|shelter|mission trip)\b/i, "volunteer"],
  [/\b(meditate|meditation|mindful|mindfulness|breathing|breathe|stretch break)\b/i, "mindfulness"],
  [/\b(paint|painting|draw|drawing|sketch|craft|crafts|art|pottery|woodworking)\b/i, "art"],
  [/\b(gym|workout|work out|run|running|jog|lift|lifting|yoga|swim|bike|cycling|exercise|training|stretch|sport)\b/i, "workout"],
  [/\b(study|studying|homework|course|class|lesson|exam|revision|learn|flashcards|course work|tutorial)\b/i, "study"],
  [/\b(read|reading|book|chapter)\b/i, "reading"],
  [/\b(pray|prayer|devotion|devotional|bible|scripture|quiet time|worship|church)\b/i, "prayer"],
  [/\b(call|phone|visit|facetime|video chat)\b/i, "call"],
  [/\b(write|writing|journal|letter|note|blog|essay)\b/i, "writing"],
  [/\b(piano|guitar|violin|drums|sing|singing|practi[sc]e|instrument)\b/i, "practice"],
  [/\b(walk|hike|outside|outdoors|garden|yard|park)\b/i, "outdoors"],
  [/\b(cook|cooking|dinner|lunch|breakfast|bake|baking|meal prep)\b/i, "cooking"],
  [/\b(chore|clean|cleaning|dishes|laundry|vacuum|trash|mow|tidy|sweep|mop)\b/i, "chore"],
  [/\b(bed|sleep|wind down|bedtime)\b/i, "sleep"],
  [/\b(work|focus|deep work|meeting|project)\b/i, "work"],
];
export function categoryFor({ title = "", category = "" } = {}) {
  for (const [re, id] of TITLE_HINTS) if (re.test(title)) return id;
  return FROM_SCHEDULE[category] ?? null;
}

// Prices. kind "character": a secret character. nth = which unlock this is (1 for the first; 0 is treated as 1).
export const CHARACTER_FIRST = 500, CHARACTER_STEP = 50;
export function priceFor(kind, id, { nth = 1 } = {}) {
  if (kind === "character") return CHARACTER_FIRST + CHARACTER_STEP * (Math.max(1, Math.floor(Number(nth) || 1)) - 1);
  throw new Error(`Nothing called "${kind}" can be bought with XP yet.`);
}

// Level titles: every LEVEL_STEP lifetime XP is a level
export const TITLES = ["Novice", "Apprentice", "Journeyman", "Adept", "Expert", "Master", "Grandmaster", "Legend", "Mythic", "Luminary"];
export function levelFor(lifetime) {
  const n = Math.floor(Math.max(0, lifetime) / LEVEL_STEP) + 1;
  const into = Math.max(0, lifetime) % LEVEL_STEP;
  return { level: n, title: TITLES[Math.min(n - 1, TITLES.length - 1)] + (n > TITLES.length ? ` ${n - TITLES.length + 1}` : ""), into, next: LEVEL_STEP, progress: into / LEVEL_STEP };
}
