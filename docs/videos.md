# Videos: finding them, your playlists and the queue

Ask for a video the way you'd ask a friend. Dayspring finds it on YouTube, picks the best match and plays it on the Dayspring screen. All of this works **without an AI brain** and without a YouTube key. It's marked **New** in Settings → Features ("Finding videos, YouTube playlists and the video queue"), where you can switch it off.

## Finding a video

- "Find bible reading in Psalms on YouTube" · "Play Psalm 23 on YouTube" · "Watch the Chosen season 4 trailer on YouTube"
- "Play the video Amazing Grace" · "Show me a video of a cat playing piano" · "Play a video about surfing in Bali"
- "Play a youtube playlist of worship songs" · "Find a live stream of morning worship on YouTube"
- "Play more like this" · "Play the next episode"
- "Play 3 videos about surfing" (one plays and two are queued after it)

When you say **YouTube** or **video**, it's a video request. "Find bible reading in Psalms on YouTube" plays a video, while "read Psalm 23" still reads the Bible to you. The same goes for music ("play some jazz" is still music) and pictures ("show me pictures of…" is still pictures).

**Filters:** "under 10 minutes", "longer than 20 minutes", "over an hour", "full episode", "newest", "from this week", "most popular". YouTube Shorts are left out unless you ask for one ("play a YouTube short about cats").

**Not sure?** When a few videos fit equally well, Dayspring shows the top 3 and asks. Say "number 2". Your choice is remembered for next time.

**Not that one:** say "not that", "wrong video" or "next one", and it plays the next best match. It remembers, so the same words won't pick that video again.

## Videos by a creator

- "Play a video by Mike Winger" · "Play a video by oney plays" · "Play a video by John MacArthur"
- "Play the latest video from Mike Winger" · "Play a popular video by OneyPlays" · "Is Mike Winger live?"
- "Play a video by Mike Winger about the Trinity"

Dayspring finds the person's **own channel** and plays a recent video that people watched, the newest one, or the most viewed one. It never picks a video that only mentions them. Names are matched the way they sound, so "oney plays", "one-y plays" and "OneyPlays" are the same, and so are "John MacArthur" and "John McArthur".

Some people are best known from another channel, for example John MacArthur from **Grace to You**, and R.C. Sproul from **Ligonier Ministries**. Dayspring has a short list of these. You can add your own:

- "When I say Pastor Bob I mean First Baptist Church"
- "Forget Pastor Bob's channel"

If it picks the wrong channel, say **"wrong channel"**. It tries the next one and remembers. When there are several channels with that name, it asks which one, and it remembers your answer. Your list is kept in `data\video-creators.json`, which you can also edit by hand.

## Browsing: a grid to choose from

- "Pull up videos about biking" · "Show me videos by Mike Winger" · "Search YouTube for dovetails"
- "Pull up a bunch of videos about surfing, longer than 20 minutes"

A grid of 12 numbered videos appears, each with its picture, title, channel, length and age.

- **Pick one:** say "number 3", or click it.
- **See more:** say "more" (up to 24, and more after that).
- **Queue some:** say "queue number 2 and 4", or press **＋ Queue** on any video.
- **Filter:** say "newest first", "most viewed", "only longer than 20 minutes", "shorter than 5 minutes" or "no Shorts", or use the buttons at the top. "Show all" clears the filters.
- **Close it:** say "close the videos", or press ✕ or Esc.

## Your YouTube playlists

- "List my YouTube playlists"
- "Play my Worship playlist" · "Shuffle my workout playlist" (the name can be said loosely)
- "Play my liked videos" · "Play my watch later"
- "What's in my Sunday Sermons playlist?" (shows every video in it; say a number to start there)
- "Queue my Worship playlist after this"

Dayspring reads your playlists from your YouTube account in one of two ways:

- **Signed in to YouTube in Dayspring** (say "sign in to YouTube" once). This is the usual way.
- **A Google account connected with YouTube access** (Settings → Apps → Google). If one is connected, Dayspring uses Google's YouTube service instead and doesn't need the sign-in window.

If Spotify is connected too, "play my Worship playlist" may mean a Spotify playlist, so add "YouTube": "play my Worship YouTube playlist".

Your own **video playlists on Dayspring** ("Worship", "Morning hymns") work the same way. See [Music and videos → Video playlists](music.md#video-playlists).

## The video queue

- "Queue how to cut dovetails" · "Add Half-Blind Dovetails Explained to the queue"
- "Play Hand Cut Dovetails for Beginners next" (right after the video that's playing)
- "Queue 3 videos about dovetails" · "Queue a video by Mike Winger" · "Add this to my queue"
- "Show the queue" · "What's in this playlist?" · "What's up next?"
- "Play number 5" · "Remove number 3" · "Move number 4 up" · "Move number 2 to the top" · "Clear the queue"
- "Shuffle the queue" · "Repeat the queue" · "Repeat this one" · "Repeat off" · "Skip" · "Previous"

The queue panel shows every video with its picture, title, channel and length. A ▶ marks the one that's playing. Click a video to jump to it, use ▲ ▼ to move it, ✕ to remove it, or drag it. **Clear**, **⤮ Shuffle** and **↻ Repeat** are at the top. Open it with the **☰** button on the video, the **Q** key, or "show the queue".

When a video ends, the next one starts by itself. The queue is kept on this computer, so it's still there after a restart. Playing a playlist fills the queue with its videos, so "what's in this playlist" shows them all.

## Controlling what's playing

These work for YouTube videos, your own music and videos, and Spotify where it makes sense, by voice (no AI needed), with the buttons on the video, and with the keyboard:

| Say | Keys and buttons |
|---|---|
| "Pause" · "Resume" · "Stop" | Space or K · ⏯ · Esc closes |
| "Restart" · "Go back to the beginning" | Home |
| "Rewind 30 seconds" · "Skip ahead 2 minutes" · "Fast forward" | ← → (5 s) · J L (10 s) · ⟲10 ⟳10 |
| "Jump to 5:30" · "Go to the middle" | 0–9 jump to 0–90% |
| "Double speed" · "1.5x" · "Slow down" · "Normal speed" | < > · the speed menu |
| "Volume up" · "Volume down" · "Mute" · "Volume 40" | ↑ ↓ · M · the volume slider |
| "Captions on" · "Captions off" · "Captions in Spanish" | C · **CC** |
| "Highest quality" · "720p" · "Auto quality" | the quality menu |
| "Full screen" · "Exit full screen" · "Minimize the player" · "Bring the video back" | F · I · ⛶ · ▭ |
| "Next" · "Previous" · "Repeat this one" · "Repeat all" · "Shuffle" | N and P (with Shift) · R · S · the repeat and shuffle buttons |
| "What's playing?" · "How long is left?" | |
| "Show the queue" | Q · ☰ |

- The volume here is the **video's or the music's own volume**, not the computer's. "Turn up your voice" is still Dayspring's own voice.
- **Quality:** Dayspring asks YouTube for the quality you want, but YouTube has the last word. Your own files and Spotify play at their own quality.
- **Captions:** YouTube captions follow the video's own caption tracks. Once you turn them on, they stay on for the next video. Your own videos show captions when the file has them.
- A **minimized** video sits small in the corner, inside the screen's margins, and stays small for the next video in the queue until you bring it back.

## Study time

During a study block, videos aren't played (music still is), the same as before. You can still browse and queue them for later.

## Privacy

Searches go straight to youtube.com, with no key and no account needed. Your playlists are read only when you ask for them, and the list is kept on this computer for a few hours so the sign-in window doesn't open every time. Your queue, your corrections and your creator names stay in the `data` folder on this computer.
