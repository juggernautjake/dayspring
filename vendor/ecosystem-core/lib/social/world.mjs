// Social: a read-only, indexed view over the records (from a sync state or plain arrays), shared by the pure engines
// (consent, pooling, links, reminders). Nothing here does I/O.
//
//   const w = worldOf(state)                       // from sync.createState()
//   const w = worldOf({ users: [...], people: [...], items: [...], shares: [...], ... })
import { COLLECTIONS } from "./schema.mjs";

export function worldOf(src) {
  const arr = (c) => {
    if (src?.collections) return c === "tombstones" ? [...src.tombstones.values()] : [...(src.collections[c]?.values() ?? [])];
    return Array.isArray(src?.[c]) ? src[c] : [];
  };
  const w = { byId: {} };
  for (const c of COLLECTIONS) {
    w[c] = arr(c);
    w.byId[c] = new Map(w[c].map((r) => [r.id, r]));
  }
  w.tomb = new Set(w.tombstones.map((t) => `${t.collection}/${t.id}`));
  w.isTombstoned = (collection, id) => w.tomb.has(`${collection}/${id}`);
  w.user = (id) => w.byId.users.get(id) ?? null;
  w.item = (id) => (w.isTombstoned("items", id) ? null : w.byId.items.get(id) ?? null);
  w.person = (owner, personId) => { const p = w.byId.people.get(personId); return p && p.owner === owner && !w.isTombstoned("people", personId) ? p : null; };
  w.sharesOf = (itemId) => w.shares.filter((s) => s.itemId === itemId && !w.isTombstoned("shares", s.id));
  w.group = (id) => (w.isTombstoned("groups", id) ? null : w.byId.groups.get(id) ?? null);
  w.hidesOf = (itemId) => w.hides.filter((h) => h.itemId === itemId && !w.isTombstoned("hides", h.id));
  return w;
}

export const nodeKey = (owner, personId) => `${owner}:${personId}`;
export const parseNode = (k) => { const i = k.indexOf(":"); return { owner: k.slice(0, i), personId: k.slice(i + 1) }; };
