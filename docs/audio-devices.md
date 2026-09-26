# Sound: speakers and microphones

Dayspring can talk through any speaker on your computer: headphones, a headset, the laptop speakers, or a TV or monitor with speakers. It can use several at once. It listens through the microphone you choose.

> **Note:** Dayspring **never changes your Windows default speaker or microphone**. Discord, Teams, Zoom and games keep using whatever you've set for them.

## See your devices

Say **"list my audio devices"**, or open Settings → **Sound**. You'll see each speaker and microphone with the kind Dayspring thinks it is:

| Kind | Examples |
|---|---|
| **Headset / headphones** | USB or Bluetooth headsets, earbuds |
| **Display speakers** | a TV or monitor connected by HDMI or DisplayPort |
| **Laptop speakers** | the computer's built-in speakers |

If Dayspring guesses wrong, fix it in Settings → **Sound** with the **Kind** dropdown.

## Choose where Dayspring's voice plays

Say it however you like:

- "Use my headset" · "Headphones only"
- "Play on the TV" (for a monitor with speakers too, say "TV")
- "Play on the laptop speakers"
- "Play on both" (the display and your headset) · "Play on all three"
- "Use my headset and **not** the TV"
- "Use the default" (whatever Windows is using)

Or open the **Sound panel** (see below) and tick the devices under **Dayspring plays on**. Tick several to play on all of them. **Windows default** means "whatever Windows is set to use".

> **Spotify and YouTube follow Windows.** Music from Spotify inside Dayspring and YouTube always play on your **Windows default** output (a web page can't send them anywhere else). To move them, click **Open Windows sound settings** in the Sound panel and change the default there. Dayspring never changes it for you.

## The Sound panel

Everything about sound is in one place. Open it with **🔊 Sound** or **🎚 Volume** in the Dayspring panel, the **🔊** in the window bar (move the pointer to the top edge), or say **"open the sound settings"** / **"sound options"**. Esc closes it.

| Section | What's there |
|---|---|
| **Volume** | A slider, a mute button and the number for each: Voice, Sounds & chimes, Alarm, Music, Videos, Call answers. ▶ plays a short test. |
| **Dayspring plays on** | Every speaker, with its nickname and whether it's in use now. Tick one or several, or **Windows default**. ▶ next to a device plays a test chime on just that one. |
| **Microphone** | Which microphone Dayspring listens with. |
| **Calls (🎧 Tune in)** | Which sound Tune in listens to, and **Answer into the call** (friends hear Dayspring through your mic). |
| **At night** | Go dark, just dim, or stay bright. |

## Nicknames

Device names like "Speakers (Realtek(R) Audio)" are hard to say. Give them nicknames:

- "Call the Jabra the blue headset"
- "The Logitech is my desk speaker"

Then: "use the blue headset", "use the blue headset for both" (speaker **and** mic).

In Settings → **Sound**, type a nickname next to any device.

## Choose the microphone

- "Use my headset mic" · "Listen through the laptop mic" · "Which mic are you using?"
- Or pick it in the **Sound panel** → **Microphone**.

## Volume

Dayspring has six volumes of its own, set separately:

| Slider | What it covers |
|---|---|
| 🗣 **Voice** | Dayspring talking |
| 🔔 **Sounds & chimes** | Dings, chimes and little sound effects (starts at the voice level) |
| ⏰ **Alarm** | The wake-up ring. It never goes below 20, so the alarm can't be silenced by accident. |
| 🎵 **Music** | Spotify, and YouTube playing as music only |
| 🎬 **Videos** | YouTube videos with the picture showing |
| 🎧 **Call answers** | Tune in's answers into a call |

**On the screen:** open the **Sound panel** (🔊 Sound or 🎚 Volume). Each slider has a mute button and shows its number.

**By voice** (no AI needed):
- "voice volume 60" · "louder" · "quieter" (Dayspring's voice)
- "turn the music down" · "music volume 30" · "turn the music up"
- "video volume 40" · "turn the video up"
- "chime volume 30" · "make the sounds quieter" (chimes and sound effects)
- "alarm volume 80" · "turn the alarm up"
- "call volume 50" (Tune in's answers)
- "turn it up" / "turn it down" while something is playing changes whatever is playing.

A new install starts everything at full volume. Videos follow the music volume until you set them apart. Music and videos still dip under Dayspring's voice while it talks. None of this changes the Windows volume or any other app's volume.

## Keeping other apps on the right devices

Windows lets you choose devices app by app:

1. Open **Settings** → **System** → **Sound** → **Volume mixer**.
2. Find the app (for example Discord) and set its **Output device** and **Input device**.

Many apps also have their own setting. In Discord, for example: **User Settings** (⚙) → **Voice & Video** → **Input Device** and **Output Device**. Choose the device by name rather than "Default".

## Music on several speakers at once (optional, advanced)

Dayspring's own voice can play on several speakers at once. Spotify and YouTube, which play in Dayspring's music window, normally play on one device. To send music to several at once, Dayspring can use the free **Voicemeeter Banana** mixer:

1. Install Voicemeeter Banana from [vb-audio.com](https://vb-audio.com/Voicemeeter/banana.htm) and restart the computer.
2. Say "use the mixer" (or Settings → **Sound** → **Use the Voicemeeter mixer**).
3. Say "turn off the mixer" to stop using it.

> **Warning:** Voicemeeter is a powerful tool that can take over audio devices. If another app loses sound after you install it, say "turn off the mixer", close Voicemeeter, and check **Settings → System → Sound** that your normal speaker and microphone are still the defaults.

> **If it doesn't work:**
> - **No sound from Dayspring**: say "list my audio devices" and "use my headset" (or whichever you want). Check the device isn't muted in Windows.
> - **It doesn't hear me**: say "which mic are you using?" (or type it). Choose the right one. Then check Windows: **Settings → Privacy & security → Microphone**, and make sure microphone access is on for desktop apps and your browser.
> - **The display's speakers are missing**: the TV or monitor must be on and connected by HDMI or DisplayPort. Some monitors have no speakers.
> - **Bluetooth headset sounds muffled while Dayspring listens**: Windows switches Bluetooth headsets to "hands-free" mode when their mic is in use. Use a different mic for Dayspring (such as the laptop mic) to keep full sound quality.
