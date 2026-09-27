// Makes THIS computer a Dayspring developer computer (the developer preview: docs/dev-preview.md).
//   node scripts/dev/make-dev-token.mjs              first run: creates the developer key (kept only here, DPAPI-encrypted in
//                                                    %LOCALAPPDATA%\Ecosystem\dev-key.bin) and puts its PUBLIC half in
//                                                    lib/dev/public-key.mjs; then signs a token for this computer
//                                                    (%LOCALAPPDATA%\Dayspring\dev-token.json)
//   node scripts/dev/make-dev-token.mjs --status     is this a developer computer, and why (not)
//   node scripts/dev/make-dev-token.mjs --remove     deletes this computer's token (the preview goes away; nothing else changes)
//   node scripts/dev/make-dev-token.mjs --revoke     deletes it AND lists its id in lib/dev/revoked.mjs, so a copy of it
//                                                    never counts again, anywhere (once that version of the code runs)
//   node scripts/dev/make-dev-token.mjs --revoke-id <id>   revokes a token by id (a lost computer's)
//   node scripts/dev/make-dev-token.mjs --new-key    replaces the developer key (every old token stops counting)
// Only the developer's computer holds the private key: on any other computer the script refuses to sign (it has no key
// that matches the public key in the code). Restart Dayspring after the first run (it reads the public key at startup).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createKey, hasKey, keyFile, loadKey, publicB64, signToken } from "./keystore.mjs";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PUB_FILE = join(DESK, "lib", "dev", "public-key.mjs"), REV_FILE = join(DESK, "lib", "dev", "revoked.mjs");
const args = process.argv.slice(2), has = (f) => args.includes(f);
const S = await import(pathToFileURL(join(DESK, "lib", "dev", "status.mjs")).href);
const embedded = () => [...readFileSync(PUB_FILE, "utf8").matchAll(/"([A-Za-z0-9+/=]{40,})"/g)].map((m) => m[1]);
const readToken = () => { try { return JSON.parse(readFileSync(S.tokenPath(), "utf8")); } catch { return null; } };
// rewrite one of the two small list files in lib/dev
function writeList(file, name, items) {
  const src = readFileSync(file, "utf8");
  const body = items.map((x) => `  ${JSON.stringify(x)},\n`).join("");
  const out = src.replace(new RegExp(`(export const ${name} = \\[)[\\s\\S]*?(\\];)`), `$1\n${body}$2`);
  if (out === src && items.length) throw new Error(`Couldn't update ${file}.`);
  writeFileSync(file, out);
}
function report() {
  S._clear();
  const st = S.status();
  const why = { missing: "no dev token on this computer", malformed: "the token file is damaged", purpose: "that isn't a Dayspring dev token", machine: "the token was made for a different computer",
    revoked: "the token has been revoked", "no-key": "no developer public key in lib/dev/public-key.mjs yet", signature: "the token isn't signed by the developer key" };
  console.log(st.dev ? `Developer computer: yes (token ${st.id}, issued ${st.issued}). Restart Dayspring if it was running.` : `Developer computer: no (${why[st.reason] ?? st.reason}).`);
  console.log(`  token: ${S.tokenPath()}\n  key:   ${hasKey() ? keyFile() : "(none on this computer)"}`);
  return st.dev;
}

if (has("--status")) process.exit(report() ? 0 : 1);

if (has("--remove") || has("--revoke")) {
  const tok = readToken();
  if (has("--revoke") && tok?.payload?.id) {
    const { REVOKED_TOKEN_IDS } = await import(pathToFileURL(REV_FILE).href);
    writeList(REV_FILE, "REVOKED_TOKEN_IDS", [...new Set([...REVOKED_TOKEN_IDS, String(tok.payload.id)])]);
    console.log(`Revoked token ${tok.payload.id} (lib/dev/revoked.mjs).`);
  }
  rmSync(S.tokenPath(), { force: true });
  console.log("Removed this computer's dev token.");
  report();
  process.exit(0);
}
const ri = args.indexOf("--revoke-id");
if (ri >= 0) {
  const id = String(args[ri + 1] ?? "").trim(); if (!id) { console.error("Which token id?"); process.exit(2); }
  const { REVOKED_TOKEN_IDS } = await import(pathToFileURL(REV_FILE).href);
  writeList(REV_FILE, "REVOKED_TOKEN_IDS", [...new Set([...REVOKED_TOKEN_IDS, id])]);
  console.log(`Revoked token ${id}.`);
  process.exit(0);
}

// ---- make (or refresh) this computer's token ------------------------------------------------------------------------
let key = hasKey() && !has("--new-key") ? loadKey() : null;
if (has("--new-key") && hasKey()) { rmSync(keyFile(), { force: true }); console.log("Replaced the developer key: every older token stops counting."); }
const pubs = embedded();
if (!key) {
  if (pubs.length && !has("--new-key")) {
    console.error("This computer doesn't hold the developer key, so it can't make a dev token. (Only the developer's computer can.)");
    process.exit(1);
  }
  key = createKey();
  console.log(`Created the developer key (only on this computer, encrypted): ${keyFile()}`);
}
const mine = publicB64(key);
if (!pubs.includes(mine)) {
  if (pubs.length && !has("--new-key")) { console.error("The developer key on this computer doesn't match the public key in lib/dev/public-key.mjs. Use --new-key to replace it."); process.exit(1); }
  writeList(PUB_FILE, "DEV_PUBLIC_KEYS", [mine]);
  console.log("Put the developer PUBLIC key in lib/dev/public-key.mjs.");
}
const tok = signToken(key, { machine: S.machineId() });
mkdirSync(dirname(S.tokenPath()), { recursive: true });
writeFileSync(S.tokenPath(), JSON.stringify(tok, null, 2));
console.log(`Signed a dev token for this computer: ${S.tokenPath()}`);
// the check uses the public key as it is in the file now (a fresh import, in case it was just written)
const fresh = await import(pathToFileURL(PUB_FILE).href + `?t=${Date.now()}`);
const v = S.verifyToken(tok, { keys: fresh.DEV_PUBLIC_KEYS });
console.log(v.ok ? "Verified: this is a developer computer. Restart Dayspring to see the developer preview." : `The new token didn't verify (${v.reason}).`);
if (!existsSync(S.tokenPath()) || !v.ok) process.exit(1);
