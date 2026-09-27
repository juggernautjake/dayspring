// Social: making and revoking shares. docs/SOCIAL.md "Shares" and "Revocations and tombstones".
//
//   makeShare(w, { sharer, item, audience, permissions, expiresAt })  → share record (throws SocialError when not allowed)
//   revokeOps(w, { share, by, purgeItemIfLast })  → ops: a tombstone for the share (carrying its itemId) and, when no
//                                                   other live share of the item is left, a tombstone for the item too, so
//                                                   the server deletes the ciphertext
//   expireOps(w, { now, by })                      → tombstones for this user's shares whose expiresAt has passed
import { randomUUID } from "node:crypto";
import { canShare } from "./consent.mjs";
import { makeTombstoneOp } from "./sync.mjs";

export class SocialError extends Error {
  constructor(message, code = "denied") { super(message); this.name = "SocialError"; this.code = code; }
}

export const SHARE_DEFAULTS = { pool: true, reshare: false, download: false };

export function makeShare(w, { sharer, item, audience, permissions = {}, expiresAt = null, id = null, now = new Date() }) {
  const perms = { ...SHARE_DEFAULTS, ...permissions };
  const ok = canShare(w, sharer, item, audience, perms);
  if (!ok.allow) throw new SocialError(`This can't be shared (${ok.reason}).`, ok.reason);
  const minor = (item.people ?? []).some((pid) => w.person(sharer, pid)?.isMinor);
  if (minor) { perms.reshare = false; perms.download = false; }
  return {
    id: id ?? "shr_" + randomUUID(), itemId: item.id, owner: sharer,
    audience: { users: [...new Set(audience.users ?? [])], groups: [...new Set(audience.groups ?? [])] },
    permissions: perms, expiresAt, createdAt: new Date(now).toISOString(), rev: 1,
  };
}

export function revokeOps(w, { share, by, purgeItemIfLast = true }) {
  if (!share) throw new SocialError("There's no such share.", "no-share");
  if (share.owner !== by) throw new SocialError("Only the person who shared it can revoke a share.", "not-owner");
  const ops = [makeTombstoneOp({ collection: "shares", id: share.id, author: by, reason: "revoked", extra: { itemId: share.itemId } })];
  const others = w.sharesOf(share.itemId).filter((s) => s.id !== share.id);
  if (purgeItemIfLast && !others.length) ops.push(makeTombstoneOp({ collection: "items", id: share.itemId, author: by, reason: "last-share-revoked" }));
  return ops;
}

export function expireOps(w, { now = Date.now(), by }) {
  const t = now instanceof Date ? now.getTime() : now;
  return w.shares.filter((s) => s.owner === by && s.expiresAt && Date.parse(s.expiresAt) <= t && !w.isTombstoned("shares", s.id))
    .map((s) => makeTombstoneOp({ collection: "shares", id: s.id, author: by, reason: "expired", extra: { itemId: s.itemId } }));
}
