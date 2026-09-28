# Remote control: the protocol

How the owner's Dayspring devices find, trust and command each other through the hub. This is the contract a new client must follow, for example the future phone app (a native app or a PWA). The desktop implementation is `lib/remote/` (`envelope.mjs` for the crypto, `engine.mjs` for the flow, `hub.mjs` for the hub API). The hub side is [`remote-hub.sql`](remote-hub.sql). The threat model is [Remote control: security](remote-security.md).

**The rule that shapes everything:** the hub is a mailbox, not a judge. Every decision (who is one of the owner's devices, what it may do, whether a command is genuine and fresh) is made by the receiving device, from signed statements it checks itself. The hub's own checks (row level security, session binding, rate limits) are a second fence, not the first.

## Contents

- [Identities and keys](#identities-and-keys)
- [Canonical JSON and signatures](#canonical-json-and-signatures)
- [Sealing (end-to-end encryption)](#sealing-end-to-end-encryption)
- [The hub API](#the-hub-api)
- [Signing in and registering](#signing-in-and-registering)
- [Statements about devices](#statements-about-devices)
- [Pairing](#pairing)
- [Trust](#trust)
- [Envelopes](#envelopes)
- [Actions, permissions and answers](#actions-permissions-and-answers)
- [Pictures and clips](#pictures-and-clips)
- [Timing and limits](#timing-and-limits)
- [Notes for a phone client](#notes-for-a-phone-client)

## Identities and keys

Each install is a **device**, with its own keys, made the first time the owner signs in on it:

| | |
|---|---|
| device id | `dev_` + 20 lowercase hex characters (10 random bytes) |
| signing key | Ed25519. The public key goes on the hub as SPKI DER, base64 (`sign_pub`). |
| encryption key | X25519. The public key goes on the hub as SPKI DER, base64 (`enc_pub`). |
| client | `desk`, `phone` or `web` |

Private keys never leave the device. The desktop keeps them in `data/remote/device-key.bin`, protected with Windows DPAPI for the current Windows user. A phone would use the Keychain (iOS) or the Keystore (Android). A browser would use a non-extractable WebCrypto key in IndexedDB. The **fingerprint** shown in Settings is SHA-256 of the signing key's DER bytes: the first 32 hex characters, in groups of 4.

## Canonical JSON and signatures

- **Canonical JSON:** objects with their keys sorted (by UTF-16 code unit, as JavaScript's `sort()` does), keys whose value is `undefined` left out, no whitespace, and every string and number written as `JSON.stringify` writes it. Arrays keep their order.
- **Signing an object:** remove its `sig` field, take the canonical JSON as UTF-8, sign that with Ed25519, and add `sig: { deviceId, value }`, where `value` is the base64 signature.
- **Verifying:** the same bytes, checked with the signing key the verifier *already trusts* for `sig.deviceId`. Never check against a key that came with the object itself (the one exception is a pairing offer; see [Pairing](#pairing)).

## Sealing (end-to-end encryption)

This is ecosystem-core's scheme (`vendor/ecosystem-core/lib/social/crypto.mjs`), used with its own domain prefix:

1. Make a fresh random 32-byte **content key**. Encrypt the payload with AES-256-GCM, a 12-byte random IV, and AAD = `"ds-social/v1|ds-remote/1|" + aad`. The result is `box = { v: 1, iv, ct, tag }` (all base64).
2. For each recipient device, **wrap** the content key. The key id is `kid = "<userId>/<deviceId>"`.
   - Make an ephemeral X25519 key pair and do ECDH with the recipient's `enc_pub`.
   - Derive `kek = HKDF-SHA256(ikm = shared secret, salt = epk DER ‖ recipient enc_pub DER, info = "ds-social wrap v1|" + kid, length 32)`.
   - Encrypt the content key with AES-256-GCM under `kek`, with AAD `"wrap|" + kid`.
   - The result is `{ v: 1, alg: "x25519-hkdf-aes256gcm", epk, iv, ct, tag }`, where `epk` is the ephemeral public key (SPKI DER, base64).
3. The sealed value is `{ box, keys: { [kid]: wrapped } }`.

The `aad` strings used are:

| For | `aad` |
|---|---|
| an envelope | `env\|<id>\|<kind>\|<user>\|<from>\|<to>\|<ts>\|<exp>\|<replyTo or "">\|<seq>\|<nonce>` |
| a pairing approval | `bundle\|<pairingId>\|<newDeviceId>` |
| a device profile | `profile\|<deviceId>` |

Because the AAD carries every header field, moving a payload into another envelope makes decryption fail.

## The hub API

The hub is the Lantern account's Supabase project. Use plain HTTPS with the **public** key in the `apikey` header, and the signed-in user's JWT as `Authorization: Bearer …`. Never use a secret or service-role key.

- **Auth:** `POST /auth/v1/token?grant_type=password`, `?grant_type=refresh_token`, `POST /auth/v1/otp` with `create_user: false` (an emailed link; never make accounts), and `POST /auth/v1/logout`.
- **Reads:** `GET /rest/v1/dayspring_remote_devices?select=*` and `GET /rest/v1/dayspring_remote_pairings?…`. Row level security returns only the signed-in person's rows.
- **Writes:** only through `POST /rest/v1/rpc/<function>`. Tables can't be written directly.

| Function | Who may call it | What it does |
|---|---|---|
| `dayspring_remote_register(p_id, p_name, p_platform, p_version, p_client, p_sign_pub, p_enc_pub, p_root_cert)` | any signed-in session | Creates or returns this device, and binds this session to it. → `{ id, status, first }` |
| `dayspring_remote_heartbeat(p_device, p_version)` | the device | Updates `last_seen`. → `{ status: approved \| pending \| revoked \| unbound }` |
| `dayspring_remote_pair_open(p_device)` | a pending device | Starts a pairing request (10 minutes). → the pairing row |
| `dayspring_remote_pair_offer(p_pairing, p_device, p_offer)` | an approved device | Answers a request with its signed offer. The first answer wins. |
| `dayspring_remote_pair_approve(p_pairing, p_device, p_cert, p_grant, p_approval)` | the device that answered | Approves the new device. |
| `dayspring_remote_pair_cancel(p_pairing)` / `…_pair_reject(p_pairing)` | the new device / an approved device | Cancels or turns down a request. |
| `dayspring_remote_rename(p_device, p_name)` | itself, or an approved device | Renames a device. |
| `dayspring_remote_set_grant(p_device, p_grant)` | an approved device | Stores a signed permissions grant. |
| `dayspring_remote_set_profile(p_device, p_profile)` | the device | Stores its sealed profile. |
| `dayspring_remote_revoke(p_device, p_revocation)` | itself, or an approved device | Signs a device out for good, and ends its hub session. |
| `dayspring_remote_forget(p_device)` | an approved device | Removes a signed-out device from the list. |
| `dayspring_remote_send(p_id, p_from, p_to, p_kind, p_reply_to, p_seq, p_ttl_seconds, p_envelope)` | an approved device, as itself | Queues one envelope (5 minutes at most; pieces 2). |
| `dayspring_remote_inbox(p_device)` | the device | Returns what's waiting for it, oldest first, up to 200. |
| `dayspring_remote_ack(p_device, p_ids)` | the device | Deletes what it picked up. |

"As itself" means the hub checks that the caller's session is the one bound to `p_device` (`auth.jwt() ->> 'session_id'`). So each device must have its **own** sign-in; don't share a refresh token between apps or devices.

**Live updates:** Realtime `postgres_changes` on `dayspring_remote_messages` (`INSERT`, filter `to_device=eq.<id>`), `dayspring_remote_devices` (filter `user_id=eq.<uid>`) and `dayspring_remote_pairings` (the same filter). Treat an event only as a doorbell: fetch and check through the functions above. Without live updates, poll `inbox` (every 15 seconds; every 60 when live; back off to 5 minutes when the hub can't be reached).

## Signing in and registering

1. Sign in, and keep the session somewhere safe on the device.
2. Make the keys (only now, never before) and call `register`. For `p_root_cert`, send a self-signed `root` statement (below). The hub keeps it only if this is the account's first device.
3. If the result is `first: true` and `status: "approved"`, this device is the account's first. It trusts only itself, and grants itself every permission (a self-signed grant).
4. If the result is `status: "pending"`, open a pairing request.
5. If the result is `status: "revoked"`, delete the keys. Signing in again makes a new device.

## Statements about devices

Every statement is signed (see [Canonical JSON and signatures](#canonical-json-and-signatures)). Each `t` value starts with `ds-remote/1/`.

| `t` | Fields | Signed by |
|---|---|---|
| `…/root` | `user, device, signPub, encPub, name, by (= device), at` | the device itself (the account's first device only) |
| `…/approve` | the same fields, with `by` = the approver | an approved device |
| `…/grant` | `user, device, perms: [sorted], by, at` | an approved device other than `device` (see below) |
| `…/revoke` | `user, device, by, at, reason` | an approved device, or the device itself |
| `…/offer` | `user, pairing, approver, signPub, encPub, at` | the approver |
| `…/bundle` | `user, pairing, device, by, at, sealed` (sealed: `{ cert, grant, trust }`) | the approver |
| `…/profile` | `user, device, at, sealed` (sealed to every approved device: `{ names: { kind: [..] }, kinds, name, at }`) | the device |

`at` is milliseconds since 1970, in hub time (see [Timing and limits](#timing-and-limits)).

## Pairing

The goal is that both the new device (N) and the approving device (A) end up sure of each other's keys, even if the hub is lying.

1. N registers (it's `pending`) and calls `pair_open`.
2. A lists open requests, and the owner presses **Review**. A signs an **offer** with its own keys and calls `pair_offer`.
3. Both compute the code from the same inputs:
   `SHA-256("ds-remote pairing v1|" + pairingId + "|" + offer.signPub + "|" + offer.encPub + "|" + N.signPub + "|" + N.encPub)`.
   Take the first 4 bytes as an unsigned 32-bit big-endian integer, modulo 1,000,000, padded to 6 digits and shown as `123 456`.
   - N reads the offer from the pairing row. It checks that the offer is signed by the key inside it and that `offer.approver` is the row's `approver_id`.
   - A reads N's keys from N's device row.
4. The owner compares the two screens.
   - On N he presses **The codes match**. N remembers `offer.sig.value`.
   - On A he chooses the permissions and presses **Approve**. A signs an `approve` certificate and a `grant` for N's keys, and adds them to its own trust. It seals a **bundle** `{ cert, grant, trust }` to N (with A's whole trust list) and calls `pair_approve`.
5. N accepts the bundle only if all of these hold:
   - the owner confirmed the code for exactly that offer;
   - the bundle and its certificate are signed by the offer's key;
   - the certificate names N's own keys;
   - A's entry in the bundle has the same keys as the offer.

   N then trusts A's list, plus itself.

If a second device answers first, A's `review` fails ("another device already answered"). If the hub swaps the offer, N's code doesn't match A's. A "No" on N cancels the request, and N starts a new one.

## Trust

Each device keeps its own list: `devices` (id → keys, name, who approved it, the certificate), `revoked` (id → revocation) and `grants` (id → the latest grant). It updates the list from the device rows, repeating until nothing changes:

- **Adding a device:** a row whose `approve` certificate is signed by a device already trusted (not revoked, and not the row's own device), for exactly that row's keys and user, is added.
- **Revoking a device:** a `revoke` statement signed by a trusted device, or by the device itself, is permanent. From then on the device's signatures are refused.
- **Grants:** a grant signed by a trusted device replaces an older one (compared by `at`). A device can't grant itself anything, except the first device's own starting grant, and only while no other device has set one.
- **Keys that change:** a row whose keys differ from the trusted record is shown as "keys changed" and ignored.

The hub's own `status` column is only a hint (it gates the hub's functions). It's never proof.

## Envelopes

```
{ v: 1, p: "ds-remote/1", id: <uuid>, kind: "cmd" | "resp" | "chunk", user, from, to,
  ts, exp, nonce: <16 random bytes, base64>, replyTo: <uuid or null>, seq: <0..999>,
  sealed: { box, keys: { "<user>/<to>": wrapped } }, sig: { deviceId: from, value } }
```

The receiver refuses an envelope, **without answering**, when any of these is true:

- the hub row's `id`, `from_device`, `to_device` or `kind` differ from the envelope's;
- `to` isn't this device, or `user` isn't this account;
- `from` isn't trusted, or is revoked;
- the signature doesn't verify with `from`'s trusted key;
- `ts` is more than 60 seconds in the future;
- `ts` is more than 5 minutes (+60 seconds) old;
- `exp` has passed (allowing 60 seconds of clock difference);
- `exp - ts` is more than 5 minutes;
- the nonce is missing;
- the `id` was seen before (the device remembers ids until they expire, across restarts);
- the payload doesn't decrypt.

Every refusal goes in the receiver's activity log.

## Actions, permissions and answers

A command's payload is `{ action, args, confirmed: { at } | null, blob: <manifest> | null }`. The answer (`kind: "resp"`, `replyTo` = the command's id) is `{ ok, say, result?, needsConfirm?, denied?, unsupported?, blob? }`.

| action | args | permission |
|---|---|---|
| `ping` | none | none (any trusted device) |
| `status` | none | `status` |
| `schedule` | none | `schedule` |
| `announce` | `{ text }` | `announce` |
| `remind` | `{ text, time: "HH:MM", date? }` | `announce` |
| `notify` | `{ title, body }`, with an optional picture blob | `announce` |
| `devices` | `{ command }` or `{ answer: "yes" }` | `control` |
| `printers.status` | `{ printer }` | `status` |
| `printers.camera` | `{ printer }`, and the answer has a picture blob | `camera` |
| `printers.start` | `{ printer, job }` | `print` (always risky) |
| `cameras.list` | none | `status` |
| `cameras.snapshot` | `{ camera }`, and the answer has a picture blob | `camera` |
| `cameras.clip` | `{ camera, seconds }`, and the answer has a video blob | `camera` |

**Risky commands** are listed in `lib/remote/policy.mjs` (`isRisky`): power to a computer, printer or heat source, unlocking, shutting down or restarting, and starting a print.

1. The **sending** device asks the owner, and sets `confirmed` only after his own yes, said on that device.
2. The receiver refuses a risky command that isn't confirmed, with `needsConfirm: true`.
3. A receiver's device layer can also ask its own question. That comes back as `needsConfirm` with its words in `say`. The sender asks the owner, then sends the same command again with `confirmed`, and the receiver gives the yes to its device layer.

## Pictures and clips

Bytes travel as `chunk` envelopes: `seq` 0…n-1, up to 60 KB of raw bytes each (the sealed payload *is* the raw bytes), and `replyTo` = the id of the command they belong to. They're sent **before** the envelope that describes them: `blob: { n, size, sha256, contentType }`.

The receiver puts the pieces together, then checks the size and the SHA-256. A still can be up to 2 MB, and a clip up to 8 MB. Pieces live 2 minutes on the hub.

The "live" view is a new still every 3 seconds, for 2 minutes at most.

## Timing and limits

- Use **hub time**: the hub's `Date` header, smoothed, minus local time, added to local time.
- A command waiting for an answer lives 60 seconds (`p_ttl_seconds: 60`). Queued things (notifications, announcements) live up to 5 minutes.
- The sender waits 20 seconds for an answer (45 for a picture), then says so. It **never retries** on its own.
- Online means the device's `last_seen` is under 150 seconds old. The heartbeat is every 60 seconds. The sender doesn't send to an offline device (queued notifications excepted).
- **Hub limits:** 600 messages a minute per account, 1000 waiting for one device, 20 devices per account, 10 pairing requests an hour, envelopes up to 96 KB.
- **Receiver limit:** 60 commands a minute from one device.

## Notes for a phone client

- **Register with `client: "phone"`.** A phone is usually a sender only: it can offer no actions (an empty profile) and still send all of the above. Everything works the same way.
- **Pairing.** A phone can be the new device (it shows the code; the owner approves on a computer). Once approved, it can also approve others.
- **Keys.** Keep the private keys in the platform's secure storage, never in plain files or synced backups. The keys and the session must not leave the phone.
- **Background.** There's no push yet. Use Realtime while the app is open, and poll the inbox when it comes to the front. Answers to a phone's commands wait up to 2 minutes; notifications to a phone expire after 5 minutes if it doesn't look. Push notifications (a wake-up with no content) would be a later addition to the hub.
- **Confirmations.** A phone must ask the owner itself before it sets `confirmed`, with its own on-screen yes. Never set it automatically.
- **Showing pictures.** Decrypt in memory, show them, and don't keep them longer than the view is open.
