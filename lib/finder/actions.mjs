// What the viewer's buttons do to a file, each through the same rules as everything else Dayspring does with files:
//   deleteFile(id, { ask, via })   → the Recycle Bin, only when "Can delete files" is on, and only after a yes (the first
//                                   call asks: { needsConfirm, text, ask }; the second, with that ask, does it)
//   copyFile(id, { ask })          → "Name (copy).ext" next to it (needs "Can create files" there; backed up and logged)
//   setAvatar(id)                  → the avatar's picture (Settings → Look & feel), from a picture
//   info(id) · describe(id)        → a picture's facts; its description and the text in it (lib/vision/describe.mjs)
// The changes themselves go through lib/abilities.mjs (permissions, fail-safes, backups, the activity log); a click on
// the screen is the owner's own yes, bound to exactly that change (lib/confirm.mjs issueApproved).
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import * as permissions from "../permissions.mjs";
import * as safety from "../filesafety.mjs";
import * as activity from "../activity.mjs";
import * as confirm from "../confirm.mjs";
import * as index from "./index.mjs";
import * as captions from "./captions.mjs";
import { resolve, sizeText } from "./skills.mjs";
import { facts } from "./exif.mjs";
import { NEEDS_DECODE, typeName } from "./kinds.mjs";
import { photoWords } from "./search.mjs";

const asks = new Map();      // ask token → { id, what, at }
const ASK_MS = 2 * 60_000;
function newAsk(id, what) { const t = randomBytes(9).toString("base64url"); asks.set(t, { id, what, at: Date.now() }); for (const [k, v] of asks) if (Date.now() - v.at > ASK_MS * 2) asks.delete(k); return t; }
function takeAsk(t, id, what) { const a = asks.get(String(t ?? "")); if (!a) return false; asks.delete(String(t)); return a.id === id && a.what === what && Date.now() - a.at <= ASK_MS; }
let abilitiesMod = null;
const abilities = async () => (abilitiesMod ??= await import("../abilities.mjs"));

export async function deleteFile(id, { ask = null, approve = false, via = "screen" } = {}) {
  const it = resolve(id);
  if (it.error || it.denied) return it.denied ? { denied: true, text: it.text } : { error: it.error };
  if (it.source === "drive") return { error: "That one is in Google Drive. Delete it there (or ask me to move it to Drive's trash)." };
  const k = permissions.check("delete", it.path);
  if (!k.ok) { activity.log("blocked", { path: it.path, reason: k.reason, text: k.text, via: "file_viewer", op: "delete" }); return { denied: true, text: k.text }; }
  const A = await abilities();
  if (!(approve || (ask && takeAsk(ask, it.id, "delete")))) {
    // the question, in the same words as every other delete (it always asks)
    const r = await A.run("delete_item", { path: it.path }, { via: "offline" });
    if (r?.denied || r?.error) return r;
    return { needsConfirm: true, text: r?.text ?? `Should I move ${it.name} to the Recycle Bin? Are you sure?`, ask: newAsk(it.id, "delete"), name: it.name };
  }
  const op = { tool: "delete_item", op: "delete", paths: [safety.realPath(it.path).toLowerCase()] };
  const token = confirm.issueApproved(op, { what: `delete_item ${it.path}`, via: via === "voice" ? "voice" : "click" });
  const r = await A.run("delete_item", { path: it.path, confirm_token: token }, { via: "offline", userConfirmed: true });
  if (r?.recycled) { index.removeItem(it.id); index.forgetDir(it.path); captions.forget(it.id); return { recycled: it.name, backup: Boolean(r.backup) }; }
  return r?.needsConfirm ? { error: "It still needs a yes. Try again." } : r;
}

function copyName(path) {
  const dir = dirname(path), ext = extname(path), base = basename(path, ext);
  for (let i = 1; i < 100; i++) { const p = join(dir, `${base} (copy${i > 1 ? ` ${i}` : ""})${ext}`); if (!existsSync(p)) return p; }
  return join(dir, `${base} (copy ${Date.now()})${ext}`);
}
export async function copyFile(id, { ask = null, via = "screen" } = {}) {
  const it = resolve(id);
  if (it.error || it.denied) return it.denied ? { denied: true, text: it.text } : { error: it.error };
  if (it.source === "drive") return { error: "That one is in Google Drive." };
  const dest = copyName(it.path);
  const k = permissions.check("create", dest, { kind: "file" });
  if (!k.ok) { activity.log("blocked", { path: dest, reason: k.reason, text: k.text, via: "file_viewer", op: "copy" }); return { denied: true, text: k.text }; }
  const A = await abilities();
  let token;
  if (ask) {
    if (!takeAsk(ask, it.id, "copy")) return { error: "That question ran out. Try again." };
    token = confirm.issueApproved({ tool: "copy_item", op: "copy", paths: [safety.realPath(it.path).toLowerCase(), safety.realPath(dest).toLowerCase()], to: dest.toLowerCase() }, { what: `copy_item ${it.path}`, via: "click" });
  }
  // the click is his yes to an ordinary copy; an important file still gets its warning first
  const r = await A.run("copy_item", { from: it.path, to: dest, ...(token ? { confirm_token: token } : {}) }, { via: "offline", userConfirmed: true });
  if (r?.needsConfirm) return { needsConfirm: true, text: r.text, ask: newAsk(it.id, "copy"), name: it.name };
  if (r?.copied) { const x = index.addItem(dest); return { copied: basename(dest), id: x?.id ?? null, where: index.whereOf(dest) }; }
  return r;
}

// the viewer's "Open in the default app" button: the owner's own click, but something that runs when opened (or the
// Programs permission set to "ask") still asks first, and the yes is bound to this one file
export async function openDefaultClick(id, { ask = null } = {}) {
  const S = await import("./skills.mjs");
  const it = resolve(id);
  if (it.error || it.denied) return it.denied ? { denied: true, text: it.text } : { error: it.error };
  if (ask) {
    if (!takeAsk(ask, it.id, "default")) return { error: "That question ran out. Try again." };
    const token = confirm.issueApproved({ tool: "file_open_default", path: String(it.real ?? it.path).toLowerCase() }, { what: `open ${it.name}`, via: "click" });
    return S.openDefault(it, { confirm_token: token, via: "screen" });
  }
  const r = S.openDefault(it, { owner: true, via: "screen" });
  return r.needsConfirm ? { needsConfirm: true, text: r.text, ask: newAsk(it.id, "default"), name: it.name } : r;
}

async function pictureBytes(it, max = 12 * 1024 * 1024) {
  if (NEEDS_DECODE.has(it.ext) || it.size > max) {
    const helper = await import("../vision/helper.mjs");
    const j = await helper.jpeg(it.real ?? it.path, 1600);
    return Buffer.from(j.data, "base64");
  }
  return readFileSync(it.real ?? it.path);
}
export async function setAvatar(id, { via = "screen" } = {}) {
  const it = resolve(id);
  if (it.error || it.denied) return it.denied ? { denied: true, text: it.text } : { error: it.error };
  if (it.kind !== "image") return { error: "Only a picture can be the avatar." };
  const looks = await import("../looks/index.mjs");
  let buf; try { buf = await pictureBytes(it); } catch (e) { return { error: `I couldn't read that picture (${e.message}).` }; }
  if (!looks.sniffImage(buf)) { try { const helper = await import("../vision/helper.mjs"); buf = Buffer.from((await helper.jpeg(it.real ?? it.path, 1600)).data, "base64"); } catch { return { error: "That picture's format can't be an avatar. JPEG, PNG, WebP or GIF work." }; } }
  const r = looks.saveImage("idle", buf);
  looks.set({ avatar: { style: "image" } }, "avatar");
  activity.log("looks.avatar", { path: it.path, via });
  return { avatar: it.name, url: r.url };
}

// a picture's facts (and any file's basics) for the info panel
export async function info(id) {
  const it = resolve(id);
  if (it.error || it.denied) return it.denied ? { denied: true, text: it.text } : { error: it.error };
  const base = { id: it.id, name: it.name, type: typeName(it.ext), kind: it.kind, ext: it.ext, size: it.size, sizeText: sizeText(it.size), modified: it.mtime ? new Date(it.mtime).toISOString() : null, source: it.source ?? "local",
    where: it.source === "drive" ? it.drive : index.whereOf(it.path), folder: it.source === "drive" ? null : dirname(it.path), link: it.link ?? null };
  if (it.source === "drive") return base;
  const can = { delete: permissions.check("delete", it.path).ok, copy: permissions.check("create", join(dirname(it.path), "x" + extname(it.path)), { kind: "file" }).ok, programs: permissions.check("programs").ok };
  const out = { ...base, can };
  try { const st = statSync(it.real ?? it.path); out.created = st.birthtime?.toISOString?.() ?? null; } catch { /* fine */ }
  if (it.kind === "image") {
    Object.assign(out, facts(it.real ?? it.path));
    if (NEEDS_DECODE.has(it.ext) || !out.taken) {
      try { const helper = await import("../vision/helper.mjs"); const a = await helper.analyze(it.real ?? it.path, ["facts"], { max: 64 }); if (a.width && !out.width) { out.width = a.width; out.height = a.height; } if (a.facts?.taken) out.taken = a.facts.taken; const cam = [a.facts?.make, a.facts?.model].filter(Boolean).join(" "); if (cam && !out.camera) out.camera = cam; }
      catch { /* no helper here: what the file says */ }
    }
    const said = photoWords(it.path); if (said) out.ownWords = said;
    const cap = captions.get(it.id); if (cap) { out.description = cap.description; out.ocr = cap.ocr; }
  }
  if (it.kind === "video" || it.kind === "audio") {
    try { const ml = await import("../medialib/library.mjs"); const t = ml.byId(it.id); if (t) Object.assign(out, { title: t.title, artist: t.artist, album: t.album, duration: t.duration, width: t.width, height: t.height }); } catch { /* not indexed there */ }
    out.captions = sidecars(it).map((s, n) => ({ n, label: s.label }));
  }
  return out;
}
// .srt / .vtt next to a video, with the same name ("movie.srt", "movie.en.srt")
export function sidecars(it) {
  if (!it?.path) return [];
  const dir = dirname(it.path), base = basename(it.path, extname(it.path)).toLowerCase();
  let names = []; try { names = (existsSync(dir) ? readdirSync(dir) : []); } catch { /* none */ }
  return names.filter((n) => /\.(srt|vtt)$/i.test(n) && n.toLowerCase().startsWith(base + ".")).slice(0, 8).map((n) => ({ path: join(dir, n), label: (/\.([a-z]{2,3}(?:-[a-z]{2})?)\.(srt|vtt)$/i.exec(n)?.[1] ?? "Captions").toUpperCase() }));
}

export async function describe(id) {
  const it = resolve(id);
  if (it.error || it.denied) return it.denied ? { denied: true, text: it.text } : { error: it.error };
  if (it.kind !== "image") return { error: "Only pictures can be described." };
  const d = await import("../vision/describe.mjs");
  const r = await d.describeImage(it.real ?? it.path, { detail: "normal" });
  captions.set(it.id, { description: r.text, ocr: r.ocr?.text ?? "", usedAI: r.usedAI });
  activity.log("file.read", { path: it.path, via: "file_viewer", describe: true, usedAI: r.usedAI || undefined });
  return { description: r.text, ocr: r.ocr?.text ?? "", usedAI: r.usedAI, taken: r.facts?.taken ?? null, camera: r.facts?.camera ?? null };
}
