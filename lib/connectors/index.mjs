// The connected apps together: status, external calendar events for the schedule, AI tools, and a few spoken phrases.
// Email is read and DRAFTED only; nothing here can send an email. Writing to Google/Outlook calendars, To Do or Notion
// happens only when the owner asks for it.
import * as notion from "./notion.mjs";
import * as google from "./google.mjs";
import * as microsoft from "./microsoft.mjs";
import * as ics from "./ics.mjs";
import * as feeds from "./feeds.mjs";
import * as homeassistant from "./homeassistant.mjs";
import * as webhooks from "./webhooks.mjs";
import * as todoist from "./todoist.mjs";
import * as weatheralerts from "./weatheralerts.mjs";
import { guides } from "./guides.mjs";

export { notion, google, microsoft, ics, feeds, homeassistant, webhooks, todoist, weatheralerts };
export function statuses() {
  return { notion: notion.status(), google: google.status(), microsoft: microsoft.status(), ics: ics.status(), feeds: feeds.status(), homeassistant: homeassistant.status(),
    webhooks: webhooks.status(), todoist: todoist.status(), weatheralerts: weatheralerts.status() };
}
// The background jobs (the server calls this once at start): weather alerts. announce = announcer.announce
export function startBackground({ announce } = {}) { if (announce) weatheralerts.startBackground(announce); }
export function list() { const s = statuses(); return guides().map((g) => ({ ...g, status: s[g.id] })); }

// External calendar events for Dayspring's schedule (read-only; shown as their own category). Cached for 5 minutes.
const cache = new Map();
export async function externalEvents(from, to) {
  const key = `${from}|${to}`, hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.events;
  const all = [];
  if (google.connectedFor("calendar")) all.push(...(await google.events(from, to).catch(() => [])));
  if (microsoft.connected()) all.push(...(await microsoft.events(from, to).catch(() => [])));
  if (ics.connected()) all.push(...(await ics.events(from, to).catch(() => [])));
  const events = all.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  cache.set(key, { at: Date.now(), events }); if (cache.size > 40) cache.delete(cache.keys().next().value);
  return events;
}
export function clearCache() { cache.clear(); ics.clearCache(); }

// ---- AI tools ----
const which = (p) => (p === "outlook" || p === "microsoft" ? "microsoft" : p === "gmail" || p === "google" ? "google" : null);
// (account: one of several Google accounts by its label, "work" or an email; the primary one when it's left out)
const mailFrom = (p, account) => { const w = which(p) ?? (account || google.connectedFor("gmail") ? "google" : microsoft.connected() ? "microsoft" : null); if (!w) throw new Error("No email account is connected. Connect Gmail or Outlook in Settings → Apps."); return w === "google" ? (account ? google.forAccount(account) : google) : microsoft; };
const calFrom = (p, account) => { const w = which(p) ?? (account || google.connectedFor("calendar") ? "google" : microsoft.connected() ? "microsoft" : null); if (!w) throw new Error("No outside calendar is connected. Connect Google Calendar or Outlook in Settings → Apps."); return w === "google" ? (account ? google.forAccount(account) : google) : microsoft; };
const PROVIDER = { type: "string", enum: ["google", "microsoft"], description: "google = Google Calendar/Gmail, microsoft = Outlook/To Do. Omit to use whichever is connected." };
const ACCOUNT = { type: "string", description: "Which Google account, when several are connected: its nickname (\"work\", \"personal\") or email. Omit for the primary one." };
export const TOOLS = [
  { name: "connections_status", description: "Which outside apps are connected (Notion, Google Calendar + Gmail, Outlook + Microsoft To Do).", input_schema: { type: "object", properties: {} } },
  { name: "calendar_events", description: "Events from the owner's connected Google or Outlook calendars between two dates. Use for questions about their outside calendars (Dayspring's own schedule is separate).", input_schema: { type: "object", properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } }, required: ["from", "to"] } },
  { name: "calendar_add_event", description: "Add an event to the owner's Google or Outlook calendar. Only when they ask to put it on that calendar (not Dayspring's own schedule).", input_schema: { type: "object", properties: { provider: PROVIDER, account: ACCOUNT, title: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" }, start: { type: "string", description: "HH:MM 24h" }, end: { type: "string", description: "HH:MM 24h" }, all_day: { type: "boolean" }, where: { type: "string" }, notes: { type: "string" } }, required: ["title", "date"] } },
  { name: "email_search", description: "Search the owner's Gmail or Outlook mail (Gmail search syntax works for Gmail, e.g. 'is:unread', 'from:sam'). Returns sender, subject, date and a snippet.", input_schema: { type: "object", properties: { provider: PROVIDER, account: ACCOUNT, query: { type: "string" }, limit: { type: "integer" } } } },
  { name: "email_read", description: "Read one email in full (use an id from email_search). Read it aloud or summarize it as the owner asks.", input_schema: { type: "object", properties: { provider: PROVIDER, account: ACCOUNT, id: { type: "string" } }, required: ["id"] } },
  { name: "email_draft", description: "Write an email DRAFT (new, or a reply to an email id). It is saved in the owner's Drafts folder and is NOT sent: Dayspring cannot send email. Read the draft back and tell them it's waiting in Drafts.", input_schema: { type: "object", properties: { provider: PROVIDER, account: ACCOUNT, to: { type: "string" }, subject: { type: "string" }, text: { type: "string" }, reply_to_id: { type: "string" } }, required: ["text"] } },
  { name: "todo_list", description: "The owner's Microsoft To Do tasks (open ones by default).", input_schema: { type: "object", properties: { list: { type: "string", description: "List name (default list if omitted)" }, include_done: { type: "boolean" } } } },
  { name: "todo_add", description: "Add a task to Microsoft To Do (only when the owner asks for To Do; Dayspring's own tasks are separate).", input_schema: { type: "object", properties: { title: { type: "string" }, list: { type: "string" }, due: { type: "string", description: "YYYY-MM-DD" } }, required: ["title"] } },
  { name: "todo_complete", description: "Mark a Microsoft To Do task done by part of its title.", input_schema: { type: "object", properties: { match: { type: "string" }, list: { type: "string" } }, required: ["match"] } },
  // calendar subscriptions (ICS): read-only; their events already come back from calendar_events
  { name: "calendar_subscribe", description: "Subscribe to a calendar by its link (.ics or webcal://: an iCloud shared/public calendar, a school, team or league schedule, holidays). Its events appear on Dayspring's schedule, read-only.", input_schema: { type: "object", properties: { url: { type: "string" }, name: { type: "string" } }, required: ["url"] } },
  // news and RSS
  { name: "news_latest", description: "The latest headlines from the owner's news feeds, or about any topic (a one-off news search when they don't follow it). Summarize in plain words; give links on screen with show_results when available.", input_schema: { type: "object", properties: { feed: { type: "string", description: "A feed name or topic (tech, science, sports, local, or any words); omit for all their feeds" }, limit: { type: "integer" } } } },
  { name: "news_add_feed", description: "Follow a news feed: a feed link (RSS/Atom), or a topic (tech, science, sports, health, business, world, entertainment, faith, or any words), or local news for their town.", input_schema: { type: "object", properties: { url: { type: "string" }, topic: { type: "string" }, local: { type: "boolean" }, name: { type: "string" } } } },
  // smart home (Home Assistant)
  { name: "home_devices", description: "List the smart-home devices in Home Assistant (lights, switches, thermostats, locks, garage doors, sensors, scenes…), optionally one kind (domain like light, switch, climate, lock, cover, sensor, binary_sensor, scene, script).", input_schema: { type: "object", properties: { domain: { type: "string" } } } },
  { name: "home_state", description: "The state of one smart-home device by how the owner names it (\"is the garage door closed\", \"what's the thermostat set to\", \"living room temperature\").", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "home_control", description: "Control a smart-home device: action on/off/toggle, open/close (blinds, garage), lock/unlock, activate (scene or script), set_temperature (value °), set_brightness (value %). Unlocking, opening a garage door/gate and disarming an alarm return a question first: ask it, and only after the owner's clear yes call again with confirmed true.", input_schema: { type: "object", properties: { name: { type: "string" }, action: { type: "string", enum: ["on", "off", "toggle", "open", "close", "lock", "unlock", "activate", "set_temperature", "set_brightness", "disarm"] }, value: { type: "number" }, confirmed: { type: "boolean" } }, required: ["name", "action"] } },
  // webhooks (IFTTT, Zapier, Make, n8n)
  { name: "webhook_run", description: "Run one of the owner's webhook actions by name (they set these up for IFTTT, Zapier, Make or n8n: \"Leaving home\", \"Log my workout\"…). Optional payload fields are passed along (value1..value3 for IFTTT).", input_schema: { type: "object", properties: { name: { type: "string" }, payload: { type: "object" } }, required: ["name"] } },
  // Todoist
  { name: "todoist_tasks", description: "The owner's open Todoist tasks (optionally one project, or only what's due today or overdue).", input_schema: { type: "object", properties: { project: { type: "string" }, due_today: { type: "boolean" } } } },
  { name: "todoist_add", description: "Add a task to Todoist (only when the owner asks for Todoist). due is Todoist's natural language: \"tomorrow 5pm\", \"every friday\".", input_schema: { type: "object", properties: { title: { type: "string" }, due: { type: "string" } }, required: ["title"] } },
  { name: "todoist_complete", description: "Mark a Todoist task done by part of its title.", input_schema: { type: "object", properties: { match: { type: "string" } }, required: ["match"] } },
  // weather alerts
  { name: "weather_alerts", description: "Active severe-weather alerts for the owner's location (official National Weather Service alerts in the U.S.; a forecast-based heads-up elsewhere, not official).", input_schema: { type: "object", properties: {} } },
  { name: "notion_search", description: "Search the owner's Notion pages and databases by title words (empty query = recently edited).", input_schema: { type: "object", properties: { query: { type: "string" } } } },
  { name: "notion_read", description: "Read a Notion page's text (id from notion_search). Summarize or read it aloud as asked; never invent content.", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "notion_create_page", description: "Create a new Notion page under a parent page (id or title words). Only when the owner asks.", input_schema: { type: "object", properties: { parent: { type: "string", description: "Parent page id or title words" }, title: { type: "string" }, text: { type: "string", description: "Body; lines starting with '- ' become bullets, '# ' headings" } }, required: ["title"] } },
  { name: "notion_append", description: "Add text to the end of an existing Notion page (id or title words). Only when the owner asks.", input_schema: { type: "object", properties: { page: { type: "string" }, text: { type: "string" } }, required: ["page", "text"] } },
];
const NAMES = new Set(TOOLS.map((t) => t.name));
const isId = (s) => /^[0-9a-f-]{32,36}$/i.test(String(s ?? ""));
export async function runTool(name, i = {}) {
  if (!NAMES.has(name)) return undefined;
  try {
    switch (name) {
      case "connections_status": return statuses();
      case "calendar_events": return { events: await externalEvents(i.from, i.to ?? i.from) };
      case "calendar_add_event": { const r = await calFrom(i.provider, i.account).addEvent({ title: i.title, date: i.date, start: i.start ?? "09:00", end: i.end ?? "10:00", allDay: Boolean(i.all_day), where: i.where, notes: i.notes }); clearCache(); return r; }
      case "email_search": return { messages: await mailFrom(i.provider, i.account).searchMail(i.query ?? (which(i.provider) === "microsoft" ? "" : "in:inbox"), { limit: i.limit ?? 8 }) };
      case "email_read": return await mailFrom(i.provider, i.account).readMail(i.id);
      case "email_draft": return await mailFrom(i.provider, i.account).draft({ to: i.to, subject: i.subject, text: i.text, replyToId: i.reply_to_id });
      case "todo_list": return await microsoft.tasks({ list: i.list, includeDone: Boolean(i.include_done) });
      case "todo_add": return await microsoft.addTask({ title: i.title, list: i.list, due: i.due });
      case "todo_complete": return await microsoft.completeTask({ match: i.match, list: i.list });
      case "calendar_subscribe": { const r = await ics.connect({ url: i.url, name: i.name }); clearCache(); return r; }
      case "news_latest": return { items: await feeds.latest({ feed: i.feed ?? "", limit: i.limit ?? 8 }) };
      case "news_add_feed": return await feeds.connect({ url: i.url, topic: i.topic, local: i.local, name: i.name });
      case "home_devices": return { devices: await homeassistant.list({ domain: i.domain }) };
      case "home_state": return (await homeassistant.state(i.name)) ?? { error: `I couldn't find “${i.name}” in Home Assistant.` };
      case "home_control": return await homeassistant.control({ name: i.name, action: i.action, value: i.value, confirmed: i.confirmed === true });
      case "webhook_run": return await webhooks.run(i.name, i.payload ?? {});
      case "todoist_tasks": return await todoist.tasks({ project: i.project, dueToday: Boolean(i.due_today) });
      case "todoist_add": return await todoist.addTask({ title: i.title, due: i.due });
      case "todoist_complete": return await todoist.complete({ match: i.match });
      case "weather_alerts": return await weatheralerts.current();
      case "notion_search": return { results: await notion.search(i.query ?? "") };
      case "notion_read": return await notion.read(i.id);
      case "notion_create_page": { const parent = i.parent ? (isId(i.parent) ? i.parent : (await notion.findPage(i.parent))?.id) : undefined; return await notion.createPage({ parentId: parent, title: i.title, text: i.text ?? "" }); }
      case "notion_append": { const id = isId(i.page) ? i.page : (await notion.findPage(i.page))?.id; if (!id) return { error: `No Notion page matches “${i.page}”.` }; return { ...(await notion.append(id, i.text)), page: id }; }
    }
  } catch (e) { return { error: e.message }; }
  return undefined;
}
// For the system prompt: one line about what's connected
export function contextText() {
  const s = statuses(), on = [s.notion.connected && "Notion", s.google.connected && `Google (${s.google.accounts.map((a) => `${a.label}: ${["calendar", "gmail", "drive"].filter((k) => a.ready[k]).join(", ") || "nothing on"}${a.driveWrite ? " (may change Drive files)" : ""}`).join("; ")})`, s.microsoft.connected && "Outlook + Microsoft To Do",
    s.ics.connected && `calendar subscriptions (${s.ics.calendars.map((c) => c.name).join(", ")})`, s.feeds.connected && "news feeds", s.homeassistant.connected && "Home Assistant (smart home)",
    s.webhooks.connected && `webhook actions (${s.webhooks.outgoing.map((w) => w.name).join(", ")})`, s.todoist.connected && "Todoist"].filter(Boolean);
  const alerts = s.weatheralerts.active ? ` There are ${s.weatheralerts.active} active weather alerts; weather_alerts has them.` : "";
  return on.length || alerts ? `Connected apps: ${on.join(", ") || "none"}. Use the calendar_*, email_*, drive_*, todo_*, notion_*, news_*, home_*, webhook_run and todoist_* tools for them${s.google.accounts.length > 1 ? " (pass account to pick a Google account by its label; the primary one is used otherwise)" : ""}. Email can only be drafted, never sent. Smart-home unlocks, garage doors and alarm disarms always need the owner's yes first.${alerts}` : "";
}

// ---- spoken phrases (no AI needed) ----
const today = () => new Date().toLocaleDateString("en-CA");
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const say12 = (hm) => { const [h, m] = hm.split(":").map(Number); return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h >= 12 ? "p.m." : "a.m."}`; };
export async function handle(text) {
  const q = String(text).toLowerCase().replace(/[?.!,]/g, "").trim();
  // "what's on my google calendar today", "anything on my outlook calendar tomorrow"
  let m = /\b(google|outlook|work|other|outside) calendar\b/.exec(q);
  if (m && /\b(what'?s|what is|anything|show|read|do i have)\b/.test(q)) {
    const p = m[1] === "google" ? "google" : m[1] === "outlook" ? "microsoft" : null;
    if (p === "google" && !google.connectedFor("calendar")) return "Your Google Calendar isn't connected yet. You can connect it in Settings, under Apps.";
    if (p === "microsoft" && !microsoft.connected()) return "Your Outlook calendar isn't connected yet. You can connect it in Settings, under Apps.";
    if (!p && !google.connectedFor("calendar") && !microsoft.connected()) return null;
    const day = /\btomorrow\b/.test(q) ? addDays(today(), 1) : today();
    const ev = (await externalEvents(day, day)).filter((e) => !p || e.source === p);
    const when = day === today() ? "today" : "tomorrow";
    if (!ev.length) return `Nothing on your ${p === "google" ? "Google" : p === "microsoft" ? "Outlook" : "other"} calendar ${when}.`;
    return `On your ${p === "google" ? "Google" : p === "microsoft" ? "Outlook" : "other"} calendar ${when}: ${ev.slice(0, 8).map((e) => `${e.allDay ? "all day" : say12(e.start)}, ${e.title}`).join("; ")}.`;
  }
  // "check my email", "any new emails", "do I have unread email"
  if (/\b(check (my )?(e-?mail|inbox|gmail|outlook)|any (new )?(e-?mails?|mail)|(new|unread) (e-?mails?|mail)|do i have (any )?(new |unread )?(e-?mails?|mail))\b/.test(q)) {
    const p = /\bgmail\b/.test(q) ? "google" : /\boutlook\b/.test(q) ? "microsoft" : google.connected() ? "google" : microsoft.connected() ? "microsoft" : null;
    if (!p || (p === "google" && !google.connected()) || (p === "microsoft" && !microsoft.connected())) return p === "google" ? "Gmail isn't connected yet. You can connect it in Settings, under Apps (it takes about 10 minutes the first time)." : p === "microsoft" ? "Outlook isn't connected yet. You can connect it in Settings, under Apps." : "No email account is connected yet. You can connect Gmail or Outlook in Settings, under Apps.";
    const msgs = (await (p === "google" ? google.searchMail("is:unread in:inbox", { limit: 6 }) : microsoft.searchMail("", { limit: 12 }))).filter((x) => x.unread).slice(0, 6);
    if (!msgs.length) return "No unread email. Nice.";
    return `${msgs.length} unread: ${msgs.map((x) => `from ${String(x.from).replace(/\s*<.*>/, "")}, “${x.subject}”`).join("; ")}.`;
  }
  // "what's on my to do list"
  if (/\b(what'?s on|read|show) (me )?my (microsoft )?to ?-?do( list)?\b/.test(q) && !microsoft.connected()) return "Microsoft To Do isn't connected yet. You can connect it in Settings, under Apps.";
  if (/\b(what'?s on|read|show) (me )?my (microsoft )?to ?-?do( list)?\b/.test(q) && microsoft.connected()) {
    const t = await microsoft.tasks();
    return t.tasks.length ? `On your To Do list: ${t.tasks.slice(0, 10).map((x) => x.title).join("; ")}.` : "Your To Do list is clear.";
  }
  // a webhook action's own phrase, said exactly ("I'm leaving")
  { const w = webhooks.matchPhrase(q); if (w) { const r = await webhooks.run(w.name).catch((e) => ({ error: e.message })); return r.error ? `That didn't work: ${r.error}` : `Done: ${w.name}.`; } }
  // news: "what's the news", "any science news", "read me the latest from ars technica", "local news"
  if ((m = /^(?:what'?s|what is|read me|tell me|give me|any|anything)(?: the)? (?:(latest|new|top) )?(?:(.+?) )?(?:news|headlines)(?: today)?$/.exec(q)) || (m = /^(?:read me |what'?s )?the latest (?:from|on|in) (.+)$/.exec(q))) {
    const topic = (m.length > 2 ? m[2] : m[1]) ?? "";
    const items = await feeds.latest({ feed: /^(the|my|any)$/.test(topic) ? "" : topic, limit: 5 }).catch(() => []);
    if (!items.length) return topic ? `I couldn't find news about ${topic} right now.` : "I couldn't reach the news right now.";
    return `${topic ? `The latest on ${topic}` : "Top headlines"}: ${items.map((x) => `${x.title}${x.source ? ` (${x.source})` : ""}`).join(". ")}.`;
  }
  // weather alerts: "any weather alerts", "is there a tornado warning"
  if (/\b(weather (alerts?|warnings?)|severe weather|tornado (warning|watch)|storm warning|flood warning)\b/.test(q) && /\b(any|is there|are there|what|check)\b/.test(q)) {
    const r = await weatheralerts.current().catch(() => ({ alerts: [] }));
    if (r.note) return r.note;
    return r.alerts.length ? `For ${r.place}: ${r.alerts.slice(0, 4).map((a) => a.headline).join(". ")}.${r.source !== "National Weather Service" ? " That's from the forecast, not an official warning." : ""}` : `No weather alerts for ${r.place} right now.`;
  }
  // smart home: "turn on the kitchen lights", "turn off the fan", "is the garage door closed", "set the thermostat to 70"
  if (homeassistant.connected()) {
    if ((m = /^(?:please )?(turn|switch) (on|off) (?:the )?(.+?)(?: please)?$/.exec(q)) || (m = /^(?:please )?(turn|switch) (?:the )?(.+?) (on|off)$/.exec(q))) {
      const [on, name] = m[2] === "on" || m[2] === "off" ? [m[2], m[3]] : [m[3], m[2]];
      const e = await homeassistant.find(name, { domains: ["light", "switch", "fan", "input_boolean", "media_player", "climate", "humidifier"] }).catch(() => null);
      if (e) { const r = await homeassistant.control({ name, action: on }).catch((x) => ({ error: x.message })); return r.error ?? `${r.name} is ${on}.`; }
    }
    if ((m = /^set (?:the )?(.+?) to (\d{2,3})(?: degrees)?$/.exec(q))) { const r = await homeassistant.control({ name: m[1], action: "set_temperature", value: Number(m[2]) }).catch((x) => ({ error: x.message })); if (!r.error) return `${r.name} is set to ${m[2]}°.`; }
    if ((m = /^(?:is|are) (?:the )?(.+?) (open|closed|locked|unlocked|on|off)$/.exec(q)) || (m = /^what(?:'s| is) the (.+?) (?:set to|at|reading)$/.exec(q)) || (m = /^what(?:'s| is) the (temperature|humidity) (?:in|of) (?:the )?(.+)$/.exec(q))) {
      const name = m[0].startsWith("what") && m[2] && !/^(open|closed|locked|unlocked|on|off)$/.test(m[2]) ? `${m[2]} ${m[1]}` : m[1];
      const st = await homeassistant.state(name).catch(() => null);
      if (st) return `${st.text}.`;
    }
    if ((m = /^(?:run|activate|start) (?:the )?(.+?) (scene|script|routine)$/.exec(q))) { const r = await homeassistant.control({ name: m[1], action: "activate" }).catch((x) => ({ error: x.message })); if (!r.error) return `${r.name} is running.`; }
  }
  // Todoist: "what's on my todoist", "add buy milk to todoist"
  if (todoist.connected()) {
    if (/\b(what'?s on|read|show) (me )?my todoist\b|\bmy todoist (tasks|list)\b/.test(q)) { const t = await todoist.tasks({ dueToday: /today/.test(q) }); return t.tasks.length ? `On Todoist: ${t.tasks.slice(0, 8).map((x) => x.title + (x.dueText ? ` (${x.dueText})` : "")).join("; ")}.` : "Your Todoist is clear."; }
    if ((m = /^add (.+?) to (?:my )?todoist(?: (?:for|due) (.+))?$/.exec(q))) { const r = await todoist.addTask({ title: m[1], due: m[2] }); return `Added “${r.added.title}” to Todoist${r.added.dueText ? `, ${r.added.dueText}` : ""}.`; }
  }
  // "search notion for groceries"
  if (/^(?:search|look in|find in) notion\b/.test(q) && !notion.configured()) return "Notion isn't connected yet. You can connect it in Settings, under Apps. It only needs a key from Notion.";
  if ((m = /^(?:search|look in|find in) notion for (.+)$/.exec(q)) && notion.configured()) {
    const r = await notion.search(m[1]);
    return r.length ? `In Notion: ${r.slice(0, 6).map((x) => x.title).join("; ")}.` : `Nothing in Notion matches “${m[1]}”.`;
  }
  return null;
}
