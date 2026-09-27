// Encrypted files for what must never sit on disk in plain text: face fingerprints and thumbnails (biometric data), and
// saved text messages and calls. Windows DPAPI, this Windows user only: another user of the computer, or a copy of the
// file on another computer, can't read it. Written all-or-nothing (temp file, then rename), a few seconds after the last
// change, so a burst of changes is one write.
//   const s = secureFile(path, () => defaults);  await s.load() → the object;  s.changed();  await s.flush();  await s.wipe()
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as helper from "./helper.mjs";

const MAGIC = Buffer.from("DSP1");
let box = { protect: helper.protect, unprotect: helper.unprotect };
export function _setCrypto(c) { box = c ?? { protect: helper.protect, unprotect: helper.unprotect }; }   // tests only

export async function readSecure(file) {
  if (!existsSync(file)) return null;
  const raw = readFileSync(file);
  if (raw.length < 5 || !raw.subarray(0, 4).equals(MAGIC)) throw new Error("That file isn't one Dayspring wrote.");
  return JSON.parse((await box.unprotect(raw.subarray(4))).toString("utf8"));
}
export async function writeSecure(file, obj) {
  mkdirSync(dirname(file), { recursive: true });
  const enc = Buffer.concat([MAGIC, await box.protect(Buffer.from(JSON.stringify(obj), "utf8"))]);
  const tmp = file + ".tmp";
  writeFileSync(tmp, enc, { mode: 0o600 });
  renameSync(tmp, file);
}

export function secureFile(file, defaults, { delayMs = 4000 } = {}) {
  let data = null, loading = null, timer = null, writing = Promise.resolve(), dirty = false;
  const api = {
    file,
    async load() {
      if (data) return data;
      if (!loading) loading = (async () => { let d = null; try { d = await readSecure(file); } catch (e) { console.log(`people store: ${e.message}`); throw e; } data = { ...defaults(), ...(d ?? {}) }; return data; })().finally(() => { loading = null; });
      return loading;
    },
    get: () => data,
    changed() { dirty = true; clearTimeout(timer); timer = setTimeout(() => api.flush().catch((e) => console.log(`people store: ${e.message}`)), delayMs); timer.unref?.(); },
    async flush() {
      clearTimeout(timer);
      if (!dirty || !data) return writing;
      dirty = false;
      const snap = JSON.parse(JSON.stringify(data));
      writing = writing.then(() => writeSecure(file, snap));
      return writing;
    },
    async wipe() { clearTimeout(timer); dirty = false; await writing.catch(() => {}); data = defaults(); rmSync(file, { force: true }); rmSync(file + ".tmp", { force: true }); },
    _reset() { clearTimeout(timer); data = null; dirty = false; },
  };
  return api;
}
