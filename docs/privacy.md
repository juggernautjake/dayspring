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

Each AI and voice provider has its own privacy policy and data-use terms for API customers, including whether they keep or train on what you send. Check them if this matters to you. If you want nothing to leave your computer, use Ollama.

## Listening

- Dayspring listens for its **wake word** using your browser's built-in speech recognition. In Chrome and Edge, that recognition is done by Google or Microsoft online services.
- Speech that isn't addressed to Dayspring (no wake word, and not a follow-up to something it just said) is **ignored and not saved**. At most, diagnostics record that *something* was heard (a word count), never the words.
- **✋ Stop** stops listening immediately. **🔇 Text only** turns listening off entirely.

## Conversation history

Conversations with Dayspring are saved in `data\transcripts\` so it can remember them ("what did we talk about last week?"). Browse them at `http://localhost:4747/history`. To erase them, close Dayspring and delete that folder.

## Texts from your phone

Texts are read from Windows' notification list and read aloud only after you say yes. Their words are kept in memory for the conversation and **never written to disk**. Nothing is ever sent without your spoken yes.

## Files

Dayspring can see only the folders you allow (see [Permissions](permissions.md)). It never reads secret files such as `.env`, keys or password vaults.

## Diagnostics

Dayspring keeps a small technical log in `data\devlog\`: what went wrong, how long answers took, and which feature handled a request. It helps fix problems. It stays on your computer. Turn it off in Settings → **Features** → **Diagnostics**.

## Erasing everything

Close Dayspring, then delete the `data` folder and the `.env` file. The next start is a fresh install with the setup wizard.
