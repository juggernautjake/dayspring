# Music and videos: Spotify and YouTube

Dayspring plays music and videos right on its screen, with full controls: play and pause, skip, go back, jump to any point, volume, shuffle, repeat, and speed for videos. You can use the buttons, your voice, or typing.

- **YouTube** plays on the Dayspring screen itself. It works with no setup. Sign in once to get no ads if you have YouTube Premium.
- **Spotify** plays on the Dayspring screen once you connect it. This needs **Spotify Premium** and about 5 minutes of setup, explained below. Until then, Dayspring falls back to playing Spotify in a small browser window of its own (the "music window"), which has fewer controls.

Commands marked ⚡ work even without an AI brain.

## Turn it on

Open Settings → **Features & apps** and turn on **Music**.

## Spotify inside Dayspring (recommended)

With this set up, the Dayspring screen becomes a Spotify speaker called **Dayspring**. Music plays right there, and Dayspring can control everything: volume, skip, seek, shuffle, repeat, your playlists, Liked Songs and the queue.

**You need:** Spotify **Premium** (Spotify only allows playback inside other apps for Premium accounts) and Google Chrome or Microsoft Edge showing the Dayspring screen (the normal setup).

### Step 1: Make a free Spotify "developer app" (one time, about 5 minutes)

This is Spotify's way of letting Dayspring talk to your account. It's free and doesn't publish anything.

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and log in with your Spotify account. Accept the developer terms if asked.
2. Click **Create app**.
3. Fill it in:
   - **App name:** `Dayspring`
   - **App description:** `My Dayspring assistant`
   - **Redirect URI:** type exactly `http://127.0.0.1:4747/spotify/callback` and click **Add**. (It must be `127.0.0.1`. Spotify doesn't accept `localhost`. If you changed Dayspring's port, use that number instead of 4747.)
   - **Which API/SDKs are you planning to use?** Tick **Web API** and **Web Playback SDK**.
4. Tick the box to agree to the terms and click **Save**.
5. On the app's page, open **Settings** and copy the **Client ID** (a long string of letters and numbers). You don't need the Client secret. Dayspring never uses it.
6. Still in Settings, open **User Management** and add **your own Spotify account's email** (and anyone else in your home who'll use it, up to 5 people). New apps are in "Development mode", and Spotify only lets people on this list sign in.

### Step 2: Connect it in Dayspring

1. Open Settings → **Features & apps** → **Music** → **Spotify inside Dayspring**.
2. Paste the **Client ID** and click **Connect Spotify**. (Or paste it, click Save, and later just say **"sign in to Spotify"** ⚡.)
3. Your web browser opens Spotify's sign-in page. Sign in yourself and click **Agree**. Dayspring never sees your password.
4. The page says **All set**, and the Dayspring screen shows **Spotify connected**. You can close the browser tab.

Dayspring stays signed in. You won't need to do this again unless you disconnect it or Spotify asks you to sign in again (it tells you when).

> **Note:** Spotify's sound comes from the Windows default speaker. Dayspring's own voice can go to other speakers you pick in Settings, but Spotify plays inside Spotify's own player, which always uses the Windows default. If Spotify plays on the wrong speaker, change the default in Windows (the speaker icon on the taskbar).

> **If it doesn't work:**
> - **"INVALID_CLIENT: Invalid redirect URI"**: the Redirect URI in your Spotify app must be exactly `http://127.0.0.1:4747/spotify/callback`, with no `/` at the end and `http`, not `https`.
> - **"User not registered" / "403"**: add your Spotify email under **User Management** in the developer dashboard (step 1.6).
> - **"Playing inside Dayspring needs Spotify Premium"**: the account you signed in with isn't Premium.
> - **"The Dayspring screen isn't connected to Spotify right now"**: the screen is closed or reloading. Open it and try again. It reconnects by itself within a few seconds.
> - **"This browser can't play Spotify here"**: the screen must be Chrome or Edge (Settings → Screen).

## The music card

When something plays, a card on the right of the screen shows it:

- the cover (or video thumbnail), title and artist
- **NEXT**: the next song or video in line. Click it to see the whole queue.
- a progress bar you can drag to jump anywhere
- 🔀 shuffle · ⏮ previous · ⏯ play/pause · ⏭ next · 🔁 repeat (click again for "repeat this one")
- a volume slider (the music volume; Dayspring's own voice has its own volume)
- 📺 / ♪: show the video or just play the sound (YouTube)
- 📚: the **Library** (below)
- ✕: stop

Dayspring's music automatically dips while it talks and comes back up after.

## Watching videos

Videos play big on the Dayspring screen. Move the mouse or tap on the video to show its controls; they hide again after a few seconds, and stay visible while paused.

- **✕** (top right): close the video
- **☰ Browse**: the video browser (below)
- ⏮ ⏯ ⏭: previous video, play/pause, next video
- **⟲10 / 10⟳**: back or forward 10 seconds
- the progress bar with the time and length: click or drag to jump
- volume, **speed** (0.25× to 2×), **♪** music only (hides the picture), **⛶** full screen

Click the video to play or pause it; double-click for full screen.

**Keyboard** (while a video is showing):

| Key | Does |
|---|---|
| Space or K | Play / pause |
| ← / → | Back / forward 5 seconds |
| ↑ / ↓ | Volume up / down |
| < / > | Slower / faster |
| F | Full screen |
| M | Mute |
| Shift+N / Shift+P | Next / previous video |
| Esc | Leave full screen, or close the video |

## Going back and forth between videos

Dayspring remembers the last 50 videos you played (on this computer only) and **where you stopped in each one**.

- ⏮ goes back to the previous video, resuming where you left it. ⏭ goes forward again, then to your **Up next** queue, then to the next-best result of your last search.
- In a YouTube playlist, ⏮ and ⏭ move through the playlist.
- Your recent videos are in the Library's **Videos** tab. Click one to go back to it.

## The Library

Open it with the 📚 button on the music card, the ☰ on a video, or by saying **"open my library"** ⚡. It sits over the left side of the screen, so the talk panel stays reachable. Close it with ✕, Esc, or **"close the library"** ⚡.

**Music** (Spotify):
- **Your playlists**, with covers. Click one to play it. **Liked Songs** plays them shuffled.
- **Recently played** and your **Liked Songs**.
- **Search** Spotify for songs, albums, artists, playlists or podcasts. (Spotify returns at most 10 results per search for personal apps.)
- On any song: **＋ Queue**, and **⋯** for **Play now**, **Play next**, **Add to queue**, **Like**, **Add to** one of your playlists, and **Open in Spotify**.
- **Party / Jam**: how to listen together (below).

**Videos** (YouTube):
- **Search** with **Videos / Playlists** and **Best match / Newest / Popular**, and **Load more**.
- **Recent videos**, **Up next**, and **My video playlists**.
- On any video: click to play, or **⋯** for **Play now**, **Play as music**, **Play next**, **Add to queue**, **Add to** a video playlist, **New playlist with this…**, **Open in my browser** and **Copy link**.

**Queue**:
- **Now playing**, with ♡ **Like** and ⋯ (add to a playlist) for Spotify songs.
- **Up next on Spotify**: the next songs, including ones friends add in a Jam. Click a song to jump to it (Dayspring skips the ones before it; Spotify can't jump straight there).
- **Video queue**: drag to reorder, or use ▲ ▼, ▶ to play now, ✕ to remove, and **Clear**.

> **Note:** "Play next" on Spotify adds the song to your queue. It plays right after the current song, after anything you queued before it. That's how Spotify's queue works.

## Video playlists

Dayspring keeps its own named video playlists, like "Worship" or "Morning hymns", on this computer. They show in the Library and work by voice. They're separate from your YouTube account's playlists: Dayspring can play those ("play my YouTube playlists" needs an AI brain), but saving into your YouTube account isn't reliable, so Dayspring's playlists live in Dayspring.

## Party / Jam: listening together

Spotify's **Jam** lets friends add songs to what's playing. Dayspring can't start a Jam itself (Spotify only allows that in its own app), but it works with one:

1. In the Spotify app on your phone or computer, open what's playing, tap the **devices** (speaker) icon and pick **Dayspring**.
2. Tap **Start a Jam** (the person-with-a-plus icon). Friends join with the QR code or link and add songs.

The music plays on Dayspring, and Dayspring's controls and **Up next** keep working, including songs your friends add. Say **"start a jam"** ⚡ and Dayspring opens the Spotify app (or Spotify on the web) and walks you through it.

**Discord "Listen Along":** in Discord, open **Settings → Connections → Spotify** and connect your account. While you play Spotify, friends can click **Listen Along** on your profile. Everyone needs Spotify Premium.

> **Note:** Dayspring doesn't stream Spotify's music into Discord voice calls or anywhere else. Spotify's terms don't allow rebroadcasting music, so use Jam or Listen Along instead.

## Sign in to YouTube (for no ads)

YouTube works without signing in. Signing in gives you your own playlists and history, and **no ads if you have YouTube Premium**.

1. Say **"sign in to YouTube"** ⚡ (or Settings → Features & apps → Music → **Sign in to YouTube**).
2. Sign in with your Google account in the window that opens.
3. Minimize the window when you're done.

## The older Spotify music window (no setup)

If you haven't connected Spotify inside Dayspring, Spotify plays in the music window instead:

1. Say **"sign in to Spotify"** ⚡ (before a Client ID is saved, this opens the music window).
2. Sign in yourself on Spotify's page, then minimize the window.

It can play, pause, skip, go back and change the volume, but it can't jump to a point in a song, shuffle or repeat. If Chrome says **"Playback of protected content is not enabled"**, open Chrome normally, go to `chrome://components`, and click **Check for update** under **Widevine Content Decryption Module**, then restart Dayspring.

## Things you can say

**Playing** (these need an AI brain unless marked ⚡):
- "Play *River Flows in You* on Spotify" ⚡ · "Play the album *Abbey Road*" ⚡ · "Play Yiruma" · "Play a lo-fi study playlist" ⚡
- "Play my *Morning* playlist" ⚡ · "Shuffle my Liked Songs" ⚡ · "Play a podcast about history"
- "Play *hymns* on YouTube" ⚡ · "Find a recent popular video about sourdough" ⚡
- "Queue *Sweet Disposition*" ⚡ · "Add the second one to the queue" ⚡ (from a list on screen) · "Play the third one" ⚡

**Controlling** ⚡ (while something is playing):
- "Pause" · "Play" / "Resume" · "Next" / "Skip" · "Previous" / "Go back" · "Start over" · "Stop the music"
- "Skip ahead 30 seconds" · "Go back 10 seconds" · "Jump to 1:30" · "Go to 2 minutes 15"
- "Turn it up" / "Turn it down" · "Louder" / "Quieter" · "Volume 30" · "Mute" / "Unmute"
- "Shuffle on" / "Shuffle off" · "Repeat this song" · "Repeat on" / "Repeat off"
- "What's playing?" · "What song is this?" · "What's next?" · "What's in the queue?"

**Videos** ⚡:
- "Close the video" · "Hide the video" (music only) · "Show the video" · "Full screen" / "Exit full screen"
- "Play at 1.5 speed" · "Double speed" · "Speed it up" / "Slow it down" · "Normal speed"
- "Previous video" · "Go back to the last video" · "The one before that" · "Next video" · "Go back to the *bunny* video"
- "Browse videos about gardening" · "Show me videos of Iceland" · "Show my recent videos" · "Show the queue"
- "Add this to the queue" · "Make a playlist called *Worship*" · "Add this video to my *Worship* playlist" · "Play my *Worship* videos"

**Spotify extras** ⚡ (with Spotify inside Dayspring):
- "Like this song" · "Add this song to my *Workout* playlist" · "Search Spotify for Yiruma" · "Start a jam"

> **Tip:** "Slow down", "speed up" and "normal speed" change the **video's** speed while a video is showing. Otherwise they change how fast **Dayspring talks**. To be clear either way, say "talk slower" or "slow the video down". The same goes for volume: while music plays, "turn it up" means the music; "turn your voice up" means Dayspring.

## Morning music

If you have a morning block (for example "Wake up" at 6:30), Dayspring starts it with music:

1. A gentle song plays for about 20 seconds.
2. The music dips under the greeting ("Good morning, Alex…").
3. The music plays on for about a minute, then fades.
4. Dayspring asks if you're ready for the day, then gives the rundown.

With Spotify connected inside Dayspring, the morning songs play right on the screen. Dayspring comes with two starter playlists: **Morning Ambient** (Debussy, Satie, Einaudi…) and **Morning Hymns** (instrumental). Make them your own by voice (these need an AI brain):

- "Add *River Flows in You* by Yiruma to my morning ambient playlist"
- "Take *Canon in D* off the morning list"

Songs without a Spotify link play from a YouTube search.
