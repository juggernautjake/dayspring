// Loaded before server.mjs by scripts/qa/social-flag.mjs (node --import). Records, to SOCIAL_PROBE_LOG:
//   load          every module loaded from a lib/social folder (Dayspring's or ecosystem-core's)
//   keygen        every key pair generated in this process (with the calling stack)
//   social-fetch  every request to a social-server endpoint (/v1/register|directory|push|pull|audit)
// It changes nothing about how Dayspring runs. Test copies only; never loaded by a real install.
import { register, syncBuiltinESMExports } from "node:module";
import { appendFileSync } from "node:fs";
import crypto from "node:crypto";

const LOG = process.env.SOCIAL_PROBE_LOG;
const rec = (o) => { try { appendFileSync(LOG, JSON.stringify(o) + "\n"); } catch { /* no log */ } };

for (const fn of ["generateKeyPairSync", "generateKeyPair"]) {
  const orig = crypto[fn];
  crypto[fn] = function (type, ...rest) { rec({ ev: "keygen", type: String(type), stack: String(new Error().stack).split("\n").slice(2, 7).join(" | ") }); return orig.call(this, type, ...rest); };
}
syncBuiltinESMExports();

const origFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const u = String(input?.url ?? input);
  if (/\/v1\/(register|directory|push|pull|audit)\b/.test(u)) rec({ ev: "social-fetch", url: u });
  return origFetch.call(this, input, init);
};

const hook = `import { appendFileSync } from "node:fs";
let LOG = null;
export async function initialize(d) { LOG = d.log; }
export async function resolve(spec, ctx, next) {
  const r = await next(spec, ctx);
  if (LOG && /\\/lib\\/social\\//.test(r.url)) { try { appendFileSync(LOG, JSON.stringify({ ev: "load", url: r.url }) + "\\n"); } catch {} }
  return r;
}`;
register("data:text/javascript," + encodeURIComponent(hook), import.meta.url, { data: { log: LOG } });
rec({ ev: "probe", pid: process.pid });
