// Tags from audio and video files: title, artist, album, genre, year, track and duration (ID3v1/v2 in MP3, Vorbis
// comments in FLAC/Ogg/Opus, MP4 atoms in M4A/MP4/M4V/MOV, ASF in WMA/WMV, RIFF INFO in WAV, Matroska tags in MKV/WebM),
// plus a video's width and height when the container says so. Read with music-metadata (pure JavaScript, no programs
// run), headers only: covers are skipped and an MP3's length comes from its header or bitrate, never a full scan.
import { parseFile } from "music-metadata";
import { basename, extname } from "node:path";

export const AUDIO = new Set(["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "wma"]);
export const VIDEO = new Set(["mp4", "m4v", "mkv", "webm", "mov", "avi", "wmv"]);
export const extOf = (p) => extname(String(p)).slice(1).toLowerCase();
export const kindOf = (p) => (AUDIO.has(extOf(p)) ? "audio" : VIDEO.has(extOf(p)) ? "video" : null);
// what a Chromium browser plays by itself (mkv usually works when it holds H.264/VP9 + AAC/Opus; checked when it plays)
export const BROWSER_PLAYS = new Set(["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "mp4", "m4v", "webm", "mov", "mkv"]);
export const NEVER_PLAYS = new Set(["wma", "wmv", "avi"]);
const clip = (s, n = 200) => (s == null ? "" : String(s).replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, n));

// "03 - Johnny Cash - Hurt.mp3" → { title: "Hurt", artist: "Johnny Cash", track: 3 } when a file has no tags
export function fromName(p) {
  let n = basename(String(p)).replace(/\.[^.]+$/, "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  let track = null, m;
  if ((m = /^(\d{1,3})[\s.)_-]+(.+)$/.exec(n)) && Number(m[1]) < 300) { track = Number(m[1]); n = m[2]; }
  const parts = n.split(/\s+[-–—]\s+/);
  return parts.length >= 2 ? { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim(), track } : { artist: "", title: n, track };
}

// MP4 / MOV: a video's size is in its track header ("tkhd": width and height as 16.16 numbers, its last 8 bytes). Looked
// for in the first and last 512 KB only (where the header sits), so a big video is never read through.
async function mp4Size(file) {
  const { open } = await import("node:fs/promises");
  let fh;
  try {
    fh = await open(file, "r");
    const size = (await fh.stat()).size, span = Math.min(size, 512 * 1024);
    for (const at of [...new Set([0, Math.max(0, size - span)])]) {
      const buf = Buffer.alloc(span);
      const { bytesRead } = await fh.read(buf, 0, span, at);
      let i = -1;
      while ((i = buf.indexOf("tkhd", i + 1, "latin1")) >= 4 && i < bytesRead) {
        const len = buf.readUInt32BE(i - 4);
        if (len < 84 || len > 120 || i - 4 + len > bytesRead) continue;
        const end = i - 4 + len, w = buf.readUInt32BE(end - 8) / 65536, h = buf.readUInt32BE(end - 4) / 65536;
        if (w >= 16 && h >= 16 && w < 16384 && h < 16384) return { width: Math.round(w), height: Math.round(h) };
      }
    }
  } catch { /* not readable */ } finally { await fh?.close().catch(() => {}); }
  return null;
}

export async function readTags(file, { timeoutMs = 15_000 } = {}) {
  const kind = kindOf(file);
  const guess = fromName(file);
  const base = { title: guess.title, artist: guess.artist, album: "", genre: "", year: null, track: guess.track, duration: null, width: null, height: null, tagged: false };
  let md = null;
  try {
    md = await Promise.race([parseFile(file, { duration: false, skipCovers: true, skipPostHeaders: true, includeChapters: false }), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), timeoutMs).unref?.())]);
  } catch { return { ...base, kind }; }
  const c = md?.common ?? {}, f = md?.format ?? {};
  let v = (f.trackInfo ?? []).find((t) => t.video)?.video ?? null;
  if (kind === "video" && !(v?.pixelWidth || v?.displayWidth) && /^(mp4|m4v|mov)$/.test(extOf(file))) { const sz = await mp4Size(file); if (sz) v = { pixelWidth: sz.width, pixelHeight: sz.height }; }
  const year = Number(c.year) || (c.date ? Number(String(c.date).slice(0, 4)) : null) || null;
  return {
    kind, tagged: Boolean(c.title || c.artist || c.album),
    title: clip(c.title) || base.title, artist: clip(c.artist ?? (c.artists ?? [])[0]) || base.artist, album: clip(c.album), genre: clip((c.genre ?? []).join(", "), 80),
    year: year && year > 1800 && year < 2200 ? year : null, track: c.track?.no ?? base.track,
    duration: Number.isFinite(f.duration) ? Math.round(f.duration) : null, width: v?.pixelWidth ?? v?.displayWidth ?? null, height: v?.pixelHeight ?? v?.displayHeight ?? null,
    codec: clip(f.codec, 40) || null, container: clip(f.container, 40) || null,
  };
}
