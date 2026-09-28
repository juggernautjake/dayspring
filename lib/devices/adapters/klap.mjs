// KLAP: the local protocol of TP-Link Tapo plugs and strips (P100, P110, P115, P300, P304M) and of newer Kasa hardware.
// Local only (HTTP on port 80), but the device checks your TP-Link account email and password (it keeps a copy from
// setup), so those are needed once; they're kept sealed (DPAPI) and never leave this computer.
//   version 2 (Tapo):  authHash = sha256(sha1(email) + sha1(password))
//   version 1 (Kasa):  authHash = md5(md5(email) + md5(password))
//   handshake1: POST /app/handshake1 with 16 random bytes → remote seed (16) + server hash (32); we check the hash
//   handshake2: POST /app/handshake2 with our proof → session cookie
//   request:    POST /app/request?seq=N, AES-128-CBC with a key and IV derived from both seeds, signed with SHA-256
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const H = (alg, ...parts) => createHash(alg).update(Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))))).digest();
export function authHash(username, password, version = 2) {
  if (version === 1) return H("md5", H("md5", username), H("md5", password));
  return H("sha256", H("sha1", username), H("sha1", password));
}
export const serverHashOf = (local, remote, auth, version = 2) => (version === 1 ? H("sha256", local, auth) : H("sha256", local, remote, auth));
export const clientProofOf = (local, remote, auth, version = 2) => (version === 1 ? H("sha256", remote, auth) : H("sha256", remote, local, auth));

// the session's cipher: key, IV (12 bytes + a 4-byte sequence number) and signature prefix
export function sessionCipher(local, remote, auth) {
  const key = H("sha256", "lsk", local, remote, auth).subarray(0, 16);
  const fullIv = H("sha256", "iv", local, remote, auth);
  const iv = fullIv.subarray(0, 12);
  let seq = fullIv.readInt32BE(28);
  const sig = H("sha256", "ldk", local, remote, auth).subarray(0, 28);
  const ivFor = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n, 0); return Buffer.concat([iv, b]); };
  const seqBuf = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n, 0); return b; };
  return {
    get seq() { return seq; },
    encrypt(text) {
      seq = seq >= 0x7fffffff ? -0x80000000 : seq + 1;
      const c = createCipheriv("aes-128-cbc", key, ivFor(seq));
      const ct = Buffer.concat([c.update(Buffer.from(text, "utf8")), c.final()]);
      return { seq, body: Buffer.concat([H("sha256", sig, seqBuf(seq), ct), ct]) };
    },
    decrypt(body, n = seq) {
      const d = createDecipheriv("aes-128-cbc", key, ivFor(n));
      return Buffer.concat([d.update(body.subarray(32)), d.final()]).toString("utf8");
    },
    // for a device (the simulator): read what a client sent
    open(body, n) {
      const ct = body.subarray(32);
      if (!H("sha256", sig, seqBuf(n), ct).equals(body.subarray(0, 32))) throw new Error("bad signature");
      const d = createDecipheriv("aes-128-cbc", key, ivFor(n));
      return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
    },
    seal(text, n) { const c = createCipheriv("aes-128-cbc", key, ivFor(n)); const ct = Buffer.concat([c.update(Buffer.from(text, "utf8")), c.final()]); return Buffer.concat([H("sha256", sig, seqBuf(n), ct), ct]); },
  };
}

// sessions are kept per device for a while (the device keeps them about a day)
const sessions = new Map();
async function post(url, body, cookie, timeoutMs = 5000) {
  const res = await fetch(url, { method: "POST", body, headers: { "content-type": "application/octet-stream", ...(cookie ? { cookie } : {}) }, signal: AbortSignal.timeout(timeoutMs) });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf, cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] || cookie };
}
async function handshake(host, { username, password, version = 2, port }) {
  const base = `http://${host}${port ? ":" + port : ""}/app`;
  const auth = authHash(username ?? "", password ?? "", version);
  const local = randomBytes(16);
  const h1 = await post(`${base}/handshake1`, local);
  if (h1.status !== 200 || h1.buf.length < 48) throw new Error(`The device at ${host} didn't accept the connection (step 1: ${h1.status}).`);
  const remote = h1.buf.subarray(0, 16), serverHash = h1.buf.subarray(16, 48);
  if (!serverHashOf(local, remote, auth, version).equals(serverHash)) throw Object.assign(new Error(`The device at ${host} didn't accept the TP-Link email and password. Use the same login as the ${version === 1 ? "Kasa" : "Tapo"} app.`), { code: "auth" });
  const h2 = await post(`${base}/handshake2`, clientProofOf(local, remote, auth, version), h1.cookie);
  if (h2.status !== 200) throw new Error(`The device at ${host} didn't finish the connection (step 2: ${h2.status}).`);
  const s = { base, cookie: h1.cookie, cipher: sessionCipher(local, remote, auth), at: Date.now() };
  return s;
}
export async function request(host, obj, opts = {}) {
  // one session per device and login (a changed password starts a new one)
  const key = `${host}:${opts.port ?? 80}:${opts.version ?? 2}:${H("sha256", `${opts.username ?? ""}|${opts.password ?? ""}`).toString("hex").slice(0, 16)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let s = sessions.get(key);
    if (!s || Date.now() - s.at > 20 * 3600_000) { s = await handshake(host, opts); sessions.set(key, s); }
    const { seq, body } = s.cipher.encrypt(JSON.stringify(obj));
    const r = await post(`${s.base}/request?seq=${seq}`, body, s.cookie);
    if (r.status === 403 || r.status === 401) { sessions.delete(key); continue; }   // the session ran out: once more
    if (r.status !== 200) throw new Error(`The device at ${host} answered ${r.status}.`);
    const j = JSON.parse(s.cipher.decrypt(r.buf, seq));
    if (j.error_code && j.error_code !== 0) { if (j.error_code === 9999 && attempt === 0) { sessions.delete(key); continue; } throw new Error(`The device at ${host} refused (error ${j.error_code}).`); }
    return j.result ?? j;
  }
  throw new Error(`Couldn't keep a connection to the device at ${host}.`);
}
export const _sessions = sessions;
