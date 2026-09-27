# Meetings (lib/meet)

Dayspring and Lantern can take part in a Google Meet call. Google doesn't allow Meet inside another page, so the app
opens the meeting in **its own browser window** (Playwright, a separate profile) and works with the page from there.

## The pieces

| File | What it does |
|---|---|
| `session.mjs` | `createMeetSession({ chromium, profileDir, onEvent })`: opens a Meet link, clicks **Join now** / **Ask to join** (only after the owner asked to join), turns captions on, opens the chat, sends chat messages, toggles the mic and camera (Meet's buttons, or Ctrl+D / Ctrl+E), leaves, and moves or shrinks the window. `roster()` reads who's shown; `readPeople()` opens the People list for a moment and closes it again (bringing the chat back); `screenshot()` is for reading names off the window when nothing else can; `rec({ text, paused } \| null)` shows the "● Notes" sign. When Google wants a sign-in, `stage` is `"sign-in"`: the owner signs in; nothing here types a password. |
| `selectors.mjs` | Where things are on Meet's page. Every part has a list of selectors (accessible roles and labels first, then known class names, then structure), and the in-page watcher reports which one matched (`selfCheck().used`, and `selfCheck().roster`). It watches with MutationObservers (a one-second tick is only a safety net) and emits `caption` (with `how`: `label`, `first-line`, or `continues` for a line with no name that carries on the speaker before), `chat`, `roster` (the tiles, the People list when open, the count on the People button, the page's language), `speaking` (a tile's "speaking" marker, a moving sound meter, or the one lit-up border) and `notice` (Meet's short notices, never the chat or captions). Captions labels and buttons are also matched in French, German, Spanish, Portuguese, Italian and Dutch. |
| `roster.mjs` | `createRoster()`: who's in the call, merged from every source (`snapshot("panel" \| "tiles" \| "ocr", list)`, `seen("caption" \| "chat", name)`, `joined` / `left` from notices), each person once, with how they were found and a confidence; the owner kept apart (Meet's "You", in the page's language: `isSelfLabel`; "(You)" in the People list gives the owner's name). `count(n)` cross-checks the number on the People button (`status().agrees`). `talking()`: the caption's speaker first, then the strongest tile signal. `history()`: join and leave times and talk time per person. `impostor()`: two entries labelled "You" in one list, or a plain "You" next to the marked owner, means a guest named themselves "You"; apps then stop treating "You" as the owner. `parseNotice(text)` reads "Rich joined" / "… left" / "… is presenting" in several languages. |
| `listener.mjs` | Caption lines (acted on once they stop changing) and chat messages → `{ assistant, question, speaker, via, isOwner }`, after the permission check. Anything not addressed to an assistant is dropped. The assistants' own voice reaches the meeting through the owner's microphone and is captioned as the owner, so `isEcho` and `ownerSpeaking` filter it. `isEcho` is given the assistant's name with the question ("Lantern, want to take that one?"), so the owner saying a command the assistant only mentioned is still the owner. |
| `address.mjs` | "Dayspring, …", "Hey Lantern …", "@Lantern …", "…, Dayspring?", with the usual mishearings ("Latern", "day spring"). |
| `permissions.mjs` | `only-me` / `everyone` / `custom`, per person and per assistant; voice commands like "let Rich and Jess ask", "let Rich ask Lantern", "only listen to me". The owner is always allowed. Fuzzy names; two equally close matches are never guessed. |
| `names.mjs` | `callName()`: the first name as shown (the full name when two people share it; nothing for "Unknown"). `createNamePolicy()`: the first answer to each person uses their name, then about one answer in three, never twice within two minutes. `opener()`: the greeting in each personality ("Well howdy, Rich!", Lantern's "Ah, Rich, a fine question."), with the name exactly as given. |
| `memory.mjs` | Who asked what in this meeting ("Building on Jess's question about sessions…"). Memory only; `clear()` when the meeting ends. |
| `chat.mjs` | `splitChat("Lantern", text)` → messages of at most 500 characters, prefixed "Lantern: " (and "(2/3)" when split). |
| `mock/meet-mock.html` | A stand-in Meet page with the same roles and labels: pretend people, captions that grow word by word, chat, prejoin, join/leave/presenting notices, a count on the People button, and variants: `?variant=bare` (no class names), `nest` (different nesting), `tiles` (only video tiles: no People list or tile markers), `canvas` (names only as pixels), `?lang=fr`, `?self=Name` (the owner marked "(You)" in the People list), `?speak=marker\|meter\|border`. |

`client/meet-tile.js` has the page parts: the chip, the people panel and the name card.

## Rules the apps keep

- Only the owner can change anything. Everyone else gets answers only, and only when the owner allowed them.
- Nothing that isn't addressed to an assistant is kept, unless the app takes notes: then everyone is told first (in the call and the chat) and a sign shows while notes are taken (Dayspring's `lib/meet/notes.mjs`). The meeting's memory (who asked what, who was there, who may ask) is gone when it ends.
- The owner is who Meet labels "You", never a name (a guest can call themselves anything).
- Never both: a person's name is used in the spoken answer **or** the chat answer, not both.
- One voice at a time (the ecosystem's `speaking.start` / `speaking.stop`).

## Tests

`node --test test/meet.test.mjs` (the in-page watcher tests run when `playwright-core` can be found: set
`PLAYWRIGHT_CORE` to its folder, or run from an app that has it).
