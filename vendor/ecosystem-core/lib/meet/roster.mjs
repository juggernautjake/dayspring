// Who is in the meeting, and who is talking, from several independent sources merged into one list.
//
//   const r = createRoster({ lang: "en" });
//   r.snapshot("panel", ["Rich Alvarez", "Taylor Reed (You)"])     the People list (the most reliable: Meet's own list)
//   r.snapshot("tiles", [{ name: "Rich Alvarez", speaking: true }])  the name labels on the video tiles
//   r.snapshot("ocr", ["Jess Park"])                                  names read from a picture of the window (last resort)
//   r.seen("caption", "Rich Alvarez") · r.seen("chat", "Jess Park")   someone talked or wrote
//   r.joined("Sam Lee") · r.left("Sam Lee")                           Meet's "Sam Lee joined" / "… left" notices
//   r.count(4)                                                        the number on Meet's People button (everyone, you too)
//   r.speaking("Rich Alvarez", { source: "tile-border" })             a tile lit up as the active speaker
//   r.people() → [{ name, sources, confidence, presenting, joinedAt, leftAt, talkMs }]   (without the owner)
//   r.talking() → { name, self, source, confidence, at } | null        who is talking right now
//   r.status()  → { people, count, expected, agrees, self, sources: { panel: { n, at }, … }, impostor, talking }
//   r.clear()
//
// Sources and how much each is trusted (0..1). A list source (panel, tiles, ocr) is a whole picture: someone missing
// from the newest one is no longer counted by it. Event sources (caption, chat, notices) count until a "left" notice.
// The owner (Meet's "You", or the entry it marks "(You)") is kept apart: never listed as a guest.
//
// Impostors: Meet labels the owner "You". A guest who names themselves "You" is labelled the same, so it can't be told
// apart by name. When two entries in one list are both "You", or the People list marks the owner "(You)" AND also
// has a plain "You", impostor is set for the rest of the meeting: an app should then stop taking "You" as the owner.
import { displayName, nameKey, isSelfLabel, isUnknown, SELF_MARK } from "./names.mjs";

export const SOURCE_CONFIDENCE = { panel: 0.95, tiles: 0.85, caption: 0.8, chat: 0.8, toast: 0.7, ocr: 0.35 };
const LIST_SOURCES = new Set(["panel", "tiles", "ocr"]);
const PRESENTING = /\((?:presentation|presenting|pr[ée]sentation|presentaci[oó]n|pr[äa]sentation|apresenta[çc][aã]o)\)|\s+(?:is presenting|pr[ée]sente|est[aá] presentando|pr[äa]sentiert)$/i;

export function createRoster({ now = () => Date.now(), lang = "en", speakingMs = 4000, maxTalkGapMs = 3000 } = {}) {
  const people = new Map();                 // key → { name, key, marks: Map(source → at), joinedAt, leftAt, presenting, talkMs, lastSpokeAt, speakSource, speakConf }
  const sources = {};                       // source → { n, at }
  let expected = null, impostor = false, selfName = "", selfSeenAt = 0, selfTalk = { at: 0, source: null, conf: 0, talkMs: 0, lastSpokeAt: 0 };
  let language = lang;

  // "Taylor Reed (You)" → { self: true, name: "Taylor Reed" }; "You" → { self: true, name: "" }; "Rich (Presentation)" → presenting
  function parse(raw) {
    const o = raw && typeof raw === "object" ? raw : { name: raw };
    const text = String(o.name ?? "").replace(/\s+/g, " ").trim();
    const marked = SELF_MARK.test(text) || o.self === true;
    const presenting = PRESENTING.test(text) || o.presenting === true;
    const name = displayName(text.replace(SELF_MARK, " ").replace(PRESENTING, " "));
    const selfLabel = isSelfLabel(name, language);
    return { name: selfLabel ? "" : name, self: marked || selfLabel, marked, plainSelf: selfLabel && !marked, presenting, speaking: o.speaking ?? null };
  }
  const entry = (name, at) => {
    const key = nameKey(name);
    if (!key || isUnknown(name)) return null;
    let p = people.get(key);
    if (!p) { p = { name, key, marks: new Map(), joinedAt: at, leftAt: null, presenting: false, talkMs: 0, lastSpokeAt: 0, speakSource: null, speakConf: 0 }; people.set(key, p); }
    else if (name.length > p.name.length && nameKey(name) === key) p.name = name;   // the fuller spelling wins
    return p;
  };
  const noteSelf = (p) => { selfSeenAt = now(); if (p.marked && p.name && !selfName) selfName = p.name; };

  const api = {
    setLang(l) { if (l) language = String(l); },
    lang: () => language,
    // A whole list from one source: who it shows now
    snapshot(source, list = []) {
      const at = now();
      const items = (Array.isArray(list) ? list : []).map(parse);
      const plain = items.filter((x) => x.plainSelf).length;
      if (plain >= 2 || (plain >= 1 && items.some((x) => x.marked && !x.plainSelf))) impostor = true;
      const here = new Set(), presentingNow = new Set(items.filter((x) => x.presenting && x.name).map((x) => nameKey(x.name)));
      for (const it of items) {
        if (it.self) { noteSelf(it); if (it.speaking) api.speaking("", { source: it.speaking.source ?? source, confidence: it.speaking.confidence, self: true }); continue; }
        const p = entry(it.name, at); if (!p) continue;
        here.add(p.key);
        p.marks.set(source, at); p.leftAt = null;
        // (a presenter has a tile of their own and one for the screen; only the tiles can say they stopped)
        if (source === "tiles") p.presenting = presentingNow.has(p.key); else if (presentingNow.has(p.key)) p.presenting = true;
        if (it.speaking) api.speaking(p.name, { source: it.speaking.source ?? source, confidence: it.speaking.confidence });
      }
      if (LIST_SOURCES.has(source)) for (const p of people.values()) if (!here.has(p.key)) p.marks.delete(source);
      sources[source] = { n: here.size, at };
      return api.status();
    },
    // Someone spoke (a caption line) or wrote (a chat message)
    seen(source, raw) {
      const it = parse(raw); const at = now();
      if (it.self) { noteSelf(it); return null; }
      const p = entry(it.name, at); if (!p) return null;
      p.marks.set(source, at); if (p.leftAt && at > p.leftAt) p.leftAt = null;
      sources[source] = { n: [...people.values()].filter((x) => x.marks.has(source)).length, at };
      if (source === "caption") api.speaking(p.name, { source: "caption", confidence: SOURCE_CONFIDENCE.caption });
      return p.name;
    },
    joined(raw, source = "toast") { const it = parse(raw); if (it.self) return null; const p = entry(it.name, now()); if (!p) return null; p.marks.set(source, now()); p.leftAt = null; sources[source] = { n: (sources[source]?.n ?? 0) + 1, at: now() }; return p.name; },
    left(raw) {
      const it = parse(raw); if (it.self) return null;
      const p = people.get(nameKey(it.name)); if (!p) return null;
      p.leftAt = now();
      for (const s of [...p.marks.keys()]) if (!LIST_SOURCES.has(s)) p.marks.delete(s);   // lists drop them on their next picture
      return p.name;
    },
    presenting(raw, on = true) { const it = parse(raw); if (it.self) return; const p = entry(it.name, now()); if (p) p.presenting = on; },
    count(n) { const v = Number(n); if (Number.isFinite(v) && v > 0 && v < 10_000) { expected = Math.round(v); sources.count = { n: expected, at: now() }; } },
    // Someone is talking now (a caption line, a lit-up tile, a moving sound meter)
    speaking(raw, { source = "caption", confidence = null, self = false } = {}) {
      const at = now(), conf = confidence ?? SOURCE_CONFIDENCE[source] ?? 0.5;
      const it = self ? { self: true } : parse(raw);
      const t = it.self ? selfTalk : entry(it.name, at);
      if (!t) return;
      // talk time: the time between two signs of talking, when they're close together (a pause isn't counted)
      if (t.lastSpokeAt && at - t.lastSpokeAt <= maxTalkGapMs) t.talkMs += at - t.lastSpokeAt;
      if (it.self) { selfTalk = { ...selfTalk, at, source, conf, lastSpokeAt: at }; return; }
      t.lastSpokeAt = at; t.speakSource = source; t.speakConf = conf;
      if (source === "caption") t.captionAt = at;          // a caption names its speaker: it stays first for a while
      if (!t.marks.size) t.marks.set(source === "caption" ? "caption" : "tiles", at);
    },
    // Who is talking: the newest caption line wins (it names the speaker); else the strongest tile signal
    talking() {
      const at = now();
      const cands = [...people.values()].filter((p) => p.lastSpokeAt && at - p.lastSpokeAt <= speakingMs)
        .map((p) => (p.captionAt && at - p.captionAt <= speakingMs
          ? { name: p.name, self: false, source: "caption", confidence: SOURCE_CONFIDENCE.caption, at: p.captionAt }
          : { name: p.name, self: false, source: p.speakSource, confidence: p.speakConf, at: p.lastSpokeAt }));
      if (selfTalk.at && at - selfTalk.at <= speakingMs) cands.push({ name: selfName || null, self: true, source: selfTalk.source, confidence: selfTalk.conf, at: selfTalk.at });
      if (!cands.length) return null;
      const caps = cands.filter((c) => c.source === "caption");
      const pool = caps.length ? caps : cands;
      return pool.sort((a, b) => b.at - a.at || b.confidence - a.confidence)[0];
    },
    people() {
      return [...people.values()].filter((p) => p.marks.size && !(p.leftAt && [...p.marks.values()].every((t) => t <= p.leftAt)))
        .map((p) => ({ name: p.name, sources: [...p.marks.keys()], confidence: Math.max(...[...p.marks.keys()].map((s) => SOURCE_CONFIDENCE[s] ?? 0.5)), presenting: p.presenting, joinedAt: p.joinedAt, leftAt: p.leftAt, talkMs: p.talkMs }))
        .sort((a, b) => a.joinedAt - b.joinedAt);
    },
    // Everyone ever seen in this meeting (for notes: who came and went, and how long each talked)
    history() { return [...people.values()].map((p) => ({ name: p.name, joinedAt: p.joinedAt, leftAt: p.leftAt, talkMs: p.talkMs, sources: [...p.marks.keys()] })); },
    self: () => ({ name: selfName || null, seenAt: selfSeenAt, talkMs: selfTalk.talkMs }),
    impostor: () => impostor,
    status() {
      const list = api.people();
      const count = list.length + (selfSeenAt ? 1 : 0);
      return { people: list, count, expected, agrees: expected === null ? null : expected === count, self: api.self(), sources: { ...sources }, impostor, talking: api.talking(), lang: language };
    },
    clear() { people.clear(); for (const k of Object.keys(sources)) delete sources[k]; expected = null; impostor = false; selfName = ""; selfSeenAt = 0; selfTalk = { at: 0, source: null, conf: 0, talkMs: 0, lastSpokeAt: 0 }; },
  };
  return api;
}

// "Rich Alvarez joined", "Rich Alvarez a rejoint l'appel", "Rich Alvarez is presenting": Meet's notices, in the
// languages Meet is most used in. → { action: "joined" | "left" | "presenting", name } | null
const NOTICES = [
  ["joined", /^(.{1,80}?) (?:has )?joined(?: the (?:call|meeting))?\.?$/i],
  ["joined", /^(.{1,80}?) a rejoint (?:l'appel|l’appel|la réunion)\.?$/i],
  ["joined", /^(.{1,80}?) se (?:ha )?unido(?: a la (?:llamada|reunión))?\.?$/i],
  ["joined", /^(.{1,80}?) ist (?:dem Anruf |der Besprechung )?beigetreten\.?$/i],
  ["joined", /^(.{1,80}?) (?:entrou|participou)(?: na chamada| na reunião)?\.?$/i],
  ["joined", /^(.{1,80}?) si è unit[oa](?: alla (?:chiamata|riunione))?\.?$/i],
  ["left", /^(.{1,80}?) (?:has )?left(?: the (?:call|meeting))?\.?$/i],
  ["left", /^(.{1,80}?) a quitté (?:l'appel|l’appel|la réunion)\.?$/i],
  ["left", /^(.{1,80}?) (?:ha )?(?:salido|abandonado)(?: de la (?:llamada|reunión))?\.?$/i],
  ["left", /^(.{1,80}?) hat (?:den Anruf|die Besprechung) verlassen\.?$/i],
  ["left", /^(.{1,80}?) saiu(?: da chamada| da reunião)?\.?$/i],
  ["left", /^(.{1,80}?) ha (?:abbandonato|lasciato)(?: la (?:chiamata|riunione))?\.?$/i],
  ["presenting", /^(.{1,80}?) (?:is|are) (?:now )?presenting\.?$/i],
  ["presenting", /^(.{1,80}?) (?:présente|est en train de présenter)\.?$/i],
  ["presenting", /^(.{1,80}?) está presentando\.?$/i],
  ["presenting", /^(.{1,80}?) präsentiert(?: gerade)?\.?$/i],
];
export function parseNotice(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 120) return null;
  for (const [action, rx] of NOTICES) { const m = rx.exec(t); if (m && m[1].trim() && m[1].split(" ").length <= 6) return { action, name: m[1].trim() }; }
  return null;
}
