// Maps by voice (no AI needed: the words are understood here, offline; the map data itself needs the internet) and
// for the AI (maps_search, maps_directions, maps_step; the same for Claude and a local Ollama model).
//   "show me a map of Springfield" · "find coffee near me" · "where's the nearest hardware store"
//   "directions to the mall" · "how long to drive to Springfield" · "walking directions to the park" · "… from the library"
//   "read the directions" · "next step" · "previous step" · "repeat that" · "start over"
//   "how far is it" · "what's my ETA" · "avoid highways" / "avoid tolls" · "switch to walking" · "show the other route"
//   "send the directions to my phone" · "show the QR code" · "demo the directions" · "stop directions" · "close the map"
// parse(text) → a command, or null (pure: scripts/qa/maps.mjs checks it). handle(text, ctx) runs it → { reply, intent }.
import { on as featureOn } from "../features.mjs";
import * as guide from "./guide.mjs";
import * as settings from "./settings.mjs";
import { spokenDistance, spokenDuration, clock, sayable } from "./words.mjs";

const MODE_OF = { driving: "driving", drive: "driving", car: "driving", walking: "walking", walk: "walking", foot: "walking", cycling: "cycling", biking: "cycling", bike: "cycling", bicycle: "cycling",
  transit: "transit", bus: "transit", train: "transit", "public transit": "transit", "public transportation": "transit" };
const MODE_RX = "(driving|drive|walking|walk|cycling|biking|bike|bicycle|transit|bus|train|public transit|public transportation)";
const norm = (t) => String(t ?? "").toLowerCase().replace(/[’']/g, "'").replace(/[“”"]/g, "").replace(/[?!.]+$/g, "").replace(/\s+/g, " ").trim()
  .replace(/^(?:(?:hey|ok|okay) )?(?:dayspring,? )?(?:can you |could you |would you |will you |please )*/, "").replace(/,? please$/, "").trim();
// "how long to cook rice", "how far is the moon": not trips
const NOT_A_PLACE = /^(?:cook|make|bake|boil|study|finish|read|go|charge|download|install|load|learn|walk a mile|run a mile)\b|\b(?:timer|alarm|reminder|lesson|class|exam|course|moon|sun|mars|venus|jupiter|saturn|pluto|stars?|galaxy|space|horizon)\b/;
const cleanPlace = (p) => String(p ?? "").replace(/^(?:the )?(?:closest|nearest) /, "").replace(/\s+(?:please|on the map|for me)$/, "").trim();

// ---- understanding ---------------------------------------------------------------------------------------------------
export function parse(text) {
  const q = norm(text);
  if (!q || q.length > 200) return null;
  let m;
  // the panel
  if (/^(?:close|hide|exit|dismiss|get rid of|put away)(?: the| my)? (?:google )?maps?(?: window| panel| app)?$|^(?:no more|done with the) maps?$/.test(q)) return { kind: "close" };
  if (/^(?:open|show|bring up|pull up|launch)(?: me)?(?: the| my)? (?:google )?maps?(?: window| panel| app)?$|^maps$/.test(q)) return { kind: "open" };
  // guidance
  if (/^(?:read|say|tell me|give me)(?: me)?(?: all)?(?: the| my)? (?:directions|steps|route|turn by turn(?: directions)?)(?: out loud| aloud| to me)?$|^(?:start|begin)(?: the)? (?:directions|navigation|guidance|guided directions|turn by turn)$|^(?:let's go|guide me)$/.test(q))
    return { kind: "guide", all: /\ball\b/.test(q) };
  if (/^(?:demo|auto ?play|auto advance|play through)(?: the)? (?:directions|steps|route)$|^(?:read|play) the (?:directions|steps) (?:automatically|on a timer|by themselves)$/.test(q)) return { kind: "auto" };
  if (/^(?:stop|end|cancel|quit)(?: the)? (?:directions|navigation|guidance|route|demo)$/.test(q)) return { kind: "stop" };
  if (/^(?:next|next step|next direction|next turn|what's next|what's the next (?:step|turn)|and then|then what|okay next|ok next|go on|continue)$/.test(q)) return { kind: "step", action: "next", weak: /^(?:next|and then|then what|go on|continue|okay next|ok next)$/.test(q) };
  if (/^(?:previous|previous step|last step|the step before|go back(?: a| one)? step|back one step|back a step|go back)$/.test(q)) return { kind: "step", action: "previous", weak: /^(?:previous|go back|last step)$/.test(q) };
  if (/^(?:repeat|repeat that|repeat the (?:step|last step|direction|turn)|say that again|what was that|what did you say|come again|one more time)$/.test(q)) return { kind: "step", action: "repeat", weak: !/step|direction|turn/.test(q) };
  if (/^(?:start over|back to the (?:first step|start|beginning)|first step)$/.test(q)) return { kind: "step", action: "first", weak: q === "start over" };
  if (/^(?:what's the current step|where am i on the route|which step (?:am i on|is it))$/.test(q)) return { kind: "step", action: "current" };
  // how far / how long / ETA of the current route
  if (/^(?:how far(?: is it| away is it| is that| do i have left| is it from here)?|how far away|how much further|how many miles(?: is it)?(?: left)?|what's the distance)$/.test(q)) return { kind: "far" };
  if (/^(?:what's my eta|what's the eta|eta|when will i get there|when would i get there|when do i get there|what time will i (?:get|arrive) there|how long will it take|how long is the (?:drive|trip|walk|ride)|how long(?: is it| will that take)?)$/.test(q)) return { kind: "eta" };
  // avoid / allow
  if ((m = /^(?:avoid|no|without|skip|stay off(?: of)?)(?: the)? (highways?|freeways?|interstates?|tolls?|toll roads?|ferr(?:y|ies))(?: please)?$/.exec(q))) return { kind: "avoid", what: /toll/.test(m[1]) ? "tolls" : /ferr/.test(m[1]) ? "ferries" : "highways", on: true };
  if ((m = /^(?:allow|use|don't avoid|it's fine to use|take)(?: the)? (highways?|freeways?|interstates?|tolls?|toll roads?|ferr(?:y|ies))$/.exec(q))) return { kind: "avoid", what: /toll/.test(m[1]) ? "tolls" : /ferr/.test(m[1]) ? "ferries" : "highways", on: false };
  // mode
  if ((m = new RegExp(`^(?:switch to|change to|make it|how about|what about|use|go by|let's go by|i'll go by|by) ${MODE_RX}(?: instead| directions| mode)?$`).exec(q))) return { kind: "mode", mode: MODE_OF[m[1]] };
  // the other routes
  if ((m = /^(?:show|use|take|pick|choose)(?: me)?(?: the)? (?:other|another|next|second|third|alternate|alternative|different) (?:route|way)$/.exec(q))) return { kind: "alt", which: /third/.test(q) ? 2 : /second/.test(q) ? 1 : "next" };
  if ((m = /^(?:use |take |show )?route (\d)$/.exec(q))) return { kind: "alt", which: Number(m[1]) - 1 };
  // his phone
  if (/^(?:send|text|push|share)(?: the| these| this| that| my)? (?:directions|route|map|trip|it|this|that|place|location)(?: over)? (?:to|on) my (?:phone|iphone|android|cell|mobile)$/.test(q)) return { kind: "phone" };
  if (/^(?:show|hide)(?: me)?(?: the)? (?:qr(?: code)?|code)(?: for (?:my )?phone)?$/.test(q)) return { kind: "qr", on: q.startsWith("show") };
  // directions
  if ((m = new RegExp(`^(?:how long|how many minutes|how much time)(?: would it take| will it take| does it take| is it)?(?: me)? to (?:${MODE_RX} )?(?:to |get to |go to |get over to )?(.+?)(?: from (.+?))?(?: (?:by|on) (car|bike|foot|bus|train|transit))?$`).exec(q)) && !NOT_A_PLACE.test(m[2]))
    return { kind: "directions", to: cleanPlace(m[2]), from: m[3] ?? null, mode: MODE_OF[m[1] ?? m[4]] ?? null, ask: "time" };
  if ((m = /^how far(?: away)? is (?:it )?(?:to )?(.+?)(?: from (.+?))?$/.exec(q)) && !/^(?:it|that|this|home from here)$/.test(m[1]) && !NOT_A_PLACE.test(m[1]))
    return { kind: "directions", to: cleanPlace(m[1]), from: m[2] ?? null, mode: null, ask: "distance" };
  if ((m = new RegExp(`^(?:get |give me |show me |find |i need |i want |what are the |what are )?(?:the )?(?:${MODE_RX} )?(?:directions|a route|the route|route|the way) (?:to|for) (.+?)(?: from (.+?))?(?: (?:by|on) (car|bike|foot|bus|train|transit))?$`).exec(q)))
    return { kind: "directions", to: cleanPlace(m[2]), from: m[3] ?? null, mode: MODE_OF[m[1] ?? m[4]] ?? null };
  if ((m = new RegExp(`^(?:navigate|how do i get|how do i ${MODE_RX}|how can i get|how would i get|what's the (?:best|fastest|quickest) way) to (.+?)(?: from (.+?))?$`).exec(q)))
    return { kind: "directions", to: cleanPlace(m[2]), from: m[3] ?? null, mode: MODE_OF[m[1]] ?? null };
  if ((m = new RegExp(`^(?:${MODE_RX}) (?:directions )?to (.+?)(?: from (.+?))?$`).exec(q)) && !/^(?:drive|walk|bike|bus|train)$/.test(m[1]) || (m && /^(?:drive|walk)$/.test(m[1]) && /^(?:directions|there)/.test(m[2])))
    return { kind: "directions", to: cleanPlace(m[2]), from: m[3] ?? null, mode: MODE_OF[m[1]] ?? null };
  // a map of somewhere
  if ((m = /^(?:show|pull up|bring up|open|get|give)(?: me)?(?: a| the)? map (?:of|for|around) (.+)$/.exec(q)) || (m = /^(?:map of|map) (.+)$/.exec(q)) || (m = /^(?:show|find|put|locate) (.+?) on (?:the|a) map$/.exec(q)) || (m = /^where (?:is|'s) (.+?) on (?:the|a) map$/.exec(q)))
    return { kind: "search", q: cleanPlace(m[1]), near: false };
  // places near home
  if ((m = /^(?:where(?:'s| is| are)|find(?: me)?|show me|what's|which is|search for|look for|locate)(?: the| a| an)? (?:nearest|closest) (.+?)(?: to (?:me|here|home|my house))?$/.exec(q)))
    return { kind: "search", q: cleanPlace(m[1]), near: true, one: true };
  if ((m = /^(?:find|search for|look for|show me|where can i (?:get|find|buy)|where's (?:a|some)|are there any|is there an?|any)(?: me)?(?: some| a| an| the)? (.+?) (?:near me|nearby|near here|close by|close to me|around here|around me|near home|near my house|in (?:my|the) area|in town)$/.exec(q)))
    return { kind: "search", q: cleanPlace(m[1]), near: true };
  if ((m = /^(?:search|look up|find) (.+?) on (?:the )?(?:google )?maps?$/.exec(q)) || (m = /^(?:search (?:the )?(?:google )?maps? for) (.+)$/.exec(q)))
    return { kind: "search", q: cleanPlace(m[1]), near: false };
  return null;
}

// ---- doing it ------------------------------------------------------------------------------------------------------------
const OFF = "Maps isn't turned on in this version of Dayspring.";
const units = () => settings.get().units;
function routeReply(r, ask) {
  const to = sayable(guide.state().to?.name ?? "there");
  if (ask === "time") return `About ${spokenDuration(r.duration)} ${r.mode === "walking" ? "walking" : r.mode === "cycling" ? "by bike" : r.mode === "transit" ? "by bus or train" : "driving"} to ${to}, ${spokenDistance(r.distance, units())}${r.traffic || r.mode !== "driving" ? "" : " without traffic"}. It's on the map.`;
  if (ask === "distance") return `${to} is ${spokenDistance(r.distance, units())} away by road, about ${spokenDuration(r.duration)} ${r.mode === "driving" ? "driving" : r.mode === "walking" ? "walking" : r.mode === "cycling" ? "by bike" : "by bus or train"}.`;
  return `${guide.summary(r)} Say “read the directions” to go step by step.`;
}
function placeLine(p, near) {
  const bits = [sayable(p.name)];
  if (p.address && near) bits.push(`on ${sayable(p.address.split(",")[0])}`);
  if (p.distance != null) bits.push(`${spokenDistance(p.distance, units())} away`);
  if (p.rating) bits.push(`rated ${p.rating}`);
  if (p.openNow === true) bits.push("open now"); else if (p.openNow === false) bits.push("closed right now");
  return bits.join(", ");
}

// handle(text, { surface, lastReply }) → { reply, intent, listen? } | null
export async function handle(text, { surface = "tv", lastReply = "" } = {}) {
  if (!featureOn("maps") || surface === "call") return null;
  const c = parse(text);
  if (!c) return null;
  const st = guide.state(), hasRoute = st.routes.length > 0;
  // words that mean something else unless the map is in use ("next", "repeat that", "how far is it")
  if (["step", "far", "eta", "avoid", "mode", "alt", "stop", "guide", "auto"].includes(c.kind) && !(hasRoute && guide.active())) return null;
  if (c.kind === "step" && c.weak && !st.guided && !(c.action === "repeat" && lastReply && lastReply === st.lastSpoken)) return null;
  // cooking mode has steps too: while a recipe is open, a plain "next step" is the recipe's unless the map is guiding
  if (c.kind === "step" && !st.guided) { const cooking = await import("../recipes.mjs").then((r) => r.cookingNow?.()).catch(() => null); if (cooking) return null; }
  if (c.kind === "phone" && !(st.open && (st.to || st.selected != null))) return null;
  if (c.kind === "qr" && !st.open) return null;
  return run(c);
}
export async function run(c) {
  const intent = `maps.${c.kind}`;
  try {
    switch (c.kind) {
      case "open": guide.open(); return { reply: guide.home() ? "Here's the map." : "Here's the map. Set your home in Settings → Where you are, so “near me” and directions know where you start.", intent };
      case "close": guide.close(); return { reply: "Map closed.", intent };
      case "search": {
        const list = await guide.search(c.q, { nearMe: c.near });
        if (!list.length) return { reply: `I couldn't find ${c.near ? `any ${c.q} near home` : `“${c.q}”`} on the map.`, intent };
        if (c.one) return { reply: `The nearest ${c.q} I found is ${placeLine(list[0], true)}. Say “directions to number 1” to go there.`, intent };
        if (!c.near) return { reply: list.length === 1 || /,|\d/.test(c.q) ? `Here's ${sayable(list[0].name)}${list[0].address ? `, ${sayable(list[0].address)}` : ""}.` : `Here's ${sayable(list[0].name)}${list[0].address ? `, ${sayable(list[0].address)}` : ""}. I found ${list.length} places; they're numbered on the map.`, intent };
        return { reply: `I found ${list.length} near home. The closest: ${list.slice(0, 3).map((p, i) => `${i + 1}, ${placeLine(p, false)}`).join(". ")}.`, intent };
      }
      case "directions": {
        const r = await guide.route({ to: c.to, from: c.from, mode: c.mode });
        return { reply: routeReply(r, c.ask), intent };
      }
      case "guide": { const x = c.all ? guide.step("all") : guide.startGuided(); return { reply: c.all ? x.text : `${x.text} Say “next” for each step.`, intent, listen: !c.all }; }
      case "auto": { const x = guide.startAuto(); return { reply: `Here's how it would sound, a step every ${settings.get().autoSeconds} seconds. ${x.text}`, intent }; }
      case "stop": guide.stopGuided(); return { reply: "Okay, I stopped the directions. The route is still on the map.", intent };
      case "step": { const x = guide.step(c.action); return { reply: x.text, intent, ...(x.done ? {} : { listen: guide.state().guided }) }; }
      case "far": { const left = guide.remaining(); const st = guide.state(); return { reply: `${st.step === 0 ? `It's ${left.text}` : `About ${left.text} left`} to ${sayable(st.to?.name ?? "there")}.`, intent }; }
      case "eta": { const e = guide.eta(); return { reply: `About ${spokenDuration(e.seconds)}. Leaving now, you'd get there around ${clock(e.at)}.`, intent }; }
      case "avoid": { const r = await guide.setAvoid({ [c.what]: c.on }); return { reply: `${c.on ? "Avoiding" : "Allowing"} ${c.what}. ${r ? guide.summary(r, { eta: false }) : ""}${r?.note ? ` ${r.note}` : ""}`.trim(), intent }; }
      case "mode": { const r = await guide.setMode(c.mode); return { reply: r ? guide.summary(r) : `Okay, ${c.mode}.`, intent }; }
      case "alt": {
        const st = guide.state();
        if (st.routes.length < 2) return { reply: "There's only one route for this trip.", intent };
        const i = c.which === "next" ? (st.alt + 1) % st.routes.length : c.which;
        const r = guide.pickAlt(i);
        return { reply: `Route ${i + 1}: ${guide.summary(r, { eta: false })}`, intent };
      }
      case "phone": {
        const r = await guide.sendToPhone();
        return { reply: r.sent ? "Sent to your phone. It opens in Google Maps." : "I can't reach your phone from here yet, so I put a code on the screen: point your phone's camera at it to open this in Google Maps.", intent };
      }
      case "qr": guide.toggleQr(c.on); return { reply: c.on ? "Point your phone's camera at the code to open this in Google Maps." : "Okay.", intent };
      default: return null;
    }
  } catch (e) { return { reply: e.message || "The map couldn't do that just now.", intent: `${intent}.error` }; }
}

// ---- for the AI ------------------------------------------------------------------------------------------------------------
export const TOOLS = [
  { name: "maps_search", description: "Find places on the map (shown in the Maps panel on the screen, numbered). Use near_me for 'near me' / 'nearest' (the owner's home from Settings; the computer has no GPS). Returns names, addresses, distance, and rating/opening hours when known.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "What to find: a place name, an address, a town, or a kind of place ('coffee')" }, near_me: { type: "boolean", description: "Only places near home, nearest first" } }, required: ["query"] } },
  { name: "maps_directions", description: "Get directions with turn-by-turn steps (shown on the Maps panel with the route drawn). Starts from home unless 'from' is given. Returns distance, time, arrival time if leaving now, the first steps, and a Google Maps link.",
    input_schema: { type: "object", properties: { to: { type: "string", description: "Where to: a place name, an address, or 'number N' from the last maps_search" }, from: { type: "string", description: "Optional start (default: home)" },
      mode: { type: "string", enum: ["driving", "walking", "cycling", "transit"] }, avoid: { type: "array", items: { type: "string", enum: ["highways", "tolls", "ferries"] } } }, required: ["to"] } },
  { name: "maps_step", description: "Control the directions on the Maps panel: say the next, previous or current step, repeat, read all steps, start or stop guided directions, send the directions to the owner's phone, or close the map. Returns the words to say.",
    input_schema: { type: "object", properties: { action: { type: "string", enum: ["next", "previous", "repeat", "current", "first", "all", "start_guided", "stop", "send_to_phone", "close"] } }, required: ["action"] } },
];
export const NAMES = new Set(TOOLS.map((t) => t.name));
export const tools = () => (featureOn("maps") ? TOOLS : []);
export async function runTool(name, input = {}) {
  if (!NAMES.has(name)) return undefined;
  if (!featureOn("maps")) return { error: OFF };
  try {
    if (name === "maps_search") {
      const list = await guide.search(String(input.query ?? ""), { nearMe: Boolean(input.near_me) });
      return { shown_on_screen: true, count: list.length, places: list.slice(0, 8).map((p, i) => ({ n: i + 1, name: p.name, address: p.address, distance: p.distance != null ? spokenDistance(p.distance, units()) : undefined, rating: p.rating ?? undefined, open_now: p.openNow ?? undefined, hours: p.hours?.length ? p.hours : undefined })) };
    }
    if (name === "maps_directions") {
      const avoid = Object.fromEntries((input.avoid ?? []).map((a) => [a, true]));
      const r = await guide.route({ to: input.to, from: input.from || null, mode: input.mode || null, avoid: Object.keys(avoid).length ? avoid : null });
      const st = guide.state();
      return { shown_on_screen: true, from: st.from?.name, to: `${st.to?.name}${st.to?.address ? `, ${st.to.address}` : ""}`, mode: r.mode, distance: spokenDistance(r.distance, units()), duration: spokenDuration(r.duration), arrive_if_leaving_now: clock(guide.eta().at),
        via: r.summary, live_traffic: r.traffic, alternatives: st.routes.length - 1, steps: r.steps.length, first_steps: r.steps.slice(0, 4).map((s) => s.text), google_maps_link: guide.googleLink(), note: r.note || undefined,
        say_hint: "Give the distance and time; offer to read the directions step by step (maps_step start_guided)." };
    }
    const a = String(input.action ?? "current");
    if (a === "close") { guide.close(); return { closed: true }; }
    if (a === "send_to_phone") { const r = await guide.sendToPhone(); return { sent_to_phone: r.sent > 0, qr_code_on_screen: true, link: r.link, reason: r.reason || undefined }; }
    if (a === "stop") { guide.stopGuided(); return { stopped: true }; }
    const x = a === "start_guided" ? guide.startGuided() : guide.step(a);
    return { say: x.text, step: x.index + 1, of: x.total, arrived: x.done || undefined };
  } catch (e) { return { error: e.message }; }
}
export function contextText() {
  if (!featureOn("maps")) return "";
  const st = guide.state();
  if (!st.open) return "";
  if (st.routes.length) { const r = st.routes[st.alt]; return `The Maps panel is open with ${r.mode} directions from ${st.from?.name} to ${st.to?.name} (${spokenDistance(r.distance, units())}, ${spokenDuration(r.duration)}), step ${st.step + 1} of ${r.steps.length}${st.guided ? ", guided" : ""}. Use maps_step for "next", "repeat", "send it to my phone".`; }
  if (st.results.length) return `The Maps panel is open showing ${st.results.length} places for "${st.q}", numbered. Use maps_directions with "number N" to route to one.`;
  return "The Maps panel is open.";
}
