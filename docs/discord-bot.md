# Discord bot

Dayspring can join your Discord **server** as its own member. In a voice channel it hears its name and answers out loud; in text chat it's someone you and your friends can talk to. Everyone in the channel can see it's there, so nobody is listened to without knowing.

This is optional and free. It's separate from [tuning Dayspring into your own calls](discord-calls.md), where Dayspring listens through your headset and talks through your mic. The bot doesn't touch your headset, mic or Discord settings at all.

> **Note:** Discord only lets bots into **server voice channels**. A bot can't join DM calls or group-DM calls. For those, use [Dayspring in your calls](discord-calls.md) instead.

## What it can do

- **In a voice channel:** say "**Dayspring**, what's on tomorrow?" and it answers out loud in the call. Just "Dayspring" gets a "Yes?", and whatever you say next is the request.
- **In text chat:** `@Dayspring what's on Saturday?` anywhere it can read, or start a message with "Dayspring, …". Replying to one of its messages works too. It shows **typing…** right away and writes its answer into the message as it's made.
- **Its own channel:** give it a channel (**Settings → Calls → Dayspring's channel ID**) and every message there is for Dayspring, no name needed.
- **Direct messages:** choose who may DM it in **Settings → Calls**: anyone, people in a server with the bot (the default), only you, or nobody.
- **Slash commands:** `/ask`, `/joke`, `/time`, `/weather`, `/remind` (only you), `/help`, and `/dayspring join`, `/dayspring leave`, `/dayspring say <question>`.
- **Memory:** it remembers the last few messages in each channel, so "and what about Germany?" works. It forgets after 30 minutes of quiet, and never writes the chat to disk.
- **From the Dayspring screen:** "Dayspring, join my Discord" (it joins the voice channel you're in), "leave Discord", "is your Discord bot on?"

**Who can ask what:**

- **You** (your Discord user ID you save in Settings) get the full assistant: your schedule, reminders, changes, everything.
- **Anyone else** gets fun and information: trivia, quick facts, jokes, the time, the weather. Dayspring can't see or change your schedule, files, texts or prayer list for them, and it tells them only you can ask for that. If you'd like friends to be able to ask what you're up to today, turn on **Settings → Calls → Share my schedule with Discord** (your files, texts and prayer list stay private either way).
- **Fair use:** each person can send about 6 messages a minute (12 per channel), with a short pause between messages. Past that, Dayspring says "give me a minute" once and waits. Other bots are always ignored.
- **Personality:** it uses the same personality as everywhere, or a different one just for Discord (**Settings → Calls → Personality in Discord**).
- **Without AI:** it still answers the time, the date, the weather, jokes and quick math, with a small note that it's limited without AI right now.

**Privacy:**

- Dayspring turns call audio into text only to listen for its name. It uses speech recognition running on your own computer, and nothing is sent anywhere.
- What people say is never saved. Only a request made to Dayspring (after its name) and its reply are kept in Dayspring's developer log.
- When it joins, it says hello, so everyone knows it's there.
- It leaves by itself when everyone else has left.

## Before you start

- You need a Discord **server** where you can add apps. That means you own it, or you have the **Manage Server** permission.
- For hearing the call, Dayspring's speech recognition must be installed. Check **Settings → Calls** (it's the same one [Dayspring in calls](discord-calls.md) uses). Without it, the bot can still talk and answer in text chat.

## Set it up (about 5 minutes)

### 1. Create the bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) and sign in with your Discord account.
2. Click **New Application**. Name it **Dayspring** (or whatever you call your assistant), tick the box to agree to the terms, and click **Create**.
3. Optional: on **General Information**, upload an icon (the Dayspring logo works nicely).
4. In the left menu, click **Bot**.
5. Under **Privileged Gateway Intents**, turn on **Message Content Intent** and click **Save Changes**. (Dayspring needs it to read "Dayspring, …" in chat.)
6. Near the top, click **Reset Token**, confirm, and click **Copy**. This token is the bot's password: keep it private.

> **Warning:** Never paste the token in a chat or send it to anyone. If it leaks, click **Reset Token** again and save the new one in Dayspring.

### 2. Invite it to your server

**The quick way:** once the bot is connected (step 4), open **Settings → Calls** and click **Copy invite link**. Open the link, choose your server, and click **Authorize**. It includes everything below.

**By hand:**

1. In the left menu, click **OAuth2**, then find the **OAuth2 URL Generator**.
2. Under **Scopes**, tick **bot** and **applications.commands**.
3. A **Bot Permissions** box appears. Tick:
   - **View Channels**
   - **Send Messages**
   - **Read Message History**
   - **Send Messages in Threads**
   - **Embed Links**
   - **Add Reactions**
   - **Connect**
   - **Speak**
   - **Use Voice Activity**
4. Copy the **Generated URL** at the bottom and open it in your browser.
5. Choose your server, click **Continue**, then **Authorize**.

The bot now appears in your server's member list (offline until Dayspring connects).

### 3. Copy your Discord user ID

1. In Discord, open **User Settings** (the gear by your name) → **Advanced**, and turn on **Developer Mode**.
2. Right-click your own name (in the member list or on one of your messages) → **Copy User ID**. It's a long number.
3. Optional: to let Dayspring answer in one text channel without being @mentioned, right-click that channel → **Copy Channel ID**.

### 4. Connect it in Dayspring

1. Open **Settings → Features & apps** and scroll to **Discord bot**.
2. Paste the **Bot token**, your **Discord user ID**, and (optional) the **Text channel ID**.
3. Click **Save & connect**. After a few seconds it should say **Online as Dayspring#…** in your server.

## Use it

1. Join a voice channel in your server.
2. Type `/dayspring join` in any channel, or say "**Dayspring, join my Discord**" to the Dayspring screen.
3. Dayspring joins and says hello. Say "**Dayspring, what's on tomorrow?**"
4. To stop an answer, just start talking over it for a moment, or say "**Dayspring, stop**".
5. To send it away: "**Dayspring, leave**", `/dayspring leave`, or "leave Discord" to the screen.

**Speed:** the bot hears each person separately, notices you've finished after about 0.45 s of quiet, and starts speaking the first sentence of its answer while the rest is still being written. **Settings → Calls → Speed** shows how long the last answers took. If you also use [Tune in](discord-calls.md) in the same call, only the bot answers (you can change that in Settings → Calls).

## If it doesn't work

> **If it doesn't work:**
> - **"The bot token wasn't accepted."** Copy the token again (Bot → Reset Token) and save it. Tokens stop working when they're reset.
> - **"Turn on MESSAGE CONTENT INTENT."** Bot page → Privileged Gateway Intents → Message Content Intent → Save Changes, then **Save & connect** again.
> - **No slash commands.** Make sure you ticked **applications.commands** when inviting (the **Copy invite link** button in Settings → Calls includes it). Re-open the invite link to add it, then click **Save & connect** in Dayspring. In DMs, new commands can take up to an hour to appear.
> - **It doesn't answer DMs.** Check **Settings → Calls → Direct messages from**. With "People in a server with the bot", the person must be in one of your servers that has the bot.
> - **"I'm getting a lot of messages."** Someone sent more than about 6 messages in a minute. It answers again after a minute.
> - **"You're not in a voice channel on any server I'm in."** Join a voice channel first, and check the user ID in Settings is yours (Developer Mode → right-click your name → Copy User ID).
> - **It talks but doesn't react to its name.** Speech recognition isn't installed yet. See [Dayspring in your calls](discord-calls.md#what-you-need). Speak clearly and start with its name: "Dayspring, …" (a mention in the middle of a sentence is ignored on purpose).
> - **It can't join or speak.** In the voice channel's settings, check the bot's role has **Connect** and **Speak**.
> - **It joined but nobody hears it.** Check the channel isn't set to push-to-talk only for its role, and that the bot isn't server-muted.
