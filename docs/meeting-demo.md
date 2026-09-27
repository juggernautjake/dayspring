# Meetings: Dayspring and Lantern in a Google Meet call

Dayspring can join a Google Meet call with you. It opens the meeting in **its own window**, which shrinks to a small tile in the bottom-right corner while you use Dayspring. It reads Meet's captions to know **who is talking**, and answers the people you allow. **Lantern** (the learning app) takes part too: people can ask it about your courses, and it answers with the lessons that teach it and a link to each one.

> Google doesn't let Meet run inside another page, so the meeting has its own window. Click the tile (or say "bring the meeting back") to make it big again.

Dayspring also takes **notes**: a transcript with who said what, and a summary when the meeting ends. It tells everyone first. See [Meeting notes and the summary](#meeting-notes-and-the-summary).

## Before the day: set it up once

1. **Answer into the call.** Turn on **Settings → Calls → Answer into the call**. Dayspring's voice then goes into the call through Voicemeeter, mixed with your own microphone.
2. **Sign in to Google.** Open the 📹 **Meetings** panel (on the screen's talk bar), and press **Sign in…** in the checklist. Sign in to Google yourself in the window that opens. Dayspring never types passwords. The window remembers you.
3. **Meet's microphone.** In a meeting (or a test call at meet.google.com), open **⋮ → Settings → Audio**. Set **Microphone** to **Voicemeeter Out B1** and press **Test**. Leave the speaker on your headset. Tick the checklist item.
4. **Sound test.** Press **Test** in the checklist. It plays a test phrase into the call mixer and listens for it.
5. **Lantern and a course.** Start Lantern. The course you'll show must be installed (Lantern → your course → Install).
6. **The public lesson link.** In the Meetings panel, paste your course's public link with `#{lesson}` at the end (for example `https://…/artifact/…#{lesson}`). Make sure its sharing is **anyone with the link**: open it in a private window to check. Tick the checklist item.
7. **Rehearse.** Press **▶ Rehearse**. A pretend meeting opens with pretend people. After a few seconds, "Rich" asks Lantern a course question. You'll hear the answer, see the lessons and link in its chat, and see the results card on the screen.

When every item in the **pre-flight checklist** is ticked, you're ready.

## The demo, step by step

| Step | You do / say | What happens |
|---|---|---|
| 1 | Paste the Meet link on the Dayspring screen (or say **"Dayspring, join my meeting"**) | The meeting window opens, joins, turns on captions and opens the chat. Then it moves to the corner. Dayspring says hello in the chat and explains how to ask. |
| 2 | Turn on **Demo mode** in the Meetings panel | Anyone can ask Dayspring or Lantern. Course questions asked of Dayspring go to Lantern. |
| 3 | Say **"Dayspring, what's on the screen?"** or show your schedule | You're driving Dayspring as usual; the meeting stays in the corner. |
| 4 | Ask a participant to say **"Dayspring, tell us a joke"** | Dayspring answers out loud in the call, usually using their name the first time. |
| 5 | Ask a participant to say **"Lantern, how do I keep a database query safe from SQL injection?"** (or any course question) | Lantern answers out loud in its own voice: a short answer, then "It's covered in Unit X, Lesson Y, … and I've put the link in the chat." The detailed answer and the lesson link appear in Meet's chat. The results card on the screen shows the lessons, with **Open in Lantern**. |
| 6 | Ask someone to ask **Dayspring** a course question | Demo mode: "Great question, Jess. Lantern, want to take that one?" Then Lantern answers. |
| 7 | Ask someone to type **@Lantern what's a struct?** in the chat | Lantern answers in the chat. |
| 8 | Say **"bring the meeting back"** and share your screen | The meeting grows. Press **Present now** in Meet and choose the Dayspring window, so everyone sees the name card ("Lantern — answering Rich"). |
| 9 | Say **"Dayspring, leave the meeting"**, then **"yes, leave"** | Dayspring leaves. The notes and the summary are saved (📹 → **Past meetings**). Everything else it knew about the meeting is forgotten. |

## Who can ask

- **You**, always. Your own commands work in the meeting too: "mute", "unmute", "turn off my camera", "turn on captions", "open the chat", "who's in the call?", "who's talking?", "bring the meeting back", "shrink the meeting", "leave the meeting", and the notes commands below.
- **Everyone else, only when you say so.** You can:
  - say "let Rich and Jess ask", "let Rich ask Lantern", "let everyone ask", "don't let Sam ask Dayspring", or "only listen to me"
  - use the **Who can ask** list in the Meetings panel (a **Can ask Dayspring** and a **Can ask Lantern** switch for each person, plus **Only me** / **Everyone can ask** / **People I choose**)
- People you allowed can ask questions. They can't change anything, and they can't control the notes: "Only you can ask me to do that."
- Dayspring knows it's you because Meet labels your own captions **You**. If someone in the meeting names themselves "You", Dayspring can't tell you apart in the captions. It tells you, and stops taking meeting commands said in the call. Use the Dayspring screen for them.
- With notes off, speech that isn't addressed to Dayspring or Lantern is never kept. Either way, what people asked (and who was there) is forgotten when the meeting ends; only the saved notes remain.

## Who's in the call, and who's talking

Dayspring puts together who's in the call from several places, so it still works when Google changes its page:
- the **People** list (it opens it for a moment and closes it again)
- the **name on each video tile**
- who speaks in the **captions** and who writes in the **chat**
- Meet's **"Rich joined" / "Rich left"** notices
- the **number on the People button**, to check nobody is missing

Who's talking comes from the captions first, then from a tile that lights up or a sound meter that moves.

Ask **"Dayspring, who's in the call?"** or **"who's talking?"**. The checklist's **People detected** line says where the names came from.

It works in other languages too: it knows Meet's "You" in French, Spanish, German, Portuguese, Italian and Dutch, and their join notices.

If the page shows no names at all, Dayspring reads the names off a picture of the meeting window, with Windows' own text recognition. This happens on your computer, and the picture is deleted straight away.

## Meeting notes and the summary

**Everyone is told first.** When Dayspring joins, it posts **"Heads up: Dayspring is taking notes in this meeting, for a summary…"** in the chat. With the Dayspring screen open, it also says it out loud. Only then does it start writing. A red **● Notes** sign shows at the top of the meeting window and on the meeting chip. If Dayspring can't tell the meeting (the chat doesn't work and the screen isn't open), it takes no notes.

The notes have:
- what people said, with the time and their name (from the captions; "Speaker unknown" when Tune in has to listen instead)
- the chat
- who joined and left
- Dayspring's and Lantern's answers, with the lesson links

| Say | What happens |
|---|---|
| "Dayspring, don't record this part" (or "this is off the record") | Nothing is written down until you say "you can record again". The notes show a gap there. |
| "pause the notes" / "resume the notes" | The same, for a break. |
| "stop taking notes" / "start taking notes" | Stops, or starts again (everyone is told again). |
| "what did Rich say about the budget?" | What Rich said about it, from the notes. |
| "summarize so far" | A short spoken summary of the meeting until now. |
| "recap my last meeting" | The summary of the last saved meeting, out loud. |

Only you can use these. The **Notes** buttons in the Meetings panel do the same.

**When the meeting ends,** the notes are saved in `data\meetings\<date and title>\`:
- `transcript.md`: everything, with times
- `chat.md`: the chat
- `summary.md`: the summary
- `meta.json`: who was there, when they came and left, and how long each talked

With an AI key, the summary has a short and a longer summary, the key points, decisions, action items (who, what, when), the questions asked and answered, and follow-ups. Long meetings are summarized in parts, so a two-hour meeting works too. Who was there and how long each talked is counted, not guessed, and course answers keep their lesson links. Without an AI key, you still get who was there, talk time, the questions heard, the chat and the whole transcript.

**Past meetings** in the 📹 Meetings panel lists them. You can:
- search (names, or words someone said)
- read the summary, transcript or chat
- **Copy** it, or open its **Folder**
- have it read out (**🔊 Recap**)
- make an **Email draft** for the people who were there (your mail app opens with the summary; nothing is sent unless you send it)
- **Delete** it (it goes to the Recycle Bin)

Meetings are kept for 90 days, then go to the Recycle Bin. Change that in the panel (30 days, a year, or until you delete them).

**Recording the audio** is a separate choice, off unless you turn it on (**Record the audio too**). The heads-up then says so. It saves what your computer plays from the call (everyone else, as you hear them) as `audio.wav`: about 115 MB an hour. Your own microphone isn't in it. Dayspring doesn't change any audio devices for it.

> Recording laws vary. In some places, everyone in a conversation has to agree to being recorded. Dayspring always announces its notes, but it's up to you to follow the rules where you and the others are. Turn notes off in the Meetings panel for meetings where they don't belong. See [Privacy](privacy.md#meetings).

## Names

When Dayspring can tell who's talking (from the captions or the chat), it uses their name now and then:
- the first time it answers each person, then about one answer in three
- never twice in a row to the same person within two minutes
- in the spoken answer **or** the chat answer, never both

It uses the name exactly as Meet shows it, and in your chosen personality's style. When two people share a first name, it uses their full name. When it can't tell, it doesn't guess.

## If something goes wrong

| Problem | Fix |
|---|---|
| **"Sign in to Google"** | Sign in in the meeting window. Dayspring joins by itself once you're in. |
| **It's stuck at "Ask to join"** | The meeting's host has to admit you. Use a meeting you own for the demo. |
| **People detected ✗** | Nobody else has joined yet, or Google changed its page. Ask "who's in the call?". If the page shows no names, Dayspring reads them off a picture of the window. |
| **The summary says "written without AI"** | No AI key was working when the meeting ended. Add one in Settings, then open the meeting in **Past meetings** and press **Write the summary again**. |
| **Captions detected ✗** | Press **C** in the meeting window. If captions switch off by themselves, Dayspring turns them back on. If captions still can't be read (Google changed its page), Dayspring listens with **Tune in** instead. It still answers, but can't tell who's talking, so it uses no names and everyone gets the safe answers. |
| **People can't hear Dayspring** | Check Meet's microphone is **Voicemeeter Out B1** and **Answer into the call** is on. Run the sound test again. |
| **Lantern isn't running** | Dayspring answers for Lantern from the installed course, in Lantern's voice. Start Lantern for the full experience. |
| **No AI** | Answers come straight from the lesson's key points, still with the lesson and its link. |
| **The link doesn't open for others** | Set the course page's sharing to "anyone with the link". |
| **Two answers at once** | Only one voice speaks at a time. Tune in stands down while the meeting reads captions. If the Discord bot is also in a Discord call, that's a separate call. |

## Try a course question without a meeting

Open the Meetings panel and join the rehearsal. Or ask Dayspring's local API directly: `POST /api/meet/ask { "question": "…" }` returns the lessons it would cite, the answer and the link.
