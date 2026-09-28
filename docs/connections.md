# Connecting apps

> **Where to connect apps:** Settings → **Apps & connections**. Every app below has a card there with its status, a step-by-step Set up drawer, Manage and Disconnect. On the Dayspring screen, open ⚙ Settings and click **🔌 Apps**.

This page lists everything Dayspring can connect to, how to set each one up, and what it can and can't do. Plugging something in never requires sharing a password with Dayspring. You sign in to each service yourself.

| App / service | What Dayspring can do | Setup | Guide |
|---|---|---|---|
| **Spotify** | Play songs, playlists and Liked Songs; pause and skip | Sign in once in the music window | [Music](music.md) |
| **YouTube** | Find and play videos and music; your playlists | Optional sign-in | [Music](music.md) |
| **Your phone** (iPhone or Android) | Announce and read texts, show notifications, draft replies | Microsoft Phone Link | [Your phone](phone.md) |
| **Claude, ChatGPT, Grok** | Conversation, planning, writing, web lookup | An API key | [AI providers](ai-providers.md) |
| **Ollama** | A free, private AI brain on your computer | Install Ollama | [AI providers](ai-providers.md#ollama-free-on-your-computer) |
| **ElevenLabs** | Natural, expressive voices | An API key | [Voices](voices.md#elevenlabs-the-most-natural) |
| **OpenAI voices** | Natural voices | An OpenAI key | [Voices](voices.md#openai-voices) |
| **Claude Code** | Coding and writing jobs, changes to Dayspring itself | Install and sign in | [Claude Code](claude-code.md) |
| **Your files and folders** | Search, read, and (if allowed) write | Permissions | [Files and browser](files-and-browser.md) |
| **Programs on your computer** | List and open them | Permissions | [Permissions](permissions.md#programs) |
| **Websites** | Look things up; use sites in Dayspring's browser | Permissions | [Files and browser](files-and-browser.md) |
| **Your photos** | Show photos and remember what they are | Choose folders | [Photos](photos.md) |
| **Weather** | Forecast on screen and in the rundown | Your town (Settings) | Free, no key |
| **Voicemeeter** | Music on several speakers at once | Optional install | [Sound](audio-devices.md) |
| **Notion** | Search, read, create pages, add notes | A Notion token | [Notion](#notion) |
| **Google Calendar + Gmail** | Your calendar on the schedule, add events, read and write mail (sending only with your OK); several Google accounts at once | Your own Google sign-in client (once) | [Google](#google-calendar--gmail) |
| **Yahoo, iCloud, AOL and any other email** | Read, search and write email in the Mail window (sending only with your OK) | An app password | [Email](email.md) |
| **Google Drive** | Search, read and play your Drive files; upload and organise with your yes | The same Google client, plus the Drive API | [Google Drive](google-drive.md) |
| **Outlook + Microsoft To Do** | Your calendar on the schedule, add events, read and write mail (sending only with your OK), To Do tasks | A small Microsoft app registration (once) | [Outlook](#outlook--microsoft-to-do) |
| **Calendar subscriptions** (iCloud, school, teams, holidays) | Any .ics / webcal calendar on the schedule, read-only | Paste the link | [Calendar subscriptions](#calendar-subscriptions-icloud-school-teams-holidays) |
| **News and RSS feeds** | Headlines by topic, local news, any site's feed | Pick a topic or paste a feed | [News](#news-and-rss-feeds) |
| **Home Assistant** (and the smart-home brands it connects) | Lights, plugs, thermostats, scenes, sensors, locks and garage doors (with a yes first) | Address + a long-lived token | [Home Assistant](#home-assistant-smart-home) |
| **IFTTT, Zapier, Make, n8n** | Say a phrase to start a web action; let other things make Dayspring speak or add reminders | Paste a webhook link | [Webhooks](#webhooks-ifttt-zapier-make-n8n) |
| **Todoist** | List, add and complete tasks | A Todoist API token | [Todoist](#todoist) |
| **Severe weather alerts** | Official NWS warnings in the U.S.; a forecast heads-up elsewhere | Your town (Settings), on by default | [Weather alerts](#severe-weather-alerts) |

Connect any of these in **Settings → Apps** (or during setup). Each card has the full walkthrough, a button that opens the right page, and a Connect button. Everything you paste stays on this computer, in Dayspring's data folder.

## Notion

1. Open [Notion's developer portal](https://www.notion.so/developers) and sign in.
2. Choose **Personal access tokens** → **New token**, name it "Dayspring", allow reading, updating and inserting content, and create it. (Or make a **New integration** if you'd rather it only see pages you share with it.)
3. Copy the token (it starts with `ntn_`; Notion shows it once) and paste it in **Settings → Apps → Notion** → **Connect**.
4. Using an integration instead? On each page Dayspring should see: **•••** (top right) → **Connections** → pick **Dayspring**.

Things you can say: "search Notion for groceries", "read my Trip plan page", "add eggs to my Groceries page", "make a Notion page called Ideas under Projects".

## Google Calendar + Gmail

Google asks every app to use its own sign-in "client", so you create one, free, once (about 10 minutes):

1. [Create a Google Cloud project](https://console.cloud.google.com/projectcreate) named "Dayspring" with the Google account you use for Calendar and Gmail.
2. Enable the [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com), the [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com) and, for Drive, the [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com). Under **Data Access**, add the Calendar, Gmail and Drive scopes (see [Google Drive](google-drive.md) for which).
3. In [Google Auth Platform](https://console.cloud.google.com/auth/overview): **Get started**, app name "Dayspring", your email for support and contact, **Audience: External**.
4. **Audience** → **Test users** → add your own Gmail address (and every other Google account you'll connect), then **Publish app**. (While an app is "Testing", Google signs you out every 7 days.) Google will call it unverified. That's expected for a personal app.
5. **Clients** → **Create client** → **Desktop app** → name "Dayspring" → **Create**. Copy the **Client ID** and **Client secret** into **Settings → Apps → Google** and press **Connect**.
6. Sign in on the page that opens. At "Google hasn't verified this app", click **Advanced → Go to Dayspring (unsafe)**. It's your own app. Allow the permissions. You'll see "Connected".

Your Google events then appear on Dayspring's schedule in their own colours, next to everything else, and Dayspring checks them for clashes (see [All your calendars in one place](schedule.md#all-your-calendars-in-one-place) and [Conflicts](schedule.md#conflicts)). Dayspring changes a Google event only when you say yes, for example to move it or decline an invitation. You can also put your Dayspring schedule on Google Calendar, which is off until you turn it on. Things you can say: "what's on my Google calendar tomorrow", "check my email", "read the email from Pat", "put the dentist on my Google calendar Friday at 3", "draft a reply saying I'll be there".

**Email is sent only with your OK.** Gmail shows in Dayspring's Mail window (see [Email](email.md)). Dayspring sends only after you turn on **Let Dayspring send email from this mailbox** in Settings → Email (Google asks you once for the `gmail.send` permission), and then only when you press **Send** in the editor, or say yes after Dayspring reads back who it's to and the subject.

**Several Google accounts.** Press **Add another Google account** to connect a work and a personal account at once. Each one has its own Calendar, Gmail and Drive switches and an optional nickname ("Work"), and one is the primary: Calendar and Gmail use it unless you name another ("check my work email"). Removing one leaves the others. Your first account became account 1 automatically, with the same access. The sign-ins are encrypted with your Windows account. Drive (search, read, play, and changes only with your yes) is on its own page: [Google Drive](google-drive.md).

## Outlook + Microsoft To Do

Microsoft needs a small app registration, free, once (about 10 minutes):

1. Open [App registrations](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) in the Microsoft Entra admin center and sign in. With a personal Outlook.com/Hotmail account you first need a free directory: if it says you have none, create a free Azure account (no charge for this) and come back.
2. **New registration** → name "Dayspring" → **Accounts in any organizational directory and personal Microsoft accounts**.
3. Redirect URI: platform **Public client/native (mobile & desktop)**, value `http://localhost:4747/oauth/microsoft` (use your Dayspring port if you changed it).
4. **Register**, copy the **Application (client) ID** into **Settings → Apps → Outlook**, and press **Connect**. Sign in and accept. No client secret is needed.

Your Outlook events then appear on the schedule next to everything else, and are checked for clashes (see [All your calendars in one place](schedule.md#all-your-calendars-in-one-place) and [Conflicts](schedule.md#conflicts)). To Do items with a due date show in the all-day row. Dayspring changes an Outlook event only when you say yes, and it can put your Dayspring schedule on Outlook (off until you turn it on). Things you can say: "what's on my Outlook calendar today", "check my Outlook email", "what's on my To Do list", "add call the bank to my To Do", "mark buy stamps done". Outlook mail shows in Dayspring's Mail window; it's sent only after you turn on sending in Settings → Email (Microsoft asks once for `Mail.Send`), and then only when you press **Send** or say yes to the read-back. See [Email](email.md). The sign-in is encrypted with your Windows account.

**Other email (Yahoo, iCloud, AOL and the rest).** These connect with an app password in **Settings → Email**; see [Email](email.md) for each provider.

### iCloud

Share an iCloud calendar as a public link and subscribe to it: see [Calendar subscriptions](#calendar-subscriptions-icloud-school-teams-holidays). That shows it on the schedule, read-only. Dayspring can't add events to iCloud. With **Browser control** on and an AI brain, Dayspring can also open iCloud.com in its browser (you sign in once) and read it when you ask.

## Calendar subscriptions (iCloud, school, teams, holidays)

Any calendar with a subscribe link (`.ics`, "iCal", or `webcal://`) can show on Dayspring's schedule. Examples are a school or district calendar, your kid's league (TeamSnap, GameChanger, SportsEngine), church events, holidays, or an iCloud or Google calendar you don't want to fully connect. They're read-only, and you can add as many as you like.

1. **Get the link.**
   - **School, team, church:** look for **Subscribe**, **Sync to calendar**, **iCal** or **Export**. Right-click it and choose **Copy link address**.
   - **iCloud on iPhone:** Calendar → **Calendars** → tap ⓘ next to the calendar → turn on **Public Calendar** → **Share Link** → **Copy**.
   - **iCloud on a Mac:** right-click the calendar → **Share Calendar** → tick **Public Calendar** → copy the link.
   - **Google Calendar:** [Settings](https://calendar.google.com/calendar/r/settings) → click the calendar → **Integrate calendar** → **Secret address in iCal format**.
   - **Outlook.com:** Settings → Calendar → **Shared calendars** → **Publish a calendar** → **Can view all details** → **Publish** → copy the **ICS** link.
2. Open **Settings → Apps → Calendar subscriptions**. Paste the link, give it a short name ("Soccer"), and press **Connect**. Dayspring checks the link and the events appear right away.
3. Or just say "subscribe to this calendar" and paste the link into the chat.

Subscriptions refresh every 30 minutes, and each one gets its own colour on the schedule and is checked for clashes (see [All your calendars in one place](schedule.md#all-your-calendars-in-one-place)). Events set in another time zone are converted to yours. Repeating events (weekly practice, monthly meetings) and cancelled single dates are handled. A public or secret link lets anyone who has it see that calendar, so share only the calendar you want. To remove one subscription, use its remove button in Settings → Apps (behind the scenes that's `POST /api/connect/ics/remove` with `{"id": "<its name>"}`). **Disconnect** removes them all.

## News and RSS feeds

Say **"what's the news"**, **"any science news"**, **"read me the latest from tech"**, or **"local news"**.

1. Open **Settings → Apps → News**.
2. Type a **topic** and press **Connect**:
   - `top`, `world`, `nation` (U.S.), `business`, `tech`, `science`, `health`, `sports`, `entertainment` or `faith`
   - `local`, which uses your town from Settings → Where you are
   - any words, such as "Kansas City Chiefs" or "SpaceX"
3. **Or paste a feed link.** Most sites, blogs, podcasts and YouTube channels have an RSS or Atom feed (often `/feed`, `/rss` or `/rss.xml`).
4. Add as many as you want. "What's the news" reads from all of them. "Read me the latest from ⟨name or topic⟩" reads one.

With no feeds added, "what's the news" still reads the top stories. Topic feeds come from Google News and well-known outlets: NPR, BBC, Ars Technica, The Verge and ScienceDaily. Feeds are fetched at most every 20 minutes. Your feeds also feed the **Discover** page.

## Home Assistant (smart home)

[Home Assistant](https://www.home-assistant.io/) is the free hub that connects nearly every smart-home brand: Philips Hue, Govee, TP-Link/Kasa, Ecobee, Nest, Ring, Z-Wave, Zigbee, garage openers and more. Connect Dayspring to it once and you can control all of them by voice.

1. Open Home Assistant, usually `http://homeassistant.local:8123` or its IP address, and sign in.
2. Click your **name** at the bottom left, then open the **Security** tab.
3. **Long-lived access tokens** → **Create token** → name it "Dayspring" → **OK**. Copy the token now, because it's shown only once.
4. In **Settings → Apps → Home Assistant**, paste the address and the token, then press **Connect**. Dayspring checks them and says your home's name.

Things you can say:

- "turn off the kitchen lights" or "turn the fan on"
- "set the thermostat to 70"
- "is the garage door closed?" or "is the front door locked?"
- "what's the temperature in the nursery"
- "run the movie night scene"

With an AI brain, you can also ask "which lights are on?" or "dim the bedroom to 30%".

**Safety:** unlocking a lock, opening a garage door or gate, and disarming an alarm always ask **"Just to be sure…?"** first. They happen only after your clear yes, and never from a no-AI phrase. The token can do whatever its Home Assistant user can. To limit that, create a separate non-admin user for Dayspring and make the token there.

Dayspring finds devices by their Home Assistant names, so friendly names such as "Kitchen lights" work best. Dayspring must be able to reach Home Assistant on your network. A Home Assistant Cloud (Nabu Casa) address also works.

## Webhooks (IFTTT, Zapier, Make, n8n)

Webhooks connect Dayspring to almost anything else.

### Outgoing: say a phrase, something happens

1. **Build the other side first.**
   - **IFTTT** (Webhooks needs IFTTT Pro): make an applet whose trigger is **Webhooks → Receive a web request**, with an event name like `leaving_home`. Your link is `https://maker.ifttt.com/trigger/leaving_home/json/with/key/YOUR_KEY`. The key is on the [Webhooks](https://ifttt.com/maker_webhooks) service's **Documentation** page.
   - **Zapier** (Webhooks by Zapier is on paid plans): make a Zap with the trigger **Webhooks by Zapier → Catch Hook**, and copy the hook URL.
   - **Make:** add a **Webhooks → Custom webhook** module and copy its address.
   - **n8n:** add a **Webhook** node (POST) and copy its production URL.
2. In **Settings → Apps → Webhooks**, fill in:
   - an action **name** ("Leaving home")
   - the **exact phrase** you'll say ("I'm leaving")
   - the **link**

   Then press **Connect**.
3. **Try it.** Say the phrase exactly, or with an AI brain say "run leaving home". Dayspring POSTs JSON with `source`, `at`, and any values the AI adds. IFTTT uses `value1`–`value3`.

The phrase must match exactly, so ordinary conversation never triggers it by accident.

### Incoming: other things make Dayspring speak or remind you

Dayspring has a private address, shown in Settings → Apps → Webhooks:

```
POST http://127.0.0.1:4747/api/hooks/<secret>
{"say": "The laundry is done"}                        → Dayspring says it (and shows it)
{"title": "Doorbell", "say": "Someone's at the door"} → with a title on screen
{"remind": "Take the bread out", "minutes": 20}       → a reminder in 20 minutes
{"remind": "Call Mom", "at": "2026-10-01T18:30"}      → a reminder at that time
```

A wrong secret gets "not found." Anyone who has the address can make Dayspring speak, so keep it private.

### Incoming webhooks from the internet

Dayspring listens on **this computer only** (`127.0.0.1`), and it refuses anything that arrives through its phone tunnel except Twilio. That's deliberate. So incoming webhooks work from programs on this computer: a script, Windows Task Scheduler, or a local n8n or Node-RED.

Cloud services (IFTTT, Zapier, Make) and other devices can't reach it yet. Allowing that means running a tunnel you control (Cloudflare Tunnel, Tailscale Funnel or ngrok) that forwards **only** `/api/hooks/` to port 4747. It also needs a one-line change to the tunnel rule in `server.mjs` to let `/api/hooks/` through. Do it only if you understand that the secret address is then the only thing protecting it.

## Todoist

1. Open Todoist in a browser: **Settings → Integrations → [Developer](https://app.todoist.com/app/settings/integrations/developer)**. The Todoist app has the same place.
2. Copy your **API token** (40 letters and numbers).
3. Paste it into **Settings → Apps → Todoist** and press **Connect**. Dayspring says how many projects it sees.

Things you can say:

- "what's on my Todoist"
- "add buy milk to Todoist for tomorrow"
- with an AI brain: "mark call the dentist done in Todoist" or "what's due today in my Work project?"

Tasks with a due date also show on the schedule: in the all-day row, or at their time if they have one. They never count as clashes. See [All your calendars in one place](schedule.md#all-your-calendars-in-one-place).

Todoist's own date phrases work, such as "every Friday" or "tomorrow 5pm". The token can change all your Todoist tasks. If it's ever exposed, use **Issue a new API token** in Todoist.

## Severe weather alerts

Weather alerts are on as soon as your town is set in **Settings → Where you are**.

- **In the United States:** the official [National Weather Service](https://www.weather.gov/) alerts for your location, such as tornado, severe thunderstorm, flash flood, winter storm, heat and fire weather warnings and watches.
- **Elsewhere:** a heads-up from the forecast (Open-Meteo) when thunderstorms, freezing rain, very strong gusts, very heavy rain, or extreme heat or cold are due in the next 12 hours. It's clearly labeled **not an official warning**.

Dayspring checks every 10 minutes and announces each new alert once, out loud and on screen:

- Minor alerts are only listed.
- At most one alert is spoken every 30 minutes, unless it's extreme.
- From 10 p.m. to 7 a.m., only severe and extreme alerts are spoken.

Ask any time: "any weather alerts?" To turn them off, press **Disconnect** in Settings → Apps → Weather alerts.

This is an extra, not a replacement for your phone's emergency alerts or a weather radio.

## More ideas

See [integrations-ideas.md](integrations-ideas.md) for other hookups that are possible, such as Slack, Trello, Strava, Plex, Hue and Tesla, with how each could work.

## Discord

Two optional ways to have Dayspring in Discord:

- **[Discord bot](discord-bot.md):** Dayspring joins your **server's** voice channels as its own member, answers out loud when someone says its name, and answers in text chat when @mentioned. Everyone can see it's there.
- **[Dayspring in your calls](discord-calls.md):** Dayspring listens through your headset and talks through your mic, in any call including DMs.

## Teams, Zoom, games and other programs

Dayspring doesn't control the inside of these apps. It can:

- **open** them ("open Discord"), with the Programs permission
- open **links** to them in your browser
- stay out of their way: it never changes the Windows default speaker or microphone, so these apps keep their own audio devices. See [Sound](audio-devices.md#keeping-other-apps-on-the-right-devices).

## Optional keys for extras

These go in Settings → **Keys** (or `.env`). All are optional.

| Key | What it adds | Where to get it |
|---|---|---|
| `YOUTUBE_API_KEY` | Faster, more precise YouTube searches ("find a recent popular video on…") | [Google Cloud Console](https://console.cloud.google.com): create a project → **APIs & Services → Library** → enable **YouTube Data API v3** → **Credentials → Create credentials → API key** |
| `ESV_API_KEY` | The English Standard Version for Bible reading | [api.esv.org](https://api.esv.org) → create an account → **API Keys** (free for personal use) |
| `NLT_API_KEY` | The New Living Translation | [api.nlt.to](https://api.nlt.to) → request a key (free) |

Without them, Dayspring searches YouTube the way a person would, and offers the KJV, WEB, ASV, Darby, Young's Literal, BBE and others offline.
