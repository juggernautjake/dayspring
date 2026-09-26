# FAQ

Quick answers to the questions people ask most. Each links to the full walkthrough. Can't find it? Try the search box at the top of this guide, ask Dayspring ("how do I…"), or see [Troubleshooting](troubleshooting.md).

## The basics

### What is Dayspring?
A friendly assistant and day planner that lives on a screen in your home: a spare monitor, a TV, or your laptop. It shows your day, reminds you of things, plays music, reads documents aloud, and answers when you talk to it. See [Getting started](getting-started.md).

### Is it really free?
Yes. Everything that runs on your computer is free: the schedule, reminders, the alarm, the free voices, music through your own Spotify and YouTube, documents read aloud, and many voice commands. Optional upgrades (an AI brain, premium voices) are paid directly to those companies. There's no Dayspring subscription.

### What do I need?
Windows 10 or 11, Google Chrome or Microsoft Edge, and an internet connection for setup. A microphone for voice is optional; you can type instead. The installer sets up Node.js for you. See [Installing](install.md).

### Do I need a TV?
No. Any screen works. See [Display setup](display-setup.md).

### Does it work on a Mac, Linux, a phone or a tablet?
Not yet: it runs on Windows. You can open the Dayspring screen from another device's browser only if you're a developer who changes the network settings, and that isn't supported.

### Does it need the internet?
For some things. The schedule, reminders and built-in commands work offline. Speech recognition in the browser, cloud AI, premium voices, weather, music, web lookup and the living sky's weather need a connection.

### How do I install it?
Download the latest `dayspring-x.y.z.zip` from the GitHub **Releases** page, unzip it, double-click **Install Dayspring.cmd**, then **Start Dayspring.cmd**. The guided setup takes it from there. See [Installing](install.md).

### How do I update it?
Say "check for updates", or double-click **Update Dayspring.cmd**. Updates never touch your data. See [Updating](updating.md).

### How do I uninstall it?
Delete the Dayspring folder, and its shortcuts if you like. See [Installing → Uninstalling](install.md#uninstalling).

## The guided setup

### Can I skip steps and come back later?
Yes. Everything except your name can be skipped, and every step is also in **Settings**. See [The guided setup](setup-wizard.md).

### The guide voice is too loud, or I don't want it
Press **🔇** on the setup page to mute it. The words stay on screen as captions. **↻** repeats the last thing it said.

### I closed the setup halfway
Just open Dayspring again. It picks up at the same step.

### How do I start the setup over?
Open `http://localhost:4747/welcome` and choose **Start over**.

## AI and voices

### Do I need an AI?
No. Without one, Dayspring is a capable scheduler with many built-in commands. An AI brain adds real conversation, planning help, research, document summaries and more. See [AI providers](ai-providers.md).

### Which AI should I pick?
If you're unsure, **Claude**. It's excellent at planning and reading documents, and can look things up online. ChatGPT is a good all-rounder, Grok is quick, and Ollama is free and private (it runs on your PC, but needs a fast computer).

### How much does an AI cost?
Usually a few dollars a month for everyday use. You buy prepaid credit (for example $5), so there are no surprise bills unless you turn on auto-reload. See [AI providers](ai-providers.md).

### I have ChatGPT Plus. Is that the same thing?
No. A ChatGPT Plus subscription is for the ChatGPT app. Dayspring uses the **API**, which is billed separately at platform.openai.com. See [AI providers → ChatGPT](ai-providers.md).

### It says my key isn't accepted
Usually the account has no credit yet, or the key was copied with a missing character. Add a little credit, make a new key, paste it and press **Test** again. See [Troubleshooting](troubleshooting.md).

### How do I change its voice?
Say "switch your voice to Rachel", or use the voice drop-down on the screen, or **Settings → Voice**. See [Voices](voices.md).

### How do I get the really natural voices for free?
Use **Microsoft Edge** for the Dayspring screen (Settings → Screen → Show the display in: Edge). Edge includes Microsoft's free "Natural" voices. See [Voices](voices.md).

### My ElevenLabs voices don't show up
Your ElevenLabs API key needs the **Voices: Read** permission. Edit the key on elevenlabs.io (or make a new one) with that permission turned on, then paste it into Settings → Voice. See [Voices → ElevenLabs](voices.md).

### Can I rename the assistant or change the wake word?
Yes: **Settings → Your assistant**.

### Can it call me by a nickname?
Yes. Add up to 30 in **Settings → You**, and it picks one now and then.

## Your schedule

### How do I add something?
Say "add dentist Tuesday at 3", type it, or click **+ Add** in the Schedule app. See [Your schedule](schedule.md).

### How do I make something repeat?
Say "add standup on weekdays at 9", or pick **Repeats** in the editor: every day, every other day, weekdays, chosen days, monthly, yearly and more. See [Your schedule → Repeating items](schedule.md#repeating-items).

### How do I change just one day of a repeating item?
Open it and choose **Just this day** (the default). Choose **Every time** to change them all.

### How do I snooze the alarm or a reminder?
Tap **💤** on the alarm or pop-up, or say "snooze" / "snooze 15 minutes". See [Your schedule → Snooze](schedule.md#snooze).

### Can it move everything later in the day for me?
Yes: "cut my free time to an hour and move everything up". Work, church, classes and meetings stay put. See [Your schedule](schedule.md).

### Will it wake me up?
If you turn on the alarm (the setup's **Your week** step, or say "turn on the alarm"), it rings at your first item of the day. Keep the computer plugged in so it stays awake overnight. See [Display setup → Keeping the screen awake](display-setup.md#keeping-the-screen-awake).

### Can it show my Google or Outlook calendar?
Yes. Connect them in **Settings → Apps**, and their events appear on your schedule (read-only). See [Connecting apps](connections.md).

## Talking to it

### Is it always listening?
While its screen is open, it listens for its name. Anything not addressed to it is ignored and never saved. **✋ Stop** pauses listening; **🔇 Text only** turns listening and speaking off. See [Privacy](privacy.md).

### It keeps hearing itself
Use headphones, or lower its voice volume in the **🔊 Sound** panel. It already ignores its own recent words. See [Troubleshooting](troubleshooting.md).

### What can I say to it?
Lots. See [Talking to Dayspring](talking-to-dayspring.md), or just ask "what can you do?"

### Can I type instead of talking?
Yes: press **⌨ Type** on the talk panel.

### Can it read me something that was on the screen?
Yes: "read me that quote", "what was that proverb?", "what's on the screen?". See [Talking to Dayspring](talking-to-dayspring.md#ask-about-whats-on-the-screen).

## Files, documents and apps

### Can it read my Word documents and PDFs?
Yes: Word (.docx and .doc), PDF, PowerPoint, Excel, CSV and more. "Read me the lease", "summarize my resume". See [Documents](documents.md).

### Will it change my files?
Only where you allow it in **Settings → Permissions**. It backs up every file before changing it, and deleting always asks and goes to the Recycle Bin. See [Permissions](permissions.md).

### Can it open programs?
If you allow programs in Permissions: "open Word", "open Discord". See [Files, programs and the browser](files-and-browser.md).

### Can it read my email?
Yes, if you connect Gmail or Outlook. It can search, read and write **drafts**; it never sends email. See [Connecting apps](connections.md).

### Can it send texts?
It announces texts and reads them to you (through Phone Link). Sending texts isn't available yet. See [Your phone](phone.md).

### How do I connect Spotify?
Make a free Spotify developer app (about 5 minutes; Premium needed for playing inside Dayspring) and paste its Client ID in Settings. See [Music and videos](music.md).

### Why do YouTube ads show?
Sign in to YouTube in Dayspring's music window with a YouTube Premium account. See [Music and videos](music.md).

### Can it hear my Discord calls?
Yes, with **🎧 Tune in**. It listens to what plays in your headset and answers when someone says its name. See [Tune in to calls](discord-calls.md).

## The screen

### Things are cut off on my TV
Use **📐 Fit to screen** (hover at the top of the screen, or say "fit to screen") and move each edge until its green line is visible. See [Display setup → Fit to screen](display-setup.md#fitting-dayspring-to-your-screen).

### Everything is too big or too small
Say "make everything smaller" or "bigger", or use **Settings → Screen → Size**.

### How do I minimize, hide or close the screen?
Move the mouse to the top edge. A bar with — □ 👁 ✕ appears. **Hide** keeps Dayspring listening; say "show yourself" to bring it back. See [Display setup → The window bar](display-setup.md#the-window-bar-minimize-maximize-hide-close).

### Can I change the background?
Yes. The living sky follows the real weather and time of day, and you can choose your own look with **🎨 Sky** or "make it rain", "switch to cozy mode". See [Display setup → The living sky](display-setup.md#the-living-sky).

### Can I turn off the faith features?
They're off unless you turn them on in **Settings → Features & apps**.

## Privacy and data

### Where is my data?
In the `data` folder inside Dayspring, on your computer. Keys are in `.env`. Nothing is uploaded to us, because there is no "us" server. See [Privacy](privacy.md).

### What gets sent to the AI company?
Only when you use the AI: your message, the recent conversation, today's plan and what the task needs (for example the parts of a document you asked about). See [Privacy](privacy.md).

### How do I back up my stuff?
Copy the `data` folder (and `.env` for your keys) to OneDrive or a USB drive. To move to a new PC, see [Installing → Moving to a new computer](install.md#moving-to-a-new-computer).

### Can more than one person use it?
It's built around one person's day. Others can talk to it, but it keeps one schedule.

## Still stuck?

### Something's wrong. Where do I start?
See [Troubleshooting](troubleshooting.md), then ask for help on GitHub with the **Help** issue template. Include what you did and what you saw, but no personal details.
