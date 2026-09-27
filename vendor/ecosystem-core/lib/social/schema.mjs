// Social: the record shapes and their validation. docs/SOCIAL.md is the spec this follows.
//
// NOT SWITCHED ON. Nothing in lib/social runs unless an app turns its social feature on (Dayspring: social.enabled,
// off by default and hidden), and nothing leaves a device until a real server is configured.
//
// Every validator returns { ok, errors[] } and never throws, so a bad record from the network is reported, not fatal.
// Collections (the sync unit): users, people, items, shares, links, consents, hides, claims, groups, tombstones.

export const SCHEMA_VERSION = 1;
export const COLLECTIONS = ["users", "people", "items", "shares", "links", "consents", "hides", "claims", "groups", "tombstones"];

// What can be shared at all. Anything else (private texts, call logs, face embeddings, contacts, locations) can
// never become a shared item: the schema itself refuses it, before any consent rule is asked.
export const SHAREABLE_KINDS = ["photo", "note", "event", "memory"];
export const FORBIDDEN_KINDS = ["text_message", "sms", "call_log", "face_embedding", "face", "contact", "location", "voice_print", "message"];
export const VISIBILITY = ["private", "shared"];
export const EVENT_KINDS = ["birthday", "anniversary", "gathering", "milestone", "other"];
export const GROUP_KINDS = ["family", "friends", "other"];
export const LINK_EVIDENCE = { manual: 0.6, contact: 0.8, "shared-tag": 0.7, face: 0.9 };   // default confidence by evidence
export const CONSENT_SCOPES = { pooling: ["in", "out"], faceMatching: ["in", "off"], linking: ["open", "subject-only", "off"] };
// A subject who never said anything: pooling on (they are only ever shown what people chose to share with the viewer),
// face matching OFF (biometric: needs an explicit yes), linking open (still needs the thresholds in links.mjs).
export const CONSENT_DEFAULTS = { pooling: "in", faceMatching: "off", linking: "open" };
// Minors: stricter. Nothing pools and nothing links unless a guardian opted in; faces never match without a guardian yes.
export const MINOR_DEFAULTS = { pooling: "out", faceMatching: "off", linking: "subject-only" };

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const ISO = (s) => typeof s === "string" && !Number.isNaN(Date.parse(s));
const B64 = /^[A-Za-z0-9+/_=-]+$/;

function checker() {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  return { errors, need, done: () => ({ ok: errors.length === 0, errors }) };
}
const isId = (v) => typeof v === "string" && ID.test(v);
const isIdList = (v) => Array.isArray(v) && v.every(isId);
const isBox = (b) => b && typeof b === "object" && typeof b.iv === "string" && typeof b.ct === "string" && typeof b.tag === "string" && B64.test(b.ct);

export function validateUser(u) {
  const c = checker();
  c.need(u && typeof u === "object", "user must be an object");
  if (!u) return c.done();
  c.need(isId(u.id), "user.id");
  c.need(typeof u.handle === "string" && /^[a-z0-9_.-]{2,40}$/.test(u.handle), "user.handle (2-40 of a-z 0-9 _ . -)");
  c.need(Array.isArray(u.devices) && u.devices.length > 0, "user.devices (at least one device key)");
  for (const d of u.devices ?? []) {
    c.need(isId(d.deviceId), "device.deviceId");
    c.need(typeof d.encPub === "string" && B64.test(d.encPub), "device.encPub (X25519 public key, base64)");
    c.need(typeof d.signPub === "string" && B64.test(d.signPub), "device.signPub (Ed25519 public key, base64)");
  }
  c.need(u.guardians === undefined || isIdList(u.guardians), "user.guardians");
  c.need(u.isMinor === undefined || typeof u.isMinor === "boolean", "user.isMinor");
  return c.done();
}

// A person as one user knows them (their own record). Private to that user; only a stub (id, owner, minor flag,
// guardians, the subject's user id once claimed) is ever synced, and the name travels encrypted.
export function validatePerson(p) {
  const c = checker();
  c.need(p && typeof p === "object", "person must be an object");
  if (!p) return c.done();
  c.need(isId(p.id), "person.id");
  c.need(isId(p.owner), "person.owner");
  c.need(p.visibility === undefined || VISIBILITY.includes(p.visibility), "person.visibility");
  c.need(p.isMinor === undefined || typeof p.isMinor === "boolean", "person.isMinor");
  c.need(p.guardians === undefined || isIdList(p.guardians), "person.guardians");
  c.need(p.subjectUserId === undefined || p.subjectUserId === null || isId(p.subjectUserId), "person.subjectUserId");
  c.need(p.birthday === undefined || p.birthday === null || /^\d{2}-\d{2}$/.test(p.birthday), "person.birthday (MM-DD)");
  return c.done();
}

export function validateItem(it) {
  const c = checker();
  c.need(it && typeof it === "object", "item must be an object");
  if (!it) return c.done();
  c.need(isId(it.id), "item.id");
  c.need(isId(it.owner), "item.owner");
  c.need(!FORBIDDEN_KINDS.includes(it.kind), `item.kind "${it.kind}" can never be shared`);
  c.need(SHAREABLE_KINDS.includes(it.kind), "item.kind (photo, note, event or memory)");
  c.need(VISIBILITY.includes(it.visibility ?? "private"), "item.visibility");
  c.need(it.people === undefined || isIdList(it.people), "item.people (person ids of the owner's own people)");
  c.need(it.date === undefined || it.date === null || /^\d{4}-\d{2}-\d{2}/.test(it.date), "item.date (YYYY-MM-DD)");
  if (it.kind === "event") c.need(it.eventKind === undefined || EVENT_KINDS.includes(it.eventKind), "item.eventKind");
  c.need(it.box === undefined || isBox(it.box), "item.box (encrypted content: iv, ct, tag)");
  c.need(it.faceEmbedding === undefined && it.embedding === undefined, "item must not carry face data");
  return c.done();
}

export function validateShare(s) {
  const c = checker();
  c.need(s && typeof s === "object", "share must be an object");
  if (!s) return c.done();
  c.need(isId(s.id), "share.id");
  c.need(isId(s.itemId), "share.itemId");
  c.need(isId(s.owner), "share.owner");
  const a = s.audience ?? {};
  c.need(isIdList(a.users ?? []) && isIdList(a.groups ?? []), "share.audience.users / groups");
  c.need((a.users?.length ?? 0) + (a.groups?.length ?? 0) > 0, "share.audience must name specific people or groups (there is no 'everyone')");
  c.need(!("public" in a) && !("everyone" in a), "share.audience cannot be public");
  const p = s.permissions ?? {};
  c.need(typeof (p.pool ?? false) === "boolean" && typeof (p.reshare ?? false) === "boolean" && typeof (p.download ?? false) === "boolean", "share.permissions");
  c.need(s.expiresAt === undefined || s.expiresAt === null || ISO(s.expiresAt), "share.expiresAt");
  c.need(ISO(s.createdAt), "share.createdAt");
  return c.done();
}

export function validateLink(l) {
  const c = checker();
  c.need(l && typeof l === "object", "link must be an object");
  if (!l) return c.done();
  c.need(isId(l.id), "link.id");
  c.need(isId(l.proposer), "link.proposer");
  for (const k of ["a", "b"]) c.need(l[k] && isId(l[k].owner) && isId(l[k].personId), `link.${k} { owner, personId }`);
  c.need(Object.keys(LINK_EVIDENCE).includes(l.evidence), "link.evidence");
  c.need(typeof l.confidence === "number" && l.confidence >= 0 && l.confidence <= 1, "link.confidence (0-1)");
  c.need(l.endorsements === undefined || (Array.isArray(l.endorsements) && l.endorsements.every((e) => isId(e.by) && typeof e.confidence === "number")), "link.endorsements");
  return c.done();
}

export function validateConsent(r) {
  const c = checker();
  c.need(r && typeof r === "object", "consent must be an object");
  if (!r) return c.done();
  c.need(isId(r.id), "consent.id");
  // about an account (subjectUserId), or, for someone with no account yet (a child), about a person record
  c.need(isId(r.subjectUserId) || (r.person && isId(r.person.owner) && isId(r.person.personId)), "consent.subjectUserId or consent.person { owner, personId }");
  c.need(isId(r.by), "consent.by (the subject, or a guardian)");
  c.need(Object.keys(CONSENT_SCOPES).includes(r.scope), "consent.scope");
  c.need(CONSENT_SCOPES[r.scope]?.includes(r.value), "consent.value");
  c.need(ISO(r.at), "consent.at");
  return c.done();
}

export function validateHide(h) {
  const c = checker();
  c.need(h && isId(h.id) && isId(h.itemId) && isId(h.by), "hide { id, itemId, by }");
  c.need(["hide", "untag"].includes(h?.action), "hide.action (hide or untag)");
  return c.done();
}

export function validateClaim(k) {
  const c = checker();
  c.need(k && isId(k.id) && isId(k.claimant), "claim { id, claimant }");
  c.need(k?.person && isId(k.person.owner) && isId(k.person.personId), "claim.person { owner, personId }");
  c.need(k?.vouches === undefined || (Array.isArray(k.vouches) && k.vouches.every(isId)), "claim.vouches");
  return c.done();
}

export function validateGroup(g) {
  const c = checker();
  c.need(g && isId(g.id) && isId(g.owner), "group { id, owner }");
  c.need(GROUP_KINDS.includes(g?.kind), "group.kind (family, friends, other)");
  c.need(isIdList(g?.members ?? null), "group.members");
  return c.done();
}

export function validateTombstone(t) {
  const c = checker();
  c.need(t && isId(t.id), "tombstone.id");
  c.need(COLLECTIONS.includes(t?.collection) && t.collection !== "tombstones", "tombstone.collection");
  c.need(isId(t?.by), "tombstone.by");
  c.need(ISO(t?.at), "tombstone.at");
  return c.done();
}

export const VALIDATORS = { users: validateUser, people: validatePerson, items: validateItem, shares: validateShare, links: validateLink, consents: validateConsent, hides: validateHide, claims: validateClaim, groups: validateGroup, tombstones: validateTombstone };

export function validate(collection, record) {
  const v = VALIDATORS[collection];
  if (!v) return { ok: false, errors: [`unknown collection "${collection}"`] };
  return v(record);
}

// What a shared item may carry on the wire: its content only in the encrypted box. Plain fields are the metadata the
// server needs to route and pool (ids, kind, date, person ids, owner). Titles, notes and captions go in the box.
export const WIRE_ITEM_FIELDS = ["id", "owner", "kind", "visibility", "people", "date", "eventKind", "recurring", "box", "keys", "createdAt", "rev", "source"];
export function wireItem(it) {
  const out = {};
  for (const k of WIRE_ITEM_FIELDS) if (it[k] !== undefined) out[k] = it[k];
  return out;
}
export const WIRE_PERSON_FIELDS = ["id", "owner", "isMinor", "guardians", "subjectUserId", "nameBox", "keys", "rev"];
export function wirePerson(p) {
  const out = {};
  for (const k of WIRE_PERSON_FIELDS) if (p[k] !== undefined) out[k] = p[k];
  return out;
}
