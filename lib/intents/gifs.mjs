// GIFs, for the no-AI intent catalogue (catalog.mjs), in its template language: (a|b) one of, [x] optional, {text}
// free words, {num} a number. Every one plans { do: "gifs", id, text } and the runner hands the words to
// lib/gifs/routes.mjs (which also answers these directly, before anything else, when it's sure).
// The optional 5th item boosts the score when the words clearly mean it (a GIF, not a picture).
const GIF_WORDS = /\b(gifs?|jifs?|stickers?)\b/;
export const GIF_INTENTS = [
  ["gifs.search", "Find a GIF", "show me a gif of a dancing cat", [
    "(show|find|get|give) me (a|an|some) (gif|gifs|sticker|stickers) of {text}", "(a|an) (gif|sticker) of {text}", "(gif|gifs) of {text}",
    "find (a|an) {text} (gif|sticker)", "(show|find|get) me {text} (gifs|stickers)", "(search|look) for (a|an) (gif|gifs) (of|about) {text}",
    "(add|insert|attach) (a|an) [funny] gif (of|about) {text}", "{text} gif",
  ], (c) => (GIF_WORDS.test(c.q) ? 1.6 : 1)],
  ["gifs.trending", "Show trending GIFs", "trending gifs", ["(trending|popular|top) (gifs|stickers)", "(show|what are) [me] [the] trending gifs", "what gifs are trending", "(open|show) [me] [the] (gifs|gif picker|stickers)"],
    (c) => (GIF_WORDS.test(c.q) ? 1.6 : 1)],
  ["gifs.more", "Show more GIFs", "more gifs", ["(more|next) (gifs|stickers)", "show me more (gifs|stickers)", "load more gifs"], (c) => (GIF_WORDS.test(c.q) ? 1.5 : 1)],
  ["gifs.save", "Save a GIF to your computer", "save that gif", ["save (that|this|the) (gif|sticker)", "save gif {num}", "download (that|this) gif"], (c) => (GIF_WORDS.test(c.q) ? 1.5 : 1)],
  ["gifs.copy", "Copy a GIF", "copy that gif", ["copy (that|this|the) (gif|sticker)", "copy gif {num}", "copy the gif link"], (c) => (GIF_WORDS.test(c.q) ? 1.5 : 1)],
  ["gifs.stickers", "Show only stickers", "only stickers", ["(only|just) stickers", "stickers only", "switch to stickers"], (c) => (/\bstickers\b/.test(c.q) ? 1.5 : 1)],
  ["gifs.clean", "Only clean GIFs", "clean gifs only", ["(only|just) clean (ones|gifs)", "clean (ones|gifs) only", "family friendly gifs", "keep (it|the gifs) clean"], (c) => (/\bclean\b|\bfamily friendly\b/.test(c.q) ? 1.5 : 1)],
  ["gifs.close", "Close the GIFs", "close the gifs", ["(close|hide) (the )?(gifs|gif picker|stickers)", "no more gifs"], (c) => (GIF_WORDS.test(c.q) ? 1.5 : 1)],
];
