// Social: an append-only, hash-chained audit log. docs/SOCIAL.md "Audit log".
// Each entry records who did what to which record, and why a request was refused. No content, names or keys: ids and
// reason codes only. Each entry's hash covers the previous one, so a removed or edited entry breaks the chain.
//
//   const log = createAuditLog({ load, save })     // load() → entries[] | null; save(entries)
//   log.append({ actor, action, target, result, reason })   → the entry
//   log.entries({ actor })                                    → entries (optionally one actor's)
//   verifyChain(entries) → { ok, brokenAt }
import { createHash } from "node:crypto";
import { canonical } from "./crypto.mjs";

const GENESIS = "0".repeat(64);
const hashOf = (e) => createHash("sha256").update(canonical({ ...e, hash: undefined })).digest("hex");
const clean = (v) => (v === undefined || v === null ? null : String(v).slice(0, 200));

export function createAuditLog({ load = () => null, save = () => {}, now = () => new Date() } = {}) {
  let list = load() ?? [];
  return {
    append({ actor, action, target = null, result = "ok", reason = null }) {
      const prev = list.length ? list[list.length - 1].hash : GENESIS;
      const e = { seq: list.length + 1, at: now().toISOString(), actor: clean(actor), action: clean(action), target: clean(target), result: clean(result), reason: clean(reason), prev };
      e.hash = hashOf(e);
      list.push(e);
      save(list);
      return e;
    },
    entries: ({ actor = null } = {}) => list.filter((e) => !actor || e.actor === actor).map((e) => ({ ...e })),
    size: () => list.length,
  };
}

export function verifyChain(entries) {
  let prev = GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.prev !== prev || e.seq !== i + 1 || hashOf(e) !== e.hash) return { ok: false, brokenAt: i + 1 };
    prev = e.hash;
  }
  return { ok: true, brokenAt: null };
}
