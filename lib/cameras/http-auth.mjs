// Fetching from a camera on the home network: Basic or Digest sign-in (most IP cameras use Digest, RFC 7616 / 2617 with
// MD5 and qop=auth), a time limit and a size limit. The owner typed the address himself, so home-network addresses are
// allowed here (unlike pictures from the web). Passwords are only in memory, and errors never include them.
//   camFetch(url, { username, password, method, body, headers, timeoutMs, maxBytes, stream }) → { status, type, buf | res }
import { createHash, randomBytes } from "node:crypto";
import { basic, redact } from "./secret.mjs";

const md5 = (s) => createHash("md5").update(s).digest("hex");
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
export function parseChallenge(h) {
  const m = /^\s*Digest\s+(.*)$/i.exec(String(h ?? ""));
  if (!m) return null;
  const out = {};
  for (const p of m[1].matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) out[p[1].toLowerCase()] = p[2] ?? p[3];
  return out;
}
let nc = 0;
export function digestHeader(ch, { method, uri, username, password }) {
  const algo = String(ch.algorithm ?? "MD5").toUpperCase();
  const H = /SHA-256/.test(algo) ? sha256 : md5;
  const cnonce = randomBytes(8).toString("hex");
  const n = (++nc).toString(16).padStart(8, "0");
  let ha1 = H(`${username}:${ch.realm}:${password}`);
  if (/-SESS$/.test(algo)) ha1 = H(`${ha1}:${ch.nonce}:${cnonce}`);
  const qop = ch.qop ? (String(ch.qop).split(",").map((s) => s.trim()).includes("auth") ? "auth" : null) : null;
  const ha2 = H(`${method}:${uri}`);
  const response = qop ? H(`${ha1}:${ch.nonce}:${n}:${cnonce}:${qop}:${ha2}`) : H(`${ha1}:${ch.nonce}:${ha2}`);
  const parts = [`username="${username}"`, `realm="${ch.realm}"`, `nonce="${ch.nonce}"`, `uri="${uri}"`, `response="${response}"`, `algorithm=${ch.algorithm ?? "MD5"}`];
  if (ch.opaque) parts.push(`opaque="${ch.opaque}"`);
  if (qop) parts.push(`qop=${qop}`, `nc=${n}`, `cnonce="${cnonce}"`);
  return "Digest " + parts.join(", ");
}

async function readCapped(res, maxBytes) {
  const chunks = []; let size = 0;
  for await (const c of res.body ?? []) { size += c.length; if (size > maxBytes) throw new Error("The camera sent more than expected."); chunks.push(Buffer.from(c)); }
  return Buffer.concat(chunks);
}
export async function camFetch(url, { username = "", password = "", method = "GET", body, headers = {}, timeoutMs = 15_000, maxBytes = 20e6, stream = false, signal = null } = {}) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error("Camera addresses start with http:// or https://.");
  const uri = u.pathname + u.search;
  const sig = () => (signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs));
  const go = (auth) => fetch(u, { method, body, headers: { ...headers, ...(auth ? { authorization: auth } : {}) }, signal: stream ? signal ?? undefined : sig(), redirect: "follow" });
  let res;
  try {
    // no password on the first try: the camera says which sign-in it wants (a Digest camera never sees it in plain text)
    res = await go(null);
    if (res.status === 401 && (username || password)) {
      const wa = res.headers.get("www-authenticate") ?? "";
      const ch = parseChallenge(wa);
      await res.body?.cancel().catch(() => {});
      res = await go(ch ? digestHeader(ch, { method, uri, username, password }) : basic(username, password));
    }
  } catch (e) {
    const msg = /abort|timeout/i.test(e.name + e.message) ? "The camera took too long to answer." : /ECONNREFUSED/.test(e.cause?.code ?? e.message) ? "The camera refused the connection (wrong address or port?)." : "Couldn't reach the camera. Check its address and that it's on the same network.";
    throw Object.assign(new Error(msg), { detail: redact(String(e.cause?.code ?? e.message)) });
  }
  if (res.status === 401 || res.status === 403) { await res.body?.cancel().catch(() => {}); throw Object.assign(new Error("The camera didn't accept the user name or password."), { status: res.status }); }
  if (!res.ok) { await res.body?.cancel().catch(() => {}); throw Object.assign(new Error(`The camera answered ${res.status}. Check the address.`), { status: res.status }); }
  const type = res.headers.get("content-type") ?? "";
  if (stream) return { status: res.status, type, res };
  return { status: res.status, type, buf: await readCapped(res, maxBytes) };
}
