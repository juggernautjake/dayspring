# Remote control: security

A security review of remote control between the owner's Dayspring devices ([the user guide](../multiple-devices.md), [the protocol](remote-protocol.md), [the hub SQL](remote-hub.sql)). It covers what we protect, from whom, how, and what's left over.

## What we protect

- **The owner's home.** Remote commands can switch outlets and computers, start 3D prints and show cameras. A forged or replayed command could do real harm: a heater left on, a print started on a dirty bed, a camera watched by a stranger.
- **Privacy.** What he asks, what his cameras see, and what his devices can control are his business, not the hub's.
- **Availability.** Nothing about remote control may make Dayspring worse at home. With no internet, the hub down or the feature off, the computer in front of him works exactly as before.

## Who is involved

| Who | Trusted with |
|---|---|
| **The owner** | Everything. He approves devices by comparing a code, and says yes to risky things. |
| **An approved device** | Only the permissions it was granted. Each device checks every request itself. |
| **The hub** (Supabase) | Passing messages along, and keeping each account's rows apart. **Not** trusted to say who is who, or what's genuine. |
| **Anyone on the internet** | Nothing. They have the public hub key, because it ships with Dayspring. |

## The defences

1. **A key per device.** Each device has its own Ed25519 signing key and X25519 encryption key, made on the device and stored with Windows DPAPI for that Windows user. Only the public keys go to the hub.
2. **Approval by code.** A new device joins only when the owner compares a 6-digit code on both screens. The code is derived from both devices' keys and the request, and he presses **Approve** on a device he already has. The approval is a certificate signed by that device.
3. **Everything signed.** Commands, answers, pieces of pictures, permission grants, sign-outs and profiles are signed. Receivers check them against keys they already trust, never against keys that arrive with the message.
4. **Everything sealed.** Payloads are encrypted end to end: AES-256-GCM, with the key wrapped per recipient by X25519 + HKDF. Every header field is bound in as AAD.
5. **Fresh and once only.** Each message has a timestamp, an expiry of 5 minutes at most, a random nonce and a unique id. Receivers refuse old, future-dated, too-long-lived and already-seen messages. The ids they've seen are kept across restarts.
6. **Permissions checked by the receiver.** Each grant is signed by another approved device. A device can't widen its own.
7. **Risky things confirmed on the sender.** The owner says yes on the device he's using, never on a call. The receiver refuses a risky command that doesn't say it was confirmed, and still applies its own device-layer safety rules.
8. **The hub as a second fence.**
   - Row level security keeps each person to their own rows.
   - There are no direct table writes: every write is a function that checks who is asking.
   - Each hub session is bound to one device.
   - Only approved devices can approve, grant, revoke or send.
   - Rate and size limits apply, and messages are deleted when picked up and purged when expired.
9. **Everything logged.** The receiving device writes every remote request in its activity log: what was asked, by which device, the result, and every refusal with its reason. That log is tamper-evident (hash-chained).

## Threats

### A stolen password

Someone learns his email and password (phishing, or a reused password) and signs in to Dayspring on their own computer.

- **What they get:** a hub session, and a device row marked **pending**. At the hub, a pending device can't send, answer pairing requests, approve, grant or revoke (`dayspring_remote_require`). At the devices, it isn't in anyone's trust list, so anything it manages to get onto the hub is refused as "not one of yours".
- **Getting approved:** that needs the owner to press **Approve** on one of his devices after comparing codes. His devices announce "a new device wants to join", so an unexpected request is noticed.
- **What they can still do:**
  - See his device list: names, platforms, when each was last seen, and the public keys. They can't see what the devices control, because the profiles are sealed.
  - Spam pairing requests. That's limited to 10 an hour.
  - They can't claim to be one of his devices by registering its (public) id and keys: the hub refuses while that device's own session is alive. After its session has ended, such a claim only puts the device back to pending, and it needs his approval again. (On an account with a single device, the claim keeps the hub status, but the other side still has no private key, so nothing it sends is accepted.)
  - They can't rename his devices, change their permissions or sign them out. The hub lets only an approved device's own session do that (it can't check an Ed25519 signature itself, so it relies on the session binding), and their device isn't approved.
- **The first-device caveat:** if the account has no approved device yet, the first sign-in becomes the first device. So set up the first Dayspring device before the password could leak. If an unknown device appears, sign it out and change the password.
- **Residual risk:** it's a denial of service at most (pairing spam). He should use a unique password.

### A stolen device

A laptop that's signed in is lost or stolen.

- **What the thief has:** the device's keys (protected by DPAPI, so they need his Windows login), its hub session, and its permissions. Within those permissions, they can send commands until it's revoked.
- **The response:** on any other device, **Sign it out remotely**. That does four things:
  - The revocation is signed and stored on the hub.
  - Every other device marks the laptop revoked (for good) and refuses it from then on.
  - The hub deletes its session binding, so the laptop can no longer act as a device. It also tries to end the laptop's hub session (deleting it from `auth.sessions`), so the refresh token dies. If the project doesn't allow that, the binding is still gone. It also drops the laptop's queued messages.
  - When the laptop next comes online, it sees the signed revocation and deletes its own keys.
- **Limits and mitigations:**
  - Give laptops only the permissions they need (for example, no "Start 3D prints").
  - Risky commands still need a yes said *on the laptop*. The thief can say yes, so the permissions are the real limit.
  - A revoked device's past approvals stay valid. Settings shows "approved on <device>" for every device, so check that list after revoking one.
  - Windows sign-in and BitLocker protect the DPAPI keys at rest.

### A malicious hub admin (or a hacked hub)

Someone with full control of the Supabase project: they can read and change every row, and run any SQL.

- **What they can't do:**
  - **Read commands, answers, camera pictures or profiles.** Those are sealed to device keys the hub never has (the tests check that the hub's copies contain none of the words or picture bytes).
  - **Forge a command.** They don't have any device's signing key.
  - **Add their own device.** A device row marked `approved` without a valid certificate from a trusted device is ignored.
  - **Swap keys during pairing.** The code on the two screens wouldn't match.
  - **Change permissions or sign devices out.** Those statements are signed.
  - **Replay a command.** Ids and nonces are remembered, and messages expire.
  - **Change a message's destination.** The header is signed and bound into the encryption.
- **What they can do:**
  - **Drop or delay messages** (the sender reports "didn't answer" or "offline").
  - **Hide a sign-out from devices** that weren't online when it happened (those devices keep trusting the revoked device until they see the revocation). The device that revoked it trusts it no more, and the revoked device deletes its keys if it sees the revocation.
  - **Learn metadata:** which devices exist and their names, when they talk to each other, message sizes, and IP addresses.
  - **Lock him out:** delete his rows, refuse to relay, or mark devices revoked (with an unsigned sign-out that devices ignore, while the hub refuses their messages).
- **Residual risk:** availability, and metadata. That's accepted: a hub admin already controls the Lantern account.

### Replay

Someone records a genuine command (from the hub, the network or a log) and sends it again later.

- **Defences:**
  - The hub's primary key is the envelope id, so it refuses a second copy.
  - The receiver remembers every id it has accepted, until the message expires, and across restarts.
  - A message is refused if it's more than 5 minutes old or past its expiry (60 seconds of clock difference allowed, with hub time as the reference).
  - Moving the payload into a new envelope with a new id breaks the signature and the decryption.
- **Tests:** a replayed command (re-inserted after it was picked up), a too-old one, an expired one and a too-long-lived one are all refused.

### The hub key is public

The publishable key ships in every Dayspring and Lantern release. Anyone can call the hub with it.

- **What it gives:** the ability to call `/auth` and `/rest` as `anon`. Every `dayspring_remote_*` table and function is closed to `anon`: privileges are revoked, and the functions need `auth.uid()`. Row level security is on for every table, with **select-only** policies scoped to `user_id = auth.uid()`, and no insert, update or delete policies. The internal helper functions can't be called by anyone. Realtime applies the same select policies, so a subscription only ever sees your own rows.
- **Account creation:** Dayspring never creates accounts (`create_user: false`). Whether sign-ups are open at all is the hub owner's Supabase setting (Lantern's invite flow). A new account made with the public key starts empty, with no way to see or reach anyone else's devices (tested).
- **A secret key:** Dayspring refuses a `service_role` / `sb_secret_` key anywhere it takes a hub key, and never looks for one.
- **Residual risk:** the barrier is only as good as the RLS rules. Keep them select-only and keep all writes in functions. Review any future migration that touches these tables.

### Rate limits and abuse

| Where | Limit |
|---|---|
| hub | 600 messages a minute per account; 1000 waiting for any one device; 20 devices per account; 10 pairing requests an hour; envelopes up to 96 KB; messages live 5 minutes at most (pieces 2) and are purged every 5 minutes (pg_cron) and while sending |
| each receiving device | 60 commands a minute from any one device; a 30-second limit on each action; pictures up to 2 MB and clips up to 8 MB |
| each sending device | one try per request (no automatic retries); a 20-second wait (45 for a picture); polling backs off to at most every 5 minutes while the hub can't be reached; live updates reconnect with a growing wait (1 second up to 60) |
| the camera "live" view | one still every 3 seconds, for 2 minutes at most, only while the page is visible |

Supabase's own platform limits (auth and Realtime) apply on top.

## Also considered

- **The local web server.** The Settings routes answer only this computer's own pages. The server refuses other hosts (DNS rebinding) and other sites' pages (cross-site requests), like every Dayspring route. Remote commands never arrive over HTTP, only through the hub.
- **Prompt injection.** The AI tools `remote_devices` and `remote_command` can't approve risky actions. They return a question, and only the owner's own "yes" (`lib/confirm.mjs`) turns it into a confirmed command. Text that comes back from another device is shown as its answer, never followed as an instruction.
- **Logs.** Remote commands are logged with the usual redaction (no keys, tokens or passwords). Message bodies from `announce` are short, and logged as they are, on the receiving device only.
- **The feature switch.** With the `remote` feature off, there are no routes, tools, voice commands or Settings section, and nothing connects to the hub. With it on but not signed in, nothing is loaded, no key is made and no connection is opened.
- **Clocks.** Freshness uses hub time, from the hub's `Date` header. A computer whose clock is wrong still accepts fresh commands and refuses stale ones.

## Residual risks and follow-ups

1. **Sign-outs can be hidden** from devices that were offline, by a malicious hub. A follow-up would send the signed revocation to every device as a message too, and show "last trust update" in Settings.
2. **Certificates issued by a revoked device stay valid.** Settings shows who approved each device. A follow-up could ask, when revoking, whether to also revoke the devices it approved.
3. **The first device on an empty account** is approved on trust.
4. **Metadata** (the device list and timing) is visible to the hub.
5. **The local trust file** (`data/remote/state.json`) isn't signed. Malware running as the owner could edit it, but such malware could also use the DPAPI keys directly. It's out of scope.
6. **Phones:** see the notes in [the protocol](remote-protocol.md#notes-for-a-phone-client). Key storage must use the platform's secure store.
