// Step-by-step walkthroughs for connecting other apps, as data: the onboarding page and Settings show them, the guide
// voice reads them, and docs/connections.md says the same thing. Checked against the providers' own docs (Sept 2026).
// Each guide: { id, name, icon, what, needs, time, steps: [{ text, link?, linkLabel?, copy? }], fields: [{ key, label, secret?, placeholder }], notes: [] }
const PORT = () => process.env.PORT || 4747;
export const redirectUri = (name) => (name === "microsoft" ? `http://localhost:${PORT()}/oauth/microsoft` : `http://127.0.0.1:${PORT()}/oauth/${name}`);

export function guides() {
  return [
    {
      id: "notion", name: "Notion", icon: "🗒",
      what: "Dayspring can search your Notion pages, read them to you, create new pages and add notes to existing ones.",
      needs: "A free Notion account.", time: "About 3 minutes",
      steps: [
        { text: "Open Notion's developer page and sign in with your Notion account.", link: "https://www.notion.so/developers", linkLabel: "Open Notion's developer portal" },
        { text: "Choose “Personal access tokens” (or a new internal integration, if you'd rather it only see pages you share with it)." },
        { text: "Click “New token”, name it “Dayspring”, tick the Notion API capability (read content, update content, insert content), and create it." },
        { text: "Copy the token. It starts with “ntn_”. Notion shows it only once." },
        { text: "Paste it below and press Connect. Dayspring checks it right away." },
        { text: "Using an integration instead of a personal token? Open each page you want Dayspring to see, click ••• at the top right → Connections (or “Add connections”) → pick “Dayspring”. Pages inside it are included." },
      ],
      fields: [{ key: "token", label: "Notion token", secret: true, placeholder: "ntn_…" }],
      notes: ["A personal access token can see what you can see in that workspace. An integration sees only pages you connect to it.", "Your token stays on this computer (Dayspring's data folder)."],
    },
    {
      id: "google", name: "Google Calendar + Gmail", icon: "📅",
      what: "Your Google Calendar shows on Dayspring's schedule, and Dayspring can add events, find and read your emails, and write drafts (it never sends an email without your clear yes).",
      needs: "A Google account. Google makes every app use its own sign-in “client”, so you create one (free) in Google Cloud once.", time: "About 10 minutes, once",
      steps: [
        { text: "Open the Google Cloud console and sign in with the Google account you use for Calendar and Gmail. Accept the terms if it asks.", link: "https://console.cloud.google.com/projectcreate", linkLabel: "Create a Google Cloud project" },
        { text: "Name the project “Dayspring” and click Create. Make sure it's the selected project (top bar)." },
        { text: "Turn on the two APIs Dayspring uses: Google Calendar API and Gmail API (click Enable on each).", link: "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com", linkLabel: "Enable Calendar API" },
        { text: "Now the Gmail API.", link: "https://console.cloud.google.com/apis/library/gmail.googleapis.com", linkLabel: "Enable Gmail API" },
        { text: "Set up the consent screen: Google Auth Platform → Get started (or Branding). App name “Dayspring”, your email as the support and contact email, Audience: External. Save.", link: "https://console.cloud.google.com/auth/overview", linkLabel: "Open Google Auth Platform" },
        { text: "Audience: under Test users, click Add users and add your own Gmail address. Then click “Publish app” and confirm (this keeps you signed in; in Testing mode Google signs you out every 7 days). Google will call it unverified; that's expected for your own personal app.", link: "https://console.cloud.google.com/auth/audience", linkLabel: "Open Audience" },
        { text: "Clients → Create client. Application type: Desktop app. Name: Dayspring. Create.", link: "https://console.cloud.google.com/auth/clients", linkLabel: "Open Clients" },
        { text: "Copy the Client ID and the Client secret from the box that appears (or download the JSON) and paste both below. Then press Connect." },
        { text: "Google opens a sign-in page. Pick your account. You'll see “Google hasn't verified this app”: click Advanced → Go to Dayspring (unsafe) (it's your own app), tick the permissions, and Continue. You'll land back on a Dayspring page that says Connected." },
      ],
      fields: [{ key: "clientId", label: "Client ID", placeholder: "…apps.googleusercontent.com" }, { key: "clientSecret", label: "Client secret", secret: true, placeholder: "GOCSPX-…" }],
      notes: [
        "Dayspring asks Google for: your calendars (read and add events), reading Gmail, and creating drafts. It never sends email by itself.",
        "Everything stays between this computer and Google; the keys and sign-in live in Dayspring's data folder.",
        "Only you use this client, so Google's app review isn't needed (personal apps may have up to 100 users).",
      ],
    },
    {
      id: "microsoft", name: "Outlook + Microsoft To Do", icon: "📬",
      what: "Your Outlook calendar shows on Dayspring's schedule, and Dayspring can add events, find and read your emails, write drafts (never sending without your yes), and read and add Microsoft To Do tasks.",
      needs: "A Microsoft account (Outlook.com, Hotmail, or work/school). Microsoft needs you to register a small app once, in a free Microsoft Entra directory.", time: "About 10 minutes, once",
      steps: [
        { text: "Open the Microsoft Entra admin center and sign in. With a personal account (Outlook.com/Hotmail) you'll first need a free directory: if it says you have none, create a free Azure account at azure.microsoft.com/free (no charge for this) and come back.", link: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade", linkLabel: "Open App registrations" },
        { text: "Click “New registration”. Name: Dayspring." },
        { text: "Supported account types: “Accounts in any organizational directory and personal Microsoft accounts”." },
        { text: `Redirect URI: choose the platform “Public client/native (mobile & desktop)” and enter: ${redirectUri("microsoft")}`, copy: redirectUri("microsoft") },
        { text: "Click Register. On the app's Overview page, copy the “Application (client) ID” and paste it below." },
        { text: "Optional but tidy: API permissions → Add a permission → Microsoft Graph → Delegated: Calendars.ReadWrite, Mail.ReadWrite, Tasks.ReadWrite, User.Read, offline_access. (Dayspring asks for these at sign-in anyway.)" },
        { text: "Press Connect below. Microsoft opens a sign-in page; sign in and accept. You'll land back on a Dayspring page that says Connected." },
      ],
      fields: [{ key: "clientId", label: "Application (client) ID", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" }],
      notes: ["No client secret is needed: Dayspring uses Microsoft's secure sign-in for desktop apps (PKCE).", "Drafts are saved in your Drafts folder; nothing is sent unless you say so."],
    },
    {
      id: "ics", name: "Calendar subscriptions (iCloud, school, teams, holidays)", icon: "🗓",
      what: "Any calendar that has a subscribe link (.ics, iCal or webcal://) shows on Dayspring's schedule: an iCloud calendar, a school or district calendar, your kid's team or league schedule, church events, holidays. Read-only; add as many as you like.",
      needs: "The calendar's subscribe link. No account or keys.", time: "About 2 minutes each",
      steps: [
        { text: "Find the calendar's subscribe link. Schools, leagues (TeamSnap, GameChanger, SportsEngine…) and churches usually have a “Subscribe”, “Sync to calendar”, “iCal” or “Export” button: copy the link it gives you (right-click → Copy link address). It usually ends in .ics or starts with webcal://." },
        { text: "iCloud: on iPhone open Calendar → Calendars → tap ⓘ next to the calendar → turn on Public Calendar → Share Link → Copy. On a Mac: Calendar → right-click the iCloud calendar → Share Calendar → tick Public Calendar → copy the link. (Anyone with the link can see that calendar, so share only the one you want on Dayspring.)" },
        { text: "Google Calendar (without connecting Google): calendar.google.com → ⚙ Settings → click the calendar on the left → Integrate calendar → copy “Secret address in iCal format”.", link: "https://calendar.google.com/calendar/r/settings", linkLabel: "Open Google Calendar settings" },
        { text: "Outlook (without connecting Microsoft): outlook.com → ⚙ Settings → Calendar → Shared calendars → Publish a calendar → pick the calendar and “Can view all details” → Publish → copy the ICS link.", link: "https://outlook.live.com/calendar/0/options/calendar/SharedCalendars", linkLabel: "Open Outlook shared calendars" },
        { text: "Holidays: many public holiday calendars have .ics links (for example your country's holidays from Google's public calendars, or officeholidays.com)." },
        { text: "Paste the link below, give it a short name (“Soccer”, “School”, “Holidays”) and press Connect. Dayspring checks it and shows its events right away. Or just tell Dayspring: “subscribe to this calendar” and paste the link." },
      ],
      fields: [{ key: "url", label: "Calendar link (.ics or webcal://)", placeholder: "webcal://… or https://….ics" }, { key: "name", label: "Name", placeholder: "Soccer schedule" }],
      notes: ["Subscriptions are refreshed every 30 minutes. They're read-only: change them where they come from.", "Secret links (Google's, iCloud's) let anyone who has them see that calendar; they stay on this computer.", "Repeating events (weekly practices, monthly meetings) and cancelled single dates are understood."],
    },
    {
      id: "feeds", name: "News and RSS feeds", icon: "📰",
      what: "Dayspring reads you the headlines: “what's the news”, “any science news”, “read me the latest from Ars Technica”, “local news”. Follow topics (tech, science, sports, faith, local…) or any site's RSS/Atom feed, and they also show up in Discover.",
      needs: "Nothing. Pick topics, or paste a feed link.", time: "About 1 minute",
      steps: [
        { text: "Pick a topic below (top stories, world, U.S., business, tech, science, health, sports, entertainment, faith) and press Connect. Add as many as you like, one at a time." },
        { text: "Local news: choose “local”. It uses the town set in Settings → Where you are." },
        { text: "Any site: look for an RSS or “feed” link or icon (often at /feed, /rss or /rss.xml; podcasts and YouTube channels have them too), copy it, and paste it as the feed link." },
        { text: "Anything else: type any words as the topic (“Kansas City Chiefs”, “SpaceX”) and Dayspring follows news about it." },
        { text: "Try it: say “what's the news”, or “read me the latest from tech”." },
      ],
      fields: [{ key: "topic", label: "Topic (or “local”)", placeholder: "tech" }, { key: "url", label: "…or a feed link", placeholder: "https://example.com/feed" }, { key: "name", label: "Name (optional)", placeholder: "My blog" }],
      notes: ["Headlines are fetched at most every 20 minutes. Topic feeds come from Google News and well-known outlets (NPR, BBC, Ars Technica, The Verge, ScienceDaily).", "Without any feeds, “what's the news” still works: it reads the top stories."],
    },
    {
      id: "homeassistant", name: "Home Assistant (smart home)", icon: "🏠",
      what: "Control your smart home by voice: “turn off the kitchen lights”, “set the thermostat to 70”, “is the garage door closed?”, “run the movie night scene”. Works with the lights, plugs, thermostats, locks, blinds, sensors and scenes in your Home Assistant.",
      needs: "Home Assistant running on your home network (Home Assistant Green/Yellow, a Raspberry Pi, or a VM). Most smart-home brands (Hue, Govee, Ring, Ecobee, Nest, TP-Link, Z-Wave, Zigbee…) connect to Home Assistant, so this one hookup covers them.", time: "About 5 minutes",
      steps: [
        { text: "Open Home Assistant in your browser, usually http://homeassistant.local:8123 (or its IP address, like http://192.168.1.50:8123), and sign in." },
        { text: "Click your name (bottom left) to open your Profile, then the Security tab." },
        { text: "Scroll to “Long-lived access tokens” → Create token. Name it “Dayspring” and press OK." },
        { text: "Copy the token right away (Home Assistant shows it only once)." },
        { text: "Paste the Home Assistant address and the token below and press Connect. Dayspring checks them and says your home's name." },
        { text: "Tip: Dayspring finds devices by their names in Home Assistant, so friendly names like “Kitchen lights” and “Garage door” work best (Settings → Devices & services → Entities → rename)." },
      ],
      fields: [{ key: "url", label: "Home Assistant address", placeholder: "http://homeassistant.local:8123" }, { key: "token", label: "Long-lived access token", secret: true, placeholder: "eyJ…" }],
      notes: ["Safety: unlocking a door, opening a garage door or gate, and disarming an alarm always ask “Just to be sure…?” first and happen only after your clear yes.", "The token can do anything your Home Assistant user can: make a separate non-admin user for Dayspring if you want to limit it.", "Away from home? Dayspring talks to Home Assistant on your home network; Home Assistant Cloud (Nabu Casa) addresses work too."],
    },
    {
      id: "webhooks", name: "Webhooks (IFTTT, Zapier, Make, n8n)", icon: "🔗",
      what: "Connects Dayspring to almost anything. Outgoing: say a phrase (“I'm leaving”) and Dayspring calls a link that starts an IFTTT applet, Zapier zap, Make scenario or n8n workflow: text someone, log a spreadsheet row, turn things off. Incoming: other services call Dayspring's private address to make it say something or add a reminder.",
      needs: "An IFTTT, Zapier, Make or n8n account (or anything that makes/calls webhooks).", time: "About 5 minutes per action",
      steps: [
        { text: "Make the other side first. IFTTT: create an applet with “Webhooks → Receive a web request” as the trigger (event name like leaving_home); your link is https://maker.ifttt.com/trigger/leaving_home/json/with/key/YOUR_KEY (the key is on the Webhooks service's Documentation page). IFTTT's Webhooks need an IFTTT Pro plan.", link: "https://ifttt.com/maker_webhooks", linkLabel: "Open IFTTT Webhooks" },
        { text: "Zapier: make a Zap with “Webhooks by Zapier → Catch Hook” as the trigger and copy the hook URL (Webhooks by Zapier needs a paid plan). Make: add a “Webhooks → Custom webhook” module and copy its address. n8n: add a Webhook node (POST) and copy its production URL.", link: "https://www.make.com/en/help/tools/webhooks", linkLabel: "Make's webhook help" },
        { text: "Below, give the action a name (“Leaving home”), the exact phrase you'll say (“I'm leaving”), and paste the link. Press Connect. Add as many as you like." },
        { text: "Try it: say the phrase exactly, or ask “run leaving home”. Dayspring sends JSON with a source and time, plus anything the AI passes (value1..value3 for IFTTT)." },
        { text: "Incoming: Settings → Apps → Webhooks shows your private address, http://127.0.0.1:4747/api/hooks/<secret>. Any program on this computer (a script, a local n8n, Task Scheduler) can POST JSON to it: {\"say\": \"The laundry is done\"} makes Dayspring say it, {\"remind\": \"Take the bread out\", \"minutes\": 20} adds a reminder." },
        { text: "Incoming from the internet (IFTTT, Zapier, Make): Dayspring only answers this computer, on purpose. To receive from cloud services or other devices you need a tunnel to port 4747 that lets only /api/hooks/ through; see “Incoming webhooks from the internet” in docs/connections.md before doing it. Keep the secret address private." },
      ],
      fields: [{ key: "name", label: "Action name", placeholder: "Leaving home" }, { key: "phrase", label: "Phrase you'll say", placeholder: "I'm leaving" }, { key: "url", label: "Webhook link", placeholder: "https://maker.ifttt.com/trigger/…" }],
      notes: ["Phrases must match exactly, so ordinary conversation never sets them off by accident.", "Anyone with the incoming address can make Dayspring speak; don't post it anywhere. Disconnecting removes the actions but keeps the address."],
    },
    {
      id: "todoist", name: "Todoist", icon: "✅",
      what: "Your Todoist tasks: “what's on my Todoist”, “add buy milk to Todoist for tomorrow”, “mark call the dentist done”. Todoist's own due dates work (“every Friday”, “tomorrow 5pm”).",
      needs: "A Todoist account (free is fine).", time: "About 2 minutes",
      steps: [
        { text: "Open Todoist in a browser and sign in. Go to Settings → Integrations → Developer.", link: "https://app.todoist.com/app/settings/integrations/developer", linkLabel: "Open Todoist's Developer settings" },
        { text: "Copy your API token (40 letters and numbers). In the Todoist app it's in the same place: Settings → Integrations → Developer." },
        { text: "Paste it below and press Connect. Dayspring checks it and says how many projects it sees." },
      ],
      fields: [{ key: "token", label: "Todoist API token", secret: true, placeholder: "0123abcd…" }],
      notes: ["The token can read and change all your Todoist tasks; it stays on this computer. If it's ever exposed, press “Issue a new API token” in Todoist.", "Todoist tasks appear alongside Dayspring's own; change them in Todoist or by voice."],
    },
    {
      id: "weatheralerts", name: "Severe weather alerts", icon: "⛈",
      what: "Dayspring watches for severe weather where you live and tells you once, out loud and on screen: tornado, severe thunderstorm, flash flood, winter storm, extreme heat. Ask any time: “any weather alerts?”",
      needs: "Your town set in Settings → Where you are. Nothing else.", time: "Already on",
      steps: [
        { text: "Set your town in Settings → Where you are (you may already have)." },
        { text: "That's it. In the United States the alerts are the official National Weather Service warnings and watches. Elsewhere Dayspring gives a heads-up from the forecast (storms, freezing rain, very strong wind, very heavy rain, extreme heat or cold), clearly labeled as not official." },
        { text: "Don't want them? Press Disconnect here to turn them off; Connect turns them back on." },
      ],
      fields: [],
      notes: ["Checked every 10 minutes. Each alert is spoken once; at most one every 30 minutes unless it's extreme. From 10 p.m. to 7 a.m. only severe and extreme alerts speak.", "Always follow your local officials and a weather radio or phone alerts for life-safety warnings: Dayspring is an extra, not a replacement."],
    },
  ];
}
export const guide = (id) => guides().find((g) => g.id === id) ?? null;
