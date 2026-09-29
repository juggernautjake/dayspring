# The Music & Video browser

One window for everything you listen to and watch: **Spotify**, **YouTube**, **your own files** and **Google Drive**. Search as you type, scroll through your playlists, Liked Songs and watch history, and pick exactly what to play. It's marked **New** in Settings → This app → Features ("The Music & Video browser"), where you can switch it off.

## Opening it

- Click **🎵 Music** by the clock (when the screen is narrow it's in **⋯ More**).
- Or say: "open my music", "show my Spotify", "show my YouTube".
- Or go straight to a list: "show my Spotify playlists", "show my liked songs", "my followed artists", "my top songs this month", "what did I listen to yesterday", "show my YouTube history", "what did I watch last night".
- Or search: "search Spotify for Hillsong", "search YouTube for dovetail joints". The browser opens with the results.

The window stays inside the screen's margins (Settings → Screen). Drag its title bar to move it, drag the bottom-right corner to resize it, and double-click the title bar (or press **▢**) to fill the screen again. **–** tucks it into a small button in the corner. In Dayspring mini it fills the window.

## Searching

Type in the big box at the top. Results appear after a short pause, while you're still typing, grouped:

- **Spotify:** Songs · Artists · Albums · Playlists · Genres and moods (typos are forgiven: "christian fold" finds Christian Folk).
- **YouTube:** Videos · Channels · Playlists.
- **My files:** Songs · Videos · Albums · Artists.

Each group has **Load more**. The **Everything** menu narrows it to one kind. Your recent searches appear under the box when it's empty; **✕ Clear** forgets them.

Spotify only gives apps in Development Mode 10 results at a time, so Dayspring asks twice for each page and again for each **Load more**. You don't need to do anything.

## What every result can do

- **▶ Play** it now.
- **⤴ Play next** or **＋ Add to queue**.
- **↗ Open** an artist, album, playlist or channel. It opens inside the browser; **‹ Back** (or Backspace) returns.
- **♡ Save** on Spotify: a song goes into Liked Songs, an album is saved, an artist is followed.
- **☰＋ Add to a playlist:** one of your Spotify playlists, or one of Dayspring's video playlists for a YouTube video.
- **🗑 Remove from watch history** on your YouTube history.

**Pick several:** press **☑ Select** (or Ctrl-click), pick, then use the bar at the bottom: Play, Play next, Add to queue, Add to playlist or Save.

**List or grid:** **▦ Grid** and **☰ List**. **Sort:** title, artist or channel, length, newest. **Filters** (YouTube): length, upload date, no Shorts, order.

## The sections

**Spotify:** Now playing (with Like and a lyrics link), Playlists (yours, followed, collaborative), Liked Songs (all of them: keep scrolling), Saved albums, Followed artists, Top artists and songs (last 4 weeks, 6 months, all time), Recently played (grouped by day) and the Queue.

**YouTube:** Watch history (grouped by day, with a search box for your history), Your playlists, Liked videos, Watch later, Subscriptions (their latest videos, or the channel list) and the Queue.

**My files:** Recently added, Songs, Albums, Artists and Videos from the folders Dayspring may read (see [Your own music and videos](media-library.md)). **Drive:** recent audio and video in your Google Drive.

Long lists load more as you scroll to the bottom.

## Voice

Everything on the screen is numbered. While the browser is showing, say:

- "play number 3", "number 3"
- "queue number 2", "play number 2 next"
- "like number 4"
- "open number 1"
- "remove number 5 from history"
- "more"
- "close music"

If a picture grid, GIFs or the video grid opened after the browser, the numbers belong to whichever is newest on the screen.

## Keyboard and remote

- **↑ ↓** move (in the grid, **← →** too) and **Enter** plays (or opens an artist, album or playlist).
- **Space** picks, **N** plays next, **Q** queues, **L** likes and **O** or **→** opens.
- **Backspace** goes back, **/** jumps to the search box, and **Esc** closes a menu, then the open page, then the window.

## The mini player

While something plays, a bar at the bottom of the browser shows it. It has previous, play/pause and next, a seek bar, **♡** for Spotify songs and a **Lyrics** link.

## Study time and your speakers

The same rules as the rest of Dayspring apply. During a study block YouTube videos wait (the browser says why) and music still plays. Everything plays on the output you chose for Dayspring (Settings → Sound).

## Spotify: what it needs

**Your library and history come from Spotify's own connection** (Settings → Apps & connections → Spotify: "Spotify connected (library and history)"). If you connected Spotify before this version, the browser shows **Grant access to your library and history** on the sections it can't read yet. Press it once and approve the new permissions in the browser page that opens.

**Development Mode limits.** Spotify keeps some things from apps in Development Mode, including the contents of Spotify's own editorial playlists and some artist pages. When that happens, the browser says so and offers **Open it in the web player**, which shows that page in Dayspring's media window instead. Search returns at most 10 at a time, and Dayspring pages through them for you.

## Signing in to YouTube and Spotify ("sign in once, stay signed in")

Your YouTube watch history, subscriptions, private playlists, Liked videos and Watch later only exist while you're signed in to YouTube. The same goes for Spotify's web player. Dayspring uses its own media window for this. It's a separate Chrome profile called DayspringMedia, kept in your Windows user folder (`%LOCALAPPDATA%`), which Windows protects per user.

1. Press **Sign in to YouTube** (or **Sign in to Spotify**). It's in Settings → Apps & connections, and in the browser whenever something needs it. You can also say "sign in to YouTube".
2. The media window opens on the service's own sign-in page. **Sign in yourself**, including any 2-step codes. Dayspring never types, reads or keeps your password.
3. Dayspring notices when you're done, shows "✓ Signed in as …", and tucks the window away.

You stay signed in until you sign out. Now and then (at most every few hours, and only while the media window is open) Dayspring checks that the sign-in is still there. If it has ended, you're told once, with a **Sign in again** button. Anything that needs the sign-in says "sign in to YouTube first" instead of failing quietly. You can also ask: "am I signed in to YouTube?".

**Signing out:** each service has its own **Sign out** button in Settings → Apps & connections. You can also say "sign out of YouTube". It clears only that site's cookies and storage in the DayspringMedia profile. The other service stays signed in, and your own Chrome is never touched.

**Also good to know:** if you sign out of your Google or Spotify account from that account's security page ("sign out of all devices", or removing a device), Dayspring's session ends too, and Dayspring tells you once.

**What Dayspring keeps:** only whether each service is signed in, the account's display name and when it last checked. It never keeps a password, a cookie or a token. The profile and that record stay on this computer and are never part of an export, a backup or an update.

The Spotify **web player** sign-in (for playing in the media window) and **Spotify connected** (the official connection for your library and history) are separate. Settings shows both.

## When YouTube changes its pages

History, subscriptions and your playlists are read from YouTube's own pages, because YouTube's API doesn't offer watch history. When YouTube changes those pages, a section can come up empty or show "Couldn't load this" until Dayspring is updated. Search and playing are not affected.
