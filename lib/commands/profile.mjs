// You, by voice (Settings → You and → Where you are), no AI needed. Everything stays on this computer (data/owner.json,
// the schedule's memories, special days) and is read back when it's saved.
//   your name   "my name is Morgan", "call me Robin", "I go by R", "add a nickname Ziggy", "remove the nickname Ziggy",
//               "what's my name?", "what do you call me?"      ("your name is Nova" is the assistant's name: not here)
//   where       "I live in Springfield, Illinois", "set my location to Peoria", "my zip code is 62701", "I moved to Decatur",
//               "where do you think I am?", "use my current location"  ("I'm going to Chicago tomorrow" is a trip: not here)
//   about you   "I'm a carpenter", "I work at Acme Tools", "my birthday is July 9th", "I like kayaking and D&D",
//               "I don't like country music", "add fishing to my interests", "remove D&D from my interests",
//               "what do you know about me?", "forget that I like country music"
//   all of it   "let me tell you about myself": name, where, work, interests, birthday, one at a time ("skip", "stop")
//   parse(q) → { intent, args } | null     (the commands layer runs them: lib/commands/index.mjs)
import * as owner from "../owner.mjs";
import * as store from "../store.mjs";
import { cap, listSay } from "./words.mjs";

const NAME_W = "([a-z][a-z'. -]{0,30}?)";
const TRIP = /\b(tomorrow|tonight|today|this (week|weekend|month|morning|afternoon|evening)|next (week|weekend|month)|for (the )?(weekend|week|day|night|holidays?|vacation|work|a (few days|week|trip|visit|conference))|on (vacation|a trip|business)|visiting|trip|flight|flying|driving|going to|headed to|heading to|in a (few|couple of) (days|weeks)|on (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|at \d|until|till)\b/;
const NOT_NAME = /^(a|an|the|not|so|very|just|really|going|trying|here|back|done|good|fine|ok|okay|sure|ready|tired|home|busy|sorry|in|at|on|from|with|about|over|still|also|now|always|never|kidding|joking|glad|happy|sad|hungry|sick|bored|feeling|looking|working|using|listening|thinking|leaving|out)\b/;
const cleanName = (s) => String(s ?? "").replace(/\b(please|thanks|now|from now on|instead|by the way)\b/g, "").replace(/\s+/g, " ").trim().split(" ").slice(0, 3).map(cap).join(" ");

export function parse(q) {
  q = String(q ?? "").trim();
  if (!q) return null;
  let m;
  // ---- the whole thing, one question at a time ----
  if (/^((let me |i want to |i would like to |can i )?tell you about (myself|me)|get to know me|learn about me|ask me about myself|set up my profile|update my profile|interview me)\b/.test(q)) return { intent: "profile.tour", args: {} };
  // ---- questions ----
  if (/^(what is|whats|tell me|do you know|say) my name\b|^who am i\b|^what do you call me\b|^what are my nicknames\b|^do you know who i am\b/.test(q)) return { intent: "profile.whoami", args: {} };
  if (/^where (do you think )?(am i|i am|do i live|i live)\b|^what is my (location|town|city|zip|zip code|address)\b|^where are you (set|getting the weather)\b|^what (town|city) (am i in|do you have me in|do i live in)\b/.test(q)) return { intent: "profile.where", args: {} };
  if (/^(what do you know about me|what have i told you( about myself)?|tell me (what you know )?about (me|myself)|what do you remember about me|what are my interests|what am i interested in)\b/.test(q)) return { intent: "profile.about", args: { interestsOnly: /interest/.test(q) } };
  // ---- name ----
  if ((m = new RegExp(`^(?:my name is|my name s|my names|i am called|im called|the name is|my first name is|actually my name is|no my name is|you can call me|call me|please call me|i go by|people call me|everyone calls me|just call me)\\s+${NAME_W}$`).exec(q)) && !NOT_NAME.test(m[1]) && !/\b(later|back|tomorrow|when|if|at|in|on)\b/.test(m[1]) && !/^(call me|you can call me) (a|an|the)\b/.test(q)) {
    const how = /^(?:my (first )?name|i am called|im called|the name|actually my name|no my name)/.test(q) ? "name" : "nickname";
    return { intent: "profile.name", args: { name: cleanName(m[1]), how } };
  }
  if ((m = new RegExp(`^(?:add|save|put)(?: a| another| the)? nickname(?: of| called)?\\s+${NAME_W}$`).exec(q)) || (m = new RegExp(`^(?:add|save|put)\\s+${NAME_W}\\s+(?:as|to) (?:a |one of )?my nicknames?$`).exec(q))) return { intent: "profile.nickname", args: { add: cleanName(m[1]) } };
  if ((m = new RegExp(`^(?:remove|delete|drop|forget|stop using)(?: the| my)? nickname\\s+${NAME_W}$`).exec(q)) || (m = new RegExp(`^(?:do not|dont|stop|never) call(?:ing)? me\\s+${NAME_W}(?: anymore| again)?$`).exec(q)) || (m = new RegExp(`^(?:remove|delete|take)\\s+${NAME_W}\\s+(?:from|off) my nicknames$`).exec(q))) return { intent: "profile.nickname", args: { remove: cleanName(m[1]) } };
  // ---- where ----
  if (/^(use|find|detect|get) my (current )?location\b|^(where am i right now|find where i am)$/.test(q)) return { intent: "profile.here", args: {} };
  if ((m = /^(?:i live in|i live near|we live in|i m located in|i am located in|i moved to|we moved to|i just moved to|i ve moved to|i have moved to|i relocated to|my (?:home|hometown|home town|city|town|location) is|set my (?:location|town|city|home) (?:to|as)|change my (?:location|town|city) to|update my location to|my location should be|my zip(?: code)? is|my postal code is|set my zip(?: code)? to|home is)\s+(.+)$/.exec(q)) && !TRIP.test(m[1]) && !/^(the |a |an )?(kitchen|office|car|shower|bathroom|bedroom|living room|garage|meeting|class|hospital|store|middle|mood|trouble|love|pain|charge|line|bed|hurry)\b/.test(m[1])) {
    return { intent: "profile.location", args: { place: m[1].replace(/\b(now|please)\b/g, "").trim(), zip: /\bzip|postal\b/.test(q) || /^\d{5}(-\d{4})?$/.test(m[1].trim()) } };
  }
  // ---- about: work, birthday ----
  if ((m = /^(?:my birthday is|my birthday s|my bday is|i was born on|my birthday falls on)\s+(.+)$/.exec(q))) return { intent: "profile.birthday", args: { day: m[1] } };
  if ((m = /^(?:i work at|i work for|i m employed at|i am employed at|my job is at|i m working at|i am working at)\s+(.+)$/.exec(q))) return { intent: "profile.fact", args: { kind: "work", value: m[1], text: `I work at ${cap(m[1])}` } };
  if ((m = /^(?:i work as|i m a|i am a|i m an|i am an|my job is|my job is being|i do|my profession is|i m working as|i am working as|my occupation is)\s+(?:an? )?([a-z][a-z -]{2,40})$/.exec(q)) && JOBS.test(m[1]) && !/^(i do|my job is) (not|nt|the|my|a lot|it|that|this|what)\b/.test(q)) return { intent: "profile.fact", args: { kind: "job", text: `I'm ${/^[aeiou]/.test(m[1]) ? "an" : "a"} ${m[1].trim()}` } };
  // ---- likes, dislikes, interests ----
  if ((m = /^(?:add|put)\s+(.+?)\s+(?:to|on) my (?:interests|hobbies|likes)$/.exec(q))) return { intent: "profile.interest", args: { add: splitList(m[1]) } };
  if ((m = /^(?:remove|delete|take|drop)\s+(.+?)\s+(?:from|off) my (?:interests|hobbies|likes)$/.exec(q))) return { intent: "profile.interest", args: { remove: splitList(m[1]) } };
  if ((m = /^(?:i (?:really )?(?:like|love|enjoy)|i m (?:really )?into|i am (?:really )?into|my hobbies are|my hobby is|my interests are|i m interested in|i am interested in|i m a fan of|i am a fan of|in my free time i like)\s+(.+)$/.exec(q)) && !/\b(you|it|that|this|them|when you|how you|the way)\b/.test(m[1]) && m[1].split(" ").length <= 10) return { intent: "profile.interest", args: { add: splitList(m[1].replace(/^(to |doing |playing |watching )/, "")) } };
  if ((m = /^(?:i (?:do not|dont|really do not|really dont) (?:like|enjoy|care for)|i hate|i can t stand|i cannot stand|i m not a fan of|i am not a fan of|i m not into|i am not into)\s+(.+)$/.exec(q)) && !/\b(you|it|that|this|when you|how you|the way)\b/.test(m[1]) && m[1].split(" ").length <= 8) return { intent: "profile.dislike", args: { text: m[1] } };
  // ---- forgetting ----
  if ((m = /^(?:forget (?:that )?(?:i|my)|you can forget (?:that )?i|i no longer|i don t|i do not)\b\s*(.*)$/.exec(q)) && /^forget|you can forget|^i no longer\b/.test(q)) return { intent: "profile.forget", args: { text: q.replace(/^(forget (that )?|you can forget (that )?)/, "").trim() } };
  return null;
}
const JOBS = /\b(carpenter|teacher|nurse|doctor|engineer|developer|programmer|pastor|student|farmer|mechanic|electrician|plumber|carpenter|contractor|accountant|lawyer|attorney|manager|driver|trucker|chef|cook|writer|designer|artist|musician|photographer|scientist|researcher|analyst|consultant|salesman|sales rep|realtor|real estate agent|firefighter|police officer|officer|soldier|veteran|pilot|welder|technician|therapist|counselor|dentist|pharmacist|vet|veterinarian|mom|dad|homemaker|stay at home \w+|retiree|retired|freelancer|business owner|small business owner|entrepreneur|cashier|barista|server|waiter|waitress|clerk|librarian|professor|coach|trainer|paramedic|emt|architect|carpenter|machinist|landscaper|rancher|missionary|minister|youth pastor|worship leader|secretary|assistant|receptionist|banker|editor|journalist|reporter|translator|interpreter|builder|roofer|painter|inspector|dispatcher|operator|\w+er|\w+ist|\w+or)\b/;
const splitList = (s) => String(s).split(/\s*(?:,|\band\b|&|\bplus\b)\s*/).map((x) => x.replace(/^(and |also |to )/, "").trim()).filter((x) => x && x.length <= 40).slice(0, 8);
const nameOfInterest = (x) => x.replace(/^./, (c) => c.toLowerCase()).replace(/\bd and d\b|\bd n d\b|\bdnd\b|\bd d\b/gi, "D&D");

// ---- doing it ---------------------------------------------------------------------------------------------------------
// ctx: { geocode(place), ask(pending, question), undo(what, fn) }
export async function run(p, ctx) {
  const o = owner.get(), a = p.args ?? {};
  switch (p.intent) {
    case "profile.whoami": {
      const nick = (o.nicknames ?? []).filter((n) => n.toLowerCase() !== String(o.name).toLowerCase());
      if (!o.name && !nick.length) return { reply: "I don't know your name yet. Tell me: say “my name is” and your name." };
      return { reply: `${o.name ? `Your name is ${o.name}` : "I don't have your full name yet"}${nick.length ? `, and I call you ${listSay(nick.slice(0, 4))}${nick.length > 4 ? " and a few more" : ""} now and then` : ""}.` };
    }
    case "profile.name": {
      if (a.how === "name") {
        const before = o.name;
        owner.set({ name: a.name, ...(before && (o.nicknames ?? []).includes(before) ? {} : {}) });
        ctx.undo(`your name (it was ${before || "not set"})`, () => owner.set({ name: before }));
        return { reply: `Nice to meet you, ${a.name}. ${before && before !== a.name ? `I changed your name from ${before}. ` : ""}That's saved, only on this computer.` };
      }
      const before = o.nicknames ?? [], beforeName = o.name;
      const nick = [a.name, ...before.filter((n) => n.toLowerCase() !== a.name.toLowerCase())];
      owner.set({ nicknames: nick, ...(!o.name ? { name: a.name } : {}) });
      ctx.undo(`calling you ${a.name}`, () => owner.set({ nicknames: before, name: beforeName }));
      return { reply: `Okay, I'll call you ${a.name}.${o.name && o.name !== a.name ? ` (Your name stays ${o.name}.)` : ""}` };
    }
    case "profile.nickname": {
      const before = o.nicknames ?? [];
      if (a.add) {
        if (before.some((n) => n.toLowerCase() === a.add.toLowerCase())) return { reply: `${a.add} is already one of your nicknames.` };
        owner.set({ nicknames: [...before, a.add] });
        ctx.undo(`the nickname ${a.add}`, () => owner.set({ nicknames: before }));
        return { reply: `Added ${a.add} to your nicknames. I have ${before.length + 1} now.` };
      }
      const left = before.filter((n) => n.toLowerCase() !== a.remove.toLowerCase());
      if (left.length === before.length) return { reply: `${a.remove} isn't one of your nicknames. You have ${before.length ? listSay(before) : "none yet"}.` };
      owner.set({ nicknames: left });
      ctx.undo(`removing the nickname ${a.remove}`, () => owner.set({ nicknames: before }));
      return { reply: `Okay, I won't call you ${a.remove} anymore.` };
    }
    case "profile.where": {
      const l = o.location ?? {};
      return { reply: l.place ? `You're set to ${l.place}${l.timezone ? `, in the ${tzName(l.timezone)} time zone` : ""}. Weather and sunrise use that. Say “I live in” and a town to change it.` : "I don't know where you are yet. Say “I live in” and your town, or your zip code." };
    }
    case "profile.here": return { reply: "I can't tell where this computer is by myself. Tell me your town or zip code instead, like “I live in Springfield, Illinois” or “my zip code is 62701”." };
    case "profile.location": {
      let found;
      try { found = await ctx.geocode(a.place); } catch { return { reply: `I couldn't look up ${cap(a.place)} just now (no internet?). Try again in a bit, or set it in Settings → Where you are.` }; }
      if (!found?.length) return { reply: `I couldn't find a place called ${cap(a.place)}. Try the town and state, like “Springfield, Illinois”, or a zip code.` };
      const best = found[0], before = structuredClone(o.location ?? {});
      const tzChange = best.timezone && before.timezone && best.timezone !== before.timezone;
      owner.set({ location: { place: best.place, lat: best.lat, lon: best.lon, timezone: before.timezone || best.timezone } });
      ctx.undo(`your location (it was ${before.place || "not set"})`, () => owner.set({ location: before }));
      ctx.changed?.();
      const also = found.length > 1 && !a.zip ? ` If you meant a different ${found[0].place.split(",")[0]}, say the state too.` : "";
      if (tzChange) {
        const asked = ctx.ask({ kind: "confirm", intent: "profile.timezone", yes: () => { owner.set({ location: { ...owner.get().location, timezone: best.timezone } }); return { reply: `Done. The time zone is ${tzName(best.timezone)} now.`, changes: ["settings"] }; } },
          `${best.place}, got it. Weather and sunrise will use that.${also} It's in the ${tzName(best.timezone)} time zone, and you're set to ${tzName(before.timezone)}. Switch the time zone too? Say yes or no.`);
        if (asked) return asked;
        // (in the "tell you about myself" questions there's no room for a yes/no: the new place's time zone is used, and said)
        owner.set({ location: { ...owner.get().location, timezone: best.timezone } });
        return { reply: `${best.place}, got it, and the time zone is ${tzName(best.timezone)} now.` };
      }
      return { reply: `${best.place}, got it. Weather and sunrise will use that.${also}` };
    }
    case "profile.birthday": {
      const sp = await import("../special.mjs");
      const d = sp.parseDay(a.day);
      if (!d) return { reply: "Which day is your birthday? Say it like “July 9th”." };
      const [mm, dd] = d.md.split("-").map(Number);
      const said = new Date(2000, mm - 1, dd).toLocaleDateString("en-US", { month: "long", day: "numeric" });
      const beforeAbout = o.about ?? "";
      owner.set({ about: upsertSentence(beforeAbout, /^My birthday is\b/i, `My birthday is ${said}.`) });
      const title = `${o.name ? `${o.name}'s` : "Your"} birthday`;
      let occ = null;
      try { if (!(sp.between?.(`${new Date().getFullYear()}-01-01`, `${new Date().getFullYear()}-12-31`) ?? []).some((x) => /birthday/i.test(x.title ?? "") && (x.title ?? "").startsWith(title))) occ = sp.addOccasion({ title, date: d.md, kind: "birthday", year: d.year }); } catch { /* the About line is kept either way */ }
      ctx.undo("your birthday", () => owner.set({ about: beforeAbout }));
      return { reply: `Got it: your birthday is ${said}.${occ ? " It's on your calendar now, and I'll remember it." : ""}` };
    }
    case "profile.fact": {
      // (his own capitals: "I work at Acme Tools")
      if (a.value && ctx.keepCase) { const said = ctx.keepCase(a.value); a.text = a.kind === "work" ? `I work at ${said}` : a.text; }
      const beforeAbout = o.about ?? "";
      const re = a.kind === "work" ? /^I work (at|for)\b/i : /^I'm an? \b/i;
      owner.set({ about: upsertSentence(beforeAbout, re, `${a.text}.`) });
      ctx.undo("that", () => owner.set({ about: beforeAbout }));
      return { reply: `Got it: ${a.text.replace(/^I'm/, "you're").replace(/^I work/, "you work")}. I saved it in About you.` };
    }
    case "profile.interest": {
      const before = o.interests ?? [];
      if (a.add) {
        const add = a.add.map(nameOfInterest).filter((x) => !before.some((y) => y.toLowerCase() === x.toLowerCase()));
        if (!add.length) return { reply: `${cap(listSay(a.add.map(nameOfInterest)))} ${a.add.length > 1 ? "are" : "is"} already in your interests.` };
        owner.set({ interests: [...before, ...add].slice(-40) });
        ctx.undo(`adding ${listSay(add)}`, () => owner.set({ interests: before }));
        return { reply: `Nice! I added ${listSay(add)} to your interests.` };
      }
      const drop = a.remove.map((x) => x.toLowerCase().replace(/\bd and d\b|\bdnd\b|\bd d\b|\bd n d\b/, "d&d"));
      const left = before.filter((x) => !drop.some((d) => x.toLowerCase() === d || x.toLowerCase().includes(d)));
      if (left.length === before.length) return { reply: `${cap(listSay(a.remove))} ${a.remove.length > 1 ? "aren't" : "isn't"} in your interests.` };
      owner.set({ interests: left });
      ctx.undo("removing that interest", () => owner.set({ interests: before }));
      return { reply: `Okay, I took ${listSay(before.filter((x) => !left.includes(x)))} off your interests.` };
    }
    case "profile.dislike": {
      const text = `Doesn't like ${a.text.replace(/^(to )/, "")}`;
      if (store.memories().some((x) => x.text.toLowerCase() === text.toLowerCase())) return { reply: `I already know you don't like ${a.text}.` };
      const mem = store.remember(text);
      ctx.undo("that", () => { try { store.forget(mem.id); } catch { /* gone */ } });
      return { reply: `Noted: you don't like ${a.text}. I'll keep that in mind.` };
    }
    case "profile.forget": {
      const words = a.text.replace(/^(i |that i |my )/, "").replace(/\b(like|love|am|m|work|do|dont|do not|not|doesnt|does|am a|m a|an|a|the|at|as|into|that|i)\b/g, " ").split(/\s+/).filter((w) => w.length > 2);
      if (!words.length) return { reply: "What should I forget? Say it like “forget that I like country music”." };
      const hit = (s) => words.every((w) => String(s).toLowerCase().includes(w));
      const before = structuredClone(o), gone = [];
      const interests = (o.interests ?? []).filter((x) => { if (hit(x)) { gone.push(x); return false; } return true; });
      const about = (o.about ?? "").split(/(?<=\.)\s+/).filter((s) => { if (s && hit(s)) { gone.push(s.replace(/\.$/, "")); return false; } return true; }).join(" ");
      const mems = store.memories().filter((x) => hit(x.text));
      for (const mm of mems) { try { store.forget(mm.id); gone.push(mm.text); } catch { /* gone */ } }
      if (!gone.length) return { reply: "I don't have anything like that saved." };
      owner.set({ interests, about });
      ctx.undo("forgetting that", () => { owner.set({ interests: before.interests, about: before.about }); for (const mm of mems) store.remember(mm.text); });
      return { reply: `Okay, I forgot ${gone.length === 1 ? "that" : `${gone.length} things`}: ${listSay(gone.map((g) => `“${g}”`))}.` };
    }
    case "profile.about": {
      const bits = [];
      if (a.interestsOnly) return { reply: (o.interests ?? []).length ? `You're into ${listSay(o.interests)}.` : "You haven't told me your interests yet. Say “I like” and a few things." };
      if (o.name) bits.push(`your name is ${o.name}`);
      if (o.location?.place) bits.push(`you live in ${o.location.place}`);
      for (const s of String(o.about ?? "").split(/(?<=\.)\s+/).filter(Boolean).slice(0, 4)) bits.push(s.replace(/\.$/, "").replace(/^I'm\b/, "you're").replace(/^I\b/, "you").replace(/^My\b/, "your"));
      if ((o.interests ?? []).length) bits.push(`you're into ${listSay(o.interests.slice(0, 6))}`);
      const dislikes = store.memories().filter((x) => /^Doesn't like /.test(x.text)).slice(0, 3).map((x) => x.text.replace(/^Doesn't like/, "you don't like"));
      bits.push(...dislikes);
      if (!bits.length) return { reply: "Not much yet! Say “let me tell you about myself” and I'll ask a few quick questions." };
      return { reply: `Here's what I know: ${listSay(bits)}. It's all kept on this computer; say “forget that I…” to remove something.` };
    }
  }
  return null;
}
// "I'm a carpenter" replaces an older "I'm a teacher": one sentence of each kind in About you
function upsertSentence(text, re, sentence) {
  const parts = String(text ?? "").split(/(?<=\.)\s+/).filter(Boolean).filter((s) => !re.test(s));
  return [...parts, sentence].join(" ").slice(0, 1500);
}
function tzName(tz) {
  const US = { "America/Chicago": "Central", "America/New_York": "Eastern", "America/Denver": "Mountain", "America/Phoenix": "Arizona", "America/Los_Angeles": "Pacific", "America/Anchorage": "Alaska", "Pacific/Honolulu": "Hawaii" };
  return US[tz] ?? String(tz ?? "").replace(/_/g, " ").split("/").pop();
}

// ---- "let me tell you about myself": one question at a time ----
export const TOUR = [
  { key: "name", ask: "Great! First, what's your name?", to: (a) => `my name is ${a.replace(/^(it s|its|it is|i m|i am|my name is|call me)\s+/, "")}` },
  { key: "where", ask: "Where do you live? A town or a zip code is plenty.", to: (a) => `i live in ${a.replace(/^(i live in|in|near|i m in|i am in)\s+/, "")}` },
  { key: "work", ask: "What do you do for work?", to: (a) => (/^(i |my )/.test(a) ? a : /\b(at|for)\b/.test(a) ? `i work ${a.replace(/^work /, "")}` : `i m a ${a.replace(/^(a|an|i m a|i am a)\s+/, "")}`) },
  { key: "interests", ask: "What do you like to do for fun?", to: (a) => (/^i /.test(a) ? a : `i like ${a}`) },
  { key: "birthday", ask: "And when's your birthday?", to: (a) => `my birthday is ${a.replace(/^(it s|its|it is|my birthday is)\s+/, "")}` },
];
