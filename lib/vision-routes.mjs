// Settings → Photos & people, and the People page (public/people.html). Local only, like every /api route.
//   GET  /api/vision/settings                 → { settings, models, index, helper, messages, ai }
//   POST /api/vision/settings { …patch }      → the same (turning faces on starts the look through the photos)
//   POST /api/vision/models/install           → downloads the face models (the owner pressed "Download", size shown)
//   POST /api/vision/index/pause · /resume
//   POST /api/vision/faces/delete-all         → every face fingerprint, thumbnail and the models; faces turned off
//   POST /api/vision/messages/delete-all      → every saved text and call
//   POST /api/vision/describe { photoId, detail }   → a description of one of the owner's photos
//   GET  /api/people                           → [{ id, name, relation, nickname, photos, thumb }]
//   GET  /api/people/:id?private=1             → the whole profile (private prayer details only with private=1)
//   POST /api/people/:id { name, relation, nickname, note, connectTo, connection } · DELETE /api/people/:id
//   POST /api/people/merge { keep, merge }
//   GET  /api/people/faces/groups              → unnamed face groups with thumbnails
//   POST /api/people/faces/name { cluster | face, name, relation } · POST /api/people/faces/action { action, … }
//   GET  /api/people/thumb/:faceId             → a small JPEG
//   GET  /api/people/questions                 → texts waiting for "is this the same person?" and suggested connections
//   POST /api/people/questions/match { id, personId | null } · POST /api/people/questions/suggestion { id, status }
import * as vsettings from "./vision/settings.mjs";
import * as models from "./vision/models.mjs";
import * as library from "./vision/library.mjs";
import * as helper from "./vision/helper.mjs";
import * as describe from "./vision/describe.mjs";
import * as people from "./people/index.mjs";
import * as comms from "./people/comms.mjs";
import * as photos from "./photos.mjs";
import * as llm from "./llm.mjs";

async function state() {
  return { settings: vsettings.get(), models: models.status(), index: library.status(), helper: await helper.available().catch((e) => ({ ok: false, error: e.message })),
    messages: await comms.counts().catch(() => null), ai: { canSee: llm.supportsImages(), provider: llm.label() } };
}

export async function handle(req, res, { m, p, q, send, readJSON }) {
  if (!p.startsWith("/vision/") && !p.startsWith("/people")) return false;
  try {
    if (p === "/vision/settings" && m === "GET") return send(res, 200, await state()), true;
    if (p === "/vision/settings" && m === "POST") {
      const b = await readJSON(req);
      vsettings.set(b ?? {});
      if (b?.faces === true && models.status().installed) library.start().catch(() => {});
      return send(res, 200, await state()), true;
    }
    if (p === "/vision/models/install" && m === "POST") { models.install().then(() => { if (vsettings.get().faces) library.start().catch(() => {}); }).catch((e) => console.log(`face models: ${e.message}`)); return send(res, 202, await state()), true; }
    if (p === "/vision/index/pause" && m === "POST") { library.pause(); return send(res, 200, await state()), true; }
    if (p === "/vision/index/resume" && m === "POST") { library.resume(); return send(res, 200, await state()), true; }
    if (p === "/vision/faces/delete-all" && m === "POST") {
      library.stop(); vsettings.set({ faces: false });
      await library.wipe(); models.remove();
      try { (await import("./activity.mjs")).log("people", { action: "deleted-all-face-data" }); } catch { /* optional */ }
      return send(res, 200, await state()), true;
    }
    if (p === "/vision/messages/delete-all" && m === "POST") {
      await comms.deleteAll();
      try { (await import("./activity.mjs")).log("people", { action: "deleted-all-saved-messages" }); } catch { /* optional */ }
      return send(res, 200, await state()), true;
    }
    if (p === "/vision/describe" && m === "POST") {
      const b = await readJSON(req); const f = photos.filePath(b?.photoId);
      if (!f) return send(res, 404, { error: "That isn't one of your photos." }), true;
      const r = await describe.describeImage(f, { detail: b.detail ?? "normal" });
      return send(res, 200, { text: r.text, ocr: r.ocr.text, faces: r.faces.count, names: r.faces.names, usedAI: r.usedAI }), true;
    }
    if (p === "/people" && m === "GET") {
      const out = [];
      for (const x of people.list()) { const s = await library.summaryFor(x.id).catch(() => null); out.push({ id: x.id, name: x.name, relation: x.relation, nickname: x.nickname, photos: s?.photos ?? 0, thumb: s?.thumb ?? null }); }
      return send(res, 200, { people: out.sort((a, b) => a.name.localeCompare(b.name)), faces: vsettings.get().faces }), true;
    }
    if (p === "/people/merge" && m === "POST") { const b = await readJSON(req); return send(res, 200, { person: await people.merge(b.keep, b.merge) }), true; }
    if (p === "/people/faces/groups" && m === "GET") return send(res, 200, { groups: vsettings.get().faces ? await library.clusters({ unnamedOnly: q.get("all") !== "1" }) : [] }), true;
    if (p === "/people/faces/name" && m === "POST") { const b = await readJSON(req); return send(res, 200, await people.nameFaces(b)), true; }
    if (p === "/people/faces/action" && m === "POST") {
      const b = await readJSON(req);
      const r = b.action === "not_person" ? await people.notPerson(b.face) : b.action === "ignore" ? await people.ignoreFaces(b.cluster) : b.action === "split" ? await people.splitFaces(b.faces) : b.action === "merge" ? await people.mergeFaceGroups(b.into, b.cluster) : b.action === "suggestion" ? await people.answerFaceSuggestion(b.cluster, b.personId, Boolean(b.yes)) : null;
      if (!r) return send(res, 400, { error: "Unknown action." }), true;
      return send(res, 200, r), true;
    }
    const th = p.match(/^\/people\/thumb\/([\w-]{8,40})$/);
    if (th && m === "GET") { const b64 = await library.thumbOf(th[1]); if (!b64) return send(res, 404, { error: "no thumbnail" }), true; res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" }); res.end(Buffer.from(b64, "base64")); return true; }
    if (p === "/people/questions" && m === "GET") {
      const ms = await comms.pendingMatches();
      return send(res, 200, { matches: ms.map((x) => ({ id: x.id, raw: x.raw, candidates: x.candidates.map((id) => people.find(id)).filter(Boolean).map((c) => ({ id: c.id, name: c.name })) })), suggestions: await comms.suggestions() }), true;
    }
    if (p === "/people/questions/match" && m === "POST") { const b = await readJSON(req); return send(res, 200, await comms.answerMatch(b.id, b.personId ?? null)), true; }
    if (p === "/people/questions/suggestion" && m === "POST") {
      const b = await readJSON(req); const s = await comms.answerSuggestion(b.id, b.status === "yes" ? "added" : "dismissed");
      if (b.status === "yes" && s) { const who = people.ensure(s.name, { relation: s.relatedTo ? `${people.find(s.relatedTo)?.name}'s ${s.relation}` : s.relation }); if (s.relatedTo) people.connect(who.id, s.relatedTo, s.relation); }
      return send(res, 200, { ok: true }), true;
    }
    const pm = p.match(/^\/people\/([\w-]{8,40})$/);
    if (pm && m === "GET") { const r = await people.profile(pm[1], { openPrivate: q.get("private") === "1" }); return send(res, r ? 200 : 404, r ?? { error: "I don't know that person." }), true; }
    if (pm && m === "POST") {
      const b = await readJSON(req);
      if (b.name || b.relation !== undefined || b.nickname !== undefined) people.update(pm[1], { name: b.name, relation: b.relation, nickname: b.nickname });
      if (b.note) people.addFact(pm[1], b.note, "told");
      if (b.connectTo) { const o = people.find(b.connectTo) ?? people.ensure(b.connectTo); people.connect(pm[1], o.id, b.connection ?? ""); }
      return send(res, 200, await people.profile(pm[1])), true;
    }
    if (pm && m === "DELETE") return send(res, 200, await people.remove(pm[1])), true;
  } catch (e) { return send(res, 400, { error: e.message }), true; }
  return false;
}
