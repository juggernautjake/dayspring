// Sharing with friends: what of Dayspring's own records could be shared, as social items. NOT SWITCHED ON — loaded only
// by ./engine.mjs, which loads only when social.enabled is on.
//
// Everything comes out PRIVATE. Nothing here shares, uploads or marks anything shared: that only ever happens when the
// owner picks an item and the people or group to share it with (engine → client.share). Texts and calls are never
// shareable; they appear only on the owner's own view of a person, as "local only".
//
// Sources: lib/people (the one way in to the people store: list(), profile()), lib/people/comms (lastContact) and
// lib/photos (info()). Tests pass their own `sources` with the same shape:
//   { people(): [{ id, name, birthday, year, notes: [{ id, at, text, visibility }], source, visibility }],
//     personPhotos(personId) → [photoId], photoInfo(photoId) → { id, name, taken, description, category, tags },
//     lastContact(personId) → { at } | null,  privateComms(personId) → [{ id, at, dir }] }
// TODO(people): when lib/people records carry a per-note "memory" type or occasions with people, map them here too.

export async function loadSources() {
  const people = await import("../people/index.mjs");
  const comms = await import("../people/comms.mjs");
  const photos = await import("../photos.mjs");
  return {
    people: () => people.list(),
    personPhotos: async (id) => (await people.profile(id, { withMessages: false }).catch(() => null))?.faces?.photoIds ?? [],
    photoInfo: (id) => photos.info(id),
    lastContact: async (id) => comms.lastContact(id).catch(() => null),
    privateComms: async (id) => [...(await comms.thread(id).catch(() => [])).map((t) => ({ id: t.id, at: t.at, kind: "text_message" })), ...(await comms.calls(id).catch(() => [])).map((c) => ({ id: c.id, at: c.start, kind: "call_log" }))],
  };
}

const SHAREABLE = new Set(["photo", "note", "event", "memory"]);
const day = (iso) => (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null);
const src = (s, from) => (s && typeof s === "object" ? s : { app: "dayspring", user: "local", from: s ?? from });

// A local person → the social person record (kept on this computer; only a stub with an encrypted name is ever sent).
export function personRecord(p) {
  return { localId: p.id, name: p.name, birthday: /^\d{2}-\d{2}$/.test(p.birthday ?? "") ? p.birthday : null, year: p.year ?? null, visibility: "private", source: src(p.source, "told"), isMinor: p.isMinor === true || undefined };
}

// Everything that could be shared, all private. { ref, kind, people: [localPersonId], date, eventKind?, visibility, source, content }
export async function shareables(sources) {
  const s = sources ?? (await loadSources());
  const out = [];
  for (const p of s.people() ?? []) {
    for (const n of p.notes ?? []) {
      if (!n?.text) continue;
      out.push({ ref: `note:${n.id}`, kind: "note", people: [p.id], date: day(n.at), visibility: "private", source: src(n.source, "told"), content: { title: `About ${p.name}`, text: n.text } });
    }
    if (/^\d{2}-\d{2}$/.test(p.birthday ?? "")) {
      out.push({ ref: `birthday:${p.id}`, kind: "event", eventKind: "birthday", people: [p.id], date: `${p.year ?? "0000"}-${p.birthday}`, visibility: "private", source: src(p.source, "told"), content: { title: `${p.name}'s birthday` } });
    }
    for (const id of (await s.personPhotos?.(p.id)) ?? []) {
      const ph = s.photoInfo?.(id);
      if (!ph) continue;
      const existing = out.find((x) => x.ref === `photo:${id}`);
      if (existing) { if (!existing.people.includes(p.id)) existing.people.push(p.id); continue; }
      out.push({ ref: `photo:${id}`, kind: "photo", people: [p.id], date: day(ph.taken), visibility: "private", source: { app: "dayspring", user: "local", from: "photos" }, content: { title: ph.description ?? ph.name ?? "A photo", category: ph.category ?? null, tags: ph.tags ?? [] } });
    }
  }
  // belt and braces: nothing but the four shareable kinds, and nothing leaves this function as anything but private
  return out.filter((x) => SHAREABLE.has(x.kind)).map((x) => ({ ...x, visibility: "private" }));
}

// The owner's own texts and calls with a person, for their own view of that person's profile ("local only"). Never
// turned into items, never synced.
export async function localPrivateFor(personId, sources) {
  const s = sources ?? (await loadSources());
  return ((await s.privateComms?.(personId)) ?? []).map((x) => ({ ...x, owner: "local", people: [personId], localOnly: true }));
}

// "You haven't talked to X in a while": last contact per person, from this computer only.
export async function lastContactMap(sources) {
  const s = sources ?? (await loadSources());
  const out = {};
  for (const p of s.people() ?? []) { const c = await s.lastContact?.(p.id); if (c?.at) out[p.id] = c.at; }
  return out;
}

// The shape client.share() takes, from a shareable the owner picked. `personMap` maps local person ids to social ones.
export function toShareInput(item, personMap = {}) {
  if (!SHAREABLE.has(item.kind)) throw new Error("That can't be shared.");
  return { kind: item.kind, date: item.date ?? undefined, eventKind: item.eventKind, people: item.people.map((id) => personMap[id]).filter(Boolean), source: item.source, content: item.content };
}
