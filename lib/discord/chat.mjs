// Dayspring as someone to talk to in Discord text chat. Kept apart from the Discord connection (bot.mjs) so it can be
// tested with pretend messages.
//
// When it answers:  an @mention in any channel it can see · the "Dayspring channel" (Settings → Calls; every message there
//                   is for Dayspring) · DMs, as allowed by the DM setting (anyone / people in a server with the bot / only
//                   the owner / off) · the slash commands /ask /joke /time /weather /remind /help (and /dayspring join|leave|say).
//                   Other bots are always ignored.
// Who gets what:    the owner (DISCORD_OWNER_ID) gets the full assistant: schedule, reminders, texts, everything.
//                   Everyone else gets fun and information (trivia, jokes, the time, the weather), read-only, and nothing of
//                   the owner's (schedule, files, texts, prayer list) unless the owner turned on "Share my schedule with Discord".
// Speed:            the typing indicator shows right away; the answer is written into the message as it's made (edits about
//                   once a second, well inside Discord's limits).
// Fair use:         6 messages a minute per person (12 per channel), and a short pause between one person's messages.
// Memory:           the last ~10 turns in each channel, forgotten after 30 minutes of quiet. Only in memory, never on disk.
import * as cfg from "../calls/config.mjs";

export const CHANGES = /^(?:(?:please|hey|so|and|can you|could you|would you|will you|go ahead and|i need you to|i want you to)\s+)*(add|schedule|book|move|reschedule|cancel|delete|remove|clear|rename|change|set|turn (?:on|off)|switch|send|text|message|email|open|close|install|buy|order|pay|mark|update|edit|write|forget|remember|play|skip|pause|remind)\b/i;
const STRONG_PRIVATE = /\b(schedule|calendar|agenda|appointments?|prayer list|reminders|texts|emails|files|documents)\b/i;
const PRIVATE = /\b(schedule|calendar|agenda|plans?|appointments?|meetings?|what(?:'s| is) (?:he|she|they|\w+) doing|busy|free (?:today|tonight|tomorrow)|files?|documents?|texts?|messages?|emails?|prayer list|prayers?|notes?|reminders?|contacts?|address|phone number)\b/i;

// ---- the slash commands ---------------------------------------------------------------------------------------------------
export function slashCommands(assistant = "Dayspring") {
  const text = (name, description, required = true) => ({ type: 3, name, description, required });
  return [
    { name: "ask", description: `Ask ${assistant} anything`, options: [text("question", "What do you want to know?")] },
    { name: "joke", description: `${assistant} tells a joke`, options: [text("about", "A topic (optional)", false)] },
    { name: "time", description: "What time it is for the owner" },
    { name: "weather", description: "The weather where the owner is" },
    { name: "remind", description: "Set a reminder (owner only)", options: [text("what", "Remind you to…"), text("when", "When (for example: at 7 pm, in 20 minutes, tomorrow at 9)")] },
    { name: "help", description: `What ${assistant} can do here` },
    { name: "dayspring", description: `Talk to ${assistant}`, options: [
      { type: 1, name: "join", description: "Join the voice channel you're in" },
      { type: 1, name: "leave", description: "Leave the voice channel" },
      { type: 1, name: "say", description: "Ask something (answers here)", options: [text("text", "What to ask")] },
    ] },
  ];
}

// ---- fair use --------------------------------------------------------------------------------------------------------------
export function createLimiter({ now = Date.now, conf = () => cfg.get().rate } = {}) {
  const users = new Map(), chans = new Map(), warned = new Map();
  const within = (arr, t, w) => { while (arr.length && t - arr[0] >= w) arr.shift(); return arr; };
  return {
    // → { ok } or { ok:false, why:"rate"|"cooldown", warn } (warn = tell them once, then stay quiet)
    check(userId, channelId) {
      const r = conf(), t = now();
      const u = within(users.get(userId) ?? [], t, r.windowMs), c = within(chans.get(channelId) ?? [], t, r.windowMs);
      users.set(userId, u); chans.set(channelId, c);
      let why = null;
      if (u.length && t - u[u.length - 1] < r.cooldownMs) why = "cooldown";
      else if (u.length >= r.perUser || c.length >= r.perChannel) why = "rate";
      if (why) { const w = (warned.get(userId) ?? 0) <= t - r.windowMs; if (w && why === "rate") warned.set(userId, t); return { ok: false, why, warn: w && why === "rate" }; }
      u.push(t); c.push(t);
      return { ok: true };
    },
    _state: () => ({ users, chans }),
  };
}

// ---- memory per channel ----------------------------------------------------------------------------------------------------
export function createMemory({ now = Date.now, conf = () => cfg.get() } = {}) {
  const chans = new Map();
  return {
    get(id) { const m = chans.get(id); if (!m) return []; if (now() - m.at > conf().memoryIdleMs) { chans.delete(id); return []; } return m.turns.slice(); },
    add(id, ...turns) { const cur = this.get(id); cur.push(...turns); chans.set(id, { turns: cur.slice(-conf().memoryTurns * 2), at: now() }); },
    clear(id) { chans.delete(id); },
    size: () => chans.size,
  };
}

// ---- writing an answer as it arrives -----------------------------------------------------------------------------------------
// The first sentence posts a reply; later sentences edit it (no more than once every `everyMs`); the end makes one last edit.
export function createStreamer(target, { everyMs = 1100, max = 1900, now = Date.now, schedule = (fn, ms) => setTimeout(fn, ms) } = {}) {
  let msg = null, started = false, text = "", shown = "", lastEdit = 0, timer = null, chain = Promise.resolve();
  const cut = (t) => (t.length > max ? t.slice(0, max - 1) + "…" : t);
  // one edit with whatever has arrived by the time it runs
  const flush = () => { timer = null; chain = chain.then(async () => { if (!msg || text === shown) return; shown = text; lastEdit = now(); await msg.edit(cut(text)).catch(() => {}); }); };
  return {
    push(sentence) {
      text = text ? `${text} ${sentence}` : sentence;
      if (!started) {                                   // the first sentence: post it right away
        started = true; const first = text; shown = first; lastEdit = now();
        chain = chain.then(async () => { msg = await target.reply(cut(first)); }).catch(() => {});
        return;
      }
      if (timer) return;
      timer = schedule(flush, Math.max(0, everyMs - (now() - lastEdit)));
    },
    async end(finalText = null) {
      if (timer) { clearTimeout(timer); timer = null; }
      if (finalText != null) text = finalText;
      await chain;
      if (!started) { started = true; if (text) msg = await target.reply(cut(text)).catch(() => null); return msg; }
      if (msg && text !== shown) { shown = text; await msg.edit(cut(text)).catch(() => {}); }
      return msg;
    },
    get text() { return text; },
  };
}

// ---- the companion -----------------------------------------------------------------------------------------------------------
//   deps.botId()           the bot's own user id
//   deps.ownerId()         DISCORD_OWNER_ID
//   deps.textChannel()     DISCORD_TEXT_CHANNEL_ID (the old setting; calls.json chatChannelId wins)
//   deps.inServer(userId)  → Promise<boolean>: shares a server with the bot (for the "server" DM setting)
//   deps.ownerChat(text, { history, channelId }) → Promise<{ reply, history }>   the full assistant (owner only)
//   deps.quick(text)       → Promise<{ reply } | null>: "what time is it", jokes, the weather, without the AI
//   deps.reply(opts)       lib/calls/pipeline.mjs reply()
//   deps.schedule()        → a short summary of today's plan, only used with "Share my schedule with Discord"
//   deps.wake(text)        → the request after the assistant's name, or null
//   deps.log(kind, data)   devlog (only messages addressed to Dayspring ever reach here)
//   deps.assistant()/owner()  names
export function createChat(deps) {
  const d = { conf: () => cfg.get(), now: Date.now, log: () => {}, assistant: () => "Dayspring", owner: () => "your friend", wake: () => null, schedule: () => "", ...deps };
  const limiter = deps.limiter ?? createLimiter({ now: d.now, conf: () => d.conf().rate });
  const memory = deps.memory ?? createMemory({ now: d.now, conf: d.conf });
  const isOwner = (id) => Boolean(d.ownerId() && id === d.ownerId());
  const chatChannel = () => d.conf().chatChannelId || d.textChannel?.() || "";

  // Is this message for Dayspring? → the request text ("" = only its name), or null.
  async function shouldRespond(m) {
    if (!m || m.author?.bot || m.webhookId || !d.botId()) return null;
    const content = String(m.content ?? "");
    const botId = d.botId();
    if (!m.guild) {                                                    // a DM
      const policy = d.conf().dm;
      if (policy === "off") return null;
      if (!isOwner(m.author.id)) {
        if (policy === "owner") return null;
        if (policy === "server" && !(await d.inServer?.(m.author.id).catch(() => false))) return null;
      }
      return content.replace(new RegExp(`<@!?${botId}>`, "g"), "").trim();
    }
    if (m.mentions?.users?.has?.(botId)) return content.replace(new RegExp(`<@!?${botId}>`, "g"), "").trim();
    if (m.mentions?.repliedUser?.id === botId) return content.trim();  // a reply to one of Dayspring's messages
    if (chatChannel() && m.channelId === chatChannel()) return d.wake(content) ?? content.trim();
    return d.wake(content);                                             // "Dayspring, …" at the start of a message
  }

  // What someone other than the owner may ask: no changes, nothing private unless shared.
  function friendGate(text, name) {
    const O = d.owner();
    if (CHANGES.test(text)) return `Only ${O} can ask me to change things${name ? `, ${name}` : ""}. I'm happy to answer questions, tell jokes, or look up the time and weather though!`;
    const esc = O.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const aboutOwner = new RegExp(`\\b(${esc}|he|she|they|him|her|them|his|their|your (?:owner|boss|person|human))\\b`, "i").test(text);
    if (!d.conf().shareSchedule && (STRONG_PRIVATE.test(text) || (PRIVATE.test(text) && aboutOwner)))
      return `That's ${O}'s private stuff, so I'll keep it to myself. ${O} can ask me directly.`;
    return null;
  }

  // Answer one request (text, slash /ask, or /dayspring say) into `target` (a message or an interaction wrapper with reply()).
  async function respond(text, { userId, name, channelId, target, typing = null }) {
    const lim = limiter.check(userId, channelId);
    if (!lim.ok) { if (lim.warn) await target.reply(`I'm getting a lot of messages. Give me a minute, ${name || "friend"}!`).catch(() => {}); return { limited: lim.why }; }
    typing?.();
    const history = memory.get(channelId);
    const owner = isOwner(userId);
    let out;
    if (!owner) { const g = friendGate(text, name); if (g) { await target.reply(g).catch(() => {}); memory.add(channelId, { role: "user", name, content: text }, { role: "assistant", content: g }); return { reply: g, refused: true }; } }
    const quick = await d.quick?.(text).catch(() => null);
    if (quick?.reply) { await target.reply(quick.reply).catch(() => {}); out = { reply: quick.reply, quick: true }; }
    else if (owner && d.ownerChat && (CHANGES.test(text) || PRIVATE.test(text) || /\b(my|me|i)\b/i.test(text))) {
      // the owner asking about their own things: the full assistant (it can look at the schedule and make changes)
      const r = await d.ownerChat(text, { history, channelId }).catch((e) => ({ reply: e.status === 401 ? "I don't have an AI set up for that yet." : "Sorry, I couldn't get an answer just then." }));
      await target.reply(String(r.reply || "Okay.").slice(0, 1900)).catch(() => {});
      out = { reply: r.reply, full: true };
    } else {
      const s = createStreamer(target, { now: d.now });
      const r = await d.reply({ text, history, who: owner ? "owner" : "friend", via: "discord-text", surface: "discord-text",
        schedule: owner || d.conf().shareSchedule ? d.schedule() : "", persona: d.conf().discordPersona || "", onSentence: (t) => s.push(t) });
      // no AI: say so under the answer (once), so people know why it's short
      const note = r.offline && !r.setup && !/limited without AI/i.test(r.reply) && !(d.aiReady?.() ?? true) ? `${r.reply}\n-# limited without AI right now` : null;
      await s.end(note);
      out = { reply: r.reply, offline: r.offline, model: r.model };
    }
    memory.add(channelId, { role: "user", name, content: text }, { role: "assistant", content: out.reply });
    d.log("call-command", { via: "discord-text", owner, said: text, reply: out.reply });
    return out;
  }

  async function handleMessage(m) {
    const cmd = await shouldRespond(m);
    if (cmd === null) return { ignored: true };
    const name = m.member?.displayName ?? m.author.globalName ?? m.author.username;
    if (!cmd) { await m.reply("Yes? What can I do?").catch(() => {}); return { reply: "Yes? What can I do?" }; }
    return respond(cmd, { userId: m.author.id, name, channelId: m.channelId, target: m, typing: () => m.channel?.sendTyping?.().catch(() => {}) });
  }

  // Slash commands (not /dayspring join|leave, which the bot handles). `i` is a discord.js ChatInputCommandInteraction.
  async function handleSlash(i) {
    const name = i.member?.displayName ?? i.user.globalName ?? i.user.username;
    const owner = isOwner(i.user.id);
    let replied = false;
    const target = { reply: async (content) => { if (!replied) { replied = true; await i.editReply(content); return { edit: (c) => i.editReply(c) }; } return i.followUp(content); } };
    const run = async (text) => { await i.deferReply(); return respond(text, { userId: i.user.id, name, channelId: i.channelId ?? "dm", target }); };
    switch (i.commandName) {
      case "ask": return run(i.options.getString("question", true));
      case "joke": { const about = i.options.getString("about", false); return run(about ? `Tell me a joke about ${about}` : "Tell me a joke"); }
      case "time": return run("What time is it?");
      case "weather": return run("What's the weather?");
      case "help": return i.reply({ content: helpText(owner), ephemeral: true });
      case "remind": {
        if (!owner) return i.reply({ content: `Only ${d.owner()} can set reminders with me.`, ephemeral: true });
        await i.deferReply({ ephemeral: true });
        const what = i.options.getString("what", true), when = i.options.getString("when", true);
        const r = await d.ownerChat(`Remind me to ${what} ${when}`, { history: [], channelId: i.channelId ?? "dm" }).catch(() => ({ reply: "Sorry, I couldn't set that reminder." }));
        d.log("call-command", { via: "discord-slash", owner: true, said: `remind ${what} ${when}`, reply: r.reply });
        return i.editReply(String(r.reply || "Done.").slice(0, 1900));
      }
      case "dayspring": if (i.options.getSubcommand() === "say") return run(i.options.getString("text", true)); return null;
      default: return null;
    }
  }

  function helpText(owner) {
    const A = d.assistant(), O = d.owner();
    return [`**${A}** here! Ways to talk to me:`,
      "• @mention me, or start a message with my name" + (chatChannel() ? `, or just talk in <#${chatChannel()}>` : ""),
      "• `/ask`, `/joke`, `/time`, `/weather`" + (owner ? ", `/remind`" : ""),
      "• `/dayspring join` and I'll hop into your voice channel; say my name there and I'll answer out loud",
      owner ? "You get everything: your schedule, reminders, texts." : `I'm happy with trivia, facts, jokes and quick answers. ${O}'s own things stay private.`].join("\n");
  }

  return { shouldRespond, handleMessage, handleSlash, respond, helpText, limiter, memory, friendGate };
}
