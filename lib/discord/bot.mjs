// Dayspring as a Discord bot (optional; on when DISCORD_BOT_TOKEN is set in .env / Settings → Discord).
//   Text: someone to talk to in chat (lib/discord/chat.mjs): @mentions, DMs (Settings → Calls), a "Dayspring channel",
//     and /ask /joke /time /weather /remind /help. Answers are written into the message as they're made.
//   Voice: joins the voice channel the owner is in ("/dayspring join", or "Dayspring, join my Discord" on the screen),
//     says hello so everyone knows it's there, listens for its name, answers out loud in the channel.
//     Quick by design (lib/calls): each person is heard separately; an utterance ends after ~0.45 s of quiet; the fast
//     speech model is used when its words are clear; the answer comes from the fast AI model a sentence at a time, and
//     each sentence's voice streams into the channel as it's made. Talking over Dayspring for ~0.6 s stops it.
// Who can ask what: the owner (DISCORD_OWNER_ID) gets the full assistant (schedule, reminders, everything). Anyone else
//   gets a friendly general answer with no access to the owner's schedule, files or personal details.
// Privacy: call audio is turned into text only to listen for the name. Nothing anyone says is saved; only a request made
//   to Dayspring (after its name) and its reply are logged (devlog "call-command"), without the words of anyone else.
// Bots can join SERVER voice channels only (Discord doesn't allow bots in DM or group-DM calls).
import { broadcast } from "../bus.mjs";
import * as devlog from "../devlog.mjs";
import * as owner from "../owner.mjs";
import * as llm from "../llm.mjs";
import * as cfg from "../calls/config.mjs";
import * as latency from "../calls/latency.mjs";
import * as pipeline from "../calls/pipeline.mjs";
import { splitAll } from "../calls/sentences.mjs";
import { createBargeIn } from "../calls/bargein.mjs";
import { warm } from "../calls/warm.mjs";
import { wakeCommand, isNoise } from "./wake.mjs";
import { decodeUtterance, loudEnough, streamResource } from "./audio.mjs";
import { createChat, slashCommands, CHANGES } from "./chat.mjs";

const TOKEN = () => process.env.DISCORD_BOT_TOKEN || "";
const OWNER_ID = () => process.env.DISCORD_OWNER_ID || "";
const GUILD_ID = () => process.env.DISCORD_GUILD_ID || "";
const TEXT_CHANNEL = () => process.env.DISCORD_TEXT_CHANNEL_ID || "";

let djs = null, dv = null;             // discord.js and @discordjs/voice, loaded only when the bot is used
let client = null;
let state = { enabled: false, status: "off", user: null, userId: null, guilds: [], voice: null, lastError: null, listening: false, stt: null };
let conn = null, player = null, joinedAt = 0;
const queue = [];                      // sentences waiting to be spoken: { text, res, ctl, turn, resolve, reject }
let current = null;                    // the one playing now
let activeTurn = null;                 // the answer being written (an AbortController), so talking over it stops it
const busy = new Set();                // users whose utterance is being transcribed right now
const followUp = new Map();            // userId → until (ms): they said just the name, the next thing they say is the request
let history = [];                      // the owner's conversation with Dayspring over Discord voice (not stored on disk)
let callHistory = [];                  // what's been asked in this voice channel (for "and what about…"), in memory only

export function status() {
  return { ...state, configured: Boolean(TOKEN()), ownerSet: Boolean(OWNER_ID()), textChannel: cfg.get().chatChannelId || TEXT_CHANNEL() || null };
}
function setState(patch) { state = { ...state, ...patch }; try { broadcast("discord", status()); } catch { /* no screen */ } }

// ---- speech to text (lib/stt.mjs: local Whisper) --------------------------------------------------------
let sttMod = null;
async function stt() {
  if (sttMod) return sttMod;
  try { sttMod = await import("../stt.mjs"); } catch { sttMod = null; }
  return sttMod;
}
async function sttReady() {
  const s = await stt();
  if (!s?.ready) return { ok: false, why: "Speech-to-text isn't installed yet (Settings → Discord → Install speech recognition)." };
  try { return await s.ready(); } catch (e) { return { ok: false, why: e.message }; }
}

// ---- the text companion -------------------------------------------------------------------------------------
function todayPlan() {
  return import("../store.mjs").then((store) => {
    const t = store.todayISO(), now = new Date(), hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    return store.planBetween(t, t).filter((b) => (b.end ?? b.start) >= hm).slice(0, 8).map((b) => `${b.title} at ${b.start}`).join(", ") || "nothing else today";
  }).catch(() => "");
}
let planCache = { at: 0, text: "" };
function scheduleText() { if (Date.now() - planCache.at > 60_000) todayPlan().then((t) => { planCache = { at: Date.now(), text: t }; }); return planCache.text; }
const QUICK = /^(?:(?:hey |so )?what(?:'s| is) the time|what time is it|what(?:'s| is) (?:the |today'?s )?date|what day is (?:it|today)|(?:what(?:'s| is) the )?weather(?: like)?(?: today| now| outside| out there)?|how(?:'s| is) the weather|tell (?:me|us) a joke|(?:a )?joke(?: please)?)[?.!]*$/i;
async function quickAnswer(text) {
  if (!QUICK.test(String(text).trim())) return null;
  const r = await pipeline.offlineAnswer(text);
  return r ? { reply: r } : null;
}
async function ownerChat(text, { history: h = [] } = {}) {
  const { chat } = await import("../assistant.mjs");
  const out = await chat(h.map((m) => ({ role: m.role, content: m.content })), text, { surface: "Discord text chat" });
  return { reply: out.reply, history: out.history };
}
const chat = createChat({
  botId: () => client?.user?.id ?? null,
  ownerId: OWNER_ID,
  textChannel: TEXT_CHANNEL,
  inServer: async (userId) => { for (const g of client?.guilds.cache.values() ?? []) { try { if (await g.members.fetch(userId)) return true; } catch { /* not in this one */ } } return false; },
  ownerChat, quick: quickAnswer,
  reply: (o) => pipeline.reply(o),
  schedule: scheduleText,
  wake: (t) => wakeCommand(t),
  aiReady: () => llm.ready(),
  log: (k, d) => devlog.log(k, d),
  assistant: () => owner.assistant(), owner: () => owner.name(),
});

// ---- start / stop -------------------------------------------------------------------------------------
export async function start() {
  if (!TOKEN()) { setState({ enabled: false, status: "off", lastError: null }); return status(); }
  if (client) return status();
  try {
    djs = await import("discord.js");
    dv = await import("@discordjs/voice");
  } catch (e) { setState({ status: "error", lastError: "Discord's parts aren't installed (npm install): " + e.message }); return status(); }
  const { Client, GatewayIntentBits, Events, Partials } = djs;
  client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel],
  });
  setState({ enabled: true, status: "connecting", lastError: null });
  client.once(Events.ClientReady, async (c) => {
    setState({ status: "online", user: c.user.tag, userId: c.user.id, guilds: c.guilds.cache.map((g) => ({ id: g.id, name: g.name })) });
    await registerCommands().catch((e) => setState({ lastError: "Couldn't add the slash commands: " + e.message }));
    devlog.log("discord", { what: "online", guilds: c.guilds.cache.size });
    scheduleText();
  });
  client.on(Events.GuildCreate, () => { setState({ guilds: client.guilds.cache.map((g) => ({ id: g.id, name: g.name })) }); registerCommands().catch(() => {}); });
  client.on(Events.GuildDelete, () => setState({ guilds: client.guilds.cache.map((g) => ({ id: g.id, name: g.name })) }));
  client.on(Events.InteractionCreate, (i) => onInteraction(i).catch((e) => devlog.log("error", { where: "discord-interaction", error: e.message })));
  client.on(Events.MessageCreate, (m) => chat.handleMessage(m).catch((e) => devlog.log("error", { where: "discord-message", error: e.message })));
  client.on(Events.VoiceStateUpdate, onVoiceState);
  client.on(Events.Error, (e) => setState({ lastError: e.message }));
  // discord.js reconnects by itself after a network drop; show it on the status panel meanwhile
  client.on(Events.ShardDisconnect, () => setState({ status: "reconnecting" }));
  client.on(Events.ShardReconnecting, () => setState({ status: "reconnecting" }));
  client.on(Events.ShardResume, () => setState({ status: "online" }));
  client.on(Events.ShardReady, () => { if (state.status === "reconnecting") setState({ status: "online" }); });
  try { await client.login(TOKEN()); }
  catch (e) {
    const why = /disallowed intents/i.test(e.message) ? "Turn on MESSAGE CONTENT INTENT in Discord's Developer Portal (Bot page), then restart the bot." :
      /invalid token|TokenInvalid/i.test(e.message) ? "The bot token wasn't accepted. Copy it again from the Developer Portal (Bot → Reset Token)." : e.message;
    setState({ status: "error", lastError: why }); try { client.destroy(); } catch { /* fine */ } client = null;
  }
  return status();
}
export async function stop() {
  await leave().catch(() => {});
  if (client) { try { await client.destroy(); } catch { /* fine */ } }
  client = null; setState({ enabled: false, status: "off", user: null, userId: null, guilds: [] });
  return status();
}
export async function restart() { await stop(); return start(); }

async function registerCommands() {
  if (!client?.application) return;
  const cmds = slashCommands(owner.assistant());
  // per server = shows up right away (global commands can take up to an hour)
  const guilds = GUILD_ID() ? [client.guilds.cache.get(GUILD_ID())].filter(Boolean) : [...client.guilds.cache.values()];
  for (const g of guilds) await g.commands.set(cmds);
  // DMs only see global commands: /ask, /joke, /time, /weather, /help there too (when DMs are allowed)
  if (cfg.get().dm !== "off") await client.application.commands.set(cmds.filter((c) => ["ask", "joke", "time", "weather", "help", "remind"].includes(c.name)).map((c) => ({ ...c, dm_permission: true }))).catch(() => {});
}

// ---- joining a voice channel ------------------------------------------------------------------------------
function voiceChannelOf(userId) {
  for (const g of client?.guilds.cache.values() ?? []) {
    const vs = g.voiceStates.cache.get(userId);
    if (vs?.channel) return vs.channel;
  }
  return null;
}
// Get everything warm before anyone speaks: both speech models, the voice connection, the AI model name.
async function warmUp() {
  const s = await stt();
  const quiet = new Int16Array(16000 * 0.4);
  await Promise.allSettled([
    s?.transcribe?.(quiet, { speed: "fast" }), s?.transcribe?.(quiet, { speed: "accurate" }),
    import("../calls/tts-stream.mjs").then((t) => t.warm()),
    import("../calls/stream-llm.mjs").then((m) => m.fastModel()),
  ]);
}
export async function join(channel = null) {
  if (!client || state.status !== "online") throw new Error(!TOKEN() ? "Your Discord bot isn't set up yet (Settings → Discord)." : state.status === "error" && state.lastError ? "Your Discord bot couldn't sign in: " + state.lastError : "Your Discord bot is still connecting. Try again in a moment.");
  channel ??= OWNER_ID() ? voiceChannelOf(OWNER_ID()) : null;
  if (!channel) throw new Error(OWNER_ID() ? "You're not in a voice channel on any server I'm in." : "Tell me your Discord user ID first (Settings → Discord), or use /dayspring join from Discord.");
  if (conn && conn.joinConfig.channelId === channel.id) return status();
  await leave(false).catch(() => {});
  const { joinVoiceChannel, createAudioPlayer, entersState, VoiceConnectionStatus, AudioPlayerStatus, NoSubscriberBehavior } = dv;
  conn = joinVoiceChannel({ channelId: channel.id, guildId: channel.guild.id, adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: false, selfMute: false });
  conn.on("error", (e) => setState({ lastError: "Voice: " + e.message }));
  let rejoins = 0;
  conn.on("stateChange", async (_old, now) => {
    if (now.status === VoiceConnectionStatus.Disconnected) {
      // moved or a network blip: give it a moment to reconnect by itself, then try rejoining a few times, then leave cleanly
      try { await Promise.race([entersState(conn, VoiceConnectionStatus.Signalling, 5000), entersState(conn, VoiceConnectionStatus.Connecting, 5000)]); }
      catch {
        if (conn && rejoins < 3) { rejoins++; setState({ lastError: "Voice dropped; reconnecting…" }); try { conn.rejoin(); return; } catch { /* fall through */ } }
        leave(false).catch(() => {});
      }
    } else if (now.status === VoiceConnectionStatus.Ready) { rejoins = 0; if (/reconnecting/.test(state.lastError ?? "")) setState({ lastError: null }); }
  });
  try { await entersState(conn, VoiceConnectionStatus.Ready, 20_000); }
  catch (e) { const c = conn; conn = null; try { c.destroy(); } catch { /* fine */ } throw new Error("Couldn't connect to the voice channel: " + e.message); }
  player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
  player.on("error", (e) => { setState({ lastError: "Playing: " + e.message }); current = null; nextSpeech(); });
  player.on(AudioPlayerStatus.Playing, () => { const j = current; if (j?.turn && !j.turn.heard) { j.turn.heard = true; j.turn.onFirstAudio?.(); } });
  player.on(AudioPlayerStatus.Idle, () => { current = null; nextSpeech(); });
  conn.subscribe(player);
  joinedAt = Date.now(); callHistory = [];
  const [s] = await Promise.all([sttReady(), warmUp().catch(() => {})]);
  setState({ voice: { guild: channel.guild.name, guildId: channel.guild.id, channel: channel.name, channelId: channel.id }, listening: s.ok, stt: s.ok ? null : s.why });
  listen();
  say(s.ok ? `${owner.assistant()} here. Say "${owner.assistant()}" if you need me.` : `${owner.assistant()} here. I can talk, but I can't hear the call yet.`).catch(() => {});
  devlog.log("discord", { what: "joined", listening: s.ok });
  return status();
}
export async function leave(announce = true) {
  if (!conn) { setState({ voice: null, listening: false }); return status(); }
  if (announce && player) { await say("Bye for now.").catch(() => {}); await new Promise((r) => setTimeout(r, 1800)); }
  hush();
  // who was on the call, for the call history on their profiles (only if the owner turned "Save call history" on)
  try { const ch = client?.channels?.cache?.get(conn.joinConfig.channelId); const who = ch ? [...ch.members.values()].filter((mb) => !mb.user.bot && mb.id !== OWNER_ID()).map((mb) => mb.displayName) : []; if (who.length) import("../people/comms.mjs").then((c) => c.logCall({ who, app: "discord", start: joinedAt, end: Date.now() })).catch(() => {}); } catch { /* fine */ }
  try { conn.destroy(); } catch { /* already gone */ }
  conn = null; player = null; busy.clear(); followUp.clear(); callHistory = [];
  barge.clear();
  setState({ voice: null, listening: false });
  devlog.log("discord", { what: "left" });
  return status();
}
// Everyone else left the channel: go too.
function onVoiceState(oldS) {
  if (!conn || !oldS.channelId || oldS.channelId !== conn.joinConfig.channelId) return;
  const ch = oldS.guild.channels.cache.get(conn.joinConfig.channelId);
  if (ch && ch.members.filter((m) => !m.user.bot).size === 0) leave(false).catch(() => {});
}

// ---- speaking in the channel ------------------------------------------------------------------------------
// Each sentence's voice starts downloading as soon as it's queued (the next two at most), so there's no gap between them.
export function say(text, { turn = null } = {}) {
  if (!conn || !player) return Promise.reject(new Error("I'm not in a voice channel."));
  return new Promise((resolve, reject) => { queue.push({ text: String(text), res: null, ctl: new AbortController(), turn, resolve, reject }); prefetch(); nextSpeech(); });
}
function prefetch() {
  for (const j of queue.slice(0, 2)) if (!j.res) { j.res = streamResource(j.text, { signal: j.ctl.signal }); j.res.catch(() => {}); }
}
async function nextSpeech() {
  if (current || !player || !queue.length) return;
  const job = queue.shift(); current = job; prefetch();
  try {
    if (!job.res) job.res = streamResource(job.text, { signal: job.ctl.signal });
    const { resource } = await job.res;
    if (current !== job) return;                     // stopped while the voice was loading
    player.play(resource); job.resolve(true);
  } catch (e) { if (current === job) current = null; if (!job.ctl.signal.aborted) setState({ lastError: "Voice: " + e.message }); job.reject(e); nextSpeech(); }
}
// Stop talking now: the sentence playing, the ones waiting, and the answer still being written.
function hush() {
  for (const j of queue) { j.ctl.abort(); j.resolve(false); }
  queue.length = 0;
  if (current) { current.ctl.abort(); current = null; }
  try { activeTurn?.abort(); } catch { /* fine */ } activeTurn = null;
  try { player?.stop(true); } catch { /* fine */ }
}
export const speakingNow = () => Boolean(current || queue.length);
const barge = createBargeIn({ ms: () => cfg.get().bargeInMs, enabled: () => cfg.get().bargeIn, isPlaying: speakingNow,
  onBarge: () => { hush(); devlog.log("discord", { what: "barge-in" }); } });

// ---- listening ------------------------------------------------------------------------------------------------
function isHuman(userId) {
  if (!client || userId === client.user.id) return false;
  const member = conn && client.guilds.cache.get(conn.joinConfig.guildId)?.members.cache.get(userId);
  return !(member?.user.bot || client.users.cache.get(userId)?.bot);
}
function listen() {
  if (!conn || !state.listening) return;
  const { EndBehaviorType } = dv;
  const speakingMap = conn.receiver.speaking;
  speakingMap.on("start", (userId) => {
    if (!isHuman(userId)) return;
    // talking over Dayspring for a moment (not a quick "mm-hm") stops it
    const c = cfg.get();
    barge.start(userId);
    if (busy.has(userId)) return;
    busy.add(userId);
    const hang = c.hangMs;
    const member = client.guilds.cache.get(conn.joinConfig.guildId)?.members.cache.get(userId);
    const stream = conn.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: hang } });
    decodeUtterance(stream).then((u) => (u ? heard(userId, member, u, Date.now() - hang) : null)).catch(() => {}).finally(() => busy.delete(userId));
  });
  speakingMap.on("end", (userId) => barge.end(userId));
}
const words = (t) => (String(t).match(/\S+/g) ?? []).length;
const NAMEISH = /\b(day|days|dace|they|spring|springs)\b/i;
async function heard(userId, member, u, endedAt) {
  if (!loudEnough(u.pcm)) return;
  const s = await stt();
  const c = cfg.get();
  const trace = latency.begin({ via: "discord-voice", endedAt });
  let text = "", cmd = null;
  const followingUp = (followUp.get(userId) ?? 0) > Date.now();
  try {
    // the fast model first: it's enough to hear the name, and usually enough for the request too
    text = (await s.transcribe(u.pcm, { prompt: owner.assistant(), speed: "fast" })).text ?? "";
    cmd = isNoise(text) ? null : wakeCommand(text);
    if (cmd === null && followingUp && !isNoise(text)) cmd = text.trim();
    if (cmd !== null) warm();                                               // open the AI and voice connections now
    const unsure = cmd === null && NAMEISH.test(text);                     // "they spring…": the fast model may have misheard the name
    if (unsure || (cmd && (!c.quickTranscript || words(cmd) < 3))) {
      const better = (await s.transcribe(u.pcm, { prompt: owner.assistant() })).text ?? "";
      if (!isNoise(better)) { const b = wakeCommand(better); if (b !== null) cmd = b; else if (followingUp) cmd = better.trim(); }
    }
  } catch (e) { trace.cancel(); setState({ lastError: "Speech-to-text: " + e.message }); return; }
  if (cmd === null) { trace.cancel(); return; }                         // not for Dayspring: forgotten right here, never stored
  trace.mark("stt");
  if (!cmd) { trace.cancel(); followUp.set(userId, Date.now() + c.followUpMs); say("Yes?").catch(() => {}); return; }
  followUp.delete(userId);
  const who = member?.displayName ?? "someone";
  const out = await answerVoice(cmd, { userId, who, trace });
  devlog.log("call-command", { via: "discord-voice", owner: userId === OWNER_ID(), said: cmd, reply: out });
}

// ---- answering --------------------------------------------------------------------------------------------------
// The things Dayspring does right here, without the AI: leave, stop talking.
function quick(cmd) {
  const t = cmd.toLowerCase().replace(/[.!?]/g, "").trim();
  if (/^(leave|go away|leave the (call|channel)|bye|goodbye|disconnect|you can go)\b/.test(t)) { setTimeout(() => leave(true).catch(() => {}), 300); return ""; }
  if (/^(stop|be quiet|shh+|never ?mind|cancel|that's enough|ok stop)$/.test(t)) { hush(); return ""; }
  return null;
}
const PERSONAL = /\b(my|me|mine|i|i'm|remind|schedule|calendar|plan|today|tomorrow|tonight)\b/i;
async function answerVoice(cmd, { userId, who, trace }) {
  const q = quick(cmd);
  if (q !== null) { trace.cancel(); return q; }
  hush();                                                              // a new question replaces an unfinished answer
  const isOwner = Boolean(OWNER_ID() && userId === OWNER_ID());
  const ctl = new AbortController(); activeTurn = ctl;
  const turn = { heard: false, onFirstAudio: () => { trace.mark("firstAudio"); trace.done({}); } };
  const c = cfg.get();
  if (c.ack === "mmhm" && llm.ready()) say("Mm-hm.").catch(() => {});
  let reply = "";
  if (isOwner && (CHANGES.test(cmd) || PERSONAL.test(cmd))) {
    // the owner's own things: the full assistant (schedule, reminders, changes), then spoken a sentence at a time
    try {
      const { chat: fullChat } = await import("../assistant.mjs");
      const out = await fullChat(history, cmd, { surface: "Discord voice call (spoken aloud to everyone in the call; one or two short sentences)" });
      history = out.history; reply = out.reply;
    } catch (e) { reply = e.status === 401 ? "I don't have an AI set up for that yet." : "Sorry, I couldn't get an answer just then."; }
    trace.mark("firstToken"); trace.note({ model: "full" });
    if (!ctl.signal.aborted) splitAll(reply).forEach((s, i) => { if (i === 0) trace.mark("firstSentence"); say(s, { turn }).catch(() => {}); });
  } else {
    const r = await pipeline.reply({ text: cmd, history: callHistory, who: isOwner ? "owner" : "friend", via: "discord-voice", trace, signal: ctl.signal,
      persona: c.discordPersona || "", onSentence: (s) => { if (!ctl.signal.aborted) say(s, { turn }).catch(() => {}); } });
    trace.note({ model: r.model, offline: r.offline });
    reply = r.reply;
  }
  if (activeTurn === ctl) activeTurn = null;
  callHistory = [...callHistory, { role: "user", name: who, content: cmd }, { role: "assistant", content: reply }].slice(-2 * c.memoryTurns);
  return reply;
}
// Kept for the screen and older callers: one whole answer as text.
export async function answer(cmd, { userId, who, where }) {
  const q = quick(cmd);
  if (q !== null) return q;
  if (where === "voice") { const t = latency.begin({ via: "discord-voice" }); return answerVoice(cmd, { userId, who, trace: t }); }
  const r = await chat.respond(cmd, { userId, name: who, channelId: "screen", target: { reply: async () => ({ edit: async () => {} }) } });
  return r.reply ?? "";
}

// ---- slash commands ---------------------------------------------------------------------------------------------
async function onInteraction(i) {
  if (!i.isChatInputCommand()) return;
  if (i.commandName === "dayspring") {
    const sub = i.options.getSubcommand();
    if (sub === "join") {
      const ch = i.member?.voice?.channel ?? null;
      if (!ch) return i.reply({ content: "Join a voice channel first, then run /dayspring join.", ephemeral: true });
      await i.deferReply();
      try { await join(ch); await i.editReply(`Joined **${ch.name}**. Say "${owner.assistant()}" if you need me.`); }
      catch (e) { await i.editReply(e.message); }
      return;
    }
    if (sub === "leave") { await leave(true); await i.reply({ content: "Left the voice channel.", ephemeral: true }); return; }
  }
  await chat.handleSlash(i);
}

// ---- from the Dayspring screen: "join my Discord", "leave Discord", "is your Discord bot on?" ------------------------
// → a spoken reply, or null when it isn't about your Discord bot. (The call bridge — Dayspring in YOUR call through your
//   mic — is separate: lib/callbridge.mjs.)
export async function handleCommand(text) {
  const t = String(text ?? "").toLowerCase().replace(/[.!?]/g, "").trim();
  if (!/\bdiscord\b/.test(t) || !/\b(bot|join|leave|hop in|come (in|into)|get (in|into)|jump in|disconnect|is .* (on|online|running))\b/.test(t)) return null;
  if (/\b(through|with|using) my mic\b|\bcall mode\b|\btune in\b/.test(t)) return null;   // the call bridge handles these
  if (!TOKEN()) return "Your Discord bot isn't set up yet. The guide shows how, in Help → Discord bot.";
  if (/\b(leave|disconnect|hop out|get out)\b/.test(t)) { await leave(true); return "Okay, I've left your Discord channel."; }
  if (/\b(is|are)\b.*\b(on|online|running)\b/.test(t)) return state.status === "online" ? (state.voice ? `Yes, I'm in ${state.voice.channel}.` : "Your Discord bot is online, not in a voice channel.") : `Your Discord bot is ${state.status}.${state.lastError ? " " + state.lastError : ""}`;
  try { await join(); return state.listening ? `I'm in ${state.voice.channel} now. Say my name in the call if you need me.` : `I'm in ${state.voice.channel}, but I can't hear the call yet: ${state.stt}`; }
  catch (e) { return e.message; }
}

// For Tune in's "who answers" rule: is the bot in a voice channel right now (and so hearing the same call)?
export const inVoice = () => Boolean(conn && state.voice);
export const _chat = chat;
