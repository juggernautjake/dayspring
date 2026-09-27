// The developer's private key, kept ONLY on his own computer: %LOCALAPPDATA%\Ecosystem\dev-key.bin, encrypted with
// Windows' per-user protection (DPAPI, the same helper as the shared AI key: vendor/ecosystem-core credentials.mjs).
// It is never written anywhere else, never printed, and never inside the app folder (so never in data/ or an export).
//   keyFile() · hasKey() · loadKey() → KeyObject | null · createKey() → KeyObject · publicB64(key) · signToken(key, payload)
import { generateKeyPairSync, createPrivateKey, createPublicKey, randomBytes, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dpapi, ecoDir } from "../../vendor/ecosystem-core/lib/credentials.mjs";
import { PURPOSE, payloadText } from "../../lib/dev/status.mjs";

const MAGIC = Buffer.from("DSK1");
const box = () => dpapi({ entropy: "dayspring-dev-key-v1" });
export const keyFile = () => join(ecoDir(), "dev-key.bin");
export const hasKey = (file = keyFile()) => existsSync(file);

export function loadKey({ file = keyFile(), crypto = box() } = {}) {
  if (!existsSync(file)) return null;
  const raw = readFileSync(file);
  if (raw.length < 5 || !raw.subarray(0, 4).equals(MAGIC)) throw new Error("The dev key file isn't one I recognise.");
  const der = crypto.unprotect(raw.subarray(4));
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}
export function createKey({ file = keyFile(), crypto = box() } = {}) {
  if (existsSync(file)) throw new Error("A dev key already exists on this computer.");
  const { privateKey } = generateKeyPairSync("ed25519");
  const der = privateKey.export({ format: "der", type: "pkcs8" });
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  writeFileSync(tmp, Buffer.concat([MAGIC, crypto.protect(der)]), { mode: 0o600 });
  renameSync(tmp, file);
  der.fill(0);
  return privateKey;
}
export const publicB64 = (key) => createPublicKey(key).export({ format: "der", type: "spki" }).toString("base64");

// a token for one computer (machine = its hashed id: lib/dev/status.mjs machineId())
export function signToken(key, { machine, issued = new Date().toISOString(), id = randomBytes(9).toString("base64url"), purpose = PURPOSE } = {}) {
  const payload = { purpose, machine, issued, id };
  return { v: 1, payload, sig: sign(null, Buffer.from(payloadText(payload), "utf8"), key).toString("base64") };
}
