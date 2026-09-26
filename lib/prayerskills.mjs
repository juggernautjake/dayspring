// The prayer list: read it (the morning part, the evening part, all of today, the whole list, the church list, or one
// person's requests), add to it, change or remove an entry, and mark prayers answered (kept as a praise report).
// Only when the owner has faith features on. The list lives in data/devotion.json (prayer.list); answered prayers in
// prayer.answered. Private entries are named but never read in detail unless the owner asks for that entry.
//
// Morning / evening: today's picks (prayer.perDay, rotating through the list) are split in two. Morning = the first
// prayer.split.morning of them (default: half, rounded up) plus prayer.split.morningChurch church requests (default 1);
// evening = the rest. Change the split in devotion.json: "prayer": { "split": { "morning": 3, "morningChurch": 1 } }.
import * as morning from "./morning.mjs";
import * as church from "./church.mjs";
import * as owner from "./owner.mjs";
import * as results from "./results.mjs";

const on = () => owner.feature("faith");
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
const asItem = (p) => (typeof p === "string" ? { title: p } : p);
const cap = (s) => String(s ?? "").replace(/^./, (c) => c.toUpperCase());
const say = (p, { detail = true } = {}) => `${cap(p.title)}${detail && p.detail && !p.private ? ` — ${String(p.detail).replace(/[.\s]+$/, "")}` : ""}`;
const churchItem = (c) => ({ title: c.who, detail: c.request + (c.note ? ` (${c.note})` : ""), church: true });

export function list({ part = "today", person = "" } = {}) {
  const d = morning.devotion(), t = morning.today();
  const all = (d.prayer?.list ?? []).map(asItem), ch = church.prayerList();
  const picks = t.prayerItems ?? [], chPicks = t.prayerChurch ?? [];
  const split = d.prayer?.split ?? {}, mN = Math.max(0, Math.min(picks.length, split.morning ?? Math.ceil(picks.length / 2))), mC = Math.max(0, split.morningChurch ?? 1);
  let title, items;
  switch (part) {
    case "morning": title = "Morning prayer list"; items = [...picks.slice(0, mN), ...chPicks.slice(0, mC).map(churchItem)]; break;
    case "evening": title = "Evening prayer list"; items = [...picks.slice(mN), ...chPicks.slice(mC).map(churchItem)]; break;
    case "all": title = "Your whole prayer list"; items = all; break;
    case "church": title = "Church prayer list"; items = ch.map(churchItem); break;
    case "answered": title = "Answered prayers"; items = (d.prayer?.answered ?? []).slice().reverse().map((a) => ({ ...a, detail: `${a.answeredOn ? "Answered " + a.answeredOn : ""}${a.note ? " — " + a.note : ""}` })); break;
    case "person": {
      const w = norm(person);
      title = `Praying for ${cap(person)}`;
      items = [...all.filter((p) => norm(p.title).includes(w) || (p.people ?? []).some((x) => norm(x).includes(w))), ...ch.filter((c) => norm(c.who).includes(w)).map(churchItem)];
      break;
    }
    default: title = "Today's prayer list"; items = [...picks, ...chPicks.map(churchItem)];
  }
  return { title, items, part };
}

// Show it on the screen and give a spoken version (titles; details for the few, never private details)
export function present(opts = {}) {
  const r = list(opts);
  if (!r.items.length) return { ...r, spoken: r.part === "person" ? `${r.title.replace("Praying for", "I don't have")} on your prayer list yet.` : "That list is empty right now." };
  results.show({ title: r.title, source: "your prayer list", summary: r.part === "all" ? `${r.items.length} requests.` : "",
    items: r.items.map((p) => ({ title: cap(p.title), detail: p.private ? "(private)" : p.detail ?? "", kind: p.church ? "church" : "prayer" })) });
  const few = r.items.length <= 6;
  const spoken = `${r.title}: ${r.items.map((p) => say(p, { detail: few })).join("; ")}.`;
  return { ...r, spoken };
}

function find(title) {
  const d = morning.devotion(), w = norm(title), l = d.prayer?.list ?? [];
  let i = l.findIndex((p) => norm(asItem(p).title) === w);
  if (i < 0) i = l.findIndex((p) => norm(asItem(p).title).includes(w) || w.includes(norm(asItem(p).title)));
  if (i < 0) i = l.findIndex((p) => (asItem(p).people ?? []).some((x) => w.includes(norm(x))));
  return i;
}
export function add({ title, detail = "", private: priv = false, category = "", people = [] }) {
  if (!String(title ?? "").trim()) throw new Error("What should I add to the prayer list?");
  const item = { title: String(title).trim(), ...(detail ? { detail: String(detail).trim() } : {}), ...(priv ? { private: true } : {}), ...(category ? { category } : {}), ...(people?.length ? { people } : {}) };
  const r = morning.addPrayer(item);
  return r ? { added: item.title } : { already: item.title };
}
export function update({ title, newTitle, detail, private: priv }) {
  const d = morning.devotion(), i = find(title);
  if (i < 0) throw new Error(`I couldn't find "${title}" on your prayer list.`);
  const p = asItem(d.prayer.list[i]);
  const next = { ...p, ...(newTitle ? { title: newTitle } : {}), ...(detail !== undefined ? { detail } : {}), ...(priv !== undefined ? { private: Boolean(priv) } : {}) };
  d.prayer.list[i] = next; morning.update({});
  return { updated: next.title };
}
export function remove({ title }) {
  const d = morning.devotion(), i = find(title);
  if (i < 0) throw new Error(`I couldn't find "${title}" on your prayer list.`);
  const [p] = d.prayer.list.splice(i, 1); morning.update({});
  return { removed: asItem(p).title };
}
export function answered({ title, note = "" }) {
  const d = morning.devotion(), i = find(title);
  if (i < 0) throw new Error(`I couldn't find "${title}" on your prayer list.`);
  const [p] = d.prayer.list.splice(i, 1);
  (d.prayer.answered ??= []).push({ ...asItem(p), answeredOn: new Date().toLocaleDateString("en-CA"), ...(note ? { note } : {}) });
  morning.update({});
  return { answered: asItem(p).title };
}

export const TOOLS = [
  { name: "prayer_list", description: "The owner's prayer list, shown on the screen. part: morning | evening | today | all | church | answered | person (with person). Morning = the first part of today's picks plus one church request; evening = the rest. Speak titles; never read a private entry's details unless the owner asks for that entry.",
    input_schema: { type: "object", properties: { part: { type: "string", enum: ["morning", "evening", "today", "all", "church", "answered", "person"] }, person: { type: "string" } } } },
  { name: "prayer_add", description: "Add a request to the owner's prayer list.", input_schema: { type: "object", properties: { title: { type: "string", description: "Short, e.g. 'Mike's surgery'" }, detail: { type: "string" }, private: { type: "boolean" }, people: { type: "array", items: { type: "string" } } }, required: ["title"] } },
  { name: "prayer_update", description: "Change a prayer list entry (find it by title).", input_schema: { type: "object", properties: { title: { type: "string" }, newTitle: { type: "string" }, detail: { type: "string" }, private: { type: "boolean" } }, required: ["title"] } },
  { name: "prayer_remove", description: "Remove an entry from the prayer list (not answered — just no longer needed).", input_schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } },
  { name: "prayer_answered", description: "Mark a prayer answered: it moves to the answered list (a praise report) with today's date.", input_schema: { type: "object", properties: { title: { type: "string" }, note: { type: "string" } }, required: ["title"] } },
];
export async function runTool(name, input = {}) {
  if (!TOOLS.some((t) => t.name === name)) return undefined;
  if (!on()) return { error: "Faith features are off (Settings → Features & apps)." };
  try {
    if (name === "prayer_list") { const r = present(input); return { title: r.title, shownOnScreen: r.items.length > 0, count: r.items.length, items: r.items.map((p) => ({ title: p.title, detail: p.private ? "(private — only if asked)" : p.detail ?? "" })) }; }
    if (name === "prayer_add") return add(input);
    if (name === "prayer_update") return update(input);
    if (name === "prayer_remove") return remove(input);
    if (name === "prayer_answered") return answered(input);
  } catch (e) { return { error: e.message }; }
}

// No AI needed
export function handle(text) {
  if (!on()) return null;
  const q = norm(text).replace(/^(dayspring |hey dayspring )/, "");
  let m;
  // "<something on the list> was answered" (only when it really is on the list)
  if ((m = /^(?:the )?(?:prayer (?:for|about) )?(.+?) (?:was|has been|got) answered$/.exec(q)) && find(m[1]) >= 0) {
    const r = answered({ title: m[1] }); return `Praise God! I moved ${r.answered} to your answered prayers.`;
  }
  if (!/\bpray|\bprayer/.test(q)) return null;
  // ("add <someone> to my prayer list" is answered by voiceskills, which also starts a profile for the person)
  if ((m = /^(?:the )?(?:prayer (?:for|about) )?(.+?) (?:was|has been|got) answered$|^mark (.+?) (?:as )?answered$/.exec(q))) {
    try { const r = answered({ title: m[1] ?? m[2] }); return `Praise God! I moved ${r.answered} to your answered prayers.`; } catch (e) { return e.message; }
  }
  if ((m = /^(?:take|remove) (.+?) off (?:my|the) prayer list$/.exec(q))) { try { return `Removed ${remove({ title: m[1] }).removed} from your prayer list.`; } catch (e) { return e.message; } }
  const wants = /\b(read|show|pull up|what'?s|what is|what am i|what should i|what do i|who should i|who am i|who'?s|tell me|give me|open|list)\b/.test(q) || /^(my |the )?(morning |evening |full |whole |today'?s |church )?prayer list$/.test(q);
  if (!wants) return null;
  if ((m = /\b(?:praying|pray) for (.+?)(?: on my list)?$/.exec(q)) && !/\b(today|tonight|this morning|this evening)\b/.test(m[1])) return present({ part: "person", person: m[1] }).spoken;
  // "for the full day" / "all day" = today's list; "the whole list" / "altogether" = everything on it
  const part = /\bmorning\b/.test(q) ? "morning" : /\b(evening|tonight|night)\b/.test(q) ? "evening" : /\bchurch\b/.test(q) ? "church" : /\banswered\b/.test(q) ? "answered"
    : /\b(full|whole|all|entire) day\b|\btoday\b/.test(q) ? "today" : /\b(whole|full|entire|complete|all|everything|altogether)\b/.test(q) ? "all" : "today";
  return present({ part }).spoken;
}
