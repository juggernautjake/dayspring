# Discord bot

Dayspring can join your Discord **server** as its own member. In a voice channel it hears its name and answers out loud; in text chat it answers when you @mention it. Everyone in the channel can see it's there, so nobody is listened to without knowing.

This is optional and free. It's separate from [tuning Dayspring into your own calls](discord-calls.md), where Dayspring listens through your headset and talks through your mic. The bot doesn't touch your headset, mic or Discord settings at all.

> **Note:** Discord only lets bots into **server voice channels**. A bot can't join DM calls or group-DM calls. For those, use [Dayspring in your calls](discord-calls.md) instead.

## What it can do

- **In a voice channel:** say "**Dayspring**, what's on tomorrow?" and it answers out loud in the call. Just "Dayspring" gets a "Yes?", and whatever you say next is the request.
- **In text chat:** `@Dayspring what's on Saturday?` anywhere it can read, or start a message with "Dayspring…" in one channel you choose.
- **Slash commands:** `/dayspring join`, `/dayspring leave`, `/dayspring say <question>`.
- **From the Dayspring screen:** "Dayspring, join my Discord" (it joins the voice channel you're in), "leave Discord", "is your Discord bot on?"

**Who can ask what:**

- **You** (your Discord user ID you save in Settings) get the full assistant: your schedule, reminders, changes, everything.
- **Anyone else** gets friendly general answers. Dayspring can't see or change your schedule, files or anything personal for them, and it tells them only you can ask for that.

**Privacy:**

- Dayspring turns call audio into text only to listen for its name. It uses speech recognition running on your own computer, and nothing is sent anywhere.
- What people say is never saved. Only a request made to Dayspring (after its name) and its reply are kept in Dayspring's developer log.
- When it joins, it says hello, so everyone knows it's there.
- It leaves by itself when everyone else has left.

## Before you start

- You need a Discord **server** where you can add apps. That means you own it, or you have the **Manage Server** permission.
- For hearing the call, Dayspring's speech recognition must be installed. Check **Settings → Discord calls** (it's the same one "Dayspring in your calls" uses). Without it, the bot can still talk and answer in text chat.

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

1. In the left menu, click **OAuth2**, then find the **OAuth2 URL Generator**.
2. Under **Scopes**, tick **bot** and **applications.commands**.
3. A **Bot Permissions** box appears. Tick:
   - **View Channels**
   - **Send Messages**
   - **Read Message History**
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
4. To send it away: "**Dayspring, leave**", `/dayspring leave`, or "leave Discord" to the screen.

## If it doesn't work

> **If it doesn't work:**
> - **"The bot token wasn't accepted."** Copy the token again (Bot → Reset Token) and save it. Tokens stop working when they're reset.
> - **"Turn on MESSAGE CONTENT INTENT."** Bot page → Privileged Gateway Intents → Message Content Intent → Save Changes, then **Save & connect** again.
> - **No `/dayspring` command.** Make sure you ticked **applications.commands** when inviting. Re-open the invite link to add it, then click **Save & connect** in Dayspring.
> - **"You're not in a voice channel on any server I'm in."** Join a voice channel first, and check the user ID in Settings is yours (Developer Mode → right-click your name → Copy User ID).
> - **It talks but doesn't react to its name.** Speech recognition isn't installed yet. See [Dayspring in your calls](discord-calls.md#what-you-need). Speak clearly and start with its name: "Dayspring, …" (a mention in the middle of a sentence is ignored on purpose).
> - **It can't join or speak.** In the voice channel's settings, check the bot's role has **Connect** and **Speak**.
> - **It joined but nobody hears it.** Check the channel isn't set to push-to-talk only for its role, and that the bot isn't server-muted.
