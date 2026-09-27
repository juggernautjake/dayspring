# Your own music and videos

Dayspring can find the songs and videos on your computer and play them on the Dayspring screen. It only looks in folders you've allowed in **Settings → Permissions**, and it never needs an AI to do it.

## What you can say

- "Play the song Holy Forever from my computer"
- "Play my Johnny Cash mp3s"
- "Find the video from Sarah's wedding"
- "Play the latest video in Downloads"
- "Shuffle my music folder"
- "What audio files do I have from 2019?"
- "Play Holy Forever from my work drive" (a song in [Google Drive](google-drive.md))

When Dayspring finds a few matches, a numbered list appears on the screen. Say "number 2", press a number key, or click one. "Play them all" plays the whole list, and "shuffle them" plays it in random order.

A plain "play Holy Forever" plays your own copy when you have one that matches well. Otherwise it goes to Spotify or YouTube as before. Add "from my computer" to use only your files, or "on Spotify" to use only Spotify.

## Which folders it looks in

Dayspring looks in your **Music**, **Videos** and **Downloads** folders (and OneDrive's Music and Videos), and in the folders you picked in Settings → Permissions. It only looks where file access lets it read.

- **File access is off:** Dayspring doesn't look anywhere. It tells you how to allow a folder: open **Settings → Permissions**, choose **Only the places I pick**, and add your Music, Videos or Downloads folder with **Can look**.
- **A folder set to "Keep out"** (none) is never looked in, even inside an allowed folder.
- **If you take a permission back later,** Dayspring stops showing and playing those files right away, even though they were found before.

It skips folders and files whose names look private (for example "Private", "Personal", "Taxes", "Bank", "Medical" or "Passwords"), hidden and system folders, and anything that looks like it holds passwords or keys.

It reads each file's tags (title, artist, album, genre, year, track number and length) and, for videos, the length and picture size. It checks for new and changed files in the background every few hours, slowly, so the computer stays responsive. Only the file names, paths and tags are saved (in `data\media-library.json`), never the files themselves.

Files it understands: **audio** MP3, M4A, AAC, FLAC, WAV, OGG, Opus and WMA; **video** MP4, M4V, MKV, WebM, MOV, AVI and WMV.

## Playing

- **Music** plays with the normal music card: pause, skip, back, seek, volume, shuffle and repeat. A list plays as a queue.
- **Videos** play full screen on the Dayspring screen. Press Esc or ✕, or say "stop", to close them.
- Everything plays on the speaker Dayspring is set to (the Sound panel), moves when you change it, and goes quieter while Dayspring talks.
- **On this PC instead:** say "open it in the default app", or press **PC** next to a file in the list. It opens in your usual player (Media Player, VLC…). This counts as opening a program, so it needs **Open programs** in Settings → Permissions, and it asks first when that's set to "Ask me".

### Formats the screen can't play

The Dayspring screen (Chrome or Edge) can't play **WMA, WMV and AVI** files, and some MKV files use codecs it doesn't know.

- Dayspring comes with **ffmpeg** (it's already used for Discord voice). When it's there, those files are **converted as they play** (to MP3 for audio, and MP4 for video). Converting takes some computer power, and jumping around in a converted file restarts the conversion from that point.
- If ffmpeg isn't available, or you've turned conversion off (`DAYSPRING_NO_TRANSCODE=1` in `.env`), Dayspring says the screen can't play that file and offers to open it in your default player on this PC.

## Safety

- The screen only ever gets an address with a number in it (`/api/media/local/stream?id=…`), never a file path. Dayspring looks the number up in its own list and checks your permissions and its safety rules again every time a file plays. A file outside the allowed folders, or one reached through a link that leads somewhere else, is refused.
- It only works on this computer, like the rest of Dayspring.
- Every play is written in the activity log (the file's path only).

## For the AI

With an AI brain, Dayspring uses `media_library_search` and `media_library_play` for your files (and the `drive_` tools for Google Drive), so you can ask in your own words: "play something from my worship folder", "what's the longest video I have?".
