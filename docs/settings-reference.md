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

## Where you are

`?s=location`

| Setting | What it does |
|---|---|
| **Your city or town** | Type it and press **Search**, then pick the right place. It's used for weather, weather alerts, sunrise and sunset (for the living sky) and local news. |
| **Time zone** | Filled in when you pick a place. Change it only if it's wrong. |

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

## Your assistant

`?s=assistant`

| Setting | What it does |
|---|---|
| **Assistant's name** | Keep "Dayspring" or choose any name: 1–19 letters, numbers, spaces, apostrophes and hyphens (never "Lantern"). The app is still called Dayspring. |
| **How to say it** | How the name is said, if not the way it's spelled ("Ee-fa" for Aoife). The voice says it that way, and it helps hearing the name. ▶ Hear it plays it. |
| **Wake up to its name** | On: the wake word is the name, and changes with it. Off: choose your own wake words. |
| **Wake words** | Up to 3, each up to 19 characters ("Hey Nova", "Computer", "Jarvis"). "Hey …" in front always works. Each has **Sounds like** and **Also accept** (what the recognizer writes instead). |
| **How easily it wakes** | Strict, Normal or Relaxed. |
| **Try it** | Type what the recognizer might write: it says whether that would wake it, and what the request is. |
| **Train my wake word** | Say the wake word five times on the Dayspring screen; what it heard is kept as accepted spellings. |
| **Sense of humor** | Just the facts, Light and friendly, Dry and witty, Goofy and playful, or describe your own. |

More in [Renaming your assistant and wake words](renaming-your-assistant.md).

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

**Until you choose a voice**, Dayspring uses a friendly, warm female voice: **Matilda** with ElevenLabs, **coral** with OpenAI (else shimmer), and with free voices the first of **Ava**, **Jenny** or **Aria** (Natural), another Natural English voice (Emma, Michelle, Sonia, Libby, Natasha), then Windows' **Zira**. The guided setup's **guide** has its own warm male voice (Will with ElevenLabs; Andrew, Brian or Guy (Natural), then David) and never changes Dayspring's voice. Full list: [Voices → The default voices](voices.md#the-default-voices).

## Speakers & mic

`?s=sound` · Full walkthrough: [Sound: speakers, headsets and microphones](audio-devices.md)

| Setting | What it does |
|---|---|
| **Sound** (per device) | Turns a speaker or headset on or off for Dayspring. You can use more than one at once. At least one stays on. |
| **Mic** (per device) | The microphone Dayspring listens with. |
| **Nickname** (per device) | A friendly name, so you can say "use my blue headset". |
| **↻ Look again** | Finds a device you just plugged in. |

Dayspring only changes its **own** sound. Your Windows default speaker and your other apps are never changed.

## Screen

`?s=screen` · Full walkthrough: [Display setup](display-setup.md)

| Setting | What it does |
|---|---|
| **Which screen** | Click a screen, or choose Automatic (the second screen if there is one), Main screen or Second screen. |
| **How Dayspring opens** | **Automatic** (an app window on this screen, full screen on a TV or second screen), **App window**, **Compact (Dayspring mini)**, **Full screen** or **Browser tab**. See [Opening Dayspring](display-setup.md#opening-dayspring-app-window-compact-full-screen-or-browser-tab). |
| **Which browser shows Dayspring?** | Your default browser (the default), or any browser on the computer: Edge, Chrome, Brave, Firefox, Opera, Vivaldi… Used for every way Dayspring opens and for Pop out. **Reopen now in …** switches straight away. Edge has the best free voices. |
| **Speech recognition** | **Automatic** (the browser's own in Chrome and Edge, otherwise the private one), **The browser** (fast, needs the internet), or **On this computer (private)** (works in every browser; a one-time download of about 200 MB). |
| **Keep the Dayspring screen open** | Off unless you turn it on. On: if the screen closes or the TV is unplugged, it opens again by itself. Off: when you close it, it stays closed. |
| **Open the screen when Windows starts** | Only if Dayspring starts with Windows. Off (the default): it starts hidden, with notifications and alarms working. |
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

## Look & feel

`?s=looks` · Settings only. Full walkthrough: [Look and feel: themes and avatars](look-and-feel.md)

| Group | Settings |
|---|---|
| **Colour theme** | 16 themes (Default, Rose, Sage, Forest, Ocean, Sunset Coral, Lavender, Mint, Harvest Gold, Crimson, Slate, Cherry Blossom, Emerald Night, Candy, High Contrast, Light), **Surprise me**, **Preview on the Dayspring screen**, **Back to the default look**. |
| **Make your own theme** | A main colour, a second colour and an optional background colour; Dark, Light or Automatic; a name. A sample and a readability check show as you pick. |
| **Avatar** | The orb (default), Aurora flame, Sun ring, Blob buddy, Waveform halo, Pixel pal, or your picture, each with a live preview; **Test talking** and **Test listening** on the screen. |
| **Your picture** | A main picture, and optionally one each for Listening, Thinking, Talking, Off, Stopped listening, Error and Sleeping; *Fit* and *Shape*. |
| **Per personality** | An avatar and a theme for any personality; a saved personality can remember the look in use. |
| **Expression mode** | Off until you turn it on. The highest rating (G, PG, PG-13), how often, how much space to keep, checking each picture, finding new ones on the web, your own pictures, events; **Build my expression library**; see and remove what's kept; add your own. |

## Notifications

`?s=notifications` · Settings only. Full walkthrough: [Compact mode, quiet mode and notifications](quiet-and-notifications.md)

| Setting | What it does |
|---|---|
| **Dayspring is** | **Active** (listens and speaks), **Quiet** (hears its name, says nothing) or **Off** (not listening; the microphone is released). Also on the badge, with **Ctrl+Alt+Shift+D**, or by voice. |
| **Alarms still ring when Off** | On by default. |
| **How each kind arrives** | For Reminders, Schedule, Texts and phone, Lantern, Discover, and Updates, alerts and system: **Usual**, **Speak**, **Chime only** or **Silent**. |
| **Quick switch for everything** | Overrides them all (speak, chime only, or silent) until you choose **Use the settings above**. |
| **Show notifications in front of every window** | Small cards at the top-right, over any app, without taking the focus. Skipped while the Dayspring window is in front. |
| **Show them when Dayspring is off** | On by default. |
| **Speak announcements even when the screen is closed** | Off by default. With no Dayspring screen open, notifications set to Speak are read in Windows' own voice; off, they chime instead. Alarms always ring from the desktop card. |
| **Stay on screen for** / **Show them on** | 3–30 seconds; the main screen or screen 1–3. **Show a test notification** tries it. |

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

## Calls

`?s=calls` · Full walkthrough: [Dayspring in calls](discord-calls.md) and [Discord bot](discord-bot.md)

Everything here saves as you change it (in `data\calls.json`), so there's no Save button. At the top: whether Tune in is listening (and in which call app), whether answers go into the call, and whether the Discord bot is online.

| Setting | What it does | Default |
|---|---|---|
| **Call apps** (Discord, Zoom, Google Meet, Teams, Any other app) | For each app, the exact **Microphone** and **Speaker** to pick on this computer, where that setting is in the app, and recommended extras. Dayspring never changes them. A table of all apps is underneath. | — |
| **▶ Test** | Plays a test phrase into the call mixer and checks it arrived, that Voicemeeter is running, and that Dayspring can hear your speaker. | — |
| **Speed** | How long the last 10 answers took, from the end of the question to the first sound. | — |
| **Wait after someone stops talking** | How much quiet ends a question. Shorter answers sooner; too short cuts people off mid-pause. | 450 ms |
| **While thinking** | Nothing, a soft blip, or a short "mm-hm" (Discord bot). | Nothing |
| **Quick listening** | Uses the fast speech model's words when they're clear, instead of a second, slower pass. | On |
| **Stop when someone talks over me** | Talking over Dayspring for about half a second stops it (Discord bot). **…with Tune in too** does the same for Tune in. | On · Off |
| **When the Discord bot and Tune in are both in the call** | Who answers, so nobody hears two answers. | The bot |
| **Direct messages from** | Who can DM the Discord bot: anyone, people in a server with the bot, only you, or nobody. | People in a server with the bot |
| **Dayspring's channel ID** | A Discord channel where every message is for Dayspring. | — |
| **Personality in Discord** | A different personality just for Discord, or the same as everywhere. | The same |
| **Share my schedule with Discord** | Lets friends ask what you're up to today. Files, texts and the prayer list stay private either way. | Off |
| **Copy invite link** | The link that adds the bot (with its slash commands) to a server you manage. | — |

## Smart devices

`?s=devices` · Shown in Settings only · Development version · Full walkthrough: [Smart devices](smart-devices.md)

Everything saves as you change it. Kept in `data\devices-home.json`; passwords and keys sealed with Windows' protection.

| Setting | What it does | Default |
|---|---|---|
| **May Dayspring switch your devices?** | Off, Ask me first (every switch waits for your yes), or On (everyday things just happen; risky ones still ask). | Off |
| **Recommended power strips** | The strips that switch each outlet on its own and work on your own network, with links and notes. | — |
| **Find devices on my network** | Looks for Kasa, Shelly, Tapo, Meross and WLED devices (only when you click), with **Add** for each. | — |
| **Your strips and plugs** | Each strip: its kind, address, login, outlets, **Test**, and each outlet's device. Custom HTTP/MQTT devices start from a template. | — |
| **Devices** | Name, kind, room, other words for it, the outlet it's on, Wake-on-LAN, a Home Assistant / Matter entity, WLED or Hue, Critical, This PC, auto-off, its 3D printer, and its own Control setting. | Like everything else |
| **Scenes** | Several devices at once ("movie mode"). | — |
| **Philips Hue** | Pair a bridge (press its button first). | — |
| **Limits** | Seconds between switching the same thing, most switches per minute, how many things make a command ask first. | 3 s, 8, 4 |

## 3D printers

`?s=printers` · Shown in Settings only · Development version · Full walkthrough: [3D printers](bambu-printers.md)

| Setting | What it does | Default |
|---|---|---|
| **Add a printer** | Bambu Lab (IP, serial, access code, model), Creality Ender / Marlin over USB (its port), OctoPrint (address, API key) or Klipper (address), and a camera for printers without one. **Test connection**. | — |
| **The empty bed** | Take a picture of the empty bed (per plate), and drag a box around the bed. | — |
| **Look every** | How often a picture is taken while printing. | 10 minutes |
| **How sure before it warns you** | Warn early, Balanced, Only when quite sure. | Balanced |
| **Ask the AI to look too** | Like "Describe pictures with AI", yes, or no (this computer only). | Like "Describe pictures" |
| **Keep failed-print pictures** | Days. | 30 |
| **Pause by itself when it looks like it's failing** | Off: it tells you and asks. It never stops a print by itself. | Off |
| **Start queued prints by themselves when the bed is clear** | Off: "ask me first". On: a fresh clear-bed check is still required every time. | Off |
| **Always keep a timelapse** | A good print's pictures become one video instead of being deleted. | Off |
| **Ask me if it came out okay** | Before clearing the pictures. | Off |
| **Also text me when a print fails** | Uses the phone number in Notifications. | Off |
| **Queue folder** | Its .3mf / .gcode files are queued. | Empty |

## GIFs

`?s=gifs` · Shown in Settings only · Full walkthrough: [GIFs](gifs.md)

Keys save as soon as you click **Save key**; everything else saves with **Save** (or when you move to another section). Kept in `data\gifs.json` (keys in `.env`).

| Setting | What it does | Default |
|---|---|---|
| **Sources** (GIPHY, KLIPY, Imgur, Web) | One card each: an on/off switch, the key (never shown again once saved), **Test** (✓ Works, Key not accepted, Busy, Unavailable), **Get a free key** with the steps, and the credit shown with its GIFs. Drag the cards or use ▲ ▼ to set which goes first. The web search needs no key and steps in whenever nothing else can answer. | All on |
| **Highest rating to show** | G, PG, PG-13 or R. Checked by the sources and again by Dayspring. | PG-13 |
| **Show at first** | GIFs or stickers. | GIFs |
| **Preferred format** | GIF, MP4 or WebP, for the big preview, saving and attaching. | GIF |
| **Animate GIFs** | Always, only when pointed at, or never in the grid. | Always |
| **Data saver** | Smaller previews in the grid. | Off |
| **Save GIFs to** | A folder of your own. Empty: Pictures › Dayspring GIFs (when Permissions allow it, otherwise Dayspring's `data\gifs`). | Empty |
| **Keep up to (MB)** | Space for GIFs kept for attaching and copying, and **Clear GIF cache**. | 200 MB |
| **Favourites and recent GIFs** | How many you have, with **Clear favourites** and **Clear recent GIFs**. | — |
| **Say the GIF's title when you pick one** | "Number 4: Dancing cat, from GIPHY", or just "Number 4". | On |

## Lantern

Shown in Settings only. Everything here is optional; see [Dayspring and Lantern](lantern.md).

| Setting | What it does |
| --- | --- |
| **Status** | Whether Lantern is running, your courses and their progress, and **Open Lantern**. Without Lantern: **Install Lantern** (it asks before installing anything). |
| **Connect to Lantern** | So Dayspring can tell you about course invitations and friend requests: **I already have Lantern** (uses Lantern's sign-in), your email and a password (**Sign in** / **Create an account**; the password is never saved), or **Email me a sign-in link** (open it on this computer). A 6-digit code only on hubs whose email includes one. The sign-in is kept in Dayspring's `data` folder, not `.env`, and handed to Lantern once when it's installed. |
| **Your Lantern hub** | The hub's address and its **public** key, from the person who invited you. A secret key is refused. |
| **The AI key** | **Use Dayspring's AI key in Lantern** or **Use the AI key from Lantern**: set up the AI once. Stored encrypted for your Windows account; never sent between the apps. |
| **Listening** | **Let Lantern listen** or **Dayspring listens**: which app listens for its name. Dayspring does while it runs, unless you hand it over. |

## Permissions

`?s=permissions` · Full walkthrough: [Permissions](permissions.md)

| Setting | What it does |
|---|---|
| **Your files and folders** | No file access, Only the folders and files I choose (each Read only, Read & write or Blocked, with or without subfolders), or Everything on this computer (Read only or Read & write). A summary says what Dayspring will and won't be able to do. |
| **Ask me before every change** | On: it says what it will change and waits for your yes. A backup is always saved first. |
| **Can delete files** | Off unless you turn it on. Deleted things go to the Recycle Bin, and it always asks first. |
| **Create / edit / rename and move** | Each kind of change on its own, where Dayspring may write. |
| **More file safety** | Files and folders to treat as important (always a warning and "Are you sure?"), and how many files one change may touch before it asks (25). |
| **Programs** | Off, Ask me first, or Allowed ("open Word"; also terminals and Claude Code). |
| **Look things up online** | Web search and reading pages, with any AI. |
| **Use its own browser window** | Opening sites, clicking and reading for you. It never types passwords or payment details. |

Whatever these say, Windows, Program Files, boot files, the registry, other people's profiles, Dayspring's own code, its permissions and its activity log are never changed. After an update from an older Dayspring, a **Keep this setting** button asks you once to confirm what you had.

## Activity log

`?s=activity` · Full walkthrough: [Permissions → The activity log](permissions.md#the-activity-log)

| Setting | What it does |
|---|---|
| **From / To, Show, Search** | Which days and which kinds of entries to list: file changes and reads, only changes, commands, tool calls, programs, permission changes, confirmations, blocked attempts. |
| **Export CSV** | Saves what's listed as a spreadsheet file. |
| **Check the log** | Makes sure no line was changed or removed. |
| **Restore this version** | Puts back a file as it was before that change (the current version is backed up first). |
| **Days to keep the log and file backups** | At least 120, 180 to start with. |

## Updates

| Setting | What it does |
| --- | --- |
| **Check now** | Asks GitHub for a newer Dayspring right away and shows the answer ("You have the newest version", the new version, or what went wrong, with **Retry**). Dayspring also checks when it starts and every few hours, and a ⬆ appears in the window bar when one is ready. |
| **Update now** | Shown when a new version is out, with its **What's new**. Backs up your data, installs, restarts (about a minute). |
| **When a new version comes out** | **Ask me** (a card on the screen with the choices; the default), **Install it when I'm not using Dayspring** (after half an hour of quiet; never during an alarm, a call or Tune in), or **Install it the next time Dayspring starts**. |
| **What changed** | Every installed update, newest first, with its notes and whether it worked. A version that didn't start is undone by itself, and says so here. |

Backups of your data and of the previous version are in the `backups` folder. See [Updating](updating.md).

## About

`?s=about` · Settings only.

| Setting | What it does |
|---|---|
| **Running parts** | Every Dayspring process running now (as named in Task Manager), with **Stop all**. See [What's running](troubleshooting.md#whats-running). |
| **Uninstall Dayspring…** | Removes Dayspring, keeping your data unless you choose otherwise; you confirm by typing your name. See [Uninstalling](install.md#uninstalling-dayspring). |

## Keys in the .env file

Keys you paste in Settings are saved in the `.env` file in the Dayspring folder. You normally never need to open it. If you do, it's a plain text file of `NAME=value` lines; restart Dayspring after editing it. Never share this file: it holds your keys. See [Privacy](privacy.md).

## Related

- [Tutorials: how do I…?](tutorials.md), a task-by-task index
- [The guided setup](setup-wizard.md)
- [Troubleshooting](troubleshooting.md)

## New in 1.3.0

| Setting | Where | What it does | Default |
|---|---|---|---|
| **Timers still ring when Dayspring is quiet or off** | Notifications | A timer you set rings like an alarm (with its name) even when Dayspring is Quiet or Off. Off: a finished timer only shows a card. | On |
| **Offer a joke now and then** / **At most … a day** | Notifications | With a playful personality (Humour 60+), Dayspring may offer a joke when someone's around. Never during calls, alarms, timers, cooking or focus time. | On, 3 a day |
| **Without AI → Try it** | AI brain | Shows what Dayspring would do with a phrase, without doing it. | |
| **Keep phrases I didn't understand** | AI brain → Without AI | Keeps the words (never audio, only on this computer) so you can teach what they mean. | On |
| **Forget what you learned** | AI brain → Without AI | Clears the phrasings Dayspring learned from your picks and teaching. | |
