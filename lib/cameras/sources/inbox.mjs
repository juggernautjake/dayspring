// Cameras that send their pictures somewhere instead of being watched: cellular trail and hunting cameras, and anything
// whose app saves photos. No trail camera brand has a public API (docs/cameras.md), so there are two ways in:
//   folder: a folder the vendor's app syncs to (OneDrive, Google Drive, Dropbox), or an SD card's DCIM folder. Each new
//           picture is an event; videos in it are the camera's recordings.
//   email:  the camera's "email me each photo" setting (or its notification emails). The email system (lib/mail) is read
//           through its public functions only; photos come from the attachments, or from picture links in the email
//           (fetched from public addresses only, never the home network). The email feature can also hand messages in
//           as they arrive: cameras.ingestEmail(message) (lib/cameras/hooks.mjs).
// Both are "push" sources: poll() → [{ jpeg, at, meta }] (only what's new since last time; kept in cameras-state.json).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, basename } from "node:path";
import * as ff from "../ffmpeg.mjs";
import * as state from "../state.mjs";

const PICS = /\.(jpe?g|png|webp|heic)$/i, VIDS = /\.(mp4|mov|avi|mkv)$/i;
function walk(dir, depth = 3, out = []) {
  let list = []; try { list = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of list) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (depth > 0) walk(p, depth - 1, out); continue; }
    if (!PICS.test(e.name) && !VIDS.test(e.name)) continue;
    try { const s = statSync(p); out.push({ path: p, name: e.name, mtime: s.mtimeMs, size: s.size, video: VIDS.test(e.name) }); } catch { /* gone */ }
  }
  return out;
}
export async function toJpeg(buf, name = "") {
  if (ff.isJpeg(buf)) return buf;
  const r = await ff.run(["-i", "pipe:0", "-frames:v", "1", "-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], { input: buf, timeoutMs: 20_000 });
  if (!ff.isJpeg(r.stdout)) throw new Error(`${name || "That file"} isn't a picture I can read.`);
  return r.stdout;
}

export function folder(cam) {
  const dir = cam.conn.folder;
  const files = () => (existsSync(dir) ? walk(dir) : []);
  return {
    id: cam.id, name: cam.name, kind: "folder", room: cam.room ?? "", role: cam.role ?? "trail", publicFacing: Boolean(cam.publicFacing),
    push: true, caps: { live: false, clip: false, recordings: true },
    async snapshot() {
      const pics = files().filter((f) => !f.video).sort((a, b) => b.mtime - a.mtime);
      if (!pics.length) throw new Error(existsSync(dir) ? "There are no pictures in that folder yet." : "I can't find that folder.");
      return toJpeg(readFileSync(pics[0].path), pics[0].name);
    },
    // new pictures since last time. The first look only remembers what's there (an old SD card isn't 500 alerts), except
    // the newest one, so the Cameras page has something to show.
    async poll({ max = 30 } = {}) {
      if (!existsSync(dir)) throw new Error("I can't find that folder.");
      const pics = files().filter((f) => !f.video).sort((a, b) => a.mtime - b.mtime);
      const mark = state.get(cam.id, "folderMark", null);
      const seen = new Set(state.get(cam.id, "folderSeen", []));
      let fresh;
      if (mark === null) fresh = pics.slice(-1);
      else fresh = pics.filter((f) => f.mtime > mark - 2000 && !seen.has(f.path + "|" + f.size));
      fresh = fresh.slice(-max);
      const out = [];
      for (const f of fresh) {
        // a file still being copied or synced: wait for the next look
        if (Date.now() - f.mtime < 3000) continue;
        try { out.push({ jpeg: await toJpeg(readFileSync(f.path), f.name), at: new Date(f.mtime).toISOString(), meta: { file: basename(f.path) } }); seen.add(f.path + "|" + f.size); } catch { /* not a picture */ }
      }
      const newest = pics.length ? pics[pics.length - 1].mtime : Date.now();
      state.set(cam.id, "folderMark", Math.max(mark ?? 0, newest));
      state.set(cam.id, "folderSeen", [...seen].slice(-500));
      return out;
    },
    async recordings() {
      return files().filter((f) => f.video).sort((a, b) => b.mtime - a.mtime).slice(0, 300)
        .map((f) => ({ ref: `file:${f.path.slice(dir.length).replace(/^[\\/]+/, "")}`, name: f.name, at: new Date(f.mtime).toISOString(), size: f.size, type: extname(f.name).toLowerCase() === ".mp4" ? "video/mp4" : "video/*", kind: "file" }));
    },
    async fetchRecording(ref) {
      const rel = String(ref).replace(/^file:/, "");
      const full = join(dir, rel);
      if (!full.toLowerCase().startsWith(dir.toLowerCase()) || /(^|[\\/])\.\.([\\/]|$)/.test(rel) || !existsSync(full)) throw new Error("That file isn't in the camera's folder.");
      return { file: full, type: /\.mp4$/i.test(full) ? "video/mp4" : "video/*", name: basename(full) };
    },
  };
}

// ---- email ----
const URL_RE = /https?:\/\/[^\s"'<>)]+/g;
// links in a notification email that are (probably) the photo
export function photoLinks(text = "", html = "") {
  const all = [...String(text).matchAll(URL_RE), ...String(html).matchAll(URL_RE)].map((m) => m[0].replace(/&amp;/g, "&").replace(/[.,;]+$/, ""));
  const pics = all.filter((u) => /\.(jpe?g|png)(\?|$)/i.test(u) || /\/(photo|image|media|thumb|preview)s?\//i.test(u));
  return [...new Set(pics)].slice(0, 6);
}
export function matches(cam, msg) {
  const c = cam.conn ?? {};
  const from = String(msg.from?.address ?? msg.from ?? "").toLowerCase();
  const re = (f) => { try { return new RegExp(f, "i").test(from); } catch { return false; } };
  if (c.from && !String(c.from).toLowerCase().split(/[,;]\s*/).some((f) => f && (from.includes(f) || re(f)))) return false;
  if (c.subject && !String(msg.subject ?? "").toLowerCase().includes(String(c.subject).toLowerCase())) return false;
  return true;
}
let mailMod = null;
const mail = async () => (mailMod ??= await import("../../mail/index.mjs"));
let fetchImg = null;
const fetchImage = async (u) => { fetchImg ??= (await import("../../imagesearch.mjs")).fetchImage; return fetchImg(u, { timeoutMs: 20_000, maxBytes: 20e6 }); };
export function _setDeps(d) { if (d.mail) mailMod = d.mail; if (d.fetchImage) fetchImg = d.fetchImage; }

// the photos in one email (attachments first, links if there are none)
export async function photosIn(msg, { getAttachment } = {}) {
  const out = [];
  for (const a of msg.attachments ?? []) {
    if (!/^image\//i.test(a.type ?? "") && !PICS.test(a.name ?? "")) continue;
    try { const buf = a.buf ?? (getAttachment ? await getAttachment(a) : null); if (buf) out.push(await toJpeg(buf, a.name)); } catch { /* skip that one */ }
  }
  if (!out.length) for (const u of photoLinks(msg.text, msg.html)) { try { const r = await fetchImage(u); out.push(await toJpeg(r.buf ?? r)); } catch { /* skip */ } }
  return out;
}
export function email(cam) {
  const pending = [];   // messages handed in by the email feature (hooks.ingestEmail)
  return {
    id: cam.id, name: cam.name, kind: "email", room: cam.room ?? "", role: cam.role ?? "trail", publicFacing: Boolean(cam.publicFacing),
    push: true, caps: { live: false, clip: false, recordings: false },
    ingest(msg) { if (matches(cam, msg)) { pending.push(msg); return true; } return false; },
    async snapshot() { const last = state.get(cam.id, "lastPhoto", null); if (!last) throw new Error("No photo has come in by email yet."); return Buffer.from(last, "base64"); },
    async poll({ max = 20 } = {}) {
      const out = [];
      const seen = new Set(state.get(cam.id, "mailSeen", []));
      const take = async (msg, getAttachment) => {
        const key = msg.messageId ?? msg.id; if (key && seen.has(key)) return; if (key) seen.add(key);
        for (const jpeg of await photosIn(msg, { getAttachment })) out.push({ jpeg, at: msg.date ?? new Date().toISOString(), meta: { subject: String(msg.subject ?? "").slice(0, 120), from: String(msg.from?.address ?? msg.from ?? "").slice(0, 80) } });
      };
      while (pending.length) await take(pending.shift());
      // and anything in the mailbox the email feature can list (read-only; nothing is marked read or moved)
      try {
        const M = await mail();
        if (M.connected?.()) {
          const first = state.get(cam.id, "mailFirst", null) === null;
          const r = await M.list({ account: cam.conn.account || null, from: cam.conn.from ? String(cam.conn.from).split(/[,;]/)[0].trim() : "", query: cam.conn.subject || "", limit: max });
          const rows = (r.messages ?? []).sort((a, b) => String(a.date).localeCompare(String(b.date)));
          if (first) { for (const m of rows.slice(0, -1)) seen.add(m.id); state.set(cam.id, "mailFirst", Date.now()); }
          for (const m of rows) {
            if (seen.has(m.id) || !matches(cam, m)) continue;
            const full = await M.read(m.id).catch(() => null); if (!full) continue;
            await take({ ...full, id: m.id }, (a) => M.attachment(m.id, a.idx).then((x) => x.buf));
            seen.add(m.id);
          }
        }
      } catch (e) { if (e.code !== "not_connected") throw e; }
      state.set(cam.id, "mailSeen", [...seen].slice(-500));
      if (out.length) state.set(cam.id, "lastPhoto", (await ff.resize(out[out.length - 1].jpeg, 640).catch(() => out[out.length - 1].jpeg)).toString("base64"));
      return out;
    },
  };
}
