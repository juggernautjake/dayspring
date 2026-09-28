// Where an email's attachments can come from, besides the file picker on the screen (which the owner uses himself):
//   drive    a Google Drive file (Docs, Sheets and Slides come as PDF)
//   library  a song, video or picture from Dayspring's media library (only from folders file access allows right now)
//   file     a file on this computer by its path, only where Settings → Permissions lets Dayspring read
//   email    another email, attached whole as a .eml file
//   url      a picture on the web (a GIF someone picked): https only, pictures only, 10 MB at most
// Every one lands in the attachment store (lib/mail/mime.mjs, memory only) and returns its id, name, type and size.
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import * as mime from "./mime.mjs";
import * as permissions from "../permissions.mjs";
import * as activity from "../activity.mjs";

export async function fromDrive(ref, { account } = {}) {
  const drive = await import("../connectors/drive.mjs");
  const f = await drive.fileBytes(ref, { account });
  return { ...mime.addFile({ name: f.name, type: f.type, buf: f.buf, from: "drive" }), link: f.link };
}
export async function fromPath(path, { via = "email attachment" } = {}) {
  const k = permissions.check("read", path);
  if (!k.ok) { activity.log("blocked", { path: String(path), reason: k.reason, text: k.text, via }); throw Object.assign(new Error(k.text), { denied: true }); }
  const st = await stat(k.real).catch(() => null);
  if (!st?.isFile()) throw new Error(`I can't find ${path}.`);
  if (st.size > mime.MAX_ONE) throw new Error(`That file is ${Math.round(st.size / 1048576)} MB; email allows about 25 MB. Share it with a Drive link instead.`);
  const buf = await readFile(k.real);
  activity.log("file.read", { path: k.real, via, bytes: buf.length });
  return mime.addFile({ name: basename(k.full), buf, from: "computer" });
}
export async function fromLibrary(id) {
  const library = await import("../medialib/library.mjs");
  const x = library.byId(id);
  if (!x) throw new Error("That item isn't in the media library.");
  return fromPath(x.path, { via: "email attachment (media library)" });
}
export async function fromEmail(uid) {
  const mail = await import("./index.mjs");
  const e = await mail.rawOf(uid);
  return mime.addFile({ name: e.name, type: "message/rfc822", buf: e.buf, from: "email" });
}
export async function fromUrl(url, { name = "" } = {}) {
  const u = String(url ?? "");
  if (!/^https:\/\//i.test(u) || /^https:\/\/(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(u)) throw new Error("Only a picture on the web (https) can be attached this way.");
  const res = await fetch(u, { signal: AbortSignal.timeout(30_000), redirect: "follow" });
  if (!res.ok) throw new Error(`That picture couldn't be downloaded (${res.status}).`);
  const type = String(res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!/^image\//.test(type)) throw new Error("That link isn't a picture.");
  const len = Number(res.headers.get("content-length") ?? 0); if (len > 10 * 1024 * 1024) throw new Error("That picture is over 10 MB.");
  const buf = Buffer.from(await res.arrayBuffer()); if (buf.length > 10 * 1024 * 1024) throw new Error("That picture is over 10 MB.");
  const ext = type.split("/")[1].replace("jpeg", "jpg").replace(/\+.*$/, "");
  return mime.addFile({ name: (name ? String(name).replace(/[^\w .-]+/g, " ").trim().slice(0, 60) || "picture" : "picture") + (new RegExp(`\\.${ext}$`, "i").test(name) ? "" : "." + ext), type, buf, from: "web" });
}
export async function from(source, ref, opts = {}) {
  if (source === "drive") return fromDrive(ref, opts);
  if (source === "library") return fromLibrary(ref);
  if (source === "file" || source === "path") return fromPath(ref);
  if (source === "email") return fromEmail(ref);
  if (source === "url") return fromUrl(ref, opts);
  throw new Error("Attach from where? (drive, library, file, email or url)");
}
// the "From Dayspring" picker: media library items and Drive files that match (never the whole computer)
export async function search(q = "", { limit = 20 } = {}) {
  const out = [];
  try { const library = await import("../medialib/library.mjs"); for (const x of library.search(q, { limit: 12, min: 0.3 })) out.push({ source: "library", ref: x.id, name: x.title || basename(x.path), detail: `${x.kind} · ${x.folder ?? ""}`, size: x.size ?? null }); } catch { /* no library */ }
  try { const drive = await import("../connectors/drive.mjs"); if (drive.connected() && q) { const r = await drive.search({ query: q, limit: 12 }); for (const f of r.files) if (f.kind !== "folder") out.push({ source: "drive", ref: f.ref, name: f.name, detail: `${f.drive}'s Drive · ${f.kind}`, size: f.size }); } } catch { /* no Drive */ }
  return out.slice(0, limit);
}
