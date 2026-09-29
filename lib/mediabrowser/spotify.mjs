// The Music & Video browser's Spotify: his library, history and search through the Web API (lib/spotify-api.mjs), in
// pages. Every list answers { items, next, total, note? }; `next` is the cursor for "Load more" (an offset, or Spotify's
// own before/after cursor), null at the end.
//   Scopes: a section whose permission the sign-in on file lacks answers { needsScopes: [...] } (the browser shows
//           "Grant access to your library and history": one new sign-in that asks for everything).
//   Development Mode: Spotify closes some endpoints to apps in Development Mode (403/404 on another user's playlist, some
//           browse calls). Those answer { fallback: "webplayer", url, note } and the browser offers to open that page in
//           the Spotify web player in the media window instead, and says why.
//   Search: at most 10 results a call for a Development Mode app, so one "page" here is two calls (offset 0 and 10), and
//           "Load more" asks for the next two.
import * as spotify from "../spotify-api.mjs";
import { item as shape } from "../music/webapi.mjs";
import { GENRES, MOODS, findGenre, findMoods } from "../music/genres.mjs";
import { norm, titleCase } from "../music/text.mjs";

const qs = (o) => new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""))).toString();
const WEB = "https://open.spotify.com";
const PAGE = 50;
export const RANGES = { short: "short_term", medium: "medium_term", long: "long_term" };
export const RANGE_LABEL = { short: "Last 4 weeks", medium: "Last 6 months", long: "All time" };

// one browser item from a Web API object
export function toItem(x, type, extra = {}) {
  const s = shape(x, type);
  if (!s?.uri) return null;
  const sub = type === "track" ? [s.by, s.album].filter(Boolean).join(" · ") : type === "album" ? s.by : type === "playlist" ? [s.owner ? `by ${s.owner}` : "", s.total != null ? `${s.total} songs` : ""].filter(Boolean).join(" · ") : type === "artist" ? (s.genres ?? []).slice(0, 2).map(titleCase).join(", ") || (s.followers != null ? `${s.followers.toLocaleString("en-US")} followers` : "Artist") : "";
  return { key: s.uri, source: "spotify", kind: type, id: s.id, uri: s.uri, title: s.name, sub, art: s.art, ms: s.ms ?? null, by: s.by ?? "", url: s.url ?? `${WEB}/${type}/${s.id}`,
    ...(type === "track" ? { artists: (s.artists ?? []).map((a) => ({ id: a.id, name: a.name })), albumName: s.album ?? null, albumId: x.album?.id ?? null, explicit: Boolean(x.explicit) } : {}),
    ...(type === "playlist" ? { owner: s.owner, ownerId: s.ownerId, total: s.total, collaborative: Boolean(x.collaborative) } : {}), ...extra };
}
const closed = (e) => [403, 404, 410].includes(e?.status) && !/scope/i.test(e?.message ?? "");
const scopeErr = (e) => e?.status === 403 && /scope/i.test(e?.message ?? "");
function need(section) {
  const miss = spotify.missingScopes(section);
  if (miss.length) throw Object.assign(new Error("Dayspring needs your OK to read this part of your Spotify."), { needsScopes: miss });
}
// call a section; turn Spotify's refusals into what the browser shows
async function guard(section, fn, fallbackUrl) {
  if (!spotify.ready()) throw Object.assign(new Error("Spotify isn't connected to Dayspring yet."), { connect: true });
  need(section);
  try { return await fn(); }
  catch (e) {
    if (scopeErr(e)) throw Object.assign(new Error("Dayspring needs your OK to read this part of your Spotify."), { needsScopes: spotify.NEEDS[section] ?? [] });
    if (closed(e) && fallbackUrl) return devFallback(fallbackUrl);
    throw e;
  }
}
export const devFallback = (url, what = "this") => ({ items: [], next: null, total: 0, fallback: "webplayer", url,
  note: `Spotify doesn't let apps in Development Mode read ${what}. You can open it in the Spotify web player in Dayspring's media window instead.` });

// ---- his library --------------------------------------------------------------------------------------------------------
// playlists: his own, the ones he follows, and collaborative ones. filter: "all" | "mine" | "followed" | "collab"
export async function playlists({ cursor = 0, filter = "all" } = {}) {
  return guard("playlists", async () => {
    const off = Number(cursor) || 0;
    const j = await spotify.api("GET", `/me/playlists?${qs({ limit: PAGE, offset: off })}`);
    const me = spotify.status().signedIn ? (await meId()) : null;
    let items = (j?.items ?? []).filter(Boolean).map((p) => toItem(p, "playlist", { mine: !me || p.owner?.id === me, followed: Boolean(me && p.owner?.id !== me) })).filter(Boolean);
    if (filter === "mine") items = items.filter((x) => x.mine);
    else if (filter === "followed") items = items.filter((x) => x.followed && !x.collaborative);
    else if (filter === "collab") items = items.filter((x) => x.collaborative);
    return { items, next: j?.next ? off + PAGE : null, total: j?.total ?? items.length };
  });
}
let myId = null;
async function meId() { if (myId) return myId; try { myId = (await spotify.me())?.id ?? null; } catch { myId = null; } return myId; }
export function _reset() { myId = null; }
export async function playlistTracks(id, { cursor = 0 } = {}) {
  return guard("playlists", async () => {
    const off = Number(cursor) || 0;
    let j;
    try { j = await spotify.api("GET", `/playlists/${encodeURIComponent(id)}/items?${qs({ limit: PAGE, offset: off })}`); }
    catch (e) { if (e.status !== 404) throw e; j = await spotify.api("GET", `/playlists/${encodeURIComponent(id)}/tracks?${qs({ limit: PAGE, offset: off })}`); }
    const items = (j?.items ?? []).map((i) => ({ t: i?.item ?? i?.track, added: i?.added_at })).filter((x) => x.t && x.t.type !== "episode").map((x) => toItem(x.t, "track", { added: x.added ?? null, context: `spotify:playlist:${id}` })).filter(Boolean);
    return { items, next: j?.next ? off + PAGE : null, total: j?.total ?? items.length };
  }, `${WEB}/playlist/${id}`);
}
export async function liked({ cursor = 0 } = {}) {
  return guard("liked", async () => {
    const off = Number(cursor) || 0;
    const j = await spotify.api("GET", `/me/tracks?${qs({ limit: PAGE, offset: off })}`);
    const items = (j?.items ?? []).map((i) => toItem(i.track, "track", { added: i.added_at ?? null, liked: true })).filter(Boolean);
    return { items, next: j?.next ? off + PAGE : null, total: j?.total ?? items.length };
  }, `${WEB}/collection/tracks`);
}
export async function albums({ cursor = 0 } = {}) {
  return guard("albums", async () => {
    const off = Number(cursor) || 0;
    const j = await spotify.api("GET", `/me/albums?${qs({ limit: PAGE, offset: off })}`);
    const items = (j?.items ?? []).map((i) => toItem(i.album, "album", { added: i.added_at ?? null, saved: true })).filter(Boolean);
    return { items, next: j?.next ? off + PAGE : null, total: j?.total ?? items.length };
  }, `${WEB}/collection/albums`);
}
export async function artists({ cursor = null } = {}) {
  return guard("artists", async () => {
    const j = await spotify.api("GET", `/me/following?${qs({ type: "artist", limit: PAGE, after: cursor || undefined })}`);
    const a = j?.artists ?? {};
    const items = (a.items ?? []).map((x) => toItem(x, "artist", { followed: true })).filter(Boolean);
    return { items, next: a.next && a.cursors?.after ? a.cursors.after : null, total: a.total ?? items.length };
  }, `${WEB}/collection/artists`);
}
// top artists or tracks: range short (4 weeks) | medium (6 months) | long (all time)
export async function top({ type = "tracks", range = "short", cursor = 0 } = {}) {
  return guard("top", async () => {
    const off = Number(cursor) || 0;
    const j = await spotify.api("GET", `/me/top/${type === "artists" ? "artists" : "tracks"}?${qs({ time_range: RANGES[range] ?? RANGES.short, limit: PAGE, offset: off })}`);
    const items = (j?.items ?? []).map((x, i) => toItem(x, type === "artists" ? "artist" : "track", { rank: off + i + 1 })).filter(Boolean);
    return { items, next: j?.next ? off + PAGE : null, total: j?.total ?? items.length, range, rangeLabel: RANGE_LABEL[range] ?? RANGE_LABEL.short };
  });
}
// recently played (newest first, with when): cursor = Spotify's "before" (ms). day: "YYYY-MM-DD" keeps only that day
export async function recent({ cursor = null, day = null } = {}) {
  return guard("recent", async () => {
    let before = cursor ? Number(cursor) : undefined;
    const from = day ? new Date(`${day}T00:00:00`).getTime() : null, to = day ? from + 86_400_000 : null;
    if (day && (!before || before > to)) before = to;
    const j = await spotify.api("GET", `/me/player/recently-played?${qs({ limit: PAGE, before })}`);
    let items = (j?.items ?? []).map((i) => toItem(i.track, "track", { playedAt: i.played_at ?? null, context: i.context?.uri ?? null })).filter(Boolean);
    items.forEach((x) => { x.key = `${x.uri}@${x.playedAt}`; });
    const oldest = items.length ? Date.parse(items.at(-1).playedAt) : null;
    if (day) items = items.filter((x) => { const t = Date.parse(x.playedAt); return t >= from && t < to; });
    const more = Boolean(j?.next || j?.cursors?.before) && items.length > 0 && (!day || (oldest && oldest > from));
    return { items, next: more ? String(j?.cursors?.before ?? oldest) : null, total: null, day };
  });
}
export async function queue() {
  return guard("queue", async () => {
    const j = await spotify.api("GET", "/me/player/queue");
    const cur = j?.currently_playing ? toItem(j.currently_playing, "track", { current: true }) : null;
    const items = (j?.queue ?? []).map((x, i) => toItem(x, x?.type === "episode" ? "episode" : "track", { upNext: i + 1 })).filter(Boolean);
    items.forEach((x, i) => { x.key = `${x.uri}#${i}`; });
    return { items, current: cur, next: null, total: items.length };
  });
}
export async function now() {
  return guard("now", async () => {
    const j = await spotify.api("GET", "/me/player?additional_types=track,episode");
    if (!j?.item) return { playing: false, item: null };
    const it = toItem(j.item, j.item.type === "episode" ? "episode" : "track");
    let likedNow = null;
    try { likedNow = (await contains([it.uri]))[0] ?? null; } catch { /* unknown */ }
    return { playing: Boolean(j.is_playing), progressMs: j.progress_ms ?? 0, item: { ...it, liked: likedNow }, device: j.device?.name ?? null, shuffle: j.shuffle_state ?? null, repeat: j.repeat_state ?? null,
      lyrics: `https://www.google.com/search?q=${encodeURIComponent(`${it.title} ${it.by} lyrics`)}` };
  });
}
// liked or not, for track URIs (Spotify's 2026 library call, the older /me/tracks/contains where that's missing)
export async function contains(uris) {
  try { const j = await spotify.api("GET", `/me/library/contains?${qs({ uris: uris.join(",") })}`); if (Array.isArray(j)) return j; } catch (e) { if (![404, 405].includes(e.status)) throw e; }
  const j = await spotify.api("GET", `/me/tracks/contains?${qs({ ids: uris.map((u) => u.split(":").pop()).join(",") })}`);
  return Array.isArray(j) ? j : [];
}

// ---- pages inside the browser: an artist, an album, a playlist ------------------------------------------------------------
export async function artistPage(id) {
  if (!spotify.ready()) throw Object.assign(new Error("Spotify isn't connected to Dayspring yet."), { connect: true });
  const a = await spotify.api("GET", `/artists/${encodeURIComponent(id)}`);
  const head = toItem(a, "artist");
  let tracks = [];
  try { tracks = ((await spotify.api("GET", `/artists/${encodeURIComponent(id)}/top-tracks?${qs({ market: "from_token" })}`))?.tracks ?? []).map((x) => toItem(x, "track")).filter(Boolean); }
  catch (e) { if (!closed(e)) throw e; }
  if (!tracks.length) {   // closed to Development Mode apps: the artist's own songs from a search
    const r = await searchType(`artist:"${String(head.title).replace(/"/g, "")}"`, "track", 0, 2);
    tracks = r.items.filter((t) => (t.artists ?? []).some((x) => x.id === id)).slice(0, 10);
  }
  let albumsOf = [];
  try { albumsOf = ((await spotify.api("GET", `/artists/${encodeURIComponent(id)}/albums?${qs({ include_groups: "album,single", limit: 10 })}`))?.items ?? []).map((x) => toItem(x, "album")).filter(Boolean); } catch (e) { if (!closed(e)) throw e; }
  return { head, groups: [{ id: "track", title: "Popular songs", items: tracks }, { id: "album", title: "Albums and singles", items: albumsOf }], url: head.url };
}
export async function albumPage(id, { cursor = 0 } = {}) {
  if (!spotify.ready()) throw Object.assign(new Error("Spotify isn't connected to Dayspring yet."), { connect: true });
  const off = Number(cursor) || 0;
  const al = off ? null : await spotify.api("GET", `/albums/${encodeURIComponent(id)}`);
  const head = al ? toItem(al, "album") : null;
  const j = await spotify.api("GET", `/albums/${encodeURIComponent(id)}/tracks?${qs({ limit: PAGE, offset: off })}`);
  const art = head?.art ?? null;
  const items = (j?.items ?? []).map((x) => toItem({ ...x, album: x.album ?? { name: head?.title, images: al?.images, id } }, "track", { art, context: `spotify:album:${id}` })).filter(Boolean);
  return { head, items, next: j?.next ? off + PAGE : null, total: j?.total ?? items.length, url: `${WEB}/album/${id}` };
}
export async function playlistPage(id, { cursor = 0 } = {}) {
  const off = Number(cursor) || 0;
  let head = null;
  if (!off) { try { head = toItem(await spotify.api("GET", `/playlists/${encodeURIComponent(id)}?${qs({ fields: "id,uri,name,images,owner,description,collaborative,external_urls,tracks(total),items(total)" })}`), "playlist"); } catch (e) { if (!closed(e)) throw e; } }
  const r = await playlistTracks(id, { cursor: off });
  return { head, ...r, url: `${WEB}/playlist/${id}` };
}

// ---- search: Songs · Artists · Albums · Playlists · Genres/moods -----------------------------------------------------------
export const TYPES = ["track", "artist", "album", "playlist"];
export const GROUP_TITLE = { track: "Songs", artist: "Artists", album: "Albums", playlist: "Playlists", genre: "Genres and moods" };
// one type, `pages` calls of 10 from offset `from`
export async function searchType(q, type, from = 0, pages = 2) {
  const items = [];
  let total = null, more = false;
  for (let p = 0; p < pages; p++) {
    const off = from + p * 10;
    const j = await spotify.api("GET", `/search?${qs({ q, type, limit: 10, offset: off })}`);
    const block = j?.[`${type}s`];
    total = block?.total ?? total;
    for (const x of (block?.items ?? []).filter(Boolean)) { const it = toItem(x, type); if (it && !items.some((y) => y.uri === it.uri)) items.push(it); }
    more = Boolean(block?.next) || (block?.total ?? 0) > off + 10;
    if (!more || (block?.items ?? []).length < 10) { more = more && (block?.items ?? []).length === 10; break; }
  }
  return { items, next: more ? from + pages * 10 : null, total };
}
// genres and moods that fit what he's typing (Dayspring's own vocabulary: lib/music/genres.mjs)
export function genres(q, max = 8) {
  const t = norm(q);
  if (!t) return [];
  const out = [], seen = new Set();
  const add = (name, kind) => { if (seen.has(name) || out.length >= max) return; seen.add(name); out.push({ key: `genre:${name}`, source: "spotify", kind: "genre", title: titleCase(name), sub: kind === "mood" ? "Mood" : "Genre", genre: name, request: kind === "mood" ? `play some ${name} music` : `play ${name} music` }); };
  const g = findGenre(t, { shaped: true }); if (g) add(g.genre.name, "genre");
  for (const m of findMoods(t)) add(m.mood.id === "study" ? "study" : m.mood.query, "mood");
  for (const x of GENRES) if (x.aliases.some((a) => a.join(" ").startsWith(t) || (t.length >= 3 && a.join(" ").split(" ").some((w) => w.startsWith(t))))) add(x.name, "genre");
  for (const m of MOODS) if (t.length >= 3 && m.words.some((w) => w.startsWith(t))) add(m.query, "mood");
  return out;
}
// grouped: { groups: [{ id, title, items, next }] }. only: one type (its "Load more": from = the group's next)
export async function search(q, { only = null, from = 0 } = {}) {
  if (!spotify.ready()) throw Object.assign(new Error("Spotify isn't connected to Dayspring yet."), { connect: true });
  const words = String(q ?? "").trim().slice(0, 200);
  if (!words) return { groups: [] };
  if (only === "genre") return { groups: [{ id: "genre", title: GROUP_TITLE.genre, items: genres(words, 30), next: null }] };
  if (only) { const r = await searchType(words, only, Number(from) || 0, 2); return { groups: [{ id: only, title: GROUP_TITLE[only], ...r }] }; }
  // everything at once: two calls of 10 for all four types together
  const out = Object.fromEntries(TYPES.map((t) => [t, { items: [], more: false }]));
  for (let p = 0; p < 2; p++) {
    const j = await spotify.api("GET", `/search?${qs({ q: words, type: TYPES.join(","), limit: 10, offset: p * 10 })}`);
    let any = false;
    for (const t of TYPES) {
      const block = j?.[`${t}s`];
      for (const x of (block?.items ?? []).filter(Boolean)) { const it = toItem(x, t); if (it && !out[t].items.some((y) => y.uri === it.uri)) out[t].items.push(it); }
      out[t].more = Boolean(block?.next) || (block?.total ?? 0) > (p + 1) * 10;
      if (out[t].more) any = true;
    }
    if (!any) break;
  }
  const g = genres(words);
  return { groups: [...TYPES.map((t) => ({ id: t, title: GROUP_TITLE[t], items: out[t].items, next: out[t].more ? 20 : null })), { id: "genre", title: GROUP_TITLE.genre, items: g, next: null }].filter((x) => x.items.length) };
}

// ---- changing his library -------------------------------------------------------------------------------------------------
// ♥: a song (Liked Songs), an album (saved), an artist (followed), a playlist (followed)
export async function setSaved(it, on = true) {
  if (!spotify.ready()) throw new Error("Spotify isn't connected to Dayspring yet.");
  const id = String(it.id ?? String(it.uri ?? "").split(":").pop());
  const kind = it.kind ?? String(it.uri ?? "").split(":")[1];
  const section = kind === "artist" ? "follow" : kind === "playlist" ? "addToPlaylist" : "like";
  const miss = spotify.missingScopes(section);
  if (miss.length) throw Object.assign(new Error("Dayspring needs your OK to change your Spotify library."), { needsScopes: miss });
  if (kind === "track" || kind === "episode") await spotify.like(it.uri ?? `spotify:${kind}:${id}`, on);
  else if (kind === "album") { try { await spotify.api(on ? "PUT" : "DELETE", `/me/library?${qs({ uris: `spotify:album:${id}` })}`); } catch (e) { if (![404, 405].includes(e.status)) throw e; await spotify.api(on ? "PUT" : "DELETE", `/me/albums?${qs({ ids: id })}`); } }
  else if (kind === "artist") await spotify.api(on ? "PUT" : "DELETE", `/me/following?${qs({ type: "artist", ids: id })}`);
  else if (kind === "playlist") await spotify.api(on ? "PUT" : "DELETE", `/playlists/${encodeURIComponent(id)}/followers`);
  else throw new Error("That can't be saved on Spotify.");
  return { saved: on, kind };
}
export async function addToPlaylist(playlistId, uris) {
  if (!spotify.ready()) throw new Error("Spotify isn't connected to Dayspring yet.");
  const miss = spotify.missingScopes("addToPlaylist");
  if (miss.length) throw Object.assign(new Error("Dayspring needs your OK to change your playlists."), { needsScopes: miss });
  const list = uris.filter((u) => /^spotify:(track|episode):[A-Za-z0-9]+$/.test(u)).slice(0, 100);
  if (!list.length) throw new Error("Only songs can go into a playlist.");
  try { await spotify.api("POST", `/playlists/${encodeURIComponent(playlistId)}/items`, { uris: list }); }
  catch (e) { if (e.status !== 404) throw e; await spotify.api("POST", `/playlists/${encodeURIComponent(playlistId)}/tracks`, { uris: list }); }
  return { added: list.length };
}
// the playlists he can add songs to (his own and collaborative ones)
export async function writablePlaylists() {
  const out = [];
  let cursor = 0;
  for (let i = 0; i < 4 && cursor != null; i++) { const r = await playlists({ cursor }); if (r.needsScopes || r.fallback) break; out.push(...r.items.filter((p) => p.mine || p.collaborative)); cursor = r.next; }
  return out.map((p) => ({ id: p.id, title: p.title, art: p.art, total: p.total }));
}
