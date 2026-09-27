# Lantern → Dayspring XP: the contract

Dayspring owns the XP ledger (`data/xp-ledger.jsonl`); it is the single source of truth. Lantern only reports **verified** learning, and Dayspring turns it into XP exactly once. The code is `lib/xp/learning.mjs`; the user-facing explanation is [XP and badges](../xp.md#learning-in-lantern).

## The event: `xp.earned` (Lantern → Dayspring)

It's an ecosystem-core event (schema v1, additive), sent to `POST /api/eco/event` with Dayspring's token:

```json
{ "v": 1, "id": "<uuid>", "type": "xp.earned", "source": "lantern", "at": 1790000000000,
  "data": { "eventId": "<uuid>", "key": "lantern:py:lesson:u1l3", "kind": "lesson", "course": "py",
            "courseTitle": "Python Basics", "ref": "u1l3", "title": "Variables and Types",
            "authoredXp": 400, "score": 0.9, "minutes": 30, "at": "2026-09-26T14:02:00Z", "verified": true } }
```

- **Required:** `key`, `kind`, `course`, `ref` (ecosystem-core validates these).
- **Who may send it:** only Lantern. The event must come through `POST /api/eco/event` with Dayspring's ecosystem token (`x-eco-token`, from Dayspring's presence file) and `source: "lantern"`; anything else is refused. The token only proves "a local app", so a live event is never trusted on its own word (see *verify-first* below).
- **`kind`:** `lesson` · `exercise` · `practice` · `check` · `milestone` · `unit` · `course`.
- **`key`:** the idempotency key.
  - `lantern:<course>:<kind>:<ref>` for one-time things.
  - `lantern:<course>:practice:<sessionId>` for practice.
  - Dayspring always works the key out itself from `course`, `kind` and `ref`/`sessionId` (`keyOf`). An event whose `key` doesn't match is refused (`bad-key`), so a key can't be used to smuggle in a different kind.
  - Dayspring awards a key at most once, ever (a reversed award frees its key).
- **`verified`:** must be `true`. Anything else earns nothing.
- **`at`:** the completion time. It decides which day's caps apply. An `at` more than 2 days old, or in the future, makes it catch-up (below), on every path.

Until Lantern sends `xp.earned`, Dayspring also awards from Lantern's existing events:
- `lesson.completed {course, ref}` → key `lantern:<course>:lesson:<ref>`
- `unit.completed {course, ref, title}` → key `lantern:<course>:unit:<ref>`

## The summary: `xp.summary` (Dayspring → Lantern) and `GET /api/xp/summary`

Dayspring pushes `xp.summary` about 1.5 s after any XP change. The same object is available from `GET /api/xp/summary`, which needs:
- the ecosystem token (`x-eco-token`, from Dayspring's presence file)
- a local Host (anything else gets 421)
- no foreign Origin (403)
- without the token: 401

```json
{ "balance": 220, "level": 2, "title": "Apprentice", "streak": 3,
  "badges": { "total": 4, "latest": { "key": "study:4", "name": "Quick Learner", "at": "…" } },
  "perCourse": { "py": { "xpAwarded": 29, "authoredXp": 450, "itemsCompleted": 3 } } }
```

## Conversion (Dayspring's economy)

| kind | XP | rule |
|---|---|---|
| lesson | 12 | once per lesson |
| exercise | 5 | the first pass only |
| practice | 8 | per session of 10+ verified minutes; at most 3 a day per course |
| check | 40 × score | from a score of 70% (below: 0, with encouragement; a later pass still counts) |
| milestone | 25 | a project milestone |
| unit | 60 | a unit finished |
| course | 300 | the course finished |

Lantern's authored numbers (`authoredXp`) are recorded with each earning for display only.

**Learning has:**
- no 70% self-report factor
- no evidence question
- no use of the study check-in limit
- a learning cap of **120 XP a day**, which feeds the lifetime total, levels, streaks and the Study & Learning badges

**The spending limit:** at most 80 XP a day may be added to the balance, from check-ins and learning together. This keeps "a secret character takes at least 7 days" true. The simulation is in `lib/xp/learning.test.mjs`.

## Verify-first (live events)

A live event (`xp.earned`, `lesson.completed`, `unit.completed`, or `xp.earned` on Lantern's SSE) is a hint, not proof:

1. Dayspring fetches `GET /api/local/courses/<id>` from Lantern (with Lantern's token from `lantern.json`, fresh, **2 s** at most).
2. If that detail shows the item done (the same key), it's awarded, with **Lantern's** date, score and minutes (the event only fills gaps).
3. If not (not done yet, Lantern busy or unreachable), nothing is awarded; the key is queued and that course is reconciled 30–60 s later, then by the regular backfill. `GET /api/xp/learning` shows the queue as `waiting`.

So Lantern's course detail must list what it reports:
- lessons, exercises, checks, milestones, units and the course, with `status` and `completedAt`;
- practice sessions as `practice: [{ id, minutes, completedAt, status? }]` (the `id` is the `sessionId`). Until Lantern lists them, practice events wait in the queue and don't count.

A future option (not required today): Lantern could sign each `xp.earned` with an HMAC made with its own presence token, and Dayspring would check it against `lantern.json`. Verify-first already stops a forged event from earning anything, so this would only save the extra request.

## Sync: nothing missed, nothing doubled

1. **Live:**
   - the eco events above (`POST /api/eco/event`)
   - Lantern's `GET /api/local/events` SSE. A `progress`, `lesson-completed`, `course-updated`, `sync` or `milestone` event re-checks that course 2 s later; an `xp.earned` event there goes through verify-first.
   - If the stream fails or answers with an error, Dayspring waits longer each time (15 s, 30 s, 1 min … up to **10 min**). A **404** means an older Lantern without the stream: Dayspring stops trying and relies on the backfill.
   - A backfill asked for while one is running isn't dropped: one follow-up run is queued (for that course, or all courses).
2. **Backfill:**
   - When: at startup (after 20 s), every 10 minutes, and on "Check Lantern now".
   - What: `GET /api/local/status`, then `GET /api/local/courses/<id>` for each installed course.
   - Every completed lesson, passed exercise, passed check, done milestone, finished unit and finished course whose key isn't in the ledger is awarded, oldest first.
3. **Catch-up** (on every path: backfill, live and claims): anything dated more than 2 days ago, or in the future, and anything undated on a course's first import.
   - It's recorded with its own date (a future date is recorded as today) and marked `catchup: true`.
   - It counts toward the lifetime total, levels and badges (within that day's learning cap).
   - It is **never spendable** (`spendable: 0`), so spendable XP only comes from days with real activity and the first unlock still takes at least 7 of them (the simulation in `learning.test.mjs` covers catch-up and backfill).
   - At most **200** catch-up XP are recorded per calendar day. The budget is worked out from the ledger (`recordedDay`), so a restart doesn't reset it; what doesn't fit waits for the next day's backfill.
4. **The clock:** if the computer's clock is before the latest day or time Dayspring has seen (the ledger, `data/xp-clock.json`), nothing is awarded ("Your computer's clock changed; XP paused until it's fixed."). A jump forward of more than 36 h is allowed and marked `clockJump`.
5. **XP turned off:** nothing is recorded, unless the owner turned on *Keep tracking quietly while hidden* (`trackHidden`); then learning is recorded with no events, announcements or summary pushes.
6. **Idempotent by key:** redelivery, both paths firing, or a completion synced from another computer through Lantern's hub all resolve to the same key.

## A spoken claim is verified first

For "I finished lesson 3 (in Python)", Dayspring:
1. Finds the course (named, current, or in progress) and the lesson (by name, by number, or the current one).
2. Calls `POST /api/local/report {course, lesson}` with Lantern's token. Status, the course detail and the report get **1 s** each, so the reply never waits over 3 s. Other voice questions ("how much XP from Python?") are matched first and only then ask Lantern (1 s, status cached 15 s).
3. Awards only on `verified: true`. Otherwise it replies kindly: "Lantern doesn't show … as finished yet. Finish it in Lantern and it will count automatically."

## What Lantern needs to do

- Send `xp.earned` (above) for every verified completion and practice session, with a stable `key` and the real completion time `at`.
- Put `completedAt` (ISO) on completed items in `GET /api/local/courses/<id>`, plus `score` on checks and exercises and `authoredXp` (a course's `xp_reward`). Today there are no completion dates, so first imports are treated as catch-up.
- List verified practice sessions there too (`practice: [{ id, minutes, completedAt }]`), so live practice events can be confirmed.
- Send `xp.earned` only after the item shows as done in the course detail (Dayspring checks it straight away).
- Keep `POST /api/local/report` returning `{ verified, lesson: { status }, message, next, percent }`.
- Sync its copy of ecosystem-core (it adds `xp.earned` and `xp.summary` to `EVENT_TYPES`). To show Dayspring's XP in the hub, listen for `xp.summary`, or call `GET /api/xp/summary` with Dayspring's token.

## Tests

- `lib/xp/learning.test.mjs`: unit tests with a fake Lantern and clock.
- `scripts/qa/lantern-xp.mjs`: end to end against a mock Lantern in a throwaway ecosystem folder.
  - Covers: SSE, 421/403/401, verify-first live events (unconfirmed → queued; mismatched key refused), backfill, idempotency, a hub-synced completion, the verify-first claim, catch-up (never spendable, 200 a day), the summary push and endpoint, voice, the Learning tab, and the study-card chips.
  - `--live` additionally READS the real Lantern on :4321 (GET only).
