// Your Discord bot's endpoints (the bot itself: lib/discord/bot.mjs).
//   GET  /discord/status    online?, which servers, which voice channel, can it hear, last error
//   POST /discord/start     (re)connect with the token in .env (the Settings page calls this after saving it)
//   POST /discord/stop
//   POST /discord/join      join the voice channel the owner is in
//   POST /discord/leave
//   POST /discord/say       { text } speak it in the voice channel
import * as bot from "./discord/bot.mjs";

export async function handle(req, res, { m, p, send, readJSON }) {
  if (!p.startsWith("/discord/")) return false;
  try {
    if (m === "GET" && p === "/discord/status") return send(res, 200, bot.status()), true;
    if (m === "POST" && p === "/discord/start") return send(res, 200, await bot.restart()), true;
    if (m === "POST" && p === "/discord/stop") return send(res, 200, await bot.stop()), true;
    if (m === "POST" && p === "/discord/join") return send(res, 200, await bot.join()), true;
    if (m === "POST" && p === "/discord/leave") return send(res, 200, await bot.leave(true)), true;
    if (m === "POST" && p === "/discord/say") {
      const { text } = await readJSON(req);
      if (!String(text ?? "").trim()) return send(res, 400, { error: "text is required" }), true;
      await bot.say(String(text).slice(0, 600));
      return send(res, 200, { ok: true }), true;
    }
  } catch (e) { return send(res, 409, { error: e.message, status: bot.status() }), true; }
  return false;
}

// Called once when the server starts: connects the bot if a token is set (never throws).
export function init() { bot.start().catch(() => {}); }
