// The faces in the owner's own photos: found in the background, grouped into "unknown person 1, 2…", and linked to a
// person once the owner names them. Only the owner's photo library is ever looked through (the same folders and the
// same PRIVATE filter as the photos on the screen), and only with "Recognise faces in my photos" on. Faces are only
// ever matched against these photos and the people the owner named: never against anything from the web.
//
// Stored encrypted (DPAPI) in data/people/faces.bin: each face's place, fingerprint and group, which person it is, and a
// small thumbnail for each group. This module never names anyone by itself; lib/people does the naming.
//
//   status() · start() · pause() · resume() · stop() · indexOne(photoId)
//   facesIn(photoId) · photosOf(personId) · summaryFor(personId) · unnamedIn(photoId) · photosWithUnnamed()
//   clusters() · linkCluster(cid, personId) · linkFace(faceId, personId) · suggestionsFor(personId) · answerSuggestion(cid, yes)
//   mergeClusters(a, b) · split(faceIds) · notPerson(faceId) · ignore(cid|personId) · forgetPerson(personId) · reassignPerson(from, to)
//   match(emb) (named people only) · wipe()
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import * as photos from "../photos.mjs";
import * as faces from "./faces.mjs";
import * as helper from "./helper.mjs";
import * as models from "./models.mjs";
import * as vsettings from "./settings.mjs";
import { secureFile } from "./secure.mjs";

const DATA = () => process.env.DAYSPRING_PEOPLE_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "people");
// SFace cosine similarity: 0.363 is OpenCV's "same person" line. Above AUTO a face joins a named person by itself;
// between SUGGEST and AUTO it's only a question ("Is this also Sarah?"); JOIN groups unnamed faces together.
export const T = { SUGGEST: 0.363, JOIN: 0.45, AUTO: 0.6 };
export const SOURCE = (from = "photo") => ({ app: "dayspring", user: "local", from });
const empty = () => ({ v: 1, photos: {}, faces: {}, clusters: {}, thumbs: {}, next: 1 });
let store = null;
const S = () => (store ??= secureFile(join(DATA(), "faces.bin"), empty));
export async function db() { return S().load(); }
const changed = () => { cents = null; S().changed(); };
export const flush = () => S().flush();

// ---- centroids (the average fingerprint of each group and each named person) ----
let cents = null;
function centroids(d) {
  if (cents) return cents;
  const byCluster = new Map(), byPerson = new Map();
  const add = (map, k, e) => { let c = map.get(k); if (!c) { c = { sum: new Float32Array(e.length), n: 0 }; map.set(k, c); } for (let i = 0; i < e.length; i++) c.sum[i] += e[i]; c.n++; };
  for (const f of Object.values(d.faces)) {
    if (!f.emb || f.state === "notPerson") continue;
    const e = faces.decodeEmb(f.emb);
    if (f.cluster) add(byCluster, f.cluster, e);
    if (f.personId && f.state !== "suggested") add(byPerson, f.personId, e);
  }
  const norm = (c) => { let n = 0; for (const x of c.sum) n += x * x; n = Math.sqrt(n) || 1; return c.sum.map((x) => x / n); };
  cents = { clusters: new Map([...byCluster].map(([k, c]) => [k, norm(c)])), people: new Map([...byPerson].map(([k, c]) => [k, norm(c)])) };
  return cents;
}
const best = (map, e, skip = () => false) => { let top = null; for (const [k, c] of map) { if (skip(k)) continue; const s = faces.similarity(e, c); if (!top || s > top.sim) top = { id: k, sim: s }; } return top; };

function newCluster(d, personId = null) {
  const id = `c${d.next++}`;
  d.clusters[id] = { id, label: d.next - 1, personId, ignored: false, thumb: null, created: new Date().toISOString(), source: SOURCE("photo"), visibility: "private" };
  return d.clusters[id];
}
const clusterOfPerson = (d, personId) => Object.values(d.clusters).find((c) => c.personId === personId) ?? null;

// A new face: which group, and is it someone the owner named?
function place(d, face) {
  const e = faces.decodeEmb(face.emb), c = centroids(d);
  const ignored = (cid) => d.clusters[cid]?.ignored;
  const person = best(c.people, e);
  if (person && person.sim >= T.AUTO) {
    const cl = clusterOfPerson(d, person.id) ?? newCluster(d, person.id);
    Object.assign(face, { cluster: cl.id, personId: person.id, state: "auto", conf: round(person.sim) });
    return;
  }
  const group = best(c.clusters, e, (cid) => Boolean(d.clusters[cid]?.personId));
  const cl = group && group.sim >= T.JOIN ? d.clusters[group.id] : newCluster(d);
  Object.assign(face, { cluster: cl.id, personId: null, state: ignored(cl.id) ? "ignored" : "unnamed" });
  if (person && person.sim >= T.SUGGEST) face.suggest = { personId: person.id, conf: round(person.sim) };
}
const round = (x) => Math.round(x * 1000) / 1000;

// ---- indexing one photo ----
export async function indexOne(photoId, { path = photos.filePath(photoId) } = {}) {
  if (!path) throw new Error("That photo isn't in your photo folders.");
  const found = await faces.find(path, { embed: true });
  if (found.engine !== "models") throw new Error("The face models aren't installed.");
  return ingest(photoId, found, path);
}
// the faces found in one photo → the store (tests give it made-up fingerprints; path: for thumbnails)
export async function ingest(photoId, found, path = null) {
  const d = await db();
  const photo = photos.byId(photoId);
  d.photos[photoId] = { at: new Date().toISOString(), n: found.faces.length, taken: found.taken ?? photo?.taken ?? null };
  for (const f of found.faces) {
    const face = { id: randomUUID(), photoId, box: f.box, score: f.score, emb: f.emb, at: new Date().toISOString(), source: SOURCE("photo"), visibility: "private" };
    place(d, face);
    d.faces[face.id] = face; cents = null;
    const cl = d.clusters[face.cluster];
    if (cl && !cl.thumb && path) { try { d.thumbs[face.id] = (await helper.thumb(path, f.box, 96)).toString("base64"); cl.thumb = face.id; } catch { /* no thumbnail: fine */ } }
  }
  changed();
  return facesIn(photoId);
}

// ---- the background look through the owner's photos ----
const run = { running: false, paused: false, done: 0, total: 0, lastError: null, current: null, stopAsked: false };
const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); });
export function status() { return { ...run, enabled: vsettings.get().faces, models: models.status().installed, engine: faces.workerStatus() }; }
export async function start({ throttleMs = Number(process.env.DAYSPRING_FACE_THROTTLE_MS || 1500) } = {}) {
  if (run.running) return status();
  const s = vsettings.get();
  if (!s.faces || s.indexPaused || !models.status().installed) return status();
  run.running = true; run.stopAsked = false; run.lastError = null;
  (async () => {
    try {
      const d = await db();
      const list = (await photos.scanNow()).filter((p) => !photos.isHidden?.(p.id));
      run.total = list.length; run.done = list.filter((p) => d.photos[p.id]).length;
      for (const p of list) {
        if (run.stopAsked || run.paused || !vsettings.get().faces) break;
        if (d.photos[p.id]) continue;
        run.current = p.name;
        try { await indexOne(p.id, { path: p.path }); }
        catch (e) { run.lastError = e.message; d.photos[p.id] = { at: new Date().toISOString(), n: 0, error: String(e.message).slice(0, 80) }; changed(); }
        run.done++;
        await sleep(throttleMs);
      }
      await flush();
    } catch (e) { run.lastError = e.message; }
    finally { run.running = false; run.current = null; }
  })();
  return status();
}
export function pause() { run.paused = true; vsettings.set({ indexPaused: true }); return status(); }
export function resume() { run.paused = false; vsettings.set({ indexPaused: false }); start().catch(() => {}); return status(); }
export function stop() { run.stopAsked = true; faces.stopWorker(); return status(); }
export const waitIdle = async (ms = 600_000) => { const t = Date.now(); while (run.running && Date.now() - t < ms) await sleep(200); return status(); };

// ---- what's known ----
// faces in a photo, left to right: { id, box, personId, cluster, label, state, suggest }
export async function facesIn(photoId) {
  const d = await db();
  return Object.values(d.faces).filter((f) => f.photoId === photoId && f.state !== "notPerson")
    .sort((a, b) => a.box[0] + a.box[2] / 2 - (b.box[0] + b.box[2] / 2))
    .map((f) => ({ id: f.id, box: f.box, personId: f.personId ?? null, cluster: f.cluster, label: d.clusters[f.cluster]?.label ?? null, state: f.state, suggest: f.suggest ?? null, conf: f.conf ?? null }));
}
export async function indexed(photoId) { return Boolean((await db()).photos[photoId]); }
export async function unnamedIn(photoId) { return (await facesIn(photoId)).filter((f) => !f.personId && f.state !== "ignored"); }
export async function photosWithUnnamed() {
  const d = await db(), out = new Set();
  for (const f of Object.values(d.faces)) if (!f.personId && f.state === "unnamed" && !d.clusters[f.cluster]?.ignored) out.add(f.photoId);
  return out;
}
export async function photosOf(personId) {
  const d = await db();
  const ids = [...new Set(Object.values(d.faces).filter((f) => f.personId === personId && f.state !== "suggested").map((f) => f.photoId))];
  return ids.map((id) => ({ id, taken: d.photos[id]?.taken ?? null })).sort((a, b) => String(b.taken).localeCompare(String(a.taken)));
}
export async function summaryFor(personId) {
  const d = await db(), list = await photosOf(personId);
  const cl = clusterOfPerson(d, personId);
  const dates = list.map((p) => p.taken).filter(Boolean).sort();
  return { photos: list.length, photoIds: list.map((p) => p.id), firstSeen: dates[0] ?? null, lastSeen: dates[dates.length - 1] ?? null, thumb: cl?.thumb ? d.thumbs[cl.thumb] ?? null : null, cluster: cl?.id ?? null };
}
export async function clusters({ unnamedOnly = false } = {}) {
  const d = await db(), counts = new Map(), pics = new Map();
  for (const f of Object.values(d.faces)) { if (!f.cluster || f.state === "notPerson") continue; counts.set(f.cluster, (counts.get(f.cluster) ?? 0) + 1); if (!pics.has(f.cluster)) pics.set(f.cluster, new Set()); pics.get(f.cluster).add(f.photoId); }
  return Object.values(d.clusters).filter((c) => counts.get(c.id) && (!unnamedOnly || (!c.personId && !c.ignored)))
    .map((c) => ({ id: c.id, label: `Unknown person ${c.label}`, personId: c.personId, ignored: c.ignored, faces: counts.get(c.id), photos: [...(pics.get(c.id) ?? [])], thumb: c.thumb ? d.thumbs[c.thumb] ?? null : null, source: c.source, visibility: c.visibility }))
    .sort((a, b) => b.faces - a.faces);
}
export async function thumbOf(faceId) { return (await db()).thumbs[faceId] ?? null; }
export async function face(faceId) { const d = await db(); const f = d.faces[faceId]; return f ? { ...f, emb: undefined } : null; }
export async function clusterOf(faceId) { const d = await db(); return d.faces[faceId]?.cluster ?? null; }

// the best named person for a fingerprint (only people the owner named; never anyone else)
export async function match(embB64) {
  const d = await db(), e = faces.decodeEmb(embB64);
  const top = best(centroids(d).people, e);
  return top && top.sim >= T.SUGGEST ? { personId: top.id, conf: round(top.sim), sure: top.sim >= T.AUTO } : null;
}

// ---- naming (called by lib/people, which owns who people are) ----
// A group gets a person: every face in it, and any other group that's clearly the same person. Likely ones come back
// as suggestions with a confidence, never labelled silently.
export async function linkCluster(cid, personId) {
  const d = await db(), cl = d.clusters[cid];
  if (!cl) throw new Error("I don't have that group of faces.");
  const existing = clusterOfPerson(d, personId);
  if (existing && existing.id !== cid) { await mergeClusters(existing.id, cid); return linkCluster(existing.id, personId); }
  cl.personId = personId; cl.ignored = false;
  let n = 0;
  for (const f of Object.values(d.faces)) if (f.cluster === cid && f.state !== "notPerson") { f.personId = personId; f.state = "named"; delete f.suggest; n++; }
  cents = null;
  // other unnamed groups: very close ones join; likely ones are suggested
  const c = centroids(d), mine = c.clusters.get(cid), merged = [];
  if (mine) for (const [other, cen] of c.clusters) {
    if (other === cid || d.clusters[other]?.personId || d.clusters[other]?.ignored) continue;
    const sim = faces.similarity(mine, cen);
    if (sim >= T.AUTO) { await mergeClusters(cid, other); merged.push(other); }
  }
  changed();
  return { faces: n + 0, merged, suggestions: await suggestionsFor(personId) };
}
// one face is this person (the rest of its group isn't necessarily): it moves to the person's group
export async function linkFace(faceId, personId) {
  const d = await db(), f = d.faces[faceId];
  if (!f) throw new Error("I don't have that face.");
  const cl = d.clusters[f.cluster];
  // the face's group isn't anyone yet: the whole group is this person (naming applies to the whole group)
  if (cl && !cl.personId) return linkCluster(cl.id, personId);
  const target = clusterOfPerson(d, personId) ?? newCluster(d, personId);
  Object.assign(f, { cluster: target.id, personId, state: "named" }); delete f.suggest;
  if (!target.thumb) { target.thumb = f.id; if (!d.thumbs[f.id] && cl?.thumb === f.id) d.thumbs[f.id] = d.thumbs[cl.thumb]; }
  changed();
  return { faces: 1, merged: [], suggestions: await suggestionsFor(personId) };
}
// "Is this also Sarah?": unnamed groups that look like a named person, most likely first
export async function suggestionsFor(personId) {
  const d = await db(), c = centroids(d), mine = c.people.get(personId);
  if (!mine) return [];
  const out = [];
  for (const [cid, cen] of c.clusters) {
    const cl = d.clusters[cid];
    if (!cl || cl.personId || cl.ignored || cl.notThis?.includes(personId)) continue;
    const sim = faces.similarity(mine, cen);
    if (sim >= T.SUGGEST) out.push({ cluster: cid, label: `Unknown person ${cl.label}`, personId, conf: round(sim), photos: [...new Set(Object.values(d.faces).filter((f) => f.cluster === cid).map((f) => f.photoId))] });
  }
  return out.sort((a, b) => b.conf - a.conf);
}
export async function answerSuggestion(cid, personId, yes) {
  const d = await db(), cl = d.clusters[cid];
  if (!cl) throw new Error("I don't have that group of faces.");
  if (yes) return linkCluster(cid, personId);
  cl.notThis = [...new Set([...(cl.notThis ?? []), personId])];
  for (const f of Object.values(d.faces)) if (f.cluster === cid && f.suggest?.personId === personId) delete f.suggest;
  changed();
  return { faces: 0, merged: [], suggestions: [] };
}

// ---- fixing mistakes ----
export async function mergeClusters(into, from) {
  const d = await db();
  if (!d.clusters[into] || !d.clusters[from] || into === from) return { merged: false };
  const personId = d.clusters[into].personId ?? d.clusters[from].personId ?? null;
  for (const f of Object.values(d.faces)) if (f.cluster === from) { f.cluster = into; if (personId && f.state !== "notPerson") { f.personId = personId; f.state = "named"; } }
  d.clusters[into].personId = personId;
  if (!d.clusters[into].thumb && d.clusters[from].thumb) d.clusters[into].thumb = d.clusters[from].thumb;
  else if (d.clusters[from].thumb && d.clusters[from].thumb !== d.clusters[into].thumb) delete d.thumbs[d.clusters[from].thumb];
  delete d.clusters[from];
  changed();
  return { merged: true, into };
}
// all of one person's faces become another's (people.merge)
export async function reassignPerson(fromId, toId) {
  const d = await db();
  const a = clusterOfPerson(d, toId), b = clusterOfPerson(d, fromId);
  if (a && b) await mergeClusters(a.id, b.id); else if (b) b.personId = toId;
  for (const f of Object.values(d.faces)) { if (f.personId === fromId) f.personId = toId; if (f.suggest?.personId === fromId) f.suggest.personId = toId; }
  changed();
}
// these faces aren't who the group says: they become a new, unnamed group
export async function split(faceIds) {
  const d = await db(), ids = [].concat(faceIds).filter((id) => d.faces[id]);
  if (!ids.length) throw new Error("I don't have those faces.");
  const cl = newCluster(d);
  for (const id of ids) { const f = d.faces[id]; f.cluster = cl.id; f.personId = null; f.state = "unnamed"; delete f.suggest; }
  cl.thumb = ids.find((id) => d.thumbs[id]) ?? null;
  changed();
  return { cluster: cl.id, label: `Unknown person ${cl.label}`, faces: ids.length };
}
// "that's not a person" (a statue, a poster): its fingerprint is dropped
export async function notPerson(faceId) {
  const d = await db(), f = d.faces[faceId];
  if (!f) throw new Error("I don't have that face.");
  Object.assign(f, { state: "notPerson", personId: null, cluster: null }); delete f.emb; delete f.suggest; delete d.thumbs[faceId];
  for (const c of Object.values(d.clusters)) if (c.thumb === faceId) c.thumb = null;
  changed();
  return { ok: true };
}
// "ignore this person": never asked about again (their faces stay unnamed)
export async function ignore(cidOrPerson) {
  const d = await db();
  const cl = d.clusters[cidOrPerson] ?? clusterOfPerson(d, cidOrPerson);
  if (!cl) throw new Error("I don't have that person's faces.");
  cl.ignored = true;
  for (const f of Object.values(d.faces)) if (f.cluster === cl.id && !f.personId) f.state = "ignored";
  changed();
  return { ok: true, cluster: cl.id };
}
// delete a person's faces: fingerprints, thumbnails, the group itself
export async function forgetPerson(personId) {
  const d = await db();
  let n = 0;
  const cls = new Set(Object.values(d.clusters).filter((c) => c.personId === personId).map((c) => c.id));
  for (const [id, f] of Object.entries(d.faces)) if (f.personId === personId || cls.has(f.cluster)) { delete d.faces[id]; delete d.thumbs[id]; n++; }
  for (const f of Object.values(d.faces)) if (f.suggest?.personId === personId) delete f.suggest;
  for (const c of cls) { if (d.clusters[c]?.thumb) delete d.thumbs[d.clusters[c].thumb]; delete d.clusters[c]; }
  changed();
  await flush();
  return { faces: n };
}
export async function wipe() { await S().wipe(); cents = null; run.done = 0; }
export function _reset() { store?._reset(); store = null; cents = null; }
