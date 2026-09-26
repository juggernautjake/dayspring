# Tune in: Dayspring on your calls

**Tune in** lets Dayspring hear whatever is playing in your headset: a Discord call, a game with friends, a video. When anyone says **"Dayspring"**, it answers. You turn it on and off with the **🎧** button in the talk panel, or by saying so.

It works with Discord, Teams, Zoom, games or anything else that plays sound, and it doesn't change any of their settings.

> **Note:** Nothing anyone says is saved. Dayspring checks what it hears for its name, then throws it away. Only a request addressed to Dayspring and its answer are kept in the diagnostics log. Let the people on your call know Dayspring is listening.

## What you need

- **Speech-to-text**, installed once. It's **Whisper**, and it runs on your computer: it's free, and nothing you hear is sent anywhere. The first time you press 🎧, Dayspring offers to install it (about 220 MB). You can also run `scripts\install-whisper.ps1` yourself.
- Windows 10 or 11. Nothing else, unless you want Dayspring to talk **into** the call (see [Answer into the call](#answer-into-the-call)).

## Turn it on and off

1. In the talk panel on the Dayspring screen, click **🎧**. It turns green and reads **🎧 On**. A note says which device it's listening to.
2. On the call, anyone can say **"Dayspring, …"** followed by a question. For example: *"Dayspring, what time is it in London?"* or *"Hey Dayspring… what's the weather tomorrow?"*
3. To stop, click **🎧 On** again.

**Things you can say** (to Dayspring directly, not on the call):

| Say | What happens |
|---|---|
| "Tune in" / "listen to the call" / "call mode on" | Starts listening to your headset |
| "Tune out" / "stop listening to the call" / "call mode off" | Stops |
| "Are you listening to the call?" | Tells you whether Tune in is on |
| "Talk into the call" / "stop talking into the call" | Whether answers go into the call (below) |

Someone on the call can also say *"Dayspring, stop listening."*

> **Note:** **People on the call can ask questions, but only you can make changes.** If a friend says *"Dayspring, add a meeting tomorrow,"* Dayspring answers that only you can make changes. To make the change, ask Dayspring yourself (your own mic works as always).

## Which sound it listens to

The **▾** next to 🎧 opens the options. **Listen to** is normally *Whatever Windows is playing through*, your default speaker or headset. If your call app plays through a different device (for example you set Discord's **Output Device** to a specific headset), pick that device here.

Tune in listens the way screen recorders do (Windows "loopback"). It never takes the device over, so your call, game and music keep playing exactly as before.

## Answer into the call

By default, Dayspring's answers play only in **your** headset. To let your friends hear Dayspring too, it mixes its voice with your microphone. This uses **Voicemeeter Banana**, a free virtual mixer from [vb-audio.com](https://vb-audio.com/Voicemeeter/banana.htm).

1. Install Voicemeeter Banana if you haven't, and restart the computer once.
2. Click **▾** next to 🎧 and tick **Answer into the call**. Dayspring starts Voicemeeter and sets it up: your mic and Dayspring's voice both go to **Voicemeeter Out B1**, and you still hear Dayspring in your headset.
3. **One step in Discord:** open **User Settings** (the gear by your name) → **Voice & Video** → **Input Device** → choose **Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)**. Leave **Output Device** on your headset.
4. Say something on the call. Your friends hear you as usual, and they hear Dayspring when it answers.

> **Warning:** While Discord's input is **Voicemeeter Out B1**, Voicemeeter must be running, or your friends won't hear you. Dayspring keeps it running and starts it again when Dayspring starts. Turning **Answer into the call** off only stops Dayspring's voice; your mic keeps working.

**Going back to normal:**

1. In Discord, set **Input Device** back to your headset microphone.
2. Click **▾** → **I'm done using the call mixer** (click twice; the first click reminds you of step 1). Dayspring closes Voicemeeter.

> **Tip:** Dayspring only ever gives Voicemeeter your devices in **shared** mode (MME). Other apps can still use your headset and mic at the same time, and Dayspring never changes your Windows default speaker or mic.

## If it doesn't work

> **If it doesn't work:**
> - **Friends can't hear you after turning on Answer into the call:** check that Voicemeeter is running (its icon on the taskbar). If not, turn Answer into the call off and on again, or set Discord's input back to your headset mic.
> - **Dayspring doesn't answer:** make sure 🎧 is green. Say "Dayspring" clearly at the start of the question and pause briefly after the question. Very loud game audio or music can drown out voices.
> - **It answered itself or repeated something:** that's its own voice coming back through the headset. It ignores its own speech, but if you hear loops, turn the volume down a little or turn Tune in off and on.
> - **"Speech-to-text isn't installed":** click 🎧 → **Install**, or run `scripts\install-whisper.ps1`.
> - **It's slow:** Dayspring uses a small, fast model to catch its name and a better one for the question. On slower computers set `WHISPER_MODEL=ggml-tiny.en.bin` in `.env` to use only the fast one.

## For Discord servers: the Dayspring bot

Tune in works in **any** call, including private DMs. For **server** voice channels you can also invite Dayspring as its own participant. See [The Discord bot](discord-bot.md).
