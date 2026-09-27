# Dayspring in calls: Discord, Zoom, Google Meet and Teams

Dayspring can join your calls and answer when anyone says **"Dayspring"**. It works in **Discord, Zoom, Google Meet, Microsoft Teams**, games, and any other app that plays sound. No bot or add-on is needed in the call app, and Dayspring never changes the app's settings.

There are two ways to bring it in:

- **🎧 Tune in** (this page): Dayspring listens to what plays in your headset and, if you like, talks into the call through your microphone. It works in every call app, including Discord DMs and group calls.
- **The Discord bot**: Dayspring joins a Discord **server** as its own member, and you can also chat with it in text. See [The Discord bot](discord-bot.md).
- **📹 Meetings (Google Meet)**: Dayspring opens your Meet in its own window, reads the captions to know who is talking, and answers the people you allow, with Lantern answering course questions. See [Meetings: Dayspring and Lantern in a Google Meet call](meeting-demo.md). While it's in a meeting, Tune in stands down, so nobody gets two answers.

> **Note:** Nothing anyone says is saved. Dayspring checks what it hears for its name, then throws it away. Only a request addressed to Dayspring and its answer are kept in the diagnostics log. While it listens, the 🎧 button reads **Listening in this call**. Let the people on your call know Dayspring is listening.

## What you need

- **Speech-to-text**, installed once. It's **Whisper**, and it runs on your computer: it's free, and nothing you hear is sent anywhere. The first time you press 🎧, Dayspring offers to install it (about 220 MB). You can also run `scripts\install-whisper.ps1` yourself.
- Windows 10 or 11.
- For people on the call to **hear** Dayspring: **Voicemeeter Banana**, a free virtual mixer. Dayspring sets it up for you (see [Answer into the call](#answer-into-the-call)).

## The two settings each call app needs

To hear Dayspring, a call app needs **two settings**, set once in the app itself. Dayspring shows the exact names from your own computer in **Settings → Calls → Call apps** and in the 🎧 **▾** menu, and it never changes them for you.

| Call app | Microphone (input) | Speaker (output) | Where the setting is |
|---|---|---|---|
| **Discord** | **Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)** | Your usual headset or speakers | **User Settings** (⚙ next to your name) → **Voice & Video** → **Input Device** / **Output Device** |
| **Zoom** | **Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)** | Your usual headset or speakers | **Settings** (⚙) → **Audio** → **Microphone** / **Speaker**. In a meeting: the **^** next to **Mute** |
| **Google Meet** (Chrome or Edge) | **Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)** | Your usual headset or speakers | In the meeting: **⋮ More options** → **Settings** → **Audio** → **Microphone** / **Speakers** |
| **Microsoft Teams** | **Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)** | Your usual headset or speakers | **Settings** (… next to your picture) → **Devices** → **Microphone** / **Speaker** |
| **Any other app** | **Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)** | Your usual headset or speakers | The app's audio or voice settings |

- **Microphone = Voicemeeter Out B1.** It carries your own microphone and Dayspring's voice together, so people hear you both.
- **Speaker = the device Dayspring listens to.** That's normally your headset. If you picked a specific device under **Listen to** in the 🎧 **▾** menu, use that same one in the call app.

**Recommended extras:**

- **Zoom:** in **Settings → Audio**, untick **Automatically adjust microphone volume** and set **Background noise suppression** to **Low**.
- **Discord:** in **Voice & Video**, turn off **Noise Suppression** (Krisp) and **Echo Cancellation**, and turn off **Automatically determine input sensitivity** (or set the slider low). Otherwise Discord may cut Dayspring's voice out as "noise".
- **Google Meet:** if Meet keeps switching back, set the browser's own setting too: the lock icon in the address bar → **Site settings** → **Microphone**. If people can't hear Dayspring, turn off Meet's **Noise cancellation**.
- **Teams:** set **Noise suppression** to **Low** or **Off**.

You can also just ask: *"Dayspring, what mic should Zoom use?"* or *"How do I set up Google Meet for you?"* It says the two device names and opens that app's card on the screen.

**Check it:** in **Settings → Calls**, click **▶ Test**. Dayspring plays "Testing, one two three" into the call mixer and checks that it arrived, that Voicemeeter is running, and that it can hear your speaker. It can't look inside Zoom, Meet, Teams or Discord, so the two settings above are yours to check.

## Turn it on and off

1. In the talk panel on the Dayspring screen, click **🎧**. It turns green and reads **🎧 Listening in this call**, with the call app it sees (for example **· Zoom**).
2. On the call, anyone can say **"Dayspring, …"** followed by a question. For example: *"Dayspring, what time is it in London?"* or *"Hey Dayspring… what's the weather tomorrow?"*
3. To stop, click the 🎧 button again.

**Things you can say** (to Dayspring directly, not on the call):

| Say | What happens |
|---|---|
| "Tune in" / "listen to the call" / "call mode on" | Starts listening to your headset |
| "Tune out" / "stop listening to the call" / "call mode off" | Stops |
| "Are you listening to the call?" | Tells you whether Tune in is on |
| "Talk into the call" / "stop talking into the call" | Whether answers go into the call (below) |
| "What mic should Zoom use?" | The microphone and speaker for that app |

On the call, anyone can say *"Dayspring, stop listening"*, or *"Dayspring, never mind"* to stop an answer.

> **Note:** **People on the call can ask questions, but only you can make changes.** If a friend says *"Dayspring, add a meeting tomorrow,"* Dayspring answers that only you can make changes. To make the change, ask Dayspring yourself (your own mic works as always).

## Which sound it listens to

The **▾** next to 🎧 opens the options. **Listen to** is normally *Whatever Windows is playing through*, your default speaker or headset. If your call app plays through a different device (for example you set Zoom's **Speaker** to a specific headset), pick that device here.

Tune in listens the way screen recorders do (Windows "loopback"). It never takes the device over, so your call, game and music keep playing exactly as before.

## Answer into the call

By default, Dayspring's answers play only in **your** headset. To let people on the call hear Dayspring too, it mixes its voice with your microphone. This uses **Voicemeeter Banana**, a free virtual mixer from [vb-audio.com](https://vb-audio.com/Voicemeeter/banana.htm).

1. Install Voicemeeter Banana if you haven't, and restart the computer once.
2. Click **▾** next to 🎧 and tick **Answer into the call**. Dayspring starts Voicemeeter and sets it up: your mic and Dayspring's voice both go to **Voicemeeter Out B1**, and you still hear Dayspring in your headset.
3. **In your call app,** set the microphone to **Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)** and leave the speaker on your headset. See [the table above](#the-two-settings-each-call-app-needs) for where that is in each app.
4. Say something on the call. People hear you as usual, and they hear Dayspring when it answers.

> **Warning:** While your call app's microphone is **Voicemeeter Out B1**, Voicemeeter must be running, or people won't hear you. Dayspring keeps it running and starts it again when Dayspring starts. Turning **Answer into the call** off only stops Dayspring's voice; your mic keeps working.

**Going back to normal:**

1. In your call app, set the microphone back to your headset microphone.
2. Click **▾** → **I'm done using the call mixer** (click twice; the first click reminds you of step 1). Dayspring closes Voicemeeter.

> **Tip:** Dayspring only ever gives Voicemeeter your devices in **shared** mode (MME). Other apps can still use your headset and mic at the same time, and Dayspring never changes your Windows default speaker or mic.

## How quickly it answers

Dayspring is built to start answering about a second after the question ends:

- It notices you've finished after about **0.45 s** of quiet (**Settings → Calls → Wait after someone stops talking**).
- A fast speech model starts on your words during that pause, and only asks a slower, more careful model when the words were unclear.
- The answer comes from your AI provider's **quickest model** (for Claude, Haiku), and each sentence is spoken as soon as it's written, while the rest is still coming.
- The voice streams: the first words play while the rest of the sentence is still being made (ElevenLabs uses its low-latency Flash voice model when your key allows it).

**Settings → Calls → Speed** shows how long the last 10 answers took, from the end of the question to the first sound. The same timings (never any words) are in `data\logs\call-latency.log`.

Other options in **Settings → Calls**:

- **While thinking:** nothing, a soft blip, or a short "mm-hm" (Discord bot).
- **Stop when someone talks over me:** talking over Dayspring for about half a second stops it. It works best with the Discord bot, which hears each person separately; for Tune in it's a separate switch, because Tune in hears one mixed sound.
- **When the Discord bot and Tune in are both in the call:** the bot answers (the default), so nobody hears two answers.

## If it doesn't work

> **If it doesn't work:**
> - **People can't hear Dayspring:** check the call app's **microphone** is **Voicemeeter Out B1** (see [the table](#the-two-settings-each-call-app-needs)) and that **Answer into the call** is ticked. Then click **▶ Test** in Settings → Calls.
> - **People can't hear you after turning on Answer into the call:** check that Voicemeeter is running (its icon on the taskbar). If not, turn Answer into the call off and on again, or set the call app's microphone back to your headset mic.
> - **Dayspring doesn't answer:** make sure the 🎧 button reads **Listening in this call**, and that the call app's **speaker** is the device Dayspring listens to. Say "Dayspring" clearly at the start of the question and pause briefly after it. Very loud game audio or music can drown out voices.
> - **Zoom or Discord cuts Dayspring's voice out:** turn off their noise suppression (see **Recommended extras** above).
> - **It answered itself or repeated something:** that's its own voice coming back through the headset. It ignores its own speech, but if you hear loops, turn the volume down a little or turn Tune in off and on.
> - **Two answers at once:** the Discord bot and Tune in are both in the call. In Settings → Calls, keep **The bot answers** selected.
> - **"Speech-to-text isn't installed":** click 🎧 → **Install**, or run `scripts\install-whisper.ps1`.
> - **It's slow:** check **Settings → Calls → Speed**. On slower computers set `WHISPER_MODEL=ggml-tiny.en.bin` in `.env` to use only the fast speech model.

## For Discord servers: the Dayspring bot

Tune in works in **any** call, including private DMs. For **server** voice channels you can also invite Dayspring as its own participant, and chat with it in text. See [The Discord bot](discord-bot.md).
