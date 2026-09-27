// The resolver's view of Spotify through the Web API (spotify-api.mjs): search across types with paging (Development
// Mode apps get at most 10 results a call, so a second page comes from offset 10), artist genres, what's in a
// playlist, an artist's songs, his playlists and Liked Songs, and what's playing. Everything comes back in one shape
// (see resolve.mjs). Endpoints Spotify has closed to Development Mode apps (several-artists, top-tracks, playlist
// contents of Spotify's own playlists) fall back to something that still works, or to "unknown".
import * as spotify from "../spotify-api.mjs";

const qs = (o) => new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""))).toString();
const img = (x) => (x?.images ?? x?.album?.images ?? [])[0]?.url ?? null;
const strip = (s) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
export function item(x, type) {
  if (!x) return null;
  const artists = (x.artists ?? []).map((a) => ({ id: a.id, name: a.name, uri: a.uri }));
  const base = { type, id: x.id, uri: x.uri, name: x.name, art: img(x), url: x.external_urls?.spotify ?? null };
  if (type === "track") return { ...base, by: artists.map((a) => a.name).join(", "), artists, album: x.album?.name ?? null, popularity: x.popularity ?? null, ms: x.duration_ms ?? null };
  if (type === "artist") return { ...base, by: "", genres: x.genres ?? null, followers: x.followers?.total ?? null, popularity: x.popularity ?? null };
  if (type === "album") return { ...base, by: artists.map((a) => a.name).join(", "), artists, popularity: x.popularity ?? null };
  if (type === "playlist") return { ...base, by: x.owner?.display_name ?? "", owner: x.owner?.display_name ?? "", ownerId: x.owner?.id ?? null, description: strip(x.description), followers: x.followers?.total ?? null, total: x.items?.total ?? x.tracks?.total ?? null };
  return base;
}

// search(q, ["track","artist"], { limit, pages }) → { track: [...], artist: [...] }
export async function search(q, types = ["track"], { limit = 10, pages = 1 } = {}) {
  const out = Object.fromEntries(types.map((t) => [t, []]));
  for (let p = 0; p < pages; p++) {
    const j = await spotify.api("GET", `/search?${qs({ q, type: types.join(","), limit: Math.min(10, limit), offset: p * 10 })}`);
    let more = false;
    for (const t of types) {
      const block = j?.[`${t}s`];
      const got = (block?.items ?? []).map((x) => item(x, t)).filter(Boolean);
      out[t].push(...got.filter((g) => !out[t].some((o) => o.uri === g.uri)));
      if (block?.next || (block?.total ?? 0) > (p + 1) * 10) more = true;
    }
    if (!more) break;
  }
  return out;
}

const closed = (e) => [403, 404, 410].includes(e?.status);
// id → genres (the several-artists call, or one by one where that's closed)
export async function artistGenres(ids) {
  const map = new Map();
  try {
    for (let i = 0; i < ids.length; i += 50) {
      const j = await spotify.api("GET", `/artists?${qs({ ids: ids.slice(i, i + 50).join(",") })}`);
      for (const a of j?.artists ?? []) if (a) map.set(a.id, a.genres ?? null);
    }
  } catch (e) {
    if (!closed(e)) throw e;
    await Promise.all(ids.slice(0, 12).map(async (id) => { try { const a = await spotify.api("GET", `/artists/${id}`); map.set(id, a?.genres ?? null); } catch { /* unknown */ } }));
  }
  return map;
}

// What's in a playlist or album: its description and its first songs' artists.
export async function inspect(c) {
  if (c.type === "playlist") {
    let j;
    try { j = await spotify.api("GET", `/playlists/${c.id}/items?${qs({ limit: 30 })}`); }
    catch (e) { if (!closed(e)) throw e; try { j = await spotify.api("GET", `/playlists/${c.id}/tracks?${qs({ limit: 30 })}`); } catch (e2) { if (closed(e2)) return null; throw e2; } }
    const tracks = (j?.items ?? []).map((i) => i?.item ?? i?.track).filter((t) => t && t.type !== "episode");
    return { description: c.description ?? "", tracks: tracks.map((t) => item(t, "track")), artists: uniq(tracks.flatMap((t) => t.artists ?? []).map((a) => ({ id: a.id, name: a.name }))) };
  }
  if (c.type === "album") {
    const j = await spotify.api("GET", `/albums/${c.id}/tracks?${qs({ limit: 30 })}`);
    return { description: "", tracks: (j?.items ?? []).map((t) => item(t, "track")), artists: uniq((j?.items ?? []).flatMap((t) => t.artists ?? []).map((a) => ({ id: a.id, name: a.name }))) };
  }
  return null;
}
const uniq = (as) => { const seen = new Set(); return as.filter((a) => a && !seen.has(a.id ?? a.name) && seen.add(a.id ?? a.name)); };

// An artist's popular songs (top-tracks, or a search by artist where that's closed)
export async function artistTracks(a, n = 3) {
  if (a.id) {
    try {
      const j = await spotify.api("GET", `/artists/${a.id}/top-tracks?${qs({ market: "from_token" })}`);
      const t = (j?.tracks ?? []).map((x) => item(x, "track")).filter(Boolean);
      if (t.length) return t.slice(0, n);
    } catch (e) { if (!closed(e)) throw e; }
  }
  const r = await search(`artist:"${String(a.name).replace(/"/g, "")}"`, ["track"], { limit: 10 });
  return r.track.filter((t) => t.artists.some((x) => (a.id && x.id === a.id) || x.name.toLowerCase() === String(a.name).toLowerCase())).sort((x, y) => (y.popularity ?? 0) - (x.popularity ?? 0)).slice(0, n);
}

export async function myPlaylists() { return spotify.myPlaylists(); }
export async function liked() { return spotify.likedUris(50); }

// What's playing: { uri, name, by, artists, context, playing, device }
export async function current() {
  const j = await spotify.api("GET", "/me/player?additional_types=track,episode");
  if (!j?.item) return j ? { playing: Boolean(j.is_playing), context: j.context?.uri ?? null, device: j.device?.id ?? null } : null;
  return { ...item(j.item, "track"), playing: Boolean(j.is_playing), context: j.context?.uri ?? null, device: j.device?.id ?? null };
}

export const source = { kind: "api", search, artistGenres, inspect, artistTracks, myPlaylists, liked, current };
