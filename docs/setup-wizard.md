# Setting up Dayspring

The first time you start Dayspring, a **guided setup** opens in your browser (Microsoft Edge if you have it, because it has the best free voices). A friendly guide **talks you through every step** and explains what's happening. It takes about 10 minutes.

- 🔊 / 🔇 **mutes the guide**. His words always stay in the box at the top, so you can read instead of listen.
- ↻ **says it again**, and ⏸ **pauses** him.
- **Back**, **Skip for now** and **Next** are at the bottom. Everything but your name can be skipped and done later.
- Close the page any time: next time it **picks up where you left off**. **Start over** (top right) goes back to the beginning without losing what you saved.

The guided setup lives at `http://localhost:4747/welcome`. Afterwards, everything it set is in **Settings** (the ⚙ button, "open settings", or `http://localhost:4747/setup`).

## 1. Welcome, and your name

![The first step of the guided setup](images/setup-welcome.png)

Tell Dayspring what to call you. Add **nicknames** if you like (up to 30). It uses one now and then, for example "Good luck, Champ!".

## 2. Would you like an AI assistant?

Dayspring works on its own as a scheduler. An **AI brain** turns it into an assistant you can really talk to:

- plans and reshuffles your day ("fit a haircut in Saturday"),
- reads your documents and explains or summarizes them,
- looks things up on the web,
- coaches and encourages you, knowing your week.

Choose one:

| Choice | What it is | Cost |
|---|---|---|
| **Claude** (recommended) | Anthropic's AI: the most natural to talk to, careful with your schedule, great with documents. | Pay as you go: buy credit ahead (from $5). Everyday use is typically a few dollars a month. |
| **ChatGPT** | OpenAI's models. Also unlocks OpenAI voices. | Pay as you go: from $5 ($10 by default); credits last a year. |
| **Grok** | xAI's models. | Trial credit for new accounts, then prepaid credit. |
| **Ollama** | A free AI that runs on your own computer. | Free. Needs a fairly strong PC (16 GB memory); slower and simpler answers. |
| **No thanks** | Just the scheduler. | Free. Add AI later any time. |

> **Note:** a **ChatGPT Plus/Pro** or **Claude Pro/Max** chat subscription is *not* API credit. Dayspring uses the developer API, which is billed separately (on the Claude Console, the OpenAI Platform or the xAI Console).

## 3. Connect your AI

The setup shows numbered steps for your choice, each with a button that opens the right page:

**Claude:** open the [Claude Console](https://platform.claude.com/) and sign up → **Settings → Billing**, add credit → **Settings → API keys → Create key**, name it "Dayspring", **Copy** (it's shown once; it starts with `sk-ant-`) → paste it and press **Test**.

**ChatGPT:** [platform.openai.com](https://platform.openai.com/) → **Settings → Billing → Add payment details** and choose an amount → **API keys → Create new secret key** → copy → paste → **Test**.

**Grok:** [console.x.ai](https://console.x.ai/team/default/api-keys) (no X Premium needed) → check your trial credit or add credit under **Billing** → **API Keys → Create API Key** (starts with `xai-`) → paste → **Test**.

**Ollama:** [download Ollama](https://ollama.com/download/windows) and run it → in PowerShell run `ollama pull llama3.1:8b` (about 5 GB; there's a Copy button) → **Check**.

If the test fails, the message says why: *key not accepted* (copy it again or make a new one), *no credit yet* (add credit, wait a minute, test again), or *can't reach it*. Your key is stored only on this computer, in Dayspring's `.env` file.

## 4. Pick a voice (with an AI)

- **ElevenLabs** (most natural): make a free account, then **Developers → API Keys → Create API Key**. Leave *Restrict key* on but allow **Text to Speech** and **Voices: Read**. Paste the key, press **Connect**, then press ▶ to preview voices and click one to choose it. Voices you add from the **Voice Library** ("Add to my voices") show up too. The free plan is about 10 minutes of speech a month.
- **Free Windows voices**: preview any with ▶. The ✨ *Natural* ones sound best (they come with Edge).
- **OpenAI voices**: for ChatGPT users, using the same key.

## 3 (without AI). Scheduler mode

If you chose **No thanks**, you'll see what works right away: the schedule (with repeating events and drag-to-change), reminders, the alarm and snooze, spoken heads-ups, music and videos, reading documents aloud, the weather and the living sky, plus a list of example voice commands. You can add an AI later in Settings → AI brain.

## 5. Your week and town

Your usual wake-up and bedtime (and whether you'd like a gentle alarm), plus work or class days and hours if you have them. Dayspring builds a starter week you can change later on the schedule. Type your town and press **Find** for the weather and the sky.

## 6. Interests

Pick anything that fits (Faith, Fitness, Studying, Music, Cooking, Family, Gaming, Tech, News, Travel, Pets…) and add others in your own words. Interests:

- turn on the right features (Faith → devotions, prayer list and memory verses; Music → music; News → headlines; Studying → course cards…),
- shape the videos and encouragement Dayspring suggests,
- offer a few **starter routines** ("Workout, Mon/Wed/Fri 5:30 pm") you can add with a tick.

## 7. Permissions: what Dayspring may look at

This step can't be skipped: **Next** stays grey until you pick one of three options. Nothing is picked for you.

- **No file access** (recommended if you're not sure): Dayspring won't look at any of your files. It still needs a click.
- **Only the folders and files I choose**: type or paste a path, use a quick pick (Documents, Desktop, Downloads…), or press **Browse…**. Set each place to **Read only**, **Read & write** or **Blocked** (to keep a folder out of one you allowed), and choose whether it **includes subfolders**.
- **Everything on this computer**, then **Read only** or **Read & write**.

When Dayspring may write somewhere, **Ask me before every change** is on and **Can delete files** is off (deleting always goes to the Recycle Bin and always asks). You can also turn creating, editing, and renaming or moving on or off one at a time. A summary shows in plain words what Dayspring **will** and **won't** be able to do. You also choose whether Dayspring may **open programs** (off / ask first / on), **use a web browser** for you, and **look things up online**. Passwords, keys, Windows and other people's files are always off limits, and everything Dayspring does goes in its activity log. See [Permissions](permissions.md).

## 8. An AI coding tool (optional, with an AI)

A coding tool lets Dayspring change its own code when you ask ("add a button that shows tomorrow's weather"), fix things, and automate chores. **Claude Code** is recommended (and for ChatGPT users, **Codex**); any tool works with any AI. Press **Install**, then follow the sign-in steps (run `claude` or `codex login` in PowerShell and approve in the browser), then **Check again**. See [Claude Code](claude-code.md).

## 9. Apps

![The Apps step: a card for each app, with Connect and a walkthrough](images/setup-apps.png)

Optional cards, each with **Connect** and a step-by-step walkthrough:

- **YouTube**: sign in (Premium means no ads).
- **Spotify**: a free developer app, then sign in (needs Premium). See [Music](music.md).
- **Google Calendar + Gmail**, **Outlook + Microsoft To Do**, **Notion**. See [Connecting apps](connections.md).
- **Phone Link**: hear your texts (iPhone or Android). See [Phone](phone.md).
- **Discord**: a Dayspring bot for your server. See [Discord bot](discord-bot.md).

## 10. Sound

- **Voicemeeter (for calls)**: lets Dayspring answer *into* Discord and other calls. Press **Install**; Windows asks for permission. Dayspring sets it up in a safe shared mode so it never takes over your headset.
- Where Dayspring's voice plays, and which microphone it listens with. This never changes Windows' default devices, so your other apps are unaffected. See [Sound](audio-devices.md).

## 11. Screen

Where Dayspring lives (**Automatic** uses a second screen if you have one) and which browser shows it (**Edge** has the best free voices). Fine-tune sizes and margins later in **Settings → Screen**. See [Display setup](display-setup.md).

## 12. All set

A summary of your choices, and **Open Dayspring**. Say **"Dayspring"** any time you need it.
