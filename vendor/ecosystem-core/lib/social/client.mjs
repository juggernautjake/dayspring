// Social: one user's device — the piece an app wires in. It keeps the local replica, signs and queues every change,
// encrypts content before it leaves, checks every op it receives, and computes profiles and reminders locally.
// docs/SOCIAL.md "Client".
//
//   const c = createSocialClient({ adapter, identity, userId, handle })
//   await c.register({ invite })
//   c.addPerson({ id, name, isMinor, guardians, subjectUserId })        → a person stub (the name is encrypted)
//   await c.share({ kind, date, people, eventKind, content }, { users, groups }, permissions, expiresAt) → { itemId, shareId }
//   c.revoke(shareId) · c.proposeLink(...) · c.endorse(linkId) · c.rejectLink(linkId) · c.confirmLink(linkId)
//   c.claim({ owner, personId }) · c.vouch(claimId) · c.consent(scope, value, target) · c.hide(itemId, action, personId)
//   c.group({ name, kind, members }) · await c.sync() · c.profile(owner, personId, { localPrivate }) · c.read(itemId)
//   c.reminders({ people, lastContact, now }) · c.rewrapFor(itemId, userId) (give a claimed subject the key)
import { randomUUID } from "node:crypto";
import { createState, merge, makeOp, get, toJSON, fromJSON, createOutbox } from "./sync.mjs";
import { worldOf } from "./world.mjs";
import { clusters, proposeLink, endorseLink, rejectLink, confirmBySubject, proposeClaim, vouchClaim } from "./links.mjs";
import { makeShare, revokeOps, SocialError } from "./shares.mjs";
import { buildProfile, profileFor } from "./pooling.mjs";
import { generateReminders } from "./reminders.mjs";
import { publicOf, seal, openJSON, rewrap, signOp, verifyOp, canonical, verifyBytes, signBytes } from "./crypto.mjs";
import { createAuditLog } from "./audit.mjs";
import { audienceOf } from "./consent.mjs";

export function createSocialClient({ adapter, identity, userId, handle, isMinor = undefined, guardians = undefined, store = null, now = () => new Date() }) {
  if (!adapter || !identity || !userId) throw new Error("createSocialClient needs an adapter, this device's identity and the user id");
  const saved = store?.load?.() ?? null;
  const state = saved?.state ? fromJSON(saved.state) : createState();
  const outbox = createOutbox({ load: () => saved?.outbox ?? null, save: () => persist() });
  const audit = createAuditLog({ load: () => saved?.audit ?? null, save: () => persist(), now });
  const keyCache = new Map();                       // userId → devices (from the directory or the synced user records)
  const kid = `${userId}/${identity.deviceId}`;
  const session = { userId, identity };
  function persist() { store?.save?.({ state: toJSON(state), outbox: { pending: outbox?.pending?.() ?? [], rejected: outbox?.rejected?.() ?? [] }, audit: audit?.entries?.() ?? [] }); }
  const w = () => worldOf(state);

  function commit(collection, record, action) {
    const cur = get(state, collection, record.id);
    const op = signOp(makeOp({ collection, record, author: userId, rev: record.rev ?? ((cur?.rev ?? 0) + 1), at: now().toISOString() }), identity);
    const r = merge(state, op);
    if (!r.applied) throw new SocialError(`Couldn't record that (${r.reason}).`, r.reason);
    outbox.enqueue(op);
    audit.append({ actor: userId, action: action ?? `${collection}.put`, target: record.id });
    return record;
  }
  function commitOp(op, action) {
    const signed = signOp(op, identity);
    merge(state, signed);
    outbox.enqueue(signed);
    audit.append({ actor: userId, action, target: op.id, reason: op.record?.reason ?? null });
  }

  const me = () => ({ id: userId, handle, devices: [{ ...publicOf(identity), addedAt: identity.createdAt ?? now().toISOString() }], createdAt: now().toISOString(), ...(isMinor !== undefined ? { isMinor } : {}), ...(guardians ? { guardians } : {}) });
  async function register({ invite = null } = {}) {
    const user = me();
    const proof = { deviceId: identity.deviceId, value: signBytes(canonical(user), identity) };
    const r = await adapter.register({ user, proof, invite });
    merge(state, { v: 1, opId: "reg_" + userId, type: "put", collection: "users", id: userId, record: user, author: userId, rev: 1, at: now().toISOString(), proof });
    keyCache.set(userId, user.devices);
    audit.append({ actor: userId, action: "register", target: userId });
    return r;
  }

  async function devicesOf(ids) {
    const need = [...new Set(ids)].filter((id) => !keyCache.has(id));
    for (const id of need) { const u = get(state, "users", id); if (u) keyCache.set(id, u.devices); }
    const still = need.filter((id) => !keyCache.has(id));
    if (still.length) for (const u of await adapter.directory(session, { ids: still })) keyCache.set(u.id, u.devices);
    return ids.flatMap((id) => (keyCache.get(id) ?? []).filter((d) => !d.revokedAt).map((d) => ({ userId: id, deviceId: d.deviceId, encPub: d.encPub, signPub: d.signPub })));
  }
  async function recipientsFor(audience) {
    const tmp = { owner: userId, audience };
    const users = [...audienceOf(w(), tmp), userId];
    return devicesOf(users);
  }

  function addPerson({ id = null, name, isMinor: minor = undefined, guardians: g = undefined, subjectUserId = undefined }) {
    const pid = id ?? "p_" + randomUUID();
    const sealed = seal({ name }, [{ userId, deviceId: identity.deviceId, encPub: identity.enc.pub }], "person|" + pid);
    const cur = get(state, "people", pid);
    const rec = { id: pid, owner: userId, nameBox: sealed.box, keys: sealed.keys, rev: (cur?.rev ?? 0) + 1,
      ...(minor !== undefined ? { isMinor: minor } : {}), ...(g ? { guardians: g } : {}), ...(subjectUserId ? { subjectUserId } : {}) };
    return commit("people", rec, "person.put");
  }
  // Give more devices the key to a sealed record (a person's name, an item's content).
  function withKeysFor(rec, aadPrefix, boxField, recipients) {
    let sealed = { box: rec[boxField], keys: rec.keys };
    for (const r of recipients) if (!sealed.keys[`${r.userId}/${r.deviceId}`]) sealed = rewrap(sealed, kid, identity, r);
    return { ...rec, keys: sealed.keys, rev: (rec.rev ?? 1) + 1 };
  }

  async function share(itemIn, audience, permissions = {}, expiresAt = null) {
    const itemId = itemIn.id ?? "it_" + randomUUID();
    const recipients = await recipientsFor(audience);
    const sealed = seal(itemIn.content ?? {}, recipients, "item|" + itemId);
    const item = { id: itemId, owner: userId, kind: itemIn.kind, visibility: "shared", people: itemIn.people ?? [], createdAt: now().toISOString(), box: sealed.box, keys: sealed.keys, rev: 1,
      ...(itemIn.date ? { date: itemIn.date } : {}), ...(itemIn.eventKind ? { eventKind: itemIn.eventKind } : {}), ...(itemIn.source ? { source: itemIn.source } : {}) };
    const shareRec = makeShare(worldOf({ ...Object.fromEntries(Object.keys(state.collections).map((c) => [c, [...state.collections[c].values()]])), items: [...state.collections.items.values(), item], tombstones: [...state.tombstones.values()] }),
      { sharer: userId, item, audience, permissions, expiresAt, now: now() });
    // the people it's about: their names become readable to the same audience
    for (const pid of item.people) { const p = get(state, "people", pid); if (p) commit("people", withKeysFor(p, "person|", "nameBox", recipients), "person.rewrap"); }
    commit("items", item, "item.share");
    commit("shares", shareRec, "share.create");
    return { itemId, shareId: shareRec.id };
  }
  function revoke(shareId) {
    const s = get(state, "shares", shareId);
    for (const op of revokeOps(w(), { share: s, by: userId })) commitOp(op, `${op.collection}.revoke`);
    return { revoked: shareId };
  }
  async function rewrapFor(itemId, otherUserId) {
    const it = get(state, "items", itemId);
    if (!it || it.owner !== userId) throw new SocialError("Only the owner can give out an item's key.", "not-owner");
    return commit("items", withKeysFor(it, "item|", "box", await devicesOf([otherUserId])), "item.rewrap");
  }

  const link = {
    propose: (mine, other, evidence = "manual", confidence = null) => commit("links", proposeLink({ proposer: userId, a: { owner: userId, personId: mine }, b: other, evidence, confidence }), "link.propose"),
    endorse: (id, confidence = null, evidence = "manual") => commit("links", endorseLink(get(state, "links", id), { by: userId, confidence, evidence }), "link.endorse"),
    reject: (id) => commit("links", rejectLink(get(state, "links", id), userId), "link.reject"),
    confirm: (id) => commit("links", confirmBySubject(get(state, "links", id), userId), "link.confirm"),
  };
  const claim = (person) => commit("claims", proposeClaim({ claimant: userId, person }), "claim.propose");
  const vouch = (id) => commit("claims", vouchClaim(get(state, "claims", id), userId), "claim.vouch");
  const consent = (scope, value, target = {}) => commit("consents", { id: "cns_" + randomUUID(), subjectUserId: target.person ? undefined : target.subjectUserId ?? userId, ...(target.person ? { person: target.person } : {}), by: userId, scope, value, at: now().toISOString(), rev: 1 }, `consent.${scope}.${value}`);
  const hide = (itemId, action = "hide", personId = undefined) => commit("hides", { id: "hid_" + randomUUID(), itemId, by: userId, action, ...(personId ? { personId } : {}), at: now().toISOString(), rev: 1 }, `item.${action}`);
  const group = ({ id = null, name, kind = "friends", members = [] }) => commit("groups", { id: id ?? "grp_" + randomUUID(), owner: userId, name, kind, members: [...new Set(members)], rev: 1 }, "group.put");

  async function sync() {
    const pushed = await outbox.flush(adapter, session);
    const { ops } = await adapter.pull(session);
    let applied = 0, refused = 0;
    // user records first (each is signed by its own device key), so the other ops can be checked against them
    const users = ops.filter((o) => o.collection === "users"), rest = ops.filter((o) => o.collection !== "users");
    for (const op of users) {
      const d = op.record?.devices?.find((x) => x.deviceId === (op.proof ?? op.sig)?.deviceId);
      const ok = op.proof ? d && verifyBytes(canonical(op.record), op.proof.value, d.signPub) : verifyOp(op, get(state, "users", op.author)?.devices ?? op.record?.devices);
      if (!ok) { refused++; audit.append({ actor: userId, action: "pull.refuse", target: op.id, reason: "bad-signature" }); continue; }
      if (merge(state, op).applied) { applied++; keyCache.delete(op.id); }
    }
    for (const op of rest) {
      const devs = await devicesOf([op.author]);
      if (!verifyOp(op, devs)) { refused++; audit.append({ actor: userId, action: "pull.refuse", target: op.id, reason: "bad-signature" }); continue; }
      if (merge(state, op).applied) applied++;
    }
    persist();
    return { pushed, pulled: ops.length, applied, refused };
  }

  function read(itemId) {
    const it = get(state, "items", itemId);
    if (!it) throw new SocialError("There's no such item (it may have been revoked).", "no-item");
    return openJSON({ box: it.box, keys: it.keys }, kid, identity, "item|" + itemId);
  }
  function personName(pid) { const p = get(state, "people", pid); try { return p ? openJSON({ box: p.nameBox, keys: p.keys }, kid, identity, "person|" + pid).name : null; } catch { return null; } }
  const label = (it) => { try { return read(it.id).title ?? null; } catch { return null; } };

  return {
    userId, session, state, outbox, auditLog: audit,
    register, addPerson, share, revoke, rewrapFor, link, claim, vouch, consent, hide, group, sync, read, personName,
    world: w,
    clusters: () => clusters(w()),
    profile: (owner, personId, opts = {}) => profileFor(w(), userId, owner, personId, { now: now(), ...opts }),
    profileOf: (clusterId, opts = {}) => buildProfile(w(), userId, clusterId, { now: now(), ...opts }),
    reminders: (opts = {}) => generateReminders({ w: w(), viewer: userId, now: now(), label, ...opts }),
  };
}
