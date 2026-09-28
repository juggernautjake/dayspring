// Videos on YouTube, for the no-AI intent catalogue (catalog.mjs), in its template language: (a|b) one of, [x] optional,
// {text} free words, {num} a number. Every one plans { do: "video", id, text } and the runner hands the words to
// lib/video/index.mjs (which also answers these directly, before anything else, when it's sure: server.mjs).
// The optional 5th item boosts the score when the words clearly mean it.
const VID = /\b(youtube|you tube|videos?|clips?|channel|live ?stream|episodes?)\b/;
const YT = /\b(youtube|you tube|channel|live ?stream)\b/;
export const VIDEO_INTENTS = [
  ["video.find", "Find and play a video on YouTube", "find bible reading in psalms on youtube", [
    "(play|find|watch|look up|search for|pull up) {text} on youtube", "(play|watch|put on) a video (about|of|on|by) {text}", "show me a video of {text}",
    "play (the )?(latest|newest|new) video (by|from) {text}", "play something from {text} channel", "play a youtube video (about|of) {text}",
  ], (c) => (YT.test(c.q) ? 1.4 : 0.9)],
  ["video.browse", "Show videos to choose from", "pull up videos about biking", [
    "(pull up|show me|browse|bring up|show) [a bunch of|some|a list of] videos (about|of|on|by|from) {text}", "search youtube for {text}", "what is on youtube about {text}",
  ], (c) => (VID.test(c.q) ? 1.3 : 0.8)],
  ["video.queue", "Queue videos", "queue 3 videos about dovetails", [
    "queue [up] {num} videos (about|of|on|by|from) {text}", "(queue|add) [the] video {text} [to the queue]", "add {text} video to the queue", "play the video {text} next",
  ], (c) => (VID.test(c.q) ? 1.3 : 0.8)],
  ["video.queue.show", "Show the video queue", "show the queue", ["(show|open|pull up) [me] the [video] queue", "what is in the [video] queue", "what is in this playlist"]],
  ["video.playlists", "List your YouTube playlists", "list my youtube playlists", ["(list|show|read) my youtube playlists", "what youtube playlists do i have", "what are my youtube playlists"], (c) => (/\byoutube\b/.test(c.q) ? 1.3 : 0.8)],
  ["video.playlist", "Play one of your YouTube playlists", "play my worship playlist on youtube", ["(play|shuffle) my {text} (youtube playlist|playlist on youtube)", "play my (liked videos|watch later)", "shuffle my liked videos"], (c) => (/\b(youtube|liked videos|watch later)\b/.test(c.q) ? 1.3 : 0.8)],
];
