// The Music & Video browser over his own files (lib/medialib: the folders file access allows) and Google Drive.
//   Sections: recent (newest files), songs, videos, albums and artists (from the tags). Search: Songs · Videos · Albums ·
//   Artists, forgiving typos (library.search). Drive: recent media files, and search.
// Items carry only the index id (local) or the Drive ref: the server looks the file up again (and checks permissions)
// when it plays, exactly as the rest of Dayspring does.
import * as library from "../medialib/library.mjs";
import * as drive from "../connectors/drive.mjs";
import * as safety from "../filesafety.mjs";
import { mmss } from "../video/text.mjs";

const PAGE = 60;
// every indexed file that file access allows RIGHT NOW (an older index is never a way around a permission taken back)
function allowed() {
  const roots = library.roots().roots;
  return library.items().filter((x) => roots.some((r) => safety.under(x.path, r)));
}
export function toItem(x) {
  if (!x) return null;
  if (x.source === "drive") return { key: `d:${x.ref}`, source: "drive", kind: "file", media: x.kind, ref: x.ref, id: x.id, title: x.title, sub: [x.kind === "video" ? "Video" : "Audio", x.drive ? `${x.drive}'s Drive` : ""].filter(Boolean).join(" · "), secs: x.duration ?? null, length: x.duration ? mmss(x.duration) : "", art: "" };
  return { key: `f:${x.id}`, source: "local", kind: "file", media: x.kind, fileId: x.id, title: x.title || x.name, sub: [x.artist, x.album, x.kind === "video" ? "Video" : ""].filter(Boolean).join(" · ") || x.folder, artist: x.artist ?? "", album: x.album ?? "", year: x.year ?? null,
    secs: x.duration ?? null, length: x.duration ? mmss(x.duration) : "", folder: x.folder, art: "" };
}
const page = (list, cursor) => { const off = Number(cursor) || 0; return { items: list.slice(off, off + PAGE), next: off + PAGE < list.length ? off + PAGE : null, total: list.length }; };
export function status() { const s = library.status(); return { items: s.items, audio: s.audio, video: s.video, off: s.off, how: s.how, scanning: s.scanning, drive: drive.connected() }; }

// groups of files by a tag: albums (album + artist) or artists
function groupBy(list, by) {
  const m = new Map();
  for (const x of list) {
    const name = by === "album" ? x.album : x.artist;
    if (!name) continue;
    const k = by === "album" ? `${name}\u0000${x.artist ?? ""}` : name.toLowerCase();
    const g = m.get(k) ?? { name, artist: x.artist ?? "", count: 0, secs: 0 };
    g.count++; g.secs += x.duration ?? 0; m.set(k, g);
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name)).map((g) => ({ key: `${by}:${g.name}:${g.artist}`, source: "local", kind: by === "album" ? "localalbum" : "localartist", title: g.name,
    sub: by === "album" ? [g.artist, `${g.count} songs`].filter(Boolean).join(" · ") : `${g.count} songs`, album: by === "album" ? g.name : null, artist: by === "album" ? g.artist : g.name, count: g.count }));
}
export async function section(name, { cursor = 0 } = {}) {
  const st = library.status();
  if (st.off || !st.roots.length) return { items: [], next: null, total: 0, note: st.how ?? "No folders are allowed yet." };
  const all = allowed();
  if (name === "recent") return page([...all].sort((a, b) => b.mtime - a.mtime).map(toItem), cursor);
  if (name === "songs") return page(all.filter((x) => x.kind === "audio").sort(library.natural).map(toItem), cursor);
  if (name === "videos") return page(all.filter((x) => x.kind === "video").sort((a, b) => b.mtime - a.mtime).map(toItem), cursor);
  if (name === "albums") return page(groupBy(all.filter((x) => x.kind === "audio"), "album"), cursor);
  if (name === "artists") return page(groupBy(all.filter((x) => x.kind === "audio"), "artist"), cursor);
  throw new Error("There's no such list.");
}
// what's in one album or by one artist
export function groupPage({ kind, album, artist }) {
  const all = allowed().filter((x) => x.kind === "audio");
  const list = kind === "localalbum" ? all.filter((x) => x.album === album && (!artist || x.artist === artist)) : all.filter((x) => (x.artist ?? "").toLowerCase() === String(artist ?? "").toLowerCase());
  list.sort(library.natural);
  return { head: { key: `${kind}:${album ?? artist}`, source: "local", kind, title: kind === "localalbum" ? album : artist, sub: `${list.length} songs${kind === "localalbum" && artist ? " · " + artist : ""}` }, items: list.map(toItem), next: null, total: list.length };
}
export async function search(q, { only = null } = {}) {
  const words = String(q ?? "").trim().slice(0, 200);
  if (!words) return { groups: [] };
  const hits = library.search(words, { limit: 200 });
  const songs = hits.filter((x) => x.kind === "audio"), vids = hits.filter((x) => x.kind === "video");
  const albums = groupBy(songs.filter((x) => x.album && library.norm(x.album).includes(library.norm(words).split(" ")[0])), "album");
  const artists = groupBy(songs.filter((x) => x.artist && library.score({ artist: x.artist }, library.norm(words).split(" ")) > 0.4), "artist");
  const groups = [
    { id: "song", title: "Songs", items: songs.slice(0, only === "song" ? 200 : 30).map(toItem), next: null },
    { id: "filevideo", title: "Videos", items: vids.slice(0, only === "filevideo" ? 200 : 30).map(toItem), next: null },
    { id: "localalbum", title: "Albums", items: albums.slice(0, 20), next: null },
    { id: "localartist", title: "Artists", items: artists.slice(0, 20), next: null },
  ];
  return { groups: groups.filter((g) => g.items.length && (!only || g.id === only)) };
}
// Drive: recent media, and search
export async function driveSection({ cursor = 0 } = {}) {
  if (!drive.connected()) return { items: [], next: null, total: 0, note: "Google Drive isn't connected. Settings → Apps & connections → Google." };
  const r = await drive.recent({ days: 60, limit: 100 });
  const list = (r.files ?? []).filter((f) => f.kind === "audio" || f.kind === "video").map((f) => toItem({ source: "drive", ref: f.ref, id: `d:${f.ref}`, kind: f.kind, title: f.name.replace(/\.[a-z0-9]{2,4}$/i, ""), duration: f.duration, drive: f.drive }));
  return page(list, cursor);
}
export async function driveSearch(q) {
  if (!drive.connected()) return { groups: [] };
  const got = await drive.media(String(q ?? "").slice(0, 200), { limit: 50 });
  return { groups: [{ id: "drive", title: "In your Drive", items: got.map(toItem), next: null }].filter((g) => g.items.length) };
}
// back from browser items to the library's own entries (by id; never a path from the page)
export async function resolveItems(items) {
  const out = [];
  for (const it of items) {
    if (it.source === "local" && it.fileId) { const x = library.byId(it.fileId); if (x) out.push({ ...x, source: "local" }); }
    else if (it.source === "local" && (it.kind === "localalbum" || it.kind === "localartist")) out.push(...groupPage(it).items.map((f) => ({ ...library.byId(f.fileId), source: "local" })).filter((x) => x.id));
    else if (it.source === "drive" && it.ref && /^[\w:.-]{3,200}$/.test(it.ref)) out.push({ id: `d:${it.ref}`, source: "drive", ref: it.ref, kind: it.media === "video" ? "video" : "audio", title: String(it.title ?? "").slice(0, 200), artist: "", drive: String(it.sub ?? "").replace(/^.*· /, "").replace(/'s Drive$/, ""), duration: Number(it.secs) || null });
  }
  return out;
}
