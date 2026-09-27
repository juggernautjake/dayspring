// Social: the replicated state, operations, idempotent merge, and the outbox. docs/SOCIAL.md "Sync protocol".
//
//   const s = createState();
//   const op = makeOp({ collection: "shares", record, author: "u_ann" });   // a put
//   const t  = makeTombstoneOp({ collection: "shares", id, author, reason });  // a revocation / deletion
//   merge(s, op)  → { applied: bool, reason }     applying the same op twice changes nothing
//   get(s, "shares", id), all(s, "shares"), isTombstoned(s, "shares", id), since(s, cursor) → { ops, cursor }
//
// Conflict rules (in order):
//   1. an op already applied (same opId) is ignored                    — idempotent retries
//   2. a tombstone always wins, and nothing can bring the record back   — revocation is final; share again = new id
//   3. links merge their endorsements and rejections as sets (a grow-only set per link), whatever order they arrive in
//   4. otherwise the higher rev wins; equal revs → later `at`; then the larger opId (deterministic on every replica)
import { randomUUID } from "node:crypto";
import { COLLECTIONS, validate } from "./schema.mjs";

export function createState() {
  const collections = {};
  for (const c of COLLECTIONS) if (c !== "tombstones") collections[c] = new Map();
  return { collections, tombstones: new Map(), applied: new Set(), log: [], meta: new Map() };
}

const key = (collection, id) => `${collection}/${id}`;
const nowIso = () => new Date().toISOString();

export function makeOp({ collection, record, author, rev = null, at = null, opId = null }) {
  if (!COLLECTIONS.includes(collection) || collection === "tombstones") throw new Error(`makeOp: unknown collection ${collection}`);
  return { v: 1, opId: opId ?? randomUUID(), type: "put", collection, id: record.id, record: structuredClone(record), author, rev: rev ?? record.rev ?? 1, at: at ?? nowIso() };
}
export function makeTombstoneOp({ collection, id, author, reason = "revoked", rev = null, at = null, opId = null, extra = {} }) {
  const when = at ?? nowIso();
  return { v: 1, opId: opId ?? randomUUID(), type: "tombstone", collection, id, record: { ...extra, id, collection, by: author, at: when, reason }, author, rev: rev ?? Number.MAX_SAFE_INTEGER, at: when };
}

function newer(op, cur) {
  if (op.rev !== cur.rev) return op.rev > cur.rev;
  if (op.at !== cur.at) return op.at > cur.at;
  return op.opId > cur.opId;
}

function mergeLink(existing, incoming) {
  const out = { ...existing };
  const by = new Map();
  for (const e of [...(existing.endorsements ?? []), ...(incoming.endorsements ?? [])]) {
    const prev = by.get(e.by);
    if (!prev || e.confidence > prev.confidence) by.set(e.by, e);
  }
  out.endorsements = [...by.values()].sort((x, y) => (x.by < y.by ? -1 : 1));
  out.rejectedBy = [...new Set([...(existing.rejectedBy ?? []), ...(incoming.rejectedBy ?? [])])].sort();
  out.confirmedBy = [...new Set([...(existing.confirmedBy ?? []), ...(incoming.confirmedBy ?? [])])].sort();
  return out;
}

export function merge(state, op) {
  if (!op || typeof op !== "object" || !op.opId) return { applied: false, reason: "malformed" };
  if (state.applied.has(op.opId)) return { applied: false, reason: "duplicate" };
  const k = key(op.collection, op.id);
  if (op.type === "tombstone") {
    const v = validate("tombstones", op.record);
    if (!v.ok) return { applied: false, reason: "invalid: " + v.errors.join("; ") };
    state.applied.add(op.opId);
    if (state.tombstones.has(k)) return { applied: false, reason: "already-tombstoned" };
    state.tombstones.set(k, structuredClone(op.record));
    state.collections[op.collection]?.delete(op.id);
    state.meta.delete(k);
    state.log.push(op);
    return { applied: true, reason: "tombstoned" };
  }
  if (op.type !== "put") return { applied: false, reason: "unknown op type" };
  if (state.tombstones.has(k)) { state.applied.add(op.opId); return { applied: false, reason: "tombstoned" }; }
  const v = validate(op.collection, op.record);
  if (!v.ok) return { applied: false, reason: "invalid: " + v.errors.join("; ") };
  state.applied.add(op.opId);
  const coll = state.collections[op.collection];
  const cur = state.meta.get(k);
  const existing = coll.get(op.id);
  if (op.collection === "links" && existing) {
    const merged = mergeLink(existing, op.record);
    const base = !cur || newer(op, cur) ? { ...op.record, endorsements: merged.endorsements, rejectedBy: merged.rejectedBy, confirmedBy: merged.confirmedBy } : merged;
    coll.set(op.id, base);
    if (!cur || newer(op, cur)) state.meta.set(k, { rev: op.rev, at: op.at, opId: op.opId });
    state.log.push(op);
    return { applied: true, reason: "merged" };
  }
  if (cur && !newer(op, cur)) return { applied: false, reason: "stale" };
  coll.set(op.id, structuredClone(op.record));
  state.meta.set(k, { rev: op.rev, at: op.at, opId: op.opId });
  state.log.push(op);
  return { applied: true, reason: cur ? "updated" : "created" };
}

export function mergeAll(state, ops) { return ops.map((op) => ({ opId: op?.opId, ...merge(state, op) })); }

export const get = (state, collection, id) => (state.collections[collection]?.get(id) ?? null);
export const all = (state, collection) => (collection === "tombstones" ? [...state.tombstones.values()] : [...(state.collections[collection]?.values() ?? [])]);
export const isTombstoned = (state, collection, id) => state.tombstones.has(key(collection, id));

// Ops after a cursor (the log position), for pulls. The server filters them per viewer before sending.
export function since(state, cursor = 0) { return { ops: state.log.slice(cursor), cursor: state.log.length }; }

export function toJSON(state) {
  return { v: 1, log: state.log, applied: [...state.applied] };
}
export function fromJSON(json) {
  const s = createState();
  for (const op of json?.log ?? []) merge(s, op);
  for (const id of json?.applied ?? []) s.applied.add(id);
  return s;
}

// The outbox: ops made on this device wait here until the server has them. Retrying is always safe (merge is
// idempotent on opId). A rejected op is dropped and kept in `rejected` with the server's reason.
export function createOutbox({ load = () => null, save = () => {} } = {}) {
  let q = load() ?? { pending: [], rejected: [] };
  const persist = () => save(q);
  return {
    enqueue(op) { if (!q.pending.some((o) => o.opId === op.opId)) { q.pending.push(op); persist(); } return op; },
    pending: () => q.pending.slice(),
    rejected: () => q.rejected.slice(),
    async flush(adapter, session) {
      if (!q.pending.length) return { sent: 0, accepted: 0, rejected: 0 };
      const batch = q.pending.slice(0, 200);
      const r = await adapter.push(session, batch);
      const ok = new Set(r.accepted ?? []);
      const bad = new Map((r.rejected ?? []).map((x) => [x.opId, x.reason]));
      q.pending = q.pending.filter((o) => !ok.has(o.opId) && !bad.has(o.opId));
      for (const [opId, reason] of bad) q.rejected.push({ opId, reason });
      persist();
      return { sent: batch.length, accepted: ok.size, rejected: bad.size };
    },
  };
}
