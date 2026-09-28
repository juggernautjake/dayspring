// Mail passwords (IMAP/SMTP app passwords) encrypted at rest with Windows DPAPI for this Windows user, the same way the
// Google sign-ins are (lib/connectors/google.mjs), with this module's own key ("entropy"), so a copy of the file on
// another computer or for another Windows user can't be opened. The plain password is only ever kept in memory.
//   seal(text) → "dpapi:<base64>"      unseal("dpapi:…") → text
// DAYSPRING_TOKEN_CRYPTO=fake (tests) uses a reversible stand-in; off Windows (development only) it's "plain:".
import { dpapi, fakeCrypto } from "../../vendor/ecosystem-core/lib/credentials.mjs";

let box = null;
const crypto = () => (box ??= process.env.DAYSPRING_TOKEN_CRYPTO === "fake" ? fakeCrypto() : dpapi({ entropy: "dayspring-mail-v1" }));
export function _setCrypto(b) { box = b; memo.clear(); }                  // tests
const memo = new Map();                                                    // sealed → plain (so each login doesn't start PowerShell)

export function seal(text) {
  const s = String(text ?? "");
  if (process.platform !== "win32" && process.env.DAYSPRING_TOKEN_CRYPTO !== "fake") return "plain:" + Buffer.from(s, "utf8").toString("base64");
  const out = "dpapi:" + crypto().protect(Buffer.from(s, "utf8")).toString("base64");
  memo.set(out, s);
  return out;
}
export function unseal(v) {
  const s = String(v ?? "");
  if (memo.has(s)) return memo.get(s);
  let out;
  if (s.startsWith("dpapi:")) out = crypto().unprotect(Buffer.from(s.slice(6), "base64")).toString("utf8");
  else if (s.startsWith("plain:")) out = Buffer.from(s.slice(6), "base64").toString("utf8");
  else throw new Error("The saved mail password can't be read. Remove the mailbox in Settings → Email and add it again.");
  memo.set(s, out);
  return out;
}
export const forget = (v) => memo.delete(String(v ?? ""));
