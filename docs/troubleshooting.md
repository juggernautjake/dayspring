# Troubleshooting

Start with the quick checks, then find your problem below.

## Quick checks

1. **Is Dayspring running?** Look for the **Dayspring server** window on the taskbar. If it's not there, start Dayspring.
2. **Is it reachable?** Open `http://localhost:4747` in a browser. If the page doesn't load, the server isn't running, or it stopped with an error. Open the **Dayspring server** window and read the last lines.
3. **Restart it.** Close the **Dayspring server** window, then start Dayspring again.

## It won't start

- **"node is not recognized"**: Node.js isn't installed, or Windows hasn't noticed it yet. Run **Install Dayspring.cmd** again, or install Node.js LTS from [nodejs.org](https://nodejs.org) and restart the computer.
- **"EADDRINUSE: address already in use :::4747"**: Dayspring (or something else) is already running on port 4747. Close any other **Dayspring server** window. If it keeps happening, restart the computer.
- **"Cannot find module …"**: open a Command Prompt in the Dayspring folder (type `cmd` in the folder's address bar and press Enter), then run `npm install`.
- **The window flashes and closes**: open a Command Prompt in the Dayspring folder and run `"Start Dayspring.cmd"` to see the error.

## It doesn't hear me

1. Say or type **"which mic are you using?"** Choose the right one: "use my headset mic", or Settings → **Sound**.
2. Check Windows allows the microphone: **Settings → Privacy & security → Microphone** → **Microphone access: On**, and **Let desktop apps access your microphone: On**.
3. Check the mic isn't muted, and its level moves: **Settings → System → Sound** → your microphone → **Test your microphone**.
4. The Dayspring screen needs microphone permission in its browser. If it ever asked and you clicked **Block**: click the 🔒 or 🎤 icon by the address, set **Microphone: Allow**, and reload. (Or close the Dayspring screen and start Dayspring again.)
5. Speech recognition needs the internet in Chrome and Edge. Check you're online.
6. Pick a wake word that's easy to hear: Settings → **Your assistant** → **Wake words**.
7. Use ⌨ **Type** in the meantime. Everything works by typing too.

## It hears me but cuts me off

Dayspring waits for a pause before answering. Pause less between sentences, or type long requests.

## No sound

1. Say or type **"list my audio devices"**, then "use my headset" (or whichever you want).
2. Check the device isn't muted, and Dayspring's volume: "volume 70".
3. **🔇 Text only** might be on. Click it to turn talking back on.
4. "Notifications are silent"? Say "notifications back on".
5. With ElevenLabs or OpenAI voices: check the key still works (Settings → **Voice** → **Test**). If that service is out of credits, switch to free voices.

## Other apps lost their sound or mic (Discord, Teams…)

Dayspring doesn't change Windows' default devices, but the optional Voicemeeter mixer can. Say "turn off the mixer", close Voicemeeter, then open **Settings → System → Sound** and choose your normal output and input again. In the other app, choose your devices by name rather than "Default". See [Sound](audio-devices.md#keeping-other-apps-on-the-right-devices).

## "Sorry, I couldn't get an answer just then"

Your AI brain didn't answer. Check the internet connection, and Settings → **AI brain** → **Test**. Common causes: no credits left, an expired key, or the provider having an outage. Free-mode commands keep working meanwhile. See [AI providers](ai-providers.md#if-it-doesnt-work).

## It's stuck on "Thinking…"

It gives up by itself after about a minute and says so. Click ✋ **Stop** to reset right away. If it happens often, try a faster model (Settings → **AI brain**).

## The screen is on the wrong display, or cut off

See [Display setup](display-setup.md).

## Spotify or YouTube won't play

See [Music](music.md). The usual fixes: say "sign in to Spotify"; Spotify needs Premium for full playback; the music window must be real Google Chrome for Spotify.

## Texts aren't announced

See [Your phone](phone.md#make-sure-windows-shows-the-notifications).

## My laptop went to sleep or locked

- **Is it plugged in?** Dayspring keeps the computer awake only while it's plugged in. On battery it sleeps as usual.
- **Is "Stay awake" on?** Check Settings → **Screen** → **Stay awake**, or say *"keep the laptop awake"*. Ask *"will the computer sleep?"* to hear what it's doing.
- **Did it lock but not sleep?** A screen saver set to lock can still lock it. Open Windows **Settings → Personalization → Lock screen → Screen saver** and untick **On resume, display logon screen**, or choose **(None)**.
- **Is Dayspring running on the Dayspring screen?** Staying awake is tied to the Dayspring screen being on this computer (started with **Start Dayspring**).

## Something else

- **Look at the log**: the **Dayspring server** window shows what's happening. Diagnostics are also saved in `data\devlog\`, one file per day.
- **Start fresh, keeping your data**: re-download the latest release, extract it over your Dayspring folder (your `data` and `.env` are not in the download, so they're safe), and run **Install Dayspring.cmd**.
- **Report a problem**: tell whoever shared Dayspring with you. Include what you said or did, what happened, and the last lines of the server window. Don't share your `.env` file, because it contains your keys.
