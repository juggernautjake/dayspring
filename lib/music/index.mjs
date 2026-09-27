// Playing what the owner asks for on Spotify, and making sure it's what he asked for.
//   request(opts, player)  resolve → (not sure? offer the top 3) → play → read what's actually playing → say what it is
//   "not that" / "try another" → the next candidate, remembered for next time (prefs.mjs); "number 2" after a question
// Two players share this: the Web API on the Dayspring screen (apiPlayer) and the web player in the media window
// (windowPlayer). media.spotify() picks which and calls request(). handle() is the no-AI side: follow-ups, "what's
// playing", "save this song", "add this to my X playlist", "queue X", and play requests when there's no AI.
import * as spotify from "../spotify-api.mjs";
import { parseBoth } from "./parse.mjs";
import { resolve, describe, optionLabel } from "./resolve.mjs";
import * as api from "./webapi.mjs";
import { webSource } from "./webplayer.mjs";
import * as prefs from "./prefs.mjs";
import { getSource } from "./sources.mjs";
export { registerSource, unregisterSource, sources } from "./sources.mjs";
import { norm, sim, covers } from "./text.mjs";

export { parseRequest, parseBoth } from "./parse.mjs";
export { resolve } from "./resolve.mjs";

const FRESH_MS = 20 * 60_000, ASK_MS = 3 * 60_000;
const VERIFY_MS = () => Number(process.env.DAYSPRING_MUSIC_VERIFY_MS ?? 700);
const VERIFY_TRIES = () => Number(process.env.DAYSPRING_MUSIC_VERIFY_TRIES ?? 6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let session = null;          // { req, res, index, at, mode, asking }
let suggestion = null;       // the "Did you mean…?" list for the screen, picked up by the chat reply
export const lastSession = () => session;
export function resetSession() { session = null; suggestion = null; }
export function takeSuggest() { const s = suggestion; suggestion = null; return s && Date.now() - s.at < 60_000 ? s.list : null; }

// ---- the two players --------------------------------------------------------------------------------------------------
// On the Dayspring screen (the Web Playback SDK device) through the Web API.
export function apiPlayer(device) {
  return {
    mode: "api", source: api.source,
    async start(c, req) {
      const want = Boolean(req.shuffle || c.shuffle || ["genre", "mood", "radio", "vague", "liked"].includes(req.kind));
      await spotify.shuffle(want, device).catch(() => {});
      const body = { ...c.play };
      if (want && body.context_uri?.includes(":playlist:") && c.total > 1) body.offset = { position: Math.floor(Math.random() * Math.min(c.total, 50)) };
      try { await spotify.play(device, body); }
      catch (e) {
        // a 404 means "no such device" OR "can't play that": only the first is the screen going away
        if (e.status === 404 && e.reason !== "NO_ACTIVE_DEVICE") {
          const devs = await spotify.devices().catch(() => null);
          if (devs && devs.some((d) => d.id === device)) { e.unplayable = true; }
        }
        throw e;
      }
      await spotify.shuffle(want, device).catch(() => {});
      return null;
    },
    // read what Spotify says is playing until it's the chosen thing (it takes a moment to switch)
    async verify(c) {
      let now = null;
      for (let i = 0; i < VERIFY_TRIES(); i++) {
        if (i) await sleep(VERIFY_MS());
        now = await api.current().catch(() => null);
        const r = matches(c, now, device);
        if (r === true) return { ok: true, now };
        if (r === false && i >= 2) return { ok: false, now };
      }
      return { ok: now?.uri ? matches(c, now, device) ?? null : null, now };
    },
  };
}
// Is what's playing (the Web API's player state) the chosen candidate?  true | false | null (can't tell)
export function matches(c, now, device) {
  if (!now?.uri) return null;
  if (device && now.device && now.device !== device) return false;
  if (c.play?.context_uri && now.context === c.play.context_uri) return true;
  if (c.play?.uris?.includes(now.uri)) return true;
  if (c.type === "artist" && now.artists?.some((a) => a.id === c.id || norm(a.name) === norm(c.name))) return true;
  if (c.type === "liked" || c.type === "collection") return true;
  return false;
}

// In the media window's web player (browser.mjs hands in its page readers and its play function).
export function windowPlayer(win) {
  return {
    mode: "web", source: webSource(win),
    async start(c, req) {
      const shuffle = Boolean(req.shuffle || c.shuffle);
      if (c.play?.liked) return win.play({ type: "liked", shuffle: true });
      return win.play({ url: c.url ?? uriToUrl(c.uri), type: c.type, shuffle, query: c.name });
    },
    async verify(c, st) {
      const now = st?.title ? st : await win.now?.().catch(() => null);
      if (!now?.title) return { ok: null, now };
      let ok = null;
      if (c.type === "track") ok = sim(c.name, now.title) >= 0.6;
      else if (c.type === "artist") ok = covers(now.artist, c.name) >= 1;
      else if (c.tracks?.length || c.sample?.length) ok = (c.tracks ?? []).some((t) => sim(t.name, now.title) >= 0.8) || (c.sample ?? []).some((a) => covers(now.artist, a) >= 1);
      return { ok, now: { name: now.title, by: now.artist } };
    },
  };
}
const uriToUrl = (uri) => { const m = /^spotify:(\w+):(\w+)$/.exec(uri ?? ""); return m ? `https://open.spotify.com/${m[1]}/${m[2]}` : null; };

// ---- asking for music ---------------------------------------------------------------------------------------------------
// opts: { request (his words), query, type (the AI's reading), shuffle, url, next: true ("not that"), choice: n }
export async function request(opts, player) {
  if (opts.next) return another(player);
  if (opts.choice != null) return choose(opts.choice, player);
  const direct = spotify.toUri(opts.url) ?? spotify.toUri(opts.query);
  const req = direct ? parseBoth(direct, {}) : parseBoth(opts.request ?? null, { type: opts.type, query: opts.query ?? "", shuffle: opts.shuffle });
  if (opts.shuffle) req.shuffle = true;
  if (direct && opts.url && player.mode === "web") return startDirect(opts, player);
  const res = await resolve(req, player.source, { prefs });
  if (!res.choice) throw new Error(res.error ?? `Nothing on Spotify matched "${req.raw}".`);
  session = { req, res, index: 0, at: Date.now(), mode: player.mode, asking: false };
  if (res.clarify) {
    session.asking = true;
    const opts3 = res.options.map((c, i) => ({ n: i + 1, label: optionLabel(c) }));
    const list = { prompt: "Did you mean one of these?", options: opts3, none: "None of these" };
    suggestion = { at: Date.now(), list };
    const say = `I'm not sure which one you mean. ${opts3.map((o) => `${o.n}, ${o.label.replace(/ \((\w+)\)$/, ", the $1")}`).join(". ")}. Which one?`;
    return { clarify: true, options: opts3, say, suggest: list, title: "", artist: "", playing: false };
  }
  return startAt(0, player);
}
// a curated track link in the media window: straight to it, as before
async function startDirect(opts, player) {
  const r = await player.start({ type: "track", url: opts.url, name: opts.query ?? "", play: {} }, { shuffle: opts.shuffle });
  return { ...r, say: r?.title ? `Playing ${r.title}${r.artist ? ` by ${r.artist}` : ""}.` : "" };
}

async function startAt(i, player, { tries = 3 } = {}) {
  const { req, res } = session;
  let lastErr = null;
  for (let k = i; k < res.candidates.length && k < i + tries; k++) {
    const c = res.candidates[k];
    // a file on his computer, Google Drive…: that source plays it (lib/music/sources.mjs)
    const other = c.source && c.source !== "spotify" ? getSource(c.source) : null;
    const p = other ? { start: (x, r) => other.play(x, r), verify: other.verify ? (x, s) => other.verify(x, s) : async () => ({ ok: null, now: null }) } : player;
    let st;
    try { st = await p.start(c, req); }
    catch (e) { if (e.unplayable) { lastErr = e; prefs.reject(req.key, c.uri ?? c.id, c.name); continue; } throw e; }
    let v = await p.verify(c, st);
    if (v.ok === false) { st = await p.start(c, req).catch(() => st); v = await p.verify(c, st); }   // once more: Spotify sometimes keeps the old song
    session.index = k; session.at = Date.now(); session.asking = false; session.verified = v;
    if (!["url", "liked", "vague"].includes(req.kind)) prefs.keep(req.key, c.uri ?? c.id, c.name);
    const wrong = v.ok === false && v.now?.name ? ` ${other ? "It" : "Spotify"} is playing ${v.now.name}${v.now.by ? ` by ${v.now.by}` : ""} instead, though. Say "try another" if that's not right.` : "";
    const said = describe(c, req), fromWhere = other?.label ? said.replace(/\.$/, ` from ${other.label}.`) : said;
    const say = `${c.note ? c.note + " " : ""}${fromWhere}${wrong}`;
    const title = c.type === "mix" ? c.name.replace(/^./, (x) => x.toUpperCase()) : c.name;
    return { title, artist: c.by ?? "", art: c.art ?? "", say, playing: true, verified: v.ok, source: c.source ?? "spotify", picked: { type: c.type, uri: c.uri ?? c.id, name: c.name, source: c.source ?? "spotify", why: c.why ?? [] },
      nowPlaying: v.now ? { title: v.now.name ?? v.now.title ?? "", artist: v.now.by ?? v.now.artist ?? "" } : null,
      understood: { kind: req.kind, query: req.query, genre: req.genre?.name ?? null },
      alternatives: res.candidates.slice(k + 1, k + 3).map(optionLabel), ...(st && typeof st === "object" ? { window: st } : {}) };
  }
  throw lastErr ?? new Error("That couldn't be played on Spotify.");
}

// "not that": remember it was wrong, and play the next candidate
export async function another(player) {
  if (!session || Date.now() - session.at > FRESH_MS) throw new Error("I haven't picked any music lately. Tell me what you'd like to hear.");
  const { req, res } = session;
  const cur = res.candidates[session.index];
  if (cur && !session.asking) prefs.reject(req.key, cur.uri, cur.name);
  const start = session.asking ? 0 : session.index + 1;
  if (start >= res.candidates.length) {
    return { playing: false, exhausted: true, title: "", artist: "", say: `That was the last good match I found for "${req.raw || req.query}". Try saying it another way, like an artist's name or "a ${req.genre?.name ?? "worship"} playlist".` };
  }
  const r = await startAt(start, player);
  return { ...r, say: r.say.replace(/^Playing/, "Okay, playing") };
}
// "number 2" after "Did you mean…?"
export async function choose(n, player) {
  if (!session?.asking || Date.now() - session.at > ASK_MS) throw new Error("I didn't offer any choices just now. Tell me what you'd like to hear.");
  const c = session.res.options[n - 1];
  if (!c) throw new Error(`There were only ${session.res.options.length} choices.`);
  const i = session.res.candidates.indexOf(c);
  return startAt(i, player, { tries: 1 });
}

// ---- no-AI commands and follow-ups ------------------------------------------------------------------------------------
const NOT_THAT = /^(?:no|nope|nah|hmm|ugh|oh)?\s*(?:not (?:that|this)(?: one| song| playlist| music| artist| album| mix)?(?: please)?|(?:thats|that is|this is|this isnt|that isnt|thats not|this is not|that is not) (?:not )?(?:what i (?:wanted|asked for|meant|want|said)|right|it|the right (?:one|song|music|playlist))|wrong (?:one|song|playlist|music|artist|album|thing)|try (?:another|a different|again|something else)(?: one| playlist| song| mix)?|(?:skip|change|switch) (?:this|the|that) (?:playlist|album|mix|station)|(?:a )?different (?:one|playlist|song|mix|music)|something else|next (?:playlist|option)|not what i (?:wanted|asked for|meant)|i (?:didnt|did not) (?:want|ask for) (?:that|this))$/;
const NONE = /^(?:none|none of (?:these|those|them)|neither|none of the above|not (?:those|these|any of (?:these|those|them)))$/;
const PICK = /^(?:number |option |choice |the |play (?:the )?|pick |go with (?:the )?)?(1|2|3|one|two|three|first|second|third|last)(?:st|nd|rd)?(?: one| option| choice)?(?: please)?$/;
const WHAT = /^(?:what|whats|what is|which) (?:song|track|music|this song|this|song is this|is (?:this|playing|this song|on)|is this song|am i listening to|playing)(?: now| right now| called)?$|^(?:who|who is|whos) (?:sings|singing|this is|is singing) (?:this|that)?(?: song)?$|^(?:whats|what is) (?:the name of )?(?:this|that) song$|^(?:name|title) of (?:this|the) song$|^(?:what|which) (?:song|playlist|album) (?:is (?:this|that|playing|on)|are we listening to)$/;
const SAVE = /^(?:save|like|heart|favorite|favourite|love) (?:this|that|the current|this current)(?: song| track| one)?(?: to (?:my )?(?:library|liked songs|likes|favorites))?$|^(?:add|put) (?:this|that)(?: song| track)? (?:to|in) (?:my )?(?:liked songs|likes|library|favorites)$|^i (?:like|love) this song$/;
const ADD = /^(?:add|put|save) (?:this|that|the current)(?: song| track| one)? (?:to|in|on|into) (?:my |the )?(.+?)(?: playlist)?$/;
const QUEUE = /^(?:queue(?: up)?|add) (.+?) (?:to|in|on) (?:the |my )?(?:queue|up next)$|^queue(?: up)? (.+)$|^play (.+?) (?:next|after this(?: song| one)?)$/;
const clean = (t) => norm(t).replace(/^(?:hey |ok |okay )?(?:dayspring )?/, "").replace(/\b(?:please|can you|could you|would you|for me|thanks)\b/g, " ").replace(/\s+/g, " ").trim();

// deps: { media, apiReady(), device(), windowNow(), isSpotify() }. Returns { reply, suggest?, listen? } or null.
export async function handle(text, deps) {
  const q = clean(text);
  if (!q) return null;
  const fresh = session && Date.now() - session.at <= FRESH_MS;
  try {
    // answers to "Did you mean…?"
    if (session?.asking && Date.now() - session.at <= ASK_MS) {
      if (NONE.test(q) || /^no(?:pe)?$/.test(q)) { session.asking = false; suggestion = null; return { reply: "Okay. Tell me another way to say it, like the artist's name or the whole song title." }; }
      let n = null, m;
      if ((m = PICK.exec(q))) n = { one: 1, two: 2, three: 3, first: 1, second: 2, third: 3, last: session.res.options.length }[m[1]] ?? Number(m[1]);
      else { const best = session.res.options.map((c, i) => ({ i, s: Math.max(sim(q, c.name), sim(q, `${c.name} ${c.by ?? ""}`)) })).sort((a, b) => b.s - a.s)[0]; if (best?.s >= 0.7) n = best.i + 1; }
      if (n) { const r = await deps.media.spotify({ choice: n }); return { reply: r.say || `Playing ${r.title}.`, played: r }; }
    }
    // a vague "something else" only right after the music started; "not that" / "try another" for 20 minutes
    const generic = /^(?:something else|(?:a )?different (?:one|music)|try again)$/.test(q);
    if (fresh && NOT_THAT.test(q) && (!generic || Date.now() - session.at < 3 * 60_000) && (deps.isSpotify?.() ?? true)) { const r = await deps.media.spotify({ next: true }); return { reply: r.say || "Okay, trying another.", played: r }; }
    const spotifyOn = deps.isSpotify?.() ?? false;
    if (WHAT.test(q) && spotifyOn) return { reply: await whatsPlaying(deps) };
    if (SAVE.test(q) && spotifyOn) return { reply: await saveCurrent() };
    let m;
    if ((m = ADD.exec(q)) && spotifyOn && !/\b(?:queue|up next|liked songs|likes|library|favorites)\b/.test(m[1])) return { reply: await addCurrentTo(m[1]) };
    if ((m = QUEUE.exec(q)) && deps.apiReady?.() && spotifyOn && !/\b(?:videos?|youtube|lessons?|episodes?|timers?)\b/.test(q)) return { reply: await queueSong(m[1] ?? m[2] ?? m[3], deps.device?.()) };
  } catch (e) { return { reply: e.message }; }
  return null;
}

// Does this request name something particular (so the owner's curated "something soothing" tracks shouldn't take it)?
export function namesSomething(text) {
  if (/\bspotify\b/i.test(text)) return true;
  const r = parseBoth(text, {});
  if (["track", "artist", "album", "playlist", "myplaylist", "radio", "lyrics", "liked", "url"].includes(r.kind)) return true;
  if (r.kind === "genre") return !["ambient", "hymns"].includes(r.genre.id);
  if (r.kind === "mood") return r.moods.some((m) => !["calm", "background"].includes(m));
  return false;
}

// A play request with no AI brain (localMedia): "play christian fold music", "play Gratitude by Hollow Pines".
export async function handlePlay(text, deps) {
  const req = parseBoth(text, {});
  if (req.kind === "any" && !req.query) return null;
  const r = await deps.media.spotify({ request: text, query: req.query, type: req.kind, shuffle: req.shuffle });
  if (r.clarify) return { reply: r.say, suggest: r.suggest, listen: true, played: r };
  return { reply: r.say || (r.title ? `Playing ${r.title}${r.artist ? ` by ${r.artist}` : ""}.` : "Playing."), played: r };
}

// ---- controls ---------------------------------------------------------------------------------------------------------
export async function whatsPlaying(deps = {}) {
  if (spotify.ready()) {
    const now = await api.current().catch(() => null);
    if (now?.name) {
      const c = session && session.res.candidates[session.index];
      const from = c && (c.type === "playlist" || c.type === "album" || c.type === "mix") && matches(c, now) ? `, from ${c.type === "mix" ? "the " + c.name : c.name}` : "";
      return `This is ${now.name}${now.by ? ` by ${now.by}` : ""}${from}.${now.playing ? "" : " It's paused."}`;
    }
  }
  const w = await deps.windowNow?.().catch(() => null);
  if (w?.title) return `This is ${w.title}${w.artist ? ` by ${w.artist}` : ""}.`;
  const n = deps.media?.nowPlaying?.();
  return n?.title ? `This is ${n.title}${n.artist ? ` by ${n.artist}` : ""}.` : "Nothing is playing right now.";
}
async function currentOrThrow() {
  if (!spotify.ready()) throw new Error("Saving songs needs Spotify connected inside Dayspring (Settings → Features & apps → Music).");
  const now = await api.current();
  if (!now?.uri) throw new Error("Nothing is playing on Spotify right now.");
  return now;
}
export async function saveCurrent() {
  const now = await currentOrThrow();
  await spotify.like(now.uri);
  return `Saved ${now.name} to your Liked Songs.`;
}
export async function addCurrentTo(name) {
  const now = await currentOrThrow();
  const all = await spotify.myPlaylists();
  const want = String(name).replace(/\bplaylist\b/, "").trim();
  const pl = all.filter((p) => p.mine !== false).map((p) => ({ p, s: Math.max(sim(want, p.name), norm(p.name) === norm(want) ? 1 : 0) })).sort((a, b) => b.s - a.s)[0];
  if (!pl || pl.s < 0.5) throw new Error(`I couldn't find a playlist of yours called "${want}".`);
  await spotify.addToPlaylist(pl.p.id, now.uri);
  return `Added ${now.name} to ${pl.p.name}.`;
}
export async function queueSong(text, device) {
  if (!device) throw new Error("Queueing needs Spotify playing on the Dayspring screen.");
  const req = parseBoth(text, { type: "track" });
  const res = await resolve({ ...req, kind: ["track", "lyrics"].includes(req.kind) ? req.kind : "track", title: req.title ?? req.query }, api.source, {});
  const c = res.candidates.find((x) => x.type === "track");
  if (!c) throw new Error(`Nothing on Spotify matched "${text}".`);
  if (res.confidence < 0.4) throw new Error(`I couldn't find "${text}" for sure. The closest is ${c.name} by ${c.by}. Say "queue ${c.name} by ${c.by}" if that's it.`);
  await spotify.addToQueue(c.uri, device);
  return `Added ${c.name} by ${c.by} to the queue.`;
}
