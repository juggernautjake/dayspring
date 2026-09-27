// The app developer's PUBLIC key(s): Ed25519, SPKI DER, base64. Only public keys ever live here; the private key stays
// on the developer's own computer (DPAPI-encrypted in %LOCALAPPDATA%\Ecosystem\dev-key.bin) and is never in the repo,
// data/ or the export. A dev token (lib/dev/status.mjs) must be signed by one of these keys to count.
// scripts/dev/make-dev-token.mjs fills this in on its first run (and replaces it with --new-key).
export const DEV_PUBLIC_KEYS = [
  "MCowBQYDK2VwAyEAbWB39hax6BUBV5Wxj7ztjP1SQIehqNxm6Rm4Kb+XD28=",
];
