// Social: the server side of the protocol, as a plain object with no network (docs/SOCIAL.md "Sync protocol" and
// "Server rules"). The mock adapter runs it in memory for tests; the reference server skeleton (social-server, kept privately) puts
// it behind HTTP. A real server would keep these same rules.
//
//   const hub = createHub({ load, save, allowRegistration, inviteCodes, now })
//   hub.register({ user, proof, invite })       → { userId }         proof = the user record signed by one of its devices
//   hub.directory(viewer, { ids, handle })      → [{ id, handle, devices: [{ deviceId, encPub, signPub }] }]
//   hub.push(viewer, ops)                       → { accepted: [opId], rejected: [{ opId, reason }] }
//   hub.pull(viewer)                            → { ops, cursor }   only what this user may see, as the original signed ops
//   hub.audit(viewer)                           → this user's own audit entries
//
// Server rules: every op is signed by a device of its author; the author must own what they write (see authorize());
// items arrive encrypted (no plaintext titles, notes or captions); nothing private or unshareable is accepted; a tombstone
// is final and deletes the record's content at once; each user receives only what the consent engine lets them see.
import { createState, merge, toJSON, fromJSON } from "./sync.mjs";
import { validate, WIRE_ITEM_FIELDS, WIRE_PERSON_FIELDS } from "./schema.mjs";
import { worldOf } from "./world.mjs";
import { clusters } from "./links.mjs";
import { canView, canShare, audienceOf } from "./consent.mjs";
import { canonical, verifyBytes, verifyOp } from "./crypto.mjs";
import { createAuditLog } from "./audit.mjs";

const MAX_OP_BYTES = 4 << 20;
const MAX_BATCH = 200;
const key = (c, id) => `${c}/${id}`;

export function createHub({ load = () => null, save = () => {}, allowRegistration = true, inviteCodes = null, now = () => new Date() } = {}) {
  const saved = load() ?? {};
  const state = saved.state ? fromJSON(saved.state) : createState();
  const opsByKey = new Map();
  for (const op of state.log) { const k = key(op.collection, op.id); if (!opsByKey.has(k)) opsByKey.set(k, []); opsByKey.get(k).push(op); }
  const delivered = new Map(Object.entries(saved.delivered ?? {}).map(([k, v]) => [k, new Map(Object.entries(v))]));
  const auditList = saved.audit ?? [];
  const audit = createAuditLog({ load: () => auditList, save: () => {}, now });
  const invites = inviteCodes ? new Set(inviteCodes) : null;
  const persist = () => save({ state: toJSON(state), delivered: Object.fromEntries([...delivered].map(([k, m]) => [k, Object.fromEntries(m)])), audit: audit.entries() });

  const devicesOf = (userId) => state.collections.users.get(userId)?.devices ?? [];

  function register({ user, proof, invite = null } = {}) {
    if (!allowRegistration) { audit.append({ actor: user?.id, action: "register", result: "refused", reason: "registration-closed" }); throw Object.assign(new Error("Registration is closed on this server."), { code: "registration-closed" }); }
    if (invites && !invites.has(invite)) { audit.append({ actor: user?.id, action: "register", result: "refused", reason: "bad-invite" }); throw Object.assign(new Error("That invite isn't valid."), { code: "bad-invite" }); }
    const v = validate("users", user);
    if (!v.ok) throw Object.assign(new Error("invalid user: " + v.errors.join("; ")), { code: "invalid" });
    if (state.collections.users.has(user.id)) throw Object.assign(new Error("That user id is taken."), { code: "taken" });
    if ([...state.collections.users.values()].some((u) => u.handle === user.handle)) throw Object.assign(new Error("That handle is taken."), { code: "taken" });
    const d = user.devices.find((x) => x.deviceId === proof?.deviceId);
    if (!d || !verifyBytes(canonical(user), proof.value, d.signPub)) throw Object.assign(new Error("The registration isn't signed by its own device key."), { code: "bad-proof" });
    const op = { v: 1, opId: "reg_" + user.id, type: "put", collection: "users", id: user.id, record: user, author: user.id, rev: 1, at: now().toISOString(), proof };
    merge(state, op); index(op);
    if (invites) invites.delete(invite);
    audit.append({ actor: user.id, action: "register", target: user.id });
    persist();
    return { userId: user.id };
  }
  function index(op) { const k = key(op.collection, op.id); if (!opsByKey.has(k)) opsByKey.set(k, []); opsByKey.get(k).push(op); }

  function directory(viewer, { ids = [], handle = null } = {}) {
    if (!state.collections.users.has(viewer)) throw Object.assign(new Error("Unknown user."), { code: "auth" });
    const want = ids.slice(0, 50);
    const pick = (u) => ({ id: u.id, handle: u.handle, devices: u.devices.filter((d) => !d.revokedAt).map((d) => ({ deviceId: d.deviceId, encPub: d.encPub, signPub: d.signPub })) });
    if (handle) { const u = [...state.collections.users.values()].find((x) => x.handle === handle); audit.append({ actor: viewer, action: "directory.handle", result: u ? "ok" : "none" }); return u ? [pick(u)] : []; }
    return want.map((id) => state.collections.users.get(id)).filter(Boolean).map(pick);   // exact ids only: there is no listing
  }

  // May `author` write this op? The world is the state before the op.
  function authorize(w, author, op) {
    if (op.author !== author) return "author-mismatch";
    const cur = state.collections[op.collection]?.get(op.id);
    const r = op.record;
    if (op.type === "tombstone") {
      if (!cur) return state.tombstones.has(key(op.collection, op.id)) ? null : "no-record";
      const owner = { users: cur.id, people: cur.owner, items: cur.owner, shares: cur.owner, groups: cur.owner, links: cur.proposer, consents: cur.by, hides: cur.by, claims: cur.claimant }[op.collection];
      return owner === author ? null : "not-owner";
    }
    if (cur && ["people", "items", "shares", "groups"].includes(op.collection) && cur.owner !== author) return "not-owner";
    switch (op.collection) {
      case "users": return r.id === author ? null : "not-self";
      case "people": {
        if (r.owner !== author) return "not-owner";
        const extra = Object.keys(r).filter((k) => !WIRE_PERSON_FIELDS.includes(k));
        return extra.length ? "plaintext-person-fields:" + extra.join(",") : null;       // names travel encrypted (nameBox)
      }
      case "items": {
        if (r.owner !== author) return "not-owner";
        if (r.visibility !== "shared") return "private-items-never-uploaded";
        if (!r.box) return "unencrypted-content";
        // every person it's about must already be one of the author's person records (so the minor rules can't be dodged)
        if ((r.people ?? []).some((pid) => w.person(author, pid) === null)) return "unknown-person-tag";
        const extra = Object.keys(r).filter((k) => !WIRE_ITEM_FIELDS.includes(k));
        return extra.length ? "plaintext-item-fields:" + extra.join(",") : null;
      }
      case "shares": {
        if (r.owner !== author) return "not-owner";
        const item = w.item(r.itemId);
        if (!item) return "share-before-item";
        const ok = canShare(w, author, item, r.audience, r.permissions ?? {});
        return ok.allow ? null : ok.reason;
      }
      case "groups": return r.owner === author ? null : "not-owner";
      case "links": {
        if (!cur) return r.proposer === author && (r.endorsements ?? []).every((e) => e.by === author) && !(r.rejectedBy ?? []).length && !(r.confirmedBy ?? []).length ? (r.a.owner === author || r.b.owner === author ? null : "proposer-must-own-one-side") : "link-forged-endorsement";
        if (canonical([cur.a, cur.b, cur.proposer, cur.evidence]) !== canonical([r.a, r.b, r.proposer, r.evidence])) return "link-immutable";
        const had = new Set((cur.endorsements ?? []).map((e) => e.by + "|" + e.confidence));
        const added = (r.endorsements ?? []).filter((e) => !had.has(e.by + "|" + e.confidence));
        if (added.some((e) => e.by !== author)) return "link-forged-endorsement";
        const newRej = (r.rejectedBy ?? []).filter((x) => !(cur.rejectedBy ?? []).includes(x)), newConf = (r.confirmedBy ?? []).filter((x) => !(cur.confirmedBy ?? []).includes(x));
        return [...newRej, ...newConf].every((x) => x === author) ? null : "link-forged-decision";
      }
      case "consents": return r.by === author ? null : "consent-not-by-author";   // the engine further ignores it unless the author is the subject or a guardian
      case "hides": return r.by === author ? null : "hide-not-by-author";
      case "claims": {
        if (!cur) return r.claimant === author && !(r.vouches ?? []).length ? null : "claim-forged";
        const added = (r.vouches ?? []).filter((v) => !(cur.vouches ?? []).includes(v));
        return r.claimant === cur.claimant && added.every((v) => v === author) ? null : "claim-forged";
      }
      default: return "unknown-collection";
    }
  }

  function push(viewer, ops) {
    if (!state.collections.users.has(viewer)) throw Object.assign(new Error("Unknown user."), { code: "auth" });
    const accepted = [], rejected = [];
    for (const op of (ops ?? []).slice(0, MAX_BATCH)) {
      const deny = (reason) => { rejected.push({ opId: op?.opId, reason }); audit.append({ actor: viewer, action: `push.${op?.collection}.${op?.type}`, target: op?.id, result: "refused", reason }); };
      if (!op?.opId) { deny("malformed"); continue; }
      if (state.applied.has(op.opId)) { accepted.push(op.opId); continue; }           // a retry: already have it
      if (Buffer.byteLength(JSON.stringify(op)) > MAX_OP_BYTES) { deny("too-large"); continue; }
      if (!verifyOp(op, devicesOf(op.author))) { deny("bad-signature"); continue; }
      const w = worldOf(state);
      const why = authorize(w, viewer, op);
      if (why) { deny(why); continue; }
      const r = merge(state, op);
      if (r.applied || r.reason === "stale" || r.reason === "tombstoned" || r.reason === "already-tombstoned") {
        if (r.applied) index(op);
        accepted.push(op.opId);
        audit.append({ actor: viewer, action: `push.${op.collection}.${op.type}`, target: op.id, result: r.reason });
      } else deny(r.reason);
    }
    persist();
    return { accepted, rejected };
  }

  // Everything this user may see and hasn't been sent yet, as the original signed ops. Visibility is recomputed on each
  // pull, so an item becomes visible as soon as a share, link or claim allows it, and a revocation reaches everyone who
  // ever received the record.
  function pull(viewer) {
    if (!state.collections.users.has(viewer)) throw Object.assign(new Error("Unknown user."), { code: "auth" });
    const w = worldOf(state), cl = clusters(w);
    const mine = new Set();
    for (const id of cl.ids()) {
      const ms = cl.members(id);
      if (ms.some((m) => m.owner === viewer) || cl.subjectOf(id) === viewer || ms.some((m) => (w.person(m.owner, m.personId)?.guardians ?? []).includes(viewer))) mine.add(id);
    }
    const inMine = (owner, personId) => mine.has(cl.clusterOf(owner, personId));
    const itemOk = (id) => canView(w, viewer, id, { now: now(), cl }).allow;
    const visibleItems = new Set(w.items.filter((it) => itemOk(it.id)).map((it) => it.id));
    const related = new Set([viewer]);
    for (const id of visibleItems) related.add(w.item(id).owner);
    for (const s of w.shares) if (s.owner === viewer) for (const u of audienceOf(w, s)) related.add(u);
    for (const g of w.groups) if (g.owner === viewer || (g.members ?? []).includes(viewer)) { related.add(g.owner); (g.members ?? []).forEach((m) => related.add(m)); }
    const visible = (c, r) => {
      switch (c) {
        case "users": return related.has(r.id);
        case "people": return r.owner === viewer || inMine(r.owner, r.id) || [...visibleItems].some((i) => w.item(i).owner === r.owner && (w.item(i).people ?? []).includes(r.id));
        case "items": return visibleItems.has(r.id);
        case "shares": return r.owner === viewer || (visibleItems.has(r.itemId) && (audienceOf(w, r).has(viewer) || w.item(r.itemId)?.owner !== viewer));
        case "links": return [r.a.owner, r.b.owner, r.proposer].includes(viewer) || (inMine(r.a.owner, r.a.personId) && inMine(r.b.owner, r.b.personId));
        case "consents": return r.by === viewer || r.subjectUserId === viewer || [...mine].some((id) => cl.subjectOf(id) === r.subjectUserId) || (r.person && inMine(r.person.owner, r.person.personId));
        case "hides": return r.by === viewer || visibleItems.has(r.itemId);
        case "claims": return r.claimant === viewer || r.person.owner === viewer || inMine(r.person.owner, r.person.personId);
        case "groups": return r.owner === viewer || (r.members ?? []).includes(viewer);
        default: return false;
      }
    };
    const out = [];
    for (const [k, ops] of opsByKey) {
      const [c, ...rest] = k.split("/"); const id = rest.join("/");
      if (!delivered.has(k)) delivered.set(k, new Map());
      const d = delivered.get(k);
      const got = Number(d.get(viewer) ?? 0);
      if (state.tombstones.has(k)) {
        const tomb = ops.find((o) => o.type === "tombstone");
        if (got > 0 && tomb && d.get(viewer + "#t") !== "1") { out.push(tomb); d.set(viewer + "#t", "1"); }
        continue;
      }
      const rec = state.collections[c]?.get(id);
      if (!rec || !visible(c, rec)) continue;
      if (got < ops.length) { out.push(...ops.slice(got)); d.set(viewer, String(ops.length)); }
    }
    if (out.length) persist();
    return { ops: out, cursor: state.log.length };
  }

  return {
    register, directory, push, pull,
    audit: (viewer) => audit.entries({ actor: viewer }),
    // tests and the reference server's own checks (never exposed over HTTP)
    _state: state, _world: () => worldOf(state), _audit: () => audit.entries(),
  };
}
