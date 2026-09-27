// The QA guard: a test must never write to the owner's real Dayspring data (apps/desk/data), even by accident (a
// module imported in-process that saves to its default data file, a helper that forgets an override).
//   import "./guard-data.mjs";      ← the FIRST import of every QA script
// While it's loaded, every file write, rename, delete or new folder inside the real data folder is refused (the call
// throws EQAGUARD) and noted; when the script ends, any refused write is printed as a FAIL and the exit code is 1, so
// a write the code under test swallowed still fails the run. A copy of the app in the temp folder guards nothing (its
// data folder is the throwaway one the test is meant to use).
//   guardedData() → the protected folder (or null)      isRealData(path) → true for a path inside it
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DATA = resolve(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data"));
const inTemp = (p) => p.toLowerCase().startsWith(resolve(tmpdir()).toLowerCase() + sep);
const PROTECT = inTemp(DATA) ? null : DATA.toLowerCase();
const hits = [];

export const guardedData = () => (PROTECT ? DATA : null);
export function isRealData(p) {
  if (!PROTECT || p == null || typeof p === "number") return false;
  let s = p instanceof URL ? fileURLToPath(p) : Buffer.isBuffer(p) ? p.toString() : String(p);
  s = resolve(s).toLowerCase();
  return s === PROTECT || s.startsWith(PROTECT + sep);
}
const refuse = (name, p) => {
  const where = String(p instanceof URL ? fileURLToPath(p) : p);
  hits.push(`${name} ${where}`);
  const e = new Error(`QA guard: refusing ${name} in the real Dayspring data folder (${where}). Tests use a temp copy.`);
  e.code = "EQAGUARD";
  return e;
};
const WRITE_FLAGS = /[wa+]/;
const writes = (flags) => typeof flags === "number" ? (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_TRUNC)) !== 0 : WRITE_FLAGS.test(String(flags ?? "r"));

if (PROTECT && !globalThis.__dayspringQaGuard) {
  globalThis.__dayspringQaGuard = true;
  // [function name, which arguments are paths]
  const PATH_FNS = [["writeFile", [0]], ["appendFile", [0]], ["mkdir", [0]], ["rename", [0, 1]], ["rm", [0]], ["rmdir", [0]], ["unlink", [0]],
    ["copyFile", [1]], ["cp", [1]], ["utimes", [0]], ["truncate", [0]], ["symlink", [1]], ["link", [1]], ["chmod", [0]], ["mkdtemp", [0]]];
  const wrap = (obj, name, idx, kind) => {
    const orig = obj[name]; if (typeof orig !== "function") return;
    obj[name] = function (...a) {
      // (making a folder that's already there changes nothing: modules do that when they're loaded)
      if (name.startsWith("mkdir") && name !== "mkdtemp" && isRealData(a[0]) && fs.existsSync(a[0]) && fs.statSync(a[0]).isDirectory()) return kind === "promise" ? Promise.resolve(undefined) : kind === "cb" ? void process.nextTick(a.findLast((x) => typeof x === "function") ?? (() => {}), null) : undefined;
      const bad = idx.find((i) => isRealData(a[i]));
      if (bad !== undefined) {
        const e = refuse(name, a[bad]);
        if (kind === "sync") throw e;
        if (kind === "promise") return Promise.reject(e);
        const cb = a.findLast((x) => typeof x === "function"); if (cb) return void process.nextTick(cb, e); throw e;
      }
      return orig.apply(this, a);
    };
  };
  for (const [n, idx] of PATH_FNS) { wrap(fs, n + "Sync", idx, "sync"); wrap(fs, n, idx, "cb"); wrap(fs.promises, n, idx, "promise"); }
  const openGuard = (obj, name, kind) => {
    const orig = obj[name];
    obj[name] = function (p, flags, ...rest) {
      if (writes(flags) && isRealData(p)) { const e = refuse(name, p); if (kind === "sync") throw e; if (kind === "promise") return Promise.reject(e); const cb = [flags, ...rest].findLast((x) => typeof x === "function"); if (cb) return void process.nextTick(cb, e); throw e; }
      return orig.call(this, p, flags, ...rest);
    };
  };
  openGuard(fs, "openSync", "sync"); openGuard(fs, "open", "cb"); openGuard(fs.promises, "open", "promise");
  const cws = fs.createWriteStream;
  fs.createWriteStream = function (p, ...rest) { if (isRealData(p)) throw refuse("createWriteStream", p); return cws.call(this, p, ...rest); };
  syncBuiltinESMExports();
  process.on("exit", () => {
    if (!hits.length) return;
    console.log(`FAIL  QA guard: ${hits.length} write(s) to the real Dayspring data folder were refused:`);
    for (const h of [...new Set(hits)].slice(0, 10)) console.log("        " + h);
    process.exitCode = 1;
  });
}
