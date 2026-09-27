// Developer status: whether THIS computer belongs to the app's developer, so the developer preview (every badge's art,
// every character, including the secret ones) can be shown to him and to nobody else.
//
// Every install is its own "owner", and the code is public, so neither "the owner" nor any secret in the code can say who
// the developer is. Instead: a dev token, a small file on the developer's computer holding an Ed25519 signature over
//   { purpose: "dayspring-dev", machine: <this computer's id, hashed>, issued, id }
// made with the developer's PRIVATE key (which never leaves his computer: scripts/dev/make-dev-token.mjs). The app checks
// it with the PUBLIC key in lib/dev/public-key.mjs. A token copied to another computer doesn't match that computer's id,
// and a revoked one (lib/dev/revoked.mjs) doesn't count.
//
// Honest limits: the code is open source, so someone can always patch their own copy to call themselves a developer. The
// point is that nobody can just flip a setting, edit data/ or copy a file to see what they haven't earned.
//
//   isDev() → true/false        status() → { dev, reason, via, id?, issued? }
//   verifyToken(token, { machine, keys, revoked }) → { ok, reason }        machineId() · tokenPath() · payloadText(p)
//   log(action, data)           a line in the activity log (kind "dev")
import { spawnSync } from "node:child_process";
import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { DEV_PUBLIC_KEYS } from "./public-key.mjs";
import { REVOKED_TOKEN_IDS } from "./revoked.mjs";

export const PURPOSE = "dayspring-dev";
export const TOKEN_FILE = "dev-token.json";

// where the token lives: %LOCALAPPDATA%\Dayspring\dev-token.json (never inside the app, so never in data/ or an export).
// DAYSPRING_DEV_TOKEN points somewhere else (tests); the token there still has to be signed and match this computer.
export function tokenPath(env = process.env) {
  if (env.DAYSPRING_DEV_TOKEN) return env.DAYSPRING_DEV_TOKEN;
  if (process.platform === "win32" && env.LOCALAPPDATA) return join(env.LOCALAPPDATA, "Dayspring", TOKEN_FILE);
  return join(homedir(), ".local", "share", "dayspring", TOKEN_FILE);
}

// A stable id for this computer (Windows' MachineGuid; /etc/machine-id elsewhere), hashed so the token never holds it.
let machineCache = null;
function rawMachineId() {
  if (process.platform === "win32") {
    try {
      const r = spawnSync("reg.exe", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
      const m = /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{16,})/.exec(r.stdout ?? "");
      if (m) return m[1];
    } catch { /* fall through */ }
  }
  for (const f of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) { try { const s = readFileSync(f, "utf8").trim(); if (s) return s; } catch { /* next */ } }
  return `host:${hostname()}`;
}
export function machineId() {
  return (machineCache ??= createHash("sha256").update(`dayspring-dev-machine-v1:${rawMachineId().toLowerCase()}`).digest("hex"));
}

// The exact text that is signed (a fixed key order, so signer and checker agree)
export function payloadText(p) {
  return JSON.stringify({ purpose: String(p?.purpose ?? ""), machine: String(p?.machine ?? ""), issued: String(p?.issued ?? ""), id: String(p?.id ?? "") });
}

const keyObjects = new Map();
const pub = (b64) => { if (!keyObjects.has(b64)) { try { keyObjects.set(b64, createPublicKey({ key: Buffer.from(b64, "base64"), format: "der", type: "spki" })); } catch { keyObjects.set(b64, null); } } return keyObjects.get(b64); };

// token: the parsed file { v, payload, sig }. Reasons: missing · malformed · purpose · machine · revoked · no-key · signature
export function verifyToken(token, { machine = null, keys = DEV_PUBLIC_KEYS, revoked = REVOKED_TOKEN_IDS } = {}) {
  if (!token) return { ok: false, reason: "missing" };
  const p = token.payload, sig = typeof token.sig === "string" ? token.sig : "";
  if (!p || typeof p !== "object" || !sig || !p.id || !p.issued) return { ok: false, reason: "malformed" };
  if (p.purpose !== PURPOSE) return { ok: false, reason: "purpose" };
  if (p.machine !== (machine ?? machineId())) return { ok: false, reason: "machine" };
  if (revoked.includes(String(p.id))) return { ok: false, reason: "revoked" };
  if (!keys.length) return { ok: false, reason: "no-key" };
  let sigBuf; try { sigBuf = Buffer.from(sig, "base64"); } catch { return { ok: false, reason: "malformed" }; }
  const data = Buffer.from(payloadText(p), "utf8");
  for (const k of keys) { const ko = pub(k); try { if (ko && edVerify(null, data, ko, sigBuf)) return { ok: true, reason: "ok", id: String(p.id), issued: String(p.issued) }; } catch { /* next key */ } }
  return { ok: false, reason: "signature" };
}

// The token file is read again only when it changes (its path, size or time), so asking on every request is cheap.
let cache = { sig: null, res: null };
export function status() {
  const file = tokenPath();
  let st = null; try { st = statSync(file); } catch { /* no token */ }
  const sig = st ? `${file}|${st.size}|${st.mtimeMs}` : `${file}|none`;
  if (cache.sig === sig && cache.res) return cache.res;
  let res;
  if (!st) res = { dev: false, reason: "missing" };
  else {
    let tok = null; try { tok = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")); } catch { /* damaged */ }
    const v = tok ? verifyToken(tok) : { ok: false, reason: "malformed" };
    res = v.ok ? { dev: true, reason: "ok", via: "token", id: v.id, issued: v.issued } : { dev: false, reason: v.reason };
  }
  cache = { sig, res };
  return res;
}
export const isDev = () => { try { return status().dev === true; } catch { return false; } };
export const _clear = () => { cache = { sig: null, res: null }; };

// the activity log (kind "dev"): what a developer action did, so it can be checked and undone
export async function log(action, data = {}) {
  try { const a = await import("../activity.mjs"); return a.log("dev", { action, ...data }); } catch { return null; }
}
