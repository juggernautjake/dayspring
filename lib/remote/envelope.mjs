// Remote control: the signed, end-to-end encrypted messages between the owner's devices, and the signed statements
// (certificates) that say which devices are his. Built on ecosystem-core's social crypto (Node's crypto only):
//   Ed25519 signatures over canonical JSON · X25519 + HKDF-SHA256 key wrap · AES-256-GCM content.
// The hub (Supabase) stores and relays these but can't read a payload or forge a signature.
// Only loaded once remote control is in use (lib/remote/index.mjs imports it lazily), never at startup otherwise.
//
//   newIdentity() · publicOf(identity)
//   sign(obj, identity) · verify(obj, signPub)
//   makeEnvelope({...}) · checkEnvelope(env, row, ctx) · openEnvelope(env, identity)
//   makeCert / makeGrant / makeRevocation / makeOffer · sas(...)  the pairing code shown on both screens
//   sealTo(payload, recipients, aad) · openSealed(sealed, identity, user, aad)
import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as C from "../../vendor/ecosystem-core/lib/social/crypto.mjs";
import { PROTO, LIMITS } from "./policy.mjs";

export { PROTO };
export const canonical = C.canonical;
export const fingerprint = C.fingerprint;

export function newIdentity() { return C.generateIdentity({ deviceId: "dev_" + randomBytes(10).toString("hex") }); }
export const publicOf = (id) => ({ deviceId: id.deviceId, signPub: id.sign.pub, encPub: id.enc.pub });

const unsigned = (o) => { const { sig, ...rest } = o ?? {}; return rest; };
export function sign(obj, identity) { return { ...obj, sig: { deviceId: identity.deviceId, value: C.signBytes(C.canonical(unsigned(obj)), identity) } }; }
export function verify(obj, signPub) {
  if (!obj?.sig?.value || !signPub) return false;
  return C.verifyBytes(C.canonical(unsigned(obj)), obj.sig.value, signPub);
}

// ---- sealing (X25519 + AES-GCM; each recipient device gets its own wrapped copy of the content key) --------------------
export const kidOf = (user, device) => `${user}/${device}`;
export function sealTo(payload, recipients, aad) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload), "utf8");
  return C.seal(data, recipients.map((r) => ({ userId: r.userId, deviceId: r.deviceId, encPub: r.encPub })), PROTO + "|" + aad);
}
export function openSealed(sealed, identity, user, aad) { return C.open(sealed, kidOf(user, identity.deviceId), identity, PROTO + "|" + aad); }
export const openSealedJSON = (sealed, identity, user, aad) => JSON.parse(openSealed(sealed, identity, user, aad).toString("utf8"));

// ---- envelopes ---------------------------------------------------------------------------------------------------------
// head fields are all signed, and bound into the encryption (AAD), so nothing can be moved between messages
const aadOf = (h) => ["env", h.id, h.kind, h.user, h.from, h.to, h.ts, h.exp, h.replyTo ?? "", h.seq ?? 0, h.nonce].join("|");
export function makeEnvelope({ identity, user, to, toEncPub, kind, payload, id = randomUUID(), replyTo = null, seq = 0, ttlMs = LIMITS.COMMAND_TTL_MS, now = Date.now() }) {
  const head = { v: 1, p: PROTO, id, kind, user, from: identity.deviceId, to, ts: now, exp: now + ttlMs, nonce: randomBytes(16).toString("base64"), replyTo: replyTo ?? null, seq };
  const sealed = sealTo(payload, [{ userId: user, deviceId: to, encPub: toEncPub }], aadOf(head));
  return sign({ ...head, sealed }, identity);
}
// Every check except "have I seen it before" (the engine keeps that list). Returns null when it's fine, else a reason.
//   row: the hub's row it came in (its columns must agree with the signed envelope)
//   ctx: { me, user, now, trusted(deviceId) → { signPub } | null }
export function checkEnvelope(env, row, { me, user, now, trusted }) {
  if (!env || env.v !== 1 || env.p !== PROTO) return "not a Dayspring remote message";
  if (!["cmd", "resp", "chunk"].includes(env.kind)) return "unknown kind";
  if (row && (row.id !== env.id || row.from_device !== env.from || row.to_device !== env.to || row.kind !== env.kind)) return "the hub's copy doesn't match the signed message";
  if (env.to !== me) return "not for this device";
  if (env.user !== user) return "from another account";
  const sender = trusted(env.from);
  if (!sender) return "from a device that isn't one of yours (not approved, or signed out)";
  if (!env.sig || env.sig.deviceId !== env.from || !verify(env, sender.signPub)) return "the signature doesn't check out (forged or changed)";
  if (!Number.isFinite(env.ts) || !Number.isFinite(env.exp)) return "no time on it";
  if (env.ts - now > LIMITS.MAX_SKEW_MS) return "dated in the future";
  if (now - env.ts > LIMITS.MAX_AGE_MS + LIMITS.MAX_SKEW_MS) return "too old (sent more than 5 minutes ago)";
  if (env.exp <= now - LIMITS.MAX_SKEW_MS) return "expired";
  if (env.exp - env.ts > LIMITS.COMMAND_TTL_MS + 1000) return "asks to live longer than 5 minutes";
  if (typeof env.nonce !== "string" || env.nonce.length < 16) return "no nonce";
  return null;
}
export function openEnvelope(env, identity, { json = true } = {}) {
  const buf = openSealed(env.sealed, identity, env.user, aadOf(env));
  return json ? JSON.parse(buf.toString("utf8")) : buf;
}

// ---- statements about devices (certificates) --------------------------------------------------------------------------
//   root     the account's first device vouches for itself
//   approve  an approved device vouches for a new one (after the owner compared the pairing code on both)
//   grant    what a device may ask the others to do
//   revoke   a device is signed out for good (by another device, or by itself)
//   offer    the approving device's keys, for one pairing request
//   profile  what a device can control (names), sealed to every approved device
export function makeCert(identity, { user, device, signPub, encPub, name, type = "approve", at = Date.now() }) {
  return sign({ t: PROTO + "/" + type, user, device, signPub, encPub, name: String(name ?? "").slice(0, 60), by: identity.deviceId, at }, identity);
}
export function makeGrant(identity, { user, device, perms, at = Date.now() }) {
  return sign({ t: PROTO + "/grant", user, device, perms: [...new Set(perms)].sort(), by: identity.deviceId, at }, identity);
}
export function makeRevocation(identity, { user, device, at = Date.now(), reason = "" }) {
  return sign({ t: PROTO + "/revoke", user, device, by: identity.deviceId, at, reason: String(reason).slice(0, 80) }, identity);
}
export function makeOffer(identity, { user, pairing, at = Date.now() }) {
  const p = publicOf(identity);
  return sign({ t: PROTO + "/offer", user, pairing, approver: p.deviceId, signPub: p.signPub, encPub: p.encPub, at }, identity);
}
// The 6-digit pairing code. Both screens work it out from the SAME inputs: the request, the approving device's keys and
// the new device's keys. If anyone swapped a key in between (an attacker's device answering the request, a hub that
// changes a row), the two screens show different codes.
export function sas({ pairing, offerSignPub, offerEncPub, deviceSignPub, deviceEncPub }) {
  const h = createHash("sha256").update(["ds-remote pairing v1", pairing, offerSignPub, offerEncPub, deviceSignPub, deviceEncPub].join("|")).digest();
  const n = h.readUInt32BE(0) % 1_000_000;
  const s = String(n).padStart(6, "0");
  return s.slice(0, 3) + " " + s.slice(3);
}
export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
