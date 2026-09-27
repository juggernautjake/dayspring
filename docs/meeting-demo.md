# Meetings: Dayspring and Lantern in a Google Meet call

Dayspring can join a Google Meet call with you. It opens the meeting in **its own window**, which shrinks to a small tile in the bottom-right corner while you use Dayspring. It reads Meet's captions to know **who is talking**, and answers the people you allow. **Lantern** (the learning app) takes part too: people can ask it about your courses, and it answers with the lessons that teach it and a link to each one.

> Google doesn't let Meet run inside another page, so the meeting has its own window. Click the tile (or say "bring the meeting back") to make it big again.

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
| 9 | Say **"Dayspring, leave the meeting"**, then **"yes, leave"** | Dayspring leaves. What was asked in the meeting is forgotten. |

## Who can ask

- **You**, always. Your own commands work in the meeting too: "mute", "unmute", "turn off my camera", "turn on captions", "open the chat", "who's in the meeting?", "bring the meeting back", "shrink the meeting", "leave the meeting".
- **Everyone else, only when you say so.** You can:
  - say "let Rich and Jess ask", "let Rich ask Lantern", "let everyone ask", "don't let Sam ask Dayspring", or "only listen to me"
  - use the **Who can ask** list in the Meetings panel (a **Can ask Dayspring** and a **Can ask Lantern** switch for each person, plus **Only me** / **Everyone can ask** / **People I choose**)
- People you allowed can ask questions. They can't change anything: "Only you can ask me to do that."
- Speech that isn't addressed to Dayspring or Lantern is never kept. What people asked is forgotten when the meeting ends.

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
| **Captions detected ✗** | Press **C** in the meeting window. If captions still can't be read (Google changed its page), Dayspring listens with **Tune in** instead. It still answers, but can't tell who's talking, so it uses no names and everyone gets the safe answers. |
| **People can't hear Dayspring** | Check Meet's microphone is **Voicemeeter Out B1** and **Answer into the call** is on. Run the sound test again. |
| **Lantern isn't running** | Dayspring answers for Lantern from the installed course, in Lantern's voice. Start Lantern for the full experience. |
| **No AI** | Answers come straight from the lesson's key points, still with the lesson and its link. |
| **The link doesn't open for others** | Set the course page's sharing to "anyone with the link". |
| **Two answers at once** | Only one voice speaks at a time. Tune in stands down while the meeting reads captions. If the Discord bot is also in a Discord call, that's a separate call. |

## Try a course question without a meeting

Open the Meetings panel and join the rehearsal. Or ask Dayspring's local API directly: `POST /api/meet/ask { "question": "…" }` returns the lessons it would cite, the answer and the link.
