// Spotify inside Dayspring: sign-in (PKCE, no client secret), tokens, and the Web API calls the in-app player needs.
// The owner makes a free Spotify developer app once and pastes its Client ID into Settings (SPOTIFY_CLIENT_ID).
// Playback itself happens on the Dayspring screen through Spotify's Web Playback SDK (the screen becomes a Spotify
// device called "Dayspring"); this module tells Spotify what to play there. Needs Spotify Premium.
// Spotify's rules (2026): Development Mode apps need the app owner to have Premium, up to 5 allow-listed users,
// redirect URIs on a loopback address must be http://127.0.0.1:PORT (never "localhost"), search returns at most 10.
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import { writeJSONAtomic } from "./atomic.mjs";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const FILE = join(DATA, "spotify-token.json");
const API = "https://api.spotify.com/v1";
const ACCOUNTS = "https://accounts.spotify.com";
export const SCOPES = ["streaming", "user-read-email", "user-read-private", "user-read-playback-state", "user-modify-playback-state",
  "user-read-currently-playing", "user-read-recently-played", "playlist-read-private", "playlist-read-collaborative",
  "playlist-modify-private", "playlist-modify-public", "user-library-read", "user-library-modify", "user-top-read"];
// the sign-in on file includes this permission (older sign-ins lack user-top-read: "sign in to Spotify" again)
export const hasScope = (s) => String(loadTok()?.scope ?? "").split(/\s+/).includes(s);

export const clientId = () => String(process.env.SPOTIFY_CLIENT_ID ?? "").trim();
export const redirectUri = () => `http://127.0.0.1:${process.env.PORT || 4747}/spotify/callback`;

let tok = null;
function loadTok() { if (tok) return tok; try { tok = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : null; } catch { tok = null; } return tok; }
function saveTok(t) { tok = t; mkdirSync(DATA, { recursive: true }); writeJSONAtomic(FILE, t, 2); }
export function signOut() { tok = null; rmSync(FILE, { force: true }); }

// { configured: has a Client ID, signedIn: has tokens, product: "premium" | "free" | … once known }
export function status() {
  const t = loadTok();
  return { configured: Boolean(clientId()), signedIn: Boolean(clientId() && t?.refresh_token), product: t?.product ?? null, name: t?.displayName ?? null, redirectUri: redirectUri() };
}
export const ready = () => status().signedIn;

// ---- sign-in (Authorization Code with PKCE) ----------------------------------------------------------------------
const pending = new Map();   // state → { verifier, at }
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function loginUrl() {
  if (!clientId()) throw new Error("Add your Spotify Client ID in Settings → Features & apps first.");
  const verifier = b64url(randomBytes(48)), state = b64url(randomBytes(16));
  pending.set(state, { verifier, at: Date.now() });
  for (const [k, v] of pending) if (Date.now() - v.at > 15 * 60_000) pending.delete(k);
  const p = new URLSearchParams({ client_id: clientId(), response_type: "code", redirect_uri: redirectUri(), scope: SCOPES.join(" "), state,
    code_challenge_method: "S256", code_challenge: b64url(createHash("sha256").update(verifier).digest()) });
  return `${ACCOUNTS}/authorize?${p}`;
}
export async function finishLogin({ code, state, error }) {
  if (error) throw new Error(error === "access_denied" ? "Spotify sign-in was cancelled." : `Spotify said: ${error}`);
  const pend = pending.get(state); pending.delete(state);
  if (!pend) throw new Error("That sign-in link expired. Start again from Dayspring.");
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: pend.verifier });
  saveTok(t);
  try { const me = await api("GET", "/me"); saveTok({ ...loadTok(), product: me.product ?? null, displayName: me.display_name ?? null, country: me.country ?? null, userId: me.id ?? null }); } catch { /* profile is optional */ }
  return status();
}
async function tokenRequest(form) {
  const r = await fetch(`${ACCOUNTS}/api/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId(), ...form }), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.error === "invalid_grant" ? "Spotify signed Dayspring out. Say \"sign in to Spotify\" to connect again." : `Spotify sign-in failed (${j.error_description || j.error || r.status}).`);
    if (j.error === "invalid_grant") signOut();
    throw e;
  }
  const old = loadTok() ?? {};
  return { ...old, access_token: j.access_token, refresh_token: j.refresh_token || old.refresh_token, scope: j.scope, expires_at: Date.now() + (j.expires_in ?? 3600) * 1000 - 60_000 };
}
let refreshing = null;
export async function accessToken() {
  const t = loadTok();
  if (!clientId() || !t?.refresh_token) throw new Error("Spotify isn't connected yet. Say \"sign in to Spotify\".");
  if (t.access_token && Date.now() < t.expires_at) return t.access_token;
  refreshing ??= tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token }).then((n) => { saveTok(n); return n.access_token; }).finally(() => { refreshing = null; });
  return refreshing;
}

// ---- the Web API -------------------------------------------------------------------------------------------------
export async function api(method, path, body, { retry = true } = {}) {
  const token = await accessToken();
  const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  if (r.status === 401 && retry) { const t = loadTok(); if (t) saveTok({ ...t, expires_at: 0 }); return api(method, path, body, { retry: false }); }
  if (r.status === 429 && retry) { await new Promise((ok) => setTimeout(ok, Math.min(5, Number(r.headers.get("retry-after")) || 1) * 1000)); return api(method, path, body, { retry: false }); }
  if (r.status === 204 || r.status === 202) return null;
  const text = await r.text();
  const j = text ? (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })() : null;
  if (!r.ok) {
    const reason = j?.error?.reason, msg = j?.error?.message ?? r.status;
    const e = new Error(reason === "PREMIUM_REQUIRED" ? "Spotify needs Premium to play songs inside Dayspring." :
      reason === "NO_ACTIVE_DEVICE" || r.status === 404 ? "The Dayspring screen isn't connected to Spotify right now. Is the screen open?" :
      r.status === 403 ? `Spotify refused that (${msg}). If you just made the developer app, add your Spotify account to its user list.` : `Spotify: ${msg}`);
    e.status = r.status; e.reason = reason; throw e;
  }
  return j;
}

const q = (o) => new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""))).toString();
export const me = () => api("GET", "/me");
export const playerState = () => api("GET", "/me/player?additional_types=track,episode");
export const devices = async () => (await api("GET", "/me/player/devices"))?.devices ?? [];
export const transfer = (deviceId, play = false) => api("PUT", "/me/player", { device_ids: [deviceId], play });
export const pause = (deviceId) => api("PUT", `/me/player/pause?${q({ device_id: deviceId })}`);
export const resume = (deviceId) => api("PUT", `/me/player/play?${q({ device_id: deviceId })}`);
export const next = (deviceId) => api("POST", `/me/player/next?${q({ device_id: deviceId })}`);
export const previous = (deviceId) => api("POST", `/me/player/previous?${q({ device_id: deviceId })}`);
export const seek = (ms, deviceId) => api("PUT", `/me/player/seek?${q({ position_ms: Math.max(0, Math.round(ms)), device_id: deviceId })}`);
export const volume = (pct, deviceId) => api("PUT", `/me/player/volume?${q({ volume_percent: Math.max(0, Math.min(100, Math.round(pct))), device_id: deviceId })}`);
export const shuffle = (on, deviceId) => api("PUT", `/me/player/shuffle?${q({ state: Boolean(on), device_id: deviceId })}`);
export const repeat = (mode, deviceId) => api("PUT", `/me/player/repeat?${q({ state: ["off", "track", "context"].includes(mode) ? mode : "off", device_id: deviceId })}`);
export const addToQueue = (uri, deviceId) => api("POST", `/me/player/queue?${q({ uri, device_id: deviceId })}`);
// play({ uris }) plays tracks; play({ context_uri }) plays an album, playlist or artist
export const play = (deviceId, { uris, context_uri, offset, position_ms } = {}) =>
  api("PUT", `/me/player/play?${q({ device_id: deviceId })}`, { ...(uris ? { uris } : {}), ...(context_uri ? { context_uri } : {}), ...(offset ? { offset } : {}), ...(position_ms ? { position_ms } : {}) });

// Search (Spotify caps Development Mode apps at 10 results).
export async function search(query, type = "track", limit = 5) {
  const j = await api("GET", `/search?${q({ q: query, type, limit: Math.min(10, limit) })}`);
  const key = `${type}s`;
  return (j?.[key]?.items ?? []).filter(Boolean).map((x) => ({ uri: x.uri, name: x.name, by: (x.artists ?? []).map((a) => a.name).join(", ") || x.owner?.display_name || "", art: (x.images ?? x.album?.images ?? [])[0]?.url ?? null }));
}
const trackOut = (x) => x && ({ uri: x.uri, name: x.name, by: (x.artists ?? []).map((a) => a.name).join(", ") || x.show?.name || "", art: (x.album?.images ?? x.images ?? [])[0]?.url ?? null, ms: x.duration_ms ?? null });
export async function myPlaylists() {
  const j = await api("GET", "/me/playlists?limit=50");
  const me = loadTok()?.userId;
  return (j?.items ?? []).filter(Boolean).map((p) => ({ uri: p.uri, name: p.name, id: p.id, art: p.images?.[0]?.url ?? null, count: p.items?.total ?? p.tracks?.total ?? null, mine: !me || p.owner?.id === me || p.collaborative }));
}
export async function likedTracks(max = 50) {
  const j = await api("GET", `/me/tracks?limit=${Math.min(50, max)}`);
  return (j?.items ?? []).map((i) => trackOut(i.track)).filter(Boolean);
}
export async function likedUris(max = 50) { return (await likedTracks(max)).map((t) => t.uri); }
export async function recentlyPlayed(max = 20) {
  const j = await api("GET", `/me/player/recently-played?limit=${Math.min(50, max)}`);
  const seen = new Set();
  return (j?.items ?? []).map((i) => trackOut(i.track)).filter((t) => t && !seen.has(t.uri) && seen.add(t.uri));
}
// The owner's most-played artists or tracks: range short_term (~4 weeks) | medium_term (~6 months) | long_term (years)
export async function topItems(type = "artists", range = "medium_term", limit = 10) {
  const j = await api("GET", `/me/top/${type === "tracks" ? "tracks" : "artists"}?${q({ time_range: range, limit: Math.min(50, limit) })}`);
  return (j?.items ?? []).filter(Boolean).map((x) => type === "tracks" ? trackOut(x) : { uri: x.uri, name: x.name, genres: x.genres ?? [], art: x.images?.[0]?.url ?? null, url: x.external_urls?.spotify ?? null });
}
export async function queue() {
  const j = await api("GET", "/me/player/queue");
  return { current: trackOut(j?.currently_playing), next: (j?.queue ?? []).slice(0, 20).map(trackOut).filter(Boolean) };
}
// "like this song": Spotify's 2026 library endpoint (PUT /me/library with URIs); the older /me/tracks as a fallback
export async function like(uri, on = true) {
  try { return await api(on ? "PUT" : "DELETE", `/me/library?${q({ uris: uri })}`); }
  catch (e) { if (e.status !== 404 && e.status !== 405) throw e; const id = uri.split(":").pop(); return api(on ? "PUT" : "DELETE", `/me/tracks?${q({ ids: id })}`); }
}
export async function addToPlaylist(playlistId, uri) {
  try { return await api("POST", `/playlists/${playlistId}/items`, { uris: [uri] }); }
  catch (e) { if (e.status !== 404) throw e; return api("POST", `/playlists/${playlistId}/tracks`, { uris: [uri] }); }
}
export async function findMyPlaylist(name) {
  const all = await myPlaylists(), want = String(name).toLowerCase().replace(/\bplaylist\b/, "").trim();
  return all.find((p) => p.name.toLowerCase() === want) ?? all.find((p) => p.name.toLowerCase().includes(want)) ?? all.find((p) => want.split(/\s+/).every((w) => p.name.toLowerCase().includes(w))) ?? null;
}
// "https://open.spotify.com/track/ID?si=…" or "spotify:track:ID" → "spotify:track:ID"
export function toUri(s) {
  const t = String(s ?? "").trim();
  if (/^spotify:(track|album|playlist|artist|episode):[A-Za-z0-9]+$/.test(t)) return t;
  const m = /open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist|artist|episode)\/([A-Za-z0-9]+)/.exec(t);
  return m ? `spotify:${m[1]}:${m[2]}` : null;
}

// Pick what to play from how the owner asked. Returns { body: {uris|context_uri}, title, artist, art, shuffle }.
export async function resolve({ query = "", type = "track", url }) {
  const u = toUri(url) ?? toUri(query);
  if (u) return { body: u.startsWith("spotify:track:") || u.startsWith("spotify:episode:") ? { uris: [u] } : { context_uri: u }, title: query || null };
  if (type === "liked") {
    const uris = await likedUris(50);
    if (!uris.length) throw new Error("Your Liked Songs look empty on Spotify.");
    return { body: { uris: shuffleArr(uris) }, title: "Liked Songs", shuffle: true };
  }
  if (type === "myplaylist") {
    const pick = await findMyPlaylist(query);
    if (!pick) { const all = await myPlaylists(); throw new Error(`I couldn't find a playlist of yours called "${query}".${all.length ? ` You have: ${all.slice(0, 6).map((p) => p.name).join(", ")}.` : ""}`); }
    return { body: { context_uri: pick.uri }, title: pick.name, art: pick.art };
  }
  const t = ["track", "album", "playlist", "artist", "show", "episode"].includes(type) ? type : "track";
  const [hit] = await search(query, t, 3);
  if (!hit) throw new Error(`Nothing on Spotify matched "${query}".`);
  return { body: t === "track" || t === "episode" ? { uris: [hit.uri] } : { context_uri: hit.uri }, title: hit.name, artist: hit.by, art: hit.art };
}
function shuffleArr(a) { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; }
