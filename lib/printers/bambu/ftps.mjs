// Files to and from a Bambu printer's storage (SD card / internal storage): implicit FTPS on port 990, user "bblp",
// password = the access code. The printer's certificate is its own (self-signed by Bambu), so it isn't checked against
// the public certificate authorities; the connection is still encrypted, and it only ever goes to the address the owner
// typed. basic-ftp reuses the TLS session for data connections, which Bambu's server requires.
import { Client } from "basic-ftp";
import { basename } from "node:path";

async function withClient({ host, port = 990, accessCode, timeoutMs = 30_000 }, fn) {
  const c = new Client(timeoutMs);
  try {
    await c.access({ host, port, user: "bblp", password: accessCode, secure: "implicit", secureOptions: { rejectUnauthorized: false } });
    return await fn(c);
  } catch (e) {
    if (/530|Login|authentication/i.test(e.message)) throw Object.assign(new Error("The printer didn't accept the access code for file transfer. Check it on the printer's screen (it changes when LAN mode is turned off and on)."), { code: "auth" });
    if (/ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|timeout/i.test(e.message)) throw Object.assign(new Error(`Couldn't reach the printer's storage at ${host}. Is it on, and is LAN mode (with Developer mode) turned on?`), { code: "unreachable" });
    throw e;
  } finally { c.close(); }
}
// upload(localPath, { name }) → the name on the printer
export async function upload(conn, localPath, { name, onProgress } = {}) {
  const remote = String(name || basename(localPath)).replace(/[\\/:*?"<>|]+/g, "_");
  await withClient(conn, async (c) => {
    if (onProgress) c.trackProgress((i) => onProgress(i.bytesOverall));
    await c.uploadFrom(localPath, `/${remote}`);
    c.trackProgress();
  });
  return remote;
}
export const list = (conn, dir = "/") => withClient(conn, async (c) => (await c.list(dir)).map((f) => ({ name: f.name, size: f.size, dir: f.isDirectory, modified: f.modifiedAt ?? null })));
export const remove = (conn, name) => withClient(conn, (c) => c.remove(`/${String(name).replace(/^\/+/, "")}`));
export const size = (conn, name) => withClient(conn, (c) => c.size(`/${String(name).replace(/^\/+/, "")}`));
