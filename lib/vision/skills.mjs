// Pictures and people by voice (no AI needed) and as AI tools.
//   "describe this picture" · "describe it in detail" · "what does this say?" · "read the text in this image"
//   "who is in this picture?" · "show me photos of Sarah" · "when did I last see Mike in a photo?"
//   "tell me about Sarah" · "when did I last talk to Mike?" · "what's going on with Sarah lately?" · "remind me to check on Tom"
//   answers to "Who's in this picture?" ("me, Sarah and her husband Tom"), to "Is this also Sarah?", and to
//   "Is 'Mike R' the same as Mike?"; "the one on the left is Sarah"; "delete Sarah from my people" (asks first)
//   handle(text, { photo, surface }) → { reply, photo? } | null      TOOLS · runTool(name, input)
import * as describe from "./describe.mjs";
import * as ask from "./ask.mjs";
import * as vsettings from "./settings.mjs";
import * as models from "./models.mjs";
import * as photos from "../photos.mjs";
import * as store from "../store.mjs";
import * as llm from "../llm.mjs";

let P = null, L = null;
const people = async () => (P ??= await import("../people/index.mjs"));
const library = async () => (L ??= await import("./library.mjs"));
const listWords = (a) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);
const pct = (x) => `${Math.round(x * 100)}%`;
const clean = (s) => String(s ?? "").trim().replace(/[?.!]+$/, "").replace(/'s$/i, "");

// ---- what's on the screen ----
function current(photoId) {
  const s = describe.onScreen(photoId);
  if (!s) return null;
  if (s.kind === "photo") { const path = photos.filePath(s.id); return path ? { kind: "photo", id: s.id, path } : null; }
  return s;
}
const target = (s) => (s.kind === "photo" ? s.path : s.buffer ?? s.url);

// ---- things waiting for an answer ----
let consentWait = null, suggestWait = null, deleteWait = null;
const fresh = (x, ms = 10 * 60_000) => x && Date.now() - x.at < ms;
const YES = /^(yes|yeah|yep|yup|sure|ok(ay)?|go ahead|please do|do it|that'?s (right|him|her|them)|it is|correct)\b/i;
const NO = /^(no|nope|nah|not (him|her|them)|don'?t|wrong|different)\b/i;

async function describeScreen(opts, { detail = "normal", question = "" } = {}) {
  const s = current(opts.photo);
  if (!s) return { reply: "There isn't a picture on the screen right now. Say \"show me a photo\" and ask again." };
  const ai = llm.supportsImages();
  const r = await describe.describeImage(target(s), { detail, question, source: s.kind === "web" ? "web" : null });
  let reply = r.text;
  // the AI could look, but the owner hasn't said yes to sending pictures yet: ask once
  if (!r.usedAI && ai && !vsettings.get().aiDescribe && !vsettings.get().aiConsentAt && !fresh(consentWait)) {
    consentWait = { at: Date.now(), detail, question, photo: opts.photo };
    reply += ` I can describe pictures in much more detail with ${llm.label().split(" ·")[0]}, but that sends the picture to them. Want me to do that from now on?`;
  }
  return { reply, open: Boolean(consentWait && fresh(consentWait, 5000)) };
}

async function whoInScreen(opts) {
  const s = current(opts.photo);
  if (!s) return { reply: "There isn't a picture on the screen right now." };
  if (s.kind === "web") {
    const r = await describe.describeImage(target(s), { detail: "brief", source: "web" });
    return { reply: `I don't identify people in pictures from the web. ${r.faces.count ? `I see ${r.faces.count === 1 ? "one person" : r.faces.count + " people"}. ` : ""}${r.usedAI ? r.text : ""}`.trim() };
  }
  if (!vsettings.get().faces) {
    const r = await describe.describeImage(s.path, { detail: "brief", ai: false });
    return { reply: `${r.faces.count ? `I see ${r.faces.count === 1 ? "one face" : r.faces.count + " faces"}, but face recognition is off.` : "I don't see any faces in it."} You can turn it on in Settings → Photos & people. It stays on this computer.` };
  }
  if (!models.status().installed) return { reply: "Face recognition is on, but its models haven't downloaded yet. Settings → Photos & people shows the download." };
  const Lb = await library(), Pp = await people();
  const list = (await Lb.indexed(s.id)) ? await Lb.facesIn(s.id) : await Lb.indexOne(s.id, { path: s.path });
  if (!list.length) return { reply: "I don't see anyone in this one." };
  const n = list.length;
  const named = list.map((f, i) => ({ i, name: f.personId ? Pp.find(f.personId)?.name : null, suggest: f.suggest ? Pp.find(f.suggest.personId)?.name : null, conf: f.suggest?.conf }));
  const pos = (i) => (n === 1 ? "" : i === 0 ? " on the left" : i === n - 1 ? " on the right" : n === 3 ? " in the middle" : ` (${i + 1} from the left)`);
  const known = named.filter((x) => x.name), unknown = named.filter((x) => !x.name);
  let reply = known.length ? `${listWords(known.map((x) => x.name + pos(x.i)))}.` : "";
  if (unknown.length) {
    const guesses = unknown.filter((x) => x.suggest).map((x) => `maybe ${x.suggest}${pos(x.i)} (${pct(x.conf)})`);
    reply += ` ${unknown.length === 1 ? "There's one person" : `There are ${unknown.length} people`} I don't know yet${guesses.length ? `: ${guesses.join(", ")}` : ""}. Who ${unknown.length === 1 ? "is it" : "are they"}?`;
    await ask.markAsked(s.id, "who", store.todayISO(), { count: false });
    return { reply: reply.trim(), open: true };
  }
  return { reply };
}

async function askSuggestion(personId) {
  const Lb = await library(), Pp = await people();
  const s = (await Lb.suggestionsFor(personId))[0];
  if (!s) return "";
  suggestWait = { ...s, at: Date.now() };
  return ` I think ${s.label.toLowerCase()} in ${s.photos.length === 1 ? "another photo" : s.photos.length + " other photos"} might also be ${Pp.find(personId)?.name} (${pct(s.conf)} sure). Is that right?`;
}

// ---- voice (no AI needed) ----
const RE = {
  describe: /\b(describe|what'?s in|what is in|tell me what'?s in|what do you see in|look at) (this|that|the) (picture|photo|pic|image|one)\b|\bdescribe (it|this|that)( in (more )?detail| fully)?$/i,
  detail: /\b(in (more |full |great )?detail|fully|everything|thoroughly)\b/i,
  read: /\bwhat does (this|that|it) say\b|\bwhat does (this|that|the) (picture|photo|image|pic|sign) say\b|\bread (me )?(the )?(text|words|writing|sign|caption)( in| on)? (this|that|the)?\s*(picture|photo|image|pic)?\b|\bread (this|that) (picture|photo|image|sign)\b/i,
  who: /\bwho(?:'?s| is| are| all is)(?: all)? (?:in|on) (?:this|that|the) (?:picture|photo|pic|image)\b|^who(?:'?s| is) (?:this|that)\??$/i,
  showOf: /\bshow (?:me )?(?:the |my )?(?:photos|pictures|pics) (?:of|with) ([\p{L}][\p{L} .'-]{0,40})$/iu,
  lastPhoto: /\bwhen (?:did|was) (?:i )?(?:the )?last (?:see|saw|time i saw) ([\p{L}][\p{L} .'-]{0,40}?) in (?:a )?(?:photo|picture|pic)s?\b/iu,
  about: /^(?:tell me about|what do (?:you|we) know about) ([\p{L}][\p{L} .'-]{0,40})$/iu,
  talked: /\bwhen (?:did|was) (?:i )?(?:the )?last (?:talk|talked|speak|spoke|text|texted|call|called|hear from|heard from) (?:to |with )?([\p{L}][\p{L} .'-]{0,40})$|\blast time i (?:talked|spoke|texted|called) (?:to |with )?([\p{L}][\p{L} .'-]{0,40})$/iu,
  lately: /\bwhat'?s (?:going on|new|up|happening) with ([\p{L}][\p{L} .'-]{0,40}?)(?: lately| these days| recently)?$|\bhow'?s ([\p{L}][\p{L} .'-]{0,40}?) doing lately$/iu,
  checkOn: /^remind me to (?:check (?:on|in (?:on|with))|reach out to|call|text) ([\p{L}][\p{L} .'-]{0,40})$/iu,
  nameOnScreen: /^(?:the (?:one|person|guy|girl|lady|man|woman) (?:on the (?:far )?(?:left|right)|in the (?:middle|center))|(?:on the (?:left|right)|in the middle)) (?:is|'s) /i,
  forget: /^(?:delete|forget|remove) ([\p{L}][\p{L} .'-]{0,40}?)(?:'s profile)? (?:from (?:my )?people|from dayspring|completely|and (?:their|his|her) (?:faces|photos))$/iu,
};

export async function handle(text, opts = {}) {
  const t = String(text ?? "").trim(), q = t.toLowerCase().replace(/^(hey )?dayspring[, ]+/, "");
  if (!t) return null;
  // answers first
  if (fresh(consentWait, 3 * 60_000)) {
    const was = consentWait;
    if (YES.test(q)) { consentWait = null; vsettings.set({ aiDescribe: true }); return describeScreen({ photo: was.photo }, { detail: was.detail, question: was.question }).then((r) => ({ ...r, reply: `Okay. ${r.reply}` })); }
    if (NO.test(q)) { consentWait = null; vsettings.set({ aiDescribe: false }); return { reply: "Okay, pictures stay on this computer. I'll only describe what I can work out here." }; }
  }
  if (fresh(suggestWait)) {
    const s = suggestWait;
    if (YES.test(q)) { suggestWait = null; const Pp = await people(); const r = await Pp.answerFaceSuggestion(s.cluster, s.personId, true); return { reply: `Got it, that's ${Pp.find(s.personId)?.name} too (${r.faces} more).${await askSuggestion(s.personId)}`, open: Boolean(suggestWait) }; }
    if (NO.test(q)) { suggestWait = null; const Pp = await people(); await Pp.answerFaceSuggestion(s.cluster, s.personId, false); return { reply: "Okay, I'll keep them apart." }; }
  }
  if (fresh(deleteWait, 2 * 60_000)) {
    const d = deleteWait; deleteWait = null;
    if (YES.test(q)) { const r = await (await people()).remove(d.id); return { reply: `Deleted ${r.removed}: their profile, ${r.faces} face${r.faces === 1 ? "" : "s"} and ${r.messages} saved message${r.messages === 1 ? "" : "s"}.` }; }
    if (NO.test(q)) return { reply: "Okay, I kept them." };
  }
  const m1 = await ask.answerMatch(t); if (m1) return m1;
  // "Who's in this picture?" asked a moment ago (by the TV or by the owner): the answer
  // (not a question or another command: "what time is it?" while the question waits is just that)
  if (ask.pending() && !RE.describe.test(q) && !RE.read.test(q) && !RE.who.test(q) && !/\?\s*$/.test(t) && !/^(show|next|another|don'?t show|what|when|where|why|how|can|could|would|will|is|are|do|does|play|turn|set|remind|open|close|stop|pause|tell|read|describe)\b/.test(q)) {
    const r = await ask.answer(t);
    if (r) { const first = r.saved?.find((s) => s.id && s.name !== "you"); return { reply: r.reply + (first ? await askSuggestion(first.id) : ""), open: Boolean(suggestWait && fresh(suggestWait, 5000)) }; }
  }
  // "the one on the left is Sarah" (a photo with faces is on the screen)
  if (RE.nameOnScreen.test(q) && opts.photo && vsettings.get().faces) {
    await ask.markAsked(opts.photo, "who", store.todayISO(), { count: false });
    const r = await ask.answer(t.replace(/^the (?:one|person|guy|girl|lady|man|woman) /i, "").replace(/ (?:is|'s) /i, " "));
    if (r) return { reply: r.reply };
  }
  if (RE.read.test(q)) {
    const s = current(opts.photo);
    if (!s) return { reply: "There isn't a picture on the screen right now." };
    const r = await describe.readText(target(s));
    if (!r.available) return { reply: "Windows' text recognition isn't set up for your language on this computer. Adding the language in Windows Settings → Time & language turns it on." };
    return { reply: r.text ? `It says: ${r.text.replace(/\n+/g, ". ")}` : "I don't see any text in it." };
  }
  if (RE.who.test(q)) return whoInScreen(opts);
  if (RE.describe.test(q) || (/^describe\b/.test(q) && current(opts.photo))) return describeScreen(opts, { detail: RE.detail.test(q) ? "full" : "normal" });

  const Pp = await people();
  const tt = t.replace(/^(hey )?dayspring[, ]+/i, "").replace(/[?.!]+$/, "").trim();
  let m;
  if ((m = RE.showOf.exec(tt))) {
    const name = clean(m[1]); const p = Pp.find(name);
    let ids = [];
    if (p && vsettings.get().faces) ids = (await (await library()).photosOf(p.id)).map((x) => x.id);
    if (!ids.length) ids = photos.search(name).map((x) => x.id);   // the owner's own words about their photos
    if (!ids.length) return { reply: p ? `I haven't found ${p.name} in your photos yet.${vsettings.get().faces ? "" : " Face recognition is off, so I only know photos you've told me about."}` : `I don't know anyone called ${name} yet.` };
    photos.setFocus(ids);
    return { reply: `Here ${ids.length === 1 ? "is the photo" : `are ${ids.length} photos`} of ${p?.name ?? name}. Say "next photo" for the next one.`, photo: "next" };
  }
  if ((m = RE.lastPhoto.exec(tt))) { const r = await Pp.spoken.lastPhoto(clean(m[1])); if (r) return { reply: r }; }
  if ((m = RE.talked.exec(tt))) { const r = await Pp.spoken.lastTalked(clean(m[1] ?? m[2])); if (r) return { reply: r }; }
  if ((m = RE.lately.exec(tt))) { const r = await Pp.spoken.lately(clean(m[1] ?? m[2])); if (r) return { reply: r }; }
  if ((m = RE.about.exec(tt)) && !/\b(this|that) (photo|picture|pic|image)\b/i.test(t)) { const name = clean(m[1]); if (Pp.find(name)) return { reply: await Pp.spoken.about(name) }; }
  if ((m = RE.checkOn.exec(tt))) {
    const p = Pp.find(clean(m[1]));
    if (p) {
      const { add } = await import("../reminders.mjs");
      const date = store.addDays(store.todayISO(), 1);
      add({ date, time: "10:00", text: `Check on ${p.name}` });
      Pp.addFact(p.id, `You wanted to check on ${p.name} (reminder for ${date}).`, "told");
      return { reply: `Okay. I'll remind you tomorrow at 10 to check on ${p.name}.` };
    }
  }
  if ((m = RE.forget.exec(tt))) { const p = Pp.find(clean(m[1])); if (p) { deleteWait = { id: p.id, at: Date.now() }; return { reply: `Delete everything I know about ${p.name}: their profile, their faces in your photos and any saved messages? Say yes to delete.`, open: true }; } }
  return null;
}

// ---- AI tools ----
export const TOOLS = [
  { name: "describe_image", description: "Describe a picture: the one on the Dayspring screen (target 'screen'), one of the owner's photos (photo_id), or a local file (path). Uses Windows' own text recognition, the photo's date and camera, faces (named only for the owner's own photos and only the people they named), and the owner's own words. Pictures from the web are described but NEVER identified. detail: brief | normal | full. question: what they asked about it.",
    input_schema: { type: "object", properties: { target: { type: "string", enum: ["screen", "photo", "file"] }, photo_id: { type: "string" }, path: { type: "string" }, detail: { type: "string", enum: ["brief", "normal", "full"] }, question: { type: "string" } } } },
  { name: "read_image_text", description: "Read the text in a picture (Windows OCR, on this computer): the one on the screen, or photo_id / path.", input_schema: { type: "object", properties: { photo_id: { type: "string" }, path: { type: "string" } } } },
  { name: "who_is_in_photo", description: "Who is in the owner's photo on the screen (or photo_id), left to right, from the faces they've named (local face recognition; only when it's on). Never for web pictures.", input_schema: { type: "object", properties: { photo_id: { type: "string" } } } },
  { name: "name_people_in_photo", description: "Save who is in the photo on the screen (or photo_id) from the owner's own words, e.g. 'me, Sarah and her husband Tom' or 'Sarah on the left, Tom on the right, at the lake'. Names go on the faces (left to right), what was going on into the photo catalogue.", input_schema: { type: "object", properties: { photo_id: { type: "string" }, words: { type: "string" } }, required: ["words"] } },
  { name: "photos_of_person", description: "The owner's photos a person is in (by the faces they named, or their own words about photos); show: true puts them on the screen.", input_schema: { type: "object", properties: { name: { type: "string" }, show: { type: "boolean" } }, required: ["name"] } },
  { name: "people_profile", description: "Everything about one person in the owner's life: relationship, nickname, notes, connections to other people, prayer requests (private ones by title only), relationship goals, past and upcoming events together, how many photos they're in and when, last contact. Message contents are NOT included (see person_messages).", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "people_list", description: "The people Dayspring knows (names, relationship) and the unnamed face groups found in the owner's photos.", input_schema: { type: "object", properties: {} } },
  { name: "person_update", description: "Change what's saved about a person: relation, nickname, a new name, a fact/note, or a connection to another person (connect_to + connection, e.g. 'husband').", input_schema: { type: "object", properties: { name: { type: "string" }, relation: { type: "string" }, nickname: { type: "string" }, new_name: { type: "string" }, note: { type: "string" }, connect_to: { type: "string" }, connection: { type: "string" } }, required: ["name"] } },
  { name: "people_merge", description: "Two entries are the same person: keep the first, fold the second into it (notes, faces, messages).", input_schema: { type: "object", properties: { keep: { type: "string" }, merge: { type: "string" } }, required: ["keep", "merge"] } },
  { name: "face_group_action", description: "Fix face groups from the owner's photos: name a group (cluster + name), mark a face 'not a person' (face_id), ignore a group or person, split faces into a new group (face_ids), or merge two groups (cluster + into).", input_schema: { type: "object", properties: { action: { type: "string", enum: ["name", "not_person", "ignore", "split", "merge"] }, cluster: { type: "string" }, into: { type: "string" }, face_id: { type: "string" }, face_ids: { type: "array", items: { type: "string" } }, name: { type: "string" } }, required: ["action"] } },
  { name: "person_messages", description: "Saved text messages and calls with a person, ONLY when the owner asks something that needs them (\"what did Sarah say about Friday?\"). Only works when the owner allowed the AI to read saved messages.", input_schema: { type: "object", properties: { name: { type: "string" }, limit: { type: "number" } }, required: ["name"] } },
];
const NAMES = new Set(TOOLS.map((t) => t.name));

export async function runTool(name, input = {}, opts = {}) {
  if (!NAMES.has(name)) return undefined;
  try {
    const Pp = await people();
    const photoPath = (id) => (id ? photos.filePath(id) : null);
    const screenTarget = () => { const s = current(opts.photo); return s ? { input: target(s), web: s.kind === "web" } : null; };
    switch (name) {
      case "describe_image": {
        let inp = null, web = false;
        if (input.photo_id) inp = photoPath(input.photo_id);
        else if (input.path) inp = input.path;
        else { const s = screenTarget(); if (s) { inp = s.input; web = s.web; } }
        if (!inp) return { error: "No picture to describe (nothing on the screen)." };
        const r = await describe.describeImage(inp, { detail: input.detail ?? "normal", question: input.question ?? "", source: web ? "web" : null });
        return { description: r.text, text_in_picture: r.ocr.text || null, faces: r.faces.count, people: r.source === "library" ? r.faces.names : undefined, taken: r.facts.taken, camera: r.facts.camera, source: r.source, used_ai_vision: r.usedAI, identification: r.source === "web" ? "not allowed for web pictures" : undefined };
      }
      case "read_image_text": { const inp = photoPath(input.photo_id) ?? input.path ?? screenTarget()?.input; if (!inp) return { error: "No picture." }; return describe.readText(inp); }
      case "who_is_in_photo": {
        const r = await whoInScreen({ photo: input.photo_id ?? opts.photo });
        const id = input.photo_id ?? describe.onScreen(opts.photo)?.id;
        // the faces themselves (left to right), so face_group_action can fix one: never for web pictures
        const list = id && photos.filePath(id) && vsettings.get().faces ? await (await library()).facesIn(id).catch(() => []) : [];
        return { answer: r.reply, faces: list.map((f, i) => ({ face_id: f.id, position: i + 1, of: list.length, cluster: f.cluster, name: f.personId ? Pp.find(f.personId)?.name : null })) };
      }
      case "name_people_in_photo": {
        const id = input.photo_id ?? describe.onScreen(opts.photo)?.id;
        if (!id || !photos.filePath(id)) return { error: "That only works for the owner's own photos." };
        await ask.markAsked(id, vsettings.get().faces ? "both" : "what", store.todayISO(), { count: false });
        return { saved: (await ask.answer(input.words))?.reply };
      }
      case "photos_of_person": {
        const p = Pp.find(input.name);
        let ids = p && vsettings.get().faces ? (await (await library()).photosOf(p.id)).map((x) => x.id) : [];
        if (!ids.length) ids = photos.search(input.name).map((x) => x.id);
        if (input.show && ids.length) { photos.setFocus(ids); return { count: ids.length, shown: true, _photo: "next" }; }
        return { count: ids.length, photos: ids.slice(0, 20).map((id) => photos.info(id)) };
      }
      case "people_profile": { const r = await Pp.profile(input.name, { withMessages: false }); if (!r) return { error: `I don't know anyone called ${input.name}.` }; return { ...r, faces: { ...r.faces, thumb: undefined } }; }
      case "people_list": return { people: Pp.list().map((p) => ({ name: p.name, relation: p.relation, nickname: p.nickname })), unnamedFaceGroups: vsettings.get().faces ? (await (await library()).clusters({ unnamedOnly: true })).map((c) => ({ cluster: c.id, label: c.label, faces: c.faces, photos: c.photos.length })) : [] };
      case "person_update": {
        const p = Pp.find(input.name) ?? Pp.ensure(input.name);
        if (input.relation || input.nickname || input.new_name) Pp.update(p.id, { relation: input.relation, nickname: input.nickname, name: input.new_name });
        if (input.note) Pp.addFact(p.id, input.note, "told");
        if (input.connect_to) { const o = Pp.find(input.connect_to) ?? Pp.ensure(input.connect_to); Pp.connect(p.id, o.id, input.connection ?? ""); }
        return { person: Pp.find(p.id) };
      }
      case "people_merge": { const a = Pp.find(input.keep), b = Pp.find(input.merge); if (!a || !b) return { error: "I need two people I know." }; return { person: await Pp.merge(a.id, b.id) }; }
      case "face_group_action": {
        if (!vsettings.get().faces) return { error: "Face recognition is off (Settings → Photos & people)." };
        if (input.action === "name") return Pp.nameFaces({ cluster: input.cluster, face: input.face_id, name: input.name });
        if (input.action === "not_person") return Pp.notPerson(input.face_id);
        if (input.action === "ignore") return Pp.ignoreFaces(input.cluster ?? Pp.find(input.name)?.id);
        if (input.action === "split") return Pp.splitFaces(input.face_ids ?? [input.face_id]);
        if (input.action === "merge") return Pp.mergeFaceGroups(input.into, input.cluster);
        return { error: "Unknown action." };
      }
      case "person_messages": {
        if (!vsettings.get().aiMessages) return { error: "The owner hasn't allowed the AI to read saved messages (Settings → Photos & people). Tell them they can ask offline: 'what's going on with <name> lately?'" };
        const p = Pp.find(input.name); if (!p) return { error: `I don't know anyone called ${input.name}.` };
        const r = await Pp.profile(p.id);
        return { messages: r.messages.slice(-(input.limit ?? 30)).map((m) => ({ at: m.at, dir: m.dir, text: m.text })), calls: r.calls.slice(-10).map((c) => ({ start: c.start, app: c.app, durationSec: c.durationSec })) };
      }
    }
  } catch (e) { return { error: e.message }; }
  return undefined;
}
