// Camera passwords, encrypted at rest with Windows DPAPI for this Windows user (the same way mail passwords are, with
// this module's own key), and addresses with the password taken out. A saved camera never holds a password in plain
// text: "rtsp://admin:hunter2@192.168.1.20/..." is kept as "rtsp://{user}:{pass}@192.168.1.20/..." with the user name
// beside it and the password sealed. The plain password only ever lives in memory, and redact() is what every log line,
// error message and page sees.
//   seal(text) → "dpapi:<base64>"   unseal(v) → text   splitUrl(url) → { url, username, password }   fill(url, user, pass)
//   redact(textOrUrl) → the same with any password (and user:password@) replaced by ***
// DAYSPRING_TOKEN_CRYPTO=fake (tests) uses a reversible stand-in; off Windows (development only) it's "plain:".
import { dpapi, fakeCrypto } from "../../vendor/ecosystem-core/lib/credentials.mjs";

let box = null;
const crypto = () => (box ??= process.env.DAYSPRING_TOKEN_CRYPTO === "fake" ? fakeCrypto() : dpapi({ entropy: "dayspring-cameras-v1" }));
export function _setCrypto(b) { box = b; memo.clear(); }                  // tests
const memo = new Map();                                                    // sealed → plain (so each snapshot doesn't start PowerShell)

export function seal(text) {
  const s = String(text ?? "");
  if (!s) return "";
  if (process.platform !== "win32" && process.env.DAYSPRING_TOKEN_CRYPTO !== "fake") return "plain:" + Buffer.from(s, "utf8").toString("base64");
  const out = (process.env.DAYSPRING_TOKEN_CRYPTO === "fake" ? "fake:" : "dpapi:") + crypto().protect(Buffer.from(s, "utf8")).toString("base64");
  memo.set(out, s);
  return out;
}
export const isSealed = (v) => /^(dpapi|fake|plain):/.test(String(v ?? ""));
export function unseal(v) {
  const s = String(v ?? "");
  if (!s) return "";
  if (memo.has(s)) return memo.get(s);
  let out;
  if (s.startsWith("dpapi:") || s.startsWith("fake:")) out = crypto().unprotect(Buffer.from(s.slice(s.indexOf(":") + 1), "base64")).toString("utf8");
  else if (s.startsWith("plain:")) out = Buffer.from(s.slice(6), "base64").toString("utf8");
  else throw new Error("A saved camera password can't be read. Open the camera in Settings → Cameras and type its password again.");
  memo.set(s, out);
  return out;
}

const PASS_Q = /^(password|passwd|pwd|pass|pw)$/i, USER_Q = /^(user|username|usr|login|account)$/i;
// Takes the user name and password out of an address (user:pass@ and ?user=…&password=…), leaving {user} / {pass}.
export function splitUrl(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return { url: "", username: "", password: "" };
  let username = "", password = "";
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/@\s]*)@/i.exec(s);
  if (m && m[2] && !/^\{user\}(:\{pass\})?$/.test(m[2])) {
    const [u, ...p] = m[2].split(":");
    username = safeDecode(u); password = safeDecode(p.join(":"));
    s = m[1] + (password ? "{user}:{pass}@" : "{user}@") + s.slice(m[0].length);
  }
  const qi = s.indexOf("?");
  if (qi >= 0) {
    const parts = s.slice(qi + 1).split("&").map((kv) => {
      const i = kv.indexOf("="); if (i < 0) return kv;
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (PASS_Q.test(k) && v && v !== "{pass}") { password = password || safeDecode(v); return `${k}={pass}`; }
      if (USER_Q.test(k) && v && v !== "{user}") { username = username || safeDecode(v); return `${k}={user}`; }
      return kv;
    });
    s = s.slice(0, qi + 1) + parts.join("&");
  }
  return { url: s, username, password };
}
function safeDecode(x) { try { return decodeURIComponent(x); } catch { return x; } }
// the real address for ffmpeg / fetch (in memory only)
export function fill(url, username = "", password = "") {
  const e = (x) => encodeURIComponent(String(x ?? ""));
  let s = String(url ?? "");
  // no user name at all: drop an empty "{user}:{pass}@"
  if (!username && !password) s = s.replace(/\{user\}(:\{pass\})?@/, "");
  return s.replace(/\{user\}/g, e(username)).replace(/\{pass\}/g, e(password));
}
// what may be shown or logged
export function redact(text) {
  return String(text ?? "")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s:]+):([^/@\s]*)@/gi, "$1$2:***@")
    .replace(/([?&](?:password|passwd|pwd|pass|pw)=)[^&\s"']*/gi, "$1***");
}
// Basic auth header value (only in memory)
export const basic = (u, p) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");
