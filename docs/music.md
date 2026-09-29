# Music and videos: Spotify and YouTube

Dayspring plays music and videos right on its screen, with full controls: play and pause, skip, go back, jump to any point, volume, shuffle, repeat, and speed for videos. You can use the buttons, your voice, or typing.

- **YouTube** plays on the Dayspring screen itself. It works with no setup and **no YouTube key**. Searching happens quietly in the background: no browser window opens. Want a video in your own browser instead? Press **↗ Pop out** (or say "pop it out"). Sign in once to get no ads if you have YouTube Premium.
- **Spotify** plays on the Dayspring screen once you connect it. This needs **Spotify Premium** and about 5 minutes of setup, explained below. Until then, Dayspring falls back to playing Spotify in a small browser window of its own (the "music window"), which has fewer controls.

Commands marked ⚡ work even without an AI brain.

**New:** finding videos by title, topic or creator ("play a video by Mike Winger"), a grid of videos to pick from, your YouTube playlists (Liked videos and Watch later too), the video queue, and more playback controls (captions, quality, minimise). See [Videos: finding them, your playlists and the queue](videos.md).

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

> **Note:** Spotify plays on the same speaker as Dayspring's voice (the one you picked in the Sound panel), not the Windows default, and moves when you change it. With several speakers picked, it plays on the first one that's connected: TV, then headphones, then speakers. In a browser tab or in Firefox it uses the Windows default instead. See [Sound → Music and videos play there too](audio-devices.md#music-and-videos-play-there-too).

> **If it doesn't work:**
> - **"INVALID_CLIENT: Invalid redirect URI"**: the Redirect URI in your Spotify app must be exactly `http://127.0.0.1:4747/spotify/callback`, with no `/` at the end and `http`, not `https`.
> - **"User not registered" / "403"**: add your Spotify email under **User Management** in the developer dashboard (step 1.6).
> - **"Playing inside Dayspring needs Spotify Premium"**: the account you signed in with isn't Premium.
> - **"The Dayspring screen isn't connected to Spotify right now"**: the screen is closed or reloading. Open it and try again. It reconnects by itself within a few seconds.
> - **"This browser can't play Spotify here"**: the screen must be Chrome or Edge (Settings → Screen).

## The music card

One player card, at the bottom right of the screen, always shows **whatever is playing**: Spotify (inside Dayspring or in the media window), YouTube (on the screen or in the media window), your own music and videos, Google Drive's, and Lantern's study music when Lantern reports it. When one thing stops and another starts, the card switches to it. It shows:

- where it's from (a small coloured icon: YouTube, Spotify, your files, Drive, Lantern) and whether a video is big, in the corner, or audio only
- the cover (or video thumbnail), title and artist or channel
- **NEXT**: the next song or video in line. Click it to see the whole queue.
- a progress bar you can drag to jump anywhere
- 🔀 shuffle · ⏮ previous · ⏯ play/pause · ⏭ next · 🔁 repeat (click again for "repeat this one")
- a volume slider and a mute button (the music's or the video's own volume; Dayspring's own voice has its own volume). On a narrow card only the mute button shows.
- for videos, a three-way switch: **big**, **in the corner**, **audio only** (see [Videos](videos.md#big-in-the-corner-or-just-the-sound))
- ♡: like the song on Spotify, or save the video to your "Saved videos" list
- ☰ *n*: how many are lined up next; click for the queue
- 📚: open it in the **Music & Video browser** (below)
- ✕: stop

**Only one thing plays at a time.** Starting something pauses whatever was playing, wherever it was: Spotify, a video, your own music, the media window, or Lantern's music. Your voice commands ("pause", "next", "skip ahead 30 seconds") go to whatever the card is showing.

**When nothing is playing** the card hides. To keep it on screen saying "Nothing playing", choose that in Settings → Screen → **Videos and the player**.

On a second Dayspring screen (one that isn't the one playing), the card still shows what's playing, and its buttons control it. Something another app plays (Lantern's music) is shown, but controlled in that app. (For app makers: an app on this computer reports what it plays with `POST /api/player/nowplaying/report` `{ "source": "lantern", "title", "artist", "art", "playing", "position", "duration" }`, and `{ "source": "lantern", "ended": true }` when it stops. `GET /api/player/nowplaying` says what's showing; an app should pause when something else becomes the current one.)

Dayspring's music automatically dips while it talks and comes back up after, in every view (a video in audio only, too).

## Watching videos

Videos play big on the Dayspring screen. Move the mouse or tap on the video to show its controls; they hide again after a few seconds, and stay visible while paused.

- **✕** (top right): close the video
- **☰ Browse**: the video browser (below)
- ⏮ ⏯ ⏭: previous video, play/pause, next video
- **⟲10 / 10⟳**: back or forward 10 seconds
- the progress bar with the time and length: click or drag to jump
- volume, **speed** (0.25× to 2×), **▭** small in the corner, **♪** audio only (hides the picture, the sound goes on), **⛶** full screen

Click the video to play or pause it; double-click for full screen. A video can also be small in the corner (drag it anywhere, it snaps to the edges, resize it from its corner) or just the sound: see [Big, in the corner, or just the sound](videos.md#big-in-the-corner-or-just-the-sound).

**Keyboard** (while a video is showing):

| Key | Does |
|---|---|
| Space or K | Play / pause |
| ← / → | Back / forward 5 seconds |
| ↑ / ↓ | Volume up / down |
| < / > | Slower / faster |
| F | Full screen |
| B · I · A | Big · small in the corner · audio only (A again: back) |
| M | Mute |
| Shift+N / Shift+P | Next / previous video |
| Esc | Leave full screen, or close the video |

## Going back and forth between videos

Dayspring remembers the last 50 videos you played (on this computer only) and **where you stopped in each one**.

- ⏮ goes back to the previous video, resuming where you left it. ⏭ goes forward again, then to your **Up next** queue, then to the next-best result of your last search.
- In a YouTube playlist, ⏮ and ⏭ move through the playlist.
- Your recent videos are in the Library's **Videos** tab. Click one to go back to it.

## The Library

> **New:** the [Music & Video browser](music-and-video-browser.md) brings Spotify, YouTube (including your watch history), your own files and Drive together in one window, with search as you type. When it's on (Settings → This app → Features), the Library's buttons open it instead. The Library below is what you get when it's switched off.

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

## Pop a video out into your browser

Press **↗** on the video controls, or say **"pop it out"** / **"open this in my browser"** ⚡. The video pauses in Dayspring and opens in your own browser (the one you picked in Settings → Screen, or your Windows default) at the same second, signed in as you.

A few videos can't play inside other apps (their owners turn that off). For those, Dayspring shows a card: **"This video can't play inside Dayspring. Pop it out?"** Nothing opens unless you press **Pop out ↗**.

## Do I need a YouTube API key?

**No.** Dayspring searches YouTube by reading youtube.com's own results page, with no key and no window. A key is optional: it makes searches a little faster and steadier. To add one:

1. Go to [Google Cloud's YouTube Data API page](https://console.cloud.google.com/apis/library/youtube.googleapis.com) and sign in.
2. Create a project if it asks, then click **Enable**.
3. Open **Credentials → Create credentials → API key** and copy it.
4. Paste it in Dayspring's Settings → **Features & apps** → **Extra keys (optional)** → **YouTube search**.

The free allowance is about 100 searches a day. When it runs out, Dayspring goes back to the no-key way by itself.

## Video playlists

Dayspring keeps its own named video playlists, like "Worship" or "Morning hymns", on this computer. They show in the Library and work by voice. They're separate from your YouTube account's playlists: Dayspring can list and play those too ("list my YouTube playlists", "play my Worship playlist"; see [Your YouTube playlists](videos.md#your-youtube-playlists)), but saving into your YouTube account isn't reliable, so Dayspring's playlists live in Dayspring.

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

## Asking for music on Spotify

Ask for music the way you'd ask a friend. Dayspring works out what kind of thing you mean, searches Spotify for it, checks its pick before playing, and then checks what's actually playing. All of this works without an AI brain ⚡ once Spotify is connected inside Dayspring. Without that connection, add "on Spotify" and it uses the music window.

| You can ask for | For example |
|---|---|
| A song | "Play *Gratitude* by Hollow Pines" · "Play the song *Way Maker*" · "Play the song that goes *way maker, miracle worker*" |
| An artist | "Play some Johnny Cash" · "Play songs by Josh Garrels" |
| An album | "Play the album *At Folsom Prison*" · "Play the album *Home* by Josh Garrels" |
| A playlist | "Play the *This Is Johnny Cash* playlist" · "Play my *Road Trip* playlist" · "Play my Discover Weekly" |
| Your Liked Songs | "Play my liked songs" · "Shuffle my favorite songs" |
| A genre or style | "Play christian folk music" · "Put on some worship" · "Play 90s country" · "Play bluegrass gospel" · "Play lo-fi" |
| A mood or activity | "Play something calm for studying" · "Play upbeat workout music" |
| More like something | "Play more like this" · "Play songs like Johnny Cash" · "Play Josh Garrels radio" |
| With changes | "Shuffle worship music" · "Play worship, but no Hillsong" · "Play only Hillsong Worship" |

- **Typing and hearing mistakes are fine.** "Christian fold", "worhsip", "jonny cash" and "war ship music" still find Christian folk, worship and Johnny Cash.
- **Genres are checked.** For a genre, Dayspring picks a playlist whose name or description says it and whose artists really are that genre on Spotify, and it skips generic hit lists. If no playlist fits, it makes a mix from that genre's top artists.
- **It tells you what it picked**, for example: "Playing Christian Folk, a playlist with The Gray Havens and Josh Garrels." If Spotify ends up playing something else, Dayspring says so.
- **When it isn't sure**, it doesn't guess. It says "I'm not sure which one you mean" and shows up to three choices on the screen. Say the number, or "none of these".
- **Wrong music?** Say **"not that"**, **"that's not what I wanted"**, **"try another"** or **"skip this playlist"** ⚡. Dayspring plays its next-best match and remembers. The next time you ask for the same thing, even spelled differently, it won't pick that one again. (These corrections stay on this computer, in `data/music-prefs.json`.)
- **Your Discover Weekly** plays only when it's saved in your Spotify library. Open Spotify, find Discover Weekly and add it to your library, then ask again.

## Things you can say

**Playing** (these need an AI brain unless marked ⚡):
- "Play *River Flows in You* on Spotify" ⚡ · "Play the album *Abbey Road*" ⚡ · "Play Yiruma" ⚡ · "Play a lo-fi study playlist" ⚡ · "Play christian folk music" ⚡
- "Play my *Morning* playlist" ⚡ · "Shuffle my Liked Songs" ⚡ · "Play more like this" ⚡ · "Not that" / "Try another" ⚡ · "Play a podcast about history"
- "Play *hymns* on YouTube" ⚡ · "Find a recent popular video about sourdough" ⚡
- "Queue *Sweet Disposition*" ⚡ · "Add the second one to the queue" ⚡ (from a list on screen) · "Play the third one" ⚡

**Controlling** ⚡ (while something is playing):
- "Pause" · "Play" / "Resume" · "Next" / "Skip" · "Previous" / "Go back" · "Start over" · "Stop the music"
- "Skip ahead 30 seconds" · "Go back 10 seconds" · "Jump to 1:30" · "Go to 2 minutes 15"
- "Turn it up" / "Turn it down" · "Louder" / "Quieter" · "Volume 30" · "Mute" / "Unmute"
- "Shuffle on" / "Shuffle off" · "Repeat this song" · "Repeat on" / "Repeat off"
- "What's playing?" · "What song is this?" · "What's next?" · "What's in the queue?"

**Videos** ⚡:
- "Close the video" · "Minimize the video" / "Hide the video" / "Audio only" / "Just play the audio" · "Picture in picture" / "Put it in the corner" / "Make it small" · "Show the video" / "Make it big" · "Full screen" / "Exit full screen"
- "Move it to the top left" · "Move the video to the center" · "Make the video bigger" / "smaller"
- "Minimize the map" · "Put the viewer in the corner" · "Hide everything" · "Show everything again"
- "Play at 1.5 speed" · "Double speed" · "Speed it up" / "Slow it down" · "Normal speed"
- "Previous video" · "Go back to the last video" · "The one before that" · "Next video" · "Go back to the *bunny* video"
- "Browse videos about gardening" · "Show me videos of Iceland" · "Show my recent videos" · "Show the queue"
- "Add this to the queue" · "Make a playlist called *Worship*" · "Add this video to my *Worship* playlist" · "Play my *Worship* videos"

**Spotify extras** ⚡ (with Spotify inside Dayspring):
- "Like this song" / "Save this song" · "Add this song to my *Workout* playlist" · "Queue *Gratitude* by Hollow Pines" · "Play *Hurt* next" · "Search Spotify for Yiruma" · "Start a jam"

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
