// Remote control: the device's private keys and its hub sign-in, on disk, protected with Windows DPAPI (the same
// per-Windows-user protection the shared AI key uses). A copy of these files on another computer, or read by another
// Windows user, can't be opened. Nothing here ever logs or returns a secret except to the engine that owns it.
//
//   createVault({ dir, box })  box: { protect(buf), unprotect(buf) }  (tests pass a stand-in; Dayspring passes dpapi())
//     .readJSON(name) · .writeJSON(name, value) · .remove(name) · .exists(name)
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MAGIC = Buffer.from("DSR1");
export function createVault({ dir, box }) {
  if (!dir || !box) throw new Error("createVault needs a folder and a protector");
  const file = (name) => join(dir, name + ".bin");
  return {
    exists: (name) => existsSync(file(name)),
    readJSON(name) {
      if (!existsSync(file(name))) return null;
      const raw = readFileSync(file(name));
      if (raw.length < 5 || !raw.subarray(0, 4).equals(MAGIC)) throw new Error("A remote-control key file isn't one Dayspring recognises.");
      return JSON.parse(box.unprotect(raw.subarray(4)).toString("utf8"));
    },
    writeJSON(name, value) {
      mkdirSync(dir, { recursive: true });
      const tmp = file(name) + ".tmp";
      writeFileSync(tmp, Buffer.concat([MAGIC, box.protect(Buffer.from(JSON.stringify(value), "utf8"))]), { mode: 0o600 });
      renameSync(tmp, file(name));
    },
    remove(name) { rmSync(file(name), { force: true }); },
  };
}
