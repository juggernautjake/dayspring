# Settings reference

Every setting in Dayspring, in the same order as the **Settings** page. To open Settings, click **⚙** on the Dayspring screen or go to `http://localhost:4747/setup`. Each section also opens directly: `http://localhost:4747/setup?s=voice` (use the name in brackets after each heading).

Settings save when you press **Save** at the bottom of a section. The screen, sky and speaker settings are different: they apply the moment you change them, so you can watch the Dayspring screen while you adjust.

Most settings can also be changed by voice, for example "make everything bigger", "switch your voice to Rachel", "turn off the weather". See [Talking to Dayspring](talking-to-dayspring.md).

## You

`?s=you`

| Setting | What it does |
|---|---|
| **Your first name** | What Dayspring calls you. This is the only setting it requires. |
| **Nicknames** | Up to 30. It uses one now and then, just for fun. Press Enter in a nickname to add the next one. |
| **A little about you** | Work, family, what matters to you. It uses this when it plans and talks with you. It stays on your computer and goes to your AI only as part of a conversation. |
| **Interests and hobbies** | Up to 40. They shape Discover ("For you"), the videos and the quotes on the screen. |

## Your assistant

`?s=assistant`

| Setting | What it does |
|---|---|
| **Assistant's name** | Keep "Dayspring" or choose any name. |
| **Wake words** | What you say to get its attention, separated by commas. "Hey …" works automatically. |
| **Sense of humor** | Just the facts, Light and friendly, Dry and witty, Goofy and playful, or describe your own. |

## Where you are

`?s=location`

| Setting | What it does |
|---|---|
| **Your city or town** | Type it and press **Search**, then pick the right place. It's used for weather, weather alerts, sunrise and sunset (for the living sky) and local news. |
| **Time zone** | Filled in when you pick a place. Change it only if it's wrong. |

## AI brain

`?s=ai` · Full walkthrough: [AI providers](ai-providers.md)

| Setting | What it does |
|---|---|
| **Provider** | No AI (free), Claude, ChatGPT, Grok, or Ollama (free, on your computer). |
| **API key** | Paste the key from the provider's website. **Get a key ↗** opens the right page. The key is saved only in the `.env` file on this computer. |
| **Ollama address** | For Ollama only. Normally `http://127.0.0.1:11434`. |
| **Model** | Leave it on **Recommended** unless you know you want another. **Refresh list** loads what your account offers. |
| **Test** | Sends a tiny test message and tells you whether it worked and how fast. |

## Voice

`?s=voice` · Full walkthrough: [Voices](voices.md)

| Setting | What it does |
|---|---|
| **Free voices** | The voices built into Windows and the browser. Press ▶ to hear one. "Natural" voices sound the most human, and Edge has the best ones free. |
| **ElevenLabs** | The most lifelike voices. Paste your ElevenLabs key; your own and Voice Library voices show with ⭐. |
| **OpenAI** | Natural voices using your OpenAI key (the same key as ChatGPT). |
| **Speed** | Slower to faster. |
| **Volume** | How loud Dayspring's voice is, compared with its music and sounds. |

On the Dayspring screen, the **🔊 Sound** panel has separate sliders for the voice, music, videos and sound effects.

## Speakers & mic

`?s=sound` · Full walkthrough: [Sound: speakers, headsets and microphones](audio-devices.md)

| Setting | What it does |
|---|---|
| **Sound** (per device) | Turns a speaker or headset on or off for Dayspring. You can use more than one at once. At least one stays on. |
| **Mic** (per device) | The microphone Dayspring listens with. |
| **Nickname** (per device) | A friendly name, so you can say "use my blue headset". |
| **↻ Look again** | Finds a device you just plugged in. |

Dayspring only changes its **own** sound. Your Windows default speaker and your other apps are never changed.

## Your week

`?s=week` · Full walkthrough: [Your schedule](schedule.md#routine-and-fixed-blocks)

| Setting | What it does |
|---|---|
| **Usually up at / in bed by** | Frames your day. The alarm rings at your first item. |
| **Work or school days, Called, From, Until** | Your regular work or school block. |
| **Add meal times** | Adds breakfast, lunch and dinner so it plans around them. |
| **Other things that repeat** | Practice, classes, worship: pick the days, times and kind. |
| **Build my week** | Turns the answers into routines. Tick **Replace the routines I have now** to start fresh. |
| **Your routines** | Each routine's title, times, days, on/off switch and ✕ to delete. |
| **Things Dayspring should never move** | Categories (such as Work) or title words (such as "class") that stay put when plans shift. |

## Features & apps

`?s=features`

| Setting | What it does | Guide |
|---|---|---|
| **☀️ Weather** | The forecast on the screen and in your morning briefing. | |
| **🧹 Little habits and chores** | Small tasks slipped into the gaps in your day. | [Your schedule](schedule.md) |
| **🎵 Music** | Spotify and YouTube by voice. Sign-in buttons, the Spotify **Client ID** and **Connect Spotify**. | [Music and videos](music.md) |
| **🖼️ Your photos** | A photo now and then. List your photo folders, one per line (empty = your Pictures folder). | [Photos](photos.md) |
| **📰 News** | Headlines when you ask. | [Connecting apps → News](connections.md#news-and-rss-feeds) |
| **✨ Discover** | Finds popular videos, clips and articles about your interests. **How often** (a few times a day, about every hour, only when I ask) and **Pop-ups a day** (0–5). | [Talking to Dayspring](talking-to-dayspring.md) |
| **📱 Phone texts** | Reads your texts and notifications through Windows Phone Link. | [Your phone](phone.md) |
| **🙏 Faith** | Morning devotion, prayer list, Bible reading. Inside it: **⛪ Church** and **📖 Scripture memory**. | [Faith features](faith-features.md) |
| **🛠️ Claude Code** | Lets Dayspring change its own code by voice. | [Claude Code](claude-code.md) |
| **Extra keys** | Optional keys: YouTube search, ESV Bible, NLT Bible. | [Connecting apps → Optional keys](connections.md#optional-keys-for-extras) |
| **🎧 Discord bot** | Bot token, your Discord user ID, and a text channel ID. **Save & connect** shows whether it's online. | [Discord bot](discord-bot.md) |

## Apps & connections

`?s=apps` · Full walkthrough: [Connecting apps](connections.md)

Every app Dayspring can connect to, each on its own card with its status, **Set up** / **Manage** (a step-by-step drawer with a button that opens the right website) and **Disconnect**: Google Calendar + Gmail, Outlook + Microsoft To Do, Notion, calendar subscriptions, news and RSS, Home Assistant, webhooks, Todoist, weather alerts, Spotify, YouTube, Phone Link and Discord. Each card saves itself, so there's no Save button. The same cards are on the **Apps** step of the guided setup (`http://localhost:4747/welcome?step=apps`).

## Permissions

`?s=permissions` · Full walkthrough: [Permissions](permissions.md)

| Setting | What it does |
|---|---|
| **Your files and folders** | No file access, Only certain folders (list them, one per line), or All my files (Windows system folders stay read-only). |
| **Creating or changing files** | Ask me first (it reads back the change and waits), Just do it, or Never. A backup is always saved first. |
| **Programs** | Off, Ask me first, or Allowed ("open Word"). |
| **Look things up online** | Web search and reading pages, with any AI. |
| **Use its own browser window** | Opening sites, clicking and reading for you. It never types passwords or payment details. |

Deleting always asks first and goes to the Recycle Bin, whatever these say.

## Screen

`?s=screen` · Full walkthrough: [Display setup](display-setup.md)

| Setting | What it does |
|---|---|
| **Which screen** | Click a screen, or choose Automatic (the second screen if there is one), Main screen or Second screen. |
| **Show the display in** | Google Chrome (default) or Microsoft Edge (free Natural voices). |
| **Keep this computer awake** | While plugged in: no sleep and no idle lock screen, so Dayspring can wake you and hear you. On battery it sleeps as usual. Your power settings are not changed. See [Keeping the screen awake](display-setup.md#keeping-the-screen-awake). |
| **📐 Fit to screen…** | Bright lines at the edges to line up with your TV. See [Fitting Dayspring to your screen](display-setup.md#fitting-dayspring-to-your-screen). |

**Size**: *Everything* (60–150%), *Text in the cards* (80–130%), *The clock* (60–160%).

**Margins**: *All sides* and *Top / Bottom / Left / Right* (0–20%) for TVs that crop the edges.

**Layout**: *Arrangement* (Automatic, Two columns, panel on the right or left, One column, Compact), *Dayspring panel width* (or automatic), *Spacing* (Comfortable or Compact), *Shape* (Fill the screen, or Keep proportions 16:9).

**What to show**: the clock and date, Now and Next, the rotating panel, the exam countdown, the course rings, the transcript, and *Rows in the day list* (0 = as many as fit).

**Motion**: *Seconds per slide* in the rotating panel (0 = it stays put) and *Calmer motion*.

Each group has its own **Reset**, and **Reset the whole screen layout** puts everything back.

## Sky & scenery

`?s=sky` · Full walkthrough: [Display setup → The living sky](display-setup.md#the-living-sky)

| Group | Settings |
|---|---|
| **Living sky** | On, or off for a plain dark background. |
| **Vibe** | One tap sets everything: Real world, Calm, Cozy, Vivid, Minimal, Focus, Night owl. **Reset everything** goes back to Real world. |
| **Weather** | *Follow the real weather*, or pick one (clear, partly cloudy, overcast, drizzle, rain, storm, snow, fog). Sliders for clouds, rain, drops on the glass, snow, fog, wind, sun rays; *Lightning in storms*. |
| **Time of day** | *Follow the sun*, or pick a time (night to dusk); *Shift sunrise/sunset* by up to an hour. |
| **Season** | *Follow the calendar*, or pick one; *Leaves, petals & seeds*. |
| **Scenery** | A new one each day, rolling hills, crop fields, forest, river, or none; grass, water shimmer, night lights and fireflies, stars and moon. |
| **Colors** | Brightness, color richness, warmth, *Darken behind the cards*, *Accent colors follow the sky*. |
| **Motion** | Normal, Reduced (no particles), or Still; smoothness 15, 30 or 60 fps (lower is lighter on older computers). |
| **Schedule-aware vibe** | Changes the vibe during kinds of blocks, for example Focus while studying. |
| **Preview** | Shows a look for 20 seconds without saving it. |

## Keys in the .env file

Keys you paste in Settings are saved in the `.env` file in the Dayspring folder. You normally never need to open it. If you do, it's a plain text file of `NAME=value` lines; restart Dayspring after editing it. Never share this file: it holds your keys. See [Privacy](privacy.md).

## Related

- [Tutorials: how do I…?](tutorials.md), a task-by-task index
- [The guided setup](setup-wizard.md)
- [Troubleshooting](troubleshooting.md)
