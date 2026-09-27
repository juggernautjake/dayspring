// Social: encryption and signatures, Node's built-in crypto only. docs/SOCIAL.md "Encryption".
//
//   generateIdentity()                       → { deviceId, enc: { pub, priv }, sign: { pub, priv } }   (base64 DER)
//   publicOf(identity)                       → { deviceId, encPub, signPub }
//   seal(plaintext, recipients, aad)         → { box: { v, iv, ct, tag }, keys: { "<user>/<device>": wrapped } }
//   open(sealed, kid, identity, aad)         → Buffer   (throws on any tampering)
//   wrapKey(key, encPub, kid) / unwrapKey(wrapped, identity)
//   signOp(op, identity) / verifyOp(op, signPubs[])        Ed25519 over canonical JSON (op without sig)
//   canonical(value)                          stable JSON (sorted keys) for signing
//   createKeyStore({ app, dir, crypto })     device keys on disk, protected with Windows DPAPI (credentials.mjs)
//
// Scheme (v1):
//   content   AES-256-GCM, a fresh random 32-byte key per shared item, 12-byte IV, AAD = "ds-social/v1|" + aad
//   key wrap  X25519 ECDH (an ephemeral key per wrap) → HKDF-SHA256(salt = epk || recipient pub, info = "ds-social wrap v1|" + kid)
//             → AES-256-GCM over the content key. So each recipient device gets its own wrapped copy; the server sees
//             only ciphertext, IVs, tags, and the ids of whose copies they are.
//   signing   Ed25519 per device; every op a device makes is signed, and the server and other clients check it.
// Nothing here runs at import time: no key is made until generateIdentity() or keyStore.create() is called.
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, randomUUID, sign as edSign, verify as edVerify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dpapi, ecoDir } from "../credentials.mjs";

export const SCHEME = "ds-social/v1";
const b64 = (buf) => Buffer.from(buf).toString("base64");
const unb64 = (s) => Buffer.from(String(s), "base64");

export function generateIdentity({ deviceId = null } = {}) {
  const enc = generateKeyPairSync("x25519");
  const sig = generateKeyPairSync("ed25519");
  return {
    v: 1, deviceId: deviceId ?? "dev_" + randomUUID().replace(/-/g, "").slice(0, 20), createdAt: new Date().toISOString(),
    enc: { pub: b64(enc.publicKey.export({ type: "spki", format: "der" })), priv: b64(enc.privateKey.export({ type: "pkcs8", format: "der" })) },
    sign: { pub: b64(sig.publicKey.export({ type: "spki", format: "der" })), priv: b64(sig.privateKey.export({ type: "pkcs8", format: "der" })) },
  };
}
export const publicOf = (id) => ({ deviceId: id.deviceId, encPub: id.enc.pub, signPub: id.sign.pub });
const pubKey = (s) => createPublicKey({ key: unb64(s), type: "spki", format: "der" });
const privKey = (s) => createPrivateKey({ key: unb64(s), type: "pkcs8", format: "der" });
export const fingerprint = (pub) => createHash("sha256").update(unb64(pub)).digest("hex").slice(0, 32).match(/.{4}/g).join(" ");

function gcmEncrypt(key, plaintext, aad) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return { iv: b64(iv), ct: b64(ct), tag: b64(c.getAuthTag()) };
}
function gcmDecrypt(key, box, aad) {
  const d = createDecipheriv("aes-256-gcm", key, unb64(box.iv));
  d.setAAD(Buffer.from(aad, "utf8"));
  d.setAuthTag(unb64(box.tag));
  return Buffer.concat([d.update(unb64(box.ct)), d.final()]);     // throws "Unsupported state or unable to authenticate data" on tampering
}

export function wrapKey(contentKey, recipientEncPub, kid) {
  const eph = generateKeyPairSync("x25519");
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: pubKey(recipientEncPub) });
  const epk = eph.publicKey.export({ type: "spki", format: "der" });
  const kek = Buffer.from(hkdfSync("sha256", shared, Buffer.concat([epk, unb64(recipientEncPub)]), Buffer.from("ds-social wrap v1|" + kid), 32));
  return { v: 1, alg: "x25519-hkdf-aes256gcm", epk: b64(epk), ...gcmEncrypt(kek, contentKey, "wrap|" + kid) };
}
export function unwrapKey(wrapped, identity, kid) {
  if (!wrapped || wrapped.alg !== "x25519-hkdf-aes256gcm") throw new Error("unknown key wrap");
  const shared = diffieHellman({ privateKey: privKey(identity.enc.priv), publicKey: pubKey(wrapped.epk) });
  const kek = Buffer.from(hkdfSync("sha256", shared, Buffer.concat([unb64(wrapped.epk), unb64(identity.enc.pub)]), Buffer.from("ds-social wrap v1|" + kid), 32));
  return gcmDecrypt(kek, wrapped, "wrap|" + kid);
}

// recipients: [{ userId, deviceId, encPub }] — every device of every person in the audience, plus the sharer's own.
export function seal(plaintext, recipients, aad = "") {
  const key = randomBytes(32);
  const data = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(typeof plaintext === "string" ? plaintext : JSON.stringify(plaintext), "utf8");
  const box = { v: 1, ...gcmEncrypt(key, data, SCHEME + "|" + aad) };
  const keys = {};
  for (const r of recipients) { const kid = `${r.userId}/${r.deviceId}`; keys[kid] = wrapKey(key, r.encPub, kid); }
  key.fill(0);
  return { box, keys };
}
// Give one more device a copy of an item's key (a new audience member, or the subject after a claim).
export function rewrap(sealed, fromKid, identity, recipient) {
  const key = unwrapKey(sealed.keys[fromKid], identity, fromKid);
  const kid = `${recipient.userId}/${recipient.deviceId}`;
  const out = { ...sealed, keys: { ...sealed.keys, [kid]: wrapKey(key, recipient.encPub, kid) } };
  key.fill(0);
  return out;
}
export function open(sealed, kid, identity, aad = "") {
  const w = sealed?.keys?.[kid];
  if (!w) throw new Error("this device has no key for that item");
  const key = unwrapKey(w, identity, kid);
  try { return gcmDecrypt(key, sealed.box, SCHEME + "|" + aad); } finally { key.fill(0); }
}
export const openJSON = (sealed, kid, identity, aad = "") => JSON.parse(open(sealed, kid, identity, aad).toString("utf8"));

// ---- signatures ------------------------------------------------------------------------------------------------------
export function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
}
const unsigned = (op) => { const { sig, ...rest } = op; return rest; };
export function signBytes(bytes, identity) { return b64(edSign(null, Buffer.from(bytes), privKey(identity.sign.priv))); }
export function verifyBytes(bytes, sig, signPub) { try { return edVerify(null, Buffer.from(bytes), pubKey(signPub), unb64(sig)); } catch { return false; } }
export function signOp(op, identity) { return { ...op, sig: { deviceId: identity.deviceId, value: signBytes(canonical(unsigned(op)), identity) } }; }
export function verifyOp(op, devices) {
  if (!op?.sig?.value) return false;
  const d = (devices ?? []).find((x) => x.deviceId === op.sig.deviceId && !x.revokedAt);
  return Boolean(d) && verifyBytes(canonical(unsigned(op)), op.sig.value, d.signPub);
}

// ---- device keys on disk ---------------------------------------------------------------------------------------------
// One file per app per Windows user: %LOCALAPPDATA%\Ecosystem\social-<app>-device.bin, DPAPI-protected like the shared
// AI key (credentials.mjs). load() never creates anything; create() is the only place a key is generated.
const MAGIC = Buffer.from("ESK1");
export function createKeyStore({ app, dir = null, crypto = null } = {}) {
  if (!app || !/^[a-z][a-z0-9-]{1,30}$/.test(app)) throw new Error("createKeyStore needs the app's name");
  const folder = () => dir ?? ecoDir();
  const file = () => join(folder(), `social-${app}-device.bin`);
  const box = () => crypto ?? dpapi({ entropy: "ecosystem-social-device-v1" });
  function load() {
    if (!existsSync(file())) return null;
    const raw = readFileSync(file());
    if (raw.length < 5 || !raw.subarray(0, 4).equals(MAGIC)) throw new Error("The device key file isn't one I recognise.");
    return JSON.parse(box().unprotect(raw.subarray(4)).toString("utf8"));
  }
  function save(identity) {
    mkdirSync(folder(), { recursive: true });
    const tmp = file() + ".tmp";
    writeFileSync(tmp, Buffer.concat([MAGIC, box().protect(Buffer.from(JSON.stringify(identity), "utf8"))]), { mode: 0o600 });
    renameSync(tmp, file());
    return publicOf(identity);
  }
  function create() { if (existsSync(file())) throw new Error("This device already has a key."); const id = generateIdentity(); save(id); return publicOf(id); }
  const exists = () => existsSync(file());
  const destroy = () => { rmSync(file(), { force: true }); return { exists: false }; };
  return { file, exists, load, create, save, destroy };
}
