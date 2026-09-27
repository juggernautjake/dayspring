# Privacy

Dayspring was built to keep your life on your computer.

## What stays on your computer

Everything personal is kept in two places inside the Dayspring folder:

| Where | What |
|---|---|
| `data\` | Your profile, schedule, reminders, people and birthdays, notes about people, prayer list, photo catalogue, settings, conversation history, and diagnostics logs |
| `.env` | Your API keys and advanced settings |

These are **never** included when Dayspring is updated, exported or shared. Updates replace the program files and leave `data` and `.env` alone.

## What leaves your computer, and when

| When | What is sent | To whom |
|---|---|---|
| You use a cloud AI brain (Claude, ChatGPT, Grok) | What you say or type, plus the context needed to answer (for example today's schedule, and a file you asked about) | That AI provider |
| You use Ollama | Nothing. It runs on your computer. | — |
| You use ElevenLabs or OpenAI voices | The text Dayspring is about to say | That voice provider |
| Free voices | Nothing, or the spoken text for Edge's online Natural voices | Microsoft (Edge Natural voices only) |
| Weather | Your town's coordinates | Open-Meteo (free, no account) |
| Web lookup and browser control | Your searches and the pages visited | The search engine and those websites |
| Spotify / YouTube | What you play | Spotify / YouTube, under your own account |
| Checking for updates | A request for the latest version number | GitHub |
| A meeting's summary (with a cloud AI brain) | The words of that meeting's notes, to write the summary | That AI provider |

Each AI and voice provider has its own privacy policy and data-use terms for API customers, including whether they keep or train on what you send. Check them if this matters to you. If you want nothing to leave your computer, use Ollama.

## Listening

- Dayspring listens for its **wake word** using your browser's built-in speech recognition. In Chrome and Edge, that recognition is done by Google or Microsoft online services.
- Speech that isn't addressed to Dayspring (no wake word, and not a follow-up to something it just said) is **ignored and not saved**. At most, diagnostics record that *something* was heard (a word count), never the words.
- **✋ Stop** stops listening immediately. **🔇 Text only** turns listening off entirely.

## Meetings

When Dayspring is in a Google Meet call with you, it takes **notes** (you can switch this off in the 📹 Meetings panel):

- **Everyone is told first.** Before a single word is written down, Dayspring posts "Heads up: Dayspring is taking notes…" in the meeting's chat and says it out loud. A **● Notes** sign shows in the meeting window and on the Dayspring screen. If it can't tell the meeting, it takes no notes.
- **What's in them:** what people said (from Meet's captions, with their names), the chat, who came and went, and Dayspring's and Lantern's answers.
- **Off the record:** say "Dayspring, don't record this part" (or "pause the notes"). Nothing is written until you say "you can record again".
- **Audio** is a separate choice, off unless you turn it on. When it's on, Dayspring says so in the heads-up.
- **Where they're kept:** `data\meetings\`, one folder per meeting (the transcript, the chat, the summary). They stay on your computer. Only the summary step sends the notes' words to your AI provider. Without an AI key, the summary is made on your computer.
- **How long:** 90 days by default (then they go to the Recycle Bin), or what you choose in the Meetings panel. Delete any meeting there yourself.
- Recording laws vary. In some places, everyone in a conversation has to agree to it being recorded. Dayspring always announces its notes, but it's up to you to follow the rules where you and the others are.

Who's in the call is read from the meeting page. When the page shows no names, Dayspring reads them off a picture of the meeting window with Windows' own text recognition, on your computer. The picture is deleted straight away.

## Conversation history

Conversations with Dayspring are saved in `data\transcripts\` so it can remember them ("what did we talk about last week?"). Browse them at `http://localhost:4747/history`. To erase them, close Dayspring and delete that folder.

## Texts from your phone

Texts are read from Windows' notification list and read aloud only after you say yes. Unless you turn on **Save my text messages to people's profiles** (Settings → Photos & people, off by default), their words are kept in memory for the conversation and **never written to disk**. When it's on, they're saved encrypted with your Windows account in `data\people\comms.bin`, for as long as you choose. Nothing is ever sent without your spoken yes.

## Faces in your photos

Face recognition is off until you turn it on (Settings → Photos & people). It runs entirely on your computer: faces are never uploaded, never looked up online, and never identified in pictures from the web. Face fingerprints and thumbnails are encrypted with your Windows account in `data\people\faces.bin`. **Delete all face data** removes them. Pictures only go to your AI provider if you turn on **Describe images with AI**. See [Photos and people](photos-and-people.md).

## Files

Dayspring can see only the folders you allow (see [Permissions](permissions.md)). It never reads secret files such as `.env`, keys or password vaults.

## Diagnostics

Dayspring keeps a small technical log in `data\devlog\`: what went wrong, how long answers took, and which feature handled a request. It helps fix problems. It stays on your computer. Turn it off in Settings → **Features** → **Diagnostics**.

## Erasing everything

Close Dayspring, then delete the `data` folder and the `.env` file. The next start is a fresh install with the setup wizard.
