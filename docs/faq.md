# FAQ

Quick answers to the questions people ask most. Each links to the full walkthrough. Can't find it? Try the search box at the top of this guide, ask Dayspring ("how do I…"), or see [Troubleshooting](troubleshooting.md).

## The basics

### What is Dayspring?
A friendly assistant and day planner that lives on a screen in your home: a spare monitor, a TV, or your laptop. It shows your day, reminds you of things, plays music, reads documents aloud, and answers when you talk to it. See [Getting started](getting-started.md).

### Is it really free?
Yes. Everything that runs on your computer is free: the schedule, reminders, the alarm, the free voices, music through your own Spotify and YouTube, documents read aloud, and many voice commands. Optional upgrades (an AI brain, premium voices) are paid directly to those companies. There's no Dayspring subscription.

### What do I need?
Windows 10 or 11, a web browser (Edge comes with Windows; Chrome, Brave, Firefox and others work too), and an internet connection for setup. A microphone for voice is optional; you can type instead. The installer sets up Node.js for you. See [Installing](install.md).

### Do I need a TV?
No. Any screen works. See [Display setup](display-setup.md).

### Does it work on a Mac, Linux, a phone or a tablet?
Not yet: it runs on Windows. You can open the Dayspring screen from another device's browser only if you're a developer who changes the network settings, and that isn't supported.

### Does it need the internet?
For some things. The schedule, reminders and built-in commands work offline. Speech recognition in the browser, cloud AI, premium voices, weather, music, web lookup and the living sky's weather need a connection.

### How do I install it?
Click [Download Dayspring](https://github.com/juggernautjake/dayspring/releases/latest/download/Dayspring.zip) (no GitHub account needed), unzip it, double-click **Install Dayspring.cmd**, then the **Dayspring** icon on your desktop. The guided setup takes it from there. See [Installing](install.md).

### How do I update it?
You don't have to: Dayspring checks for new versions by itself and shows what's new, with **Update now**, **Next time I open Dayspring** and **When I'm not using it**. You can also say "check for updates", or double-click **Update Dayspring.cmd**. Updates never touch your data, and a new version that doesn't start is undone by itself. See [Updating](updating.md).

### Which browser does it use? Can I use Brave, Firefox or Opera?
Your default browser, unless you pick another in the guided setup or in **Settings → Screen → Which browser shows Dayspring?** (or say "use Brave for Dayspring"). The list shows every browser on your computer: Edge, Chrome, Brave, Firefox, Opera, Vivaldi and more. The choice is used for every way Dayspring opens and for Pop out; **Reopen now** switches straight away. Edge, Chrome, Brave and Vivaldi give Dayspring its own window; Firefox does too; others open a normal window.

### Does it work in Brave?
Yes, fully. Brave has no built-in speech recognition, so Dayspring listens with its own private recognizer that runs on your computer (a one-time download of about 200 MB, offered the first time). If music or a sign-in is blocked, lower Brave's **Shields** for `localhost`. See [Display setup → Using Dayspring with Brave](display-setup.md#using-dayspring-with-brave).

### What's the difference between the browser version and the app window?
None inside: it's the same Dayspring page, with the same voice, schedule and settings. The **app window** has no address bar or tabs, its own taskbar icon, and its own profile, so the microphone is allowed once and stays allowed. A **browser tab** sits with your other tabs; the browser may ask for the microphone, and sound may need one click on the page. **Full screen** is the TV view, and **Dayspring mini** is a small window for a corner of your desktop. Choose in **Settings → Screen → How Dayspring opens**, or say "open Dayspring in my browser", "open in its own window", "go full screen" or "make Dayspring small". See [Display setup → Opening Dayspring](display-setup.md#opening-dayspring-app-window-compact-full-screen-or-browser-tab).

Gmail, Bing, Yahoo and Google are websites, not browsers, so they aren't in the list. (Gmail is email, and Bing, Yahoo and Google are search sites. You can use any of them inside whichever browser you pick.)

### Dayspring opened several windows, and black command windows kept popping up
That was a bug in version 1.0.0, fixed in 1.0.1. Double-click **Update Dayspring.cmd** in the Dayspring folder and type **Y**. From then on Dayspring runs quietly in the background, never opens itself twice, and keeps itself up to date.

### What is Lantern? Do I need it?
Lantern is a free learning app from the same family as Dayspring. You don't need it. If you have both, Dayspring shows your courses and next lesson, opens lessons when you ask, reads out course invitations and friend requests, and the two never talk over each other. Dayspring can even install it for you: say "install Lantern". See [Dayspring and Lantern](lantern.md).

### Someone sent me a course on Lantern, but I only have Dayspring
Go to **Settings → Lantern** and connect with the email they invited: sign in with a password (or **Create an account**), or press **Email me a sign-in link** and open that email on this computer. If Dayspring asks for the hub, paste the address and public key they gave you. Dayspring then tells you about the invitation and offers to install Lantern. See [Dayspring and Lantern](lantern.md#connecting-before-lantern-is-installed).

### The Lantern email has a link, not a code
That's normal. Press the link in the email on the same computer as Dayspring: it opens a Dayspring page that connects you and goes back to Settings. Opened it on your phone by mistake? Ask for a new link and open it on the computer, or sign in with a password instead. A 6-digit code only comes on hubs whose owner set up their own email sender.

### How do I stop it completely?
Move the pointer to the top edge of the Dayspring screen, press **✕**, then **Quit Dayspring**. Or double-click **Stop Dayspring.cmd**, or press **Stop all** in **Settings → About**. See [Installing → Stopping Dayspring](install.md#stopping-dayspring).

### How do I find and close Dayspring in Task Manager?
Press **Ctrl+Shift+Esc**. Dayspring is listed as **Dayspring** (with **Dayspring Server** under it). Its helpers are **Dayspring Speech**, **Dayspring Notifications**, **Dayspring Keep Awake** and **Dayspring Audio Capture**, and the Dayspring window shows under its browser (Edge, Chrome…). Ending **Dayspring** stops the server too. Easier: **Settings → About → Running parts** lists them all, and **Stop all** ends every one of them and nothing else. See [Troubleshooting → What's running](troubleshooting.md#whats-running).

### I closed Dayspring and it opened again by itself
From 1.2.0, when you close it, it stays closed. It only reopens itself if you turn on **Settings → Screen → Keep the Dayspring screen open** (meant for a TV). If Dayspring starts with Windows, it starts hidden unless you turn on **Open the screen when Windows starts**.

### Does the alarm ring if I close the Dayspring window?

Yes, from version 1.2.1. With no Dayspring screen open, the alarm shows a larger card at the top-right of your screen, in front of every window, and rings until you press **Snooze 9 min** or **Dismiss** (or answer it anywhere else). It uses your default speakers at your alarm volume. See [Quiet mode and notifications](quiet-and-notifications.md).

### Can I make it stop listening, or be quiet for a while?
Yes. Click the coloured badge on its screen and choose **Quiet** (hears its name but says nothing) or **Off** (not listening at all; alarms still ring). **Ctrl+Alt+Shift+D** turns it off and on from anywhere. See [Compact mode, quiet mode and notifications](quiet-and-notifications.md).

### How do I uninstall it?
Open **Settings → About → Uninstall Dayspring…** (or **Uninstall Dayspring** in the Start menu). Choose whether to keep your data, and type your name to confirm. See [Installing → Uninstalling](install.md#uninstalling-dayspring).

### Does it work on Windows 10?
Yes: Windows 10 version 1809 or newer, or Windows 11, 64-bit. Everything it needs comes with Windows except Node.js, which the installer sets up.


### What can Dayspring do without an AI brain?

A lot: timers (up to 7, each with a name), alarms and reminders, your schedule, recipes and step-by-step cooking, the Bible, the weather, music, math and conversions, lists and notes, jokes, games and quick facts. See [Using Dayspring without AI](using-without-ai.md) for the full list. When it isn't sure what you meant, it offers up to 7 choices; say the number.

### How many timers can I set?

Seven at once. Each gets a name ("pasta", "laundry"), or Dayspring asks what it's for. See [Using Dayspring without AI → Timers](using-without-ai.md#timers).

### Can Dayspring find recipes and help me cook?

Yes. Say "find a recipe for chili", pick one of the 6 cards, and say "let's make it". Cooking mode shows big text, keeps the screen awake, and you say "next" to move on. See [Recipes and cooking](recipes-and-cooking.md).

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
Use **Microsoft Edge** for the Dayspring screen (Settings → Screen → Which browser shows Dayspring? → Microsoft Edge). Edge includes Microsoft's free "Natural" voices. See [Voices](voices.md).

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

### Do I need a YouTube API key?
No. YouTube search and playback work with no key. A key is optional and only makes searches a little faster. See [Music and videos](music.md#do-i-need-a-youtube-api-key).

### A browser window with YouTube keeps opening. How do I stop it?
Update to Dayspring 1.1.1 or newer (it updates itself; or Settings → Updates → **Check now**). Older versions searched YouTube in a visible browser window for the Discover feed. Now searching happens in the background with no window, and videos play inside Dayspring. To watch one in your browser, press **↗ Pop out**.

### Why do YouTube ads show?
Sign in to YouTube in Dayspring's music window with a YouTube Premium account. See [Music and videos](music.md).

### Can it hear my Discord calls?
Yes, with **🎧 Tune in**. It listens to what plays in your headset and answers when someone says its name. See [Dayspring in calls](discord-calls.md).

### Does it work in Zoom, Google Meet or Teams?
Yes. Tune in works with any call app, with no bot or add-on. For people to hear Dayspring, set the app's **microphone** to **Voicemeeter Out B1** and keep its **speaker** on your headset. **Settings → Calls** shows the exact names for each app, or ask "Dayspring, what mic should Zoom use?". See [The two settings each call app needs](discord-calls.md#the-two-settings-each-call-app-needs).

### Can my friends chat with Dayspring on Discord?
Yes, with the [Discord bot](discord-bot.md): @mention it, start a message with "Dayspring", use `/ask` or `/joke`, or talk in its own channel. Friends get fun and quick answers; your schedule, files and texts stay private unless you turn on **Share my schedule with Discord**.

### How fast does it answer on a call?
Usually a second or so after the question ends. **Settings → Calls → Speed** shows the last 10 answers. See [How quickly it answers](discord-calls.md#how-quickly-it-answers).

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

## XP and badges

### What is XP, and how do I earn it?
Points for things you really did: tell Dayspring "I finished my workout", "I did the dishes" or "I studied for an hour", or answer when it asks at the end of a scheduled block. It asks one quick question so it counts (for studying: one thing you learned). At most 80 a day. See [XP and badges](xp.md).

### Why did my check-in only get 70%?
Check-ins you start yourself count 70%. Put the task on your schedule and check in when the block ends (or finish a Dayspring focus timer) and it counts in full. See [XP and badges](xp.md#what-things-are-worth).

### What are badges?
18 badges in each of 18 kinds of habit (Fitness, Prayer, Reading, Cooking, Service…), collected over years of steady effort. The first comes within about a week. Open **Progress → Badges**, or say "what badges do I have?". See [Badges](xp.md#badges).

### Why can't I see what my next badge looks like?
It's a surprise: the next one shows as a **?** card with how close you are. You see it the moment you earn it, when it flips in like a coin.

### Can I change the name on my badges?
Yes: **Progress → Badges → Badge settings → Name on badges** (your name, your nickname, or none), then **Update the names on my badges**.

### How do I stop the badge reminders?
Say "stop badge reminders", or turn them off in **Badge settings** (for everything or just some categories). They're never spoken while Dayspring is Off or Quiet, on a call, or while an alarm rings.

### Does my Lantern learning count?
Yes, automatically, once per lesson, exercise or practice session that Lantern has verified, even if you did it on another computer. It fills your Study & Learning badges. See [Learning in Lantern](xp.md#learning-in-lantern).

### I studied a lot today but my balance stopped going up
At most 80 XP a day can be added to what you spend (so a secret character always takes at least a week). Everything past that still counts toward your level, your badges and your lifetime total.

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
