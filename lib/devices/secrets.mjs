// Secrets for the smart home and the printers (device passwords, Tapo/Kasa account logins, Meross keys, Bambu access
// codes, OctoPrint/Moonraker API keys). They never sit on disk in plain text: the whole secrets map is sealed as one
// blob with Windows DPAPI (this Windows user only; a copy of the file on another computer or another user can't open
// it), the same protection the shared AI key uses (vendor/ecosystem-core/lib/credentials.mjs).
//   seal(obj) → "dpapi:<base64>"      open(str) → obj ({} for nothing)      _setCrypto(fakeCrypto()) in tests
// Not on Windows (development only): a clearly marked "plain-dev:" blob, never used on the owner's computer.
import { dpapi, fakeCrypto } from "../../vendor/ecosystem-core/lib/credentials.mjs";

let box = null, boxName = null;
export function _setCrypto(c) { box = c; boxName = c ? c.name ?? "custom" : null; memo.clear(); }
function current() {
  if (box) return { box, name: boxName };
  if (process.env.DAYSPRING_TEST_CRYPTO === "fake") return { box: fakeCrypto(), name: "fake" };
  if (process.platform !== "win32") return { box: { protect: (b) => b, unprotect: (b) => b }, name: "plain-dev" };
  return { box: dpapi({ entropy: "dayspring-home-v1" }), name: "dpapi" };
}
// sealing is a PowerShell round trip on Windows (about half a second): the last few answers are remembered
const memo = new Map();
export function seal(obj) {
  const clean = obj && typeof obj === "object" ? obj : {};
  if (!Object.keys(clean).length) return "";
  const { box: b, name } = current();
  const out = `${name}:${b.protect(Buffer.from(JSON.stringify(clean), "utf8")).toString("base64")}`;
  memo.set(out, structuredClone(clean));
  return out;
}
export function open(str) {
  const s = String(str ?? "");
  if (!s) return {};
  if (memo.has(s)) return structuredClone(memo.get(s));
  const i = s.indexOf(":");
  const { box: b, name } = current();
  if (i < 0 || s.slice(0, i) !== name) throw new Error("The saved device passwords were protected on another computer or by another Windows user. Enter them again in Settings.");
  const obj = JSON.parse(b.unprotect(Buffer.from(s.slice(i + 1), "base64")).toString("utf8"));
  if (memo.size > 20) memo.clear();
  memo.set(s, obj);
  return structuredClone(obj);
}
// a secret for the screen: only whether it's set, never the value
export const mask = (v) => (v ? "••••••" : "");
