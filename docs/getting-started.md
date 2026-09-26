# Getting started

Dayspring is a voice assistant and day planner that lives on a screen in your home. It can be a spare monitor, a TV, or your laptop's own screen. It shows your day and week, and it keeps you on schedule with gentle reminders. You can talk to it ("Dayspring, what's on tomorrow?") or type to it.

It runs on your own Windows computer. Your schedule, notes, people and photos stay in a folder on that computer.

![The Dayspring screen: the time, what's now and next, today's plan, and the talk panel](images/screen.png)

## What you need

- A Windows 10 or Windows 11 computer.
- About 500 MB of free disk space.
- A screen for Dayspring. A second monitor or a TV plugged into the computer is ideal, but your main screen works too.
- A microphone if you want to talk to it. A headset, a webcam mic or the laptop's built-in mic all work. You can also just type.
- Google Chrome or Microsoft Edge. At least one is already on almost every Windows computer.

## Free, or better with an upgrade

Dayspring is **free by default**. With no accounts and no keys, you get:

- The schedule, with day, week, month and year views, and editing by voice, typing or mouse
- Reminders, a morning rundown and a night mode
- Voice commands like "add haircut Saturday at 10", "move gym to 7" and "what's on tomorrow"
- The free voices built into Windows and your browser
- Music and video through your own Spotify and YouTube sign-ins

You can add paid services at any time. None of them are required.

| Upgrade | What it adds | Cost |
|---|---|---|
| An AI "brain": Claude, ChatGPT or Grok | Real conversation, planning help, looking things up, writing | Pay as you go, usually a few dollars a month |
| Ollama | A free AI brain that runs on your own computer | Free, but needs a fairly strong computer |
| ElevenLabs voices | Studio-quality, very natural voices | Free tier, then about $5/month and up |
| OpenAI voices | Natural voices on the same account as ChatGPT | Pay as you go |

See [AI providers](ai-providers.md) and [Voices](voices.md).

## The five-minute version

1. **Install.** Download Dayspring, unzip it, and double-click **Install Dayspring.cmd**. See [Installing Dayspring](install.md).
2. **Start.** Double-click the **Dayspring** shortcut on your desktop (or **Start Dayspring.cmd**).
3. **Set up.** The first time, the setup wizard opens. Tell it your name, what to call the assistant, where you live, and which screen to use. Skip anything you're not sure about. See [The setup wizard](setup-wizard.md).
4. **Say hello.** Say "Dayspring, what's on today?" or click **⌨ Type** and type it.
5. **Build your week.** Say "add work Monday at 9 until 5", or open the schedule and click **+ Add**. See [Your schedule](schedule.md).

## Where things are

| What | Where |
|---|---|
| The Dayspring screen | Opens full screen when you start Dayspring. Its web address is `http://localhost:4747/display` |
| Settings | The ⚙ button on the Dayspring screen, or say "open settings". Address: `http://localhost:4747/setup` |
| This guide | The ❓ button, or say "open help". Address: `http://localhost:4747/help` |
| The desk view on your main screen | `http://localhost:4747` |
| Past conversations | `http://localhost:4747/history` |
| Your data | The `data` folder inside the Dayspring folder. See [Privacy](privacy.md) |

## Next steps

- [Talking to Dayspring](talking-to-dayspring.md): everything you can say
- [Your schedule](schedule.md)
- [Voices](voices.md) and [Sound: speakers and microphones](audio-devices.md)
- [Permissions](permissions.md): what Dayspring may see and do on your computer
- [Connecting apps](connections.md): Spotify, YouTube, your phone, and more
- [Troubleshooting](troubleshooting.md) and the [FAQ](faq.md)
