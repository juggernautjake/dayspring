# Voices

Dayspring can speak with three kinds of voices. Choose in Settings → **Voice**.

| Kind | Sound | Cost | Needs |
|---|---|---|---|
| **Free voices** | Good. The ✨ "Natural" ones are very good. | Free | Nothing |
| **ElevenLabs** | Excellent, the most human | Free tier, then about $5/month and up | An ElevenLabs key |
| **OpenAI voices** | Very good | Pay per use (pennies) | An OpenAI key |

Whichever you choose, Dayspring adjusts its pace and tone through the day: soothing first thing, brighter mid-morning, upbeat in the afternoon, calm at night. Say "slow down", "speed up" or "normal speed" to adjust.

## Free voices

These are the voices built into Windows and your browser.

- Open Settings → **Voice** and choose **Free voices**. Click ▶ next to any voice to hear it, then click **Use this voice**.
- Or say **"show me the voices"**, then **"switch your voice to Aria"** (use any name from the list).

Voices marked ✨ are "Natural" voices. They sound far better than the older robotic ones.

### Getting the ✨ Natural voices

The best free voices (Aria, Jenny, Guy, Ava, Andrew, Emma, Brian and many more) are built into **Microsoft Edge**. Dayspring's screen uses Chrome if it's installed, and Edge otherwise.

To use Edge's natural voices:

1. Make sure Microsoft Edge is installed. It is on almost every Windows computer.
2. Open Settings → **Screen** and set **Browser** to **Microsoft Edge**. If you don't see that option, close Dayspring, open the Dayspring folder, and edit `scripts\open-display.cmd` so it prefers `msedge.exe`.
3. Restart Dayspring. The ✨ voices now appear in the list.

> **Note:** The Natural voices are streamed by Microsoft, so they need an internet connection. With no internet, Dayspring falls back to the built-in offline voices.

> **If it doesn't work:** if the voice list is empty, wait ten seconds after the screen opens (browsers load voices a moment late), then open the list again.

## ElevenLabs (the most natural)

[ElevenLabs](https://elevenlabs.io) makes extremely lifelike voices. There's a free tier (about 10,000 characters a month, which is roughly 10–20 minutes of speech). The **Starter** plan (about $5/month) is plenty for daily use.

### Get a key

1. Go to [elevenlabs.io](https://elevenlabs.io) and click **Sign up** (or **Log in**).
2. Open the **Developers** section in the left menu (on some layouts: click your profile picture → **API Keys**) and choose **API Keys** → **Create API Key**.
3. Name it "Dayspring". If it asks about permissions, turn on **Text to Speech** and **Voices → Read**. Voices → Read lets Dayspring list your voices.
4. Click **Create**, then **copy the key**. It's shown only once.

### Add it to Dayspring

1. Open Settings → **Voice** and choose **ElevenLabs**.
2. Paste the key and click **Test**. You'll hear a short sample.
3. Pick a voice from the list. ▶ previews it. Then click **Save**.

### The built-in voices

Every ElevenLabs key can use these 16 voices. Say **"switch your voice to Charlotte"** (or any name):

| Voice | Sound | Voice | Sound |
|---|---|---|---|
| Brian | deep and calm | Jessica | bright and expressive |
| George | warm and British | Matilda | warm |
| Eric | smooth | Liam | young and clear |
| Chris | casual | Will | friendly and relaxed |
| Daniel | British and steady | Alice | confident and British |
| Sarah | soft | Lily | gentle and British |
| Rachel | calm and clear | Roger | laid-back and easy |
| Charlotte | soft, a little smoky | Callum | husky and intense |

You can also describe what you want: "use a female voice", "a British voice", "a deeper voice", "something more casual". Or say "try a different voice" to hear the next one.

### Getting more voices from the Voice Library

ElevenLabs has thousands of community voices.

1. On elevenlabs.io, open **Voices** → **Voice Library** (sometimes called **Explore**).
2. Browse or search, for example "warm narrator" or "Southern". Click ▶ to listen.
3. When you find one you like, click **Add to my voices** (the **+** button).
4. In Dayspring, open Settings → **Voice** and click **Refresh voices**. The new voice appears in the list. Dayspring also re-checks your voices every hour.

> **Tip:** You can also design a voice from a description, or clone your own voice (with permission!), on paid plans. Those appear in Dayspring the same way.

> **If it doesn't work:**
> - **Test says "invalid key"**: copy the key again, with no spaces.
> - **Only the 16 built-in voices show up**: your key can't list voices. Make a new key with **Voices → Read** turned on.
> - **It stops talking partway through the month**: you've used up your monthly characters. Upgrade the plan, or switch to free voices until it resets.
> - **Speech is delayed**: ElevenLabs is slow to answer at the moment. Dayspring waits up to 20 seconds, then falls back to a free voice for that sentence.

## OpenAI voices

If you have an OpenAI key (see [AI providers](ai-providers.md#chatgpt-openai)), you can use OpenAI's voices: **Alloy** (neutral), **Ash** (clear), **Ballad** (soft), **Coral** (warm), **Echo** (calm), **Fable** (storyteller), **Nova** (bright; the default), **Onyx** (deep), **Sage** (wise), **Shimmer** (gentle) and **Verse** (lively).

1. Open Settings → **Voice** and choose **OpenAI voices**. If you haven't saved an OpenAI key yet, paste it here.
2. Click ▶ to preview, then pick one and click **Save**.
3. Or say "switch your voice to Coral".

Cost: a few cents per hour of speech.

## Advanced: the `.env` settings

```
TTS_PROVIDER=browser          # browser | elevenlabs | openai   (empty = ElevenLabs if a key is set, else browser)
ELEVENLABS_API_KEY=
ELEVENLABS_MODEL=             # optional; default eleven_turbo_v2_5 (fast)
DAYSPRING_VOICE_ID=           # optional; a specific ElevenLabs voice ID to use by default
OPENAI_TTS_MODEL=             # optional; default gpt-4o-mini-tts
```

To find an ElevenLabs voice ID: on elevenlabs.io, open **My Voices**, click **⋯** next to the voice, and choose **Copy voice ID**.
