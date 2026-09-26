// Where each connection keeps its keys and sign-in (data/connectors/<name>.json, on this computer only), plus PKCE
// helpers for the sign-in flows. Values are never sent to the page: status() says only what's set.
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";

const DIR = process.env.DAYSPRING_CONNECTORS_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "connectors");
const file = (name) => join(DIR, `${name}.json`);
export function load(name) { try { return existsSync(file(name)) ? JSON.parse(readFileSync(file(name), "utf8")) : {}; } catch { return {}; } }
export function save(name, data) {
  mkdirSync(DIR, { recursive: true });
  const f = file(name), tmp = f + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2)); renameSync(tmp, f);
  return data;
}
export const patch = (name, p) => save(name, { ...load(name), ...p });
export function forget(name) { rmSync(file(name), { force: true }); }

// PKCE (RFC 7636) and a one-time state
const b64u = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function pkce() {
  const verifier = b64u(randomBytes(48));
  return { verifier, challenge: b64u(createHash("sha256").update(verifier).digest()), state: b64u(randomBytes(18)) };
}
// the pending sign-ins, kept in memory for 15 minutes
const pending = new Map();
export function remember(state, data) { pending.set(state, { ...data, at: Date.now() }); for (const [k, v] of pending) if (Date.now() - v.at > 15 * 60_000) pending.delete(k); }
export function take(state) { const v = pending.get(state); pending.delete(state); return v && Date.now() - v.at < 15 * 60_000 ? v : null; }

// a friendly error from an HTTP response
export async function fail(res, who) {
  let detail = ""; try { const j = await res.json(); detail = j.error_description || j.error?.message || j.message || (typeof j.error === "string" ? j.error : "") || ""; } catch { /* not json */ }
  const e = new Error(`${who} said ${res.status}${detail ? `: ${String(detail).slice(0, 200)}` : ""}`); e.status = res.status; return e;
}
