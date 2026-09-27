// The music-request resolver: from a parsed request (parse.mjs) to a ranked list of things to play, each checked
// before it is chosen. The same scoring serves both ways Dayspring plays Spotify:
//   - the Web API (webapi.mjs: search across tracks, artists, albums and playlists, artist genres, playlist contents)
//   - the web player in the media window (webplayer.mjs: the search page read off the screen), with less to go on
// resolve(req, source, { prefs }) → { kind, candidates, choice, confidence, clarify, options, error }
// A candidate: { type, uri, url, name, by, description, artists, score, why, play: { context_uri } | { uris }, verified }
import { norm, words, sim, covers, content, wordMatch, titleCase, listNames } from "./text.mjs";
import { genreFits, MOODS, GENRES } from "./genres.mjs";
import { parseRequest } from "./parse.mjs";
import { sources, getSource } from "./sources.mjs";

export const CLARIFY_BELOW = 0.5;       // under this, offer the top 3 instead of guessing
const GENERIC = /\b(today'?s top hits|top hits|hot hits|viral (hits|50)|top 50|top 100|global top|charts?|trending|pop rising|mega hit mix|all out \d0s|hits of (the )?(\d0s|20\d\d)|biggest hits|pop hits|pop music|hit list|songs of the (year|summer)|new music friday|most streamed|tiktok|summer hits|party hits)\b/;
const OTHER_STYLE = ["pop", "rap", "hip hop", "trap", "edm", "dance", "metal", "reggaeton", "k pop", "drill", "house", "techno", "latin", "r and b"];
const VERSION = /\b(karaoke|instrumental version|backing track|tribute|cover|made famous|in the style of|8 bit|lullaby version|piano version|remix|sped up|slowed|nightcore|live)\b/;

const popBonus = (c) => {
  if (Number.isFinite(c.popularity)) return c.popularity / 100;
  if (Number.isFinite(c.followers)) return Math.min(1, Math.log10(c.followers + 1) / 7);
  return 0.3;
};
const textOf = (c) => `${c.name ?? ""} ${c.description ?? ""}`;
const excluded = (c, req) => req.exclude?.some((x) => covers(`${c.name} ${c.by ?? ""} ${c.description ?? ""} ${(c.artists ?? []).map((a) => a.name ?? a).join(" ")}`, x) >= 1);
const requiredOk = (c, req) => !req.only?.length || req.only.some((x) => covers(`${c.name} ${c.by ?? ""} ${c.description ?? ""} ${(c.artists ?? []).map((a) => a.name ?? a).join(" ")}`, x) >= 1);

// ---- scoring one candidate -----------------------------------------------------------------------------------------
export function scoreTrack(c, req) {
  const title = req.title ?? req.query, artist = req.artist;
  let s;
  if (artist) s = 0.62 * sim(title, c.name) + 0.38 * Math.max(sim(artist, c.by), ...(c.artists ?? []).map((a) => sim(artist, a.name ?? a)));
  else s = Math.max(sim(title, c.name), 0.95 * sim(title, `${c.name} ${c.by}`));
  if (VERSION.test(norm(`${c.name} ${c.album ?? ""} ${c.by}`)) && !VERSION.test(norm(req.raw))) s -= 0.15;
  return s + 0.08 * popBonus(c);
}
export function scoreArtist(c, req) { return sim(req.artist ?? req.query, c.name) + 0.08 * popBonus(c); }
export function scoreAlbum(c, req) {
  const a = req.album ?? req.query;
  return (req.artist ? 0.7 * sim(a, c.name) + 0.3 * sim(req.artist, c.by) : sim(a, c.name)) + 0.05 * popBonus(c);
}
export function scoreNamedPlaylist(c, req) { return 0.85 * sim(req.name ?? req.query, c.name) + 0.1 * sim(req.query, textOf(c)) + 0.05 * popBonus(c); }

// A playlist for a genre (and moods): its name and description should say the genre; generic hit lists and playlists
// of another style lose. Returns the text score (the genre check on its artists comes later, in verify).
export function scoreGenrePlaylist(c, req) {
  const g = req.genre, t = norm(textOf(c)), name = norm(c.name);
  let s = 0;
  if (g) {
    const inName = covers(name, g.name), inText = covers(t, g.name);
    s += 0.5 * inName + 0.25 * inText + (name === g.name ? 0.05 : 0);      // named just that ("Christian Folk")
    if (g.decade) s += words(t).includes(g.decade) ? 0.1 : -0.1;
    const want = ` ${g.name} `;
    for (const o of OTHER_STYLE) if (!want.includes(` ${o} `) && new RegExp(`\\b${o}\\b`).test(name)) s -= 0.25;
  }
  for (const id of req.moods ?? []) { const m = MOODS.find((x) => x.id === id); if (m) s += (m.fit.some((f) => t.includes(f)) ? 0.15 : -0.05) / Math.max(1, (req.moods ?? []).length) * (g ? 1 : 3); }
  if (GENERIC.test(t) && !(g && /\bpop\b/.test(g.name))) s -= 0.5;
  if (!g && (req.moods ?? []).length) s += 0.2 * sim(req.query, c.name);
  return s + 0.1 * popBonus(c);
}

// Score any found item for a request the way Spotify's results are scored (other sources' candidates too).
export function scoreItem(c, req) {
  if (c.type === "track") return scoreTrack(c, req.kind === "any" ? { ...req, title: req.query } : req);
  if (c.type === "artist") return scoreArtist(c, req);
  if (c.type === "album") return scoreAlbum(c, req);
  return req.genre || req.moods?.length ? scoreGenrePlaylist(c, req) : scoreNamedPlaylist(c, req);
}
// Rank a list of found items for a plain query of one type (the media window's older "search and open" path).
export function rankFound(list, query, type) {
  const p = parseRequest(query, { type });
  const req = { ...p, title: p.title ?? p.query, album: p.album ?? p.query, name: p.name ?? p.query };
  const score = (c) => c.type === "track" ? scoreTrack(c, req) : c.type === "artist" ? scoreArtist(c, req) : c.type === "album" ? scoreAlbum(c, req)
    : req.genre || req.moods?.length ? scoreGenrePlaylist(c, req) : scoreNamedPlaylist(c, req);
  return list.filter((c) => !type || c.type === type).map((c) => ({ ...c, score: score(c) })).sort((a, b) => b.score - a.score);
}

// ---- resolving -------------------------------------------------------------------------------------------------------
const quote = (s) => `"${String(s).replace(/"/g, "")}"`;

export async function resolve(req, src, { prefs = null } = {}) {
  const pref = prefs && req.key ? prefs.forKey(req.key) : { rejected: new Set(), kept: null };
  const out = { kind: req.kind, req, candidates: [], choice: null, confidence: 0, clarify: false, options: [], error: null, source: src.kind };
  let list = [];
  // other registered sources (his files, Google Drive…): all of them, or only the one he named ("from my computer")
  const extra = [];
  for (const s of req.from === "spotify" ? [] : sources().filter((x) => (!req.from || x.id === req.from) && (x.available?.() ?? true))) {
    try { for (const c of (await s.search(req)) ?? []) extra.push({ ...c, source: s.id, score: Number.isFinite(c.score) ? c.score : scoreItem(c, req) }); }
    catch (e) { console.log(`music: ${s.id} search failed (${e.message})`); }
  }
  if (req.from && req.from !== "spotify") {
    list = extra;
    if (!list.length) out.error = `Nothing on ${getSource(req.from)?.label ?? req.from} matched "${req.query || req.raw}".`;
  } else try {
  switch (req.kind) {
    case "url": list = [{ type: req.uri.split(":")[1], uri: req.uri, name: req.raw, score: 1, play: req.uri.includes(":track:") || req.uri.includes(":episode:") ? { uris: [req.uri] } : { context_uri: req.uri } }]; break;
    case "liked": list = await liked(src); if (!list.length) out.error = "Your Liked Songs look empty on Spotify."; break;
    case "myplaylist": ({ list, error: out.error } = await mine(req, src)); break;
    case "genre": case "mood": list = await genreOrMood(req, src); break;
    case "radio": ({ list, error: out.error } = await radio(req, src)); break;
    case "vague": list = await vague(req, src); break;
    default: list = await named(req, src);
  }
  list.push(...extra);
  } catch (e) { if (!extra.length) throw e; list = extra; }          // Spotify not reachable: his other sources can still answer
  // his corrections: never the ones he turned down, and the one he kept first
  list = list.filter((c) => !pref.rejected.has(c.uri) && !excluded(c, req) && requiredOk(c, req));
  if (pref.kept) for (const c of list) if (c.uri === pref.kept.uri) { c.score += 0.3; c.why = [...(c.why ?? []), "you kept this before"]; }
  list.sort((a, b) => b.score - a.score);
  out.candidates = dedupe(list);
  out.choice = out.candidates[0] ?? null;
  out.confidence = out.choice ? Math.max(0, Math.min(1, out.choice.score)) : 0;
  if (!out.choice && !out.error) out.error = `Nothing on Spotify matched "${req.raw || req.query}".`;
  // not sure: the top three to choose from (a genre or a mood always has something reasonable to play instead)
  if (out.choice && out.confidence < CLARIFY_BELOW && !["genre", "mood", "liked", "url", "radio", "vague"].includes(req.kind) && out.candidates.length > 1) {
    out.clarify = true;
    out.options = out.candidates.slice(0, 3);
  }
  return out;
}
function dedupe(list) { const seen = new Set(); return list.filter((c) => { const k = c.uri ?? c.url ?? c.name; if (seen.has(k)) return false; seen.add(k); return true; }); }

async function liked(src) {
  const uris = await src.liked?.() ?? [];
  if (src.kind === "web") return [{ type: "collection", url: "liked", name: "Liked Songs", score: 1, play: { liked: true }, shuffle: true }];
  if (!uris.length) return [];
  return [{ type: "liked", uri: "liked", name: "Liked Songs", score: 1, play: { uris: shuffled(uris) }, shuffle: true }];
}

async function mine(req, src) {
  const all = await src.myPlaylists?.() ?? [];
  const want = req.query.replace(/\bplaylist\b/, "").trim();
  const scored = all.map((p) => ({ ...p, type: "playlist", mine: true, score: Math.max(sim(want, p.name), norm(p.name) === norm(want) || norm(p.name).replace(/ /g, "") === norm(want).replace(/ /g, "") ? 1 : 0, norm(p.name).includes(norm(want)) && want.length > 2 ? 0.8 : 0), play: { context_uri: p.uri }, why: ["one of your playlists"] }))
    .filter((p) => p.score >= 0.5).sort((a, b) => b.score - a.score);
  if (scored.length) return { list: scored };
  if (req.special) return { list: [], error: `I couldn't find your ${titleCase(want)} in your Spotify library. Spotify only shares it with Dayspring when it's saved in your library: open Spotify, find ${titleCase(want)} and press the heart (or "Add to library"), then ask again.` };
  // not one of his: a public playlist by that name, said so
  const pub = await named({ ...req, kind: "playlist", name: want, query: want }, src);
  if (pub.length) { for (const p of pub) p.note = `I couldn't find a playlist of yours called "${want}", so this is a public one.`; return { list: pub }; }
  return { list: [], error: `I couldn't find a playlist of yours called "${want}".${all.length ? ` You have ${listNames(all.map((p) => p.name), 6)}.` : ""}` };
}

// A song, an artist, an album, a public playlist, the words of a song, or "any" (search everything; the best wins).
async function named(req, src) {
  const kinds = { track: ["track"], lyrics: ["track"], artist: ["artist", "track"], album: ["album"], playlist: ["playlist"], any: ["artist", "track", "album", "playlist"] }[req.kind] ?? ["track", "artist", "album", "playlist"];
  const queries = [];
  if (req.kind === "track" && req.artist) queries.push({ q: `track:${quote(req.title)} artist:${quote(req.artist)}`, types: ["track"] }, { q: `${req.title} ${req.artist}`, types: ["track"] });
  else if (req.kind === "album" && req.artist) queries.push({ q: `album:${quote(req.album)} artist:${quote(req.artist)}`, types: ["album"] }, { q: `${req.album} ${req.artist}`, types: ["album"] });
  else queries.push({ q: req.query, types: kinds });
  let found = [];
  for (const { q, types } of queries) {
    const r = await src.search(q, types, { limit: 10 });
    found.push(...Object.values(r).flat());
    if (found.some((c) => c.type === kinds[0]) && req.kind !== "any") break;
  }
  const PRIOR = { artist: 0.06, track: 0.04, album: 0.0, playlist: -0.02 };
  const list = found.map((c) => {
    let score;
    if (req.kind === "any") score = { track: () => scoreTrack(c, { ...req, title: req.query }), artist: () => scoreArtist(c, req), album: () => 0.95 * scoreAlbum(c, req), playlist: () => 0.9 * scoreNamedPlaylist(c, req) }[c.type]?.() + (PRIOR[c.type] ?? 0);
    else if (req.kind === "artist") score = c.type === "artist" ? scoreArtist(c, req) : 0.5 * sim(req.artist ?? req.query, c.by);
    else if (req.kind === "track" || req.kind === "lyrics") score = c.type === "track" ? scoreTrack(c, req) : 0;
    else if (req.kind === "album") score = c.type === "album" ? scoreAlbum(c, req) : 0;
    else if (req.kind === "playlist") score = c.type === "playlist" ? scoreNamedPlaylist(c, req) : 0;
    else score = 0;
    return { ...c, score: score ?? 0, play: c.type === "track" ? { uris: [c.uri] } : { context_uri: c.uri } };
  }).filter((c) => c.score > 0.05);
  // an artist asked for by name must really be that artist (the fuzzy search can hand back someone else)
  if (req.kind === "artist" || req.kind === "any") for (const c of list) if (c.type === "artist" && sim(req.artist ?? req.query, c.name) < 0.6) c.score -= 0.3;
  return list;
}

// A genre or a mood: playlists that say it in their name or description, checked against their artists' genres;
// otherwise (or as well) a mix built from the genre's top artists.
async function genreOrMood(req, src) {
  const g = req.genre;
  const searches = [src.search(req.query, ["playlist"], { limit: 10, pages: 2 })];
  if (g && src.kind === "api") searches.push(src.search(`genre:${quote(g.name)}`, ["artist"], { limit: 10, pages: 2 }));
  const [pl, ar] = await Promise.all(searches);
  let playlists = (pl.playlist ?? []).map((c) => ({ ...c, text: scoreGenrePlaylist(c, req) })).sort((a, b) => b.text - a.text);
  // check the best few before choosing: do their artists belong to the genre? (or, for the web player, the page's words)
  // (the web player has one page: one playlist at a time, and fewer of them)
  const top = playlists.slice(0, src.kind === "web" ? 3 : 5);
  const each = src.kind === "web" ? async (xs, f) => { for (const x of xs) await f(x); } : (xs, f) => Promise.all(xs.map(f));
  await each(top, async (c) => {
    const v = await verifyGenre(c, req, src).catch(() => null);
    Object.assign(c, v ?? {});
    const share = c.share;
    c.score = share == null ? c.text * 0.9 : c.text * 0.6 + share * 0.5 - (share < 0.2 ? 0.4 : 0);
    if (c.restricted) c.score -= 0.05;
    c.score += 0.06 * Math.min(1, (c.total ?? c.size ?? 0) / 25);          // a fuller playlist, other things equal
    c.play = { context_uri: c.uri };
    c.shuffle = true;
    c.why = [share == null ? "its name and description match" : `${Math.round(share * 100)}% of its artists are ${g ? titleCase(g.name) : "a fit"}`];
  });
  const list = top.filter((c) => c.score > 0.15);
  // a mix from the genre's own artists: always offered (the next choice after the playlists), first when no playlist fits
  if (g && src.kind === "api") {
    const mix = await genreMix(req, src, ar?.artist ?? []).catch(() => null);
    if (mix) { mix.score = list.length && list[0].score >= 0.55 ? Math.min(0.54, list[0].score - 0.01) : 0.6; list.push(mix); }
  }
  // the web player can't queue songs: the genre's best artist page is the fallback there
  if (!list.length && src.kind === "web" && g) {
    const r = await src.search(g.name, ["artist"], { limit: 10 });
    for (const a of (r.artist ?? []).slice(0, 3)) list.push({ ...a, score: 0.3, play: { context_uri: a.uri }, why: ["an artist found for this genre"] });
  }
  return list;
}

// For a genre: the share of a playlist's artists whose Spotify genres fit (null when Spotify doesn't say).
export async function verifyGenre(c, req, src) {
  const look = await src.inspect?.(c).catch(() => null);
  if (!look) return { restricted: true, share: null };
  const artists = look.artists ?? [];
  const out = { sample: artists.slice(0, 6).map((a) => a.name ?? a), description: look.description ?? c.description ?? "", size: look.tracks?.length ?? null, tracks: (look.tracks ?? []).slice(0, 30) };
  if (look.description && !c.description) c.description = look.description;
  if (req.exclude?.length && artists.some((a) => req.exclude.some((x) => covers(a.name ?? a, x) >= 1))) return { ...out, share: 0, why: ["has an artist you said no to"] };
  if (!req.genre || src.kind !== "api") {
    // the web player: the description (read off the page) must say the genre or mood
    const t = `${c.name} ${out.description}`;
    if (req.genre) return { ...out, share: covers(t, req.genre.name) >= 1 ? 0.8 : covers(t, req.genre.name) >= 0.5 ? 0.4 : 0.1 };
    return { ...out, share: null };
  }
  const ids = [...new Set(artists.map((a) => a.id).filter(Boolean))].slice(0, 25);
  if (!ids.length) return { ...out, share: null };
  const genres = await src.artistGenres(ids).catch(() => null);
  if (!genres) return { ...out, share: null };
  let known = 0, fit = 0;
  for (const id of ids) { const r = genreFits(genres.get(id), req.genre); if (r === null) continue; known++; if (r) fit++; }
  return { ...out, share: known >= Math.min(3, ids.length) ? fit / known : null };
}

// Songs from the genre's top artists (checked: their Spotify genres must fit), a few each, mixed together.
async function genreMix(req, src, found) {
  const g = req.genre;
  let artists = found.filter((a) => genreFits(a.genres, g) !== false);
  if (artists.length < 3) {
    const more = await src.search(g.name, ["artist"], { limit: 10 });
    artists.push(...(more.artist ?? []).filter((a) => genreFits(a.genres, g) === true && !artists.some((x) => x.uri === a.uri)));
  }
  artists = artists.filter((a) => !req.exclude?.some((x) => covers(a.name, x) >= 1)).sort((a, b) => popBonus(b) - popBonus(a)).slice(0, 8);
  if (!artists.length) return null;
  const per = await Promise.all(artists.map((a) => src.artistTracks(a, 3).catch(() => [])));
  const tracks = interleave(per).filter((t) => !req.exclude?.some((x) => covers(`${t.name} ${t.by}`, x) >= 1));
  if (tracks.length < 3) return null;
  const name = `${g.decade ? g.decade + " " : ""}${titleCase(g.name)} mix`;
  return { type: "mix", uri: `mix:${req.key}`, name, by: listNames(artists.map((a) => a.name), 3), artists: artists.map((a) => ({ name: a.name, id: a.id })),
    sample: artists.map((a) => a.name), play: { uris: tracks.slice(0, 40).map((t) => t.uri) }, tracks, why: [`songs from ${titleCase(g.name)} artists`], share: 1 };
}
const interleave = (lists) => { const out = [], seen = new Set(); for (let i = 0; i < 10; i++) for (const l of lists) { const t = l[i]; if (t && !seen.has(t.uri)) { seen.add(t.uri); out.push(t); } } return out; };

// "More like this" / "songs like Johnny Cash": the seed artist's songs and others from the same genre.
async function radio(req, src) {
  let seedArtist = null, seedTrack = null;
  if (req.seed === "current") {
    const now = await src.current?.().catch(() => null);
    if (!now?.artists?.length) return { list: [], error: "Nothing's playing right now, so I don't know what \"more like this\" means. Tell me a song or an artist." };
    seedTrack = now; seedArtist = now.artists[0];
  } else {
    const r = await src.search(req.seed, ["artist", "track"], { limit: 10 });
    const a = (r.artist ?? []).map((c) => ({ c, s: scoreArtist(c, { query: req.seed }) })).sort((x, y) => y.s - x.s)[0];
    const t = (r.track ?? []).map((c) => ({ c, s: scoreTrack(c, { query: req.seed, raw: req.seed }) })).sort((x, y) => y.s - x.s)[0];
    if (a && a.s >= 0.6 && (!t || a.s >= t.s - 0.05)) seedArtist = a.c;
    else if (t && t.s >= 0.5) { seedTrack = t.c; seedArtist = t.c.artists?.[0]; }
    else if (a) seedArtist = a.c;
  }
  if (!seedArtist) return { list: [], error: `I couldn't find "${req.seed}" on Spotify.` };
  const label = seedTrack?.name && req.seed === "current" ? seedTrack.name : seedArtist.name;
  if (src.kind !== "api") {
    const r = await src.search(`${seedArtist.name} radio`, ["playlist"], { limit: 10 });
    const list = (r.playlist ?? []).map((c) => ({ ...c, score: 0.4 + 0.5 * covers(c.name, seedArtist.name), play: { context_uri: c.uri }, why: [`a mix around ${seedArtist.name}`] }));
    return { list };
  }
  const genres = seedArtist.id ? (await src.artistGenres([seedArtist.id]).catch(() => null))?.get(seedArtist.id) ?? seedArtist.genres ?? [] : seedArtist.genres ?? [];
  const tag = genres[0];
  const others = tag ? ((await src.search(`genre:${quote(tag)}`, ["artist"], { limit: 10 })).artist ?? []).filter((a) => a.uri !== seedArtist.uri && norm(a.name) !== norm(seedArtist.name)).slice(0, 6) : [];
  const per = await Promise.all([seedArtist, ...others].map((a) => src.artistTracks(a, 3).catch(() => [])));
  const tracks = interleave(per).filter((t) => t.uri !== seedTrack?.uri);
  if (tracks.length < 3) return { list: [], error: `I couldn't find enough songs like ${label}.` };
  return { list: [{ type: "mix", uri: `radio:${norm(seedArtist.name)}`, name: `songs like ${label}`, by: listNames([seedArtist.name, ...others.map((a) => a.name)], 3),
    sample: [seedArtist.name, ...others.map((a) => a.name)], play: { uris: tracks.slice(0, 40).map((t) => t.uri) }, tracks, score: 0.8, why: [tag ? `${seedArtist.name} and other ${tag} artists` : `${seedArtist.name}'s songs`] }] };
}

// "play some music": Liked Songs when he has them, otherwise a feel-good playlist
async function vague(req, src) {
  const l = await liked(src).catch(() => []);
  if (l.length && src.kind === "api") return l;
  const r = await src.search("feel good", ["playlist"], { limit: 10 });
  return (r.playlist ?? []).map((c) => ({ ...c, score: 0.5 + 0.2 * popBonus(c), play: { context_uri: c.uri }, shuffle: true }));
}

function shuffled(a) { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; }

// ---- words for the owner ------------------------------------------------------------------------------------------
// "Playing Christian Folk, a playlist with The Gray Havens and Josh Garrels."
export function describe(c, req) {
  if (!c) return "";
  const who = listNames(c.sample ?? [], 2);
  switch (c.type) {
    case "track": return `Playing ${c.name}${c.by ? ` by ${c.by}` : ""}.`;
    case "artist": return `Playing ${c.name}.`;
    case "album": return `Playing the album ${c.name}${c.by ? ` by ${c.by}` : ""}.`;
    case "liked": case "collection": return "Playing your Liked Songs.";
    case "mix": return `Playing ${/^songs like/.test(c.name) ? c.name : `a ${c.name}`}${c.by ? `, with ${c.by}` : ""}.`;
    case "playlist": return `Playing ${c.name}${c.mine ? "" : who ? `, a playlist with ${who}` : req?.genre || req?.moods?.length ? ", a playlist" : ""}.`;
    default: return `Playing ${c.name}.`;
  }
}
export function optionLabel(c) {
  const kind = { track: "song", artist: "artist", album: "album", playlist: "playlist", mix: "mix" }[c.type] ?? c.type;
  return `${c.name}${c.by && c.type !== "artist" && c.type !== "mix" ? ` by ${c.by}` : ""} (${kind})`;
}
export { GENRES };
