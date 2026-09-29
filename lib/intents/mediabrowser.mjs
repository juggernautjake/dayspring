// The Music & Video browser, for the no-AI intent catalogue (catalog.mjs), in its template language: (a|b) one of, [x]
// optional, {text} free words, {num} a number. Every one plans { do: "mediabrowser", id, text } and the runner hands the
// words to lib/mediabrowser/index.mjs (which also answers these directly, before anything else, when it's sure:
// server.mjs). The optional 5th item boosts the score when the words clearly mean it (and lowers it when they don't, so
// "open spotify" stays the Spotify app and "open youtube" the website).
const SP = /\bspotify\b/;
export const MEDIABROWSER_INTENTS = [
  ["mediabrowser.open", "Open the Music & Video browser", "open my music", ["open my music", "(open|show|pull up) [the] (music and video|media|music) browser", "(show|open) [me] my (music and videos|music library)"], (c) => (/\bbrowser\b|\bmy music\b/.test(c.q) ? 1.3 : 0.8)],
  ["mediabrowser.playlists", "Show your Spotify playlists", "show my spotify playlists", ["(show|list|open|pull up) [me] [all] my spotify playlists", "what playlists do i have on spotify", "my spotify playlists"], (c) => (SP.test(c.q) && /\bplaylists\b/.test(c.q) ? 1.35 : 0.7)],
  ["mediabrowser.liked", "Show your Liked Songs", "show my liked songs", ["(show|open|list|pull up) [me] [all] my (liked|saved|favorite) songs", "my liked songs [on spotify]"], (c) => (/\b(liked|saved|favorite) songs\b/.test(c.q) ? 1.3 : 0.8)],
  ["mediabrowser.artists", "Show the artists you follow", "show my followed artists", ["(show|list|open) [me] my followed artists", "my followed artists", "what artists do i follow [on spotify]"], (c) => (/\bfollow/.test(c.q) ? 1.3 : 0.8)],
  ["mediabrowser.top", "Your top songs and artists", "my top songs this month", ["[show] [me] my top (songs|tracks|artists) [on spotify] [this month|this year|of all time]", "what are my (top|most played) (songs|artists) [this month]"], (c) => (/\b(top|most played)\b/.test(c.q) ? 1.3 : 0.8)],
  ["mediabrowser.recent", "What you listened to", "what did i listen to yesterday", ["what did i listen to [on spotify] [today|yesterday|last night|lately]", "(show|open) [me] my (listening|spotify) history", "what have i been listening to [lately]"], (c) => (/\blisten/.test(c.q) ? 1.35 : 0.8)],
  ["mediabrowser.history", "Your YouTube watch history", "show my youtube history", ["(show|open|pull up) [me] my youtube [watch] history", "what did i watch [on youtube] [today|yesterday|last night]", "my youtube history"], (c) => (/\b(history|watch|watched)\b/.test(c.q) ? 1.35 : 0.7)],
  ["mediabrowser.search", "Search Spotify from the browser", "search spotify for hillsong", ["search spotify for {text}", "(find|look up) {text} on spotify", "search (my files|my drive) for {text}"], (c) => (/\b(search|find|look up)\b/.test(c.q) ? 1.3 : 0.7)],
];
