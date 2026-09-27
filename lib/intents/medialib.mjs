// His own music and videos, and Google Drive, for the no-AI intent catalogue (catalog.mjs), in its template language:
// (a|b) one of, [x] optional, {text} free words, {num} a number. Every one plans { do: "medialib", id, text } and the runner
// hands the words to lib/medialib/skills.mjs (which also answers these directly, before anything else, when it's sure).
// The optional 5th item boosts the score when the words clearly mean it.
const OWN = /\b(from|on|off) (my |this )?(computer|pc|laptop|hard drive|files)\b|\bmp3s?\b|\b(audio|video|music) files?\b|\bmy (music|videos|downloads) folder\b/;
const DRIVE = /\b(google drive|my drive|(from|in|on) (my )?\w* ?drive)\b/;
export const MEDIALIB_INTENTS = [
  ["medialib.play", "Play music or a video from your computer", "play holy forever from my computer", [
    "play {text} from my (computer|pc|laptop|files)", "play {text} (on|off) my (computer|pc|laptop|hard drive)", "play my {text} (mp3s|mp3|files|songs on my computer)",
    "play the (latest|newest) (video|song) in [my] (downloads|videos|music)", "play (the|a) (song|video) {text} from my (computer|pc)", "watch {text} from my (computer|pc|laptop)",
  ], (c) => (OWN.test(c.q) ? 1.3 : 1)],
  ["medialib.shuffle", "Shuffle your music folder", "shuffle my music folder", ["shuffle my (music|videos|downloads) folder", "shuffle [the] (songs|music|mp3s) (on|from) my (computer|pc|laptop)", "shuffle my (mp3s|music files|audio files)"], (c) => (OWN.test(c.q) ? 1.3 : 1)],
  ["medialib.list", "List the music or videos on your computer", "what audio files do i have from 2019", [
    "what (audio|music|video|mp3) files do i have [from {num}]", "(list|show me) my (audio|music|video) files", "what (songs|videos|mp3s) do i have (on|from) my (computer|pc)", "what (songs|videos|mp3s) do i have from {num}",
    "how many (songs|videos|mp3s) do i have",
  ], (c) => (/\bfiles?\b|\bdo i have\b/.test(c.q) ? 1.25 : 1)],
  ["medialib.find", "Find a video or song on your computer", "find the video from sarah's wedding", ["find the (video|song|recording) (from|of) {text}", "(find|where is) my {text} (video|recording|mp3)", "find {text} on my (computer|pc|laptop)"], (c) => (OWN.test(c.q) ? 1.25 : 1)],
  ["medialib.drive", "Play or find something in your Google Drive", "play the wedding video from my drive", [
    "play {text} from (my|the) [work|personal] [google] drive", "(search|look in) my [google] drive for {text}", "find {text} in my [google] drive", "what (changed|is new) in my [google] drive [this week]", "(show|list) my recent drive files",
  ], (c) => (DRIVE.test(c.q) ? 1.3 : 1)],
];
