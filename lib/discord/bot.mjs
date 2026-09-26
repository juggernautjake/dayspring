// Dayspring as a Discord bot (optional; on when DISCORD_BOT_TOKEN is set in .env / Settings → Discord).
//   Voice: joins the voice channel the owner is in ("/dayspring join", or "Dayspring, join my Discord" on the screen),
//     says hello so everyone knows it's there, listens for its name, answers out loud in the channel.
//   Text: answers when @mentioned, or in the one channel set as DISCORD_TEXT_CHANNEL_ID when a message starts with its name.
// Who can ask what: the owner (DISCORD_OWNER_ID) gets the full assistant (schedule, reminders, everything). Anyone else
//   gets a friendly general answer with no access to the owner's schedule, files or personal details.
// Privacy: call audio is turned into text only to listen for the name. Nothing anyone says is saved; only a request made
//   to Dayspring (after its name) and its reply are logged (devlog "call-command"), without the words of anyone else.
// Bots can join SERVER voice channels only (Discord doesn't allow bots in DM or group-DM calls).
import { broadcast } from "../announcer.mjs";
import * as devlog from "../devlog.mjs";
import * as owner from "../owner.mjs";
import * as llm from "../llm.mjs";
import { wakeCommand, isNoise } from "./wake.mjs";
import { decodeUtterance, loudEnough, speechResource } from "./audio.mjs";

const TOKEN = () => process.env.DISCORD_BOT_TOKEN || "";
const OWNER_ID = () => process.env.DISCORD_OWNER_ID || "";
const GUILD_ID = () => process.env.DISCORD_GUILD_ID || "";
const TEXT_CHANNEL = () => process.env.DISCORD_TEXT_CHANNEL_ID || "";

let djs = null, dv = null;             // discord.js and @discordjs/voice, loaded only when the bot is used
let client = null;
let state = { enabled: false, status: "off", user: null, guilds: [], voice: null, lastError: null, listening: false, stt: null };
let conn = null, player = null, joinedAt = 0;
const speakQueue = [];
let speaking = false;
const busy = new Set();                // users whose utterance is being transcribed right now
const followUp = new Map();            // userId → until (ms): they said just the name, the next thing they say is the request
let history = [];                      // the owner's conversation with Dayspring over Discord (not stored on disk)

export function status() {
  return { ...state, configured: Boolean(TOKEN()), ownerSet: Boolean(OWNER_ID()), textChannel: TEXT_CHANNEL() || null };
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
    setState({ status: "online", user: c.user.tag, guilds: c.guilds.cache.map((g) => ({ id: g.id, name: g.name })) });
    await registerCommands().catch((e) => setState({ lastError: "Couldn't add the /dayspring command: " + e.message }));
    devlog.log("discord", { what: "online", guilds: c.guilds.cache.size });
  });
  client.on(Events.GuildCreate, () => { setState({ guilds: client.guilds.cache.map((g) => ({ id: g.id, name: g.name })) }); registerCommands().catch(() => {}); });
  client.on(Events.InteractionCreate, (i) => onInteraction(i).catch((e) => devlog.log("error", { where: "discord-interaction", error: e.message })));
  client.on(Events.MessageCreate, (m) => onMessage(m).catch((e) => devlog.log("error", { where: "discord-message", error: e.message })));
  client.on(Events.VoiceStateUpdate, onVoiceState);
  client.on(Events.Error, (e) => setState({ lastError: e.message }));
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
  client = null; setState({ enabled: false, status: "off", user: null, guilds: [] });
  return status();
}
export async function restart() { await stop(); return start(); }

async function registerCommands() {
  if (!client?.application) return;
  const cmd = {
    name: "dayspring", description: `Talk to ${owner.assistant()}`,
    options: [
      { type: 1, name: "join", description: "Join the voice channel you're in" },
      { type: 1, name: "leave", description: "Leave the voice channel" },
      { type: 1, name: "say", description: "Ask something (answers here)", options: [{ type: 3, name: "text", description: "What to ask", required: true }] },
    ],
  };
  // per server = shows up right away (global commands can take up to an hour)
  const guilds = GUILD_ID() ? [client.guilds.cache.get(GUILD_ID())].filter(Boolean) : [...client.guilds.cache.values()];
  for (const g of guilds) await g.commands.set([cmd]);
}

// ---- joining a voice channel ------------------------------------------------------------------------------
function voiceChannelOf(userId) {
  for (const g of client?.guilds.cache.values() ?? []) {
    const vs = g.voiceStates.cache.get(userId);
    if (vs?.channel) return vs.channel;
  }
  return null;
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
  conn.on("stateChange", async (_old, now) => {
    if (now.status === VoiceConnectionStatus.Disconnected) {
      // moved or a network blip: give it a moment to reconnect, otherwise leave cleanly
      try { await Promise.race([entersState(conn, VoiceConnectionStatus.Signalling, 5000), entersState(conn, VoiceConnectionStatus.Connecting, 5000)]); }
      catch { leave(false).catch(() => {}); }
    }
  });
  try { await entersState(conn, VoiceConnectionStatus.Ready, 20_000); }
  catch (e) { const c = conn; conn = null; try { c.destroy(); } catch { /* fine */ } throw new Error("Couldn't connect to the voice channel: " + e.message); }
  player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
  player.on("error", (e) => { setState({ lastError: "Playing: " + e.message }); speaking = false; nextSpeech(); });
  player.on(AudioPlayerStatus.Idle, () => { speaking = false; nextSpeech(); });
  conn.subscribe(player);
  joinedAt = Date.now();
  const s = await sttReady();
  setState({ voice: { guild: channel.guild.name, channel: channel.name, channelId: channel.id }, listening: s.ok, stt: s.ok ? null : s.why });
  listen();
  say(s.ok ? `${owner.assistant()} here. Say "${owner.assistant()}" if you need me.` : `${owner.assistant()} here. I can talk, but I can't hear the call yet.`);
  devlog.log("discord", { what: "joined", listening: s.ok });
  return status();
}
export async function leave(announce = true) {
  if (!conn) { setState({ voice: null, listening: false }); return status(); }
  if (announce && player) { await say("Bye for now.").catch(() => {}); await new Promise((r) => setTimeout(r, 1800)); }
  try { conn.destroy(); } catch { /* already gone */ }
  conn = null; player = null; speakQueue.length = 0; speaking = false; busy.clear(); followUp.clear();
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
export function say(text) {
  if (!conn || !player) return Promise.reject(new Error("I'm not in a voice channel."));
  return new Promise((resolve, reject) => { speakQueue.push({ text: String(text), resolve, reject }); nextSpeech(); });
}
async function nextSpeech() {
  if (speaking || !player || !speakQueue.length) return;
  speaking = true;
  const job = speakQueue.shift();
  try { const { resource } = await speechResource(job.text); player.play(resource); job.resolve(true); }
  catch (e) { speaking = false; setState({ lastError: "Voice: " + e.message }); job.reject(e); nextSpeech(); }
}

// ---- listening ------------------------------------------------------------------------------------------------
function listen() {
  if (!conn || !state.listening) return;
  const { EndBehaviorType } = dv;
  conn.receiver.speaking.on("start", (userId) => {
    if (busy.has(userId) || userId === client.user.id) return;
    const member = conn && client.guilds.cache.get(conn.joinConfig.guildId)?.members.cache.get(userId);
    if (member?.user.bot || client.users.cache.get(userId)?.bot) return;
    busy.add(userId);
    const stream = conn.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 900 } });
    decodeUtterance(stream).then((u) => (u ? heard(userId, member, u) : null)).catch(() => {}).finally(() => busy.delete(userId));
  });
}
async function heard(userId, member, u) {
  if (!loudEnough(u.pcm)) return;
  const s = await stt();
  let text = "";
  try { text = (await s.transcribe(u.pcm, { prompt: owner.assistant() })).text ?? ""; } catch (e) { setState({ lastError: "Speech-to-text: " + e.message }); return; }
  if (isNoise(text)) return;
  let cmd = wakeCommand(text);
  if (cmd === null && (followUp.get(userId) ?? 0) > Date.now()) cmd = text.trim();   // they said the name a moment ago
  if (cmd === null) return;                       // not for Dayspring: forgotten right here, never stored
  if (!cmd) { followUp.set(userId, Date.now() + 9000); say("Yes?").catch(() => {}); return; }
  followUp.delete(userId);
  const who = member?.displayName ?? "someone";
  const reply = await answer(cmd, { userId, who, where: "voice" });
  devlog.log("call-command", { via: "discord-voice", owner: userId === OWNER_ID(), said: cmd, reply });
  if (reply) say(reply).catch(() => {});
}

// ---- answering --------------------------------------------------------------------------------------------------
// The things Dayspring does right here, without the AI: leave, stop talking.
function quick(cmd) {
  const t = cmd.toLowerCase().replace(/[.!?]/g, "").trim();
  if (/^(leave|go away|leave the (call|channel)|bye|goodbye|disconnect|you can go)\b/.test(t)) { setTimeout(() => leave(true).catch(() => {}), 300); return ""; }
  if (/^(stop|be quiet|shh+|never ?mind|cancel)$/.test(t)) { speakQueue.length = 0; try { player?.stop(true); } catch { /* fine */ } return ""; }
  return null;
}
export async function answer(cmd, { userId, who, where }) {
  const q = quick(cmd);
  if (q !== null) return q;
  const isOwner = OWNER_ID() && userId === OWNER_ID();
  if (isOwner) {
    try {
      const { chat } = await import("../assistant.mjs");
      const out = await chat(history, cmd, { surface: where === "voice" ? "Discord voice call (spoken aloud to everyone in the call; one or two short sentences)" : "Discord text chat" });
      history = out.history;
      return out.reply;
    } catch (e) { return e.status === 401 ? "I don't have an AI set up for that yet." : "Sorry, I couldn't get an answer just then."; }
  }
  // someone else: friendly, general, nothing personal
  if (!llm.ready()) return `Sorry, I only take requests from ${owner.name()} right now.`;
  try {
    return await llm.complete({
      system: `You are ${owner.assistant()}, ${owner.name()}'s friendly assistant, in a Discord ${where === "voice" ? "voice call, speaking aloud — one or two short sentences" : "text chat — keep it under 400 characters"}. ` +
        `You are answering ${who}, a friend of ${owner.name()}'s. You have NO access to ${owner.name()}'s schedule, files, messages or personal details, and you must not guess them. ` +
        `If asked to change or reveal anything of ${owner.name()}'s, say kindly that only ${owner.name()} can ask for that. Be warm and a little playful.`,
      prompt: cmd, maxTokens: 220, timeoutMs: 30_000,
    });
  } catch { return "Sorry, I couldn't get an answer just then."; }
}

// ---- slash commands and text chat ---------------------------------------------------------------------------------
async function onInteraction(i) {
  if (!i.isChatInputCommand() || i.commandName !== "dayspring") return;
  const sub = i.options.getSubcommand();
  if (sub === "join") {
    const ch = i.member?.voice?.channel ?? null;
    if (!ch) return i.reply({ content: "Join a voice channel first, then run /dayspring join.", ephemeral: true });
    await i.deferReply();
    try { await join(ch); await i.editReply(`Joined **${ch.name}**. Say "${owner.assistant()}" if you need me.`); }
    catch (e) { await i.editReply(e.message); }
  } else if (sub === "leave") {
    await leave(true); await i.reply({ content: "Left the voice channel.", ephemeral: true });
  } else if (sub === "say") {
    await i.deferReply();
    const text = i.options.getString("text", true);
    const reply = await answer(text, { userId: i.user.id, who: i.member?.displayName ?? i.user.username, where: "text" });
    devlog.log("call-command", { via: "discord-slash", owner: i.user.id === OWNER_ID(), said: text, reply });
    await i.editReply((reply || "Okay.").slice(0, 1900));
  }
}
async function onMessage(m) {
  if (m.author.bot || !client?.user) return;
  const mentioned = m.mentions.users.has(client.user.id);
  const inChannel = TEXT_CHANNEL() && m.channelId === TEXT_CHANNEL();
  const dmFromOwner = !m.guild && OWNER_ID() && m.author.id === OWNER_ID();
  let cmd = null;
  if (mentioned) cmd = m.content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
  else if (dmFromOwner) cmd = m.content.trim();
  else if (inChannel) cmd = wakeCommand(m.content);
  if (cmd === null) return;                                  // not for Dayspring
  if (!cmd) return m.reply("Yes? What can I do?");
  await m.channel.sendTyping().catch(() => {});
  const reply = await answer(cmd, { userId: m.author.id, who: m.member?.displayName ?? m.author.username, where: "text" });
  devlog.log("call-command", { via: "discord-text", owner: m.author.id === OWNER_ID(), said: cmd, reply });
  if (reply) await m.reply(reply.slice(0, 1900));
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
