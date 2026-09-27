# Social: sharing memories and people between users

**Status: framework only, switched off.** The code in `lib/social/` is complete and tested, but no app turns it on. In Dayspring, `social.enabled` is false by default, and it is hidden. No real server exists yet.

The HTTP adapter is a stub. With no address it throws "not configured", and it refuses every address except `127.0.0.1`. So no data can leave a device, even by accident.

This spec follows the owner's plan for shared memories and people between Dayspring users (in the owner's private life-hub notes).

## The idea

Dayspring users can share photos and memories with each other. When several users know the same person, what they shared about that person comes together into one fuller profile. Dayspring then reminds people of those memories and of events, to keep them connected.

## Principles (non-negotiable)

1. **Private by default.** Everything stays on the device. Only an item a user deliberately shares, with specific people or groups, is uploaded. There is no "public" and no "everyone".
2. **Pooled profiles come only from shared items.** Private texts, call logs, contacts, locations and face data are never shared, pooled or uploaded. The schema refuses these kinds outright (`FORBIDDEN_KINDS`). A viewer's own texts with a person may appear on their own view of the profile, marked as local only.
3. **The subject has rights.** A user who is the person a profile is about can:
   - claim it
   - see everything shared about them
   - hide items from the pooled profile
   - untag themselves
   - opt out of pooling
   - decide about linking and cross-user face matching

   Face matching is off unless the subject says yes.
4. **Revocable.** Revoking a share removes it from every pooled profile. The revocation travels as a tombstone, and the server deletes the content.
5. **Kids.** Children get guardian control and stricter defaults.
6. **The owner's own private server.** Data is encrypted in transit and at rest, with per-user permissions. Photos and memories are end-to-end encrypted.
7. **Swappable.** Everything goes through a `SocialAdapter`, the same pattern as Lantern's hub adapter.

## Code map (`lib/social/`)

| File | What it does |
|---|---|
| `schema.mjs` | Record shapes, validators, forbidden kinds, consent defaults, wire field allow-lists |
| `sync.mjs` | Replicated state, ops, idempotent merge, conflict rules, outbox |
| `world.mjs` | An indexed, read-only view of the records for the pure engines |
| `consent.mjs` | The consent engine: `canView`, `canPool`, `canViewProfile`, `canShare`, `consentFor` |
| `links.mjs` | "Same person" links, clusters (union-find) and claims |
| `pooling.mjs` | `buildProfile` / `profileFor`: the computed pooled view |
| `shares.mjs` | `makeShare`, `revokeOps` (tombstones), `expireOps` |
| `reminders.mjs` | "On this day", birthdays, shared anniversaries, "haven't talked in a while" |
| `crypto.mjs` | X25519 + HKDF + AES-256-GCM sealing, Ed25519 signatures, the DPAPI device key store |
| `audit.mjs` | Hash-chained audit log |
| `hub.mjs` | Server rules: authorisation, per-user visibility, delivery, tombstone fan-out |
| `adapter.mjs` | `SocialAdapter` interface, `mockServerAdapter`, `httpServerAdapter` (stub) |
| `client.mjs` | One device: signs, encrypts, queues, syncs, verifies, computes profiles and reminders |

Importing `ecosystem-core/social` does nothing by itself. It generates no keys, makes no timers and opens no sockets.

## Identities

- **User account** (`users`):
  ```
  { id, handle, devices: [{ deviceId, encPub, signPub, addedAt, revokedAt? }], isMinor?, guardians?: [userId] }
  ```
- **Device keys.** Each device has an X25519 key for encryption and an Ed25519 key for signatures. They are made only by `createKeyStore().create()`. On Windows they are kept in `%LOCALAPPDATA%\Ecosystem\social-<app>-device.bin`, protected with DPAPI through the same helper as the shared AI key (`credentials.mjs`).
- **Public-key directory.** The server holds each user's public device keys. Lookups are exact, by id or by the whole handle. There is no listing, search or partial match.

  Registration must be signed by one of the new account's own device keys, as proof of possession. It can be closed, or invite-only. Users should compare key fingerprints (`fingerprint()`) when they first connect.

## People and links

- **Person record** (`people`). This is one user's own record of someone. On the wire it is only a stub:
  ```
  { id, owner, isMinor?, guardians?, subjectUserId?, nameBox, keys }
  ```
  The name is encrypted to the audiences of the items that tag the person. Everything else (phone, notes, texts) stays on the device.
- **Link** (`links`). This is a proposal that the owner's person P and another user's person Q are the same human:
  ```
  { a: {owner, personId}, b: {owner, personId}, proposer, evidence, confidence, endorsements: [{by, confidence, evidence}], rejectedBy, confirmedBy }
  ```
  Evidence is `manual` (0.6), `contact` (0.8), `shared-tag` (0.7) or `face` (0.9).

A link is **confirmed** when any one of these holds:
- The subject confirms it (a confirmed claimant).
- For a minor, a guardian confirms it.
- It is endorsed by at least `minUsers` distinct users (default 2), **including both record owners**, whose confidences add up to at least `minScore` (default 1.4).

A link is not confirmed in these cases:
- **Rejected for good.** The subject, a guardian, or either record owner rejects it.
- **Face evidence without consent.** Face evidence counts only if the subject opted in to face matching.
- **Subject-only linking.** The subject set linking to `subject-only`, which is the default for minors, and hasn't confirmed it themselves.
- **Linking off.** The subject set linking to `off`, so nothing links.

Confirmed links join records into **clusters** using union-find. The cluster id is `c_` plus the smallest member key, so every replica agrees on it.

## Claims

A **claim** says "that person is me":
```
{ claimant, person: {owner, personId}, vouches: [userId] }
```
It is confirmed when the record's owner vouches for it, or when the owner had already marked the record with `subjectUserId`. For a minor, a guardian must also vouch. A claimant can't vouch for themselves. If two confirmed claimants claim one cluster, it is disputed, and the cluster has no subject until that's resolved.

## Items and memories

An **item** (`items`):
```
{ id, owner, kind: photo|note|event|memory, visibility: private|shared, people: [own person ids], date?, eventKind?, box, keys, source? }
```
- Only `shared` items are ever uploaded.
- On the wire, the content (title, text, caption, the photo bytes) is inside `box`. Only routing metadata is in the clear: ids, kind, date, person ids and owner.
- The server refuses plaintext content fields, missing encryption, private items, forbidden kinds, and tags of people who aren't the author's own records.

## Shares

A **share** (`shares`):
```
{ id, itemId, owner, audience: { users, groups }, permissions: { pool, reshare, download }, expiresAt?, createdAt }
```
- The audience must name specific users or groups. A group counts only if the sharer owns it or belongs to it.
- Defaults: `pool: true`, `reshare: false`, `download: false`.
- An expired share is treated like a revoked one.
- A share about a minor may go only to the minor's guardians and the guardians' family groups. It is never reshareable or downloadable.
- Audience members can see the share's audience list, like the recipients of an email.

## Pooled profiles

A pooled profile is a view **computed** by `buildProfile(w, viewer, clusterId)`. It is never stored. It holds only items for which `canPool` says yes:

1. The viewer may see the profile at all (`canViewProfile`). That means one of these:
   - the viewer is the subject
   - the viewer is a guardian of a member record
   - the viewer owns a record in the cluster, meaning they know the person

   A stranger gets nothing, not even counts.
2. The item exists, its kind is shareable, and it is `shared`, never private.
3. The viewer may see the item (`canView`): they own it, they are in a live share's audience, or they are the subject or a guardian of someone it tags.
4. The item tags a member of this cluster, and the subject hasn't untagged themselves from it.
5. A live share that reaches the viewer has `pool: true`.
6. The subject (or a guardian) hasn't hidden it. The subject still sees hidden items, marked `hidden`, so they can undo it.
7. The subject hasn't opted out of pooling. A minor has pooling off unless a guardian opted in.
8. For a minor, the viewer must be a guardian, or a member of a guardian's family group.

`localPrivate` lets an app show the viewer their **own** private records about their own member record, flagged `localOnly`. This is how "your texts with them" can appear on your view. Those records are never uploaded or pooled.

The subject and guardians also get `denied`, the counts of what was left out and why. Others don't.

## Consent records

A **consent record** (`consents`):
```
{ subjectUserId | person: {owner, personId}, by, scope, value, at }
```

| Scope | Values | Default | Default for minors |
|---|---|---|---|
| `pooling` | `in` / `out` | `in` | `out` |
| `faceMatching` | `in` / `off` | `off` | `off` |
| `linking` | `open` / `subject-only` / `off` | `open` | `subject-only` |

The latest record per scope wins. It counts only if it was made **by the subject**, or, for a minor, by a guardian. Others' records are ignored, and the server refuses them.

## Hides and untags

A **hide** (`hides`):
```
{ itemId, by, action: hide|untag, personId? }
```
- `hide` removes the item from the pooled profile.
- `untag` detaches the person, so the item stops being about them anywhere.

These count only from the item's owner, the subject, or a guardian. The share itself remains the sharer's to revoke.

## Revocations and tombstones

Revoking a share makes a tombstone:
```
{ id, collection, by, at, reason, itemId? }
```
When no other live share of the item is left, a tombstone for the item is made too, and the server deletes the ciphertext.

Tombstones always win:
- nothing brings a tombstoned record back
- a stale replay is refused
- sharing again makes a new id

The server sends a tombstone to everyone who ever received the record.

## Groups

A **group** (`groups`):
```
{ id, owner, name?, kind: family|friends|other, members }
```
Only the owner edits a group. Family groups are what the minor rules refer to.

## Reminders

`generateReminders({ w, viewer, now, people, lastContact, label })` makes four kinds of reminder:

- **On this day.** A visible memory or photo from this date in an earlier year.
- **Birthdays.** The viewer's own people's birthdays, and birthday events shared with them.
- **Shared anniversaries.** Anniversary events shared with the viewer, with the number of years.
- **"You haven't talked to X in a while."** This comes only from `lastContact`, the viewer's own call and text history on their own device. It is never synced.

Text comes from the decrypted titles via `label`.

## Sync protocol

- **Op.** Every change is an op, signed with Ed25519 by the device:
  ```
  { v, opId, type: put|tombstone, collection, id, record, author, rev, at, sig: { deviceId, value } }
  ```
- **Outbox.** Ops wait in the outbox until the server accepts them. Retries are always safe.
- **Pull.** The server returns the **original signed ops** this user may see and hasn't received yet. Visibility is recomputed on every pull, so a new share, link or claim makes older records visible. Clients verify every op against the author's device keys and drop any that fail.
- **Merge.** Merge is idempotent and order-independent. These rules apply in order:
  1. A duplicate `opId` is ignored.
  2. A tombstone wins permanently.
  3. Link endorsements, rejections and confirmations merge as grow-only sets.
  4. Otherwise the higher `rev` wins, then the later `at`, then the larger `opId`.

The server authorises each op (`hub.mjs` `authorize`):
- the author must own the record
- link and claim updates may add only the author's own endorsements, decisions or vouches
- consents and hides must be made by their author
- a share is checked with `canShare`

**HTTP** is used by `social-server` and `httpServerAdapter`. The endpoints are:

- `POST /v1/register`
- `POST /v1/directory`
- `POST /v1/push`
- `POST /v1/pull`
- `GET /v1/audit`

Each signed request carries these headers:

- `x-social-user`
- `x-social-device`
- `x-social-ts`, within 5 minutes
- `x-social-sig`, which is Ed25519 over `canonical([method, path, ts, sha256(body)])`

Each signature is accepted once. There are rate limits per IP and per user.

## Encryption (scheme `ds-social/v1`)

- **Content.** AES-256-GCM, with a fresh random 32-byte key per item and a 12-byte IV. The AAD is `ds-social/v1|item|<itemId>`, so a box moved to another item fails.
- **Key wrap.** Each recipient device gets its own copy of the content key:
  - an ephemeral X25519 key and ECDH
  - then HKDF-SHA256, with salt `epk ‖ recipientPub` and info `ds-social wrap v1|<user>/<device>`
  - then AES-256-GCM
- **Recipients.** Every device of everyone in the audience, plus the sharer's own devices.
- **Rewrap.** This adds a device or a newly confirmed subject without re-encrypting the content.
- **Person names** are sealed the same way.
- **At rest on the server.** The file is AES-256-GCM encrypted with `SOCIAL_SERVER_DATA_KEY`.
- **In transit.** TLS, to be added before hosting.
- **Primitives.** Only Node's built-in `crypto` is used. RSA-OAEP was considered, but X25519 is smaller and faster.

## Retention and deletion

- **Revocation.** A revoked or expired share is tombstoned at once. The item's ciphertext is deleted when its last share goes.
- **Tombstones.** Kept until every device of every recipient has pulled them. The plan is to compact them after 400 days.
- **Account deletion.** Tombstones every share, item, person stub, group and link the account made, and removes its keys from the directory.
- **Devices.** A revoked device's signatures stop counting, and new shares aren't wrapped to it.
- **Audit.** Entries hold ids and reason codes only (no content or names). Keep them for 2 years.

## Audit log

The audit log (`audit.mjs`) is append-only and hash-chained:
```
{ seq, at, actor, action, target, result, reason, prev, hash }
```
- The server records every push, refusal, registration and handle lookup.
- Each client records its own actions.
- `verifyChain` finds edited or removed entries.
- A user can fetch their own entries.

## Threat model

- **A malicious user.**
  - They can't write others' records, forge endorsements, vouches or consents, or tombstone others' shares. The server authorises and verifies signatures; the client also verifies every op.
  - They can't upload private items, plaintext content or forbidden kinds.
  - They can't aim a share at a group they don't belong to.
  - They can't use hides or untags to affect others' items.
  - They can't reach a child outside the child's family.
- **A compromised server.**
  - It sees metadata: who shares with whom, when, which person ids are linked, and item kinds and dates.
  - It never sees content or names, which are end-to-end encrypted.
  - It can't forge ops, because clients verify signatures.
  - It can withhold data or replay old ops. Replays are harmless because of idempotent merge and tombstones.
  - It could substitute a public key in the directory. The mitigation is fingerprint comparison, with key-change warnings to come.
  - Remaining risk: metadata. A later version could hide person ids from the server.
- **A scraping attempt.**
  - There is no listing or search. Directory lookups are exact, rate-limited and audited.
  - Pulls return only what the consent engine allows.
  - Registration can be closed or invite-only.
- **A stalker building a profile of someone.**
  - They see a pooled profile only of someone they have in their own people.
  - Their own record joins the cluster only if the other record's owner endorses the link, confidence adds up, and the subject hasn't said no.
  - A single-user proposal never confirms, and face "evidence" is ignored without the subject's consent.
  - Even inside a cluster, they see only items that were shared with them.
  - A false claim needs the record owner's vouch.
  - The subject can opt out, hide items, untag themselves, or turn linking off.
- **Biometrics.** No face embedding is ever an item or synced. Face matching across users needs the subject's explicit yes (BIPA, GDPR and CCPA).

## Switching it on (later)

1. Build the real server from `social-server/`. See its README: TLS, a database and blob store, invites, device recovery, monitoring, backups and rate limits.
2. Get a security review and a privacy/legal review, including biometrics and children's data (COPPA).
3. Host it on the owner's private server.
4. Give `httpServerAdapter` the address and allow remote addresses in one reviewed place.
5. In Dayspring, build the real UI in place of the dev mockup. Then set `social.enabled` and give people an explicit opt-in. Create the device key only when the user opts in.
