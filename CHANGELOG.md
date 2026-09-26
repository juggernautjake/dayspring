# Changelog

All notable changes to Dayspring. Versions follow [semantic versioning](https://semver.org).

## 1.0.2 — a smoother Schedule, Settings and screen

**Fixed**
- **The Schedule** no longer slides sideways when you press Add, and a closed side panel can't be tabbed into.
- Double-clicking **Save** adds an item once, not twice.
- Clicking through Day, Week, Month and Year quickly always shows the view you picked. The year view loads much faster and says "Loading…" if it takes a moment.
- A message that has faded away no longer blocks the buttons underneath it.
- **Fit to screen** by keyboard: pressing Enter on a button presses that button again. It never saves by surprise.
- **The guided setup**: after you skip a step, its spoken line no longer plays over the next step.
- **Settings**: a change is saved when you move to another section, so nothing is lost. Things a section started (like waiting for Spotify) stop when you leave it.
- **Esc** closes only what's on top, one thing at a time.
- Asking "what's the weather?" before you've set your town now tells you how to add it, instead of saying nothing.
- Long names and interests wrap neatly instead of running off the edge. Nicknames can't be added twice.
- **Church** and **Scripture memory** can't be switched on while Faith is off. "Add meal times" remembers what you chose.
- **Help**: typing one letter clears the old results, and a link to a page that doesn't exist says so and suggests close matches.
- The status says **Reconnecting…** while Dayspring itself can't be reached, instead of "Ready".
- The first time the screen opens (often right after setup, maybe at night), it stays bright for a while and explains night mode.
- Links like "Open on the laptop" work even when Dayspring runs on a different port.
- Small labels are easier to read.

**New**
- **Overnight items**: set an end time before the start (11pm to 1am) and it runs past midnight. It shows on both days with its real times, and editing or deleting either day changes the whole thing. You can also drag an item's bottom edge past midnight.
- Dayspring's typeface now comes with it, so every page looks right even without internet.
- The Sound panel opens straight away: the list of speakers and microphones is looked up in the background.

## 1.0.1 — quieter, one window, and updates that look after themselves

**Fixed**
- Dayspring no longer opens extra copies of itself during the guided setup (or afterwards). Starting it again brings its window back instead of opening a new one.
- No more black command windows popping up. Dayspring now runs quietly in the background, with no command window to keep open.
- The guided setup opens once, in your own browser, and at the end Dayspring opens in its own window.
- **One voice at a time**: if more than one Dayspring page is open, only one speaks and listens, and the setup guide goes quiet once Dayspring's screen opens. Saying "stop" now stops the whole answer, and dismissing the wake-up stops the rest of the morning greeting.
- **No freezing**: slow checks (coding tools, Voicemeeter, photos, updates) now run in the background, a missing photo or course file can no longer stop Dayspring, and an unexpected error is logged instead of stopping the server.
- Dayspring now needs Node.js 22.13 or newer (the installer checks and offers to update it).

**New**
- **Pick your browser**: Dayspring uses your default browser, or any other browser on your computer (Edge, Chrome, Brave, Firefox, Opera, Vivaldi and more). Choose in the guided setup or in Settings → Screen. It no longer forces Microsoft Edge.
- **Automatic updates**: Dayspring checks for new versions when it starts and every few hours. A card shows what's new, with **Update now**, **Next time I open Dayspring**, **When I'm not using it** and **Not now**. You can also set it to always do one of these (Settings → Updates).
- **Safe updates**: your data and keys are backed up before every update and never replaced. If a new version doesn't start, the previous one comes back by itself.
- **What changed**: Settings → Updates lists every update with its notes. Or ask "what's new in Dayspring?"
- **Stopping Dayspring**: the ✕ at the top of the screen now offers **Close the screen** or **Quit Dayspring**. There's also **Stop Dayspring** in the Start menu.
- Say **"update Dayspring"** to install a new version right away.
- **A warm default voice**: until you pick one, Dayspring speaks with a friendly, warm female voice (Matilda with ElevenLabs, coral with OpenAI, and Edge's Ava, Jenny or Aria for free). The setup guide keeps its own warm male voice. A voice you already chose never changes.

**Updating from 1.0.0**: double-click **Update Dayspring.cmd** in the Dayspring folder once and type **Y**. Your data, keys and downloaded helpers carry over, and from then on updates come to you.

## 1.0.0 — first public release

**Getting started**
- A guided, spoken first-run setup (`/welcome`). A friendly guide voice walks through each step, with mute, repeat and captions. It covers:
  - AI choice (Claude, ChatGPT, Grok, Ollama or none) with step-by-step key walkthroughs
  - ElevenLabs or free voices
  - interests (pick from a list or type your own)
  - your week, permissions, a coding tool (Claude Code / Codex), apps, sound (Voicemeeter) and the screen
- An installer, a start launcher, update checks (GitHub releases) and a complete guide at `/help`.

**Your day**
- The Schedule app: day, week, month and year views. Drag to move or resize, importance levels, and live updates as the assistant makes changes.
- Repeating items: daily, every N days, weekdays, chosen days, every N weeks, monthly (a date or "the 2nd Tuesday"), yearly, with end dates. Change one day or every time.
- Reminders, a gentle wake-up alarm, snooze (buttons and "snooze 10 minutes"), morning rundowns and night mode.
- Study courses you add by link, with the next lesson and optional progress checks.

**Talking to it**
- A wake word, typed chat, and many commands that work without any AI.
- An optional AI brain: Claude, ChatGPT, Grok or Ollama, with web lookup, research, lists and results shown on screen.
- Voices: free Windows and Edge Natural voices, ElevenLabs (including your own library) and OpenAI.
- Awareness of what's on its own screen: "read me that quote".
- Documents read aloud, summarized and explained: Word, PDF, PowerPoint, Excel, CSV, OpenDocument, RTF and pictures of text.
- Files and folders: organize, open and save plans, all within the permissions you set.

**Your screen**
- The living sky: the real time of day, season, weather and wind, with landscapes, and a full vibe control panel.
- Fits any screen: size and margin controls, Fit to screen calibration, and automatic layouts that never spill.
- A hover window bar (minimize, maximize, hide, close, sound), keep-awake while plugged in, and a unified Sound panel with separate volumes.
- Discover: popular videos and articles about your interests, now and then.

**Music, calls and apps**
- Music inside Dayspring: Spotify (Premium) and YouTube with full controls, a queue, playlists and browsing.
- 🎧 Tune in: listens to calls in your headset and answers when called by name, even into the call (Voicemeeter).
- A Discord bot, phone texts through Phone Link, and connections to Google Calendar + Gmail, Outlook + Microsoft To Do, and Notion.
- Optional faith features: reading plan, prayer list, Scripture memory and church helpers.
